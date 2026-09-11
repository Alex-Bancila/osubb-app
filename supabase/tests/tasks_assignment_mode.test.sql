begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(5);

-- #315: assignment_mode dropped its column-level `not null` so an Umbrella
-- Task can carry an explicit null; an ordinary Task still requires it, now
-- enforced by tasks_task_shape_ck (proved in tasks_umbrella.test.sql).
select ok(
  not (select attnotnull from pg_attribute
        where attrelid = 'public.tasks'::regclass and attname = 'assignment_mode'),
  'assignment_mode is nullable at the column level (Umbrella Tasks require null, #315)');
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
  $$ insert into public.tasks
       (title, difficulty, assignment_mode, dept_id, queue_opened_at)
     values ('Public assignment', 1, 'public', 'edu', now()) $$,
  'public Assignment Mode is accepted');
select throws_ok(
  $$ insert into public.tasks (title, difficulty, assignment_mode, dept_id)
     values ('Invalid assignment', 1, 'open', 'edu') $$,
  '23514', null,
  'Assignment Modes outside direct and public are rejected');

select * from finish();
rollback;
