-- claim_open_task.test.sql — issue #157: one atomic winner for an open task.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(16);


truncate tasks, task_assignees, task_requests, points_ledger cascade;

insert into auth.users (id, email) values
  ('11000000-0000-0000-0000-000000000001', 'claim.one@test.local'),
  ('22000000-0000-0000-0000-000000000002', 'claim.two@test.local'),
  ('33000000-0000-0000-0000-000000000003', 'claim.inactive@test.local');
insert into profiles (id, full_name, email, role, status) values
  ('11000000-0000-0000-0000-000000000001', 'Primul Voluntar', 'claim.one@test.local',      'voluntar', 'activ'),
  ('22000000-0000-0000-0000-000000000002', 'Al Doilea',       'claim.two@test.local',      'voluntar', 'activ'),
  ('33000000-0000-0000-0000-000000000003', 'Membru Inactiv',  'claim.inactive@test.local', 'voluntar', 'inactiv');

insert into tasks (title, difficulty, status, dept_id) values
  ('claim-open',     2, 'open', 'edu'),
  ('claim-direct',   2, 'open', 'edu'),
  ('claim-inactive', 2, 'open', 'edu'),
  ('claim-todo',     2, 'todo', 'edu');

create temp table claim_fx as
select
  (select id from tasks where title = 'claim-open') as open_id,
  (select id from tasks where title = 'claim-direct') as direct_id,
  (select id from tasks where title = 'claim-inactive') as inactive_id,
  (select id from tasks where title = 'claim-todo') as todo_id;
grant select on claim_fx to authenticated;

-- The public RPC is deliberately SECURITY DEFINER because ordinary members
-- cannot update tasks. Its live-profile check and narrow EXECUTE grant are the
-- authorization boundary.
select has_function('public', 'claim_open_task', 'claim_open_task() exists');
select ok(
  exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'claim_open_task'
       and p.pronargs = 1
       and p.proargtypes[0] = 'bigint'::regtype::oid
       and p.prorettype = 'public.tasks'::regtype::oid
  ),
  'the RPC accepts only a task id and returns the claimed task');
select ok(coalesce((
  select p.prosecdef from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'claim_open_task'
), false), 'the atomic command runs as SECURITY DEFINER');
select ok(coalesce((
  select has_function_privilege('authenticated', p.oid, 'execute')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'claim_open_task'
), false), 'authenticated may execute the claim command');
select ok(not coalesce((
  select has_function_privilege('anon', p.oid, 'execute')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'claim_open_task'
), true), 'anon cannot execute the claim command');

-- First active member wins.
select pg_temp.test_login('11000000-0000-0000-0000-000000000001', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select lives_ok(
  format('select public.claim_open_task(%s)', (select open_id from claim_fx)),
  'an active member claims an open task');
reset role;

select is((select status from tasks where id = (select open_id from claim_fx)),
  'todo'::task_status, 'claiming moves the task out of the open queue');
select is((select member_id from task_assignees where task_id = (select open_id from claim_fx)),
  '11000000-0000-0000-0000-000000000001'::uuid,
  'the caller is the only identity assigned by the command');

-- A second member loses cleanly; the first assignment remains intact.
select pg_temp.test_login('22000000-0000-0000-0000-000000000002', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select throws_ok(
  format('select public.claim_open_task(%s)', (select open_id from claim_fx)),
  'PT409', 'task_not_open', 'a second claim receives a stable conflict');
reset role;
select is((select count(*) from task_assignees where task_id = (select open_id from claim_fx)),
  1::bigint, 'a conflict never creates a second assignee');

-- The old direct INSERT path is gone: volunteers must use the atomic command.
select pg_temp.test_login('22000000-0000-0000-0000-000000000002', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select throws_ok(
  format($$ insert into public.task_assignees (task_id, member_id)
            values (%s, '22000000-0000-0000-0000-000000000002') $$,
         (select direct_id from claim_fx)),
  '42501', null, 'a volunteer cannot bypass the atomic command with direct INSERT');
select throws_ok(
  format('select public.claim_open_task(%s)', (select todo_id from claim_fx)),
  'PT409', 'task_not_open', 'a non-open task cannot be claimed');
select throws_ok(
  $$ select public.claim_open_task(9223372036854775807) $$,
  'PT404', 'task_not_found', 'an unknown task has a stable not-found error');
reset role;

-- Both a live inactive profile and a real uid without org claims fail closed.
select pg_temp.test_login('33000000-0000-0000-0000-000000000003', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select throws_ok(
  format('select public.claim_open_task(%s)', (select inactive_id from claim_fx)),
  '42501', 'not_active_member', 'an inactive profile cannot claim with stale org claims');
reset role;

select pg_temp.test_login('11000000-0000-0000-0000-000000000001', jsonb_build_object('provider', 'email'));
select throws_ok(
  format('select public.claim_open_task(%s)', (select inactive_id from claim_fx)),
  '42501', 'not_active_member', 'a real uid without org claims cannot claim');
reset role;

select is(
  (select count(*) from tasks
    where id in ((select direct_id from claim_fx), (select inactive_id from claim_fx))
      and status = 'open'),
  2::bigint, 'denied attempts leave candidate tasks open and unmodified');

select * from finish();
rollback;
