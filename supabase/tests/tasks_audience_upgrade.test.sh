#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"

{
  cat <<'SQL'
begin;
set local client_min_messages = warning;

drop view public.tasks_with_overdue;
drop policy task_read on public.tasks;
drop function public.claim_open_task(bigint);
drop function private.task_is_unassigned(bigint);
truncate public.tasks cascade;
alter table public.tasks alter column status drop default;
alter table public.tasks alter column status type text using status::text;
drop type public.task_status;
create type public.task_status as enum ('todo', 'progress', 'done', 'overdue', 'open');
alter table public.tasks
  alter column status type public.task_status using status::public.task_status,
  alter column status set default 'todo';

alter table public.tasks drop column audience;
insert into public.tasks (title, difficulty, status, dept_id) values
  ('Legacy open Task', 1, 'open', 'edu'),
  ('Legacy direct Task', 1, 'todo', 'edu');
SQL

  cat supabase/migrations/20260911091000_tasks_audience.sql

  cat <<'SQL'
do $assert$
begin
  if (select audience from public.tasks where title = 'Legacy open Task')
       is distinct from 'org' then
    raise exception 'legacy open Task did not retain organization reach';
  end if;

  if (select audience from public.tasks where title = 'Legacy direct Task')
       is distinct from 'local' then
    raise exception 'legacy non-open Task did not receive local audience';
  end if;
end
$assert$;

rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q

echo "Task audience upgrade checks passed."
