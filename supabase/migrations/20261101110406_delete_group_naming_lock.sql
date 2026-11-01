-- #1176: delete_group holds the board and Adunarea Generală settings before the Group lock, so a Group named while the delete runs is never deleted.
--
-- Follow-up of #1129 (PR #1161), where CodeRabbit found the same race for
-- archive_group. private.set_org_setting_impl locks its org_settings row FOR
-- UPDATE and then the Group it names FOR KEY SHARE; private.delete_group_impl
-- locks the target FOR NO KEY UPDATE and the subtree in id order -- none of
-- which conflicts with that -- and its protection check
-- (group_delete_summary -> is_protected_group) reads org_settings without a
-- lock. A Child named the Adunarea Generală during its parent's delete therefore
-- committed after the check and was deleted, the setting left naming a Group
-- that no longer exists. The body is rebuilt from its only definition,
-- 20261005022559_delete_for_good.sql; only the lock and the comment change.

create or replace function private.delete_group_impl(p_group_id bigint, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor      uuid;
  v_group      public.groups%rowtype;
  v_summary    jsonb;
  v_task_ids   bigint[];
  v_event_ids  bigint[];
  v_award      record;
  v_notified   uuid[];
  v_reversed   integer := 0;
begin
  -- 1. Malformed for everyone.
  if p_mode is null or p_mode not in ('everything', 'empty') then
    raise sqlstate 'PT400' using message = 'invalid_delete_mode';
  end if;

  -- #1176: hold the two settings that name a protected Group FOR SHARE before
  -- the Group lock. set_org_setting_impl locks its setting row FOR UPDATE and
  -- then the Group it names FOR KEY SHARE, which no lock below conflicts with,
  -- so without this a Group named board or AG while the delete runs would
  -- commit after the protection check and be deleted. Settings first, then the
  -- Group: set_org_setting_impl's own order, as archive_group_impl does (#1129).
  perform 1
     from public.org_settings as setting
    where setting.key in ('board_group_id', 'adunarea_generala_group_id')
    order by setting.key
      for share;

  -- 2-3. The target first, FOR NO KEY UPDATE (it is a parent), then the gate,
  --    then the rest of the subtree in one id-ordered statement -- archive_group's
  --    order, so the two serialize instead of crossing.
  select * into v_group from public.groups where id = p_group_id for no key update;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  v_actor := private.require_group_remover(p_group_id);
  perform 1
     from public.groups as descendant
    where descendant.path @> array[p_group_id]
      and descendant.id <> p_group_id
    order by descendant.id
      for no key update;

  v_summary := private.group_delete_summary(p_group_id);

  -- 6. State. Protected Groups are never deleted, in any mode, nor is any
  --    Group whose subtree holds one.
  if (v_summary ->> 'protected')::boolean then
    raise sqlstate 'PT409' using message = 'group_protected';
  end if;
  if p_mode = 'empty' and (
       (v_summary ->> 'subgroups')::integer > 0
    or (v_summary ->> 'tasks')::integer > 0
    or (v_summary ->> 'events')::integer > 0
    or (v_summary ->> 'announcements')::integer > 0
    or (v_summary ->> 'campaigns')::integer > 0
    or (v_summary ->> 'applications')::integer > 0
    or (v_summary ->> 'requests')::integer > 0)
  then
    raise sqlstate 'PT409' using message = 'group_not_empty', detail = v_summary::text;
  end if;

  -- 7a. Mode empty deletes the Group rows and nothing else: content that a
  --     concurrent insert slipped in after the check above makes this DELETE
  --     fail its NO ACTION foreign key (23503) instead of being removed unseen.
  if p_mode = 'empty' then
    delete from public.groups where path @> array[p_group_id];
    return v_summary || jsonb_build_object('mode', p_mode, 'points_reversed', 0);
  end if;

  -- 7b. Mode everything. Content first, then the Groups.
  select coalesce(array_agg(locked.id order by locked.id), '{}'::bigint[])
    into v_task_ids
    from (
      select task.id
        from public.tasks as task
        join public.groups as owner on owner.id = task.group_id
       where owner.path @> array[p_group_id]
       order by task.id
         for no key update of task
    ) as locked;

  -- Taking an award back keeps reopen_task's authority here too: a Group
  -- Manager below level 6 evaluates only the work of ACTIVE Groups on their
  -- path, so a subtree holding points in an archived Group is BC's to delete.
  if exists (
    select 1
      from (
        select entry.task_id
          from public.points_ledger as entry
         where entry.task_id = any (v_task_ids)
           and entry.reason in ('task', 'task_reversal')
         group by entry.task_id, entry.member_id
        having sum(entry.delta) <> 0
      ) as staked
     where not coalesce(private.can_evaluate_task(staked.task_id), false))
  then
    raise exception using errcode = '42501', message = 'task_evaluate_forbidden';
  end if;

  for v_award in
    select effect.member_id, sum(effect.points)::integer as points
      from private.delete_tasks_effect(v_task_ids, v_actor, 'Grup șters definitiv') as effect
     group by effect.member_id
     order by effect.member_id
  loop
    v_reversed := v_reversed + v_award.points;
    v_notified := v_notified || v_award.member_id;
  end loop;

  -- Completed-work Requests still pending or rejected (an approved one went
  -- with its Task above), with their Notifications.
  perform 1
     from public.completed_work_requests as request
     join public.groups as owner on owner.id = request.group_id
    where owner.path @> array[p_group_id]
    order by request.id
      for update of request;
  delete from public.notifications
   where subject in (
     select 'completed_work_request:' || request.id::text
       from public.completed_work_requests as request
       join public.groups as owner on owner.id = request.group_id
      where owner.path @> array[p_group_id]);
  delete from public.completed_work_requests as request
   using public.groups as owner
   where owner.id = request.group_id
     and owner.path @> array[p_group_id];

  -- Events (their RSVPs cascade) and their Notifications.
  select coalesce(array_agg(locked.id order by locked.id), '{}'::bigint[])
    into v_event_ids
    from (
      select event.id
        from public.events as event
        join public.groups as owner on owner.id = event.group_id
       where owner.path @> array[p_group_id]
       order by event.id
         for update of event
    ) as locked;
  delete from public.notifications
   where subject in (select 'event:' || gone.id::text from unnest(v_event_ids) as gone(id));
  delete from public.events where id = any (v_event_ids);

  -- Announcements (their reads cascade) and their Notifications.
  perform 1
     from public.announcements as announcement
     join public.groups as owner on owner.id = announcement.group_id
    where owner.path @> array[p_group_id]
    order by announcement.id
      for update of announcement;
  delete from public.notifications
   where subject in (
     select 'announcement:' || announcement.id::text
       from public.announcements as announcement
       join public.groups as owner on owner.id = announcement.group_id
      where owner.path @> array[p_group_id]);
  delete from public.announcements as announcement
   using public.groups as owner
   where owner.id = announcement.group_id
     and owner.path @> array[p_group_id];

  -- Campaigns: everything they labelled lived in this subtree and is gone.
  delete from public.campaigns as campaign
   using public.groups as owner
   where owner.id = campaign.group_id
     and owner.path @> array[p_group_id];

  -- Applications' Notifications; the Applications and roster rows cascade
  -- with their Group. One statement for the whole subtree: groups_parent_id_fkey
  -- is NO ACTION, checked once the statement ends.
  delete from public.notifications
   where subject in (
     select 'group_application:' || application.id::text
       from public.group_applications as application
       join public.groups as owner on owner.id = application.group_id
      where owner.path @> array[p_group_id]);
  delete from public.groups where path @> array[p_group_id];

  perform private.notify(v_notified, 'system'::public.noti_kind,
    'Grup șters: ' || v_group.name,
    'Grupul ' || v_group.name || ' a fost șters; punctele din taskurile lui au fost retrase.',
    null, null, v_actor, null);

  return v_summary || jsonb_build_object(
    'mode', p_mode,
    'points_reversed', v_reversed);
end;
$function$;


comment on function private.delete_group_impl(bigint, text) is
  '#1017 (ruling R38): body of public.delete_group. PT400 invalid_delete_mode unless p_mode is everything or empty (before any gate). Then the two naming settings (board_group_id, adunarea_generala_group_id) FOR SHARE, so a Group named board or AG while the delete runs is protected or the naming waits (#1176). Locks the Group FOR NO KEY UPDATE (42501 group_manage_forbidden if unknown), then private.require_group_remover (archive_group''s authority), then every Group below it FOR NO KEY UPDATE in id order. PT409 group_protected when the subtree holds the Organization Group, an Automatic-Membership Group or the Group named by org_settings board_group_id / adunarea_generala_group_id. Mode empty: PT409 group_not_empty (the summary in DETAIL) when the subtree holds a Child Group, Task, Event, Announcement, Campaign, Application or Completed-work Request -- roster rows do not count and go with the Group, and nothing but the Group rows is deleted, so content added after the check fails the delete (23503). Mode everything: 42501 task_evaluate_forbidden unless the caller may evaluate every Task that still holds points (reopen_task''s rule; below level 6 that excludes archived Groups); the subtree''s Tasks locked in id order and removed through private.delete_tasks_effect (every award reversed first), then its Completed-work Requests, Events (RSVPs cascade), Announcements (reads cascade), Campaigns, the Notifications about each of them, and the Groups (roster rows and Applications cascade); one system Notification per Member whose points were reversed. Returns private.group_delete_summary as it stood, plus mode and points_reversed (the net change).';
