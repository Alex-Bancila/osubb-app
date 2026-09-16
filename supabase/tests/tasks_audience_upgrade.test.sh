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
-- #318: today's read policy is tasks_read (it replaced task_read).
drop policy tasks_read on public.tasks;
-- #345 dropped public.claim_open_task and private.task_is_unassigned, so the
-- two explicit drops that stood here have nothing left to drop.
truncate public.tasks cascade;
-- #312: tasks_evaluation_inputs_ck's compiled expression embeds 'completed'/
-- 'unfulfilled' literals bound to today's task_status OID. Converting the
-- status column away from that enum (the very next statement) would
-- otherwise try to recompile the constraint's expression against the new
-- type and fail with "operator does not exist: text = task_status" — drop it
-- first, same treatment as the task_activity columns below; the scratch
-- transaction rolls back either way.
-- #294: tasks_deadline_active_idx's partial predicate (status in a
-- task_status array literal) has the identical problem -- same fix, same
-- reasoning: it is never recreated because this whole transaction rolls back.
drop index public.tasks_deadline_active_idx;
-- #339: tasks_cancel_reason_ck has exactly the same problem -- its compiled
-- expression embeds a 'cancelled' literal bound to today's task_status OID, so
-- the status conversion below would try to recompile it against text and fail.
-- Same fix, same reasoning: this scratch transaction rolls back, so dropping
-- and never recreating it is safe.
alter table public.tasks drop constraint tasks_evaluation_inputs_ck;
alter table public.tasks drop constraint tasks_cancel_reason_ck;
alter table public.tasks alter column status drop default;
alter table public.tasks alter column status type text using status::text;
-- #292: task_activity.from_status/to_status also depend on task_status; this
-- scratch transaction rolls back, so dropping them here is safe.
alter table public.task_activity drop column from_status, drop column to_status;
-- #327: private.log_task_activity takes two task_status parameters, so it
-- depends on the enum the same way those columns did. Same treatment, same
-- reasoning as 20260911210200_task_activity.sql's header warning: this scratch
-- transaction rolls back, so dropping and never recreating it is safe. Any
-- later task_status-typed object must be dropped here too.
drop function private.log_task_activity(bigint, text, uuid, bigint, public.task_status, public.task_status, text, jsonb);
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
