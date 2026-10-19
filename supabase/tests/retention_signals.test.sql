-- retention_signals.test.sql -- R58 (Alex, 2026-10-18; spec
-- docs/superpowers/specs/2026-10-18-portofoliu-interne-design.md, sections A
-- and C, decisions 10 and 14-16): Retention Signals stored, the live
-- Universitate Signal, the live Promotion Candidates by the Membership Cutoff
-- Date, and the drops.
--
-- public.retention_signals holds every Retention Signal: a finalised run
-- writes its points-based ones (below_line, below_floor) and supersedes only
-- its own kind's points-based rows; private.refresh_university_signals --
-- called after every write of a Profile's university or status -- opens the
-- one live kind, not_ubb_student, for an active Voluntar cu Drept de Vot
-- whose Universitate is known and is not UBB (null opens nothing: Review
-- Focus 1), tells the run's Signal recipients once, and closes it as
-- resolved when the fact reverses; a Role change (the role_history trigger)
-- closes every open row of the Member as role_changed. The live Promotion
-- Candidates read the Membership Cutoff Date (Review Focus 4) and, since
-- Ruling 17, count from no earlier than the Points Start Date. The Promotion
-- Rules, their command and the daily job are gone.
--
-- In order: 0. day one stored nothing on an empty database; 1. shape, with every
-- CHECK constraint and the open-row index pinned by name; 2. a
-- Voluntar Activ run's Signals and who reads them; 3. an Adunarea Generală run
-- leaves the other kind's Signals open; 4. the live Universitate Signal
-- (Review Focus 1), and both kinds' runs leave it open; 5. a Role change
-- closes every open row; 6. the live Candidates and the cutoff (Review Focus
-- 4), and the Points Start Date (Ruling 17); 7. the drops.
--
-- Fixtures: _r58_fixtures.psql (Members A-J and a BC member; their Task
-- Points dated 2026-06-15, inside [2026-03-01, 2026-09-30]), plus three of
-- this suite's own (prefix 58510000-): K, a Voluntar cu Drept de Vot whose
-- Universitate is unknown, and L and M, Voluntars who joined 2026-02-01 and
-- earn their points after the runs.
--
-- Mutation guards (run 2026-10-18 as scratch copies of this file that
-- redefine the named function, or drop the named trigger, after the fixture,
-- inside the rolled-back transaction), each turning the named assertion red:
--   * `profile.university is not null and` removed from
--     private.refresh_university_signals -> "Review Focus 1: setting a
--     voter's Universitate to null opens nothing" and "a voter whose
--     Universitate was never known has no live Signal";
--   * trigger evaluation_settings_refresh_promotion_candidates dropped ->
--     "Review Focus 4: moving the cutoff before the Voluntar's join date
--     supersedes the live row at once";
--   * the run's Signal supersede without its kind filter -> "an Adunarea
--     Generală run leaves the Voluntar Activ run's Signals open";
--   * the run's Signal supersede without its reason filter -> "neither
--     kind's run supersedes a live Universitate Signal";
--   * the role_history trigger without `to_role is distinct from from_role`
--     -> "a status change is not a Role change";
--   * Ruling 17's greatest() removed from private.refresh_promotion_candidates
--     -> "points earned before the Points Start Date do not list a Voluntar".
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(64);

-- ==================== 0. Day one ====================
-- The migration stored the Retention Signals of the latest run of each kind;
-- a database with no run has none (retention_signals_day_one_upgrade.test.sh
-- replays the move over runs).

select is((select count(*) from public.retention_signals), 0::bigint,
  'on a database with no Role Evaluation the day-one move stored no Retention Signal');

\ir _r58_fixtures.psql

create function pg_temp.r58x(p_key text) returns uuid language sql immutable as $$
  select ('58510000-0000-0000-0000-0000000000'
          || case p_key when 'K' then '01' when 'L' then '02' when 'M' then '03' end)::uuid
$$;
grant execute on function pg_temp.r58x(text) to authenticated;

create temp table fx5810 as
  select (select array_agg(recipient order by recipient)
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
grant select on fx5810 to authenticated;

create temp table runs5810 (label text, role_evaluation_id bigint, candidates int, retention_signals int);
grant insert, select on runs5810 to authenticated;

create function pg_temp.run5810(p_label text) returns bigint language sql as $$
  select role_evaluation_id from runs5810 where label = p_label
$$;
grant execute on function pg_temp.run5810(text) to authenticated;

-- The live (not_ubb_student) rows of one Member.
create function pg_temp.live5810(p_member uuid)
returns table (kind text, role_at_listing public.member_role, reason text, task_points int,
               threshold_used int, role_evaluation_id bigint, closed_as text, open boolean)
language sql as $$
  select signal.kind, signal.role_at_listing, signal.reason, signal.task_points, signal.threshold_used,
         signal.role_evaluation_id, signal.closed_as, signal.closed_at is null
    from public.retention_signals as signal
   where signal.member_id = p_member and signal.reason = 'not_ubb_student'
   order by signal.id
$$;

-- The open Promotion Candidate of one Member, if any.
create function pg_temp.open5810(p_member uuid)
returns table (role_evaluation_id bigint, task_points int, tenure_since date, threshold_used int)
language sql as $$
  select candidate.role_evaluation_id, candidate.task_points, candidate.tenure_since, candidate.threshold_used
    from public.promotion_candidates as candidate
   where candidate.member_id = p_member and candidate.decision is null
$$;

-- ==================== 1. Shape ====================

select columns_are('public', 'retention_signals',
  array['id', 'kind', 'member_id', 'role_at_listing', 'reason', 'task_points', 'threshold_used',
        'role_evaluation_id', 'created_at', 'closed_at', 'closed_as'],
  'retention_signals carries the kind, the holder, the Role at listing, the reason, the numbers, the run and how it closed');
select ok(
  (select indexdef ~ 'CREATE UNIQUE INDEX retention_signals_open_uidx .* \(kind, member_id, reason\) WHERE \(closed_at IS NULL\)'
     from pg_indexes where schemaname = 'public' and indexname = 'retention_signals_open_uidx'),
  'one open Signal per (kind, Member, reason): retention_signals_open_uidx is unique over the open rows');
select policies_are('public', 'retention_signals', array['retention_signals_read'],
  'the one policy is retention_signals_read -- no client writes a Signal');
select is(
  (select count(*)
     from unnest(array['private.refresh_university_signals()',
                       'private.refresh_university_signals_on_write()']) as fn,
          unnest(array['anon', 'authenticated', 'service_role', 'public']) as grantee
    where has_function_privilege(grantee, fn, 'execute')),
  0::bigint,
  'neither the Universitate refresh nor its trigger body is executable by anon, authenticated, service_role or PUBLIC');
select is(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_refresh_university_signals'),
  'CREATE TRIGGER profiles_refresh_university_signals AFTER UPDATE OF university, status ON public.profiles '
  || 'FOR EACH STATEMENT EXECUTE FUNCTION private.refresh_university_signals_on_write()',
  'a write of a Profile''s university or status refreshes the live Signals, once per statement');
select is(
  (select prosecdef from pg_proc where oid = 'private.refresh_university_signals()'::regprocedure),
  true, 'the refresh is security definer: it writes Signals and Notifications no caller may write');

-- Every CHECK constraint is asserted by name (conventions section 8, Ruling
-- 23). Postgres evaluates CHECKs in name order -- closed_as, closed_shape,
-- kind, live_reason, points_shape, reason -- and each probe row below passes
-- every constraint that sorts before the one it names. Run id 1 is a stand-in:
-- a CHECK refuses the row before its foreign keys are looked at, and a dropped
-- CHECK would let the row reach the foreign key instead, so the assertion
-- fails either way.
select throws_ok(
  $$ insert into public.retention_signals
       (kind, member_id, role_at_listing, reason, task_points, threshold_used, role_evaluation_id)
     values ('other', pg_temp.r58('G'), 'activ', 'below_line', 20, 40, 1) $$,
  '23514', 'new row for relation "retention_signals" violates check constraint "retention_signals_kind_ck"',
  'retention_signals_kind_ck: a Signal belongs to voluntar_activ or adunarea_generala, no other kind');
select throws_ok(
  $$ insert into public.retention_signals
       (kind, member_id, role_at_listing, reason, task_points, threshold_used, role_evaluation_id)
     values ('voluntar_activ', pg_temp.r58('G'), 'activ', 'below_target', 20, 40, 1) $$,
  '23514', 'new row for relation "retention_signals" violates check constraint "retention_signals_reason_ck"',
  'retention_signals_reason_ck: the reason is below_line, below_floor or not_ubb_student');
select throws_ok(
  $$ insert into public.retention_signals
       (kind, member_id, role_at_listing, reason, task_points, threshold_used, role_evaluation_id,
        closed_at, closed_as)
     values ('voluntar_activ', pg_temp.r58('G'), 'activ', 'below_line', 20, 40, 1, now(), 'deleted') $$,
  '23514', 'new row for relation "retention_signals" violates check constraint "retention_signals_closed_as_ck"',
  'retention_signals_closed_as_ck: a Signal closes as role_changed, superseded or resolved, nothing else');
select throws_ok(
  $$ insert into public.retention_signals
       (kind, member_id, role_at_listing, reason, task_points, threshold_used, role_evaluation_id, closed_at)
     values ('voluntar_activ', pg_temp.r58('G'), 'activ', 'below_line', 20, 40, 1, now()) $$,
  '23514', 'new row for relation "retention_signals" violates check constraint "retention_signals_closed_shape_ck"',
  'retention_signals_closed_shape_ck: closed_at and closed_as are set together -- a close time without a how is refused');
select throws_ok(
  $$ insert into public.retention_signals
       (kind, member_id, role_at_listing, reason, task_points, threshold_used, role_evaluation_id)
     values ('voluntar_activ', pg_temp.r58('G'), 'activ', 'below_line', 20, 40, null) $$,
  '23514', 'new row for relation "retention_signals" violates check constraint "retention_signals_live_reason_ck"',
  'retention_signals_live_reason_ck: only the Universitate Signal is live -- a points-based Signal without its run is refused');
select throws_ok(
  $$ insert into public.retention_signals
       (kind, member_id, role_at_listing, reason, task_points, threshold_used, role_evaluation_id)
     values ('adunarea_generala', pg_temp.r58('J'), 'vot', 'not_ubb_student', 5, null, null) $$,
  '23514', 'new row for relation "retention_signals" violates check constraint "retention_signals_points_shape_ck"',
  'retention_signals_points_shape_ck: the Universitate Signal carries no Task Points');

-- One open Signal per (kind, Member, reason): the second of a pair is refused
-- by the unique index, and the first is removed again so no later section
-- meets it.
select lives_ok(
  $$ insert into public.retention_signals (kind, member_id, role_at_listing, reason)
     values ('adunarea_generala', pg_temp.r58('A'), 'vot', 'not_ubb_student') $$,
  'one open live Signal is stored for a Member');
select throws_ok(
  $$ insert into public.retention_signals (kind, member_id, role_at_listing, reason)
     values ('adunarea_generala', pg_temp.r58('A'), 'vot', 'not_ubb_student') $$,
  '23505', 'duplicate key value violates unique constraint "retention_signals_open_uidx"',
  'retention_signals_open_uidx: a second open Signal for the same (kind, Member, reason) is refused');
delete from public.retention_signals where member_id = pg_temp.r58('A');
select is((select count(*) from public.retention_signals), 0::bigint,
  'the probe rows are gone: no later section meets a Signal it did not write');

-- ==================== 2. A Voluntar Activ run's Signals, and who reads them ====================

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select lives_ok(
  $$ insert into runs5810 select 's1', * from public.run_role_evaluation(
       'voluntar_activ', '2026-03-01', '2026-09-30', 'Evaluare semnale S1', 10, 35, '2026-03-01') $$,
  'BC finalises a Voluntar Activ run: Floor 10, 35 %, cutoff 2026-03-01 (line 40)');
reset role;
select results_eq(
  $$ select member_id, kind, role_at_listing, reason, task_points, threshold_used, closed_at
       from public.retention_signals
      where role_evaluation_id = pg_temp.run5810('s1')
      order by member_id $$,
  $$ values (pg_temp.r58('G'), 'voluntar_activ'::text, 'activ'::public.member_role, 'below_line'::text, 20, 40, null::timestamptz),
            (pg_temp.r58('H'), 'voluntar_activ', 'activ', 'below_line', 15, 40, null),
            (pg_temp.r58('I'), 'voluntar_activ', 'vot', 'below_line', 10, 40, null),
            (pg_temp.r58('J'), 'voluntar_activ', 'vot', 'below_floor', 5, 40, null) $$,
  'the run stores one open Signal per holder not inside the line, with its reason, the holder''s Task Points and the line');

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select is((select count(*) from public.retention_signals), 4::bigint, 'BC reads every Retention Signal');
reset role;
select pg_temp.test_login_leadership(pg_temp.r58('C'));
select is((select count(*) from public.retention_signals), 0::bigint,
  'a Voluntar reads none -- not even one about themself');
reset role;
select pg_temp.test_login_leadership(pg_temp.r58('G'));
select is((select count(*) from public.retention_signals), 0::bigint,
  'a Voluntar Activ reads none, their own Signal included');
reset role;
select pg_temp.test_login(pg_temp.r58('BC'), '{}'::jsonb);
select is((select count(*) from public.retention_signals), 0::bigint,
  'a claimless session reads none, though its uid is a live BC (house rule 12)');
reset role;

-- ==================== 3. An Adunarea Generală run ====================

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select lives_ok(
  $$ insert into runs5810 select 'ag1', * from public.run_role_evaluation(
       'adunarea_generala', '2026-03-01', '2026-09-30', 'Evaluare semnale AG1', 10, 25) $$,
  'BC finalises an Adunarea Generală run: Floor 10, 25 % (I alone ranked, line 10)');
reset role;
select results_eq(
  $$ select member_id, kind, reason, task_points, threshold_used
       from public.retention_signals where role_evaluation_id = pg_temp.run5810('ag1') $$,
  $$ values (pg_temp.r58('J'), 'adunarea_generala'::text, 'below_floor'::text, 5, 10) $$,
  'the Adunarea Generală run stores its own Signal: J below the Floor');
select is(
  (select count(*) from public.retention_signals
    where role_evaluation_id = pg_temp.run5810('s1') and closed_at is null),
  4::bigint,
  'an Adunarea Generală run leaves the Voluntar Activ run''s Signals open: a run supersedes only its own kind');

-- ==================== 4. The live Universitate Signal ====================
-- K is a voter whose Universitate nobody has entered yet, as every voter's is
-- until the backfill (Review Focus 1). Written by insert, which no refresh
-- follows.

insert into auth.users (id, email) values (pg_temp.r58x('K'), 'k-r58x@test.local');
insert into public.profiles (id, full_name, email, role, status, joined_at, university) values
  (pg_temp.r58x('K'), 'Vot K R58', 'k-r58x@test.local', 'vot', 'activ', '2024-01-01', null);

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
update public.profiles set university = null where id = pg_temp.r58('I');
reset role;
select is((select count(*) from pg_temp.live5810(pg_temp.r58('I'))), 0::bigint,
  'Review Focus 1: setting a voter''s Universitate to null opens nothing -- unknown is not "not UBB"');
select is((select count(*) from pg_temp.live5810(pg_temp.r58x('K'))), 0::bigint,
  'Review Focus 1: a voter whose Universitate was never known has no live Signal');
select results_eq(
  $$ select kind, role_at_listing, reason, open from pg_temp.live5810(pg_temp.r58('J')) $$,
  $$ values ('adunarea_generala'::text, 'vot'::public.member_role, 'not_ubb_student'::text, true) $$,
  'the refresh reads every voter: J, provisioned at another university, holds one open live Signal after the first write');

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
update public.profiles set university = 'Universitatea Tehnică din Cluj-Napoca' where id = pg_temp.r58('I');
reset role;
select results_eq(
  $$ select * from pg_temp.live5810(pg_temp.r58('I')) $$,
  $$ values ('adunarea_generala'::text, 'vot'::public.member_role, 'not_ubb_student'::text, null::int, null::int,
             null::bigint, null::text, true) $$,
  'BC sets a voter''s Universitate to another university: one open live Signal -- Adunarea Generală kind, no run, no numbers');
select is(
  (select array_agg(member_id order by member_id) from public.notifications
    where dedupe_key = 'retention_signal:live:' || pg_temp.r58('I')),
  (select signal_recipients from fx5810),
  'one Notification to each of the run''s Signal recipients: BC, the Moderator and the Adunarea Generală''s Responsibles at level 5 or above');
select is(
  (select bool_and(subject = 'retention_signal:' || pg_temp.r58('I')
                   and link = '/tracker/membru/' || pg_temp.r58('I'))
     from public.notifications
    where dedupe_key = 'retention_signal:live:' || pg_temp.r58('I')),
  true,
  'each is about retention_signal:<member> and links the Member''s tracker page');
select results_eq(
  $$ select title, body from public.notifications
      where member_id = pg_temp.r58('BC') and dedupe_key = 'retention_signal:live:' || pg_temp.r58('I') $$,
  $$ values ('Semnal de retenție: Vot I R58'::text,
             'Vot I R58 nu mai este student UBB (Universitatea Tehnică din Cluj-Napoca). Drept de Vot cere '
             || 'calitatea de student UBB; rolul nu se retrage automat: decizia îi aparține BC.') $$,
  'the Notification names the voter and the university, and that nothing is withdrawn automatically');

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
update public.profiles set university = 'Universitatea de Medicină și Farmacie' where id = pg_temp.r58('I');
reset role;
select results_eq(
  $$ select (select count(*) from pg_temp.live5810(pg_temp.r58('I'))),
            (select body like '%(Universitatea Tehnică din Cluj-Napoca).%' from public.notifications
              where member_id = pg_temp.r58('BC') and dedupe_key = 'retention_signal:live:' || pg_temp.r58('I')) $$,
  $$ values (1::bigint, true) $$,
  'a second change to another university opens no second row and sends nothing again');

-- Both kinds' runs, with I's and J's live Signals open.
select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select lives_ok(
  $$ insert into runs5810 select 's2', * from public.run_role_evaluation(
       'voluntar_activ', '2026-03-01', '2026-09-30', 'Evaluare semnale S2', 10, 35, '2026-03-01') $$,
  'BC runs the Voluntar Activ kind again');
select lives_ok(
  $$ insert into runs5810 select 'ag2', * from public.run_role_evaluation(
       'adunarea_generala', '2026-03-01', '2026-09-30', 'Evaluare semnale AG2', 10, 25) $$,
  'and the Adunarea Generală kind again');
reset role;
select is(
  (select array_agg(member_id order by member_id) from public.retention_signals
    where reason = 'not_ubb_student' and closed_at is null),
  array[pg_temp.r58('I'), pg_temp.r58('J')],
  'neither kind''s run supersedes a live Universitate Signal: I''s and J''s stay open');

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
update public.profiles set university = 'Universitatea Babeș-Bolyai' where id = pg_temp.r58('I');
reset role;
select results_eq(
  $$ select closed_as, open from pg_temp.live5810(pg_temp.r58('I')) $$,
  $$ values ('resolved'::text, false) $$,
  'set back to UBB, the voter''s live Signal closes as resolved');

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select lives_ok(
  $$ select public.set_member_status(pg_temp.r58('J'), 'inactiv', 'Plecat din OSUBB R58') $$,
  'BC deactivates J');
reset role;
select results_eq(
  $$ select closed_as, open from pg_temp.live5810(pg_temp.r58('J')) $$,
  $$ values ('resolved'::text, false) $$,
  'a voter no longer active: the live Signal closes as resolved');
select is(
  (select count(*) from public.retention_signals
    where member_id = pg_temp.r58('J') and role_evaluation_id is not null and closed_at is null),
  2::bigint,
  'a status change is not a Role change: J''s two run Signals (one per kind) stay open');

-- ==================== 5. A Role change closes every open row ====================

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
update public.profiles set university = 'Universitatea Tehnică din Cluj-Napoca' where id = pg_temp.r58('I');
select lives_ok(
  $$ select public.set_member_role(pg_temp.r58('I'), 'activ', 'Fără Drept de Vot R58') $$,
  'BC withdraws I''s Drept de Vot, who held a run Signal and a live one');
reset role;
select results_eq(
  $$ select kind || ':' || reason, closed_as
       from public.retention_signals
      where member_id = pg_temp.r58('I')
        and (role_evaluation_id = pg_temp.run5810('s2') or (reason = 'not_ubb_student' and closed_as <> 'resolved'))
      order by kind $$,
  $$ values ('adunarea_generala:not_ubb_student'::text, 'role_changed'::text),
            ('voluntar_activ:below_line', 'role_changed') $$,
  'the Role change closes every open Signal of the Member, of either kind and either reason, as role_changed');
select is(
  (select count(*) from public.retention_signals where member_id = pg_temp.r58('I') and closed_at is null),
  0::bigint, 'and leaves none of theirs open');
select is(
  (select closed_at is null from public.retention_signals
    where member_id = pg_temp.r58('H') and role_evaluation_id = pg_temp.run5810('s2')),
  true, 'another Member''s Signal stays open');

-- ==================== 6. The live Promotion Candidates ====================
-- The latest Voluntar Activ run (S2) ended 2026-09-30, so the window opens on
-- 2026-10-01; its cutoff, 2026-03-01, is the one in force.

insert into auth.users (id, email) values
  (pg_temp.r58x('L'), 'l-r58x@test.local'), (pg_temp.r58x('M'), 'm-r58x@test.local');
insert into public.profiles (id, full_name, email, role, status, joined_at) values
  (pg_temp.r58x('L'), 'Voluntar L R58', 'l-r58x@test.local', 'voluntar', 'activ', '2026-02-01'),
  (pg_temp.r58x('M'), 'Voluntar M R58', 'm-r58x@test.local', 'voluntar', 'activ', '2026-02-01');

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select lives_ok($$ select public.set_promotion_threshold('voluntar_activ', 20) $$,
  'BC sets the Voluntar Activ Promotion Threshold to 20');
reset role;

-- 5 first, then 20: each award refreshes the list, and only the second
-- reaches the line.
select pg_temp.r58_credit(pg_temp.r58x('L'), 5, 3, now());
select pg_temp.r58_credit(pg_temp.r58x('L'), 10, 3, now());
select results_eq(
  $$ select * from pg_temp.open5810(pg_temp.r58x('L')) $$,
  $$ values (null::bigint, 25, '2026-02-01'::date, 20) $$,
  'a Voluntar who joined 2026-02-01, on or before the cutoff 2026-03-01, at 25 of 20 is listed live -- tenure_since is the join date');
select results_eq(
  $$ select body, link from public.notifications
      where member_id = pg_temp.r58('BC') and dedupe_key = 'promotion_candidate:live:' || pg_temp.r58x('L') $$,
  $$ values ('Voluntar L R58 are 25 puncte de task de la ultima evaluare Voluntar Activ (din 01.10.2026), '
             || 'cel puțin pragul de promovare de 20 puncte, intrat în OSUBB până la 01.03.2026. Nu este promovat '
             || 'automat: îl poți promova în Voluntar Activ din panoul de roluri sau respinge din Portofoliu Interne.',
             '/administrare/portofoliu-interne') $$,
  'the live Candidate''s Notification names the line and the cutoff -- never a tenure -- and links Portofoliu Interne');

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select 1 from public.set_membership_cutoff('2026-01-15');
reset role;
select results_eq(
  $$ select count(*) filter (where decision is null),
            count(*) filter (where decision = 'superseded' and decided_by is null)
       from public.promotion_candidates where member_id = pg_temp.r58x('L') $$,
  $$ values (0::bigint, 1::bigint) $$,
  'Review Focus 4: moving the cutoff before the Voluntar''s join date supersedes the live row at once, by nobody');

select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select 1 from public.set_membership_cutoff('2026-03-01');
reset role;
select results_eq(
  $$ select * from pg_temp.open5810(pg_temp.r58x('L')) $$,
  $$ values (null::bigint, 25, '2026-02-01'::date, 20) $$,
  'Review Focus 4: moving it back lists them again');

-- Ruling 17: the window opens no earlier than the Points Start Date.
select pg_temp.test_login_leadership(pg_temp.r58('BC'));
select 1 from public.set_points_start_date('2026-10-10');
reset role;
select pg_temp.r58_credit(pg_temp.r58x('M'), 10, 3, '2026-10-05 12:00:00+03');
select pg_temp.r58_credit(pg_temp.r58x('M'), 5, 3, '2026-10-05 12:00:00+03');
select is((select count(*) from public.promotion_candidates where member_id = pg_temp.r58x('M')), 0::bigint,
  'Ruling 17: points earned before the Points Start Date do not list a Voluntar, though they fall after the last run');
select pg_temp.r58_credit(pg_temp.r58x('M'), 10, 3, now());
select results_eq(
  $$ select * from pg_temp.open5810(pg_temp.r58x('M')) $$,
  $$ values (null::bigint, 20, '2026-02-01'::date, 20) $$,
  'Ruling 17: their points from the Points Start Date on list them once they reach the line -- 20, not 45');
select is(
  (select body from public.notifications
    where member_id = pg_temp.r58('BC') and dedupe_key = 'promotion_candidate:live:' || pg_temp.r58x('M')),
  'Voluntar M R58 are 20 puncte de task de la 10.10.2026, cel puțin pragul de promovare de 20 puncte, '
  || 'intrat în OSUBB până la 01.03.2026. Nu este promovat automat: îl poți promova în Voluntar Activ din '
  || 'panoul de roluri sau respinge din Portofoliu Interne.',
  'when the Points Start Date opened the window, the Notification counts from that date');
select is((select task_points from pg_temp.open5810(pg_temp.r58x('L'))), 25,
  'a Voluntar whose points all fall after the Points Start Date stays listed');

-- ==================== 7. The drops ====================

select hasnt_table('public', 'promotion_rules', 'public.promotion_rules is gone: no Promotion Rule remains');
select hasnt_function('private', 'apply_promotions', 'the daily Recrut -> Voluntar job body is gone');
select hasnt_function('private', 'apply_promotion', 'its one-row core is gone');
select hasnt_function('private', 'detect_promotions', 'its detection is gone');
select hasnt_function('public', 'update_promotion_rule', 'the Promotion Rule command is gone');
select hasnt_function('private', 'update_promotion_rule_impl', 'and its body');
select is((select count(*) from cron.job where jobname = 'osubb-apply-promotions'), 0::bigint,
  'no job osubb-apply-promotions is scheduled: nothing promotes by the calendar');
select col_type_is('public', 'promotion_threshold_changes', 'promotion_rule_id', 'bigint',
  'the change log keeps promotion_rule_id, a plain bigint, for its tenure and on/off history');
select lives_ok(
  $$ insert into public.promotion_threshold_changes (field, from_value, to_value, source, changed_by, promotion_rule_id)
     values ('tenure', 6, 3, 'manual', pg_temp.r58('BC'), 987654321) $$,
  'a tenure row naming the id of a rule no table holds is still valid history: the foreign key is gone');
select has_trigger('public', 'evaluation_settings', 'evaluation_settings_refresh_promotion_candidates',
  'a write of the evaluation settings refreshes the live Promotion Candidates');
select is(
  (select coalesce(array_agg(p.oid::regprocedure::text order by 1), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ~ 'promotion_rules|min_tenure_months|/administrare/evaluari'),
  '{}'::text[],
  'no function in public or private reads a Promotion Rule, a tenure or links the retired page');

select * from finish();
rollback;
