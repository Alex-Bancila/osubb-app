-- rls_profiles_write.test.sql — Epic 3.2b: self-edit, and the self-promotion guard.
-- Part of the Epic 6.1 per-role suite (#67).
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(27);

-- ==================== Structure ====================
select has_function('public', 'guard_profile_privileged_columns',
  'the privileged-column guard exists');
select has_trigger('public', 'profiles', 'profiles_guard_privileged',
  'and it is wired to profiles');
-- auth_admin_read_profiles is the dormant policy the claims hook reads through
-- as supabase_auth_admin; without it, enabling RLS here would break every login.
select policies_are('public', 'profiles',
  array['profiles_read', 'profiles_self_update', 'auth_admin_read_profiles'],
  'profiles carries the read policy, the self-update policy, and the hook''s');

-- The two columns no client writes, ever — not even BC (they are not a level
-- question, they are "never edited from the app").
select ok(not has_column_privilege('authenticated', 'profiles', 'id', 'update'),
  'no member may write profiles.id — it IS the auth user');
select ok(not has_column_privilege('authenticated', 'profiles', 'created_at', 'update'),
  'no member may write profiles.created_at');
select ok(has_column_privilege('authenticated', 'profiles', 'full_name', 'update'),
  'full_name stays writable at the column level (the trigger is not involved)');

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-0000000000e1', 'emil.vol@test.local'),
  ('e2000000-0000-0000-0000-0000000000e2', 'eva.vol@test.local'),
  ('e3000000-0000-0000-0000-0000000000e3', 'elena.resp@test.local'),
  ('e4000000-0000-0000-0000-0000000000e4', 'eduard.bc@test.local'),
  ('e5000000-0000-0000-0000-0000000000e5', 'ela.fost@test.local');
insert into profiles (id, full_name, email, phone, role, status) values
  ('e1000000-0000-0000-0000-0000000000e1', 'Emil Voluntar',   'emil.vol@test.local',   '0700000001', 'voluntar',    'activ'),
  ('e2000000-0000-0000-0000-0000000000e2', 'Eva Voluntar',    'eva.vol@test.local',    '0700000002', 'voluntar',    'activ'),
  ('e3000000-0000-0000-0000-0000000000e3', 'Elena Responsabil','elena.resp@test.local', '0700000003', 'responsabil', 'activ'),
  ('e4000000-0000-0000-0000-0000000000e4', 'Eduard BC',       'eduard.bc@test.local',  '0700000004', 'bc',          'activ'),
  -- Deactivated: keeps their uid and their row, loses their claims (ADR-0003).
  ('e5000000-0000-0000-0000-0000000000e5', 'Ela Fostă',       'ela.fost@test.local',   '0700000005', 'voluntar',    'inactiv');

-- ==================== A voluntar edits themselves (AC) ====================
select pg_temp.test_login('e1000000-0000-0000-0000-0000000000e1', jsonb_build_object(
    'member_role', 'voluntar',
    'member_level', 1,
    'dept_ids', '["edu"]'::jsonb,
    'team_ids', '[]'::jsonb
  ));

update profiles set full_name = 'Emil Mureșan'
 where id = 'e1000000-0000-0000-0000-0000000000e1';
select is(
  (select full_name from profiles where id = 'e1000000-0000-0000-0000-0000000000e1'),
  'Emil Mureșan', 'SELF renames themselves');

update profiles set phone = '0711999888', avatar_color = '#284C93'
 where id = 'e1000000-0000-0000-0000-0000000000e1';
select is(
  (select avatar_color from profiles where id = 'e1000000-0000-0000-0000-0000000000e1'),
  '#284C93', 'SELF updates their own contact fields and avatar');

-- ==================== …but never promotes themselves (AC) ====================
-- These raise rather than silently affecting zero rows: the row IS visible to
-- the policy (it is their own), so the statement reaches the trigger.
select throws_ok(
  $$ update profiles set role = 'bc' where id = 'e1000000-0000-0000-0000-0000000000e1' $$,
  '42501', null, 'SELF cannot promote themselves');
select throws_ok(
  $$ update profiles set status = 'alumni' where id = 'e1000000-0000-0000-0000-0000000000e1' $$,
  '42501', null, 'SELF cannot change their own status');
select throws_ok(
  $$ update profiles set email = 'altcineva@test.local' where id = 'e1000000-0000-0000-0000-0000000000e1' $$,
  '42501', null, 'SELF cannot rewrite the address they were invited at');
select throws_ok(
  $$ update profiles set tier = 'Legendă' where id = 'e1000000-0000-0000-0000-0000000000e1' $$,
  '42501', null, 'SELF cannot award themselves a tier');
select throws_ok(
  $$ update profiles set joined_year = 2019 where id = 'e1000000-0000-0000-0000-0000000000e1' $$,
  '42501', null, 'SELF cannot backdate when they joined (the promotion clock)');
select throws_ok(
  $$ update profiles set joined_at = '2019-01-01' where id = 'e1000000-0000-0000-0000-0000000000e1' $$,
  '42501', null, 'SELF cannot backdate their exact join date either (#160)');

select is(
  (select role::text from profiles where id = 'e1000000-0000-0000-0000-0000000000e1'),
  'voluntar', 'after all that, the role is untouched');

-- ==================== …and cannot edit anyone else ====================
-- ⚠️ An UPDATE the policy rejects affects ZERO ROWS and returns quietly — it
-- does not raise. Asserting `throws_ok` here would pass for the wrong reason.
update profiles set full_name = 'Hacked' where id = 'e2000000-0000-0000-0000-0000000000e2';
select is(
  (select full_name from profiles where id = 'e2000000-0000-0000-0000-0000000000e2'),
  'Eva Voluntar', 'a voluntar cannot rename another member (denied silently)');

reset role;

-- ==================== Level 4 is not level 6 ====================
-- A Responsabil manages tasks, not people. The nearest thing to a promotion
-- attempt by someone who legitimately holds power elsewhere.
select pg_temp.test_login('e3000000-0000-0000-0000-0000000000e3', jsonb_build_object(
    'member_role', 'responsabil',
    'member_level', 4,
    'dept_ids', '["edu"]'::jsonb,
    'team_ids', '[]'::jsonb
  ));

update profiles set full_name = 'Elena R.' where id = 'e3000000-0000-0000-0000-0000000000e3';
select is(
  (select full_name from profiles where id = 'e3000000-0000-0000-0000-0000000000e3'),
  'Elena R.', 'a responsabil still edits their own name');

select throws_ok(
  $$ update profiles set role = 'bce' where id = 'e3000000-0000-0000-0000-0000000000e3' $$,
  '42501', null, 'a responsabil (level 4) cannot promote themselves either');

update profiles set role = 'recrut' where id = 'e1000000-0000-0000-0000-0000000000e1';
select is(
  (select role::text from profiles where id = 'e1000000-0000-0000-0000-0000000000e1'),
  'voluntar', 'a responsabil cannot demote someone else (denied silently)');

reset role;

-- ==================== BC may (AC) ====================
select pg_temp.test_login('e4000000-0000-0000-0000-0000000000e4', jsonb_build_object(
    'member_role', 'bc',
    'member_level', 6,
    'dept_ids', '["org"]'::jsonb,
    'team_ids', '[]'::jsonb
  ));

update profiles set role = 'activ' where id = 'e1000000-0000-0000-0000-0000000000e1';
select is(
  (select role::text from profiles where id = 'e1000000-0000-0000-0000-0000000000e1'),
  'activ', 'BC promotes a member');

update profiles set status = 'alumni' where id = 'e2000000-0000-0000-0000-0000000000e2';
select is(
  (select status::text from profiles where id = 'e2000000-0000-0000-0000-0000000000e2'),
  'alumni', 'BC changes a member''s status');

update profiles set email = 'eva.corectat@test.local'
 where id = 'e2000000-0000-0000-0000-0000000000e2';
-- Read it back through profiles_contact, not the table: `email` is revoked from
-- `authenticated` at the column level (3.2a), and BC is `authenticated` like
-- everyone else. BC may *write* the column and *read* it through the gated view
-- (level >= 5) — selecting it from the table would raise 42501 even for them.
select is(
  (select email from profiles_contact where id = 'e2000000-0000-0000-0000-0000000000e2'),
  'eva.corectat@test.local', 'BC fixes a typo in an invited address');

-- Even BC writes through the app cannot touch these, by column privilege.
select throws_ok(
  $$ update profiles set created_at = now() - interval '1 year'
      where id = 'e1000000-0000-0000-0000-0000000000e1' $$,
  '42501', null, 'not even BC rewrites created_at from the app');

reset role;

-- ==================== A deactivated member (ADR-0003 gate 2) ====================
-- The case house rule 12 exists for: same uid, same profiles row, no claims.
-- `set_config` clears the JWT — `reset role` alone would leave Eduard's.
select pg_temp.test_clear_jwt();
set local role authenticated;

-- Both are denied silently: the policy hides the row, so zero rows are updated.
update profiles set full_name = 'Ela Revenită'
 where id = 'e5000000-0000-0000-0000-0000000000e5';
update profiles set status = 'activ'
 where id = 'e5000000-0000-0000-0000-0000000000e5';

-- The assertions come *after* reset role on purpose: this session cannot read
-- the row either, so checking from inside it would compare NULL to NULL and
-- pass no matter what the writes did.
reset role;

select is(
  (select full_name from profiles where id = 'e5000000-0000-0000-0000-0000000000e5'),
  'Ela Fostă', 'a claimless session cannot edit the profile it used to own');
select is(
  (select status::text from profiles where id = 'e5000000-0000-0000-0000-0000000000e5'),
  'inactiv', 'and above all cannot reactivate itself');

-- ==================== anon ====================
set local role anon;
select throws_ok(
  $$ update profiles set full_name = 'x' where id = 'e1000000-0000-0000-0000-0000000000e1' $$,
  '42501', null, 'anon writes nothing (invite-only, ADR-0003)');
reset role;

-- ==================== The server-side paths stay open ====================
-- Back as the owner: the seed, provision_profile() and the future promotion
-- job (#52) carry no member_level, so a level check alone would have blocked
-- exactly the callers that are supposed to set roles.
update profiles set role = 'vot' where id = 'e1000000-0000-0000-0000-0000000000e1';
select is(
  (select role::text from profiles where id = 'e1000000-0000-0000-0000-0000000000e1'),
  'vot', 'a server-side caller (no claims, not a client role) still sets roles');

select * from finish();
rollback;
