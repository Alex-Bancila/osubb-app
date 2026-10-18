-- role_evaluation_command.test.sql -- #826 (ruling R28), rebuilt by R58
-- (spec docs/superpowers/specs/2026-10-18-portofoliu-interne-design.md,
-- section C): the one Role Evaluation command,
-- public.run_role_evaluation(p_kind, p_from, p_to, p_name, p_floor, p_percent,
-- p_cutoff), over private.run_role_evaluation_impl.
--
-- In order: a held-lock probe of (47, 1), first -- before this transaction
-- takes the lock or writes a row, either of which would block the remote
-- session; the function and its privileges; step 1 (malformed for everyone,
-- before the gate); the gate; a kind's first run with no threshold in force;
-- a Voluntar Activ run (candidates without promotion, the line both ways, one
-- ranking, the hand-over, the values written through, the Notifications once
-- per recipient); a rejection and a hand edit, then a run over overlapping
-- days where the rejected Voluntar reappears and the previous undecided
-- candidate is superseded; a run under a hand-set threshold that measures
-- against its own line; no Promotion Rule gates a run; the Adunarea Generală
-- kind; a run that ranks nobody hands nothing over; the transactional proof.
--
-- Fixtures (fixture prefix 82600000-), written as the owner inside this
-- rolled-back transaction. Every live active ladder holder the demo seed
-- brings is deactivated first, so each run meets only this suite's Members.
-- The Evaluation Period is [today - 30, today - 1] in Bucharest days; every
-- award is dated two days ago, inside it. The Voluntar Activ runs use the
-- Eligibility Floor 5, the share 50 % and the cutoff today - 1; the
-- Adunarea Generală runs 25 % and the Floor 5, except the one in section 10
-- (Floor 1).
--   R1 recrut 100, V3 voluntar joined today 50, A1 activ 25, V1 voluntar 20,
--   V4 voluntar 15, A2 activ 15, G1 vot 12, V2 voluntar 10, A3 activ 5,
--   G2 vot 3 (below the Floor).
--   Voluntar Activ kind: 10 evaluated, 9 ranked, share ceil(50 x 9 / 100) =
--     5, so the line is V4's 15 (R1, V3, A1, V1, then V4 before A2 by
--     member_id) and A2, tied at 15, is inside too. Candidates: V1 and V4
--     (V3 joined after the cutoff; R1 is a Recrut). Signals: A3 and G1 below
--     the line, G2 below the Floor; A2 at exactly 15 is not one. The threshold
--     in force before the first run is 20: V4 is listed below it.
--   Adunarea Generală kind: at Floor 5 G1 is ranked alone (G2 below the
--     Floor), share 1, line 12; at Floor 1 both are ranked, share 1, line 12,
--     and G2 is below the line. G1 is also the Adunarea Generală Group's
--     Responsible.
--
-- Mutation guards, first run 2026-09-27 against main's body and re-run
-- 2026-10-18 against R58's (scratch copies of this file that redefine
-- private.run_role_evaluation_impl after the fixture, inside the rolled-back
-- transaction; the run's own R58 rules -- the line, the Floor and the cutoff
-- -- are guarded by role_evaluation_simulation.test.sql's mutations):
--   * the candidate insert removed -> "the Voluntar Activ run writes one
--     Promotion Candidate per listable Voluntar inside the line";
--   * the candidate loop also writing the Member's Role (in 2026-09 the
--     mutation called #52's apply_promotion, which R58 dropped) -> "a
--     Promotion Candidate is not promoted";
--   * the supersede update removed -> "the next run supersedes the undecided
--     candidate" (the new candidate then trips the one-open index and the
--     run fails);
--   (The held-lock probe runs in a remote session, which sees only committed
--   code, so it was not run as a mutation: without the (47, 1) call the
--   remote run meets no held lock and completes, so the probe discriminates.)
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(69);

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
       'select role_evaluation_id::text from public.run_role_evaluation(''voluntar_activ'', current_date - 30, current_date - 1, ''Probă #826'', 1, 35, current_date - 1)')
       as result (id text) $$,
  '55P03', 'canceling statement due to lock timeout',
  'a run waits on the (47, 1) advisory lock another run or a threshold edit holds, before it reads a threshold');
select extensions.dblink_exec('run_retry', 'rollback;');
select extensions.dblink_exec('run_lock', 'rollback;');

-- A run holds the Profiles of its population `for key share` until it
-- commits (CodeRabbit on #835): a set_member_role on a Voluntar of that
-- population waits instead of promoting underneath the ranking. F2 is a
-- Voluntar with no join date, never a candidate, so no candidate FK lock can
-- stand in for the Profile lock -- without it the promotion goes straight
-- through.
select extensions.dblink_exec('run_lock', format(
  'begin; set local lock_timeout = ''2s''; select set_config(''request.jwt.claims'', %L, true); set local role authenticated;',
  current_setting('request.jwt.claims')));
select extensions.dblink_exec('run_lock',
  'do $run$ begin perform * from public.run_role_evaluation(''voluntar_activ'', current_date - 30, current_date - 1, ''Probă profiluri #826'', 1, 35, current_date - 1); end $run$;');
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

select function_returns('public', 'run_role_evaluation',
  array['text', 'date', 'date', 'text', 'integer', 'integer', 'date'], 'setof record',
  'public.run_role_evaluation(p_kind, p_from, p_to, p_name, p_floor, p_percent, p_cutoff) returns (role_evaluation_id, candidates, retention_signals)');

create temp table fns826 (fn text);
insert into fns826 values
  ('public.run_role_evaluation(text, date, date, text, integer, integer, date)'),
  ('private.run_role_evaluation_impl(text, date, date, text, integer, integer, date)');
select is(
  (select count(*) from fns826, unnest(array['anon', 'service_role', 'public']) as grantee
    where has_function_privilege(grantee, fn, 'execute')),
  0::bigint, 'anon, service_role and PUBLIC execute neither the wrapper nor its _impl');
select is(
  (select count(*) from fns826 where has_function_privilege('authenticated', fn, 'execute')),
  2::bigint, 'authenticated executes the wrapper and its _impl (the invoker wrapper calls the _impl as the caller)');
select hasnt_function('public', 'run_role_evaluation', array['text', 'date', 'date', 'text'],
  'the four-argument run is gone (R58): a run is given its Floor, share and cutoff');
select hasnt_function('public', 'open_evaluation_period', array['text'],
  'open_evaluation_period is gone: nothing opens a Period (R28)');
select hasnt_function('public', 'close_evaluation_period', array['bigint'],
  'close_evaluation_period is gone: nothing closes a Period (R28)');

-- ==================== Fixtures ====================

update public.profiles set status = 'inactiv'
 where status = 'activ'
   and role in ('recrut', 'voluntar', 'activ', 'vot')
   and id::text not like '82600000-%';

update public.org_settings set value = null where key = 'adherence_form_url';
update public.promotion_thresholds set threshold = 20 where kind = 'voluntar_activ';
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
-- #843 (D11): two Adunarea Generală Responsibles -- a Voluntar cu Drept de
-- Vot (level 3) and BCE (level 5). Only one at level 5 or above hears a
-- Retention Signal, so only BCE does.
insert into public.group_members (group_id, member_id, group_role)
select id, responsible.member_id, 'responsible'
  from public.groups
 cross join (values ('82600000-0000-0000-0000-000000000031'::uuid),
                    ('82600000-0000-0000-0000-000000000003'::uuid)) as responsible (member_id)
 where name = 'Adunarea Generală 826';
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

-- One Voluntar Activ run of this suite, recorded under p_label: Floor 5,
-- 50 %, cutoff yesterday.
create function pg_temp.va826(p_label text, p_name text, p_from date default null) returns text language sql as $$
  select format($q$ insert into runs826 select %L, * from public.run_role_evaluation('voluntar_activ', %L, %L, %L, 5, 50, %L) $q$,
                p_label, coalesce(p_from, (select d_from from fx826)), (select d_to from fx826), p_name,
                (select d_to from fx826))
$$;
grant execute on function pg_temp.va826(text, text, date) to authenticated;

-- ==================== 3. Step 1, before the gate ====================
-- A claimless session: every malformed input is PT400, never 42501.

select pg_temp.test_login('82600000-0000-0000-0000-000000000001', '{"provider":"email"}'::jsonb);
select throws_ok($$ select * from public.run_role_evaluation(null, current_date - 2, current_date - 1, 'Evaluare', 5, 50, current_date - 1) $$,
  'PT400', 'invalid_role_evaluation_kind', 'a null kind is invalid_role_evaluation_kind, before the gate');
select throws_ok($$ select * from public.run_role_evaluation('drept_de_vot', current_date - 2, current_date - 1, 'Evaluare', 5, 50, current_date - 1) $$,
  'PT400', 'invalid_role_evaluation_kind', 'an unknown kind is invalid_role_evaluation_kind, before the gate');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, E' \t ', 5, 50, current_date - 1) $$,
  'PT400', 'invalid_role_evaluation_name', 'a blank name is invalid_role_evaluation_name, before the gate');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, E' ab\t', 5, 50, current_date - 1) $$,
  'PT400', 'name_too_short', 'the name is measured trimmed: two characters are name_too_short');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, repeat('e', 121), 5, 50, current_date - 1) $$,
  'PT400', 'name_too_long', 'a 121-character name is name_too_long');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', null, current_date - 1, 'Evaluare', 5, 50, current_date - 1) $$,
  'PT400', 'invalid_date_range', 'a missing start is invalid_date_range');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 1, current_date - 2, 'Evaluare', 5, 50, current_date - 1) $$,
  'PT400', 'invalid_date_range', 'an end before the start is invalid_date_range');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date + 2, 'Evaluare', 5, 50, current_date - 1) $$,
  'PT400', 'date_range_in_future', 'an Evaluation Period ending after today is date_range_in_future');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, 'Evaluare', 0, 50, current_date - 1) $$,
  'PT400', 'invalid_eligibility_floor', 'a Floor below 1 is invalid_eligibility_floor, before the gate');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, 'Evaluare', 5, 101, current_date - 1) $$,
  'PT400', 'invalid_percent', 'a share above 100 is invalid_percent, before the gate');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, 'Evaluare', 5, 50) $$,
  'PT400', 'membership_cutoff_not_set', 'a Voluntar Activ run without a cutoff is membership_cutoff_not_set, before the gate');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, 'Evaluare', 5, 50, current_date + 2) $$,
  'PT400', 'invalid_membership_cutoff',
  'a cutoff after today is invalid_membership_cutoff, before the gate -- a run never writes through a date set_membership_cutoff would refuse');

-- ==================== 4. The gate ====================

select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, 'Evaluare claimless', 5, 50, current_date - 1) $$,
  '42501', 'role_evaluation_manage_forbidden', 'a claimless session cannot run a Role Evaluation, though its uid is a live BC');
reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000011');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, 'Evaluare Voluntar', 5, 50, current_date - 1) $$,
  '42501', 'role_evaluation_manage_forbidden', 'a Voluntar cannot run a Role Evaluation');
reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000003');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, 'Evaluare BCE', 5, 50, current_date - 1) $$,
  '42501', 'role_evaluation_manage_forbidden', 'a BCE cannot run a Role Evaluation');
reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000005');
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, 'Evaluare inactiv', 5, 50, current_date - 1) $$,
  '42501', 'role_evaluation_manage_forbidden', 'a deactivated BC''s still-valid token cannot run a Role Evaluation');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select * from public.run_role_evaluation('voluntar_activ', current_date - 2, current_date - 1, 'Evaluare anon', 5, 50, current_date - 1) $$,
  '42501', null, 'anon cannot execute run_role_evaluation');
reset role;
select is((select count(*) from public.role_evaluations where name like 'Evaluare%'), 0::bigint,
  'every refusal wrote no Role Evaluation');

-- ==================== 5. A kind's first run needs no threshold in force ====================
-- R58 (decision 17): a run measures against the line it computes, so the
-- Adunarea Generală kind's first run succeeds with no threshold entered.

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select lives_ok(
  format($$ insert into runs826 select 'ag_first', * from public.run_role_evaluation('adunarea_generala', %L, %L, 'AG fără prag', 5, 25) $$,
         (select d_from from fx826), (select d_to from fx826)),
  'an Adunarea Generală run succeeds while its threshold was never entered');
reset role;
select results_eq(
  $$ select run.threshold_used, run.threshold_computed,
            (select threshold from public.promotion_thresholds where kind = 'adunarea_generala')
       from public.role_evaluations as run
      where run.id = (select role_evaluation_id from runs826 where label = 'ag_first') $$,
  $$ values (null::int, 12, 12) $$,
  'it records no threshold used, computes 12 (G1, the one voter at the Floor) and hands it over as the first Adunarea Generală threshold');

-- ==================== 6. BC runs a Voluntar Activ Role Evaluation ====================

select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select lives_ok(
  format($$ insert into runs826 select 'va1', * from public.run_role_evaluation('voluntar_activ', %L, %L, E'  Semestrul I #826\t', 5, 50, %L) $$,
         (select d_from from fx826), (select d_to from fx826), (select d_to from fx826)),
  'BC runs a Voluntar Activ Role Evaluation');
reset role;

select results_eq(
  $$ select candidates, retention_signals from runs826 where label = 'va1' $$,
  $$ values (2, 3) $$,
  'the run returns its counts: two Promotion Candidates, three Retention Signals');
select results_eq(
  $$ select run.kind, run.name, run.period_from = fx.d_from, run.period_to = fx.d_to,
            run.run_by, run.run_at = now(), run.threshold_used, run.ranked_count,
            run.evaluated_count, run.eligibility_floor, run.percent_used, run.membership_cutoff = fx.d_to
       from public.role_evaluations as run, fx826 as fx
      where run.id = (select role_evaluation_id from runs826 where label = 'va1') $$,
  $$ values ('voluntar_activ', 'Semestrul I #826', true, true,
             '82600000-0000-0000-0000-000000000001'::uuid, true, 20, 9, 10, 5, 50, true) $$,
  'the run row: kind, trimmed name, the Evaluation Period, run_by, run_at, the threshold in force before (20), 9 ranked of 10 evaluated, and the Floor, share and cutoff it used');
select is(
  (select threshold_computed from public.role_evaluations
    where id = (select role_evaluation_id from runs826 where label = 'va1')),
  15,
  'the run computed 15 -- the fifth of the nine ranked in one ranking, Recruți and voters included');
select results_eq(
  $$ select member_id, task_points, tenure_since, threshold_used, decision
       from public.promotion_candidates
      where role_evaluation_id = (select role_evaluation_id from runs826 where label = 'va1')
      order by member_id $$,
  $$ values ('82600000-0000-0000-0000-000000000011'::uuid, 20, '2000-01-01'::date, 15, null::text),
            ('82600000-0000-0000-0000-000000000014'::uuid, 15, '2000-01-01'::date, 15, null::text) $$,
  'the Voluntar Activ run writes one Promotion Candidate per listable Voluntar inside the line -- 20 and exactly 15, measured against 15, not the 20 in force; not 10, not the 50 who joined after the cutoff, not the Recrut''s 100');
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
  $$ values (15, null::uuid) $$,
  'the computed line is handed over: 15 is in force until the next Voluntar Activ run');
select results_eq(
  $$ select from_value, to_value, source, changed_by, role_evaluation_id
       from public.promotion_threshold_changes where kind = 'voluntar_activ' and field = 'threshold' $$,
  $$ select 20, 15, 'role_evaluation', null::uuid, role_evaluation_id from runs826 where label = 'va1' $$,
  'the hand-over is audited: one role_evaluation change row naming the run');
select results_eq(
  $$ select field, from_value, to_value, from_date, to_date = (select d_to from fx826)
       from public.promotion_threshold_changes
      where role_evaluation_id = (select role_evaluation_id from runs826 where label = 'va1')
        and field <> 'threshold'
      order by field $$,
  $$ values ('cutoff'::text, null::int, null::int, null::date, true),
            ('percent', 35, 50, null, null) $$,
  'the share (35 -> 50) and the cutoff (unset -> yesterday) the run used are written through, each logged naming the run; the Floor 5 was already in force');

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
            || '), cel puțin pragul de promovare de 15 puncte, intrat în OSUBB până la ' || to_char(d_to, 'DD.MM.YYYY')
            || '. Nu este promovat automat: '
            || 'îl poți promova în Voluntar Activ din panoul de roluri sau respinge din Portofoliu Interne.',
            '/administrare/portofoliu-interne'
       from fx826 $$,
  'the candidate Notification names the Member by Nickname, the points, the run, its dates, the line computed and the cutoff');
select is(
  (select array_agg(distinct split_part(dedupe_key, ':', 3)::uuid order by split_part(dedupe_key, ':', 3)::uuid)
     from public.notifications
    where dedupe_key like 'retention_signal:' || (select role_evaluation_id from runs826 where label = 'va1') || ':%'),
  array['82600000-0000-0000-0000-000000000023'::uuid, '82600000-0000-0000-0000-000000000031'::uuid,
        '82600000-0000-0000-0000-000000000032'::uuid],
  'three Retention Signals: A3 (5) and G1 (12) below the line of 15, G2 (3) below the Floor; A2 at exactly 15 is not one');
select results_eq(
  $$ select array_agg(member_id order by member_id) from public.notifications
      where dedupe_key = 'retention_signal:' || (select role_evaluation_id from runs826 where label = 'va1')
                         || ':82600000-0000-0000-0000-000000000023' $$,
  $$ select array_agg(recipient order by recipient)
       from (select unnest(leaders) from fx826
             union select '82600000-0000-0000-0000-000000000003'::uuid) as r (recipient) $$,
  'the Retention Signal goes to every live BC and Moderator and the Adunarea Generală''s Group Responsible at level 5 (BCE)');
select is(
  (select count(*) from public.notifications
    where member_id = '82600000-0000-0000-0000-000000000031'
      and dedupe_key like 'retention_signal:%'),
  0::bigint,
  '#843 (D11): an Adunarea Generală Responsible below level 5 gets no Retention Signal -- /tracker/membru/<id> would turn them away');
select results_eq(
  $$ select title, body, link from public.notifications
      where member_id = '82600000-0000-0000-0000-000000000001'
        and dedupe_key = 'retention_signal:' || (select role_evaluation_id from runs826 where label = 'va1')
                         || ':82600000-0000-0000-0000-000000000023' $$,
  $$ select 'Semnal de retenție: Ana',
            'Ana (Voluntar Activ) are 5 puncte de task în evaluarea „Semestrul I #826” ('
            || to_char(d_from, 'DD.MM.YYYY') || '–' || to_char(d_to, 'DD.MM.YYYY')
            || '), sub pragul de promovare de 15 puncte. Rolul nu se retrage automat: decizia îi aparține BC.',
            '/tracker/membru/82600000-0000-0000-0000-000000000023'
       from fx826 $$,
  'the Retention Signal names the Member, the Role at risk, the points, the run and the line computed, and links to the Member''s tracker page');
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
select lives_ok($$ select public.set_promotion_threshold('voluntar_activ', 18) $$,
  'BC edits the Voluntar Activ threshold by hand, after a run');
reset role;
select results_eq(
  $$ select from_value, to_value, source, changed_by from public.promotion_threshold_changes
      where kind = 'voluntar_activ' and field = 'threshold' order by id desc limit 1 $$,
  $$ values (15, 18, 'manual', '82600000-0000-0000-0000-000000000001'::uuid) $$,
  'the hand edit is audited with its author');

reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000002');
select lives_ok(pg_temp.va826('va2', 'Corecție #826', (select d_from + 10 from fx826)),
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
  $$ select member_id, decision, threshold_used from public.promotion_candidates
      where role_evaluation_id = (select role_evaluation_id from runs826 where label = 'va2')
      order by member_id $$,
  $$ values ('82600000-0000-0000-0000-000000000011'::uuid, null::text, 15),
            ('82600000-0000-0000-0000-000000000014'::uuid, null::text, 15) $$,
  'a rejected Voluntar reappears at a later run while still inside the line, beside the re-listed one -- measured against the run''s own 15, not the hand-set 18');
select is(
  (select count(*) from public.notifications
    where dedupe_key = 'promotion_candidate:' || (select role_evaluation_id from runs826 where label = 'va2')
                       || ':82600000-0000-0000-0000-000000000011'),
  (select cardinality(leaders) from fx826)::bigint,
  'the second run notifies each leader once more, under its own key');
select results_eq(
  $$ select count(*) filter (where role_evaluation_id = (select role_evaluation_id from runs826 where label = 'va1')),
            count(*) filter (where role_evaluation_id = (select role_evaluation_id from runs826 where label = 'va2'))
       from public.retention_signals
      where kind = 'voluntar_activ' and closed_at is null $$,
  $$ values (0::bigint, 3::bigint) $$,
  'the second run supersedes the first run''s open Retention Signals and stores its own');

-- ==================== 8. A hand-set threshold does not move the line ====================
-- R58 (decision 17): the next run does not care about the line in force.

update public.promotion_thresholds set threshold = 100 where kind = 'voluntar_activ';
reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select lives_ok(pg_temp.va826('va3', 'A treia #826'), 'BC runs under a threshold of 100 in force');
reset role;
select results_eq(
  $$ select run.threshold_used, run.threshold_computed, r.candidates, r.retention_signals,
            (select threshold from public.promotion_thresholds where kind = 'voluntar_activ')
       from runs826 as r join public.role_evaluations as run on run.id = r.role_evaluation_id
      where r.label = 'va3' $$,
  $$ values (100, 15, 2, 3, 15) $$,
  'the run records the 100 in force but measures against the 15 it computes: the same two candidates and three Signals, and 15 is handed back');
select is(
  (select count(*) from public.promotion_candidates where decision is null),
  2::bigint,
  'the earlier undecided candidates were superseded; the run''s two are the only open ones');

-- ==================== 9. No Promotion Rule gates a run ====================
-- R58 dropped the Promotion Rules: a run lists its Candidates by its own
-- values (the line it computes, the cutoff), with no rule to switch off.

reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select lives_ok(pg_temp.va826('va4', 'Fără regulă #826'), 'BC runs again with the same values');
reset role;
select results_eq(
  $$ select candidates, retention_signals from runs826 where label = 'va4' $$,
  $$ values (2, 3) $$,
  'the run lists the same Promotion Candidates and Signals: its values alone decide, no Promotion Rule exists to gate it');

-- ==================== 10. The Adunarea Generală kind ====================

reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select lives_ok($$ select public.set_promotion_threshold('adunarea_generala', 10) $$,
  'BC edits the Adunarea Generală threshold by hand');
select lives_ok(
  format($$ insert into runs826 select 'ag1', * from public.run_role_evaluation('adunarea_generala', %L, %L, 'AG #826', 1, 25) $$,
         (select d_from from fx826), (select d_to from fx826)),
  'BC runs an Adunarea Generală Role Evaluation');
reset role;
select results_eq(
  $$ select r.candidates, r.retention_signals, run.ranked_count, run.evaluated_count, run.threshold_used,
            run.threshold_computed, run.membership_cutoff
       from runs826 as r join public.role_evaluations as run on run.id = r.role_evaluation_id
      where r.label = 'ag1' $$,
  $$ values (0, 1, 2, 2, 10, 12, null::date) $$,
  'the Adunarea Generală kind (Floor 1) ranks only the two Voluntar cu Drept de Vot holders, lists no candidate, signals the one below the line and computes 12 (top 25 % of two); it has no cutoff');
select is(
  (select count(*) from public.promotion_candidates
    where role_evaluation_id = (select role_evaluation_id from runs826 where label = 'ag1')),
  0::bigint, 'the Adunarea Generală kind writes no Promotion Candidate row');
select is(
  (select array_agg(split_part(dedupe_key, ':', 3)::uuid) from (
     select distinct dedupe_key from public.notifications
      where dedupe_key like 'retention_signal:' || (select role_evaluation_id from runs826 where label = 'ag1') || ':%') as k),
  array['82600000-0000-0000-0000-000000000032'::uuid],
  'the Adunarea Generală Retention Signal is about the Voluntar cu Drept de Vot below the line');
select results_eq(
  $$ select title, body, link from public.notifications
      where member_id = '82600000-0000-0000-0000-000000000001'
        and dedupe_key = 'retention_signal:' || (select role_evaluation_id from runs826 where label = 'ag1')
                         || ':82600000-0000-0000-0000-000000000032' $$,
  $$ select 'Semnal de retenție: Vot Doi',
            'Vot Doi (Voluntar cu Drept de Vot) are 3 puncte de task în evaluarea „AG #826” ('
            || to_char(d_from, 'DD.MM.YYYY') || '–' || to_char(d_to, 'DD.MM.YYYY')
            || '), sub pragul Adunării Generale de 12 puncte. Rolul nu se retrage automat: decizia îi aparține BC.',
            '/tracker/membru/82600000-0000-0000-0000-000000000032'
       from fx826 $$,
  'an Adunarea Generală Signal below the line names the Adunarea Generală''s line, not the Promotion Threshold');
select is((select threshold from public.promotion_thresholds where kind = 'adunarea_generala'), 12,
  'the Adunarea Generală line computed by the run is in force until its next run');

-- ==================== 11. A run that ranks nobody hands nothing over ====================
-- A range nobody earned in: nobody reaches the Floor, so there is no line.

reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select lives_ok(
  $$ insert into runs826 select 'ag0', * from public.run_role_evaluation('adunarea_generala', '2001-01-01', '2001-01-31', 'AG gol #826', 5, 25) $$,
  'BC runs an Adunarea Generală Role Evaluation over days nobody earned in');
reset role;
select results_eq(
  $$ select run.threshold_computed, run.ranked_count,
            (select threshold from public.promotion_thresholds where kind = 'adunarea_generala'),
            (select count(*) from public.promotion_threshold_changes
              where role_evaluation_id = run.id and field = 'threshold')
       from public.role_evaluations as run
      where run.id = (select role_evaluation_id from runs826 where label = 'ag0') $$,
  $$ values (null::int, 0, 12, 0::bigint) $$,
  'a run that ranks nobody records no line and hands nothing over: 12 stays in force, no threshold change row');

-- ==================== 12. The transactional proof ====================
-- The owner makes every Notification fail; the run must roll back whole.

create temp table before826 as
  select (select count(*) from public.role_evaluations) as runs,
         (select threshold from public.promotion_thresholds where kind = 'voluntar_activ') as threshold,
         (select count(*) from public.promotion_candidates) as candidates,
         (select count(*) from public.retention_signals) as signals;
grant select on before826 to authenticated;
update public.promotion_thresholds set threshold = 20 where kind = 'voluntar_activ';
update before826 set threshold = 20;

create or replace function private.notify(
  p_recipients uuid[], p_kind public.noti_kind, p_title text, p_body text, p_task_id bigint,
  p_dedupe_key text, p_actor uuid, p_link text default null, p_critical boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = 'notify_failed_826';
end $$;

reset role;
select pg_temp.test_login_leadership('82600000-0000-0000-0000-000000000001');
select throws_ok(pg_temp.va826('failed', 'Eșuată #826'),
  'P0001', 'notify_failed_826', 'an error while notifying is the run''s error');
reset role;
select results_eq(
  $$ select (select count(*) from public.role_evaluations),
            (select threshold from public.promotion_thresholds where kind = 'voluntar_activ'),
            (select count(*) from public.promotion_candidates),
            (select count(*) from public.retention_signals) $$,
  $$ select runs, threshold, candidates, signals from before826 $$,
  'the failed run rolled back whole: no run row, no candidate, no Signal, no hand-over');

select * from finish();
rollback;
