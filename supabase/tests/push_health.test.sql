-- #769: Web Push hardening -- the hourly outbox health check that tells the
-- Moderator when push stalls, and the daily cron.job_run_details purge
-- (ADR-0010 amended 2026-09-25, ruling L8). The secret-key header of
-- osubb-send-push is asserted in push_outbox.test.sql next to #703's job.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- ==================== Jobs ====================
select is(
  (select count(*) from cron.job
    where jobname = 'osubb-push-health' and schedule = '0 * * * *' and active
      and command = 'select private.check_push_health()'),
  1::bigint, 'osubb-push-health runs private.check_push_health() every hour');
select is(
  (select count(*) from cron.job
    where jobname = 'osubb-purge-cron-history' and schedule = '45 3 * * *' and active
      and command like '%delete from cron.job_run_details%'
      and command like '%interval ''14 days''%'),
  1::bigint, 'osubb-purge-cron-history runs daily and keeps fourteen days of cron.job_run_details');
select is(
  (select count(*) from cron.job where jobname = 'osubb-send-push'),
  1::bigint, 'rescheduling osubb-send-push replaced #703''s job instead of adding a second one');

select ok(not has_function_privilege('authenticated', 'private.check_push_health()', 'execute')
      and not has_function_privilege('anon', 'private.check_push_health()', 'execute')
      and not has_function_privilege('service_role', 'private.check_push_health()', 'execute'),
  'the health job body is callable by the scheduler only');

-- ==================== Fixtures ====================
truncate public.push_deliveries;
insert into auth.users (id, email) values
  ('76900000-0000-0000-0000-000000000001', 'moderator.769@test.local'),
  ('76900000-0000-0000-0000-000000000002', 'moderator.inactive.769@test.local'),
  ('76900000-0000-0000-0000-000000000003', 'bc.769@test.local'),
  ('76900000-0000-0000-0000-000000000004', 'device.769@test.local');
insert into public.profiles (id, full_name, email, role, status) values
  ('76900000-0000-0000-0000-000000000001', 'Moderator 769', 'moderator.769@test.local', 'moderator', 'activ'),
  ('76900000-0000-0000-0000-000000000002', 'Inactive 769', 'moderator.inactive.769@test.local', 'moderator', 'inactiv'),
  ('76900000-0000-0000-0000-000000000003', 'BC 769', 'bc.769@test.local', 'bc', 'activ'),
  ('76900000-0000-0000-0000-000000000004', 'Device 769', 'device.769@test.local', 'voluntar', 'activ');
insert into public.push_tokens (member_id, token, platform) values
  ('76900000-0000-0000-0000-000000000004', '{"endpoint":"https://push.example/769"}', 'web');

create function pg_temp.health_rows() returns table (member_id uuid, title text, body text, read boolean)
language sql as $$
  select notification.member_id, notification.title, notification.body, notification.read
    from public.notifications as notification
   where notification.kind = 'system'
     and notification.dedupe_key = 'push_health:' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD')
$$;
-- One due delivery for the Member with a device; returns its id.
create function pg_temp.enqueue() returns bigint
language plpgsql as $$
begin
  perform private.notify(array['76900000-0000-0000-0000-000000000004'::uuid], 'task', 'Livrare 769', null, null, null, null);
  return (select max(id) from public.push_deliveries);
end;
$$;

-- ==================== Healthy outbox ====================
select is(private.check_push_health(), 0, 'an empty outbox is healthy');
select pg_temp.enqueue();
select is(private.check_push_health(), 0,
  'a pending delivery that is due now is not stalled');
update public.push_deliveries set next_attempt_at = now() - interval '14 minutes';
select is(private.check_push_health(), 0,
  'a delivery overdue by less than fifteen minutes is not stalled yet');
select is((select count(*) from pg_temp.health_rows()), 0::bigint,
  'a healthy outbox writes no Notification');

-- ==================== Stalled outbox ====================
update public.push_deliveries set next_attempt_at = now() - interval '16 minutes';
select ok(private.check_push_health() >= 1,
  'a pending delivery overdue by more than fifteen minutes is flagged');
select is(
  (select count(*) from pg_temp.health_rows() where member_id = '76900000-0000-0000-0000-000000000001'),
  1::bigint, 'the active Moderator gets one system Notification');
select is(
  (select count(*) from pg_temp.health_rows() as health
     join public.profiles as profile on profile.id = health.member_id
    where profile.role <> 'moderator' or profile.status <> 'activ'),
  0::bigint, 'nobody but active Moderators gets it -- not BC, not the Member, not an inactive Moderator');
select ok(
  (select body like '%1 livrări întârziate%0 eșuate%' from pg_temp.health_rows()
    where member_id = '76900000-0000-0000-0000-000000000001'),
  'the Notification counts the stalled and the failed deliveries');

select pg_temp.enqueue();
update public.push_deliveries set next_attempt_at = now() - interval '20 minutes';
select private.check_push_health();
select is(
  (select count(*) from pg_temp.health_rows() where member_id = '76900000-0000-0000-0000-000000000001'),
  1::bigint, 'a later run the same day refreshes the unread Notification instead of adding one');
select ok(
  (select body like '%2 livrări întârziate%' from pg_temp.health_rows()
    where member_id = '76900000-0000-0000-0000-000000000001'),
  'and the refreshed row carries the new count');

truncate public.push_deliveries;
delete from public.notifications where dedupe_key like 'push_health:%';
select pg_temp.enqueue();
update public.push_deliveries set status = 'sending', attempts = 1,
       next_attempt_at = now() - interval '16 minutes';
select ok(private.check_push_health() >= 1,
  'a sending delivery whose lease ran out fifteen minutes ago is flagged as stalled');

-- ==================== Failed deliveries ====================
truncate public.push_deliveries;
delete from public.notifications where dedupe_key like 'push_health:%';
select pg_temp.enqueue() from generate_series(1, 20);
update public.push_deliveries set status = 'failed', last_error = 'HTTP 403: test';
select is(private.check_push_health(), 0, 'twenty failed deliveries in a day are tolerated');
select pg_temp.enqueue();
update public.push_deliveries set status = 'failed', last_error = 'HTTP 403: test'
 where id = (select max(id) from public.push_deliveries);
select ok(private.check_push_health() >= 1, 'the twenty-first failed delivery in a day is flagged');
delete from public.notifications where dedupe_key like 'push_health:%';
update public.push_deliveries set created_at = now() - interval '25 hours'
 where id = (select max(id) from public.push_deliveries);
select is(private.check_push_health(), 0, 'a failure older than 24 hours does not count');

-- ==================== cron.job_run_details purge ====================
insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
values
  (0, 76900001, 0, 'postgres', 'postgres', 'select 769', 'succeeded', 'old',
   now() - interval '15 days', now() - interval '15 days'),
  (0, 76900002, 0, 'postgres', 'postgres', 'select 769', 'succeeded', 'recent',
   now() - interval '13 days', now() - interval '13 days'),
  (0, 76900003, 0, 'postgres', 'postgres', 'select 769', 'failed', 'never ended',
   now() - interval '15 days', null);
do $$ begin execute (select command from cron.job where jobname = 'osubb-purge-cron-history'); end $$;
select is(
  (select array_agg(return_message order by runid) from cron.job_run_details where runid between 76900001 and 76900003),
  array['recent'],
  'the purge deletes runs that ended, or started without ending, more than fourteen days ago and keeps a recent one');

select * from finish();
rollback;
