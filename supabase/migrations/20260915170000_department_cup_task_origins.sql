-- #259: derive Department Cup totals from the Task Origin, filterable by Campaign.
--
-- Two decisions this migration records, because neither is obvious from the SQL:
--
-- 1. Attribution follows the *Task*, never the Executor's current memberships
--    (ADR-0007 "Lifecycle and points"). A Department Task credits its
--    Department; a Department-Team Task credits the Team's parent Department
--    (`coalesce(task.dept_id, team.dept_id)`); a Project Task and an
--    Independent-Team Task (a Team with no parent Department) credit nobody.
--    Only `points_ledger.reason in ('task', 'task_reversal')` counts -- a
--    sanction is a personal matter and never moves a Department's standing.
--
-- 2. The competing rows are exactly `departments.kind = 'department'`. The
--    earlier draft of this migration also pinned the five ids
--    ('edu','pr','youth','fin','hr'). That was a duplicate statement of the
--    same rule -- #310 gave `diverse` and `secretariat` kind = 'coordination'
--    precisely so the Cup would exclude them, and `org` is kind = 'org' -- and
--    a hard-coded list would silently drop a sixth real Department the day
--    OSUBB creates one. The `kind` predicate is the rule; the id list is gone.
--
-- Campaign is the only filter the Cup takes. ADR-0007 gives the Leaderboard
-- four (Department, Team, Project, Campaign); three of those are meaningless
-- here, because the Cup's *rows* are the Departments and Project work never
-- enters it at all. `public.department_cup(p_campaign_id)` is the filtered
-- read; `public.dept_cup` stays as the unfiltered view the Dashboard card
-- already reads.

create function private.department_cup_rows(p_campaign_id bigint)
returns table (
  dept_id text,
  name text,
  points int,
  members bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with task_points as (
    select coalesce(task.dept_id, team.dept_id) as department_id,
           sum(entry.delta)::int as points
      from public.points_ledger as entry
      join public.tasks as task on task.id = entry.task_id
      left join public.teams as team on team.id = task.team_id
     where entry.reason in ('task', 'task_reversal')
       and (
         task.dept_id is not null
         or (task.team_id is not null and team.dept_id is not null)
       )
       and (p_campaign_id is null or task.campaign_id = p_campaign_id)
     group by coalesce(task.dept_id, team.dept_id)
  ), active_members as (
    select membership.dept_id, count(*)::bigint as members
      from public.member_departments as membership
      join public.profiles as member on member.id = membership.member_id
     where member.status = 'activ'
     group by membership.dept_id
  )
  select department.id,
         department.name,
         coalesce(task_points.points, 0),
         coalesce(active_members.members, 0)
    from public.departments as department
    left join task_points on task_points.department_id = department.id
    left join active_members on active_members.dept_id = department.id
   where public.auth_level() >= 5
     and (select private.caller_level()) >= 5
     and exists (
       select 1
         from public.profiles as caller
        where caller.id = (select auth.uid())
          and caller.status = 'activ'
     )
     and department.kind = 'department'
   order by coalesce(task_points.points, 0) desc, department.name asc;
$$;

comment on function private.department_cup_rows(bigint) is
  'The Department Cup rows for a live BCE+ caller, optionally narrowed to one Campaign. Totals include only Task and reversal ledger entries whose Task Origin is that Department or one of its Department Teams. Competing rows are departments.kind = ''department'' -- coordination structures and the org row never appear.';

revoke execute on function private.department_cup_rows(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.department_cup_rows(bigint) to authenticated;

-- The filtered read J1's leadership screen calls. A `security invoker`
-- wrapper over the `security definer` body, exactly like every command.
create function public.department_cup(p_campaign_id bigint default null)
returns table (
  dept_id text,
  name text,
  points int,
  members bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.department_cup_rows(p_campaign_id);
$$;

comment on function public.department_cup(bigint) is
  'Department standings for live BCE, BC, and Moderator Members, optionally narrowed to one Campaign. Task Points follow each Task Origin: Department and Department-Team Tasks qualify; Project and Independent-Team Tasks do not. A caller below level 5, an inactive Member, and a claimless session all receive no rows rather than an error.';

revoke execute on function public.department_cup(bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.department_cup(bigint) to authenticated;

-- The legacy view keeps its name, columns and grants; only its body changes,
-- from "sum the current members' whole ledgers" to "sum this Department's
-- Task Origins". `app/src/queries/points.ts` reads it for the Dashboard card
-- and needs no change; #376 retires it once J1 moves that card onto
-- public.department_cup.
create or replace view public.dept_cup
with (security_invoker = on)
as
  select cup.dept_id, cup.name, cup.points, cup.members
    from private.department_cup_rows(null::bigint) as cup;

comment on view public.dept_cup is
  'Unfiltered Department standings for live BCE, BC, and Moderator Members. Task Points follow each Task Origin: Department and Department-Team Tasks qualify; Project and Independent-Team Tasks do not. Diverse and Secretariat never compete.';

revoke all on table public.dept_cup
  from public, anon, authenticated, service_role;
grant select on table public.dept_cup to authenticated;
