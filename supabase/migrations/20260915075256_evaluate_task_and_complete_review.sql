-- #336: complete_task_review, over private.evaluate_task -- the single place
-- in the system where points are computed and written.
--
-- Two functions, deliberately split:
--
--   private.evaluate_task(task, outcome, difficulty, rating, note, actor)
--     The shared Evaluation core. Tasks 12 (#337 mark_task_unfulfilled),
--     13 (#338 reopen_task) and 17 (#344 approve_completed_work_request) call
--     it too, so its contract is the point of this migration, not an
--     implementation detail of complete_task_review. It assumes the caller
--     already holds the public.tasks row FOR UPDATE and has already
--     authorized -- it re-checks neither, and it takes no lock on the Task
--     row itself. It is the only writer of public.task_evaluations and the
--     only writer of a `reason = 'task'` public.points_ledger row: the
--     formula (ADR-0007: Difficulty x the Rating multiplier) exists in
--     exactly one place, and every consumer inherits it.
--
--   private.complete_task_review_impl(task, difficulty, rating, note)
--     The first public command over that core: an evaluator closes an
--     in_review ordinary Task as `completed`.
--
-- Authority is private.require_task_evaluator (#327), unchanged and not
-- re-derived here -- the same boundary #335's return_task_to_progress
-- already exercises: BC/Moderator anywhere; the live local BCE of a
-- Department or of a Department-Team's parent Department; on an ACTIVE
-- Project its lead (including for their own active Assignment) and a
-- Responsible for anyone's work but the lead's or their own; and nothing at
-- all for an Independent Team's own members (BC/Moderator evaluates there).
--
-- Step order inside complete_task_review_impl (stack-context.md, binding):
--   1. A blank or null p_note is PT400 evaluation_note_required, raised
--      BEFORE the gate -- the #335 precedent for an evaluator command whose
--      note is required by task_evaluations_note_ck itself. A call without
--      one can never succeed for any caller, authorized or not.
--   2/3. private.require_task_visible, then the tasks row FOR UPDATE with
--      the `if not found` PT404 guard (a concurrent hard delete is still
--      reachable until #345 retires tasks_delete_legacy).
--   4. private.require_task_evaluator under that lock -- it re-validates
--      against live rows and holds the evaluator's profile (and, below level
--      6, the membership row their authority rests on) FOR SHARE, so a
--      concurrent deactivation serializes behind this command.
--   5. Difficulty and Rating range checks (PT400 invalid_difficulty /
--      invalid_rating) -- numeric domain inputs, conventions Sec2's step 5,
--      validated once authority is established. evaluate_task repeats all
--      four input checks because Tasks 12/13/17 reach it by other routes and
--      it must be self-sufficient; the reasons and codes are identical, so
--      the duplication changes no observable behaviour.
--   6. PT409 task_is_umbrella (an Umbrella's completion is #340's rollup,
--      never an Evaluation -- tasks_umbrella_shape_ck forbids it a
--      Difficulty and a Rating in the first place), then PT409
--      task_not_in_review.
--   7. Delegate to private.evaluate_task and re-read the Task.
--
-- Order inside evaluate_task, and the one place it departs from #336's
-- issue text
-- --------------------------------------------------------------------
-- The brief's ordering writes the Task's terminal status before closing the
-- Candidate Queue. That is not executable: tasks_queue_timestamp_state_check
-- is a plain row CHECK, evaluated the instant the UPDATE statement writes the
-- row, and it requires `queue_closed_at is not null` for a public Task at
-- completed/unfulfilled/cancelled. Setting status = 'completed' on a public
-- Task whose queue is still open fails 23514 immediately, before
-- close_task_queue could ever run. So private.close_task_queue is called
-- FIRST -- it only stamps queue_closed_at and decides the pending
-- Candidatures, neither of which any constraint objects to on a live Task
-- (that is exactly what #331's set_task_queue does to an in_progress Task) --
-- and the terminal status update follows. Everything else follows the brief:
-- Evaluation row, ledger row, Task update, end the Assignment, activity,
-- notifications, Umbrella rollup.
--
-- The parent (Umbrella) row is deliberately NEVER locked (Global
-- Constraints' lock order: a command that touches both locks the Umbrella
-- FIRST, and this one already holds the Subtask). Two sibling Subtasks
-- completing concurrently therefore do not serialize on the Umbrella -- they
-- serialize on the manager notification's dedupe key instead, because
-- private.notify upserts on (member_id, dedupe_key) while unread: the second
-- session blocks on that unique index and then UPDATEs the row the first one
-- inserted, so the manager ends with one coalesced "Subtask încheiat" row
-- carrying the later count, never two rows and never a unique violation.
-- The consequence accepted, and verified by the suite's own race rather than
-- assumed: each session computes terminal_count from its OWN statement
-- snapshot, taken before the other committed, so the surviving coalesced row
-- carries the count its last writer saw -- which under two truly concurrent
-- siblings is one behind ("1 din 2" when both are in fact done). This is the
-- same trade the wave already accepted for the task:{id}:queue notification
-- ("an unread queue row can sit one too high until the next join or
-- withdrawal"): the row is a nudge, the live truth is one query away, and
-- the per-Subtask subtask_completed ACTIVITY rows -- which never coalesce --
-- are the durable record. Locking the Umbrella would make the count exact;
-- the lock order forbids it, and one stale nudge is the cheaper price than a
-- second lock-ordering rule for every future command.
--
-- awarded_by is deliberately left null on the ledger row. The brief pins the
-- column list, and evaluation_id already names the Evaluation, whose
-- evaluated_by IS the evaluator -- a second copy on the ledger row could only
-- ever disagree with it. This is also exactly the shape
-- pg_temp.test_credit_task (supabase/tests/_helpers.sql) writes, which
-- describes itself as doing what the evaluation commands will do.
--
-- No table-DML revoke accompanies this migration (conventions Sec2). Neither
-- table this command owns is writable by `authenticated` today:
-- public.task_evaluations has every privilege revoked from all four roles
-- (#316) and public.points_ledger's only insert policy, `ledger_sanction`,
-- requires reason = 'sanction' -- so a `task` row from a client is already
-- refused by RLS. Revoking insert on points_ledger outright would break BC
-- sanctions, which are not this command's to own.

-- ==================== The shared Evaluation core ====================
create function private.evaluate_task(
  p_task_id    bigint,
  p_outcome    text,
  p_difficulty integer,
  p_rating     integer,
  p_note       text,
  p_actor      uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task           public.tasks%rowtype;
  v_note           text;
  v_assignment_id  bigint;
  v_executor_id    uuid;
  v_points         integer;
  v_evaluation_id  bigint;
  v_closed         uuid[];
  v_parent_title   text;
  v_subtask_count  integer;
  v_terminal_count integer;
begin
  -- Input, all four checks repeated from the calling command so that every
  -- future caller (#337/#338/#344) inherits them without restating them.
  if p_outcome is null or p_outcome not in ('completed', 'unfulfilled') then
    raise sqlstate 'PT400' using message = 'invalid_outcome';
  end if;
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 5 then
    raise sqlstate 'PT400' using message = 'invalid_difficulty';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise sqlstate 'PT400' using message = 'invalid_rating';
  end if;
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'evaluation_note_required';
  end if;
  v_note := regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g');

  -- The caller already holds this row FOR UPDATE; this read only fetches it.
  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;

  -- The Assignment the points are credited to. FOR UPDATE because this is
  -- the row the Evaluation, the ledger entry and end_task_assignment all
  -- hang off; a caller that has not already serialized on the tasks row
  -- (none today, but the core is shared) still cannot have two Evaluations
  -- race onto one Assignment.
  select assignment.id, assignment.member_id
    into v_assignment_id, v_executor_id
    from public.task_assignments as assignment
   where assignment.task_id = p_task_id and assignment.ended_at is null
   for update;
  if v_assignment_id is null then
    raise sqlstate 'PT409' using message = 'task_has_no_executor';
  end if;

  -- ADR-0007's scoring guide, in the one place it exists. rating_mult is
  -- 1 -> -1, 2 -> 0, 3 -> 1, 4 -> 2, 5 -> 3, so a zero or negative award is
  -- legal and is written exactly as computed -- never clamped.
  v_points := p_difficulty * public.rating_mult(p_rating);

  insert into public.task_evaluations
    (task_id, assignment_id, source, evaluated_by, outcome,
     difficulty, rating, points, note)
  values (p_task_id, v_assignment_id, 'command', p_actor, p_outcome,
          p_difficulty, p_rating, v_points, v_note)
  returning id into v_evaluation_id;

  insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id)
  values (v_executor_id, v_points, 'task', p_task_id, v_evaluation_id);

  -- Before the status write, not after: see the migration header.
  -- p_decided_by null marks an automatic close (task_candidates_decision_shape_ck).
  v_closed := private.close_task_queue(p_task_id, null);

  update public.tasks
     set difficulty     = p_difficulty,
         rating         = p_rating,
         status         = p_outcome::public.task_status,
         completed_at   = case when p_outcome = 'completed' then now() end,
         unfulfilled_at = case when p_outcome = 'unfulfilled' then now() end
   where id = p_task_id;

  -- now() in both places, so ended_at = completed_at exactly (conventions Sec7).
  perform private.end_task_assignment(v_assignment_id,
    case p_outcome when 'completed' then 'completed' else 'failed' end, null);

  perform private.log_task_activity(p_task_id,
    case p_outcome when 'completed' then 'evaluated' else 'unfulfilled' end,
    p_actor, v_assignment_id, v_task.status, p_outcome::public.task_status, v_note,
    jsonb_build_object('evaluation_id', v_evaluation_id,
                       'difficulty', p_difficulty,
                       'rating', p_rating,
                       'points', v_points));

  -- A direct Task closes no queue, so v_closed is '{}' and notify writes
  -- nothing; on a public Task these are the Candidates who just lost the
  -- chance to be selected.
  perform private.notify(v_closed, 'task'::public.noti_kind,
    'Coadă închisă: ' || v_task.title,
    'Nu mai poți fi selectat pentru acest task.',
    p_task_id, null, p_actor);

  perform private.notify(array[v_executor_id], 'task'::public.noti_kind,
    case p_outcome when 'completed' then 'Task evaluat: ' else 'Task nerealizat: ' end
      || v_task.title,
    v_points || ' puncte (dificultate ' || p_difficulty || ', calificativ ' || p_rating || ').',
    p_task_id, null, p_actor);

  -- Umbrella rollup. The counts are taken AFTER the status update, so this
  -- Subtask is already inside terminal_count.
  if v_task.parent_task_id is not null then
    select parent.title into v_parent_title
      from public.tasks as parent where parent.id = v_task.parent_task_id;

    select count(*),
           count(*) filter (where sub.status in ('completed', 'unfulfilled', 'cancelled'))
      into v_subtask_count, v_terminal_count
      from public.tasks as sub
     where sub.parent_task_id = v_task.parent_task_id;

    perform private.log_task_activity(v_task.parent_task_id, 'subtask_completed',
      p_actor, null, null, null, null,
      jsonb_build_object('subtask_id', p_task_id,
                         'outcome', p_outcome,
                         'terminal_count', v_terminal_count,
                         'subtask_count', v_subtask_count));

    -- Romanian numeral agreement, the same rule the wave applied to the
    -- queue-count body: singular at 1, bare plural for 2-19, `de` + plural
    -- from 20 up. The noun agrees with the total (the numeral it follows).
    perform private.notify(
      array(select private.task_managers(v_task.parent_task_id, p_actor)),
      'task'::public.noti_kind,
      'Subtask încheiat: ' || v_parent_title,
      case
        when v_subtask_count = 1 then v_terminal_count || ' din 1 subtask încheiat.'
        when v_subtask_count < 20 then
          v_terminal_count || ' din ' || v_subtask_count || ' subtaskuri încheiate.'
        else v_terminal_count || ' din ' || v_subtask_count || ' de subtaskuri încheiate.'
      end,
      v_task.parent_task_id,
      'task:' || v_task.parent_task_id::text || ':subtasks',
      p_actor);
  end if;

  return v_evaluation_id;
end;
$$;

comment on function private.evaluate_task(bigint, text, integer, integer, text, uuid) is
  'The shared Evaluation core and the ONLY place points are computed and written (ADR-0007: Difficulty x public.rating_mult(Rating), zero or negative written as computed). Assumes the caller already holds the public.tasks row FOR UPDATE and has already authorized -- it re-checks neither and never locks the Task row, nor (deliberately) the Umbrella row of a Subtask. Validates outcome/difficulty/rating/note itself (PT400 invalid_outcome / invalid_difficulty / invalid_rating / evaluation_note_required) so every caller inherits the same rules, locks the one active Assignment FOR UPDATE (PT409 task_has_no_executor when there is none), then writes: one source = command task_evaluations row, one reason = task points_ledger row crediting the Executor, the Candidate Queue closed automatically (decided_by null) BEFORE the terminal status write that tasks_queue_timestamp_state_check demands it precede, the Task set to the outcome with its Difficulty, Rating and completed_at/unfulfilled_at, and the Assignment ended completed/failed at the same now(). Then the evaluated/unfulfilled activity row (assignment id, from -> to, the trimmed note, details.evaluation_id/difficulty/rating/points), the closed Candidates'' notification, the Executor''s "Task evaluat"/"Task nerealizat" notification, and -- for a Subtask -- a subtask_completed activity row on the Umbrella plus one coalesced manager notification keyed task:{umbrella}:subtasks. Returns the new task_evaluations.id.';

-- ==================== complete_task_review ====================
create function private.complete_task_review_impl(
  p_task_id    bigint,
  p_difficulty integer,
  p_rating     integer,
  p_note       text)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_task  public.tasks%rowtype;
begin
  -- 1. Malformed for everyone: an Evaluation without a note can never be
  --    written (task_evaluations_note_ck), so it is rejected before the gate
  --    -- the #335 precedent for the other evaluator-gated command.
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'evaluation_note_required';
  end if;
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: the Task's evaluator, never merely its manager.
  perform private.require_task_evaluator(p_task_id);
  -- 5. Input validation: the two numeric Evaluation inputs.
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 5 then
    raise sqlstate 'PT400' using message = 'invalid_difficulty';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise sqlstate 'PT400' using message = 'invalid_rating';
  end if;
  -- 6. State preconditions. Kind first: an Umbrella is never in_review
  --    either, so checking status first would answer task_not_in_review and
  --    hide the real reason an Umbrella can never be reviewed at all.
  if v_task.kind <> 'task' then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  if v_task.status <> 'in_review' then
    raise sqlstate 'PT409' using message = 'task_not_in_review';
  end if;
  -- 7. Mutate through the shared core, then re-read.
  perform private.evaluate_task(p_task_id, 'completed', p_difficulty, p_rating, p_note, v_actor);
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

comment on function private.complete_task_review_impl(bigint, integer, integer, text) is
  'The Task''s evaluator (private.require_task_evaluator, 42501 task_evaluate_forbidden -- never task_manage_forbidden) closes an in_review ordinary Task as completed with a Difficulty, a Rating and a required note; the actor is auth.uid(), never a parameter. A blank or null note is PT400 evaluation_note_required, raised before the membership gate; Difficulty and Rating outside 1..5 (null included) are PT400 invalid_difficulty / invalid_rating, raised under the lock once authority is established. PT409 task_is_umbrella for an Umbrella (checked first: its completion is #340''s Subtask rollup, never an Evaluation) and PT409 task_not_in_review for any other status. All writing is delegated to private.evaluate_task with outcome = completed -- the single place points are computed and written. Whether a Task was late is simply completed_at > deadline; no column records it.';

create function public.complete_task_review(
  p_task_id    bigint,
  p_difficulty integer,
  p_rating     integer,
  p_note       text)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.complete_task_review_impl(p_task_id, p_difficulty, p_rating, p_note);
$$;

comment on function public.complete_task_review(bigint, integer, integer, text) is
  'Close an in_review Task you evaluate as completed, awarding its Executor Difficulty x the Rating multiplier. Callable only by the Task''s live evaluator -- BC/Moderator anywhere, the local BCE of a Department or of a Department-Team''s parent Department, or an active Project''s lead (including their own active Assignment) or a Responsible acting on anyone''s work but the lead''s or their own; an Independent Team has no evaluator branch at all. Difficulty and Rating are 1..5 and a non-blank note is required. Credits the Executor once, ends their Assignment, closes any Candidate Queue, and -- on a Subtask -- records the progress on its Umbrella.';

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.evaluate_task(bigint, text, integer, integer, text, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.complete_task_review_impl(bigint, integer, integer, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.complete_task_review(bigint, integer, integer, text)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;

-- private.evaluate_task gets NO grant back: it is an internal writer that
-- trusts its caller to have locked and authorized, so the only callers it may
-- ever have are the security definer commands that own it.
grant execute on function private.complete_task_review_impl(bigint, integer, integer, text)
  to authenticated;
grant execute on function public.complete_task_review(bigint, integer, integer, text)
  to authenticated;
