-- #334: public.start_task and public.submit_task_for_review -- the two
-- Executor-side lifecycle transitions todo -> in_progress and
-- in_progress -> in_review.
--
-- The safety property this suite exists for: only the Task's own live active
-- Executor may move their own work forward. private.require_task_executor is
-- the entire authority rule for both commands (42501 task_executor_forbidden
-- for a manager, a past Executor, or anyone else); neither command accepts an
-- actor parameter or lets a manager act "on behalf of" the Executor.
--
-- start_task writes NO notification -- deliberate, not an oversight (the
-- brief pins it explicitly), so section 2 asserts the absence directly rather
-- than merely not asserting a presence. submit_task_for_review notifies
-- private.task_managers with the pinned "De verificat" copy.
--
-- Resubmission (section 4): #337's return_task_to_progress (not yet built)
-- will set review_round and returned_to_progress_at when a Reviewer sends
-- work back; this command must NOT touch either column on a second
-- submission -- #335 (evaluate_task) and #337 own those writes. Section 4
-- hand-fixtures a Task already in that returned shape (review_round = 1,
-- returned_to_progress_at set, status in_progress, submitted_at null per
-- tasks_submitted_at_state_ck) and asserts both survive a resubmit
-- byte-for-byte.
--
-- The Umbrella case (section 6): an Umbrella never has an Executor -- no
-- command on main ever opens a task_assignments row for one, and #327's
-- create_task_impl refuses an Umbrella an Executor at creation. So calling
-- either command on an Umbrella needs NO dedicated PT409 task_is_umbrella:
-- private.require_task_executor simply finds no active Assignment for the
-- Umbrella's id and raises the ordinary 42501 task_executor_forbidden, the
-- same reason a manager or a past Executor gets. This is stated here, not
-- assumed: section 6 calls both commands on a real Umbrella fixture and pins
-- the exact reason.
--
-- Fixture prefix 33400000-0000-0000-0000-0000000000NN throughout, resolved
-- as the owner into a temp table before any persona logs in (the #328 trap,
-- stack-context.md carry-forwards).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(59);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('33400000-0000-0000-0000-000000000001', 'manager.334@test.local'),
  ('33400000-0000-0000-0000-000000000002', 'executor.334@test.local'),
  ('33400000-0000-0000-0000-000000000003', 'past.executor.334@test.local'),
  ('33400000-0000-0000-0000-000000000004', 'inactive.bc.334@test.local'),
  ('33400000-0000-0000-0000-000000000005', 'claimless.334@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('33400000-0000-0000-0000-000000000001', 'Manager 334', 'manager.334@test.local', 'bce', 'activ'),
  ('33400000-0000-0000-0000-000000000002', 'Executor 334', 'executor.334@test.local', 'voluntar', 'activ'),
  ('33400000-0000-0000-0000-000000000003', 'Fost Executor 334', 'past.executor.334@test.local', 'voluntar', 'activ'),
  ('33400000-0000-0000-0000-000000000004', 'BC Inactiv 334', 'inactive.bc.334@test.local', 'bc', 'inactiv'),
  ('33400000-0000-0000-0000-000000000005', 'Fara Claimuri 334', 'claimless.334@test.local', 'voluntar', 'activ');

insert into public.member_departments (member_id, dept_id) values
  ('33400000-0000-0000-0000-000000000001', 'edu'),
  ('33400000-0000-0000-0000-000000000002', 'edu'),
  ('33400000-0000-0000-0000-000000000003', 'edu'),
  ('33400000-0000-0000-0000-000000000005', 'edu');

-- ---- T1: start_task happy path -- a todo Task, direct mode, one Executor.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, created_by)
values
  ('Start fericit #334', 'Gata de pornit', '2027-11-01 09:00:00+00', 'edu', 'local', 'direct', 'todo',
   '33400000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33400000-0000-0000-0000-000000000002', '33400000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Start fericit #334';

-- ---- T2: submit_task_for_review happy path -- in_progress, fresh (never
-- returned), created by the manager so task_managers picks the CREATOR.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, created_at, started_at, created_by)
values
  ('Trimitere fericita #334', 'Gata de verificare', '2027-11-02 09:00:00+00', 'edu', 'local', 'direct', 'in_progress',
   now() - interval '2 hours', now() - interval '1 hour', '33400000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33400000-0000-0000-0000-000000000002', '33400000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Trimitere fericita #334';

-- ---- T3: already in_progress -- wrong state for start_task.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, started_at, created_by)
values
  ('Deja in lucru #334', 'Nu mai e todo', '2027-11-03 09:00:00+00', 'edu', 'local', 'direct', 'in_progress',
   now(), '33400000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33400000-0000-0000-0000-000000000002', '33400000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Deja in lucru #334';

-- ---- T4: cancelled but hand-fixtured with a still-active Assignment (no
-- command on main produces this shape -- give_up_task.test.sql T6 sets the
-- same precedent) -- proves the state check rejects every non-todo status,
-- not only in_progress.
-- #339: tasks_cancel_reason_ck makes cancel_reason mandatory on -- and
-- exclusive to -- a cancelled Task, so this fixture states why it was called
-- off. Nothing else about the fixture changes.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, cancelled_at, cancel_reason, created_by)
values
  ('Anulat pentru start #334', 'Anulat cu executant', '2027-11-04 09:00:00+00', 'edu', 'local', 'direct', 'cancelled',
   now(), 'Anulat inainte de start #334', '33400000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33400000-0000-0000-0000-000000000002', '33400000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Anulat pentru start #334';

-- ---- T5: still todo -- wrong state for submit_task_for_review.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, created_by)
values
  ('Netrimis pentru verificare #334', 'Nu a pornit inca', '2027-11-05 09:00:00+00', 'edu', 'local', 'direct', 'todo',
   '33400000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33400000-0000-0000-0000-000000000002', '33400000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Netrimis pentru verificare #334';

-- ---- T6: cancelled but hand-fixtured with a still-active Assignment --
-- wrong state for submit_task_for_review, second variant.
-- #339: tasks_cancel_reason_ck makes cancel_reason mandatory on -- and
-- exclusive to -- a cancelled Task, so this fixture states why it was called
-- off. Nothing else about the fixture changes.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, cancelled_at, cancel_reason, created_by)
values
  ('Anulat pentru verificare #334', 'Anulat cu executant', '2027-11-06 09:00:00+00', 'edu', 'local', 'direct', 'cancelled',
   now(), 'Anulat inainte de verificare #334', '33400000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33400000-0000-0000-0000-000000000002', '33400000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Anulat pentru verificare #334';

-- ---- T7: an Umbrella (#315 shape, null audience/assignment_mode). Never has
-- an Assignment -- section 6 pins that both commands answer plain
-- task_executor_forbidden, with no dedicated Umbrella reason.
insert into public.tasks
  (title, dept_id, kind, audience, assignment_mode, difficulty, rating, status, created_by)
values
  ('Umbrela #334', 'edu', 'umbrella', null, null, null, null, 'todo',
   '33400000-0000-0000-0000-000000000001');

-- ---- T8: returned-from-review shape -- in_progress, review_round = 1,
-- returned_to_progress_at set, submitted_at null (tasks_submitted_at_state_
-- check forbids a non-null submitted_at outside in_review/completed/
-- unfulfilled/cancelled). A resubmit must set submitted_at again and leave
-- review_round / returned_to_progress_at untouched -- #335/#337's job, not
-- this command's.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, review_round, returned_to_progress_at, created_by)
values
  ('Retrimis dupa feedback #334', 'A fost intors', '2027-11-08 09:00:00+00', 'edu', 'local', 'direct', 'in_progress',
   now() - interval '3 days', now() - interval '2 days', 1, now() - interval '1 day', '33400000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33400000-0000-0000-0000-000000000002', '33400000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Retrimis dupa feedback #334';

-- ---- T9: the persona matrix target for start_task -- todo, with both the
-- active Executor and a genuinely PAST one (ended Assignment), so the past
-- Executor still reads the Task (can_read_task) but has no authority left.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, created_by)
values
  ('Persoane start #334', 'Matricea de persoane', '2027-11-09 09:00:00+00', 'edu', 'local', 'direct', 'todo',
   '33400000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at, ended_at, end_reason)
select id, '33400000-0000-0000-0000-000000000003', '33400000-0000-0000-0000-000000000001',
       now() - interval '2 days', now() - interval '1 day', 'replaced'
  from public.tasks where title = 'Persoane start #334';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33400000-0000-0000-0000-000000000002', '33400000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Persoane start #334';

-- ---- T10: the persona matrix target for submit_task_for_review --
-- in_progress, same active/past Executor shape as T9.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, started_at, created_by)
values
  ('Persoane verificare #334', 'Matricea de persoane', '2027-11-10 09:00:00+00', 'edu', 'local', 'direct', 'in_progress',
   now(), '33400000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at, ended_at, end_reason)
select id, '33400000-0000-0000-0000-000000000003', '33400000-0000-0000-0000-000000000001',
       now() - interval '2 days', now() - interval '1 day', 'replaced'
  from public.tasks where title = 'Persoane verificare #334';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33400000-0000-0000-0000-000000000002', '33400000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Persoane verificare #334';

-- Every fixture id resolved ONCE, as the owner. Never resolve an id inside a
-- format() while a denied persona is logged in (the #328 trap,
-- stack-context.md carry-forwards).
create temp table f334 as
select
  9223372036854775807::bigint as missing_id,
  (select id from public.tasks where title = 'Start fericit #334') as start_happy_task_id,
  (select id from public.tasks where title = 'Trimitere fericita #334') as submit_happy_task_id,
  (select id from public.tasks where title = 'Deja in lucru #334') as already_progress_task_id,
  (select id from public.tasks where title = 'Anulat pentru start #334') as cancelled_start_task_id,
  (select id from public.tasks where title = 'Netrimis pentru verificare #334') as still_todo_task_id,
  (select id from public.tasks where title = 'Anulat pentru verificare #334') as cancelled_submit_task_id,
  (select id from public.tasks where title = 'Umbrela #334') as umbrella_task_id,
  (select id from public.tasks where title = 'Retrimis dupa feedback #334') as resubmit_task_id,
  (select id from public.tasks where title = 'Persoane start #334') as persona_start_task_id,
  (select id from public.tasks where title = 'Persoane verificare #334') as persona_submit_task_id,
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'Start fericit #334' and assignment.ended_at is null) as start_happy_assignment_id,
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'Trimitere fericita #334' and assignment.ended_at is null) as submit_happy_assignment_id,
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'Retrimis dupa feedback #334' and assignment.ended_at is null) as resubmit_assignment_id,
  (select task.returned_to_progress_at from public.tasks as task
    where task.title = 'Retrimis dupa feedback #334') as resubmit_returned_at;
grant select on f334 to authenticated, anon;

-- ==================== 1. API shape and privileges ====================

select has_function('public', 'start_task', array['bigint'],
  'public.start_task exists with the pinned one-parameter signature');
select is(pg_get_function_identity_arguments(
    'public.start_task(bigint)'::regprocedure),
  'p_task_id bigint',
  'start_task exposes no actor parameter -- the actor is always auth.uid()');
select is(pg_get_function_result(
    'public.start_task(bigint)'::regprocedure),
  'tasks', 'start_task returns the affected Task row');
select ok(not (select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public' and procedure.proname = 'start_task'),
  'the public start_task command is a security invoker wrapper');
select ok((select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private' and procedure.proname = 'start_task_impl'),
  'private.start_task_impl runs as owner (security definer)');
select ok(coalesce((
    select bool_and('search_path=""' = any(procedure.proconfig))
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private' and procedure.proname = 'start_task_impl'
  ), false), 'start_task_impl pins an empty search_path');
select ok(has_function_privilege('authenticated',
  'public.start_task(bigint)'::regprocedure, 'execute'),
  'authenticated can execute public.start_task');
select ok(not has_function_privilege('anon',
  'public.start_task(bigint)'::regprocedure, 'execute'),
  'anon cannot execute public.start_task');
select ok(has_function_privilege('authenticated',
  'private.start_task_impl(bigint)'::regprocedure, 'execute'),
  'authenticated can execute private.start_task_impl');

select has_function('public', 'submit_task_for_review', array['bigint'],
  'public.submit_task_for_review exists with the pinned one-parameter signature');
select is(pg_get_function_identity_arguments(
    'public.submit_task_for_review(bigint)'::regprocedure),
  'p_task_id bigint',
  'submit_task_for_review exposes no actor parameter -- the actor is always auth.uid()');
select is(pg_get_function_result(
    'public.submit_task_for_review(bigint)'::regprocedure),
  'tasks', 'submit_task_for_review returns the affected Task row');
select ok(not (select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public' and procedure.proname = 'submit_task_for_review'),
  'the public submit_task_for_review command is a security invoker wrapper');
select ok((select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private' and procedure.proname = 'submit_task_for_review_impl'),
  'private.submit_task_for_review_impl runs as owner (security definer)');
select ok(coalesce((
    select bool_and('search_path=""' = any(procedure.proconfig))
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private' and procedure.proname = 'submit_task_for_review_impl'
  ), false), 'submit_task_for_review_impl pins an empty search_path');
select ok(has_function_privilege('authenticated',
  'public.submit_task_for_review(bigint)'::regprocedure, 'execute'),
  'authenticated can execute public.submit_task_for_review');
select ok(not has_function_privilege('anon',
  'public.submit_task_for_review(bigint)'::regprocedure, 'execute'),
  'anon cannot execute public.submit_task_for_review');
select ok(has_function_privilege('authenticated',
  'private.submit_task_for_review_impl(bigint)'::regprocedure, 'execute'),
  'authenticated can execute private.submit_task_for_review_impl');

-- ==================== 2. start_task happy path -- no notification ====================

select pg_temp.test_login('33400000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.start_task(%s) $$,
  (select start_happy_task_id from f334)),
  'the active Executor may start a todo Task');
reset role;

select is((select format('%s|%s', task.status, (task.started_at is not null)::text)
             from public.tasks as task where task.id = (select start_happy_task_id from f334)),
  'in_progress|true',
  'the Task moves to in_progress with started_at set');
select is((select format('%s|%s|%s|%s|%s|%s', activity.kind, activity.actor_id,
                         (activity.assignment_id = (select start_happy_assignment_id from f334))::text,
                         activity.from_status, activity.to_status,
                         (activity.note is null)::text)
             from public.task_activity as activity
            where activity.task_id = (select start_happy_task_id from f334)),
  'started|33400000-0000-0000-0000-000000000002|true|todo|in_progress|true',
  'the started activity row names the Executor, carries the active Assignment id, and the todo -> in_progress transition');
select is((select count(*) from public.task_activity
            where task_id = (select start_happy_task_id from f334)), 1::bigint,
  'exactly one activity row is written');
select is((select count(*) from public.notifications
            where task_id = (select start_happy_task_id from f334)), 0::bigint,
  'start_task writes NO notification -- the absence is deliberate, not accidental');

-- ==================== 3. submit_task_for_review happy path ====================
-- task_managers picks the CREATOR (the manager, 001) since they are live,
-- activ and not the actor (002).

select pg_temp.test_login('33400000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.submit_task_for_review(%s) $$,
  (select submit_happy_task_id from f334)),
  'the active Executor may submit an in_progress Task for review');
reset role;

select is((select format('%s|%s', task.status, (task.submitted_at is not null)::text)
             from public.tasks as task where task.id = (select submit_happy_task_id from f334)),
  'in_review|true',
  'the Task moves to in_review with submitted_at set');
select is((select format('%s|%s|%s|%s|%s|%s', activity.kind, activity.actor_id,
                         (activity.assignment_id = (select submit_happy_assignment_id from f334))::text,
                         activity.from_status, activity.to_status,
                         (activity.note is null)::text)
             from public.task_activity as activity
            where activity.task_id = (select submit_happy_task_id from f334)),
  'submitted|33400000-0000-0000-0000-000000000002|true|in_progress|in_review|true',
  'the submitted activity row names the Executor, carries the active Assignment id, and the in_progress -> in_review transition');
select is((select count(*) from public.task_activity
            where task_id = (select submit_happy_task_id from f334)), 1::bigint,
  'exactly one activity row is written');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s $$, (select submit_happy_task_id from f334)),
  $$ values ('33400000-0000-0000-0000-000000000001'::uuid) $$,
  'exactly the creator/manager is notified -- the actor (the Executor) hears nothing about their own submission');
select is((select format('%s|%s', notification.title, notification.body)
             from public.notifications as notification
            where notification.task_id = (select submit_happy_task_id from f334)),
  'De verificat: Trimitere fericita #334|Executor 334 a trimis taskul spre verificare.',
  'the manager gets the pinned "De verificat" copy naming the Executor');

-- ==================== 4. Resubmission after a return leaves review_round and
-- returned_to_progress_at untouched ====================

select pg_temp.test_login('33400000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.submit_task_for_review(%s) $$,
  (select resubmit_task_id from f334)),
  'the Executor may resubmit a Task that was previously returned to progress');
reset role;

select is((select format('%s|%s|%s|%s', task.status, (task.submitted_at is not null)::text,
                         task.review_round, (task.returned_to_progress_at = (select resubmit_returned_at from f334))::text)
             from public.tasks as task where task.id = (select resubmit_task_id from f334)),
  'in_review|true|1|true',
  'the resubmit sets submitted_at again but leaves review_round and returned_to_progress_at exactly as they were -- #335/#337''s job, not this command''s');
select is((select format('%s|%s|%s|%s', activity.kind, activity.actor_id,
                         (activity.assignment_id = (select resubmit_assignment_id from f334))::text,
                         activity.from_status || '->' || activity.to_status)
             from public.task_activity as activity
            where activity.task_id = (select resubmit_task_id from f334)),
  'submitted|33400000-0000-0000-0000-000000000002|true|in_progress->in_review',
  'the resubmission writes its own submitted activity row, same shape as a first submission');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s $$, (select resubmit_task_id from f334)),
  $$ values ('33400000-0000-0000-0000-000000000001'::uuid) $$,
  'the resubmission notifies the creator/manager exactly like a first submission');

-- ==================== 5. Wrong-state rejections ====================

select pg_temp.test_login('33400000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.start_task(%s) $$,
  (select already_progress_task_id from f334)),
  'PT409', 'task_not_todo',
  'a Task already in_progress cannot be started again');
select throws_ok(format($$ select public.start_task(%s) $$,
  (select cancelled_start_task_id from f334)),
  'PT409', 'task_not_todo',
  'a cancelled Task cannot be started -- the same reason covers every non-todo status');
select throws_ok(format($$ select public.submit_task_for_review(%s) $$,
  (select still_todo_task_id from f334)),
  'PT409', 'task_not_in_progress',
  'a Task still in todo cannot be submitted for review -- it was never started');
select throws_ok(format($$ select public.submit_task_for_review(%s) $$,
  (select cancelled_submit_task_id from f334)),
  'PT409', 'task_not_in_progress',
  'a cancelled Task cannot be submitted for review -- the same reason covers every non-in_progress status');
reset role;

-- An unknown Task id is PT404, never a hint of a PT400/PT409 on a target
-- that does not exist (stack-context.md carry-forward: no step-1 null check).
select pg_temp.test_login('33400000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.start_task(%s) $$,
  (select missing_id from f334)), 'PT404', 'task_not_found',
  'an unknown Task id is not found for start_task');
select throws_ok(format($$ select public.submit_task_for_review(%s) $$,
  (select missing_id from f334)), 'PT404', 'task_not_found',
  'an unknown Task id is not found for submit_task_for_review');
reset role;

-- ==================== 6. The Umbrella case: no dedicated reason ====================
-- An Umbrella never has an Executor, so both commands fall straight through
-- to private.require_task_executor's ordinary 42501 task_executor_forbidden
-- -- exactly the manager reads this migration's header for.

select pg_temp.test_login('33400000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.start_task(%s) $$,
  (select umbrella_task_id from f334)),
  '42501', 'task_executor_forbidden',
  'an Umbrella has no Executor -- start_task falls through to the ordinary executor check, no dedicated Umbrella reason');
select throws_ok(format($$ select public.submit_task_for_review(%s) $$,
  (select umbrella_task_id from f334)),
  '42501', 'task_executor_forbidden',
  'the same is true of submit_task_for_review on an Umbrella');
reset role;

-- ==================== 7. Persona denials ====================
-- Only the Task's own live active Executor may start or submit it. Everyone
-- else is 42501 -- and which 42501 depends on how far they get: the gate
-- answers task_command_forbidden, the authority check task_executor_forbidden.

select pg_temp.test_login('33400000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.start_task(%s) $$,
  (select persona_start_task_id from f334)), '42501', 'task_executor_forbidden',
  'the Task''s own manager cannot start it for the Executor -- managing is not executing');
reset role;

select pg_temp.test_login('33400000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.start_task(%s) $$,
  (select persona_start_task_id from f334)), '42501', 'task_executor_forbidden',
  'a PAST Executor still reads the Task (can_read_task) but their ended Assignment grants nothing');
reset role;

select pg_temp.test_login('33400000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.start_task(%s) $$,
  (select persona_start_task_id from f334)), '42501', 'task_command_forbidden',
  'a deactivated BC holding a still-valid level-6 token is stopped at the gate');
reset role;

select pg_temp.test_login('33400000-0000-0000-0000-000000000005',
  jsonb_build_object('provider', 'email'));
select throws_ok(format($$ select public.start_task(%s) $$,
  (select persona_start_task_id from f334)), '42501', 'task_command_forbidden',
  'a real uid without organisation claims is stopped at the gate too');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(format($$ select public.start_task(%s) $$,
  (select persona_start_task_id from f334)),
  '42501', 'permission denied for function start_task',
  'anon cannot execute start_task at all -- the literal grant denial, not a gate that happens to raise 42501');
reset role;

select pg_temp.test_login('33400000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.submit_task_for_review(%s) $$,
  (select persona_submit_task_id from f334)), '42501', 'task_executor_forbidden',
  'the Task''s own manager cannot submit it for the Executor -- managing is not executing');
reset role;

select pg_temp.test_login('33400000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.submit_task_for_review(%s) $$,
  (select persona_submit_task_id from f334)), '42501', 'task_executor_forbidden',
  'a PAST Executor cannot submit it either');
reset role;

select pg_temp.test_login('33400000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.submit_task_for_review(%s) $$,
  (select persona_submit_task_id from f334)), '42501', 'task_command_forbidden',
  'a deactivated BC holding a still-valid level-6 token is stopped at the gate too');
reset role;

select pg_temp.test_login('33400000-0000-0000-0000-000000000005',
  jsonb_build_object('provider', 'email'));
select throws_ok(format($$ select public.submit_task_for_review(%s) $$,
  (select persona_submit_task_id from f334)), '42501', 'task_command_forbidden',
  'a real uid without organisation claims is stopped at the gate too');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(format($$ select public.submit_task_for_review(%s) $$,
  (select persona_submit_task_id from f334)),
  '42501', 'permission denied for function submit_task_for_review',
  'anon cannot execute submit_task_for_review at all');
reset role;

-- ==================== 8. A rejected call writes nothing ====================

select is((select count(*) from public.task_activity
            where task_id in (select already_progress_task_id from f334)
               or task_id in (select cancelled_start_task_id from f334)
               or task_id in (select still_todo_task_id from f334)
               or task_id in (select cancelled_submit_task_id from f334)
               or task_id in (select umbrella_task_id from f334)
               or task_id in (select persona_start_task_id from f334)
               or task_id in (select persona_submit_task_id from f334)), 0::bigint,
  'none of the wrong-state, Umbrella, or persona-denied calls wrote an activity row');
select is((select count(*) from public.notifications
            where task_id in (select already_progress_task_id from f334)
               or task_id in (select cancelled_start_task_id from f334)
               or task_id in (select still_todo_task_id from f334)
               or task_id in (select cancelled_submit_task_id from f334)
               or task_id in (select umbrella_task_id from f334)
               or task_id in (select persona_start_task_id from f334)
               or task_id in (select persona_submit_task_id from f334)), 0::bigint,
  'none of them wrote a notification either');
select is((select format('%s|%s', task.status, count(*) filter (where assignment.ended_at is null))
             from public.tasks as task
             left join public.task_assignments as assignment on assignment.task_id = task.id
            where task.id = (select persona_start_task_id from f334)
            group by task.status),
  'todo|1', 'the persona start Task is untouched -- still todo, its one active Assignment intact');
select is((select format('%s|%s', task.status, count(*) filter (where assignment.ended_at is null))
             from public.tasks as task
             left join public.task_assignments as assignment on assignment.task_id = task.id
            where task.id = (select persona_submit_task_id from f334)
            group by task.status),
  'in_progress|1', 'the persona submit Task is untouched -- still in_progress, its one active Assignment intact');

-- ==================== 9. The command is the only write path ====================

select pg_temp.test_login('33400000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ insert into public.task_activity (task_id, kind, actor_id, details)
  values (%s, 'started', '33400000-0000-0000-0000-000000000002', '{}'::jsonb) $$,
  (select persona_start_task_id from f334)),
  '42501', null, 'even the Task''s manager cannot fake a started activity row by inserting directly');
reset role;

-- ==================== 10. Lock held while start_task runs ====================
-- Sections 2-4 already prove the transition itself; this probe proves WHERE
-- the serialization point is -- the tasks row FOR UPDATE taken before the
-- Assignment is even read, the Executor's own live profile row held FOR
-- SHARE by private.require_task_executor, and that same helper's FOR UPDATE
-- on the active Assignment.
--
-- Works on COMMITTED fixtures, created and removed through their own dblink
-- connection: pg_temp test sessions commit for real, so nothing this suite's
-- own rolled-back transaction created would be visible to them.
select extensions.dblink_connect('tp_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));

select extensions.dblink_exec('tp_setup', $$
  set session_replication_role = 'replica';
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#334 committed%');
  set session_replication_role = 'origin';
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#334 committed%')
      or member_id in ('33400000-0000-0000-0000-000000000021',
                       '33400000-0000-0000-0000-000000000022');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%#334 committed%');
  delete from public.tasks where title like '%#334 committed%';
  delete from public.member_departments where member_id in (
    '33400000-0000-0000-0000-000000000021', '33400000-0000-0000-0000-000000000022');
  delete from auth.users where id in (
    '33400000-0000-0000-0000-000000000021', '33400000-0000-0000-0000-000000000022');

  insert into auth.users (id, email) values
    ('33400000-0000-0000-0000-000000000021', 'probe.manager.334@test.local'),
    ('33400000-0000-0000-0000-000000000022', 'probe.executor.334@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('33400000-0000-0000-0000-000000000021', 'Probe Manager 334', 'probe.manager.334@test.local', 'bce', 'activ'),
    ('33400000-0000-0000-0000-000000000022', 'Probe Executor 334', 'probe.executor.334@test.local', 'voluntar', 'activ');
  insert into public.member_departments (member_id, dept_id) values
    ('33400000-0000-0000-0000-000000000021', 'edu'),
    ('33400000-0000-0000-0000-000000000022', 'edu');

  insert into public.tasks
    (title, description, deadline, dept_id, audience, assignment_mode, status, created_by)
  values
    ('Lock probe start #334 committed', 'Sonda', '2027-12-01 09:00:00+00', 'edu', 'local', 'direct', 'todo',
     '33400000-0000-0000-0000-000000000021');

  insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
  select id, '33400000-0000-0000-0000-000000000022'::uuid, '33400000-0000-0000-0000-000000000021'::uuid, now()
    from public.tasks where title = 'Lock probe start #334 committed';
$$);

-- Resolved as the owner, before any persona logs in (the #328 trap again).
create temp table r334 as
select (select id from public.tasks where title = 'Lock probe start #334 committed') as probe_task_id;
grant select on r334 to authenticated;

select extensions.dblink_connect('tp_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('tp_lock', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('tp_lock', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '33400000-0000-0000-0000-000000000022', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'voluntar', 'member_level', 1,
      'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text, true)
$$) as remote_claims(setting text);
select extensions.dblink_exec('tp_lock', 'set local role authenticated');
select * from extensions.dblink('tp_lock', format($$
  select (public.start_task(%s)).status::text
$$, (select probe_task_id from r334))) as locked_start(status text);

select ok(coalesce((
  select row_lock.modes && array['For Update', 'Update', 'No Key Update']
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_task_id from r334)
), false), 'start_task holds the target Task row exclusively locked while it runs -- the tasks-row-first serialization point every command in the wave shares');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.profiles') as row_lock
    join public.profiles as profile on profile.ctid = row_lock.locked_row
   where profile.id = '33400000-0000-0000-0000-000000000022'
), false), 'start_task holds the Executor''s own live profile row FOR SHARE (private.require_task_executor''s discipline)');
select ok(coalesce((
  select bool_or(row_lock.modes && array['For Update', 'Update', 'No Key Update'])
    from extensions.pgrowlocks('public.task_assignments') as row_lock
    join public.task_assignments as assignment on assignment.ctid = row_lock.locked_row
   where assignment.task_id = (select probe_task_id from r334)
     and assignment.member_id = '33400000-0000-0000-0000-000000000022'
), false), 'the Executor''s own active Assignment row is locked FOR UPDATE by private.require_task_executor');

select extensions.dblink_exec('tp_lock', 'rollback');
select extensions.dblink_disconnect('tp_lock');

select extensions.dblink_exec('tp_setup', $$
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#334 committed%');
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#334 committed%')
      or member_id in ('33400000-0000-0000-0000-000000000021',
                       '33400000-0000-0000-0000-000000000022');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%#334 committed%');
  delete from public.tasks where title like '%#334 committed%';
  delete from public.member_departments where member_id in (
    '33400000-0000-0000-0000-000000000021', '33400000-0000-0000-0000-000000000022');
  delete from auth.users where id in (
    '33400000-0000-0000-0000-000000000021', '33400000-0000-0000-0000-000000000022');
$$);
select extensions.dblink_disconnect('tp_setup');

select * from finish();
rollback;
