-- #968: self-service re-send of an invitation from the login page
--
-- An invitation's link and code live about an hour. After that an invitee
-- who never accepted is stuck: with sign-ups off, Auth answers a magic-link
-- request for an unconfirmed account with signup_disabled and sends nothing,
-- and only BC could re-send (reinvite-member, #773). The login page now calls
-- the request-invitation Edge Function on that answer, and the function asks
-- this database whether to re-send.
--
-- The function has no JWT -- its caller has not signed in -- so the database
-- is the throttle as well as the judge. public.request_invitation_allowed
-- answers 'send' only for an invited, unconfirmed, never-signed-in account
-- whose profile is activ, at most once a minute and five times a day per
-- address; 'ip_limited' at twenty requests an hour from one IP; 'cooldown'
-- over an address limit; 'skip' for everything else, one word for every
-- reason, because the function answers them all alike. Nothing is created:
-- only an invitation BC already made is re-sent (ADR-0003 amendment of
-- 2026-10-01).
--
-- The request log holds hashes only -- SHA-256 of the trimmed, lower-cased
-- address, and the function's 32-character hash of the caller's IP -- and
-- forgets everything after 24 hours, purging as it goes. Core sha256() is
-- used rather than pgcrypto's digest(): no extension to depend on.
--
-- Same shape as #776's notify_email_delivery_problem: service_role has no
-- usage on private (conventions §4, machine-checked by conventions.test.sql),
-- so the public wrapper is security definer and executable by service_role
-- alone, and the private body is granted to nobody.

create table private.invitation_requests (
  email_hash   text        not null,
  ip_hash      text,
  requested_at timestamptz not null default now(),
  constraint invitation_requests_email_hash_ck
    check (email_hash ~ '^[0-9a-f]{64}$'),
  constraint invitation_requests_ip_hash_ck
    check (ip_hash is null or ip_hash ~ '^[0-9a-f]{32}$')
);

comment on table private.invitation_requests is
  '#968: every request to re-send an invitation from the login page, as hashes only -- SHA-256 hex of the trimmed, lower-cased address and the request-invitation function''s 32-character hash of the caller''s IP (null when it had none). The check constraints refuse anything else, so a typed address can never be stored. Written only by private.request_invitation_allowed_impl, which counts these rows for its limits and purges rows older than 24 hours. Not exposed to PostgREST (private) and granted to nobody.';

create index invitation_requests_email_hash_requested_at_idx
  on private.invitation_requests (email_hash, requested_at);
create index invitation_requests_ip_hash_requested_at_idx
  on private.invitation_requests (ip_hash, requested_at);

alter table private.invitation_requests enable row level security;
revoke all on table private.invitation_requests
  from public, anon, authenticated, service_role;

create function private.request_invitation_allowed_impl(
  p_email   text,
  p_ip_hash text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email  text := lower(btrim(p_email));
  v_hash   text;
  v_now    timestamptz;
  v_recent bigint;
  v_today  bigint;
begin
  -- 1. Malformed for every caller: nothing is recorded.
  if v_email is null or v_email = '' then
    raise sqlstate 'PT400' using message = 'email_required';
  end if;
  if length(v_email) > 320 then
    raise sqlstate 'PT400' using message = 'email_too_long';
  end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{32}$' then
    raise sqlstate 'PT400' using message = 'invalid_ip_hash';
  end if;

  v_hash := encode(sha256(convert_to(v_email, 'UTF8')), 'hex');

  -- 2. One decision per address at a time, so two concurrent requests for
  --    one address cannot both find the minute free and both send. Released
  --    at commit or rollback, like private.require_daily_cap's.
  perform pg_advisory_xact_lock(hashtextextended('osubb.invitation_request:' || v_hash, 0));
  v_now := clock_timestamp();
  -- The address lock above serialises one address; two addresses from one
  -- IP could otherwise count and insert at once near the cap. Taken after
  -- the address lock, always in this order, so there is no cycle.
  if p_ip_hash is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('osubb.invitation_request_ip:' || p_ip_hash, 0));
  end if;

  -- 3. Forget what is past every window, then record this call -- whatever
  --    the verdict, so an address or an IP that keeps asking stays limited.
  delete from private.invitation_requests as request
   where request.requested_at < v_now - interval '24 hours';
  insert into private.invitation_requests (email_hash, ip_hash, requested_at)
  values (v_hash, p_ip_hash, v_now);

  -- 4. Per IP, this call included: the 20th in an hour is refused. Without
  --    an IP hash only the address limits apply.
  if p_ip_hash is not null and (
       select count(*)
         from private.invitation_requests as request
        where request.ip_hash = p_ip_hash
          and request.requested_at > v_now - interval '1 hour') >= 20 then
    return 'ip_limited';
  end if;

  -- 5. Per address, this call excluded (it is always inside both windows):
  --    one earlier request in the last minute, or five in the last day, and
  --    nothing is sent.
  select count(*) filter (where request.requested_at > v_now - interval '60 seconds') - 1,
         count(*) - 1
    into v_recent, v_today
    from private.invitation_requests as request
   where request.email_hash = v_hash
     and request.requested_at > v_now - interval '24 hours';
  if v_recent >= 1 or v_today >= 5 then
    return 'cooldown';
  end if;

  -- 6. Only an invitation that exists and was never used is re-sent.
  if exists (
       select 1
         from auth.users as account
         join public.profiles as profile on profile.id = account.id
        where lower(account.email) = v_email
          and account.invited_at is not null
          and account.email_confirmed_at is null
          and account.last_sign_in_at is null
          and profile.status = 'activ') then
    return 'send';
  end if;
  return 'skip';
end;
$$;

comment on function private.request_invitation_allowed_impl(text, text) is
  '#968: body of public.request_invitation_allowed. PT400 email_required (null or blank p_email), PT400 email_too_long (over 320 characters, trimmed) and PT400 invalid_ip_hash (p_ip_hash not null and not 32 lower-case hex characters), recording nothing. Otherwise, under a transaction advisory lock per address hash: purges private.invitation_requests rows older than 24 hours, records this call (SHA-256 hex of the trimmed, lower-cased address; the IP hash) and answers, in order: ip_limited when p_ip_hash has 20 or more rows in the last hour, this call included; cooldown when the address has another row in the last 60 seconds, or 5 or more other rows in the last 24 hours (so the sixth request of a day is refused); send when an auth.users row with that address (case-insensitive) has invited_at set, email_confirmed_at null and last_sign_in_at null and its profiles row is activ; skip otherwise -- unknown, confirmed, signed in, never invited, without a profile, or inactive alike. Granted to nobody: only the security-definer wrapper calls it.';

revoke execute on function private.request_invitation_allowed_impl(text, text)
  from public, anon, authenticated, service_role;

create function public.request_invitation_allowed(
  p_email   text,
  p_ip_hash text
)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.request_invitation_allowed_impl(p_email, p_ip_hash);
$$;

comment on function public.request_invitation_allowed(text, text) is
  '#968: request-invitation only (service_role, reached with the project''s secret key). Security definer because service_role has no usage on private (conventions §4); does nothing but call private.request_invitation_allowed_impl, which see. Answers send, skip, cooldown or ip_limited; only send makes the function re-send the invitation, and only ip_limited changes what its caller is told.';

revoke execute on function public.request_invitation_allowed(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.request_invitation_allowed(text, text)
  to service_role;
