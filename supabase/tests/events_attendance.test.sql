-- events_attendance.test.sql — Epic 1.5a: calendar events + RSVP schema.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(15);

-- ==================== Shape ====================
select has_table('public', 'events', 'events table exists');
select has_table('public', 'event_attendance', 'event_attendance table exists');
select col_type_is('public', 'events', 'created_at', 'timestamp with time zone',
  'events record an exact creation instant');
select col_not_null('public', 'events', 'created_at',
  'event creation time is required');
select col_has_default('public', 'events', 'created_at',
  'event creation time is server-written');

select ok(
  (select relrowsecurity from pg_class
    where relname = 'events' and relnamespace = 'public'::regnamespace),
  'RLS is enabled on events');
select ok(
  (select relrowsecurity from pg_class
    where relname = 'event_attendance' and relnamespace = 'public'::regnamespace),
  'RLS is enabled on event_attendance');

-- #369: events_starts_at_idx (starts_at) became a redundant leading-column
-- prefix of the new events_starts_min_level_idx (starts_at, min_level) and
-- was dropped in its migration; the composite index still serves the
-- upcoming-events query on starts_at alone via its leading column.
select has_index('public', 'events', 'events_starts_min_level_idx',
  'events are indexed by start time (upcoming-events query)');
select has_index('public', 'event_attendance', 'event_attendance_member_idx',
  'attendance is indexed by member ("my RSVPs")');

-- ==================== Fixtures ====================
-- The demo seed fills these tables; the counts below are about this file's
-- rows. Cleared inside the transaction, which rolls back.
truncate events, event_attendance cascade;

insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-0000000000e1', 'elena.events@test.local');
insert into profiles (id, full_name, email, role) values
  ('e0000000-0000-0000-0000-0000000000e1', 'Elena Test', 'elena.events@test.local', 'voluntar');
insert into teams (id, name, dept_id) values ('t-ev', 'Events Team', 'edu');

-- ==================== An event belongs to one Group (AC; #579: the Group is its only Origin) ====================
insert into events (title, type, group_id, starts_at, ends_at)
  values ('Ședință EDU', 'sedinta', pg_temp.dept_group('edu'), now(), now() + interval '2 hours');
insert into events (title, type, group_id, starts_at)
  values ('Call Echipa Events', 'call', pg_temp.team_group('t-ev'), now());
insert into events (title, type, group_id, starts_at)
  values ('Adunare Generală', 'sedinta', pg_temp.dept_group('org'), now());

select is((select count(*) from events), 3::bigint,
  'events accept Department, Team and Organization Groups');
select is(
  (select group_id from events where title = 'Call Echipa Events'),
  pg_temp.team_group('t-ev'), 'a team event keeps its Team Group');
select is(
  (select group_id from events where title = 'Ședință EDU'),
  pg_temp.dept_group('edu'), 'a department event keeps its Department Group');

select throws_ok(
  $$ insert into events (title, type, group_id, starts_at, ends_at)
     values ('Timp invers', 'eveniment', pg_temp.dept_group('org'), now(), now() - interval '1 hour') $$,
  '23514', null, 'an event cannot end before it starts');

-- ==================== RSVP: exactly once per member (AC) ====================
insert into event_attendance (event_id, member_id)
  select id, 'e0000000-0000-0000-0000-0000000000e1'::uuid
    from events where title = 'Ședință EDU';

select throws_ok(
  $$ insert into event_attendance (event_id, member_id)
     select id, 'e0000000-0000-0000-0000-0000000000e1'::uuid
       from events where title = 'Ședință EDU' $$,
  '23505', null, 'the same member cannot RSVP twice (primary key)');

select throws_ok(
  $$ insert into event_attendance (event_id, member_id, status)
     select id, 'e0000000-0000-0000-0000-0000000000e1'::uuid, 'poate'
       from events where title = 'Adunare Generală' $$,
  '23514', null, 'RSVP status is limited to going/declined');

select * from finish();
rollback;
