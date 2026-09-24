-- #677: Work Filter date ranges (R3, R11, R13) on the ranking and report reads -- p_from / p_to on the award instant for the Leaderboard, the Cup and the Campaign report, and on the Task deadline for the Member drill-down.
--
-- The award instant. Every `task` ledger row and the `task_reversal` row that
-- undoes it carry ONE evaluation_id (20260911211500_ledger_evaluations.sql,
-- points_ledger_evaluation_reason_uidx), and points_ledger_task_reference_ck
-- makes that id mandatory on both reasons. The range therefore reads
-- task_evaluations.evaluated_at through points_ledger.evaluation_id for the
-- credit and its reversal alike: a reversed award nets to zero inside any
-- range that contains its Evaluation and leaves no phantom negative in a
-- later range. The ledger row's own created_at is deliberately not read --
-- it would date the reversal at the reopen and split the pair across ranges.
-- Because the reference is mandatory, the new inner join to task_evaluations
-- drops no row, so a call with no range returns exactly what it did before.
--
-- Range semantics, identical in all five readers: `p_from is null or instant
-- >= p_from` and `p_to is null or instant < p_to` -- half-open, so the client
-- sends the day after "Până la" at Bucharest midnight as p_to. An inverted
-- range (both set, p_to < p_from) is malformed for every caller and is
-- refused at step 1 (conventions §2), before any authority check, by the one
-- shared helper private.require_date_range: PT400 invalid_date_range.
--
-- PostgREST cannot choose between two overloads of one name (PGRST203), so
-- every reader is dropped and recreated rather than overloaded; every body is
-- rebuilt from main's latest version (#675's nickname bodies for the
-- Leaderboard and the Campaign report, #579's for the Cup and the
-- drill-down). The dept_cup view depends on private.department_cup_rows and
-- is dropped first, then recreated over the unbounded call with its grants.

-- ==================== 1. The shared step-1 range check ====================

create function private.require_date_range(p_from timestamptz, p_to timestamptz)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_from is not null and p_to is not null and p_to < p_from then
    raise sqlstate 'PT400' using message = 'invalid_date_range';
  end if;
end;
$$;

comment on function private.require_date_range(timestamptz, timestamptz) is
  'Work Filter step-1 check (#677, ruling R8): PT400 invalid_date_range when both bounds are set and p_to < p_from. An equal pair is an empty half-open range, not an error. Called only from the security-definer reader bodies, which run as its owner -- no execute grant of its own.';

revoke execute on function private.require_date_range(timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

-- ==================== 2. The leadership Leaderboard ====================

drop function public.leadership_leaderboard(bigint, bigint);
drop function private.leadership_leaderboard_impl(bigint, bigint);

create function private.leadership_leaderboard_impl(
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

  with task_points as (
    select entry.member_id as member_id,
           sum(entry.delta)::int as points
      from public.points_ledger as entry
      join public.task_evaluations as evaluation on evaluation.id = entry.evaluation_id
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
       and (p_from is null or evaluation.evaluated_at >= p_from)
       and (p_to is null or evaluation.evaluated_at < p_to)
     group by entry.member_id
  )
  select scored.member_id,
         member.full_name,
         member.nickname,
         scored.points,
         rank() over (order by scored.points desc)::int
    from task_points as scored
    join public.profiles as member on member.id = scored.member_id
   order by scored.points desc, member.full_name asc;
$$;

comment on function private.leadership_leaderboard_impl(bigint, bigint, timestamptz, timestamptz) is
  'Group-subtree Leaderboard body. Filters follow the Task Group, never the Member roster; Cup participation settings do not restrict the board. The date range (#677) reads the award instant -- task_evaluations.evaluated_at through points_ledger.evaluation_id, for a credit and its reversal alike -- half-open [p_from, p_to); PT400 invalid_date_range first when p_to < p_from.';

create function public.leadership_leaderboard(
  p_group_id bigint default null,
  p_campaign_id bigint default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (member_id uuid, full_name text, nickname text, points integer, rank integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
    from private.leadership_leaderboard_impl(
           p_group_id, p_campaign_id, p_from, p_to)
   order by points desc, full_name asc;
$$;

comment on function public.leadership_leaderboard(bigint, bigint, timestamptz, timestamptz) is
  'Live BCE+ Task-points Leaderboard filtered by Group subtree, Campaign and award date range (#677: [p_from, p_to) on the Evaluation instant, either bound optional; PT400 invalid_date_range when p_to < p_from). Retains inactive earners, zero/negative totals, shared ranks on ties, and stable points-descending/name ordering. Returns the Nickname beside the full name.';

revoke execute on function private.leadership_leaderboard_impl(bigint, bigint, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
revoke execute on function public.leadership_leaderboard(bigint, bigint, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.leadership_leaderboard_impl(bigint, bigint, timestamptz, timestamptz) to authenticated;
grant execute on function public.leadership_leaderboard(bigint, bigint, timestamptz, timestamptz) to authenticated;

-- ==================== 3. The Department Cup and its view ====================

drop view public.dept_cup;
drop function public.department_cup(bigint);
drop function private.department_cup_rows(bigint);

create function private.department_cup_rows(
  p_campaign_id bigint,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  group_id bigint,
  name text,
  points int,
  members bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select private.require_date_range(p_from, p_to);

  with task_points as (
    select cup.id as cup_group_id, sum(entry.delta)::int as points
      from public.points_ledger as entry
      join public.task_evaluations as evaluation on evaluation.id = entry.evaluation_id
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
       and (p_from is null or evaluation.evaluated_at >= p_from)
       and (p_to is null or evaluation.evaluated_at < p_to)
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
  select grp.id, grp.name,
         coalesce(task_points.points, 0), coalesce(active_members.members, 0)
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

create function public.department_cup(
  p_campaign_id bigint default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  group_id bigint,
  name text,
  points int,
  members bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.department_cup_rows(p_campaign_id, p_from, p_to);
$$;

create view public.dept_cup with (security_invoker = on) as
  select cup.group_id, cup.name, cup.points, cup.members
  from private.department_cup_rows(null::bigint, null::timestamptz, null::timestamptz) as cup
  order by cup.points desc, cup.name asc;
revoke all on public.dept_cup from public, anon, authenticated, service_role;
grant select on public.dept_cup to authenticated;

revoke execute on function private.department_cup_rows(bigint, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.department_cup_rows(bigint, timestamptz, timestamptz) to authenticated;
revoke execute on function public.department_cup(bigint, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.department_cup(bigint, timestamptz, timestamptz) to authenticated;

comment on function private.department_cup_rows(bigint, timestamptz, timestamptz) is
  'Live BCE+ Cup rows from competing Group settings. Task/reversal ledger points reach the nearest competing ancestor only when every lower link counts. Members are the active explicit roster of the competitor itself. The date range (#677) reads the award instant -- task_evaluations.evaluated_at through points_ledger.evaluation_id -- half-open [p_from, p_to); PT400 invalid_date_range first when p_to < p_from.';
comment on function public.department_cup(bigint, timestamptz, timestamptz) is
  'Campaign- and award-date-filtered Group Cup standings as (group_id, name, points, members); the date range is [p_from, p_to) on the Evaluation instant, either bound optional (#677). Failed leadership gates return no rows; an inverted range is PT400 invalid_date_range.';
comment on view public.dept_cup is
  'Unfiltered Cup standings by competing Group as (group_id, name, points, members). Only Task points and reversals count, attributed through the Group ancestor chain.';

-- ==================== 4. The Campaign report and totals ====================

drop function public.campaign_report(bigint);
drop function private.campaign_report_impl(bigint);
drop function public.campaign_totals(bigint);
drop function private.campaign_totals_impl(bigint);

create function private.campaign_report_impl(
  p_campaign_id bigint,
  p_from timestamptz,
  p_to timestamptz
)
returns table (member_id uuid, full_name text, nickname text, tasks_completed integer, points integer)
language plpgsql
stable security definer
set search_path = ''
as $function$
begin
  perform private.require_date_range(p_from, p_to);
  perform private.require_campaign_report_access(p_campaign_id);

  return query
  with campaign_tasks as (
    select task.id, task.status
      from public.tasks as task
     where task.campaign_id = p_campaign_id
  ),
  -- Every Member who ever held the Executor Assignment on a Campaign Task
  -- (ruling 3) -- Assignment History, not the ledger, so a give-up or an
  -- unfulfilled/cancelled outcome still leaves the volunteer on the report.
  -- The date range narrows the numbers, never the roster.
  executors as (
    select distinct assignment.member_id
      from public.task_assignments as assignment
      join campaign_tasks as ct on ct.id = assignment.task_id
  ),
  -- Net ledger rows per (member, Task) awarded inside the range: the range
  -- reads the Evaluation's instant, which a credit and its reversal share,
  -- so a reversed award nets to zero in every range (#677).
  ledger_rows as (
    select entry.member_id, entry.task_id, entry.delta
      from public.points_ledger as entry
      join campaign_tasks as ct on ct.id = entry.task_id
      join public.task_evaluations as evaluation on evaluation.id = entry.evaluation_id
     where entry.reason in ('task', 'task_reversal')
       and (p_from is null or evaluation.evaluated_at >= p_from)
       and (p_to is null or evaluation.evaluated_at < p_to)
  ),
  -- One row per (member, Task): the member's NET ledger contribution to that
  -- Task -- both points and tasks_completed are derived from this single
  -- number, never from ledger row counts (#625 fix round 1).
  member_task_net as (
    select ledger_rows.member_id, ledger_rows.task_id,
           sum(ledger_rows.delta)::int as net_points
      from ledger_rows
     group by ledger_rows.member_id, ledger_rows.task_id
  ),
  points_by_member as (
    select member_task_net.member_id, sum(member_task_net.net_points)::int as points
      from member_task_net
     group by member_task_net.member_id
  ),
  -- A completed Task counts toward tasks_completed only where the member's
  -- OWN net on it inside the range is positive.
  completed_by_member as (
    select member_task_net.member_id,
           count(*)::int as tasks_completed
      from member_task_net
      join campaign_tasks as ct
        on ct.id = member_task_net.task_id and ct.status = 'completed'
     where member_task_net.net_points > 0
     group by member_task_net.member_id
  )
  select executors.member_id,
         profile.full_name,
         profile.nickname,
         coalesce(completed_by_member.tasks_completed, 0),
         coalesce(points_by_member.points, 0)
    from executors
    join public.profiles as profile on profile.id = executors.member_id
    left join points_by_member on points_by_member.member_id = executors.member_id
    left join completed_by_member on completed_by_member.member_id = executors.member_id
   order by coalesce(points_by_member.points, 0) desc, profile.full_name asc;
end;
$function$;

comment on function private.campaign_report_impl(bigint, timestamptz, timestamptz) is
  'One row per volunteer who ever held the Executor Assignment on a Task of this Campaign (Assignment History, not the ledger -- ruling 3); the date range never removes a volunteer. points is each member''s net points_ledger sum over the Campaign''s Tasks awarded in [p_from, p_to) -- the award instant is task_evaluations.evaluated_at through points_ledger.evaluation_id, shared by a credit and its reversal (#677, R13); tasks_completed counts only a completed Task on which that member''s OWN in-range net is positive. PT400 invalid_date_range when p_to < p_from, checked first; then PT404 campaign_not_found for an unknown Campaign, checked before authority (ruling 2); 42501 campaign_report_forbidden for a claimless/inactive caller or one private.can_manage_group_work refuses.';

create function public.campaign_report(
  p_campaign_id bigint,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  member_id       uuid,
  full_name       text,
  nickname        text,
  tasks_completed int,
  points          int
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.campaign_report_impl(p_campaign_id, p_from, p_to);
$$;

comment on function public.campaign_report(bigint, timestamptz, timestamptz) is
  'Per-volunteer Campaign report (member_id, full_name, nickname, tasks_completed, points), optionally narrowed to points awarded in [p_from, p_to) (#677, R13); callable only by whoever manages work in the Campaign''s Group, or BC/Moderator (private.can_manage_group_work). PT400 invalid_date_range when p_to < p_from; PT404 campaign_not_found for an unknown Campaign; 42501 campaign_report_forbidden otherwise.';

create function private.campaign_totals_impl(
  p_campaign_id bigint,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  tasks_total     int,
  tasks_completed int,
  points_total    int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_date_range(p_from, p_to);
  perform private.require_campaign_report_access(p_campaign_id);

  return query
  with campaign_tasks as (
    select task.id, task.status, task.completed_at
      from public.tasks as task
     where task.campaign_id = p_campaign_id
  ),
  -- The instant a completed Task's completion was awarded: its live
  -- (un-reversed) completed Evaluation, or -- for an Umbrella, which
  -- completes without an Evaluation -- its own completion instant.
  completed_tasks as (
    select ct.id,
           coalesce((
             select max(evaluation.evaluated_at)
               from public.task_evaluations as evaluation
              where evaluation.task_id = ct.id
                and evaluation.outcome = 'completed'
                and evaluation.reversed_at is null
           ), ct.completed_at) as awarded_at
      from campaign_tasks as ct
     where ct.status = 'completed'
  ),
  ledger_total as (
    select coalesce(sum(entry.delta), 0)::int as points_total
      from public.points_ledger as entry
      join campaign_tasks as ct on ct.id = entry.task_id
      join public.task_evaluations as evaluation on evaluation.id = entry.evaluation_id
     where entry.reason in ('task', 'task_reversal')
       and (p_from is null or evaluation.evaluated_at >= p_from)
       and (p_to is null or evaluation.evaluated_at < p_to)
  )
  select
    (select count(*) from campaign_tasks)::int,
    (select count(*)
       from completed_tasks
      where (p_from is null or completed_tasks.awarded_at >= p_from)
        and (p_to is null or completed_tasks.awarded_at < p_to))::int,
    (select ledger_total.points_total from ledger_total);
end;
$$;

comment on function private.campaign_totals_impl(bigint, timestamptz, timestamptz) is
  'tasks_total/tasks_completed/points_total for one Campaign -- every Task (any kind) carrying campaign_id = p_campaign_id, points summed off the points_ledger rows private.evaluate_task writes exactly as private.campaign_report_impl does. The date range (#677) follows the award instant: points_total sums ledger rows whose Evaluation (task_evaluations.evaluated_at via points_ledger.evaluation_id) falls in [p_from, p_to); tasks_completed counts completed Tasks whose live completed Evaluation -- or, for an Umbrella, whose completion -- falls in it; tasks_total ignores the range and stays the whole Campaign (R13 speaks of points only). PT400 invalid_date_range first when p_to < p_from; then the same PT404/42501 preamble as private.campaign_report_impl -- both share private.require_campaign_report_access.';

create function public.campaign_totals(
  p_campaign_id bigint,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  tasks_total     int,
  tasks_completed int,
  points_total    int
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.campaign_totals_impl(p_campaign_id, p_from, p_to);
$$;

comment on function public.campaign_totals(bigint, timestamptz, timestamptz) is
  'Whole-Campaign totals (tasks_total, tasks_completed, points_total). With a date range, points_total and tasks_completed follow the award instant in [p_from, p_to) and tasks_total stays the whole Campaign (#677, R13). Same authority and error shape as public.campaign_report.';

revoke execute on function private.campaign_report_impl(bigint, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.campaign_report_impl(bigint, timestamptz, timestamptz) to authenticated;
revoke execute on function public.campaign_report(bigint, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.campaign_report(bigint, timestamptz, timestamptz) to authenticated;
revoke execute on function private.campaign_totals_impl(bigint, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.campaign_totals_impl(bigint, timestamptz, timestamptz) to authenticated;
revoke execute on function public.campaign_totals(bigint, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.campaign_totals(bigint, timestamptz, timestamptz) to authenticated;

-- ==================== 5. The Member drill-down (deadline range) ====================

drop function public.leadership_member_tasks(uuid);
drop function private.leadership_member_tasks_impl(uuid);

create function private.leadership_member_tasks_impl(
  p_member_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
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
  group_id bigint, group_name text, campaign_id bigint,
  campaign_name text, parent_task_id bigint, parent_task_title text,
  subtasks jsonb, evaluation_history jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select private.require_date_range(p_from, p_to);

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
     and (p_from is null or task.deadline >= p_from)
     and (p_to is null or task.deadline < p_to)
   order by assignment.assigned_at desc, assignment.id desc;
$$;

create function public.leadership_member_tasks(
  p_member_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
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
  group_id bigint, group_name text, campaign_id bigint,
  campaign_name text, parent_task_id bigint, parent_task_title text,
  subtasks jsonb, evaluation_history jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.leadership_member_tasks_impl(p_member_id, p_from, p_to);
$$;

revoke execute on function private.leadership_member_tasks_impl(uuid, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.leadership_member_tasks_impl(uuid, timestamptz, timestamptz) to authenticated;
revoke execute on function public.leadership_member_tasks(uuid, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.leadership_member_tasks(uuid, timestamptz, timestamptz) to authenticated;

comment on function public.leadership_member_tasks(uuid, timestamptz, timestamptz) is
  'Live BCE+ Assignment history with the owning Group''s id and name, plus Task and Evaluation history. The date range (#677, R11) keeps only Assignments whose Task deadline is in [p_from, p_to); a Task with no deadline is excluded whenever either bound is set. PT400 invalid_date_range when p_to < p_from.';
comment on function private.leadership_member_tasks_impl(uuid, timestamptz, timestamptz) is
  'One row per selected Member Assignment, newest first, labelled by the Task''s owning Group, optionally narrowed to Task deadlines in [p_from, p_to) (#677); PT400 invalid_date_range first when p_to < p_from.';
