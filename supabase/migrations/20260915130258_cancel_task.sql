-- #339: cancel_task -- a manager calls off work that will not happen, and the
-- system records WHY. Cancellation is terminal and preserves everything:
-- the Task row, its Assignment History, its Candidate Queue decisions and
-- every task_activity row stay exactly where they are.
--
-- Three things ship together here, because none of them is usable alone:
--
--   1. public.tasks.cancel_reason, backfilled and then constrained so that a
--      cancelled Task ALWAYS carries a non-blank reason and a live one never
--      carries one at all;
--   2. public.tasks_with_overdue recreated, so the new column is visible
--      through the app's read surface;
--   3. public.cancel_task / private.cancel_task_impl, the only writer of the
--      column, with its Umbrella cascade.
--
-- It also AMENDS private.reopen_task_impl (#338) -- see "The #338
-- interaction" below.
--
--
-- The column, the backfill and the constraint
-- -------------------------------------------
-- The column is added unconstrained, then backfilled, then constrained, in
-- that order, because staging already holds seeded `cancelled` Tasks
-- (supabase/seed.sql rebuilds legacy-shaped demo data) and an immediately
-- constrained column would fail the ALTER on a live database. The backfill
-- string is Romanian and explicitly names this issue, so a row carrying it is
-- recognisable as "cancelled before anyone was asked for a reason" rather
-- than as a real reason somebody typed.
--
-- tasks_cancel_reason_ck is a biconditional, not two independent tests:
--
--     (status = 'cancelled') = (cancel_reason is not null)
--
-- so it rejects BOTH a cancelled Task without a reason AND a reason left on a
-- Task that is not cancelled -- the second half is what keeps a reopened or
-- duplicated Task from carrying a stale explanation. `status` is NOT NULL, so
-- the left side is never null and the biconditional is never null either.
-- The blankness half is written `cancel_reason is null or cancel_reason ~
-- '[^[:space:]]'` with the explicit null guard in front, the #162/#343/#294
-- precedent: `null ~ pattern` evaluates to NULL, and a CHECK only rejects a
-- row when its expression is FALSE, so a bare regex would let a null through
-- as "unknown". The POSIX class catches tabs and newlines, which btrim() does
-- not.
--
-- No trigger and no separate command enforce this: the constraint is the
-- invariant, and private.cancel_task_impl is simply the only writer that can
-- satisfy it from the client side.
--
--
-- The view
-- --------
-- public.tasks_with_overdue was created as `select task.*, (...) as
-- is_overdue`, and Postgres expands `*` at CREATE time -- a column added to
-- public.tasks afterwards stays invisible through the view until it is
-- dropped and recreated. The definition below is the one #315 shipped,
-- verified against pg_get_viewdef('public.tasks_with_overdue') on this branch
-- before it was copied (its expansion matches public.tasks column for column,
-- plus is_overdue), NOT a column list retyped from a plan. security_invoker,
-- the comment and the grants are reproduced verbatim; nothing about the view
-- changes except that `task.*` now also yields cancel_reason.
--
--
-- THE LOCK MODES -- read this before changing any keyword below
-- -------------------------------------------------------------
-- private.evaluate_task (#336) writes, for a Subtask, a `subtask_completed`
-- task_activity row and a coalesced notification that both NAME THE UMBRELLA.
-- Every insert of a referencing row runs its referential-integrity check as
--
--     select 1 from public.tasks where id = $1 for key share
--
-- so evaluate_task holds {Subtask FOR UPDATE} and then asks for
-- {Umbrella FOR KEY SHARE}. FOR KEY SHARE conflicts with FOR UPDATE.
--
-- This command is the mirror image: it holds the Umbrella and then reaches
-- for its Subtasks. Had it taken the Umbrella FOR UPDATE, the two would form
-- a genuine ABBA cycle and Postgres would resolve it with 40P01 -- possibly
-- aborting the legitimate evaluation. #338 shipped exactly that bug and it
-- was caught in review; the wave's Ruling 20 followed:
--
--     A parent/Umbrella row is locked FOR NO KEY UPDATE, never FOR UPDATE.
--
-- FOR NO KEY UPDATE does not conflict with FOR KEY SHARE (so the cycle cannot
-- form), does conflict with itself and with FOR UPDATE (so concurrent
-- cancels, and every other Task command -- all of which lock the tasks row
-- FOR UPDATE -- still serialize against this one), and is exactly the
-- strength the UPDATE below takes anyway: status, cancelled_at and
-- cancel_reason are none of them key columns.
--
-- The TARGET row is therefore locked FOR NO KEY UPDATE unconditionally, not
-- only when it happens to be an Umbrella. The mode cannot be chosen per-kind
-- without an extra unlocked pre-read of `kind` plus a "the kind changed"
-- guard, and the weaker mode loses nothing: the only lock it stops
-- conflicting with is FOR KEY SHARE, which is taken exclusively by foreign
-- keys pointing AT this row -- never by a command that would race this one.
--
-- The CASCADE rows are locked FOR NO KEY UPDATE too, in ONE statement, before
-- any write, `order by sub.id` so the lock order between two concurrent
-- Umbrella cancels is deterministic. FOR NO KEY UPDATE still conflicts with
-- the FOR UPDATE a concurrent evaluate_task / give_up_task / start_task takes
-- on that same Subtask, so the cascade genuinely serializes against live work
-- on a Subtask; it is simply the weakest mode that does so. DO NOT
-- "strengthen" either of these to FOR UPDATE -- that is not a stricter
-- version of the rule, it is the version that deadlocks.
--
-- Taking all the Subtask locks in one statement BEFORE mutating anything is
-- also what makes the cascade all-or-nothing in an observable way, and it is
-- what the suite's section 10 discriminates: while the command is blocked on
-- the last Subtask, the earlier ones show pgrowlocks mode `For No Key Update`
-- (locked, untouched). Fold the lock into the mutation loop and they show
-- `No Key Update` instead -- the UPDATER mode -- because they would already
-- have been written. That is the mutation test, and it is real.
--
-- The INDEPENDENT-SUBTASK path takes NO parent lock at all
-- --------------------------------------------------------
-- Cancelling a Subtask on its own writes a `subtask_completed` row on its
-- Umbrella and one coalesced manager notification, exactly as
-- private.evaluate_task does -- and, exactly as evaluate_task does, it takes
-- no explicit lock on the parent. This deliberately departs from the wave's
-- general "lock the Umbrella first, then the Subtask" sentence: that rule
-- exists for commands that WRITE the parent's own columns (#338's rollback to
-- todo, #340's rollup), and this path writes only history rows that reference
-- it. Two sibling Subtasks cancelled concurrently therefore do not serialize
-- on the Umbrella; they serialize on the notification's dedupe key, because
-- private.notify upserts on (member_id, dedupe_key) while unread. The
-- consequence #336 already accepted applies unchanged: the surviving
-- coalesced row can carry a count one behind, the per-Subtask
-- `subtask_completed` ACTIVITY rows never coalesce and are the durable
-- record.
--
--
-- What the cascade does, and what it deliberately does not
-- --------------------------------------------------------
-- Cancelling an Umbrella cancels every Subtask that is not already terminal
-- (`completed`, `unfulfilled`, `cancelled`), with the SAME trimmed reason and
-- `details.cascade_from` = the Umbrella's id. Already-terminal Subtasks are
-- untouched -- their own outcome is history and this command never rewrites
-- history.
--
-- The cascade writes NO `subtask_completed` rows on the Umbrella. That
-- notification exists to tell an Umbrella's managers how far its Subtasks
-- have got; an Umbrella that is itself being cancelled in the same
-- transaction has no such question left, and the manager who cancelled it is
-- the actor private.notify would drop anyway. The durable record is the
-- Umbrella's own `cancelled` activity row (carrying
-- details.cascaded_subtask_ids) plus one `cancelled` row per Subtask.
--
-- Rows this command may change, exhaustively: public.tasks (status,
-- cancelled_at, cancel_reason, queue_closed_at), public.task_assignments
-- (ended_at, end_reason, end_note -- through private.end_task_assignment) and
-- public.task_candidates (status, decided_at, decided_by -- through
-- private.close_task_queue). It DELETES nothing and EDITS no history:
-- task_activity only grows, and task_evaluations / points_ledger are not
-- touched at all. A cancelled Task carries no Evaluation and no points; that
-- is the whole difference between `cancelled` and `unfulfilled` (#337).
--
-- private.close_task_queue is called with the ACTOR, not null: a cancellation
-- is a manager act with a person behind it, and
-- task_candidates_decision_shape_ck accepts either for a `closed` row.
-- (private.evaluate_task passes null because an Evaluation closes the queue
-- as a side effect of finishing the work, not as a decision about the queue.)
-- It must run BEFORE the status write -- tasks_queue_timestamp_state_check
-- demands queue_closed_at on a public Task at completed/unfulfilled/cancelled
-- and is a plain row CHECK, evaluated the instant the UPDATE writes the row.
--
--
-- Step order inside private.cancel_task_impl (binding)
-- ----------------------------------------------------
--   1. A blank or null p_reason is PT400 reason_required, raised BEFORE the
--      gate -- tasks_cancel_reason_ck makes a reasonless cancellation
--      impossible to write for ANY caller, authorized or not (the
--      #335/#336/#337/#338 precedent).
--   2. private.require_task_visible.
--   3. The locks: the target row FOR NO KEY UPDATE with its own `if not
--      found` PT404 guard (a concurrent hard delete is still reachable until
--      #345 retires tasks_delete_legacy), then -- only for an Umbrella -- its
--      non-terminal Subtasks, in one statement, also FOR NO KEY UPDATE.
--   4. private.require_task_manager under those locks. MANAGER, not
--      evaluator: cancelling awards nobody anything, so an Independent
--      Team's own active members may call off their own Team's Tasks
--      (private.can_manage_origin's Independent-Team branch), which they may
--      never do for an Evaluation.
--   5. Input validation: none beyond the reason, already checked.
--   6. State preconditions: PT409 task_terminal for completed / unfulfilled /
--      cancelled. An Umbrella is explicitly NOT refused -- cancelling one is
--      the point of the cascade.
--   7. Mutate -> log_task_activity -> notify, target first and then each
--      Subtask, and finally re-read the target.
--
--
-- The #338 interaction this migration closes
-- -------------------------------------------
-- private.reopen_task_impl refuses a Subtask whose Umbrella has moved
-- (task_parent_changed) and cascades a `completed` Umbrella back to todo, but
-- it says nothing about a CANCELLED Umbrella -- because until this migration
-- an Umbrella could not be cancelled at all, so the state was unreachable.
-- This migration makes it reachable, and therefore closes it here: reopening
-- a Subtask under a cancelled Umbrella would resurrect live work under a
-- called-off parent, which is the same rollup contradiction ADR-0007 forbids
-- in the other direction. Migrations are immutable once merged, so #338's
-- function is amended with `create or replace` below, adding exactly one
-- precondition (PT409 umbrella_cancelled) and changing nothing else. Because
-- it is a replace and not a new function, the pinned private roster does not
-- move on its account.
--
-- No table-DML revoke accompanies this migration (conventions Sec2). The
-- tables this command writes are owned by commands that will revoke together
-- in #345 (public.tasks), or already carry no `authenticated` DML
-- (public.task_assignments, public.task_candidates via #294's grants).

-- ==================== 1. The column ====================
alter table public.tasks add column cancel_reason text;

-- Backfill BEFORE the constraint: staging (and any hosted database seeded
-- from supabase/seed.sql) already holds `cancelled` Tasks from before anyone
-- was asked for a reason.
update public.tasks
   set cancel_reason = 'Anulat înainte de înregistrarea motivelor (#339).'
 where status = 'cancelled' and cancel_reason is null;

alter table public.tasks
  add constraint tasks_cancel_reason_ck check (
    (status = 'cancelled') = (cancel_reason is not null)
    and (cancel_reason is null or cancel_reason ~ '[^[:space:]]')
  );

comment on column public.tasks.cancel_reason is
  'Why a Task was called off, required on every cancelled Task and forbidden on every other one (tasks_cancel_reason_ck). Written only by public.cancel_task, which also stamps cancelled_at, records the reason on the cancelled activity row and sends it to the Executor. Rows cancelled before #339 carry the marker string "Anulat înainte de înregistrarea motivelor (#339)."';

comment on constraint tasks_cancel_reason_ck on public.tasks is
  'A cancelled Task always carries a non-blank cancel_reason and no other status ever carries one -- a biconditional, so a reason left behind by a reopen or a duplication is rejected too. The explicit null guard in front of the regex matters: null ~ pattern is NULL, and a CHECK only rejects on FALSE.';

-- ==================== 2. The view ====================
-- Recreated so `task.*` expands to include cancel_reason. Definition, storage
-- parameter, grants and comment are #315's, unchanged.
drop view public.tasks_with_overdue;

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

-- ==================== 3. cancel_task ====================
create function private.cancel_task_impl(p_task_id bigint, p_reason text)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor          uuid;
  v_reason         text;
  v_task           public.tasks%rowtype;
  v_sub            public.tasks%rowtype;
  v_subtask_ids    bigint[] := '{}'::bigint[];
  v_subtask_id     bigint;
  v_assignment_id  bigint;
  v_executor_id    uuid;
  v_closed         uuid[];
  v_parent_title   text;
  v_subtask_count  integer;
  v_terminal_count integer;
begin
  -- 1. Malformed for everyone: tasks_cancel_reason_ck makes a reasonless
  --    cancellation unwritable, so it is refused before the gate.
  if p_reason is null or p_reason !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'reason_required';
  end if;
  v_reason := regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');

  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);

  -- 3. The locks. FOR NO KEY UPDATE, never FOR UPDATE -- see the header.
  select * into v_task from public.tasks where id = p_task_id for no key update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;

  -- The cascade set, locked in ONE statement before anything is written, in
  -- a deterministic id order. Terminal Subtasks are neither locked nor
  -- touched: their outcome is history.
  if v_task.kind = 'umbrella' then
    select coalesce(array_agg(locked.id order by locked.id), '{}'::bigint[])
      into v_subtask_ids
      from (
        select sub.id
          from public.tasks as sub
         where sub.parent_task_id = p_task_id
           and sub.status not in ('completed', 'unfulfilled', 'cancelled')
         order by sub.id
           for no key update
      ) as locked;
  end if;

  -- 4. Authority under lock: the Task's MANAGER (see the header for why not
  --    its evaluator). Re-validates against live rows and holds the actor's
  --    profile -- and the membership the authority rests on -- FOR SHARE.
  perform private.require_task_manager(p_task_id);

  -- 5. Input validation: none beyond the reason, already checked at step 1.

  -- 6. State preconditions. An Umbrella is deliberately allowed.
  if v_task.status in ('completed', 'unfulfilled', 'cancelled') then
    raise sqlstate 'PT409' using message = 'task_terminal';
  end if;

  -- 7. Mutate: the target first, then each locked Subtask.

  -- The one active Assignment, if any. FOR UPDATE because this is the row
  -- private.end_task_assignment is about to close; the tasks row lock above
  -- already serializes callers, this is the inner safety net.
  select assignment.id, assignment.member_id
    into v_assignment_id, v_executor_id
    from public.task_assignments as assignment
   where assignment.task_id = p_task_id and assignment.ended_at is null
   for update;

  -- Before the status write: tasks_queue_timestamp_state_check requires
  -- queue_closed_at on a public Task the instant it becomes terminal. A
  -- direct Task or an Umbrella is a no-op and v_closed comes back '{}'.
  v_closed := private.close_task_queue(p_task_id, v_actor);

  update public.tasks
     set status        = 'cancelled',
         cancelled_at  = now(),
         cancel_reason = v_reason
   where id = p_task_id;

  if v_assignment_id is not null then
    perform private.end_task_assignment(v_assignment_id, 'cancelled', v_reason);
  end if;

  -- assignment_id stays NULL on a `cancelled` row (Global Constraints'
  -- activity-row rule); the Assignment that was ended is recorded in details.
  perform private.log_task_activity(p_task_id, 'cancelled', v_actor, null,
    v_task.status, 'cancelled'::public.task_status, v_reason,
    jsonb_build_object('ended_assignment_id', v_assignment_id,
                       'closed_candidates', coalesce(array_length(v_closed, 1), 0))
    || case when v_task.kind = 'umbrella'
              then jsonb_build_object('cascaded_subtask_ids', to_jsonb(v_subtask_ids))
            else '{}'::jsonb end);

  perform private.notify(v_closed, 'task'::public.noti_kind,
    'Coadă închisă: ' || v_task.title,
    'Nu mai poți fi selectat pentru acest task.',
    p_task_id, null, v_actor);

  if v_executor_id is not null then
    perform private.notify(array[v_executor_id], 'task'::public.noti_kind,
      'Task anulat: ' || v_task.title, v_reason, p_task_id, null, v_actor);
  end if;

  -- The cascade. Every id here was locked in step 3.
  foreach v_subtask_id in array v_subtask_ids loop
    select * into v_sub from public.tasks where id = v_subtask_id;

    select assignment.id, assignment.member_id
      into v_assignment_id, v_executor_id
      from public.task_assignments as assignment
     where assignment.task_id = v_subtask_id and assignment.ended_at is null
     for update;

    v_closed := private.close_task_queue(v_subtask_id, v_actor);

    update public.tasks
       set status        = 'cancelled',
           cancelled_at  = now(),
           cancel_reason = v_reason
     where id = v_subtask_id;

    if v_assignment_id is not null then
      perform private.end_task_assignment(v_assignment_id, 'cancelled', v_reason);
    end if;

    perform private.log_task_activity(v_subtask_id, 'cancelled', v_actor, null,
      v_sub.status, 'cancelled'::public.task_status, v_reason,
      jsonb_build_object('cascade_from', p_task_id,
                         'ended_assignment_id', v_assignment_id,
                         'closed_candidates', coalesce(array_length(v_closed, 1), 0)));

    perform private.notify(v_closed, 'task'::public.noti_kind,
      'Coadă închisă: ' || v_sub.title,
      'Nu mai poți fi selectat pentru acest task.',
      v_subtask_id, null, v_actor);

    if v_executor_id is not null then
      perform private.notify(array[v_executor_id], 'task'::public.noti_kind,
        'Task anulat: ' || v_sub.title, v_reason, v_subtask_id, null, v_actor);
    end if;
  end loop;

  -- The independent-Subtask rollup: a Subtask cancelled ON ITS OWN tells its
  -- Umbrella's managers how far the Umbrella has got. No parent lock -- see
  -- the header. Counts are taken AFTER the status update, so this Subtask is
  -- already inside terminal_count.
  if v_task.parent_task_id is not null then
    select parent.title into v_parent_title
      from public.tasks as parent where parent.id = v_task.parent_task_id;

    select count(*),
           count(*) filter (where sub.status in ('completed', 'unfulfilled', 'cancelled'))
      into v_subtask_count, v_terminal_count
      from public.tasks as sub
     where sub.parent_task_id = v_task.parent_task_id;

    perform private.log_task_activity(v_task.parent_task_id, 'subtask_completed',
      v_actor, null, null, null, null,
      jsonb_build_object('subtask_id', p_task_id,
                         'outcome', 'cancelled',
                         'terminal_count', v_terminal_count,
                         'subtask_count', v_subtask_count));

    -- Romanian numeral agreement, the rule the wave applies everywhere:
    -- singular at 1, bare plural for 2-19, `de` + plural from 20 up. The
    -- noun agrees with the total (the numeral it follows).
    perform private.notify(
      array(select private.task_managers(v_task.parent_task_id, v_actor)),
      'task'::public.noti_kind,
      'Subtask încheiat: ' || v_parent_title,
      case
        when v_subtask_count = 1 then v_terminal_count || ' din 1 subtask încheiat.'
        when v_subtask_count < 20 then
          v_terminal_count || ' din ' || v_subtask_count || ' subtaskuri încheiate.'
        else v_terminal_count || ' din ' || v_subtask_count || ' de subtaskuri încheiate.'
      end,
      v_task.parent_task_id,
      'task:' || v_task.parent_task_id::text || ':subtasks',
      v_actor);
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

comment on function private.cancel_task_impl(bigint, text) is
  'The Task''s manager (private.require_task_manager, 42501 task_manage_forbidden -- an Independent Team''s own active members may call off their own Team''s Tasks, which they may never evaluate) cancels a live Task with a recorded reason; the actor is auth.uid(), never a parameter. A blank or null reason is PT400 reason_required, raised before the membership gate (tasks_cancel_reason_ck makes a reasonless cancellation unwritable). Locks the target FOR NO KEY UPDATE -- never FOR UPDATE: private.evaluate_task takes an implicit FK FOR KEY SHARE on an Umbrella through its parent-naming inserts, and FOR UPDATE here would deadlock against it (see the migration header; do not strengthen it) -- with an `if not found` PT404 task_not_found guard, then, for an Umbrella, its non-terminal Subtasks in one statement, also FOR NO KEY UPDATE, ordered by id, before any write. PT409 task_terminal for completed/unfulfilled/cancelled; an Umbrella is deliberately accepted. Then, per Task: the Candidate Queue is closed with the actor as decided_by BEFORE the status write that tasks_queue_timestamp_state_check demands it precede, status becomes cancelled with cancelled_at and the trimmed cancel_reason, any active Assignment is ended with end_reason = cancelled and end_note = the reason, one `cancelled` activity row is appended (assignment_id NULL per the wave''s rule, from -> cancelled, the reason as note, details.ended_assignment_id/closed_candidates and, on an Umbrella, details.cascaded_subtask_ids), the closed Candidates and the Executor are notified ("Coadă închisă" / "Task anulat"). Cancelling an Umbrella cascades the same steps to every non-terminal Subtask with details.cascade_from; already-terminal Subtasks are untouched and no subtask_completed row is written for a cascade. A Subtask cancelled ON ITS OWN writes a subtask_completed row on its Umbrella and one coalesced manager notification keyed task:{umbrella}:subtasks, taking no lock on the parent. Deletes nothing and edits no history: task_evaluations and points_ledger are not touched at all.';

create function public.cancel_task(p_task_id bigint, p_reason text)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.cancel_task_impl(p_task_id, p_reason);
$$;

comment on function public.cancel_task(bigint, text) is
  'Call off a Task that will not happen, recording why. Callable by the Task''s manager -- BC/Moderator anywhere, the local BCE of a Department or of a Department-Team''s parent Department, any active member of an Independent Team for their own Team''s Tasks, or an active Project''s lead or Responsible. A non-blank reason is required and is recorded on the Task, on its activity row, on the Executor''s ended Assignment and in the Executor''s notification. Cancelling an Umbrella cancels every Subtask that has not already finished, with the same reason; Subtasks that are already completed, unfulfilled or cancelled keep their own outcome. Refuses a Task that is already completed, unfulfilled or cancelled. Nothing is deleted: the Task, its Assignment History and its Candidate Queue decisions all survive, and no points change hands -- a cancelled Task is never evaluated.';

-- ==================== 4. #338 amendment: no reopen under a cancelled Umbrella
-- Identical to 20260915114039_reopen_task.sql's function except for the one
-- new precondition marked below. See this migration's header for why it lands
-- here rather than in #338's own (immutable) file.
create or replace function private.reopen_task_impl(p_task_id bigint, p_reason text)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor              uuid;
  v_reason             text;
  v_task               public.tasks%rowtype;
  v_parent             public.tasks%rowtype;
  v_parent_id          bigint;
  v_evaluation         public.task_evaluations%rowtype;
  v_member_id          uuid;
  v_reversal_ledger_id bigint;
  v_new_assignment_id  bigint;
begin
  -- 1. Malformed for everyone: a reversal without a reason can never be
  --    written (task_evaluations_reversal_shape_ck), so it is rejected
  --    before the gate.
  if p_reason is null or p_reason !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'reason_required';
  end if;
  v_reason := regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');

  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);

  -- 3. The locks. This unlocked read exists only to learn WHICH parent row
  --    to lock first; every decision below is made from the locked rows.
  select parent_task_id into v_parent_id from public.tasks where id = p_task_id;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;

  -- FOR NO KEY UPDATE, not FOR UPDATE: private.evaluate_task takes an
  -- implicit FOR KEY SHARE on this same row through its parent-naming
  -- task_activity/notifications inserts, and FOR UPDATE would conflict with
  -- it and deadlock. See the header -- do not strengthen this.
  if v_parent_id is not null then
    select * into v_parent from public.tasks where id = v_parent_id for no key update;
    if not found then
      raise sqlstate 'PT404' using message = 'task_not_found';
    end if;
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;

  -- 4. Authority under lock: the Task's evaluator, never merely its manager.
  perform private.require_task_evaluator(p_task_id);

  -- 5. Input validation: none beyond the reason, already checked at step 1.

  -- 6. State preconditions.
  -- Defensive, and first: the Task's parent is re-read under its own lock,
  -- and a mismatch would mean the unlocked read above sent us to lock the
  -- wrong row -- i.e. the command would be holding no lock on the parent it
  -- is about to cascade into, silently breaking the lock order this whole
  -- file rests on. No command writes parent_task_id after creation, so the
  -- only writer that can produce this today is the legacy
  -- `tasks_update_legacy` policy, which #345 retires. Refuse rather than
  -- proceed unlocked; the caller retries and finds a consistent Task. It
  -- lives here, below the gate, so it answers only a caller step 4 has
  -- already authorized.
  if v_task.parent_task_id is distinct from v_parent_id then
    raise sqlstate 'PT409' using message = 'task_parent_changed';
  end if;

  -- #339, THE ONLY CHANGE IN THIS FUNCTION. A cancelled Umbrella has been
  -- called off in full -- public.cancel_task cascaded every non-terminal
  -- Subtask with it -- so putting one Subtask back to work under it would
  -- resurrect live work beneath a dead parent, the same rollup contradiction
  -- ADR-0007 forbids in the other direction (a completed Umbrella over a
  -- live Subtask, which the cascade below repairs). Unreachable before #339
  -- because an Umbrella could not be cancelled at all. It sits beside the
  -- other parent-shaped precondition, above task_is_umbrella, because a
  -- Subtask under a cancelled Umbrella is refused whatever its own status:
  -- there is no reopening it while its parent stands cancelled, and
  -- cancellation is terminal.
  if v_parent_id is not null and v_parent.status = 'cancelled' then
    raise sqlstate 'PT409' using message = 'umbrella_cancelled';
  end if;

  -- Kind next -- see the header.
  if v_task.kind <> 'task' then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  if v_task.status not in ('completed', 'unfulfilled') then
    raise sqlstate 'PT409' using message = 'task_not_evaluated';
  end if;

  -- 7. Mutate. The Evaluation is locked before it is reversed so that two
  --    concurrent reopens can never both see it open (the tasks row lock
  --    above already serializes them; this is the inner safety net, and the
  --    row the reversal and the ledger entry both hang off).
  select * into v_evaluation
    from public.task_evaluations as evaluation
   where evaluation.task_id = p_task_id
     and evaluation.reversed_at is null
     and evaluation.source = 'command'
   for update;
  if not found then
    raise sqlstate 'PT409' using message = 'evaluation_not_found';
  end if;

  -- The member the points were credited to: the EVALUATED Assignment's
  -- member. Read from that Assignment, never from the Task's current state.
  select assignment.member_id into v_member_id
    from public.task_assignments as assignment
   where assignment.id = v_evaluation.assignment_id;

  -- The Project authority refinement (see the header). can_evaluate_task's
  -- carve-out is keyed on the ACTIVE Assignment and is vacuous on a terminal
  -- Task, so the same rule is re-applied here against the Assignment being
  -- REVERSED: a Project Responsible may not undo the lead's award, nor their
  -- own -- including their own `unfulfilled` penalty. Level from the live
  -- profile, never from the token. Before any write.
  if v_task.project_id is not null
     and (select private.caller_level()) < 6
     and not coalesce(private.is_project_lead(v_task.project_id), false)
     and (v_member_id = v_actor
          or v_member_id = (select project.leader_id
                              from public.projects as project
                             where project.id = v_task.project_id))
  then
    raise exception using errcode = '42501', message = 'task_evaluate_forbidden';
  end if;

  -- Exactly the trio, exactly once -- the only UPDATE
  -- private.guard_task_evaluation_change permits.
  update public.task_evaluations
     set reversed_at     = now(),
         reversed_by     = v_actor,
         reversal_reason = v_reason
   where id = v_evaluation.id;

  insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id)
  values (v_member_id, -v_evaluation.points, 'task_reversal', p_task_id, v_evaluation.id)
  returning id into v_reversal_ledger_id;

  update public.tasks
     set status         = 'in_progress',
         difficulty     = null,
         rating         = null,
         completed_at   = null,
         unfulfilled_at = null,
         submitted_at   = null,
         started_at     = coalesce(started_at, now())
   where id = p_task_id;

  -- A NEW Assignment for the same member; the old one keeps its ending.
  -- p_via = 'reopen' suppresses the helper's own "Task nou" notification.
  v_new_assignment_id := private.open_task_assignment(p_task_id, v_member_id, v_actor, 'reopen');

  -- The cascade: only a COMPLETED Umbrella is an impossible parent for a
  -- live Subtask (ADR-0007's rollup rule). Any other status is left alone.
  if v_parent_id is not null and v_parent.status = 'completed' then
    update public.tasks
       set status = 'todo', completed_at = null
     where id = v_parent_id;
    perform private.log_task_activity(v_parent_id, 'reopened', v_actor, null,
      'completed'::public.task_status, 'todo'::public.task_status, v_reason,
      jsonb_build_object('cascade_from', p_task_id));
  end if;

  perform private.log_task_activity(p_task_id, 'reopened', v_actor, v_new_assignment_id,
    v_task.status, 'in_progress'::public.task_status, v_reason,
    jsonb_build_object('evaluation_id', v_evaluation.id,
                       'reversal_ledger_id', v_reversal_ledger_id,
                       'new_assignment_id', v_new_assignment_id));

  -- The reactivated Executor only. The Umbrella's managers get nothing of
  -- their own: the cascade is bookkeeping that follows from this Subtask,
  -- and the durable record is the Umbrella's own `reopened` activity row.
  -- private.notify drops the actor, so an evaluator reopening their own work
  -- is not messaged about it.
  perform private.notify(array[v_member_id], 'task'::public.noti_kind,
    'Task redeschis: ' || v_task.title, v_reason, p_task_id, null, v_actor);

  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

comment on function private.reopen_task_impl(bigint, text) is
  'The Task''s evaluator (private.require_task_evaluator, 42501 task_evaluate_forbidden) reopens a completed or unfulfilled ordinary Task, reversing its Evaluation atomically; the actor is auth.uid(), never a parameter. A blank or null reason is PT400 reason_required, raised before the membership gate (task_evaluations_reversal_shape_ck demands a non-blank reversal_reason). Locks the Umbrella FIRST and then the Task when parent_task_id is set -- the Umbrella FOR NO KEY UPDATE specifically, because private.evaluate_task takes an implicit FK FOR KEY SHARE on the parent through its parent-naming inserts and FOR UPDATE here would deadlock against it (see 20260915114039_reopen_task.sql''s header; do not strengthen it). On a Project Task the evaluate-authority rule is re-applied against the Assignment being reversed -- a Responsible below level 6 who is not the lead may undo neither the lead''s award nor their own (42501 task_evaluate_forbidden), because private.can_evaluate_task''s carve-out is keyed on the ACTIVE Assignment and a terminal Task has none. PT409 task_parent_changed when the Task''s parent moved between the unlocked pre-read and the locks, PT409 umbrella_cancelled when the parent Umbrella has been cancelled (#339 -- a called-off Umbrella cascades every live Subtask with it, so nothing under it may be put back to work), PT409 task_is_umbrella for an Umbrella (it carries no Evaluation; #340 owns its rollup), PT409 task_not_evaluated for any status but completed/unfulfilled, PT409 evaluation_not_found when no open source = command Evaluation exists (a Task carrying only #317''s legacy_migration credit has nothing of its own to reverse). Then: the Evaluation gets its reversal trio (the single UPDATE the append-only guard permits), one reason = task_reversal points_ledger row credits the EVALUATED Assignment''s member with -points -- correct for a zero or negative award too -- so both rows stand and the member''s total returns to its pre-evaluation value, the Task returns to in_progress with Difficulty/Rating/completed_at/unfulfilled_at/submitted_at cleared and started_at set if it never was, the Candidate Queue deliberately STAYS closed (#331''s set_task_queue reopens it), and the same member gets a NEW Assignment via private.open_task_assignment(..., ''reopen'') -- PT400 invalid_executor, rolling the whole reversal back, if they have since been deactivated. A completed Umbrella is cascaded back to todo with its own reopened row (details.cascade_from). Logs reopened (new assignment id, completed|unfulfilled -> in_progress, the trimmed reason, details.evaluation_id/reversal_ledger_id/new_assignment_id) and notifies the reactivated Executor ("Task redeschis").';

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.cancel_task_impl(bigint, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.cancel_task(bigint, text)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;

grant execute on function private.cancel_task_impl(bigint, text) to authenticated;
grant execute on function public.cancel_task(bigint, text) to authenticated;
