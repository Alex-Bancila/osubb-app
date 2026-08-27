-- calendar_rsvp.test.sql
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(5);

-- ==================== Login simulation ====================
create function pg_temp.login(uid uuid, r text, lvl int, depts jsonb, tms jsonb)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', uid, 'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'member_role', r, 'member_level', lvl,
      'dept_ids', depts, 'team_ids', tms))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ==================== Fixtures ====================
truncate events, event_attendance cascade;

insert into auth.users (id, email) values
  ('01000000-0000-0000-0000-000000000001', 'voluntar@test.local'),
  ('01000000-0000-0000-0000-000000000002', 'bc@test.local');

insert into profiles (id, full_name, email, role) values
  ('01000000-0000-0000-0000-000000000001', 'Test Voluntar', 'voluntar@test.local', 'voluntar'),
  ('01000000-0000-0000-0000-000000000002', 'Test BC',       'bc@test.local',       'bc');

insert into events (id, title, type, scope, starts_at) overriding system value values
  (1, 'AG org', 'sedinta', 'org', now() + interval '1 day');

insert into event_attendance (event_id, member_id, status) values
  (1, '01000000-0000-0000-0000-000000000002', 'going'); -- BC is going

-- ==================== Verification ====================

-- 1. Voluntar login
select pg_temp.login('01000000-0000-0000-0000-000000000001', 'voluntar', 2, '[]', '[]');

select is((select count(*) from event_attendance), 0::bigint, 'Voluntar sees only 0 attendances (since BC is going, not them)');

-- Voluntar inserts their RSVP
prepare insert_own as insert into event_attendance (event_id, member_id, status) values (1, '01000000-0000-0000-0000-000000000001', 'going');
select lives_ok('insert_own', 'Voluntar can RSVP to the event (insert their own row)');

select is((select count(*) from event_attendance), 1::bigint, 'Voluntar now sees exactly 1 attendance (theirs)');

-- Voluntar cannot insert for someone else
prepare insert_other as insert into event_attendance (event_id, member_id, status) values (1, '01000000-0000-0000-0000-000000000002', 'going');
select throws_ok('insert_other', '42501', NULL, 'Voluntar cannot insert an RSVP row for another member');

-- 2. BC login
select pg_temp.login('01000000-0000-0000-0000-000000000002', 'bc', 4, '[]', '[]');

select is((select count(*) from event_attendance), 2::bigint, 'BC (level 4) can see all attendances');

reset role;
select * from finish();
rollback;
