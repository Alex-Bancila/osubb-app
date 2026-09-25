-- promotion_rules.test.sql -- #49: the Promotion Rules table, its two seeded
-- rows, the close-time Promotion Threshold stamp
-- private.stamp_closing_threshold(p_period_id) and the threshold in force
-- public.promotion_threshold_in_force().
--
-- In order: the schema and grants, the seeds (ruling R20), the constraints
-- that reject an unknown kind or a malformed row (named -- Ruling 23), the
-- read personas and the absence of any client write, the threshold in force
-- before the first close, and the stamp over three closed Periods dated in
-- 2003-2004: P_A at the seeded 30 % over seven distinct totals, P_B at 50 %
-- over five totals with a tie at the boundary, and P_C, which ranked nobody.
--
-- No command closes a Period yet (#701), so the Periods are written closed as
-- the owner inside this rolled-back transaction (conventions section 10, OD9)
-- and the stamp is called as the owner, as #701's security-definer body will.
-- The Periods are dated in 2003-2004 so no seeded demo Evaluation falls
-- inside them. P_B is inserted before P_A, so "most recently closed" and
-- "highest id" disagree.
--
-- Mutation guards, each named against the assertion that turns red:
--   * ceil -> floor (or round) in the share -> "30 % of 7 ranked Members is a
--     share of 3" stamps 24;
--   * offset share instead of share - 1 -> the same assertion stamps 15;
--   * a hard-coded 30 instead of the rule's percent -> "50 % of 5 ranked
--     Members is a share of 3" stamps 16;
--   * ascending order -> the P_A stamp assertion;
--   * in-force ignoring closes (initial_threshold only) -> "the first close's
--     stamp is in force";
--   * in-force preferring initial_threshold -> "a later edit of
--     initial_threshold does not displace a stamped close";
--   * in-force ordered by id instead of closed_at -> "the most recently
--     closed Period's stamp is in force, not the highest id's";
--   * in-force without `closing_threshold is not null` -> "a Period that
--     ranked nobody leaves the previous stamp in force" answers null;
--   * drop the already-stamped refusal -> "a close is stamped once";
--   * drop the open-Period refusal -> "an open Period cannot be stamped"
--     answers 23514 (evaluation_periods_threshold_ck) instead of PT409;
--   * drop auth_is_member() / caller_level() from promotion_rules_read ->
--     the claimless / deactivated read assertions;
--   * add a grant or a write policy -> the grant and direct-write assertions.
-- Every guard above but the last was run as a mutation on 2026-09-25 and
-- turned its named assertion red.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(48);

-- ==================== Fixtures ====================

insert into auth.users (id, email) values
  ('49000000-0000-0000-0000-000000000001', 'bc49@test.local'),
  ('49000000-0000-0000-0000-000000000003', 'stale49@test.local'),
  ('49000000-0000-0000-0000-000000000005', 'ana49@test.local'),
  ('49000000-0000-0000-0000-000000000011', 'm11@test.local'),
  ('49000000-0000-0000-0000-000000000012', 'm12@test.local'),
  ('49000000-0000-0000-0000-000000000013', 'm13@test.local'),
  ('49000000-0000-0000-0000-000000000014', 'm14@test.local'),
  ('49000000-0000-0000-0000-000000000015', 'm15@test.local'),
  ('49000000-0000-0000-0000-000000000016', 'm16@test.local'),
  ('49000000-0000-0000-0000-000000000017', 'm17@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('49000000-0000-0000-0000-000000000001', 'BC 49',                  'bc49@test.local',    'bc',       'activ'),
  -- Deactivated, still holding the Voluntar token it was issued (ADR-0003).
  ('49000000-0000-0000-0000-000000000003', 'Voluntar dezactivat 49', 'stale49@test.local', 'voluntar', 'inactiv'),
  ('49000000-0000-0000-0000-000000000005', 'Ana 49',                 'ana49@test.local',   'voluntar', 'activ'),
  ('49000000-0000-0000-0000-000000000011', 'Membru 11 #49',          'm11@test.local',     'voluntar', 'activ'),
  ('49000000-0000-0000-0000-000000000012', 'Membru 12 #49',          'm12@test.local',     'voluntar', 'activ'),
  ('49000000-0000-0000-0000-000000000013', 'Membru 13 #49',          'm13@test.local',     'voluntar', 'activ'),
  ('49000000-0000-0000-0000-000000000014', 'Membru 14 #49',          'm14@test.local',     'voluntar', 'activ'),
  ('49000000-0000-0000-0000-000000000015', 'Membru 15 #49',          'm15@test.local',     'activ',    'activ'),
  ('49000000-0000-0000-0000-000000000016', 'Membru 16 #49',          'm16@test.local',     'voluntar', 'activ'),
  ('49000000-0000-0000-0000-000000000017', 'Membru 17 #49',          'm17@test.local',     'voluntar', 'activ');

insert into public.groups (name, category) values ('Grup Promovare 49', 'department');

-- Completed Tasks credited at a chosen instant (pg_temp.test_credit_task: one
-- Evaluation, one `task` ledger row). Points = Difficulty x rating_mult(Rating):
-- rating 5 -> x3, rating 4 -> x2, rating 3 -> x1.
create temp table credits49 (title text, difficulty int, rating int, member_id uuid, awarded_at timestamptz);
insert into credits49 values
  -- P_A [2003-01-01, 2003-07-01): 30, 24, 18, 15, 12, 6, 3.
  ('A 11a #49', 5, 5, '49000000-0000-0000-0000-000000000011', '2003-03-01 12:00:00+00'),
  ('A 11b #49', 5, 5, '49000000-0000-0000-0000-000000000011', '2003-03-02 12:00:00+00'),
  ('A 12a #49', 5, 5, '49000000-0000-0000-0000-000000000012', '2003-03-01 12:00:00+00'),
  ('A 12b #49', 3, 5, '49000000-0000-0000-0000-000000000012', '2003-03-02 12:00:00+00'),
  ('A 13a #49', 5, 5, '49000000-0000-0000-0000-000000000013', '2003-03-01 12:00:00+00'),
  ('A 13b #49', 1, 5, '49000000-0000-0000-0000-000000000013', '2003-03-02 12:00:00+00'),
  ('A 14 #49',  5, 5, '49000000-0000-0000-0000-000000000014', '2003-03-01 12:00:00+00'),
  ('A 15 #49',  4, 5, '49000000-0000-0000-0000-000000000015', '2003-03-01 12:00:00+00'),
  ('A 16 #49',  2, 5, '49000000-0000-0000-0000-000000000016', '2003-03-01 12:00:00+00'),
  ('A 17 #49',  1, 5, '49000000-0000-0000-0000-000000000017', '2003-03-01 12:00:00+00'),
  -- P_B [2003-07-01, 2004-01-01): 20, 16, 12, 12, 4.
  ('B 11a #49', 5, 5, '49000000-0000-0000-0000-000000000011', '2003-09-01 12:00:00+00'),
  ('B 11b #49', 5, 3, '49000000-0000-0000-0000-000000000011', '2003-09-02 12:00:00+00'),
  ('B 12a #49', 4, 5, '49000000-0000-0000-0000-000000000012', '2003-09-01 12:00:00+00'),
  ('B 12b #49', 2, 4, '49000000-0000-0000-0000-000000000012', '2003-09-02 12:00:00+00'),
  ('B 13 #49',  4, 5, '49000000-0000-0000-0000-000000000013', '2003-09-01 12:00:00+00'),
  ('B 14 #49',  4, 5, '49000000-0000-0000-0000-000000000014', '2003-09-01 12:00:00+00'),
  ('B 15 #49',  2, 4, '49000000-0000-0000-0000-000000000015', '2003-09-01 12:00:00+00');

insert into public.tasks
  (title, description, deadline, group_id, status, difficulty, rating,
   created_by, created_at, completed_at)
select credit.title, 'Fixture', now() - interval '2 days',
       (select id from public.groups where name = 'Grup Promovare 49'),
       'completed', credit.difficulty, credit.rating, '49000000-0000-0000-0000-000000000001',
       now() - interval '3 days', now()
  from credits49 as credit;

select pg_temp.test_credit_task(task.id, credit.member_id, '49000000-0000-0000-0000-000000000001',
                                p_awarded_at => credit.awarded_at)
  from credits49 as credit
  join public.tasks as task on task.title = credit.title
 order by task.id;

create function pg_temp.login_stale_voluntar() returns void language sql as $$
  select pg_temp.test_login('49000000-0000-0000-0000-000000000003', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb, 'group_ids', '[]'::jsonb));
$$;

-- ==================== 1. Schema and grants ====================

select has_table('public', 'promotion_rules', 'public.promotion_rules exists');
select is((select relrowsecurity from pg_class where oid = 'public.promotion_rules'::regclass), true,
  'promotion_rules has RLS enabled in the migration that creates it (house rule 2)');
select is(
  (select array_agg(policyname || ':' || cmd order by policyname)::text[] from pg_policies
    where schemaname = 'public' and tablename = 'promotion_rules'),
  array['promotion_rules_read:SELECT'],
  'the only policy is promotion_rules_read, for select -- no client write policy exists');
select columns_are('public', 'promotion_rules',
  array['id', 'from_role', 'to_role', 'kind', 'min_tenure_months', 'percent', 'initial_threshold',
        'enabled', 'created_at', 'updated_at'],
  'promotion_rules carries from-Role, to-Role, kind, tenure, percent, initial threshold and the enabled flag');
select is(
  array[has_table_privilege('authenticated', 'public.promotion_rules', 'select'),
        has_table_privilege('authenticated', 'public.promotion_rules', 'insert'),
        has_table_privilege('authenticated', 'public.promotion_rules', 'update'),
        has_table_privilege('authenticated', 'public.promotion_rules', 'delete')],
  array[true, false, false, false],
  'authenticated may select promotion_rules and nothing else -- no client write grant');
select is(
  array[has_table_privilege('anon', 'public.promotion_rules', 'select'),
        has_table_privilege('anon', 'public.promotion_rules', 'insert'),
        has_table_privilege('anon', 'public.promotion_rules', 'update'),
        has_table_privilege('anon', 'public.promotion_rules', 'delete')],
  array[false, false, false, false],
  'anon holds no privilege on promotion_rules');
select is(
  array[has_function_privilege('authenticated', 'private.stamp_closing_threshold(bigint)', 'execute'),
        has_function_privilege('anon', 'private.stamp_closing_threshold(bigint)', 'execute'),
        has_function_privilege('service_role', 'private.stamp_closing_threshold(bigint)', 'execute'),
        has_function_privilege('public', 'private.stamp_closing_threshold(bigint)', 'execute')],
  array[false, false, false, false],
  'private.stamp_closing_threshold is executable by nobody -- only #701''s close command calls it');
select is(
  array[has_function_privilege('authenticated', 'public.promotion_threshold_in_force()', 'execute'),
        has_function_privilege('anon', 'public.promotion_threshold_in_force()', 'execute'),
        has_function_privilege('service_role', 'public.promotion_threshold_in_force()', 'execute'),
        has_function_privilege('public', 'public.promotion_threshold_in_force()', 'execute')],
  array[true, false, false, false],
  'public.promotion_threshold_in_force: execute for authenticated only (conventions section 4)');
select is(
  (select array[s.prosecdef, f.prosecdef]
     from pg_proc s, pg_proc f
    where s.oid = 'private.stamp_closing_threshold(bigint)'::regprocedure
      and f.oid = 'public.promotion_threshold_in_force()'::regprocedure),
  array[true, false],
  'the stamp is security definer; the in-force read is security invoker over RLS');
select is(
  (select provolatile::text from pg_proc where oid = 'public.promotion_threshold_in_force()'::regprocedure),
  's', 'promotion_threshold_in_force is stable');

-- ==================== 2. The seeds ====================

select results_eq(
  $$ select from_role::text, to_role::text, kind, min_tenure_months, percent, initial_threshold, enabled
       from public.promotion_rules order by from_role $$,
  $$ values ('recrut',   'voluntar', 'time',        6, null::int, null::int, true),
            ('voluntar', 'activ',    'top_percent', 6, 30,        30,        true) $$,
  'both seeded rules (R20): Recrut -> Voluntar by 6 months of tenure; Voluntar -> activ at the top 30 % with 6 months and an initial threshold of 30');
select results_eq(
  $$ select role.name from public.promotion_rules as rule
       join public.roles as role on role.id = rule.to_role
      where rule.kind = 'top_percent' $$,
  $$ values ('Voluntar Activ') $$,
  'the top_percent rule''s target Role is Voluntar Activ -- nothing names Membru Activ');

-- ==================== 3. Constraints ====================

select throws_ok(
  $$ insert into public.promotion_rules (from_role, to_role, kind, min_tenure_months)
     values ('activ', 'vot', 'points', 6) $$,
  '23514', 'new row for relation "promotion_rules" violates check constraint "promotion_rules_kind_ck"',
  'promotion_rules_kind_ck: an unknown rule kind is rejected');
select throws_ok(
  $$ insert into public.promotion_rules (from_role, to_role, kind, min_tenure_months, initial_threshold)
     values ('activ', 'vot', 'top_percent', 6, 30) $$,
  '23514', 'new row for relation "promotion_rules" violates check constraint "promotion_rules_top_percent_shape_ck"',
  'promotion_rules_top_percent_shape_ck: a top_percent rule carries a percentage');
select throws_ok(
  $$ insert into public.promotion_rules (from_role, to_role, kind, min_tenure_months, percent)
     values ('activ', 'vot', 'time', 6, 30) $$,
  '23514', 'new row for relation "promotion_rules" violates check constraint "promotion_rules_time_shape_ck"',
  'promotion_rules_time_shape_ck: a time rule carries no percentage or threshold');
select throws_ok(
  $$ insert into public.promotion_rules (from_role, to_role, kind, min_tenure_months, percent, initial_threshold)
     values ('activ', 'vot', 'top_percent', 6, 101, 30) $$,
  '23514', 'new row for relation "promotion_rules" violates check constraint "promotion_rules_percent_range_ck"',
  'promotion_rules_percent_range_ck: a percentage above 100 is rejected');
select throws_ok(
  $$ insert into public.promotion_rules (from_role, to_role, kind, min_tenure_months, percent, initial_threshold)
     values ('activ', 'vot', 'top_percent', 6, 20, 10) $$,
  '23505', 'duplicate key value violates unique constraint "promotion_rules_top_percent_uidx"',
  'promotion_rules_top_percent_uidx: there is exactly one top_percent rule for the stamp to read');

-- ==================== 4. Reading, and no client write ====================

select pg_temp.test_login_leadership('49000000-0000-0000-0000-000000000001');
select is((select count(*) from public.promotion_rules), 2::bigint, 'BC reads both rules');
select throws_ok(
  $$ insert into public.promotion_rules (from_role, to_role, kind, min_tenure_months)
     values ('activ', 'vot', 'time', 12) $$,
  '42501', 'permission denied for table promotion_rules',
  'BC cannot insert a rule directly');
select throws_ok(
  $$ update public.promotion_rules set initial_threshold = 40 where kind = 'top_percent' $$,
  '42501', 'permission denied for table promotion_rules',
  'BC cannot update a rule directly -- #702''s set_promotion_rule is the future editor');
select throws_ok(
  $$ delete from public.promotion_rules where kind = 'time' $$,
  '42501', 'permission denied for table promotion_rules',
  'BC cannot delete a rule');
select throws_ok(
  $$ select private.stamp_closing_threshold(1) $$,
  '42501', 'permission denied for function stamp_closing_threshold',
  'BC cannot call the stamp directly -- only #701''s close command runs it');
reset role;

select pg_temp.test_login_leadership('49000000-0000-0000-0000-000000000005');
select is((select count(*) from public.promotion_rules), 2::bigint,
  'a Voluntar reads both rules -- gamification needs visible goals');
reset role;

select pg_temp.test_login('49000000-0000-0000-0000-000000000005', '{}'::jsonb);
select is((select count(*) from public.promotion_rules), 0::bigint,
  'a claimless session with a real uid reads no rule (house rule 12)');
select is(public.promotion_threshold_in_force(), null::int,
  'a claimless session reads no threshold in force');
reset role;

select pg_temp.login_stale_voluntar();
select is((select count(*) from public.promotion_rules), 0::bigint,
  'a deactivated Voluntar''s still-valid token reads no rule');
select is(public.promotion_threshold_in_force(), null::int,
  'a deactivated Voluntar''s token reads no threshold in force');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select count(*) from public.promotion_rules $$, '42501', null,
  'anon cannot read promotion_rules at all');
reset role;

-- ==================== 5. Before the first close ====================

select is((select count(*) from public.evaluation_periods), 0::bigint,
  'fixture check: no Evaluation Period exists before this suite writes one');
select pg_temp.test_login_leadership('49000000-0000-0000-0000-000000000005');
select is(public.promotion_threshold_in_force(), 30,
  'with no Period closed, the threshold in force is the rule''s initial_threshold (30)');
reset role;

-- P_B first, so its id is lower than P_A's although it closed later.
insert into public.evaluation_periods (name, opened_at, opened_by, closed_at, closed_by) values
  ('P_B #49', '2003-07-01 00:00:00+00', '49000000-0000-0000-0000-000000000001',
              '2004-01-01 00:00:00+00', '49000000-0000-0000-0000-000000000001'),
  ('P_A #49', '2003-01-01 00:00:00+00', '49000000-0000-0000-0000-000000000001',
              '2003-07-01 00:00:00+00', '49000000-0000-0000-0000-000000000001'),
  ('P_C #49', '2004-01-01 00:00:00+00', '49000000-0000-0000-0000-000000000001',
              '2004-02-01 00:00:00+00', '49000000-0000-0000-0000-000000000001');
insert into public.evaluation_periods (name, opened_at, opened_by) values
  ('Deschisă #49', '2004-02-01 00:00:00+00', '49000000-0000-0000-0000-000000000001');

create temp table fx49 as
  select (select id from public.evaluation_periods where name = 'P_A #49')          as pa,
         (select id from public.evaluation_periods where name = 'P_B #49')          as pb,
         (select id from public.evaluation_periods where name = 'P_C #49')          as pc,
         (select id from public.evaluation_periods where name = 'Deschisă #49') as po;
grant select on fx49 to authenticated;

select pg_temp.test_login_leadership('49000000-0000-0000-0000-000000000005');
select is(public.promotion_threshold_in_force(), 30,
  'closed Periods that carry no stamp yet leave the initial threshold in force');
reset role;

-- ==================== 6. The stamp ====================

select throws_ok($$ select private.stamp_closing_threshold(-49) $$,
  'PT404', 'evaluation_period_not_found', 'an unknown Period cannot be stamped');
select throws_ok(format($$ select private.stamp_closing_threshold(%s) $$, (select po from fx49)),
  'PT409', 'evaluation_period_open', 'an open Period cannot be stamped -- the threshold is fixed at the close');

-- P_A at the seeded 30 %.
select results_eq(
  format($$ select task_points from private.evaluation_period_ranking_rows(%s) $$, (select pa from fx49)),
  $$ values (30), (24), (18), (15), (12), (6), (3) $$,
  'fixture check: P_A ranks seven Members at 30, 24, 18, 15, 12, 6, 3');
select is(private.stamp_closing_threshold((select pa from fx49)), 18,
  '30 % of 7 ranked Members is a share of ceil(2.1) = 3: the stamp is the third Member''s 18 Task Points');
select is((select closing_threshold from public.evaluation_periods where id = (select pa from fx49)), 18,
  'P_A''s closing_threshold holds the stamp');
select throws_ok(format($$ select private.stamp_closing_threshold(%s) $$, (select pa from fx49)),
  'PT409', 'closing_threshold_stamped', 'a close is stamped once and never recomputed');

select pg_temp.test_login_leadership('49000000-0000-0000-0000-000000000005');
select is(public.promotion_threshold_in_force(), 18,
  'after the first close, the first close''s stamp is in force (18), not the initial threshold');
reset role;

update public.promotion_rules set initial_threshold = 99 where kind = 'top_percent';
select pg_temp.test_login_leadership('49000000-0000-0000-0000-000000000005');
select is(public.promotion_threshold_in_force(), 18,
  'a later edit of initial_threshold does not displace a stamped close');
reset role;

-- P_B at 50 %: the stamp reads the rule's percentage, not a constant.
update public.promotion_rules set percent = 50 where kind = 'top_percent';
select results_eq(
  format($$ select task_points from private.evaluation_period_ranking_rows(%s) $$, (select pb from fx49)),
  $$ values (20), (16), (12), (12), (4) $$,
  'fixture check: P_B ranks five Members at 20, 16, 12, 12, 4');
select is(private.stamp_closing_threshold((select pb from fx49)), 12,
  '50 % of 5 ranked Members is a share of ceil(2.5) = 3: the stamp is the third Member''s 12 Task Points');
select is(
  (select count(*) from private.evaluation_period_ranking_rows((select pb from fx49))
    where task_points >= (select closing_threshold from public.evaluation_periods where id = (select pb from fx49))),
  4::bigint,
  'a tie at the boundary: the fourth Member holds the same 12 Task Points and reaches the threshold too');
select ok((select pb < pa from fx49), 'fixture check: P_B has the lower id although it closed later');

select pg_temp.test_login_leadership('49000000-0000-0000-0000-000000000005');
select is(public.promotion_threshold_in_force(), 12,
  'the most recently closed Period''s stamp is in force (P_B''s 12), not the highest id''s (P_A''s 18)');
reset role;

-- P_C ranked nobody.
select is(private.stamp_closing_threshold((select pc from fx49)), null::int,
  'a Period that ranked nobody has no boundary Member: the stamp returns null');
select is((select closing_threshold from public.evaluation_periods where id = (select pc from fx49)), null::int,
  'and leaves its closing_threshold null');

select pg_temp.test_login_leadership('49000000-0000-0000-0000-000000000005');
select is(public.promotion_threshold_in_force(), 12,
  'a Period that ranked nobody leaves the previous stamp in force');
reset role;

select pg_temp.test_login_leadership('49000000-0000-0000-0000-000000000001');
select is(public.promotion_threshold_in_force(), 12, 'BC reads the same threshold in force');
reset role;

select * from finish();
rollback;
