-- notif_suppression.test.sql — Epic 1.6b: suppression seed + push tokens.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(18);

-- ==================== Shape ====================
select has_table('public', 'notif_suppression', 'notif_suppression table exists');
select has_table('public', 'push_tokens', 'push_tokens table exists');
select ok(
  (select relrowsecurity from pg_class
    where relname = 'notif_suppression' and relnamespace = 'public'::regnamespace),
  'RLS is enabled on notif_suppression');
select ok(
  (select relrowsecurity from pg_class
    where relname = 'push_tokens' and relnamespace = 'public'::regnamespace),
  'RLS is enabled on push_tokens');

-- ==================== The seed: bc AND bce (AC) ====================
-- Revision 3 §9.2 supersedes the spec's bc-only insert. This test is the
-- guard against anyone "fixing" the seed back to three rows.
select is((select count(*) from notif_suppression), 6::bigint,
  'the six suppression rows exist');

select set_eq(
  $$ select role::text || ':' || kind::text from notif_suppression $$,
  array['bc:task', 'bc:event', 'bc:deadline', 'bce:task', 'bce:event', 'bce:deadline'],
  'suppression covers bc AND bce across task/event/deadline');

select is((select count(*) from notif_suppression where kind = 'announce'), 0::bigint,
  'announcements are never suppressed — leadership still gets them');

select ok(
  not exists (select 1 from notif_suppression s
               left join roles r on r.id = s.role
              where r.id is null),
  'every suppressed role is a real role');

-- ==================== push_tokens ====================
insert into auth.users (id, email) values
  ('a3000000-0000-0000-0000-0000000000a3', 'petra.push@test.local');
insert into profiles (id, full_name, email, role) values
  ('a3000000-0000-0000-0000-0000000000a3', 'Petra Test', 'petra.push@test.local', 'voluntar');

insert into push_tokens (member_id, token, platform)
  values ('a3000000-0000-0000-0000-0000000000a3', 'token-abc', 'web');
insert into push_tokens (member_id, token, platform)
  values ('a3000000-0000-0000-0000-0000000000a3', 'token-xyz', 'android');

select is((select count(*) from push_tokens), 2::bigint,
  'one member may register several devices');

select throws_ok(
  $$ insert into push_tokens (member_id, token, platform)
     values ('a3000000-0000-0000-0000-0000000000a3', 'token-abc', 'web') $$,
  '23505', null, 'the same (member, token) pair is rejected');

select throws_ok(
  $$ insert into push_tokens (member_id, token, platform)
     values ('a3000000-0000-0000-0000-0000000000a3', 'token-new', 'blackberry') $$,
  '23514', null, 'platform is limited to ios/android/web');

-- ==================== Member-readable reference data (#65) ====================
insert into auth.users (id, email) values
  ('a0650000-0000-0000-0000-000000000011', 'suppression.member@test.local'),
  ('a0650000-0000-0000-0000-000000000012', 'suppression.inactive@test.local'),
  ('a0650000-0000-0000-0000-000000000013', 'suppression.claimless@test.local');
insert into profiles (id, full_name, email, role, status) values
  ('a0650000-0000-0000-0000-000000000011', 'Suppression Member', 'suppression.member@test.local', 'voluntar', 'activ'),
  ('a0650000-0000-0000-0000-000000000012', 'Suppression Inactive', 'suppression.inactive@test.local', 'bc', 'inactiv'),
  ('a0650000-0000-0000-0000-000000000013', 'Suppression Claimless', 'suppression.claimless@test.local', 'voluntar', 'activ');

select policies_are('public', 'notif_suppression', array['notif_suppression_read'],
  'suppression reference data exposes only its member read policy');
select ok(has_table_privilege('authenticated', 'notif_suppression', 'select'),
  'authenticated receives suppression SELECT');

select pg_temp.test_login_leadership('a0650000-0000-0000-0000-000000000011');
select is((select count(*) from notif_suppression), 6::bigint,
  'an active Member reads all suppression reference rows');
select throws_ok($$insert into notif_suppression (role, kind) values ('bc', 'announce')$$,
  '42501', null, 'a Member cannot mutate suppression reference data');
reset role;

select pg_temp.test_login('a0650000-0000-0000-0000-000000000012',
  '{"member_role":"bc","member_level":6,"dept_ids":[],"team_ids":[]}'::jsonb);
select is((select count(*) from notif_suppression), 0::bigint,
  'inactive caller reads no suppression rows despite stale claims');
reset role;

select pg_temp.test_login('a0650000-0000-0000-0000-000000000013',
  jsonb_build_object('provider', 'email'));
select is((select count(*) from notif_suppression), 0::bigint,
  'claimless caller reads no suppression rows');
reset role;

set local role anon;
select throws_ok($$select count(*) from notif_suppression$$, '42501', null,
  'anonymous callers cannot read suppression reference data');
reset role;

select * from finish();
rollback;
