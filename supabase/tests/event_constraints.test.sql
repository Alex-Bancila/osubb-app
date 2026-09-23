-- event_constraints.test.sql — #244: calendar event value integrity.
-- #369 adds Minimum Level and cancellation shape coverage.
-- #579: the Group is an Event's only Origin. scope / dept_id / team_id / project_id,
-- events_scope_fields_ck, events_team_department_fkey and the event_scope type are gone;
-- group_id NOT NULL plus events_group_id_fkey are the whole invariant.
-- Runs in one transaction and rolls back, leaving the local demo untouched.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(33);

-- The demo seed fills the calendar. This suite owns its rows and rolls the
-- truncation back after the assertions.
truncate events, event_attendance cascade;

insert into pg_temp.fixture_teams (id, name, dept_id)
values ('t-event-integrity', 'Event integrity team', 'edu');

-- A Profile and a Project whose Group owns an Event below.
insert into auth.users (id, email)
values ('36900000-0000-0000-0000-000000000001',
        'event-integrity-lead-369@test.local');
insert into public.profiles (id, full_name, email, role, status)
values ('36900000-0000-0000-0000-000000000001', 'Event Integrity Lead',
        'event-integrity-lead-369@test.local', 'responsabil', 'activ');
insert into pg_temp.fixture_projects (name, status, leader_id, created_by)
values ('Event Integrity Project 369', 'active',
        '36900000-0000-0000-0000-000000000001',
        '36900000-0000-0000-0000-000000000001');
-- #586: materialize this suite's legacy setup as rolled-back Group fixtures.
select pg_temp.materialize_legacy_groups();


-- ==================== Any Group owns an Event ====================
select lives_ok(
  $$ insert into events (title, type, group_id, starts_at)
     values ('Adunare generală', 'sedinta', pg_temp.dept_group('org'), now()) $$,
  'the Organization Group owns an organization event');

select lives_ok(
  $$ insert into events (title, type, group_id, starts_at)
     values ('Ședință Educațional', 'sedinta', pg_temp.dept_group('edu'), now()) $$,
  'a Department Group owns a department event');

select lives_ok(
  $$ insert into events (title, type, group_id, starts_at)
     values ('Sprint echipă', 'activitate', pg_temp.team_group('t-event-integrity'), now()) $$,
  'a Team Group owns a team event -- no parent Department is carried beside it');

select throws_ok(
  $$ insert into events (title, type, starts_at)
     values ('Fără grup', 'activitate', now()) $$,
  '23502', null,
  'an event without a Group is rejected by group_id NOT NULL -- no bridge derives one (#579)');

select lives_ok(
  $$ insert into events (title, type, group_id, starts_at)
     select 'Proiect real', 'activitate', pg_temp.project_group(project.id), now()
       from pg_temp.fixture_projects project
      where project.name = 'Event Integrity Project 369' $$,
  'a Project Group owns a project event');

-- ==================== Minimum Level ====================
select is(
  (select min_level from events where title = 'Adunare generală'),
  0, 'min_level defaults to 0 on an existing event');

select throws_ok(
  $$ insert into events (title, type, group_id, starts_at, min_level)
     values ('Nivel invalid', 'sedinta', pg_temp.dept_group('org'), now(), 2) $$,
  '23514', 'new row for relation "events" violates check constraint "events_min_level_ck"',
  'min_level rejects a value outside the ADR-0008 table');

select lives_ok(
  $$ insert into events (title, type, group_id, starts_at, min_level)
     values ('Nivel AG', 'sedinta', pg_temp.dept_group('org'), now(), 3) $$,
  'min_level accepts an ADR-0008 table value');

-- ==================== Cancellation shape ====================
select throws_ok(
  $$ insert into events (title, type, group_id, starts_at, cancelled_at)
     values ('Anulare fără motiv', 'sedinta', pg_temp.dept_group('org'), now(), now()) $$,
  '23514', 'new row for relation "events" violates check constraint "events_cancel_reason_ck"',
  'cancelling an event without a reason is rejected');

select throws_ok(
  $$ insert into events (title, type, group_id, starts_at, cancelled_at, cancel_reason)
     values ('Anulare motiv gol', 'sedinta', pg_temp.dept_group('org'), now(), now(), '   ') $$,
  '23514', 'new row for relation "events" violates check constraint "events_cancel_reason_ck"',
  'a blank cancellation reason is rejected');

select throws_ok(
  $$ insert into events (title, type, group_id, starts_at, cancelled_at, cancel_reason)
     values ('Anulare motiv tab', 'sedinta', pg_temp.dept_group('org'), now(), now(), E'\t\n') $$,
  '23514', 'new row for relation "events" violates check constraint "events_cancel_reason_ck"',
  'a tab-only cancellation reason is rejected');

select throws_ok(
  $$ insert into events (title, type, group_id, starts_at, cancel_reason)
     values ('Motiv fără anulare', 'sedinta', pg_temp.dept_group('org'), now(), 'Sală indisponibilă') $$,
  '23514', 'new row for relation "events" violates check constraint "events_cancel_reason_ck"',
  'a cancellation reason without cancelled_at is rejected');

select lives_ok(
  $$ insert into events (title, type, group_id, starts_at, cancelled_at, cancel_reason)
     values ('Anulare validă', 'sedinta', pg_temp.dept_group('org'), now(), now(), 'Sală indisponibilă') $$,
  'a nonblank cancellation reason is accepted');

-- ==================== Required and bounded values ====================
select throws_ok(
  $$ insert into events (title, type, group_id, starts_at)
     values ('', 'sedinta', pg_temp.dept_group('org'), now()) $$,
  '23514', 'new row for relation "events" violates check constraint "events_title_length_ck"',
  'an event title cannot be empty (#673: the length rule sorts before the blank rule)');

-- #673: three characters each, so the length rule passes and only the blank
-- rule can refuse them.
select throws_ok(
  $$ insert into events (title, type, group_id, starts_at)
     values ('   ', 'sedinta', pg_temp.dept_group('org'), now()) $$,
  '23514', 'new row for relation "events" violates check constraint "events_title_not_blank_ck"',
  'an event title cannot contain only whitespace');

select throws_ok(
  $$ insert into events (title, type, group_id, starts_at)
     values (E'\t\n\t', 'sedinta', pg_temp.dept_group('org'), now()) $$,
  '23514', 'new row for relation "events" violates check constraint "events_title_not_blank_ck"',
  'tabs and line breaks do not make a valid event title');

select throws_ok(
  $$ insert into events (title, type, group_id)
     values ('Fără început', 'sedinta', pg_temp.dept_group('org')) $$,
  '23502', null, 'an event requires a start instant');

select throws_ok(
  $$ insert into events (title, type, group_id, starts_at, ends_at)
     values ('Durată zero', 'sedinta', pg_temp.dept_group('org'), now(), now()) $$,
  '23514', null, 'an event must end later than it starts');

select throws_ok(
  $$ insert into events (title, type, group_id, starts_at, capacity)
     values ('Capacitate zero', 'sedinta', pg_temp.dept_group('org'), now(), 0) $$,
  '23514', 'new row for relation "events" violates check constraint "events_capacity_range_ck"',
  'capacity cannot be zero');

select throws_ok(
  $$ insert into events (title, type, group_id, starts_at, capacity)
     values ('Capacitate negativă', 'sedinta', pg_temp.dept_group('org'), now(), -1) $$,
  '23514', 'new row for relation "events" violates check constraint "events_capacity_range_ck"',
  'capacity cannot be negative');

-- #673 (R8): the ceiling events_capacity_range_ck adds to the old floor.
select throws_ok(
  $$ insert into events (title, type, group_id, starts_at, capacity)
     values ('Capacitate prea mare', 'sedinta', pg_temp.dept_group('org'), now(), 1001) $$,
  '23514', 'new row for relation "events" violates check constraint "events_capacity_range_ck"',
  'capacity cannot exceed 1000');

select lives_ok(
  $$ insert into events (title, type, group_id, starts_at, capacity)
     values ('Capacitate maximă', 'sedinta', pg_temp.dept_group('org'), now(), 1000) $$,
  'a capacity of exactly 1000 is accepted');

-- ==================== The Group is the whole Origin invariant (#579) ====================
select throws_ok(
  $$ insert into events (title, type, group_id, starts_at)
     values ('Grup necunoscut', 'sedinta', -1, now()) $$,
  '23503', null, 'an unknown Group is rejected by events_group_id_fkey');

select col_not_null('public', 'events', 'group_id', 'every Event names its owning Group');
select fk_ok('public', 'events', 'group_id', 'public', 'groups', 'id',
  'events.group_id references the Group model');
select has_index('public', 'events', 'events_group_idx', 'Group-origin lookup is indexed');
select hasnt_column('public', 'events', 'scope', 'events.scope is gone (#579)');
select hasnt_column('public', 'events', 'dept_id', 'events.dept_id is gone (#579)');
select hasnt_column('public', 'events', 'team_id', 'events.team_id is gone (#579)');
select hasnt_column('public', 'events', 'project_id', 'events.project_id is gone (#579)');
select hasnt_type('public', 'event_scope', 'the event_scope enum is gone with events.scope (R18)');
select ok(not exists (select 1 from pg_constraint
                       where conrelid = 'public.events'::regclass
                         and conname in ('events_scope_fields_ck', 'events_team_department_fkey')),
  'the scope-shape check and the Team/Department foreign key are gone');
select hasnt_index('public', 'events', 'events_dept_idx', 'the legacy Department-origin index is gone');

select * from finish();
rollback;
