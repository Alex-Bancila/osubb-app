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
-- leaves the seeded database byte-identical. It never touches a row except
-- through the public wrappers.
--
-- It is deliberately NOT a pgTAP suite: every check is a `raise exception` via
-- pg_temp.smoke_assert, so the FIRST wrong step aborts with a named message
-- and ON_ERROR_STOP=1 stops the run there. A clean run prints one `ok:` notice
-- per step and ends with "SMOKE TEST PASSED".
--
-- Sequence exercised (the plan's own list, in order):
--   create a public Task -> two members express interest -> the second
--   withdraws and rejoins -> manager closes the queue -> Executor starts,
--   submits -> Reviewer returns with a note -> Executor resubmits -> Reviewer
--   completes -> member total reflects d x mult -> Reviewer reopens -> total
--   back -> Executor resubmits -> Reviewer completes again -> manager
--   duplicates -> Umbrella with two Subtasks, one completed one cancelled ->
--   Umbrella completes -> a Completed-work Request is approved ->
--   `authenticated` cannot write any Task table directly.
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
--                       -> first-come Executor.
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
  (select count(*) = 2 from public.member_departments
    where dept_id = 'edu'
      and member_id in ('d0000000-0000-0000-0000-000000000002',
                        'd0000000-0000-0000-0000-000000000005')),
  'step 0: both interested members belong to edu (the local-Audience eligibility rule)');

select pg_temp.smoke_points('d0000000-0000-0000-0000-000000000002') as base_02 \gset

-- ==================== step 1: manager creates a public Task ====================

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000007');

select public.create_task(
  p_title           => 'SMOKE Oportunitate publica',
  p_description     => 'Task public creat de smoke-test.sql',
  p_deadline        => now() + interval '30 days',
  p_dept_id         => 'edu',
  p_team_id         => null,
  p_project_id      => null,
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

-- ==================== step 2: first member takes it (first come) ====================

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000002');
select public.express_task_interest(:t_main);
reset role;

select pg_temp.smoke_assert(
  (select count(*) = 1 from public.task_assignments
    where task_id = :t_main and ended_at is null
      and member_id = 'd0000000-0000-0000-0000-000000000002'),
  'step 2: the first interested member became the one active Executor');

select pg_temp.smoke_assert(
  (select count(*) = 0 from public.task_candidates where task_id = :t_main),
  'step 2: first-come wrote NO Candidature -- the slot was empty');

select pg_temp.smoke_assert(
  (select details ->> 'via' = 'first_come' from public.task_activity
    where task_id = :t_main and kind = 'executor_assigned'),
  'step 2: the executor_assigned row records details.via = first_come');

-- ==================== step 3: second member queues ====================

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000005');
select public.express_task_interest(:t_main);
reset role;

select pg_temp.smoke_assert(
  (select count(*) = 1 from public.task_candidates
    where task_id = :t_main and status = 'pending'
      and member_id = 'd0000000-0000-0000-0000-000000000005'),
  'step 3: the second interested member queued as a pending Candidate');

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
    where task_id = :t_main and member_id = 'd0000000-0000-0000-0000-000000000002'),
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
      and dept_id = 'edu' and audience = 'local' and assignment_mode = 'public'
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
  p_dept_id         => 'edu',
  p_team_id         => null,
  p_project_id      => null,
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

-- Subtask A: origin inherited (all three Origin parameters null), direct, with
-- an Executor -- this one gets completed.
select public.create_task(
  p_title           => 'SMOKE Subtask A',
  p_description     => 'Subtaskul care se finalizeaza',
  p_deadline        => now() + interval '20 days',
  p_dept_id         => null,
  p_team_id         => null,
  p_project_id      => null,
  p_audience        => 'local',
  p_assignment_mode => 'direct',
  p_executor_id     => 'd0000000-0000-0000-0000-000000000002',
  p_parent_task_id  => :t_umb);

-- Subtask B: this one gets cancelled.
select public.create_task(
  p_title           => 'SMOKE Subtask B',
  p_description     => 'Subtaskul care se anuleaza',
  p_deadline        => now() + interval '20 days',
  p_dept_id         => null,
  p_team_id         => null,
  p_project_id      => null,
  p_audience        => 'local',
  p_assignment_mode => 'direct',
  p_executor_id     => 'd0000000-0000-0000-0000-000000000005',
  p_parent_task_id  => :t_umb);

reset role;
select id as t_sub_a from public.tasks where title = 'SMOKE Subtask A' \gset
select id as t_sub_b from public.tasks where title = 'SMOKE Subtask B' \gset

select pg_temp.smoke_assert(
  (select count(*) = 2 from public.tasks
    where parent_task_id = :t_umb and dept_id = 'edu'),
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
  'SMOKE am facut afisele pentru standul de la deschidere', 'edu', null, null);
reset role;

select id as r_id from public.completed_work_requests
 where description = 'SMOKE am facut afisele pentru standul de la deschidere' \gset

select pg_temp.smoke_assert(
  (select status = 'pending' and dept_id = 'edu'
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
      and assignment_mode = 'direct' and audience = 'local' and dept_id = 'edu'
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
  $$ insert into public.tasks (title, dept_id, audience, assignment_mode, status)
     values ('SMOKE direct insert', 'edu', 'local', 'direct', 'todo') $$,
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
  $$ insert into public.campaigns (department_id, name, created_by)
     values ('edu', 'SMOKE campanie', 'd0000000-0000-0000-0000-000000000002') $$,
  'step 19: direct INSERT into public.campaigns');

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

-- ==================== done ====================

do $$
begin
  raise notice '';
  raise notice '================ SMOKE TEST PASSED ================';
  raise notice 'Every step ran through the public wrappers only, and';
  raise notice 'authenticated could not write a single Task table.';
  raise notice 'Rolling back -- the database is unchanged.';
end;
$$;

rollback;
