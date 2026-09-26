-- org_settings.test.sql -- #681 (ruling R20): organization settings, the
-- member-readable key-value table and its one BC/Moderator command,
-- public.set_org_setting, seeded with `adherence_form_url` for #52 (and, since
-- #512, `adunarea_generala_group_id`, whose rules evaluation_rankings_read.test.sql
-- owns; since #48, `vote_retention_percent`, whose rules retention_ranking.test.sql
-- owns).
--
-- In order: the schema (RLS, the one read policy, the trigger, the named
-- constraints -- Ruling 23), the seed row, the grants on the table and on
-- both functions, the read matrix, the direct-write matrix, the command's
-- step-1 rules (answered to every caller, claimless included), its gate
-- across personas, and its success path (trim, audit, updated_at, clear,
-- nothing_to_update, the 2048-character boundary).
--
-- Mutation guards, each named against the assertion that turns red:
--   * drop the level check in set_org_setting_impl -> "a BCE (level 5) sets
--     nothing" succeeds;
--   * drop the is_http_url check -> "ftp:// is invalid_org_setting_value"
--     becomes a raw 23514 from org_settings_adherence_form_url_ck, and the
--     ordinary Member's step-1 assertion becomes 42501;
--   * add any insert/update/delete policy -> "the only policy is
--     org_settings_read" fails;
--   * grant a write back to authenticated -> the direct-write assertions stop
--     throwing;
--   * remove the seed -> "the seed row" fails, and so does
--     rls_deny_by_default.test.sql's "every table holds a row" sweep;
--   * drop the live caller_level() half of org_settings_read -> "a
--     deactivated BC's still-valid token reads nothing" returns the row;
--   * drop the trim -> the stored value keeps its padding;
--   * drop updated_by from the UPDATE -> the audit assertions fail.
--
-- No pg_temp.test_race: one row, one `for update`, and the host defect in
-- #596 makes the blocking path unreliable locally.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(62);

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

-- The seed row's timestamp, captured before any command moves it.
create temp table seed_681 as
  select updated_at from public.org_settings where key = 'adherence_form_url';
grant select on seed_681 to authenticated;

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
select matches(obj_description('public.org_settings'::regclass, 'pg_class'), '#52',
  'the table comment names #52 as the first reader');
select matches(obj_description('public.set_org_setting(text, text)'::regprocedure, 'pg_proc'), '#52',
  'the command comment names #52 as the reader of the value it writes');

select throws_ok(
  $$ insert into public.org_settings (key) values ('Bad-Key') $$,
  '23514', 'new row for relation "org_settings" violates check constraint "org_settings_key_ck"',
  'org_settings_key_ck: a key is lower snake_case');
select throws_ok(
  $$ update public.org_settings set value = 'https://' || repeat('a', 2041) where key = 'adherence_form_url' $$,
  '23514', 'new row for relation "org_settings" violates check constraint "org_settings_value_length_ck"',
  'org_settings_value_length_ck: a value over 2048 characters is refused on a direct write');
select throws_ok(
  $$ update public.org_settings set value = 'ftp://forms.example.org/a' where key = 'adherence_form_url' $$,
  '23514', 'new row for relation "org_settings" violates check constraint "org_settings_adherence_form_url_ck"',
  'org_settings_adherence_form_url_ck: a non-http(s) adherence form address is refused on a direct write');

-- ==================== 2. The seed row ====================

-- #512 seeds a second key, adunarea_generala_group_id; its value is whatever
-- the demo seed pointed it at, so only its presence and audit are pinned here
-- (evaluation_rankings_read.test.sql owns its rules). #48 seeds a third,
-- vote_retention_percent, at R20's placeholder 25 (retention_ranking.test.sql
-- owns its rules).
select results_eq(
  $$ select key,
            case key when 'adunarea_generala_group_id' then true
                     when 'vote_retention_percent' then value = '25'
                     else value is null end,
            updated_by
       from public.org_settings order by key $$,
  $$ values ('adherence_form_url'::text, true, null::uuid),
            ('adunarea_generala_group_id'::text, true, null::uuid),
            ('vote_retention_percent'::text, true, null::uuid) $$,
  'the seed rows: adherence_form_url, empty, #512''s adunarea_generala_group_id and #48''s vote_retention_percent at 25, none set through the command -- and no other key');

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
select is((select count(*) from public.org_settings), 3::bigint, 'the Moderator reads every setting');
reset role;
select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000002');
select is((select count(*) from public.org_settings), 3::bigint, 'BC reads every setting');
reset role;
select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000003');
select is((select count(*) from public.org_settings), 3::bigint, 'a BCE reads every setting');
reset role;
select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000004');
select results_eq(
  $$ select key, key in ('adunarea_generala_group_id', 'vote_retention_percent') or value is null
       from public.org_settings order by key $$,
  $$ values ('adherence_form_url'::text, true), ('adunarea_generala_group_id'::text, true),
            ('vote_retention_percent'::text, true) $$,
  'an ordinary Member reads every setting, the empty adherence form included -- #52 sends it to exactly this Member');
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
select throws_ok($$ update public.org_settings set value = 'https://forms.example.org/x' $$, '42501', null,
  'BC cannot update a setting directly -- set_org_setting is the only write path');
select throws_ok($$ delete from public.org_settings $$, '42501', null,
  'BC cannot delete a setting directly');
reset role;
select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000001');
select throws_ok($$ update public.org_settings set value = 'https://forms.example.org/x' $$, '42501', null,
  'not even the Moderator updates a setting directly');
reset role;
select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000004');
select throws_ok($$ insert into public.org_settings (key, value) values ('new_key', 'x') $$, '42501', null,
  'an ordinary Member cannot insert a setting');
select throws_ok($$ update public.org_settings set value = 'https://forms.example.org/x' $$, '42501', null,
  'an ordinary Member cannot update a setting');
select throws_ok($$ delete from public.org_settings $$, '42501', null,
  'an ordinary Member cannot delete a setting');
reset role;
select pg_temp.test_login('68100000-0000-0000-0000-000000000006', '{}'::jsonb);
select throws_ok($$ update public.org_settings set value = 'https://forms.example.org/x' $$, '42501', null,
  'a claimless session cannot update a setting');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ update public.org_settings set value = 'https://forms.example.org/x' $$, '42501', null,
  'anon cannot update a setting');
select throws_ok($$ insert into public.org_settings (key, value) values ('new_key', 'x') $$, '42501', null,
  'anon cannot insert a setting');
reset role;

select results_eq(
  $$ select value, updated_by from public.org_settings where key = 'adherence_form_url' $$,
  $$ values (null::text, null::uuid) $$,
  'after every refused direct write the seed row is untouched');

-- ==================== 6. set_org_setting: step 1, for every caller ====================

select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.set_org_setting('adherence_form_url', 'ftp://forms.example.org/a') $$,
  'PT400', 'invalid_org_setting_value',
  'BC: an ftp:// adherence form address is invalid_org_setting_value');
select throws_ok(
  $$ select public.set_org_setting('adherence_form_url', 'javascript:alert(1)') $$,
  'PT400', 'invalid_org_setting_value',
  'BC: a javascript: address is invalid_org_setting_value');
select throws_ok(
  $$ select public.set_org_setting('adherence_form_url', 'forms.example.org/a') $$,
  'PT400', 'invalid_org_setting_value',
  'BC: an address without a scheme is invalid_org_setting_value');
select throws_ok(
  $$ select public.set_org_setting('adherence_form_url', 'https://' || repeat('a', 2041)) $$,
  'PT400', 'value_too_long',
  'BC: a 2049-character address is value_too_long (the #673 kit''s <field>_<rule> reason)');
reset role;

-- Malformed for everyone, so answered before the gate (conventions section 2).
select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.set_org_setting('adherence_form_url', 'ftp://forms.example.org/a') $$,
  'PT400', 'invalid_org_setting_value',
  'an ordinary Member sending ftp:// is answered invalid_org_setting_value before the gate');
reset role;
select pg_temp.test_login('68100000-0000-0000-0000-000000000006', '{}'::jsonb);
select throws_ok(
  $$ select public.set_org_setting('adherence_form_url', 'https://' || repeat('a', 2041)) $$,
  'PT400', 'value_too_long',
  'a claimless caller sending 2049 characters is answered value_too_long before the gate');
reset role;

-- ==================== 7. set_org_setting: the gate ====================

select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000003');
select throws_ok(
  $$ select public.set_org_setting('adherence_form_url', 'https://forms.example.org/a') $$,
  '42501', 'org_settings_manage_forbidden',
  'a BCE (level 5) sets nothing');
select throws_ok(
  $$ select public.set_org_setting('no_such_key', 'x') $$,
  '42501', 'org_settings_manage_forbidden',
  'a BCE naming an unknown key is refused by the gate, not told the key is missing');
reset role;
select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.set_org_setting('adherence_form_url', 'https://forms.example.org/a') $$,
  '42501', 'org_settings_manage_forbidden',
  'an ordinary Member sets nothing');
reset role;
select pg_temp.login_stale_bc();
select throws_ok(
  $$ select public.set_org_setting('adherence_form_url', 'https://forms.example.org/a') $$,
  '42501', 'org_settings_manage_forbidden',
  'a deactivated BC holding a still-valid level-6 token sets nothing');
reset role;
select pg_temp.test_login('68100000-0000-0000-0000-000000000006', '{}'::jsonb);
select throws_ok(
  $$ select public.set_org_setting('adherence_form_url', 'https://forms.example.org/a') $$,
  '42501', 'org_settings_manage_forbidden',
  'a claimless session sets nothing');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(
  $$ select public.set_org_setting('adherence_form_url', 'https://forms.example.org/a') $$,
  '42501', null,
  'anon cannot even execute the command');
reset role;

select results_eq(
  $$ select value, updated_by from public.org_settings where key = 'adherence_form_url' $$,
  $$ values (null::text, null::uuid) $$,
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
  $$ select public.set_org_setting('adherence_form_url', '   ') $$,
  'PT409', 'nothing_to_update',
  'BC clearing a value that is already empty is nothing_to_update');

create temp table set_681 as
  select * from public.set_org_setting('adherence_form_url', '  https://forms.example.org/adeziune  ');
select is((select value from set_681), 'https://forms.example.org/adeziune',
  'BC sets the adherence form address -- returned trimmed');
select is((select updated_by from set_681), '68100000-0000-0000-0000-000000000002'::uuid,
  'the returned row records BC as updated_by');
select ok((select s.updated_at > seed.updated_at from set_681 as s, seed_681 as seed),
  'updated_at moved past the seed''s');
select throws_ok(
  $$ select public.set_org_setting('adherence_form_url', 'https://forms.example.org/adeziune ') $$,
  'PT409', 'nothing_to_update',
  'sending the current value back, even padded, is nothing_to_update');
reset role;

select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000004');
select results_eq(
  $$ select value, updated_by from public.org_settings where key = 'adherence_form_url' $$,
  $$ values ('https://forms.example.org/adeziune'::text, '68100000-0000-0000-0000-000000000002'::uuid) $$,
  'an ordinary Member reads the stored, trimmed address and who set it');
reset role;

select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000001');
select is(
  (select updated_by from public.set_org_setting('adherence_form_url', 'http://forms.example.org/v2')),
  '68100000-0000-0000-0000-000000000001'::uuid,
  'the Moderator changes the address and becomes updated_by');
select is(
  (select value from public.org_settings where key = 'adherence_form_url'),
  'http://forms.example.org/v2',
  'an http:// address is accepted and stored');
select ok(
  (select s.updated_at > prev.updated_at
     from public.org_settings as s, set_681 as prev
    where s.key = 'adherence_form_url'),
  'updated_at moved again on the Moderator''s change');
select is(
  (select value from public.set_org_setting('adherence_form_url', '')),
  null,
  'an empty string clears the value');
select is(
  (select value from public.org_settings where key = 'adherence_form_url'),
  null,
  'the cleared value is stored as null');
select throws_ok(
  $$ select public.set_org_setting('adherence_form_url', null) $$,
  'PT409', 'nothing_to_update',
  'clearing it again with null is nothing_to_update');
reset role;

select pg_temp.test_login_leadership('68100000-0000-0000-0000-000000000002');
select is(
  (select char_length(value) from public.set_org_setting('adherence_form_url', 'https://' || repeat('a', 2040))),
  2048,
  'a 2048-character address is accepted -- the limit is inclusive');
reset role;

select results_eq(
  $$ select count(*)::int from public.org_settings $$,
  $$ values (3) $$,
  'no command ever created a key beyond the three the migrations seed');

select * from finish();
rollback;
