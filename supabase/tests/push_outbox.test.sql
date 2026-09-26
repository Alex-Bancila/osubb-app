-- #703: the Web Push outbox -- enqueue trigger, claim/settle commands, the
-- backoff schedule, the two cron jobs, and deny-by-default (ADR-0010).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(49);

-- ==================== Claim race (committed fixtures) ====================
-- test_race needs committed rows its two remote sessions can see. Setup and
-- cleanup are idempotent so an interrupted run can be retried.
select extensions.dblink_connect('outbox_703_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres', current_database()));
select extensions.dblink_exec('outbox_703_setup', 'set lock_timeout = ''2s''');
select extensions.dblink_exec('outbox_703_setup', $setup$
  drop function if exists public.test_703_claim();
  delete from auth.users where id = '70300000-0000-0000-0000-000000000090';
  insert into auth.users (id, email) values ('70300000-0000-0000-0000-000000000090', 'race.703@test.local');
  insert into public.profiles (id, full_name, email, role, status)
    values ('70300000-0000-0000-0000-000000000090', 'Race 703', 'race.703@test.local', 'voluntar', 'activ');
  insert into public.push_tokens (member_id, token, platform)
    values ('70300000-0000-0000-0000-000000000090', 'race-703-device', 'web');
  insert into public.notifications (member_id, kind, title)
    values ('70300000-0000-0000-0000-000000000090', 'task', 'race 703 one'),
           ('70300000-0000-0000-0000-000000000090', 'task', 'race 703 two');
  -- Test-only callable bridge to the service-role claim, never a production grant.
  create function public.test_703_claim() returns text
  language sql security definer set search_path = '' as $$
    select coalesce(string_agg(claimed.delivery_id::text, ','), 'none')
      from public.claim_push_deliveries(1) as claimed
  $$;
  revoke execute on function public.test_703_claim() from public, anon, authenticated, service_role;
  grant execute on function public.test_703_claim() to authenticated;
$setup$);

select pg_temp.test_login('70300000-0000-0000-0000-000000000090', '{"member_role":"voluntar","member_level":1}');
create temporary table race_703 as
select * from pg_temp.test_race('select public.test_703_claim()', 'select public.test_703_claim()');
reset role;
select pg_temp.test_clear_jwt();

select ok(
  (select result_a <> 'none' and result_b <> 'none' and result_a <> result_b and not b_waited from race_703),
  'two overlapping claims each take a different row and the second never waits for the first (for update skip locked)');

select extensions.dblink_exec('outbox_703_setup', $cleanup$
  drop function if exists public.test_703_claim();
  delete from auth.users where id = '70300000-0000-0000-0000-000000000090';
$cleanup$);
select extensions.dblink_disconnect('outbox_703_setup');

-- ==================== Fixtures ====================
truncate public.push_deliveries;
insert into auth.users (id, email) values
  ('70300000-0000-0000-0000-000000000001', 'bc.703@test.local'),
  ('70300000-0000-0000-0000-000000000002', 'nodevice.703@test.local'),
  ('70300000-0000-0000-0000-000000000003', 'retry.703@test.local');
insert into public.profiles (id, full_name, email, role, status) values
  ('70300000-0000-0000-0000-000000000001', 'BC 703', 'bc.703@test.local', 'bc', 'activ'),
  ('70300000-0000-0000-0000-000000000002', 'No device 703', 'nodevice.703@test.local', 'voluntar', 'activ'),
  ('70300000-0000-0000-0000-000000000003', 'Retry 703', 'retry.703@test.local', 'voluntar', 'activ');
insert into public.push_tokens (member_id, token, platform) values
  ('70300000-0000-0000-0000-000000000001', '{"endpoint":"https://push.example/laptop"}', 'web'),
  ('70300000-0000-0000-0000-000000000001', '{"endpoint":"https://push.example/phone"}', 'web'),
  ('70300000-0000-0000-0000-000000000001', 'native-703', 'android'),
  ('70300000-0000-0000-0000-000000000003', '{"endpoint":"https://push.example/retry"}', 'web');
-- Analyse the outbox holding one page and zero live rows -- how an idle
-- production outbox looks to the planner (the claim assertions rely on it).
select private.notify(array['70300000-0000-0000-0000-000000000003'::uuid], 'task', 'Pagină', null, null, null, null);
delete from public.notifications where title = 'Pagină';
analyze public.push_deliveries;

-- ==================== Enqueue trigger ====================
-- BC is suppressed for broadcast 'task' Notifications, but a row that exists
-- was already judged deliverable -- the outbox must not re-apply the table.
select private.notify(array['70300000-0000-0000-0000-000000000001'::uuid], 'task',
  'Task nouă', 'Corp', null, null, null, '/tracker/1');
select is(
  (select count(*) from public.push_deliveries as delivery
     join public.notifications as notification on notification.id = delivery.notification_id
    where notification.member_id = '70300000-0000-0000-0000-000000000001'),
  2::bigint,
  'a Notification for a Member with two web devices enqueues two deliveries; the android device is ignored, and BC''s direct Task Notification is not re-suppressed');
select ok(
  (select bool_and(status = 'pending' and attempts = 0 and next_attempt_at <= now() and sent_at is null)
     from public.push_deliveries),
  'enqueued deliveries start pending, unattempted and due');

select private.notify(array['70300000-0000-0000-0000-000000000002'::uuid], 'task',
  'Fără dispozitiv', null, null, null, null);
select is(
  (select count(*) from public.push_deliveries as delivery
     join public.notifications as notification on notification.id = delivery.notification_id
    where notification.member_id = '70300000-0000-0000-0000-000000000002'),
  0::bigint,
  'a Member with no push device gets no delivery');

select private.notify(array['70300000-0000-0000-0000-000000000001'::uuid], 'task',
  'Coadă: 1 candidat', null, null, 'queue:7031', null);
select is((select count(*) from public.push_deliveries), 4::bigint,
  'a dedupe-keyed Notification enqueues like any insert');
select private.notify(array['70300000-0000-0000-0000-000000000001'::uuid], 'task',
  'Coadă: 2 candidați', null, null, 'queue:7031', null);
select is((select count(*) from public.push_deliveries), 4::bigint,
  'the dedupe upsert of an unread row refreshes it in place and enqueues nothing');

-- ==================== Claim ====================
select ok(has_function_privilege('service_role', 'public.claim_push_deliveries(integer)', 'execute'),
  'service_role can claim');
select ok(not has_function_privilege('authenticated', 'public.claim_push_deliveries(integer)', 'execute')
      and not has_function_privilege('anon', 'public.claim_push_deliveries(integer)', 'execute')
      and not has_function_privilege('public', 'public.claim_push_deliveries(integer)', 'execute'),
  'no client role can claim');
select ok(has_function_privilege('service_role', 'public.settle_push_delivery(bigint, integer, text, text)', 'execute'),
  'service_role can settle');
select ok(not has_function_privilege('authenticated', 'public.settle_push_delivery(bigint, integer, text, text)', 'execute')
      and not has_function_privilege('anon', 'public.settle_push_delivery(bigint, integer, text, text)', 'execute')
      and not has_function_privilege('public', 'public.settle_push_delivery(bigint, integer, text, text)', 'execute'),
  'no client role can settle');
select ok(not has_function_privilege('authenticated', 'private.enqueue_push_deliveries()', 'execute')
      and not has_function_privilege('service_role', 'private.enqueue_push_deliveries()', 'execute'),
  'the enqueue trigger body is callable by nobody');

-- With the outbox analysed empty (Fixtures), a LIMIT ... SKIP LOCKED set
-- written as an IN (...) semi-join is rescanned per outer row and claims
-- every due row; the claim's materialized CTE is immune.
set local role service_role;
create temporary table claim_703 as select * from public.claim_push_deliveries(3);
reset role;
select is((select count(*) from claim_703), 3::bigint, 'a claim returns at most p_limit rows');
select ok(
  (select bool_and(claim.token like '{"endpoint":%' and claim.title = notification.title
                   and claim.body is not distinct from notification.body
                   and claim.link is not distinct from notification.link)
     from claim_703 as claim
     join public.notifications as notification on notification.id = claim.notification_id),
  'each claimed row carries the subscription JSON and the Notification''s own title, body and link');
select ok(
  (select bool_and(status = 'sending' and attempts = 1 and next_attempt_at = now() + interval '5 minutes')
     from public.push_deliveries where id in (select delivery_id from claim_703)),
  'claimed rows are sending, attempt one, leased for five minutes');
set local role service_role;
select is((select count(*) from public.claim_push_deliveries(100)), 1::bigint,
  'a second claim takes only the row still due, never a leased one');
reset role;
select throws_ok($$select * from public.claim_push_deliveries(0)$$, 'PT400', 'invalid_limit',
  'a claim limit below one is refused');
select throws_ok($$select * from public.claim_push_deliveries(501)$$, 'PT400', 'invalid_limit',
  'a claim limit above 500 is refused');

-- A sender that died between claim and settle: its lease runs out.
update public.push_deliveries set next_attempt_at = now() - interval '1 second'
 where id = (select min(delivery_id) from claim_703);
select is((select count(*) from public.claim_push_deliveries(100)), 1::bigint,
  'a row whose lease expired is claimed again');
select is((select attempts from public.push_deliveries where id = (select min(delivery_id) from claim_703)), 2,
  'the reclaim counts as another attempt');
select is(public.settle_push_delivery((select min(delivery_id) from claim_703), 1, 'sent'), null,
  'the stalled sender''s settle quotes a stale attempt and answers null');
select is((select status || ':' || attempts from public.push_deliveries where id = (select min(delivery_id) from claim_703)),
  'sending:2', 'and leaves the reclaimed row to the run that holds its lease');
select public.settle_push_delivery((select min(delivery_id) from claim_703), 1, 'dead', 'HTTP 410');
select ok(exists (select 1 from public.push_deliveries where id = (select min(delivery_id) from claim_703)),
  'a stale dead settle deletes no device');
update public.push_deliveries set attempts = 5, next_attempt_at = now() - interval '1 second'
 where id = (select min(delivery_id) from claim_703);
select is((select count(*) from public.claim_push_deliveries(100)), 0::bigint,
  'a lease that expired on the fifth attempt is not tried a sixth time');
select is((select status || ':' || last_error from public.push_deliveries where id = (select min(delivery_id) from claim_703)),
  'failed:lease_expired', 'it fails with lease_expired instead');

-- ==================== Settle: sent / failed / invalid ====================
select is(public.settle_push_delivery((select max(delivery_id) from claim_703), 1, 'sent'), 'sent',
  'sent answers sent');
select ok(
  (select status = 'sent' and sent_at = now() and last_error is null
     from public.push_deliveries where id = (select max(delivery_id) from claim_703)),
  'sent stamps sent_at');
select is(public.settle_push_delivery((select max(delivery_id) from claim_703), 1, 'retry', 'late'), null,
  'settling a row that is no longer sending changes nothing and answers null');
select is(
  public.settle_push_delivery(
    (select delivery_id from claim_703 order by delivery_id offset 1 limit 1), 1, 'failed', 'HTTP 400: bad VAPID'),
  'failed', 'failed answers failed');
select is(
  (select status || ':' || last_error from public.push_deliveries
    where id = (select delivery_id from claim_703 order by delivery_id offset 1 limit 1)),
  'failed:HTTP 400: bad VAPID', 'failed is terminal and records the push service''s answer');
select throws_ok($$select public.settle_push_delivery(1, 1, 'maybe')$$, 'PT400', 'invalid_push_outcome',
  'an unknown outcome is refused');

-- ==================== Settle: retry backoff ====================
truncate public.push_deliveries;
select private.notify(array['70300000-0000-0000-0000-000000000003'::uuid], 'deadline',
  'Termenul se apropie', null, null, null, null);
create temporary table backoff_703 (attempt integer, outcome text, wait interval);
do $$
declare
  v_id bigint;
  v_attempt integer;
  v_outcome text;
begin
  for attempt in 1..5 loop
    select delivery_id, claimed.attempt into strict v_id, v_attempt from public.claim_push_deliveries(100) as claimed;
    v_outcome := public.settle_push_delivery(v_id, v_attempt, 'retry', 'HTTP 503');
    insert into backoff_703
    select attempt, v_outcome, delivery.next_attempt_at - now()
      from public.push_deliveries as delivery where delivery.id = v_id;
    -- Jump the clock: make the retry due now.
    update public.push_deliveries set next_attempt_at = now() where id = v_id and status = 'pending';
  end loop;
end;
$$;
select is(
  (select array_agg(wait order by attempt) from backoff_703 where attempt <= 4),
  array[interval '1 minute', interval '2 minutes', interval '4 minutes', interval '8 minutes'],
  'retries after attempts one to four wait 1, 2, 4 and 8 minutes');
select is(
  (select array_agg(outcome order by attempt) from backoff_703),
  array['pending', 'pending', 'pending', 'pending', 'failed'],
  'a retry on the fifth attempt fails for good');
select is((select last_error from public.push_deliveries), 'HTTP 503',
  'the failed row keeps the last error');

-- ==================== Settle: dead token, and device removal ====================
truncate public.push_deliveries;
select private.notify(array['70300000-0000-0000-0000-000000000001'::uuid], 'task', 'Unu', null, null, null, null);
select private.notify(array['70300000-0000-0000-0000-000000000001'::uuid], 'task', 'Doi', null, null, null, null);
create temporary table dead_703 as
select delivery.id, delivery.token_id
  from public.push_deliveries as delivery
  join public.push_tokens as push_token on push_token.id = delivery.token_id
 where push_token.token = '{"endpoint":"https://push.example/laptop"}'
 order by delivery.id limit 1;
select public.claim_push_deliveries(100);
select is(public.settle_push_delivery((select id from dead_703), 1, 'dead', 'HTTP 410'), 'dead',
  'dead answers dead');
select ok(not exists (select 1 from public.push_tokens where id = (select token_id from dead_703)),
  'dead deletes the push token');
select is(
  (select count(*) from public.push_deliveries where token_id = (select token_id from dead_703)),
  0::bigint, 'and every outbox row of that device cascades with it');
select is((select count(*) from public.push_deliveries), 2::bigint,
  'the Member''s other device keeps its deliveries');

select pg_temp.test_login_leadership('70300000-0000-0000-0000-000000000001');
delete from public.push_tokens where token = '{"endpoint":"https://push.example/phone"}';
reset role;
select pg_temp.test_clear_jwt();
select is((select count(*) from public.push_deliveries), 0::bigint,
  'a Member turning a device off removes its pending deliveries');

-- ==================== Cron jobs ====================
select is(
  (select count(*) from cron.job
    where jobname = 'osubb-send-push' and schedule = '* * * * *' and active
      and command like '%net.http_post%/functions/v1/send-push%'
      and command like '%vault.decrypted_secrets where name = ''project_url''%'
      and command like '%''apikey'', (select decrypted_secret from vault.decrypted_secrets where name = ''secret_key'')%'
      and command not like '%service_role_key%'
      and command not like '%Authorization%'),
  1::bigint, 'osubb-send-push runs every minute and sends the Vault row secret_key on apikey, with no legacy bearer (#769)');
select is(
  (select count(*) from cron.job
    where jobname = 'osubb-prune-push-deliveries' and schedule = '15 3 * * *' and active),
  1::bigint, 'osubb-prune-push-deliveries runs daily');

-- Vault rows exist per environment; the test brings its own if absent.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'project_url') then
    perform vault.create_secret('http://send-push.test.invalid', 'project_url');
  end if;
  if not exists (select 1 from vault.secrets where name = 'secret_key') then
    perform vault.create_secret('sb_secret_test-703', 'secret_key');
  end if;
end;
$$;
create function pg_temp.run_job(p_name text) returns bigint
language plpgsql as $$
declare
  v_before bigint;
begin
  select count(*) into v_before from net.http_request_queue;
  execute (select command from cron.job where jobname = p_name);
  return (select count(*) from net.http_request_queue) - v_before;
end;
$$;
select is(pg_temp.run_job('osubb-send-push'), 0::bigint,
  'with an empty outbox the send job makes no HTTP call');
select private.notify(array['70300000-0000-0000-0000-000000000003'::uuid], 'task', 'Trei', null, null, null, null);
select is(pg_temp.run_job('osubb-send-push'), 1::bigint,
  'with a due row the send job makes exactly one call');
select ok(
  (select request.url like '%/functions/v1/send-push'
          and request.headers ->> 'apikey' = (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key')
          and not request.headers ? 'Authorization'
     from net.http_request_queue as request order by request.id desc limit 1),
  'the call targets send-push with the Vault secret_key on apikey and no Authorization header (#769)');

truncate public.push_deliveries;
select private.notify(array['70300000-0000-0000-0000-000000000003'::uuid], 'task', 'Patru', null, null, null, null);
select private.notify(array['70300000-0000-0000-0000-000000000003'::uuid], 'task', 'Cinci', null, null, null, null);
select private.notify(array['70300000-0000-0000-0000-000000000003'::uuid], 'task', 'Șase', null, null, null, null);
update public.push_deliveries set created_at = now() - interval '8 days';
update public.push_deliveries set status = 'sent', sent_at = now()
 where id = (select min(id) from public.push_deliveries);
update public.push_deliveries set status = 'failed'
 where id = (select max(id) from public.push_deliveries);
select pg_temp.run_job('osubb-prune-push-deliveries');
select is((select array_agg(status) from public.push_deliveries), array['pending'],
  'the prune job deletes week-old sent and failed rows and keeps a pending one');

-- ==================== Deny-by-default ====================
select ok(
  not has_table_privilege('authenticated', 'public.push_deliveries', 'select, insert, update, delete')
  and not has_table_privilege('anon', 'public.push_deliveries', 'select, insert, update, delete')
  and not has_table_privilege('service_role', 'public.push_deliveries', 'select, insert, update, delete'),
  'nothing is granted on the outbox to any API role');
select pg_temp.test_login_leadership('70300000-0000-0000-0000-000000000003');
select throws_ok($$select count(*) from public.push_deliveries$$, '42501', null,
  'an active Member cannot read the outbox, even their own rows');
select throws_ok($$insert into public.push_deliveries (notification_id, token_id)
  select notification_id, token_id from public.push_deliveries$$, '42501', null,
  'an active Member cannot write the outbox');
reset role;
select pg_temp.test_login('70300000-0000-0000-0000-000000000003', '{}'::jsonb);
select throws_ok($$select count(*) from public.push_deliveries$$, '42501', null,
  'a claimless session cannot read the outbox');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$select count(*) from public.push_deliveries$$, '42501', null,
  'anon cannot read the outbox');
reset role;

select * from finish();
rollback;
