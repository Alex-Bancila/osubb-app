#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"
migration="supabase/migrations/20260911102000_tasks_six_state_lifecycle.sql"

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
drop function public.claim_open_task(bigint);
drop function private.task_is_unassigned(bigint);
truncate public.tasks cascade;
-- #318 also dropped public.is_assigned with task_read, its last consumer.
-- The pre-#287 schema had it, and both the legacy task_read recreated
-- below and the replayed migration's own task_read call it.
create function public.is_assigned(tid bigint) returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.task_assignees ta
                  where ta.task_id = tid and ta.member_id = auth.uid());
$$;
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

create policy task_read on public.tasks for select to authenticated using (
  public.auth_is_member() and (
       public.auth_level() >= 4
    or status = 'open'
    or public.auth_in_dept(dept_id)
    or (team_id is not null and public.auth_in_team(team_id))
    or public.is_assigned(id)
  )
);
SQL

  cat supabase/migrations/20260826231354_atomic_claim_open_task.sql

  cat <<'SQL'

insert into auth.users (id, email) values
  ('28700000-0000-0000-0000-000000000001', 'assigned-overdue-287@test.local'),
  ('28700000-0000-0000-0000-000000000002', 'completed-points-287@test.local');
insert into public.profiles (id, full_name, email, role) values
  ('28700000-0000-0000-0000-000000000001', 'Assigned Overdue 287', 'assigned-overdue-287@test.local', 'voluntar'),
  ('28700000-0000-0000-0000-000000000002', 'Completed Points 287', 'completed-points-287@test.local', 'voluntar');

insert into public.tasks
  (title, difficulty, rating, dept_id, status, audience, assignment_mode)
values
  ('Legacy todo 287', 1, null, 'edu', 'todo', 'local', 'direct'),
  ('Legacy progress 287', 1, null, 'edu', 'progress', 'local', 'direct'),
  ('Legacy done 287', 3, 4, 'edu', 'done', 'local', 'direct'),
  ('Legacy overdue unassigned 287', 1, null, 'edu', 'overdue', 'local', 'direct'),
  ('Legacy overdue assigned 287', 1, null, 'edu', 'overdue', 'local', 'direct'),
  ('Legacy open 287', 1, null, 'edu', 'open', 'org', 'public');

insert into public.task_assignees (task_id, member_id)
select id, '28700000-0000-0000-0000-000000000001'::uuid
  from public.tasks where title = 'Legacy overdue assigned 287'
union all
select id, '28700000-0000-0000-0000-000000000002'::uuid
  from public.tasks where title = 'Legacy done 287';

-- #317 retired the grading triggers, so the completed fixture's Rating no
-- longer credits anyone by itself. Write the Assignment, the Evaluation and
-- the ledger entry explicitly — that credit is what the assertion below
-- proves the lifecycle migration leaves untouched. This pre-#287 replay has
-- no completed_at column (dropped above), so the Assignment is left active.
insert into public.task_assignments (task_id, member_id)
select id, '28700000-0000-0000-0000-000000000002'
  from public.tasks where title = 'Legacy done 287';

insert into public.task_evaluations
  (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
select task.id, assignment.id, '28700000-0000-0000-0000-000000000002',
       'completed', task.difficulty, task.rating,
       task.difficulty * public.rating_mult(task.rating),
       'lifecycle upgrade fixture evaluation'
  from public.tasks task
  join public.task_assignments assignment on assignment.task_id = task.id
 where task.title = 'Legacy done 287';

insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id)
select assignment.member_id, evaluation.points, 'task',
       evaluation.task_id, evaluation.id
  from public.task_evaluations evaluation
  join public.task_assignments assignment on assignment.id = evaluation.assignment_id
  join public.tasks task on task.id = evaluation.task_id
 where task.title = 'Legacy done 287';
SQL

  cat "$migration"

  cat <<'SQL'
do $assert$
declare
  v_completed_task_id bigint;
begin
  if (select count(*) from public.tasks) <> 6 then
    raise exception 'legacy lifecycle migration lost Tasks';
  end if;

  if (select status::text from public.tasks where title = 'Legacy todo 287') <> 'todo'
     or (select status::text from public.tasks where title = 'Legacy progress 287') <> 'in_progress'
     or (select status::text from public.tasks where title = 'Legacy done 287') <> 'completed'
     or (select status::text from public.tasks where title = 'Legacy overdue unassigned 287') <> 'todo'
     or (select status::text from public.tasks where title = 'Legacy overdue assigned 287') <> 'in_progress'
     or (select status::text from public.tasks where title = 'Legacy open 287') <> 'todo' then
    raise exception 'one or more legacy statuses mapped incorrectly';
  end if;

  if exists (
    select 1 from public.tasks
     where title = 'Legacy open 287'
       and (audience <> 'org' or assignment_mode <> 'public')
  ) then
    raise exception 'legacy open audience or Assignment Mode was lost';
  end if;

  -- #317 dropped the generated tasks.points column; the Evaluation carries
  -- the number now, and the ledger entry naming it carries the credit.
  select id into v_completed_task_id
    from public.tasks where title = 'Legacy done 287';
  if not exists (
       select 1 from public.task_evaluations
        where task_id = v_completed_task_id
          and difficulty = 3 and rating = 4 and points = 6
     )
     or not exists (
       select 1 from public.points_ledger ledger
        where ledger.task_id = v_completed_task_id
          and ledger.member_id = '28700000-0000-0000-0000-000000000002'
          and ledger.delta = 6
          and ledger.evaluation_id is not null
     ) then
    raise exception 'completed Task points behavior was not preserved';
  end if;
end
$assert$;

rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q

echo "Task lifecycle upgrade checks passed."
