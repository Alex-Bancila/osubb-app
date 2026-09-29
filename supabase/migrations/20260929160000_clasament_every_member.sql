-- #907: the Clasament lists every Member below BCE, 0 points included.
--
-- Alex, 2026-09-29: "I want to see all the volunteers that are not
-- BC/BCE/Moderator." This amends ruling 1 of 2026-09-28 (#843: BC and the
-- Moderator hidden, BCE ranked) by hiding BCE too, and drops the "only Members
-- with ledger rows" behaviour the board has had since #258.
--
-- Rows are now:
--   * every active Member whose Role is Recrut, Voluntar, Voluntar Activ or
--     Voluntar cu Drept de Vot, at 0 points when they earned nothing under the
--     filter; with a Group filter, only those on the roster of that Group or a
--     Group below it (explicit `group_members` rows; an Automatic-Membership
--     Group such as the Organization Group never widens the roster);
--   * plus every Member with one of those Roles who earned Task Points under
--     the filter, whatever their Profile status (ADR-0007: Task history keeps
--     a deactivated Member eligible) and whether or not they are on the roster
--     (the points follow the Task's Group, never the Member's -- R11).
-- A Campaign or a date range never narrows the set of Members, only their
-- points. BCE, BC and the Moderator are never rows. Ties share a rank
-- (`rank()`), so the Members with no points share the last rank above any
-- negative total; rows order by points, then full name.
--
-- Rebuilt from main's latest body (#843, 20260928100000_notification_links.sql).
-- The signature and result type are unchanged, so the public wrapper (security
-- invoker, ordering on the same keys) and every grant stay as they are; only
-- the two comments move with the behaviour. The BCE+ gate moves from the
-- ledger read into a `gate` row both branches join, so the roster branch is
-- gated exactly like the points.

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
    -- A Group filter: the active Members on the explicit roster of that
    -- Group's subtree. Automatic Membership is never expanded here, and an
    -- Automatic-Membership Group's own rows (its appointed Group Roles) do not
    -- widen the board either (#907).
    select membership.member_id
      from gate
     cross join public.group_members as membership
      join public.groups as roster_group on roster_group.id = membership.group_id
      join public.profiles as member on member.id = membership.member_id
     where p_group_id is not null
       and roster_group.path @> array[p_group_id]
       and not roster_group.automatic_membership
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
  'Group-subtree Leaderboard body. Rows are every active Member below BCE (Recrut, Voluntar, Voluntar Activ, Voluntar cu Drept de Vot) -- with a Group filter, those on the explicit roster of that Group''s subtree, Automatic-Membership Groups excluded -- plus every Member below BCE who earned Task Points under the filter, whatever their status (#907). Points follow the Task Group, never the Member roster; Cup participation settings do not restrict the board; a Campaign or a date range narrows the points, never the Members. The date range (#677) reads the award instant -- task_evaluations.evaluated_at through points_ledger.evaluation_id, for a credit and its reversal alike -- half-open [p_from, p_to); PT400 invalid_date_range first when p_to < p_from.';

comment on function public.leadership_leaderboard(bigint, bigint, timestamptz, timestamptz) is
  'Live BCE+ Task-points Leaderboard filtered by Group subtree, Campaign and award date range (#677: [p_from, p_to) on the Evaluation instant, either bound optional; PT400 invalid_date_range when p_to < p_from). Lists every active Member below BCE, at 0 points when they earned nothing (with a Group filter, the Members of that Group''s subtree), and retains inactive earners (#907). Never ranks BCE, BC or the Moderator (ruling 1 of 2026-09-28, amended by #907). Zero/negative totals, shared ranks on ties, and stable points-descending/name ordering. Returns the Nickname beside the full name.';
