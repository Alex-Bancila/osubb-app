-- role_evaluation_ranking.test.sql -- #826 (ruling R28), rebuilt by R58
-- (Alex, 2026-10-18; spec docs/superpowers/specs/2026-10-18-portofoliu-interne-design.md,
-- section C): the ranking a Role Evaluation reads,
-- private.role_evaluation_rows(kind, from, to, floor, percent, cutoff), and the
-- caller-filtered public.role_evaluation_ranking(role_evaluation_id).
--
-- R58 retired R28's per-Role cohorts and the tenure gate. The voluntar_activ
-- kind ranks every live active Recrut, Voluntar, Voluntar Activ and Voluntar
-- cu Drept de Vot holder in one ranking; since Alex's amendment of
-- 2026-10-24 adunarea_generala ranks the very same pool (the Drept de Vot
-- holders alone no longer shape its line). A Member below the Eligibility
-- Floor is evaluated but not ranked; only the ranked get a rank (rank(), ties
-- share it); share_size
-- = ceil(percent x ranked_count / 100); the line is the Task Points of the
-- share-th ranked Member and everyone at or above it is inside (ties at the
-- boundary too); a Voluntar who joined on or before the Membership Cutoff
-- Date is listable. public.role_evaluation_ranking recomputes a recorded run
-- from its own values and filters the rows for the caller: every row for
-- BC/Moderator/the Adunarea Generală's Group Managers and Responsibles (#512's
-- private.can_read_evaluation_rankings); the caller's own row for any other
-- live active Member in the run's population; nothing, with no error, without
-- organization claims or a live activ Profile.
--
-- In order: 1. shape and grants (wrapper security invoker, body security
-- definer, the unfiltered core invoker and granted to nobody); 2. the
-- population, the one ranking, its ties and the cutoff, the core called
-- directly; 3. the malformed-input errors; 4. the read wrapper's
-- own-row/full-read/nothing split over two recorded runs; 5. the core reads
-- neither the retired top_percent rule nor the retired y setting.
--
-- Fixtures (prefix 82600000-, #826). The demo seed's ladder holders
-- (recrut, voluntar, activ, vot) are deactivated first, so the population is
-- exactly this suite's Members. The Evaluation Period is the fixed range
-- [2005-01-01, 2005-06-30]; the core is called with Floor 5, 25 % and the
-- cutoff 2004-07-01.
--   Voluntar Activ: AA1 15, AA2 10, AA3 10 (tied), AA4 0 (her only
--     Evaluation is dated the day before the Period opens).
--   Voluntar: VT1 45 (joined 2004-01-01), VT2 5 (2004-01-01), VTlimita 0
--     (joined exactly on the cutoff), VTscurt 0 (one day after it), VTnul 0
--     (no join date).
--   Drept de Vot: VOT1 15, VOT2 5. Recrut: 0. Not in any population: BC,
--     BCE, a deactivated Voluntar Activ and a deactivated Drept de Vot holder.
--   voluntar_activ: 12 evaluated, 7 ranked (Floor 5), share ceil(25 x 7 /
--     100) = 2, line = AA1's 15 (VT1 45, then AA1 by member_id), so VOT1, tied
--     with AA1 at 15 beyond the share, is inside too.
--   adunarea_generala (2026-10-24): the same 12 evaluated, 7 ranked, share 2,
--     line 15 -- and listable nowhere, the kind having no cutoff. At 50 % the
--     whole pool's share is ceil(50 x 7 / 100) = 4 and its line 10 (VT1, AA1,
--     VOT1, then AA2 by member_id); the Drept de Vot holders alone would have
--     read share 1, line 15.
--
-- Mutation guards, each named against the assertion that turns red (run as
-- scratch copies of this file on 2026-10-18):
--   * `member.task_points >= member.line_points` -> `>` in the core's inside
--     -> "a tie at the boundary is inside" (and the full voluntar_activ
--     results_eq);
--   * `member.joined_at <= p_cutoff` -> `<` -> "a Voluntar who joined exactly
--     on the cutoff is listable";
--   * (2026-10-24) the core's adunarea_generala arm back to `profile.role =
--     'vot'` -> "the adunarea_generala ranking: the same pool as ...", "the
--     adunarea_generala line is read over the whole pool", "BC and the BCE
--     never appear ...", "BC reads the full Adunarea Generală ranking ...", "an
--     ordinary Drept de Vot holder reads exactly her own row" and "an ordinary
--     Voluntar Activ holder reads exactly her own row of the Adunarea Generală
--     run" (6 of 33 red); `profile.role in (..., 'bce', 'bc', 'moderator')` ->
--     those and "BC and the BCE never appear ..." (10 of 33 red).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(33);

-- ==================== Fixtures ====================

update public.profiles set status = 'inactiv'
 where status = 'activ' and role in ('recrut', 'activ', 'voluntar', 'vot')
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
  -- Joined one day after the cutoff 2004-07-01.
  ('82600000-0000-0000-0000-000000000023', 'VTscurt 826',            'm23-826@test.local', 'voluntar', 'activ', '2004-07-02'),
  ('82600000-0000-0000-0000-000000000024', 'VTnul 826',              'm24-826@test.local', 'voluntar', 'activ', null),
  -- Joined exactly on the cutoff: the boundary.
  ('82600000-0000-0000-0000-000000000025', 'VTlimita 826',           'm25-826@test.local', 'voluntar', 'activ', '2004-07-01'),
  ('82600000-0000-0000-0000-000000000031', 'VOT1 826',               'm31-826@test.local', 'vot',      'activ', null),
  ('82600000-0000-0000-0000-000000000032', 'VOT2 826',               'm32-826@test.local', 'vot',      'activ', null),
  ('82600000-0000-0000-0000-000000000033', 'VOT dezactivat 826',     'm33-826@test.local', 'vot',      'inactiv', null);

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

-- The full voluntar_activ ranking at Floor 5, 25 %, cutoff 2004-07-01.
create temp table full826_va (member_id uuid, role public.member_role, task_points integer, ranked boolean,
                              rank integer, evaluated_count integer, ranked_count integer, share_size integer,
                              line integer, inside boolean, listable boolean);
insert into full826_va values
  ('82600000-0000-0000-0000-000000000021', 'voluntar', 45, true,  1,    12, 7, 2, 15, true,  true),
  ('82600000-0000-0000-0000-000000000011', 'activ',    15, true,  2,    12, 7, 2, 15, true,  false),
  ('82600000-0000-0000-0000-000000000031', 'vot',      15, true,  2,    12, 7, 2, 15, true,  false),
  ('82600000-0000-0000-0000-000000000012', 'activ',    10, true,  4,    12, 7, 2, 15, false, false),
  ('82600000-0000-0000-0000-000000000013', 'activ',    10, true,  4,    12, 7, 2, 15, false, false),
  ('82600000-0000-0000-0000-000000000022', 'voluntar',  5, true,  6,    12, 7, 2, 15, false, true),
  ('82600000-0000-0000-0000-000000000032', 'vot',       5, true,  6,    12, 7, 2, 15, false, false),
  ('82600000-0000-0000-0000-000000000003', 'recrut',    0, false, null, 12, 7, 2, 15, false, false),
  ('82600000-0000-0000-0000-000000000014', 'activ',     0, false, null, 12, 7, 2, 15, false, false),
  ('82600000-0000-0000-0000-000000000023', 'voluntar',  0, false, null, 12, 7, 2, 15, false, false),
  ('82600000-0000-0000-0000-000000000024', 'voluntar',  0, false, null, 12, 7, 2, 15, false, false),
  ('82600000-0000-0000-0000-000000000025', 'voluntar',  0, false, null, 12, 7, 2, 15, false, true);

-- The full adunarea_generala ranking at Floor 5, 25 %: the same pool as the
-- voluntar_activ one (Alex, 2026-10-24), with no cutoff, so nobody is listable.
create temp table full826_ag (member_id uuid, role public.member_role, task_points integer, ranked boolean,
                              rank integer, evaluated_count integer, ranked_count integer, share_size integer,
                              line integer, inside boolean, listable boolean);
insert into full826_ag values
  ('82600000-0000-0000-0000-000000000021', 'voluntar', 45, true,  1,    12, 7, 2, 15, true,  false),
  ('82600000-0000-0000-0000-000000000011', 'activ',    15, true,  2,    12, 7, 2, 15, true,  false),
  ('82600000-0000-0000-0000-000000000031', 'vot',      15, true,  2,    12, 7, 2, 15, true,  false),
  ('82600000-0000-0000-0000-000000000012', 'activ',    10, true,  4,    12, 7, 2, 15, false, false),
  ('82600000-0000-0000-0000-000000000013', 'activ',    10, true,  4,    12, 7, 2, 15, false, false),
  ('82600000-0000-0000-0000-000000000022', 'voluntar',  5, true,  6,    12, 7, 2, 15, false, false),
  ('82600000-0000-0000-0000-000000000032', 'vot',       5, true,  6,    12, 7, 2, 15, false, false),
  ('82600000-0000-0000-0000-000000000003', 'recrut',    0, false, null, 12, 7, 2, 15, false, false),
  ('82600000-0000-0000-0000-000000000014', 'activ',     0, false, null, 12, 7, 2, 15, false, false),
  ('82600000-0000-0000-0000-000000000023', 'voluntar',  0, false, null, 12, 7, 2, 15, false, false),
  ('82600000-0000-0000-0000-000000000024', 'voluntar',  0, false, null, 12, 7, 2, 15, false, false),
  ('82600000-0000-0000-0000-000000000025', 'voluntar',  0, false, null, 12, 7, 2, 15, false, false);

grant select on full826_va, full826_ag to authenticated;

-- Two recorded runs, written as the owner (run_role_evaluation's own suites
-- exercise the command), each with the values the core is called with.
insert into public.role_evaluations
  (kind, name, period_from, period_to, run_by, threshold_used, threshold_computed, ranked_count,
   eligibility_floor, percent_used, membership_cutoff, evaluated_count)
values
  ('voluntar_activ',    'Evaluare VA 826', '2005-01-01', '2005-06-30',
   '82600000-0000-0000-0000-000000000001', null, 15, 7, 5, 25, '2004-07-01', 12),
  ('adunarea_generala', 'Evaluare AG 826', '2005-01-01', '2005-06-30',
   '82600000-0000-0000-0000-000000000001', null, 15, 7, 5, 25, null, 12);

create temp table runs826 as
  select (select id from public.role_evaluations where name = 'Evaluare VA 826') as va,
         (select id from public.role_evaluations where name = 'Evaluare AG 826') as ag;
grant select on runs826 to authenticated, anon;

-- ==================== 1. Shape and grants ====================

select has_function('public', 'role_evaluation_ranking', array['bigint'],
  'public.role_evaluation_ranking(p_role_evaluation_id bigint) exists');
select is(
  (select array_agg(format('%s:%s:%s', p.proname, p.prosecdef::text, p.provolatile) order by p.proname)
     from pg_proc p
    where p.oid in ('public.role_evaluation_ranking(bigint)'::regprocedure,
                    'private.role_evaluation_ranking_impl(bigint)'::regprocedure,
                    'private.role_evaluation_rows(text, date, date, integer, integer, date)'::regprocedure)),
  array['role_evaluation_ranking:false:s', 'role_evaluation_ranking_impl:true:s', 'role_evaluation_rows:false:s'],
  'the wrapper is security invoker, the body security definer, the core invoker; all three are stable -- none can write a row');
select is(
  array[has_function_privilege('authenticated', 'public.role_evaluation_ranking(bigint)', 'execute'),
        has_function_privilege('anon', 'public.role_evaluation_ranking(bigint)', 'execute'),
        has_function_privilege('service_role', 'public.role_evaluation_ranking(bigint)', 'execute'),
        has_function_privilege('public', 'public.role_evaluation_ranking(bigint)', 'execute'),
        has_function_privilege('authenticated', 'private.role_evaluation_ranking_impl(bigint)', 'execute'),
        has_function_privilege('anon', 'private.role_evaluation_ranking_impl(bigint)', 'execute'),
        has_function_privilege('service_role', 'private.role_evaluation_ranking_impl(bigint)', 'execute'),
        has_function_privilege('public', 'private.role_evaluation_ranking_impl(bigint)', 'execute')],
  array[true, false, false, false, true, false, false, false],
  'the wrapper and its body: execute for authenticated only');
select is(
  array[has_function_privilege('authenticated', 'private.role_evaluation_rows(text, date, date, integer, integer, date)', 'execute'),
        has_function_privilege('anon', 'private.role_evaluation_rows(text, date, date, integer, integer, date)', 'execute'),
        has_function_privilege('service_role', 'private.role_evaluation_rows(text, date, date, integer, integer, date)', 'execute'),
        has_function_privilege('public', 'private.role_evaluation_rows(text, date, date, integer, integer, date)', 'execute')],
  array[false, false, false, false],
  'the unfiltered core is executable by nobody -- the bodies read it from a security-definer call');
select ok(
  pg_get_functiondef('private.role_evaluation_ranking_impl(bigint)'::regprocedure) ~ 'can_read_evaluation_rankings',
  'the body''s full read is #512''s predicate');

-- ==================== 2. The population and the one ranking ====================

select results_eq(
  $$ select * from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', 5, 25, '2004-07-01') $$,
  $$ select * from full826_va order by task_points desc, member_id $$,
  'the voluntar_activ ranking: one ranking of every Recrut, Voluntar and holder, the Floor deciding who is ranked');
select results_eq(
  $$ select * from private.role_evaluation_rows('adunarea_generala', '2005-01-01', '2005-06-30', 5, 25, null) $$,
  $$ select * from full826_ag order by task_points desc, member_id $$,
  'the adunarea_generala ranking: the same pool as the voluntar_activ one -- Recruți, Voluntari, Voluntari Activi and holders -- with no cutoff needed and nobody listable');
select results_eq(
  $$ select distinct line, share_size, evaluated_count, ranked_count
       from private.role_evaluation_rows('adunarea_generala', '2005-01-01', '2005-06-30', 5, 50, null) $$,
  $$ values (10, 4, 12, 7) $$,
  'the adunarea_generala line is read over the whole pool: 50 % of 7 ranked is a share of 4 and a line of 10 -- the Drept de Vot holders alone would have read a share of 1 and a line of 15');
select is(
  (select inside from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', 5, 25, '2004-07-01') as ranked
    where ranked.member_id = '82600000-0000-0000-0000-000000000031'),
  true,
  'a tie at the boundary is inside: VOT1, third by member_id with a share of 2, has the line''s 15 Task Points');
select is(
  (select array_agg(rank order by member_id) from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', 5, 25, '2004-07-01') as ranked
    where ranked.member_id in ('82600000-0000-0000-0000-000000000012', '82600000-0000-0000-0000-000000000013')),
  array[4, 4],
  'tied Members share their rank (AA2 and AA3, both 4th)');
select is(
  (select count(*) from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', 5, 25, '2004-07-01') as ranked
    where ranked.member_id = '82600000-0000-0000-0000-000000000015'),
  0::bigint,
  'a deactivated Voluntar Activ holder never appears');
select is(
  (select array_agg(everyone.kind || ':' || everyone.member_id order by everyone.kind, everyone.member_id) from (
      select 'voluntar_activ' as kind, member_id
        from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', 5, 25, '2004-07-01')
      union all
      select 'adunarea_generala', member_id
        from private.role_evaluation_rows('adunarea_generala', '2005-01-01', '2005-06-30', 5, 25, null)
    ) as everyone
   where everyone.member_id in ('82600000-0000-0000-0000-000000000001',
                                 '82600000-0000-0000-0000-000000000002',
                                 '82600000-0000-0000-0000-000000000003')),
  array['adunarea_generala:82600000-0000-0000-0000-000000000003',
        'voluntar_activ:82600000-0000-0000-0000-000000000003'],
  'BC and the BCE never appear in either ranking; the Recrut appears in both (Alex, 2026-10-24: the Adunarea Generală kind ranks the same pool)');
select results_eq(
  $$ select task_points, ranked, rank from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', 5, 25, '2004-07-01') as ranked
      where ranked.member_id = '82600000-0000-0000-0000-000000000014' $$,
  $$ values (0, false, null::int) $$,
  'AA4''s only Evaluation is dated the day before the Period opens: evaluated at 0, below the Floor, not ranked');
select is(
  (select listable from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', 5, 25, '2004-07-01') as ranked
    where ranked.member_id = '82600000-0000-0000-0000-000000000025'),
  true,
  'a Voluntar who joined exactly on the cutoff is listable');
select is(
  (select listable from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', 5, 25, '2004-07-01') as ranked
    where ranked.member_id = '82600000-0000-0000-0000-000000000023'),
  false,
  'a Voluntar who joined one day after the cutoff is evaluated but not listable');
select is(
  (select listable from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', 5, 25, '2004-07-01') as ranked
    where ranked.member_id = '82600000-0000-0000-0000-000000000024'),
  false,
  'a Voluntar with no join date is evaluated but never listable');

-- ==================== 3. Malformed input ====================

select throws_ok(
  $$ select * from private.role_evaluation_rows(null, '2005-01-01', '2005-06-30', 5, 25, '2004-07-01') $$,
  'PT400', 'invalid_role_evaluation_kind',
  'a null kind is malformed');
select throws_ok(
  $$ select * from private.role_evaluation_rows('bogus', '2005-01-01', '2005-06-30', 5, 25, '2004-07-01') $$,
  'PT400', 'invalid_role_evaluation_kind',
  'an unknown kind is malformed');
select throws_ok(
  $$ select * from private.role_evaluation_rows('voluntar_activ', '2005-01-01', null, 5, 25, '2004-07-01') $$,
  'PT400', 'invalid_date_range',
  'a null range end is malformed');
select throws_ok(
  $$ select * from private.role_evaluation_rows('voluntar_activ', '2005-06-30', '2005-01-01', 5, 25, '2004-07-01') $$,
  'PT400', 'invalid_date_range',
  'a range end before its start is malformed');
select throws_ok(
  $$ select * from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', 0, 25, '2004-07-01') $$,
  'PT400', 'invalid_eligibility_floor',
  'a Floor below 1 is malformed');
select throws_ok(
  $$ select * from private.role_evaluation_rows('adunarea_generala', '2005-01-01', '2005-06-30', 5, 0, null) $$,
  'PT400', 'invalid_percent',
  'a share of 0 is malformed');
select throws_ok(
  $$ select * from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', 5, 25, null) $$,
  'PT400', 'membership_cutoff_not_set',
  'the voluntar_activ kind without a cutoff is refused');

-- ==================== 4. The read wrapper ====================

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select results_eq(
  $$ select * from public.role_evaluation_ranking((select ag from runs826)) $$,
  $$ select * from full826_ag order by task_points desc, member_id $$,
  'BC reads the full Adunarea Generală ranking of a recorded run: the whole pool, recomputed from the run''s own values');
select results_eq(
  $$ select * from public.role_evaluation_ranking((select va from runs826)) $$,
  $$ select * from full826_va order by task_points desc, member_id $$,
  'BC reads the full Voluntar Activ ranking of a recorded run, recomputed from its Floor, share and cutoff');
reset role;

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000032');
select results_eq(
  $$ select * from public.role_evaluation_ranking((select ag from runs826)) $$,
  $$ select * from full826_ag where member_id = '82600000-0000-0000-0000-000000000032' $$,
  'an ordinary Drept de Vot holder reads exactly her own row');
reset role;

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000012');
select results_eq(
  $$ select * from public.role_evaluation_ranking((select va from runs826)) $$,
  $$ select * from full826_va where member_id = '82600000-0000-0000-0000-000000000012' $$,
  'an ordinary Voluntar Activ holder reads exactly her own row');
select results_eq(
  $$ select * from public.role_evaluation_ranking((select ag from runs826)) $$,
  $$ select * from full826_ag where member_id = '82600000-0000-0000-0000-000000000012' $$,
  'an ordinary Voluntar Activ holder reads exactly her own row of the Adunarea Generală run too: she is in its pool');
reset role;

select pg_temp.test_login('82600000-0000-0000-0000-000000000031', '{}'::jsonb);
select is(
  (select count(*) from public.role_evaluation_ranking((select ag from runs826))),
  0::bigint,
  'a claimless session -- a Drept de Vot holder''s own uid -- reads nothing, with no error (house rule 12)');
reset role;

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000033');
select is(
  (select count(*) from public.role_evaluation_ranking((select ag from runs826))),
  0::bigint,
  'a deactivated Member''s still-valid token reads nothing, with no error');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(
  $$ select * from public.role_evaluation_ranking((select ag from runs826)) $$,
  '42501', null,
  'anon cannot execute the ranking');
reset role;

-- ==================== 5. Nothing retired is read ====================
-- R58 retired the top_percent rule's percent and tenure and the
-- vote_retention_percent setting: the core is given its share and cutoff.

select ok(
  pg_get_functiondef('private.role_evaluation_rows(text, date, date, integer, integer, date)'::regprocedure)
    !~ 'promotion_rules|org_settings|min_tenure_months',
  'the core reads no Promotion Rule and no organization setting');
select results_eq(
  $$ select * from private.role_evaluation_rows('voluntar_activ', '2005-01-01', '2005-06-30', 5, 25, '2004-07-01') $$,
  $$ select * from full826_va order by task_points desc, member_id $$,
  'with the Promotion Rules dropped (R58) the ranking is unchanged: it is a function of its arguments and the ledger');

select * from finish();
rollback;
