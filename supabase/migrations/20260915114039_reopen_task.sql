-- #338: reopen_task -- the undo of an Evaluation. An evaluator reopens a
-- completed or unfulfilled Task: the open Evaluation is reversed, the points
-- it awarded are given back through a second ledger row, and the same member
-- is put back to work on a NEW Assignment, all in one transaction.
--
-- This is the only command in the wave that gives points back. Everything
-- below exists to make that reversal exact and atomic.
--
-- The lock order, and the lock STRENGTH on the Umbrella
-- -----------------------------------------------------
-- Global Constraints pin one rule: a command that touches a Subtask AND its
-- Umbrella locks the UMBRELLA FIRST, then the Subtask. This command does
-- exactly that. private.evaluate_task (#336) takes no EXPLICIT lock on the
-- parent at all -- it writes the Umbrella's subtask_completed activity row
-- and its coalesced manager notification while holding only the Subtask
-- lock.
--
-- That is NOT the same as "evaluate_task never waits on the parent", and an
-- earlier draft of this header claimed exactly that and was WRONG. Both of
-- those inserts carry a foreign key to public.tasks
-- (task_activity.task_id NOT NULL, notifications.task_id), and every insert
-- of a referencing row runs its referential-integrity check as
--
--     select 1 from public.tasks where id = $1 for key share
--
-- So private.evaluate_task DOES acquire an implicit FOR KEY SHARE on the
-- Umbrella, one statement after it has taken the Subtask FOR UPDATE.
--
-- FOR KEY SHARE conflicts with FOR UPDATE. Had this command locked the
-- parent FOR UPDATE, the two would form a genuine ABBA cycle on one Subtask:
--
--   * session A (evaluate_task on the Subtask) holds {Subtask FOR UPDATE}
--     and then asks for {Umbrella FOR KEY SHARE};
--   * session B (reopen_task on the same Subtask) holds
--     {Umbrella FOR UPDATE} and then asks for {Subtask FOR UPDATE}.
--
-- Postgres resolves that with 40P01 deadlock detected, and the victim can be
-- A -- a legitimate evaluation aborted because a manager acted on a stale
-- page.
--
-- The parent is therefore locked FOR NO KEY UPDATE, deliberately:
--
--   * FOR NO KEY UPDATE does NOT conflict with FOR KEY SHARE, so
--     evaluate_task's FK checks never block behind it and the cycle cannot
--     form at all;
--   * it still conflicts with ITSELF, so two reopens of Subtasks under one
--     Umbrella still serialize in a fixed order -- the property the lock is
--     there for;
--   * it is exactly the strength the cascade's own UPDATE takes anyway: that
--     UPDATE sets status and completed_at, neither of them a key column.
--
-- DO NOT "strengthen" this back to FOR UPDATE. It is not a weaker version of
-- the rule, it is the version that does not deadlock; the suite's deadlock
-- section reproduces the cycle directly and fails with 40P01 if the keyword
-- is changed. (private.validate_task_hierarchy's parent FOR SHARE would
-- conflict even with FOR NO KEY UPDATE, but its trigger fires only on insert
-- or update OF parent_task_id/dept_id/team_id/project_id/kind, and no
-- lifecycle UPDATE in the wave names any of those columns.)
--
-- The cascade. A completed Umbrella with a live Subtask violates ADR-0007's
-- rollup rule, so reopening a Subtask whose Umbrella is `completed` flips the
-- Umbrella back to `todo` with completed_at cleared and logs its own
-- `reopened` row carrying details.cascade_from = the Subtask id. `todo` (not
-- `in_progress`) is what the brief pins and it is also the only status the
-- constraints allow to be reached blindly: an Umbrella can never carry
-- started_at -- it has no Assignment, so private.start_task_impl's
-- require_task_executor can never succeed on one -- and
-- tasks_started_at_state_check would otherwise forbid `todo`. An Umbrella in
-- any other status is left alone: only `completed` is the state the rollup
-- rule makes impossible.
--
-- Which Evaluation is reversed
-- ----------------------------
-- Exactly one: the open `command` Evaluation
-- (`reversed_at is null and source = 'command'`), which
-- task_evaluations_one_open_per_task_uidx already caps at one per Task. None
-- is PT409 evaluation_not_found.
--
-- #316's own header asked this command to reverse "every open Evaluation of
-- the Task, legacy ones included". It deliberately does not, and the
-- divergence is stated here rather than buried:
--   * a `legacy_migration` Evaluation records a credit whose evaluator is
--     unknown and whose inputs were reconstructed by #317's backfill. This
--     command has no evidence with which to take that credit away, and
--     task_evaluations_reversal_shape_ck would make it stamp the reopening
--     evaluator as `reversed_by` for a decision they never made;
--   * nothing forces the issue: the per-Task open cap is scoped to
--     `source = 'command'` and the per-Assignment cap keys on the Assignment,
--     which a reopen replaces with a brand-new row. So a legacy credit
--     standing beside a new command Evaluation breaks no invariant, and the
--     Task still converges on the single-Executor model going forward, which
--     is what #316 actually wanted.
-- A Task carrying ONLY a legacy Evaluation therefore has nothing of its own
-- to reverse and is refused with PT409 evaluation_not_found. Retiring legacy
-- credits is a migration's job, with a human deciding each one -- not a
-- side effect of a manager reopening a Task.
--
-- The reversal itself
-- -------------------
-- The Evaluation update sets exactly the reversal trio (reversed_at,
-- reversed_by, reversal_reason) and nothing else -- the ONLY update
-- private.guard_task_evaluation_change permits, and only once, on a row that
-- is still open.
--
-- The ledger row credits `delta = -evaluation.points` to the EVALUATED
-- ASSIGNMENT'S member -- not the actor, and not "the current Executor",
-- which after the new Assignment opens would be the same person here but
-- would stop being a reliable way to say it. `-points` is correct for a zero
-- or negative award too: public.rating_mult maps Rating 1..5 to -1, 0, 1, 2,
-- 3, so a Rating-1 Evaluation awarded `-difficulty` and its reversal must ADD
-- that back. points_ledger_evaluation_reason_uidx allows exactly one `task`
-- and one `task_reversal` row per Evaluation, so both rows stand side by side
-- and the member's total returns to its exact pre-evaluation value -- the
-- ledger stays append-only, nothing is rewritten or deleted.
--
-- awarded_by is left null, exactly as private.evaluate_task leaves it on the
-- credit row: the Evaluation's own reversed_by names the reverser, and a
-- second copy on the ledger row could only ever disagree with it.
--
-- Reactivation
-- ------------
-- A NEW task_assignments row for the same member, through
-- private.open_task_assignment(..., 'reopen'). The old Assignment keeps its
-- `completed`/`failed` ending -- Assignment History is a record, not a
-- workspace. 'reopen' is the one p_via value that suppresses the helper's
-- "Task nou" notification, because this command sends "Task redeschis"
-- itself; the member gets one message, not two.
--
-- Consequence, deliberate and pinned by the suite: if that member has since
-- been DEACTIVATED, open_task_assignment raises PT400 invalid_executor and
-- the whole command -- reversal included -- rolls back. ADR-0007 opens with
-- "Active OSUBB membership is mandatory for every operation", and a reopen
-- names one specific person rather than picking one, so it must fail loudly
-- (the #333 rule) rather than reverse the points and leave the Task with no
-- Executor.
--
-- The Task update clears everything the Evaluation set -- difficulty, rating,
-- completed_at, unfulfilled_at -- and submitted_at, which
-- tasks_submitted_at_state_check forbids outside
-- in_review/completed/unfulfilled/cancelled. started_at becomes
-- coalesce(started_at, now()): an `unfulfilled` Task may never have been
-- started, and tasks_started_at_state_check only objects to started_at on a
-- `todo` row, so in_progress + a fresh started_at is the one shape that fits.
-- review_round and returned_to_progress_at are untouched: how many times the
-- work came back from review is history, not part of this transition.
--
-- THE QUEUE STAYS CLOSED. private.evaluate_task closed it on the way to the
-- terminal status; reopening does not re-open it, and no constraint asks it
-- to (tasks_queue_timestamp_state_check only requires queue_closed_at on the
-- terminal statuses). A manager who wants candidates again calls #331's
-- set_task_queue, which is now legal on the reopened Task.
--
-- That closed queue is also what makes a carry-forward constraint hold for
-- free: nothing may leave a Member simultaneously the active Executor and a
-- `pending` Candidate. private.evaluate_task closed every pending
-- Candidature when the Task became terminal, and while the Task IS terminal
-- express_task_interest refuses (PT409 task_terminal) and set_task_queue
-- refuses (PT409 task_terminal), so no new pending row can appear in between.
-- The state is unreachable, so this command adds no guard against it -- it
-- pins the absence in its suite instead.
--
-- One authority rule is refined HERE rather than in can_evaluate_task
-- -------------------------------------------------------------------
-- private.can_evaluate_task's Project carve-out -- "a Responsible may not
-- evaluate the lead's work, nor their own" -- is keyed on the Task's ACTIVE
-- Assignment (ended_at is null). A completed or unfulfilled Task has none,
-- so on exactly the Tasks this command operates on the carve-out is
-- vacuously true and a Project Responsible would pass: free to reverse the
-- award on the LEAD's evaluated work, or on their OWN -- including erasing
-- their own `unfulfilled` penalty. That is a direct self-benefit and
-- ADR-0007 forbids it ("A Responsible's own work requires the lead or
-- BC/Moderator. A Responsible cannot evaluate the lead.").
--
-- The shared predicate is deliberately NOT changed: "the active Assignment"
-- is the correct key for #336/#337, which act on live work, and moving it
-- would change their behaviour too. This command instead re-applies the same
-- rule against the Assignment it is REVERSING, which is the one that matters
-- here. Three details that must not drift:
--   * the actor's level comes from private.caller_level() (live
--     profiles/roles), never from JWT claims -- a stale level-6 token must
--     not buy the exemption;
--   * the lead is identified by projects.leader_id, the same key
--     private.is_project_lead and can_evaluate_task's carve-out both use, so
--     the actor side and the member side can never disagree;
--   * the "actor is not the Project lead" clause is what keeps the LEAD able
--     to reopen their own work, which can_evaluate_task explicitly permits.
--
-- The check necessarily sits in step 7 rather than step 4: it needs the
-- Evaluation row to know which Assignment is being reversed, and that row is
-- not read until the mutation begins. Nothing is disclosed by the ordering
-- (the caller already passed require_task_visible), and it is placed before
-- the first write. The code is 42501 task_evaluate_forbidden -- the same
-- reason private.require_task_evaluator raises for this command, because
-- this IS the evaluate-authority rule; a second string would only tell the
-- caller which branch fired.
--
-- Step order inside private.reopen_task_impl (binding):
--   1. A blank or null p_reason is PT400 reason_required, raised BEFORE the
--      gate -- task_evaluations_reversal_shape_ck requires a non-blank
--      reversal_reason, so a call without one can never succeed for any
--      caller, authorized or not (the #335/#336/#337 precedent).
--   2. private.require_task_visible.
--   3. The locks, in the wave's order: the Umbrella FIRST when
--      parent_task_id is set (FOR NO KEY UPDATE -- see above), then the Task
--      FOR UPDATE -- each with its own `if not found` PT404 guard (a
--      concurrent hard delete is still reachable until #345 retires
--      tasks_delete_legacy).
--   4. private.require_task_evaluator under those locks.
--   5. Input validation: none beyond the reason, already checked.
--   6. State preconditions: PT409 task_parent_changed first (the Task's
--      parent moved between the unlocked pre-read and the locks, so the
--      command holds no lock on the parent it would cascade into -- a state
--      conflict, and it answers only a caller step 4 has already
--      authorized), then PT409 task_is_umbrella (an Umbrella carries no
--      Evaluation at all -- #340 owns its rollup -- so checking status first
--      would answer task_not_evaluated and hide the real reason), then
--      PT409 task_not_evaluated for any status but completed/unfulfilled.
--   7. Mutate -> log_task_activity -> notify -> re-read. The Project
--      authority refinement above is the first thing inside it, before any
--      write.
--
-- No table-DML revoke accompanies this migration (conventions Sec2). Neither
-- table this command writes is writable by `authenticated`:
-- public.task_evaluations has every privilege revoked from all four roles
-- (#316) and is additionally append-only by trigger, and public.points_ledger
-- accepts only `reason = 'sanction'` inserts through ledger_sanction --
-- revoking insert on it outright would break BC sanctions, which are not this
-- command's to own.

create function private.reopen_task_impl(p_task_id bigint, p_reason text)
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
  'The Task''s evaluator (private.require_task_evaluator, 42501 task_evaluate_forbidden) reopens a completed or unfulfilled ordinary Task, reversing its Evaluation atomically; the actor is auth.uid(), never a parameter. A blank or null reason is PT400 reason_required, raised before the membership gate (task_evaluations_reversal_shape_ck demands a non-blank reversal_reason). Locks the Umbrella FIRST and then the Task when parent_task_id is set -- the Umbrella FOR NO KEY UPDATE specifically, because private.evaluate_task takes an implicit FK FOR KEY SHARE on the parent through its parent-naming inserts and FOR UPDATE here would deadlock against it (see the migration header; do not strengthen it). On a Project Task the evaluate-authority rule is re-applied against the Assignment being reversed -- a Responsible below level 6 who is not the lead may undo neither the lead''s award nor their own (42501 task_evaluate_forbidden), because private.can_evaluate_task''s carve-out is keyed on the ACTIVE Assignment and a terminal Task has none. PT409 task_parent_changed when the Task''s parent moved between the unlocked pre-read and the locks, PT409 task_is_umbrella for an Umbrella (it carries no Evaluation; #340 owns its rollup), PT409 task_not_evaluated for any status but completed/unfulfilled, PT409 evaluation_not_found when no open source = command Evaluation exists (a Task carrying only #317''s legacy_migration credit has nothing of its own to reverse). Then: the Evaluation gets its reversal trio (the single UPDATE the append-only guard permits), one reason = task_reversal points_ledger row credits the EVALUATED Assignment''s member with -points -- correct for a zero or negative award too -- so both rows stand and the member''s total returns to its pre-evaluation value, the Task returns to in_progress with Difficulty/Rating/completed_at/unfulfilled_at/submitted_at cleared and started_at set if it never was, the Candidate Queue deliberately STAYS closed (#331''s set_task_queue reopens it), and the same member gets a NEW Assignment via private.open_task_assignment(..., ''reopen'') -- PT400 invalid_executor, rolling the whole reversal back, if they have since been deactivated. A completed Umbrella is cascaded back to todo with its own reopened row (details.cascade_from). Logs reopened (new assignment id, completed|unfulfilled -> in_progress, the trimmed reason, details.evaluation_id/reversal_ledger_id/new_assignment_id) and notifies the reactivated Executor ("Task redeschis").';

create function public.reopen_task(p_task_id bigint, p_reason text)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.reopen_task_impl(p_task_id, p_reason);
$$;

comment on function public.reopen_task(bigint, text) is
  'Reopen a completed or unfulfilled Task you evaluate, giving back the points it awarded and putting the same member back to work in one transaction. Callable only by the Task''s live evaluator -- BC/Moderator anywhere, the local BCE of a Department or of a Department-Team''s parent Department, or an active Project''s lead or Responsible; an Independent Team has no evaluator branch at all. A Project Responsible may not reopen the lead''s evaluated work, nor their own -- reversing an award is evaluating it, and undoing one''s own penalty is not a Responsible''s to do. A non-blank reason is required and is recorded on the Evaluation, the activity row and the Executor''s notification. The original Evaluation and its credit are preserved and marked reversed, never deleted. Refuses an Umbrella, a Task that is not completed or unfulfilled, a Task with no Evaluation of its own to reverse, and a Task whose evaluated Executor is no longer an active member. The Candidate Queue stays closed -- reopen it with set_task_queue if you want candidates again.';

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.reopen_task_impl(bigint, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.reopen_task(bigint, text)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;

grant execute on function private.reopen_task_impl(bigint, text) to authenticated;
grant execute on function public.reopen_task(bigint, text) to authenticated;
