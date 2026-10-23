-- #1098: all-day Events (ruling R63) -- events.all_day, its bounds, and the readers that print an Event's time.
--
-- An all-day Event is stored from 00:00 Bucharest on its first day to 00:00
-- Bucharest after its last day: the end is exclusive, so a one-day all-day
-- Event lasts 24 hours (23 or 25 across a DST change) and a three-day one ends
-- at the midnight after its third day. Midnights are Romania's, whatever the
-- season, so the bounds are judged in Europe/Bucharest.
--
-- 1. events.all_day and events_all_day_bounds_ck.
-- 2. private.event_announcement_body gains p_all_day: an all-day Event's date
--    line says "toată ziua" and its last day, never 00:00.
-- 3. create_event / update_event gain p_all_day (rebuilt from main's newest
--    bodies, 20261020213926_formatted_text.sql): PT400 invalid_all_day_bounds,
--    starts_at_in_past judged by day for an all-day Event, the edit notice's
--    Programare line without times.
-- 4. private.notify_event and private.approve_event_impl pass all_day to the
--    body (from 20261014160759_reminders.sql and
--    20261013090000_org_wide_approval_review.sql).
-- 5. private.send_reminders: an all-day Event's reminder names no hour.

-- ==================== 1. events.all_day ====================
alter table public.events add column all_day boolean not null default false;

alter table public.events
  add constraint events_all_day_bounds_ck check (
    not all_day
    or (ends_at is not null
        and ends_at > starts_at
        and (starts_at at time zone 'Europe/Bucharest')::time = time '00:00'
        and (ends_at at time zone 'Europe/Bucharest')::time = time '00:00')
  );

comment on column public.events.all_day is
  '#1098 (R63): Toată ziua. The Event runs from 00:00 Bucharest on its first day to 00:00 Bucharest after its last day (ends_at exclusive, never null); no reader prints its times (events_all_day_bounds_ck).';

-- ==================== 2. private.event_announcement_body ====================
drop function private.event_announcement_body(timestamptz, timestamptz, text, text);

create function private.event_announcement_body(
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_location text,
  p_description text,
  p_all_day boolean default false
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
  v_last date;
  v_line text;
  v_text text;
  v_lines text[];
  v_n integer;
  v_words text;
  v_cut text;
  v_room integer;
  v_body text;
begin
  if coalesce(p_all_day, false) and v_end is not null then
    -- #1098 (R63): "Vineri, 24 octombrie 2026, toată ziua", or with its last
    -- day -- the day before the exclusive end -- when it spans several.
    v_last := (v_end - interval '1 day')::date;
    v_line := v_days[extract(dow from v_start)::int + 1] || ', '
      || extract(day from v_start)::int || ' ' || v_months[extract(month from v_start)::int]
      || ' ' || extract(year from v_start)::int;
    if v_last > v_start::date then
      v_line := v_line || ' – ' || v_days[extract(dow from v_last)::int + 1] || ', '
        || extract(day from v_last)::int || ' ' || v_months[extract(month from v_last)::int]
        || ' ' || extract(year from v_last)::int;
    end if;
    v_line := v_line || ', toată ziua';
  else
    -- "Miercuri, 30 septembrie 2026, 18:40–20:40 · Sala 305", always in Romania.
    v_line := v_days[extract(dow from v_start)::int + 1] || ', '
      || extract(day from v_start)::int || ' ' || v_months[extract(month from v_start)::int]
      || ' ' || extract(year from v_start)::int || ', ' || to_char(v_start, 'HH24:MI');
    if v_end is not null then
      if v_end::date = v_start::date then
        v_line := v_line || '–' || to_char(v_end, 'HH24:MI');
      else
        v_line := v_line || ' – ' || v_days[extract(dow from v_end)::int + 1] || ', '
          || extract(day from v_end)::int || ' ' || v_months[extract(month from v_end)::int]
          || ' ' || extract(year from v_end)::int || ', ' || to_char(v_end, 'HH24:MI');
      end if;
    end if;
  end if;
  v_line := upper(left(v_line, 1)) || substr(v_line, 2);
  if nullif(btrim(p_location), '') is not null then
    v_line := v_line || ' · ' || btrim(p_location);
  end if;
  v_text := nullif(btrim(p_description), '');
  v_body := v_line;
  if v_text is not null then
    v_body := v_body || E'\n\n' || v_text;
  end if;
  -- R60: an Event description is Formatted Text and may use all the 2000
  -- visible characters an Announcement body has; the date line on top must
  -- not push the Announcement over its limit, visible (2000) or stored (4000).
  -- Lines go from the end, so a cut never lands inside a marker (every marker
  -- pairs within its line), and the blank lines it leaves behind go with them.
  -- The date line stays, and the "…" closes the copy on a line of its own,
  -- counted with the candidate it closes, so it never pushes the copy back
  -- over the limit. Each pass drops at least one line, so the loop ends; it
  -- runs only on a description, since with none (notify_event's call) there
  -- are no lines to count down and the date line is the whole body.
  if v_text is not null
     and (char_length(private.formatted_text_plain(v_body)) > 2000 or char_length(v_body) > 4000) then
    v_lines := string_to_array(v_text, E'\n');
    v_n := cardinality(v_lines);
    loop
      v_n := v_n - 1;
      while v_n > 0 and btrim(v_lines[v_n], E' \t\r') = '' loop
        v_n := v_n - 1;
      end loop;
      v_body := v_line
        || case when v_n > 0 then E'\n\n' || array_to_string(v_lines[1:v_n], E'\n') else '' end
        || E'\n…';
      exit when v_n = 0
        or (char_length(private.formatted_text_plain(v_body)) <= 2000 and char_length(v_body) <= 4000);
    end loop;
    -- Ruling 10: a description is never dropped whole. When no whole line
    -- fits (one long paragraph, or a first line over the limit by itself) the
    -- copy keeps the plain words of the first line with any, markers gone, so
    -- no cut can land inside one: cut at the last space inside what the date
    -- line, the blank line and the closing "…" leave of the 2000 characters
    -- (at the budget when the line has no space), then "…" on a line of its
    -- own as above. Plain words are as long stored as visible, so the 4000
    -- stored limit holds with the 2000.
    if v_n = 0 then
      select piece.txt into v_words
        from unnest(v_lines) with ordinality as piece (txt, ord)
       where btrim(piece.txt, E' \t\r') <> ''
       order by piece.ord
       limit 1;
      v_words := btrim(coalesce(private.formatted_text_plain(v_words), ''), E' \t\r');
      v_room := 2000 - char_length(v_line) - 4;
      if char_length(v_words) > v_room then
        v_cut := left(v_words, v_room);
        -- A cut that lands inside a word steps back to the space before it.
        if substr(v_words, v_room + 1, 1) !~ '[ \t]' and v_cut ~ '[ \t]' then
          v_cut := regexp_replace(v_cut, '[ \t]+[^ \t]*$', '');
        end if;
        v_words := btrim(v_cut, E' \t');
      end if;
      v_body := v_line
        || case when v_words <> '' then E'\n\n' || v_words else '' end
        || E'\n…';
    end if;
  end if;
  return v_body;
end;
$$;

comment on function private.event_announcement_body(timestamptz, timestamptz, text, text, boolean) is
  '#909: the body of the Announcement create_event(p_announce) publishes -- "Miercuri, 30 septembrie 2026, 18:40–20:40 · Sala 305", a blank line and the description, in Romania''s time zone. #1098 (R63): with p_all_day the date line names no hour -- "Vineri, 24 octombrie 2026, toată ziua", or "Vineri, 24 octombrie 2026 – duminică, 26 octombrie 2026, toată ziua" for several days (the last day is the one before the exclusive end). R60: the description stays Formatted Text. When the body would pass the 2000 visible characters (private.formatted_text_plain) or the 4000 stored ones an Announcement body allows, lines go from the end of the description until it fits with "…" closing it on a line of its own, so a cut never lands inside a marker; the date line is never dropped. If not even the first line fits (one long paragraph) the copy keeps that line''s plain words -- markers gone -- cut at the last space inside the 2000 characters (at the limit when it has no space), then "…" on its own line: a description is never dropped whole.';

revoke execute on function private.event_announcement_body(timestamptz, timestamptz, text, text, boolean)
  from public, anon, authenticated, service_role;

-- ==================== 3a. create_event(p_all_day) ====================
drop function public.create_event(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean);
drop function private.create_event_impl(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean);

create function private.create_event_impl(
  p_title text,
  p_type text,
  p_group_id bigint,
  p_starts_at timestamptz,
  p_ends_at timestamptz default null,
  p_location text default null,
  p_capacity integer default null,
  p_description text default null,
  p_min_level integer default 0,
  p_campaign_id bigint default null,
  p_announce boolean default false,
  p_all_day boolean default false
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
  perform private.require_formatted_text_length('description', btrim(p_description));
  -- Security pass 2026-09-27 (L1): events_location_length_ck, measured as stored.
  perform private.require_text_length('location', btrim(p_location), null, 200);
  if p_type is null or p_type not in ('sedinta','activitate','call','eveniment','deadline','recrutare') then
    raise sqlstate 'PT400' using message = 'invalid_event_type';
  end if;
  if p_starts_at is null or (p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise sqlstate 'PT400' using message = 'invalid_event_interval';
  end if;
  -- #1098 (R63): events_all_day_bounds_ck, said before anything is judged.
  if coalesce(p_all_day, false) and (
       p_ends_at is null
       or (p_starts_at at time zone 'Europe/Bucharest')::time <> time '00:00'
       or (p_ends_at at time zone 'Europe/Bucharest')::time <> time '00:00') then
    raise sqlstate 'PT400' using message = 'invalid_all_day_bounds';
  end if;
  -- #673 (R8): an Event's start is judged against now only at creation.
  -- #1098: an all-day Event starts at today's midnight, so it is judged by
  -- its Bucharest day -- today's may still be created.
  if (case when coalesce(p_all_day, false)
          then (p_starts_at at time zone 'Europe/Bucharest')::date
               < (now() at time zone 'Europe/Bucharest')::date
          else p_starts_at < now() end) then
    raise sqlstate 'PT400' using message = 'starts_at_in_past';
  end if;
  -- #673 (R8): capacity 1-1000 (events_capacity_range_ck).
  if p_capacity is not null and (p_capacity <= 0 or p_capacity > 1000) then
    raise sqlstate 'PT400' using message = 'invalid_event_capacity';
  end if;
  -- R57: every Role on the ladder.
  if p_min_level is null or p_min_level not in (0, 1, 2, 3, 5, 6) then
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
    insert into public.events(title,type,group_id,starts_at,ends_at,all_day,location,capacity,description,min_level,campaign_id,created_by)
      values (btrim(p_title),p_type::public.event_type,p_group_id,p_starts_at,p_ends_at,coalesce(p_all_day, false),
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
  -- Spec 2026-10-11: a pending Event (OSUBB-wide, writer below BC -- the stamp
  -- decided) tells nobody yet; BC are asked by the request trigger. Its
  -- Announcement, if asked for, is written when approve_event publishes it.
  if v_created.approval_status = 'pending' then
    if coalesce(p_announce, false) then
      update public.events set announce_on_approval = true where id = v_created.id returning * into v_created;
    end if;
    return v_created;
  end if;
  -- #909: the Announcement goes through the table's own row guards (text,
  -- Termen, authorship stamp, the author's daily cap) and its fan-out trigger;
  -- any refusal there rolls the Event back with it. It copies the Event's
  -- Minimum Level, so it reaches exactly the Members who can see the Event.
  if coalesce(p_announce, false) then
    -- R53: the Announcement records the Event it was written for
    -- (private.guard_announcement_event reads this setting, never a client).
    perform set_config('osubb.announcement_event', v_created.id::text, true);
    insert into public.announcements(title, body, group_id, audience, min_level, deadline, created_by)
      values (v_created.title,
              private.event_announcement_body(v_created.starts_at, v_created.ends_at,
                                              v_created.location, v_created.description,
                                              v_created.all_day),
              v_created.group_id,
              case when v_group.is_organization then 'org' else 'local' end,
              v_created.min_level,
              -- The Termen is the Event's start. #1098: an all-day Event of
              -- today started at midnight, which the Termen guard refuses as
              -- past: it is happening now, so its Announcement has no Termen.
              case when v_created.starts_at >= now() then v_created.starts_at end,
              v_actor);
    perform set_config('osubb.announcement_event', '', true);
  else
    -- R39: without the Announcement, the Event tells its audience itself.
    perform private.notify_event_created(v_created, v_actor);
  end if;
  return v_created;
end;
$$;

comment on function private.create_event_impl(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean, boolean) is
  'Creates an Event on a Group, authorized by Group Role (ADR-0009 Wave 2, #370). Malformed input is judged first, for everyone, so a caller without organization claims learns what is wrong with the call: PT400 invalid_event_title / invalid_event_type / invalid_event_interval / invalid_all_day_bounds / invalid_event_capacity / invalid_event_min_level / event_group_required. #1098 (R63): p_all_day = true stores a Toată ziua Event, whose bounds must be Bucharest midnights with an end (exclusive, the midnight after its last day) -- anything else is PT400 invalid_all_day_bounds, the rule of events_all_day_bounds_ck -- and whose start is judged against today by its Bucharest day (PT400 starts_at_in_past only for a day before today). The Organization Group — since #582 the Group carrying groups.is_organization, not the row mirroring the legacy org pseudo-department — is open to any live Member holding any Group Role anywhere, which is how a Department''s leadership gets an organization-wide Event, or to level >= 6; every other Group goes through private.require_group_work_manager, so a Group Manager or Group Responsible on the path, an ancestor''s included, qualifies and an ordinary member does not. Every refusal is the single non-disclosing 42501 calendar_manage_forbidden, so a missing, archived or forbidden Group are indistinguishable. Minimum Level is then judged against the loaded rows: PT400 event_min_level_below_group (an Event may not be more open than its Group) and PT400 event_min_level_above_actor (nobody raises an Event above their own live level), the latter with Moderator exempt. An optional Campaign (#691, ADR-0008 amended 2026-09-23) must be owned by the Event''s Group or a Group above it and be active (events_validate_campaign); anything else is PT400 invalid_campaign, the string create_task uses for the same condition. #909: p_announce = true also publishes one Announcement in the same transaction (title, a Romanian date/time/place/description body from private.event_announcement_body, the Event''s Group, audience org for the Organization Group else local, min_level = the Event''s, deadline = starts_at -- none for an all-day Event of today, whose start has passed, #1098 --, the caller as author, normal fan-out); it is judged before the Event is written by the announcements_create predicate private.can_publish_announcement (42501 announcement_publish_forbidden). Any refusal, including the Announcement''s own row guards, leaves no Event behind. Ruling R39 (2026-10-06): without p_announce the new Event notifies its audience once -- private.event_notification_recipients (the Group Audience that Notifications reach, minus BC and the Moderator per R32 save a BC member whose Group position reaches the Event''s Group per R42, read through private.can_read_event: Minimum Level and Private Groups), never the creator -- with kind event, title Eveniment nou: <title>, the date line and place of private.event_announcement_body as body, link /calendar?event=<id> and dedupe key event:<id>:created (subject event:<id>, R37), in one private.notify insert. With p_announce the Announcement''s fan-out is that notice, so no Event Notification is written: one notice per Member. Every creation spends the event_create daily cap (50 per Member in any 24 hours, private.require_daily_cap; PT409 rate_limited), judged after the gate and before the Event is written. Spec 2026-10-11: an OSUBB-wide Event by a writer below BC is written pending (private.stamp_approval), tells nobody and keeps p_announce as announce_on_approval for approve_event; the "Eveniment nou" notice lives in private.notify_event_created.';

revoke execute on function private.create_event_impl(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.create_event_impl(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean, boolean)
  to authenticated;

create function public.create_event(
  p_title text,
  p_type text,
  p_group_id bigint,
  p_starts_at timestamptz,
  p_ends_at timestamptz default null,
  p_location text default null,
  p_capacity integer default null,
  p_description text default null,
  p_min_level integer default 0,
  p_campaign_id bigint default null,
  p_announce boolean default false,
  p_all_day boolean default false
)
returns public.events
language sql
security invoker
set search_path = ''
as $$
  select private.create_event_impl(p_title, p_type, p_group_id, p_starts_at, p_ends_at,
    p_location, p_capacity, p_description, p_min_level, p_campaign_id, p_announce, p_all_day);
$$;

comment on function public.create_event(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean, boolean) is
  'Security-invoker wrapper over private.create_event_impl (#370; p_campaign_id #691; p_announce #909; p_all_day #1098). Replaces the grandfathered direct-definer command that gated on a flat level >= 4; no Tracker or Calendar authority reads level 4 any more.';

revoke execute on function public.create_event(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.create_event(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean, boolean)
  to authenticated;

-- ==================== 3b. update_event(p_all_day) ====================
drop function public.update_event(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint);
drop function private.update_event_impl(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint);

create function private.update_event_impl(
  p_event_id bigint,
  p_title text,
  p_type text,
  p_group_id bigint,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_location text,
  p_capacity integer,
  p_description text,
  p_min_level integer,
  p_campaign_id bigint,
  p_all_day boolean default false
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_level integer;
  v_event public.events%rowtype;
  v_updated public.events%rowtype;
  v_target public.groups%rowtype;
  v_recipients uuid[];
  v_old_members uuid[];
  v_fields text[];
  v_parts text[];
  v_constraint text;
begin
  -- 1. Malformed input, judged for everyone before the gate.
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_event_title';
  end if;
  -- #673 (R8): measured as stored (btrim).
  perform private.require_text_length('title', btrim(p_title), 3, 120);
  perform private.require_formatted_text_length('description', btrim(p_description));
  -- Security pass 2026-09-27 (L1): events_location_length_ck, measured as stored.
  perform private.require_text_length('location', btrim(p_location), null, 200);
  if p_type is null or p_type not in ('sedinta', 'activitate', 'call', 'eveniment', 'deadline', 'recrutare') then
    raise sqlstate 'PT400' using message = 'invalid_event_type';
  end if;
  if p_starts_at is null or (p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise sqlstate 'PT400' using message = 'invalid_event_interval';
  end if;
  -- #1098 (R63): events_all_day_bounds_ck, create_event's reason.
  if coalesce(p_all_day, false) and (
       p_ends_at is null
       or (p_starts_at at time zone 'Europe/Bucharest')::time <> time '00:00'
       or (p_ends_at at time zone 'Europe/Bucharest')::time <> time '00:00') then
    raise sqlstate 'PT400' using message = 'invalid_all_day_bounds';
  end if;
  -- #673 (R8): capacity 1-1000 (events_capacity_range_ck).
  if p_capacity is not null and (p_capacity <= 0 or p_capacity > 1000) then
    raise sqlstate 'PT400' using message = 'invalid_event_capacity';
  end if;
  -- R57: every Role on the ladder.
  if p_min_level is null or p_min_level not in (0, 1, 2, 3, 5, 6) then
    raise sqlstate 'PT400' using message = 'invalid_event_min_level';
  end if;
  if p_group_id is null then
    raise sqlstate 'PT400' using message = 'event_group_required';
  end if;

  -- 2. Gate.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end;

  -- 3. Lock the Event before inspecting its state; concurrent edits and cancellation serialize.
  select * into v_event from public.events where id = p_event_id for no key update;
  if not found or coalesce(private.actor_level(v_actor), -1) < v_event.min_level then
    raise sqlstate 'PT404' using message = 'event_not_found';
  end if;
  perform 1 from public.profiles where id = v_actor and status = 'activ' for share;
  if not found then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;

  -- 4. Visibility is judged before authority: a hidden Event is a missing one.
  --    #756: the events_read rule itself, so an Event of a Private Group is
  --    missing for an outsider rather than forbidden.
  v_level := private.actor_level(v_actor);
  if not private.can_read_event(v_event.group_id, v_event.min_level, v_actor) then
    raise sqlstate 'PT404' using message = 'event_not_found';
  end if;
  -- #934: who manages the Event is one rule, private.can_manage_event, which
  -- the other command and the event_attendance_read policy read too. Hold the
  -- roster rows a Group Role answer rests on FOR SHARE, then ask again on the
  -- locked snapshot (require_group_work_manager's discipline), so a Group Role
  -- removed concurrently serializes behind this decision. BC, the Moderator and
  -- an Organization Event's creator rest on the Profile row held above.
  if not private.can_manage_event(p_event_id) then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  perform 1
     from public.groups as target
     join public.group_members as gm on target.path @> array[gm.group_id]
    where target.id = v_event.group_id
      and gm.member_id = v_actor
      and gm.group_role in ('manager', 'responsible')
    order by gm.group_id
      for share of gm;
  if not private.can_manage_event(p_event_id) then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;

  -- An unknown Group is refused as "you may not", never as "no such Group".
  -- The ACTIVE requirement belongs to the move, not to the argument: see the
  -- header (reason 2). An edit that keeps the Event in its own Group is left
  -- to step 4's rule, which already gates a Group Role on the Group's status.
  select * into v_target from public.groups where id = p_group_id;
  if not found
     or (p_group_id is distinct from v_event.group_id and v_target.status <> 'active') then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  if p_group_id is distinct from v_event.group_id then
    -- Even an Organization Event's creator must hold authority in the new Group.
    begin
      if v_target.is_organization then
        if v_level < 6 then
          -- Lock only roster rows: Group SHARE locks conflict with legacy mirror upserts.
          perform 1 from public.group_members as gm
            where gm.member_id = v_actor and gm.group_role in ('manager', 'responsible')
            order by gm.group_id for share of gm;
          if not found then
            raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
          end if;
        end if;
      else
        perform private.require_group_work_manager(p_group_id);
      end if;
    exception when insufficient_privilege then
      raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
    end;
  end if;

  -- 5. Minimum Level, judged against the loaded target Group and the live actor.
  if p_min_level < v_target.min_level then
    raise sqlstate 'PT400' using message = 'event_min_level_below_group';
  end if;
  if v_level < 9 and p_min_level > v_level then
    raise sqlstate 'PT400' using message = 'event_min_level_above_actor';
  end if;

  -- 6. Terminal state.
  if v_event.cancelled_at is not null then
    raise sqlstate 'PT409' using message = 'event_cancelled';
  end if;

  -- 7. Full-state replace: every column the caller names is written, so a null
  --    argument CLEARS a nullable column instead of leaving the old value.
  -- #601: the old Group's whole Group Audience, not only its explicit roster -- and,
  -- like every Event recipient, only those who can read the Event at its NEW
  -- Minimum Level (private.can_read_event, the events_read rule) -- and, since
  -- #756, in its NEW Group, so a move into a Private Group tells no outsider.
  -- #929 (R32): the Group Audience that Notifications reach, so no BC or
  -- Moderator hears of it through membership.
  -- Final review of 2026-10-13 (I2): an audience never told of a pending or
  -- rejected Event is not told of its move either.
  if v_event.approval_status = 'approved' then
    select array_agg(member_id) into v_old_members
      from private.group_notification_audience(v_event.group_id) as member_id
     where private.can_read_event(p_group_id, p_min_level, member_id);
  end if;
  -- #691: the Campaign is judged by events_validate_campaign against the Event's
  -- (possibly new) Group; a move carrying a Campaign off the new path, an unknown
  -- id or a newly attached inactive Campaign is PT400 invalid_campaign.
  begin
    update public.events set title = btrim(p_title), type = p_type::public.event_type,
      group_id = p_group_id, starts_at = p_starts_at, ends_at = p_ends_at,
      all_day = coalesce(p_all_day, false),
      location = nullif(btrim(p_location), ''), capacity = p_capacity,
      description = nullif(btrim(p_description), ''), min_level = p_min_level,
      campaign_id = p_campaign_id
     where id = p_event_id returning * into v_updated;
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
  select array_agg(recipient) into v_recipients
    from private.event_notification_recipients(p_event_id) as recipient;
  -- Published by the move (spec 2026-10-11, final review I2): a pending or
  -- rejected OSUBB-wide Event that left the Organization Group is approved by
  -- private.stamp_approval; its new Group hears of it as a new Event, not of
  -- the changes to one it never saw.
  if v_event.approval_status <> 'approved' and v_updated.approval_status = 'approved' then
    perform private.notify_event_created(v_updated, v_actor);
    return v_updated;
  end if;
  if v_event.group_id is distinct from v_updated.group_id then
    v_recipients := coalesce(v_recipients, '{}'::uuid[]) || coalesce(v_old_members, '{}'::uuid[]);
  end if;
  -- R53 (2026-10-14): every content change tells them, in one notice per
  -- edit that names what changed and spells out a new schedule, place, Group
  -- or Minimum Level (private.notify_event: "Eveniment nou" to anyone never
  -- told of the Event, such as a new Group's audience). #691: a Campaign is a
  -- label -- absent from both lists, so a Campaign-only edit tells nobody.
  v_fields := array_remove(array[
    case when v_event.title is distinct from v_updated.title then 'titlu' end,
    case when v_event.description is distinct from v_updated.description then 'descriere' end,
    case when v_event.type is distinct from v_updated.type then 'tip' end,
    case when v_event.starts_at is distinct from v_updated.starts_at
           or v_event.ends_at is distinct from v_updated.ends_at
           or v_event.all_day is distinct from v_updated.all_day then 'programare' end,
    case when v_event.location is distinct from v_updated.location then 'locație' end,
    case when v_event.capacity is distinct from v_updated.capacity then 'capacitate' end,
    case when v_event.group_id is distinct from v_updated.group_id then 'grup' end,
    case when v_event.min_level is distinct from v_updated.min_level then 'nivel minim' end
  ], null);
  -- The notice names what changed, then always the current schedule and
  -- place: a later edit refreshes an unread notice in place, and must never
  -- hide that the time or the place moved before it.
  if cardinality(v_fields) > 0 then
    v_parts := array_remove(array[
      'Modificat: ' || array_to_string(v_fields, ', '),
      'Programare: '
        || case when v_updated.all_day then
             -- #1098: days only, the last one the day before the exclusive end.
             to_char(v_updated.starts_at at time zone 'Europe/Bucharest', 'DD.MM.YYYY')
             || case when ((v_updated.ends_at at time zone 'Europe/Bucharest') - interval '1 day')::date
                          > (v_updated.starts_at at time zone 'Europe/Bucharest')::date
                     then ' - ' || to_char((v_updated.ends_at at time zone 'Europe/Bucharest') - interval '1 day', 'DD.MM.YYYY')
                     else '' end
             || ', toată ziua'
           else
             to_char(v_updated.starts_at at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI')
             || coalesce(' - ' || to_char(v_updated.ends_at at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI'), '')
           end,
      'Locație: ' || v_updated.location,
      case when v_event.group_id is distinct from v_updated.group_id then 'Grup: ' || v_target.name end,
      case when v_event.min_level is distinct from v_updated.min_level
        then 'Nivel minim: ' || v_updated.min_level::text end
    ], null);
    perform private.notify_event(v_updated, v_actor, v_recipients, array_to_string(v_parts, '. '));
  end if;
  return v_updated;
end;
$$;

comment on function private.update_event_impl(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean) is
  'Replaces an Event''s whole editable state, authorized by Group Role (ADR-0009 Wave 2, #248). This is a full-state REPLACE, not a patch: every editable column is written from its argument, so a null clears a nullable column (ends_at, location, capacity, description, campaign_id) rather than leaving the old value -- a client that wants to keep a field must send it back; p_all_day (#1098, R63) is written too, null and absent meaning a timed Event. Malformed input is judged first, for everyone, with the same reasons as create_event including event_group_required and invalid_all_day_bounds. A caller who cannot see the Event (below its min_level) is answered PT404 event_not_found, the same as an id that does not exist: hidden is never distinguishable from missing. Authority on the SOURCE: an Organization Group Event (since #582 the Group carrying groups.is_organization) belongs to its creator or to level >= 6; every other Event goes through private.require_group_work_manager, so a Group Manager or Group Responsible of the Group or any ancestor on its path qualifies. Moving the Event re-runs the rule on the TARGET Group, where an Organization target takes create_event''s rule -- level >= 6 or any live Group Role anywhere -- because the Organization Group is a root Group with no ancestors of its own (one root among several: every Department, Independent Team and Project Group is a root too, and most Group paths never contain it), so nobody could reach it through an ancestor role. A MOVE''s target must be active. An edit that leaves the Event in its own Group is NOT refused when that Group has since been archived: this is a full-state replace, so every call names a Group, and an ungated check would leave such an Event uncorrectable while cancel_event -- same authority rule -- still cancelled it. Who may still edit it is decided by the source rule above alone: BC/Moderator always, a Group Role only while the Group is active, which is can_manage_group_work''s own status gate. Minimum Level is then judged against the target Group and the live actor (PT400 event_min_level_below_group / event_min_level_above_actor), and a cancelled Event is PT409 event_cancelled. The Campaign (#691, ADR-0008 amended 2026-09-23) must be owned by the Event''s Group -- the new one, on a move -- or a Group above it, and a newly attached one must be active (events_validate_campaign); anything else is PT400 invalid_campaign, and a Campaign deactivated after it was attached is kept when sent back unchanged. R53 (2026-10-14): every content change -- title, description, type, schedule (an all-day switch included), location, capacity, Group, Minimum Level -- notifies, in one notice per edit that names what changed and carries the current schedule (for an all-day Event its days and "toată ziua", no hour) and place, the current going attendees and the new Group''s Group Audience as Notifications reach it (private.group_notification_audience: #601, minus every live BC member and Moderator, #929, plus the BC members whose Group position reaches it, R42), plus the old Group''s when the Event moved, every recipient filtered through private.can_read_event at the new Minimum Level, link /calendar?event=<id>: private.notify_event tells whoever knows the Event "Eveniment actualizat" (event:<id>:changed) and whoever does not "Eveniment nou"; a Campaign alone notifies nobody. #934: the source-authority rule is private.can_manage_event, the one definition event_attendance_read also reads; the command holds the roster rows it rests on FOR SHARE and asks it again. Spec 2026-10-11 (final review of 2026-10-13): a pending or rejected OSUBB-wide Event moved off the Organization Group is published by the move (private.stamp_approval) -- its new Group hears "Eveniment nou" through private.notify_event_created and no change notice is sent; the old Group''s audience is told of a move only when the Event had been approved.';

revoke execute on function private.update_event_impl(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.update_event_impl(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean)
  to authenticated;

create function public.update_event(
  p_event_id bigint,
  p_title text,
  p_type text,
  p_group_id bigint,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_location text,
  p_capacity integer,
  p_description text,
  p_min_level integer,
  p_campaign_id bigint,
  p_all_day boolean default false
)
returns public.events
language sql
security invoker
set search_path = ''
as $$
  select private.update_event_impl(p_event_id, p_title, p_type, p_group_id,
    p_starts_at, p_ends_at, p_location, p_capacity, p_description, p_min_level, p_campaign_id, p_all_day);
$$;

comment on function public.update_event(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean) is
  'Security-invoker wrapper over private.update_event_impl (#248; p_campaign_id #691; p_all_day #1098). A full-state replace: p_campaign_id has no default, and null clears the Campaign; p_all_day defaults to a timed Event, so a client that predates it keeps sending timed edits.';

revoke execute on function public.update_event(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.update_event(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean)
  to authenticated;

-- ==================== 4. notify_event, approve_event_impl ====================
create or replace function private.notify_event(p_event public.events, p_actor uuid, p_members uuid[], p_changed text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_members uuid[] := coalesce(p_members, '{}'::uuid[]);
  v_told uuid[];
  v_link text := '/calendar?event=' || p_event.id::text;
  v_schedule text := private.event_announcement_body(p_event.starts_at, p_event.ends_at, p_event.location, null,
                                                              p_event.all_day);
begin
  -- Whoever holds a notice about it -- or about the Announcement written for
  -- it -- or answered it (Particip or not), knows it.
  v_told := private.told_of(v_members, 'event:' || p_event.id::text)
            || array(select attendance.member_id from public.event_attendance as attendance
                      where attendance.event_id = p_event.id and attendance.member_id = any (v_members))
            || array(select told.member_id
                       from public.announcements as announcement
                      cross join lateral unnest(
                        private.told_of(v_members, 'announcement:' || announcement.id::text)) as told(member_id)
                      where announcement.event_id = p_event.id);
  perform private.notify(
    array(select member from unnest(v_members) as member where member <> all (v_told)),
    'event', 'Eveniment nou: ' || p_event.title, v_schedule,
    null, 'event:' || p_event.id::text || ':created', p_actor, v_link);
  perform private.notify(v_told, 'event', 'Eveniment actualizat: ' || p_event.title,
    coalesce(p_changed, v_schedule),
    null, 'event:' || p_event.id::text || ':changed', p_actor, v_link);
end;
$$;

create or replace function private.approve_event_impl(p_id bigint)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_row public.events%rowtype;
  v_group public.groups%rowtype;
  v_announce boolean;
  v_decider text;
begin
  v_actor := private.approval_decider();
  select * into v_row from public.events where id = p_id for no key update;
  if not found then
    raise sqlstate 'PT404' using message = 'event_not_found';
  end if;
  perform private.require_approval_decider_locked(v_actor);
  -- A cancelled Event is history, whatever it waited for (I1).
  if v_row.cancelled_at is not null then
    raise sqlstate 'PT409' using message = 'event_cancelled';
  end if;
  if v_row.approval_status <> 'pending' then
    raise sqlstate 'PT409' using message = 'event_not_pending';
  end if;
  select * into v_group from public.groups where id = v_row.group_id;
  v_announce := v_row.announce_on_approval;
  perform set_config('osubb.deciding_approval', 'on', true);
  update public.events
     set approval_status = 'approved', approval_decided_by = v_actor, approval_decided_at = now(),
         rejection_reason = null, announce_on_approval = false
   where id = p_id
   returning * into v_row;
  perform set_config('osubb.deciding_approval', 'off', true);
  -- The Announcement the Event asked for, as the Event's author (the authorship
  -- stamp honours osubb.announcement_author), approved since BC inserts it,
  -- with its own fan-out -- and never "Anunț nou" to that author. Not once the
  -- Event has started: its Termen would be in the past (I1); the notice then.
  if v_announce and v_row.starts_at > now() then
    perform set_config('osubb.announcement_author', v_row.created_by::text, true);
    -- R53: the Announcement records the Event it was written for.
    perform set_config('osubb.announcement_event', v_row.id::text, true);
    insert into public.announcements(title, body, group_id, audience, min_level, deadline, created_by)
      values (v_row.title,
              private.event_announcement_body(v_row.starts_at, v_row.ends_at, v_row.location, v_row.description,
                                                    v_row.all_day),
              v_row.group_id,
              case when v_group.is_organization then 'org' else 'local' end,
              v_row.min_level,
              v_row.starts_at,
              v_row.created_by);
    perform set_config('osubb.announcement_author', '', true);
    perform set_config('osubb.announcement_event', '', true);
  else
    perform private.notify_event_created(v_row, v_row.created_by);
  end if;
  select profile.full_name into v_decider from public.profiles as profile where profile.id = v_actor;
  perform private.notify(array[v_row.created_by], 'event', 'Evenimentul tău a fost aprobat: ' || v_row.title,
    'Publicat de ' || coalesce(v_decider, 'BC') || '.', null,
    'approval:events:' || p_id::text || ':approved', v_actor, '/calendar?event=' || p_id::text);
  return v_row;
end;
$$;

-- ==================== 5. send_reminders ====================
create or replace function private.send_reminders(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'Europe/Bucharest';
  v_today date := (p_now at time zone 'Europe/Bucharest')::date;
  v_count integer := 0;
  v_key text;
  v_members uuid[];
  v_task record;
  v_event record;
  v_announcement public.announcements%rowtype;
begin
  -- 09:00 Bucharest time, whatever the season: the job runs every hour.
  if extract(hour from v_local) <> 9 then
    return 0;
  end if;
  -- #69: serialize scheduled and manual retries; the unread-only key index
  -- alone cannot keep a reminder its recipient already read from repeating.
  perform pg_catalog.pg_advisory_xact_lock(69, 1);

  -- Tasks: the current Executor, three days before and the day before. A
  -- Task handed in for review is out of the Executor's hands.
  for v_task in
    select task.id, task.title, task.deadline, assignment.member_id,
           (task.deadline at time zone 'Europe/Bucharest')::date - v_today as days_left
      from public.tasks as task
      join public.task_assignments as assignment
        on assignment.task_id = task.id and assignment.ended_at is null
      join public.profiles as member
        on member.id = assignment.member_id and member.status = 'activ'
     where task.kind = 'task'
       and task.status in ('todo', 'in_progress')
       and task.deadline is not null
       and (task.deadline at time zone 'Europe/Bucharest')::date - v_today in (1, 3)
  loop
    v_key := 'task:' || v_task.id::text || ':reminder:' || v_today::text;
    if not exists (select 1 from public.notifications as notification
                    where notification.member_id = v_task.member_id
                      and notification.dedupe_key = v_key) then
      v_count := v_count + private.notify(array[v_task.member_id], 'deadline',
        case v_task.days_left when 3 then 'Mai sunt 3 zile: ' else 'Termenul e mâine: ' end || v_task.title,
        'Termen: ' || to_char(v_task.deadline at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI'),
        v_task.id, v_key, null);
    end if;
  end loop;

  -- Events: everyone going who can still read it, the day before it starts.
  for v_event in
    select event.id, event.title, event.starts_at, event.ends_at, event.all_day, event.location, attendance.member_id
      from public.events as event
      join public.event_attendance as attendance
        on attendance.event_id = event.id and attendance.status = 'going'
      join public.profiles as member
        on member.id = attendance.member_id and member.status = 'activ'
     where event.approval_status = 'approved'
       and event.cancelled_at is null
       and (event.starts_at at time zone 'Europe/Bucharest')::date = v_today + 1
       and private.can_read_event(event.group_id, event.min_level, attendance.member_id)
  loop
    v_key := 'event:' || v_event.id::text || ':reminder:' || v_today::text;
    if not exists (select 1 from public.notifications as notification
                    where notification.member_id = v_event.member_id
                      and notification.dedupe_key = v_key) then
      v_count := v_count + private.notify(array[v_event.member_id], 'event', 'Mâine: ' || v_event.title,
        -- #1098 (R63): an all-day Event has no hour to start at; one that
        -- spans several days names its last (the day before its end).
        case when v_event.all_day then
          'Toată ziua'
          || case when ((v_event.ends_at at time zone 'Europe/Bucharest') - interval '1 day')::date
                       > (v_event.starts_at at time zone 'Europe/Bucharest')::date
                  then ', până la ' || to_char((v_event.ends_at at time zone 'Europe/Bucharest') - interval '1 day', 'DD.MM.YYYY')
                  else '' end
        else 'Începe la ' || to_char(v_event.starts_at at time zone 'Europe/Bucharest', 'HH24:MI') end
          || coalesce(', ' || v_event.location, '') || '.',
        null, v_key, null, '/calendar?event=' || v_event.id::text);
    end if;
  end loop;

  -- Announcements and Deals: everyone the notice reaches, never the author,
  -- the day before the Termen -- not an Event's Announcement, and not a
  -- Member whose latest notice about it came today (it is still fresh; this
  -- also keeps a retry from repeating the reminder).
  for v_announcement in
    select * from public.announcements as announcement
     where announcement.approval_status = 'approved'
       and announcement.deadline is not null
       and not announcement.from_event
       and (announcement.deadline at time zone 'Europe/Bucharest')::date = v_today + 1
  loop
    v_key := 'announcement:' || v_announcement.id::text;
    select coalesce(array_agg(member), '{}'::uuid[]) into v_members
      from unnest(coalesce(private.announcement_recipients(v_announcement), '{}'::uuid[])) as member
     where not exists (
       select 1 from public.notifications as notification
        where notification.member_id = member
          and (notification.dedupe_key = v_key or notification.dedupe_key like v_key || ':%')
          and (notification.created_at at time zone 'Europe/Bucharest')::date = v_today)
       and not exists (
       select 1 from public.notifications as notification
        where notification.member_id = member
          and notification.dedupe_key = v_key || ':termen:' || v_today::text);
    v_count := v_count + private.notify(v_members, 'announce',
      case when v_announcement.kind = 'deal' then 'Oferta se încheie mâine: ' else 'Termen mâine: ' end
        || v_announcement.title,
      'Termen: ' || to_char(v_announcement.deadline at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI'),
      null, v_key || ':termen:' || v_today::text, v_announcement.created_by,
      case when v_announcement.kind = 'deal' then '/anunturi/deals?deal=' else '/anunturi?anunt=' end
        || v_announcement.id::text,
      v_announcement.priority = 'critical');
  end loop;

  return v_count;
end;
$$;
