-- event_constraints.test.sql — #244: calendar event value integrity.
-- #369 adds Minimum Level, Project scope, and cancellation shape coverage.
-- Runs in one transaction and rolls back, leaving the local demo untouched.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(30);

-- The demo seed fills the calendar. This suite owns its rows and rolls the
-- truncation back after the assertions.
truncate events, event_attendance cascade;

insert into teams (id, name, dept_id)
values
  ('t-event-integrity', 'Event integrity team', 'edu'),
  ('t-event-independent', 'Independent event team', null);

-- #369 fixtures: a Profile and Project to exercise the new project scope and
-- the events_scope_fields_ck branches that involve project_id.
insert into auth.users (id, email)
values ('36900000-0000-0000-0000-000000000001',
        'event-integrity-lead-369@test.local');
insert into public.profiles (id, full_name, email, role, status)
values ('36900000-0000-0000-0000-000000000001', 'Event Integrity Lead',
        'event-integrity-lead-369@test.local', 'responsabil', 'activ');
insert into public.projects (name, status, leader_id, created_by)
values ('Event Integrity Project 369', 'active',
        '36900000-0000-0000-0000-000000000001',
        '36900000-0000-0000-0000-000000000001');

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

select throws_ok(
  $$ insert into events (title, type, scope, starts_at)
     values ('Proiect fără proiect', 'activitate', 'project', now()) $$,
  '23514', 'new row for relation "events" violates check constraint "events_scope_fields_ck"',
  'a project event requires a project');

select lives_ok(
  $$ insert into events (title, type, scope, project_id, starts_at)
     select 'Proiect real', 'activitate', 'project', project.id, now()
       from public.projects project
      where project.name = 'Event Integrity Project 369' $$,
  'a project event names its project and no department or team');

-- ==================== Minimum Level ====================
select is(
  (select min_level from events where title = 'Adunare generală'),
  0, 'min_level defaults to 0 on an existing event');

select throws_ok(
  $$ insert into events (title, type, scope, starts_at, min_level)
     values ('Nivel invalid', 'sedinta', 'org', now(), 2) $$,
  '23514', 'new row for relation "events" violates check constraint "events_min_level_ck"',
  'min_level rejects a value outside the ADR-0008 table');

select lives_ok(
  $$ insert into events (title, type, scope, starts_at, min_level)
     values ('Nivel AG', 'sedinta', 'org', now(), 3) $$,
  'min_level accepts an ADR-0008 table value');

-- ==================== Cancellation shape ====================
select throws_ok(
  $$ insert into events (title, type, scope, starts_at, cancelled_at)
     values ('Anulare fără motiv', 'sedinta', 'org', now(), now()) $$,
  '23514', 'new row for relation "events" violates check constraint "events_cancel_reason_ck"',
  'cancelling an event without a reason is rejected');

select throws_ok(
  $$ insert into events (title, type, scope, starts_at, cancelled_at, cancel_reason)
     values ('Anulare motiv gol', 'sedinta', 'org', now(), now(), '   ') $$,
  '23514', 'new row for relation "events" violates check constraint "events_cancel_reason_ck"',
  'a blank cancellation reason is rejected');

select throws_ok(
  $$ insert into events (title, type, scope, starts_at, cancelled_at, cancel_reason)
     values ('Anulare motiv tab', 'sedinta', 'org', now(), now(), E'\t\n') $$,
  '23514', 'new row for relation "events" violates check constraint "events_cancel_reason_ck"',
  'a tab-only cancellation reason is rejected');

select throws_ok(
  $$ insert into events (title, type, scope, starts_at, cancel_reason)
     values ('Motiv fără anulare', 'sedinta', 'org', now(), 'Sală indisponibilă') $$,
  '23514', 'new row for relation "events" violates check constraint "events_cancel_reason_ck"',
  'a cancellation reason without cancelled_at is rejected');

select lives_ok(
  $$ insert into events (title, type, scope, starts_at, cancelled_at, cancel_reason)
     values ('Anulare validă', 'sedinta', 'org', now(), now(), 'Sală indisponibilă') $$,
  'a nonblank cancellation reason is accepted');

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
  $$ insert into events (title, type, scope, project_id, starts_at)
     select 'Org cu proiect', 'sedinta', 'org', project.id, now()
       from public.projects project
      where project.name = 'Event Integrity Project 369' $$,
  '23514', 'new row for relation "events" violates check constraint "events_scope_fields_ck"',
  'an organization event cannot name a project');

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
  $$ insert into events (title, type, scope, dept_id, project_id, starts_at)
     select 'Departament cu proiect', 'sedinta', 'dept', 'edu', project.id, now()
       from public.projects project
      where project.name = 'Event Integrity Project 369' $$,
  '23514', 'new row for relation "events" violates check constraint "events_scope_fields_ck"',
  'a department event cannot name a project');

select lives_ok(
  $$ insert into events (title, type, scope, team_id, starts_at)
     values ('Echipă fără departament', 'sedinta', 'team',
             't-event-independent', now()) $$,
  'a Team Event may omit Department for an Independent Team');

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
  '23514', null, 'a project event cannot also name a department');

select * from finish();
rollback;
