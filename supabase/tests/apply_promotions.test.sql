-- apply_promotions.test.sql -- #52, trimmed by #826 (ruling R28): the daily
-- promotion job, tenure alone.
--
-- private.apply_promotions() -- the daily job: every row of the tenure-only
-- private.detect_promotions() applied (Role, a role_history row with the
-- system actor, a congratulatory Notification). Recrut -> Voluntar Activ is
-- never automatic any more: private.detect_promotions() carries no
-- top_percent branch, so a tenured Voluntar's Task Points -- however high --
-- never reach apply_promotions at all. That candidate now surfaces through
-- public.run_role_evaluation (#826) as a Promotion Candidate BC promotes by
-- hand; private.apply_close_promotions does not exist any more.
-- private.apply_promotion(uuid, member_role, member_role, text) -- the
-- shared one-row core, unchanged in shape except for losing its period
-- argument (nothing left calls it with one).
--
-- In order: grants and the cron entry; the advisory lock; the daily job; a
-- second job; the core's guards; nobody demoted.
--
-- Fixtures, written as the owner inside this rolled-back transaction. Every
-- live active ladder holder the demo seed brings is deactivated first. The
-- time rule is pinned to 6 months of tenure (seed); the seeded Voluntar
-- Activ threshold is 30 (#826's migration, carried from promotion_rules'
-- retired initial_threshold).
--
-- j_over is the latest join date that holds 6 months today on the Bucharest
-- calendar.
--   N1 recrut j_over -- tenured today -- promoted by the daily job.
--   N2 voluntar j_over with 45 Task Points, above the threshold in force
--   (30) -- never promoted: the job has no path from Voluntar to Voluntar
--   Activ any more.
--   N4 recrut j_over, deactivated -- not promoted (status guard).
--   A1, A2 activ -- untenured targets for the core's guard tests alone,
--   never touched by the job.
--
-- Mutation guards, each named against the assertion that turns red (run
-- 2026-09-27 against the live database, reverted after):
--   * the advisory lock dropped from apply_promotions -> "the daily job and
--     a retry serialise on the advisory lock";
--   * the core's Role re-check dropped -> "a stale detection row is
--     skipped";
--   * the core's status re-check dropped -> "a deactivated Member is
--     skipped";
--   * the core's level guard dropped -> "a row that would lower the Role is
--     skipped" and the two "nobody demoted" assertions;
--   * a top_percent branch added back to detect_promotions (a scratch copy
--     unions in N2 as kind top_percent, applied through apply_promotion) ->
--     "a tenured Voluntar's Task Points ... never promote them" goes red,
--     proving the assertion is not vacuous.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(23);

-- ==================== 1. Grants and the cron entry ====================

select ok(not has_function_privilege(role_name, 'private.apply_promotions()', 'execute'),
          format('%s cannot run the daily promotion job', role_name))
  from unnest(array['authenticated', 'anon', 'service_role']) as role_name;
select hasnt_function('private', 'apply_close_promotions', array['bigint'],
  'apply_close_promotions no longer exists -- the close-time run is gone (ruling R28)');
select ok(not has_function_privilege(role_name,
            'private.apply_promotion(uuid, public.member_role, public.member_role, text)', 'execute'),
          format('%s cannot apply one promotion', role_name))
  from unnest(array['authenticated', 'anon', 'service_role']) as role_name;

select is(
  (select count(*) from cron.job
    where jobname = 'osubb-apply-promotions' and schedule = '30 5 * * *'
      and command = 'select private.apply_promotions()' and active),
  1::bigint, 'osubb-apply-promotions runs private.apply_promotions() once a day');

-- ==================== 2. The advisory lock ====================
-- A second session must wait for (52, 1) before reading anything. Both
-- remote transactions roll back.

select extensions.dblink_connect('promotions_lock',
  'host=db.supabase.internal port=5432 dbname=postgres user=postgres password=postgres');
select extensions.dblink_connect('promotions_retry',
  'host=db.supabase.internal port=5432 dbname=postgres user=postgres password=postgres');
select extensions.dblink_exec('promotions_lock',
  'begin; do $lock$ begin perform pg_catalog.pg_advisory_xact_lock(52, 1); end $lock$;');
select extensions.dblink_exec('promotions_retry', 'begin; set local lock_timeout = ''250ms'';');
select throws_ok(
  $$select * from extensions.dblink('promotions_retry', 'select private.apply_promotions()') as result (applied integer)$$,
  '55P03', 'canceling statement due to lock timeout',
  'the daily job and a retry serialise on the advisory lock');
select extensions.dblink_exec('promotions_retry', 'rollback;');
select extensions.dblink_exec('promotions_lock', 'rollback;');
select extensions.dblink_disconnect('promotions_retry');
select extensions.dblink_disconnect('promotions_lock');

-- ==================== Fixtures ====================

update public.profiles set status = 'inactiv'
 where status = 'activ'
   and role in ('recrut', 'voluntar', 'activ', 'vot')
   and id::text not like '52000000-%';

update public.promotion_rules set min_tenure_months = 6, enabled = true;
update public.promotion_thresholds set threshold = 30, updated_by = null where kind = 'voluntar_activ';

create temp table tenure52 as
  with today as (select (now() at time zone 'Europe/Bucharest')::date as on_date)
  select today.on_date,
         (select min(day)::date
            from generate_series(today.on_date - interval '7 months', today.on_date::timestamp, interval '1 day') as day
           where (day::date + interval '6 months')::date > today.on_date) as j_under
    from today;
alter table tenure52 add column j_over date;
update tenure52 set j_over = j_under - 1;

insert into auth.users (id, email)
select ('52000000-0000-0000-0000-0000000000' || suffix)::uuid, 'm' || suffix || '-52@test.local'
  from unnest(array['01', '13', '14', '31', '32', '34']) as suffix;

insert into public.profiles (id, full_name, email, role, status, joined_at)
select member.id::uuid, member.full_name, member.email, member.role::public.member_role,
       member.status::public.member_status, member.joined_at
  from tenure52,
       lateral (values
         ('52000000-0000-0000-0000-000000000001', 'BC 52', 'm01-52@test.local', 'bc',       'activ',   '2000-01-01'::date),
         ('52000000-0000-0000-0000-000000000013', 'A1 52', 'm13-52@test.local', 'activ',    'activ',   '2003-01-01'::date),
         ('52000000-0000-0000-0000-000000000014', 'A2 52', 'm14-52@test.local', 'activ',    'activ',   '2003-01-01'::date),
         ('52000000-0000-0000-0000-000000000031', 'N1 52', 'm31-52@test.local', 'recrut',   'activ',   tenure52.j_over),
         ('52000000-0000-0000-0000-000000000032', 'N2 52', 'm32-52@test.local', 'voluntar', 'activ',   tenure52.j_over),
         ('52000000-0000-0000-0000-000000000034', 'N4 52', 'm34-52@test.local', 'recrut',   'inactiv', tenure52.j_over)
       ) as member (id, full_name, email, role, status, joined_at);

insert into public.groups (name, category, min_level) values ('Grup Promovări 52', 'department', 0);

-- N2's Task Points: three completed Tasks at the maximum credit (5 x rating
-- 5 -> x3 = 15 each), 45 total -- above the threshold in force (30).
insert into public.tasks
  (title, description, deadline, group_id, status, difficulty, rating,
   created_by, created_at, completed_at)
select title, 'Fixture', now() - interval '2 days',
       (select id from public.groups where name = 'Grup Promovări 52'),
       'completed', 5, 5, '52000000-0000-0000-0000-000000000001',
       now() - interval '3 days', now()
  from unnest(array['N2a #52', 'N2b #52', 'N2c #52']) as title;

select pg_temp.test_credit_task(task.id, '52000000-0000-0000-0000-000000000032',
                                '52000000-0000-0000-0000-000000000001')
  from public.tasks as task
 where task.title in ('N2a #52', 'N2b #52', 'N2c #52')
 order by task.id;

create temp table roles_before52 as
  select profile.id, role.level
    from public.profiles as profile
    join public.roles as role on role.id = profile.role;

create function pg_temp.m(p_suffix text) returns uuid language sql as $$
  select ('52000000-0000-0000-0000-0000000000' || p_suffix)::uuid;
$$;

-- ==================== 3. The daily job ====================

select is(private.apply_promotions(), 1,
  'the daily job applies one promotion: N1 by tenure -- N2''s Task Points never reach it');

select is((select role::text from public.profiles where id = pg_temp.m('31')), 'voluntar',
  'a continuous promotion moves profiles.role');
select results_eq(
  $$select from_role::text, to_role::text, actor_kind, changed_by
      from public.role_history where member_id = pg_temp.m('31')$$,
  $$values ('recrut', 'voluntar', 'automatic', null::uuid)$$,
  'a continuous promotion writes one role_history row with the system actor');
select results_eq(
  $$select notification.kind::text, notification.title, notification.body, notification.link, notification.dedupe_key
      from public.notifications as notification where notification.member_id = pg_temp.m('31')$$,
  $$select 'system', 'Felicitări! Acum ești Voluntar',
          'Rolul tău în OSUBB este acum Voluntar: ai împlinit vechimea cerută de regula de promovare.',
          '/profil', 'promotion:' || history.id::text
      from public.role_history as history where history.member_id = pg_temp.m('31')$$,
  'a continuous promotion writes the unchanged congratulatory Notification to the Member');

select results_eq(
  $$select role::text from public.profiles where id in (pg_temp.m('32'), pg_temp.m('34')) order by id$$,
  $$values ('voluntar'), ('recrut')$$,
  'a tenured Voluntar with Task Points above the threshold in force is not promoted by the daily job (stays voluntar), and a deactivated tenured Recrut is not promoted either');
select is(
  (select count(*) from public.role_history where member_id in (pg_temp.m('32'), pg_temp.m('34'))),
  0::bigint,
  'neither writes a role_history row');

-- ==================== 4. A second job ====================

create temp table counts52 as
  select (select count(*) from public.role_history)  as role_history,
         (select count(*) from public.notifications) as notifications;
update public.notifications set read = true where member_id::text like '52000000-%';

select is(private.apply_promotions(), 0, 'a second run of the daily job applies nothing');
select is(
  (select row(count(*), (select count(*) from public.notifications))::text from public.role_history),
  (select row(role_history, notifications)::text from counts52),
  'a second run writes no role_history row and no Notification, the first ones read or not');

-- ==================== 5. The core's guards ====================

select is(
  private.apply_promotion(pg_temp.m('14'), 'voluntar', 'activ', 'top_percent'), false,
  'a stale detection row is skipped: the Member no longer holds from_role');
select is(
  private.apply_promotion(pg_temp.m('13'), 'activ', 'voluntar', 'time'), false,
  'a row that would lower the Role is skipped');
select is(
  private.apply_promotion(pg_temp.m('34'), 'recrut', 'voluntar', 'time'), false,
  'a deactivated Member is skipped');
select is(
  (select row(count(*), (select count(*) from public.notifications))::text from public.role_history),
  (select row(role_history, notifications)::text from counts52),
  'a skipped row writes nothing');

-- ==================== 6. Nobody demoted ====================

select is(
  (select count(*) from public.profiles as profile
     join public.roles as role on role.id = profile.role
     join roles_before52 as before on before.id = profile.id
    where role.level < before.level),
  0::bigint, 'no Member ever holds a lower Role after either function ran');
select is(
  (select count(*) from public.role_history as history
     join public.roles as from_role on from_role.id::text = history.from_role
     join public.roles as to_role on to_role.id::text = history.to_role
    where history.actor_kind = 'automatic' and to_role.level <= from_role.level),
  0::bigint, 'every automatic role_history row raises the Role');

select * from finish();
rollback;
