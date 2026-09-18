-- profiles_joined_at.test.sql — #160: the exact join date the Recrut ->
-- Voluntar tenure rule needs. Column shape, the one-shot backfill (not a
-- trigger), the safe-projection view, and the same privileged-column guard
-- that already protects joined_year.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- ==================== Structure ====================
select has_column('public', 'profiles', 'joined_at',
  'profiles carries joined_at');
select col_type_is('public', 'profiles', 'joined_at', 'date',
  'joined_at is a calendar date, not an instant (conventions section 7)');
select col_is_null('public', 'profiles', 'joined_at',
  'joined_at is nullable — genuinely unknown join dates stay null');

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('16000000-0000-0000-0000-000000000001', 'self-160@test.local'),
  ('16000000-0000-0000-0000-000000000002', 'bc-160@test.local'),
  ('16000000-0000-0000-0000-000000000003', 'fresh-160@test.local');
insert into profiles (id, full_name, email, role, status, joined_year) values
  ('16000000-0000-0000-0000-000000000001', 'Self 160', 'self-160@test.local', 'voluntar', 'activ', 2025),
  ('16000000-0000-0000-0000-000000000002', 'BC 160', 'bc-160@test.local', 'bc', 'activ', 2023);

-- The #160 backfill is a one-shot UPDATE in the migration, not a trigger — a
-- row inserted afterwards with a joined_year and no joined_at stays null.
insert into profiles (id, full_name, email, role, status, joined_year) values
  ('16000000-0000-0000-0000-000000000003', 'Fresh 160', 'fresh-160@test.local', 'voluntar', 'activ', 2024);
select is(
  (select joined_at from profiles where id = '16000000-0000-0000-0000-000000000003'),
  null::date,
  'a freshly inserted row with a joined_year keeps joined_at null — the backfill does not run again');

-- ==================== Grants ====================
select ok(has_column_privilege('authenticated', 'profiles', 'joined_at', 'select'),
  'authenticated may read joined_at');

-- ==================== The safe projection ====================
select has_column('public', 'profiles_directory', 'joined_at',
  'profiles_directory exposes joined_at');

-- ==================== The privileged-column guard covers it too ====================
select pg_temp.test_login('16000000-0000-0000-0000-000000000001', jsonb_build_object(
    'member_role', 'voluntar',
    'member_level', 1,
    'dept_ids', '["edu"]'::jsonb,
    'team_ids', '[]'::jsonb
  ));

select throws_ok(
  $$ update profiles set joined_at = '2019-01-01' where id = '16000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'SELF cannot set their own joined_at — the guard was extended, not bypassed');

reset role;

select pg_temp.test_login('16000000-0000-0000-0000-000000000002', jsonb_build_object(
    'member_role', 'bc',
    'member_level', 6,
    'dept_ids', '["org"]'::jsonb,
    'team_ids', '[]'::jsonb
  ));

update profiles set joined_at = '2019-01-01'
 where id = '16000000-0000-0000-0000-000000000001';
select is(
  (select joined_at from profiles where id = '16000000-0000-0000-0000-000000000001'),
  '2019-01-01'::date,
  'BC sets joined_at and it lands');

reset role;

-- A claimless session cannot touch the row at all — the UPDATE is denied
-- silently by RLS (zero rows), not with an exception; asserting throws_ok
-- here would pass for the wrong reason (rls_profiles_write.test.sql:89-90).
select pg_temp.test_clear_jwt();
set local role authenticated;

update profiles set joined_at = '2020-01-01'
 where id = '16000000-0000-0000-0000-000000000001';

reset role;

select is(
  (select joined_at from profiles where id = '16000000-0000-0000-0000-000000000001'),
  '2019-01-01'::date,
  'a claimless session cannot change joined_at (denied silently, value unchanged)');

select * from finish();
rollback;
