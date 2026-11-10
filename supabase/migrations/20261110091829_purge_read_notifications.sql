-- #1151: purge read Notifications after 90 days, and index told_of, the subject deletes and the Event reminder.
--
-- Finding M9 of the codebase audit of 2026-10-30, decided on 2026-11-05 in
-- #1144 (decision 7): a read Notification is kept 90 days, an unread one until
-- its Member reads it. Every organization-wide notice adds a row per active
-- Member and nothing deleted any of them, while private.told_of (up to three
-- calls per Event notice, one per Announcement notice) and the subject deletes
-- read every row a recipient ever had.
--
-- "Older than 90 days" is measured from created_at. notifications has no read
-- timestamp; created_at is when the Notification last reached its Member
-- (private.notify moves it forward when it refreshes an unread row through its
-- dedupe key, and a read row is never refreshed). So a read Notification goes
-- 90 days after it was delivered, however late it was opened. The Privacy
-- Notice (#1183) states it that way.

-- 1. private.told_of: member_id = any (...) and (dedupe_key = k or dedupe_key
--    like k || ':%'). Both columns are in the index, so it answers from the
--    index alone; text_pattern_ops makes a LIKE prefix an index condition under
--    any collation once the key is known (a custom plan).
create index notifications_member_dedupe_key_idx
  on public.notifications (member_id, dedupe_key text_pattern_ops);

-- 2. The subject deletes: deleting a Task, an Event, a Group or a Member for
--    good removes every Member's Notifications about one subject or a set of
--    them (private.delete_tasks_effect, delete_event_impl, delete_group_impl,
--    delete_member_impl).
create index notifications_subject_idx
  on public.notifications (subject);

-- 3. private.send_reminders, rebuilt from 20261023190000_all_day_events.sql.
--    The only change: an Event is reminded the day before when starts_at falls
--    in tomorrow's Bucharest day, compared as a range instead of a per-row
--    cast. The same Events qualify, all-day ones included (R63: they start at
--    a Bucharest midnight, the range's closed end).
create or replace function private.send_reminders(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'Europe/Bucharest';
  v_today date := (p_now at time zone 'Europe/Bucharest')::date;
  -- #1151: tomorrow in Bucharest as instants, [00:00, the next 00:00), so the
  -- Event filter compares starts_at itself instead of casting every row. A
  -- day that changes the clock is 23 or 25 hours long; local midnights keep
  -- it whole.
  v_tomorrow_from timestamptz := (v_today + 1)::timestamp at time zone 'Europe/Bucharest';
  v_tomorrow_until timestamptz := (v_today + 2)::timestamp at time zone 'Europe/Bucharest';
  v_count integer := 0;
  v_key text;
  v_members uuid[];
  v_task record;
  v_event record;
  v_announcement public.announcements%rowtype;
begin
  -- 09:00 Bucharest time, whatever the season: the job runs every hour.
  if extract(hour from v_local) <> 9 then
    return 0;
  end if;
  -- #69: serialize scheduled and manual retries; the unread-only key index
  -- alone cannot keep a reminder its recipient already read from repeating.
  perform pg_catalog.pg_advisory_xact_lock(69, 1);

  -- Tasks: the current Executor, three days before and the day before. A
  -- Task handed in for review is out of the Executor's hands.
  for v_task in
    select task.id, task.title, task.deadline, assignment.member_id,
           (task.deadline at time zone 'Europe/Bucharest')::date - v_today as days_left
      from public.tasks as task
      join public.task_assignments as assignment
        on assignment.task_id = task.id and assignment.ended_at is null
      join public.profiles as member
        on member.id = assignment.member_id and member.status = 'activ'
     where task.kind = 'task'
       and task.status in ('todo', 'in_progress')
       and task.deadline is not null
       and (task.deadline at time zone 'Europe/Bucharest')::date - v_today in (1, 3)
  loop
    v_key := 'task:' || v_task.id::text || ':reminder:' || v_today::text;
    if not exists (select 1 from public.notifications as notification
                    where notification.member_id = v_task.member_id
                      and notification.dedupe_key = v_key) then
      v_count := v_count + private.notify(array[v_task.member_id], 'deadline',
        case v_task.days_left when 3 then 'Mai sunt 3 zile: ' else 'Termenul e mâine: ' end || v_task.title,
        'Termen: ' || to_char(v_task.deadline at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI'),
        v_task.id, v_key, null);
    end if;
  end loop;

  -- Events: everyone going who can still read it, the day before it starts.
  for v_event in
    select event.id, event.title, event.starts_at, event.ends_at, event.all_day, event.location, attendance.member_id
      from public.events as event
      join public.event_attendance as attendance
        on attendance.event_id = event.id and attendance.status = 'going'
      join public.profiles as member
        on member.id = attendance.member_id and member.status = 'activ'
     where event.approval_status = 'approved'
       and event.cancelled_at is null
       and event.starts_at >= v_tomorrow_from
       and event.starts_at < v_tomorrow_until
       and private.can_read_event(event.group_id, event.min_level, attendance.member_id)
  loop
    v_key := 'event:' || v_event.id::text || ':reminder:' || v_today::text;
    if not exists (select 1 from public.notifications as notification
                    where notification.member_id = v_event.member_id
                      and notification.dedupe_key = v_key) then
      v_count := v_count + private.notify(array[v_event.member_id], 'event', 'Mâine: ' || v_event.title,
        -- #1098 (R63): an all-day Event has no hour to start at; one that
        -- spans several days names its last (the day before its end).
        case when v_event.all_day then
          'Toată ziua'
          || case when ((v_event.ends_at at time zone 'Europe/Bucharest') - interval '1 day')::date
                       > (v_event.starts_at at time zone 'Europe/Bucharest')::date
                  then ', până la ' || to_char((v_event.ends_at at time zone 'Europe/Bucharest') - interval '1 day', 'DD.MM.YYYY')
                  else '' end
        else 'Începe la ' || to_char(v_event.starts_at at time zone 'Europe/Bucharest', 'HH24:MI') end
          || coalesce(', ' || v_event.location, '') || '.',
        null, v_key, null, '/calendar?event=' || v_event.id::text);
    end if;
  end loop;

  -- Announcements and Deals: everyone the notice reaches, never the author,
  -- the day before the Termen -- not an Event's Announcement, and not a
  -- Member whose latest notice about it came today (it is still fresh; this
  -- also keeps a retry from repeating the reminder).
  for v_announcement in
    select * from public.announcements as announcement
     where announcement.approval_status = 'approved'
       and announcement.deadline is not null
       and not announcement.from_event
       and (announcement.deadline at time zone 'Europe/Bucharest')::date = v_today + 1
  loop
    v_key := 'announcement:' || v_announcement.id::text;
    select coalesce(array_agg(member), '{}'::uuid[]) into v_members
      from unnest(coalesce(private.announcement_recipients(v_announcement), '{}'::uuid[])) as member
     where not exists (
       select 1 from public.notifications as notification
        where notification.member_id = member
          and (notification.dedupe_key = v_key or notification.dedupe_key like v_key || ':%')
          and (notification.created_at at time zone 'Europe/Bucharest')::date = v_today)
       and not exists (
       select 1 from public.notifications as notification
        where notification.member_id = member
          and notification.dedupe_key = v_key || ':termen:' || v_today::text);
    v_count := v_count + private.notify(v_members, 'announce',
      case when v_announcement.kind = 'deal' then 'Oferta se încheie mâine: ' else 'Termen mâine: ' end
        || v_announcement.title,
      'Termen: ' || to_char(v_announcement.deadline at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI'),
      null, v_key || ':termen:' || v_today::text, v_announcement.created_by,
      case when v_announcement.kind = 'deal' then '/anunturi/deals?deal=' else '/anunturi?anunt=' end
        || v_announcement.id::text,
      v_announcement.priority = 'critical');
  end loop;

  return v_count;
end;
$$;

-- 4. The purge: read and delivered more than 90 days ago. Unread rows are
--    never touched. Batches walk the primary key upward, so each id is looked
--    at once and a statement never holds more than one batch of row locks.
create function private.purge_read_notifications(p_batch_size integer default 5000)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - interval '90 days';
  v_batch_size integer := greatest(coalesce(p_batch_size, 5000), 1);
  v_after bigint := 0;
  v_found integer;
  v_last bigint;
  v_deleted integer;
  v_total bigint := 0;
begin
  loop
    with batch as (
      select notification.id
        from public.notifications as notification
       where notification.id > v_after
         and notification.read
         and notification.created_at < v_cutoff
       order by notification.id
       limit v_batch_size
    ), gone as (
      delete from public.notifications as notification
       using batch
       where notification.id = batch.id
      returning notification.id
    )
    select (select count(*) from batch), (select max(batch.id) from batch), (select count(*) from gone)
      into v_found, v_last, v_deleted;
    v_total := v_total + v_deleted;
    exit when v_found < v_batch_size;
    v_after := v_last;
  end loop;
  return v_total;
end;
$$;
revoke execute on function private.purge_read_notifications(integer) from public, anon, authenticated, service_role;
comment on function private.purge_read_notifications(integer) is
  '#1151 (decision 7 of #1144): the body of the daily pg_cron job osubb-purge-notifications. Deletes every read Notification whose created_at (when it last reached its Member) is more than 90 days before now(), p_batch_size rows at a time in primary-key order (5000 by default; a null or non-positive size is 5000 or 1), and returns how many it deleted; their push_deliveries rows cascade. Unread Notifications are never deleted. Runs as the job owner; granted to nobody.';

-- Daily at 03:30 UTC, between osubb-prune-push-deliveries (03:15) and
-- osubb-purge-cron-history (03:45). cron.schedule replaces a job of the same
-- name in place; a later migration that retires it runs
--   select cron.unschedule('osubb-purge-notifications')
--    where exists (select 1 from cron.job where jobname = 'osubb-purge-notifications');
select cron.schedule('osubb-purge-notifications', '30 3 * * *',
  'select private.purge_read_notifications()');
