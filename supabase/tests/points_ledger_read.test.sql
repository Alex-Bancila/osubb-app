-- points_ledger_read.test.sql — #256: ordinary members read only their rows.
-- Runs in one transaction and rolls back, leaving demo data untouched.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(20);


select ok(
  (select relrowsecurity
     from pg_class
    where oid = 'public.points_ledger'::regclass),
  'points_ledger has RLS enabled'
);
select ok(
  has_table_privilege('authenticated', 'public.points_ledger', 'select'),
  'authenticated has an explicit SELECT grant'
);
select ok(
  not has_table_privilege('anon', 'public.points_ledger', 'select'),
  'anonymous clients have no SELECT grant'
);
select ok(
  not has_table_privilege('authenticated', 'public.points_ledger', 'update')
  and not has_table_privilege('authenticated', 'public.points_ledger', 'delete'),
  'authenticated has no direct UPDATE or DELETE grant'
);

-- Own and cross-member rows are deliberately present for every identity.
-- The two EDU rows also prove a coordinator cannot inherit same-department
-- ledger access through the historical policy branch.
truncate public.profiles cascade;

insert into auth.users (id, email) values
  ('b5600000-0000-0000-0000-000000000000', 'ledger.recrut@test.local'),
  ('b5600000-0000-0000-0000-000000000001', 'ledger.voluntar@test.local'),
  ('b5600000-0000-0000-0000-000000000002', 'ledger.activ@test.local'),
  ('b5600000-0000-0000-0000-000000000003', 'ledger.vot@test.local'),
  ('b5600000-0000-0000-0000-000000000004', 'ledger.responsabil@test.local'),
  ('b5600000-0000-0000-0000-000000000005', 'ledger.bce@test.local'),
  ('b5600000-0000-0000-0000-000000000006', 'ledger.bc@test.local'),
  ('b5600000-0000-0000-0000-000000000009', 'ledger.moderator@test.local'),
  ('b5600000-0000-0000-0000-000000000010', 'ledger.inactive@test.local'),
  ('b5600000-0000-0000-0000-000000000011', 'ledger.no-profile@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('b5600000-0000-0000-0000-000000000000', 'Ledger Recrut', 'ledger.recrut@test.local', 'recrut', 'activ'),
  ('b5600000-0000-0000-0000-000000000001', 'Ledger Voluntar', 'ledger.voluntar@test.local', 'voluntar', 'activ'),
  ('b5600000-0000-0000-0000-000000000002', 'Ledger Activ', 'ledger.activ@test.local', 'activ', 'activ'),
  ('b5600000-0000-0000-0000-000000000003', 'Ledger Vot', 'ledger.vot@test.local', 'vot', 'activ'),
  ('b5600000-0000-0000-0000-000000000004', 'Ledger Responsabil', 'ledger.responsabil@test.local', 'responsabil', 'activ'),
  ('b5600000-0000-0000-0000-000000000005', 'Ledger BCE', 'ledger.bce@test.local', 'bce', 'activ'),
  ('b5600000-0000-0000-0000-000000000006', 'Ledger BC', 'ledger.bc@test.local', 'bc', 'activ'),
  ('b5600000-0000-0000-0000-000000000009', 'Ledger Moderator', 'ledger.moderator@test.local', 'moderator', 'activ'),
  ('b5600000-0000-0000-0000-000000000010', 'Ledger Inactive', 'ledger.inactive@test.local', 'voluntar', 'inactiv');

insert into public.member_departments (member_id, dept_id) values
  ('b5600000-0000-0000-0000-000000000001', 'edu'),
  ('b5600000-0000-0000-0000-000000000004', 'edu'),
  ('b5600000-0000-0000-0000-000000000005', 'edu');

insert into public.points_ledger (member_id, delta, reason) values
  ('b5600000-0000-0000-0000-000000000000', -1, 'sanction'),
  ('b5600000-0000-0000-0000-000000000001', -2, 'sanction'),
  ('b5600000-0000-0000-0000-000000000002', -3, 'sanction'),
  ('b5600000-0000-0000-0000-000000000003', -4, 'sanction'),
  ('b5600000-0000-0000-0000-000000000004', -5, 'sanction'),
  ('b5600000-0000-0000-0000-000000000005', -6, 'sanction'),
  ('b5600000-0000-0000-0000-000000000006', -7, 'sanction'),
  ('b5600000-0000-0000-0000-000000000009', -9, 'sanction'),
  ('b5600000-0000-0000-0000-000000000010', -10, 'sanction');

select pg_temp.test_login('b5600000-0000-0000-0000-000000000000', jsonb_build_object(
    'member_role', 'recrut', 'member_level', 0,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select results_eq(
  $$ select member_id, delta from public.points_ledger order by id $$,
  $$ values ('b5600000-0000-0000-0000-000000000000'::uuid, -1) $$,
  'Recrut reads exactly their own ledger rows'
);
reset role;

select pg_temp.test_login('b5600000-0000-0000-0000-000000000001', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select results_eq(
  $$ select member_id, delta from public.points_ledger order by id $$,
  $$ values ('b5600000-0000-0000-0000-000000000001'::uuid, -2) $$,
  'Voluntar reads exactly their own ledger rows'
);
select is(
  (select count(*) from public.points_ledger
    where member_id = 'b5600000-0000-0000-0000-000000000004'),
  0::bigint,
  'filtering by another member ID cannot bypass RLS'
);
reset role;

select pg_temp.test_login('b5600000-0000-0000-0000-000000000002', jsonb_build_object(
    'member_role', 'activ', 'member_level', 2,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select results_eq(
  $$ select member_id, delta from public.points_ledger order by id $$,
  $$ values ('b5600000-0000-0000-0000-000000000002'::uuid, -3) $$,
  'Membru Activ reads exactly their own ledger rows'
);
reset role;

select pg_temp.test_login('b5600000-0000-0000-0000-000000000003', jsonb_build_object(
    'member_role', 'vot', 'member_level', 3,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select results_eq(
  $$ select member_id, delta from public.points_ledger order by id $$,
  $$ values ('b5600000-0000-0000-0000-000000000003'::uuid, -4) $$,
  'Membru cu Drept de Vot reads exactly their own ledger rows'
);
reset role;

select pg_temp.test_login('b5600000-0000-0000-0000-000000000004', jsonb_build_object(
    'member_role', 'responsabil', 'member_level', 4,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select results_eq(
  $$ select member_id, delta from public.points_ledger order by id $$,
  $$ values ('b5600000-0000-0000-0000-000000000004'::uuid, -5) $$,
  'Responsabil reads only their own row, not same-department rows'
);
reset role;

-- BCE joins BC and Moderator as a global ledger reader in #257.
select pg_temp.test_login('b5600000-0000-0000-0000-000000000005', jsonb_build_object(
    'member_role', 'bce', 'member_level', 5,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(
  (select count(*) from public.points_ledger),
  9::bigint,
  'BCE reads the complete global ledger'
);
reset role;

select pg_temp.test_login('b5600000-0000-0000-0000-000000000006', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(
  (select count(*) from public.points_ledger),
  9::bigint,
  'BC retains global ledger visibility'
);
reset role;

select pg_temp.test_login('b5600000-0000-0000-0000-000000000009', jsonb_build_object(
    'member_role', 'moderator', 'member_level', 9,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(
  (select count(*) from public.points_ledger),
  9::bigint,
  'Moderator retains global ledger visibility'
);
reset role;

-- A real user ID without organization metadata must not inherit own-row access.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'b5600000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'app_metadata', '{}'::jsonb
  )::text,
  true
);
set local role authenticated;
select is(
  (select count(*) from public.points_ledger),
  0::bigint,
  'a claimless real user reads no ledger rows'
);
reset role;

-- Even forged/stale leadership metadata is insufficient without a current
-- profile. Level 6 is deliberate: without the live-profile guard, this
-- identity would satisfy the global BC branch and expose every ledger row.
select pg_temp.test_login('b5600000-0000-0000-0000-000000000011', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(
  (select count(*) from public.points_ledger),
  0::bigint,
  'a no-profile identity with forged BC claims reads no ledger rows'
);
reset role;

-- A stale token may still contain organization claims after deactivation.
select pg_temp.test_login('b5600000-0000-0000-0000-000000000010', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(
  (select count(*) from public.points_ledger),
  0::bigint,
  'an inactive member with stale organization claims reads no ledger rows'
);
reset role;

select pg_temp.test_login('b5600000-0000-0000-0000-000000000000', jsonb_build_object(
    'member_role', 'recrut', 'member_level', 0,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select throws_ok(
  $$ insert into public.points_ledger (member_id, delta, reason)
     values ('b5600000-0000-0000-0000-000000000000', -99, 'sanction') $$,
  '42501',
  null,
  'an ordinary member cannot insert ledger rows'
);
select throws_ok(
  $$ update public.points_ledger set delta = -99
      where member_id = 'b5600000-0000-0000-0000-000000000000' $$,
  '42501',
  null,
  'an ordinary member cannot update ledger rows'
);
select throws_ok(
  $$ delete from public.points_ledger
      where member_id = 'b5600000-0000-0000-0000-000000000000' $$,
  '42501',
  null,
  'an ordinary member cannot delete ledger rows'
);
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(
  $$ select * from public.points_ledger $$,
  '42501',
  null,
  'anonymous clients cannot read the ledger'
);
reset role;

select * from finish();
rollback;
