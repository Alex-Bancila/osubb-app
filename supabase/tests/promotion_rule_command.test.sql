-- promotion_rule_command.test.sql -- #935 (amends ruling R28):
-- public.update_promotion_rule(p_rule_id, p_min_tenure_months, p_enabled)
-- over private.update_promotion_rule_impl -- BC or the Moderator sets one
-- Promotion Rule's tenure and on/off flag together, every changed value
-- logged in promotion_threshold_changes (field tenure / enabled, naming the
-- rule); the daily job and a Voluntar Activ Role Evaluation reading the
-- edited values.
--
-- In order: a held-lock probe of (47, 1), first -- before this transaction
-- takes the lock or writes a row the remote session would then wait on
-- (which would make the probe pass without the advisory lock); the
-- functions and their privileges; the values, answered before the gate; the
-- gate (claimless, Voluntar, BCE, deactivated BC, anon); PT404 for an
-- unknown rule; BC's and the Moderator's writes, read back and audited;
-- PT409 nothing_to_update; the log's rule shape; the read below BC; the
-- daily job and a Role Evaluation after a change.
--
-- Fixtures (prefix 93500000-), written as the owner inside this rolled-back
-- transaction. Every live active ladder holder the demo seed brings is
-- deactivated, so the job and each run meet only this suite's Members. Both
-- rules start at the seed: 6 months, on. j3 is the day three months ago on
-- the Bucharest calendar -- short of 6 months, past 2.
--   R1 recrut j3 -- promoted by the daily job once the time rule asks 2
--     months and is on.
--   V1 voluntar j3, 20 Task Points two days ago -- ranked and a Promotion
--     Candidate (threshold 15) once the top_percent rule asks 2 months and
--     is on; not ranked at 6 months.
--
-- Mutation guards (run 2026-09-30 as in-transaction redefinitions of
-- private.update_promotion_rule_impl, reverted after), each turning the
-- named assertion red:
--   * the months bounds narrowed to null only -> "-1 month is
--     invalid_tenure_months" and "121 months is invalid_tenure_months";
--   * the enabled null check dropped -> "a null on/off is
--     invalid_promotion_rule_enabled";
--   * the level-6 gate dropped -> "a BCE cannot edit a Promotion Rule";
--   * require_active_member's refusal no longer mapped (the gate skipped
--     for a claimless caller) -> "a claimless session cannot edit a
--     Promotion Rule";
--   * the not-found check dropped -> "an unknown rule is
--     promotion_rule_not_found";
--   * the nothing_to_update check dropped -> "the values already in force
--     are nothing_to_update";
--   * the tenure audit insert removed -> "BC's tenure change writes one
--     tenure row";
--   * the enabled audit insert removed -> "the Moderator's switch-off writes
--     one enabled row";
--   * the update removed -> "the time rule now asks 2 months" and "the daily
--     job ... promotes R1".
--   (The held-lock probe runs in a remote session, which sees only committed
--   code, so it was not run as a mutation: without the (47, 1) call the
--   remote change meets no held lock and completes, so the probe
--   discriminates.)
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(57);

-- ==================== 1. The lock ====================

select extensions.dblink_connect('pr_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('pr_setup', 'set lock_timeout = ''2s''');
-- #621: committed fixtures from an interrupted run must not hang cleanup.
select extensions.dblink_exec('pr_setup', $$
  delete from public.profiles where id = '93500000-0000-0000-0000-0000000000f1';
  delete from auth.users where id = '93500000-0000-0000-0000-0000000000f1';
  insert into auth.users (id, email) values
    ('93500000-0000-0000-0000-0000000000f1', 'race.bc.935@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('93500000-0000-0000-0000-0000000000f1', 'Race BC 935', 'race.bc.935@test.local', 'bc', 'activ');
$$);

select pg_temp.test_login_leadership('93500000-0000-0000-0000-0000000000f1');

select extensions.dblink_connect('pr_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_connect('pr_retry', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('pr_lock', 'set lock_timeout = ''2s''');
select extensions.dblink_exec('pr_retry', 'set lock_timeout = ''2s''');
select extensions.dblink_exec('pr_lock',
  'begin; do $lock$ begin perform pg_catalog.pg_advisory_xact_lock(47, 1); end $lock$;');
select extensions.dblink_exec('pr_retry', format(
  'begin; set local lock_timeout = ''250ms''; select set_config(''request.jwt.claims'', %L, true); set local role authenticated;',
  current_setting('request.jwt.claims')));
select throws_ok(
  $$ select * from extensions.dblink('pr_retry',
       'select (public.update_promotion_rule((select id from public.promotion_rules where kind = ''time''), 7, true)).id::text')
       as result (id text) $$,
  '55P03', 'canceling statement due to lock timeout',
  'a rule edit waits on the (47, 1) advisory lock a run_role_evaluation call or a threshold or share edit holds');
select extensions.dblink_exec('pr_retry', 'rollback;');
select extensions.dblink_exec('pr_lock', 'rollback;');
select extensions.dblink_disconnect('pr_retry');
select extensions.dblink_disconnect('pr_lock');

select extensions.dblink_exec('pr_setup', $$
  delete from public.profiles where id = '93500000-0000-0000-0000-0000000000f1';
  delete from auth.users where id = '93500000-0000-0000-0000-0000000000f1';
$$);
select extensions.dblink_disconnect('pr_setup');

reset role;
select pg_temp.test_clear_jwt();

-- ==================== 2. The functions and their privileges ====================

select is(
  (select t.typname from pg_proc p join pg_type t on t.oid = p.prorettype
    where p.oid = 'public.update_promotion_rule(bigint, integer, boolean)'::regprocedure),
  'promotion_rules',
  'public.update_promotion_rule(p_rule_id bigint, p_min_tenure_months integer, p_enabled boolean) returns the rule it wrote');

create temp table fns935 (fn text);
insert into fns935 values
  ('public.update_promotion_rule(bigint, integer, boolean)'),
  ('private.update_promotion_rule_impl(bigint, integer, boolean)');

select is(
  (select count(*) from fns935, unnest(array['anon', 'service_role', 'public']) as grantee
    where has_function_privilege(grantee, fn, 'execute')),
  0::bigint,
  'anon, service_role and PUBLIC execute neither the command nor its _impl');
select is(
  (select count(*) from fns935 where has_function_privilege('authenticated', fn, 'execute')),
  2::bigint,
  'authenticated executes the wrapper and its _impl (called as the caller)');
select results_eq(
  $$ select prosecdef from pg_proc
      where oid in ('private.update_promotion_rule_impl(bigint, integer, boolean)'::regprocedure,
                    'public.update_promotion_rule(bigint, integer, boolean)'::regprocedure)
      order by oid::regprocedure::text $$,
  $$ values (true), (false) $$,
  'the _impl is security definer; the wrapper is security invoker');

-- ==================== Fixtures ====================

update public.profiles set status = 'inactiv'
 where status = 'activ'
   and role in ('recrut', 'voluntar', 'activ', 'vot')
   and id::text not like '93500000-%';

update public.promotion_rules set min_tenure_months = 6, enabled = true;
update public.promotion_thresholds set threshold = 15 where kind = 'voluntar_activ';
delete from public.promotion_threshold_changes where promotion_rule_id is not null;

create temp table fx935 as
  select (select id from public.promotion_rules where kind = 'time') as time_rule,
         (select id from public.promotion_rules where kind = 'top_percent') as top_rule,
         ((now() at time zone 'Europe/Bucharest')::date - interval '3 months')::date as j3,
         ((now() at time zone 'Europe/Bucharest')::date - 30) as d_from,
         ((now() at time zone 'Europe/Bucharest')::date - 1)  as d_to;
grant select on fx935 to authenticated;

insert into auth.users (id, email)
select ('93500000-0000-0000-0000-0000000000' || suffix)::uuid, 'm' || suffix || '-935@test.local'
  from unnest(array['01', '02', '03', '04', '05', '11', '21']) as suffix;

insert into public.profiles (id, full_name, email, role, status, joined_at) values
  ('93500000-0000-0000-0000-000000000001', 'BC 935',         'm01-935@test.local', 'bc',        'activ',   '2000-01-01'),
  ('93500000-0000-0000-0000-000000000002', 'Moderator 935',  'm02-935@test.local', 'moderator', 'activ',   '2000-01-01'),
  ('93500000-0000-0000-0000-000000000003', 'BCE 935',        'm03-935@test.local', 'bce',       'activ',   '2000-01-01'),
  ('93500000-0000-0000-0000-000000000004', 'Voluntar 935',   'm04-935@test.local', 'voluntar',  'activ',   (now() at time zone 'Europe/Bucharest')::date),
  ('93500000-0000-0000-0000-000000000005', 'BC inactiv 935', 'm05-935@test.local', 'bc',        'inactiv', '2000-01-01'),
  ('93500000-0000-0000-0000-000000000011', 'Recrut Unu 935', 'm11-935@test.local', 'recrut',    'activ',   (select j3 from fx935)),
  ('93500000-0000-0000-0000-000000000021', 'Voluntar Unu 935', 'm21-935@test.local', 'voluntar', 'activ',  (select j3 from fx935));

insert into public.groups (name, category, min_level) values ('Grup Reguli 935', 'department', 0);

-- V1's 20 Task Points two days ago: difficulty 5 x rating 5 (15), then
-- difficulty 5 x rating 3 (5) -- as role_evaluation_command.test.sql credits.
create function pg_temp.credit935(p_member uuid, p_difficulty int, p_rating int)
returns void language plpgsql as $$
declare
  v_at timestamptz := now() - interval '2 days';
  v_task bigint;
begin
  insert into public.tasks
    (title, description, deadline, group_id, status, difficulty, rating,
     created_by, created_at, completed_at)
  values ('Credit #935 ' || gen_random_uuid(), 'Fixture', v_at,
          (select id from public.groups where name = 'Grup Reguli 935'),
          'completed', p_difficulty, p_rating, '93500000-0000-0000-0000-000000000001',
          v_at - interval '1 day', v_at)
  returning id into v_task;
  insert into public.task_assignments (task_id, member_id, assigned_at, ended_at, end_reason)
  values (v_task, p_member, v_at - interval '1 day', v_at, 'completed');
  perform pg_temp.test_credit_task(v_task, p_member, '93500000-0000-0000-0000-000000000001',
                                   p_awarded_at => v_at);
end $$;

select pg_temp.credit935('93500000-0000-0000-0000-000000000021', 5, 5);
select pg_temp.credit935('93500000-0000-0000-0000-000000000021', 5, 3);

-- ==================== 3. The values, before the gate ====================
-- A claimless session with a live BC's uid: every malformed call is PT400.

select pg_temp.test_login('93500000-0000-0000-0000-000000000001', '{"provider":"email"}'::jsonb);
select throws_ok($$ select public.update_promotion_rule((select time_rule from fx935), null, true) $$,
  'PT400', 'invalid_tenure_months', 'a null tenure is invalid_tenure_months, before the gate');
select throws_ok($$ select public.update_promotion_rule((select time_rule from fx935), -1, true) $$,
  'PT400', 'invalid_tenure_months', '-1 month is invalid_tenure_months, before the gate -- a tenure is at least 0');
select throws_ok($$ select public.update_promotion_rule((select top_rule from fx935), 121, true) $$,
  'PT400', 'invalid_tenure_months', '121 months is invalid_tenure_months, before the gate -- a tenure is at most 120');
select throws_ok($$ select public.update_promotion_rule((select time_rule from fx935), 6, null) $$,
  'PT400', 'invalid_promotion_rule_enabled', 'a null on/off is invalid_promotion_rule_enabled, before the gate');

-- ==================== 4. The gate ====================

select throws_ok($$ select public.update_promotion_rule((select time_rule from fx935), 2, true) $$,
  '42501', 'promotion_rule_manage_forbidden',
  'a claimless session cannot edit a Promotion Rule, though its uid is a live BC');

reset role;
select pg_temp.test_login_leadership('93500000-0000-0000-0000-000000000004');
select throws_ok($$ select public.update_promotion_rule((select time_rule from fx935), 2, true) $$,
  '42501', 'promotion_rule_manage_forbidden', 'a Voluntar cannot edit a Promotion Rule');

reset role;
select pg_temp.test_login_leadership('93500000-0000-0000-0000-000000000003');
select throws_ok($$ select public.update_promotion_rule((select top_rule from fx935), 6, false) $$,
  '42501', 'promotion_rule_manage_forbidden', 'a BCE cannot edit a Promotion Rule');

reset role;
select pg_temp.test_login_leadership('93500000-0000-0000-0000-000000000005');
select throws_ok($$ select public.update_promotion_rule((select time_rule from fx935), 2, true) $$,
  '42501', 'promotion_rule_manage_forbidden', 'a deactivated BC''s token cannot edit a Promotion Rule');

reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select public.update_promotion_rule(1, 2, true) $$,
  '42501', null, 'anon cannot execute update_promotion_rule');
reset role;

-- ==================== 5. An unknown rule ====================

select pg_temp.test_login_leadership('93500000-0000-0000-0000-000000000001');
select throws_ok($$ select public.update_promotion_rule(-1, 2, true) $$,
  'PT404', 'promotion_rule_not_found', 'an unknown rule is promotion_rule_not_found');
select throws_ok($$ select public.update_promotion_rule(null, 2, true) $$,
  'PT404', 'promotion_rule_not_found', 'a null rule id is promotion_rule_not_found');
reset role;

select results_eq(
  $$ select kind, min_tenure_months, enabled from public.promotion_rules order by kind $$,
  $$ values ('time'::text, 6, true), ('top_percent'::text, 6, true) $$,
  'every refusal above left both rules at 6 months, on');
select is(
  (select count(*) from public.promotion_threshold_changes where promotion_rule_id is not null),
  0::bigint, 'every refusal above left the log without a rule row');

-- ==================== 6. BC and the Moderator write ====================

select pg_temp.test_login_leadership('93500000-0000-0000-0000-000000000001');
select results_eq(
  $$ select min_tenure_months, enabled
       from public.update_promotion_rule((select time_rule from fx935), 2, true) $$,
  $$ values (2, true) $$,
  'BC sets the time rule (Recrut -> Voluntar) to 2 months and gets the rule back');
reset role;

select is((select min_tenure_months from public.promotion_rules where kind = 'time'), 2,
  'the time rule now asks 2 months');
select results_eq(
  $$ select kind, field, promotion_rule_id, from_value, to_value, source, changed_by, role_evaluation_id
      from public.promotion_threshold_changes where promotion_rule_id is not null order by id $$,
  $$ select null::text, 'tenure'::text, time_rule, 6, 2, 'manual'::text,
            '93500000-0000-0000-0000-000000000001'::uuid, null::bigint from fx935 $$,
  'BC''s tenure change writes one tenure row: the time rule, from 6, to 2, source manual, changed_by BC, no kind, no run');

select pg_temp.test_login_leadership('93500000-0000-0000-0000-000000000002');
select lives_ok($$ select public.update_promotion_rule((select top_rule from fx935), 6, false) $$,
  'the Moderator switches the top_percent rule (Voluntar -> Voluntar Activ) off');
reset role;

select is((select enabled from public.promotion_rules where kind = 'top_percent'), false,
  'the top_percent rule is off');
select results_eq(
  $$ select field, promotion_rule_id, from_value, to_value, changed_by
      from public.promotion_threshold_changes where promotion_rule_id is not null order by id desc limit 1 $$,
  $$ select 'enabled'::text, top_rule, 1, 0, '93500000-0000-0000-0000-000000000002'::uuid from fx935 $$,
  'the Moderator''s switch-off writes one enabled row: from 1 (on) to 0 (off), changed_by the Moderator');
select is(
  (select count(*) from public.promotion_threshold_changes where promotion_rule_id is not null),
  2::bigint, 'an unchanged tenure beside a flip writes no tenure row');

select pg_temp.test_login_leadership('93500000-0000-0000-0000-000000000001');
select lives_ok($$ select public.update_promotion_rule((select top_rule from fx935), 2, true) $$,
  'BC sets the top_percent rule to 2 months and back on, in one call');
reset role;

select results_eq(
  $$ select field, from_value, to_value from public.promotion_threshold_changes
      where promotion_rule_id = (select top_rule from fx935) order by id $$,
  $$ values ('enabled'::text, 1, 0), ('tenure'::text, 6, 2), ('enabled'::text, 0, 1) $$,
  'changing both values writes two rows, one per value: the tenure 6 -> 2 and on again 0 -> 1');
select results_eq(
  $$ select min_tenure_months, enabled from public.promotion_rules where kind = 'top_percent' $$,
  $$ values (2, true) $$,
  'the top_percent rule asks 2 months and is on');
select is(
  (select threshold from public.promotion_thresholds where kind = 'voluntar_activ'), 15,
  'editing a rule leaves the Voluntar Activ threshold in force as it was');

-- ==================== 7. PT409 nothing_to_update ====================

select pg_temp.test_login_leadership('93500000-0000-0000-0000-000000000001');
select throws_ok($$ select public.update_promotion_rule((select top_rule from fx935), 2, true) $$,
  'PT409', 'nothing_to_update', 'the values already in force are nothing_to_update');
reset role;
select is(
  (select count(*) from public.promotion_threshold_changes where promotion_rule_id is not null),
  4::bigint, 'a refused unchanged edit writes no log row');

-- ==================== 8. The log's rule shape ====================

insert into public.role_evaluations (
  kind, name, period_from, period_to, run_by, threshold_used, threshold_computed, ranked_count
) values (
  'voluntar_activ', 'Evaluare fixture #935', '2026-01-01', '2026-01-31',
  '93500000-0000-0000-0000-000000000001', 15, null, 0
);

select throws_ok(
  $$ insert into public.promotion_threshold_changes (kind, field, promotion_rule_id, from_value, to_value, source, changed_by)
     select 'voluntar_activ', 'tenure', top_rule, 6, 4, 'manual', '93500000-0000-0000-0000-000000000001' from fx935 $$,
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_subject_ck"',
  'promotion_threshold_changes_subject_ck: a rule change names its rule, never a kind');
select throws_ok(
  $$ insert into public.promotion_threshold_changes (kind, field, from_value, to_value, source, changed_by)
     values (null, 'threshold', 15, 20, 'manual', '93500000-0000-0000-0000-000000000001') $$,
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_subject_ck"',
  'promotion_threshold_changes_subject_ck: a threshold change still names its kind');
select throws_ok(
  $$ insert into public.promotion_threshold_changes (field, promotion_rule_id, from_value, to_value, source, changed_by)
     select 'tenure', top_rule, 6, 121, 'manual', '93500000-0000-0000-0000-000000000001' from fx935 $$,
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_tenure_shape_ck"',
  'promotion_threshold_changes_tenure_shape_ck: a tenure above 120 months cannot be logged');
select throws_ok(
  $$ insert into public.promotion_threshold_changes (field, promotion_rule_id, from_value, to_value, source, role_evaluation_id)
     select 'tenure', top_rule, 6, 4, 'role_evaluation',
            (select id from public.role_evaluations where name = 'Evaluare fixture #935') from fx935 $$,
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_tenure_shape_ck"',
  'promotion_threshold_changes_tenure_shape_ck: a Role Evaluation never changes a tenure');
select throws_ok(
  $$ insert into public.promotion_threshold_changes (field, promotion_rule_id, from_value, to_value, source, changed_by)
     select 'enabled', top_rule, 1, 1, 'manual', '93500000-0000-0000-0000-000000000001' from fx935 $$,
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_enabled_shape_ck"',
  'promotion_threshold_changes_enabled_shape_ck: an on/off row is always a flip');
select throws_ok(
  $$ insert into public.promotion_threshold_changes (field, promotion_rule_id, from_value, to_value, source, changed_by)
     select 'enabled', top_rule, 0, 2, 'manual', '93500000-0000-0000-0000-000000000001' from fx935 $$,
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_enabled_shape_ck"',
  'promotion_threshold_changes_enabled_shape_ck: on/off is 0 or 1');
select throws_ok(
  $$ insert into public.promotion_threshold_changes (kind, from_value, to_value, source, changed_by)
     values ('voluntar_activ', 15, 0, 'manual', '93500000-0000-0000-0000-000000000001') $$,
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_to_value_range_ck"',
  'promotion_threshold_changes_to_value_range_ck: a threshold is still at least 1 Task Point');
select lives_ok(
  $$ insert into public.promotion_threshold_changes (field, promotion_rule_id, from_value, to_value, source, changed_by)
     select 'tenure', time_rule, 2, 0, 'manual', '93500000-0000-0000-0000-000000000001' from fx935 $$,
  'a tenure of 0 months can be logged -- the table allows it');

-- ==================== 9. The read below BC ====================

select pg_temp.test_login_leadership('93500000-0000-0000-0000-000000000001');
select is(
  (select count(*) from public.promotion_threshold_changes where promotion_rule_id is not null),
  5::bigint, 'BC reads every rule change in the log');
reset role;
select pg_temp.test_login_leadership('93500000-0000-0000-0000-000000000004');
select is(
  (select count(*) from public.promotion_threshold_changes), 0::bigint,
  'a Voluntar reads no log row -- the log stays level >= 6');
select results_eq(
  $$ select kind, min_tenure_months, enabled from public.promotion_rules order by kind $$,
  $$ values ('time'::text, 2, true), ('top_percent'::text, 2, true) $$,
  'a Voluntar reads both rules as BC left them -- the goals stay visible');
select throws_ok(
  $$ update public.promotion_rules set min_tenure_months = 1 where kind = 'time' $$,
  '42501', 'permission denied for table promotion_rules',
  'nobody writes a rule directly -- update_promotion_rule is the write path');
reset role;
delete from public.promotion_threshold_changes where field = 'tenure' and to_value = 0;

-- ==================== 10. The daily job reads the edited time rule ====================
-- R1 joined three months ago. Off at 2 months: not promoted. On: promoted.

select pg_temp.test_login_leadership('93500000-0000-0000-0000-000000000001');
select lives_ok($$ select public.update_promotion_rule((select time_rule from fx935), 2, false) $$,
  'BC switches the time rule off');
reset role;
select is(private.apply_promotions(), 0,
  'the daily job with the time rule off promotes nobody, though R1 holds the 2 months');
select is(
  (select role::text from public.profiles where id = '93500000-0000-0000-0000-000000000011'), 'recrut',
  'R1 is still a Recrut');

select pg_temp.test_login_leadership('93500000-0000-0000-0000-000000000001');
select lives_ok($$ select public.update_promotion_rule((select time_rule from fx935), 6, true) $$,
  'BC switches the time rule on at 6 months');
reset role;
select is(private.apply_promotions(), 0,
  'the daily job at 6 months promotes nobody: R1 has three months');

select pg_temp.test_login_leadership('93500000-0000-0000-0000-000000000001');
select lives_ok($$ select public.update_promotion_rule((select time_rule from fx935), 2, true) $$,
  'BC lowers the time rule to 2 months');
reset role;
select is(private.apply_promotions(), 1, 'the daily job at 2 months promotes one Member');
select is(
  (select role::text from public.profiles where id = '93500000-0000-0000-0000-000000000011'), 'voluntar',
  'the daily job at 2 months promotes R1 to Voluntar');

-- ==================== 11. A Role Evaluation reads the edited top_percent rule ====================
-- V1 joined three months ago with 20 Task Points (threshold 15).

select pg_temp.test_login_leadership('93500000-0000-0000-0000-000000000001');
select lives_ok($$ select public.update_promotion_rule((select top_rule from fx935), 6, true) $$,
  'BC puts the top_percent rule back at 6 months');
select results_eq(
  $$ select candidates from public.run_role_evaluation('voluntar_activ', (select d_from from fx935),
                                                      (select d_to from fx935), 'Evaluare reguli 6 luni #935') $$,
  $$ values (0) $$,
  'a Voluntar Activ run at 6 months lists no candidate: V1 has three months');
select lives_ok($$ select public.update_promotion_rule((select top_rule from fx935), 2, true) $$,
  'BC lowers the top_percent rule to 2 months');
select results_eq(
  $$ select candidates from public.run_role_evaluation('voluntar_activ', (select d_from from fx935),
                                                      (select d_to from fx935), 'Evaluare reguli 2 luni #935') $$,
  $$ values (1) $$,
  'a Voluntar Activ run at 2 months lists V1 as a Promotion Candidate');
select lives_ok($$ select public.update_promotion_rule((select top_rule from fx935), 2, false) $$,
  'BC switches the top_percent rule off');
select results_eq(
  $$ select candidates from public.run_role_evaluation('voluntar_activ', (select d_from from fx935),
                                                      (select d_to from fx935), 'Evaluare reguli oprită #935') $$,
  $$ values (0) $$,
  'a Voluntar Activ run with the rule off lists no candidate, though V1 holds the tenure and the threshold');
reset role;

select * from finish();
rollback;
