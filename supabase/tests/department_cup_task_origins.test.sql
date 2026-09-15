begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(15);

select has_view('public', 'dept_cup', 'Department Cup remains a public read endpoint');
select view_owner_is('public', 'dept_cup', 'postgres', 'Department Cup has the migration owner');
select is(
  (select reloptions::text from pg_class where oid = 'public.dept_cup'::regclass),
  '{security_invoker=on}', 'Department Cup is a security-invoker view');
select ok(has_table_privilege('authenticated', 'public.dept_cup', 'SELECT'), 'authenticated may select Department Cup');
select ok(not has_table_privilege('anon', 'public.dept_cup', 'SELECT'), 'anon cannot select Department Cup');
select ok(not has_function_privilege('service_role', 'private.department_cup_rows()', 'EXECUTE'), 'server role cannot bypass the BCE+ endpoint');

insert into auth.users (id, email) values
  ('25900000-0000-0000-0000-000000000001', 'bce259@example.test'),
  ('25900000-0000-0000-0000-000000000002', 'member259@example.test'),
  ('25900000-0000-0000-0000-000000000003', 'inactive259@example.test');
insert into public.profiles (id, full_name, email, role, status) values
  ('25900000-0000-0000-0000-000000000001', 'BCE 259', 'bce259@example.test', 'bce', 'activ'),
  ('25900000-0000-0000-0000-000000000002', 'Member 259', 'member259@example.test', 'activ', 'activ'),
  ('25900000-0000-0000-0000-000000000003', 'Inactive BCE 259', 'inactive259@example.test', 'bce', 'inactiv');

insert into public.teams (id, name, dept_id) values
  ('259-dept-team', 'Department Team 259', 'edu'),
  ('259-independent', 'Independent Team 259', null);

insert into public.tasks (title, description, deadline, dept_id, status, difficulty, rating, created_by, created_at, completed_at) values
  ('Department Task 259', 'Fixture', now() - interval '2 days', 'edu', 'completed', 2, 5, '25900000-0000-0000-0000-000000000001', now() - interval '3 days', now() - interval '1 day');
insert into public.tasks (title, description, deadline, team_id, status, difficulty, rating, created_by, created_at, completed_at) values
  ('Department Team Task 259', 'Fixture', now() - interval '2 days', '259-dept-team', 'completed', 3, 5, '25900000-0000-0000-0000-000000000001', now() - interval '3 days', now() - interval '1 day'),
  ('Independent Team Task 259', 'Fixture', now() - interval '2 days', '259-independent', 'completed', 5, 5, '25900000-0000-0000-0000-000000000001', now() - interval '3 days', now() - interval '1 day');
insert into public.projects (name, status, leader_id, created_by) values
  ('Project 259', 'active', '25900000-0000-0000-0000-000000000001', '25900000-0000-0000-0000-000000000001');
insert into public.tasks (title, description, deadline, project_id, status, difficulty, rating, created_by, created_at, completed_at)
select 'Project Task 259', 'Fixture', now() - interval '2 days', id, 'completed', 5, 5,
       '25900000-0000-0000-0000-000000000001', now() - interval '3 days', now() - interval '1 day'
  from public.projects where name = 'Project 259';

insert into public.task_assignments (task_id, member_id, assigned_by, ended_at, end_reason)
select id, '25900000-0000-0000-0000-000000000002', '25900000-0000-0000-0000-000000000001', now(), 'completed'
  from public.tasks where title like '%Task 259';
insert into public.task_evaluations
  (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note, reversed_at, reversed_by, reversal_reason)
select task.id, assignment.id, '25900000-0000-0000-0000-000000000001', 'completed',
       task.difficulty, task.rating,
       case task.title when 'Department Task 259' then 10 when 'Department Team Task 259' then 15 else 25 end,
       'Fixture evaluation 259',
       case when task.title = 'Department Task 259' then now() end,
       case when task.title = 'Department Task 259' then '25900000-0000-0000-0000-000000000001'::uuid end,
       case when task.title = 'Department Task 259' then 'fixture_reversal' end
  from public.tasks as task
  join public.task_assignments as assignment on assignment.task_id = task.id
 where task.title like '%Task 259';

select pg_temp.test_login_leadership('25900000-0000-0000-0000-000000000001');
create temporary table cup259_before as
select dept_id, points from public.dept_cup;
reset role;

insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id, note, awarded_by) values
  ('25900000-0000-0000-0000-000000000002', 10, 'task', (select id from tasks where title = 'Department Task 259'), (select id from task_evaluations where task_id = (select id from tasks where title = 'Department Task 259')), null, null),
  ('25900000-0000-0000-0000-000000000002', -10, 'task_reversal', (select id from tasks where title = 'Department Task 259'), (select id from task_evaluations where task_id = (select id from tasks where title = 'Department Task 259')), null, null),
  ('25900000-0000-0000-0000-000000000002', 15, 'task', (select id from tasks where title = 'Department Team Task 259'), (select id from task_evaluations where task_id = (select id from tasks where title = 'Department Team Task 259')), null, null),
  ('25900000-0000-0000-0000-000000000002', 25, 'task', (select id from tasks where title = 'Independent Team Task 259'), (select id from task_evaluations where task_id = (select id from tasks where title = 'Independent Team Task 259')), null, null),
  ('25900000-0000-0000-0000-000000000002', 25, 'task', (select id from tasks where title = 'Project Task 259'), (select id from task_evaluations where task_id = (select id from tasks where title = 'Project Task 259')), null, null),
  ('25900000-0000-0000-0000-000000000002', -7, 'sanction', null, null, 'Sanction excluded 259', '25900000-0000-0000-0000-000000000001');

select is((select count(*) from public.dept_cup), 5::bigint, 'BCE sees all five competing Departments including zero totals');
select is((select points from public.dept_cup where dept_id = 'edu'),
          (select points + 15 from cup259_before where dept_id = 'edu'),
          'only Department and Department-Team fixture effects follow Task Origin');
select is((select count(*) from public.dept_cup where dept_id in ('diverse', 'secretariat')), 0::bigint, 'coordination structures are excluded');
select is((select array_agg(dept_id) from public.dept_cup),
          (select array_agg(dept_id order by points desc, name) from public.dept_cup),
          'rows use points descending and the stable Department-name tiebreak');

select pg_temp.test_login_leadership('25900000-0000-0000-0000-000000000002');
select is((select count(*) from public.dept_cup), 0::bigint, 'ordinary Member sees no protected rows');
select pg_temp.test_login('25900000-0000-0000-0000-000000000002',
  '{"member_role":"bce","member_level":5,"dept_ids":[],"team_ids":[]}'::jsonb);
select is((select count(*) from public.dept_cup), 0::bigint, 'live demotion defeats stale BCE claims');
select pg_temp.test_login_leadership('25900000-0000-0000-0000-000000000003');
select is((select count(*) from public.dept_cup), 0::bigint, 'inactive BCE sees no protected rows despite stale claims');
select pg_temp.test_login('25900000-0000-0000-0000-000000000001', '{}'::jsonb);
select is((select count(*) from public.dept_cup), 0::bigint, 'claimless caller sees no protected rows');
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok('select * from public.dept_cup', '42501', null, 'anon has no Department Cup grant');

select * from finish();
rollback;
