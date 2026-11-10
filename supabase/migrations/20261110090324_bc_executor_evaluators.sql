-- #1180 (audit L9, decision 1 of #1144): only BC and the Moderator evaluate
-- a BC member's or the Moderator's Task.
--
-- private.can_evaluate_task read the Executor's standing through
-- private.group_role_of, which answers 'member' for anyone outside the
-- Group's roster -- a BC member or the Moderator included -- so a Group
-- Manager or Responsible on the path below level 6 evaluated their Task and
-- set its points. private.is_work_decider, the completed-work decider rule,
-- had the same shape.
--
-- Both are rebuilt from their latest bodies on main
-- (20260919184521_task_authority_on_groups.sql and
-- 20260929180000_completed_work_tasks.sql) with one change: when the
-- Executor's live role level is 6 or above, only an actor at level 6 or above
-- passes. A Task with no Assignment, or an ordinary Executor, keeps exactly
-- the evaluators it had. Everything that reads these two follows by
-- construction: public.can_evaluate_task (the page's Evaluează), the review
-- commands through private.require_task_evaluator, reopen_task's and
-- delete_task's reversal rule, and private.work_deciders (the Request
-- fan-out). Who manages the Task is unchanged.
--
-- create or replace keeps both functions' grants: neither is executable by a
-- client role.

create or replace function private.can_evaluate_task(p_task_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  -- Evaluate = level >= 6; a Group Manager on the path of an active Group; or a Group
  -- Responsible on the path when the Executor is an ordinary member of the chain (or an
  -- outsider) and is not the caller. No Independent-Team special case: with no Manager,
  -- every teammate is a Responsible, so evaluation falls to BC/Moderator by construction.
  -- "The Executor" is the active Assignment, else the most recent one (reopen_task judges a
  -- completed Task, whose Assignment has already ended).
  -- #1180: an Executor whose live role level is 6 or above (BC, the Moderator) is
  -- evaluated by level >= 6 alone; no Group role reaches their Task.
  select coalesce((
    select coalesce(public.auth_is_member(), false)
       and private.actor_level() is not null
       and (
         private.actor_level() >= 6
         or (grp.status = 'active'
             and coalesce(executor.level, 0) < 6
             and (
              private.group_role_of(grp.id, (select auth.uid())) = 'manager'
              or (private.group_role_of(grp.id, (select auth.uid())) = 'responsible'
                  and executor.member_id is distinct from (select auth.uid())
                  and coalesce(private.group_role_of(grp.id, executor.member_id), 'member')
                        not in ('manager', 'responsible'))))
       )
      from public.tasks as task
      join public.groups as grp on grp.id = task.group_id
      left join lateral (
        select assignment.member_id, executor_role.level
          from public.task_assignments as assignment
          join public.profiles as executor_profile on executor_profile.id = assignment.member_id
          join public.roles as executor_role on executor_role.id = executor_profile.role
         where assignment.task_id = task.id
         order by (assignment.ended_at is null) desc, assignment.assigned_at desc, assignment.id desc
         limit 1
      ) as executor on true
     where task.id = p_task_id
  ), false);
$$;

comment on function private.can_evaluate_task(bigint) is
  'ADR-0009: live Group Manager or BC; Responsible may evaluate only another ordinary Member, using the latest Assignment for completed work. #1180: an Executor at live level 6 or above (BC, the Moderator) is evaluated by level >= 6 alone.';

create or replace function private.is_work_decider(p_group_id bigint, p_executor uuid, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles as profile
      join public.roles as role on role.id = profile.role
      join public.groups as grp on grp.id = p_group_id
     where profile.id = p_actor
       and profile.status = 'activ'
       and p_actor is distinct from p_executor
       and (role.level >= 6
            or (grp.status = 'active'
                -- #1180: below level 6 nobody decides a BC member's or the
                -- Moderator's completed work.
                and not exists (
                  select 1
                    from public.profiles as executor_profile
                    join public.roles as executor_role on executor_role.id = executor_profile.role
                   where executor_profile.id = p_executor
                     and executor_role.level >= 6)
                and exists (
                  select 1
                    from public.group_members as gm
                   where gm.member_id = profile.id
                     and grp.path @> array[gm.group_id]
                     and (gm.group_role = 'manager'
                          or (gm.group_role = 'responsible'
                              and coalesce(private.group_role_of(p_group_id, p_executor), 'member')
                                    not in ('manager', 'responsible')))))));
$$;

comment on function private.is_work_decider(bigint, uuid, uuid) is
  '#915: the one decider rule for completed work in a Group (formerly inline in private.request_deciders): p_actor is a live activ Member other than p_executor and is BC/Moderator (level >= 6, any Group status) or, on an ACTIVE Group, a Group Manager on its path, or a Group Responsible on its path when p_executor holds no Manager/Responsible role there. #1180: when p_executor''s live role level is 6 or above, only level >= 6 decides. Internal: executable by no client role.';
