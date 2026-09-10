-- notif_suppression.test.sql — Epic 1.6b: suppression seed + push tokens.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(11);

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

select * from finish();
rollback;
