-- #331: set_task_queue -- a manager opens or closes a public Task's
-- Candidate Queue.
--
-- Closing reuses the Task 1 kit rather than reimplementing it:
-- private.close_task_queue(p_task_id, p_decided_by) sets queue_closed_at,
-- moves every pending Candidature to 'closed' with decided_at/decided_by
-- set, and returns the array of member ids it closed -- exactly the
-- recipient set for the "Coadă închisă" notification. That helper is
-- idempotent (a no-op on a direct Task or an already-closed queue,
-- returning '{}'), which is why this command still needs its own
-- not-public/terminal/same-state guards in front of it: a manager must not
-- be able to "re-close" a closed queue just to re-send that notification to
-- Candidates who already got it (or, worse, get nothing back and wrongly
-- assume the call did something).
--
-- Step order (stack-context.md, binding), with this command's own
-- precedence decisions:
--   - Step 1: p_open null is malformed for every caller, authorized or not,
--     so it is rejected before the gate (the #343 set_campaign_active
--     precedent) -- fires even against a Task id the caller could never
--     read.
--   - Step 6 order is not-public, then terminal, then same-state. A direct
--     Task and an Umbrella (null assignment_mode) both answer task_not_public
--     first; there is no separate task_is_umbrella reason here because #331,
--     unlike #330, is never called by a Member acting on their own interest
--     -- an Umbrella has no manager-facing "queue" language to disambiguate.
--     Terminal is checked before same-state so reopening a terminal Task's
--     always-closed queue answers task_terminal, never nothing_to_update.
--
-- Both branches log an activity row with assignment_id null (queue changes
-- are not about anyone's own work) and no from_status/to_status (opening or
-- closing a queue is not a Task status transition). Closing additionally
-- writes details.closed_candidates = cardinality of the array
-- close_task_queue returns, and notifies exactly those members; reopening
-- writes no notification at all -- the Candidates it closed stay closed
-- (they must express interest again, a #330 call, to rejoin), so there is no
-- one to tell.
--
-- The `for update` read of the target Task row (step 3) is followed by an
-- `if not found` guard, per stack-context.md's carry-forward: until #345
-- retires tasks_delete_legacy, a concurrent hard delete between
-- require_task_visible and the lock would otherwise leave v_task all-NULL
-- and let a later state check answer with the wrong PT409 instead of PT404.

create function private.set_task_queue_impl(p_task_id bigint, p_open boolean)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
  v_closed uuid[];
begin
  -- 1. Malformed-for-everyone input.
  if p_open is null then
    raise sqlstate 'PT400' using message = 'invalid_queue_flag';
  end if;
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: re-validated against live rows, holding the
  --    manager's own profile and the membership row their authority rests
  --    on FOR SHARE (require_origin_manager's discipline).
  perform private.require_task_manager(p_task_id);
  -- 5. Input validation: none beyond the flag itself, already checked.
  -- 6. State preconditions (PT409), in the order the header explains.
  if v_task.assignment_mode is distinct from 'public' then
    raise sqlstate 'PT409' using message = 'task_not_public';
  end if;
  if v_task.status in ('completed', 'unfulfilled', 'cancelled') then
    raise sqlstate 'PT409' using message = 'task_terminal';
  end if;
  if p_open = (v_task.queue_closed_at is null) then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;
  -- 7. Mutate, then activity, then notify, then return.
  if p_open then
    update public.tasks set queue_closed_at = null where id = p_task_id;
    perform private.log_task_activity(p_task_id, 'queue_opened', v_actor, null, null, null, null, '{}'::jsonb);
  else
    v_closed := private.close_task_queue(p_task_id, v_actor);
    perform private.log_task_activity(p_task_id, 'queue_closed', v_actor, null, null, null, null,
      jsonb_build_object('closed_candidates', cardinality(v_closed)));
    perform private.notify(
      v_closed,
      'task'::public.noti_kind,
      'Coadă închisă: ' || v_task.title,
      'Nu mai poți fi selectat pentru acest task.',
      p_task_id, null, v_actor);
  end if;
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

comment on function private.set_task_queue_impl(bigint, boolean) is
  'A manager opens or closes a public Task''s Candidate Queue; the actor is auth.uid(), never a parameter. p_open null is PT400 invalid_queue_flag, checked before the gate. Requires private.require_task_manager under the tasks-row lock (42501 task_manage_forbidden). Refuses a non-public Task (PT409 task_not_public, which also catches an Umbrella''s null assignment_mode and a direct Task), a terminal Task (task_terminal, checked before same-state so a terminal Task''s always-closed queue never answers nothing_to_update), and setting the flag to the state it already has (nothing_to_update -- a manager must not "re-close" a closed queue just to re-notify its Candidates). Closing delegates to private.close_task_queue, logs queue_closed with details.closed_candidates = cardinality of the member ids it closed, and notifies exactly those Candidates (''Coadă închisă''); opening clears queue_closed_at and logs queue_opened. Both activity rows carry assignment_id null and no from_status/to_status -- a queue change is not a Task status transition. Candidates already closed stay closed across a reopen; rejoining is a new #330 express_task_interest call.';

create function public.set_task_queue(p_task_id bigint, p_open boolean)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.set_task_queue_impl(p_task_id, p_open);
$$;

comment on function public.set_task_queue(bigint, boolean) is
  'Open (true) or close (false) a public Task''s Candidate Queue. Callable by anyone who manages the Task''s Origin; PT409 task_not_public / task_terminal / nothing_to_update otherwise, per private.set_task_queue_impl.';

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.set_task_queue_impl(bigint, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function public.set_task_queue(bigint, boolean)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;

grant execute on function private.set_task_queue_impl(bigint, boolean) to authenticated;
grant execute on function public.set_task_queue(bigint, boolean) to authenticated;
