-- #334: start_task and submit_task_for_review -- the two Executor-side
-- lifecycle transitions todo -> in_progress and in_progress -> in_review.
--
-- Both commands share the exact same shape: gate, lock the Task row, require
-- the caller to BE the Task's own live active Executor
-- (private.require_task_executor, 42501 task_executor_forbidden -- the
-- entire authority rule, no manager override), check the one valid source
-- status, mutate, log the activity row. Nothing else in the wave's kit is
-- needed.
--
-- start_task writes NO notification. This is the brief's explicit ruling,
-- not an oversight: nobody but the Executor themselves needs telling that
-- they started their own work. The test suite asserts the absence directly.
--
-- submit_task_for_review notifies private.task_managers with the pinned
-- "De verificat: {title}" / "{name} a trimis taskul spre verificare." copy
-- (stack-context.md notification table).
--
-- Resubmission: a Task returned from review by #337's (not yet built)
-- return_task_to_progress carries review_round > 0 and
-- returned_to_progress_at set, with submitted_at nulled back out
-- (tasks_submitted_at_state_check forbids a non-null submitted_at outside
-- in_review/completed/unfulfilled/cancelled). A second submit_task_for_review
-- call on that Task sets submitted_at again but must NOT touch review_round
-- or returned_to_progress_at -- those columns are #335's (evaluate_task) and
-- #337's to write, never this command's. The impl below simply never
-- mentions either column, which is the whole guarantee: an UPDATE that does
-- not name a column cannot change it.
--
-- The Umbrella case, decided here rather than left ambiguous (the brief asks
-- for an explicit call and a stated reason): an Umbrella never has an
-- Executor. No command on main ever opens a task_assignments row for one --
-- #327's create_task_impl refuses an Umbrella an Executor at creation
-- (umbrella_has_no_mode), and nothing later assigns one. So
-- private.require_task_executor, called against an Umbrella's id, finds no
-- active Assignment at all and raises its ordinary 42501
-- task_executor_forbidden -- indistinguishable from "a manager tried" or "a
-- past Executor tried", which is exactly the non-disclosure property every
-- other _forbidden reason in this wave already relies on. A dedicated PT409
-- task_is_umbrella would be an unreachable branch: by the time either command
-- would evaluate it, require_task_executor (step 4, authority under lock)
-- has already run and already raised. No such check is added.
--
-- Step order (stack-context.md, binding): neither command takes any
-- parameter besides p_task_id, so there is no step-1 malformed-input check --
-- the wave-level carry-forward already settles that a null p_task_id is
-- PT404 task_not_found via private.can_read_task(null), not a PT400.
--   2. private.require_task_visible -- gate + visibility.
--   3. Lock the tasks row FOR UPDATE, `if not found` PT404 task_not_found
--      guard (stack-context.md carry-forward: a concurrent hard delete must
--      never surface the wrong PT409).
--   4. private.require_task_executor under that lock -- re-reads live rows,
--      holds the actor's own profile FOR SHARE and the active Assignment FOR
--      UPDATE. 42501 task_executor_forbidden covers every non-Executor
--      caller and the Umbrella case above.
--   5. No further input to validate.
--   6. The one state precondition: v_task.status <> 'todo' (start_task) /
--      <> 'in_progress' (submit_task_for_review) -- PT409 task_not_todo /
--      task_not_in_progress.
--   7. Mutate, log the activity row (assignment_id set -- both kinds are
--      "about the Executor's own work", stack-context.md activity-row
--      table), notify (submit only), return the re-read Task.

create function private.start_task_impl(p_task_id bigint)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
  v_assignment_id bigint;
begin
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: only the active Executor. An Umbrella has no
  --    Assignment at all, so it falls through to the same 42501 here -- see
  --    the header, no dedicated Umbrella reason.
  v_assignment_id := private.require_task_executor(p_task_id);
  -- 6. State precondition.
  if v_task.status <> 'todo' then
    raise sqlstate 'PT409' using message = 'task_not_todo';
  end if;
  -- 7. Mutate, then activity. No notification -- deliberate (see header).
  update public.tasks set status = 'in_progress', started_at = now()
   where id = p_task_id;
  perform private.log_task_activity(p_task_id, 'started', v_actor, v_assignment_id,
    'todo'::public.task_status, 'in_progress'::public.task_status, null, '{}'::jsonb);
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

comment on function private.start_task_impl(bigint) is
  'The Task''s own live active Executor moves it from todo to in_progress, stamping started_at = now(); the actor is auth.uid(), never a parameter. private.require_task_executor is the entire authority rule (42501 task_executor_forbidden for a manager, a past Executor, or an Umbrella, which has no Assignment at all) -- there is no manager override. PT409 task_not_todo for any other status. Writes one started activity row carrying the active Assignment id and the todo -> in_progress transition. Writes NO notification: nobody but the Executor needs telling that they started their own work.';

create function private.submit_task_for_review_impl(p_task_id bigint)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_actor_name text;
  v_task public.tasks%rowtype;
  v_assignment_id bigint;
begin
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: only the active Executor. Same Umbrella
  --    fallthrough as start_task -- see the header.
  v_assignment_id := private.require_task_executor(p_task_id);
  -- 6. State precondition.
  if v_task.status <> 'in_progress' then
    raise sqlstate 'PT409' using message = 'task_not_in_progress';
  end if;
  -- 7. Mutate (review_round / returned_to_progress_at are never named here,
  --    so a resubmission after a return cannot change either -- #335/#337
  --    own those columns), then activity, then notify the Task's managers.
  update public.tasks set status = 'in_review', submitted_at = now()
   where id = p_task_id;
  perform private.log_task_activity(p_task_id, 'submitted', v_actor, v_assignment_id,
    'in_progress'::public.task_status, 'in_review'::public.task_status, null, '{}'::jsonb);
  select profile.full_name into v_actor_name
    from public.profiles as profile where profile.id = v_actor;
  perform private.notify(
    array(select private.task_managers(p_task_id, v_actor)),
    'task'::public.noti_kind,
    'De verificat: ' || v_task.title,
    v_actor_name || ' a trimis taskul spre verificare.',
    p_task_id, null, v_actor);
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

comment on function private.submit_task_for_review_impl(bigint) is
  'The Task''s own live active Executor moves it from in_progress to in_review, stamping submitted_at = now(); the actor is auth.uid(), never a parameter. private.require_task_executor is the entire authority rule (42501 task_executor_forbidden for a manager, a past Executor, or an Umbrella, which has no Assignment at all). PT409 task_not_in_progress for any other status. A resubmission after #337''s return_task_to_progress sets submitted_at again but never mentions review_round or returned_to_progress_at, so both survive untouched -- those columns belong to #335/#337. Writes one submitted activity row carrying the active Assignment id and the in_progress -> in_review transition, then notifies private.task_managers with the pinned "De verificat" copy naming the Executor; the actor is dropped by private.notify like every other command notification in the wave.';

create function public.start_task(p_task_id bigint)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.start_task_impl(p_task_id);
$$;

comment on function public.start_task(bigint) is
  'Start a todo Task you hold as its Executor. Callable only by the Task''s live active Executor (42501 task_executor_forbidden otherwise, including on an Umbrella, which never has one) while the Task is todo (PT409 task_not_todo). No notification is sent.';

create function public.submit_task_for_review(p_task_id bigint)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.submit_task_for_review_impl(p_task_id);
$$;

comment on function public.submit_task_for_review(bigint) is
  'Submit an in_progress Task you hold as its Executor for review. Callable only by the Task''s live active Executor (42501 task_executor_forbidden otherwise, including on an Umbrella, which never has one) while the Task is in_progress (PT409 task_not_in_progress); a resubmission after being returned to progress is allowed and leaves review_round / returned_to_progress_at untouched. Notifies the Task''s managers.';

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.start_task_impl(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.start_task(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function private.submit_task_for_review_impl(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.submit_task_for_review(bigint)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;

grant execute on function private.start_task_impl(bigint) to authenticated;
grant execute on function public.start_task(bigint) to authenticated;
grant execute on function private.submit_task_for_review_impl(bigint) to authenticated;
grant execute on function public.submit_task_for_review(bigint) to authenticated;
