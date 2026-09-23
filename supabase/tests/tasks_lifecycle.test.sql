begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(10);

select is(
  (select array_agg(enumlabel::text order by enumsortorder)
     from pg_enum where enumtypid = 'public.task_status'::regtype),
  array['todo', 'in_progress', 'in_review', 'completed', 'unfulfilled', 'cancelled']::text[],
  'Task Status exposes exactly the six approved lifecycle states');

select col_has_default('public', 'tasks', 'status',
  'new Tasks have a lifecycle default');

-- #345 dropped private.task_is_unassigned along with the legacy
-- task_assignees table it queried and the claim command that called it; the
-- grant assertion that stood here went with it.
-- #312: completed/unfulfilled rows must also carry a rating
-- (tasks_evaluation_inputs_ck) — every other state must not.

-- #339: tasks_cancel_reason_ck makes cancel_reason mandatory on -- and
-- exclusive to -- a cancelled Task, so the cancelled fixture states why it
-- was called off and every other one leaves the column null.
select lives_ok(
  $$ insert into public.tasks
      (title, difficulty, group_id, status, started_at, submitted_at,
       completed_at, unfulfilled_at, cancelled_at, cancel_reason, rating)
     values
      ('Lifecycle todo 287', 1, pg_temp.dept_group('edu'), 'todo', null, null, null, null, null, null, null),
      ('Lifecycle progress 287', 1, pg_temp.dept_group('edu'), 'in_progress', now(), null, null, null, null, null, null),
      ('Lifecycle review 287', 1, pg_temp.dept_group('edu'), 'in_review', now(), now(), null, null, null, null, null),
      ('Lifecycle completed 287', 1, pg_temp.dept_group('edu'), 'completed', null, null, now(), null, null, null, 3),
      ('Lifecycle unfulfilled 287', 1, pg_temp.dept_group('edu'), 'unfulfilled', null, null, null, now(), null, null, 2),
      ('Lifecycle cancelled 287', 1, pg_temp.dept_group('edu'), 'cancelled', null, null, null, null, now(), 'Anulat #287', null) $$,
  'all six lifecycle states are writable');

select throws_ok(
  $$ insert into public.tasks (title, difficulty, group_id, status)
     values ('Legacy progress 287', 1, pg_temp.dept_group('edu'), 'progress') $$,
  '22P02', null, 'legacy progress is no longer writable');
select throws_ok(
  $$ insert into public.tasks (title, difficulty, group_id, status)
     values ('Legacy done 287', 1, pg_temp.dept_group('edu'), 'done') $$,
  '22P02', null, 'legacy done is no longer writable');
select throws_ok(
  $$ insert into public.tasks (title, difficulty, group_id, status)
     values ('Legacy overdue 287', 1, pg_temp.dept_group('edu'), 'overdue') $$,
  '22P02', null, 'legacy overdue is no longer writable');
select throws_ok(
  $$ insert into public.tasks (title, difficulty, group_id, status)
     values ('Legacy open 287', 1, pg_temp.dept_group('edu'), 'open') $$,
  '22P02', null, 'legacy open is no longer writable');

insert into public.tasks (title, difficulty, group_id)
values ('Default lifecycle 287', 1, pg_temp.dept_group('edu'));
select is(
  (select status from public.tasks where title = 'Default lifecycle 287'),
  'todo'::public.task_status,
  'the todo default is observable');

select ok(
  not exists (
    select 1 from public.tasks
     where title like 'Lifecycle % 287'
       and status::text not in (
         'todo', 'in_progress', 'in_review', 'completed', 'unfulfilled', 'cancelled'
       )
  ),
  'stored lifecycle fixtures use only approved states');

select is(
  (select count(*) from public.tasks where title like 'Lifecycle % 287'),
  6::bigint,
  'no lifecycle fixture was lost');

select * from finish();
rollback;
