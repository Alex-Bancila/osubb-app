-- promotion_rules.test.sql -- #49, amended by #826 (ruling R28): the
-- Promotion Rules table and its two seeded rows, and the Promotion
-- Threshold in force per kind -- public.promotion_thresholds,
-- public.promotion_threshold_changes' companion role_evaluations.test.sql
-- owns, and public.promotion_threshold_in_force(p_kind).
--
-- R28 dropped promotion_rules.initial_threshold (the close-time stamp moved
-- to public.promotion_thresholds, one row per kind, seeded from whatever was
-- in force when #826 migrated) and the argument-less
-- public.promotion_threshold_in_force(); private.stamp_closing_threshold and
-- every Evaluation-Period-scoped reader are gone with public.evaluation_periods
-- itself (role_evaluations.test.sql). This file keeps promotion_rules'
-- schema, seeds, constraints and read personas (§1-4, minus
-- initial_threshold) and replaces the old close-time stamp walkthrough
-- (§5-6) with promotion_thresholds' own schema, seed, constraints, read
-- personas, absence of a client write path, and the per-kind in-force read.
--
-- In order: 1. promotion_rules schema and grants; 2. its two seeded rules;
-- 3. its constraints; 4. reading it, and no client write; 5.
-- promotion_thresholds schema, grants and its seeded row; 6. its
-- constraints; 7. reading it, and no client write; 8.
-- public.promotion_threshold_in_force(p_kind), per kind, and the retired
-- no-argument overload.
--
-- Mutation guards, each named against the assertion that turns red:
--   * promotion_rules_top_percent_shape_ck checking initial_threshold
--     instead of percent -> "promotion_rules_top_percent_shape_ck: a
--     top_percent rule carries a percentage" stops throwing;
--   * promotion_thresholds_kind_ck dropped or widened -> "an unknown kind is
--     rejected" stops throwing;
--   * promotion_thresholds_threshold_range_ck dropped -> "a threshold below
--     1 is rejected" stops throwing;
--   * drop auth_is_member() / caller_level() from promotion_thresholds_read
--     or promotion_rules_read -> the claimless / deactivated read
--     assertions on the matching table;
--   * add a grant or a write policy on either table -> the grant and
--     direct-write assertions;
--   * promotion_threshold_in_force(p_kind) reading initial_threshold or a
--     hard-coded value instead of promotion_thresholds.threshold -> "the
--     Voluntar Activ threshold in force is 30" and "the Adunarea Generală
--     threshold is null until BC sets it" both go red;
--   * promotion_threshold_in_force(p_kind) dropping its security-invoker
--     visibility -> "a claimless session reads no threshold in force".
-- Every guard above was run as a mutation on 2026-09-27 and turned its named
-- assertion red.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(54);

-- ==================== Fixtures ====================

insert into auth.users (id, email) values
  ('49000000-0000-0000-0000-000000000001', 'bc49@test.local'),
  ('49000000-0000-0000-0000-000000000003', 'stale49@test.local'),
  ('49000000-0000-0000-0000-000000000005', 'ana49@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('49000000-0000-0000-0000-000000000001', 'BC 49',                  'bc49@test.local',    'bc',       'activ'),
  -- Deactivated, still holding the Voluntar token it was issued (ADR-0003).
  ('49000000-0000-0000-0000-000000000003', 'Voluntar dezactivat 49', 'stale49@test.local', 'voluntar', 'inactiv'),
  ('49000000-0000-0000-0000-000000000005', 'Ana 49',                 'ana49@test.local',   'voluntar', 'activ');

create function pg_temp.login_stale_voluntar() returns void language sql as $$
  select pg_temp.test_login('49000000-0000-0000-0000-000000000003', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb, 'group_ids', '[]'::jsonb));
$$;

-- ==================== 1. promotion_rules: schema and grants ====================

select has_table('public', 'promotion_rules', 'public.promotion_rules exists');
select is((select relrowsecurity from pg_class where oid = 'public.promotion_rules'::regclass), true,
  'promotion_rules has RLS enabled in the migration that creates it (house rule 2)');
select is(
  (select array_agg(policyname || ':' || cmd order by policyname)::text[] from pg_policies
    where schemaname = 'public' and tablename = 'promotion_rules'),
  array['promotion_rules_read:SELECT'],
  'the only policy is promotion_rules_read, for select -- no client write policy exists');
select columns_are('public', 'promotion_rules',
  array['id', 'from_role', 'to_role', 'kind', 'min_tenure_months', 'percent', 'enabled', 'created_at', 'updated_at'],
  'promotion_rules carries from-Role, to-Role, kind, tenure, percent and the enabled flag -- #826 dropped initial_threshold');
select is(
  array[has_table_privilege('authenticated', 'public.promotion_rules', 'select'),
        has_table_privilege('authenticated', 'public.promotion_rules', 'insert'),
        has_table_privilege('authenticated', 'public.promotion_rules', 'update'),
        has_table_privilege('authenticated', 'public.promotion_rules', 'delete')],
  array[true, false, false, false],
  'authenticated may select promotion_rules and nothing else -- no client write grant');
select is(
  array[has_table_privilege('anon', 'public.promotion_rules', 'select'),
        has_table_privilege('anon', 'public.promotion_rules', 'insert'),
        has_table_privilege('anon', 'public.promotion_rules', 'update'),
        has_table_privilege('anon', 'public.promotion_rules', 'delete')],
  array[false, false, false, false],
  'anon holds no privilege on promotion_rules');
select is(
  array[has_function_privilege('authenticated', 'public.promotion_threshold_in_force(text)', 'execute'),
        has_function_privilege('anon', 'public.promotion_threshold_in_force(text)', 'execute'),
        has_function_privilege('service_role', 'public.promotion_threshold_in_force(text)', 'execute'),
        has_function_privilege('public', 'public.promotion_threshold_in_force(text)', 'execute')],
  array[true, false, false, false],
  'public.promotion_threshold_in_force(text): execute for authenticated only (conventions section 4)');
select is(
  (select prosecdef from pg_proc where oid = 'public.promotion_threshold_in_force(text)'::regprocedure),
  false, 'promotion_threshold_in_force(text) is security invoker over promotion_thresholds_read''s RLS');
select is(
  (select provolatile::text from pg_proc where oid = 'public.promotion_threshold_in_force(text)'::regprocedure),
  's', 'promotion_threshold_in_force(text) is stable');

-- ==================== 2. The seeds ====================

select results_eq(
  $$ select from_role::text, to_role::text, kind, min_tenure_months, percent, enabled
       from public.promotion_rules order by from_role $$,
  $$ values ('recrut',   'voluntar', 'time',        6, null::int, true),
            ('voluntar', 'activ',    'top_percent', 6, 30,        true) $$,
  'both seeded rules (R20): Recrut -> Voluntar by 6 months of tenure; Voluntar -> activ at the top 30 % with 6 months');
select results_eq(
  $$ select role.name from public.promotion_rules as rule
       join public.roles as role on role.id = rule.to_role
      where rule.kind = 'top_percent' $$,
  $$ values ('Voluntar Activ') $$,
  'the top_percent rule''s target Role is Voluntar Activ -- nothing names Membru Activ');

-- ==================== 3. Constraints ====================

select throws_ok(
  $$ insert into public.promotion_rules (from_role, to_role, kind, min_tenure_months)
     values ('activ', 'vot', 'points', 6) $$,
  '23514', 'new row for relation "promotion_rules" violates check constraint "promotion_rules_kind_ck"',
  'promotion_rules_kind_ck: an unknown rule kind is rejected');
select throws_ok(
  $$ insert into public.promotion_rules (from_role, to_role, kind, min_tenure_months)
     values ('activ', 'vot', 'top_percent', 6) $$,
  '23514', 'new row for relation "promotion_rules" violates check constraint "promotion_rules_top_percent_shape_ck"',
  'promotion_rules_top_percent_shape_ck: a top_percent rule carries a percentage');
select throws_ok(
  $$ insert into public.promotion_rules (from_role, to_role, kind, min_tenure_months, percent)
     values ('activ', 'vot', 'time', 6, 30) $$,
  '23514', 'new row for relation "promotion_rules" violates check constraint "promotion_rules_time_shape_ck"',
  'promotion_rules_time_shape_ck: a time rule carries no percentage');
select throws_ok(
  $$ insert into public.promotion_rules (from_role, to_role, kind, min_tenure_months, percent)
     values ('activ', 'vot', 'top_percent', 6, 101) $$,
  '23514', 'new row for relation "promotion_rules" violates check constraint "promotion_rules_percent_range_ck"',
  'promotion_rules_percent_range_ck: a percentage above 100 is rejected');
select throws_ok(
  $$ insert into public.promotion_rules (from_role, to_role, kind, min_tenure_months, percent)
     values ('activ', 'vot', 'top_percent', 6, 20) $$,
  '23505', 'duplicate key value violates unique constraint "promotion_rules_top_percent_uidx"',
  'promotion_rules_top_percent_uidx: there is exactly one top_percent rule for the ranking to read');
select throws_ok(
  $$ insert into public.promotion_rules (from_role, to_role, kind, min_tenure_months, percent)
     values ('activ', 'vot', 'top_percent', 6, 0) $$,
  '23514', 'new row for relation "promotion_rules" violates check constraint "promotion_rules_percent_range_ck"',
  'promotion_rules_percent_range_ck: a percentage of 0 is rejected');
select throws_ok(
  $$ insert into public.promotion_rules (from_role, to_role, kind, min_tenure_months)
     values ('activ', 'activ', 'time', 6) $$,
  '23514', 'new row for relation "promotion_rules" violates check constraint "promotion_rules_roles_ck"',
  'promotion_rules_roles_ck: a rule moves a Member to another Role');
select throws_ok(
  $$ insert into public.promotion_rules (from_role, to_role, kind, min_tenure_months)
     values ('activ', 'vot', 'time', -1) $$,
  '23514', 'new row for relation "promotion_rules" violates check constraint "promotion_rules_tenure_range_ck"',
  'promotion_rules_tenure_range_ck: a negative tenure is rejected');
select throws_ok(
  $$ insert into public.promotion_rules (from_role, to_role, kind, min_tenure_months)
     values ('activ', 'vot', 'time', 121) $$,
  '23514', 'new row for relation "promotion_rules" violates check constraint "promotion_rules_tenure_range_ck"',
  'promotion_rules_tenure_range_ck: a tenure above 120 months is rejected');
select throws_ok(
  $$ insert into public.promotion_rules (from_role, to_role, kind, min_tenure_months)
     values ('recrut', 'voluntar', 'time', 12) $$,
  '23505', 'duplicate key value violates unique constraint "promotion_rules_from_role_to_role_key"',
  'promotion_rules_from_role_to_role_key: one rule per from-Role / to-Role pair');
select throws_ok(
  $$ insert into public.promotion_rules (from_role, to_role, kind, min_tenure_months, created_at, updated_at)
     values ('activ', 'vot', 'time', 6, '2001-01-02 00:00:00+00', '2001-01-01 00:00:00+00') $$,
  '23514', 'new row for relation "promotion_rules" violates check constraint "promotion_rules_updated_at_ck"',
  'promotion_rules_updated_at_ck: updated_at never precedes created_at');
-- Compared against the row's own value before the edit, so the assertion does
-- not lean on when the seed was written.
create temp table before49 as
  select updated_at from public.promotion_rules where kind = 'time';
update public.promotion_rules set enabled = true where kind = 'time';
select ok((select rule.updated_at > before.updated_at
             from public.promotion_rules as rule, before49 as before
            where rule.kind = 'time'),
  'promotion_rules_set_updated_at moves updated_at on an in-place edit');

-- ==================== 4. Reading, and no client write ====================

select pg_temp.test_login_leadership('49000000-0000-0000-0000-000000000001');
select is((select count(*) from public.promotion_rules), 2::bigint, 'BC reads both rules');
select throws_ok(
  $$ insert into public.promotion_rules (from_role, to_role, kind, min_tenure_months)
     values ('activ', 'vot', 'time', 12) $$,
  '42501', 'permission denied for table promotion_rules',
  'BC cannot insert a rule directly');
select throws_ok(
  $$ update public.promotion_rules set percent = 40 where kind = 'top_percent' $$,
  '42501', 'permission denied for table promotion_rules',
  'BC cannot update a rule directly -- no command edits promotion_rules'' shape, only promotion_thresholds'' value');
select throws_ok(
  $$ delete from public.promotion_rules where kind = 'time' $$,
  '42501', 'permission denied for table promotion_rules',
  'BC cannot delete a rule');
reset role;

select pg_temp.test_login_leadership('49000000-0000-0000-0000-000000000005');
select is((select count(*) from public.promotion_rules), 2::bigint,
  'a Voluntar reads both rules -- gamification needs visible goals');
reset role;

select pg_temp.test_login('49000000-0000-0000-0000-000000000005', '{}'::jsonb);
select is((select count(*) from public.promotion_rules), 0::bigint,
  'a claimless session with a real uid reads no rule (house rule 12)');
reset role;

select pg_temp.login_stale_voluntar();
select is((select count(*) from public.promotion_rules), 0::bigint,
  'a deactivated Voluntar''s still-valid token reads no rule');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select count(*) from public.promotion_rules $$, '42501', null,
  'anon cannot read promotion_rules at all');
reset role;

-- ==================== 5. promotion_thresholds: schema, grants and seed ====================
-- #826 (ruling R28): one row per Role Evaluation kind, seeded from whatever
-- was in force under the retired open/close model -- voluntar_activ carries
-- over the old initial_threshold (30, never stamped by a close in this
-- fresh database); adunarea_generala never existed, so it starts null.

select has_table('public', 'promotion_thresholds', 'public.promotion_thresholds exists');
select is((select relrowsecurity from pg_class where oid = 'public.promotion_thresholds'::regclass), true,
  'promotion_thresholds has RLS enabled in the migration that creates it (house rule 2)');
select is(
  (select array_agg(policyname || ':' || cmd order by policyname)::text[] from pg_policies
    where schemaname = 'public' and tablename = 'promotion_thresholds'),
  array['promotion_thresholds_read:SELECT'],
  'the only policy is promotion_thresholds_read, for select -- no client write policy exists');
select columns_are('public', 'promotion_thresholds',
  array['kind', 'threshold', 'created_at', 'updated_at', 'updated_by'],
  'promotion_thresholds carries the kind, its threshold, and who last edited it by hand');
select is(
  array[has_table_privilege('authenticated', 'public.promotion_thresholds', 'select'),
        has_table_privilege('authenticated', 'public.promotion_thresholds', 'insert'),
        has_table_privilege('authenticated', 'public.promotion_thresholds', 'update'),
        has_table_privilege('authenticated', 'public.promotion_thresholds', 'delete')],
  array[true, false, false, false],
  'authenticated may select promotion_thresholds and nothing else -- run_role_evaluation and set_promotion_threshold are the only write paths');
select is(
  array[has_table_privilege('anon', 'public.promotion_thresholds', 'select'),
        has_table_privilege('anon', 'public.promotion_thresholds', 'insert')],
  array[false, false],
  'anon holds no privilege on promotion_thresholds');

select results_eq(
  $$ select kind, threshold from public.promotion_thresholds order by kind $$,
  $$ values ('adunarea_generala', null::int), ('voluntar_activ', 30) $$,
  'the seed: voluntar_activ carries over the old initial_threshold (30); adunarea_generala starts unset');

-- ==================== 6. Constraints ====================

select throws_ok(
  $$ insert into public.promotion_thresholds (kind, threshold) values ('bogus', 10) $$,
  '23514', 'new row for relation "promotion_thresholds" violates check constraint "promotion_thresholds_kind_ck"',
  'promotion_thresholds_kind_ck: an unknown kind is rejected');
select throws_ok(
  $$ update public.promotion_thresholds set threshold = 0 where kind = 'voluntar_activ' $$,
  '23514', 'new row for relation "promotion_thresholds" violates check constraint "promotion_thresholds_threshold_range_ck"',
  'promotion_thresholds_threshold_range_ck: a threshold below 1 is rejected -- null (unset) stays fine');

-- ==================== 7. Reading, and no client write ====================

select pg_temp.test_login_leadership('49000000-0000-0000-0000-000000000001');
select is((select count(*) from public.promotion_thresholds), 2::bigint, 'BC reads both thresholds');
select throws_ok(
  $$ insert into public.promotion_thresholds (kind, threshold) values ('voluntar_activ', 40) $$,
  '42501', 'permission denied for table promotion_thresholds',
  'BC cannot insert a threshold directly -- set_promotion_threshold and run_role_evaluation are the write paths');
select throws_ok(
  $$ update public.promotion_thresholds set threshold = 40 where kind = 'voluntar_activ' $$,
  '42501', 'permission denied for table promotion_thresholds',
  'BC cannot update a threshold by a direct write');
select throws_ok(
  $$ delete from public.promotion_thresholds where kind = 'voluntar_activ' $$,
  '42501', 'permission denied for table promotion_thresholds',
  'BC cannot delete a threshold row');
reset role;

select pg_temp.test_login_leadership('49000000-0000-0000-0000-000000000005');
select is((select count(*) from public.promotion_thresholds), 2::bigint,
  'a Voluntar reads both thresholds -- the goal a Voluntar works toward (#634)');
reset role;

select pg_temp.test_login('49000000-0000-0000-0000-000000000005', '{}'::jsonb);
select is((select count(*) from public.promotion_thresholds), 0::bigint,
  'a claimless session with a real uid reads no threshold row (house rule 12)');
reset role;

select pg_temp.login_stale_voluntar();
select is((select count(*) from public.promotion_thresholds), 0::bigint,
  'a deactivated Voluntar''s still-valid token reads no threshold row');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select count(*) from public.promotion_thresholds $$, '42501', null,
  'anon cannot read promotion_thresholds at all');
reset role;

-- ==================== 8. public.promotion_threshold_in_force(p_kind) ====================

select pg_temp.test_login_leadership('49000000-0000-0000-0000-000000000005');
select is(public.promotion_threshold_in_force('voluntar_activ'), 30,
  'the Voluntar Activ threshold in force is 30 -- the carried-over initial_threshold');
select is(public.promotion_threshold_in_force('adunarea_generala'), null::int,
  'the Adunarea Generală threshold is null until BC sets it -- it never had an initial_threshold');
select is(public.promotion_threshold_in_force('bogus_kind'), null::int,
  'an unknown kind reads no threshold in force -- never an error');
reset role;

select pg_temp.test_login('49000000-0000-0000-0000-000000000005', '{}'::jsonb);
select is(public.promotion_threshold_in_force('voluntar_activ'), null::int,
  'a claimless session reads no threshold in force (house rule 12, over promotion_thresholds_read''s RLS)');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select public.promotion_threshold_in_force('voluntar_activ') $$, '42501', null,
  'anon cannot execute promotion_threshold_in_force at all');
reset role;

select hasnt_function('public', 'promotion_threshold_in_force', array[]::text[],
  'the argument-less public.promotion_threshold_in_force() no longer exists -- #826 replaced it with the per-kind read (never overloaded, PGRST203)');

select * from finish();
rollback;
