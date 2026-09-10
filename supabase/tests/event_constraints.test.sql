-- event_constraints.test.sql — #244: calendar event value integrity.
-- Runs in one transaction and rolls back, leaving the local demo untouched.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(19);

-- The demo seed fills the calendar. This suite owns its rows and rolls the
-- truncation back after the assertions.
truncate events, event_attendance cascade;

insert into teams (id, name, dept_id)
values ('t-event-integrity', 'Event integrity team', 'edu');

-- ==================== Supported scope shapes ====================
select lives_ok(
  $$ insert into events (title, type, scope, starts_at)
     values ('Adunare generală', 'sedinta', 'org', now()) $$,
  'an organization event has no department or team');

select lives_ok(
  $$ insert into events (title, type, scope, dept_id, starts_at)
     values ('Ședință Educațional', 'sedinta', 'dept', 'edu', now()) $$,
  'a department event names one department and no team');

select lives_ok(
  $$ insert into events (title, type, scope, dept_id, team_id, starts_at)
     values ('Sprint echipă', 'activitate', 'team', 'edu',
             't-event-integrity', now()) $$,
  'a team event names its team and matching department');

select lives_ok(
  $$ insert into events (title, type, scope, starts_at)
     values ('Proiect viitor', 'activitate', 'project', now()) $$,
  'project remains a schema value for future compatibility');

-- ==================== Required and bounded values ====================
select throws_ok(
  $$ insert into events (title, type, scope, starts_at)
     values ('', 'sedinta', 'org', now()) $$,
  '23514', null, 'an event title cannot be empty');

select throws_ok(
  $$ insert into events (title, type, scope, starts_at)
     values ('   ', 'sedinta', 'org', now()) $$,
  '23514', null, 'an event title cannot contain only whitespace');

select throws_ok(
  $$ insert into events (title, type, scope, starts_at)
     values (E'\t\n', 'sedinta', 'org', now()) $$,
  '23514', null, 'tabs and line breaks do not make a valid event title');

select throws_ok(
  $$ insert into events (title, type, scope)
     values ('Fără început', 'sedinta', 'org') $$,
  '23502', null, 'an event requires a start instant');

select throws_ok(
  $$ insert into events (title, type, scope, starts_at, ends_at)
     values ('Durată zero', 'sedinta', 'org', now(), now()) $$,
  '23514', null, 'an event must end later than it starts');

select throws_ok(
  $$ insert into events (title, type, scope, starts_at, capacity)
     values ('Capacitate zero', 'sedinta', 'org', now(), 0) $$,
  '23514', null, 'capacity cannot be zero');

select throws_ok(
  $$ insert into events (title, type, scope, starts_at, capacity)
     values ('Capacitate negativă', 'sedinta', 'org', now(), -1) $$,
  '23514', null, 'capacity cannot be negative');

-- ==================== Scope relationships ====================
select throws_ok(
  $$ insert into events (title, type, scope, dept_id, starts_at)
     values ('Org cu departament', 'sedinta', 'org', 'edu', now()) $$,
  '23514', null, 'an organization event cannot name a department');

select throws_ok(
  $$ insert into events (title, type, scope, team_id, starts_at)
     values ('Org cu echipă', 'sedinta', 'org', 't-event-integrity', now()) $$,
  '23514', null, 'an organization event cannot name a team');

select throws_ok(
  $$ insert into events (title, type, scope, starts_at)
     values ('Departament lipsă', 'sedinta', 'dept', now()) $$,
  '23514', null, 'a department event requires a department');

select throws_ok(
  $$ insert into events (title, type, scope, dept_id, team_id, starts_at)
     values ('Departament cu echipă', 'sedinta', 'dept', 'edu',
             't-event-integrity', now()) $$,
  '23514', null, 'a department event cannot name a team');

select throws_ok(
  $$ insert into events (title, type, scope, team_id, starts_at)
     values ('Echipă fără departament', 'sedinta', 'team',
             't-event-integrity', now()) $$,
  '23514', null, 'a team event requires its department');

select throws_ok(
  $$ insert into events (title, type, scope, dept_id, starts_at)
     values ('Echipă lipsă', 'sedinta', 'team', 'edu', now()) $$,
  '23514', null, 'a team event requires a team');

select throws_ok(
  $$ insert into events (title, type, scope, dept_id, team_id, starts_at)
     values ('Departament fals', 'sedinta', 'team', 'pr',
             't-event-integrity', now()) $$,
  '23503', null, 'a team event department must match the team');

select throws_ok(
  $$ insert into events (title, type, scope, dept_id, starts_at)
     values ('Proiect cu departament', 'activitate', 'project', 'edu', now()) $$,
  '23514', null, 'a future project event cannot misuse department scope');

select * from finish();
rollback;
