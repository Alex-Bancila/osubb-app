-- request_invitation.test.sql -- #968: an invited Member re-sends their own
-- invitation from the login page. public.request_invitation_allowed decides,
-- for the request-invitation Edge Function, whether to re-send: 'send' only
-- for an invited, unconfirmed, never-signed-in, activ account under its
-- limits (one request a minute, five a day per address); 'ip_limited' at 20
-- requests an hour from one IP hash; 'cooldown' over an address limit;
-- 'skip' for everything else. Every call is recorded, as hashes only.
-- Runs in one transaction and rolls back -- leaves no residue in the local db.
--
-- now() is fixed for the whole transaction while the function measures its
-- windows with clock_timestamp(), so a backdated fixture row is written
-- relative to clock_timestamp() too.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(30);

-- ==================== Structure and grants ====================
select ok(
  (select prosecdef from pg_proc
    where oid = 'public.request_invitation_allowed(text, text)'::regprocedure),
  'the wrapper is security definer: service_role has no usage on private, so an invoker wrapper could never reach the body');

select is(
  array(
    select grantee
      from unnest(array['public', 'anon', 'authenticated', 'service_role']) as grantee
     where has_function_privilege(grantee, 'public.request_invitation_allowed(text, text)', 'execute')
  ),
  array['service_role'],
  'only service_role (the request-invitation function''s secret-key client) may execute the wrapper');

select is(
  array(
    select grantee
      from unnest(array['public', 'anon', 'authenticated', 'service_role']) as grantee
     where has_function_privilege(grantee, 'private.request_invitation_allowed_impl(text, text)', 'execute')
  ),
  '{}'::text[],
  'nobody may execute the body directly -- only the wrapper, as its owner');

select ok(
  (select relrowsecurity from pg_class
    where oid = 'private.invitation_requests'::regclass),
  'private.invitation_requests has row level security on');

select is(
  array(
    select grantee || ':' || privilege
      from unnest(array['public', 'anon', 'authenticated', 'service_role']) as grantee
     cross join unnest(array['select', 'insert', 'update', 'delete']) as privilege
     where has_table_privilege(grantee, 'private.invitation_requests', privilege)
  ),
  '{}'::text[],
  'no client role reads or writes the request log: only the security-definer body does');

-- ==================== Fixtures ====================
-- 01 the one who should get a fresh invitation; the rest each fail one
-- condition of 'send' and nothing else.
insert into auth.users (id, email, invited_at, email_confirmed_at, last_sign_in_at) values
  ('96800000-0000-0000-0000-000000000001', 'invited@test.local',     now() - interval '2 hours', null, null),
  ('96800000-0000-0000-0000-000000000002', 'confirmed@test.local',   now() - interval '2 hours', now() - interval '1 hour', null),
  ('96800000-0000-0000-0000-000000000003', 'signedin@test.local',    now() - interval '2 hours', null, now() - interval '1 hour'),
  ('96800000-0000-0000-0000-000000000004', 'inactiv@test.local',     now() - interval '2 hours', null, null),
  ('96800000-0000-0000-0000-000000000005', 'handmade@test.local',    null,                       null, null),
  ('96800000-0000-0000-0000-000000000006', 'noprofile@test.local',   now() - interval '2 hours', null, null),
  ('96800000-0000-0000-0000-000000000007', 'fourtoday@test.local',   now() - interval '9 hours', null, null),
  ('96800000-0000-0000-0000-000000000008', 'fivetoday@test.local',   now() - interval '9 hours', null, null),
  ('96800000-0000-0000-0000-000000000009', 'yesterday@test.local',   now() - interval '2 days',  null, null),
  ('96800000-0000-0000-0000-000000000010', 'busyip@test.local',      now() - interval '2 hours', null, null);
insert into public.profiles (id, full_name, email, role, status) values
  ('96800000-0000-0000-0000-000000000001', 'Ana Invitată',   'invited@test.local',   'recrut', 'activ'),
  ('96800000-0000-0000-0000-000000000002', 'Bogdan Confirmat', 'confirmed@test.local', 'recrut', 'activ'),
  ('96800000-0000-0000-0000-000000000003', 'Carmen Conectată', 'signedin@test.local', 'recrut', 'activ'),
  ('96800000-0000-0000-0000-000000000004', 'Dan Inactiv',    'inactiv@test.local',   'recrut', 'inactiv'),
  ('96800000-0000-0000-0000-000000000005', 'Elena Manual',   'handmade@test.local',  'recrut', 'activ'),
  ('96800000-0000-0000-0000-000000000007', 'Florin Patru',   'fourtoday@test.local', 'recrut', 'activ'),
  ('96800000-0000-0000-0000-000000000008', 'Gabi Cinci',     'fivetoday@test.local', 'recrut', 'activ'),
  ('96800000-0000-0000-0000-000000000009', 'Horia Ieri',     'yesterday@test.local', 'recrut', 'activ'),
  ('96800000-0000-0000-0000-000000000010', 'Ioana IP',       'busyip@test.local',    'recrut', 'activ');

create function pg_temp.hash_of(p_email text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(p_email, 'UTF8')), 'hex')
$$;

-- Earlier requests: four and five inside the day, five from before it.
insert into private.invitation_requests (email_hash, requested_at)
select pg_temp.hash_of('fourtoday@test.local'), clock_timestamp() - make_interval(hours => n)
  from generate_series(1, 4) as n;
insert into private.invitation_requests (email_hash, requested_at)
select pg_temp.hash_of('fivetoday@test.local'), clock_timestamp() - make_interval(hours => n)
  from generate_series(1, 5) as n;
insert into private.invitation_requests (email_hash, requested_at)
select pg_temp.hash_of('yesterday@test.local'), clock_timestamp() - make_interval(hours => 24 + n)
  from generate_series(1, 5) as n;

-- One IP, 18 requests in the last hour (for other addresses) and five from
-- before it.
insert into private.invitation_requests (email_hash, ip_hash, requested_at)
select pg_temp.hash_of('other' || n || '@test.local'), repeat('a', 32),
       clock_timestamp() - make_interval(mins => n)
  from generate_series(1, 18) as n;
insert into private.invitation_requests (email_hash, ip_hash, requested_at)
select pg_temp.hash_of('older' || n || '@test.local'), repeat('a', 32),
       clock_timestamp() - make_interval(mins => 60 + n)
  from generate_series(1, 5) as n;

-- ==================== Nobody but the function may ask ====================
select pg_temp.test_login('96800000-0000-0000-0000-000000000001',
  '{"role": "recrut", "level": 0, "groups": []}'::jsonb);
select throws_ok(
  $$select public.request_invitation_allowed('invited@test.local', null)$$,
  '42501', null,
  'a signed-in session cannot execute the wrapper');
select pg_temp.test_clear_jwt();
reset role;

set local role anon;
select throws_ok(
  $$select public.request_invitation_allowed('invited@test.local', null)$$,
  '42501', null,
  'anon (the publishable key) cannot execute the wrapper');
reset role;

-- ==================== Malformed for every caller ====================
set local role service_role;
select throws_ok(
  $$select public.request_invitation_allowed('   ', null)$$,
  'PT400', 'email_required',
  'a blank address is malformed, before anything is recorded');
select throws_ok(
  $$select public.request_invitation_allowed('invited@test.local', '203.0.113.7')$$,
  'PT400', 'invalid_ip_hash',
  'an IP hash that is not 32 hex characters is refused -- a raw address never reaches the table');

-- ==================== The verdicts ====================
select is(public.request_invitation_allowed('  Invited@Test.LOCAL ', null), 'send',
  'an invited, unconfirmed, never-signed-in, activ account gets its invitation re-sent -- the address trimmed and lower-cased');
select is(public.request_invitation_allowed('invited@test.local', null), 'cooldown',
  'a second request for the address within 60 seconds sends nothing');
select is(public.request_invitation_allowed('nobody@test.local', null), 'skip',
  'an address with no account gets nothing');
select is(public.request_invitation_allowed('confirmed@test.local', null), 'skip',
  'a confirmed address gets nothing: it signs in with an ordinary link');
select is(public.request_invitation_allowed('signedin@test.local', null), 'skip',
  'an account that has signed in gets nothing');
select is(public.request_invitation_allowed('inactiv@test.local', null), 'skip',
  'an inactive Member gets nothing: an invitation would open nothing');
select is(public.request_invitation_allowed('handmade@test.local', null), 'skip',
  'an account that was never invited gets nothing -- this re-sends invitations, it creates none');
select is(public.request_invitation_allowed('noprofile@test.local', null), 'skip',
  'an Auth user without a profile gets nothing');
select is(public.request_invitation_allowed('fourtoday@test.local', null), 'send',
  'the fifth request in a day still sends');
select is(public.request_invitation_allowed('fivetoday@test.local', null), 'cooldown',
  'the sixth request in a day sends nothing');
select is(public.request_invitation_allowed('yesterday@test.local', null), 'send',
  'requests older than 24 hours no longer count');
reset role;

-- ==================== The log ====================
select is(
  (select count(*)::int from private.invitation_requests
    where requested_at < clock_timestamp() - interval '24 hours'),
  0,
  'rows older than 24 hours are purged as the function goes');
select is(
  (select count(*)::int from private.invitation_requests
    where email_hash = pg_temp.hash_of('fourtoday@test.local')),
  5,
  'rows inside the 24 hours are kept, and the call itself was recorded');
select is(
  (select count(*)::int from private.invitation_requests
    where email_hash = pg_temp.hash_of('invited@test.local')),
  2,
  'the stored hash is the SHA-256 of the trimmed, lower-cased address, and a cooldown is recorded too');
select is(
  (select count(*)::int from private.invitation_requests
    where email_hash = pg_temp.hash_of('nobody@test.local')),
  1,
  'a skipped address is recorded like any other: the log does not depend on the account');
select is(
  (select count(*)::int from private.invitation_requests
    where email_hash !~ '^[0-9a-f]{64}$'
       or ip_hash !~ '^[0-9a-f]{32}$'
       or email_hash like '%@%' or ip_hash like '%@%'),
  0,
  'only hashes are stored: no address, no IP');
select throws_ok(
  $$insert into private.invitation_requests (email_hash) values ('invited@test.local')$$,
  '23514', 'new row for relation "invitation_requests" violates check constraint "invitation_requests_email_hash_ck"',
  'the table itself refuses a typed address');

-- ==================== Per IP ====================
set local role service_role;
select is(public.request_invitation_allowed('stranger@test.local', repeat('a', 32)), 'skip',
  'the 19th request in an hour from one IP hash is answered -- its requests from before the hour do not count');
select is(public.request_invitation_allowed('busyip@test.local', repeat('a', 32)), 'ip_limited',
  'the 20th request in an hour from one IP hash is refused, even for an address that would be sent');
select is(public.request_invitation_allowed('stranger2@test.local', repeat('b', 32)), 'skip',
  'another IP hash is not limited by the first one''s requests');
reset role;

select is(
  (select count(*)::int from private.invitation_requests
    where ip_hash = repeat('a', 32)
      and requested_at > clock_timestamp() - interval '1 hour'),
  20,
  'the refused call is recorded too, so an IP that keeps asking stays limited');

select * from finish();
rollback;
