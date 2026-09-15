begin;
\set osubb_test_suite true
\ir _helpers.sql

select plan(14);

select has_view('public', 'tasks_with_overdue',
  'the derived overdue Task surface exists');
select ok(
  coalesce((
    select 'security_invoker=on' = any(reloptions)
      from pg_class
     where oid = 'public.tasks_with_overdue'::regclass
  ), false),
  'the overdue view executes with caller RLS');
select col_type_is('public', 'tasks_with_overdue', 'is_overdue', 'boolean',
  'the derived overdue value is boolean');
select ok(
  has_table_privilege('authenticated', 'public.tasks_with_overdue', 'select'),
  'authenticated sessions may read the overdue surface');
select ok(
  not has_table_privilege('authenticated', 'public.tasks_with_overdue', 'insert')
  and not has_table_privilege('authenticated', 'public.tasks_with_overdue', 'update')
  and not has_table_privilege('authenticated', 'public.tasks_with_overdue', 'delete'),
  'authenticated sessions cannot mutate Tasks through the overdue surface');

-- #312: the completed/unfulfilled fixture rows need a rating alongside their
-- difficulty (tasks_evaluation_inputs_ck); every other row must not carry one.
-- #339: tasks_cancel_reason_ck makes cancel_reason mandatory on -- and
-- exclusive to -- a cancelled Task, so the cancelled row states why it was
-- called off and every other row must leave the column null.
insert into public.tasks
  (title, difficulty, dept_id, deadline, status, started_at, submitted_at,
   completed_at, unfulfilled_at, cancelled_at, cancel_reason, rating) values
  ('Past todo 288', 1, 'edu', now() - interval '1 second', 'todo', null, null, null, null, null, null, null),
  ('Past progress 288', 1, 'edu', now() - interval '1 day', 'in_progress', now(), null, null, null, null, null, null),
  ('Past review 288', 1, 'edu', now() - interval '1 hour', 'in_review', now(), now(), null, null, null, null, null),
  ('Past completed 288', 1, 'edu', now() - interval '1 day', 'completed', null, null, now(), null, null, null, 3),
  ('Past unfulfilled 288', 1, 'edu', now() - interval '1 day', 'unfulfilled', null, null, null, now(), null, null, 2),
  ('Past cancelled 288', 1, 'edu', now() - interval '1 day', 'cancelled', null, null, null, null, now(), 'Anulat #288', null),
  ('Future todo 288', 1, 'edu', now() + interval '1 day', 'todo', null, null, null, null, null, null, null),
  ('No deadline 288', 1, 'edu', null, 'in_progress', now(), null, null, null, null, null, null);

select is((select is_overdue from public.tasks_with_overdue where title = 'Past todo 288'),
  true, 'a past-deadline todo Task is overdue');
select is((select is_overdue from public.tasks_with_overdue where title = 'Past progress 288'),
  true, 'a past-deadline in-progress Task is overdue');
select is((select is_overdue from public.tasks_with_overdue where title = 'Past review 288'),
  true, 'a past-deadline in-review Task is overdue');
select is((select count(*) from public.tasks_with_overdue
            where title in ('Past completed 288', 'Past unfulfilled 288', 'Past cancelled 288')
              and is_overdue),
  0::bigint, 'terminal Tasks are never overdue');
select is((select is_overdue from public.tasks_with_overdue where title = 'Future todo 288'),
  false, 'a future deadline is not overdue');
select is((select is_overdue from public.tasks_with_overdue where title = 'No deadline 288'),
  false, 'a missing deadline is not overdue');

insert into auth.users (id, email) values
  ('28800000-0000-0000-0000-000000000001', 'overdue-outsider-288@test.local');
insert into public.profiles (id, full_name, email, role, status) values
  ('28800000-0000-0000-0000-000000000001', 'Overdue Outsider 288',
   'overdue-outsider-288@test.local', 'voluntar', 'activ');

insert into public.tasks
  (title, difficulty, dept_id, deadline, status, audience, assignment_mode,
   queue_opened_at)
values
  ('Visible opportunity 288', 1, 'pr', now() - interval '1 day', 'todo', 'org', 'public', now()),
  ('Hidden local Task 288', 1, 'pr', now() - interval '1 day', 'todo', 'local', 'direct', null);

select pg_temp.test_login(
  '28800000-0000-0000-0000-000000000001',
  jsonb_build_object('member_role', 'voluntar', 'member_level', 1,
                     'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select count(*) from public.tasks_with_overdue
            where title = 'Visible opportunity 288' and is_overdue),
  1::bigint, 'an active outsider sees an overdue public opportunity through Task RLS');
select is((select count(*) from public.tasks_with_overdue
            where title = 'Hidden local Task 288'),
  0::bigint, 'the view does not bypass Task RLS for a local Task');
reset role;

select pg_temp.test_login(
  '28800000-0000-0000-0000-000000000001',
  jsonb_build_object('provider', 'email'));
select is((select count(*) from public.tasks_with_overdue
            where title like '% 288'),
  0::bigint, 'a claimless session reads no overdue Task rows');
reset role;

select * from finish();
rollback;
