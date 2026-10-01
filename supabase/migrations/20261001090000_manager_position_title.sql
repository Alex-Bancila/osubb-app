-- #967: a Group Manager may carry a function name of their own (group_members.position_title on manager rows)
--
-- ADR-0009 §Group Roles, amended 2026-10-01. A Group names its Group Manager
-- position (groups.manager_title -- "Vicepreședinte" for a Department since
-- #957) and, since #962, its Group Responsible position; each Responsible
-- carries a title of their own. The Coordonatori of a Group each have a
-- different function too ("Coordonator Marketing", "Vicepreședinte
-- Educațional") under the same umbrella, so a manager row may now carry one:
--
--   * a responsible row requires a title (PT400 position_title_required), as
--     before;
--   * a manager row MAY carry one -- optional, judged exactly as a
--     Responsible's: blank but not null is PT400 invalid_position_title, over
--     80 characters (measured trimmed, as stored) is PT400
--     position_title_too_long through private.require_text_length;
--   * a member row still must not (PT400 invalid_position_title).
--
-- No new column: group_members.position_title exists for every row, and its
-- two constraints (group_members_position_title_ck, _length_ck) already hold
-- the blank and length rules underneath whatever the role. Nothing else
-- moves: who appoints (one level up for a Manager), the Notification wording
-- (it already named a Manager by the row's own title first, then
-- groups.manager_title, then "coordonator de grup" -- the branch was simply
-- unreachable with a title), and re-titling a sitting Manager through
-- set_group_role, which takes the same update path a Responsible's re-title
-- does. create_group(p_manager_id) and #602's provisioning keep appointing a
-- Manager without a title.
--
-- Bodies rebuilt from main's latest definitions, both in
-- 20260930190000_responsible_title.sql; the one changed line in each is the
-- rule "p_group_role <> 'responsible' and v_title is not null", now
-- "p_group_role = 'member' and v_title is not null", plus the comments that
-- describe it. public.set_group_role's comment, last written in
-- 20260922212333_group_roster_commands.sql, is re-issued so it stops saying
-- a Manager's title is refused. CREATE OR REPLACE keeps every grant.

-- ---------------------------------------------------------------------------
-- set_group_role_impl: a manager row's title is optional.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.set_group_role_impl(p_group_id bigint, p_member_id uuid, p_group_role text, p_position_title text DEFAULT NULL::text)
 RETURNS public.group_members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Security pass 2026-09-27 (L1): group_members_position_title_length_ck.
  perform private.require_text_length('position_title', v_title, null, 80);
  -- A Group Responsible is always shown under a custom display name
  -- (CONTEXT.md, ADR-0009 Group Roles), so the name is part of the
  -- appointment and not an afterthought. A Group Manager's position is named
  -- by a GROUP setting (groups.manager_title — BCE, Coordonator Principal),
  -- which is update_group's to write; since #967 each Manager MAY also carry
  -- a function name of their own under it, judged by the two checks above.
  -- Ordinary membership has none: sending it a title here is the caller
  -- misunderstanding the model, not a value to silently drop.
  if p_group_role = 'responsible' and v_title is null then
    raise sqlstate 'PT400' using message = 'position_title_required';
  end if;
  if p_group_role = 'member' and v_title is not null then
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

  -- #962: a Group Responsible's position is named by their own title, then
  -- by the Group setting groups.responsible_title; a Group Manager's by their
  -- own title (#967), then groups.manager_title.
  if v_current = 'responsible' then
    v_old_display := coalesce(v_row.position_title,
                              nullif(btrim(v_group.responsible_title), ''),
                              'responsabil');
  else
    v_old_display := coalesce(v_row.position_title,
                              nullif(btrim(v_group.manager_title), ''),
                              'coordonator de grup');
  end if;

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
    if p_group_role = 'responsible' then
      v_display := coalesce(v_title, nullif(btrim(v_group.responsible_title), ''), 'responsabil');
    else
      v_display := coalesce(v_title, nullif(btrim(v_group.manager_title), ''), 'coordonator de grup');
    end if;
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Numire în ' || v_group.name,
      'Ai fost numit ' || v_display || ' în grupul ' || v_group.name || '.',
      null, null, v_actor, '/grupuri/' || p_group_id::text);
  end if;

  return v_row;
end;
$function$;

comment on function private.set_group_role_impl(bigint, uuid, text, text) is
  'Body behind public.set_group_role (#583): argument validation, the tier decision (the parent''s Managers for manager, the Group''s own for everything else), the gate-then-locks order, and the insert / update / delete branches with their Notifications. A Group Responsible''s title is required, a Group Manager''s optional (#967), an ordinary row''s refused; a blank one is malformed and one over 80 characters too long, whatever the role. Lock order is gate -> public.groups FOR NO KEY UPDATE -> the target roster row FOR UPDATE, the same order #582''s update commands take; taking the Group before the gate would invert it and deadlock against public.update_group, which holds a Manager''s roster row FOR SHARE and then reaches for the Group. The Group is FOR NO KEY UPDATE rather than FOR UPDATE because this command does not write it — it needs the Minimum Level, status and Automatic Membership it judges the row against to hold still, which is exactly what serializes it against a concurrent Minimum-Level raise. Its Notifications name the position a Member takes or leaves (#962): a Group Responsible by their own title, then the Group setting groups.responsible_title, then "responsabil"; a Group Manager by their own title (#967), then groups.manager_title, then "coordonator de grup".';

comment on function public.set_group_role(bigint, uuid, text, text) is
  'Sets a Member''s Group Role on one Group (#583, ADR-0009 Group Roles). WHO DECIDES DEPENDS ON THE ROLE: granting or removing manager is decided one level up — BC or the Moderator (live level >= 6) for a top-level Group, the PARENT''s Group Managers for a Child Group — while every other change takes private.require_group_manager on the Group itself, so a Group Responsible cannot appoint one. A Group''s own Managers therefore cannot appoint their successors or unseat each other. Malformed input first, for everyone: PT400 invalid_group_role; position_title_required (a Group Responsible is always shown under a custom display name); invalid_position_title (blank, or sent for an ordinary member — a Group Manager MAY carry a function name of their own under the GROUP setting groups.manager_title, #967); position_title_too_long (over 80 characters, measured trimmed). Then 42501 group_manage_forbidden for every authority refusal including an unknown Group; PT409 group_archived; PT400 group_member_not_eligible / group_member_below_min_level when the call APPOINTS (eligibility binds a write that places a Member in a position, never one that ends it — otherwise an inactive Group Manager could neither be demoted here nor removed by remove_group_member, which refuses anyone holding a position); PT409 nothing_to_update when the Role and display name sent back are the ones already held, so re-titling a sitting Manager or Responsible is the same call with a new title. On an Automatic-Membership Group, demoting to member DELETES the roster row — the Member stays in the Group through the derived roster — and returns null; asking for member where no row exists is PT409 automatic_group_has_no_roster_members. With no roster row yet the call is an Appointment and goes through private.appoint_group_member, the one insert path. Every successful call writes exactly one direct system Notification to the target with link /grupuri/<group_id>, and none to the actor.';

-- ---------------------------------------------------------------------------
-- appoint_group_member: the same rule on the one insert path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.appoint_group_member(p_group_id bigint, p_member_id uuid, p_actor uuid, p_group_role text DEFAULT 'member'::text, p_position_title text DEFAULT NULL::text, p_notify boolean DEFAULT true)
 RETURNS public.group_members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Security pass 2026-09-27 (L1): group_members_position_title_length_ck.
  perform private.require_text_length('position_title', v_title, null, 80);
  -- #967: a Responsible's title is required, a Manager's optional, an
  -- ordinary row's refused.
  if p_group_role = 'responsible' and v_title is null then
    raise sqlstate 'PT400' using message = 'position_title_required';
  end if;
  if p_group_role = 'member' and v_title is not null then
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

  -- #861 (Audit D-20): a caller whose own Notification already tells the
  -- target (decide_group_application's "Cerere acceptată: <Group>") passes
  -- p_notify => false, so the target hears about one decision once. Every
  -- other caller keeps the default and this Notification.
  if p_notify is false then
    return v_row;
  end if;

  -- One direct Notification to the TARGET, in the same transaction, never to
  -- the actor (ruling R25 — private.notify drops the actor from the recipient
  -- array by itself, so an actor appointing themselves is told nothing). The
  -- link is the member-facing Group page (#589).
  if p_group_role = 'member' then
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Ai fost adăugat în ' || v_group.name,
      -- #843 (B36): the title says it all.
      null,
      null, null, p_actor, '/grupuri/' || p_group_id::text);
  else
    -- #962: the position's display name -- a Group Responsible's own title,
    -- then the Group setting groups.responsible_title; a Group Manager's own
    -- title (#967), then groups.manager_title.
    if p_group_role = 'responsible' then
      v_display := coalesce(v_title, nullif(btrim(v_group.responsible_title), ''), 'responsabil');
    else
      v_display := coalesce(v_title, nullif(btrim(v_group.manager_title), ''), 'coordonator de grup');
    end if;
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Numire în ' || v_group.name,
      'Ai fost numit ' || v_display || ' în grupul ' || v_group.name || '.',
      null, null, p_actor, '/grupuri/' || p_group_id::text);
  end if;

  return v_row;
end;
$function$;

comment on function private.appoint_group_member(bigint, uuid, uuid, text, text, boolean) is
  'The Appointment core (#583, rulings R6/R27): the ONLY insert path into public.group_members outside migrations'' own backfills, the Wave 1 mirror writers (dropped by #586) and rolled-back test fixtures. It carries no authority check of its own — like private.cancel_event_effect (#582), the gates stay with the callers: private.add_group_member_impl brings the work tier, private.set_group_role_impl the Manager tier, private.create_group_impl the parent''s Managers, and #602''s provisioning the inviting BC''s level, passed as p_actor. What it carries is everything that must be true of the roster row whoever writes it: the Group exists (42501 group_manage_forbidden, non-disclosing) and is active (PT409 group_archived); the Member is live (PT400 group_member_not_eligible — an unknown or inactive target) and at or above the Group''s Minimum Level (PT400 group_member_below_min_level); the Group Role is one of the three (PT400 invalid_group_role) with a display name required for responsible, optional for manager (#967) and refused for member (PT400 position_title_required / invalid_position_title; a blank one is invalid_position_title and one over 80 characters position_title_too_long, whatever the role); an Automatic-Membership Group takes no ordinary row (PT409 automatic_group_has_no_roster_members); and the Member is not already on the roster (PT409 already_group_member). It holds the Group FOR NO KEY UPDATE and the target''s profiles row FOR SHARE, so a concurrent Minimum-Level raise or deactivation serializes behind the decision. It writes exactly one direct system Notification to the target with link /grupuri/<group_id> — added to the Group, or appointed under the position''s display name (a Group Responsible''s own title, then the Group setting groups.responsible_title (#962), then "responsabil"; a Group Manager''s own title (#967), then the Group setting groups.manager_title, then "coordonator de grup") — and private.notify drops the actor, so appointing yourself notifies nobody. With p_notify => false it writes none (#861, Audit D-20): private.decide_group_application_impl passes it because its own "Cerere acceptată: <Group>" already tells the applicant. Executable by no client role.';
