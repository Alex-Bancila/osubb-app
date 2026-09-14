-- #327: public.create_task — the only way a Task is created — plus the
-- authority kit every later Task command reuses (private.require_task_visible,
-- require_origin_manager, require_task_manager, require_task_evaluator,
-- require_task_executor, can_evaluate_task, log_task_activity,
-- open_task_assignment, end_task_assignment, close_task_queue).
--
-- Only create_task and can_evaluate_task have a caller in this branch, so
-- those two are exercised behaviourally here; the remaining require_*/writer
-- helpers are pinned by signature, security posture and grant
-- (tracker_grants.test.sql, conventions.test.sql) and get their behavioural
-- coverage from the commands that call them (#328-#345).
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

select plan(101);

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

insert into public.member_departments (member_id, dept_id) values
  ('32700000-0000-0000-0000-000000000006', 'edu'),
  ('32700000-0000-0000-0000-000000000007', 'pr'),
  ('32700000-0000-0000-0000-000000000008', 'edu'),
  ('32700000-0000-0000-0000-000000000009', 'pr');

insert into public.teams (id, name, dept_id) values
  ('t-327-ind', 'Echipa Independenta 327', null),
  ('t-327-dt', 'Echipa Departamentala 327', 'edu');

insert into public.team_members (team_id, member_id) values
  ('t-327-ind', '32700000-0000-0000-0000-000000000004');

insert into public.projects (name, status, leader_id, created_by)
values ('Proiect #327', 'active',
        '32700000-0000-0000-0000-000000000001',
        '32700000-0000-0000-0000-000000000005'),
       ('Proiect arhivat #327', 'archived',
        '32700000-0000-0000-0000-000000000001',
        '32700000-0000-0000-0000-000000000005');

insert into public.project_members (project_id, member_id, project_role) values
  ((select id from public.projects where name = 'Proiect #327'),
   '32700000-0000-0000-0000-000000000002', 'responsible'),
  ((select id from public.projects where name = 'Proiect #327'),
   '32700000-0000-0000-0000-000000000003', 'member');

insert into public.campaigns (department_id, name, is_active, created_by) values
  ('edu', 'Campanie #327', true, '32700000-0000-0000-0000-000000000005'),
  ('pr', 'Campanie PR #327', true, '32700000-0000-0000-0000-000000000005'),
  ('edu', 'Campanie inactiva #327', false, '32700000-0000-0000-0000-000000000005');

-- An Umbrella must pass explicit nulls for audience/assignment_mode (the
-- column defaults would otherwise land it in an invalid shape, #315).
insert into public.tasks
  (title, dept_id, kind, audience, assignment_mode, difficulty, rating, status, created_by)
values
  ('Umbrela #327', 'edu', 'umbrella', null, null, null, null, 'todo',
   '32700000-0000-0000-0000-000000000005');

insert into public.tasks
  (title, dept_id, kind, audience, assignment_mode, status, cancelled_at, created_by)
values
  ('Umbrela anulata #327', 'edu', 'umbrella', null, null, 'cancelled', now(),
   '32700000-0000-0000-0000-000000000005');

insert into public.tasks (title, dept_id, audience, assignment_mode, status, created_by)
values ('Nu e umbrela #327', 'edu', 'local', 'direct', 'todo',
        '32700000-0000-0000-0000-000000000005');

insert into public.tasks (title, team_id, audience, assignment_mode, status, created_by)
values ('Task independent #327', 't-327-ind', 'local', 'direct', 'todo',
        '32700000-0000-0000-0000-000000000005');

insert into public.tasks (title, project_id, audience, assignment_mode, status, created_by)
select 'Task proiect #327', project.id, 'local', 'direct', 'todo',
       '32700000-0000-0000-0000-000000000005'
  from public.projects as project where project.name = 'Proiect #327';

insert into public.tasks (title, project_id, audience, assignment_mode, status, created_by)
select 'Task proiect lead executant #327', project.id, 'local', 'direct', 'in_progress',
       '32700000-0000-0000-0000-000000000005'
  from public.projects as project where project.name = 'Proiect #327';

insert into public.tasks (title, project_id, audience, assignment_mode, status, created_by)
select 'Task proiect responsabil executant #327', project.id, 'local', 'direct', 'in_progress',
       '32700000-0000-0000-0000-000000000005'
  from public.projects as project where project.name = 'Proiect #327';

insert into public.tasks (title, project_id, audience, assignment_mode, status, created_by)
select 'Task proiect arhivat #327', project.id, 'local', 'direct', 'todo',
       '32700000-0000-0000-0000-000000000005'
  from public.projects as project where project.name = 'Proiect arhivat #327';

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
  (select id from public.projects where name = 'Proiect #327') as project_id,
  (select id from public.projects where name = 'Proiect arhivat #327') as archived_project_id,
  (select id from public.campaigns where department_id = 'edu' and name = 'Campanie #327') as edu_campaign_id,
  (select id from public.campaigns where department_id = 'pr' and name = 'Campanie PR #327') as pr_campaign_id,
  (select id from public.campaigns where department_id = 'edu' and name = 'Campanie inactiva #327') as inactive_campaign_id,
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
  array['text', 'text', 'timestamptz', 'text', 'text', 'bigint', 'text', 'text',
        'uuid', 'bigint', 'bigint', 'text'],
  'public.create_task exists with the pinned twelve-parameter signature');

select is(pg_get_function_identity_arguments(
    'public.create_task(text,text,timestamptz,text,text,bigint,text,text,uuid,bigint,bigint,text)'::regprocedure),
  'p_title text, p_description text, p_deadline timestamp with time zone, p_dept_id text, p_team_id text, p_project_id bigint, p_audience text, p_assignment_mode text, p_executor_id uuid, p_campaign_id bigint, p_parent_task_id bigint, p_kind text',
  'create_task exposes no actor parameter — the actor is always auth.uid()');

select is(pg_get_function_result(
    'public.create_task(text,text,timestamptz,text,text,bigint,text,text,uuid,bigint,bigint,text)'::regprocedure),
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
       'require_origin_manager', 'require_task_manager', 'require_task_evaluator',
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
           ('can_evaluate_task', 'require_task_visible', 'require_origin_manager',
            'require_task_manager', 'require_task_evaluator', 'require_task_executor',
            'log_task_activity', 'open_task_assignment', 'end_task_assignment',
            'close_task_queue', 'create_task_impl'))
), false), 'every function in the kit pins an empty search_path');

select ok(has_function_privilege('authenticated',
  'public.create_task(text,text,timestamptz,text,text,bigint,text,text,uuid,bigint,bigint,text)'::regprocedure,
  'execute'), 'authenticated can execute public.create_task');

select ok(not has_function_privilege('anon',
  'public.create_task(text,text,timestamptz,text,text,bigint,text,text,uuid,bigint,bigint,text)'::regprocedure,
  'execute'), 'anon cannot execute public.create_task');

select ok(has_function_privilege('authenticated',
  'private.create_task_impl(text,text,timestamptz,text,text,bigint,text,text,uuid,bigint,bigint,text)'::regprocedure,
  'execute'), 'authenticated can execute private.create_task_impl');

select ok(has_function_privilege('authenticated',
  'private.can_evaluate_task(bigint)'::regprocedure, 'execute'),
  'authenticated can execute the can_evaluate_task predicate (it answers policies too)');

select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private'
     and procedure.proname in ('require_task_visible', 'require_origin_manager',
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
select lives_ok($$ select public.create_task('Dept task #327', 'd', now() + interval '7 days',
  'edu', null, null, 'local', 'direct') $$, 'the local BCE creates a Department Task');
select throws_ok($$ select public.create_task('Foreign #327', 'd', now() + interval '7 days',
  'pr', null, null, 'local', 'direct') $$, '42501', 'task_manage_forbidden',
  'a BCE of another Department cannot create there');
select lives_ok($$ select public.create_task('Dept team task #327', 'd', now() + interval '7 days',
  null, 't-327-dt', null, 'local', 'direct') $$,
  'the local BCE creates a Task on a Department Team of their own Department');
select throws_ok($$ select public.create_task('Ind by bce #327', 'd', now() + interval '7 days',
  null, 't-327-ind', null, 'local', 'direct') $$, '42501', 'task_manage_forbidden',
  'a BCE has no authority over an Independent Team they are not a member of');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok($$ select public.create_task('BC dept task #327', 'd', now() + interval '7 days',
  'edu', null, null, 'local', 'direct') $$, 'BC creates a Task in any Department');
select lives_ok($$ select public.create_task('BC ind task #327', 'd', now() + interval '7 days',
  null, 't-327-ind', null, 'local', 'direct') $$, 'BC creates a Task on an Independent Team');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["pr"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$ select public.create_task('PR bce in edu #327', 'd', now() + interval '7 days',
  'edu', null, null, 'local', 'direct') $$, '42501', 'task_manage_forbidden',
  'the PR BCE cannot create an EDU Task');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$ select public.create_task('Member dept #327', 'd', now() + interval '7 days',
  'edu', null, null, 'local', 'direct') $$, '42501', 'task_manage_forbidden',
  'an ordinary Department member cannot create a Department Task');
select throws_ok($$ select public.create_task('Member ind #327', 'd', now() + interval '7 days',
  null, 't-327-ind', null, 'local', 'direct') $$, '42501', 'task_manage_forbidden',
  'an ordinary member cannot create a Task on an Independent Team they do not belong to');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb,
  'team_ids', '["t-327-ind"]'::jsonb));
select lives_ok($$ select public.create_task('Ind team task #327', 'd', now() + interval '7 days',
  null, 't-327-ind', null, 'local', 'direct') $$,
  'an Independent-Team member creates a Task on their own Team');
select throws_ok($$ select public.create_task('Ind member in edu #327', 'd', now() + interval '7 days',
  'edu', null, null, 'local', 'direct') $$, '42501', 'task_manage_forbidden',
  'an Independent-Team member has no authority in a Department');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.create_task('Lead project task #327', 'd',
  now() + interval '7 days', null, null, %s, 'local', 'direct') $$,
  (select project_id from f327)), 'the Project lead creates a Task on their Project');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.create_task('Responsible project task #327', 'd',
  now() + interval '7 days', null, null, %s, 'local', 'direct') $$,
  (select project_id from f327)), 'a Project Responsible creates a Task on the Project');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.create_task('Plain project member #327', 'd',
  now() + interval '7 days', null, null, %s, 'local', 'direct') $$,
  (select project_id from f327)), '42501', 'task_manage_forbidden',
  'a plain Project member cannot create a Project Task');
reset role;

-- private.can_manage_origin's Project branch is private.can_manage_project_work,
-- which requires projects.status = 'active' -- so the lead of an archived
-- Project loses their write authority over it (BC/Moderator keep theirs
-- through the global level >= 6 branch, which sits above the Project branch).
select pg_temp.test_login('32700000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.create_task('Archived project #327', 'd',
  now() + interval '7 days', null, null, %s, 'local', 'direct') $$,
  (select archived_project_id from f327)), '42501', 'task_manage_forbidden',
  'the lead of an archived Project can no longer create Tasks on it');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000010', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$ select public.create_task('Deactivated bc #327', 'd', now() + interval '7 days',
  'edu', null, null, 'local', 'direct') $$, '42501', 'task_command_forbidden',
  'a deactivated BC holding a still-valid level-6 token is denied by the gate');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000011',
  jsonb_build_object('provider', 'email'));
select throws_ok($$ select public.create_task('Claimless #327', 'd', now() + interval '7 days',
  'edu', null, null, 'local', 'direct') $$, '42501', 'task_command_forbidden',
  'a real uid without organisation claims is denied by the gate');
reset role;

set local role anon;
select throws_ok($$ select public.create_task('Anon #327', 'd', now() + interval '7 days',
  'edu', null, null, 'local', 'direct') $$, '42501', null,
  'anon cannot execute create_task at all');
reset role;

-- ==================== 3. Malformed input runs before the gate ====================
-- Step 1 of the binding step order (the #343 set_campaign_active precedent):
-- input that is malformed for every caller is rejected before authority.
select pg_temp.test_login('32700000-0000-0000-0000-000000000011',
  jsonb_build_object('provider', 'email'));
select throws_ok($$ select public.create_task('Bad kind #327', 'd', now() + interval '7 days',
  'edu', null, null, 'local', 'direct', null, null, null, null) $$,
  'PT400', 'invalid_task_kind',
  'a null kind is rejected before the gate, even for a claimless caller');
reset role;

select pg_temp.test_login('32700000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$ select public.create_task('Bad kind #327', 'd', now() + interval '7 days',
  'edu', null, null, 'local', 'direct', null, null, null, 'epic') $$,
  'PT400', 'invalid_task_kind', 'an unknown kind is rejected');
select throws_ok(format($$ select public.create_task('Two origins #327', 'd',
  now() + interval '7 days', 'edu', null, %s, 'local', 'direct') $$,
  (select project_id from f327)), 'PT400', 'invalid_origin',
  'two Origins are rejected');
select throws_ok($$ select public.create_task('No origin #327', 'd', now() + interval '7 days',
  null, null, null, 'local', 'direct') $$, 'PT400', 'invalid_origin',
  'no Origin is rejected');
reset role;

-- ==================== 4. Input validation ====================
select pg_temp.test_login('32700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$ select public.create_task('   ', 'd', now() + interval '7 days',
  'edu', null, null, 'local', 'direct') $$, 'PT400', 'title_required',
  'a blank title is rejected');
select throws_ok($$ select public.create_task(null, 'd', now() + interval '7 days',
  'edu', null, null, 'local', 'direct') $$, 'PT400', 'title_required',
  'a null title is rejected');
select throws_ok($$ select public.create_task('No deadline #327', 'd', null,
  'edu', null, null, 'local', 'direct') $$, 'PT400', 'deadline_required',
  'an ordinary Task requires a deadline');
select throws_ok($$ select public.create_task('Bad audience #327', 'd', now() + interval '7 days',
  'edu', null, null, 'worldwide', 'direct') $$, 'PT400', 'invalid_audience',
  'an unknown Audience is rejected');
select throws_ok($$ select public.create_task('Bad mode #327', 'd', now() + interval '7 days',
  'edu', null, null, 'local', 'auction') $$, 'PT400', 'invalid_assignment_mode',
  'an unknown Assignment Mode is rejected');
select lives_ok($$ select public.create_task(E'\t Trimmed #327 \t', E'  spatiat  ',
  now() + interval '7 days', 'edu', null, null, 'local', 'direct') $$,
  'a padded title and description are accepted');
reset role;
select is((select count(*) from public.tasks where title = 'Trimmed #327'), 1::bigint,
  'the title is stored trimmed with regexp_replace, not btrim (tabs included)');
select is((select description from public.tasks where title = 'Trimmed #327'), 'spatiat',
  'the description is stored trimmed');

-- ==================== 5. Direct Assignment Mode with an Executor ====================
select pg_temp.test_login('32700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok($$ select public.create_task('Direct #327', 'd', now() + interval '7 days',
  'edu', null, null, 'local', 'direct', '32700000-0000-0000-0000-000000000009') $$,
  'any active member may be the direct Executor, even outside the Origin');
select throws_ok($$ select public.create_task('Bad exec #327', 'd', now() + interval '7 days',
  'edu', null, null, 'local', 'direct', '32700000-0000-0000-0000-000000000010') $$,
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
select ok((select notification.body like 'Ți-a fost atribuit acest task. Deadline: %'
             from public.notifications as notification
             join public.tasks as task on task.id = notification.task_id
            where task.title = 'Direct #327'),
  'the Executor notification body carries the formatted deadline');

-- A denied create writes nothing at all.
select pg_temp.test_login('32700000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$ select public.create_task('Denied #327', 'd', now() + interval '7 days',
  'edu', null, null, 'local', 'direct', '32700000-0000-0000-0000-000000000009') $$,
  '42501', 'task_manage_forbidden', 'an ordinary member cannot create a Task with an Executor');
reset role;
select is((select count(*) from public.tasks where title = 'Denied #327'), 0::bigint,
  'a denied create writes no Task');
select is((select count(*) from public.notifications where title = 'Task nou: Denied #327'),
  0::bigint, 'a denied create writes no notification');

-- ==================== 6. Public Assignment Mode ====================
select pg_temp.test_login('32700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok($$ select public.create_task('Public #327', 'd', now() + interval '7 days',
  'edu', null, null, 'org', 'public') $$, 'a public Task is created without an Executor');
select throws_ok($$ select public.create_task('Public with exec #327', 'd',
  now() + interval '7 days', 'edu', null, null, 'org', 'public',
  '32700000-0000-0000-0000-000000000009') $$,
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
select lives_ok(format($$ select public.create_task('Subtask #327', 'd',
  now() + interval '7 days', null, null, null, 'local', 'direct', null, null, %s, 'task') $$,
  (select umbrella_id from f327)),
  'a Subtask is created with null Origin parameters and inherits the Umbrella''s');
select throws_ok(format($$ select public.create_task('Subtask mismatch #327', 'd',
  now() + interval '7 days', 'pr', null, null, 'local', 'direct', null, null, %s, 'task') $$,
  (select umbrella_id from f327)), 'PT400', 'subtask_origin_mismatch',
  'a Subtask Origin that contradicts its Umbrella is rejected, never silently overwritten');
select throws_ok(format($$ select public.create_task('Subtask of a task #327', 'd',
  now() + interval '7 days', null, null, null, 'local', 'direct', null, null, %s, 'task') $$,
  (select plain_task_id from f327)), 'PT409', 'parent_not_umbrella',
  'an ordinary Task cannot be a parent');
select throws_ok(format($$ select public.create_task('Subtask of a cancelled umbrella #327', 'd',
  now() + interval '7 days', null, null, null, 'local', 'direct', null, null, %s, 'task') $$,
  (select cancelled_umbrella_id from f327)), 'PT409', 'parent_terminal',
  'a terminal Umbrella takes no new Subtasks');
select throws_ok(format($$ select public.create_task('Subumbrella #327', 'd',
  now() + interval '7 days', null, null, null, null, null, null, null, %s, 'umbrella') $$,
  (select umbrella_id from f327)), 'PT400', 'subtask_cannot_be_umbrella',
  'a Subtask cannot itself be an Umbrella');
select throws_ok(format($$ select public.create_task('Orphan subtask #327', 'd',
  now() + interval '7 days', null, null, null, 'local', 'direct', null, null, %s, 'task') $$,
  (select missing_id from f327)), 'PT404', 'task_not_found',
  'an unknown or invisible Umbrella is not found');
reset role;
select is((select format('%s|%s|%s', task.dept_id, (task.team_id is null)::text,
                         (task.project_id is null)::text)
             from public.tasks as task where task.title = 'Subtask #327'),
  'edu|true|true', 'the Subtask inherited the Umbrella''s Department Origin');

-- ==================== 8. Campaigns ====================
select pg_temp.test_login('32700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.create_task('Campaign task #327', 'd',
  now() + interval '7 days', 'edu', null, null, 'local', 'direct', null, %s) $$,
  (select edu_campaign_id from f327)), 'an EDU Campaign attaches to an EDU Task');
select throws_ok(format($$ select public.create_task('Wrong campaign #327', 'd',
  now() + interval '7 days', 'edu', null, null, 'local', 'direct', null, %s) $$,
  (select pr_campaign_id from f327)), 'PT400', 'invalid_campaign',
  'a Campaign from another Department is mapped from the #314 trigger''s 23514 to PT400');
select throws_ok(format($$ select public.create_task('Inactive campaign #327', 'd',
  now() + interval '7 days', 'edu', null, null, 'local', 'direct', null, %s) $$,
  (select inactive_campaign_id from f327)), 'PT400', 'invalid_campaign',
  'a deactivated Campaign cannot be attached to a new Task');
select throws_ok(format($$ select public.create_task('Unknown campaign #327', 'd',
  now() + interval '7 days', 'edu', null, null, 'local', 'direct', null, %s) $$,
  (select missing_id from f327)), 'PT400', 'invalid_campaign',
  'an unknown Campaign id is a PT400 on a parameter, not a PT404 on the target');
reset role;
select is((select task.campaign_id from public.tasks as task where task.title = 'Campaign task #327'),
  (select edu_campaign_id from f327), 'the accepted Campaign is stored on the Task');

-- A shape violation that is not the Campaign check must still surface as 23514.
select pg_temp.test_login('32700000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.create_task('Campaign on a project #327', 'd',
  now() + interval '7 days', null, null, %s, 'local', 'direct', null, %s) $$,
  (select project_id from f327), (select edu_campaign_id from f327)),
  'PT400', 'invalid_campaign',
  'a Campaign on a Project Origin is the same origin-mismatch reason, still PT400');
reset role;

-- ==================== 9. Umbrellas ====================
select pg_temp.test_login('32700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok($$ select public.create_task('Umbrela noua #327', 'd', null,
  'edu', null, null, null, null, null, null, null, 'umbrella') $$,
  'an Umbrella is created with no Audience, Assignment Mode or deadline');
select throws_ok($$ select public.create_task('Umbrela cu audienta #327', 'd', null,
  'edu', null, null, 'local', null, null, null, null, 'umbrella') $$,
  'PT400', 'umbrella_has_no_mode', 'an Umbrella rejects an Audience');
select throws_ok($$ select public.create_task('Umbrela cu mod #327', 'd', null,
  'edu', null, null, null, 'public', null, null, null, 'umbrella') $$,
  'PT400', 'umbrella_has_no_mode', 'an Umbrella rejects an Assignment Mode');
select throws_ok($$ select public.create_task('Umbrela cu executant #327', 'd', null,
  'edu', null, null, null, null, '32700000-0000-0000-0000-000000000009', null, null, 'umbrella') $$,
  'PT400', 'umbrella_has_no_mode', 'an Umbrella rejects an Executor');
select throws_ok(format($$ select public.create_task('Umbrela cu campanie #327', 'd', null,
  'edu', null, null, null, null, null, %s, null, 'umbrella') $$,
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

select pg_temp.test_login('32700000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb,
  'team_ids', '["t-327-ind"]'::jsonb));
select is((select private.can_manage_task((select ind_task_id from f327))), true,
  'an Independent-Team member manages their Team''s Task');
select is((select private.can_evaluate_task((select ind_task_id from f327))), false,
  'but an Independent-Team member never evaluates it — the branch can_manage_origin has is deliberately absent');
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
-- require_origin_manager's FOR SHARE re-validation, or the Umbrella's FOR
-- UPDATE lock, were deleted. Pattern copied from
-- campaign_commands.test.sql:539-575. Fixtures are committed through a second
-- connection because dblink sessions cannot see rows inside this pgTAP
-- transaction (supabase/tests/README.md).
select extensions.dblink_connect('task_lock_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('task_lock_setup', $$
  delete from public.tasks where title = 'Lock Probe Umbrella #327';
  delete from public.member_departments where member_id = '32700000-0000-0000-0000-000000000021';
  delete from auth.users where id = '32700000-0000-0000-0000-000000000021';
  insert into auth.users (id, email) values
    ('32700000-0000-0000-0000-000000000021', 'lock.probe.bce.327@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('32700000-0000-0000-0000-000000000021', 'Lock Probe BCE 327',
     'lock.probe.bce.327@test.local', 'bce', 'activ');
  insert into public.member_departments (member_id, dept_id)
  values ('32700000-0000-0000-0000-000000000021', 'edu');
  insert into public.tasks
    (title, dept_id, kind, audience, assignment_mode, difficulty, rating, status, created_by)
  values ('Lock Probe Umbrella #327', 'edu', 'umbrella', null, null, null, null, 'todo',
          '32700000-0000-0000-0000-000000000021');
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
  select (public.create_task('Lock Probe Subtask #327', 'd', now() + interval '7 days',
    null, null, null, 'local', 'direct', null, null,
    (select id from public.tasks where title = 'Lock Probe Umbrella #327'), 'task')).title
$$) as locked_create(title text);

select ok(coalesce((
  select 'For Update' = any(row_lock.modes)
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.title = 'Lock Probe Umbrella #327'
), false), 'creating a Subtask holds its Umbrella''s tasks row FOR UPDATE');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.profiles') as row_lock
    join public.profiles as profile on profile.ctid = row_lock.locked_row
   where profile.id = '32700000-0000-0000-0000-000000000021'
), false), 'create_task holds the actor''s live profile row FOR SHARE');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.member_departments') as row_lock
    join public.member_departments as membership on membership.ctid = row_lock.locked_row
   where membership.member_id = '32700000-0000-0000-0000-000000000021'
     and membership.dept_id = 'edu'
), false), 'a BCE create holds the Department membership row its authority rests on FOR SHARE');

select extensions.dblink_exec('task_lock', 'rollback');
select extensions.dblink_disconnect('task_lock');
select extensions.dblink_exec('task_lock_setup', $$
  delete from public.tasks where title = 'Lock Probe Umbrella #327';
  delete from public.member_departments where member_id = '32700000-0000-0000-0000-000000000021';
  delete from auth.users where id = '32700000-0000-0000-0000-000000000021';
$$);
select extensions.dblink_disconnect('task_lock_setup');

select * from finish();
rollback;
