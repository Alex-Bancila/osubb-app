-- rls_events.test.sql — ADR-0008 §Visibility: Minimum Level, not scope
-- membership or the retired recruit-team flag. Part of #372.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(14);

-- ==================== for_recruits / team_admits_recruits are gone ========
select hasnt_function('public', 'team_admits_recruits', array['text'],
  'team_admits_recruits() is retired — Minimum Level replaces it');
select hasnt_column('public', 'teams', 'for_recruits',
  'teams.for_recruits is dropped — recruit visibility is min_level 0, not a team flag');

-- ==================== Fixtures ====================
-- The demo seed fills these tables, and this suite counts events exactly —
-- a claim below is about these fixtures, not the demo calendar.
truncate events, event_attendance cascade;

insert into auth.users (id, email) values
  ('01000000-0000-0000-0000-000000000001', 'rares.recrut@test.local'),
  ('02000000-0000-0000-0000-000000000002', 'vlad.vot@test.local'),
  ('03000000-0000-0000-0000-000000000003', 'raluca.resp@test.local'),
  ('04000000-0000-0000-0000-000000000004', 'bianca.bce@test.local'),
  ('05000000-0000-0000-0000-000000000005', 'bogdan.bc@test.local'),
  ('06000000-0000-0000-0000-000000000006', 'dorin.dezactivat@test.local');
insert into profiles (id, full_name, email, role, status) values
  ('01000000-0000-0000-0000-000000000001', 'Rareș Recrut',      'rares.recrut@test.local', 'recrut',      'activ'),
  ('02000000-0000-0000-0000-000000000002', 'Vlad Vot',          'vlad.vot@test.local',     'vot',         'activ'),
  ('03000000-0000-0000-0000-000000000003', 'Raluca Responsabil','raluca.resp@test.local',  'responsabil', 'activ'),
  ('04000000-0000-0000-0000-000000000004', 'Bianca BCE',        'bianca.bce@test.local',   'bce',         'activ'),
  ('05000000-0000-0000-0000-000000000005', 'Bogdan BC',         'bogdan.bc@test.local',    'bc',          'activ'),
  -- A former BC, deactivated. Kept at the 'bc' role row so the fixture proves
  -- the denial comes from `status`, not from downgrading the role too.
  ('06000000-0000-0000-0000-000000000006', 'Dorin Dezactivat',  'dorin.dezactivat@test.local', 'bc',      'inactiv');
insert into member_departments (member_id, dept_id) values
  ('01000000-0000-0000-0000-000000000001', 'edu'),
  ('02000000-0000-0000-0000-000000000002', 'pr'),
  ('03000000-0000-0000-0000-000000000003', 'edu');

insert into teams (id, name, dept_id) values
  ('t-pr', 'Echipa PR', 'pr');
insert into team_members (team_id, member_id)
  values ('t-pr', '02000000-0000-0000-0000-000000000002');

-- One event per (scope, Minimum Level) combination that matters: 0 spread
-- across all three scopes (proving scope is no longer a visibility gate —
-- the behaviour change this issue makes), then one gate per remaining rung
-- of the ladder (3/4/5/6). 'Recrutare grea' is type 'recrutare' at
-- min_level 4 specifically to prove the old "recruitment reaches everyone by
-- type" branch is gone too — a Recrut must NOT see it.
insert into events (title, type, scope, dept_id, team_id, min_level, starts_at) values
  ('Everyone org',        'sedinta',   'org',  null,  null,   0, now() + interval '1 day'),
  ('Foreign dept open',   'sedinta',   'dept', 'pr',  null,   0, now() + interval '2 days'),
  ('Foreign team open',   'sedinta',   'team', 'pr',  't-pr', 0, now() + interval '3 days'),
  ('AG gated',            'sedinta',   'org',  null,  null,   3, now() + interval '4 days'),
  ('Dept gated 4',        'sedinta',   'dept', 'edu', null,   4, now() + interval '5 days'),
  ('Recrutare grea',      'recrutare', 'dept', 'hr',  null,   4, now() + interval '6 days'),
  ('Team gated 5',        'sedinta',   'team', 'pr',  't-pr', 5, now() + interval '7 days'),
  ('Org gated 6',         'sedinta',   'org',  null,  null,   6, now() + interval '8 days');

-- ==================== Recrut: level 0, dept EDU, no team ====================
select pg_temp.test_login('01000000-0000-0000-0000-000000000001', jsonb_build_object(
    'member_role', 'recrut',
    'member_level', 0,
    'dept_ids', '["edu"]'::jsonb,
    'team_ids', '[]'::jsonb
  ));

select set_eq(
  $$ select title from events $$,
  array['Everyone org', 'Foreign dept open', 'Foreign team open'],
  'a Recrut sees exactly the min_level = 0 rows, regardless of scope, including a foreign department and a team they are not in');

reset role;

-- ==================== Vot: level 3, dept PR, team t-pr =====================
select pg_temp.test_login('02000000-0000-0000-0000-000000000002', jsonb_build_object(
    'member_role', 'vot',
    'member_level', 3,
    'dept_ids', '["pr"]'::jsonb,
    'team_ids', '["t-pr"]'::jsonb
  ));

select set_eq(
  $$ select title from events $$,
  array['Everyone org', 'Foreign dept open', 'Foreign team open', 'AG gated'],
  'level 3 adds the min_level = 3 row on top of everything level 0 already saw');

select throws_ok(
  $$ insert into events (title, type, scope, starts_at)
     values ('Eveniment neautorizat', 'sedinta', 'org', now()) $$,
  '42501', null, 'level 3 cannot create events');

select throws_ok(
  $$ update events set title = 'Redenumit' where title = 'AG gated' $$,
  '42501', null, 'level 3 cannot edit events');

reset role;

-- ==================== Responsabil: level 4 =====================
select pg_temp.test_login('03000000-0000-0000-0000-000000000003', jsonb_build_object(
    'member_role', 'responsabil',
    'member_level', 4,
    'dept_ids', '["edu"]'::jsonb,
    'team_ids', '[]'::jsonb
  ));

select set_eq(
  $$ select title from events $$,
  array['Everyone org', 'Foreign dept open', 'Foreign team open', 'AG gated', 'Dept gated 4', 'Recrutare grea'],
  'level 4 adds both min_level = 4 rows — "Recrutare grea" included by level only, not by its recrutare type');

select lives_ok(
  $$ select public.create_event(
       p_title := 'Workshop CV',
       p_type := 'activitate',
       p_scope := 'dept',
       p_starts_at := now(),
       p_dept_id := 'edu') $$,
  'level >= 4 creates events through the validated command');
select throws_ok(
  $$ update events set location = 'Sala 5' where title = 'Dept gated 4' $$,
  '42501', null, 'direct event updates are disabled until the update command lands');

reset role;

-- Clean up create_event's own row (as the table owner, since #370's
-- create_event command is the only INSERT path — `authenticated` itself has
-- no table-level grant) so the later personas' set_eq assertions stay an
-- exact match against only this suite's fixtures.
delete from events where title = 'Workshop CV';

-- ==================== BCE: level 5 =====================
select pg_temp.test_login('04000000-0000-0000-0000-000000000004', jsonb_build_object(
    'member_role', 'bce',
    'member_level', 5,
    'dept_ids', '[]'::jsonb,
    'team_ids', '[]'::jsonb
  ));

select set_eq(
  $$ select title from events $$,
  array['Everyone org', 'Foreign dept open', 'Foreign team open', 'AG gated',
        'Dept gated 4', 'Recrutare grea', 'Team gated 5'],
  'level 5 adds the min_level = 5 row — still missing the min_level = 6 one');

reset role;

-- ==================== BC: level 6 sees everything =====================
select pg_temp.test_login('05000000-0000-0000-0000-000000000005', jsonb_build_object(
    'member_role', 'bc',
    'member_level', 6,
    'dept_ids', '[]'::jsonb,
    'team_ids', '[]'::jsonb
  ));

select set_eq(
  $$ select title from events $$,
  array['Everyone org', 'Foreign dept open', 'Foreign team open', 'AG gated',
        'Dept gated 4', 'Recrutare grea', 'Team gated 5', 'Org gated 6'],
  'level 6 sees every Event, including min_level = 6');

reset role;

-- ==== Deactivated member: stale JWT still claims bc/level 6 ====
-- This is the decision this migration makes explicit: live level, not
-- auth_level(). The JWT below is deliberately identical in shape to the
-- live BC's — only `profiles.status` differs — so a pass here can only be
-- explained by the policy reading the live row, not the token.
select pg_temp.test_login('06000000-0000-0000-0000-000000000006', jsonb_build_object(
    'member_role', 'bc',
    'member_level', 6,
    'dept_ids', '[]'::jsonb,
    'team_ids', '[]'::jsonb
  ));

select is((select count(*) from events), 0::bigint,
  'a deactivated member sees no Event at all, even min_level = 0, despite a stale bc/level-6 JWT');

reset role;

-- ==================== The stranger: authenticated without claims ====================
-- `reset role` keeps the previous JWT — clear it, or org-scoped events would
-- make these pass for the wrong reason.
select pg_temp.test_clear_jwt();
set local role authenticated;

select is((select count(*) from events), 0::bigint,
  'a claimless session sees no events at all (ADR-0003 gate 2)');

reset role;

-- ==================== anon ====================
set local role anon;
select throws_ok(
  $$ select count(*) from events $$,
  '42501', null, 'anon has no access at all');
reset role;

select * from finish();
rollback;
