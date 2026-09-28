-- visible_task_executors.test.sql — #499: expose only the Executor's safe identity
-- for Tasks the live caller may already read: the open Assignment's member, or
-- (#861, Audit D-1) the member who finished a completed or unfulfilled Task.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(20);

-- ==================== Fixtures — prefix 49900000-… ====================

insert into auth.users (id, email) values
  ('49900000-0000-0000-0000-000000000001', 'viewer.499@test.local'),
  ('49900000-0000-0000-0000-000000000002', 'executor.499@test.local'),
  ('49900000-0000-0000-0000-000000000003', 'former.499@test.local'),
  ('49900000-0000-0000-0000-000000000004', 'forbidden.499@test.local'),
  ('49900000-0000-0000-0000-000000000005', 'inactive.499@test.local'),
  ('49900000-0000-0000-0000-000000000006', 'claimless.499@test.local'),
  ('49900000-0000-0000-0000-000000000007', 'bc.499@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('49900000-0000-0000-0000-000000000001', 'Vizitator Activ 499', 'viewer.499@test.local', 'voluntar', 'activ'),
  ('49900000-0000-0000-0000-000000000002', 'Executor Curent 499', 'executor.499@test.local', 'voluntar', 'activ'),
  ('49900000-0000-0000-0000-000000000003', 'Executor Istoric 499', 'former.499@test.local', 'voluntar', 'activ'),
  ('49900000-0000-0000-0000-000000000004', 'Vizitator Neeligibil 499', 'forbidden.499@test.local', 'voluntar', 'activ'),
  ('49900000-0000-0000-0000-000000000005', 'Membru Inactiv 499', 'inactive.499@test.local', 'voluntar', 'inactiv'),
  ('49900000-0000-0000-0000-000000000006', 'Fara Claimuri 499', 'claimless.499@test.local', 'voluntar', 'activ'),
  ('49900000-0000-0000-0000-000000000007', 'BC 499', 'bc.499@test.local', 'bc', 'activ');

-- #675: the current Executor carries a Nickname; the RPC returns it beside the full name.
update public.profiles set nickname = 'Execu 499'
 where id = '49900000-0000-0000-0000-000000000002';

insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status,
   queue_opened_at, created_by)
values
  ('Oportunitate vizibila 499', 'Task public OSUBB', '2027-09-01 09:00:00+00',
   pg_temp.dept_group('edu'), 'org', 'public', 'todo', now(),
   '49900000-0000-0000-0000-000000000007'),
  ('Task local ascuns 499', 'Task direct din alt departament', '2027-09-02 09:00:00+00',
   pg_temp.dept_group('fin'), 'local', 'direct', 'todo', null,
   '49900000-0000-0000-0000-000000000007');

insert into public.task_assignments
  (task_id, member_id, assigned_by, assigned_at, ended_at, end_reason)
select task.id,
       '49900000-0000-0000-0000-000000000003',
       '49900000-0000-0000-0000-000000000007',
       now() - interval '2 days', now() - interval '1 day', 'gave_up'
  from public.tasks as task
 where task.title = 'Oportunitate vizibila 499';

insert into public.task_assignments
  (task_id, member_id, assigned_by, assigned_at)
select task.id,
       '49900000-0000-0000-0000-000000000002',
       '49900000-0000-0000-0000-000000000007', now()
  from public.tasks as task
 where task.title in ('Oportunitate vizibila 499', 'Task local ascuns 499');

-- #861 (Audit D-1): finished Tasks. An Evaluation ends the Assignment
-- (completed / failed), so none of these has an open one -- except the
-- reopened Task, whose earlier finished Assignment is history.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status,
   difficulty, rating, completed_at, unfulfilled_at, cancelled_at, cancel_reason,
   started_at, created_by)
values
  ('Task finalizat 861', null, '2027-09-03 09:00:00+00',
   pg_temp.dept_group('fin'), 'local', 'direct', 'completed',
   3, 4, now(), null, null, null, null, '49900000-0000-0000-0000-000000000007'),
  ('Task neindeplinit 861', null, '2027-09-04 09:00:00+00',
   pg_temp.dept_group('fin'), 'local', 'direct', 'unfulfilled',
   3, 1, null, now(), null, null, null, '49900000-0000-0000-0000-000000000007'),
  ('Task anulat 861', null, '2027-09-05 09:00:00+00',
   pg_temp.dept_group('fin'), 'local', 'direct', 'cancelled',
   null, null, null, null, now(), 'Nu mai e nevoie', null, '49900000-0000-0000-0000-000000000007'),
  ('Task anulat deschis 861', null, '2027-09-05 10:00:00+00',
   pg_temp.dept_group('fin'), 'local', 'direct', 'cancelled',
   null, null, null, null, now(), 'Nu mai e nevoie', null, '49900000-0000-0000-0000-000000000007'),
  ('Task redeschis 861', null, '2027-09-06 09:00:00+00',
   pg_temp.dept_group('fin'), 'local', 'direct', 'in_progress',
   3, null, null, null, null, null, now(), '49900000-0000-0000-0000-000000000007');

insert into public.task_assignments
  (task_id, member_id, assigned_by, assigned_at, ended_at, end_reason)
select task.id, history.member_id::uuid, '49900000-0000-0000-0000-000000000007',
       now() - history.assigned_ago, now() - history.ended_ago, history.end_reason
  from (values
    -- An earlier completion (later reversed), then the one that stands: the
    -- latest finishing Assignment is the one returned.
    ('Task finalizat 861',    '49900000-0000-0000-0000-000000000003', interval '3 days', interval '2 days', 'completed'),
    ('Task finalizat 861',    '49900000-0000-0000-0000-000000000002', interval '1 day',  interval '1 hour', 'completed'),
    ('Task neindeplinit 861', '49900000-0000-0000-0000-000000000003', interval '3 days', interval '2 days', 'gave_up'),
    ('Task neindeplinit 861', '49900000-0000-0000-0000-000000000002', interval '1 day',  interval '1 hour', 'failed'),
    -- A later row that did not finish the Task (no command writes one after
    -- an Evaluation, but a direct write could): only a finishing end_reason
    -- names the Executor, so the failing member above still stands.
    ('Task neindeplinit 861', '49900000-0000-0000-0000-000000000003', interval '30 minutes', interval '10 minutes', 'task_updated'),
    -- A cancelled Task names nobody, even with a finished Assignment in its history.
    ('Task anulat 861',       '49900000-0000-0000-0000-000000000003', interval '3 days', interval '2 days', 'completed'),
    ('Task anulat 861',       '49900000-0000-0000-0000-000000000002', interval '1 day',  interval '1 hour', 'cancelled'),
    ('Task redeschis 861',    '49900000-0000-0000-0000-000000000002', interval '3 days', interval '2 days', 'completed')
  ) as history (title, member_id, assigned_ago, ended_ago, end_reason)
  join public.tasks as task on task.title = history.title;

insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select task.id, '49900000-0000-0000-0000-000000000003', '49900000-0000-0000-0000-000000000007', now()
  from public.tasks as task
 where task.title = 'Task redeschis 861';

-- No command leaves a finished Task with an open Assignment, but no
-- constraint forbids a direct write from doing so. A cancelled Task still
-- names nobody, and a completed one still names the member who finished it.
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select task.id, stray.member_id::uuid, '49900000-0000-0000-0000-000000000007', now()
  from (values
    ('Task anulat deschis 861', '49900000-0000-0000-0000-000000000002'),
    ('Task finalizat 861',      '49900000-0000-0000-0000-000000000003')
  ) as stray (title, member_id)
  join public.tasks as task on task.title = stray.title;

create temp table f499 as
select
  (select id from public.tasks where title = 'Oportunitate vizibila 499') as visible_task_id,
  (select id from public.tasks where title = 'Task local ascuns 499') as hidden_task_id,
  (select id from public.tasks where title = 'Task finalizat 861') as completed_task_id,
  (select id from public.tasks where title = 'Task neindeplinit 861') as unfulfilled_task_id,
  (select id from public.tasks where title = 'Task anulat 861') as cancelled_task_id,
  (select id from public.tasks where title = 'Task anulat deschis 861') as cancelled_open_task_id,
  (select id from public.tasks where title = 'Task redeschis 861') as reopened_task_id;
grant select on f499 to authenticated, anon;

-- ==================== API shape and grants ====================

select has_function(
  'public', 'visible_task_executors', array['bigint[]'],
  'public.visible_task_executors(bigint[]) exists');

select has_function(
  'private', 'visible_task_executors', array['bigint[]'],
  'private.visible_task_executors(bigint[]) exists');

select ok(
  (select not procedure.prosecdef
          and procedure.provolatile = 's'
          and 'search_path=""' = any(procedure.proconfig)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'visible_task_executors'
      and procedure.proargtypes = '1016'::oidvector),
  'the public RPC wrapper is stable, security invoker, and pins search_path');

select ok(
  (select procedure.prosecdef
          and procedure.provolatile = 's'
          and 'search_path=""' = any(procedure.proconfig)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'visible_task_executors'
      and procedure.proargtypes = '1016'::oidvector),
  'the private implementation is stable, security definer, and pins search_path');

select is(
  (select procedure.proargnames
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'visible_task_executors'
      and procedure.proargtypes = '1016'::oidvector),
  array['p_task_ids', 'task_id', 'member_id', 'full_name', 'nickname', 'is_current']::text[],
  'the public API exposes only Task id, Member id, the safe display names (full name and Nickname, #675) and whether the Assignment is still open (#861)');

select ok(
  has_function_privilege('authenticated', 'public.visible_task_executors(bigint[])', 'execute')
  and has_function_privilege('authenticated', 'private.visible_task_executors(bigint[])', 'execute'),
  'authenticated may execute the wrapper and its private implementation');

select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'private')
      and procedure.proname = 'visible_task_executors'
      and procedure.proargtypes = '1016'::oidvector
      and (
        has_function_privilege('anon', procedure.oid, 'execute')
        or has_function_privilege('service_role', procedure.oid, 'execute')
        or has_function_privilege('public', procedure.oid, 'execute')
      )),
  0::bigint,
  'anon, service_role, and PUBLIC may execute neither function');

-- ==================== Authorized and denied reads ====================

select pg_temp.test_login(
  '49900000-0000-0000-0000-000000000001',
  '{"member_role":"voluntar","member_level":1,"dept_ids":[],"team_ids":[]}'::jsonb);

select results_eq(
  $$
    select task_id, member_id, full_name, nickname, is_current
      from public.visible_task_executors(array[
        (select visible_task_id from f499),
        (select hidden_task_id from f499)
      ])
  $$,
  $$ values (
    (select visible_task_id from f499),
    '49900000-0000-0000-0000-000000000002'::uuid,
    'Executor Curent 499'::text,
    'Execu 499'::text,
    true
  ) $$,
  'an active caller receives the current Executor (is_current true), with their Nickname, only for a readable Task');

-- #861: a finished Task the caller cannot read names nobody either.
select is(
  (select count(*)
     from public.visible_task_executors(array[
       (select completed_task_id from f499),
       (select unfulfilled_task_id from f499)])),
  0::bigint,
  '#861: a caller who cannot read a finished Task receives no finishing Executor');

select is(
  (select count(*)
     from public.visible_task_executors(array[
       (select visible_task_id from f499),
       (select visible_task_id from f499)
     ])),
  1::bigint,
  'duplicate Task ids never duplicate the Executor row');

select is(
  (select count(*)
     from public.visible_task_executors(array[(select hidden_task_id from f499)])),
  0::bigint,
  'a Task-ineligible active caller receives no Executor identity');

select is(
  (select count(*)
     from public.visible_task_executors(array[]::bigint[])),
  0::bigint,
  'an empty Task-id set returns no rows');

select is(
  (select count(*) from public.visible_task_executors(null::bigint[])),
  0::bigint,
  'a null Task-id set returns no rows');

-- Security pass I1: at most 200 Task ids per call, refused before any row is read.
select throws_ok(
  $$ select * from public.visible_task_executors(array(
        select (select visible_task_id from f499)
        union all select g::bigint from generate_series(-200, -1) as g)) $$,
  'PT400', 'too_many_ids',
  '201 Task ids are refused as PT400 too_many_ids');

select is(
  (select count(*)
     from public.visible_task_executors(array(
       select (select visible_task_id from f499)
       union all select g::bigint from generate_series(-199, -1) as g))),
  1::bigint,
  '200 Task ids are accepted and still return the readable Executor');

-- ==================== #861 (Audit D-1): finished Tasks ====================

select pg_temp.test_login_leadership('49900000-0000-0000-0000-000000000007');

select results_eq(
  $$
    select task_id, member_id, is_current
      from public.visible_task_executors(array[
        (select completed_task_id from f499),
        (select unfulfilled_task_id from f499),
        (select cancelled_task_id from f499),
        (select cancelled_open_task_id from f499),
        (select reopened_task_id from f499)
      ])
  $$,
  $$ values
    ((select completed_task_id from f499), '49900000-0000-0000-0000-000000000002'::uuid, false),
    ((select unfulfilled_task_id from f499), '49900000-0000-0000-0000-000000000002'::uuid, false),
    ((select reopened_task_id from f499), '49900000-0000-0000-0000-000000000003'::uuid, true)
  $$,
  '#861: a completed or unfulfilled Task names the member of its latest finishing Assignment (is_current false), a cancelled Task names nobody (even with an open row), a reopened Task names its open Assignment');

select is(
  (select count(*)
     from public.visible_task_executors(array[(select completed_task_id from f499)])),
  1::bigint,
  '#861: one row per finished Task -- the earlier, reversed completion stays in the private history');

select pg_temp.test_login(
  '49900000-0000-0000-0000-000000000005',
  '{"member_role":"voluntar","member_level":1,"dept_ids":[],"team_ids":[]}'::jsonb);
select is(
  (select count(*)
     from public.visible_task_executors(array[(select visible_task_id from f499)])),
  0::bigint,
  'an inactive Member receives no Executor identity despite stale claims');

select pg_temp.test_login(
  '49900000-0000-0000-0000-000000000006', '{}'::jsonb);
select is(
  (select count(*)
     from public.visible_task_executors(array[(select visible_task_id from f499)])),
  0::bigint,
  'a valid user id without organization claims receives no Executor identity');

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(
  $$ select * from public.visible_task_executors(array[1::bigint]) $$,
  '42501', null,
  'anonymous callers cannot execute the Executor endpoint');
reset role;

select * from finish();
rollback;
