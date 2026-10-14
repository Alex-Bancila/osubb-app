-- #1062: Task, Event and Termen reminders at 09:00 Bucharest time (ruling R53).
--
-- Alex, 2026-10-14: a Task's Executor at 09:00 three days before and the day
-- before its deadline (only the day before with less than three days left);
-- everyone going to an Event at 09:00 the day before; everyone an
-- Announcement reached, Deals included, at 09:00 the day before its Termen.
-- Spec docs/superpowers/specs/2026-10-14-edit-notices-and-reminders-design.md.
--
-- One job replaces private.remind_deadlines (#69), which told the Executor
-- every morning at 06:00 UTC while the deadline was within 48 hours. It runs
-- every hour and acts only in the 09:00 hour in Europe/Bucharest, so the
-- daylight-saving change needs nothing; days are counted between local
-- calendar dates.
--
-- An Event's Announcement (create_event / approve_event write one whose
-- Termen is the Event's start) gets no Termen reminder: reminding its whole
-- audience would contradict "everyone going". announcements.event_id records
-- the Event; it also lets an Event edit treat whoever was told through that
-- Announcement as knowing the Event.

-- 1. The approval stamp (restated from 20261013090000_org_wide_approval_review.sql):
--    event_id is bookkeeping, never content.
CREATE OR REPLACE FUNCTION private.stamp_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_level integer;
  v_org boolean;
  -- A Campaign is a reporting label, never content (ADR-0007): changing or
  -- clearing it -- a Campaign manager's deletion does -- asks nobody again (M4).
  v_skip constant text[] := array['approval_status', 'approval_decided_by', 'approval_decided_at', 'rejection_reason',
                                  'updated_at', 'pinned', 'cancelled_at', 'cancel_reason', 'announce_on_approval',
                                  'campaign_id',
                                  -- R53: the Event an Announcement was written for is
                                  -- bookkeeping, never content -- its link being written or
                                  -- cleared (the Event deleted) asks nobody again.
                                  'event_id'];
  v_was_org boolean;
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
  -- Became OSUBB-wide by this very change -- a local Event moved onto the
  -- Organization Group, an Audience widened -- below BC: a request, whoever
  -- made it (a Group Manager may move a member's Event; security review of
  -- 2026-10-13).
  select grp.is_organization into v_was_org from public.groups as grp where grp.id = old.group_id;
  v_was_org := coalesce(v_was_org, false)
               or (tg_table_name = 'announcements' and (to_jsonb(old) ->> 'audience') = 'org');
  if not v_was_org then
    new.approval_status := 'pending';
    new.approval_decided_by := null;
    new.approval_decided_at := null;
    new.rejection_reason := null;
    return new;
  end if;
  -- A content change by any writer below BC asks again.
  v_changed := (to_jsonb(new) - v_skip) is distinct from (to_jsonb(old) - v_skip);
  if v_changed and old.approval_status in ('approved', 'rejected') then
    new.approval_status := 'pending';
    new.approval_decided_by := null;
    new.approval_decided_at := null;
    new.rejection_reason := null;
  end if;
  return new;
end;
$function$;

-- 2. The Event an Announcement was written for.
alter table public.announcements
  add column event_id bigint references public.events (id) on delete set null;
create index announcements_event_id_idx on public.announcements (event_id) where event_id is not null;
comment on column public.announcements.event_id is
  'R53: the Event this Announcement was written for by create_event or approve_event (its Termen is the Event''s start); null for every other Announcement and once the Event is deleted. Set by private.guard_announcement_event from osubb.announcement_event, never by a client.';
-- Those written before today: the same Group, title, author and Termen = start.
update public.announcements as announcement
   set event_id = event.id
  from public.events as event
 where announcement.event_id is null
   and announcement.group_id = event.group_id
   and announcement.title = event.title
   and announcement.created_by = event.created_by
   and announcement.deadline = event.starts_at;

create function private.guard_announcement_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A signed-in writer never chooses the link: on insert it is the Event the
  -- command writing the Announcement named (osubb.announcement_event); on an
  -- update it only ever clears, as deleting the Event does.
  if (select auth.uid()) is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.event_id := nullif(current_setting('osubb.announcement_event', true), '')::bigint;
  elsif new.event_id is not null and new.event_id is distinct from old.event_id then
    new.event_id := old.event_id;
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_announcement_event() from public, anon, authenticated, service_role;
comment on function private.guard_announcement_event() is
  'R53: announcements.event_id is the command''s, never a writer''s -- on insert by a signed-in writer it is osubb.announcement_event (set by create_event_impl and approve_event_impl around their insert), on update it may only be cleared. System writes pass. Granted to nobody.';
create trigger announcements_guard_event
  before insert or update of event_id on public.announcements
  for each row execute function private.guard_announcement_event();

-- 3. An Event edit: whoever was told of the Event through its Announcement
--    knows the Event too (restated from 20261014153142_edit_notices.sql).
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
  v_schedule text := private.event_announcement_body(p_event.starts_at, p_event.ends_at, p_event.location, null);
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

-- 4. The reminders.
create function private.send_reminders(p_now timestamptz default now())
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
    select event.id, event.title, event.starts_at, event.location, attendance.member_id
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
        'Începe la ' || to_char(v_event.starts_at at time zone 'Europe/Bucharest', 'HH24:MI')
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
       and announcement.event_id is null
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
revoke execute on function private.send_reminders(timestamptz) from public, anon, authenticated, service_role;
comment on function private.send_reminders(timestamptz) is
  'R53: the hourly reminder job, acting only in the 09:00 hour in Europe/Bucharest (p_now, for tests). A Task''s current Executor three days and one day before its deadline (To do, In progress); everyone going to an approved, uncancelled Event the day before it starts; everyone private.announcement_recipients reaches, never the author, the day before an approved Announcement''s Termen (not an Event''s Announcement, not a Member told of it that day). Once per Member per day; advisory lock (69, 1). Returns how many Notifications it wrote. Granted to nobody.';

select cron.unschedule('osubb-daily-deadline-reminders');
drop function private.remind_deadlines();
select cron.schedule('osubb-reminders', '5 * * * *', 'select private.send_reminders()');

-- 5. The two commands that write an Event's Announcement name the Event
--    (create_event_impl from 20261011140000_org_wide_approval.sql,
--    approve_event_impl from 20261013090000_org_wide_approval_review.sql),
--    and reading an Announcement clears its Termen reminder too
--    (mark_announcement_notification_read from 20260928120000_audit_d_server_fixes.sql).
CREATE OR REPLACE FUNCTION private.create_event_impl(p_title text, p_type text, p_group_id bigint, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_location text DEFAULT NULL::text, p_capacity integer DEFAULT NULL::integer, p_description text DEFAULT NULL::text, p_min_level integer DEFAULT 0, p_campaign_id bigint DEFAULT NULL::bigint, p_announce boolean DEFAULT false)
 RETURNS public.events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
                                              v_created.location, v_created.description),
              v_created.group_id,
              case when v_group.is_organization then 'org' else 'local' end,
              v_created.min_level,
              v_created.starts_at,
              v_actor);
    perform set_config('osubb.announcement_event', '', true);
  else
    -- R39: without the Announcement, the Event tells its audience itself.
    perform private.notify_event_created(v_created, v_actor);
  end if;
  return v_created;
end;
$function$;

CREATE OR REPLACE FUNCTION private.approve_event_impl(p_id bigint)
 RETURNS public.events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
              private.event_announcement_body(v_row.starts_at, v_row.ends_at, v_row.location, v_row.description),
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
$function$;

CREATE OR REPLACE FUNCTION private.mark_announcement_notification_read()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Only the reader's own rows, only while unread: the one keyed
  -- announcement:<id>, and any older duplicate the backfill below left
  -- unkeyed (the partial unique index admits one unread row per key), found
  -- by the link every "Anunț nou" carries since #843.
  update public.notifications as notification
     set read = true
   where notification.member_id = new.member_id
     and not notification.read
     and (notification.dedupe_key = 'announcement:' || new.announcement_id::text
          -- R53: and its Termen reminders (announcement:<id>:termen:<date>),
          -- whatever the link -- a Deal's opens on the OSUBB Deals tab.
          or notification.dedupe_key like 'announcement:' || new.announcement_id::text || ':%'
          or (notification.kind = 'announce'
              and notification.link = '/anunturi?anunt=' || new.announcement_id::text));
  return new;
end;
$function$;

-- 6. A Termen reminder is about its Announcement (notification_subject from
--    20261005001035_notification_read_rules.sql), so opening a Deal reads it.
CREATE OR REPLACE FUNCTION private.notification_subject(p_task_id bigint, p_dedupe_key text, p_link text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    'task:' || p_task_id::text,
    case
      when p_dedupe_key ~ '^task:[0-9]+(:|$)'
        then 'task:' || substring(p_dedupe_key from '^task:([0-9]+)')
      when p_dedupe_key ~ '^event:[0-9]+(:|$)'
        then 'event:' || substring(p_dedupe_key from '^event:([0-9]+)')
      -- R53: a Termen reminder (announcement:<id>:termen:<date>) is about its
      -- Announcement too, a Deal's included, whose link maps to no subject.
      when p_dedupe_key ~ '^announcement:[0-9]+(:|$)'
        then 'announcement:' || substring(p_dedupe_key from '^announcement:([0-9]+)')
      when p_dedupe_key ~ '^request:[0-9]+$'
        then 'completed_work_request:' || substring(p_dedupe_key from '^request:([0-9]+)$')
      when p_dedupe_key ~ '^application:[0-9]+$'
        then 'group_application:' || substring(p_dedupe_key from '^application:([0-9]+)$')
      when p_dedupe_key ~ '^promotion_candidate:(live|[0-9]+):[0-9a-f-]{36}$'
        then 'promotion_candidate:' || substring(p_dedupe_key from '([0-9a-f-]{36})$')
      when p_dedupe_key ~ '^retention_signal:[0-9]+:[0-9a-f-]{36}$'
        then 'retention_signal:' || substring(p_dedupe_key from '([0-9a-f-]{36})$')
    end,
    case
      when p_link ~ '^/tracker\?task=[0-9]+$'
        then 'task:' || substring(p_link from '^/tracker\?task=([0-9]+)$')
      when p_link ~ '^/tracker/[0-9]+$'
        then 'task:' || substring(p_link from '^/tracker/([0-9]+)$')
      when p_link ~ '^/calendar\?event=[0-9]+$'
        then 'event:' || substring(p_link from '^/calendar\?event=([0-9]+)$')
      when p_link ~ '^/anunturi\?anunt=[0-9]+$'
        then 'announcement:' || substring(p_link from '^/anunturi\?anunt=([0-9]+)$')
    end
  );
$function$;
