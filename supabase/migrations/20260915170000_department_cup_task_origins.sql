-- #259: derive Department Cup totals from the Task Origin.

create function private.department_cup_rows()
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
     and department.id in ('edu', 'pr', 'youth', 'fin', 'hr')
   order by coalesce(task_points.points, 0) desc, department.name asc;
$$;

comment on function private.department_cup_rows() is
  'The five Department Cup rows for a live BCE+ caller. Totals include only Task and reversal ledger entries whose Task Origin is that Department or one of its Department Teams.';

revoke execute on function private.department_cup_rows()
  from public, anon, authenticated, service_role;
grant execute on function private.department_cup_rows() to authenticated;

create or replace view public.dept_cup
with (security_invoker = on)
as
  select cup.dept_id, cup.name, cup.points, cup.members
    from private.department_cup_rows() as cup;

comment on view public.dept_cup is
  'Department standings for live BCE, BC, and Moderator Members. Task Points follow each Task Origin: Department and Department-Team Tasks qualify; Project and Independent-Team Tasks do not. Diverse and Secretariat never compete.';

revoke all on table public.dept_cup
  from public, anon, authenticated, service_role;
grant select on table public.dept_cup to authenticated;
