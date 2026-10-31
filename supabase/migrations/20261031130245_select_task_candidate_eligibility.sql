-- #1125: select_task_candidate re-judges the Candidate's eligibility under the Task lock.
--
-- Audit finding M1 (docs/review/2026-10-30-codebase-audit.md). A pending
-- Candidature is filed against the join rule express_task_interest applies --
-- membership of a local Task's Group (private.is_group_member, 42501
-- task_audience_forbidden) and the Task's Minimum Level (R57, 42501
-- task_level_forbidden) -- but nothing closes it when the Member is later
-- removed from the Group or demoted, and private.select_task_candidate_impl
-- checked only candidate_not_pending and, through the kit, that the chosen
-- Member is still activ. assign_task_executor enforces the Level; the
-- selection did not, so a Task Manager could hand a Task to someone its own
-- rule excludes.
--
-- The body below is main's latest (20260914123925_select_task_candidate.sql;
-- no later migration rebuilt it) with one block added under the Task lock,
-- after candidate_not_pending and before any write: the Candidate's Profile
-- is held FOR SHARE (and their roster row, when the Audience is local), and
-- the join rule is re-applied on the live rows in express_task_interest's
-- order -- the Group first, then the Level. A pending Candidature of a
-- now-ineligible Member stays pending and visible (they may become eligible
-- again; closing Candidatures on removal or demotion is not built); only its
-- selection is refused. Eligibility is judged only for a live Member: a
-- deactivated Candidate keeps answering the kit's PT400 invalid_executor
-- (select_task_candidate.test.sql section 5), since their live Level is null
-- and a blind comparison would otherwise call it task_level_forbidden. No
-- signature changes: the grants and the tracker_grants roster are untouched.
-- supabase/tests/select_task_candidate_eligibility.test.sql failed before
-- this file.

create or replace function private.select_task_candidate_impl(
  p_task_id bigint, p_candidate_id bigint, p_close_remaining boolean)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
  v_candidate public.task_candidates%rowtype;
  v_candidate_level integer;
  v_old_assignment_id bigint;
  v_old_member uuid;
  v_new_assignment_id bigint;
  v_closed uuid[] := '{}'::uuid[];
begin
  -- 1. Malformed for everyone: the manager must decide what happens to the
  --    rest of the queue -- checked before the gate (see the header).
  if p_close_remaining is null then
    raise sqlstate 'PT400' using message = 'invalid_close_flag';
  end if;
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked -- the serialization
  --    point this command shares with #330's withdraw_task_interest).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock.
  perform private.require_task_manager(p_task_id);
  -- 5. Input validation: p_candidate_id is a state question, not a shape
  --    question -- it is resolved at step 6 under the Task lock.
  -- 6. State preconditions (PT409), Task-level first (see the header).
  if v_task.kind = 'umbrella' then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  if v_task.status in ('completed', 'unfulfilled', 'cancelled') then
    raise sqlstate 'PT409' using message = 'task_terminal';
  end if;
  if v_task.status = 'in_review' then
    raise sqlstate 'PT409' using message = 'task_in_review';
  end if;
  -- The named Candidature, locked after the tasks row. One reason for every
  -- way it can fail, including "valid, but on another Task".
  select * into v_candidate
    from public.task_candidates as candidate
   where candidate.id = p_candidate_id
     and candidate.task_id = p_task_id
     and candidate.status = 'pending'
   for update;
  if not found then
    raise sqlstate 'PT409' using message = 'candidate_not_pending';
  end if;
  -- #1125 (audit M1): the Candidate's eligibility, re-judged on the live rows
  -- under the Task lock exactly as express_task_interest judged it when the
  -- Candidature was filed. Their Profile is held FOR SHARE (and their roster
  -- row, when the Audience is local) so a concurrent removal or demotion
  -- serializes behind the decision; never a lock on the groups row. Only a
  -- live Member is judged: a deactivated Candidate has no Level, and the kit
  -- below names that case itself (PT400 invalid_executor).
  perform 1 from public.profiles as profile
   where profile.id = v_candidate.member_id for share;
  v_candidate_level := private.actor_level(v_candidate.member_id);
  if v_candidate_level is not null then
    if v_task.audience = 'local' then
      perform 1 from public.group_members as membership
       where membership.group_id = v_task.group_id
         and membership.member_id = v_candidate.member_id
       for share of membership;
      if not coalesce(private.is_group_member(v_task.group_id, v_candidate.member_id), false) then
        raise exception using errcode = '42501', message = 'task_audience_forbidden';
      end if;
    end if;
    if v_candidate_level < v_task.min_level then
      raise exception using errcode = '42501', message = 'task_level_forbidden';
    end if;
  end if;
  -- 7. Mutate, then activity, then return.
  select assignment.id, assignment.member_id into v_old_assignment_id, v_old_member
    from public.task_assignments as assignment
   where assignment.task_id = p_task_id and assignment.ended_at is null
   for update;
  if v_old_assignment_id is not null then
    perform private.end_task_assignment(v_old_assignment_id, 'replaced', null);
    perform private.notify(
      array[v_old_member],
      'task'::public.noti_kind,
      'Înlocuit: ' || v_task.title,
      'Managerul a ales alt executant.',
      p_task_id, null, v_actor);
  end if;
  -- The kit writes the Assignment, its executor_assigned row
  -- (details.via = 'select') and the new Executor's 'Task nou' notification,
  -- and is the only place the chosen Member's liveness is checked -- PT400
  -- invalid_executor, which rolls the whole command back by design.
  v_new_assignment_id := private.open_task_assignment(
    p_task_id, v_candidate.member_id, v_actor, 'select');
  update public.task_candidates as candidate
     set status = 'selected', decided_at = now(), decided_by = v_actor,
         assignment_id = v_new_assignment_id
   where candidate.id = v_candidate.id
     and candidate.status = 'pending';
  if not found then
    raise sqlstate 'PT409' using message = 'candidate_not_pending';
  end if;
  if p_close_remaining then
    -- Runs AFTER the update above, so the person just selected is no longer
    -- 'pending' and is neither closed nor notified a second time.
    v_closed := private.close_task_queue(p_task_id, v_actor);
    perform private.notify(
      v_closed,
      'task'::public.noti_kind,
      'Coadă închisă: ' || v_task.title,
      'Nu mai poți fi selectat pentru acest task.',
      p_task_id, null, v_actor);
  end if;
  perform private.log_task_activity(p_task_id, 'candidate_selected', v_actor, v_new_assignment_id,
    null, null, null,
    jsonb_build_object('candidate_id', v_candidate.id,
                       'replaced_assignment_id', v_old_assignment_id,
                       'closed_remaining', p_close_remaining,
                       'closed_candidates', cardinality(v_closed)));
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

comment on function private.select_task_candidate_impl(bigint, bigint, boolean) is
  'A manager fills or replaces a Task''s Executor from its own Candidate Queue and decides the fate of the remaining Candidates; the actor is auth.uid(), never a parameter. p_close_remaining null is PT400 invalid_close_flag, raised before the membership gate because the input is malformed for every caller. The tasks row is locked FOR UPDATE before any Assignment or Candidature state is read, so a concurrent withdraw_task_interest serializes behind the whole decision. Requires private.require_task_manager under that lock (42501 task_manage_forbidden). Refuses an Umbrella (PT409 task_is_umbrella, first because an Umbrella''s assignment_mode is null), a terminal Task (task_terminal) and an in_review Task (task_in_review -- ADR-0007 blocks replacing an Executor mid-review), all before p_candidate_id is even looked up. p_candidate_id must be a live pending Candidature OF THIS TASK, locked FOR UPDATE after the tasks row; unknown, null, withdrawn, already decided and "valid but on another Task" all answer the same PT409 candidate_not_pending, so a manager can never probe another Task''s Candidature ids. #1125 (audit M1): the Candidate''s eligibility is then re-judged on the live rows, in express_task_interest''s order -- their Profile held FOR SHARE; on a local Task their roster row held FOR SHARE and 42501 task_audience_forbidden unless private.is_group_member still admits them; then 42501 task_level_forbidden when their live Level is below the Task''s Minimum Level (R57). A pending Candidature of a now-ineligible Member stays pending and visible; only its selection is refused. Only a live Member is judged there: a deactivated Candidate is left to private.open_task_assignment (via = ''select''), which opens the new Assignment, writes its executor_assigned row and notifies the chosen Member -- and raises PT400 invalid_executor if that Member is no longer activ, deliberately failing loudly instead of skipping to the next Candidate the way #332''s automatic promotion does. Before that, an existing active Assignment is ended with end_reason ''replaced'' and its holder gets the pinned ''Înlocuit'' notification. The Candidature becomes ''selected'' with decided_by = the MANAGER and assignment_id = the new Assignment via an UPDATE that repeats the pending-status predicate and re-raises PT409 candidate_not_pending if it matches nothing (defense in depth: unreachable while the tasks row lock and the Candidature''s own SELECT ... FOR UPDATE both hold, but never a silent overwrite of a row that stopped being pending); with p_close_remaining true private.close_task_queue then closes the queue and every remaining Candidature and notifies exactly those Members (''Coadă închisă''), with false they are left untouched and the queue stays open. One candidate_selected activity row is written last, carrying the new Assignment id and details.candidate_id / replaced_assignment_id / closed_remaining / closed_candidates. The Task''s status never changes.';

comment on function public.select_task_candidate(bigint, bigint, boolean) is
  'Pick a Task''s Executor out of its Candidate Queue, replacing whoever holds it, and say whether the remaining Candidates stay pending (false) or are closed (true). Callable by anyone who manages the Task''s Origin; the chosen id must be a live pending Candidature of that same Task (PT409 candidate_not_pending) on a Task that is not an Umbrella, terminal or in review, the chosen Member must still meet the Task''s join rule -- a member of a local Task''s Group (42501 task_audience_forbidden), at or above its Minimum Level (42501 task_level_forbidden; #1125) -- and must still be an active Member (PT400 invalid_executor).';
