-- #332: public.give_up_task -- the Executor leaves a Task they hold, giving a
-- required reason, and the oldest pending Candidate is promoted into the slot
-- they vacate IN THE SAME TRANSACTION.
--
-- The safety property this suite exists for: a Task must never be left with
-- two Executors, and must never be left with none while its Candidate Queue
-- still has someone waiting. The give-up and the promotion are one atomic
-- step serialized on the tasks row FOR UPDATE, taken before any Assignment or
-- Candidature state is read -- the same serialization point #330's
-- express_task_interest uses, which is exactly why the two commands can race
-- and still agree. Sections 9 and 10 run that race in the two interesting
-- queue shapes: an EMPTY queue (section 9) and a NON-EMPTY one (section 10,
-- where the promoted Candidate wins the slot and the outsider queues behind
-- them). pg_temp.test_race always runs the give-up (session A) to completion
-- before express_task_interest (session B) is even sent, so only the
-- give-up-first order is ever actually exercised in either section -- the
-- assertions admit either legitimate mechanism (first_come or
-- queue_promotion) as a matter of correctness, not because both commit orders
-- were run.
--
-- Honest limitation, found by mutation rather than assumed (see
-- task-7-report.md Sec5 M2): with the tasks-row FOR UPDATE removed from
-- give_up_task_impl, both races STILL report b_waited = true and land on the
-- same end state -- session B still blocks on the Task row, because every
-- write the promotion makes (the new Assignment, its executor_assigned row,
-- the candidate_selected row) carries a task_id foreign key and so takes a
-- FOR KEY SHARE lock on it regardless, and session B's own FOR UPDATE
-- conflicts with that KEY SHARE just the same. Only section 8's pgrowlocks
-- probe actually fails under that mutation. The point still stands that the
-- explicit lock is what should serialize this: KEY SHARE does not conflict
-- with KEY SHARE, so two commands BOTH missing the explicit FOR UPDATE would
-- not serialize against each other at all.
--
-- The Task's status never changes: an in_progress Task stays in_progress for
-- the promoted Executor (started_at is already set and is not rewound), a todo
-- Task stays todo. A direct Task has no queue at all, so it simply ends up
-- with no Executor -- which is the exact state #342's assign_task_executor
-- exists to remedy; section 3 composes the two commands to prove it.
--
-- Fixed in the review round (stack-context.md carry-forward, #332): the
-- promotion originally picked the oldest pending Candidature with no
-- liveness filter, so a deactivated Candidate at the head of the queue made
-- private.open_task_assignment raise PT400 invalid_executor and rolled the
-- whole give-up back with it -- an Executor unable to leave a Task because a
-- DIFFERENT person was deactivated. Section 6 now pins the fix: a deactivated
-- head-of-queue Candidate is skipped and left pending (never closed) while
-- the active Candidate behind them is promoted, and a queue holding only
-- deactivated Candidates lets the give-up succeed with nobody promoted, same
-- as an empty queue.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(99);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('33200000-0000-0000-0000-000000000001', 'manager.332@test.local'),
  ('33200000-0000-0000-0000-000000000002', 'executor.332@test.local'),
  ('33200000-0000-0000-0000-000000000003', 'candidate.one.332@test.local'),
  ('33200000-0000-0000-0000-000000000004', 'candidate.two.332@test.local'),
  ('33200000-0000-0000-0000-000000000005', 'past.executor.332@test.local'),
  ('33200000-0000-0000-0000-000000000006', 'outsider.332@test.local'),
  ('33200000-0000-0000-0000-000000000007', 'inactive.bc.332@test.local'),
  ('33200000-0000-0000-0000-000000000008', 'claimless.332@test.local'),
  ('33200000-0000-0000-0000-000000000009', 'direct.executor.332@test.local'),
  ('33200000-0000-0000-0000-000000000010', 'review.executor.332@test.local'),
  ('33200000-0000-0000-0000-000000000011', 'dead.queue.executor.332@test.local'),
  ('33200000-0000-0000-0000-000000000012', 'dead.head.executor.332@test.local'),
  ('33200000-0000-0000-0000-000000000013', 'self.candidate.332@test.local'),
  ('33200000-0000-0000-0000-000000000014', 'self.only.332@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('33200000-0000-0000-0000-000000000001', 'Manager 332', 'manager.332@test.local', 'bce', 'activ'),
  ('33200000-0000-0000-0000-000000000002', 'Executor 332', 'executor.332@test.local', 'voluntar', 'activ'),
  ('33200000-0000-0000-0000-000000000003', 'Candidat Unu 332', 'candidate.one.332@test.local', 'voluntar', 'activ'),
  ('33200000-0000-0000-0000-000000000004', 'Candidat Doi 332', 'candidate.two.332@test.local', 'voluntar', 'activ'),
  ('33200000-0000-0000-0000-000000000005', 'Fost Executor 332', 'past.executor.332@test.local', 'voluntar', 'activ'),
  ('33200000-0000-0000-0000-000000000006', 'Din Afara 332', 'outsider.332@test.local', 'voluntar', 'activ'),
  ('33200000-0000-0000-0000-000000000007', 'BC Inactiv 332', 'inactive.bc.332@test.local', 'bc', 'inactiv'),
  ('33200000-0000-0000-0000-000000000008', 'Fara Claimuri 332', 'claimless.332@test.local', 'voluntar', 'activ'),
  ('33200000-0000-0000-0000-000000000009', 'Executor Direct 332', 'direct.executor.332@test.local', 'voluntar', 'activ'),
  ('33200000-0000-0000-0000-000000000010', 'Executor In Verificare 332', 'review.executor.332@test.local', 'voluntar', 'activ'),
  ('33200000-0000-0000-0000-000000000011', 'Executor Coada Moarta 332', 'dead.queue.executor.332@test.local', 'voluntar', 'activ'),
  ('33200000-0000-0000-0000-000000000012', 'Executor Cap Dezactivat 332', 'dead.head.executor.332@test.local', 'voluntar', 'activ'),
  ('33200000-0000-0000-0000-000000000013', 'Executor Auto-Candidat 332', 'self.candidate.332@test.local', 'voluntar', 'activ'),
  ('33200000-0000-0000-0000-000000000014', 'Executor Auto-Candidat Singur 332', 'self.only.332@test.local', 'voluntar', 'activ');

insert into public.member_departments (member_id, dept_id) values
  ('33200000-0000-0000-0000-000000000001', 'edu'),
  ('33200000-0000-0000-0000-000000000002', 'edu'),
  ('33200000-0000-0000-0000-000000000003', 'edu'),
  ('33200000-0000-0000-0000-000000000004', 'edu'),
  ('33200000-0000-0000-0000-000000000005', 'edu'),
  ('33200000-0000-0000-0000-000000000009', 'edu'),
  ('33200000-0000-0000-0000-000000000010', 'edu'),
  ('33200000-0000-0000-0000-000000000011', 'edu'),
  ('33200000-0000-0000-0000-000000000012', 'edu'),
  ('33200000-0000-0000-0000-000000000013', 'edu'),
  ('33200000-0000-0000-0000-000000000014', 'edu');
-- #586: materialize this suite's legacy setup as rolled-back Group fixtures.
select pg_temp.materialize_legacy_groups();


-- ---- T1: the promotion happy path -- a public Task in progress, one
-- Executor, two pending Candidates in a known order.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, started_at, queue_opened_at, created_by)
values
  ('Renuntare cu coada #332', 'Are coada', '2027-07-01 09:00:00+00', pg_temp.dept_group('edu'), 'org', 'public', 'in_progress',
   now(), now(), '33200000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33200000-0000-0000-0000-000000000002', '33200000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Renuntare cu coada #332';
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33200000-0000-0000-0000-000000000003'::uuid, 'pending', now() - interval '2 hours'
  from public.tasks where title = 'Renuntare cu coada #332'
union all
select id, '33200000-0000-0000-0000-000000000004'::uuid, 'pending', now() - interval '1 hour'
  from public.tasks where title = 'Renuntare cu coada #332';

-- ---- T2: a direct Task -- no queue, so the give-up simply empties the slot.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, created_by)
values
  ('Renuntare directa #332', 'Fara coada', '2027-07-02 09:00:00+00', pg_temp.dept_group('edu'), 'local', 'direct', 'todo',
   '33200000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33200000-0000-0000-0000-000000000009', '33200000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Renuntare directa #332';

-- ---- T3: in_review -- ADR-0007's explicitly blocked case.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, started_at, submitted_at, created_by)
values
  ('In verificare #332', 'Trimis spre verificare', '2027-07-03 09:00:00+00', pg_temp.dept_group('edu'), 'local', 'direct', 'in_review',
   now(), now(), '33200000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33200000-0000-0000-0000-000000000010', '33200000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'In verificare #332';

-- ---- T4: the blank-reason target.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, created_by)
values
  ('Motiv gol #332', 'Motiv lipsa', '2027-07-04 09:00:00+00', pg_temp.dept_group('edu'), 'local', 'direct', 'todo',
   '33200000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33200000-0000-0000-0000-000000000002', '33200000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Motiv gol #332';

-- ---- T5: the persona matrix target -- an active Executor plus a past one,
-- so the past Executor reads the Task (can_read_task R2) and is still denied.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, created_by)
values
  ('Persoane #332', 'Matricea de persoane', '2027-07-05 09:00:00+00', pg_temp.dept_group('edu'), 'local', 'direct', 'todo',
   '33200000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at, ended_at, end_reason)
select id, '33200000-0000-0000-0000-000000000005', '33200000-0000-0000-0000-000000000001',
       now() - interval '2 days', now() - interval '1 day', 'replaced'
  from public.tasks where title = 'Persoane #332';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33200000-0000-0000-0000-000000000002', '33200000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Persoane #332';

-- ---- T6: a cancelled Task that still carries an active Assignment. Fixtured
-- by hand (no command produces this shape) purely to prove the state check
-- rejects every non-todo/in_progress status, not just in_review.
-- #339: tasks_cancel_reason_ck makes cancel_reason mandatory on -- and
-- exclusive to -- a cancelled Task, so this fixture states why it was called
-- off. Nothing else about the fixture changes.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, cancelled_at, cancel_reason, created_by)
values
  ('Anulat #332', 'Anulat', '2027-07-06 09:00:00+00', pg_temp.dept_group('edu'), 'local', 'direct', 'cancelled', now(),
   'Anulat cu executant activ #332', '33200000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33200000-0000-0000-0000-000000000002', '33200000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Anulat #332';

-- ---- T7: a queue with ONLY a deactivated Candidate (section 6) -- the
-- give-up now succeeds with nobody promoted, same as an empty queue.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, started_at, queue_opened_at, created_by)
values
  ('Candidat dezactivat #332', 'Coada moarta', '2027-07-07 09:00:00+00', pg_temp.dept_group('edu'), 'org', 'public', 'in_progress',
   now(), now(), '33200000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33200000-0000-0000-0000-000000000011', '33200000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Candidat dezactivat #332';
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33200000-0000-0000-0000-000000000007', 'pending', now() - interval '3 hours'
  from public.tasks where title = 'Candidat dezactivat #332';

-- ---- T8: a deactivated Candidate at the HEAD of the queue (007, joined
-- first) with an active Candidate behind them (006, joined second) --
-- section 6's discriminating case: the dead head is skipped in place, the
-- live Candidate behind them is promoted.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, started_at, queue_opened_at, created_by)
values
  ('Cap de coada dezactivat #332', 'Coada cu cap mort', '2027-07-08 09:00:00+00', pg_temp.dept_group('edu'), 'org', 'public', 'in_progress',
   now(), now(), '33200000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33200000-0000-0000-0000-000000000012', '33200000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Cap de coada dezactivat #332';
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33200000-0000-0000-0000-000000000007'::uuid, 'pending', now() - interval '2 hours'
  from public.tasks where title = 'Cap de coada dezactivat #332'
union all
select id, '33200000-0000-0000-0000-000000000006'::uuid, 'pending', now() - interval '1 hour'
  from public.tasks where title = 'Cap de coada dezactivat #332';

-- ---- T9: the giver-upper (013) also holds a pending Candidature on their
-- OWN Task, joined before a genuinely different active Member (003, reused
-- from T1) joins later -- the actor-exclusion guard's discriminating case.
-- Hand-fixtured, same as T6: task_candidates has no check constraint,
-- trigger or FK stopping an Executor from being inserted as a Candidate on
-- their own Task, so this shape is reachable only by a hand-built row, not
-- by any command on main -- exactly the precedent T6 sets for the state
-- check.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, started_at, queue_opened_at, created_by)
values
  ('Auto-candidatura cu altul #332', 'Executorul e si candidat', '2027-07-09 09:00:00+00', pg_temp.dept_group('edu'), 'org', 'public', 'in_progress',
   now(), now(), '33200000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33200000-0000-0000-0000-000000000013', '33200000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Auto-candidatura cu altul #332';
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33200000-0000-0000-0000-000000000013'::uuid, 'pending', now() - interval '2 hours'
  from public.tasks where title = 'Auto-candidatura cu altul #332'
union all
select id, '33200000-0000-0000-0000-000000000003'::uuid, 'pending', now() - interval '1 hour'
  from public.tasks where title = 'Auto-candidatura cu altul #332';

-- ---- T10: the giver-upper (014) is the ONLY pending Candidate on their own
-- Task -- the cheap second case: excluded from their own promotion, nobody
-- is promoted, and the Task ends Executor-less exactly like an empty queue.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, started_at, queue_opened_at, created_by)
values
  ('Auto-candidatura singura #332', 'Executorul e singurul candidat', '2027-07-10 09:00:00+00', pg_temp.dept_group('edu'), 'org', 'public', 'in_progress',
   now(), now(), '33200000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33200000-0000-0000-0000-000000000014', '33200000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Auto-candidatura singura #332';
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33200000-0000-0000-0000-000000000014'::uuid, 'pending', now() - interval '1 hour'
  from public.tasks where title = 'Auto-candidatura singura #332';

-- Every fixture id resolved ONCE, as the owner. Never resolve an id inside a
-- format() while a denied persona is logged in: the lookup would run under
-- that persona's RLS, return NULL, and the assertion would pass for the wrong
-- reason (the #328 trap, stack-context.md carry-forwards).
create temp table f332 as
select
  9223372036854775807::bigint as missing_id,
  (select id from public.tasks where title = 'Renuntare cu coada #332') as queue_task_id,
  (select id from public.tasks where title = 'Renuntare directa #332') as direct_task_id,
  (select id from public.tasks where title = 'In verificare #332') as review_task_id,
  (select id from public.tasks where title = 'Motiv gol #332') as blank_task_id,
  (select id from public.tasks where title = 'Persoane #332') as persona_task_id,
  (select id from public.tasks where title = 'Anulat #332') as cancelled_task_id,
  (select id from public.tasks where title = 'Candidat dezactivat #332') as dead_queue_task_id,
  (select id from public.tasks where title = 'Cap de coada dezactivat #332') as dead_head_task_id,
  (select id from public.tasks where title = 'Auto-candidatura cu altul #332') as self_and_other_task_id,
  (select id from public.tasks where title = 'Auto-candidatura singura #332') as self_only_task_id;
grant select on f332 to authenticated, anon;

-- ==================== 1. API shape and privileges ====================

select has_function('public', 'give_up_task', array['bigint', 'text'],
  'public.give_up_task exists with the pinned two-parameter signature');
select is(pg_get_function_identity_arguments(
    'public.give_up_task(bigint, text)'::regprocedure),
  'p_task_id bigint, p_reason text',
  'give_up_task exposes no actor parameter -- the actor is always auth.uid()');
select is(pg_get_function_result(
    'public.give_up_task(bigint, text)'::regprocedure),
  'tasks', 'give_up_task returns the affected Task row');
select ok(not (select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public' and procedure.proname = 'give_up_task'),
  'the public command is a security invoker wrapper');
select ok((select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private' and procedure.proname = 'give_up_task_impl'),
  'private.give_up_task_impl runs as owner (security definer)');
select ok(coalesce((
    select bool_and('search_path=""' = any(procedure.proconfig))
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private' and procedure.proname = 'give_up_task_impl'
  ), false), 'give_up_task_impl pins an empty search_path');
select ok(has_function_privilege('authenticated',
  'public.give_up_task(bigint, text)'::regprocedure, 'execute'),
  'authenticated can execute public.give_up_task');
select ok(not has_function_privilege('anon',
  'public.give_up_task(bigint, text)'::regprocedure, 'execute'),
  'anon cannot execute public.give_up_task');
select ok(has_function_privilege('authenticated',
  'private.give_up_task_impl(bigint, text)'::regprocedure, 'execute'),
  'authenticated can execute private.give_up_task_impl');

-- ==================== 2. Give up with a queue: the atomic promotion ====================
-- The reason is passed with surrounding whitespace to prove it is trimmed with
-- the regexp_replace idiom (never btrim) everywhere it lands: the Assignment's
-- end_note, the activity note, details.reason and the managers' notification.

select pg_temp.test_login('33200000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.give_up_task(%s, '   Nu mai am timp.   ') $$,
  (select queue_task_id from f332)),
  'the active Executor may give up a Task in progress, with a reason');
reset role;

select is((select format('%s|%s|%s', (assignment.ended_at is not null)::text,
                         assignment.end_reason, assignment.end_note)
             from public.task_assignments as assignment
            where assignment.task_id = (select queue_task_id from f332)
              and assignment.member_id = '33200000-0000-0000-0000-000000000002'),
  'true|gave_up|Nu mai am timp.',
  'the Executor''s Assignment is ended with end_reason gave_up and the trimmed reason as its end_note');
select is((select format('%s|%s|%s', count(*), min(assignment.member_id::text),
                         min(assignment.assigned_by::text))
             from public.task_assignments as assignment
            where assignment.task_id = (select queue_task_id from f332)
              and assignment.ended_at is null),
  '1|33200000-0000-0000-0000-000000000003|33200000-0000-0000-0000-000000000002',
  'exactly one active Assignment survives, held by the promoted Candidate and recorded as opened by the giver-upper');
select is((select format('%s|%s|%s|%s', candidate.status, candidate.decided_by,
                         (candidate.decided_at is not null)::text,
                         (candidate.assignment_id = (select assignment.id from public.task_assignments as assignment
                                                      where assignment.task_id = candidate.task_id
                                                        and assignment.ended_at is null))::text)
             from public.task_candidates as candidate
            where candidate.task_id = (select queue_task_id from f332)
              and candidate.member_id = '33200000-0000-0000-0000-000000000003'),
  'selected|33200000-0000-0000-0000-000000000002|true|true',
  'the promoted Candidature is selected, decided by the giver-upper, and points at the NEW Assignment (task_candidates_decision_shape_ck)');
select is((select format('%s|%s|%s', candidate.status,
                         (candidate.decided_at is null)::text, (candidate.assignment_id is null)::text)
             from public.task_candidates as candidate
            where candidate.task_id = (select queue_task_id from f332)
              and candidate.member_id = '33200000-0000-0000-0000-000000000004'),
  'pending|true|true',
  'the Candidate behind them is untouched -- still pending, still undecided');

select pg_temp.test_login('33200000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select private.queue_position((select queue_task_id from f332),
            '33200000-0000-0000-0000-000000000004')), 1,
  'the remaining Candidate moves from position 2 to position 1 -- queue order is derived, never renumbered');
reset role;

select is((select format('%s|%s|%s|%s|%s|%s', activity.kind, activity.actor_id,
                         (activity.assignment_id = (select assignment.id from public.task_assignments as assignment
                                                     where assignment.task_id = activity.task_id
                                                       and assignment.member_id = '33200000-0000-0000-0000-000000000002'))::text,
                         activity.note, activity.details ->> 'reason',
                         (activity.from_status is null and activity.to_status is null)::text)
             from public.task_activity as activity
            where activity.task_id = (select queue_task_id from f332)
              and activity.kind = 'gave_up'),
  'gave_up|33200000-0000-0000-0000-000000000002|true|Nu mai am timp.|Nu mai am timp.|true',
  'the gave_up row names the giver-upper, carries the ENDED Assignment''s id, the trimmed reason as note and details.reason, and no status change');
select is((select format('%s|%s|%s|%s', activity.actor_id,
                         (activity.assignment_id = (select assignment.id from public.task_assignments as assignment
                                                     where assignment.task_id = activity.task_id
                                                       and assignment.ended_at is null))::text,
                         activity.details ->> 'candidate_id', activity.details ->> 'promoted')
             from public.task_activity as activity
            where activity.task_id = (select queue_task_id from f332)
              and activity.kind = 'candidate_selected'),
  format('33200000-0000-0000-0000-000000000002|true|%s|true',
    (select candidate.id from public.task_candidates as candidate
      where candidate.task_id = (select queue_task_id from f332)
        and candidate.member_id = '33200000-0000-0000-0000-000000000003')),
  'the candidate_selected row carries the NEW Assignment''s id, details.candidate_id and details.promoted = true');
select is((select format('%s|%s|%s', activity.details ->> 'via', activity.details ->> 'member_id',
                         (activity.assignment_id = (select assignment.id from public.task_assignments as assignment
                                                     where assignment.task_id = activity.task_id
                                                       and assignment.ended_at is null))::text)
             from public.task_activity as activity
            where activity.task_id = (select queue_task_id from f332)
              and activity.kind = 'executor_assigned'),
  'queue_promotion|33200000-0000-0000-0000-000000000003|true',
  'private.open_task_assignment writes the executor_assigned row with details.via = queue_promotion');
select is((select count(*) from public.task_activity
            where task_id = (select queue_task_id from f332)), 3::bigint,
  'exactly three activity rows are written: gave_up, executor_assigned and candidate_selected');
select is((select format('%s|%s', task.status, (task.started_at is not null)::text)
             from public.tasks as task where task.id = (select queue_task_id from f332)),
  'in_progress|true',
  'the Task''s status does not change -- an in_progress Task stays in_progress for the promoted Executor, started_at intact');

select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s $$, (select queue_task_id from f332)),
  $$ values ('33200000-0000-0000-0000-000000000001'::uuid),
         ('33200000-0000-0000-0000-000000000003'::uuid) $$,
  'exactly the Task manager and the promoted Candidate are notified -- the giver-upper, as actor, hears nothing');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s and notification.title like 'Renunțare:%%' $$,
    (select queue_task_id from f332)),
  $$ values ('33200000-0000-0000-0000-000000000001'::uuid) $$,
  'the give-up notification goes to private.task_managers -- here the Task''s creator -- and to nobody else');
select is((select format('%s|%s|%s', notification.title, notification.body,
                         (notification.dedupe_key is null)::text)
             from public.notifications as notification
            where notification.task_id = (select queue_task_id from f332)
              and notification.member_id = '33200000-0000-0000-0000-000000000001'),
  'Renunțare: Renuntare cu coada #332|Executor 332 a renunțat: Nu mai am timp.|true',
  'the manager notification uses the pinned Romanian give-up copy with the trimmed reason, and is never coalesced');
select is((select format('%s|%s', notification.title, notification.body)
             from public.notifications as notification
            where notification.task_id = (select queue_task_id from f332)
              and notification.member_id = '33200000-0000-0000-0000-000000000003'),
  'Task nou: Renuntare cu coada #332|Ți-a fost atribuit acest task. Deadline: 01.07.2027 12:00.',
  'the promoted Candidate gets the pinned "Task nou" notification from private.open_task_assignment');

-- ==================== 3. A direct Task ends with no Executor, then #342 fills it ====================

-- #675: this Executor carries a Nickname; section 2's give-up (no Nickname)
-- named its actor by full name, this one names its actor by the Nickname.
reset role;
update public.profiles set nickname = 'Renunt 332'
 where id = '33200000-0000-0000-0000-000000000009';

select pg_temp.test_login('33200000-0000-0000-0000-000000000009', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.give_up_task(%s, 'Nu mai pot continua.') $$,
  (select direct_task_id from f332)),
  'the Executor of a direct Task may give up too -- there is simply no queue to promote from');
select throws_ok(format($$ select public.give_up_task(%s, 'Inca o data.') $$,
  (select direct_task_id from f332)), '42501', 'task_executor_forbidden',
  'giving up twice is refused: after the first give-up there is no active Assignment to leave');
reset role;

select is((select format('%s|%s', count(*), count(*) filter (where ended_at is null))
             from public.task_assignments where task_id = (select direct_task_id from f332)),
  '1|0', 'the direct Task is left with exactly one Assignment row, ended -- no Executor at all');
select is((select count(*) from public.task_candidates
            where task_id = (select direct_task_id from f332)), 0::bigint,
  'no Candidature is invented for a direct Task -- it has no Candidate Queue to promote from');
select is((select format('%s|%s', count(*), count(*) filter (where kind = 'gave_up'))
             from public.task_activity where task_id = (select direct_task_id from f332)),
  '1|1', 'exactly one activity row is written -- gave_up alone, with no promotion to record');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s $$, (select direct_task_id from f332)),
  $$ values ('33200000-0000-0000-0000-000000000001'::uuid) $$,
  'only the Task manager is notified -- with no promotion there is no "Task nou" recipient');
select is((select notification.body from public.notifications as notification
            where notification.task_id = (select direct_task_id from f332)
              and notification.title like 'Renunțare:%'),
  'Renunt 332 a renunțat: Nu mai pot continua.',
  'with a Nickname set, the "Renunțare" body names the Executor by it, read at write time (#675)');

select pg_temp.test_login('33200000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.assign_task_executor(%s, '33200000-0000-0000-0000-000000000006') $$,
  (select direct_task_id from f332)),
  'a manager can hand the emptied direct Task to someone else -- #332 and #342 compose, which is why #342 ships first');
reset role;

select is((select format('%s|%s|%s', count(*), count(*) filter (where ended_at is null),
                         min(assignment.member_id::text) filter (where assignment.ended_at is null))
             from public.task_assignments as assignment
            where assignment.task_id = (select direct_task_id from f332)),
  '2|1|33200000-0000-0000-0000-000000000006',
  'the direct Task now has two Assignment rows, exactly one active, held by the newly assigned Member');

-- ==================== 4. Input and state preconditions ====================

select pg_temp.test_login('33200000-0000-0000-0000-000000000010', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.give_up_task(%s, 'Nu mai am timp.') $$,
  (select review_task_id from f332)), 'PT409', 'task_not_in_progress',
  'a Task already submitted for review cannot be abandoned -- ADR-0007''s explicitly blocked case');
reset role;

select pg_temp.test_login('33200000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.give_up_task(%s, 'Nu mai am timp.') $$,
  (select cancelled_task_id from f332)), 'PT409', 'task_not_in_progress',
  'the state check admits only todo and in_progress -- a cancelled Task answers the same PT409, not a different reason');
select throws_ok(format($$ select public.give_up_task(%s, '   ') $$,
  (select blank_task_id from f332)), 'PT400', 'reason_required',
  'a whitespace-only reason is rejected -- the reason is what the manager reads, so it may not be blank');
select throws_ok(format($$ select public.give_up_task(%s, null) $$,
  (select blank_task_id from f332)), 'PT400', 'reason_required',
  'a null reason is rejected the same way');
select throws_ok(format($$ select public.give_up_task(%s, 'Nu mai am timp.') $$,
  (select missing_id from f332)), 'PT404', 'task_not_found',
  'an unknown Task is not found, not forbidden -- and a null-or-missing id never becomes a PT400');
reset role;

-- The blank-reason check runs BEFORE the membership gate: the input is
-- malformed for every caller, so a claimless uid gets PT400, not 42501. This
-- is the one pinned ordering decision of this command, and nothing else in the
-- suite would notice if it moved.
select pg_temp.test_login('33200000-0000-0000-0000-000000000008',
  jsonb_build_object('provider', 'email'));
select throws_ok(format($$ select public.give_up_task(%s, '') $$,
  (select blank_task_id from f332)), 'PT400', 'reason_required',
  'a blank reason answers PT400 even for a caller who would fail the gate -- malformed for everyone, checked first');
reset role;

select is((select count(*) from public.task_activity
            where task_id in (select review_task_id from f332)
               or task_id in (select blank_task_id from f332)
               or task_id in (select cancelled_task_id from f332)), 0::bigint,
  'none of the six rejected input/state calls wrote an activity row');
select is((select count(*) from public.notifications
            where task_id in (select review_task_id from f332)
               or task_id in (select blank_task_id from f332)
               or task_id in (select cancelled_task_id from f332)), 0::bigint,
  'none of the six rejected input/state calls wrote a notification');
select is((select count(*) from public.task_assignments
            where ended_at is null
              and (task_id in (select review_task_id from f332)
                or task_id in (select blank_task_id from f332)
                or task_id in (select cancelled_task_id from f332))), 3::bigint,
  'all three rejected Tasks keep their active Assignment -- nothing was ended behind the error');

-- ==================== 5. Persona denials ====================
-- Only the Task's own active Executor may give it up. Everyone else is
-- 42501 -- and which 42501 depends on how far they get: the gate answers
-- task_command_forbidden, the authority check task_executor_forbidden.

select pg_temp.test_login('33200000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.give_up_task(%s, 'Renunt in numele lui.') $$,
  (select persona_task_id from f332)), '42501', 'task_executor_forbidden',
  'the Task''s own manager cannot give it up for the Executor -- managing is not executing');
reset role;

select pg_temp.test_login('33200000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.give_up_task(%s, 'Am fost executant candva.') $$,
  (select persona_task_id from f332)), '42501', 'task_executor_forbidden',
  'a PAST Executor still reads the Task (can_read_task R2) but their ended Assignment grants nothing');
reset role;

select pg_temp.test_login('33200000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.give_up_task(%s, 'Nici macar nu il vad.') $$,
  (select persona_task_id from f332)), 'PT404', 'task_not_found',
  'an ordinary Member with no relation to a local direct Task cannot even see it -- PT404, never a hint that it exists');
reset role;

select pg_temp.test_login('33200000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.give_up_task(%s, 'Token vechi.') $$,
  (select persona_task_id from f332)), '42501', 'task_command_forbidden',
  'a deactivated BC holding a still-valid level-6 token is stopped at the gate');
reset role;

select pg_temp.test_login('33200000-0000-0000-0000-000000000008',
  jsonb_build_object('provider', 'email'));
select throws_ok(format($$ select public.give_up_task(%s, 'Fara claimuri.') $$,
  (select persona_task_id from f332)), '42501', 'task_command_forbidden',
  'a real uid without organisation claims is stopped at the gate too');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(format($$ select public.give_up_task(%s, 'Anonim.') $$,
  (select persona_task_id from f332)),
  '42501', 'permission denied for function give_up_task',
  'anon cannot execute give_up_task at all -- the literal grant denial, not a gate that happens to raise 42501');
reset role;

select is((select count(*) from public.task_activity
            where task_id = (select persona_task_id from f332)), 0::bigint,
  'none of the six denied personas wrote an activity row on the persona Task');
select is((select count(*) from public.notifications
            where task_id = (select persona_task_id from f332)), 0::bigint,
  'none of the six denied personas wrote a notification');
select is((select format('%s|%s', count(*) filter (where ended_at is null),
                         min(member_id::text) filter (where ended_at is null))
             from public.task_assignments where task_id = (select persona_task_id from f332)),
  '1|33200000-0000-0000-0000-000000000002',
  'the persona Task still has its one active Assignment, still held by the same Executor');

-- ==================== 6. Liveness filter: deactivated Candidates are skipped ====================
-- The promotion joins the pending Candidature to profiles filtered to
-- status = 'activ' (stack-context.md carry-forward, #332): a deactivated
-- Candidate is stale and unpromotable, but SKIPPED rather than closed --
-- closing a Candidature is a manager act (#331/#333) with its own
-- notification, not a side effect of someone else's give-up.

-- ---- T7: a queue with ONLY a deactivated Candidate -- the give-up succeeds
-- with nobody promoted, exactly like an empty queue.
select pg_temp.test_login('33200000-0000-0000-0000-000000000011', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.give_up_task(%s, 'Renunt.') $$,
  (select dead_queue_task_id from f332)),
  'a queue holding only a deactivated Candidate does not block the give-up -- it succeeds with nobody promoted');
reset role;

select is((select format('%s|%s', count(*), count(*) filter (where ended_at is null))
             from public.task_assignments where task_id = (select dead_queue_task_id from f332)),
  '1|0', 'the Task is left with no active Assignment -- exactly the empty-queue end state');
select is((select format('%s|%s|%s|%s', candidate.status,
                         (candidate.decided_at is null)::text, (candidate.decided_by is null)::text,
                         (candidate.assignment_id is null)::text)
             from public.task_candidates as candidate
            where candidate.task_id = (select dead_queue_task_id from f332)
              and candidate.member_id = '33200000-0000-0000-0000-000000000007'),
  'pending|true|true|true',
  'the deactivated Candidate''s row is untouched -- still pending, still undecided, no Assignment -- closing it is a manager act, not a side effect');
select is((select count(*) from public.task_activity
            where task_id = (select dead_queue_task_id from f332) and kind = 'candidate_selected'), 0::bigint,
  'no candidate_selected row is written -- nobody was promoted');

-- ---- T8: a deactivated Candidate at the HEAD of the queue, an active
-- Candidate behind them -- the head is skipped in place, the active one is
-- promoted. The reviewer's specific demand: "skip" must not be
-- implementable as "close", so the skipped row's decision columns are
-- asserted still null, not just its status.
select pg_temp.test_login('33200000-0000-0000-0000-000000000012', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.give_up_task(%s, 'Renunt si eu.') $$,
  (select dead_head_task_id from f332)),
  'the Executor gives up a Task whose queue head is deactivated -- the promotion skips them and reaches the active Candidate behind');
reset role;

select is((select format('%s|%s|%s|%s', candidate.status,
                         (candidate.decided_at is null)::text, (candidate.decided_by is null)::text,
                         (candidate.assignment_id is null)::text)
             from public.task_candidates as candidate
            where candidate.task_id = (select dead_head_task_id from f332)
              and candidate.member_id = '33200000-0000-0000-0000-000000000007'),
  'pending|true|true|true',
  'the deactivated head-of-queue Candidate is SKIPPED, not closed -- still pending, and decided_at/decided_by/assignment_id are all still null');
select is((select format('%s|%s|%s|%s', candidate.status, candidate.decided_by,
                         (candidate.decided_at is not null)::text,
                         (candidate.assignment_id = (select assignment.id from public.task_assignments as assignment
                                                      where assignment.task_id = candidate.task_id
                                                        and assignment.ended_at is null))::text)
             from public.task_candidates as candidate
            where candidate.task_id = (select dead_head_task_id from f332)
              and candidate.member_id = '33200000-0000-0000-0000-000000000006'),
  'selected|33200000-0000-0000-0000-000000000012|true|true',
  'the active Candidate behind the deactivated head is the one actually promoted, decided by the giver-upper, pointing at the new Assignment');
select is((select format('%s|%s', count(*), min(assignment.member_id::text))
             from public.task_assignments as assignment
            where assignment.task_id = (select dead_head_task_id from f332)
              and assignment.ended_at is null),
  '1|33200000-0000-0000-0000-000000000006',
  'exactly one active Assignment survives, held by the active Candidate promoted from behind the deactivated head');
select is((select count(*) from public.task_activity
            where task_id = (select dead_head_task_id from f332) and kind = 'candidate_selected'), 1::bigint,
  'exactly one candidate_selected row is written -- for the promoted Candidate, not the skipped one');

-- ---- T9: the actor-exclusion guard (candidate.member_id <> v_actor). The
-- giver-upper is themselves a pending Candidate on their own Task, having
-- joined the queue before a genuinely different, still-active Member -- the
-- guard must skip the giver-upper and reach the Candidate behind them,
-- exactly as the liveness filter above skips a dead head-of-queue Candidate.
select pg_temp.test_login('33200000-0000-0000-0000-000000000013', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.give_up_task(%s, 'Renunt, dar sunt si eu in coada.') $$,
  (select self_and_other_task_id from f332)),
  'the giver-upper is also a pending Candidate on their own Task -- the give-up still succeeds');
reset role;

select is((select format('%s|%s', count(*), min(assignment.member_id::text))
             from public.task_assignments as assignment
            where assignment.task_id = (select self_and_other_task_id from f332)
              and assignment.ended_at is null),
  '1|33200000-0000-0000-0000-000000000003',
  'the genuinely different, later-joined Candidate is promoted -- not the giver-upper who was queued ahead of them');
select is((select format('%s|%s|%s|%s', candidate.status,
                         (candidate.decided_at is null)::text, (candidate.decided_by is null)::text,
                         (candidate.assignment_id is null)::text)
             from public.task_candidates as candidate
            where candidate.task_id = (select self_and_other_task_id from f332)
              and candidate.member_id = '33200000-0000-0000-0000-000000000013'),
  'pending|true|true|true',
  'the giver-upper''s own self-candidature is left exactly as it was -- still pending, still undecided, no Assignment -- the guard excludes them, it does not close them');
select is((select format('%s|%s|%s|%s', candidate.status, candidate.decided_by,
                         (candidate.decided_at is not null)::text,
                         (candidate.assignment_id = (select assignment.id from public.task_assignments as assignment
                                                      where assignment.task_id = candidate.task_id
                                                        and assignment.ended_at is null))::text)
             from public.task_candidates as candidate
            where candidate.task_id = (select self_and_other_task_id from f332)
              and candidate.member_id = '33200000-0000-0000-0000-000000000003'),
  'selected|33200000-0000-0000-0000-000000000013|true|true',
  'the other Candidate is selected, decided by the giver-upper, and points at the new Assignment');
select is((select count(*) from public.task_activity
            where task_id = (select self_and_other_task_id from f332) and kind = 'candidate_selected'), 1::bigint,
  'exactly one candidate_selected row is written -- for the other Candidate, not the giver-upper');

-- ---- T10: the giver-upper is the ONLY pending Candidate on their own Task
-- -- the cheap second case. Excluded from their own promotion, so nobody is
-- promoted and the Task ends Executor-less, exactly like an empty queue.
select pg_temp.test_login('33200000-0000-0000-0000-000000000014', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.give_up_task(%s, 'Sunt singurul candidat.') $$,
  (select self_only_task_id from f332)),
  'the giver-upper is the only pending Candidate on their own Task -- the give-up still succeeds with nobody promoted');
reset role;

select is((select format('%s|%s', count(*), count(*) filter (where ended_at is null))
             from public.task_assignments where task_id = (select self_only_task_id from f332)),
  '1|0', 'the Task is left with no active Assignment -- exactly the empty-queue end state');
select is((select format('%s|%s|%s|%s', candidate.status,
                         (candidate.decided_at is null)::text, (candidate.decided_by is null)::text,
                         (candidate.assignment_id is null)::text)
             from public.task_candidates as candidate
            where candidate.task_id = (select self_only_task_id from f332)
              and candidate.member_id = '33200000-0000-0000-0000-000000000014'),
  'pending|true|true|true',
  'the giver-upper''s self-candidature is untouched -- still pending, still undecided, no Assignment');
select is((select count(*) from public.task_activity
            where task_id = (select self_only_task_id from f332) and kind = 'candidate_selected'), 0::bigint,
  'no candidate_selected row is written -- nobody was promoted');

-- ==================== 7. The command is the only write path ====================

select pg_temp.test_login('33200000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ update public.task_assignments set ended_at = now(), end_reason = 'gave_up'
  where task_id = %s and member_id = '33200000-0000-0000-0000-000000000002' $$,
  (select persona_task_id from f332)),
  '42501', null, 'the Executor cannot end their own Assignment by updating task_assignments directly');
select throws_ok(format($$ update public.task_candidates set status = 'selected'
  where task_id = %s $$, (select queue_task_id from f332)),
  '42501', null, 'the Executor cannot promote a Candidate by updating task_candidates directly');
select throws_ok(format($$ insert into public.task_activity (task_id, kind, actor_id, details)
  values (%s, 'gave_up', '33200000-0000-0000-0000-000000000002', '{}'::jsonb) $$,
  (select persona_task_id from f332)),
  '42501', null, 'the Executor cannot fake a gave_up activity row by inserting directly');
reset role;

-- ==================== 8. Locks held while the command runs ====================
-- Sections 9 and 10 prove that a concurrent express_task_interest BLOCKS;
-- this probe proves WHERE -- the tasks row FOR UPDATE taken before any
-- Assignment or Candidature is read, the Executor's own live profile row held
-- FOR SHARE by private.require_task_executor, that same helper's FOR UPDATE on
-- the active Assignment, and the promotion's FOR UPDATE on the Candidature it
-- is about to select. Honest limitation, verified by mutation rather than
-- assumed: the tasks-row and promotion-order probes below DO discriminate
-- (removing the tasks FOR UPDATE fails the first assertion here; reversing the
-- promotion's ORDER BY fails eight assertions in section 2), but the
-- candidate-row assertion does NOT -- deleting `for update` from the
-- promotion's SELECT leaves the whole suite green, because the UPDATE that
-- promotes the row takes an equivalent lock a moment later inside the same
-- held transaction. That token is defense in depth, kept because the tasks
-- lock is what actually serializes the promotion and a future edit that moves
-- the SELECT away from its UPDATE would need it; the assertion documents the
-- lock, it does not prove the keyword.
--
-- Sections 8-10 work on COMMITTED fixtures, created and removed through their
-- own dblink connection: pg_temp.test_race commits both of its sessions for
-- real, so nothing this suite's own rolled-back transaction created would be
-- visible to them.
select extensions.dblink_connect('gut_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
-- #621: committed fixtures from an interrupted run must not hang cleanup.
select extensions.dblink_exec('gut_setup', 'set lock_timeout = ''2s''');

select extensions.dblink_exec('gut_setup', $$
  set session_replication_role = 'replica';
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#332 committed%');
  set session_replication_role = 'origin';
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#332 committed%')
      or member_id in ('33200000-0000-0000-0000-000000000021',
                       '33200000-0000-0000-0000-000000000022',
                       '33200000-0000-0000-0000-000000000023',
                       '33200000-0000-0000-0000-000000000024',
                       '33200000-0000-0000-0000-000000000025',
                       '33200000-0000-0000-0000-000000000026',
                       '33200000-0000-0000-0000-000000000027',
                       '33200000-0000-0000-0000-000000000028')
      or link in (select '/tracker/' || id::text from public.tasks
                   where title like '%#332 committed%');
  delete from public.task_candidates
   where task_id in (select id from public.tasks where title like '%#332 committed%');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%#332 committed%');
  delete from public.tasks where title like '%#332 committed%';
  delete from public.member_departments where member_id in (
    '33200000-0000-0000-0000-000000000021', '33200000-0000-0000-0000-000000000022',
    '33200000-0000-0000-0000-000000000023', '33200000-0000-0000-0000-000000000024',
    '33200000-0000-0000-0000-000000000025', '33200000-0000-0000-0000-000000000026',
    '33200000-0000-0000-0000-000000000027', '33200000-0000-0000-0000-000000000028');
  delete from auth.users where id in (
    '33200000-0000-0000-0000-000000000021', '33200000-0000-0000-0000-000000000022',
    '33200000-0000-0000-0000-000000000023', '33200000-0000-0000-0000-000000000024',
    '33200000-0000-0000-0000-000000000025', '33200000-0000-0000-0000-000000000026',
    '33200000-0000-0000-0000-000000000027', '33200000-0000-0000-0000-000000000028');

  insert into auth.users (id, email) values
    ('33200000-0000-0000-0000-000000000021', 'race.manager.332@test.local'),
    ('33200000-0000-0000-0000-000000000022', 'race.a.332@test.local'),
    ('33200000-0000-0000-0000-000000000023', 'race.b.332@test.local'),
    ('33200000-0000-0000-0000-000000000024', 'race2.a.332@test.local'),
    ('33200000-0000-0000-0000-000000000025', 'race2.candidate.332@test.local'),
    ('33200000-0000-0000-0000-000000000026', 'race2.b.332@test.local'),
    ('33200000-0000-0000-0000-000000000027', 'probe.executor.332@test.local'),
    ('33200000-0000-0000-0000-000000000028', 'probe.candidate.332@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('33200000-0000-0000-0000-000000000021', 'Race Manager 332', 'race.manager.332@test.local', 'bce', 'activ'),
    ('33200000-0000-0000-0000-000000000022', 'Race A 332', 'race.a.332@test.local', 'voluntar', 'activ'),
    ('33200000-0000-0000-0000-000000000023', 'Race B 332', 'race.b.332@test.local', 'voluntar', 'activ'),
    ('33200000-0000-0000-0000-000000000024', 'Race2 A 332', 'race2.a.332@test.local', 'voluntar', 'activ'),
    ('33200000-0000-0000-0000-000000000025', 'Race2 Candidat 332', 'race2.candidate.332@test.local', 'voluntar', 'activ'),
    ('33200000-0000-0000-0000-000000000026', 'Race2 B 332', 'race2.b.332@test.local', 'voluntar', 'activ'),
    ('33200000-0000-0000-0000-000000000027', 'Probe Executor 332', 'probe.executor.332@test.local', 'voluntar', 'activ'),
    ('33200000-0000-0000-0000-000000000028', 'Probe Candidat 332', 'probe.candidate.332@test.local', 'voluntar', 'activ');
  insert into public.member_departments (member_id, dept_id) values
    ('33200000-0000-0000-0000-000000000021', 'edu'),
    ('33200000-0000-0000-0000-000000000022', 'edu'),
    ('33200000-0000-0000-0000-000000000023', 'edu'),
    ('33200000-0000-0000-0000-000000000024', 'edu'),
    ('33200000-0000-0000-0000-000000000025', 'edu'),
    ('33200000-0000-0000-0000-000000000026', 'edu'),
    ('33200000-0000-0000-0000-000000000027', 'edu'),
    ('33200000-0000-0000-0000-000000000028', 'edu');

  insert into public.tasks
    (title, description, deadline, group_id, audience, assignment_mode, status, queue_opened_at, created_by)
  values
    ('Lock probe #332 committed', 'Sonda', '2027-08-01 09:00:00+00', (select id from public.groups where legacy_dept_id = 'edu'), 'org', 'public', 'todo',
     '2027-01-01 00:00:00+00', '33200000-0000-0000-0000-000000000021'),
    ('Race empty queue #332 committed', 'Cursa coada goala', '2027-08-02 09:00:00+00', (select id from public.groups where legacy_dept_id = 'edu'), 'org', 'public', 'todo',
     '2027-01-01 00:00:00+00', '33200000-0000-0000-0000-000000000021'),
    ('Race promotion #332 committed', 'Cursa promovare', '2027-08-03 09:00:00+00', (select id from public.groups where legacy_dept_id = 'edu'), 'org', 'public', 'todo',
     '2027-01-01 00:00:00+00', '33200000-0000-0000-0000-000000000021');

  insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
  select id, '33200000-0000-0000-0000-000000000027'::uuid, '33200000-0000-0000-0000-000000000021'::uuid, now()
    from public.tasks where title = 'Lock probe #332 committed'
  union all
  select id, '33200000-0000-0000-0000-000000000022'::uuid, '33200000-0000-0000-0000-000000000021'::uuid, now()
    from public.tasks where title = 'Race empty queue #332 committed'
  union all
  select id, '33200000-0000-0000-0000-000000000024'::uuid, '33200000-0000-0000-0000-000000000021'::uuid, now()
    from public.tasks where title = 'Race promotion #332 committed';

  insert into public.task_candidates (task_id, member_id, status, joined_at)
  select id, '33200000-0000-0000-0000-000000000028'::uuid, 'pending', now()
    from public.tasks where title = 'Lock probe #332 committed'
  union all
  select id, '33200000-0000-0000-0000-000000000025'::uuid, 'pending', now()
    from public.tasks where title = 'Race promotion #332 committed';
$$);

-- Resolved as the owner, before any persona logs in (the #328 trap again).
create temp table r332 as
select (select id from public.tasks where title = 'Lock probe #332 committed') as probe_task_id,
       (select id from public.tasks where title = 'Race empty queue #332 committed') as race_empty_task_id,
       (select id from public.tasks where title = 'Race promotion #332 committed') as race_promo_task_id;
grant select on r332 to authenticated;

select extensions.dblink_connect('gut_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('gut_lock', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('gut_lock', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '33200000-0000-0000-0000-000000000027', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'voluntar', 'member_level', 1,
      'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text, true)
$$) as remote_claims(setting text);
select extensions.dblink_exec('gut_lock', 'set local role authenticated');
select * from extensions.dblink('gut_lock', format($$
  select (public.give_up_task(%s, 'Sonda de blocare.')).status::text
$$, (select probe_task_id from r332))) as locked_give_up(status text);

select ok(coalesce((
  select row_lock.modes && array['For Update', 'Update', 'No Key Update']
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_task_id from r332)
), false), 'give_up_task holds the target Task row exclusively locked while it runs -- the serialization point the race depends on');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.profiles') as row_lock
    join public.profiles as profile on profile.ctid = row_lock.locked_row
   where profile.id = '33200000-0000-0000-0000-000000000027'
), false), 'give_up_task holds the Executor''s own live profile row FOR SHARE (private.require_task_executor''s discipline)');
select ok(coalesce((
  select bool_or(row_lock.modes && array['For Update', 'Update', 'No Key Update'])
    from extensions.pgrowlocks('public.task_assignments') as row_lock
    join public.task_assignments as assignment on assignment.ctid = row_lock.locked_row
   where assignment.task_id = (select probe_task_id from r332)
     and assignment.member_id = '33200000-0000-0000-0000-000000000027'
), false), 'the Executor''s own Assignment row is locked FOR UPDATE before it is ended');
select ok(coalesce((
  select bool_or(row_lock.modes && array['For Update', 'Update', 'No Key Update'])
    from extensions.pgrowlocks('public.task_candidates') as row_lock
    join public.task_candidates as candidate on candidate.ctid = row_lock.locked_row
   where candidate.task_id = (select probe_task_id from r332)
     and candidate.member_id = '33200000-0000-0000-0000-000000000028'
), false), 'the Candidature about to be promoted is locked FOR UPDATE too -- defense in depth behind the Task lock');

select extensions.dblink_exec('gut_lock', 'rollback');
select extensions.dblink_disconnect('gut_lock');

-- ==================== 9. Race: give up vs express interest, EMPTY queue ====================
-- The Executor leaves while an outsider claims the Task. pg_temp.test_race
-- always runs the give-up (session A) to completion before
-- express_task_interest (session B) is even sent, so only the give-up-first
-- order is ever actually exercised here -- not both commit orders. The
-- invariant is what is asserted -- exactly one active Assignment, both
-- callers succeeding -- and the via check admits either legitimate mechanism
-- (first_come or queue_promotion) as a matter of correctness, not because
-- both interleavings were run.
select pg_temp.test_login('33200000-0000-0000-0000-000000000022', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table race332empty as
select * from pg_temp.test_race(
  format($$ select (public.give_up_task(%s, 'Renunt in cursa.')).id::text $$,
    (select race_empty_task_id from r332)),
  format($$ with claims as (select set_config('request.jwt.claims', %L, true))
            select (public.express_task_interest(%s)).id::text from claims $$,
    jsonb_build_object(
      'sub', '33200000-0000-0000-0000-000000000023', 'role', 'authenticated',
      'app_metadata', jsonb_build_object('member_role', 'voluntar', 'member_level', 1,
        'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text,
    (select race_empty_task_id from r332)));
reset role;

select ok((select b_waited from race332empty),
  'the interested outsider BLOCKS before the give-up commits -- both commands serialize on the same tasks row FOR UPDATE');
select is((select result_a from race332empty), (select race_empty_task_id::text from r332),
  'the give-up succeeds and returns the Task row');
select is((select result_b from race332empty), (select race_empty_task_id::text from r332),
  'the concurrent express_task_interest also succeeds -- it never sees a raw unique_violation');
select is((select format('%s|%s', count(*), min(assignment.member_id::text))
             from public.task_assignments as assignment
            where assignment.task_id = (select race_empty_task_id from r332)
              and assignment.ended_at is null),
  '1|33200000-0000-0000-0000-000000000023',
  'exactly one active Assignment survives the race, and it belongs to the outsider -- the same end state under either commit order');
select ok((select activity.details ->> 'via' in ('first_come', 'queue_promotion')
             from public.task_activity as activity
            where activity.task_id = (select race_empty_task_id from r332)
              and activity.kind = 'executor_assigned'
              and activity.assignment_id = (select assignment.id from public.task_assignments as assignment
                                             where assignment.task_id = (select race_empty_task_id from r332)
                                               and assignment.ended_at is null)),
  'the surviving Assignment was opened by one of the two legitimate mechanisms -- first_come or queue_promotion, whichever order won');
select is((select count(*) from public.task_candidates
            where task_id = (select race_empty_task_id from r332) and status = 'pending'), 0::bigint,
  'nobody is left waiting in the queue: the one interested Member became the Executor rather than queueing behind nobody');
select is((select count(*) from public.task_activity
            where task_id = (select race_empty_task_id from r332) and kind = 'gave_up'), 1::bigint,
  'the race wrote exactly one gave_up row');

-- ==================== 10. Race: give up vs express interest, NON-EMPTY queue ====================
-- The mutation-sensitive one. The give-up promotes its Candidate while an
-- outsider expresses interest. Because the promotion happens under the tasks
-- row FOR UPDATE, the outsider blocks, wakes into a Task that already has its
-- new Executor, and queues.
--
-- Honest limitation, found by mutation rather than assumed (see
-- task-7-report.md Sec5 M2): removing that FOR UPDATE from
-- give_up_task_impl does NOT break this section loudly. Every write the
-- promotion makes under open_task_assignment -- the new task_assignments
-- row, its executor_assigned task_activity row, and the candidate_selected
-- row -- carries a task_id foreign key, so the giving-up session still takes
-- a FOR KEY SHARE lock on the Task row regardless of the explicit keyword,
-- and the outsider's own FOR UPDATE conflicts with that KEY SHARE just the
-- same. The outsider still blocks, still wakes into the post-promotion
-- state, and this section stays green under that mutation; only section 8's
-- pgrowlocks probe on the tasks row actually fails. KEY SHARE does not
-- conflict with KEY SHARE, so two commands BOTH missing the explicit FOR
-- UPDATE would not serialize against each other at all -- the explicit lock
-- is what makes this serialization intentional rather than an incidental
-- side effect of the FK.
select pg_temp.test_login('33200000-0000-0000-0000-000000000024', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table race332promo as
select * from pg_temp.test_race(
  format($$ select (public.give_up_task(%s, 'Renunt si promovez.')).id::text $$,
    (select race_promo_task_id from r332)),
  format($$ with claims as (select set_config('request.jwt.claims', %L, true))
            select (public.express_task_interest(%s)).id::text from claims $$,
    jsonb_build_object(
      'sub', '33200000-0000-0000-0000-000000000026', 'role', 'authenticated',
      'app_metadata', jsonb_build_object('member_role', 'voluntar', 'member_level', 1,
        'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text,
    (select race_promo_task_id from r332)));
reset role;

select ok((select b_waited from race332promo),
  'the interested outsider BLOCKS while the promotion runs -- the give-up and its promotion are one atomic step');
select is((select result_a from race332promo), (select race_promo_task_id::text from r332),
  'the give-up with a promotion succeeds and returns the Task row');
select is((select result_b from race332promo), (select race_promo_task_id::text from r332),
  'the concurrent express_task_interest succeeds too -- it queues behind the promoted Executor instead of racing them for the slot');
select is((select format('%s|%s', count(*), min(assignment.member_id::text))
             from public.task_assignments as assignment
            where assignment.task_id = (select race_promo_task_id from r332)
              and assignment.ended_at is null),
  '1|33200000-0000-0000-0000-000000000025',
  'exactly one active Assignment survives, held by the promoted Candidate -- the queue outranks a latecomer');
select is((select format('%s|%s', count(*), min(candidate.member_id::text))
             from public.task_candidates as candidate
            where candidate.task_id = (select race_promo_task_id from r332)
              and candidate.status = 'pending'),
  '1|33200000-0000-0000-0000-000000000026',
  'the latecomer is the one pending Candidate, queued behind the Member the promotion chose');
select is((select format('%s|%s', candidate.status,
                         (candidate.assignment_id = (select assignment.id from public.task_assignments as assignment
                                                      where assignment.task_id = candidate.task_id
                                                        and assignment.ended_at is null))::text)
             from public.task_candidates as candidate
            where candidate.task_id = (select race_promo_task_id from r332)
              and candidate.member_id = '33200000-0000-0000-0000-000000000025'),
  'selected|true',
  'the promoted Candidature is selected and points at the surviving Assignment -- the promotion committed as one unit with the give-up');

-- ---- clean up everything the committed sessions left behind ----
-- task_activity is append-only by trigger, including for its owner, so the
-- cleanup runs its deletes under session_replication_role = 'replica', which
-- suppresses the ENABLE ORIGIN trigger for that session only.
select extensions.dblink_exec('gut_setup', $$
  set session_replication_role = 'replica';
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#332 committed%');
  set session_replication_role = 'origin';
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#332 committed%')
      or member_id in ('33200000-0000-0000-0000-000000000021',
                       '33200000-0000-0000-0000-000000000022',
                       '33200000-0000-0000-0000-000000000023',
                       '33200000-0000-0000-0000-000000000024',
                       '33200000-0000-0000-0000-000000000025',
                       '33200000-0000-0000-0000-000000000026',
                       '33200000-0000-0000-0000-000000000027',
                       '33200000-0000-0000-0000-000000000028')
      or link in (select '/tracker/' || id::text from public.tasks
                   where title like '%#332 committed%');
  delete from public.task_candidates
   where task_id in (select id from public.tasks where title like '%#332 committed%');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%#332 committed%');
  delete from public.tasks where title like '%#332 committed%';
  delete from public.member_departments where member_id in (
    '33200000-0000-0000-0000-000000000021', '33200000-0000-0000-0000-000000000022',
    '33200000-0000-0000-0000-000000000023', '33200000-0000-0000-0000-000000000024',
    '33200000-0000-0000-0000-000000000025', '33200000-0000-0000-0000-000000000026',
    '33200000-0000-0000-0000-000000000027', '33200000-0000-0000-0000-000000000028');
  delete from auth.users where id in (
    '33200000-0000-0000-0000-000000000021', '33200000-0000-0000-0000-000000000022',
    '33200000-0000-0000-0000-000000000023', '33200000-0000-0000-0000-000000000024',
    '33200000-0000-0000-0000-000000000025', '33200000-0000-0000-0000-000000000026',
    '33200000-0000-0000-0000-000000000027', '33200000-0000-0000-0000-000000000028');
$$);
select extensions.dblink_disconnect('gut_setup');

select is((select count(*) from public.tasks where title like '%#332 committed%'), 0::bigint,
  'the committed race and lock-probe fixtures are removed again -- this suite leaves no trace');
select is((select count(*) from auth.users
            where id in ('33200000-0000-0000-0000-000000000021',
                         '33200000-0000-0000-0000-000000000022',
                         '33200000-0000-0000-0000-000000000023',
                         '33200000-0000-0000-0000-000000000024',
                         '33200000-0000-0000-0000-000000000025',
                         '33200000-0000-0000-0000-000000000026',
                         '33200000-0000-0000-0000-000000000027',
                         '33200000-0000-0000-0000-000000000028')), 0::bigint,
  'the eight committed race/lock-probe fixture accounts are removed too, not just their Tasks');
-- notifications.task_id is ON DELETE SET NULL, so a leftover row would survive
-- with a nulled task_id and be invisible to a task_id-keyed check; link
-- ('/tracker/<id>') still names the deleted Task and cannot be erased by the
-- cascade, so this is the assertion that would actually catch it.
select is((select count(*) from public.notifications
            where link in (
              select '/tracker/' || task_id::text from (
                select probe_task_id as task_id from r332
                union all select race_empty_task_id from r332
                union all select race_promo_task_id from r332
              ) as committed_task_ids
            )), 0::bigint,
  'no notification survives with a nulled task_id after the committed Tasks are deleted -- checked by link, which ON DELETE SET NULL cannot erase');


-- #521: Group authority regression matrix.
\ir _group_task_fixtures.psql
reset role;
select pg_temp.g521_task('executor0','project',2,'todo','direct');
update public.tasks set created_by=pg_temp.g521_uid(2) where id=(select id from g521_tasks where name='executor0');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($$select public.give_up_task((select id from g521_tasks where name='executor0'),'Leaving #521')$$,'give_up_task: Executor persona 2 remains authorized');
reset role;
reset role;
select pg_temp.g521_task('executor1','project',4,'todo','direct');
update public.tasks set created_by=pg_temp.g521_uid(4) where id=(select id from g521_tasks where name='executor1');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(4));
select lives_ok($$select public.give_up_task((select id from g521_tasks where name='executor1'),'Leaving #521')$$,'give_up_task: Executor persona 4 remains authorized');
reset role;
select results_eq($$select distinct member_id from public.notifications where task_id=(select id from g521_tasks where name='executor1') order by 1$$,$$select pg_temp.g521_uid(2)$$,'Group Manager alone receives fallback work notifications');
reset role;
select pg_temp.g521_task('executor2','ind',7,'todo','direct');
update public.tasks set created_by=pg_temp.g521_uid(7) where id=(select id from g521_tasks where name='executor2');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(7));
select lives_ok($$select public.give_up_task((select id from g521_tasks where name='executor2'),'Leaving #521')$$,'give_up_task: Executor persona 7 remains authorized');
reset role;
select ok(exists(select 1 from public.notifications where task_id=(select id from g521_tasks where name='executor2') and member_id=pg_temp.g521_uid(6)) and exists(select 1 from public.notifications where task_id=(select id from g521_tasks where name='executor2') and member_id=pg_temp.g521_uid(1)),'Manager-less peers and BC receive fallback work notifications');
reset role;
select pg_temp.g521_task('executor3','dt',8,'todo','direct');
update public.tasks set created_by=pg_temp.g521_uid(8) where id=(select id from g521_tasks where name='executor3');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(8));
select lives_ok($$select public.give_up_task((select id from g521_tasks where name='executor3'),'Leaving #521')$$,'give_up_task: Executor persona 8 remains authorized');
reset role;

-- ==================== #673: constraints kit (R8) ====================
-- Step 1 answers before the gate: a claimless caller hears the reason, not 42501.
reset role;
select pg_temp.test_login('67300000-0000-0000-0000-000000000001', '{"provider":"email"}'::jsonb);
select throws_ok($$ select public.give_up_task(0, repeat('r', 1001)) $$,
  'PT400', 'reason_too_long', 'a give-up reason over 1000 characters is refused before the gate');
reset role;

select * from finish();
rollback;
