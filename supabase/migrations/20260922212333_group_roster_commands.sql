-- #583: the Group roster commands (ADR-0009 Wave 3, T10) — set_group_role,
-- add_group_member, remove_group_member — over one shared Appointment core,
-- private.appoint_group_member.
--
-- #582 gave public.groups its first client write path; this file gives
-- public.group_members its first one. It is what #584 (Applications), #627
-- (changing a Task's Group), #602 (provisioning), #585 (retiring the ten
-- legacy structure commands) and #588 (Administrare) are built on, and it is
-- the replacement named in #583's retirement map: create_project →
-- create_group, add/remove_project_member and add/remove_department_team_member
-- → add/remove_group_member, grant/revoke_project_responsible →
-- set_group_role(…, 'responsible'|'member'), add/remove_independent_team_member
-- → set_group_role(…, 'responsible') / remove_group_member.
--
-- Six shapes are worth stating once, here, rather than re-deriving them at
-- every call site below.
--
-- 1. WHO APPOINTS A MANAGER IS NOT WHO RUNS THE GROUP (ADR-0009 Group Roles).
--    Granting or removing `manager` is decided one level UP: by the PARENT's
--    Group Managers for a Child Group, and by BC or the Moderator (live level
--    >= 6) for a root. Every other roster change — appointing a Group
--    Responsible, ending an appointment, adding or removing an ordinary member
--    — is decided inside the Group. A Group's own Managers therefore cannot
--    appoint their successors or remove each other, which is the whole point:
--    the seat is granted from above and can never be emptied from below.
--    Because a Group Role flows down the ancestor path, the parent's Manager
--    passes the Group's own tier too, so the strong gate always implies the
--    weak one and the escalation at step 4 of set_group_role is safe.
--
-- 2. ADDING AND REMOVING ORDINARY MEMBERS IS WORK, NOT STRUCTURE (ADR-0009
--    Entry paths). add_group_member and remove_group_member take
--    private.require_group_work_manager — Group Managers AND Group
--    Responsibles — because Appointment is explicitly a Responsible's power
--    there, exactly like accepting an Application. set_group_role takes the
--    Manager tier (#582's private.require_group_manager) instead: a
--    Responsible may bring a Member in, never make one a Responsible.
--
-- 3. ONE INSERT PATH INTO public.group_members (rulings R6/R27).
--    private.appoint_group_member(p_group_id, p_member_id, p_actor, …) carries
--    every eligibility check, the insert and the target's Notification, and
--    nothing else inserts: add_group_member_impl is a thin wrapper over it,
--    set_group_role_impl calls it whenever the Member has no roster row yet,
--    and #602's provision_profile will call it with the inviting BC as
--    p_actor so a provisioned Member is placed by exactly the same rules.
--    private.create_group_impl (#582) wrote its own Manager row; it is
--    re-issued at the end of this file to call the core instead, so the claim
--    "the core is the only insert path" is true of the whole schema and not
--    only of this file. The Wave 1 mirror writers still insert, and stop when
--    #586 drops them; group_roster_commands.test.sql pins the exact list.
--
-- 4. ELIGIBILITY IS CHECKED WHEN A WRITE PLACES A MEMBER, NOT WHEN IT REMOVES
--    ONE (ruling of this task, from ADR-0009's "Membership Status never edits
--    rosters" and #583's "an inactive target is group_member_not_eligible").
--    An inactive Member, or one below the Group's Minimum Level, cannot be
--    added and cannot be appointed Group Manager or Group Responsible. They
--    CAN be demoted to ordinary membership and removed — otherwise an inactive
--    Group Manager would be unremovable in both directions at once, since
--    remove_group_member refuses anyone holding a position
--    (group_member_holds_role) and set_group_role would refuse them for being
--    inactive. Deleting a row never creates a state the invariant forbids.
--
-- 5. AN AUTOMATIC-MEMBERSHIP GROUP HAS NO ORDINARY ROSTER ROWS. Its membership
--    is derived live from rank against Minimum Level, so private.validate_group_member
--    rejects a `member` row with 23514 automatic_group_has_no_roster_members
--    and a command must answer that fact itself rather than let a raw 23514
--    out (conventions section 3). The two answers differ by what is there:
--    demoting an existing Group Manager or Responsible to `member` DELETES the
--    row (they stay in the Group through the derived roster, at or above its
--    Minimum Level), while asking for `member` where no row exists — and
--    add_group_member, which always asks for exactly that — is PT409
--    automatic_group_has_no_roster_members, because there is nothing to demote
--    and no explicit row may be created.
--
-- 6. LOCK ORDER IS GATE → GROUPS → GROUP_MEMBERS, the same order #582's
--    update commands take. The gate (private.require_group_work_manager and
--    the Manager tier above it) holds the actor's profiles row and the roster
--    rows its authority rests on FOR SHARE; then the Group is taken FOR NO KEY
--    UPDATE — not FOR UPDATE: these commands do not write the Group, they need
--    its Minimum Level, status and Automatic Membership to hold still while
--    they write a row judged against them, and that is what serializes a
--    roster insert against a concurrent Minimum-Level raise in update_group;
--    then the target roster row FOR UPDATE and the target's profiles row FOR
--    SHARE. Taking the Group before the gate would invert update_group's order
--    and deadlock against it — that command holds a Manager's roster row FOR
--    SHARE and then reaches for the Group.

-- ==================== 1 · the shared Appointment core ====================

create function private.appoint_group_member(
  p_group_id      bigint,
  p_member_id     uuid,
  p_actor         uuid,
  p_group_role    text default 'member',
  p_position_title text default null
)
returns public.group_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group   public.groups%rowtype;
  v_title   text := nullif(btrim(p_position_title), '');
  v_row     public.group_members%rowtype;
  v_display text;
begin
  -- No gate of its own (#582's private.cancel_event_effect established the
  -- shape): every caller brings its own authority — add_group_member_impl the
  -- work tier, set_group_role_impl the Manager tier, create_group_impl the
  -- parent's Managers, #602's provisioning the inviting BC's level. What lives
  -- here is what must be true of the ROSTER ROW whoever writes it, so that no
  -- second path can ever be a shortcut past it.
  --
  -- Malformed arguments first, as in every command (conventions section 2).
  -- set_group_role_impl has already answered these for a client call; a
  -- programmatic caller such as provisioning has not.
  if p_group_role is null or p_group_role not in ('manager', 'responsible', 'member') then
    raise sqlstate 'PT400' using message = 'invalid_group_role';
  end if;
  if p_position_title is not null and v_title is null then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;
  if p_group_role = 'responsible' and v_title is null then
    raise sqlstate 'PT400' using message = 'position_title_required';
  end if;
  if p_group_role <> 'responsible' and v_title is not null then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;

  select grp.* into v_group
    from public.groups as grp
   where grp.id = p_group_id
   for no key update;
  if not found then
    -- Non-disclosing, like every other refusal in this family: an unknown
    -- Group, an archived one below level 6 and one the caller may not touch
    -- are a single answer.
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;

  -- The Member's profile is held FOR SHARE before a roster row names it, so a
  -- concurrent deactivation serializes behind this decision instead of
  -- committing underneath it (conventions section 2).
  perform 1 from public.profiles as target
    where target.id = p_member_id and target.status = 'activ'
    for share of target;
  if not found then
    raise sqlstate 'PT400' using message = 'group_member_not_eligible';
  end if;
  if coalesce(private.actor_level(p_member_id), -1) < v_group.min_level then
    raise sqlstate 'PT400' using message = 'group_member_below_min_level';
  end if;

  -- Shape 5: a Group whose roster follows the rank holds no ordinary rows.
  if p_group_role = 'member' and v_group.automatic_membership then
    raise sqlstate 'PT409' using message = 'automatic_group_has_no_roster_members';
  end if;

  if exists (select 1 from public.group_members as existing
              where existing.group_id = p_group_id
                and existing.member_id = p_member_id) then
    raise sqlstate 'PT409' using message = 'already_group_member';
  end if;

  insert into public.group_members (group_id, member_id, group_role, position_title)
  values (p_group_id, p_member_id, p_group_role, v_title)
  returning * into v_row;

  -- One direct Notification to the TARGET, in the same transaction, never to
  -- the actor (ruling R25 — private.notify drops the actor from the recipient
  -- array by itself, so an actor appointing themselves is told nothing). The
  -- link is the member-facing Group page (#589).
  if p_group_role = 'member' then
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Ai fost adăugat în ' || v_group.name,
      'Faci parte din grupul ' || v_group.name || '.',
      null, null, p_actor, '/grupuri/' || p_group_id::text);
  else
    v_display := coalesce(v_title, nullif(btrim(v_group.manager_title), ''), 'coordonator de grup');
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Numire în ' || v_group.name,
      'Ai fost numit ' || v_display || ' în grupul ' || v_group.name || '.',
      null, null, p_actor, '/grupuri/' || p_group_id::text);
  end if;

  return v_row;
end;
$$;

-- ==================== 2 · set_group_role ====================

create function private.set_group_role_impl(
  p_group_id       bigint,
  p_member_id      uuid,
  p_group_role     text,
  p_position_title text default null
)
returns public.group_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid;
  v_parent_id    bigint;
  v_manager_tier boolean;
  v_group        public.groups%rowtype;
  v_row          public.group_members%rowtype;
  v_current      text;
  v_title        text := nullif(btrim(p_position_title), '');
  v_display      text;
  v_old_display  text;
begin
  -- 1. Malformed for every caller, so it is answered ahead of any authority
  --    verdict (conventions section 2). group_members_role_ck holds the same
  --    vocabulary; group_members_position_title_ck rejects a blank title.
  if p_group_role is null or p_group_role not in ('manager', 'responsible', 'member') then
    raise sqlstate 'PT400' using message = 'invalid_group_role';
  end if;
  if p_position_title is not null and v_title is null then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;
  -- A Group Responsible is always shown under a custom display name
  -- (CONTEXT.md, ADR-0009 Group Roles), so the name is part of the
  -- appointment and not an afterthought. A Group Manager's display name is a
  -- GROUP setting (groups.manager_title — BCE, Coordonator Principal), which
  -- is update_group's to write, and ordinary membership has none: sending
  -- either one a title here is the caller misunderstanding the model, not a
  -- value to silently drop.
  if p_group_role = 'responsible' and v_title is null then
    raise sqlstate 'PT400' using message = 'position_title_required';
  end if;
  if p_group_role <> 'responsible' and v_title is not null then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;

  -- 2. Which tier decides. Read unlocked first: the gate must run before any
  --    lock on public.groups (shape 6), and both inputs it needs — whether
  --    the Group is a root and whether this call grants or removes `manager`
  --    — are re-read under the lock at step 4, where an escalation is caught.
  select grp.parent_id into v_parent_id
    from public.groups as grp where grp.id = p_group_id;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  select existing.group_role into v_current
    from public.group_members as existing
   where existing.group_id = p_group_id and existing.member_id = p_member_id;
  v_manager_tier := p_group_role = 'manager' or coalesce(v_current = 'manager', false);

  -- 3-4. Gate, then locks, then the same question again under them. The loop
  --      runs twice only when the answer changed while the gate ran — a
  --      concurrent promotion to `manager` committing between the unlocked
  --      read and the lock — in which case the STRONGER tier is re-run. The
  --      reverse never needs re-running: a parent's Group Manager holds the
  --      position in every Group below (ADR-0009), and level >= 6 passes
  --      everywhere, so the strong gate always implies the weak one.
  for v_attempt in 1 .. 2 loop
    if v_manager_tier then
      if v_parent_id is null then
        -- A root Group's Managers are BC's and the Moderator's appointment.
        begin
          v_actor := private.require_active_member();
        exception when insufficient_privilege then
          raise exception using errcode = '42501', message = 'group_manage_forbidden';
        end;
        perform 1 from public.profiles as profile
          where profile.id = v_actor and profile.status = 'activ'
          for share of profile;
        if not found then
          raise exception using errcode = '42501', message = 'group_manage_forbidden';
        end if;
        if coalesce(private.actor_level(v_actor), -1) < 6 then
          raise exception using errcode = '42501', message = 'group_manage_forbidden';
        end if;
      else
        -- The PARENT's Managers appoint a Child Group's (shape 1).
        v_actor := private.require_group_manager(v_parent_id);
      end if;
    else
      v_actor := private.require_group_manager(p_group_id);
    end if;

    select grp.* into v_group
      from public.groups as grp
     where grp.id = p_group_id
     for no key update;
    if not found then
      raise exception using errcode = '42501', message = 'group_manage_forbidden';
    end if;
    select existing.* into v_row
      from public.group_members as existing
     where existing.group_id = p_group_id and existing.member_id = p_member_id
     for update of existing;
    v_current := v_row.group_role;

    exit when v_manager_tier
           or not (p_group_role = 'manager' or coalesce(v_current = 'manager', false));
    v_manager_tier := true;
  end loop;

  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;

  -- 5. The write the caller asked for, judged against the loaded row.
  if v_current is null then
    -- No roster row yet: this IS an Appointment, so it goes through the one
    -- insert path (shape 3), which re-checks eligibility and Minimum Level,
    -- answers automatic_group_has_no_roster_members for an ordinary row on an
    -- Automatic-Membership Group, and writes the target's Notification.
    return private.appoint_group_member(
      p_group_id, p_member_id, v_actor, p_group_role, v_title);
  end if;

  if (p_group_role, v_title) is not distinct from (v_current, v_row.position_title) then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- Shape 4: a write that PLACES the Member in a position they do not hold
  --  — any appointment — demands a live, eligible Member; a demotion or a
  -- removal never does, or an inactive Group Manager could be neither demoted
  -- here nor removed by remove_group_member.
  if p_group_role in ('manager', 'responsible') then
    perform 1 from public.profiles as target
      where target.id = p_member_id and target.status = 'activ'
      for share of target;
    if not found then
      raise sqlstate 'PT400' using message = 'group_member_not_eligible';
    end if;
    if coalesce(private.actor_level(p_member_id), -1) < v_group.min_level then
      raise sqlstate 'PT400' using message = 'group_member_below_min_level';
    end if;
  end if;

  v_old_display := coalesce(v_row.position_title,
                            nullif(btrim(v_group.manager_title), ''),
                            'coordonator de grup');

  if p_group_role = 'member' and v_group.automatic_membership then
    -- Shape 5: the row goes rather than becoming an ordinary one. The Member
    -- keeps their place in the Group through the derived roster.
    delete from public.group_members as membership
     where membership.group_id = p_group_id and membership.member_id = p_member_id;
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Numire încheiată în ' || v_group.name,
      'Nu mai ești ' || v_old_display || ' în grupul ' || v_group.name || '.',
      null, null, v_actor, '/grupuri/' || p_group_id::text);
    return null;
  end if;

  update public.group_members as membership
     set group_role     = p_group_role,
         position_title = v_title
   where membership.group_id = p_group_id and membership.member_id = p_member_id
  returning * into v_row;

  if p_group_role = 'member' then
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Numire încheiată în ' || v_group.name,
      'Nu mai ești ' || v_old_display || ' în grupul ' || v_group.name
        || ', dar rămâi membru.',
      null, null, v_actor, '/grupuri/' || p_group_id::text);
  else
    v_display := coalesce(v_title, nullif(btrim(v_group.manager_title), ''), 'coordonator de grup');
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Numire în ' || v_group.name,
      'Ai fost numit ' || v_display || ' în grupul ' || v_group.name || '.',
      null, null, v_actor, '/grupuri/' || p_group_id::text);
  end if;

  return v_row;
end;
$$;

-- ==================== 3 · add_group_member ====================

create function private.add_group_member_impl(
  p_group_id  bigint,
  p_member_id uuid
)
returns public.group_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  -- Appointment is an Entry path a Group RESPONSIBLE holds too (ADR-0009), so
  -- this is the work tier, not #582's Manager tier. Everything after the gate
  -- is the shared core: this function is deliberately nothing but authority.
  v_actor := private.require_group_work_manager(p_group_id);
  return private.appoint_group_member(p_group_id, p_member_id, v_actor);
end;
$$;

-- ==================== 4 · remove_group_member ====================

create function private.remove_group_member_impl(
  p_group_id  bigint,
  p_member_id uuid
)
returns public.group_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_group public.groups%rowtype;
  v_row   public.group_members%rowtype;
begin
  v_actor := private.require_group_work_manager(p_group_id);

  select grp.* into v_group
    from public.groups as grp
   where grp.id = p_group_id
   for no key update;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  select existing.* into v_row
    from public.group_members as existing
   where existing.group_id = p_group_id and existing.member_id = p_member_id
   for update of existing;
  if not found then
    -- PT404 covers "not there" and "not visible" alike (conventions section
    -- 3). An Automatic-Membership Group has no ordinary rows at all, so every
    -- removal there is either this or group_member_holds_role.
    raise sqlstate 'PT404' using message = 'group_member_not_found';
  end if;

  -- This is what replaces the legacy project_members_protect_leader trigger:
  -- a position is ended by the authority that granted it, never by a roster
  -- removal. For a Group Manager that authority is the PARENT's Managers
  -- (shape 1), which is exactly the escalation a silent removal here would
  -- bypass — a Group Responsible could otherwise unseat the Group's Manager.
  if v_row.group_role <> 'member' then
    raise sqlstate 'PT409' using message = 'group_member_holds_role';
  end if;

  delete from public.group_members as membership
   where membership.group_id = p_group_id and membership.member_id = p_member_id;

  perform private.notify(
    array[p_member_id], 'system'::public.noti_kind,
    'Nu mai faci parte din ' || v_group.name,
    'Ai fost eliminat din grupul ' || v_group.name || '.',
    null, null, v_actor, '/grupuri/' || p_group_id::text);

  return v_row;
end;
$$;

-- ==================== 5 · wrappers ====================

create function public.set_group_role(
  p_group_id       bigint,
  p_member_id      uuid,
  p_group_role     text,
  p_position_title text default null
)
returns public.group_members
language sql
security invoker
set search_path = ''
as $$
  select private.set_group_role_impl(p_group_id, p_member_id, p_group_role, p_position_title);
$$;

create function public.add_group_member(p_group_id bigint, p_member_id uuid)
returns public.group_members
language sql
security invoker
set search_path = ''
as $$
  select private.add_group_member_impl(p_group_id, p_member_id);
$$;

create function public.remove_group_member(p_group_id bigint, p_member_id uuid)
returns public.group_members
language sql
security invoker
set search_path = ''
as $$
  select private.remove_group_member_impl(p_group_id, p_member_id);
$$;

-- ==================== 6 · create_group's Manager row joins the one insert path ====================
-- #582 wrote the appointed Manager's roster row itself, with the comment that
-- #583 "shares this shape". Sharing the shape is not enough: the acceptance
-- criterion is that private.appoint_group_member is the ONLY insert path into
-- public.group_members outside migrations' own backfills and rolled-back test
-- fixtures, and group_roster_commands.test.sql enforces it by sweeping every
-- public/private function body. So the body below is main's latest definition
-- with section 6 rewritten to call the core, and nothing else moved.
--
-- Three consequences, all wanted. The core re-checks the Manager's eligibility
-- and Minimum Level, which this function already checked at step 4 with the
-- same two reasons — the checks are the same rules, so the answers cannot
-- diverge, and the earlier pair stays because it must refuse BEFORE the Group
-- row is inserted. The upsert becomes a plain insert: the Group id is one
-- second old and holds no roster row. And the appointed Manager is now
-- notified of the appointment, exactly as set_group_role notifies one — which
-- is what ruling R25 asks for and what #582 could not do before this file
-- existed.
create or replace function private.create_group_impl(
  p_name       text,
  p_category   text,
  p_parent_id  bigint  default null,
  p_min_level  integer default null,
  p_manager_id uuid    default null,
  p_color      text    default null,
  p_short      text    default null
)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid;
  v_actor_level integer;
  v_parent      public.groups%rowtype;
  v_min_level   integer;
  v_created     public.groups%rowtype;
begin
  -- 1. Malformed for every caller, so it is answered ahead of any authority
  --    verdict (conventions section 2). The presentation label is validated
  --    against the same vocabulary groups_category_ck holds, minus
  --    'organization': the Organization marker is a structural setting BC moves
  --    with update_group_structure, never something a create call may claim.
  if p_name is null or p_name !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_group_name';
  end if;
  if p_category is null or p_category not in ('department', 'project', 'team') then
    raise sqlstate 'PT400' using message = 'invalid_group_category';
  end if;
  if p_min_level is not null and p_min_level not in (0, 1, 2, 3, 5, 6, 9) then
    raise sqlstate 'PT400' using message = 'invalid_group_min_level';
  end if;
  if p_color is not null and p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise sqlstate 'PT400' using message = 'invalid_group_color';
  end if;

  -- 2. Authority. A root Group is BC's and the Moderator's alone; a Child
  --    Group belongs to its parent's Managers. Every denial is the same
  --    42501, so an unknown parent, an archived one and one the caller may
  --    not touch are indistinguishable.
  if p_parent_id is null then
    begin
      v_actor := private.require_active_member();
    exception when insufficient_privilege then
      raise exception using errcode = '42501', message = 'group_manage_forbidden';
    end;
    perform 1 from public.profiles as profile
      where profile.id = v_actor and profile.status = 'activ'
      for share of profile;
    if not found then
      raise exception using errcode = '42501', message = 'group_manage_forbidden';
    end if;
    if coalesce(private.actor_level(v_actor), -1) < 6 then
      raise exception using errcode = '42501', message = 'group_manage_forbidden';
    end if;
  else
    -- The parent is a parent row, so it is locked FOR NO KEY UPDATE and never
    -- FOR UPDATE (conventions section 1): the new row's path is derived from
    -- it, two creates under one parent must serialize, and the foreign-key
    -- KEY SHARE every child insert takes must keep flowing.
    select parent.* into v_parent
      from public.groups as parent
     where parent.id = p_parent_id
     for no key update;
    if not found then
      raise exception using errcode = '42501', message = 'group_manage_forbidden';
    end if;
    v_actor := private.require_group_manager(p_parent_id);
    -- Reached only by a level-6 actor: below that, can_manage_group_work has
    -- already refused an archived parent with 42501. An authorized actor gets
    -- the real state conflict instead of a forbidden.
    if v_parent.status <> 'active' then
      raise sqlstate 'PT409' using message = 'group_archived';
    end if;
  end if;

  v_actor_level := private.actor_level(v_actor);
  v_min_level   := coalesce(p_min_level, v_parent.min_level, 0);

  -- 3. Minimum Level, judged against the loaded parent and the live actor.
  if v_parent.id is not null and v_min_level < v_parent.min_level then
    raise sqlstate 'PT400' using message = 'group_min_level_below_parent';
  end if;
  -- Moderator is exempt, as ADR-0009 already rules for Events: nobody else
  -- may put a Group out of their own reach.
  if coalesce(v_actor_level, -1) < 9 and v_min_level > coalesce(v_actor_level, -1) then
    raise sqlstate 'PT400' using message = 'group_min_level_above_actor';
  end if;

  -- 4. The Manager appointed with the Group (ruling R19: create_group is
  --    atomic, like create_project(p_leader_id) was). The profile is held
  --    `for share` before a roster row names it, so a concurrent deactivation
  --    serializes behind the decision. The same two reasons are raised again
  --    by the Appointment core at step 6; they are checked here first because
  --    an ineligible Manager must refuse before the Group row exists.
  if p_manager_id is not null then
    perform 1 from public.profiles as manager
      where manager.id = p_manager_id and manager.status = 'activ'
      for share of manager;
    if not found then
      raise sqlstate 'PT400' using message = 'group_member_not_eligible';
    end if;
    if coalesce(private.actor_level(p_manager_id), -1) < v_min_level then
      raise sqlstate 'PT400' using message = 'group_member_below_min_level';
    end if;
  end if;

  -- 5. Sibling names. The pre-check answers deterministically under the
  --    parent's lock; the exception arm below catches two roots racing, where
  --    there is no parent row to serialize on. groups_parent_name_uidx is
  --    still partial (native Groups only) until #591 dedupes the legacy names,
  --    so the pre-check matches the index exactly rather than being stricter
  --    than the constraint it explains.
  if exists (
    select 1 from public.groups as sibling
     where coalesce(sibling.parent_id, 0) = coalesce(p_parent_id, 0)
       and lower(sibling.name) = lower(btrim(p_name))
       and num_nonnulls(sibling.legacy_dept_id, sibling.legacy_team_id, sibling.legacy_project_id) = 0
  ) then
    raise sqlstate 'PT409' using message = 'group_name_taken';
  end if;

  begin
    insert into public.groups (
      name, category, parent_id, min_level, color, short, created_by
    ) values (
      btrim(p_name), p_category, p_parent_id, v_min_level,
      p_color, nullif(btrim(p_short), ''), v_actor
    )
    returning * into v_created;
  exception when unique_violation then
    raise sqlstate 'PT409' using message = 'group_name_taken';
  end;

  -- 6. The Manager's own roster row, written here so the Group is never
  --    created leaderless in a separate round trip -- and written through
  --    #583's Appointment core, the one insert path into public.group_members,
  --    which also tells the new Group Manager they were appointed.
  if p_manager_id is not null then
    perform private.appoint_group_member(v_created.id, p_manager_id, v_actor, 'manager');
  end if;

  return v_created;
end;
$$;

-- ==================== 7 · comments ====================

comment on function private.appoint_group_member(bigint, uuid, uuid, text, text) is
  'The Appointment core (#583, rulings R6/R27): the ONLY insert path into public.group_members outside migrations'' own backfills, the Wave 1 mirror writers (dropped by #586) and rolled-back test fixtures. It carries no authority check of its own — like private.cancel_event_effect (#582), the gates stay with the callers: private.add_group_member_impl brings the work tier, private.set_group_role_impl the Manager tier, private.create_group_impl the parent''s Managers, and #602''s provisioning the inviting BC''s level, passed as p_actor. What it carries is everything that must be true of the roster row whoever writes it: the Group exists (42501 group_manage_forbidden, non-disclosing) and is active (PT409 group_archived); the Member is live (PT400 group_member_not_eligible — an unknown or inactive target) and at or above the Group''s Minimum Level (PT400 group_member_below_min_level); the Group Role is one of the three (PT400 invalid_group_role) with a display name exactly when it is responsible (PT400 position_title_required / invalid_position_title); an Automatic-Membership Group takes no ordinary row (PT409 automatic_group_has_no_roster_members); and the Member is not already on the roster (PT409 already_group_member). It holds the Group FOR NO KEY UPDATE and the target''s profiles row FOR SHARE, so a concurrent Minimum-Level raise or deactivation serializes behind the decision. It writes exactly one direct system Notification to the target with link /grupuri/<group_id> — added to the Group, or appointed under the position''s display name (the Group Responsible''s own title, or the Group setting groups.manager_title for a Group Manager) — and private.notify drops the actor, so appointing yourself notifies nobody. Executable by no client role.';

comment on function public.set_group_role(bigint, uuid, text, text) is
  'Sets a Member''s Group Role on one Group (#583, ADR-0009 Group Roles). WHO DECIDES DEPENDS ON THE ROLE: granting or removing manager is decided one level up — BC or the Moderator (live level >= 6) for a top-level Group, the PARENT''s Group Managers for a Child Group — while every other change takes private.require_group_manager on the Group itself, so a Group Responsible cannot appoint one. A Group''s own Managers therefore cannot appoint their successors or unseat each other. Malformed input first, for everyone: PT400 invalid_group_role; position_title_required (a Group Responsible is always shown under a custom display name); invalid_position_title (blank, or sent for a Group Manager or an ordinary member — a Manager''s display name is the GROUP setting groups.manager_title, which update_group writes). Then 42501 group_manage_forbidden for every authority refusal including an unknown Group; PT409 group_archived; PT400 group_member_not_eligible / group_member_below_min_level when the call APPOINTS (eligibility binds a write that places a Member in a position, never one that ends it — otherwise an inactive Group Manager could neither be demoted here nor removed by remove_group_member, which refuses anyone holding a position); PT409 nothing_to_update when the Role and display name sent back are the ones already held. On an Automatic-Membership Group, demoting to member DELETES the roster row — the Member stays in the Group through the derived roster — and returns null; asking for member where no row exists is PT409 automatic_group_has_no_roster_members. With no roster row yet the call is an Appointment and goes through private.appoint_group_member, the one insert path. Every successful call writes exactly one direct system Notification to the target with link /grupuri/<group_id>, and none to the actor.';

comment on function public.add_group_member(bigint, uuid) is
  'Adds a Member to a Group as an ordinary member (#583, ADR-0009 Entry paths: Appointment). Authorized by private.require_group_work_manager — Group Managers AND Group Responsibles of the Group or any ancestor, plus BC and the Moderator — because bringing a Member in is a Responsible''s power exactly as accepting an Application is; making one a Group Responsible is not, and goes through set_group_role. Everything after the gate is private.appoint_group_member, the one insert path into public.group_members: 42501 group_manage_forbidden (unknown, archived below level 6, or unauthorized — one answer), PT409 group_archived, PT400 group_member_not_eligible (unknown or inactive target) / group_member_below_min_level, PT409 already_group_member, and PT409 automatic_group_has_no_roster_members, because a Group whose roster follows the rank is joined by having the rank and holds no ordinary rows at all. Writes one direct system Notification to the target with link /grupuri/<group_id>.';

comment on function public.remove_group_member(bigint, uuid) is
  'Removes an ordinary member from a Group (#583, ADR-0009). Same gate as add_group_member — private.require_group_work_manager, Managers and Responsibles. PT404 group_member_not_found when the Member holds no roster row on this Group, which is also every removal attempt on an Automatic-Membership Group, whose ordinary roster is derived and never stored. PT409 group_member_holds_role when the target is a Group Manager or Group Responsible HERE: a position is ended by the authority that granted it, through set_group_role, and for a Group Manager that authority is the parent''s Managers — this is what replaces the legacy project_members_protect_leader trigger, and it is what stops a Group Responsible from unseating the Group''s Manager with a roster call. Removal is never refused for an inactive or below-level target: ADR-0009''s "Membership Status never edits rosters" means such rows exist and must stay removable. Returns the deleted row and writes one direct system Notification to the target with link /grupuri/<group_id>.';

comment on function private.set_group_role_impl(bigint, uuid, text, text) is
  'Body behind public.set_group_role (#583): argument validation, the tier decision (the parent''s Managers for manager, the Group''s own for everything else), the gate-then-locks order, and the insert / update / delete branches with their Notifications. Lock order is gate -> public.groups FOR NO KEY UPDATE -> the target roster row FOR UPDATE, the same order #582''s update commands take; taking the Group before the gate would invert it and deadlock against public.update_group, which holds a Manager''s roster row FOR SHARE and then reaches for the Group. The Group is FOR NO KEY UPDATE rather than FOR UPDATE because this command does not write it — it needs the Minimum Level, status and Automatic Membership it judges the row against to hold still, which is exactly what serializes it against a concurrent Minimum-Level raise.';
comment on function private.add_group_member_impl(bigint, uuid) is
  'Body behind public.add_group_member (#583): the work-tier gate and nothing else — every rule and the Notification live in private.appoint_group_member, so provisioning (#602) and this command cannot drift apart.';
comment on function private.remove_group_member_impl(bigint, uuid) is
  'Body behind public.remove_group_member (#583): the work-tier gate, the target roster row under FOR UPDATE, PT404 group_member_not_found, the PT409 group_member_holds_role refusal that replaces project_members_protect_leader, the delete and the target''s Notification.';

comment on function private.create_group_impl(text, text, bigint, integer, uuid, text, text) is
  'Body behind public.create_group (#582): input validation, the root/parent authority split, Minimum Level against the parent and the actor, the appointed Manager''s eligibility, the sibling-name check and the Group Manager''s roster row. Writes groups.category and is named in conventions.test.sql''s sweep exclusion for it (ruling R16). Never writes groups.parent_id after the insert. Since #583 the Manager''s roster row is written by private.appoint_group_member rather than by an upsert here, so the Appointment core is the only insert path into public.group_members in the whole schema, and the appointed Group Manager is notified of the appointment like any other.';

-- ==================== 8 · grants (conventions section 4, four-role revoke) ====================

-- The Appointment core carries no gate of its own, so nothing outside the
-- definer callers may reach it -- no grant back at all, exactly as with
-- private.cancel_event_effect (#582).
revoke execute on function private.appoint_group_member(bigint, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;

revoke execute on function private.set_group_role_impl(bigint, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function private.add_group_member_impl(bigint, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.remove_group_member_impl(bigint, uuid)
  from public, anon, authenticated, service_role;

grant execute on function private.set_group_role_impl(bigint, uuid, text, text)
  to authenticated;
grant execute on function private.add_group_member_impl(bigint, uuid)
  to authenticated;
grant execute on function private.remove_group_member_impl(bigint, uuid)
  to authenticated;

revoke execute on function public.set_group_role(bigint, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.add_group_member(bigint, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.remove_group_member(bigint, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.set_group_role(bigint, uuid, text, text)
  to authenticated;
grant execute on function public.add_group_member(bigint, uuid)
  to authenticated;
grant execute on function public.remove_group_member(bigint, uuid)
  to authenticated;

-- public.group_members has carried only SELECT for authenticated since #507
-- created it, so conventions section 2's "once a command owns a table's
-- writes" revoke has nothing left to do: these three commands are the first
-- write path the table has ever had from a client.
