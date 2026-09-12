begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(5);

select col_not_null('public', 'tasks', 'audience',
  'every Task has an audience');
select col_default_is('public', 'tasks', 'audience', 'local',
  'new Tasks default to a local audience');

insert into public.tasks (title, difficulty)
values ('Default local audience', 1);

select is(
  (select audience from public.tasks where title = 'Default local audience'),
  'local',
  'the default audience is observable on a new Task');
select lives_ok(
  $$ insert into public.tasks (title, difficulty, audience)
     values ('Organization audience', 1, 'org') $$,
  'organization audience is accepted');
select throws_ok(
  $$ insert into public.tasks (title, difficulty, audience)
     values ('Invalid audience', 1, 'department') $$,
  '23514', null,
  'audiences outside local and org are rejected');

select * from finish();
rollback;
