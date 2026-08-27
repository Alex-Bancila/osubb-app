-- calendar_upcoming.test.sql — Verifies AC for Epic 9.3a: "recrut demo login sees org + call/recrutare + its recruit-team events only"
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(2);

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
  ('01000000-0000-0000-0000-000000000001', 'rares.recrut@test.local');

insert into profiles (id, full_name, email, role) values
  ('01000000-0000-0000-0000-000000000001', 'Rareș Recrut', 'rares.recrut@test.local', 'recrut');

insert into member_departments (member_id, dept_id) values
  ('01000000-0000-0000-0000-000000000001', 'edu');

-- Teams
insert into teams (id, name, dept_id, for_recruits) values
  ('t-pr',  'Echipa PR',       'pr',  false),
  ('t-rec', 'Echipa Recruți',  'edu', true);

-- Insert events that will be verified
insert into events (title, type, scope, dept_id, team_id, starts_at) values
  ('AG org',              'sedinta',    'org',  null,  null,     now() + interval '1 day'),
  ('Recrutare toamnă',    'recrutare',  'dept', 'hr',  null,     now() + interval '2 days'),
  ('Call departamental',  'call',       'dept', 'edu', null,     now() + interval '3 days'),
  ('Activitate recruți',  'activitate', 'team', 'edu', 't-rec',  now() + interval '4 days'),
  ('Ședință PR (ascuns)', 'sedinta',    'dept', 'pr',  null,     now() + interval '5 days');

-- ==================== Verification ====================
select pg_temp.login('01000000-0000-0000-0000-000000000001', 'recrut', 0, '["edu"]', '[]');

-- Recrut sees org-scoped events, recrutare/call type events, their own dept events, and recruit team events
-- The hidden PR event should not be visible
select results_eq(
  $$ select title from events order by starts_at $$,
  $$ values 
       ('AG org'),
       ('Recrutare toamnă'),
       ('Call departamental'),
       ('Activitate recruți')
  $$,
  'Recrut demo login sees exactly org + call/recrutare + its recruit-team events only (ordered)'
);

select is((select count(*) from events), 4::bigint, 'Should exactly be 4 events visible out of 5');

reset role;
select * from finish();
rollback;
