-- #69: one direct deadline reminder per active Executor and UTC day.
create extension if not exists pg_cron with schema pg_catalog;

create function private.remind_deadlines()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task record;
  v_key text;
  v_count integer := 0;
  v_now timestamptz := now();
begin
  -- Serialize scheduled/manual retries: the unread-only notification index
  -- alone cannot deduplicate a reminder that its recipient already read.
  perform pg_catalog.pg_advisory_xact_lock(69, 1);
  for v_task in
    select task.id, task.title, assignment.member_id
      from public.tasks as task
      join public.task_assignments as assignment on assignment.task_id = task.id
       and assignment.ended_at is null
      join public.profiles as member on member.id = assignment.member_id
       and member.status = 'activ'
     where task.kind = 'task'
       and task.status in ('todo', 'in_progress', 'in_review')
       and task.deadline >= v_now
       and task.deadline <= v_now + interval '48 hours'
  loop
    v_key := 'task:' || v_task.id::text || ':deadline:'
      || (v_now at time zone 'UTC')::date::text;
    if not exists (
      select 1 from public.notifications as notification
       where notification.member_id = v_task.member_id
         and notification.dedupe_key = v_key
    ) then
      v_count := v_count + private.notify(
        array[v_task.member_id], 'deadline', 'Termenul se apropie',
        v_task.title, v_task.id, v_key, null);
    end if;
  end loop;
  return v_count;
end;
$$;
revoke execute on function private.remind_deadlines()
  from public, anon, authenticated, service_role;

select cron.schedule('osubb-daily-deadline-reminders', '0 6 * * *',
  'select private.remind_deadlines()');
