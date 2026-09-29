-- rls_event_attendance.test.sql — #63: secure RSVP rows and writes.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(26);


-- ==================== Structure and grants ====================
-- #936: event_attendance_create_self and event_attendance_update_self, plus
-- every column-level insert/update grant, are dropped -- set_event_rsvp is now
-- the only write path. event_attendance_read is untouched.
select policies_are('public', 'event_attendance',
  array['event_attendance_read'],
  'attendance exposes only its read policy -- direct writes retired (#936)');

select ok(not has_table_privilege('authenticated', 'event_attendance', 'insert'),
  'authenticated has no table-wide INSERT grant');
select ok(not has_table_privilege('authenticated', 'event_attendance', 'update'),
  'authenticated has no table-wide UPDATE grant');
select ok(not has_table_privilege('authenticated', 'event_attendance', 'delete'),
  'authenticated cannot DELETE attendance rows');

-- ==================== Fixtures ====================
truncate events, event_attendance cascade;

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000063', 'ana.attendance@test.local'),
  ('b2000000-0000-0000-0000-000000000063', 'bogdan.attendance@test.local'),
  ('c3000000-0000-0000-0000-000000000063', 'corina.manager@test.local'),
  ('d4000000-0000-0000-0000-000000000063', 'dan.deactivated@test.local');

insert into profiles (id, full_name, email, role, status) values
  ('a1000000-0000-0000-0000-000000000063', 'Ana Voluntar', 'ana.attendance@test.local', 'voluntar', 'activ'),
  ('b2000000-0000-0000-0000-000000000063', 'Bogdan Voluntar', 'bogdan.attendance@test.local', 'voluntar', 'activ'),
  ('c3000000-0000-0000-0000-000000000063', 'Corina Responsabil', 'corina.manager@test.local', 'vot', 'activ'),
  ('d4000000-0000-0000-0000-000000000063', 'Dan Dezactivat', 'dan.deactivated@test.local', 'voluntar', 'inactiv');

insert into pg_temp.fixture_member_departments (member_id, dept_id) values
  ('a1000000-0000-0000-0000-000000000063', 'edu'),
  ('b2000000-0000-0000-0000-000000000063', 'pr'),
  ('c3000000-0000-0000-0000-000000000063', 'edu'),
  ('d4000000-0000-0000-0000-000000000063', 'edu');

-- ADR-0008/#372: scope no longer gates visibility, Minimum Level does — a
-- dept-scoped Event is otherwise readable org-wide at min_level 0 now. So
-- 'RSVP imagine' carries min_level 3 (#519 retires min_level 4) specifically
-- to stay the one Event hidden from a level-1 Voluntar below (the fixture
-- this file needs for "a member cannot RSVP to an event hidden by event
-- RLS"); since #593 it is level >= 5 (Corina with a level-5 token) that reads
-- every attendance row, and a stale level-4 token reads only its own.
insert into events (title, type, group_id, min_level, starts_at) values
  ('RSVP organizație', 'sedinta', pg_temp.dept_group('org'), 0, now() + interval '1 day'),
  ('RSVP educațional', 'sedinta', pg_temp.dept_group('edu'), 0, now() + interval '2 days'),
  ('RSVP imagine', 'sedinta', pg_temp.dept_group('pr'), 3, now() + interval '3 days');

insert into event_attendance (event_id, member_id, status)
select id, 'a1000000-0000-0000-0000-000000000063'::uuid, 'going'
  from events where title = 'RSVP organizație';
insert into event_attendance (event_id, member_id, status)
select id, 'b2000000-0000-0000-0000-000000000063'::uuid, 'declined'
  from events where title = 'RSVP organizație';
insert into event_attendance (event_id, member_id, status)
select id, 'b2000000-0000-0000-0000-000000000063'::uuid, 'going'
  from events where title = 'RSVP imagine';

-- Keep ids available after SET ROLE. Looking them up through events as an
-- unauthorized persona could return no rows and make a write test pass hollow.
create temp table attendance_fx as
select
  (select id from events where title = 'RSVP organizație') as org_event_id,
  (select id from events where title = 'RSVP educațional') as edu_event_id,
  (select id from events where title = 'RSVP imagine') as pr_event_id;
grant select on attendance_fx to authenticated;

-- ==================== Active member: read and self-write ====================
select pg_temp.test_login('a1000000-0000-0000-0000-000000000063', jsonb_build_object(
    'member_role', 'voluntar',
    'member_level', 1,
    'dept_ids', '["edu"]'::jsonb,
    'team_ids', '[]'::jsonb
  ));

select is((select count(*) from event_attendance), 1::bigint,
  'a member sees only their own attendance on visible events');
select is((select status from event_attendance), 'going',
  'the member reads their own RSVP status');

-- #936: a direct insert is refused outright -- set_event_rsvp is the only
-- write path left, and it reaches the same outcomes.
select throws_ok(
  format($$ insert into event_attendance (event_id, member_id, status)
            values (%s, 'a1000000-0000-0000-0000-000000000063', 'going') $$,
         (select edu_event_id from attendance_fx)),
  '42501', null, 'a direct insert by an authenticated Member is refused (#936)');

select lives_ok(
  format($$ select public.set_event_rsvp(%s, 'going') $$,
         (select edu_event_id from attendance_fx)),
  'the same RSVP succeeds through set_event_rsvp');
select is(
  (select member_id from event_attendance
    where event_id = (select edu_event_id from attendance_fx)),
  'a1000000-0000-0000-0000-000000000063'::uuid,
  'set_event_rsvp writes only the caller''s own row -- it takes no member id to redirect it (#936)');
select is(
  (select checked_in from event_attendance
    where event_id = (select edu_event_id from attendance_fx)),
  false, 'set_event_rsvp leaves checked_in untouched on a new RSVP (#936)');

select throws_ok(
  format($$ insert into event_attendance (event_id, member_id, status)
            values (%s, 'b2000000-0000-0000-0000-000000000063', 'going') $$,
         (select edu_event_id from attendance_fx)),
  '42501', null, 'a member cannot create an RSVP for a colleague');

select throws_ok(
  format($$ select public.set_event_rsvp(%s, 'going') $$,
         (select pr_event_id from attendance_fx)),
  'PT404', 'event_not_visible', 'set_event_rsvp refuses an event hidden by event RLS -- visible event only (#936)');

select throws_ok(
  format($$ update event_attendance set status = 'declined'
            where member_id = 'a1000000-0000-0000-0000-000000000063'
              and event_id = %s $$,
         (select org_event_id from attendance_fx)),
  '42501', null, 'a direct update by an authenticated Member is refused (#936)');

select lives_ok(
  format($$ select public.set_event_rsvp(%s, 'declined') $$,
         (select org_event_id from attendance_fx)),
  'the same status change succeeds through set_event_rsvp');
select is(
  (select status from event_attendance
    where event_id = (select org_event_id from attendance_fx)),
  'declined', 'a member changes their own RSVP status through set_event_rsvp');

select throws_ok(
  format($$ update event_attendance set checked_in = true
            where event_id = %s
              and member_id = 'a1000000-0000-0000-0000-000000000063' $$,
         (select org_event_id from attendance_fx)),
  '42501', null, 'a member cannot mark themselves checked in with a direct update (#936)');

select throws_ok(
  format($$ delete from event_attendance
            where event_id = %s
              and member_id = 'a1000000-0000-0000-0000-000000000063' $$,
         (select org_event_id from attendance_fx)),
  '42501', null, 'a member cannot delete their RSVP row');

reset role;

-- Level 4 no longer grants colleague attendance visibility, even in a stale token.
select pg_temp.test_login('c3000000-0000-0000-0000-000000000063', '{"member_role":"bce","member_level":4}');
select is((select count(*) from event_attendance),0::bigint,'level 4 cannot read colleague attendance');
reset role;
-- M4: the level is read from the live Profile, so a level-5 token over a vot
-- Profile reads nothing; once the Profile really is BCE the same token reads all.
select pg_temp.test_login('c3000000-0000-0000-0000-000000000063', '{"member_role":"bce","member_level":5}');
select is((select count(*) from event_attendance),0::bigint,'a stale level-5 token over a vot Profile reads no colleague attendance');
reset role;
update profiles set role = 'bce' where id = 'c3000000-0000-0000-0000-000000000063';
select pg_temp.test_login('c3000000-0000-0000-0000-000000000063', '{"member_role":"bce","member_level":5}');
select is((select count(*) from event_attendance),4::bigint,'level 5 reads attendance across visible events');

-- #936: a manager's read access never extended to a colleague's row, and now
-- no direct write reaches event_attendance at all -- same refusal either way.
select throws_ok(
  format($$ update event_attendance set status = 'going'
            where member_id = 'b2000000-0000-0000-0000-000000000063'
              and event_id = %s $$,
         (select org_event_id from attendance_fx)),
  '42501', null, 'a manager''s read access does not extend to a direct write on a colleague''s RSVP (#936)');

reset role;
select is(
  (select status from event_attendance
    where member_id = 'b2000000-0000-0000-0000-000000000063'
      and event_id = (select org_event_id from attendance_fx)),
  'declined', 'manager read access does not permit rewriting a colleague RSVP');

-- ==================== Real uid without organisation claims ====================
select pg_temp.test_login('d4000000-0000-0000-0000-000000000063', jsonb_build_object('provider', 'email'));

select ok(not auth_is_member(),
  'a deactivated identity has a real uid but no active-member claim');
select is((select count(*) from event_attendance), 0::bigint,
  'a deactivated identity reads no attendance rows');

select throws_ok(
  format($$ insert into event_attendance (event_id, member_id, status)
            values (%s, 'd4000000-0000-0000-0000-000000000063', 'going') $$,
         (select org_event_id from attendance_fx)),
  '42501', null, 'a deactivated identity cannot create a self-owned RSVP');

reset role;

-- ==================== anon ====================
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(
  $$ select count(*) from event_attendance $$,
  '42501', null, 'anon has no attendance access');
reset role;

select * from finish();
rollback;
