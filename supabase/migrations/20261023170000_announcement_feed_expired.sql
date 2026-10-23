-- #1097, ruling R62 (2026-10-23): expired Announcements go below.
-- (docs/superpowers/plans/2026-10-23-calendar-announcements-requests-issue-drafts.md;
-- amends R15 and R56, spec docs/superpowers/specs/2026-10-14-member-reads-design.md.)
--
-- An Announcement whose Termen has passed leaves the top of the Anunțuri
-- feed for a second list under it, Termen expirat, pinned or not, read or
-- not. public.announcement_feed (20261014220000) therefore orders by one key
-- before R15's: expired last. Inside each list the order stays R15's --
-- pinned, then unread, then read; newest first in each; the id last.
-- "Passed" is measured at the reading's moment, p_as_of, exactly as being
-- read is: a Termen that passes while the Member reads moves nothing
-- between the pages of that reading; a reading begun after it sees it
-- expired. An Announcement without a Termen is never expired.
--
-- Each row also says whether it is expired, so the page knows where the
-- second list starts without judging a Termen against its own clock. A new
-- column changes the return type, so the wrapper and its body are dropped
-- and created again, with main's grants and comments carried over. The
-- feed's rule (private.announcement_feed_base, private.announcement_feed_rows),
-- its paging refusals, the summary, the critical banner and the badge are
-- unchanged.

drop function public.announcement_feed(bigint, boolean, integer, integer, timestamptz);
drop function private.announcement_feed_impl(bigint, boolean, integer, integer, timestamptz);

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
  expired boolean,
  total bigint,
  as_of timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select private.require_announcement_feed_page(p_limit, p_offset);

  with judged as (
    -- R62: past its Termen at the reading's moment; none without a Termen.
    select feed.*,
           (feed.deadline is not null and feed.deadline < coalesce(p_as_of, now())) as expired
      from private.announcement_feed_rows(p_group_id, p_preferred) as feed
  ),
  placed as (
    -- R62, then R15: the expired ones last; in each list pinned (read or
    -- not), then unread, then read; newest first in each; the id ends every
    -- tie. Read and expired both mean by the reading's moment, so a page
    -- boundary never wobbles while the Member reads.
    select judged.*,
           count(*) over () as total,
           row_number() over (
             order by case when judged.expired then 1 else 0 end,
                      case when judged.pinned then 0
                           when judged.read_at is null or judged.read_at > coalesce(p_as_of, now()) then 1
                           else 2 end,
                      judged.published_at desc,
                      judged.id desc) as place
      from judged
  )
  select placed.id, placed.title, placed.body, placed.group_id, placed.audience, placed.priority,
         placed.pinned, placed.links, placed.published_at, placed.deadline, placed.min_level,
         placed.created_by, placed.approval_status, placed.rejection_reason, placed.read_at,
         placed.expired, placed.total, coalesce(p_as_of, now())
    from placed
   order by placed.place
   limit p_limit offset p_offset;
$$;

comment on function private.announcement_feed_impl(bigint, boolean, integer, integer, timestamptz) is
  'Body of public.announcement_feed: private.announcement_feed_rows with the expired ones last (R62: a Termen before p_as_of) and R15''s order inside each list, as of p_as_of (now when null), cut by p_limit and p_offset, with whether each is expired, the unpaged count in total and the moment in as_of.';

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
  expired boolean,
  total bigint,
  as_of timestamptz)
language sql
stable
set search_path = ''
as $$
  select * from private.announcement_feed_impl(p_group_id, p_preferred, p_limit, p_offset, p_as_of);
$$;

comment on function public.announcement_feed(bigint, boolean, integer, integer, timestamptz) is
  'A page of the Anunțuri feed (spec 2026-10-14 member reads, ruling R56), in one request: the Announcements the caller reads (exactly announcements_read; never a Deal), p_preferred (R43) without an unticked Group''s that is neither critical, organization-wide nor theirs, p_group_id that Group and every Group below it; R62 puts every expired one (a Termen before p_as_of; never one without a Termen) after every other, pinned or unread included, and expired says which, for the page''s Termen expirat list; inside each list R15''s order (pinned, unread, read; newest first; id last) as of p_as_of -- a read made, or a Termen passed, after it orders as it did before, so the pages of one reading never shift; null means now, and as_of answers the moment used, for the next page to pass on; p_limit 1..100 (20 by default) and p_offset cut the page, total is the count before the cut; read_at is the caller''s own read time. PT400 invalid_page. Nothing without organization claims.';

revoke execute on function private.announcement_feed_impl(bigint, boolean, integer, integer, timestamptz)
  from public, anon, authenticated, service_role;
revoke execute on function public.announcement_feed(bigint, boolean, integer, integer, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.announcement_feed_impl(bigint, boolean, integer, integer, timestamptz) to authenticated;
grant execute on function public.announcement_feed(bigint, boolean, integer, integer, timestamptz) to authenticated;
