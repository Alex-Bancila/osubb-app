-- evaluation_periods.test.sql -- #47: Evaluation Periods, their one-open /
-- no-overlap invariants, and the Period-scoped Task-Point ranking
-- public.evaluation_period_ranking(p_period_id).
--
-- In order: the schema (RLS, the one read policy, the named constraints --
-- Ruling 23 -- and the grants on the table and the three functions), the
-- invariants, the ranking of an OPEN Period whose Task Points are earned
-- through the real Task commands (complete_task_review / reopen_task over
-- private.evaluate_task), the ranking of a CLOSED Period dated in 2001 with
-- awards before, inside, at the exact close of and after it, the read
-- personas over the table and the ranking, and the close stamping actor and
-- instant with closing_threshold left null.
--
-- The Periods themselves are written as the owner inside this rolled-back
-- transaction -- the fixture exception of conventions section 10 (OD9) -- so
-- one can be dated in 2001; #701's commands have their own suite.
--
-- The open Period opens at now(): the seeded demo Evaluations are all dated
-- days before the reset, so nothing but this suite's awards can fall inside
-- it, and the closed Period is dated in 2001 for the same reason.
--
-- Mutation guards, each named against the assertion that turns red:
--   * drop `evaluated_at >= opened_at` -> "an award the day before the open
--     Period is not in it" (Bogdan and Cristi gain points) and "the award
--     before P1 is not counted";
--   * drop the closed_at bound -> "an award at exactly closed_at belongs to
--     the next Period, not this one";
--   * read points_ledger.created_at instead of evaluated_at -> "a reversal
--     dated after P1 still nets its in-Period award to zero" and "an award
--     at exactly closed_at belongs to the next Period" (a -3 leaks in);
--   * `>` for `>=` on opened_at -> "an award at exactly opened_at counts";
--   * rank after the visibility filter -> "Elena reads her own row at rank 3";
--   * drop the own-row branch -> "Ana reads exactly her own row";
--   * widen the own-row branch to every row -> the same assertion;
--   * restore #47's interim level >= 5 full read -> "a BCE with no Group
--     Role reads only their own row" (#512 replaced it; the full-read matrix
--     is evaluation_rankings_read.test.sql's);
--   * drop auth_is_member() -> "Ana without claims reads nothing";
--   * drop the live caller_level() checks -> "a deactivated Member's valid
--     token reads nothing" / "a deactivated BC's token reads nothing";
--   * drop evaluation_periods_open_uidx -> "a second open Period" answers
--     23P01 instead of 23505;
--   * drop evaluation_periods_span_excl -> both overlap assertions stop
--     throwing;
--   * add a write policy or grant -> the direct-write assertions.
-- The sanction assertion is a fact, not a guard: a sanction row carries no
-- evaluation_id (points_ledger_task_reference_ck), so the join to the
-- Evaluation already excludes it and the reason filter is belt and braces.
-- Every guard above was run as a mutation on 2026-09-25 and turned its
-- named assertion red.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(66);

-- ==================== Fixtures ====================

insert into auth.users (id, email) values
  ('47000000-0000-0000-0000-000000000001', 'bc47@test.local'),
  ('47000000-0000-0000-0000-000000000002', 'bce47@test.local'),
  ('47000000-0000-0000-0000-000000000003', 'bcstale47@test.local'),
  ('47000000-0000-0000-0000-000000000005', 'ana47@test.local'),
  ('47000000-0000-0000-0000-000000000006', 'bogdan47@test.local'),
  ('47000000-0000-0000-0000-000000000007', 'cristi47@test.local'),
  ('47000000-0000-0000-0000-000000000008', 'dana47@test.local'),
  ('47000000-0000-0000-0000-000000000009', 'elena47@test.local'),
  ('47000000-0000-0000-0000-000000000010', 'florin47@test.local'),
  ('47000000-0000-0000-0000-000000000011', 'gabi47@test.local'),
  ('47000000-0000-0000-0000-000000000012', 'horia47@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('47000000-0000-0000-0000-000000000001', 'BC 47',            'bc47@test.local',      'bc',       'activ'),
  ('47000000-0000-0000-0000-000000000002', 'BCE 47',           'bce47@test.local',     'bce',      'activ'),
  -- Deactivated, still holding the level-6 token it was issued (ADR-0003).
  ('47000000-0000-0000-0000-000000000003', 'BC dezactivat 47', 'bcstale47@test.local', 'bc',       'inactiv'),
  ('47000000-0000-0000-0000-000000000005', 'Ana 47',           'ana47@test.local',     'voluntar', 'activ'),
  ('47000000-0000-0000-0000-000000000006', 'Bogdan 47',        'bogdan47@test.local',  'voluntar', 'activ'),
  ('47000000-0000-0000-0000-000000000007', 'Cristi 47',        'cristi47@test.local',  'voluntar', 'activ'),
  ('47000000-0000-0000-0000-000000000008', 'Dana 47',          'dana47@test.local',    'voluntar', 'activ'),
  ('47000000-0000-0000-0000-000000000009', 'Elena 47',         'elena47@test.local',   'voluntar', 'activ'),
  ('47000000-0000-0000-0000-000000000010', 'Florin 47',        'florin47@test.local',  'activ',    'activ'),
  ('47000000-0000-0000-0000-000000000011', 'Gabi 47',          'gabi47@test.local',    'activ',    'activ'),
  -- Earned inside the open Period, then deactivated: kept in the ranking,
  -- reads nothing with the token still in hand.
  ('47000000-0000-0000-0000-000000000012', 'Horia inactiv 47', 'horia47@test.local',   'voluntar', 'inactiv');

insert into public.groups (name, category) values ('Grup Evaluare 47', 'department');

-- The two Periods. P1 is closed and dated in 2001; P2 is the open one.
insert into public.evaluation_periods (name, opened_at, opened_by, closed_at, closed_by) values
  ('Perioada 2001 #47', '2001-03-01 00:00:00+00', '47000000-0000-0000-0000-000000000001',
                        '2001-06-01 00:00:00+00', '47000000-0000-0000-0000-000000000001');
insert into public.evaluation_periods (name, opened_at, opened_by) values
  ('Perioada deschisă #47', now(), '47000000-0000-0000-0000-000000000001');

-- In-review Tasks the BC evaluates through the real command: one live
-- Executor each. Difficulty x rating_mult(Rating): 3 x 3 = 9, 2 x 2 = 4,
-- 4 x 3 = 12.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status,
   created_at, queue_opened_at, started_at, submitted_at, created_by)
select fixture.title, 'Gata de evaluare', '2027-12-01 09:00:00+00',
       (select id from public.groups where name = 'Grup Evaluare 47'), 'org', 'public', 'in_review',
       now() - interval '5 days', now() - interval '5 days',
       now() - interval '4 days', now() - interval '1 day',
       '47000000-0000-0000-0000-000000000001'
  from (values ('Evaluare Ana #47'), ('Evaluare Dana #47'),
               ('Evaluare Elena #47'), ('Evaluare Bogdan #47')) as fixture (title);
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select task.id, fixture.member_id, '47000000-0000-0000-0000-000000000001', now() - interval '4 days'
  from (values ('Evaluare Ana #47',    '47000000-0000-0000-0000-000000000005'::uuid),
               ('Evaluare Dana #47',   '47000000-0000-0000-0000-000000000008'),
               ('Evaluare Elena #47',  '47000000-0000-0000-0000-000000000009'),
               ('Evaluare Bogdan #47', '47000000-0000-0000-0000-000000000006')) as fixture (title, member_id)
  join public.tasks as task on task.title = fixture.title;

-- Completed Tasks credited at a chosen instant through the shared fixture
-- (pg_temp.test_credit_task: one command Evaluation, one `task` ledger row).
insert into public.tasks
  (title, description, deadline, group_id, status, difficulty, rating,
   created_by, created_at, completed_at)
select fixture.title, 'Fixture', now() - interval '2 days',
       (select id from public.groups where name = 'Grup Evaluare 47'),
       'completed', fixture.difficulty, fixture.rating, '47000000-0000-0000-0000-000000000001',
       now() - interval '3 days', now()
  from (values ('Bogdan ieri #47', 5, 5),        -- 15, the day before P2
               ('Cristi ieri #47', 2, 5),        --  6, the day before P2
               ('Horia azi #47', 1, 4),          --  2, inside P2
               ('Florin inainte #47', 1, 5),     --  3, before P1
               ('Florin in #47', 2, 5),          --  6, inside P1
               ('Florin reversat #47', 5, 5),    -- 15, inside P1, reversed in the next
               ('Florin la inchidere #47', 4, 5),-- 12, at exactly P1's close
               ('Gabi la deschidere #47', 1, 4)  --  2, at exactly P1's open
       ) as fixture (title, difficulty, rating);

select pg_temp.test_credit_task(task.id, credit.member_id, '47000000-0000-0000-0000-000000000001',
                                p_awarded_at => credit.awarded_at)
  from (values
    ('Bogdan ieri #47',         '47000000-0000-0000-0000-000000000006'::uuid, now() - interval '1 day'),
    ('Cristi ieri #47',         '47000000-0000-0000-0000-000000000007',       now() - interval '1 day'),
    ('Horia azi #47',           '47000000-0000-0000-0000-000000000012',       now()),
    ('Florin inainte #47',      '47000000-0000-0000-0000-000000000010',       '2001-02-15 12:00:00+00'::timestamptz),
    ('Florin in #47',           '47000000-0000-0000-0000-000000000010',       '2001-04-01 12:00:00+00'),
    ('Florin reversat #47',     '47000000-0000-0000-0000-000000000010',       '2001-05-01 12:00:00+00'),
    ('Florin la inchidere #47', '47000000-0000-0000-0000-000000000010',       '2001-06-01 00:00:00+00'),
    ('Gabi la deschidere #47',  '47000000-0000-0000-0000-000000000011',       '2001-03-01 00:00:00+00')
  ) as credit (title, member_id, awarded_at)
  join public.tasks as task on task.title = credit.title
 order by task.id;
-- The reversal's own ledger row is dated after P1 closed, inside the next
-- Period (Vara 2001 #47); the award it undoes is dated inside P1.
select pg_temp.test_reverse_award(task.id, '47000000-0000-0000-0000-000000000010',
                                  '2001-06-15 12:00:00+00')
  from public.tasks as task where task.title = 'Florin reversat #47';

-- A sanction inside P2 is on the ledger but is not a Task Point.
insert into public.points_ledger (member_id, delta, reason, awarded_by, note, created_at)
values ('47000000-0000-0000-0000-000000000009', -3, 'sanction',
        '47000000-0000-0000-0000-000000000001', 'Sancțiune de test #47', now());

create temp table fx47 as
  select (select id from public.evaluation_periods where name = 'Perioada 2001 #47')     as p1,
         (select id from public.evaluation_periods where name = 'Perioada deschisă #47') as p2,
         (select id from public.tasks where title = 'Evaluare Ana #47')    as ana_task,
         (select id from public.tasks where title = 'Evaluare Dana #47')   as dana_task,
         (select id from public.tasks where title = 'Evaluare Elena #47')  as elena_task,
         (select id from public.tasks where title = 'Evaluare Bogdan #47') as bogdan_task;
grant select on fx47 to authenticated, anon;

create function pg_temp.login_stale_bc() returns void language sql as $$
  select pg_temp.test_login('47000000-0000-0000-0000-000000000003', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb, 'group_ids', '[]'::jsonb));
$$;
create function pg_temp.login_stale_horia() returns void language sql as $$
  select pg_temp.test_login('47000000-0000-0000-0000-000000000012', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb, 'group_ids', '[]'::jsonb));
$$;

-- ==================== 1. Schema ====================

select has_table('public', 'evaluation_periods', 'public.evaluation_periods exists');
select is((select relrowsecurity from pg_class where oid = 'public.evaluation_periods'::regclass), true,
  'evaluation_periods has RLS enabled in the migration that creates it (house rule 2)');
select is(
  (select array_agg(policyname || ':' || cmd order by policyname)::text[] from pg_policies
    where schemaname = 'public' and tablename = 'evaluation_periods'),
  array['evaluation_periods_read:SELECT'],
  'the only policy is evaluation_periods_read, for select -- no client write policy exists');
select columns_are('public', 'evaluation_periods',
  array['id', 'name', 'opened_at', 'opened_by', 'closed_at', 'closed_by', 'closing_threshold', 'created_at'],
  'evaluation_periods carries name, the open and close instants and actors, and closing_threshold');
select col_type_is('public', 'evaluation_periods', 'closing_threshold', 'integer',
  'closing_threshold is an integer (#49 stamps the Task Points of the boundary Member)');
select col_is_null('public', 'evaluation_periods', 'closing_threshold',
  'closing_threshold is nullable -- null until #49 stamps it at close');

-- ==================== 2. Grants ====================

select is(
  array[has_table_privilege('authenticated', 'public.evaluation_periods', 'select'),
        has_table_privilege('authenticated', 'public.evaluation_periods', 'insert'),
        has_table_privilege('authenticated', 'public.evaluation_periods', 'update'),
        has_table_privilege('authenticated', 'public.evaluation_periods', 'delete')],
  array[true, false, false, false],
  'authenticated may select evaluation_periods and nothing else -- no client write path');
select is(
  array[has_table_privilege('anon', 'public.evaluation_periods', 'select'),
        has_table_privilege('anon', 'public.evaluation_periods', 'insert'),
        has_table_privilege('anon', 'public.evaluation_periods', 'update'),
        has_table_privilege('anon', 'public.evaluation_periods', 'delete')],
  array[false, false, false, false],
  'anon holds no privilege on evaluation_periods');
select is(
  array[has_column_privilege('authenticated', 'public.evaluation_periods', 'closing_threshold', 'update'),
        has_column_privilege('authenticated', 'public.evaluation_periods', 'closing_threshold', 'insert')],
  array[false, false],
  'closing_threshold accepts no client write, not even a column grant');
select is(
  array[has_function_privilege('authenticated', 'public.evaluation_period_ranking(bigint)', 'execute'),
        has_function_privilege('anon', 'public.evaluation_period_ranking(bigint)', 'execute'),
        has_function_privilege('service_role', 'public.evaluation_period_ranking(bigint)', 'execute'),
        has_function_privilege('public', 'public.evaluation_period_ranking(bigint)', 'execute')],
  array[true, false, false, false],
  'public.evaluation_period_ranking: execute for authenticated only (conventions section 4)');
select is(
  array[has_function_privilege('authenticated', 'private.evaluation_period_ranking_impl(bigint)', 'execute'),
        has_function_privilege('anon', 'private.evaluation_period_ranking_impl(bigint)', 'execute'),
        has_function_privilege('service_role', 'private.evaluation_period_ranking_impl(bigint)', 'execute'),
        has_function_privilege('public', 'private.evaluation_period_ranking_impl(bigint)', 'execute')],
  array[true, false, false, false],
  'private.evaluation_period_ranking_impl: execute for authenticated only');
select is(
  array[has_function_privilege('authenticated', 'private.evaluation_period_ranking_rows(bigint)', 'execute'),
        has_function_privilege('anon', 'private.evaluation_period_ranking_rows(bigint)', 'execute'),
        has_function_privilege('service_role', 'private.evaluation_period_ranking_rows(bigint)', 'execute'),
        has_function_privilege('public', 'private.evaluation_period_ranking_rows(bigint)', 'execute')],
  array[false, false, false, false],
  'private.evaluation_period_ranking_rows -- the unfiltered core -- is executable by nobody');
select is(
  (select array[w.prosecdef, i.prosecdef, r.prosecdef]
     from pg_proc w, pg_proc i, pg_proc r
    where w.oid = 'public.evaluation_period_ranking(bigint)'::regprocedure
      and i.oid = 'private.evaluation_period_ranking_impl(bigint)'::regprocedure
      and r.oid = 'private.evaluation_period_ranking_rows(bigint)'::regprocedure),
  array[false, true, false],
  'the wrapper is security invoker, the filtering body security definer, the core runs as its caller');
select is(
  (select array_agg(p.provolatile order by p.oid)::text[] from pg_proc p
    where p.oid in ('public.evaluation_period_ranking(bigint)'::regprocedure,
                    'private.evaluation_period_ranking_impl(bigint)'::regprocedure,
                    'private.evaluation_period_ranking_rows(bigint)'::regprocedure)),
  array['s', 's', 's'],
  'all three ranking functions are stable');
select matches(obj_description('private.evaluation_period_ranking_impl(bigint)'::regprocedure, 'pg_proc'), '#512',
  'the ranking body''s comment says #512 adds the leadership predicate');

-- ==================== 3. Invariants ====================

select throws_ok(
  $$ insert into public.evaluation_periods (name, opened_at, opened_by)
     values ('A doua deschisă #47', now() + interval '1 day', '47000000-0000-0000-0000-000000000001') $$,
  '23505', 'duplicate key value violates unique constraint "evaluation_periods_open_uidx"',
  'a second open Period is refused while one is open (evaluation_periods_open_uidx)');
select throws_ok(
  $$ insert into public.evaluation_periods (name, opened_at, opened_by, closed_at, closed_by)
     values ('Suprapusă 2001 #47', '2001-05-01 00:00:00+00', '47000000-0000-0000-0000-000000000001',
             '2001-08-01 00:00:00+00', '47000000-0000-0000-0000-000000000001') $$,
  '23P01', 'conflicting key value violates exclusion constraint "evaluation_periods_span_excl"',
  'a closed Period overlapping another closed one is refused (evaluation_periods_span_excl)');
select throws_ok(
  $$ insert into public.evaluation_periods (name, opened_at, opened_by, closed_at, closed_by)
     values ('După deschidere #47', now() + interval '1 day', '47000000-0000-0000-0000-000000000001',
             now() + interval '2 days', '47000000-0000-0000-0000-000000000001') $$,
  '23P01', 'conflicting key value violates exclusion constraint "evaluation_periods_span_excl"',
  'no Period may start inside the open one -- its span runs to infinity');
select lives_ok(
  $$ insert into public.evaluation_periods (name, opened_at, opened_by, closed_at, closed_by)
     values ('Vara 2001 #47', '2001-06-01 00:00:00+00', '47000000-0000-0000-0000-000000000001',
             '2001-07-01 00:00:00+00', '47000000-0000-0000-0000-000000000001') $$,
  'a Period opening at the instant the previous one closed does not overlap it (half-open spans)');

select throws_ok(
  $$ insert into public.evaluation_periods (name, opened_at, opened_by, closed_at, closed_by)
     values ('ab', '2002-01-01 00:00:00+00', '47000000-0000-0000-0000-000000000001',
             '2002-02-01 00:00:00+00', '47000000-0000-0000-0000-000000000001') $$,
  '23514', 'new row for relation "evaluation_periods" violates check constraint "evaluation_periods_name_length_ck"',
  'evaluation_periods_name_length_ck: a two-character name is refused');
select throws_ok(
  $$ insert into public.evaluation_periods (name, opened_at, opened_by, closed_at, closed_by)
     values (' Spațiu #47 ', '2002-01-01 00:00:00+00', '47000000-0000-0000-0000-000000000001',
             '2002-02-01 00:00:00+00', '47000000-0000-0000-0000-000000000001') $$,
  '23514', 'new row for relation "evaluation_periods" violates check constraint "evaluation_periods_name_trimmed_ck"',
  'evaluation_periods_name_trimmed_ck: a name is stored trimmed');
select throws_ok(
  $$ insert into public.evaluation_periods (name, opened_at, opened_by, closed_at)
     values ('Fără actor #47', '2002-01-01 00:00:00+00', '47000000-0000-0000-0000-000000000001',
             '2002-02-01 00:00:00+00') $$,
  '23514', 'new row for relation "evaluation_periods" violates check constraint "evaluation_periods_close_shape_ck"',
  'evaluation_periods_close_shape_ck: a close stamps the instant and the actor together');
select throws_ok(
  $$ insert into public.evaluation_periods (name, opened_at, opened_by, closed_at, closed_by)
     values ('Invers #47', '2002-02-01 00:00:00+00', '47000000-0000-0000-0000-000000000001',
             '2002-01-01 00:00:00+00', '47000000-0000-0000-0000-000000000001') $$,
  '23514', 'new row for relation "evaluation_periods" violates check constraint "evaluation_periods_chronology_ck"',
  'evaluation_periods_chronology_ck: a Period cannot close before it opened');
select throws_ok(
  format($$ update public.evaluation_periods set closing_threshold = 30 where id = %s $$,
         (select p2 from fx47)),
  '23514', 'new row for relation "evaluation_periods" violates check constraint "evaluation_periods_threshold_ck"',
  'evaluation_periods_threshold_ck: closing_threshold stays null on an open Period');

-- ==================== 4. The open Period, earned through the real commands ====================

select pg_temp.test_login_leadership('47000000-0000-0000-0000-000000000001');
select lives_ok(format($$ select public.complete_task_review(%s, 3, 5, 'Foarte bine #47') $$, (select ana_task from fx47)),
  'BC evaluates Ana''s Task through complete_task_review (9 Task Points)');
select lives_ok(format($$ select public.complete_task_review(%s, 3, 5, 'Foarte bine #47') $$, (select dana_task from fx47)),
  'BC evaluates Dana''s Task (9 Task Points)');
select lives_ok(format($$ select public.complete_task_review(%s, 2, 4, 'Bine #47') $$, (select elena_task from fx47)),
  'BC evaluates Elena''s Task (4 Task Points)');
select lives_ok(format($$ select public.complete_task_review(%s, 4, 5, 'Excelent #47') $$, (select bogdan_task from fx47)),
  'BC evaluates Bogdan''s Task (12 Task Points)');
select lives_ok(format($$ select public.reopen_task(%s, 'Livrabil incomplet #47') $$, (select bogdan_task from fx47)),
  'BC reopens Bogdan''s Task -- reopen_task reverses the in-Period award');

select results_eq(
  format($$ select member_id, task_points, rank from public.evaluation_period_ranking(%s) $$, (select p2 from fx47)),
  $$ values ('47000000-0000-0000-0000-000000000005'::uuid, 9, 1),
            ('47000000-0000-0000-0000-000000000008'::uuid, 9, 1),
            ('47000000-0000-0000-0000-000000000009'::uuid, 4, 3),
            ('47000000-0000-0000-0000-000000000012'::uuid, 2, 4),
            ('47000000-0000-0000-0000-000000000006'::uuid, 0, 5) $$,
  'BC reads the open Period''s full ranking: ties share rank 1, the reversed award nets Bogdan to zero, the inactive earner is kept');
select is(
  (select count(*) from public.evaluation_period_ranking((select p2 from fx47))
    where member_id = '47000000-0000-0000-0000-000000000007'),
  0::bigint,
  'an award the day before the open Period is not in it -- Cristi, with no in-Period Evaluation, does not appear');
select is(
  (select task_points from public.evaluation_period_ranking((select p2 from fx47))
    where member_id = '47000000-0000-0000-0000-000000000006'),
  0,
  'Bogdan''s award the day before the Period is not counted either -- only his netted in-Period award');
select is(
  (select task_points from public.evaluation_period_ranking((select p2 from fx47))
    where member_id = '47000000-0000-0000-0000-000000000009'),
  4,
  'a sanction inside the Period is not a Task Point -- Elena keeps her 4');
select set_eq(
  format($$ select member_id, task_points, rank from public.evaluation_period_ranking(%s) $$, (select p2 from fx47)),
  format($$ select member_id, points, rank from public.leadership_leaderboard(null, null, %L, null) $$,
         (select opened_at from public.evaluation_periods where id = (select p2 from fx47))),
  'the open Period''s ranking is the Leadership Leaderboard over [opened_at, open) -- "the Period''s Leaderboard"');
select is(
  (select count(*) from public.evaluation_period_ranking(-47)), 0::bigint,
  'an unknown Period id ranks nobody');
reset role;

-- ==================== 5. A closed Period: before, inside, at the bounds, after ====================

select pg_temp.test_login_leadership('47000000-0000-0000-0000-000000000001');
select results_eq(
  format($$ select member_id, task_points, rank from public.evaluation_period_ranking(%s) $$, (select p1 from fx47)),
  $$ values ('47000000-0000-0000-0000-000000000010'::uuid, 6, 1),
            ('47000000-0000-0000-0000-000000000011'::uuid, 2, 2) $$,
  'the closed Period counts only its inside awards: Florin 6 (not the 3 before, not the 12 at close), Gabi 2');
select is(
  (select task_points from public.evaluation_period_ranking((select p1 from fx47))
    where member_id = '47000000-0000-0000-0000-000000000011'),
  2,
  'an award at exactly opened_at counts -- the lower bound is inclusive');
select results_eq(
  format($$ select member_id, task_points, rank from public.evaluation_period_ranking(%s) $$,
         (select id from public.evaluation_periods where name = 'Vara 2001 #47')),
  $$ values ('47000000-0000-0000-0000-000000000010'::uuid, 12, 1) $$,
  'an award at exactly closed_at belongs to the next Period, not this one -- and a reversal dated inside that next Period does not leak into it');
select set_eq(
  format($$ select member_id, task_points, rank from public.evaluation_period_ranking(%s) $$, (select p1 from fx47)),
  $$ select member_id, points, rank
       from public.leadership_leaderboard(null, null, '2001-03-01 00:00:00+00', '2001-06-01 00:00:00+00') $$,
  'the closed Period''s ranking is the Leadership Leaderboard over [opened_at, closed_at)');
reset role;

select is(
  (select sum(delta)::int from public.points_ledger
    where member_id = '47000000-0000-0000-0000-000000000010'
      and task_id = (select id from public.tasks where title = 'Florin reversat #47')),
  0,
  'fixture check: the reversed award and its reversal both stand on the ledger and net to zero');
select results_eq(
  format($$ select member_id, task_points from private.evaluation_period_ranking_rows(%s) $$, (select p1 from fx47)),
  $$ values ('47000000-0000-0000-0000-000000000010'::uuid, 6),
            ('47000000-0000-0000-0000-000000000011'::uuid, 2) $$,
  'a reversal dated after P1 still nets its in-Period award to zero -- the Evaluation instant dates both rows');
select pg_temp.test_clear_jwt();
select is(
  (select count(*) from private.evaluation_period_ranking_rows((select p2 from fx47))), 5::bigint,
  'the unfiltered core ranks everyone with no caller at all -- what #52''s daily job and #51''s detection read');

-- ==================== 6. Reading the table ====================

select pg_temp.test_login_leadership('47000000-0000-0000-0000-000000000001');
select is((select count(*) from public.evaluation_periods), 3::bigint, 'BC reads every Period');
reset role;
select pg_temp.test_login_leadership('47000000-0000-0000-0000-000000000005');
select is((select count(*) from public.evaluation_periods), 3::bigint, 'an ordinary Member reads every Period');
reset role;
select pg_temp.test_login('47000000-0000-0000-0000-000000000005', '{}'::jsonb);
select is((select count(*) from public.evaluation_periods), 0::bigint,
  'a claimless session with a real uid reads no Period (house rule 12)');
reset role;
select pg_temp.login_stale_bc();
select is((select count(*) from public.evaluation_periods), 0::bigint,
  'a deactivated BC''s still-valid token reads no Period');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select count(*) from public.evaluation_periods $$, '42501', null,
  'anon cannot read evaluation_periods at all');
reset role;

-- No client write path, BC included.
select pg_temp.test_login_leadership('47000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ insert into public.evaluation_periods (name, opened_at, opened_by)
     values ('Scrisă de client #47', now() + interval '1 day', '47000000-0000-0000-0000-000000000001') $$,
  '42501', 'permission denied for table evaluation_periods',
  'BC cannot open a Period by a direct insert -- #701''s command is the write path');
select throws_ok(
  format($$ update public.evaluation_periods set closed_at = now(), closed_by = '47000000-0000-0000-0000-000000000001' where id = %s $$,
         (select p2 from fx47)),
  '42501', 'permission denied for table evaluation_periods',
  'BC cannot close a Period by a direct update');
select throws_ok(
  format($$ update public.evaluation_periods set closing_threshold = 30 where id = %s $$, (select p1 from fx47)),
  '42501', 'permission denied for table evaluation_periods',
  'BC cannot write closing_threshold, not even on a closed Period');
select throws_ok(
  format($$ delete from public.evaluation_periods where id = %s $$, (select p1 from fx47)),
  '42501', 'permission denied for table evaluation_periods',
  'BC cannot delete a Period');
reset role;

-- ==================== 7. Reading the ranking: personas ====================

select pg_temp.test_login_leadership('47000000-0000-0000-0000-000000000002');
select is(
  (select count(*) from public.evaluation_period_ranking((select p2 from fx47))), 0::bigint,
  'a BCE with no Group Role reads only their own row -- none in this Period: #512 narrowed the full read to its predicate (evaluation_rankings_read.test.sql owns the matrix)');
reset role;

select pg_temp.test_login_leadership('47000000-0000-0000-0000-000000000005');
select results_eq(
  format($$ select member_id, task_points, rank from public.evaluation_period_ranking(%s) $$, (select p2 from fx47)),
  $$ values ('47000000-0000-0000-0000-000000000005'::uuid, 9, 1) $$,
  'Ana, an ordinary Member, reads exactly her own row');
reset role;

select pg_temp.test_login_leadership('47000000-0000-0000-0000-000000000009');
select results_eq(
  format($$ select member_id, task_points, rank from public.evaluation_period_ranking(%s) $$, (select p2 from fx47)),
  $$ values ('47000000-0000-0000-0000-000000000009'::uuid, 4, 3) $$,
  'Elena reads her own row at rank 3 -- her standing among every Member, not among the rows she may see');
reset role;

select pg_temp.test_login_leadership('47000000-0000-0000-0000-000000000007');
select is(
  (select count(*) from public.evaluation_period_ranking((select p2 from fx47))), 0::bigint,
  'Cristi, with nothing inside the Period, reads no row -- nobody else''s either');
select is(
  (select count(*) from public.evaluation_period_ranking((select p1 from fx47))), 0::bigint,
  'an ordinary Member reads nobody''s row in a closed Period they did not earn in');
reset role;

select pg_temp.test_login('47000000-0000-0000-0000-000000000005', '{}'::jsonb);
select is(
  (select count(*) from public.evaluation_period_ranking((select p2 from fx47))), 0::bigint,
  'Ana without organization claims reads nothing, not even her own row (house rule 12)');
reset role;

select pg_temp.test_clear_jwt();
set local role authenticated;
select is(
  (select count(*) from public.evaluation_period_ranking((select p2 from fx47))), 0::bigint,
  'a session with no JWT at all reads nothing');
reset role;

select pg_temp.login_stale_horia();
select is(
  (select count(*) from public.evaluation_period_ranking((select p2 from fx47))), 0::bigint,
  'a deactivated Member''s valid token reads nothing -- not even the row the ranking keeps for them');
reset role;

select pg_temp.login_stale_bc();
select is(
  (select count(*) from public.evaluation_period_ranking((select p2 from fx47))), 0::bigint,
  'a deactivated BC''s token reads nothing -- the full read is checked on the live level too');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(
  $$ select * from public.evaluation_period_ranking((select p2 from fx47)) $$,
  '42501', null,
  'anon cannot execute the ranking');
reset role;

-- ==================== 8. Closing stamps the instant and the actor ====================
-- The owner writes the close here, to prove #47's close shape with
-- closing_threshold still null -- #701's close_evaluation_period would stamp
-- it at once (evaluation_period_commands.test.sql covers the command).
-- clock_timestamp() is later than now(), so the Period's in-Period
-- awards (all at now()) stay inside the closed span.

create temp table close47 as select clock_timestamp() as closed_at;
update public.evaluation_periods
   set closed_at = (select closed_at from close47),
       closed_by = '47000000-0000-0000-0000-000000000001'
 where id = (select p2 from fx47);

select results_eq(
  format($$ select closed_at = (select closed_at from close47), closed_by, closing_threshold
              from public.evaluation_periods where id = %s $$, (select p2 from fx47)),
  $$ values (true, '47000000-0000-0000-0000-000000000001'::uuid, null::integer) $$,
  'closing stamps the closing instant and the actor, and leaves closing_threshold null for #49');
select is((select count(*) from public.evaluation_periods where closed_at is null), 0::bigint,
  'no Period is open once the only open one closes');
select is(
  (select count(*) from private.evaluation_period_ranking_rows((select p2 from fx47))), 5::bigint,
  'the closed Period ranks the same Members it ranked while open');
select lives_ok(
  $$ insert into public.evaluation_periods (name, opened_at, opened_by)
     values ('Următoarea #47', (select closed_at from close47), '47000000-0000-0000-0000-000000000001') $$,
  'the next Period opens at the instant the previous one closed');
select is(
  (select count(*) from private.evaluation_period_ranking_rows(
     (select id from public.evaluation_periods where name = 'Următoarea #47'))), 0::bigint,
  'and ranks nobody yet -- the previous Period''s awards stay in the previous Period');

select * from finish();
rollback;
