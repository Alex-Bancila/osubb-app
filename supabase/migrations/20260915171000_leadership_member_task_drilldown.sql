-- #260: BCE+ drill-down over one Member's complete Assignment history.
--
-- One row per Assignment, not per Task: a Task that was reopened and reassigned
-- appears once for each time this Member held it, newest first.
--
-- The column list is deliberately wide. It is what ADR-0007's "a Leaderboard
-- row opens that member's authorized full Task Tracker" costs: the drill-down
-- screen (plan Task J1) must render a Task card, its Origin, its Campaign, its
-- Umbrella parent and Subtasks, the Assignment's own outcome, and the
-- Evaluation that produced the points -- without a second round trip. It
-- carries every `public.tasks_with_overdue` column, renaming the eight that
-- would collide with an Assignment-level name (`id`, `created_at`,
-- `created_by`, `kind`) or that the Origin triple replaces (`dept_id`,
-- `team_id`, `project_id`, plus the retired legacy `type`);
-- `leadership_member_tasks.test.sql` pins exactly that mapping, so a new
-- column on `public.tasks` fails there until this function carries it too.
--
-- The gate is the same one `public.department_cup` uses (#259) and the same
-- one the leadership Leaderboard will use: JWT level >= 5, live role level
-- >= 5, and an `activ` profile for `auth.uid()`. A caller who fails it gets
-- **no rows**, never an error -- this is a read surface, not a command.

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
  origin_name text,
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

comment on function private.leadership_member_tasks_impl(uuid) is
  'Body of the BCE+ Member drill-down: one row per current or historical Assignment of the selected Member, newest first, with the Task, its Origin, Campaign, Umbrella parent and Subtasks, and that Assignment''s Evaluation history. Returns no rows -- never an error -- to a caller below level 5, an inactive Member, or a claimless session.';

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
  origin_type text, origin_id text, origin_name text, campaign_id bigint,
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

comment on function public.leadership_member_tasks(uuid) is
  'Returns one row per current or historical Assignment for a selected Member to a live BCE+ caller, with complete Task, Origin, Campaign, parent/Subtask and Evaluation history.';

revoke execute on function private.leadership_member_tasks_impl(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.leadership_member_tasks(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.leadership_member_tasks_impl(uuid) to authenticated;
grant execute on function public.leadership_member_tasks(uuid) to authenticated;
