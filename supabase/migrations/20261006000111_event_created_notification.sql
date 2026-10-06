-- Ruling R39 (Alex, 2026-10-06): "see why the events don't send a notification
-- anymore". Creating an Event notified nobody: ADR-0008 §Important-change
-- notifications fans out only on edits (date/time, location, scope, Minimum
-- Level, cancellation), and the only notice a new Event could produce was the
-- optional #909 "Anunță și în Anunțuri" Announcement's own fan-out. Production
-- showed it: an Organization Group Event created without the Announcement wrote
-- 0 Notifications for its 716-Member audience.
--
-- create_event now tells the Event's audience, once, in the same transaction:
--   * recipients: private.event_notification_recipients -- the very set the
--     important-change notices reach: the Group Audience Notifications reach
--     (private.group_notification_audience, so no BC member or Moderator through
--     membership, ruling R32) filtered by private.can_read_event (Minimum Level,
--     Private Groups). A new Event has no "going" attendee yet, so nobody else is
--     in it. private.notify drops the creator (no echo) and anyone not activ;
--   * kind 'event', so the Member's existing "Evenimente" push preference (#635)
--     governs its push like every other Event notice;
--   * title "Eveniment nou: <titlu>", body the Event's date line in Romania's time
--     zone with its place (private.event_announcement_body without the
--     description), link /calendar?event=<id> and dedupe key event:<id>:created,
--     so private.notification_subject derives subject event:<id> (R37) and an
--     RSVP or opening the Event reads it;
--   * one set-based insert through private.notify, as the change notices do;
--   * NOT when p_announce is true: the Announcement's fan-out already reaches the
--     same Members (its Group Audience minus BC/Moderator, those who can see the
--     Group, at or above the Minimum Level), so one notice per Member, not two;
--   * a daily cap: a notified write is capped per Member (security pass L3), so
--     create_event spends a new event_create cap of 50 per rolling 24 hours
--     (PT409 rate_limited), whatever p_announce says.
--
-- private.create_event_impl is rebuilt from its latest body on main
-- (20260929170000_announcement_deadline.sql); the signature is unchanged, so the
-- grants and public.create_event stay as they are.

-- ==================== the daily cap for a new Event ====================
-- Security pass L3 capped every write that notifies other people; a new Event
-- now does (R39), so create_event spends a cap of its own: 50 Events per Member
-- in any 24 hours, counted on public.events (created_by, created_at). An Event
-- published with its Announcement also spends the announcement cap, as before.
-- require_daily_cap is rebuilt from its only definition
-- (20260927190000_daily_caps_latin_nickname.sql) with the one new cap.

create or replace function private.require_daily_cap(p_cap text, p_actor uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_used  bigint;
  v_since timestamptz;
begin
  v_limit := case p_cap
    when 'group_application'      then 10
    when 'task_interest'          then 30
    when 'completed_work_request' then 30
    when 'task_create'            then 100
    when 'announcement'           then 20
    when 'event_create'           then 50
  end;
  if v_limit is null then
    raise exception 'unknown daily cap: %', p_cap;
  end if;
  if p_actor is null then
    return;
  end if;

  -- One writer per (cap, Member) at a time; released at commit or rollback.
  perform pg_advisory_xact_lock(hashtextextended('osubb.daily_cap:' || p_cap || ':' || p_actor::text, 0));
  v_since := clock_timestamp() - interval '24 hours';

  v_used := case p_cap
    when 'group_application' then
      (select count(*) from public.group_applications as row_
        where row_.member_id = p_actor and row_.created_at > v_since)
    when 'task_interest' then
      (select count(*) from public.task_activity as row_
        where row_.actor_id = p_actor and row_.kind = 'interest_expressed' and row_.created_at > v_since)
    when 'completed_work_request' then
      (select count(*) from public.completed_work_requests as row_
        where row_.requester_id = p_actor and row_.created_at > v_since)
    when 'task_create' then
      (select count(*) from public.task_activity as row_
        where row_.actor_id = p_actor and row_.kind = 'created' and row_.created_at > v_since)
    when 'announcement' then
      (select count(*) from public.announcements as row_
        where row_.created_by = p_actor and row_.published_at > v_since)
    -- R39: a new Event now notifies its audience, so creating one is capped too.
    when 'event_create' then
      (select count(*) from public.events as row_
        where row_.created_by = p_actor and row_.created_at > v_since)
  end;

  if v_used >= v_limit then
    raise sqlstate 'PT409' using
      message = 'rate_limited',
      detail  = format('%s: at most %s per Member in any 24 hours', p_cap, v_limit);
  end if;
end;
$$;

comment on function private.require_daily_cap(text, uuid) is
  'Security pass L3: refuses PT409 rate_limited when p_actor already has the cap''s limit of writes in the last 24 hours (group_application 10, task_interest 30, completed_work_request 30, task_create 100, announcement 20, event_create 50 -- ruling R39), counted on the write''s own rows under a (cap, Member) advisory lock. A null actor (a server-side write) is never capped.';

-- ==================== create_event ====================

create or replace function private.create_event_impl(
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
  v_recipients uuid[];
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
  -- R39: the Event notifies its audience, so it spends a daily cap (security
  -- pass L3), judged after every row lock the gate took.
  perform private.require_daily_cap('event_create', v_actor);
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
  else
    -- R39: without the Announcement, the Event tells its audience itself -- the
    -- important-change recipients (the Group Audience Notifications reach, read
    -- through can_read_event; no attendee exists yet), one set-based insert.
    select array_agg(recipient) into v_recipients
      from private.event_notification_recipients(v_created.id) as recipient;
    perform private.notify(v_recipients, 'event', 'Eveniment nou: ' || v_created.title,
      private.event_announcement_body(v_created.starts_at, v_created.ends_at, v_created.location, null),
      null, 'event:' || v_created.id::text || ':created', v_actor,
      '/calendar?event=' || v_created.id::text);
  end if;
  return v_created;
end;
$$;

comment on function private.create_event_impl(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean) is
  'Creates an Event on a Group, authorized by Group Role (ADR-0009 Wave 2, #370). Malformed input is judged first, for everyone, so a caller without organization claims learns what is wrong with the call: PT400 invalid_event_title / invalid_event_type / invalid_event_interval / invalid_event_capacity / invalid_event_min_level / event_group_required. The Organization Group — since #582 the Group carrying groups.is_organization, not the row mirroring the legacy org pseudo-department — is open to any live Member holding any Group Role anywhere, which is how a Department''s leadership gets an organization-wide Event, or to level >= 6; every other Group goes through private.require_group_work_manager, so a Group Manager or Group Responsible on the path, an ancestor''s included, qualifies and an ordinary member does not. Every refusal is the single non-disclosing 42501 calendar_manage_forbidden, so a missing, archived or forbidden Group are indistinguishable. Minimum Level is then judged against the loaded rows: PT400 event_min_level_below_group (an Event may not be more open than its Group) and PT400 event_min_level_above_actor (nobody raises an Event above their own live level), the latter with Moderator exempt. An optional Campaign (#691, ADR-0008 amended 2026-09-23) must be owned by the Event''s Group or a Group above it and be active (events_validate_campaign); anything else is PT400 invalid_campaign, the string create_task uses for the same condition. #909: p_announce = true also publishes one Announcement in the same transaction (title, a Romanian date/time/place/description body from private.event_announcement_body, the Event''s Group, audience org for the Organization Group else local, min_level = the Event''s, deadline = starts_at, the caller as author, normal fan-out); it is judged before the Event is written by the announcements_create predicate private.can_publish_announcement (42501 announcement_publish_forbidden). Any refusal, including the Announcement''s own row guards, leaves no Event behind. Ruling R39 (2026-10-06): without p_announce the new Event notifies its audience once -- private.event_notification_recipients (the Group Audience that Notifications reach, minus BC and the Moderator per R32, read through private.can_read_event: Minimum Level and Private Groups), never the creator -- with kind event, title Eveniment nou: <title>, the date line and place of private.event_announcement_body as body, link /calendar?event=<id> and dedupe key event:<id>:created (subject event:<id>, R37), in one private.notify insert. With p_announce the Announcement''s fan-out is that notice, so no Event Notification is written: one notice per Member. Every creation spends the event_create daily cap (50 per Member in any 24 hours, private.require_daily_cap; PT409 rate_limited), judged after the gate and before the Event is written.';
