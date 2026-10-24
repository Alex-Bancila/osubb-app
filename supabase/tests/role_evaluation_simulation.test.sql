-- role_evaluation_simulation.test.sql -- R58 (Alex, 2026-10-18; spec
-- docs/superpowers/specs/2026-10-18-portofoliu-interne-design.md, section C):
-- one ranking of the eligible, the write-nothing Simulation and the finalised
-- run that measures its Promotion Candidates and Retention Signals against the
-- line it computes.
--
-- private.role_evaluation_rows(kind, from, to, floor, percent, cutoff) ranks
-- one pool for both kinds -- every live active Member below BCE (Recrut,
-- Voluntar, Voluntar Activ, Voluntar cu Drept de Vot); the Adunarea Generală
-- kind ranks the very pool the Voluntar Activ kind does (Alex, 2026-10-24) and
-- only its judging differs (it judges the voters alone and lists nobody). A
-- Member below the Eligibility Floor is evaluated but not ranked; the share is
-- taken over the ranked alone (ceil(percent x ranked / 100)); the line is the
-- Task Points of the share-th ranked Member and everyone at or above it is
-- inside; a Voluntar who joined on or before the cutoff is listable.
-- public.simulate_role_evaluation returns those rows and writes nothing;
-- public.run_role_evaluation records them, lists Candidates (listable and
-- inside), raises Signals (a holder not inside: below_line when ranked,
-- below_floor when not), hands the line over and writes the share it used
-- through to evaluation_settings -- never the Floor or the cutoff, which are
-- Setări's alone (Alex, 2026-10-20); public.role_evaluation_ranking(id)
-- recomputes a recorded run from its own values.
--
-- In order: 0. public.retention_signals' shape; 1. the shares at home
-- (evaluation_settings, migration log rows, org_settings without y); 2. the
-- Simulation's shape and grants; 3. the Voluntar Activ Simulation; 4. it
-- wrote nothing; 5. its refusals; 6. the Adunarea Generală Simulation (the
-- whole pool, a BCE, a BC and a Moderator left out); 7. a finalised Voluntar
-- Activ run; 8. a run that ranks nobody (Review Focus 3); 9. the ranking of a
-- recorded run; 10. a finalised Adunarea Generală run (the whole pool ranked,
-- the voters alone judged); 11. set_evaluation_percent writes the share home.
--
-- Fixtures: _r58_fixtures.psql (Members A-J and a BC member; their Task
-- Points inside [2026-03-01, 2026-09-30]). With Floor 10, 35 % and the cutoff
-- 2026-03-01: B (0) and J (5) are below the Floor, so 8 of 10 are ranked;
-- ceil(35 x 8 / 100) = 3, so the line is D's 40 and A, C, D are inside; C and
-- D joined on or before the cutoff, E and F after. The Voluntar Activ
-- threshold in force is set to 45 first, so a run that measured against it
-- (the pre-R58 rule) would drop D.
--
-- Mutation guards (run 2026-10-18 as scratch copies of this file that
-- redefine the named function after the fixture, inside the rolled-back
-- transaction), each turning the named assertion red:
--   * `task_points >= p_floor` -> `> p_floor` in private.role_evaluation_rows
--     -> "ranked_count is 8: B and J are below the Floor, I's 10 is at it";
--   * the run's Candidate loop measuring `task_points >= threshold_used` (the
--     line in force before) instead of `inside` -> "the run lists C and D as
--     Promotion Candidates";
--   * (2026-10-20, #1082's follow-ups) the run's Signal storing `v_line` for
--     every reason again -> "the run raises a Retention Signal for every
--     holder not inside" and "every holder raises a below_floor Signal,
--     measured against the Floor";
--   * the Simulation's cutoff check judging every kind again -> "a cutoff
--     tomorrow is not judged for the Adunarea Generală kind";
--   * (2026-10-24) the core's adunarea_generala arm back to `profile.role =
--     'vot'` -> "the Adunarea Generală kind ranks the same pool ...", "the
--     Adunarea Generală line is read over the whole pool ...", "the finalised
--     Adunarea Generală run ranked the whole pool ..." and the rest of section
--     10 (the line, the Signals, the Notification, the ranking);
--   * (2026-10-20, a run writes back only the share) section 9 writing the
--     Floor back again -> "the run logs exactly the hand-over (45 -> 40)
--     naming itself...", "Setări keeps the Prag minim and the Data limită de
--     intrare unset..." and "the Floor the second run used (100) is not
--     written back..."; writing the cutoff back again -> the first two.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(78);

\ir _r58_fixtures.psql

-- Three Members who are never in a pool, whatever they earn (Alex,
-- 2026-10-24: every Member below BCE, so not the BCE, the BC or the
-- Moderator): each credited as much as the best-ranked Member, so a pool that
-- let one in would show it among the first rows. The fixture's BC is the first.
insert into auth.users (id, email) values
  ('58589000-0000-0000-0000-0000000000b1', 'bce-r58@test.local'),
  ('58589000-0000-0000-0000-0000000000b2', 'moderator-r58@test.local');
insert into public.profiles (id, full_name, email, role, status, joined_at) values
  ('58589000-0000-0000-0000-0000000000b1', 'BCE R58',       'bce-r58@test.local',       'bce',       'activ', '2020-01-01'),
  ('58589000-0000-0000-0000-0000000000b2', 'Moderator R58', 'moderator-r58@test.local', 'moderator', 'activ', '2020-01-01');
select pg_temp.r58_credit(excluded.member_id, 10, 5)
  from (values (pg_temp.r58('BC')),
               ('58589000-0000-0000-0000-0000000000b1'::uuid),
               ('58589000-0000-0000-0000-0000000000b2'::uuid)) as excluded (member_id);

-- The Voluntar Activ line in force before any run of this suite.
update public.promotion_thresholds set threshold = 45 where kind = 'voluntar_activ';

create temp table fx58 as
  select (select array_agg(profile.id order by profile.id)
            from public.profiles as profile
            join public.roles as role on role.id = profile.role
           where profile.status = 'activ' and role.level >= 6) as leaders,
         -- Main's Retention Signal recipients: every live level >= 6 Member
         -- and the Adunarea Generală's Group Responsibles at level >= 5.
         (select array_agg(recipient order by recipient)
            from (select profile.id
                    from public.profiles as profile
                    join public.roles as role on role.id = profile.role
                   where profile.status = 'activ' and role.level >= 6
                  union
                  select held.member_id
                    from public.group_members as held
                    join public.profiles as profile on profile.id = held.member_id
                    join public.roles as role on role.id = profile.role
                   where held.group_id = (select value::bigint from public.org_settings
                                           where key = 'adunarea_generala_group_id')
                     and held.group_role = 'responsible'
                     and profile.status = 'activ'
                     and role.level >= 5) as everyone (recipient)) as signal_recipients;
grant select on fx58 to authenticated;

create temp table runs58 (label text, role_evaluation_id bigint, candidates int, retention_signals int);
grant insert, select on runs58 to authenticated;

-- The expected Voluntar Activ ranking: Floor 10, 35 %, cutoff 2026-03-01.
create temp table va58 (member_id uuid, role public.member_role, task_points integer, ranked boolean,
                        rank integer, evaluated_count integer, ranked_count integer, share_size integer,
                        line integer, inside boolean, listable boolean);
insert into va58 values
  (pg_temp.r58('A'), 'recrut',   60, true,  1,    10, 8, 3, 40, true,  false),
  (pg_temp.r58('C'), 'voluntar', 50, true,  2,    10, 8, 3, 40, true,  true),
  (pg_temp.r58('D'), 'voluntar', 40, true,  3,    10, 8, 3, 40, true,  true),
  (pg_temp.r58('E'), 'voluntar', 30, true,  4,    10, 8, 3, 40, false, false),
  (pg_temp.r58('F'), 'voluntar', 25, true,  5,    10, 8, 3, 40, false, false),
  (pg_temp.r58('G'), 'activ',    20, true,  6,    10, 8, 3, 40, false, false),
  (pg_temp.r58('H'), 'activ',    15, true,  7,    10, 8, 3, 40, false, false),
  (pg_temp.r58('I'), 'vot',      10, true,  8,    10, 8, 3, 40, false, false),
  (pg_temp.r58('J'), 'vot',       5, false, null, 10, 8, 3, 40, false, false),
  (pg_temp.r58('B'), 'recrut',    0, false, null, 10, 8, 3, 40, false, false);
grant select on va58 to authenticated;

-- The expected Adunarea Generală ranking: the same pool, Floor 10, 25 %, no
-- cutoff -- 8 ranked, share ceil(25 x 8 / 100) = 2, so the line is C's 50 and
-- only A and C are inside; nobody is listable.
create temp table ag58 (member_id uuid, role public.member_role, task_points integer, ranked boolean,
                        rank integer, evaluated_count integer, ranked_count integer, share_size integer,
                        line integer, inside boolean, listable boolean);
insert into ag58 values
  (pg_temp.r58('A'), 'recrut',   60, true,  1,    10, 8, 2, 50, true,  false),
  (pg_temp.r58('C'), 'voluntar', 50, true,  2,    10, 8, 2, 50, true,  false),
  (pg_temp.r58('D'), 'voluntar', 40, true,  3,    10, 8, 2, 50, false, false),
  (pg_temp.r58('E'), 'voluntar', 30, true,  4,    10, 8, 2, 50, false, false),
  (pg_temp.r58('F'), 'voluntar', 25, true,  5,    10, 8, 2, 50, false, false),
  (pg_temp.r58('G'), 'activ',    20, true,  6,    10, 8, 2, 50, false, false),
  (pg_temp.r58('H'), 'activ',    15, true,  7,    10, 8, 2, 50, false, false),
  (pg_temp.r58('I'), 'vot',      10, true,  8,    10, 8, 2, 50, false, false),
  (pg_temp.r58('J'), 'vot',       5, false, null, 10, 8, 2, 50, false, false),
  (pg_temp.r58('B'), 'recrut',    0, false, null, 10, 8, 2, 50, false, false);
grant select on ag58 to authenticated;

create function pg_temp.sim58() returns text language sql as $$
  select $q$ select * from public.simulate_role_evaluation('voluntar_activ', '2026-03-01', '2026-09-30', 10, 35, '2026-03-01') $q$
$$;
grant execute on function pg_temp.sim58() to authenticated;

-- Every public table's row count, read as the owner.
create function pg_temp.table_counts58() returns jsonb language plpgsql as $$
declare
  t record; n bigint; counts jsonb := '{}';
begin
  for t in
    select c.relname from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r'
     order by c.relname
  loop
    execute format('select count(*) from public.%I', t.relname) into n;
    counts := counts || jsonb_build_object(t.relname, n);
  end loop;
  return counts;
end $$;

-- ==================== 0. public.retention_signals ====================

select has_table('public', 'retention_signals', 'public.retention_signals exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.retention_signals'::regclass)
  and (select array_agg(policyname || ':' || cmd order by policyname)::text[] from pg_policies
        where schemaname = 'public' and tablename = 'retention_signals') = array['retention_signals_read:SELECT'],
  true,
  'retention_signals has RLS on and one policy, retention_signals_read, for select -- no client write policy');
select has_trigger('public', 'retention_signals', 'broadcast_change',
  'retention_signals broadcasts its changes (ADR-0011)');
select is(
  array[has_table_privilege('authenticated', 'public.retention_signals', 'select'),
        has_table_privilege('authenticated', 'public.retention_signals', 'insert'),
        has_table_privilege('authenticated', 'public.retention_signals', 'update'),
        has_table_privilege('authenticated', 'public.retention_signals', 'delete'),
        has_table_privilege('anon', 'public.retention_signals', 'select')],
  array[true, false, false, false, false],
  'authenticated may only select retention_signals (the run is the write path); anon holds nothing');

-- ==================== 1. The shares at home ====================

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select results_eq(
  $$ select kind, percent, changed_at is not null, changed_by from public.evaluation_percents() $$,
  $$ values ('voluntar_activ'::text, 35, true, null::uuid), ('adunarea_generala'::text, 25, false, null::uuid) $$,
  'after reset evaluation_percents() reads x 35 and y 25 from evaluation_settings; x was last changed by the migration (no Member), y never (Ruling 16)');
reset role;
select results_eq(
  $$ select kind, from_value, to_value, source, changed_by, role_evaluation_id
       from public.promotion_threshold_changes
      where field = 'percent' order by kind desc $$,
  $$ values ('voluntar_activ'::text, 30, 35, 'migration'::text, null::uuid, null::bigint) $$,
  'the day-one change is logged only where a share moves (Ruling 16): x from the top_percent rule''s 30 to 35, source migration; y, already 25 in the org setting, is not logged');
select is((select count(*) from public.org_settings where key = 'vote_retention_percent'), 0::bigint,
  'org_settings holds no vote_retention_percent: y lives in evaluation_settings.vot_percent');

-- ==================== 2. The Simulation's shape and grants ====================

select is(
  (select array_agg(format('%s:%s:%s', p.proname, p.prosecdef::text, p.provolatile) order by p.proname)
     from pg_proc p
    where p.oid in ('public.simulate_role_evaluation(text, date, date, integer, integer, date)'::regprocedure,
                    'private.simulate_role_evaluation_impl(text, date, date, integer, integer, date)'::regprocedure,
                    'private.role_evaluation_rows(text, date, date, integer, integer, date)'::regprocedure)),
  array['role_evaluation_rows:false:s', 'simulate_role_evaluation:false:s', 'simulate_role_evaluation_impl:true:s'],
  'the Simulation wrapper is security invoker, its body security definer, the core invoker; all three are stable -- none can write a row');
select is(
  (select count(*)
     from unnest(array['public.simulate_role_evaluation(text, date, date, integer, integer, date)',
                       'private.simulate_role_evaluation_impl(text, date, date, integer, integer, date)']) as fn,
          unnest(array['anon', 'service_role', 'public']) as grantee
    where has_function_privilege(grantee, fn, 'execute')),
  0::bigint,
  'anon, service_role and PUBLIC execute neither the Simulation nor its body');
select is(
  array[has_function_privilege('authenticated', 'public.simulate_role_evaluation(text, date, date, integer, integer, date)', 'execute'),
        has_function_privilege('authenticated', 'private.simulate_role_evaluation_impl(text, date, date, integer, integer, date)', 'execute'),
        has_function_privilege('authenticated', 'private.role_evaluation_rows(text, date, date, integer, integer, date)', 'execute')],
  array[true, true, false],
  'authenticated executes the Simulation and its body; the unfiltered core is executable by nobody');

-- ==================== 3. The Voluntar Activ Simulation ====================

create temp table before58 as select pg_temp.table_counts58() as counts,
                                     (select count(*) from public.notifications) as notifications;

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select results_eq(pg_temp.sim58(), $$ select * from va58 order by task_points desc, member_id $$,
  'BC simulates the Voluntar Activ kind: one ranking of everyone below BCE, the Recruți included, the Floor deciding who is ranked');
select is((select distinct evaluated_count from public.simulate_role_evaluation(
             'voluntar_activ', '2026-03-01', '2026-09-30', 10, 35, '2026-03-01')), 10,
  'evaluated_count is 10: every active Recrut, Voluntar, Voluntar Activ and Voluntar cu Drept de Vot');
select is((select distinct ranked_count from public.simulate_role_evaluation(
             'voluntar_activ', '2026-03-01', '2026-09-30', 10, 35, '2026-03-01')), 8,
  'ranked_count is 8: B and J are below the Floor, I''s 10 is at it');
select is((select distinct share_size from public.simulate_role_evaluation(
             'voluntar_activ', '2026-03-01', '2026-09-30', 10, 35, '2026-03-01')), 3,
  'share_size is 3: ceil(35 x 8 / 100), over the ranked alone');
select is((select distinct line from public.simulate_role_evaluation(
             'voluntar_activ', '2026-03-01', '2026-09-30', 10, 35, '2026-03-01')), 40,
  'the line is 40: D''s Task Points, the third ranked');
select is(
  (select array_agg(member_id order by member_id) from public.simulate_role_evaluation(
     'voluntar_activ', '2026-03-01', '2026-09-30', 10, 35, '2026-03-01') where inside),
  array[pg_temp.r58('A'), pg_temp.r58('C'), pg_temp.r58('D')],
  'inside are exactly A, C and D -- a Recrut shapes the line and is inside it');
select is(
  (select array_agg(member_id order by member_id) from public.simulate_role_evaluation(
     'voluntar_activ', '2026-03-01', '2026-09-30', 10, 35, '2026-03-01') where listable),
  array[pg_temp.r58('C'), pg_temp.r58('D')],
  'listable are only C and D: Voluntars who joined on or before the cutoff (E and F joined after)');
reset role;

-- ==================== 4. The Simulation wrote nothing ====================

select is(pg_temp.table_counts58(), (select counts from before58),
  'after the Simulation every public table holds exactly the rows it held before');
select is((select count(*) from public.notifications), (select notifications from before58),
  'and no Notification was sent');

-- ==================== 5. Refusals ====================

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select throws_ok($$ select * from public.simulate_role_evaluation('voluntar_activ', '2026-03-01', '2026-09-30', 0, 35, '2026-03-01') $$,
  'PT400', 'invalid_eligibility_floor', 'a Floor of 0 is invalid_eligibility_floor -- the Floor is at least 1');
select throws_ok($$ select * from public.simulate_role_evaluation('voluntar_activ', '2026-03-01', '2026-09-30', null, 35, '2026-03-01') $$,
  'PT400', 'invalid_eligibility_floor', 'no Floor is invalid_eligibility_floor');
select throws_ok($$ select * from public.simulate_role_evaluation('voluntar_activ', '2026-03-01', '2026-09-30', 10, 101, '2026-03-01') $$,
  'PT400', 'invalid_percent', 'a share above 100 is invalid_percent');
select throws_ok($$ select * from public.simulate_role_evaluation('voluntar_activ', '2026-03-01', '2026-09-30', 10, 35) $$,
  'PT400', 'membership_cutoff_not_set', 'the Voluntar Activ kind without a cutoff is membership_cutoff_not_set');
select throws_ok(
  format($$ select * from public.simulate_role_evaluation('voluntar_activ', '2026-03-01', '2026-09-30', 10, 35, %L) $$,
         (now() at time zone 'Europe/Bucharest')::date + 1),
  'PT400', 'invalid_membership_cutoff',
  'a cutoff tomorrow is invalid_membership_cutoff -- the value set_membership_cutoff would refuse');
select throws_ok(
  format($$ select * from public.simulate_role_evaluation('voluntar_activ', '2026-03-01', %L, 10, 35, '2026-03-01') $$,
         (now() at time zone 'Europe/Bucharest')::date + 1),
  'PT400', 'date_range_in_future', 'an Evaluation Period ending tomorrow is date_range_in_future');
select throws_ok($$ select * from public.simulate_role_evaluation('bogus', '2026-03-01', '2026-09-30', 10, 35, '2026-03-01') $$,
  'PT400', 'invalid_role_evaluation_kind', 'an unknown kind is invalid_role_evaluation_kind');
reset role;

select pg_temp.test_login_leadership(pg_temp.r58('C'));
select throws_ok(pg_temp.sim58(), '42501', 'role_evaluation_manage_forbidden', 'a Voluntar cannot simulate');
reset role;
select pg_temp.test_login(pg_temp.r58('BC'), '{}'::jsonb);
select throws_ok(pg_temp.sim58(), '42501', 'role_evaluation_manage_forbidden',
  'a claimless session cannot simulate, though its uid is a live BC');
select throws_ok($$ select * from public.simulate_role_evaluation('voluntar_activ', '2026-03-01', '2026-09-30', 0, 35, '2026-03-01') $$,
  'PT400', 'invalid_eligibility_floor', 'a malformed Floor is answered before the gate, to a claimless session too');
reset role;

-- ==================== 6. The Adunarea Generală Simulation ====================

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select results_eq(
  $$ select * from public.simulate_role_evaluation('adunarea_generala', '2026-03-01', '2026-09-30', 10, 25) $$,
  $$ select * from ag58 order by task_points desc, member_id $$,
  'the Adunarea Generală kind ranks the same pool as the Voluntar Activ kind -- the Recruți, Voluntari, Voluntari Activi and holders beside the voters -- needs no cutoff and lists nobody');
select results_eq(
  $$ select distinct line, share_size, evaluated_count, ranked_count
       from public.simulate_role_evaluation('adunarea_generala', '2026-03-01', '2026-09-30', 10, 25) $$,
  $$ values (50, 2, 10, 8) $$,
  'the Adunarea Generală line is read over the whole pool: the second of 8 ranked, C''s 50 -- the voters alone would have read 10');
select is(
  (select count(*) from public.simulate_role_evaluation('adunarea_generala', '2026-03-01', '2026-09-30', 10, 25)
    where member_id in (pg_temp.r58('BC'), '58589000-0000-0000-0000-0000000000b1', '58589000-0000-0000-0000-0000000000b2')),
  0::bigint,
  'a BC, a BCE and the Moderator are in no pool, whatever they earned: the Adunarea Generală Simulation holds none of the three');
select lives_ok(
  format($$ select * from public.simulate_role_evaluation('adunarea_generala', '2026-03-01', '2026-09-30', 10, 25, %L) $$,
         (now() at time zone 'Europe/Bucharest')::date + 1),
  'a cutoff tomorrow is not judged for the Adunarea Generală kind, which ignores it');
reset role;

-- ==================== 7. A finalised Voluntar Activ run ====================

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select lives_ok(
  $$ insert into runs58 select 's1', * from public.run_role_evaluation(
       'voluntar_activ', '2026-03-01', '2026-09-30', 'Evaluare S1', 10, 35, '2026-03-01') $$,
  'BC finalises the Voluntar Activ run with the values simulated');
reset role;

select results_eq($$ select candidates, retention_signals from runs58 where label = 's1' $$,
  $$ values (2, 4) $$, 'the run returns two Promotion Candidates and four Retention Signals');
select results_eq(
  $$ select run.kind, run.name, run.period_from, run.period_to, run.run_by,
            run.eligibility_floor, run.percent_used, run.membership_cutoff,
            run.evaluated_count, run.ranked_count, run.threshold_used, run.threshold_computed
       from public.role_evaluations as run
      where run.id = (select role_evaluation_id from runs58 where label = 's1') $$,
  $$ values ('voluntar_activ'::text, 'Evaluare S1'::text, '2026-03-01'::date, '2026-09-30'::date, pg_temp.r58('BC'),
             10, 35, '2026-03-01'::date, 10, 8, 45, 40) $$,
  'the run row records its values: Floor 10, 35 %, cutoff 2026-03-01, 10 evaluated, 8 ranked, the line in force before (45) and the line computed (40)');
select results_eq(
  $$ select threshold, updated_by from public.promotion_thresholds where kind = 'voluntar_activ' $$,
  $$ values (40, null::uuid) $$,
  'the computed 40 is handed over: the Voluntar Activ Promotion Threshold in force is 40, by the run');
select results_eq(
  $$ select field, kind, from_value, to_value, from_date, to_date, source, changed_by
       from public.promotion_threshold_changes
      where role_evaluation_id = (select role_evaluation_id from runs58 where label = 's1')
      order by field $$,
  $$ values ('threshold'::text, 'voluntar_activ'::text, 45, 40, null::date, null::date, 'role_evaluation'::text, null::uuid) $$,
  'the run logs exactly the hand-over (45 -> 40) naming itself: the Floor (10) and the cutoff (2026-03-01) it used are not written back, so no floor or cutoff row; the share it used was already 35');
select results_eq(
  $$ select eligibility_floor, activ_percent, vot_percent, membership_cutoff, updated_by
       from public.evaluation_settings where id = 1 $$,
  $$ values (null::int, 35, 25, null::date, null::uuid) $$,
  'Setări keeps the Prag minim and the Data limită de intrare unset: a run records the Floor 10 and the cutoff 2026-03-01 it used on its own row and never writes them back');
select results_eq(
  $$ select member_id, task_points, tenure_since, threshold_used, decision
       from public.promotion_candidates
      where role_evaluation_id = (select role_evaluation_id from runs58 where label = 's1')
      order by member_id $$,
  $$ values (pg_temp.r58('C'), 50, '2026-01-10'::date, 40, null::text),
            (pg_temp.r58('D'), 40, '2026-02-20'::date, 40, null::text) $$,
  'the run lists C and D as Promotion Candidates, measured against the line it computed (40) -- D is listed though the line in force was 45');
select is(
  (select array_agg(member_id order by member_id) from public.promotion_candidates where decision is null),
  array[pg_temp.r58('C'), pg_temp.r58('D')],
  'C and D are the only open Promotion Candidates: neither A (a Recrut inside) nor E and F (joined after the cutoff) are listed');
select results_eq(
  $$ select member_id, role_at_listing, reason, task_points, threshold_used, closed_at
       from public.retention_signals
      where role_evaluation_id = (select role_evaluation_id from runs58 where label = 's1')
      order by member_id $$,
  $$ values (pg_temp.r58('G'), 'activ'::public.member_role, 'below_line'::text, 20, 40, null::timestamptz),
            (pg_temp.r58('H'), 'activ', 'below_line', 15, 40, null),
            (pg_temp.r58('I'), 'vot', 'below_line', 10, 40, null),
            (pg_temp.r58('J'), 'vot', 'below_floor', 5, 10, null) $$,
  'the run raises a Retention Signal for every holder not inside: G, H and I below the line (40), J below the Floor (10), each storing the figure it fell under');
select is(
  (select count(*) from public.retention_signals
    where role_evaluation_id = (select role_evaluation_id from runs58 where label = 's1')
      and kind = 'voluntar_activ'),
  4::bigint, 'every Signal of the run is of the Voluntar Activ kind');
select is(
  (select count(*) from public.promotion_candidates where member_id in (pg_temp.r58('A'), pg_temp.r58('E'), pg_temp.r58('F')) and decision is null)
  + (select count(*) from public.retention_signals where member_id in (pg_temp.r58('A'), pg_temp.r58('E'), pg_temp.r58('F'))),
  0::bigint,
  'A, a Recrut inside the line, and E and F, Voluntars who joined after the cutoff, are neither Candidate nor Signal');
select is(
  (select array_agg(distinct dedupe_key order by dedupe_key) from public.notifications
    where dedupe_key like '%:' || (select role_evaluation_id from runs58 where label = 's1') || ':%'),
  (select array_agg(k order by k) from (
     select 'promotion_candidate:' || role_evaluation_id || ':' || member::text
       from runs58, unnest(array[pg_temp.r58('C'), pg_temp.r58('D')]) as member where label = 's1'
     union all
     select 'retention_signal:' || role_evaluation_id || ':' || member::text
       from runs58, unnest(array[pg_temp.r58('G'), pg_temp.r58('H'), pg_temp.r58('I'), pg_temp.r58('J')]) as member
      where label = 's1') as keys (k)),
  'one Notification key per Candidate and per Signal, in main''s shapes');
select is(
  (select array_agg(distinct link) from public.notifications
    where dedupe_key like 'promotion_candidate:' || (select role_evaluation_id from runs58 where label = 's1') || ':%'),
  array['/administrare/portofoliu-interne'],
  'a Candidate''s Notification links to Portofoliu Interne, which its readers -- BC and the Moderator -- open');
select is(
  (select bool_and(link = '/tracker/membru/' || split_part(dedupe_key, ':', 3)) from public.notifications
    where dedupe_key like 'retention_signal:' || (select role_evaluation_id from runs58 where label = 's1') || ':%'),
  true,
  'a Signal''s Notification links to the Member''s tracker page, which an Adunarea Generală Responsible at level 5 can open');
select is(
  (select array_agg(member_id order by member_id) from public.notifications
    where dedupe_key = 'promotion_candidate:' || (select role_evaluation_id from runs58 where label = 's1')
                       || ':' || pg_temp.r58('C')),
  (select leaders from fx58),
  'a Candidate is told once to every live BC and Moderator');
select is(
  (select array_agg(member_id order by member_id) from public.notifications
    where dedupe_key = 'retention_signal:' || (select role_evaluation_id from runs58 where label = 's1')
                       || ':' || pg_temp.r58('J')),
  (select signal_recipients from fx58),
  'a Signal is told once to every live BC and Moderator and the Adunarea Generală''s Group Responsibles at level 5 or above');
select results_eq(
  $$ select title, body from public.notifications
      where member_id = pg_temp.r58('BC')
        and dedupe_key = 'promotion_candidate:' || (select role_evaluation_id from runs58 where label = 's1')
                         || ':' || pg_temp.r58('C') $$,
  $$ values ('Candidat la promovare: Voluntar C R58'::text,
             'Voluntar C R58 are 50 puncte de task în evaluarea „Evaluare S1” (01.03.2026–30.09.2026), '
             || 'cel puțin pragul de promovare de 40 puncte, intrat în OSUBB până la 01.03.2026. Nu este promovat automat: '
             || 'îl poți promova în Voluntar Activ din panoul de roluri sau respinge din Portofoliu Interne.') $$,
  'the Candidate''s Notification names the line computed and the cutoff, never a tenure');
select results_eq(
  $$ select title, body from public.notifications
      where member_id = pg_temp.r58('BC')
        and dedupe_key = 'retention_signal:' || (select role_evaluation_id from runs58 where label = 's1')
                         || ':' || pg_temp.r58('G') $$,
  $$ values ('Semnal de retenție: Activ G R58'::text,
             'Activ G R58 (Voluntar Activ) are 20 puncte de task în evaluarea „Evaluare S1” (01.03.2026–30.09.2026), '
             || 'sub pragul de promovare de 40 puncte. Rolul nu se retrage automat: decizia îi aparține BC.') $$,
  'a Signal below the line names the line computed');
select results_eq(
  $$ select body from public.notifications
      where member_id = pg_temp.r58('BC')
        and dedupe_key = 'retention_signal:' || (select role_evaluation_id from runs58 where label = 's1')
                         || ':' || pg_temp.r58('J') $$,
  $$ values ('Vot J R58 (Voluntar cu Drept de Vot) are 5 puncte de task în evaluarea „Evaluare S1” (01.03.2026–30.09.2026), '
             || 'sub pragul minim de 10 puncte. Rolul nu se retrage automat: decizia îi aparține BC.') $$,
  'a Signal below the Floor names the Floor');
select is(
  (select array_agg(role::text order by id) from public.profiles
    where id in (pg_temp.r58('C'), pg_temp.r58('D'), pg_temp.r58('G'), pg_temp.r58('J'))),
  array['voluntar', 'voluntar', 'activ', 'vot'],
  'every run is advisory: no Role changed');

-- ==================== 8. A run that ranks nobody (Review Focus 3) ====================

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select lives_ok(
  $$ insert into runs58 select 's2', * from public.run_role_evaluation(
       'voluntar_activ', '2026-03-01', '2026-09-30', 'Evaluare S1 prag 100', 100, 35, '2026-03-01') $$,
  'BC finalises a run whose Floor (100) nobody reaches');
reset role;
select results_eq(
  $$ select run.ranked_count, run.evaluated_count, run.threshold_used, run.threshold_computed, r.candidates, r.retention_signals
       from public.role_evaluations as run join runs58 as r on r.role_evaluation_id = run.id
      where r.label = 's2' $$,
  $$ values (0, 10, 40, null::int, 0, 4) $$,
  'nobody ranked: no line computed, no Candidate, four Signals');
select results_eq(
  $$ select threshold, (select count(*) from public.promotion_threshold_changes
                         where field = 'threshold'
                           and role_evaluation_id = (select role_evaluation_id from runs58 where label = 's2'))
       from public.promotion_thresholds where kind = 'voluntar_activ' $$,
  $$ values (40, 0::bigint) $$,
  'a run with no line hands nothing over: 40 stays in force, no threshold change logged');
select results_eq(
  $$ select member_id, decision from public.promotion_candidates
      where role_evaluation_id = (select role_evaluation_id from runs58 where label = 's1')
      order by member_id $$,
  $$ values (pg_temp.r58('C'), 'superseded'::text), (pg_temp.r58('D'), 'superseded'::text) $$,
  'the first run''s Candidates are superseded, and the second lists none');
select results_eq(
  $$ select member_id, reason, task_points, threshold_used
       from public.retention_signals
      where role_evaluation_id = (select role_evaluation_id from runs58 where label = 's2')
      order by member_id $$,
  $$ values (pg_temp.r58('G'), 'below_floor'::text, 20, 100),
            (pg_temp.r58('H'), 'below_floor', 15, 100),
            (pg_temp.r58('I'), 'below_floor', 10, 100),
            (pg_temp.r58('J'), 'below_floor', 5, 100) $$,
  'every holder raises a below_floor Signal, measured against the Floor (100): there is no line');
select results_eq(
  $$ select count(*), count(*) filter (where closed_as = 'superseded' and closed_at is not null)
       from public.retention_signals
      where role_evaluation_id = (select role_evaluation_id from runs58 where label = 's1') $$,
  $$ values (4::bigint, 4::bigint) $$,
  'the first run''s four Signals are closed as superseded');
select results_eq(
  $$ select body from public.notifications
      where member_id = pg_temp.r58('BC')
        and dedupe_key = 'retention_signal:' || (select role_evaluation_id from runs58 where label = 's2')
                         || ':' || pg_temp.r58('G') $$,
  $$ values ('Activ G R58 (Voluntar Activ) are 20 puncte de task în evaluarea „Evaluare S1 prag 100” (01.03.2026–30.09.2026), '
             || 'sub pragul minim de 100 puncte. Rolul nu se retrage automat: decizia îi aparține BC.') $$,
  'the unranked holder''s Notification names the Floor of that run');
select is((select eligibility_floor from public.evaluation_settings where id = 1), null::int,
  'the Floor the second run used (100) is not written back: the Prag minim is still unset in Setări');

-- ==================== 9. The ranking of a recorded run ====================

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select results_eq(
  format($$ select * from public.role_evaluation_ranking(%s) $$, (select role_evaluation_id from runs58 where label = 's1')),
  pg_temp.sim58(),
  'the ranking of the first run is the Simulation it finalised: recomputed from the run''s own Floor, share and cutoff');
select is(
  (select count(*) from public.role_evaluation_ranking((select role_evaluation_id from runs58 where label = 's2'))
    where ranked),
  0::bigint,
  'the second run''s ranking is recomputed with its own Floor (100): nobody ranked');
select throws_ok($$ select * from public.role_evaluation_ranking(-1) $$,
  'PT404', 'role_evaluation_not_found', 'an unknown run is role_evaluation_not_found');
reset role;

insert into public.role_evaluations (kind, name, period_from, period_to, run_by, threshold_used, threshold_computed, ranked_count)
values ('voluntar_activ', 'Evaluare veche R58', '2026-03-01', '2026-09-30', pg_temp.r58('BC'), 30, 25, 5);
select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select is(
  (select count(*) from public.role_evaluation_ranking(
     (select id from public.role_evaluations where name = 'Evaluare veche R58'))),
  0::bigint,
  'a run recorded before R58 (no Floor) has no ranking to recompute: no rows, no error');
reset role;

select pg_temp.test_login_leadership(pg_temp.r58('C'));
select results_eq(
  format($$ select member_id, task_points, rank, inside from public.role_evaluation_ranking(%s) $$,
         (select role_evaluation_id from runs58 where label = 's1')),
  $$ values (pg_temp.r58('C'), 50, 2, true) $$,
  'a ranked Voluntar reads exactly their own row of a recorded run');
reset role;
select pg_temp.test_login(pg_temp.r58('BC'), '{}'::jsonb);
select is(
  (select count(*) from public.role_evaluation_ranking((select role_evaluation_id from runs58 where label = 's1'))),
  0::bigint,
  'a claimless session reads nothing, with no error (house rule 12)');
reset role;

-- ==================== 10. A finalised Adunarea Generală run ====================
-- Alex, 2026-10-24: the run ranks the whole pool and judges the voters alone.
-- Floor 10, 25 %: the line is C's 50 (A 60, C 50), so I (10, ranked) is
-- below_line and J (5) below_floor; G and H, Voluntari Activi below the line,
-- are ranked and get no Signal from this kind.

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select lives_ok(
  $$ insert into runs58 select 'ag1', * from public.run_role_evaluation(
       'adunarea_generala', '2026-03-01', '2026-09-30', 'Evaluare AG S1', 10, 25) $$,
  'BC finalises an Adunarea Generală run with the values simulated');
reset role;

select results_eq($$ select candidates, retention_signals from runs58 where label = 'ag1' $$,
  $$ values (0, 2) $$, 'the run returns no Promotion Candidate and two Retention Signals, both of voters');
select results_eq(
  $$ select run.kind, run.eligibility_floor, run.percent_used, run.membership_cutoff,
            run.evaluated_count, run.ranked_count, run.threshold_computed
       from public.role_evaluations as run
      where run.id = (select role_evaluation_id from runs58 where label = 'ag1') $$,
  $$ values ('adunarea_generala'::text, 10, 25, null::date, 10, 8, 50) $$,
  'the finalised Adunarea Generală run ranked the whole pool: 10 evaluated, 8 ranked, the line C''s 50, no cutoff');
select results_eq(
  $$ select kind, member_id, role_at_listing, reason, task_points, threshold_used, closed_at
       from public.retention_signals
      where role_evaluation_id = (select role_evaluation_id from runs58 where label = 'ag1')
      order by member_id $$,
  $$ values ('adunarea_generala'::text, pg_temp.r58('I'), 'vot'::public.member_role, 'below_line'::text, 10, 50, null::timestamptz),
            ('adunarea_generala', pg_temp.r58('J'), 'vot', 'below_floor', 5, 10, null) $$,
  'the run stores Signals for the voters alone: I below the line (50), J below the Floor (10)');
select is(
  (select count(*) from public.retention_signals
    where role_evaluation_id = (select role_evaluation_id from runs58 where label = 'ag1')
      and member_id in (pg_temp.r58('G'), pg_temp.r58('H'), pg_temp.r58('A'), pg_temp.r58('B'), pg_temp.r58('C'),
                        pg_temp.r58('D'), pg_temp.r58('E'), pg_temp.r58('F')))
  + (select count(*) from public.promotion_candidates
      where role_evaluation_id = (select role_evaluation_id from runs58 where label = 'ag1')),
  0::bigint,
  'the Voluntari Activi G and H, ranked below the line, get no Signal from this kind, no other non-voter does, and the run lists no Promotion Candidate');
select is(
  (select threshold from public.promotion_thresholds where kind = 'adunarea_generala'), 50,
  'the line the run computed over the whole pool, 50, is the Adunarea Generală threshold in force');
select results_eq(
  $$ select title, body from public.notifications
      where member_id = pg_temp.r58('BC')
        and dedupe_key = 'retention_signal:' || (select role_evaluation_id from runs58 where label = 'ag1')
                         || ':' || pg_temp.r58('I') $$,
  $$ values ('Semnal de retenție: Vot I R58'::text,
             'Vot I R58 (Voluntar cu Drept de Vot) are 10 puncte de task în evaluarea „Evaluare AG S1” (01.03.2026–30.09.2026), '
             || 'sub pragul Adunării Generale de 50 puncte. Rolul nu se retrage automat: decizia îi aparține BC.') $$,
  'a voter below the whole pool''s line hears the Adunarea Generală line, 50');
select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select results_eq(
  format($$ select * from public.role_evaluation_ranking(%s) $$,
         (select role_evaluation_id from runs58 where label = 'ag1')),
  $$ select * from public.simulate_role_evaluation('adunarea_generala', '2026-03-01', '2026-09-30', 10, 25) $$,
  'the ranking of the run is the Simulation it finalised: the whole pool, recomputed from the run''s own Floor and share');
reset role;

-- ==================== 11. set_evaluation_percent writes the share home ====================

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select lives_ok($$ select public.set_evaluation_percent('voluntar_activ', 40) $$, 'BC sets x to 40 %');
reset role;
select results_eq(
  $$ select activ_percent, vot_percent, updated_by from public.evaluation_settings where id = 1 $$,
  $$ values (40, 25, pg_temp.r58('BC')) $$,
  'set_evaluation_percent writes evaluation_settings.activ_percent, with BC as updated_by');
select results_eq(
  $$ select kind, from_value, to_value, source, changed_by from public.promotion_threshold_changes
      where field = 'percent' order by id desc limit 1 $$,
  $$ values ('voluntar_activ'::text, 35, 40, 'manual'::text, pg_temp.r58('BC')) $$,
  'and logs the change, from 35 to 40, as BC''s');

select * from finish();
rollback;
