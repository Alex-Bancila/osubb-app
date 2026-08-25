-- points_visibility.test.sql — 1.4b: totals are public, the ledger is not.
-- Part of the Epic 6.1 per-role suite (#67).
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- ==================== Login simulation ====================
create function pg_temp.login(uid uuid, r text, lvl int, depts jsonb, tms jsonb)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', uid, 'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'member_role', r, 'member_level', lvl,
      'dept_ids', depts, 'team_ids', tms))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ==================== Structure ====================
-- The one view that deliberately runs with owner rights, and the two that must
-- NOT — they are what keeps the totals gated behind profiles / memberships.
select ok(
  not exists (select 1 from pg_class
               where relname = 'member_points'
                 and 'security_invoker=on' = any (reloptions)),
  'member_points runs with owner rights, so it can sum the whole ledger');
select ok(
  exists (select 1 from pg_class
           where relname = 'leaderboard'
             and 'security_invoker=on' = any (reloptions)),
  'leaderboard still runs as the caller');
select ok(
  exists (select 1 from pg_class
           where relname = 'dept_cup'
             and 'security_invoker=on' = any (reloptions)),
  'dept_cup still runs as the caller');

-- ==================== Fixtures ====================
-- Two members in two departments, with different totals and a sanction, so
-- "can you see someone else's number" has a real answer either way.
truncate points_ledger, member_departments cascade;

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-0000000000f1', 'flor.vol@test.local'),
  ('f2000000-0000-0000-0000-0000000000f2', 'felix.vol@test.local'),
  ('f3000000-0000-0000-0000-0000000000f3', 'fiona.bc@test.local');
insert into profiles (id, full_name, email, role) values
  ('f1000000-0000-0000-0000-0000000000f1', 'Flor Voluntar',  'flor.vol@test.local',  'voluntar'),
  ('f2000000-0000-0000-0000-0000000000f2', 'Felix Voluntar', 'felix.vol@test.local', 'voluntar'),
  ('f3000000-0000-0000-0000-0000000000f3', 'Fiona BC',       'fiona.bc@test.local',  'bc');
insert into member_departments (member_id, dept_id) values
  ('f1000000-0000-0000-0000-0000000000f1', 'edu'),
  ('f2000000-0000-0000-0000-0000000000f2', 'pr'),
  ('f3000000-0000-0000-0000-0000000000f3', 'org');

insert into points_ledger (member_id, delta, reason, awarded_by) values
  ('f1000000-0000-0000-0000-0000000000f1',  10, 'manual_award', 'f3000000-0000-0000-0000-0000000000f3'),
  ('f2000000-0000-0000-0000-0000000000f2',  25, 'manual_award', 'f3000000-0000-0000-0000-0000000000f3'),
  -- The row that must stay private even though Felix's total is public.
  ('f2000000-0000-0000-0000-0000000000f2',  -5, 'sanction',     'f3000000-0000-0000-0000-0000000000f3');

-- ==================== A voluntar sees everyone's total (AC) ====================
select pg_temp.login('f1000000-0000-0000-0000-0000000000f1', 'voluntar', 1, '["edu"]', '[]');

select is(
  (select points from member_points where member_id = 'f1000000-0000-0000-0000-0000000000f1'),
  10, 'a voluntar sees their own total');
select is(
  (select points from member_points where member_id = 'f2000000-0000-0000-0000-0000000000f2'),
  20, 'and another member''s real total — 25 minus the sanction, not zero');

select is(
  (select points from leaderboard where full_name = 'Felix Voluntar'),
  20, 'the leaderboard shows that member their true standing');
select is(
  (select rank from leaderboard where full_name = 'Felix Voluntar'),
  1::bigint, 'and ranks them above the caller, which was the whole point');

select is(
  (select points from dept_cup where dept_id = 'pr'),
  20, 'the department cup counts a department the caller is not in');

-- ==================== …but not the rows behind it (AC) ====================
-- The fence that has not moved: the sanction, its size and its author.
select is(
  (select count(*) from points_ledger where member_id = 'f2000000-0000-0000-0000-0000000000f2'),
  0::bigint, 'a voluntar still reads none of another member''s ledger rows');
select is(
  (select count(*) from points_ledger),
  1::bigint, 'they read exactly one ledger row: their own');

reset role;

-- ==================== BC agrees with them ====================
-- The bug was that these two disagreed. Same numbers from both ends is the
-- assertion that would have caught it.
select pg_temp.login('f3000000-0000-0000-0000-0000000000f3', 'bc', 6, '["org"]', '[]');

select is(
  (select points from member_points where member_id = 'f2000000-0000-0000-0000-0000000000f2'),
  20, 'BC reads the same total the voluntar was shown');
select is(
  (select points from dept_cup where dept_id = 'pr'),
  20, 'and the same department standings');
select is(
  (select count(*) from points_ledger where member_id = 'f2000000-0000-0000-0000-0000000000f2'),
  2::bigint, 'BC, unlike the voluntar, does read the rows behind it');

reset role;

-- ==================== A claimless session still sees nothing ====================
-- An owner-rights view has no RLS of its own, so this is the assertion that
-- keeps the exception honest (house rule 12).
select set_config('request.jwt.claims', '', true);
set local role authenticated;

select is((select count(*) from member_points), 0::bigint,
  'a claimless session reads no totals — the view''s own gate holds');
select is((select count(*) from leaderboard), 0::bigint,
  'nor the leaderboard');
select is((select count(*) from dept_cup), 0::bigint,
  'nor the department cup');

reset role;

select * from finish();
rollback;
