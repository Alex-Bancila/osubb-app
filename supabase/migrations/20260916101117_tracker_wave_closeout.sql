-- #327/#336/#337/#340: tracker command wave closeout -- Ruling 20 for create_task, the step-1
-- rule for the two evaluating commands, and two catalog comments corrected.
--
-- This migration closes findings 1, 3, 5 and 6 of the final whole-wave review. It adds no
-- function and no grant: every function below is amended with `create or replace`, which
-- preserves the existing ACL, so the pinned private roster stays at 83.
--
-- ---------------------------------------------------------------------------------------
-- 1. Finding 1 (Major) -- private.create_task_impl locked the Umbrella parent FOR UPDATE.
--
-- Ruling 20 is categorical: a parent/Umbrella row is locked FOR NO KEY UPDATE, never FOR
-- UPDATE. private.evaluate_task writes task_activity and notifications rows that NAME the
-- Umbrella parent, and those inserts take an implicit foreign-key FOR KEY SHARE on that
-- row. FOR KEY SHARE conflicts with FOR UPDATE and does NOT conflict with FOR NO KEY
-- UPDATE. The deadlock that follows from the stronger mode was reproduced under mutation
-- three times during the wave (#338, #339, #340).
--
-- create_task_impl predates the ruling and was never revisited. It is the one surviving
-- counterexample in the wave. Today it is not a deadlock -- create_task never reaches a
-- second public.tasks row after taking the parent lock, so no ABBA cycle closes -- but it
-- is a real stall: while a Subtask is being created under an Umbrella, EVERY concurrent
-- evaluation of EVERY other Subtask of that Umbrella blocks on its parent-naming insert.
-- The weaker mode costs nothing: the INSERT that follows touches no column of the parent at
-- all, and the only unique index on public.tasks is its primary key (Ruling 22), so the
-- pre-taken lock never needs upgrading.
--
-- 2. Finding 5 (Minor) -- where invalid_difficulty / invalid_rating are raised.
--
-- private.approve_completed_work_request_impl raises both at step 1, ahead of the gate;
-- complete_task_review_impl and mark_task_unfulfilled_impl raised the identical checks at
-- step 5, after authority. A claimless caller therefore got PT400 from one command and
-- 42501 from its two siblings for the same malformed input. Settled toward step 1: a value
-- outside a CHECK's range could never succeed for ANY caller, so it is malformed for
-- everyone and belongs before the gate -- the same argument that already hoists the
-- evaluation note in all three. Nothing else in either body moves.
--
-- 3/4. Findings 3 and 6 (Minor) -- two catalog comments that state the wrong rule.
--
-- complete_umbrella_task_impl's comment still called the private.task_managers recipient
-- set "usually empty"; Ruling 24 established the opposite. close_task_queue's comment said
-- nothing about which caller logs a queue_closed activity row, and the ledger's summary of
-- that rule ("an automatic close writes none") does not match the code. Both are rewritten
-- below. create_task_impl's own comment is reissued because `create or replace` does not
-- touch a comment, and its text named the lock mode this migration changes.
-- ---------------------------------------------------------------------------------------

-- ==================== 1. create_task_impl: Ruling 20 ====================
create or replace function private.create_task_impl(
  p_title text, p_description text, p_deadline timestamptz,
  p_dept_id text, p_team_id text, p_project_id bigint,
  p_audience text, p_assignment_mode text,
  p_executor_id uuid, p_campaign_id bigint, p_parent_task_id bigint, p_kind text)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_parent public.tasks%rowtype;
  v_dept text := p_dept_id; v_team text := p_team_id; v_project bigint := p_project_id;
  v_title text;
  v_task public.tasks%rowtype;
  v_constraint text;
begin
  -- 1. malformed for everyone
  if p_kind is null or p_kind not in ('task', 'umbrella') then
    raise sqlstate 'PT400' using message = 'invalid_task_kind';
  end if;
  -- 2. gate (no target yet: live activ member)
  if v_actor is null or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'task_command_forbidden';
  end if;
  -- subtask: lock the Umbrella first, inherit its origin
  if p_parent_task_id is not null then
    if p_kind = 'umbrella' then
      raise sqlstate 'PT400' using message = 'subtask_cannot_be_umbrella';
    end if;
    if not coalesce(private.can_read_task(p_parent_task_id), false) then
      raise sqlstate 'PT404' using message = 'task_not_found';
    end if;
    -- FOR NO KEY UPDATE, not FOR UPDATE: private.evaluate_task takes an
    -- implicit FOR KEY SHARE on this same row through its parent-naming
    -- task_activity/notifications inserts, and FOR UPDATE would stall every
    -- concurrent evaluation under this Umbrella. See the header -- do not
    -- strengthen this.
    select * into v_parent from public.tasks where id = p_parent_task_id for no key update;
    if v_parent.kind <> 'umbrella' then
      raise sqlstate 'PT409' using message = 'parent_not_umbrella';
    end if;
    if v_parent.status in ('completed', 'unfulfilled', 'cancelled') then
      raise sqlstate 'PT409' using message = 'parent_terminal';
    end if;
    if (v_dept is not null and v_dept is distinct from v_parent.dept_id)
       or (v_team is not null and v_team is distinct from v_parent.team_id)
       or (v_project is not null and v_project is distinct from v_parent.project_id) then
      raise sqlstate 'PT400' using message = 'subtask_origin_mismatch';
    end if;
    v_dept := v_parent.dept_id; v_team := v_parent.team_id; v_project := v_parent.project_id;
  end if;
  -- 3/4. authority on the origin (locks profile + membership row)
  if num_nonnulls(v_dept, v_team, v_project) <> 1 then
    raise sqlstate 'PT400' using message = 'invalid_origin';
  end if;
  perform private.require_origin_manager(v_dept, v_team, v_project);
  -- 5. input
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'title_required';
  end if;
  v_title := regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if p_kind = 'umbrella' then
    if p_audience is not null or p_assignment_mode is not null or p_executor_id is not null or p_campaign_id is not null then
      raise sqlstate 'PT400' using message = 'umbrella_has_no_mode';
    end if;
  else
    if p_deadline is null then
      raise sqlstate 'PT400' using message = 'deadline_required';
    end if;
    if p_audience is null or p_audience not in ('local', 'org') then
      raise sqlstate 'PT400' using message = 'invalid_audience';
    end if;
    if p_assignment_mode is null or p_assignment_mode not in ('direct', 'public') then
      raise sqlstate 'PT400' using message = 'invalid_assignment_mode';
    end if;
    if p_assignment_mode = 'public' and p_executor_id is not null then
      raise sqlstate 'PT400' using message = 'executor_not_allowed_for_public';
    end if;
  end if;
  -- 7. mutate (the #314 / #315 triggers validate campaign and hierarchy)
  begin
    insert into public.tasks (title, description, deadline, dept_id, team_id, project_id,
                              audience, assignment_mode, campaign_id, parent_task_id, kind,
                              status, created_by, queue_opened_at)
    values (v_title, nullif(regexp_replace(coalesce(p_description, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
            p_deadline, v_dept, v_team, v_project,
            p_audience, p_assignment_mode, p_campaign_id, p_parent_task_id, p_kind,
            'todo', v_actor, case when p_assignment_mode = 'public' then now() end)
    returning * into v_task;
  exception
    when foreign_key_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'tasks_campaign_id_fkey' then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
    when check_violation then
      -- private.validate_task_campaign (20260911210600) raises errcode 23514
      -- with exactly these two reasons; any other 23514 (a shape or
      -- hierarchy constraint) is a caller bug and propagates unchanged.
      if sqlerrm in ('task_campaign_origin_mismatch', 'task_campaign_inactive') then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
  end;
  perform private.log_task_activity(v_task.id, 'created', v_actor, null, null, 'todo', null,
    jsonb_build_object('kind', p_kind, 'audience', p_audience, 'assignment_mode', p_assignment_mode,
                       'campaign_id', p_campaign_id, 'parent_task_id', p_parent_task_id,
                       'executor_id', p_executor_id));
  if p_executor_id is not null then
    perform private.open_task_assignment(v_task.id, p_executor_id, v_actor, 'create');
  end if;
  select * into v_task from public.tasks where id = v_task.id;
  return v_task;
end;
$$;

-- ==================== 2. complete_task_review_impl: step-1 hoist ====================
create or replace function private.complete_task_review_impl(
  p_task_id    bigint,
  p_difficulty integer,
  p_rating     integer,
  p_note       text)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_task  public.tasks%rowtype;
begin
  -- 1. Malformed for everyone: an Evaluation without a note can never be
  --    written (task_evaluations_note_ck), so it is rejected before the gate
  --    -- the #335 precedent for the other evaluator-gated command.
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'evaluation_note_required';
  end if;
  --    Difficulty and Rating join it here (whole-wave review, finding 5): a
  --    value outside task_evaluations' 1..5 CHECK could never succeed for ANY
  --    caller, so it is malformed for everyone and is answered before the
  --    gate -- which is what private.approve_completed_work_request_impl, the
  --    third caller of private.evaluate_task, already did.
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 5 then
    raise sqlstate 'PT400' using message = 'invalid_difficulty';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise sqlstate 'PT400' using message = 'invalid_rating';
  end if;
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: the Task's evaluator, never merely its manager.
  perform private.require_task_evaluator(p_task_id);
  -- 5. Input validation: nothing is left here -- both numeric inputs are
  --    range-checked at step 1 above, and the note with them.
  -- 6. State preconditions. Kind first: an Umbrella is never in_review
  --    either, so checking status first would answer task_not_in_review and
  --    hide the real reason an Umbrella can never be reviewed at all.
  if v_task.kind <> 'task' then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  if v_task.status <> 'in_review' then
    raise sqlstate 'PT409' using message = 'task_not_in_review';
  end if;
  -- 7. Mutate through the shared core, then re-read.
  perform private.evaluate_task(p_task_id, 'completed', p_difficulty, p_rating, p_note, v_actor);
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

-- ==================== 3. mark_task_unfulfilled_impl: step-1 hoist ====================
create or replace function private.mark_task_unfulfilled_impl(
  p_task_id    bigint,
  p_difficulty integer,
  p_rating     integer,
  p_note       text)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_task  public.tasks%rowtype;
begin
  -- 1. Malformed for everyone: an Evaluation without a note can never be
  --    written (task_evaluations_note_ck), so it is rejected before the
  --    gate -- the #336 precedent for the other evaluator-gated command.
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'evaluation_note_required';
  end if;
  --    Difficulty and Rating join it here (whole-wave review, finding 5): a
  --    value outside task_evaluations' 1..5 CHECK could never succeed for ANY
  --    caller, so it is malformed for everyone and is answered before the
  --    gate -- which is what private.approve_completed_work_request_impl, the
  --    third caller of private.evaluate_task, already did.
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 5 then
    raise sqlstate 'PT400' using message = 'invalid_difficulty';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise sqlstate 'PT400' using message = 'invalid_rating';
  end if;
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: the Task's evaluator, never merely its manager.
  perform private.require_task_evaluator(p_task_id);
  -- 5. Input validation: nothing is left here -- both numeric inputs are
  --    range-checked at step 1 above, and the note with them.
  -- 6. State preconditions, in the brief's pinned order.
  if v_task.kind <> 'task' then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  if v_task.status not in ('todo', 'in_progress', 'in_review') then
    raise sqlstate 'PT409' using message = 'task_terminal';
  end if;
  if v_task.deadline is null or v_task.deadline >= now() then
    raise sqlstate 'PT409' using message = 'task_not_overdue';
  end if;
  if not exists (
    select 1 from public.task_assignments as assignment
     where assignment.task_id = p_task_id and assignment.ended_at is null
  ) then
    raise sqlstate 'PT409' using message = 'task_has_no_executor';
  end if;
  -- 7. Mutate through the shared core, then re-read.
  perform private.evaluate_task(p_task_id, 'unfulfilled', p_difficulty, p_rating, p_note, v_actor);
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

-- ==================== 4. Catalog comments ====================
-- `create or replace` does not touch a function's comment, so create_task_impl's is
-- reissued here: its text named FOR UPDATE on the Umbrella, the lock this migration
-- weakened. Only that clause differs from the #327 original.
comment on function private.create_task_impl(text, text, timestamptz, text, text, bigint, text, text, uuid, bigint, bigint, text) is
  'Creates one Task, Subtask or Umbrella for an Origin the live caller manages; the actor is auth.uid(), never a parameter. A Subtask locks its Umbrella FOR NO KEY UPDATE first -- never FOR UPDATE, which would block every concurrent evaluation of every other Subtask of that Umbrella on private.evaluate_task''s parent-naming FK FOR KEY SHARE (Ruling 20; see the closeout migration header, and do not strengthen it) -- and inherits its Origin: caller-supplied Origin parameters must be null or identical (PT400 subtask_origin_mismatch), and the Umbrella must be a live, non-terminal Umbrella (PT409 parent_not_umbrella / parent_terminal). An ordinary Task requires a deadline, an Audience and an Assignment Mode; a public one opens its Candidate Queue and refuses an Executor; an Umbrella refuses Audience, Assignment Mode, Executor and Campaign. A direct Executor may be any live activ member, inside the Origin or not. Writes the created activity row, and (with an Executor) the Assignment, its executor_assigned row and the Executor''s notification. The #314 Campaign trigger''s two 23514 reasons are mapped to PT400 invalid_campaign; every other 23514 propagates.';

-- Finding 5: both comments below said the two numeric inputs are "raised under the lock
-- once authority is established". They are now raised at step 1, with the note.
comment on function private.complete_task_review_impl(bigint, integer, integer, text) is
  'The Task''s evaluator (private.require_task_evaluator, 42501 task_evaluate_forbidden -- never task_manage_forbidden) closes an in_review ordinary Task as completed with a Difficulty, a Rating and a required note; the actor is auth.uid(), never a parameter. A blank or null note is PT400 evaluation_note_required and a Difficulty or Rating outside 1..5 (null included) is PT400 invalid_difficulty / invalid_rating -- all three are malformed for every caller and are raised at step 1, before the membership gate, matching private.approve_completed_work_request_impl. PT409 task_is_umbrella for an Umbrella (checked first: its completion is #340''s Subtask rollup, never an Evaluation) and PT409 task_not_in_review for any other status. All writing is delegated to private.evaluate_task with outcome = completed -- the single place points are computed and written. Whether a Task was late is simply completed_at > deadline; no column records it.';

comment on function private.mark_task_unfulfilled_impl(bigint, integer, integer, text) is
  'The Task''s evaluator (private.require_task_evaluator, 42501 task_evaluate_forbidden -- never task_manage_forbidden) marks an overdue, undelivered ordinary Task unfulfilled with a Difficulty, a Rating and a required note; the actor is auth.uid(), never a parameter. A blank or null note is PT400 evaluation_note_required and a Difficulty or Rating outside 1..5 (null included) is PT400 invalid_difficulty / invalid_rating -- all three are malformed for every caller and are raised at step 1, before the membership gate, matching private.approve_completed_work_request_impl. State preconditions, in order: PT409 task_is_umbrella (an Umbrella is never marked unfulfilled -- #340''s Subtask rollup owns its completion), PT409 task_terminal (status must still be todo/in_progress/in_review), PT409 task_not_overdue (the deadline must already be in the past) and PT409 task_has_no_executor (a queued public Task nobody took cannot be "unfulfilled" by a person -- the manager cancels it instead). All writing is delegated to private.evaluate_task with outcome = unfulfilled -- the single place points are computed and written.';

-- Finding 3 (Ruling 24): the recipient set is normally NON-empty. private.task_managers
-- falls back to every live BC/Moderator when neither the creator nor the Origin yields
-- one, so the ordinary production case notifies all of them.
comment on function private.complete_umbrella_task_impl(bigint) is
  'The Umbrella''s manager (private.require_task_manager, 42501 task_manage_forbidden -- an Independent Team''s own active members may complete their own Team''s Umbrella, which they may never evaluate) closes an Umbrella once every one of its Subtasks has reached a terminal outcome on its own; the actor is auth.uid(), never a parameter. Locks the target FOR NO KEY UPDATE -- never FOR UPDATE: private.evaluate_task takes an implicit FK FOR KEY SHARE on an Umbrella through its parent-naming inserts, and FOR UPDATE here would deadlock (40P01) against it (see the migration header; do not strengthen it) -- with an `if not found` PT404 task_not_found guard. PT409 task_not_umbrella for an ordinary Task, PT409 task_terminal for an Umbrella already completed/unfulfilled/cancelled, PT409 umbrella_has_no_subtasks for one with none at all, PT409 subtasks_not_terminal (the non-terminal count on the exception''s detail) when any Subtask is still todo/in_progress/in_review -- cancelled counts as terminal, same as completed/unfulfilled. The Subtasks are locked FOR SHARE only: this command reads their statuses and writes none of them. Sets status = completed and completed_at = now(); writes no Difficulty, no Rating, no task_evaluations row and no points_ledger row -- an Umbrella''s completion is a rollup of work already scored on its Subtasks, never an Evaluation of its own. Logs one umbrella_completed activity row (assignment_id NULL, from -> completed, details.subtask_count) and notifies private.task_managers, which is normally NON-EMPTY: the helper falls back to every live BC/Moderator when neither the Umbrella''s creator nor its Origin yields a manager, so the ordinary case notifies all of them. It is empty only when no live BC/Moderator remains other than the actor, whom private.notify always drops.';

-- Finding 6: the real queue_closed rule, which was written down nowhere. Only
-- set_task_queue logs a queue_closed activity row; the other three callers fold the count
-- into their own row, or (an Evaluation) record nothing on the Task's own row at all.
comment on function private.close_task_queue(bigint, uuid) is
  'Closes a public Task''s Candidate Queue (idempotent: a direct Task or an already-closed queue is a no-op) and marks every still-pending Candidature closed, returning those member ids so the caller can notify them. p_decided_by is the actor for a manual close and null for an Evaluation''s automatic one, per task_candidates_decision_shape_ck. Every terminal transition on a public Task must call this -- tasks_queue_timestamp_state_check requires queue_closed_at on completed/unfulfilled/cancelled. This function writes NO activity row of its own; each caller decides, and the shipped rule is narrower than "an automatic close writes none": public.set_task_queue is the ONLY command that logs a queue_closed row (details.closed_candidates). select_task_candidate folds the count into its candidate_selected row and cancel_task into its cancelled row -- both manual closes, both passing the actor as p_decided_by -- while private.evaluate_task, the automatic close and the only caller that passes p_decided_by null, records the close nowhere on the Task''s own timeline, because the evaluated/unfulfilled row already says why the queue shut. A consumer building a Task timeline reads closed_candidates off whichever of those four rows is present.';
