-- rls_teams_reference.test.sql — Epic 3.2c policies, per-role
-- (reference data + memberships + teams; part of the Epic 6.1 suite, #67).
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(20);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-0000000000c1', 'vera.ref@test.local'),
  ('c2000000-0000-0000-0000-0000000000c2', 'beniamin.ref@test.local');
insert into profiles (id, full_name, email, role) values
  ('c1000000-0000-0000-0000-0000000000c1', 'Vera Voluntar', 'vera.ref@test.local', 'voluntar'),
  ('c2000000-0000-0000-0000-0000000000c2', 'Beniamin BCE',  'beniamin.ref@test.local', 'bce');
insert into member_departments (member_id, dept_id)
  values
    ('c1000000-0000-0000-0000-0000000000c1', 'edu'),
    ('c2000000-0000-0000-0000-0000000000c2', 'edu');
insert into teams (id, name, dept_id) values ('t-ref', 'Echipa Referință', 'edu');
insert into team_members (team_id, member_id)
  values ('t-ref', 'c1000000-0000-0000-0000-0000000000c1');

-- ==================== A voluntar reads the vocabulary (AC) ====================
select pg_temp.test_login('c1000000-0000-0000-0000-0000000000c1', jsonb_build_object(
    'member_role', 'voluntar',
    'member_level', 1,
    'dept_ids', '["edu"]'::jsonb,
    'team_ids', '["t-ref"]'::jsonb
  ));

select is((select count(*) from roles), 8::bigint,
  'voluntar reads the role ladder');
select is((select count(*) from departments), 8::bigint,
  'eight departments (5 + diverse, secretariat, org)');
select is((select count(*) from rating_guide), 5::bigint,
  'voluntar reads the rating guide (the scoring rules are public)');
select is((select count(*) from difficulty_guide), 5::bigint,
  'voluntar reads the difficulty guide');
select is(
  (select count(*) from teams where id = 't-ref'),
  1::bigint,
  'voluntar reads the fixture team');
select is(
  (select count(*) from member_departments
    where member_id = 'c1000000-0000-0000-0000-0000000000c1'
      and dept_id = 'edu'),
  1::bigint,
  'voluntar reads the fixture department membership');
select is(
  (select count(*) from team_members
    where member_id = 'c1000000-0000-0000-0000-0000000000c1'
      and team_id = 't-ref'),
  1::bigint,
  'voluntar reads the fixture team membership');

-- ==================== …but changes nothing ====================
select throws_ok(
  $$ insert into teams (id, name, dept_id) values ('t-hack', 'Echipa mea', 'edu') $$,
  '42501', null, 'voluntar cannot create a team');
select throws_ok(
  $$ insert into member_departments (member_id, dept_id)
     values ('c1000000-0000-0000-0000-0000000000c1', 'fin') $$,
  '42501', null, 'voluntar cannot add themselves to another department');
select throws_ok(
  $$ insert into team_members (team_id, member_id)
     values ('t-ref', 'c2000000-0000-0000-0000-0000000000c2') $$,
  '42501', null, 'voluntar cannot add people to teams');

-- Reference data is migration-only: with a read policy but no write policy,
-- an UPDATE matches no rows — it is a silent no-op, not an error.
update rating_guide set multiplier = 99 where rating = 5;
select is((select multiplier from rating_guide where rating = 5), 3,
  'nobody edits the scoring guide from the client');

reset role;

-- ==================== BCE manages structure (AC) ====================
select pg_temp.test_login('c2000000-0000-0000-0000-0000000000c2', jsonb_build_object(
    'member_role', 'bce',
    'member_level', 5,
    'dept_ids', '["edu"]'::jsonb,
    'team_ids', '[]'::jsonb
  ));

select lives_ok(
  $$ insert into teams (id, name, dept_id) values ('t-new', 'Echipa Nouă', 'edu') $$,
  'level >= 5 creates teams');
select throws_ok(
  $$ insert into team_members (team_id, member_id)
     values ('t-new', 'c1000000-0000-0000-0000-0000000000c1') $$,
  '42501', null,
  'legacy direct Team roster writes are retired pending scoped commands');
select throws_ok(
  $$ insert into member_departments (member_id, dept_id)
     values ('c2000000-0000-0000-0000-0000000000c2', 'pr') $$,
  '42501', null,
  'BCE cannot directly manage department membership');

reset role;

-- ==================== A session with no org claims ====================
-- Clear the claims first: `reset role` alone keeps the previous login's JWT,
-- and these would run as Beniamin the BCE and pass for free.
select pg_temp.test_clear_jwt();
set local role authenticated;

select is((select count(*) from roles), 0::bigint,
  'claimless: the role ladder is hidden');
select is((select count(*) from departments), 0::bigint,
  'claimless: departments are hidden');
select is((select count(*) from member_departments), 0::bigint,
  'claimless: the member-to-department map is hidden');
select is((select count(*) from team_members), 0::bigint,
  'claimless: team rosters are hidden');
select is((select count(*) from teams), 0::bigint,
  'claimless: teams are hidden');

reset role;

-- ==================== anon still sees nothing ====================
set local role anon;
select throws_ok(
  $$ select count(*) from departments $$,
  '42501', null, 'anon has no access at all (invite-only, ADR-0003)');
reset role;

select * from finish();
rollback;
