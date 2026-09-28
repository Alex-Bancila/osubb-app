-- role_evaluation_ranking.test.sql -- #826 (ruling R28): the ranking a Role
-- Evaluation reads, private.role_evaluation_rows(kind, period_from,
-- period_to, on_date) and the caller-filtered public.role_evaluation_ranking
-- (kind, from, to).
--
-- R28 replaces #47's evaluation_period_ranking and #48's retention_ranking
-- with one function per kind: voluntar_activ ranks the live active Voluntar
-- Activ holders plus every Voluntar whose tenure (joined_at + the
-- top_percent Promotion Rule's min_tenure_months) lands on or before the
-- date passed as on_date; adunarea_generala ranks the live active Voluntar
-- cu Drept de Vot holders alone. Each Role is ranked within its own cohort
-- (rank(), ties share it), share_size = ceil(percent x cohort_size / 100)
-- with x (the top_percent rule's percent) for activ/voluntar and y
-- (org_settings.vote_retention_percent) for vot -- #49's boundary rule, per
-- cohort, so a tenured Voluntar's own points never move the Voluntar Activ
-- cohort's rank or share. public.role_evaluation_ranking filters those rows
-- for the caller: every row for BC/Moderator/the Adunarea Generală's Group
-- Managers and Responsibles (#512's private.can_read_evaluation_rankings);
-- the caller's own row for any other live active Member in the kind's
-- population; nothing, with no error, without organization claims or a live
-- activ Profile.
--
-- In order: 1. shape and grants (wrapper security invoker, body security
-- definer, the unfiltered core invoker and granted to nobody); 2. the
-- population and the per-cohort ranking, called directly at a fixed on_date
-- so the tenure boundary is deterministic; 3. the malformed-input errors; 4.
-- the read wrapper's own-row/full-read/nothing split, at the real on_date
-- (kind adunarea_generala, whose population never depends on it, plus one
-- voluntar_activ own-row check on an activ holder, likewise on_date-free);
-- 5. the missing-configuration refusals, last because they delete reference
-- rows every earlier section needs.
--
-- Fixtures (prefix 82600000-, #826). The demo seed's activ/voluntar/vot
-- holders are deactivated first, so the cohorts are exactly this suite's
-- Members. x (the top_percent rule's percent) and its tenure are set to 30 %
-- / 12 months, y (vote_retention_percent) to 25 %, directly as the owner --
-- data, not code. The Evaluation Period is the fixed range
-- [2005-01-01, 2005-06-30]; on_date for the direct calls is 2005-07-01.
--   Voluntar Activ cohort (4): AA1 15, AA2 10, AA3 10 (tied), AA4 0 (her
--     only Evaluation is dated the day before the Period opens) -> x = 30 %
--     of 4 -> share 2 -> AA1, AA2, AA3 inside (the tie shares rank 2), AA4
--     out.
--   Voluntar cohort, tenured (3): VT1 45, VT2 5, VTlimita 0 (joined_at +
--     12 months lands exactly on on_date -- included, at the boundary) ->
--     x = 30 % of 3 -> share 1 -> VT1 alone inside. VT1's 45 points, higher
--     than any Voluntar Activ holder's, never touches the Voluntar Activ
--     cohort: proves the per-cohort split.
--   Excluded from the voluntar_activ population: VTscurt (joined_at one day
--     short of the tenure gate), VTnul (joined_at null), a deactivated
--     Voluntar Activ holder, and BC/BCE/Recrut (holding neither Role).
--   Drept de Vot cohort (2): VOT1 15, VOT2 5 -> y = 25 % of 2 -> share 1 ->
--     VOT1 alone inside.
--
-- Mutation guards, each named against the assertion that turns red (run as
-- scratch copies of this file on 2026-09-27):
--   * `partition by member.role` dropped from the cohorts CTE (ranking the
--     whole population as one pool of 7 instead of a cohort of 4 and a
--     cohort of 3) -> "the Voluntar Activ cohort_size stays 4 -- the tenured
--     Voluntars are never merged into it" goes red (it becomes 7), and so
--     does the full voluntar_activ results_eq and the AA2 own-row read --
--     the merged share (ceil(30 x 7 / 100) = 3) still happens to keep AA2
--     and AA3 inside by coincidence, so the bool_and "stays inside" check
--     alone does not discriminate this mutation; cohort_size does;
--   * the tenure comparison `<=` changed to `<` -> "a Voluntar whose tenure
--     lands exactly on the Evaluation date is included" goes red --
--     VTlimita, whose joined_at + 12 months equals on_date exactly, is
--     dropped from the population.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(27);

-- ==================== Fixtures ====================

update public.profiles set status = 'inactiv'
 where status = 'activ' and role in ('activ', 'voluntar', 'vot')
   and id::text not like '82600000-%';

insert into auth.users (id, email)
select ('82600000-0000-0000-0000-0000000000' || suffix)::uuid, 'm' || suffix || '-826@test.local'
  from unnest(array['01', '02', '03',
                    '11', '12', '13', '14', '15',
                    '21', '22', '23', '24', '25',
                    '31', '32', '33']) as suffix;

insert into public.profiles (id, full_name, email, role, status, joined_at) values
  ('82600000-0000-0000-0000-000000000001', 'BC 826',                 'm01-826@test.local', 'bc',       'activ', null),
  ('82600000-0000-0000-0000-000000000002', 'BCE 826',                'm02-826@test.local', 'bce',      'activ', null),
  ('82600000-0000-0000-0000-000000000003', 'Recrut 826',             'm03-826@test.local', 'recrut',   'activ', null),
  ('82600000-0000-0000-0000-000000000011', 'AA1 826',                'm11-826@test.local', 'activ',    'activ', null),
  ('82600000-0000-0000-0000-000000000012', 'AA2 826',                'm12-826@test.local', 'activ',    'activ', null),
  ('82600000-0000-0000-0000-000000000013', 'AA3 826',                'm13-826@test.local', 'activ',    'activ', null),
  ('82600000-0000-0000-0000-000000000014', 'AA4 826',                'm14-826@test.local', 'activ',    'activ', null),
  -- Deactivated, still holding the Voluntar Activ token it was issued.
  ('82600000-0000-0000-0000-000000000015', 'Activ dezactivat 826',   'm15-826@test.local', 'activ',    'inactiv', null),
  ('82600000-0000-0000-0000-000000000021', 'VT1 826',                'm21-826@test.local', 'voluntar', 'activ', '2004-01-01'),
  ('82600000-0000-0000-0000-000000000022', 'VT2 826',                'm22-826@test.local', 'voluntar', 'activ', '2004-01-01'),
  -- joined_at + 12 months = 2005-07-02, one day after on_date 2005-07-01.
  ('82600000-0000-0000-0000-000000000023', 'VTscurt 826',            'm23-826@test.local', 'voluntar', 'activ', '2004-07-02'),
  ('82600000-0000-0000-0000-000000000024', 'VTnul 826',              'm24-826@test.local', 'voluntar', 'activ', null),
  -- joined_at + 12 months = 2005-07-01, exactly on_date: the boundary.
  ('82600000-0000-0000-0000-000000000025', 'VTlimita 826',           'm25-826@test.local', 'voluntar', 'activ', '2004-07-01'),
  ('82600000-0000-0000-0000-000000000031', 'VOT1 826',               'm31-826@test.local', 'vot',      'activ', null),
  ('82600000-0000-0000-0000-000000000032', 'VOT2 826',               'm32-826@test.local', 'vot',      'activ', null),
  ('82600000-0000-0000-0000-000000000033', 'VOT dezactivat 826',     'm33-826@test.local', 'vot',      'inactiv', null);

update public.promotion_rules set percent = 30, min_tenure_months = 12 where kind = 'top_percent';
update public.org_settings set value = '25' where key = 'vote_retention_percent';

insert into public.groups (name, category, min_level) values ('Grup Evaluări 826', 'department', 0);

create temp table credits826 (title text, difficulty int, rating int, member_id uuid, awarded_at timestamptz);
insert into credits826 values
  ('AA1 #826',      5, 5, '82600000-0000-0000-0000-000000000011', '2005-03-01 12:00:00+00'),
  ('AA2 #826',      5, 4, '82600000-0000-0000-0000-000000000012', '2005-03-01 12:00:00+00'),
  ('AA3 #826',      5, 4, '82600000-0000-0000-0000-000000000013', '2005-03-01 12:00:00+00'),
  -- The day before the Period opens: outside the range, so AA4 ranks at 0.
  ('AA4 fara #826', 5, 5, '82600000-0000-0000-0000-000000000014', '2004-12-31 12:00:00+00'),
  ('VT1a #826',     5, 5, '82600000-0000-0000-0000-000000000021', '2005-03-01 12:00:00+00'),
  ('VT1b #826',     5, 5, '82600000-0000-0000-0000-000000000021', '2005-03-02 12:00:00+00'),
  ('VT1c #826',     5, 5, '82600000-0000-0000-0000-000000000021', '2005-03-03 12:00:00+00'),
  ('VT2 #826',      5, 3, '82600000-0000-0000-0000-000000000022', '2005-03-01 12:00:00+00'),
  ('VOT1 #826',     5, 5, '82600000-0000-0000-0000-000000000031', '2005-03-01 12:00:00+00'),
  ('VOT2 #826',     5, 3, '82600000-0000-0000-0000-000000000032', '2005-03-01 12:00:00+00');

insert into public.tasks
  (title, description, deadline, group_id, status, difficulty, rating,
   created_by, created_at, completed_at)
select credit.title, 'Fixture', now() - interval '2 days',
       (select id from public.groups where name = 'Grup Evaluări 826'),
       'completed', credit.difficulty, credit.rating, '82600000-0000-0000-0000-000000000001',
       now() - interval '3 days', now()
  from credits826 as credit;

select pg_temp.test_credit_task(task.id, credit.member_id, '82600000-0000-0000-0000-000000000001',
                                p_awarded_at => credit.awarded_at)
  from credits826 as credit
  join public.tasks as task on task.title = credit.title
 order by task.id;

-- The full voluntar_activ ranking at x = 30 %, tenure = 12 months.
create temp table full826_va (member_id uuid, role public.member_role, task_points integer, rank integer,
                              cohort_size integer, share_size integer, inside boolean, tenure_since date);
insert into full826_va values
  ('82600000-0000-0000-0000-000000000011', 'activ', 15, 1, 4, 2, true,  null),
  ('82600000-0000-0000-0000-000000000012', 'activ', 10, 2, 4, 2, true,  null),
  ('82600000-0000-0000-0000-000000000013', 'activ', 10, 2, 4, 2, true,  null),
  ('82600000-0000-0000-0000-000000000014', 'activ',  0, 4, 4, 2, false, null),
  ('82600000-0000-0000-0000-000000000021', 'voluntar', 45, 1, 3, 1, true,  '2005-01-01'),
  ('82600000-0000-0000-0000-000000000022', 'voluntar',  5, 2, 3, 1, false, '2005-01-01'),
  ('82600000-0000-0000-0000-000000000025', 'voluntar',  0, 3, 3, 1, false, '2005-07-01');

-- The full adunarea_generala ranking at y = 25 %.
create temp table full826_ag (member_id uuid, role public.member_role, task_points integer, rank integer,
                              cohort_size integer, share_size integer, inside boolean, tenure_since date);
insert into full826_ag values
  ('82600000-0000-0000-0000-000000000031', 'vot', 15, 1, 2, 1, true,  null),
  ('82600000-0000-0000-0000-000000000032', 'vot',  5, 2, 2, 1, false, null);

grant select on full826_va, full826_ag to authenticated;

-- ==================== 1. Shape and grants ====================

select has_function('public', 'role_evaluation_ranking', array['text', 'date', 'date'],
  'public.role_evaluation_ranking(text, date, date) exists');
select is(
  (select array_agg(format('%s:%s:%s', p.proname, p.prosecdef::text, p.provolatile) order by p.proname)
     from pg_proc p
    where p.oid in ('public.role_evaluation_ranking(text, date, date)'::regprocedure,
                    'private.role_evaluation_ranking_impl(text, date, date)'::regprocedure,
                    'private.role_evaluation_rows(text, date, date, date)'::regprocedure)),
  array['role_evaluation_ranking:false:s', 'role_evaluation_ranking_impl:true:s', 'role_evaluation_rows:false:s'],
  'the wrapper is security invoker, the body security definer, the core invoker; all three are stable -- none can write a row');
select is(
  array[has_function_privilege('authenticated', 'public.role_evaluation_ranking(text, date, date)', 'execute'),
        has_function_privilege('anon', 'public.role_evaluation_ranking(text, date, date)', 'execute'),
        has_function_privilege('service_role', 'public.role_evaluation_ranking(text, date, date)', 'execute'),
        has_function_privilege('public', 'public.role_evaluation_ranking(text, date, date)', 'execute'),
        has_function_privilege('authenticated', 'private.role_evaluation_ranking_impl(text, date, date)', 'execute'),
        has_function_privilege('anon', 'private.role_evaluation_ranking_impl(text, date, date)', 'execute'),
        has_function_privilege('service_role', 'private.role_evaluation_ranking_impl(text, date, date)', 'execute'),
        has_function_privilege('public', 'private.role_evaluation_ranking_impl(text, date, date)', 'execute')],
  array[true, false, false, false, true, false, false, false],
  'the wrapper and its body: execute for authenticated only');
select is(
  array[has_function_privilege('authenticated', 'private.role_evaluation_rows(text, date, date, date)', 'execute'),
        has_function_privilege('anon', 'private.role_evaluation_rows(text, date, date, date)', 'execute'),
        has_function_privilege('service_role', 'private.role_evaluation_rows(text, date, date, date)', 'execute'),
        has_function_privilege('public', 'private.role_evaluation_rows(text, date, date, date)', 'execute')],
  array[false, false, false, false],
  'the unfiltered core is executable by nobody -- the body reads it from a security-definer call');
select ok(
  pg_get_functiondef('private.role_evaluation_ranking_impl(text, date, date)'::regprocedure) ~ 'can_read_evaluation_rankings',
  'the body''s full read is #512''s predicate');

-- ==================== 2. Population and the per-cohort ranking ====================
-- Called directly, at the fixed on_date 2005-07-01, so tenure is deterministic.

select results_eq(
  $$ select * from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', '2005-07-01') $$,
  $$ select * from full826_va order by role, rank, member_id $$,
  'the voluntar_activ ranking: each Role''s cohort ranked on its own, holders with no in-range Evaluation at 0');
select results_eq(
  $$ select * from private.role_evaluation_rows('adunarea_generala', '2005-01-01', '2005-06-30', '2005-07-01') $$,
  $$ select * from full826_ag order by role, rank, member_id $$,
  'the adunarea_generala ranking: only Drept de Vot holders, none of the voluntar_activ population');
select is(
  (select count(*) from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', '2005-07-01') as ranked
    where ranked.member_id = '82600000-0000-0000-0000-000000000023'),
  0::bigint,
  'a Voluntar one day short of the tenure gate is absent');
select is(
  (select count(*) from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', '2005-07-01') as ranked
    where ranked.member_id = '82600000-0000-0000-0000-000000000024'),
  0::bigint,
  'a Voluntar with a null joined_at is absent');
select is(
  (select count(*) from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', '2005-07-01') as ranked
    where ranked.member_id = '82600000-0000-0000-0000-000000000015'),
  0::bigint,
  'a deactivated Voluntar Activ holder never appears');
select is(
  (select count(*) from (
      select member_id from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', '2005-07-01')
      union all
      select member_id from private.role_evaluation_rows('adunarea_generala', '2005-01-01', '2005-06-30', '2005-07-01')
    ) as everyone
   where everyone.member_id in ('82600000-0000-0000-0000-000000000001',
                                 '82600000-0000-0000-0000-000000000002',
                                 '82600000-0000-0000-0000-000000000003')),
  0::bigint,
  'Members holding neither Role never appear -- not BC, the BCE or the Recrut');
select is(
  (select bool_and(ranked.inside) from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', '2005-07-01') as ranked
    where ranked.member_id in ('82600000-0000-0000-0000-000000000012', '82600000-0000-0000-0000-000000000013')),
  true,
  'the Voluntar Activ share stays scoped to its own cohort: AA2 and AA3 stay inside despite VT1''s 45 Task Points in the Voluntar cohort');
select is(
  (select cohort_size from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', '2005-07-01') as ranked
    where ranked.member_id = '82600000-0000-0000-0000-000000000011'),
  4,
  'the Voluntar Activ cohort_size stays 4 -- the tenured Voluntars are never merged into it');
select is(
  (select task_points from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', '2005-07-01') as ranked
    where ranked.member_id = '82600000-0000-0000-0000-000000000014'),
  0,
  'AA4''s only Evaluation is dated the day before the Period opens, so she ranks with 0, not absent');
select is(
  (select tenure_since from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', '2005-07-01') as ranked
    where ranked.member_id = '82600000-0000-0000-0000-000000000025'),
  '2005-07-01'::date,
  'a Voluntar whose tenure lands exactly on the Evaluation date is included, tenure_since that date');

-- ==================== 3. Malformed input ====================

select throws_ok(
  $$ select * from private.role_evaluation_rows(null, '2005-01-01', '2005-06-30', '2005-07-01') $$,
  'PT400', 'invalid_role_evaluation_kind',
  'a null kind is malformed');
select throws_ok(
  $$ select * from private.role_evaluation_rows('bogus', '2005-01-01', '2005-06-30', '2005-07-01') $$,
  'PT400', 'invalid_role_evaluation_kind',
  'an unknown kind is malformed');
select throws_ok(
  $$ select * from private.role_evaluation_rows('voluntar_activ', '2005-01-01', null, '2005-07-01') $$,
  'PT400', 'invalid_date_range',
  'a null range end is malformed');
select throws_ok(
  $$ select * from private.role_evaluation_rows('voluntar_activ', '2005-06-30', '2005-01-01', '2005-07-01') $$,
  'PT400', 'invalid_date_range',
  'a range end before its start is malformed');

-- ==================== 4. The read wrapper ====================
-- At the real on_date: kind adunarea_generala (population is on_date-free)
-- plus one voluntar_activ own-row check on an activ holder (likewise
-- on_date-free, since only the Voluntar cohort's membership depends on it).

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select results_eq(
  $$ select * from public.role_evaluation_ranking('adunarea_generala', '2005-01-01', '2005-06-30') $$,
  $$ select * from full826_ag order by role, rank, member_id $$,
  'BC reads the full Drept de Vot ranking');
reset role;

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000032');
select results_eq(
  $$ select * from public.role_evaluation_ranking('adunarea_generala', '2005-01-01', '2005-06-30') $$,
  $$ values ('82600000-0000-0000-0000-000000000032'::uuid, 'vot'::public.member_role, 5, 2, 2, 1, false, null::date) $$,
  'an ordinary Drept de Vot holder reads exactly her own row');
reset role;

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000012');
select results_eq(
  $$ select * from public.role_evaluation_ranking('voluntar_activ', '2005-01-01', '2005-06-30') $$,
  $$ values ('82600000-0000-0000-0000-000000000012'::uuid, 'activ'::public.member_role, 10, 2, 4, 2, true, null::date) $$,
  'an ordinary Voluntar Activ holder reads exactly her own row');
reset role;

select pg_temp.test_login('82600000-0000-0000-0000-000000000031', '{}'::jsonb);
select is(
  (select count(*) from public.role_evaluation_ranking('adunarea_generala', '2005-01-01', '2005-06-30')),
  0::bigint,
  'a claimless session -- a Drept de Vot holder''s own uid -- reads nothing, with no error (house rule 12)');
reset role;

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000033');
select is(
  (select count(*) from public.role_evaluation_ranking('adunarea_generala', '2005-01-01', '2005-06-30')),
  0::bigint,
  'a deactivated Member''s still-valid token reads nothing, with no error');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(
  $$ select * from public.role_evaluation_ranking('adunarea_generala', '2005-01-01', '2005-06-30') $$,
  '42501', null,
  'anon cannot execute the ranking');
reset role;

-- ==================== 5. Missing configuration ====================
-- Last: both deletions are destructive and every earlier section needs the
-- rows. private.role_evaluation_rows checks the top_percent rule before the
-- y setting, so deleting the setting alone proves org_setting_not_found and
-- then also deleting the rule proves promotion_rule_not_found.

delete from public.org_settings where key = 'vote_retention_percent';
select throws_ok(
  $$ select * from private.role_evaluation_rows('adunarea_generala', '2005-01-01', '2005-06-30', '2005-07-01') $$,
  'PT404', 'org_setting_not_found',
  'with no y row the ranking refuses rather than rank against a null share');

delete from public.promotion_rules where kind = 'top_percent';
select throws_ok(
  $$ select * from private.role_evaluation_rows('adunarea_generala', '2005-01-01', '2005-06-30', '2005-07-01') $$,
  'PT404', 'promotion_rule_not_found',
  'with no top_percent rule the ranking refuses before it ever reads the y setting');

select * from finish();
rollback;
