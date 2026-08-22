-- provision_profile.test.sql — Epic 2.3a: the shared provisioning path.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- ==================== Privileges ====================
select has_function('public', 'provision_profile', 'provision_profile() exists');

select ok(
  has_function_privilege('service_role',
    'public.provision_profile(uuid, text, text, member_role, text[], text[])', 'execute'),
  'the server identity may provision');
select ok(
  not has_function_privilege('authenticated',
    'public.provision_profile(uuid, text, text, member_role, text[], text[])', 'execute'),
  'a logged-in member may not provision');
select ok(
  not has_function_privilege('anon',
    'public.provision_profile(uuid, text, text, member_role, text[], text[])', 'execute'),
  'anon may not provision');

select is(
  (select prosecdef from pg_proc where proname = 'provision_profile'),
  true, 'runs as its owner (security definer) so it bypasses RLS');

-- ==================== Fixtures: invited auth users ====================
insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-0000000000b1', 'Ioana.Provision@Test.Local'),
  ('b2000000-0000-0000-0000-0000000000b2', 'mihai.provision@test.local'),
  ('b3000000-0000-0000-0000-0000000000b3', 'sonia.provision@test.local');
insert into teams (id, name, dept_id) values ('t-prov', 'Provision Team', 'edu');

-- ==================== One call = a complete member (AC) ====================
select is(
  provision_profile('b1000000-0000-0000-0000-0000000000b1', 'Ioana Test',
                    'Ioana.Provision@Test.Local', 'voluntar',
                    array['edu', 'pr'], array['t-prov']),
  'b1000000-0000-0000-0000-0000000000b1'::uuid,
  'provisioning returns the member id');

select is(
  (select role from profiles where id = 'b1000000-0000-0000-0000-0000000000b1'),
  'voluntar'::member_role, 'the requested role is applied');
select is(
  (select email from profiles where id = 'b1000000-0000-0000-0000-0000000000b1'),
  'ioana.provision@test.local', 'the email is normalised (lowercased, trimmed)');
select is(
  (select count(*) from member_departments
    where member_id = 'b1000000-0000-0000-0000-0000000000b1'), 2::bigint,
  'both departments are linked');
select is(
  (select count(*) from team_members
    where member_id = 'b1000000-0000-0000-0000-0000000000b1'), 1::bigint,
  'the team is linked');

-- A recruit with no team yet is a normal case, not an error.
select lives_ok(
  $$ select provision_profile('b2000000-0000-0000-0000-0000000000b2', 'Mihai Test',
                              'mihai.provision@test.local', 'recrut', array['hr']) $$,
  'a recruit can be provisioned without any team');

-- ==================== Atomicity: a typo creates nothing (AC) ====================
select throws_ok(
  $$ select provision_profile('b3000000-0000-0000-0000-0000000000b3', 'Sonia Test',
                              'sonia.provision@test.local', 'voluntar',
                              array['edu', 'departament-inexistent']) $$,
  '23503', null, 'an unknown department id aborts the call');

select is(
  (select count(*) from profiles where id = 'b3000000-0000-0000-0000-0000000000b3'),
  0::bigint, 'no half-created member survives the failure (all or nothing)');

select * from finish();
rollback;
