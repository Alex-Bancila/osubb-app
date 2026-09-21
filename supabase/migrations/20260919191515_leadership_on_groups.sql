-- #523: leadership filters use Group subtrees; Cup attribution follows Group settings.
-- Read gates stay byte-identical: signed rank >=5, live rank >=5 and active Profile.
-- Drop dependent entrypoints before changing returned columns or argument signatures.
drop view public.dept_cup;
drop function public.department_cup(bigint);
drop function private.department_cup_rows(bigint);
drop function public.leadership_leaderboard(text,text,bigint,bigint);
drop function private.leadership_leaderboard_impl(text,text,bigint,bigint);
drop function public.leadership_member_tasks(uuid);
drop function private.leadership_member_tasks_impl(uuid);

create function private.department_cup_rows(p_campaign_id bigint)
returns table (
  dept_id text,
  name text,
  points int,
  members bigint,
  group_id bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with task_points as (
    select cup.id as cup_group_id, sum(entry.delta)::int as points
      from public.points_ledger as entry
      join public.tasks as task on task.id = entry.task_id
      join public.groups as task_group on task_group.id = task.group_id
      join lateral (
        select competing.id, ancestor.depth
          from unnest(task_group.path) with ordinality as ancestor(id, depth)
          join public.groups as competing on competing.id = ancestor.id and competing.competes_in_cup
         order by ancestor.depth desc
         limit 1
      ) as cup on true
     where entry.reason in ('task', 'task_reversal')
       and (p_campaign_id is null or task.campaign_id = p_campaign_id)
       and not exists (
         select 1 from unnest(task_group.path) with ordinality as link(id, depth)
           join public.groups as node on node.id = link.id
          where link.depth > cup.depth and not node.counts_toward_parent_cup)
     group by cup.id
  ), active_members as (
    select membership.group_id, count(*)::bigint as members
      from public.group_members as membership
      join public.profiles as member on member.id = membership.member_id
     where member.status = 'activ'
     group by membership.group_id
  )
  select grp.legacy_dept_id, grp.name,
         coalesce(task_points.points, 0), coalesce(active_members.members, 0), grp.id
    from public.groups as grp
    left join task_points on task_points.cup_group_id = grp.id
    left join active_members on active_members.group_id = grp.id
   where public.auth_level() >= 5
     and (select private.caller_level()) >= 5
     and exists (
       select 1
         from public.profiles as caller
        where caller.id = (select auth.uid())
          and caller.status = 'activ'
     )
     and grp.competes_in_cup
   order by coalesce(task_points.points, 0) desc, grp.name asc;
$$;

create function public.department_cup(p_campaign_id bigint default null)
returns table (
  dept_id text,
  name text,
  points int,
  members bigint,
  group_id bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.department_cup_rows(p_campaign_id);
$$;

create view public.dept_cup with (security_invoker = on) as
  select cup.dept_id, cup.name, cup.points, cup.members, cup.group_id
  from private.department_cup_rows(null::bigint) as cup
  order by cup.points desc, cup.name asc;
revoke all on public.dept_cup from public, anon, authenticated, service_role;
grant select on public.dept_cup to authenticated;

create function private.leadership_leaderboard_impl(
  p_group_id bigint,
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
      join public.groups as task_group on task_group.id = task.group_id
     where entry.reason in ('task', 'task_reversal')
       and public.auth_level() >= 5
       and (select private.caller_level()) >= 5
       and exists (
         select 1
           from public.profiles as caller
          where caller.id = (select auth.uid())
            and caller.status = 'activ'
       )
       and (p_group_id is null or task_group.path @> array[p_group_id])
       and (p_campaign_id is null or task.campaign_id = p_campaign_id)
     group by entry.member_id
  )
  select scored.member_id,
         member.full_name,
         scored.points,
         rank() over (order by scored.points desc)::int
    from task_points as scored
    join public.profiles as member on member.id = scored.member_id
   order by scored.points desc, member.full_name asc;
$$;

create function public.leadership_leaderboard(
  p_group_id bigint default null,
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
           p_group_id, p_campaign_id)
   order by points desc, full_name asc;
$$;

create function private.leadership_member_tasks_impl(p_member_id uuid)
returns table (
  assignment_id bigint,
  member_id uuid,
  assigned_at timestamptz,
  assigned_by uuid,
  assignment_ended_at timestamptz,
  assignment_end_reason text,
  assignment_end_note text,
  task_id bigint,
  title text,
  description text,
  deadline timestamptz,
  task_kind text,
  audience text,
  assignment_mode text,
  status public.task_status,
  is_overdue boolean,
  completed_late boolean,
  difficulty int,
  rating int,
  started_at timestamptz,
  submitted_at timestamptz,
  review_round int,
  returned_to_progress_at timestamptz,
  completed_at timestamptz,
  unfulfilled_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  queue_opened_at timestamptz,
  queue_closed_at timestamptz,
  task_created_at timestamptz,
  task_created_by uuid,
  duplicated_from_task_id bigint,
  origin_type text,
  origin_id text,
  origin_name text, group_id bigint, group_name text,
  campaign_id bigint,
  campaign_name text,
  parent_task_id bigint,
  parent_task_title text,
  subtasks jsonb,
  evaluation_history jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select assignment.id,
         assignment.member_id,
         assignment.assigned_at,
         assignment.assigned_by,
         assignment.ended_at,
         assignment.end_reason,
         assignment.end_note,
         task.id,
         task.title,
         task.description,
         task.deadline,
         task.kind,
         task.audience,
         task.assignment_mode,
         task.status,
         coalesce(task.deadline < statement_timestamp(), false)
           and task.status in ('todo', 'in_progress', 'in_review'),
         task.status = 'completed'
           and coalesce(task.completed_at > task.deadline, false),
         task.difficulty,
         task.rating,
         task.started_at,
         task.submitted_at,
         task.review_round,
         task.returned_to_progress_at,
         task.completed_at,
         task.unfulfilled_at,
         task.cancelled_at,
         task.cancel_reason,
         task.queue_opened_at,
         task.queue_closed_at,
         task.created_at,
         task.created_by,
         task.duplicated_from_task_id,
         case
           when task.dept_id is not null then 'department'
           when task.team_id is not null then
             case when origin_team.dept_id is null then 'independent_team' else 'department_team' end
           else 'project'
         end,
         coalesce(task.dept_id, task.team_id, task.project_id::text),
         coalesce(origin_department.name, origin_team.name, origin_project.name),
         task.group_id,
         origin_group.name,
         campaign.id,
         campaign.name,
         parent.id,
         parent.title,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', child.id,
                    'title', child.title,
                    'status', child.status,
                    'completed_late', child.status = 'completed'
                      and coalesce(child.completed_at > child.deadline, false)
                  ) order by child.created_at, child.id)
             from public.tasks as child
            where child.parent_task_id = task.id
         ), '[]'::jsonb),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', evaluation.id,
                    'source', evaluation.source,
                    'outcome', evaluation.outcome,
                    'difficulty', evaluation.difficulty,
                    'rating', evaluation.rating,
                    'points', evaluation.points,
                    'note', evaluation.note,
                    'evaluated_at', evaluation.evaluated_at,
                    'evaluated_by', evaluation.evaluated_by,
                    'reversed_at', evaluation.reversed_at,
                    'reversed_by', evaluation.reversed_by,
                    'reversal_reason', evaluation.reversal_reason
                  ) order by evaluation.evaluated_at, evaluation.id)
             from public.task_evaluations as evaluation
            where evaluation.assignment_id = assignment.id
         ), '[]'::jsonb)
    from public.task_assignments as assignment
    join public.tasks as task on task.id = assignment.task_id
    join public.groups as origin_group on origin_group.id = task.group_id
    left join public.departments as origin_department on origin_department.id = task.dept_id
    left join public.teams as origin_team on origin_team.id = task.team_id
    left join public.projects as origin_project on origin_project.id = task.project_id
    left join public.campaigns as campaign on campaign.id = task.campaign_id
    left join public.tasks as parent on parent.id = task.parent_task_id
   where assignment.member_id = p_member_id
     and public.auth_level() >= 5
     and (select private.caller_level()) >= 5
     and exists (
       select 1
         from public.profiles as caller
        where caller.id = (select auth.uid())
          and caller.status = 'activ'
     )
   order by assignment.assigned_at desc, assignment.id desc;
$$;

create function public.leadership_member_tasks(p_member_id uuid)
returns table (
  assignment_id bigint, member_id uuid, assigned_at timestamptz, assigned_by uuid,
  assignment_ended_at timestamptz, assignment_end_reason text, assignment_end_note text,
  task_id bigint, title text, description text, deadline timestamptz, task_kind text,
  audience text, assignment_mode text,
  status public.task_status, is_overdue boolean, completed_late boolean,
  difficulty int, rating int, started_at timestamptz, submitted_at timestamptz,
  review_round int, returned_to_progress_at timestamptz, completed_at timestamptz,
  unfulfilled_at timestamptz, cancelled_at timestamptz, cancel_reason text,
  queue_opened_at timestamptz, queue_closed_at timestamptz,
  task_created_at timestamptz, task_created_by uuid, duplicated_from_task_id bigint,
  origin_type text, origin_id text, origin_name text, group_id bigint, group_name text, campaign_id bigint,
  campaign_name text, parent_task_id bigint, parent_task_title text,
  subtasks jsonb, evaluation_history jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.leadership_member_tasks_impl(p_member_id);
$$;

revoke execute on function private.department_cup_rows(bigint) from public, anon, authenticated, service_role;
grant execute on function private.department_cup_rows(bigint) to authenticated;

revoke execute on function public.department_cup(bigint) from public, anon, authenticated, service_role;
grant execute on function public.department_cup(bigint) to authenticated;

revoke execute on function private.leadership_leaderboard_impl(bigint,bigint) from public, anon, authenticated, service_role;
grant execute on function private.leadership_leaderboard_impl(bigint,bigint) to authenticated;

revoke execute on function public.leadership_leaderboard(bigint,bigint) from public, anon, authenticated, service_role;
grant execute on function public.leadership_leaderboard(bigint,bigint) to authenticated;

revoke execute on function private.leadership_member_tasks_impl(uuid) from public, anon, authenticated, service_role;
grant execute on function private.leadership_member_tasks_impl(uuid) to authenticated;

revoke execute on function public.leadership_member_tasks(uuid) from public, anon, authenticated, service_role;
grant execute on function public.leadership_member_tasks(uuid) to authenticated;

comment on function private.department_cup_rows(bigint) is
  'Live BCE+ Cup rows from competing Group settings. Task/reversal ledger points reach the nearest competing ancestor only when every lower link counts. Members are the active explicit roster of the competitor itself.';
comment on function public.department_cup(bigint) is
  'Campaign-filtered Group Cup standings, preserving legacy Department columns and appending Group id. Failed leadership gates return no rows.';
comment on view public.dept_cup is
  'Unfiltered Cup standings by competing Group, with compatibility Department id where mapped. Only Task points and reversals count, attributed through the Group ancestor chain.';
comment on function public.leadership_leaderboard(bigint,bigint) is
  'Live BCE+ Task-points Leaderboard filtered by Group subtree and Campaign. Retains inactive earners, zero/negative totals, shared ranks on ties, and stable points-descending/name ordering.';
comment on function private.leadership_leaderboard_impl(bigint,bigint) is
  'Group-subtree Leaderboard body. Filters follow the Task Group, never the Member roster; Cup participation settings do not restrict the board.';
comment on function public.leadership_member_tasks(uuid) is
  'Live BCE+ Assignment history with Group id/name beside the legacy Origin presentation triple, plus Task and Evaluation history.';
comment on function private.leadership_member_tasks_impl(uuid) is
  'One row per selected Member Assignment, newest first. Includes owning Group identity while preserving the legacy Origin presentation fields until Wave 3.';
