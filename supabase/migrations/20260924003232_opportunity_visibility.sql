-- #683: every open Opportunity is readable at its Group's Minimum Level, whatever its Audience.
--
-- Ruling R10 of the 2026-09-23 grill and ADR-0007's amendment of the same day:
-- seeing an Opportunity does not depend on its Audience; joining does. The R6
-- arm of private.can_read_task drops its Audience test, so an open Opportunity
-- (an ordinary public Task, queue open, not terminal) of a Group the Member is
-- not in is readable -- as an "Other OSUBB Opportunity" -- whenever the Member
-- meets that Group's Minimum Level. The surrounding gate is unchanged: the
-- Minimum Level (or a Group Role on the path) still admits the row, R1-R5 and
-- R7 are as coded, and direct Tasks, Umbrellas, closed queues and terminal
-- Tasks stay hidden from non-participants.
--
-- What does not change, by construction: express_task_interest keeps the
-- Audience rule (42501 task_audience_forbidden), so a local Other Opportunity
-- is visible but not joinable; private.pending_candidate_count and
-- public.task_queue_summary follow can_read_task, so the visible Opportunity
-- shows its pending count while my_position stays self-gated; and
-- task_activity_read / task_candidates / task_assignments still require
-- participation or management on top of can_read_task.
--
-- Body rebuilt from main's latest definition (20260919184521_task_authority_on_groups;
-- no later migration re-issued it). Same signature, so grants and policies
-- that call it are untouched.

create or replace function private.can_read_task(p_task_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- R1 level >= 5; R2 own Assignment/Candidature (ever); then, subject to the Group's Minimum
  -- Level unless the caller holds a Group Role on the path: R3 a Group Role on the path
  -- (status-agnostic: an archived Project's former lead keeps reading its history); R4 Shared
  -- Work Visibility of a Group on the path the caller belongs to; R6 an open public
  -- Opportunity, whatever its Audience (#683, ruling R10 -- the Audience decides only who
  -- may express interest); R7 judged on the Task and its Umbrella.
  select coalesce(public.auth_is_member(), false)
     and exists (
       select 1
         from public.profiles as caller
         join public.roles as caller_role on caller_role.id = caller.role
         join public.tasks as target on target.id = p_task_id
         join public.tasks as task on task.id = target.id or task.id = target.parent_task_id
         join public.groups as grp on grp.id = task.group_id
        where caller.id = (select auth.uid())
          and caller.status = 'activ'
          and (
            caller_role.level >= 5
            or exists (select 1 from public.task_assignments as assignment
                        where assignment.task_id = task.id and assignment.member_id = caller.id)
            or exists (select 1 from public.task_candidates as candidature
                        where candidature.task_id = task.id and candidature.member_id = caller.id)
            or (
              (caller_role.level >= grp.min_level
               or exists (select 1 from public.group_members as held
                           where held.member_id = caller.id
                             and held.group_role in ('manager', 'responsible')
                             and grp.path @> array[held.group_id]))
              and (
                exists (select 1 from public.group_members as held
                         where held.member_id = caller.id
                           and held.group_role in ('manager', 'responsible')
                           and grp.path @> array[held.group_id])
                or exists (select 1 from public.groups as shared
                            where grp.path @> array[shared.id]
                              and shared.shared_work_visibility
                              and (exists (select 1 from public.group_members as gm
                                            where gm.group_id = shared.id and gm.member_id = caller.id)
                                   or (shared.automatic_membership and caller_role.level >= shared.min_level)))
                or (task.kind = 'task'
                    and task.assignment_mode = 'public'
                    and task.queue_closed_at is null
                    and task.status not in ('completed', 'unfulfilled', 'cancelled'))
              )
            )
          ));
$$;

comment on function private.can_read_task(bigint) is
  'ADR-0009 R1-R7: leadership and participation, Group roles, Shared Work Visibility, and every open Opportunity (public, queue open, not terminal) of a Group whose Minimum Level the Member satisfies, whatever its Audience (#683, ruling R10: Audience decides only who may express interest); also applies to the Umbrella. Direct Tasks, Umbrellas, closed queues and terminal Tasks stay hidden from non-participants.';

comment on policy tasks_read on public.tasks is
  'ADR-0007 Task visibility (#318, #683), defined once in private.can_read_task: live BCE/BC/Moderator; own Assignments (current or ended) and Candidatures; Group Managers and Responsibles on the path; Shared Work Visibility; every open, unfinished public Opportunity of a Group whose Minimum Level the Member meets, whatever its Audience; and a Subtask whenever its Umbrella is readable.';
