-- rls_profiles_read.test.sql — Epic 3.2a: profile rows vs contact columns.
-- Part of the Epic 6.1 per-role suite (#67).
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(21);

-- ==================== Structure ====================
select has_view('public', 'profiles_directory', 'the safe projection exists');
select has_view('public', 'profiles_contact', 'the gated contact view exists');

select hasnt_column('public', 'profiles_directory', 'email',
  'the directory carries no email');
select hasnt_column('public', 'profiles_directory', 'phone',
  'the directory carries no phone');

select ok(
  not has_column_privilege('authenticated', 'profiles', 'email', 'select'),
  'members hold no column privilege on profiles.email');
select ok(
  not has_column_privilege('authenticated', 'profiles', 'phone', 'select'),
  'members hold no column privilege on profiles.phone');
select ok(
  has_column_privilege('authenticated', 'profiles', 'full_name', 'select'),
  'names stay readable at the column level');

-- The claims hook must keep working: it reads profiles as supabase_auth_admin.
select ok(
  has_column_privilege('supabase_auth_admin', 'profiles', 'email', 'select'),
  'the auth server keeps its own grant (logins unaffected)');

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-0000000000d1', 'dora.prof@test.local'),
  ('d2000000-0000-0000-0000-0000000000d2', 'dinu.prof@test.local'),
  ('d3000000-0000-0000-0000-0000000000d3', 'delia.bce@test.local');
insert into profiles (id, full_name, email, phone, role) values
  ('d1000000-0000-0000-0000-0000000000d1', 'Dora Voluntar', 'dora.prof@test.local', '+40700111222', 'voluntar'),
  ('d2000000-0000-0000-0000-0000000000d2', 'Dinu Voluntar', 'dinu.prof@test.local', '0700333444', 'voluntar'),
  ('d3000000-0000-0000-0000-0000000000d3', 'Delia BCE',     'delia.bce@test.local', '0700555666', 'bce');

-- ==================== A voluntar: names yes, contacts no (AC) ====================
select pg_temp.test_login('d1000000-0000-0000-0000-0000000000d1', jsonb_build_object(
    'member_role', 'voluntar',
    'member_level', 1,
    'dept_ids', '["edu"]'::jsonb,
    'team_ids', '[]'::jsonb
  ));

select ok((select count(*) from profiles) >= 3,
  'voluntar sees every profile row (names next to tasks, pickers, directory)');
select is(
  (select full_name from profiles where id = 'd2000000-0000-0000-0000-0000000000d2'),
  'Dinu Voluntar', 'voluntar reads another member''s name');

select throws_ok(
  $$ select email from profiles where id = 'd2000000-0000-0000-0000-0000000000d2' $$,
  '42501', null, 'voluntar cannot read another member''s email from the table');
select throws_ok(
  $$ select phone from profiles $$,
  '42501', null, 'voluntar cannot read phones from the table — not even their own');

-- SELF gets their contact details back through the gated view.
select is(
  (select email from profiles_contact where id = 'd1000000-0000-0000-0000-0000000000d1'),
  'dora.prof@test.local', 'SELF reads own email through profiles_contact');
select is((select count(*) from profiles_contact), 1::bigint,
  'a voluntar sees exactly one contact row: their own');

select ok((select count(*) from profiles_directory) >= 3,
  'the directory projection is readable by any member');

reset role;

-- ==================== BCE: the whole directory, contacts included (AC) ====================
select pg_temp.test_login('d3000000-0000-0000-0000-0000000000d3', jsonb_build_object(
    'member_role', 'bce',
    'member_level', 5,
    'dept_ids', '["edu"]'::jsonb,
    'team_ids', '[]'::jsonb
  ));

select ok((select count(*) from profiles_contact) >= 3,
  'level >= 5 reads everyone''s contact details (volunteers directory)');
select is(
  (select phone from profiles_contact where id = 'd1000000-0000-0000-0000-0000000000d1'),
  '+40700111222', 'level >= 5 reads a specific member''s phone');

reset role;

reset role;

-- ==================== The stranger: authenticated, but not a member ====================
-- ADR-0003 gate 2. A session with no org claims (never invited, or
-- deactivated and re-issued a token) must not browse the member list.
-- Clearing the claims matters: `reset role` alone leaves the previous
-- login's JWT in place, and these three would pass as Delia the BCE.
select pg_temp.test_clear_jwt();
set local role authenticated;

select is((select count(*) from profiles), 0::bigint,
  'a claimless session sees no profile rows');
select is((select count(*) from profiles_directory), 0::bigint,
  'a claimless session sees no directory');
select is((select count(*) from profiles_contact), 0::bigint,
  'a claimless session sees no contact details');

reset role;

-- ==================== anon ====================
set local role anon;
select throws_ok(
  $$ select count(*) from profiles_directory $$,
  '42501', null, 'anon reads no directory at all (invite-only, ADR-0003)');
reset role;

select * from finish();
rollback;
