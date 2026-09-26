#!/usr/bin/env bash
# #317: the Points Ledger's backfill onto task_evaluations, replayed over
# pre-#317 data.
#
# A `db reset` runs migrations against an empty database and only then applies
# seed.sql, so on a fresh local stack the backfill in
# 20260911211500_ledger_evaluations.sql has nothing to convert. Staging is the
# environment where it matters: a live database full of trigger-written `task`
# ledger rows. This harness reconstructs that shape inside a rollback-only
# transaction and replays the real migration file over it, the same way
# task_assignments_backfill_upgrade.test.sh replays #290.
#
# It proves five things:
#   1. the backfill converts every legacy credit into exactly one Evaluation
#      and binds the ledger row to it, preserving the delta;
#   2. it is deterministic — the same legacy data inserted in a different
#      order produces byte-identical Evaluations, in the same id order;
#   3. each guard refuses to guess and names the offending ledger rows;
#   4. a failed run leaves the ledger exactly as it found it; and
#   5. a pre-existing sanction row, which has no Task to bind to, passes
#      through the backfill untouched.
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"
migration="supabase/migrations/20260911211500_ledger_evaluations.sql"

ledger_fingerprint() {
  docker exec "$db_container" psql -X -U postgres -d postgres -Atq -c \
    "select coalesce(md5(string_agg(format('%s|%s|%s|%s|%s', id, member_id, delta, reason, coalesce(evaluation_id::text, '-')), E'\\n' order by id)), 'empty') from public.points_ledger"
}

live_ledger_before=$(ledger_fingerprint)

# ==================== Undo #317, restore the pre-#317 schema ====================
# Everything the migration itself creates or drops, reversed, so the real file
# can be replayed verbatim: the Evaluation reference and its uniqueness rule,
# #162's narrower CHECK, the retired (task_id, member_id) index, the generated
# tasks.points column behind tasks_with_overdue, and both sync triggers with
# their functions, copied from 20260819160713_points_engine.sql.
read -r -d '' restore_pre_317 <<'SQL' || true
begin;
set local client_min_messages = warning;

drop trigger task_evaluations_reject_legacy_source on public.task_evaluations;
drop function private.reject_legacy_evaluation_source();

drop index public.points_ledger_evaluation_reason_uidx;
alter table public.points_ledger
  drop constraint points_ledger_task_reference_ck,
  drop column evaluation_id;
alter table public.points_ledger
  add constraint points_ledger_task_reference_ck
    check ((reason in ('task', 'task_reversal')) = (task_id is not null));
-- points_ledger_task_member_uidx is deliberately NOT recreated here: see the
-- note beside the TRUNCATE below.

drop view public.tasks_with_overdue;
alter table public.tasks
  add column points int generated always as
    (difficulty * coalesce(public.rating_mult(rating), 0)) stored;
create view public.tasks_with_overdue
with (security_invoker = on)
as
select
  task.*,
  (
    coalesce(task.deadline < statement_timestamp(), false)
    and task.status in ('todo', 'in_progress', 'in_review')
  ) as is_overdue
from public.tasks as task;

-- #345 dropped public.task_assignees outright. The pre-#317 world this
-- harness reconstructs had it -- both sync triggers below are defined on or
-- against it, and the replayed migration drops one of them from it -- so it
-- is recreated here in its 20260812184706 shape, exactly as every other
-- pre-#317 object is. The transaction rolls back, so it never outlives the
-- run.
create table public.task_assignees (
  task_id   bigint references public.tasks (id) on delete cascade,
  member_id uuid references public.profiles (id) on delete cascade,
  primary key (task_id, member_id)
);
alter table public.task_assignees enable row level security;

create function public.sync_task_ledger() returns trigger
  language plpgsql security definer set search_path = ''
as $sync_task$
begin
  if new.rating is null then
    delete from public.points_ledger
     where task_id = new.id and reason = 'task';
  else
    insert into public.points_ledger (member_id, delta, reason, task_id, awarded_by)
    select ta.member_id, new.points, 'task', new.id, auth.uid()
      from public.task_assignees ta
     where ta.task_id = new.id
    on conflict (task_id, member_id) where (reason = 'task')
    do update set delta      = excluded.delta,
                  awarded_by = excluded.awarded_by,
                  created_at = now();
  end if;
  return null;
end;
$sync_task$;

create trigger tasks_sync_ledger
  after update of rating, difficulty on public.tasks
  for each row
  when (old.rating is distinct from new.rating
        or old.points is distinct from new.points)
  execute function public.sync_task_ledger();

create function public.sync_assignee_ledger() returns trigger
  language plpgsql security definer set search_path = ''
as $sync_assignee$
declare
  task_points int;
begin
  if tg_op = 'INSERT' then
    select t.points into task_points
      from public.tasks t
     where t.id = new.task_id and t.rating is not null;
    if found then
      insert into public.points_ledger (member_id, delta, reason, task_id, awarded_by)
      values (new.member_id, task_points, 'task', new.task_id, auth.uid())
      on conflict (task_id, member_id) where (reason = 'task')
      do update set delta = excluded.delta, created_at = now();
    end if;
    return null;
  end if;
  delete from public.points_ledger
   where task_id = old.task_id and member_id = old.member_id and reason = 'task';
  return null;
end;
$sync_assignee$;

create trigger task_assignees_sync_ledger
  after insert or delete on public.task_assignees
  for each row
  execute function public.sync_assignee_ledger();

-- A clean slate: the demo cohort's Tasks, Assignments, Evaluations and ledger
-- rows all go, so the fixtures below are the entire population the replayed
-- backfill sees and the assertions can count exactly. Row-level triggers
-- (task_evaluations_guard_change, task_activity_reject_change) never fire on
-- TRUNCATE, so unlike seed.sql's DELETE-based cleanup this needs no
-- disable/enable around it.
truncate public.tasks cascade;

-- Only NOW can the retired (task_id, member_id) uniqueness rule come back.
-- #296 rebuilt the demo seed on the normalized model, and one of its Tasks is
-- evaluated, reopened and evaluated again: two `reason = 'task'` rows for the
-- same (task, member), netted by a `task_reversal` row in between. That shape
-- is legal after #317 and is precisely what the pre-#317 index forbade, so
-- recreating the index over the live ledger now fails with a duplicate key.
-- Recreating it over the emptied ledger reconstructs the pre-#317 world just
-- as faithfully, because the fixtures below are the entire population the
-- replayed backfill sees.
create unique index points_ledger_task_member_uidx
  on public.points_ledger (task_id, member_id) where (reason = 'task');

insert into auth.users (id, email) values
  ('31700000-0000-0000-0000-000000000001', 'ledger-one-317@test.local'),
  ('31700000-0000-0000-0000-000000000002', 'ledger-two-317@test.local'),
  ('31700000-0000-0000-0000-000000000003', 'ledger-three-317@test.local');
insert into public.profiles (id, full_name, email, role) values
  ('31700000-0000-0000-0000-000000000001', 'Ledger One 317', 'ledger-one-317@test.local', 'voluntar'),
  ('31700000-0000-0000-0000-000000000002', 'Ledger Two 317', 'ledger-two-317@test.local', 'voluntar'),
  ('31700000-0000-0000-0000-000000000003', 'Ledger Three 317', 'ledger-three-317@test.local', 'responsabil');

-- #317 must leave sanctions alone: they carry no task_id, so the backfill
-- (which only ever touches `reason = 'task'` rows) has nothing to bind them
-- to. Asserted below, after the replay, against this exact row.
insert into public.points_ledger (member_id, delta, reason, note) values
  ('31700000-0000-0000-0000-000000000003', -3, 'sanction',
   'Pre-#317 sanction, must survive the backfill untouched.');
SQL

# Mirrors #290's backfill (and seed.sql's copy of it): for a terminal Task
# every participant's Assignment ends at the matching lifecycle timestamp; the
# `legacy_migration` end_reason belongs to participants displaced from an
# unfinished Task, which carry no credit at all.
read -r -d '' backfill_assignments <<'SQL' || true
with ranked as (
  select task.id as task_id, legacy.member_id, task.created_at, task.status,
         task.completed_at, task.unfulfilled_at,
         row_number() over (partition by task.id order by legacy.member_id) as member_order
    from public.task_assignees legacy
    join public.tasks task on task.id = legacy.task_id
)
insert into public.task_assignments
  (task_id, member_id, assigned_at, ended_at, end_reason)
select ranked.task_id, ranked.member_id, ranked.created_at,
       case
         when ranked.status = 'completed' then ranked.completed_at
         when ranked.status = 'unfulfilled' then ranked.unfulfilled_at
         when ranked.member_order > 1 then ranked.created_at
       end,
       case
         when ranked.status = 'completed' then 'completed'
         when ranked.status = 'unfulfilled' then 'failed'
         when ranked.member_order > 1 then 'legacy_migration'
       end
  from ranked;
SQL

# The legacy population, described once. Both replays below build exactly this
# data; they differ only in the order the statements run, which is what the
# determinism comparison turns on.
#   "Legacy solo 317"     one participant, completed, 3 x mult(4) = +6
#   "Legacy pair 317"     two participants, completed, 5 x mult(5) = +15 each
#                         (the "Migrare bază de date" shape)
#   "Legacy penalty 317"  one participant, completed, 2 x mult(1) = -2
#   "Legacy unfulfilled 317"  one participant, unfulfilled, 4 x mult(2) = 0
#   "Legacy ungraded 317" one participant, still todo — no credit, and the
#                         backfill must invent no Evaluation for it
read -r -d '' fixture_tasks <<'SQL' || true
insert into public.tasks (title, difficulty, group_id, created_by) values
  ('Legacy solo 317', 3, (select id from public.groups where name = 'Educațional'), '31700000-0000-0000-0000-000000000003'),
  ('Legacy pair 317', 5, (select id from public.groups where name = 'Educațional'), '31700000-0000-0000-0000-000000000003'),
  ('Legacy penalty 317', 2, (select id from public.groups where name = 'Educațional'), '31700000-0000-0000-0000-000000000003'),
  ('Legacy unfulfilled 317', 4, (select id from public.groups where name = 'Educațional'), '31700000-0000-0000-0000-000000000003'),
  ('Legacy ungraded 317', 1, (select id from public.groups where name = 'Educațional'), '31700000-0000-0000-0000-000000000003');
SQL

run_replay() {
  local order="$1"
  local assignees grading

  if [ "$order" = "forward" ]; then
    assignees="insert into public.task_assignees (task_id, member_id)
select task.id, participant.member_id
  from (values
    ('Legacy solo 317', '31700000-0000-0000-0000-000000000001'::uuid),
    ('Legacy pair 317', '31700000-0000-0000-0000-000000000001'::uuid),
    ('Legacy pair 317', '31700000-0000-0000-0000-000000000002'::uuid),
    ('Legacy penalty 317', '31700000-0000-0000-0000-000000000002'::uuid),
    ('Legacy unfulfilled 317', '31700000-0000-0000-0000-000000000002'::uuid),
    ('Legacy ungraded 317', '31700000-0000-0000-0000-000000000001'::uuid)
  ) as participant(title, member_id)
  join public.tasks task on task.title = participant.title;"
    grading="update public.tasks set status = 'completed', completed_at = now(), rating = 4 where title = 'Legacy solo 317';
update public.tasks set status = 'completed', completed_at = now(), rating = 5 where title = 'Legacy pair 317';
update public.tasks set status = 'completed', completed_at = now(), rating = 1 where title = 'Legacy penalty 317';
update public.tasks set status = 'unfulfilled', unfulfilled_at = now(), rating = 2 where title = 'Legacy unfulfilled 317';"
  else
    assignees="insert into public.task_assignees (task_id, member_id)
select task.id, participant.member_id
  from (values
    ('Legacy ungraded 317', '31700000-0000-0000-0000-000000000001'::uuid),
    ('Legacy pair 317', '31700000-0000-0000-0000-000000000002'::uuid),
    ('Legacy unfulfilled 317', '31700000-0000-0000-0000-000000000002'::uuid),
    ('Legacy pair 317', '31700000-0000-0000-0000-000000000001'::uuid),
    ('Legacy penalty 317', '31700000-0000-0000-0000-000000000002'::uuid),
    ('Legacy solo 317', '31700000-0000-0000-0000-000000000001'::uuid)
  ) as participant(title, member_id)
  join public.tasks task on task.title = participant.title;"
    grading="update public.tasks set status = 'unfulfilled', unfulfilled_at = now(), rating = 2 where title = 'Legacy unfulfilled 317';
update public.tasks set status = 'completed', completed_at = now(), rating = 1 where title = 'Legacy penalty 317';
update public.tasks set status = 'completed', completed_at = now(), rating = 5 where title = 'Legacy pair 317';
update public.tasks set status = 'completed', completed_at = now(), rating = 4 where title = 'Legacy solo 317';"
  fi

  {
    printf '%s\n' "$restore_pre_317"
    printf '%s\n' "$fixture_tasks"
    printf '%s\n' "$assignees"
    printf '%s\n' "$grading"
    printf '%s\n' "$backfill_assignments"
    cat <<'SQL'
create temp table before_317 as
select coalesce(jsonb_agg(jsonb_build_object(
         'title', task.title, 'member', member.email,
         'delta', ledger.delta, 'reason', ledger.reason)
       order by task.title, member.email), '[]'::jsonb) as credits
  from public.points_ledger ledger
  join public.tasks task on task.id = ledger.task_id
  join public.profiles member on member.id = ledger.member_id;
SQL
    cat "$migration"
    cat <<'SQL'
do $assert$
begin
  if (select count(*) from public.task_evaluations) <> 5 then
    raise exception 'the backfill did not produce exactly one Evaluation per legacy credit (got %)',
      (select count(*) from public.task_evaluations);
  end if;

  if exists (select 1 from public.task_evaluations
              where source <> 'legacy_migration' or evaluated_by is not null) then
    raise exception 'the backfill wrote a non-legacy source or invented an evaluator';
  end if;

  if exists (
    select 1
      from public.points_ledger ledger
      left join public.task_evaluations evaluation on evaluation.id = ledger.evaluation_id
     where ledger.reason = 'task'
       and (evaluation.id is null
            or evaluation.points <> ledger.delta
            or evaluation.task_id <> ledger.task_id
            or evaluation.evaluated_at <> ledger.created_at)
  ) then
    raise exception 'a legacy credit was not bound to a faithful Evaluation';
  end if;

  if exists (
    select 1
      from public.points_ledger ledger
      join public.task_evaluations evaluation on evaluation.id = ledger.evaluation_id
      join public.task_assignments assignment on assignment.id = evaluation.assignment_id
     where ledger.reason = 'task' and assignment.member_id <> ledger.member_id
  ) then
    raise exception 'an Evaluation was attached to another member''s Assignment';
  end if;

  if exists (
    select 1
      from public.task_evaluations evaluation
      join public.tasks task on task.id = evaluation.task_id
     where evaluation.difficulty is distinct from task.difficulty
        or evaluation.rating is distinct from task.rating
        or evaluation.outcome <> case when task.status = 'unfulfilled'
                                      then 'unfulfilled' else 'completed' end
  ) then
    raise exception 'an Evaluation did not record the Task''s own inputs or outcome';
  end if;

  if (select count(*) from public.task_evaluations evaluation
        join public.tasks task on task.id = evaluation.task_id
       where task.title = 'Legacy pair 317') <> 2 then
    raise exception 'the two-participant legacy Task did not keep both credits';
  end if;

  if exists (select 1 from public.task_evaluations evaluation
               join public.tasks task on task.id = evaluation.task_id
              where task.title = 'Legacy ungraded 317') then
    raise exception 'the backfill invented an Evaluation for an uncredited Task';
  end if;

  if (select coalesce(jsonb_agg(jsonb_build_object(
                'title', task.title, 'member', member.email,
                'delta', ledger.delta, 'reason', ledger.reason)
              order by task.title, member.email), '[]'::jsonb)
        from public.points_ledger ledger
        join public.tasks task on task.id = ledger.task_id
        join public.profiles member on member.id = ledger.member_id)
     <> (select credits from before_317) then
    raise exception 'the backfill changed a credit instead of only binding it';
  end if;

  if exists (select 1 from pg_trigger trigger
               join pg_class table_ on table_.oid = trigger.tgrelid
              where trigger.tgname in ('tasks_sync_ledger', 'task_assignees_sync_ledger')) then
    raise exception 'a legacy sync trigger survived the migration';
  end if;

  if to_regclass('public.points_ledger_task_member_uidx') is not null then
    raise exception 'the retired (task_id, member_id) uniqueness rule survived';
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'tasks'
                and column_name = 'points') then
    raise exception 'the generated tasks.points column survived';
  end if;

  if not exists (
    select 1 from public.points_ledger ledger
     where ledger.member_id = '31700000-0000-0000-0000-000000000003'
       and ledger.reason = 'sanction'
       and ledger.delta = -3
       and ledger.note = 'Pre-#317 sanction, must survive the backfill untouched.'
       and ledger.evaluation_id is null
  ) then
    raise exception 'the backfill altered or lost the pre-existing sanction, which names no Task';
  end if;
end
$assert$;

-- The source the backfill just used is closed behind it.
do $closed$
begin
  begin
    insert into public.task_evaluations
      (task_id, assignment_id, source, outcome, difficulty, rating, points, note)
    select evaluation.task_id, evaluation.assignment_id, 'legacy_migration',
           'completed', 1, 3, 1, 'a second legacy row'
      from public.task_evaluations evaluation limit 1;
    raise exception 'a new legacy_migration Evaluation was accepted after the backfill';
  exception when check_violation then
    if sqlerrm <> 'task_evaluation_legacy_source_closed' then
      raise;
    end if;
  end;
end
$closed$;

\pset tuples_only on
\pset format unaligned
select 'FINGERPRINT:' || md5(string_agg(
         format('%s|%s|%s|%s|%s|%s|%s|%s|%s',
                ordered.position, ordered.title, ordered.email, ordered.source,
                coalesce(ordered.evaluated_by::text, '-'), ordered.outcome,
                ordered.difficulty, ordered.rating, ordered.points),
         E'\n' order by ordered.position))
  from (
    select row_number() over (order by evaluation.id) as position,
           task.title, member.email, evaluation.source, evaluation.evaluated_by,
           evaluation.outcome, evaluation.difficulty, evaluation.rating,
           evaluation.points
      from public.task_evaluations evaluation
      join public.tasks task on task.id = evaluation.task_id
      join public.task_assignments assignment on assignment.id = evaluation.assignment_id
      join public.profiles member on member.id = assignment.member_id
  ) as ordered;
\pset tuples_only off

rollback;
SQL
  } | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q
}

forward_output=$(run_replay forward)
shuffled_output=$(run_replay shuffled)

forward_fingerprint=$(printf '%s\n' "$forward_output" | sed -n 's/^FINGERPRINT://p')
shuffled_fingerprint=$(printf '%s\n' "$shuffled_output" | sed -n 's/^FINGERPRINT://p')

if [ -z "$forward_fingerprint" ]; then
  echo "The #317 backfill replay produced no Evaluation fingerprint." >&2
  printf '%s\n' "$forward_output" >&2
  exit 1
fi

if [ "$forward_fingerprint" != "$shuffled_fingerprint" ]; then
  echo "The #317 backfill is not deterministic: the same legacy data inserted in a different order produced different Evaluations." >&2
  echo "forward:  $forward_fingerprint" >&2
  echo "shuffled: $shuffled_fingerprint" >&2
  exit 1
fi

# ==================== The guards refuse to guess ====================
# Each case replays the migration over legacy data it cannot honestly
# convert, and must abort naming both the reason and the offending rows.
run_guard_case() {
  local label="$1" expected_message="$2" broken_sql="$3"
  local output status

  set +e
  output=$({
    printf '%s\n' "$restore_pre_317"
    printf '%s\n' "$fixture_tasks"
    printf '%s\n' "$broken_sql"
    cat "$migration"
    echo 'rollback;'
  } | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q 2>&1)
  status=$?
  set -e

  if [ "$status" -eq 0 ]; then
    echo "The #317 backfill accepted $label instead of refusing to guess." >&2
    exit 1
  fi

  if [[ "$output" != *"$expected_message"* ]]; then
    echo "The #317 backfill refused $label without saying '$expected_message'." >&2
    printf '%s\n' "$output" >&2
    exit 1
  fi

  if [[ "$output" != *"points_ledger"* ]]; then
    echo "The #317 backfill refused $label without naming the offending ledger rows." >&2
    printf '%s\n' "$output" >&2
    exit 1
  fi
}

# A credit with no Assignment history at all: there is nothing to attach the
# Evaluation to, and #290's backfill would have created one for every real
# participant.
run_guard_case "a credit with no Assignment" "ledger_row_without_assignment" "
insert into public.task_assignees (task_id, member_id)
select id, '31700000-0000-0000-0000-000000000001' from public.tasks where title = 'Legacy solo 317';
update public.tasks set status = 'completed', completed_at = now(), rating = 4
 where title = 'Legacy solo 317';
"

# Two Assignments for the same member on the same Task: #290 never produces
# this, so a human must say which one earned the credit.
run_guard_case "an ambiguous Assignment" "ledger_row_with_ambiguous_assignment" "
insert into public.task_assignees (task_id, member_id)
select id, '31700000-0000-0000-0000-000000000001' from public.tasks where title = 'Legacy solo 317';
update public.tasks set status = 'completed', completed_at = now(), rating = 4
 where title = 'Legacy solo 317';
insert into public.task_assignments (task_id, member_id, assigned_at, ended_at, end_reason)
select id, '31700000-0000-0000-0000-000000000001', created_at, completed_at, 'gave_up'
  from public.tasks where title = 'Legacy solo 317';
insert into public.task_assignments (task_id, member_id, assigned_at, ended_at, end_reason)
select id, '31700000-0000-0000-0000-000000000001', created_at, completed_at, 'completed'
  from public.tasks where title = 'Legacy solo 317';
"

# A credit whose Task no longer carries the Difficulty and Rating it was
# scored with: the Evaluation's inputs would have to be invented.
run_guard_case "a credit with no Evaluation inputs" "ledger_row_without_evaluation_inputs" "
insert into public.task_assignees (task_id, member_id)
select id, '31700000-0000-0000-0000-000000000001' from public.tasks where title = 'Legacy solo 317';
update public.tasks set status = 'completed', completed_at = now(), rating = 4
 where title = 'Legacy solo 317';
insert into public.task_assignments (task_id, member_id, assigned_at, ended_at, end_reason)
select id, '31700000-0000-0000-0000-000000000001', created_at, completed_at, 'completed'
  from public.tasks where title = 'Legacy solo 317';
alter table public.tasks drop constraint tasks_evaluation_inputs_ck;
drop trigger tasks_sync_ledger on public.tasks;
update public.tasks set rating = null where title = 'Legacy solo 317';
"

# A reversal row from before #317: nothing wrote them, and one that exists
# names no Evaluation to reverse.
run_guard_case "a pre-existing reversal" "ledger_reversal_without_evaluation" "
insert into public.task_assignees (task_id, member_id)
select id, '31700000-0000-0000-0000-000000000001' from public.tasks where title = 'Legacy solo 317';
update public.tasks set status = 'completed', completed_at = now(), rating = 4
 where title = 'Legacy solo 317';
insert into public.task_assignments (task_id, member_id, assigned_at, ended_at, end_reason)
select id, '31700000-0000-0000-0000-000000000001', created_at, completed_at, 'completed'
  from public.tasks where title = 'Legacy solo 317';
insert into public.points_ledger (member_id, delta, reason, task_id)
select '31700000-0000-0000-0000-000000000002', -6, 'task_reversal', id
  from public.tasks where title = 'Legacy solo 317';
"

# ==================== Every replay leaves the live ledger alone ====================
# Each block above ran inside a transaction that rolled back — including the
# ones that aborted. The real database must be exactly as it was.
live_ledger_after=$(ledger_fingerprint)
if [ "$live_ledger_before" != "$live_ledger_after" ]; then
  echo "A #317 backfill replay changed the live Points Ledger; every block must roll back." >&2
  echo "before: $live_ledger_before" >&2
  echo "after:  $live_ledger_after" >&2
  exit 1
fi

echo "Points Ledger / Evaluation backfill checks passed (deterministic fingerprint $forward_fingerprint)."
