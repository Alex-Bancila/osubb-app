-- member_level.test.sql — Epic 2.3b support: server-side level lookup.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(8);

-- ==================== Privileges ====================
select has_function('public', 'member_level', 'member_level() exists');
select ok(
  has_function_privilege('service_role', 'public.member_level(uuid)', 'execute'),
  'server code may ask for a member''s level');
select ok(
  not has_function_privilege('authenticated', 'public.member_level(uuid)', 'execute'),
  'clients may not — they carry their own level in the JWT');
select is(
  (select prosecdef from pg_proc where proname = 'member_level'),
  true, 'runs as its owner, so it works with RLS on');

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('0a100000-0000-0000-0000-00000000a001', 'bc.level@test.local'),
  ('0a200000-0000-0000-0000-00000000a002', 'recrut.level@test.local'),
  ('0a300000-0000-0000-0000-00000000a003', 'plecat.level@test.local');
insert into profiles (id, full_name, email, role, status) values
  ('0a100000-0000-0000-0000-00000000a001', 'Bogdan BC',   'bc.level@test.local',     'bc',       'activ'),
  ('0a200000-0000-0000-0000-00000000a002', 'Rareș Recrut', 'recrut.level@test.local', 'recrut',   'activ'),
  ('0a300000-0000-0000-0000-00000000a003', 'Paul Plecat', 'plecat.level@test.local', 'bc',       'inactiv');

-- ==================== Answers ====================
select is(member_level('0a100000-0000-0000-0000-00000000a001'), 6,
  'a BC is level 6');
select is(member_level('0a200000-0000-0000-0000-00000000a002'), 0,
  'a recrut is level 0');
select is(member_level('0a300000-0000-0000-0000-00000000a003'), 0,
  'a deactivated BC drops to 0 — the level travels with the status');
select is(member_level('0a900000-0000-0000-0000-00000000a999'), 0,
  'an unknown id is 0, never null (callers just compare a threshold)');

select * from finish();
rollback;
