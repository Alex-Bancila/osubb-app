-- org_settings.test.sql -- #681 (ruling R20): organization settings, the
-- member-readable key-value table and its one BC/Moderator command,
-- public.set_org_setting. Its first key, `adherence_form_url`, left with R66
-- (the address is adherence_message.link_url; adherence_message.test.sql).
-- The keys left: #512's `adunarea_generala_group_id`, whose rules
-- evaluation_rankings_read.test.sql owns; #771's `privacy_notice_version`,
-- whose rules privacy_notice_acknowledgements.test.sql owns; #775's
-- `email_daily_quota`, whose rules email_digest.test.sql owns; #824's
-- `board_group_id`, whose rules board_group_setting.test.sql owns. #48's
-- `vote_retention_percent` left with R58, y moving to
-- evaluation_settings.vot_percent.
--
-- In order: the schema (RLS, the one read policy, the trigger, the named
-- constraints -- Ruling 23), the seed rows, the grants on the table and on
-- both functions, the read matrix, the direct-write matrix, the command's
-- step-1 rules (answered to every caller, claimless included), its gate
-- across personas, and its success path (trim, audit, updated_at, clear,
-- nothing_to_update, the retired key).
--
-- Mutation guards, each named against the assertion that turns red:
--   * drop the level check in set_org_setting_impl -> "a BCE (level 5) sets
--     nothing" succeeds;
--   * drop the email_daily_quota format check -> "'abc' is
--     invalid_org_setting_value" becomes a raw 23514 from
--     org_settings_email_daily_quota_ck, and the ordinary Member's step-1
--     assertion becomes 42501;
--   * add any insert/update/delete policy -> "the only policy is
--     org_settings_read" fails;
--   * grant a write back to authenticated -> the direct-write assertions stop
--     throwing;
--   * remove the seed -> "the seed rows" fails, and so does
--     rls_deny_by_default.test.sql's "every table holds a row" sweep;
--   * drop the live caller_level() half of org_settings_read -> "a
--     deactivated BC's still-valid token reads nothing" returns the rows;
--   * drop the trim -> the stored value keeps its padding;
--   * drop updated_by from the UPDATE -> the audit assertions fail;
--   * restore R66's retired branch or row -> "adherence_form_url is
--     org_setting_not_found" fails.
--
-- No pg_temp.test_race: one row, one `for update`, and the host defect in
-- #596 makes the blocking path unreliable locally.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(64);

-- ==================== Fixtures ====================

insert into auth.users (id, email) values
  ('68100000-0000-0000-0000-000000000001', 'mod681@test.local'),
  ('68100000-0000-0000-0000-000000000002', 'bc681@test.local'),
  ('68100000-0000-0000-0000-000000000003', 'bce681@test.local'),
  ('68100000-0000-0000-0000-000000000004', 'vol681@test.local'),
  ('68100000-0000-0000-0000-000000000005', 'bcstale681@test.local'),
  ('68100000-0000-0000-0000-000000000006', 'claimless681@test.local');

insert into profiles (id, full_name, email, role, status) values
  ('68100000-0000-0000-0000-000000000001', 'Moderator 681',     'mod681@test.local',       'moderator', 'activ'),
  ('68100000-0000-0000-0000-000000000002', 'BC 681',            'bc681@test.local',        'bc',        'activ'),
  ('68100000-0000-0000-0000-000000000003', 'BCE 681',           'bce681@test.local',       'bce',       'activ'),
  ('68100000-0000-0000-0000-000000000004', 'Voluntar 681',      'vol681@test.local',       'voluntar',  'activ'),
  -- Deactivated, still holding the level-6 token it was issued (ADR-0003).
  ('68100000-0000-0000-0000-000000000005', 'BC dezactivat 681', 'bcstale681@test.local',   'bc',        'inactiv'),
  ('68100000-0000-0000-0000-000000000006', 'Fără claims 681',   'claimless681@test.local', 'voluntar',  'activ');

create function pg_temp.login_stale_bc() returns void language sql as $$
  select pg_temp.test_login('68100000-0000-0000-0000-000000000005', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb, 'group_ids', '[]'::jsonb));
$$;

-- The quota row's timestamp, captured before any command moves it.
create temp table seed_681 as
  select updated_at from public.org_settings where key = 'email_daily_quota';
grant select on seed_681 to authenticated;

-- An active root Group for the clear path, and the Adunarea Generală setting
-- emptied by the owner, so the path does not depend on what the demo seed
-- pointed it at.
create temp table group_681 as
  select grp.id from public.groups as grp
   where grp.status = 'active' and grp.parent_id is null
   order by grp.id limit 1;
grant select on group_681 to authenticated;
update public.org_settings set value = null where key = 'adunarea_generala_group_id';

-- ==================== 1. Schema ====================

select has_table('public', 'org_settings', 'public.org_settings exists');
select is((select relrowsecurity from pg_class where oid = 'public.org_settings'::regclass), true,
  'org_settings has RLS enabled (house rule 2)');
select is(
  (select array_agg(policyname || ':' || cmd order by policyname)::text[] from pg_policies
    where schemaname = 'public' and tablename = 'org_settings'),
  array['org_settings_read:SELECT'],
  'the only policy is org_settings_read, for select -- no client write policy exists');
select has_trigger('public', 'org_settings', 'org_settings_set_updated_at',
  'org_settings_set_updated_at maintains updated_at');
select matches(obj_description('public.org_settings'::regclass, 'pg_class'), 'adherence_form_url \(#681\) left it with R66',
  'the table comment says where the adherence form''s address went');
select matches(obj_description('public.set_org_setting(text, text)'::regprocedure, 'pg_proc'), 'adherence_form_url since R66',
  'the command comment names adherence_form_url as unknown since R66');

select throws_ok(
  $$ insert into public.org_settings (key) values ('Bad-Key') $$,
  '23514', 'new row for relation "org_settings" violates check constraint "org_settings_key_ck"',
  'org_settings_key_ck: a key is lower snake_case');
-- A key with no rule of its own, so only the length constraint can answer.
select throws_ok(
  $$ insert into public.org_settings (key, value) values ('length_probe', repeat('a', 2049)) $$,
  '23514', 'new row for relation "org_settings" violates check constraint "org_settings_value_length_ck"',
  'org_settings_value_length_ck: a value over 2048 characters is refused on a direct write');
select lives_ok(
  $$ insert into public.org_settings (key, value) values ('length_probe', repeat('a', 2048)) $$,
  'org_settings_value_length_ck is inclusive: 2048 characters are stored');
delete from public.org_settings where key = 'length_probe';
select is(
  (select count(*) from pg_constraint
    where conrelid = 'public.org_settings'::regclass
      and conname = 'org_settings_adherence_form_url_ck'),
  0::bigint,
  'R66 dropped org_settings_adherence_form_url_ck with its key');

-- ==================== 2. The seed rows ====================

-- #512 seeds adunarea_generala_group_id (emptied above) and #824
-- board_group_id, whose values are whatever the demo seed pointed them at, so
-- only their presence and audit are pinned here. #771 seeds
-- privacy_notice_version, at 1.0, #860 moves it to 1.1, R58 to 1.2 and 1.3
-- and #1183 to 1.4 (privacy_notice_acknowledgements.test.sql owns its rules).
-- #775 seeds email_daily_quota, at 90. R58 deleted #48's
-- vote_retention_percent and R66 #681's adherence_form_url.
select results_eq(
  $$ select key,
            case key when 'privacy_notice_version' then value = '1.4'
                     when 'email_daily_quota' then value = '90'
                     else true end,
            updated_by
       from public.org_settings order by key $$,
  $$ values ('adunarea_generala_group_id'::text, true, null::uuid),
            ('board_group_id'::text, true, null::uuid),
            ('email_daily_quota'::text, true, null::uuid),
            ('privacy_notice_version'::text, true, null::uuid) $$,
  'the seed rows: #512''s adunarea_generala_group_id, #824''s board_group_id, #775''s email_daily_quota at 90 and #771''s privacy_notice_version at 1.4 (#1183), none set through the command -- and no other key (R58 deleted vote_retention_percent, R66 adherence_form_url)');

-- ==================== 3. Grants ====================

select is(
  array[has_table_privilege('authenticated', 'public.org_settings', 'select'),
        has_table_privilege('authenticated', 'public.org_settings', 'insert'),
        has_table_privilege('authenticated', 'public.org_settings', 'update'),
        has_table_privilege('authenticated', 'public.org_settings', 'delete')],
  array[true, false, false, false],
  'authenticated may select org_settings and nothing else');
select is(
  array[has_table_privilege('anon', 'public.org_settings', 'select'),
        has_table_privilege('anon', 'public.org_settings', 'insert'),
        has_table_privilege('anon', 'public.org_settings', 'update'),
        has_table_privilege('anon', 'public.org_settings', 'delete')],
  array[false, false, false, false],
  'anon holds no privilege on org_settings');
select is(
  array[has_function_privilege('authenticated', 'public.set_org_setting(text, text)', 'execute'),
        has_function_privilege('anon', 'public.set_org_setting(text, text)', 'execute'),
        has_function_privilege('service_role', 'public.set_org_setting(text, text)', 'execute'),
        has_function_privilege('public', 'public.set_org_setting(text, text)', 'execute')],
  array[true, false, false, false],
  'public.set_org_setting: execute for authenticated only (conventions section 4)');
select is(
  array[has_function_privilege('authenticated', 'private.set_org_setting_impl(text, text)', 'execute'),
        has_function_privilege('anon', 'private.set_org_setting_impl(text, text)', 'execute'),
        has_function_privilege('service_role', 'private.set_org_setting_impl(text, text)', 'execute'),
        has_function_privilege('public', 'private.set_org_setting_impl(text, text)', 'execute')],
  array[true, false, false, false],
  'private.set_org_setting_impl: execute for authenticated only (conventions section 4)');
select is(
  (select array[w.prosecdef, i.prosecdef]
     from pg_proc w, pg_proc i
    where w.oid = 'public.set_org_setting(text, text)'::regprocedure
      and i.oid = 'private.set_org_setting_impl(text, text)'::regprocedure),
  array[false, true],
  'the wrapper is security invoker and the body security definer (conventions section 2)');

-- ==================== 4. Reading ====================

select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000001');
select is((select count(*) from public.org_settings), 4::bigint, 'the Moderator reads every setting');
reset role;
select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000002');
select is((select count(*) from public.org_settings), 4::bigint, 'BC reads every setting');
reset role;
select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000003');
select is((select count(*) from public.org_settings), 4::bigint, 'a BCE reads every setting');
reset role;
select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000004');
select results_eq(
  $$ select key, case key when 'privacy_notice_version' then value = '1.4'
                          when 'email_daily_quota' then value = '90'
                          else true end
       from public.org_settings order by key $$,
  $$ values ('adunarea_generala_group_id'::text, true), ('board_group_id'::text, true),
            ('email_daily_quota'::text, true), ('privacy_notice_version'::text, true) $$,
  'an ordinary Member reads every setting -- the #771 step reads the version');
reset role;

select pg_temp.login_stale_bc();
select is((select count(*) from public.org_settings), 0::bigint,
  'a deactivated BC''s still-valid token reads nothing (live caller_level, not the claims)');
reset role;
select pg_temp.test_login('68100000-0000-0000-0000-000000000006', '{}'::jsonb);
select is((select count(*) from public.org_settings), 0::bigint,
  'a claimless session reads nothing (house rule 12)');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select count(*) from public.org_settings $$, '42501', null,
  'anon cannot read org_settings at all');
reset role;

-- ==================== 5. Direct writes ====================

select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000002');
select throws_ok($$ insert into public.org_settings (key, value) values ('new_key', 'x') $$, '42501', null,
  'BC cannot insert a setting directly -- keys are reference data');
select throws_ok($$ update public.org_settings set value = '91' $$, '42501', null,
  'BC cannot update a setting directly -- set_org_setting is the only write path');
select throws_ok($$ delete from public.org_settings $$, '42501', null,
  'BC cannot delete a setting directly');
reset role;
select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000001');
select throws_ok($$ update public.org_settings set value = '91' $$, '42501', null,
  'not even the Moderator updates a setting directly');
reset role;
select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000004');
select throws_ok($$ insert into public.org_settings (key, value) values ('new_key', 'x') $$, '42501', null,
  'an ordinary Member cannot insert a setting');
select throws_ok($$ update public.org_settings set value = '91' $$, '42501', null,
  'an ordinary Member cannot update a setting');
select throws_ok($$ delete from public.org_settings $$, '42501', null,
  'an ordinary Member cannot delete a setting');
reset role;
select pg_temp.test_login('68100000-0000-0000-0000-000000000006', '{}'::jsonb);
select throws_ok($$ update public.org_settings set value = '91' $$, '42501', null,
  'a claimless session cannot update a setting');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ update public.org_settings set value = '91' $$, '42501', null,
  'anon cannot update a setting');
select throws_ok($$ insert into public.org_settings (key, value) values ('new_key', 'x') $$, '42501', null,
  'anon cannot insert a setting');
reset role;

select results_eq(
  $$ select value, updated_by from public.org_settings where key = 'email_daily_quota' $$,
  $$ values ('90'::text, null::uuid) $$,
  'after every refused direct write the seed row is untouched');

-- ==================== 6. set_org_setting: step 1, for every caller ====================

select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.set_org_setting('email_daily_quota', 'abc') $$,
  'PT400', 'invalid_org_setting_value',
  'BC: a quota of ''abc'' is invalid_org_setting_value');
select throws_ok(
  $$ select public.set_org_setting('email_daily_quota', '100000') $$,
  'PT400', 'invalid_org_setting_value',
  'BC: a quota above 99999 is invalid_org_setting_value');
select throws_ok(
  $$ select public.set_org_setting('board_group_id', 'x1') $$,
  'PT400', 'invalid_org_setting_value',
  'BC: a Group id that is not a positive integer is invalid_org_setting_value');
select throws_ok(
  $$ select public.set_org_setting('email_daily_quota', repeat('9', 2049)) $$,
  'PT400', 'value_too_long',
  'BC: a 2049-character value is value_too_long (the #673 kit''s <field>_<rule> reason)');
select throws_ok(
  $$ select public.set_org_setting('email_daily_quota', repeat('9', 2048)) $$,
  'PT400', 'invalid_org_setting_value',
  'BC: a 2048-character value passes the length rule (inclusive) and meets the key''s own');
reset role;

-- Malformed for everyone, so answered before the gate (conventions section 2).
select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.set_org_setting('email_daily_quota', 'abc') $$,
  'PT400', 'invalid_org_setting_value',
  'an ordinary Member sending ''abc'' is answered invalid_org_setting_value before the gate');
reset role;
select pg_temp.test_login('68100000-0000-0000-0000-000000000006', '{}'::jsonb);
select throws_ok(
  $$ select public.set_org_setting('email_daily_quota', repeat('9', 2049)) $$,
  'PT400', 'value_too_long',
  'a claimless caller sending 2049 characters is answered value_too_long before the gate');
reset role;

-- ==================== 7. set_org_setting: the gate ====================

select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000003');
select throws_ok(
  $$ select public.set_org_setting('email_daily_quota', '91') $$,
  '42501', 'org_settings_manage_forbidden',
  'a BCE (level 5) sets nothing');
select throws_ok(
  $$ select public.set_org_setting('no_such_key', 'x') $$,
  '42501', 'org_settings_manage_forbidden',
  'a BCE naming an unknown key is refused by the gate, not told the key is missing');
reset role;
select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.set_org_setting('email_daily_quota', '91') $$,
  '42501', 'org_settings_manage_forbidden',
  'an ordinary Member sets nothing');
reset role;
select pg_temp.login_stale_bc();
select throws_ok(
  $$ select public.set_org_setting('email_daily_quota', '91') $$,
  '42501', 'org_settings_manage_forbidden',
  'a deactivated BC holding a still-valid level-6 token sets nothing');
reset role;
select pg_temp.test_login('68100000-0000-0000-0000-000000000006', '{}'::jsonb);
select throws_ok(
  $$ select public.set_org_setting('email_daily_quota', '91') $$,
  '42501', 'org_settings_manage_forbidden',
  'a claimless session sets nothing');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(
  $$ select public.set_org_setting('email_daily_quota', '91') $$,
  '42501', null,
  'anon cannot even execute the command');
reset role;

select results_eq(
  $$ select value, updated_by from public.org_settings where key = 'email_daily_quota' $$,
  $$ values ('90'::text, null::uuid) $$,
  'after every refusal the seed row is untouched');

-- ==================== 8. set_org_setting: BC and the Moderator ====================

select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.set_org_setting('no_such_key', 'x') $$,
  'PT404', 'org_setting_not_found',
  'BC naming a key no migration seeded is org_setting_not_found');
select throws_ok(
  $$ select public.set_org_setting(null, 'x') $$,
  'PT404', 'org_setting_not_found',
  'BC naming no key at all is org_setting_not_found');
select throws_ok(
  $$ select public.set_org_setting('adherence_form_url', 'https://forms.example.org/a') $$,
  'PT404', 'org_setting_not_found',
  'R66: adherence_form_url is org_setting_not_found -- the address is set with the Adherence Message');

create temp table set_681 as
  select * from public.set_org_setting('email_daily_quota', '  77  ');
select is((select value from set_681), '77',
  'BC sets the quota -- returned trimmed');
select is((select updated_by from set_681), '68100000-0000-0000-0000-000000000002'::uuid,
  'the returned row records BC as updated_by');
select ok((select s.updated_at > seed.updated_at from set_681 as s, seed_681 as seed),
  'updated_at moved past the seed''s');
select throws_ok(
  $$ select public.set_org_setting('email_daily_quota', '77 ') $$,
  'PT409', 'nothing_to_update',
  'sending the current value back, even padded, is nothing_to_update');
reset role;

select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000004');
select results_eq(
  $$ select value, updated_by from public.org_settings where key = 'email_daily_quota' $$,
  $$ values ('77'::text, '68100000-0000-0000-0000-000000000002'::uuid) $$,
  'an ordinary Member reads the stored, trimmed value and who set it');
reset role;

select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000001');
select is(
  (select updated_by from public.set_org_setting('email_daily_quota', '0')),
  '68100000-0000-0000-0000-000000000001'::uuid,
  'the Moderator changes the quota and becomes updated_by');
select is(
  (select value from public.org_settings where key = 'email_daily_quota'),
  '0',
  'the Moderator''s value is stored');
select ok(
  (select s.updated_at > prev.updated_at
     from public.org_settings as s, set_681 as prev
    where s.key = 'email_daily_quota'),
  'updated_at moved again on the Moderator''s change');
select is(
  (select value from public.set_org_setting('adunarea_generala_group_id', (select id::text from group_681))),
  (select id::text from group_681),
  'the Moderator names the Adunarea Generală Group');
select is(
  (select value from public.set_org_setting('adunarea_generala_group_id', '')),
  null,
  'an empty string clears the value');
select is(
  (select value from public.org_settings where key = 'adunarea_generala_group_id'),
  null,
  'the cleared value is stored as null');
select throws_ok(
  $$ select public.set_org_setting('adunarea_generala_group_id', null) $$,
  'PT409', 'nothing_to_update',
  'clearing it again with null is nothing_to_update');
reset role;

select results_eq(
  $$ select count(*)::int from public.org_settings $$,
  $$ values (4) $$,
  'no command ever created a key beyond the four the migrations seed (R58 deleted vote_retention_percent, R66 adherence_form_url)');

select * from finish();
rollback;
