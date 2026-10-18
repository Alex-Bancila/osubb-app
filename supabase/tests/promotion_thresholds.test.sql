-- promotion_thresholds.test.sql -- #826 (ruling R28): the Promotion Threshold
-- in force per kind -- public.promotion_thresholds (public.
-- promotion_threshold_changes' companion role_evaluations.test.sql owns) and
-- public.promotion_threshold_in_force(p_kind).
--
-- Split from promotion_rules.test.sql (#49) by R58, which dropped
-- public.promotion_rules with its two rules (retention_signals.test.sql pins
-- the drop): this file keeps that suite's promotion_thresholds half --
-- schema, seed, constraints, read personas, absence of a client write path,
-- and the per-kind in-force read -- and the in-force read's grant and shape
-- assertions from its first section.
--
-- In order: 1. promotion_threshold_in_force(p_kind)'s grants and shape;
-- 2. promotion_thresholds schema, grants and its seeded row; 3. its
-- constraints; 4. reading it, and no client write; 5.
-- public.promotion_threshold_in_force(p_kind), per kind, and the retired
-- no-argument overload.
--
-- Mutation guards, each named against the assertion that turns red:
--   * promotion_thresholds_kind_ck dropped or widened -> "an unknown kind is
--     rejected" stops throwing;
--   * promotion_thresholds_threshold_range_ck dropped -> "a threshold below
--     1 is rejected" stops throwing;
--   * drop auth_is_member() / caller_level() from promotion_thresholds_read
--     -> the claimless / deactivated read assertions;
--   * add a grant or a write policy on the table -> the grant and
--     direct-write assertions;
--   * promotion_threshold_in_force(p_kind) reading a hard-coded value
--     instead of promotion_thresholds.threshold -> "the Voluntar Activ
--     threshold in force is 30" and "the Adunarea Generală threshold is null
--     until BC sets it" both go red;
--   * promotion_threshold_in_force(p_kind) dropping its security-invoker
--     visibility -> "a claimless session reads no threshold in force".
-- Every guard above was run as a mutation on 2026-09-27, as part of
-- promotion_rules.test.sql, and turned its named assertion red; the split
-- moved the assertions unchanged.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(26);

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

-- ==================== 1. promotion_threshold_in_force(p_kind): grants and shape ====================

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

-- ==================== 2. promotion_thresholds: schema, grants and seed ====================
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

-- ==================== 3. Constraints ====================

select throws_ok(
  $$ insert into public.promotion_thresholds (kind, threshold) values ('bogus', 10) $$,
  '23514', 'new row for relation "promotion_thresholds" violates check constraint "promotion_thresholds_kind_ck"',
  'promotion_thresholds_kind_ck: an unknown kind is rejected');
select throws_ok(
  $$ update public.promotion_thresholds set threshold = 0 where kind = 'voluntar_activ' $$,
  '23514', 'new row for relation "promotion_thresholds" violates check constraint "promotion_thresholds_threshold_range_ck"',
  'promotion_thresholds_threshold_range_ck: a threshold below 1 is rejected -- null (unset) stays fine');

-- ==================== 4. Reading, and no client write ====================

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

-- ==================== 5. public.promotion_threshold_in_force(p_kind) ====================

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
