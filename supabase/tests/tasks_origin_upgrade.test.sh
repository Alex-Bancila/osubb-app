#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"
migration="supabase/migrations/20260911101000_tasks_exactly_one_origin.sql"

{
  cat <<'SQL'
begin;
set local client_min_messages = warning;

drop view public.tasks_with_overdue;
-- #314: tasks_validate_campaign fires "of ... project_id", which registers a
-- dependency on the column the same way the view above does; drop it here
-- too so project_id can be dropped and replayed. The rollback below restores
-- it, same as the view.
drop trigger tasks_validate_campaign on public.tasks;
-- #315: tasks_validate_hierarchy also fires "of ... project_id" (a
-- Subtask's origin includes project_id); same treatment.
drop trigger tasks_validate_hierarchy on public.tasks;
-- #519: tasks_sync_group_origin also fires "of ... project_id", registering the same
-- kind of dependency on the column as the two triggers above.
drop trigger tasks_sync_group_origin on public.tasks;
-- With its populating trigger gone, group_id would otherwise block this harness's own
-- Origin-only fixture inserts below (NOT NULL, #519). Irrelevant to what this harness
-- tests; relaxed for the scratch transaction only, restored by the rollback.
alter table public.tasks alter column group_id drop not null;
alter table public.tasks drop constraint tasks_exactly_one_origin_check;
drop index public.tasks_project_idx;
alter table public.tasks drop column project_id;
truncate public.tasks cascade;

insert into auth.users (id, email)
values ('28400000-0000-0000-0000-000000000002',
        'origin-upgrade-assignee-284@test.local');
insert into public.profiles (id, full_name, email, role)
values ('28400000-0000-0000-0000-000000000002',
        'Origin Upgrade Assignee', 'origin-upgrade-assignee-284@test.local',
        'voluntar');

insert into public.tasks (title, difficulty, dept_id, team_id) values
  ('Legacy Department Origin', 1, 'edu', null),
  ('Legacy Team With Redundant Department', 1, 'diverse', 't-app'),
  ('Legacy Team Only', 1, null, 't-app');

-- #345 dropped public.task_assignees; the participation evidence this
-- harness checks survives the Origin migration is the Assignment written
-- just below, which is the record that outlived the join table.
-- #312: rating may only be set once completed (tasks_evaluation_inputs_ck).
update public.tasks
   set status = 'completed', completed_at = now(), rating = 4
 where title = 'Legacy Team With Redundant Department';

-- #317 retired the grading triggers, so the Rating above credits nobody on
-- its own: write the Assignment, the Evaluation and the ledger entry that
-- names it, which is the points history the assertion below checks survives
-- the Origin migration untouched.
insert into public.task_assignments (task_id, member_id, ended_at, end_reason)
select id, '28400000-0000-0000-0000-000000000002', completed_at, 'completed'
  from public.tasks where title = 'Legacy Team With Redundant Department';

insert into public.task_evaluations
  (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
select task.id, assignment.id, '28400000-0000-0000-0000-000000000002',
       'completed', task.difficulty, task.rating,
       task.difficulty * public.rating_mult(task.rating),
       'origin upgrade fixture evaluation'
  from public.tasks task
  join public.task_assignments assignment on assignment.task_id = task.id
 where task.title = 'Legacy Team With Redundant Department';

insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id)
select assignment.member_id, evaluation.points, 'task',
       evaluation.task_id, evaluation.id
  from public.task_evaluations evaluation
  join public.task_assignments assignment on assignment.id = evaluation.assignment_id
  join public.tasks task on task.id = evaluation.task_id
 where task.title = 'Legacy Team With Redundant Department';
SQL

  cat "$migration"

  cat <<'SQL'
do $assert$
begin
  if (select count(*) from public.tasks) <> 3 then
    raise exception 'legacy Tasks were added or deleted during Origin migration';
  end if;

  if (select dept_id from public.tasks where title = 'Legacy Department Origin')
       is distinct from 'edu' then
    raise exception 'legacy Department Origin changed';
  end if;

  if exists (
    select 1 from public.tasks
     where title in ('Legacy Team With Redundant Department', 'Legacy Team Only')
       and (team_id is distinct from 't-app' or dept_id is not null)
  ) then
    raise exception 'legacy Team Origin was not normalized to Team only';
  end if;

  if not exists (
    select 1
      from public.task_assignments as assignment
      join public.tasks as task on task.id = assignment.task_id
     where task.title = 'Legacy Team With Redundant Department'
       and assignment.member_id = '28400000-0000-0000-0000-000000000002'
  ) then
    raise exception 'legacy Task participation evidence was lost';
  end if;

  if not exists (
    select 1
      from public.points_ledger as ledger
      join public.tasks as task on task.id = ledger.task_id
     where task.title = 'Legacy Team With Redundant Department'
       and ledger.member_id = '28400000-0000-0000-0000-000000000002'
  ) then
    raise exception 'legacy Task points history was lost';
  end if;
end
$assert$;

rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q

baseline_fingerprint=$(docker exec "$db_container" psql -X -U postgres -d postgres -Atq -c \
  "select md5(string_agg(format('%s|%s|%s|%s', id, title, coalesce(dept_id, ''), coalesce(team_id, '')), E'\\n' order by id)) from public.tasks")

set +e
failure_output=$({
  cat <<'SQL'
begin;
set local client_min_messages = warning;

drop view public.tasks_with_overdue;
drop trigger tasks_validate_campaign on public.tasks;
drop trigger tasks_validate_hierarchy on public.tasks;
-- #519: tasks_sync_group_origin also fires "of ... project_id", registering the same
-- kind of dependency on the column as the two triggers above.
drop trigger tasks_sync_group_origin on public.tasks;
-- With its populating trigger gone, group_id would otherwise block this harness's own
-- Origin-only fixture inserts below (NOT NULL, #519). Irrelevant to what this harness
-- tests; relaxed for the scratch transaction only, restored by the rollback.
alter table public.tasks alter column group_id drop not null;
alter table public.tasks drop constraint tasks_exactly_one_origin_check;
drop index public.tasks_project_idx;
alter table public.tasks drop column project_id;
truncate public.tasks cascade;
insert into public.tasks (title, difficulty) values ('Legacy Originless Task', 1);
SQL
  cat "$migration"
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q 2>&1)
failure_status=$?
set -e

if [ "$failure_status" -eq 0 ]; then
  echo "Origin migration unexpectedly accepted an originless legacy Task." >&2
  exit 1
fi

if [[ "$failure_output" != *"originless Task IDs:"* ]]; then
  echo "Origin migration failed without identifying the originless Tasks." >&2
  echo "$failure_output" >&2
  exit 1
fi

after_fingerprint=$(docker exec "$db_container" psql -X -U postgres -d postgres -Atq -c \
  "select md5(string_agg(format('%s|%s|%s|%s', id, title, coalesce(dept_id, ''), coalesce(team_id, '')), E'\\n' order by id)) from public.tasks")

if [ "$after_fingerprint" != "$baseline_fingerprint" ]; then
  echo "Failed Origin migration did not roll back the existing Task rows." >&2
  exit 1
fi

echo "Task Origin upgrade checks passed."
