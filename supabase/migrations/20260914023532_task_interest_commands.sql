-- #330: express_task_interest / withdraw_task_interest -- the Candidate Queue
-- of a public Task, and the first-come rule that fills its one Executor slot.
--
-- The safety property this migration exists for (ADR-0007 Sec Assignment and
-- candidate queue): the FIRST eligible Member to express interest becomes the
-- Executor; every later one queues behind them. The serialization point is
-- the `select ... from public.tasks where id = p_task_id for update` in step
-- 3 -- taken before any Assignment or Candidature state is read. Two sessions
-- racing on a fresh Opportunity therefore go: A takes the lock, sees no
-- active Assignment, opens one, commits; B BLOCKS on the lock, wakes,
-- re-reads under a fresh READ COMMITTED snapshot, sees A's Assignment and
-- queues. B never reaches task_assignments_one_active_per_task_uidx, so it
-- never surfaces a raw 23505 unique_violation to its caller -- that index
-- stays what #289 called it, the last-resort guard behind the lock, not the
-- mechanism. task_interest.test.sql section 9 asserts b_waited = true and the
-- resulting end state; if a future edit reads assignment state before the
-- lock, that assertion is what fails.
--
-- Queue order is DERIVED, never stored: task_candidates has no position
-- column (#290), order is (joined_at, id), and private.queue_position answers
-- it. Three consequences the commands rely on, rather than maintaining any
-- ordering themselves:
--   - withdrawing the Candidate at position 1 promotes position 2 to 1 for
--     free -- no renumbering pass exists, or is needed;
--   - rejoining after a withdrawal is a NEW pending row at the END of the
--     order, which task_candidates_one_pending_per_member_uidx permits
--     precisely because it is partial (`where status = 'pending'`);
--   - details.position on an interest_expressed row is a point-in-time fact
--     about when the Member joined, not a live pointer -- it is computed
--     AFTER the insert and never revised.
--
-- Step order (stack-context.md, binding) with the two local precedence
-- decisions this command had to make:
--   - Step 4's authority check is the AUDIENCE rule. A local Opportunity
--     admits only Members of its own Origin (ADR-0007), so a caller who can
--     READ the Task some other way -- a BCE elsewhere via R1, say -- is still
--     42501 task_audience_forbidden. It sits at step 4, under the lock and
--     holding the same FOR SHARE re-validation locks as
--     private.require_origin_manager (the actor's profile plus the one
--     membership row the eligibility rests on), so a concurrent deactivation
--     or membership revocation serializes behind the command rather than
--     committing underneath a decision it already made (#343 / #390).
--   - Step 6's PT409 checks run umbrella-first, then not-public, then
--     terminal, then queue-closed. The brief lists the four reasons but not
--     an order; this one is forced by reachability, since an Umbrella has a
--     NULL assignment_mode (tasks_umbrella_shape_ck) and would otherwise
--     always answer task_not_public and never task_is_umbrella.
--
-- Visibility stays the outer gate: a Task the caller cannot read is PT404
-- task_not_found from private.require_task_visible before any of the above,
-- so "invisible" and "missing" remain indistinguishable (conventions Sec3).
-- Closing a queue already hides the Opportunity from non-participants
-- (private.can_read_task R6), so task_queue_closed is only ever reachable by
-- a caller who can read the Task some other way.
--
-- Notifications, both under the pinned copy (stack-context.md):
--   - first come: task_managers get 'Executor nou: {title}' /
--     '{name} a preluat taskul.', uncoalesced. private.open_task_assignment
--     also sends the new Executor the 'Task nou' row, but private.notify
--     drops the actor -- so a Member assigning themselves is told nothing,
--     which is correct and is asserted, not incidental.
--   - every join and every withdrawal: task_managers get 'Coadă: {title}' /
--     '{n} candidați în așteptare.' under dedupe_key 'task:{id}:queue', so
--     one unread manager row tracks the live pending count instead of one
--     row per event. n is private.pending_candidate_count computed AFTER the
--     write, inside the same lock.

-- ==================== express_task_interest ====================
create function private.express_task_interest_impl(p_task_id bigint)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
  v_eligible boolean;
  v_executor uuid;
  v_actor_name text;
  v_candidate_id bigint;
  v_position integer;
  v_pending integer;
begin
  -- 2. Gate + visibility
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked -- the serialization
  --    point for the whole first-come race)
  select * into v_task from public.tasks where id = p_task_id for update;
  -- 4. Authority under lock: the Audience rule, re-validated against live
  --    rows and holding them FOR SHARE (require_origin_manager's discipline).
  perform 1 from public.profiles as profile
   where profile.id = v_actor and profile.status = 'activ' for share;
  if not found then
    raise exception using errcode = '42501', message = 'task_command_forbidden';
  end if;
  if v_task.audience = 'local' then
    v_eligible := false;
    if v_task.dept_id is not null then
      perform 1 from public.member_departments as membership
       where membership.member_id = v_actor and membership.dept_id = v_task.dept_id for share;
      v_eligible := found;
    elsif v_task.team_id is not null then
      perform 1 from public.team_members as membership
       where membership.member_id = v_actor and membership.team_id = v_task.team_id for share;
      v_eligible := found;
    elsif v_task.project_id is not null then
      perform 1 from public.project_members as membership
       where membership.project_id = v_task.project_id and membership.member_id = v_actor for share;
      v_eligible := found;
    end if;
    if not v_eligible then
      raise exception using errcode = '42501', message = 'task_audience_forbidden';
    end if;
  end if;
  -- 5. Input validation: the only parameter is the target itself, already
  --    resolved by require_task_visible.
  -- 6. State preconditions (PT409) -- umbrella first, see the header.
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
  -- Read under the Task lock, never before it: this is the branch the race
  -- turns on.
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
  -- 7. Mutate, then activity, then notify, then return
  select profile.full_name into v_actor_name
    from public.profiles as profile where profile.id = v_actor;
  if v_executor is null then
    -- First come: the kit writes the Assignment, its executor_assigned row
    -- (assignment_id set, details.via = 'first_come') and the Executor's own
    -- 'Task nou' notification -- which private.notify then drops, the actor
    -- being the recipient.
    perform private.open_task_assignment(p_task_id, v_actor, v_actor, 'first_come');
    perform private.notify(
      array(select private.task_managers(p_task_id, v_actor)),
      'task'::public.noti_kind,
      'Executor nou: ' || v_task.title,
      v_actor_name || ' a preluat taskul.',
      p_task_id, null, v_actor);
  else
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
      v_pending::text || ' candidați în așteptare.',
      p_task_id, 'task:' || p_task_id::text || ':queue', v_actor);
  end if;
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

comment on function private.express_task_interest_impl(bigint) is
  'A Member takes a public Task or joins its Candidate Queue; the actor is auth.uid(), never a parameter. The tasks row is locked FOR UPDATE before any Assignment state is read, so concurrent callers serialize: the first opens the one Assignment (private.open_task_assignment via = ''first_come''), every later one inserts a pending Candidature -- the second session blocks on the lock and never reaches task_assignments_one_active_per_task_uidx, so it can never surface a raw unique_violation. Refuses an Umbrella (PT409 task_is_umbrella), a direct-mode Task (task_not_public), a terminal Task (task_terminal), a closed queue (task_queue_closed), the Task''s own active Executor (already_executor) and a Member who already holds a live pending Candidature (already_candidate) -- in that order, umbrella first because an Umbrella''s assignment_mode is null. A local-Audience Opportunity admits only Members of its own Origin (42501 task_audience_forbidden), checked under the lock while holding the actor''s profile and that membership row FOR SHARE. A Task the caller cannot read is PT404 task_not_found first. First come notifies the Task''s managers (''Executor nou'') and, because private.notify drops the actor, tells the new Executor nothing; a join writes an interest_expressed row (assignment_id null -- candidate rows must never carry one -- details.position computed after the insert) and coalesces the managers'' queue notification under dedupe_key task:<id>:queue.';

create function public.express_task_interest(p_task_id bigint)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.express_task_interest_impl(p_task_id);
$$;

comment on function public.express_task_interest(bigint) is
  'Express interest in a public Task: the first eligible Member becomes its Executor, later ones join the ordered Candidate Queue. Callable by any live active Member who can read the Task; a local-Audience Opportunity additionally requires membership of its Origin.';

-- ==================== withdraw_task_interest ====================
-- Deliberately narrower than its sibling: being a live pending Candidate IS
-- the authority, so there is no Audience check (the Member is already in the
-- queue), no kind/mode/status precondition, and one PT409 reason. Every
-- "cannot withdraw" case collapses into it naturally -- a closed queue has
-- already moved every pending row to 'closed' (private.close_task_queue), a
-- terminal Task has closed its queue, and the Executor never had a pending
-- row to begin with (leaving a Task one holds is #331's give_up_task).
create function private.withdraw_task_interest_impl(p_task_id bigint)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
  v_candidate_id bigint;
  v_pending integer;
begin
  -- 2. Gate + visibility
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked)
  select * into v_task from public.tasks where id = p_task_id for update;
  -- 4. Authority under lock: a live activ profile, held FOR SHARE.
  perform 1 from public.profiles as profile
   where profile.id = v_actor and profile.status = 'activ' for share;
  if not found then
    raise exception using errcode = '42501', message = 'task_command_forbidden';
  end if;
  -- 5/6. The one state precondition doubles as the authority: only the
  --      Member's own live pending Candidature may be withdrawn. The UPDATE
  --      is the check -- two concurrent withdrawals serialize on the Task
  --      lock and the second matches no pending row.
  update public.task_candidates as candidate
     set status = 'withdrawn', decided_at = now(), decided_by = v_actor
   where candidate.task_id = p_task_id
     and candidate.member_id = v_actor
     and candidate.status = 'pending'
  returning candidate.id into v_candidate_id;
  if v_candidate_id is null then
    raise sqlstate 'PT409' using message = 'not_a_candidate';
  end if;
  -- 7. Activity, then notify, then return
  v_pending := private.pending_candidate_count(p_task_id);
  perform private.log_task_activity(p_task_id, 'interest_withdrawn', v_actor, null, null, null, null,
    jsonb_build_object('candidate_id', v_candidate_id, 'pending_count', v_pending));
  perform private.notify(
    array(select private.task_managers(p_task_id, v_actor)),
    'task'::public.noti_kind,
    'Coadă: ' || v_task.title,
    v_pending::text || ' candidați în așteptare.',
    p_task_id, 'task:' || p_task_id::text || ':queue', v_actor);
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

comment on function private.withdraw_task_interest_impl(bigint) is
  'A Member leaves a public Task''s Candidate Queue; the actor is auth.uid(), never a parameter. Marks their own live pending Candidature withdrawn with decided_at = now() and decided_by = the Member themselves (task_candidates_decision_shape_ck), writes one interest_withdrawn activity row (assignment_id null) and rewrites the managers'' coalesced queue notification under dedupe_key task:<id>:queue to the new pending count. Raises PT409 not_a_candidate when there is no live pending Candidature -- which is also the answer for a closed or terminal queue (its rows are already ''closed'') and for the Task''s Executor (leaving a Task one holds is #331''s give_up_task). Queue order is derived from (joined_at, id), so a withdrawal promotes everyone behind the Member with no renumbering, and a later rejoin is a new row at the end of the order.';

create function public.withdraw_task_interest(p_task_id bigint)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.withdraw_task_interest_impl(p_task_id);
$$;

comment on function public.withdraw_task_interest(bigint) is
  'Leave a public Task''s Candidate Queue. Callable by any live active Member holding a pending Candidature for the Task; PT409 not_a_candidate otherwise. Rejoining later is permitted and lands at the end of the queue.';

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.express_task_interest_impl(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.express_task_interest(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function private.withdraw_task_interest_impl(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.withdraw_task_interest(bigint)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;

grant execute on function private.express_task_interest_impl(bigint) to authenticated;
grant execute on function public.express_task_interest(bigint) to authenticated;
grant execute on function private.withdraw_task_interest_impl(bigint) to authenticated;
grant execute on function public.withdraw_task_interest(bigint) to authenticated;
