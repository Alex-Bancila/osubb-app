-- rls_events.test.sql — Epic 3.4a: the calendar visibility rule, per-role.
-- One event per branch of spec §4.4 × four personas. Part of #67.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(19);

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

create function pg_temp.sees(t text) returns boolean language sql stable as $$
  select exists (select 1 from events where title = t);
$$;

-- ==================== Fixtures ====================
-- The demo seed fills these tables, and this suite counts events exactly —
-- "a recrut sees four" is a claim about the six fixtures below, not about the
-- demo calendar. Cleared inside the transaction, which rolls back.
truncate events, event_attendance cascade;

insert into auth.users (id, email) values
  ('01000000-0000-0000-0000-000000000001', 'rares.recrut@test.local'),
  ('02000000-0000-0000-0000-000000000002', 'vlad.pr@test.local'),
  ('03000000-0000-0000-0000-000000000003', 'raluca.resp@test.local');
insert into profiles (id, full_name, email, role) values
  ('01000000-0000-0000-0000-000000000001', 'Rareș Recrut',    'rares.recrut@test.local', 'recrut'),
  ('02000000-0000-0000-0000-000000000002', 'Vlad Voluntar PR', 'vlad.pr@test.local',     'voluntar'),
  ('03000000-0000-0000-0000-000000000003', 'Raluca Responsabil', 'raluca.resp@test.local', 'responsabil');
insert into member_departments (member_id, dept_id) values
  ('01000000-0000-0000-0000-000000000001', 'edu'),
  ('02000000-0000-0000-0000-000000000002', 'pr'),
  ('03000000-0000-0000-0000-000000000003', 'edu');

insert into teams (id, name, dept_id, for_recruits) values
  ('t-pr',  'Echipa PR',       'pr',  false),
  ('t-rec', 'Echipa Recruți',  'edu', true);
insert into team_members (team_id, member_id)
  values ('t-pr', '02000000-0000-0000-0000-000000000002');

-- One event per branch of §4.4. Team events use type 'sedinta' so the
-- "calls reach everyone" branch cannot mask a team-visibility failure.
insert into events (title, type, scope, dept_id, team_id) values
  ('AG org',        'sedinta',   'org',  null,  null),   -- branch 2 (scope)
  ('Ședință EDU',   'sedinta',   'dept', 'edu', null),   -- branches 3 & 5
  ('Ședință PR',    'sedinta',   'dept', 'pr',  null),   -- branches 3 & 5
  ('Call intern PR','sedinta',   'team', 'pr',  't-pr'), -- branch 4 (team)
  ('Activitate recruți', 'activitate', 'team', 'edu', 't-rec'), -- branch 4 (recruits)
  ('Recrutare toamnă',   'recrutare',  'dept', 'hr',  null);    -- branch 2 (type)

-- ==================== Recrut: dept EDU, no teams ====================
select pg_temp.login('01000000-0000-0000-0000-000000000001', 'recrut', 0, '["edu"]', '[]');

select ok(pg_temp.sees('AG org'),            'recrut sees org-scoped events');
select ok(pg_temp.sees('Recrutare toamnă'),  'recrut sees recruitment events wherever they sit');
select ok(pg_temp.sees('Ședință EDU'),       'recrut sees their own department');
select ok(pg_temp.sees('Activitate recruți'),
  'recrut sees a for_recruits team''s events without being a member');
select ok(not pg_temp.sees('Ședință PR'),    'recrut does not see another department');
select ok(not pg_temp.sees('Call intern PR'),'recrut does not see a closed team');
select is((select count(*) from events), 4::bigint, 'recrut sees exactly four events');

reset role;

-- ==================== Voluntar: dept PR, team t-pr ====================
select pg_temp.login('02000000-0000-0000-0000-000000000002', 'voluntar', 1, '["pr"]', '["t-pr"]');

select ok(pg_temp.sees('Call intern PR'), 'a team member sees their team''s events');
select ok(pg_temp.sees('Ședință PR'),     'a member sees their own department');
select ok(not pg_temp.sees('Ședință EDU'),
  'a member does not see another department');
select ok(not pg_temp.sees('Activitate recruți'),
  'for_recruits opens a team to recruits only — not to everyone');
select is((select count(*) from events), 4::bigint, 'voluntar sees exactly four events');

select throws_ok(
  $$ insert into events (title, type, scope) values ('Eveniment neautorizat', 'sedinta', 'org') $$,
  '42501', null, 'a voluntar cannot create events');

update events set title = 'Redenumit' where title = 'Ședință PR';
select is((select count(*) from events where title = 'Redenumit'), 0::bigint,
  'a voluntar cannot edit events (silent no-op)');

reset role;

-- ==================== Responsabil (level 4): the whole calendar ====================
select pg_temp.login('03000000-0000-0000-0000-000000000003', 'responsabil', 4, '["edu"]', '[]');

select is((select count(*) from events), 6::bigint,
  'level >= 4 sees every event (seeAllEvents)');
select lives_ok(
  $$ insert into events (title, type, scope, dept_id)
     values ('Workshop CV', 'activitate', 'dept', 'edu') $$,
  'level >= 4 creates events');
select lives_ok(
  $$ update events set location = 'Sala 5' where title = 'Ședință PR' $$,
  'level >= 4 edits events in any department');

reset role;

-- ==================== The stranger: authenticated without claims ====================
-- `reset role` keeps the previous JWT — clear it, or org-scoped events would
-- make these pass for the wrong reason.
select set_config('request.jwt.claims', '', true);
set local role authenticated;

select is((select count(*) from events), 0::bigint,
  'a claimless session sees no events at all (ADR-0003 gate 2)');

reset role;

-- ==================== anon ====================
set local role anon;
select throws_ok(
  $$ select count(*) from events $$,
  '42501', null, 'anon has no access at all');
reset role;

select * from finish();
rollback;
