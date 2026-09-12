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

  select id into v_completed_task_id
    from public.tasks where title = 'Legacy done 287';
  if (select points from public.tasks where id = v_completed_task_id) <> 6
     or not exists (
       select 1 from public.points_ledger
        where task_id = v_completed_task_id
          and member_id = '28700000-0000-0000-0000-000000000002'
          and delta = 6
     ) then
    raise exception 'completed Task points behavior was not preserved';
  end if;
end
$assert$;

rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q

echo "Task lifecycle upgrade checks passed."
