-- #703: Web Push outbox (Notifications x web push_tokens), its claim/settle commands for send-push, and the two cron jobs (ADR-0010).
create extension if not exists pg_net with schema extensions;

-- The outbox. No client ever reads or writes it (ADR-0010): RLS on, no
-- policy, nothing granted -- the enqueue trigger and the two service-role
-- commands below are security definer and are its only writers.
create table public.push_deliveries (
  id              bigint generated always as identity primary key,
  notification_id bigint not null references public.notifications (id) on delete cascade,
  token_id        uuid not null references public.push_tokens (id) on delete cascade,
  status          text not null default 'pending',
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  constraint push_deliveries_notification_id_token_id_key unique (notification_id, token_id),
  constraint push_deliveries_status_ck check (status in ('pending', 'sending', 'sent', 'failed')),
  constraint push_deliveries_attempts_ck check (attempts >= 0)
);

alter table public.push_deliveries enable row level security;

revoke all on table public.push_deliveries from public, anon, authenticated, service_role;
revoke all on sequence public.push_deliveries_id_seq from public, anon, authenticated, service_role;

-- The cron probe and the claim both look for due rows. 'sending' is in the
-- index because a claim is a lease: a row whose sender died is due again
-- once its next_attempt_at (claim time + 5 minutes) passes.
create index push_deliveries_due_idx on public.push_deliveries (next_attempt_at)
  where status in ('pending', 'sending');
-- Deleting a dead push token cascades through this column.
create index push_deliveries_token_id_idx on public.push_deliveries (token_id);

create function private.enqueue_push_deliveries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.push_deliveries (notification_id, token_id)
  select new.id, push_token.id
    from public.push_tokens as push_token
   where push_token.member_id = new.member_id
     and push_token.platform = 'web';
  return null;
end;
$$;

comment on function private.enqueue_push_deliveries() is
  'After-insert trigger on notifications: one push_deliveries row per web push_tokens row of the recipient. Suppression is already applied where the Notification row was written, so it is never re-applied here (ADR-0010) -- re-applying notif_suppression would silence BC''s direct Task Notifications. Only an insert enqueues: private.notify''s dedupe upsert of an unread row refreshes its text in place and does not push again. #635 adds per-Member preferences inside this function.';

revoke execute on function private.enqueue_push_deliveries()
  from public, anon, authenticated, service_role;

create trigger notifications_enqueue_push
after insert on public.notifications
for each row execute function private.enqueue_push_deliveries();

-- The two send-push commands live in public, not private: the function's
-- service client reaches the database only through PostgREST, which serves
-- public alone, and service_role has no usage on private (conventions.test.sql).
-- They are security definer and executable by service_role only, the same
-- shape as public.provision_profile.
create function public.claim_push_deliveries(p_limit integer)
returns table (
  delivery_id     bigint,
  attempt         integer,
  token           text,
  notification_id bigint,
  title           text,
  body            text,
  link            text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise sqlstate 'PT400' using message = 'invalid_limit';
  end if;

  -- A lease that ran out on the fifth attempt is not tried a sixth time.
  with stale as materialized (
    select expired.id
      from public.push_deliveries as expired
     where expired.status = 'sending'
       and expired.attempts >= 5
       and expired.next_attempt_at <= now()
       for update skip locked
  )
  update public.push_deliveries as delivery
     set status = 'failed',
         last_error = 'lease_expired'
    from stale
   where delivery.id = stale.id;

  -- skip locked: two overlapping invocations never claim the same row. The
  -- claim is a five-minute lease, longer than any function run, so a sender
  -- that dies between claim and settle loses nothing. The due set is a
  -- materialized CTE, not an IN (...) sub-select: as a semi-join the planner
  -- may rescan a LIMIT ... SKIP LOCKED sub-select and claim more than p_limit.
  return query
  with due as materialized (
    select candidate.id
      from public.push_deliveries as candidate
     where candidate.status in ('pending', 'sending')
       and candidate.next_attempt_at <= now()
     order by candidate.created_at, candidate.id
     limit p_limit
       for update skip locked
  ),
  claimed as (
    update public.push_deliveries as delivery
       set status = 'sending',
           attempts = delivery.attempts + 1,
           next_attempt_at = now() + interval '5 minutes'
      from due
     where delivery.id = due.id
    returning delivery.id, delivery.attempts, delivery.token_id, delivery.notification_id
  )
  select claimed.id, claimed.attempts, push_token.token, notification.id,
         notification.title, notification.body, notification.link
    from claimed
    join public.push_tokens as push_token on push_token.id = claimed.token_id
    join public.notifications as notification on notification.id = claimed.notification_id
   order by claimed.id;
end;
$$;

comment on function public.claim_push_deliveries(integer) is
  'send-push only (service_role). Claims up to p_limit due outbox rows (pending, or sending with an expired lease) with for update skip locked, marks them sending, increments attempts and leases them for five minutes; returns each delivery id and its attempt number (the lease the settle must quote back) with the subscription JSON (push_tokens.token) and the Notification id, title, body and link. A lease that expires after the fifth attempt turns the row failed (last_error lease_expired). PT400 invalid_limit outside 1..500.';

create function public.settle_push_delivery(p_id bigint, p_attempt integer, p_outcome text, p_error text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_outcome is null or p_outcome not in ('sent', 'retry', 'dead', 'failed') then
    raise sqlstate 'PT400' using message = 'invalid_push_outcome';
  end if;

  if p_outcome = 'dead' then
    -- The subscription is gone: drop the device, which cascades every outbox
    -- row of it. The delivery row is read, not locked, first -- two settles of
    -- sibling rows of one device then queue on the push_tokens row instead of
    -- each holding its own delivery row while the other's cascade needs it.
    delete from public.push_tokens as push_token
     where push_token.id = (
       select delivery.token_id
         from public.push_deliveries as delivery
        where delivery.id = p_id
          and delivery.status = 'sending'
          and delivery.attempts = p_attempt
     );
    return case when found then 'dead' end;
  end if;

  -- attempts was incremented by the claim, so attempts one to four wait
  -- 1, 2, 4 and 8 minutes and a retry on the fifth attempt fails for good.
  update public.push_deliveries as delivery
     set status = case
                    when p_outcome = 'sent' then 'sent'
                    when p_outcome = 'retry' and delivery.attempts < 5 then 'pending'
                    else 'failed'
                  end,
         sent_at = case when p_outcome = 'sent' then now() end,
         next_attempt_at = case
                             when p_outcome = 'retry' and delivery.attempts < 5
                               then now() + interval '1 minute' * power(2, delivery.attempts - 1)
                             else delivery.next_attempt_at
                           end,
         last_error = case when p_outcome = 'sent' then null else left(p_error, 1000) end
   where delivery.id = p_id
     and delivery.status = 'sending'
     -- Fenced to the caller's lease: a sender that stalled past five minutes
     -- cannot overwrite the outcome of the attempt that reclaimed the row.
     and delivery.attempts = p_attempt
  returning delivery.status into v_status;

  return v_status;
end;
$$;

comment on function public.settle_push_delivery(bigint, integer, text, text) is
  'send-push only (service_role). Records the outcome of one claimed (sending) delivery, fenced to the lease: p_attempt must be the attempt number the claim returned. sent stamps sent_at; retry returns it to pending 1, 2, 4 or 8 minutes ahead after attempts one to four and fails it on the fifth; dead deletes its push_tokens row, cascading every outbox row of that device; failed is terminal. p_error is kept (first 1000 characters) as last_error. Returns the resulting status (pending, sent, failed, or dead), or null when the row is no longer sending under that attempt -- a sibling''s dead already removed it, or its lease expired and another run reclaimed it. PT400 invalid_push_outcome for any other outcome.';

revoke execute on function public.claim_push_deliveries(integer),
  public.settle_push_delivery(bigint, integer, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_push_deliveries(integer),
  public.settle_push_delivery(bigint, integer, text, text)
  to service_role;

-- Every minute, and only when a row is due, POST to send-push. The project
-- URL and the service-role key differ per environment and never enter git
-- (house rule 8): they are the Vault rows project_url and service_role_key,
-- created by hand per environment (docs/backend/push.md). An idle minute
-- costs one index probe and no HTTP call.
select cron.schedule('osubb-send-push', '* * * * *', $cron$
select net.http_post(
         url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
                || '/functions/v1/send-push',
         headers := jsonb_build_object(
           'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
           'Content-Type', 'application/json'),
         body := '{}'::jsonb,
         timeout_milliseconds := 60000)
 where exists (
   select 1 from public.push_deliveries
    where status in ('pending', 'sending') and next_attempt_at <= now())
$cron$);

-- Delivery history is for diagnosing "nothing arrives"; a week is enough.
select cron.schedule('osubb-prune-push-deliveries', '15 3 * * *', $cron$
delete from public.push_deliveries
 where status in ('sent', 'failed') and created_at < now() - interval '7 days'
$cron$);
