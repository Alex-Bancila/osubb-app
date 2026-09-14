-- #332: give_up_task -- the Executor leaves a Task they hold, with a required
-- reason, and the oldest pending Candidate is promoted into the slot they
-- vacate IN THE SAME TRANSACTION.
--
-- The safety property this migration exists for (ADR-0007 Sec Assignment and
-- candidate queue): a Task never has two Executors, and never sits Executor-
-- less while its Candidate Queue still holds someone. Ending the Assignment
-- and opening the promoted one are a single atomic step serialized on
-- `select ... from public.tasks where id = p_task_id for update` in step 3 --
-- the same first-locked row #330's express_task_interest takes before it reads
-- any Assignment state, which is exactly why the two commands can race and
-- still agree:
--   - if this command commits first, the concurrent interested Member wakes
--     into a Task whose queue was already drained and takes the free slot by
--     first-come;
--   - if the candidature commits first, this command's promotion is what
--     selects them.
-- Either way the end state is one active Assignment. give_up_task.test.sql
-- sections 9 and 10 run both shapes (empty queue, non-empty queue) and assert
-- b_waited = true plus that invariant. Remove the tasks-row FOR UPDATE and
-- section 10 breaks loudly: the interested session stops serializing behind
-- the promotion, re-reads the Assignment the promotion has already replaced,
-- finds it ended, and inserts a second active Assignment -- a raw 23505 from
-- task_assignments_one_active_per_task_uidx, which is precisely the failure
-- that index is a last-resort guard against rather than a mechanism for.
--
-- Step order (stack-context.md, binding) with this command's own decisions:
--   1. A blank or null p_reason is PT400 reason_required, checked BEFORE the
--      gate. The reason is what the Task's managers read in the notification
--      and what Assignment History keeps as the end_note, so a call without
--      one is malformed for every caller, authenticated or not -- the #343
--      set_campaign_active precedent. The suite pins this by getting PT400,
--      not 42501, out of a claimless uid.
--   2/3. require_task_visible, then the tasks row FOR UPDATE with the
--      `if not found` PT404 guard (stack-context.md carry-forward: until #345
--      retires tasks_delete_legacy a concurrent hard delete would otherwise
--      leave v_task all-NULL and let the state check answer the wrong PT409).
--   4. private.require_task_executor is the whole authority rule: it locks the
--      one active Assignment FOR UPDATE, holds the caller's profile FOR SHARE,
--      and raises 42501 task_executor_forbidden when there is no active
--      Assignment or it belongs to someone else -- so a manager, a past
--      Executor and a Member who already gave up are all denied identically,
--      and a second give-up is refused without a state check of its own.
--   6. Status must be todo or in_progress; anything else is PT409
--      task_not_in_progress. in_review is ADR-0007's explicitly blocked case
--      (work already submitted is returned or evaluated, never abandoned), and
--      the same reason covers the three terminal statuses.
--
-- The Task's status is deliberately NOT changed. An in_progress Task stays
-- in_progress for the promoted Executor -- started_at is already set and
-- rewinding it would violate tasks_lifecycle_timestamp_order_check's intent as
-- well as the history -- and a todo Task stays todo. A direct Task has no
-- queue, so it simply ends with no Executor; that is the state #342's
-- assign_task_executor exists to remedy, and the suite composes the two
-- commands to prove it.
--
-- The promotion picks the oldest pending Candidature by (joined_at, id) --
-- queue order is derived, never stored (#290) -- and locks it with a plain
-- FOR UPDATE, not FOR UPDATE SKIP LOCKED: the tasks row lock already
-- serializes every writer of this Task's candidates, so a locked row here
-- would mean a writer that skipped the Task lock, and skipping it would hide
-- that bug instead of blocking on it. The Candidature becomes 'selected' with
-- decided_at = now(), decided_by = the giver-upper (the actor of record --
-- task_candidates_decision_shape_ck requires a decider, and the person whose
-- departure caused the selection is the truthful one) and assignment_id = the
-- Assignment private.open_task_assignment just opened.
--
-- Notifications, both under the pinned copy (stack-context.md):
--   - the Task's managers get 'Renunțare: {title}' / '{name} a renunțat:
--     {reason}', uncoalesced;
--   - the promoted Candidate gets the standard 'Task nou' row from
--     private.open_task_assignment (p_via = 'queue_promotion').
-- The coalesced 'task:{id}:queue' manager notification is deliberately NOT
-- rewritten here: its pinned trigger is a Candidate joining or withdrawing,
-- and a promotion is neither -- the managers are already being told about the
-- give-up itself in the same transaction.
--
-- KNOWN GAP, flagged rather than silently handled (see the PR): the promotion
-- takes strictly the oldest pending Candidature without checking that the
-- Member is still activ, and private.open_task_assignment is the only liveness
-- gate there is (PT400 invalid_executor). A Member deactivated while queued
-- therefore blocks their Task's Executor from ever giving up, because the
-- failed promotion rolls the give-up back with it. Nothing on main closes or
-- skips a deactivated Member's pending Candidature. The behavior is pinned by
-- give_up_task.test.sql section 6 so that a decision to skip dead Candidatures
-- (or to close them on deactivation) has a test to change rather than an
-- undocumented behavior to discover.

create function private.give_up_task_impl(p_task_id bigint, p_reason text)
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
  v_candidate public.task_candidates%rowtype;
  v_new_assignment_id bigint;
begin
  -- 1. Malformed for everyone: no reason, no give-up -- checked before the
  --    gate, so a claimless caller gets PT400 too (see the header).
  if p_reason is null or p_reason !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'reason_required';
  end if;
  v_reason := regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
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
  -- 7. Mutate: end the Assignment, record it, promote, then notify.
  perform private.end_task_assignment(v_assignment_id, 'gave_up', v_reason);
  perform private.log_task_activity(p_task_id, 'gave_up', v_actor, v_assignment_id, null, null,
    v_reason, jsonb_build_object('reason', v_reason));

  -- Promotion: the head of the derived queue, locked plainly (see the header).
  select * into v_candidate
    from public.task_candidates as candidate
   where candidate.task_id = p_task_id
     and candidate.status = 'pending'
   order by candidate.joined_at, candidate.id
   limit 1
   for update;
  if found then
    -- The kit writes the Assignment, its executor_assigned row
    -- (details.via = 'queue_promotion') and the new Executor's 'Task nou'
    -- notification, and is the only place the promoted Member's liveness is
    -- checked (PT400 invalid_executor -- see the KNOWN GAP in the header).
    v_new_assignment_id := private.open_task_assignment(
      p_task_id, v_candidate.member_id, v_actor, 'queue_promotion');
    update public.task_candidates as candidate
       set status = 'selected', decided_at = now(), decided_by = v_actor,
           assignment_id = v_new_assignment_id
     where candidate.id = v_candidate.id;
    perform private.log_task_activity(p_task_id, 'candidate_selected', v_actor, v_new_assignment_id,
      null, null, null,
      jsonb_build_object('candidate_id', v_candidate.id, 'member_id', v_candidate.member_id,
                         'promoted', true));
  end if;

  select profile.full_name into v_actor_name
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
  'The Task''s active Executor leaves it, giving a required reason; the actor is auth.uid(), never a parameter. A blank or null reason is PT400 reason_required, raised before the membership gate because the input is malformed for every caller. The tasks row is locked FOR UPDATE before any Assignment or Candidature state is read, so a concurrent express_task_interest serializes behind the whole give-up-and-promote step instead of racing it for the one Assignment slot. private.require_task_executor is the entire authority rule (42501 task_executor_forbidden for a manager, a past Executor, or a second give-up); the status must be todo or in_progress (PT409 task_not_in_progress -- in_review is ADR-0007''s blocked case, and the three terminal statuses answer the same reason). Ends the Assignment with end_reason ''gave_up'' and the trimmed reason as its end_note, writes a gave_up activity row (the ENDED Assignment''s id, note and details.reason), then promotes the oldest pending Candidature by (joined_at, id), locked FOR UPDATE: private.open_task_assignment (via = ''queue_promotion'') opens the new Assignment and notifies its Member, the Candidature becomes ''selected'' with decided_by = the giver-upper and assignment_id = the new Assignment, and a candidate_selected row records details.candidate_id and details.promoted = true. Finally the Task''s managers get the pinned ''Renunțare'' notification. The Task''s status never changes -- an in_progress Task stays in_progress for the promoted Executor and a direct Task simply ends with no Executor, which #342''s assign_task_executor exists to remedy. Known gap: a deactivated Member at the head of the queue makes open_task_assignment raise PT400 invalid_executor and rolls the give-up back with it.';

create function public.give_up_task(p_task_id bigint, p_reason text)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.give_up_task_impl(p_task_id, p_reason);
$$;

comment on function public.give_up_task(bigint, text) is
  'Leave a Task you hold as its Executor, stating why. Callable only by the Task''s live active Executor (42501 task_executor_forbidden otherwise) while the Task is todo or in_progress (PT409 task_not_in_progress); PT400 reason_required for a blank reason. The oldest pending Candidate is promoted into the freed slot in the same transaction; a direct Task, having no queue, is left without an Executor for a manager to reassign.';

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.give_up_task_impl(bigint, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.give_up_task(bigint, text)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;

grant execute on function private.give_up_task_impl(bigint, text) to authenticated;
grant execute on function public.give_up_task(bigint, text) to authenticated;
