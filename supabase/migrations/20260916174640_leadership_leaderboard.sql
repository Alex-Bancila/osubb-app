-- #258: the leadership Leaderboard -- member name and Task Points only,
-- attributed to the Task that produced them.
--
-- Four decisions this migration records, because none is obvious from the SQL:
--
-- 1. **Task points only.** `points_ledger.reason in ('task', 'task_reversal')`
--    joined to `public.tasks` through `entry.task_id`. ADR-0007: "The
--    leadership Leaderboard contains member name and Task points only. …
--    Awards do not exist. Sanctions are a separate deferred feature and may
--    affect a member's personal total." A sanction moves the member's personal
--    total (`public.my_points`); it never moves this board. The legacy
--    `public.leaderboard` view sums the *whole* ledger and is left in place --
--    `app/src/queries/points.ts` still reads it for the Dashboard card, plan
--    Task J1 moves that card here, and #376 retires the view afterwards.
--
-- 2. **The filters describe the Task, never the member.** ADR-0007:
--    "Leaderboard and Department Cup filters (Department including its
--    Department Teams, Team, Project, Campaign) apply to the Task that
--    produced the points, never to the member's current memberships." So
--    `p_department_id` matches `task.dept_id` **or** the parent Department of
--    the Task's Team -- deliberately the same rule
--    `private.department_cup_rows` (#259) applies through
--    `coalesce(task.dept_id, team.dept_id)`, so the two leadership surfaces
--    can never disagree about which Department a Task belongs to.
--    `p_team_id`, `p_project_id` and `p_campaign_id` match the Task's own
--    column. Filters combine with `and`; all four null is the whole board.
--
-- 3. **Eligibility outlives the Profile.** ADR-0007: "Anyone with completed
--    Task history remains eligible regardless of their current Profile
--    status." `public.profiles` is joined for the *name* and nothing else --
--    there is deliberately no `status = 'activ'` predicate on the subject, and
--    that is the one difference from the legacy `public.leaderboard` view most
--    likely to be "fixed" back by a well-meaning later migration.
--    `leadership_leaderboard.test.sql` pins it.
--
-- 4. **A net of zero is not a row.** The board is "members ordered by Task
--    Points"; a member whose only award was reversed has no Task Points and
--    must disappear entirely rather than appear on zero. `having sum(...) <> 0`
--    -- not `> 0`: an `unfulfilled` Evaluation may be negative (ADR-0007
--    "points may be zero or negative"), and a member carrying a negative total
--    still has Task history and still belongs on the board, at the bottom.
--    The plan's draft SQL omitted this clause; see the report for #258.
--
-- 5. **`rank` carries the name tiebreak, so equal points get *consecutive*
--    ranks, not a shared one.** `rank() over (order by points desc, full_name
--    asc)` has no peer groups -- `full_name` is unique enough to break every
--    tie inside the window -- so two members on 12 points are ranks 2 and 3,
--    not 2 and 2. That is deliberate and is the signature plan Task J1 codes
--    against; it is also the one place this board differs from the legacy
--    `public.leaderboard`, whose `rank() over (order by points desc)` does
--    share a rank across ties. If OSUBB ever wants shared ranks here, drop
--    `full_name` from the *window's* order by and keep it on the result's --
--    do not "simplify" the two clauses into agreement by accident.
--
-- The gate is character-for-character the one `private.department_cup_rows`
-- (#259) and `private.leadership_member_tasks_impl` (#260) use: JWT level >= 5,
-- live role level >= 5, and an `activ` profile for `auth.uid()`. The JWT half
-- is what makes the predicate unsatisfiable without org claims (house rule 12);
-- the live half is what makes a demotion take effect before the token expires.
-- A caller who fails it gets **no rows**, never an error -- this is a read
-- surface, not a command.

create function private.leadership_leaderboard_impl(
  p_department_id text,
  p_team_id text,
  p_project_id bigint,
  p_campaign_id bigint
)
returns table (
  member_id uuid,
  full_name text,
  points int,
  rank int
)
language sql
stable
security definer
set search_path = ''
as $$
  with task_points as (
    select entry.member_id as member_id,
           sum(entry.delta)::int as points
      from public.points_ledger as entry
      join public.tasks as task on task.id = entry.task_id
      left join public.teams as origin_team on origin_team.id = task.team_id
     where entry.reason in ('task', 'task_reversal')
       and public.auth_level() >= 5
       and (select private.caller_level()) >= 5
       and exists (
         select 1
           from public.profiles as caller
          where caller.id = (select auth.uid())
            and caller.status = 'activ'
       )
       and (
         p_department_id is null
         or task.dept_id = p_department_id
         or origin_team.dept_id = p_department_id
       )
       and (p_team_id is null or task.team_id = p_team_id)
       and (p_project_id is null or task.project_id = p_project_id)
       and (p_campaign_id is null or task.campaign_id = p_campaign_id)
     group by entry.member_id
    having sum(entry.delta) <> 0
  )
  select scored.member_id,
         member.full_name,
         scored.points,
         rank() over (order by scored.points desc, member.full_name asc)::int
    from task_points as scored
    join public.profiles as member on member.id = scored.member_id
   order by scored.points desc, member.full_name asc;
$$;

comment on function private.leadership_leaderboard_impl(text, text, bigint, bigint) is
  'Body of the leadership Leaderboard: member id, name and net Task Points for a live BCE+ caller, ranked points-descending with a name tiebreak, optionally narrowed to a Department (including its Department Teams), a Team, a Project or a Campaign. Only ledger rows with reason task/task_reversal count -- sanctions never appear. Members with a net of zero are not rows; members whose Profile is no longer activ still are. Returns no rows -- never an error -- to a caller below level 5, an inactive Member, or a claimless session.';

-- The filtered read plan Task J1's leadership screen calls. A `security
-- invoker` wrapper over the `security definer` body, exactly like every
-- command and like #259's `public.department_cup`.
create function public.leadership_leaderboard(
  p_department_id text default null,
  p_team_id text default null,
  p_project_id bigint default null,
  p_campaign_id bigint default null
)
returns table (
  member_id uuid,
  full_name text,
  points int,
  rank int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
    from private.leadership_leaderboard_impl(
           p_department_id, p_team_id, p_project_id, p_campaign_id);
$$;

comment on function public.leadership_leaderboard(text, text, bigint, bigint) is
  'Task-Points Leaderboard for live BCE, BC, and Moderator Members: member name and points only, no role, email or Department. Filters describe the Task that produced the points -- a Department includes its Department Teams -- never the member''s current memberships, and a member with Task history stays eligible after deactivation. A caller below level 5, an inactive Member, and a claimless session all receive no rows rather than an error.';

revoke execute on function private.leadership_leaderboard_impl(text, text, bigint, bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.leadership_leaderboard(text, text, bigint, bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.leadership_leaderboard_impl(text, text, bigint, bigint) to authenticated;
grant execute on function public.leadership_leaderboard(text, text, bigint, bigint) to authenticated;
