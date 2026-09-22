begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(4);

select col_type_is('public', 'tasks', 'deadline', 'timestamp with time zone',
  'Task deadlines are exact instants');

insert into public.tasks (title, difficulty, deadline, group_id)
values
  ('Precise deadline', 1, '2026-09-11 17:42:19+00', pg_temp.dept_group('edu')),
  ('No deadline', 1, null, pg_temp.dept_group('edu'));

select is(
  (select deadline from public.tasks where title = 'Precise deadline'),
  '2026-09-11 17:42:19+00'::timestamptz,
  'a Task stores a precise deadline including its time');
select is(
  (select deadline from public.tasks where title = 'No deadline'),
  null::timestamptz,
  'a Task may still have no deadline');
select has_index('public', 'tasks', 'tasks_deadline_idx',
  'the deadline lookup index survives the type conversion');

select * from finish();
rollback;
