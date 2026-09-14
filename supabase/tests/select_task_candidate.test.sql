-- #333: public.select_task_candidate -- a manager fills or replaces a public
-- Task's Executor with someone ALREADY IN ITS CANDIDATE QUEUE, and decides in
-- the same call whether the Candidates left behind stay pending or are closed.
--
-- The safety property this suite exists for: the Executor slot is single and
-- the queue is the only source a manager may select from. Ending the outgoing
-- Assignment, opening the incoming one, marking the Candidature selected and
-- (optionally) closing the rest are one atomic step serialized on the tasks
-- row FOR UPDATE -- the same first-locked row #330's express_task_interest /
-- withdraw_task_interest and #332's give_up_task take, which is why a
-- concurrent withdrawal by the very Member being selected cannot tear.
--
-- Deliberate divergence from #332, pinned by section 6: #332's AUTOMATIC
-- promotion skips a deactivated Candidate and promotes the next live one,
-- because nobody chose them. Here the manager named one specific person, so a
-- deactivated choice must fail LOUDLY -- private.open_task_assignment raises
-- PT400 invalid_executor and the whole command rolls back, even though a live
-- Candidate is sitting right behind them in the queue. Section 6 asserts that
-- the live Candidate is NOT silently promoted instead.
--
-- Non-disclosure: a p_candidate_id that is unknown, already withdrawn, or a
-- perfectly valid Candidature ON ANOTHER TASK all answer the same PT409
-- candidate_not_pending. A manager of Task A must not be able to probe the
-- Candidature ids of Task B by watching the error change.
--
-- Concurrency, and an honest limitation of the harness (section 10/11):
-- pg_temp.test_race runs session A's statement to completion, sends session B
-- while A is still uncommitted, waits until B either blocks or finishes, then
-- commits A and fetches B's result. A REMOTE ERROR FROM SESSION B PROPAGATES
-- out of extensions.dblink_get_result and there is no SQL-level way to catch
-- it inside the harness, so a single test_race call can pin EITHER b_waited
-- (when B succeeds) OR B's error code (when the whole call is wrapped in
-- throws_ok, the campaign_commands.test.sql:651 precedent) -- never both. The
-- two proofs are therefore split across two races on the same lock and the
-- same command pair:
--   - section 10 races the manager selecting Candidate X against X's OWN
--     withdrawal and pins that the loser gets a clean PT409
--     not_a_candidate, never a raw constraint error, plus the committed end
--     state. b_waited is unobservable there, but B's PT409 is itself proof
--     that B serialized: B was sent while A still held the tasks row, so the
--     only way B can see A's committed 'selected' row is to have blocked and
--     re-read under a fresh snapshot.
--   - section 11 races the manager selecting Candidate X against a DIFFERENT
--     pending Candidate Y withdrawing, where both callers legitimately
--     succeed, and pins b_waited = true on exactly the same tasks-row lock.
-- Because test_race always completes A first, only the SELECT-FIRST order was
-- ever actually executed in either section; the section 10 assertions are
-- written as a disjunction that would also accept the withdraw-first outcome,
-- as a statement of correctness, not because that order was run.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(79);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('33300000-0000-0000-0000-000000000001', 'manager.333@test.local'),
  ('33300000-0000-0000-0000-000000000002', 'executor.333@test.local'),
  ('33300000-0000-0000-0000-000000000003', 'chosen.one.333@test.local'),
  ('33300000-0000-0000-0000-000000000004', 'left.pending.333@test.local'),
  ('33300000-0000-0000-0000-000000000005', 'closed.candidate.333@test.local'),
  ('33300000-0000-0000-0000-000000000006', 'chosen.two.333@test.local'),
  ('33300000-0000-0000-0000-000000000007', 'inactive.bc.333@test.local'),
  ('33300000-0000-0000-0000-000000000008', 'claimless.333@test.local'),
  ('33300000-0000-0000-0000-000000000009', 'deactivated.candidate.333@test.local'),
  ('33300000-0000-0000-0000-000000000010', 'ordinary.member.333@test.local'),
  ('33300000-0000-0000-0000-000000000011', 'withdrawn.candidate.333@test.local'),
  ('33300000-0000-0000-0000-000000000012', 'other.task.candidate.333@test.local'),
  ('33300000-0000-0000-0000-000000000013', 'persona.executor.333@test.local'),
  ('33300000-0000-0000-0000-000000000014', 'persona.candidate.333@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('33300000-0000-0000-0000-000000000001', 'Manager 333', 'manager.333@test.local', 'bce', 'activ'),
  ('33300000-0000-0000-0000-000000000002', 'Executor 333', 'executor.333@test.local', 'voluntar', 'activ'),
  ('33300000-0000-0000-0000-000000000003', 'Ales Unu 333', 'chosen.one.333@test.local', 'voluntar', 'activ'),
  ('33300000-0000-0000-0000-000000000004', 'Ramas In Coada 333', 'left.pending.333@test.local', 'voluntar', 'activ'),
  ('33300000-0000-0000-0000-000000000005', 'Candidat Inchis 333', 'closed.candidate.333@test.local', 'voluntar', 'activ'),
  ('33300000-0000-0000-0000-000000000006', 'Ales Doi 333', 'chosen.two.333@test.local', 'voluntar', 'activ'),
  ('33300000-0000-0000-0000-000000000007', 'BC Inactiv 333', 'inactive.bc.333@test.local', 'bc', 'inactiv'),
  ('33300000-0000-0000-0000-000000000008', 'Fara Claimuri 333', 'claimless.333@test.local', 'voluntar', 'activ'),
  ('33300000-0000-0000-0000-000000000009', 'Candidat Dezactivat 333', 'deactivated.candidate.333@test.local', 'voluntar', 'inactiv'),
  ('33300000-0000-0000-0000-000000000010', 'Membru Obisnuit 333', 'ordinary.member.333@test.local', 'voluntar', 'activ'),
  ('33300000-0000-0000-0000-000000000011', 'Candidat Retras 333', 'withdrawn.candidate.333@test.local', 'voluntar', 'activ'),
  ('33300000-0000-0000-0000-000000000012', 'Candidat Alt Task 333', 'other.task.candidate.333@test.local', 'voluntar', 'activ'),
  ('33300000-0000-0000-0000-000000000013', 'Executor Persoane 333', 'persona.executor.333@test.local', 'voluntar', 'activ'),
  ('33300000-0000-0000-0000-000000000014', 'Candidat Persoane 333', 'persona.candidate.333@test.local', 'voluntar', 'activ');

insert into public.member_departments (member_id, dept_id) values
  ('33300000-0000-0000-0000-000000000001', 'edu'),
  ('33300000-0000-0000-0000-000000000002', 'edu'),
  ('33300000-0000-0000-0000-000000000003', 'edu'),
  ('33300000-0000-0000-0000-000000000004', 'edu'),
  ('33300000-0000-0000-0000-000000000005', 'edu'),
  ('33300000-0000-0000-0000-000000000006', 'edu'),
  ('33300000-0000-0000-0000-000000000010', 'edu'),
  ('33300000-0000-0000-0000-000000000011', 'edu'),
  ('33300000-0000-0000-0000-000000000012', 'edu'),
  ('33300000-0000-0000-0000-000000000013', 'edu'),
  ('33300000-0000-0000-0000-000000000014', 'edu');

-- ---- T1: an empty Executor slot and two pending Candidates in a known
-- order. Selected with p_close_remaining = false, so the Candidate left
-- behind must stay pending and the queue must stay open.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, queue_opened_at, created_by)
values
  ('Slot gol #333', 'Fara executant', '2027-09-01 09:00:00+00', 'edu', 'org', 'public', 'todo',
   now(), '33300000-0000-0000-0000-000000000001');
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33300000-0000-0000-0000-000000000003'::uuid, 'pending', now() - interval '2 hours'
  from public.tasks where title = 'Slot gol #333'
union all
select id, '33300000-0000-0000-0000-000000000004'::uuid, 'pending', now() - interval '1 hour'
  from public.tasks where title = 'Slot gol #333';

-- ---- T2: a Task in progress with an active Executor and two pending
-- Candidates. Selected with p_close_remaining = true, so the outgoing
-- Executor is replaced AND the Candidate left behind is closed.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, started_at, queue_opened_at, created_by)
values
  ('Inlocuire #333', 'Cu executant', '2027-09-02 09:00:00+00', 'edu', 'org', 'public', 'in_progress',
   now(), now(), '33300000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33300000-0000-0000-0000-000000000002', '33300000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Inlocuire #333';
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33300000-0000-0000-0000-000000000006'::uuid, 'pending', now() - interval '2 hours'
  from public.tasks where title = 'Inlocuire #333'
union all
select id, '33300000-0000-0000-0000-000000000005'::uuid, 'pending', now() - interval '1 hour'
  from public.tasks where title = 'Inlocuire #333';

-- ---- T3: the p_candidate_id validation target -- one withdrawn Candidature
-- and one live pending one that must survive every rejected call.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, queue_opened_at, created_by)
values
  ('Candidatura invalida #333', 'Validare parametru', '2027-09-03 09:00:00+00', 'edu', 'org', 'public', 'todo',
   now(), '33300000-0000-0000-0000-000000000001');
insert into public.task_candidates (task_id, member_id, status, joined_at, decided_at, decided_by)
select id, '33300000-0000-0000-0000-000000000011'::uuid, 'withdrawn', now() - interval '3 hours',
       now() - interval '2 hours', '33300000-0000-0000-0000-000000000011'::uuid
  from public.tasks where title = 'Candidatura invalida #333';
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33300000-0000-0000-0000-000000000012'::uuid, 'pending', now() - interval '1 hour'
  from public.tasks where title = 'Candidatura invalida #333';

-- ---- T4: in_review -- ADR-0007 blocks replacing an Executor whose work is
-- already submitted, so the queue may not be selected from either.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, started_at, submitted_at, queue_opened_at, created_by)
values
  ('In verificare #333', 'Trimis spre verificare', '2027-09-04 09:00:00+00', 'edu', 'org', 'public', 'in_review',
   now(), now(), now(), '33300000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33300000-0000-0000-0000-000000000002', '33300000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'In verificare #333';
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33300000-0000-0000-0000-000000000003'::uuid, 'pending', now() - interval '1 hour'
  from public.tasks where title = 'In verificare #333';

-- ---- T5: a cancelled public Task. tasks_queue_timestamp_state_check forces
-- queue_closed_at on a terminal public Task, but nothing stops a Candidature
-- row from still reading 'pending' -- hand-fixtured, so the terminal check is
-- proven to fire BEFORE the Candidature is even looked at.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, cancelled_at, queue_opened_at, queue_closed_at, created_by)
values
  ('Anulat #333', 'Anulat', '2027-09-05 09:00:00+00', 'edu', 'org', 'public', 'cancelled', now(),
   now(), now(), '33300000-0000-0000-0000-000000000001');
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33300000-0000-0000-0000-000000000003'::uuid, 'pending', now() - interval '1 hour'
  from public.tasks where title = 'Anulat #333';

-- ---- T6: an Umbrella (null audience/assignment_mode, #315 shape). It has no
-- queue at all, so a Candidature id belonging to another Task must answer
-- task_is_umbrella, never candidate_not_pending.
insert into public.tasks
  (title, dept_id, kind, audience, assignment_mode, difficulty, rating, status, created_by)
values
  ('Umbrela #333', 'edu', 'umbrella', null, null, null, null, 'todo',
   '33300000-0000-0000-0000-000000000001');

-- ---- T7: the deactivated-Candidate case, and the discriminator against
-- #332: the named Candidate (009) is deactivated and a still-active Candidate
-- (004) is queued right behind them. The command must FAIL, not fall through
-- to the live one.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, queue_opened_at, created_by)
values
  ('Candidat dezactivat #333', 'Alegere moarta', '2027-09-06 09:00:00+00', 'edu', 'org', 'public', 'todo',
   now(), '33300000-0000-0000-0000-000000000001');
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33300000-0000-0000-0000-000000000009'::uuid, 'pending', now() - interval '2 hours'
  from public.tasks where title = 'Candidat dezactivat #333'
union all
select id, '33300000-0000-0000-0000-000000000004'::uuid, 'pending', now() - interval '1 hour'
  from public.tasks where title = 'Candidat dezactivat #333';

-- ---- T8: the persona matrix target. Audience 'org' with an open queue, so
-- every persona below can READ it (can_read_task R6) and the denial is the
-- authority check, never a disguised PT404.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, started_at, queue_opened_at, created_by)
values
  ('Persoane #333', 'Matricea de persoane', '2027-09-07 09:00:00+00', 'edu', 'org', 'public', 'in_progress',
   now(), now(), '33300000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33300000-0000-0000-0000-000000000013', '33300000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Persoane #333';
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33300000-0000-0000-0000-000000000014'::uuid, 'pending', now() - interval '1 hour'
  from public.tasks where title = 'Persoane #333';

-- Every fixture id resolved ONCE, as the owner. Never resolve an id inside a
-- format() while a denied persona is logged in: the lookup would run under
-- that persona's RLS, return NULL, and the assertion would pass for the wrong
-- reason (the #328 trap, stack-context.md carry-forwards).
create temp table f333 as
select
  9223372036854775807::bigint as missing_id,
  (select id from public.tasks where title = 'Slot gol #333') as empty_slot_task_id,
  (select id from public.tasks where title = 'Inlocuire #333') as replace_task_id,
  (select id from public.tasks where title = 'Candidatura invalida #333') as invalid_task_id,
  (select id from public.tasks where title = 'In verificare #333') as review_task_id,
  (select id from public.tasks where title = 'Anulat #333') as cancelled_task_id,
  (select id from public.tasks where title = 'Umbrela #333') as umbrella_task_id,
  (select id from public.tasks where title = 'Candidat dezactivat #333') as dead_choice_task_id,
  (select id from public.tasks where title = 'Persoane #333') as persona_task_id,
  (select candidate.id from public.task_candidates as candidate
     join public.tasks as task on task.id = candidate.task_id
    where task.title = 'Slot gol #333'
      and candidate.member_id = '33300000-0000-0000-0000-000000000003') as chosen_one_candidature_id,
  (select candidate.id from public.task_candidates as candidate
     join public.tasks as task on task.id = candidate.task_id
    where task.title = 'Slot gol #333'
      and candidate.member_id = '33300000-0000-0000-0000-000000000004') as left_pending_candidature_id,
  (select candidate.id from public.task_candidates as candidate
     join public.tasks as task on task.id = candidate.task_id
    where task.title = 'Inlocuire #333'
      and candidate.member_id = '33300000-0000-0000-0000-000000000006') as chosen_two_candidature_id,
  (select candidate.id from public.task_candidates as candidate
     join public.tasks as task on task.id = candidate.task_id
    where task.title = 'Candidatura invalida #333'
      and candidate.member_id = '33300000-0000-0000-0000-000000000011') as withdrawn_candidature_id,
  (select candidate.id from public.task_candidates as candidate
     join public.tasks as task on task.id = candidate.task_id
    where task.title = 'Candidatura invalida #333'
      and candidate.member_id = '33300000-0000-0000-0000-000000000012') as other_task_candidature_id,
  (select candidate.id from public.task_candidates as candidate
     join public.tasks as task on task.id = candidate.task_id
    where task.title = 'In verificare #333'
      and candidate.member_id = '33300000-0000-0000-0000-000000000003') as review_candidature_id,
  (select candidate.id from public.task_candidates as candidate
     join public.tasks as task on task.id = candidate.task_id
    where task.title = 'Anulat #333'
      and candidate.member_id = '33300000-0000-0000-0000-000000000003') as cancelled_candidature_id,
  (select candidate.id from public.task_candidates as candidate
     join public.tasks as task on task.id = candidate.task_id
    where task.title = 'Candidat dezactivat #333'
      and candidate.member_id = '33300000-0000-0000-0000-000000000009') as dead_candidature_id,
  (select candidate.id from public.task_candidates as candidate
     join public.tasks as task on task.id = candidate.task_id
    where task.title = 'Candidat dezactivat #333'
      and candidate.member_id = '33300000-0000-0000-0000-000000000004') as live_behind_candidature_id,
  (select candidate.id from public.task_candidates as candidate
     join public.tasks as task on task.id = candidate.task_id
    where task.title = 'Persoane #333'
      and candidate.member_id = '33300000-0000-0000-0000-000000000014') as persona_candidature_id;
grant select on f333 to authenticated, anon;

-- ==================== 1. API shape and privileges ====================

select has_function('public', 'select_task_candidate', array['bigint', 'bigint', 'boolean'],
  'public.select_task_candidate exists with the pinned three-parameter signature');
select is(pg_get_function_identity_arguments(
    'public.select_task_candidate(bigint, bigint, boolean)'::regprocedure),
  'p_task_id bigint, p_candidate_id bigint, p_close_remaining boolean',
  'select_task_candidate exposes no actor parameter -- the actor is always auth.uid()');
select is(pg_get_function_result(
    'public.select_task_candidate(bigint, bigint, boolean)'::regprocedure),
  'tasks', 'select_task_candidate returns the affected Task row');
select ok(not (select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public' and procedure.proname = 'select_task_candidate'),
  'the public command is a security invoker wrapper');
select ok((select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private' and procedure.proname = 'select_task_candidate_impl'),
  'private.select_task_candidate_impl runs as owner (security definer)');
select ok(coalesce((
    select bool_and('search_path=""' = any(procedure.proconfig))
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private' and procedure.proname = 'select_task_candidate_impl'
  ), false), 'select_task_candidate_impl pins an empty search_path');
select ok(has_function_privilege('authenticated',
  'public.select_task_candidate(bigint, bigint, boolean)'::regprocedure, 'execute'),
  'authenticated can execute public.select_task_candidate');
select ok(not has_function_privilege('anon',
  'public.select_task_candidate(bigint, bigint, boolean)'::regprocedure, 'execute'),
  'anon cannot execute public.select_task_candidate');
select ok(has_function_privilege('authenticated',
  'private.select_task_candidate_impl(bigint, bigint, boolean)'::regprocedure, 'execute'),
  'authenticated can execute private.select_task_candidate_impl');

-- ==================== 2. Selecting into an empty Executor slot ====================
-- p_close_remaining = false: the Candidate behind the chosen one keeps their
-- place and the queue stays open.

select pg_temp.test_login('33300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select empty_slot_task_id from f333), (select chosen_one_candidature_id from f333)),
  'a manager may select a pending Candidate into an empty Executor slot');
reset role;

select is((select format('%s|%s|%s', count(*), min(assignment.member_id::text),
                         min(assignment.assigned_by::text))
             from public.task_assignments as assignment
            where assignment.task_id = (select empty_slot_task_id from f333)
              and assignment.ended_at is null),
  '1|33300000-0000-0000-0000-000000000003|33300000-0000-0000-0000-000000000001',
  'exactly one active Assignment exists, held by the selected Candidate and recorded as opened by the manager');
select is((select format('%s|%s|%s|%s', candidate.status, candidate.decided_by,
                         (candidate.decided_at is not null)::text,
                         (candidate.assignment_id = (select assignment.id from public.task_assignments as assignment
                                                      where assignment.task_id = candidate.task_id
                                                        and assignment.ended_at is null))::text)
             from public.task_candidates as candidate
            where candidate.id = (select chosen_one_candidature_id from f333)),
  'selected|33300000-0000-0000-0000-000000000001|true|true',
  'the chosen Candidature is selected, decided by the MANAGER, and points at the new Assignment (task_candidates_decision_shape_ck)');
select is((select format('%s|%s|%s|%s', candidate.status,
                         (candidate.decided_at is null)::text, (candidate.decided_by is null)::text,
                         (candidate.assignment_id is null)::text)
             from public.task_candidates as candidate
            where candidate.id = (select left_pending_candidature_id from f333)),
  'pending|true|true|true',
  'with p_close_remaining = false the Candidate behind them is untouched -- still pending, still undecided');
select is((select (task.queue_closed_at is null)::text from public.tasks as task
            where task.id = (select empty_slot_task_id from f333)),
  'true', 'the Candidate Queue itself stays open too -- p_close_remaining = false closes nothing');
select is((select format('%s|%s|%s|%s|%s|%s', activity.actor_id,
                         (activity.assignment_id = (select assignment.id from public.task_assignments as assignment
                                                     where assignment.task_id = activity.task_id
                                                       and assignment.ended_at is null))::text,
                         activity.details ->> 'candidate_id',
                         coalesce(activity.details ->> 'replaced_assignment_id', 'null'),
                         activity.details ->> 'closed_remaining',
                         activity.details ->> 'closed_candidates')
             from public.task_activity as activity
            where activity.task_id = (select empty_slot_task_id from f333)
              and activity.kind = 'candidate_selected'),
  format('33300000-0000-0000-0000-000000000001|true|%s|null|false|0',
    (select chosen_one_candidature_id from f333)),
  'the candidate_selected row names the manager, carries the NEW Assignment id, details.candidate_id, a null replaced_assignment_id, closed_remaining = false and closed_candidates = 0');
select is((select format('%s|%s|%s', activity.details ->> 'via', activity.details ->> 'member_id',
                         (activity.assignment_id = (select assignment.id from public.task_assignments as assignment
                                                     where assignment.task_id = activity.task_id
                                                       and assignment.ended_at is null))::text)
             from public.task_activity as activity
            where activity.task_id = (select empty_slot_task_id from f333)
              and activity.kind = 'executor_assigned'),
  'select|33300000-0000-0000-0000-000000000003|true',
  'private.open_task_assignment writes the executor_assigned row with details.via = select');
select is((select count(*) from public.task_activity
            where task_id = (select empty_slot_task_id from f333)), 2::bigint,
  'exactly two activity rows are written: executor_assigned and candidate_selected -- no queue_closed row, the close is recorded in candidate_selected.details');
select is((select format('%s|%s', task.status, (task.started_at is null)::text)
             from public.tasks as task where task.id = (select empty_slot_task_id from f333)),
  'todo|true',
  'the Task''s status never changes -- selecting an Executor does not start the work');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s $$, (select empty_slot_task_id from f333)),
  $$ values ('33300000-0000-0000-0000-000000000003'::uuid) $$,
  'exactly the selected Candidate is notified -- nobody was replaced, nobody was closed, and the manager as actor hears nothing');
select is((select format('%s|%s|%s', notification.title, notification.body,
                         (notification.dedupe_key is null)::text)
             from public.notifications as notification
            where notification.task_id = (select empty_slot_task_id from f333)),
  'Task nou: Slot gol #333|Ți-a fost atribuit acest task. Deadline: 01.09.2027 12:00.|true',
  'the selected Candidate gets the pinned "Task nou" notification from private.open_task_assignment, uncoalesced');

-- ==================== 3. Replacing an Executor and closing the rest ====================
-- p_close_remaining = true on a Task that already has an Executor: the
-- outgoing Assignment ends as 'replaced', its holder is told, and every
-- Candidate left behind is closed and told.

select pg_temp.test_login('33300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.select_task_candidate(%s, %s, true) $$,
  (select replace_task_id from f333), (select chosen_two_candidature_id from f333)),
  'a manager may replace a sitting Executor with a pending Candidate and close the remaining queue in one call');
reset role;

select is((select format('%s|%s|%s', (assignment.ended_at is not null)::text,
                         assignment.end_reason, coalesce(assignment.end_note, 'null'))
             from public.task_assignments as assignment
            where assignment.task_id = (select replace_task_id from f333)
              and assignment.member_id = '33300000-0000-0000-0000-000000000002'),
  'true|replaced|null',
  'the outgoing Executor''s Assignment is ended with end_reason replaced and no end_note');
select is((select format('%s|%s', count(*), min(assignment.member_id::text))
             from public.task_assignments as assignment
            where assignment.task_id = (select replace_task_id from f333)
              and assignment.ended_at is null),
  '1|33300000-0000-0000-0000-000000000006',
  'exactly one active Assignment survives the replacement, held by the newly selected Candidate');
select is((select format('%s|%s|%s|%s', candidate.status, candidate.decided_by,
                         (candidate.decided_at is not null)::text,
                         (candidate.assignment_id = (select assignment.id from public.task_assignments as assignment
                                                      where assignment.task_id = candidate.task_id
                                                        and assignment.ended_at is null))::text)
             from public.task_candidates as candidate
            where candidate.id = (select chosen_two_candidature_id from f333)),
  'selected|33300000-0000-0000-0000-000000000001|true|true',
  'the chosen Candidature is selected, decided by the manager, and points at the replacement Assignment');
select is((select format('%s|%s|%s|%s', candidate.status,
                         (candidate.decided_at is not null)::text, candidate.decided_by::text,
                         (candidate.assignment_id is null)::text)
             from public.task_candidates as candidate
            where candidate.task_id = (select replace_task_id from f333)
              and candidate.member_id = '33300000-0000-0000-0000-000000000005'),
  'closed|true|33300000-0000-0000-0000-000000000001|true',
  'the Candidate left behind is closed by private.close_task_queue with decided_by = the manager and no Assignment');
select is((select (task.queue_closed_at is not null)::text from public.tasks as task
            where task.id = (select replace_task_id from f333)),
  'true', 'p_close_remaining = true closes the Candidate Queue itself, not just its rows');
select is((select format('%s|%s|%s|%s', activity.details ->> 'candidate_id',
                         (((activity.details ->> 'replaced_assignment_id')::bigint) =
                            (select assignment.id from public.task_assignments as assignment
                              where assignment.task_id = activity.task_id
                                and assignment.member_id = '33300000-0000-0000-0000-000000000002'))::text,
                         activity.details ->> 'closed_remaining',
                         activity.details ->> 'closed_candidates')
             from public.task_activity as activity
            where activity.task_id = (select replace_task_id from f333)
              and activity.kind = 'candidate_selected'),
  format('%s|true|true|1', (select chosen_two_candidature_id from f333)),
  'the candidate_selected row records details.replaced_assignment_id = the ENDED Assignment, closed_remaining = true and closed_candidates = 1');
select is((select format('%s|%s', activity.details ->> 'via',
                         (activity.assignment_id = (select assignment.id from public.task_assignments as assignment
                                                     where assignment.task_id = activity.task_id
                                                       and assignment.ended_at is null))::text)
             from public.task_activity as activity
            where activity.task_id = (select replace_task_id from f333)
              and activity.kind = 'executor_assigned'),
  'select|true',
  'the replacement Assignment gets its own executor_assigned row with details.via = select');
select is((select count(*) from public.task_activity
            where task_id = (select replace_task_id from f333)), 2::bigint,
  'a replacement still writes exactly two activity rows -- ending an Assignment is history on the Assignment itself, not a separate event');
select is((select format('%s|%s', task.status, (task.started_at is not null)::text)
             from public.tasks as task where task.id = (select replace_task_id from f333)),
  'in_progress|true',
  'an in_progress Task stays in_progress for the incoming Executor -- started_at is not rewound');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s $$, (select replace_task_id from f333)),
  $$ values ('33300000-0000-0000-0000-000000000002'::uuid),
         ('33300000-0000-0000-0000-000000000005'::uuid),
         ('33300000-0000-0000-0000-000000000006'::uuid) $$,
  'exactly the replaced Executor, the closed Candidate and the selected Candidate are notified -- the manager, as actor, is not');
select is((select format('%s|%s', notification.title, notification.body)
             from public.notifications as notification
            where notification.task_id = (select replace_task_id from f333)
              and notification.member_id = '33300000-0000-0000-0000-000000000002'),
  'Înlocuit: Inlocuire #333|Managerul a ales alt executant.',
  'the replaced Executor gets the pinned Romanian replacement copy');
select is((select format('%s|%s', notification.title, notification.body)
             from public.notifications as notification
            where notification.task_id = (select replace_task_id from f333)
              and notification.member_id = '33300000-0000-0000-0000-000000000005'),
  'Coadă închisă: Inlocuire #333|Nu mai poți fi selectat pentru acest task.',
  'the closed Candidate gets the pinned queue-closed copy');
select is((select notification.title from public.notifications as notification
            where notification.task_id = (select replace_task_id from f333)
              and notification.member_id = '33300000-0000-0000-0000-000000000006'),
  'Task nou: Inlocuire #333',
  'the selected Candidate gets "Task nou", not "Coadă închisă" -- their row was already selected before the queue closed');

-- ==================== 4. p_candidate_id and p_close_remaining validation ====================
-- Every "this is not a live pending Candidature of THIS Task" answers the same
-- PT409 candidate_not_pending -- a manager must never learn, from the error
-- alone, that an id exists on some other Task.

select pg_temp.test_login('33300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select invalid_task_id from f333), (select missing_id from f333)),
  'PT409', 'candidate_not_pending',
  'a Candidature id that does not exist at all is candidate_not_pending');
select throws_ok(format($$ select public.select_task_candidate(%s, null, false) $$,
  (select invalid_task_id from f333)),
  'PT409', 'candidate_not_pending',
  'a null Candidature id answers the same reason -- no legitimate client sends one');
select throws_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select invalid_task_id from f333), (select withdrawn_candidature_id from f333)),
  'PT409', 'candidate_not_pending',
  'a withdrawn Candidature cannot be selected -- only a live pending one may be');
select throws_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select invalid_task_id from f333), (select left_pending_candidature_id from f333)),
  'PT409', 'candidate_not_pending',
  'a perfectly valid pending Candidature belonging to ANOTHER Task answers the identical reason -- never a probe into another Task''s queue');
select throws_ok(format($$ select public.select_task_candidate(%s, %s, null) $$,
  (select invalid_task_id from f333), (select other_task_candidature_id from f333)),
  'PT400', 'invalid_close_flag',
  'a null p_close_remaining is rejected: the manager must decide what happens to the rest of the queue');
select throws_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select missing_id from f333), (select other_task_candidature_id from f333)),
  'PT404', 'task_not_found',
  'an unknown Task is not found, not forbidden -- the target id never becomes a PT400');
reset role;

-- The close-flag check runs BEFORE the membership gate: a null boolean is
-- malformed for every caller, so a claimless uid gets PT400, not 42501. This
-- is the one pinned ordering decision of this command.
select pg_temp.test_login('33300000-0000-0000-0000-000000000008',
  jsonb_build_object('provider', 'email'));
select throws_ok(format($$ select public.select_task_candidate(%s, %s, null) $$,
  (select invalid_task_id from f333), (select other_task_candidature_id from f333)),
  'PT400', 'invalid_close_flag',
  'a null close flag answers PT400 even for a caller who would fail the gate -- malformed for everyone, checked first');
reset role;

select is((select format('%s|%s|%s', candidate.status,
                         (candidate.decided_at is null)::text, (candidate.assignment_id is null)::text)
             from public.task_candidates as candidate
            where candidate.id = (select other_task_candidature_id from f333)),
  'pending|true|true',
  'the live Candidature on the validation Task survived every rejected call untouched');

-- ==================== 5. State preconditions ====================
-- Task-level state outranks the p_candidate_id parameter: each of these calls
-- passes a genuinely pending Candidature of the very Task it names (except the
-- Umbrella, which cannot have one), and still answers the Task's own conflict.

select pg_temp.test_login('33300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select review_task_id from f333), (select review_candidature_id from f333)),
  'PT409', 'task_in_review',
  'an Executor whose work is already submitted may not be replaced -- ADR-0007''s blocked case');
select throws_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select cancelled_task_id from f333), (select cancelled_candidature_id from f333)),
  'PT409', 'task_terminal',
  'a terminal Task answers task_terminal even though the Candidature it names is genuinely pending');
select throws_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select umbrella_task_id from f333), (select other_task_candidature_id from f333)),
  'PT409', 'task_is_umbrella',
  'an Umbrella has no queue at all -- checked before the Candidature, so the id is never even looked up');
select throws_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select dead_choice_task_id from f333), (select dead_candidature_id from f333)),
  'PT400', 'invalid_executor',
  'selecting a DEACTIVATED Candidate fails loudly -- private.open_task_assignment refuses a member who is not a live activ profile');
reset role;

-- The discriminator against #332 (stack-context.md carry-forward): give_up_task
-- SKIPS a deactivated Candidate and promotes the live one behind them, because
-- nobody chose them. Here the manager named one specific person, so the whole
-- command rolls back and the live Candidate behind them is NOT promoted in
-- their place.
select is((select format('%s|%s', count(*) filter (where candidate.status = 'pending'),
                         count(*) filter (where candidate.status <> 'pending'))
             from public.task_candidates as candidate
            where candidate.task_id = (select dead_choice_task_id from f333)),
  '2|0',
  'both Candidatures on the deactivated-choice Task are still pending -- the live Candidate behind the dead one was NOT silently promoted (the deliberate divergence from #332)');
select is((select count(*) from public.task_assignments
            where task_id = (select dead_choice_task_id from f333)), 0::bigint,
  'and no Assignment was opened at all -- the rolled-back command left the Executor slot empty');

-- ==================== 6. A rejected call writes nothing ====================

select is((select count(*) from public.task_activity
            where task_id in (select invalid_task_id from f333)
               or task_id in (select review_task_id from f333)
               or task_id in (select cancelled_task_id from f333)
               or task_id in (select umbrella_task_id from f333)
               or task_id in (select dead_choice_task_id from f333)), 0::bigint,
  'none of the eleven rejected input/state calls wrote an activity row');
select is((select count(*) from public.notifications
            where task_id in (select invalid_task_id from f333)
               or task_id in (select review_task_id from f333)
               or task_id in (select cancelled_task_id from f333)
               or task_id in (select umbrella_task_id from f333)
               or task_id in (select dead_choice_task_id from f333)), 0::bigint,
  'none of the eleven rejected input/state calls wrote a notification');

-- ==================== 7. Persona denials ====================
-- Only someone who MANAGES the Task's Origin may select from its queue.
-- Everyone else is 42501 -- and which 42501 depends on how far they get: the
-- gate answers task_command_forbidden, the authority check
-- task_manage_forbidden.

select pg_temp.test_login('33300000-0000-0000-0000-000000000010', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select persona_task_id from f333), (select persona_candidature_id from f333)),
  '42501', 'task_manage_forbidden',
  'an ordinary Member of the Origin Department can READ the open Opportunity but cannot pick its Executor');
reset role;

select pg_temp.test_login('33300000-0000-0000-0000-000000000013', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select persona_task_id from f333), (select persona_candidature_id from f333)),
  '42501', 'task_manage_forbidden',
  'the Task''s own active Executor cannot hand it on -- executing is not managing (leaving is #332''s give_up_task)');
reset role;

select pg_temp.test_login('33300000-0000-0000-0000-000000000014', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select persona_task_id from f333), (select persona_candidature_id from f333)),
  '42501', 'task_manage_forbidden',
  'a Candidate cannot select THEMSELVES out of the queue -- the queue is decided by a manager, not claimed');
reset role;

select pg_temp.test_login('33300000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select persona_task_id from f333), (select persona_candidature_id from f333)),
  '42501', 'task_command_forbidden',
  'a deactivated BC holding a still-valid level-6 token is stopped at the gate');
reset role;

select pg_temp.test_login('33300000-0000-0000-0000-000000000008',
  jsonb_build_object('provider', 'email'));
select throws_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select persona_task_id from f333), (select persona_candidature_id from f333)),
  '42501', 'task_command_forbidden',
  'a real uid without organisation claims is stopped at the gate too');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select persona_task_id from f333), (select persona_candidature_id from f333)),
  '42501', 'permission denied for function select_task_candidate',
  'anon cannot execute select_task_candidate at all -- the literal grant denial, not a gate that happens to raise 42501');
reset role;

select is((select count(*) from public.task_activity
            where task_id = (select persona_task_id from f333)), 0::bigint,
  'none of the six denied personas wrote an activity row on the persona Task');
select is((select count(*) from public.notifications
            where task_id = (select persona_task_id from f333)), 0::bigint,
  'none of the six denied personas wrote a notification');
select is((select format('%s|%s|%s', count(*) filter (where assignment.ended_at is null),
                         min(assignment.member_id::text) filter (where assignment.ended_at is null),
                         (select candidate.status from public.task_candidates as candidate
                           where candidate.id = (select persona_candidature_id from f333)))
             from public.task_assignments as assignment
            where assignment.task_id = (select persona_task_id from f333)),
  '1|33300000-0000-0000-0000-000000000013|pending',
  'the persona Task still has its one active Assignment and its Candidate is still pending');

-- ==================== 8. The command is the only write path ====================

select pg_temp.test_login('33300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ update public.task_candidates set status = 'selected'
  where id = %s $$, (select persona_candidature_id from f333)),
  '42501', null, 'even the Task''s manager cannot select a Candidate by updating task_candidates directly');
select throws_ok(format($$ insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
  values (%s, '33300000-0000-0000-0000-000000000014', '33300000-0000-0000-0000-000000000001', now()) $$,
  (select persona_task_id from f333)),
  '42501', null, 'the manager cannot open an Assignment by inserting into task_assignments directly');
select throws_ok(format($$ insert into public.task_activity (task_id, kind, actor_id, details)
  values (%s, 'candidate_selected', '33300000-0000-0000-0000-000000000001', '{}'::jsonb) $$,
  (select persona_task_id from f333)),
  '42501', null, 'the manager cannot fake a candidate_selected activity row by inserting directly');
reset role;

-- ==================== 9. Locks held while the command runs ====================
-- Sections 10 and 11 prove that a concurrent withdrawal SERIALIZES; this probe
-- proves WHERE. Honest limitation, to be reported by mutation rather than
-- assumed: only the tasks-row assertion is expected to discriminate. The
-- Candidature and the outgoing Assignment are both UPDATEd a moment later
-- inside the same held transaction, so deleting their `for update` keywords
-- leaves an equivalent row lock in place and these assertions stay green --
-- they document the locks, they do not prove the keywords.
--
-- Sections 9-11 work on COMMITTED fixtures, created and removed through their
-- own dblink connection: pg_temp.test_race commits both of its sessions for
-- real, so nothing this suite's own rolled-back transaction created would be
-- visible to them.
select extensions.dblink_connect('stc_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));

select extensions.dblink_exec('stc_setup', $$
  set session_replication_role = 'replica';
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#333 committed%');
  set session_replication_role = 'origin';
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#333 committed%')
      or member_id in ('33300000-0000-0000-0000-000000000021',
                       '33300000-0000-0000-0000-000000000022',
                       '33300000-0000-0000-0000-000000000023',
                       '33300000-0000-0000-0000-000000000024',
                       '33300000-0000-0000-0000-000000000025',
                       '33300000-0000-0000-0000-000000000026',
                       '33300000-0000-0000-0000-000000000027',
                       '33300000-0000-0000-0000-000000000028')
      or link in (select '/tracker/' || id::text from public.tasks
                   where title like '%#333 committed%');
  delete from public.task_candidates
   where task_id in (select id from public.tasks where title like '%#333 committed%');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%#333 committed%');
  delete from public.tasks where title like '%#333 committed%';
  delete from public.member_departments where member_id in (
    '33300000-0000-0000-0000-000000000021', '33300000-0000-0000-0000-000000000022',
    '33300000-0000-0000-0000-000000000023', '33300000-0000-0000-0000-000000000024',
    '33300000-0000-0000-0000-000000000025', '33300000-0000-0000-0000-000000000026',
    '33300000-0000-0000-0000-000000000027', '33300000-0000-0000-0000-000000000028');
  delete from auth.users where id in (
    '33300000-0000-0000-0000-000000000021', '33300000-0000-0000-0000-000000000022',
    '33300000-0000-0000-0000-000000000023', '33300000-0000-0000-0000-000000000024',
    '33300000-0000-0000-0000-000000000025', '33300000-0000-0000-0000-000000000026',
    '33300000-0000-0000-0000-000000000027', '33300000-0000-0000-0000-000000000028');

  insert into auth.users (id, email) values
    ('33300000-0000-0000-0000-000000000021', 'probe.manager.333@test.local'),
    ('33300000-0000-0000-0000-000000000022', 'probe.executor.333@test.local'),
    ('33300000-0000-0000-0000-000000000023', 'probe.candidate.333@test.local'),
    ('33300000-0000-0000-0000-000000000024', 'probe.other.333@test.local'),
    ('33300000-0000-0000-0000-000000000025', 'race.chosen.333@test.local'),
    ('33300000-0000-0000-0000-000000000026', 'race.bystander.333@test.local'),
    ('33300000-0000-0000-0000-000000000027', 'race2.chosen.333@test.local'),
    ('33300000-0000-0000-0000-000000000028', 'race2.withdrawer.333@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('33300000-0000-0000-0000-000000000021', 'Probe Manager 333', 'probe.manager.333@test.local', 'bce', 'activ'),
    ('33300000-0000-0000-0000-000000000022', 'Probe Executor 333', 'probe.executor.333@test.local', 'voluntar', 'activ'),
    ('33300000-0000-0000-0000-000000000023', 'Probe Candidat 333', 'probe.candidate.333@test.local', 'voluntar', 'activ'),
    ('33300000-0000-0000-0000-000000000024', 'Probe Altul 333', 'probe.other.333@test.local', 'voluntar', 'activ'),
    ('33300000-0000-0000-0000-000000000025', 'Cursa Ales 333', 'race.chosen.333@test.local', 'voluntar', 'activ'),
    ('33300000-0000-0000-0000-000000000026', 'Cursa Martor 333', 'race.bystander.333@test.local', 'voluntar', 'activ'),
    ('33300000-0000-0000-0000-000000000027', 'Cursa2 Ales 333', 'race2.chosen.333@test.local', 'voluntar', 'activ'),
    ('33300000-0000-0000-0000-000000000028', 'Cursa2 Retras 333', 'race2.withdrawer.333@test.local', 'voluntar', 'activ');
  insert into public.member_departments (member_id, dept_id) values
    ('33300000-0000-0000-0000-000000000021', 'edu'),
    ('33300000-0000-0000-0000-000000000022', 'edu'),
    ('33300000-0000-0000-0000-000000000023', 'edu'),
    ('33300000-0000-0000-0000-000000000024', 'edu'),
    ('33300000-0000-0000-0000-000000000025', 'edu'),
    ('33300000-0000-0000-0000-000000000026', 'edu'),
    ('33300000-0000-0000-0000-000000000027', 'edu'),
    ('33300000-0000-0000-0000-000000000028', 'edu');

  insert into public.tasks
    (title, description, deadline, dept_id, audience, assignment_mode, status, queue_opened_at, created_by)
  values
    ('Lock probe #333 committed', 'Sonda', '2027-10-01 09:00:00+00', 'edu', 'org', 'public', 'todo',
     '2027-01-01 00:00:00+00', '33300000-0000-0000-0000-000000000021'),
    ('Race conflict #333 committed', 'Cursa cu conflict', '2027-10-02 09:00:00+00', 'edu', 'org', 'public', 'todo',
     '2027-01-01 00:00:00+00', '33300000-0000-0000-0000-000000000021'),
    ('Race bystander #333 committed', 'Cursa fara conflict', '2027-10-03 09:00:00+00', 'edu', 'org', 'public', 'todo',
     '2027-01-01 00:00:00+00', '33300000-0000-0000-0000-000000000021');

  insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
  select id, '33300000-0000-0000-0000-000000000022'::uuid, '33300000-0000-0000-0000-000000000021'::uuid, now()
    from public.tasks where title = 'Lock probe #333 committed';

  insert into public.task_candidates (task_id, member_id, status, joined_at)
  select id, '33300000-0000-0000-0000-000000000023'::uuid, 'pending', now() - interval '2 hours'
    from public.tasks where title = 'Lock probe #333 committed'
  union all
  select id, '33300000-0000-0000-0000-000000000024'::uuid, 'pending', now() - interval '1 hour'
    from public.tasks where title = 'Lock probe #333 committed'
  union all
  select id, '33300000-0000-0000-0000-000000000025'::uuid, 'pending', now() - interval '2 hours'
    from public.tasks where title = 'Race conflict #333 committed'
  union all
  select id, '33300000-0000-0000-0000-000000000026'::uuid, 'pending', now() - interval '1 hour'
    from public.tasks where title = 'Race conflict #333 committed'
  union all
  select id, '33300000-0000-0000-0000-000000000027'::uuid, 'pending', now() - interval '2 hours'
    from public.tasks where title = 'Race bystander #333 committed'
  union all
  select id, '33300000-0000-0000-0000-000000000028'::uuid, 'pending', now() - interval '1 hour'
    from public.tasks where title = 'Race bystander #333 committed';
$$);

-- Resolved as the owner, before any persona logs in (the #328 trap again).
create temp table r333 as
select (select id from public.tasks where title = 'Lock probe #333 committed') as probe_task_id,
       (select id from public.tasks where title = 'Race conflict #333 committed') as conflict_task_id,
       (select id from public.tasks where title = 'Race bystander #333 committed') as bystander_task_id,
       (select candidate.id from public.task_candidates as candidate
          join public.tasks as task on task.id = candidate.task_id
         where task.title = 'Lock probe #333 committed'
           and candidate.member_id = '33300000-0000-0000-0000-000000000023') as probe_candidature_id,
       (select candidate.id from public.task_candidates as candidate
          join public.tasks as task on task.id = candidate.task_id
         where task.title = 'Race conflict #333 committed'
           and candidate.member_id = '33300000-0000-0000-0000-000000000025') as conflict_candidature_id,
       (select candidate.id from public.task_candidates as candidate
          join public.tasks as task on task.id = candidate.task_id
         where task.title = 'Race bystander #333 committed'
           and candidate.member_id = '33300000-0000-0000-0000-000000000027') as bystander_candidature_id;
grant select on r333 to authenticated;

select extensions.dblink_connect('stc_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('stc_lock', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('stc_lock', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '33300000-0000-0000-0000-000000000021', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'bce', 'member_level', 5,
      'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text, true)
$$) as remote_claims(setting text);
select extensions.dblink_exec('stc_lock', 'set local role authenticated');
select * from extensions.dblink('stc_lock', format($$
  select (public.select_task_candidate(%s, %s, false)).status::text
$$, (select probe_task_id from r333), (select probe_candidature_id from r333)))
  as locked_select(status text);

select ok(coalesce((
  select row_lock.modes && array['For Update', 'Update', 'No Key Update']
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_task_id from r333)
), false), 'select_task_candidate holds the target Task row exclusively locked while it runs -- the serialization point both races depend on');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.profiles') as row_lock
    join public.profiles as profile on profile.ctid = row_lock.locked_row
   where profile.id = '33300000-0000-0000-0000-000000000021'
), false), 'the manager''s own live profile row is held FOR SHARE (private.require_origin_manager''s discipline)');
select ok(coalesce((
  select bool_or(row_lock.modes && array['For Update', 'Update', 'No Key Update'])
    from extensions.pgrowlocks('public.task_candidates') as row_lock
    join public.task_candidates as candidate on candidate.ctid = row_lock.locked_row
   where candidate.id = (select probe_candidature_id from r333)
), false), 'the named Candidature is locked exclusively before it is decided');
select ok(coalesce((
  select bool_or(row_lock.modes && array['For Update', 'Update', 'No Key Update'])
    from extensions.pgrowlocks('public.task_assignments') as row_lock
    join public.task_assignments as assignment on assignment.ctid = row_lock.locked_row
   where assignment.task_id = (select probe_task_id from r333)
     and assignment.member_id = '33300000-0000-0000-0000-000000000022'
), false), 'the outgoing Executor''s Assignment row is locked exclusively before it is ended');
select is((select count(*) from extensions.pgrowlocks('public.task_candidates') as row_lock
             join public.task_candidates as candidate on candidate.ctid = row_lock.locked_row
            where candidate.id = (select conflict_candidature_id from r333)), 0::bigint,
  'and nothing else is locked -- a Candidature on a different Task is untouched by this command''s locks');

select extensions.dblink_exec('stc_lock', 'rollback');
select extensions.dblink_disconnect('stc_lock');

-- ==================== 10. Race: selecting X while X withdraws ====================
-- The conflict the command exists to survive. pg_temp.test_race runs the
-- manager's selection (session A) to completion, sends X's withdrawal
-- (session B) while A is still uncommitted, then commits A and fetches B's
-- result -- so the SELECT-FIRST order is the one actually exercised, and B is
-- the loser.
--
-- B's PT409 propagates out of extensions.dblink_get_result and cannot be
-- caught in SQL, so the whole test_race call is wrapped in throws_ok (the
-- campaign_commands.test.sql:651 precedent). That costs the b_waited reading
-- -- section 11 pins it on the same lock with a race both callers win -- but
-- the PT409 is itself evidence of serialization: B was SENT while A still
-- held the tasks row, so the only way B can see A's committed 'selected' row
-- is to have blocked on that lock and re-read under a fresh snapshot. Had B
-- not blocked, it would have withdrawn from a queue A was mid-selection on
-- and one of the two would have torn.
--
-- The state assertions below are written as a disjunction that accepts EITHER
-- legitimate outcome -- a 'selected' row with an Assignment and no withdrawal,
-- or a 'withdrawn' row with no Assignment at all -- as a statement of
-- correctness, not because both orders were run.
select pg_temp.test_login('33300000-0000-0000-0000-000000000021', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($outer$
  select * from pg_temp.test_race(
    %L,
    %L)
$outer$,
  format($$ select (public.select_task_candidate(%s, %s, false)).id::text $$,
    (select conflict_task_id from r333), (select conflict_candidature_id from r333)),
  format($$ with claims as (select set_config('request.jwt.claims', %L, true))
            select (public.withdraw_task_interest(%s)).id::text from claims $$,
    jsonb_build_object(
      'sub', '33300000-0000-0000-0000-000000000025', 'role', 'authenticated',
      'app_metadata', jsonb_build_object('member_role', 'voluntar', 'member_level', 1,
        'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text,
    (select conflict_task_id from r333))),
  'PT409', 'not_a_candidate',
  'the loser of the select-vs-withdraw race gets a clean domain error -- never a raw unique_violation or a torn half-write');
reset role;

select ok((select
    (candidate.status = 'selected' and candidate.assignment_id is not null
     and exists (select 1 from public.task_assignments as assignment
                  where assignment.task_id = candidate.task_id
                    and assignment.ended_at is null
                    and assignment.member_id = candidate.member_id))
    or
    (candidate.status = 'withdrawn' and candidate.assignment_id is null
     and not exists (select 1 from public.task_assignments as assignment
                      where assignment.task_id = candidate.task_id))
     from public.task_candidates as candidate
    where candidate.id = (select conflict_candidature_id from r333)),
  'exactly one of the two outcomes holds and it is internally consistent: a selected row has an Assignment its Member actually holds, or a withdrawn row has none and no Assignment exists at all');
select is((select count(*) from public.task_assignments
            where task_id = (select conflict_task_id from r333)
              and ended_at is null), 1::bigint,
  'the Task ends the race with exactly one active Assignment -- the selection is the order that actually ran');
select is((select format('%s|%s', candidate.status, (candidate.decided_at is null)::text)
             from public.task_candidates as candidate
            where candidate.task_id = (select conflict_task_id from r333)
              and candidate.member_id = '33300000-0000-0000-0000-000000000026'),
  'pending|true',
  'the uninvolved Candidate is still pending -- p_close_remaining = false, so the losing withdrawal changed nothing about them either');

-- ==================== 11. Race: selecting X while a DIFFERENT Candidate withdraws ====================
-- Same two commands, same tasks row lock, but both callers legitimately
-- succeed -- which is the only shape in which pg_temp.test_race can report
-- b_waited at all (see the header and section 10).
select pg_temp.test_login('33300000-0000-0000-0000-000000000021', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table race333 as
select * from pg_temp.test_race(
  format($$ select (public.select_task_candidate(%s, %s, false)).id::text $$,
    (select bystander_task_id from r333), (select bystander_candidature_id from r333)),
  format($$ with claims as (select set_config('request.jwt.claims', %L, true))
            select (public.withdraw_task_interest(%s)).id::text from claims $$,
    jsonb_build_object(
      'sub', '33300000-0000-0000-0000-000000000028', 'role', 'authenticated',
      'app_metadata', jsonb_build_object('member_role', 'voluntar', 'member_level', 1,
        'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text,
    (select bystander_task_id from r333)));
reset role;

select ok((select b_waited from race333),
  'the withdrawing Candidate BLOCKS until the selection commits -- select_task_candidate and withdraw_task_interest serialize on the same tasks row FOR UPDATE');
select is((select result_a from race333), (select bystander_task_id::text from r333),
  'the selection succeeds and returns the Task row');
select is((select result_b from race333), (select bystander_task_id::text from r333),
  'the concurrent withdrawal succeeds too -- a Candidate nobody selected may still leave the queue while the manager decides');
select is((select format('%s|%s', count(*), min(assignment.member_id::text))
             from public.task_assignments as assignment
            where assignment.task_id = (select bystander_task_id from r333)
              and assignment.ended_at is null),
  '1|33300000-0000-0000-0000-000000000027',
  'exactly one active Assignment survives, held by the Candidate the manager actually named');
select is((select format('%s|%s|%s', candidate.status, candidate.decided_by::text,
                         (candidate.assignment_id is null)::text)
             from public.task_candidates as candidate
            where candidate.task_id = (select bystander_task_id from r333)
              and candidate.member_id = '33300000-0000-0000-0000-000000000028'),
  'withdrawn|33300000-0000-0000-0000-000000000028|true',
  'the withdrawing Candidate''s own row is withdrawn by themselves and carries no Assignment -- the two decisions did not overwrite each other');

-- ---- clean up everything the committed sessions left behind ----
-- task_activity is append-only by trigger, including for its owner, so the
-- cleanup runs its deletes under session_replication_role = 'replica', which
-- suppresses the ENABLE ORIGIN trigger for that session only.
select extensions.dblink_exec('stc_setup', $$
  set session_replication_role = 'replica';
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#333 committed%');
  set session_replication_role = 'origin';
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#333 committed%')
      or member_id in ('33300000-0000-0000-0000-000000000021',
                       '33300000-0000-0000-0000-000000000022',
                       '33300000-0000-0000-0000-000000000023',
                       '33300000-0000-0000-0000-000000000024',
                       '33300000-0000-0000-0000-000000000025',
                       '33300000-0000-0000-0000-000000000026',
                       '33300000-0000-0000-0000-000000000027',
                       '33300000-0000-0000-0000-000000000028')
      or link in (select '/tracker/' || id::text from public.tasks
                   where title like '%#333 committed%');
  delete from public.task_candidates
   where task_id in (select id from public.tasks where title like '%#333 committed%');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%#333 committed%');
  delete from public.tasks where title like '%#333 committed%';
  delete from public.member_departments where member_id in (
    '33300000-0000-0000-0000-000000000021', '33300000-0000-0000-0000-000000000022',
    '33300000-0000-0000-0000-000000000023', '33300000-0000-0000-0000-000000000024',
    '33300000-0000-0000-0000-000000000025', '33300000-0000-0000-0000-000000000026',
    '33300000-0000-0000-0000-000000000027', '33300000-0000-0000-0000-000000000028');
  delete from auth.users where id in (
    '33300000-0000-0000-0000-000000000021', '33300000-0000-0000-0000-000000000022',
    '33300000-0000-0000-0000-000000000023', '33300000-0000-0000-0000-000000000024',
    '33300000-0000-0000-0000-000000000025', '33300000-0000-0000-0000-000000000026',
    '33300000-0000-0000-0000-000000000027', '33300000-0000-0000-0000-000000000028');
$$);
select extensions.dblink_disconnect('stc_setup');

select is((select count(*) from public.tasks where title like '%#333 committed%'), 0::bigint,
  'the committed race and lock-probe fixtures are removed again -- this suite leaves no trace');
select is((select count(*) from auth.users
            where id in ('33300000-0000-0000-0000-000000000021',
                         '33300000-0000-0000-0000-000000000022',
                         '33300000-0000-0000-0000-000000000023',
                         '33300000-0000-0000-0000-000000000024',
                         '33300000-0000-0000-0000-000000000025',
                         '33300000-0000-0000-0000-000000000026',
                         '33300000-0000-0000-0000-000000000027',
                         '33300000-0000-0000-0000-000000000028')), 0::bigint,
  'the eight committed race/lock-probe fixture accounts are removed too, not just their Tasks');
-- notifications.task_id is ON DELETE SET NULL, so a leftover row would survive
-- with a nulled task_id and be invisible to a task_id-keyed check; link
-- ('/tracker/<id>') still names the deleted Task and cannot be erased by the
-- cascade, so this is the assertion that would actually catch it.
select is((select count(*) from public.notifications
            where link in (
              select '/tracker/' || task_id::text from (
                select probe_task_id as task_id from r333
                union all select conflict_task_id from r333
                union all select bystander_task_id from r333
              ) as committed_task_ids
            )), 0::bigint,
  'no notification survives with a nulled task_id after the committed Tasks are deleted -- checked by link, which ON DELETE SET NULL cannot erase');

select * from finish();
rollback;
