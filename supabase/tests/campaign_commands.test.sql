-- #343: create_campaign, update_campaign, set_campaign_active — the local
-- BCE of a Campaign's own Department (plus BC/Moderator globally) manage it
-- through narrow, actor-derived commands (ADR-0007 Sec Campaigns). All three
-- share private.require_campaign_manager, itself built on the Group authority
-- kit (private.require_group_work_manager). #579 retired the legacy
-- create_campaign(text, text) overload: a Campaign names its Group by id.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(84);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('34300000-0000-0000-0000-000000000001', 'edu.bce.campaign@test.local'),
  ('34300000-0000-0000-0000-000000000002', 'fin.bce.campaign@test.local'),
  ('34300000-0000-0000-0000-000000000003', 'bc.campaign@test.local'),
  ('34300000-0000-0000-0000-000000000004', 'moderator.campaign@test.local'),
  ('34300000-0000-0000-0000-000000000005', 'responsabil.campaign@test.local'),
  ('34300000-0000-0000-0000-000000000006', 'voluntar.campaign@test.local'),
  ('34300000-0000-0000-0000-000000000007', 'inactive.edu.bce.campaign@test.local'),
  ('34300000-0000-0000-0000-000000000008', 'removed.edu.bce.campaign@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('34300000-0000-0000-0000-000000000001', 'EDU BCE Campaign', 'edu.bce.campaign@test.local', 'bce', 'activ'),
  ('34300000-0000-0000-0000-000000000002', 'FIN BCE Campaign', 'fin.bce.campaign@test.local', 'bce', 'activ'),
  ('34300000-0000-0000-0000-000000000003', 'BC Campaign', 'bc.campaign@test.local', 'bc', 'activ'),
  ('34300000-0000-0000-0000-000000000004', 'Moderator Campaign', 'moderator.campaign@test.local', 'moderator', 'activ'),
  ('34300000-0000-0000-0000-000000000005', 'Responsabil Campaign', 'responsabil.campaign@test.local', 'responsabil', 'activ'),
  ('34300000-0000-0000-0000-000000000006', 'Voluntar Campaign', 'voluntar.campaign@test.local', 'voluntar', 'activ'),
  ('34300000-0000-0000-0000-000000000007', 'Inactive EDU BCE Campaign', 'inactive.edu.bce.campaign@test.local', 'bce', 'inactiv'),
  ('34300000-0000-0000-0000-000000000008', 'Removed EDU BCE Campaign', 'removed.edu.bce.campaign@test.local', 'bce', 'activ');

-- 0007 keeps a real Department row (its stale JWT and live status disagree).
-- 0008 deliberately gets none (its stale JWT and live membership disagree).
insert into public.member_departments (member_id, dept_id) values
  ('34300000-0000-0000-0000-000000000001', 'edu'),
  ('34300000-0000-0000-0000-000000000002', 'fin'),
  ('34300000-0000-0000-0000-000000000007', 'edu');

-- ==================== API shape and privileges ====================
select has_function('public', 'create_campaign', array['bigint', 'text'],
  'create_campaign(bigint, text) exists');
select has_function('public', 'update_campaign', array['bigint', 'text'],
  'update_campaign(bigint, text) exists');
select has_function('public', 'set_campaign_active', array['bigint', 'boolean'],
  'set_campaign_active(bigint, boolean) exists');
select is(pg_get_function_identity_arguments('public.create_campaign(bigint,text)'::regprocedure),
  'p_group_id bigint, p_name text', 'create_campaign exposes only the Group and name');
select is(pg_get_function_identity_arguments('public.update_campaign(bigint,text)'::regprocedure),
  'p_campaign_id bigint, p_name text', 'update_campaign exposes only the Campaign id and name');
select is(pg_get_function_identity_arguments('public.set_campaign_active(bigint,boolean)'::regprocedure),
  'p_campaign_id bigint, p_active boolean', 'set_campaign_active exposes only the Campaign id and flag');
select is(pg_get_function_result('public.create_campaign(bigint,text)'::regprocedure),
  'campaigns', 'create_campaign returns the created Campaign');
select is(pg_get_function_result('public.update_campaign(bigint,text)'::regprocedure),
  'campaigns', 'update_campaign returns the updated Campaign');
select is(pg_get_function_result('public.set_campaign_active(bigint,boolean)'::regprocedure),
  'campaigns', 'set_campaign_active returns the updated Campaign');
select ok(coalesce((
  select bool_and(not procedure.prosecdef)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname in ('create_campaign', 'update_campaign', 'set_campaign_active')
), false), 'the three public commands are security invoker wrappers');
select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private'
     and procedure.proname in ('require_campaign_manager', 'create_campaign_impl',
       'update_campaign_impl', 'set_campaign_active_impl')
     and procedure.prosecdef
), 4::bigint, 'the authorization helper and the three implementations run as owner');
select ok(coalesce((
  select bool_and('search_path=""' = any(procedure.proconfig))
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname in ('public', 'private')
     and procedure.proname in ('create_campaign', 'update_campaign', 'set_campaign_active',
       'require_campaign_manager', 'create_campaign_impl', 'update_campaign_impl',
       'set_campaign_active_impl')
), false), 'every command function has an empty search_path');
select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname in ('create_campaign', 'update_campaign', 'set_campaign_active')
     and has_function_privilege('authenticated', procedure.oid, 'execute')
), 3::bigint, 'authenticated can execute the three Campaign commands (#579 dropped the legacy create_campaign(text, text) overload)');
select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname in ('create_campaign', 'update_campaign', 'set_campaign_active')
     and has_function_privilege('anon', procedure.oid, 'execute')
), 0::bigint, 'anon cannot execute any public command');
select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private'
     and procedure.proname in ('create_campaign_impl', 'update_campaign_impl', 'set_campaign_active_impl')
     and has_function_privilege('authenticated', procedure.oid, 'execute')
), 3::bigint, 'authenticated can execute the three private implementations');
select ok(not has_function_privilege('authenticated',
  'private.require_campaign_manager(bigint)'::regprocedure, 'execute'),
  'authenticated cannot execute require_campaign_manager directly');
select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private'
     and procedure.proname in ('require_campaign_manager', 'create_campaign_impl',
       'update_campaign_impl', 'set_campaign_active_impl')
     and has_function_privilege('anon', procedure.oid, 'execute')
), 0::bigint, 'anon cannot execute any private function');
select ok(not has_table_privilege('authenticated', 'public.campaigns', 'insert'),
  'authenticated has no direct campaigns INSERT');
select ok(not has_table_privilege('authenticated', 'public.campaigns', 'update'),
  'authenticated has no direct campaigns UPDATE');
select ok(not has_table_privilege('authenticated', 'public.campaigns', 'delete'),
  'authenticated has no direct campaigns DELETE');

-- ==================== Persona matrix: create_campaign ====================
select pg_temp.test_login('34300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table alpha_campaign as
select * from public.create_campaign(pg_temp.dept_group('edu'), 'Alpha Campaign');
reset role;
select is((select group_id from alpha_campaign), pg_temp.dept_group('edu'),
  'the local EDU BCE creates a Campaign in their own department');
select is((select name from alpha_campaign), 'Alpha Campaign', 'the stored name matches');
select is((select is_active from alpha_campaign), true, 'a new Campaign defaults to active');
select is((select created_by from alpha_campaign), '34300000-0000-0000-0000-000000000001'::uuid,
  'created_by is the caller');

select pg_temp.test_login('34300000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["fin"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.create_campaign(pg_temp.dept_group('edu'), 'Should Fail')$$,
  '42501', 'campaign_manage_forbidden', 'a BCE of a different department is denied');
create temp table fin_campaign as
select * from public.create_campaign(pg_temp.dept_group('fin'), 'FIN Campaign');
reset role;
select is((select name from fin_campaign), 'FIN Campaign',
  'the FIN BCE creates a Campaign in their own department');

select pg_temp.test_login('34300000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table bc_campaign as
select * from public.create_campaign(pg_temp.dept_group('edu'), 'BC Campaign');
reset role;
select is((select name from bc_campaign), 'BC Campaign', 'BC creates a Campaign in any department');

select pg_temp.test_login('34300000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'moderator', 'member_level', 9, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table moderator_campaign as
select * from public.create_campaign(pg_temp.dept_group('fin'), 'Moderator Campaign');
reset role;
select is((select name from moderator_campaign), 'Moderator Campaign',
  'Moderator creates a Campaign in any department');

select pg_temp.test_login('34300000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'responsabil', 'member_level', 4, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.create_campaign(pg_temp.dept_group('edu'), 'Nope')$$,
  '42501', 'campaign_manage_forbidden', 'Responsabil is denied');
reset role;

select pg_temp.test_login('34300000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.create_campaign(pg_temp.dept_group('edu'), 'Nope')$$,
  '42501', 'campaign_manage_forbidden', 'Voluntar is denied');
reset role;

select pg_temp.test_login('34300000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.create_campaign(pg_temp.dept_group('edu'), 'Nope')$$,
  '42501', 'campaign_manage_forbidden', 'an inactive EDU BCE is denied despite stale claims');
reset role;

select pg_temp.test_login('34300000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.create_campaign(pg_temp.dept_group('edu'), 'Nope')$$,
  '42501', 'campaign_manage_forbidden',
  'a BCE removed from the department is denied despite stale dept_ids');
reset role;

select pg_temp.test_login('34300000-0000-0000-0000-000000000003',
  jsonb_build_object('provider', 'email'));
select throws_ok($$select public.create_campaign(pg_temp.dept_group('edu'), 'Nope')$$,
  '42501', 'campaign_manage_forbidden', 'a claimless session is denied');
reset role;

set local role anon;
select throws_ok($$select public.create_campaign(pg_temp.dept_group('edu'), 'Nope')$$,
  '42501', null, 'anon cannot execute create_campaign');
reset role;

-- ==================== Department validation ====================
select pg_temp.test_login('34300000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok($$select public.create_campaign(pg_temp.dept_group('org'), 'Org Campaign')$$,
  'BC creates an Organization Group Campaign');
select throws_ok($$select public.create_campaign(pg_temp.dept_group('does-not-exist-343'), 'X')$$,
  '42501', 'campaign_manage_forbidden', 'a Group that resolves to nothing is nondisclosing, even for BC');
create temp table diverse_campaign as
select * from public.create_campaign(pg_temp.dept_group('diverse'), 'Diverse Campaign');
reset role;
select is((select group_id from diverse_campaign), pg_temp.dept_group('diverse'),
  'a coordination department (kind <> org) may own a Campaign');

-- ==================== Name validation ====================
select pg_temp.test_login('34300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.create_campaign(pg_temp.dept_group('edu'), '   ')$$,
  'PT400', 'invalid_campaign_name', 'a blank name is rejected');
select throws_ok($$select public.create_campaign(pg_temp.dept_group('edu'), null)$$,
  'PT400', 'invalid_campaign_name', 'a null name is rejected');
reset role;

-- ==================== Uniqueness ====================
select pg_temp.test_login('34300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.create_campaign(pg_temp.dept_group('edu'), 'Alpha Campaign')$$,
  'PT409', 'campaign_name_taken', 'a duplicate name in the same department is rejected');
select throws_ok($$select public.create_campaign(pg_temp.dept_group('edu'), 'ALPHA CAMPAIGN')$$,
  'PT409', 'campaign_name_taken',
  'a case-variant duplicate is rejected (the unique index is on lower(name))');
reset role;
select pg_temp.test_login('34300000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["fin"]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table fin_alpha_campaign as
select * from public.create_campaign(pg_temp.dept_group('fin'), 'Alpha Campaign');
reset role;
select is((select name from fin_alpha_campaign), 'Alpha Campaign',
  'the same name in a different department is allowed');

-- ==================== Name trimming (#343 review round 1) ====================
-- regexp_replace, not btrim: btrim only strips plain spaces, so a
-- tab-padded name could otherwise dodge the lower(name) uniqueness check.
select pg_temp.test_login('34300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.create_campaign(pg_temp.dept_group('edu'), E'\tAlpha Campaign')$$,
  'PT409', 'campaign_name_taken',
  'a tab-padded duplicate name is still caught by the lower(name) uniqueness check');
create temp table trimmed_campaign as
select * from public.create_campaign(pg_temp.dept_group('edu'), E'\tTrimmed Campaign\t');
reset role;
select is((select name from trimmed_campaign), 'Trimmed Campaign',
  'a tab-padded name is stored trimmed');

-- ==================== update_campaign ====================
create temp table cids as
select
  (select id from public.campaigns where group_id = pg_temp.dept_group('edu') and name = 'Alpha Campaign') as alpha_id,
  (select id from public.campaigns where group_id = pg_temp.dept_group('edu') and name = 'BC Campaign') as bc_id,
  (select id from public.campaigns where group_id = pg_temp.dept_group('fin') and name = 'FIN Campaign') as fin_id,
  9223372036854775807::bigint as missing_id;
grant select on cids to authenticated;

-- #343 review round 1 (Important 2): the pre-lock gate runs before the
-- Campaign row is even looked up, so an identity that can never manage any
-- Campaign now gets 42501 on an unknown id too (was PT404) -- it never
-- learns whether the id exists. A BCE (who could manage some Campaign) still
-- reaches the lock and gets a real PT404.
select pg_temp.test_login('34300000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.update_campaign(
  (select missing_id from cids), 'X')$$,
  'PT404', 'campaign_not_found',
  'an active member can discover that a Campaign is missing after the membership gate');
reset role;

select pg_temp.test_login('34300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.update_campaign(
  (select missing_id from cids), 'X')$$,
  'PT404', 'campaign_not_found',
  'a BCE passes the pre-lock gate and still gets not-found for an unknown Campaign');
reset role;

select pg_temp.test_login('34300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table alpha_renamed as
select * from public.update_campaign((select alpha_id from cids), 'Alpha Renamed');
reset role;
select is((select name from alpha_renamed), 'Alpha Renamed', 'update_campaign changes the name');
select ok((select updated_at from alpha_renamed) > (select updated_at from alpha_campaign),
  'update_campaign bumps updated_at');

select pg_temp.test_login('34300000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["fin"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.update_campaign(
  (select alpha_id from cids), 'Hacked')$$,
  '42501', 'campaign_manage_forbidden', 'a BCE of a different department cannot update this Campaign');
reset role;

-- #343 review round 1 (Minor 6): persona gaps -- update_campaign only had
-- BCE-of-another-department, claimless and anon covered.
select pg_temp.test_login('34300000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'responsabil', 'member_level', 4, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.update_campaign(
  (select alpha_id from cids), 'Hacked')$$,
  '42501', 'campaign_manage_forbidden', 'Responsabil cannot update a Campaign');
reset role;

select pg_temp.test_login('34300000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.update_campaign(
  (select alpha_id from cids), 'Hacked')$$,
  '42501', 'campaign_manage_forbidden',
  'an inactive EDU BCE cannot update a Campaign despite stale claims');
reset role;

select pg_temp.test_login('34300000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table fin_renamed_by_bc as
select * from public.update_campaign((select fin_id from cids), 'FIN Campaign Renamed By BC');
reset role;
select is((select name from fin_renamed_by_bc), 'FIN Campaign Renamed By BC',
  'BC updates a Campaign in a department that is not their own');

select pg_temp.test_login('34300000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'moderator', 'member_level', 9, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table fin_renamed_by_moderator as
select * from public.update_campaign((select fin_id from cids), 'FIN Campaign Renamed By Moderator');
reset role;
select is((select name from fin_renamed_by_moderator), 'FIN Campaign Renamed By Moderator',
  'Moderator updates a Campaign in a department that is not their own');

select pg_temp.test_login('34300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.update_campaign(
  (select alpha_id from cids), '   ')$$,
  'PT400', 'invalid_campaign_name', 'update rejects a blank name');
select throws_ok($$select public.update_campaign(
  (select alpha_id from cids), 'BC Campaign')$$,
  'PT409', 'campaign_name_taken', 'update rejects a name already used in the same department');
reset role;

select pg_temp.test_login('34300000-0000-0000-0000-000000000003',
  jsonb_build_object('provider', 'email'));
select throws_ok($$select public.update_campaign(
  (select alpha_id from cids), 'X')$$,
  '42501', 'campaign_manage_forbidden', 'a claimless session cannot update a Campaign');
reset role;

set local role anon;
select throws_ok($$select public.update_campaign(
  (select alpha_id from cids), 'X')$$,
  '42501', null, 'anon cannot execute update_campaign');
reset role;

-- ==================== set_campaign_active ====================
-- #343 review round 1 (Minor 4): a null flag is rejected before anything
-- else, including the pre-lock gate -- proved here with an otherwise
-- unauthorized caller, who still gets PT400, not 42501.
select pg_temp.test_login('34300000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.set_campaign_active(
  (select alpha_id from cids), null)$$,
  'PT400', 'invalid_campaign_active',
  'a null active flag is rejected before anything else, even for an unauthorized caller');
reset role;

select pg_temp.test_login('34300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table alpha_deactivated as
select * from public.set_campaign_active((select alpha_id from cids), false);
reset role;
select is((select is_active from alpha_deactivated), false,
  'set_campaign_active deactivates the Campaign');

select pg_temp.test_login('34300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table alpha_reactivated as
select * from public.set_campaign_active((select alpha_id from cids), true);
reset role;
select is((select is_active from alpha_reactivated), true,
  'deactivate then reactivate round-trips');

select pg_temp.test_login('34300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table alpha_noop as
select * from public.set_campaign_active((select alpha_id from cids), true);
reset role;
select is((select is_active from alpha_noop), true,
  'setting the same active value again is a no-op that still returns the row');
select is((select updated_at from alpha_noop), (select updated_at from alpha_reactivated),
  'the idempotent no-op does not bump updated_at');

select pg_temp.test_login('34300000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["fin"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.set_campaign_active(
  (select alpha_id from cids), false)$$,
  '42501', 'campaign_manage_forbidden',
  'a BCE of a different department cannot deactivate this Campaign');

-- #343 review round 1 (Important 1 / Minor 6): the same FIN BCE, but calling
-- with alpha's CURRENT value (true, per alpha_reactivated/alpha_noop above)
-- -- an unauthorized no-op must still be 42501, not a silent success, and
-- this is exactly what the pgrowlocks probe below re-proves under lock.
select throws_ok($$select public.set_campaign_active(
  (select alpha_id from cids), true)$$,
  '42501', 'campaign_manage_forbidden',
  'a BCE of a different department cannot no-op this Campaign''s current active value either');
reset role;

-- #343 review round 1 (Minor 6): persona gaps -- set_campaign_active only
-- had BCE-of-another-department, claimless and anon covered.
select pg_temp.test_login('34300000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'responsabil', 'member_level', 4, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.set_campaign_active(
  (select alpha_id from cids), false)$$,
  '42501', 'campaign_manage_forbidden', 'Responsabil cannot toggle a Campaign');
reset role;

select pg_temp.test_login('34300000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.set_campaign_active(
  (select alpha_id from cids), false)$$,
  '42501', 'campaign_manage_forbidden',
  'an inactive EDU BCE cannot toggle a Campaign despite stale claims');
reset role;

select pg_temp.test_login('34300000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table fin_deactivated_by_bc as
select * from public.set_campaign_active((select fin_id from cids), false);
reset role;
select is((select is_active from fin_deactivated_by_bc), false,
  'BC toggles a Campaign in a department that is not their own');

select pg_temp.test_login('34300000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'moderator', 'member_level', 9, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table fin_reactivated_by_moderator as
select * from public.set_campaign_active((select fin_id from cids), true);
reset role;
select is((select is_active from fin_reactivated_by_moderator), true,
  'Moderator toggles a Campaign in a department that is not their own');

-- #343 review round 1 (Important 2): the pre-lock gate runs before the
-- Campaign row is even looked up, so an identity that can never manage any
-- Campaign now gets 42501 on an unknown id too (was PT404). A BCE still
-- reaches the lock and gets a real PT404.
select pg_temp.test_login('34300000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.set_campaign_active(
  (select missing_id from cids), true)$$,
  'PT404', 'campaign_not_found',
  'an active member can discover that a Campaign is missing after the membership gate');
reset role;

select pg_temp.test_login('34300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.set_campaign_active(
  (select missing_id from cids), true)$$,
  'PT404', 'campaign_not_found',
  'a BCE passes the pre-lock gate and still gets not-found for an unknown Campaign');
reset role;

select pg_temp.test_login('34300000-0000-0000-0000-000000000003',
  jsonb_build_object('provider', 'email'));
select throws_ok($$select public.set_campaign_active(
  (select alpha_id from cids), false)$$,
  '42501', 'campaign_manage_forbidden', 'a claimless session cannot toggle a Campaign');
reset role;

set local role anon;
select throws_ok($$select public.set_campaign_active(
  (select alpha_id from cids), false)$$,
  '42501', null, 'anon cannot execute set_campaign_active');
reset role;

-- ==================== Direct DML stays blocked ====================
select pg_temp.test_login('34300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$insert into public.campaigns (group_id, name, created_by)
  values (pg_temp.dept_group('edu'), 'Direct Insert', '34300000-0000-0000-0000-000000000001')$$,
  '42501', null, 'authenticated cannot bypass create_campaign with a direct INSERT');
select throws_ok($$update public.campaigns set name = 'Hack'
  where id = (select alpha_id from cids)$$,
  '42501', null, 'authenticated cannot bypass update_campaign with a direct UPDATE');
select throws_ok($$delete from public.campaigns
  where id = (select alpha_id from cids)$$,
  '42501', null, 'authenticated cannot bypass the command boundary with a direct DELETE');
reset role;

-- ==================== Prove the locks (#343 review round 1, Important 1) ====================
-- House rule 5: no test failed if the FOR UPDATE / FOR SHARE locks, or the
-- locked re-validation in require_campaign_manager, were removed -- the
-- duplicate-create race below only proves the unique index's own wait. This
-- probe pattern is copied from
-- department_team_membership_concurrency.test.sql and
-- project_membership_commands.test.sql: a BCE runs a no-op
-- set_campaign_active (same value in, same value out) inside an open,
-- uncommitted transaction on a second connection, and pgrowlocks (visible
-- across sessions) shows the Campaign row FOR UPDATE and the actor's
-- profile/member_departments rows FOR SHARE, still held. This also proves
-- authority is checked on a no-op, not skipped because nothing appears to
-- change.
-- Fixtures are committed through a second connection because dblink sessions
-- cannot see rows inside this pgTAP transaction (supabase/tests/README.md;
-- same reasoning as the create_campaign race below) -- a dedicated BCE and
-- Campaign, prefixed ...0021, isolated from the personas fixtured above.
select extensions.dblink_connect('campaign_lock_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('campaign_lock_setup', $$
  delete from public.campaigns where group_id = (select id from public.groups where legacy_dept_id = 'edu') and name = 'Lock Probe Campaign #343';
  delete from public.member_departments where member_id = '34300000-0000-0000-0000-000000000021';
  delete from auth.users where id = '34300000-0000-0000-0000-000000000021';
  insert into auth.users (id, email) values
    ('34300000-0000-0000-0000-000000000021', 'lock.probe.bce.campaign@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('34300000-0000-0000-0000-000000000021', 'Lock Probe BCE Campaign',
     'lock.probe.bce.campaign@test.local', 'bce', 'activ');
  insert into public.member_departments (member_id, dept_id)
  values ('34300000-0000-0000-0000-000000000021', 'edu');
  insert into public.campaigns (group_id, name, is_active, created_by) values
    ((select id from public.groups where legacy_dept_id = 'edu'), 'Lock Probe Campaign #343', true, '34300000-0000-0000-0000-000000000021');
$$);

select extensions.dblink_connect('campaign_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('campaign_lock', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('campaign_lock', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '34300000-0000-0000-0000-000000000021', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'bce', 'member_level', 5,
      'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text, true)
$$) as remote_claims(setting text);
select extensions.dblink_exec('campaign_lock', 'set local role authenticated');
select * from extensions.dblink('campaign_lock', $$
  select (public.set_campaign_active(
    (select id from public.campaigns
      where group_id = (select id from public.groups where legacy_dept_id = 'edu') and name = 'Lock Probe Campaign #343'),
    true
  )).is_active
$$) as no_op_set(is_active boolean);

select ok(coalesce((
  select 'For Update' = any(row_lock.modes)
    from extensions.pgrowlocks('public.campaigns') as row_lock
    join public.campaigns as campaign on campaign.ctid = row_lock.locked_row
   where campaign.group_id = pg_temp.dept_group('edu') and campaign.name = 'Lock Probe Campaign #343'
), false), 'even a no-op set_campaign_active holds the Campaign row FOR UPDATE');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.profiles') as row_lock
    join public.profiles as profile on profile.ctid = row_lock.locked_row
   where profile.id = '34300000-0000-0000-0000-000000000021'
), false), 'a BCE no-op holds their own live profile row FOR SHARE');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.group_members') as row_lock
    join public.group_members as membership on membership.ctid = row_lock.locked_row
   where membership.member_id = '34300000-0000-0000-0000-000000000021'
     and membership.group_id = (select id from public.groups where legacy_dept_id = 'edu')
), false), 'a BCE no-op holds their Group membership row FOR SHARE');

select extensions.dblink_exec('campaign_lock', 'rollback');
select extensions.dblink_disconnect('campaign_lock');

-- Two identical set_campaign_active calls on the same Campaign serialize on
-- the FOR UPDATE lock proved above, the same way as the Team/Project
-- membership races.
select pg_temp.test_login('34300000-0000-0000-0000-000000000021', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table lock_probe_race as
select * from pg_temp.test_race(
  format($$ select (public.set_campaign_active(%L, false)).is_active::text $$,
    (select id from public.campaigns
      where group_id = (select id from public.groups where legacy_dept_id = 'edu') and name = 'Lock Probe Campaign #343')),
  format($$ select (public.set_campaign_active(%L, false)).is_active::text $$,
    (select id from public.campaigns
      where group_id = (select id from public.groups where legacy_dept_id = 'edu') and name = 'Lock Probe Campaign #343'))
);
reset role;
select is((select result_a from lock_probe_race), 'false',
  'the first concurrent deactivate succeeds');
select ok((select b_waited from lock_probe_race),
  'the second identical deactivate waits behind the Campaign row lock');
select is((select result_b from lock_probe_race), 'false',
  'the waiting deactivate reports the already-deactivated Campaign');

select extensions.dblink_exec('campaign_lock_setup', $$
  delete from public.campaigns where group_id = (select id from public.groups where legacy_dept_id = 'edu') and name = 'Lock Probe Campaign #343';
  delete from public.member_departments where member_id = '34300000-0000-0000-0000-000000000021';
  delete from auth.users where id = '34300000-0000-0000-0000-000000000021';
$$);
select extensions.dblink_disconnect('campaign_lock_setup');

-- ==================== Deactivation blocks new Task attachment (#343 AC2 / #314) ====================
-- Acceptance criterion 2 of #343 ("a deactivated campaign can no longer be
-- attached to new tasks") is enforced by #314's tasks_validate_campaign
-- trigger, not by anything in this migration -- this is the one end-to-end
-- assertion tying the command to that trigger.
select pg_temp.test_login('34300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table ac2_campaign as
select * from public.create_campaign(pg_temp.dept_group('edu'), 'AC2 Campaign #343');
select * from public.set_campaign_active((select id from ac2_campaign), false);
reset role;

select throws_ok(
  format($$ insert into public.tasks (title, difficulty, group_id, campaign_id)
            values ('AC2 task 343', 1, pg_temp.dept_group('edu'), %L) $$,
    (select id from ac2_campaign)),
  '23514', 'task_campaign_inactive',
  'a Campaign deactivated via set_campaign_active can no longer be attached to a new Task (#314 trigger)');

-- ==================== Real concurrent duplicate create ====================
-- Fixtures are committed through a second connection because dblink sessions
-- cannot see rows inside this pgTAP transaction (supabase/tests/README.md).
select extensions.dblink_connect('campaign_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('campaign_setup', $$
  delete from public.campaigns where group_id = (select id from public.groups where legacy_dept_id = 'edu') and name = 'Concurrent Campaign #343';
  delete from public.member_departments where member_id = '34300000-0000-0000-0000-000000000020';
  delete from auth.users where id = '34300000-0000-0000-0000-000000000020';
  insert into auth.users (id, email) values
    ('34300000-0000-0000-0000-000000000020', 'concurrent.bce.campaign@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('34300000-0000-0000-0000-000000000020', 'Concurrent BCE Campaign',
     'concurrent.bce.campaign@test.local', 'bce', 'activ');
  insert into public.member_departments (member_id, dept_id)
  values ('34300000-0000-0000-0000-000000000020', 'edu');
$$);

select pg_temp.test_login(
  '34300000-0000-0000-0000-000000000020',
  jsonb_build_object('member_role', 'bce', 'member_level', 5,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
reset role;

select throws_ok($outer$
  select * from pg_temp.test_race(
    $$ select (public.create_campaign((select id from public.groups where legacy_dept_id = 'edu'), 'Concurrent Campaign #343')).name $$,
    $$ select (public.create_campaign((select id from public.groups where legacy_dept_id = 'edu'), 'Concurrent Campaign #343')).name $$
  )
$outer$, 'PT409', 'campaign_name_taken',
  'exactly one concurrent create succeeds; the other reports campaign_name_taken, not a raw unique_violation');

select is((select campaign_count from extensions.dblink('campaign_setup', $$
  select count(*) from public.campaigns
   where group_id = (select id from public.groups where legacy_dept_id = 'edu') and name = 'Concurrent Campaign #343'
$$) as result(campaign_count bigint)), 1::bigint,
  'concurrent duplicate creates commit exactly one Campaign');

select extensions.dblink_exec('campaign_setup', $$
  delete from public.campaigns where group_id = (select id from public.groups where legacy_dept_id = 'edu') and name = 'Concurrent Campaign #343';
  delete from public.member_departments where member_id = '34300000-0000-0000-0000-000000000020';
  delete from auth.users where id = '34300000-0000-0000-0000-000000000020';
$$);
select extensions.dblink_disconnect('campaign_setup');

select * from finish();
rollback;
