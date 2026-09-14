-- #329: convert_task_mode -- a manager switches a Task between direct/public
-- and local/org, but only while it has no Assignment and no Candidature.
--
-- Immutable after the first Assignment or Candidature of any status: a
-- withdrawn or closed Candidature is still history, and ADR-0007 Sec Task
-- identity makes Origin/Audience/Assignment Mode immutable "after the first
-- Assignment or Candidature", not "while one is live". So any row in
-- task_assignments (any end_reason, or none) is PT409 task_already_assigned,
-- and any row in task_candidates (any status) is PT409 task_has_candidates.
--
-- Queue timestamps: direct -> public sets queue_opened_at = now() and
-- queue_closed_at = null; public -> direct nulls both -- safe precisely
-- because any Candidature blocks conversion, so the queue is necessarily
-- empty. A call that changes Assignment Mode not at all leaves both
-- timestamps exactly as they were (tasks_queue_timestamp_state_check is
-- satisfied either way, since the Task was already valid before the call).
-- A call that changes neither Audience nor Assignment Mode is
-- PT409 nothing_to_update, writing no activity row. An Umbrella has no mode
-- or audience at all (PT409 task_is_umbrella).
--
-- No notification: there is no Executor and no Candidate to tell, by
-- construction (the two immutability guards above already refused any Task
-- that has ever had either). The suite asserts zero notifications so the
-- absence is proven deliberate, not accidental.
create function private.convert_task_mode_impl(
  p_task_id bigint, p_assignment_mode text, p_audience text)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
  v_from jsonb;
  v_to jsonb;
begin
  -- 2. Gate + visibility
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked)
  select * into v_task from public.tasks where id = p_task_id for update;
  -- 4. Authority under lock
  perform private.require_task_manager(p_task_id);
  -- 5. Input validation (PT400)
  if p_audience is null or p_audience not in ('local', 'org') then
    raise sqlstate 'PT400' using message = 'invalid_audience';
  end if;
  if p_assignment_mode is null or p_assignment_mode not in ('direct', 'public') then
    raise sqlstate 'PT400' using message = 'invalid_assignment_mode';
  end if;
  -- 6. State preconditions (PT409)
  if v_task.kind = 'umbrella' then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  if v_task.status in ('completed', 'unfulfilled', 'cancelled') then
    raise sqlstate 'PT409' using message = 'task_terminal';
  end if;
  if exists (select 1 from public.task_assignments where task_id = p_task_id) then
    raise sqlstate 'PT409' using message = 'task_already_assigned';
  end if;
  if exists (select 1 from public.task_candidates where task_id = p_task_id) then
    raise sqlstate 'PT409' using message = 'task_has_candidates';
  end if;
  if p_assignment_mode = v_task.assignment_mode and p_audience = v_task.audience then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;
  -- 7. Mutate, then activity, then (no) notify, then return
  v_from := jsonb_build_object('audience', v_task.audience, 'assignment_mode', v_task.assignment_mode);
  v_to := jsonb_build_object('audience', p_audience, 'assignment_mode', p_assignment_mode);
  update public.tasks
     set audience = p_audience,
         assignment_mode = p_assignment_mode,
         queue_opened_at = case
           when p_assignment_mode is distinct from v_task.assignment_mode then
             case when p_assignment_mode = 'public' then now() end
           else queue_opened_at
         end,
         queue_closed_at = case
           when p_assignment_mode is distinct from v_task.assignment_mode then null
           else queue_closed_at
         end
   where id = p_task_id
  returning * into v_task;
  perform private.log_task_activity(p_task_id, 'mode_converted', v_actor, null, null, null, null,
    jsonb_build_object('from', v_from, 'to', v_to));
  return v_task;
end;
$$;

comment on function private.convert_task_mode_impl(bigint, text, text) is
  'Switches a Task between direct/public Assignment Mode and local/org Audience; the actor is auth.uid(), never a parameter. Refuses any Task that has ever had an Assignment (PT409 task_already_assigned) or a Candidature of any status, including withdrawn/closed (PT409 task_has_candidates) -- ADR-0007 makes Origin/Audience/Assignment Mode immutable after the first of either, not only while one is live. Also refuses a terminal Task (PT409 task_terminal) and an Umbrella, which has no mode or audience at all (PT409 task_is_umbrella). direct -> public sets queue_opened_at = now() and nulls queue_closed_at; public -> direct nulls both -- safe because the two immutability guards already prove the queue is empty; toggling Audience alone leaves both timestamps untouched. A call that changes neither field is PT409 nothing_to_update. Writes one mode_converted activity row (assignment_id null; details.from/to each hold {audience, assignment_mode}) and sends no notification -- by construction there is no Executor and no Candidate to tell.';

create function public.convert_task_mode(
  p_task_id bigint, p_assignment_mode text, p_audience text)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.convert_task_mode_impl(p_task_id, p_assignment_mode, p_audience);
$$;

comment on function public.convert_task_mode(bigint, text, text) is
  'Switches a Task between direct/public Assignment Mode and local/org Audience; callable only by a live active member who manages the Task''s Origin, and only before its first Assignment or Candidature of any status.';

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.convert_task_mode_impl(bigint, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.convert_task_mode(bigint, text, text)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;

grant execute on function private.convert_task_mode_impl(bigint, text, text)
  to authenticated;
grant execute on function public.convert_task_mode(bigint, text, text)
  to authenticated;
