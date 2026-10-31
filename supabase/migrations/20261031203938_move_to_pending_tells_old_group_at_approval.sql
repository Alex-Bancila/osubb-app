-- #1130: a move that sends an approved Event back to pending tells its old Group nothing; they hear of it at approval.
--
-- Finding M7 of the codebase audit of 2026-10-30
-- (docs/review/2026-10-30-codebase-audit.md). private.update_event_impl
-- collected the old Group's audience (v_old_members) whenever the Event had
-- been approved, and appended it to the recipients of every move. A move by a
-- Manager below BC onto the Organization Group makes the Event pending again
-- (private.stamp_approval), so private.event_notification_recipients answered
-- nobody -- but the appended old audience still got "Eveniment actualizat ...
-- Grup: OSUBB" (or "Eveniment nou", never having been told) with a link to an
-- Event events_read now hides from them: a Department member opened it to
-- "nu există". supabase/tests/approvals.test.sql, the "Ev moved up" scenario,
-- failed before this file.
--
-- Rebuilt from 20261023190000_all_day_events.sql with one guard: the old
-- audience is appended only while the Event stays approved. When the move made
-- it pending, approve_event's existing path (private.notify_event_created ->
-- private.notify_event, "new" or "changed" through private.told_of) tells the
-- old Group with the rest of the organisation once BC decides. A move by BC or
-- the Moderator keeps the Event approved and still tells the old audience, as
-- update_event.test.sql and edit_notices.test.sql pin. approve_event, told_of
-- and notify_event are untouched; the grants on update_event_impl persist
-- through create or replace.

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
  return v_updated;
end;
$$;

comment on function private.update_event_impl(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean) is
  'Replaces an Event''s whole editable state, authorized by Group Role (ADR-0009 Wave 2, #248). This is a full-state REPLACE, not a patch: every editable column is written from its argument, so a null clears a nullable column (ends_at, location, capacity, description, campaign_id) rather than leaving the old value -- a client that wants to keep a field must send it back; p_all_day (#1098, R63) is written too when given; null or absent (a client from before it) keeps the Event''s own all_day, and the bounds are then judged against it (PT400 invalid_all_day_bounds at step 5). Malformed input is judged first, for everyone, with the same reasons as create_event including event_group_required and invalid_all_day_bounds. A caller who cannot see the Event (below its min_level) is answered PT404 event_not_found, the same as an id that does not exist: hidden is never distinguishable from missing. Authority on the SOURCE: an Organization Group Event (since #582 the Group carrying groups.is_organization) belongs to its creator or to level >= 6; every other Event goes through private.require_group_work_manager, so a Group Manager or Group Responsible of the Group or any ancestor on its path qualifies. Moving the Event re-runs the rule on the TARGET Group, where an Organization target takes create_event''s rule -- level >= 6 or any live Group Role anywhere -- because the Organization Group is a root Group with no ancestors of its own (one root among several: every Department, Independent Team and Project Group is a root too, and most Group paths never contain it), so nobody could reach it through an ancestor role. A MOVE''s target must be active. An edit that leaves the Event in its own Group is NOT refused when that Group has since been archived: this is a full-state replace, so every call names a Group, and an ungated check would leave such an Event uncorrectable while cancel_event -- same authority rule -- still cancelled it. Who may still edit it is decided by the source rule above alone: BC/Moderator always, a Group Role only while the Group is active, which is can_manage_group_work''s own status gate. Minimum Level is then judged against the target Group and the live actor (PT400 event_min_level_below_group / event_min_level_above_actor), and a cancelled Event is PT409 event_cancelled. The Campaign (#691, ADR-0008 amended 2026-09-23) must be owned by the Event''s Group -- the new one, on a move -- or a Group above it, and a newly attached one must be active (events_validate_campaign); anything else is PT400 invalid_campaign, and a Campaign deactivated after it was attached is kept when sent back unchanged. R53 (2026-10-14): every content change -- title, description, type, schedule (an all-day switch included), location, capacity, Group, Minimum Level -- notifies, in one notice per edit that names what changed and carries the current schedule (for an all-day Event its days and "toată ziua", no hour) and place, the current going attendees and the new Group''s Group Audience as Notifications reach it (private.group_notification_audience: #601, minus every live BC member and Moderator, #929, plus the BC members whose Group position reaches it, R42), plus the old Group''s when the Event moved, every recipient filtered through private.can_read_event at the new Minimum Level, link /calendar?event=<id>: private.notify_event tells whoever knows the Event "Eveniment actualizat" (event:<id>:changed) and whoever does not "Eveniment nou"; a Campaign alone notifies nobody. #934: the source-authority rule is private.can_manage_event, the one definition event_attendance_read also reads; the command holds the roster rows it rests on FOR SHARE and asks it again. Spec 2026-10-11 (final review of 2026-10-13): a pending or rejected OSUBB-wide Event moved off the Organization Group is published by the move (private.stamp_approval) -- its new Group hears "Eveniment nou" through private.notify_event_created and no change notice is sent; the old Group''s audience is told of a move only when the Event had been approved and stays approved (#1130, audit M7 of 2026-10-30: a move by a Manager below BC onto the Organization Group makes it pending again, tells the old audience nothing of an Event events_read now hides from them, and leaves them to approve_event, which tells them with the rest of the organisation).';
