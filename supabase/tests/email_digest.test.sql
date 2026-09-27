-- #775: the Email Digest -- the self-only preference, the selection (opted-in
-- only, unread only, older than one hour, once per Notification, one digest
-- per Member per day), the quota guard in the claim (serialized, so two
-- overlapping claims cannot spend the same remaining quota), the settle
-- outcomes, the job body's Bucharest hours, the email_daily_quota setting,
-- and the grants.
--
-- Mutation guards, each named against the assertion that turns red:
--   * drop `least(p_limit, ...quota_remaining...)` from the claim -> "the
--     claim hands out no more digests than the quota" returns three;
--   * drop the org_settings `for no key update` in the claim -> the race's
--     second claim takes the other digest instead of none;
--   * drop `not notification.read` / the one-hour bound / `digested_at is
--     null` / the preference join in the selection -> the "only n1" array
--     assertion grows;
--   * drop the opt-out re-check in the claim -> "a Member who opted out after
--     the enqueue is skipped" finds the row claimed.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(61);

create function pg_temp.u(n integer) returns uuid language sql immutable as $$
  select ('77500000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- ==================== Claim race (committed fixtures) ====================
-- Two digests are due and one email is left in today's quota. The first
-- claim takes one and holds its transaction open; the second must wait on the
-- quota row and then find nothing left. test_race needs committed rows its
-- two sessions can see; setup and cleanup are idempotent, and the cleanup
-- puts the seeded quota back.
select extensions.dblink_connect('digest_775_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres', current_database()));
select extensions.dblink_exec('digest_775_setup', 'set lock_timeout = ''2s''');
select extensions.dblink_exec('digest_775_setup', $setup$
  drop function if exists public.test_775_claim();
  delete from auth.users where id in ('77500000-0000-0000-0000-000000000091', '77500000-0000-0000-0000-000000000092');
  insert into auth.users (id, email) values
    ('77500000-0000-0000-0000-000000000091', 'race.a.775@test.local'),
    ('77500000-0000-0000-0000-000000000092', 'race.b.775@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('77500000-0000-0000-0000-000000000091', 'Race A 775', 'race.a.775@test.local', 'voluntar', 'activ'),
    ('77500000-0000-0000-0000-000000000092', 'Race B 775', 'race.b.775@test.local', 'voluntar', 'activ');
  insert into public.notification_email_preferences (member_id, digest_enabled) values
    ('77500000-0000-0000-0000-000000000091', true),
    ('77500000-0000-0000-0000-000000000092', true);
  insert into public.notifications (member_id, kind, title, created_at) values
    ('77500000-0000-0000-0000-000000000091', 'task', 'race 775 a', now() - interval '2 hours'),
    ('77500000-0000-0000-0000-000000000092', 'task', 'race 775 b', now() - interval '2 hours');
  insert into private.email_digests (member_id, digest_day, notification_ids)
  select notification.member_id, current_date - 3650, array[notification.id]
    from public.notifications as notification
   where notification.title in ('race 775 a', 'race 775 b');
  update public.org_settings set value = '1' where key = 'email_daily_quota';
  -- Test-only callable bridge to the service-role claim, never a production grant.
  create function public.test_775_claim() returns text
  language sql security definer set search_path = '' as $$
    select coalesce(string_agg(claimed.digest_id::text, ','), 'none')
      from public.claim_email_digests(10) as claimed
  $$;
  revoke execute on function public.test_775_claim() from public, anon, authenticated, service_role;
  grant execute on function public.test_775_claim() to authenticated;
$setup$);

select pg_temp.test_login('77500000-0000-0000-0000-000000000091', '{"member_role":"voluntar","member_level":1}');
create temporary table race_775 as
select * from pg_temp.test_race('select public.test_775_claim()', 'select public.test_775_claim()');
reset role;
select pg_temp.test_clear_jwt();

select ok(
  (select result_a <> 'none' and position(',' in result_a) = 0 and result_b = 'none' and b_waited from race_775),
  'with one email left in the quota, the first claim takes one digest and the overlapping second waits on the quota row and then claims none');

select extensions.dblink_exec('digest_775_setup', $cleanup$
  drop function if exists public.test_775_claim();
  delete from auth.users where id in ('77500000-0000-0000-0000-000000000091', '77500000-0000-0000-0000-000000000092');
  update public.org_settings set value = '90' where key = 'email_daily_quota';
$cleanup$);
select extensions.dblink_disconnect('digest_775_setup');

-- ==================== Schema, grants, job ====================
select ok((select relrowsecurity from pg_class where oid = 'public.notification_email_preferences'::regclass),
  'notification_email_preferences has RLS on');
select ok((select relrowsecurity from pg_class where oid = 'private.email_digests'::regclass),
  'the email_digests outbox has RLS on');
select is(
  array[has_table_privilege('authenticated', 'private.email_digests', 'select'),
        has_table_privilege('service_role', 'private.email_digests', 'select'),
        has_table_privilege('anon', 'private.email_digests', 'select'),
        has_table_privilege('authenticated', 'private.email_digests', 'insert')],
  array[false, false, false, false],
  'no client role can read or write the outbox');
select is(
  array[has_function_privilege('service_role', 'public.claim_email_digests(integer)', 'execute'),
        has_function_privilege('authenticated', 'public.claim_email_digests(integer)', 'execute'),
        has_function_privilege('anon', 'public.claim_email_digests(integer)', 'execute'),
        has_function_privilege('service_role', 'public.settle_email_digest(bigint, integer, text, text, text)', 'execute'),
        has_function_privilege('authenticated', 'public.settle_email_digest(bigint, integer, text, text, text)', 'execute'),
        has_function_privilege('anon', 'public.settle_email_digest(bigint, integer, text, text, text)', 'execute')],
  array[true, false, false, true, false, false],
  'claim and settle are send-digest''s alone (service_role)');
select ok(not has_function_privilege('authenticated', 'private.prepare_email_digests(timestamp with time zone)', 'execute')
      and not has_function_privilege('service_role', 'private.prepare_email_digests(timestamp with time zone)', 'execute')
      and not has_function_privilege('service_role', 'private.enqueue_email_digests(timestamp with time zone)', 'execute'),
  'the job body and the selection are the scheduler''s alone');
select is(
  (select count(*) from cron.job
    where jobname = 'osubb-email-digest' and schedule = '0 * * * *' and active
      and command like '%/functions/v1/send-digest%'
      and command like '%''apikey''%name = ''secret_key''%'
      and command like '%where private.prepare_email_digests()%'
      and command not like '%service_role_key%'),
  1::bigint,
  'osubb-email-digest runs hourly and calls send-digest with the Vault secret_key on apikey when the job body says so');

-- ==================== Fixtures ====================
-- 1 opted in (Nickname Mimi), 2 opted out, 3 never touched the switch,
-- 4 opted in but inactive, 5 opted in with nothing unread, 6 BC,
-- 7-9 opted in (the quota queue).
insert into auth.users (id, email)
select pg_temp.u(n), 'digest.' || n || '.775@test.local' from generate_series(1, 9) as n;
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.u(n), 'Digest 775 ' || n, 'digest.' || n || '.775@test.local',
       (case when n = 6 then 'bc' else 'voluntar' end)::member_role,
       (case when n = 4 then 'inactiv' else 'activ' end)::member_status
  from generate_series(1, 9) as n;
update public.profiles set nickname = 'Mimi' where id = pg_temp.u(1);
insert into public.notification_email_preferences (member_id, digest_enabled) values
  (pg_temp.u(2), false), (pg_temp.u(4), true), (pg_temp.u(5), true),
  (pg_temp.u(7), true), (pg_temp.u(8), true), (pg_temp.u(9), true);

insert into public.notifications (member_id, kind, title, read, created_at, digested_at) values
  (pg_temp.u(1), 'task',     'n1',      false, now() - interval '2 hours',    null),
  (pg_temp.u(1), 'announce', 'n2 new',  false, now() - interval '30 minutes', null),
  (pg_temp.u(1), 'event',    'n3 read', true,  now() - interval '2 hours',    null),
  (pg_temp.u(1), 'task',     'n4 done', false, now() - interval '3 days',     now() - interval '2 days'),
  (pg_temp.u(1), 'deadline', 'n6',      false, now() - interval '3 hours',    null),
  (pg_temp.u(2), 'task', 'opted out',   false, now() - interval '2 hours', null),
  (pg_temp.u(3), 'task', 'untouched',   false, now() - interval '2 hours', null),
  (pg_temp.u(4), 'task', 'inactive',    false, now() - interval '2 hours', null),
  (pg_temp.u(5), 'task', 'all read',    true,  now() - interval '2 hours', null),
  (pg_temp.u(7), 'task', 'q7',          false, now() - interval '2 hours', null),
  (pg_temp.u(8), 'task', 'q8',          false, now() - interval '2 hours', null),
  (pg_temp.u(9), 'task', 'q9',          false, now() - interval '2 hours', null);

create function pg_temp.n(p_title text) returns bigint language sql stable as $$
  select id from public.notifications where title = p_title and member_id::text like '77500000-%'
$$;
create function pg_temp.digest_of(p_member uuid) returns private.email_digests
language sql stable security definer set search_path = '' as $$
  select * from private.email_digests where member_id = p_member order by id desc limit 1
$$;

-- ==================== The preference: self-only ====================
select pg_temp.test_login_leadership(pg_temp.u(1));
select lives_ok(
  $$ insert into public.notification_email_preferences (member_id) values (auth.uid()) $$,
  'a Member writes their own preference');
select is((select digest_enabled from public.notification_email_preferences where member_id = auth.uid()),
  false, 'the digest is off by default');
select lives_ok(
  $$ insert into public.notification_email_preferences (member_id, digest_enabled) values (auth.uid(), true)
     on conflict (member_id) do update set digest_enabled = excluded.digest_enabled $$,
  'a Member turns it on with the switch''s upsert');
select is((select count(*) from public.notification_email_preferences), 1::bigint,
  'a Member reads only their own preference');
select throws_ok(
  format($$ insert into public.notification_email_preferences (member_id, digest_enabled) values (%L, true) $$, pg_temp.u(3)),
  '42501', null, 'a Member cannot opt another Member in');
with changed as (
  update public.notification_email_preferences set digest_enabled = true where member_id = pg_temp.u(2) returning 1)
select is((select count(*) from changed), 0::bigint, 'a Member cannot change another Member''s preference');
with deleted as (
  delete from public.notification_email_preferences where member_id = pg_temp.u(5) returning 1)
select is((select count(*) from deleted), 0::bigint, 'a Member cannot delete another Member''s preference');
reset role;

select pg_temp.test_login(pg_temp.u(4), '{"member_role":"voluntar","member_level":1}');
select is((select count(*) from public.notification_email_preferences), 0::bigint,
  'a deactivated Member with a stale token reads nothing, their own row included');
with changed as (
  update public.notification_email_preferences set digest_enabled = false where member_id = auth.uid() returning 1)
select is((select count(*) from changed), 0::bigint, 'a deactivated Member cannot change their preference either');
reset role;
select pg_temp.test_clear_jwt();

set local role anon;
select throws_ok($$ select count(*) from public.notification_email_preferences $$,
  '42501', null, 'anon holds no privilege on the preference');
reset role;

-- ==================== The selection ====================
select is(private.enqueue_email_digests(now()), 4,
  'one digest each for the four opted-in, active Members with something unread and old enough (1, 7, 8, 9)');
select is(
  (select array_agg(member_id order by member_id) from private.email_digests where member_id::text like '77500000-%'),
  array[pg_temp.u(1), pg_temp.u(7), pg_temp.u(8), pg_temp.u(9)],
  'nobody opted out, untouched, inactive or with nothing unread gets a digest');
select is((pg_temp.digest_of(pg_temp.u(1))).notification_ids,
  array[pg_temp.n('n1'), pg_temp.n('n6')],
  'the digest covers the unread Notifications older than one hour and not digested before -- not the newer one, the read one or the one already digested');
select is((pg_temp.digest_of(pg_temp.u(1))).digest_day, (now() at time zone 'Europe/Bucharest')::date,
  'the digest is keyed to the Bucharest day');
select ok(
  (select bool_and(digested_at = now()) from public.notifications where id in (pg_temp.n('n1'), pg_temp.n('n6')))
  and (select bool_and(digested_at is null) from public.notifications where id in (pg_temp.n('n2 new'), pg_temp.n('n3 read')))
  and (select digested_at < now() - interval '1 day' from public.notifications where id = pg_temp.n('n4 done')),
  'only the Notifications put into the digest are stamped digested_at');
select is(private.enqueue_email_digests(now()), 0,
  'a second run the same day writes nothing: one digest a day');
select is(private.enqueue_email_digests(now() + interval '1 day'), 0,
  'the next day writes nothing either while the earlier digest is still waiting');

-- Claim order is oldest first; make it deterministic: 1, 7, 8, 9.
update private.email_digests
   set created_at = now() - (10 - right(member_id::text, 1)::integer) * interval '1 minute'
 where member_id::text like '77500000-%';

-- ==================== The quota guard ====================
update public.org_settings set value = '2' where key = 'email_daily_quota';
select is(private.email_digest_quota_remaining(now()), 2, 'nothing sent yet: the whole quota remains');

set local role service_role;
create temporary table claim_775 as select * from public.claim_email_digests(10);
reset role;
select is((select count(*) from claim_775), 2::bigint,
  'the claim hands out no more digests than the quota, however many are due and whatever p_limit says');
select is(
  (select array_agg(member_id order by member_id) from private.email_digests
    where status = 'sending' and member_id::text like '77500000-%'),
  array[pg_temp.u(1), pg_temp.u(7)], 'the oldest two are claimed');
select results_eq(
  format($$ select email, member_name, unread_count, attempt,
                   (select array_agg(item ->> 'title') from jsonb_array_elements(items) as item)
              from claim_775 where digest_id = %s $$, (pg_temp.digest_of(pg_temp.u(1))).id),
  $$ values ('digest.1.775@test.local'::text, 'Mimi'::text, 2, 1, array['n1', 'n6']) $$,
  'a claimed digest carries the address, the Nickname, the unread count and the Notifications, newest first');
select is(private.email_digest_quota_remaining(now()), 0, 'digests being sent count against the quota');

set local role service_role;
select is((select count(*) from public.claim_email_digests(10)), 0::bigint,
  'with the quota spent, nothing more is claimed');
select is(
  public.settle_email_digest((pg_temp.digest_of(pg_temp.u(1))).id, 1, 'sent', null, 're_775'),
  'sent', 'a delivered digest settles sent');
reset role;
select ok((pg_temp.digest_of(pg_temp.u(1))).sent_at is not null
      and (pg_temp.digest_of(pg_temp.u(1))).provider_id = 're_775',
  'sent stamps sent_at and keeps Resend''s id');

set local role service_role;
select is(public.settle_email_digest((pg_temp.digest_of(pg_temp.u(7))).id, 1, 'failed', 'HTTP 422: invalid to'),
  'failed', 'a refused address settles failed');
reset role;
select is(private.email_digest_quota_remaining(now()), 1,
  'a sent digest keeps counting against today''s quota; a failed one gives its slot back');

-- A Member who turns the switch off after the morning's enqueue gets nothing.
update public.notification_email_preferences set digest_enabled = false where member_id = pg_temp.u(8);
set local role service_role;
create temporary table claim_775_b as select * from public.claim_email_digests(10);
reset role;
select is((select count(*) from claim_775_b), 1::bigint, 'the one slot left goes to one digest');
select ok((select member_id = pg_temp.u(9) from private.email_digests where id = (select digest_id from claim_775_b)),
  'the slot went to the next Member still opted in');
select is(array[(pg_temp.digest_of(pg_temp.u(8))).status, (pg_temp.digest_of(pg_temp.u(8))).last_error],
  array['skipped', 'opted_out'],
  'a Member who opted out after the enqueue is skipped at send time: the switch stops it the same day');

-- ==================== Settle ====================
set local role service_role;
select is(public.settle_email_digest((pg_temp.digest_of(pg_temp.u(9))).id, 2, 'sent'), null,
  'a settle quoting another attempt changes nothing (fenced to the lease)');
select throws_ok(
  format($$ select public.settle_email_digest(%s, 1, 'bounced') $$, (pg_temp.digest_of(pg_temp.u(9))).id),
  'PT400', 'invalid_digest_outcome', 'an unknown outcome is refused');
select is(public.settle_email_digest((pg_temp.digest_of(pg_temp.u(9))).id, 1, 'retry', 'HTTP 503'),
  'pending', 'a passing failure goes back to pending');
reset role;
select ok((pg_temp.digest_of(pg_temp.u(9))).next_attempt_at between now() + interval '59 minutes' and now() + interval '61 minutes',
  'the first retry waits one hour');
select is(private.email_digest_quota_remaining(now()), 1, 'a digest waiting to retry holds no quota');

update private.email_digests set next_attempt_at = now() - interval '1 minute' where member_id = pg_temp.u(9);
set local role service_role;
select is((select attempt from public.claim_email_digests(10)), 2, 'the retry is claimed again as attempt two');
select is(public.settle_email_digest((pg_temp.digest_of(pg_temp.u(9))).id, 2, 'deferred', 'daily_quota_exceeded'),
  'pending', 'Resend''s own quota defers the digest');
reset role;
select ok((pg_temp.digest_of(pg_temp.u(9))).attempts = 1
      and (pg_temp.digest_of(pg_temp.u(9))).next_attempt_at
          = (((now() at time zone 'Europe/Bucharest')::date + 1) + time '07:00') at time zone 'Europe/Bucharest',
  'a deferred digest gives its attempt back and waits for 07:00 Bucharest the next day');

-- ==================== Skipped at send time ====================
insert into private.email_digests (member_id, digest_day, notification_ids) values
  (pg_temp.u(5), (now() at time zone 'Europe/Bucharest')::date, array[pg_temp.n('all read')]),
  (pg_temp.u(4), (now() at time zone 'Europe/Bucharest')::date, array[pg_temp.n('inactive')]);
set local role service_role;
select is((select count(*) from public.claim_email_digests(10)), 0::bigint,
  'a digest with nothing unread left, or for an inactive Member, is never claimed');
reset role;
select is(
  array[(pg_temp.digest_of(pg_temp.u(5))).last_error, (pg_temp.digest_of(pg_temp.u(4))).last_error],
  array['nothing_unread', 'member_inactive'],
  'each is skipped with its reason');

-- A pending digest the quota holds back stays pending.
update public.org_settings set value = '0' where key = 'email_daily_quota';
insert into private.email_digests (member_id, digest_day, notification_ids)
values (pg_temp.u(7), (now() at time zone 'Europe/Bucharest')::date + 1, array[pg_temp.n('q7')]);
set local role service_role;
select is((select count(*) from public.claim_email_digests(10)), 0::bigint, 'a quota of 0 pauses the digest');
reset role;
select is((pg_temp.digest_of(pg_temp.u(7))).status, 'pending', 'the held-back digest stays pending for later');

-- ==================== The job body ====================
create function pg_temp.bucharest(p_days integer, p_hour integer) returns timestamptz
language sql stable as $$
  select (((now() at time zone 'Europe/Bucharest')::date + p_days) + make_time(p_hour, 30, 0))
         at time zone 'Europe/Bucharest'
$$;
select is(private.prepare_email_digests(pg_temp.bucharest(1, 12)), false,
  'no call to send-digest while the quota is 0');
update public.org_settings set value = '90' where key = 'email_daily_quota';
select is(private.prepare_email_digests(pg_temp.bucharest(1, 3)), false, 'no emails at night');
select is((select count(*) from private.email_digests where member_id = pg_temp.u(1)), 1::bigint,
  'and no enqueue outside 07:00');
select is(private.prepare_email_digests(pg_temp.bucharest(1, 7)), true,
  'at 07:30 Bucharest the job enqueues and asks for a send');
select is((pg_temp.digest_of(pg_temp.u(1))).notification_ids, array[pg_temp.n('n2 new')],
  'the next morning''s digest covers only what was not digested yet: each Notification is emailed once');
select is(private.prepare_email_digests(pg_temp.bucharest(1, 22)), false, 'none after 21:59');

-- ==================== The quota setting ====================
select pg_temp.test_login_leadership(pg_temp.u(6));
select is((select value from public.set_org_setting('email_daily_quota', ' 120 ')), '120',
  'BC sets the quota through set_org_setting');
select is((select value from public.set_org_setting('email_daily_quota', '0')), '0', 'a quota of 0 is allowed');
select throws_ok($$ select public.set_org_setting('email_daily_quota', 'nouăzeci') $$,
  'PT400', 'invalid_org_setting_value', 'the quota is a whole number');
select throws_ok($$ select public.set_org_setting('email_daily_quota', '') $$,
  'PT400', 'invalid_org_setting_value', 'the quota is never cleared');
select throws_ok($$ select public.set_org_setting('email_daily_quota', '100000') $$,
  'PT400', 'invalid_org_setting_value', 'the quota is at most 99999');
reset role;
select throws_ok($$ update public.org_settings set value = '-1' where key = 'email_daily_quota' $$,
  '23514', 'new row for relation "org_settings" violates check constraint "org_settings_email_daily_quota_ck"',
  'org_settings_email_daily_quota_ck refuses a malformed quota on a direct write too');

select * from finish();
rollback;
