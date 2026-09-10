#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"

{
  cat <<'SQL'
begin;
set local client_min_messages = warning;

alter table public.tasks drop column audience;
truncate public.tasks cascade;
insert into public.tasks (title, difficulty, status) values
  ('Legacy open Task', 1, 'open'),
  ('Legacy direct Task', 1, 'todo');
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
