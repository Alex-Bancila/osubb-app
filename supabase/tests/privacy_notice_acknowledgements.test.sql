-- privacy_notice_acknowledgements.test.sql -- #771 (ruling L16): the Privacy
-- Notice version as an organization setting, the Privacy Acknowledgement
-- table, public.acknowledge_privacy_notice and
-- public.privacy_acknowledgement_status().
--
-- In order: the schema and the seeded version, the grants, the command's
-- step 1 / gate / stale version / success / repeat, the read matrix, the
-- direct-write matrix (own insert only, no update or delete), a version bump
-- through set_org_setting that re-asks the Member while the old row stays,
-- and the status read's shape, rows and gate.
--
-- Mutation guards, each named against the assertion that turns red:
--   * drop the version check in acknowledge_privacy_notice_impl -> "the
--     command refuses a stale version" inserts a 0.9 row instead;
--   * drop the notice_version condition from the insert policy -> "a direct
--     insert of a stale version is refused" succeeds;
--   * drop the auth_level() >= 6 limb of the read policy -> "BC reads every
--     acknowledgement" and "the Moderator reads every acknowledgement" count
--     only their own rows;
--   * drop the live caller_level() half of that limb -> "a deactivated BC's
--     still-valid token reads nothing" returns rows;
--   * grant update or delete back to authenticated -> the direct-write
--     assertions stop throwing;
--   * drop the level check in privacy_acknowledgement_status_impl -> "a BCE
--     (level 5) cannot read the status" returns rows;
--   * drop the privacy_notice_version rule from set_org_setting_impl -> the
--     "cannot be cleared" and "must be dotted numbers" assertions turn into a
--     raw 23514 or a stored value.
-- The claimless sweep over this table lives in rls_deny_by_default.test.sql.
--
-- No pg_temp.test_race: the org_settings row is held `for share` against
-- set_org_setting's `for update`, the same one-row lock org_settings.test.sql
-- leaves unraced because of the host defect in #596.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(74);

-- ==================== Fixtures ====================

insert into auth.users (id, email) values
  ('77100000-0000-0000-0000-000000000001', 'mod771@test.local'),
  ('77100000-0000-0000-0000-000000000002', 'bc771@test.local'),
  ('77100000-0000-0000-0000-000000000003', 'bce771@test.local'),
  ('77100000-0000-0000-0000-000000000004', 'vola771@test.local'),
  ('77100000-0000-0000-0000-000000000005', 'volb771@test.local'),
  ('77100000-0000-0000-0000-000000000006', 'volc771@test.local'),
  ('77100000-0000-0000-0000-000000000007', 'bcstale771@test.local'),
  ('77100000-0000-0000-0000-000000000008', 'claimless771@test.local');

insert into profiles (id, full_name, email, role, status) values
  ('77100000-0000-0000-0000-000000000001', 'Moderator 771',     'mod771@test.local',       'moderator', 'activ'),
  ('77100000-0000-0000-0000-000000000002', 'BC 771',            'bc771@test.local',        'bc',        'activ'),
  ('77100000-0000-0000-0000-000000000003', 'BCE 771',           'bce771@test.local',       'bce',       'activ'),
  ('77100000-0000-0000-0000-000000000004', 'Voluntar A 771',    'vola771@test.local',      'voluntar',  'activ'),
  ('77100000-0000-0000-0000-000000000005', 'Voluntar B 771',    'volb771@test.local',      'voluntar',  'activ'),
  ('77100000-0000-0000-0000-000000000006', 'Voluntar C 771',    'volc771@test.local',      'voluntar',  'activ'),
  -- Deactivated, still holding the level-6 token it was issued (ADR-0003).
  ('77100000-0000-0000-0000-000000000007', 'BC dezactivat 771', 'bcstale771@test.local',   'bc',        'inactiv'),
  ('77100000-0000-0000-0000-000000000008', 'Fără claims 771',   'claimless771@test.local', 'voluntar',  'activ');

create function pg_temp.login_stale_bc() returns void language sql as $$
  select pg_temp.test_login('77100000-0000-0000-0000-000000000007', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6, 'group_ids', '[]'::jsonb));
$$;
create function pg_temp.login_claimless() returns void language sql as $$
  select pg_temp.test_login('77100000-0000-0000-0000-000000000008', '{}'::jsonb);
$$;
create function pg_temp.login(p_n integer) returns void language sql as $$
  select pg_temp.test_login_leadership(('77100000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid);
$$;

-- The deactivated BC acknowledged 1.0 while still active; the row stays, and
-- the status read must still leave them out (only activ Members are listed).
insert into privacy_notice_acknowledgements (member_id, notice_version)
  values ('77100000-0000-0000-0000-000000000007', '1.0');

-- ==================== 1. Schema and the seeded version ====================

select has_table('public', 'privacy_notice_acknowledgements',
  'public.privacy_notice_acknowledgements exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.privacy_notice_acknowledgements'::regclass),
  true,
  'privacy_notice_acknowledgements has RLS enabled (house rule 2)');
select is(
  (select array_agg(policyname || ':' || cmd order by policyname)::text[] from pg_policies
    where schemaname = 'public' and tablename = 'privacy_notice_acknowledgements'),
  array['privacy_notice_acknowledgements_create_self:INSERT',
        'privacy_notice_acknowledgements_read:SELECT'],
  'two policies: own insert and the read -- no update or delete policy exists');
select col_is_pk('public', 'privacy_notice_acknowledgements', array['member_id', 'notice_version'],
  'the primary key is (member_id, notice_version): one acknowledgement per Member and version');
select throws_ok(
  $$ insert into privacy_notice_acknowledgements (member_id, notice_version)
     values ('77100000-0000-0000-0000-000000000004', 'v1') $$,
  '23514',
  'new row for relation "privacy_notice_acknowledgements" violates check constraint "privacy_notice_acknowledgements_notice_version_ck"',
  'privacy_notice_acknowledgements_notice_version_ck: a version is dotted numbers');

select results_eq(
  $$ select value, updated_by from org_settings where key = 'privacy_notice_version' $$,
  $$ values ('1.0'::text, null::uuid) $$,
  'the seeded Privacy Notice version is 1.0, the document''s "Versiunea 1.0", set by no one');
select throws_ok(
  $$ update org_settings set value = null where key = 'privacy_notice_version' $$,
  '23514', 'new row for relation "org_settings" violates check constraint "org_settings_privacy_notice_version_ck"',
  'org_settings_privacy_notice_version_ck: the version is never null, even on a direct write');
select throws_ok(
  $$ update org_settings set value = '1.0-draft' where key = 'privacy_notice_version' $$,
  '23514', 'new row for relation "org_settings" violates check constraint "org_settings_privacy_notice_version_ck"',
  'org_settings_privacy_notice_version_ck: the version is dotted numbers, even on a direct write');

-- ==================== 2. Grants ====================

select is(
  array[has_table_privilege('authenticated', 'public.privacy_notice_acknowledgements', 'select'),
        has_table_privilege('authenticated', 'public.privacy_notice_acknowledgements', 'insert'),
        has_table_privilege('authenticated', 'public.privacy_notice_acknowledgements', 'update'),
        has_table_privilege('authenticated', 'public.privacy_notice_acknowledgements', 'delete'),
        has_table_privilege('authenticated', 'public.privacy_notice_acknowledgements', 'truncate')],
  array[true, false, false, false, false],
  'authenticated selects the table; no table-wide insert, and no update, delete or truncate');
select is(
  array[has_column_privilege('authenticated', 'public.privacy_notice_acknowledgements', 'member_id', 'insert'),
        has_column_privilege('authenticated', 'public.privacy_notice_acknowledgements', 'notice_version', 'insert'),
        has_column_privilege('authenticated', 'public.privacy_notice_acknowledgements', 'acknowledged_at', 'insert')],
  array[true, true, false],
  'authenticated inserts member_id and notice_version only -- acknowledged_at is always the database''s');
select is(
  array[has_table_privilege('anon', 'public.privacy_notice_acknowledgements', 'select'),
        has_any_column_privilege('anon', 'public.privacy_notice_acknowledgements', 'insert')],
  array[false, false],
  'anon holds no privilege on privacy_notice_acknowledgements');
select is(
  array[has_function_privilege('authenticated', 'public.acknowledge_privacy_notice(text)', 'execute'),
        has_function_privilege('anon', 'public.acknowledge_privacy_notice(text)', 'execute'),
        has_function_privilege('service_role', 'public.acknowledge_privacy_notice(text)', 'execute'),
        has_function_privilege('public', 'public.acknowledge_privacy_notice(text)', 'execute'),
        has_function_privilege('authenticated', 'private.acknowledge_privacy_notice_impl(text)', 'execute'),
        has_function_privilege('anon', 'private.acknowledge_privacy_notice_impl(text)', 'execute'),
        has_function_privilege('service_role', 'private.acknowledge_privacy_notice_impl(text)', 'execute'),
        has_function_privilege('public', 'private.acknowledge_privacy_notice_impl(text)', 'execute')],
  array[true, false, false, false, true, false, false, false],
  'acknowledge_privacy_notice and its _impl: execute for authenticated only (conventions section 4)');
select is(
  array[has_function_privilege('authenticated', 'public.privacy_acknowledgement_status()', 'execute'),
        has_function_privilege('anon', 'public.privacy_acknowledgement_status()', 'execute'),
        has_function_privilege('service_role', 'public.privacy_acknowledgement_status()', 'execute'),
        has_function_privilege('public', 'public.privacy_acknowledgement_status()', 'execute'),
        has_function_privilege('authenticated', 'private.privacy_acknowledgement_status_impl()', 'execute'),
        has_function_privilege('anon', 'private.privacy_acknowledgement_status_impl()', 'execute'),
        has_function_privilege('service_role', 'private.privacy_acknowledgement_status_impl()', 'execute'),
        has_function_privilege('public', 'private.privacy_acknowledgement_status_impl()', 'execute')],
  array[true, false, false, false, true, false, false, false],
  'privacy_acknowledgement_status and its _impl: execute for authenticated only');
select is(
  (select array[w.prosecdef, i.prosecdef, sw.prosecdef, si.prosecdef]
     from pg_proc w, pg_proc i, pg_proc sw, pg_proc si
    where w.oid = 'public.acknowledge_privacy_notice(text)'::regprocedure
      and i.oid = 'private.acknowledge_privacy_notice_impl(text)'::regprocedure
      and sw.oid = 'public.privacy_acknowledgement_status()'::regprocedure
      and si.oid = 'private.privacy_acknowledgement_status_impl()'::regprocedure),
  array[false, true, false, true],
  'both wrappers are security invoker and both bodies security definer (conventions section 2)');

-- ==================== 3. The command ====================

-- Step 1, malformed for everyone -- the claimless caller included.
select pg_temp.login(4);
select throws_ok($$ select public.acknowledge_privacy_notice('   ') $$,
  'PT400', 'notice_version_required', 'a blank version is notice_version_required');
select throws_ok($$ select public.acknowledge_privacy_notice(null) $$,
  'PT400', 'notice_version_required', 'no version at all is notice_version_required');
reset role;
select pg_temp.login_claimless();
select throws_ok($$ select public.acknowledge_privacy_notice('') $$,
  'PT400', 'notice_version_required',
  'a claimless caller sending a blank version is answered at step 1, before the gate');

-- The gate.
select throws_ok($$ select public.acknowledge_privacy_notice('1.0') $$,
  '42501', 'privacy_acknowledgement_forbidden', 'a claimless session acknowledges nothing');
reset role;
select pg_temp.login_stale_bc();
select throws_ok($$ select public.acknowledge_privacy_notice('1.0') $$,
  '42501', 'privacy_acknowledgement_forbidden',
  'a deactivated Member holding a still-valid token acknowledges nothing');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select public.acknowledge_privacy_notice('1.0') $$,
  '42501', null, 'anon cannot even execute the command');
reset role;

-- The version.
select pg_temp.login(4);
select throws_ok($$ select public.acknowledge_privacy_notice('0.9') $$,
  'PT409', 'privacy_notice_version_stale',
  'the command refuses a stale version -- only the current Privacy Notice version is acknowledged');
select throws_ok($$ select public.acknowledge_privacy_notice('2.0') $$,
  'PT409', 'privacy_notice_version_stale',
  'the command refuses a version newer than the current one as well');
reset role;
select is(
  (select count(*) from privacy_notice_acknowledgements
    where member_id = '77100000-0000-0000-0000-000000000004'),
  0::bigint,
  'after every refusal Voluntar A has no acknowledgement');

-- Success.
select pg_temp.login(4);
create temp table ack_a as select * from public.acknowledge_privacy_notice(' 1.0 ');
select results_eq(
  $$ select member_id, notice_version from ack_a $$,
  $$ values ('77100000-0000-0000-0000-000000000004'::uuid, '1.0'::text) $$,
  'Voluntar A acknowledges 1.0 (sent padded, stored trimmed) -- the row names the caller, never a parameter');
select ok((select acknowledged_at is not null and acknowledged_at <= now() from ack_a),
  'the returned row carries the database''s acknowledgement time');
select throws_ok($$ select public.acknowledge_privacy_notice('1.0') $$,
  'PT409', 'privacy_notice_already_acknowledged',
  'acknowledging the same version again is privacy_notice_already_acknowledged');
reset role;

select pg_temp.login(5);
select is((select notice_version from public.acknowledge_privacy_notice('1.0')), '1.0',
  'Voluntar B acknowledges 1.0');
reset role;
select pg_temp.login(2);
select is((select member_id from public.acknowledge_privacy_notice('1.0')),
  '77100000-0000-0000-0000-000000000002'::uuid,
  'BC acknowledges 1.0 like every Member');
reset role;

select results_eq(
  $$ select full_name, role::text, status::text from profiles
      where id = '77100000-0000-0000-0000-000000000004' $$,
  $$ values ('Voluntar A 771'::text, 'voluntar'::text, 'activ'::text) $$,
  'an acknowledgement changes nothing about the Member (it is not a consent)');

-- ==================== 4. Reading ====================

select pg_temp.login(4);
select results_eq(
  $$ select member_id, notice_version from privacy_notice_acknowledgements $$,
  $$ values ('77100000-0000-0000-0000-000000000004'::uuid, '1.0'::text) $$,
  'an ordinary Member reads their own acknowledgement and nobody else''s');
reset role;
select pg_temp.login(6);
select is((select count(*) from privacy_notice_acknowledgements), 0::bigint,
  'a Member who acknowledged nothing reads nothing');
reset role;
select pg_temp.login(3);
select is((select count(*) from privacy_notice_acknowledgements), 0::bigint,
  'a BCE (level 5) reads only their own acknowledgements -- none here');
reset role;
select pg_temp.login(2);
select is(
  (select count(*) from privacy_notice_acknowledgements where member_id::text like '77100000-%'),
  4::bigint,
  'BC reads every acknowledgement');
reset role;
select pg_temp.login(1);
select is(
  (select count(*) from privacy_notice_acknowledgements where member_id::text like '77100000-%'),
  4::bigint,
  'the Moderator reads every acknowledgement');
reset role;
select pg_temp.login_stale_bc();
select is((select count(*) from privacy_notice_acknowledgements), 0::bigint,
  'a deactivated BC''s still-valid token reads nothing, not even their own row (live caller_level, not the claims)');
reset role;
select pg_temp.login_claimless();
select is((select count(*) from privacy_notice_acknowledgements), 0::bigint,
  'a claimless session reads nothing (house rule 12)');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select count(*) from privacy_notice_acknowledgements $$, '42501', null,
  'anon cannot read the table at all');
reset role;

-- ==================== 5. Direct writes ====================

select pg_temp.login(6);
select lives_ok(
  $$ insert into privacy_notice_acknowledgements (member_id, notice_version)
     values ('77100000-0000-0000-0000-000000000006', '1.0') $$,
  'a Member inserts their own acknowledgement of the current version directly (the own-insert policy)');
select throws_ok(
  $$ insert into privacy_notice_acknowledgements (member_id, notice_version)
     values ('77100000-0000-0000-0000-000000000003', '1.0') $$,
  '42501', 'new row violates row-level security policy for table "privacy_notice_acknowledgements"',
  'a Member cannot insert an acknowledgement for someone else');
reset role;
select pg_temp.login(3);
select throws_ok(
  $$ insert into privacy_notice_acknowledgements (member_id, notice_version)
     values ('77100000-0000-0000-0000-000000000003', '0.9') $$,
  '42501', 'new row violates row-level security policy for table "privacy_notice_acknowledgements"',
  'a direct insert of a stale version is refused by the policy');
select throws_ok(
  $$ insert into privacy_notice_acknowledgements (member_id, notice_version, acknowledged_at)
     values ('77100000-0000-0000-0000-000000000003', '1.0', '2020-01-01') $$,
  '42501', 'permission denied for table privacy_notice_acknowledgements',
  'a direct insert cannot choose its acknowledgement time');
reset role;
select pg_temp.login(4);
select throws_ok(
  $$ update privacy_notice_acknowledgements set acknowledged_at = '2020-01-01' $$,
  '42501', 'permission denied for table privacy_notice_acknowledgements',
  'a Member cannot edit their acknowledgement');
select throws_ok(
  $$ delete from privacy_notice_acknowledgements $$,
  '42501', 'permission denied for table privacy_notice_acknowledgements',
  'a Member cannot withdraw their acknowledgement');
reset role;
select pg_temp.login(2);
select throws_ok(
  $$ update privacy_notice_acknowledgements set notice_version = '1.1' $$,
  '42501', 'permission denied for table privacy_notice_acknowledgements',
  'not even BC edits an acknowledgement');
select throws_ok(
  $$ delete from privacy_notice_acknowledgements $$,
  '42501', 'permission denied for table privacy_notice_acknowledgements',
  'not even BC deletes an acknowledgement');
reset role;
select pg_temp.login(1);
select throws_ok(
  $$ delete from privacy_notice_acknowledgements $$,
  '42501', 'permission denied for table privacy_notice_acknowledgements',
  'not even the Moderator deletes an acknowledgement');
reset role;
select pg_temp.login_claimless();
select throws_ok(
  $$ insert into privacy_notice_acknowledgements (member_id, notice_version)
     values ('77100000-0000-0000-0000-000000000008', '1.0') $$,
  '42501', 'new row violates row-level security policy for table "privacy_notice_acknowledgements"',
  'a claimless session cannot insert even its own acknowledgement');
reset role;
select pg_temp.login_stale_bc();
select throws_ok(
  $$ insert into privacy_notice_acknowledgements (member_id, notice_version)
     values ('77100000-0000-0000-0000-000000000007', '1.1') $$,
  '42501', 'new row violates row-level security policy for table "privacy_notice_acknowledgements"',
  'a deactivated Member''s still-valid token cannot insert directly either');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(
  $$ insert into privacy_notice_acknowledgements (member_id, notice_version)
     values ('77100000-0000-0000-0000-000000000004', '1.0') $$,
  '42501', null, 'anon cannot insert');
reset role;

select results_eq(
  $$ select member_id, notice_version from privacy_notice_acknowledgements
      where member_id::text like '77100000-%' order by member_id, notice_version $$,
  $$ values ('77100000-0000-0000-0000-000000000002'::uuid, '1.0'::text),
            ('77100000-0000-0000-0000-000000000004'::uuid, '1.0'::text),
            ('77100000-0000-0000-0000-000000000005'::uuid, '1.0'::text),
            ('77100000-0000-0000-0000-000000000006'::uuid, '1.0'::text),
            ('77100000-0000-0000-0000-000000000007'::uuid, '1.0'::text) $$,
  'after the direct-write matrix: the three the command wrote, the deactivated Member''s older row and the one direct insert -- nothing else');

-- ==================== 6. A new version re-asks everyone ====================

-- set_org_setting's step 1 for the new key, answered to every caller.
select pg_temp.login(4);
select throws_ok($$ select public.set_org_setting('privacy_notice_version', '1.1-rc') $$,
  'PT400', 'invalid_org_setting_value',
  'an ordinary Member sending a malformed version is answered invalid_org_setting_value before the gate');
select throws_ok($$ select public.set_org_setting('privacy_notice_version', '1.1') $$,
  '42501', 'org_settings_manage_forbidden', 'an ordinary Member cannot bump the version');
reset role;
select pg_temp.login(3);
select throws_ok($$ select public.set_org_setting('privacy_notice_version', '1.1') $$,
  '42501', 'org_settings_manage_forbidden', 'a BCE cannot bump the version');
reset role;
select pg_temp.login(2);
select throws_ok($$ select public.set_org_setting('privacy_notice_version', '') $$,
  'PT400', 'invalid_org_setting_value', 'BC: the version cannot be cleared with a blank value');
select throws_ok($$ select public.set_org_setting('privacy_notice_version', null) $$,
  'PT400', 'invalid_org_setting_value', 'BC: the version cannot be cleared with null');
select throws_ok($$ select public.set_org_setting('privacy_notice_version', 'v2') $$,
  'PT400', 'invalid_org_setting_value', 'BC: the version must be dotted numbers');
select throws_ok($$ select public.set_org_setting('privacy_notice_version', '1.0') $$,
  'PT409', 'nothing_to_update', 'BC: re-sending the current version is nothing_to_update');
select results_eq(
  $$ select value, updated_by from public.set_org_setting('privacy_notice_version', ' 1.1 ') $$,
  $$ values ('1.1'::text, '77100000-0000-0000-0000-000000000002'::uuid) $$,
  'BC bumps the Privacy Notice version to 1.1 through set_org_setting, trimmed and audited');
reset role;
select pg_temp.login(4);
select is((select value from org_settings where key = 'privacy_notice_version'), '1.1',
  'every Member reads the new current version');
select throws_ok($$ select public.acknowledge_privacy_notice('1.0') $$,
  'PT409', 'privacy_notice_version_stale',
  'after the bump, acknowledging 1.0 is stale');
select is((select notice_version from public.acknowledge_privacy_notice('1.1')), '1.1',
  'Voluntar A is asked again and acknowledges 1.1');
select results_eq(
  $$ select notice_version from privacy_notice_acknowledgements order by notice_version $$,
  $$ values ('1.0'::text), ('1.1'::text) $$,
  'the 1.0 acknowledgement stays beside the 1.1 one');
reset role;
select pg_temp.login(6);
select throws_ok(
  $$ insert into privacy_notice_acknowledgements (member_id, notice_version)
     values ('77100000-0000-0000-0000-000000000006', '1.0') $$,
  '42501', 'new row violates row-level security policy for table "privacy_notice_acknowledgements"',
  'after the bump, the policy refuses a direct insert of 1.0 as well');
reset role;

-- ==================== 7. The status read ====================

select is(
  pg_get_function_result('public.privacy_acknowledgement_status()'::regprocedure),
  'TABLE(member_id uuid, notice_version text, acknowledged_at timestamp with time zone)',
  'the status read''s shape: member_id, notice_version, acknowledged_at');

select pg_temp.login(2);
create temp table status_bc as select * from public.privacy_acknowledgement_status();
reset role;
select results_eq(
  $$ select member_id, notice_version from status_bc
      where member_id::text like '77100000-%' order by member_id $$,
  $$ values ('77100000-0000-0000-0000-000000000001'::uuid, null::text),
            ('77100000-0000-0000-0000-000000000002'::uuid, '1.0'::text),
            ('77100000-0000-0000-0000-000000000003'::uuid, null::text),
            ('77100000-0000-0000-0000-000000000004'::uuid, '1.1'::text),
            ('77100000-0000-0000-0000-000000000005'::uuid, '1.0'::text),
            ('77100000-0000-0000-0000-000000000006'::uuid, '1.0'::text),
            ('77100000-0000-0000-0000-000000000008'::uuid, null::text) $$,
  'BC reads every active Member with their latest acknowledged version -- null when none, and the deactivated Member left out');
select is(
  (select count(*) from status_bc),
  (select count(*) from profiles where status = 'activ'),
  'one row for every active Member in the database, and no other');
select is(
  (select count(*) from status_bc
    where (notice_version is null) is distinct from (acknowledged_at is null)),
  0::bigint,
  'the version and its time are null together');
select is(
  (select acknowledged_at from status_bc where member_id = '77100000-0000-0000-0000-000000000004'),
  (select max(acknowledged_at) from privacy_notice_acknowledgements
    where member_id = '77100000-0000-0000-0000-000000000004'),
  'Voluntar A''s row carries the time of the latest acknowledgement');

select pg_temp.login(1);
select is(
  (select count(*) from public.privacy_acknowledgement_status()),
  (select count(*) from status_bc),
  'the Moderator reads the same status');
reset role;
select pg_temp.login(3);
select throws_ok($$ select * from public.privacy_acknowledgement_status() $$,
  '42501', 'privacy_acknowledgements_forbidden', 'a BCE (level 5) cannot read the status');
reset role;
select pg_temp.login(4);
select throws_ok($$ select * from public.privacy_acknowledgement_status() $$,
  '42501', 'privacy_acknowledgements_forbidden', 'an ordinary Member cannot read the status');
reset role;
select pg_temp.login_stale_bc();
select throws_ok($$ select * from public.privacy_acknowledgement_status() $$,
  '42501', 'privacy_acknowledgements_forbidden',
  'a deactivated BC holding a still-valid level-6 token cannot read the status');
reset role;
select pg_temp.login_claimless();
select throws_ok($$ select * from public.privacy_acknowledgement_status() $$,
  '42501', 'privacy_acknowledgements_forbidden', 'a claimless session cannot read the status');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select * from public.privacy_acknowledgement_status() $$,
  '42501', null, 'anon cannot even execute the status read');
reset role;

select * from finish();
rollback;
