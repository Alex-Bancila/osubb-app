-- #327: public.create_task — the only way a Task is created — plus the
-- authority kit every later Task command reuses (private.require_task_visible,
-- require_origin_manager, require_task_manager, require_task_evaluator,
-- require_task_executor, can_evaluate_task, log_task_activity,
-- open_task_assignment, end_task_assignment, close_task_queue).
--
-- create_task and can_evaluate_task are exercised through their real callers
-- (create_task itself). Section 13 additionally calls require_task_visible,
-- require_task_manager, require_task_evaluator, require_task_executor,
-- end_task_assignment and close_task_queue DIRECTLY as the owner (reset role;
-- request.jwt.claims survives a role reset within one transaction, so
-- auth.uid() still resolves to the logged-in persona even though none of
-- these six has a grant to authenticated) -- a wrong body in any of them
-- would otherwise ship unnoticed until a later command happened to exercise
-- it (review finding I2). log_task_activity and open_task_assignment keep
-- their indirect coverage from create_task's own path, plus section 13's
-- direct assertions on open_task_assignment's p_via allow-list (I1).
--
-- can_evaluate_task is covered in full because it is the one genuinely new
-- authority rule in this migration: can_manage_task minus the
-- Independent-Team member branch (ADR-0007 gives that evaluation to
-- BC/Moderator), minus a Project Responsible evaluating the lead's active
-- Assignment or their own, and minus an archived Project entirely.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(157);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('32700000-0000-0000-0000-000000000001', 'proj.lead.327@test.local'),
  ('32700000-0000-0000-0000-000000000002', 'proj.responsible.327@test.local'),
  ('32700000-0000-0000-0000-000000000003', 'proj.member.327@test.local'),
  ('32700000-0000-0000-0000-000000000004', 'ind.team.327@test.local'),
  ('32700000-0000-0000-0000-000000000005', 'bc.327@test.local'),
  ('32700000-0000-0000-0000-000000000006', 'edu.bce.327@test.local'),
  ('32700000-0000-0000-0000-000000000007', 'pr.bce.327@test.local'),
  ('32700000-0000-0000-0000-000000000008', 'edu.member.327@test.local'),
  ('32700000-0000-0000-0000-000000000009', 'pr.member.327@test.local'),
  ('32700000-0000-0000-0000-000000000010', 'inactive.bc.327@test.local'),
  ('32700000-0000-0000-0000-000000000011', 'claimless.327@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('32700000-0000-0000-0000-000000000001', 'Lead Proiect 327', 'proj.lead.327@test.local', 'voluntar', 'activ'),
  ('32700000-0000-0000-0000-000000000002', 'Responsabil Proiect 327', 'proj.responsible.327@test.local', 'voluntar', 'activ'),
  ('32700000-0000-0000-0000-000000000003', 'Membru Proiect 327', 'proj.member.327@test.local', 'voluntar', 'activ'),
  ('32700000-0000-0000-0000-000000000004', 'Membru Echipa Independenta 327', 'ind.team.327@test.local', 'voluntar', 'activ'),
  ('32700000-0000-0000-0000-000000000005', 'BC 327', 'bc.327@test.local', 'bc', 'activ'),
  ('32700000-0000-0000-0000-000000000006', 'BCE EDU 327', 'edu.bce.327@test.local', 'bce', 'activ'),
  ('32700000-0000-0000-0000-000000000007', 'BCE PR 327', 'pr.bce.327@test.local', 'bce', 'activ'),
  ('32700000-0000-0000-0000-000000000008', 'Membru EDU 327', 'edu.member.327@test.local', 'voluntar', 'activ'),
  ('32700000-0000-0000-0000-000000000009', 'Membru PR 327', 'pr.member.327@test.local', 'voluntar', 'activ'),
  ('32700000-0000-0000-0000-000000000010', 'BC Inactiv 327', 'inactive.bc.327@test.local', 'bc', 'inactiv'),
  ('32700000-0000-0000-0000-000000000011', 'Fara Claimuri 327', 'claimless.327@test.local', 'voluntar', 'activ');

insert into pg_temp.fixture_member_departments (member_id, dept_id) values
  ('32700000-0000-0000-0000-000000000006', 'edu'),
  ('32700000-0000-0000-0000-000000000007', 'pr'),
  ('32700000-0000-0000-0000-000000000008', 'edu'),
  ('32700000-0000-0000-0000-000000000009', 'pr');

insert into pg_temp.fixture_teams (id, name, dept_id) values
  ('t-327-ind', 'Echipa Independenta 327', null),
  ('t-327-dt', 'Echipa Departamentala 327', 'edu');

insert into pg_temp.fixture_team_members (team_id, member_id) values
  ('t-327-ind', '32700000-0000-0000-0000-000000000004');

insert into pg_temp.fixture_projects (name, status, leader_id, created_by)
values ('Proiect #327', 'active',
        '32700000-0000-0000-0000-000000000001',
        '32700000-0000-0000-0000-000000000005'),
       ('Proiect arhivat #327', 'archived',
        '32700000-0000-0000-0000-000000000001',
        '32700000-0000-0000-0000-000000000005');

insert into pg_temp.fixture_project_members (project_id, member_id, project_role) values
  ((select id from pg_temp.fixture_projects where name = 'Proiect #327'),
   '32700000-0000-0000-0000-000000000002', 'responsible'),
  ((select id from pg_temp.fixture_projects where name = 'Proiect #327'),
   '32700000-0000-0000-0000-000000000003', 'member');
-- #586: materialize this suite's legacy setup as rolled-back Group fixtures.
select pg_temp.materialize_legacy_groups();


insert into public.campaigns (group_id, name, is_active, created_by) values
  (pg_temp.dept_group('edu'), 'Campanie #327', true, '32700000-0000-0000-0000-000000000005'),
  (pg_temp.dept_group('pr'), 'Campanie PR #327', true, '32700000-0000-0000-0000-000000000005'),
  (pg_temp.dept_group('edu'), 'Campanie inactiva #327', false, '32700000-0000-0000-0000-000000000005');

-- An Umbrella must pass explicit nulls for audience/assignment_mode (the
-- column defaults would otherwise land it in an invalid shape, #315).
insert into public.tasks
  (title, group_id, kind, audience, assignment_mode, difficulty, rating, status, created_by)
values
  ('Umbrela #327', pg_temp.dept_group('edu'), 'umbrella', null, null, null, null, 'todo',
   '32700000-0000-0000-0000-000000000005');

-- #339: tasks_cancel_reason_ck makes cancel_reason mandatory on -- and
-- exclusive to -- a cancelled Task, so this fixture states why it was called
-- off. Nothing else about the fixture changes.
insert into public.tasks
  (title, group_id, kind, audience, assignment_mode, status, cancelled_at, cancel_reason, created_by)
values
  ('Umbrela anulata #327', pg_temp.dept_group('edu'), 'umbrella', null, null, 'cancelled', now(),
   'Umbrela anulata inainte de #327', '32700000-0000-0000-0000-000000000005');

insert into public.tasks (title, group_id, audience, assignment_mode, status, created_by)
values ('Nu e umbrela #327', pg_temp.dept_group('edu'), 'local', 'direct', 'todo',
        '32700000-0000-0000-0000-000000000005');

insert into public.tasks (title, group_id, audience, assignment_mode, status, created_by)
values ('Task independent #327', pg_temp.team_group('t-327-ind'), 'local', 'direct', 'todo',
        '32700000-0000-0000-0000-000000000005');

insert into public.tasks (title, group_id, audience, assignment_mode, status, created_by)
select 'Task proiect #327', pg_temp.project_group(project.id), 'local', 'direct', 'todo',
       '32700000-0000-0000-0000-000000000005'
  from pg_temp.fixture_projects as project where project.name = 'Proiect #327';

insert into public.tasks (title, group_id, audience, assignment_mode, status, created_by)
select 'Task proiect lead executant #327', pg_temp.project_group(project.id), 'local', 'direct', 'in_progress',
       '32700000-0000-0000-0000-000000000005'
  from pg_temp.fixture_projects as project where project.name = 'Proiect #327';

insert into public.tasks (title, group_id, audience, assignment_mode, status, created_by)
select 'Task proiect responsabil executant #327', pg_temp.project_group(project.id), 'local', 'direct', 'in_progress',
       '32700000-0000-0000-0000-000000000005'
  from pg_temp.fixture_projects as project where project.name = 'Proiect #327';

insert into public.tasks (title, group_id, audience, assignment_mode, status, created_by)
select 'Task proiect arhivat #327', pg_temp.project_group(project.id), 'local', 'direct', 'todo',
       '32700000-0000-0000-0000-000000000005'
  from pg_temp.fixture_projects as project where project.name = 'Proiect arhivat #327';

update public.tasks set started_at = now()
 where title in ('Task proiect lead executant #327',
                 'Task proiect responsabil executant #327');

insert into public.task_assignments (task_id, member_id, assigned_by)
select task.id, '32700000-0000-0000-0000-000000000001',
       '32700000-0000-0000-0000-000000000005'
  from public.tasks as task where task.title = 'Task proiect lead executant #327';

insert into public.task_assignments (task_id, member_id, assigned_by)
select task.id, '32700000-0000-0000-0000-000000000002',
       '32700000-0000-0000-0000-000000000005'
  from public.tasks as task where task.title = 'Task proiect responsabil executant #327';

create temp table f327 as
select
  (select id from pg_temp.fixture_projects where name = 'Proiect #327') as project_id,
  (select id from pg_temp.fixture_projects where name = 'Proiect arhivat #327') as archived_project_id,
  (select id from public.campaigns where group_id = pg_temp.dept_group('edu') and name = 'Campanie #327') as edu_campaign_id,
  (select id from public.campaigns where group_id = pg_temp.dept_group('pr') and name = 'Campanie PR #327') as pr_campaign_id,
  (select id from public.campaigns where group_id = pg_temp.dept_group('edu') and name = 'Campanie inactiva #327') as inactive_campaign_id,
  (select id from public.tasks where title = 'Umbrela #327') as umbrella_id,
  (select id from public.tasks where title = 'Umbrela anulata #327') as cancelled_umbrella_id,
  (select id from public.tasks where title = 'Nu e umbrela #327') as plain_task_id,
  (select id from public.tasks where title = 'Task independent #327') as ind_task_id,
  (select id from public.tasks where title = 'Task proiect #327') as project_task_id,
  (select id from public.tasks where title = 'Task proiect lead executant #327') as project_lead_exec_task_id,
  (select id from public.tasks where title = 'Task proiect responsabil executant #327') as project_resp_exec_task_id,
  (select id from public.tasks where title = 'Task proiect arhivat #327') as archived_task_id,
  9223372036854775807::bigint as missing_id;
grant select on f327 to authenticated;

-- ==================== 1. API shape and privileges ====================

select has_function('public', 'create_task',
  array['text', 'text', 'timestamptz', 'text', 'text',
        'uuid', 'bigint', 'bigint', 'text', 'bigint', 'text', 'text'],
  'public.create_task exists with the pinned Group-only signature plus the #684 Attached Link pair');

select is(pg_get_function_identity_arguments(
    'public.create_task(text,text,timestamptz,text,text,uuid,bigint,bigint,text,bigint,text,text)'::regprocedure),
  'p_title text, p_description text, p_deadline timestamp with time zone, p_audience text, p_assignment_mode text, p_executor_id uuid, p_campaign_id bigint, p_parent_task_id bigint, p_kind text, p_group_id bigint, p_link_label text, p_link_url text',
  'create_task exposes no actor parameter — the actor is always auth.uid()');

select is(pg_get_function_result(
    'public.create_task(text,text,timestamptz,text,text,uuid,bigint,bigint,text,bigint,text,text)'::regprocedure),
  'tasks', 'create_task returns the created Task row');

select ok(not (select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public' and procedure.proname = 'create_task'),
  'the public command is a security invoker wrapper');

select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private'
     and procedure.proname in ('can_evaluate_task', 'require_task_visible',
       'require_group_work_manager', 'require_task_manager', 'require_task_evaluator',
       'require_task_executor', 'log_task_activity', 'open_task_assignment',
       'end_task_assignment', 'close_task_queue', 'create_task_impl')
     and procedure.prosecdef
), 11::bigint, 'all eleven private kit functions run as owner (security definer)');

select ok(coalesce((
  select bool_and('search_path=""' = any(procedure.proconfig))
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where (namespace.nspname = 'public' and procedure.proname = 'create_task')
      or (namespace.nspname = 'private' and procedure.proname in
           ('can_evaluate_task', 'require_task_visible', 'require_group_work_manager',
            'require_task_manager', 'require_task_evaluator', 'require_task_executor',
            'log_task_activity', 'open_task_assignment', 'end_task_assignment',
            'close_task_queue', 'create_task_impl'))
), false), 'every function in the kit pins an empty search_path');

select ok(has_function_privilege('authenticated',
  'public.create_task(text,text,timestamptz,text,text,uuid,bigint,bigint,text,bigint,text,text)'::regprocedure,
  'execute'), 'authenticated can execute public.create_task');

select ok(not has_function_privilege('anon',
  'public.create_task(text,text,timestamptz,text,text,uuid,bigint,bigint,text,bigint,text,text)'::regprocedure,
  'execute'), 'anon cannot execute public.create_task');

select ok(has_function_privilege('authenticated',
  'private.create_task_impl(text,text,timestamptz,text,text,uuid,bigint,bigint,text,bigint,text,text)'::regprocedure,
  'execute'), 'authenticated can execute private.create_task_impl');

select ok(has_function_privilege('authenticated',
  'private.can_evaluate_task(bigint)'::regprocedure, 'execute'),
  'authenticated can execute the can_evaluate_task predicate (it answers policies too)');

select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private'
     and procedure.proname in ('require_task_visible', 'require_group_work_manager',
       'require_task_manager', 'require_task_evaluator', 'require_task_executor',
       'log_task_activity', 'open_task_assignment', 'end_task_assignment',
       'close_task_queue')
     and (has_function_privilege('authenticated', procedure.oid, 'execute')
       or has_function_privilege('anon', procedure.oid, 'execute')
       or has_function_privilege('service_role', procedure.oid, 'execute'))
), 0::bigint, 'no require_*/internal-writer helper is executable by any client role');

-- ==================== 2. Authority matrix ====================

select pg_temp.test_login('32700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok($$ select public.create_task('Dept task #327', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.dept_group('edu')) $$, 'the local BCE creates a Department Task');
select throws_ok($$ select public.create_task('Foreign #327', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.dept_group('pr')) $$, '42501', 'task_manage_forbidden',
  'a BCE of another Department cannot create there');
select lives_ok($$ select public.create_task('Dept team task #327', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.team_group('t-327-dt')) $$,
  'the local BCE creates a Task on a Department Team of their own Department');
select throws_ok($$ select public.create_task('Ind by bce #327', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.team_group('t-327-ind')) $$, '42501', 'task_manage_forbidden',
  'a BCE has no authority over an Independent Team they are not a member of');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok($$ select public.create_task('BC dept task #327', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.dept_group('edu')) $$, 'BC creates a Task in any Department');
select lives_ok($$ select public.create_task('BC ind task #327', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.team_group('t-327-ind')) $$, 'BC creates a Task on an Independent Team');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["pr"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$ select public.create_task('PR bce in edu #327', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.dept_group('edu')) $$, '42501', 'task_manage_forbidden',
  'the PR BCE cannot create an EDU Task');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$ select public.create_task('Member dept #327', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.dept_group('edu')) $$, '42501', 'task_manage_forbidden',
  'an ordinary Department member cannot create a Department Task');
select throws_ok($$ select public.create_task('Member ind #327', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.team_group('t-327-ind')) $$, '42501', 'task_manage_forbidden',
  'an ordinary member cannot create a Task on an Independent Team they do not belong to');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb,
  'team_ids', '["t-327-ind"]'::jsonb));
select lives_ok($$ select public.create_task('Ind team task #327', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.team_group('t-327-ind')) $$,
  'an Independent-Team member creates a Task on their own Team');
select throws_ok($$ select public.create_task('Ind member in edu #327', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.dept_group('edu')) $$, '42501', 'task_manage_forbidden',
  'an Independent-Team member has no authority in a Department');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.create_task('Lead project task #327', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.project_group(%s)) $$,
  (select project_id from f327)), 'the Project lead creates a Task on their Project');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.create_task('Responsible project task #327', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.project_group(%s)) $$,
  (select project_id from f327)), 'a Project Responsible creates a Task on the Project');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.create_task('Plain project member #327', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.project_group(%s)) $$,
  (select project_id from f327)), '42501', 'task_manage_forbidden',
  'a plain Project member cannot create a Project Task');
reset role;

-- private.can_manage_origin's Project branch is private.can_manage_project_work,
-- which requires projects.status = 'active' -- so the lead of an archived
-- Project loses their write authority over it (BC/Moderator keep theirs
-- through the global level >= 6 branch, which sits above the Project branch).
select pg_temp.test_login('32700000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.create_task('Archived project #327', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.project_group(%s)) $$,
  (select archived_project_id from f327)), '42501', 'task_manage_forbidden',
  'the lead of an archived Project can no longer create Tasks on it');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000010', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$ select public.create_task('Deactivated bc #327', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.dept_group('edu')) $$, '42501', 'task_command_forbidden',
  'a deactivated BC holding a still-valid level-6 token is denied by the gate');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000011',
  jsonb_build_object('provider', 'email'));
select throws_ok($$ select public.create_task('Claimless #327', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.dept_group('edu')) $$, '42501', 'task_command_forbidden',
  'a real uid without organisation claims is denied by the gate');
reset role;

set local role anon;
select throws_ok($$ select public.create_task('Anon #327', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.dept_group('edu')) $$, '42501', 'permission denied for function create_task',
  'anon cannot execute create_task at all — the literal grant-denial text, not a gate that happens to raise 42501');
reset role;

-- ==================== 3. Malformed input runs before the gate ====================
-- Step 1 of the binding step order (the #343 set_campaign_active precedent):
-- input that is malformed for every caller is rejected before authority.
select pg_temp.test_login('32700000-0000-0000-0000-000000000011',
  jsonb_build_object('provider', 'email'));
select throws_ok($$ select public.create_task('Bad kind #327', 'd', now() + interval '7 days', 'local', 'direct', p_kind => null, p_group_id => pg_temp.dept_group('edu')) $$,
  'PT400', 'invalid_task_kind',
  'a null kind is rejected before the gate, even for a claimless caller');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$ select public.create_task('Bad kind #327', 'd', now() + interval '7 days', 'local', 'direct', p_kind => 'epic', p_group_id => pg_temp.dept_group('edu')) $$,
  'PT400', 'invalid_task_kind', 'an unknown kind is rejected');
select throws_ok($$ select public.create_task('Unknown Group #327', 'd', now() + interval '7 days',
  'local', 'direct', p_group_id => -1) $$, '42501', 'task_manage_forbidden',
  'an unknown Group is refused as not manageable, even for BC -- never disclosed as missing');
select throws_ok($$ select public.create_task('No origin #327', 'd', now() + interval '7 days', 'local', 'direct') $$, 'PT400', 'task_group_required',
  'a top-level Task with no Group is rejected (#579: the Group is the only Origin)');
reset role;

-- ==================== 4. Input validation ====================
select pg_temp.test_login('32700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$ select public.create_task('   ', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.dept_group('edu')) $$, 'PT400', 'title_required',
  'a blank title is rejected');
select throws_ok($$ select public.create_task(null, 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.dept_group('edu')) $$, 'PT400', 'title_required',
  'a null title is rejected');
select throws_ok($$ select public.create_task('No deadline #327', 'd', null, 'local', 'direct', p_group_id => pg_temp.dept_group('edu')) $$, 'PT400', 'deadline_required',
  'an ordinary Task requires a deadline');
select throws_ok($$ select public.create_task('Bad audience #327', 'd', now() + interval '7 days', 'worldwide', 'direct', p_group_id => pg_temp.dept_group('edu')) $$, 'PT400', 'invalid_audience',
  'an unknown Audience is rejected');
select throws_ok($$ select public.create_task('Bad mode #327', 'd', now() + interval '7 days', 'local', 'auction', p_group_id => pg_temp.dept_group('edu')) $$, 'PT400', 'invalid_assignment_mode',
  'an unknown Assignment Mode is rejected');
-- #794 (ruling R26): a directly assigned Task carries the local Audience --
-- with an Executor or without one, refused before anything is written.
select throws_ok($$ select public.create_task('Direct org #794', 'd', now() + interval '7 days', 'org', 'direct', p_group_id => pg_temp.dept_group('edu')) $$, 'PT400', 'direct_task_local_only',
  '#794: a direct Task with the org Audience is rejected');
select throws_ok($$ select public.create_task('Direct org #794', 'd', now() + interval '7 days', 'org', 'direct', p_executor_id => '32700000-0000-0000-0000-000000000009', p_group_id => pg_temp.dept_group('edu')) $$, 'PT400', 'direct_task_local_only',
  '#794: and so is one naming its Executor');
select lives_ok($$ select public.create_task(E'\t Trimmed #327 \t', E'  spatiat  ', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.dept_group('edu')) $$,
  'a padded title and description are accepted');
reset role;
select is((select count(*) from public.tasks where title = 'Trimmed #327'), 1::bigint,
  'the title is stored trimmed with regexp_replace, not btrim (tabs included)');
select is((select description from public.tasks where title = 'Trimmed #327'), 'spatiat',
  'the description is stored trimmed');
select is((select count(*) from public.tasks where title = 'Direct org #794'), 0::bigint,
  '#794: neither refused direct + org creation wrote a Task');

-- ==================== 5. Direct Assignment Mode with an Executor ====================
select pg_temp.test_login('32700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok($$ select public.create_task('Direct #327', 'd', now() + interval '7 days', 'local', 'direct', p_executor_id => '32700000-0000-0000-0000-000000000009', p_group_id => pg_temp.dept_group('edu')) $$,
  'any active member may be the direct Executor, even outside the Origin');
select throws_ok($$ select public.create_task('Bad exec #327', 'd', now() + interval '7 days', 'local', 'direct', p_executor_id => '32700000-0000-0000-0000-000000000010', p_group_id => pg_temp.dept_group('edu')) $$,
  'PT400', 'invalid_executor', 'a deactivated member cannot be the Executor');
reset role;

select is((select count(*) from public.task_assignments as assignment
             join public.tasks as task on task.id = assignment.task_id
            where task.title = 'Direct #327' and assignment.ended_at is null
              and assignment.member_id = '32700000-0000-0000-0000-000000000009'),
  1::bigint, 'the direct Executor holds the one active Assignment');
select is((select assignment.assigned_by from public.task_assignments as assignment
             join public.tasks as task on task.id = assignment.task_id
            where task.title = 'Direct #327'),
  '32700000-0000-0000-0000-000000000006'::uuid, 'assigned_by is the creating actor');
select is((select format('%s|%s|%s|%s', task.status, task.created_by,
                         (task.queue_opened_at is null)::text, task.kind)
             from public.tasks as task where task.title = 'Direct #327'),
  'todo|32700000-0000-0000-0000-000000000006|true|task',
  'a direct Task starts todo, records its creator, and opens no queue');

select is((select format('%s|%s|%s|%s|%s',
                         activity.actor_id, (activity.assignment_id is null)::text,
                         (activity.from_status is null)::text, activity.to_status,
                         activity.details ->> 'assignment_mode')
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Direct #327' and activity.kind = 'created'),
  '32700000-0000-0000-0000-000000000006|true|true|todo|direct',
  'the created activity row names the actor, carries no assignment_id, and lands on todo');
select is((select format('%s|%s|%s|%s',
                         activity.actor_id,
                         (activity.assignment_id = assignment.id)::text,
                         activity.details ->> 'via',
                         activity.details ->> 'member_id')
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
             join public.task_assignments as assignment on assignment.task_id = task.id
            where task.title = 'Direct #327' and activity.kind = 'executor_assigned'),
  '32700000-0000-0000-0000-000000000006|true|create|32700000-0000-0000-0000-000000000009',
  'the executor_assigned activity row carries the Assignment id and via = create');
select is((select count(*) from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Direct #327'), 2::bigint,
  'a direct create with an Executor writes exactly two activity rows');

select set_eq(
  $$ select notification.member_id from public.notifications as notification
       join public.tasks as task on task.id = notification.task_id
      where task.title = 'Direct #327' $$,
  $$ values ('32700000-0000-0000-0000-000000000009'::uuid) $$,
  'only the new Executor is notified — never the actor who assigned them');
select is((select format('%s|%s|%s|%s', notification.title, notification.kind,
                         notification.link, (notification.dedupe_key is null)::text)
             from public.notifications as notification
             join public.tasks as task on task.id = notification.task_id
            where task.title = 'Direct #327'),
  format('Task nou: Direct #327|task|/tracker/%s|true', (select plain.id from public.tasks as plain
    where plain.title = 'Direct #327')),
  'the Executor notification uses the pinned Romanian title, task kind and Task link');
-- The exact string, not a `like` prefix probe: a wrong to_char mask or time
-- zone would still satisfy a prefix match, so the expected body is composed
-- here from the Task's own persisted deadline with the pinned format and
-- zone, independent of whichever expression the migration used to write it.
select is((select notification.body
             from public.notifications as notification
             join public.tasks as task on task.id = notification.task_id
            where task.title = 'Direct #327'),
  (select 'Ți-a fost atribuit acest task. Deadline: '
       || to_char(task.deadline at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI') || '.'
     from public.tasks as task where task.title = 'Direct #327'),
  'the Executor notification body is the exact pinned-format deadline message');

-- A denied create writes nothing at all.
select pg_temp.test_login('32700000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$ select public.create_task('Denied #327', 'd', now() + interval '7 days', 'local', 'direct', p_executor_id => '32700000-0000-0000-0000-000000000009', p_group_id => pg_temp.dept_group('edu')) $$,
  '42501', 'task_manage_forbidden', 'an ordinary member cannot create a Task with an Executor');
reset role;
select is((select count(*) from public.tasks where title = 'Denied #327'), 0::bigint,
  'a denied create writes no Task');
select is((select count(*) from public.notifications where title = 'Task nou: Denied #327'),
  0::bigint, 'a denied create writes no notification');

-- ==================== 6. Public Assignment Mode ====================
select pg_temp.test_login('32700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok($$ select public.create_task('Public #327', 'd', now() + interval '7 days', 'org', 'public', p_group_id => pg_temp.dept_group('edu')) $$, 'a public Task is created without an Executor');
select throws_ok($$ select public.create_task('Public with exec #327', 'd', now() + interval '7 days', 'org', 'public', p_executor_id => '32700000-0000-0000-0000-000000000009', p_group_id => pg_temp.dept_group('edu')) $$,
  'PT400', 'executor_not_allowed_for_public',
  'a public Task may not name an Executor at creation');
reset role;
select is((select format('%s|%s', (task.queue_opened_at is not null)::text,
                         (task.queue_closed_at is null)::text)
             from public.tasks as task where task.title = 'Public #327'),
  'true|true', 'a public Task opens its Candidate Queue and leaves it open');
select is((select count(*) from public.task_assignments as assignment
             join public.tasks as task on task.id = assignment.task_id
            where task.title = 'Public #327'), 0::bigint,
  'a public Task starts with no Assignment');
select is((select count(*) from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Public #327'), 1::bigint,
  'a public create writes only the created activity row');

-- ==================== 7. Subtasks ====================
select pg_temp.test_login('32700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.create_task('Subtask #327', 'd', now() + interval '7 days', 'local', 'direct', p_parent_task_id => %s) $$,
  (select umbrella_id from f327)),
  'a Subtask is created with null Origin parameters and inherits the Umbrella''s');
select throws_ok(format($$ select public.create_task('Subtask mismatch #327', 'd', now() + interval '7 days', 'local', 'direct', p_parent_task_id => %s, p_group_id => pg_temp.dept_group('pr')) $$,
  (select umbrella_id from f327)), 'PT400', 'subtask_origin_mismatch',
  'a Subtask Origin that contradicts its Umbrella is rejected, never silently overwritten');
select throws_ok(format($$ select public.create_task('Subtask of a task #327', 'd', now() + interval '7 days', 'local', 'direct', p_parent_task_id => %s) $$,
  (select plain_task_id from f327)), 'PT409', 'parent_not_umbrella',
  'an ordinary Task cannot be a parent');
select throws_ok(format($$ select public.create_task('Subtask of a cancelled umbrella #327', 'd', now() + interval '7 days', 'local', 'direct', p_parent_task_id => %s) $$,
  (select cancelled_umbrella_id from f327)), 'PT409', 'parent_terminal',
  'a terminal Umbrella takes no new Subtasks');
select throws_ok(format($$ select public.create_task('Subumbrella #327', 'd', now() + interval '7 days', null, null, p_parent_task_id => %s, p_kind => 'umbrella') $$,
  (select umbrella_id from f327)), 'PT400', 'subtask_cannot_be_umbrella',
  'a Subtask cannot itself be an Umbrella');
select throws_ok(format($$ select public.create_task('Orphan subtask #327', 'd', now() + interval '7 days', 'local', 'direct', p_parent_task_id => %s) $$,
  (select missing_id from f327)), 'PT404', 'task_not_found',
  'an unknown or invisible Umbrella is not found');
reset role;
select is((select task.group_id from public.tasks as task where task.title = 'Subtask #327'),
  pg_temp.dept_group('edu'), 'the Subtask inherited the Umbrella''s Group');

-- ==================== 8. Campaigns ====================
select pg_temp.test_login('32700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.create_task('Campaign task #327', 'd', now() + interval '7 days', 'local', 'direct', p_campaign_id => %s, p_group_id => pg_temp.dept_group('edu')) $$,
  (select edu_campaign_id from f327)), 'an EDU Campaign attaches to an EDU Task');
select throws_ok(format($$ select public.create_task('Wrong campaign #327', 'd', now() + interval '7 days', 'local', 'direct', p_campaign_id => %s, p_group_id => pg_temp.dept_group('edu')) $$,
  (select pr_campaign_id from f327)), 'PT400', 'invalid_campaign',
  'a Campaign from another Department is mapped from the #314 trigger''s 23514 to PT400');
select throws_ok(format($$ select public.create_task('Inactive campaign #327', 'd', now() + interval '7 days', 'local', 'direct', p_campaign_id => %s, p_group_id => pg_temp.dept_group('edu')) $$,
  (select inactive_campaign_id from f327)), 'PT400', 'invalid_campaign',
  'a deactivated Campaign cannot be attached to a new Task');
select throws_ok(format($$ select public.create_task('Unknown campaign #327', 'd', now() + interval '7 days', 'local', 'direct', p_campaign_id => %s, p_group_id => pg_temp.dept_group('edu')) $$,
  (select missing_id from f327)), 'PT400', 'invalid_campaign',
  'an unknown Campaign id is a PT400 on a parameter, not a PT404 on the target');
reset role;
select is((select task.campaign_id from public.tasks as task where task.title = 'Campaign task #327'),
  (select edu_campaign_id from f327), 'the accepted Campaign is stored on the Task');

-- A shape violation that is not the Campaign check must still surface as 23514.
select pg_temp.test_login('32700000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.create_task('Campaign on a project #327', 'd', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.project_group(%s), p_campaign_id => %s) $$,
  (select project_id from f327), (select edu_campaign_id from f327)),
  'PT400', 'invalid_campaign',
  'a Campaign on a Project Origin is the same origin-mismatch reason, still PT400');
reset role;

-- ==================== 9. Umbrellas ====================
select pg_temp.test_login('32700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok($$ select public.create_task('Umbrela noua #327', 'd', null, null, null, p_kind => 'umbrella', p_group_id => pg_temp.dept_group('edu')) $$,
  'an Umbrella is created with no Audience, Assignment Mode or deadline');
select throws_ok($$ select public.create_task('Umbrela cu audienta #327', 'd', null, 'local', null, p_kind => 'umbrella', p_group_id => pg_temp.dept_group('edu')) $$,
  'PT400', 'umbrella_has_no_mode', 'an Umbrella rejects an Audience');
select throws_ok($$ select public.create_task('Umbrela cu mod #327', 'd', null, null, 'public', p_kind => 'umbrella', p_group_id => pg_temp.dept_group('edu')) $$,
  'PT400', 'umbrella_has_no_mode', 'an Umbrella rejects an Assignment Mode');
select throws_ok($$ select public.create_task('Umbrela cu executant #327', 'd', null, null, null, p_executor_id => '32700000-0000-0000-0000-000000000009', p_kind => 'umbrella', p_group_id => pg_temp.dept_group('edu')) $$,
  'PT400', 'umbrella_has_no_mode', 'an Umbrella rejects an Executor');
select throws_ok(format($$ select public.create_task('Umbrela cu campanie #327', 'd', null, null, null, p_campaign_id => %s, p_kind => 'umbrella', p_group_id => pg_temp.dept_group('edu')) $$,
  (select edu_campaign_id from f327)), 'PT400', 'umbrella_has_no_mode',
  'an Umbrella rejects a Campaign');
reset role;
select is((select format('%s|%s|%s|%s|%s', task.kind, (task.audience is null)::text,
                         (task.assignment_mode is null)::text, (task.difficulty is null)::text,
                         (task.queue_opened_at is null)::text)
             from public.tasks as task where task.title = 'Umbrela noua #327'),
  'umbrella|true|true|true|true',
  'the new Umbrella holds the shape tasks_umbrella_shape_ck demands');

-- ==================== 10. can_evaluate_task ====================
-- Evaluating is narrower than managing (ADR-0007 Sec Authorization).
select pg_temp.test_login('32700000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select private.can_evaluate_task((select plain_task_id from f327))), true,
  'BC evaluates a Department Task');
select is((select private.can_evaluate_task((select ind_task_id from f327))), true,
  'BC evaluates an Independent-Team Task — the one authority ADR-0007 gives there');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select private.can_evaluate_task((select plain_task_id from f327))), true,
  'the local BCE evaluates their own Department''s Task');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["pr"]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select private.can_evaluate_task((select plain_task_id from f327))), false,
  'a BCE of another Department does not evaluate an EDU Task');
reset role;

-- #521: the evaluated Executor holds the Independent Group Responsible role.
insert into public.task_assignments(task_id,member_id,assigned_by)
select ind_task_id,'32700000-0000-0000-0000-000000000004','32700000-0000-0000-0000-000000000001' from f327;

select pg_temp.test_login('32700000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb,
  'team_ids', '["t-327-ind"]'::jsonb));
select is((select private.can_manage_task((select ind_task_id from f327))), true,
  'an Independent-Team member manages their Team''s Task');
select is((select private.can_evaluate_task((select ind_task_id from f327))), false,
  'but a Group Responsible never evaluates their own or peer Responsible work');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select private.can_evaluate_task((select plain_task_id from f327))), false,
  'an ordinary Department member evaluates nothing');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000010', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select private.can_evaluate_task((select plain_task_id from f327))), false,
  'a deactivated BC with a still-valid level-6 token evaluates nothing');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select private.can_evaluate_task((select project_task_id from f327))), true,
  'the Project lead evaluates a Task on their Project');
select is((select private.can_evaluate_task((select project_lead_exec_task_id from f327))), true,
  'the Project lead evaluates even the Task they are executing themselves');
select is((select private.can_evaluate_task((select archived_task_id from f327))), false,
  'nobody evaluates a Task on an archived Project, the lead included');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select private.can_evaluate_task((select project_task_id from f327))), true,
  'a Project Responsible evaluates an unassigned Project Task');
select is((select private.can_evaluate_task((select project_lead_exec_task_id from f327))), false,
  'a Project Responsible does not evaluate the lead''s own active Assignment');
select is((select private.can_evaluate_task((select project_resp_exec_task_id from f327))), false,
  'a Project Responsible does not evaluate their own active Assignment');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select private.can_evaluate_task((select project_task_id from f327))), false,
  'a plain Project member evaluates nothing');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select private.can_evaluate_task((select missing_id from f327))), false,
  'an unknown Task is not evaluable by anyone');
reset role;

-- ==================== 11. The command is the only write path ====================
select pg_temp.test_login('32700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ insert into public.task_assignments (task_id, member_id, assigned_by)
  values (%s, '32700000-0000-0000-0000-000000000009',
          '32700000-0000-0000-0000-000000000006') $$,
  (select plain_task_id from f327)), '42501', null,
  'an authorized manager still cannot insert a Task Assignment directly');
select throws_ok(format($$ insert into public.task_activity (task_id, kind, actor_id, details)
  values (%s, 'created', '32700000-0000-0000-0000-000000000006', '{}'::jsonb) $$,
  (select plain_task_id from f327)), '42501', null,
  'an authorized manager still cannot append Task activity directly');
select throws_ok(format($$ insert into public.task_candidates (task_id, member_id)
  values (%s, '32700000-0000-0000-0000-000000000006') $$,
  (select plain_task_id from f327)), '42501', null,
  'an authorized manager still cannot insert a Candidature directly');
reset role;

-- ==================== 12. Locks held while the command runs ====================
-- House rule 5: without this probe no test would fail if
-- require_origin_manager's FOR SHARE re-validation, or the Umbrella's lock,
-- were deleted. Pattern copied from campaign_commands.test.sql:539-575.
-- Fixtures are committed through a second connection because dblink sessions
-- cannot see rows inside this pgTAP transaction (supabase/tests/README.md).
--
-- RULING 20 (whole-wave review, finding 1). The Umbrella parent is locked
-- FOR NO KEY UPDATE, never FOR UPDATE. private.evaluate_task reaches the same
-- row implicitly -- its parent-naming task_activity and notifications inserts
-- take a foreign-key FOR KEY SHARE on it -- and FOR KEY SHARE conflicts with
-- FOR UPDATE while passing straight through FOR NO KEY UPDATE. Two assertions
-- pin the mode (the #339 split: "locked at all" and "the exact mode string"),
-- and the section then reproduces the behaviour the mode exists for: a real
-- complete_task_review on an existing Subtask of this very Umbrella, run in a
-- third session while the create holds the parent, must finish rather than
-- block.
--
-- MUTATION RESULT, reported as run: with `for no key update` changed back to
-- `for update` in private.create_task_impl, assertion (b) reports
-- {"For Update"} and goes RED, and the concurrent evaluation below blocks on
-- the parent until its lock_timeout and comes back 55P03 instead of
-- 'completed' -- also RED. It does NOT deadlock (40P01), and no probe here
-- claims it does: create_task takes no second public.tasks row lock after the
-- parent, so the ABBA cycle #338/#339/#340 each reproduced cannot close on
-- this command. The damage the stronger mode does here is a stall of every
-- concurrent evaluation under the Umbrella, which is what the third session
-- pins.
select extensions.dblink_connect('task_lock_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
-- #621: committed fixtures from an interrupted run must not hang cleanup.
select extensions.dblink_exec('task_lock_setup', 'set lock_timeout = ''2s''');
-- Clean first: these fixtures are COMMITTED, so an aborted earlier run would
-- otherwise leave them behind and the next run would fail on a duplicate key
-- instead of on the feature (the #336/#339 precedent). task_activity is
-- append-only by trigger, so the cleanup runs in replica mode.
select extensions.dblink_exec('task_lock_setup', $$
  set session_replication_role = 'replica';
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%Lock Probe%#327');
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%Lock Probe%#327');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%Lock Probe%#327');
  set session_replication_role = 'origin';
  delete from public.tasks
   where parent_task_id in (select id from public.tasks where title = 'Lock Probe Umbrella #327');
  delete from public.tasks where title = 'Lock Probe Umbrella #327';
  delete from auth.users where id in (
    '32700000-0000-0000-0000-000000000021', '32700000-0000-0000-0000-000000000022',
    '32700000-0000-0000-0000-000000000023');
$$);
select extensions.dblink_exec('task_lock_setup', $$
  insert into auth.users (id, email) values
    ('32700000-0000-0000-0000-000000000021', 'lock.probe.bce.327@test.local'),
    ('32700000-0000-0000-0000-000000000022', 'lock.probe.evaluator.327@test.local'),
    ('32700000-0000-0000-0000-000000000023', 'lock.probe.executor.327@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('32700000-0000-0000-0000-000000000021', 'Lock Probe BCE 327',
     'lock.probe.bce.327@test.local', 'bce', 'activ'),
    ('32700000-0000-0000-0000-000000000022', 'Lock Probe Evaluator 327',
     'lock.probe.evaluator.327@test.local', 'bce', 'activ'),
    ('32700000-0000-0000-0000-000000000023', 'Lock Probe Executor 327',
     'lock.probe.executor.327@test.local', 'voluntar', 'activ');
  -- #586: committed race fixtures need an explicit native Group roster.
  insert into public.group_members(group_id,member_id,group_role)
  select g.id,md.member_id,case when p.role='bce' then 'manager' else 'member' end
    from (values ('32700000-0000-0000-0000-000000000021'::uuid, 'edu'),
    ('32700000-0000-0000-0000-000000000022'::uuid, 'edu'),
    ('32700000-0000-0000-0000-000000000023'::uuid, 'edu')) md(member_id,dept_id) join public.groups g on g.name = case md.dept_id when 'edu' then 'Educațional' when 'pr' then 'Imagine & PR' when 'hr' then 'Resurse Umane' when 'fin' then 'Financiar' when 'youth' then 'Tineret' when 'diverse' then 'Diverse' when 'secretariat' then 'Secretariat' when 'org' then 'OSUBB' end
    join public.profiles p on p.id=md.member_id
   where md.member_id::text like '32700000-%'
  on conflict (group_id,member_id) do nothing;
  insert into public.tasks
    (title, group_id, kind, audience, assignment_mode, difficulty, rating, status, created_by)
  values ('Lock Probe Umbrella #327', (select id from public.groups where name = 'Educațional'), 'umbrella', null, null, null, null, 'todo',
          '32700000-0000-0000-0000-000000000021');
  -- An EXISTING Subtask of that Umbrella, already submitted, with a live
  -- Executor: everything private.complete_task_review needs, so that the
  -- third session below runs the real evaluating command and not a stand-in.
  insert into public.tasks
    (title, description, deadline, group_id, audience, assignment_mode, status,
     created_at, started_at, submitted_at, parent_task_id, created_by)
  select 'Lock Probe Subtask Existent #327', 'De evaluat in paralel',
         now() + interval '7 days', (select id from public.groups where name = 'Educațional'), 'local', 'direct', 'in_review',
         now() - interval '5 days', now() - interval '4 days', now() - interval '1 day',
         parent.id, '32700000-0000-0000-0000-000000000021'
    from public.tasks as parent where parent.title = 'Lock Probe Umbrella #327';
  insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
  select id, '32700000-0000-0000-0000-000000000023'::uuid,
         '32700000-0000-0000-0000-000000000021'::uuid, now() - interval '4 days'
    from public.tasks where title = 'Lock Probe Subtask Existent #327';
$$);

select extensions.dblink_connect('task_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('task_lock', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('task_lock', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '32700000-0000-0000-0000-000000000021', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'bce', 'member_level', 5,
      'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text, true)
$$) as remote_claims(setting text);
select extensions.dblink_exec('task_lock', 'set local role authenticated');
select * from extensions.dblink('task_lock', $$
  select (public.create_task('Lock Probe Subtask #327', 'd', now() + interval '7 days', 'local', 'direct', p_parent_task_id => (select id from public.tasks where title = 'Lock Probe Umbrella #327'))).title
$$) as locked_create(title text);

-- (a) and (b) are split for the same reason cancel_task.test.sql:1015 splits
-- its pair: one assertion covering "a lock exists" and "its mode is exactly X"
-- goes RED under every lock mutation and isolates none of them. Note the
-- string pgrowlocks reports is `For No Key Update`; `No Key Update` without
-- the leading `For` is the UPDATER mode, reported once a write has landed on
-- the row -- which never happens here, because creating a Subtask does not
-- touch one column of its parent.
select ok(exists (
  select 1
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.title = 'Lock Probe Umbrella #327'
), '(a) creating a Subtask holds its Umbrella''s tasks row locked at all');
select is((
  select row_lock.modes
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.title = 'Lock Probe Umbrella #327'
), array['For No Key Update'],
  '(b) and, given it is locked, its mode is exactly FOR NO KEY UPDATE -- never For Update, which conflicts with the implicit FK For Key Share private.evaluate_task takes on the very same row (Ruling 20)');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.profiles') as row_lock
    join public.profiles as profile on profile.ctid = row_lock.locked_row
   where profile.id = '32700000-0000-0000-0000-000000000021'
), false), 'create_task holds the actor''s live profile row FOR SHARE');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.group_members') as row_lock
    join public.group_members as membership on membership.ctid = row_lock.locked_row
    join public.groups as authority_group on authority_group.id = membership.group_id
   where membership.member_id = '32700000-0000-0000-0000-000000000021'
     and authority_group.name = 'Educațional'
), false), 'a BCE create holds the Group roster row its authority rests on FOR SHARE');

-- Ruling 20's payoff, reproduced rather than argued. Session task_lock still
-- holds the Umbrella. A THIRD session now evaluates an existing Subtask of
-- that Umbrella through the real public wrapper: private.evaluate_task's
-- parent-naming `subtask_completed` activity row and its coalesced manager
-- notification both take an implicit FK FOR KEY SHARE on the held Umbrella.
-- Under FOR NO KEY UPDATE that passes and the evaluation finishes; under the
-- FOR UPDATE mutation it waits out lock_timeout and this assertion reports
-- 55P03 instead. lock_timeout is deliberately short so the RED case is fast.
select extensions.dblink_connect('task_eval', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('task_eval', $$
  begin;
  set local statement_timeout = '20s';
  set local lock_timeout = '3s';
$$);
select * from extensions.dblink('task_eval', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '32700000-0000-0000-0000-000000000022', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'bce', 'member_level', 5,
      'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text, true)
$$) as eval_claims(setting text);
select extensions.dblink_exec('task_eval', 'set local role authenticated');

-- A lock_timeout propagates out of extensions.dblink as an ordinary error and
-- would abort this pgTAP transaction, so it is caught and turned into a value
-- the assertion can diff. Single-field `(f(...)).status` projection on
-- purpose: two fields would run the command twice (the wave's standing
-- warning).
create function pg_temp.ct327_parallel_evaluation()
returns text
language plpgsql
as $fn$
declare
  v_status text;
begin
  select remote.status into v_status
    from extensions.dblink('task_eval', format($q$
      select (public.complete_task_review(%s, 3, 4, 'Evaluare in paralel cu o creare')).status::text
    $q$, (select task.id from public.tasks as task
           where task.title = 'Lock Probe Subtask Existent #327')))
      as remote(status text);
  return coalesce(v_status, '(no row)');
exception when others then
  return sqlstate;
end;
$fn$;

select is(pg_temp.ct327_parallel_evaluation(), 'completed',
  'a concurrent evaluation of another Subtask of the SAME Umbrella runs straight through while create_task holds that Umbrella -- FOR KEY SHARE does not conflict with FOR NO KEY UPDATE, where FOR UPDATE would have stalled it until lock_timeout (55P03)');

select extensions.dblink_exec('task_eval', 'rollback');
select extensions.dblink_disconnect('task_eval');
select extensions.dblink_exec('task_lock', 'rollback');
select extensions.dblink_disconnect('task_lock');
select extensions.dblink_exec('task_lock_setup', $$
  set session_replication_role = 'replica';
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%Lock Probe%#327');
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%Lock Probe%#327');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%Lock Probe%#327');
  set session_replication_role = 'origin';
  delete from public.tasks
   where parent_task_id in (select id from public.tasks where title = 'Lock Probe Umbrella #327');
  delete from public.tasks where title = 'Lock Probe Umbrella #327';
  delete from auth.users where id in (
    '32700000-0000-0000-0000-000000000021', '32700000-0000-0000-0000-000000000022',
    '32700000-0000-0000-0000-000000000023');
$$);
select extensions.dblink_disconnect('task_lock_setup');

-- ==================== 13. Kit functions exercised directly ====================
-- require_task_visible, require_task_manager, require_task_evaluator,
-- require_task_executor, end_task_assignment and close_task_queue have no
-- caller elsewhere in this suite, so a wrong body would ship unnoticed
-- (review finding I2). None of the six carries a grant to authenticated
-- (conventions Sec4), so every call below runs as the owner: test_login sets
-- request.jwt.claims (session-scoped, survives a role reset within one
-- transaction) and switches the local role to authenticated, then `reset
-- role` returns to the pgTAP-owning superuser role, which bypasses the
-- missing EXECUTE grant while auth.uid() still resolves to the logged-in
-- persona. open_task_assignment and log_task_activity keep their indirect
-- coverage from create_task's own path above; the p_via allow-list (I1)
-- below is their one direct addition.

-- ---- open_task_assignment: the p_via closed allow-list (I1) ----
insert into public.tasks (title, group_id, audience, assignment_mode, status, created_by)
values ('Kit via task #327', pg_temp.dept_group('edu'), 'local', 'direct', 'todo',
        '32700000-0000-0000-0000-000000000005');
select throws_ok(format($$ select private.open_task_assignment(%s,
  '32700000-0000-0000-0000-000000000008'::uuid,
  '32700000-0000-0000-0000-000000000006'::uuid, null) $$,
  (select id from public.tasks where title = 'Kit via task #327')),
  'PT400', 'invalid_assignment_via', 'a null p_via is rejected by the closed allow-list');
select throws_ok(format($$ select private.open_task_assignment(%s,
  '32700000-0000-0000-0000-000000000008'::uuid,
  '32700000-0000-0000-0000-000000000006'::uuid, 'promoted') $$,
  (select id from public.tasks where title = 'Kit via task #327')),
  'PT400', 'invalid_assignment_via', 'an unknown p_via is rejected by the closed allow-list');

-- ---- open_task_assignment: 'reopen' writes activity but skips the "Task nou" notification (I1) ----
insert into public.tasks (title, group_id, audience, assignment_mode, status, created_by)
values ('Kit reopen task #327', pg_temp.dept_group('edu'), 'local', 'direct', 'todo',
        '32700000-0000-0000-0000-000000000005');
select lives_ok(format($$ select private.open_task_assignment(%s,
  '32700000-0000-0000-0000-000000000008'::uuid,
  '32700000-0000-0000-0000-000000000006'::uuid, 'reopen') $$,
  (select id from public.tasks where title = 'Kit reopen task #327')),
  'open_task_assignment accepts the pinned reopen value');
select is((select format('%s|%s', activity.kind, activity.details ->> 'via')
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Kit reopen task #327'),
  'executor_assigned|reopen',
  'reopen still writes the executor_assigned activity row');
select is((select count(*) from public.notifications as notification
             join public.tasks as task on task.id = notification.task_id
            where task.title = 'Kit reopen task #327'), 0::bigint,
  'reopen suppresses the "Task nou" notification (#338 depends on this skip)');

-- ---- require_task_visible ----
select pg_temp.test_login('32700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
reset role;
select is((select private.require_task_visible((select plain_task_id from f327))),
  '32700000-0000-0000-0000-000000000006'::uuid,
  'require_task_visible returns the actor for a Task they may read');

select pg_temp.test_login('32700000-0000-0000-0000-000000000011',
  jsonb_build_object('provider', 'email'));
reset role;
select throws_ok($$ select private.require_task_visible(
  (select plain_task_id from f327)) $$, '42501', 'task_command_forbidden',
  'require_task_visible denies a claimless real uid');

select pg_temp.test_login('32700000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
reset role;
select throws_ok($$ select private.require_task_visible(
  (select plain_task_id from f327)) $$, 'PT404', 'task_not_found',
  'require_task_visible reports a Task an ordinary Department member cannot read as not found');

-- ---- require_task_manager ----
select pg_temp.test_login('32700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
reset role;
select is((select private.require_task_manager((select plain_task_id from f327))),
  '32700000-0000-0000-0000-000000000006'::uuid,
  'require_task_manager returns the actor for their own Department''s Task');
select throws_ok($$ select private.require_task_manager(
  (select missing_id from f327)) $$, 'PT404', 'task_not_found',
  'require_task_manager reports an unknown Task as not found');

select pg_temp.test_login('32700000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
reset role;
select throws_ok($$ select private.require_task_manager(
  (select plain_task_id from f327)) $$, '42501', 'task_manage_forbidden',
  'require_task_manager denies an ordinary Department member');

-- ---- require_task_evaluator ----
select pg_temp.test_login('32700000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
reset role;
select is((select private.require_task_evaluator((select plain_task_id from f327))),
  '32700000-0000-0000-0000-000000000005'::uuid,
  'require_task_evaluator returns the actor for BC anywhere');
select throws_ok($$ select private.require_task_evaluator(
  (select missing_id from f327)) $$, 'PT404', 'task_not_found',
  'require_task_evaluator reports an unknown Task as not found');

select pg_temp.test_login('32700000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb,
  'team_ids', '["t-327-ind"]'::jsonb));
reset role;
select throws_ok($$ select private.require_task_evaluator(
  (select ind_task_id from f327)) $$, '42501', 'task_evaluate_forbidden',
  'require_task_evaluator denies an Independent-Team member even though they manage the same Task');

-- ---- require_task_executor ----
select pg_temp.test_login('32700000-0000-0000-0000-000000000009', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["pr"]'::jsonb, 'team_ids', '[]'::jsonb));
reset role;
select is((select private.require_task_executor(
    (select id from public.tasks where title = 'Direct #327'))),
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'Direct #327' and assignment.ended_at is null),
  'require_task_executor returns the active Assignment id for its Executor');

select pg_temp.test_login('32700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
reset role;
select throws_ok($$ select private.require_task_executor(
  (select id from public.tasks where title = 'Direct #327')) $$,
  '42501', 'task_executor_forbidden',
  'require_task_executor denies the creator, who is not the Executor');

-- M1: organisation claims are required even for the correct Executor —
-- without this gate, a claimless real uid holding the one active Assignment
-- would pass on the live-activ-profile check alone.
insert into public.tasks (title, group_id, audience, assignment_mode, status, created_by)
values ('Kit executor claimless task #327', pg_temp.dept_group('edu'), 'local', 'direct', 'todo',
        '32700000-0000-0000-0000-000000000005');
insert into public.task_assignments (task_id, member_id, assigned_by)
select task.id, '32700000-0000-0000-0000-000000000011',
       '32700000-0000-0000-0000-000000000005'
  from public.tasks as task where task.title = 'Kit executor claimless task #327';
select pg_temp.test_login('32700000-0000-0000-0000-000000000011',
  jsonb_build_object('provider', 'email'));
reset role;
select throws_ok($$ select private.require_task_executor(
  (select id from public.tasks where title = 'Kit executor claimless task #327')) $$,
  '42501', 'task_executor_forbidden',
  'require_task_executor requires organisation claims even for the Assignment''s own member_id (M1)');

-- ---- end_task_assignment ----
insert into public.tasks (title, group_id, audience, assignment_mode, status, created_by)
values ('Kit end assignment task #327', pg_temp.dept_group('edu'), 'local', 'direct', 'todo',
        '32700000-0000-0000-0000-000000000005');
select private.open_task_assignment(
  (select id from public.tasks where title = 'Kit end assignment task #327'),
  '32700000-0000-0000-0000-000000000008'::uuid,
  '32700000-0000-0000-0000-000000000006'::uuid, 'create');

select lives_ok(format($$ select private.end_task_assignment(%s, 'completed', E'  bine facut  ') $$,
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'Kit end assignment task #327')),
  'end_task_assignment ends the one active Assignment');
select is((select format('%s|%s|%s', (assignment.ended_at is not null)::text,
                         assignment.end_reason, assignment.end_note)
             from public.task_assignments as assignment
             join public.tasks as task on task.id = assignment.task_id
            where task.title = 'Kit end assignment task #327'),
  'true|completed|bine facut',
  'end_task_assignment sets ended_at/end_reason and trims a whitespace-padded note with regexp_replace');
select throws_ok(format($$ select private.end_task_assignment(%s, 'completed', null) $$,
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'Kit end assignment task #327')),
  'PT409', 'assignment_not_active',
  'end_task_assignment refuses to end an already-ended Assignment');

-- ---- close_task_queue ----
insert into public.tasks (title, group_id, audience, assignment_mode, status, queue_opened_at, created_by)
values ('Kit queue task #327', pg_temp.dept_group('edu'), 'org', 'public', 'todo', now(),
        '32700000-0000-0000-0000-000000000005');
insert into public.task_candidates (task_id, member_id, status, joined_at)
select task.id, candidate_id, 'pending', now()
  from public.tasks as task,
       unnest(array['32700000-0000-0000-0000-000000000008'::uuid,
                     '32700000-0000-0000-0000-000000000009'::uuid]) as candidate_id
 where task.title = 'Kit queue task #327';

select set_eq(
  $$ select member_id from unnest(private.close_task_queue(
       (select id from public.tasks where title = 'Kit queue task #327'),
       '32700000-0000-0000-0000-000000000006')) as member_id $$,
  $$ values ('32700000-0000-0000-0000-000000000008'::uuid),
            ('32700000-0000-0000-0000-000000000009'::uuid) $$,
  'close_task_queue returns exactly the pending Candidates it closed');
select ok((select task.queue_closed_at is not null from public.tasks as task
           where task.title = 'Kit queue task #327'),
  'close_task_queue sets queue_closed_at on the public Task');
select is((select count(*) from public.task_candidates as candidate
             join public.tasks as task on task.id = candidate.task_id
            where task.title = 'Kit queue task #327'
              and candidate.status = 'closed'
              and candidate.decided_at is not null
              and candidate.assignment_id is null
              and candidate.decided_by = '32700000-0000-0000-0000-000000000006'),
  2::bigint, 'both closed Candidates carry decided_at, no assignment_id, and the closing manager as decided_by');
select is((select private.close_task_queue(
    (select id from public.tasks where title = 'Kit queue task #327'),
    '32700000-0000-0000-0000-000000000006')),
  '{}'::uuid[], 'a second close_task_queue call on an already-closed queue is a no-op and returns no members');
select is((select private.close_task_queue(
    (select id from public.tasks where title = 'Direct #327'),
    '32700000-0000-0000-0000-000000000006')),
  '{}'::uuid[], 'close_task_queue is a no-op on a direct Task and returns no members');
select is((select task.queue_closed_at from public.tasks as task where task.title = 'Direct #327'),
  null::timestamptz,
  'a direct Task keeps queue_closed_at null after a no-op close_task_queue');


-- #521: Group authority regression matrix.
\ir _group_task_fixtures.psql
reset role;
select pg_temp.g521_task('command0','project',null,'todo','direct','umbrella');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($$select public.create_task('Subtask #521', null, now()+interval '1 day', 'local', 'direct', p_executor_id => pg_temp.g521_uid(10), p_parent_task_id => (select id from g521_tasks where name='command0'))$$,'create_task: Group persona 2 in project');
reset role;
select pg_temp.g521_task('command1','project',null,'todo','direct','umbrella');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select lives_ok($$select public.create_task('Subtask #521', null, now()+interval '1 day', 'local', 'direct', p_executor_id => pg_temp.g521_uid(10), p_parent_task_id => (select id from g521_tasks where name='command1'))$$,'create_task: Group persona 3 in project');
reset role;
select pg_temp.g521_task('command2','ind',null,'todo','direct','umbrella');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(6));
select lives_ok($$select public.create_task('Subtask #521', null, now()+interval '1 day', 'local', 'direct', p_executor_id => pg_temp.g521_uid(10), p_parent_task_id => (select id from g521_tasks where name='command2'))$$,'create_task: Group persona 6 in ind');
reset role;
select pg_temp.g521_task('command3','dt',null,'todo','direct','umbrella');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(8));
select throws_ok($$select public.create_task('Subtask #521', null, now()+interval '1 day', 'local', 'direct', p_executor_id => pg_temp.g521_uid(10), p_parent_task_id => (select id from g521_tasks where name='command3'))$$,'42501','task_manage_forbidden','create_task: Group persona 8 in dt');
reset role;

-- ==================== #673: constraints kit (R8) ====================
-- Step 1 answers before the gate: a claimless caller hears the reason, not 42501.
reset role;
select pg_temp.test_login('67300000-0000-0000-0000-000000000001', '{"provider":"email"}'::jsonb);
select throws_ok($$ select public.create_task(repeat('t', 121), 'd', now() + interval '7 days', 'local', 'direct') $$,
  'PT400', 'title_too_long', 'a title over 120 characters is refused before the gate');
select throws_ok($$ select public.create_task('  ab  ', 'd', now() + interval '7 days', 'local', 'direct') $$,
  'PT400', 'title_too_short', 'the title is measured trimmed: "  ab  " is two characters, too short');
select throws_ok($$ select public.create_task(E'\t' || repeat('t', 120) || '  ', 'd', now() + interval '7 days', 'local', 'direct') $$,
  '42501', 'task_command_forbidden', 'surrounding whitespace does not count: a trimmed 120-character title passes step 1 and meets the gate');
select throws_ok($$ select public.create_task('Titlu bun #673', repeat('d', 2001), now() + interval '7 days', 'local', 'direct') $$,
  'PT400', 'description_too_long', 'a description over 2000 characters is refused before the gate');
select throws_ok($$ select public.create_task('Titlu bun #673', 'd', now() - interval '1 day', 'local', 'direct') $$,
  'PT400', 'deadline_in_past', 'a deadline in the past is refused at creation, before the gate');
reset role;

-- ==================== #684: the Attached Link (R7) ====================
-- The schema: the pair is held by tasks_link_ck, the rules underneath by
-- tasks_link_format_ck. Named, never null (Ruling 23).
select col_type_is('public', 'tasks', 'link_label', 'text', 'tasks.link_label is text');
select col_type_is('public', 'tasks', 'link_url', 'text', 'tasks.link_url is text');
select is((select pg_get_constraintdef(oid) from pg_constraint
            where conrelid = 'public.tasks'::regclass and conname = 'tasks_link_ck'),
  'CHECK (((link_url IS NULL) = (link_label IS NULL)))',
  'tasks_link_ck: the label and the address are set together or not at all');
select throws_ok($$ update public.tasks set link_label = 'Doar eticheta' where title = 'BC dept task #327' $$,
  '23514', 'new row for relation "tasks" violates check constraint "tasks_link_ck"',
  'a direct half-set write is refused by tasks_link_ck');
select throws_ok($$ update public.tasks set link_label = 'FTP', link_url = 'ftp://example.org' where title = 'BC dept task #327' $$,
  '23514', 'new row for relation "tasks" violates check constraint "tasks_link_format_ck"',
  'a direct non-http(s) write is refused by tasks_link_format_ck');

select pg_temp.test_login('32700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok($$ select public.create_task('Cu link #684', 'd', now() + interval '7 days', 'local', 'direct',
    p_group_id => pg_temp.dept_group('edu'), p_link_label => '  Brief  ', p_link_url => E'\thttps://example.org/brief  ') $$,
  'create_task accepts both link fields');
select lives_ok($$ select public.create_task('Fara link #684', 'd', now() + interval '7 days', 'local', 'direct',
    p_group_id => pg_temp.dept_group('edu'), p_link_label => '   ', p_link_url => null) $$,
  'create_task treats a blank label with no address as no link at all');
select lives_ok($$ select public.create_task('Umbrela cu link #684', 'd', null, null, null, p_kind => 'umbrella',
    p_group_id => pg_temp.dept_group('edu'), p_link_label => 'Plan', p_link_url => 'https://example.org/plan') $$,
  'an Umbrella may carry a link like any Task');
select throws_ok($$ select public.create_task('Link incomplet #684', 'd', now() + interval '7 days', 'local', 'direct',
    p_group_id => pg_temp.dept_group('edu'), p_link_label => 'Doar eticheta') $$,
  'PT400', 'link_incomplete', 'one of the two link fields alone is refused');
select throws_ok($$ select public.create_task('Link ftp #684', 'd', now() + interval '7 days', 'local', 'direct',
    p_group_id => pg_temp.dept_group('edu'), p_link_label => 'FTP', p_link_url => 'ftp://example.org/x') $$,
  'PT400', 'link_url_invalid', 'a non-http(s) address is refused');
select throws_ok($$ select public.create_task('Link lung #684', 'd', now() + interval '7 days', 'local', 'direct',
    p_group_id => pg_temp.dept_group('edu'), p_link_label => 'Lung', p_link_url => 'https://example.org/' || repeat('u', 2030)) $$,
  'PT400', 'link_url_too_long', 'an address over 2048 characters is refused');
select throws_ok($$ select public.create_task('Eticheta lunga #684', 'd', now() + interval '7 days', 'local', 'direct',
    p_group_id => pg_temp.dept_group('edu'), p_link_label => repeat('e', 61), p_link_url => 'https://example.org/x') $$,
  'PT400', 'link_label_too_long', 'a label over 60 characters is refused');
reset role;
select is((select format('%s|%s', task.link_label, task.link_url) from public.tasks as task where task.title = 'Cu link #684'),
  'Brief|https://example.org/brief', 'both link fields are stored trimmed');
select is((select format('%s|%s', task.link_label is null, task.link_url is null) from public.tasks as task where task.title = 'Fara link #684'),
  't|t', 'with neither link field both columns are null');
select is((select task.link_url from public.tasks as task where task.title = 'Umbrela cu link #684'),
  'https://example.org/plan', 'the Umbrella keeps its link');
-- Step 1: the pair rule answers a claimless caller before the gate.
select pg_temp.test_login('67300000-0000-0000-0000-000000000001', '{"provider":"email"}'::jsonb);
select throws_ok($$ select public.create_task('Titlu bun #684', 'd', now() + interval '7 days', 'local', 'direct',
    p_link_url => 'https://example.org/x') $$,
  'PT400', 'link_incomplete', 'a half-set link is refused before the gate');
reset role;

select * from finish();
rollback;
