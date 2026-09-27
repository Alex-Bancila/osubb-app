-- Security pass 2026-09-27 (backend finding M2): Web Push subscriptions.
--
-- A Member registers a device by a direct insert into push_tokens (#66, #704);
-- token holds the browser's PushSubscription JSON, and send-push POSTs every
-- Notification to its endpoint (#703). Nothing bounded that insert, so a
-- Member could register thousands of rows whose endpoint is any https URL:
-- every Notification to them became N requests from Supabase's egress to a
-- host of their choosing (a blind SSRF and a fan-out that uses up send-push's
-- 1000 deliveries a minute for everyone else).
--
--   * push_tokens_token_length_ck: token is at most 4096 characters, for every
--     writer. A real subscription is well under 1 KB.
--   * push_tokens_guard (before insert), for a signed-in Member registering
--     their own device (auth.uid() = member_id; any other row is RLS's to
--     refuse, and owner writes -- migrations, tests -- pass through):
--       - a web token must be a subscription object: an endpoint of at most
--         2048 characters, https, on the default port, with no user info, and
--         keys.p256dh / keys.auth strings -> 23514 push_subscription_invalid;
--       - the endpoint's host must be a browser vendor's push service
--         -> 23514 push_endpoint_unsupported:
--           fcm.googleapis.com         Chrome and every Chromium browser that
--                                      has push (Edge on Android, Opera,
--                                      Samsung Internet, Brave, Vivaldi)
--           *.push.services.mozilla.com  Firefox (updates.push.services...)
--           *.push.apple.com           Safari on macOS and iOS
--                                      (web.push.apple.com; Apple documents
--                                      the wildcard)
--           *.notify.windows.com       Edge on Windows (WNS, wns2-*.notify...)
--         A browser on another push service cannot turn push on until its host
--         is added here and in send-push's isPushServiceEndpoint -- a one-line
--         change each, preferred over accepting any host;
--       - at most five devices per Member -> 23514 push_devices_limit. The
--         Member's profiles row is locked for no key update first, so two
--         concurrent registrations cannot both see four. Re-registering a
--         device the Member already has is not a new device: it passes to the
--         unique key, whose 23505 the app already treats as subscribed.
--
-- send-push checks the same host list before it fetches (a row stored before
-- this migration is never delivered off-list), reads at most 1 KB of a push
-- service's answer and gives up after 10 s.

-- ==================== 1. token length, for every writer ====================
alter table public.push_tokens
  add constraint push_tokens_token_length_ck check (char_length(token) <= 4096) not valid;
do $$ begin
  raise notice '%: % existing row(s) break it', 'push_tokens_token_length_ck',
    (select count(*) from public.push_tokens where not (char_length(token) <= 4096));
end $$;

-- ==================== 2. the Member's own registration ====================
create function private.guard_push_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_subscription jsonb;
  v_endpoint text;
  v_host text;
begin
  if v_actor is null or new.member_id is distinct from v_actor then
    return new;
  end if;

  if char_length(new.token) > 4096 then
    raise exception using errcode = '23514', message = 'push_subscription_invalid';
  end if;

  if new.platform = 'web' then
    begin
      v_subscription := new.token::jsonb;
    exception when others then
      raise exception using errcode = '23514', message = 'push_subscription_invalid';
    end;
    if jsonb_typeof(v_subscription) is distinct from 'object'
       or jsonb_typeof(v_subscription -> 'endpoint') is distinct from 'string'
       or jsonb_typeof(v_subscription -> 'keys' -> 'p256dh') is distinct from 'string'
       or jsonb_typeof(v_subscription -> 'keys' -> 'auth') is distinct from 'string'
    then
      raise exception using errcode = '23514', message = 'push_subscription_invalid';
    end if;
    v_endpoint := v_subscription ->> 'endpoint';
    -- https://<dns name>[/path]: no port, no user info, no IP literal.
    v_host := lower(substring(v_endpoint from '^https://([A-Za-z0-9.-]+)(?:/|$)'));
    if char_length(v_endpoint) > 2048 or v_host is null then
      raise exception using errcode = '23514', message = 'push_subscription_invalid';
    end if;
    if not (v_host = 'fcm.googleapis.com'
            or v_host ~ '^[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.services\.mozilla\.com$'
            or v_host ~ '^[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com$'
            or v_host ~ '^[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com$')
    then
      raise exception using errcode = '23514', message = 'push_endpoint_unsupported';
    end if;
  end if;

  -- Serialize this Member's registrations, then count.
  perform 1 from public.profiles where id = new.member_id for no key update;
  if exists (select 1 from public.push_tokens
              where member_id = new.member_id and token = new.token) then
    return new;
  end if;
  if (select count(*) from public.push_tokens where member_id = new.member_id) >= 5 then
    raise exception using errcode = '23514', message = 'push_devices_limit';
  end if;
  return new;
end;
$$;
comment on function private.guard_push_token() is
  'Security pass 2026-09-27 (M2): push_tokens_guard -- a signed-in Member''s own device registration must be a PushSubscription (https endpoint <= 2048, default port, no user info, keys.p256dh and keys.auth) on a browser vendor''s push service (fcm.googleapis.com, *.push.services.mozilla.com, *.push.apple.com, *.notify.windows.com), at most five per Member: 23514 push_subscription_invalid / push_endpoint_unsupported / push_devices_limit. Locks the Member''s profiles row for no key update before counting. Security definer so the count sees every row of the Member and the lock needs no update grant.';
revoke execute on function private.guard_push_token()
  from public, anon, authenticated, service_role;

create trigger push_tokens_guard
  before insert on public.push_tokens
  for each row execute function private.guard_push_token();
