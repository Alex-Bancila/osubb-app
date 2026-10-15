-- Fast reads everywhere, part 4 (docs/superpowers/specs/2026-10-14-member-reads-design.md):
-- Anunțuri by the page (ruling R56).
--
-- The Anunțuri page read every Announcement the Member may read, then
-- narrowed (Grupuri preferate, the Group filter), counted (the header's
-- unread badge, the critical banner, the empty states) and ordered (R15) in
-- the browser. It reads 20 at a time now; those rules move to the server,
-- in one place, private.announcement_feed_base, so the page and its summary
-- can never disagree:
--   * what the caller reads: exactly announcements_read, Announcements only
--     -- a Deal lives on its own tab (R45). private.can_read_announcement is
--     a security-definer helper Postgres cannot inline, about half a
--     millisecond a row, so the rule is decided once per Group (seeing it,
--     its local Audience) and the rest -- the Minimum Level, the author, the
--     approval -- on the row;
--   * Grupuri preferate (R43), when asked: an unticked Group's Announcement
--     leaves unless it is critical, organization-wide or the caller's own;
--   * the Group filter: the chosen Group and every Group below it.
-- public.announcement_feed returns a page in R15's order -- pinned, then
-- unread, then read; newest first in each; the id last -- with the unpaged
-- count. Being read moves an Announcement in that order, so a page is cut
-- against a moment, p_as_of: a read made after it still orders as unread.
-- The first page answers its moment (as_of) and every later page of the
-- same reading passes it on, so reading a card never shifts the next page;
-- reading from the top again starts a new moment.
-- public.announcement_feed_summary returns, in one pass, the header's unread
-- count, the first unread critical Announcement for the banner, and the two
-- counts the empty states tell apart.

-- ==================== 1. The feed's rule, in one place ====================

create function private.announcement_feed_base(p_group_id bigint)
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
  preference_hides boolean,
  in_group boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with caller as materialized (
    select (select auth.uid()) as id, coalesce(private.caller_level(), -1) as level
     where coalesce(public.auth_is_member(), false)
       and private.actor_level() is not null
  ),
  -- private.can_read_announcement for an Announcement, decided once per
  -- Group rather than once per row (a security-definer helper Postgres
  -- cannot inline, about half a millisecond a call): the Groups the caller
  -- can see, and whether their local Audience holds or is led by the
  -- caller -- asked only of a Group that has a local Announcement, since
  -- private.group_audience builds the whole Audience.
  origin as materialized (
    select grp.id,
           case when exists (select 1 from public.announcements as local_one
                              where local_one.group_id = grp.id
                                and local_one.audience = 'local'
                                and local_one.kind = 'announcement')
                then caller.id in (select private.group_audience(grp.id))
                     or coalesce(private.group_role_of(grp.id, caller.id) in ('manager', 'responsible'), false)
                else false
           end as local_ok,
           (p_group_id is null or grp.path @> array[p_group_id]) as in_group
      from caller
      join public.groups as grp on private.can_see_group(grp.id, caller.id)
  ),
  -- R43: the Groups the caller unticked that private.group_muted_for still
  -- honours (a position on the path, or a Group set in Setări, unmutes).
  muted as (
    select unselected.group_id
      from caller
      join public.member_group_unselected as unselected on unselected.member_id = caller.id
     where private.group_muted_for(unselected.group_id, unselected.member_id)
  )
  select announcement.id, announcement.title, announcement.body, announcement.group_id,
         announcement.audience, announcement.priority, announcement.pinned, announcement.links,
         announcement.published_at, announcement.deadline, announcement.min_level,
         announcement.created_by, announcement.approval_status, announcement.rejection_reason,
         reads.read_at,
         -- Grupuri preferate would hide it: an unticked Group's, neither
         -- critical, nor organization-wide, nor the caller's own.
         (    announcement.group_id in (select muted.group_id from muted)
          and announcement.priority <> 'critical'
          and announcement.audience <> 'org'
          and announcement.created_by is distinct from caller.id),
         origin.in_group
    from caller
    join public.announcements as announcement on announcement.kind = 'announcement'
    join origin on origin.id = announcement.group_id
    left join public.announcement_reads as reads
      on reads.announcement_id = announcement.id
     and reads.member_id = caller.id
   -- announcements_read, as the policy reads it: the Audience, the Minimum
   -- Level (the author always), and an unapproved one for its author and
   -- level 6 only. A Deal never reaches here, so R45's Termen does not apply.
   where (announcement.audience = 'org' or (announcement.audience = 'local' and origin.local_ok))
     and (caller.level >= coalesce(announcement.min_level, 0) or announcement.created_by = caller.id)
     and (announcement.approval_status = 'approved'
          or announcement.created_by = caller.id
          or caller.level >= 6);
$$;

comment on function private.announcement_feed_base(bigint) is
  'Fast reads part 4 (spec 2026-10-14 member reads, ruling R56): every Announcement (kind announcement, never a Deal) announcements_read gives the caller -- private.can_read_announcement decided once per Group, the rest on the row --, with the caller''s read time, whether Grupuri preferate (R43) would hide it (preference_hides), and whether it lies in p_group_id and every Group below it (in_group). Nothing without organization claims or a live level. Read only by the feed''s rows and its summary.';

revoke execute on function private.announcement_feed_base(bigint)
  from public, anon, authenticated, service_role;

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
  select base.id, base.title, base.body, base.group_id, base.audience, base.priority, base.pinned,
         base.links, base.published_at, base.deadline, base.min_level, base.created_by,
         base.approval_status, base.rejection_reason, base.read_at
    from private.announcement_feed_base(p_group_id) as base
   where base.in_group
     and not (coalesce(p_preferred, false) and base.preference_hides);
$$;

comment on function private.announcement_feed_rows(bigint, boolean) is
  'Fast reads part 4 (spec 2026-10-14 member reads, ruling R56): the Anunțuri feed''s one rule. private.announcement_feed_base narrowed to p_group_id and every Group below it and, with p_preferred (R43), without what Grupuri preferate hides. Read only by public.announcement_feed''s body.';

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
  p_offset integer,
  p_as_of timestamptz)
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
  total bigint,
  as_of timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select private.require_announcement_feed_page(p_limit, p_offset);

  with placed as (
    -- R15: pinned (read or not), then unread, then read; newest first in
    -- each; the id ends every tie. Read means read by the reading's moment,
    -- so a page boundary never wobbles while the Member reads.
    select feed.*,
           count(*) over () as total,
           row_number() over (
             order by case when feed.pinned then 0
                           when feed.read_at is null or feed.read_at > coalesce(p_as_of, now()) then 1
                           else 2 end,
                      feed.published_at desc,
                      feed.id desc) as place
      from private.announcement_feed_rows(p_group_id, p_preferred) as feed
  )
  select placed.id, placed.title, placed.body, placed.group_id, placed.audience, placed.priority,
         placed.pinned, placed.links, placed.published_at, placed.deadline, placed.min_level,
         placed.created_by, placed.approval_status, placed.rejection_reason, placed.read_at,
         placed.total, coalesce(p_as_of, now())
    from placed
   order by placed.place
   limit p_limit offset p_offset;
$$;

comment on function private.announcement_feed_impl(bigint, boolean, integer, integer, timestamptz) is
  'Body of public.announcement_feed: private.announcement_feed_rows in R15''s order as of p_as_of (now when null), cut by p_limit and p_offset, with the unpaged count in total and the moment in as_of.';

create function public.announcement_feed(
  p_group_id bigint default null,
  p_preferred boolean default false,
  p_limit integer default 20,
  p_offset integer default 0,
  p_as_of timestamptz default null)
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
  total bigint,
  as_of timestamptz)
language sql
stable
set search_path = ''
as $$
  select * from private.announcement_feed_impl(p_group_id, p_preferred, p_limit, p_offset, p_as_of);
$$;

comment on function public.announcement_feed(bigint, boolean, integer, integer, timestamptz) is
  'A page of the Anunțuri feed (spec 2026-10-14 member reads, ruling R56), in one request: the Announcements the caller reads (exactly announcements_read; never a Deal), p_preferred (R43) without an unticked Group''s that is neither critical, organization-wide nor theirs, p_group_id that Group and every Group below it; R15''s order (pinned, unread, read; newest first; id last) as of p_as_of -- a read made after it still orders as unread, so the pages of one reading never shift; null means now, and as_of answers the moment used, for the next page to pass on; p_limit 1..100 (20 by default) and p_offset cut the page, total is the count before the cut; read_at is the caller''s own read time. PT400 invalid_page. Nothing without organization claims.';

revoke execute on function private.announcement_feed_impl(bigint, boolean, integer, integer, timestamptz)
  from public, anon, authenticated, service_role;
revoke execute on function public.announcement_feed(bigint, boolean, integer, integer, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.announcement_feed_impl(bigint, boolean, integer, integer, timestamptz) to authenticated;
grant execute on function public.announcement_feed(bigint, boolean, integer, integer, timestamptz) to authenticated;

-- ==================== 3. What the page shows around it ====================

create function private.announcement_feed_summary_impl(p_group_id bigint, p_preferred boolean)
returns table(unread integer, critical_id bigint, everything integer, preferred integer)
language sql
stable
security definer
set search_path = ''
as $$
  -- One pass over what the caller reads; each count takes its part of it.
  with feed as materialized (
    select base.*,
           not (coalesce(p_preferred, false) and base.preference_hides) as in_view
      from private.announcement_feed_base(p_group_id) as base
  )
  select
    -- The header counts what the caller has to read in the view they are
    -- in; the Group filter only narrows the list below it.
    (select count(*)::integer
       from feed
      where feed.in_view
        and feed.approval_status = 'approved'
        and feed.read_at is null),
    -- The banner points at the first unread critical one of the list shown.
    (select feed.id
       from feed
      where feed.in_view
        and feed.in_group
        and feed.priority = 'critical'
        and feed.read_at is null
        and feed.approval_status = 'approved'
      order by case when feed.pinned then 0 else 1 end, feed.published_at desc, feed.id desc
      limit 1),
    -- The empty states tell "nothing at all" from "nothing preferred".
    (select count(*)::integer from feed),
    (select count(*)::integer from feed where feed.in_view);
$$;

comment on function private.announcement_feed_summary_impl(bigint, boolean) is
  'Body of public.announcement_feed_summary: one pass over private.announcement_feed_base.';

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
