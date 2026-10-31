-- #1129: the Groups delete_group protects are never archived either, and the Organization marker cannot be cleared by omission.
--
-- Audit 2026-10-30, finding M5. private.archive_group_impl needed only level
-- >= 6 and no open work, while delete_group refused PT409 group_protected for
-- the Organization Group, an Automatic-Membership Group, the Groups named by
-- org_settings board_group_id / adunarea_generala_group_id and any Group above
-- one. Archiving cancels every future Event of the subtree with a fan-out to
-- every attendee, and unarchive_group (R65) never un-cancels: one tap on
-- Arhivează over OSUBB cancelled every org-wide Event for good. And
-- private.update_group_structure_impl read a null p_is_organization as false
-- while refusing a null p_is_private, so a full-state replace that left the
-- flag out unmarked the Organization Group, after which
-- private.announcement_recipients resolved an org Audience to nobody.
--
-- 1. private.is_protected_group(p_group_id) is the one definition of the set
--    (the Group or any Group below it). private.group_delete_summary reads it,
--    so delete_group and group_delete_preview decide as before, and
--    archive_group now reads it too.
-- 2. archive_group refuses PT409 group_protected after its authority check and
--    the subtree lock, before any write.
-- 3. update_group_structure refuses a null p_is_organization (PT400
--    invalid_group_organization, the invalid_group_privacy shape) and refuses
--    clearing the marker on the Organization Group (PT409 group_protected):
--    there is always exactly one, so the marker never moves through this
--    command.
--
-- Bodies rebuilt from main's latest: group_delete_summary from
-- 20261005022559_delete_for_good.sql, archive_group_impl from
-- 20260928100000_notification_links.sql, update_group_structure_impl from
-- 20261031075559_audit_highs_server.sql; only the lines marked #1129 change.

-- ==================== 1. the protected set ====================

create function private.is_protected_group(p_group_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.groups as grp
     where grp.path @> array[p_group_id]
       and (grp.is_organization
            or grp.automatic_membership
            or grp.id::text in (select setting.value
                                  from public.org_settings as setting
                                 where setting.key in ('board_group_id', 'adunarea_generala_group_id')
                                   and setting.value ~ '^[0-9]+$')));
$$;

comment on function private.is_protected_group(bigint) is
  '#1129 (ruling R38''s protected set, now shared): whether the Group, or any Group below it, is the Organization Group, an Automatic-Membership Group, or the Group named by org_settings board_group_id / adunarea_generala_group_id. archive_group and delete_group (through private.group_delete_summary) refuse such a Group with PT409 group_protected: archiving cancels every future Event of the subtree and nothing restores them, deleting removes it. False for an unknown id. Granted to nobody.';

revoke execute on function private.is_protected_group(bigint) from public, anon, authenticated, service_role;

create or replace function private.group_delete_summary(p_group_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with subtree as (
    select grp.id
      from public.groups as grp
     where grp.path @> array[p_group_id]
  ), subtree_tasks as (
    select task.id from public.tasks as task where task.group_id in (select subtree.id from subtree)
  ), stakes as (
    select stake.member_id, stake.points
      from private.task_points_at_stake(array(select subtree_tasks.id from subtree_tasks)) as stake
  ), task_stakes as (
    select entry.task_id
      from public.points_ledger as entry
     where entry.task_id in (select subtree_tasks.id from subtree_tasks)
       and entry.reason in ('task', 'task_reversal')
     group by entry.task_id, entry.member_id
    having sum(entry.delta) <> 0
  )
  select jsonb_build_object(
    'subgroups',         (select count(*) - 1 from subtree),
    'members',           (select count(distinct gm.member_id) from public.group_members as gm
                           where gm.group_id in (select subtree.id from subtree)),
    'tasks',             (select count(*) from subtree_tasks),
    'tasks_with_points', (select count(distinct task_stakes.task_id) from task_stakes),
    'points',            (select coalesce(sum(stakes.points), 0) from stakes),
    'point_members',     (select count(*) from stakes),
    'events',            (select count(*) from public.events as event
                           where event.group_id in (select subtree.id from subtree)),
    'announcements',     (select count(*) from public.announcements as announcement
                           where announcement.group_id in (select subtree.id from subtree)),
    'campaigns',         (select count(*) from public.campaigns as campaign
                           where campaign.group_id in (select subtree.id from subtree)),
    'applications',      (select count(*) from public.group_applications as application
                           where application.group_id in (select subtree.id from subtree)),
    'requests',          (select count(*) from public.completed_work_requests as request
                           where request.group_id in (select subtree.id from subtree)
                             and request.task_id is null),
    -- #1129: one definition of the protected set, shared with archive_group.
    'protected',         private.is_protected_group(p_group_id));
$function$;

comment on function private.group_delete_summary(bigint) is
  '#1017: what a Group''s subtree holds, for group_delete_preview and delete_group. Counts Child Groups (subgroups, the Group itself excluded), distinct roster Members, Tasks, Tasks still holding Task Points, the net points and the Members holding them, Events, Announcements, Campaigns, Applications (every status) and Completed-work Requests not yet turned into a Task; protected is private.is_protected_group (#1129): true when the subtree contains the Organization Group, an Automatic-Membership Group, or the Group named by org_settings board_group_id or adunarea_generala_group_id. Granted to nobody.';

-- ==================== 2. archive_group refuses a protected Group ====================

create or replace function private.archive_group_impl(p_group_id bigint)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor       uuid;
  v_group       public.groups%rowtype;
  v_updated     public.groups%rowtype;
  v_event_id    bigint;
  v_application record;
begin
  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

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

  perform 1
     from public.groups as descendant
    where descendant.path @> array[p_group_id]
      and descendant.id <> p_group_id
    order by descendant.id
    for no key update;

  -- #1129: never the Organization Group, an Automatic-Membership Group, the
  -- board or AG Group set in Setări, or a Group above one -- delete_group's
  -- set, read after the authority check and the subtree lock and before any
  -- write, because the cancellations below are never undone (R65).
  if private.is_protected_group(p_group_id) then
    raise sqlstate 'PT409' using message = 'group_protected';
  end if;

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

  -- #584 (ruling R30 discharging ruling R21's Application half). The rows are
  -- locked in id order before anything is decided about them, the same
  -- discipline the Event loop above follows.
  perform 1
     from public.group_applications as application
     join public.groups as owner on owner.id = application.group_id
    where owner.path @> array[p_group_id]
      and application.status = 'pending'
    order by application.id
    for update of application;

  for v_application in
    update public.group_applications as application
       set status        = 'declined',
           decided_by    = v_actor,
           decided_at    = clock_timestamp(),
           decision_note = 'Grup arhivat'
      from public.groups as owner
     where owner.id = application.group_id
       and owner.path @> array[p_group_id]
       and application.status = 'pending'
    returning application.member_id, application.id as application_id,
              application.group_id, owner.name as group_name
  loop
    perform private.notify(
      array[v_application.member_id], 'system'::public.noti_kind,
      'Cerere respinsă: ' || v_application.group_name,
      'Grupul ' || v_application.group_name
        || ' a fost arhivat, așa că cererea ta de înscriere a fost respinsă.',
      null, 'application:' || v_application.application_id::text, v_actor,
      -- #843 (D23): an archived Group's page is unavailable, so no link.
      null);
  end loop;

  update public.groups
     set status = 'archived'
   where path @> array[p_group_id];

  select * into v_updated from public.groups where id = p_group_id;
  return v_updated;
end;
$function$;

comment on function public.archive_group(bigint) is
  'Archives a Group and every Group below it (#582, ADR-0009). A top-level Group is BC''s and the Moderator''s; a Child Group belongs to its Managers through private.require_group_manager. Unknown and unauthorized are the same 42501 group_manage_forbidden; an already-archived Group is PT409 group_already_archived. PT409 group_protected (#1129) for the Organization Group, an Automatic-Membership Group, the board Group or Adunarea Generală set in Setări, or a Group above one -- private.is_protected_group, the set delete_group refuses -- because the cancellations below are never undone (unarchive_group, ruling R65). ARCHIVING NEVER CANCELS A TASK (ruling R21): while the Group or any descendant holds a Task that is not completed, unfulfilled or cancelled, or a Completed-work Request still pending, the command refuses with PT409 group_has_open_work and the Manager finishes or cancels that work first, with the reasons the Tracker already demands. What has no executor it settles itself, in the same transaction: EVERY future Event of the subtree is cancelled with the reason "Grup arhivat" through private.cancel_event_effect -- the shared write-and-fan-out that carries no gate of its own -- while past Events stay as history; every pending Application of the subtree is declined with the archiver as decider and the applicant notified (#584, ruling R30); then the status cascades to the whole subtree in ONE statement, because can_manage_group_work reads the target Group''s status alone and a live Child Group under an archived parent would otherwise stay manageable (ruling R19). It deliberately does NOT go through private.cancel_event_impl: that command re-decides authority per Event from the actor, so it would refuse a Group Manager who did not create an Organization Event and answer PT404 event_not_found for any Event raised above the archiver''s own Minimum Level, aborting the whole archive with a reason that names neither the Group nor the cause. The authority for these cancellations is the GROUP, which the archiver already passed require_group_manager on, so no Event-visibility rule applies inside the cascade and the archiver''s own Level is irrelevant to it.';

-- ==================== 3. update_group_structure: the Organization marker ====================

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
  -- #1129: no coalesce -- a null is refused below, never read as false.
  v_is_org      boolean := p_is_organization;
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
  -- #1129: the same for the Organization marker. A null is refused rather than
  -- read as "not the Organization", which would unmark the Organization Group
  -- by omission and leave an org-wide Announcement with no recipients.
  if p_is_organization is null then
    raise sqlstate 'PT400' using message = 'invalid_group_organization';
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
  -- #1129: there is always exactly one Organization Group, so its marker is
  -- never cleared here -- not by a full-state replace with false from any
  -- client. The marker does not move through this command.
  if v_group.is_organization and not v_is_org then
    raise sqlstate 'PT409' using message = 'group_protected';
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

  -- Review of PR #1123 (CodeRabbit): hold the Events this raise will lift
  -- BEFORE the roster rows. update_event locks its Event first and then the
  -- editor's roster row for share; taking them in the other order here would
  -- form an ABBA cycle with a Responsible below the new level editing an
  -- Event at the same moment (conventions section 2).
  perform 1 from public.events as event
    where event.group_id = p_group_id
      and event.min_level < least(p_min_level, 6)
    order by event.id
    for no key update;

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

comment on function public.update_group_structure(bigint, text, boolean, boolean, boolean, integer, text, text, boolean, boolean, boolean) is
  'Replaces a Group''s STRUCTURAL settings (#582, ADR-0009 Decision 5): the presentation label, both Department Cup flags, Automatic Membership, colour and short name, the Organization marker, the Private Group setting (#756) and a TOP-LEVEL Group''s Minimum Level. BC and the Moderator only (live level >= 6); every refusal is the one non-disclosing 42501 group_manage_forbidden, an unknown id included. Full-state REPLACE (conventions OD5). Malformed input first: PT400 invalid_group_category / invalid_group_min_level / invalid_group_color / invalid_group_privacy (a null p_is_private is refused, never read as public) / invalid_group_organization (#1129: a null p_is_organization is refused the same way, never read as "not the Organization") / private_not_allowed_for_organization (the Organization Group cannot be private). A CHILD Group''s Minimum Level belongs to its Managers, so changing it here is 42501 — the mirror image of update_group. Then PT409 group_archived; PT409 cup_not_top_level (only a root competes, groups_competes_top_level_ck), cup_not_department (ruling R52), organization_group_exists (groups_one_organization_uidx allows one marked Group), group_protected (#1129: the Organization Group keeps its marker -- there is always exactly one, so the marker never moves through this command), automatic_group_has_roster_members (turning Automatic Membership on while ordinary members are on the roster), automatic_group_accepts_no_applications (turning it on while the Group accepts Applications); PT400 group_min_level_below_parent / private_parent (a Child Group of a Private Group stays private) / group_min_level_above_children / group_min_level_above_actor; PT409 nothing_to_update. Turning a Group private (ruling R25) switches its Applications off and cascades both to its whole subtree in the same transaction, withdrawing the subtree''s pending Applications with the actor as decider; turning it public leaves the Child Groups as they are. The Minimum-Level raise behaves exactly as in update_group: PT409 group_has_members_below_level with the count in DETAIL unless p_confirm_removals is true, then the rows below the new level go and everyone affected is notified, and the Group''s own Events below the new level are lifted to it (audit H2). This is one of the two commands allowed to write groups.category — it and private.create_group_impl are the only writers beside the three Wave 1 mirror functions, and conventions.test.sql''s sweep names them (ruling R16). It never writes groups.parent_id: a Group''s parent is fixed at creation (ruling R20).';
