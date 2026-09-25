-- #682: the Candidate Queue never promotes -- interest only queues, the Task Manager selects.
--
-- Ruling R9 of the 2026-09-23 grill and ADR-0007's amendment of the same day:
-- nobody becomes Executor of a public Task by arriving first, and nobody is
-- handed a Task because the Executor ahead of them left it. Expressing interest
-- always adds a pending Candidate; give_up_task and update_task never open an
-- Assignment for a Candidate; private.select_task_candidate_impl stays the only
-- way an Executor is chosen on a public Task.
--
-- Every body below is `create or replace`, rebuilt from main's latest catalog
-- definition (#627's task_group_change, #673's constraints kit and #675's
-- Nickname re-issues included). No signature changes, so the grants and the
-- tracker_grants roster are untouched. task_activity.details is jsonb, so
-- history rows written before this migration keep the retired `via` values and
-- `candidate_promoted` consequences; nothing rewrites them.

-- ---------------------------------------------------------------------------
-- private.open_task_assignment: the retired paths leave the allow-list.
-- ---------------------------------------------------------------------------
create or replace function private.open_task_assignment(
  p_task_id bigint, p_member_id uuid, p_actor uuid, p_via text)
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
  -- text. A null or unknown via -- including the two arrival-based paths
  -- #682 retired -- is a caller bug, not a silent no-notification.
  if p_via is null or p_via not in
     ('create', 'assign', 'select', 'reopen', 'request_approval') then
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
  -- 'reopen' reactivates a past Executor and sends its own "Task redeschis"
  -- notification; every other path announces the new Task. `is distinct
  -- from` (not `<>`) so a null p_via -- already rejected above, but kept
  -- explicit here for defense in depth -- cannot silently skip it.
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
  'Opens the one active Assignment for a Task, writes its executor_assigned activity row (details.via records how: create, assign, select, reopen, request_approval -- a closed allow-list, PT400 invalid_assignment_via otherwise; #682 retired the two arrival-based paths, so on a public Task only select_task_candidate, reopen_task and a request approval open one) and, except for a reopen, sends the new Executor the pinned "Task nou" notification. Raises PT400 invalid_executor for a member who is not a live activ profile. Relies on task_assignments_one_active_per_task_uidx as the last-resort race guard -- callers serialize on the tasks row lock first.';

-- ---------------------------------------------------------------------------
-- private.express_task_interest_impl: every accepted call queues.
-- ---------------------------------------------------------------------------
create or replace function private.express_task_interest_impl(p_task_id bigint)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
  v_executor uuid;
  v_candidate_id bigint;
  v_position integer;
  v_pending integer;
begin
  -- 2. Gate + visibility
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked -- concurrent joins
  --    serialize here, so positions and the coalesced count never race)
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: the Audience rule, re-validated against live
  --    rows and holding them FOR SHARE.
  perform 1 from public.profiles as profile
   where profile.id = v_actor and profile.status = 'activ' for share;
  if not found then
    raise exception using errcode = '42501', message = 'task_command_forbidden';
  end if;
  if v_task.audience = 'local' then
    -- A local Opportunity admits the members of its own Group (ADR-0009): an explicit
    -- roster row of any Group Role, or Automatic Membership at or above the Group's
    -- Minimum Level -- private.is_group_member, the test can_read_task and update_task
    -- (R-E8) apply. The actor's roster row, when there is one, is held FOR SHARE so a
    -- concurrent removal cannot race the check; never a lock on the groups row.
    perform 1 from public.group_members as membership
     where membership.group_id = v_task.group_id and membership.member_id = v_actor
     for share of membership;
    if not coalesce(private.is_group_member(v_task.group_id, v_actor), false) then
      raise exception using errcode = '42501', message = 'task_audience_forbidden';
    end if;
  end if;
  -- 5. Input validation: the only parameter is the target itself, already
  --    resolved by require_task_visible.
  -- 6. State preconditions (PT409) -- umbrella first.
  if v_task.kind = 'umbrella' then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  if v_task.assignment_mode is distinct from 'public' then
    raise sqlstate 'PT409' using message = 'task_not_public';
  end if;
  if v_task.status in ('completed', 'unfulfilled', 'cancelled') then
    raise sqlstate 'PT409' using message = 'task_terminal';
  end if;
  if v_task.queue_closed_at is not null then
    raise sqlstate 'PT409' using message = 'task_queue_closed';
  end if;
  -- Read under the Task lock: the Executor the manager selected may not also
  -- queue for their own Task.
  select assignment.member_id into v_executor
    from public.task_assignments as assignment
   where assignment.task_id = p_task_id and assignment.ended_at is null
   for update;
  if v_executor = v_actor then
    raise sqlstate 'PT409' using message = 'already_executor';
  end if;
  if exists (select 1 from public.task_candidates as candidate
              where candidate.task_id = p_task_id
                and candidate.member_id = v_actor
                and candidate.status = 'pending') then
    raise sqlstate 'PT409' using message = 'already_candidate';
  end if;
  -- 7. Mutate, then activity, then notify, then return. Always a pending
  --    Candidate, whether or not the Task has an Executor (#682, R9).
  insert into public.task_candidates (task_id, member_id, status, joined_at)
  values (p_task_id, v_actor, 'pending', now())
  returning id into v_candidate_id;
  -- After the insert, by contract: the position is the one the Member
  -- actually joined at. queue_position is self-gated but answers for the
  -- caller's own id, which is exactly v_actor here.
  v_position := private.queue_position(p_task_id, v_actor);
  perform private.log_task_activity(p_task_id, 'interest_expressed', v_actor, null, null, null, null,
    jsonb_build_object('position', v_position, 'candidate_id', v_candidate_id));
  v_pending := private.pending_candidate_count(p_task_id);
  perform private.notify(
    array(select private.task_managers(p_task_id, v_actor)),
    'task'::public.noti_kind,
    'Coadă: ' || v_task.title,
    case when v_pending = 1 then '1 candidat în așteptare.'
         when v_pending < 20 then v_pending::text || ' candidați în așteptare.'
         else v_pending::text || ' de candidați în așteptare.' end,
    p_task_id, 'task:' || p_task_id::text || ':queue', v_actor);
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

comment on function private.express_task_interest_impl(bigint) is
  'A Member joins a public Task''s Candidate Queue; the actor is auth.uid(), never a parameter. Every accepted call inserts a pending Candidate at the end of the arrival order, logs interest_expressed with details.position and details.candidate_id, and coalesces the managers'' "Coadă" notification under task:<id>:queue -- nobody becomes Executor by arriving first (#682, ruling R9); the Task Manager selects with select_task_candidate. The tasks row is locked FOR UPDATE before any Assignment or Candidature is read, so concurrent callers serialize. Refusals in order: task_is_umbrella, task_not_public, task_terminal, task_queue_closed, already_executor, already_candidate. A local Opportunity admits only members of the Task''s own Group (private.is_group_member, 42501 task_audience_forbidden), the caller''s roster row held FOR SHARE.';

comment on function public.express_task_interest(bigint) is
  'Express interest in a public Task: the caller joins the end of its ordered Candidate Queue as a pending Candidate, and the Task Manager chooses the Executor from the queue (#682). Callable by any live active Member who can read the Task; a local-Audience Opportunity additionally requires membership of its Group.';

-- ---------------------------------------------------------------------------
-- private.give_up_task_impl: no promotion; a public Task returns to todo.
-- ---------------------------------------------------------------------------
create or replace function private.give_up_task_impl(p_task_id bigint, p_reason text)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
  v_reason text;
  v_assignment_id bigint;
  v_actor_name text;
  v_from public.task_status;
  v_to public.task_status;
begin
  -- 1. Malformed for everyone: no reason, no give-up -- checked before the
  --    gate, so a claimless caller gets PT400 too.
  if p_reason is null or p_reason !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'reason_required';
  end if;
  v_reason := regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  -- #673 (R8): measured as stored (trimmed).
  perform private.require_text_length('reason', v_reason, null, 1000);
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked -- the serialization
  --    point this command shares with express_task_interest).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: being the live active Executor IS the authority.
  --    The helper locks the active Assignment FOR UPDATE and the actor's
  --    profile FOR SHARE, so a concurrent deactivation serializes behind this
  --    command rather than committing underneath it (#343 / #390).
  v_assignment_id := private.require_task_executor(p_task_id);
  -- 5. Input validation: p_reason, the only parameter besides the target, was
  --    validated at step 1.
  -- 6. State preconditions (PT409).
  if v_task.status not in ('todo', 'in_progress') then
    raise sqlstate 'PT409' using message = 'task_not_in_progress';
  end if;
  -- 7. Mutate: end the Assignment; a public Task goes back to todo with its
  --    Candidate Queue untouched, for the manager to select again (#682, R9).
  --    review_round and returned_to_progress_at stay, as in reopen_task. A
  --    direct Task keeps its status and waits for assign_task_executor.
  perform private.end_task_assignment(v_assignment_id, 'gave_up', v_reason);
  if v_task.assignment_mode = 'public' and v_task.status <> 'todo' then
    update public.tasks
       set status = 'todo', started_at = null
     where id = p_task_id;
    v_from := v_task.status;
    v_to := 'todo';
  end if;
  perform private.log_task_activity(p_task_id, 'gave_up', v_actor, v_assignment_id, v_from, v_to,
    v_reason, jsonb_build_object('reason', v_reason));

  select coalesce(profile.nickname, profile.full_name) into v_actor_name
    from public.profiles as profile where profile.id = v_actor;
  perform private.notify(
    array(select private.task_managers(p_task_id, v_actor)),
    'task'::public.noti_kind,
    'Renunțare: ' || v_task.title,
    v_actor_name || ' a renunțat: ' || v_reason,
    p_task_id, null, v_actor);

  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

comment on function private.give_up_task_impl(bigint, text) is
  'The Task''s active Executor leaves it, giving a required reason; the actor is auth.uid(), never a parameter. A blank or null reason is PT400 reason_required (reason_too_long over 1000 characters), raised before the membership gate because the input is malformed for every caller. The tasks row is locked FOR UPDATE before any Assignment or Candidature state is read, so a concurrent express_task_interest serializes behind the give-up. private.require_task_executor is the entire authority rule (42501 task_executor_forbidden for a manager, a past Executor, or a second give-up); the status must be todo or in_progress (PT409 task_not_in_progress). Ends the Assignment with end_reason ''gave_up'' and the trimmed reason as its end_note. No Candidate is ever promoted (#682, ruling R9): a public Task returns to todo with started_at cleared and its Candidate Queue untouched, and the gave_up activity row (the ENDED Assignment''s id, note and details.reason) carries from_status/to_status when the status changed; a direct Task keeps its status with no Executor, which assign_task_executor remedies. The Task''s managers get the pinned ''Renunțare'' notification and select the next Executor themselves.';

comment on function public.give_up_task(bigint, text) is
  'Leave a Task you hold as its Executor, stating why. Callable only by the Task''s live active Executor (42501 task_executor_forbidden otherwise) while the Task is todo or in_progress (PT409 task_not_in_progress); PT400 reason_required for a blank reason. Nobody is promoted into the freed slot: a public Task returns to todo with its Candidate Queue intact and its managers, notified, select the next Executor with select_task_candidate; a direct Task is left without an Executor for a manager to reassign.';

-- ---------------------------------------------------------------------------
-- private.task_update_consequences: no candidate_promoted row.
-- ---------------------------------------------------------------------------
create or replace function private.task_update_consequences(
  p_task_id bigint, p_group_id bigint, p_campaign_id bigint, p_assignment_mode text, p_audience text)
returns table(consequence text, member_id uuid)
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
  )
  select consequences.consequence, consequences.member_id from consequences
   order by consequences.rank, consequences.joined_at, consequences.candidate_id;
$$;

comment on function private.task_update_consequences(bigint, bigint, bigint, text, text) is
  'One shared #627 preview/command consequence definition. On a move: an eligible Executor outside the target roster is appointed; one below target Minimum Level loses the Assignment; pending Candidates below target Minimum Level leave the queue; an incompatible existing Campaign is cleared. Explicit Audience narrowing removes a non-member Executor and non-member Candidates; Public -> Direct closes every pending Candidature. No Candidate is ever promoted (#682): a removed Executor leaves the Task todo with its remaining queue intact for the manager to select from. Stable; no writes or locks.';

-- ---------------------------------------------------------------------------
-- private.update_task_impl: the promotion block is gone.
-- ---------------------------------------------------------------------------
create or replace function private.update_task_impl(
  p_task_id bigint, p_group_id bigint, p_title text, p_description text,
  p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text,
  p_audience text, p_accept_consequences boolean)
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
  v_closed uuid[] := '{}'::uuid[];
  v_assignment_id bigint;
  v_executor uuid;
  v_mode_changed boolean;
  v_group_changed boolean;
  v_from public.task_status;
  v_to public.task_status;
  v_details jsonb;
  v_constraint text;
begin
  -- 1. #673 (R8): malformed for every caller, measured as stored (trimmed).
  --    No deadline_in_past here: R8 judges the deadline only at creation.
  perform private.require_text_length('title',
    regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g'), 3, 120);
  perform private.require_text_length('description',
    regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 2000);
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. The locks. This unlocked read only learns WHICH parent to lock first;
  --    every decision below is made from the locked rows. Both rows FOR NO
  --    KEY UPDATE, never FOR UPDATE (conventions section 2).
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
         (array_agg((e ->> 'member_id')::uuid) filter (where e ->> 'consequence' = 'executor_added_to_group'))[1]
    into v_removed_candidates, v_removed_executor, v_added_executor
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
  -- A removed Executor leaves the Task todo; the remaining queue is left
  -- exactly as it is for the manager to select from (#682, R9).
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
  select assignment.member_id into v_executor
    from public.task_assignments as assignment
   where assignment.task_id = p_task_id and assignment.ended_at is null;
  if v_executor is not null then
    perform private.notify(array[v_executor], 'task'::public.noti_kind,
      'Task actualizat: ' || v_task.title,
      'Modificat: ' || array_to_string(array(select jsonb_array_elements_text(v_plan -> 'changed')), ', ') || '.',
      p_task_id, null, v_actor);
  end if;
  return v_task;
end;
$$;

comment on function private.update_task_impl(bigint, bigint, text, text, timestamp with time zone, bigint, text, text, boolean) is
  'Atomic #627 full-state Task update. Locks Umbrella then Task FOR NO KEY UPDATE; for a move, authorizes both Groups, locks both Groups in ID order, rechecks authority, and holds Executor/Candidate Profiles FOR SHARE before applying the shared consequence plan. PT409 task_update_needs_confirmation protects every listed consequence. Uses the #583 Appointment core, ends an ineligible Assignment (group_changed on a move, task_updated on Audience narrowing) and returns the Task to todo, closes ineligible Candidatures, clears an incompatible Campaign, and logs one task_updated activity with the accepted consequences and field diff. No Candidate is ever promoted (#682): the remaining queue stays pending for the manager to select from.';

comment on function public.preview_task_update(bigint, bigint, text, text, timestamp with time zone, bigint, text, text) is
  'Lists public.update_task consequences for the same full state without writes: executor_added_to_group, executor_removed, candidate_removed, and campaign_cleared (null member_id). No edit promotes a Candidate (#682). Refuses the same invalid state or authority.';
