-- Ruling R45 (2026-10-07): OSUBB Deals. Alex: "the new page in announcements called
-- OSUBB Deals ... Title, Description, Deadline, Links ... a code, that represents a
-- discount code, or an access code ... given by companies specifically for osubb
-- members ... hidden, when someone clicks the code it will appear ... remain open for
-- that person ... intended by default to all osubb members".
--
-- A Deal is an Announcement of kind 'deal': posted by the OSUBB Deals team (R44:
-- the holder of Responsabil OSUBB Deals, its Coordonator or its Responsabil) from
-- the Organization Group to every active Member, Recruți included -- Audience org,
-- Minimum Level 0, priority normal, never pinned (announcements_guard_settings,
-- 23514 invalid_deal_settings). It may carry a Deal Code (announcements.code, at
-- most 80 characters, PT400 deal_code_too_long / code_only_on_deals).
--
-- Publishing stays a direct insert under RLS (announcements_create reads kind).
-- Editing and deleting a Deal: the holder and the Coordonator any Deal, the
-- Responsabil their own, BC and the Moderator any (so a Deal outlives its team).
-- Reading: every live Member until its Termen; after it only the team and BC /
-- the Moderator. The fan-out is the organization-wide Announcement rule with the
-- title "Deal nou: <titlu>" and the link /anunturi/deals?deal=<id>. Revealing the
-- code is recorded per Member (public.reveal_deal_code, public.deal_code_reveals);
-- the team reads how many revealed it (public.deal_code_reveal_count).

-- ==================== Columns and constraints ====================

alter table public.announcements
  add column kind text not null default 'announcement',
  add column code text,
  add constraint announcements_kind_ck check (kind in ('announcement', 'deal')),
  add constraint announcements_code_ck
    check (code is null or (kind = 'deal' and char_length(code) between 1 and 80)),
  add constraint announcements_deal_shape_ck
    check (kind <> 'deal' or (audience = 'org' and min_level = 0 and priority = 'normal' and not pinned));

comment on column public.announcements.kind is
  'R45: announcement (the Anunțuri tab) or deal (the OSUBB Deals tab). Fixed at insert.';
comment on column public.announcements.code is
  'R45: a Deal''s optional Deal Code (at most 80 characters, trimmed). Readable with the row; the app hides it until the Member reveals it (public.reveal_deal_code).';

create index announcements_kind_published_idx on public.announcements (kind, published_at desc);

-- ==================== Row guards ====================

create or replace function private.guard_announcement_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Named ahead of announcements_min_level_ck, so a direct write hears the rule.
  if new.min_level is null or new.min_level not in (0, 1, 2, 3, 5, 6) then
    raise exception using errcode = '23514', message = 'invalid_announcement_min_level';
  end if;
  if tg_op = 'INSERT' and (select auth.uid()) is not null
     and new.deadline is not null and new.deadline < now() then
    raise exception using errcode = '23514', message = 'deadline_in_past';
  end if;
  -- R45: the Deal Code, trimmed (blank -> none), only on a Deal, at most 80.
  new.code := nullif(regexp_replace(coalesce(new.code, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  if new.code is not null and new.kind is distinct from 'deal' then
    raise sqlstate 'PT400' using message = 'code_only_on_deals';
  end if;
  if char_length(new.code) > 80 then
    raise sqlstate 'PT400' using message = 'deal_code_too_long';
  end if;
  -- R45: a Deal goes from the Organization Group to everyone, never critical
  -- or pinned.
  if new.kind = 'deal'
     and (new.audience is distinct from 'org'
          or new.min_level is distinct from 0
          or new.priority is distinct from 'normal'
          or new.pinned is distinct from false
          or not exists (select 1 from public.groups as grp
                          where grp.id = new.group_id and grp.is_organization)) then
    raise exception using errcode = '23514', message = 'invalid_deal_settings';
  end if;
  return new;
end;
$$;

comment on function private.guard_announcement_settings() is
  '#909, R45: announcements_guard_settings -- names the rule a direct write breaks: 23514 invalid_announcement_min_level (off the R29b ladder, insert or update) and, R8, deadline_in_past for a signed-in insert whose Termen has passed (updates are not judged against now; writes without auth.uid() may carry a past Termen). R45: trims the Deal Code (blank -> null), PT400 code_only_on_deals on an Announcement and deal_code_too_long above 80 characters; a Deal must be of the Organization Group, Audience org, Minimum Level 0, priority normal and not pinned (23514 invalid_deal_settings). R45 made it security definer so the Organization Group test reads groups whatever the writer may see; it writes only NEW.';

create or replace function private.guard_announcement_origin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if new.group_id is distinct from old.group_id then
    raise exception using errcode = '23514', message = 'announcement_group_immutable';
  end if;
  if new.audience is distinct from old.audience then
    raise exception using errcode = '23514', message = 'announcement_audience_immutable';
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
  '#936, R45: announcements_guard_origin -- a signed-in update may not move an Announcement to another Group (23514 announcement_group_immutable), change its Audience (announcement_audience_immutable) or its kind (announcement_kind_immutable). Writes without auth.uid() (migrations, seed, jobs) pass.';

-- ==================== Predicates ====================

-- The policies that read the two predicates are re-created with them.
drop policy announcements_create on public.announcements;
drop policy announcements_read on public.announcements;
drop policy announcements_update on public.announcements;
drop policy announcements_delete on public.announcements;
drop policy announcement_reads_manage_self on public.announcement_reads;
drop function private.can_publish_announcement(bigint);
drop function private.can_read_announcement(bigint, text, integer, uuid);

create function private.can_publish_announcement(p_group_id bigint, p_kind text default 'announcement')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- An Announcement: the Origin's Manager or Responsible on its path (or
  -- BC/Moderator), or, for the Organization Group, anyone holding a Group Role
  -- anywhere (#581). R45: a Deal: the OSUBB Deals team, live.
  select coalesce(public.auth_is_member(), false)
     and case when p_kind = 'deal'
              then private.deals_team_role() is not null
              else coalesce(private.can_manage_group_work(p_group_id), false)
                   or (exists (select 1 from public.groups as grp
                                where grp.id = p_group_id and grp.is_organization)
                       and coalesce(private.holds_any_group_role(), false))
         end;
$$;

comment on function private.can_publish_announcement(bigint, text) is
  '#909, R45: whether the live caller may publish an Announcement (p_kind announcement, the default) from this Origin Group -- the compose rule of announcements_create (#581), lifted into one predicate that the policy and create_event(p_announce) both read -- or a Deal (p_kind deal): the OSUBB Deals team (private.deals_team_role: holder, Coordonator or Responsabil).';

create function private.can_read_announcement(p_group_id bigint, p_audience text, p_min_level integer, p_created_by uuid,
                                              p_kind text default 'announcement', p_deadline timestamptz default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- #756: an organization-wide Announcement of a Private Group is still the
  -- Group's own, so it reads only for those who can see the Group.
  -- #909: and only at or above its Minimum Level, by live level -- its author
  -- always, whatever their level has become.
  -- R45: a Deal reads for every live Member until its Termen; after it only for
  -- the OSUBB Deals team and BC / the Moderator.
  select coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null
     and private.can_see_group(p_group_id, (select auth.uid()))
     and (p_audience = 'org'
          or (p_audience = 'local' and (
              (select auth.uid()) in (select private.group_audience(p_group_id))
              or private.group_role_of(p_group_id, (select auth.uid())) in ('manager', 'responsible')
          )))
     and (private.caller_level() >= coalesce(p_min_level, 0)
          or p_created_by = (select auth.uid()))
     and (p_kind is distinct from 'deal'
          or p_deadline is null
          or p_deadline >= now()
          or private.caller_level() >= 6
          or private.deals_team_role() is not null);
$$;

comment on function private.can_read_announcement(bigint, text, integer, uuid, text, timestamptz) is
  'The Announcement read rule (#581, #756, #909, R45), one definition for announcements_read and announcement_reads_manage_self: a live Member with organization claims who can see the Origin Group, in the Audience (org: everyone; local: the Origin''s Group Audience or a Manager / Responsible on its path), and whose live level (private.caller_level, #816) is at least the Announcement''s Minimum Level -- or its author. R45: a Deal (p_kind deal) past its Termen (p_deadline) reads only for live level >= 6 (BC, the Moderator) and the OSUBB Deals team. Policy predicate: authenticated may execute it.';

create function private.can_manage_deal(p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and (private.caller_level() >= 6
          or coalesce(private.deals_team_role() in ('holder', 'coordinator'), false)
          or (private.deals_team_role() = 'responsible' and p_created_by = (select auth.uid())));
$$;

comment on function private.can_manage_deal(uuid) is
  'R45: whether the live caller may edit or delete a Deal by p_created_by -- BC and the Moderator (live level >= 6) and the OSUBB Deals holder and Coordonator any Deal, the Responsabil their own. Policy predicate: authenticated may execute it.';

revoke execute on function private.can_publish_announcement(bigint, text)
  from public, anon, authenticated, service_role;
revoke execute on function private.can_read_announcement(bigint, text, integer, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke execute on function private.can_manage_deal(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.can_publish_announcement(bigint, text) to authenticated;
grant execute on function private.can_read_announcement(bigint, text, integer, uuid, text, timestamptz) to authenticated;
grant execute on function private.can_manage_deal(uuid) to authenticated;

-- ==================== Policies ====================

create policy announcements_create on public.announcements
  for insert to authenticated
  with check (public.auth_is_member()
              and created_by = (select auth.uid())
              and private.can_publish_announcement(group_id, kind));

create policy announcements_read on public.announcements
  for select to authenticated
  using (private.can_read_announcement(group_id, audience, min_level, created_by, kind, deadline));

create policy announcements_update on public.announcements
  for update to authenticated
  using (public.auth_is_member()
         and case when kind = 'deal'
                  then private.can_manage_deal(created_by)
                  else private.can_manage_group_work(group_id)
                       or (exists (select 1 from public.groups as grp
                                    where grp.id = announcements.group_id and grp.is_organization)
                           and private.holds_any_group_role())
             end)
  with check (public.auth_is_member()
              and case when kind = 'deal'
                       then private.can_manage_deal(created_by)
                       else private.can_manage_group_work(group_id)
                            or (exists (select 1 from public.groups as grp
                                         where grp.id = announcements.group_id and grp.is_organization)
                                and private.holds_any_group_role())
                  end);

create policy announcements_delete on public.announcements
  for delete to authenticated
  using (public.auth_is_member()
         and case when kind = 'deal'
                  then private.can_manage_deal(created_by)
                  else private.can_manage_group_work(group_id)
                       or (exists (select 1 from public.groups as grp
                                    where grp.id = announcements.group_id and grp.is_organization)
                           and private.holds_any_group_role())
             end);

create policy announcement_reads_manage_self on public.announcement_reads
  for all to authenticated
  using (public.auth_is_member() and member_id = (select auth.uid()))
  with check (public.auth_is_member()
              and member_id = (select auth.uid())
              and exists (
                select 1 from public.announcements as announcement
                 where announcement.id = announcement_reads.announcement_id
                   and private.can_read_announcement(announcement.group_id, announcement.audience,
                         announcement.min_level, announcement.created_by,
                         announcement.kind, announcement.deadline)));

-- ==================== Fan-out ====================

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
  v_deal boolean := new.kind = 'deal';
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
  -- R45: a Deal is announced as "Deal nou" and opens on the OSUBB Deals tab.
  perform private.notify(v_recipients, 'announce',
    case when v_deal then 'Deal nou: ' else 'Anunț nou: ' end || new.title,
    new.body, null, 'announcement:' || new.id::text, v_actor,
    case when v_deal then '/anunturi/deals?deal=' else '/anunturi?anunt=' end || new.id::text,
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
  'Broadcasts one in-app Notification per recipient after an Announcement insert (#68), keyed announcement:<id> (#861) so reading the Announcement marks it read. The recipients are the Group Audience Notifications reach (private.group_notification_audience) of the Origin for a local Audience and of the Organization Group for an org Audience -- no BC member or Moderator through membership (#929, R32), and no Member who unselected that Group in Grupuri preferate (R43; the Organization Group is locked, so an org Audience is never muted) -- plus the BC members whose Group position reaches the Origin (private.board_position_holders, R42), for either Audience. A critical Announcement reads the unmuted audience (private.group_notification_audience_unmuted), so the preference never silences it. The data-driven notif_suppression lookup filters broadcast kinds, then Private Group visibility (#756) and the Minimum Level (#909), before private.notify removes duplicates, inactive recipients and the actual authenticated actor (or created_by for server-side inserts). R45: a Deal (always org, Minimum Level 0) is titled "Deal nou: <titlu>" and links /anunturi/deals?deal=<id>; an Announcement "Anunț nou: <titlu>", /anunturi?anunt=<id>. Task notifications remain direct and unsuppressed. It also writes the author''s own announcement_reads row when the author is in the Announcement''s read audience (the announcements_read rule judged for created_by, #861), so the author''s own Announcement never counts as unread.';

-- ==================== Badge ====================

drop function public.my_unread_announcements_count();

create function public.my_unread_announcements_count(p_kind text default null)
returns integer
language sql
stable
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

comment on function public.my_unread_announcements_count(text) is
  'The caller''s unread Announcements for the Anunțuri badge (#693, R15): rows announcements_read lets them see, minus those with their own announcement_reads row. Zero without organization claims. A live BC member counts only the Announcements whose Origin their Manager or Responsible position reaches (R42), the ones the fan-out notified them of; the Moderator, whom no Announcement reaches through membership (#929, ruling R32), counts none. A Member at level >= 5 does not count a local Announcement of a Group they unselected in Grupuri preferate (R43, private.is_group_muted); a critical or organization-wide one still counts. R45: p_kind (announcement or deal) counts one tab, null both; a Deal past its Termen never counts.';

revoke execute on function public.my_unread_announcements_count(text)
  from public, anon, authenticated, service_role;
grant execute on function public.my_unread_announcements_count(text) to authenticated;

-- ==================== Readers list ====================

create or replace function private.announcement_readers_impl(p_announcement_id bigint)
returns table (member_id uuid, read_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_group_id bigint;
  v_audience text;
  v_created_by uuid;
  v_audience_group bigint;
  v_min_level integer;
  v_critical boolean;
  v_kind text;
begin
  select announcement.group_id, announcement.audience, announcement.created_by, announcement.min_level,
         announcement.priority = 'critical', announcement.kind
    into v_group_id, v_audience, v_created_by, v_min_level, v_critical, v_kind
    from public.announcements as announcement
   where announcement.id = p_announcement_id;

  -- Author, BC/Moderator by rank, or -- for a local Audience only -- the
  -- Origin's Managers and Responsibles, ancestors' included. An org Audience
  -- reaches everyone, so a Group Role on its Origin does not suffice.
  -- R45: a Deal's readers list is the OSUBB Deals team's too.
  if not found
     or not coalesce(
          public.auth_is_member()
          and private.actor_level(v_actor) is not null
          and (v_created_by = v_actor
               or private.actor_level(v_actor) >= 6
               or (v_kind = 'deal' and private.deals_team_role() is not null)
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
$$;

comment on function private.announcement_readers_impl(bigint) is
  'Readers list body (#693, R15). The Announcement''s Notification recipients, the same set #68''s fan-out addresses -- private.group_notification_audience of the Origin for local, of the Organization Group for org (the Group Audience minus every live BC member and Moderator, #929, plus the BC members whose position reaches it, R42, minus the Members who unselected that Group, R43 -- the unmuted set for a critical Announcement), together with the BC members whose position reaches the Origin (private.board_position_holders, R42) -- left-joined to announcement_reads, read_at null when unread, newest read first. Callable by the author, BC/Moderator (level >= 6), for a Deal the OSUBB Deals team (R45), and for a local Audience the Origin''s Managers and Responsibles including ancestors''; everyone else, and a missing row, gets PT404 announcement_not_found.';

-- ==================== The Deal Code reveal ====================

create table public.deal_code_reveals (
  announcement_id bigint not null references public.announcements (id) on delete cascade,
  member_id       uuid not null references public.profiles (id) on delete cascade,
  revealed_at     timestamptz not null default now(),
  primary key (announcement_id, member_id)
);

comment on table public.deal_code_reveals is
  'R45: a Member revealed a Deal''s code -- written only by public.reveal_deal_code, once per Member and Deal, so the code stays revealed on every device of theirs. A Member reads their own rows; the team reads only the count (public.deal_code_reveal_count). No broadcast: a personal record nobody else watches live.';

create index deal_code_reveals_member_id_idx on public.deal_code_reveals (member_id);

alter table public.deal_code_reveals enable row level security;

revoke all on table public.deal_code_reveals from public, anon, authenticated, service_role;
grant select on table public.deal_code_reveals to authenticated, service_role;

create policy deal_code_reveals_read_self on public.deal_code_reveals
  for select to authenticated
  using (public.auth_is_member()
         and (select private.caller_level()) >= 0
         and member_id = (select auth.uid()));

create function private.reveal_deal_code_impl(p_announcement_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_deal  public.announcements%rowtype;
begin
  if v_actor is null or not coalesce(public.auth_is_member(), false)
     or private.actor_level(v_actor) is null then
    raise exception using errcode = '42501', message = 'deal_code_forbidden';
  end if;
  select * into v_deal from public.announcements as announcement
   where announcement.id = p_announcement_id and announcement.kind = 'deal';
  -- Hidden and missing are one answer: an expired Deal reads only for its team.
  if not found
     or not private.can_read_announcement(v_deal.group_id, v_deal.audience, v_deal.min_level,
                                          v_deal.created_by, v_deal.kind, v_deal.deadline) then
    raise sqlstate 'PT404' using message = 'deal_not_found';
  end if;
  if v_deal.code is not null then
    insert into public.deal_code_reveals (announcement_id, member_id)
    values (p_announcement_id, v_actor)
    on conflict (announcement_id, member_id) do nothing;
  end if;
  return v_deal.code;
end;
$$;

comment on function private.reveal_deal_code_impl(bigint) is
  'R45: body of public.reveal_deal_code. 42501 deal_code_forbidden without organization claims or a live activ Profile; PT404 deal_not_found for a missing Announcement, one that is not a Deal, or a Deal the caller cannot read (private.can_read_announcement -- an expired Deal for a Member outside its team). Records the reveal once (on conflict do nothing) when the Deal has a code, and returns the code (null when it has none).';

create function public.reveal_deal_code(p_announcement_id bigint)
returns text
language sql
set search_path = ''
as $$
  select private.reveal_deal_code_impl(p_announcement_id);
$$;

comment on function public.reveal_deal_code(bigint) is
  'R45: the live Member taps a Deal''s hidden code: the reveal is recorded once (public.deal_code_reveals) so it stays revealed on every device of theirs, and the code is returned. Idempotent. Reasons: 42501 deal_code_forbidden, PT404 deal_not_found.';

create function private.deal_code_reveal_count_impl(p_announcement_id bigint)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_found boolean;
begin
  if not coalesce(public.auth_is_member(), false)
     or not (private.caller_level() >= 6 or private.deals_team_role() is not null) then
    raise exception using errcode = '42501', message = 'deal_code_forbidden';
  end if;
  select true into v_found from public.announcements as announcement
   where announcement.id = p_announcement_id and announcement.kind = 'deal';
  if not coalesce(v_found, false) then
    raise sqlstate 'PT404' using message = 'deal_not_found';
  end if;
  return (select count(*)::integer from public.deal_code_reveals as reveal
           where reveal.announcement_id = p_announcement_id);
end;
$$;

comment on function private.deal_code_reveal_count_impl(bigint) is
  'R45: body of public.deal_code_reveal_count. 42501 deal_code_forbidden unless the live caller is in the OSUBB Deals team (private.deals_team_role) or BC / the Moderator (live level >= 6); PT404 deal_not_found for a missing Announcement or one that is not a Deal.';

create function public.deal_code_reveal_count(p_announcement_id bigint)
returns integer
language sql
stable
set search_path = ''
as $$
  select private.deal_code_reveal_count_impl(p_announcement_id);
$$;

comment on function public.deal_code_reveal_count(bigint) is
  'R45: how many Members revealed a Deal''s code ("Codul a fost deschis de N membri"), for the OSUBB Deals team, BC and the Moderator only. Reasons: 42501 deal_code_forbidden, PT404 deal_not_found.';

revoke execute on function private.reveal_deal_code_impl(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.reveal_deal_code(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function private.deal_code_reveal_count_impl(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.deal_code_reveal_count(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.reveal_deal_code_impl(bigint) to authenticated;
grant execute on function public.reveal_deal_code(bigint) to authenticated;
grant execute on function private.deal_code_reveal_count_impl(bigint) to authenticated;
grant execute on function public.deal_code_reveal_count(bigint) to authenticated;
