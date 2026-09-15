-- #344: the three Completed-work Request commands -- create, approve, reject --
-- and private.require_request_decider, the narrower authority they turn on
-- (ADR-0007 Sec "Completed-work requests").
--
-- Approval is the only place in the Tracker where a Task is born already
-- finished: in ONE transaction it inserts the Task, hands it to the requester
-- as an Assignment, evaluates it through the shared private.evaluate_task core
-- (#336) and stamps the decision on the Request. Either all of that happens or
-- none of it does.
--
-- ==================== Why deciding is not managing ====================
-- 20260911210800_completed_work_requests.sql's header asked #344 NOT to reuse
-- private.can_manage_origin for the decision, and this migration honours that.
-- The decider set is:
--
--   Department                -> every live local BCE of that Department
--   Department-Team           -> every live local BCE of its PARENT Department
--   Independent Team          -> nobody local at all
--   Project                   -> the lead of an ACTIVE Project, and only them
--   ...plus, in all four cases, every live BC/Moderator.
--
-- Two deliberate narrowings versus private.can_manage_origin: a Project
-- Responsible manages (and reads) the Project's Requests but never decides
-- one, and an Independent Team's members jointly manage their own work yet
-- have no decider among them. The BC/Moderator branch here is a NAMED decider
-- in all four shapes, not private.task_managers' last-resort fallback -- it is
-- the only decider an Independent-Team Request has at all.
--
-- The Project branch requires an ACTIVE Project, the same way
-- private.can_evaluate_task's Project branch does (Stack C Ruling 17). It is
-- tempting to leave that filter out -- #344's ruling names
-- private.is_project_lead, which answers relationship identity rather than
-- current authority (#271) -- and to lean on the visibility gate ahead of this
-- predicate, whose Project branch runs through private.can_manage_project_work
-- and IS active-only. That reasoning does not hold, and the counterexample is
-- worth writing down rather than rediscovering: the visibility test is a
-- DISJUNCTION -- `requester_id = auth.uid() or private.can_manage_origin(...)`.
-- When the lead IS the requester the first disjunct is already true,
-- can_manage_project_work is never evaluated, and control reaches this
-- predicate. And private.sync_project_leader_membership (#272) auto-adds every
-- leader to project_members, so the path is reachable, not theoretical: a lead
-- files a Request on their live Project, the Project is archived under them,
-- and they self-approve -- minting a completed Task, an Evaluation and a
-- points_ledger credit on an ARCHIVED Project, which private.can_evaluate_task
-- refuses on the Task path. The `project.status = 'active'` test closes that
-- and keeps the two surfaces agreeing. A Request stranded by an archive is
-- still decidable by BC/Moderator, who clear both gates on role level alone.
-- The suite pins all three shapes: the archived Project's lead as a stranger
-- (PT404), the archived Project's lead as the Request's own requester (42501),
-- and the BC (lives_ok).
--
-- ==================== The decider predicate is written twice, on purpose ====================
-- create_completed_work_request_impl needs the decider SET (to notify it);
-- private.require_request_decider needs the same rule as a membership test for
-- ONE actor. #344 pins both shapes and pins the roster at four new functions,
-- so the predicate is spelled out in both places, character-for-character
-- identical except for the `and decider.id = v_actor` the second one adds.
-- What keeps them from drifting is not the SQL, it is
-- supabase/tests/completed_work_request_commands.test.sql: for every Origin
-- shape it asserts the EXACT notified recipient set with set_eq, and then has
-- every member of that set really approve a Request. Change one copy and one
-- of those two halves goes red.
--
-- ==================== Visibility: the read policy, not the decider set ====================
-- approve/reject answer PT404 request_not_found to anyone who cannot READ the
-- Request, and 42501 request_decide_forbidden to someone who can read it but
-- may not decide it. The boundary is deliberately completed_work_requests_read
-- (#321) -- `requester_id = auth.uid() or private.can_manage_origin(...)` --
-- and not the decider set:
--   - A Project Responsible and an Independent-Team member can already SELECT
--     these rows through PostgREST. Telling them "not found" from the command
--     would be a lie the very next query contradicts, and conventions Sec3's
--     rule is "never let a caller distinguish hidden from missing", not "hide
--     everything you may not act on".
--   - It keeps the two surfaces single-sourced: the command's PT404 boundary
--     IS the policy's USING clause, evaluated through the same predicate.
-- A caller outside both -- a Member of another Department, a BCE of another
-- Department -- learns nothing: missing and unreadable are the same answer.
--
-- ==================== Step order ====================
-- conventions Sec2, with the #336 precedent for the note:
--   1. Malformed-for-everyone input first, BEFORE the gate: Difficulty and
--      Rating outside 1..5 (approve), the required note (approve and reject),
--      and BOTH the description and the exactly-one-Origin shape (create).
--      Every one of those answers is independent of any row and of who is
--      asking -- completed_work_requests_description_ck,
--      completed_work_requests_origin_ck and task_evaluations_note_ck make
--      them impossible for every caller -- so they are raised here rather than
--      discovered after the gate and the locks, and none of them leaks
--      anything. Both commands name the blank note PT400 note_required: at
--      this point it is the COMMAND's own input being validated, not the
--      Evaluation core's, so the two adjacent buttons answer with one string.
--      (private.evaluate_task keeps its own evaluation_note_required, which is
--      still the right reason for its other callers.) That also makes a
--      non-blank note effectively REQUIRED on approval even though
--      completed_work_requests_approved_shape_ck would allow decision_note to
--      be null; the note the decider must write for the Evaluation is the one
--      stored as the decision note, rather than asking for two.
--   2. Gate: a live activ Member with organisation claims (42501
--      request_command_forbidden).
--   3. Lock the Request row FOR UPDATE, with the `if not found` PT404 guard.
--      This is the serialization point the double-approval race turns on.
--   4. Visibility (PT404), then authority under that lock
--      (private.require_request_decider, which takes the FOR SHARE
--      re-validation locks).
--   5/6. Input already validated in step 1; state precondition status =
--      'pending' (PT409 request_not_pending).
--   7. Mutate, then activity, then notifications.
--
-- A null p_request_id is PT404 request_not_found, not PT400 -- the wave's
-- standing ruling, and it falls out of `where id = null` finding no row.
--
-- ==================== Executor / Candidate coexistence ====================
-- The wave's standing rule is that nothing may leave a Member simultaneously
-- the active Executor and a pending Candidate on one Task, and #344 was named
-- as a command that must not create that state. Here it is unreachable by
-- construction rather than by a guard: the Task is INSERTed inside this
-- transaction, is `direct` (so tasks_queue_timestamp_state_check forbids it a
-- Candidate Queue), and its id does not exist for any other session until this
-- transaction commits -- by which point the Task is already `completed`. There
-- is no window in which a Candidature could be created for it, so no guard is
-- written. The suite asserts task_candidates is empty for the created Task.

-- ==================== private.require_request_decider ====================
create function private.require_request_decider(p_request_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := (select auth.uid());
  v_request     public.completed_work_requests%rowtype;
  v_level       integer;
  v_parent_dept text;
begin
  -- The caller already holds this row FOR UPDATE; this read only fetches it.
  select * into v_request from public.completed_work_requests where id = p_request_id;
  if not found then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;

  -- The decider predicate. Kept character-identical to the recipient query in
  -- private.create_completed_work_request_impl below, except for the actor
  -- equality -- see the migration header for why it is spelled twice and what
  -- keeps the two in step.
  if v_actor is null or not exists (
    select 1
      from public.profiles as decider
      join public.roles as decider_role on decider_role.id = decider.role
     where decider.status = 'activ'
       and decider.id = v_actor
       and (
         decider_role.level >= 6
         or (v_request.dept_id is not null and decider.role = 'bce' and exists (
               select 1 from public.member_departments as membership
                where membership.member_id = decider.id
                  and membership.dept_id = v_request.dept_id))
         or (v_request.team_id is not null and decider.role = 'bce' and exists (
               select 1 from public.teams as team
               join public.member_departments as membership on membership.dept_id = team.dept_id
              where team.id = v_request.team_id
                and team.dept_id is not null
                and membership.member_id = decider.id))
         -- Independent Team: deliberately no member branch (ADR-0007).
         or (v_request.project_id is not null and exists (
               select 1 from public.projects as project
                where project.id = v_request.project_id
                  and project.status = 'active'
                  and project.leader_id = decider.id))
         -- Project Responsible: deliberately no branch either.
       )
  ) then
    raise exception using errcode = '42501', message = 'request_decide_forbidden';
  end if;

  -- The same locked re-validation private.require_origin_manager (#327) does:
  -- hold the actor's profile row and the one membership row their authority
  -- rests on FOR SHARE, so a concurrent deactivation or revocation serializes
  -- behind this decision instead of committing underneath it.
  select role.level into v_level
    from public.profiles as profile
    join public.roles as role on role.id = profile.role
   where profile.id = v_actor and profile.status = 'activ'
   for share of profile;
  if not found then
    raise exception using errcode = '42501', message = 'request_decide_forbidden';
  end if;
  if v_level >= 6 then
    return v_actor;
  end if;

  if v_request.dept_id is not null then
    perform 1 from public.member_departments as membership
     where membership.member_id = v_actor and membership.dept_id = v_request.dept_id
     for share;
  elsif v_request.team_id is not null then
    select team.dept_id into v_parent_dept
      from public.teams as team where team.id = v_request.team_id;
    -- Below level 6 an Independent Team has no decider at all, so the
    -- predicate above already refused; this is defence in depth.
    if v_parent_dept is null then
      raise exception using errcode = '42501', message = 'request_decide_forbidden';
    end if;
    perform 1 from public.member_departments as membership
     where membership.member_id = v_actor and membership.dept_id = v_parent_dept
     for share;
  else
    perform 1 from public.projects as project
     where project.id = v_request.project_id and project.leader_id = v_actor
     for share;
  end if;
  if not found then
    raise exception using errcode = '42501', message = 'request_decide_forbidden';
  end if;
  return v_actor;
end;
$$;

comment on function private.require_request_decider(bigint) is
  'Returns auth.uid() only when the live caller may DECIDE this Completed-work Request, and holds FOR SHARE their profile row plus the membership row that authority rests on. Deliberately narrower than private.can_manage_origin (ADR-0007, and the request this file inherits from 20260911210800): BC/Moderator anywhere; the live local BCE of a Department or of a Department-Team''s parent Department; the LEAD of an ACTIVE Project only -- never a Responsible, and never an Independent Team''s own members. The Project branch tests projects.status exactly as private.can_evaluate_task does: once a Project is archived only BC/Moderator can decide its leftover Requests, including when the lead is the requester and therefore clears the command''s visibility test on that ground alone. The caller must already hold the completed_work_requests row FOR UPDATE. PT404 request_not_found for a missing Request; 42501 request_decide_forbidden otherwise.';

-- ==================== create_completed_work_request ====================
create function private.create_completed_work_request_impl(
  p_description text,
  p_dept_id     text,
  p_team_id     text,
  p_project_id  bigint)
returns public.completed_work_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := (select auth.uid());
  v_description text;
  v_actor_name  text;
  v_request     public.completed_work_requests%rowtype;
begin
  -- 1. Malformed for everyone, ahead of the gate: a blank description
  --    (completed_work_requests_description_ck refuses it) and anything other
  --    than exactly one Origin (completed_work_requests_origin_ck's own
  --    shape). Both answers are equally data-independent -- neither reads a
  --    row, neither depends on who is asking, and neither could ever succeed
  --    for any caller -- so both belong in step 1 rather than one of them
  --    being discovered after the gate.
  if p_description is null or p_description !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'description_required';
  end if;
  v_description := regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if num_nonnulls(p_dept_id, p_team_id, p_project_id) <> 1 then
    raise sqlstate 'PT400' using message = 'invalid_origin';
  end if;

  -- 2. Gate. There is no target row yet, so this is the whole of it.
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'request_command_forbidden';
  end if;
  select profile.full_name into v_actor_name
    from public.profiles as profile where profile.id = v_actor;

  -- 3. Filing is MEMBERSHIP, not management: a requester belongs to the
  --    Origin, they do not manage it (so no private.require_origin_manager
  --    here). A Project must be active -- there is no work to claim against a
  --    Project that has been wound up. A Team is tested the same way whether
  --    it is a Department Team or an Independent one: you were on it or you
  --    were not. A non-existent Origin fails this test as a non-membership,
  --    which is the same non-disclosing answer as a real Origin one does not
  --    belong to.
  if not (
    case
      when p_dept_id is not null then exists (
        select 1 from public.member_departments as membership
         where membership.member_id = v_actor and membership.dept_id = p_dept_id)
      when p_team_id is not null then exists (
        select 1 from public.team_members as membership
         where membership.member_id = v_actor and membership.team_id = p_team_id)
      else exists (
        select 1 from public.project_members as membership
          join public.projects as project on project.id = membership.project_id
         where membership.project_id = p_project_id
           and membership.member_id = v_actor
           and project.status = 'active')
    end
  ) then
    raise exception using errcode = '42501', message = 'request_origin_forbidden';
  end if;

  -- 4. Mutate.
  insert into public.completed_work_requests (requester_id, dept_id, team_id, project_id, description, status)
  values (v_actor, p_dept_id, p_team_id, p_project_id, v_description, 'pending')
  returning * into v_request;

  -- 5. Notify the deciders. THE decider query -- the one private.
  --    require_request_decider mirrors as an `exists`. private.notify drops the
  --    actor, so a requester who happens to be a decider of their own Origin
  --    (a BCE filing in their own Department, say) is never told about their
  --    own Request. Dedupe key request:{id}: a Request is decided once, so a
  --    second unread row for the same Request would only ever be noise.
  perform private.notify(
    array(
      select decider.id
        from public.profiles as decider
        join public.roles as decider_role on decider_role.id = decider.role
       where decider.status = 'activ'
         and (
           decider_role.level >= 6
           or (v_request.dept_id is not null and decider.role = 'bce' and exists (
                 select 1 from public.member_departments as membership
                  where membership.member_id = decider.id
                    and membership.dept_id = v_request.dept_id))
           or (v_request.team_id is not null and decider.role = 'bce' and exists (
                 select 1 from public.teams as team
                 join public.member_departments as membership on membership.dept_id = team.dept_id
                where team.id = v_request.team_id
                  and team.dept_id is not null
                  and membership.member_id = decider.id))
           -- Independent Team: deliberately no member branch (ADR-0007).
           or (v_request.project_id is not null and exists (
                 select 1 from public.projects as project
                  where project.id = v_request.project_id
                    and project.status = 'active'
                    and project.leader_id = decider.id))
           -- Project Responsible: deliberately no branch either.
         )
    ),
    'task'::public.noti_kind,
    'Cerere nouă: ' || left(v_description, 60),
    coalesce(v_actor_name, 'Un membru') || ' a trimis o cerere de muncă realizată.',
    null,
    'request:' || v_request.id::text,
    v_actor);

  return v_request;
end;
$$;

comment on function private.create_completed_work_request_impl(text, text, text, bigint) is
  'Files one pending Completed-work Request against exactly one Origin; the requester is auth.uid(), never a parameter. Filing is MEMBERSHIP, not management (so no private.require_origin_manager): a live activ Member of the Department, of the Team (either kind), or of an ACTIVE Project may claim work there -- 42501 request_origin_forbidden otherwise, which is also the answer for an Origin that does not exist. PT400 description_required for a blank or null description and PT400 invalid_origin for zero, two or three Origins -- both raised before the gate, because completed_work_requests_description_ck and completed_work_requests_origin_ck could never accept either from any caller -- then 42501 request_command_forbidden for a caller without organisation claims or a live activ profile. Notifies the Request''s DECIDERS -- and this is the one place that set is written out: every live BC/Moderator, plus the live local BCE of a Department or of a Department-Team''s parent Department, plus an ACTIVE Project''s lead; never a Project Responsible and never an Independent Team''s own members. private.require_request_decider mirrors this predicate as an `exists`. Dedupe key request:{id}.';

create function public.create_completed_work_request(
  p_description text,
  p_dept_id     text,
  p_team_id     text,
  p_project_id  bigint)
returns public.completed_work_requests
language sql
security invoker
set search_path = ''
as $$
  select private.create_completed_work_request_impl(p_description, p_dept_id, p_team_id, p_project_id);
$$;

comment on function public.create_completed_work_request(text, text, text, bigint) is
  'Claim recognition for work you have already finished, against exactly one Origin you BELONG to -- a Department, a Team of either kind, or an active Project. Callable by any live active Member; the Request lands pending and notifies the people who may decide it (ADR-0007). Approving it is approve_completed_work_request, which is narrower: a Project Responsible and an Independent Team''s own members may read a Request but never decide one.';

-- ==================== approve_completed_work_request ====================
create function private.approve_completed_work_request_impl(
  p_request_id bigint,
  p_difficulty integer,
  p_rating     integer,
  p_note       text)
returns public.completed_work_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := (select auth.uid());
  v_note     text;
  v_request  public.completed_work_requests%rowtype;
  v_task     public.tasks%rowtype;
  v_points   integer;
begin
  -- 1. Malformed for everyone, ahead of the gate (the #336 precedent).
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 5 then
    raise sqlstate 'PT400' using message = 'invalid_difficulty';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise sqlstate 'PT400' using message = 'invalid_rating';
  end if;
  -- note_required, not evaluation_note_required: this is the COMMAND's own
  -- input validation, the same condition and the same string reject_completed_
  -- work_request raises, so a client normalizing on the message sees one
  -- vocabulary across the two adjacent buttons. private.evaluate_task keeps
  -- its own evaluation_note_required for the callers that reach the Evaluation
  -- core directly.
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'note_required';
  end if;
  v_note := regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g');

  -- 2. Gate.
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'request_command_forbidden';
  end if;

  -- 3. Lock the target. Everything below runs under this lock, which is what
  --    makes a second concurrent approval wait and then lose cleanly.
  select * into v_request from public.completed_work_requests
   where id = p_request_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;

  -- 4. Visibility, then authority. The visibility test IS
  --    completed_work_requests_read's USING clause (see the migration header):
  --    a caller who cannot read the row is told it does not exist; a caller
  --    who can read it but may not decide it is told exactly that.
  if v_request.requester_id is distinct from v_actor
     and not coalesce(private.can_manage_origin(
           v_request.dept_id, v_request.team_id, v_request.project_id), false) then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;
  perform private.require_request_decider(p_request_id);

  -- 6. State.
  if v_request.status <> 'pending' then
    raise sqlstate 'PT409' using message = 'request_not_pending';
  end if;

  -- 7. Mutate. The Task is born finished: created now, deadline now, handed to
  --    the requester, evaluated, all inside this transaction.
  --    tasks_lifecycle_timestamp_order_check wants completed_at >= created_at;
  --    both are now(), which in one transaction is the same instant exactly.
  insert into public.tasks
    (title, description, deadline, dept_id, team_id, project_id,
     audience, assignment_mode, status, created_by)
  values (left(v_request.description, 120), v_request.description, now(),
          v_request.dept_id, v_request.team_id, v_request.project_id,
          'local', 'direct', 'todo', v_actor)
  returning * into v_task;

  perform private.log_task_activity(v_task.id, 'created', v_actor, null, null, 'todo', null,
    jsonb_build_object('from_request_id', p_request_id));

  -- 'request_approval' is in private.open_task_assignment's closed allow-list.
  -- It notifies the new Executor ("Task nou"), which for already-completed
  -- work arrives beside the Evaluation and the approval notice -- deliberate:
  -- only 'reopen' suppresses that row, and the Assignment is real history the
  -- requester should see named, not implied.
  perform private.open_task_assignment(v_task.id, v_request.requester_id, v_actor, 'request_approval');

  -- The shared Evaluation core (#336): the one place points are computed and
  -- written. It closes no queue here (a direct Task has none) and writes the
  -- Evaluation, the ledger row, the Task's terminal state, the ended
  -- Assignment, the evaluated activity row and the Executor's notification.
  perform private.evaluate_task(v_task.id, 'completed', p_difficulty, p_rating, v_note, v_actor);

  update public.completed_work_requests
     set status        = 'approved',
         decided_by    = v_actor,
         decided_at    = now(),
         decision_note = v_note,
         task_id       = v_task.id
   where id = p_request_id;

  -- Same Romanian agreement and the same bounded range as private.
  -- evaluate_task's own award notification: rating_mult maps 1..5 to
  -- -1, 0, 1, 2, 3, so with Difficulty 1..5 the award is -5..15 and only
  -- abs(points) = 1 takes the singular; the third Romanian form (`de puncte`,
  -- from 20 up) is unreachable and deliberately not written.
  v_points := p_difficulty * public.rating_mult(p_rating);
  perform private.notify(array[v_request.requester_id], 'task'::public.noti_kind,
    'Cerere aprobată: ' || left(v_request.description, 60),
    case when abs(v_points) = 1 then v_points || ' punct' else v_points || ' puncte' end
      || ' (dificultate ' || p_difficulty || ', calificativ ' || p_rating || ').',
    v_task.id, null, v_actor);

  select * into v_request from public.completed_work_requests where id = p_request_id;
  return v_request;
end;
$$;

comment on function private.approve_completed_work_request_impl(bigint, integer, integer, text) is
  'Approves one pending Completed-work Request and, in the same transaction, creates the completed Task it recognizes: a local, direct ordinary Task on the Request''s Origin titled with the description''s first 120 characters and deadlined at the approval instant, its created activity row naming details.from_request_id, the requester opened as its Executor via private.open_task_assignment(..., ''request_approval''), and private.evaluate_task (#336) writing the Evaluation, the points_ledger credit, the terminal Task state and the ended Assignment. The Request is then stamped approved/decided_by/decided_at/decision_note/task_id and the requester is notified. Difficulty and Rating outside 1..5 and a blank note are PT400 invalid_difficulty / invalid_rating / note_required, raised BEFORE the gate (they could never succeed for anyone; task_evaluations_note_ck makes the note mandatory even though the Request''s own shape check would allow a null decision_note). The blank note is note_required rather than private.evaluate_task''s evaluation_note_required because it is this command''s input being validated, and it is the same string reject raises for the same mistake. Then 42501 request_command_forbidden for a caller without claims or a live activ profile; the Request row locked FOR UPDATE; PT404 request_not_found when it is missing OR the caller cannot read it (completed_work_requests_read''s own predicate -- hidden and missing are indistinguishable); 42501 request_decide_forbidden when they can read it but may not decide it (private.require_request_decider, which also takes the FOR SHARE re-validation locks); PT409 request_not_pending when it has already been decided -- which is exactly what a second concurrent approval receives after waiting on the row lock. PT400 invalid_executor if the requester is no longer an active Member.';

create function public.approve_completed_work_request(
  p_request_id bigint,
  p_difficulty integer,
  p_rating     integer,
  p_note       text)
returns public.completed_work_requests
language sql
security invoker
set search_path = ''
as $$
  select private.approve_completed_work_request_impl(p_request_id, p_difficulty, p_rating, p_note);
$$;

comment on function public.approve_completed_work_request(bigint, integer, integer, text) is
  'Approve a Completed-work Request: creates the completed Task it describes, credits the requester Difficulty x the Rating multiplier, and records the decision -- atomically. Callable only by the Request''s decider: BC/Moderator anywhere, the live local BCE of a Department or of a Department-Team''s parent Department, or the lead of an ACTIVE Project. A Project Responsible and an Independent Team''s own members may read the Request but must not approve it, and once a Project is archived only BC/Moderator can decide its leftover Requests -- including when the lead is the requester. Difficulty and Rating are 1..5 and a non-blank note is required. Two concurrent approvals leave exactly one Task: the second waits on the Request row and then receives PT409 request_not_pending.';

-- ==================== reject_completed_work_request ====================
create function private.reject_completed_work_request_impl(
  p_request_id bigint,
  p_note       text)
returns public.completed_work_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := (select auth.uid());
  v_note    text;
  v_request public.completed_work_requests%rowtype;
begin
  -- 1. Malformed for everyone: completed_work_requests_rejected_shape_ck
  --    requires a non-blank decision_note (ADR-0007: "Rejection requires a
  --    note"), so a blank one can never be written by anybody.
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'note_required';
  end if;
  v_note := regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g');

  -- 2. Gate.
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'request_command_forbidden';
  end if;

  -- 3. Lock the target.
  select * into v_request from public.completed_work_requests
   where id = p_request_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;

  -- 4. Visibility, then authority -- identical to approve's.
  if v_request.requester_id is distinct from v_actor
     and not coalesce(private.can_manage_origin(
           v_request.dept_id, v_request.team_id, v_request.project_id), false) then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;
  perform private.require_request_decider(p_request_id);

  -- 6. State.
  if v_request.status <> 'pending' then
    raise sqlstate 'PT409' using message = 'request_not_pending';
  end if;

  -- 7. Mutate. No Task: only approval creates one.
  update public.completed_work_requests
     set status        = 'rejected',
         decided_by    = v_actor,
         decided_at    = now(),
         decision_note = v_note
   where id = p_request_id;

  perform private.notify(array[v_request.requester_id], 'task'::public.noti_kind,
    'Cerere respinsă: ' || left(v_request.description, 60),
    v_note,
    null, null, v_actor);

  select * into v_request from public.completed_work_requests where id = p_request_id;
  return v_request;
end;
$$;

comment on function private.reject_completed_work_request_impl(bigint, text) is
  'Rejects one pending Completed-work Request with a required, non-blank reason (ADR-0007; PT400 note_required, raised before the gate because completed_work_requests_rejected_shape_ck could never accept a blank one), stamping rejected/decided_by/decided_at/decision_note and notifying the requester with that reason. Creates no Task -- only approval does. Same gate, lock, visibility and authority as private.approve_completed_work_request_impl: 42501 request_command_forbidden, PT404 request_not_found (missing or unreadable, indistinguishable), 42501 request_decide_forbidden (readable but not decidable by this caller), PT409 request_not_pending once decided.';

create function public.reject_completed_work_request(
  p_request_id bigint,
  p_note       text)
returns public.completed_work_requests
language sql
security invoker
set search_path = ''
as $$
  select private.reject_completed_work_request_impl(p_request_id, p_note);
$$;

comment on function public.reject_completed_work_request(bigint, text) is
  'Reject a Completed-work Request with a reason the requester will read. Callable only by the Request''s decider -- BC/Moderator anywhere, the live local BCE of a Department or of a Department-Team''s parent Department, or the lead of an ACTIVE Project; never a Project Responsible or an Independent Team''s own members. The note is required and non-blank. No Task is created, and the decision happens exactly once: a second decision of either kind receives PT409 request_not_pending.';

-- ==================== Table ownership (conventions Sec2) ====================
-- These three commands are now the only write path to
-- public.completed_work_requests. #321 already revoked every privilege but
-- SELECT from all four roles when it created the table, so this restatement is
-- a no-op today; it is written anyway so that the migration which OWNS the
-- table's writes is also the one that closes the direct path, and so that a
-- future widening of the table's grants cannot quietly reopen it.
revoke insert, update, delete on table public.completed_work_requests from authenticated;

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.require_request_decider(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function private.create_completed_work_request_impl(text, text, text, bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.create_completed_work_request(text, text, text, bigint)
  from public, anon, authenticated, service_role;
revoke execute on function private.approve_completed_work_request_impl(bigint, integer, integer, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.approve_completed_work_request(bigint, integer, integer, text)
  from public, anon, authenticated, service_role;
revoke execute on function private.reject_completed_work_request_impl(bigint, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.reject_completed_work_request(bigint, text)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;

-- private.require_request_decider gets NO grant back: like every other
-- require_* helper it raises or returns the actor for a command that calls it
-- as owner, and supabase/tests/conventions.test.sql fails CI if authenticated
-- can execute it.
grant execute on function private.create_completed_work_request_impl(text, text, text, bigint)
  to authenticated;
grant execute on function public.create_completed_work_request(text, text, text, bigint)
  to authenticated;
grant execute on function private.approve_completed_work_request_impl(bigint, integer, integer, text)
  to authenticated;
grant execute on function public.approve_completed_work_request(bigint, integer, integer, text)
  to authenticated;
grant execute on function private.reject_completed_work_request_impl(bigint, text)
  to authenticated;
grant execute on function public.reject_completed_work_request(bigint, text)
  to authenticated;
