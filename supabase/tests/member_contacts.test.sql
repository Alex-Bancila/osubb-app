-- member_contacts.test.sql — #1006: public.member_contacts replaces the
-- owner-rights profiles_contact view (the Supabase advisor's one ERROR).
--
-- The function must return exactly the rows the view returned, to exactly the
-- same viewers. Two kinds of proof:
--   1. Equivalence: the view's last definition (20260927180000_live_level_gates.sql)
--      is rebuilt below as a temporary owner-rights view, and every persona's
--      answer from the function is compared with that view's answer, row by row.
--   2. Per-branch pins, each of which turns red if its limb of the gate is removed:
--      self reads own; BCE and above read everyone; below 5 reads only their own;
--      claimless reads nothing; deactivated reads nothing, their own included;
--      a stale token is not trusted.
-- Runs in one transaction and rolls back.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(35);

truncate public.profiles cascade;

insert into auth.users (id, email) values
  ('c1006000-0000-0000-0000-000000000009', 'contacts.moderator@test.local'),
  ('c1006000-0000-0000-0000-000000000006', 'contacts.bc@test.local'),
  ('c1006000-0000-0000-0000-000000000005', 'contacts.bce@test.local'),
  ('c1006000-0000-0000-0000-000000000003', 'contacts.vot@test.local'),
  ('c1006000-0000-0000-0000-000000000001', 'contacts.voluntar@test.local'),
  ('c1006000-0000-0000-0000-000000000000', 'contacts.recrut@test.local'),
  ('c1006000-0000-0000-0000-000000000066', 'contacts.deactivated.bc@test.local'),
  ('c1006000-0000-0000-0000-000000000035', 'contacts.demoted.bce@test.local'),
  ('c1006000-0000-0000-0000-000000000077', 'contacts.alumni@test.local');

insert into public.profiles (id, full_name, email, phone, role, status) values
  ('c1006000-0000-0000-0000-000000000009', 'Contact Moderator', 'contacts.moderator@test.local', '+40700100009', 'moderator', 'activ'),
  ('c1006000-0000-0000-0000-000000000006', 'Contact BC', 'contacts.bc@test.local', '+40700100006', 'bc', 'activ'),
  ('c1006000-0000-0000-0000-000000000005', 'Contact BCE', 'contacts.bce@test.local', null, 'bce', 'activ'),
  ('c1006000-0000-0000-0000-000000000003', 'Contact Vot', 'contacts.vot@test.local', '+40700100003', 'vot', 'activ'),
  ('c1006000-0000-0000-0000-000000000001', 'Contact Voluntar', 'contacts.voluntar@test.local', '+40700100001', 'voluntar', 'activ'),
  ('c1006000-0000-0000-0000-000000000000', 'Contact Recrut', 'contacts.recrut@test.local', null, 'recrut', 'activ'),
  -- was an active BC, now deactivated: the token still says bc / 6
  ('c1006000-0000-0000-0000-000000000066', 'Contact Dezactivat', 'contacts.deactivated.bc@test.local', '+40700100066', 'bc', 'inactiv'),
  -- was BCE, now vot: the token still says bce / 5
  ('c1006000-0000-0000-0000-000000000035', 'Contact Fost BCE', 'contacts.demoted.bce@test.local', '+40700100035', 'vot', 'activ'),
  ('c1006000-0000-0000-0000-000000000077', 'Contact Alumni', 'contacts.alumni@test.local', '+40700100077', 'voluntar', 'alumni');

-- The view as main last defined it, verbatim, as a temporary owner-rights
-- view: the test runner owns it, so -- like the original -- it reads the
-- revoked columns with its owner's rights and its WHERE clause is the gate.
create temporary view legacy_profiles_contact as
  select profiles.id,
         profiles.email,
         profiles.phone
    from public.profiles
   where public.auth_is_member()
     and (select private.caller_level()) >= 0
     and (profiles.id = (select auth.uid()) or (select private.caller_level()) >= 5);
grant select on legacy_profiles_contact to authenticated;

create function pg_temp.contacts_now() returns text[]
language sql as $$
  select coalesce(array_agg(format('%s|%s|%s', id, email, phone) order by id), '{}')
    from public.member_contacts();
$$;
create function pg_temp.contacts_before() returns text[]
language sql as $$
  select coalesce(array_agg(format('%s|%s|%s', id, email, phone) order by id), '{}')
    from pg_temp.legacy_profiles_contact;
$$;
create function pg_temp.contact_ids() returns uuid[]
language sql as $$
  select coalesce(array_agg(id order by id), '{}') from public.member_contacts();
$$;

-- ==================== Structure ====================

select hasnt_view('public', 'profiles_contact', 'the owner-rights profiles_contact view is gone');
select has_function('public', 'member_contacts', array['uuid[]'], 'public.member_contacts(uuid[]) exists');
select is((select prosecdef from pg_proc where oid = 'public.member_contacts(uuid[])'::regprocedure), false,
  'the public wrapper runs as the caller: no security-definer function in the exposed schema');
select is((select prosecdef from pg_proc where oid = 'private.member_contacts_impl(uuid[])'::regprocedure), true,
  'the private body is security definer (email and phone are revoked from authenticated)');
select ok((select proconfig from pg_proc where oid = 'private.member_contacts_impl(uuid[])'::regprocedure) @> array['search_path=""'],
  'the private body pins an empty search_path');
select is(has_function_privilege('anon', 'public.member_contacts(uuid[])', 'execute'), false,
  'anon cannot call member_contacts');
select is(has_function_privilege('authenticated', 'public.member_contacts(uuid[])', 'execute'), true,
  'authenticated can call member_contacts');
select is(has_function_privilege('service_role', 'public.member_contacts(uuid[])', 'execute'), false,
  'service_role is not granted member_contacts (it never read the view either)');

-- ==================== Moderator, BC, BCE: everyone ====================

select pg_temp.test_login('c1006000-0000-0000-0000-000000000009', '{"member_role":"moderator","member_level":9}');
select is(cardinality(pg_temp.contact_ids()), 9, 'the Moderator reads every Profile''s contact details');
select is(pg_temp.contacts_now(), pg_temp.contacts_before(), 'Moderator: the same rows as the view');
reset role;

select pg_temp.test_login('c1006000-0000-0000-0000-000000000006', '{"member_role":"bc","member_level":6}');
select is(cardinality(pg_temp.contact_ids()), 9, 'a BC reads every Profile''s contact details, alumni and inactive included');
select is(pg_temp.contacts_now(), pg_temp.contacts_before(), 'BC: the same rows as the view');
select is(
  (select array_agg(format('%s|%s', email, phone)) from public.member_contacts(array['c1006000-0000-0000-0000-000000000001'::uuid])),
  array['contacts.voluntar@test.local|+40700100001'],
  'p_ids narrows a BC''s read to the Members named');
reset role;

select pg_temp.test_login('c1006000-0000-0000-0000-000000000005', '{"member_role":"bce","member_level":5}');
select is(cardinality(pg_temp.contact_ids()), 9, 'a BCE (level 5) reads every Profile''s contact details');
select is(pg_temp.contacts_now(), pg_temp.contacts_before(), 'BCE: the same rows as the view');
reset role;

-- ==================== below 5: only their own ====================

select pg_temp.test_login('c1006000-0000-0000-0000-000000000003', '{"member_role":"vot","member_level":3}');
select is(pg_temp.contact_ids(), array['c1006000-0000-0000-0000-000000000003'::uuid],
  'a vot (level 3) reads only their own contact details');
select is(pg_temp.contacts_now(), pg_temp.contacts_before(), 'vot: the same rows as the view');
reset role;

select pg_temp.test_login('c1006000-0000-0000-0000-000000000001', '{"member_role":"voluntar","member_level":1}');
select is(pg_temp.contact_ids(), array['c1006000-0000-0000-0000-000000000001'::uuid],
  'a Voluntar reads only their own contact details');
select is(pg_temp.contacts_now(), pg_temp.contacts_before(), 'Voluntar: the same rows as the view');
select is(
  (select count(*) from public.member_contacts(array['c1006000-0000-0000-0000-000000000006'::uuid])), 0::bigint,
  'naming a colleague in p_ids does not widen a Voluntar''s read');
select is(
  (select email from public.member_contacts(array['c1006000-0000-0000-0000-000000000001'::uuid])),
  'contacts.voluntar@test.local',
  'a Voluntar naming themselves in p_ids reads their own address');
reset role;

select pg_temp.test_login('c1006000-0000-0000-0000-000000000000', '{"member_role":"recrut","member_level":0}');
select is(pg_temp.contact_ids(), array['c1006000-0000-0000-0000-000000000000'::uuid],
  'a recrut (level 0) still reads their own contact details');
select is(pg_temp.contacts_now(), pg_temp.contacts_before(), 'recrut: the same rows as the view');
reset role;

-- ==================== the level is live, never the token's ====================

select pg_temp.test_login('c1006000-0000-0000-0000-000000000035', '{"member_role":"bce","member_level":5}');
select is(pg_temp.contact_ids(), array['c1006000-0000-0000-0000-000000000035'::uuid],
  'stale token: a BCE demoted to vot reads only their own contact details');
select is(pg_temp.contacts_now(), pg_temp.contacts_before(), 'demoted BCE: the same rows as the view');
reset role;

-- ==================== deactivated: nothing ====================

select pg_temp.test_login('c1006000-0000-0000-0000-000000000066', '{"member_role":"bc","member_level":6}');
select is(cardinality(pg_temp.contact_ids()), 0,
  'stale token: a deactivated BC reads no contact details, their own included');
select is(pg_temp.contacts_now(), pg_temp.contacts_before(), 'deactivated BC: the same (no) rows as the view');
reset role;

-- ==================== claimless: nothing ====================

select pg_temp.test_login('c1006000-0000-0000-0000-000000000006', jsonb_build_object('provider', 'email'));
select is(cardinality(pg_temp.contact_ids()), 0,
  'a live BC Profile without organisation claims reads no contact details');
select is(pg_temp.contacts_now(), pg_temp.contacts_before(), 'claimless BC: the same (no) rows as the view');
reset role;

select pg_temp.test_clear_jwt();
set local role authenticated;
select is(cardinality(pg_temp.contact_ids()), 0, 'a session with no JWT at all reads no contact details');
select is(pg_temp.contacts_now(), pg_temp.contacts_before(), 'no JWT: the same (no) rows as the view');
reset role;

set local role anon;
select throws_ok($$ select * from public.member_contacts() $$, '42501', null,
  'anon is refused outright');
reset role;

-- ==================== the 200-id cap ====================

select pg_temp.test_login('c1006000-0000-0000-0000-000000000006', '{"member_role":"bc","member_level":6}');
select throws_ok(
  $$ select * from public.member_contacts((select array_agg(gen_random_uuid()) from generate_series(1, 201))) $$,
  'PT400', 'too_many_ids', 'more than 200 ids is PT400 too_many_ids');
select lives_ok(
  $$ select * from public.member_contacts((select array_agg(gen_random_uuid()) from generate_series(1, 200))) $$,
  'exactly 200 ids is accepted');
select is((select count(*) from public.member_contacts(array[]::uuid[])), 0::bigint,
  'an empty id list reads nothing (null, not empty, means every row)');
reset role;

select * from finish();
rollback;
