-- #941 (R32 amended, Alex 2026-09-29): a Task whose Group has no Manager notifies the
-- nearest Group above that has one, never BC or the Moderator.
--
-- #929 (20260929200000_group_member_set.sql) filtered every live BC member and
-- Moderator out of private.task_managers AFTER private.group_managers had already
-- stopped its upward walk. A Group (or an ancestor) whose only live roster Manager is
-- a BC member or the Moderator therefore ended the walk with a set that the filter
-- then emptied, so the Task notified nobody even when a Group further up had a
-- Manager of its own. The walk now happens here, and a BC member or Moderator on a
-- roster no longer counts as the Group's Manager for Notifications:
--
--   1. the live creator, unless acting (ADR-0007) -- unchanged;
--   2. else, from the Task's Group up groups.path to the root, the first Group with a
--      live Manager below BC (level < 6): its Managers minus the actor. A Manager who
--      is the actor still counts as that Group's Manager -- they did it themselves,
--      so nobody above them is told (the empty case of complete_umbrella_task);
--   3. else, when no Group on the path has such a Manager, the chain's live peer
--      Responsibles below BC, minus the actor (ruling D4) -- unchanged;
--   4. else nobody (R32) -- unchanged: the Task waits in the review queue BC sees.
--
-- Only roster rows count: the membri de drept of private.group_member_set are never
-- read here, so BC and the Moderator are never added as members of any Group.
-- private.group_managers keeps its own contract for its other callers.
--
-- Rebuilt from main's latest body: private.task_managers (20260929200000).

create or replace function private.task_managers(p_task_id bigint, p_actor uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_created_by uuid;
  v_path       bigint[];
  v_managers   uuid[];
begin
  select task.created_by, grp.path into v_created_by, v_path
    from public.tasks as task
    left join public.groups as grp on grp.id = task.group_id
   where task.id = p_task_id;
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
  if v_path is null then
    return;
  end if;
  -- Else the nearest Group on the path, the Task's own first, with a live Manager
  -- below BC (#941). BC members and the Moderator hear of no Task through Group
  -- management (#929, R32), so their roster rows never stop the walk. The actor is
  -- dropped from the recipients but still marks the Group as managed.
  for v_depth in reverse cardinality(v_path) .. 1 loop
    select array_agg(gm.member_id) into v_managers
      from public.group_members as gm
      join public.profiles as manager on manager.id = gm.member_id and manager.status = 'activ'
      join public.roles as role on role.id = manager.role
     where gm.group_id = v_path[v_depth]
       and gm.group_role = 'manager'
       and role.level < 6;
    if v_managers is not null then
      return query
        select manager from unnest(v_managers) as manager
         where manager is distinct from p_actor;
      return;
    end if;
  end loop;
  -- No Manager anywhere on the path (ruling D4, "peers manage, BC evaluates"): the
  -- chain's live peer Responsibles below BC, minus the actor. Nobody left means
  -- nobody is notified.
  return query
    select distinct gm.member_id
      from public.group_members as gm
      join public.profiles as peer on peer.id = gm.member_id and peer.status = 'activ'
      join public.roles as role on role.id = peer.role
     where v_path @> array[gm.group_id]
       and gm.group_role = 'responsible'
       and role.level < 6
       and gm.member_id is distinct from p_actor;
end;
$$;

comment on function private.task_managers(bigint, uuid) is
  'ADR-0009, #929 (R32), #941: the live Task creator unless acting; else the Managers of the nearest Group on the Task''s path (its own Group first, then each ancestor up to the root) that has a live Manager below BC, minus the actor; else the chain''s live peer Responsibles below BC, minus the actor; else nobody. Only roster rows count: a BC member or the Moderator is never a recipient through Group management and never stops the walk, and the membri de drept are never added. BC and the Moderator get Task Notifications only for a Task they created or execute.';
