-- #1098 (ruling R63): an Event may be Toată ziua. It is stored from 00:00
-- Bucharest on its first day to 00:00 Bucharest after its last day (end
-- exclusive); events_all_day_bounds_ck and create_event / update_event hold
-- that, and every reader that prints an Event's time names no hour for it.
-- Fixed days: Tuesday 12 November 2030 (EET, UTC+2); the DST changes of
-- Sunday 25 October 2026 and Sunday 28 March 2027.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(44);

create function pg_temp.u98(n integer) returns uuid language sql immutable as $$
  select ('10980000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users(id, email)
select pg_temp.u98(n), 'allday.' || n || '.1098@test.local' from generate_series(1, 5) n;
insert into profiles(id, full_name, email, role, status)
select pg_temp.u98(n), 'Toată ziua #1098 ' || n, 'allday.' || n || '.1098@test.local', (case n when 4 then 'bce' when 5 then 'bc' else 'voluntar' end)::public.member_role, 'activ'
  from generate_series(1, 5) n;
insert into groups(name, category, min_level) values ('Toată ziua #1098', 'team', 0);
insert into group_members(group_id, member_id, group_role)
select grp.id, pg_temp.u98(roster.n), roster.role
  from (values (1, 'responsible'), (2, 'member'), (3, 'member'), (4, 'manager')) as roster(n, role)
 cross join groups as grp
 where grp.name = 'Toată ziua #1098';

create function pg_temp.grp() returns bigint language sql stable as $$
  select id from public.groups where name = 'Toată ziua #1098'
$$;
grant execute on function pg_temp.grp() to authenticated;
-- A Bucharest midnight: the wall-clock day, read in Romania.
create function pg_temp.midnight(p_day date) returns timestamptz language sql immutable as $$
  select (p_day::timestamp) at time zone 'Europe/Bucharest'
$$;
grant execute on function pg_temp.midnight(date) to authenticated;
create function pg_temp.login() returns void language sql as $$
  select pg_temp.test_login(pg_temp.u98(1), '{"member_role":"voluntar","member_level":1}'::jsonb)
$$;
create function pg_temp.body(p_member integer, p_title text) returns text language sql stable as $$
  select body from public.notifications where member_id = pg_temp.u98(p_member) and title = p_title
   order by created_at desc, id desc limit 1
$$;

-- ==================== The column and its constraint ====================
select col_not_null('public', 'events', 'all_day', 'events.all_day is not null');
select col_default_is('public', 'events', 'all_day', 'false', 'an Event is timed unless it says otherwise');

insert into public.events(title, type, group_id, starts_at, ends_at)
values ('Timed #1098', 'sedinta', pg_temp.grp(), '2030-11-12 18:00+02', '2030-11-12 20:00+02');
select is((select all_day from public.events where title = 'Timed #1098'), false,
          'a row that names no all_day is timed (existing rows default to false)');

select throws_ok(
  $$ insert into public.events(title, type, group_id, starts_at, ends_at, all_day)
     values ('No end #1098', 'eveniment', pg_temp.grp(), pg_temp.midnight('2030-11-15'), null, true) $$,
  '23514', 'new row for relation "events" violates check constraint "events_all_day_bounds_ck"',
  'an all-day Event needs an end');
select throws_ok(
  $$ insert into public.events(title, type, group_id, starts_at, ends_at, all_day)
     values ('Noon #1098', 'eveniment', pg_temp.grp(), '2030-11-15 12:00+02', pg_temp.midnight('2030-11-16'), true) $$,
  '23514', 'new row for relation "events" violates check constraint "events_all_day_bounds_ck"',
  'an all-day Event starts at a Bucharest midnight');
select throws_ok(
  $$ insert into public.events(title, type, group_id, starts_at, ends_at, all_day)
     values ('Late end #1098', 'eveniment', pg_temp.grp(), pg_temp.midnight('2030-11-15'), '2030-11-16 14:00+02', true) $$,
  '23514', 'new row for relation "events" violates check constraint "events_all_day_bounds_ck"',
  'an all-day Event ends at a Bucharest midnight');
select throws_ok(
  $$ insert into public.events(title, type, group_id, starts_at, ends_at, all_day)
     values ('UTC #1098', 'eveniment', pg_temp.grp(), '2030-11-15 00:00+00', '2030-11-16 00:00+00', true) $$,
  '23514', 'new row for relation "events" violates check constraint "events_all_day_bounds_ck"',
  'midnight is Romania''s, not UTC''s');
-- The end of summer time: 24-26 October 2026 holds a 25-hour day.
select lives_ok(
  $$ insert into public.events(title, type, group_id, starts_at, ends_at, all_day)
     values ('October DST #1098', 'eveniment', pg_temp.grp(), pg_temp.midnight('2026-10-24'), pg_temp.midnight('2026-10-26'), true) $$,
  'an all-day Event across the end of summer time keeps Bucharest midnights');
select is((select ends_at - starts_at from public.events where title = 'October DST #1098'), interval '49 hours',
          'its two days last 49 hours');
-- The start of summer time: 28 March 2027 has 23 hours.
select lives_ok(
  $$ insert into public.events(title, type, group_id, starts_at, ends_at, all_day)
     values ('March DST #1098', 'eveniment', pg_temp.grp(), pg_temp.midnight('2027-03-28'), pg_temp.midnight('2027-03-29'), true) $$,
  'an all-day Event on the first day of summer time keeps Bucharest midnights');
select is((select ends_at - starts_at from public.events where title = 'March DST #1098'), interval '23 hours',
          'that day lasts 23 hours');

-- ==================== create_event(p_all_day) ====================
select pg_temp.login();
select lives_ok(
  $$ select public.create_event(p_title => 'Weekend #1098', p_type => 'eveniment', p_group_id => pg_temp.grp(),
       p_starts_at => pg_temp.midnight('2030-11-15'), p_ends_at => pg_temp.midnight('2030-11-18'),
       p_location => 'Cluj', p_all_day => true) $$,
  'create_event stores an all-day Event');
select pg_temp.test_clear_jwt();
reset role;
select ok((select all_day from public.events where title = 'Weekend #1098'), 'its all_day is true');
select is(pg_temp.body(2, 'Eveniment nou: Weekend #1098'),
          'Vineri, 15 noiembrie 2030 – duminică, 17 noiembrie 2030, toată ziua · Cluj',
          'its Eveniment nou names its days and no hour');
select is(private.event_announcement_body(pg_temp.midnight('2030-11-15'), pg_temp.midnight('2030-11-16'), null, null, true),
          'Vineri, 15 noiembrie 2030, toată ziua',
          'a one-day all-day Event is its day and "toată ziua"');
select is(private.event_announcement_body(pg_temp.midnight('2030-11-15'), pg_temp.midnight('2030-11-16'), null, null),
          'Vineri, 15 noiembrie 2030, 00:00 – sâmbătă, 16 noiembrie 2030, 00:00',
          'the same bounds without p_all_day keep their times');

select pg_temp.login();
select throws_ok(
  $$ select public.create_event(p_title => 'No end #1098', p_type => 'eveniment', p_group_id => pg_temp.grp(),
       p_starts_at => pg_temp.midnight('2030-11-15'), p_all_day => true) $$,
  'PT400', 'invalid_all_day_bounds', 'create_event refuses an all-day Event without an end');
select throws_ok(
  $$ select public.create_event(p_title => 'Evening #1098', p_type => 'eveniment', p_group_id => pg_temp.grp(),
       p_starts_at => '2030-11-15 18:00+02', p_ends_at => pg_temp.midnight('2030-11-17'), p_all_day => true) $$,
  'PT400', 'invalid_all_day_bounds', 'create_event refuses an all-day start that is not a midnight');
select throws_ok(
  $$ select public.create_event(p_title => 'Afternoon #1098', p_type => 'eveniment', p_group_id => pg_temp.grp(),
       p_starts_at => pg_temp.midnight('2030-11-15'), p_ends_at => '2030-11-16 14:00+02', p_all_day => true) $$,
  'PT400', 'invalid_all_day_bounds', 'create_event refuses an all-day end that is not a midnight');
select throws_ok(
  $$ select public.create_event(p_title => 'Backwards #1098', p_type => 'eveniment', p_group_id => pg_temp.grp(),
       p_starts_at => pg_temp.midnight('2030-11-15'), p_ends_at => pg_temp.midnight('2030-11-15'), p_all_day => true) $$,
  'PT400', 'invalid_event_interval', 'an all-day end at or before its start is an interval error');
-- Today's all-day Event started at midnight, and may still be created.
select lives_ok(
  $$ select public.create_event(p_title => 'Today #1098', p_type => 'eveniment', p_group_id => pg_temp.grp(),
       p_starts_at => pg_temp.midnight((now() at time zone 'Europe/Bucharest')::date),
       p_ends_at => pg_temp.midnight((now() at time zone 'Europe/Bucharest')::date + 1), p_all_day => true) $$,
  'an all-day Event of today is not in the past');
select throws_ok(
  $$ select public.create_event(p_title => 'Yesterday #1098', p_type => 'eveniment', p_group_id => pg_temp.grp(),
       p_starts_at => pg_temp.midnight((now() at time zone 'Europe/Bucharest')::date - 1),
       p_ends_at => pg_temp.midnight((now() at time zone 'Europe/Bucharest')::date + 1), p_all_day => true) $$,
  'PT400', 'starts_at_in_past', 'an all-day Event that began yesterday is');
select throws_ok(
  $$ select public.create_event(p_title => 'Midnight timed #1098', p_type => 'eveniment', p_group_id => pg_temp.grp(),
       p_starts_at => pg_temp.midnight((now() at time zone 'Europe/Bucharest')::date),
       p_ends_at => pg_temp.midnight((now() at time zone 'Europe/Bucharest')::date + 1)) $$,
  'PT400', 'starts_at_in_past', 'a timed Event at today''s midnight is still judged by the instant');
select pg_temp.test_clear_jwt();
reset role;

-- ==================== update_event(p_all_day) ====================
insert into public.event_attendance(event_id, member_id, status)
select id, pg_temp.u98(3), 'going' from public.events where title = 'Timed #1098';
select pg_temp.login();
select lives_ok(
  $$ select public.update_event((select id from public.events where title = 'Timed #1098'),
       'Timed #1098', 'sedinta', pg_temp.grp(), pg_temp.midnight('2030-11-15'), pg_temp.midnight('2030-11-18'),
       null, null, null, 0, null, true) $$,
  'update_event makes a timed Event all-day');
select pg_temp.test_clear_jwt();
reset role;
select ok((select all_day from public.events where title = 'Timed #1098'), 'its all_day is now true');
select is(pg_temp.body(3, 'Eveniment actualizat: Timed #1098'),
          'Modificat: programare. Programare: 15.11.2030 - 17.11.2030, toată ziua',
          'the edit notice gives its days and no hour');

select pg_temp.login();
select lives_ok(
  $$ select public.update_event((select id from public.events where title = 'Timed #1098'),
       'Timed #1098', 'sedinta', pg_temp.grp(), pg_temp.midnight('2030-11-15'), pg_temp.midnight('2030-11-18'),
       null, null, null, 0, null, false) $$,
  'unticking Toată ziua keeps the bounds as exact times');
select pg_temp.test_clear_jwt();
reset role;
select is(pg_temp.body(3, 'Eveniment actualizat: Timed #1098'),
          'Modificat: programare. Programare: 15.11.2030 00:00 - 18.11.2030 00:00',
          'the switch alone is a schedule change, and the notice gives the times again');

select pg_temp.login();
select throws_ok(
  $$ select public.update_event((select id from public.events where title = 'Timed #1098'),
       'Timed #1098', 'sedinta', pg_temp.grp(), '2030-11-15 18:00+02', pg_temp.midnight('2030-11-18'),
       null, null, null, 0, null, true) $$,
  'PT400', 'invalid_all_day_bounds', 'update_event refuses all-day bounds that are not midnights');
select throws_ok(
  $$ select public.update_event((select id from public.events where title = 'Timed #1098'),
       'Timed #1098', 'sedinta', pg_temp.grp(), pg_temp.midnight('2030-11-15'), null,
       null, null, null, 0, null, true) $$,
  'PT400', 'invalid_all_day_bounds', 'update_event refuses an all-day Event without an end');
select pg_temp.test_clear_jwt();
reset role;

-- A client from before #1098 sends no p_all_day: the Event keeps its own.
insert into public.events(title, type, group_id, starts_at, ends_at, all_day) values
  ('Keep #1098', 'eveniment', pg_temp.grp(), pg_temp.midnight('2030-11-20'), pg_temp.midnight('2030-11-22'), true);
select pg_temp.login();
select lives_ok(
  $$ select public.update_event((select id from public.events where title = 'Keep #1098'),
       'Keep #1098 nou', 'eveniment', pg_temp.grp(), pg_temp.midnight('2030-11-20'), pg_temp.midnight('2030-11-22'),
       null, null, null, 0, null) $$,
  'update_event without p_all_day takes an edit of an all-day Event');
select pg_temp.test_clear_jwt();
reset role;
select ok((select all_day from public.events where title = 'Keep #1098 nou'),
          'an edit that names no p_all_day keeps the Event all-day');
select pg_temp.login();
select throws_ok(
  $$ select public.update_event((select id from public.events where title = 'Keep #1098 nou'),
       'Keep #1098 nou', 'eveniment', pg_temp.grp(), '2030-11-20 18:00+02', pg_temp.midnight('2030-11-22'),
       null, null, null, 0, null) $$,
  'PT400', 'invalid_all_day_bounds',
  'a kept all-day Event still answers to all-day bounds');
select lives_ok(
  $$ select public.update_event((select id from public.events where title = 'Keep #1098 nou'),
       'Keep #1098 nou', 'eveniment', pg_temp.grp(), '2030-11-20 18:00+02', pg_temp.midnight('2030-11-22'),
       null, null, null, 0, null, false) $$,
  'an explicit p_all_day false takes exact times');
select pg_temp.test_clear_jwt();
reset role;
select is((select all_day from public.events where title = 'Keep #1098 nou'), false,
          'an explicit false turns Toată ziua off');

-- ==================== The reminder ====================
-- Wednesday 13 November 2030, two days; a one-day one on the same Wednesday.
insert into public.events(title, type, group_id, starts_at, ends_at, all_day, location) values
  ('Trip #1098', 'eveniment', pg_temp.grp(), pg_temp.midnight('2030-11-13'), pg_temp.midnight('2030-11-15'), true, 'Cluj'),
  ('Day #1098', 'eveniment', pg_temp.grp(), pg_temp.midnight('2030-11-13'), pg_temp.midnight('2030-11-14'), true, null);
insert into public.event_attendance(event_id, member_id, status)
select id, pg_temp.u98(2), 'going' from public.events where title in ('Trip #1098', 'Day #1098');
select cmp_ok(private.send_reminders('2030-11-12 07:30+00'), '>', 0, '09:30 in Bucharest the day before: reminders go out');
select is(pg_temp.body(2, 'Mâine: Trip #1098'), 'Toată ziua, până la 14.11.2030, Cluj.',
          'a several-day all-day Event''s reminder names its last day, no hour');
select is(pg_temp.body(2, 'Mâine: Day #1098'), 'Toată ziua.',
          'a one-day all-day Event''s reminder says "Toată ziua"');

-- ==================== The Announcement of an all-day Event ====================
-- It lasts its whole days from a midnight, so its Announcement has no Termen
-- (a timed Event's is its start), whether published at once or at approval.
select pg_temp.login();
select lives_ok(
  $$ select public.create_event(p_title => 'Anunț zi #1098', p_type => 'eveniment', p_group_id => pg_temp.grp(),
       p_starts_at => pg_temp.midnight('2030-12-05'), p_ends_at => pg_temp.midnight('2030-12-07'),
       p_all_day => true, p_announce => true) $$,
  'an all-day Event publishes its Announcement');
select pg_temp.test_clear_jwt();
reset role;
select is((select count(*)::int from public.announcements where title = 'Anunț zi #1098' and deadline is null), 1,
          'which has no Termen');
select pg_temp.test_login_leadership(pg_temp.u98(4));
select lives_ok(
  $$ select public.create_event(p_title => 'Cerere zi #1098', p_type => 'eveniment',
       p_group_id => (select id from public.groups where is_organization),
       p_starts_at => pg_temp.midnight('2030-12-12'), p_ends_at => pg_temp.midnight('2030-12-14'),
       p_all_day => true, p_announce => true) $$,
  'a BCE asks for an OSUBB-wide all-day Event with its Announcement');
reset role;
select is((select approval_status from public.events where title = 'Cerere zi #1098'), 'pending',
          'it waits for BC');
select pg_temp.test_login_leadership(pg_temp.u98(5));
select lives_ok(
  $$ select public.approve_event((select id from public.events where title = 'Cerere zi #1098')) $$,
  'BC approves it');
reset role;
select is((select count(*)::int from public.announcements where title = 'Cerere zi #1098' and deadline is null), 1,
          'its Announcement, written at the approval, has no Termen');

select * from finish();
rollback;
