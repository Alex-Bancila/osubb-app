-- retention_ranking.test.sql -- #48: the retention ranking of a closed
-- Evaluation Period and y, its Vote Retention Threshold setting.
--
-- public.retention_ranking(p_period_id) ranks every live active Voluntar
-- Activ (activ) and Voluntar cu Drept de Vot (vot) holder inside their Role's
-- cohort by the Period's Task Points and marks who is inside their share:
-- share = ceil(percent / 100 x cohort size), inside = rank <= share (ties at
-- the boundary inside) -- #49's stamp rule, per cohort. activ reads the
-- top_percent Promotion Rule's percent (x, seeded 30); vot reads
-- org_settings.vote_retention_percent (y, seeded 25). BC, the Moderator and
-- the Adunarea Generală's Group Managers / Responsibles read every row
-- (#512's private.can_read_evaluation_rankings); any other live Member reads
-- their own row; claimless and deactivated sessions read nothing.
--
-- In order: shape and grants; the persona matrix at x = 30, y = 25; the
-- boundaries moved to x = 60 (as fixture data) and y = 50 (through
-- set_org_setting -- no migration); the errors; nothing writes a Role; the y
-- setting's validation; the missing-configuration refusals.
--
-- Fixtures. One closed Period [2005-01-01, 2005-07-01) and one open Period
-- from 2006-01-01, written as the owner inside this rolled-back transaction
-- (conventions section 10's fixture exception: #701's commands open at now(), and
-- these Periods are dated in the past).
-- The demo seed's two Role holders are deactivated first, so the cohorts are
-- exactly this suite's Members. In-Period Task Points (Difficulty x
-- rating_mult(Rating)):
--   Voluntar Activ (cohort 7): A1 30, A2 24, A3 18, A4 18, A5 12, A6 6, A7 0
--     (A7's only award, 15, is dated the day before the Period opens);
--   Drept de Vot   (cohort 5): V1 20, V2 16, V3 12, V4 4 (the AG's Group
--     Responsible), V5 0 (never awarded);
--   holding neither Role, all with Task Points: the Voluntar 45, the BCE 30,
--     the Recrut 9; and a deactivated Voluntar Activ with 30.
-- At x = 30: share ceil(2.1) = 3 -> A1, A2 and both A3/A4 (tied at rank 3)
-- inside, A5 out. At x = 60: share ceil(4.2) = 5 -> A5 inside, A6 out.
-- At y = 25: share ceil(1.25) = 2 -> V1, V2 inside, V3 out. At y = 50: share
-- ceil(2.5) = 3 -> V3 inside, V4 out.
--
-- Mutation guards, each named against the assertion that turns red (every
-- one was run on 2026-09-25 against the live database and turned its named
-- assertion red):
--   * ceil -> floor in the share -> "x = 30: the Voluntar Activ share of 7 is
--     3" (floor gives 2) and "y = 25: the Drept de Vot share of 5 is 2";
--   * row_number() for rank() -> "x = 30: ..." (A4, tied with the third,
--     falls outside);
--   * rank over the whole Period instead of per Role -> "BC reads the full
--     retention ranking";
--   * read x for vot -> "x does not move the Drept de Vot boundary"; read y
--     for activ -> "y does not move the Voluntar Activ boundary";
--   * a literal 25 instead of the setting -> "y = 50 set through
--     set_org_setting moves the Drept de Vot boundary";
--   * inner join instead of left join to the Period ranking -> "BC reads the
--     full retention ranking" (A7 and V5 disappear);
--   * drop `status = 'activ'` -> "Members holding neither Role never appear"
--     (the deactivated holder appears);
--   * widen the Role filter (role >= activ) -> "every row holds Voluntar Activ
--     or Drept de Vot";
--   * drop the own-row branch -> "Voluntar Activ A5 reads exactly her own
--     row"; widen the read to every row -> "a Voluntar reads nothing";
--   * a level >= 6 check instead of #512's predicate -> "the Adunarea
--     Generală's Group Responsible reads the full retention ranking";
--   * drop the claims gate -> "a claimless session ... reads nothing";
--   * drop the closed check -> "an open Period is refused";
--   * drop the vote_retention_percent step-1 check -> "a y of 0 is malformed
--     for every caller" (42501 instead) and "BC: y above 100 is refused"
--     (23514 instead).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(44);

-- ==================== Fixtures ====================

-- The demo seed's Voluntar Activ / Drept de Vot holders leave the cohorts.
update public.profiles set status = 'inactiv'
 where role in ('activ', 'vot') and id::text not like '48000000-%';

insert into auth.users (id, email)
select ('48000000-0000-0000-0000-0000000000' || suffix)::uuid, 'm' || suffix || '-48@test.local'
  from unnest(array['01', '02', '03', '04', '05',
                    '11', '12', '13', '14', '15', '16', '17',
                    '21', '22', '23', '24', '25']) as suffix;

insert into public.profiles (id, full_name, email, role, status) values
  ('48000000-0000-0000-0000-000000000001', 'BC 48',                  'm01-48@test.local', 'bc',       'activ'),
  ('48000000-0000-0000-0000-000000000002', 'BCE 48',                 'm02-48@test.local', 'bce',      'activ'),
  ('48000000-0000-0000-0000-000000000003', 'Voluntar 48',            'm03-48@test.local', 'voluntar', 'activ'),
  ('48000000-0000-0000-0000-000000000004', 'Recrut 48',              'm04-48@test.local', 'recrut',   'activ'),
  -- Deactivated, still holding the Voluntar Activ token it was issued.
  ('48000000-0000-0000-0000-000000000005', 'Activ dezactivat 48',    'm05-48@test.local', 'activ',    'inactiv'),
  ('48000000-0000-0000-0000-000000000011', 'A1 48',                  'm11-48@test.local', 'activ',    'activ'),
  ('48000000-0000-0000-0000-000000000012', 'A2 48',                  'm12-48@test.local', 'activ',    'activ'),
  ('48000000-0000-0000-0000-000000000013', 'A3 48',                  'm13-48@test.local', 'activ',    'activ'),
  ('48000000-0000-0000-0000-000000000014', 'A4 48',                  'm14-48@test.local', 'activ',    'activ'),
  ('48000000-0000-0000-0000-000000000015', 'A5 48',                  'm15-48@test.local', 'activ',    'activ'),
  ('48000000-0000-0000-0000-000000000016', 'A6 48',                  'm16-48@test.local', 'activ',    'activ'),
  ('48000000-0000-0000-0000-000000000017', 'A7 48',                  'm17-48@test.local', 'activ',    'activ'),
  ('48000000-0000-0000-0000-000000000021', 'V1 48',                  'm21-48@test.local', 'vot',      'activ'),
  ('48000000-0000-0000-0000-000000000022', 'V2 48',                  'm22-48@test.local', 'vot',      'activ'),
  ('48000000-0000-0000-0000-000000000023', 'V3 48',                  'm23-48@test.local', 'vot',      'activ'),
  ('48000000-0000-0000-0000-000000000024', 'V4 Responsabil AG 48',   'm24-48@test.local', 'vot',      'activ'),
  ('48000000-0000-0000-0000-000000000025', 'V5 48',                  'm25-48@test.local', 'vot',      'activ');

insert into public.groups (name, category, min_level) values ('Grup Retenție 48', 'department', 0);
insert into public.groups (name, category, parent_id, min_level)
select 'AG 48', 'team', parent.id, 3
  from public.groups as parent where parent.name = 'Grup Retenție 48';
insert into public.group_members (group_id, member_id, group_role)
select grp.id, '48000000-0000-0000-0000-000000000024', 'responsible'
  from public.groups as grp where grp.name = 'AG 48';
-- The Adunarea Generală is AG 48, by row (#512).
update public.org_settings set value = (select id::text from public.groups where name = 'AG 48')
 where key = 'adunarea_generala_group_id';

insert into public.evaluation_periods (name, opened_at, opened_by, closed_at, closed_by) values
  ('Perioada închisă #48', '2005-01-01 00:00:00+00', '48000000-0000-0000-0000-000000000001',
   '2005-07-01 00:00:00+00', '48000000-0000-0000-0000-000000000001');
insert into public.evaluation_periods (name, opened_at, opened_by) values
  ('Perioada deschisă #48', '2006-01-01 00:00:00+00', '48000000-0000-0000-0000-000000000001');

create temp table fx48 as
  select (select id from public.evaluation_periods where name = 'Perioada închisă #48')  as closed,
         (select id from public.evaluation_periods where name = 'Perioada deschisă #48') as open,
         (select max(id) + 1000 from public.evaluation_periods)                          as unknown;
grant select on fx48 to authenticated, anon;

-- rating 5 -> x3, rating 4 -> x2, rating 3 -> x1.
create temp table credits48 (title text, difficulty int, rating int, member_id uuid, awarded_at timestamptz);
insert into credits48 values
  ('A1a #48', 5, 5, '48000000-0000-0000-0000-000000000011', '2005-03-01 12:00:00+00'),
  ('A1b #48', 5, 5, '48000000-0000-0000-0000-000000000011', '2005-03-02 12:00:00+00'),
  ('A2a #48', 5, 5, '48000000-0000-0000-0000-000000000012', '2005-03-01 12:00:00+00'),
  ('A2b #48', 3, 5, '48000000-0000-0000-0000-000000000012', '2005-03-02 12:00:00+00'),
  ('A3a #48', 5, 5, '48000000-0000-0000-0000-000000000013', '2005-03-01 12:00:00+00'),
  ('A3b #48', 1, 5, '48000000-0000-0000-0000-000000000013', '2005-03-02 12:00:00+00'),
  ('A4a #48', 3, 5, '48000000-0000-0000-0000-000000000014', '2005-03-01 12:00:00+00'),
  ('A4b #48', 3, 5, '48000000-0000-0000-0000-000000000014', '2005-03-02 12:00:00+00'),
  ('A5 #48',  4, 5, '48000000-0000-0000-0000-000000000015', '2005-03-01 12:00:00+00'),
  ('A6 #48',  2, 5, '48000000-0000-0000-0000-000000000016', '2005-03-01 12:00:00+00'),
  -- The day before the Period opens: outside it.
  ('A7 #48',  5, 5, '48000000-0000-0000-0000-000000000017', '2004-12-31 12:00:00+00'),
  ('V1a #48', 5, 5, '48000000-0000-0000-0000-000000000021', '2005-03-01 12:00:00+00'),
  ('V1b #48', 5, 3, '48000000-0000-0000-0000-000000000021', '2005-03-02 12:00:00+00'),
  ('V2a #48', 4, 5, '48000000-0000-0000-0000-000000000022', '2005-03-01 12:00:00+00'),
  ('V2b #48', 2, 4, '48000000-0000-0000-0000-000000000022', '2005-03-02 12:00:00+00'),
  ('V3 #48',  4, 5, '48000000-0000-0000-0000-000000000023', '2005-03-01 12:00:00+00'),
  ('V4 #48',  2, 4, '48000000-0000-0000-0000-000000000024', '2005-03-01 12:00:00+00'),
  ('Vol a #48', 5, 5, '48000000-0000-0000-0000-000000000003', '2005-03-01 12:00:00+00'),
  ('Vol b #48', 5, 5, '48000000-0000-0000-0000-000000000003', '2005-03-02 12:00:00+00'),
  ('Vol c #48', 5, 5, '48000000-0000-0000-0000-000000000003', '2005-03-03 12:00:00+00'),
  ('BCE a #48', 5, 5, '48000000-0000-0000-0000-000000000002', '2005-03-01 12:00:00+00'),
  ('BCE b #48', 5, 5, '48000000-0000-0000-0000-000000000002', '2005-03-02 12:00:00+00'),
  ('Recrut #48', 3, 5, '48000000-0000-0000-0000-000000000004', '2005-03-01 12:00:00+00'),
  ('Dezactivat a #48', 5, 5, '48000000-0000-0000-0000-000000000005', '2005-03-01 12:00:00+00'),
  ('Dezactivat b #48', 5, 5, '48000000-0000-0000-0000-000000000005', '2005-03-02 12:00:00+00');

insert into public.tasks
  (title, description, deadline, group_id, status, difficulty, rating,
   created_by, created_at, completed_at)
select credit.title, 'Fixture', now() - interval '2 days',
       (select id from public.groups where name = 'Grup Retenție 48'),
       'completed', credit.difficulty, credit.rating, '48000000-0000-0000-0000-000000000001',
       now() - interval '3 days', now()
  from credits48 as credit;

select pg_temp.test_credit_task(task.id, credit.member_id, '48000000-0000-0000-0000-000000000001',
                                p_awarded_at => credit.awarded_at)
  from credits48 as credit
  join public.tasks as task on task.title = credit.title
 order by task.id;

create function pg_temp.login_stale_activ() returns void language sql as $$
  select pg_temp.test_login('48000000-0000-0000-0000-000000000005', jsonb_build_object(
    'member_role', 'activ', 'member_level', 2,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb, 'group_ids', '[]'::jsonb));
$$;

-- The full retention ranking at x = 30, y = 25.
create temp table full48 (member_id uuid, role public.member_role, task_points integer, rank integer,
                          cohort_size integer, share_size integer, inside boolean);
insert into full48 values
  ('48000000-0000-0000-0000-000000000011', 'activ', 30, 1, 7, 3, true),
  ('48000000-0000-0000-0000-000000000012', 'activ', 24, 2, 7, 3, true),
  ('48000000-0000-0000-0000-000000000013', 'activ', 18, 3, 7, 3, true),
  ('48000000-0000-0000-0000-000000000014', 'activ', 18, 3, 7, 3, true),
  ('48000000-0000-0000-0000-000000000015', 'activ', 12, 5, 7, 3, false),
  ('48000000-0000-0000-0000-000000000016', 'activ',  6, 6, 7, 3, false),
  ('48000000-0000-0000-0000-000000000017', 'activ',  0, 7, 7, 3, false),
  ('48000000-0000-0000-0000-000000000021', 'vot',   20, 1, 5, 2, true),
  ('48000000-0000-0000-0000-000000000022', 'vot',   16, 2, 5, 2, true),
  ('48000000-0000-0000-0000-000000000023', 'vot',   12, 3, 5, 2, false),
  ('48000000-0000-0000-0000-000000000024', 'vot',    4, 4, 5, 2, false),
  ('48000000-0000-0000-0000-000000000025', 'vot',    0, 5, 5, 2, false);
grant select on full48 to authenticated;

create function pg_temp.ranking() returns text language sql as $$
  select format('select * from public.retention_ranking(%s)', (select closed from fx48));
$$;
grant execute on function pg_temp.ranking() to authenticated;

-- What nothing in #48 may write.
create temp table roles_before48 as select id, role, status from public.profiles;
create temp table role_history_before48 as select count(*) as n from public.role_history;

-- ==================== 1. Shape and grants ====================

select has_function('public', 'retention_ranking', array['bigint'],
  'public.retention_ranking(bigint) exists');
select is(
  (select array_agg(format('%s:%s:%s', p.proname, p.prosecdef::text, p.provolatile) order by p.proname)
     from pg_proc p
    where p.oid in ('public.retention_ranking(bigint)'::regprocedure,
                    'private.retention_ranking_impl(bigint)'::regprocedure,
                    'private.retention_ranking_rows(bigint)'::regprocedure)),
  array['retention_ranking:false:s', 'retention_ranking_impl:true:s', 'retention_ranking_rows:false:s'],
  'the wrapper is security invoker, the body security definer, the core invoker; all three are stable -- none can write a row');
select is(
  array[has_function_privilege('authenticated', 'public.retention_ranking(bigint)', 'execute'),
        has_function_privilege('anon', 'public.retention_ranking(bigint)', 'execute'),
        has_function_privilege('service_role', 'public.retention_ranking(bigint)', 'execute'),
        has_function_privilege('public', 'public.retention_ranking(bigint)', 'execute'),
        has_function_privilege('authenticated', 'private.retention_ranking_impl(bigint)', 'execute'),
        has_function_privilege('anon', 'private.retention_ranking_impl(bigint)', 'execute'),
        has_function_privilege('service_role', 'private.retention_ranking_impl(bigint)', 'execute'),
        has_function_privilege('public', 'private.retention_ranking_impl(bigint)', 'execute')],
  array[true, false, false, false, true, false, false, false],
  'the wrapper and its body: execute for authenticated only');
select is(
  array[has_function_privilege('authenticated', 'private.retention_ranking_rows(bigint)', 'execute'),
        has_function_privilege('anon', 'private.retention_ranking_rows(bigint)', 'execute'),
        has_function_privilege('service_role', 'private.retention_ranking_rows(bigint)', 'execute'),
        has_function_privilege('public', 'private.retention_ranking_rows(bigint)', 'execute')],
  array[false, false, false, false],
  'the unfiltered core is executable by nobody -- #51 reads it from a security-definer body');
select ok(
  pg_get_functiondef('private.retention_ranking_impl(bigint)'::regprocedure) ~ 'can_read_evaluation_rankings'
  and pg_get_functiondef('private.retention_ranking_impl(bigint)'::regprocedure) !~* 'is_interne|responsabil|>= *[1-9]',
  'the body''s full read is #512''s predicate alone -- no level threshold, no retired rank, no flag');

-- ==================== 2. The personas at x = 30, y = 25 ====================

select pg_temp.test_login_leadership('48000000-0000-0000-0000-000000000001');
select results_eq(pg_temp.ranking(), $$ select * from full48 order by role, rank, member_id $$,
  'BC reads the full retention ranking: each Role''s cohort ranked on its own, holders with no in-Period points at 0');
select results_eq(
  format($$ select member_id from public.retention_ranking(%s) where role = 'activ' and inside $$, (select closed from fx48)),
  $$ values ('48000000-0000-0000-0000-000000000011'::uuid), ('48000000-0000-0000-0000-000000000012'),
            ('48000000-0000-0000-0000-000000000013'), ('48000000-0000-0000-0000-000000000014') $$,
  'x = 30: the Voluntar Activ share of 7 is 3 (ceil 2.1), and A4, tied with the third, is inside too; A5 is not');
select results_eq(
  format($$ select member_id from public.retention_ranking(%s) where role = 'vot' and inside $$, (select closed from fx48)),
  $$ values ('48000000-0000-0000-0000-000000000021'::uuid), ('48000000-0000-0000-0000-000000000022') $$,
  'y = 25: the Drept de Vot share of 5 is 2 (ceil 1.25); V3 is outside');
select is(
  (select count(*) from public.retention_ranking((select closed from fx48)) as ranked
    where ranked.member_id in ('48000000-0000-0000-0000-000000000001', '48000000-0000-0000-0000-000000000002',
                               '48000000-0000-0000-0000-000000000003', '48000000-0000-0000-0000-000000000004',
                               '48000000-0000-0000-0000-000000000005')),
  0::bigint,
  'Members holding neither Role never appear -- not the Voluntar (45), the BCE (30) or the Recrut (9) with their points, nor the deactivated Voluntar Activ');
select is(
  (select count(*) from public.retention_ranking((select closed from fx48)) as ranked
    where ranked.role not in ('activ', 'vot')),
  0::bigint,
  'every row holds Voluntar Activ or Drept de Vot');
reset role;

select pg_temp.test_login_leadership('48000000-0000-0000-0000-000000000024');
select results_eq(pg_temp.ranking(), $$ select * from full48 order by role, rank, member_id $$,
  'the Adunarea Generală''s Group Responsible reads the full retention ranking');
reset role;

select pg_temp.test_login_leadership('48000000-0000-0000-0000-000000000015');
select results_eq(pg_temp.ranking(),
  $$ select * from full48 where member_id = '48000000-0000-0000-0000-000000000015' $$,
  'Voluntar Activ A5 reads exactly her own row -- outside her share');
reset role;

select pg_temp.test_login_leadership('48000000-0000-0000-0000-000000000021');
select results_eq(pg_temp.ranking(),
  $$ select * from full48 where member_id = '48000000-0000-0000-0000-000000000021' $$,
  'Drept de Vot holder V1, with no Group Role in the AG, reads exactly his own row');
reset role;

select pg_temp.test_login_leadership('48000000-0000-0000-0000-000000000003');
select is((select count(*) from public.retention_ranking((select closed from fx48))), 0::bigint,
  'a Voluntar reads nothing -- no row of their own and no full read');
reset role;

select pg_temp.test_login_leadership('48000000-0000-0000-0000-000000000002');
select is((select count(*) from public.retention_ranking((select closed from fx48))), 0::bigint,
  'a BCE with no Group Role in the AG reads nothing -- level 5 is not the full read');
reset role;

select pg_temp.test_login('48000000-0000-0000-0000-000000000024', '{}'::jsonb);
select is((select count(*) from public.retention_ranking((select closed from fx48))), 0::bigint,
  'a claimless session -- the AG Responsible''s own uid -- reads nothing (house rule 12)');
select is((select count(*) from public.retention_ranking((select unknown from fx48))), 0::bigint,
  'a claimless session is not even told whether a Period exists');
reset role;

select pg_temp.test_clear_jwt();
set local role authenticated;
select is((select count(*) from public.retention_ranking((select closed from fx48))), 0::bigint,
  'a session with no JWT at all reads nothing');
reset role;

select pg_temp.login_stale_activ();
select is((select count(*) from public.retention_ranking((select closed from fx48))), 0::bigint,
  'a deactivated Voluntar Activ''s still-valid token reads nothing');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(
  $$ select * from public.retention_ranking((select closed from fx48)) $$,
  '42501', null,
  'anon cannot execute the retention ranking');
reset role;

-- #51's read: the core, as the owner and with no caller at all.
select pg_temp.test_clear_jwt();
select results_eq(
  format('select * from private.retention_ranking_rows(%s)', (select closed from fx48)),
  $$ select * from full48 order by role, rank, member_id $$,
  'the unfiltered core returns every row to a security-definer caller, with no session');

-- ==================== 3. Moving the boundaries ====================

-- x is the Promotion Rule's own percent -- data, changed here as the owner
-- (no command edits it; #702's set_promotion_rule writes initial_threshold).
update public.promotion_rules set percent = 60 where kind = 'top_percent';

select pg_temp.test_login_leadership('48000000-0000-0000-0000-000000000001');
select results_eq(
  format($$ select member_id, share_size from public.retention_ranking(%s) where role = 'activ' and inside $$, (select closed from fx48)),
  $$ values ('48000000-0000-0000-0000-000000000011'::uuid, 5), ('48000000-0000-0000-0000-000000000012', 5),
            ('48000000-0000-0000-0000-000000000013', 5), ('48000000-0000-0000-0000-000000000014', 5),
            ('48000000-0000-0000-0000-000000000015', 5) $$,
  'x = 60: the Voluntar Activ share of 7 is 5 (ceil 4.2) -- A5 is now inside, A6 is not');
select results_eq(
  format($$ select member_id from public.retention_ranking(%s) where role = 'vot' and inside $$, (select closed from fx48)),
  $$ values ('48000000-0000-0000-0000-000000000021'::uuid), ('48000000-0000-0000-0000-000000000022') $$,
  'x does not move the Drept de Vot boundary -- that is y''s');

select lives_ok($$ select public.set_org_setting('vote_retention_percent', '50') $$,
  'BC sets y to 50 through set_org_setting -- no migration');
select results_eq(
  format($$ select member_id, share_size from public.retention_ranking(%s) where role = 'vot' and inside $$, (select closed from fx48)),
  $$ values ('48000000-0000-0000-0000-000000000021'::uuid, 3), ('48000000-0000-0000-0000-000000000022', 3),
            ('48000000-0000-0000-0000-000000000023', 3) $$,
  'y = 50 set through set_org_setting moves the Drept de Vot boundary: share of 5 is 3 (ceil 2.5) -- V3 inside, V4 not');
select is(
  (select count(*) from public.retention_ranking((select closed from fx48)) where role = 'activ' and inside),
  5::bigint,
  'y does not move the Voluntar Activ boundary -- that is x''s');

-- ==================== 4. Errors ====================

select throws_ok(
  format('select * from public.retention_ranking(%s)', (select open from fx48)),
  'PT409', 'evaluation_period_open',
  'an open Period is refused -- its ranking is still moving');
select throws_ok(
  format('select * from public.retention_ranking(%s)', (select unknown from fx48)),
  'PT404', 'evaluation_period_not_found',
  'an unknown Period is PT404 evaluation_period_not_found');
reset role;

-- ==================== 5. Nothing writes a Role ====================

select results_eq(
  $$ select id, role, status from public.profiles order by id $$,
  $$ select id, role, status from roles_before48 order by id $$,
  'running the ranking, at every persona and both boundaries, leaves profiles.role (and status) untouched');
select is((select count(*) from public.role_history), (select n from role_history_before48),
  'and writes no role_history row');

-- ==================== 6. The y setting ====================

select is((select value from public.org_settings where key = 'vote_retention_percent'), '50',
  'y is stored as BC set it');
select throws_ok(
  $$ update public.org_settings set value = '0' where key = 'vote_retention_percent' $$,
  '23514', 'new row for relation "org_settings" violates check constraint "org_settings_vote_retention_percent_ck"',
  'org_settings_vote_retention_percent_ck: 0 is refused on a direct write');
select throws_ok(
  $$ update public.org_settings set value = '101' where key = 'vote_retention_percent' $$,
  '23514', 'new row for relation "org_settings" violates check constraint "org_settings_vote_retention_percent_ck"',
  'org_settings_vote_retention_percent_ck: 101 is refused on a direct write');
select throws_ok(
  $$ update public.org_settings set value = null where key = 'vote_retention_percent' $$,
  '23514', 'new row for relation "org_settings" violates check constraint "org_settings_vote_retention_percent_ck"',
  'org_settings_vote_retention_percent_ck: y is never null');

select pg_temp.test_login_leadership('48000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ select public.set_org_setting('vote_retention_percent', '0') $$,
  'PT400', 'invalid_org_setting_value',
  'a y of 0 is malformed for every caller, a Voluntar included (step 1)');
select throws_ok(
  $$ select public.set_org_setting('vote_retention_percent', '30') $$,
  '42501', 'org_settings_manage_forbidden',
  'a Voluntar cannot set y');
reset role;

select pg_temp.test_login_leadership('48000000-0000-0000-0000-000000000024');
select throws_ok(
  $$ select public.set_org_setting('vote_retention_percent', '30') $$,
  '42501', 'org_settings_manage_forbidden',
  'the AG''s Group Responsible reads the ranking but cannot set y');
reset role;

select pg_temp.test_login_leadership('48000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.set_org_setting('vote_retention_percent', '101') $$,
  'PT400', 'invalid_org_setting_value', 'BC: y above 100 is refused');
select throws_ok($$ select public.set_org_setting('vote_retention_percent', '12.5') $$,
  'PT400', 'invalid_org_setting_value', 'BC: y is a whole percentage');
select throws_ok($$ select public.set_org_setting('vote_retention_percent', '  ') $$,
  'PT400', 'invalid_org_setting_value', 'BC: y cannot be cleared');
select lives_ok($$ select public.set_org_setting('vote_retention_percent', ' 100 ') $$,
  'BC: y = 100 is accepted, trimmed');
select is(
  (select count(*) from public.retention_ranking((select closed from fx48)) where role = 'vot' and inside),
  5::bigint,
  'y = 100: every Drept de Vot holder is inside');
reset role;

-- ==================== 7. Missing configuration ====================

delete from public.org_settings where key = 'vote_retention_percent';
select throws_ok(
  format('select * from private.retention_ranking_rows(%s)', (select closed from fx48)),
  'PT404', 'org_setting_not_found',
  'with no y row the ranking refuses rather than rank against a null share');

delete from public.promotion_rules where kind = 'top_percent';
select throws_ok(
  format('select * from private.retention_ranking_rows(%s)', (select closed from fx48)),
  'PT404', 'promotion_rule_not_found',
  'with no top_percent rule the ranking refuses rather than rank against a null share');

select * from finish();
rollback;
