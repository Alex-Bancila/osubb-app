-- #311: active BC and Moderator may manage any active Project roster while
-- the active Project lead retains the same command authority.

create or replace function private.require_active_project_lead(p_project_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_level integer;
  v_leader uuid;
  v_status text;
begin
  if v_actor is null or not coalesce(public.auth_is_member(), false) then
    raise exception using
      errcode = '42501',
      message = 'project_lead_forbidden';
  end if;

  -- Keep this as the first row lock in every roster command. It serializes
  -- changes per Project and remains compatible with archive_project().
  select project.leader_id, project.status
    into v_leader, v_status
    from public.projects as project
   where project.id = p_project_id
   for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'project_lead_forbidden';
  end if;

  -- Read the current database role after locking the Project. JWT claims are
  -- only the organization-membership gate and cannot grant stale authority.
  select actor_role.level
    into v_actor_level
    from public.profiles as actor
    join public.roles as actor_role on actor_role.id = actor.role
   where actor.id = v_actor
     and actor.status = 'activ'
   for share of actor;

  if not found or (v_leader <> v_actor and v_actor_level < 6) then
    raise exception using
      errcode = '42501',
      message = 'project_lead_forbidden';
  end if;

  if v_status <> 'active' then
    raise sqlstate 'PT409' using message = 'project_archived';
  end if;

  return v_actor;
end;
$$;

comment on function private.require_active_project_lead(bigint) is
  'Returns auth.uid() for the current active Project lead or an active BC/Moderator with organization claims; locks the Project against concurrent roster/lifecycle changes and uses the current database role for global override.';
