-- #1017: delete for good -- Tasks (with or without their points), Groups (everything / empty), Events and Campaigns.
--
-- Ruling R38 (2026-10-05) amends ADR-0007 (a Task is cancelled, never removed)
-- and ADR-0009 (a wrongly placed Group is archived, never deleted): whoever
-- manages a Task, Group, Event or Campaign may remove it for good. Nothing in
-- this file adds an authority rule. Each command reuses the gate its kind
-- already has (cancel_task's Task Manager, archive_group's archiver,
-- cancel_event's can_manage_event, update_campaign's Campaign manager), and the
-- one extra gate on a Task's points is reopen_task's own evaluator rule,
-- because taking points back IS a reversal.
--
-- Points are never erased. Every open award of a deleted Task is reversed
-- first through the ledger's reversal path (#317: the reversal trio on the
-- Evaluation, then a `task_reversal` row), so each Member's total, the
-- Clasament and the Department Cup drop by exactly the award. Only then do the
-- ledger rows lose their reference: task_id and evaluation_id are nulled
-- together and `deleted_task_title` keeps the Task's name, so the pair still
-- reads as "+N, -N for Task X" in a Member's history. The foreign keys stay
-- NO ACTION on purpose -- a delete path that forgot this step fails loudly
-- instead of silently rewriting the ledger.
--
-- Lock discipline (conventions section 2): every row that is or may be a parent
-- -- a Task that may be an Umbrella, a Group, a Campaign -- is taken FOR NO KEY
-- UPDATE, children in one id-ordered statement, before anything is written;
-- the final DELETE upgrades each lock. A concurrent insert that slips a new
-- child under a locked parent makes that DELETE fail its foreign key (23503),
-- so the whole command rolls back rather than removing anything unseen.

-- ==================== 1 · The ledger keeps a deleted Task's name ====================

alter table public.points_ledger
  add column deleted_task_title text;

comment on column public.points_ledger.deleted_task_title is
  '#1017 (ruling R38): the title of the Task this task/task_reversal row belonged to, set only when that Task was deleted for good -- at the same moment task_id and evaluation_id are nulled. Null on every row whose Task still exists and on every sanction.';

alter table public.points_ledger
  drop constraint if exists points_ledger_task_reference_ck;
alter table public.points_ledger
  add constraint points_ledger_task_reference_ck check (
    case
      when reason in ('task', 'task_reversal') then
        (task_id is not null and evaluation_id is not null and deleted_task_title is null)
        or (task_id is null and evaluation_id is null
            and deleted_task_title is not null
            and char_length(deleted_task_title) between 1 and 120)
      else task_id is null and evaluation_id is null and deleted_task_title is null
    end
  );

-- ==================== 2 · The immutability guards admit exactly one delete ====================
--
-- task_activity and task_evaluations refuse every DELETE. The one exception is
-- private.delete_tasks_effect, which names the Task ids it is removing in the
-- transaction-local setting osubb.deleting_task_ids just before it deletes and
-- clears it just after. A row of any other Task is still refused, and no client
-- role holds DELETE on either table at all.

create or replace function private.reject_task_activity_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE'
     and current_user not in ('anon', 'authenticated', 'service_role')
     and old.task_id = any (coalesce(nullif(current_setting('osubb.deleting_task_ids', true), ''), '{}')::bigint[])
  then
    return old;
  end if;
  raise exception using errcode = '23514', message = 'task_activity_immutable';
end;
$function$;

create or replace function private.guard_task_evaluation_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    -- #1017: the Task is being deleted for good by private.delete_tasks_effect,
    -- which has already reversed this Evaluation's points if it had any.
    if current_user not in ('anon', 'authenticated', 'service_role')
       and old.task_id = any (coalesce(nullif(current_setting('osubb.deleting_task_ids', true), ''), '{}')::bigint[])
    then
      return old;
    end if;
    raise exception using errcode = '23514', message = 'task_evaluation_immutable';
  end if;

  -- tg_op = 'UPDATE': allowed only when the row is still open (old.reversed_at
  -- is null), the new row sets all three reversal columns together, and
  -- every other column — source included — is left exactly as it was.
  -- Comparing to_jsonb(new)/to_jsonb(old) with the reversal trio subtracted
  -- out, rather than naming every remaining column explicitly, means a
  -- column added to this table later stays immutable automatically, with no
  -- matching edit needed here.
  if old.reversed_at is null
     and new.reversed_at is not null
     and new.reversed_by is not null
     and new.reversal_reason is not null
     and (to_jsonb(new) - array['reversed_at', 'reversed_by', 'reversal_reason'])
         = (to_jsonb(old) - array['reversed_at', 'reversed_by', 'reversal_reason'])
  then
    return new;
  end if;

  raise exception using errcode = '23514', message = 'task_evaluation_immutable';
end;
$function$;

-- ==================== 3 · Points at stake ====================

create function private.task_points_at_stake(p_task_ids bigint[])
returns table (member_id uuid, points integer)
language sql
stable
security definer
set search_path = ''
as $function$
  select entry.member_id, sum(entry.delta)::integer
    from public.points_ledger as entry
   where entry.task_id = any (p_task_ids)
     and entry.reason in ('task', 'task_reversal')
   group by entry.member_id
  having sum(entry.delta) <> 0
   order by entry.member_id;
$function$;

comment on function private.task_points_at_stake(bigint[]) is
  '#1017: the net Task Points the given Tasks still hold, per Member -- every task/task_reversal ledger row of those Tasks summed, Members at zero left out. An award a reopen already reversed nets to zero and is not at stake. Read by delete_task''s refusal, the two previews and private.delete_tasks_effect. Granted to nobody.';

revoke execute on function private.task_points_at_stake(bigint[]) from public, anon, authenticated, service_role;

-- ==================== 4 · The effect: remove Tasks, reversing their points first ====================

create function private.delete_tasks_effect(p_task_ids bigint[], p_actor uuid, p_reason text)
returns table (member_id uuid, points integer)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ids    bigint[];
  v_award  record;
begin
  select coalesce(array_agg(distinct given.id order by given.id), '{}'::bigint[])
    into v_ids
    from unnest(p_task_ids) as given(id)
   where given.id is not null;
  if cardinality(v_ids) = 0 then
    return;
  end if;

  -- 1. Reverse every award still standing, exactly as reopen_task does: the
  --    reversal trio on the Evaluation (the only UPDATE its guard permits) and
  --    one offsetting task_reversal row for the Member it credited. Driven by
  --    the ledger, so an award is reversed by what it actually paid.
  for v_award in
    select entry.evaluation_id, entry.task_id, entry.member_id, sum(entry.delta)::integer as net
      from public.points_ledger as entry
     where entry.task_id = any (v_ids)
       and entry.reason in ('task', 'task_reversal')
     group by entry.evaluation_id, entry.task_id, entry.member_id
    having sum(entry.delta) <> 0
     order by entry.evaluation_id, entry.member_id
  loop
    update public.task_evaluations
       set reversed_at     = now(),
           reversed_by     = p_actor,
           reversal_reason = p_reason
     where id = v_award.evaluation_id
       and reversed_at is null;
    insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id)
    values (v_award.member_id, -v_award.net, 'task_reversal', v_award.task_id, v_award.evaluation_id);

    member_id := v_award.member_id;
    points := -v_award.net;
    return next;
  end loop;

  -- 2. The ledger keeps every row; only the reference goes, together, with the
  --    Task's name kept beside it (points_ledger_task_reference_ck).
  update public.points_ledger as entry
     set task_id = null,
         evaluation_id = null,
         deleted_task_title = task.title
    from public.tasks as task
   where task.id = entry.task_id
     and entry.task_id = any (v_ids);

  -- 3. What was only ABOUT these Tasks goes with them: their Notifications
  --    (their push deliveries cascade) and the approved Completed-work
  --    Requests that produced them, with those Requests' Notifications.
  delete from public.notifications as notification
   where notification.task_id = any (v_ids)
      or notification.subject in (select 'task:' || gone.id::text from unnest(v_ids) as gone(id))
      or notification.subject in (
           select 'completed_work_request:' || request.id::text
             from public.completed_work_requests as request
            where request.task_id = any (v_ids));
  delete from public.completed_work_requests as request
   where request.task_id = any (v_ids);

  -- 4. A copy keeps existing; it only forgets which Task it was copied from.
  update public.tasks
     set duplicated_from_task_id = null
   where duplicated_from_task_id = any (v_ids);

  -- 5. The Task rows and their history, children before parents.
  perform set_config('osubb.deleting_task_ids', v_ids::text, true);
  delete from public.task_candidates  where task_id = any (v_ids);
  delete from public.task_activity    where task_id = any (v_ids);
  delete from public.task_evaluations where task_id = any (v_ids);
  delete from public.task_assignments where task_id = any (v_ids);
  delete from public.tasks where id = any (v_ids) and parent_task_id is not null;
  delete from public.tasks where id = any (v_ids);
  perform set_config('osubb.deleting_task_ids', '', true);
end;
$function$;

comment on function private.delete_tasks_effect(bigint[], uuid, text) is
  '#1017 (ruling R38): the effect of deleting Tasks for good, with no authority check of its own (conventions section 10: a command''s gates and its effect are separable). The caller has already gated and locked every id. Reverses every award still standing through the ledger''s reversal path (the Evaluation''s reversal trio with p_actor and p_reason, plus a task_reversal row), nulls the ledger rows'' task_id and evaluation_id together while recording deleted_task_title, deletes the Tasks'' Notifications and the approved Completed-work Requests that produced them, nulls duplicated_from_task_id on copies, then deletes Candidatures, Activity, Evaluations, Assignments and the Tasks (Subtasks first) under the osubb.deleting_task_ids setting the two immutability guards read. Returns one row per reversed award (member_id, points taken back). Granted to nobody: delete_task and delete_group call it.';

revoke execute on function private.delete_tasks_effect(bigint[], uuid, text) from public, anon, authenticated, service_role;

-- ==================== 5 · delete_task ====================

create function private.delete_task_impl(p_task_id bigint, p_with_points boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor      uuid;
  v_parent_id  bigint;
  v_task       public.tasks%rowtype;
  v_ids        bigint[];
  v_total      integer;
  v_members    jsonb;
  v_award      record;
  v_reversed   integer := 0;
  v_notified   uuid[];
begin
  -- 1. Nothing is malformed for everyone: p_with_points defaults to false.

  -- 2. Gate + visibility (claimless and deactivated callers end here).
  v_actor := private.require_task_visible(p_task_id);

  -- 3. The locks, parent before child, every row that may be a parent FOR NO
  --    KEY UPDATE (conventions section 2). The unlocked read only says WHICH
  --    parent to lock first; every decision below reads the locked rows.
  select parent_task_id into v_parent_id from public.tasks where id = p_task_id;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  if v_parent_id is not null then
    perform 1 from public.tasks where id = v_parent_id for no key update;
  end if;
  select * into v_task from public.tasks where id = p_task_id for no key update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  if v_task.parent_task_id is distinct from v_parent_id then
    raise sqlstate 'PT409' using message = 'task_parent_changed';
  end if;
  -- An Umbrella's Subtasks, in ONE id-ordered statement, before any write.
  select coalesce(array_agg(locked.id order by locked.id), '{}'::bigint[])
    into v_ids
    from (
      select sub.id
        from public.tasks as sub
       where sub.parent_task_id = p_task_id
       order by sub.id
         for no key update
    ) as locked;
  v_ids := array[p_task_id] || v_ids;

  -- 4. Authority under lock: the Task's MANAGER, as cancel_task.
  perform private.require_task_manager(p_task_id);

  -- 6. Points. A Task (or any of its Subtasks) still holding an award is
  --    refused unless the caller chose to take the points back; the refusal
  --    names the total and every Member, so the app can ask.
  select coalesce(sum(stake.points), 0)::integer,
         coalesce(jsonb_agg(jsonb_build_object('member_id', stake.member_id, 'points', stake.points)
                            order by stake.points desc, stake.member_id), '[]'::jsonb)
    into v_total, v_members
    from private.task_points_at_stake(v_ids) as stake;
  if v_members <> '[]'::jsonb then
    if not coalesce(p_with_points, false) then
      raise sqlstate 'PT409' using
        message = 'task_has_points',
        detail = jsonb_build_object('total', v_total, 'members', v_members)::text;
    end if;
    -- Taking an award back is reopen_task's act, so it keeps reopen_task's
    -- authority: the Task's evaluator, and below level 6 a Group Responsible
    -- reverses neither their own award nor a Manager's or Responsible's.
    for v_award in
      select entry.task_id, entry.member_id, task.group_id
        from public.points_ledger as entry
        join public.tasks as task on task.id = entry.task_id
       where entry.task_id = any (v_ids)
         and entry.reason in ('task', 'task_reversal')
       group by entry.task_id, entry.member_id, task.group_id
      having sum(entry.delta) <> 0
       order by entry.task_id, entry.member_id
    loop
      if not coalesce(private.can_evaluate_task(v_award.task_id), false)
         or (coalesce(private.actor_level(v_actor), -1) < 6
             and private.group_role_of(v_award.group_id, v_actor) = 'responsible'
             and (v_award.member_id = v_actor
                  or coalesce(private.group_role_of(v_award.group_id, v_award.member_id), 'member')
                       in ('manager', 'responsible')))
      then
        raise exception using errcode = '42501', message = 'task_evaluate_forbidden';
      end if;
    end loop;
  end if;

  -- 7. The effect, then one Notification per Member whose points were taken back.
  for v_award in
    select effect.member_id, sum(effect.points)::integer as points
      from private.delete_tasks_effect(v_ids, v_actor, 'Task șters definitiv') as effect
     group by effect.member_id
     order by effect.member_id
  loop
    v_reversed := v_reversed + v_award.points;
    v_notified := v_notified || v_award.member_id;
  end loop;
  perform private.notify(v_notified, 'task'::public.noti_kind,
    'Task șters: ' || v_task.title,
    'Taskul ' || v_task.title || ' a fost șters; punctele au fost retrase.',
    null, null, v_actor);

  return jsonb_build_object(
    'deleted_tasks', cardinality(v_ids),
    'points_reversed', v_reversed,
    'members', coalesce(cardinality(v_notified), 0));
end;
$function$;

create function public.delete_task(p_task_id bigint, p_with_points boolean default false)
returns jsonb
language sql
set search_path = ''
as $function$
  select private.delete_task_impl(p_task_id, p_with_points);
$function$;

comment on function private.delete_task_impl(bigint, boolean) is
  '#1017 (ruling R38): body of public.delete_task. Gate: private.require_task_visible (42501 task_command_forbidden for a claimless or inactive caller, PT404 task_not_found for a Task the caller cannot read). Locks the Umbrella parent of a Subtask, the Task and every Subtask of an Umbrella FOR NO KEY UPDATE (one id-ordered statement for the Subtasks) before anything is written; PT409 task_parent_changed if the parent moved under the lock. Authority: private.require_task_manager (42501 task_manage_forbidden), as cancel_task. While any of those Tasks still holds Task Points: PT409 task_has_points with DETAIL {"total", "members": [{"member_id", "points"}]} unless p_with_points; with it, reopen_task''s rule for every award (private.can_evaluate_task, and below level 6 a Group Responsible reverses neither their own award nor a Manager''s or Responsible''s) or 42501 task_evaluate_forbidden. Then private.delete_tasks_effect and one task Notification per Member whose points were reversed. Returns {"deleted_tasks", "points_reversed" (the net change, e.g. -12), "members"}.';
comment on function public.delete_task(bigint, boolean) is
  '#1017 (ruling R38): a Task Manager deletes a Task for good -- with its Subtasks if it is an Umbrella, its Assignments, Candidatures, Activity, Evaluations and Notifications. A Task that still holds Task Points is refused (PT409 task_has_points, the total and Members in DETAIL) unless p_with_points, which reverses every award through the ledger''s reversal path first and notifies each Member once. Body: private.delete_task_impl.';

revoke execute on function private.delete_task_impl(bigint, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.delete_task(bigint, boolean) from public, anon, authenticated, service_role;
grant execute on function private.delete_task_impl(bigint, boolean) to authenticated;
grant execute on function public.delete_task(bigint, boolean) to authenticated;

-- ==================== 6 · task_delete_preview ====================

create function private.task_delete_preview_impl(p_task_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ids     bigint[];
  v_total   integer;
  v_members jsonb;
begin
  perform private.require_task_visible(p_task_id);
  perform private.require_task_manager(p_task_id);

  select array[p_task_id] || coalesce(array_agg(sub.id order by sub.id), '{}'::bigint[])
    into v_ids
    from public.tasks as sub
   where sub.parent_task_id = p_task_id;

  select coalesce(sum(stake.points), 0)::integer,
         coalesce(jsonb_agg(jsonb_build_object('member_id', stake.member_id, 'points', stake.points)
                            order by stake.points desc, stake.member_id), '[]'::jsonb)
    into v_total, v_members
    from private.task_points_at_stake(v_ids) as stake;

  return jsonb_build_object(
    'subtasks', cardinality(v_ids) - 1,
    'total', v_total,
    'members', v_members);
end;
$function$;

create function public.task_delete_preview(p_task_id bigint)
returns jsonb
language sql
set search_path = ''
as $function$
  select private.task_delete_preview_impl(p_task_id);
$function$;

comment on function private.task_delete_preview_impl(bigint) is
  '#1017: body of public.task_delete_preview. The same gate as delete_task (require_task_visible, then require_task_manager), no row locks. Returns {"subtasks", "total", "members": [{"member_id", "points"}]} -- what delete_task would take back.';
comment on function public.task_delete_preview(bigint) is
  '#1017 (ruling R38): what deleting this Task for good would take with it, for the Task Manager''s confirmation dialog -- its Subtask count and the Task Points it still holds, in total and per Member. Body: private.task_delete_preview_impl.';

revoke execute on function private.task_delete_preview_impl(bigint) from public, anon, authenticated, service_role;
revoke execute on function public.task_delete_preview(bigint) from public, anon, authenticated, service_role;
grant execute on function private.task_delete_preview_impl(bigint) to authenticated;
grant execute on function public.task_delete_preview(bigint) to authenticated;

-- ==================== 7 · delete_event ====================

create function private.delete_event_impl(p_event_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid;
  v_event public.events%rowtype;
  v_rsvps integer;
begin
  -- cancel_event's gate, step for step (#934): the Event is managed by one rule.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end;
  -- Nothing hangs below an Event but its RSVPs, so the target is FOR UPDATE.
  select * into v_event from public.events where id = p_event_id for update;
  if not found or coalesce(private.actor_level(v_actor), -1) < v_event.min_level then
    raise sqlstate 'PT404' using message = 'event_not_found';
  end if;
  perform 1 from public.profiles where id = v_actor and status = 'activ' for share;
  if not found then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  if not private.can_read_event(v_event.group_id, v_event.min_level, v_actor) then
    raise sqlstate 'PT404' using message = 'event_not_found';
  end if;
  if not private.can_manage_event(p_event_id) then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  perform 1
     from public.groups as target
     join public.group_members as gm on target.path @> array[gm.group_id]
    where target.id = v_event.group_id
      and gm.member_id = v_actor
      and gm.group_role in ('manager', 'responsible')
    order by gm.group_id
      for share of gm;
  if not private.can_manage_event(p_event_id) then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;

  -- The RSVPs cascade with the row; the Event's Notifications go with it. An
  -- Announcement published together with the Event (#909) is its own row and
  -- stays.
  select count(*)::integer into v_rsvps from public.event_attendance where event_id = p_event_id;
  delete from public.notifications where subject = 'event:' || p_event_id::text;
  delete from public.events where id = p_event_id;

  return jsonb_build_object('rsvps', v_rsvps);
end;
$function$;

create function public.delete_event(p_event_id bigint)
returns jsonb
language sql
set search_path = ''
as $function$
  select private.delete_event_impl(p_event_id);
$function$;

comment on function private.delete_event_impl(bigint) is
  '#1017 (ruling R38): body of public.delete_event. cancel_event''s gate without its reason and state checks: 42501 calendar_manage_forbidden for a claimless or inactive caller; the Event locked FOR UPDATE; PT404 event_not_found when missing or unreadable (below its Minimum Level, outside a Private Group); private.can_manage_event read, the deciding roster rows held FOR SHARE, and read again (42501 calendar_manage_forbidden). A cancelled Event may be deleted too. Deletes the Event''s Notifications (subject event:<id>) and the Event; its RSVPs cascade; an Announcement published with it (#909) is left in place. Returns {"rsvps"}.';
comment on function public.delete_event(bigint) is
  '#1017 (ruling R38): whoever manages an Event deletes it for good, with its RSVPs and Notifications. An Announcement created together with it stays. Body: private.delete_event_impl.';

revoke execute on function private.delete_event_impl(bigint) from public, anon, authenticated, service_role;
revoke execute on function public.delete_event(bigint) from public, anon, authenticated, service_role;
grant execute on function private.delete_event_impl(bigint) to authenticated;
grant execute on function public.delete_event(bigint) to authenticated;

-- ==================== 8 · delete_campaign ====================

create function private.delete_campaign_impl(p_campaign_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor    uuid := (select auth.uid());
  v_group_id bigint;
  v_tasks    integer;
  v_events   integer;
begin
  -- update_campaign's gate (#690).
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (
       select 1 from public.profiles as profile
        where profile.id = v_actor and profile.status = 'activ') then
    raise exception using errcode = '42501', message = 'campaign_manage_forbidden';
  end if;
  -- The Campaign is a parent of Tasks and Events: FOR NO KEY UPDATE.
  select campaign.group_id into v_group_id
    from public.campaigns as campaign
   where campaign.id = p_campaign_id
     for no key update;
  if not found then
    raise sqlstate 'PT404' using message = 'campaign_not_found';
  end if;
  perform private.require_campaign_manager(v_group_id);

  -- A Campaign is a reporting label (ADR-0007): what it labelled stays, without
  -- the label. Locked in id order before the writes.
  perform 1 from public.tasks where campaign_id = p_campaign_id order by id for no key update;
  perform 1 from public.events where campaign_id = p_campaign_id order by id for no key update;
  update public.tasks set campaign_id = null where campaign_id = p_campaign_id;
  get diagnostics v_tasks = row_count;
  update public.events set campaign_id = null where campaign_id = p_campaign_id;
  get diagnostics v_events = row_count;
  delete from public.campaigns where id = p_campaign_id;

  return jsonb_build_object('tasks', v_tasks, 'events', v_events);
end;
$function$;

create function public.delete_campaign(p_campaign_id bigint)
returns jsonb
language sql
set search_path = ''
as $function$
  select private.delete_campaign_impl(p_campaign_id);
$function$;

comment on function private.delete_campaign_impl(bigint) is
  '#1017 (ruling R38): body of public.delete_campaign. update_campaign''s gate: 42501 campaign_manage_forbidden for a claimless or inactive caller; the Campaign locked FOR NO KEY UPDATE; PT404 campaign_not_found; private.require_campaign_manager on its Group (42501 campaign_manage_forbidden). Locks the labelled Tasks, then Events, in id order, sets their campaign_id to null and deletes the Campaign. Returns {"tasks", "events"}: how many lost the label.';
comment on function public.delete_campaign(bigint) is
  '#1017 (ruling R38): whoever manages a Campaign deletes it for good. A Campaign is a reporting label (ADR-0007), so the Tasks and Events it labelled keep existing without it. Body: private.delete_campaign_impl.';

revoke execute on function private.delete_campaign_impl(bigint) from public, anon, authenticated, service_role;
revoke execute on function public.delete_campaign(bigint) from public, anon, authenticated, service_role;
grant execute on function private.delete_campaign_impl(bigint) to authenticated;
grant execute on function public.delete_campaign(bigint) to authenticated;

-- ==================== 9 · Groups: who may remove one, and what it holds ====================

create function private.require_group_remover(p_group_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor     uuid;
  v_parent_id bigint;
begin
  select parent_id into v_parent_id from public.groups where id = p_group_id;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  -- archive_group's two branches, unchanged: a top-level Group is BC's and the
  -- Moderator's; a Child Group is its Managers' (the parent's included).
  if v_parent_id is null then
    begin
      v_actor := private.require_active_member();
    exception when insufficient_privilege then
      raise exception using errcode = '42501', message = 'group_manage_forbidden';
    end;
    perform 1 from public.profiles as profile
      where profile.id = v_actor and profile.status = 'activ'
      for share of profile;
    if not found or coalesce(private.actor_level(v_actor), -1) < 6 then
      raise exception using errcode = '42501', message = 'group_manage_forbidden';
    end if;
  else
    v_actor := private.require_group_manager(p_group_id);
  end if;
  return v_actor;
end;
$function$;

comment on function private.require_group_remover(bigint) is
  '#1017 (ruling R38): who may delete a Group for good -- exactly who may archive it (#584): for a top-level Group a live active Member at level >= 6 (Profile held FOR SHARE), for a Child Group private.require_group_manager (a Group Manager on its path, the parent''s included, or level >= 6). 42501 group_manage_forbidden otherwise, an unknown id included. Returns the actor. Granted to nobody.';

revoke execute on function private.require_group_remover(bigint) from public, anon, authenticated, service_role;

create function private.group_delete_summary(p_group_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with subtree as (
    select grp.id, grp.is_organization, grp.automatic_membership
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
  ), settings as (
    select setting.value
      from public.org_settings as setting
     where setting.key in ('board_group_id', 'adunarea_generala_group_id')
       and setting.value ~ '^[0-9]+$'
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
    'protected',         exists (select 1 from subtree
                           where subtree.is_organization
                              or subtree.automatic_membership
                              or subtree.id::text in (select settings.value from settings)));
$function$;

comment on function private.group_delete_summary(bigint) is
  '#1017: what a Group''s subtree holds, for group_delete_preview and delete_group. Counts Child Groups (subgroups, the Group itself excluded), distinct roster Members, Tasks, Tasks still holding Task Points, the net points and the Members holding them, Events, Announcements, Campaigns, Applications (every status) and Completed-work Requests not yet turned into a Task; protected is true when the subtree contains the Organization Group, an Automatic-Membership Group, or the Group named by org_settings board_group_id or adunarea_generala_group_id. Granted to nobody.';

revoke execute on function private.group_delete_summary(bigint) from public, anon, authenticated, service_role;

create function private.group_delete_preview_impl(p_group_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.require_group_remover(p_group_id);
  return private.group_delete_summary(p_group_id);
end;
$function$;

create function public.group_delete_preview(p_group_id bigint)
returns jsonb
language sql
set search_path = ''
as $function$
  select private.group_delete_preview_impl(p_group_id);
$function$;

comment on function private.group_delete_preview_impl(bigint) is
  '#1017: body of public.group_delete_preview: private.require_group_remover, then private.group_delete_summary.';
comment on function public.group_delete_preview(bigint) is
  '#1017 (ruling R38): what deleting a Group for good would take with it -- Child Groups, Members, Tasks (and how many still hold Task Points, with the total), Events, Announcements, Campaigns, Applications and Completed-work Requests -- and whether the Group is protected. Callable by whoever may archive the Group (42501 group_manage_forbidden otherwise). Body: private.group_delete_preview_impl.';

revoke execute on function private.group_delete_preview_impl(bigint) from public, anon, authenticated, service_role;
revoke execute on function public.group_delete_preview(bigint) from public, anon, authenticated, service_role;
grant execute on function private.group_delete_preview_impl(bigint) to authenticated;
grant execute on function public.group_delete_preview(bigint) to authenticated;

-- ==================== 10 · delete_group ====================

create function private.delete_group_impl(p_group_id bigint, p_mode text)
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

create function public.delete_group(p_group_id bigint, p_mode text)
returns jsonb
language sql
set search_path = ''
as $function$
  select private.delete_group_impl(p_group_id, p_mode);
$function$;

comment on function private.delete_group_impl(bigint, text) is
  '#1017 (ruling R38): body of public.delete_group. PT400 invalid_delete_mode unless p_mode is everything or empty (before any gate). Locks the Group FOR NO KEY UPDATE (42501 group_manage_forbidden if unknown), then private.require_group_remover (archive_group''s authority), then every Group below it FOR NO KEY UPDATE in id order. PT409 group_protected when the subtree holds the Organization Group, an Automatic-Membership Group or the Group named by org_settings board_group_id / adunarea_generala_group_id. Mode empty: PT409 group_not_empty (the summary in DETAIL) when the subtree holds a Child Group, Task, Event, Announcement, Campaign, Application or Completed-work Request -- roster rows do not count and go with the Group, and nothing but the Group rows is deleted, so content added after the check fails the delete (23503). Mode everything: 42501 task_evaluate_forbidden unless the caller may evaluate every Task that still holds points (reopen_task''s rule; below level 6 that excludes archived Groups); the subtree''s Tasks locked in id order and removed through private.delete_tasks_effect (every award reversed first), then its Completed-work Requests, Events (RSVPs cascade), Announcements (reads cascade), Campaigns, the Notifications about each of them, and the Groups (roster rows and Applications cascade); one system Notification per Member whose points were reversed. Returns private.group_delete_summary as it stood, plus mode and points_reversed (the net change).';
comment on function public.delete_group(bigint, text) is
  '#1017 (ruling R38, amending ADR-0009): whoever may archive a Group deletes it for good. p_mode = ''empty'' deletes a Group with no content (its roster goes with it) and is refused with PT409 group_not_empty otherwise; p_mode = ''everything'' deletes the whole subtree with all its content, reversing every Task Point first. The Organization Group, Automatic-Membership Groups and the board Group or Adunarea Generală set in Setări are never deleted (PT409 group_protected). Archiving stays public.archive_group. Body: private.delete_group_impl.';

revoke execute on function private.delete_group_impl(bigint, text) from public, anon, authenticated, service_role;
revoke execute on function public.delete_group(bigint, text) from public, anon, authenticated, service_role;
grant execute on function private.delete_group_impl(bigint, text) to authenticated;
grant execute on function public.delete_group(bigint, text) to authenticated;
