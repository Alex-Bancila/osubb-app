-- #335: return_task_to_progress -- a Reviewer sends in_review work back to
-- in_progress with a required note, incrementing the review round.
--
-- This is the first command in the wave gated on EVALUATOR authority
-- (private.require_task_evaluator) rather than manager or Executor
-- authority. ADR-0007 Sec Authorization draws the evaluator boundary more
-- finely than the manager one, and private.can_evaluate_task (#327) is what
-- encodes it: BC/Moderator anywhere; the live local BCE of a Department or
-- of a Department-Team's parent Department; on an ACTIVE Project, its lead
-- (including for their own active Assignment) and every Responsible, except
-- that a Responsible may never evaluate the lead's active Assignment or
-- their own; and nothing at all for an Independent Team's own members -- an
-- Independent Team jointly MANAGES its own work (private.can_manage_task),
-- but only BC/Moderator EVALUATES it. This migration adds no new authority
-- logic of its own -- it is the first real caller to exercise
-- require_task_evaluator's reason (42501 task_evaluate_forbidden) end to
-- end, through a command that actually mutates a Task.
--
-- Step order (stack-context.md, binding) with this command's own decisions:
--   1. A blank or null p_note is PT400 note_required, checked BEFORE the
--      gate -- malformed for every caller, the #332/#343 precedent. The
--      note is what the Executor reads as feedback and what the activity
--      row keeps, so a call without one is never legitimate, authenticated
--      or not.
--   2/3. private.require_task_visible, then the tasks row FOR UPDATE with
--      the `if not found` PT404 guard (stack-context.md carry-forward: a
--      concurrent hard delete must never surface the wrong PT409 -- until
--      #345 retires tasks_delete_legacy this is still reachable).
--   4. private.require_task_evaluator is the entire authority rule: it
--      re-validates private.can_evaluate_task against live rows and holds
--      the caller's profile FOR SHARE plus (for anyone below level 6) the
--      one membership row their authority rests on, so a concurrent
--      deactivation or membership change serializes behind this command
--      instead of committing underneath a decision it already made (the
--      #343/#390 discipline). Any 42501 from that re-validation is already
--      remapped to task_evaluate_forbidden by the helper itself -- this
--      command never sees or could leak task_manage_forbidden.
--   5. No further input to validate -- p_note was validated at step 1.
--   6. The one state precondition: v_task.status <> 'in_review' is PT409
--      task_not_in_review. Umbrellas can never be in_review (no command on
--      main ever opens an Umbrella's Assignment, and only an active
--      Executor's own submit_task_for_review reaches in_review in the first
--      place), so they fall out of this same check with no dedicated
--      task_is_umbrella branch -- there is nothing left to distinguish once
--      the status is checked.
--   7. Mutate: status -> in_progress, review_round + 1,
--      returned_to_progress_at = now(), submitted_at = null (this is what
--      makes in_progress legal again under tasks_submitted_at_state_check;
--      tasks_review_return_check ties review_round > 0 to
--      returned_to_progress_at being set, which this update satisfies
--      together). Then the returned_to_progress activity row, carrying the
--      ACTIVE Assignment's id (this is about the Executor's own work,
--      stack-context.md's activity-row table), the in_review -> in_progress
--      transition, the trimmed note, and details.review_round = the new
--      round. Then the Executor's notification -- private.notify drops the
--      actor automatically, which is what makes a Project lead's return of
--      their OWN active Assignment silently notify nobody, exactly as it
--      should (ADR-0007: an actor never hears about their own action).
--
-- Because give_up_task (#332) already refuses to end an Assignment while a
-- Task is in_review (PT409 task_not_in_progress there), and nothing else on
-- main ends an Assignment mid-review either, an in_review Task is always
-- guaranteed to still have its active Assignment when this command reaches
-- step 7 -- the assignment lookup is not defensive, it is a real
-- invariant of the wave as it stands today.
create function private.return_task_to_progress_impl(p_task_id bigint, p_note text)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
  v_note text;
  v_assignment_id bigint;
  v_executor_id uuid;
  v_new_round integer;
begin
  -- 1. Malformed for everyone: no note, no feedback -- checked before the
  --    gate, so a claimless caller gets PT400 too.
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'note_required';
  end if;
  v_note := regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: the Task's evaluator, never its manager.
  perform private.require_task_evaluator(p_task_id);
  -- 6. State precondition.
  if v_task.status <> 'in_review' then
    raise sqlstate 'PT409' using message = 'task_not_in_review';
  end if;
  -- 7. Mutate, then activity, then notify the active Executor.
  v_new_round := v_task.review_round + 1;
  update public.tasks
     set status = 'in_progress',
         review_round = v_new_round,
         returned_to_progress_at = now(),
         submitted_at = null
   where id = p_task_id;

  select assignment.id, assignment.member_id into v_assignment_id, v_executor_id
    from public.task_assignments as assignment
   where assignment.task_id = p_task_id and assignment.ended_at is null;

  perform private.log_task_activity(p_task_id, 'returned_to_progress', v_actor, v_assignment_id,
    'in_review'::public.task_status, 'in_progress'::public.task_status, v_note,
    jsonb_build_object('review_round', v_new_round));

  perform private.notify(
    array[v_executor_id],
    'task'::public.noti_kind,
    'Feedback de implementat: ' || v_task.title,
    v_note,
    p_task_id, null, v_actor);

  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

comment on function private.return_task_to_progress_impl(bigint, text) is
  'The Task''s evaluator (private.require_task_evaluator, 42501 task_evaluate_forbidden -- never task_manage_forbidden) sends an in_review Task back to in_progress with a required note; the actor is auth.uid(), never a parameter. A blank or null note is PT400 note_required, raised before the membership gate because the input is malformed for every caller. PT409 task_not_in_review for any other status -- an Umbrella can never be in_review, so it falls out of the same check with no dedicated reason. Sets review_round = review_round + 1, returned_to_progress_at = now(), and nulls submitted_at (tasks_submitted_at_state_check''s requirement for a legal in_progress row). Writes one returned_to_progress activity row carrying the active Assignment id, the in_review -> in_progress transition, the trimmed note, and details.review_round, then notifies the active Executor with the pinned "Feedback de implementat" copy (body = the note) -- private.notify drops the actor, so a Project lead returning their own active Assignment silently notifies nobody, exactly as it should.';

create function public.return_task_to_progress(p_task_id bigint, p_note text)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.return_task_to_progress_impl(p_task_id, p_note);
$$;

comment on function public.return_task_to_progress(bigint, text) is
  'Send an in_review Task you evaluate back to in_progress with a note. Callable only by the Task''s live evaluator -- BC/Moderator anywhere, the local BCE of a Department or of a Department-Team''s parent Department, or an active Project''s lead (including their own active Assignment) or a Responsible acting on anyone''s work but the lead''s or their own (42501 task_evaluate_forbidden otherwise; an Independent Team has no evaluator branch at all -- only BC/Moderator evaluates its work) -- while the Task is in_review (PT409 task_not_in_review); PT400 note_required for a blank note. Increments review_round, stamps returned_to_progress_at, nulls submitted_at, and notifies the active Executor with the note.';

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.return_task_to_progress_impl(bigint, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.return_task_to_progress(bigint, text)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;

grant execute on function private.return_task_to_progress_impl(bigint, text) to authenticated;
grant execute on function public.return_task_to_progress(bigint, text) to authenticated;
