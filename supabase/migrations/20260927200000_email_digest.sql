-- #775: the Email Digest -- an opt-in daily email per Member listing their unread Notifications, sent through Resend by send-digest within a daily quota (ruling L20).
--
-- Five parts:
--
-- 1. public.notification_email_preferences: one row per Member who touched
--    the Profil switch "Rezumat zilnic pe email"; digest_enabled defaults
--    off, and no row means off. Self-only, like #635's push preferences --
--    a sibling table rather than a column there, because a push preference
--    is one row per (Member, kind) and the digest is one switch per Member.
--
-- 2. notifications.digested_at: stamped when a Notification is put into a
--    digest, so each Notification is emailed at most once.
--
-- 3. org_settings.email_daily_quota: how many digests may be sent per UTC
--    day. Resend's free plan allows 100 emails a day across the team, and
--    sign-in emails need the rest, so it is seeded 90. BC sets it through
--    public.set_org_setting (a whole number 0-99999, never cleared; 0 pauses
--    the digest).
--
-- 4. private.email_digests: the outbox, one row per Member per Bucharest day
--    at most, holding the ids of the Notifications it covers. RLS on, no
--    policy, granted to nobody. Only the job body and the two send-digest
--    commands below touch it.
--
-- 5. The hourly pg_cron job osubb-email-digest. At 07:00 Europe/Bucharest
--    (whatever the UTC offset: the job runs every hour and the body looks at
--    the Bucharest clock) it enqueues one digest per opted-in, live active
--    Member with unread Notifications older than one hour that no digest has
--    covered yet. Between 07:00 and 21:59 Bucharest, whenever a digest is
--    due and the day's quota is not spent, it POSTs to the Edge Function
--    send-digest with the Vault row secret_key on the apikey header, exactly
--    as osubb-send-push does. So a digest that failed for a passing reason is
--    retried within the day, and one the quota held back goes out the next
--    morning -- never at night.
--
-- send-digest claims digests with public.claim_email_digests and records
-- each outcome with public.settle_email_digest. The claim is the quota
-- guard: it never hands out more digests than email_daily_quota minus the
-- digests already sent (or being sent) this UTC day, and it re-checks at
-- send time that the Member is still opted in and active and still has
-- something unread -- so turning the switch off stops a digest the same day,
-- and a Member who read everything in the meantime gets no email.

-- ---------------------------------------------------------------------------
-- 1. The preference.
-- ---------------------------------------------------------------------------
create table public.notification_email_preferences (
  member_id      uuid primary key references public.profiles (id) on delete cascade,
  digest_enabled boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.notification_email_preferences enable row level security;

comment on table public.notification_email_preferences is
  '#775: whether a Member receives the daily Email Digest of their unread Notifications (digest_enabled, off by default; no row means off). Written by the Member alone, through the self-only policies, from Profil''s "Rezumat zilnic pe email" switch -- which is also the one-click opt-out every digest links to.';

revoke all on table public.notification_email_preferences from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.notification_email_preferences to authenticated, service_role;

create trigger notification_email_preferences_set_updated_at
before update on public.notification_email_preferences
for each row execute function private.set_updated_at();

-- Self-only, and only for a live active Member: a stale claim (house rule 12)
-- or a claimless session reads and writes nothing -- #635's shape.
create policy notification_email_preferences_read_self on public.notification_email_preferences
  for select to authenticated
  using (public.auth_is_member()
    and (select private.caller_level()) >= 0
    and member_id = (select auth.uid()));

create policy notification_email_preferences_create_self on public.notification_email_preferences
  for insert to authenticated
  with check (public.auth_is_member()
    and (select private.caller_level()) >= 0
    and member_id = (select auth.uid()));

create policy notification_email_preferences_update_self on public.notification_email_preferences
  for update to authenticated
  using (public.auth_is_member()
    and (select private.caller_level()) >= 0
    and member_id = (select auth.uid()))
  with check (public.auth_is_member()
    and (select private.caller_level()) >= 0
    and member_id = (select auth.uid()));

create policy notification_email_preferences_delete_self on public.notification_email_preferences
  for delete to authenticated
  using (public.auth_is_member()
    and (select private.caller_level()) >= 0
    and member_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. Once per Notification.
-- ---------------------------------------------------------------------------
alter table public.notifications add column digested_at timestamptz;

comment on column public.notifications.digested_at is
  '#775: when this Notification was put into an Email Digest; null until then. A Notification is digested at most once. A later private.notify refresh of the same unread row (its dedupe key) does not clear it.';

-- ---------------------------------------------------------------------------
-- 3. The daily quota, as an organization setting.
-- ---------------------------------------------------------------------------
alter table public.org_settings
  add constraint org_settings_email_daily_quota_ck
  check (key <> 'email_daily_quota'
         or (value is not null and value ~ '^(0|[1-9][0-9]{0,4})$'));

insert into public.org_settings (key, value) values ('email_daily_quota', '90');

comment on table public.org_settings is
  '#681 (ruling R20): organization-wide settings BC sets from the app instead of a migration. Every live active Member reads every row; the only write path is public.set_org_setting (BC/Moderator). Keys are reference data seeded by migrations. adherence_form_url: the adherence form link #52''s promotion notification carries (null until BC sets it). adunarea_generala_group_id (#512): the id of the Group that is the Adunarea Generală -- its Group Managers and Group Responsibles, and those of its ancestors, read the full Evaluation Period ranking (private.can_read_evaluation_rankings); null until BC sets it. vote_retention_percent (#48): y, the Vote Retention Threshold -- the top share, a whole percentage 1-100, of the Voluntar cu Drept de Vot cohort a holder must reach in a closed Evaluation Period to stay inside it (public.retention_ranking); seeded 25 (R20''s placeholder BC ratifies), never null. privacy_notice_version (#771, ruling L16): the current version of the Privacy Notice every Member acknowledges once (public.acknowledge_privacy_notice); dotted numbers such as 1.0 or 1.1, never null; bumping it re-asks everyone. email_daily_quota (#775): how many Email Digests may be sent per UTC day, a whole number 0-99999 (0 pauses the digest), never null; seeded 90, leaving Resend''s free daily cap of 100 room for sign-in emails.';

-- set_org_setting learns the new key. Rebuilt from #771's body
-- (20260927110000_privacy_notice_acknowledgements.sql, the latest definition
-- on main); what is new is the email_daily_quota shape in step 1.
create or replace function private.set_org_setting_impl(p_key text, p_value text)
returns public.org_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid;
  v_actor_level integer;
  v_value       text;
  v_setting     public.org_settings%rowtype;
begin
  -- 1. Malformed for every caller, so answered ahead of any authority verdict.
  v_value := nullif(regexp_replace(coalesce(p_value, ''),
                                   '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_text_length('value', v_value, null, 2048);
  if p_key = 'adherence_form_url'
     and v_value is not null
     and not private.is_http_url(v_value) then
    raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
  end if;
  -- #512: a Group id is a positive integer that fits a bigint.
  if p_key = 'adunarea_generala_group_id'
     and v_value is not null
     and v_value !~ '^[1-9][0-9]{0,17}$' then
    raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
  end if;
  -- #48: y is a whole percentage 1-100 and is never cleared.
  if p_key = 'vote_retention_percent'
     and (v_value is null or v_value !~ '^([1-9][0-9]?|100)$') then
    raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
  end if;
  -- #771: the Privacy Notice version is dotted numbers and is never cleared.
  if p_key = 'privacy_notice_version'
     and (v_value is null or v_value !~ '^[0-9]{1,3}(\.[0-9]{1,3}){0,2}$') then
    raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
  end if;
  -- #775: the Email Digest quota is a whole number 0-99999 and is never
  -- cleared (0 pauses the digest).
  if p_key = 'email_daily_quota'
     and (v_value is null or v_value !~ '^(0|[1-9][0-9]{0,4})$') then
    raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
  end if;

  -- 2. Authority: BC or Moderator, live, held for the transaction.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'org_settings_manage_forbidden';
  end;

  select role.level into v_actor_level
    from public.profiles as actor
    join public.roles as role on role.id = actor.role
   where actor.id = v_actor
     and actor.status = 'activ'
   for share of actor;
  if coalesce(v_actor_level, -1) < 6 then
    raise exception using errcode = '42501', message = 'org_settings_manage_forbidden';
  end if;

  -- 3. Target under lock.
  select * into v_setting
    from public.org_settings
   where key = p_key
   for update;
  if not found then
    raise sqlstate 'PT404' using message = 'org_setting_not_found';
  end if;
  -- #512: the Adunarea Generală is an existing, active Group. `for key share`
  -- keeps the row from being deleted under the write without blocking the
  -- `for no key update` every Group command takes on a Group row.
  if p_key = 'adunarea_generala_group_id' and v_value is not null then
    perform 1
      from public.groups as grp
     where grp.id = v_value::bigint
       and grp.status = 'active'
       for key share;
    if not found then
      raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
    end if;
  end if;

  -- 4. State.
  if v_value is not distinct from v_setting.value then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- 5. Write.
  update public.org_settings
     set value = v_value,
         updated_by = v_actor
   where key = p_key
  returning * into v_setting;

  return v_setting;
end;
$$;

comment on function private.set_org_setting_impl(text, text) is
  '#681, extended by #512, #48, #771 and #775: body of public.set_org_setting. Step 1 trims the value (blank -> null), PT400 value_too_long above 2048 characters, PT400 invalid_org_setting_value for an adherence_form_url that is not http(s), an adunarea_generala_group_id that is not a positive integer, a vote_retention_percent that is not a whole number 1-100 (blank included: y is never cleared), a privacy_notice_version that is not dotted numbers (1.0, 1.1, 2.0.1; blank included: the version is never cleared), or an email_daily_quota that is not a whole number 0-99999 (blank included: the quota is never cleared); then 42501 org_settings_manage_forbidden unless the caller is a live active BC or Moderator (level >= 6, Profile held for share); PT404 org_setting_not_found for an unseeded key; PT400 invalid_org_setting_value for an adunarea_generala_group_id naming no active Group (checked after the gate, so nobody below BC probes Group ids); PT409 nothing_to_update for an unchanged value.';

comment on function public.set_org_setting(text, text) is
  '#681 (ruling R20), extended by #512, #48, #771 and #775: BC or the Moderator sets one organization setting. The value is trimmed and a blank value clears it (null). adherence_form_url must be an http(s) address of at most 2048 characters; #52''s promotion notification reads it. adunarea_generala_group_id must be the id of an active Group -- the Adunarea Generală, whose Group Managers and Group Responsibles (and those of its ancestors) then read the full Evaluation Period ranking. vote_retention_percent must be a whole percentage 1-100 and cannot be cleared -- y, the share of the Voluntar cu Drept de Vot cohort public.retention_ranking marks inside. privacy_notice_version must be dotted numbers (1.0, 1.1) and cannot be cleared; raising it makes every Member acknowledge the Privacy Notice again (#771). email_daily_quota must be a whole number 0-99999 and cannot be cleared: how many Email Digests go out per UTC day (#775; 0 pauses them). Records updated_by; the trigger moves updated_at. The Administrare "Perioade de evaluare" panel (#702) calls it. Keys are seeded by migrations: an unknown key is PT404 org_setting_not_found.';

-- ---------------------------------------------------------------------------
-- 4. The outbox.
-- ---------------------------------------------------------------------------
-- digest_day is a calendar key, not an instant (conventions section 7): the
-- Bucharest date the digest was enqueued for, so the unique constraint can
-- say "one digest per Member per day".
create table private.email_digests (
  id               bigint generated always as identity primary key,
  member_id        uuid not null references public.profiles (id) on delete cascade,
  digest_day       date not null,
  notification_ids bigint[] not null,
  status           text not null default 'pending',
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  last_error       text,
  provider_id      text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,
  constraint email_digests_member_id_digest_day_key unique (member_id, digest_day),
  constraint email_digests_status_ck
    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  constraint email_digests_attempts_ck check (attempts >= 0),
  constraint email_digests_notification_ids_ck check (cardinality(notification_ids) >= 1)
);

comment on table private.email_digests is
  '#775: the Email Digest outbox -- one row per Member per Bucharest day at most (digest_day), with the ids of the Notifications it covers. pending -> sending (a 15-minute lease taken by public.claim_email_digests) -> sent / failed, or skipped when, at claim time, the Member has opted out, is no longer active, or has read every Notification in it. Written by private.enqueue_email_digests and the two send-digest commands; not exposed to PostgREST (private) and granted to nobody.';

alter table private.email_digests enable row level security;
revoke all on table private.email_digests from public, anon, authenticated, service_role;
revoke all on sequence private.email_digests_id_seq from public, anon, authenticated, service_role;

-- At most one digest in flight per Member: the next morning's enqueue skips a
-- Member whose earlier digest is still waiting, so two emails never overlap.
create unique index email_digests_member_id_open_uidx on private.email_digests (member_id)
  where status in ('pending', 'sending');
-- The job's probe and the claim look for due rows; 'sending' is a lease.
create index email_digests_due_idx on private.email_digests (next_attempt_at)
  where status in ('pending', 'sending');
-- The quota count: digests sent since the start of the UTC day.
create index email_digests_sent_at_idx on private.email_digests (sent_at)
  where status = 'sent';

-- ---------------------------------------------------------------------------
-- 5. The quota, the selection and the job body.
-- ---------------------------------------------------------------------------
create function private.email_digest_quota_remaining(p_now timestamptz)
returns integer
language sql
stable
set search_path = ''
as $$
  -- Resend's daily cap is counted per UTC day. A digest being sent counts
  -- against it already; one that failed or was deferred does not.
  select greatest(0,
    coalesce((select setting.value::integer
                from public.org_settings as setting
               where setting.key = 'email_daily_quota'), 0)
    - (select count(*)::integer
         from private.email_digests as digest
        where digest.status = 'sending'
           or (digest.status = 'sent'
               and digest.sent_at >= date_trunc('day', p_now at time zone 'UTC') at time zone 'UTC')));
$$;

comment on function private.email_digest_quota_remaining(timestamptz) is
  '#775: how many more Email Digests may be sent in the UTC day of p_now -- org_settings.email_daily_quota (0 when the row is missing) minus the digests sent since that day began and those being sent, never below 0. Read by public.claim_email_digests (the quota guard) and private.prepare_email_digests. Granted to nobody.';

revoke execute on function private.email_digest_quota_remaining(timestamptz)
  from public, anon, authenticated, service_role;

create function private.enqueue_email_digests(p_now timestamptz)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_day   date := (p_now at time zone 'Europe/Bucharest')::date;
  v_count integer;
begin
  -- Per opted-in, live active Member: every unread Notification older than
  -- one hour that no digest has covered yet. A Member who already has a
  -- digest today, or one still waiting from an earlier day, is left for the
  -- next morning. Both unique indexes make a concurrent second run insert
  -- nothing, and only what was inserted is stamped.
  with eligible as (
    select notification.member_id,
           array_agg(notification.id order by notification.id) as notification_ids
      from public.notifications as notification
      join public.notification_email_preferences as preference
        on preference.member_id = notification.member_id
       and preference.digest_enabled
      join public.profiles as profile
        on profile.id = notification.member_id
       and profile.status = 'activ'
     where not notification.read
       and notification.digested_at is null
       and notification.created_at <= p_now - interval '1 hour'
       and not exists (
         select 1
           from private.email_digests as digest
          where digest.member_id = notification.member_id
            and (digest.digest_day = v_day or digest.status in ('pending', 'sending')))
     group by notification.member_id
  ),
  inserted as (
    insert into private.email_digests (member_id, digest_day, notification_ids, next_attempt_at)
    select eligible.member_id, v_day, eligible.notification_ids, p_now
      from eligible
    on conflict do nothing
    returning email_digests.notification_ids
  ),
  stamped as (
    update public.notifications as notification
       set digested_at = p_now
      from inserted
     where notification.id = any (inserted.notification_ids)
    returning notification.id
  )
  select count(*)::integer into v_count from inserted;
  return v_count;
end;
$$;

comment on function private.enqueue_email_digests(timestamptz) is
  '#775: the Email Digest selection. For every Member with notification_email_preferences.digest_enabled and an activ Profile, gathers their unread Notifications created at least one hour before p_now with digested_at null, writes one private.email_digests row (digest_day = the Bucharest date of p_now, due at p_now) and stamps those Notifications digested_at = p_now. A Member who already has a digest for that day, or one still pending or sending, gets none. Returns the number of digests written. Run by private.prepare_email_digests at 07:00 Bucharest; granted to nobody.';

revoke execute on function private.enqueue_email_digests(timestamptz)
  from public, anon, authenticated, service_role;

create function private.prepare_email_digests(p_now timestamptz default now())
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_hour integer := extract(hour from p_now at time zone 'Europe/Bucharest')::integer;
begin
  if v_hour = 7 then
    -- A month of history is enough to answer "did my digest go out?".
    delete from private.email_digests as digest
     where digest.status in ('sent', 'failed', 'skipped')
       and digest.created_at < p_now - interval '30 days';
    perform private.enqueue_email_digests(p_now);
  end if;

  -- Emails go out in the day only: a digest held back by the quota waits for
  -- the next morning rather than leaving at the UTC midnight reset.
  return v_hour between 7 and 21
     and private.email_digest_quota_remaining(p_now) > 0
     and exists (
       select 1
         from private.email_digests as digest
        where digest.status in ('pending', 'sending')
          and digest.next_attempt_at <= p_now);
end;
$$;

comment on function private.prepare_email_digests(timestamptz) is
  '#775: body of the hourly pg_cron job osubb-email-digest. At 07:00 Europe/Bucharest (the hour of p_now on the Bucharest clock is 7, whatever the UTC offset) it purges finished digests older than 30 days and runs private.enqueue_email_digests. Returns whether the job should call send-digest now: between 07:00 and 21:59 Bucharest, with quota left today (private.email_digest_quota_remaining) and a pending or lease-expired digest due. Granted to nobody: only the scheduler runs it.';

revoke execute on function private.prepare_email_digests(timestamptz)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. The two send-digest commands.
-- ---------------------------------------------------------------------------
-- In public, not private: send-digest's client reaches the database only
-- through PostgREST, which serves public alone, and service_role has no usage
-- on private (conventions section 4). Security definer and executable by
-- service_role alone -- the shape of claim_push_deliveries.
create function public.claim_email_digests(p_limit integer)
returns table (
  digest_id    bigint,
  attempt      integer,
  email        text,
  member_name  text,
  unread_count integer,
  items        jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_take integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise sqlstate 'PT400' using message = 'invalid_limit';
  end if;

  -- One claim at a time, so two overlapping runs cannot both spend the same
  -- remaining quota. The quota row is the natural lock: set_org_setting
  -- takes it `for update` too, so a quota change waits for the claim.
  perform 1
    from public.org_settings as setting
   where setting.key = 'email_daily_quota'
     for no key update;

  -- A lease that ran out on the third attempt is not tried a fourth time.
  update private.email_digests as digest
     set status = 'failed',
         last_error = 'lease_expired'
   where digest.status = 'sending'
     and digest.attempts >= 3
     and digest.next_attempt_at <= now();

  -- Re-checked at send time: a Member who turned the switch off, left, or
  -- read everything since the morning gets no email.
  update private.email_digests as digest
     set status = 'skipped',
         last_error = case
           when not exists (
             select 1 from public.notification_email_preferences as preference
              where preference.member_id = digest.member_id
                and preference.digest_enabled) then 'opted_out'
           when not exists (
             select 1 from public.profiles as profile
              where profile.id = digest.member_id
                and profile.status = 'activ') then 'member_inactive'
           else 'nothing_unread'
         end
   where digest.status in ('pending', 'sending')
     and digest.next_attempt_at <= now()
     and (not exists (
            select 1 from public.notification_email_preferences as preference
             where preference.member_id = digest.member_id
               and preference.digest_enabled)
          or not exists (
            select 1 from public.profiles as profile
             where profile.id = digest.member_id
               and profile.status = 'activ')
          or not exists (
            select 1 from public.notifications as notification
             where notification.id = any (digest.notification_ids)
               and not notification.read));

  -- The quota guard: never more than what is left of today's quota.
  v_take := least(p_limit, private.email_digest_quota_remaining(now()));
  if v_take <= 0 then
    return;
  end if;

  -- skip locked keeps a settle in flight from blocking the claim; the lease
  -- is fifteen minutes, far longer than one run of send-digest.
  return query
  with due as materialized (
    select candidate.id
      from private.email_digests as candidate
     where candidate.status in ('pending', 'sending')
       and candidate.next_attempt_at <= now()
     order by candidate.created_at, candidate.id
     limit v_take
       for update skip locked
  ),
  claimed as (
    update private.email_digests as digest
       set status = 'sending',
           attempts = digest.attempts + 1,
           next_attempt_at = now() + interval '15 minutes'
      from due
     where digest.id = due.id
    returning digest.id, digest.attempts, digest.member_id, digest.notification_ids
  )
  select claimed.id,
         claimed.attempts,
         profile.email,
         coalesce(profile.nickname, profile.full_name),
         unread.total,
         unread.latest
    from claimed
    join public.profiles as profile on profile.id = claimed.member_id
    cross join lateral (
      select count(*)::integer as total,
             coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   'id', ranked.id,
                   'title', ranked.title,
                   'body', ranked.body,
                   'link', ranked.link,
                   'created_at', ranked.created_at)
                 order by ranked.created_at desc, ranked.id desc)
               filter (where ranked.rank_no <= 20),
               '[]'::jsonb) as latest
        from (
          select notification.id, notification.title, notification.body,
                 notification.link, notification.created_at,
                 row_number() over (order by notification.created_at desc, notification.id desc) as rank_no
            from public.notifications as notification
           where notification.id = any (claimed.notification_ids)
             and not notification.read
        ) as ranked
    ) as unread
   order by claimed.id;
end;
$$;

comment on function public.claim_email_digests(integer) is
  '#775: send-digest only (service_role). The quota guard and the claim, serialized on the email_daily_quota row (for no key update). First fails a lease that expired on the third attempt (lease_expired) and skips every due digest whose Member has opted out, is no longer activ, or has no unread Notification left in it (last_error opted_out / member_inactive / nothing_unread). Then claims at most least(p_limit, private.email_digest_quota_remaining(now())) due digests (pending, or sending with an expired lease), oldest first, for update skip locked: marks them sending, increments attempts and leases them for fifteen minutes. Returns per digest its id, the attempt number the settle must quote back, the Member''s email and Nickname (full name when unset), the number of its Notifications still unread and the latest 20 of them as a jsonb array of {id, title, body, link, created_at}. Nothing when the quota is spent. PT400 invalid_limit outside 1..100.';

create function public.settle_email_digest(
  p_id          bigint,
  p_attempt     integer,
  p_outcome     text,
  p_error       text default null,
  p_provider_id text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_outcome is null or p_outcome not in ('sent', 'retry', 'deferred', 'failed') then
    raise sqlstate 'PT400' using message = 'invalid_digest_outcome';
  end if;

  -- attempts was incremented by the claim: a retry after attempts one and two
  -- waits one and two hours, and a retry on the third fails for good. A
  -- deferred digest (Resend's own quota, or a key it refused) gives its
  -- attempt back and waits for 07:00 Bucharest the next day.
  update private.email_digests as digest
     set status = case
                    when p_outcome = 'sent' then 'sent'
                    when p_outcome = 'deferred' then 'pending'
                    when p_outcome = 'retry' and digest.attempts < 3 then 'pending'
                    else 'failed'
                  end,
         attempts = case when p_outcome = 'deferred' then digest.attempts - 1 else digest.attempts end,
         sent_at = case when p_outcome = 'sent' then now() end,
         provider_id = case when p_outcome = 'sent' then left(p_provider_id, 255) end,
         next_attempt_at = case
                             when p_outcome = 'deferred'
                               then (((now() at time zone 'Europe/Bucharest')::date + 1) + time '07:00')
                                    at time zone 'Europe/Bucharest'
                             when p_outcome = 'retry' and digest.attempts < 3
                               then now() + interval '1 hour' * power(2, digest.attempts - 1)
                             else digest.next_attempt_at
                           end,
         last_error = case when p_outcome = 'sent' then null else left(p_error, 1000) end
   where digest.id = p_id
     and digest.status = 'sending'
     -- Fenced to the caller's lease, like settle_push_delivery.
     and digest.attempts = p_attempt
  returning digest.status into v_status;

  return v_status;
end;
$$;

comment on function public.settle_email_digest(bigint, integer, text, text, text) is
  '#775: send-digest only (service_role). Records the outcome of one claimed (sending) digest, fenced to the lease: p_attempt must be the attempt number the claim returned. sent stamps sent_at and keeps Resend''s email id (provider_id); retry returns it to pending one or two hours ahead after attempts one and two and fails it on the third; deferred returns it to pending at 07:00 Europe/Bucharest the next day without counting the attempt (Resend''s daily quota, or an API key Resend refused); failed is terminal. p_error is kept (first 1000 characters) as last_error. Returns the resulting status (sent, pending or failed), or null when the row is no longer sending under that attempt. PT400 invalid_digest_outcome for any other outcome.';

revoke execute on function public.claim_email_digests(integer),
  public.settle_email_digest(bigint, integer, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_email_digests(integer),
  public.settle_email_digest(bigint, integer, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. The job.
-- ---------------------------------------------------------------------------
-- Every hour; the body decides what the hour means (07:00 Bucharest enqueues,
-- 07:00-21:59 sends). The URL and the key are the Vault rows osubb-send-push
-- already reads (docs/backend/push.md), read when the job runs, never here.
-- The enqueue and the call are one statement: a missing Vault row fails the
-- whole run (null url), so nothing is stamped digested without a send
-- attempt, and the next morning picks those Notifications up again.
select cron.schedule('osubb-email-digest', '0 * * * *', $cron$
select net.http_post(
         url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
                || '/functions/v1/send-digest',
         headers := jsonb_build_object(
           'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'secret_key'),
           'Content-Type', 'application/json'),
         body := '{}'::jsonb,
         timeout_milliseconds := 150000)
 where private.prepare_email_digests()
$cron$);
