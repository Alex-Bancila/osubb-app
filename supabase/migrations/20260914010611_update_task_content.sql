-- #328: update_task_content — edit a Task's title, description, deadline or
-- Campaign after creation, with a field-level audit trail.
--
-- Parameters are the new full values, never a patch: an audit trail cannot
-- tolerate "null means keep". p_title null/blank is PT400 title_required;
-- p_deadline null is PT400 deadline_required for an ordinary Task (an
-- Umbrella has no deadline requirement, matching create_task); p_description
-- and p_campaign_id null mean the field is explicitly cleared. A call that
-- changes nothing at all is PT409 nothing_to_update, never a silent success.
-- An Umbrella may have its title/description/deadline edited but never a
-- Campaign (PT400 umbrella_has_no_campaign, tasks_umbrella_shape_ck does not
-- itself forbid a Campaign on an Umbrella, so this is a command-level rule).
--
-- First consumer of #327's authority kit outside create_task itself:
-- require_task_visible, require_task_manager, log_task_activity and notify
-- are reused unchanged, in the binding step order (stack-context.md).
create function private.update_task_content_impl(
  p_task_id bigint, p_title text, p_description text,
  p_deadline timestamptz, p_campaign_id bigint)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
  v_title text;
  v_description text;
  v_executor uuid;
  v_changed text[] := '{}'::text[];
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_constraint text;
begin
  -- 2. Gate + visibility
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked)
  select * into v_task from public.tasks where id = p_task_id for update;
  -- 4. Authority under lock
  perform private.require_task_manager(p_task_id);
  -- 5. Input validation (PT400)
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'title_required';
  end if;
  v_title := regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_description := nullif(regexp_replace(coalesce(p_description, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  if v_task.kind = 'task' and p_deadline is null then
    raise sqlstate 'PT400' using message = 'deadline_required';
  end if;
  if v_task.kind = 'umbrella' and p_campaign_id is not null then
    raise sqlstate 'PT400' using message = 'umbrella_has_no_campaign';
  end if;
  -- 6. State preconditions (PT409)
  if v_task.status in ('completed', 'unfulfilled', 'cancelled') then
    raise sqlstate 'PT409' using message = 'task_terminal';
  end if;
  if v_title is distinct from v_task.title then
    v_changed := array_append(v_changed, 'title');
    v_before := v_before || jsonb_build_object('title', v_task.title);
    v_after := v_after || jsonb_build_object('title', v_title);
  end if;
  if v_description is distinct from v_task.description then
    v_changed := array_append(v_changed, 'description');
    v_before := v_before || jsonb_build_object('description', v_task.description);
    v_after := v_after || jsonb_build_object('description', v_description);
  end if;
  if p_deadline is distinct from v_task.deadline then
    v_changed := array_append(v_changed, 'deadline');
    v_before := v_before || jsonb_build_object('deadline', v_task.deadline);
    v_after := v_after || jsonb_build_object('deadline', p_deadline);
  end if;
  if p_campaign_id is distinct from v_task.campaign_id then
    v_changed := array_append(v_changed, 'campaign_id');
    v_before := v_before || jsonb_build_object('campaign_id', v_task.campaign_id);
    v_after := v_after || jsonb_build_object('campaign_id', p_campaign_id);
  end if;
  if array_length(v_changed, 1) is null then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;
  -- 7. Mutate, then activity, then notify, then return
  begin
    update public.tasks
       set title = v_title, description = v_description, deadline = p_deadline, campaign_id = p_campaign_id
     where id = p_task_id
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
      -- with exactly these two reasons; any other 23514 is a caller bug and
      -- propagates unchanged (create_task_impl precedent).
      if sqlerrm in ('task_campaign_origin_mismatch', 'task_campaign_inactive') then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
  end;
  perform private.log_task_activity(p_task_id, 'content_updated', v_actor, null, null, null, null,
    jsonb_build_object('changed', v_changed, 'before', v_before, 'after', v_after));
  select member_id into v_executor from public.task_assignments where task_id = p_task_id and ended_at is null;
  if v_executor is not null then
    perform private.notify(array[v_executor], 'task'::public.noti_kind, 'Task actualizat: ' || v_task.title,
      'Modificat: ' || array_to_string(v_changed, ', ') || '.', p_task_id, null, v_actor);
  end if;
  return v_task;
end;
$$;

comment on function private.update_task_content_impl(bigint, text, text, timestamptz, bigint) is
  'Edits a Task''s title, description, deadline and/or Campaign; the actor is auth.uid(), never a parameter. Parameters are full new values, never a patch: a null/blank p_title is PT400 title_required, a null p_deadline is PT400 deadline_required for an ordinary Task (not for an Umbrella), and a null p_description/p_campaign_id explicitly clears that field. Refuses a Campaign on an Umbrella (PT400 umbrella_has_no_campaign) and any edit to a terminal Task (PT409 task_terminal). A call that changes nothing at all is PT409 nothing_to_update. Writes one content_updated activity row naming only the changed fields (details.changed/before/after) and, when the Task has a live active Executor, sends them the "Task actualizat" notification -- private.notify drops the actor, so a manager editing their own Assignment notifies nobody. The #314 Campaign trigger''s two 23514 reasons are mapped to PT400 invalid_campaign; every other 23514 propagates.';

create function public.update_task_content(
  p_task_id bigint, p_title text, p_description text,
  p_deadline timestamptz, p_campaign_id bigint)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.update_task_content_impl(p_task_id, p_title, p_description, p_deadline, p_campaign_id);
$$;

comment on function public.update_task_content(bigint, text, text, timestamptz, bigint) is
  'Edits a Task''s title, description, deadline and/or Campaign; callable only by a live active member who manages the Task''s Origin. Parameters are full new values, never a patch.';

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.update_task_content_impl(bigint, text, text, timestamptz, bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.update_task_content(bigint, text, text, timestamptz, bigint)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;

grant execute on function private.update_task_content_impl(bigint, text, text, timestamptz, bigint)
  to authenticated;
grant execute on function public.update_task_content(bigint, text, text, timestamptz, bigint)
  to authenticated;
