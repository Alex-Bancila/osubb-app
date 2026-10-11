-- Cerere de aprobare (spec docs/superpowers/specs/2026-10-11-org-wide-approval-design.md,
-- Alex 2026-10-11): an Announcement or Event on the Organization Group by a writer
-- below BC (a BCE, a Group Manager or Responsible) waits as a request until a BC
-- member or the Moderator approves it from the item's own form or rejects it
-- with a reason. BC and the Moderator keep publishing OSUBB-wide items at once;
-- local Group items are untouched. Sections 1-6 are the model; 7-8 the commands.

-- ==================== 1. the columns ====================
alter table public.announcements
  add column approval_status text not null default 'approved',
  add column approval_decided_by uuid references public.profiles (id),
  add column approval_decided_at timestamptz,
  add column rejection_reason text,
  add constraint announcements_approval_status_ck
    check (approval_status in ('pending', 'approved', 'rejected')),
  add constraint announcements_rejection_reason_ck check (
    (approval_status = 'rejected') = (rejection_reason is not null)
    and (rejection_reason is null or char_length(btrim(rejection_reason)) between 1 and 1000));
alter table public.events
  add column approval_status text not null default 'approved',
  add column approval_decided_by uuid references public.profiles (id),
  add column approval_decided_at timestamptz,
  add column rejection_reason text,
  add column announce_on_approval boolean not null default false,
  add constraint events_approval_status_ck
    check (approval_status in ('pending', 'approved', 'rejected')),
  add constraint events_rejection_reason_ck check (
    (approval_status = 'rejected') = (rejection_reason is not null)
    and (rejection_reason is null or char_length(btrim(rejection_reason)) between 1 and 1000));
comment on column public.announcements.approval_status is
  'approved for every row BC/Moderator write and for every local Group Announcement; pending for an OSUBB-wide Announcement by a writer below level 6 until approve_announcement / reject_announcement decide it (spec 2026-10-11). Written by private.stamp_approval and the two commands only.';
comment on column public.events.approval_status is
  'approved for every row BC/Moderator write and for every local Group Event; pending for an OSUBB-wide Event by a writer below level 6 until approve_event / reject_event decide it (spec 2026-10-11). Written by private.stamp_approval and the two commands only.';
comment on column public.events.announce_on_approval is
  'A pending OSUBB-wide Event created with p_announce: its Announcement is written when approve_event publishes it, as the original author.';
-- Every foreign key carries an index (the schema suite checks).
create index announcements_approval_decided_by_idx on public.announcements (approval_decided_by);
create index events_approval_decided_by_idx on public.events (approval_decided_by);

-- ==================== 2. the stamp (before insert or update, both tables) ====================
create function private.stamp_approval()
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
  -- The decision commands write the approval columns themselves.
  if coalesce(current_setting('osubb.deciding_approval', true), '') = 'on' then
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
    v_level := coalesce(private.actor_level(v_actor), 0);
    if coalesce(v_org, false) and v_level < 6 then
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
  if not coalesce(v_org, false) then
    return new;
  end if;
  v_level := coalesce(private.actor_level(v_actor), 0);
  if v_level >= 6 then
    return new;
  end if;
  v_changed := (to_jsonb(new) - v_skip) is distinct from (to_jsonb(old) - v_skip);
  if v_changed and old.approval_status in ('approved', 'rejected') then
    new.approval_status := 'pending';
    new.approval_decided_by := null;
    new.approval_decided_at := null;
    new.rejection_reason := null;
  end if;
  return new;
end;
$$;
comment on function private.stamp_approval() is
  'announcements_stamp_approval / events_stamp_approval (before insert or update; spec 2026-10-11): on insert the status is pending for a row on the Organization Group by a signed-in writer below level 6 and approved otherwise (a client value is ignored; a write with no auth.uid() publishes); on update the approval columns are kept, except that a writer below level 6 changing the content of a decided OSUBB-wide row (anything but the approval columns, updated_at, pinned, cancelled_at, cancel_reason and announce_on_approval) sends it back to pending with the decision cleared. A Deal (kind deal, R45) is never pending: the OSUBB Deals team publishes it at once. The decision commands set osubb.deciding_approval = on for their own write.';
revoke execute on function private.stamp_approval() from public, anon, authenticated, service_role;
create trigger announcements_stamp_approval before insert or update on public.announcements
  for each row execute function private.stamp_approval();
create trigger events_stamp_approval before insert or update on public.events
  for each row execute function private.stamp_approval();

-- ==================== 3. the request (after insert or update, both tables) ====================
create function private.request_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipients uuid[];
  v_group text;
  v_author text;
  v_link text;
  v_kind public.noti_kind;
begin
  if new.approval_status <> 'pending' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.approval_status = 'pending' then
    return new;  -- an edit while pending is not a new request
  end if;
  select array_agg(profile.id order by profile.id) into v_recipients
    from public.profiles as profile
    join public.roles as role on role.id = profile.role
   where profile.status = 'activ' and role.level >= 6;
  select grp.name into v_group from public.groups as grp where grp.id = new.group_id;
  select profile.full_name into v_author from public.profiles as profile where profile.id = new.created_by;
  if tg_table_name = 'events' then
    v_kind := 'event';
    v_link := '/calendar?event=' || new.id::text;
  else
    v_kind := 'announce';
    v_link := '/anunturi?anunt=' || new.id::text;
  end if;
  perform private.notify(v_recipients, v_kind, 'Cerere de aprobare: ' || new.title,
    coalesce(v_author, 'Un membru') || ' · ' || coalesce(v_group, 'OSUBB'),
    null, 'approval:' || tg_table_name || ':' || new.id::text, new.created_by, v_link);
  return new;
end;
$$;
comment on function private.request_approval() is
  'announcements_request_approval / events_request_approval (after insert or update; spec 2026-10-11): when a row becomes pending (new, or re-entering review) every live BC member and the Moderator get one Notification "Cerere de aprobare: <title>" with the author and the Group, keyed approval:<table>:<id> so a second request while the first is unread merges into it, linking to the item. The author (private.notify drops the actor) is never a recipient.';
revoke execute on function private.request_approval() from public, anon, authenticated, service_role;
create trigger announcements_request_approval after insert or update on public.announcements
  for each row execute function private.request_approval();
create trigger events_request_approval after insert or update on public.events
  for each row execute function private.request_approval();

-- ==================== 4. who reads a pending row ====================
alter policy events_read on public.events
  using ((select auth_is_member())
         and private.can_read_event(group_id, min_level, (select auth.uid()))
         and (approval_status = 'approved'
              or created_by = (select auth.uid())
              or coalesce((select private.caller_level()), 0) >= 6));
drop policy announcements_read on public.announcements;
create policy announcements_read on public.announcements
  for select to authenticated
  using (private.can_read_announcement(group_id, audience, min_level, created_by, kind, deadline)
         and (approval_status = 'approved'
              or created_by = (select auth.uid())
              or coalesce((select private.caller_level()), 0) >= 6));

-- ==================== 5. the unread badge counts approved rows only ====================
create or replace function public.my_unread_announcements_count(p_kind text default null)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
    from public.announcements as announcement
   where announcement.approval_status = 'approved'
     and ((select private.caller_level()) < 6
          -- R42: a BC member counts the Announcements whose Origin their Manager or
          -- Responsible position reaches -- the ones the fan-out notified them of.
          -- Never the Moderator (level 9), who holds no position.
          or ((select private.caller_level()) = 6
              and exists (
                select 1
                  from public.groups as origin
                  join public.group_members as held
                    on origin.path @> array[held.group_id]
                   and held.member_id = (select auth.uid())
                   and held.group_role in ('manager', 'responsible')
                 where origin.id = announcement.group_id)))
     -- R43: not an Announcement of a Group the caller unselected -- the fan-out
     -- left them out of it -- unless it is critical or organization-wide.
     and (announcement.priority = 'critical'
          or announcement.audience = 'org'
          or not private.is_group_muted(announcement.group_id))
     -- R45: one kind when asked (the Anunțuri and OSUBB Deals tabs), and never a
     -- Deal past its Termen -- it is gone from the members' tab.
     and (p_kind is null or announcement.kind = p_kind)
     and (announcement.kind <> 'deal'
          or announcement.deadline is null
          or announcement.deadline >= now())
     and not exists (
       select 1
         from public.announcement_reads as reads
        where reads.announcement_id = announcement.id
          and reads.member_id = (select auth.uid()));
$$;
do $$
declare v_old text := obj_description('public.my_unread_announcements_count(text)'::regprocedure, 'pg_proc');
begin
  execute format('comment on function public.my_unread_announcements_count(text) is %L',
    v_old || ' A pending or rejected Announcement never counts (spec 2026-10-11).');
end $$;

-- ==================== 6a. the Announcement fan-out as a row helper ====================
create function private.fan_out_announcement_row(p_row public.announcements, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audience_group bigint;
  v_recipients uuid[];
  v_critical boolean := p_row.priority = 'critical';
  v_deal boolean := p_row.kind = 'deal';
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

  -- #635: a critical Announcement's Notification is critical, so it still
  -- pushes to a Member who muted 'announce'.
  -- #861 (Audit D-20): keyed announcement:<id>, so reading the Announcement
  -- (private.mark_announcement_notification_read) finds and clears it.
  -- R45: a Deal is announced as "Deal nou" and opens on the OSUBB Deals tab.
  perform private.notify(v_recipients, 'announce',
    case when v_deal then 'Deal nou: ' else 'Anunț nou: ' end || p_row.title,
    p_row.body, null, 'announcement:' || p_row.id::text, p_actor,
    case when v_deal then '/anunturi/deals?deal=' else '/anunturi?anunt=' end || p_row.id::text,
    v_critical);

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
comment on function private.fan_out_announcement_row(public.announcements, uuid) is
  'The Announcement fan-out (#68, R32, R42, R43, R45, #756, #909, #861 -- see announcements_fan_out) as a helper over one row: the trigger calls it for an approved insert and approve_announcement for a pending row that just became approved, with the author as the actor to drop, so the author never gets "Anunț nou" of their own Announcement.';
revoke execute on function private.fan_out_announcement_row(public.announcements, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.fan_out_announcement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Spec 2026-10-11: a pending Announcement tells nobody yet; approve_announcement
  -- fans it out. An Announcement inserted on behalf of an Event's author
  -- (osubb.announcement_author, approve_event) drops that author, not the caller.
  if new.approval_status <> 'approved' then
    return new;
  end if;
  perform private.fan_out_announcement_row(new,
    coalesce(nullif(current_setting('osubb.announcement_author', true), '')::uuid,
             (select auth.uid()), new.created_by));
  return new;
end;
$$;
do $$
declare v_old text := obj_description('private.fan_out_announcement()'::regprocedure, 'pg_proc');
begin
  execute format('comment on function private.fan_out_announcement() is %L',
    v_old || ' Since the approval flow (spec 2026-10-11) it skips a pending row and delegates to private.fan_out_announcement_row; the actor dropped is the author an approve command inserts on behalf of (osubb.announcement_author), else the caller.');
end $$;

-- ==================== 6b. an Announcement inserted on behalf of its author ====================
create or replace function private.stamp_announcement_authorship()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_on_behalf uuid := nullif(current_setting('osubb.announcement_author', true), '')::uuid;
begin
  if v_actor is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_on_behalf, v_actor);
    new.published_at := now();
  else
    new.created_by := old.created_by;
    new.published_at := old.published_at;
  end if;
  return new;
end;
$$;
do $$
declare v_old text := obj_description('private.stamp_announcement_authorship()'::regprocedure, 'pg_proc');
begin
  execute format('comment on function private.stamp_announcement_authorship() is %L',
    v_old || ' approve_event sets osubb.announcement_author to the Event''s creator for the Announcement it publishes on their behalf (spec 2026-10-11).');
end $$;

-- ==================== 6c. the "Eveniment nou" notice as a helper; create_event_impl ====================
create function private.notify_event_created(p_event public.events, p_actor uuid)
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
  perform private.notify(v_recipients, 'event', 'Eveniment nou: ' || p_event.title,
    private.event_announcement_body(p_event.starts_at, p_event.ends_at, p_event.location, null),
    null, 'event:' || p_event.id::text || ':created', p_actor,
    '/calendar?event=' || p_event.id::text);
end;
$$;
comment on function private.notify_event_created(public.events, uuid) is
  'Ruling R39''s "Eveniment nou" notice over one Event row: create_event_impl calls it for an approved Event without its Announcement, approve_event for a pending one that just became approved (the author as the actor to drop).';
revoke execute on function private.notify_event_created(public.events, uuid)
  from public, anon, authenticated, service_role;

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
    -- R39: without the Announcement, the Event tells its audience itself.
    perform private.notify_event_created(v_created, v_actor);
  end if;
  return v_created;
end;
$$;
do $$
declare v_old text := obj_description('private.create_event_impl(text,text,bigint,timestamptz,timestamptz,text,integer,text,integer,bigint,boolean)'::regprocedure, 'pg_proc');
begin
  execute format('comment on function private.create_event_impl(text,text,bigint,timestamptz,timestamptz,text,integer,text,integer,bigint,boolean) is %L',
    v_old || ' Spec 2026-10-11: an OSUBB-wide Event by a writer below BC is written pending (private.stamp_approval), tells nobody and keeps p_announce as announce_on_approval for approve_event; the "Eveniment nou" notice lives in private.notify_event_created.');
end $$;
