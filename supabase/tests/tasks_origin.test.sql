begin;
\set osubb_test_suite true
\ir _helpers.sql

select plan(15);

insert into auth.users (id, email)
values ('28400000-0000-0000-0000-000000000001',
        'origin-project-lead-284@test.local');

insert into public.profiles (id, full_name, email, role)
values ('28400000-0000-0000-0000-000000000001', 'Origin Project Lead',
        'origin-project-lead-284@test.local', 'responsabil');

insert into public.teams (id, name, dept_id)
values ('team-origin-284', 'Origin Team', 'edu');

insert into public.projects (name, status, leader_id, created_by)
values ('Origin Project 284', 'active',
        '28400000-0000-0000-0000-000000000001',
        '28400000-0000-0000-0000-000000000001');

select has_column('public', 'tasks', 'project_id',
  'Tasks expose a Project Origin foreign key');
select fk_ok('public', 'tasks', 'project_id', 'public', 'projects', 'id',
  'Task Project Origins reference Projects');
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
     where conrelid = 'public.tasks'::regclass
       and conname = 'tasks_exactly_one_origin_ck'
       and contype = 'c'
  ),
  'Tasks enforce exactly one Origin');
select has_index('public', 'tasks', 'tasks_dept_idx',
  'Department Origin queries are indexed');
select has_index('public', 'tasks', 'tasks_team_idx',
  'Team Origin queries are indexed');
select has_index('public', 'tasks', 'tasks_project_idx',
  'Project Origin queries are indexed');

select lives_ok(
  $$ insert into public.tasks (title, difficulty, dept_id)
     values ('Department Origin 284', 1, 'edu') $$,
  'a Task accepts one Department Origin');
select lives_ok(
  $$ insert into public.tasks (title, difficulty, team_id)
     values ('Team Origin 284', 1, 'team-origin-284') $$,
  'a Task accepts one Team Origin');
select lives_ok(
  $$ insert into public.tasks (title, difficulty, project_id)
     select 'Project Origin 284', 1, id
       from public.projects where name = 'Origin Project 284' $$,
  'a Task accepts one Project Origin');

select throws_ok(
  $$ insert into public.tasks (title, difficulty)
     values ('Missing Origin 284', 1) $$,
  '23514', 'task_group_required',
  'a Task rejects a missing Origin -- private.sync_task_group_origin answers before tasks_exactly_one_origin_ck can (#519)');
select throws_ok(
  $$ insert into public.tasks (title, difficulty, dept_id, team_id)
     values ('Two Origins 284', 1, 'edu', 'team-origin-284') $$,
  '23514', null,
  'a Task rejects Department and Team Origins together');
select throws_ok(
  $$ insert into public.tasks (title, difficulty, dept_id, project_id)
     select 'Two Origins Project 284', 1, 'edu', id
       from public.projects where name = 'Origin Project 284' $$,
  '23514', null,
  'a Task rejects Department and Project Origins together');
select throws_ok(
  $$ insert into public.tasks (title, difficulty, team_id, project_id)
     select 'Two Origins Team Project 284', 1, 'team-origin-284', id
       from public.projects where name = 'Origin Project 284' $$,
  '23514', null,
  'a Task rejects Team and Project Origins together');
select throws_ok(
  $$ update public.tasks
        set project_id = (select id from public.projects where name = 'Origin Project 284')
      where title = 'Department Origin 284' $$,
  '23514', null,
  'an existing Task cannot gain a second Origin');
select throws_ok(
  $$ update public.tasks
        set dept_id = null
      where title = 'Department Origin 284' $$,
  '23514', 'task_group_required',
  'an existing Task cannot lose its Origin -- private.sync_task_group_origin answers before tasks_exactly_one_origin_ck can (#519)');

select * from finish();
rollback;
