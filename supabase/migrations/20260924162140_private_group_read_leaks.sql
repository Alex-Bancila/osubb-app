-- #759: close the two Private Group read leaks #756 left -- the BCE+ Member drill-down and campaigns_read now ask private.can_see_group of the owning Group.
--
-- Ruling R25: a Private Group's subtree is invisible to outsiders. #756 gated
-- every read path it named; these two were outside its scope:
--   * private.leadership_member_tasks_impl is a security definer read behind
--     a level threshold (BCE and above), so it listed a Member's Assignments
--     in a Private Group -- titles, Group name, Campaign name -- to any BCE.
--   * campaigns_read admitted every live Member, so a Private Group's
--     Campaign names reached every Campaign picker and the Work Filter.
-- Both call the one rule, conventions §10 (#756): a new read path that returns
-- a Group-owned row through a definer function or a level threshold must.
--
-- The Leaderboard and the Department Cup are deliberately unchanged: points
-- earned in a Private Group still count, and neither names the Group.
--
-- The drill-down body is rebuilt from main's latest version (#677,
-- 20260924013452_work_filter_date_ranges.sql) with one added predicate. Its
-- signature and return type are unchanged, so `create or replace` keeps the
-- existing grants and the public wrapper needs no change. A Subtask carries
-- its Umbrella's Group (tasks_validate_hierarchy), and a Campaign tagging a
-- visible Task sits on that Task's path, so the nested subtasks, parent title
-- and Campaign name of a row that survives the filter are visible too.

-- ==================== 1. The Member drill-down ====================

create or replace function private.leadership_member_tasks_impl(
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
     and private.can_see_group(task.group_id, (select auth.uid()))
   order by assignment.assigned_at desc, assignment.id desc;
$$;

comment on function private.leadership_member_tasks_impl(uuid, timestamptz, timestamptz) is
  'One row per selected Member Assignment, newest first, labelled by the Task''s owning Group, optionally narrowed to Task deadlines in [p_from, p_to) (#677); PT400 invalid_date_range first when p_to < p_from. A Task whose Group the caller cannot see (private.can_see_group, #756/#759) is omitted, so a BCE drilling into a Member never learns of their work in a Private Group; BC/Moderator see every row.';
comment on function public.leadership_member_tasks(uuid, timestamptz, timestamptz) is
  'Live BCE+ Assignment history with the owning Group''s id and name, plus Task and Evaluation history. The date range (#677, R11) keeps only Assignments whose Task deadline is in [p_from, p_to); a Task with no deadline is excluded whenever either bound is set. PT400 invalid_date_range when p_to < p_from. Assignments of a Task in a Private Group the caller cannot see are omitted (#759, ruling R25).';

-- ==================== 2. campaigns_read ====================

-- The existing membership gate unchanged, behind the visibility rule.
alter policy campaigns_read on public.campaigns
  using (
    (select public.auth_is_member())
    and exists (
      select 1
        from public.profiles as actor
       where actor.id = (select auth.uid())
         and actor.status = 'activ'
    )
    and private.can_see_group(group_id, (select auth.uid()))
  );
