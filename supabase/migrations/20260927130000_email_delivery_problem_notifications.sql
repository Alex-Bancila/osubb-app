-- #776 (ruling L20): a Resend bounce, complaint or suppression becomes an
-- in-app Notification for BC.
--
-- The resend-webhook Edge Function verifies Resend's signature and calls
-- public.notify_email_delivery_problem with the project's secret key, which
-- the gateway maps to service_role. service_role has no usage on the private
-- schema (conventions §4, machine-checked by conventions.test.sql), so the
-- public wrapper is security definer -- the one way a service_role caller
-- reaches a private body without punching a hole through that boundary --
-- and it is executable by service_role alone. The body is granted to nobody:
-- only the wrapper, running as its owner, calls it.
--
-- Recipients are every live active Member at level >= 6 (BC and the
-- Moderator), the same set #52's Retention Signal uses. One Notification per
-- recipient per address per Bucharest day: the dedupe key is
-- email_delivery:<lower address>:<yyyy-mm-dd>, and a recipient who already
-- holds that key -- read or not -- is skipped, so Resend's retries and a
-- bounce followed by its suppression the same day write nothing new.
--
-- Before any of that, each Resend delivery is recorded once: the svix-id
-- header (unique per event; Resend delivers at least once and retries for
-- about a day and a half) with the recipient address, in
-- private.resend_webhook_deliveries. A delivery id already recorded for that
-- address writes nothing, so a replayed request -- inside the function's
-- five-minute signature window, or a retry the next Bucharest day, which the
-- per-day key alone would let through -- never notifies twice. Rows older
-- than seven days are purged on the way in.

create table private.resend_webhook_deliveries (
  delivery_id text        not null,
  email       text        not null,
  received_at timestamptz not null default now(),
  primary key (delivery_id, email),
  constraint resend_webhook_deliveries_delivery_id_length_ck
    check (length(delivery_id) between 1 and 255),
  constraint resend_webhook_deliveries_email_length_ck
    check (length(email) between 1 and 320)
);

comment on table private.resend_webhook_deliveries is
  '#776: every Resend webhook delivery (svix-id) already acted on, per recipient address -- one event can name several. Written only by private.notify_email_delivery_problem_impl, which skips a pair already here and purges rows older than seven days. Not exposed to PostgREST (private) and granted to nobody.';

create index resend_webhook_deliveries_received_at_idx
  on private.resend_webhook_deliveries (received_at);

alter table private.resend_webhook_deliveries enable row level security;
revoke all on table private.resend_webhook_deliveries
  from public, anon, authenticated, service_role;

create function private.notify_email_delivery_problem_impl(
  p_delivery_id text,
  p_email       text,
  p_event       text,
  p_reason      text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery_id text := trim(p_delivery_id);
  v_email       text := lower(trim(p_email));
  v_reason      text := nullif(trim(p_reason), '');
  v_member_id   uuid;
  v_name        text;
  v_key         text;
  v_title       text;
  v_body        text;
  v_recipients  uuid[];
  v_recorded    integer;
begin
  -- 1. Malformed for every caller.
  if v_delivery_id is null or v_delivery_id = '' or length(v_delivery_id) > 255 then
    raise sqlstate 'PT400' using message = 'invalid_delivery_id';
  end if;
  if v_email is null or v_email = '' then
    raise sqlstate 'PT400' using message = 'email_required';
  end if;
  if length(v_email) > 320 then
    raise sqlstate 'PT400' using message = 'email_too_long';
  end if;
  if p_event is null
     or p_event not in ('email.bounced', 'email.complained', 'email.suppressed') then
    raise sqlstate 'PT400' using message = 'invalid_email_event';
  end if;

  -- 1b. Once per delivery and address. A concurrent duplicate waits on the
  --     primary key and then finds the row: still once.
  delete from private.resend_webhook_deliveries
   where received_at < now() - interval '7 days';
  insert into private.resend_webhook_deliveries (delivery_id, email)
  values (v_delivery_id, v_email)
  on conflict (delivery_id, email) do nothing;
  get diagnostics v_recorded = row_count;
  if v_recorded = 0 then
    return 0;
  end if;

  -- 2. The Member behind the address. profiles.email is stored lowercased
  --    (invite-member, #632's sync); lower() on both sides keeps an older
  --    mixed-case row matching too. The unique constraint on profiles.email
  --    is case-sensitive, so two such rows could both match: the pick is
  --    deterministic -- the exact lowercase row first, then an activ one,
  --    then the lowest id. An address no profile carries -- a Resend test
  --    address, a Member since deleted -- is not an error: Resend would only
  --    retry it.
  select profile.id, profile.full_name
    into v_member_id, v_name
    from public.profiles as profile
   where lower(profile.email) = v_email
   order by (profile.email = v_email) desc,
            (profile.status = 'activ') desc,
            profile.id
   limit 1;
  if v_member_id is null then
    return 0;
  end if;

  v_key := 'email_delivery:' || v_email || ':'
           || to_char(now() at time zone 'Europe/Bucharest', 'YYYY-MM-DD');

  -- 3. Who is told: live active BC and Moderator, minus anyone who already
  --    holds today's key for this address.
  select array_agg(profile.id order by profile.id)
    into v_recipients
    from public.profiles as profile
    join public.roles as role on role.id = profile.role
   where profile.status = 'activ'
     and role.level >= 6
     and not exists (
       select 1 from public.notifications as notification
        where notification.member_id = profile.id
          and notification.dedupe_key = v_key);

  if v_recipients is null then
    return 0;
  end if;

  if v_reason is not null and length(v_reason) > 300 then
    v_reason := left(v_reason, 299) || '…';
  end if;

  if p_event = 'email.bounced' then
    v_title := format('Email respins: %s', v_name);
    v_body  := format('Serverul de email al adresei %s a respins un email trimis de aplicație. '
                      'Dacă respingerea e permanentă (vezi detaliile Resend), verifică adresa cu membrul; dacă nu s-a conectat niciodată, corecteaz-o și retrimite invitația din pagina lui.',
                      v_email);
  elsif p_event = 'email.complained' then
    v_title := format('Email marcat ca spam: %s', v_name);
    v_body  := format('Destinatarul adresei %s a marcat ca spam un email trimis de aplicație. '
                      'Emailurile următoare (invitații, linkuri de conectare) s-ar putea să nu mai ajungă.',
                      v_email);
  else
    v_title := format('Email blocat: %s', v_name);
    v_body  := format('Resend nu a trimis un email către %s: adresa este pe lista de suprimare, după un email respins sau marcat ca spam. '
                      'Verifică adresa cu membrul și corecteaz-o din pagina lui.',
                      v_email);
  end if;

  if v_reason is not null then
    v_body := v_body || format(' Detalii Resend: %s', v_reason);
  end if;

  return private.notify(
    v_recipients, 'system', v_title, v_body, null, v_key, null,
    '/administrare/membri/' || v_member_id::text);
end;
$$;

comment on function private.notify_email_delivery_problem_impl(text, text, text, text) is
  '#776: body of public.notify_email_delivery_problem. PT400 invalid_delivery_id (null, blank or over 255 characters), PT400 email_required (null or blank p_email), PT400 email_too_long (over 320) and PT400 invalid_email_event (anything but email.bounced, email.complained, email.suppressed). Then records (p_delivery_id, address) in private.resend_webhook_deliveries, purging rows older than seven days, and returns 0 when the pair is already there -- a replayed Resend delivery never notifies twice. Maps the trimmed, lowercased address to a profiles row case-insensitively (two case-variant rows: the exact lowercase one first, then an activ one, then the lowest id) and returns 0 -- no error -- when none carries it. Otherwise writes one system Notification through private.notify to every live active Member at level >= 6 (BC, Moderator), titled by the event and naming the Member (full name, as Administrare lists it) and the address, with Resend''s reason appended (cut to 300 characters) and a link to /administrare/membri/<member id>. Dedupe key email_delivery:<lower address>:<Europe/Bucharest yyyy-mm-dd>; a recipient who already holds it, read or not, is skipped, so a second event for the address the same day writes nothing. Returns the number of Notifications written. Granted to nobody: only the security-definer wrapper calls it.';

revoke execute on function private.notify_email_delivery_problem_impl(text, text, text, text)
  from public, anon, authenticated, service_role;

create function public.notify_email_delivery_problem(
  p_delivery_id text,
  p_email       text,
  p_event       text,
  p_reason      text default null
)
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.notify_email_delivery_problem_impl(p_delivery_id, p_email, p_event, p_reason);
$$;

comment on function public.notify_email_delivery_problem(text, text, text, text) is
  '#776: resend-webhook only (service_role, reached with the project''s secret key). Security definer because service_role has no usage on private (conventions §4); does nothing but call private.notify_email_delivery_problem_impl, which see. Returns the number of BC/Moderator Notifications written: 0 for a delivery already recorded for the address, an unknown address, or an address already reported today.';

revoke execute on function public.notify_email_delivery_problem(text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.notify_email_delivery_problem(text, text, text, text)
  to service_role;
