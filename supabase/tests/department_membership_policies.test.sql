-- #279 follow-up: Department membership writes are a live BC/Moderator action.
-- BCE authority is derived from existing Department membership and must not be
-- self-expandable through the member_departments table.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(22);

insert into auth.users (id, email) values
  ('27910000-0000-0000-0000-000000000001', 'bce.dept-policy@test.local'),
  ('27910000-0000-0000-0000-000000000002', 'other.bce.dept-policy@test.local'),
  ('27910000-0000-0000-0000-000000000003', 'bc.dept-policy@test.local'),
  ('27910000-0000-0000-0000-000000000004', 'moderator.dept-policy@test.local'),
  ('27910000-0000-0000-0000-000000000005', 'member.dept-policy@test.local'),
  ('27910000-0000-0000-0000-000000000006', 'inactive.bc.dept-policy@test.local'),
  ('27910000-0000-0000-0000-000000000007', 'demoted.bc.dept-policy@test.local'),
  ('27910000-0000-0000-0000-000000000008', 'service.dept-policy@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('27910000-0000-0000-0000-000000000001', 'Local BCE', 'bce.dept-policy@test.local', 'bce', 'activ'),
  ('27910000-0000-0000-0000-000000000002', 'Other BCE', 'other.bce.dept-policy@test.local', 'bce', 'activ'),
  ('27910000-0000-0000-0000-000000000003', 'Live BC', 'bc.dept-policy@test.local', 'bc', 'activ'),
  ('27910000-0000-0000-0000-000000000004', 'Live Moderator', 'moderator.dept-policy@test.local', 'moderator', 'activ'),
  ('27910000-0000-0000-0000-000000000005', 'Target Member', 'member.dept-policy@test.local', 'voluntar', 'activ'),
  ('27910000-0000-0000-0000-000000000006', 'Inactive BC', 'inactive.bc.dept-policy@test.local', 'bc', 'inactiv'),
  ('27910000-0000-0000-0000-000000000007', 'Demoted BC', 'demoted.bc.dept-policy@test.local', 'voluntar', 'activ');

insert into public.member_departments (member_id, dept_id) values
  ('27910000-0000-0000-0000-000000000001', 'edu'),
  ('27910000-0000-0000-0000-000000000002', 'fin'),
  ('27910000-0000-0000-0000-000000000005', 'edu');
insert into public.teams (id, name, dept_id)
values ('department-team-279-policy', 'Department policy Team #279', 'edu');

select pg_temp.test_login_leadership('27910000-0000-0000-0000-000000000001');
select throws_ok($$
  insert into public.member_departments (member_id, dept_id)
  values ('27910000-0000-0000-0000-000000000001', 'pr')
$$, '42501', null, 'BCE cannot add themselves to another Department');
select throws_ok($$
  insert into public.member_departments (member_id, dept_id)
  values ('27910000-0000-0000-0000-000000000002', 'edu')
$$, '42501', null, 'BCE cannot add another BCE to their Department');
update public.member_departments set dept_id = 'hr'
 where member_id = '27910000-0000-0000-0000-000000000001' and dept_id = 'edu';
select is((select dept_id from public.member_departments
  where member_id = '27910000-0000-0000-0000-000000000001'), 'edu',
  'BCE cannot update a Department membership');
delete from public.member_departments
 where member_id = '27910000-0000-0000-0000-000000000005' and dept_id = 'edu';
select ok(exists(select 1 from public.member_departments
  where member_id = '27910000-0000-0000-0000-000000000005' and dept_id = 'edu'),
  'BCE cannot delete a Department membership');
select is((select membership.member_id from public.add_department_team_member(
  'department-team-279-policy', '27910000-0000-0000-0000-000000000005') membership),
  '27910000-0000-0000-0000-000000000005'::uuid,
  'local BCE can still add a Member to a Department Team');
reset role;
select pg_temp.test_login_leadership('27910000-0000-0000-0000-000000000002');
select throws_ok($$
  select public.add_department_team_member(
    'department-team-279-policy', '27910000-0000-0000-0000-000000000005')
$$, '42501', 'department_team_membership_forbidden',
  'a foreign Department BCE remains denied by the command');
reset role;

select pg_temp.test_login_leadership('27910000-0000-0000-0000-000000000003');
select lives_ok($$
  insert into public.member_departments (member_id, dept_id)
  values ('27910000-0000-0000-0000-000000000005', 'fin')
$$, 'live BC can add a Department membership');
update public.member_departments set dept_id = 'pr'
 where member_id = '27910000-0000-0000-0000-000000000005' and dept_id = 'fin';
select ok(exists(select 1 from public.member_departments
  where member_id = '27910000-0000-0000-0000-000000000005' and dept_id = 'pr'),
  'live BC can update a Department membership');
reset role;

select pg_temp.test_login_leadership('27910000-0000-0000-0000-000000000004');
delete from public.member_departments
 where member_id = '27910000-0000-0000-0000-000000000005' and dept_id = 'pr';
select ok(not exists(select 1 from public.member_departments
  where member_id = '27910000-0000-0000-0000-000000000005' and dept_id = 'pr'),
  'live Moderator can delete a Department membership');
select lives_ok($$
  insert into public.member_departments (member_id, dept_id)
  values ('27910000-0000-0000-0000-000000000005', 'hr')
$$, 'live Moderator can add a Department membership');
reset role;

select pg_temp.test_login(
  '27910000-0000-0000-0000-000000000003',
  '{"provider":"email"}'::jsonb);
select throws_ok($$
  insert into public.member_departments (member_id, dept_id)
  values ('27910000-0000-0000-0000-000000000005', 'fin')
$$, '42501', null, 'a claimless live BC session cannot add Department membership');
reset role;

select pg_temp.test_login(
  '27910000-0000-0000-0000-000000000006',
  '{"member_role":"bc","member_level":6,"dept_ids":[],"team_ids":[]}'::jsonb);
select throws_ok($$
  insert into public.member_departments (member_id, dept_id)
  values ('27910000-0000-0000-0000-000000000005', 'fin')
$$, '42501', null, 'an inactive BC is denied despite stale claims');
reset role;

select pg_temp.test_login(
  '27910000-0000-0000-0000-000000000007',
  '{"member_role":"bc","member_level":6,"dept_ids":[],"team_ids":[]}'::jsonb);
select throws_ok($$
  insert into public.member_departments (member_id, dept_id)
  values ('27910000-0000-0000-0000-000000000005', 'fin')
$$, '42501', null, 'a demoted BC is denied despite stale claims');
reset role;

set local role service_role;
select is(public.provision_profile(
  '27910000-0000-0000-0000-000000000008', 'Service Provisioned',
  'service.dept-policy@test.local', 'voluntar', array['fin'], array[]::text[]),
  '27910000-0000-0000-0000-000000000008'::uuid,
  'service_role can still provision an invited Member');
reset role;
select is((select format('%s:%s', profile.status, membership.dept_id)
  from public.profiles as profile
  join public.member_departments as membership on membership.member_id = profile.id
  where profile.id = '27910000-0000-0000-0000-000000000008'),
  'activ:fin', 'provisioning creates the active profile and Department membership');

select is((select count(*) from pg_policies
  where schemaname = 'public' and tablename = 'member_departments'
    and policyname = 'member_departments_manage'), 1::bigint,
  'member_departments keeps one mutation policy');
select ok((select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'can_manage_department_memberships'),
  'the policy predicate runs as owner');
select ok((select provolatile = 's' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'can_manage_department_memberships'),
  'the policy predicate is stable');
select ok((select 'search_path=""' = any(proconfig) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'can_manage_department_memberships'),
  'the policy predicate pins an empty search_path');
select ok(has_function_privilege('authenticated',
  'private.can_manage_department_memberships()', 'execute'),
  'authenticated may execute the private policy predicate');
select ok(not has_function_privilege('anon',
  'private.can_manage_department_memberships()', 'execute'),
  'anonymous may not execute the private policy predicate');
select ok(not has_function_privilege('service_role',
  'private.can_manage_department_memberships()', 'execute'),
  'service_role does not need execute on the bypassed policy predicate');

select * from finish();
rollback;
