-- #337: mark_task_unfulfilled, the second command over private.evaluate_task
-- (#336) -- the `unfulfilled` outcome, for overdue work that was never
-- delivered.
--
-- The sibling of private.complete_task_review_impl: thin, the seven-step
-- order around one private.evaluate_task(..., 'unfulfilled', ...) call.
-- Nothing about the shared core is re-implemented or re-validated beyond
-- what step 5 of the standard order requires (stack-context.md,
-- task-12-brief.md).
--
-- Step order inside private.mark_task_unfulfilled_impl (binding):
--   1. A blank or null p_note is PT400 evaluation_note_required, raised
--      BEFORE the gate -- the #336 precedent for an evaluator command whose
--      note is required by task_evaluations_note_ck itself. A call without
--      one can never succeed for any caller, authorized or not.
--   2/3. private.require_task_visible, then the tasks row FOR UPDATE with
--      the `if not found` PT404 guard (a concurrent hard delete is still
--      reachable until #345 retires tasks_delete_legacy).
--   4. private.require_task_evaluator under that lock -- the Task's
--      evaluator, never merely its manager; unchanged from #336.
--   5. Difficulty and Rating range checks (PT400 invalid_difficulty /
--      invalid_rating) -- evaluate_task repeats these itself, since #338 and
--      #344 reach the shared core by other routes and it must stay
--      self-sufficient; the duplication changes no observable behaviour.
--   6. State preconditions, in the brief's pinned order:
--        - PT409 task_is_umbrella -- an Umbrella is never "unfulfilled";
--          #340 owns its Subtask rollup, never an Evaluation.
--        - PT409 task_terminal -- status must still be one of
--          todo/in_progress/in_review; a Task already completed,
--          unfulfilled or cancelled cannot be marked unfulfilled again.
--          Checked before the deadline so a Task that is BOTH terminal and
--          on time answers the state conflict that actually explains why
--          the command refuses it, not a claim about its deadline.
--        - PT409 task_not_overdue -- the deadline must already be in the
--          past. Marking undelivered work "unfulfilled" before its own
--          deadline is not this command's job (nothing else on `main` does
--          it either); a manager who wants to end a Task early uses #339's
--          cancel_task once it ships.
--        - PT409 task_has_no_executor -- a queued public Task nobody ever
--          took cannot be "unfulfilled" by a person; the manager cancels it
--          instead (#339). private.evaluate_task would answer the identical
--          reason one statement later when it locks the Assignment row, but
--          the brief pins the check here too, so the reason surfaces before
--          the shared core ever takes that lock.
--   7. Delegate to private.evaluate_task with outcome = 'unfulfilled', then
--      re-read the Task.
--
-- public.rating_mult (1 -> -1, 2 -> 0, 3 -> 1, 4 -> 2, 5 -> 3) applies to an
-- unfulfilled outcome exactly as it does to a completion -- ADR-0007 does
-- not special-case the outcome's effect on the formula, and neither does
-- this command. A Rating of 1 or 2 on undelivered work is legal and
-- unremarkable: a harsh or exactly-neutral grade on work that never landed.

create function private.mark_task_unfulfilled_impl(
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
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: the Task's evaluator, never merely its manager.
  perform private.require_task_evaluator(p_task_id);
  -- 5. Input validation: the two numeric Evaluation inputs.
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 5 then
    raise sqlstate 'PT400' using message = 'invalid_difficulty';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise sqlstate 'PT400' using message = 'invalid_rating';
  end if;
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

comment on function private.mark_task_unfulfilled_impl(bigint, integer, integer, text) is
  'The Task''s evaluator (private.require_task_evaluator, 42501 task_evaluate_forbidden -- never task_manage_forbidden) marks an overdue, undelivered ordinary Task unfulfilled with a Difficulty, a Rating and a required note; the actor is auth.uid(), never a parameter. A blank or null note is PT400 evaluation_note_required, raised before the membership gate; Difficulty and Rating outside 1..5 (null included) are PT400 invalid_difficulty / invalid_rating, raised under the lock once authority is established. State preconditions, in order: PT409 task_is_umbrella (an Umbrella is never marked unfulfilled -- #340''s Subtask rollup owns its completion), PT409 task_terminal (status must still be todo/in_progress/in_review), PT409 task_not_overdue (the deadline must already be in the past) and PT409 task_has_no_executor (a queued public Task nobody took cannot be "unfulfilled" by a person -- the manager cancels it instead). All writing is delegated to private.evaluate_task with outcome = unfulfilled -- the single place points are computed and written.';

create function public.mark_task_unfulfilled(
  p_task_id    bigint,
  p_difficulty integer,
  p_rating     integer,
  p_note       text)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.mark_task_unfulfilled_impl(p_task_id, p_difficulty, p_rating, p_note);
$$;

comment on function public.mark_task_unfulfilled(bigint, integer, integer, text) is
  'Mark an overdue, undelivered Task unfulfilled, crediting its Executor Difficulty x the Rating multiplier (which may be zero or negative). Callable only by the Task''s live evaluator -- BC/Moderator anywhere, the local BCE of a Department or of a Department-Team''s parent Department, or an active Project''s lead (including their own active Assignment) or a Responsible acting on anyone''s work but the lead''s or their own; an Independent Team has no evaluator branch at all. Difficulty and Rating are 1..5 and a non-blank note is required. Refuses an Umbrella, any Task not currently todo/in_progress/in_review, a Task whose deadline has not yet passed, and a Task with no active Executor. Credits the Executor once, ends their Assignment failed, closes any Candidate Queue, and -- on a Subtask -- records the progress on its Umbrella.';

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.mark_task_unfulfilled_impl(bigint, integer, integer, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.mark_task_unfulfilled(bigint, integer, integer, text)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;

grant execute on function private.mark_task_unfulfilled_impl(bigint, integer, integer, text)
  to authenticated;
grant execute on function public.mark_task_unfulfilled(bigint, integer, integer, text)
  to authenticated;
