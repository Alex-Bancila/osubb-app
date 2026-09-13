#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"
migration="supabase/migrations/20260911101000_tasks_exactly_one_origin.sql"

{
  cat <<'SQL'
begin;
set local client_min_messages = warning;

drop view public.tasks_with_overdue;
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

insert into public.task_assignees (task_id, member_id)
select id, '28400000-0000-0000-0000-000000000002'::uuid
  from public.tasks
 where title = 'Legacy Team With Redundant Department';

-- #312: rating may only be set once completed (tasks_evaluation_inputs_ck).
update public.tasks
   set status = 'completed', completed_at = now(), rating = 4
 where title = 'Legacy Team With Redundant Department';
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
      from public.task_assignees as assignment
      join public.tasks as task on task.id = assignment.task_id
     where task.title = 'Legacy Team With Redundant Department'
       and assignment.member_id = '28400000-0000-0000-0000-000000000002'
  ) then
    raise exception 'legacy Task assignee evidence was lost';
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
