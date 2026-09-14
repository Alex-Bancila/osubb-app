-- #333: select_task_candidate -- a manager fills or replaces a public Task's
-- Executor with someone ALREADY IN ITS CANDIDATE QUEUE, and decides in the
-- same call whether the Candidates left behind stay pending or are closed.
--
-- This is the last of the three queue-racing commands (#330 express/withdraw,
-- #332 give_up_task, #333 here). All three take
-- `select ... from public.tasks where id = p_task_id for update` as their
-- FIRST row lock, which is what lets them race and still agree: a Candidate
-- withdrawing while the manager is mid-selection blocks on that row, wakes
-- into the committed decision and answers PT409 not_a_candidate instead of
-- tearing the Executor slot in half.
--
-- ADR-0007 Sec Assignment and candidate queue: the Executor slot is single and
-- the QUEUE IS THE ONLY SOURCE a manager may select from. Handing a Task to
-- somebody who never expressed interest is #342's assign_task_executor, and
-- only on a direct Task; this command refuses any p_candidate_id that is not a
-- live pending Candidature OF THIS TASK.
--
-- Deliberate divergence from #332, and the reason it is worth naming here:
-- #332's AUTOMATIC promotion skips a deactivated Candidate and promotes the
-- next live one, because nobody chose them and an Executor must not be trapped
-- on a Task by somebody ELSE's deactivation (stack-context.md carry-forward).
-- Here the manager named one specific person, so a deactivated choice must
-- fail LOUDLY: private.open_task_assignment raises PT400 invalid_executor and
-- the whole command rolls back, even when a live Candidate is queued directly
-- behind them. Silently selecting someone the manager did not name would be a
-- worse answer than an error. select_task_candidate.test.sql section 5 pins
-- both halves: the PT400, and the fact that the live Candidate behind the dead
-- one is NOT promoted in their place.
--
-- Step order (stack-context.md, binding) with this command's own decisions:
--   1. p_close_remaining null is PT400 invalid_close_flag, checked BEFORE the
--      gate -- a null boolean is malformed for every caller, authorized or not
--      (the #343 set_campaign_active / #331 set_task_queue precedent). The
--      suite pins it by getting PT400, not 42501, out of a claimless uid.
--      p_task_id null is deliberately NOT a step-1 check: it falls out as
--      PT404 task_not_found through private.can_read_task, the wave-level
--      ruling for every command's target id.
--   2/3. require_task_visible, then the tasks row FOR UPDATE with the
--      `if not found` PT404 guard (stack-context.md carry-forward: until #345
--      retires tasks_delete_legacy a concurrent hard delete would otherwise
--      leave v_task all-NULL and let a state check answer the wrong PT409).
--   4. private.require_task_manager under that lock -- it re-reads live rows
--      and holds the actor's profile plus the membership row their authority
--      rests on FOR SHARE, so a concurrent revocation serializes behind this
--      command (#343 / #390 discipline). 42501 task_manage_forbidden.
--   6. Task-level state outranks the p_candidate_id parameter, so the three
--      PT409 state reasons are evaluated BEFORE the Candidature is looked up:
--      umbrella, then terminal, then in_review. Umbrella first for the same
--      reachability reason #342 and #330 document -- an Umbrella has null
--      assignment_mode and no queue at all, so any other ordering would
--      misreport it. in_review is ADR-0007's explicitly blocked case: work
--      already submitted is returned (#337) or evaluated (#336), never handed
--      to somebody else mid-review. Checking these first also means a manager
--      never learns anything about a Candidature id on a Task they cannot act
--      on anyway.
--   6 (cont). The Candidature itself: `id = p_candidate_id AND
--      task_id = p_task_id AND status = 'pending'`, locked FOR UPDATE after
--      the tasks row. Unknown, withdrawn, already selected/closed, null, and
--      "exists but belongs to ANOTHER Task" all answer the SAME PT409
--      candidate_not_pending -- a manager of Task A must never be able to
--      probe Task B's Candidature ids by watching the error change. There is
--      deliberately no separate task_not_public reason either: a direct Task
--      has no Candidatures, so it answers candidate_not_pending naturally.
--
-- Fix round (review): the UPDATE that marks the Candidature 'selected' repeats
-- `and candidate.status = 'pending'` and re-raises PT409 candidate_not_pending
-- if it updates nothing. Today the tasks row lock plus the SELECT ... FOR
-- UPDATE above make a concurrent withdrawal of THIS SAME Candidature between
-- the SELECT and this UPDATE impossible, so the predicate is a no-op on every
-- path this suite can reach -- but it is defense in depth against either lock
-- ever moving, and it is what makes the SELECT's own FOR UPDATE keyword
-- mutation-detectable (see the migration's mutation notes and the fix report).
--
-- Step 7 runs in the order the facts become available, which is why the
-- activity row is written LAST rather than immediately after the mutation:
-- details.closed_candidates is not knowable until private.close_task_queue has
-- returned. The sequence is end-the-old-Assignment -> notify its holder ->
-- open the new Assignment (which writes its own executor_assigned row and the
-- "Task nou" notification) -> mark the Candidature selected -> optionally
-- close the rest and notify them -> log candidate_selected. Marking the chosen
-- Candidature selected BEFORE close_task_queue runs is load-bearing: that
-- helper closes every row still reading 'pending', so the selected person
-- would otherwise be closed and notified a second time.
--
-- The Task's status NEVER changes. Selecting an Executor is not starting the
-- work (#334's start_task is), and replacing one does not rewind started_at --
-- an in_progress Task stays in_progress for the incoming Executor.
--
-- The coalesced 'task:{id}:queue' manager notification is deliberately NOT
-- refreshed here (stack-context.md carry-forward): only #330's join/withdraw
-- write it, this command already sends three more specific notifications, and
-- the manager is the actor, whom private.notify drops anyway.
--
-- Known shape this command does not special-case: a Member who is both the
-- active Executor AND a pending Candidate on the same Task. No command on main
-- can produce it (#332 documents the same gap for its own promotion), and if a
-- hand-built row ever did, this command would coherently end their Assignment
-- as 'replaced' and immediately open them a fresh one. It is left unguarded
-- rather than given an unpinned PT409 reason of its own.

create function private.select_task_candidate_impl(
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
  'A manager fills or replaces a Task''s Executor from its own Candidate Queue and decides the fate of the remaining Candidates; the actor is auth.uid(), never a parameter. p_close_remaining null is PT400 invalid_close_flag, raised before the membership gate because the input is malformed for every caller. The tasks row is locked FOR UPDATE before any Assignment or Candidature state is read, so a concurrent withdraw_task_interest serializes behind the whole decision. Requires private.require_task_manager under that lock (42501 task_manage_forbidden). Refuses an Umbrella (PT409 task_is_umbrella, first because an Umbrella''s assignment_mode is null), a terminal Task (task_terminal) and an in_review Task (task_in_review -- ADR-0007 blocks replacing an Executor mid-review), all before p_candidate_id is even looked up. p_candidate_id must be a live pending Candidature OF THIS TASK, locked FOR UPDATE after the tasks row; unknown, null, withdrawn, already decided and "valid but on another Task" all answer the same PT409 candidate_not_pending, so a manager can never probe another Task''s Candidature ids. An existing active Assignment is ended with end_reason ''replaced'' and its holder gets the pinned ''Înlocuit'' notification; private.open_task_assignment (via = ''select'') opens the new one, writes its executor_assigned row and notifies the chosen Member -- and raises PT400 invalid_executor if that Member is no longer activ, deliberately failing loudly instead of skipping to the next Candidate the way #332''s automatic promotion does. The Candidature becomes ''selected'' with decided_by = the MANAGER and assignment_id = the new Assignment via an UPDATE that repeats the pending-status predicate and re-raises PT409 candidate_not_pending if it matches nothing (defense in depth: unreachable while the tasks row lock and the Candidature''s own SELECT ... FOR UPDATE both hold, but never a silent overwrite of a row that stopped being pending); with p_close_remaining true private.close_task_queue then closes the queue and every remaining Candidature and notifies exactly those Members (''Coadă închisă''), with false they are left untouched and the queue stays open. One candidate_selected activity row is written last, carrying the new Assignment id and details.candidate_id / replaced_assignment_id / closed_remaining / closed_candidates. The Task''s status never changes.';

create function public.select_task_candidate(
  p_task_id bigint, p_candidate_id bigint, p_close_remaining boolean)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.select_task_candidate_impl(p_task_id, p_candidate_id, p_close_remaining);
$$;

comment on function public.select_task_candidate(bigint, bigint, boolean) is
  'Pick a Task''s Executor out of its Candidate Queue, replacing whoever holds it, and say whether the remaining Candidates stay pending (false) or are closed (true). Callable by anyone who manages the Task''s Origin; the chosen id must be a live pending Candidature of that same Task (PT409 candidate_not_pending) on a Task that is not an Umbrella, terminal or in review, and the chosen Member must still be an active Member (PT400 invalid_executor).';

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.select_task_candidate_impl(bigint, bigint, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function public.select_task_candidate(bigint, bigint, boolean)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;

grant execute on function private.select_task_candidate_impl(bigint, bigint, boolean) to authenticated;
grant execute on function public.select_task_candidate(bigint, bigint, boolean) to authenticated;
