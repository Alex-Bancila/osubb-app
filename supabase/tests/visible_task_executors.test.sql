-- visible_task_executors.test.sql — #499: expose only the active Executor's
-- safe identity for Tasks the live caller may already read.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(15);

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

create temp table f499 as
select
  (select id from public.tasks where title = 'Oportunitate vizibila 499') as visible_task_id,
  (select id from public.tasks where title = 'Task local ascuns 499') as hidden_task_id;
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
  array['p_task_ids', 'task_id', 'member_id', 'full_name', 'nickname']::text[],
  'the public API exposes only Task id, Member id, and the safe display names (full name and Nickname, #675)');

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
    select task_id, member_id, full_name, nickname
      from public.visible_task_executors(array[
        (select visible_task_id from f499),
        (select hidden_task_id from f499)
      ])
  $$,
  $$ values (
    (select visible_task_id from f499),
    '49900000-0000-0000-0000-000000000002'::uuid,
    'Executor Curent 499'::text,
    'Execu 499'::text
  ) $$,
  'an active caller receives the current Executor, with their Nickname, only for a readable Task');

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
