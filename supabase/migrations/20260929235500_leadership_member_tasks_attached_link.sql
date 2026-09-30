-- #947: the BCE+ Member drill-down returns the Task's Attached Link.
--
-- #679/#684 gave a Task at most one Attached Link (tasks.link_label and
-- tasks.link_url, set together -- tasks_link_ck), and every Task read the
-- Tracker draws from carries the pair. public.leadership_member_tasks never
-- did, so Trackerul membrului drew each Task card without its Link atașat
-- (found during #936).
--
-- Both functions are rebuilt from main's latest bodies -- the impl from
-- 20260924162140_private_group_read_leaks.sql (#759, the can_see_group
-- predicate), the wrapper from 20260924013452_work_filter_date_ranges.sql
-- (#677) -- with two added columns, link_label and link_url, after
-- description. Nothing else changes: the gate (live BCE and above), the
-- Private Group rule, the half-open deadline range, the ordering.
--
-- Adding output columns changes the return type, which `create or replace`
-- cannot do, so the wrapper and the body are dropped (wrapper first -- it
-- depends on the body) and recreated with the same signature, grants and
-- comments. A link is only ever read on a row that survives the gate and the
-- Private Group rule, so it widens no audience.

drop function public.leadership_member_tasks(uuid, timestamptz, timestamptz);
drop function private.leadership_member_tasks_impl(uuid, timestamptz, timestamptz);

create function private.leadership_member_tasks_impl(
  p_member_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  assignment_id bigint, member_id uuid, assigned_at timestamptz, assigned_by uuid,
  assignment_ended_at timestamptz, assignment_end_reason text, assignment_end_note text,
  task_id bigint, title text, description text, link_label text, link_url text,
  deadline timestamptz, task_kind text,
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
         task.link_label,
         task.link_url,
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

create function public.leadership_member_tasks(
  p_member_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  assignment_id bigint, member_id uuid, assigned_at timestamptz, assigned_by uuid,
  assignment_ended_at timestamptz, assignment_end_reason text, assignment_end_note text,
  task_id bigint, title text, description text, link_label text, link_url text,
  deadline timestamptz, task_kind text,
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

comment on function private.leadership_member_tasks_impl(uuid, timestamptz, timestamptz) is
  'One row per selected Member Assignment, newest first, labelled by the Task''s owning Group and carrying the Task''s Attached Link (#947), optionally narrowed to Task deadlines in [p_from, p_to) (#677); PT400 invalid_date_range first when p_to < p_from. A Task whose Group the caller cannot see (private.can_see_group, #756/#759) is omitted, so a BCE drilling into a Member never learns of their work in a Private Group; BC/Moderator see every row.';
comment on function public.leadership_member_tasks(uuid, timestamptz, timestamptz) is
  'Live BCE+ Assignment history with the owning Group''s id and name, the Task''s Attached Link (link_label, link_url; #947), plus Task and Evaluation history. The date range (#677, R11) keeps only Assignments whose Task deadline is in [p_from, p_to); a Task with no deadline is excluded whenever either bound is set. PT400 invalid_date_range when p_to < p_from. Assignments of a Task in a Private Group the caller cannot see are omitted (#759, ruling R25).';
