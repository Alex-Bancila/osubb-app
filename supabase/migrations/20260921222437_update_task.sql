-- #626: update_task -- a Task Manager edits every field of a Task until review
-- (ADR-0007 Sec Task identity, amended 2026-09-21), and preview_task_update
-- tells them beforehand what the edit will do to other people.
--
-- R-E1: a NEW full-state command. public.update_task_content (#328) and
-- public.convert_task_mode (#329) are untouched and stay until the frontend
-- moves; this command does not call them. Parameters are full new values,
-- never a patch (conventions OD5): p_title null/blank is PT400 title_required;
-- for an ordinary Task p_deadline null is PT400 deadline_required and
-- p_audience / p_assignment_mode must be one of their CHECK values (PT400
-- invalid_audience / invalid_assignment_mode); for an Umbrella they must be
-- null (PT409 task_is_umbrella) and p_campaign_id too (PT400
-- umbrella_has_no_campaign); p_description / p_campaign_id null clear the
-- field. The Campaign trigger's two 23514 reasons map to PT400
-- invalid_campaign exactly as in update_task_content.
--
-- The edit window: status todo or in_progress, Feedback pending (in_progress
-- with review_round > 0) included. in_review is PT409 task_in_review; a
-- terminal status is PT409 task_terminal; a call that changes no field is
-- PT409 nothing_to_update. The one rule lifted relative to convert_task_mode
-- is its freeze after the first Assignment or Candidature -- Audience and
-- Assignment Mode stay editable, and the people the change displaces are the
-- edit's CONSEQUENCES.
--
-- Consequences (one definition, two readers -- R-E2).
-- private.task_update_consequences is the only place they are computed;
-- private.update_task_impl and private.preview_task_update_impl both read it,
-- so the preview a manager accepts is by construction the set the command
-- applies. Rows, in this order:
--   * executor_removed  -- R-E8: the Audience narrows to local on a Task whose
--     resulting Assignment Mode is public, and the active Executor is not a
--     member of the Task's Group. The Assignment ends (end_reason
--     task_updated), the Task returns to todo (started_at cleared, as
--     tasks_started_at_state_check demands; review_round and
--     returned_to_progress_at are history and stay, the reopen_task
--     precedent), and the Executor is notified. A direct Task never loses its
--     Executor to an Audience change: ADR-0007 lets a manager assign any
--     active member to a direct Task, Audience governs public queues only.
--   * candidate_removed -- one per pending Candidate whose Candidature ends:
--     every pending Candidate when the Task goes Public -> Direct (the queue
--     closes through private.close_task_queue), or, when the Audience
--     narrows to local on a public Task, every pending Candidate who is not
--     a member of the Task's Group (R-E8). Each gets the existing
--     close-queue notification ('Coadă închisă').
--   * candidate_promoted -- only alongside executor_removed: the oldest
--     remaining activ pending Candidate is promoted into the vacated slot,
--     exactly as give_up_task promotes (via = 'queue_promotion'), so a public
--     Task never sits Executor-less while its queue still holds an eligible
--     Candidate (give_up_task's invariant). They get the standard 'Task nou'.
-- Any consequence without p_accept_consequences = true is PT409
-- task_update_needs_confirmation, and nothing is written.
--
-- Eligibility (R-E8) is the Audience rule of express_task_interest read on
-- Groups: a local Opportunity admits the members of its own Origin, which in
-- ADR-0009 is private.is_group_member(task.group_id, member) -- the same
-- membership test private.can_read_task's R6 branch applies to a local
-- Opportunity. express_task_interest_impl itself still reads the legacy
-- member_departments / team_members / project_members rows; group_members
-- mirrors exactly those rows for the Task's Group, so the two agree, and house
-- rule 13 forbids a new dept_id / team_id / project_id branch here.
-- Direct -> Public opens the queue (queue_opened_at = now(), queue_closed_at
-- null), convert_task_mode's rule.
--
-- #627 adds the Task's Group to this command. It extends the same two shared
-- functions: every eligibility test below already reads the Task's Group
-- through one value (task.group_id), which #627 replaces with the target
-- Group, and adds its own consequence kinds beside these three.
--
-- Locks (conventions Sec1). The target may itself be an Umbrella, so it is
-- locked FOR NO KEY UPDATE unconditionally, never FOR UPDATE (cancel_task /
-- complete_umbrella_task precedent). A Subtask's Umbrella is locked FIRST,
-- also FOR NO KEY UPDATE, because the update fires validate_task_hierarchy,
-- which takes the parent FOR SHARE: without the parent lock first, this
-- command (child, then parent) and cancel_task on the Umbrella (parent, then
-- child) could deadlock. The parent is re-checked under the locks (PT409
-- task_parent_changed, the reopen_task guard).
--
-- History: one task_updated activity row (assignment_id null -- a Task-level
-- row; from/to status only when the Executor's removal moved the Task back to
-- todo) with details.changed / before / after naming exactly the changed
-- fields, details.consequences listing what was applied and, when an
-- Assignment ended, details.ended_assignment_id. A promotion additionally
-- writes the kit's executor_assigned row and a candidate_selected row, as
-- give_up_task does. The Executor who keeps the Task gets 'Task actualizat'
-- naming the changed fields; private.notify drops the actor, so a manager
-- editing their own Assignment notifies nobody (update_task_content's rule).

-- ==================== Vocabulary ====================
alter table public.task_activity
  drop constraint task_activity_kind_ck,
  add constraint task_activity_kind_ck check (kind in (
    'created','content_updated','mode_converted','queue_opened','queue_closed',
    'interest_expressed','interest_withdrawn','candidate_selected','executor_assigned',
    'gave_up','started','submitted','returned_to_progress','evaluated','reopened',
    'cancelled','duplicated','subtask_completed','unfulfilled','umbrella_completed',
    'task_updated'));

alter table public.task_assignments
  drop constraint task_assignments_end_reason_check,
  add constraint task_assignments_end_reason_check check (
    end_reason in (
      'gave_up',
      'replaced',
      'completed',
      'failed',
      'cancelled',
      'legacy_migration',
      'task_updated'
    )
  );

-- ==================== Shared: validation and field diff ====================
create function private.plan_task_update(
  p_task public.tasks, p_title text, p_description text, p_deadline timestamptz,
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
begin
  -- 5. Input validation (PT400).
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
  if p_campaign_id is distinct from p_task.campaign_id then
    v_changed := array_append(v_changed, 'campaign_id');
    v_before := v_before || jsonb_build_object('campaign_id', p_task.campaign_id);
    v_after := v_after || jsonb_build_object('campaign_id', p_campaign_id);
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
    'changed', to_jsonb(v_changed), 'before', v_before, 'after', v_after);
end;
$$;

comment on function private.plan_task_update(public.tasks, text, text, timestamptz, bigint, text, text) is
  'Shared by private.update_task_impl and private.preview_task_update_impl (#626): validates the full new state of a Task against its current row and returns {title, description (both normalized), changed, before, after}. PT400 title_required / deadline_required (ordinary Task) / invalid_audience / invalid_assignment_mode (ordinary Task) / umbrella_has_no_campaign; PT409 task_is_umbrella (a mode or Audience on an Umbrella), task_in_review, task_terminal, nothing_to_update -- in that order. Writes nothing and locks nothing; Campaign validity stays with the validate_task_campaign trigger at write time.';

-- ==================== Shared: consequences (one definition, two readers) ====================
create function private.task_update_consequences(
  p_task_id bigint, p_assignment_mode text, p_audience text)
returns table (consequence text, member_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with task as (
    select target.id, target.group_id, target.audience, target.assignment_mode
      from public.tasks as target
     where target.id = p_task_id and target.kind = 'task'
  ),
  -- R-E8's trigger: the Audience becomes local on a Task that is public after
  -- the edit. The eligibility test is the Group reading of
  -- express_task_interest's Audience rule (see the migration header).
  narrowed as (
    select task.* from task
     where p_assignment_mode = 'public'
       and p_audience = 'local'
       and task.audience is distinct from 'local'
  ),
  removed_candidates as (
    select candidate.id, candidate.member_id, candidate.joined_at
      from task
      join public.task_candidates as candidate
        on candidate.task_id = task.id and candidate.status = 'pending'
     where (task.assignment_mode = 'public' and p_assignment_mode = 'direct')
        or (exists (select 1 from narrowed)
            and not private.is_group_member(task.group_id, candidate.member_id))
  ),
  removed_executor as (
    select assignment.member_id
      from narrowed
      join public.task_assignments as assignment
        on assignment.task_id = narrowed.id and assignment.ended_at is null
     where not private.is_group_member(narrowed.group_id, assignment.member_id)
  ),
  promoted as (
    select candidate.member_id
      from task
      join public.task_candidates as candidate
        on candidate.task_id = task.id and candidate.status = 'pending'
      join public.profiles as profile
        on profile.id = candidate.member_id and profile.status = 'activ'
     where exists (select 1 from removed_executor)
       and not exists (select 1 from removed_candidates as removed where removed.id = candidate.id)
       and not exists (select 1 from removed_executor as removed where removed.member_id = candidate.member_id)
     order by candidate.joined_at, candidate.id
     limit 1
  ),
  consequences as (
    select 1 as rank, 'executor_removed'::text as consequence, removed_executor.member_id,
           null::timestamptz as joined_at, null::bigint as candidate_id
      from removed_executor
    union all
    select 2, 'candidate_removed', removed_candidates.member_id,
           removed_candidates.joined_at, removed_candidates.id
      from removed_candidates
    union all
    select 3, 'candidate_promoted', promoted.member_id, null, null
      from promoted
  )
  select consequences.consequence, consequences.member_id
    from consequences
   order by consequences.rank, consequences.joined_at, consequences.candidate_id;
$$;

comment on function private.task_update_consequences(bigint, text, text) is
  'The ONE definition of what an update_task edit does to other people (#626, R-E2/R-E8), read by both private.update_task_impl and private.preview_task_update_impl. Returns, in order: executor_removed (the Audience narrows to local on a Task public after the edit and the active Executor is not private.is_group_member of the Task''s Group); candidate_removed per pending Candidate, in queue order (every one on Public -> Direct; on an Audience narrowing to local, each who is not a Group member); candidate_promoted (only with executor_removed: the oldest remaining activ pending Candidate, the give_up_task promotion). Empty for an Umbrella. Stable, writes nothing, locks nothing -- the command calls it under the Task lock.';

-- ==================== update_task ====================
create function private.update_task_impl(
  p_task_id bigint, p_title text, p_description text, p_deadline timestamptz,
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
  v_promoted uuid;
  v_closed uuid[] := '{}'::uuid[];
  v_assignment_id bigint;
  v_candidate public.task_candidates%rowtype;
  v_new_assignment_id bigint;
  v_executor uuid;
  v_mode_changed boolean;
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
  -- 5 + 6. Input validation and state preconditions, shared with the preview.
  v_plan := private.plan_task_update(v_task, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience);
  -- Consequences, shared with the preview; none may apply unaccepted.
  select coalesce(jsonb_agg(jsonb_build_object('consequence', c.consequence, 'member_id', c.member_id)
                            order by c.ord), '[]'::jsonb)
    into v_consequences
    from private.task_update_consequences(p_task_id, p_assignment_mode, p_audience)
         with ordinality as c (consequence, member_id, ord);
  if jsonb_array_length(v_consequences) > 0 and not coalesce(p_accept_consequences, false) then
    raise sqlstate 'PT409' using message = 'task_update_needs_confirmation';
  end if;
  select coalesce(array_agg((e ->> 'member_id')::uuid) filter (where e ->> 'consequence' = 'candidate_removed'), '{}'::uuid[]),
         (array_agg((e ->> 'member_id')::uuid) filter (where e ->> 'consequence' = 'executor_removed'))[1],
         (array_agg((e ->> 'member_id')::uuid) filter (where e ->> 'consequence' = 'candidate_promoted'))[1]
    into v_removed_candidates, v_removed_executor, v_promoted
    from jsonb_array_elements(v_consequences) as e;
  v_mode_changed := p_assignment_mode is distinct from v_task.assignment_mode;

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
    perform private.end_task_assignment(v_assignment_id, 'task_updated', null);
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
           campaign_id = p_campaign_id,
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
      'Nu mai ești executorul acestui task: audiența lui s-a schimbat.',
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

comment on function private.update_task_impl(bigint, text, text, timestamptz, bigint, text, text, boolean) is
  'Body behind public.update_task (#626): a Task Manager (private.require_task_manager, 42501 task_manage_forbidden) sets the full state of a Task -- title, description, deadline, Campaign, Audience, Assignment Mode -- while it is todo or in_progress (Feedback pending included). Validation and the field diff are private.plan_task_update; the consequences are private.task_update_consequences, the same function the preview reads, and any consequence without p_accept_consequences is PT409 task_update_needs_confirmation. Locks a Subtask''s Umbrella then the Task, both FOR NO KEY UPDATE. Public -> Direct closes the queue through private.close_task_queue; an Audience narrowing to local on a public Task closes each pending Candidature of a non-member of the Task''s Group and, when the Executor is one, ends their Assignment (end_reason task_updated), returns the Task to todo and promotes the oldest remaining activ Candidate (via queue_promotion). Direct -> Public opens the queue. Writes one task_updated activity row (details.changed/before/after/consequences, ended_assignment_id when one ended); notifies removed Candidates (''Coadă închisă''), a removed Executor, and the Executor who keeps the Task (''Task actualizat'', the changed fields) -- never the actor.';

create function public.update_task(
  p_task_id bigint, p_title text, p_description text, p_deadline timestamptz,
  p_campaign_id bigint, p_assignment_mode text, p_audience text,
  p_accept_consequences boolean default false)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.update_task_impl(p_task_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience, p_accept_consequences);
$$;

comment on function public.update_task(bigint, text, text, timestamptz, bigint, text, text, boolean) is
  'Sets every editable field of a Task at once (full state, never a patch) while it is todo or in_progress; callable by the Task''s managers. When the edit ends Candidatures or an Assignment it is refused with PT409 task_update_needs_confirmation unless p_accept_consequences is true -- call public.preview_task_update with the same values first to list them.';

-- ==================== preview_task_update ====================
create function private.preview_task_update_impl(
  p_task_id bigint, p_title text, p_description text, p_deadline timestamptz,
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
  perform private.plan_task_update(v_task, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience);
  return query
    select c.consequence, c.member_id
      from private.task_update_consequences(p_task_id, p_assignment_mode, p_audience) as c;
end;
$$;

comment on function private.preview_task_update_impl(bigint, text, text, timestamptz, bigint, text, text) is
  'Body behind public.preview_task_update (#626): the same gate as update_task (PT404 task_not_found for an invisible Task, 42501 task_manage_forbidden for a non-manager), the same validation and refusals (private.plan_task_update), then the rows of private.task_update_consequences -- the one definition the command applies. Stable; writes and locks nothing.';

create function public.preview_task_update(
  p_task_id bigint, p_title text, p_description text, p_deadline timestamptz,
  p_campaign_id bigint, p_assignment_mode text, p_audience text)
returns table (consequence text, member_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.preview_task_update_impl(p_task_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience);
$$;

comment on function public.preview_task_update(bigint, text, text, timestamptz, bigint, text, text) is
  'Lists what public.update_task would do to other people with these same values -- executor_removed, candidate_removed, candidate_promoted rows, each naming the member -- without writing anything. Refuses exactly as the command would.';

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.plan_task_update(public.tasks, text, text, timestamptz, bigint, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function private.task_update_consequences(bigint, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function private.update_task_impl(bigint, text, text, timestamptz, bigint, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function private.preview_task_update_impl(bigint, text, text, timestamptz, bigint, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.update_task(bigint, text, text, timestamptz, bigint, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function public.preview_task_update(bigint, text, text, timestamptz, bigint, text, text)
  from public, anon, authenticated, service_role;

grant execute on function private.update_task_impl(bigint, text, text, timestamptz, bigint, text, text, boolean)
  to authenticated;
grant execute on function private.preview_task_update_impl(bigint, text, text, timestamptz, bigint, text, text)
  to authenticated;
grant execute on function public.update_task(bigint, text, text, timestamptz, bigint, text, text, boolean)
  to authenticated;
grant execute on function public.preview_task_update(bigint, text, text, timestamptz, bigint, text, text)
  to authenticated;
