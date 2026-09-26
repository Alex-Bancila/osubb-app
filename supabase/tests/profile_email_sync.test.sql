-- profile_email_sync.test.sql -- #632: profiles.email follows auth.users.email.
-- Runs in one transaction and rolls back -- leaves no residue in the local db.
--
-- GoTrue sets auth.users.email only once both addresses have confirmed the
-- change (double_confirm_changes), as supabase_auth_admin. postgres may not
-- SET ROLE to supabase_auth_admin locally, so the updates below run as
-- postgres; what makes the Auth role's update work -- a security definer body
-- owned by postgres, since supabase_auth_admin holds no UPDATE on profiles --
-- is asserted structurally instead. The end-to-end path through GoTrue was
-- checked by hand on the local stack for #632.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(14);

-- ==================== Structure ====================
select has_trigger('auth', 'users', 'users_sync_profile_email',
  'auth.users carries the email sync trigger');

select is(
  (select p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres'
     from pg_proc p
    where p.oid = 'private.sync_profile_email()'::regprocedure),
  true,
  'the sync body is security definer owned by postgres, so it can write profiles when GoTrue fires it');

select is(
  has_table_privilege('supabase_auth_admin', 'public.profiles', 'update'),
  false,
  'supabase_auth_admin holds no UPDATE on profiles -- the definer body is what writes');

select is(
  array(
    select grantee
      from unnest(array['public', 'anon', 'authenticated', 'service_role', 'supabase_auth_admin']) as grantee
     where has_function_privilege(grantee, 'private.sync_profile_email()', 'execute')
  ),
  '{}'::text[],
  'nobody but its owner may execute the trigger body (conventions §4: a trigger function gets no grant back)');

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('f6320000-0000-0000-0000-000000000001', 'ana.vechi@test.local'),
  ('f6320000-0000-0000-0000-000000000002', 'bogdan@test.local');
insert into profiles (id, full_name, email, role, status) values
  ('f6320000-0000-0000-0000-000000000001', 'Ana Test', 'ana.vechi@test.local', 'voluntar', 'activ'),
  ('f6320000-0000-0000-0000-000000000002', 'Bogdan Test', 'bogdan@test.local', 'voluntar', 'activ');

-- ==================== The confirmed change syncs ====================
update auth.users set email = 'ana.nou@test.local'
 where id = 'f6320000-0000-0000-0000-000000000001';
select is(
  (select email from profiles where id = 'f6320000-0000-0000-0000-000000000001'),
  'ana.nou@test.local',
  'a confirmed change of auth.users.email is written into profiles.email');

-- ==================== Normalization ====================
update auth.users set email = '  ANA.Upper@Test.Local  '
 where id = 'f6320000-0000-0000-0000-000000000001';
select is(
  (select email from profiles where id = 'f6320000-0000-0000-0000-000000000001'),
  'ana.upper@test.local',
  'the synced address is trimmed and lowercased');

-- ==================== Only an email change fires ====================
-- A sentinel that differs from auth.users.email: if any other column's update
-- reached the body, it would overwrite this.
update profiles set email = 'sentinela@test.local'
 where id = 'f6320000-0000-0000-0000-000000000001';
update auth.users set raw_user_meta_data = '{"foo":"bar"}'::jsonb
 where id = 'f6320000-0000-0000-0000-000000000001';
select is(
  (select email from profiles where id = 'f6320000-0000-0000-0000-000000000001'),
  'sentinela@test.local',
  'updating any other auth.users column leaves profiles.email alone');

-- `update of email` also fires when email is set to its current value; the
-- trigger's `when (old.email is distinct from new.email)` is what stops it.
update auth.users set email = email
 where id = 'f6320000-0000-0000-0000-000000000001';
select is(
  (select email from profiles where id = 'f6320000-0000-0000-0000-000000000001'),
  'sentinela@test.local',
  'setting auth.users.email to its current value leaves profiles.email alone');

select is(
  (select email from profiles where id = 'f6320000-0000-0000-0000-000000000002'),
  'bogdan@test.local',
  'another Member''s profiles.email is untouched');

-- ==================== A blank Auth address is skipped ====================
select lives_ok(
  $$ update auth.users set email = null
      where id = 'f6320000-0000-0000-0000-000000000002' $$,
  'an Auth update to no address does not fail on profiles.email not null');
select is(
  (select email from profiles where id = 'f6320000-0000-0000-0000-000000000002'),
  'bogdan@test.local',
  'and profiles.email keeps the last real address');
select lives_ok(
  $$ update auth.users set email = '   '
      where id = 'f6320000-0000-0000-0000-000000000002' $$,
  'an Auth update to a whitespace-only address does not fail either');
select is(
  (select email from profiles where id = 'f6320000-0000-0000-0000-000000000002'),
  'bogdan@test.local',
  'a whitespace-only Auth address, blank once trimmed, does not replace the last real address');

-- ==================== Clients still cannot write the column ====================
select pg_temp.test_login('f6320000-0000-0000-0000-000000000002',
  jsonb_build_object('member_role', 'voluntar', 'member_level', 1, 'group_ids', '[]'::jsonb));
select throws_ok(
  $$ update profiles set email = 'altceva@test.local'
      where id = 'f6320000-0000-0000-0000-000000000002' $$,
  '42501', null,
  'a Member below level 6 still cannot write profiles.email directly: the change goes through Auth');
reset role;

select * from finish();
rollback;
