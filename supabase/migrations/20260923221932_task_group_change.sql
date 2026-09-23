-- #627: move a Task to another Group through update_task, with the same
-- preview/acceptance boundary as #626. The previous RPC signatures are dropped
-- to avoid PostgREST's ambiguous overload response.

alter table public.task_assignments
  drop constraint task_assignments_end_reason_ck,
  add constraint task_assignments_end_reason_ck check (
    end_reason in ('gave_up', 'replaced', 'completed', 'failed', 'cancelled',
      'legacy_migration', 'task_updated', 'group_changed'));

drop function public.update_task(bigint, text, text, timestamptz, bigint, text, text, boolean);
drop function public.preview_task_update(bigint, text, text, timestamptz, bigint, text, text);
drop function private.update_task_impl(bigint, text, text, timestamptz, bigint, text, text, boolean);
drop function private.preview_task_update_impl(bigint, text, text, timestamptz, bigint, text, text);
drop function private.plan_task_update(public.tasks, text, text, timestamptz, bigint, text, text);
drop function private.task_update_consequences(bigint, text, text);

create function private.plan_task_update(
  p_task public.tasks, p_group_id bigint, p_title text, p_description text, p_deadline timestamptz,
  p_campaign_id bigint, p_assignment_mode text, p_audience text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_description text;
  v_changed text[] := '{}'::text[];
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_campaign_id bigint := p_campaign_id;
  v_campaign_group bigint;
  v_target_path bigint[];
begin
  -- 5. Input validation (PT400).
  if p_group_id is null or (p_group_id is distinct from p_task.group_id
    and not exists (select 1 from public.groups where id = p_group_id and status = 'active')) then
    raise sqlstate 'PT400' using message = 'invalid_group';
  end if;
  if p_group_id is distinct from p_task.group_id then
    if p_task.parent_task_id is not null then
      raise sqlstate 'PT409' using message = 'subtask_origin_immutable';
    end if;
    if p_task.kind = 'umbrella' and exists (select 1 from public.tasks where parent_task_id = p_task.id) then
      raise sqlstate 'PT409' using message = 'umbrella_has_subtasks';
    end if;
  end if;
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'title_required';
  end if;
  v_title := regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_description := nullif(regexp_replace(coalesce(p_description, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  if p_task.kind = 'task' then
    if p_deadline is null then
      raise sqlstate 'PT400' using message = 'deadline_required';
    end if;
    if p_audience is null or p_audience not in ('local', 'org') then
      raise sqlstate 'PT400' using message = 'invalid_audience';
    end if;
    if p_assignment_mode is null or p_assignment_mode not in ('direct', 'public') then
      raise sqlstate 'PT400' using message = 'invalid_assignment_mode';
    end if;
  elsif p_campaign_id is not null then
    raise sqlstate 'PT400' using message = 'umbrella_has_no_campaign';
  end if;
  -- 6. State preconditions (PT409): umbrella shape, then the edit window.
  if p_task.kind = 'umbrella' and (p_audience is not null or p_assignment_mode is not null) then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  if p_task.status = 'in_review' then
    raise sqlstate 'PT409' using message = 'task_in_review';
  end if;
  if p_task.status in ('completed', 'unfulfilled', 'cancelled') then
    raise sqlstate 'PT409' using message = 'task_terminal';
  end if;
  if v_title is distinct from p_task.title then
    v_changed := array_append(v_changed, 'title');
    v_before := v_before || jsonb_build_object('title', p_task.title);
    v_after := v_after || jsonb_build_object('title', v_title);
  end if;
  if v_description is distinct from p_task.description then
    v_changed := array_append(v_changed, 'description');
    v_before := v_before || jsonb_build_object('description', p_task.description);
    v_after := v_after || jsonb_build_object('description', v_description);
  end if;
  if p_deadline is distinct from p_task.deadline then
    v_changed := array_append(v_changed, 'deadline');
    v_before := v_before || jsonb_build_object('deadline', p_task.deadline);
    v_after := v_after || jsonb_build_object('deadline', p_deadline);
  end if;
  if p_group_id is distinct from p_task.group_id then
    v_changed := array_append(v_changed, 'group_id');
    v_before := v_before || jsonb_build_object('group_id', p_task.group_id);
    v_after := v_after || jsonb_build_object('group_id', p_group_id);
  end if;
  if p_group_id is distinct from p_task.group_id and p_campaign_id = p_task.campaign_id and p_campaign_id is not null then
    select grp.path into v_target_path from public.groups grp where grp.id = p_group_id;
    select campaign.group_id into v_campaign_group from public.campaigns campaign where campaign.id = p_campaign_id;
    if v_campaign_group is not null and not v_target_path @> array[v_campaign_group] then
      v_campaign_id := null;
    end if;
  end if;
  if v_campaign_id is distinct from p_task.campaign_id then
    v_changed := array_append(v_changed, 'campaign_id');
    v_before := v_before || jsonb_build_object('campaign_id', p_task.campaign_id);
    v_after := v_after || jsonb_build_object('campaign_id', v_campaign_id);
  end if;
  if p_audience is distinct from p_task.audience then
    v_changed := array_append(v_changed, 'audience');
    v_before := v_before || jsonb_build_object('audience', p_task.audience);
    v_after := v_after || jsonb_build_object('audience', p_audience);
  end if;
  if p_assignment_mode is distinct from p_task.assignment_mode then
    v_changed := array_append(v_changed, 'assignment_mode');
    v_before := v_before || jsonb_build_object('assignment_mode', p_task.assignment_mode);
    v_after := v_after || jsonb_build_object('assignment_mode', p_assignment_mode);
  end if;
  if array_length(v_changed, 1) is null then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;
  return jsonb_build_object('title', v_title, 'description', v_description,
    'campaign_id', v_campaign_id, 'changed', to_jsonb(v_changed), 'before', v_before, 'after', v_after);
end;
$$;

comment on function private.plan_task_update(public.tasks, bigint, text, text, timestamptz, bigint, text, text) is
  'Shared #627 full-state validator and audit diff. A real Group move needs an active target; same-Group edits retain the prior edit window even on archived Groups. Subtasks cannot move and Umbrellas with Subtasks cannot move. An existing Campaign incompatible with the target Group is normalized to null and included in the changed/before/after diff.';

-- ==================== Shared: consequences (one definition, two readers) ====================
create function private.task_update_consequences(
  p_task_id bigint, p_group_id bigint, p_campaign_id bigint, p_assignment_mode text, p_audience text)
returns table (consequence text, member_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with task as (
    select target.id, target.group_id, target.audience, target.assignment_mode,
           target.campaign_id, grp.min_level, grp.path
      from public.tasks as target
      join public.groups as grp on grp.id = p_group_id
     where target.id = p_task_id and target.kind = 'task'
  ),
  narrowed as (
    select task.* from task
     where p_assignment_mode = 'public' and p_audience = 'local'
       and task.audience is distinct from 'local'
  ),
  moving as (select * from task where group_id is distinct from p_group_id),
  removed_candidates as (
    select candidate.id, candidate.member_id, candidate.joined_at
      from task
      join public.task_candidates as candidate
        on candidate.task_id = task.id and candidate.status = 'pending'
     where (task.assignment_mode = 'public' and p_assignment_mode = 'direct')
        or (exists (select 1 from narrowed)
            and not private.is_group_member(p_group_id, candidate.member_id))
        or (exists (select 1 from moving)
            and coalesce(private.actor_level(candidate.member_id), -1) < task.min_level)
  ),
  active_executor as (
    select assignment.member_id, task.min_level
      from task join public.task_assignments as assignment
        on assignment.task_id = task.id and assignment.ended_at is null
  ),
  removed_executor as (
    select executor.member_id from active_executor executor
     where (exists (select 1 from moving)
            and coalesce(private.actor_level(executor.member_id), -1) < executor.min_level)
        or (not exists (select 1 from moving) and exists (select 1 from narrowed)
            and not private.is_group_member(p_group_id, executor.member_id))
  ),
  added_executor as (
    select executor.member_id from active_executor executor
     where exists (select 1 from moving)
       and coalesce(private.actor_level(executor.member_id), -1) >= executor.min_level
       and not private.is_group_member(p_group_id, executor.member_id)
  ),
  promoted as (
    select candidate.member_id
      from task
      join public.task_candidates as candidate
        on candidate.task_id = task.id and candidate.status = 'pending'
      join public.profiles as profile
        on profile.id = candidate.member_id and profile.status = 'activ'
     where not exists (select 1 from moving)
       and exists (select 1 from removed_executor)
       and not exists (select 1 from removed_candidates removed where removed.id = candidate.id)
       and not exists (select 1 from removed_executor removed where removed.member_id = candidate.member_id)
     order by candidate.joined_at, candidate.id limit 1
  ),
  cleared_campaign as (
    select null::uuid as member_id from moving
      join public.campaigns campaign on campaign.id = moving.campaign_id
     where p_campaign_id = moving.campaign_id
       and not moving.path @> array[campaign.group_id]
  ),
  consequences as (
    select 1 as rank, 'executor_added_to_group'::text as consequence,
           added_executor.member_id, null::timestamptz as joined_at, null::bigint as candidate_id
      from added_executor
    union all select 2, 'executor_removed', removed_executor.member_id, null, null from removed_executor
    union all select 3, 'candidate_removed', removed_candidates.member_id,
                     removed_candidates.joined_at, removed_candidates.id from removed_candidates
    union all select 4, 'campaign_cleared', cleared_campaign.member_id, null, null from cleared_campaign
    union all select 5, 'candidate_promoted', promoted.member_id, null, null from promoted
  )
  select consequences.consequence, consequences.member_id from consequences
   order by consequences.rank, consequences.joined_at, consequences.candidate_id;
$$;

comment on function private.task_update_consequences(bigint, bigint, bigint, text, text) is
  'One shared #627 preview/command consequence definition. On a move: an eligible Executor outside the target roster is appointed; one below target Minimum Level loses the Assignment, with no queue promotion; pending Candidates below target Minimum Level leave the queue; an incompatible existing Campaign is cleared. Explicit Audience narrowing and mode changes keep #626 Candidate effects. Without a move, #626 Executor removal and queue promotion remain. Stable; no writes or locks.';

-- ==================== update_task ====================
create function private.update_task_impl(
  p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamptz,
  p_campaign_id bigint, p_assignment_mode text, p_audience text,
  p_accept_consequences boolean)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_parent_id bigint;
  v_task public.tasks%rowtype;
  v_plan jsonb;
  v_consequences jsonb;
  v_removed_candidates uuid[];
  v_removed_executor uuid;
  v_added_executor uuid;
  v_campaign_id bigint;
  v_promoted uuid;
  v_closed uuid[] := '{}'::uuid[];
  v_assignment_id bigint;
  v_candidate public.task_candidates%rowtype;
  v_new_assignment_id bigint;
  v_executor uuid;
  v_mode_changed boolean;
  v_group_changed boolean;
  v_from public.task_status;
  v_to public.task_status;
  v_details jsonb;
  v_constraint text;
begin
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. The locks. This unlocked read only learns WHICH parent to lock first;
  --    every decision below is made from the locked rows. Both rows FOR NO
  --    KEY UPDATE, never FOR UPDATE -- see the header.
  select parent_task_id into v_parent_id from public.tasks where id = p_task_id;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  if v_parent_id is not null then
    perform 1 from public.tasks where id = v_parent_id for no key update;
    if not found then
      raise sqlstate 'PT404' using message = 'task_not_found';
    end if;
  end if;
  select * into v_task from public.tasks where id = p_task_id for no key update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock.
  perform private.require_task_manager(p_task_id);
  if v_task.parent_task_id is distinct from v_parent_id then
    raise sqlstate 'PT409' using message = 'task_parent_changed';
  end if;
  if p_group_id is distinct from v_task.group_id then
    perform private.require_group_work_manager(p_group_id);
    perform 1 from public.groups grp
      where grp.id in (v_task.group_id, p_group_id)
      order by grp.id for no key update;
    perform private.require_group_work_manager(v_task.group_id);
    perform private.require_group_work_manager(p_group_id);
  end if;
  if p_group_id is distinct from v_task.group_id then
    perform 1 from public.profiles profile
     where profile.id in (
       select assignment.member_id from public.task_assignments assignment
        where assignment.task_id = p_task_id and assignment.ended_at is null
       union
       select candidate.member_id from public.task_candidates candidate
        where candidate.task_id = p_task_id and candidate.status = 'pending')
     order by profile.id for share of profile;
  end if;
  -- 5 + 6. Input validation and state preconditions, shared with the preview.
  v_plan := private.plan_task_update(v_task, p_group_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience);
  -- Consequences, shared with the preview; none may apply unaccepted.
  select coalesce(jsonb_agg(jsonb_build_object('consequence', c.consequence, 'member_id', c.member_id)
                            order by c.ord), '[]'::jsonb)
    into v_consequences
    from private.task_update_consequences(p_task_id, p_group_id, p_campaign_id, p_assignment_mode, p_audience)
         with ordinality as c (consequence, member_id, ord);
  if jsonb_array_length(v_consequences) > 0 and not coalesce(p_accept_consequences, false) then
    raise sqlstate 'PT409' using message = 'task_update_needs_confirmation';
  end if;
  select coalesce(array_agg((e ->> 'member_id')::uuid) filter (where e ->> 'consequence' = 'candidate_removed'), '{}'::uuid[]),
         (array_agg((e ->> 'member_id')::uuid) filter (where e ->> 'consequence' = 'executor_removed'))[1],
         (array_agg((e ->> 'member_id')::uuid) filter (where e ->> 'consequence' = 'candidate_promoted'))[1],
         (array_agg((e ->> 'member_id')::uuid) filter (where e ->> 'consequence' = 'executor_added_to_group'))[1]
    into v_removed_candidates, v_removed_executor, v_promoted, v_added_executor
    from jsonb_array_elements(v_consequences) as e;
  v_campaign_id := (v_plan ->> 'campaign_id')::bigint;
  v_mode_changed := p_assignment_mode is distinct from v_task.assignment_mode;
  v_group_changed := p_group_id is distinct from v_task.group_id;

  if v_added_executor is not null then
    perform private.appoint_group_member(p_group_id, v_added_executor, v_actor);
  end if;
  -- 7. Mutate. Candidatures first: close_task_queue must run while the Task
  --    is still public (it is a no-op otherwise).
  if v_task.assignment_mode = 'public' and p_assignment_mode = 'direct' then
    v_closed := private.close_task_queue(p_task_id, v_actor);
  elsif cardinality(v_removed_candidates) > 0 then
    with closed as (
      update public.task_candidates as candidate
         set status = 'closed', decided_at = now(), decided_by = v_actor
       where candidate.task_id = p_task_id
         and candidate.status = 'pending'
         and candidate.member_id = any (v_removed_candidates)
      returning candidate.member_id)
    select coalesce(array_agg(closed.member_id), '{}'::uuid[]) into v_closed from closed;
  end if;
  if v_removed_executor is not null then
    select assignment.id into v_assignment_id
      from public.task_assignments as assignment
     where assignment.task_id = p_task_id and assignment.ended_at is null
       and assignment.member_id = v_removed_executor
     for update;
    perform private.end_task_assignment(v_assignment_id,
      case when v_group_changed then 'group_changed' else 'task_updated' end, null);
    if v_task.status <> 'todo' then
      v_from := v_task.status;
      v_to := 'todo';
    end if;
  end if;
  begin
    update public.tasks
       set title = v_plan ->> 'title',
           description = v_plan ->> 'description',
           deadline = p_deadline,
           campaign_id = v_campaign_id,
           group_id = p_group_id,
           audience = p_audience,
           assignment_mode = p_assignment_mode,
           queue_opened_at = case
             when v_mode_changed then case when p_assignment_mode = 'public' then now() end
             else queue_opened_at
           end,
           queue_closed_at = case when v_mode_changed then null else queue_closed_at end,
           status = case when v_removed_executor is not null then 'todo'::public.task_status else status end,
           started_at = case when v_removed_executor is not null then null else started_at end
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
      -- private.validate_task_campaign raises 23514 with exactly these two
      -- reasons (update_task_content precedent); any other 23514 propagates.
      if sqlerrm in ('task_campaign_origin_mismatch', 'task_campaign_inactive') then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
  end;
  v_details := jsonb_build_object('changed', v_plan -> 'changed', 'before', v_plan -> 'before',
    'after', v_plan -> 'after', 'consequences', v_consequences);
  if v_assignment_id is not null then
    v_details := v_details || jsonb_build_object('ended_assignment_id', v_assignment_id);
  end if;
  perform private.log_task_activity(p_task_id, 'task_updated', v_actor, null, v_from, v_to, null, v_details);

  -- The vacated slot goes to the head of the remaining queue, as in
  -- give_up_task: the kit opens the Assignment (executor_assigned row, 'Task
  -- nou' notification) and the Candidature becomes selected.
  if v_promoted is not null then
    select candidate.* into v_candidate
      from public.task_candidates as candidate
     where candidate.task_id = p_task_id and candidate.member_id = v_promoted
       and candidate.status = 'pending'
     for update;
    v_new_assignment_id := private.open_task_assignment(p_task_id, v_promoted, v_actor, 'queue_promotion');
    update public.task_candidates as candidate
       set status = 'selected', decided_at = now(), decided_by = v_actor,
           assignment_id = v_new_assignment_id
     where candidate.id = v_candidate.id;
    perform private.log_task_activity(p_task_id, 'candidate_selected', v_actor, v_new_assignment_id,
      null, null, null,
      jsonb_build_object('candidate_id', v_candidate.id, 'member_id', v_promoted, 'promoted', true));
  end if;

  -- Notifications.
  perform private.notify(v_closed, 'task'::public.noti_kind,
    'Coadă închisă: ' || v_task.title,
    'Nu mai poți fi selectat pentru acest task.',
    p_task_id, null, v_actor);
  if v_removed_executor is not null then
    perform private.notify(array[v_removed_executor], 'task'::public.noti_kind,
      'Task actualizat: ' || v_task.title,
      case when v_group_changed
        then 'Taskul a fost mutat într-un grup pentru care nu ești eligibil.'
        else 'Nu mai ești executorul acestui task: audiența lui s-a schimbat.' end,
      p_task_id, null, v_actor);
  end if;
  if v_promoted is null then
    select assignment.member_id into v_executor
      from public.task_assignments as assignment
     where assignment.task_id = p_task_id and assignment.ended_at is null;
    if v_executor is not null then
      perform private.notify(array[v_executor], 'task'::public.noti_kind,
        'Task actualizat: ' || v_task.title,
        'Modificat: ' || array_to_string(array(select jsonb_array_elements_text(v_plan -> 'changed')), ', ') || '.',
        p_task_id, null, v_actor);
    end if;
  end if;
  return v_task;
end;
$$;

comment on function private.update_task_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, boolean) is
  'Atomic #627 full-state Task update. Locks Umbrella then Task FOR NO KEY UPDATE; for a move, authorizes both Groups, locks both Groups in ID order, rechecks authority, and holds Executor/Candidate Profiles FOR SHARE before applying the shared consequence plan. PT409 task_update_needs_confirmation protects every listed consequence. Uses the #583 Appointment core, ends an ineligible Assignment with group_changed and returns Task to todo without queue promotion, closes ineligible Candidatures, clears an incompatible Campaign, and logs one task_updated activity with the accepted consequences and field diff.';

create function public.update_task(
  p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamptz,
  p_campaign_id bigint, p_assignment_mode text, p_audience text,
  p_accept_consequences boolean default false)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.update_task_impl(p_task_id, p_group_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience, p_accept_consequences);
$$;

comment on function public.update_task(bigint, bigint, text, text, timestamptz, bigint, text, text, boolean) is
  'Sets every editable field, including Group, at once while todo or in_progress. A real Group move requires authority over source and target. Consequences require explicit acceptance after public.preview_task_update.';

-- ==================== preview_task_update ====================
create function private.preview_task_update_impl(
  p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamptz,
  p_campaign_id bigint, p_assignment_mode text, p_audience text)
returns table (consequence text, member_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
begin
  -- The command's gate, without its locks: a stable function takes none.
  perform private.require_task_visible(p_task_id);
  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  if not coalesce(private.can_manage_task(p_task_id), false) then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end if;
  if p_group_id is distinct from v_task.group_id and not coalesce(private.can_manage_group_work(p_group_id), false) then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  perform private.plan_task_update(v_task, p_group_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience);
  return query
    select c.consequence, c.member_id
      from private.task_update_consequences(p_task_id, p_group_id, p_campaign_id, p_assignment_mode, p_audience) as c;
end;
$$;

comment on function private.preview_task_update_impl(bigint, bigint, text, text, timestamptz, bigint, text, text) is
  'Body behind public.preview_task_update (#626): the same gate as update_task (PT404 task_not_found for an invisible Task, 42501 task_manage_forbidden for a non-manager), the same validation and refusals (private.plan_task_update), then the rows of private.task_update_consequences -- the one definition the command applies. Stable; writes and locks nothing.';

create function public.preview_task_update(
  p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamptz,
  p_campaign_id bigint, p_assignment_mode text, p_audience text)
returns table (consequence text, member_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.preview_task_update_impl(p_task_id, p_group_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience);
$$;

comment on function public.preview_task_update(bigint, bigint, text, text, timestamptz, bigint, text, text) is
  'Lists public.update_task consequences for the same full state without writes: executor_added_to_group, executor_removed, candidate_removed, campaign_cleared (null member_id), and candidate_promoted. Refuses the same invalid state or authority.';

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.plan_task_update(public.tasks, bigint, text, text, timestamptz, bigint, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function private.task_update_consequences(bigint, bigint, bigint, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function private.update_task_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function private.preview_task_update_impl(bigint, bigint, text, text, timestamptz, bigint, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.update_task(bigint, bigint, text, text, timestamptz, bigint, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function public.preview_task_update(bigint, bigint, text, text, timestamptz, bigint, text, text)
  from public, anon, authenticated, service_role;

grant execute on function private.update_task_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, boolean)
  to authenticated;
grant execute on function private.preview_task_update_impl(bigint, bigint, text, text, timestamptz, bigint, text, text)
  to authenticated;
grant execute on function public.update_task(bigint, bigint, text, text, timestamptz, bigint, text, text, boolean)
  to authenticated;
grant execute on function public.preview_task_update(bigint, bigint, text, text, timestamptz, bigint, text, text)
  to authenticated;
