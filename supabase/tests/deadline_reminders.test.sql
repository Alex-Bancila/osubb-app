-- #69: direct reminders, stable daily deduplication, and scheduled execution.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(15);
-- A second scheduler session must wait for the same advisory lock, before
-- reading any Task. Both remote transactions roll back, preserving seed data.
select extensions.dblink_connect('deadline_lock',
  'host=db.supabase.internal port=5432 dbname=postgres user=postgres password=postgres');
select extensions.dblink_connect('deadline_retry',
  'host=db.supabase.internal port=5432 dbname=postgres user=postgres password=postgres');
select extensions.dblink_exec('deadline_lock',
  'begin; do $lock$ begin perform pg_catalog.pg_advisory_xact_lock(69, 1); end $lock$;');
select extensions.dblink_exec('deadline_retry', 'begin; set local lock_timeout = ''250ms'';');
select throws_ok(
  $$select * from extensions.dblink('deadline_retry', 'select private.remind_deadlines()') as result(notifications integer)$$,
  '55P03', 'canceling statement due to lock timeout',
  'Concurrent scheduler retries serialize on the advisory lock');
select extensions.dblink_exec('deadline_retry', 'rollback;');
select extensions.dblink_exec('deadline_lock', 'rollback;');
select extensions.dblink_disconnect('deadline_retry');
select extensions.dblink_disconnect('deadline_lock');
truncate public.tasks cascade;
truncate public.notifications cascade; -- #703: push_deliveries references it
insert into auth.users (id, email) values
  ('06900000-0000-0000-0000-000000000001', 'deadline-bc69@test.local'),
  ('06900000-0000-0000-0000-000000000002', 'deadline-bce69@test.local'),
  ('06900000-0000-0000-0000-000000000003', 'deadline-inactive69@test.local');
insert into profiles (id, full_name, email, role, status) values
  ('06900000-0000-0000-0000-000000000001', 'BC Executor', 'deadline-bc69@test.local', 'bc', 'activ'),
  ('06900000-0000-0000-0000-000000000002', 'BCE Executor', 'deadline-bce69@test.local', 'bce', 'activ'),
  ('06900000-0000-0000-0000-000000000003', 'Inactive Executor', 'deadline-inactive69@test.local', 'voluntar', 'inactiv');
insert into tasks (title, group_id, deadline, status, kind) values
  ('due todo', (select id from public.groups where legacy_dept_id = 'edu'), now() + interval '1 hour', 'todo', 'task'),
  ('due progress', (select id from public.groups where legacy_dept_id = 'edu'), now() + interval '48 hours', 'in_progress', 'task'),
  ('due review', (select id from public.groups where legacy_dept_id = 'edu'), now(), 'todo', 'task'),
  ('too late', (select id from public.groups where legacy_dept_id = 'edu'), now() + interval '49 hours', 'todo', 'task'),
  ('already overdue', (select id from public.groups where legacy_dept_id = 'edu'), now() - interval '1 second', 'todo', 'task'),
  ('inactive executor', (select id from public.groups where legacy_dept_id = 'edu'), now() + interval '1 hour', 'todo', 'task'),
  ('no executor', (select id from public.groups where legacy_dept_id = 'edu'), now() + interval '1 hour', 'todo', 'task');
insert into tasks (title, group_id, deadline, status, kind, audience, assignment_mode) values
  ('umbrella', (select id from public.groups where legacy_dept_id = 'edu'), now() + interval '1 hour', 'todo', 'umbrella', null, null);
update tasks set status = 'in_review', submitted_at = now() where title = 'due review';
insert into tasks (title, group_id, deadline, status, completed_at, unfulfilled_at, cancelled_at, cancel_reason, difficulty, rating) values
  ('completed', (select id from public.groups where legacy_dept_id = 'edu'), now() + interval '1 hour', 'completed', now(), null, null, null, 2, 4),
  ('unfulfilled', (select id from public.groups where legacy_dept_id = 'edu'), now() + interval '1 hour', 'unfulfilled', null, now(), null, null, 2, 1),
  ('cancelled', (select id from public.groups where legacy_dept_id = 'edu'), now() + interval '1 hour', 'cancelled', null, null, now(), 'No longer needed', null, null);
insert into task_assignments (task_id, member_id)
select id, case when title = 'inactive executor' then '06900000-0000-0000-0000-000000000003'::uuid
                when title = 'due progress' then '06900000-0000-0000-0000-000000000002'::uuid
                else '06900000-0000-0000-0000-000000000001'::uuid end
  from tasks where title not in ('no executor', 'umbrella');
-- A past Executor must not get the current Executor's reminder.
insert into task_assignments (task_id, member_id, ended_at, end_reason, end_note)
select id, '06900000-0000-0000-0000-000000000002', now(), 'gave_up', 'Reassigned'
  from tasks where title = 'due todo';
select is(private.remind_deadlines(), 3, 'All three unfinished statuses within the inclusive 48h window notify');
select is(private.remind_deadlines(), 0, 'Second run on the same day is idempotent');
select is((select count(*) from notifications), 3::bigint, 'No terminal, late, overdue, inactive, unassigned, or Umbrella notification');
select is((select count(*) from notifications where member_id = '06900000-0000-0000-0000-000000000001'), 2::bigint, 'Direct reminders reach BC despite broadcast suppression');
select is((select count(*) from notifications where member_id = '06900000-0000-0000-0000-000000000002'), 1::bigint, 'Direct reminders reach BCE, but never the past Executor');
select ok(not exists (select 1 from notifications where kind <> 'deadline' or link <> '/tracker/' || task_id::text), 'Reminders use deadline kind and Task detail link');
select ok(not exists (select 1 from notifications where dedupe_key <> 'task:' || task_id::text || ':deadline:' || (now() at time zone 'UTC')::date::text), 'Daily key is stable in UTC');
update notifications set read = true;
select is(private.remind_deadlines(), 0, 'Read reminders are not sent again on the same day');
select is((select count(*) from notifications), 3::bigint, 'Reading cannot multiply daily reminders');
select is((select count(*) from cron.job where jobname = 'osubb-daily-deadline-reminders' and schedule = '0 6 * * *' and command = 'select private.remind_deadlines()' and active), 1::bigint, 'Exactly one active daily cron schedule');
select ok(not has_function_privilege('authenticated', 'private.remind_deadlines()', 'execute'), 'Members cannot invoke the job');
select ok(not has_function_privilege('anon', 'private.remind_deadlines()', 'execute'), 'Anonymous cannot invoke the job');
select ok(not has_function_privilege('service_role', 'private.remind_deadlines()', 'execute'), 'Job remains internal to the scheduler');
-- Yesterday's delivery does not block today's reminder.
update notifications set dedupe_key = replace(dedupe_key, (now() at time zone 'UTC')::date::text, ((now() at time zone 'UTC')::date - 1)::text);
select is(private.remind_deadlines(), 3, 'A new day permits a fresh reminder');
select * from finish();
rollback;
