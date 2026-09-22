begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(29);

select has_table('public', 'campaigns', 'Campaigns table exists');
select columns_are(
  'public', 'campaigns',
  array['id', 'name', 'is_active', 'created_by',
        'created_at', 'updated_at', 'group_id'],
  'Campaigns expose exactly the requested fields -- department_id went with the bridge (#579)');
select col_is_pk('public', 'campaigns', 'id', 'Campaign id is the primary key');
select col_type_is('public', 'campaigns', 'id', 'bigint', 'Campaign id is bigint');
select col_not_null('public', 'campaigns', 'group_id',
  'a Campaign always names its owning Group (#579: the only Origin)');
select hasnt_column('public', 'campaigns', 'department_id',
  'the legacy Department column is gone (#579)');
select fk_ok('public', 'campaigns', 'group_id', 'public', 'groups', 'id',
  'Campaign Group references the Group model (#519)');
select col_not_null('public', 'campaigns', 'name', 'Campaign name is required');
select col_not_null('public', 'campaigns', 'is_active', 'Campaign activity is required');
select col_default_is('public', 'campaigns', 'is_active', 'true',
  'Campaigns default to active');
select col_not_null('public', 'campaigns', 'created_by', 'Campaign creator is required');
select fk_ok('public', 'campaigns', 'created_by', 'public', 'profiles', 'id',
  'Campaign creator references a Profile');
select col_not_null('public', 'campaigns', 'created_at', 'Creation time is required');
select col_has_default('public', 'campaigns', 'created_at', 'Creation time is server-written');
select col_not_null('public', 'campaigns', 'updated_at', 'Update time is required');
select col_has_default('public', 'campaigns', 'updated_at', 'Update time is server-written');
select ok(
  (select relrowsecurity from pg_class
    where oid = 'public.campaigns'::regclass),
  'Campaigns enable RLS at birth');

insert into auth.users (id, email) values
  ('a3130000-0000-0000-0000-000000000001', 'active.campaign@test.local'),
  ('a3130000-0000-0000-0000-000000000002', 'inactive.campaign@test.local');
insert into public.profiles (id, full_name, email, role, status) values
  ('a3130000-0000-0000-0000-000000000001', 'Active Recruit',
   'active.campaign@test.local', 'recrut', 'activ'),
  ('a3130000-0000-0000-0000-000000000002', 'Inactive Recruit',
   'inactive.campaign@test.local', 'recrut', 'inactiv');

insert into public.campaigns (group_id, name, is_active, created_by) values
  (pg_temp.dept_group('edu'), 'Admitere', true, 'a3130000-0000-0000-0000-000000000001'),
  (pg_temp.dept_group('pr'), 'Admitere', false, 'a3130000-0000-0000-0000-000000000001');

-- Scoped to this suite's own fixtures: #296 gave the demo seed one active
-- Campaign per real Department, so a bare count(*) over public.campaigns is no
-- longer this suite's own two rows.
select is(
  (select count(*) from public.campaigns
    where created_by = 'a3130000-0000-0000-0000-000000000001'), 2::bigint,
  'same Campaign name is accepted in different Departments');
select throws_ok(
  $$ insert into public.campaigns (group_id, name, created_by)
     values (pg_temp.dept_group('edu'), 'aDmItErE', 'a3130000-0000-0000-0000-000000000001') $$,
  '23505', 'duplicate key value violates unique constraint "campaigns_group_name_uidx"',
  'Campaign names are unique case-insensitively within a Department (enforced via campaigns_group_name_uidx since #519)');

select ok(not has_table_privilege('anon', 'public.campaigns', 'select'),
  'anon receives no Campaign read grant');
set local role anon;
select throws_ok(
  $$ select * from public.campaigns $$,
  '42501', null,
  'anon cannot read Campaigns');
reset role;
select ok(has_table_privilege('authenticated', 'public.campaigns', 'select'),
  'authenticated receives the Campaign read grant');
select ok(not has_table_privilege('authenticated', 'public.campaigns', 'insert'),
  'authenticated receives no Campaign insert grant');
select ok(not has_table_privilege('authenticated', 'public.campaigns', 'update'),
  'authenticated receives no Campaign update grant');
select ok(not has_table_privilege('authenticated', 'public.campaigns', 'delete'),
  'authenticated receives no Campaign delete grant');

select pg_temp.test_clear_jwt();
set local role authenticated;
select is((select count(*) from public.campaigns), 0::bigint,
  'claimless authenticated sessions read no Campaigns');
reset role;

select pg_temp.test_login(
  'a3130000-0000-0000-0000-000000000001',
  '{"member_role":"recrut","member_level":0,"dept_ids":[],"team_ids":[]}'::jsonb
);
-- Same scoping, same reason: what matters is that BOTH of this suite's
-- Campaigns — one active, one not — are visible to a level-zero Member.
select is(
  (select count(*) from public.campaigns
    where created_by = 'a3130000-0000-0000-0000-000000000001'), 2::bigint,
  'an active level-zero Member reads active and inactive Campaigns');
select throws_ok(
  $$ insert into public.campaigns (group_id, name, created_by)
     values (pg_temp.dept_group('edu'), 'Client write', 'a3130000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'an active Member cannot write Campaigns directly');
reset role;

select pg_temp.test_login(
  'a3130000-0000-0000-0000-000000000002',
  '{"member_role":"recrut","member_level":0,"dept_ids":[],"team_ids":[]}'::jsonb
);
select is((select count(*) from public.campaigns), 0::bigint,
  'an inactive Profile reads no Campaigns despite live-looking claims');
reset role;

select * from finish();
rollback;
