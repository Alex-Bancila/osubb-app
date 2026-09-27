-- role_evaluation_command.test.sql -- #826 (ruling R28): the one Role
-- Evaluation command, public.run_role_evaluation(p_kind, p_from, p_to, p_name),
-- over private.run_role_evaluation_impl.
--
-- In order: a held-lock probe of (47, 1), first -- before this transaction
-- takes the lock or writes a row, either of which would block the remote
-- session; the function and its privileges; step 1 (malformed for everyone,
-- before the gate); the gate; the unset threshold; a Voluntar Activ run
-- (candidates without promotion, the threshold line both ways, the per-cohort
-- boundary, the hand-over, the Notifications once per recipient); a
-- rejection and a hand edit, then a run over overlapping days where the
-- rejected Voluntar reappears and the previous undecided candidate is
-- superseded; a run under the handed-over threshold that lists nobody; the
-- disabled rule; the Adunarea Generală kind; a computed value below 1 is not
-- handed over; the transactional proof.
--
-- Fixtures (fixture prefix 82600000-), written as the owner inside this
-- rolled-back transaction. Every live active ladder holder the demo seed
-- brings is deactivated first, so each run meets only this suite's Members.
-- The Evaluation Period is [today - 30, today - 1] in Bucharest days; every
-- award is dated two days ago, inside it.
--   V1 voluntar, tenured, 20 points  -> candidate at 15
--   V4 voluntar, tenured, 15 points  -> candidate at 15 (the line is >=)
--   V2 voluntar, tenured, 10 points  -> below the line
--   V3 voluntar, joined today, 50    -> no tenure: not ranked at all
--   A1 activ 25, A2 activ 15, A3 activ 5 -> x = 30 % of 3 -> share 1 ->
--      computed 25 (the Voluntar Activ cohort alone; mixing the six ranked
--      Members would give ceil(1.8) = 2 -> 20); A3 below 15 is the one
--      Retention Signal, A2 at exactly 15 is not
--   G1 vot 12, G2 vot 3 -> y = 25 % of 2 -> share 1 -> computed 12; G1 is
--      also the Adunarea Generală Group's Responsible
--   R1 recrut with 100 points -> never ranked
--
-- Mutation guards, run 2026-09-27 as in-transaction redefinitions of
-- private.run_role_evaluation_impl, each turning the named assertion red:
--   * the candidate insert removed -> "the Voluntar Activ run writes one
--     Promotion Candidate per tenured Voluntar at or above the threshold";
--   * `>=` -> `>` on the candidate line -> the same assertion (V4 is lost);
--   * `<` -> `<=` on the retention line -> "exactly one Retention Signal";
--   * apply_promotion called for each candidate -> "a Promotion Candidate is
--     not promoted";
--   * the cohort filter (`role = v_holder_role`) dropped from the boundary ->
--     "the run computed 25";
--   * the supersede update removed -> "the next run supersedes the undecided
--     candidate" (the new candidate then trips the one-open index);
--   (The held-lock probe runs in a remote session, which sees only committed
--   code, so it was not run as a mutation: without the (47, 1) call the
--   remote run meets no held lock and completes, so the probe discriminates.)
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(57);

-- ==================== 1. The lock ====================
-- A held-lock probe, as #52's suite probes (52, 1): a run must wait on
-- (47, 1) before it reads a threshold. Both remote transactions roll back and
-- the committed BC is deleted after.

select extensions.dblink_connect('run_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('run_setup', 'set lock_timeout = ''2s''');
select extensions.dblink_exec('run_setup', $$
  delete from public.profiles where id in ('82600000-0000-0000-0000-0000000000f1', '82600000-0000-0000-0000-0000000000f2');
  delete from auth.users where id in ('82600000-0000-0000-0000-0000000000f1', '82600000-0000-0000-0000-0000000000f2');
  insert into auth.users (id, email) values
    ('82600000-0000-0000-0000-0000000000f1', 'race.bc.826@test.local'),
    ('82600000-0000-0000-0000-0000000000f2', 'race.vol.826@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('82600000-0000-0000-0000-0000000000f1', 'Race BC 826', 'race.bc.826@test.local', 'bc', 'activ'),
    ('82600000-0000-0000-0000-0000000000f2', 'Race Voluntar 826', 'race.vol.826@test.local', 'voluntar', 'activ');
$$);

reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-0000000000f1');
reset role;

select extensions.dblink_connect('run_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_connect('run_retry', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('run_lock',
  'begin; do $lock$ begin perform pg_catalog.pg_advisory_xact_lock(47, 1); end $lock$;');
select extensions.dblink_exec('run_retry', format(
  'begin; set local lock_timeout = ''250ms''; select set_config(''request.jwt.claims'', %L, true); set local role authenticated;',
  current_setting('request.jwt.claims')));
select throws_ok(
  $$ select * from extensions.dblink('run_retry',
       'select role_evaluation_id::text from public.run_role_evaluation(''voluntar_activ'', current_date - 30, current_date - 1, ''Probă #826'')')
       as result (id text) $$,
  '55P03', 'canceling statement due to lock timeout',
  'a run waits on the (47, 1) advisory lock another run or a threshold edit holds, before it reads a threshold');
select extensions.dblink_exec('run_retry', 'rollback;');
select extensions.dblink_exec('run_lock', 'rollback;');

-- A run holds the Profiles of its population `for key share` until it
-- commits (CodeRabbit on #835): a set_member_role on a Voluntar of that
-- population waits instead of promoting underneath the ranking. F2 is an
-- untenured Voluntar, never a candidate, so no candidate FK lock can stand in
-- for the Profile lock -- without it the promotion goes straight through.
select extensions.dblink_exec('run_lock', format(
  'begin; set local lock_timeout = ''2s''; select set_config(''request.jwt.claims'', %L, true); set local role authenticated;',
  current_setting('request.jwt.claims')));
select extensions.dblink_exec('run_lock',
  'do $run$ begin perform * from public.run_role_evaluation(''voluntar_activ'', current_date - 30, current_date - 1, ''Probă profiluri #826''); end $run$;');
select extensions.dblink_exec('run_retry', format(
  'begin; set local lock_timeout = ''250ms''; select set_config(''request.jwt.claims'', %L, true); set local role authenticated;',
  current_setting('request.jwt.claims')));
select throws_ok(
  $$ select * from extensions.dblink('run_retry',
       'select (public.set_member_role(''82600000-0000-0000-0000-0000000000f2'', ''activ'')).id::text')
       as result (id text) $$,
  '55P03', 'canceling statement due to lock timeout',
  'a Role change of a ranked Member waits for the run holding the population''s Profiles');
select extensions.dblink_exec('run_retry', 'rollback;');
select extensions.dblink_exec('run_lock', 'rollback;');
select extensions.dblink_disconnect('run_retry');
select extensions.dblink_disconnect('run_lock');

select extensions.dblink_exec('run_setup', $$
  delete from public.profiles where id in ('82600000-0000-0000-0000-0000000000f1', '82600000-0000-0000-0000-0000000000f2');
  delete from auth.users where id in ('82600000-0000-0000-0000-0000000000f1', '82600000-0000-0000-0000-0000000000f2');
$$);
select extensions.dblink_disconnect('run_setup');
select pg_temp.test_clear_jwt();

-- ==================== 2. The function and its privileges ====================

select function_returns('public', 'run_role_evaluation', array['text', 'date', 'date', 'text'], 'setof record',
  'public.run_role_evaluation(p_kind, p_from, p_to, p_name) returns (role_evaluation_id, candidates, retention_signals)');

create temp table fns826 (fn text);
insert into fns826 values
  ('public.run_role_evaluation(text, date, date, text)'),
  ('private.run_role_evaluation_impl(text, date, date, text)');
select is(
  (select count(*) from fns826, unnest(array['anon', 'service_role', 'public']) as grantee
    where has_function_privilege(grantee, fn, 'execute')),
  0::bigint, 'anon, service_role and PUBLIC execute neither the wrapper nor its _impl');
select is(
  (select count(*) from fns826 where has_function_privilege('authenticated', fn, 'execute')),
  2::bigint, 'authenticated executes the wrapper and its _impl (the invoker wrapper calls the _impl as the caller)');
select hasnt_function('public', 'open_evaluation_period', array['text'],
  'open_evaluation_period is gone: nothing opens a Period (R28)');
select hasnt_function('public', 'close_evaluation_period', array['bigint'],
  'close_evaluation_period is gone: nothing closes a Period (R28)');

-- ==================== Fixtures ====================

update public.profiles set status = 'inactiv'
 where status = 'activ'
   and role in ('recrut', 'voluntar', 'activ', 'vot')
   and id::text not like '82600000-%';

update public.promotion_rules set min_tenure_months = 6, enabled = true;
update public.promotion_rules set percent = 30 where kind = 'top_percent';
update public.org_settings set value = '25' where key = 'vote_retention_percent';
update public.org_settings set value = null where key = 'adherence_form_url';
update public.promotion_thresholds set threshold = 15 where kind = 'voluntar_activ';
update public.promotion_thresholds set threshold = null where kind = 'adunarea_generala';

insert into auth.users (id, email)
select ('82600000-0000-0000-0000-0000000000' || suffix)::uuid, 'm' || suffix || '-826@test.local'
  from unnest(array['01', '02', '03', '05', '11', '12', '13', '14', '21', '22', '23', '31', '32', '41']) as suffix;

insert into public.profiles (id, full_name, nickname, email, role, status, joined_at) values
  ('82600000-0000-0000-0000-000000000001', 'BC 826',         null,   'm01-826@test.local', 'bc',        'activ',   '2000-01-01'),
  ('82600000-0000-0000-0000-000000000002', 'Moderator 826',  null,   'm02-826@test.local', 'moderator', 'activ',   '2000-01-01'),
  ('82600000-0000-0000-0000-000000000003', 'BCE 826',        null,   'm03-826@test.local', 'bce',       'activ',   '2000-01-01'),
  ('82600000-0000-0000-0000-000000000005', 'BC inactiv 826', null,   'm05-826@test.local', 'bc',        'inactiv', '2000-01-01'),
  ('82600000-0000-0000-0000-000000000011', 'Vasile Unu',     'Vali', 'm11-826@test.local', 'voluntar',  'activ',   '2000-01-01'),
  ('82600000-0000-0000-0000-000000000012', 'Voluntar Doi',   null,   'm12-826@test.local', 'voluntar',  'activ',   '2000-01-01'),
  ('82600000-0000-0000-0000-000000000013', 'Voluntar Nou',   null,   'm13-826@test.local', 'voluntar',  'activ',   (now() at time zone 'Europe/Bucharest')::date),
  ('82600000-0000-0000-0000-000000000014', 'Voluntar Patru', null,   'm14-826@test.local', 'voluntar',  'activ',   '2000-01-01'),
  ('82600000-0000-0000-0000-000000000021', 'Activ Unu',      null,   'm21-826@test.local', 'activ',     'activ',   '2000-01-01'),
  ('82600000-0000-0000-0000-000000000022', 'Activ Doi',      null,   'm22-826@test.local', 'activ',     'activ',   '2000-01-01'),
  ('82600000-0000-0000-0000-000000000023', 'Ana Trei',       'Ana',  'm23-826@test.local', 'activ',     'activ',   '2000-01-01'),
  ('82600000-0000-0000-0000-000000000031', 'Vot Unu',        null,   'm31-826@test.local', 'vot',       'activ',   '2000-01-01'),
  ('82600000-0000-0000-0000-000000000032', 'Vot Doi',        null,   'm32-826@test.local', 'vot',       'activ',   '2000-01-01'),
  ('82600000-0000-0000-0000-000000000041', 'Recrut 826',     null,   'm41-826@test.local', 'recrut',    'activ',   '2000-01-01');

insert into public.groups (name, category, min_level) values
  ('Grup Evaluări 826', 'department', 0),
  ('Adunarea Generală 826', 'department', 3);
insert into public.group_members (group_id, member_id, group_role)
select id, '82600000-0000-0000-0000-000000000031', 'responsible'
  from public.groups where name = 'Adunarea Generală 826';
update public.org_settings
   set value = (select id::text from public.groups where name = 'Adunarea Generală 826')
 where key = 'adunarea_generala_group_id';

-- Credits p Task Points two days ago: one Task per 15 points (difficulty 5,
-- rating 5), then 5s (difficulty 5, rating 3 -> x1), then the rest.
create function pg_temp.credit826(p_member uuid, p_points int, p_at timestamptz default now() - interval '2 days')
returns void language plpgsql as $$
declare
  v_left int := p_points;
  v_d int;
  v_r int;
  v_task bigint;
begin
  while v_left > 0 loop
    if v_left >= 15 then v_d := 5; v_r := 5; v_left := v_left - 15;
    elsif v_left >= 5 then v_d := 5; v_r := 3; v_left := v_left - 5;
    else v_d := v_left; v_r := 3; v_left := 0;
    end if;
    insert into public.tasks
      (title, description, deadline, group_id, status, difficulty, rating,
       created_by, created_at, completed_at)
    values ('Credit #826 ' || gen_random_uuid(), 'Fixture', p_at,
            (select id from public.groups where name = 'Grup Evaluări 826'),
            'completed', v_d, v_r, '82600000-0000-0000-0000-000000000001',
            p_at - interval '1 day', p_at)
    returning id into v_task;
    insert into public.task_assignments (task_id, member_id, assigned_at, ended_at, end_reason)
    values (v_task, p_member, p_at - interval '1 day', p_at, 'completed');
    perform pg_temp.test_credit_task(v_task, p_member, '82600000-0000-0000-0000-000000000001',
                                     p_awarded_at => p_at);
  end loop;
end $$;

select pg_temp.credit826('82600000-0000-0000-0000-000000000011', 20);
select pg_temp.credit826('82600000-0000-0000-0000-000000000012', 10);
select pg_temp.credit826('82600000-0000-0000-0000-000000000013', 50);
select pg_temp.credit826('82600000-0000-0000-0000-000000000014', 15);
select pg_temp.credit826('82600000-0000-0000-0000-000000000021', 25);
select pg_temp.credit826('82600000-0000-0000-0000-000000000022', 15);
select pg_temp.credit826('82600000-0000-0000-0000-000000000023', 5);
select pg_temp.credit826('82600000-0000-0000-0000-000000000031', 12);
select pg_temp.credit826('82600000-0000-0000-0000-000000000032', 3);
select pg_temp.credit826('82600000-0000-0000-0000-000000000041', 100);

create temp table fx826 as
  select ((now() at time zone 'Europe/Bucharest')::date - 30) as d_from,
         ((now() at time zone 'Europe/Bucharest')::date - 1)  as d_to,
         (now() at time zone 'Europe/Bucharest')::date        as today,
         (select array_agg(profile.id order by profile.id)
            from public.profiles as profile
            join public.roles as role on role.id = profile.role
           where profile.status = 'activ' and role.level >= 6) as leaders;
grant select on fx826 to authenticated;
create temp table runs826 (label text, role_evaluation_id bigint, candidates int, retention_signals int);
grant insert, select on runs826 to authenticated;

-- ==================== 3. Step 1, before the gate ====================
-- A claimless session: every malformed input is PT400, never 42501.

select pg_temp.test_login('82600000-0000-0000-0000-000000000001', '{"provider":"email"}'::jsonb);
select throws_ok($$ select * from public.run_role_evaluation(null, current_date - 2, current_date - 1, 'Evaluare') $$,
  'PT400', 'invalid_role_evaluation_kind', 'a null kind is invalid_role_evaluation_kind, before the gate');
select throws_ok($$ select * from public.run_role_evaluation('drept_de_vot', current_date - 2, current_date - 1, 'Evaluare') $$,
  'PT400', 'invalid_role_evaluation_kind', 'an unknown kind is invalid_role_evaluation_kind, before the gate');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, E' \t ') $$,
  'PT400', 'invalid_role_evaluation_name', 'a blank name is invalid_role_evaluation_name, before the gate');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, E' ab\t') $$,
  'PT400', 'name_too_short', 'the name is measured trimmed: two characters are name_too_short');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, repeat('e', 121)) $$,
  'PT400', 'name_too_long', 'a 121-character name is name_too_long');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', null, current_date - 1, 'Evaluare') $$,
  'PT400', 'invalid_date_range', 'a missing start is invalid_date_range');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 1, current_date - 2, 'Evaluare') $$,
  'PT400', 'invalid_date_range', 'an end before the start is invalid_date_range');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date + 2, 'Evaluare') $$,
  'PT400', 'date_range_in_future', 'an Evaluation Period ending after today is date_range_in_future');

-- ==================== 4. The gate ====================

select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, 'Evaluare claimless') $$,
  '42501', 'role_evaluation_manage_forbidden', 'a claimless session cannot run a Role Evaluation, though its uid is a live BC');
reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000011');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, 'Evaluare Voluntar') $$,
  '42501', 'role_evaluation_manage_forbidden', 'a Voluntar cannot run a Role Evaluation');
reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000003');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, 'Evaluare BCE') $$,
  '42501', 'role_evaluation_manage_forbidden', 'a BCE cannot run a Role Evaluation');
reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000005');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, 'Evaluare inactiv') $$,
  '42501', 'role_evaluation_manage_forbidden', 'a deactivated BC''s still-valid token cannot run a Role Evaluation');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, 'Evaluare anon') $$,
  '42501', null, 'anon cannot execute run_role_evaluation');
reset role;
select is((select count(*) from public.role_evaluations where name like 'Evaluare%'), 0::bigint,
  'every refusal wrote no Role Evaluation');

-- ==================== 5. The first threshold is entered by hand ====================

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select throws_ok(
  format($$ select * from public.run_role_evaluation('adunarea_generala', %L, %L, 'AG fără prag') $$,
         (select d_from from fx826), (select d_to from fx826)),
  'PT409', 'promotion_threshold_not_set',
  'an Adunarea Generală run is refused while its threshold was never entered');

-- ==================== 6. BC runs a Voluntar Activ Role Evaluation ====================

select lives_ok(
  format($$ insert into runs826 select 'va1', * from public.run_role_evaluation('voluntar_activ', %L, %L, E'  Semestrul I #826\t') $$,
         (select d_from from fx826), (select d_to from fx826)),
  'BC runs a Voluntar Activ Role Evaluation');
reset role;

select results_eq(
  $$ select candidates, retention_signals from runs826 where label = 'va1' $$,
  $$ values (2, 1) $$,
  'the run returns its counts: two Promotion Candidates, one Retention Signal');
select results_eq(
  $$ select run.kind, run.name, run.period_from = fx.d_from, run.period_to = fx.d_to,
            run.run_by, run.run_at = now(), run.threshold_used, run.ranked_count
       from public.role_evaluations as run, fx826 as fx
      where run.id = (select role_evaluation_id from runs826 where label = 'va1') $$,
  $$ values ('voluntar_activ', 'Semestrul I #826', true, true,
             '82600000-0000-0000-0000-000000000001'::uuid, true, 15, 6) $$,
  'the run row: kind, trimmed name, the Evaluation Period, run_by, run_at, the threshold used, and six Members ranked (three tenured Voluntars, three Voluntar Activ holders)');
select is(
  (select threshold_computed from public.role_evaluations
    where id = (select role_evaluation_id from runs826 where label = 'va1')),
  25,
  'the run computed 25 -- the last holder inside the top 30 % of the Voluntar Activ cohort alone, never mixed with the tenured Voluntars');
select results_eq(
  $$ select member_id, task_points, tenure_since, decision
       from public.promotion_candidates
      where role_evaluation_id = (select role_evaluation_id from runs826 where label = 'va1')
      order by member_id $$,
  $$ values ('82600000-0000-0000-0000-000000000011'::uuid, 20, '2000-07-01'::date, null::text),
            ('82600000-0000-0000-0000-000000000014'::uuid, 15, '2000-07-01'::date, null::text) $$,
  'the Voluntar Activ run writes one Promotion Candidate per tenured Voluntar at or above the threshold -- 20 and exactly 15; not 10, not the untenured 50, not the Recrut''s 100');
select results_eq(
  $$ select profile.role::text,
            (select count(*) from public.role_history as history where history.member_id = profile.id)
       from public.profiles as profile
      where profile.id in ('82600000-0000-0000-0000-000000000011', '82600000-0000-0000-0000-000000000014')
      order by profile.id $$,
  $$ values ('voluntar', 0::bigint), ('voluntar', 0::bigint) $$,
  'a Promotion Candidate is not promoted: both keep Voluntar and no role_history row is written');
select results_eq(
  $$ select threshold, updated_by from public.promotion_thresholds where kind = 'voluntar_activ' $$,
  $$ values (25, null::uuid) $$,
  'the computed threshold is handed over: 25 is in force for the next Voluntar Activ run');
select results_eq(
  $$ select from_value, to_value, source, changed_by, role_evaluation_id
       from public.promotion_threshold_changes where kind = 'voluntar_activ' $$,
  $$ select 15, 25, 'role_evaluation', null::uuid, role_evaluation_id from runs826 where label = 'va1' $$,
  'the hand-over is audited: one role_evaluation change row naming the run');

-- The Notifications.
select is(
  (select count(*) from public.notifications
    where dedupe_key = 'promotion_candidate:' || (select role_evaluation_id from runs826 where label = 'va1')
                       || ':82600000-0000-0000-0000-000000000011'),
  (select cardinality(leaders) from fx826)::bigint,
  'each live BC and Moderator gets exactly one Notification per candidate per run, the runner included');
select is(
  (select array_agg(member_id order by member_id) from public.notifications
    where dedupe_key like 'promotion_candidate:' || (select role_evaluation_id from runs826 where label = 'va1') || ':%'),
  (select array_agg(leader order by leader) from fx826, unnest(leaders) as leader, (values (1), (2)) as n (k)),
  'the candidate Notifications go to live level >= 6 only -- two per leader, one for each candidate');
select results_eq(
  $$ select kind::text, title, body, link from public.notifications
      where member_id = '82600000-0000-0000-0000-000000000002'
        and dedupe_key = 'promotion_candidate:' || (select role_evaluation_id from runs826 where label = 'va1')
                         || ':82600000-0000-0000-0000-000000000011' $$,
  $$ select 'system', 'Candidat la promovare: Vali',
            'Vali are 20 puncte de task în evaluarea „Semestrul I #826” ('
            || to_char(d_from, 'DD.MM.YYYY') || '–' || to_char(d_to, 'DD.MM.YYYY')
            || '), cel puțin pragul de 15 puncte, și vechimea cerută. Nu este promovat automat: '
            || 'îl poți promova în Voluntar Activ din panoul de roluri sau respinge din Evaluări de rol.',
            '/administrare/evaluari'
       from fx826 $$,
  'the candidate Notification names the Member by Nickname, the points, the run, its dates and the threshold used');
select is(
  (select count(distinct split_part(dedupe_key, ':', 3)) from public.notifications
    where dedupe_key like 'retention_signal:' || (select role_evaluation_id from runs826 where label = 'va1') || ':%'),
  1::bigint,
  'exactly one Retention Signal: the Voluntar Activ below the threshold used (5 < 15); 15 is not below it');
select results_eq(
  $$ select array_agg(member_id order by member_id) from public.notifications
      where dedupe_key = 'retention_signal:' || (select role_evaluation_id from runs826 where label = 'va1')
                         || ':82600000-0000-0000-0000-000000000023' $$,
  $$ select array_agg(recipient order by recipient)
       from (select unnest(leaders) from fx826
             union select '82600000-0000-0000-0000-000000000031'::uuid) as r (recipient) $$,
  'the Retention Signal goes to every live BC and Moderator and the Adunarea Generală''s Group Responsible');
select results_eq(
  $$ select title, body, link from public.notifications
      where member_id = '82600000-0000-0000-0000-000000000001'
        and dedupe_key = 'retention_signal:' || (select role_evaluation_id from runs826 where label = 'va1')
                         || ':82600000-0000-0000-0000-000000000023' $$,
  $$ select 'Semnal de retenție: Ana',
            'Ana (Voluntar Activ) are 5 puncte de task în evaluarea „Semestrul I #826” ('
            || to_char(d_from, 'DD.MM.YYYY') || '–' || to_char(d_to, 'DD.MM.YYYY')
            || '), sub pragul de 15 puncte. Rolul nu se retrage automat: decizia îi aparține BC.',
            '/tracker/membru/82600000-0000-0000-0000-000000000023'
       from fx826 $$,
  'the Retention Signal names the Member, the Role at risk, the points, the run and the threshold used');
select is((select role::text from public.profiles where id = '82600000-0000-0000-0000-000000000023'), 'activ',
  'a Retention Signal changes no Role');

-- ==================== 7. Reject, edit, run again: reappear and supersede ====================

reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.reject_promotion_candidate(
       (select id from public.promotion_candidates
         where member_id = '82600000-0000-0000-0000-000000000011' and decision is null),
       'Nu încă') $$,
  'BC rejects Vali''s candidacy');
select lives_ok($$ select public.set_promotion_threshold('voluntar_activ', 15) $$,
  'BC puts the Voluntar Activ threshold back to 15 by hand, after a run');
reset role;
select results_eq(
  $$ select from_value, to_value, source, changed_by from public.promotion_threshold_changes
      where kind = 'voluntar_activ' order by id desc limit 1 $$,
  $$ values (25, 15, 'manual', '82600000-0000-0000-0000-000000000001'::uuid) $$,
  'the hand edit is audited with its author');

reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000002');
select lives_ok(
  format($$ insert into runs826 select 'va2', * from public.run_role_evaluation('voluntar_activ', %L, %L, 'Corecție #826') $$,
         (select d_from + 10 from fx826), (select d_to from fx826)),
  'the Moderator runs again over overlapping days -- no overlap rule');
reset role;
select results_eq(
  $$ select candidate.member_id, candidate.decision, candidate.decided_by
       from public.promotion_candidates as candidate
      where candidate.role_evaluation_id = (select role_evaluation_id from runs826 where label = 'va1')
      order by candidate.member_id $$,
  $$ values ('82600000-0000-0000-0000-000000000011'::uuid, 'rejected', '82600000-0000-0000-0000-000000000001'::uuid),
            ('82600000-0000-0000-0000-000000000014'::uuid, 'superseded', '82600000-0000-0000-0000-000000000002'::uuid) $$,
  'the next run supersedes the undecided candidate (by the runner); the rejection stays as it was');
select results_eq(
  $$ select member_id, decision from public.promotion_candidates
      where role_evaluation_id = (select role_evaluation_id from runs826 where label = 'va2')
      order by member_id $$,
  $$ values ('82600000-0000-0000-0000-000000000011'::uuid, null::text),
            ('82600000-0000-0000-0000-000000000014'::uuid, null::text) $$,
  'a rejected Voluntar reappears at a later run while still at or above the threshold, beside the re-listed one');
select is(
  (select count(*) from public.notifications
    where dedupe_key = 'promotion_candidate:' || (select role_evaluation_id from runs826 where label = 'va2')
                       || ':82600000-0000-0000-0000-000000000011'),
  (select cardinality(leaders) from fx826)::bigint,
  'the second run notifies each leader once more, under its own key');

-- ==================== 8. Under the handed-over threshold ====================
-- The second run handed 25 over again: nobody reaches it.

reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select lives_ok(
  format($$ insert into runs826 select 'va3', * from public.run_role_evaluation('voluntar_activ', %L, %L, 'A treia #826') $$,
         (select d_from from fx826), (select d_to from fx826)),
  'BC runs under the handed-over threshold');
reset role;
select results_eq(
  $$ select run.threshold_used, r.candidates, r.retention_signals
       from runs826 as r join public.role_evaluations as run on run.id = r.role_evaluation_id
      where r.label = 'va3' $$,
  $$ values (25, 0, 2) $$,
  'the run uses the computed 25: no candidate, and the two Voluntar Activ holders below it are signalled');
select is(
  (select count(*) from public.promotion_candidates where decision is null),
  0::bigint,
  'the earlier undecided candidates were superseded and none was added');

-- ==================== 9. The rule disabled ====================

update public.promotion_rules set enabled = false where kind = 'top_percent';
update public.promotion_thresholds set threshold = 15 where kind = 'voluntar_activ';
reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
insert into runs826 select 'va4', * from public.run_role_evaluation('voluntar_activ', (select d_from from fx826), (select d_to from fx826), 'Regula oprită #826');
reset role;
select results_eq(
  $$ select candidates, retention_signals from runs826 where label = 'va4' $$,
  $$ values (0, 1) $$,
  'with the top_percent rule disabled a run lists no Promotion Candidate; the Retention Signals still go out');
update public.promotion_rules set enabled = true where kind = 'top_percent';

-- ==================== 10. The Adunarea Generală kind ====================

reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select lives_ok($$ select public.set_promotion_threshold('adunarea_generala', 10) $$,
  'BC enters the first Adunarea Generală threshold by hand');
select lives_ok(
  format($$ insert into runs826 select 'ag1', * from public.run_role_evaluation('adunarea_generala', %L, %L, 'AG #826') $$,
         (select d_from from fx826), (select d_to from fx826)),
  'BC runs an Adunarea Generală Role Evaluation');
reset role;
select results_eq(
  $$ select r.candidates, r.retention_signals, run.ranked_count, run.threshold_used, run.threshold_computed
       from runs826 as r join public.role_evaluations as run on run.id = r.role_evaluation_id
      where r.label = 'ag1' $$,
  $$ values (0, 1, 2, 10, 12) $$,
  'the Adunarea Generală kind ranks only the two Voluntar cu Drept de Vot holders, lists no candidate, signals the one below 10 and computes 12 (top 25 % of two)');
select is(
  (select count(*) from public.promotion_candidates
    where role_evaluation_id = (select role_evaluation_id from runs826 where label = 'ag1')),
  0::bigint, 'the Adunarea Generală kind writes no Promotion Candidate row');
select is(
  (select array_agg(split_part(dedupe_key, ':', 3)::uuid) from (
     select distinct dedupe_key from public.notifications
      where dedupe_key like 'retention_signal:' || (select role_evaluation_id from runs826 where label = 'ag1') || ':%') as k),
  array['82600000-0000-0000-0000-000000000032'::uuid],
  'the Adunarea Generală Retention Signal is about the Voluntar cu Drept de Vot below the threshold');
select is((select threshold from public.promotion_thresholds where kind = 'adunarea_generala'), 12,
  'the Adunarea Generală threshold computed by the run is in force for its next run');

-- ==================== 11. A computed value below 1 is not handed over ====================
-- A range nobody earned in: the boundary holder has 0.

reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
insert into runs826 select 'ag0', * from public.run_role_evaluation('adunarea_generala', '2001-01-01', '2001-01-31', 'AG gol #826');
reset role;
select results_eq(
  $$ select run.threshold_computed, (select threshold from public.promotion_thresholds where kind = 'adunarea_generala'),
            (select count(*) from public.promotion_threshold_changes where role_evaluation_id = run.id)
       from public.role_evaluations as run
      where run.id = (select role_evaluation_id from runs826 where label = 'ag0') $$,
  $$ values (0, 12, 0::bigint) $$,
  'a computed 0 is recorded on the run but not handed over: 12 stays in force, no change row');

-- ==================== 12. The transactional proof ====================
-- The owner makes every Notification fail; the run must roll back whole.

create temp table before826 as
  select (select count(*) from public.role_evaluations) as runs,
         (select threshold from public.promotion_thresholds where kind = 'voluntar_activ') as threshold,
         (select count(*) from public.promotion_candidates) as candidates;
grant select on before826 to authenticated;
update public.promotion_thresholds set threshold = 15 where kind = 'voluntar_activ';
update before826 set threshold = 15;

create or replace function private.notify(
  p_recipients uuid[], p_kind public.noti_kind, p_title text, p_body text, p_task_id bigint,
  p_dedupe_key text, p_actor uuid, p_link text default null, p_critical boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = 'notify_failed_826';
end $$;

reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select throws_ok(
  format($$ select * from public.run_role_evaluation('voluntar_activ', %L, %L, 'Eșuată #826') $$,
         (select d_from from fx826), (select d_to from fx826)),
  'P0001', 'notify_failed_826', 'an error while notifying is the run''s error');
reset role;
select results_eq(
  $$ select (select count(*) from public.role_evaluations),
            (select threshold from public.promotion_thresholds where kind = 'voluntar_activ'),
            (select count(*) from public.promotion_candidates) $$,
  $$ select runs, threshold, candidates from before826 $$,
  'the failed run rolled back whole: no run row, no candidate, no hand-over');

select * from finish();
rollback;
