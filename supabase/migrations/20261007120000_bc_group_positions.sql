-- Ruling R42 (2026-10-07): BC may hold either Group position, and a position brings
-- its notices. Alex: "I want to be able to add a BC member as a coordinator and
-- responsabil of a group/subgroup".
--
-- R32 (#929, #941) kept every live BC member and the Moderator out of the Task, Event
-- and Announcement Notifications that come through Group membership, Group Audience
-- or Group management -- a BC member's roster row never counted. R42 amends it for a
-- BC member who HOLDS A POSITION: a Manager or Responsible roster row on Group G, or
-- on a Group above G, brings G's notices exactly as it does for anyone else. The rest
-- of R32 stands:
--   * a BC member who is only a membru de drept of G (the board branch of
--     private.group_member_set), or who sits on G's roster as a plain member, gets
--     nothing through G;
--   * the Moderator holds no position (R42) and gets nothing through any Group,
--     whatever rows exist;
--   * the actor is never told (private.notify drops them; private.task_managers drops
--     them itself).
--
-- 1. private.board_position_holders(g), new: the live BC members holding a Manager or
--    Responsible row on g or on a Group of g's path -- the one definition of "a BC
--    member whose position reaches g".
-- 2. private.group_notification_audience(g): the Group Audience below BC, as before,
--    plus private.board_position_holders(g). It feeds the Announcement fan-out and the
--    readers list, private.event_notification_recipients (Event creation R39, change,
--    cancellation) and update_event_impl's old-Group audience on a move, so all of
--    them follow without being rebuilt.
-- 3. private.task_managers: a BC member's Manager row is a live Manager like anyone
--    else's -- it stops the upward walk and is notified -- and a BC peer Responsible is
--    a peer. Only roster rows count (the membri de drept are never read), the
--    Moderator's rows never count, the actor is never a recipient.
-- 4. private.fan_out_announcement and private.announcement_readers_impl: an
--    organization-wide Announcement's Origin is still its Group's own Announcement,
--    so it also reaches (and lists as readers) the BC position holders of its Origin;
--    a local one already does through (2).
-- 5. public.my_unread_announcements_count: for a live BC member, the unread
--    Announcements whose Origin their position reaches -- exactly the ones (4)
--    notified them of. Still zero for the Moderator.
--
-- Applications and Completed-work Requests need no change: their decider sets
-- (private.group_application_recipients, private.work_deciders) never excluded BC.
-- Authority and RLS are unchanged: the server never refused BC in a position.
--
-- Rebuilt from main's latest bodies: group_notification_audience, fan_out_announcement,
-- announcement_readers_impl and my_unread_announcements_count (all
-- 20260929200000_group_member_set.sql), task_managers
-- (20260929230000_task_managers_nearest_above.sql).

-- ==================== 1. the BC position holders ====================

create function private.board_position_holders(p_group_id bigint)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- Level 6 is BC. The Moderator (level 9) holds no Group position (R42), so a
  -- Moderator's roster row never brings a notice.
  select distinct held.member_id
    from public.groups as target
    join public.group_members as held
      on target.path @> array[held.group_id]
     and held.group_role in ('manager', 'responsible')
    join public.profiles as holder on holder.id = held.member_id
                                  and holder.status = 'activ'
    join public.roles as role on role.id = holder.role
                             and role.level = 6
   where target.id = p_group_id;
$$;

comment on function private.board_position_holders(bigint) is
  'Ruling R42: the activ BC members (level 6) who hold a Group position -- a Manager or Responsible roster row -- on p_group_id or on a Group above it (groups.path), so that position brings p_group_id''s notices as it would for anyone. Only roster rows count: a BC member who is a membru de drept or a plain member here is not in it (R32). Never the Moderator, who holds no position. An unknown id yields nothing. Internal: executable by no client role.';

revoke execute on function private.board_position_holders(bigint)
  from public, anon, authenticated, service_role;

-- ==================== 2. the audience Notifications reach ====================

create or replace function private.group_notification_audience(p_group_id bigint)
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

comment on function private.group_notification_audience(bigint) is
  'The Group Audience a Notification reaches (#929, ruling R32, amended by R42): private.group_audience(p_group_id) minus every live BC member and Moderator (level >= 6), plus the BC members whose Manager or Responsible position is on p_group_id or a Group above it (private.board_position_holders). So a BC member hears of a Group''s Tasks, Events and Announcements through a position, never through membership alone; the Moderator never. Used by the Announcement fan-out and readers list, the Event creation, change and cancellation recipients, and update_event_impl''s old-Group audience on a move. Internal: executable by no client role.';

-- ==================== 3. Task Manager recipients ====================

create or replace function private.task_managers(p_task_id bigint, p_actor uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_created_by uuid;
  v_path       bigint[];
  v_managers   uuid[];
begin
  select task.created_by, grp.path into v_created_by, v_path
    from public.tasks as task
    left join public.groups as grp on grp.id = task.group_id
   where task.id = p_task_id;
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
  if v_path is null then
    return;
  end if;
  -- Else the nearest Group on the path, the Task's own first, with a live Manager
  -- (#941). Since R42 a BC member's Manager row counts like anyone's: it stops the
  -- walk and is notified. The Moderator holds no position, so their rows never count
  -- (level 9 is the only rank above BC). The actor is dropped from the recipients but
  -- still marks the Group as managed.
  for v_depth in reverse cardinality(v_path) .. 1 loop
    select array_agg(gm.member_id) into v_managers
      from public.group_members as gm
      join public.profiles as manager on manager.id = gm.member_id and manager.status = 'activ'
      join public.roles as role on role.id = manager.role
     where gm.group_id = v_path[v_depth]
       and gm.group_role = 'manager'
       and role.level <= 6;
    if v_managers is not null then
      return query
        select manager from unnest(v_managers) as manager
         where manager is distinct from p_actor;
      return;
    end if;
  end loop;
  -- No Manager anywhere on the path (ruling D4, "peers manage, BC evaluates"): the
  -- chain's live peer Responsibles, a BC Responsible included (R42), never the
  -- Moderator, minus the actor. Nobody left means nobody is notified.
  return query
    select distinct gm.member_id
      from public.group_members as gm
      join public.profiles as peer on peer.id = gm.member_id and peer.status = 'activ'
      join public.roles as role on role.id = peer.role
     where v_path @> array[gm.group_id]
       and gm.group_role = 'responsible'
       and role.level <= 6
       and gm.member_id is distinct from p_actor;
end;
$$;

comment on function private.task_managers(bigint, uuid) is
  'ADR-0009, #929 (R32), #941, R42: the live Task creator unless acting; else the Managers of the nearest Group on the Task''s path (its own Group first, then each ancestor up to the root) that has a live Manager, minus the actor; else the chain''s live peer Responsibles, minus the actor; else nobody. Only roster rows count: a BC member''s Manager or Responsible row counts like anyone''s (R42), the Moderator''s never does, and the membri de drept are never added.';

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
begin
  v_actor := coalesce((select auth.uid()), new.created_by);
  if new.audience = 'org' then
    select id into v_audience_group from public.groups where is_organization;
  else
    v_audience_group := new.group_id;
  end if;

  -- #929 (R32): never a BC member or the Moderator through membership; R42: a BC
  -- member whose position reaches the audience Group or, for an organization-wide
  -- Announcement, its Origin -- it is still that Group's Announcement.
  select array_agg(recipient.member_id order by recipient.member_id)
    into v_recipients
    from (select audience.member_id
            from private.group_notification_audience(v_audience_group) as audience(member_id)
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

comment on function private.fan_out_announcement() is
  'Broadcasts one in-app Notification per recipient after an Announcement insert (#68), keyed announcement:<id> (#861) so reading the Announcement marks it read. The recipients are the Group Audience Notifications reach (private.group_notification_audience) of the Origin for a local Audience and of the Organization Group for an org Audience -- no BC member or Moderator through membership (#929, R32) -- plus the BC members whose Group position reaches the Origin (private.board_position_holders, R42), for either Audience. The data-driven notif_suppression lookup filters broadcast kinds, then Private Group visibility (#756) and the Minimum Level (#909), before private.notify removes duplicates, inactive recipients and the actual authenticated actor (or created_by for server-side inserts). Task notifications remain direct and unsuppressed. It also writes the author''s own announcement_reads row when the author is in the Announcement''s read audience (the announcements_read rule judged for created_by, #861), so the author''s own Announcement never counts as unread.';

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
      -- #929 (R32), R42: the Announcement's Notification recipients, the same set
      -- private.fan_out_announcement addresses -- no BC member or Moderator through
      -- membership, a BC member whose position reaches the Origin.
      from (select audience.member_id
              from private.group_notification_audience(v_audience_group) as audience(member_id)
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
  'Readers list body (#693, R15). The Announcement''s Notification recipients, the same set #68''s fan-out addresses -- private.group_notification_audience of the Origin for local, of the Organization Group for org (the Group Audience minus every live BC member and Moderator, #929, plus the BC members whose position reaches it, R42), together with the BC members whose position reaches the Origin (private.board_position_holders, R42) -- left-joined to announcement_reads, read_at null when unread, newest read first. Callable by the author, BC/Moderator (level >= 6), and for a local Audience the Origin''s Managers and Responsibles including ancestors''; everyone else, and a missing row, gets PT404 announcement_not_found.';

-- ==================== 5. the Anunturi badge ====================
-- Still invoker, so announcements_read decides the rows. A live BC member reads every
-- Group and roster row (level >= 5), so the position test below sees what
-- private.board_position_holders sees.

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
     and not exists (
       select 1
         from public.announcement_reads as reads
        where reads.announcement_id = announcement.id
          and reads.member_id = (select auth.uid()));
$$;

comment on function public.my_unread_announcements_count() is
  'The caller''s unread Announcements for the Anunțuri badge (#693, R15): rows announcements_read lets them see, minus those with their own announcement_reads row. Zero without organization claims. A live BC member counts only the Announcements whose Origin their Manager or Responsible position reaches (R42), the ones the fan-out notified them of; the Moderator, whom no Announcement reaches through membership (#929, ruling R32), counts none.';

-- ==================== comments that name the R32 rule ====================

do $$
declare
  v_old text;
  v_new text;
begin
  v_old := obj_description('private.event_notification_recipients(bigint)'::regprocedure, 'pg_proc');
  v_new := replace(v_old,
    'minus every live BC member and Moderator, ruling R32)',
    'minus every live BC member and Moderator, ruling R32, plus the BC members whose Group position reaches the Event''s Group, R42)');
  if v_new = v_old then
    raise exception 'event_notification_recipients comment: expected text not found';
  end if;
  v_new := replace(v_new,
    'A BC member or Moderator is reached only as a going attendee.',
    'A BC member is reached through a position on the Event''s Group or a Group above it, or as a going attendee; the Moderator only as a going attendee.');
  execute format('comment on function private.event_notification_recipients(bigint) is %L', v_new);

  v_old := obj_description('private.update_event_impl(bigint,text,text,bigint,timestamptz,timestamptz,text,integer,text,integer,bigint)'::regprocedure, 'pg_proc');
  v_new := replace(v_old,
    'minus every live BC member and Moderator, #929)',
    'minus every live BC member and Moderator, #929, plus the BC members whose Group position reaches it, R42)');
  if v_new = v_old then
    raise exception 'update_event_impl comment: expected text not found';
  end if;
  execute format('comment on function private.update_event_impl(bigint,text,text,bigint,timestamptz,timestamptz,text,integer,text,integer,bigint) is %L', v_new);

  v_old := obj_description('private.create_event_impl(text,text,bigint,timestamptz,timestamptz,text,integer,text,integer,bigint,boolean)'::regprocedure, 'pg_proc');
  v_new := replace(v_old,
    'minus BC and the Moderator per R32,',
    'minus BC and the Moderator per R32 save a BC member whose Group position reaches the Event''s Group per R42,');
  if v_new = v_old then
    raise exception 'create_event_impl comment: expected text not found';
  end if;
  execute format('comment on function private.create_event_impl(text,text,bigint,timestamptz,timestamptz,text,integer,text,integer,bigint,boolean) is %L', v_new);
end;
$$;
