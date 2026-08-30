-- auth_claims.test.sql — Epic 2.2: JWT custom-claims hook + auth_*() helpers.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(18);

-- ==================== Helper defaults (no JWT in this session) ====================
select is(auth_level(), 0, 'auth_level() defaults to 0 without a JWT');
select is(auth_in_dept('edu'), false, 'auth_in_dept() defaults to false without a JWT');

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-000000000003', 'carmen.claims@test.local'),
  ('dddddddd-0000-0000-0000-000000000004', 'dan.claims@test.local');

insert into profiles (id, full_name, email, role, status) values
  ('cccccccc-0000-0000-0000-000000000003', 'Carmen Test', 'carmen.claims@test.local', 'bce', 'activ'),
  ('dddddddd-0000-0000-0000-000000000004', 'Dan Test',    'dan.claims@test.local',    'voluntar', 'inactiv');

insert into member_departments (member_id, dept_id)
  values ('cccccccc-0000-0000-0000-000000000003', 'edu');

insert into teams (id, name, dept_id) values ('t-test', 'Test Team', 'edu');
insert into team_members (team_id, member_id)
  values ('t-test', 'cccccccc-0000-0000-0000-000000000003');

-- ==================== Hook: provisioned BCE member ====================
create temp table hook_result as
select custom_access_token_hook(jsonb_build_object(
  'user_id', 'cccccccc-0000-0000-0000-000000000003',
  'claims',  jsonb_build_object(
               'sub', 'cccccccc-0000-0000-0000-000000000003',
               'role', 'authenticated',
               'app_metadata', jsonb_build_object('provider', 'email'))
)) as ev;

select is(
  (select (ev -> 'claims' -> 'app_metadata' ->> 'member_level')::int from hook_result),
  5, 'a seeded BCE token carries member_level = 5 (AC)');

select is(
  (select ev -> 'claims' -> 'app_metadata' ->> 'member_role' from hook_result),
  'bce', 'member_role claim is injected');

select ok(
  (select ev -> 'claims' -> 'app_metadata' -> 'dept_ids' ? 'edu' from hook_result),
  'dept_ids carries the member''s departments (AC)');

select ok(
  (select ev -> 'claims' -> 'app_metadata' -> 'team_ids' ? 't-test' from hook_result),
  'team_ids carries the member''s teams');

select is(
  (select ev -> 'claims' -> 'app_metadata' ->> 'provider' from hook_result),
  'email', 'pre-existing app_metadata claims are preserved');

-- ==================== Hook: fail-closed cases ====================
select ok(
  custom_access_token_hook(jsonb_build_object(
    'user_id', 'eeeeeeee-0000-0000-0000-000000000005',
    'claims',  jsonb_build_object('role', 'authenticated')))
  = jsonb_build_object(
    'user_id', 'eeeeeeee-0000-0000-0000-000000000005',
    'claims',  jsonb_build_object('role', 'authenticated')),
  'an un-provisioned user gets no org claims (event unchanged)');

select ok(
  custom_access_token_hook(jsonb_build_object(
    'user_id', 'dddddddd-0000-0000-0000-000000000004',
    'claims',  jsonb_build_object('role', 'authenticated')))
  = jsonb_build_object(
    'user_id', 'dddddddd-0000-0000-0000-000000000004',
    'claims',  jsonb_build_object('role', 'authenticated')),
  'an inactive member gets no org claims (event unchanged)');

-- ==================== Helpers reading a simulated JWT ====================
select set_config('request.jwt.claims',
  '{"app_metadata":{"member_role":"bce","member_level":5,"dept_ids":["edu"],"team_ids":["t-test"]}}',
  true);

select is(auth_level(), 5, 'auth_level() reads member_level from the JWT');
select is(auth_role(), 'bce'::member_role, 'auth_role() reads member_role from the JWT');

create function pg_temp.auth_role_beneath_empty_path()
returns text
language sql
stable
set search_path = ''
as $$ select public.auth_role()::text $$;

select is(
  pg_temp.auth_role_beneath_empty_path(),
  'bce',
  'auth_role() resolves member_role beneath an empty caller search_path');

select is(auth_in_dept('edu'), true,  'auth_in_dept() true for the member''s department');
select is(auth_in_dept('fin'), false, 'auth_in_dept() false for other departments');
select is(auth_in_team('t-test'), true,  'auth_in_team() true for the member''s team');
select is(auth_in_team('t-nope'), false, 'auth_in_team() false for other teams');

-- ==================== Privileges ====================
select ok(
  has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'the Auth server may execute the hook');

select ok(
  not has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'clients may not execute the hook');

select * from finish();
rollback;
