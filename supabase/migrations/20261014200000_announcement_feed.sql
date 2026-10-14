-- Fast reads everywhere, part 4 (docs/superpowers/specs/2026-10-14-member-reads-design.md):
-- Anunțuri by the page (ruling R56).
--
-- The Anunțuri page read every Announcement the Member may read, then
-- narrowed (Grupuri preferate, the Group filter), counted (the header's
-- unread badge, the critical banner, the empty states) and ordered (R15) in
-- the browser. It reads 20 at a time now; those rules move to the server,
-- in one place, private.announcement_feed_rows, so the page and its summary
-- can never disagree:
--   * what the caller reads: exactly announcements_read (the policy's own
--     expression), Announcements only -- a Deal lives on its own tab (R45);
--   * Grupuri preferate (R43), when asked: an unticked Group's Announcement
--     leaves unless it is critical, organization-wide or the caller's own;
--   * the Group filter: the chosen Group and every Group below it.
-- public.announcement_feed returns a page in R15's order -- pinned, then
-- unread, then read; newest first in each; the id last -- with the unpaged
-- count; public.announcement_feed_summary returns the header's unread count,
-- the first unread critical Announcement for the banner, and the two counts
-- the empty states tell apart.

-- ==================== 1. The feed's rule, in one place ====================

create function private.announcement_feed_rows(p_group_id bigint, p_preferred boolean)
returns table(
  id bigint,
  title text,
  body text,
  group_id bigint,
  audience text,
  priority public.announce_priority,
  pinned boolean,
  links jsonb,
  published_at timestamptz,
  deadline timestamptz,
  min_level integer,
  created_by uuid,
  approval_status text,
  rejection_reason text,
  read_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with caller as materialized (
    select (select auth.uid()) as id
     where coalesce(public.auth_is_member(), false)
  ),
  -- R43: the Groups the caller unticked that private.group_muted_for still
  -- honours (a position on the path, or a Group set in Setări, unmutes).
  muted as (
    select unselected.group_id
      from caller
      join public.member_group_unselected as unselected on unselected.member_id = caller.id
     where coalesce(p_preferred, false)
       and private.group_muted_for(unselected.group_id, unselected.member_id)
  )
  select announcement.id, announcement.title, announcement.body, announcement.group_id,
         announcement.audience, announcement.priority, announcement.pinned, announcement.links,
         announcement.published_at, announcement.deadline, announcement.min_level,
         announcement.created_by, announcement.approval_status, announcement.rejection_reason,
         reads.read_at
    from caller
   cross join public.announcements as announcement
    left join public.announcement_reads as reads
      on reads.announcement_id = announcement.id
     and reads.member_id = caller.id
   where announcement.kind = 'announcement'
     -- announcements_read, as the policy reads it.
     and private.can_read_announcement(announcement.group_id, announcement.audience,
                                       announcement.min_level, announcement.created_by,
                                       announcement.kind, announcement.deadline)
     and (announcement.approval_status = 'approved'
          or announcement.created_by = caller.id
          or coalesce((select private.caller_level()), 0) >= 6)
     and (announcement.group_id not in (select muted.group_id from muted)
          or announcement.priority = 'critical'
          or announcement.audience = 'org'
          or announcement.created_by = caller.id)
     and (p_group_id is null
          or exists (select 1
                       from public.groups as grp
                      where grp.id = announcement.group_id
                        and grp.path @> array[p_group_id]));
$$;

comment on function private.announcement_feed_rows(bigint, boolean) is
  'Fast reads part 4 (spec 2026-10-14 member reads, ruling R56): the Anunțuri feed''s one rule. The Announcements (kind announcement, never a Deal) announcements_read gives the caller -- its own expression --, with the caller''s read time; p_preferred (R43): without an unticked Group''s Announcement that is neither critical, organization-wide nor the caller''s own; p_group_id: that Group and every Group below it. Nothing without organization claims. Read only by the two feed bodies.';

revoke execute on function private.announcement_feed_rows(bigint, boolean)
  from public, anon, authenticated, service_role;

-- ==================== 2. A page of the feed ====================

create function private.require_announcement_feed_page(p_limit integer, p_offset integer)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 then
    raise sqlstate 'PT400' using message = 'invalid_page';
  end if;
end;
$$;

comment on function private.require_announcement_feed_page(integer, integer) is
  'The malformed-call refusal of public.announcement_feed: PT400 invalid_page (p_limit outside 1..100 or p_offset below 0).';

revoke execute on function private.require_announcement_feed_page(integer, integer)
  from public, anon, authenticated, service_role;

create function private.announcement_feed_impl(
  p_group_id bigint,
  p_preferred boolean,
  p_limit integer,
  p_offset integer)
returns table(
  id bigint,
  title text,
  body text,
  group_id bigint,
  audience text,
  priority public.announce_priority,
  pinned boolean,
  links jsonb,
  published_at timestamptz,
  deadline timestamptz,
  min_level integer,
  created_by uuid,
  approval_status text,
  rejection_reason text,
  read_at timestamptz,
  total bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select private.require_announcement_feed_page(p_limit, p_offset);

  with placed as (
    -- R15: pinned (read or not), then unread, then read; newest first in
    -- each; the id ends every tie, so a page boundary never wobbles.
    select feed.*,
           count(*) over () as total,
           row_number() over (
             order by case when feed.pinned then 0 when feed.read_at is null then 1 else 2 end,
                      feed.published_at desc,
                      feed.id desc) as place
      from private.announcement_feed_rows(p_group_id, p_preferred) as feed
  )
  select placed.id, placed.title, placed.body, placed.group_id, placed.audience, placed.priority,
         placed.pinned, placed.links, placed.published_at, placed.deadline, placed.min_level,
         placed.created_by, placed.approval_status, placed.rejection_reason, placed.read_at,
         placed.total
    from placed
   order by placed.place
   limit p_limit offset p_offset;
$$;

comment on function private.announcement_feed_impl(bigint, boolean, integer, integer) is
  'Body of public.announcement_feed: private.announcement_feed_rows in R15''s order, cut by p_limit and p_offset, with the unpaged count in total.';

create function public.announcement_feed(
  p_group_id bigint default null,
  p_preferred boolean default false,
  p_limit integer default 20,
  p_offset integer default 0)
returns table(
  id bigint,
  title text,
  body text,
  group_id bigint,
  audience text,
  priority public.announce_priority,
  pinned boolean,
  links jsonb,
  published_at timestamptz,
  deadline timestamptz,
  min_level integer,
  created_by uuid,
  approval_status text,
  rejection_reason text,
  read_at timestamptz,
  total bigint)
language sql
stable
set search_path = ''
as $$
  select * from private.announcement_feed_impl(p_group_id, p_preferred, p_limit, p_offset);
$$;

comment on function public.announcement_feed(bigint, boolean, integer, integer) is
  'A page of the Anunțuri feed (spec 2026-10-14 member reads, ruling R56), in one request: the Announcements the caller reads (exactly announcements_read; never a Deal), p_preferred (R43) without an unticked Group''s that is neither critical, organization-wide nor theirs, p_group_id that Group and every Group below it; R15''s order (pinned, unread, read; newest first; id last); p_limit 1..100 (20 by default) and p_offset cut the page, total is the count before the cut; read_at is the caller''s own read time. PT400 invalid_page. Nothing without organization claims.';

revoke execute on function private.announcement_feed_impl(bigint, boolean, integer, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.announcement_feed(bigint, boolean, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.announcement_feed_impl(bigint, boolean, integer, integer) to authenticated;
grant execute on function public.announcement_feed(bigint, boolean, integer, integer) to authenticated;

-- ==================== 3. What the page shows around it ====================

create function private.announcement_feed_summary_impl(p_group_id bigint, p_preferred boolean)
returns table(unread integer, critical_id bigint, everything integer, preferred integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    -- The header counts what the caller has to read in the view they are
    -- in; the Group filter only narrows the list below it.
    (select count(*)::integer
       from private.announcement_feed_rows(null, p_preferred) as feed
      where feed.approval_status = 'approved'
        and feed.read_at is null),
    -- The banner points at the first unread critical one of the list shown.
    (select feed.id
       from private.announcement_feed_rows(p_group_id, p_preferred) as feed
      where feed.priority = 'critical'
        and feed.read_at is null
        and feed.approval_status = 'approved'
      order by case when feed.pinned then 0 else 1 end, feed.published_at desc, feed.id desc
      limit 1),
    -- The empty states tell "nothing at all" from "nothing preferred".
    (select count(*)::integer from private.announcement_feed_rows(null, false)),
    (select count(*)::integer from private.announcement_feed_rows(null, p_preferred));
$$;

comment on function private.announcement_feed_summary_impl(bigint, boolean) is
  'Body of public.announcement_feed_summary.';

create function public.announcement_feed_summary(
  p_group_id bigint default null,
  p_preferred boolean default false)
returns table(unread integer, critical_id bigint, everything integer, preferred integer)
language sql
stable
set search_path = ''
as $$
  select * from private.announcement_feed_summary_impl(p_group_id, p_preferred);
$$;

comment on function public.announcement_feed_summary(bigint, boolean) is
  'What the Anunțuri page shows around its feed (spec 2026-10-14 member reads): unread, the approved Announcements of the view (p_preferred) the caller has not read, whatever the Group filter; critical_id, the first unread approved critical Announcement of the list shown (p_group_id, p_preferred) in R15''s order, for the banner; everything, every Announcement the caller reads; preferred, those of the preferred view. One row.';

revoke execute on function private.announcement_feed_summary_impl(bigint, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function public.announcement_feed_summary(bigint, boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.announcement_feed_summary_impl(bigint, boolean) to authenticated;
grant execute on function public.announcement_feed_summary(bigint, boolean) to authenticated;
