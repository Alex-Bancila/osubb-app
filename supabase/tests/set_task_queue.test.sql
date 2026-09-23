-- #331: public.set_task_queue -- a manager opens or closes a public Task's
-- Candidate Queue.
--
-- The interlock this suite exists to prove (the acceptance criterion #331
-- names): set_task_queue and #330's express_task_interest compose. Closing
-- the queue must make every later express_task_interest call answer PT409
-- task_queue_closed; reopening must let it succeed again -- and the
-- Candidates private.close_task_queue already moved to 'closed' must NOT be
-- resurrected by the reopen, so a Member who wants back in has to express
-- interest again and lands in a brand new pending row.
--
-- Closing also uses the Task 1 kit rather than reimplementing it:
-- private.close_task_queue(p_task_id, p_decided_by) sets queue_closed_at,
-- moves every pending Candidature to 'closed' with decided_at/decided_by set,
-- and returns the array of member ids it closed -- exactly the recipient set
-- for the "Coadă închisă" notification. It is a no-op on a direct Task or an
-- already-closed queue (returns '{}'), which is why set_task_queue itself
-- still needs its own not-public/terminal/same-state guards in front of it:
-- a manager must not be able to "re-close" a closed queue just to re-send
-- that notification.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(55);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('33100000-0000-0000-0000-000000000001', 'manager.331@test.local'),
  ('33100000-0000-0000-0000-000000000002', 'candidate1.331@test.local'),
  ('33100000-0000-0000-0000-000000000003', 'candidate2.331@test.local'),
  ('33100000-0000-0000-0000-000000000004', 'roundtrip.331@test.local'),
  ('33100000-0000-0000-0000-000000000005', 'executor.331@test.local'),
  ('33100000-0000-0000-0000-000000000006', 'ordinary.331@test.local'),
  ('33100000-0000-0000-0000-000000000007', 'gatecandidate.331@test.local'),
  ('33100000-0000-0000-0000-000000000008', 'inactive.bc.331@test.local'),
  ('33100000-0000-0000-0000-000000000009', 'claimless.331@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('33100000-0000-0000-0000-000000000001', 'Manager 331', 'manager.331@test.local', 'bce', 'activ'),
  ('33100000-0000-0000-0000-000000000002', 'Candidat Unu 331', 'candidate1.331@test.local', 'voluntar', 'activ'),
  ('33100000-0000-0000-0000-000000000003', 'Candidat Doi 331', 'candidate2.331@test.local', 'voluntar', 'activ'),
  ('33100000-0000-0000-0000-000000000004', 'Roundtrip 331', 'roundtrip.331@test.local', 'voluntar', 'activ'),
  ('33100000-0000-0000-0000-000000000005', 'Executor 331', 'executor.331@test.local', 'voluntar', 'activ'),
  ('33100000-0000-0000-0000-000000000006', 'Membru Obisnuit 331', 'ordinary.331@test.local', 'voluntar', 'activ'),
  ('33100000-0000-0000-0000-000000000007', 'Candidat Poarta 331', 'gatecandidate.331@test.local', 'voluntar', 'activ'),
  ('33100000-0000-0000-0000-000000000008', 'BC Inactiv 331', 'inactive.bc.331@test.local', 'bc', 'inactiv'),
  ('33100000-0000-0000-0000-000000000009', 'Fara Claimuri 331', 'claimless.331@test.local', 'voluntar', 'activ');

insert into public.member_departments (member_id, dept_id) values
  ('33100000-0000-0000-0000-000000000001', 'edu'),
  ('33100000-0000-0000-0000-000000000002', 'edu'),
  ('33100000-0000-0000-0000-000000000003', 'edu'),
  ('33100000-0000-0000-0000-000000000004', 'edu'),
  ('33100000-0000-0000-0000-000000000005', 'edu'),
  ('33100000-0000-0000-0000-000000000006', 'edu'),
  ('33100000-0000-0000-0000-000000000007', 'edu');
-- #586: materialize this suite's legacy setup as rolled-back Group fixtures.
select pg_temp.materialize_legacy_groups();


-- Two pending Candidates on an open queue: the plain close scenario.
-- queue_opened_at is now(), not a fictional future date: private.close_task_
-- queue stamps queue_closed_at with real now() too, and tasks_queue_
-- timestamp_state_check requires queue_closed_at >= queue_opened_at. Every
-- now() call inside one transaction (this whole suite is one) returns the
-- same transaction-start value, so a queue "opened" at now() is never later
-- closed at an earlier instant.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, queue_opened_at, created_by)
values
  ('Close two pending #331', 'Doi candidati', '2027-03-01 09:00:00+00', pg_temp.dept_group('edu'), 'org', 'public', 'todo',
   now(), '33100000-0000-0000-0000-000000000001'),
  ('Roundtrip #331', 'Compunere cu #330', '2027-03-02 09:00:00+00', pg_temp.dept_group('edu'), 'org', 'public', 'todo',
   now(), '33100000-0000-0000-0000-000000000001'),
  ('Already open #331', 'Deja deschisa', '2027-03-04 09:00:00+00', pg_temp.dept_group('edu'), 'org', 'public', 'todo',
   now(), '33100000-0000-0000-0000-000000000001'),
  ('Already closed #331', 'Deja inchisa', '2027-03-05 09:00:00+00', pg_temp.dept_group('edu'), 'org', 'public', 'todo',
   now(), '33100000-0000-0000-0000-000000000001'),
  ('Gate #331', 'Poarta', '2027-03-06 09:00:00+00', pg_temp.dept_group('edu'), 'org', 'public', 'todo',
   now(), '33100000-0000-0000-0000-000000000001');

-- Direct-mode Task: no queue timestamps at all (tasks_queue_timestamp_state_ck).
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, created_by)
values
  ('Direct #331', 'Fara coada', '2027-03-03 09:00:00+00', pg_temp.dept_group('edu'), 'local', 'direct', 'todo',
   '33100000-0000-0000-0000-000000000001');

update public.tasks set queue_closed_at = '2027-01-02 00:00:00+00'
 where title = 'Already closed #331';

-- Terminal public Task: a completed public Task always has its queue closed
-- (tasks_queue_timestamp_state_ck) and both evaluation inputs set
-- (tasks_evaluation_inputs_ck).
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, difficulty, rating,
   status, queue_opened_at, queue_closed_at, completed_at, created_by)
values
  ('Terminal #331', 'Incheiat', '2027-03-07 09:00:00+00', pg_temp.dept_group('edu'), 'local', 'public', 3, 4,
   'completed', '2027-01-01 00:00:00+00', '2027-01-02 00:00:00+00', now(),
   '33100000-0000-0000-0000-000000000001');

-- Directly fixtured (never through the command): two pending Candidates on
-- the "Close two pending" Task, and one pending Candidature for the
-- Roundtrip Member so that, once its queue closes, they retain read access
-- to the Task through R2 (own Candidature, any status) rather than needing
-- R6's now-unmet "open queue" branch.
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33100000-0000-0000-0000-000000000002', 'pending', now() - interval '2 hours'
  from public.tasks where title = 'Close two pending #331';
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33100000-0000-0000-0000-000000000003', 'pending', now() - interval '1 hour'
  from public.tasks where title = 'Close two pending #331';
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33100000-0000-0000-0000-000000000004', 'pending', now()
  from public.tasks where title = 'Roundtrip #331';
-- A pending Candidature on the Gate Task, purely so persona 007 can read it
-- (R2) while never being its manager -- the second denied persona.
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33100000-0000-0000-0000-000000000007', 'pending', now()
  from public.tasks where title = 'Gate #331';

-- The Roundtrip Task already has an active Executor (fixtured directly, not
-- through the command), so re-expressing interest after the queue reopens
-- joins the Candidate Queue instead of taking the Task by first-come.
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33100000-0000-0000-0000-000000000005', '33100000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Roundtrip #331';

-- Every fixture id resolved ONCE, as the owner. Never resolve an id inside a
-- format() while a denied persona is logged in (the #328 trap,
-- stack-context.md carry-forwards).
create temp table f331 as
select
  9223372036854775807::bigint as missing_id,
  (select id from public.tasks where title = 'Close two pending #331') as close_two_task_id,
  (select id from public.tasks where title = 'Roundtrip #331') as roundtrip_task_id,
  (select id from public.tasks where title = 'Direct #331') as direct_task_id,
  (select id from public.tasks where title = 'Already open #331') as already_open_task_id,
  (select id from public.tasks where title = 'Already closed #331') as already_closed_task_id,
  (select id from public.tasks where title = 'Terminal #331') as terminal_task_id,
  (select id from public.tasks where title = 'Gate #331') as gate_task_id;
grant select on f331 to authenticated, anon;

-- ==================== 1. API shape and privileges ====================

select has_function('public', 'set_task_queue', array['bigint', 'boolean'],
  'public.set_task_queue exists with the pinned two-parameter signature');
select is(pg_get_function_identity_arguments(
    'public.set_task_queue(bigint, boolean)'::regprocedure),
  'p_task_id bigint, p_open boolean',
  'set_task_queue exposes no actor parameter -- the actor is always auth.uid()');
select is(pg_get_function_result(
    'public.set_task_queue(bigint, boolean)'::regprocedure),
  'tasks', 'set_task_queue returns the affected Task row');
select ok(not (select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public' and procedure.proname = 'set_task_queue'),
  'the public command is a security invoker wrapper');
select ok((select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private' and procedure.proname = 'set_task_queue_impl'),
  'private.set_task_queue_impl runs as owner (security definer)');
select ok(coalesce((
    select bool_and('search_path=""' = any(procedure.proconfig))
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private' and procedure.proname = 'set_task_queue_impl'
  ), false), 'set_task_queue_impl pins an empty search_path');
select ok(has_function_privilege('authenticated',
  'public.set_task_queue(bigint, boolean)'::regprocedure, 'execute'),
  'authenticated can execute public.set_task_queue');
select ok(not has_function_privilege('anon',
  'public.set_task_queue(bigint, boolean)'::regprocedure, 'execute'),
  'anon cannot execute public.set_task_queue');
select ok(has_function_privilege('authenticated',
  'private.set_task_queue_impl(bigint, boolean)'::regprocedure, 'execute'),
  'authenticated can execute private.set_task_queue_impl');

-- ==================== 2. Closing with two pending Candidates ====================

select pg_temp.test_login('33100000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.set_task_queue(%s, false) $$,
  (select close_two_task_id from f331)),
  'the manager closes a public Task''s queue with two pending Candidates');
reset role;

select is((select format('%s|%s', count(*), count(*) filter (where status = 'closed'
    and decided_by = '33100000-0000-0000-0000-000000000001' and decided_at is not null))
    from public.task_candidates
   where task_id = (select close_two_task_id from f331)),
  '2|2', 'both pending Candidatures are closed, decided by the manager, with decided_at set');
select is((select format('%s|%s|%s|%s', activity.kind, activity.actor_id,
                         (activity.assignment_id is null)::text, activity.details ->> 'closed_candidates')
             from public.task_activity as activity
            where activity.task_id = (select close_two_task_id from f331)),
  'queue_closed|33100000-0000-0000-0000-000000000001|true|2',
  'one queue_closed activity row is written, assignment_id null, details.closed_candidates = 2');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s $$, (select close_two_task_id from f331)),
  $$ values ('33100000-0000-0000-0000-000000000002'::uuid),
            ('33100000-0000-0000-0000-000000000003'::uuid) $$,
  'exactly the two closed Candidates are notified -- the manager, as actor, is not');
select is((select format('%s|%s', notification.title, notification.body)
             from public.notifications as notification
            where notification.task_id = (select close_two_task_id from f331)
              and notification.member_id = '33100000-0000-0000-0000-000000000002'),
  'Coadă închisă: Close two pending #331|Nu mai poți fi selectat pentru acest task.',
  'the closed-Candidate notification uses the pinned Romanian copy');
select is((select queue_closed_at is not null from public.tasks
            where id = (select close_two_task_id from f331)), true,
  'the Task''s queue_closed_at is set');

-- ==================== 3. The interlock with #330 (the acceptance criterion) ====================

select pg_temp.test_login('33100000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.set_task_queue(%s, false) $$,
  (select roundtrip_task_id from f331)),
  'the manager closes the Roundtrip Task''s queue, which has one pre-existing pending Candidate');
reset role;

select is((select format('%s|%s', status, decided_by) from public.task_candidates
            where task_id = (select roundtrip_task_id from f331)
              and member_id = '33100000-0000-0000-0000-000000000004'),
  'closed|33100000-0000-0000-0000-000000000001',
  'the Roundtrip Member''s pending Candidature is moved to closed, decided by the manager');
select is((select details ->> 'closed_candidates' from public.task_activity
            where task_id = (select roundtrip_task_id from f331) and kind = 'queue_closed'),
  '1', 'the queue_closed activity row on the Roundtrip Task counts exactly the one Candidate it closed');

select pg_temp.test_login('33100000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.express_task_interest(%s) $$,
  (select roundtrip_task_id from f331)), 'PT409', 'task_queue_closed',
  'once the queue is closed, express_task_interest on the same Task is rejected -- the #330/#331 interlock, half one');
reset role;

select pg_temp.test_login('33100000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.set_task_queue(%s, true) $$,
  (select roundtrip_task_id from f331)),
  'the manager reopens the Roundtrip Task''s queue');
reset role;

select is((select queue_closed_at from public.tasks
            where id = (select roundtrip_task_id from f331)), null::timestamptz,
  'reopening clears queue_closed_at');
select is((select format('%s|%s|%s', activity.kind, activity.actor_id,
                         (activity.assignment_id is null)::text)
             from public.task_activity as activity
            where activity.task_id = (select roundtrip_task_id from f331)
              and activity.kind = 'queue_opened'),
  'queue_opened|33100000-0000-0000-0000-000000000001|true',
  'reopening writes one queue_opened activity row, assignment_id null');
select is((select status from public.task_candidates
            where task_id = (select roundtrip_task_id from f331)
              and member_id = '33100000-0000-0000-0000-000000000004'),
  'closed',
  'reopening does NOT resurrect the previously closed Candidature -- it stays closed (only one row exists for this Member so far)');

select pg_temp.test_login('33100000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.express_task_interest(%s) $$,
  (select roundtrip_task_id from f331)),
  'once reopened, express_task_interest succeeds again -- the #330/#331 interlock, half two');
reset role;

select is((select format('%s|%s', count(*), count(*) filter (where status = 'pending'))
             from public.task_candidates
            where task_id = (select roundtrip_task_id from f331)
              and member_id = '33100000-0000-0000-0000-000000000004'),
  '2|1',
  'the Member has two Candidature rows now -- the old closed one, untouched, plus a brand new pending one; rejoining is never a resurrection');

-- ==================== 4. State preconditions ====================

-- p_open null is malformed for every caller, checked before the gate --
-- fires even against an id no profile could ever read.
select pg_temp.test_login('33100000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.set_task_queue(%s, null) $$,
  (select missing_id from f331)), 'PT400', 'invalid_queue_flag',
  'a null p_open is rejected before the gate, even against an unknown Task id');
reset role;

select pg_temp.test_login('33100000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.set_task_queue(%s, false) $$,
  (select direct_task_id from f331)), 'PT409', 'task_not_public',
  'a direct-mode Task has no queue to close');
select throws_ok(format($$ select public.set_task_queue(%s, true) $$,
  (select terminal_task_id from f331)), 'PT409', 'task_terminal',
  'a terminal Task''s queue cannot be reopened, even though it is currently closed');
select throws_ok(
  format($$ select public.set_task_queue(%s, false) $$, (select terminal_task_id from f331)),
  'PT409', 'task_terminal',
  'closing an already-terminal Task answers task_terminal, not nothing_to_update -- the check order is load-bearing');
select throws_ok(format($$ select public.set_task_queue(%s, true) $$,
  (select already_open_task_id from f331)), 'PT409', 'nothing_to_update',
  'opening a queue that is already open is rejected -- a manager cannot re-notify by no-op');
select throws_ok(format($$ select public.set_task_queue(%s, false) $$,
  (select already_closed_task_id from f331)), 'PT409', 'nothing_to_update',
  're-closing an already-closed queue is rejected the same way');
select throws_ok(format($$ select public.set_task_queue(%s, false) $$,
  (select missing_id from f331)), 'PT404', 'task_not_found',
  'an unknown Task is not found, not forbidden');
reset role;

select is((select count(*) from public.task_activity
            where task_id in (select direct_task_id from f331)
               or task_id in (select terminal_task_id from f331)
               or task_id in (select already_open_task_id from f331)
               or task_id in (select already_closed_task_id from f331)), 0::bigint,
  'none of the four rejected state-precondition calls wrote an activity row');
select is((select count(*) from public.notifications
            where task_id in (select direct_task_id from f331)
               or task_id in (select terminal_task_id from f331)
               or task_id in (select already_open_task_id from f331)
               or task_id in (select already_closed_task_id from f331)), 0::bigint,
  'no rejected state-precondition call wrote a notification');

-- ==================== 5. Persona denials ====================

select pg_temp.test_login('33100000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.set_task_queue(%s, false) $$,
  (select gate_task_id from f331)), '42501', 'task_manage_forbidden',
  'an ordinary Member who can merely read the open Opportunity (R6) is not its manager');
reset role;

select pg_temp.test_login('33100000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.set_task_queue(%s, false) $$,
  (select gate_task_id from f331)), '42501', 'task_manage_forbidden',
  'a pending Candidate on the Task is not its manager either -- being queued grants no authority over the queue');
reset role;

select pg_temp.test_login('33100000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.set_task_queue(%s, false) $$,
  (select gate_task_id from f331)), '42501', 'task_command_forbidden',
  'a deactivated BC holding a still-valid level-6 token cannot even reach the gate');
reset role;

select pg_temp.test_login('33100000-0000-0000-0000-000000000009',
  jsonb_build_object('provider', 'email'));
select throws_ok(format($$ select public.set_task_queue(%s, false) $$,
  (select gate_task_id from f331)), '42501', 'task_command_forbidden',
  'a real uid without organisation claims cannot set the queue flag');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(format($$ select public.set_task_queue(%s, false) $$,
  (select gate_task_id from f331)),
  '42501', 'permission denied for function set_task_queue',
  'anon cannot execute set_task_queue at all -- the literal grant denial, not a gate that happens to raise 42501');
reset role;

select is((select count(*) from public.task_activity
            where task_id = (select gate_task_id from f331)), 0::bigint,
  'none of the five denied personas wrote an activity row on the Gate Task');
select is((select count(*) from public.notifications
            where task_id = (select gate_task_id from f331)), 0::bigint,
  'none of the five denied personas wrote a notification');
select is((select queue_closed_at from public.tasks
            where id = (select gate_task_id from f331)), null::timestamptz,
  'the Gate Task''s queue is still open -- none of the five denied calls touched it');
select is((select status from public.task_candidates
            where task_id = (select gate_task_id from f331)
              and member_id = '33100000-0000-0000-0000-000000000007'),
  'pending', 'the Gate Task''s pending Candidature is untouched by any denied call');

-- ==================== 6. The command is the only write path ====================

select pg_temp.test_login('33100000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ update public.task_candidates set status = 'closed', decided_at = now(),
  decided_by = '33100000-0000-0000-0000-000000000001' where task_id = %s and status = 'pending' $$,
  (select gate_task_id from f331)),
  '42501', null, 'even the Task''s own manager cannot close a Candidature by updating task_candidates directly');
select throws_ok(format($$ insert into public.task_activity (task_id, kind, actor_id, details)
  values (%s, 'queue_closed', '33100000-0000-0000-0000-000000000001', '{}'::jsonb) $$,
  (select gate_task_id from f331)),
  '42501', null, 'even the Task''s own manager cannot write a queue_closed activity row by inserting directly');
reset role;

-- ==================== 7. Locks held while the command runs ====================
-- Mirrors task_interest.test.sql's section 8: the tasks row FOR UPDATE, taken
-- before any queue/candidate state is read, and the manager's own live
-- profile row plus their Origin membership row held FOR SHARE (the #343/#390
-- discipline behind private.require_origin_manager). Runs on COMMITTED
-- fixtures over its own dblink connection, cleaned up before the suite ends.
select extensions.dblink_connect('stq_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));

select extensions.dblink_exec('stq_setup', $$
  insert into auth.users (id, email) values
    ('33100000-0000-0000-0000-000000000021', 'lock.manager.331@test.local'),
    ('33100000-0000-0000-0000-000000000022', 'lock.candidate.331@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('33100000-0000-0000-0000-000000000021', 'Lock Manager 331', 'lock.manager.331@test.local', 'bce', 'activ'),
    ('33100000-0000-0000-0000-000000000022', 'Lock Candidate 331', 'lock.candidate.331@test.local', 'voluntar', 'activ');
  insert into public.member_departments (member_id, dept_id) values
    ('33100000-0000-0000-0000-000000000021', 'edu'),
    ('33100000-0000-0000-0000-000000000022', 'edu');
  -- #586: committed race fixtures need an explicit native Group roster.
  insert into public.group_members(group_id,member_id,group_role)
  select g.id,md.member_id,case when p.role='bce' then 'manager' else 'member' end
    from public.member_departments md join public.groups g on g.legacy_dept_id=md.dept_id
    join public.profiles p on p.id=md.member_id
   where md.member_id::text like '33100000-%'
  on conflict (group_id,member_id) do nothing;
  insert into public.tasks
    (title, description, deadline, group_id, audience, assignment_mode, status, queue_opened_at, created_by)
  values
    ('Lock probe #331 committed', 'Sonda', '2027-04-01 09:00:00+00', (select id from public.groups where legacy_dept_id = 'edu'), 'org', 'public', 'todo',
     now(), '33100000-0000-0000-0000-000000000021');
  insert into public.task_candidates (task_id, member_id, status, joined_at)
  select id, '33100000-0000-0000-0000-000000000022', 'pending', now()
    from public.tasks where title = 'Lock probe #331 committed';
$$);

create temp table r331 as
select (select id from public.tasks where title = 'Lock probe #331 committed') as probe_task_id;
grant select on r331 to authenticated;

select extensions.dblink_connect('stq_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('stq_lock', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('stq_lock', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '33100000-0000-0000-0000-000000000021', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'bce', 'member_level', 5,
      'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text, true)
$$) as remote_claims(setting text);
select extensions.dblink_exec('stq_lock', 'set local role authenticated');
select * from extensions.dblink('stq_lock', format($$
  select (public.set_task_queue(%s, false)).status::text
$$, (select probe_task_id from r331))) as locked_close(status text);

select ok(coalesce((
  select row_lock.modes && array['For Update', 'Update', 'No Key Update']
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_task_id from r331)
), false), 'set_task_queue holds the target Task row exclusively locked while it runs');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.profiles') as row_lock
    join public.profiles as profile on profile.ctid = row_lock.locked_row
   where profile.id = '33100000-0000-0000-0000-000000000021'
), false), 'set_task_queue holds the manager''s own live profile row FOR SHARE');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.group_members') as row_lock
    join public.group_members as membership on membership.ctid = row_lock.locked_row
    join public.groups as authority_group on authority_group.id = membership.group_id
   where membership.member_id = '33100000-0000-0000-0000-000000000021'
     and authority_group.legacy_dept_id = 'edu'
), false), 'set_task_queue holds the manager''s Group roster row FOR SHARE too (require_group_work_manager''s discipline)');

select extensions.dblink_exec('stq_lock', 'rollback');
select extensions.dblink_disconnect('stq_lock');

-- ---- cleanup: this suite leaves no committed trace ----
select extensions.dblink_exec('stq_setup', $$
  set session_replication_role = 'replica';
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#331 committed%');
  set session_replication_role = 'origin';
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#331 committed%')
      or member_id in ('33100000-0000-0000-0000-000000000021', '33100000-0000-0000-0000-000000000022')
      or link in (select '/tracker/' || id::text from public.tasks
                   where title like '%#331 committed%');
  delete from public.task_candidates
   where task_id in (select id from public.tasks where title like '%#331 committed%');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%#331 committed%');
  delete from public.tasks where title like '%#331 committed%';
  delete from public.member_departments where member_id in (
    '33100000-0000-0000-0000-000000000021', '33100000-0000-0000-0000-000000000022');
  delete from auth.users where id in (
    '33100000-0000-0000-0000-000000000021', '33100000-0000-0000-0000-000000000022');
$$);
select extensions.dblink_disconnect('stq_setup');

select is((select count(*) from public.tasks where title like '%#331 committed%'), 0::bigint,
  'the committed lock-probe fixtures are removed again -- this suite leaves no trace');
select is((select count(*) from auth.users
            where id in ('33100000-0000-0000-0000-000000000021',
                         '33100000-0000-0000-0000-000000000022')), 0::bigint,
  'the two committed lock-probe fixture accounts are removed too, not just their Task');
select is((select count(*) from public.notifications
            where link = format('/tracker/%s', (select probe_task_id from r331))), 0::bigint,
  'no notification survives with a nulled task_id after the committed Task is deleted');


-- #521: Group authority regression matrix.
\ir _group_task_fixtures.psql
reset role;
select pg_temp.g521_task('command0','project',5,'todo','public');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($$select public.set_task_queue((select id from g521_tasks where name='command0'),false)$$,'set_task_queue: Group persona 2 on executor 5 in project');
reset role;
select pg_temp.g521_task('command1','project',4,'todo','public');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select throws_ok($$select public.set_task_queue((select id from g521_tasks where name='command1'),false)$$,'42501','task_manage_forbidden','set_task_queue: Group persona 3 on executor 4 in project');
reset role;
select pg_temp.g521_task('command2','ind',7,'todo','public');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(6));
select lives_ok($$select public.set_task_queue((select id from g521_tasks where name='command2'),false)$$,'set_task_queue: Group persona 6 on executor 7 in ind');
reset role;
select pg_temp.g521_task('command3','dt',5,'todo','public');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(8));
select throws_ok($$select public.set_task_queue((select id from g521_tasks where name='command3'),false)$$,'42501','task_manage_forbidden','set_task_queue: Group persona 8 on executor 5 in dt');
reset role;

select * from finish();
rollback;
