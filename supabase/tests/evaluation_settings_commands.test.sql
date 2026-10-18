-- evaluation_settings_commands.test.sql -- R58 (Alex, 2026-10-18), part 2: the
-- three commands that write public.evaluation_settings --
-- public.set_eligibility_floor(p_points), public.set_membership_cutoff(p_date)
-- and public.set_points_start_date(p_date) over their private.*_impl bodies --
-- and private.points_floor(), the Bucharest start of the Points Start Date.
-- Spec docs/superpowers/specs/2026-10-18-portofoliu-interne-design.md, section B.
-- The table and the widened change log have their own suite
-- (evaluation_settings.test.sql); the readers that apply the Floor, the cutoff
-- and the start date arrive with later tasks.
--
-- In order: for each command a held-lock probe of (47, 1) and a key-share probe
-- of the settings row (it must not wait, since it locks the row for no key
-- update), first -- before this transaction takes the row, which would make
-- the probes pass without the locks; the functions and their
-- privileges; points_floor() before any value; the value, answered before the
-- gate; the gate (Voluntar, claimless, BCE, deactivated BC, anon); BC's and the
-- Moderator's writes, read back and logged; the second change of each value
-- (from_*); the boundaries; PT409 nothing_to_update.
--
-- Fixtures (prefix 58583000-), written as the owner inside this rolled-back
-- transaction, except the race BC (…00f1): a remote session sees only
-- committed rows, so that Member, the key-share bridge function and the six
-- changes the probes commit are written and removed through dblink, and the
-- settings row is put back as the migration left it (all three values null)
-- before anything else runs.
--   1 bc, 2 moderator, 3 voluntar, 4 bce, 5 deactivated bc holding a token
--
-- Mutation guards (run 2026-10-18 as redefinitions of the named function inside
-- a transaction wrapping this file, reverted after; the lock probes of section 1
-- see only committed code, so those two were run as committed redefinitions of
-- all three _impls and restored), each turning the named assertions red:
--   * the floor's bound narrowed to below 0 -> "0 is invalid_eligibility_floor";
--   * tomorrow let through the cutoff's or the start date's check -> "a Data
--     limită de intrare tomorrow ..." / "a Data de început a punctajului
--     tomorrow ...";
--   * the level >= 6 gate dropped or lowered to 5 -> the Voluntar and BCE
--     refusals of that command, "every refusal above left the row unset" and
--     the final log count;
--   * require_active_member() replaced by auth.uid() -> "a claimless session
--     cannot set ... , though its uid is a live BC";
--   * the gate's message changed -> the four refusals of that command;
--   * the PT409 check removed -> "... already in force is nothing_to_update";
--   * the update removed -> "... is stored", "... already in force";
--   * updated_by dropped -> "the Prag minim is stored, with BC as updated_by";
--   * the log insert removed, written under the wrong field, or with the
--     number after the update as from_value -> the "first ..." and "second ..."
--     log-row assertions of that command;
--   * points_floor() without the zone, in UTC, or reading another row -> the
--     three points_floor() instants;
--   * pg_advisory_xact_lock(47, 1) removed from the _impls -> the three "waits
--     on the (47, 1) advisory lock" probes;
--   * the row locked for update instead of for no key update -> the three
--     "does not wait for a key-share lock" probes.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(66);

-- ==================== 1. The lock ====================
-- Query A holds (47, 1), the lock run_role_evaluation, set_promotion_threshold
-- and set_evaluation_percent take, and commits; query B is the command. B
-- passes its argument check and its gate (a live BC) and must then wait on A
-- and not on a row: A touches no table.

select extensions.dblink_connect('es_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('es_setup', 'set lock_timeout = ''2s''');
-- #621: committed fixtures from an interrupted run must not hang cleanup.
select extensions.dblink_exec('es_setup', $$
  drop function if exists public.test_583_hold_row();
  update public.evaluation_settings
     set eligibility_floor = null, membership_cutoff = null, points_start_date = null, updated_by = null
   where id = 1;
  delete from public.promotion_threshold_changes where changed_by = '58583000-0000-0000-0000-0000000000f1';
  delete from public.profiles where id = '58583000-0000-0000-0000-0000000000f1';
  delete from auth.users where id = '58583000-0000-0000-0000-0000000000f1';
  insert into auth.users (id, email) values
    ('58583000-0000-0000-0000-0000000000f1', 'race.bc.583@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('58583000-0000-0000-0000-0000000000f1', 'Race BC 583', 'race.bc.583@test.local', 'bc', 'activ');
  -- Test-only bridge: SELECT ... FOR KEY SHARE needs UPDATE privilege on the table,
  -- which no client role has, so the lock holder reaches the row through the owner.
  create function public.test_583_hold_row() returns text
  language sql security definer set search_path = '' as $fn$
    select 'held' from public.evaluation_settings where id = 1 for key share
  $fn$;
  revoke execute on function public.test_583_hold_row() from public, anon, authenticated, service_role;
  grant execute on function public.test_583_hold_row() to authenticated;
$$);

select pg_temp.test_login_leadership('58583000-0000-0000-0000-0000000000f1');
reset role;

create temp table race_floor583 as select * from pg_temp.test_race(
  'select ''held'' from (select pg_catalog.pg_advisory_xact_lock(47, 1)) as held',
  'select (public.set_eligibility_floor(9)).eligibility_floor::text');
select is((select result_b from race_floor583), '9',
  'set_eligibility_floor completes once the lock holder commits');
select ok((select b_waited from race_floor583),
  'set_eligibility_floor waits on the (47, 1) advisory lock a run or a threshold edit holds');
create temp table race_floor_row583 as select * from pg_temp.test_race(
  'select public.test_583_hold_row()',
  'select (public.set_eligibility_floor(11)).eligibility_floor::text');
select ok(not (select b_waited from race_floor_row583) and (select result_b from race_floor_row583) = '11',
  'set_eligibility_floor does not wait for a key-share lock on the row: it takes the row for no key update, never for update');

create temp table race_cutoff583 as select * from pg_temp.test_race(
  'select ''held'' from (select pg_catalog.pg_advisory_xact_lock(47, 1)) as held',
  'select (public.set_membership_cutoff(date ''2026-06-30'')).membership_cutoff::text');
select is((select result_b from race_cutoff583), '2026-06-30',
  'set_membership_cutoff completes once the lock holder commits');
select ok((select b_waited from race_cutoff583),
  'set_membership_cutoff waits on the (47, 1) advisory lock');
create temp table race_cutoff_row583 as select * from pg_temp.test_race(
  'select public.test_583_hold_row()',
  'select (public.set_membership_cutoff(date ''2026-06-01'')).membership_cutoff::text');
select ok(not (select b_waited from race_cutoff_row583) and (select result_b from race_cutoff_row583) = '2026-06-01',
  'set_membership_cutoff does not wait for a key-share lock on the row: for no key update, never for update');

create temp table race_start583 as select * from pg_temp.test_race(
  'select ''held'' from (select pg_catalog.pg_advisory_xact_lock(47, 1)) as held',
  'select (public.set_points_start_date(date ''2026-07-01'')).points_start_date::text');
select is((select result_b from race_start583), '2026-07-01',
  'set_points_start_date completes once the lock holder commits');
select ok((select b_waited from race_start583),
  'set_points_start_date waits on the (47, 1) advisory lock');
create temp table race_start_row583 as select * from pg_temp.test_race(
  'select public.test_583_hold_row()',
  'select (public.set_points_start_date(date ''2026-06-15'')).points_start_date::text');
select ok(not (select b_waited from race_start_row583) and (select result_b from race_start_row583) = '2026-06-15',
  'set_points_start_date does not wait for a key-share lock on the row: for no key update, never for update');

-- Put the committed row back as the migration left it, then drop the race BC.
select extensions.dblink_exec('es_setup', $$
  drop function public.test_583_hold_row();
  update public.evaluation_settings
     set eligibility_floor = null, membership_cutoff = null, points_start_date = null, updated_by = null
   where id = 1;
  delete from public.promotion_threshold_changes where changed_by = '58583000-0000-0000-0000-0000000000f1';
  delete from public.profiles where id = '58583000-0000-0000-0000-0000000000f1';
  delete from auth.users where id = '58583000-0000-0000-0000-0000000000f1';
$$);
select extensions.dblink_disconnect('es_setup');
select pg_temp.test_clear_jwt();

select results_eq(
  $$ select (select count(*) from public.evaluation_settings
              where eligibility_floor is not null or membership_cutoff is not null
                 or points_start_date is not null or updated_by is not null),
            (select count(*) from public.promotion_threshold_changes
              where field in ('floor', 'cutoff', 'points_start')) $$,
  $$ values (0::bigint, 0::bigint) $$,
  'the probes left the row unset and the log without a settings row');

-- ==================== 2. The functions and their privileges ====================

create temp table fns583 (fn text, is_command boolean, definer boolean);
insert into fns583 values
  ('public.set_eligibility_floor(integer)',         true,  false),
  ('private.set_eligibility_floor_impl(integer)',   true,  true),
  ('public.set_membership_cutoff(date)',            true,  false),
  ('private.set_membership_cutoff_impl(date)',      true,  true),
  ('public.set_points_start_date(date)',            true,  false),
  ('private.set_points_start_date_impl(date)',      true,  true),
  ('private.points_floor()',                        false, false);

select is(
  (select count(*) from fns583 f join pg_proc p on p.oid = f.fn::regprocedure
    join pg_type t on t.oid = p.prorettype
   where f.is_command and t.typname = 'evaluation_settings'),
  6::bigint,
  'each of the three wrappers and three _impls returns the evaluation_settings row it wrote');
select is(
  (select count(*) from fns583, unnest(array['anon', 'service_role', 'public']) as grantee
    where has_function_privilege(grantee, fn, 'execute')),
  0::bigint,
  'anon, service_role and PUBLIC execute none of the three commands, their _impls and points_floor');
select is(
  (select count(*) from fns583 where is_command and has_function_privilege('authenticated', fn, 'execute')),
  6::bigint,
  'authenticated executes each wrapper and its _impl (the invoker wrapper calls it as the caller)');
select is(has_function_privilege('authenticated', 'private.points_floor()', 'execute'), false,
  'private.points_floor() is granted to nobody: only the readers, as security-definer bodies, call it');
select is(
  (select count(*) from fns583 f join pg_proc p on p.oid = f.fn::regprocedure
    where p.prosecdef is distinct from f.definer),
  0::bigint,
  'the three _impls are security definer; the wrappers and points_floor are security invoker');
select results_eq(
  $$ select provolatile = 's', array_length(proconfig, 1) = 1 and proconfig[1] = 'search_path=""'
       from pg_proc where oid = 'private.points_floor()'::regprocedure $$,
  $$ values (true, true) $$,
  'points_floor is stable with an empty search_path');
select is(
  (select count(*) from fns583 where obj_description(fn::regprocedure, 'pg_proc') is null),
  0::bigint,
  'every function carries a comment');

-- ==================== Fixtures ====================

create function pg_temp.u583(n integer) returns uuid language sql immutable as $$
  select ('58583000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;

-- The row as the migration seeded it, whatever an earlier suite left.
update public.evaluation_settings
   set eligibility_floor = null, membership_cutoff = null, points_start_date = null, updated_by = null
 where id = 1;
delete from public.promotion_threshold_changes where field in ('floor', 'cutoff', 'points_start');

insert into auth.users (id, email) values
  (pg_temp.u583(1), 'bc.583@test.local'),
  (pg_temp.u583(2), 'moderator.583@test.local'),
  (pg_temp.u583(3), 'voluntar.583@test.local'),
  (pg_temp.u583(4), 'bce.583@test.local'),
  (pg_temp.u583(5), 'stale.583@test.local');
insert into public.profiles (id, full_name, email, role, status) values
  (pg_temp.u583(1), 'BC 583',                  'bc.583@test.local',        'bc',        'activ'),
  (pg_temp.u583(2), 'Moderator 583',           'moderator.583@test.local', 'moderator', 'activ'),
  (pg_temp.u583(3), 'Voluntar 583',            'voluntar.583@test.local',  'voluntar',  'activ'),
  (pg_temp.u583(4), 'BCE 583',                 'bce.583@test.local',       'bce',       'activ'),
  (pg_temp.u583(5), 'BC dezactivat 583',       'stale.583@test.local',     'bc',        'inactiv');

create temp table fx583 as
  select (now() at time zone 'Europe/Bucharest')::date      as today,
         (now() at time zone 'Europe/Bucharest')::date + 1  as tomorrow;
grant select on fx583 to authenticated;

-- One valid call per command, for the gate.
create temp table cmd583 (label text, call text);
insert into cmd583 values
  ('the Prag minim',                    $$ select public.set_eligibility_floor(7) $$),
  ('the Data limită de intrare',        $$ select public.set_membership_cutoff(date '2026-06-01') $$),
  ('the Data de început a punctajului', $$ select public.set_points_start_date(date '2026-06-01') $$);
grant select on cmd583 to authenticated, anon;

-- ==================== 3. points_floor() with no value ====================

select is(private.points_floor(), null::timestamptz,
  'points_floor() is null while the Points Start Date is unset: every total counts from the beginning');

-- ==================== 4. The value, before the gate ====================
-- A claimless session with a live BC's uid: every malformed call is PT400.

select pg_temp.test_login(pg_temp.u583(1), '{"provider":"email"}'::jsonb);
select throws_ok($$ select public.set_eligibility_floor(null) $$,
  'PT400', 'invalid_eligibility_floor', 'a null Prag minim is invalid_eligibility_floor, before the gate');
select throws_ok($$ select public.set_eligibility_floor(0) $$,
  'PT400', 'invalid_eligibility_floor', '0 is invalid_eligibility_floor, before the gate -- at least 1 Task Point');
select throws_ok($$ select public.set_eligibility_floor(-5) $$,
  'PT400', 'invalid_eligibility_floor', 'a negative Prag minim is invalid_eligibility_floor');
select throws_ok($$ select public.set_membership_cutoff(null) $$,
  'PT400', 'invalid_membership_cutoff', 'a null Data limită de intrare is invalid_membership_cutoff, before the gate');
select throws_ok($$ select public.set_membership_cutoff((select tomorrow from fx583)) $$,
  'PT400', 'invalid_membership_cutoff',
  'a Data limită de intrare tomorrow (Bucharest) is invalid_membership_cutoff, before the gate');
select throws_ok($$ select public.set_points_start_date(null) $$,
  'PT400', 'invalid_points_start_date', 'a null Data de început a punctajului is invalid_points_start_date, before the gate');
select throws_ok($$ select public.set_points_start_date((select tomorrow from fx583)) $$,
  'PT400', 'invalid_points_start_date',
  'a Data de început a punctajului tomorrow (Bucharest) is invalid_points_start_date, before the gate');
reset role;

-- ==================== 5. The gate ====================

select pg_temp.test_login(pg_temp.u583(1), '{"provider":"email"}'::jsonb);
select throws_ok(c.call, '42501', 'evaluation_settings_manage_forbidden',
  'a claimless session cannot set ' || c.label || ', though its uid is a live BC')
  from cmd583 c order by c.label;
reset role;

select pg_temp.test_login_leadership(pg_temp.u583(3));
select throws_ok(c.call, '42501', 'evaluation_settings_manage_forbidden',
  'a Voluntar cannot set ' || c.label)
  from cmd583 c order by c.label;
reset role;

select pg_temp.test_login_leadership(pg_temp.u583(4));
select throws_ok(c.call, '42501', 'evaluation_settings_manage_forbidden',
  'a BCE cannot set ' || c.label)
  from cmd583 c order by c.label;
reset role;

select pg_temp.test_login_leadership(pg_temp.u583(5));
select throws_ok(c.call, '42501', 'evaluation_settings_manage_forbidden',
  'a deactivated BC''s token cannot set ' || c.label)
  from cmd583 c order by c.label;
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(c.call, '42501', null, 'anon cannot execute the command that sets ' || c.label)
  from cmd583 c order by c.label;
reset role;

select results_eq(
  $$ select (select count(*) from public.evaluation_settings
              where eligibility_floor is not null or membership_cutoff is not null
                 or points_start_date is not null or updated_by is not null),
            (select count(*) from public.promotion_threshold_changes
              where field in ('floor', 'cutoff', 'points_start')) $$,
  $$ values (0::bigint, 0::bigint) $$,
  'every refusal above left the row unset and wrote no log row');

-- ==================== 6. BC and the Moderator write ====================

select pg_temp.test_login_leadership(pg_temp.u583(1));
select is((select (public.set_eligibility_floor(5)).eligibility_floor), 5,
  'BC sets the Prag minim to 5 and the row comes back');
reset role;
select results_eq(
  $$ select eligibility_floor, membership_cutoff, points_start_date, updated_by
       from public.evaluation_settings $$,
  format($$ values (5, null::date, null::date, %L::uuid) $$, pg_temp.u583(1)),
  'the Prag minim is stored, with BC as updated_by');
select results_eq(
  $$ select field, from_value, to_value, from_date, to_date, source, changed_by,
            kind, promotion_rule_id, role_evaluation_id
       from public.promotion_threshold_changes where field = 'floor' $$,
  format($$ values ('floor'::text, null::integer, 5, null::date, null::date, 'manual'::text, %L::uuid,
                   null::text, null::bigint, null::bigint) $$, pg_temp.u583(1)),
  'the first Prag minim writes one floor row: from nothing, to 5, source manual, changed_by BC, no kind, rule or run');

select pg_temp.test_login_leadership(pg_temp.u583(2));
select is((select (public.set_membership_cutoff(date '2026-06-30')).membership_cutoff), date '2026-06-30',
  'the Moderator sets the Data limită de intrare to 30 June 2026 and the row comes back');
reset role;
select results_eq(
  $$ select eligibility_floor, membership_cutoff, points_start_date, updated_by
       from public.evaluation_settings $$,
  format($$ values (5, date '2026-06-30', null::date, %L::uuid) $$, pg_temp.u583(2)),
  'the Data limită de intrare is stored beside the Floor, with the Moderator as updated_by');
select results_eq(
  $$ select field, from_value, to_value, from_date, to_date, source, changed_by,
            kind, promotion_rule_id, role_evaluation_id
       from public.promotion_threshold_changes where field = 'cutoff' $$,
  format($$ values ('cutoff'::text, null::integer, null::integer, null::date, date '2026-06-30',
                   'manual'::text, %L::uuid, null::text, null::bigint, null::bigint) $$, pg_temp.u583(2)),
  'the first Data limită de intrare writes one cutoff row: dates only, from nothing, to 2026-06-30, changed_by the Moderator');

select pg_temp.test_login_leadership(pg_temp.u583(1));
select is((select (public.set_points_start_date(date '2026-07-01')).points_start_date), date '2026-07-01',
  'BC sets the Data de început a punctajului to 1 July 2026 and the row comes back');
reset role;
select results_eq(
  $$ select eligibility_floor, membership_cutoff, points_start_date, updated_by
       from public.evaluation_settings $$,
  format($$ values (5, date '2026-06-30', date '2026-07-01', %L::uuid) $$, pg_temp.u583(1)),
  'the Data de început a punctajului is stored; the other two values stand');
select results_eq(
  $$ select field, from_value, to_value, from_date, to_date, source, changed_by,
            kind, promotion_rule_id, role_evaluation_id
       from public.promotion_threshold_changes where field = 'points_start' $$,
  format($$ values ('points_start'::text, null::integer, null::integer, null::date, date '2026-07-01',
                   'manual'::text, %L::uuid, null::text, null::bigint, null::bigint) $$, pg_temp.u583(1)),
  'the first Data de început a punctajului writes one points_start row: dates only, from nothing, to 2026-07-01');

-- ==================== 7. points_floor() with a value ====================
-- 1 July 2026 is in summer time (UTC+3): Bucharest midnight is 21:00 UTC the
-- day before. 15 January 2026 is in winter time (UTC+2).

select is(private.points_floor(), '2026-06-30 21:00:00+00'::timestamptz,
  'points_floor() is the Bucharest midnight that starts the Points Start Date (summer time)');
set local timezone = 'Pacific/Auckland';
select is(private.points_floor(), '2026-06-30 21:00:00+00'::timestamptz,
  'points_floor() does not depend on the session time zone');
reset timezone;

select pg_temp.test_login_leadership(pg_temp.u583(1));
select lives_ok($$ select public.set_points_start_date(date '2026-01-15') $$,
  'BC moves the Data de început a punctajului earlier, to 15 January 2026');
reset role;
select is(private.points_floor(), '2026-01-14 22:00:00+00'::timestamptz,
  'points_floor() follows the new date, an hour later in winter time (UTC+2)');

-- ==================== 8. The second change of each value ====================

select results_eq(
  $$ select from_date, to_date, source, changed_by from public.promotion_threshold_changes
      where field = 'points_start' order by id desc limit 1 $$,
  format($$ values (date '2026-07-01', date '2026-01-15', 'manual'::text, %L::uuid) $$, pg_temp.u583(1)),
  'the second Data de început a punctajului logs the day before in from_date');

select pg_temp.test_login_leadership(pg_temp.u583(1));
select lives_ok($$ select public.set_eligibility_floor(8) $$, 'BC raises the Prag minim from 5 to 8');
select lives_ok($$ select public.set_membership_cutoff(date '2026-05-31') $$,
  'BC moves the Data limită de intrare back to 31 May 2026');
reset role;
select results_eq(
  $$ select from_value, to_value, from_date, to_date, changed_by from public.promotion_threshold_changes
      where field = 'floor' order by id desc limit 1 $$,
  format($$ values (5, 8, null::date, null::date, %L::uuid) $$, pg_temp.u583(1)),
  'the second Prag minim logs the number before in from_value');
select results_eq(
  $$ select from_value, to_value, from_date, to_date, changed_by from public.promotion_threshold_changes
      where field = 'cutoff' order by id desc limit 1 $$,
  format($$ values (null::integer, null::integer, date '2026-06-30', date '2026-05-31', %L::uuid) $$, pg_temp.u583(1)),
  'the second Data limită de intrare logs the day before in from_date, by the next author');

-- ==================== 9. The boundaries ====================

select pg_temp.test_login_leadership(pg_temp.u583(1));
select lives_ok($$ select public.set_eligibility_floor(1) $$,
  '1 Task Point is the lowest Prag minim BC can set');
select lives_ok($$ select public.set_membership_cutoff((select today from fx583)) $$,
  'today (Bucharest) is not in the future for the Data limită de intrare');
select lives_ok($$ select public.set_points_start_date((select today from fx583)) $$,
  'today (Bucharest) is not in the future for the Data de început a punctajului');
reset role;

-- ==================== 10. PT409 nothing_to_update ====================

select pg_temp.test_login_leadership(pg_temp.u583(1));
select throws_ok($$ select public.set_eligibility_floor(1) $$,
  'PT409', 'nothing_to_update', 'the Prag minim already in force is nothing_to_update');
select throws_ok($$ select public.set_membership_cutoff((select today from fx583)) $$,
  'PT409', 'nothing_to_update', 'the Data limită de intrare already in force is nothing_to_update');
select throws_ok($$ select public.set_points_start_date((select today from fx583)) $$,
  'PT409', 'nothing_to_update', 'the Data de început a punctajului already in force is nothing_to_update');
reset role;
select results_eq(
  $$ select field, count(*) from public.promotion_threshold_changes
      where field in ('floor', 'cutoff', 'points_start') group by field order by field $$,
  $$ values ('cutoff'::text, 3::bigint), ('floor', 3), ('points_start', 3) $$,
  'a refused unchanged value writes no log row: three changes of each value, no more');

select * from finish();
rollback;
