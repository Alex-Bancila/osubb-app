-- events_attendance.test.sql — Epic 1.5a: calendar events + RSVP schema.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- ==================== Shape ====================
select has_table('public', 'events', 'events table exists');
select has_table('public', 'event_attendance', 'event_attendance table exists');

select ok(
  (select relrowsecurity from pg_class
    where relname = 'events' and relnamespace = 'public'::regnamespace),
  'RLS is enabled on events');
select ok(
  (select relrowsecurity from pg_class
    where relname = 'event_attendance' and relnamespace = 'public'::regnamespace),
  'RLS is enabled on event_attendance');

select has_index('public', 'events', 'events_starts_at_idx',
  'events are indexed by start time (upcoming-events query)');
select has_index('public', 'event_attendance', 'event_attendance_member_idx',
  'attendance is indexed by member ("my RSVPs")');

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-0000000000e1', 'elena.events@test.local');
insert into profiles (id, full_name, email, role) values
  ('e0000000-0000-0000-0000-0000000000e1', 'Elena Test', 'elena.events@test.local', 'voluntar');
insert into teams (id, name, dept_id) values ('t-ev', 'Events Team', 'edu');

-- ==================== An event carries scope + optional team (AC) ====================
insert into events (title, type, scope, dept_id, starts_at, ends_at)
  values ('Ședință EDU', 'sedinta', 'dept', 'edu', now(), now() + interval '2 hours');
insert into events (title, type, scope, team_id)
  values ('Call Echipa Events', 'call', 'team', 't-ev');
insert into events (title, type, scope)
  values ('Adunare Generală', 'sedinta', 'org');

select is((select count(*) from events), 3::bigint,
  'events accept dept, team and org scopes');
select is(
  (select scope from events where title = 'Call Echipa Events'),
  'team'::event_scope, 'a team event keeps its scope and team');
select is(
  (select team_id from events where title = 'Ședință EDU'),
  null, 'team_id is optional (a dept event has none)');

select throws_ok(
  $$ insert into events (title, type, scope, starts_at, ends_at)
     values ('Timp invers', 'eveniment', 'org', now(), now() - interval '1 hour') $$,
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
