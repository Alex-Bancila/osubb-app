-- #521: every Task predicate and require_* helper reads Groups (ADR-0009 Wave 2). Signatures
-- are unchanged; the four history read policies, the 21 commands and the Request commands
-- keep calling the same names. can_manage_origin / require_origin_manager become shims over
-- the legacy id -> Group mapping and are dropped in Wave 3.

create or replace function private.can_manage_task(p_task_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  -- Manage = may manage work in the Task's Group, AND one of: level >= 6; a Group Manager on
  -- the path; the Task's current Executor is not a Manager/Responsible of the chain (a Task
  -- with no Executor is manageable by any Responsible on the path); or no Manager exists
  -- anywhere on the path -- "Peers manage, BC evaluates" (Alex, 2026-09-19): where a Group
  -- and all its ancestors have no Group Manager, its Responsibles manage each other's Tasks.
  select coalesce((
    select private.can_manage_group_work(task.group_id)
       and (
         private.actor_level() >= 6
         or private.group_role_of(task.group_id, (select auth.uid())) = 'manager'
         or not private.has_group_manager(task.group_id)
         or coalesce(private.group_role_of(task.group_id, executor.member_id), 'member')
              not in ('manager', 'responsible')
       )
      from public.tasks as task
      left join public.task_assignments as executor
        on executor.task_id = task.id and executor.ended_at is null
     where task.id = p_task_id
  ), false);
$$;

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
  select coalesce((
    select coalesce(public.auth_is_member(), false)
       and private.actor_level() is not null
       and (
         private.actor_level() >= 6
         or (grp.status = 'active' and (
              private.group_role_of(grp.id, (select auth.uid())) = 'manager'
              or (private.group_role_of(grp.id, (select auth.uid())) = 'responsible'
                  and executor.member_id is distinct from (select auth.uid())
                  and coalesce(private.group_role_of(grp.id, executor.member_id), 'member')
                        not in ('manager', 'responsible'))))
       )
      from public.tasks as task
      join public.groups as grp on grp.id = task.group_id
      left join lateral (
        select assignment.member_id
          from public.task_assignments as assignment
         where assignment.task_id = task.id
         order by (assignment.ended_at is null) desc, assignment.assigned_at desc, assignment.id desc
         limit 1
      ) as executor on true
     where task.id = p_task_id
  ), false);
$$;

create or replace function private.can_read_task(p_task_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  -- R1 level >= 5; R2 own Assignment/Candidature (ever); then, subject to the Group's Minimum
  -- Level unless the caller holds a Group Role on the path: R3 a Group Role on the path
  -- (status-agnostic: an archived Project's former lead keeps reading its history); R4 Shared
  -- Work Visibility of a Group on the path the caller belongs to; R6 an open public
  -- Opportunity -- audience org for every Member at/above the Minimum Level, local for
  -- members of the Task's own Group (ruling D2); R7 judged on the Task and its Umbrella.
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
                    and task.status not in ('completed', 'unfulfilled', 'cancelled')
                    and (task.audience = 'org'
                         or (task.audience = 'local'
                             and (exists (select 1 from public.group_members as gm
                                           where gm.group_id = grp.id and gm.member_id = caller.id)
                                  or (grp.automatic_membership and caller_role.level >= grp.min_level)))))
              )
            )
          ));
$$;

create or replace function private.is_task_team_member(p_task_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  -- Renamed in meaning, not in name: a member of a Group on the Task's path whose Shared Work
  -- Visibility is on (every backfilled Team Group has it on, so today's Team members keep
  -- their complete Task Activity). task_activity_read keeps calling this name.
  select coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null
     and exists (
       select 1
         from public.tasks as task
         join public.groups as grp on grp.id = task.group_id
         join public.groups as shared on grp.path @> array[shared.id] and shared.shared_work_visibility
        where task.id = p_task_id
          and private.is_group_member(shared.id, (select auth.uid())));
$$;

create or replace function private.can_manage_origin(p_dept_id text, p_team_id text, p_project_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  -- Wave 2 shim: the one non-null legacy id names a Group; the Group decides. Dropped in Wave 3.
  select num_nonnulls(p_dept_id, p_team_id, p_project_id) = 1
     and private.can_manage_group_work(private.group_id_for_legacy_origin(p_dept_id, p_team_id, p_project_id));
$$;

create or replace function private.require_origin_manager(p_dept_id text, p_team_id text, p_project_id bigint)
returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  if num_nonnulls(p_dept_id, p_team_id, p_project_id) <> 1 then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end if;
  begin
    return private.require_group_work_manager(
      private.group_id_for_legacy_origin(p_dept_id, p_team_id, p_project_id));
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end;
end;
$$;

create or replace function private.require_task_manager(p_task_id bigint)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_task  public.tasks%rowtype;
begin
  select * into v_task from public.tasks where id = p_task_id;   -- caller already holds FOR UPDATE
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- The Task-level rule (peers, no-manager chains) first, then the locked re-validation.
  if v_actor is null or not coalesce(private.can_manage_task(p_task_id), false) then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end if;
  begin
    perform private.require_group_work_manager(v_task.group_id);
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end;
  if not private.can_manage_task(p_task_id) then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end if;
  return v_actor;
end;
$$;

create or replace function private.require_task_evaluator(p_task_id bigint)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_task  public.tasks%rowtype;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  if v_actor is null or not coalesce(private.can_evaluate_task(p_task_id), false) then
    raise exception using errcode = '42501', message = 'task_evaluate_forbidden';
  end if;
  begin
    perform private.require_group_work_manager(v_task.group_id);
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'task_evaluate_forbidden';
  end;
  if not private.can_evaluate_task(p_task_id) then
    raise exception using errcode = '42501', message = 'task_evaluate_forbidden';
  end if;
  return v_actor;
end;
$$;

create or replace function private.task_managers(p_task_id bigint, p_actor uuid)
returns setof uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_created_by uuid;
  v_group_id   bigint;
  v_recipients uuid[];
begin
  select task.created_by, task.group_id into v_created_by, v_group_id
    from public.tasks as task where task.id = p_task_id;
  if not found then
    return;
  end if;
  -- The Task Manager is the creator (ADR-0007), while live and not the actor.
  if v_created_by is not null and v_created_by is distinct from p_actor
     and exists (select 1 from public.profiles as creator
                  where creator.id = v_created_by and creator.status = 'activ') then
    return next v_created_by;
    return;
  end if;
  -- Else the Group's Managers, then the nearest ancestor's, then BC/Moderator -- minus the
  -- actor; and if that leaves nobody, BC/Moderator minus the actor (a Task always has someone
  -- to notify, Ruling 24).
  select array_agg(manager) into v_recipients
    from private.group_managers(v_group_id) as manager
   where manager is distinct from p_actor;
  if v_recipients is null then
    select array_agg(profile.id) into v_recipients
      from public.profiles as profile
      join public.roles as role on role.id = profile.role
     where role.level >= 6 and profile.status = 'activ' and profile.id is distinct from p_actor;
  end if;
  return query select unnest(coalesce(v_recipients, '{}'::uuid[]));
end;
$$;

create or replace function public.can_manage_tasks()
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(public.auth_is_member(), false)
     and exists (select 1 from public.groups as grp where private.can_manage_group_work(grp.id));
$$;

-- CREATE OR REPLACE preserves the existing audited signatures and ACLs.
comment on function private.can_manage_task(bigint) is
  'ADR-0009: Group work authority; Managers and BC override, Responsibles manage ordinary Executors, or peers when no Manager exists on the chain.';
comment on function private.can_evaluate_task(bigint) is
  'ADR-0009: live Group Manager or BC; Responsible may evaluate only another ordinary Member, using the latest Assignment for completed work.';
comment on function private.can_read_task(bigint) is
  'ADR-0009 R1-R7: leadership and participation, Group roles, Shared Work Visibility and Minimum-Level-gated Opportunities; also applies to the Umbrella.';
comment on function private.is_task_team_member(bigint) is
  'ADR-0009: member of an ancestor-or-self Group with Shared Work Visibility; retained name for existing history policies.';
comment on function private.can_manage_origin(text, text, bigint) is
  'ADR-0009 Wave 2 compatibility shim: exactly one legacy Origin resolves to a Group and its live work authority.';
comment on function private.require_origin_manager(text, text, bigint) is
  'ADR-0009 Wave 2 shim to locked Group authority; preserves task_manage_forbidden for legacy callers.';
comment on function private.require_task_manager(bigint) is
  'ADR-0009: Task management rule revalidated after locking live actor and Group roster; caller already holds Task lock; preserves task_manage_forbidden.';
comment on function private.require_task_evaluator(bigint) is
  'ADR-0009: Task evaluation rule revalidated after locking live actor and Group roster; caller already holds Task lock; preserves task_evaluate_forbidden.';
comment on function private.task_managers(bigint, uuid) is
  'ADR-0009: live Task creator unless acting, else nearest Group Managers or peer Responsibles plus BC, excluding actor; empty recipient set falls back to BC.';
comment on function public.can_manage_tasks() is
  'ADR-0009: caller has organization claims and may manage work in at least one readable Group; rank alone below BC grants no management.';
