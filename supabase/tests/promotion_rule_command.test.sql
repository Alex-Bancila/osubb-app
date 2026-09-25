-- promotion_rule_command.test.sql -- #702: public.set_promotion_rule(p_rule_id,
-- p_initial_threshold) over private.set_promotion_rule_impl -- BC seeds the
-- initial Promotion Threshold before the first Evaluation Period closes.
--
-- In order: the functions and their execute privileges; the value, answered
-- before the gate; the gate (claimless, Voluntar, BCE, deactivated BC, anon);
-- BC's and the Moderator's writes before any close, read back through
-- public.promotion_threshold_in_force(); the refusals under the lock (unknown
-- id, the time rule, an unchanged value); and, once a Period is planted
-- closed, the refusal of every write.
--
-- Fixtures, written as the owner inside this rolled-back transaction: the
-- personas, and -- in section 6 -- one closed Period. The demo seed opens no
-- Period; the suite deletes any the database carries first, so "before the
-- first close" holds whatever ran before it.
--
-- Mutation guards, each named against the assertion that turns red (run on
-- 2026-09-25 against the live database, each reverted after):
--   * the closed-Period check removed -> "once a Period has closed, BC's
--     write is promotion_threshold_already_stamped";
--   * the kind check removed -> "the time rule is
--     promotion_rule_not_top_percent";
--   * the level-6 gate dropped -> "a BCE cannot set the initial threshold".
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(32);

-- ==================== 1. The functions and their privileges ====================

select function_returns('public', 'set_promotion_rule', array['bigint', 'integer'], 'void',
  'public.set_promotion_rule(p_rule_id bigint, p_initial_threshold integer) returns nothing');

create temp table fns702 (fn text);
insert into fns702 values
  ('public.set_promotion_rule(bigint, integer)'),
  ('private.set_promotion_rule_impl(bigint, integer)');

select is(
  (select count(*) from fns702, unnest(array['anon', 'service_role', 'public']) as grantee
    where has_function_privilege(grantee, fn, 'execute')),
  0::bigint,
  'anon, service_role and PUBLIC execute neither the wrapper nor its _impl');
select is(
  (select count(*) from fns702 where has_function_privilege('authenticated', fn, 'execute')),
  2::bigint,
  'authenticated executes the wrapper and the _impl (the invoker wrapper calls the _impl as the caller)');
select is(
  (select prosecdef from pg_proc where oid = 'private.set_promotion_rule_impl(bigint, integer)'::regprocedure),
  true, 'the _impl is security definer');
select is(
  (select prosecdef from pg_proc where oid = 'public.set_promotion_rule(bigint, integer)'::regprocedure),
  false, 'the wrapper is security invoker');

-- ==================== Fixtures ====================

delete from public.evaluation_periods;

insert into auth.users (id, email)
select ('70200000-0000-0000-0000-0000000000' || suffix)::uuid, 'm' || suffix || '-702@test.local'
  from unnest(array['01', '02', '03', '04', '05']) as suffix;

insert into public.profiles (id, full_name, email, role, status) values
  ('70200000-0000-0000-0000-000000000001', 'BC 702',         'm01-702@test.local', 'bc',        'activ'),
  ('70200000-0000-0000-0000-000000000002', 'Moderator 702',  'm02-702@test.local', 'moderator', 'activ'),
  ('70200000-0000-0000-0000-000000000003', 'BCE 702',        'm03-702@test.local', 'bce',       'activ'),
  ('70200000-0000-0000-0000-000000000004', 'Voluntar 702',   'm04-702@test.local', 'voluntar',  'activ'),
  ('70200000-0000-0000-0000-000000000005', 'BC inactiv 702', 'm05-702@test.local', 'bc',        'inactiv');

create temp table fx702 as
  select (select id from public.promotion_rules where kind = 'top_percent') as top_rule,
         (select id from public.promotion_rules where kind = 'time')        as time_rule,
         (select max(id) + 1000 from public.promotion_rules)               as unknown_rule,
         (select initial_threshold from public.promotion_rules where kind = 'top_percent') as seeded;
grant select on fx702 to authenticated;

create temp table rule_before702 as
  select id, kind, percent, min_tenure_months, enabled, initial_threshold, updated_at
    from public.promotion_rules;

-- ==================== 2. The value, before the gate ====================
-- A claimless session with a live BC's uid: every malformed value is PT400.

select pg_temp.test_login('70200000-0000-0000-0000-000000000001', '{"provider":"email"}'::jsonb);
select throws_ok(format($$ select public.set_promotion_rule(%s, null) $$, (select top_rule from fx702)),
  'PT400', 'invalid_initial_threshold', 'a null threshold is invalid_initial_threshold, before the gate');
select throws_ok(format($$ select public.set_promotion_rule(%s, -5) $$, (select top_rule from fx702)),
  'PT400', 'invalid_initial_threshold', 'a negative threshold is invalid_initial_threshold, before the gate');
select throws_ok(format($$ select public.set_promotion_rule(%s, 0) $$, (select top_rule from fx702)),
  'PT400', 'invalid_initial_threshold',
  'zero is invalid_initial_threshold too -- promotion_rules_initial_threshold_range_ck forbids it for every caller');

-- ==================== 3. The gate ====================

select throws_ok(format($$ select public.set_promotion_rule(%s, 40) $$, (select top_rule from fx702)),
  '42501', 'promotion_rule_manage_forbidden',
  'a claimless session cannot set the initial threshold, though its uid is a live BC');

reset role;
select pg_temp.test_login_leadership('70200000-0000-0000-0000-000000000004');
select throws_ok(format($$ select public.set_promotion_rule(%s, 40) $$, (select top_rule from fx702)),
  '42501', 'promotion_rule_manage_forbidden', 'a Voluntar cannot set the initial threshold');

reset role;
select pg_temp.test_login_leadership('70200000-0000-0000-0000-000000000003');
select throws_ok(format($$ select public.set_promotion_rule(%s, 40) $$, (select top_rule from fx702)),
  '42501', 'promotion_rule_manage_forbidden', 'a BCE cannot set the initial threshold');
select throws_ok(format($$ select public.set_promotion_rule(%s, 40) $$, (select unknown_rule from fx702)),
  '42501', 'promotion_rule_manage_forbidden',
  'a BCE hears the gate before the lookup, so an unknown id is not probed');

reset role;
select pg_temp.test_login_leadership('70200000-0000-0000-0000-000000000005');
select throws_ok(format($$ select public.set_promotion_rule(%s, 40) $$, (select top_rule from fx702)),
  '42501', 'promotion_rule_manage_forbidden', 'a deactivated BC''s token cannot set the initial threshold');

reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select public.set_promotion_rule(1, 40) $$,
  '42501', null, 'anon cannot execute set_promotion_rule');
reset role;

select results_eq(
  $$ select id, kind, percent, min_tenure_months, enabled, initial_threshold, updated_at
       from public.promotion_rules order by id $$,
  $$ select id, kind, percent, min_tenure_months, enabled, initial_threshold, updated_at
       from rule_before702 order by id $$,
  'every refusal left both rules exactly as they were');

-- ==================== 4. BC and the Moderator write before any close ====================

select pg_temp.test_login_leadership('70200000-0000-0000-0000-000000000001');
select is(public.promotion_threshold_in_force(), (select seeded from fx702),
  'before any close, the threshold in force is the seeded initial threshold');
select lives_ok(format($$ select public.set_promotion_rule(%s, 40) $$, (select top_rule from fx702)),
  'BC sets the initial threshold to 40');
select is(public.promotion_threshold_in_force(), 40,
  'the write changes promotion_threshold_in_force() before the first close');
reset role;

select results_eq(
  $$ select rule.percent, rule.min_tenure_months, rule.enabled, rule.updated_at > before.updated_at
       from public.promotion_rules as rule join rule_before702 as before using (id) where rule.kind = 'top_percent' $$,
  $$ select before.percent, before.min_tenure_months, before.enabled, true
       from rule_before702 as before where before.kind = 'top_percent' $$,
  'the write touched initial_threshold alone -- percent, tenure and enabled unchanged -- and moved updated_at');
select results_eq(
  $$ select initial_threshold, percent, min_tenure_months, enabled, updated_at
       from public.promotion_rules where kind = 'time' $$,
  $$ select initial_threshold, percent, min_tenure_months, enabled, updated_at
       from rule_before702 where kind = 'time' $$,
  'the time rule is untouched');

select pg_temp.test_login_leadership('70200000-0000-0000-0000-000000000002');
select lives_ok(format($$ select public.set_promotion_rule(%s, 45) $$, (select top_rule from fx702)),
  'the Moderator sets the initial threshold to 45');
select is(public.promotion_threshold_in_force(), 45,
  'the Moderator''s write is the threshold in force');
reset role;

-- ==================== 5. The refusals under the lock ====================

select pg_temp.test_login_leadership('70200000-0000-0000-0000-000000000001');
select throws_ok(format($$ select public.set_promotion_rule(%s, 40) $$, (select unknown_rule from fx702)),
  'PT404', 'promotion_rule_not_found', 'an unknown rule id is promotion_rule_not_found');
select throws_ok(format($$ select public.set_promotion_rule(%s, 40) $$, (select time_rule from fx702)),
  'PT409', 'promotion_rule_not_top_percent', 'the time rule is promotion_rule_not_top_percent');
select throws_ok(format($$ select public.set_promotion_rule(%s, 45) $$, (select top_rule from fx702)),
  'PT409', 'nothing_to_update', 'the value already stored is nothing_to_update');
reset role;

select is((select initial_threshold from public.promotion_rules where kind = 'time'), null::int,
  'the refused time-rule write left it without a threshold');

-- ==================== 6. After the first close ====================
-- A Period planted closed, carrying a stamp: the threshold in force is now its
-- closing_threshold and the initial value is inert.

insert into public.evaluation_periods (name, opened_at, opened_by, closed_at, closed_by, closing_threshold)
values ('Perioada închisă #702', now() - interval '30 days', '70200000-0000-0000-0000-000000000001',
        now() - interval '1 day', '70200000-0000-0000-0000-000000000001', 18);

select pg_temp.test_login_leadership('70200000-0000-0000-0000-000000000001');
select is(public.promotion_threshold_in_force(), 18,
  'after the first close, the threshold in force is the close''s stamp, not the initial threshold');
select throws_ok(format($$ select public.set_promotion_rule(%s, 50) $$, (select top_rule from fx702)),
  'PT409', 'promotion_threshold_already_stamped',
  'once a Period has closed, BC''s write is promotion_threshold_already_stamped');
reset role;
select pg_temp.test_login_leadership('70200000-0000-0000-0000-000000000002');
select throws_ok(format($$ select public.set_promotion_rule(%s, 50) $$, (select top_rule from fx702)),
  'PT409', 'promotion_threshold_already_stamped',
  'once a Period has closed, the Moderator''s write is promotion_threshold_already_stamped');
reset role;

-- A close that ranked nobody left no stamp; it is still a close.
update public.evaluation_periods set closing_threshold = null where name = 'Perioada închisă #702';
select pg_temp.test_login_leadership('70200000-0000-0000-0000-000000000001');
select throws_ok(format($$ select public.set_promotion_rule(%s, 50) $$, (select top_rule from fx702)),
  'PT409', 'promotion_threshold_already_stamped',
  'a closed Period without a stamp still ends the seeding window');
select throws_ok(format($$ select public.set_promotion_rule(%s, 50) $$, (select time_rule from fx702)),
  'PT409', 'promotion_rule_not_top_percent',
  'the kind is judged before the close: the time rule is still promotion_rule_not_top_percent');
reset role;

select is((select initial_threshold from public.promotion_rules where kind = 'top_percent'), 45,
  'every write after the close was refused: the initial threshold is still the Moderator''s 45');

select * from finish();
rollback;
