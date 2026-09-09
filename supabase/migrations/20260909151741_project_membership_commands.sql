-- #274: project leads manage active-project membership through narrow RPCs.
--
-- Every command derives the actor from auth.uid(), locks the project before
-- any profile or membership row, and writes through a private SECURITY DEFINER
-- implementation. Authenticated clients lose direct roster mutation grants.

create function private.require_active_project_lead(p_project_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_leader uuid;
  v_status text;
begin
  if v_actor is null or not coalesce(public.auth_is_member(), false) then
    raise exception using
      errcode = '42501',
      message = 'project_lead_forbidden';
  end if;

  -- This is the first row lock in every roster command. It serializes changes
  -- per project and makes them race safely with archive_project(). Missing
  -- projects and existing projects led by someone else share one denial.
  select project.leader_id, project.status
    into v_leader, v_status
    from public.projects as project
   where project.id = p_project_id
   for update;

  if not found or v_leader <> v_actor then
    raise exception using
      errcode = '42501',
      message = 'project_lead_forbidden';
  end if;

  -- Keep the lead active until the command commits. FOR SHARE, unlike
  -- FOR KEY SHARE, conflicts with an ordinary status update.
  perform profile.id
    from public.profiles as profile
   where profile.id = v_actor
     and profile.status = 'activ'
   for share;

  if not found then
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
  'Returns auth.uid() only for the current active lead of an active project and locks the project against concurrent roster/lifecycle changes.';

create function private.add_project_member_impl(
  p_project_id bigint,
  p_member_id uuid
)
returns public.project_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.project_members%rowtype;
begin
  perform private.require_active_project_lead(p_project_id);

  -- Membership is useful only to current OSUBB members. Hold the profile lock
  -- through insertion so a concurrent deactivation cannot invalidate it.
  perform profile.id
    from public.profiles as profile
   where profile.id = p_member_id
     and profile.status = 'activ'
   for share;

  if not found then
    raise sqlstate 'PT400' using message = 'project_member_not_eligible';
  end if;

  insert into public.project_members (project_id, member_id, project_role)
  values (p_project_id, p_member_id, 'member')
  on conflict (project_id, member_id) do nothing;

  select membership.*
    into strict v_membership
    from public.project_members as membership
   where membership.project_id = p_project_id
     and membership.member_id = p_member_id;

  return v_membership;
end;
$$;

comment on function private.add_project_member_impl(bigint, uuid) is
  'Idempotently adds one active OSUBB member without downgrading an existing Project Responsible.';

create function private.remove_project_member_impl(
  p_project_id bigint,
  p_member_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_removed_count bigint;
begin
  v_actor := private.require_active_project_lead(p_project_id);

  if p_member_id = v_actor then
    raise sqlstate 'PT409' using message = 'project_leader_membership_required';
  end if;

  delete from public.project_members as membership
   where membership.project_id = p_project_id
     and membership.member_id = p_member_id;

  get diagnostics v_removed_count = row_count;
  return v_removed_count = 1;
end;
$$;

comment on function private.remove_project_member_impl(bigint, uuid) is
  'Idempotently removes a non-leader membership and reports whether a row existed.';

create function private.grant_project_responsible_impl(
  p_project_id bigint,
  p_member_id uuid
)
returns public.project_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.project_members%rowtype;
begin
  perform private.require_active_project_lead(p_project_id);

  perform profile.id
    from public.profiles as profile
   where profile.id = p_member_id
     and profile.status = 'activ'
   for share;

  if not found then
    raise sqlstate 'PT400' using message = 'project_member_not_eligible';
  end if;

  update public.project_members as membership
     set project_role = 'responsible'
   where membership.project_id = p_project_id
     and membership.member_id = p_member_id
  returning membership.* into v_membership;

  if not found then
    raise sqlstate 'PT404' using message = 'project_member_not_found';
  end if;

  return v_membership;
end;
$$;

comment on function private.grant_project_responsible_impl(bigint, uuid) is
  'Idempotently grants the project-local Responsible role to an existing active member.';

create function private.revoke_project_responsible_impl(
  p_project_id bigint,
  p_member_id uuid
)
returns public.project_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.project_members%rowtype;
begin
  perform private.require_active_project_lead(p_project_id);

  update public.project_members as membership
     set project_role = 'member'
   where membership.project_id = p_project_id
     and membership.member_id = p_member_id
  returning membership.* into v_membership;

  if not found then
    raise sqlstate 'PT404' using message = 'project_member_not_found';
  end if;

  return v_membership;
end;
$$;

comment on function private.revoke_project_responsible_impl(bigint, uuid) is
  'Idempotently returns a Project Responsible to ordinary project membership.';

create function public.add_project_member(
  p_project_id bigint,
  p_member_id uuid
)
returns public.project_members
language sql
security invoker
set search_path = ''
as $$
  select private.add_project_member_impl(p_project_id, p_member_id);
$$;

create function public.remove_project_member(
  p_project_id bigint,
  p_member_id uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.remove_project_member_impl(p_project_id, p_member_id);
$$;

create function public.grant_project_responsible(
  p_project_id bigint,
  p_member_id uuid
)
returns public.project_members
language sql
security invoker
set search_path = ''
as $$
  select private.grant_project_responsible_impl(p_project_id, p_member_id);
$$;

create function public.revoke_project_responsible(
  p_project_id bigint,
  p_member_id uuid
)
returns public.project_members
language sql
security invoker
set search_path = ''
as $$
  select private.revoke_project_responsible_impl(p_project_id, p_member_id);
$$;

comment on function public.add_project_member(bigint, uuid) is
  'Adds an active OSUBB member to an active project; callable only by its current active lead.';
comment on function public.remove_project_member(bigint, uuid) is
  'Removes a non-leader project member; callable only by the current active lead.';
comment on function public.grant_project_responsible(bigint, uuid) is
  'Grants Project Responsible to an existing member; callable only by the current active lead.';
comment on function public.revoke_project_responsible(bigint, uuid) is
  'Revokes Project Responsible without removing membership; callable only by the current active lead.';

-- The browser may read the roster through RLS but can mutate it only through
-- the four audited commands. service_role retains its existing operational
-- table access for trusted provisioning and seed workflows.
revoke insert, update, delete on table public.project_members
  from authenticated;

revoke execute on function private.require_active_project_lead(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function private.add_project_member_impl(bigint, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.remove_project_member_impl(bigint, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.grant_project_responsible_impl(bigint, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.revoke_project_responsible_impl(bigint, uuid)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;
grant execute on function private.add_project_member_impl(bigint, uuid)
  to authenticated;
grant execute on function private.remove_project_member_impl(bigint, uuid)
  to authenticated;
grant execute on function private.grant_project_responsible_impl(bigint, uuid)
  to authenticated;
grant execute on function private.revoke_project_responsible_impl(bigint, uuid)
  to authenticated;

revoke execute on function public.add_project_member(bigint, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.remove_project_member(bigint, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.grant_project_responsible(bigint, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.revoke_project_responsible(bigint, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.add_project_member(bigint, uuid)
  to authenticated;
grant execute on function public.remove_project_member(bigint, uuid)
  to authenticated;
grant execute on function public.grant_project_responsible(bigint, uuid)
  to authenticated;
grant execute on function public.revoke_project_responsible(bigint, uuid)
  to authenticated;
