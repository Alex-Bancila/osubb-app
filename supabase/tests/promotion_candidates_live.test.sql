-- promotion_candidates_live.test.sql -- #983 (ruling R34): the Promotion
-- Candidate list between Role Evaluations.
--
-- A tenured Voluntar whose net Task Points since the latest Voluntar Activ
-- run's window opened (all time before any run) reach the threshold in force
-- is listed the moment they qualify -- a promotion_candidates row with
-- role_evaluation_id null and one Notification per live BC/Moderator -- by
-- private.refresh_promotion_candidates(), which the statement triggers on
-- points_ledger, promotion_thresholds, promotion_rules and profiles call,
-- run_role_evaluation calls last, and the daily tenure job calls. A live row
-- of a Voluntar who no longer qualifies is superseded by nobody; a Member who
-- leaves Voluntar stays the role_history trigger's (promoted / superseded by
-- the actor). A live rejection holds until the next Voluntar Activ run; a run
-- row's rejection holds for its run only. Nothing is promoted.
--
-- In order: the held-lock probe (first: the refresh's try-lock, once it
-- succeeds, holds (47, 1) for the rest of this one transaction, so a remote
-- holder can only be set up before any refresh ran here); shape and grants;
-- the crossing and who is never listed; the line moving (threshold, a
-- reversal, the rule's switch); a live rejection; a run; the daily job;
-- status and tenure; a promotion.
--
-- Fixtures (prefix 98300000-), written as the owner in this rolled-back
-- transaction. Every other live ladder holder is deactivated so the eligible
-- set is this suite's; the leaders set is read from the database (the demo
-- seed's BC and Moderator are live too). Awards are dated now() unless a run
-- must range over them.
--
-- Mutation guards, run 2026-10-02 as in-transaction redefinitions of
-- private.refresh_promotion_candidates, each turning the named assertion red:
--   * `>=` -> `>` on the threshold line -> "reaching the threshold lists the
--     Voluntar at once";
--   * the supersede update removed -> "raising the threshold above the
--     Voluntar unlists them";
--   * the rejected-row exclusion removed -> "a live rejection keeps the
--     Member off the list while the window lasts";
--   * the shared try-lock replaced by pg_advisory_xact_lock -> the probe's
--     lock_timeout error (pinned at 2 s) instead of "an award while another
--     session holds";
--   * the shared try-lock made exclusive -> "an award while another writer's
--     refresh holds (47, 1) shared is listed at once";
--   * `on conflict ... do nothing` removed -> no assertion here (the race it
--     guards needs two sessions on uncommitted fixtures); the index it
--     targets is pinned by promotion_candidates.test.sql;
--   * the run's trailing refresh removed (run_role_evaluation_impl) -> "after
--     the run, a Voluntar already at the threshold in the new window is
--     listed at once";
--   * the daily job's refresh removed (apply_promotions) -> "the daily job
--     lists a Voluntar the triggers missed".
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(52);

-- ==================== Fixtures ====================

insert into auth.users (id, email)
select ('98300000-0000-0000-0000-0000000000' || suffix)::uuid, 'm' || suffix || '-983@test.local'
  from unnest(array['01', '02', '03', '05', '11', '12', '13', '14', '15', '16', '17', '18', '19']) as suffix;

insert into public.profiles (id, full_name, nickname, email, role, status, joined_at) values
  ('98300000-0000-0000-0000-000000000001', 'BC 983',               null,       'm01-983@test.local', 'bc',        'activ',   '2000-01-01'),
  ('98300000-0000-0000-0000-000000000002', 'Moderator 983',        null,       'm02-983@test.local', 'moderator', 'activ',   '2000-01-01'),
  ('98300000-0000-0000-0000-000000000003', 'BCE 983',              null,       'm03-983@test.local', 'bce',       'activ',   '2000-01-01'),
  ('98300000-0000-0000-0000-000000000005', 'BC inactiv 983',       null,       'm05-983@test.local', 'bc',        'inactiv', '2000-01-01'),
  ('98300000-0000-0000-0000-000000000011', 'Vasile Unu 983',       'Vali 983', 'm11-983@test.local', 'voluntar',  'activ',   '2000-01-01'),
  ('98300000-0000-0000-0000-000000000012', 'Voluntar Doi 983',     null,       'm12-983@test.local', 'voluntar',  'activ',   '2000-01-01'),
  ('98300000-0000-0000-0000-000000000013', 'Voluntar Trei 983',    null,       'm13-983@test.local', 'voluntar',  'activ',   '2000-01-01'),
  ('98300000-0000-0000-0000-000000000014', 'Voluntar Patru 983',   null,       'm14-983@test.local', 'voluntar',  'activ',   '2000-01-01'),
  ('98300000-0000-0000-0000-000000000015', 'Voluntar Nou 983',     null,       'm15-983@test.local', 'voluntar',  'activ',   (now() at time zone 'Europe/Bucharest')::date),
  ('98300000-0000-0000-0000-000000000016', 'Activ 983',            null,       'm16-983@test.local', 'activ',     'activ',   '2000-01-01'),
  ('98300000-0000-0000-0000-000000000017', 'Voluntar Inactiv 983', null,       'm17-983@test.local', 'voluntar',  'inactiv', '2000-01-01'),
  ('98300000-0000-0000-0000-000000000018', 'Voluntar Șapte 983',   null,       'm18-983@test.local', 'voluntar',  'activ',   '2000-01-01'),
  ('98300000-0000-0000-0000-000000000019', 'Voluntar Opt 983',     null,       'm19-983@test.local', 'voluntar',  'activ',   '2000-01-01');

insert into public.groups (name, category, min_level) values ('Grup Candidați 983', 'department', 0);

-- Credits p Task Points at p_at: one Task per 15 points (difficulty 5,
-- rating 5), then 5s (difficulty 5, rating 3 -> x1), then the rest. Returns
-- the last Task written, for a reversal.
create function pg_temp.credit983(p_member uuid, p_points int, p_at timestamptz default now())
returns bigint language plpgsql as $$
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
    values ('Credit #983 ' || gen_random_uuid(), 'Fixture', p_at,
            (select id from public.groups where name = 'Grup Candidați 983'),
            'completed', v_d, v_r, '98300000-0000-0000-0000-000000000001',
            p_at - interval '1 day', p_at)
    returning id into v_task;
    insert into public.task_assignments (task_id, member_id, assigned_at, ended_at, end_reason)
    values (v_task, p_member, p_at - interval '1 day', p_at, 'completed');
    perform pg_temp.test_credit_task(v_task, p_member, '98300000-0000-0000-0000-000000000001',
                                     p_awarded_at => p_at);
  end loop;
  return v_task;
end $$;

create temp table tasks983 (label text primary key, task_id bigint);

-- The open row of one Member, if any; the live one has no run.
create function pg_temp.open983(p_member uuid)
returns table (role_evaluation_id bigint, task_points int, tenure_since date, threshold_used int)
language sql as $$
  select candidate.role_evaluation_id, candidate.task_points, candidate.tenure_since, candidate.threshold_used
    from public.promotion_candidates as candidate
   where candidate.member_id = p_member and candidate.decision is null
$$;

-- ==================== 1. The held lock, before any refresh ran here ====================
-- A remote session holds (47, 1), as a run or a threshold edit would. The
-- fixture writes below run under it: the refresh must step aside, never
-- wait -- the writer may already hold a Profile the run is waiting for.

select extensions.dblink_connect('lock983', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('lock983',
  'begin; do $lock$ begin perform pg_catalog.pg_advisory_xact_lock(47, 1); end $lock$;');

update public.profiles set status = 'inactiv'
 where status = 'activ'
   and role in ('recrut', 'voluntar', 'activ', 'vot')
   and id::text not like '98300000-%';
update public.promotion_rules set min_tenure_months = 6, enabled = true;
update public.promotion_thresholds set threshold = 15 where kind = 'voluntar_activ';

-- Pinned so a refresh that waits fails here instead of hanging the suite.
set local lock_timeout = '2s';
select lives_ok(
  $$ select pg_temp.credit983('98300000-0000-0000-0000-000000000018', 15) $$,
  'an award while another session holds (47, 1) succeeds: the refresh does not wait for the lock');
reset lock_timeout;
select is(
  (select count(*) from public.promotion_candidates where member_id = '98300000-0000-0000-0000-000000000018'),
  0::bigint,
  'and lists nobody meanwhile: the holder (a run) re-lists everyone itself');

select extensions.dblink_exec('lock983', 'rollback;');

-- Another writer's refresh holds (47, 1) shared, as every concurrent award
-- does until it commits: this session's refresh must not step aside for it.
select extensions.dblink_exec('lock983',
  'begin; do $lock$ begin perform pg_catalog.pg_advisory_xact_lock_shared(47, 1); end $lock$;');
set local lock_timeout = '2s';
select pg_temp.credit983('98300000-0000-0000-0000-000000000018', 1);
reset lock_timeout;
select results_eq(
  $$ select * from pg_temp.open983('98300000-0000-0000-0000-000000000018') $$,
  $$ values (null::bigint, 16, '2000-07-01'::date, 15) $$,
  'an award while another writer''s refresh holds (47, 1) shared is listed at once: the list catches up by itself');
select extensions.dblink_exec('lock983', 'rollback;');
select extensions.dblink_disconnect('lock983');

create temp table fx983 as
  select (now() at time zone 'Europe/Bucharest')::date as today,
         (select array_agg(profile.id order by profile.id)
            from public.profiles as profile
            join public.roles as role on role.id = profile.role
           where profile.status = 'activ' and role.level >= 6) as leaders,
         (select id from public.promotion_rules where kind = 'top_percent') as rule_id;
grant select on fx983 to authenticated;
select is(
  (select count(*) from public.role_evaluations
    where kind = 'voluntar_activ' and period_to >= (select today from fx983)),
  0::bigint,
  'precondition: no Voluntar Activ run ranges up to today, so awards dated now() fall in the open window');

-- ==================== 2. Shape and grants ====================

select col_is_null('public', 'promotion_candidates', 'role_evaluation_id',
  'role_evaluation_id is nullable: null is a row listed between runs');
select col_not_null('public', 'promotion_candidates', 'threshold_used',
  'threshold_used is not null: every row says what it was measured against');
select has_function('private', 'refresh_promotion_candidates', '{}'::name[],
  'private.refresh_promotion_candidates() exists');
select has_function('private', 'refresh_promotion_candidates_on_write', '{}'::name[],
  'private.refresh_promotion_candidates_on_write() exists');
select is(
  (select count(*)
     from unnest(array['private.refresh_promotion_candidates()',
                       'private.refresh_promotion_candidates_on_write()']) as fn,
          unnest(array['anon', 'authenticated', 'service_role', 'public']) as grantee
    where has_function_privilege(grantee, fn, 'execute')),
  0::bigint,
  'neither the refresh nor its trigger body is executable by anon, authenticated, service_role or PUBLIC');
select has_trigger('public', 'points_ledger', 'points_ledger_refresh_promotion_candidates',
  'an award or a reversal refreshes the list');
select has_trigger('public', 'promotion_thresholds', 'promotion_thresholds_refresh_promotion_candidates',
  'a threshold change refreshes the list');
select has_trigger('public', 'promotion_rules', 'promotion_rules_refresh_promotion_candidates',
  'a rule change refreshes the list');
select has_trigger('public', 'profiles', 'profiles_refresh_promotion_candidates',
  'a Profile change (role, status, join date) refreshes the list');

-- ==================== 3. The crossing ====================

select pg_temp.credit983('98300000-0000-0000-0000-000000000011', 10);
select is(
  (select count(*) from public.promotion_candidates where member_id = '98300000-0000-0000-0000-000000000011'),
  0::bigint,
  '10 of 15: below the threshold, not listed');

insert into tasks983 select 'v1_five', pg_temp.credit983('98300000-0000-0000-0000-000000000011', 5);
select results_eq(
  $$ select * from pg_temp.open983('98300000-0000-0000-0000-000000000011') $$,
  $$ values (null::bigint, 15, '2000-07-01'::date, 15) $$,
  'reaching the threshold lists the Voluntar at once: a live row (no run) with their points, their tenure date and the line in force');
select results_eq(
  $$ select array_agg(member_id order by member_id) from public.notifications
      where dedupe_key = 'promotion_candidate:live:98300000-0000-0000-0000-000000000011' $$,
  $$ select leaders from fx983 $$,
  'one Notification to every live BC and Moderator -- not BCE, not the deactivated BC');
select results_eq(
  $$ select kind::text, title, link,
            body like '%Vali 983 are 15 puncte de task în total, cel puțin pragul în vigoare de 15 puncte, și vechimea cerută.%',
            body like '%Nu este promovat automat: îl poți promova în Voluntar Activ din panoul de roluri sau respinge din Evaluări de rol.%'
       from public.notifications
      where dedupe_key = 'promotion_candidate:live:98300000-0000-0000-0000-000000000011'
        and member_id = '98300000-0000-0000-0000-000000000001' $$,
  $$ values ('system', 'Candidat la promovare: Vali 983', '/administrare/evaluari', true, true) $$,
  'the Notification: the Nickname, the points as a total (no run yet), the line in force, no automatic promotion, the Evaluări de rol link');

select pg_temp.credit983('98300000-0000-0000-0000-000000000015', 20);
select pg_temp.credit983('98300000-0000-0000-0000-000000000016', 20);
select pg_temp.credit983('98300000-0000-0000-0000-000000000017', 20);
select is(
  (select count(*) from public.promotion_candidates
    where member_id in ('98300000-0000-0000-0000-000000000015',
                        '98300000-0000-0000-0000-000000000016',
                        '98300000-0000-0000-0000-000000000017')),
  0::bigint,
  'never listed, whatever the points: an untenured Voluntar, a Voluntar Activ holder, a deactivated Voluntar');

-- ==================== 4. The line moves ====================

select pg_temp.test_login_leadership('98300000-0000-0000-0000-000000000001');
select lives_ok($$ select public.set_promotion_threshold('voluntar_activ', 16) $$, 'BC raises the threshold to 16');
reset role;
select results_eq(
  $$ select decision, decided_at is not null, decided_by
       from public.promotion_candidates
      where member_id = '98300000-0000-0000-0000-000000000011'
      order by id $$,
  $$ values ('superseded', true, null::uuid) $$,
  'raising the threshold above the Voluntar unlists them: superseded, by nobody');

select pg_temp.test_login_leadership('98300000-0000-0000-0000-000000000001');
select lives_ok($$ select public.set_promotion_threshold('voluntar_activ', 15) $$, 'BC lowers it back to 15');
reset role;
select results_eq(
  $$ select * from pg_temp.open983('98300000-0000-0000-0000-000000000011') $$,
  $$ values (null::bigint, 15, '2000-07-01'::date, 15) $$,
  'lowering it back lists them again, in a new row');
select is(
  (select count(*) from public.promotion_candidates where member_id = '98300000-0000-0000-0000-000000000011'),
  2::bigint,
  'two rows now: the superseded one stays as history');
select is(
  (select count(*) from public.notifications
    where dedupe_key = 'promotion_candidate:live:98300000-0000-0000-0000-000000000011'
      and member_id = '98300000-0000-0000-0000-000000000001'),
  1::bigint,
  'the second listing rewrote the unread Notification rather than piling a second one on BC');

select pg_temp.test_reverse_award((select task_id from tasks983 where label = 'v1_five'),
                                  '98300000-0000-0000-0000-000000000011', now());
select is(
  (select decision from public.promotion_candidates
    where member_id = '98300000-0000-0000-0000-000000000011' order by id desc limit 1),
  'superseded',
  'a reversal that drops the Voluntar below the line unlists them');
select pg_temp.credit983('98300000-0000-0000-0000-000000000011', 5);
select is(
  (select task_points from pg_temp.open983('98300000-0000-0000-0000-000000000011')),
  15,
  'earning the points back lists them again');

select pg_temp.test_login_leadership('98300000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.update_promotion_rule((select rule_id from fx983), 6, false) $$,
  'BC turns the Voluntar -> Voluntar Activ rule off');
reset role;
select is(
  (select count(*) from pg_temp.open983('98300000-0000-0000-0000-000000000011')),
  0::bigint,
  'a rule turned off lists no Promotion Candidate: the live row is superseded');
select pg_temp.test_login_leadership('98300000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.update_promotion_rule((select rule_id from fx983), 6, true) $$,
  'BC turns it on again');
reset role;
select is(
  (select task_points from pg_temp.open983('98300000-0000-0000-0000-000000000011')),
  15,
  'the rule turned on lists them again');

-- ==================== 5. A live rejection holds while the window lasts ====================

select pg_temp.credit983('98300000-0000-0000-0000-000000000012', 15);
select is(
  (select count(*) from pg_temp.open983('98300000-0000-0000-0000-000000000012')),
  1::bigint,
  'the second Voluntar is listed at 15');
select pg_temp.test_login_leadership('98300000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.reject_promotion_candidate(
       (select id from public.promotion_candidates
         where member_id = '98300000-0000-0000-0000-000000000012' and decision is null),
       'Puncte dintr-un singur eveniment') $$,
  'BC rejects the live candidate with a reason');
reset role;
select pg_temp.credit983('98300000-0000-0000-0000-000000000012', 5);
select results_eq(
  $$ select count(*) filter (where decision is null), count(*)
       from public.promotion_candidates
      where member_id = '98300000-0000-0000-0000-000000000012' $$,
  $$ values (0::bigint, 1::bigint) $$,
  'a live rejection keeps the Member off the list while the window lasts: 20 points, still the one rejected row');

-- ==================== 6. A run ====================

-- One transaction pins now(): the rejection above would share the run's
-- instant. It happened a minute earlier, as any rejection before a run does.
update public.promotion_candidates set created_at = created_at - interval '1 minute'
 where member_id = '98300000-0000-0000-0000-000000000012' and decision = 'rejected';

select pg_temp.credit983('98300000-0000-0000-0000-000000000013', 15, now() - interval '2 days');
select is(
  (select count(*) from pg_temp.open983('98300000-0000-0000-0000-000000000013')),
  1::bigint,
  'the third Voluntar, credited two days ago, is listed live');

create temp table run983 (role_evaluation_id bigint, candidates int, retention_signals int);
grant insert, select on run983 to authenticated;
select pg_temp.test_login_leadership('98300000-0000-0000-0000-000000000001');
select lives_ok(
  $$ insert into run983
     select * from public.run_role_evaluation('voluntar_activ',
       (select today from fx983) - 30, (select today from fx983) - 1, 'Evaluare #983') $$,
  'BC runs a Voluntar Activ Role Evaluation over the thirty days up to yesterday');
reset role;

select results_eq(
  $$ select candidate.role_evaluation_id is null, candidate.decision, candidate.decided_by, candidate.threshold_used
       from public.promotion_candidates as candidate
      where candidate.member_id = '98300000-0000-0000-0000-000000000013'
      order by candidate.id $$,
  $$ values (true, 'superseded', '98300000-0000-0000-0000-000000000001'::uuid, 15),
            (false, null::text, null::uuid, 15) $$,
  'the run supersedes the live row (by BC, as any open row) and lists the Voluntar from its range: a run row carrying the threshold used');
select is(
  (select role_evaluation_id from pg_temp.open983('98300000-0000-0000-0000-000000000013')),
  (select role_evaluation_id from run983),
  'the open row is the run''s');
select results_eq(
  $$ select * from pg_temp.open983('98300000-0000-0000-0000-000000000011') $$,
  $$ values (null::bigint, 15, '2000-07-01'::date, 15) $$,
  'after the run, a Voluntar already at the threshold in the new window (points dated today, after the range) is listed at once');
select results_eq(
  $$ select body like ('%de la ultima evaluare Voluntar Activ (din ' || to_char((select today from fx983), 'DD.MM.YYYY') || ')%')
       from public.notifications
      where dedupe_key = 'promotion_candidate:live:98300000-0000-0000-0000-000000000011'
        and member_id = '98300000-0000-0000-0000-000000000001' $$,
  $$ values (true) $$,
  'and its Notification counts the points from the day after the run''s range');
select is(
  (select task_points from pg_temp.open983('98300000-0000-0000-0000-000000000012')),
  20,
  'the live rejection held until this run only: the rejected Member, at 20 in the new window, is listed again');

select pg_temp.credit983('98300000-0000-0000-0000-000000000013', 15);
select is(
  (select count(*) from public.promotion_candidates
    where member_id = '98300000-0000-0000-0000-000000000013' and role_evaluation_id is null and decision is null),
  0::bigint,
  'a Member with an open run row is not listed live beside it');
select pg_temp.test_login_leadership('98300000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.reject_promotion_candidate(
       (select id from public.promotion_candidates
         where member_id = '98300000-0000-0000-0000-000000000013' and decision is null),
       'Încă un semestru') $$,
  'BC rejects the run row');
reset role;
select pg_temp.credit983('98300000-0000-0000-0000-000000000013', 5);
select results_eq(
  $$ select * from pg_temp.open983('98300000-0000-0000-0000-000000000013') $$,
  $$ values (null::bigint, 20, '2000-07-01'::date, 15) $$,
  'a run row''s rejection holds for its run only: the Member is listed live from the new window');

-- ==================== 7. The daily job ====================

select pg_temp.credit983('98300000-0000-0000-0000-000000000019', 15);
delete from public.promotion_candidates where member_id = '98300000-0000-0000-0000-000000000019';
select lives_ok($$ select private.apply_promotions() $$, 'the daily job runs');
select results_eq(
  $$ select * from pg_temp.open983('98300000-0000-0000-0000-000000000019') $$,
  $$ values (null::bigint, 15, '2000-07-01'::date, 15) $$,
  'the daily job lists a Voluntar the triggers missed (a tenure reached by the calendar alone)');

-- ==================== 8. Status and tenure ====================

select pg_temp.credit983('98300000-0000-0000-0000-000000000014', 15);
select is(
  (select count(*) from pg_temp.open983('98300000-0000-0000-0000-000000000014')),
  1::bigint,
  'the fourth Voluntar is listed');
update public.profiles set status = 'inactiv' where id = '98300000-0000-0000-0000-000000000014';
select results_eq(
  $$ select decision, decided_by from public.promotion_candidates
      where member_id = '98300000-0000-0000-0000-000000000014' order by id desc limit 1 $$,
  $$ values ('superseded', null::uuid) $$,
  'a deactivated Voluntar is unlisted');
update public.profiles set status = 'activ' where id = '98300000-0000-0000-0000-000000000014';
select is(
  (select count(*) from pg_temp.open983('98300000-0000-0000-0000-000000000014')),
  1::bigint,
  'and listed again once reactivated');

update public.profiles set joined_at = '2000-01-01' where id = '98300000-0000-0000-0000-000000000015';
select results_eq(
  $$ select * from pg_temp.open983('98300000-0000-0000-0000-000000000015') $$,
  $$ values (null::bigint, 20, '2000-07-01'::date, 15) $$,
  'the join date moved back lists the once-untenured Voluntar, with the tenure date it implies');

-- ==================== 9. A promotion ====================

select pg_temp.test_login_leadership('98300000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.set_member_role('98300000-0000-0000-0000-000000000011', 'activ') $$,
  'BC promotes the first Voluntar by hand');
reset role;
select results_eq(
  $$ select decision, decided_by from public.promotion_candidates
      where member_id = '98300000-0000-0000-0000-000000000011' order by id desc limit 1 $$,
  $$ values ('promoted', '98300000-0000-0000-0000-000000000001'::uuid) $$,
  'the live row closes as promoted, by BC: the Profile refresh leaves a Member who left Voluntar to the role_history trigger');
select is(
  (select count(*) from pg_temp.open983('98300000-0000-0000-0000-000000000011')),
  0::bigint,
  'a Voluntar Activ holder has no open row');

select * from finish();
rollback;
