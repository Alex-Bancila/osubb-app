-- #582: the Group structure commands (ADR-0009 Wave 3, T9) — create_group,
-- update_group, update_group_structure, archive_group — plus the Manager tier
-- of the authority kit, private.require_group_manager.
--
-- Until now `public.groups` had no client write path at all: Wave 1 made it a
-- read-only shadow of the six legacy structure tables and Wave 2 made every
-- authority decision read it. These four commands are the first writers a
-- human can reach, and they are what #583 (roster), #584 (Applications), #627
-- (changing a Task's Group) and #588 (Administrare) are built on.
--
-- Three shapes are worth stating once, here, rather than re-deriving them at
-- every call site below.
--
-- 1. WHO OWNS WHICH SETTING (Decision 5 of the Wave 3 plan). Structural
--    settings — the presentation label, both Cup flags, Automatic Membership,
--    colour and short name, the Organization marker, and a TOP-LEVEL Group's
--    Minimum Level — belong to BC and the Moderator, and live in
--    `update_group_structure`. Operational settings — name, the Group
--    Manager's display name, Accepts Applications with its Application Level,
--    Shared Work Visibility, and a CHILD Group's Minimum Level — belong to
--    the Group's own Managers and live in `update_group`. The two commands are
--    mirror images on Minimum Level: `update_group` refuses a root's change
--    below level 6, `update_group_structure` refuses a child's outright. Both
--    refusals are the same non-disclosing `42501 group_manage_forbidden`.
--
-- 2. THE MANAGER TIER (ruling R19). `private.require_group_work_manager`
--    admits Group Responsibles, which is right for work — Tasks, Events,
--    Campaigns — and wrong here: a Responsible must not create Child Groups or
--    (in #583) appoint Managers. `private.require_group_manager` is
--    `require_group_work_manager` followed, below level 6, by
--    `private.is_group_manager`. It reuses the work tier deliberately: the
--    lock discipline, the live re-read after a wait and the single reason
--    string are already correct there, and a second copy would drift.
--
-- 3. A GROUP'S PARENT IS CHOSEN AT CREATION AND NEVER CHANGES (ruling R20,
--    ADR-0009 amended 2026-09-20). There is no `move_group` and there will be
--    none: a wrongly placed Group is archived and created again. That is what
--    keeps Department Cup attribution honest, because #523's standings walk
--    each Task's live `groups.path` and no path ever moves underneath them.
--    `private.validate_group_path`'s UPDATE arm and `private.cascade_group_path`
--    stay in the schema as tripwires, not as machinery: nothing in this file
--    writes `groups.parent_id` after the insert, and #595 adds the conventions
--    assertion that nothing anywhere does.
--
-- One interaction with the surviving mirror, stated rather than discovered in
-- staging: a Group whose `legacy_*` column is set is still mastered by its
-- legacy row. `private.sync_project_groups` refreshes a Project Group's `name`
-- and `status` on every write to `public.projects`, and the Department and Team
-- mirrors refresh `name` the same way, so a change made here to a legacy-mapped
-- Group can be undone by the next legacy write. These commands are not refused
-- on such a Group — #587 re-expresses the seed through them and #585/#586
-- retire the legacy commands and the mirror shortly after — but until then,
-- point them at native Groups and change a legacy-mapped one through the
-- command that owns its legacy row. `docs/backend/conventions.md` §10 says the
-- same in the one place a migration author looks.
--
-- Deferred on purpose, recorded so it is not forgotten: `public.group_applications`
-- does not exist until #584, so `archive_group` cannot yet decline the subtree's
-- pending Applications and the two update commands cannot yet withdraw the
-- Applications of a Member a raised Minimum Level removes. #584's implementer
-- replaces those bodies (ruling R30); each `comment on function` below says so.

-- ==================== 1 · the Manager tier of the authority kit ====================

create function private.require_group_manager(p_group_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  -- The work tier first: it holds the actor's profile and the deciding roster
  -- rows `for share` through the transaction, re-reads authority after any
  -- wait, and answers every denial with the one non-disclosing reason. An
  -- unknown or archived Group is refused there, below level 6, because
  -- private.can_manage_group_work requires a live row with status 'active'.
  v_actor := private.require_group_work_manager(p_group_id);

  -- BC and Moderator are Managers everywhere (ADR-0009 Authority matrix).
  if private.actor_level(v_actor) >= 6 then
    return v_actor;
  end if;

  -- Below level 6 the work tier's Responsible arm is not enough. This is the
  -- whole difference between the two helpers, and it is re-read live rather
  -- than inferred from the call above.
  if not coalesce(private.is_group_manager(p_group_id), false) then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  return v_actor;
end;
$$;

comment on function private.require_group_manager(bigint) is
  'Manager tier of the Group authority kit (#582, ADR-0009 ruling R19): private.require_group_work_manager and then, below level 6, private.is_group_manager, so a Group Responsible is admitted to the Group''s work but not to its structure. Returns the live actor or raises the single non-disclosing 42501 group_manage_forbidden — unknown, archived and unauthorized are one answer. Inherits the work tier''s locks: the actor''s profiles row and the deciding group_members rows for share, never a share lock on a groups row.';

-- ==================== 2 · create_group ====================

create function private.create_group_impl(
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
  --    serializes behind the decision.
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
  --    created leaderless in a separate round trip. An upsert rather than an
  --    insert because #583 shares this shape and a Group id is new here only
  --    by construction, not by contract.
  if p_manager_id is not null then
    insert into public.group_members (group_id, member_id, group_role)
    values (v_created.id, p_manager_id, 'manager')
    on conflict (group_id, member_id) do update
       set group_role = 'manager';
  end if;

  return v_created;
end;
$$;

-- ==================== 3 · update_group (operational settings) ====================

create function private.update_group_impl(
  p_group_id               bigint,
  p_name                   text,
  p_manager_title          text,
  p_accepts_applications   boolean,
  p_application_level      integer,
  p_shared_work_visibility boolean,
  p_min_level              integer,
  p_confirm_removals       boolean default false
)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid;
  v_actor_level integer;
  v_group       public.groups%rowtype;
  v_parent      public.groups%rowtype;
  v_accepts     boolean := coalesce(p_accepts_applications, false);
  v_shared      boolean := coalesce(p_shared_work_visibility, false);
  v_title       text    := nullif(btrim(p_manager_title), '');
  v_updated     public.groups%rowtype;
  v_below       uuid[];
  v_removed     uuid[];
  v_managers    uuid[];
begin
  -- 1. Malformed for every caller: every check here compares arguments with
  --    each other, so none of them needs the loaded row to be meaningful.
  if p_name is null or p_name !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_group_name';
  end if;
  if p_manager_title is not null and p_manager_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;
  if p_min_level is null or p_min_level not in (0, 1, 2, 3, 5, 6, 9) then
    raise sqlstate 'PT400' using message = 'invalid_group_min_level';
  end if;
  -- groups_applications_shape_ck and groups_application_level_ck would both
  -- surface as a raw 23514 otherwise. A Group that accepts Applications must
  -- name the level, and the level itself is a rank like any other.
  if p_application_level is not null and p_application_level not in (0, 1, 2, 3, 5, 6, 9) then
    raise sqlstate 'PT400' using message = 'invalid_application_level';
  end if;
  if v_accepts and p_application_level is null then
    raise sqlstate 'PT400' using message = 'invalid_application_level';
  end if;
  if p_application_level is not null and p_application_level < p_min_level then
    raise sqlstate 'PT400' using message = 'application_level_below_min_level';
  end if;

  -- 2. Authority: the Group's own Managers, not its Responsibles.
  v_actor := private.require_group_manager(p_group_id);
  v_actor_level := private.actor_level(v_actor);

  -- 3. The target under its own lock.
  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  -- 4. The structural half of the split (Decision 5). A top-level Group's
  --    Minimum Level is BC's and the Moderator's; its Managers own every other
  --    setting in this command. The mirror image lives in
  --    update_group_structure, which refuses a CHILD's Minimum Level change.
  --    Authority is answered before state, and with the same non-disclosing
  --    reason as every other refusal here.
  if v_group.parent_id is null
     and p_min_level is distinct from v_group.min_level
     and coalesce(v_actor_level, -1) < 6 then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;

  -- An Automatic-Membership Group has no way to accept an Application: its
  -- roster follows the rank (ADR-0009 Groups settings), which is what
  -- groups_automatic_no_applications_ck says in the schema. Without this the
  -- command would let a raw 23514 out, and conventions section 3 reads a 23514
  -- escaping a command as a bug rather than an answer. Switching Automatic
  -- Membership itself is structural, so the mirror of this check lives in
  -- update_group_structure.
  if v_accepts and v_group.automatic_membership then
    raise sqlstate 'PT409' using message = 'automatic_group_accepts_no_applications';
  end if;

  -- 5. Minimum Level against the tree and the actor. The parent is a parent
  --    row: FOR NO KEY UPDATE, never FOR UPDATE.
  if v_group.parent_id is not null then
    select parent.* into v_parent
      from public.groups as parent
     where parent.id = v_group.parent_id
     for no key update;
    if v_parent.id is not null and p_min_level < v_parent.min_level then
      raise sqlstate 'PT400' using message = 'group_min_level_below_parent';
    end if;
  end if;
  if exists (select 1 from public.groups as child
              where child.parent_id = p_group_id and child.min_level < p_min_level) then
    raise sqlstate 'PT400' using message = 'group_min_level_above_children';
  end if;
  if coalesce(v_actor_level, -1) < 9 and p_min_level > coalesce(v_actor_level, -1) then
    raise sqlstate 'PT400' using message = 'group_min_level_above_actor';
  end if;

  if exists (
    select 1 from public.groups as sibling
     where sibling.id <> p_group_id
       and coalesce(sibling.parent_id, 0) = coalesce(v_group.parent_id, 0)
       and lower(sibling.name) = lower(btrim(p_name))
       and num_nonnulls(sibling.legacy_dept_id, sibling.legacy_team_id, sibling.legacy_project_id) = 0
  ) then
    raise sqlstate 'PT409' using message = 'group_name_taken';
  end if;

  -- 6. Full-state replace (conventions OD5): every column this command owns is
  --    written from its argument, so a null CLEARS a nullable column. A caller
  --    that sends the state back unchanged is told so rather than bumping
  --    updated_at and fanning out for nothing.
  if (btrim(p_name), v_title, v_accepts, p_application_level, v_shared, p_min_level)
     is not distinct from
     (v_group.name, v_group.manager_title, v_group.accepts_applications,
      v_group.application_level, v_group.shared_work_visibility, v_group.min_level) then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- 7. A raised Minimum Level ends the membership of everyone below it
  --    (ruling R23). Rank, not Membership Status, decides: a deactivated
  --    Member keeps their rank and their roster rows (R22), and #586's
  --    invariant is about the rank a Group demands. Descendants are never
  --    touched — step 5 has already refused a level above a child's.
  select array_agg(membership.member_id order by membership.member_id)
    into v_below
    from public.group_members as membership
    join public.profiles as profile on profile.id = membership.member_id
    join public.roles as role on role.id = profile.role
   where membership.group_id = p_group_id
     and role.level < p_min_level;

  if v_below is not null then
    if not coalesce(p_confirm_removals, false) then
      -- The count rides in DETAIL, not in MESSAGE: conventions section 3 makes
      -- the message the snake_case reason and the frontend normalizes on it,
      -- so a count spliced into the message would make the reason unmatchable.
      raise sqlstate 'PT409' using
        message = 'group_has_members_below_level',
        detail  = cardinality(v_below)::text;
    end if;

    perform 1 from public.group_members as membership
      where membership.group_id = p_group_id
        and membership.member_id = any (v_below)
      order by membership.member_id
      for update of membership;

    delete from public.group_members as membership
     where membership.group_id = p_group_id
       and membership.member_id = any (v_below);
    v_removed := v_below;
  end if;

  update public.groups
     set name                   = btrim(p_name),
         manager_title          = v_title,
         accepts_applications   = v_accepts,
         application_level      = p_application_level,
         shared_work_visibility = v_shared,
         min_level              = p_min_level
   where id = p_group_id
  returning * into v_updated;

  if v_removed is not null then
    -- The removed Members are told directly, with no link: they cannot read
    -- the Group any more, so a Group link would open on nothing.
    perform private.notify(
      v_removed, 'system'::public.noti_kind,
      'Nu mai faci parte din ' || v_updated.name,
      'Nivelul minim al grupului ' || v_updated.name
        || ' a fost ridicat, așa că nu mai faci parte din el.',
      null, null, v_actor);
    select array_agg(manager) into v_managers
      from private.group_managers(p_group_id) as manager;
    perform private.notify(
      v_managers, 'system'::public.noti_kind,
      'Nivel minim actualizat: ' || v_updated.name,
      cardinality(v_removed)::text || ' membri au fost eliminați din '
        || v_updated.name || ' după ridicarea nivelului minim.',
      null, null, v_actor, '/administrare/grupuri/' || p_group_id::text);
  end if;

  return v_updated;
end;
$$;

-- ==================== 4 · update_group_structure (BC/Moderator settings) ====================

create function private.update_group_structure_impl(
  p_group_id                 bigint,
  p_category                 text,
  p_competes_in_cup          boolean,
  p_counts_toward_parent_cup boolean,
  p_automatic_membership     boolean,
  p_min_level                integer,
  p_color                    text,
  p_short                    text,
  p_is_organization          boolean,
  p_confirm_removals         boolean default false
)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid;
  v_actor_level integer;
  v_group       public.groups%rowtype;
  v_parent      public.groups%rowtype;
  v_competes    boolean := coalesce(p_competes_in_cup, false);
  v_counts      boolean := coalesce(p_counts_toward_parent_cup, true);
  v_automatic   boolean := coalesce(p_automatic_membership, false);
  v_is_org      boolean := coalesce(p_is_organization, false);
  v_short       text    := nullif(btrim(p_short), '');
  v_updated     public.groups%rowtype;
  v_below       uuid[];
  v_removed     uuid[];
  v_managers    uuid[];
begin
  -- 1. Malformed for every caller. 'organization' is accepted here and refused
  --    by create_group: BC labels the one Organization Group after the fact,
  --    nobody claims the label at creation.
  if p_category is null
     or p_category not in ('department', 'project', 'team', 'organization') then
    raise sqlstate 'PT400' using message = 'invalid_group_category';
  end if;
  if p_min_level is null or p_min_level not in (0, 1, 2, 3, 5, 6, 9) then
    raise sqlstate 'PT400' using message = 'invalid_group_min_level';
  end if;
  if p_color is not null and p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise sqlstate 'PT400' using message = 'invalid_group_color';
  end if;

  -- 2. Authority: structure is BC's and the Moderator's, everywhere.
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
  v_actor_level := private.actor_level(v_actor);
  if coalesce(v_actor_level, -1) < 6 then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  -- 3. The operational half of the split (Decision 5), mirror image of
  --    update_group's: a CHILD Group's Minimum Level belongs to its Managers,
  --    who set it within [the parent's, their own Level] through update_group.
  --    BC changes a root's here and nothing else's.
  if v_group.parent_id is not null
     and p_min_level is distinct from v_group.min_level then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;

  -- 4. Settings that are only judgeable against the loaded row.
  if v_competes and v_group.parent_id is not null then
    raise sqlstate 'PT409' using message = 'cup_not_top_level';
  end if;
  if v_is_org and exists (select 1 from public.groups as other
                           where other.is_organization and other.id <> p_group_id) then
    -- groups_one_organization_uidx forbids a second marker; the marker is
    -- moved by clearing the old Group first, never by two writers racing.
    raise sqlstate 'PT409' using message = 'organization_group_exists';
  end if;
  if v_automatic and not v_group.automatic_membership
     and exists (select 1 from public.group_members as membership
                  where membership.group_id = p_group_id
                    and membership.group_role = 'member') then
    -- private.validate_group_hierarchy raises the same fact as a 23514; a
    -- command answers it as a state conflict the caller can act on.
    raise sqlstate 'PT409' using message = 'automatic_group_has_roster_members';
  end if;
  -- The mirror of update_group's check: a Group whose roster follows the rank
  -- accepts no Applications (groups_automatic_no_applications_ck).
  if v_automatic and v_group.accepts_applications then
    raise sqlstate 'PT409' using message = 'automatic_group_accepts_no_applications';
  end if;

  if v_group.parent_id is not null then
    select parent.* into v_parent
      from public.groups as parent
     where parent.id = v_group.parent_id
     for no key update;
    if v_parent.id is not null and p_min_level < v_parent.min_level then
      raise sqlstate 'PT400' using message = 'group_min_level_below_parent';
    end if;
  end if;
  if exists (select 1 from public.groups as child
              where child.parent_id = p_group_id and child.min_level < p_min_level) then
    raise sqlstate 'PT400' using message = 'group_min_level_above_children';
  end if;
  if coalesce(v_actor_level, -1) < 9 and p_min_level > coalesce(v_actor_level, -1) then
    raise sqlstate 'PT400' using message = 'group_min_level_above_actor';
  end if;

  if (p_category, v_competes, v_counts, v_automatic, p_min_level, p_color, v_short, v_is_org)
     is not distinct from
     (v_group.category, v_group.competes_in_cup, v_group.counts_toward_parent_cup,
      v_group.automatic_membership, v_group.min_level, v_group.color,
      v_group.short, v_group.is_organization) then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- 5. The same Minimum-Level removal as update_group (ruling R23), behind the
  --    same explicit confirmation, so a stale settings form can never delete a
  --    roster row by accident.
  select array_agg(membership.member_id order by membership.member_id)
    into v_below
    from public.group_members as membership
    join public.profiles as profile on profile.id = membership.member_id
    join public.roles as role on role.id = profile.role
   where membership.group_id = p_group_id
     and role.level < p_min_level;

  if v_below is not null then
    if not coalesce(p_confirm_removals, false) then
      raise sqlstate 'PT409' using
        message = 'group_has_members_below_level',
        detail  = cardinality(v_below)::text;
    end if;

    perform 1 from public.group_members as membership
      where membership.group_id = p_group_id
        and membership.member_id = any (v_below)
      order by membership.member_id
      for update of membership;

    delete from public.group_members as membership
     where membership.group_id = p_group_id
       and membership.member_id = any (v_below);
    v_removed := v_below;
  end if;

  update public.groups
     set category                 = p_category,
         competes_in_cup          = v_competes,
         counts_toward_parent_cup = v_counts,
         automatic_membership     = v_automatic,
         min_level                = p_min_level,
         color                    = p_color,
         short                    = v_short,
         is_organization          = v_is_org
   where id = p_group_id
  returning * into v_updated;

  if v_removed is not null then
    perform private.notify(
      v_removed, 'system'::public.noti_kind,
      'Nu mai faci parte din ' || v_updated.name,
      'Nivelul minim al grupului ' || v_updated.name
        || ' a fost ridicat, așa că nu mai faci parte din el.',
      null, null, v_actor);
    select array_agg(manager) into v_managers
      from private.group_managers(p_group_id) as manager;
    perform private.notify(
      v_managers, 'system'::public.noti_kind,
      'Nivel minim actualizat: ' || v_updated.name,
      cardinality(v_removed)::text || ' membri au fost eliminați din '
        || v_updated.name || ' după ridicarea nivelului minim.',
      null, null, v_actor, '/administrare/grupuri/' || p_group_id::text);
  end if;

  return v_updated;
end;
$$;

-- ==================== 4b · the Event cancellation EFFECT, shared by two callers ====================
-- One definition, two readers. `private.cancel_event_impl` is a command: it
-- decides whether THIS actor may cancel THIS Event, which includes whether the
-- actor can see it at all (below its Minimum Level, the answer is PT404
-- event_not_found -- hidden is never distinguishable from missing).
-- `private.archive_group_impl` is not asking that question. The authority for
-- cancelling a subtree's future Events is the GROUP, which the archiver has
-- already passed `require_group_manager` on, and archiving cancels every future
-- Event below it whatever the archiver's own rank: a Group Manager at level 1
-- archiving a Group that holds an Event a BC raised to Minimum Level 6 is not a
-- visibility problem, and answering them `event_not_found` would abort the whole
-- archive with a reason that names neither the Group nor the real cause.
--
-- So the EFFECT -- the write and the fan-out -- lives here with no gate of its
-- own, and each caller brings its own authority. The actor is a parameter
-- rather than auth.uid() because the effect is attributed to whoever decided
-- it, and `private.notify` uses it to keep the decision from echoing back to
-- its author. The Event row and every event_attendance row survive (ADR-0008:
-- cancellation preserves RSVP history).
create function private.cancel_event_effect(
  p_event_id bigint,
  p_reason   text,
  p_actor    uuid
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated    public.events%rowtype;
  v_recipients uuid[];
begin
  update public.events
     set cancelled_at = clock_timestamp(),
         cancel_reason = btrim(p_reason)
   where id = p_event_id
  returning * into v_updated;
  if not found then
    return null;
  end if;
  select array_agg(recipient) into v_recipients
    from private.event_notification_recipients(p_event_id) as recipient;
  perform private.notify(v_recipients, 'event', 'Eveniment anulat: ' || v_updated.title,
    v_updated.cancel_reason, null, 'event:' || p_event_id::text || ':cancelled', p_actor, '/calendar');
  return v_updated;
end;
$$;

comment on function private.cancel_event_effect(bigint, text, uuid) is
  'The effect of cancelling an Event with no gate of its own (#582): the write (cancelled_at + the trimmed reason, which events_cancel_reason_ck requires together) and the fan-out to private.event_notification_recipients under dedupe key event:<id>:cancelled with link /calendar. Two callers bring their own authority -- private.cancel_event_impl, which decides whether this actor may cancel this Event and therefore also whether they can see it, and private.archive_group_impl, which does not ask that question at all: the authority there is the Group the archiver already passed require_group_manager on, so archiving cancels every future Event of the subtree whatever the archiver''s own Level. Executable by no client role.';

-- ==================== 5 · archive_group ====================

create function private.archive_group_impl(p_group_id bigint)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid;
  v_group    public.groups%rowtype;
  v_updated  public.groups%rowtype;
  v_event_id bigint;
begin
  -- 1. The target under its own lock, before anything is decided about it.
  --    A missing Group is the same 42501 as one the caller may not archive.
  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  -- 2. Authority. A top-level Group is BC's and the Moderator's — a
  --    Department's own Manager does not get to retire the Department. A Child
  --    Group belongs to its Managers (Decision 5).
  if v_group.parent_id is null then
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
    v_actor := private.require_group_manager(p_group_id);
  end if;

  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_already_archived';
  end if;

  -- 3. The descendants, locked FOR NO KEY UPDATE in ascending id — the mode
  --    every non-target groups row takes in this repo (conventions section 1),
  --    and the order that keeps two archives of overlapping subtrees in one
  --    sequence. groups.path contains the row's own id, so the target is
  --    excluded here: it is already held FOR UPDATE above.
  perform 1
     from public.groups as descendant
    where descendant.path @> array[p_group_id]
      and descendant.id <> p_group_id
    order by descendant.id
    for no key update;

  -- 4. Archiving never cancels a Task (ruling R21). While the subtree still
  --    holds work with an executor — or a Completed-work Request nobody has
  --    decided — the Manager finishes or cancels it first, with the reasons
  --    the Tracker already demands. This is checked before anything is
  --    settled, so a refusal leaves the subtree exactly as it was.
  if exists (
    select 1
      from public.tasks as task
      join public.groups as owner on owner.id = task.group_id
     where owner.path @> array[p_group_id]
       and task.status not in ('completed', 'unfulfilled', 'cancelled')
  ) or exists (
    select 1
      from public.completed_work_requests as request
      join public.groups as owner on owner.id = request.group_id
     where owner.path @> array[p_group_id]
       and request.status = 'pending'
  ) then
    raise sqlstate 'PT409' using message = 'group_has_open_work';
  end if;

  -- 5. What has no executor is settled here, in the same transaction. Every
  --    future Event of the subtree is cancelled with the archive as its reason
  --    (ADR-0008 cancellation semantics: the row and its RSVP history
  --    survive); past Events stay as history.
  --
  --    This calls the EFFECT (section 4b), never private.cancel_event_impl.
  --    That implementation is a command and re-decides authority per Event
  --    from the ACTOR: it would refuse a Group Manager who did not create an
  --    Organization Event, and — worse — answer PT404 event_not_found for any
  --    Event raised above the archiver's own Minimum Level, aborting the whole
  --    archive with a reason that names neither the Group nor the real cause.
  --    The authority here is the GROUP, which this actor passed
  --    require_group_manager on at step 2, so no Event-visibility rule applies
  --    inside the cascade and no new error code is minted for the difference.
  --
  --    The rows are locked `for no key update` — the Event lock mode every
  --    Calendar command takes — in ascending id, so a concurrent cancel cannot
  --    commit underneath the loop and have its reason overwritten. Only the
  --    Events are locked; the joined `groups` rows are read.
  for v_event_id in
    select event.id
      from public.events as event
      join public.groups as owner on owner.id = event.group_id
     where owner.path @> array[p_group_id]
       and event.cancelled_at is null
       and event.starts_at > now()
     order by event.id
     for no key update of event
  loop
    perform private.cancel_event_effect(v_event_id, 'Grup arhivat', v_actor);
  end loop;

  -- 6. One statement for the whole subtree (ruling R19). can_manage_group_work
  --    reads the TARGET Group's status only, so a live Child Group under an
  --    archived parent would otherwise stay manageable — the cascade is the
  --    invariant, not a convenience.
  update public.groups
     set status = 'archived'
   where path @> array[p_group_id];

  select * into v_updated from public.groups where id = p_group_id;
  return v_updated;
end;
$$;

-- ==================== 6 · wrappers ====================

create function public.create_group(
  p_name       text,
  p_category   text,
  p_parent_id  bigint  default null,
  p_min_level  integer default null,
  p_manager_id uuid    default null,
  p_color      text    default null,
  p_short      text    default null
)
returns public.groups
language sql
security invoker
set search_path = ''
as $$
  select private.create_group_impl(
    p_name, p_category, p_parent_id, p_min_level, p_manager_id, p_color, p_short);
$$;

create function public.update_group(
  p_group_id               bigint,
  p_name                   text,
  p_manager_title          text,
  p_accepts_applications   boolean,
  p_application_level      integer,
  p_shared_work_visibility boolean,
  p_min_level              integer,
  p_confirm_removals       boolean default false
)
returns public.groups
language sql
security invoker
set search_path = ''
as $$
  select private.update_group_impl(
    p_group_id, p_name, p_manager_title, p_accepts_applications,
    p_application_level, p_shared_work_visibility, p_min_level, p_confirm_removals);
$$;

create function public.update_group_structure(
  p_group_id                 bigint,
  p_category                 text,
  p_competes_in_cup          boolean,
  p_counts_toward_parent_cup boolean,
  p_automatic_membership     boolean,
  p_min_level                integer,
  p_color                    text,
  p_short                    text,
  p_is_organization          boolean,
  p_confirm_removals         boolean default false
)
returns public.groups
language sql
security invoker
set search_path = ''
as $$
  select private.update_group_structure_impl(
    p_group_id, p_category, p_competes_in_cup, p_counts_toward_parent_cup,
    p_automatic_membership, p_min_level, p_color, p_short, p_is_organization,
    p_confirm_removals);
$$;

create function public.archive_group(p_group_id bigint)
returns public.groups
language sql
security invoker
set search_path = ''
as $$
  select private.archive_group_impl(p_group_id);
$$;

-- ==================== 7 · the Organization marker replaces legacy_dept_id = 'org' ====================
-- #574 added groups.is_organization and backfilled it; the three Event
-- commands were left reading the legacy id so the two changes could land in
-- separate reviews. This is that second change, and it is what lets #591 drop
-- groups.legacy_*. Each body below is main's latest definition with the single
-- Organization test rewritten — nothing else moves.

create or replace function private.create_event_impl(
  p_title text, p_type text, p_group_id bigint, p_starts_at timestamptz,
  p_ends_at timestamptz default null, p_location text default null,
  p_capacity integer default null, p_description text default null, p_min_level integer default 0
)
returns public.events
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_level integer;
  v_group public.groups%rowtype;
  v_created public.events%rowtype;
begin
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_event_title';
  end if;
  if p_type is null or p_type not in ('sedinta','activitate','call','eveniment','deadline','recrutare') then
    raise sqlstate 'PT400' using message = 'invalid_event_type';
  end if;
  if p_starts_at is null or (p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise sqlstate 'PT400' using message = 'invalid_event_interval';
  end if;
  if p_capacity is not null and p_capacity <= 0 then
    raise sqlstate 'PT400' using message = 'invalid_event_capacity';
  end if;
  if p_min_level is null or p_min_level not in (0,3,5,6) then
    raise sqlstate 'PT400' using message = 'invalid_event_min_level';
  end if;
  if p_group_id is null then
    raise sqlstate 'PT400' using message = 'event_group_required';
  end if;

  select * into v_group from public.groups where id = p_group_id and status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  begin
    -- #582: the Organization is the Group carrying the marker, not the row
    -- that happens to mirror the legacy `org` pseudo-department.
    if v_group.is_organization then
      v_actor := private.require_active_member();
      perform 1 from public.profiles as profile
        where profile.id = v_actor and profile.status = 'activ' for share of profile;
      if not found then
        raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
      end if;
      v_level := private.actor_level(v_actor);
      if v_level < 6 then
        -- An Organization Event needs a real live Group Role, not an old rank or JWT roster.
        -- Lock only roster rows: Group SHARE locks conflict with legacy mirror upserts.
        perform 1 from public.group_members as gm
          where gm.member_id = v_actor and gm.group_role in ('manager','responsible')
          order by gm.group_id for share of gm;
        if not found then
          raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
        end if;
      end if;
    else
      v_actor := private.require_group_work_manager(p_group_id);
    end if;
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end;
  -- Refresh settings and level after any wait for live authority.
  select * into v_group from public.groups where id = p_group_id and status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  v_level := private.actor_level(v_actor);
  if p_min_level < v_group.min_level then
    raise sqlstate 'PT400' using message = 'event_min_level_below_group';
  end if;
  if v_level < 9 and p_min_level > v_level then
    raise sqlstate 'PT400' using message = 'event_min_level_above_actor';
  end if;
  insert into public.events(title,type,group_id,starts_at,ends_at,location,capacity,description,min_level,created_by)
    values (btrim(p_title),p_type::public.event_type,p_group_id,p_starts_at,p_ends_at,
      nullif(btrim(p_location),''),p_capacity,nullif(btrim(p_description),''),p_min_level,v_actor)
    returning * into v_created;
  return v_created;
end;
$$;

create or replace function private.update_event_impl(
  p_event_id bigint, p_title text, p_type text, p_group_id bigint,
  p_starts_at timestamptz, p_ends_at timestamptz, p_location text,
  p_capacity integer, p_description text, p_min_level integer
)
returns public.events language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_level integer;
  v_event public.events%rowtype;
  v_updated public.events%rowtype;
  v_target public.groups%rowtype;
  v_recipients uuid[];
  v_old_members uuid[];
  v_field text;
  v_body text;
begin
  -- 1. Malformed input, judged for everyone before the gate.
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_event_title';
  end if;
  if p_type is null or p_type not in ('sedinta', 'activitate', 'call', 'eveniment', 'deadline', 'recrutare') then
    raise sqlstate 'PT400' using message = 'invalid_event_type';
  end if;
  if p_starts_at is null or (p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise sqlstate 'PT400' using message = 'invalid_event_interval';
  end if;
  if p_capacity is not null and p_capacity <= 0 then
    raise sqlstate 'PT400' using message = 'invalid_event_capacity';
  end if;
  if p_min_level is null or p_min_level not in (0, 3, 5, 6) then
    raise sqlstate 'PT400' using message = 'invalid_event_min_level';
  end if;
  if p_group_id is null then
    raise sqlstate 'PT400' using message = 'event_group_required';
  end if;

  -- 2. Gate.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end;

  -- 3. Lock the Event before inspecting its state; concurrent edits and cancellation serialize.
  select * into v_event from public.events where id = p_event_id for no key update;
  if not found or coalesce(private.actor_level(v_actor), -1) < v_event.min_level then
    raise sqlstate 'PT404' using message = 'event_not_found';
  end if;
  perform 1 from public.profiles where id = v_actor and status = 'activ' for share;
  if not found then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;

  -- 4. Visibility is judged before authority: a hidden Event is a missing one.
  v_level := private.actor_level(v_actor);
  if coalesce(v_level, -1) < v_event.min_level then
    raise sqlstate 'PT404' using message = 'event_not_found';
  end if;
  -- #582: the Organization is the Group carrying the marker.
  if exists (select 1 from public.groups where id = v_event.group_id and is_organization) then
    if v_event.created_by is distinct from v_actor and v_level < 6 then
      raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
    end if;
  else
    begin
      perform private.require_group_work_manager(v_event.group_id);
    exception when insufficient_privilege then
      raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
    end;
  end if;

  -- An unknown Group is refused as "you may not", never as "no such Group".
  -- The ACTIVE requirement belongs to the move, not to the argument: see the
  -- header (reason 2). An edit that keeps the Event in its own Group is left
  -- to step 4's rule, which already gates a Group Role on the Group's status.
  select * into v_target from public.groups where id = p_group_id;
  if not found
     or (p_group_id is distinct from v_event.group_id and v_target.status <> 'active') then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  if p_group_id is distinct from v_event.group_id then
    -- Even an Organization Event's creator must hold authority in the new Group.
    begin
      if v_target.is_organization then
        if v_level < 6 then
          -- Lock only roster rows: Group SHARE locks conflict with legacy mirror upserts.
          perform 1 from public.group_members as gm
            where gm.member_id = v_actor and gm.group_role in ('manager', 'responsible')
            order by gm.group_id for share of gm;
          if not found then
            raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
          end if;
        end if;
      else
        perform private.require_group_work_manager(p_group_id);
      end if;
    exception when insufficient_privilege then
      raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
    end;
  end if;

  -- 5. Minimum Level, judged against the loaded target Group and the live actor.
  if p_min_level < v_target.min_level then
    raise sqlstate 'PT400' using message = 'event_min_level_below_group';
  end if;
  if v_level < 9 and p_min_level > v_level then
    raise sqlstate 'PT400' using message = 'event_min_level_above_actor';
  end if;

  -- 6. Terminal state.
  if v_event.cancelled_at is not null then
    raise sqlstate 'PT409' using message = 'event_cancelled';
  end if;

  -- 7. Full-state replace: every column the caller names is written, so a null
  --    argument CLEARS a nullable column instead of leaving the old value.
  -- #601: the old Group's whole Group Audience, not only its explicit roster -- and,
  -- like every Event recipient, only those who can read the Event at its NEW
  -- Minimum Level (private.can_read_event, the events_read rule).
  select array_agg(member_id) into v_old_members
    from private.group_audience(v_event.group_id) as member_id
   where private.can_read_event(p_min_level, member_id);
  update public.events set title = btrim(p_title), type = p_type::public.event_type,
    group_id = p_group_id, starts_at = p_starts_at, ends_at = p_ends_at,
    location = nullif(btrim(p_location), ''), capacity = p_capacity,
    description = nullif(btrim(p_description), ''), min_level = p_min_level
   where id = p_event_id returning * into v_updated;
  select array_agg(recipient) into v_recipients
    from private.event_notification_recipients(p_event_id) as recipient;
  if v_event.group_id is distinct from v_updated.group_id then
    v_recipients := coalesce(v_recipients, '{}'::uuid[]) || coalesce(v_old_members, '{}'::uuid[]);
  end if;
  foreach v_field in array array[
    case when v_event.starts_at is distinct from v_updated.starts_at or v_event.ends_at is distinct from v_updated.ends_at then 'schedule' end,
    case when v_event.location is distinct from v_updated.location then 'location' end,
    case when v_event.group_id is distinct from v_updated.group_id then 'group' end,
    case when v_event.min_level is distinct from v_updated.min_level then 'min_level' end
  ] loop
    if v_field is not null then
      v_body := case v_field
        when 'schedule' then 'Noua programare: '
          || to_char(v_updated.starts_at at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI')
          || coalesce(' - ' || to_char(v_updated.ends_at at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI'), '')
        when 'location' then 'Noua locație: ' || coalesce(v_updated.location, 'nespecificată')
        when 'group' then 'Noul grup: ' || v_target.name
        when 'min_level' then 'Noul nivel minim: ' || v_updated.min_level::text
      end;
      perform private.notify(v_recipients, 'event', 'Eveniment actualizat: ' || v_updated.title, v_body,
        null, 'event:' || p_event_id::text || ':' || v_field, v_actor, '/calendar');
    end if;
  end loop;
  return v_updated;
end;
$$;

create or replace function private.cancel_event_impl(p_event_id bigint, p_reason text)
returns public.events language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_level integer;
  v_event public.events%rowtype;
begin
  if p_reason is null or p_reason !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'reason_required';
  end if;
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end;
  -- Lock the Event before inspecting its state; concurrent edits and cancellation serialize.
  select * into v_event from public.events where id = p_event_id for no key update;
  if not found or coalesce(private.actor_level(v_actor), -1) < v_event.min_level then
    raise sqlstate 'PT404' using message = 'event_not_found';
  end if;
  perform 1 from public.profiles where id = v_actor and status = 'activ' for share;
  if not found then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  v_level := private.actor_level(v_actor);
  if coalesce(v_level, -1) < v_event.min_level then
    raise sqlstate 'PT404' using message = 'event_not_found';
  end if;
  -- #582: the Organization is the Group carrying the marker.
  if exists (select 1 from public.groups where id = v_event.group_id and is_organization) then
    if v_event.created_by is distinct from v_actor and v_level < 6 then
      raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
    end if;
  else
    begin
      perform private.require_group_work_manager(v_event.group_id);
    exception when insufficient_privilege then
      raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
    end;
  end if;
  if v_event.cancelled_at is not null then
    raise sqlstate 'PT409' using message = 'event_cancelled';
  end if;

  -- Every gate above is this command's; the write and the fan-out are the
  -- shared effect (#582, section 4b), which archive_group calls with the
  -- Group's authority instead of an actor's.
  return private.cancel_event_effect(p_event_id, p_reason, v_actor);
end;
$$;

-- ==================== 8 · comments ====================

comment on function public.create_group(text, text, bigint, integer, uuid, text, text) is
  'Creates a Group (#582, ADR-0009). A top-level Group is BC''s and the Moderator''s (live level >= 6); a Child Group belongs to its parent''s Group Managers through private.require_group_manager, so a Group Responsible cannot create one. Malformed input is judged first, for everyone: PT400 invalid_group_name / invalid_group_category (the presentation label is department, project or team — the Organization marker is set afterwards by update_group_structure, never claimed here) / invalid_group_min_level / invalid_group_color. Every authority refusal is the one non-disclosing 42501 group_manage_forbidden, so an unknown parent, an archived one and one the caller may not touch are indistinguishable; an authorized actor gets PT409 group_archived instead. Minimum Level defaults to the parent''s (0 for a root), may not fall below the parent''s (PT400 group_min_level_below_parent) and may not exceed the actor''s own live Level (PT400 group_min_level_above_actor, Moderator exempt). p_manager_id appoints the Group Manager in the same transaction: an unknown or inactive Member is PT400 group_member_not_eligible and one below the new Group''s Minimum Level is PT400 group_member_below_min_level. A sibling name already taken is PT409 group_name_taken (groups_parent_name_uidx, still partial over native Groups until #591). THE PARENT IS CHOSEN HERE AND NEVER CHANGES (ADR-0009 amended 2026-09-20): there is no move command and there will be none — a wrongly placed Group is archived and created again, which is what keeps Department Cup attribution stable, since standings walk each Task''s live groups.path.';

comment on function public.update_group(bigint, text, text, boolean, integer, boolean, integer, boolean) is
  'Replaces a Group''s OPERATIONAL settings (#582, ADR-0009 Decision 5): name, the Group Manager''s display name, Accepts Applications with its Application Level, Shared Work Visibility, and a Child Group''s Minimum Level. Authorized by private.require_group_manager — the Group''s own Managers and those of its ancestors, plus BC and the Moderator; a Group Responsible is refused. This is a full-state REPLACE, not a patch (conventions OD5): every column above is written from its argument, so a null clears a nullable one and a caller that wants to keep a value must send it back. Malformed input first: PT400 invalid_group_name / invalid_position_title / invalid_group_min_level / invalid_application_level / application_level_below_min_level. A TOP-LEVEL Group''s Minimum Level is structural, so changing it below live level 6 is 42501 group_manage_forbidden — the mirror image of update_group_structure, which refuses a CHILD''s. Then PT409 group_archived; PT409 automatic_group_accepts_no_applications (a Group whose roster follows the rank accepts none, groups_automatic_no_applications_ck); PT400 group_min_level_below_parent / group_min_level_above_children / group_min_level_above_actor (Moderator exempt); PT409 group_name_taken; PT409 nothing_to_update when the state sent back is identical. Raising the Minimum Level above existing members is PT409 group_has_members_below_level, with the count in DETAIL (the message stays the snake_case reason the frontend matches on), unless p_confirm_removals is true — then exactly those roster rows are deleted, whatever Group Role they carried, each removed Member is notified directly and the Group''s Managers get one summary. Descendants are never touched: group_min_level_above_children has already refused a level above a child''s. Not yet done here: withdrawing those Members'' pending Applications. public.group_applications does not exist until #584, whose implementer replaces this body to add it (ruling R30) — deferred, not forgotten.';

comment on function public.update_group_structure(bigint, text, boolean, boolean, boolean, integer, text, text, boolean, boolean) is
  'Replaces a Group''s STRUCTURAL settings (#582, ADR-0009 Decision 5): the presentation label, both Department Cup flags, Automatic Membership, colour and short name, the Organization marker, and a TOP-LEVEL Group''s Minimum Level. BC and the Moderator only (live level >= 6); every refusal is the one non-disclosing 42501 group_manage_forbidden, an unknown id included. Full-state REPLACE (conventions OD5). Malformed input first: PT400 invalid_group_category / invalid_group_min_level / invalid_group_color. A CHILD Group''s Minimum Level belongs to its Managers, so changing it here is 42501 — the mirror image of update_group. Then PT409 group_archived; PT409 cup_not_top_level (only a root competes, groups_competes_top_level_ck), organization_group_exists (groups_one_organization_uidx allows one marked Group: clear the old one first), automatic_group_has_roster_members (turning Automatic Membership on while ordinary members are on the roster), automatic_group_accepts_no_applications (turning it on while the Group accepts Applications); PT400 group_min_level_below_parent / group_min_level_above_children / group_min_level_above_actor; PT409 nothing_to_update. The Minimum-Level raise behaves exactly as in update_group: PT409 group_has_members_below_level with the count in DETAIL unless p_confirm_removals is true, then the rows below the new level go and everyone affected is notified. The Application withdrawal half is owed to #584 (ruling R30). This is one of the two commands allowed to write groups.category — it and private.create_group_impl are the only writers beside the three Wave 1 mirror functions, and conventions.test.sql''s sweep names them (ruling R16). It never writes groups.parent_id: a Group''s parent is fixed at creation (ruling R20).';

comment on function public.archive_group(bigint) is
  'Archives a Group and every Group below it (#582, ADR-0009). A top-level Group is BC''s and the Moderator''s; a Child Group belongs to its Managers through private.require_group_manager. Unknown and unauthorized are the same 42501 group_manage_forbidden; an already-archived Group is PT409 group_already_archived. ARCHIVING NEVER CANCELS A TASK (ruling R21): while the Group or any descendant holds a Task that is not completed, unfulfilled or cancelled, or a Completed-work Request still pending, the command refuses with PT409 group_has_open_work and the Manager finishes or cancels that work first, with the reasons the Tracker already demands. What has no executor it settles itself, in the same transaction: EVERY future Event of the subtree is cancelled with the reason "Grup arhivat" through private.cancel_event_effect -- the shared write-and-fan-out that carries no gate of its own -- while past Events stay as history; then the status cascades to the whole subtree in ONE statement, because can_manage_group_work reads the target Group''s status alone and a live Child Group under an archived parent would otherwise stay manageable (ruling R19). It deliberately does NOT go through private.cancel_event_impl: that command re-decides authority per Event from the actor, so it would refuse a Group Manager who did not create an Organization Event and answer PT404 event_not_found for any Event raised above the archiver''s own Minimum Level, aborting the whole archive with a reason that names neither the Group nor the cause. The authority for these cancellations is the GROUP, which the archiver already passed require_group_manager on, so no Event-visibility rule applies inside the cascade and the archiver''s own Level is irrelevant to it. Not yet done here: declining the subtree''s pending Applications with the archiver as the decider. public.group_applications does not exist until #584, whose implementer replaces this body to add it (ruling R30) — deferred, not forgotten.';

comment on function private.create_group_impl(text, text, bigint, integer, uuid, text, text) is
  'Body behind public.create_group (#582): input validation, the root/parent authority split, Minimum Level against the parent and the actor, the appointed Manager''s eligibility, the sibling-name check and the Group Manager''s roster row. Writes groups.category and is named in conventions.test.sql''s sweep exclusion for it (ruling R16). Never writes groups.parent_id after the insert.';
comment on function private.update_group_impl(bigint, text, text, boolean, integer, boolean, integer, boolean) is
  'Body behind public.update_group (#582): the operational full-state replace, the structural refusal for a root''s Minimum Level, and the confirmed Minimum-Level removal with its two Notifications.';
comment on function private.update_group_structure_impl(bigint, text, boolean, boolean, boolean, integer, text, text, boolean, boolean) is
  'Body behind public.update_group_structure (#582): the structural full-state replace under the level-6 gate. Writes groups.category and is named in conventions.test.sql''s sweep exclusion for it (ruling R16).';
comment on function private.archive_group_impl(bigint) is
  'Body behind public.archive_group (#582): the open-work refusal, the future-Event cancellations through private.cancel_event_effect (the ungated shared effect -- the Group is the authority here, not the archiver''s own visibility), and the one-statement status cascade over groups.path.';

comment on function private.create_event_impl(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer) is
  'Creates an Event on a Group, authorized by Group Role (ADR-0009 Wave 2, #370). Malformed input is judged first, for everyone, so a caller without organization claims learns what is wrong with the call: PT400 invalid_event_title / invalid_event_type / invalid_event_interval / invalid_event_capacity / invalid_event_min_level / event_group_required. The Organization Group — since #582 the Group carrying groups.is_organization, not the row mirroring the legacy org pseudo-department — is open to any live Member holding any Group Role anywhere, which is how a Department''s leadership gets an organization-wide Event, or to level >= 6; every other Group goes through private.require_group_work_manager, so a Group Manager or Group Responsible on the path, an ancestor''s included, qualifies and an ordinary member does not. Every refusal is the single non-disclosing 42501 calendar_manage_forbidden, so a missing, archived or forbidden Group are indistinguishable. Minimum Level is then judged against the loaded rows: PT400 event_min_level_below_group (an Event may not be more open than its Group) and PT400 event_min_level_above_actor (nobody raises an Event above their own live level), the latter with Moderator exempt.';

comment on function private.update_event_impl(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer) is
  'Replaces an Event''s whole editable state, authorized by Group Role (ADR-0009 Wave 2, #248). This is a full-state REPLACE, not a patch: every editable column is written from its argument, so a null clears a nullable column (ends_at, location, capacity, description) rather than leaving the old value -- a client that wants to keep a field must send it back. Malformed input is judged first, for everyone, with the same reasons as create_event including event_group_required. A caller who cannot see the Event (below its min_level) is answered PT404 event_not_found, the same as an id that does not exist: hidden is never distinguishable from missing. Authority on the SOURCE: an Organization Group Event (since #582 the Group carrying groups.is_organization) belongs to its creator or to level >= 6; every other Event goes through private.require_group_work_manager, so a Group Manager or Group Responsible of the Group or any ancestor on its path qualifies. Moving the Event re-runs the rule on the TARGET Group, where an Organization target takes create_event''s rule -- level >= 6 or any live Group Role anywhere -- because the Organization Group is a root Group with no ancestors of its own (one root among several: every Department, Independent Team and Project Group is a root too, and most Group paths never contain it), so nobody could reach it through an ancestor role. A MOVE''s target must be active. An edit that leaves the Event in its own Group is NOT refused when that Group has since been archived: this is a full-state replace, so every call names a Group, and an ungated check would leave such an Event uncorrectable while cancel_event -- same authority rule -- still cancelled it. Who may still edit it is decided by the source rule above alone: BC/Moderator always, a Group Role only while the Group is active, which is can_manage_group_work''s own status gate. Minimum Level is then judged against the target Group and the live actor (PT400 event_min_level_below_group / event_min_level_above_actor), and a cancelled Event is PT409 event_cancelled. Important changes -- schedule, location, Group, Minimum Level -- notify the current going attendees and the new Group''s Group Audience (private.group_audience, #601), plus the old Group''s Group Audience when the Event moved, every recipient filtered through private.can_read_event at the new Minimum Level, under dedupe key event:<id>:<field> and link /calendar; title, type, description and capacity notify nobody.';

comment on function private.cancel_event_impl(bigint, text) is
  'Cancels an Event, authorized exactly as private.update_event_impl authorizes an edit (ADR-0009 Wave 2, #248), with the Organization Group recognised since #582 by groups.is_organization. The reason is malformed input -- blank or null is PT400 reason_required, raised before the gate -- and it is preserved, trimmed, on the row beside cancelled_at, which events_cancel_reason_ck requires to be set together. Cancellation is terminal: a second call is PT409 event_cancelled, and so is any later edit. The Event row and every event_attendance row survive (ADR-0008: cancellation preserves RSVP history) and the Event stays readable to everyone at or above its min_level. The write and the fan-out are private.cancel_event_effect (#582): recipients -- the current going attendees and the Group''s Group Audience, filtered by private.can_read_event -- are notified under dedupe key event:<id>:cancelled with the reason as the body and link /calendar. Everything above the effect is this command''s authority, and it is exactly what private.archive_group_impl must NOT re-run: archiving cancels every future Event of the subtree on the Group''s authority, whatever the archiver''s own Level, so it calls the effect directly.';

-- ==================== 9 · grants (conventions section 4, four-role revoke) ====================

revoke execute on function private.require_group_manager(bigint)
  from public, anon, authenticated, service_role;
-- The shared Event cancellation effect carries no gate of its own, so nothing
-- outside the two definer callers may reach it -- no grant back at all.
revoke execute on function private.cancel_event_effect(bigint, text, uuid)
  from public, anon, authenticated, service_role;

revoke execute on function private.create_group_impl(text, text, bigint, integer, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function private.update_group_impl(bigint, text, text, boolean, integer, boolean, integer, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function private.update_group_structure_impl(bigint, text, boolean, boolean, boolean, integer, text, text, boolean, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function private.archive_group_impl(bigint)
  from public, anon, authenticated, service_role;

grant execute on function private.create_group_impl(text, text, bigint, integer, uuid, text, text)
  to authenticated;
grant execute on function private.update_group_impl(bigint, text, text, boolean, integer, boolean, integer, boolean)
  to authenticated;
grant execute on function private.update_group_structure_impl(bigint, text, boolean, boolean, boolean, integer, text, text, boolean, boolean)
  to authenticated;
grant execute on function private.archive_group_impl(bigint)
  to authenticated;

revoke execute on function public.create_group(text, text, bigint, integer, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.update_group(bigint, text, text, boolean, integer, boolean, integer, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function public.update_group_structure(bigint, text, boolean, boolean, boolean, integer, text, text, boolean, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function public.archive_group(bigint)
  from public, anon, authenticated, service_role;

grant execute on function public.create_group(text, text, bigint, integer, uuid, text, text)
  to authenticated;
grant execute on function public.update_group(bigint, text, text, boolean, integer, boolean, integer, boolean)
  to authenticated;
grant execute on function public.update_group_structure(bigint, text, boolean, boolean, boolean, integer, text, text, boolean, boolean)
  to authenticated;
grant execute on function public.archive_group(bigint)
  to authenticated;

-- public.groups and public.group_members already carry only SELECT for
-- authenticated (#507 revoked every other privilege when it created them), so
-- conventions section 2's "once a command owns a table's writes" revoke has
-- nothing left to do here: these four commands are the first write path either
-- table has ever had from a client.
