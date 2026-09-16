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
--    `tasks_exactly_one_origin_check` is what makes the two spellings provably
--    identical: `dept_id` and `team_id` are never both set, so
--    `coalesce(a, b) = p` and `a = p or b = p` cannot diverge.
--    `leadership_leaderboard.test.sql` cross-checks the two bodies against each
--    other rather than trusting that reasoning.
--    `p_team_id`, `p_project_id` and `p_campaign_id` match the Task's own
--    column. Filters combine with `and`; all four null is the whole board.
--    An **Independent** Team (`teams.dept_id is null`) belongs to no
--    Department: its work is on the board unfiltered and under `p_team_id`,
--    and no Department filter can reach it -- `origin_team.dept_id =
--    p_department_id` is `null = 'x'`, which is `null`, not true. Never
--    `coalesce(origin_team.dept_id, '')`: that would file every
--    Independent-Team and every Department-less Task under the empty
--    Department id. Note that this differs from the Cup, which drops
--    Independent-Team work from its totals entirely; the Leaderboard keeps it,
--    exactly as it keeps Project work.
--
-- 3. **Eligibility outlives the Profile.** ADR-0007: "Anyone with completed
--    Task history remains eligible regardless of their current Profile
--    status." `public.profiles` is joined for the *name* and nothing else --
--    there is deliberately no `status = 'activ'` predicate on the subject, and
--    that is the one difference from the legacy `public.leaderboard` view most
--    likely to be "fixed" back by a well-meaning later migration.
--    `leadership_leaderboard.test.sql` pins it.
--
-- 4. **Task history is what makes a row -- not a positive net.** Every member
--    with at least one `task`/`task_reversal` entry in scope is a row,
--    whatever it sums to. There is deliberately **no `having`** here. An
--    earlier draft carried `having sum(...) <> 0`, which made a member whose
--    single award was reversed vanish while a member on -2 stayed: a member
--    with Task history is on the board, and hiding exactly the zero is an
--    arbitrary line, not a rule. ADR-0007's "points may be zero or negative"
--    is the same reasoning applied one step further. A reversal therefore
--    shows as subtraction (0, or a negative) rather than as a disappearance,
--    which is also what makes the netting observable from the board itself.
--
-- 5. **Equal points take a *shared* rank.** `rank() over (order by
--    scored.points desc)` -- points alone, no tiebreak inside the window -- so
--    two members on 3 points are both rank 2 and the next member is rank 4
--    (the standard `rank()` gap). This matches the legacy `public.leaderboard`
--    (`20260907204817_leadership_only_global_points.sql:29`), which BC and BCE
--    read today, so the board they already know does not silently change its
--    tie behavior underneath them. `full_name` belongs on the **result's**
--    `order by` only, where it makes the row order deterministic; putting it
--    inside the window degenerates `rank` into a row number and is the one
--    edit here that would look like a harmless simplification.
--
-- 6. **Row order is contractual on both functions.** The `order by` is
--    repeated on the `security invoker` wrapper rather than left to survive
--    SQL-function inlining from the body: a wrapper that is `select * from
--    impl(...)` inherits the inner ordering in practice but is not promised
--    it, and PostgREST will add its own `order`/`limit` on top. Plan Task J1
--    may still sort client-side; it does not have to.
--
-- 7. **Note for plan Task J1: the board is unbounded.** With no `having` and
--    no `p_limit`, an unfiltered read is one row per member with any Task
--    ledger entry -- the whole earning roster. A limit is deliberately *not* a
--    parameter here: PostgREST applies `.limit()`/`.range()` to an RPC result
--    directly and the ordering above is part of the contract, so paging
--    belongs in J1's query, not in this signature.
--
-- The gate is character-for-character the one `private.department_cup_rows`
-- (#259) and `private.leadership_member_tasks_impl` (#260) use: JWT level >= 5,
-- live role level >= 5, and an `activ` profile for `auth.uid()`. The JWT half
-- is what makes the predicate unsatisfiable without org claims (house rule 12);
-- the live half is what makes a demotion take effect before the token expires.
-- The third conjunct is belt-and-braces, kept only so all three leadership
-- reads read alike: `private.caller_level()` is itself
-- `coalesce((select level ... where id = auth.uid() and status = 'activ'), -1)`,
-- so the `>= 5` conjunct above it already requires a live `activ` profile and
-- deleting the `exists` would redden nothing. It is consistency, not the
-- liveness check -- do not "simplify" `caller_level()` believing otherwise.
-- A caller who fails the gate gets **no rows**, never an error -- this is a
-- read surface, not a command.

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
  )
  select scored.member_id,
         member.full_name,
         scored.points,
         -- Points alone: equal points share a rank (header item 5). Adding
         -- `member.full_name` here would turn `rank` into a row number.
         rank() over (order by scored.points desc)::int
    from task_points as scored
    join public.profiles as member on member.id = scored.member_id
   order by scored.points desc, member.full_name asc;
$$;

comment on function private.leadership_leaderboard_impl(text, text, bigint, bigint) is
  'Body of the leadership Leaderboard: member id, name and net Task Points for a live BCE+ caller, ranked points-descending with equal points sharing a rank, ordered points-descending then by name, optionally narrowed to a Department (including its Department Teams), a Team, a Project or a Campaign. Only ledger rows with reason task/task_reversal count -- sanctions never appear. Every member with Task history in scope is a row, including one whose awards net to zero or below; members whose Profile is no longer activ are rows too. Returns no rows -- never an error -- to a caller below level 5, an inactive Member, or a claimless session.';

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
  -- The `order by` is repeated deliberately (header item 6): the body's
  -- ordering survives inlining today but is not a guarantee Postgres makes,
  -- and row order is part of what J1 renders.
  select *
    from private.leadership_leaderboard_impl(
           p_department_id, p_team_id, p_project_id, p_campaign_id)
   order by points desc, full_name asc;
$$;

comment on function public.leadership_leaderboard(text, text, bigint, bigint) is
  'Task-Points Leaderboard for live BCE, BC, and Moderator Members: member name and points only, no role, email or Department. Filters describe the Task that produced the points -- a Department includes its Department Teams, and an Independent Team belongs to no Department -- never the member''s current memberships, and a member with Task history stays eligible after deactivation. Rows are ordered by points descending then name; equal points share a rank. Every member with Task history in scope appears, including at zero or below, so the board is unbounded -- page it client-side. A caller below level 5, an inactive Member, and a claimless session all receive no rows rather than an error.';

revoke execute on function private.leadership_leaderboard_impl(text, text, bigint, bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.leadership_leaderboard(text, text, bigint, bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.leadership_leaderboard_impl(text, text, bigint, bigint) to authenticated;
grant execute on function public.leadership_leaderboard(text, text, bigint, bigint) to authenticated;
