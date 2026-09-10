-- #279: BCE-of-department (plus BC/Moderator globally) membership commands
-- for Department Teams. Mirrors #278's Independent-Team command suite.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(40);

insert into auth.users (id, email) values
  ('27900000-0000-0000-0000-000000000001', 'edu.bce.dteam@test.local'),
  ('27900000-0000-0000-0000-000000000002', 'fin.bce.dteam@test.local'),
  ('27900000-0000-0000-0000-000000000003', 'bc.dteam@test.local'),
  ('27900000-0000-0000-0000-000000000004', 'moderator.dteam@test.local'),
  ('27900000-0000-0000-0000-000000000005', 'responsabil.dteam@test.local'),
  ('27900000-0000-0000-0000-000000000006', 'voluntar.dteam@test.local'),
  ('27900000-0000-0000-0000-000000000007', 'inactive.edu.bce.dteam@test.local'),
  ('27900000-0000-0000-0000-000000000008', 'target.dteam@test.local'),
  ('27900000-0000-0000-0000-000000000009', 'second.target.dteam@test.local'),
  ('27900000-0000-0000-0000-000000000010', 'inactive.target.dteam@test.local'),
  ('27900000-0000-0000-0000-000000000011', 'recrut.dteam@test.local'),
  ('27900000-0000-0000-0000-000000000012', 'activ.dteam@test.local'),
  ('27900000-0000-0000-0000-000000000013', 'vot.dteam@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('27900000-0000-0000-0000-000000000001', 'EDU BCE Team', 'edu.bce.dteam@test.local', 'bce', 'activ'),
  ('27900000-0000-0000-0000-000000000002', 'FIN BCE Team', 'fin.bce.dteam@test.local', 'bce', 'activ'),
  ('27900000-0000-0000-0000-000000000003', 'BC Team', 'bc.dteam@test.local', 'bc', 'activ'),
  ('27900000-0000-0000-0000-000000000004', 'Moderator Team', 'moderator.dteam@test.local', 'moderator', 'activ'),
  ('27900000-0000-0000-0000-000000000005', 'Responsabil Team', 'responsabil.dteam@test.local', 'responsabil', 'activ'),
  ('27900000-0000-0000-0000-000000000006', 'Voluntar Team', 'voluntar.dteam@test.local', 'voluntar', 'activ'),
  ('27900000-0000-0000-0000-000000000007', 'Inactive EDU BCE Team', 'inactive.edu.bce.dteam@test.local', 'bce', 'inactiv'),
  ('27900000-0000-0000-0000-000000000008', 'Target Team', 'target.dteam@test.local', 'voluntar', 'activ'),
  ('27900000-0000-0000-0000-000000000009', 'Second Target Team', 'second.target.dteam@test.local', 'recrut', 'activ'),
  ('27900000-0000-0000-0000-000000000010', 'Inactive Target Team', 'inactive.target.dteam@test.local', 'voluntar', 'inactiv'),
  ('27900000-0000-0000-0000-000000000011', 'Recrut Team', 'recrut.dteam@test.local', 'recrut', 'activ'),
  ('27900000-0000-0000-0000-000000000012', 'Activ Team', 'activ.dteam@test.local', 'activ', 'activ'),
  ('27900000-0000-0000-0000-000000000013', 'Vot Team', 'vot.dteam@test.local', 'vot', 'activ');

insert into public.member_departments (member_id, dept_id) values
  ('27900000-0000-0000-0000-000000000001', 'edu'),
  ('27900000-0000-0000-0000-000000000002', 'fin'),
  ('27900000-0000-0000-0000-000000000007', 'edu');

insert into public.teams (id, name, dept_id) values
  ('department-team-279-edu', 'Department Team #279 (EDU)', 'edu'),
  ('department-team-279-fin', 'Department Team #279 (FIN)', 'fin'),
  ('independent-team-279', 'Independent Team #279', null);

-- API and least-privilege boundary.
select has_function('public', 'add_department_team_member', array['text', 'uuid'],
  'add_department_team_member(text, uuid) exists');
select has_function('public', 'remove_department_team_member', array['text', 'uuid'],
  'remove_department_team_member(text, uuid) exists');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('add_department_team_member', 'remove_department_team_member')
    and pg_get_function_identity_arguments(p.oid) = 'p_team_id text, p_member_id uuid'),
  2::bigint, 'both commands expose only Team and Member ids');
select is((select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='add_department_team_member'),
  'team_members', 'add returns the membership');
select is((select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='remove_department_team_member'),
  'boolean', 'remove returns whether a row existed');
select ok(coalesce((select bool_and(not p.prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('add_department_team_member','remove_department_team_member')), false),
  'public commands are security-invoker wrappers');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname in ('require_department_team_membership_manager',
    'add_department_team_member_impl','remove_department_team_member_impl') and p.prosecdef),
  3::bigint, 'private authorization and mutations run as owner');
select ok(coalesce((select bool_and('search_path=""'=any(p.proconfig)) from pg_proc p
  where p.proname in ('require_department_team_membership_manager','add_department_team_member_impl',
    'remove_department_team_member_impl','add_department_team_member','remove_department_team_member')), false),
  'every command function has an empty search_path');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('add_department_team_member','remove_department_team_member')
    and has_function_privilege('authenticated',p.oid,'execute')), 2::bigint,
  'authenticated can execute both public commands');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('add_department_team_member','remove_department_team_member')
    and has_function_privilege('anon',p.oid,'execute')), 0::bigint,
  'anonymous cannot execute the public commands');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname in ('require_department_team_membership_manager',
    'add_department_team_member_impl','remove_department_team_member_impl')
    and has_function_privilege('authenticated',p.oid,'execute')), 2::bigint,
  'authenticated can reach only the private implementations');

-- Authorized idempotent behavior: the EDU BCE manages the EDU Department Team.
select pg_temp.test_login('27900000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role','bce','member_level',5,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select is((select format('%s:%s',m.team_id,m.member_id) from public.add_department_team_member(
  'department-team-279-edu','27900000-0000-0000-0000-000000000008') m),
  'department-team-279-edu:27900000-0000-0000-0000-000000000008',
  'the EDU BCE adds an active Member and receives the stored membership');
select is((select count(*) from public.team_members where team_id='department-team-279-edu'
  and member_id='27900000-0000-0000-0000-000000000008'), 1::bigint,
  'the command stores one membership');
select is((select m.member_id from public.add_department_team_member(
  'department-team-279-edu','27900000-0000-0000-0000-000000000008') m),
  '27900000-0000-0000-0000-000000000008'::uuid,
  'a duplicate add returns the existing membership');
select is((select count(*) from public.team_members where team_id='department-team-279-edu'
  and member_id='27900000-0000-0000-0000-000000000008'), 1::bigint,
  'a duplicate add stores exactly one row');
select is(public.remove_department_team_member('department-team-279-edu',
  '27900000-0000-0000-0000-000000000008'), true,
  'the EDU BCE removes an existing Department-Team membership');
select is((select count(*) from public.team_members where team_id='department-team-279-edu'
  and member_id='27900000-0000-0000-0000-000000000008'), 0::bigint,
  'removal leaves no row');
select is(public.remove_department_team_member('department-team-279-edu',
  '27900000-0000-0000-0000-000000000008'), false,
  'duplicate removal is a stable no-op, not an error');
reset role;

-- Local authority is per-department: the FIN BCE manages the FIN Team.
select pg_temp.test_login('27900000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role','bce','member_level',5,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select is((select m.member_id from public.add_department_team_member(
  'department-team-279-fin','27900000-0000-0000-0000-000000000009') m),
  '27900000-0000-0000-0000-000000000009'::uuid,
  'the FIN BCE adds a Member to the FIN Team');
reset role;

-- The FIN BCE has no authority over the EDU Team.
select pg_temp.test_login('27900000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role','bce','member_level',5,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$select public.add_department_team_member('department-team-279-edu',
  '27900000-0000-0000-0000-000000000009')$$, '42501','department_team_membership_forbidden',
  'a BCE of a different department is denied');
select throws_ok($$select public.remove_department_team_member('department-team-279-edu',
  '27900000-0000-0000-0000-000000000008')$$, '42501','department_team_membership_forbidden',
  'a BCE of a different department cannot remove a member');
reset role;

-- BC and Moderator manage every Department Team.
select pg_temp.test_login('27900000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role','bc','member_level',6,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select is((select m.member_id from public.add_department_team_member(
  'department-team-279-edu','27900000-0000-0000-0000-000000000009') m),
  '27900000-0000-0000-0000-000000000009'::uuid, 'BC adds a Member to any Department Team');
reset role;
select pg_temp.test_login('27900000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role','moderator','member_level',9,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select is(public.remove_department_team_member('department-team-279-edu',
  '27900000-0000-0000-0000-000000000009'), true, 'Moderator removes a Member from any Department Team');
reset role;

-- Roles below BCE, and a BCE claim without a live BCE profile, are denied.
select pg_temp.test_login('27900000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role','responsabil','member_level',4,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$select public.add_department_team_member('department-team-279-edu',
  '27900000-0000-0000-0000-000000000009')$$, '42501','department_team_membership_forbidden',
  'Responsabil (level 4) is denied');
select throws_ok($$select public.add_department_team_member('missing-team-279',
  '27900000-0000-0000-0000-000000000009')$$, '42501','department_team_membership_forbidden',
  'unauthorized actors cannot probe whether a Team exists');
reset role;
select pg_temp.test_login('27900000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role','voluntar','member_level',1,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$select public.add_department_team_member('department-team-279-edu',
  '27900000-0000-0000-0000-000000000009')$$, '42501','department_team_membership_forbidden',
  'Voluntar is denied');
reset role;
select pg_temp.test_login('27900000-0000-0000-0000-000000000011', jsonb_build_object(
  'member_role','recrut','member_level',0,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$select public.add_department_team_member('department-team-279-edu',
  '27900000-0000-0000-0000-000000000009')$$, '42501','department_team_membership_forbidden',
  'Recrut (level 0) is denied');
reset role;
select pg_temp.test_login('27900000-0000-0000-0000-000000000012', jsonb_build_object(
  'member_role','activ','member_level',2,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$select public.add_department_team_member('department-team-279-edu',
  '27900000-0000-0000-0000-000000000009')$$, '42501','department_team_membership_forbidden',
  'Membru Activ (level 2) is denied');
reset role;
select pg_temp.test_login('27900000-0000-0000-0000-000000000013', jsonb_build_object(
  'member_role','vot','member_level',3,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$select public.add_department_team_member('department-team-279-edu',
  '27900000-0000-0000-0000-000000000009')$$, '42501','department_team_membership_forbidden',
  'Membru cu Drept de Vot (level 3) is denied');
reset role;
select pg_temp.test_login('27900000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role','bce','member_level',5,'dept_ids','["edu"]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$select public.add_department_team_member('department-team-279-edu',
  '27900000-0000-0000-0000-000000000009')$$, '42501','department_team_membership_forbidden',
  'forged BCE and Department claims do not elevate a live Responsabil');
reset role;
select pg_temp.test_login('27900000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role','bce','member_level',5,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$select public.add_department_team_member('department-team-279-edu',
  '27900000-0000-0000-0000-000000000009')$$, '42501','department_team_membership_forbidden',
  'an inactive BCE of the right department is denied despite stale claims');
reset role;

-- Claimless and anonymous sessions are denied for both commands.
select pg_temp.test_login('27900000-0000-0000-0000-000000000003',
  jsonb_build_object('provider','email'));
select throws_ok($$select public.add_department_team_member('department-team-279-edu',
  '27900000-0000-0000-0000-000000000009')$$, '42501','department_team_membership_forbidden',
  'a claimless session cannot add a member');
select throws_ok($$select public.remove_department_team_member('department-team-279-edu',
  '27900000-0000-0000-0000-000000000008')$$, '42501','department_team_membership_forbidden',
  'a claimless session cannot remove a member');
reset role;

set local role anon;
select throws_ok($$select public.add_department_team_member('department-team-279-edu',
  '27900000-0000-0000-0000-000000000009')$$, '42501',null,
  'anonymous cannot execute add');
select throws_ok($$select public.remove_department_team_member('department-team-279-edu',
  '27900000-0000-0000-0000-000000000008')$$, '42501',null,
  'anonymous cannot execute remove');
reset role;

-- An Independent Team is rejected by the Department-Team commands.
select pg_temp.test_login('27900000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role','bc','member_level',6,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$select public.add_department_team_member('independent-team-279',
  '27900000-0000-0000-0000-000000000009')$$, 'PT400','department_team_required',
  'an Independent Team is rejected by add');
select throws_ok($$select public.remove_department_team_member('independent-team-279',
  '27900000-0000-0000-0000-000000000009')$$, 'PT400','department_team_required',
  'an Independent Team is rejected by remove');

-- Unknown Teams surface PT404 before any authority narrows to a department.
select throws_ok($$select public.add_department_team_member('missing-team-279',
  '27900000-0000-0000-0000-000000000009')$$, 'PT404','team_not_found',
  'an unknown Team is rejected');

-- Target eligibility: only an active profile can be added.
select throws_ok($$select public.add_department_team_member('department-team-279-edu',
  '27900000-0000-0000-0000-000000000010')$$, 'PT400','team_member_not_eligible',
  'an inactive target Member is rejected');
select throws_ok($$select public.add_department_team_member('department-team-279-edu',
  '27900000-0000-0000-0000-000000009999')$$, 'PT400','team_member_not_eligible',
  'an unknown target is rejected without leaking a foreign-key error');
reset role;

select * from finish();
rollback;
