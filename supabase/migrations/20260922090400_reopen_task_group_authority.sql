-- #524: reopen_task decides its evaluate-authority refinement on Groups, not on the legacy Origin.
--
-- Wave-review must-fix M2. docs/backend/conventions.md §10 says the two shims
-- (can_manage_origin, require_origin_manager) are the only legacy authority
-- readers left in the kit. They were not: private.reopen_task_impl still
-- decided a 42501 task_evaluate_forbidden from the legacy structure tables --
-- a work command, not a structure command, not bridge code and not a mapped
-- argument. That made the sentence false in the one document the wave tells
-- every future agent to read first, left house rule 13's "never add a new
-- legacy branch to an authority helper" with an undeclared survivor, and
-- would have broken outright in Wave 3 when those tables are dropped.
--
-- The rule is unchanged; only where it reads from is. 20260915114039's header
-- explains why the refinement exists at all: private.can_evaluate_task's
-- carve-out is keyed on the Task's Executor, and on the terminal Task this
-- command operates on that Executor is the Assignment being REVERSED. The
-- refinement re-applies the same rule against that Assignment, so a Group
-- Responsible below level 6 may undo neither a Manager's nor another
-- Responsible's award, nor their own `unfulfilled` penalty.
--
-- Restated here through private.group_role_of and private.actor_level: the
-- Group Role walks the path (so an ancestor's Manager counts, which the
-- legacy body could not express), the level comes from the live Profile, and
-- a member with no live role reads as an ordinary member -- the same coalesce
-- private.can_evaluate_task itself uses. Signature, error code and reason
-- string are identical, and every other line of the body is restated verbatim
-- because `create or replace` has no partial form (conventions §1: a merged
-- migration is never edited).
--
-- Under the Wave 2 gate at step 4 the two shapes agree on every input a
-- caller can reach, which is D1's "redundant with can_evaluate_task" finding
-- from the other side: the refinement is defence in depth, and what changed
-- is that it no longer reads a table Wave 3 removes. reopen_task.test.sql
-- pins that directly, on the catalog.

create or replace function private.reopen_task_impl(p_task_id bigint, p_reason text)
returns public.tasks language plpgsql security definer set search_path = ''
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

  -- The evaluate-authority refinement, now decided on Groups (#524). It used
  -- to read the legacy Origin directly; the rule is unchanged, the source of
  -- truth is not. private.can_evaluate_task's Group Responsible carve-out is
  -- keyed on "the active Assignment, else the most recent one", so the same
  -- rule is re-applied here against the Assignment actually being REVERSED: a
  -- Group Responsible below level 6 may undo neither a Group Manager's nor
  -- another Responsible's award nor their own -- including their own
  -- `unfulfilled` penalty (ADR-0007, ADR-0009 Wave 2). Roles come from
  -- private.group_role_of, which walks the Group path, so an ancestor's
  -- Manager is a Manager here; level comes from the live Profile, never from
  -- the token. A member with no live role reads as an ordinary member, the
  -- same coalesce private.can_evaluate_task uses. Before any write.
  if coalesce(private.actor_level(v_actor), -1) < 6
     and private.group_role_of(v_task.group_id, v_actor) = 'responsible'
     and (v_member_id = v_actor
          or coalesce(private.group_role_of(v_task.group_id, v_member_id), 'member')
               in ('manager', 'responsible'))
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
  'The Task''s evaluator (private.require_task_evaluator, 42501 task_evaluate_forbidden) reopens a completed or unfulfilled ordinary Task, reversing its Evaluation atomically; the actor is auth.uid(), never a parameter. A blank or null reason is PT400 reason_required, raised before the membership gate (task_evaluations_reversal_shape_ck demands a non-blank reversal_reason). Locks the Umbrella FIRST and then the Task when parent_task_id is set -- the Umbrella FOR NO KEY UPDATE specifically, because private.evaluate_task takes an implicit FK FOR KEY SHARE on the parent through its parent-naming inserts and FOR UPDATE here would deadlock against it (see 20260915114039_reopen_task.sql''s header; do not strengthen it). The evaluate-authority rule is re-applied against the Assignment being reversed -- a Group Responsible below level 6 may undo neither a Group Manager''s nor another Responsible''s award, nor their own (42501 task_evaluate_forbidden) -- because private.can_evaluate_task''s carve-out is keyed on the Task''s Executor, and on the terminal Task this command operates on that Executor is precisely the Assignment being reversed. Roles come from private.group_role_of, which walks the Group path, and the level from the live Profile: the refinement carries no legacy Origin branch of its own (#524, ADR-0009 Wave 2). PT409 task_parent_changed when the Task''s parent moved between the unlocked pre-read and the locks, PT409 umbrella_cancelled when the parent Umbrella has been cancelled (#339 -- a called-off Umbrella cascades every live Subtask with it, so nothing under it may be put back to work), PT409 task_is_umbrella for an Umbrella (it carries no Evaluation; #340 owns its rollup), PT409 task_not_evaluated for any status but completed/unfulfilled, PT409 evaluation_not_found when no open source = command Evaluation exists (a Task carrying only #317''s legacy_migration credit has nothing of its own to reverse). Then: the Evaluation gets its reversal trio (the single UPDATE the append-only guard permits), one reason = task_reversal points_ledger row credits the EVALUATED Assignment''s member with -points -- correct for a zero or negative award too -- so both rows stand and the member''s total returns to its pre-evaluation value, the Task returns to in_progress with Difficulty/Rating/completed_at/unfulfilled_at/submitted_at cleared and started_at set if it never was, the Candidate Queue deliberately STAYS closed (#331''s set_task_queue reopens it), and the same member gets a NEW Assignment via private.open_task_assignment(..., ''reopen'') -- PT400 invalid_executor, rolling the whole reversal back, if they have since been deactivated. A completed Umbrella is cascaded back to todo with its own reopened row (details.cascade_from). Logs reopened (new assignment id, completed|unfulfilled -> in_progress, the trimmed reason, details.evaluation_id/reversal_ledger_id/new_assignment_id) and notifies the reactivated Executor ("Task redeschis").';
