-- The task_create daily cap rises from 100 to 300 (decided 2026-10-23).
--
-- Security pass L3 capped every write that notifies other people at a fixed
-- number per Member over a rolling 24 hours. task_create is spent by
-- create_task, duplicate_task, create_completed_task and once per copy by
-- create_tasks / create_completed_tasks. Leaders recording an Event's finished
-- Tasks for every volunteer filled 100 in one sitting (one bulk call already
-- takes 100 copies), so the cap now allows about three such batches a day.
-- With ~1 000 Members the old sheet's rate (~5 400 finished Tasks from 219
-- Members over ten months) scales to roughly 85 Tasks a day organization-wide,
-- so 300 per Member still bounds a misused account without touching normal
-- work. Every other cap is unchanged.
--
-- require_daily_cap is rebuilt from its latest body
-- (20261006000111_event_created_notification.sql) with the one new limit; the
-- signature is unchanged, so its grants stay as they are.

create or replace function private.require_daily_cap(p_cap text, p_actor uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_used  bigint;
  v_since timestamptz;
begin
  v_limit := case p_cap
    when 'group_application'      then 10
    when 'task_interest'          then 30
    when 'completed_work_request' then 30
    when 'task_create'            then 300
    when 'announcement'           then 20
    when 'event_create'           then 50
  end;
  if v_limit is null then
    raise exception 'unknown daily cap: %', p_cap;
  end if;
  if p_actor is null then
    return;
  end if;

  -- One writer per (cap, Member) at a time; released at commit or rollback.
  perform pg_advisory_xact_lock(hashtextextended('osubb.daily_cap:' || p_cap || ':' || p_actor::text, 0));
  v_since := clock_timestamp() - interval '24 hours';

  v_used := case p_cap
    when 'group_application' then
      (select count(*) from public.group_applications as row_
        where row_.member_id = p_actor and row_.created_at > v_since)
    when 'task_interest' then
      (select count(*) from public.task_activity as row_
        where row_.actor_id = p_actor and row_.kind = 'interest_expressed' and row_.created_at > v_since)
    when 'completed_work_request' then
      (select count(*) from public.completed_work_requests as row_
        where row_.requester_id = p_actor and row_.created_at > v_since)
    when 'task_create' then
      (select count(*) from public.task_activity as row_
        where row_.actor_id = p_actor and row_.kind = 'created' and row_.created_at > v_since)
    when 'announcement' then
      (select count(*) from public.announcements as row_
        where row_.created_by = p_actor and row_.published_at > v_since)
    -- R39: a new Event now notifies its audience, so creating one is capped too.
    when 'event_create' then
      (select count(*) from public.events as row_
        where row_.created_by = p_actor and row_.created_at > v_since)
  end;

  if v_used >= v_limit then
    raise sqlstate 'PT409' using
      message = 'rate_limited',
      detail  = format('%s: at most %s per Member in any 24 hours', p_cap, v_limit);
  end if;
end;
$$;

comment on function private.require_daily_cap(text, uuid) is
  'Security pass L3: refuses PT409 rate_limited when p_actor already has the cap''s limit of writes in the last 24 hours (group_application 10, task_interest 30, completed_work_request 30, task_create 300 -- 100 until 2026-10-23, announcement 20, event_create 50 -- ruling R39), counted on the write''s own rows under a (cap, Member) advisory lock. A null actor (a server-side write) is never capped.';
