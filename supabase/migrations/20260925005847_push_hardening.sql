-- #769: Web Push hardening before production (ADR-0010 amended 2026-09-25,
-- ruling L8): the cron call authenticates with the project's secret key, an
-- hourly health check tells the Moderator when the outbox stalls, and a daily
-- job keeps cron.job_run_details to fourteen days. The outbox schema, its
-- trigger and the claim/settle commands are unchanged.

-- 1. osubb-send-push, rescheduled under the same name (pg_cron updates the
-- job in place). The only change from #703's body is the header: the Vault
-- row secret_key (the project's sb_secret_ key) goes on apikey, which
-- send-push compares with the platform's SUPABASE_SECRET_KEYS in constant
-- time; verify_jwt = false in config.toml. The legacy service_role JWT and
-- the Vault row service_role_key are no longer read. Vault rows are created
-- by hand per environment (docs/backend/push.md) and read when the job runs,
-- never here, so this migration applies where the row does not exist yet.
select cron.schedule('osubb-send-push', '* * * * *', $cron$
select net.http_post(
         url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
                || '/functions/v1/send-push',
         headers := jsonb_build_object(
           'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key'),
           'Content-Type', 'application/json'),
         body := '{}'::jsonb,
         timeout_milliseconds := 60000)
 where exists (
   select 1 from public.push_deliveries
    where status in ('pending', 'sending') and next_attempt_at <= now())
$cron$);

-- 2. The health check. A delivery due for more than fifteen minutes means
-- nothing is sending (the job is paused, the Vault rows or the function are
-- missing, the key is wrong); more than twenty failures in a day means the
-- push services refuse what is sent (a VAPID fault). Either way one system
-- Notification per UTC day reaches every active Moderator: the dedupe key
-- makes a later run refresh the unread row's counts in place, and an
-- in-place refresh pushes nothing (ADR-0010). A 'sending' row counts as
-- stalled too: its next_attempt_at is the end of its lease, and a lease that
-- ran out fifteen minutes ago has not been reclaimed by anyone.
create function private.check_push_health()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stalled integer;
  v_failed  integer;
  v_moderators uuid[];
begin
  select count(*) into v_stalled
    from public.push_deliveries as delivery
   where delivery.status in ('pending', 'sending')
     and delivery.next_attempt_at < now() - interval '15 minutes';

  select count(*) into v_failed
    from public.push_deliveries as delivery
   where delivery.status = 'failed'
     and delivery.created_at >= now() - interval '24 hours';

  if v_stalled = 0 and v_failed <= 20 then
    return 0;
  end if;

  select array_agg(profile.id order by profile.id) into v_moderators
    from public.profiles as profile
   where profile.role = 'moderator'
     and profile.status = 'activ';

  return private.notify(
    v_moderators,
    'system',
    'Notificările push nu mai ajung la membri',
    format('În coada push sunt %s livrări întârziate cu peste 15 minute și %s eșuate în ultimele 24 de ore. '
           'Verifică jobul osubb-send-push și rândurile din Vault (docs/backend/push.md).',
           v_stalled, v_failed),
    null,
    'push_health:' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD'),
    null);
end;
$$;

comment on function private.check_push_health() is
  'Hourly pg_cron job osubb-push-health (#769). When push_deliveries has a pending or sending row whose next_attempt_at passed more than 15 minutes ago, or more than 20 failed rows created in the last 24 hours, writes one system Notification to every active Moderator through private.notify with the dedupe key push_health:<UTC date>, so there is one unread row per day whose counts each later run refreshes. Returns the number of Notifications written or refreshed (0 when the outbox is healthy).';

revoke execute on function private.check_push_health()
  from public, anon, authenticated, service_role;

select cron.schedule('osubb-push-health', '0 * * * *',
  'select private.check_push_health()');

-- 3. pg_cron writes a cron.job_run_details row per run -- 1,440 a day from
-- osubb-send-push alone -- and never deletes one. Two weeks is enough to
-- read back what a job did; a run that never recorded an end is aged by its
-- start.
select cron.schedule('osubb-purge-cron-history', '45 3 * * *', $cron$
delete from cron.job_run_details
 where coalesce(end_time, start_time) < now() - interval '14 days'
$cron$);
