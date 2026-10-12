-- The final review of the OSUBB-wide approval (spec 2026-10-11, ruling R49;
-- review of 2026-10-13). Five findings, each with its test in approvals.test.sql
-- section 10:
--   I1  a cancelled pending Event is no request and cannot be decided; an
--       Event approved after it started gets no Announcement (its Termen
--       would be in the past), only the "Eveniment nou" notice;
--   I2  a pending or rejected Event moved off the Organization Group needs no
--       approval any more: the stamp publishes it and update_event gives its
--       new Group the creation notice, the old audience nothing;
--   I5  the decision commands hold the decider's Profile FOR SHARE after the
--       target row (docs/backend/conventions.md §1);
--   M3  PT409 not_pending becomes announcement_not_pending / event_not_pending
--       (the <subject>_<state> vocabulary);
--   M4  only the author's edit re-enters review; M7 the decision flag covers
--       no insert.

-- ==================== 1. the stamp ====================
create or replace function private.stamp_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_level integer;
  v_org boolean;
  v_skip constant text[] := array['approval_status', 'approval_decided_by', 'approval_decided_at', 'rejection_reason',
                                  'updated_at', 'pinned', 'cancelled_at', 'cancel_reason', 'announce_on_approval'];
  v_changed boolean;
begin
  -- The decision commands write the approval columns themselves -- on an
  -- update only: an insert is always judged (M7).
  if tg_op = 'UPDATE' and coalesce(current_setting('osubb.deciding_approval', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- A client value is ignored: the stamp decides.
    new.approval_status := 'approved';
    new.approval_decided_by := null;
    new.approval_decided_at := null;
    new.rejection_reason := null;
    if v_actor is null then
      return new;  -- migrations, seed, jobs: published
    end if;
    -- A Deal (R45) is the OSUBB Deals team's own publication, never a request.
    if tg_table_name = 'announcements' and (to_jsonb(new) ->> 'kind') = 'deal' then
      return new;
    end if;
    select grp.is_organization into v_org from public.groups as grp where grp.id = new.group_id;
    -- OSUBB-wide: the Organization Group, or an Announcement whose Audience is
    -- the whole organisation from any Group (security review of 2026-10-11).
    v_org := coalesce(v_org, false)
             or (tg_table_name = 'announcements' and (to_jsonb(new) ->> 'audience') = 'org');
    v_level := coalesce(private.actor_level(v_actor), 0);
    if v_org and v_level < 6 then
      new.approval_status := 'pending';
    end if;
    return new;
  end if;
  -- UPDATE: the approval columns are kept; an author's content edit of a
  -- decided OSUBB-wide row re-enters review.
  new.approval_status := old.approval_status;
  new.approval_decided_by := old.approval_decided_by;
  new.approval_decided_at := old.approval_decided_at;
  new.rejection_reason := old.rejection_reason;
  if v_actor is null then
    return new;
  end if;
  if tg_table_name = 'announcements' and (to_jsonb(new) ->> 'kind') = 'deal' then
    return new;
  end if;
  select grp.is_organization into v_org from public.groups as grp where grp.id = new.group_id;
  v_org := coalesce(v_org, false)
           or (tg_table_name = 'announcements' and (to_jsonb(new) ->> 'audience') = 'org');
  if not v_org then
    -- No longer OSUBB-wide -- moved to a local Group, or the Audience narrowed:
    -- there is nothing to approve, so a pending or rejected row is published
    -- by the change itself (I2). An Announcement it asked for is not written:
    -- a local Event's Announcement is its author's to post.
    if old.approval_status <> 'approved' then
      new.approval_status := 'approved';
      new.approval_decided_by := null;
      new.approval_decided_at := null;
      new.rejection_reason := null;
      if tg_table_name = 'events' then
        new.announce_on_approval := false;
      end if;
    end if;
    return new;
  end if;
  v_level := coalesce(private.actor_level(v_actor), 0);
  if v_level >= 6 then
    return new;
  end if;
  v_changed := (to_jsonb(new) - v_skip) is distinct from (to_jsonb(old) - v_skip);
  -- Only the author's own edit asks again (spec: "an edit by its author"):
  -- another writer below BC who reaches the row -- a Campaign manager whose
  -- deletion clears campaign_id -- changes no decision (M4).
  if v_changed and old.approval_status in ('approved', 'rejected') and new.created_by = v_actor then
    new.approval_status := 'pending';
    new.approval_decided_by := null;
    new.approval_decided_at := null;
    new.rejection_reason := null;
  end if;
  return new;
end;
$$;
comment on function private.stamp_approval() is
  'announcements_stamp_approval / events_stamp_approval (before insert or update; spec 2026-10-11): on insert the status is pending for a row on the Organization Group -- or an Announcement with the organisation Audience from any Group -- by a signed-in writer below level 6 and approved otherwise (a client value is ignored; a write with no auth.uid() publishes); on update the approval columns are kept, except that the author (created_by = auth.uid()) below level 6 changing the content of a decided OSUBB-wide row (anything but the approval columns, updated_at, pinned, cancelled_at, cancel_reason and announce_on_approval) sends it back to pending with the decision cleared, and that a pending or rejected row which stops being OSUBB-wide (moved to a local Group, or its Audience narrowed) is published by that change, its announce_on_approval dropped (final review of 2026-10-13). A Deal (kind deal, R45) is never pending: the OSUBB Deals team publishes it at once. The decision commands set osubb.deciding_approval = on for their own update; an insert is always judged.';

-- ==================== 2. the decider, held while the decision commits ====================
create function private.require_approval_decider_locked(p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Conventions §1: after the target row, the actor's Profile FOR SHARE, so a
  -- demotion or deactivation committed meanwhile is seen (I5).
  perform 1 from public.profiles as profile
    where profile.id = p_actor and profile.status = 'activ'
    for share of profile;
  if not found or coalesce(private.actor_level(p_actor), 0) < 6 then
    raise exception using errcode = '42501', message = 'approval_forbidden';
  end if;
end;
$$;
comment on function private.require_approval_decider_locked(uuid) is
  'The decider of an approval held FOR SHARE (docs/backend/conventions.md §1; final review of 2026-10-13): called by the four decision commands after their target row is locked, it re-reads the actor''s live activ Profile under a share lock and their level, else 42501 approval_forbidden. Internal: executable by no client role.';
revoke execute on function private.require_approval_decider_locked(uuid) from public, anon, authenticated, service_role;

-- ==================== 3. the decisions ====================
create or replace function private.approve_announcement_impl(p_id bigint)
returns public.announcements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_row public.announcements%rowtype;
  v_decider text;
begin
  v_actor := private.approval_decider();
  select * into v_row from public.announcements where id = p_id for no key update;
  if not found then
    raise sqlstate 'PT404' using message = 'announcement_not_found';
  end if;
  perform private.require_approval_decider_locked(v_actor);
  if v_row.approval_status <> 'pending' then
    raise sqlstate 'PT409' using message = 'announcement_not_pending';
  end if;
  perform set_config('osubb.deciding_approval', 'on', true);
  update public.announcements
     set approval_status = 'approved', approval_decided_by = v_actor, approval_decided_at = now(), rejection_reason = null
   where id = p_id
   returning * into v_row;
  perform set_config('osubb.deciding_approval', 'off', true);
  -- The notice the Announcement would have given when written: once, now,
  -- never to its author.
  perform private.fan_out_announcement_row(v_row, v_row.created_by);
  select profile.full_name into v_decider from public.profiles as profile where profile.id = v_actor;
  perform private.notify(array[v_row.created_by], 'announce', 'Anunțul tău a fost aprobat: ' || v_row.title,
    'Publicat de ' || coalesce(v_decider, 'BC') || '.', null,
    'approval:announcements:' || p_id::text || ':approved', v_actor, '/anunturi?anunt=' || p_id::text);
  return v_row;
end;
$$;
comment on function private.approve_announcement_impl(bigint) is
  'Body of public.approve_announcement (spec 2026-10-11): a BC member or the Moderator (private.approval_decider, then held FOR SHARE by private.require_approval_decider_locked after the row lock) publishes a pending Announcement -- approved, with the decider and the time -- then its fan-out runs once as if it had just been written (never to its author) and the author is told. PT404 announcement_not_found; PT409 announcement_not_pending for an Announcement already decided.';

create or replace function private.reject_announcement_impl(p_id bigint, p_reason text)
returns public.announcements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_row public.announcements%rowtype;
  v_reason text;
begin
  v_reason := private.require_rejection_reason(p_reason);
  v_actor := private.approval_decider();
  select * into v_row from public.announcements where id = p_id for no key update;
  if not found then
    raise sqlstate 'PT404' using message = 'announcement_not_found';
  end if;
  perform private.require_approval_decider_locked(v_actor);
  if v_row.approval_status <> 'pending' then
    raise sqlstate 'PT409' using message = 'announcement_not_pending';
  end if;
  perform set_config('osubb.deciding_approval', 'on', true);
  update public.announcements
     set approval_status = 'rejected', approval_decided_by = v_actor, approval_decided_at = now(), rejection_reason = v_reason
   where id = p_id
   returning * into v_row;
  perform set_config('osubb.deciding_approval', 'off', true);
  perform private.notify(array[v_row.created_by], 'announce', 'Anunțul tău a fost respins: ' || v_row.title,
    v_reason, null, 'approval:announcements:' || p_id::text || ':rejected', v_actor, '/anunturi?anunt=' || p_id::text);
  return v_row;
end;
$$;
comment on function private.reject_announcement_impl(bigint, text) is
  'Body of public.reject_announcement (spec 2026-10-11): the reason first (private.require_rejection_reason), then the gate (private.approval_decider; the decider held FOR SHARE after the row lock); a pending Announcement becomes rejected with the reason, which its author reads in their Notification and on the item; the author''s next edit asks again. PT404 announcement_not_found; PT409 announcement_not_pending.';

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
    insert into public.announcements(title, body, group_id, audience, min_level, deadline, created_by)
      values (v_row.title,
              private.event_announcement_body(v_row.starts_at, v_row.ends_at, v_row.location, v_row.description),
              v_row.group_id,
              case when v_group.is_organization then 'org' else 'local' end,
              v_row.min_level,
              v_row.starts_at,
              v_row.created_by);
    perform set_config('osubb.announcement_author', '', true);
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
comment on function private.approve_event_impl(bigint) is
  'Body of public.approve_event (spec 2026-10-11): a BC member or the Moderator (private.approval_decider; held FOR SHARE after the row lock) publishes a pending Event -- approved, with the decider and the time -- then, if the Event asked for its Announcement (announce_on_approval) and has not started yet, writes that Announcement as the Event''s author (osubb.announcement_author; its own fan-out is the notice), else gives the "Eveniment nou" notice once (never to the author); the author is told. PT404 event_not_found; PT409 event_cancelled for a cancelled Event, whatever its status; PT409 event_not_pending.';

create or replace function private.reject_event_impl(p_id bigint, p_reason text)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_row public.events%rowtype;
  v_reason text;
begin
  v_reason := private.require_rejection_reason(p_reason);
  v_actor := private.approval_decider();
  select * into v_row from public.events where id = p_id for no key update;
  if not found then
    raise sqlstate 'PT404' using message = 'event_not_found';
  end if;
  perform private.require_approval_decider_locked(v_actor);
  if v_row.cancelled_at is not null then
    raise sqlstate 'PT409' using message = 'event_cancelled';
  end if;
  if v_row.approval_status <> 'pending' then
    raise sqlstate 'PT409' using message = 'event_not_pending';
  end if;
  perform set_config('osubb.deciding_approval', 'on', true);
  update public.events
     set approval_status = 'rejected', approval_decided_by = v_actor, approval_decided_at = now(), rejection_reason = v_reason
   where id = p_id
   returning * into v_row;
  perform set_config('osubb.deciding_approval', 'off', true);
  perform private.notify(array[v_row.created_by], 'event', 'Evenimentul tău a fost respins: ' || v_row.title,
    v_reason, null, 'approval:events:' || p_id::text || ':rejected', v_actor, '/calendar?event=' || p_id::text);
  return v_row;
end;
$$;
comment on function private.reject_event_impl(bigint, text) is
  'Body of public.reject_event (spec 2026-10-11): the reason first, then the gate (the decider held FOR SHARE after the row lock); a pending Event becomes rejected with the reason its author reads; the author''s next edit asks again. PT404 event_not_found; PT409 event_cancelled; PT409 event_not_pending.';

-- ==================== 4. the requests read: a cancelled Event is none ====================
create or replace function public.approval_requests()
returns table (kind text, id bigint, title text, group_id bigint, created_by uuid, created_at timestamptz, starts_at timestamptz)
language sql
stable
set search_path = ''
as $$
  -- Invoker: the two read policies already show BC the pending rows; the gate
  -- keeps the list empty for everyone else.
  select pending.kind, pending.id, pending.title, pending.group_id, pending.created_by, pending.created_at, pending.starts_at
    from (select 'announcement'::text as kind, a.id, a.title, a.group_id, a.created_by, a.published_at as created_at, null::timestamptz as starts_at
            from public.announcements as a
           where a.approval_status = 'pending' and a.kind = 'announcement'
          union all
          select 'event', e.id, e.title, e.group_id, e.created_by, e.created_at, e.starts_at
            from public.events as e
           where e.approval_status = 'pending' and e.cancelled_at is null) as pending
   where coalesce((select private.caller_level()), 0) >= 6
   order by pending.created_at desc, pending.id desc;
$$;
comment on function public.approval_requests() is
  'The Cereri de aprobare (spec 2026-10-11): the pending OSUBB-wide Announcements and Events, newest first, for a BC member or the Moderator -- the counts behind the request icons in Calendar and Anunțuri and the rows of their sheet. A cancelled Event is no request (final review of 2026-10-13). Empty for everyone else. Invoker: the read policies decide what it sees.';

-- ==================== 5. update_event: a move off the Organization Group publishes ====================
-- Re-stated from 20260929220000_event_rsvp_managers.sql with two changes (I2): the
-- old Group's audience is told of a move only when it had been told of the
-- Event, and an Event the move publishes gets the creation notice instead of
-- the change notices.
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

do $$
declare
  v_old text;
begin
  v_old := obj_description('private.update_event_impl(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint)'::regprocedure, 'pg_proc');
  execute format('comment on function private.update_event_impl(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint) is %L',
    v_old || ' Spec 2026-10-11 (final review of 2026-10-13): a pending or rejected OSUBB-wide Event moved off the Organization Group is published by the move (private.stamp_approval) -- its new Group hears "Eveniment nou" through private.notify_event_created and no change notice is sent; the old Group''s audience is told of a move only when the Event had been approved.');
end $$;
