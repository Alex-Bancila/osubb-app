-- profile_email_sync.test.sql — #632: sync auth.users.email → profiles.email.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(8);

-- ==================== Structure ====================
select has_function('private', 'sync_profile_email',
  'the sync function exists in the private schema');
select has_trigger('auth', 'users', 'users_sync_profile_email',
  'and it is wired to auth.users');

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('f6320000-0000-0000-0000-000000000001', 'ana.vechi@test.local'),
  ('f6320000-0000-0000-0000-000000000002', 'bogdan@test.local');
insert into profiles (id, full_name, email, role, status) values
  ('f6320000-0000-0000-0000-000000000001', 'Ana Test', 'ana.vechi@test.local', 'voluntar', 'activ'),
  ('f6320000-0000-0000-0000-000000000002', 'Bogdan Test', 'bogdan@test.local', 'voluntar', 'activ');

-- ==================== Sync on email update ====================
update auth.users set email = 'ana.nou@test.local'
 where id = 'f6320000-0000-0000-0000-000000000001';
select is(
  (select email from profiles where id = 'f6320000-0000-0000-0000-000000000001'),
  'ana.nou@test.local',
  'updating auth.users.email syncs into profiles.email');

-- ==================== Lowercase and trim normalization ====================
update auth.users set email = '  ANA.UPPER@Test.Local  '
 where id = 'f6320000-0000-0000-0000-000000000001';
select is(
  (select email from profiles where id = 'f6320000-0000-0000-0000-000000000001'),
  'ana.upper@test.local',
  'the sync lowercases and trims the email');

-- ==================== No-op on unrelated column update ====================
-- Update a non-email column; profiles.email must stay as it was.
update auth.users set raw_user_meta_data = '{"foo":"bar"}'::jsonb
 where id = 'f6320000-0000-0000-0000-000000000001';
select is(
  (select email from profiles where id = 'f6320000-0000-0000-0000-000000000001'),
  'ana.upper@test.local',
  'updating a non-email auth.users column leaves profiles.email alone');

-- Other member's profile is untouched by the first member's change.
select is(
  (select email from profiles where id = 'f6320000-0000-0000-0000-000000000002'),
  'bogdan@test.local',
  'another member''s profile.email is not affected');

-- ==================== Mutation guard ====================
-- Dropping the trigger must make the sync stop working. This is the
-- "a test must fail if the feature is removed" house rule.
drop trigger users_sync_profile_email on auth.users;

update auth.users set email = 'ana.fara-trigger@test.local'
 where id = 'f6320000-0000-0000-0000-000000000001';
select is(
  (select email from profiles where id = 'f6320000-0000-0000-0000-000000000001'),
  'ana.upper@test.local',
  'without the trigger, auth.users.email no longer syncs into profiles');

-- Restore the trigger so rollback leaves the database consistent.
create trigger users_sync_profile_email
  after update of email on auth.users
  for each row
  execute function private.sync_profile_email();

select * from finish();
rollback;
