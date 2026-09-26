#!/usr/bin/env bash
# #290: the legacy multi-assignee join table's one-time backfill into
# Assignment History, replayed over reconstructed pre-#290 legacy data.
#
# A `db reset` runs migrations against an empty database and only then
# applies seed.sql, so on a fresh local stack
# 20260911106000_backfill_task_assignments.sql has nothing to convert.
# Staging is the environment where it mattered: a live database whose Tasks
# still carried rows in the legacy `task_assignees` join table. This harness
# reconstructs that shape inside a rollback-only transaction and replays the
# real migration file over it, the same way
# points_ledger_evaluations_upgrade.test.sh replays #317's backfill.
#
# #345 retired `public.task_assignees` for good -- dropped, not coming back
# -- so this harness can no longer read legacy rows off a live seed the way
# it once did. It creates the table itself, in its exact 20260812184706
# shape, inside its own rolled-back scratch transaction -- the same pattern
# tasks_lifecycle_upgrade.test.sh and points_ledger_evaluations_upgrade.test.sh
# already use for this same table. The table must not survive the run: the
# check after the transaction closes asserts it is gone.
#
# The original version of this harness (deleted whole by #345, restored here)
# had a second phase that replayed the same migration against the *live*
# seeded database and asserted the guard's `legacy_assignment_history_overlap`
# refusal. That phase is gone for good, not merely trimmed: it depended on the
# live seed holding `task_assignees` rows, a premise #345 permanently
# falsified by retiring both the table and seed.sql's insert into it.
# Replaying the migration against today's live database now fails with
# `relation "public.task_assignees" does not exist` -- a different, meaningless
# failure -- so there is nothing honest left for that phase to assert.
# (#345 follow-up, review finding 2.)
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"
migration="supabase/migrations/20260911106000_backfill_task_assignments.sql"

# Successful upgrade: reconstruct the legacy join table empty, populate it
# with production-shaped legacy data plus focused fixtures inside a
# rollback-only transaction, retain unrelated ended and active history, and
# replay the real migration over all of it.
{
  cat <<'SQL'
begin;
set local client_min_messages = warning;

-- #345 dropped public.task_assignees outright, so nothing in the live
-- database can hold rows referencing it any more. Recreate it here, empty,
-- in its exact 20260812184706 shape -- the transaction rolls back, so it
-- never outlives this run. (The pre-#345 version of this harness ran three
-- `delete ... where exists (select 1 from public.task_assignees legacy ...)`
-- cleanup statements here, to remove Points Ledger/Evaluation/Assignment
-- rows tied to whatever legacy rows the live seed happened to hold. Against
-- a table this harness itself just created empty, those deletes could never
-- match anything, so they are gone rather than kept as dead code.)
create table public.task_assignees (
  task_id   bigint references public.tasks (id) on delete cascade,
  member_id uuid references public.profiles (id) on delete cascade,
  primary key (task_id, member_id)
);
alter table public.task_assignees enable row level security;

insert into auth.users (id, email) values
  ('29000000-0000-0000-0000-000000000001', 'legacy-one-290@test.local'),
  ('29000000-0000-0000-0000-000000000002', 'legacy-two-290@test.local'),
  ('29000000-0000-0000-0000-000000000003', 'legacy-three-290@test.local');
insert into public.profiles (id, full_name, email, role) values
  ('29000000-0000-0000-0000-000000000001', 'Legacy One 290', 'legacy-one-290@test.local', 'voluntar'),
  ('29000000-0000-0000-0000-000000000002', 'Legacy Two 290', 'legacy-two-290@test.local', 'voluntar'),
  ('29000000-0000-0000-0000-000000000003', 'Legacy Three 290', 'legacy-three-290@test.local', 'voluntar');

-- #312: a completed/unfulfilled row must carry a rating alongside its
-- difficulty (tasks_evaluation_inputs_ck) the instant it is inserted — set
-- both terminal rows' Rating here rather than through a later UPDATE, which
-- would otherwise leave the just-inserted row in the disallowed
-- half-evaluated shape.
-- #339: tasks_cancel_reason_ck is live here too (this harness never touches
-- task_status, so it keeps the constraint rather than dropping it) -- the
-- cancelled row therefore carries a reason from the moment it is inserted and
-- every other row must leave the column null.
insert into public.tasks
  (title, difficulty, group_id, status, created_at, started_at, submitted_at,
   completed_at, unfulfilled_at, cancelled_at, cancel_reason, rating)
values
  ('Legacy multi todo 290', 1, (select id from public.groups where name = 'Educațional'), 'todo', '2026-01-01 10:00+00', null, null, null, null, null, null, null),
  ('Legacy multi progress 290', 1, (select id from public.groups where name = 'Educațional'), 'in_progress', '2026-01-02 10:00+00', '2026-01-02 11:00+00', null, null, null, null, null, null),
  ('Legacy review 290', 1, (select id from public.groups where name = 'Educațional'), 'in_review', '2026-01-03 10:00+00', '2026-01-03 11:00+00', '2026-01-03 12:00+00', null, null, null, null, null),
  ('Legacy completed 290', 3, (select id from public.groups where name = 'Educațional'), 'completed', '2026-01-04 10:00+00', null, null, '2026-01-05 10:00+00', null, null, null, 4),
  ('Legacy unfulfilled 290', 1, (select id from public.groups where name = 'Educațional'), 'unfulfilled', '2026-01-06 10:00+00', null, null, null, '2026-01-07 10:00+00', null, null, 2),
  ('Legacy cancelled 290', 1, (select id from public.groups where name = 'Educațional'), 'cancelled', '2026-01-08 10:00+00', null, null, null, null, '2026-01-09 10:00+00', 'Anulat #290', null),
  ('Legacy no participant 290', 1, (select id from public.groups where name = 'Educațional'), 'todo', '2026-01-10 10:00+00', null, null, null, null, null, null, null),
  ('Unrelated new history 290', 1, (select id from public.groups where name = 'Educațional'), 'todo', '2026-01-11 10:00+00', null, null, null, null, null, null, null);

-- Deliberately shuffled input proves selection does not depend on insert order.
insert into public.task_assignees (task_id, member_id)
select task.id, participant.member_id
  from (values
    ('Legacy multi todo 290', '29000000-0000-0000-0000-000000000003'::uuid),
    ('Legacy multi todo 290', '29000000-0000-0000-0000-000000000001'::uuid),
    ('Legacy multi todo 290', '29000000-0000-0000-0000-000000000002'::uuid),
    ('Legacy multi progress 290', '29000000-0000-0000-0000-000000000002'::uuid),
    ('Legacy multi progress 290', '29000000-0000-0000-0000-000000000001'::uuid),
    ('Legacy review 290', '29000000-0000-0000-0000-000000000003'::uuid),
    ('Legacy completed 290', '29000000-0000-0000-0000-000000000002'::uuid),
    ('Legacy completed 290', '29000000-0000-0000-0000-000000000001'::uuid),
    ('Legacy unfulfilled 290', '29000000-0000-0000-0000-000000000002'::uuid),
    ('Legacy cancelled 290', '29000000-0000-0000-0000-000000000001'::uuid)
  ) as participant(title, member_id)
  join public.tasks task on task.title = participant.title;

insert into public.task_assignments
  (task_id, member_id, assigned_at, assigned_by, ended_at, end_reason)
select id, '29000000-0000-0000-0000-000000000002', created_at,
       '29000000-0000-0000-0000-000000000003', created_at + interval '1 hour',
       'replaced'
  from public.tasks where title = 'Unrelated new history 290';
insert into public.task_assignments
  (task_id, member_id, assigned_at, assigned_by)
select id, '29000000-0000-0000-0000-000000000003', created_at + interval '2 hours',
       '29000000-0000-0000-0000-000000000003'
  from public.tasks where title = 'Unrelated new history 290';

create temp table before_290 as
select
  (select count(*) from public.tasks) as task_count,
  (select count(*) from public.task_assignees) as legacy_count,
  (select coalesce(jsonb_agg(to_jsonb(entry) order by entry.id), '[]'::jsonb)
     from public.points_ledger entry) as ledger_rows,
  (select coalesce(jsonb_agg(to_jsonb(history) order by history.id), '[]'::jsonb)
     from public.task_assignments history
    where not exists (select 1 from public.task_assignees legacy
                       where legacy.task_id = history.task_id)) as unrelated_history;
SQL

  cat "$migration"

  cat <<'SQL'
do $assert$
begin
  if (select count(*) from public.tasks) <> (select task_count from before_290)
     or (select count(*) from public.task_assignees) <> (select legacy_count from before_290) then
    raise exception 'legacy Assignment migration changed Task or legacy-assignee evidence';
  end if;

  if (select count(*) from public.task_assignments)
       <> (select legacy_count from before_290)
          + jsonb_array_length((select unrelated_history from before_290))
     or exists (
       select 1 from public.task_assignees legacy
       left join public.task_assignments history
         on history.task_id = legacy.task_id and history.member_id = legacy.member_id
       where history.id is null
     ) then
    raise exception 'legacy Assignment migration did not preserve every participant exactly once';
  end if;

  if (select coalesce(jsonb_agg(to_jsonb(history) order by history.id), '[]'::jsonb)
        from public.task_assignments history
       where not exists (select 1 from public.task_assignees legacy
                          where legacy.task_id = history.task_id))
       <> (select unrelated_history from before_290) then
    raise exception 'migration changed unrelated Assignment history';
  end if;

  if (select coalesce(jsonb_agg(to_jsonb(entry) order by entry.id), '[]'::jsonb)
        from public.points_ledger entry)
       <> (select ledger_rows from before_290) then
    raise exception 'migration changed Points Ledger history';
  end if;

  if exists (
    select 1 from public.task_assignments history
    join public.task_assignees legacy
      on legacy.task_id = history.task_id and legacy.member_id = history.member_id
    join public.tasks task on task.id = history.task_id
    where history.assigned_at is distinct from task.created_at
       or history.assigned_by is not null
  ) then
    raise exception 'legacy assignment provenance was invented or reconstructed inconsistently';
  end if;

  if exists (
    select task.id
      from public.tasks task
      join public.task_assignees legacy on legacy.task_id = task.id
      join public.task_assignments history
        on history.task_id = legacy.task_id and history.member_id = legacy.member_id
     where task.status in ('todo', 'in_progress', 'in_review')
     group by task.id
    having count(*) filter (where history.ended_at is null) <> 1
  ) or exists (
    select 1 from public.task_assignments history
    join public.task_assignees legacy_pair
      on legacy_pair.task_id = history.task_id
     and legacy_pair.member_id = history.member_id
    join public.tasks task on task.id = history.task_id
    where task.status in ('todo', 'in_progress', 'in_review')
      and history.ended_at is null
      and history.member_id <> (select legacy.member_id
        from public.task_assignees legacy where legacy.task_id = task.id
        order by legacy.member_id limit 1)
  ) then
    raise exception 'unfinished Task did not select exactly the lowest UUID Executor';
  end if;

  if exists (
    select 1 from public.task_assignments history
    join public.task_assignees legacy
      on legacy.task_id = history.task_id and legacy.member_id = history.member_id
    join public.tasks task on task.id = history.task_id
    where task.status in ('todo', 'in_progress', 'in_review')
      and history.ended_at is not null
      and (history.ended_at is distinct from task.created_at
        or history.end_reason <> 'legacy_migration'
        or history.end_note is null)
  ) then
    raise exception 'displaced unfinished participants were not preserved honestly';
  end if;

  if exists (
    select 1 from public.task_assignments history
    join public.task_assignees legacy
      on legacy.task_id = history.task_id and legacy.member_id = history.member_id
    join public.tasks task on task.id = history.task_id
    where task.status in ('completed', 'unfulfilled', 'cancelled')
      and (history.ended_at is distinct from case task.status
             when 'completed' then task.completed_at
             when 'unfulfilled' then task.unfulfilled_at
             when 'cancelled' then task.cancelled_at end
        or history.end_reason is distinct from case task.status
             when 'completed' then 'completed'
             when 'unfulfilled' then 'failed'
             when 'cancelled' then 'cancelled' end)
  ) then
    raise exception 'terminal participants did not use the matching lifecycle outcome';
  end if;

  if exists (select 1 from public.task_assignments history
              join public.tasks task on task.id = history.task_id
             where task.title = 'Legacy no participant 290') then
    raise exception 'migration invented an Assignment for a Task without legacy participants';
  end if;
end
$assert$;

rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q

# The scratch table must not survive its own transaction. If this fails, the
# `rollback;` above did not do its job and the next command to run this
# harness would find a `public.task_assignees` already lying around.
if [ -n "$(docker exec "$db_container" psql -X -At -U postgres -d postgres -c "select to_regclass('public.task_assignees')")" ]; then
  echo "public.task_assignees survived the harness; the scratch transaction did not roll back." >&2
  exit 1
fi

echo "Task Assignment backfill upgrade checks passed (scratch task_assignees did not survive)."
