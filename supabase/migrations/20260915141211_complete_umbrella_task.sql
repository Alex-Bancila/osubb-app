-- #340: complete_umbrella_task -- the Umbrella side of ADR-0007's rollup.
-- An Umbrella is never evaluated (tasks_umbrella_shape_ck forces its
-- Difficulty and Rating null, and tasks_evaluation_inputs_ck exempts it
-- outright): its own completion is a manager's acknowledgement that every
-- Subtask has already reached a terminal outcome on its own. This command
-- is that acknowledgement -- a plain rollup write, never an Evaluation, and
-- it creates no task_evaluations row and no points_ledger row.
--
--
-- THE LOCK MODE -- read this before changing any keyword below
-- ---------------------------------------------------------------------
-- This is the third command in the wave with exactly the "lock the parent,
-- then reach for its children" shape -- #338 (reopen_task) shipped the bug
-- here first and #339 (cancel_task) hit it again on the cascade; both fixes
-- produced the wave's Ruling 20, which this migration simply applies a third
-- time:
--
--     A parent/Umbrella row is locked FOR NO KEY UPDATE, never FOR UPDATE.
--
-- private.evaluate_task, run against one of this Umbrella's Subtasks, writes
-- a `subtask_completed` task_activity row and a coalesced manager
-- notification that both NAME THE UMBRELLA. Every insert of a referencing
-- row runs its referential-integrity check as
--
--     select 1 from public.tasks where id = $1 for key share
--
-- so evaluate_task's session holds {Subtask FOR UPDATE} (taken by whichever
-- command called it -- complete_task_review, mark_task_unfulfilled, ..., all
-- of which lock the Subtask FOR UPDATE at their own step 3) and then asks
-- for {Umbrella FOR KEY SHARE}.
--
-- This command is the mirror image: it holds the Umbrella and then reaches
-- for its Subtasks, FOR SHARE, to read their statuses. Had it taken the
-- Umbrella FOR UPDATE, the two sessions would form a genuine ABBA cycle --
-- this command holding the Umbrella and waiting on a Subtask evaluate_task
-- holds FOR UPDATE, evaluate_task holding that Subtask and waiting on the
-- Umbrella this command holds -- and Postgres would resolve it by aborting
-- one of the two backends with 40P01, possibly the legitimate evaluation
-- rather than this rollup.
--
-- FOR NO KEY UPDATE does not conflict with FOR KEY SHARE, so evaluate_task's
-- parent-naming insert goes straight through while this command holds the
-- Umbrella -- the cycle cannot form. FOR NO KEY UPDATE does conflict with
-- itself and with FOR UPDATE, so concurrent completions of the same
-- Umbrella, and every other Task command (all of which lock the tasks row
-- FOR UPDATE), still serialize against this one. And it is exactly the
-- strength the UPDATE below takes anyway: status and completed_at are
-- neither of them key columns, and the only unique index on public.tasks is
-- the primary key.
--
-- The Umbrella lock is taken unconditionally, not only once the row is
-- confirmed to be an Umbrella -- the row must be locked before its `kind`
-- can even be read safely, and the weaker mode costs an ordinary Task
-- nothing: the only lock it stops conflicting with is FOR KEY SHARE, taken
-- exclusively by foreign keys pointing AT this row, never by a command that
-- would race this one.
--
-- The SUBTASK locks stay FOR SHARE, exactly as the brief pins, and that is
-- deliberately the weakest mode that still serializes correctly. This
-- command only READS the Subtasks' statuses -- it never writes them -- so
-- there is no write to protect with anything stronger. FOR SHARE conflicts
-- with FOR UPDATE (evaluate_task, start_task, give_up_task, ... all hold a
-- live Subtask FOR UPDATE) and with FOR NO KEY UPDATE (cancel_task's cascade
-- holds a Subtask being cancelled in that mode), so a Subtask genuinely being
-- worked on or cancelled still blocks this command until that transaction
-- commits and the caller sees its final, committed status. FOR SHARE does
-- NOT conflict with FOR KEY SHARE or with itself, which is irrelevant here:
-- nothing in this command's own transaction asks for either of those on a
-- Subtask, and no cycle can close through a lock this command never
-- requests. Strengthening the Subtask read to FOR UPDATE or FOR NO KEY
-- UPDATE would buy nothing (this command writes no Subtask column) and would
-- only add more lock modes to reason about; it stays FOR SHARE.
--
-- MUTATION-VERIFIED: with the Umbrella lock changed to FOR UPDATE, the
-- deadlock below reproduces exactly as this header describes and the suite's
-- section 10 goes red on one of its two outcome assertions (which one
-- depends on whose deadlock_timeout the database picks to abort -- see the
-- test file). Restoring FOR NO KEY UPDATE returns the suite to green. See
-- the task report for the captured `psql` output of both runs. DO NOT
-- "strengthen" this lock back to FOR UPDATE -- that is not a stricter
-- version of the rule, it is the version that deadlocks.
--
--
-- Step order inside private.complete_umbrella_task_impl (binding)
-- -----------------------------------------------------------------------
-- The command takes no parameter besides p_task_id, so there is no step-1
-- malformed-input check to write -- the wave-level carry-forward already
-- settles that a null p_task_id is PT404 task_not_found via
-- private.can_read_task(null), not a PT400 (the #334/#335 precedent for
-- every single-parameter command in this wave).
--   2. private.require_task_visible -- gate + visibility.
--   3. Lock the target FOR NO KEY UPDATE (see above), `if not found` PT404
--      task_not_found guard (a concurrent hard delete is still reachable
--      until #345 retires tasks_delete_legacy).
--   4. private.require_task_manager under that lock -- an Umbrella's
--      completion is a rollup acknowledgement, not an Evaluation, so the
--      authority is the same MANAGER boundary #339 (cancel_task) uses, not
--      require_task_evaluator: an Independent Team's own active members may
--      complete their own Team's Umbrella once every Subtask is terminal,
--      exactly as they may cancel one, even though they may never evaluate
--      a single Subtask under it.
--   5. No further input to validate.
--   6. State preconditions, in the brief's own order: kind = 'umbrella'
--      (PT409 task_not_umbrella) -- checked first so an ordinary Task
--      answers the real reason rather than a status-shaped one it happens to
--      share; status not already terminal (PT409 task_terminal); then, in
--      ONE statement, the Subtask read this migration's header analyses
--      above, which answers both remaining preconditions at once: zero
--      Subtasks (PT409 umbrella_has_no_subtasks) and any Subtask not yet
--      terminal (PT409 subtasks_not_terminal, with the non-terminal count on
--      the exception's `detail`, via `using message = ..., detail = ...` --
--      no repo precedent tests a `detail` field before this migration, so
--      the suite adds a small pg_temp helper that captures it with `get
--      stacked diagnostics`).
--   7. Mutate -> log_task_activity -> notify, then re-read the target.
--
--
-- What this command does NOT do
-- ------------------------------
-- No Difficulty, no Rating, no task_evaluations row, no points_ledger row:
-- an Umbrella is a rollup of work already scored on its Subtasks, not work
-- of its own (ADR-0007). tasks_umbrella_shape_ck already forces Difficulty
-- and Rating null for every Umbrella, so the UPDATE below simply never names
-- either column. No Candidate Queue is touched -- an Umbrella never opens
-- one (tasks_umbrella_shape_ck forces audience/assignment_mode null), and
-- tasks_queue_timestamp_state_check's two branches both test
-- `assignment_mode = 'direct'` / `= 'public'`, which are NULL, not FALSE,
-- against a NULL assignment_mode -- the whole OR evaluates to NULL and the
-- CHECK (which only rejects on an explicit FALSE) passes vacuously, exactly
-- as it always has for every other Umbrella transition in this wave. No
-- Subtask is written: the Subtask read above is FOR SHARE precisely because
-- it is read-only.
--
-- private.task_managers(p_task_id, v_actor) is usually empty here: the
-- caller completing an Umbrella is, in the ordinary case, its own manager --
-- the local BCE who created it, or the sole BC -- and private.notify already
-- drops the actor from every recipient list it is given. The suite asserts
-- both shapes: the empty set (the usual case) and a non-empty one (a
-- different manager, or BC/Moderator completing a BCE-managed Umbrella).
--
-- No table-DML revoke accompanies this migration (conventions Sec2): this
-- command owns no table `authenticated` could otherwise reach directly --
-- public.tasks' own revoke lands in #345 alongside the other Task commands.

create function private.complete_umbrella_task_impl(p_task_id bigint)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor              uuid;
  v_task               public.tasks%rowtype;
  v_subtask_count      integer;
  v_non_terminal_count integer;
begin
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);

  -- 3. The lock. FOR NO KEY UPDATE, never FOR UPDATE -- see the header.
  select * into v_task from public.tasks where id = p_task_id for no key update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;

  -- 4. Authority under lock: the Umbrella's MANAGER (see the header for why
  --    not its evaluator -- an Umbrella carries no Evaluation of its own).
  perform private.require_task_manager(p_task_id);

  -- 5. Input validation: none beyond p_task_id, already resolved at step 2.

  -- 6. State preconditions, in the brief's order.
  if v_task.kind <> 'umbrella' then
    raise sqlstate 'PT409' using message = 'task_not_umbrella';
  end if;
  if v_task.status in ('completed', 'unfulfilled', 'cancelled') then
    raise sqlstate 'PT409' using message = 'task_terminal';
  end if;

  -- One statement answers both remaining preconditions: the Subtask read
  -- the header's lock analysis is about, FOR SHARE, never anything
  -- stronger -- this command reads Subtask statuses, it never writes them.
  select count(*),
         count(*) filter (where sub.status not in ('completed', 'unfulfilled', 'cancelled'))
    into v_subtask_count, v_non_terminal_count
    from (
      select id, status from public.tasks where parent_task_id = p_task_id for share
    ) as sub;

  if v_subtask_count = 0 then
    raise sqlstate 'PT409' using message = 'umbrella_has_no_subtasks';
  end if;
  if v_non_terminal_count > 0 then
    raise sqlstate 'PT409' using message = 'subtasks_not_terminal',
      detail = v_non_terminal_count::text;
  end if;

  -- 7. Mutate. No Difficulty, no Rating, no Candidate Queue -- see the
  --    header. now() for completed_at, the lifecycle-timestamp convention.
  update public.tasks
     set status = 'completed',
         completed_at = now()
   where id = p_task_id;

  -- assignment_id stays NULL: umbrella_completed is not "about the
  -- Executor's own work" (stack-context.md's activity-row rule) -- an
  -- Umbrella has no Executor at all.
  perform private.log_task_activity(p_task_id, 'umbrella_completed', v_actor, null,
    v_task.status, 'completed'::public.task_status, null,
    jsonb_build_object('subtask_count', v_subtask_count));

  perform private.notify(
    array(select private.task_managers(p_task_id, v_actor)),
    'task'::public.noti_kind,
    'Umbrelă finalizată: ' || v_task.title,
    'Toate subtaskurile sunt încheiate.',
    p_task_id, null, v_actor);

  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

comment on function private.complete_umbrella_task_impl(bigint) is
  'The Umbrella''s manager (private.require_task_manager, 42501 task_manage_forbidden -- an Independent Team''s own active members may complete their own Team''s Umbrella, which they may never evaluate) closes an Umbrella once every one of its Subtasks has reached a terminal outcome on its own; the actor is auth.uid(), never a parameter. Locks the target FOR NO KEY UPDATE -- never FOR UPDATE: private.evaluate_task takes an implicit FK FOR KEY SHARE on an Umbrella through its parent-naming inserts, and FOR UPDATE here would deadlock (40P01) against it (see the migration header; do not strengthen it) -- with an `if not found` PT404 task_not_found guard. PT409 task_not_umbrella for an ordinary Task, PT409 task_terminal for an Umbrella already completed/unfulfilled/cancelled, PT409 umbrella_has_no_subtasks for one with none at all, PT409 subtasks_not_terminal (the non-terminal count on the exception''s detail) when any Subtask is still todo/in_progress/in_review -- cancelled counts as terminal, same as completed/unfulfilled. The Subtasks are locked FOR SHARE only: this command reads their statuses and writes none of them. Sets status = completed and completed_at = now(); writes no Difficulty, no Rating, no task_evaluations row and no points_ledger row -- an Umbrella''s completion is a rollup of work already scored on its Subtasks, never an Evaluation of its own. Logs one umbrella_completed activity row (assignment_id NULL, from -> completed, details.subtask_count) and notifies private.task_managers, usually empty because the actor completing an Umbrella is ordinarily its own manager and private.notify always drops the actor.';

create function public.complete_umbrella_task(p_task_id bigint)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.complete_umbrella_task_impl(p_task_id);
$$;

comment on function public.complete_umbrella_task(bigint) is
  'Close an Umbrella once every one of its Subtasks has reached a terminal outcome (completed, unfulfilled or cancelled) on its own. Callable by the Umbrella''s manager -- BC/Moderator anywhere, the local BCE of a Department or of a Department-Team''s parent Department, any active member of an Independent Team for their own Team''s Umbrella, or an active Project''s lead or Responsible. Refuses an ordinary Task, an already-terminal Umbrella, one with no Subtasks at all, or one with any Subtask still in progress. Awards no points: an Umbrella is never evaluated.';

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.complete_umbrella_task_impl(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.complete_umbrella_task(bigint)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;

grant execute on function private.complete_umbrella_task_impl(bigint) to authenticated;
grant execute on function public.complete_umbrella_task(bigint) to authenticated;
