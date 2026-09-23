#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"

{
  cat <<'SQL'
begin;
set local client_min_messages = warning;
-- #591 removed these helpers; the historical view being replayed referenced
-- them. Stand-ins live only in this rollback and do not affect date conversion.
create function public.auth_in_dept(text) returns boolean language sql as 'select false';
create function public.auth_in_team(text) returns boolean language sql as 'select false';

-- Reconstruct the pre-#283 column and load dates on both sides of DST.
drop view public.tasks_with_overdue;
truncate public.tasks cascade;
alter table public.tasks
  alter column deadline type date
  using (deadline at time zone 'Europe/Bucharest')::date;

insert into public.tasks (title, difficulty, deadline, group_id) values
  ('Legacy winter deadline', 1, date '2026-01-15', (select id from public.groups where name = 'Educațional')),
  ('Legacy summer deadline', 1, date '2026-07-15', (select id from public.groups where name = 'Educațional')),
  ('Legacy null deadline', 1, null, (select id from public.groups where name = 'Educațional'));
SQL

  cat supabase/migrations/20260911090000_tasks_precise_deadlines.sql

  cat <<'SQL'
do $assert$
begin
  if (select deadline from public.tasks where title = 'Legacy winter deadline')
       is distinct from '2026-01-15 21:59:00+00'::timestamptz then
    raise exception 'winter deadline did not preserve 23:59 Europe/Bucharest';
  end if;

  if (select deadline from public.tasks where title = 'Legacy summer deadline')
       is distinct from '2026-07-15 20:59:00+00'::timestamptz then
    raise exception 'summer deadline did not preserve 23:59 Europe/Bucharest';
  end if;

  if (select deadline from public.tasks where title = 'Legacy null deadline')
       is not null then
    raise exception 'null legacy deadline became non-null';
  end if;
end
$assert$;

rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q

echo "Task deadline upgrade checks passed."
