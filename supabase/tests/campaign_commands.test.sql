-- #343: create_campaign, update_campaign, set_campaign_active — the local
-- BCE of a Campaign's own Department (plus BC/Moderator globally) manage it
-- through narrow, actor-derived commands (ADR-0007 Sec Campaigns). All three
-- share private.require_campaign_manager, itself built on #321's
-- private.can_manage_origin Department branch.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(63);

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
select has_function('public', 'create_campaign', array['text', 'text'],
  'create_campaign(text, text) exists');
select has_function('public', 'update_campaign', array['bigint', 'text'],
  'update_campaign(bigint, text) exists');
select has_function('public', 'set_campaign_active', array['bigint', 'boolean'],
  'set_campaign_active(bigint, boolean) exists');
select is(pg_get_function_identity_arguments('public.create_campaign(text,text)'::regprocedure),
  'p_department_id text, p_name text', 'create_campaign exposes only department and name');
select is(pg_get_function_identity_arguments('public.update_campaign(bigint,text)'::regprocedure),
  'p_campaign_id bigint, p_name text', 'update_campaign exposes only the Campaign id and name');
select is(pg_get_function_identity_arguments('public.set_campaign_active(bigint,boolean)'::regprocedure),
  'p_campaign_id bigint, p_active boolean', 'set_campaign_active exposes only the Campaign id and flag');
select is(pg_get_function_result('public.create_campaign(text,text)'::regprocedure),
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
), 3::bigint, 'authenticated can execute all three public commands');
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
  'private.require_campaign_manager(text)'::regprocedure, 'execute'),
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
select * from public.create_campaign('edu', 'Alpha Campaign');
reset role;
select is((select department_id from alpha_campaign), 'edu',
  'the local EDU BCE creates a Campaign in their own department');
select is((select name from alpha_campaign), 'Alpha Campaign', 'the stored name matches');
select is((select is_active from alpha_campaign), true, 'a new Campaign defaults to active');
select is((select created_by from alpha_campaign), '34300000-0000-0000-0000-000000000001'::uuid,
  'created_by is the caller');

select pg_temp.test_login('34300000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["fin"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.create_campaign('edu', 'Should Fail')$$,
  '42501', 'campaign_manage_forbidden', 'a BCE of a different department is denied');
create temp table fin_campaign as
select * from public.create_campaign('fin', 'FIN Campaign');
reset role;
select is((select name from fin_campaign), 'FIN Campaign',
  'the FIN BCE creates a Campaign in their own department');

select pg_temp.test_login('34300000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table bc_campaign as
select * from public.create_campaign('edu', 'BC Campaign');
reset role;
select is((select name from bc_campaign), 'BC Campaign', 'BC creates a Campaign in any department');

select pg_temp.test_login('34300000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'moderator', 'member_level', 9, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table moderator_campaign as
select * from public.create_campaign('fin', 'Moderator Campaign');
reset role;
select is((select name from moderator_campaign), 'Moderator Campaign',
  'Moderator creates a Campaign in any department');

select pg_temp.test_login('34300000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'responsabil', 'member_level', 4, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.create_campaign('edu', 'Nope')$$,
  '42501', 'campaign_manage_forbidden', 'Responsabil is denied');
reset role;

select pg_temp.test_login('34300000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.create_campaign('edu', 'Nope')$$,
  '42501', 'campaign_manage_forbidden', 'Voluntar is denied');
reset role;

select pg_temp.test_login('34300000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.create_campaign('edu', 'Nope')$$,
  '42501', 'campaign_manage_forbidden', 'an inactive EDU BCE is denied despite stale claims');
reset role;

select pg_temp.test_login('34300000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.create_campaign('edu', 'Nope')$$,
  '42501', 'campaign_manage_forbidden',
  'a BCE removed from the department is denied despite stale dept_ids');
reset role;

select pg_temp.test_login('34300000-0000-0000-0000-000000000003',
  jsonb_build_object('provider', 'email'));
select throws_ok($$select public.create_campaign('edu', 'Nope')$$,
  '42501', 'campaign_manage_forbidden', 'a claimless session is denied');
reset role;

set local role anon;
select throws_ok($$select public.create_campaign('edu', 'Nope')$$,
  '42501', null, 'anon cannot execute create_campaign');
reset role;

-- ==================== Department validation ====================
select pg_temp.test_login('34300000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.create_campaign('org', 'Org Campaign')$$,
  'PT400', 'campaign_department_invalid',
  'the org pseudo-department cannot own a Campaign, even for BC');
select throws_ok($$select public.create_campaign('does-not-exist-343', 'X')$$,
  'PT404', 'department_not_found', 'an unknown department is rejected, even for BC');
create temp table diverse_campaign as
select * from public.create_campaign('diverse', 'Diverse Campaign');
reset role;
select is((select department_id from diverse_campaign), 'diverse',
  'a coordination department (kind <> org) may own a Campaign');

-- ==================== Name validation ====================
select pg_temp.test_login('34300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.create_campaign('edu', '   ')$$,
  'PT400', 'invalid_campaign_name', 'a blank name is rejected');
select throws_ok($$select public.create_campaign('edu', null)$$,
  'PT400', 'invalid_campaign_name', 'a null name is rejected');
reset role;

-- ==================== Uniqueness ====================
select pg_temp.test_login('34300000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.create_campaign('edu', 'Alpha Campaign')$$,
  'PT409', 'campaign_name_taken', 'a duplicate name in the same department is rejected');
select throws_ok($$select public.create_campaign('edu', 'ALPHA CAMPAIGN')$$,
  'PT409', 'campaign_name_taken',
  'a case-variant duplicate is rejected (the unique index is on lower(name))');
reset role;
select pg_temp.test_login('34300000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["fin"]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table fin_alpha_campaign as
select * from public.create_campaign('fin', 'Alpha Campaign');
reset role;
select is((select name from fin_alpha_campaign), 'Alpha Campaign',
  'the same name in a different department is allowed');

-- ==================== update_campaign ====================
create temp table cids as
select
  (select id from public.campaigns where department_id = 'edu' and name = 'Alpha Campaign') as alpha_id,
  (select id from public.campaigns where department_id = 'edu' and name = 'BC Campaign') as bc_id,
  9223372036854775807::bigint as missing_id;
grant select on cids to authenticated;

select pg_temp.test_login('34300000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.update_campaign(
  (select missing_id from cids), 'X')$$,
  'PT404', 'campaign_not_found',
  'an unknown Campaign is rejected before authorization narrows to a department');
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
reset role;

select pg_temp.test_login('34300000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$select public.set_campaign_active(
  (select missing_id from cids), true)$$,
  'PT404', 'campaign_not_found', 'set_campaign_active on an unknown Campaign is rejected');
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
select throws_ok($$insert into public.campaigns (department_id, name, created_by)
  values ('edu', 'Direct Insert', '34300000-0000-0000-0000-000000000001')$$,
  '42501', null, 'authenticated cannot bypass create_campaign with a direct INSERT');
select throws_ok($$update public.campaigns set name = 'Hack'
  where id = (select alpha_id from cids)$$,
  '42501', null, 'authenticated cannot bypass update_campaign with a direct UPDATE');
select throws_ok($$delete from public.campaigns
  where id = (select alpha_id from cids)$$,
  '42501', null, 'authenticated cannot bypass the command boundary with a direct DELETE');
reset role;

-- ==================== Real concurrent duplicate create ====================
-- Fixtures are committed through a second connection because dblink sessions
-- cannot see rows inside this pgTAP transaction (supabase/tests/README.md).
select extensions.dblink_connect('campaign_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('campaign_setup', $$
  delete from public.campaigns where department_id = 'edu' and name = 'Concurrent Campaign #343';
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
    $$ select (public.create_campaign('edu', 'Concurrent Campaign #343')).name $$,
    $$ select (public.create_campaign('edu', 'Concurrent Campaign #343')).name $$
  )
$outer$, 'PT409', 'campaign_name_taken',
  'exactly one concurrent create succeeds; the other reports campaign_name_taken, not a raw unique_violation');

select is((select campaign_count from extensions.dblink('campaign_setup', $$
  select count(*) from public.campaigns
   where department_id = 'edu' and name = 'Concurrent Campaign #343'
$$) as result(campaign_count bigint)), 1::bigint,
  'concurrent duplicate creates commit exactly one Campaign');

select extensions.dblink_exec('campaign_setup', $$
  delete from public.campaigns where department_id = 'edu' and name = 'Concurrent Campaign #343';
  delete from public.member_departments where member_id = '34300000-0000-0000-0000-000000000020';
  delete from auth.users where id = '34300000-0000-0000-0000-000000000020';
$$);
select extensions.dblink_disconnect('campaign_setup');

select * from finish();
rollback;
