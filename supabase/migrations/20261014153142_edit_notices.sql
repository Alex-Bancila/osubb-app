-- #1061: every content change of an Announcement or an Event tells the people its first notice told (ruling R53).
--
-- Alex, 2026-10-14, from four questions: every content change of an
-- Announcement, an Event or a Task notifies the same people as the original
-- notice; a label-only change (a Campaign, a pin) notifies nobody. Spec
-- docs/superpowers/specs/2026-10-14-edit-notices-and-reminders-design.md.
--
-- Before this: an edited Announcement told nobody; an edited Event told its
-- audience only of a new schedule, place, Group or Minimum Level, in one
-- notice per field; and BC's approval of an edit that had to be approved
-- again announced the Announcement or Event as new. A Task's Executor already
-- heard of every change, the Campaign included.
--
-- "New" or "changed" is judged per Member, from what they already did with
-- the item: hold a notice about it (private.told_of), open the Announcement,
-- answer the Event. Whoever knows it hears that it changed. Whoever does not
-- (a moved Event's new audience, a Member newly at an Announcement's lowered
-- Minimum Level, the whole organisation once an Event moved onto OSUBB is
-- approved) hears that it is new.
--
-- An Announcement's Group and Audience cannot change once it is posted
-- (guard_announcement_origin), so an edit never publishes an Announcement
-- request; an Event moved off the Organization Group still is, and its new
-- audience still hears of it (private.notify_event_created).

-- 1. Who already holds a notice about an item: one with its key, or a key
--    below it ("event:<id>:created", "event:<id>:changed", ...).
create function private.told_of(p_members uuid[], p_key text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct notification.member_id), '{}'::uuid[])
    from public.notifications as notification
   where notification.member_id = any (p_members)
     and (notification.dedupe_key = p_key
          or notification.dedupe_key like p_key || ':%');
$$;
revoke execute on function private.told_of(uuid[], text) from public, anon, authenticated, service_role;
comment on function private.told_of(uuid[], text) is
  'R53: the Members of p_members who already hold a Notification keyed p_key or below it (p_key || '':...''), read or not -- who was told of an Announcement or an Event, so a later notice says it changed rather than that it is new. Granted to nobody.';

-- 2. Announcements: one audience for every notice, and one notifier that
--    tells each recipient "new" or "changed".
create function private.announcement_recipients(p_row public.announcements)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_audience_group bigint;
  v_recipients uuid[];
  v_critical boolean := p_row.priority = 'critical';
begin
  if p_row.audience = 'org' then
    select id into v_audience_group from public.groups where is_organization;
  else
    v_audience_group := p_row.group_id;
  end if;

  -- #929 (R32): never a BC member or the Moderator through membership; R42: a BC
  -- member whose position reaches the audience Group or, for an organization-wide
  -- Announcement, its Origin -- it is still that Group's Announcement. R43: a
  -- Member who unselected the audience Group is left out (the Organization Group
  -- is locked, so an organization-wide Announcement reaches them), unless the
  -- Announcement is critical. R45: a Deal is organization-wide, so it follows
  -- exactly that rule.
  select array_agg(recipient.member_id order by recipient.member_id)
    into v_recipients
    from (select audience.member_id
            from private.group_notification_audience(v_audience_group) as audience(member_id)
           where not v_critical
          union
          select audience.member_id
            from private.group_notification_audience_unmuted(v_audience_group) as audience(member_id)
           where v_critical
          union
          select holder.member_id
            from private.board_position_holders(p_row.group_id) as holder(member_id)) as recipient
    join public.profiles as profile on profile.id = recipient.member_id
   where not exists (
     select 1 from public.notif_suppression as suppression
      where suppression.role = profile.role and suppression.kind = 'announce'
   )
     -- #756: an organization-wide Announcement of a Private Group reaches
     -- only those who can see the Group (announcements_read agrees).
     and private.can_see_group(p_row.group_id, recipient.member_id)
     -- #909: no Notification to a Member below the Minimum Level, who cannot
     -- read the Announcement (announcements_read agrees).
     and coalesce(private.actor_level(recipient.member_id), -1) >= p_row.min_level;
  return v_recipients;
end;
$$;
revoke execute on function private.announcement_recipients(public.announcements) from public, anon, authenticated, service_role;
comment on function private.announcement_recipients(public.announcements) is
  'R53: everyone a notice about this Announcement reaches -- the fan-out''s audience rule (R32, R42, R43, R45, #756, #909, suppression), moved here verbatim and shared by the first notice, an edit notice and the Termen reminder. Granted to nobody.';

create function private.notify_announcement(p_row public.announcements, p_actor uuid, p_changed text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipients uuid[] := coalesce(private.announcement_recipients(p_row), '{}'::uuid[]);
  v_key text := 'announcement:' || p_row.id::text;
  v_told uuid[];
  v_deal boolean := p_row.kind = 'deal';
  v_link text := case when p_row.kind = 'deal' then '/anunturi/deals?deal=' else '/anunturi?anunt=' end
                 || p_row.id::text;
begin
  -- Whoever holds a notice about it, or opened it, knows it.
  v_told := private.told_of(v_recipients, v_key)
            || array(select reading.member_id from public.announcement_reads as reading
                      where reading.announcement_id = p_row.id and reading.member_id = any (v_recipients));
  -- #635: a critical Announcement's Notification is critical, so it still
  -- pushes to a Member who muted 'announce'. #861 (Audit D-20): keyed
  -- announcement:<id>, so reading the Announcement finds and clears it -- and
  -- an unread notice is refreshed in place rather than doubled. R45: a Deal
  -- says so and opens on the OSUBB Deals tab.
  perform private.notify(
    array(select member from unnest(v_recipients) as member where member <> all (v_told)),
    'announce', case when v_deal then 'Deal nou: ' else 'Anunț nou: ' end || p_row.title,
    p_row.body, null, v_key, p_actor, v_link, p_row.priority = 'critical');
  perform private.notify(v_told, 'announce',
    case when v_deal then 'Deal actualizat: ' else 'Anunț actualizat: ' end || p_row.title,
    coalesce(p_changed, p_row.body), null, v_key, p_actor, v_link, p_row.priority = 'critical');
end;
$$;
revoke execute on function private.notify_announcement(public.announcements, uuid, text) from public, anon, authenticated, service_role;
comment on function private.notify_announcement(public.announcements, uuid, text) is
  'R53: tells private.announcement_recipients of the Announcement, never p_actor -- "Anunț nou" ("Deal nou") with its text to whoever does not know it, "Anunț actualizat" ("Deal actualizat") to whoever does -- holds a notice about it (private.told_of) or opened it, with p_changed or, for an approval, its text. Keyed announcement:<id>. Granted to nobody.';

-- The fan-out, restated from 20261011140000_org_wide_approval.sql: the notice
-- is now private.notify_announcement's, so BC's approval of an Announcement
-- its audience knew before an edit sent it back says it changed.
create or replace function private.fan_out_announcement_row(p_row public.announcements, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify_announcement(p_row, p_actor, null);

  -- #861 (Audit D-12): the author has read what they wrote. The
  -- announcements_read rule (private.can_read_announcement), judged for the
  -- author instead of the caller: a live Member who can see the Group and,
  -- for a local Audience, one in its Group Audience or holding a Manager /
  -- Responsible position on its path. A global writer who posts outside
  -- their own audience gets no row, as they could not write one themselves.
  if p_row.created_by is not null
     and private.actor_level(p_row.created_by) is not null
     and private.can_see_group(p_row.group_id, p_row.created_by)
     and (p_row.audience = 'org'
          or (p_row.audience = 'local' and (
              p_row.created_by in (select private.group_audience(p_row.group_id))
              or private.group_role_of(p_row.group_id, p_row.created_by) in ('manager', 'responsible')))) then
    insert into public.announcement_reads (announcement_id, member_id)
    values (p_row.id, p_row.created_by)
    on conflict do nothing;
  end if;
end;
$$;

-- 3. An edit of a published Announcement tells its audience what changed.
create function private.notify_announcement_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_fields text[];
begin
  -- A write with nobody signed in (a migration, a job) tells nobody; an edit
  -- of a row that was not published -- the decision commands only touch
  -- pending rows -- tells nobody; and an edit that sends the Announcement
  -- back to BC tells nobody until BC approves it.
  if v_actor is null
     or old.approval_status <> 'approved'
     or new.approval_status <> 'approved' then
    return new;
  end if;
  -- Content only: a pin is a label, and the Group and Audience never change.
  v_fields := array_remove(array[
    case when new.title is distinct from old.title then 'titlu' end,
    case when new.body is distinct from old.body then 'text' end,
    case when new.priority is distinct from old.priority then 'prioritate' end,
    case when new.deadline is distinct from old.deadline then 'termen' end,
    case when new.min_level is distinct from old.min_level then 'nivel minim' end,
    case when new.links is distinct from old.links then 'linkuri' end,
    case when new.form_label is distinct from old.form_label
           or new.form_url is distinct from old.form_url then 'formular' end,
    case when new.code is distinct from old.code then 'cod' end
  ], null);
  if cardinality(v_fields) = 0 then
    return new;
  end if;
  -- The current Termen is always carried, so a later edit that refreshes an
  -- unread notice never hides that it moved.
  perform private.notify_announcement(new, v_actor,
    'Modificat: ' || array_to_string(v_fields, ', ') || '.'
    || coalesce(' Termen: ' || to_char(new.deadline at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI') || '.', ''));
  return new;
end;
$$;
revoke execute on function private.notify_announcement_change() from public, anon, authenticated, service_role;
comment on function private.notify_announcement_change() is
  'R53: after a signed-in writer changes the content of a published Announcement, private.notify_announcement tells its audience what changed. Nothing for a pin, a system write, an unpublished row, or an edit that sends it back to BC. The notice names what changed and carries the current Termen. Granted to nobody.';
create trigger announcements_notify_change
  after update on public.announcements
  for each row execute function private.notify_announcement_change();

-- 4. Events: one notifier that tells each recipient "new" or "changed".
create function private.notify_event(p_event public.events, p_actor uuid, p_members uuid[], p_changed text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_members uuid[] := coalesce(p_members, '{}'::uuid[]);
  v_told uuid[];
  v_link text := '/calendar?event=' || p_event.id::text;
  v_schedule text := private.event_announcement_body(p_event.starts_at, p_event.ends_at, p_event.location, null);
begin
  -- Whoever holds a notice about it, or answered it (Particip or not), knows it.
  v_told := private.told_of(v_members, 'event:' || p_event.id::text)
            || array(select attendance.member_id from public.event_attendance as attendance
                      where attendance.event_id = p_event.id and attendance.member_id = any (v_members));
  perform private.notify(
    array(select member from unnest(v_members) as member where member <> all (v_told)),
    'event', 'Eveniment nou: ' || p_event.title, v_schedule,
    null, 'event:' || p_event.id::text || ':created', p_actor, v_link);
  perform private.notify(v_told, 'event', 'Eveniment actualizat: ' || p_event.title,
    coalesce(p_changed, v_schedule),
    null, 'event:' || p_event.id::text || ':changed', p_actor, v_link);
end;
$$;
revoke execute on function private.notify_event(public.events, uuid, uuid[], text) from public, anon, authenticated, service_role;
comment on function private.notify_event(public.events, uuid, uuid[], text) is
  'R53: tells p_members of the Event, never p_actor -- "Eveniment nou" (event:<id>:created) to whoever does not know it, "Eveniment actualizat" (event:<id>:changed, refreshed while unread) to whoever does -- holds a notice about it (private.told_of) or answered it, with p_changed or, for an approval, its schedule. Granted to nobody.';

-- Restated from 20261011140000_org_wide_approval.sql: the recipients are
-- unchanged; who hears "new" and who "changed" is private.notify_event's.
create or replace function private.notify_event_created(p_event public.events, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipients uuid[];
begin
  select array_agg(recipient) into v_recipients
    from private.event_notification_recipients(p_event.id) as recipient;
  perform private.notify_event(p_event, p_actor, v_recipients, null);
end;
$$;

-- 5. update_event (restated from 20261013090000_org_wide_approval_review.sql)
--    and update_task (from 20261007190000_attached_links_five.sql), each with
--    its R53 change marked.
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
           or v_event.ends_at is distinct from v_updated.ends_at then 'programare' end,
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
        || to_char(v_updated.starts_at at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI')
        || coalesce(' - ' || to_char(v_updated.ends_at at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI'), ''),
      'Locație: ' || v_updated.location,
      case when v_event.group_id is distinct from v_updated.group_id then 'Grup: ' || v_target.name end,
      case when v_event.min_level is distinct from v_updated.min_level
        then 'Nivel minim: ' || v_updated.min_level::text end
    ], null);
    perform private.notify_event(v_updated, v_actor, v_recipients, array_to_string(v_parts, '. '));
  end if;
  return v_updated;
end;
$function$;

CREATE OR REPLACE FUNCTION private.update_task_impl(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text, p_link_url text, p_accept_consequences boolean, p_links jsonb)
 RETURNS public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_parent_id bigint;
  v_task public.tasks%rowtype;
  v_plan jsonb;
  v_links jsonb;
  v_consequences jsonb;
  v_removed_candidates uuid[];
  v_removed_executor uuid;
  v_added_executor uuid;
  v_campaign_id bigint;
  v_closed uuid[] := '{}'::uuid[];
  v_assignment_id bigint;
  v_executor uuid;
  v_mode_changed boolean;
  v_group_changed boolean;
  v_from public.task_status;
  v_to public.task_status;
  v_details jsonb;
  v_constraint text;
begin
  -- 1. #673 (R8): malformed for every caller, measured as stored (trimmed).
  --    No deadline_in_past here: R8 judges the deadline only at creation.
  perform private.require_text_length('title',
    regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g'), 3, 120);
  perform private.require_text_length('description',
    regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 2000);
  -- #684 (R7), R46: the Attached Links, normalized.
  v_links := private.require_attached_links(p_links, p_link_label, p_link_url);
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. The locks. This unlocked read only learns WHICH parent to lock first;
  --    every decision below is made from the locked rows. Both rows FOR NO
  --    KEY UPDATE, never FOR UPDATE (conventions section 2).
  select parent_task_id into v_parent_id from public.tasks where id = p_task_id;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  if v_parent_id is not null then
    perform 1 from public.tasks where id = v_parent_id for no key update;
    if not found then
      raise sqlstate 'PT404' using message = 'task_not_found';
    end if;
  end if;
  select * into v_task from public.tasks where id = p_task_id for no key update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock.
  perform private.require_task_manager(p_task_id);
  -- R46: an app version from before R46 sends only the pair (p_links not sent):
  -- it edits the first link it shows and keeps the others it cannot show.
  if p_links is null then
    v_links := v_links || case when jsonb_array_length(v_task.links) > 1
                               then v_task.links - 0 else '[]'::jsonb end;
  end if;
  if v_task.parent_task_id is distinct from v_parent_id then
    raise sqlstate 'PT409' using message = 'task_parent_changed';
  end if;
  if p_group_id is distinct from v_task.group_id then
    perform private.require_group_work_manager(p_group_id);
    perform 1 from public.groups grp
      where grp.id in (v_task.group_id, p_group_id)
      order by grp.id for no key update;
    perform private.require_group_work_manager(v_task.group_id);
    perform private.require_group_work_manager(p_group_id);
  end if;
  if p_group_id is distinct from v_task.group_id then
    perform 1 from public.profiles profile
     where profile.id in (
       select assignment.member_id from public.task_assignments assignment
        where assignment.task_id = p_task_id and assignment.ended_at is null
       union
       select candidate.member_id from public.task_candidates candidate
        where candidate.task_id = p_task_id and candidate.status = 'pending')
     order by profile.id for share of profile;
  end if;
  -- 5 + 6. Input validation and state preconditions, shared with the preview.
  v_plan := private.plan_task_update(v_task, p_group_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience, v_links);
  -- Consequences, shared with the preview; none may apply unaccepted.
  select coalesce(jsonb_agg(jsonb_build_object('consequence', c.consequence, 'member_id', c.member_id)
                            order by c.ord), '[]'::jsonb)
    into v_consequences
    from private.task_update_consequences(p_task_id, p_group_id, p_campaign_id, p_assignment_mode, p_audience)
         with ordinality as c (consequence, member_id, ord);
  if jsonb_array_length(v_consequences) > 0 and not coalesce(p_accept_consequences, false) then
    raise sqlstate 'PT409' using message = 'task_update_needs_confirmation';
  end if;
  select coalesce(array_agg((e ->> 'member_id')::uuid) filter (where e ->> 'consequence' = 'candidate_removed'), '{}'::uuid[]),
         (array_agg((e ->> 'member_id')::uuid) filter (where e ->> 'consequence' = 'executor_removed'))[1],
         (array_agg((e ->> 'member_id')::uuid) filter (where e ->> 'consequence' = 'executor_added_to_group'))[1]
    into v_removed_candidates, v_removed_executor, v_added_executor
    from jsonb_array_elements(v_consequences) as e;
  v_campaign_id := (v_plan ->> 'campaign_id')::bigint;
  v_mode_changed := p_assignment_mode is distinct from v_task.assignment_mode;
  v_group_changed := p_group_id is distinct from v_task.group_id;

  if v_added_executor is not null then
    perform private.appoint_group_member(p_group_id, v_added_executor, v_actor);
  end if;
  -- 7. Mutate. Candidatures first: close_task_queue must run while the Task
  --    is still public (it is a no-op otherwise).
  if v_task.assignment_mode = 'public' and p_assignment_mode = 'direct' then
    v_closed := private.close_task_queue(p_task_id, v_actor);
  elsif cardinality(v_removed_candidates) > 0 then
    with closed as (
      update public.task_candidates as candidate
         set status = 'closed', decided_at = now(), decided_by = v_actor
       where candidate.task_id = p_task_id
         and candidate.status = 'pending'
         and candidate.member_id = any (v_removed_candidates)
      returning candidate.member_id)
    select coalesce(array_agg(closed.member_id), '{}'::uuid[]) into v_closed from closed;
  end if;
  -- A removed Executor leaves the Task todo; the remaining queue is left
  -- exactly as it is for the manager to select from (#682, R9).
  if v_removed_executor is not null then
    select assignment.id into v_assignment_id
      from public.task_assignments as assignment
     where assignment.task_id = p_task_id and assignment.ended_at is null
       and assignment.member_id = v_removed_executor
     for update;
    perform private.end_task_assignment(v_assignment_id,
      case when v_group_changed then 'group_changed' else 'task_updated' end, null);
    if v_task.status <> 'todo' then
      v_from := v_task.status;
      v_to := 'todo';
    end if;
  end if;
  begin
    update public.tasks
       set title = v_plan ->> 'title',
           description = v_plan ->> 'description',
           deadline = p_deadline,
           campaign_id = v_campaign_id,
           group_id = p_group_id,
           audience = p_audience,
           assignment_mode = p_assignment_mode,
           links = v_plan -> 'links',
           queue_opened_at = case
             when v_mode_changed then case when p_assignment_mode = 'public' then now() end
             else queue_opened_at
           end,
           queue_closed_at = case when v_mode_changed then null else queue_closed_at end,
           status = case when v_removed_executor is not null then 'todo'::public.task_status else status end,
           started_at = case when v_removed_executor is not null then null else started_at end
     where id = p_task_id
    returning * into v_task;
  exception
    when foreign_key_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'tasks_campaign_id_fkey' then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
    when check_violation then
      -- private.validate_task_campaign raises 23514 with exactly these two
      -- reasons (update_task_content precedent); any other 23514 propagates.
      if sqlerrm in ('task_campaign_origin_mismatch', 'task_campaign_inactive') then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
  end;
  v_details := jsonb_build_object('changed', v_plan -> 'changed', 'before', v_plan -> 'before',
    'after', v_plan -> 'after', 'consequences', v_consequences);
  if v_assignment_id is not null then
    v_details := v_details || jsonb_build_object('ended_assignment_id', v_assignment_id);
  end if;
  perform private.log_task_activity(p_task_id, 'task_updated', v_actor, null, v_from, v_to, null, v_details);

  -- Notifications.
  perform private.notify(v_closed, 'task'::public.noti_kind,
    'Coadă închisă: ' || v_task.title,
    'Nu mai poți fi selectat pentru acest task.',
    p_task_id, null, v_actor);
  if v_removed_executor is not null then
    perform private.notify(array[v_removed_executor], 'task'::public.noti_kind,
      'Task actualizat: ' || v_task.title,
      case when v_group_changed
        then 'Taskul a fost mutat într-un grup pentru care nu ești eligibil.'
        else 'Nu mai ești executorul acestui task: audiența lui s-a schimbat.' end,
      p_task_id, null, v_actor);
  end if;
  select assignment.member_id into v_executor
    from public.task_assignments as assignment
   where assignment.task_id = p_task_id and assignment.ended_at is null;
  -- R53: a Campaign is a label; a change of the Campaign alone tells nobody.
  if v_executor is not null
     and exists (select 1 from jsonb_array_elements_text(v_plan -> 'changed') as field(name)
                  where field.name <> 'campaign_id') then
    perform private.notify(array[v_executor], 'task'::public.noti_kind,
      'Task actualizat: ' || v_task.title,
      'Modificat: ' || private.task_field_labels(array(select jsonb_array_elements_text(v_plan -> 'changed'))) || '.',
      p_task_id, null, v_actor);
  end if;
  return v_task;
end;
$function$;

-- 6. The descriptions of the three restated functions, brought up to R53.
comment on function private.update_event_impl(bigint, text, text, bigint, timestamp with time zone, timestamp with time zone, text, integer, text, integer, bigint) is
  'Replaces an Event''s whole editable state, authorized by Group Role (ADR-0009 Wave 2, #248). This is a full-state REPLACE, not a patch: every editable column is written from its argument, so a null clears a nullable column (ends_at, location, capacity, description, campaign_id) rather than leaving the old value -- a client that wants to keep a field must send it back. Malformed input is judged first, for everyone, with the same reasons as create_event including event_group_required. A caller who cannot see the Event (below its min_level) is answered PT404 event_not_found, the same as an id that does not exist: hidden is never distinguishable from missing. Authority on the SOURCE: an Organization Group Event (since #582 the Group carrying groups.is_organization) belongs to its creator or to level >= 6; every other Event goes through private.require_group_work_manager, so a Group Manager or Group Responsible of the Group or any ancestor on its path qualifies. Moving the Event re-runs the rule on the TARGET Group, where an Organization target takes create_event''s rule -- level >= 6 or any live Group Role anywhere -- because the Organization Group is a root Group with no ancestors of its own (one root among several: every Department, Independent Team and Project Group is a root too, and most Group paths never contain it), so nobody could reach it through an ancestor role. A MOVE''s target must be active. An edit that leaves the Event in its own Group is NOT refused when that Group has since been archived: this is a full-state replace, so every call names a Group, and an ungated check would leave such an Event uncorrectable while cancel_event -- same authority rule -- still cancelled it. Who may still edit it is decided by the source rule above alone: BC/Moderator always, a Group Role only while the Group is active, which is can_manage_group_work''s own status gate. Minimum Level is then judged against the target Group and the live actor (PT400 event_min_level_below_group / event_min_level_above_actor), and a cancelled Event is PT409 event_cancelled. The Campaign (#691, ADR-0008 amended 2026-09-23) must be owned by the Event''s Group -- the new one, on a move -- or a Group above it, and a newly attached one must be active (events_validate_campaign); anything else is PT400 invalid_campaign, and a Campaign deactivated after it was attached is kept when sent back unchanged. R53 (2026-10-14): every content change -- title, description, type, schedule, location, capacity, Group, Minimum Level -- notifies, in one notice per edit that names what changed and carries the current schedule and place, the current going attendees and the new Group''s Group Audience as Notifications reach it (private.group_notification_audience: #601, minus every live BC member and Moderator, #929, plus the BC members whose Group position reaches it, R42), plus the old Group''s when the Event moved, every recipient filtered through private.can_read_event at the new Minimum Level, link /calendar?event=<id>: private.notify_event tells whoever knows the Event "Eveniment actualizat" (event:<id>:changed) and whoever does not "Eveniment nou"; a Campaign alone notifies nobody. #934: the source-authority rule is private.can_manage_event, the one definition event_attendance_read also reads; the command holds the roster rows it rests on FOR SHARE and asks it again. Spec 2026-10-11 (final review of 2026-10-13): a pending or rejected OSUBB-wide Event moved off the Organization Group is published by the move (private.stamp_approval) -- its new Group hears "Eveniment nou" through private.notify_event_created and no change notice is sent; the old Group''s audience is told of a move only when the Event had been approved.';
comment on function private.notify_event_created(public.events, uuid) is
  'Ruling R39''s "Eveniment nou" notice over one Event row: create_event_impl calls it for an approved Event without its Announcement, approve_event for a pending one that just became approved (the author as the actor to drop). R53 (2026-10-14): through private.notify_event, so whoever already knows the Event -- an approval after an edit that needed it -- hears "Eveniment actualizat" instead.';
comment on function private.fan_out_announcement_row(public.announcements, uuid) is
  'The Announcement fan-out (#68, R32, R42, R43, R45, #756, #909, #861 -- see announcements_fan_out) as a helper over one row: the trigger calls it for an approved insert and approve_announcement for a pending row that just became approved, with the author as the actor to drop, so the author never gets "Anunț nou" of their own Announcement. R53 (2026-10-14): through private.notify_announcement, so whoever already knows the Announcement -- an approval after an edit that needed it -- hears "Anunț actualizat" instead.';
