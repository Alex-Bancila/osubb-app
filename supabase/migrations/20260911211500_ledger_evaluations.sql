-- #317: bind the Points Ledger to the Evaluation that produced each row,
-- allow a reversal row to stand beside the row it reverses, and retire the
-- legacy per-assignee sync triggers. ADR-0007 (Lifecycle and points): final
-- Evaluation awards Difficulty x the Rating multiplier to the active
-- Executor in the same transaction, reopening reverses that ledger effect
-- atomically, and the ledger stays append-only.
--
-- What the retired triggers did, and what replaces them
-- ----------------------------------------------------
-- `tasks_sync_ledger` (on tasks, after update of rating/difficulty) and
-- `task_assignees_sync_ledger` (on task_assignees, after insert/delete) ran
-- `public.sync_task_ledger()` / `public.sync_assignee_ledger()` from
-- 20260819160713_points_engine.sql. Between them they:
--   * inserted one `reason = 'task'` ledger row per `task_assignees` row
--     whenever a Task's Rating or generated `points` changed,
--   * UPDATED that row in place on a re-grade (via
--     `points_ledger_task_member_uidx`, which also made a reversal row
--     impossible: a second row for the same (task_id, member_id) collided),
--   * DELETED the Task's ledger rows when the Rating was cleared, and
--   * inserted or deleted a ledger row when an assignee was added to or
--     removed from an already-graded Task.
-- That is: points followed a mutable column on `tasks` and a membership row
-- on `task_assignees`, both of which any writer of those tables moved. The
-- replacement is `task_evaluations` (#316) plus the evaluation commands
-- (#336-#338, #344): a Task's points are decided once, recorded on an
-- append-only Evaluation, and credited by a single ledger row that names
-- that Evaluation. Reopening writes a `task_reversal` row against the same
-- Evaluation instead of rewriting or deleting the original. Nothing on
-- `tasks` or `task_assignees` moves points any more -- after this migration
-- no trigger on either table touches `points_ledger` at all.
--
-- The backfill contract (deterministic, re-runnable to the same result)
-- ---------------------------------------------------------------------
-- Every pre-existing `reason = 'task'` ledger row is historical evidence
-- that someone was credited for a Task. This migration turns each one into
-- the Evaluation it should always have had, then points the ledger row at
-- it. Exactly one Evaluation per existing `task` ledger row -- no row is
-- created for a Task nobody was credited for, and no credit is invented.
--
--   task_id       the ledger row's own task_id.
--   assignment_id the `task_assignments` row for that (task_id, member_id)
--                 pair -- dobrerares' #290 backfill
--                 (20260911106000_backfill_task_assignments.sql) created one
--                 per legacy participant. Matching is on (task_id,
--                 member_id) and NOT on end_reason: for a *completed* Task
--                 every participant's Assignment ends `completed` at
--                 completed_at; `legacy_migration` is his end_reason for
--                 participants displaced from an *unfinished* Task, which by
--                 definition carry no ledger credit.
--   source        'legacy_migration' -- #316's Ruling 11 reserved it for
--                 exactly this one-time backfill. The trigger at the end of
--                 this migration closes that source permanently afterwards.
--   evaluated_by  null. Legacy ledger rows do not identify an evaluator:
--                 `awarded_by` is `auth.uid()` at trigger time, which is
--                 null for every row the seed or a migration wrote, and the
--                 Task's creator is not evidence of who graded it
--                 (dobrerares, #316). Unknown is represented as null, never
--                 invented -- which is the whole reason Ruling 11 relaxed
--                 `task_evaluations_evaluator_ck` for this source.
--   outcome       'unfulfilled' when the Task's own status is `unfulfilled`,
--                 otherwise 'completed'. The brief for this issue said
--                 'completed' flat; the Task's terminal status is available
--                 and is direct evidence, and #312's
--                 tasks_evaluation_inputs_ck means a rated Task is always
--                 completed or unfulfilled -- recording an unfulfilled
--                 Task's credit as `completed` would be a lie this migration
--                 does not need to tell. Both outcomes carry points under
--                 ADR-0007, so nothing else changes.
--   difficulty    tasks.difficulty, rating tasks.rating -- the inputs the
--                 retired trigger used to compute the credit.
--   points        the ledger row's own `delta`, NOT a recomputation of
--                 difficulty x rating_mult(rating). The delta is what the
--                 member was actually credited; if a future change to the
--                 scoring guide ever made the formula disagree with history,
--                 history wins.
--   note          a fixed, non-blank sentence naming this migration.
--   evaluated_at  the ledger row's created_at -- the instant the credit was
--                 recorded, the closest thing to an evaluation time that
--                 exists.
--
-- Determinism: the insert's SELECT is ordered by (task_id, member_id), so a
-- re-run over the same rows allocates identities in the same order and
-- produces byte-identical Evaluations. The three guards below refuse to
-- guess rather than producing a different answer on different data.
--
-- Guards (fail loudly, never invent):
--   1. a `task` ledger row whose (task_id, member_id) has no
--      `task_assignments` row -- there is no Assignment to attach the
--      Evaluation to, and inventing one would fabricate Executor history;
--   2. a `task` ledger row whose (task_id, member_id) matches more than one
--      `task_assignments` row -- #290's backfill produces exactly one per
--      participant and no command writes that table yet, so this shape is
--      hand-made and a human must say which Assignment earned the credit;
--   3. a `task` ledger row whose Task has a null difficulty or rating --
--      the Evaluation's inputs would have to be invented; and
--   4. any pre-existing `task_reversal` row -- nothing writes them yet, and
--      a reversal with no evidence of which Evaluation it reverses cannot be
--      bound to one.
-- Each guard names the offending ledger row ids so remediation is exact.

-- ==================== 1. The Evaluation reference ====================

alter table public.points_ledger
  add column evaluation_id bigint references public.task_evaluations (id);

comment on column public.points_ledger.evaluation_id is
  'The Evaluation that produced this entry. Required for task and task_reversal rows (points_ledger_task_reference_ck), null for sanctions. A task row and its task_reversal row share one evaluation_id -- points_ledger_evaluation_reason_uidx allows exactly one of each.';

-- ==================== 2. Guards ====================

do $migration$
declare
  v_ledger_ids text;
begin
  -- Serialize against anything still writing these tables while the backfill
  -- reads them (on a hosted database the retired triggers are still armed
  -- until section 5 below drops them).
  lock table public.points_ledger, public.task_evaluations
    in share row exclusive mode;
  lock table public.tasks, public.task_assignments in share mode;

  select string_agg(ledger.id::text, ', ' order by ledger.id)
    into v_ledger_ids
    from public.points_ledger as ledger
   where ledger.reason = 'task'
     and not exists (
       select 1
         from public.task_assignments as assignment
        where assignment.task_id = ledger.task_id
          and assignment.member_id = ledger.member_id
     );

  if v_ledger_ids is not null then
    raise exception using
      errcode = '23514',
      message = 'ledger_row_without_assignment',
      detail = 'points_ledger task rows with no task_assignments row for their (task_id, member_id): '
        || v_ledger_ids,
      hint = 'Create the missing Assignment history, or decide the row''s fate, before #317.';
  end if;

  select string_agg(ledger.id::text, ', ' order by ledger.id)
    into v_ledger_ids
    from public.points_ledger as ledger
   where ledger.reason = 'task'
     and (
       select count(*)
         from public.task_assignments as assignment
        where assignment.task_id = ledger.task_id
          and assignment.member_id = ledger.member_id
     ) > 1;

  if v_ledger_ids is not null then
    raise exception using
      errcode = '23514',
      message = 'ledger_row_with_ambiguous_assignment',
      detail = 'points_ledger task rows matching more than one task_assignments row: '
        || v_ledger_ids,
      hint = 'Say which Assignment earned each credit before #317; this migration will not choose.';
  end if;

  select string_agg(ledger.id::text, ', ' order by ledger.id)
    into v_ledger_ids
    from public.points_ledger as ledger
    join public.tasks as task on task.id = ledger.task_id
   where ledger.reason = 'task'
     and (task.difficulty is null or task.rating is null);

  if v_ledger_ids is not null then
    raise exception using
      errcode = '23514',
      message = 'ledger_row_without_evaluation_inputs',
      detail = 'points_ledger task rows whose Task has no difficulty/rating to record: '
        || v_ledger_ids,
      hint = 'Restore the Task''s Difficulty and Rating, or decide the row''s fate, before #317.';
  end if;

  select string_agg(ledger.id::text, ', ' order by ledger.id)
    into v_ledger_ids
    from public.points_ledger as ledger
   where ledger.reason = 'task_reversal';

  if v_ledger_ids is not null then
    raise exception using
      errcode = '23514',
      message = 'ledger_reversal_without_evaluation',
      detail = 'pre-existing points_ledger task_reversal rows, which name no Evaluation: '
        || v_ledger_ids,
      hint = 'Nothing writes reversals before #317; decide these rows'' fate by hand.';
  end if;
end
$migration$;

-- ==================== 3. Backfill ====================

insert into public.task_evaluations
  (task_id, assignment_id, source, evaluated_by, outcome,
   difficulty, rating, points, note, evaluated_at)
select
  ledger.task_id,
  assignment.id,
  'legacy_migration',
  null,
  case when task.status = 'unfulfilled' then 'unfulfilled' else 'completed' end,
  task.difficulty,
  task.rating,
  ledger.delta,
  'Backfilled by #317 from the pre-#316 Points Ledger; the historical evaluator is unknown.',
  ledger.created_at
  from public.points_ledger as ledger
  join public.tasks as task
    on task.id = ledger.task_id
  join public.task_assignments as assignment
    on assignment.task_id = ledger.task_id
   and assignment.member_id = ledger.member_id
 where ledger.reason = 'task'
 order by ledger.task_id, ledger.member_id;

update public.points_ledger as ledger
   set evaluation_id = evaluation.id
  from public.task_evaluations as evaluation
  join public.task_assignments as assignment
    on assignment.id = evaluation.assignment_id
 where evaluation.source = 'legacy_migration'
   and evaluation.task_id = ledger.task_id
   and assignment.member_id = ledger.member_id
   and ledger.reason = 'task'
   and ledger.evaluation_id is null;

-- Every `task` row must now name its Evaluation; anything left over means
-- the mapping above missed a row, and the CHECK in section 4 would reject it
-- with a far less informative message.
do $migration$
declare
  v_ledger_ids text;
begin
  select string_agg(ledger.id::text, ', ' order by ledger.id)
    into v_ledger_ids
    from public.points_ledger as ledger
   where ledger.reason = 'task'
     and ledger.evaluation_id is null;

  if v_ledger_ids is not null then
    raise exception using
      errcode = '23514',
      message = 'ledger_backfill_incomplete',
      detail = 'points_ledger task rows left without an evaluation_id: ' || v_ledger_ids;
  end if;
end
$migration$;

-- ==================== 4. Ledger shape ====================

-- The retired uniqueness rule was "one task row per (task_id, member_id)",
-- which is exactly what forbade a reversal. The Evaluation replaces it: one
-- credit and at most one reversal of that credit.
drop index public.points_ledger_task_member_uidx;

create unique index points_ledger_evaluation_reason_uidx
  on public.points_ledger (evaluation_id, reason)
  where evaluation_id is not null;

comment on index public.points_ledger_evaluation_reason_uidx is
  'One entry per (Evaluation, reason): a single task credit and at most one task_reversal of it. Replaces points_ledger_task_member_uidx, whose (task_id, member_id) key made a reversal row impossible.';

-- #162 required a task_id exactly for task/task_reversal rows; now the
-- Evaluation is required on the same rows and forbidden on the others.
alter table public.points_ledger
  drop constraint points_ledger_task_reference_ck,
  add constraint points_ledger_task_reference_ck
    check (
      (reason in ('task', 'task_reversal')) = (task_id is not null)
      and (reason in ('task', 'task_reversal')) = (evaluation_id is not null)
    );

comment on column public.points_ledger.reason is
  'task (the Evaluation''s credit), task_reversal (that credit reversed on reopen), sanction (BC, negative, with note). task and task_reversal both name their Task and their Evaluation.';

-- ==================== 5. Retire the sync triggers ====================

drop trigger tasks_sync_ledger on public.tasks;
drop trigger task_assignees_sync_ledger on public.task_assignees;
drop function public.sync_task_ledger();
drop function public.sync_assignee_ledger();

-- ==================== 6. Points leave `tasks` ====================

-- `public.tasks_with_overdue` is `select task.*` (dobrerares' #427,
-- recreated by #314 and #315), so the generated column cannot be dropped
-- while the view depends on it: drop the view, drop the column, recreate the
-- view with the definition, grants and comment it has on this branch
-- (20260911210700_umbrella_tasks.sql) unchanged.
drop view public.tasks_with_overdue;

alter table public.tasks drop column points;

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

revoke all on public.tasks_with_overdue
  from public, anon, authenticated, service_role;
grant select on public.tasks_with_overdue to authenticated, service_role;

comment on view public.tasks_with_overdue is
  'RLS-aware Task query surface with overdue derived from the current clock and unfinished lifecycle state.';

-- ==================== 7. Close the legacy source ====================

-- #316 left this to the command layer as an unenforceable convention ("a
-- command must never write source = 'legacy_migration'"), because the
-- backfill above had not run yet. It has now, and it is the only writer that
-- source was ever for, so the path closes here -- by trigger, so that a
-- security definer command cannot reach around it either. A future migration
-- that must reconstruct history again disables this trigger deliberately and
-- says why; supabase/seed.sql does exactly that for the one legacy-shaped
-- demo Task, in the open.
create function private.reject_legacy_evaluation_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '23514',
    message = 'task_evaluation_legacy_source_closed';
end;
$$;

create trigger task_evaluations_reject_legacy_source
  before insert on public.task_evaluations
  for each row
  when (new.source = 'legacy_migration')
  execute function private.reject_legacy_evaluation_source();

revoke all on function private.reject_legacy_evaluation_source()
  from public, anon, authenticated, service_role;

comment on function private.reject_legacy_evaluation_source() is
  'Rejects any new task_evaluations row with source = legacy_migration. That source existed for #317''s one-time backfill only (#316 Ruling 11); the backfill has run, so the path is closed to every caller, security definer commands included.';
