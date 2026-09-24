-- ============================================================================
-- Tracker command wave -- end-to-end smoke test (the plan's "Verification
-- (whole stack)" bullet, made runnable).
--
-- HOW TO RUN (needs a freshly reset, SEEDED database -- it uses the eight
-- @demo.osubb personas from supabase/seed.sql, post-#296):
--
--     npx supabase db reset
--     bash scripts/smoke-tracker-commands.sh
--
--   The wrapper finds the database for you (psql if you have it, otherwise
--   `docker exec` into the local stack's db container) and inlines the
--   \ir below when it goes through docker, because psql inside the container
--   cannot see this repo on disk. To run it by hand instead:
--
--     psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/smoke-tracker-commands.sql
--
--   where DB_URL is the local stack's direct connection string, e.g.
--     export DB_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
--   (`npx supabase status` prints it as "DB URL"). Run it as the OWNER
--   (postgres): it switches into each persona itself with
--   pg_temp.test_login_leadership and switches back with `reset role`.
--
-- The whole script runs inside ONE transaction and ends in ROLLBACK, so it
-- leaves the seeded database byte-identical. Work changes use public wrappers;
-- step 23 alone prepares a rolled-back Group setting fixture under OD9.
--
-- It is deliberately NOT a pgTAP suite: every check is a `raise exception` via
-- pg_temp.smoke_assert, so the FIRST wrong step aborts with a named message
-- and ON_ERROR_STOP=1 stops the run there. A clean run prints one `ok:` notice
-- per step and ends with "SMOKE TEST PASSED".
--
-- Sequence exercised (the plan's own list, in order):
--   create a public Task -> two members express interest -> the manager
--   selects the first (#682: interest only queues) -> the second
--   withdraws and rejoins -> manager closes the queue -> Executor starts,
--   submits -> Reviewer returns with a note -> Executor resubmits -> Reviewer
--   completes -> member total reflects d x mult -> Reviewer reopens -> total
--   back -> Executor resubmits -> Reviewer completes again -> manager
--   duplicates -> Umbrella with two Subtasks, one completed one cancelled ->
--   Umbrella completes -> a Completed-work Request is approved ->
--   `authenticated` cannot write any Task table directly.
--
-- Steps 20-23 add ADR-0009 Wave 2's Group authority to that list: a Group
-- Manager (Coordonator) runs a Project Task end to end and creates one by
-- Group id alone; a Group Responsible is refused on the Manager's Task and
-- allowed on an ordinary member's; Independent-Team peers manage each other's
-- Tasks while only BC evaluates them; and a Group's Minimum Level hides an
-- organization-wide Opportunity from a member of that very Group. The
-- refusals in those steps pin the reason string, not just 42501 -- see
-- pg_temp.smoke_refused.
--
-- One deviation from the plan's sentence, and it is forced by the model:
-- "Reviewer reopens -> total back -> Reviewer completes again" cannot be two
-- consecutive commands. reopen_task leaves the Task `in_progress`, and
-- complete_task_review requires `in_review` (PT409 task_not_in_review), so the
-- Executor must submit once more in between. That submit is step 13 below and
-- is part of the round trip, not an extra liberty.
--
-- Personas (supabase/seed.sql, #296 remap):
--   d0000000-...-0007  bc@demo.osubb         Cristina Serban   bc (level 6)
--                       -> manager AND evaluator of every Origin; no BCE lives
--                          inside `edu` after the #296 remap, so a level-6
--                          account is the only manager an `edu` Task has.
--   d0000000-...-0002  voluntar@demo.osubb   Ioana Popescu     voluntar, edu
--                       -> the Candidate the manager selects as Executor.
--   d0000000-...-0005  responsabil@demo.osubb Raluca Ionescu   responsabil, edu
--                       -> the second interested member (queue), and the
--                          Executor of the Subtask that gets cancelled.
--
-- Points arithmetic (public.rating_mult: 1->-1, 2->0, 3->1, 4->2, 5->3):
--   main Task  1st evaluation  d=4 r=5 -> +12   (reversed on reopen)
--   main Task  2nd evaluation  d=3 r=4 ->  +6
--   Subtask A                  d=2 r=3 ->  +2
--   approved Request           d=1 r=3 ->  +1
--   ...all credited to voluntar@, measured as a DELTA against their seeded
--   baseline (the #296 seed already gives them ledger rows).
-- ============================================================================

begin;

set local search_path = public, extensions;

\set osubb_test_suite true
\ir ../supabase/tests/_helpers.sql

-- ==================== assertion helpers ====================

create function pg_temp.smoke_assert(p_ok boolean, p_what text)
returns void
language plpgsql
as $$
begin
  if p_ok is distinct from true then
    raise exception 'SMOKE FAILED: %', p_what;
  end if;
  raise notice 'ok: %', p_what;
end;
$$;

create function pg_temp.smoke_eq(p_got anyelement, p_want anyelement, p_what text)
returns void
language plpgsql
as $$
begin
  if p_got is distinct from p_want then
    raise exception 'SMOKE FAILED: % (got %, wanted %)', p_what, p_got, p_want;
  end if;
  raise notice 'ok: % (%)', p_what, p_got;
end;
$$;

-- Runs p_sql as the CURRENT role and demands it be refused with 42501.
-- Security invoker on purpose: it must NOT lend the owner's privileges.
create function pg_temp.smoke_denied(p_sql text, p_what text)
returns void
language plpgsql
as $$
declare
  v_state text;
  v_msg   text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state <> '42501' then
      raise exception 'SMOKE FAILED: % -- expected 42501, got % (%)', p_what, v_state, v_msg;
    end if;
    raise notice 'ok: % -- refused with 42501: %', p_what, v_msg;
    return;
  end;
  raise exception 'SMOKE FAILED: % -- the write SUCCEEDED, it must not', p_what;
end;
$$;

-- Same contract as smoke_denied, but it also pins the REASON. 42501 alone
-- cannot tell "the Group Role refused this" apart from "some other authority
-- rule fired first", and the Group scenarios below are only worth running if
-- they refuse for the rule they claim to exercise (conventions.md §3: the
-- reason names what the thing is, not which command took it).
create function pg_temp.smoke_refused(p_sql text, p_state text, p_reason text, p_what text)
returns void
language plpgsql
as $$
declare
  v_state text;
  v_msg   text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state <> p_state or v_msg <> p_reason then
      raise exception 'SMOKE FAILED: % -- expected % %, got % (%)', p_what, p_state, p_reason, v_state, v_msg;
    end if;
    raise notice 'ok: % -- refused with % %', p_what, v_state, v_msg;
    return;
  end;
  raise exception 'SMOKE FAILED: % -- the call SUCCEEDED, it must not', p_what;
end;
$$;

create function pg_temp.smoke_points(p_member uuid)
returns integer
language sql
as $$
  select coalesce(sum(delta), 0)::int
    from public.points_ledger where member_id = p_member;
$$;

-- ==================== step 0: baselines ====================

reset role;

select pg_temp.smoke_assert(
  (select count(*) = 3 from public.profiles
    where id in ('d0000000-0000-0000-0000-000000000002',
                 'd0000000-0000-0000-0000-000000000005',
                 'd0000000-0000-0000-0000-000000000007')
      and status = 'activ'),
  'step 0: the three seed personas exist and are active (run this against a seeded db reset)');

select pg_temp.smoke_assert(
  (select count(*) = 2 from public.group_members gm
    join public.groups g on g.id = gm.group_id
    where g.legacy_dept_id = 'edu'
      and gm.member_id in ('d0000000-0000-0000-0000-000000000002',
                           'd0000000-0000-0000-0000-000000000005')),
  'step 0: both interested members belong to edu (the local-Audience eligibility rule)');

select pg_temp.smoke_points('d0000000-0000-0000-0000-000000000002') as base_02 \gset
-- The Group is the only Origin a command takes. Educațional is reference data.
select id as edu_group from public.groups where legacy_dept_id = 'edu' \gset

-- ==================== step 1: manager creates a public Task ====================

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000007');

select public.create_task(
  p_title           => 'SMOKE Oportunitate publica',
  p_description     => 'Task public creat de smoke-test.sql',
  p_deadline        => now() + interval '30 days',
  p_group_id        => :edu_group,
  p_audience        => 'local',
  p_assignment_mode => 'public');

reset role;
select id as t_main from public.tasks where title = 'SMOKE Oportunitate publica' \gset

select pg_temp.smoke_assert(
  (select status = 'todo' and assignment_mode = 'public'
      and queue_opened_at is not null and queue_closed_at is null
      and created_by = 'd0000000-0000-0000-0000-000000000007'
     from public.tasks where id = :t_main),
  'step 1: create_task left a todo public Task with an open queue and the manager as creator');

select pg_temp.smoke_assert(
  (select count(*) = 1 from public.task_activity
    where task_id = :t_main and kind = 'created' and to_status = 'todo'),
  'step 1: exactly one `created` activity row');

-- ==================== step 2: two members queue, the manager selects ====================
-- #682 (ruling R9): interest only queues -- nobody becomes the Executor by
-- arriving first. The manager picks one with select_task_candidate.

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000002');
select public.express_task_interest(:t_main);
reset role;
select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000005');
select public.express_task_interest(:t_main);
reset role;

select pg_temp.smoke_assert(
  (select count(*) = 0 from public.task_assignments where task_id = :t_main),
  'step 2: expressing interest opened no Assignment -- nobody is Executor by arriving first');

select pg_temp.smoke_eq(
  (select count(*)::int from public.task_candidates
    where task_id = :t_main and status = 'pending'), 2,
  'step 2: both interested members are pending Candidates');

select id as c_first from public.task_candidates
 where task_id = :t_main and member_id = 'd0000000-0000-0000-0000-000000000002' \gset

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000007');
select public.select_task_candidate(:t_main, :c_first, false);
reset role;

select pg_temp.smoke_assert(
  (select count(*) = 1 from public.task_assignments
    where task_id = :t_main and ended_at is null
      and member_id = 'd0000000-0000-0000-0000-000000000002'),
  'step 2: the manager''s selection made the first Candidate the one active Executor');

select pg_temp.smoke_assert(
  (select details ->> 'via' = 'select' from public.task_activity
    where task_id = :t_main and kind = 'executor_assigned'),
  'step 2: the executor_assigned row records details.via = select');

-- ==================== step 3: the second member is still queued ====================

select pg_temp.smoke_assert(
  (select count(*) = 1 from public.task_candidates
    where task_id = :t_main and status = 'pending'
      and member_id = 'd0000000-0000-0000-0000-000000000005'),
  'step 3: the second interested member stayed a pending Candidate (the queue was kept open)');

select pg_temp.smoke_eq(
  (select count(*)::int from public.task_candidates
    where task_id = :t_main and status = 'pending'), 1,
  'step 3: pending candidate count');

-- ==================== step 4: the second withdraws ====================

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000005');
select public.withdraw_task_interest(:t_main);
reset role;

select pg_temp.smoke_assert(
  (select count(*) = 1 from public.task_candidates
    where task_id = :t_main and status = 'withdrawn'
      and member_id = 'd0000000-0000-0000-0000-000000000005'
      and decided_by = 'd0000000-0000-0000-0000-000000000005'),
  'step 4: withdrawal marked the Candidature withdrawn, decided by the member themselves');

select pg_temp.smoke_eq(
  (select count(*)::int from public.task_candidates
    where task_id = :t_main and status = 'pending'), 0,
  'step 4: pending candidate count after the withdrawal');

-- ==================== step 5: ...and rejoins (a NEW row at the end) ====================

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000005');
select public.express_task_interest(:t_main);
reset role;

select pg_temp.smoke_eq(
  (select count(*)::int from public.task_candidates
    where task_id = :t_main and member_id = 'd0000000-0000-0000-0000-000000000005'), 2,
  'step 5: rejoining wrote a SECOND Candidature row (the partial unique index permits it)');

select pg_temp.smoke_eq(
  (select count(*)::int from public.task_candidates
    where task_id = :t_main and status = 'pending'), 1,
  'step 5: exactly one of them is pending again');

-- ==================== step 6: the manager closes the queue ====================

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000007');
select public.set_task_queue(:t_main, false);
reset role;

select pg_temp.smoke_assert(
  (select queue_closed_at is not null from public.tasks where id = :t_main),
  'step 6: set_task_queue(false) stamped queue_closed_at');

select pg_temp.smoke_assert(
  (select count(*) = 0 from public.task_candidates
    where task_id = :t_main and status = 'pending'),
  'step 6: every pending Candidature was closed with it');

select pg_temp.smoke_assert(
  (select count(*) = 1 from public.task_activity
    where task_id = :t_main and kind = 'queue_closed'),
  'step 6: set_task_queue is the one command that logs a queue_closed activity row');

-- ==================== step 7: the Executor starts ====================

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000002');
select public.start_task(:t_main);
reset role;

select pg_temp.smoke_assert(
  (select status = 'in_progress' and started_at is not null
     from public.tasks where id = :t_main),
  'step 7: start_task moved todo -> in_progress and stamped started_at');

-- ==================== step 8: the Executor submits ====================

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000002');
select public.submit_task_for_review(:t_main);
reset role;

select pg_temp.smoke_assert(
  (select status = 'in_review' and submitted_at is not null and review_round = 0
     from public.tasks where id = :t_main),
  'step 8: submit_task_for_review moved in_progress -> in_review, review_round untouched');

-- ==================== step 9: the Reviewer returns it with a note ====================

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000007');
select public.return_task_to_progress(:t_main, 'Mai lipsesc doua sectiuni din raport.');
reset role;

select pg_temp.smoke_assert(
  (select status = 'in_progress' and submitted_at is null
      and review_round = 1 and returned_to_progress_at is not null
     from public.tasks where id = :t_main),
  'step 9: return_task_to_progress nulled submitted_at, incremented review_round, stamped the return');

select pg_temp.smoke_assert(
  (select note = 'Mai lipsesc doua sectiuni din raport.'
     from public.task_activity
    where task_id = :t_main and kind = 'returned_to_progress'),
  'step 9: the note is on the returned_to_progress activity row, trimmed');

select pg_temp.smoke_assert(
  (select count(*) = 1 from public.notifications
    where task_id = :t_main
      and member_id = 'd0000000-0000-0000-0000-000000000002'
      and title like 'Feedback de implementat:%'),
  'step 9: the Executor got the pinned "Feedback de implementat" notification');

-- ==================== step 10: the Executor resubmits ====================

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000002');
select public.submit_task_for_review(:t_main);
reset role;

select pg_temp.smoke_assert(
  (select status = 'in_review' and submitted_at is not null
      and review_round = 1 and returned_to_progress_at is not null
     from public.tasks where id = :t_main),
  'step 10: the resubmission set submitted_at again and left review_round / returned_to_progress_at alone');

-- ==================== step 11: the Reviewer completes it ====================

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000007');
select public.complete_task_review(:t_main, 4, 5, 'Raport complet si la timp.');
reset role;

select pg_temp.smoke_assert(
  (select status = 'completed' and completed_at is not null
      and difficulty = 4 and rating = 5
     from public.tasks where id = :t_main),
  'step 11: complete_task_review closed the Task as completed with its Difficulty and Rating');

select pg_temp.smoke_assert(
  (select count(*) = 1 from public.task_assignments
    where task_id = :t_main and ended_at is not null and end_reason = 'completed'),
  'step 11: the Assignment ended `completed`');

select pg_temp.smoke_eq(
  (select points from public.task_evaluations
    where task_id = :t_main and source = 'command' and reversed_at is null), 12,
  'step 11: the Evaluation stored d x rating_mult = 4 x 3');

-- ==================== step 12: the member total reflects d x mult ====================

select pg_temp.smoke_eq(
  pg_temp.smoke_points('d0000000-0000-0000-0000-000000000002'), :base_02 + 12,
  'step 12: the Executor''s ledger total rose by exactly 12');

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000002');
select pg_temp.smoke_eq(
  (select points from public.my_points), :base_02 + 12,
  'step 12: public.my_points, read by the member themselves, agrees');
reset role;

-- ==================== step 13: the Reviewer reopens -> total back ====================

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000007');
select public.reopen_task(:t_main, 'Sectiunea de buget trebuie refacuta.');
reset role;

select pg_temp.smoke_assert(
  (select status = 'in_progress' and completed_at is null
      and difficulty is null and rating is null and submitted_at is null
      and started_at is not null and queue_closed_at is not null
     from public.tasks where id = :t_main),
  'step 13: reopen_task returned it to in_progress, cleared the Evaluation inputs, LEFT the queue closed');

select pg_temp.smoke_assert(
  (select count(*) = 1 from public.task_evaluations
    where task_id = :t_main and reversed_at is not null
      and reversed_by = 'd0000000-0000-0000-0000-000000000007'),
  'step 13: the Evaluation is marked reversed, not deleted');

select pg_temp.smoke_eq(
  (select count(*)::int from public.points_ledger
    where task_id = :t_main and reason = 'task_reversal'), 1,
  'step 13: exactly one task_reversal ledger row was appended');

select pg_temp.smoke_eq(
  pg_temp.smoke_points('d0000000-0000-0000-0000-000000000002'), :base_02,
  'step 13: the total is back to EXACTLY its pre-evaluation value');

select pg_temp.smoke_assert(
  (select count(*) = 1 from public.task_assignments
    where task_id = :t_main and ended_at is null
      and member_id = 'd0000000-0000-0000-0000-000000000002'),
  'step 13: the same member holds a NEW active Assignment');

select pg_temp.smoke_assert(
  (select count(*) = 0 from public.task_candidates
    where task_id = :t_main and member_id = 'd0000000-0000-0000-0000-000000000002'
      and status = 'pending'),
  'step 13 (cross-command invariant): the reactivated Executor holds no pending Candidature');

-- ==================== step 14: resubmit, then complete again ====================
-- reopen leaves the Task in_progress; complete_task_review demands in_review.

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000002');
select public.submit_task_for_review(:t_main);
reset role;

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000007');
select public.complete_task_review(:t_main, 3, 4, 'Bugetul este acum corect.');
reset role;

select pg_temp.smoke_eq(
  (select count(*)::int from public.task_evaluations
    where task_id = :t_main and source = 'command'), 2,
  'step 14: a second Evaluation stands beside the reversed one');

select pg_temp.smoke_eq(
  pg_temp.smoke_points('d0000000-0000-0000-0000-000000000002'), :base_02 + 6,
  'step 14: the second award (3 x 2) is the only one standing');

-- ==================== step 15: the manager duplicates it ====================

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000007');
select public.duplicate_task(:t_main, now() + interval '60 days');
reset role;

select id as t_clone from public.tasks where duplicated_from_task_id = :t_main \gset

select pg_temp.smoke_assert(
  (select status = 'todo' and difficulty is null and rating is null
      and completed_at is null and cancel_reason is null
      and parent_task_id is null
      and group_id = :edu_group and audience = 'local' and assignment_mode = 'public'
      and queue_opened_at is not null
      and created_by = 'd0000000-0000-0000-0000-000000000007'
     from public.tasks where id = :t_clone),
  'step 15: the clone is a fresh todo Task, same Origin/Audience/Mode, no inherited outcome');

select pg_temp.smoke_assert(
  (select count(*) = 0 from public.task_assignments where task_id = :t_clone),
  'step 15: the clone carries no Executor');

select pg_temp.smoke_assert(
  (select count(*) = 1 from public.task_activity
    where task_id = :t_main and kind = 'duplicated'),
  'step 15: the SOURCE carries the `duplicated` activity row');

-- ==================== step 16: an Umbrella with two Subtasks ====================

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000007');

select public.create_task(
  p_title           => 'SMOKE Umbrela',
  p_description     => 'Umbrela creata de smoke-test.sql',
  p_deadline        => null,
  p_group_id        => :edu_group,
  p_audience        => null,
  p_assignment_mode => null,
  p_kind            => 'umbrella');

reset role;
select id as t_umb from public.tasks where title = 'SMOKE Umbrela' \gset

select pg_temp.smoke_assert(
  (select kind = 'umbrella' and audience is null and assignment_mode is null
      and parent_task_id is null and status = 'todo'
     from public.tasks where id = :t_umb),
  'step 16: the Umbrella has no Audience, no Assignment Mode and no parent');

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000007');

-- Subtask A: origin inherited (no p_group_id), direct, with
-- an Executor -- this one gets completed.
select public.create_task(
  p_title           => 'SMOKE Subtask A',
  p_description     => 'Subtaskul care se finalizeaza',
  p_deadline        => now() + interval '20 days',
  p_audience        => 'local',
  p_assignment_mode => 'direct',
  p_executor_id     => 'd0000000-0000-0000-0000-000000000002',
  p_parent_task_id  => :t_umb);

-- Subtask B: this one gets cancelled.
select public.create_task(
  p_title           => 'SMOKE Subtask B',
  p_description     => 'Subtaskul care se anuleaza',
  p_deadline        => now() + interval '20 days',
  p_audience        => 'local',
  p_assignment_mode => 'direct',
  p_executor_id     => 'd0000000-0000-0000-0000-000000000005',
  p_parent_task_id  => :t_umb);

reset role;
select id as t_sub_a from public.tasks where title = 'SMOKE Subtask A' \gset
select id as t_sub_b from public.tasks where title = 'SMOKE Subtask B' \gset

select pg_temp.smoke_assert(
  (select count(*) = 2 from public.tasks
    where parent_task_id = :t_umb and group_id = :edu_group),
  'step 16: both Subtasks inherited the Umbrella''s Origin without it being passed');

-- ---- Subtask A: worked and completed.
select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000002');
select public.start_task(:t_sub_a);
select public.submit_task_for_review(:t_sub_a);
reset role;

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000007');
select public.complete_task_review(:t_sub_a, 2, 3, 'Subtask livrat.');
reset role;

select pg_temp.smoke_eq(
  (select status::text from public.tasks where id = :t_sub_a), 'completed',
  'step 16: Subtask A is completed');

select pg_temp.smoke_eq(
  pg_temp.smoke_points('d0000000-0000-0000-0000-000000000002'), :base_02 + 6 + 2,
  'step 16: Subtask A credited 2 x 1 = 2 more points');

select pg_temp.smoke_assert(
  (select count(*) = 1 from public.task_activity
    where task_id = :t_umb and kind = 'subtask_completed'
      and (details ->> 'subtask_id')::bigint = :t_sub_a
      and details ->> 'outcome' = 'completed'),
  'step 16: the Umbrella got a subtask_completed rollup row for A');

-- ---- Subtask B: cancelled.
select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000007');
select public.cancel_task(:t_sub_b, 'Nu mai este nevoie de acest subtask.');
reset role;

select pg_temp.smoke_assert(
  (select status = 'cancelled' and cancelled_at is not null
      and cancel_reason = 'Nu mai este nevoie de acest subtask.'
     from public.tasks where id = :t_sub_b),
  'step 16: Subtask B is cancelled WITH its reason (tasks_cancel_reason_ck)');

select pg_temp.smoke_assert(
  (select count(*) = 1 from public.task_assignments
    where task_id = :t_sub_b and ended_at is not null and end_reason = 'cancelled'),
  'step 16: B''s Assignment ended `cancelled`');

select pg_temp.smoke_eq(
  (select count(*)::int from public.task_evaluations where task_id = :t_sub_b), 0,
  'step 16: a cancelled Task is never evaluated and pays nobody');

select pg_temp.smoke_eq(
  (select count(*)::int from public.task_activity
    where task_id = :t_umb and kind = 'subtask_completed'), 2,
  'step 16: cancelling B on its own also rolled up to the Umbrella');

-- ==================== step 17: the Umbrella completes ====================

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000007');
select public.complete_umbrella_task(:t_umb);
reset role;

select pg_temp.smoke_assert(
  (select status = 'completed' and completed_at is not null
      and difficulty is null and rating is null
     from public.tasks where id = :t_umb),
  'step 17: complete_umbrella_task closed the Umbrella as a rollup -- no Difficulty, no Rating');

select pg_temp.smoke_eq(
  (select count(*)::int from public.task_evaluations where task_id = :t_umb), 0,
  'step 17: the Umbrella carries no Evaluation');

select pg_temp.smoke_assert(
  (select count(*) = 1 from public.task_activity
    where task_id = :t_umb and kind = 'umbrella_completed'
      and (details ->> 'subtask_count')::int = 2),
  'step 17: one umbrella_completed row naming both Subtasks');

-- ==================== step 18: a Completed-work Request is approved ====================

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000002');
select public.create_completed_work_request(
  'SMOKE am facut afisele pentru standul de la deschidere', :edu_group);
reset role;

select id as r_id from public.completed_work_requests
 where description = 'SMOKE am facut afisele pentru standul de la deschidere' \gset

select pg_temp.smoke_assert(
  (select status = 'pending' and group_id = :edu_group
      and requester_id = 'd0000000-0000-0000-0000-000000000002'
      and task_id is null
     from public.completed_work_requests where id = :r_id),
  'step 18: the Request landed pending against the requester''s own Department');

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000007');
select public.approve_completed_work_request(:r_id, 1, 3, 'Afisele au fost folosite la eveniment.');
reset role;

select task_id as t_req from public.completed_work_requests where id = :r_id \gset

select pg_temp.smoke_assert(
  (select status = 'approved' and task_id is not null
      and decided_by = 'd0000000-0000-0000-0000-000000000007'
      and decided_at is not null
      and decision_note = 'Afisele au fost folosite la eveniment.'
     from public.completed_work_requests where id = :r_id),
  'step 18: the Request is approved and names the Task it minted');

select pg_temp.smoke_assert(
  (select status = 'completed' and completed_at is not null
      and assignment_mode = 'direct' and audience = 'local' and group_id = :edu_group
      and difficulty = 1 and rating = 3
     from public.tasks where id = :t_req),
  'step 18: the Task was born already finished, direct and local, on the Request''s Origin');

select pg_temp.smoke_assert(
  (select count(*) = 1 from public.task_assignments
    where task_id = :t_req and member_id = 'd0000000-0000-0000-0000-000000000002'
      and ended_at is not null and end_reason = 'completed'),
  'step 18: the requester holds the (ended) Assignment');

select pg_temp.smoke_eq(
  (select count(*)::int from public.task_candidates where task_id = :t_req), 0,
  'step 18 (cross-command invariant): the minted Task has no Candidature at all');

select pg_temp.smoke_eq(
  pg_temp.smoke_points('d0000000-0000-0000-0000-000000000002'), :base_02 + 6 + 2 + 1,
  'step 18: approval credited 1 x 1 = 1 more point -- +9 in total across the run');

-- ==================== step 19: authenticated cannot write any Task table ====================
-- Every one of these is syntactically valid; the ONLY reason it fails is the
-- privilege #345 revoked. Run as a real, active member -- not anon -- so this
-- proves the commands are the only write path, not merely that anon is shut out.

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000002');

select pg_temp.smoke_denied(
  $$ insert into public.tasks (title, group_id, audience, assignment_mode, status)
     select 'SMOKE direct insert', id, 'local', 'direct', 'todo'::public.task_status
       from public.groups where legacy_dept_id = 'edu' $$,
  'step 19: direct INSERT into public.tasks');

select pg_temp.smoke_denied(
  $$ update public.tasks set title = 'SMOKE direct update' where title like 'SMOKE%' $$,
  'step 19: direct UPDATE of public.tasks');

select pg_temp.smoke_denied(
  $$ delete from public.tasks where title like 'SMOKE%' $$,
  'step 19: direct DELETE from public.tasks');

select pg_temp.smoke_denied(
  $$ insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
     select id, 'd0000000-0000-0000-0000-000000000002',
            'd0000000-0000-0000-0000-000000000002', now()
       from public.tasks limit 1 $$,
  'step 19: direct INSERT into public.task_assignments');

select pg_temp.smoke_denied(
  $$ insert into public.task_candidates (task_id, member_id, status, joined_at)
     select id, 'd0000000-0000-0000-0000-000000000002', 'pending', now()
       from public.tasks limit 1 $$,
  'step 19: direct INSERT into public.task_candidates');

select pg_temp.smoke_denied(
  $$ insert into public.task_activity (task_id, kind, actor_id, details)
     select id, 'created', 'd0000000-0000-0000-0000-000000000002', '{}'::jsonb
       from public.tasks limit 1 $$,
  'step 19: direct INSERT into public.task_activity');

select pg_temp.smoke_denied(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, source, evaluated_by, outcome, difficulty, rating, points, note)
     select a.task_id, a.id, 'command', 'd0000000-0000-0000-0000-000000000002',
            'completed', 5, 5, 15, 'forged'
       from public.task_assignments a limit 1 $$,
  'step 19: direct INSERT into public.task_evaluations');

select pg_temp.smoke_denied(
  $$ update public.completed_work_requests set status = 'approved' where status = 'pending' $$,
  'step 19: direct UPDATE of public.completed_work_requests');

select pg_temp.smoke_denied(
  $$ insert into public.campaigns (group_id, name, created_by)
     select id, 'SMOKE campanie', 'd0000000-0000-0000-0000-000000000002'::uuid
       from public.groups where legacy_dept_id = 'edu' $$,
  'step 19: direct INSERT into public.campaigns');

select pg_temp.smoke_denied(
  $$ insert into public.groups (name, category) values ('SMOKE forged Group', 'team') $$,
  'step 19: direct INSERT into public.groups');
select pg_temp.smoke_denied(
  $$ update public.groups set name = 'SMOKE forged rename' where legacy_dept_id = 'edu' $$,
  'step 19: direct UPDATE of public.groups');
select pg_temp.smoke_denied(
  $$ delete from public.groups where legacy_dept_id = 'edu' $$,
  'step 19: direct DELETE from public.groups');
select pg_temp.smoke_denied(
  $$ insert into public.group_members (group_id, member_id, group_role)
     select id, 'd0000000-0000-0000-0000-000000000002', 'manager'
     from public.groups where legacy_dept_id = 'edu' $$,
  'step 19: direct INSERT into public.group_members');
select pg_temp.smoke_denied(
  $$ update public.group_members set group_role = 'manager'
     where member_id = 'd0000000-0000-0000-0000-000000000002' $$,
  'step 19: direct UPDATE of public.group_members');
select pg_temp.smoke_denied(
  $$ delete from public.group_members where member_id = 'd0000000-0000-0000-0000-000000000002' $$,
  'step 19: direct DELETE from public.group_members');

-- points_ledger is the deliberate exception: `authenticated` KEEPS insert for
-- the BC sanction path (points_ledger_create_sanction), so #345 did not revoke it. A forged
-- credit must therefore be refused by RLS rather than by the ACL -- same 42501,
-- different mechanism. A `sanction`-shaped row is used because it satisfies
-- points_ledger's own shape constraint (only `task`/`task_reversal` rows need a
-- task_id and an evaluation_id), so the ONLY thing left to reject it is the
-- points_ledger_create_sanction policy, which this voluntar cannot satisfy.
select pg_temp.smoke_denied(
  $$ insert into public.points_ledger (member_id, delta, reason)
     values ('d0000000-0000-0000-0000-000000000002', 99, 'sanction') $$,
  'step 19: forged sanction row in public.points_ledger (refused by RLS, not by the ACL)');

reset role;

-- ==================== step 20: a Coordonator manages a Project Task end to end ====================
select id as project_group from public.groups
where name = 'Festivalul Studențesc 2026'
  and created_by = 'd0000000-0000-0000-0000-000000000007' \gset
select id as coordinator from public.profiles where email = 'responsabil@demo.osubb' \gset
select id as ordinary from public.profiles where email = 'voluntar@demo.osubb' \gset
select pg_temp.smoke_points(:'ordinary') as project_points_before \gset
select pg_temp.test_login_leadership(:'coordinator');
select public.create_task('SMOKE Group manager delivery', 'Group authority round trip', now() + interval '5 days',
  'local', 'direct', :'ordinary', p_group_id => :project_group);
reset role;
select id as project_task from public.tasks where title = 'SMOKE Group manager delivery' \gset
select pg_temp.test_login_leadership(:'ordinary');
select pg_temp.smoke_denied(
  format($sql$select public.update_task_content(%s, %L, null, now() + interval '5 days', null)$sql$, :project_task, 'Unauthorized edit'),
  'step 20: ordinary Project member cannot manage their Task');
select public.start_task(:project_task);
select public.submit_task_for_review(:project_task);
reset role;
select pg_temp.test_login_leadership(:'coordinator');
select public.complete_task_review(:project_task, 2, 3, 'Coordonator confirmed delivery.');
reset role;
select pg_temp.smoke_assert(
  (select status = 'completed' and group_id = :project_group from public.tasks where id = :project_task),
  'step 20: Coordonator completes the Group-owned Project Task');
select pg_temp.smoke_eq(pg_temp.smoke_points(:'ordinary'), :project_points_before + 2,
  'step 20: ordinary Executor receives the exact Evaluation points');

-- ---- step 20, continued: the Group-side create, and the manage commands ----
-- Since #579 every create names its Group by id (p_group_id) -- the legacy
-- Origin arguments and the bridge that translated them are gone. This half
-- creates with named arguments, the shape the Wave 3 client uses.
-- It also runs the Coordonator's *manage* commands (update content, assign,
-- close the queue); complete_task_review above only proves the evaluator side.
select pg_temp.test_login_leadership(:'coordinator');
select public.create_task(
  p_title => 'SMOKE Group-side Origin',
  p_description => 'Created by Group id alone',
  p_deadline => now() + interval '6 days',
  p_audience => 'local', p_assignment_mode => 'direct',
  p_group_id => :project_group);
reset role;
select id as group_side_task from public.tasks where title = 'SMOKE Group-side Origin' \gset
select pg_temp.smoke_assert(
  (select group_id = :project_group
     from public.tasks where id = :group_side_task),
  'step 20: a create by Group id alone lands on that Group');
select pg_temp.test_login_leadership(:'coordinator');
select public.update_task_content(:group_side_task, 'SMOKE Group-side Origin',
  'Managed through the Group Role', now() + interval '6 days', null);
select public.assign_task_executor(:group_side_task, :'ordinary');
reset role;
select pg_temp.smoke_assert(
  (select description = 'Managed through the Group Role' from public.tasks where id = :group_side_task)
  and exists (select 1 from public.task_assignments
               where task_id = :group_side_task and member_id = :'ordinary' and ended_at is null),
  'step 20: the Coordonator edits and assigns a Task they do not execute');
select pg_temp.test_login_leadership(:'coordinator');
select public.create_task(
  p_title => 'SMOKE Group-side queue',
  p_description => 'Queue managed through the Group Role',
  p_deadline => now() + interval '6 days',
  p_audience => 'local', p_assignment_mode => 'public',
  p_group_id => :project_group);
reset role;
select id as group_side_queue from public.tasks where title = 'SMOKE Group-side queue' \gset
select pg_temp.test_login_leadership(:'coordinator');
select public.set_task_queue(:group_side_queue, false);
reset role;
select pg_temp.smoke_assert(
  (select queue_closed_at is not null and group_id = :project_group
     from public.tasks where id = :group_side_queue),
  'step 20: the Coordonator closes the Candidate Queue of a Group-side Task');

-- ==================== step 21: a Responsible evaluates ordinary members, never the Manager ====================
select id as project_group from public.groups
where name = 'Festivalul Studențesc 2026'
  and created_by = 'd0000000-0000-0000-0000-000000000007' \gset
select id as responsible from public.profiles where email = 'activ@demo.osubb' \gset
select id as coordinator from public.profiles where email = 'responsabil@demo.osubb' \gset
select id as ordinary from public.profiles where email = 'voluntar@demo.osubb' \gset
select pg_temp.test_login_leadership(:'coordinator');
select public.create_task('SMOKE Manager protected', 'Manager work', now() + interval '5 days',
  'local', 'direct', :'coordinator', p_group_id => :project_group);
select public.create_task('SMOKE Ordinary review', 'Ordinary member work', now() + interval '5 days',
  'local', 'direct', :'ordinary', p_group_id => :project_group);
reset role;
select id as manager_task from public.tasks where title = 'SMOKE Manager protected' \gset
select id as ordinary_task from public.tasks where title = 'SMOKE Ordinary review' \gset
select pg_temp.test_login_leadership(:'coordinator');
select public.start_task(:manager_task);
select public.submit_task_for_review(:manager_task);
reset role;
select pg_temp.test_login_leadership(:'ordinary');
select public.start_task(:ordinary_task);
select public.submit_task_for_review(:ordinary_task);
reset role;
select pg_temp.test_login_leadership(:'responsible');
select pg_temp.smoke_denied(format($sql$select public.update_task_content(%s, %L, null, now() + interval '5 days', null)$sql$, :manager_task, 'Forbidden'),
  'step 21: Responsible cannot edit the Group Manager''s Task');
select pg_temp.smoke_denied(format('select public.complete_task_review(%s, 2, 3, %L)', :manager_task, 'Forbidden'),
  'step 21: Responsible cannot evaluate the Group Manager''s Task');
select public.update_task_content(:ordinary_task, 'SMOKE Ordinary review', 'Responsible prepared review', now() + interval '5 days', null);
select public.complete_task_review(:ordinary_task, 2, 3, 'Responsible confirmed ordinary member work.');
reset role;
select pg_temp.smoke_assert(
  (select status = 'completed' and description = 'Responsible prepared review' from public.tasks where id = :ordinary_task),
  'step 21: Responsible manages and evaluates ordinary member work');
select pg_temp.smoke_assert(
  (select status = 'in_review' from public.tasks where id = :manager_task)
  and not exists (select 1 from public.task_evaluations where task_id = :manager_task),
  'step 21: denied Manager evaluation leaves status and Evaluation history untouched');

-- ---- step 21, continued: the refusals name the Group rule, not just 42501 ----
-- smoke_denied above proves only that something refused. These three pin the
-- reason string, so a refusal arriving from an unrelated rule (a gate, a
-- visibility miss, a wrong Origin) fails the step instead of passing it.
select pg_temp.test_login_leadership(:'responsible');
select pg_temp.smoke_refused(
  format('select public.cancel_task(%s, %L)', :manager_task, 'Responsible overreach'),
  '42501', 'task_manage_forbidden',
  'step 21: cancelling the Group Manager''s Task is refused as task_manage_forbidden');
select pg_temp.smoke_refused(
  format($sql$select public.update_task_content(%s, %L, null, now() + interval '5 days', null)$sql$, :manager_task, 'Forbidden'),
  '42501', 'task_manage_forbidden',
  'step 21: editing the Group Manager''s Task is refused as task_manage_forbidden');
select pg_temp.smoke_refused(
  format('select public.complete_task_review(%s, 2, 3, %L)', :manager_task, 'Forbidden'),
  '42501', 'task_evaluate_forbidden',
  'step 21: evaluating the Group Manager''s Task is refused as task_evaluate_forbidden');
reset role;
select pg_temp.smoke_assert(
  (select status = 'in_review' from public.tasks where id = :manager_task),
  'step 21: three refused commands leave the Group Manager''s Task in review');

-- ==================== step 22: Independent-Team peers manage, BC evaluates ====================
select id as team_group from public.groups where name = 'Echipa Logistică'
  and created_by = 'd0000000-0000-0000-0000-000000000007' \gset
select id as peer from public.profiles where email = 'vot@demo.osubb' \gset
select id as bc_peer from public.profiles where email = 'bc@demo.osubb' \gset
select pg_temp.test_login_leadership(:'peer');
select public.create_task('SMOKE Independent peers', 'Peer planned work', now() + interval '5 days',
  'local', 'direct', :'bc_peer', p_group_id => :team_group);
reset role;
select id as peer_task from public.tasks where title = 'SMOKE Independent peers' \gset
select pg_temp.test_login_leadership(:'bc_peer');
select public.start_task(:peer_task);
select public.submit_task_for_review(:peer_task);
reset role;
select pg_temp.test_login_leadership(:'peer');
select public.update_task_content(:peer_task, 'SMOKE Independent peers', 'Peer manages teammate work', now() + interval '5 days', null);
select pg_temp.smoke_denied(format('select public.complete_task_review(%s, 1, 3, %L)', :peer_task, 'Peer cannot evaluate'),
  'step 22: an Independent-Team Responsible cannot evaluate a teammate');
reset role;
select pg_temp.smoke_assert(
  (select group_id = :team_group and status = 'in_review' and description = 'Peer manages teammate work'
    from public.tasks where id = :peer_task),
  'step 22: peer management succeeds while refused evaluation leaves the Task in review');
select pg_temp.test_login_leadership(:'bc_peer');
select public.complete_task_review(:peer_task, 1, 3, 'BC evaluation of Independent-Team work.');
reset role;
select pg_temp.smoke_eq((select status::text from public.tasks where id = :peer_task), 'completed',
  'step 22: BC can perform the required evaluation');

-- ---- step 22, continued: a peer who is NOT BC, and the refusal's reason ----
-- Above, the teammate whose Task the peer manages is bc@ (level 6), so the
-- management half could in principle be answered by something about BC rather
-- than by the Independent-Team peer rule. Add a third teammate through the
-- public Group command, appointing the Independent-Team peer as Responsible,
-- then drive the same pair against them.
select id as third_peer from public.profiles where email = 'activ@demo.osubb' \gset
select pg_temp.test_login_leadership(:'bc_peer');
select public.set_group_role(:team_group, :'third_peer', 'responsible', 'Membru Logistică');
reset role;
select pg_temp.smoke_assert(
  (select group_role = 'responsible' from public.group_members
    where group_id = :team_group and member_id = :'third_peer'),
  'step 22: the roster command appoints the new teammate as a Group Responsible');
select pg_temp.test_login_leadership(:'peer');
select public.create_task(
  p_title => 'SMOKE Independent peer pair',
  p_description => 'Peer planned work for a non-BC teammate',
  p_deadline => now() + interval '5 days',
  p_audience => 'local', p_assignment_mode => 'direct',
  p_executor_id => :'third_peer',
  p_group_id => :team_group);
reset role;
select id as pair_task from public.tasks where title = 'SMOKE Independent peer pair' \gset
select pg_temp.test_login_leadership(:'third_peer');
select public.start_task(:pair_task);
select public.submit_task_for_review(:pair_task);
reset role;
select pg_temp.test_login_leadership(:'peer');
select public.update_task_content(:pair_task, 'SMOKE Independent peer pair',
  'Peer manages a non-BC teammate', now() + interval '5 days', null);
select pg_temp.smoke_refused(
  format('select public.complete_task_review(%s, 1, 3, %L)', :pair_task, 'Peer cannot evaluate'),
  '42501', 'task_evaluate_forbidden',
  'step 22: evaluating a fellow Responsible is refused as task_evaluate_forbidden');
reset role;
select pg_temp.smoke_assert(
  (select group_id = :team_group
      and status = 'in_review' and description = 'Peer manages a non-BC teammate'
     from public.tasks where id = :pair_task),
  'step 22: the peer manages a non-BC teammate on a Group-side Independent-Team Task');

-- ==================== step 23: Group Minimum Level hides and closes an org Opportunity ====================
select id as gated_group from public.groups
where name = 'Festivalul Studențesc 2026'
  and created_by = 'd0000000-0000-0000-0000-000000000007' \gset
select id as coordinator from public.profiles where email = 'responsabil@demo.osubb' \gset
select id as below_minimum from public.profiles where email = 'voluntar@demo.osubb' \gset
select id as eligible from public.profiles where email = 'vot@demo.osubb' \gset
-- OD9: only fixture setup changes a Group setting directly, as owner, inside this rollback.
-- Wave 3 owns the public Group settings commands; all work below uses existing public commands.
update public.groups set min_level = 3, application_level = 3 where id = :gated_group;
select pg_temp.test_login_leadership(:'coordinator');
select public.create_task('SMOKE Gated org Opportunity', 'Minimum Level proof', now() + interval '5 days',
  'org', 'public', p_group_id => :gated_group);
reset role;
select id as gated_task from public.tasks where title = 'SMOKE Gated org Opportunity' \gset
create function pg_temp.smoke_hidden_interest(p_task bigint) returns void language plpgsql as $$
begin
  begin
    perform public.express_task_interest(p_task);
  exception when sqlstate 'PT404' then
    if sqlerrm <> 'task_not_found' then raise; end if;
    raise notice 'ok: step 23: below-Minimum-Level interest refused as task_not_found';
    return;
  end;
  raise exception 'SMOKE FAILED: step 23 below-Minimum-Level interest succeeded';
end;
$$;
select pg_temp.test_login_leadership(:'below_minimum');
select pg_temp.smoke_eq((select count(*)::int from public.tasks where id = :gated_task), 0,
  'step 23: below-Minimum-Level member cannot discover the org Opportunity');
-- A hidden Task must answer the same as an unknown Task, rather than leak its audience.
select pg_temp.smoke_hidden_interest(:gated_task);
reset role;
select pg_temp.smoke_assert(
  not exists (select 1 from public.task_assignments where task_id = :gated_task)
  and not exists (select 1 from public.task_candidates where task_id = :gated_task),
  'step 23: refused interest writes neither Assignment nor Candidature');
select pg_temp.test_login_leadership(:'eligible');
select pg_temp.smoke_eq((select count(*)::int from public.tasks where id = :gated_task), 1,
  'step 23: eligible outsider can discover the org Opportunity');
select public.express_task_interest(:gated_task);
reset role;
select pg_temp.smoke_assert(
  (select count(*) = 1 from public.task_candidates
   where task_id = :gated_task and member_id = :'eligible' and status = 'pending')
  and not exists (select 1 from public.task_assignments where task_id = :gated_task),
  'step 23: eligible outsider joins the Candidate Queue through the public command (#682: no Executor by arrival)');

-- ---- step 23, continued: it really is the Minimum Level doing the hiding ----
-- Two facts turn "one member saw nothing" into a proof about the setting:
-- the member who sees nothing is an explicit member of the owning Group (so
-- membership is not what is missing), and the member who sees it is NOT
-- (so it is the org Audience, at or above the Minimum Level, that opens it).
select pg_temp.smoke_assert(
  exists (select 1 from public.group_members
           where group_id = :gated_group and member_id = :'below_minimum'),
  'step 23: the member who cannot see the Opportunity belongs to the owning Group');
select pg_temp.smoke_assert(
  not exists (select 1 from public.group_members
               where group_id = :gated_group and member_id = :'eligible'),
  'step 23: the member who can see it belongs to the Group only through the org Audience');
-- The brief's own persona: a Recrut, level 0, four levels under the fixture.
select id as recruit from public.profiles where email = 'recrut@demo.osubb' \gset
select pg_temp.test_login_leadership(:'recruit');
select pg_temp.smoke_eq((select count(*)::int from public.tasks where id = :gated_task), 0,
  'step 23: a Recrut cannot discover the gated org Opportunity either');
select pg_temp.smoke_refused(
  format('select public.express_task_interest(%s)', :gated_task),
  'PT404', 'task_not_found',
  'step 23: a Recrut''s interest is refused as task_not_found, not as a denial');
reset role;

-- ==================== done ====================

do $$
begin
  raise notice '';
  raise notice '================ SMOKE TEST PASSED ================';
  raise notice 'All 23 work scenarios ran through public wrappers;';
  raise notice 'authenticated could not write Task or Group tables directly.';
  raise notice 'Only the step 23 OD9 fixture used an owner-written Group setting.';
  raise notice 'Rolling back -- the database is unchanged.';
end;
$$;

rollback;
