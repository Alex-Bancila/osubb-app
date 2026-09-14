-- #327: create_task — the only way a Task is created — plus the authority kit
-- every Task command reuses.
--
-- The kit is the point of this migration: eighteen later commands (#328-#345)
-- call these eleven private functions rather than re-deriving authority,
-- history or fan-out, so their signatures are the contract, not an
-- implementation detail. create_task itself is the first caller and the proof
-- that the shapes work.
--
-- Deviations from #327's issue body, all recorded in the PR:
--   - `can_manage_task` already exists on main (20260911211100) and is reused
--     unchanged; the issue asked for it again.
--   - `task_origin` is not created: every command locks the Task into a
--     public.tasks%rowtype variable, which already carries the Origin.
--   - `can_evaluate_task` is new here because nothing on main distinguishes
--     *evaluating* from *managing*: private.can_manage_origin's
--     Independent-Team branch admits every active member of the Team, and
--     ADR-0007 gives evaluation there to BC/Moderator alone. See its own
--     comment below for the two other narrowings.
--
-- Step order inside create_task_impl follows docs/backend/conventions.md Sec2
-- and the #343 campaign-command template: malformed-for-everyone input, then
-- the membership gate, then the target lock, then authority under that lock,
-- then input validation, then state preconditions, then the mutation
-- followed by activity and notifications -- the gate before the lock is what
-- keeps an identity that can never manage anything from taking a row lock or
-- learning that a Task id exists.
--
-- One named exception: the Subtask path evaluates two PT409 state
-- preconditions (parent_not_umbrella, parent_terminal) and one PT400 input
-- check (subtask_origin_mismatch) on the Umbrella BEFORE the authority check,
-- because the Origin the authority check needs is unknowable until the
-- Umbrella row is read -- there is nothing to authorize against yet. This is
-- not a disclosure: the caller already passed private.can_read_task on the
-- parent to get this far, so nothing about the Umbrella's existence, kind or
-- status is learned that read did not already establish. #338's reopen_task
-- faces the same "origin lives on a row read before authority" shape and
-- should copy this reasoning, not the letter of "nothing may be reordered".

-- ==================== Predicate: who may evaluate ====================
-- can_manage_task minus three things (ADR-0007 Sec Authorization):
--   1. the Independent-Team member branch -- a Team's members jointly manage
--      their own work but never award its points; BC/Moderator evaluate there.
--   2. a Project Responsible evaluating the lead's active Assignment, or
--      their own -- the lead evaluates anything on their Project, including
--      their own work, but a Responsible may not mark either of them.
--   3. an archived Project entirely: private.is_project_lead /
--      is_project_responsible deliberately ignore projects.status (they answer
--      relationship identity for historical reads, #271), so the Project
--      branch below names `projects.status = 'active'` itself, matching
--      private.can_manage_project_work.
create function private.can_evaluate_task(p_task_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select coalesce(public.auth_is_member(), false)
       and exists (
         select 1
           from public.profiles as actor
           join public.roles as actor_role on actor_role.id = actor.role
          where actor.id = (select auth.uid())
            and actor.status = 'activ'
            and (
              actor_role.level >= 6
              or (task.dept_id is not null and actor.role = 'bce' and exists (
                    select 1 from public.member_departments as m
                     where m.member_id = actor.id and m.dept_id = task.dept_id))
              or (task.team_id is not null and actor.role = 'bce' and exists (
                    select 1 from public.teams as team
                    join public.member_departments as m on m.dept_id = team.dept_id
                   where team.id = task.team_id and team.dept_id is not null and m.member_id = actor.id))
              -- Independent Team: deliberately no member branch (ADR-0007: BC/Moderator evaluates)
              or (task.project_id is not null
                  and exists (select 1 from public.projects as p
                               where p.id = task.project_id and p.status = 'active')
                  and (
                    private.is_project_lead(task.project_id)
                    or (private.is_project_responsible(task.project_id)
                        and not exists (
                          select 1 from public.task_assignments as a
                           where a.task_id = task.id and a.ended_at is null
                             and (a.member_id = actor.id
                                  or a.member_id = (select p.leader_id from public.projects as p where p.id = task.project_id))))))
            )
       )
      from public.tasks as task
     where task.id = p_task_id
  ), false);
$$;

comment on function private.can_evaluate_task(bigint) is
  'Whether the active caller may evaluate this Task -- narrower than private.can_manage_task (ADR-0007 Sec Authorization): BC/Moderator anywhere; the live local BCE of a Department or of a Department-Team''s parent Department; on an ACTIVE Project, its lead (including for their own Assignment) and a Responsible, but a Responsible never for the lead''s active Assignment or their own. An Independent Team has no member branch at all -- its Tasks are evaluated by BC/Moderator only. False for a missing Task.';

-- ==================== Gate + visibility ====================
create function private.require_task_visible(p_task_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'task_command_forbidden';
  end if;
  if not coalesce(private.can_read_task(p_task_id), false) then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  return v_actor;
end;
$$;

comment on function private.require_task_visible(bigint) is
  'Step 2 of every Task command: returns auth.uid() only for a caller with organisation claims and a live activ profile (42501 task_command_forbidden otherwise), and only when private.can_read_task admits the target (PT404 task_not_found otherwise). A caller never learns whether an invisible Task exists (conventions Sec3).';

-- ==================== Authority under lock ====================
-- Re-validates authority against live rows and holds FOR SHARE the actor's
-- profile plus the one membership row the authority rests on, so a concurrent
-- deactivation or membership revocation serializes behind the command instead
-- of committing underneath a decision it already made (the #343 / #390
-- discipline). Callers hold the tasks row FOR UPDATE before reaching here.
create function private.require_origin_manager(p_dept_id text, p_team_id text, p_project_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_level integer;
  v_parent_dept text;
begin
  if v_actor is null
     or not coalesce(private.can_manage_origin(p_dept_id, p_team_id, p_project_id), false) then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end if;

  -- Only the level is read: the branching below keys off which Origin
  -- parameter is non-null, not off the actor's role, and plpgsql's
  -- unused-variable check (db lint --fail-on warning; conventions Sec4) fires
  -- on an assigned-never-read variable.
  select role.level into v_level
    from public.profiles as profile join public.roles as role on role.id = profile.role
   where profile.id = v_actor and profile.status = 'activ'
   for share of profile;
  if not found then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end if;
  if v_level >= 6 then
    return v_actor;
  end if;

  if p_dept_id is not null then
    perform 1 from public.member_departments as m
     where m.member_id = v_actor and m.dept_id = p_dept_id for share;
  elsif p_team_id is not null then
    select team.dept_id into v_parent_dept from public.teams as team where team.id = p_team_id;
    if v_parent_dept is not null then
      perform 1 from public.member_departments as m
       where m.member_id = v_actor and m.dept_id = v_parent_dept for share;
    else
      perform 1 from public.team_members as tm
       where tm.member_id = v_actor and tm.team_id = p_team_id for share;
    end if;
  elsif p_project_id is not null then
    if private.is_project_lead(p_project_id) then
      perform 1 from public.projects as project where project.id = p_project_id for share;
    else
      perform 1 from public.project_members as pm
       where pm.project_id = p_project_id and pm.member_id = v_actor and pm.project_role = 'responsible' for share;
    end if;
  end if;
  if not found then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end if;
  return v_actor;
end;
$$;

comment on function private.require_origin_manager(text, text, bigint) is
  'Returns auth.uid() only when the live caller may manage exactly one named Origin (private.can_manage_origin), and holds FOR SHARE their profile row plus the membership row that authority rests on -- the Department membership, the Department-Team''s parent-Department membership, the Independent-Team membership, the Project row for its lead, or the Responsible project_members row. BC/Moderator (live level >= 6) return on the profile lock alone. Raises 42501 task_manage_forbidden otherwise.';

create function private.require_task_manager(p_task_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
begin
  select * into v_task from public.tasks where id = p_task_id;   -- caller already holds FOR UPDATE
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  return private.require_origin_manager(v_task.dept_id, v_task.team_id, v_task.project_id);
end;
$$;

comment on function private.require_task_manager(bigint) is
  'private.require_origin_manager over an existing Task''s own Origin (a Subtask carries its Umbrella''s). The caller must already hold the tasks row FOR UPDATE. PT404 task_not_found for a missing Task, 42501 task_manage_forbidden otherwise.';

create function private.require_task_evaluator(p_task_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_task public.tasks%rowtype;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  if v_actor is null or not coalesce(private.can_evaluate_task(p_task_id), false) then
    raise exception using errcode = '42501', message = 'task_evaluate_forbidden';
  end if;
  -- Same locked re-validation as the manager path (profile + the membership
  -- the authority rests on); Independent Teams reach here only at level >= 6.
  -- require_origin_manager raises task_manage_forbidden, which this helper
  -- must never surface -- only reachable when a membership is revoked inside
  -- this lock window, but a caller pinned to task_evaluate_forbidden (#337,
  -- #338) must see exactly that reason regardless of which check inside this
  -- function actually failed.
  begin
    perform private.require_origin_manager(v_task.dept_id, v_task.team_id, v_task.project_id);
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'task_evaluate_forbidden';
  end;
  return v_actor;
end;
$$;

comment on function private.require_task_evaluator(bigint) is
  'Returns auth.uid() only when private.can_evaluate_task admits the caller for this Task, then takes the same FOR SHARE re-validation locks as private.require_origin_manager -- any 42501 from that re-validation is remapped to task_evaluate_forbidden so this helper never leaks task_manage_forbidden. The caller must already hold the tasks row FOR UPDATE. PT404 task_not_found for a missing Task; 42501 task_evaluate_forbidden otherwise.';

create function private.require_task_executor(p_task_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_assignment_id bigint;
  v_member uuid;
begin
  perform 1 from public.profiles as p where p.id = v_actor and p.status = 'activ' for share;
  if v_actor is null or not found or not coalesce(public.auth_is_member(), false) then
    raise exception using errcode = '42501', message = 'task_executor_forbidden';
  end if;
  select a.id, a.member_id into v_assignment_id, v_member
    from public.task_assignments as a
   where a.task_id = p_task_id and a.ended_at is null
   for update;
  if v_assignment_id is null or v_member is distinct from v_actor then
    raise exception using errcode = '42501', message = 'task_executor_forbidden';
  end if;
  return v_assignment_id;
end;
$$;

comment on function private.require_task_executor(bigint) is
  'Returns the id of the Task''s one active Assignment, locked FOR UPDATE, only when the caller has organisation claims and is the live activ Executor (their profile row is held FOR SHARE too). The caller must already hold the tasks row FOR UPDATE. Raises 42501 task_executor_forbidden when there is no active Assignment or it belongs to someone else -- the two cases are deliberately indistinguishable -- and is self-sufficient on the org-claims check so every future executor-side command can call it directly without its own gate running first.';

-- ==================== Internal writers ====================
create function private.log_task_activity(
  p_task_id bigint, p_kind text, p_actor uuid, p_assignment_id bigint,
  p_from public.task_status, p_to public.task_status, p_note text, p_details jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.task_activity (task_id, kind, actor_id, assignment_id, from_status, to_status, note, details, occurred_at)
  values (p_task_id, p_kind, p_actor, p_assignment_id, p_from, p_to,
          nullif(regexp_replace(coalesce(p_note, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
          coalesce(p_details, '{}'::jsonb), clock_timestamp())
  returning id into v_id;
  return v_id;
end;
$$;

comment on function private.log_task_activity(bigint, text, uuid, bigint, public.task_status, public.task_status, text, jsonb) is
  'The one writer of public.task_activity (append-only by trigger). Trims p_note to null when blank, defaults p_details to ''{}'', and stamps occurred_at with clock_timestamp() so two rows written in one command are still ordered. p_assignment_id is set only on rows about the Executor''s own work and left null on Task- and queue-level rows -- task_activity_read''s own-assignment branch depends on that rule.';

create function private.open_task_assignment(p_task_id bigint, p_member_id uuid, p_actor uuid, p_via text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_title text;
  v_deadline timestamptz;
begin
  -- Closed allow-list: details.via is a pinned structured fact, not free
  -- text, and every later command in the wave passes exactly one of these
  -- seven strings (stack-context.md Carry-forwards). A null or unknown via
  -- is a caller bug, not a silent no-notification.
  if p_via is null or p_via not in
     ('create', 'first_come', 'assign', 'queue_promotion', 'select', 'reopen', 'request_approval') then
    raise sqlstate 'PT400' using message = 'invalid_assignment_via';
  end if;
  if not exists (select 1 from public.profiles as p where p.id = p_member_id and p.status = 'activ') then
    raise sqlstate 'PT400' using message = 'invalid_executor';
  end if;
  insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
  values (p_task_id, p_member_id, p_actor, now())
  returning id into v_id;
  perform private.log_task_activity(p_task_id, 'executor_assigned', p_actor, v_id, null, null, null,
    jsonb_build_object('via', p_via, 'member_id', p_member_id));
  -- 'reopen' (Task 13) reactivates a past Executor and sends its own
  -- "Task redeschis" notification; every other path announces the new Task.
  -- 'first_come' is the member assigning themselves: notify() drops the
  -- actor, so no special case is needed for it. `is distinct from` (not
  -- `<>`) so a null p_via -- already rejected above, but kept explicit here
  -- for defense in depth -- cannot silently skip the notification.
  if p_via is distinct from 'reopen' then
    select title, deadline into v_title, v_deadline from public.tasks where id = p_task_id;
    perform private.notify(array[p_member_id], 'task'::public.noti_kind,
      'Task nou: ' || v_title,
      'Ți-a fost atribuit acest task. Deadline: ' || coalesce(to_char(v_deadline at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI'), '—') || '.',
      p_task_id, null, p_actor);
  end if;
  return v_id;
end;
$$;

comment on function private.open_task_assignment(bigint, uuid, uuid, text) is
  'Opens the one active Assignment for a Task, writes its executor_assigned activity row (details.via records how: create, first_come, assign, queue_promotion, select, reopen, request_approval -- a closed allow-list, PT400 invalid_assignment_via otherwise) and, except for a reopen, sends the new Executor the pinned "Task nou" notification. Raises PT400 invalid_executor for a member who is not a live activ profile. Relies on task_assignments_one_active_per_task_uidx as the last-resort race guard -- callers serialize on the tasks row lock first.';

create function private.end_task_assignment(p_assignment_id bigint, p_reason text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.task_assignments
     set ended_at = now(), end_reason = p_reason,
         end_note = nullif(regexp_replace(coalesce(p_note, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '')
   where id = p_assignment_id and ended_at is null;
  if not found then
    raise sqlstate 'PT409' using message = 'assignment_not_active';
  end if;
end;
$$;

comment on function private.end_task_assignment(bigint, text, text) is
  'Closes one still-active Assignment with an end_reason from task_assignments_end_reason_check, trimming a blank end_note to null. ended_at uses now() so it can equal the Task lifecycle timestamp written in the same command. Raises PT409 assignment_not_active when the Assignment is unknown or already ended.';

create function private.close_task_queue(p_task_id bigint, p_decided_by uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_members uuid[];
begin
  update public.tasks set queue_closed_at = now()
   where id = p_task_id and assignment_mode = 'public' and queue_closed_at is null;
  with closed as (
    update public.task_candidates
       set status = 'closed', decided_at = now(), decided_by = p_decided_by
     where task_id = p_task_id and status = 'pending'
    returning member_id)
  select coalesce(array_agg(member_id), '{}') into v_members from closed;
  return v_members;
end;
$$;

comment on function private.close_task_queue(bigint, uuid) is
  'Closes a public Task''s Candidate Queue (idempotent: a direct Task or an already-closed queue is a no-op) and marks every still-pending Candidature closed, returning those member ids so the caller can notify them. p_decided_by may be null for an automatic close, per task_candidates_decision_shape_ck. Every terminal transition on a public Task must call this -- tasks_queue_timestamp_state_check requires queue_closed_at on completed/unfulfilled/cancelled.';

-- ==================== create_task ====================
create function private.create_task_impl(
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
    select * into v_parent from public.tasks where id = p_parent_task_id for update;
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

comment on function private.create_task_impl(text, text, timestamptz, text, text, bigint, text, text, uuid, bigint, bigint, text) is
  'Creates one Task, Subtask or Umbrella for an Origin the live caller manages; the actor is auth.uid(), never a parameter. A Subtask locks its Umbrella FOR UPDATE first and inherits its Origin -- caller-supplied Origin parameters must be null or identical (PT400 subtask_origin_mismatch), and the Umbrella must be a live, non-terminal Umbrella (PT409 parent_not_umbrella / parent_terminal). An ordinary Task requires a deadline, an Audience and an Assignment Mode; a public one opens its Candidate Queue and refuses an Executor; an Umbrella refuses Audience, Assignment Mode, Executor and Campaign. A direct Executor may be any live activ member, inside the Origin or not. Writes the created activity row, and (with an Executor) the Assignment, its executor_assigned row and the Executor''s notification. The #314 Campaign trigger''s two 23514 reasons are mapped to PT400 invalid_campaign; every other 23514 propagates.';

create function public.create_task(
  p_title text, p_description text, p_deadline timestamptz,
  p_dept_id text, p_team_id text, p_project_id bigint,
  p_audience text, p_assignment_mode text,
  p_executor_id uuid default null, p_campaign_id bigint default null,
  p_parent_task_id bigint default null, p_kind text default 'task')
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.create_task_impl(p_title, p_description, p_deadline, p_dept_id, p_team_id, p_project_id,
                                  p_audience, p_assignment_mode, p_executor_id, p_campaign_id, p_parent_task_id, p_kind);
$$;

comment on function public.create_task(text, text, timestamptz, text, text, bigint, text, text, uuid, bigint, bigint, text) is
  'Creates a Task, Subtask or Umbrella; callable only by a live active member who manages the Origin -- BC/Moderator anywhere, the local BCE of a Department or of a Department-Team''s parent Department, any active member of an Independent Team, or an active Project''s lead or Responsible.';

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.can_evaluate_task(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function private.require_task_visible(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function private.require_origin_manager(text, text, bigint)
  from public, anon, authenticated, service_role;
revoke execute on function private.require_task_manager(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function private.require_task_evaluator(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function private.require_task_executor(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function private.log_task_activity(bigint, text, uuid, bigint, public.task_status, public.task_status, text, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function private.open_task_assignment(bigint, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function private.end_task_assignment(bigint, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function private.close_task_queue(bigint, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.create_task_impl(text, text, timestamptz, text, text, bigint, text, text, uuid, bigint, bigint, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.create_task(text, text, timestamptz, text, text, bigint, text, text, uuid, bigint, bigint, text)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;

-- Only the predicate (it answers policies as the caller), the _impl (called by
-- the invoker wrapper as the caller) and the wrapper get a grant back. Every
-- require_* helper and every internal writer stays callable only by the
-- security definer commands that own them.
grant execute on function private.can_evaluate_task(bigint) to authenticated;
grant execute on function private.create_task_impl(text, text, timestamptz, text, text, bigint, text, text, uuid, bigint, bigint, text)
  to authenticated;
grant execute on function public.create_task(text, text, timestamptz, text, text, bigint, text, text, uuid, bigint, bigint, text)
  to authenticated;
