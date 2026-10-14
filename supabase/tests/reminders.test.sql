-- Ruling R53 (Alex, 2026-10-14): reminders at 09:00 Bucharest time. A Task's
-- Executor three days and one day before its deadline (only the day before
-- with less than three days left); everyone going to an Event the day before;
-- everyone an Announcement reached, Deals included, the day before its
-- Termen. private.send_reminders replaces #69's private.remind_deadlines.
-- Spec docs/superpowers/specs/2026-10-14-edit-notices-and-reminders-design.md.
--
-- The job takes the time as an input, so this suite replays fixed days:
-- Tuesday 10 November 2026 (EET, UTC+2), and the end of daylight saving on
-- Sunday 25 October 2026 (EEST UTC+3 until then).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(44);

-- #69: a second scheduler session waits for the same advisory lock before it
-- reads anything; both remote transactions roll back.
select extensions.dblink_connect('reminder_lock',
  'host=db.supabase.internal port=5432 dbname=postgres user=postgres password=postgres');
select extensions.dblink_connect('reminder_retry',
  'host=db.supabase.internal port=5432 dbname=postgres user=postgres password=postgres');
select extensions.dblink_exec('reminder_lock',
  'begin; do $lock$ begin perform pg_catalog.pg_advisory_xact_lock(69, 1); end $lock$;');
select extensions.dblink_exec('reminder_retry', 'begin; set local lock_timeout = ''250ms'';');
select throws_ok(
  $$select * from extensions.dblink('reminder_retry',
      'select private.send_reminders(''2026-11-10 07:30+00'')') as result(notifications integer)$$,
  '55P03', 'canceling statement due to lock timeout',
  'concurrent runs serialize on the advisory lock');
select extensions.dblink_exec('reminder_retry', 'rollback;');
select extensions.dblink_exec('reminder_lock', 'rollback;');
select extensions.dblink_disconnect('reminder_retry');
select extensions.dblink_disconnect('reminder_lock');

create function pg_temp.u62(n integer) returns uuid language sql immutable as $$
  select ('62000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users(id, email)
select pg_temp.u62(n), 'remind.' || n || '.62@test.local' from generate_series(1, 6) n;
insert into profiles(id, full_name, email, role, status)
select pg_temp.u62(n), 'Remind #62 ' || n, 'remind.' || n || '.62@test.local',
       (case n when 4 then 'bc' else 'voluntar' end)::member_role,
       (case n when 6 then 'inactiv' else 'activ' end)::member_status
  from generate_series(1, 6) n;
insert into groups(name, category, min_level) values ('Rem #62', 'team', 0);
insert into group_members(group_id, member_id, group_role)
select grp.id, pg_temp.u62(roster.n), roster.role
  from (values (5, 'responsible'), (1, 'member'), (2, 'member'), (3, 'member'), (6, 'member')) as roster(n, role)
 cross join groups as grp
 where grp.name = 'Rem #62';

create function pg_temp.rem() returns bigint language sql stable as $$
  select id from groups where name = 'Rem #62'
$$;
create function pg_temp.got(p_member integer, p_title text) returns integer language sql stable as $$
  select count(*)::int from notifications where member_id = pg_temp.u62(p_member) and title = p_title
$$;
create function pg_temp.got_any(p_title text) returns integer language sql stable as $$
  select count(*)::int from notifications where member_id::text like '62000000-%' and title = p_title
$$;

-- 10 November 2026, 09:30 in Bucharest (EET): 07:30 UTC.
create function pg_temp.at9() returns timestamptz language sql immutable as $$ select '2026-11-10 07:30+00'::timestamptz $$;

-- ==================== Tasks ====================
insert into tasks (title, group_id, deadline, status, kind) values
  ('Three days #62',    pg_temp.rem(), '2026-11-13 18:00+02', 'todo',        'task'),
  ('Tomorrow #62',      pg_temp.rem(), '2026-11-11 10:00+02', 'in_progress', 'task'),
  ('Two days #62',      pg_temp.rem(), '2026-11-12 12:00+02', 'todo',        'task'),
  ('Today #62',         pg_temp.rem(), '2026-11-10 20:00+02', 'todo',        'task'),
  ('Review #62',        pg_temp.rem(), '2026-11-11 10:00+02', 'todo',        'task'),
  ('Nobody #62',        pg_temp.rem(), '2026-11-11 10:00+02', 'todo',        'task'),
  ('Inactive #62',      pg_temp.rem(), '2026-11-11 10:00+02', 'todo',        'task'),
  ('Past executor #62', pg_temp.rem(), '2026-11-11 10:00+02', 'todo',        'task'),
  ('Summer #62',        pg_temp.rem(), '2026-10-25 12:00+02', 'todo',        'task'),
  ('Winter #62',        pg_temp.rem(), '2026-10-27 12:00+02', 'todo',        'task');
update tasks set status = 'in_review', submitted_at = now() where title = 'Review #62';
insert into task_assignments (task_id, member_id)
select id, case title when 'Inactive #62' then pg_temp.u62(6)
                      when 'Past executor #62' then pg_temp.u62(3)
                      else pg_temp.u62(1) end
  from tasks where title like '% #62' and title <> 'Nobody #62';
insert into task_assignments (task_id, member_id, ended_at, end_reason, end_note)
select id, pg_temp.u62(2), now(), 'gave_up', 'Reassigned' from tasks where title = 'Past executor #62';

-- ==================== Events ====================
insert into events (title, type, group_id, starts_at, location, created_by) values
  ('Event tomorrow #62',  'sedinta', pg_temp.rem(), '2026-11-11 18:00+02', 'Sala A', pg_temp.u62(5)),
  ('Event cancelled #62', 'sedinta', pg_temp.rem(), '2026-11-11 18:00+02', null,     pg_temp.u62(5)),
  ('Event later #62',     'sedinta', pg_temp.rem(), '2026-11-12 18:00+02', null,     pg_temp.u62(5));
update events set cancelled_at = now(), cancel_reason = 'Nu mai are loc' where title = 'Event cancelled #62';
insert into event_attendance (event_id, member_id, status)
select event.id, pg_temp.u62(answer.n), answer.status
  from events as event
 cross join (values (2, 'going'), (3, 'declined')) as answer(n, status)
 where event.title in ('Event tomorrow #62', 'Event cancelled #62', 'Event later #62');

-- ==================== Announcements ====================
insert into announcements (title, body, group_id, audience, deadline, priority, created_by) values
  ('Termen #62',   'Body', pg_temp.rem(), 'local', '2026-11-11 12:00+02', 'normal',   pg_temp.u62(5)),
  ('Critical #62', 'Body', pg_temp.rem(), 'local', '2026-11-11 12:00+02', 'critical', pg_temp.u62(5)),
  ('Later #62',    'Body', pg_temp.rem(), 'local', '2026-11-12 12:00+02', 'normal',   pg_temp.u62(5));
insert into announcements (title, body, group_id, audience, kind, deadline, created_by)
select 'Deal #62', 'Body', id, 'org', 'deal', '2026-11-11 23:00+02', pg_temp.u62(4) from groups where is_organization;
-- Member 3 was told of the Termen announcement on the very day (its notice
-- is still fresh then).
update notifications set created_at = '2026-11-10 08:00+02'
 where member_id = pg_temp.u62(3) and title = 'Anunț nou: Termen #62';
-- An Event's own Announcement, written by create_event.
select pg_temp.test_login_leadership(pg_temp.u62(5));
select public.create_event('Event announced #62', 'sedinta', pg_temp.rem(), '2026-11-11 17:00+02',
  null, null, null, null, 0, null, true);
reset role;
select is((select event_id from announcements where title = 'Event announced #62'),
          (select id from events where title = 'Event announced #62'),
  'create_event''s Announcement records the Event it was written for');

-- ==================== The job ====================
select is(private.send_reminders('2026-11-10 06:30+00'), 0, '08:30 in Bucharest: nothing yet');
select is(private.send_reminders('2026-11-10 08:30+00'), 0, '10:30 in Bucharest: the hour has passed');
select cmp_ok(private.send_reminders(pg_temp.at9()), '>', 0, '09:30 in Bucharest: the reminders go out');

select is(pg_temp.got(1, 'Mai sunt 3 zile: Three days #62'), 1, 'the Executor hears three days before the deadline');
select is(pg_temp.got(1, 'Termenul e mâine: Tomorrow #62'), 1, 'and the day before');
select ok((select bool_and(kind = 'deadline' and body = 'Termen: 11.11.2026 10:00'
                           and link = '/tracker?task=' || task_id::text)
             from notifications where title = 'Termenul e mâine: Tomorrow #62'),
  'a Task reminder is a deadline notice with the deadline in Bucharest time, opening the Task');
select is(pg_temp.got_any('Termenul e mâine: Two days #62') + pg_temp.got_any('Mai sunt 3 zile: Two days #62'), 0,
  'two days before, nothing');
select is((select count(*)::int from notifications where member_id::text like '62000000-%' and title like '%: Today #62'), 0,
  'on the day itself, nothing');
select is(pg_temp.got_any('Termenul e mâine: Review #62'), 0, 'a Task handed in for review gets none');
select is(pg_temp.got_any('Termenul e mâine: Nobody #62'), 0, 'a Task nobody executes gets none');
select is(pg_temp.got_any('Termenul e mâine: Inactive #62'), 0, 'an inactive Executor gets none');
select is(pg_temp.got(3, 'Termenul e mâine: Past executor #62'), 1, 'the current Executor is reminded');
select is(pg_temp.got(2, 'Termenul e mâine: Past executor #62'), 0, 'never one who gave the Task up');

select is(pg_temp.got(2, 'Mâine: Event tomorrow #62'), 1, 'everyone going hears the day before an Event');
select ok((select bool_and(kind = 'event' and body = 'Începe la 18:00, Sala A.'
                           and link = '/calendar?event=' || (select id from events where title = 'Event tomorrow #62'))
             from notifications where title = 'Mâine: Event tomorrow #62'),
  'with its start in Bucharest time and its place, opening the Event');
select is(pg_temp.got(3, 'Mâine: Event tomorrow #62'), 0, 'not someone who declined');
select is(pg_temp.got(1, 'Mâine: Event tomorrow #62'), 0, 'nor someone who never answered');
select is(pg_temp.got_any('Mâine: Event cancelled #62'), 0, 'a cancelled Event reminds nobody');
select is(pg_temp.got_any('Mâine: Event later #62'), 0, 'two days before an Event, nothing');

select is(pg_temp.got(1, 'Termen mâine: Termen #62') + pg_temp.got(2, 'Termen mâine: Termen #62'), 2,
  'everyone the Announcement reached hears the day before its Termen');
select is(pg_temp.got(5, 'Termen mâine: Termen #62'), 0, 'never its author');
select is(pg_temp.got(3, 'Termen mâine: Termen #62'), 0, 'nor a Member told of it that same day');
select ok((select bool_and(kind = 'announce' and body = 'Termen: 11.11.2026 12:00' and not critical
                           and link = '/anunturi?anunt=' || (select id from announcements where title = 'Termen #62'))
             from notifications where title = 'Termen mâine: Termen #62'),
  'an announce notice with the Termen in Bucharest time, opening the Announcement');
select ok((select bool_and(critical) from notifications where title = 'Termen mâine: Critical #62'),
  'a critical Announcement''s reminder is critical');
select is(pg_temp.got_any('Termen mâine: Later #62'), 0, 'two days before a Termen, nothing');
select is(pg_temp.got(1, 'Oferta se încheie mâine: Deal #62'), 1, 'a Deal says the offer ends tomorrow');
select is(pg_temp.got_any('Termen mâine: Event announced #62'), 0,
  'an Event''s Announcement gets no Termen reminder: the Event reminds those going');

-- Opening the Deal clears its reminder.
insert into announcement_reads (announcement_id, member_id)
select id, pg_temp.u62(1) from announcements where title = 'Deal #62';
select ok((select read from notifications
            where member_id = pg_temp.u62(1) and title = 'Oferta se încheie mâine: Deal #62'),
  'opening the Announcement clears its reminder, a Deal''s included');
select is(private.notification_subject(null, 'announcement:3:termen:2026-11-10', '/anunturi/deals?deal=3'),
  'announcement:3', 'a Termen reminder is about its Announcement, whatever its link');
select is((select subject from notifications
            where member_id = pg_temp.u62(1) and title = 'Oferta se încheie mâine: Deal #62'),
  'announcement:' || (select id from announcements where title = 'Deal #62'),
  'so opening a Deal reads its reminder by subject too');

update notifications set read = true where member_id::text like '62000000-%';
select is(private.send_reminders(pg_temp.at9() + interval '20 minutes'), 0,
  'a second run the same day sends nothing again, read or not');

-- ==================== Daylight saving ====================
-- Saturday 24 October 2026, still EEST (UTC+3): 06:30 UTC is 09:30.
select cmp_ok(private.send_reminders('2026-10-24 06:30+00'), '>', 0, 'summer time: 06:30 UTC is 09:30 in Bucharest');
select is(pg_temp.got(1, 'Termenul e mâine: Summer #62'), 1, 'and the day-before reminder goes out');
-- Monday 26 October 2026, EET (UTC+2): 06:30 UTC is only 08:30.
select is(private.send_reminders('2026-10-26 06:30+00'), 0, 'winter time: 06:30 UTC is 08:30, nothing yet');
select is(pg_temp.got(1, 'Termenul e mâine: Winter #62'), 0, 'fixture: not yet sent');
select cmp_ok(private.send_reminders('2026-10-26 07:30+00'), '>', 0, 'winter time: 07:30 UTC is 09:30');
select is(pg_temp.got(1, 'Termenul e mâine: Winter #62'), 1, 'and the day-before reminder goes out');

-- ==================== The schedule ====================
select is((select count(*)::int from cron.job
            where jobname = 'osubb-reminders' and schedule = '5 * * * *'
              and command = 'select private.send_reminders()' and active), 1,
  'one active hourly job runs the reminders');
select is((select count(*)::int from cron.job where jobname = 'osubb-daily-deadline-reminders'), 0,
  'the 48-hour deadline job is gone');
select ok(to_regprocedure('private.remind_deadlines()') is null, 'and so is its function');
select ok(not has_function_privilege('authenticated', 'private.send_reminders(timestamptz)', 'execute')
          and not has_function_privilege('anon', 'private.send_reminders(timestamptz)', 'execute')
          and not has_function_privilege('service_role', 'private.send_reminders(timestamptz)', 'execute'),
  'no client role may run the job');

-- ==================== The Event link is the command's ====================
select pg_temp.test_login_leadership(pg_temp.u62(5));
reset role;
insert into announcements (title, body, group_id, audience, created_by, event_id)
values ('Forged link #62', 'Body', pg_temp.rem(), 'local', pg_temp.u62(5),
        (select id from events where title = 'Event tomorrow #62'));
select ok((select event_id is null from announcements where title = 'Forged link #62'),
  'a writer cannot link an Announcement to an Event');

select * from finish();
rollback;
