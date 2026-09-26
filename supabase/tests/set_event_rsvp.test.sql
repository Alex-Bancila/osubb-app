-- set_event_rsvp.test.sql — issue #237: one atomic, self-owned RSVP command.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(22);


truncate public.events, public.event_attendance cascade;

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000237', 'ana.rsvp@test.local'),
  ('b2000000-0000-0000-0000-000000000237', 'bogdan.rsvp@test.local'),
  ('c3000000-0000-0000-0000-000000000237', 'corina.rsvp@test.local'),
  ('d4000000-0000-0000-0000-000000000237', 'dan.rsvp@test.local'),
  ('e5000000-0000-0000-0000-000000000237', 'elena.no-profile@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('a1000000-0000-0000-0000-000000000237', 'Ana Voluntar', 'ana.rsvp@test.local', 'voluntar', 'activ'),
  ('b2000000-0000-0000-0000-000000000237', 'Bogdan Voluntar', 'bogdan.rsvp@test.local', 'voluntar', 'activ'),
  ('c3000000-0000-0000-0000-000000000237', 'Corina Responsabil', 'corina.rsvp@test.local', 'responsabil', 'activ'),
  ('d4000000-0000-0000-0000-000000000237', 'Dan Dezactivat', 'dan.rsvp@test.local', 'voluntar', 'inactiv');

insert into pg_temp.fixture_member_departments (member_id, dept_id) values
  ('a1000000-0000-0000-0000-000000000237', 'edu'),
  ('b2000000-0000-0000-0000-000000000237', 'pr'),
  ('c3000000-0000-0000-0000-000000000237', 'edu'),
  ('d4000000-0000-0000-0000-000000000237', 'edu');

-- ADR-0008/#372: scope no longer gates visibility, Minimum Level does — a
-- dept-scoped Event is otherwise readable org-wide at min_level 0 now. So
-- 'RSVP imagine' carries min_level 3 (#519 retires min_level 4), keeping it
-- the one Event this file needs hidden from Ana (a level-1 Voluntar) for
-- "a hidden event is indistinguishable from a missing event" below.
insert into public.events (title, type, group_id, min_level, starts_at) values
  ('RSVP organizație', 'sedinta', pg_temp.dept_group('org'), 0, now() + interval '1 day'),
  ('RSVP educațional', 'sedinta', pg_temp.dept_group('edu'), 0, now() + interval '2 days'),
  ('RSVP imagine', 'sedinta', pg_temp.dept_group('pr'), 3, now() + interval '3 days');

insert into public.event_attendance (event_id, member_id, status)
select id, 'b2000000-0000-0000-0000-000000000237'::uuid, 'declined'
  from public.events where title = 'RSVP organizație';

create temp table rsvp_fx as
select
  (select id from public.events where title = 'RSVP organizație') as org_event_id,
  (select id from public.events where title = 'RSVP educațional') as edu_event_id,
  (select id from public.events where title = 'RSVP imagine') as pr_event_id;
grant select on rsvp_fx to authenticated, anon;

-- Interface and least-privilege boundary.
select has_function('public', 'set_event_rsvp', 'set_event_rsvp() exists');
select ok(
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'set_event_rsvp'
       and p.pronargs = 2
       and p.proargtypes[0] = 'bigint'::regtype::oid
       and p.proargtypes[1] = 'text'::regtype::oid
       and p.prorettype = 'public.event_attendance'::regtype::oid
  ),
  'the RPC accepts only event id and status, then returns the RSVP row');
select ok(not coalesce((
  select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_event_rsvp'
), true), 'the command is SECURITY INVOKER so event and attendance RLS still apply');
select ok(coalesce((
  select 'search_path=""' = any(p.proconfig)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_event_rsvp'
), false), 'the command has an empty search_path');
select ok(coalesce((
  select has_function_privilege('authenticated', p.oid, 'execute')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_event_rsvp'
), false), 'authenticated may execute the RSVP command');
select ok(not coalesce((
  select has_function_privilege('anon', p.oid, 'execute')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_event_rsvp'
), true), 'anon cannot execute the RSVP command');

-- An active member creates and then changes exactly one self-owned answer.
select pg_temp.test_login('a1000000-0000-0000-0000-000000000237', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select lives_ok(
  format($$ select public.set_event_rsvp(%s, 'going') $$,
         (select edu_event_id from rsvp_fx)),
  'an active member RSVPs to a visible event');
reset role;

select is(
  (select member_id from public.event_attendance
    where event_id = (select edu_event_id from rsvp_fx)),
  'a1000000-0000-0000-0000-000000000237'::uuid,
  'the command derives member identity from auth.uid()');
select is(
  (select status from public.event_attendance
    where event_id = (select edu_event_id from rsvp_fx)),
  'going', 'the command stores the requested status');
select is(
  (select checked_in from public.event_attendance
    where event_id = (select edu_event_id from rsvp_fx)),
  false, 'a new RSVP cannot mark the caller checked in');

-- Simulate a future manager-owned check-in before the member changes status.
update public.event_attendance
   set checked_in = true
 where event_id = (select edu_event_id from rsvp_fx)
   and member_id = 'a1000000-0000-0000-0000-000000000237';

select pg_temp.test_login('a1000000-0000-0000-0000-000000000237', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select lives_ok(
  format($$ select public.set_event_rsvp(%s, 'declined') $$,
         (select edu_event_id from rsvp_fx)),
  'the same member changes an existing RSVP');
reset role;

select is(
  (select count(*) from public.event_attendance
    where event_id = (select edu_event_id from rsvp_fx)
      and member_id = 'a1000000-0000-0000-0000-000000000237'),
  1::bigint, 'changing an RSVP updates instead of duplicating the row');
select is(
  (select status from public.event_attendance
    where event_id = (select edu_event_id from rsvp_fx)
      and member_id = 'a1000000-0000-0000-0000-000000000237'),
  'declined', 'the existing RSVP receives the new status');
select is(
  (select checked_in from public.event_attendance
    where event_id = (select edu_event_id from rsvp_fx)
      and member_id = 'a1000000-0000-0000-0000-000000000237'),
  true, 'changing an RSVP preserves the server-owned checked_in value');

-- Invalid, hidden, missing, and inactive requests fail with stable errors.
select pg_temp.test_login('a1000000-0000-0000-0000-000000000237', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select throws_ok(
  format($$ select public.set_event_rsvp(%s, 'poate') $$,
         (select org_event_id from rsvp_fx)),
  'PT400', 'invalid_rsvp_status', 'an unsupported status has a stable validation error');
select throws_ok(
  format($$ select public.set_event_rsvp(%s, 'going') $$,
         (select pr_event_id from rsvp_fx)),
  'PT404', 'event_not_visible', 'a hidden event is indistinguishable from a missing event');
select throws_ok(
  $$ select public.set_event_rsvp(9223372036854775807, 'going') $$,
  'PT404', 'event_not_visible', 'an unknown event has the same stable not-found error');
reset role;

select pg_temp.test_login('d4000000-0000-0000-0000-000000000237', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select throws_ok(
  format($$ select public.set_event_rsvp(%s, 'going') $$,
         (select org_event_id from rsvp_fx)),
  '42501', 'not_active_member', 'an inactive profile is denied even with stale org claims');
reset role;

select pg_temp.test_login('e5000000-0000-0000-0000-000000000237', jsonb_build_object('provider', 'email'));
select throws_ok(
  format($$ select public.set_event_rsvp(%s, 'going') $$,
         (select org_event_id from rsvp_fx)),
  '42501', 'not_active_member', 'a real auth user without a profile or org claims is denied');
reset role;

-- Manager read authority never changes whose RSVP the command owns.
select pg_temp.test_login('c3000000-0000-0000-0000-000000000237', jsonb_build_object(
    'member_role', 'responsabil', 'member_level', 4,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select lives_ok(
  format($$ select public.set_event_rsvp(%s, 'going') $$,
         (select org_event_id from rsvp_fx)),
  'a calendar manager may set their own RSVP');
reset role;
select is(
  (select status from public.event_attendance
    where event_id = (select org_event_id from rsvp_fx)
      and member_id = 'b2000000-0000-0000-0000-000000000237'),
  'declined', 'a manager call leaves another member response unchanged');

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(
  format($$ select public.set_event_rsvp(%s, 'going') $$,
         (select org_event_id from rsvp_fx)),
  '42501', null, 'anon cannot execute the RSVP command');
reset role;

select * from finish();
rollback;
