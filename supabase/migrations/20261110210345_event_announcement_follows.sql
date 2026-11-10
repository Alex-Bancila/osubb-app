-- #1150: an Event's own Announcement follows the Event -- update_event rewrites it, cancel_event marks it "Anulat: ", delete_event deletes it.
--
-- Audit finding M8 (docs/review/2026-10-30-codebase-audit.md), decided in
-- #1144 (decision 2, option a: follow). create_event(p_announce) and
-- approve_event write one Announcement for the Event (announcements.event_id,
-- R53); until now update_event, cancel_event and delete_event left it as
-- written, so an Event moved from 3 to 10 November, or cancelled, kept a live
-- Announcement naming the 3rd, and an Event raised to BCE+ stayed readable by
-- its original audience through it.
--
-- 1. private.sync_event_announcement(before, after): the follow, called by
--    update_event_impl after the Event's own notices. The body builder is
--    already one function, private.event_announcement_body, which
--    create_event_impl, approve_event_impl and this helper all call, so there
--    is nothing to extract. Minimum Level, Termen (the start; none for an
--    all-day Event, R63), Group and Audience (org on the Organization Group,
--    else local -- create_event's rule) always follow. The body is rewritten
--    only while it still equals what the builder produced from the Event's
--    old state, and the title only while it is still the Event's old title,
--    so an author's own words are never overwritten.
-- 2. private.guard_announcement_origin admits the Group and Audience change
--    for exactly that write: the Event command names its Event in
--    osubb.announcement_event, the setting create_event and approve_event
--    already write the link under; a client never sets it.
-- 3. private.update_event_impl (main's latest, 20261101003738_archive_group_races.sql)
--    calls the helper before each of its two returns.
-- 4. private.cancel_event_effect (main's latest, 20260928100000_notification_links.sql)
--    puts "Anulat: " before the Announcement's title -- the word the Calendar
--    shows on a cancelled Event -- cutting a long title so it still fits in
--    120 characters. The write passes the approval stamp as the decision
--    commands' writes do: a cancellation is the Event's state, which never
--    sends the Event back to BC (stamp_approval skips cancelled_at), so it
--    does not send its Announcement back either.
-- 5. private.delete_event_impl (main's latest, 20261005022559_delete_for_good.sql)
--    deletes the Announcement and its Notifications, as delete_group deletes
--    a subtree's; its reads cascade.
--
-- An Announcement's existing edit path tells its readers "Anunț actualizat"
-- (private.notify_announcement_change, R53), so a rewrite and the mark reach
-- them the way any edit does; no Notification kind is added and the Event's
-- own Notifications are unchanged. The approval stamp judges the rewrite as
-- it judges any edit: an organization-wide Announcement rewritten by a writer
-- below BC waits for BC, as its Event does.

-- ==================== 1. private.sync_event_announcement ====================
create function private.sync_event_announcement(p_before public.events, p_after public.events)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_old_title text;
  v_old_body text;
  v_new_title text;
  v_new_body text;
  v_audience text;
  v_deadline timestamptz;
begin
  -- What the Event wrote, as announcements_guard_text stores it (trimmed), so
  -- the comparison reads the stored text and the rewrite stores what it says.
  v_old_title := regexp_replace(p_before.title, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_new_title := regexp_replace(p_after.title, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_old_body := regexp_replace(
    private.event_announcement_body(p_before.starts_at, p_before.ends_at, p_before.location,
                                    p_before.description, p_before.all_day),
    '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_new_body := regexp_replace(
    private.event_announcement_body(p_after.starts_at, p_after.ends_at, p_after.location,
                                    p_after.description, p_after.all_day),
    '^[[:space:]]+|[[:space:]]+$', '', 'g');
  -- create_event's rule: the Organization Group's Announcement goes to the
  -- whole organisation, every other Group's to its own audience.
  select case when grp.is_organization then 'org' else 'local' end into v_audience
    from public.groups as grp
   where grp.id = p_after.group_id;
  -- The Termen is the start; an all-day Event's Announcement has none (R63).
  v_deadline := case when not p_after.all_day then p_after.starts_at end;

  perform set_config('osubb.announcement_event', p_after.id::text, true);
  update public.announcements as announcement
     set title = case when announcement.title = v_old_title then v_new_title else announcement.title end,
         body = case when announcement.body = v_old_body then v_new_body else announcement.body end,
         group_id = p_after.group_id,
         audience = v_audience,
         min_level = p_after.min_level,
         deadline = v_deadline
   where announcement.event_id = p_after.id
     and (case when announcement.title = v_old_title then v_new_title else announcement.title end,
          case when announcement.body = v_old_body then v_new_body else announcement.body end,
          p_after.group_id, v_audience, p_after.min_level, v_deadline)
         is distinct from
         (announcement.title, announcement.body, announcement.group_id, announcement.audience,
          announcement.min_level, announcement.deadline);
  perform set_config('osubb.announcement_event', '', true);
end;
$$;

comment on function private.sync_event_announcement(public.events, public.events) is
  '#1150 (audit M8): makes the Announcement an Event wrote for itself (announcements.event_id) say what the Event now says, called by private.update_event_impl with the Event before and after the edit. Minimum Level, Termen (the start; none for an all-day Event, R63), Group and Audience (org on the Organization Group, else local, as create_event writes it) always follow. The body is rewritten through private.event_announcement_body only while it still equals what that builder produced from the Event''s old state (trimmed, as announcements_guard_text stores it), and the title only while it is still the Event''s old title, so an author''s own words are never overwritten. Writes nothing when nothing would change. The write runs the Announcement''s own row guards, approval stamp and edit notice ("Anunț actualizat", R53); private.guard_announcement_origin admits its Group and Audience change because the helper names the Event in osubb.announcement_event. Granted to nobody.';

revoke execute on function private.sync_event_announcement(public.events, public.events)
  from public, anon, authenticated, service_role;

-- ==================== 2. private.guard_announcement_origin ====================
create or replace function private.guard_announcement_origin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  -- #1150: the Event command that wrote this Announcement moves it with the
  -- Event (private.sync_event_announcement), naming that Event in
  -- osubb.announcement_event -- the setting create_event and approve_event
  -- write the link under, which no client sets.
  if old.event_id is null
     or old.event_id::text is distinct from nullif(current_setting('osubb.announcement_event', true), '') then
    if new.group_id is distinct from old.group_id then
      raise exception using errcode = '23514', message = 'announcement_group_immutable';
    end if;
    if new.audience is distinct from old.audience then
      raise exception using errcode = '23514', message = 'announcement_audience_immutable';
    end if;
  end if;
  -- R45: an Announcement never becomes a Deal, nor a Deal an Announcement --
  -- the two have different authors and readers.
  if new.kind is distinct from old.kind then
    raise exception using errcode = '23514', message = 'announcement_kind_immutable';
  end if;
  return new;
end;
$$;

comment on function private.guard_announcement_origin() is
  '#936, R45: announcements_guard_origin -- a signed-in update may not move an Announcement to another Group (23514 announcement_group_immutable), change its Audience (announcement_audience_immutable) or its kind (announcement_kind_immutable). Writes without auth.uid() (migrations, seed, jobs) pass. #1150: an Event''s own Announcement moves with its Event -- the Group and Audience change is admitted for the row whose event_id is the Event named in osubb.announcement_event, which only private.sync_event_announcement sets for an update; the kind never changes.';

-- ==================== 3. private.update_event_impl ====================
create or replace function private.update_event_impl(
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
  p_all_day boolean default null
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
  v_all_day boolean;
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
  -- #1098 (R63): events_all_day_bounds_ck, create_event's reason. A null
  -- p_all_day (a client from before it) keeps the Event's own, judged at
  -- step 5 once the row is loaded.
  if p_all_day and (
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

  -- 3a. #1145 (audit M6): the Group the call names -- a move's target, or the
  --     Event's own on an edit in place -- is held FOR SHARE before the Event
  --     row, the order archive_group takes (the Groups, then the subtree's
  --     Events), so the two serialize instead of deadlocking and a move's
  --     target status, judged after authority, is the one a concurrent
  --     archive committed; concurrent edits share the row. Unconditional on
  --     purpose: whether the call is a move is known only once the Event row
  --     is locked, and an edit in place only waits here (it is still not
  --     refused when its Group has been archived meanwhile, the header's
  --     reason 2). An unknown Group locks nothing and is judged below.
  perform 1 from public.groups as target where target.id = p_group_id for share;
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
  -- On a move this reads the row step 3a holds.
  select * into v_target from public.groups where id = p_group_id;
  if not found then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  if p_group_id is distinct from v_event.group_id then
    -- Even an Organization Event's creator must hold authority in the new Group.
    begin
      if v_target.is_organization then
        if v_level < 6 then
          -- Lock only roster rows here; on a move the target Group row is
          -- held FOR SHARE at step 3a (#1145). The legacy mirror upserts that
          -- once made a Group SHARE lock unsafe are gone since #586.
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
    -- #1145 (audit M6): the target must be active, judged after its authority
    -- on the row held at step 3a (PT409 group_archived, the creators' reason
    -- since #1127). A Group Role below level 6 already failed the rule above.
    if v_target.status <> 'active' then
      raise sqlstate 'PT409' using message = 'group_archived';
    end if;
  end if;

  -- 5. Minimum Level, judged against the loaded target Group and the live actor.
  if p_min_level < v_target.min_level then
    raise sqlstate 'PT400' using message = 'event_min_level_below_group';
  end if;
  if v_level < 9 and p_min_level > v_level then
    raise sqlstate 'PT400' using message = 'event_min_level_above_actor';
  end if;
  -- #1098 (R63): Toată ziua as asked, or -- p_all_day null, a client from
  -- before it -- as the Event already is, so such an edit never turns an
  -- all-day Event into a timed one; its bounds then answer to the kept value.
  v_all_day := coalesce(p_all_day, v_event.all_day);
  if p_all_day is null and v_all_day and (
       p_ends_at is null
       or (p_starts_at at time zone 'Europe/Bucharest')::time <> time '00:00'
       or (p_ends_at at time zone 'Europe/Bucharest')::time <> time '00:00') then
    raise sqlstate 'PT400' using message = 'invalid_all_day_bounds';
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
      all_day = v_all_day,
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
    -- #1150: the Event's own Announcement follows it, after the Event's
    -- notices, so who hears "new" or "changed" of the Event is decided as
    -- before.
    perform private.sync_event_announcement(v_event, v_updated);
    return v_updated;
  end if;
  -- #1130 (audit M7): the old Group's audience hears of the move only while
  -- the Event stays approved. A move by a Manager below BC onto the
  -- Organization Group sends it back to pending (private.stamp_approval), so
  -- v_recipients is empty and the old audience must not get "Eveniment
  -- actualizat" of an Event events_read now hides from them: approve_event
  -- tells them, "new" or "changed" through private.told_of, with the rest of
  -- the organisation once BC decides.
  if v_event.group_id is distinct from v_updated.group_id
     and v_updated.approval_status = 'approved' then
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
  -- #1150 (audit M8): the Event's own Announcement now says what the Event
  -- says -- after the Event's notices, so who hears "new" or "changed" of the
  -- Event is decided exactly as before.
  perform private.sync_event_announcement(v_event, v_updated);
  return v_updated;
end;
$$;

comment on function private.update_event_impl(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean) is
  'Replaces an Event''s whole editable state, authorized by Group Role (ADR-0009 Wave 2, #248). This is a full-state REPLACE, not a patch: every editable column is written from its argument, so a null clears a nullable column (ends_at, location, capacity, description, campaign_id) rather than leaving the old value -- a client that wants to keep a field must send it back; p_all_day (#1098, R63) is written too when given; null or absent (a client from before it) keeps the Event''s own all_day, and the bounds are then judged against it (PT400 invalid_all_day_bounds at step 5). Malformed input is judged first, for everyone, with the same reasons as create_event including event_group_required and invalid_all_day_bounds. A caller who cannot see the Event (below its min_level) is answered PT404 event_not_found, the same as an id that does not exist: hidden is never distinguishable from missing. Authority on the SOURCE: an Organization Group Event (since #582 the Group carrying groups.is_organization) belongs to its creator or to level >= 6; every other Event goes through private.require_group_work_manager, so a Group Manager or Group Responsible of the Group or any ancestor on its path qualifies. Moving the Event re-runs the rule on the TARGET Group, where an Organization target takes create_event''s rule -- level >= 6 or any live Group Role anywhere -- because the Organization Group is a root Group with no ancestors of its own (one root among several: every Department, Independent Team and Project Group is a root too, and most Group paths never contain it), so nobody could reach it through an ancestor role. A MOVE''s target must be active. An edit that leaves the Event in its own Group is NOT refused when that Group has since been archived: this is a full-state replace, so every call names a Group, and an ungated check would leave such an Event uncorrectable while cancel_event -- same authority rule -- still cancelled it. Who may still edit it is decided by the source rule above alone: BC/Moderator always, a Group Role only while the Group is active, which is can_manage_group_work''s own status gate. Minimum Level is then judged against the target Group and the live actor (PT400 event_min_level_below_group / event_min_level_above_actor), and a cancelled Event is PT409 event_cancelled. The Campaign (#691, ADR-0008 amended 2026-09-23) must be owned by the Event''s Group -- the new one, on a move -- or a Group above it, and a newly attached one must be active (events_validate_campaign); anything else is PT400 invalid_campaign, and a Campaign deactivated after it was attached is kept when sent back unchanged. R53 (2026-10-14): every content change -- title, description, type, schedule (an all-day switch included), location, capacity, Group, Minimum Level -- notifies, in one notice per edit that names what changed and carries the current schedule (for an all-day Event its days and "toată ziua", no hour) and place, the current going attendees and the new Group''s Group Audience as Notifications reach it (private.group_notification_audience: #601, minus every live BC member and Moderator, #929, plus the BC members whose Group position reaches it, R42), plus the old Group''s when the Event moved, every recipient filtered through private.can_read_event at the new Minimum Level, link /calendar?event=<id>: private.notify_event tells whoever knows the Event "Eveniment actualizat" (event:<id>:changed) and whoever does not "Eveniment nou"; a Campaign alone notifies nobody. #934: the source-authority rule is private.can_manage_event, the one definition event_attendance_read also reads; the command holds the roster rows it rests on FOR SHARE and asks it again. Spec 2026-10-11 (final review of 2026-10-13): a pending or rejected OSUBB-wide Event moved off the Organization Group is published by the move (private.stamp_approval) -- its new Group hears "Eveniment nou" through private.notify_event_created and no change notice is sent; the old Group''s audience is told of a move only when the Event had been approved and stays approved (#1130, audit M7 of 2026-10-30: a move by a Manager below BC onto the Organization Group makes it pending again, tells the old audience nothing of an Event events_read now hides from them, and leaves them to approve_event, which tells them with the rest of the organisation). #1145 (audit M6): a move holds the target Group FOR SHARE before the Event row (the order archive_group takes), so a concurrent archive serializes ahead of the move while concurrent moves share the row, and an archived target then answers PT409 group_archived after its authority rule. #1150 (audit M8): after the Event''s own notices, the Announcement the Event wrote for itself follows it through private.sync_event_announcement -- Minimum Level, Termen, Group and Audience always, its body and title only while they are still the text the Event wrote.';

-- ==================== 4. private.cancel_event_effect ====================
create or replace function private.cancel_event_effect(p_event_id bigint, p_reason text, p_actor uuid)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated    public.events%rowtype;
  v_recipients uuid[];
  v_deciding   text;
begin
  update public.events
     set cancelled_at = clock_timestamp(),
         cancel_reason = btrim(p_reason)
   where id = p_event_id
  returning * into v_updated;
  if not found then
    return null;
  end if;
  select array_agg(recipient) into v_recipients
    from private.event_notification_recipients(p_event_id) as recipient;
  perform private.notify(v_recipients, 'event', 'Eveniment anulat: ' || v_updated.title,
    v_updated.cancel_reason, null, 'event:' || p_event_id::text || ':cancelled', p_actor, '/calendar?event=' || p_event_id::text);
  -- #1150 (audit M8): the Event's own Announcement reads as cancelled --
  -- "Anulat: " before its title, the word the Calendar shows on the Event --
  -- a long title cut so the marked one still fits in 120 characters. A
  -- cancellation is the Event's state, never a content edit: stamp_approval
  -- skips cancelled_at, so it never sends the Event back to BC, and the mark
  -- passes the stamp the way the decision commands' writes do, so it does not
  -- send the Announcement back either. Its readers hear "Anunț actualizat" as
  -- from any edit (R53).
  v_deciding := current_setting('osubb.deciding_approval', true);
  perform set_config('osubb.deciding_approval', 'on', true);
  update public.announcements as announcement
     set title = case when char_length(announcement.title) <= 112
                      then 'Anulat: ' || announcement.title
                      else 'Anulat: ' || rtrim(left(announcement.title, 111)) || '…' end
   where announcement.event_id = p_event_id
     and announcement.title not like 'Anulat: %';
  perform set_config('osubb.deciding_approval', coalesce(v_deciding, ''), true);
  return v_updated;
end;
$$;

comment on function private.cancel_event_effect(bigint, text, uuid) is
  'The effect of cancelling an Event with no gate of its own (#582): the write (cancelled_at + the trimmed reason, which events_cancel_reason_ck requires together) and the fan-out to private.event_notification_recipients under dedupe key event:<id>:cancelled with link /calendar?event=<id>. Two callers bring their own authority -- private.cancel_event_impl, which decides whether this actor may cancel this Event and therefore also whether they can see it, and private.archive_group_impl, which does not ask that question at all: the authority there is the Group the archiver already passed require_group_manager on, so archiving cancels every future Event of the subtree whatever the archiver''s own Level. #1150 (audit M8): the Announcement the Event wrote for itself (announcements.event_id) gets "Anulat: " before its title, the Calendar''s word, its title cut to fit 120 characters; the mark is the Event''s state, so it is written past the approval stamp (osubb.deciding_approval) and never sends an organization-wide Announcement back to BC, and its readers hear "Anunț actualizat" as from any edit. Executable by no client role.';

-- ==================== 5. private.delete_event_impl ====================
create or replace function private.delete_event_impl(p_event_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid;
  v_event public.events%rowtype;
  v_rsvps integer;
begin
  -- cancel_event's gate, step for step (#934): the Event is managed by one rule.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end;
  -- Nothing hangs below an Event but its RSVPs and its own Announcement, so
  -- the target is FOR UPDATE.
  select * into v_event from public.events where id = p_event_id for update;
  if not found or coalesce(private.actor_level(v_actor), -1) < v_event.min_level then
    raise sqlstate 'PT404' using message = 'event_not_found';
  end if;
  perform 1 from public.profiles where id = v_actor and status = 'activ' for share;
  if not found then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  if not private.can_read_event(v_event.group_id, v_event.min_level, v_actor) then
    raise sqlstate 'PT404' using message = 'event_not_found';
  end if;
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

  -- The RSVPs cascade with the row; the Event's Notifications go with it.
  -- #1150 (audit M8): so does the Announcement the Event wrote for itself
  -- (announcements.event_id), with its Notifications, as delete_group
  -- deletes a subtree's; its reads cascade. Its rows are locked in id order
  -- after the Event, the order update_event and cancel_event reach them in.
  select count(*)::integer into v_rsvps from public.event_attendance where event_id = p_event_id;
  perform 1 from public.announcements as announcement
    where announcement.event_id = p_event_id
    order by announcement.id
      for update of announcement;
  delete from public.notifications
   where subject in (select 'announcement:' || announcement.id::text
                       from public.announcements as announcement
                      where announcement.event_id = p_event_id);
  delete from public.announcements where event_id = p_event_id;
  delete from public.notifications where subject = 'event:' || p_event_id::text;
  delete from public.events where id = p_event_id;

  return jsonb_build_object('rsvps', v_rsvps);
end;
$function$;

comment on function private.delete_event_impl(bigint) is
  '#1017 (ruling R38): body of public.delete_event. cancel_event''s gate without its reason and state checks: 42501 calendar_manage_forbidden for a claimless or inactive caller; the Event locked FOR UPDATE; PT404 event_not_found when missing or unreadable (below its Minimum Level, outside a Private Group); private.can_manage_event read, the deciding roster rows held FOR SHARE, and read again (42501 calendar_manage_forbidden). A cancelled Event may be deleted too. Deletes the Event''s Notifications (subject event:<id>) and the Event; its RSVPs cascade. #1150 (audit M8): the Announcement the Event wrote for itself (announcements.event_id) is deleted with it, with its Notifications (subject announcement:<id>); its reads cascade. Returns {"rsvps"}.';
comment on function public.delete_event(bigint) is
  '#1017 (ruling R38): whoever manages an Event deletes it for good, with its RSVPs and Notifications. #1150: the Announcement created together with it goes too. Body: private.delete_event_impl.';
