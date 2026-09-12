#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"
migration="supabase/migrations/20260911104000_tasks_lifecycle_timestamps.sql"

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

-- Recreate the actual #288 dependency before replaying the migration.
create view public.tasks_with_overdue
with (security_invoker = on)
as
select task.*,
       (coalesce(task.deadline < statement_timestamp(), false)
        and task.status in ('todo', 'in_progress', 'in_review')) as is_overdue
  from public.tasks as task;
revoke all on public.tasks_with_overdue
  from public, anon, authenticated, service_role;
grant select on public.tasks_with_overdue to authenticated, service_role;

insert into public.tasks
  (title, difficulty, dept_id, status, assignment_mode, created_at)
values
  ('Legacy todo timestamps 293', 1, 'edu', 'todo', 'direct', '2026-01-01 10:00+00'),
  ('Legacy progress timestamps 293', 1, 'edu', 'in_progress', 'direct', '2026-01-02 10:00+00'),
  ('Legacy review timestamps 293', 1, 'edu', 'in_review', 'direct', '2026-01-03 10:00+00'),
  ('Legacy completed timestamps 293', 1, 'edu', 'completed', 'direct', '2026-01-04 10:00+00'),
  ('Legacy unfulfilled timestamps 293', 1, 'edu', 'unfulfilled', 'direct', '2026-01-05 10:00+00'),
  ('Legacy cancelled timestamps 293', 1, 'edu', 'cancelled', 'direct', '2026-01-06 10:00+00'),
  ('Legacy public todo timestamps 293', 1, 'edu', 'todo', 'public', '2026-01-07 10:00+00'),
  ('Legacy public completed timestamps 293', 1, 'edu', 'completed', 'public', '2026-01-08 10:00+00');

create temp table before_tasks_293 as
select count(*) as row_count,
       jsonb_agg(id order by id) as ids
  from public.tasks;
create temp table before_ledger_293 as
select count(*) as row_count,
       coalesce(jsonb_agg(to_jsonb(entry) order by entry.id), '[]'::jsonb) as rows
  from public.points_ledger as entry;
SQL

  cat "$migration"

  cat <<'SQL'
do $assert$
begin
  if (select count(*) from public.tasks)
       <> (select row_count from before_tasks_293)
     or (select jsonb_agg(id order by id) from public.tasks)
       <> (select ids from before_tasks_293) then
    raise exception 'lifecycle timestamp migration lost or replaced Tasks';
  end if;

  if (select count(*) from public.points_ledger)
       <> (select row_count from before_ledger_293)
     or coalesce((select jsonb_agg(to_jsonb(entry) order by entry.id)
                    from public.points_ledger as entry), '[]'::jsonb)
       <> (select rows from before_ledger_293) then
    raise exception 'lifecycle timestamp migration changed Points Ledger history';
  end if;

  if exists (
    select 1 from public.tasks
     where title = 'Legacy todo timestamps 293'
       and (started_at is not null or submitted_at is not null
         or completed_at is not null or queue_opened_at is not null)
  ) or exists (
    select 1 from public.tasks
     where title = 'Legacy progress timestamps 293'
       and started_at is distinct from created_at
  ) or exists (
    select 1 from public.tasks
     where title = 'Legacy review timestamps 293'
       and (started_at is distinct from created_at
         or submitted_at is distinct from created_at)
  ) or exists (
    select 1 from public.tasks
     where title = 'Legacy completed timestamps 293'
       and completed_at is distinct from created_at
  ) or exists (
    select 1 from public.tasks
     where title = 'Legacy unfulfilled timestamps 293'
       and unfulfilled_at is distinct from created_at
  ) or exists (
    select 1 from public.tasks
     where title = 'Legacy cancelled timestamps 293'
       and cancelled_at is distinct from created_at
  ) then
    raise exception 'lifecycle timestamps were not reconstructed deterministically';
  end if;

  if exists (
    select 1 from public.tasks
     where title = 'Legacy public todo timestamps 293'
       and (queue_opened_at is distinct from created_at or queue_closed_at is not null)
  ) or exists (
    select 1 from public.tasks
     where title = 'Legacy public completed timestamps 293'
       and (queue_opened_at is distinct from created_at
         or queue_closed_at is distinct from created_at
         or completed_at is distinct from created_at)
  ) then
    raise exception 'queue timestamps were not reconstructed deterministically';
  end if;

  if exists (
    select 1 from public.tasks
     where title like 'Legacy % timestamps 293'
       and (review_round <> 0 or returned_to_progress_at is not null)
  ) then
    raise exception 'migration invented review-return history';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tasks_with_overdue'
       and column_name = 'completed_at'
  ) then
    raise exception 'overdue surface was not refreshed with lifecycle markers';
  end if;
end
$assert$;

rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q

echo "Task lifecycle timestamp upgrade checks passed."
