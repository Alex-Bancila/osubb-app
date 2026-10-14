-- Spec 2026-10-14 member reads, part 1: the Task read rule, decided once per request.
-- (docs/superpowers/specs/2026-10-14-member-reads-design.md; Alex chose PRs without issues.)
--
-- tasks_read called private.can_read_task(id) for every row it looked at: a
-- security-definer join Postgres cannot inline, about 0.5 ms a row (a
-- Volunteer reading 5 445 Tasks waited 2.8 s). Every rule in it but one
-- depends only on the caller and the Task's Group, so the rule becomes four
-- caller-scoped sets computed once per statement -- each read through
-- (select ...), which Postgres runs as an InitPlan -- and one test on the row:
-- is the Task an open public Opportunity, and of which Audience.
--
-- R7 ("judged on the Task and its Umbrella") reduces to R2: a sub-Task lives
-- in its Umbrella's Group (private.validate_task_hierarchy:
-- subtask_origin_mismatch on insert, subtask_origin_immutable, and
-- umbrella_has_subtasks in change_task_group), so the Group rules judge the
-- Umbrella exactly as they judge the sub-Task, and an Umbrella is never an
-- Opportunity. What is left is the caller's own Assignment or Candidature on
-- the Umbrella. Step 0 refuses to apply where a row breaks that.
--
-- private.can_read_task stays: commands ask it about one Task, and
-- supabase/tests/task_read_sets.test.sql holds every policy below to the old
-- expression for every caller.

-- 0. The precondition, checked where the rule is applied.
do $$
begin
  if exists (select 1
               from public.tasks as child
               join public.tasks as umbrella on umbrella.id = child.parent_task_id
              where child.group_id <> umbrella.group_id
                 or umbrella.kind <> 'umbrella') then
    raise exception using
      errcode = '23514',
      message = 'subtask_outside_its_umbrella',
      detail = 'tasks_read judges an Umbrella by its sub-Task''s Group; a sub-Task in another Group than its Umbrella, or under a Task that is not an Umbrella, would read differently. Fix those rows first.';
  end if;
end;
$$;

-- 1. R2: the Tasks the caller holds or held an Assignment or a Candidature on.
create function private.own_task_ids()
returns bigint[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct own.task_id), '{}'::bigint[])
    from (select assignment.task_id
            from public.task_assignments as assignment
           where assignment.member_id = (select auth.uid())
          union all
          select candidature.task_id
            from public.task_candidates as candidature
           where candidature.member_id = (select auth.uid())) as own
   where coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null;
$$;

comment on function private.own_task_ids() is
  'Fast reads part 1 (spec 2026-10-14 member reads): R2 of the Task read rule as a set -- the ids of the Tasks the caller holds or held an Assignment or a Candidature on, ever. Empty without organization claims or a live activ Profile, as private.can_read_task. Read by tasks_read through (select ...), once per statement; also matches a sub-Task whose Umbrella is in the set (R7).';

-- 2. R1, R3, R4 (whole), R6-own (open) and R6-org (org) as sets of Groups,
-- judged by the expressions private.can_read_task applies to the Task's
-- Group.
create function private.task_read_groups(p_kind text)
returns bigint[]
language sql
stable
security definer
set search_path = ''
as $$
  with caller as (
    select caller.id, caller_role.level
      from public.profiles as caller
      join public.roles as caller_role on caller_role.id = caller.role
     where caller.id = (select auth.uid())
       and caller.status = 'activ'
       and coalesce(public.auth_is_member(), false)
  ),
  judged as (
    select grp.id,
           private.can_see_group(grp.id, caller.id) as seen,
           caller.level >= 5 as global_reader,
           caller.level >= grp.min_level as at_level,
           exists (select 1
                     from public.group_members as held
                    where held.member_id = caller.id
                      and held.group_role in ('manager', 'responsible')
                      and grp.path @> array[held.group_id]) as role_on_path,
           exists (select 1
                     from public.groups as shared
                    where grp.path @> array[shared.id]
                      and shared.shared_work_visibility
                      and (exists (select 1
                                     from public.group_members as gm
                                    where gm.group_id = shared.id
                                      and gm.member_id = caller.id)
                           or (shared.automatic_membership
                               and caller.level >= shared.min_level))) as shared_on_path,
           private.is_group_member(grp.id, caller.id) as member
      from public.groups as grp
     cross join caller
  )
  select coalesce(array_agg(judged.id order by judged.id), '{}'::bigint[])
    from judged
   where judged.seen
     and case p_kind
           -- R1 level 5 and up; R3 a Group Role on the path; R4 Shared Work
           -- Visibility on the path -- the last two at the Minimum Level
           -- unless a Group Role is held.
           when 'whole' then judged.global_reader
                             or ((judged.at_level or judged.role_on_path)
                                 and (judged.role_on_path or judged.shared_on_path))
           -- R6-own: an open public Opportunity of a Group one is a member of.
           when 'open' then (judged.at_level or judged.role_on_path) and judged.member
           -- R6-org: an open public org-Audience Opportunity of any Group one sees.
           when 'org' then true
           else false
         end;
$$;

comment on function private.task_read_groups(text) is
  'Fast reads part 1 (spec 2026-10-14 member reads): the Group half of the Task read rule as sets, judged per Group by the expressions private.can_read_task applies to a Task''s Group, all within private.can_see_group. ''whole'': every Task of the Group is read (R1 level >= 5; else, at the Group''s Minimum Level or holding a Group Role on its path, R3 a Group Role on the path or R4 Shared Work Visibility on the path through a roster row or Automatic Membership). ''open'': its open public Opportunities, any Audience (R6-own: a member, at the Minimum Level or holding a Group Role on the path). ''org'': its open public org-Audience Opportunities (R6-org). Empty without organization claims or a live activ Profile, and for any other kind. Read by tasks_read through (select ...), once per statement.';

revoke execute on function private.own_task_ids() from public, anon, authenticated, service_role;
revoke execute on function private.task_read_groups(text) from public, anon, authenticated, service_role;
grant execute on function private.own_task_ids() to authenticated;
grant execute on function private.task_read_groups(text) to authenticated;

-- 3. The policies, altered in place so their comments (ADR-0007, #319) stay.
-- tasks_read reads the sets; the four child tables ask tasks_read about
-- their Task instead of private.can_read_task, and keep the rest of their
-- rule as it was (is_global_task_reader read once per statement too).
alter policy tasks_read on public.tasks
  using (
    (select public.auth_is_member())
    and (   id = any ((select private.own_task_ids())::bigint[])
         or parent_task_id = any ((select private.own_task_ids())::bigint[])
         or group_id = any ((select private.task_read_groups('whole'))::bigint[])
         or (    kind = 'task'
             and assignment_mode = 'public'
             and queue_closed_at is null
             and status not in ('completed', 'unfulfilled', 'cancelled')
             and (   group_id = any ((select private.task_read_groups('open'))::bigint[])
                  or (    audience = 'org'
                      and group_id = any ((select private.task_read_groups('org'))::bigint[]))))));

comment on policy tasks_read on public.tasks is
  'The Task read rule (private.can_read_task) decided once per statement: R2/R7 through private.own_task_ids(), R1/R3/R4 through task_read_groups(''whole''), R6-own and R6-org through ''open'' and ''org'' on an open public Opportunity. supabase/tests/task_read_sets.test.sql holds it to private.can_read_task for every caller.';

alter policy task_assignments_read on public.task_assignments
  using (
    (select public.auth_is_member())
    and exists (select 1 from public.tasks as task where task.id = task_assignments.task_id)
    and (   member_id = (select auth.uid())
         or (select private.is_global_task_reader())
         or private.can_manage_task(task_id)));

alter policy task_candidates_read on public.task_candidates
  using (
    (select public.auth_is_member())
    and exists (select 1 from public.tasks as task where task.id = task_candidates.task_id)
    and (   member_id = (select auth.uid())
         or (select private.is_global_task_reader())
         or private.can_manage_task(task_id)));

alter policy task_evaluations_read on public.task_evaluations
  using (
    (select public.auth_is_member())
    and exists (select 1 from public.tasks as task where task.id = task_evaluations.task_id)
    and (   evaluated_by = (select auth.uid())
         or private.is_own_assignment(assignment_id)
         or (select private.is_global_task_reader())
         or private.can_manage_task(task_id)));

alter policy task_activity_read on public.task_activity
  using (
    (select public.auth_is_member())
    and exists (select 1 from public.tasks as task where task.id = task_activity.task_id)
    and (   actor_id = (select auth.uid())
         or private.is_own_assignment(assignment_id)
         or (select private.is_global_task_reader())
         or private.can_manage_task(task_id)
         or private.is_task_team_member(task_id)));
