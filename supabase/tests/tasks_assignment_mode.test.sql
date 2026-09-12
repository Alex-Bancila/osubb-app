begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(5);

select col_not_null('public', 'tasks', 'assignment_mode',
  'every Task has an Assignment Mode');
select col_default_is('public', 'tasks', 'assignment_mode', 'direct',
  'new Tasks default to direct assignment');

insert into public.tasks (title, difficulty, dept_id)
values ('Default direct assignment', 1, 'edu');

select is(
  (select assignment_mode from public.tasks
    where title = 'Default direct assignment'),
  'direct',
  'the default Assignment Mode is observable on a new Task');
select lives_ok(
  $$ insert into public.tasks (title, difficulty, assignment_mode, dept_id)
     values ('Public assignment', 1, 'public', 'edu') $$,
  'public Assignment Mode is accepted');
select throws_ok(
  $$ insert into public.tasks (title, difficulty, assignment_mode, dept_id)
     values ('Invalid assignment', 1, 'open', 'edu') $$,
  '23514', null,
  'Assignment Modes outside direct and public are rejected');

select * from finish();
rollback;
