-- #909: an optional Termen and a Minimum Level on Announcements, and
-- "Creează și un anunț" on create_event.
--
-- 1. announcements.deadline (nullable timestamptz). The app writes Announcements
--    by direct insert (no compose command exists, #100), so the "not in the
--    past at creation" rule of ruling R8 is a before-insert row guard naming
--    23514 deadline_in_past -- the same split announcements_guard_text uses.
--    An update may keep, change or clear the Termen without being judged
--    against now: R8 judges a deadline only at creation, as for Tasks. A write
--    with no auth.uid() (seed, migrations) is not judged, so demo data can show
--    an expired Termen.
-- 1b. announcements.min_level (Alex, 2026-09-29, on #909): not null, default 0
--    (Recrut: everyone in the Audience), on the ladder of ruling R29b. An
--    Announcement reads only for Members of its Audience whose live level
--    (private.caller_level, #816) is at least that -- its author always. The
--    one predicate private.can_read_announcement gains the two columns, so
--    every read path follows: the feed, the details and ?anunt= links (all
--    announcements_read), the unread badge (my_unread_announcements_count is
--    security invoker, so it counts through that policy), read receipts
--    (announcement_reads_manage_self), the readers list and the fan-out, which
--    both filter their recipients by the same level.
-- 2. private.can_publish_announcement(group_id): the compose rule of
--    announcements_create, lifted into one predicate so the policy and
--    create_event ask the same question. create_event runs as the owner and so
--    bypasses RLS on its own insert; without this call it could publish with
--    more authority than the caller has.
-- 3. create_event gains p_announce boolean default false (rebuilt from main's
--    latest body, 20260927150000_column_limits.sql). When true it publishes one
--    Announcement in the same transaction: the Event's title, a Romanian body
--    (day, time, place, description), the Event's Group and Audience, Termen =
--    the Event's start, author = the caller, normal fan-out. A caller who could
--    not publish that Announcement directly is refused the whole call
--    (42501 announcement_publish_forbidden). The Announcement copies the
--    Event's Minimum Level, so it reaches exactly the Members who can see the
--    Event. Every refusal raises, so no Event is left.

-- ==================== 1. the column and its guard ====================
alter table public.announcements add column deadline timestamptz;
-- Every existing row takes the default 0, so the check holds from the start.
alter table public.announcements
  add column min_level integer not null default 0
    constraint announcements_min_level_ck check (min_level in (0, 1, 2, 3, 5, 6));

comment on column public.announcements.min_level is
  '#909: an Announcement reads only for Members of its Audience at or above this live level (ruling R29b ladder; 0 = Recrut = everyone), its author always. create_event(p_announce) copies the Event''s Minimum Level.';
comment on column public.announcements.deadline is
  '#909: optional Termen of an Announcement. Not in the past when a signed-in author creates it (announcements_guard_deadline, 23514 deadline_in_past); create_event(p_announce) sets it to the Event''s start.';

create function private.guard_announcement_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Named ahead of announcements_min_level_ck, so a direct write hears the rule.
  if new.min_level is null or new.min_level not in (0, 1, 2, 3, 5, 6) then
    raise exception using errcode = '23514', message = 'invalid_announcement_min_level';
  end if;
  if tg_op = 'INSERT' and (select auth.uid()) is not null
     and new.deadline is not null and new.deadline < now() then
    raise exception using errcode = '23514', message = 'deadline_in_past';
  end if;
  return new;
end;
$$;

comment on function private.guard_announcement_settings() is
  '#909: announcements_guard_settings -- names the rule a direct write breaks as 23514: invalid_announcement_min_level (off the R29b ladder, insert or update) and, R8, deadline_in_past for a signed-in insert whose Termen has passed. Updates are not judged against now (R8 judges a deadline only at creation); writes without auth.uid() (seed, migrations) may carry a past Termen.';

revoke execute on function private.guard_announcement_settings()
  from public, anon, authenticated, service_role;

create trigger announcements_guard_settings
  before insert or update on public.announcements
  for each row execute function private.guard_announcement_settings();

-- ==================== 1b. reading follows the Minimum Level ====================
create function private.can_read_announcement(
  p_group_id bigint, p_audience text, p_min_level integer, p_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- #756: an organization-wide Announcement of a Private Group is still the
  -- Group's own, so it reads only for those who can see the Group.
  -- #909: and only at or above its Minimum Level, by live level -- its author
  -- always, whatever their level has become.
  select coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null
     and private.can_see_group(p_group_id, (select auth.uid()))
     and (p_audience = 'org'
          or (p_audience = 'local' and (
              (select auth.uid()) in (select private.group_audience(p_group_id))
              or private.group_role_of(p_group_id, (select auth.uid())) in ('manager', 'responsible')
          )))
     and (private.caller_level() >= coalesce(p_min_level, 0)
          or p_created_by = (select auth.uid()));
$$;

comment on function private.can_read_announcement(bigint, text, integer, uuid) is
  'The Announcement read rule (#581, #756, #909), one definition for announcements_read and announcement_reads_manage_self: a live Member with organization claims who can see the Origin Group, in the Audience (org: everyone; local: the Origin''s Group Audience or a Manager / Responsible on its path), and whose live level (private.caller_level, #816) is at least the Announcement''s Minimum Level -- or its author. Policy predicate: authenticated may execute it.';

revoke execute on function private.can_read_announcement(bigint, text, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.can_read_announcement(bigint, text, integer, uuid) to authenticated;

alter policy announcements_read on public.announcements
  using (private.can_read_announcement(group_id, audience, min_level, created_by));

alter policy announcement_reads_manage_self on public.announcement_reads
  with check (
    public.auth_is_member()
    and member_id = (select auth.uid())
    and exists (
      select 1
        from public.announcements as announcement
       where announcement.id = announcement_id
         and private.can_read_announcement(announcement.group_id, announcement.audience,
                                           announcement.min_level, announcement.created_by)
    )
  );

drop function private.can_read_announcement(bigint, text);

-- Rebuilt from 20260924132724_private_groups.sql (#756), the latest body.
CREATE OR REPLACE FUNCTION private.announcement_readers_impl(p_announcement_id bigint)
 RETURNS TABLE(member_id uuid, read_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_group_id bigint;
  v_audience text;
  v_created_by uuid;
  v_audience_group bigint;
  v_min_level integer;
begin
  select announcement.group_id, announcement.audience, announcement.created_by, announcement.min_level
    into v_group_id, v_audience, v_created_by, v_min_level
    from public.announcements as announcement
   where announcement.id = p_announcement_id;

  -- Author, BC/Moderator by rank, or -- for a local Audience only -- the
  -- Origin's Managers and Responsibles, ancestors' included. An org Audience
  -- reaches everyone, so a Group Role on its Origin does not suffice.
  if not found
     or not coalesce(
          public.auth_is_member()
          and private.actor_level(v_actor) is not null
          and (v_created_by = v_actor
               or private.actor_level(v_actor) >= 6
               or (v_audience = 'local'
                   and private.group_role_of(v_group_id, v_actor) in ('manager', 'responsible')
                   -- #909: a Manager below the Minimum Level cannot read it either.
                   and private.caller_level() >= v_min_level)),
          false)
  then
    raise sqlstate 'PT404' using message = 'announcement_not_found';
  end if;

  if v_audience = 'org' then
    select grp.id into strict v_audience_group
      from public.groups as grp
     where grp.is_organization;
  else
    v_audience_group := v_group_id;
  end if;

  return query
    select recipient.member_id, reads.read_at
      from private.group_audience(v_audience_group) as recipient(member_id)
      left join public.announcement_reads as reads
        on reads.announcement_id = p_announcement_id
       and reads.member_id = recipient.member_id
     -- #756: the fan-out's own filter, so the list names only its readers.
     where private.can_see_group(v_group_id, recipient.member_id)
       -- #909: only the recipients the Minimum Level lets read it.
       and coalesce(private.actor_level(recipient.member_id), -1) >= v_min_level
     order by reads.read_at desc nulls last, recipient.member_id;
end;
$function$;

-- Rebuilt from 20260928120000_audit_d_server_fixes.sql (#861), the latest body.
CREATE OR REPLACE FUNCTION private.fan_out_announcement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_audience_group bigint;
  v_recipients uuid[];
  v_actor uuid;
begin
  v_actor := coalesce((select auth.uid()), new.created_by);
  if new.audience = 'org' then
    select id into v_audience_group from public.groups where is_organization;
  else
    v_audience_group := new.group_id;
  end if;

  select array_agg(recipient.member_id order by recipient.member_id)
    into v_recipients
    from private.group_audience(v_audience_group) as recipient(member_id)
    join public.profiles as profile on profile.id = recipient.member_id
   where not exists (
     select 1 from public.notif_suppression as suppression
      where suppression.role = profile.role and suppression.kind = 'announce'
   )
     -- #756: an organization-wide Announcement of a Private Group reaches
     -- only those who can see the Group (announcements_read agrees).
     and private.can_see_group(new.group_id, recipient.member_id)
     -- #909: no Notification to a Member below the Minimum Level, who cannot
     -- read the Announcement (announcements_read agrees).
     and coalesce(private.actor_level(recipient.member_id), -1) >= new.min_level;

  -- #635: a critical Announcement's Notification is critical, so it still
  -- pushes to a Member who muted 'announce'.
  -- #861 (Audit D-20): keyed announcement:<id>, so reading the Announcement
  -- (private.mark_announcement_notification_read) finds and clears it.
  perform private.notify(v_recipients, 'announce',
    'Anunț nou: ' || new.title, new.body, null, 'announcement:' || new.id::text, v_actor,
    '/anunturi?anunt=' || new.id::text,
    new.priority = 'critical');

  -- #861 (Audit D-12): the author has read what they wrote. The
  -- announcements_read rule (private.can_read_announcement), judged for the
  -- author instead of the caller: a live Member who can see the Group and,
  -- for a local Audience, one in its Group Audience or holding a Manager /
  -- Responsible position on its path. A global writer who posts outside
  -- their own audience gets no row, as they could not write one themselves.
  if new.created_by is not null
     and private.actor_level(new.created_by) is not null
     and private.can_see_group(new.group_id, new.created_by)
     and (new.audience = 'org'
          or (new.audience = 'local' and (
              new.created_by in (select private.group_audience(new.group_id))
              or private.group_role_of(new.group_id, new.created_by) in ('manager', 'responsible')))) then
    insert into public.announcement_reads (announcement_id, member_id)
    values (new.id, new.created_by)
    on conflict do nothing;
  end if;
  return new;
end;
$function$;

-- ==================== 2. one compose rule, two readers ====================
create function private.can_publish_announcement(p_group_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- The Origin's Manager or Responsible on its path (or BC/Moderator), or, for
  -- the Organization Group, anyone holding a Group Role anywhere (#581).
  select coalesce(public.auth_is_member(), false)
     and (coalesce(private.can_manage_group_work(p_group_id), false)
          or (exists (select 1 from public.groups as grp
                       where grp.id = p_group_id and grp.is_organization)
              and coalesce(private.holds_any_group_role(), false)));
$$;

comment on function private.can_publish_announcement(bigint) is
  '#909: whether the live caller may publish an Announcement from this Origin Group -- the compose rule of announcements_create (#581), lifted into one predicate that the policy and create_event(p_announce) both read, so the command never publishes with more authority than a direct insert has.';

revoke execute on function private.can_publish_announcement(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.can_publish_announcement(bigint) to authenticated;

alter policy announcements_create on public.announcements
  with check (public.auth_is_member()
    and created_by = (select auth.uid())
    and private.can_publish_announcement(group_id));

-- ==================== 3. the Announcement body for an Event ====================
create function private.event_announcement_body(
  p_starts_at timestamptz, p_ends_at timestamptz, p_location text, p_description text
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_days constant text[] := array['duminică','luni','marți','miercuri','joi','vineri','sâmbătă'];
  v_months constant text[] := array['ianuarie','februarie','martie','aprilie','mai','iunie',
    'iulie','august','septembrie','octombrie','noiembrie','decembrie'];
  v_start timestamp := p_starts_at at time zone 'Europe/Bucharest';
  v_end timestamp := p_ends_at at time zone 'Europe/Bucharest';
  v_line text;
  v_body text;
begin
  -- "Miercuri, 30 septembrie 2026, 18:40–20:40 · Sala 305", always in Romania.
  v_line := v_days[extract(dow from v_start)::int + 1] || ', '
    || extract(day from v_start)::int || ' ' || v_months[extract(month from v_start)::int]
    || ' ' || extract(year from v_start)::int || ', ' || to_char(v_start, 'HH24:MI');
  v_line := upper(left(v_line, 1)) || substr(v_line, 2);
  if v_end is not null then
    if v_end::date = v_start::date then
      v_line := v_line || '–' || to_char(v_end, 'HH24:MI');
    else
      v_line := v_line || ' – ' || v_days[extract(dow from v_end)::int + 1] || ', '
        || extract(day from v_end)::int || ' ' || v_months[extract(month from v_end)::int]
        || ' ' || extract(year from v_end)::int || ', ' || to_char(v_end, 'HH24:MI');
    end if;
  end if;
  if nullif(btrim(p_location), '') is not null then
    v_line := v_line || ' · ' || btrim(p_location);
  end if;
  v_body := v_line;
  if nullif(btrim(p_description), '') is not null then
    v_body := v_body || E'\n\n' || btrim(p_description);
  end if;
  -- An Event description may use all 2000 characters an Announcement body has;
  -- the date line on top must not push the Announcement over its limit.
  if char_length(v_body) > 2000 then
    v_body := left(v_body, 1999) || '…';
  end if;
  return v_body;
end;
$$;

comment on function private.event_announcement_body(timestamptz, timestamptz, text, text) is
  '#909: the body of the Announcement create_event(p_announce) publishes -- "Miercuri, 30 septembrie 2026, 18:40–20:40 · Sala 305", a blank line and the description, in Romania''s time zone, clipped to the 2000 characters an Announcement body allows.';

revoke execute on function private.event_announcement_body(timestamptz, timestamptz, text, text)
  from public, anon, authenticated, service_role;

-- ==================== 4. create_event(p_announce) ====================
drop function public.create_event(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint);
drop function private.create_event_impl(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint);

create function private.create_event_impl(
  p_title text, p_type text, p_group_id bigint, p_starts_at timestamptz,
  p_ends_at timestamptz default null, p_location text default null,
  p_capacity integer default null, p_description text default null, p_min_level integer default 0,
  p_campaign_id bigint default null, p_announce boolean default false
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_level integer;
  v_group public.groups%rowtype;
  v_created public.events%rowtype;
  v_constraint text;
begin
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_event_title';
  end if;
  -- #673 (R8): measured as stored (btrim).
  perform private.require_text_length('title', btrim(p_title), 3, 120);
  perform private.require_text_length('description', btrim(p_description), null, 2000);
  -- Security pass 2026-09-27 (L1): events_location_length_ck, measured as stored.
  perform private.require_text_length('location', btrim(p_location), null, 200);
  if p_type is null or p_type not in ('sedinta','activitate','call','eveniment','deadline','recrutare') then
    raise sqlstate 'PT400' using message = 'invalid_event_type';
  end if;
  if p_starts_at is null or (p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise sqlstate 'PT400' using message = 'invalid_event_interval';
  end if;
  -- #673 (R8): an Event's start is judged against now only at creation.
  if p_starts_at < now() then
    raise sqlstate 'PT400' using message = 'starts_at_in_past';
  end if;
  -- #673 (R8): capacity 1-1000 (events_capacity_range_ck).
  if p_capacity is not null and (p_capacity <= 0 or p_capacity > 1000) then
    raise sqlstate 'PT400' using message = 'invalid_event_capacity';
  end if;
  if p_min_level is null or p_min_level not in (0,3,5,6) then
    raise sqlstate 'PT400' using message = 'invalid_event_min_level';
  end if;
  if p_group_id is null then
    raise sqlstate 'PT400' using message = 'event_group_required';
  end if;

  select * into v_group from public.groups where id = p_group_id and status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  begin
    -- #582: the Organization is the Group carrying the marker, not the row
    -- that happens to mirror the legacy `org` pseudo-department.
    if v_group.is_organization then
      v_actor := private.require_active_member();
      perform 1 from public.profiles as profile
        where profile.id = v_actor and profile.status = 'activ' for share of profile;
      if not found then
        raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
      end if;
      v_level := private.actor_level(v_actor);
      if v_level < 6 then
        -- An Organization Event needs a real live Group Role, not an old rank or JWT roster.
        -- Lock only roster rows: Group SHARE locks conflict with legacy mirror upserts.
        perform 1 from public.group_members as gm
          where gm.member_id = v_actor and gm.group_role in ('manager','responsible')
          order by gm.group_id for share of gm;
        if not found then
          raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
        end if;
      end if;
    else
      v_actor := private.require_group_work_manager(p_group_id);
    end if;
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end;
  -- Refresh settings and level after any wait for live authority.
  select * into v_group from public.groups where id = p_group_id and status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  v_level := private.actor_level(v_actor);
  if p_min_level < v_group.min_level then
    raise sqlstate 'PT400' using message = 'event_min_level_below_group';
  end if;
  if v_level < 9 and p_min_level > v_level then
    raise sqlstate 'PT400' using message = 'event_min_level_above_actor';
  end if;
  -- #909: the Announcement is judged before anything is written. This function
  -- runs as the owner, so its insert below bypasses announcements_create: ask
  -- the policy's own predicate, or the caller would publish with more
  -- authority than a direct insert gives them.
  if coalesce(p_announce, false) then
    if not private.can_publish_announcement(p_group_id) then
      raise exception using errcode = '42501', message = 'announcement_publish_forbidden';
    end if;
  end if;
  -- #691: events_validate_campaign judges the Campaign against the Event's Group;
  -- its two reasons, and an unknown id, reach the caller as create_task_impl's
  -- PT400 invalid_campaign (same condition, same string).
  begin
    insert into public.events(title,type,group_id,starts_at,ends_at,location,capacity,description,min_level,campaign_id,created_by)
      values (btrim(p_title),p_type::public.event_type,p_group_id,p_starts_at,p_ends_at,
        nullif(btrim(p_location),''),p_capacity,nullif(btrim(p_description),''),p_min_level,p_campaign_id,v_actor)
      returning * into v_created;
  exception
    when foreign_key_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'events_campaign_id_fkey' then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
    when check_violation then
      if sqlerrm in ('event_campaign_origin_mismatch', 'event_campaign_inactive') then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
  end;
  -- #909: the Announcement goes through the table's own row guards (text,
  -- Termen, authorship stamp, the author's daily cap) and its fan-out trigger;
  -- any refusal there rolls the Event back with it. It copies the Event's
  -- Minimum Level, so it reaches exactly the Members who can see the Event.
  if coalesce(p_announce, false) then
    insert into public.announcements(title, body, group_id, audience, min_level, deadline, created_by)
      values (v_created.title,
              private.event_announcement_body(v_created.starts_at, v_created.ends_at,
                                              v_created.location, v_created.description),
              v_created.group_id,
              case when v_group.is_organization then 'org' else 'local' end,
              v_created.min_level,
              v_created.starts_at,
              v_actor);
  end if;
  return v_created;
end;
$$;

comment on function private.create_event_impl(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean) is
  'Creates an Event on a Group, authorized by Group Role (ADR-0009 Wave 2, #370). Malformed input is judged first, for everyone, so a caller without organization claims learns what is wrong with the call: PT400 invalid_event_title / invalid_event_type / invalid_event_interval / invalid_event_capacity / invalid_event_min_level / event_group_required. The Organization Group — since #582 the Group carrying groups.is_organization, not the row mirroring the legacy org pseudo-department — is open to any live Member holding any Group Role anywhere, which is how a Department''s leadership gets an organization-wide Event, or to level >= 6; every other Group goes through private.require_group_work_manager, so a Group Manager or Group Responsible on the path, an ancestor''s included, qualifies and an ordinary member does not. Every refusal is the single non-disclosing 42501 calendar_manage_forbidden, so a missing, archived or forbidden Group are indistinguishable. Minimum Level is then judged against the loaded rows: PT400 event_min_level_below_group (an Event may not be more open than its Group) and PT400 event_min_level_above_actor (nobody raises an Event above their own live level), the latter with Moderator exempt. An optional Campaign (#691, ADR-0008 amended 2026-09-23) must be owned by the Event''s Group or a Group above it and be active (events_validate_campaign); anything else is PT400 invalid_campaign, the string create_task uses for the same condition. #909: p_announce = true also publishes one Announcement in the same transaction (title, a Romanian date/time/place/description body from private.event_announcement_body, the Event''s Group, audience org for the Organization Group else local, min_level = the Event''s, deadline = starts_at, the caller as author, normal fan-out); it is judged before the Event is written by the announcements_create predicate private.can_publish_announcement (42501 announcement_publish_forbidden). Any refusal, including the Announcement''s own row guards, leaves no Event behind.';

revoke execute on function private.create_event_impl(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.create_event_impl(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean)
  to authenticated;

create function public.create_event(
  p_title text, p_type text, p_group_id bigint, p_starts_at timestamptz,
  p_ends_at timestamptz default null, p_location text default null,
  p_capacity integer default null, p_description text default null, p_min_level integer default 0,
  p_campaign_id bigint default null, p_announce boolean default false
)
returns public.events language sql security invoker set search_path = ''
as $$
  select private.create_event_impl(p_title, p_type, p_group_id, p_starts_at, p_ends_at,
    p_location, p_capacity, p_description, p_min_level, p_campaign_id, p_announce);
$$;

comment on function public.create_event(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean) is
  'Security-invoker wrapper over private.create_event_impl (#370; p_campaign_id #691; p_announce #909). Replaces the grandfathered direct-definer command that gated on a flat level >= 4; no Tracker or Calendar authority reads level 4 any more.';

revoke execute on function public.create_event(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.create_event(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean)
  to authenticated;
