#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"

{
  cat <<'SQL'
begin;
set local client_min_messages = warning;

alter table public.tasks drop column assignment_mode;
truncate public.tasks cascade;

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
