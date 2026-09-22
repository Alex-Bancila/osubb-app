-- #342: public.assign_task_executor -- a manager assigns any live active
-- Member as the Executor of a direct Task that currently has none.
--
-- The sequencing point this suite exists to prove (task-6-brief.md): a
-- direct Task has no Candidate Queue (ADR-0007), so when its one Executor
-- gives up (#332's give_up_task, not yet built) the Task is stuck with
-- nobody unless a manager can hand it to someone directly. Section 3 below
-- fixtures that end state by hand -- an owner-ended Assignment,
-- end_reason = 'gave_up' -- and shows assign_task_executor fills the empty
-- slot with exactly one new active Assignment.
--
-- Eligibility (ADR-0007's 2026-09-10 amendment, binding): ANY live activ
-- Member may be assigned, regardless of Department, Team, Project or role
-- level -- Audience governs public Candidate Queues only. Section 2's happy
-- path deliberately assigns a Member of an unrelated Department ('pr') to an
-- 'edu' Task to prove this explicitly.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(57);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('34200000-0000-0000-0000-000000000001', 'manager.342@test.local'),
  ('34200000-0000-0000-0000-000000000002', 'outsider.342@test.local'),
  ('34200000-0000-0000-0000-000000000003', 'team.ordinary.342@test.local'),
  ('34200000-0000-0000-0000-000000000004', 'self.assignee.342@test.local'),
  ('34200000-0000-0000-0000-000000000005', 'executor.existing.342@test.local'),
  ('34200000-0000-0000-0000-000000000006', 'executor.gaveup.342@test.local'),
  ('34200000-0000-0000-0000-000000000007', 'inactive.member.342@test.local'),
  ('34200000-0000-0000-0000-000000000008', 'inactive.bc.342@test.local'),
  ('34200000-0000-0000-0000-000000000009', 'claimless.342@test.local'),
  ('34200000-0000-0000-0000-000000000010', 'indep.team.342@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('34200000-0000-0000-0000-000000000001', 'Manager 342', 'manager.342@test.local', 'bce', 'activ'),
  ('34200000-0000-0000-0000-000000000002', 'Outsider 342', 'outsider.342@test.local', 'voluntar', 'activ'),
  ('34200000-0000-0000-0000-000000000003', 'Membru Echipa Ordinar 342', 'team.ordinary.342@test.local', 'voluntar', 'activ'),
  ('34200000-0000-0000-0000-000000000004', 'Autoasignare 342', 'self.assignee.342@test.local', 'voluntar', 'activ'),
  ('34200000-0000-0000-0000-000000000005', 'Executor Existent 342', 'executor.existing.342@test.local', 'voluntar', 'activ'),
  ('34200000-0000-0000-0000-000000000006', 'Executor Renuntat 342', 'executor.gaveup.342@test.local', 'voluntar', 'activ'),
  ('34200000-0000-0000-0000-000000000007', 'Membru Inactiv 342', 'inactive.member.342@test.local', 'voluntar', 'inactiv'),
  ('34200000-0000-0000-0000-000000000008', 'BC Inactiv 342', 'inactive.bc.342@test.local', 'bc', 'inactiv'),
  ('34200000-0000-0000-0000-000000000009', 'Fara Claimuri 342', 'claimless.342@test.local', 'voluntar', 'activ'),
  ('34200000-0000-0000-0000-000000000010', 'Membru Echipa Independenta 342', 'indep.team.342@test.local', 'voluntar', 'activ');

insert into public.member_departments (member_id, dept_id) values
  ('34200000-0000-0000-0000-000000000001', 'edu'),
  ('34200000-0000-0000-0000-000000000002', 'pr'),
  ('34200000-0000-0000-0000-000000000005', 'edu'),
  ('34200000-0000-0000-0000-000000000006', 'edu');

insert into public.teams (id, name, dept_id) values
  ('t-342-dt', 'Echipa Departamentala 342', 'edu'),
  ('t-342-ind', 'Echipa Independenta 342', null);

insert into public.team_members (team_id, member_id) values
  ('t-342-dt', '34200000-0000-0000-0000-000000000003'),
  ('t-342-dt', '34200000-0000-0000-0000-000000000004'),
  ('t-342-ind', '34200000-0000-0000-0000-000000000010');

-- ==================== Tasks ====================

-- The happy path: a direct Task with no Executor, assigned to a Member of an
-- unrelated Department -- eligibility is not Origin-scoped.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, created_by)
values
  ('Asignare directa #342', 'Fara executant', '2027-05-01 09:00:00+00', 'edu', 'local', 'direct', 'todo',
   '34200000-0000-0000-0000-000000000001');

-- A manager assigning themselves: private.notify drops the actor, so this
-- must produce zero notifications.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, created_by)
values
  ('Manager se autoasigneaza #342', 'Autoasignare', '2027-05-02 09:00:00+00', 'edu', 'local', 'direct', 'todo',
   '34200000-0000-0000-0000-000000000001');

-- Public Task: no direct-mode Executor to assign.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, queue_opened_at, created_by)
values
  ('Public #342', 'Coada publica', '2027-05-03 09:00:00+00', 'edu', 'org', 'public', 'todo', now(),
   '34200000-0000-0000-0000-000000000001');

-- Already has an active Executor.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, created_by)
values
  ('Deja asignat #342', 'Are deja executant', '2027-05-04 09:00:00+00', 'edu', 'local', 'direct', 'todo',
   '34200000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '34200000-0000-0000-0000-000000000005', '34200000-0000-0000-0000-000000000001', now()
  from public.tasks where title = 'Deja asignat #342';

-- The remedy scenario (#342's reason for existing): the Executor gave up,
-- fixtured directly since #332's give_up_task does not exist yet.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, created_by)
values
  ('Executant a renuntat #342', 'Are nevoie de un nou executant', '2027-05-05 09:00:00+00', 'edu', 'local', 'direct', 'todo',
   '34200000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at, ended_at, end_reason)
select id, '34200000-0000-0000-0000-000000000006', '34200000-0000-0000-0000-000000000001', now() - interval '2 days',
       now() - interval '1 hour', 'gave_up'
  from public.tasks where title = 'Executant a renuntat #342';

-- A direct Task with no Executor, used only for the invalid-executor test.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, created_by)
values
  ('Tinta executant invalid #342', 'Fara executant', '2027-05-06 09:00:00+00', 'edu', 'local', 'direct', 'todo',
   '34200000-0000-0000-0000-000000000001');

-- An Umbrella: null audience/assignment_mode/difficulty/rating (#315 shape).
insert into public.tasks
  (title, dept_id, kind, audience, assignment_mode, difficulty, rating, status, created_by)
values
  ('Umbrela #342', 'edu', 'umbrella', null, null, null, null, 'todo',
   '34200000-0000-0000-0000-000000000001');

-- A terminal Task: completed direct Tasks require both evaluation inputs
-- (tasks_evaluation_inputs_ck) and a non-null completed_at.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, difficulty, rating, status, completed_at, created_by)
values
  ('Terminal #342', 'Incheiat', '2027-05-07 09:00:00+00', 'edu', 'local', 'direct', 3, 4, 'completed', now(),
   '34200000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at, ended_at, end_reason)
select id, '34200000-0000-0000-0000-000000000005', '34200000-0000-0000-0000-000000000001', now() - interval '2 days',
       now(), 'completed'
  from public.tasks where title = 'Terminal #342';

-- Gate Task: origin is a Department Team, read via R4 by its plain team
-- members, but manage authority still rests on the parent Department
-- (private.require_origin_manager) -- neither team member below manages it.
insert into public.tasks
  (title, description, deadline, team_id, audience, assignment_mode, status, created_by)
values
  ('Poarta echipa #342', 'Poarta', '2027-05-08 09:00:00+00', 't-342-dt', 'local', 'direct', 'todo',
   '34200000-0000-0000-0000-000000000001');

-- Independent-Team Task: ANY active member of an Independent Team manages
-- it (private.can_manage_origin), so member 010 is a legitimate manager here.
insert into public.tasks
  (title, description, deadline, team_id, audience, assignment_mode, status, created_by)
values
  ('Echipa independenta #342', 'Task independent', '2027-05-09 09:00:00+00', 't-342-ind', 'local', 'direct', 'todo',
   '34200000-0000-0000-0000-000000000001');

-- Every fixture id resolved ONCE, as the owner. Never resolve an id inside a
-- format() while a denied persona is logged in (the #328 trap,
-- stack-context.md carry-forwards).
create temp table f342 as
select
  9223372036854775807::bigint as missing_id,
  (select id from public.tasks where title = 'Asignare directa #342') as direct_task_id,
  (select id from public.tasks where title = 'Manager se autoasigneaza #342') as self_task_id,
  (select id from public.tasks where title = 'Public #342') as public_task_id,
  (select id from public.tasks where title = 'Deja asignat #342') as already_assigned_task_id,
  (select id from public.tasks where title = 'Executant a renuntat #342') as gave_up_task_id,
  (select id from public.tasks where title = 'Tinta executant invalid #342') as invalid_target_task_id,
  (select id from public.tasks where title = 'Umbrela #342') as umbrella_task_id,
  (select id from public.tasks where title = 'Terminal #342') as terminal_task_id,
  (select id from public.tasks where title = 'Poarta echipa #342') as gate_task_id,
  (select id from public.tasks where title = 'Echipa independenta #342') as indep_task_id;
grant select on f342 to authenticated, anon;

-- ==================== 1. API shape and privileges ====================

select has_function('public', 'assign_task_executor', array['bigint', 'uuid'],
  'public.assign_task_executor exists with the pinned two-parameter signature');
select is(pg_get_function_identity_arguments(
    'public.assign_task_executor(bigint, uuid)'::regprocedure),
  'p_task_id bigint, p_member_id uuid',
  'assign_task_executor exposes no actor parameter -- the actor is always auth.uid()');
select is(pg_get_function_result(
    'public.assign_task_executor(bigint, uuid)'::regprocedure),
  'tasks', 'assign_task_executor returns the affected Task row');
select ok(not (select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public' and procedure.proname = 'assign_task_executor'),
  'the public command is a security invoker wrapper');
select ok((select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private' and procedure.proname = 'assign_task_executor_impl'),
  'private.assign_task_executor_impl runs as owner (security definer)');
select ok(coalesce((
    select bool_and('search_path=""' = any(procedure.proconfig))
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private' and procedure.proname = 'assign_task_executor_impl'
  ), false), 'assign_task_executor_impl pins an empty search_path');
select ok(has_function_privilege('authenticated',
  'public.assign_task_executor(bigint, uuid)'::regprocedure, 'execute'),
  'authenticated can execute public.assign_task_executor');
select ok(not has_function_privilege('anon',
  'public.assign_task_executor(bigint, uuid)'::regprocedure, 'execute'),
  'anon cannot execute public.assign_task_executor');
select ok(has_function_privilege('authenticated',
  'private.assign_task_executor_impl(bigint, uuid)'::regprocedure, 'execute'),
  'authenticated can execute private.assign_task_executor_impl');

-- ==================== 2. Happy path: any active Member is eligible ====================

select pg_temp.test_login('34200000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.assign_task_executor(%s, '34200000-0000-0000-0000-000000000002') $$,
  (select direct_task_id from f342)),
  'the manager assigns a Member of an unrelated Department (pr, not edu) -- eligibility is not Origin-scoped');
reset role;

select is((select format('%s|%s|%s', count(*), count(*) filter (where ended_at is null), count(*) filter (
    where member_id = '34200000-0000-0000-0000-000000000002' and assigned_by = '34200000-0000-0000-0000-000000000001'))
    from public.task_assignments where task_id = (select direct_task_id from f342)),
  '1|1|1', 'exactly one active Assignment is created, for the assigned outsider, assigned_by the manager');
select is((select format('%s|%s|%s|%s|%s', activity.kind, activity.actor_id,
                         (activity.assignment_id is not null)::text, activity.details ->> 'via',
                         activity.details ->> 'member_id')
             from public.task_activity as activity
            where activity.task_id = (select direct_task_id from f342)),
  'executor_assigned|34200000-0000-0000-0000-000000000001|true|assign|34200000-0000-0000-0000-000000000002',
  'one executor_assigned activity row is written: assignment_id set, details.via = assign, details.member_id = the new Executor');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s $$, (select direct_task_id from f342)),
  $$ values ('34200000-0000-0000-0000-000000000002'::uuid) $$,
  'exactly the new Executor is notified -- the manager, as actor, is not');
select is((select format('%s|%s', notification.title, notification.body)
             from public.notifications as notification
            where notification.task_id = (select direct_task_id from f342)),
  'Task nou: Asignare directa #342|Ți-a fost atribuit acest task. Deadline: 01.05.2027 12:00.',
  'the new-Executor notification uses the pinned Romanian copy from open_task_assignment');
select is((select status from public.tasks where id = (select direct_task_id from f342)),
  'todo', 'assigning an Executor does not itself change the Task''s status');

-- A manager assigning themselves gets nothing back (private.notify drops the actor).
select pg_temp.test_login('34200000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.assign_task_executor(%s, '34200000-0000-0000-0000-000000000001') $$,
  (select self_task_id from f342)),
  'the manager assigns themselves as Executor');
reset role;

select is((select count(*) from public.task_assignments
            where task_id = (select self_task_id from f342)
              and member_id = '34200000-0000-0000-0000-000000000001'
              and ended_at is null), 1::bigint,
  'the self-assignment still creates the Assignment');
select is((select count(*) from public.task_activity
            where task_id = (select self_task_id from f342) and kind = 'executor_assigned'), 1::bigint,
  'the self-assignment still writes its executor_assigned activity row');
select is((select count(*) from public.notifications
            where task_id = (select self_task_id from f342)), 0::bigint,
  'a manager assigning themselves gets no notification -- private.notify drops the actor from every recipient set');

-- ==================== 3. The remedy: an Executor who gave up ====================

select pg_temp.test_login('34200000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.assign_task_executor(%s, '34200000-0000-0000-0000-000000000002') $$,
  (select gave_up_task_id from f342)),
  'a direct Task whose Executor gave up accepts a new one -- the sequencing point #342 exists for');
reset role;

select is((select format('%s|%s', count(*), count(*) filter (where ended_at is null))
    from public.task_assignments where task_id = (select gave_up_task_id from f342)),
  '2|1', 'the Task now has two Assignment rows total, exactly one of them active -- the new one');
select is((select member_id from public.task_assignments
            where task_id = (select gave_up_task_id from f342) and ended_at is null),
  '34200000-0000-0000-0000-000000000002',
  'the new active Assignment belongs to the newly assigned Member, not the one who gave up');
select is((select end_reason from public.task_assignments
            where task_id = (select gave_up_task_id from f342)
              and member_id = '34200000-0000-0000-0000-000000000006'),
  'gave_up', 'the original gave-up Assignment is untouched -- still ended, still end_reason gave_up');

-- ==================== 4. State preconditions ====================

select pg_temp.test_login('34200000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.assign_task_executor(%s, '34200000-0000-0000-0000-000000000002') $$,
  (select public_task_id from f342)), 'PT409', 'task_not_direct',
  'a public Task has a Candidate Queue, not a manager-assigned Executor');
select throws_ok(format($$ select public.assign_task_executor(%s, '34200000-0000-0000-0000-000000000002') $$,
  (select already_assigned_task_id from f342)), 'PT409', 'task_already_assigned',
  'a direct Task with an active Executor already refuses a second one');
select throws_ok(format($$ select public.assign_task_executor(%s, '34200000-0000-0000-0000-000000000007') $$,
  (select already_assigned_task_id from f342)), 'PT409', 'task_already_assigned',
  'a call that is both invalid-member AND wrong-state answers the state conflict, not invalid_executor -- the pinned ordering decision');
select throws_ok(format($$ select public.assign_task_executor(%s, '34200000-0000-0000-0000-000000000007') $$,
  (select invalid_target_task_id from f342)), 'PT400', 'invalid_executor',
  'assigning an inactiv profile is rejected by private.open_task_assignment');
select throws_ok(format($$ select public.assign_task_executor(%s, '34200000-0000-0000-0000-000000000002') $$,
  (select umbrella_task_id from f342)), 'PT409', 'task_is_umbrella',
  'an Umbrella has no Executor of its own to assign');
select throws_ok(format($$ select public.assign_task_executor(%s, '34200000-0000-0000-0000-000000000002') $$,
  (select terminal_task_id from f342)), 'PT409', 'task_terminal',
  'a terminal Task cannot receive a new Executor');
select throws_ok(format($$ select public.assign_task_executor(%s, '34200000-0000-0000-0000-000000000002') $$,
  (select missing_id from f342)), 'PT404', 'task_not_found',
  'an unknown Task is not found, not forbidden');
reset role;

select is((select count(*) from public.task_activity
            where task_id in (select public_task_id from f342)
               or task_id in (select already_assigned_task_id from f342)
               or task_id in (select invalid_target_task_id from f342)
               or task_id in (select umbrella_task_id from f342)
               or task_id in (select terminal_task_id from f342)), 0::bigint,
  'none of the five rejected state/input-precondition calls wrote an activity row');
select is((select count(*) from public.notifications
            where task_id in (select public_task_id from f342)
               or task_id in (select already_assigned_task_id from f342)
               or task_id in (select invalid_target_task_id from f342)
               or task_id in (select umbrella_task_id from f342)
               or task_id in (select terminal_task_id from f342)), 0::bigint,
  'none of the five rejected state/input-precondition calls wrote a notification');
select is((select count(*) from public.task_assignments
            where task_id = (select already_assigned_task_id from f342) and ended_at is null), 1::bigint,
  'the already-assigned Task still has exactly its one original active Assignment, untouched by the rejected calls');
select is((select count(*) from public.task_assignments
            where task_id = (select invalid_target_task_id from f342)), 0::bigint,
  'the invalid-executor target Task still has no Assignment at all');

-- ==================== 5. Persona denials ====================

select pg_temp.test_login('34200000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '["t-342-dt"]'::jsonb));
select throws_ok(format($$ select public.assign_task_executor(%s, '34200000-0000-0000-0000-000000000002') $$,
  (select gate_task_id from f342)), '42501', 'task_manage_forbidden',
  'a plain Department-Team member reads the Task (R4) but does not manage it -- authority rests on the parent Department');
reset role;

select pg_temp.test_login('34200000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '["t-342-dt"]'::jsonb));
select throws_ok(format($$ select public.assign_task_executor(%s, '34200000-0000-0000-0000-000000000004') $$,
  (select gate_task_id from f342)), '42501', 'task_manage_forbidden',
  'the Member who would become the Executor cannot assign themselves -- being the target grants no authority');
reset role;

select pg_temp.test_login('34200000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.assign_task_executor(%s, '34200000-0000-0000-0000-000000000002') $$,
  (select gate_task_id from f342)), '42501', 'task_command_forbidden',
  'a deactivated BC holding a still-valid level-6 token cannot even reach the gate');
reset role;

select pg_temp.test_login('34200000-0000-0000-0000-000000000009',
  jsonb_build_object('provider', 'email'));
select throws_ok(format($$ select public.assign_task_executor(%s, '34200000-0000-0000-0000-000000000002') $$,
  (select gate_task_id from f342)), '42501', 'task_command_forbidden',
  'a real uid without organisation claims cannot assign an Executor');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(format($$ select public.assign_task_executor(%s, '34200000-0000-0000-0000-000000000002') $$,
  (select gate_task_id from f342)),
  '42501', 'permission denied for function assign_task_executor',
  'anon cannot execute assign_task_executor at all -- the literal grant denial, not a gate that happens to raise 42501');
reset role;

select is((select count(*) from public.task_activity
            where task_id = (select gate_task_id from f342)), 0::bigint,
  'none of the five denied personas wrote an activity row on the Gate Task');
select is((select count(*) from public.notifications
            where task_id = (select gate_task_id from f342)), 0::bigint,
  'none of the five denied personas wrote a notification');
select is((select count(*) from public.task_assignments
            where task_id = (select gate_task_id from f342)), 0::bigint,
  'the Gate Task still has no Assignment at all -- none of the five denied calls touched it');

-- ==================== 6. Independent-Team member manages their own Team's Task ====================

select pg_temp.test_login('34200000-0000-0000-0000-000000000010', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '["t-342-ind"]'::jsonb));
select lives_ok(format($$ select public.assign_task_executor(%s, '34200000-0000-0000-0000-000000000002') $$,
  (select indep_task_id from f342)),
  'any active member of an Independent Team manages its own Task -- ADR-0007''s Independent-Team branch admits every member, not just BCE');
reset role;

select is((select format('%s|%s', member_id, assigned_by) from public.task_assignments
            where task_id = (select indep_task_id from f342) and ended_at is null),
  '34200000-0000-0000-0000-000000000002|34200000-0000-0000-0000-000000000010',
  'the Independent-Team member''s assignment is recorded with them as assigned_by');
select is((select details ->> 'via' from public.task_activity
            where task_id = (select indep_task_id from f342) and kind = 'executor_assigned'),
  'assign', 'the Independent-Team-origin assignment still carries details.via = assign');

-- ==================== 7. The command is the only write path ====================

select pg_temp.test_login('34200000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ insert into public.task_assignments (task_id, member_id, assigned_by)
  values (%s, '34200000-0000-0000-0000-000000000002', '34200000-0000-0000-0000-000000000001') $$,
  (select invalid_target_task_id from f342)),
  '42501', null, 'even the Task''s own manager cannot open an Assignment by inserting into task_assignments directly');
select throws_ok(format($$ insert into public.task_activity (task_id, kind, actor_id, details)
  values (%s, 'executor_assigned', '34200000-0000-0000-0000-000000000001', '{}'::jsonb) $$,
  (select invalid_target_task_id from f342)),
  '42501', null, 'even the Task''s own manager cannot write an executor_assigned activity row by inserting directly');
reset role;

-- ==================== 8. Locks held while the command runs ====================
-- Mirrors set_task_queue.test.sql section 7: the tasks row FOR UPDATE, taken
-- before any Assignment state is read, and the manager's own live profile row
-- plus their Origin membership row held FOR SHARE (the #343/#390 discipline
-- behind private.require_origin_manager). Runs on COMMITTED fixtures over its
-- own dblink connection, cleaned up before the suite ends.
select extensions.dblink_connect('ate_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));

select extensions.dblink_exec('ate_setup', $$
  insert into auth.users (id, email) values
    ('34200000-0000-0000-0000-000000000021', 'lock.manager.342@test.local'),
    ('34200000-0000-0000-0000-000000000022', 'lock.assignee.342@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('34200000-0000-0000-0000-000000000021', 'Lock Manager 342', 'lock.manager.342@test.local', 'bce', 'activ'),
    ('34200000-0000-0000-0000-000000000022', 'Lock Assignee 342', 'lock.assignee.342@test.local', 'voluntar', 'activ');
  insert into public.member_departments (member_id, dept_id) values
    ('34200000-0000-0000-0000-000000000021', 'edu');
  insert into public.tasks
    (title, description, deadline, dept_id, audience, assignment_mode, status, created_by)
  values
    ('Lock probe #342 committed', 'Sonda', '2027-06-01 09:00:00+00', 'edu', 'local', 'direct', 'todo',
     '34200000-0000-0000-0000-000000000021');
$$);

create temp table r342 as
select (select id from public.tasks where title = 'Lock probe #342 committed') as probe_task_id;
grant select on r342 to authenticated;

select extensions.dblink_connect('ate_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('ate_lock', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('ate_lock', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '34200000-0000-0000-0000-000000000021', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'bce', 'member_level', 5,
      'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text, true)
$$) as remote_claims(setting text);
select extensions.dblink_exec('ate_lock', 'set local role authenticated');
select * from extensions.dblink('ate_lock', format($$
  select (public.assign_task_executor(%s, '34200000-0000-0000-0000-000000000022')).status::text
$$, (select probe_task_id from r342))) as locked_assign(status text);

select ok(coalesce((
  select row_lock.modes && array['For Update', 'Update', 'No Key Update']
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_task_id from r342)
), false), 'assign_task_executor holds the target Task row exclusively locked while it runs');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.profiles') as row_lock
    join public.profiles as profile on profile.ctid = row_lock.locked_row
   where profile.id = '34200000-0000-0000-0000-000000000021'
), false), 'assign_task_executor holds the manager''s own live profile row FOR SHARE');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.group_members') as row_lock
    join public.group_members as membership on membership.ctid = row_lock.locked_row
    join public.groups as authority_group on authority_group.id = membership.group_id
   where membership.member_id = '34200000-0000-0000-0000-000000000021'
     and authority_group.legacy_dept_id = 'edu'
), false), 'assign_task_executor holds the manager''s Group roster row FOR SHARE too (require_origin_manager''s discipline)');

select extensions.dblink_exec('ate_lock', 'rollback');
select extensions.dblink_disconnect('ate_lock');

-- ---- cleanup: this suite leaves no committed trace ----
select extensions.dblink_exec('ate_setup', $$
  set session_replication_role = 'replica';
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#342 committed%');
  set session_replication_role = 'origin';
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#342 committed%')
      or member_id in ('34200000-0000-0000-0000-000000000021', '34200000-0000-0000-0000-000000000022')
      or link in (select '/tracker/' || id::text from public.tasks
                   where title like '%#342 committed%');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%#342 committed%');
  delete from public.tasks where title like '%#342 committed%';
  delete from public.member_departments where member_id in (
    '34200000-0000-0000-0000-000000000021', '34200000-0000-0000-0000-000000000022');
  delete from auth.users where id in (
    '34200000-0000-0000-0000-000000000021', '34200000-0000-0000-0000-000000000022');
$$);
select extensions.dblink_disconnect('ate_setup');

select is((select count(*) from public.tasks where title like '%#342 committed%'), 0::bigint,
  'the committed lock-probe fixtures are removed again -- this suite leaves no trace');
select is((select count(*) from auth.users
            where id in ('34200000-0000-0000-0000-000000000021',
                         '34200000-0000-0000-0000-000000000022')), 0::bigint,
  'the two committed lock-probe fixture accounts are removed too, not just their Task');
select is((select count(*) from public.notifications
            where link = format('/tracker/%s', (select probe_task_id from r342))), 0::bigint,
  'no notification survives with a nulled task_id after the committed Task is deleted');


-- #521: Group authority regression matrix.
\ir _group_task_fixtures.psql
reset role;
select pg_temp.g521_task('command0','project',null,'todo','direct','task');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($$select public.assign_task_executor((select id from g521_tasks where name='command0'),pg_temp.g521_uid(10))$$,'assign_task_executor: Group persona 2 in project');
reset role;
select pg_temp.g521_task('command1','project',null,'todo','direct','task');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select lives_ok($$select public.assign_task_executor((select id from g521_tasks where name='command1'),pg_temp.g521_uid(10))$$,'assign_task_executor: Group persona 3 in project');
reset role;
select pg_temp.g521_task('command2','ind',null,'todo','direct','task');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(6));
select lives_ok($$select public.assign_task_executor((select id from g521_tasks where name='command2'),pg_temp.g521_uid(10))$$,'assign_task_executor: Group persona 6 in ind');
reset role;
select pg_temp.g521_task('command3','dt',null,'todo','direct','task');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(8));
select throws_ok($$select public.assign_task_executor((select id from g521_tasks where name='command3'),pg_temp.g521_uid(10))$$,'42501','task_manage_forbidden','assign_task_executor: Group persona 8 in dt');
reset role;

select * from finish();
rollback;
