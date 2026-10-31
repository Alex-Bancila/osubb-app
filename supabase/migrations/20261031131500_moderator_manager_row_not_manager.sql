-- #1128: a Manager row held by the Moderator is never a Manager for the peer rule -- has_group_manager and group_managers now read the holder's level, as task_managers does.
--
-- Audit 2026-10-30, finding M4. Three helpers answered "does this Group have a
-- Manager?" differently: private.has_group_manager and private.group_managers
-- counted any live `manager` row on the path, private.task_managers (R42, #941)
-- only one held at level <= 6. Nothing stops the Moderator from holding a
-- Manager row -- positions survive rank changes (R15) and the local seed has the
-- Moderator as a Responsible -- so on a chain whose only Manager row is the
-- Moderator's, a Group Responsible lost can_manage_task on a peer's Task (a
-- Manager "existed") and the Task left their De gestionat list, while the
-- "renunțare" and "trimis spre evaluare" notices still reached them as peers.
--
-- Since R47 a Moderator's position row is their Atribuție, never a Manager: the
-- same `role.level <= 6` filter task_managers applies, so can_manage_task,
-- task_list_scope (through has_group_manager) and the notices (through
-- task_managers) agree. A BC member's (level 6) Manager row keeps counting, as
-- it does in task_managers. The alternative -- refusing a position for level 9
-- in Appointment and dropping it when someone becomes Moderator -- touches two
-- commands and the role-change path and is not built.
--
-- Both bodies are rebuilt from 20260919183347_group_authority_kit.sql, their
-- only definition on main, with the roles join added and nothing else changed.

create or replace function private.has_group_manager(p_group_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.groups as target
      join public.group_members as gm on target.path @> array[gm.group_id]
      join public.profiles as manager on manager.id = gm.member_id and manager.status = 'activ'
      join public.roles as role on role.id = manager.role
     where target.id = p_group_id
       and gm.group_role = 'manager'
       and role.level <= 6);
$$;

comment on function private.has_group_manager(bigint) is
  'Whether a live Manager exists anywhere on the Group''s path, for the peer-management rule (ruling D4: where no Manager exists, the chain''s Responsibles manage each other''s Tasks). Only a holder at level <= 6 counts (#1128, matching private.task_managers): a Moderator''s position row is their Atribuție (R47), never a Manager for this rule; a BC member''s Manager row counts like anyone''s (R42). Granted to nobody.';

create or replace function private.group_managers(p_group_id bigint)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_path  bigint[];
  v_ids   uuid[];
begin
  select grp.path into v_path from public.groups as grp where grp.id = p_group_id;
  if v_path is null then
    return;
  end if;
  -- The Group's own live Managers, else the nearest ancestor's. When no Manager exists anywhere
  -- on the path (ruling D4, "peers manage, BC evaluates"): the chain's live Group Responsibles
  -- plus every live BC/Moderator, so the peers who manage the work hear about it and evaluation
  -- notices still reach BC (ADR-0009 Group Roles). #1128: a Manager row held above level 6
  -- (the Moderator) is not a Manager here, exactly as in private.task_managers.
  for v_depth in reverse cardinality(v_path) .. 1 loop
    select array_agg(gm.member_id) into v_ids
      from public.group_members as gm
      join public.profiles as manager on manager.id = gm.member_id and manager.status = 'activ'
      join public.roles as role on role.id = manager.role
     where gm.group_id = v_path[v_depth]
       and gm.group_role = 'manager'
       and role.level <= 6;
    if v_ids is not null then
      return query select unnest(v_ids);
      return;
    end if;
  end loop;
  return query
    select gm.member_id
      from public.group_members as gm
      join public.profiles as peer on peer.id = gm.member_id and peer.status = 'activ'
     where v_path @> array[gm.group_id]
       and gm.group_role = 'responsible'
    union
    select profile.id
      from public.profiles as profile
      join public.roles as role on role.id = profile.role
     where role.level >= 6 and profile.status = 'activ';
end;
$$;

comment on function private.group_managers(bigint) is
  'The Members who manage a Group for Notifications: its own live Managers, else the nearest ancestor''s; with no Manager anywhere on the path (ruling D4), the chain''s live Group Responsibles plus every live BC member and the Moderator. Only a Manager row held at level <= 6 counts (#1128, matching private.task_managers): a Moderator''s position row is their Atribuție (R47), never a Manager for this rule, so it neither stops the walk nor is returned alone. Granted to nobody.';
