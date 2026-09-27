-- Security pass 2026-09-27 (backend finding M2): a Member's Web Push
-- registration is a real browser subscription on a vendor push service, at
-- most five per Member. Migration 20260927170000_push_token_limits.sql.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(22);
truncate public.push_tokens cascade;

insert into auth.users (id, email) values
  ('b2000000-0000-0000-0000-000000000001', 'push-limit-1@test.local'),
  ('b2000000-0000-0000-0000-000000000002', 'push-limit-2@test.local');
insert into profiles (id, full_name, email, role, status) values
  ('b2000000-0000-0000-0000-000000000001', 'Five Devices', 'push-limit-1@test.local', 'voluntar', 'activ'),
  ('b2000000-0000-0000-0000-000000000002', 'Probe', 'push-limit-2@test.local', 'voluntar', 'activ');

-- A subscription as the browser serializes it (PushSubscription.toJSON()).
create function pg_temp.sub(p_endpoint text) returns text language sql immutable as $$
  select jsonb_build_object('endpoint', p_endpoint, 'expirationTime', null,
    'keys', jsonb_build_object('p256dh', 'BPublicKey', 'auth', 'authSecret'))::text;
$$;
grant execute on function pg_temp.sub(text) to authenticated;

-- ==================== the four vendor push services, then the cap ====================
select pg_temp.test_login_leadership('b2000000-0000-0000-0000-000000000001');
select lives_ok($$insert into push_tokens (member_id, token, platform)
  values (auth.uid(), pg_temp.sub('https://fcm.googleapis.com/fcm/send/device-1'), 'web')$$,
  'Chrome (FCM) registers');
select lives_ok($$insert into push_tokens (member_id, token, platform)
  values (auth.uid(), pg_temp.sub('https://updates.push.services.mozilla.com/wpush/v2/device-2'), 'web')$$,
  'Firefox (Mozilla autopush) registers');
select lives_ok($$insert into push_tokens (member_id, token, platform)
  values (auth.uid(), pg_temp.sub('https://web.push.apple.com/device-3'), 'web')$$,
  'Safari (Apple) registers');
select lives_ok($$insert into push_tokens (member_id, token, platform)
  values (auth.uid(), pg_temp.sub('https://wns2-par02p.notify.windows.com/w/?token=device-4'), 'web')$$,
  'Edge on Windows (WNS) registers');
select lives_ok($$insert into push_tokens (member_id, token, platform)
  values (auth.uid(), pg_temp.sub('https://FCM.googleapis.com/fcm/send/device-5'), 'web')$$,
  'a fifth device registers (the host is matched case-insensitively)');
select throws_ok($$insert into push_tokens (member_id, token, platform)
  values (auth.uid(), pg_temp.sub('https://fcm.googleapis.com/fcm/send/device-6'), 'web')$$,
  '23514', 'push_devices_limit', 'a sixth device is refused: push_devices_limit');
select throws_ok($$insert into push_tokens (member_id, token, platform)
  values (auth.uid(), pg_temp.sub('https://fcm.googleapis.com/fcm/send/device-1'), 'web')$$,
  '23505', null, 'at the cap, re-registering a device the Member has is the unique key''s 23505 (which the app reads as subscribed), not the limit');
with removed as (
  delete from push_tokens where token = pg_temp.sub('https://web.push.apple.com/device-3') returning id)
select is(count(*), 1::bigint, 'the Member removes one device') from removed;
select lives_ok($$insert into push_tokens (member_id, token, platform)
  values (auth.uid(), pg_temp.sub('https://fcm.googleapis.com/fcm/send/device-6'), 'web')$$,
  'and may then register a new one in its place');
reset role;
select is((select count(*) from push_tokens where member_id = 'b2000000-0000-0000-0000-000000000001'),
  5::bigint, 'the Member holds exactly five devices');

-- ==================== endpoints that are not a vendor push service ====================
select pg_temp.test_login_leadership('b2000000-0000-0000-0000-000000000002');
select throws_ok($$insert into push_tokens (member_id, token, platform)
  values (auth.uid(), pg_temp.sub('https://evil.example/collect'), 'web')$$,
  '23514', 'push_endpoint_unsupported', 'an arbitrary https host is refused');
select throws_ok($$insert into push_tokens (member_id, token, platform)
  values (auth.uid(), pg_temp.sub('https://127.0.0.1/internal'), 'web')$$,
  '23514', 'push_endpoint_unsupported', 'an IP literal is refused');
select throws_ok($$insert into push_tokens (member_id, token, platform)
  values (auth.uid(), pg_temp.sub('https://fcm.googleapis.com.evil.example/x'), 'web')$$,
  '23514', 'push_endpoint_unsupported', 'a vendor name used as a subdomain of another host is refused');
select throws_ok($$insert into push_tokens (member_id, token, platform)
  values (auth.uid(), pg_temp.sub('https://evilpush.apple.com/x'), 'web')$$,
  '23514', 'push_endpoint_unsupported', 'a host that only ends in the vendor''s letters is refused');
select throws_ok($$insert into push_tokens (member_id, token, platform)
  values (auth.uid(), pg_temp.sub('http://fcm.googleapis.com/fcm/send/x'), 'web')$$,
  '23514', 'push_subscription_invalid', 'plain http is refused');
select throws_ok($$insert into push_tokens (member_id, token, platform)
  values (auth.uid(), pg_temp.sub('https://fcm.googleapis.com:8443/fcm/send/x'), 'web')$$,
  '23514', 'push_subscription_invalid', 'an explicit port is refused');
select throws_ok($$insert into push_tokens (member_id, token, platform)
  values (auth.uid(), pg_temp.sub('https://me@fcm.googleapis.com/fcm/send/x'), 'web')$$,
  '23514', 'push_subscription_invalid', 'user info in the endpoint is refused');
select throws_ok($$insert into push_tokens (member_id, token, platform)
  values (auth.uid(), pg_temp.sub('https://fcm.googleapis.com/' || repeat('x', 2048)), 'web')$$,
  '23514', 'push_subscription_invalid', 'an endpoint over 2048 characters is refused');
select throws_ok($$insert into push_tokens (member_id, token, platform)
  values (auth.uid(), 'not-a-subscription', 'web')$$,
  '23514', 'push_subscription_invalid', 'a token that is not JSON is refused');
select throws_ok($$insert into push_tokens (member_id, token, platform)
  values (auth.uid(), '{"endpoint":"https://fcm.googleapis.com/fcm/send/x"}', 'web')$$,
  '23514', 'push_subscription_invalid', 'a subscription without its keys is refused');
reset role;

-- ==================== every writer: the token length ====================
select pg_temp.test_clear_jwt();
select throws_ok($$insert into push_tokens (member_id, token, platform)
  values ('b2000000-0000-0000-0000-000000000002', repeat('x', 4097), 'android')$$,
  '23514', null, 'push_tokens_token_length_ck bounds the token for every writer, owner included');
select lives_ok($$insert into push_tokens (member_id, token, platform)
  values ('b2000000-0000-0000-0000-000000000002', '{"endpoint":"https://push.example/fixture"}', 'web')$$,
  'an owner write (migrations, test fixtures) passes the Member rule through');

select * from finish();
rollback;
