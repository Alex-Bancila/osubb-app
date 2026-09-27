-- detect_promotions.test.sql -- #826 (ruling R28): private.detect_promotions(),
-- trimmed to the tenure rule alone.
--
-- private.detect_promotions() -- the daily job's only source now: every
-- live active Member holding the `time` Promotion Rule's from_role whose
-- joined_at + min_tenure_months falls on or before today's Europe/Bucharest
-- date. Recrut -> Voluntar stays automatic; Voluntar -> Voluntar Activ never
-- is (ruling R28 decision 4) -- a tenured Voluntar's Task Points, however
-- high, never make private.detect_promotions() return a top_percent row.
-- That branch, the Evaluation Period close and the Retention Signals move to
-- public.run_role_evaluation (#826); private.detect_close_promotions and
-- private.detect_retention_signals do not exist any more.
--
-- In order: shape, grants and the retired functions; the tenure rule; a
-- disabled time rule; idempotence.
--
-- Fixtures, written as the owner inside this rolled-back transaction. Every
-- live active ladder holder the demo seed brings is deactivated first, so
-- every result set is exactly this suite's Members. The time rule is pinned
-- to 6 months of tenure (seed). j_over is the latest join date that holds 6
-- months today on the Bucharest calendar, j_under the day after it.
--   N1 recrut j_over -> detected (time); N2 recrut j_under -> not detected;
--   N3 recrut joined today -> not detected; N4 recrut, deactivated, j_over
--   -> not detected (status filter); N5 voluntar j_over with 45 Task Points,
--   well above the seeded Voluntar Activ threshold (30) -> never detected:
--   private.detect_promotions() carries no top_percent branch to detect it
--   with.
--
-- Mutation guards, each named against the assertion that turns red (run
-- 2026-09-27 against the live database, reverted after):
--   * `<=` -> `<` in the tenure comparison -> "tenure boundary today";
--   * `status = 'activ'` dropped -> "a deactivated tenured Recrut is not
--     detected";
--   * a top_percent branch added back (a scratch copy unions in N5 as
--     kind top_percent) -> "kind top_percent is never returned, however
--     high a tenured Voluntar's Task Points" goes red, proving the assertion
--     is not vacuous.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- ==================== Fixtures ====================

update public.profiles set status = 'inactiv'
 where status = 'activ'
   and role in ('recrut', 'voluntar', 'activ', 'vot')
   and id::text not like '51000000-%';

update public.promotion_rules set min_tenure_months = 6, enabled = true;

create temp table tenure51 as
  with today as (select (now() at time zone 'Europe/Bucharest')::date as on_date)
  select today.on_date,
         (select min(day)::date
            from generate_series(today.on_date - interval '7 months', today.on_date::timestamp, interval '1 day') as day
           where (day::date + interval '6 months')::date > today.on_date) as j_under
    from today;
alter table tenure51 add column j_over date;
update tenure51 set j_over = j_under - 1;

insert into auth.users (id, email)
select ('51000000-0000-0000-0000-0000000000' || suffix)::uuid, 'm' || suffix || '-51@test.local'
  from unnest(array['01', '51', '52', '53', '54', '55']) as suffix;

insert into public.profiles (id, full_name, email, role, status, joined_at)
select member.id::uuid, member.full_name, member.email, member.role::public.member_role,
       member.status::public.member_status, member.joined_at
  from tenure51,
       lateral (values
         ('51000000-0000-0000-0000-000000000001', 'BC 51', 'm01-51@test.local', 'bc',       'activ',   '2000-01-01'::date),
         ('51000000-0000-0000-0000-000000000051', 'N1 51', 'm51-51@test.local', 'recrut',   'activ',   tenure51.j_over),
         ('51000000-0000-0000-0000-000000000052', 'N2 51', 'm52-51@test.local', 'recrut',   'activ',   tenure51.j_under),
         ('51000000-0000-0000-0000-000000000053', 'N3 51', 'm53-51@test.local', 'recrut',   'activ',   tenure51.on_date),
         ('51000000-0000-0000-0000-000000000054', 'N4 51', 'm54-51@test.local', 'recrut',   'inactiv', tenure51.j_over),
         ('51000000-0000-0000-0000-000000000055', 'N5 51', 'm55-51@test.local', 'voluntar', 'activ',   tenure51.j_over)
       ) as member (id, full_name, email, role, status, joined_at);

insert into public.groups (name, category, min_level) values ('Grup Promovări 51', 'department', 0);

-- N5's Task Points: three completed Tasks at the maximum credit (5 x rating
-- 5 -> x3 = 15 each), 45 total -- comfortably above the seeded Voluntar
-- Activ threshold (30), which private.detect_promotions() never reads.
insert into public.tasks
  (title, description, deadline, group_id, status, difficulty, rating,
   created_by, created_at, completed_at)
select title, 'Fixture', now() - interval '2 days',
       (select id from public.groups where name = 'Grup Promovări 51'),
       'completed', 5, 5, '51000000-0000-0000-0000-000000000001',
       now() - interval '3 days', now()
  from unnest(array['N5a #51', 'N5b #51', 'N5c #51']) as title;

select pg_temp.test_credit_task(task.id, '51000000-0000-0000-0000-000000000055',
                                '51000000-0000-0000-0000-000000000001')
  from public.tasks as task
 where task.title in ('N5a #51', 'N5b #51', 'N5c #51')
 order by task.id;

-- The expected result set: the tenure rule alone.
create temp table expected51 as
  select row_number() over () as ord, expected.*
    from (values
      ('51000000-0000-0000-0000-000000000051'::uuid, 'recrut'::public.member_role, 'voluntar'::public.member_role, 'time')
    ) as expected (member_id, from_role, to_role, rule_kind);

create function pg_temp.expected() returns text language sql as $$
  select $q$ select expected.member_id, expected.from_role, expected.to_role,
                     (select id from public.promotion_rules where kind = 'time'), expected.rule_kind
               from expected51 as expected order by expected.ord $q$;
$$;

-- What nothing in #826 may write.
create temp table roles_before51 as select id, role, status from public.profiles;
create temp table counts_before51 as
  select (select count(*) from public.role_history)  as role_history,
         (select count(*) from public.notifications) as notifications;

-- ==================== 1. Shape, grants and the retired functions ====================

select hasnt_function('private', 'detect_close_promotions', array['bigint'],
  'detect_close_promotions no longer exists -- the close-time run is gone (ruling R28)');
select hasnt_function('private', 'detect_retention_signals', array['bigint'],
  'detect_retention_signals no longer exists -- Retention Signals move to run_role_evaluation (#826)');

select is(
  (select format('%s:%s:%s:%s', p.proname, p.prosecdef::text, p.provolatile,
                 array_to_string(p.proconfig, ','))
     from pg_proc p
    where p.oid = 'private.detect_promotions()'::regprocedure),
  'detect_promotions:true:s:search_path=""',
  'detect_promotions is security definer, stable and pins an empty search_path -- it cannot write a row');

select is(
  array[has_function_privilege('authenticated', 'private.detect_promotions()', 'execute'),
        has_function_privilege('anon',          'private.detect_promotions()', 'execute'),
        has_function_privilege('service_role',  'private.detect_promotions()', 'execute'),
        has_function_privilege('public',        'private.detect_promotions()', 'execute')],
  array[false, false, false, false],
  'nobody may execute detect_promotions() -- only #52''s job calls it from a security-definer body');

select pg_temp.test_login_leadership('51000000-0000-0000-0000-000000000001');
select throws_ok($$ select * from private.detect_promotions() $$, '42501', null,
  'even BC, signed in, cannot run detect_promotions()');
reset role;
select pg_temp.test_clear_jwt();

set local role anon;
select throws_ok($$ select * from private.detect_promotions() $$, '42501', null,
  'anon cannot run detect_promotions()');
reset role;

-- ==================== 2. The tenure rule ====================

select results_eq($$ select * from private.detect_promotions() $$, pg_temp.expected(),
  'the tenure rule: every tenured Recrut for Voluntar -- nothing else');

select results_eq(
  $$ select member_id from private.detect_promotions()
      where member_id in ('51000000-0000-0000-0000-000000000051', '51000000-0000-0000-0000-000000000052',
                          '51000000-0000-0000-0000-000000000053') $$,
  $$ values ('51000000-0000-0000-0000-000000000051'::uuid) $$,
  'tenure boundary today: the latest join date holding 6 months is detected; the day after it and a Recrut joined today are not');

select is(
  (select count(*) from private.detect_promotions() where member_id = '51000000-0000-0000-0000-000000000054'),
  0::bigint,
  'a deactivated tenured Recrut is not detected');

select is(
  (select count(*) from private.detect_promotions() where rule_kind = 'top_percent'),
  0::bigint,
  'kind top_percent is never returned, however high a tenured Voluntar''s Task Points -- N5''s 45 points, above the seeded threshold of 30, promote nobody: private.detect_promotions() has no top_percent branch left to detect with');

-- ==================== 3. A disabled time rule ====================

update public.promotion_rules set enabled = false where kind = 'time';
select is(
  (select count(*) from private.detect_promotions()),
  0::bigint,
  'a disabled time rule never fires');
update public.promotion_rules set enabled = true where kind = 'time';

-- ==================== 4. Idempotence ====================

select results_eq($$ select * from private.detect_promotions() $$,
                  $$ select * from private.detect_promotions() $$,
  'detect_promotions() twice returns the same rows in the same order');
select ok(
  not exists (select id, role, status from roles_before51
              except select id, role, status from public.profiles)
  and not exists (select id, role, status from public.profiles
                  except select id, role, status from roles_before51)
  and (select role_history from counts_before51) = (select count(*) from public.role_history)
  and (select notifications from counts_before51) = (select count(*) from public.notifications),
  'every call above changed nothing: no Role, status, role_history row or notification');

select * from finish();
rollback;
