-- auth_claims.test.sql — Epic 2.2: JWT custom-claims hook + auth_*() helpers.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(29);

-- ==================== Helper defaults (no JWT in this session) ====================
select is(auth_level(), 0, 'auth_level() defaults to 0 without a JWT');
select is(auth_in_group(1), false, 'auth_in_group() defaults to false without a JWT');

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-000000000003', 'carmen.claims@test.local'),
  ('dddddddd-0000-0000-0000-000000000004', 'dan.claims@test.local');

insert into profiles (id, full_name, email, role, status) values
  ('cccccccc-0000-0000-0000-000000000003', 'Carmen Test', 'carmen.claims@test.local', 'bce', 'activ'),
  ('dddddddd-0000-0000-0000-000000000004', 'Dan Test',    'dan.claims@test.local',    'voluntar', 'inactiv');

insert into pg_temp.fixture_member_departments (member_id, dept_id)
  values ('cccccccc-0000-0000-0000-000000000003', 'edu');

-- Carmen also holds the Organization Department. Automatic Membership means
-- #509's mirror deliberately never rosters her into the OSUBB Group, so a hook
-- that derived group_ids from pg_temp.fixture_member_departments instead of group_members
-- would wrongly claim it -- this fixture is what assertion (3) below catches.
insert into pg_temp.fixture_member_departments (member_id, dept_id)
  values ('cccccccc-0000-0000-0000-000000000003', 'org');

insert into pg_temp.fixture_teams (id, name, dept_id) values ('t-test', 'Test Team', 'edu');
insert into pg_temp.fixture_team_members (team_id, member_id)
  values ('t-test', 'cccccccc-0000-0000-0000-000000000003');
select pg_temp.materialize_legacy_groups();

-- ==================== Hook: provisioned BCE member ====================
create temp table hook_result as
select custom_access_token_hook(jsonb_build_object(
  'user_id', 'cccccccc-0000-0000-0000-000000000003',
  'claims',  jsonb_build_object(
               'sub', 'cccccccc-0000-0000-0000-000000000003',
               'role', 'authenticated',
               'app_metadata', jsonb_build_object('provider', 'email', 'dept_ids', jsonb_build_array('stale'), 'team_ids', jsonb_build_array('stale')))
)) as ev;

select is(
  (select (ev -> 'claims' -> 'app_metadata' ->> 'member_level')::int from hook_result),
  5, 'a seeded BCE token carries member_level = 5 (AC)');

select is(
  (select ev -> 'claims' -> 'app_metadata' ->> 'member_role' from hook_result),
  'bce', 'member_role claim is injected');

select ok(
  (select not (ev -> 'claims' -> 'app_metadata' ? 'dept_ids') from hook_result),
  'legacy Department claims are absent');

select ok(
  (select not (ev -> 'claims' -> 'app_metadata' ? 'team_ids') from hook_result),
  'legacy Team claims are absent');

select is(
  (select ev -> 'claims' -> 'app_metadata' ->> 'provider' from hook_result),
  'email', 'pre-existing app_metadata claims are preserved');

-- ==================== Hook: group_ids (#510, ADR-0009 Wave 1) ====================
select ok(
  (select ev -> 'claims' -> 'app_metadata' -> 'group_ids'
     @> to_jsonb((select grp.id from groups grp where grp.name = 'Educațional'))
     from hook_result),
  'group_ids carries the Group mirrored from the member''s Department (AC)');

select ok(
  (select ev -> 'claims' -> 'app_metadata' -> 'group_ids'
     @> to_jsonb((select grp.id from groups grp where grp.id = pg_temp.team_group('t-test')))
     from hook_result),
  'group_ids carries the Group mirrored from the member''s Team');

select ok(
  not (select coalesce(ev -> 'claims' -> 'app_metadata' -> 'group_ids'
         @> to_jsonb((select grp.id from groups grp where grp.name = 'OSUBB')), false)
         from hook_result),
  'group_ids excludes the OSUBB Group even though Carmen also holds the Organization Department -- Automatic Membership is never a claim (a hook reading member_departments instead of the roster would fail this)');

select is(
  (select jsonb_typeof(ev -> 'claims' -> 'app_metadata' -> 'group_ids') from hook_result),
  'array', 'group_ids is emitted as a JSON array');

select ok(
  (select bool_and(jsonb_typeof(element) = 'number')
     from hook_result, jsonb_array_elements(ev -> 'claims' -> 'app_metadata' -> 'group_ids') as element),
  'every group_ids element is a JSON number, never a string (ids emitted as text would fail this)');

select is(
  (select ev -> 'claims' -> 'app_metadata' -> 'group_ids' from hook_result),
  (select jsonb_agg(element order by (element::text)::bigint)
     from hook_result, jsonb_array_elements(ev -> 'claims' -> 'app_metadata' -> 'group_ids') as element),
  'group_ids elements are ascending -- a nondeterministic order would make token bytes unstable across logins');

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
  '{"app_metadata":{"member_role":"bce","member_level":5,"dept_ids":["edu"],"team_ids":["t-test"],"group_ids":[42,7]}}',
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


select is(auth_in_group(42), true,  'auth_in_group() true for a Group id listed in the token');
select is(auth_in_group(43), false, 'auth_in_group() false for a Group id absent from the token');
select is(auth_in_group(null), false, 'auth_in_group() false for a null argument');

-- A forged string-typed array must not satisfy containment (`?` matches string
-- elements; `@>` against a numeric argument does not) -- fails closed rather
-- than trusting a client-shaped token.
select set_config('request.jwt.claims',
  '{"app_metadata":{"group_ids":["42"]}}',
  true);
select is(auth_in_group(42), false,
  'auth_in_group() rejects a forged string-typed group_ids array');

-- ==================== Privileges ====================
select ok(
  has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'the Auth server may execute the hook');

select ok(
  not has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'execute'),
  'clients may not execute the hook');

select ok(
  not has_function_privilege('anon', 'public.auth_in_group(bigint)', 'execute'),
  'anon may not execute auth_in_group');

select ok(
  has_table_privilege('supabase_auth_admin', 'public.groups', 'select'),
  'the Auth server may read groups');

select ok(
  has_table_privilege('supabase_auth_admin', 'public.group_members', 'select'),
  'the Auth server may read group_members');

-- #591: the two legacy roster-claim helpers are gone.
select hasnt_function('public', 'auth_in_dept', array['text'], 'auth_in_dept() no longer exists (#591)');
select hasnt_function('public', 'auth_in_team', array['text'], 'auth_in_team() no longer exists (#591)');

select * from finish();
rollback;
