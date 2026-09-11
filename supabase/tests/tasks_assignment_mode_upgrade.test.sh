#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"

{
  cat <<'SQL'
begin;
set local client_min_messages = warning;

drop view public.tasks_with_overdue;
alter table public.tasks
  drop column started_at, drop column submitted_at, drop column completed_at,
  drop column unfulfilled_at, drop column cancelled_at,
  drop column queue_opened_at, drop column queue_closed_at,
  drop column review_round, drop column returned_to_progress_at;
drop policy task_read on public.tasks;
drop function public.claim_open_task(bigint);
drop function private.task_is_unassigned(bigint);
truncate public.tasks cascade;
alter table public.tasks alter column status drop default;
alter table public.tasks alter column status type text using status::text;
-- #292: task_activity.from_status/to_status also depend on task_status; this
-- scratch transaction rolls back, so dropping them here is safe.
alter table public.task_activity drop column from_status, drop column to_status;
drop type public.task_status;
create type public.task_status as enum ('todo', 'progress', 'done', 'overdue', 'open');
alter table public.tasks
  alter column status type public.task_status using status::public.task_status,
  alter column status set default 'todo';

alter table public.tasks drop column assignment_mode;

insert into public.tasks (title, difficulty, status, dept_id) values
  ('Legacy open Task', 1, 'open', 'edu'),
  ('Legacy todo Task', 1, 'todo', 'edu'),
  ('Legacy assigned Task', 1, 'progress', 'edu');
SQL

  cat supabase/migrations/20260911092000_tasks_assignment_mode.sql

  cat <<'SQL'
do $assert$
begin
  if (select assignment_mode from public.tasks where title = 'Legacy open Task')
       is distinct from 'public' then
    raise exception 'legacy open Task did not become public';
  end if;

  if exists (
    select 1 from public.tasks
     where title in ('Legacy todo Task', 'Legacy assigned Task')
       and assignment_mode <> 'direct'
  ) then
    raise exception 'legacy non-open Task did not become direct';
  end if;

  insert into public.tasks (title, difficulty, dept_id) values ('New Task', 1, 'edu');
  if (select assignment_mode from public.tasks where title = 'New Task')
       is distinct from 'direct' then
    raise exception 'new Task did not default to direct';
  end if;
end
$assert$;

rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q

echo "Task Assignment Mode upgrade checks passed."
