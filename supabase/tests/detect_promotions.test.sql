-- detect_promotions.test.sql -- #51: promotion detection and Retention
-- Signals, as pure reads.
--
-- private.detect_promotions() -- the continuous rules: a Recrut past the
-- `time` tenure; a Voluntar with the top_percent tenure whose Task Points in
-- the open Evaluation Period reach public.promotion_threshold_in_force().
-- private.detect_close_promotions(p_period_id) -- the close: the tenure rule
-- at the close first, then every tenured Voluntar (a Recrut step 1 just
-- promoted included) inside the closing Period's top x%.
-- private.detect_retention_signals(p_period_id) -- #48's retention ranking
-- rows outside their Role's share.
--
-- In order: shape and grants; the continuous rules; the close; the Retention
-- Signals; idempotence; disabled rules; no open Period.
--
-- Fixtures, written as the owner inside this rolled-back transaction
-- (conventions section 10: no command opens or closes a Period before #701).
-- Every live active ladder holder the demo seed brings is deactivated first,
-- so every result set is exactly this suite's Members. Both rules are pinned
-- to 6 months of tenure, x = 30 (seed), y = 25 (seed).
--
-- P1, closed: [2005-01-01 00:00 UTC, 2005-06-30 22:00 UTC) -- the close is
-- 2005-07-01 01:00 in Bucharest, so the close's calendar date is 1 July on
-- the Bucharest calendar and 30 June on UTC's. Task Points in P1 (Difficulty
-- x rating_mult(Rating)), 18 ranked Members, share ceil(30% x 18) = 6:
--   rank 1 (30): C1 activ, C6 voluntar joined 2005-01-02 (no tenure at the
--                close), C7 voluntar deactivated
--   rank 4 (24): C2 voluntar, C8 recrut joined 2005-01-02 (no tenure at the
--                close, though she holds it today)
--   rank 6 (18): C3 recrut joined 2005-01-01 -- reaches the tenure exactly on
--                the close's date -- and C4 voluntar, tied at the boundary
--   rank 8 (12): C5 voluntar, C9 recrut joined 2004-06-01 -- just outside
--   below: V1 vot 10, A2 activ 9, V2 vot 8, A3 activ 6, V3 vot 3, F1 bce 3,
--          F2 bce 2, V4 vot 1, F3 bce 1; A4 activ has nothing in P1, nor
--          does CA, a deactivated recrut joined 2004-06-01.
-- Retention in P1: Voluntar Activ cohort C1 30, A2 9, A3 6, A4 0 -> share
-- ceil(1.2) = 2: A3, A4 signalled. Drept de Vot cohort V1 10, V2 8, V3 3,
-- V4 1 -> share ceil(1.0) = 1: V2, V3, V4 signalled.
--
-- P2, open since ten days ago; awards yesterday. The threshold in force is
-- the top_percent rule's initial_threshold, set to 10 (P1 carries no stamp).
-- Tenure today: j_over is the latest join date that holds 6 months today on
-- the Bucharest calendar, j_under the day after it.
--   N1 recrut j_over; N2 recrut j_under; N3 recrut joined today; N4 recrut,
--   joined_at unknown; N5 voluntar j_over, 10 in P2 (at the threshold); N6
--   voluntar j_over, 9 (just under); N7 voluntar j_under, 30; N8 voluntar
--   j_over, 30, deactivated; N9 recrut j_over, 30.
--
-- Mutation guards, each named against the assertion that turns red (run on
-- 2026-09-25 against the live database, each reverted after):
--   * `<=` -> `<` in the continuous tenure -> "tenure boundary today";
--   * drop `status = 'activ'` from the continuous run -> "the threshold door
--     is behind the tenure gate" (N8); from the close's tenure step -> "the
--     close: the full result set" (CA, a deactivated tenured Recrut); from the
--     close's stepped Roles -> "the close: the full result set" (C7);
--   * `>=` -> `>` against the threshold -> "the threshold boundary";
--   * initial_threshold read instead of promotion_threshold_in_force() ->
--     "a stamped close moves the threshold in force";
--   * the open Period's filter dropped (any Period) -> "with no open Period"
--     and "the threshold door ... reads the open Period only";
--   * tenure at the close measured on today's date -> "tenure is measured at
--     the close"; on the UTC date -> "a Recrut reaching the tenure at the
--     close ... both steps";
--   * ceil -> floor, or row_number() for rank() -> "ties at the boundary of
--     the top x%";
--   * the stepped Role dropped (profile.role in step 2) -> "a Recrut
--     reaching the tenure at the close ... both steps";
--   * the threshold in force read at the close -> "raising the threshold in
--     force does not move the close" / "lowering ...";
--   * `rule.enabled` dropped -> the disabled-rule assertions;
--   * `where not ranked.inside` dropped -> "the Retention Signals".
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(33);

-- ==================== Fixtures ====================

update public.profiles set status = 'inactiv'
 where status = 'activ'
   and role in ('recrut', 'voluntar', 'activ', 'vot')
   and id::text not like '51000000-%';

update public.promotion_rules set min_tenure_months = 6, enabled = true;
update public.promotion_rules set initial_threshold = 10 where kind = 'top_percent';

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
  from unnest(array['01', '11', '12', '13', '14', '15', '16', '17', '18', '19',
                    '21', '22', '23', '31', '32', '33', '34', '41', '42', '43',
                    '51', '52', '53', '54', '55', '56', '57', '58', '59', '1a']) as suffix;

insert into public.profiles (id, full_name, email, role, status, joined_at) values
  ('51000000-0000-0000-0000-000000000001', 'BC 51', 'm01-51@test.local', 'bc',       'activ',   '2000-01-01'),
  ('51000000-0000-0000-0000-000000000011', 'C1 51', 'm11-51@test.local', 'activ',    'activ',   '2003-01-01'),
  ('51000000-0000-0000-0000-000000000012', 'C2 51', 'm12-51@test.local', 'voluntar', 'activ',   '2004-06-01'),
  ('51000000-0000-0000-0000-000000000013', 'C3 51', 'm13-51@test.local', 'recrut',   'activ',   '2005-01-01'),
  ('51000000-0000-0000-0000-000000000014', 'C4 51', 'm14-51@test.local', 'voluntar', 'activ',   '2004-06-01'),
  ('51000000-0000-0000-0000-000000000015', 'C5 51', 'm15-51@test.local', 'voluntar', 'activ',   '2004-06-01'),
  ('51000000-0000-0000-0000-000000000016', 'C6 51', 'm16-51@test.local', 'voluntar', 'activ',   '2005-01-02'),
  ('51000000-0000-0000-0000-000000000017', 'C7 51', 'm17-51@test.local', 'voluntar', 'inactiv', '2004-06-01'),
  ('51000000-0000-0000-0000-000000000018', 'C8 51', 'm18-51@test.local', 'recrut',   'activ',   '2005-01-02'),
  ('51000000-0000-0000-0000-000000000019', 'C9 51', 'm19-51@test.local', 'recrut',   'activ',   '2004-06-01'),
  -- Deactivated, tenured at the close: guards the close's tenure-rule step.
  ('51000000-0000-0000-0000-00000000001a', 'CA 51', 'm1a-51@test.local', 'recrut',   'inactiv', '2004-06-01'),
  ('51000000-0000-0000-0000-000000000021', 'A2 51', 'm21-51@test.local', 'activ',    'activ',   '2003-01-01'),
  ('51000000-0000-0000-0000-000000000022', 'A3 51', 'm22-51@test.local', 'activ',    'activ',   '2003-01-01'),
  ('51000000-0000-0000-0000-000000000023', 'A4 51', 'm23-51@test.local', 'activ',    'activ',   '2003-01-01'),
  ('51000000-0000-0000-0000-000000000031', 'V1 51', 'm31-51@test.local', 'vot',      'activ',   '2002-01-01'),
  ('51000000-0000-0000-0000-000000000032', 'V2 51', 'm32-51@test.local', 'vot',      'activ',   '2002-01-01'),
  ('51000000-0000-0000-0000-000000000033', 'V3 51', 'm33-51@test.local', 'vot',      'activ',   '2002-01-01'),
  ('51000000-0000-0000-0000-000000000034', 'V4 51', 'm34-51@test.local', 'vot',      'activ',   '2002-01-01'),
  ('51000000-0000-0000-0000-000000000041', 'F1 51', 'm41-51@test.local', 'bce',      'activ',   '2001-01-01'),
  ('51000000-0000-0000-0000-000000000042', 'F2 51', 'm42-51@test.local', 'bce',      'activ',   '2001-01-01'),
  ('51000000-0000-0000-0000-000000000043', 'F3 51', 'm43-51@test.local', 'bce',      'activ',   '2001-01-01');

insert into public.profiles (id, full_name, email, role, status, joined_at)
select member.id::uuid, member.full_name, member.email, member.role::public.member_role,
       member.status::public.member_status, member.joined_at
  from tenure51,
       lateral (values
         ('51000000-0000-0000-0000-000000000051', 'N1 51', 'm51-51@test.local', 'recrut',   'activ',   tenure51.j_over),
         ('51000000-0000-0000-0000-000000000052', 'N2 51', 'm52-51@test.local', 'recrut',   'activ',   tenure51.j_under),
         ('51000000-0000-0000-0000-000000000053', 'N3 51', 'm53-51@test.local', 'recrut',   'activ',   tenure51.on_date),
         ('51000000-0000-0000-0000-000000000054', 'N4 51', 'm54-51@test.local', 'recrut',   'activ',   null::date),
         ('51000000-0000-0000-0000-000000000055', 'N5 51', 'm55-51@test.local', 'voluntar', 'activ',   tenure51.j_over),
         ('51000000-0000-0000-0000-000000000056', 'N6 51', 'm56-51@test.local', 'voluntar', 'activ',   tenure51.j_over),
         ('51000000-0000-0000-0000-000000000057', 'N7 51', 'm57-51@test.local', 'voluntar', 'activ',   tenure51.j_under),
         ('51000000-0000-0000-0000-000000000058', 'N8 51', 'm58-51@test.local', 'voluntar', 'inactiv', tenure51.j_over),
         ('51000000-0000-0000-0000-000000000059', 'N9 51', 'm59-51@test.local', 'recrut',   'activ',   tenure51.j_over)
       ) as member (id, full_name, email, role, status, joined_at);

insert into public.groups (name, category, min_level) values ('Grup Promovări 51', 'department', 0);

insert into public.evaluation_periods (name, opened_at, opened_by, closed_at, closed_by) values
  ('Perioada închisă #51', '2005-01-01 00:00:00+00', '51000000-0000-0000-0000-000000000001',
   '2005-06-30 22:00:00+00', '51000000-0000-0000-0000-000000000001');
insert into public.evaluation_periods (name, opened_at, opened_by) values
  ('Perioada deschisă #51', now() - interval '10 days', '51000000-0000-0000-0000-000000000001');

create temp table fx51 as
  select (select id from public.evaluation_periods where name = 'Perioada închisă #51')  as closed,
         (select id from public.evaluation_periods where name = 'Perioada deschisă #51') as open,
         (select max(id) + 1000 from public.evaluation_periods)                          as unknown,
         (select id from public.promotion_rules where kind = 'time')                     as time_rule,
         (select id from public.promotion_rules where kind = 'top_percent')              as top_rule;
grant select on fx51 to authenticated, anon;

-- rating 5 -> x3, rating 4 -> x2, rating 3 -> x1.
create temp table credits51 (title text, difficulty int, rating int, member_id uuid, awarded_at timestamptz);
insert into credits51 values
  ('C1a #51', 5, 5, '51000000-0000-0000-0000-000000000011', '2005-03-01 12:00:00+00'),
  ('C1b #51', 5, 5, '51000000-0000-0000-0000-000000000011', '2005-03-02 12:00:00+00'),
  ('C6a #51', 5, 5, '51000000-0000-0000-0000-000000000016', '2005-03-01 12:00:00+00'),
  ('C6b #51', 5, 5, '51000000-0000-0000-0000-000000000016', '2005-03-02 12:00:00+00'),
  ('C7a #51', 5, 5, '51000000-0000-0000-0000-000000000017', '2005-03-01 12:00:00+00'),
  ('C7b #51', 5, 5, '51000000-0000-0000-0000-000000000017', '2005-03-02 12:00:00+00'),
  ('C2a #51', 5, 5, '51000000-0000-0000-0000-000000000012', '2005-03-01 12:00:00+00'),
  ('C2b #51', 3, 5, '51000000-0000-0000-0000-000000000012', '2005-03-02 12:00:00+00'),
  ('C8a #51', 5, 5, '51000000-0000-0000-0000-000000000018', '2005-03-01 12:00:00+00'),
  ('C8b #51', 3, 5, '51000000-0000-0000-0000-000000000018', '2005-03-02 12:00:00+00'),
  ('C3a #51', 3, 5, '51000000-0000-0000-0000-000000000013', '2005-03-01 12:00:00+00'),
  ('C3b #51', 3, 5, '51000000-0000-0000-0000-000000000013', '2005-03-02 12:00:00+00'),
  ('C4a #51', 5, 5, '51000000-0000-0000-0000-000000000014', '2005-03-01 12:00:00+00'),
  ('C4b #51', 1, 5, '51000000-0000-0000-0000-000000000014', '2005-03-02 12:00:00+00'),
  ('C5 #51',  4, 5, '51000000-0000-0000-0000-000000000015', '2005-03-01 12:00:00+00'),
  ('C9 #51',  4, 5, '51000000-0000-0000-0000-000000000019', '2005-03-01 12:00:00+00'),
  ('V1 #51',  5, 4, '51000000-0000-0000-0000-000000000031', '2005-03-01 12:00:00+00'),
  ('A2 #51',  3, 5, '51000000-0000-0000-0000-000000000021', '2005-03-01 12:00:00+00'),
  ('V2 #51',  4, 4, '51000000-0000-0000-0000-000000000032', '2005-03-01 12:00:00+00'),
  ('A3 #51',  2, 5, '51000000-0000-0000-0000-000000000022', '2005-03-01 12:00:00+00'),
  ('V3 #51',  1, 5, '51000000-0000-0000-0000-000000000033', '2005-03-01 12:00:00+00'),
  ('F1 #51',  1, 5, '51000000-0000-0000-0000-000000000041', '2005-03-01 12:00:00+00'),
  ('F2 #51',  1, 4, '51000000-0000-0000-0000-000000000042', '2005-03-01 12:00:00+00'),
  ('V4 #51',  1, 3, '51000000-0000-0000-0000-000000000034', '2005-03-01 12:00:00+00'),
  ('F3 #51',  1, 3, '51000000-0000-0000-0000-000000000043', '2005-03-01 12:00:00+00'),
  -- P2, the open Period.
  ('N5 #51',  5, 4, '51000000-0000-0000-0000-000000000055', now() - interval '1 day'),
  ('N6 #51',  3, 5, '51000000-0000-0000-0000-000000000056', now() - interval '1 day'),
  ('N7a #51', 5, 5, '51000000-0000-0000-0000-000000000057', now() - interval '1 day'),
  ('N7b #51', 5, 5, '51000000-0000-0000-0000-000000000057', now() - interval '1 day'),
  ('N8a #51', 5, 5, '51000000-0000-0000-0000-000000000058', now() - interval '1 day'),
  ('N8b #51', 5, 5, '51000000-0000-0000-0000-000000000058', now() - interval '1 day'),
  ('N9a #51', 5, 5, '51000000-0000-0000-0000-000000000059', now() - interval '1 day'),
  ('N9b #51', 5, 5, '51000000-0000-0000-0000-000000000059', now() - interval '1 day');

insert into public.tasks
  (title, description, deadline, group_id, status, difficulty, rating,
   created_by, created_at, completed_at)
select credit.title, 'Fixture', now() - interval '2 days',
       (select id from public.groups where name = 'Grup Promovări 51'),
       'completed', credit.difficulty, credit.rating, '51000000-0000-0000-0000-000000000001',
       now() - interval '3 days', now()
  from credits51 as credit;

select pg_temp.test_credit_task(task.id, credit.member_id, '51000000-0000-0000-0000-000000000001',
                                p_awarded_at => credit.awarded_at)
  from credits51 as credit
  join public.tasks as task on task.title = credit.title
 order by task.id;

-- The expected result sets.
-- The continuous rules at a threshold in force of 10.
create temp table continuous51 as
  select row_number() over () as ord, expected.*
    from (values
      ('51000000-0000-0000-0000-000000000013'::uuid, 'recrut'::public.member_role,   'voluntar'::public.member_role, 'time'),
      ('51000000-0000-0000-0000-000000000018',       'recrut',                       'voluntar',                     'time'),
      ('51000000-0000-0000-0000-000000000019',       'recrut',                       'voluntar',                     'time'),
      ('51000000-0000-0000-0000-000000000051',       'recrut',                       'voluntar',                     'time'),
      ('51000000-0000-0000-0000-000000000059',       'recrut',                       'voluntar',                     'time'),
      ('51000000-0000-0000-0000-000000000055',       'voluntar',                     'activ',                        'top_percent')
    ) as expected (member_id, from_role, to_role, rule_kind);
create temp table continuous_time51 as select * from continuous51 where rule_kind = 'time';

-- The close of P1.
create temp table close51 as
  select row_number() over () as ord, expected.*
    from (values
      ('51000000-0000-0000-0000-000000000013'::uuid, 'recrut'::public.member_role,   'voluntar'::public.member_role, 'time'),
      ('51000000-0000-0000-0000-000000000019',       'recrut',                       'voluntar',                     'time'),
      ('51000000-0000-0000-0000-000000000012',       'voluntar',                     'activ',                        'top_percent'),
      ('51000000-0000-0000-0000-000000000013',       'voluntar',                     'activ',                        'top_percent'),
      ('51000000-0000-0000-0000-000000000014',       'voluntar',                     'activ',                        'top_percent')
    ) as expected (member_id, from_role, to_role, rule_kind);

create function pg_temp.expected(p_table text) returns text language sql as $$
  select format(
    $q$ select expected.member_id, expected.from_role, expected.to_role,
               case expected.rule_kind when 'time' then fx.time_rule else fx.top_rule end,
               expected.rule_kind
          from %I as expected cross join fx51 as fx
         order by expected.ord $q$, p_table);
$$;

create function pg_temp.close_of(p_period bigint) returns text language sql as $$
  select format('select * from private.detect_close_promotions(%s)', p_period);
$$;

-- What nothing in #51 may write.
create temp table roles_before51 as select id, role, status from public.profiles;
create temp table counts_before51 as
  select (select count(*) from public.role_history)  as role_history,
         (select count(*) from public.notifications) as notifications;

-- ==================== 1. Shape and grants ====================

select is(
  (select array_agg(format('%s:%s:%s:%s', p.proname, p.prosecdef::text, p.provolatile,
                           array_to_string(p.proconfig, ',')) order by p.proname)
     from pg_proc p
    where p.oid in ('private.detect_promotions()'::regprocedure,
                    'private.detect_close_promotions(bigint)'::regprocedure,
                    'private.detect_retention_signals(bigint)'::regprocedure)),
  array['detect_close_promotions:true:s:search_path=""',
        'detect_promotions:true:s:search_path=""',
        'detect_retention_signals:true:s:search_path=""'],
  'all three are security definer, stable and pin an empty search_path -- none can write a row');

select is(
  array[has_function_privilege('authenticated', 'private.detect_promotions()', 'execute'),
        has_function_privilege('anon',          'private.detect_promotions()', 'execute'),
        has_function_privilege('service_role',  'private.detect_promotions()', 'execute'),
        has_function_privilege('public',        'private.detect_promotions()', 'execute'),
        has_function_privilege('authenticated', 'private.detect_close_promotions(bigint)', 'execute'),
        has_function_privilege('anon',          'private.detect_close_promotions(bigint)', 'execute'),
        has_function_privilege('service_role',  'private.detect_close_promotions(bigint)', 'execute'),
        has_function_privilege('public',        'private.detect_close_promotions(bigint)', 'execute'),
        has_function_privilege('authenticated', 'private.detect_retention_signals(bigint)', 'execute'),
        has_function_privilege('anon',          'private.detect_retention_signals(bigint)', 'execute'),
        has_function_privilege('service_role',  'private.detect_retention_signals(bigint)', 'execute'),
        has_function_privilege('public',        'private.detect_retention_signals(bigint)', 'execute')],
  array[false, false, false, false, false, false, false, false, false, false, false, false],
  'nobody may execute any of them -- #52''s job and #701''s close call them from security-definer bodies');

select pg_temp.test_login_leadership('51000000-0000-0000-0000-000000000001');
select throws_ok($$ select * from private.detect_promotions() $$, '42501', null,
  'even BC, signed in, cannot run detect_promotions()');
select throws_ok(pg_temp.close_of((select closed from fx51)), '42501', null,
  'even BC, signed in, cannot run detect_close_promotions()');
select throws_ok(format('select * from private.detect_retention_signals(%s)', (select closed from fx51)),
  '42501', null,
  'even BC, signed in, cannot run detect_retention_signals()');
reset role;
select pg_temp.test_clear_jwt();

set local role anon;
select throws_ok($$ select * from private.detect_promotions() $$, '42501', null,
  'anon cannot run detect_promotions()');
reset role;

-- ==================== 2. The continuous rules ====================

select results_eq($$ select * from private.detect_promotions() $$, pg_temp.expected('continuous51'),
  'the continuous rules: every tenured Recrut for Voluntar, then every tenured Voluntar at or above the threshold in force for Voluntar Activ -- time rows first');

select results_eq(
  $$ select member_id from private.detect_promotions()
      where member_id in ('51000000-0000-0000-0000-000000000051', '51000000-0000-0000-0000-000000000052',
                          '51000000-0000-0000-0000-000000000053', '51000000-0000-0000-0000-000000000054') $$,
  $$ values ('51000000-0000-0000-0000-000000000051'::uuid) $$,
  'tenure boundary today: the latest join date holding 6 months is detected; the day after it, a Recrut joined today and one with no join date are not');

select results_eq(
  $$ select member_id from private.detect_promotions() where rule_kind = 'top_percent' $$,
  $$ values ('51000000-0000-0000-0000-000000000055'::uuid) $$,
  'the threshold boundary: a tenured Voluntar with exactly the threshold in force (10) is detected, one with 9 is not');

select is(
  (select count(*) from private.detect_promotions()
    where member_id in ('51000000-0000-0000-0000-000000000057', '51000000-0000-0000-0000-000000000058',
                        '51000000-0000-0000-0000-000000000012', '51000000-0000-0000-0000-000000000014')),
  0::bigint,
  'the threshold door is behind the tenure gate and reads the open Period only: a Voluntar with 30 points but no tenure, a deactivated one, and Voluntari whose points are all in a closed Period are not detected');

select results_eq(
  $$ select from_role, to_role from private.detect_promotions()
      where member_id = '51000000-0000-0000-0000-000000000059' $$,
  $$ values ('recrut'::public.member_role, 'voluntar'::public.member_role) $$,
  'the continuous rules are not chained: a tenured Recrut with 30 points in the open Period is detected for Voluntar only');

update public.evaluation_periods set closing_threshold = 9 where id = (select closed from fx51);
select results_eq(
  $$ select member_id from private.detect_promotions() where rule_kind = 'top_percent' $$,
  $$ values ('51000000-0000-0000-0000-000000000055'::uuid), ('51000000-0000-0000-0000-000000000056') $$,
  'a stamped close moves the threshold in force: at 9, the Voluntar with 9 is detected too');
update public.evaluation_periods set closing_threshold = null where id = (select closed from fx51);

-- ==================== 3. The close ====================

select results_eq(pg_temp.close_of((select closed from fx51)), pg_temp.expected('close51'),
  'the close: the full result set -- the tenure rule first, then every tenured Voluntar inside the top x%, deactivated earners never');

select results_eq(
  format($$ select from_role, to_role, rule_kind from private.detect_close_promotions(%s)
             where member_id = '51000000-0000-0000-0000-000000000013' $$, (select closed from fx51)),
  $$ values ('recrut'::public.member_role, 'voluntar'::public.member_role, 'time'),
            ('voluntar', 'activ', 'top_percent') $$,
  'a Recrut reaching the tenure on the close''s Bucharest date and inside the top x% is returned for both steps, Voluntar first');

select results_eq(
  format($$ select member_id from private.detect_close_promotions(%s)
             where rule_kind = 'top_percent'
               and member_id in ('51000000-0000-0000-0000-000000000014', '51000000-0000-0000-0000-000000000015') $$,
         (select closed from fx51)),
  $$ values ('51000000-0000-0000-0000-000000000014'::uuid) $$,
  'ties at the boundary of the top x%: the Voluntar tied with the share-th Member (rank 6 of share 6) is inside, the next (rank 8) is not');

select is(
  (select count(*) from private.detect_close_promotions((select closed from fx51))
    where member_id in ('51000000-0000-0000-0000-000000000016', '51000000-0000-0000-0000-000000000018')),
  0::bigint,
  'tenure is measured at the close: a Voluntar and a Recrut who joined the day after the tenure date are not detected, though both hold the tenure today');

select results_eq(
  format($$ select to_role from private.detect_close_promotions(%s)
             where member_id = '51000000-0000-0000-0000-000000000019' $$, (select closed from fx51)),
  $$ values ('voluntar'::public.member_role) $$,
  'a tenured Recrut outside the top x% is returned for Voluntar only');

update public.promotion_rules set initial_threshold = 1000 where kind = 'top_percent';
select results_eq(pg_temp.close_of((select closed from fx51)), pg_temp.expected('close51'),
  'raising the threshold in force (to 1000) does not move the close -- the ranking decides, not the number');
update public.promotion_rules set initial_threshold = 1 where kind = 'top_percent';
select results_eq(pg_temp.close_of((select closed from fx51)), pg_temp.expected('close51'),
  'lowering the threshold in force (to 1) does not move the close either');
update public.promotion_rules set initial_threshold = 10 where kind = 'top_percent';

select throws_ok(pg_temp.close_of((select open from fx51)), 'PT409', 'evaluation_period_open',
  'an open Period has no close to detect');
select throws_ok(pg_temp.close_of((select unknown from fx51)), 'PT404', 'evaluation_period_not_found',
  'an unknown Period is not found');

-- ==================== 4. The Retention Signals ====================

select results_eq(
  format('select * from private.detect_retention_signals(%s)', (select closed from fx51)),
  $$ values ('51000000-0000-0000-0000-000000000022'::uuid, 'activ'::public.member_role, 6, 3, 2, 'top_percent'),
            ('51000000-0000-0000-0000-000000000023',       'activ',                     0, 4, 2, 'top_percent'),
            ('51000000-0000-0000-0000-000000000032',       'vot',                       8, 2, 1, 'vote_retention_percent'),
            ('51000000-0000-0000-0000-000000000033',       'vot',                       3, 3, 1, 'vote_retention_percent'),
            ('51000000-0000-0000-0000-000000000034',       'vot',                       1, 4, 1, 'vote_retention_percent') $$,
  'the Retention Signals: the Voluntar Activ holders below the top x% (share 2 of 4) and the Drept de Vot holders below the top y% (share 1 of 4), with the Role at risk; those inside are not signalled');

select throws_ok(format('select * from private.detect_retention_signals(%s)', (select open from fx51)),
  'PT409', 'evaluation_period_open',
  'an open Period gives no Retention Signal');
select throws_ok(format('select * from private.detect_retention_signals(%s)', (select unknown from fx51)),
  'PT404', 'evaluation_period_not_found',
  'an unknown Period is not found');

-- ==================== 5. Idempotence ====================

select results_eq($$ select * from private.detect_promotions() $$,
                  $$ select * from private.detect_promotions() $$,
  'detect_promotions() twice returns the same rows in the same order');
select results_eq(pg_temp.close_of((select closed from fx51)), pg_temp.close_of((select closed from fx51)),
  'detect_close_promotions() twice returns the same rows in the same order');
select results_eq(format('select * from private.detect_retention_signals(%s)', (select closed from fx51)),
                  format('select * from private.detect_retention_signals(%s)', (select closed from fx51)),
  'detect_retention_signals() twice returns the same rows in the same order');
select ok(
  not exists (select id, role, status from roles_before51
              except select id, role, status from public.profiles)
  and not exists (select id, role, status from public.profiles
                  except select id, role, status from roles_before51)
  and (select role_history from counts_before51) = (select count(*) from public.role_history)
  and (select notifications from counts_before51) = (select count(*) from public.notifications),
  'every call above changed nothing: no Role, status, role_history row or notification');

-- ==================== 6. Disabled rules never fire ====================

update public.promotion_rules set enabled = false where kind = 'time';
select results_eq($$ select member_id, rule_kind from private.detect_promotions() $$,
  $$ values ('51000000-0000-0000-0000-000000000055'::uuid, 'top_percent') $$,
  'a disabled time rule never fires in the continuous run');
select results_eq(
  format('select member_id, from_role from private.detect_close_promotions(%s)', (select closed from fx51)),
  $$ values ('51000000-0000-0000-0000-000000000012'::uuid, 'voluntar'::public.member_role),
            ('51000000-0000-0000-0000-000000000014', 'voluntar') $$,
  'a disabled time rule never fires at the close, so a Recrut inside the top x% stays a Recrut and is not detected for Voluntar Activ');
update public.promotion_rules set enabled = true where kind = 'time';

update public.promotion_rules set enabled = false where kind = 'top_percent';
select is(
  (select count(*) from private.detect_promotions() where rule_kind = 'top_percent')
  + (select count(*) from private.detect_close_promotions((select closed from fx51)) where rule_kind = 'top_percent'),
  0::bigint,
  'a disabled top_percent rule never fires, neither through the threshold nor at the close');
select is(
  (select count(*) from private.detect_retention_signals((select closed from fx51))),
  5::bigint,
  'a disabled top_percent rule does not silence the Retention Signals');
update public.promotion_rules set enabled = true where kind = 'top_percent';

-- ==================== 7. No open Period ====================

update public.evaluation_periods
   set closed_at = now(), closed_by = '51000000-0000-0000-0000-000000000001'
 where id = (select open from fx51);
select results_eq($$ select * from private.detect_promotions() $$, pg_temp.expected('continuous_time51'),
  'with no open Period the tenure rule still fires and the threshold rule returns nothing -- not even for a Voluntar whose points in the Period just closed reach the threshold in force');

select * from finish();
rollback;
