-- promotion_threshold_command.test.sql -- #826 (ruling R28):
-- public.set_promotion_threshold(p_kind, p_threshold) over
-- private.set_promotion_threshold_impl -- BC or the Moderator edits the
-- Promotion Threshold of one Role Evaluation kind, at any time.
--
-- Replaces promotion_rule_command.test.sql (#702's set_promotion_rule):
-- there are two kinds now (voluntar_activ, adunarea_generala), not one rule
-- id, and the old "only before the first close" window is gone -- R28 lets
-- BC edit a threshold before or after any Role Evaluation.
--
-- In order: the functions and their execute privileges; fixtures; the
-- advisory lock held against a retry, run before this transaction ever
-- takes (47, 1) itself (which would block the remote session, exactly as
-- evaluation_period_commands.test.sql orders its own probe first); the
-- value, answered before the gate; the gate (claimless, Voluntar, BCE,
-- deactivated BC, anon); BC's and the Moderator's writes, read back through
-- public.promotion_threshold_in_force(kind) and audited; PT409
-- nothing_to_update; the Adunarea Generală kind edited from null; an edit
-- after a Role Evaluation row exists, which now succeeds.
--
-- Fixtures, written as the owner inside this rolled-back transaction: the
-- personas only -- promotion_thresholds and promotion_threshold_changes are
-- global singletons (one row per kind), never namespaced by a fixture
-- prefix, so every write here is read back by kind and undone by this
-- suite's rollback like every other suite that touches promotion_rules.
--
-- Mutation guards (run 2026-09-27 against the live database, reverted
-- after):
--   * the kind check removed -> "an unknown kind is invalid_role_evaluation_kind, before the gate";
--   * the level-6 gate dropped -> "a BCE cannot set a Promotion Threshold";
--   * the "after a close" refusal reinstated (the old guard's shape) ->
--     "an edit after a Role Evaluation row exists succeeds" goes red,
--     proving R28's inversion is real, not vacuous;
--   * the audit insert removed -> "every edit writes one
--     promotion_threshold_changes row" goes red.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(33);

-- ==================== 1. The functions and their privileges ====================

select is(
  (select t.typname from pg_proc p join pg_type t on t.oid = p.prorettype
    where p.oid = 'public.set_promotion_threshold(text, integer)'::regprocedure),
  'promotion_thresholds',
  'public.set_promotion_threshold(p_kind text, p_threshold integer) returns public.promotion_thresholds');

create temp table fns826 (fn text);
insert into fns826 values
  ('public.set_promotion_threshold(text, integer)'),
  ('private.set_promotion_threshold_impl(text, integer)');

select is(
  (select count(*) from fns826, unnest(array['anon', 'service_role', 'public']) as grantee
    where has_function_privilege(grantee, fn, 'execute')),
  0::bigint,
  'anon, service_role and PUBLIC execute neither the wrapper nor its _impl');
select is(
  (select count(*) from fns826 where has_function_privilege('authenticated', fn, 'execute')),
  2::bigint,
  'authenticated executes the wrapper and the _impl (the invoker wrapper calls the _impl as the caller)');
select is(
  (select prosecdef from pg_proc where oid = 'private.set_promotion_threshold_impl(text, integer)'::regprocedure),
  true, 'the _impl is security definer');
select is(
  (select prosecdef from pg_proc where oid = 'public.set_promotion_threshold(text, integer)'::regprocedure),
  false, 'the wrapper is security invoker');

-- ==================== Fixtures ====================

insert into auth.users (id, email)
select ('82600000-0000-0000-0000-0000000000' || suffix)::uuid, 'm' || suffix || '-826@test.local'
  from unnest(array['01', '02', '03', '04', '05']) as suffix;

insert into public.profiles (id, full_name, email, role, status) values
  ('82600000-0000-0000-0000-000000000001', 'BC 826',         'm01-826@test.local', 'bc',        'activ'),
  ('82600000-0000-0000-0000-000000000002', 'Moderator 826',  'm02-826@test.local', 'moderator', 'activ'),
  ('82600000-0000-0000-0000-000000000003', 'BCE 826',        'm03-826@test.local', 'bce',       'activ'),
  ('82600000-0000-0000-0000-000000000004', 'Voluntar 826',   'm04-826@test.local', 'voluntar',  'activ'),
  ('82600000-0000-0000-0000-000000000005', 'BC inactiv 826', 'm05-826@test.local', 'bc',        'inactiv');

-- ==================== 2. The advisory lock, held against a retry ====================
-- Run before this transaction ever takes (47, 1) itself: every
-- set_promotion_threshold call below would hold that lock for the rest of
-- the transaction and deadlock the remote probe (a shared database: an
-- earlier version of this suite hung a concurrent agent's run for several
-- minutes this way -- fixed by moving the probe here and pinning
-- lock_timeout on every remote session below). A held-lock probe, as
-- evaluation_period_commands.test.sql probes (47, 1): the claims need a BC
-- profile pt_retry's own session can see, so a dedicated setup connection
-- commits one first (autocommit, a unique 'f1' suffix outside this suite's
-- own prefix -- this transaction's own BC row is not yet committed and is
-- invisible to any other session). Both probe transactions roll back, and
-- the committed persona is deleted through the same setup connection
-- afterward, so nothing here outlives this suite.

select extensions.dblink_connect('pt_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('pt_setup', 'set lock_timeout = ''2s''');
-- #621: committed fixtures from an interrupted run must not hang cleanup.
select extensions.dblink_exec('pt_setup', $$
  delete from public.profiles where id = '82600000-0000-0000-0000-0000000000f1';
  delete from auth.users where id = '82600000-0000-0000-0000-0000000000f1';
  insert into auth.users (id, email) values
    ('82600000-0000-0000-0000-0000000000f1', 'race.bc.826@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('82600000-0000-0000-0000-0000000000f1', 'Race BC 826', 'race.bc.826@test.local', 'bc', 'activ');
$$);

select pg_temp.test_login_leadership('82600000-0000-0000-0000-0000000000f1');

select extensions.dblink_connect('pt_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_connect('pt_retry', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('pt_lock', 'set lock_timeout = ''2s''');
select extensions.dblink_exec('pt_retry', 'set lock_timeout = ''2s''');
select extensions.dblink_exec('pt_lock',
  'begin; do $lock$ begin perform pg_catalog.pg_advisory_xact_lock(47, 1); end $lock$;');
select extensions.dblink_exec('pt_retry', format(
  'begin; set local lock_timeout = ''250ms''; select set_config(''request.jwt.claims'', %L, true); set local role authenticated;',
  current_setting('request.jwt.claims')));
select throws_ok(
  $$ select * from extensions.dblink('pt_retry', 'select public.set_promotion_threshold(''voluntar_activ'', 55)::text')
       as result (updated text) $$,
  '55P03', 'canceling statement due to lock timeout',
  'a threshold edit waits on the (47, 1) advisory lock a run_role_evaluation call or another edit holds');
select extensions.dblink_exec('pt_retry', 'rollback;');
select extensions.dblink_exec('pt_lock', 'rollback;');
select extensions.dblink_disconnect('pt_retry');
select extensions.dblink_disconnect('pt_lock');

select extensions.dblink_exec('pt_setup', $$
  delete from public.profiles where id = '82600000-0000-0000-0000-0000000000f1';
  delete from auth.users where id = '82600000-0000-0000-0000-0000000000f1';
$$);
select extensions.dblink_disconnect('pt_setup');

reset role;
select pg_temp.test_clear_jwt();

-- The suite owns both kinds' rows for its own duration: pinned to a known
-- starting value so every later assertion is exact regardless of what a
-- concurrent suite or a previous run left behind. Pinned only now: a write
-- to promotion_thresholds fires #983's refresh, whose try-lock on (47, 1)
-- would have held the lock for this transaction and starved the probe above;
-- and as the owner again, after the probe's session.
update public.promotion_thresholds set threshold = 30, updated_by = null where kind = 'voluntar_activ';
update public.promotion_thresholds set threshold = null, updated_by = null where kind = 'adunarea_generala';
delete from public.promotion_threshold_changes where kind in ('voluntar_activ', 'adunarea_generala');

create temp table thresholds_before826 as
  select kind, threshold, updated_by from public.promotion_thresholds where kind in ('voluntar_activ', 'adunarea_generala');


select is(
  (select row(threshold, updated_by)::text from public.promotion_thresholds where kind = 'voluntar_activ'),
  (select row(threshold, updated_by)::text from thresholds_before826 where kind = 'voluntar_activ'),
  'the blocked retry rolled back: the Voluntar Activ threshold is still the fixture''s 30');

-- ==================== 3. The value, before the gate ====================
-- A claimless session with a live BC's uid: every malformed call is PT400.

select pg_temp.test_login('82600000-0000-0000-0000-000000000001', '{"provider":"email"}'::jsonb);
select throws_ok($$ select public.set_promotion_threshold(null, 10) $$,
  'PT400', 'invalid_role_evaluation_kind', 'a null kind is invalid_role_evaluation_kind, before the gate');
select throws_ok($$ select public.set_promotion_threshold('bogus', 10) $$,
  'PT400', 'invalid_role_evaluation_kind', 'an unknown kind is invalid_role_evaluation_kind, before the gate');
select throws_ok($$ select public.set_promotion_threshold('voluntar_activ', null) $$,
  'PT400', 'invalid_promotion_threshold', 'a null threshold is invalid_promotion_threshold, before the gate');
select throws_ok($$ select public.set_promotion_threshold('voluntar_activ', 0) $$,
  'PT400', 'invalid_promotion_threshold',
  'zero is invalid_promotion_threshold too -- promotion_thresholds_threshold_range_ck forbids it for every caller');
select throws_ok($$ select public.set_promotion_threshold('voluntar_activ', -5) $$,
  'PT400', 'invalid_promotion_threshold', 'a negative threshold is invalid_promotion_threshold, before the gate');

-- ==================== 4. The gate ====================

select throws_ok($$ select public.set_promotion_threshold('voluntar_activ', 40) $$,
  '42501', 'promotion_threshold_manage_forbidden',
  'a claimless session cannot set a Promotion Threshold, though its uid is a live BC');

reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000004');
select throws_ok($$ select public.set_promotion_threshold('voluntar_activ', 40) $$,
  '42501', 'promotion_threshold_manage_forbidden', 'a Voluntar cannot set a Promotion Threshold');

reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000003');
select throws_ok($$ select public.set_promotion_threshold('voluntar_activ', 40) $$,
  '42501', 'promotion_threshold_manage_forbidden', 'a BCE cannot set a Promotion Threshold');

reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000005');
select throws_ok($$ select public.set_promotion_threshold('voluntar_activ', 40) $$,
  '42501', 'promotion_threshold_manage_forbidden', 'a deactivated BC''s token cannot set a Promotion Threshold');

reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select public.set_promotion_threshold('voluntar_activ', 40) $$,
  '42501', null, 'anon cannot execute set_promotion_threshold');
reset role;

select results_eq(
  $$ select kind, threshold, updated_by from public.promotion_thresholds
      where kind in ('voluntar_activ', 'adunarea_generala') order by kind $$,
  $$ select kind, threshold, updated_by from thresholds_before826 order by kind $$,
  'every refusal above left both thresholds exactly as they were');

-- ==================== 5. BC and the Moderator write ====================

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select is(public.promotion_threshold_in_force('voluntar_activ'), 30,
  'before any write, the Voluntar Activ threshold in force is the fixture''s seeded 30');
select lives_ok($$ select public.set_promotion_threshold('voluntar_activ', 40) $$,
  'BC sets the Voluntar Activ threshold to 40');
reset role;

select is(public.promotion_threshold_in_force('voluntar_activ'), 40,
  'the write changes promotion_threshold_in_force(''voluntar_activ'')');
select is(
  (select updated_by from public.promotion_thresholds where kind = 'voluntar_activ'),
  '82600000-0000-0000-0000-000000000001'::uuid,
  'the row''s updated_by names BC as the hand editor');
select results_eq(
  $$ select kind, from_value, to_value, source, changed_by, role_evaluation_id
      from public.promotion_threshold_changes where kind = 'voluntar_activ' order by id desc limit 1 $$,
  $$ values ('voluntar_activ', 30, 40, 'manual', '82600000-0000-0000-0000-000000000001'::uuid, null::bigint) $$,
  'the edit writes one promotion_threshold_changes row: source manual, from 30, to 40, changed_by BC, no Role Evaluation');

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000002');
select lives_ok($$ select public.set_promotion_threshold('voluntar_activ', 45) $$,
  'the Moderator sets the Voluntar Activ threshold to 45');
reset role;

select is(public.promotion_threshold_in_force('voluntar_activ'), 45,
  'the Moderator''s write is the threshold in force');
select results_eq(
  $$ select kind, from_value, to_value, source, changed_by, role_evaluation_id
      from public.promotion_threshold_changes where kind = 'voluntar_activ' order by id desc limit 1 $$,
  $$ values ('voluntar_activ', 40, 45, 'manual', '82600000-0000-0000-0000-000000000002'::uuid, null::bigint) $$,
  'a second edit writes a second row naming the Moderator, from_value the previous 40');

-- ==================== 6. PT409 nothing_to_update ====================

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select throws_ok($$ select public.set_promotion_threshold('voluntar_activ', 45) $$,
  'PT409', 'nothing_to_update', 'the value already stored is nothing_to_update');
reset role;

-- ==================== 7. Each kind is editable: AG from null ====================

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select is(public.promotion_threshold_in_force('adunarea_generala'), null::int,
  'before any write, the Adunarea Generală threshold in force is null');
select lives_ok($$ select public.set_promotion_threshold('adunarea_generala', 20) $$,
  'BC sets the Adunarea Generală threshold, unset until now, to 20');
reset role;

select is(public.promotion_threshold_in_force('adunarea_generala'), 20,
  'the write changes promotion_threshold_in_force(''adunarea_generala'')');
select results_eq(
  $$ select kind, from_value, to_value, source, changed_by, role_evaluation_id
      from public.promotion_threshold_changes where kind = 'adunarea_generala' order by id desc limit 1 $$,
  $$ values ('adunarea_generala', null::int, 20, 'manual', '82600000-0000-0000-0000-000000000001'::uuid, null::bigint) $$,
  'the first Adunarea Generală edit logs from_value null');

-- ==================== 8. Editable after a Role Evaluation exists (R28 inverts #702) ====================

insert into public.role_evaluations (
  kind, name, period_from, period_to, run_by, threshold_used, threshold_computed, ranked_count
) values (
  'voluntar_activ', 'Evaluare fixture #826', '2026-01-01', '2026-01-31',
  '82600000-0000-0000-0000-000000000001', 45, null, 0
);

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select lives_ok($$ select public.set_promotion_threshold('voluntar_activ', 50) $$,
  'an edit after a Role Evaluation row exists succeeds -- R28 drops #702''s "only before the first close" window');
reset role;

select is(public.promotion_threshold_in_force('voluntar_activ'), 50,
  'the post-Role-Evaluation edit is the threshold in force');

select * from finish();
rollback;
