-- #693: Announcement readers list and the caller's unread count (ruling R15).

-- The readers list reveals who read what, which announcement_reads' self-only
-- policy hides from everyone else, so the body runs as definer and decides
-- authority itself. A hidden or unauthorized Announcement answers exactly like a
-- missing one (conventions §3).
create function private.announcement_readers_impl(p_announcement_id bigint)
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
begin
  select announcement.group_id, announcement.audience, announcement.created_by
    into v_group_id, v_audience, v_created_by
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
                   and private.group_role_of(v_group_id, v_actor) in ('manager', 'responsible'))),
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
      from private.group_audience(v_audience_group) as recipient(member_id)
      left join public.announcement_reads as reads
        on reads.announcement_id = p_announcement_id
       and reads.member_id = recipient.member_id
     order by reads.read_at desc nulls last, recipient.member_id;
end;
$$;

comment on function private.announcement_readers_impl(bigint) is
  'Readers list body (#693, R15). The Announcement Audience -- private.group_audience of the Origin for local, of the Organization Group (every active Member) for org, the same set #68''s fan-out addresses -- left-joined to announcement_reads, read_at null when unread, newest read first. Callable by the author, BC/Moderator (level >= 6), and for a local Audience the Origin''s Managers and Responsibles including ancestors''; everyone else, and a missing row, gets PT404 announcement_not_found.';

create function public.announcement_readers(p_announcement_id bigint)
returns table (member_id uuid, read_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.announcement_readers_impl(p_announcement_id);
$$;

comment on function public.announcement_readers(bigint) is
  'Who of an Announcement''s Audience has read it and when (R15, "citit de x din y"). One row per recipient; read_at null = unread. Names come from member_card on the client.';

-- Invoker on purpose: announcements_read decides which rows count, so "unread
-- Announcements the Member may read" is that policy, restated nowhere.
create function public.my_unread_announcements_count()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer
    from public.announcements as announcement
   where not exists (
     select 1
       from public.announcement_reads as reads
      where reads.announcement_id = announcement.id
        and reads.member_id = (select auth.uid()));
$$;

comment on function public.my_unread_announcements_count() is
  'The caller''s unread Announcements for the Anunțuri badge (#693, R15): rows announcements_read lets them see, minus those with their own announcement_reads row. Zero without organization claims.';

revoke execute on function private.announcement_readers_impl(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.announcement_readers(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.my_unread_announcements_count()
  from public, anon, authenticated, service_role;
grant execute on function private.announcement_readers_impl(bigint) to authenticated;
grant execute on function public.announcement_readers(bigint) to authenticated;
grant execute on function public.my_unread_announcements_count() to authenticated;
