-- #934: an Event's RSVPs are read by the people who manage it, and by nobody
-- else beyond each Member's own answer.
--
-- Alex, 2026-09-29: "yes, for each moderator of that event" -- the Event's
-- managers, not a rank. Until now event_attendance_read let any live BCE and
-- above (level >= 5) read every Member's RSVP on every Event they could see,
-- and no screen showed them. The managers are exactly the people who may edit
-- or cancel the Event (#849): BC and the Moderator; the Group Managers and
-- Group Responsibles of its Group or of a Group above it while it is active;
-- and, for an Organization Group Event, its creator.
--
-- 1. private.can_manage_event(p_event_id): that rule, once. It was written out
--    twice, inline in update_event_impl and cancel_event_impl; both now call
--    it, and so does the RSVP read, so the three cannot drift apart. It says
--    WHO manages an Event, never WHAT state it is in: a cancelled Event is
--    still managed by the same people (they read its preserved RSVP history,
--    ADR-0008), and the commands keep their own PT409 event_cancelled.
--    Visibility is part of it (private.can_read_event), because a command
--    answers PT404 before it asks about authority -- a manager is always
--    someone who can read the Event.
-- 2. private.update_event_impl and private.cancel_event_impl: rebuilt from
--    main's latest bodies (20260929200000_group_member_set.sql and
--    20260924132724_private_groups.sql). Only the source-authority step
--    changes: it asks the predicate, holds the roster rows the answer rests on
--    FOR SHARE, and asks again -- require_group_work_manager's discipline, so
--    a Group Role removed concurrently serializes behind the decision. BC, the
--    Moderator and an Organization Event's creator rest on the Profile row the
--    command already holds FOR SHARE. The move rule (the TARGET Group of an
--    update) is unchanged.
-- 3. event_attendance_read: the Member's own row, or any row of an Event the
--    caller manages. The level >= 5 limb is gone. The self-write policies are
--    untouched (#936 drops them later).

-- ==================== 1. The predicate ====================

create function private.can_manage_event(p_event_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and exists (
       select 1
         from public.events as event
         join public.groups as grp on grp.id = event.group_id
        where event.id = p_event_id
          and private.can_read_event(event.group_id, event.min_level, (select auth.uid()))
          and case
                -- #582: the Organization is the Group carrying the marker. Its
                -- Events belong to their creator, or to BC/Moderator.
                when grp.is_organization then
                  event.created_by = (select auth.uid())
                  or coalesce(private.actor_level(), -1) >= 6
                -- Every other Group: BC/Moderator, or a Group Manager/Responsible
                -- on the path of an active Group.
                else coalesce(private.can_manage_group_work(event.group_id), false)
              end
     );
$$;

comment on function private.can_manage_event(bigint) is
  'Whether the caller manages this Event (#934): exactly the people update_event and cancel_event accept (ADR-0008 amended by ADR-0009, #849). The caller must have organization claims (auth_is_member) and read the Event (private.can_read_event, the events_read rule, so it also requires a live activ Profile). An Organization Group Event (groups.is_organization) is managed by its creator and by BC/Moderator (live level >= 6); every other Event through private.can_manage_group_work -- BC/Moderator everywhere, a Group Manager or Group Responsible of the Group or of a Group above it while the Group is active. It judges who, never the Event''s state: a cancelled Event keeps its managers, who still read its RSVP history. One definition, three readers: the source-authority step of private.update_event_impl and private.cancel_event_impl, and the event_attendance_read policy. Policy predicate: authenticated may execute it; false for a missing Event.';

revoke execute on function private.can_manage_event(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.can_manage_event(bigint) to authenticated;

-- ==================== 2. update_event: the source authority through the predicate ====================

CREATE OR REPLACE FUNCTION private.update_event_impl(p_event_id bigint, p_title text, p_type text, p_group_id bigint, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_location text, p_capacity integer, p_description text, p_min_level integer, p_campaign_id bigint)
 RETURNS public.events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_level integer;
  v_event public.events%rowtype;
  v_updated public.events%rowtype;
  v_target public.groups%rowtype;
  v_recipients uuid[];
  v_old_members uuid[];
  v_field text;
  v_body text;
  v_constraint text;
begin
  -- 1. Malformed input, judged for everyone before the gate.
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_event_title';
  end if;
  -- #673 (R8): measured as stored (btrim).
  perform private.require_text_length('title', btrim(p_title), 3, 120);
  perform private.require_text_length('description', btrim(p_description), null, 2000);
  -- Security pass 2026-09-27 (L1): events_location_length_ck, measured as stored.
  perform private.require_text_length('location', btrim(p_location), null, 200);
  if p_type is null or p_type not in ('sedinta', 'activitate', 'call', 'eveniment', 'deadline', 'recrutare') then
    raise sqlstate 'PT400' using message = 'invalid_event_type';
  end if;
  if p_starts_at is null or (p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise sqlstate 'PT400' using message = 'invalid_event_interval';
  end if;
  -- #673 (R8): capacity 1-1000 (events_capacity_range_ck).
  if p_capacity is not null and (p_capacity <= 0 or p_capacity > 1000) then
    raise sqlstate 'PT400' using message = 'invalid_event_capacity';
  end if;
  if p_min_level is null or p_min_level not in (0, 3, 5, 6) then
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
  select array_agg(member_id) into v_old_members
    from private.group_notification_audience(v_event.group_id) as member_id
   where private.can_read_event(p_group_id, p_min_level, member_id);
  -- #691: the Campaign is judged by events_validate_campaign against the Event's
  -- (possibly new) Group; a move carrying a Campaign off the new path, an unknown
  -- id or a newly attached inactive Campaign is PT400 invalid_campaign.
  begin
    update public.events set title = btrim(p_title), type = p_type::public.event_type,
      group_id = p_group_id, starts_at = p_starts_at, ends_at = p_ends_at,
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
  if v_event.group_id is distinct from v_updated.group_id then
    v_recipients := coalesce(v_recipients, '{}'::uuid[]) || coalesce(v_old_members, '{}'::uuid[]);
  end if;
  -- #691: a Campaign is a label, not an important change -- it is deliberately
  -- absent from this list, so a Campaign-only edit notifies nobody.
  foreach v_field in array array[
    case when v_event.starts_at is distinct from v_updated.starts_at or v_event.ends_at is distinct from v_updated.ends_at then 'schedule' end,
    case when v_event.location is distinct from v_updated.location then 'location' end,
    case when v_event.group_id is distinct from v_updated.group_id then 'group' end,
    case when v_event.min_level is distinct from v_updated.min_level then 'min_level' end
  ] loop
    if v_field is not null then
      v_body := case v_field
        when 'schedule' then 'Noua programare: '
          || to_char(v_updated.starts_at at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI')
          || coalesce(' - ' || to_char(v_updated.ends_at at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI'), '')
        when 'location' then 'Noua locație: ' || coalesce(v_updated.location, 'nespecificată')
        when 'group' then 'Noul grup: ' || v_target.name
        when 'min_level' then 'Noul nivel minim: ' || v_updated.min_level::text
      end;
      perform private.notify(v_recipients, 'event', 'Eveniment actualizat: ' || v_updated.title, v_body,
        null, 'event:' || p_event_id::text || ':' || v_field, v_actor, '/calendar?event=' || p_event_id::text);
    end if;
  end loop;
  return v_updated;
end;
$function$;

-- ==================== 3. cancel_event: the same rule ====================

CREATE OR REPLACE FUNCTION private.cancel_event_impl(p_event_id bigint, p_reason text)
 RETURNS public.events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_event public.events%rowtype;
begin
  if p_reason is null or p_reason !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'reason_required';
  end if;
  -- #673 (R8): measured as stored (cancel_event_effect btrims it).
  perform private.require_text_length('reason', btrim(p_reason), null, 1000);
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end;
  -- Lock the Event before inspecting its state; concurrent edits and cancellation serialize.
  select * into v_event from public.events where id = p_event_id for no key update;
  if not found or coalesce(private.actor_level(v_actor), -1) < v_event.min_level then
    raise sqlstate 'PT404' using message = 'event_not_found';
  end if;
  perform 1 from public.profiles where id = v_actor and status = 'activ' for share;
  if not found then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  -- #756: the events_read rule itself, so an Event of a Private Group is
  -- missing for an outsider rather than forbidden (update_event agrees).
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
  if v_event.cancelled_at is not null then
    raise sqlstate 'PT409' using message = 'event_cancelled';
  end if;

  -- Every gate above is this command's; the write and the fan-out are the
  -- shared effect (#582, section 4b), which archive_group calls with the
  -- Group's authority instead of an actor's.
  return private.cancel_event_effect(p_event_id, p_reason, v_actor);
end;
$function$;


-- ==================== 4. event_attendance_read: managers, not a rank ====================

alter policy event_attendance_read on public.event_attendance
  using (
    public.auth_is_member()
    and exists (select 1 from public.events e where e.id = event_attendance.event_id)
    and (
      member_id = (select auth.uid())
      or private.can_manage_event(event_attendance.event_id)
    )
  );

comment on policy event_attendance_read on public.event_attendance is
  'A Member reads their own RSVP on an Event they can see; the Event''s managers (private.can_manage_event: its Organization Event creator, BC/Moderator, and the Group Managers and Responsibles of its Group or a Group above it) read every RSVP on it (#934). No rank reads other Members'' answers by itself: the former level >= 5 limb is gone. Claimless sessions read nothing (auth_is_member).';

-- ==================== 5. The command comments name the shared rule ====================

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'private.update_event_impl(bigint,text,text,bigint,timestamptz,timestamptz,text,integer,text,integer,bigint)',
    'private.cancel_event_impl(bigint,text)'
  ] loop
    if obj_description(v_fn::regprocedure, 'pg_proc') is null then
      raise exception 'comment on % is missing', v_fn;
    end if;
    execute format('comment on function %s is %L', v_fn,
      obj_description(v_fn::regprocedure, 'pg_proc')
      || ' #934: the source-authority rule is private.can_manage_event, the one definition event_attendance_read also reads; the command holds the roster rows it rests on FOR SHARE and asks it again.');
  end loop;
end;
$$;
