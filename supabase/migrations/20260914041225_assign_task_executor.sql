-- #342: assign_task_executor -- a manager assigns any live active Member to
-- a direct Task that currently has no active Executor.
--
-- The remedy this command exists to be: ADR-0007 gives a direct Task no
-- Candidate Queue, so when its one Executor gives up (#332's give_up_task,
-- not yet built) the Task is stuck with nobody unless a manager can hand it
-- to someone directly. This command is deliberately sequenced before #332
-- for exactly that reason -- assign_task_executor.test.sql section 3 proves
-- the remedy by fixturing the "Executor gave up" end state directly (an
-- owner-ended Assignment, end_reason = 'gave_up') and showing
-- assign_task_executor fills the empty slot with exactly one new active
-- Assignment, leaving the earlier one untouched history.
--
-- Eligibility (ADR-0007's 2026-09-10 amendment, binding): ANY live activ
-- Member may be assigned, regardless of Department, Team, Project or role
-- level. Audience governs public Candidate Queues only, never a manager's
-- direct assignment -- private.open_task_assignment's own PT400
-- invalid_executor check (a live activ profile, nothing more) is the only
-- eligibility gate on the assignee, and this command adds no
-- Audience/membership check of its own. The suite proves this by assigning a
-- Member of an unrelated Department to an 'edu'-Origin Task.
--
-- Step order (stack-context.md, binding), with this command's own
-- precedence decisions:
--   - Step 6's four PT409 reasons are evaluated umbrella first, then
--     not-direct, then terminal, then already-assigned. The brief lists them
--     not-direct/terminal/umbrella/already-assigned, but an Umbrella's
--     assignment_mode is NULL (tasks_umbrella_shape_ck), and
--     `assignment_mode is distinct from 'direct'` is true for a null value
--     -- checking not-direct before umbrella would misreport every Umbrella
--     as task_not_direct instead of task_is_umbrella. This is the same
--     reachability constraint #330's express_task_interest documents for the
--     identical reason (queue_position.md / task_interest_commands.sql).
--   - p_member_id's validity (PT400 invalid_executor) is step 5 input
--     validation in principle, but the check itself lives inside
--     private.open_task_assignment, which is only reached from step 7's
--     mutation -- so it is necessarily evaluated AFTER every step-6 state
--     precondition. A call that is both invalid-member and wrong-state
--     therefore answers the state conflict (PT409), never invalid_executor;
--     pinned by a test that targets the already-assigned Task with an
--     inactiv profile.
--
-- Reuses the Task 1 kit rather than reimplementing it:
-- private.open_task_assignment(p_task_id, p_member_id, p_actor, p_via)
-- already rejects a non-live/non-activ Member (PT400 invalid_executor),
-- inserts the Assignment, writes its executor_assigned activity row
-- (assignment_id set, details.via = 'assign', details.member_id), and sends
-- the new Executor the pinned "Task nou" notification -- which
-- private.notify then drops when the manager assigns themselves, since the
-- actor is always excluded from its own recipient set (asserted directly).
--
-- The `for update` read of the target Task row (step 3) is followed by an
-- `if not found` guard, per stack-context.md's carry-forward: until #345
-- retires tasks_delete_legacy, a concurrent hard delete between
-- require_task_visible and the lock would otherwise leave v_task all-NULL
-- and let a later state check answer with the wrong PT409 instead of
-- PT404.

create function private.assign_task_executor_impl(p_task_id bigint, p_member_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
begin
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
  -- 5. Input validation: p_member_id's liveness/activ check happens inside
  --    private.open_task_assignment at step 7 -- see the header.
  -- 6. State preconditions (PT409), umbrella first (reachability, see header).
  if v_task.kind = 'umbrella' then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  if v_task.assignment_mode is distinct from 'direct' then
    raise sqlstate 'PT409' using message = 'task_not_direct';
  end if;
  if v_task.status in ('completed', 'unfulfilled', 'cancelled') then
    raise sqlstate 'PT409' using message = 'task_terminal';
  end if;
  if exists (select 1 from public.task_assignments as assignment
              where assignment.task_id = p_task_id and assignment.ended_at is null) then
    raise sqlstate 'PT409' using message = 'task_already_assigned';
  end if;
  -- 7. Mutate: private.open_task_assignment validates p_member_id (PT400
  --    invalid_executor), inserts the Assignment, writes its
  --    executor_assigned activity row and sends the new Executor's
  --    notification. Then return.
  perform private.open_task_assignment(p_task_id, p_member_id, v_actor, 'assign');
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

comment on function private.assign_task_executor_impl(bigint, uuid) is
  'A manager assigns any live activ Member as the Executor of a direct Task that has none; the actor is auth.uid(), never a parameter. Requires private.require_task_manager under the tasks-row lock (42501 task_manage_forbidden). Refuses an Umbrella (PT409 task_is_umbrella, checked first because an Umbrella''s assignment_mode is null), a non-direct Task (task_not_direct), a terminal Task (task_terminal) and a Task that already has an active Assignment (task_already_assigned) -- in that order, so a call that is both wrong-state and invalid-member answers the state conflict, never invalid_executor. Delegates to private.open_task_assignment (via = ''assign''), which is the only place p_member_id''s liveness is checked (PT400 invalid_executor) and which sends the pinned "Task nou" notification to the new Executor -- dropped by private.notify when the manager assigns themselves. Eligibility has no Department/Team/Project/level restriction of its own (ADR-0007''s 2026-09-10 amendment): any live activ Member may be assigned.';

create function public.assign_task_executor(p_task_id bigint, p_member_id uuid)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.assign_task_executor_impl(p_task_id, p_member_id);
$$;

comment on function public.assign_task_executor(bigint, uuid) is
  'A manager assigns any live activ Member as the Executor of a direct Task that has none. Callable by anyone who manages the Task''s Origin; PT409 task_is_umbrella / task_not_direct / task_terminal / task_already_assigned, PT400 invalid_executor for a Member who is not a live activ profile.';

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.assign_task_executor_impl(bigint, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.assign_task_executor(bigint, uuid)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;

grant execute on function private.assign_task_executor_impl(bigint, uuid) to authenticated;
grant execute on function public.assign_task_executor(bigint, uuid) to authenticated;
