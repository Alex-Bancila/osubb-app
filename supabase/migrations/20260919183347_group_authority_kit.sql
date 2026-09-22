-- #520: the Group authority kit (ADR-0009 Wave 2): one family of predicates over groups.path
-- and group_members.group_role that #521 puts under every Task predicate, #522 under the
-- Request and Campaign commands, #370/#248 under the Calendar. Nothing here reads the
-- presentation label on groups (conventions.test.sql now machine-checks that).

create function private.group_role_of(p_group_id bigint, p_member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- Strongest Group Role the live active member holds on the Group: manager > responsible >
  -- member. Manager and Responsible flow down from any ancestor; plain membership is per Group
  -- (ruling D2) -- an explicit 'member' row on the Group itself, or Automatic Membership of the
  -- Group itself at or above its Minimum Level. Null for an inactive member or no relationship.
  with target as (
    select grp.id, grp.path, grp.automatic_membership, grp.min_level
      from public.groups as grp where grp.id = p_group_id
  ),
  held as (
    select case gm.group_role when 'manager' then 1 else 2 end as rank
      from target
      join public.group_members as gm
        on target.path @> array[gm.group_id]
       and gm.member_id = p_member
       and gm.group_role in ('manager', 'responsible')
    union all
    select 3
      from target
      join public.group_members as gm
        on gm.group_id = target.id
       and gm.member_id = p_member
       and gm.group_role = 'member'
    union all
    select 3
      from target
     where target.automatic_membership
       and private.actor_level(p_member) >= target.min_level
  )
  select case min(held.rank) when 1 then 'manager' when 2 then 'responsible' when 3 then 'member' end
    from held
   where private.actor_level(p_member) is not null;
$$;

create function private.is_group_member(p_group_id bigint, p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Membership of THIS Group only (a setting of one Group on the path is applied per Group):
  -- an explicit roster row of any role, or Automatic Membership at or above its Minimum Level.
  select private.actor_level(p_member) is not null
     and exists (
       select 1
         from public.groups as grp
        where grp.id = p_group_id
          and (exists (select 1 from public.group_members as gm
                        where gm.group_id = grp.id and gm.member_id = p_member)
               or (grp.automatic_membership and private.actor_level(p_member) >= grp.min_level)));
$$;

create function private.has_group_manager(p_group_id bigint)
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
     where target.id = p_group_id
       and gm.group_role = 'manager');
$$;

create function private.is_group_manager(p_group_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and coalesce(private.group_role_of(p_group_id, (select auth.uid())) = 'manager', false);
$$;

create function private.is_group_responsible(p_group_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and coalesce(private.group_role_of(p_group_id, (select auth.uid())) = 'responsible', false);
$$;

create function private.can_manage_group_work(p_group_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- BC/Moderator everywhere (archived Groups included, as can_manage_origin's level>=6
  -- short-circuit does today); otherwise a Group Manager or Group Responsible on the path of
  -- an ACTIVE Group (can_manage_project_work's status rule, generalised). False for a missing
  -- Group, so an unknown id is indistinguishable from an unauthorised one.
  select coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null
     and exists (
       select 1
         from public.groups as grp
        where grp.id = p_group_id
          and (private.actor_level() >= 6
               or (grp.status = 'active'
                   and private.group_role_of(grp.id, (select auth.uid())) in ('manager', 'responsible'))));
$$;

create function private.require_group_work_manager(p_group_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_level integer;
begin
  if v_actor is null or not coalesce(private.can_manage_group_work(p_group_id), false) then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  perform 1
    from public.profiles as profile
   where profile.id = v_actor and profile.status = 'activ'
   for share of profile;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  -- Refresh the role after a possible wait: the pre-lock snapshot is not authority.
  v_level := private.actor_level(v_actor);
  if not private.can_manage_group_work(p_group_id) then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  if v_level >= 6 then
    return v_actor;
  end if;
  -- The roster rows the authority rests on -- never the groups row (for share conflicts with
  -- the for no key update every mirror upsert takes on a Group row, #509 ruling 9).
  perform 1
     from public.groups as target
     join public.group_members as gm on target.path @> array[gm.group_id]
    where target.id = p_group_id
      and gm.member_id = v_actor
      and gm.group_role in ('manager', 'responsible')
    order by gm.group_id
      for share of gm;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  if not private.can_manage_group_work(p_group_id) then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  return v_actor;
end;
$$;

create function private.group_managers(p_group_id bigint)
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
  -- notices still reach BC (ADR-0009 Group Roles).
  for v_depth in reverse cardinality(v_path) .. 1 loop
    select array_agg(gm.member_id) into v_ids
      from public.group_members as gm
      join public.profiles as manager on manager.id = gm.member_id and manager.status = 'activ'
     where gm.group_id = v_path[v_depth]
       and gm.group_role = 'manager';
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

revoke execute on function
  private.group_role_of(bigint, uuid), private.is_group_member(bigint, uuid),
  private.has_group_manager(bigint), private.is_group_manager(bigint),
  private.is_group_responsible(bigint), private.can_manage_group_work(bigint),
  private.require_group_work_manager(bigint), private.group_managers(bigint)
  from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.is_group_manager(bigint), private.is_group_responsible(bigint),
  private.can_manage_group_work(bigint) to authenticated;

comment on function private.group_role_of(bigint, uuid) is
  'Owner-only live target-Member role lookup; caller-facing predicates separately require organization claims. Manager and Responsible inherit down the path, ordinary membership does not (#520).';
