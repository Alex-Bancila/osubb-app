begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(5);

-- #315: audience dropped its column-level `not null` so an Umbrella Task can
-- carry an explicit null; an ordinary Task still requires it, now enforced
-- by tasks_task_shape_ck (proved in tasks_umbrella.test.sql).
select ok(
  not (select attnotnull from pg_attribute
        where attrelid = 'public.tasks'::regclass and attname = 'audience'),
  'audience is nullable at the column level (Umbrella Tasks require null, #315)');
select col_default_is('public', 'tasks', 'audience', 'local',
  'new Tasks default to a local audience');

insert into public.tasks (title, difficulty, group_id)
values ('Default local audience', 1, pg_temp.dept_group('edu'));

select is(
  (select audience from public.tasks where title = 'Default local audience'),
  'local',
  'the default audience is observable on a new Task');
select lives_ok(
  $$ insert into public.tasks (title, difficulty, audience, group_id)
     values ('Organization audience', 1, 'org', pg_temp.dept_group('edu')) $$,
  'organization audience is accepted');
select throws_ok(
  $$ insert into public.tasks (title, difficulty, audience, group_id)
     values ('Invalid audience', 1, 'department', pg_temp.dept_group('edu')) $$,
  '23514', null,
  'audiences outside local and org are rejected');

select * from finish();
rollback;
