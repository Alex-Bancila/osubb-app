-- #1117, #1118, #1119: the audit of 2026-10-30, server side -- a Task restarts after a return, a Group's Minimum Level raise reaches its Events, service_role writes a nicknamed Profile.
--
-- Three findings of the codebase audit (docs/review/2026-10-30-codebase-audit.md,
-- H1, H2 and H4), each with the pgTAP case that failed before this file:
--
--   H1  tasks_lifecycle_timestamp_order_ck demanded returned_to_progress_at
--       >= started_at. give_up_task (#682) and an update_task that removes the
--       Executor clear started_at and keep returned_to_progress_at (the
--       review_round is history), so the NEXT Executor's start_task wrote a
--       started_at later than the old return and the row failed the check
--       with a raw 23514 -- the Task could only be cancelled or duplicated.
--       supabase/tests/task_restart_after_return.test.sql
--   H2  update_group and update_group_structure raised groups.min_level and
--       removed the roster rows below it, but left the Group's Events where
--       they were; private.can_read_event compares a reader only with the
--       Event's own level, so lower Roles kept reading, RSVPing to and being
--       reminded of Events of a Group they could no longer see, and the next
--       update_event (the form resubmits the stored level) was refused with
--       event_min_level_below_group. supabase/tests/group_min_level_events.test.sql
--   H4  private.fold_nickname was executable by authenticated only, while the
--       unique index profiles_nickname_fold_uidx evaluates it as the writing
--       role on every insert and non-HOT update of a nicknamed row, and the
--       invoker guard profiles_guard_nickname calls it too. Every secret-key
--       write to such a row -- reinvite-member's address correction, the
--       record_invitation_sent stamp, the R58 university backfill -- failed
--       with 42501. supabase/tests/profiles_nickname.test.sql, last section.

-- ==================== H1: the lifecycle order no longer ties a start to an earlier return ====================
-- A later Executor's start legitimately postdates an earlier return: the
-- return belongs to the Assignment that was reviewed, the start to the next
-- one. Every other arm stays as 20260911104000 wrote it.
alter table public.tasks drop constraint tasks_lifecycle_timestamp_order_ck;
alter table public.tasks add constraint tasks_lifecycle_timestamp_order_ck check (
      (started_at is null or started_at >= created_at)
  and (submitted_at is null or submitted_at >= created_at)
  and (returned_to_progress_at is null or returned_to_progress_at >= created_at)
  and (completed_at is null or completed_at >= created_at)
  and (unfulfilled_at is null or unfulfilled_at >= created_at)
  and (cancelled_at is null or cancelled_at >= created_at)
  and (started_at is null or submitted_at is null or submitted_at >= started_at)
  and (completed_at is null or started_at is null or completed_at >= started_at)
  and (completed_at is null or submitted_at is null or completed_at >= submitted_at)
  and (completed_at is null or returned_to_progress_at is null or completed_at >= returned_to_progress_at)
  and (unfulfilled_at is null or started_at is null or unfulfilled_at >= started_at)
  and (unfulfilled_at is null or submitted_at is null or unfulfilled_at >= submitted_at)
  and (unfulfilled_at is null or returned_to_progress_at is null or unfulfilled_at >= returned_to_progress_at)
  and (cancelled_at is null or started_at is null or cancelled_at >= started_at)
  and (cancelled_at is null or submitted_at is null or cancelled_at >= submitted_at)
  and (cancelled_at is null or returned_to_progress_at is null or cancelled_at >= returned_to_progress_at)
);
comment on constraint tasks_lifecycle_timestamp_order_ck on public.tasks is
  'Every lifecycle marker is at or after created_at, and the terminal markers (completed_at, unfulfilled_at, cancelled_at) at or after the start, the submission and the last return. A return is NOT ordered against the start (audit 2026-10-30, H1): give_up_task and an Executor-removing update_task clear started_at and keep returned_to_progress_at, so the next Executor''s start postdates the earlier return.';

-- ==================== H2: a Group's Minimum Level raise reaches its Events ====================
-- The two Group commands that raise groups.min_level now raise the Group's
-- own Events to it in the same statement run (a Child Group's level is at
-- least its parent's, and group_min_level_above_children has already refused
-- a level above any child's, so the children's Events are judged by their
-- own Group). The Event ladder stops at 6 (events_min_level_ck), so a Group
-- raised to the Moderator's 9 lifts its Events to 6, the highest an Event can
-- carry; such a Group can take no new Event anyway (event_min_level_below_group).
-- No Notification: nobody gained or lost an Event they could discuss -- the
-- Members below the new level have just left the Group, and
-- private.can_read_event keeps the rest as they were.

create or replace function private.update_group_impl(p_group_id bigint, p_name text, p_manager_title text, p_responsible_title text, p_accepts_applications boolean, p_application_level integer, p_shared_work_visibility boolean, p_min_level integer, p_application_form_label text, p_application_form_url text, p_confirm_removals boolean DEFAULT false) RETURNS public.groups
language plpgsql
security definer
set search_path = ''
as $_$
declare
  v_actor       uuid;
  v_actor_level integer;
  v_group       public.groups%rowtype;
  v_parent      public.groups%rowtype;
  v_accepts     boolean := coalesce(p_accepts_applications, false);
  v_shared      boolean := coalesce(p_shared_work_visibility, false);
  v_title       text    := nullif(btrim(p_manager_title), '');
  v_resp_title  text    := nullif(btrim(p_responsible_title), '');
  v_form_label  text;
  v_form_url    text;
  v_updated     public.groups%rowtype;
  v_below       uuid[];
  v_removed     uuid[];
  v_managers    uuid[];
begin
  if p_name is null or p_name !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_group_name';
  end if;
  -- #673 (R8): measured as stored (btrim).
  perform private.require_text_length('name', btrim(p_name), 3, 120);
  if p_manager_title is not null and p_manager_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;
  -- Security pass 2026-09-27 (L1): groups_manager_title_length_ck.
  perform private.require_text_length('manager_title', v_title, null, 80);
  -- #962: the Group Responsible position's display name, judged exactly as
  -- the Manager's is -- blank is malformed, over 80 is too long.
  if p_responsible_title is not null and p_responsible_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;
  perform private.require_text_length('responsible_title', v_resp_title, null, 80);
  if p_min_level is null or p_min_level not in (0, 1, 2, 3, 5, 6, 9) then
    raise sqlstate 'PT400' using message = 'invalid_group_min_level';
  end if;
  if p_application_level is not null and p_application_level not in (0, 1, 2, 3, 5, 6, 9) then
    raise sqlstate 'PT400' using message = 'invalid_application_level';
  end if;
  if v_accepts and p_application_level is null then
    raise sqlstate 'PT400' using message = 'invalid_application_level';
  end if;
  if p_application_level is not null and p_application_level < p_min_level then
    raise sqlstate 'PT400' using message = 'application_level_below_min_level';
  end if;
  -- #697 (R18/R8): the application form link, trimmed (blank -> null) and
  -- judged exactly as a Task's Attached Link is.
  v_form_label := nullif(regexp_replace(coalesce(p_application_form_label, ''),
                                        '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_form_url := nullif(regexp_replace(coalesce(p_application_form_url, ''),
                                      '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_attached_link(v_form_label, v_form_url);

  v_actor := private.require_group_manager(p_group_id);
  v_actor_level := private.actor_level(v_actor);

  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  if v_group.parent_id is null
     and p_min_level is distinct from v_group.min_level
     and coalesce(v_actor_level, -1) < 6 then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;

  if v_accepts and v_group.automatic_membership then
    raise sqlstate 'PT409' using message = 'automatic_group_accepts_no_applications';
  end if;
  -- #756 (ruling R25): a Private Group accepts no Applications -- the same
  -- reason apply_to_group answers. update_group_structure switched them off
  -- when the Group turned private, so this refuses only turning them on.
  if v_accepts and v_group.is_private then
    raise sqlstate 'PT400' using message = 'group_private';
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

  if exists (
    select 1 from public.groups as sibling
     where sibling.id <> p_group_id
       and coalesce(sibling.parent_id, 0) = coalesce(v_group.parent_id, 0)
       and lower(sibling.name) = lower(btrim(p_name))
  ) then
    raise sqlstate 'PT409' using message = 'group_name_taken';
  end if;

  if (btrim(p_name), v_title, v_resp_title, v_accepts, p_application_level, v_shared, p_min_level,
      v_form_label, v_form_url)
     is not distinct from
     (v_group.name, v_group.manager_title, v_group.responsible_title, v_group.accepts_applications,
      v_group.application_level, v_group.shared_work_visibility, v_group.min_level,
      v_group.application_form_label, v_group.application_form_url) then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

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

    -- #584 (ruling R30), the Application half of ruling R23.
    perform 1 from public.group_applications as application
      where application.group_id = p_group_id
        and application.member_id = any (v_removed)
        and application.status = 'pending'
      order by application.id
      for update of application;

    update public.group_applications as application
       set status     = 'withdrawn',
           decided_by = v_actor,
           decided_at = clock_timestamp()
     where application.group_id = p_group_id
       and application.member_id = any (v_removed)
       and application.status = 'pending';
  end if;

  update public.groups
     set name                   = btrim(p_name),
         manager_title          = v_title,
         responsible_title      = v_resp_title,
         accepts_applications   = v_accepts,
         application_level      = p_application_level,
         shared_work_visibility = v_shared,
         min_level              = p_min_level,
         application_form_label = v_form_label,
         application_form_url   = v_form_url
   where id = p_group_id
  returning * into v_updated;

  -- Audit 2026-10-30 (H2): the Group's own Events follow its Minimum Level up.
  -- The Event ladder stops at 6; see the migration header.
  update public.events as event
     set min_level = least(p_min_level, 6)
   where event.group_id = p_group_id
     and event.min_level < least(p_min_level, 6);

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
$_$;

comment on function private.update_group_impl(p_group_id bigint, p_name text, p_manager_title text, p_responsible_title text, p_accepts_applications boolean, p_application_level integer, p_shared_work_visibility boolean, p_min_level integer, p_application_form_label text, p_application_form_url text, p_confirm_removals boolean) is
  'Body behind public.update_group (#582): the operational settings, the top-level Minimum-Level split, the tree and actor bounds, the full-state replace and ruling R23''s Minimum-Level removal behind p_confirm_removals. Since #584 (ruling R30) the removal also withdraws those Members'' pending Applications on this Group, with the actor as decider. Since #697 (ruling R18) it also replaces the application form link, trimmed and judged at step 1 by private.require_attached_link. Since #962 it also replaces groups.responsible_title, the Group Responsible position''s display name, trimmed and judged at step 1 exactly as the Manager''s is. Since the audit of 2026-10-30 (H2) a raised Minimum Level lifts the Group''s own Events below it to the new level (capped at 6, the Event ladder''s top) in the same command.'
  ;

create or replace function private.update_group_structure_impl(p_group_id bigint, p_category text, p_competes_in_cup boolean, p_counts_toward_parent_cup boolean, p_automatic_membership boolean, p_min_level integer, p_color text, p_short text, p_is_organization boolean, p_is_private boolean, p_confirm_removals boolean DEFAULT false) RETURNS public.groups
language plpgsql
security definer
set search_path = ''
as $_$
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
  -- Security pass 2026-09-27 (L1): groups_short_length_ck.
  perform private.require_text_length('short', v_short, null, 16);
  -- #756: a full-state replace must say which it is. A null is refused rather
  -- than read as "public", which would un-hide a Private Group by omission.
  if p_is_private is null then
    raise sqlstate 'PT400' using message = 'invalid_group_privacy';
  end if;
  -- #756: the Organization Group is every Member's, so it cannot be private --
  -- and since privacy cascades down, marking it so would hide the whole tree.
  if p_is_private and v_is_org then
    raise sqlstate 'PT400' using message = 'private_not_allowed_for_organization';
  end if;

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

  if v_group.parent_id is not null
     and p_min_level is distinct from v_group.min_level then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;

  if v_competes and v_group.parent_id is not null then
    raise sqlstate 'PT409' using message = 'cup_not_top_level';
  end if;
  -- ADR-0009, amended 2026-10-13 (Alex, 2026-10-11): the Department Cup is a
  -- Department's. The one place this command reads the label it writes, and
  -- it reads the REQUESTED label: a Group that takes another label leaves the
  -- Cup in the same command or is refused.
  if v_competes and p_category <> 'department' then
    raise sqlstate 'PT409' using message = 'cup_not_department';
  end if;
  if v_is_org and exists (select 1 from public.groups as other
                           where other.is_organization and other.id <> p_group_id) then
    raise sqlstate 'PT409' using message = 'organization_group_exists';
  end if;
  if v_automatic and not v_group.automatic_membership
     and exists (select 1 from public.group_members as membership
                  where membership.group_id = p_group_id
                    and membership.group_role = 'member') then
    raise sqlstate 'PT409' using message = 'automatic_group_has_roster_members';
  end if;
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
    -- #756 (ruling R25): a Private Group's subtree is private. The parent is
    -- held FOR NO KEY UPDATE above, so it cannot turn private underneath.
    if v_parent.is_private and not p_is_private then
      raise sqlstate 'PT400' using message = 'private_parent';
    end if;
  end if;
  if exists (select 1 from public.groups as child
              where child.parent_id = p_group_id and child.min_level < p_min_level) then
    raise sqlstate 'PT400' using message = 'group_min_level_above_children';
  end if;
  if coalesce(v_actor_level, -1) < 9 and p_min_level > coalesce(v_actor_level, -1) then
    raise sqlstate 'PT400' using message = 'group_min_level_above_actor';
  end if;

  if (p_category, v_competes, v_counts, v_automatic, p_min_level, p_color, v_short, v_is_org,
      p_is_private)
     is not distinct from
     (v_group.category, v_group.competes_in_cup, v_group.counts_toward_parent_cup,
      v_group.automatic_membership, v_group.min_level, v_group.color,
      v_group.short, v_group.is_organization, v_group.is_private) then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

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

    -- #584 (ruling R30), the Application half of ruling R23.
    perform 1 from public.group_applications as application
      where application.group_id = p_group_id
        and application.member_id = any (v_removed)
        and application.status = 'pending'
      order by application.id
      for update of application;

    update public.group_applications as application
       set status     = 'withdrawn',
           decided_by = v_actor,
           decided_at = clock_timestamp()
     where application.group_id = p_group_id
       and application.member_id = any (v_removed)
       and application.status = 'pending';
  end if;

  update public.groups
     set category                 = p_category,
         competes_in_cup          = v_competes,
         counts_toward_parent_cup = v_counts,
         automatic_membership     = v_automatic,
         min_level                = p_min_level,
         color                    = p_color,
         short                    = v_short,
         is_organization          = v_is_org,
         is_private               = p_is_private,
         -- #756: a Private Group accepts no Applications (ruling R25).
         accepts_applications     = accepts_applications and not p_is_private
   where id = p_group_id
  returning * into v_updated;

  -- Audit 2026-10-30 (H2): the Group's own Events follow its Minimum Level up.
  -- The Event ladder stops at 6; see the migration header.
  update public.events as event
     set min_level = least(p_min_level, 6)
   where event.group_id = p_group_id
     and event.min_level < least(p_min_level, 6);

  -- #756 (ruling R25): turning a Group private hides its whole subtree in this
  -- same transaction, and a Private Group accepts no Applications; turning it
  -- public leaves the Child Groups as they are. The descendants are Child rows
  -- of a row already held FOR UPDATE, so the update's own FOR NO KEY UPDATE is
  -- the only lock they take (conventions section 2); archive_group cascades
  -- over the same `path @>` set in the same order.
  --
  -- The cascade repeats until a pass changes nothing. create_group locks only
  -- its parent, so a Child Group created under a descendant while a pass is
  -- waiting on that descendant commits after the pass's snapshot was taken and
  -- the pass cannot see it. The next statement takes a fresh snapshot (READ
  -- COMMITTED) and does. A create that starts later waits on the descendant
  -- this command now holds and reads it private. Locking the whole ancestor
  -- path in create_group instead would invert update_group's and this
  -- command's own child-then-parent order and deadlock them.
  if p_is_private and not v_group.is_private then
    loop
      update public.groups as below
         set is_private           = true,
             accepts_applications = false
       where below.path @> array[p_group_id]
         and below.id <> p_group_id
         and (not below.is_private or below.accepts_applications);
      exit when not found;
    end loop;

    -- An Application filed before the Group turned private is not
    -- grandfathered: it is withdrawn with the actor as decider, exactly as
    -- ruling R23's Minimum-Level removal withdraws one (#584, ruling R30).
    perform 1 from public.group_applications as application
      join public.groups as below on below.id = application.group_id
     where below.path @> array[p_group_id]
       and application.status = 'pending'
     order by application.id
       for update of application;

    update public.group_applications as application
       set status     = 'withdrawn',
           decided_by = v_actor,
           decided_at = clock_timestamp()
      from public.groups as below
     where below.id = application.group_id
       and below.path @> array[p_group_id]
       and application.status = 'pending';
  end if;

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
$_$;

comment on function private.update_group_structure_impl(p_group_id bigint, p_category text, p_competes_in_cup boolean, p_counts_toward_parent_cup boolean, p_automatic_membership boolean, p_min_level integer, p_color text, p_short text, p_is_organization boolean, p_is_private boolean, p_confirm_removals boolean) is
  'Body behind public.update_group_structure (#582): BC''s and the Moderator''s structural settings, the child Minimum-Level split, the tree and actor bounds, the full-state replace and ruling R23''s Minimum-Level removal behind p_confirm_removals. Since #584 (ruling R30) the removal also withdraws those Members'' pending Applications on this Group, with the actor as decider, exactly as private.update_group_impl does. Since #756 (ruling R25) it owns the Private Group setting: refused public under a private parent, cascaded down the subtree (with Applications switched off and pending ones withdrawn) when turned on, repeated until a pass changes nothing so a Child Group created concurrently under a descendant is caught too. This is one of the two Group commands allowed to write the presentation label -- it and private.create_group_impl are the only writers, and conventions.test.sql''s sweep names them (ruling R16). Since #1047 (ADR-0009 amended 2026-10-13) it also reads the label it is asked to write, for one rule only: PT409 cup_not_department when the requested state competes in the Department Cup under any label but department, after PT409 cup_not_top_level for a Child Group; groups_competes_department_ck backs it. It never writes groups.parent_id: a Group''s parent is fixed at creation (ruling R20). Since the audit of 2026-10-30 (H2) a raised Minimum Level lifts the Group''s own Events below it to the new level (capped at 6, the Event ladder''s top) in the same command.'
  ;


-- Every Event already below its Group's level is lifted once, so the rule
-- holds for the rows written before this file too. The count is printed for
-- the staging and Release logs.
do $$
declare
  v_count integer;
begin
  update public.events as event
     set min_level = least(grp.min_level, 6)
    from public.groups as grp
   where grp.id = event.group_id
     and event.min_level < least(grp.min_level, 6);
  get diagnostics v_count = row_count;
  raise notice 'audit 2026-10-30 H2: % Event(s) lifted to their Group''s Minimum Level', v_count;
end
$$;

-- ==================== H4: service_role writes a Profile that has a Nickname ====================
-- The unique index profiles_nickname_fold_uidx evaluates private.fold_nickname
-- as the writing role, and Postgres checks EXECUTE on an index expression's
-- function for that role. service_role has no usage on private (conventions
-- section 4, machine-checked) and needs none for this: an index expression
-- names the function by OID, so EXECUTE alone suffices. This is the one
-- private function service_role may execute; tracker_grants.test.sql pins it
-- under its own category. The guard runs as the owner instead of the caller,
-- so its own call of the fold and its uniqueness probe no longer depend on
-- the writer's grants (the probe reads every row either way: profiles_read
-- admits every live Member).
grant execute on function private.fold_nickname(text) to service_role;
comment on function private.fold_nickname(text) is
  'The comparison key for Nickname uniqueness: trimmed, unaccented, lower-cased. Immutable because the unaccent dictionary is named explicitly; indexed by profiles_nickname_fold_uidx. Executable by authenticated and (audit 2026-10-30, H4) service_role: the index evaluates it as the writing role, and the Edge Functions and the R58 backfill write nicknamed rows with the secret key.';

create or replace function private.guard_profile_nickname()
returns trigger
language plpgsql
security definer
set search_path = ''
as $_$
declare
  v_nickname text;
begin
  v_nickname := nullif(btrim(normalize(new.nickname, nfc)), '');
  if v_nickname is not null then
    if char_length(v_nickname) < 2 then
      raise exception using errcode = '23514', message = 'nickname_too_short';
    elsif char_length(v_nickname) > 24 then
      raise exception using errcode = '23514', message = 'nickname_too_long';
    elsif v_nickname !~ '^[A-Za-z0-9À-ÖØ-öø-žȘ-ț ._-]+$' then
      raise exception using errcode = '23514', message = 'nickname_invalid';
    end if;
    if exists (
      select 1
        from public.profiles as other
       where other.nickname is not null
         and private.fold_nickname(other.nickname) = private.fold_nickname(v_nickname)
         and other.id <> new.id
    ) then
      raise exception using errcode = '23514', message = 'nickname_taken';
    end if;
  end if;
  new.nickname := v_nickname;
  return new;
end;
$_$;
revoke execute on function private.guard_profile_nickname() from public, anon, authenticated, service_role;
comment on function private.guard_profile_nickname() is
  'profiles_guard_nickname: trims and NFC-normalizes the Nickname, turns blank into null, and names the reason a Nickname is refused (23514 nickname_too_short / nickname_too_long / nickname_invalid / nickname_taken). Security definer since the audit of 2026-10-30 (H4), so a service_role write reaches the fold and the probe; the unique index stays the guard under concurrency.';
