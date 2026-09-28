-- role_evaluations.test.sql -- #826 (ruling R28): the Role Evaluation record
-- public.role_evaluations, the two range-bound reading cores it and
-- run_role_evaluation share (private.task_points_in_range,
-- private.role_evaluation_rows), and the threshold audit log
-- public.promotion_threshold_changes.
--
-- R28 retired public.evaluation_periods (no Period is ever opened or
-- closed): a Role Evaluation is an immutable record of a run BC or the
-- Moderator chose to make over a date range picked at that moment. This
-- suite replaces evaluation_periods.test.sql; the schema, invariant and
-- read-persona sections below are its direct descendants -- its old §5
-- (bounds fixtures) is now private.task_points_in_range's raw
-- [p_from, p_to) bounds, and a new section proves private.role_evaluation_rows
-- converts an inclusive Bucharest-day range into that same half-open rule.
-- The command bodies (run_role_evaluation, set_promotion_threshold,
-- reject_promotion_candidate) and public.role_evaluation_ranking's full-read
-- predicate are covered by their own suites; this one owns the tables, the
-- two range cores, and promotion_threshold_changes.
--
-- In order: 1. role_evaluations schema (columns, the four named checks, the
-- dropped overlap/uniqueness rule); 2. grants (table and sequence); 3. RLS
-- read personas and the absence of a client write path; 4.
-- private.task_points_in_range's raw timestamptz bounds; 5.
-- private.role_evaluation_rows' inclusive-Bucharest-day range; 6.
-- promotion_threshold_changes schema, its source-shape check, and its
-- level->=6 read gate.
--
-- Mutation guards, each named against the assertion that turns red (run as
-- scratch copies of this file on 2026-09-27; see the report for exact runs):
--   * private.task_points_in_range reading entry.created_at instead of
--     evaluation.evaluated_at in its where clause -> "CreatedAt 826 nets to
--     zero although the reversal''s own ledger row is dated after p_to" goes
--     red (the reversal falls outside a created_at filter, so the award
--     leaks through uncancelled);
--   * private.role_evaluation_rows' upper bound changed from
--     `(p_period_to + 1)::timestamp at time zone 'Europe/Bucharest'` to
--     `p_period_to::timestamp at time zone 'Europe/Bucharest'` (or `<` to
--     `<=`) -> "EdgeNext 826, credited at 00:00 Bucharest the day after
--     period_to, is excluded" goes red.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(46);

-- ==================== Fixtures ====================

insert into auth.users (id, email) values
  ('82600000-0000-0000-0000-000000000001', 'bc826@test.local'),
  ('82600000-0000-0000-0000-000000000002', 'bcstale826@test.local'),
  ('82600000-0000-0000-0000-000000000005', 'ana826@test.local'),
  ('82600000-0000-0000-0000-000000000006', 'voluntarstale826@test.local'),
  ('82600000-0000-0000-0000-000000000010', 'limita826@test.local'),
  ('82600000-0000-0000-0000-000000000011', 'sanctiune826@test.local'),
  ('82600000-0000-0000-0000-000000000012', 'reversat826@test.local'),
  ('82600000-0000-0000-0000-000000000013', 'createdat826@test.local'),
  ('82600000-0000-0000-0000-000000000014', 'edge826@test.local'),
  ('82600000-0000-0000-0000-000000000015', 'edgenext826@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('82600000-0000-0000-0000-000000000001', 'BC 826',                  'bc826@test.local',          'bc',       'activ'),
  -- Deactivated, still holding the level-6 token it was issued (ADR-0003).
  ('82600000-0000-0000-0000-000000000002', 'BC dezactivat 826',       'bcstale826@test.local',     'bc',       'inactiv'),
  ('82600000-0000-0000-0000-000000000005', 'Ana 826',                 'ana826@test.local',         'voluntar', 'activ'),
  ('82600000-0000-0000-0000-000000000006', 'Voluntar dezactivat 826', 'voluntarstale826@test.local','voluntar','inactiv'),
  ('82600000-0000-0000-0000-000000000010', 'Limita 826',              'limita826@test.local',      'voluntar', 'activ'),
  ('82600000-0000-0000-0000-000000000011', 'Sanctiune 826',           'sanctiune826@test.local',   'voluntar', 'activ'),
  ('82600000-0000-0000-0000-000000000012', 'Reversat 826',            'reversat826@test.local',    'voluntar', 'activ'),
  ('82600000-0000-0000-0000-000000000013', 'CreatedAt 826',           'createdat826@test.local',   'voluntar', 'activ'),
  ('82600000-0000-0000-0000-000000000014', 'Edge 826',                'edge826@test.local',        'activ',    'activ'),
  ('82600000-0000-0000-0000-000000000015', 'EdgeNext 826',            'edgenext826@test.local',    'activ',    'activ');

insert into public.groups (name, category) values ('Grup Evaluari 826', 'department');

create function pg_temp.login_stale_bc826() returns void language sql as $$
  select pg_temp.test_login('82600000-0000-0000-0000-000000000002', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb, 'group_ids', '[]'::jsonb));
$$;
create function pg_temp.login_stale_voluntar826() returns void language sql as $$
  select pg_temp.test_login('82600000-0000-0000-0000-000000000006', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb, 'group_ids', '[]'::jsonb));
$$;

-- Two Role Evaluations, written as the owner inside this rolled-back
-- transaction (conventions section 10, OD9): run_role_evaluation's own
-- suite exercises the command; this file owns the table.
insert into public.role_evaluations
  (kind, name, period_from, period_to, run_by, threshold_used, threshold_computed, ranked_count)
values
  ('voluntar_activ', 'Evaluare Ianuarie 826', '2028-01-01', '2028-01-31',
   '82600000-0000-0000-0000-000000000001', 30, 25, 10);

create temp table fx826 as
  select (select id from public.role_evaluations where name = 'Evaluare Ianuarie 826') as re1;
grant select on fx826 to authenticated, anon;

-- ==================== 1. Schema of role_evaluations ====================

select has_table('public', 'role_evaluations', 'public.role_evaluations exists');
select is((select relrowsecurity from pg_class where oid = 'public.role_evaluations'::regclass), true,
  'role_evaluations has RLS enabled in the migration that creates it (house rule 2)');
select is(
  (select array_agg(policyname || ':' || cmd order by policyname)::text[] from pg_policies
    where schemaname = 'public' and tablename = 'role_evaluations'),
  array['role_evaluations_read:SELECT'],
  'the only policy is role_evaluations_read, for select -- no client write policy exists');
select columns_are('public', 'role_evaluations',
  array['id', 'kind', 'name', 'period_from', 'period_to', 'run_by', 'run_at',
        'threshold_used', 'threshold_computed', 'ranked_count'],
  'role_evaluations carries kind, name, the Period bounds, who ran it and when, the threshold used and computed, and ranked_count');

select throws_ok(
  $$ insert into public.role_evaluations
       (kind, name, period_from, period_to, run_by, threshold_used, ranked_count)
     values ('bogus', 'Nume 826', '2028-02-01', '2028-02-28',
             '82600000-0000-0000-0000-000000000001', 30, 5) $$,
  '23514', 'new row for relation "role_evaluations" violates check constraint "role_evaluations_kind_ck"',
  'role_evaluations_kind_ck: an unknown kind is rejected');
select throws_ok(
  $$ insert into public.role_evaluations
       (kind, name, period_from, period_to, run_by, threshold_used, ranked_count)
     values ('voluntar_activ', 'ab', '2028-02-01', '2028-02-28',
             '82600000-0000-0000-0000-000000000001', 30, 5) $$,
  '23514', 'new row for relation "role_evaluations" violates check constraint "role_evaluations_name_length_ck"',
  'role_evaluations_name_length_ck: a two-character name is refused');
select throws_ok(
  $$ insert into public.role_evaluations
       (kind, name, period_from, period_to, run_by, threshold_used, ranked_count)
     values ('voluntar_activ', ' Nume 826 ', '2028-02-01', '2028-02-28',
             '82600000-0000-0000-0000-000000000001', 30, 5) $$,
  '23514', 'new row for relation "role_evaluations" violates check constraint "role_evaluations_name_trimmed_ck"',
  'role_evaluations_name_trimmed_ck: a name is stored trimmed');
select throws_ok(
  $$ insert into public.role_evaluations
       (kind, name, period_from, period_to, run_by, threshold_used, ranked_count)
     values ('voluntar_activ', 'Interval invers 826', '2028-02-28', '2028-02-01',
             '82600000-0000-0000-0000-000000000001', 30, 5) $$,
  '23514', 'new row for relation "role_evaluations" violates check constraint "role_evaluations_range_ck"',
  'role_evaluations_range_ck: period_to cannot precede period_from');
select throws_ok(
  $$ insert into public.role_evaluations
       (kind, name, period_from, period_to, run_by, threshold_used, ranked_count)
     values ('voluntar_activ', 'Numarat negativ 826', '2028-02-01', '2028-02-28',
             '82600000-0000-0000-0000-000000000001', 30, -1) $$,
  '23514', 'new row for relation "role_evaluations" violates check constraint "role_evaluations_ranked_count_ck"',
  'role_evaluations_ranked_count_ck: a negative ranked_count is rejected');

-- No overlap or uniqueness rule (R28): a correction run over the same, or an
-- overlapping, span is legitimate -- the threshold chain follows run_at, not
-- an exclusion constraint.
select lives_ok(
  $$ insert into public.role_evaluations
       (kind, name, period_from, period_to, run_by, threshold_used, threshold_computed, ranked_count)
     values ('voluntar_activ', 'Evaluare Corectie 826', '2028-01-15', '2028-02-15',
             '82600000-0000-0000-0000-000000000001', 30, 28, 9) $$,
  'a second voluntar_activ Role Evaluation over a span overlapping the first one inserts cleanly -- no overlap rule');
select lives_ok(
  $$ insert into public.role_evaluations
       (kind, name, period_from, period_to, run_by, threshold_used, threshold_computed, ranked_count)
     values ('voluntar_activ', 'Evaluare A Doua Corectie 826', '2028-02-01', '2028-02-20',
             '82600000-0000-0000-0000-000000000001', 28, 26, 8) $$,
  'a third run overlapping the second inserts too -- still no exclusion constraint');

-- ==================== 2. Grants ====================

select is(
  array[has_table_privilege('authenticated', 'public.role_evaluations', 'select'),
        has_table_privilege('authenticated', 'public.role_evaluations', 'insert'),
        has_table_privilege('authenticated', 'public.role_evaluations', 'update'),
        has_table_privilege('authenticated', 'public.role_evaluations', 'delete')],
  array[true, false, false, false],
  'authenticated may select role_evaluations and nothing else -- run_role_evaluation is the only write path');
-- The table's revoke only names public/anon/authenticated (the idiom every
-- promotion_rules-family table in this migration and #49's promotion_rules
-- share -- conventions section 4's older two/three-role form); service_role
-- keeps Supabase's default table privileges, so only its read is asserted
-- here, matching promotion_rules.test.sql's own scope.
select is(has_table_privilege('service_role', 'public.role_evaluations', 'select'), true,
  'service_role may select role_evaluations');
select is(
  array[has_table_privilege('anon', 'public.role_evaluations', 'select'),
        has_table_privilege('anon', 'public.role_evaluations', 'insert'),
        has_table_privilege('anon', 'public.role_evaluations', 'update'),
        has_table_privilege('anon', 'public.role_evaluations', 'delete')],
  array[false, false, false, false],
  'anon holds no privilege on role_evaluations');
select is(has_sequence_privilege('authenticated', 'public.role_evaluations_id_seq', 'usage'), false,
  'authenticated cannot allocate a role_evaluations id');
select is(has_sequence_privilege('anon', 'public.role_evaluations_id_seq', 'usage'), false,
  'anon cannot allocate a role_evaluations id');

-- ==================== 3. Reading, and no client write ====================

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select is((select count(*) from public.role_evaluations), 3::bigint, 'BC reads every Role Evaluation');
select throws_ok(
  $$ insert into public.role_evaluations
       (kind, name, period_from, period_to, run_by, threshold_used, ranked_count)
     values ('voluntar_activ', 'Scrisa de client 826', '2028-03-01', '2028-03-31',
             '82600000-0000-0000-0000-000000000001', 30, 5) $$,
  '42501', 'permission denied for table role_evaluations',
  'BC cannot insert a Role Evaluation directly -- run_role_evaluation is the write path');
select throws_ok(
  format($$ update public.role_evaluations set ranked_count = 99 where id = %s $$, (select re1 from fx826)),
  '42501', 'permission denied for table role_evaluations',
  'BC cannot update a Role Evaluation by a direct write');
select throws_ok(
  format($$ delete from public.role_evaluations where id = %s $$, (select re1 from fx826)),
  '42501', 'permission denied for table role_evaluations',
  'BC cannot delete a Role Evaluation');
reset role;

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000005');
select is((select count(*) from public.role_evaluations), 3::bigint,
  'an ordinary live active Member reads every Role Evaluation -- not scoped to their own kind or run');
reset role;

select pg_temp.test_login('82600000-0000-0000-0000-000000000005', '{}'::jsonb);
select is((select count(*) from public.role_evaluations), 0::bigint,
  'a claimless session with a real uid reads no Role Evaluation (house rule 12)');
reset role;

select pg_temp.login_stale_bc826();
select is((select count(*) from public.role_evaluations), 0::bigint,
  'a deactivated BC''s still-valid token reads no Role Evaluation');
reset role;

select pg_temp.login_stale_voluntar826();
select is((select count(*) from public.role_evaluations), 0::bigint,
  'a deactivated Voluntar''s still-valid token reads no Role Evaluation either');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select count(*) from public.role_evaluations $$, '42501', null,
  'anon cannot read role_evaluations at all');
reset role;

-- ==================== 4. private.task_points_in_range: raw [p_from, p_to) ====================
-- Instants are plain timestamptz here -- no Bucharest-day conversion; that
-- belongs to private.role_evaluation_rows (section 5).

insert into public.tasks
  (title, description, deadline, group_id, status, difficulty, rating,
   created_by, created_at, completed_at)
select fixture.title, 'Fixture #826', now() - interval '2 days',
       (select id from public.groups where name = 'Grup Evaluari 826'),
       'completed', fixture.difficulty, fixture.rating, '82600000-0000-0000-0000-000000000001',
       now() - interval '3 days', now()
  from (values
    ('Limita inainte 826',    1, 4),  -- 2,  before p_from
    ('Limita la p_from 826',  3, 5),  -- 9,  exactly at p_from
    ('Limita la p_to 826',    5, 5),  -- 15, exactly at p_to
    ('Reversat 826',          2, 5),  -- 6,  in range, reversed in range
    ('CreatedAt 826',         4, 4)   -- 8,  in range, reversed after p_to
  ) as fixture (title, difficulty, rating);

select pg_temp.test_credit_task(task.id, credit.member_id, '82600000-0000-0000-0000-000000000001',
                                p_awarded_at => credit.awarded_at)
  from (values
    ('Limita inainte 826',   '82600000-0000-0000-0000-000000000010'::uuid, '2028-02-15 12:00:00+00'::timestamptz),
    ('Limita la p_from 826', '82600000-0000-0000-0000-000000000010',       '2028-03-01 00:00:00+00'),
    ('Limita la p_to 826',   '82600000-0000-0000-0000-000000000010',       '2028-04-01 00:00:00+00'),
    ('Reversat 826',         '82600000-0000-0000-0000-000000000012',       '2028-03-10 12:00:00+00'),
    ('CreatedAt 826',        '82600000-0000-0000-0000-000000000013',       '2028-03-10 12:00:00+00')
  ) as credit (title, member_id, awarded_at)
  join public.tasks as task on task.title = credit.title
 order by task.id;

-- Reversed inside the range: nets to zero regardless of the netting fixture.
select pg_temp.test_reverse_award(task.id, '82600000-0000-0000-0000-000000000012', '2028-03-20 12:00:00+00')
  from public.tasks as task where task.title = 'Reversat 826';
-- Reversed AFTER p_to: the reversal's own ledger row falls outside the
-- range, but it shares the credited Evaluation's evaluated_at, which is
-- inside it -- this is the "ledger row's created_at is not read" case.
select pg_temp.test_reverse_award(task.id, '82600000-0000-0000-0000-000000000013', '2028-05-01 00:00:00+00')
  from public.tasks as task where task.title = 'CreatedAt 826';

-- A sanction is on the ledger inside the range but carries no evaluation_id
-- (points_ledger_task_reference_ck): the join private.task_points_in_range
-- makes never matches it, so it is not a Task Point at all -- not even a
-- zero row.
insert into public.points_ledger (member_id, delta, reason, awarded_by, note, created_at)
values ('82600000-0000-0000-0000-000000000011', -5, 'sanction',
        '82600000-0000-0000-0000-000000000001', 'Sanctiune 826', '2028-03-15 00:00:00+00');

reset role;

select is(
  (select task_points from private.task_points_in_range('2028-03-01 00:00:00+00', '2028-04-01 00:00:00+00')
    where member_id = '82600000-0000-0000-0000-000000000010'),
  9,
  'an Evaluation at exactly p_from counts (9) and one at exactly p_to does not (15 excluded), nor the one before p_from (2 excluded)');
select is(
  (select count(*) from private.task_points_in_range('2028-03-01 00:00:00+00', '2028-04-01 00:00:00+00')
    where member_id = '82600000-0000-0000-0000-000000000011'),
  0::bigint,
  'a sanction row is not a Task Point -- no row at all, since it carries no evaluation_id to join on');
select is(
  (select task_points from private.task_points_in_range('2028-03-01 00:00:00+00', '2028-04-01 00:00:00+00')
    where member_id = '82600000-0000-0000-0000-000000000012'),
  0,
  'a reversed in-range award nets to zero');
select is(
  (select points_ledger.created_at < '2028-03-01 00:00:00+00' or points_ledger.created_at >= '2028-04-01 00:00:00+00'
     from public.points_ledger where member_id = '82600000-0000-0000-0000-000000000013' and reason = 'task_reversal'),
  true,
  'fixture check: CreatedAt 826''s reversal ledger row is dated outside [p_from, p_to)');
select is(
  (select task_points from private.task_points_in_range('2028-03-01 00:00:00+00', '2028-04-01 00:00:00+00')
    where member_id = '82600000-0000-0000-0000-000000000013'),
  0,
  'CreatedAt 826 nets to zero although the reversal''s own ledger row is dated after p_to -- the Evaluation''s evaluated_at is read, not points_ledger.created_at');

-- ==================== 5. private.role_evaluation_rows: inclusive Bucharest days ====================
-- [period_from, period_to] converts to the half-open Bucharest instants
-- [period_from at 00:00, (period_to + 1) at 00:00) -- an award at 23:59
-- Bucharest on period_to is inside; one at 00:00 Bucharest the next day is
-- not.

insert into public.tasks
  (title, description, deadline, group_id, status, difficulty, rating,
   created_by, created_at, completed_at)
select fixture.title, 'Fixture #826', now() - interval '2 days',
       (select id from public.groups where name = 'Grup Evaluari 826'),
       'completed', 2, 5, '82600000-0000-0000-0000-000000000001',
       now() - interval '3 days', now()
  from (values ('Edge 826'), ('EdgeNext 826')) as fixture (title);

select pg_temp.test_credit_task(task.id, '82600000-0000-0000-0000-000000000014',
                                '82600000-0000-0000-0000-000000000001',
                                p_awarded_at => ('2028-05-10'::timestamp at time zone 'Europe/Bucharest')
                                                + interval '23 hours 59 minutes')
  from public.tasks as task where task.title = 'Edge 826';
select pg_temp.test_credit_task(task.id, '82600000-0000-0000-0000-000000000015',
                                '82600000-0000-0000-0000-000000000001',
                                p_awarded_at => ('2028-05-11'::timestamp at time zone 'Europe/Bucharest'))
  from public.tasks as task where task.title = 'EdgeNext 826';

select is(
  (select task_points from private.role_evaluation_rows('voluntar_activ', '2028-05-01', '2028-05-10', '2028-05-10')
    where member_id = '82600000-0000-0000-0000-000000000014'),
  6,
  'Edge 826, credited at 23:59 Bucharest on period_to, is inside the range');
select is(
  (select task_points from private.role_evaluation_rows('voluntar_activ', '2028-05-01', '2028-05-10', '2028-05-10')
    where member_id = '82600000-0000-0000-0000-000000000015'),
  0,
  'EdgeNext 826, credited at 00:00 Bucharest the day after period_to, is excluded');

-- ==================== 6. promotion_threshold_changes ====================

insert into public.promotion_threshold_changes
  (kind, from_value, to_value, source, changed_by, role_evaluation_id)
values
  ('voluntar_activ', 30, 35, 'manual', '82600000-0000-0000-0000-000000000001', null);
insert into public.promotion_threshold_changes
  (kind, from_value, to_value, source, role_evaluation_id)
select 'voluntar_activ', 35, 25, 'role_evaluation', re1 from fx826;

select has_table('public', 'promotion_threshold_changes', 'public.promotion_threshold_changes exists');
select is((select relrowsecurity from pg_class where oid = 'public.promotion_threshold_changes'::regclass), true,
  'promotion_threshold_changes has RLS enabled in the migration that creates it (house rule 2)');
select is(
  (select array_agg(policyname || ':' || cmd order by policyname)::text[] from pg_policies
    where schemaname = 'public' and tablename = 'promotion_threshold_changes'),
  array['promotion_threshold_changes_read:SELECT'],
  'the only policy is promotion_threshold_changes_read, for select -- no client write policy exists');
select columns_are('public', 'promotion_threshold_changes',
  array['id', 'kind', 'from_value', 'to_value', 'source', 'changed_by', 'role_evaluation_id', 'changed_at'],
  'promotion_threshold_changes carries the kind, the before/after values, its source and who or which run made it');

select throws_ok(
  $$ insert into public.promotion_threshold_changes (kind, from_value, to_value, source, changed_by, role_evaluation_id)
     values ('voluntar_activ', 10, 20, 'manual', null, null) $$,
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_source_shape_ck"',
  'promotion_threshold_changes_source_shape_ck: a manual change must name its author');
select throws_ok(
  format($$ insert into public.promotion_threshold_changes (kind, from_value, to_value, source, changed_by, role_evaluation_id)
     values ('voluntar_activ', 10, 20, 'role_evaluation', '82600000-0000-0000-0000-000000000001', %s) $$,
    (select re1 from fx826)),
  '23514', 'new row for relation "promotion_threshold_changes" violates check constraint "promotion_threshold_changes_source_shape_ck"',
  'promotion_threshold_changes_source_shape_ck: a hand-over names its run, never an author');

select is(
  array[has_table_privilege('authenticated', 'public.promotion_threshold_changes', 'select'),
        has_table_privilege('authenticated', 'public.promotion_threshold_changes', 'insert'),
        has_table_privilege('authenticated', 'public.promotion_threshold_changes', 'update'),
        has_table_privilege('authenticated', 'public.promotion_threshold_changes', 'delete')],
  array[true, false, false, false],
  'authenticated may select promotion_threshold_changes and nothing else');
select is(
  array[has_table_privilege('anon', 'public.promotion_threshold_changes', 'select'),
        has_table_privilege('anon', 'public.promotion_threshold_changes', 'insert')],
  array[false, false],
  'anon holds no privilege on promotion_threshold_changes');
select is(has_sequence_privilege('authenticated', 'public.promotion_threshold_changes_id_seq', 'usage'), false,
  'authenticated cannot allocate a promotion_threshold_changes id');

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select is((select count(*) from public.promotion_threshold_changes), 2::bigint,
  'BC (live level >= 6) reads both threshold changes');
reset role;

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000005');
select is((select count(*) from public.promotion_threshold_changes), 0::bigint,
  'an ordinary live active Member (level < 6) reads none -- the log is BC/Moderator only');
reset role;

select pg_temp.login_stale_bc826();
select is((select count(*) from public.promotion_threshold_changes), 0::bigint,
  'a deactivated BC''s still-valid token reads none -- the level gate reads the live Profile');
reset role;

select pg_temp.test_login('82600000-0000-0000-0000-000000000001', '{}'::jsonb);
select is((select count(*) from public.promotion_threshold_changes), 0::bigint,
  'a claimless session with BC''s real uid reads none (house rule 12)');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select count(*) from public.promotion_threshold_changes $$, '42501', null,
  'anon cannot read promotion_threshold_changes at all');
reset role;

select * from finish();
rollback;
