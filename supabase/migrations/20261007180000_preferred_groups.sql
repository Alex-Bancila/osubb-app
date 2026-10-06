-- Ruling R43 (2026-10-07): Grupuri preferate for level >= 5. Alex: "give BC/BCE
-- members a new option, because they see everything ... select the preferred
-- groups, this option will remove the notification, and everything related to the
-- groups that are unselected, by default everything will be selected".
--
-- BCE, BC and the Moderator choose their preferred Groups. Storage keeps the
-- Groups a Member UNSELECTED, so every Group -- one created later included -- is
-- selected until its own row exists. Rows are explicit per Group: nothing is
-- inherited at read time. "Unselecting a Group unselects its subgroups" is the
-- app writing the subtree; a subgroup can be unselected alone. The Organization
-- Group, the Adunarea Generala and Biroul de Conducere (org_settings
-- adunarea_generala_group_id / board_group_id) are always selected.
--
-- An unselected Group G mutes, for its Member:
--   * private.group_notification_audience(G) -- so the Announcement fan-out and
--     readers list, and the Event creation, change and cancellation recipients
--     (private.event_notification_recipients, update_event_impl's old-Group
--     audience) follow without being rebuilt;
--   * the Application recipients (private.group_application_recipients) and the
--     Completed-work Request Notification (create_completed_work_request_impl);
--   * the Anunturi badge (public.my_unread_announcements_count).
-- It never mutes (private.group_muted_for is false):
--   * a Member below level 5, read on the LIVE level -- a row left behind by a
--     demotion is kept but ignored, and applies again only if the Member returns
--     to level 5 or above;
--   * a Group where the Member holds a Manager or Responsible position, on it or
--     on a Group above it;
--   * the three locked Groups, even if a stale row exists (a setting changed);
-- and the callers never ask it for: Task Notifications (private.task_managers,
-- the Executor, the creator), an Event's going attendees, a critical
-- Announcement, role changes and own requests, Promotion Candidates and
-- Retention Signals (they come through the Adunarea Generala), push health and
-- the Privacy Notice. Authority and reads are unchanged: request_deciders /
-- work_deciders still decide who MAY decide; only who is TOLD changes.
--
-- Reads for the app: public.my_group_preferences() (every Group the caller can
-- see, selected or not, and why a Group is locked) and an optional p_preferred
-- on public.leadership_leaderboard, so Clasament opens on the preferred Groups'
-- points. Write: public.set_unselected_groups(p_group_ids), a full-state replace.
--
-- Rebuilt from main's latest bodies: group_notification_audience,
-- fan_out_announcement, announcement_readers_impl and my_unread_announcements_count
-- (20261007120000_bc_group_positions.sql), group_application_recipients
-- (20260922224243_group_applications.sql), create_completed_work_request_impl
-- (20260928100000_notification_links.sql), leadership_leaderboard and
-- leadership_leaderboard_impl (20260929200000_group_member_set.sql).

-- ==================== 1. storage ====================

create table public.member_group_unselected (
  member_id  uuid not null references public.profiles (id) on delete cascade,
  group_id   bigint not null references public.groups (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, group_id)
);

comment on table public.member_group_unselected is
  'Ruling R43 (Grupuri preferate): one row per Group a Member at level >= 5 UNSELECTED. No row means selected, so every Group, one created later included, starts selected. Explicit per Group -- a parent''s row never mutes its children at read time; the app writes the subtree. Written only by public.set_unselected_groups; each Member reads only their own rows. Read through private.group_muted_for, which ignores a row while the Member is below level 5, on a locked Group, or where the Member holds a Group position on the Group''s path.';

create index member_group_unselected_group_id_idx
  on public.member_group_unselected (group_id);

alter table public.member_group_unselected enable row level security;

revoke all on table public.member_group_unselected from public, anon, authenticated, service_role;
grant select on table public.member_group_unselected to authenticated, service_role;
-- public.set_unselected_groups is the only write path (conventions section 2).

-- Self-only, for a live active Member: a stale claim or a claimless session
-- reads nothing (house rule 12).
create policy member_group_unselected_read_self on public.member_group_unselected
  for select to authenticated
  using (public.auth_is_member()
    and (select private.caller_level()) >= 0
    and member_id = (select auth.uid()));

-- ==================== 2. the rule ====================

create function private.group_preference_lock(p_group_id bigint, p_member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when grp.is_organization then 'organization'
    when exists (select 1 from public.org_settings as setting
                  where setting.key = 'adunarea_generala_group_id'
                    and setting.value = grp.id::text) then 'adunarea_generala'
    when exists (select 1 from public.org_settings as setting
                  where setting.key = 'board_group_id'
                    and setting.value = grp.id::text) then 'board'
    when exists (select 1 from public.group_members as held
                  where grp.path @> array[held.group_id]
                    and held.member_id = p_member
                    and held.group_role in ('manager', 'responsible')) then 'position'
  end
    from public.groups as grp
   where grp.id = p_group_id;
$$;

comment on function private.group_preference_lock(bigint, uuid) is
  'Ruling R43: why p_group_id is always a preferred Group for p_member, or null when the Member may unselect it. organization (the Organization Group), adunarea_generala and board (the Groups org_settings adunarea_generala_group_id and board_group_id name) are locked for everyone and refused by set_unselected_groups (PT409 group_preference_locked); position (a Manager or Responsible roster row of p_member on the Group or a Group above it) is locked for that Member only: the preference never mutes a position, so a row there is ignored. Internal: executable by no client role.';

revoke execute on function private.group_preference_lock(bigint, uuid)
  from public, anon, authenticated, service_role;

create function private.group_muted_for(p_group_id bigint, p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.member_group_unselected as unselected
            where unselected.member_id = p_member
              and unselected.group_id = p_group_id)
     and coalesce(private.actor_level(p_member), -1) >= 5
     and private.group_preference_lock(p_group_id, p_member) is null;
$$;

comment on function private.group_muted_for(bigint, uuid) is
  'Ruling R43: true when p_member unselected p_group_id (their own member_group_unselected row on exactly that Group -- no inheritance), is live and at level >= 5 now (a row left by a demotion mutes nothing), and the Group is not locked for them (private.group_preference_lock: the Organization Group, the Adunarea Generala, Biroul de Conducere, or a Manager/Responsible position of theirs on the Group''s path). Callers decide where it applies: the Group Audience Notifications reach, Application and Completed-work Request Notifications, the Anunturi badge and Clasament''s preferred view -- never Task Notifications, going attendees or critical Announcements. Internal: executable by no client role.';

revoke execute on function private.group_muted_for(bigint, uuid)
  from public, anon, authenticated, service_role;

create function private.is_group_muted(p_group_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.group_muted_for(p_group_id, (select auth.uid()));
$$;

comment on function private.is_group_muted(bigint) is
  'Ruling R43: private.group_muted_for for the caller only, so a security-invoker read (the Anunturi badge) can apply the caller''s own preference without being able to ask about anyone else''s. Predicate: executable by authenticated.';

revoke execute on function private.is_group_muted(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.is_group_muted(bigint) to authenticated;

-- ==================== 3. the audience Notifications reach ====================

-- R42's body, unchanged, under a new name: the audience before any preference.
-- A critical Announcement reaches it whole.
create function private.group_notification_audience_unmuted(p_group_id bigint)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- #929 (R32): BC and the Moderator get no Notification through membership ...
  select audience.member_id
    from private.group_audience(p_group_id) as audience(member_id)
   where coalesce(private.actor_level(audience.member_id), -1) < 6
  union
  -- ... R42: except a BC member whose Group position reaches p_group_id.
  select holder.member_id
    from private.board_position_holders(p_group_id) as holder(member_id);
$$;

comment on function private.group_notification_audience_unmuted(bigint) is
  'The Group Audience a Notification reaches before Grupuri preferate (#929, R32, R42): private.group_audience(p_group_id) minus every live BC member and Moderator (level >= 6), plus the BC members whose Manager or Responsible position is on p_group_id or a Group above it (private.board_position_holders). private.group_notification_audience is this set minus the Members who unselected the Group (R43); a critical Announcement reads this one. Internal: executable by no client role.';

revoke execute on function private.group_notification_audience_unmuted(bigint)
  from public, anon, authenticated, service_role;

create or replace function private.group_notification_audience(p_group_id bigint)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- R43: minus the Members who unselected this Group -- never one below level 5,
  -- one holding a position on its path, or anyone on a locked Group.
  select audience.member_id
    from private.group_notification_audience_unmuted(p_group_id) as audience(member_id)
   where not private.group_muted_for(p_group_id, audience.member_id);
$$;

comment on function private.group_notification_audience(bigint) is
  'The Group Audience a Notification reaches (#929, ruling R32, amended by R42 and R43): private.group_notification_audience_unmuted(p_group_id) -- the Group Audience minus every live BC member and Moderator, plus the BC members whose position reaches the Group -- minus every Member for whom private.group_muted_for(p_group_id, member) holds (they unselected the Group in Grupuri preferate). Used by the Announcement fan-out and readers list (a critical Announcement reads the unmuted set instead), the Event creation, change and cancellation recipients (an Event''s going attendees are added after it, so they are never muted), and update_event_impl''s old-Group audience on a move. Internal: executable by no client role.';

-- ==================== 4. Announcements ====================

create or replace function private.fan_out_announcement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audience_group bigint;
  v_recipients uuid[];
  v_actor uuid;
  v_critical boolean := new.priority = 'critical';
begin
  v_actor := coalesce((select auth.uid()), new.created_by);
  if new.audience = 'org' then
    select id into v_audience_group from public.groups where is_organization;
  else
    v_audience_group := new.group_id;
  end if;

  -- #929 (R32): never a BC member or the Moderator through membership; R42: a BC
  -- member whose position reaches the audience Group or, for an organization-wide
  -- Announcement, its Origin -- it is still that Group's Announcement. R43: a
  -- Member who unselected the audience Group is left out (the Organization Group
  -- is locked, so an organization-wide Announcement reaches them), unless the
  -- Announcement is critical.
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
            from private.board_position_holders(new.group_id) as holder(member_id)) as recipient
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
    v_critical);

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
$$;

comment on function private.fan_out_announcement() is
  'Broadcasts one in-app Notification per recipient after an Announcement insert (#68), keyed announcement:<id> (#861) so reading the Announcement marks it read. The recipients are the Group Audience Notifications reach (private.group_notification_audience) of the Origin for a local Audience and of the Organization Group for an org Audience -- no BC member or Moderator through membership (#929, R32), and no Member who unselected that Group in Grupuri preferate (R43; the Organization Group is locked, so an org Audience is never muted) -- plus the BC members whose Group position reaches the Origin (private.board_position_holders, R42), for either Audience. A critical Announcement reads the unmuted audience (private.group_notification_audience_unmuted), so the preference never silences it. The data-driven notif_suppression lookup filters broadcast kinds, then Private Group visibility (#756) and the Minimum Level (#909), before private.notify removes duplicates, inactive recipients and the actual authenticated actor (or created_by for server-side inserts). Task notifications remain direct and unsuppressed. It also writes the author''s own announcement_reads row when the author is in the Announcement''s read audience (the announcements_read rule judged for created_by, #861), so the author''s own Announcement never counts as unread.';

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
  v_critical boolean;
begin
  select announcement.group_id, announcement.audience, announcement.created_by, announcement.min_level,
         announcement.priority = 'critical'
    into v_group_id, v_audience, v_created_by, v_min_level, v_critical
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
      -- #929 (R32), R42, R43: the Announcement's Notification recipients, the
      -- same set private.fan_out_announcement addresses -- no BC member or
      -- Moderator through membership, a BC member whose position reaches the
      -- Origin, no Member who unselected the audience Group unless it is critical.
      from (select audience.member_id
              from private.group_notification_audience(v_audience_group) as audience(member_id)
             where not v_critical
            union
            select audience.member_id
              from private.group_notification_audience_unmuted(v_audience_group) as audience(member_id)
             where v_critical
            union
            select holder.member_id
              from private.board_position_holders(v_group_id) as holder(member_id)) as recipient
      left join public.announcement_reads as reads
        on reads.announcement_id = p_announcement_id
       and reads.member_id = recipient.member_id
     -- #756: the fan-out's own filter, so the list names only its readers.
     where private.can_see_group(v_group_id, recipient.member_id)
       -- #909: only the recipients the Minimum Level lets read it.
       and coalesce(private.actor_level(recipient.member_id), -1) >= v_min_level
     order by reads.read_at desc nulls last, recipient.member_id;
end;
$function$
;

comment on function private.announcement_readers_impl(bigint) is
  'Readers list body (#693, R15). The Announcement''s Notification recipients, the same set #68''s fan-out addresses -- private.group_notification_audience of the Origin for local, of the Organization Group for org (the Group Audience minus every live BC member and Moderator, #929, plus the BC members whose position reaches it, R42, minus the Members who unselected that Group, R43 -- the unmuted set for a critical Announcement), together with the BC members whose position reaches the Origin (private.board_position_holders, R42) -- left-joined to announcement_reads, read_at null when unread, newest read first. Callable by the author, BC/Moderator (level >= 6), and for a local Audience the Origin''s Managers and Responsibles including ancestors''; everyone else, and a missing row, gets PT404 announcement_not_found.';

-- ==================== 5. the Anunturi badge ====================

create or replace function public.my_unread_announcements_count()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer
    from public.announcements as announcement
   where ((select private.caller_level()) < 6
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
     and not exists (
       select 1
         from public.announcement_reads as reads
        where reads.announcement_id = announcement.id
          and reads.member_id = (select auth.uid()));
$$;

comment on function public.my_unread_announcements_count() is
  'The caller''s unread Announcements for the Anunțuri badge (#693, R15): rows announcements_read lets them see, minus those with their own announcement_reads row. Zero without organization claims. A live BC member counts only the Announcements whose Origin their Manager or Responsible position reaches (R42), the ones the fan-out notified them of; the Moderator, whom no Announcement reaches through membership (#929, ruling R32), counts none. A Member at level >= 5 does not count a local Announcement of a Group they unselected in Grupuri preferate (R43, private.is_group_muted); a critical or organization-wide one still counts.';

-- ==================== 6. decisions waiting on them ====================

create or replace function private.group_application_recipients(p_application_id bigint)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- private.group_managers already falls back — the Group's own live
  -- Managers, else the nearest ancestor's, else the chain's Responsibles plus
  -- every live BC/Moderator — so this union only ADDS the Responsibles that
  -- fallback skips when a Manager does exist. union, not union all: a
  -- Responsible of an ancestor that also has the Managers is one recipient.
  -- R43: minus a decider who unselected the Group (a position holder never is).
  select recipient.member_id
    from (
      select manager as member_id
        from public.group_applications as application
        cross join lateral private.group_managers(application.group_id) as manager
       where application.id = p_application_id
      union
      select gm.member_id
        from public.group_applications as application
        join public.groups as target on target.id = application.group_id
        join public.group_members as gm on target.path @> array[gm.group_id]
        join public.profiles as peer on peer.id = gm.member_id and peer.status = 'activ'
       where application.id = p_application_id
         and gm.group_role = 'responsible'
    ) as recipient
    join public.group_applications as application on application.id = p_application_id
   where not private.group_muted_for(application.group_id, recipient.member_id);
$$;

comment on function private.group_application_recipients(bigint) is
  'Who hears that an Application was filed (#584, shape 3): private.group_managers of the Application''s Group — its own live Group Managers, else the nearest ancestor''s, else the path''s Group Responsibles plus every live BC/Moderator — union every live Group Responsible on that Group''s path, because accepting an Application is a Group Responsible''s power (ADR-0009 Entry paths) and whoever may decide must hear there is something to decide; minus a decider who unselected the Group in Grupuri preferate (R43, private.group_muted_for -- never a Manager or Responsible, whose position is never muted). Who may DECIDE is unchanged. One definition for both the filing fan-out and any later reader; no command carries an inline copy. Executable by no client role.';

CREATE OR REPLACE FUNCTION private.create_completed_work_request_impl(p_description text, p_group_id bigint)
 RETURNS completed_work_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor       uuid := (select auth.uid());
  v_description text;
  v_actor_name  text;
  v_request     public.completed_work_requests%rowtype;
begin
  if p_description is null or p_description !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'description_required';
  end if;
  v_description := regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  -- #673 (R8): measured as stored (trimmed).
  perform private.require_text_length('description', v_description, null, 2000);
  if p_group_id is null then
    raise sqlstate 'PT400' using message = 'invalid_origin';
  end if;
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'request_command_forbidden';
  end if;
  select coalesce(profile.nickname, profile.full_name) into v_actor_name
    from public.profiles as profile where profile.id = v_actor;
  if private.group_role_of(p_group_id, v_actor) is null
     or (select status from public.groups where id = p_group_id) is distinct from 'active' then
    raise exception using errcode = '42501', message = 'request_origin_forbidden';
  end if;
  -- Security pass L3: at most thirty Completed Work Requests per Member in
  -- any 24 hours, so a Member cannot flood the deciders with Notifications.
  perform private.require_daily_cap('completed_work_request', v_actor);
  insert into public.completed_work_requests (requester_id, group_id, description, status)
  values (v_actor, p_group_id, v_description, 'pending') returning * into v_request;
  -- R43: every decider may still decide (request_deciders is the authority);
  -- one who unselected the Request's Group is not told.
  perform private.notify(array(
      select decider
        from private.request_deciders(v_request.id) as decider
       where not private.group_muted_for(v_request.group_id, decider)),
    'task'::public.noti_kind, 'Cerere nouă: ' || left(v_description, 60),
    coalesce(v_actor_name, 'Un membru') || ' a trimis o cerere de muncă realizată.',
    null, 'request:' || v_request.id::text, v_actor, '/cereri');
  return v_request;
end;
$function$;

comment on function private.create_completed_work_request_impl(text, bigint) is
  'Files one pending Completed-work Request in one active Group where the live caller holds a Group Role or membership (private.group_role_of, 42501 request_origin_forbidden); the requester is auth.uid(), never a parameter. Notifies private.request_deciders without an actor echo, minus a decider who unselected the Request''s Group in Grupuri preferate (R43, private.group_muted_for); every decider may still decide it.';

-- ==================== 7. the command and the read ====================

create function private.set_unselected_groups_impl(p_group_ids bigint[])
returns bigint[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_ids    bigint[];
  v_id     bigint;
  v_result bigint[];
begin
  -- 1. Malformed for every caller.
  if p_group_ids is null or array_position(p_group_ids, null) is not null then
    raise sqlstate 'PT400' using message = 'invalid_group_ids';
  end if;
  select coalesce(array_agg(distinct id order by id), '{}') into v_ids
    from unnest(p_group_ids) as id;
  if cardinality(v_ids) > 500 then
    raise sqlstate 'PT400' using message = 'too_many_ids';
  end if;

  -- 2. Only a live BCE, BC or Moderator has Grupuri preferate (R43); the live
  --    Profile is held so a concurrent demotion or deactivation waits.
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or (select private.caller_level()) < 5 then
    raise exception using errcode = '42501', message = 'group_preference_forbidden';
  end if;
  perform 1 from public.profiles as profile
   where profile.id = v_actor and profile.status = 'activ'
     for share;

  -- 3. Every id names a Group the caller can see.
  foreach v_id in array v_ids loop
    if not exists (select 1 from public.groups as grp where grp.id = v_id)
       or not private.can_see_group(v_id, v_actor) then
      raise sqlstate 'PT404' using message = 'group_not_found';
    end if;
  end loop;

  -- 4. The Organization Group, the Adunarea Generala and Biroul de Conducere
  --    are always selected. A position lock is the caller's own and is not
  --    refused: the row is simply never read while the position stands.
  foreach v_id in array v_ids loop
    if private.group_preference_lock(v_id, v_actor) in ('organization', 'adunarea_generala', 'board') then
      raise sqlstate 'PT409' using message = 'group_preference_locked';
    end if;
  end loop;

  -- 5. One save at a time per Member, then the full-state replace.
  perform pg_advisory_xact_lock(hashtextextended('member_group_unselected:' || v_actor::text, 0));
  delete from public.member_group_unselected as unselected
   where unselected.member_id = v_actor
     and unselected.group_id <> all (v_ids);
  insert into public.member_group_unselected (member_id, group_id)
  select v_actor, id from unnest(v_ids) as id
  on conflict (member_id, group_id) do nothing;

  select coalesce(array_agg(unselected.group_id order by unselected.group_id), '{}')
    into v_result
    from public.member_group_unselected as unselected
   where unselected.member_id = v_actor;
  return v_result;
end;
$$;

comment on function private.set_unselected_groups_impl(bigint[]) is
  'Ruling R43: body of public.set_unselected_groups. Step 1: PT400 invalid_group_ids for a null array or a null element, PT400 too_many_ids above 500 distinct ids (duplicates are folded). Step 2: 42501 group_preference_forbidden unless the caller has organization claims and a live activ Profile at level >= 5 (held for share). Step 3: PT404 group_not_found for an id that is unknown or names a Group the caller cannot see (private.can_see_group). Step 4: PT409 group_preference_locked for the Organization Group, the Adunarea Generala or Biroul de Conducere (org_settings). Step 5: under a per-Member transaction advisory lock, replaces the caller''s member_group_unselected rows with exactly these ids -- an empty array selects every Group again -- and returns the stored ids, ascending.';

create function public.set_unselected_groups(p_group_ids bigint[])
returns bigint[]
language sql
security invoker
set search_path = ''
as $$
  select private.set_unselected_groups_impl(p_group_ids);
$$;

comment on function public.set_unselected_groups(bigint[]) is
  'Ruling R43 (Grupuri preferate): BCE, BC or the Moderator saves the whole set of Groups they unselected; every other Group is selected. Explicit per Group: the app sends a parent''s subgroups with it when it unselects the parent, and a subgroup alone when only that one is unselected. An unselected Group sends its Member no Notification and no push and leaves the Anunturi badge -- except where they hold a position, critical Announcements, and their own work. Errors: PT400 invalid_group_ids / too_many_ids, 42501 group_preference_forbidden, PT404 group_not_found, PT409 group_preference_locked. Returns the stored ids. Body: private.set_unselected_groups_impl.';

create function private.my_group_preferences_impl()
returns table(group_id bigint, selected boolean, locked text)
language sql
stable
security definer
set search_path = ''
as $$
  select grp.id,
         not private.group_muted_for(grp.id, (select auth.uid())),
         private.group_preference_lock(grp.id, (select auth.uid()))
    from public.groups as grp
   where public.auth_is_member()
     and (select private.caller_level()) >= 5
     and private.can_see_group(grp.id, (select auth.uid()))
   order by grp.id;
$$;

comment on function private.my_group_preferences_impl() is
  'Ruling R43: body of public.my_group_preferences. For a live caller at level >= 5 with organization claims, one row per Group they can see (private.can_see_group), archived ones included: selected is false exactly where private.group_muted_for holds for them, and locked names why the Group cannot be unselected (private.group_preference_lock: organization, adunarea_generala, board, position) or is null. No rows for anyone else.';

create function public.my_group_preferences()
returns table(group_id bigint, selected boolean, locked text)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.my_group_preferences_impl();
$$;

comment on function public.my_group_preferences() is
  'Ruling R43 (Grupuri preferate): the caller''s preference for every Group they can see -- selected, and locked (organization, adunarea_generala, board, position, or null) -- so Profil draws the tree and Taskuri, Calendar, Anunturi and Clasament open on the selected Groups. Empty below level 5: the preference does not exist for them. Body: private.my_group_preferences_impl.';

revoke execute on function private.set_unselected_groups_impl(bigint[])
  from public, anon, authenticated, service_role;
revoke execute on function public.set_unselected_groups(bigint[])
  from public, anon, authenticated, service_role;
revoke execute on function private.my_group_preferences_impl()
  from public, anon, authenticated, service_role;
revoke execute on function public.my_group_preferences()
  from public, anon, authenticated, service_role;
grant execute on function private.set_unselected_groups_impl(bigint[]) to authenticated;
grant execute on function public.set_unselected_groups(bigint[]) to authenticated;
grant execute on function private.my_group_preferences_impl() to authenticated;
grant execute on function public.my_group_preferences() to authenticated;

-- ==================== 8. Clasament on the preferred Groups ====================
-- A trailing optional argument changes the signature, and an overload would make
-- PostgREST's call ambiguous (PGRST203): drop both, then recreate with p_preferred.

drop function public.leadership_leaderboard(bigint, bigint, timestamptz, timestamptz);
drop function private.leadership_leaderboard_impl(bigint, bigint, timestamptz, timestamptz);

create function private.leadership_leaderboard_impl(
  p_group_id bigint, p_campaign_id bigint, p_from timestamptz, p_to timestamptz, p_preferred boolean)
returns table(member_id uuid, full_name text, nickname text, points integer, rank integer)
language sql
stable
security definer
set search_path = ''
as $$
  select private.require_date_range(p_from, p_to);

  with gate as (
    -- One row for a live, active BCE+ caller; none otherwise, which empties
    -- both branches below (no rows, never an error).
    select 1 as allowed
     where public.auth_level() >= 5
       and (select private.caller_level()) >= 5
       and exists (
         select 1
           from public.profiles as caller
          where caller.id = (select auth.uid())
            and caller.status = 'activ'
       )
  ),
  task_points as (
    select entry.member_id as member_id,
           sum(entry.delta)::int as points
      from gate
     cross join public.points_ledger as entry
      join public.task_evaluations as evaluation on evaluation.id = entry.evaluation_id
      join public.tasks as task on task.id = entry.task_id
      join public.groups as task_group on task_group.id = task.group_id
     where entry.reason in ('task', 'task_reversal')
       and (p_group_id is null or task_group.path @> array[p_group_id])
       and (p_campaign_id is null or task.campaign_id = p_campaign_id)
       and (p_from is null or evaluation.evaluated_at >= p_from)
       and (p_to is null or evaluation.evaluated_at < p_to)
       -- R43: the preferred view counts only the Tasks of the caller's selected
       -- Groups (the Task's own Group).
       and (not coalesce(p_preferred, false)
            or not private.group_muted_for(task.group_id, (select auth.uid())))
     group by entry.member_id
  ),
  roster as (
    -- Unfiltered: every active Member.
    select member.id as member_id
      from gate
     cross join public.profiles as member
     where p_group_id is null
       and member.status = 'activ'
    union
    -- A Group filter: the active members of that Group's subtree (#929, R32) --
    -- roster rows, Automatic Membership and the membri de drept, from the one
    -- member set. The Role filter below keeps BCE, BC and the Moderator out.
    select member_set.member_id
      from gate
     cross join public.groups as roster_group
     cross join lateral private.group_member_set(roster_group.id) as member_set
      join public.profiles as member on member.id = member_set.member_id
     where p_group_id is not null
       and roster_group.path @> array[p_group_id]
       and member.status = 'activ'
  ),
  board as (
    select roster.member_id from roster
    union
    select task_points.member_id from task_points
  )
  select member.id,
         member.full_name,
         member.nickname,
         coalesce(scored.points, 0),
         rank() over (order by coalesce(scored.points, 0) desc)::int
    from board
    join public.profiles as member on member.id = board.member_id
    left join task_points as scored on scored.member_id = board.member_id
   -- #907 (amending ruling 1 of 2026-09-28, #843): only the Roles below BCE
   -- are ranked. rank() runs after this filter, so the ranks stay contiguous
   -- without BCE, BC and the Moderator.
   where member.role in ('recrut', 'voluntar', 'activ', 'vot')
   order by coalesce(scored.points, 0) desc, member.full_name asc;
$$;

comment on function private.leadership_leaderboard_impl(bigint, bigint, timestamptz, timestamptz, boolean) is
  'Group-subtree Leaderboard body. Rows are every active Member below BCE (Recrut, Voluntar, Voluntar Activ, Voluntar cu Drept de Vot) -- with a Group filter, the active members of that Group''s subtree by private.group_member_set (roster rows and Automatic Membership, so the Adunarea Generala lists its level-3 Members, #929) -- plus every Member below BCE who earned Task Points under the filter, whatever their status (#907). BCE, BC and the Moderator are never rows, whatever the filter. Points follow the Task Group, never the Member roster; Cup participation settings do not restrict the board; a Campaign or a date range narrows the points, never the Members. The date range (#677) reads the award instant -- task_evaluations.evaluated_at through points_ledger.evaluation_id, for a credit and its reversal alike -- half-open [p_from, p_to); PT400 invalid_date_range first when p_to < p_from. p_preferred (R43, Grupuri preferate) counts only the points of Tasks whose own Group the caller has not unselected (private.group_muted_for); the Members listed are unchanged.';

create function public.leadership_leaderboard(
  p_group_id bigint default null,
  p_campaign_id bigint default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_preferred boolean default false)
returns table(member_id uuid, full_name text, nickname text, points integer, rank integer)
language sql
stable
set search_path = ''
as $$
  select *
    from private.leadership_leaderboard_impl(
           p_group_id, p_campaign_id, p_from, p_to, p_preferred)
   order by points desc, full_name asc;
$$;

comment on function public.leadership_leaderboard(bigint, bigint, timestamptz, timestamptz, boolean) is
  'Live BCE+ Task-points Leaderboard filtered by Group subtree, Campaign and award date range (#677: [p_from, p_to) on the Evaluation instant, either bound optional; PT400 invalid_date_range when p_to < p_from). Lists every active Member below BCE, at 0 points when they earned nothing (with a Group filter, the Members of that Group''s subtree), and retains inactive earners (#907). Never ranks BCE, BC or the Moderator (ruling 1 of 2026-09-28, amended by #907). Zero/negative totals, shared ranks on ties, and stable points-descending/name ordering. Returns the Nickname beside the full name. p_preferred (R43) counts only the points earned in the Groups the caller keeps selected in Grupuri preferate.';

revoke execute on function private.leadership_leaderboard_impl(bigint, bigint, timestamptz, timestamptz, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function public.leadership_leaderboard(bigint, bigint, timestamptz, timestamptz, boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.leadership_leaderboard_impl(bigint, bigint, timestamptz, timestamptz, boolean)
  to authenticated;
grant execute on function public.leadership_leaderboard(bigint, bigint, timestamptz, timestamptz, boolean)
  to authenticated;
