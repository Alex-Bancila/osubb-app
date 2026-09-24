-- #330: public.express_task_interest / public.withdraw_task_interest -- the
-- only way a Member joins or leaves a public Task's Candidate Queue.
--
-- The safety property this suite exists for (#682, ruling R9): expressing
-- interest ALWAYS queues -- nobody becomes the Executor by arriving first, and
-- no Assignment is ever opened by this command; the Task Manager selects with
-- select_task_candidate. Two sessions expressing interest at the same instant
-- must serialize on the tasks row lock and both end as pending Candidates in
-- arrival order. Section 9's pg_temp.test_race asserts exactly that,
-- b_waited included.
--
-- Queue order is derived, never stored: task_candidates has no position
-- column, order is (joined_at, id), and private.queue_position answers it.
-- Withdrawing pending #1 promotes #2 to #1 for free; rejoining after a
-- withdrawal is a NEW pending row at the end of the order (the partial
-- unique index is `where status = 'pending'`, which permits exactly that).
--
-- The manager-facing queue notification is coalesced: one row per manager
-- under dedupe_key 'task:<id>:queue', its body rewritten to the live pending
-- count on every join and every withdrawal.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(104);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('33000000-0000-0000-0000-000000000001', 'manager.330@test.local'),
  ('33000000-0000-0000-0000-000000000002', 'first.330@test.local'),
  ('33000000-0000-0000-0000-000000000003', 'second.330@test.local'),
  ('33000000-0000-0000-0000-000000000004', 'third.330@test.local'),
  ('33000000-0000-0000-0000-000000000005', 'outsider.330@test.local'),
  ('33000000-0000-0000-0000-000000000006', 'other.bce.330@test.local'),
  ('33000000-0000-0000-0000-000000000007', 'inactive.bc.330@test.local'),
  ('33000000-0000-0000-0000-000000000008', 'claimless.330@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('33000000-0000-0000-0000-000000000001', 'Manager 330', 'manager.330@test.local', 'bce', 'activ'),
  ('33000000-0000-0000-0000-000000000002', 'Primul 330', 'first.330@test.local', 'voluntar', 'activ'),
  ('33000000-0000-0000-0000-000000000003', 'Al Doilea 330', 'second.330@test.local', 'voluntar', 'activ'),
  ('33000000-0000-0000-0000-000000000004', 'Al Treilea 330', 'third.330@test.local', 'voluntar', 'activ'),
  ('33000000-0000-0000-0000-000000000005', 'Din Afara 330', 'outsider.330@test.local', 'voluntar', 'activ'),
  ('33000000-0000-0000-0000-000000000006', 'BCE Alt Dept 330', 'other.bce.330@test.local', 'bce', 'activ'),
  ('33000000-0000-0000-0000-000000000007', 'BC Inactiv 330', 'inactive.bc.330@test.local', 'bc', 'inactiv'),
  ('33000000-0000-0000-0000-000000000008', 'Fara Claimuri 330', 'claimless.330@test.local', 'voluntar', 'activ');

insert into public.member_departments (member_id, dept_id) values
  ('33000000-0000-0000-0000-000000000001', 'edu'),
  ('33000000-0000-0000-0000-000000000002', 'edu'),
  ('33000000-0000-0000-0000-000000000003', 'edu'),
  ('33000000-0000-0000-0000-000000000004', 'edu'),
  ('33000000-0000-0000-0000-000000000006', 'pr');
-- #586: materialize this suite's legacy setup as rolled-back Group fixtures.
select pg_temp.materialize_legacy_groups();


-- Public, org-audience Opportunities: readable by every live Member (R6).
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, queue_opened_at, created_by)
values
  ('Org always queues #330', 'Mereu coada', '2027-03-01 09:00:00+00', pg_temp.dept_group('edu'), 'org', 'public', 'todo',
   '2027-01-01 00:00:00+00', '33000000-0000-0000-0000-000000000001'),
  ('Queue order #330', 'Coada ordonata', '2027-03-02 09:00:00+00', pg_temp.dept_group('edu'), 'org', 'public', 'todo',
   '2027-01-01 00:00:00+00', '33000000-0000-0000-0000-000000000001'),
  ('Withdraw none #330', 'Fara candidatura', '2027-03-03 09:00:00+00', pg_temp.dept_group('edu'), 'org', 'public', 'todo',
   '2027-01-01 00:00:00+00', '33000000-0000-0000-0000-000000000001'),
  ('Gate denial #330', 'Poarta', '2027-03-04 09:00:00+00', pg_temp.dept_group('edu'), 'org', 'public', 'todo',
   '2027-01-01 00:00:00+00', '33000000-0000-0000-0000-000000000001'),
  ('Direct write #330', 'Scriere directa', '2027-03-05 09:00:00+00', pg_temp.dept_group('edu'), 'org', 'public', 'todo',
   '2027-01-01 00:00:00+00', '33000000-0000-0000-0000-000000000001'),
  ('Queue closed #330', 'Coada inchisa', '2027-03-06 09:00:00+00', pg_temp.dept_group('edu'), 'org', 'public', 'todo',
   '2027-01-01 00:00:00+00', '33000000-0000-0000-0000-000000000001');

update public.tasks set queue_closed_at = '2027-01-02 00:00:00+00'
 where title = 'Queue closed #330';

-- Public, LOCAL Opportunity in 'edu': an outsider cannot even read it (R6
-- local needs Origin membership), while a BCE of another Department reads it
-- through R1 and is still not eligible to join its queue.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, queue_opened_at, created_by)
values
  ('Local audience #330', 'Doar pentru Educational', '2027-03-07 09:00:00+00', pg_temp.dept_group('edu'), 'local', 'public', 'todo',
   '2027-01-01 00:00:00+00', '33000000-0000-0000-0000-000000000001');

-- Direct-mode Task: no queue at all.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, created_by)
values
  ('Direct mode #330', 'Atribuire directa', '2027-03-08 09:00:00+00', pg_temp.dept_group('edu'), 'local', 'direct', 'todo',
   '33000000-0000-0000-0000-000000000001');

-- Terminal public Task: a completed public Task always has its queue closed
-- (tasks_queue_timestamp_state_ck) and both evaluation inputs set
-- (tasks_evaluation_inputs_ck).
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, difficulty, rating,
   status, queue_opened_at, queue_closed_at, completed_at, created_by)
values
  ('Terminal #330', 'Incheiat', '2027-03-09 09:00:00+00', pg_temp.dept_group('edu'), 'local', 'public', 3, 4,
   'completed', '2027-01-01 00:00:00+00', '2027-01-02 00:00:00+00', now(),
   '33000000-0000-0000-0000-000000000001');

-- Umbrella: no Audience, no Assignment Mode, no queue.
insert into public.tasks
  (title, description, group_id, kind, audience, assignment_mode, difficulty, rating, status, created_by)
values
  ('Umbrella #330', 'Umbrela', pg_temp.dept_group('edu'), 'umbrella', null, null, null, null, 'todo',
   '33000000-0000-0000-0000-000000000001');

-- Every fixture id resolved ONCE, as the owner. Never resolve an id inside a
-- format() while a denied persona is logged in: the lookup would run under
-- that persona's RLS, return NULL, and the assertion would pass for the wrong
-- reason (the #328 trap, stack-context.md carry-forwards).
create temp table f330 as
select
  9223372036854775807::bigint as missing_id,
  (select id from public.tasks where title = 'Org always queues #330') as queues_task_id,
  (select id from public.tasks where title = 'Queue order #330') as queue_task_id,
  (select id from public.tasks where title = 'Withdraw none #330') as withdraw_none_task_id,
  (select id from public.tasks where title = 'Gate denial #330') as gate_task_id,
  (select id from public.tasks where title = 'Direct write #330') as direct_write_task_id,
  (select id from public.tasks where title = 'Queue closed #330') as queue_closed_task_id,
  (select id from public.tasks where title = 'Local audience #330') as local_task_id,
  (select id from public.tasks where title = 'Direct mode #330') as direct_task_id,
  (select id from public.tasks where title = 'Terminal #330') as terminal_task_id,
  (select id from public.tasks where title = 'Umbrella #330') as umbrella_task_id;
grant select on f330 to authenticated, anon;

-- ==================== 1. API shape and privileges ====================

select has_function('public', 'express_task_interest', array['bigint'],
  'public.express_task_interest exists with the pinned one-parameter signature');
select is(pg_get_function_identity_arguments(
    'public.express_task_interest(bigint)'::regprocedure),
  'p_task_id bigint',
  'express_task_interest exposes no actor parameter -- the actor is always auth.uid()');
select is(pg_get_function_result(
    'public.express_task_interest(bigint)'::regprocedure),
  'tasks', 'express_task_interest returns the affected Task row');
select ok(not (select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public' and procedure.proname = 'express_task_interest'),
  'the public express command is a security invoker wrapper');
select ok((select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private' and procedure.proname = 'express_task_interest_impl'),
  'private.express_task_interest_impl runs as owner (security definer)');
select ok(coalesce((
    select bool_and('search_path=""' = any(procedure.proconfig))
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private' and procedure.proname = 'express_task_interest_impl'
  ), false), 'express_task_interest_impl pins an empty search_path');
select ok(has_function_privilege('authenticated',
  'public.express_task_interest(bigint)'::regprocedure, 'execute'),
  'authenticated can execute public.express_task_interest');
select ok(not has_function_privilege('anon',
  'public.express_task_interest(bigint)'::regprocedure, 'execute'),
  'anon cannot execute public.express_task_interest');
select ok(has_function_privilege('authenticated',
  'private.express_task_interest_impl(bigint)'::regprocedure, 'execute'),
  'authenticated can execute private.express_task_interest_impl');

select has_function('public', 'withdraw_task_interest', array['bigint'],
  'public.withdraw_task_interest exists with the pinned one-parameter signature');
select is(pg_get_function_identity_arguments(
    'public.withdraw_task_interest(bigint)'::regprocedure),
  'p_task_id bigint',
  'withdraw_task_interest exposes no actor parameter -- the actor is always auth.uid()');
select is(pg_get_function_result(
    'public.withdraw_task_interest(bigint)'::regprocedure),
  'tasks', 'withdraw_task_interest returns the affected Task row');
select ok(not (select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public' and procedure.proname = 'withdraw_task_interest'),
  'the public withdraw command is a security invoker wrapper');
select ok((select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private' and procedure.proname = 'withdraw_task_interest_impl'),
  'private.withdraw_task_interest_impl runs as owner (security definer)');
select ok(coalesce((
    select bool_and('search_path=""' = any(procedure.proconfig))
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private' and procedure.proname = 'withdraw_task_interest_impl'
  ), false), 'withdraw_task_interest_impl pins an empty search_path');
select ok(has_function_privilege('authenticated',
  'public.withdraw_task_interest(bigint)'::regprocedure, 'execute'),
  'authenticated can execute public.withdraw_task_interest');
select ok(not has_function_privilege('anon',
  'public.withdraw_task_interest(bigint)'::regprocedure, 'execute'),
  'anon cannot execute public.withdraw_task_interest');
select ok(has_function_privilege('authenticated',
  'private.withdraw_task_interest_impl(bigint)'::regprocedure, 'execute'),
  'authenticated can execute private.withdraw_task_interest_impl');

-- #682: the two arrival-based Assignment paths are retired from the kit's
-- allow-list, and no function body anywhere still names them.
select throws_ok(format($$ select private.open_task_assignment(%s, '33000000-0000-0000-0000-000000000002', '33000000-0000-0000-0000-000000000002', 'first_come') $$,
  (select gate_task_id from f330)), 'PT400', 'invalid_assignment_via',
  'open_task_assignment refuses via = first_come -- nobody becomes Executor by arriving first (#682)');
select throws_ok(format($$ select private.open_task_assignment(%s, '33000000-0000-0000-0000-000000000002', '33000000-0000-0000-0000-000000000001', 'queue_promotion') $$,
  (select gate_task_id from f330)), 'PT400', 'invalid_assignment_via',
  'open_task_assignment refuses via = queue_promotion -- no Candidate is ever promoted (#682)');
select is(array(
    select procedure.oid::regprocedure::text
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname in ('public', 'private')
       and procedure.prokind = 'f'
       and pg_get_functiondef(procedure.oid) ~ '(first_come|queue_promotion)'
     order by 1),
  '{}'::text[],
  'no function body in public or private names first_come or queue_promotion');

-- ==================== 2. Interest always queues ====================
-- #682 (ruling R9): an org-audience Opportunity with no Executor is open to
-- every live Member, Origin or not -- and the first to arrive joins the
-- Candidate Queue at position 1 like everybody else. The Task Manager selects.

select pg_temp.test_login('33000000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.express_task_interest(%s) $$,
  (select queues_task_id from f330)),
  'the first eligible Member to express interest on an org Opportunity is accepted');
select is((select private.queue_position((select queues_task_id from f330),
            '33000000-0000-0000-0000-000000000005')), 1,
  'the first Member is a pending Candidate at queue position 1');
reset role;

select is((select count(*) from public.task_assignments
            where task_id = (select queues_task_id from f330)), 0::bigint,
  'no Assignment is opened -- the Task has no Executor until the manager selects one');
select is((select format('%s|%s|%s', count(*), min(candidate.member_id::text), min(candidate.status))
             from public.task_candidates as candidate
            where candidate.task_id = (select queues_task_id from f330)),
  '1|33000000-0000-0000-0000-000000000005|pending',
  'exactly one pending Candidature is written, for the Member who arrived');
select is((select string_agg(format('%s|%s|%s|%s', activity.kind, activity.actor_id,
                                    (activity.assignment_id is null)::text, activity.details ->> 'position'), ',')
             from public.task_activity as activity
            where activity.task_id = (select queues_task_id from f330)),
  'interest_expressed|33000000-0000-0000-0000-000000000005|true|1',
  'the only activity row is interest_expressed at position 1 -- no executor_assigned row is written');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s $$, (select queues_task_id from f330)),
  $$ values ('33000000-0000-0000-0000-000000000001'::uuid) $$,
  'only the Task manager (private.task_managers) is notified');
select is((select string_agg(format('%s|%s|%s', notification.title, notification.body, notification.dedupe_key), ',')
             from public.notifications as notification
            where notification.task_id = (select queues_task_id from f330)),
  format('Coadă: Org always queues #330|1 candidat în așteptare.|task:%s:queue',
         (select queues_task_id from f330)),
  'the manager gets exactly one coalesced "Coadă" notification and no "Executor nou"');

-- ==================== 3. The ordered Candidate Queue ====================
-- The first Member queues too; the manager selects them, keeping the rest of
-- the queue open, so the later Members queue behind an Executor.

select pg_temp.test_login('33000000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.express_task_interest(%s) $$,
  (select queue_task_id from f330)),
  'the first Member on the queue Task joins its queue');
reset role;

-- Resolved as the owner (the #328 trap).
create temp table sel330 as
select candidate.id as candidate_id
  from public.task_candidates as candidate
 where candidate.task_id = (select queue_task_id from f330)
   and candidate.member_id = '33000000-0000-0000-0000-000000000002';
grant select on sel330 to authenticated;

select pg_temp.test_login('33000000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select queue_task_id from f330), (select candidate_id from sel330)),
  'the manager selects that Candidate as Executor -- select_task_candidate is the only way in');
reset role;

select pg_temp.test_login('33000000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.express_task_interest(%s) $$,
  (select queue_task_id from f330)),
  'the second Member joins the Candidate Queue instead of taking the Task');
select is((select private.queue_position((select queue_task_id from f330),
            '33000000-0000-0000-0000-000000000003')), 1,
  'the second Member is at queue position 1');
reset role;

select is((select format('%s|%s|%s|%s', activity.kind, activity.actor_id,
                         (activity.assignment_id is null)::text, activity.details ->> 'position')
             from public.task_activity as activity
            where activity.task_id = (select queue_task_id from f330)
              and activity.kind = 'interest_expressed'
              and activity.actor_id = '33000000-0000-0000-0000-000000000003'),
  'interest_expressed|33000000-0000-0000-0000-000000000003|true|1',
  'interest_expressed names the Candidate, carries NO assignment_id (candidate privacy) and records details.position');
select is((select format('%s|%s|%s', notification.title, notification.body, notification.dedupe_key)
             from public.notifications as notification
            where notification.task_id = (select queue_task_id from f330)
              and notification.dedupe_key is not null),
  format('Coadă: Queue order #330|1 candidat în așteptare.|task:%s:queue',
         (select queue_task_id from f330)),
  'the first join writes the coalesced queue notification under task:<id>:queue, singular at n = 1');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s and notification.dedupe_key is not null $$,
    (select queue_task_id from f330)),
  $$ values ('33000000-0000-0000-0000-000000000001'::uuid) $$,
  'the coalesced queue notification recipient set is exactly the Task manager, not merely one row');

select pg_temp.test_login('33000000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.express_task_interest(%s) $$,
  (select queue_task_id from f330)),
  'a third Member joins the queue behind the second');
select is((select private.queue_position((select queue_task_id from f330),
            '33000000-0000-0000-0000-000000000004')), 2,
  'the third Member is at queue position 2 -- order is derived from (joined_at, id), never stored');
reset role;

select is((select format('%s|%s', count(*), min(notification.body))
             from public.notifications as notification
            where notification.task_id = (select queue_task_id from f330)
              and notification.dedupe_key = format('task:%s:queue', (select queue_task_id from f330))),
  '1|2 candidați în așteptare.',
  'the second join coalesces into the SAME manager row, whose body now reads the live pending count');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %1$s
               and notification.dedupe_key = 'task:%1$s:queue' $$,
    (select queue_task_id from f330)),
  $$ values ('33000000-0000-0000-0000-000000000001'::uuid) $$,
  'coalescing a second join does not add a second recipient -- still exactly the Task manager');

-- ---- withdrawing position 1 promotes position 2 ----
select pg_temp.test_login('33000000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.withdraw_task_interest(%s) $$,
  (select queue_task_id from f330)),
  'the Candidate at position 1 withdraws');
select is((select private.queue_position((select queue_task_id from f330),
            '33000000-0000-0000-0000-000000000003')), null::integer,
  'a withdrawn Candidate has no queue position at all');
select is((select private.queue_position((select queue_task_id from f330),
            '33000000-0000-0000-0000-000000000004')), null::integer,
  'a Candidate cannot probe another Candidate''s position -- queue_position is self-gated (#319)');
reset role;

select pg_temp.test_login('33000000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select private.queue_position((select queue_task_id from f330),
            '33000000-0000-0000-0000-000000000004')), 1,
  'the Candidate behind them is promoted from position 2 to 1 -- derived order needs no renumbering');
reset role;

select is((select format('%s|%s|%s', candidate.status, candidate.decided_by,
                         (candidate.decided_at is not null)::text)
             from public.task_candidates as candidate
            where candidate.task_id = (select queue_task_id from f330)
              and candidate.member_id = '33000000-0000-0000-0000-000000000003'),
  'withdrawn|33000000-0000-0000-0000-000000000003|true',
  'the withdrawn Candidature records the member as its own decider, per task_candidates_decision_shape_ck');
select is((select format('%s|%s|%s', activity.kind, activity.actor_id,
                         (activity.assignment_id is null)::text)
             from public.task_activity as activity
            where activity.task_id = (select queue_task_id from f330)
              and activity.kind = 'interest_withdrawn'),
  'interest_withdrawn|33000000-0000-0000-0000-000000000003|true',
  'interest_withdrawn names the Candidate and carries no assignment_id either');
select is((select format('%s|%s', count(*), min(notification.body))
             from public.notifications as notification
            where notification.task_id = (select queue_task_id from f330)
              and notification.dedupe_key = format('task:%s:queue', (select queue_task_id from f330))),
  '1|1 candidat în așteptare.',
  'the withdrawal rewrites the same coalesced manager row down to the new pending count, singular at n = 1');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %1$s
               and notification.dedupe_key = 'task:%1$s:queue' $$,
    (select queue_task_id from f330)),
  $$ values ('33000000-0000-0000-0000-000000000001'::uuid) $$,
  'the withdrawal still coalesces into the manager''s one row -- no second recipient appears');

-- ---- rejoining is a new row at the END of the order ----
select pg_temp.test_login('33000000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.express_task_interest(%s) $$,
  (select queue_task_id from f330)),
  'a withdrawn Member may rejoin the queue -- the partial unique index only forbids two PENDING rows');
select is((select private.queue_position((select queue_task_id from f330),
            '33000000-0000-0000-0000-000000000003')), 2,
  'the rejoining Member lands at the END of the order, not back at their old position');
reset role;

select is((select count(*) from public.task_candidates
            where task_id = (select queue_task_id from f330)
              and member_id = '33000000-0000-0000-0000-000000000003'), 2::bigint,
  'the rejoin is a NEW Candidature row, leaving the withdrawn one as history');
select is((select format('%s|%s', count(*), min(notification.body))
             from public.notifications as notification
            where notification.task_id = (select queue_task_id from f330)
              and notification.dedupe_key = format('task:%s:queue', (select queue_task_id from f330))),
  '1|2 candidați în așteptare.',
  'the rejoin coalesces into the same row again, back up to two pending Candidates');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %1$s
               and notification.dedupe_key = 'task:%1$s:queue' $$,
    (select queue_task_id from f330)),
  $$ values ('33000000-0000-0000-0000-000000000001'::uuid) $$,
  'through every join, withdrawal and rejoin the coalesced row''s recipient never drifts from the Task manager');
select is((select count(*) from public.task_assignments
            where task_id = (select queue_task_id from f330)), 1::bigint,
  'through three joins, a withdrawal and a rejoin the Task still has exactly one Assignment');

-- ==================== 4. Eligibility (PT409) ====================

select pg_temp.test_login('33000000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.express_task_interest(%s) $$,
  (select queue_task_id from f330)), 'PT409', 'already_executor',
  'the active Executor cannot also queue for their own Task');
reset role;

select pg_temp.test_login('33000000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.express_task_interest(%s) $$,
  (select queue_task_id from f330)), 'PT409', 'already_candidate',
  'a Member with a live pending Candidature cannot queue twice');
reset role;

-- The manager (BCE of 'edu', level 5) is the persona for every Task an
-- ordinary Member could not even read: a direct, terminal, queue-closed or
-- Umbrella Task all fail can_read_task's R6 Opportunity branch, so only a
-- global reader gets past require_task_visible to reach the state check.
select pg_temp.test_login('33000000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.express_task_interest(%s) $$,
  (select umbrella_task_id from f330)), 'PT409', 'task_is_umbrella',
  'an Umbrella has no Assignment Mode and no queue to join');
select throws_ok(format($$ select public.express_task_interest(%s) $$,
  (select direct_task_id from f330)), 'PT409', 'task_not_public',
  'a direct-mode Task is assigned by a manager, never claimed');
select throws_ok(format($$ select public.express_task_interest(%s) $$,
  (select terminal_task_id from f330)), 'PT409', 'task_terminal',
  'a terminal Task takes no new interest');
select throws_ok(format($$ select public.express_task_interest(%s) $$,
  (select queue_closed_task_id from f330)), 'PT409', 'task_queue_closed',
  'a closed Candidate Queue takes no new interest');
select throws_ok(format($$ select public.express_task_interest(%s) $$,
  (select missing_id from f330)), 'PT404', 'task_not_found',
  'an unknown Task is not found, not forbidden');
reset role;

select is((select count(*) from public.task_activity
            where task_id in (select umbrella_task_id from f330)
               or task_id in (select direct_task_id from f330)
               or task_id in (select terminal_task_id from f330)
               or task_id in (select queue_closed_task_id from f330)), 0::bigint,
  'none of the five rejected eligibility calls wrote an activity row');
select is((select count(*) from public.task_candidates
            where task_id in (select umbrella_task_id from f330)
               or task_id in (select direct_task_id from f330)
               or task_id in (select terminal_task_id from f330)
               or task_id in (select queue_closed_task_id from f330)), 0::bigint,
  'none of the five rejected eligibility calls wrote a Candidature');

-- ==================== 5. Audience is the eligibility rule under the lock ====================
-- A BCE of another Department READS the local Opportunity (R1 global reader)
-- but is not a Member of its Origin, so joining its queue is forbidden --
-- 42501, not PT404: they already know the Task exists.
select pg_temp.test_login('33000000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["pr"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.express_task_interest(%s) $$,
  (select local_task_id from f330)), '42501', 'task_audience_forbidden',
  'a local Opportunity admits only Members of its own Origin, global read access notwithstanding');
reset role;

-- The outsider has no Department at all, so the same local Task is invisible:
-- visibility is the OUTER gate and answers first, with PT404.
select pg_temp.test_login('33000000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.express_task_interest(%s) $$,
  (select local_task_id from f330)), 'PT404', 'task_not_found',
  'a local Opportunity the caller cannot read is not found -- never a hint that it exists');
select throws_ok(format($$ select public.withdraw_task_interest(%s) $$,
  (select withdraw_none_task_id from f330)), 'PT409', 'not_a_candidate',
  'withdrawing without a live pending Candidature is rejected');
reset role;

-- Member 2 is the selected Executor of the queue Task (section 3).
select pg_temp.test_login('33000000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.withdraw_task_interest(%s) $$,
  (select queue_task_id from f330)), 'PT409', 'not_a_candidate',
  'the Executor is not a Candidate -- leaving a Task one already holds is a different command (#331)');
reset role;

select is((select count(*) from public.task_activity
            where task_id in (select local_task_id from f330)
               or task_id in (select withdraw_none_task_id from f330)), 0::bigint,
  'the audience, visibility and not-a-candidate denials wrote no activity row');
select is((select count(*) from public.task_candidates
            where task_id = (select local_task_id from f330)), 0::bigint,
  'the audience and visibility denials wrote no Candidature');

-- ==================== 6. Gate denials ====================

select pg_temp.test_login('33000000-0000-0000-0000-000000000008',
  jsonb_build_object('provider', 'email'));
select throws_ok(format($$ select public.express_task_interest(%s) $$,
  (select gate_task_id from f330)), '42501', 'task_command_forbidden',
  'a real uid without organisation claims cannot express interest');
select throws_ok(format($$ select public.withdraw_task_interest(%s) $$,
  (select gate_task_id from f330)), '42501', 'task_command_forbidden',
  'a real uid without organisation claims cannot withdraw interest');
reset role;

select pg_temp.test_login('33000000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.express_task_interest(%s) $$,
  (select gate_task_id from f330)), '42501', 'task_command_forbidden',
  'a deactivated BC holding a still-valid level-6 token cannot express interest');
select throws_ok(format($$ select public.withdraw_task_interest(%s) $$,
  (select gate_task_id from f330)), '42501', 'task_command_forbidden',
  'a deactivated BC holding a still-valid level-6 token cannot withdraw interest');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(format($$ select public.express_task_interest(%s) $$,
  (select gate_task_id from f330)),
  '42501', 'permission denied for function express_task_interest',
  'anon cannot execute express_task_interest at all -- the literal grant denial, not a gate that happens to raise 42501');
select throws_ok(format($$ select public.withdraw_task_interest(%s) $$,
  (select gate_task_id from f330)),
  '42501', 'permission denied for function withdraw_task_interest',
  'anon cannot execute withdraw_task_interest at all');
reset role;

select is((select count(*) from public.task_assignments
            where task_id = (select gate_task_id from f330)), 0::bigint,
  'none of the six denied gate attempts opened an Assignment');
select is((select count(*) from public.task_activity
            where task_id = (select gate_task_id from f330)), 0::bigint,
  'none of the six denied gate attempts wrote an activity row');
select is((select count(*) from public.notifications
            where task_id = (select gate_task_id from f330)), 0::bigint,
  'none of the six denied gate attempts wrote a notification');

-- ==================== 7. The commands are the only write path ====================

select pg_temp.test_login('33000000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ insert into public.task_candidates (task_id, member_id)
  values (%s, '33000000-0000-0000-0000-000000000002') $$,
  (select direct_write_task_id from f330)),
  '42501', null, 'an ordinary Member cannot queue themselves by inserting into task_candidates');
select throws_ok(format($$ update public.task_candidates set status = 'withdrawn'
  where task_id = %s $$, (select queue_task_id from f330)),
  '42501', null, 'an ordinary Member cannot resolve a Candidature by updating task_candidates');
select throws_ok(format($$ insert into public.task_assignments (task_id, member_id)
  values (%s, '33000000-0000-0000-0000-000000000002') $$,
  (select direct_write_task_id from f330)),
  '42501', null, 'an ordinary Member cannot make themselves the Executor by inserting into task_assignments');
reset role;

-- ==================== 8. Locks held while the two commands run ====================
-- The race in section 9 proves the SECOND caller blocks on express_task_
-- interest; this probe proves WHERE it blocks -- the tasks row FOR UPDATE,
-- taken before any queue state is read -- and that the actor's own live
-- profile row is held FOR SHARE so a concurrent deactivation serializes
-- behind the command (#343 / #390 discipline). Without it nothing would fail
-- if the command dropped either. Two further held calls on the same
-- connection extend the same proof: a local-Audience Task (the only branch
-- that locks a group_members roster row) and
-- withdraw_task_interest itself, which section 9's race never exercises and
-- whose own tasks-row FOR UPDATE would otherwise be asserted by nothing.
--
-- Sections 8 and 9 work on COMMITTED fixtures, created and removed through
-- their own dblink connection: pg_temp.test_race commits both of its
-- sessions for real, so nothing this suite's own rolled-back transaction
-- created would be visible to them.
select extensions.dblink_connect('ti_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
-- #621: committed fixtures from an interrupted run must not hang cleanup.
select extensions.dblink_exec('ti_setup', 'set lock_timeout = ''2s''');

select extensions.dblink_exec('ti_setup', $$
  set session_replication_role = 'replica';
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#330 committed%');
  set session_replication_role = 'origin';
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#330 committed%')
      or member_id in ('33000000-0000-0000-0000-000000000021',
                       '33000000-0000-0000-0000-000000000022',
                       '33000000-0000-0000-0000-000000000023')
      or link in (select '/tracker/' || id::text from public.tasks
                   where title like '%#330 committed%');
  delete from public.task_candidates
   where task_id in (select id from public.tasks where title like '%#330 committed%');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%#330 committed%');
  delete from public.tasks where title like '%#330 committed%';
  delete from public.member_departments where member_id in (
    '33000000-0000-0000-0000-000000000021',
    '33000000-0000-0000-0000-000000000022',
    '33000000-0000-0000-0000-000000000023');
  delete from auth.users where id in (
    '33000000-0000-0000-0000-000000000021',
    '33000000-0000-0000-0000-000000000022',
    '33000000-0000-0000-0000-000000000023');

  insert into auth.users (id, email) values
    ('33000000-0000-0000-0000-000000000021', 'race.manager.330@test.local'),
    ('33000000-0000-0000-0000-000000000022', 'race.a.330@test.local'),
    ('33000000-0000-0000-0000-000000000023', 'race.b.330@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('33000000-0000-0000-0000-000000000021', 'Race Manager 330', 'race.manager.330@test.local', 'bce', 'activ'),
    ('33000000-0000-0000-0000-000000000022', 'Race A 330', 'race.a.330@test.local', 'voluntar', 'activ'),
    ('33000000-0000-0000-0000-000000000023', 'Race B 330', 'race.b.330@test.local', 'voluntar', 'activ');
  insert into public.member_departments (member_id, dept_id) values
    ('33000000-0000-0000-0000-000000000021', 'edu'),
    ('33000000-0000-0000-0000-000000000022', 'edu'),
    ('33000000-0000-0000-0000-000000000023', 'edu');
  -- #586: committed race fixtures require native Group roster rows.
  insert into public.group_members(group_id,member_id,group_role)
  select g.id,md.member_id,case when p.role='bce' then 'manager' else 'member' end
    from public.member_departments md join public.groups g on g.legacy_dept_id=md.dept_id
    join public.profiles p on p.id=md.member_id
   where md.member_id::text like '33000000-%'
  on conflict (group_id,member_id) do nothing;
  insert into public.tasks
    (title, description, deadline, group_id, audience, assignment_mode, status, queue_opened_at, created_by)
  values
    ('Lock probe #330 committed', 'Sonda', '2027-04-01 09:00:00+00', (select id from public.groups where legacy_dept_id = 'edu'), 'org', 'public', 'todo',
     '2027-01-01 00:00:00+00', '33000000-0000-0000-0000-000000000021'),
    ('Race target #330 committed', 'Cursa', '2027-04-02 09:00:00+00', (select id from public.groups where legacy_dept_id = 'edu'), 'org', 'public', 'todo',
     '2027-01-01 00:00:00+00', '33000000-0000-0000-0000-000000000021'),
    ('Local audience lock probe #330 committed', 'Sonda audienta locala', '2027-04-03 09:00:00+00',
     (select id from public.groups where legacy_dept_id = 'edu'), 'local', 'public', 'todo', '2027-01-01 00:00:00+00', '33000000-0000-0000-0000-000000000021'),
    ('Withdraw lock probe #330 committed', 'Sonda retragere', '2027-04-04 09:00:00+00',
     (select id from public.groups where legacy_dept_id = 'edu'), 'org', 'public', 'todo', '2027-01-01 00:00:00+00', '33000000-0000-0000-0000-000000000021');

  -- Directly fixtured (never through the command) so the held withdraw call
  -- below has a real live pending Candidature to resolve: withdraw's only
  -- precondition is the caller's own pending row, no Assignment required.
  insert into public.task_candidates (task_id, member_id, status, joined_at)
  select id, '33000000-0000-0000-0000-000000000023', 'pending', now()
    from public.tasks where title = 'Withdraw lock probe #330 committed';
$$);

-- Resolved as the owner, before any persona logs in (the #328 trap again).
create temp table r330 as
select (select id from public.tasks where title = 'Lock probe #330 committed') as probe_task_id,
       (select id from public.tasks where title = 'Race target #330 committed') as race_task_id,
       (select id from public.tasks where title = 'Local audience lock probe #330 committed') as local_probe_task_id,
       (select id from public.tasks where title = 'Withdraw lock probe #330 committed') as withdraw_probe_task_id;
grant select on r330 to authenticated;

select extensions.dblink_connect('ti_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('ti_lock', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('ti_lock', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '33000000-0000-0000-0000-000000000022', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'voluntar', 'member_level', 1,
      'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text, true)
$$) as remote_claims(setting text);
select extensions.dblink_exec('ti_lock', 'set local role authenticated');
select * from extensions.dblink('ti_lock', format($$
  select (public.express_task_interest(%s)).status::text
$$, (select probe_task_id from r330))) as locked_express(status text);

select ok(coalesce((
  select row_lock.modes && array['For Update', 'Update', 'No Key Update']
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_task_id from r330)
), false), 'express_task_interest holds the target Task row exclusively locked while it runs');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.profiles') as row_lock
    join public.profiles as profile on profile.ctid = row_lock.locked_row
   where profile.id = '33000000-0000-0000-0000-000000000022'
), false), 'express_task_interest holds the actor''s live profile row FOR SHARE');

select extensions.dblink_exec('ti_lock', 'rollback');

-- ---- item 7: the local-Audience membership check is held FOR SHARE too ----
-- Same connection, a second held call -- this time against a local-Audience
-- Task, the only branch that reads a roster under the lock. #579: the rule is
-- private.is_group_member on the Task's Group, so Member 22's own group_members
-- row on the edu Group (mirrored from their 'edu' membership) is exactly what
-- express_task_interest re-validates and holds at step 4.
select extensions.dblink_exec('ti_lock', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('ti_lock', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '33000000-0000-0000-0000-000000000022', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'voluntar', 'member_level', 1,
      'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text, true)
$$) as remote_claims(setting text);
select extensions.dblink_exec('ti_lock', 'set local role authenticated');
select * from extensions.dblink('ti_lock', format($$
  select (public.express_task_interest(%s)).status::text
$$, (select local_probe_task_id from r330))) as locked_express_local(status text);

select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.group_members') as row_lock
    join public.group_members as membership on membership.ctid = row_lock.locked_row
   where membership.member_id = '33000000-0000-0000-0000-000000000022'
     and membership.group_id = (select id from public.groups where legacy_dept_id = 'edu')
), false), 'a local-Audience express_task_interest holds the actor''s Group roster row FOR SHARE too');

select extensions.dblink_exec('ti_lock', 'rollback');

-- ---- item 1: withdraw_task_interest has the identical lock discipline ----
-- Section 9's race only exercises express_task_interest; nothing until now
-- proved withdraw_task_interest takes the same tasks-row FOR UPDATE lock
-- before its read-modify-write of the coalesced queue notification (both call
-- private.pending_candidate_count then upsert the same manager row).
-- Member 23 already holds a directly-fixtured pending Candidature on this
-- Task (no Assignment needed -- withdraw's only precondition is the caller's
-- own live pending row), so the held call is a real withdrawal, not a no-op.
select extensions.dblink_exec('ti_lock', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('ti_lock', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '33000000-0000-0000-0000-000000000023', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'voluntar', 'member_level', 1,
      'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text, true)
$$) as remote_claims(setting text);
select extensions.dblink_exec('ti_lock', 'set local role authenticated');
select * from extensions.dblink('ti_lock', format($$
  select (public.withdraw_task_interest(%s)).status::text
$$, (select withdraw_probe_task_id from r330))) as locked_withdraw(status text);

select ok(coalesce((
  select row_lock.modes && array['For Update', 'Update', 'No Key Update']
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select withdraw_probe_task_id from r330)
), false), 'withdraw_task_interest holds the target Task row exclusively locked while it runs');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.profiles') as row_lock
    join public.profiles as profile on profile.ctid = row_lock.locked_row
   where profile.id = '33000000-0000-0000-0000-000000000023'
), false), 'withdraw_task_interest holds the actor''s live profile row FOR SHARE');

select extensions.dblink_exec('ti_lock', 'rollback');
select extensions.dblink_disconnect('ti_lock');

-- ==================== 9. The two-session race ====================
-- Two Members express interest on the same fresh Opportunity at the same
-- instant. The second must BLOCK on the tasks row lock (b_waited), wake up
-- after the first commits and queue behind it. Since #682 neither of them
-- becomes the Executor: the race ends with two pending Candidates in arrival
-- order and no Assignment at all -- the manager selects.
--
-- pg_temp.test_race copies THIS session's claims into both of its dblink
-- sessions, so session B re-stamps its own claims first, inside the same
-- statement, through a volatile CTE the outer target list must consume
-- before it runs (the _helpers.sql self-test uses the identical shape around
-- an advisory lock).
select pg_temp.test_login('33000000-0000-0000-0000-000000000022', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table race330 as
select * from pg_temp.test_race(
  format($$ select (public.express_task_interest(%s)).id::text $$,
    (select race_task_id from r330)),
  format($$ with claims as (select set_config('request.jwt.claims', %L, true))
            select (public.express_task_interest(%s)).id::text from claims $$,
    jsonb_build_object(
      'sub', '33000000-0000-0000-0000-000000000023', 'role', 'authenticated',
      'app_metadata', jsonb_build_object('member_role', 'voluntar', 'member_level', 1,
        'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text,
    (select race_task_id from r330)));
reset role;

select ok((select b_waited from race330),
  'the second session BLOCKS before the first commits -- serialization happened; pairs with the '
  || 'pgrowlocks probe in section 8 and the assignment/candidate counts below to show it is the '
  || 'Task row FOR UPDATE lock that catches the second caller');
select is((select result_a from race330), (select race_task_id::text from r330),
  'the first session succeeds and returns the Task row');
select is((select result_b from race330), (select race_task_id::text from r330),
  'the second session also succeeds -- it queues behind the first');
select is((select count(*) from public.task_assignments as assignment
            where assignment.task_id = (select race_task_id from r330)), 0::bigint,
  'the race opens no Assignment at all -- neither session becomes the Executor (#682)');
select is((select string_agg(candidate.member_id::text, ',' order by candidate.joined_at, candidate.id)
             from public.task_candidates as candidate
            where candidate.task_id = (select race_task_id from r330)
              and candidate.status = 'pending'),
  '33000000-0000-0000-0000-000000000022,33000000-0000-0000-0000-000000000023',
  'both sessions end as pending Candidates, the lock winner first');

select pg_temp.test_login('33000000-0000-0000-0000-000000000023', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select private.queue_position((select race_task_id from r330),
            '33000000-0000-0000-0000-000000000023')), 2,
  'the second session sits at position 2, behind the first, ready for the manager''s selection');
reset role;

select is((select count(*) from public.task_activity as activity
            where activity.task_id = (select race_task_id from r330)
              and activity.kind = 'executor_assigned'), 0::bigint,
  'the race wrote no executor_assigned row');
select is((select count(*) from public.task_activity as activity
            where activity.task_id = (select race_task_id from r330)
              and activity.kind = 'interest_expressed'), 2::bigint,
  'the race wrote exactly two interest_expressed rows, one per session');

-- ---- clean up everything the committed sessions left behind ----
-- task_activity is append-only by trigger, including for its owner, so the
-- cleanup runs its one delete under session_replication_role = 'replica',
-- which suppresses the ENABLE ORIGIN trigger for that session only. Not
-- `alter table ... disable trigger`: that needs ACCESS EXCLUSIVE on
-- task_activity, which this suite's own open transaction already holds a
-- conflicting ROW EXCLUSIVE on -- the cleanup would deadlock against itself.
select extensions.dblink_exec('ti_setup', $$
  set session_replication_role = 'replica';
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#330 committed%');
  set session_replication_role = 'origin';
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#330 committed%')
      or member_id in ('33000000-0000-0000-0000-000000000021',
                       '33000000-0000-0000-0000-000000000022',
                       '33000000-0000-0000-0000-000000000023')
      or link in (select '/tracker/' || id::text from public.tasks
                   where title like '%#330 committed%');
  delete from public.task_candidates
   where task_id in (select id from public.tasks where title like '%#330 committed%');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%#330 committed%');
  delete from public.tasks where title like '%#330 committed%';
  delete from public.member_departments where member_id in (
    '33000000-0000-0000-0000-000000000021',
    '33000000-0000-0000-0000-000000000022',
    '33000000-0000-0000-0000-000000000023');
  delete from auth.users where id in (
    '33000000-0000-0000-0000-000000000021',
    '33000000-0000-0000-0000-000000000022',
    '33000000-0000-0000-0000-000000000023');
$$);
select extensions.dblink_disconnect('ti_setup');

select is((select count(*) from public.tasks where title like '%#330 committed%'), 0::bigint,
  'the committed race and lock-probe fixtures are removed again -- this suite leaves no trace');
select is((select count(*) from auth.users
            where id in ('33000000-0000-0000-0000-000000000021',
                         '33000000-0000-0000-0000-000000000022',
                         '33000000-0000-0000-0000-000000000023')), 0::bigint,
  'the three committed race/lock-probe fixture accounts are removed too, not just their Tasks');
-- notifications.task_id is ON DELETE SET NULL, so a leftover row for a
-- recipient outside the hard-coded trio would survive with a nulled task_id
-- and be invisible to a task_id-keyed check; link ('/tracker/<id>') still
-- names the deleted Task and cannot be erased by the cascade, so this is the
-- assertion that would actually catch it. r330's ids are read from the temp
-- table now, before the transaction rolls back and takes it with them.
select is((select count(*) from public.notifications
            where link in (
              select '/tracker/' || task_id::text from (
                select probe_task_id as task_id from r330
                union all select race_task_id from r330
                union all select local_probe_task_id from r330
                union all select withdraw_probe_task_id from r330
              ) as committed_task_ids
            )), 0::bigint,
  'no notification survives with a nulled task_id after the committed Tasks are deleted -- checked by link, which ON DELETE SET NULL cannot erase');


-- #521: Group authority regression matrix.
\ir _group_task_fixtures.psql
reset role;
select pg_temp.g521_task('executor0','project',null,'todo','public');
update public.tasks set created_by=pg_temp.g521_uid(2) where id=(select id from g521_tasks where name='executor0');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($$select public.express_task_interest((select id from g521_tasks where name='executor0'))$$,'task_interest: Executor persona 2 remains authorized');
reset role;
reset role;
select pg_temp.g521_task('executor1','project',null,'todo','public');
update public.tasks set created_by=pg_temp.g521_uid(4) where id=(select id from g521_tasks where name='executor1');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(4));
select lives_ok($$select public.express_task_interest((select id from g521_tasks where name='executor1'))$$,'task_interest: Executor persona 4 remains authorized');
reset role;
select results_eq($$select distinct member_id from public.notifications where task_id=(select id from g521_tasks where name='executor1') order by 1$$,$$select pg_temp.g521_uid(2)$$,'Group Manager alone receives fallback work notifications');
reset role;
select pg_temp.g521_task('executor2','ind',null,'todo','public');
update public.tasks set created_by=pg_temp.g521_uid(7) where id=(select id from g521_tasks where name='executor2');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(7));
select lives_ok($$select public.express_task_interest((select id from g521_tasks where name='executor2'))$$,'task_interest: Executor persona 7 remains authorized');
reset role;
select ok(exists(select 1 from public.notifications where task_id=(select id from g521_tasks where name='executor2') and member_id=pg_temp.g521_uid(6)) and exists(select 1 from public.notifications where task_id=(select id from g521_tasks where name='executor2') and member_id=pg_temp.g521_uid(1)),'Manager-less peers and BC receive fallback work notifications');
reset role;
select pg_temp.g521_task('executor3','dt',null,'todo','public');
update public.tasks set created_by=pg_temp.g521_uid(8) where id=(select id from g521_tasks where name='executor3');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(8));
select lives_ok($$select public.express_task_interest((select id from g521_tasks where name='executor3'))$$,'task_interest: Executor persona 8 remains authorized');
reset role;

-- #682: in the Group fixture too, the first interested Member only queues --
-- the Group Manager hears "Coadă", never the retired "Executor nou".
update public.profiles set nickname='Primul 675' where id=pg_temp.g521_uid(4);
select pg_temp.g521_task('executor675','project',null,'todo','public');
update public.tasks set created_by=pg_temp.g521_uid(4) where id=(select id from g521_tasks where name='executor675');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(4));
select lives_ok($$select public.express_task_interest((select id from g521_tasks where name='executor675'))$$,'task_interest: a Nicknamed Member joins the queue of a Task with no Executor');
reset role;
select is((select string_agg(title || '|' || body, ',') from public.notifications where task_id=(select id from g521_tasks where name='executor675') and member_id=pg_temp.g521_uid(2)),'Coadă: Group #521 executor675|1 candidat în așteptare.','the Group Manager gets the coalesced "Coadă" notification and no "Executor nou" (#682)');

select * from finish();
rollback;
