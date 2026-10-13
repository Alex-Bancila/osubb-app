-- #1046: a finished Task may be credited to any active Member, member of the Group or not (ruling R51).
-- Ruling R51 (Alex, 2026-10-13). ADR-0007 already lets a manager
-- choose any active Member as the Executor of a direct Task; the completed-work
-- gate of #915 was stricter (PT409 executor_not_group_member outside the Group
-- Audience). That one rule goes, in the gate and in the two pickers; the
-- Minimum Level of the Group and the decider rule stay, and the points land on
-- the Task's Group, so its Clasament and the Cupa Departamentelor count the
-- work done for it.

create or replace function private.can_award_completed_work(p_group_id bigint, p_executor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_award_in_group(p_group_id)
     and private.meets_group_min_level(p_group_id, p_executor)
     and private.is_work_decider(p_group_id, p_executor, (select auth.uid()));
$$;
comment on function private.can_award_completed_work(bigint, uuid) is
  '#915, R51: the caller may record completed work of p_executor in p_group_id -- the whole rule create_completed_task and a Group-changing approval enforce (manage work there, an active Group, a live Executor at or above its Minimum Level whether a member or not, the caller in the decider set), without their locks. Read by public.completed_task_groups, one Group at a time. Callable predicate, not a write path.';

create or replace function private.completed_work_executors(p_group_id bigint)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- The caller's standing once, then every live Member against the
  -- per-candidate checks: the same rule as can_award_completed_work (R51:
  -- membership of the Group is not one of them).
  if not private.can_award_in_group(p_group_id) then
    return;
  end if;
  return query
    select profile.id
      from public.profiles as profile
     where profile.status = 'activ'
       and private.meets_group_min_level(p_group_id, profile.id)
       and private.is_work_decider(p_group_id, profile.id, (select auth.uid()));
end;
$$;
comment on function private.completed_work_executors(bigint) is
  '#915, R51: every Member the caller may credit with completed work in p_group_id -- exactly those private.can_award_completed_work accepts: every live activ Member at or above the Group''s Minimum Level for whom the caller decides, member of the Group or not. Read by public.completed_task_executors. Callable set, not a write path.';

create or replace function private.require_completed_work_group(
  p_group_id           bigint,
  p_executor           uuid,
  p_manage_forbidden   text,
  p_decide_forbidden   text,
  p_exclude_leadership boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role  public.member_role;
begin
  -- Authority to manage work in the Group, with the profile and roster rows
  -- it rests on held FOR SHARE until the command commits.
  begin
    perform private.require_group_work_manager(p_group_id);
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = p_manage_forbidden;
  end;
  -- BC and the Moderator pass the gate on an archived Group.
  if not exists (select 1 from public.groups as grp
                  where grp.id = p_group_id and grp.status = 'active') then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;
  -- The Executor's live profile, held against deactivation or demotion.
  select profile.role into v_role
    from public.profiles as profile
   where profile.id = p_executor and profile.status = 'activ'
     for share of profile;
  if not found then
    raise sqlstate 'PT400' using message = 'invalid_executor';
  end if;
  if p_exclude_leadership and v_role in ('bc', 'moderator') then
    raise sqlstate 'PT409' using message = 'executor_role_excluded';
  end if;
  -- Ruling R51 (2026-10-13): membership of the Group is not required -- any
  -- active Member may be credited; the Minimum Level and the decider rule are.
  if not private.meets_group_min_level(p_group_id, p_executor) then
    raise sqlstate 'PT409' using message = 'executor_below_min_level';
  end if;
  if not private.is_work_decider(p_group_id, p_executor, v_actor) then
    raise exception using errcode = '42501', message = p_decide_forbidden;
  end if;
  return v_actor;
end;
$$;

comment on function private.require_completed_work_group(bigint, uuid, text, text, boolean) is
  '#915, R51: the gate a completed Task''s Group passes, in order: 42501 p_manage_forbidden unless the caller may manage work there (private.require_group_work_manager and its FOR SHARE locks); PT409 group_archived unless the Group is active; PT400 invalid_executor unless p_executor is a live activ Member (held FOR SHARE); with p_exclude_leadership, PT409 executor_role_excluded for BC or the Moderator (F-27); PT409 executor_below_min_level under its Minimum Level -- membership of the Group is not required (ruling R51, 2026-10-13); 42501 p_decide_forbidden unless the caller is in private.is_work_decider''s set -- which never holds the Executor. Returns the actor. Granted to nobody.';
