-- apply_promotions.test.sql -- #52: applying automatic promotions and
-- notifying the Retention Signals.
--
-- private.apply_promotions() -- the daily job: every row of
-- private.detect_promotions() applied (Role, a role_history row with the
-- system actor, a congratulatory Notification).
-- private.apply_close_promotions(p_period_id) -- the close: every row of
-- private.detect_close_promotions(p_period_id) applied, and every Retention
-- Signal -- read before any Role moves -- notified to BC and the Adunarea
-- Generală's Group Responsibles, changing nothing.
-- private.apply_promotion(...) -- their shared one-row core.
--
-- In order: grants and the cron entry; the advisory lock; the close's
-- errors; the close; a second close; the daily job; a second job; the core's
-- guards; nobody demoted.
--
-- Fixtures, written as the owner inside this rolled-back transaction
-- (conventions section 10: no command opens or closes a Period before #701).
-- Every live active ladder holder the demo seed brings is deactivated first.
-- Both rules pinned to 6 months of tenure, x = 30 (seed), y = 25 (seed), the
-- top_percent rule's initial_threshold 10 (P1 carries no stamp, so it is the
-- threshold in force).
--
-- P1, closed: [2005-01-01, 2005-06-30 22:00 UTC). Task Points, 10 ranked,
-- share ceil(30% x 10) = 3:
--   C1 recrut 30, A1 activ 27, C2 voluntar 24 -- inside; V1 vot 10; A2 activ
--   1 and F1..F5 bce 1 each; V2 vot has nothing.
--   The close promotes C1 recrut -> voluntar (tenure) then voluntar -> activ
--   (top x%), and C2 voluntar -> activ: 3 promotions.
--   Retention at the close: Voluntar Activ cohort A1 27, A2 1 -> share 1, A2
--   signalled; Drept de Vot cohort V1 10, V2 0 -> share 1, V2 signalled. Read
--   after the promotions instead, the Voluntar Activ cohort would be C1 30,
--   A1 27, C2 24, A2 1 -> share 2 (A2 at rank 4), and C2 -- promoted by this
--   very close -- would sit outside it. A second close reads exactly that
--   cohort; C2's role_history row, dated after P1's closed_at, keeps C2 out
--   of P1's signals.
-- P2, open since ten days ago: N2 voluntar (tenured) 12 >= 10, N3 voluntar
-- (joined today) 30. N1 recrut tenured today; N4 recrut tenured, inactive.
-- The daily job promotes N1 (time) and N2 (the threshold): 2 promotions.
--
-- The Adunarea Generală (org_settings.adunarea_generala_group_id) is AG 52:
-- R1 bce Responsible, V2 vot Responsible, M1 bce Manager, R3 bce
-- Responsible deactivated; CH bce is Responsible on its child Group.
--
-- Mutation guards, each named against the assertion that turns red (run on
-- 2026-09-25 against the live database, each reverted after):
--   * the advisory lock dropped from either entry point -> "... serialise on
--     the advisory lock";
--   * the Retention Signals read after the promotions -> "the signal names
--     the Role at risk, the Period, the rank ..." (rank 4 of share 2);
--   * the promoted-at-or-after-the-close exclusion dropped -> "a second close
--     ... writes nothing" (C2);
--   * the read-or-unread dedupe check dropped -> "a second close ... writes
--     nothing" (A2, V2);
--   * group_role 'responsible' widened to any Group Role -> "the AG Manager
--     ... is not told";
--   * the adherence_form_url read replaced by the empty branch -> "the
--     Voluntar Activ Notification carries the adherence-form link";
--   * the core's Role re-check dropped -> "a stale detection row is
--     skipped";
--   * the core's status re-check dropped -> "a deactivated Member is
--     skipped";
--   * the core's level guard dropped -> "a row that would lower the Role is
--     skipped" and the two "nobody demoted" assertions.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(49);

-- ==================== 1. Grants and the cron entry ====================

select ok(not has_function_privilege(role_name, 'private.apply_promotions()', 'execute'),
          format('%s cannot run the daily promotion job', role_name))
  from unnest(array['authenticated', 'anon', 'service_role']) as role_name;
select ok(not has_function_privilege(role_name, 'private.apply_close_promotions(bigint)', 'execute'),
          format('%s cannot run the close-time promotion run', role_name))
  from unnest(array['authenticated', 'anon', 'service_role']) as role_name;
select ok(not has_function_privilege(role_name,
            'private.apply_promotion(uuid, public.member_role, public.member_role, text, bigint)', 'execute'),
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
select extensions.dblink_exec('promotions_retry', 'rollback; begin; set local lock_timeout = ''250ms'';');
select throws_ok(
  $$select * from extensions.dblink('promotions_retry', 'select * from private.apply_close_promotions(1)')
      as result (promotions integer, retention_signals integer)$$,
  '55P03', 'canceling statement due to lock timeout',
  'the close-time run and the daily job serialise on the same advisory lock');
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
update public.promotion_rules set initial_threshold = 10 where kind = 'top_percent';
update public.org_settings set value = null where key = 'adherence_form_url';

insert into auth.users (id, email)
select ('52000000-0000-0000-0000-0000000000' || suffix)::uuid, 'm' || suffix || '-52@test.local'
  from unnest(array['01', '02', '03', '04', '05', '06', '11', '12', '13', '14', '15', '16',
                    '21', '22', '23', '24', '25', '31', '32', '33', '34']) as suffix;

insert into public.profiles (id, full_name, email, role, status, joined_at) values
  ('52000000-0000-0000-0000-000000000001', 'BC 52',       'm01-52@test.local', 'bc',       'activ',   '2000-01-01'),
  ('52000000-0000-0000-0000-000000000002', 'BCX 52',      'm02-52@test.local', 'bc',       'inactiv', '2000-01-01'),
  ('52000000-0000-0000-0000-000000000003', 'R1 52',       'm03-52@test.local', 'bce',      'activ',   '2001-01-01'),
  ('52000000-0000-0000-0000-000000000004', 'M1 52',       'm04-52@test.local', 'bce',      'activ',   '2001-01-01'),
  ('52000000-0000-0000-0000-000000000005', 'R3 52',       'm05-52@test.local', 'bce',      'inactiv', '2001-01-01'),
  ('52000000-0000-0000-0000-000000000006', 'CH 52',       'm06-52@test.local', 'bce',      'activ',   '2001-01-01'),
  ('52000000-0000-0000-0000-000000000011', 'C1 52',       'm11-52@test.local', 'recrut',   'activ',   '2004-01-01'),
  ('52000000-0000-0000-0000-000000000012', 'C2 52',       'm12-52@test.local', 'voluntar', 'activ',   '2004-01-01'),
  ('52000000-0000-0000-0000-000000000013', 'A1 52',       'm13-52@test.local', 'activ',    'activ',   '2003-01-01'),
  ('52000000-0000-0000-0000-000000000014', 'A2 52',       'm14-52@test.local', 'activ',    'activ',   '2003-01-01'),
  ('52000000-0000-0000-0000-000000000015', 'V1 52',       'm15-52@test.local', 'vot',      'activ',   '2002-01-01'),
  ('52000000-0000-0000-0000-000000000016', 'V2 52',       'm16-52@test.local', 'vot',      'activ',   '2002-01-01'),
  ('52000000-0000-0000-0000-000000000021', 'F1 52',       'm21-52@test.local', 'bce',      'activ',   '2001-01-01'),
  ('52000000-0000-0000-0000-000000000022', 'F2 52',       'm22-52@test.local', 'bce',      'activ',   '2001-01-01'),
  ('52000000-0000-0000-0000-000000000023', 'F3 52',       'm23-52@test.local', 'bce',      'activ',   '2001-01-01'),
  ('52000000-0000-0000-0000-000000000024', 'F4 52',       'm24-52@test.local', 'bce',      'activ',   '2001-01-01'),
  ('52000000-0000-0000-0000-000000000025', 'F5 52',       'm25-52@test.local', 'bce',      'activ',   '2001-01-01'),
  ('52000000-0000-0000-0000-000000000031', 'N1 52',       'm31-52@test.local', 'recrut',   'activ',   '2020-01-01'),
  ('52000000-0000-0000-0000-000000000032', 'N2 52',       'm32-52@test.local', 'voluntar', 'activ',   '2020-01-01'),
  ('52000000-0000-0000-0000-000000000033', 'N3 52',       'm33-52@test.local', 'voluntar', 'activ',   (now() at time zone 'Europe/Bucharest')::date),
  ('52000000-0000-0000-0000-000000000034', 'N4 52',       'm34-52@test.local', 'recrut',   'inactiv', '2020-01-01');

-- A1 goes by a Nickname: the signal names Members as every server-side name does.
update public.profiles set nickname = 'Alfa52' where id = '52000000-0000-0000-0000-000000000013';
update public.profiles set nickname = 'Beta52' where id = '52000000-0000-0000-0000-000000000014';

insert into public.groups (name, category, min_level) values ('Grup Promovări 52', 'department', 0);
insert into public.groups (name, category, min_level) values ('AG 52', 'team', 3);
insert into public.groups (name, category, parent_id, min_level)
select 'Comisia AG 52', 'team', parent.id, 3 from public.groups as parent where parent.name = 'AG 52';

insert into public.evaluation_periods (name, opened_at, opened_by, closed_at, closed_by) values
  ('Perioada închisă #52', '2005-01-01 00:00:00+00', '52000000-0000-0000-0000-000000000001',
   '2005-06-30 22:00:00+00', '52000000-0000-0000-0000-000000000001');
insert into public.evaluation_periods (name, opened_at, opened_by) values
  ('Perioada deschisă #52', now() - interval '10 days', '52000000-0000-0000-0000-000000000001');

create temp table fx52 as
  select (select id from public.evaluation_periods where name = 'Perioada închisă #52')  as closed,
         (select id from public.evaluation_periods where name = 'Perioada deschisă #52') as open,
         (select max(id) + 1000 from public.evaluation_periods)                          as unknown,
         (select id from public.groups where name = 'AG 52')                             as ag,
         (select id from public.groups where name = 'Comisia AG 52')                     as child;

insert into public.group_members (group_id, member_id, group_role)
select fixture.group_id, fixture.member_id::uuid, fixture.group_role
  from fx52,
       lateral (values
         (fx52.ag,    '52000000-0000-0000-0000-000000000003', 'responsible'),
         (fx52.ag,    '52000000-0000-0000-0000-000000000016', 'responsible'),
         (fx52.ag,    '52000000-0000-0000-0000-000000000004', 'manager'),
         (fx52.ag,    '52000000-0000-0000-0000-000000000005', 'responsible'),
         (fx52.child, '52000000-0000-0000-0000-000000000006', 'responsible')
       ) as fixture (group_id, member_id, group_role);

update public.org_settings set value = (select ag from fx52)::text
 where key = 'adunarea_generala_group_id';

-- rating 5 -> x3, rating 4 -> x2, rating 3 -> x1.
create temp table credits52 (title text, difficulty int, rating int, member_id uuid, awarded_at timestamptz);
insert into credits52 values
  ('C1a #52', 5, 5, '52000000-0000-0000-0000-000000000011', '2005-03-01 12:00:00+00'),
  ('C1b #52', 5, 5, '52000000-0000-0000-0000-000000000011', '2005-03-02 12:00:00+00'),
  ('A1a #52', 5, 5, '52000000-0000-0000-0000-000000000013', '2005-03-01 12:00:00+00'),
  ('A1b #52', 4, 5, '52000000-0000-0000-0000-000000000013', '2005-03-02 12:00:00+00'),
  ('C2a #52', 4, 5, '52000000-0000-0000-0000-000000000012', '2005-03-01 12:00:00+00'),
  ('C2b #52', 4, 5, '52000000-0000-0000-0000-000000000012', '2005-03-02 12:00:00+00'),
  ('V1 #52',  5, 4, '52000000-0000-0000-0000-000000000015', '2005-03-01 12:00:00+00'),
  ('A2 #52',  1, 3, '52000000-0000-0000-0000-000000000014', '2005-03-01 12:00:00+00'),
  ('F1 #52',  1, 3, '52000000-0000-0000-0000-000000000021', '2005-03-01 12:00:00+00'),
  ('F2 #52',  1, 3, '52000000-0000-0000-0000-000000000022', '2005-03-01 12:00:00+00'),
  ('F3 #52',  1, 3, '52000000-0000-0000-0000-000000000023', '2005-03-01 12:00:00+00'),
  ('F4 #52',  1, 3, '52000000-0000-0000-0000-000000000024', '2005-03-01 12:00:00+00'),
  ('F5 #52',  1, 3, '52000000-0000-0000-0000-000000000025', '2005-03-01 12:00:00+00'),
  -- P2, the open Period.
  ('N2 #52',  4, 5, '52000000-0000-0000-0000-000000000032', now() - interval '1 day'),
  ('N3a #52', 5, 5, '52000000-0000-0000-0000-000000000033', now() - interval '1 day'),
  ('N3b #52', 5, 5, '52000000-0000-0000-0000-000000000033', now() - interval '1 day');

insert into public.tasks
  (title, description, deadline, group_id, status, difficulty, rating,
   created_by, created_at, completed_at)
select credit.title, 'Fixture', now() - interval '2 days',
       (select id from public.groups where name = 'Grup Promovări 52'),
       'completed', credit.difficulty, credit.rating, '52000000-0000-0000-0000-000000000001',
       now() - interval '3 days', now()
  from credits52 as credit;

select pg_temp.test_credit_task(task.id, credit.member_id, '52000000-0000-0000-0000-000000000001',
                                p_awarded_at => credit.awarded_at)
  from credits52 as credit
  join public.tasks as task on task.title = credit.title
 order by task.id;

-- Who BC is at the close: every live active Member at level >= 6.
create temp table bc52 as
  select profile.id
    from public.profiles as profile
    join public.roles as role on role.id = profile.role
   where profile.status = 'activ' and role.level >= 6;

create temp table roles_before52 as
  select profile.id, role.level
    from public.profiles as profile
    join public.roles as role on role.id = profile.role;

create function pg_temp.m(p_suffix text) returns uuid language sql as $$
  select ('52000000-0000-0000-0000-0000000000' || p_suffix)::uuid;
$$;

create function pg_temp.signal_key(p_suffix text) returns text language sql as $$
  select 'retention_signal:' || (select closed from fx52)::text || ':' || pg_temp.m(p_suffix)::text;
$$;

-- ==================== 3. The close's errors ====================

select throws_ok(format('select * from private.apply_close_promotions(%s)', (select open from fx52)),
  'PT409', 'evaluation_period_open',
  'the close-time run refuses a Period that is still open, so the close rolls back');
select throws_ok(format('select * from private.apply_close_promotions(%s)', (select unknown from fx52)),
  'PT404', 'evaluation_period_not_found',
  'the close-time run refuses an unknown Period');

-- ==================== 4. The close ====================

create temp table close52 as
  select * from private.apply_close_promotions((select closed from fx52));

select is((select promotions from close52), 3,
  'the close applies three promotions: C1 twice (tenure, then the top x%) and C2 once');
select is((select retention_signals from close52), 2 * (select count(*)::int from bc52) + 3,
  'the close writes one Retention Signal Notification per recipient: BC for A2 and V2, R1 for both, V2 for A2');

select results_eq(
  $$select from_role::text, to_role::text, actor_kind, changed_by
      from public.role_history where member_id = pg_temp.m('11') order by id$$,
  $$values ('recrut', 'voluntar', 'automatic', null::uuid), ('voluntar', 'activ', 'automatic', null::uuid)$$,
  'a Recrut reaching the tenure at the close and inside the top x% is promoted twice, each with a system-actor history row');
select is((select role::text from public.profiles where id = pg_temp.m('11')), 'activ',
  'a close-time promotion moves profiles.role');
select results_eq(
  $$select from_role::text, to_role::text, actor_kind, changed_by
      from public.role_history where member_id = pg_temp.m('12')$$,
  $$values ('voluntar', 'activ', 'automatic', null::uuid)$$,
  'a Voluntar inside the top x% at the close is promoted once, with a system-actor history row');

select results_eq(
  $$select notification.kind::text, notification.link, notification.dedupe_key
      from public.notifications as notification
     where notification.member_id = pg_temp.m('11') order by notification.id$$,
  $$select 'system', '/profil', 'promotion:' || history.id::text
      from public.role_history as history where history.member_id = pg_temp.m('11') order by history.id$$,
  'every promotion writes one system Notification to the Member, keyed by its history row');
select ok(
  (select body from public.notifications
    where member_id = pg_temp.m('11') and title = 'Felicitări! Acum ești Voluntar Activ')
    ~ 'Eligibilitate AG.*Dreptul de Vot.*Formularul de adeziune îl primești de la BC\.$',
  'with no adherence form set, the Voluntar Activ Notification names the benefits and says BC sends the form');
select ok(
  (select body from public.notifications
    where member_id = pg_temp.m('11') and title = 'Felicitări! Acum ești Voluntar')
    !~ 'adeziune',
  'a promotion to Voluntar offers no adherence form');

-- The Retention Signals.
select is(
  (select array_agg(id::text order by id) from public.profiles
    where id in (pg_temp.m('14'), pg_temp.m('16')) and role::text in ('activ', 'vot')),
  array[pg_temp.m('14')::text, pg_temp.m('16')::text],
  'a Retention Signal leaves profiles.role untouched');
select is(
  (select count(*) from public.role_history where member_id in (pg_temp.m('14'), pg_temp.m('16'))),
  0::bigint, 'a Retention Signal writes no role_history row');
select set_eq(
  format('select member_id from public.notifications where dedupe_key = %L', pg_temp.signal_key('14')),
  $$select id from bc52 union all select pg_temp.m('03') union all select pg_temp.m('16')$$,
  'A2''s signal reaches every live BC and Moderator and each AG Group Responsible, exactly once');
select set_eq(
  format('select member_id from public.notifications where dedupe_key = %L', pg_temp.signal_key('16')),
  $$select id from bc52 union all select pg_temp.m('03')$$,
  'V2''s signal reaches BC and the other AG Responsible -- the Member at risk is not told about themselves');
select is(
  (select count(*) from public.notifications
    where member_id = pg_temp.m('04') and dedupe_key like 'retention_signal:%'),
  0::bigint, 'the AG Manager, who is not a Group Responsible, is not told');
select is(
  (select count(*) from public.notifications
    where member_id in (pg_temp.m('02'), pg_temp.m('05'), pg_temp.m('06'))
      and dedupe_key like 'retention_signal:%'),
  0::bigint, 'a deactivated BC, a deactivated AG Responsible and a Responsible of a child Group are not told');
select results_eq(
  format('select kind::text, title, link from public.notifications where dedupe_key = %L and member_id = %L',
         pg_temp.signal_key('14'), pg_temp.m('01')),
  format($$values ('system', 'Semnal de retenție: Beta52', '/tracker/membru/%s')$$, pg_temp.m('14')),
  'the signal names the Member by Nickname and links to their work');
select ok(
  (select body from public.notifications where dedupe_key = pg_temp.signal_key('14') and member_id = pg_temp.m('01'))
    ~ '^Beta52 \(Voluntar Activ\) a încheiat perioada de evaluare „Perioada închisă #52” sub pragul rolului\. Puncte în perioadă: 1\. Locul în rol: 2; rolul cere cel mult locul 1\. ',
  'the signal names the Role at risk, the Period, the rank, the Task Points and the share');
select ok(
  (select body from public.notifications where dedupe_key = pg_temp.signal_key('16') and member_id = pg_temp.m('01'))
    ~ '^V2 52 \(Voluntar cu Drept de Vot\)',
  'a Drept de Vot signal names that Role');
select is(
  (select count(*) from public.notifications where dedupe_key = pg_temp.signal_key('12')),
  0::bigint, 'a Voluntar the close has just promoted is not signalled in the same close (the signals read the Roles at the close)');

-- ==================== 5. A second close ====================

create temp table counts52 as
  select (select count(*) from public.role_history)  as role_history,
         (select count(*) from public.notifications) as notifications;
update public.notifications set read = true where member_id::text like '52000000-%' or dedupe_key like 'retention_signal:%';

select results_eq(
  format('select promotions, retention_signals from private.apply_close_promotions(%s)', (select closed from fx52)),
  $$values (0, 0)$$,
  'a second close of the same Period applies nothing and writes nothing, the first Notifications read or not');
select is(
  (select row(count(*), (select count(*) from public.notifications))::text from public.role_history),
  (select row(role_history, notifications)::text from counts52),
  'a second close leaves role_history and notifications as they were');

-- ==================== 6. The daily job ====================

update public.org_settings set value = 'https://forms.example.org/adeziune-52'
 where key = 'adherence_form_url';

select is(private.apply_promotions(), 2, 'the daily job applies two promotions: N1 by tenure, N2 by the threshold');

select is((select role::text from public.profiles where id = pg_temp.m('31')), 'voluntar',
  'a continuous promotion moves profiles.role');
select results_eq(
  $$select from_role::text, to_role::text, actor_kind, changed_by
      from public.role_history where member_id = pg_temp.m('31')$$,
  $$values ('recrut', 'voluntar', 'automatic', null::uuid)$$,
  'a continuous promotion writes one role_history row with the system actor');
select results_eq(
  $$select notification.kind::text, notification.title, notification.link, notification.dedupe_key
      from public.notifications as notification where notification.member_id = pg_temp.m('31')$$,
  $$select 'system', 'Felicitări! Acum ești Voluntar', '/profil', 'promotion:' || history.id::text
      from public.role_history as history where history.member_id = pg_temp.m('31')$$,
  'a continuous promotion writes one congratulatory Notification to the Member');
select is((select role::text from public.profiles where id = pg_temp.m('32')), 'activ',
  'a tenured Voluntar at the threshold in the open Period becomes Voluntar Activ');
select ok(
  (select body from public.notifications where member_id = pg_temp.m('32'))
    ~ 'Eligibilitate AG.*Dreptul de Vot.*Completează formularul de adeziune: https://forms\.example\.org/adeziune-52$',
  'the Voluntar Activ Notification carries the adherence-form link, read from org_settings at write time');
select is(
  (select array_agg(role::text order by id) from public.profiles
    where id in (pg_temp.m('33'), pg_temp.m('34'))),
  array['voluntar', 'recrut'],
  'a Voluntar without the tenure and a deactivated Recrut are not promoted');

-- ==================== 7. A second job ====================

drop table counts52;
create temp table counts52 as
  select (select count(*) from public.role_history)  as role_history,
         (select count(*) from public.notifications) as notifications;
update public.notifications set read = true where member_id::text like '52000000-%';

select is(private.apply_promotions(), 0, 'a second run of the daily job applies nothing');
select is(
  (select row(count(*), (select count(*) from public.notifications))::text from public.role_history),
  (select row(role_history, notifications)::text from counts52),
  'a second run writes no role_history row and no Notification, the first ones read or not');

-- ==================== 8. The core's guards ====================

select is(
  private.apply_promotion(pg_temp.m('14'), 'voluntar', 'activ', 'top_percent', null), false,
  'a stale detection row is skipped: the Member no longer holds from_role');
select is(
  private.apply_promotion(pg_temp.m('13'), 'activ', 'voluntar', 'time', null), false,
  'a row that would lower the Role is skipped');
select is(
  private.apply_promotion(pg_temp.m('34'), 'recrut', 'voluntar', 'time', null), false,
  'a deactivated Member is skipped');
select is(
  (select row(count(*), (select count(*) from public.notifications))::text from public.role_history),
  (select row(role_history, notifications)::text from counts52),
  'a skipped row writes nothing');

-- ==================== 9. Nobody demoted ====================

select is(
  (select count(*) from public.profiles as profile
     join public.roles as role on role.id = profile.role
     join roles_before52 as before on before.id = profile.id
    where role.level < before.level),
  0::bigint, 'no Member ever holds a lower Role after either function ran');
select is(
  (select count(*) from public.role_history as history
     join public.roles as from_role on from_role.id = history.from_role
     join public.roles as to_role on to_role.id = history.to_role
    where history.actor_kind = 'automatic' and to_role.level <= from_role.level),
  0::bigint, 'every automatic role_history row raises the Role');

select * from finish();
rollback;
