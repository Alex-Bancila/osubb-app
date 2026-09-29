-- #929 (ruling R32, Alex 2026-09-29): one definition of "the members of Group G",
-- and no membership Notifications for BC and the Moderator.
--
-- The members of a Group are
--   * its roster: every group_members row (any Group Role, any Membership Status --
--     deactivation never edits a roster, R22);
--   * with Automatic Membership, every active Member whose live level is at or above
--     the Group's Minimum Level (the Adunarea Generala at level 3, the Organization
--     Group at level 0);
--   * every active BC member and Moderator ("a BC manages all groups, and are by
--     default a member of all groups"): the membri de drept.
-- private.group_member_set answers it once, with each Member's source (roster >
-- board > automatic), and every reader uses it:
--   * public.group_roster -- the rosters and counts of Administrare > Grupuri and
--     the Group page, and the Voluntari Group filter;
--   * private.leadership_leaderboard_impl's Group filter (#907), so filtering the
--     Clasament by the Adunarea Generala lists its members below BCE (BC and the
--     Moderator stay outside the ranking by Role, never by roster);
--   * private.group_audience, the Group Audience (CONTEXT.md): the set WITHOUT the
--     board branch over a Group's subtree -- exactly the set it has always been, so
--     every authority rule and RLS read that consults it (announcement visibility,
--     the Completed-work Group gate of R31) is unchanged.
--
-- Notifications: BC and the Moderator get no Task, Event or Announcement
-- Notification that comes from Group membership, Group Audience or Group
-- management. private.group_notification_audience is the Group Audience minus every
-- live BC member and Moderator; the Announcement fan-out, the Event change and
-- cancellation recipients (and the old Group's audience on a move) and the
-- Announcement readers list use it. private.task_managers no longer names BC or the
-- Moderator as a Manager of the Task's Group, and its last-resort "every live
-- BC/Moderator" fallback (Ruling 24) is gone: with no live Manager or peer
-- Responsible on the path, nobody is notified and the Task waits in the review
-- queue BC already sees. A Task a BC member or the Moderator created or executes
-- still notifies them (it is theirs personally), as do an Event they said going
-- to, Applications and Completed-work Requests to decide, Promotion Candidates and
-- Retention Signals, Role changes, push health and the Privacy Notice. The Anunturi
-- badge never counts an Announcement for them.
--
-- Authority and RLS are unchanged: every function below is new, a Notification
-- recipient set, or a read whose visibility gate restates an existing policy.
-- Rebuilt from main's latest bodies: update_event_impl (20260928100000),
-- announcement_readers_impl (20260929170000), task_managers (20260919184521),
-- event_notification_recipients (20260924132724), fan_out_announcement
-- (20260928120000), leadership_leaderboard_impl (20260929160000),
-- my_unread_announcements_count (20260924025855) and group_audience
-- (20260922132035).

-- ==================== the member set ====================

create function private.group_member_set(p_group_id bigint, p_with_board boolean default true)
returns table (member_id uuid, source text)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select grp.id, grp.automatic_membership, grp.min_level
      from public.groups as grp
     where grp.id = p_group_id
  ),
  roster as (
    select membership.member_id
      from target
      join public.group_members as membership on membership.group_id = target.id
  ),
  board as (
    select profile.id as member_id
      from target
     cross join public.profiles as profile
      join public.roles as role on role.id = profile.role
     where p_with_board
       and profile.status = 'activ'
       and role.level >= 6
       and not exists (select 1 from roster where roster.member_id = profile.id)
  ),
  automatic as (
    select profile.id as member_id
      from target
      join public.profiles as profile on profile.status = 'activ'
      join public.roles as role on role.id = profile.role
                               and role.level >= target.min_level
     where target.automatic_membership
       and not exists (select 1 from roster where roster.member_id = profile.id)
       and not exists (select 1 from board where board.member_id = profile.id)
  )
  select roster.member_id, 'roster'::text from roster
  union all
  select board.member_id, 'board'::text from board
  union all
  select automatic.member_id, 'automatic'::text from automatic;
$$;

comment on function private.group_member_set(bigint, boolean) is
  'The members of Group p_group_id (#929, ruling R32), one row per Member with the source that puts them there, in precedence order: ''roster'' -- every group_members row, whatever the Group Role or Membership Status (R22: deactivation never edits a roster); ''board'' -- every activ BC member and Moderator (level >= 6) not on the roster, the membri de drept of every Group; ''automatic'' -- with Automatic Membership, every activ Member at or above the Group''s Minimum Level reached by neither branch. p_with_board = false drops the board branch, so a BC member or Moderator then appears only by roster or Automatic Membership: the set private.group_audience has always used, which keeps every authority and RLS read unchanged. The Group itself only, never its subtree; an unknown id yields nothing. Internal: executable by no client role.';

revoke execute on function private.group_member_set(bigint, boolean)
  from public, anon, authenticated, service_role;

-- group_audience, rebuilt from 20260922132035 on the member set: the same subtree,
-- the same archived rule and the same two branches (roster rows of activ Members,
-- Automatic Membership), now asked of private.group_member_set without its board
-- branch rather than restated here.
create or replace function private.group_audience(p_group_id bigint)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- The subtree: p_group_id itself and every Group below it (path contains p_group_id),
  -- minus any Group that is archived or sits below an archived Group -- judged only on
  -- the part of the path AFTER p_group_id. p_group_id's own status (and its ancestors')
  -- is not read: Events on an archived Group are the commands' business.
  with subtree as (
    select grp.id
      from public.groups as grp
     where grp.path @> array[p_group_id]
       and not exists (
         select 1
           from public.groups as between_grp
          where between_grp.id = any (grp.path[array_position(grp.path, p_group_id) + 1:])
            and between_grp.status = 'archived')
  )
  -- The members of every Group of the subtree without the board branch (#929):
  -- roster rows and Automatic Membership, activ Members only.
  select distinct member_set.member_id
    from subtree
   cross join lateral private.group_member_set(subtree.id, false) as member_set
    join public.profiles as profile on profile.id = member_set.member_id
                                    and profile.status = 'activ';
$$;

comment on function private.group_audience(bigint) is
  'The Group Audience of p_group_id (CONTEXT.md, ADR-0009, #601): the distinct activ Members of p_group_id and of every Group below it, by roster row (any Group Role) or by Automatic Membership -- private.group_member_set without its board branch (#929), so a BC member or Moderator is in it only through a roster row or Automatic Membership, exactly as before ruling R32. Never an inactive Member; an unknown id yields the empty set. A Group below p_group_id that is archived, or that sits below an archived Group, contributes nobody; p_group_id''s own status is not read. Read by the announcement visibility predicate and the Completed-work Group gate (unchanged by #929), and through private.group_notification_audience by every Notification fan-out. Internal: executable by no client role.';

-- ==================== the audience Notifications reach ====================

create function private.group_notification_audience(p_group_id bigint)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- #929 (R32): BC and the Moderator get no Notification through membership.
  select audience.member_id
    from private.group_audience(p_group_id) as audience(member_id)
   where coalesce(private.actor_level(audience.member_id), -1) < 6;
$$;

comment on function private.group_notification_audience(bigint) is
  'The Group Audience a Notification reaches (#929, ruling R32): private.group_audience(p_group_id) minus every live BC member and Moderator (level >= 6), who receive no Task, Event or Announcement Notification through Group membership, Group Audience or Group management. Used by the Announcement fan-out and readers list, the Event change and cancellation recipients, and update_event_impl''s old-Group audience on a move. Internal: executable by no client role.';

revoke execute on function private.group_notification_audience(bigint)
  from public, anon, authenticated, service_role;

-- ==================== the roster read ====================

create function private.group_roster_impl(p_group_id bigint)
returns table (
  group_id       bigint,
  member_id      uuid,
  source         text,
  group_role     text,
  position_title text,
  joined_at      timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Visibility restates group_members_read, applied to every row of the member set:
  -- the caller's own membership, the whole set for BCE+, or the set of a Group whose
  -- roster they may read (a Manager or Responsible on its path) -- always only in a
  -- Group they can see (#756). The Group-level half is judged once per Group, before
  -- any member set is computed, so a Group the caller cannot see costs nothing.
  with visible as materialized (
    select grp.id,
           ((select private.caller_level()) >= 5
            or private.can_read_group_roster(grp.id)) as whole_roster
      from public.groups as grp
     where (p_group_id is null or grp.id = p_group_id)
       and public.auth_is_member()
       and private.can_see_group(grp.id, (select auth.uid()))
  )
  select visible.id,
         member_set.member_id,
         member_set.source,
         membership.group_role,
         membership.position_title,
         membership.created_at
    from visible
   cross join lateral private.group_member_set(visible.id) as member_set
    left join public.group_members as membership
      on membership.group_id = visible.id
     and membership.member_id = member_set.member_id
   where visible.whole_roster
      or (member_set.member_id = (select auth.uid()) and (select private.caller_level()) >= 0)
   order by visible.id, member_set.member_id;
$$;

comment on function private.group_roster_impl(bigint) is
  'Body of public.group_roster (#929): the members of one Group (p_group_id) or of every Group (null), from private.group_member_set, each with its source (roster, board, automatic) and, for a roster row, its Group Role, position title and joined_at. Every row passes group_members_read''s own rule -- organization claims, a Group the caller can see, and the caller''s own row, a BCE+ caller, or a Group whose roster the caller may read -- so it shows nobody the roster policy would hide.';

create function public.group_roster(p_group_id bigint default null)
returns table (
  group_id       bigint,
  member_id      uuid,
  source         text,
  group_role     text,
  position_title text,
  joined_at      timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.group_roster_impl(p_group_id);
$$;

comment on function public.group_roster(bigint) is
  'The members of a Group (#929, ruling R32) -- its roster, its Automatic Membership, and every active BC member and Moderator as membri de drept -- one row per Member with its source, for one Group or (null) every Group, under the group_members_read rule. Powers the rosters and counts of Administrare > Grupuri and the Group page, and the Voluntari Group filter.';

revoke execute on function private.group_roster_impl(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.group_roster(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.group_roster_impl(bigint) to authenticated;
grant execute on function public.group_roster(bigint) to authenticated;

-- ==================== the Clasament Group filter ====================
-- Rebuilt from 20260929160000_clasament_every_member.sql. The one change is the
-- roster branch of a Group filter: the members of every Group of the subtree, from
-- private.group_member_set, instead of the explicit rows of its non-automatic
-- Groups -- so the Adunarea Generala lists every Member at level 3 and above. BC and
-- the Moderator come in through the member set and go out through the unchanged
-- Role filter, like BCE: a Group filter never ranks them.

create or replace function private.leadership_leaderboard_impl(
  p_group_id bigint,
  p_campaign_id bigint,
  p_from timestamptz,
  p_to timestamptz
)
returns table (member_id uuid, full_name text, nickname text, points integer, rank integer)
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

comment on function private.leadership_leaderboard_impl(bigint, bigint, timestamptz, timestamptz) is
  'Group-subtree Leaderboard body. Rows are every active Member below BCE (Recrut, Voluntar, Voluntar Activ, Voluntar cu Drept de Vot) -- with a Group filter, the active members of that Group''s subtree by private.group_member_set (roster rows and Automatic Membership, so the Adunarea Generala lists its level-3 Members, #929) -- plus every Member below BCE who earned Task Points under the filter, whatever their status (#907). BCE, BC and the Moderator are never rows, whatever the filter. Points follow the Task Group, never the Member roster; Cup participation settings do not restrict the board; a Campaign or a date range narrows the points, never the Members. The date range (#677) reads the award instant -- task_evaluations.evaluated_at through points_ledger.evaluation_id, for a credit and its reversal alike -- half-open [p_from, p_to); PT400 invalid_date_range first when p_to < p_from.';

-- ==================== Task Manager recipients ====================
-- Rebuilt from 20260919184521_task_authority_on_groups.sql. The creator branch is
-- unchanged -- a Task a BC member or the Moderator created is theirs personally.
-- The Group branch drops every BC member and Moderator (R32: no Task Notification
-- through Group management), and the "every live BC/Moderator" last resort of
-- Ruling 24 goes with it.

create or replace function private.task_managers(p_task_id bigint, p_actor uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_created_by uuid;
  v_group_id   bigint;
  v_recipients uuid[];
begin
  select task.created_by, task.group_id into v_created_by, v_group_id
    from public.tasks as task where task.id = p_task_id;
  if not found then
    return;
  end if;
  -- The Task Manager is the creator (ADR-0007), while live and not the actor.
  if v_created_by is not null and v_created_by is distinct from p_actor
     and exists (select 1 from public.profiles as creator
                  where creator.id = v_created_by and creator.status = 'activ') then
    return next v_created_by;
    return;
  end if;
  -- Else the Group's Managers, then the nearest ancestor's, then the chain's peer
  -- Responsibles -- minus the actor and, since #929 (R32), minus every live BC member
  -- and Moderator, who hear of no Task through Group management. Nobody left means
  -- nobody is notified: the Task waits in the review queue BC and the Moderator see.
  select array_agg(manager) into v_recipients
    from private.group_managers(v_group_id) as manager
   where manager is distinct from p_actor
     and coalesce(private.actor_level(manager), -1) < 6;
  return query select unnest(coalesce(v_recipients, '{}'::uuid[]));
end;
$$;

comment on function private.task_managers(bigint, uuid) is
  'ADR-0009, #929 (R32): the live Task creator unless acting; else the nearest Group Managers, or the chain''s peer Responsibles when no Manager exists, excluding the actor and every live BC member and Moderator. An empty set notifies nobody (Ruling 24''s BC fallback is retired): BC and the Moderator get Task Notifications only for a Task they created or execute.';

-- ==================== Event recipients ====================
-- Rebuilt from 20260924132724_private_groups.sql: the Group Audience part is the one
-- Notifications reach. The going attendees stay whoever they are -- a BC member's own
-- "going" is theirs personally.

create or replace function private.event_notification_recipients(p_event_id bigint)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select candidate.member_id
    from public.events as event
    cross join lateral (
      select audience.member_id
        from private.group_notification_audience(event.group_id) as audience(member_id)
      union
      select attendance.member_id
        from public.event_attendance as attendance
       where attendance.event_id = event.id and attendance.status = 'going'
    ) as candidate
   where event.id = p_event_id
     and private.can_read_event(event.group_id, event.min_level, candidate.member_id);
$$;

comment on function private.event_notification_recipients(bigint) is
  'The audience for an Event Notification (#248, #601, #929): the Group Audience of the Event''s Group that Notifications reach (private.group_notification_audience -- roster rows on the Group and every non-archived Group below it plus Automatic Membership, minus every live BC member and Moderator, ruling R32) together with the Members who said going on it, de-duplicated, then filtered through private.can_read_event -- the events_read rule, Private Groups included -- so nobody who cannot read the Event is told about it. A BC member or Moderator is reached only as a going attendee. private.notify drops the actor.';

-- ==================== Event update ====================
-- update_event_impl, rebuilt from its live definition on main (last written by
-- 20260928100000_notification_links.sql): the one change is the old Group's audience on a
-- move, now the audience Notifications reach.

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
  -- #582: the Organization is the Group carrying the marker.
  if exists (select 1 from public.groups where id = v_event.group_id and is_organization) then
    if v_event.created_by is distinct from v_actor and v_level < 6 then
      raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
    end if;
  else
    begin
      perform private.require_group_work_manager(v_event.group_id);
    exception when insufficient_privilege then
      raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
    end;
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
$function$

;

-- announcement_readers_impl, rebuilt from its live definition on main (last written by
-- 20260929170000_announcement_deadline.sql): the readers
-- are the fan-out's recipients, so a BC member or Moderator is never an unread reader.

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
begin
  select announcement.group_id, announcement.audience, announcement.created_by, announcement.min_level
    into v_group_id, v_audience, v_created_by, v_min_level
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
      -- #929 (R32): the Announcement's Notification recipients -- no BC or Moderator,
      -- who is never notified of it through membership, so never an unread reader.
      from private.group_notification_audience(v_audience_group) as recipient(member_id)
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

-- ==================== Announcements ====================
-- Rebuilt from 20260928120000_audit_d_server_fixes.sql: the recipients are the
-- Group Audience Notifications reach, so no BC member or Moderator is notified of an
-- Announcement through membership. The author's own read row still asks the
-- announcements_read rule, which reads private.group_audience unchanged.

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
begin
  v_actor := coalesce((select auth.uid()), new.created_by);
  if new.audience = 'org' then
    select id into v_audience_group from public.groups where is_organization;
  else
    v_audience_group := new.group_id;
  end if;

  -- #929 (R32): never a BC member or the Moderator, through membership.
  select array_agg(recipient.member_id order by recipient.member_id)
    into v_recipients
    from private.group_notification_audience(v_audience_group) as recipient(member_id)
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
    new.priority = 'critical');

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

-- The Anunturi badge (#693), rebuilt from 20260924025855_announcement_readers.sql:
-- zero for a live BC member or Moderator, whom no Announcement reaches through
-- membership (#929, R32). Still invoker, so announcements_read decides the rows
-- for everyone else.
create or replace function public.my_unread_announcements_count()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer
    from public.announcements as announcement
   where (select private.caller_level()) < 6
     and not exists (
       select 1
         from public.announcement_reads as reads
        where reads.announcement_id = announcement.id
          and reads.member_id = (select auth.uid()));
$$;

comment on function public.my_unread_announcements_count() is
  'The caller''s unread Announcements for the Anunțuri badge (#693, R15): rows announcements_read lets them see, minus those with their own announcement_reads row. Zero without organization claims, and zero for a live BC member or Moderator, whom no Announcement reaches through membership (#929, ruling R32).';

comment on function private.announcement_readers_impl(bigint) is
  'Readers list body (#693, R15). The Announcement''s Notification recipients -- private.group_notification_audience of the Origin for local, of the Organization Group for org (the Group Audience minus every live BC member and Moderator, #929), the same set #68''s fan-out addresses -- left-joined to announcement_reads, read_at null when unread, newest read first. Callable by the author, BC/Moderator (level >= 6), and for a local Audience the Origin''s Managers and Responsibles including ancestors''; everyone else, and a missing row, gets PT404 announcement_not_found.';

-- update_event_impl's comment names the old helper; keep the rest of it verbatim.
do $$
declare
  v_old text := obj_description('private.update_event_impl(bigint,text,text,bigint,timestamptz,timestamptz,text,integer,text,integer,bigint)'::regprocedure, 'pg_proc');
  v_new text;
begin
  v_new := replace(v_old,
    'the new Group''s Group Audience (private.group_audience, #601), plus the old Group''s Group Audience when the Event moved',
    'the new Group''s Group Audience as Notifications reach it (private.group_notification_audience: #601, minus every live BC member and Moderator, #929), plus the old Group''s when the Event moved');
  if v_new = v_old then
    raise exception 'update_event_impl comment: expected text not found';
  end if;
  execute format('comment on function private.update_event_impl(bigint,text,text,bigint,timestamptz,timestamptz,text,integer,text,integer,bigint) is %L', v_new);
end;
$$;
