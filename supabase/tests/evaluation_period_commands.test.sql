-- evaluation_period_commands.test.sql -- #701: the two Evaluation Period
-- commands, public.open_evaluation_period(p_name) and
-- public.close_evaluation_period(p_period_id), over their private _impls.
--
-- In order: two concurrent opens (pg_temp.test_race, first -- before this
-- transaction takes the (47, 1) advisory lock or writes a Period, both of
-- which would block the race sessions); the functions and their execute
-- privileges; the name, answered before the gate; the gate, against both
-- commands; a close that ranks somebody (#49's stamp and #52's close-time
-- promotion ran); the close's refusals; an open, a second open, and a close
-- that ranks nobody; apply_close_promotions called exactly once; the
-- transactional proof; an open that waited behind a later close.
--
-- Fixtures, written as the owner inside this rolled-back transaction:
-- Profiles, a Group, completed Tasks and their credits, and P0 -- the one
-- Period that must span Evaluations, so it is opened an hour ago (a command
-- opens at now(), and a Period opened and closed in one transaction ranks
-- nobody). The seeded demo Evaluations are all dated a day or more before the
-- reset, so nothing but this suite's credit falls inside P0. Every live
-- active ladder holder the demo seed brings is deactivated first, so #52's
-- close-time run meets only this suite's Members. The race's BC and Period
-- are committed through a setup connection and deleted after it.
--
-- Mutation guards, each named against the assertion that turns red (run on
-- 2026-09-25 against the live database, each reverted after):
--   * the apply_close_promotions call removed -> "the close ran #52's
--     close-time promotion ...";
--   * the stamp_closing_threshold call removed -> "the close stamped
--     closing_threshold through #49 ...";
--   * the advisory lock removed, or the open check removed -> "two
--     concurrent opens: the second waits and answers period_already_open";
--   * the level-6 gate dropped -> "a BCE cannot open a Period" and "a BCE
--     cannot close a Period";
--   * require_active_member() replaced with caller_level() -> "a claimless
--     session cannot open a Period" and "... close a Period";
--   * the greatest() of the open dropped -> "an open that waited behind a
--     later close opens at that close".
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(40);

-- ==================== 1. Two concurrent opens ====================
-- A opens and holds (47, 1) until it commits; B waits on the lock, then sees
-- A's Period and answers period_already_open. Without the lock B reads no
-- open Period, inserts, and meets A's row in evaluation_periods_open_uidx
-- (23505); without the open check it does the same after the lock.

select extensions.dblink_connect('period_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
-- #621: committed fixtures from an interrupted run must not hang cleanup.
select extensions.dblink_exec('period_setup', 'set lock_timeout = ''2s''');
select extensions.dblink_exec('period_setup', $$
  delete from public.evaluation_periods where opened_by = '70100000-0000-0000-0000-0000000000f1';
  delete from public.profiles where id = '70100000-0000-0000-0000-0000000000f1';
  delete from auth.users where id = '70100000-0000-0000-0000-0000000000f1';
  insert into auth.users (id, email) values
    ('70100000-0000-0000-0000-0000000000f1', 'race.bc.701@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('70100000-0000-0000-0000-0000000000f1', 'Race BC 701', 'race.bc.701@test.local', 'bc', 'activ');
$$);

reset role;
select pg_temp.test_login_leadership('70100000-0000-0000-0000-0000000000f1');
reset role;

select throws_ok($outer$
  select * from pg_temp.test_race(
    $$ select public.open_evaluation_period('Perioada concurentă #701')::text $$,
    $$ select public.open_evaluation_period('Perioada concurentă #701')::text $$
  )
$outer$, 'PT409', 'period_already_open',
  'two concurrent opens: the second waits and answers period_already_open, not a raw unique violation');

select is((select period_count from extensions.dblink('period_setup', $$
  select count(*) from public.evaluation_periods where opened_by = '70100000-0000-0000-0000-0000000000f1'
$$) as result (period_count bigint)), 1::bigint,
  'two concurrent opens commit exactly one Period');

select extensions.dblink_exec('period_setup', $$
  delete from public.evaluation_periods where opened_by = '70100000-0000-0000-0000-0000000000f1';
  delete from public.profiles where id = '70100000-0000-0000-0000-0000000000f1';
  delete from auth.users where id = '70100000-0000-0000-0000-0000000000f1';
$$);
select extensions.dblink_disconnect('period_setup');
select pg_temp.test_clear_jwt();

-- ==================== 2. The functions and their privileges ====================

select function_returns('public', 'open_evaluation_period', array['text'], 'bigint',
  'public.open_evaluation_period(p_name text) returns the new Period''s id');
select function_returns('public', 'close_evaluation_period', array['bigint'], 'void',
  'public.close_evaluation_period(p_period_id bigint) returns nothing');

create temp table fns701 (fn text);
insert into fns701 values
  ('public.open_evaluation_period(text)'),
  ('public.close_evaluation_period(bigint)'),
  ('private.open_evaluation_period_impl(text)'),
  ('private.close_evaluation_period_impl(bigint)');

select is(
  (select count(*) from fns701, unnest(array['anon', 'service_role', 'public']) as grantee
    where has_function_privilege(grantee, fn, 'execute')),
  0::bigint,
  'anon, service_role and PUBLIC execute none of the two wrappers and their _impls');
select is(
  (select count(*) from fns701 where has_function_privilege('authenticated', fn, 'execute')),
  4::bigint,
  'authenticated executes both wrappers and both _impls (the invoker wrapper calls the _impl as the caller)');

-- ==================== Fixtures ====================

update public.profiles set status = 'inactiv'
 where status = 'activ'
   and role in ('recrut', 'voluntar', 'activ', 'vot')
   and id::text not like '70100000-%';

update public.promotion_rules set min_tenure_months = 6, enabled = true;

insert into auth.users (id, email)
select ('70100000-0000-0000-0000-0000000000' || suffix)::uuid, 'm' || suffix || '-701@test.local'
  from unnest(array['01', '02', '03', '04', '05', '11']) as suffix;

insert into public.profiles (id, full_name, email, role, status, joined_at) values
  ('70100000-0000-0000-0000-000000000001', 'BC 701',        'm01-701@test.local', 'bc',        'activ',   '2000-01-01'),
  ('70100000-0000-0000-0000-000000000002', 'Moderator 701', 'm02-701@test.local', 'moderator', 'activ',   '2000-01-01'),
  ('70100000-0000-0000-0000-000000000003', 'BCE 701',       'm03-701@test.local', 'bce',       'activ',   '2000-01-01'),
  ('70100000-0000-0000-0000-000000000004', 'Voluntar 701',  'm04-701@test.local', 'voluntar',  'activ',   (now() at time zone 'Europe/Bucharest')::date),
  ('70100000-0000-0000-0000-000000000005', 'BC inactiv 701','m05-701@test.local', 'bc',        'inactiv', '2000-01-01'),
  ('70100000-0000-0000-0000-000000000011', 'Top 701',       'm11-701@test.local', 'voluntar',  'activ',   '2000-01-01');

insert into public.groups (name, category, min_level) values ('Grup Perioade 701', 'department', 0);

-- P0: opened an hour ago, so the close's [opened_at, now()) spans the credit.
insert into public.evaluation_periods (name, opened_at, opened_by)
values ('Perioada de clasament #701', now() - interval '1 hour', '70100000-0000-0000-0000-000000000001');

-- Top 701: difficulty 5, rating 5 -> 15 Task Points inside P0, the only
-- Member ranked, so share ceil(30% x 1) = 1 and the threshold is 15.
insert into public.tasks
  (title, description, deadline, group_id, status, difficulty, rating,
   created_by, created_at, completed_at)
values ('Credit #701', 'Fixture', now() - interval '2 days',
        (select id from public.groups where name = 'Grup Perioade 701'),
        'completed', 5, 5, '70100000-0000-0000-0000-000000000001',
        now() - interval '3 days', now());
select pg_temp.test_credit_task(
  (select id from public.tasks where title = 'Credit #701'),
  '70100000-0000-0000-0000-000000000011', '70100000-0000-0000-0000-000000000001',
  p_awarded_at => now() - interval '30 minutes');

create temp table fx701 as
  select (select id from public.evaluation_periods where name = 'Perioada de clasament #701') as p0,
         (select coalesce(max(id), 0) + 1000 from public.evaluation_periods)                as unknown;
grant select on fx701 to authenticated;

-- ==================== 3. The name, before the gate ====================
-- A claimless session: every malformed name is answered PT400, not 42501.

select pg_temp.test_login('70100000-0000-0000-0000-000000000001', '{"provider":"email"}'::jsonb);
select throws_ok($$ select public.open_evaluation_period(null) $$,
  'PT400', 'invalid_period_name', 'a null name is invalid_period_name, before the gate');
select throws_ok($$ select public.open_evaluation_period(E'  \t ') $$,
  'PT400', 'invalid_period_name', 'a blank name is invalid_period_name, before the gate');
select throws_ok($$ select public.open_evaluation_period('ab') $$,
  'PT400', 'name_too_short', 'a two-character name is name_too_short, before the gate');
select throws_ok($$ select public.open_evaluation_period(E'  ab\t') $$,
  'PT400', 'name_too_short', 'the name is measured trimmed of every whitespace character');
select throws_ok($$ select public.open_evaluation_period(repeat('p', 121)) $$,
  'PT400', 'name_too_long', 'a 121-character name is name_too_long, before the gate');

-- ==================== 4. The gate ====================

-- Open: P0 is open, so a caller past the gate would hear period_already_open.
select throws_ok($$ select public.open_evaluation_period('Perioada claimless #701') $$,
  '42501', 'period_manage_forbidden',
  'a claimless session cannot open a Period, though its uid is a live BC');
select throws_ok(format($$ select public.close_evaluation_period(%s) $$, (select p0 from fx701)),
  '42501', 'period_manage_forbidden',
  'a claimless session cannot close a Period, though its uid is a live BC');

reset role;
select pg_temp.test_login_leadership('70100000-0000-0000-0000-000000000004');
select throws_ok($$ select public.open_evaluation_period('Perioada Voluntar #701') $$,
  '42501', 'period_manage_forbidden', 'a Voluntar cannot open a Period');
select throws_ok(format($$ select public.close_evaluation_period(%s) $$, (select p0 from fx701)),
  '42501', 'period_manage_forbidden', 'a Voluntar cannot close a Period');

reset role;
select pg_temp.test_login_leadership('70100000-0000-0000-0000-000000000003');
select throws_ok($$ select public.open_evaluation_period('Perioada BCE #701') $$,
  '42501', 'period_manage_forbidden', 'a BCE cannot open a Period');
select throws_ok(format($$ select public.close_evaluation_period(%s) $$, (select p0 from fx701)),
  '42501', 'period_manage_forbidden', 'a BCE cannot close a Period');

-- A deactivated BC's still-valid token: claims, but no live activ Profile.
reset role;
select pg_temp.test_login_leadership('70100000-0000-0000-0000-000000000005');
select throws_ok($$ select public.open_evaluation_period('Perioada inactiv #701') $$,
  '42501', 'period_manage_forbidden', 'a deactivated BC''s token cannot open a Period');
select throws_ok(format($$ select public.close_evaluation_period(%s) $$, (select p0 from fx701)),
  '42501', 'period_manage_forbidden', 'a deactivated BC''s token cannot close a Period');

reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select public.open_evaluation_period('Perioada anon #701') $$,
  '42501', null, 'anon cannot execute open_evaluation_period');
select throws_ok($$ select public.close_evaluation_period(1) $$,
  '42501', null, 'anon cannot execute close_evaluation_period');
reset role;

select is((select count(*) from public.evaluation_periods where closed_at is null), 1::bigint,
  'every refusal left P0 the one open Period, and opened nothing');

-- ==================== 5. BC closes a Period that ranked somebody ====================

reset role;
select pg_temp.test_login_leadership('70100000-0000-0000-0000-000000000001');
select lives_ok(format($$ select public.close_evaluation_period(%s) $$, (select p0 from fx701)),
  'BC closes the open Period');
reset role;

select results_eq(
  format($$ select closed_at = now(), closed_by from public.evaluation_periods where id = %s $$,
         (select p0 from fx701)),
  $$ values (true, '70100000-0000-0000-0000-000000000001'::uuid) $$,
  'the close stamped closed_at (now()) and closed_by (the actor)');
select is(
  (select closing_threshold from public.evaluation_periods where id = (select p0 from fx701)),
  15,
  'the close stamped closing_threshold through #49 -- the Task Points of the last Member inside the top 30%');
select results_eq(
  $$ select profile.role::text,
            (select count(*) from public.role_history as history
              where history.member_id = profile.id and history.to_role = 'activ'
                and history.actor_kind = 'automatic' and history.changed_by is null)
       from public.profiles as profile
      where profile.id = '70100000-0000-0000-0000-000000000011' $$,
  $$ values ('activ', 1::bigint) $$,
  'the close ran #52''s close-time promotion -- the tenured Voluntar in the top 30% is Voluntar Activ, one automatic role_history row');

-- ==================== 6. The close's refusals ====================

reset role;
select pg_temp.test_login_leadership('70100000-0000-0000-0000-000000000001');
select throws_ok(format($$ select public.close_evaluation_period(%s) $$, (select p0 from fx701)),
  'PT409', 'period_already_closed', 'closing a closed Period is period_already_closed');
select throws_ok(format($$ select public.close_evaluation_period(%s) $$, (select unknown from fx701)),
  'PT404', 'period_not_found', 'closing an unknown id is period_not_found');

-- ==================== 7. Open, a second open, a close that ranks nobody ====================

reset role;
create temp table notifications_before701 as select count(*) as n from public.notifications;
grant select on notifications_before701 to authenticated;
create temp table p1_701 (id bigint);
grant insert, select on p1_701 to authenticated;

reset role;
select pg_temp.test_login_leadership('70100000-0000-0000-0000-000000000001');
select lives_ok($$ insert into p1_701 select public.open_evaluation_period(E'  Perioada de toamnă #701\t') $$,
  'BC opens a Period');
reset role;

select results_eq(
  $$ select period.name, period.opened_at = now(), period.opened_by,
            period.closed_at, period.closed_by, period.closing_threshold
       from public.evaluation_periods as period
      where period.id = (select id from p1_701) $$,
  $$ values ('Perioada de toamnă #701', true, '70100000-0000-0000-0000-000000000001'::uuid,
             null::timestamptz, null::uuid, null::integer) $$,
  'the open returned the new id; the row carries the trimmed name, opened_at now(), opened_by the actor, and nothing closed');
select is((select count(*) from public.notifications), (select n from notifications_before701),
  'the open sends no Notification');

reset role;
select pg_temp.test_login_leadership('70100000-0000-0000-0000-000000000002');
select throws_ok($$ select public.open_evaluation_period('Perioada a doua #701') $$,
  'PT409', 'period_already_open', 'the Moderator passes the gate, and a second open while one is open is period_already_open');

-- P1 opened at now(): [now(), now()) is empty and ranks nobody.
select lives_ok(format($$ select public.close_evaluation_period(%s) $$, (select id from p1_701)),
  'the Moderator closes a Period that ranked nobody, without an error');
reset role;

select results_eq(
  $$ select period.closed_at = now(), period.closed_by, period.closing_threshold
       from public.evaluation_periods as period
      where period.id = (select id from p1_701) $$,
  $$ values (true, '70100000-0000-0000-0000-000000000002'::uuid, null::integer) $$,
  'a Period that ranked nobody closes with closing_threshold left null (the threshold in force carries over)');

-- ==================== 8. apply_close_promotions, exactly once ====================
-- The owner replaces #52's run with a body that only counts its calls; the
-- replacement is undone by this suite's rollback.

create temp table close_calls701 (period_id bigint);
create or replace function private.apply_close_promotions(
  p_period_id bigint, out promotions integer, out retention_signals integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into pg_temp.close_calls701 values (p_period_id);
  promotions := 0;
  retention_signals := 0;
end;
$$;

create temp table p2_701 (id bigint);
grant insert, select on p2_701 to authenticated;
reset role;
select pg_temp.test_login_leadership('70100000-0000-0000-0000-000000000001');
insert into p2_701 select public.open_evaluation_period(repeat('q', 120));
select lives_ok(format($$ select public.close_evaluation_period(%s) $$, (select id from p2_701)),
  'a 120-character name opens, and BC closes that Period');
reset role;

select results_eq(
  $$ select period_id, count(*) from close_calls701 group by period_id $$,
  $$ select id, 1::bigint from p2_701 $$,
  'the close called private.apply_close_promotions exactly once, with its own Period');

-- ==================== 9. The transactional proof ====================
-- #52's run now raises: the close must roll back whole, never half-closed.

create or replace function private.apply_close_promotions(
  p_period_id bigint, out promotions integer, out retention_signals integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'apply_close_promotions_failed_701';
end;
$$;

create temp table p3_701 (id bigint);
grant insert, select on p3_701 to authenticated;
reset role;
select pg_temp.test_login_leadership('70100000-0000-0000-0000-000000000001');
insert into p3_701 select public.open_evaluation_period('Perioada eșuată #701');
select throws_ok(format($$ select public.close_evaluation_period(%s) $$, (select id from p3_701)),
  'P0001', 'apply_close_promotions_failed_701',
  'an error inside #52''s run is the close''s error');
reset role;

select results_eq(
  $$ select period.closed_at, period.closed_by, period.closing_threshold
       from public.evaluation_periods as period
      where period.id = (select id from p3_701) $$,
  $$ values (null::timestamptz, null::uuid, null::integer) $$,
  'the failed close rolled back whole: the Period stays open, closed_at and closed_by null, no threshold');

-- ==================== 10. An open that waited behind a later close ====================
-- Owner fixture: P3 closed at an instant after this transaction's now(), as a
-- close that committed while an open waited on (47, 1) would be.

update public.evaluation_periods
   set closed_at = now() + interval '1 minute',
       closed_by = '70100000-0000-0000-0000-000000000001'
 where id = (select id from p3_701);

create temp table p4_701 (id bigint);
grant insert, select on p4_701 to authenticated;
reset role;
select pg_temp.test_login_leadership('70100000-0000-0000-0000-000000000001');
select lives_ok($$ insert into p4_701 select public.open_evaluation_period('Perioada următoare #701') $$,
  'an open that waited behind a later close is not refused by the no-overlap rule');
reset role;

select is(
  (select opened_at from public.evaluation_periods where id = (select id from p4_701)),
  now() + interval '1 minute',
  'an open that waited behind a later close opens at that close -- adjacent, never overlapping');

select * from finish();
rollback;
