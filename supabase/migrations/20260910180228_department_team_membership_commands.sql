-- #279: the parent department's BCE, plus BC and Moderator globally, manage
-- Department-Team membership through narrow, actor-derived commands. Mirrors
-- #278's Independent-Team commands so the two Team kinds read as one API.

create function private.require_department_team_membership_manager(p_team_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_dept_id text;
begin
  if v_actor is null or not coalesce(public.auth_is_member(), false) then
    raise exception using
      errcode = '42501',
      message = 'department_team_membership_forbidden';
  end if;

  -- Reject forged or stale role claims from the live profile before revealing
  -- whether the requested Team exists or is a Department Team. This cheap
  -- check does not yet know the Team's department, so it only narrows to
  -- roles that can EVER manage a Department Team (BC/Moderator globally, BCE
  -- for their own department — checked below once the department is known).
  perform profile.id
    from public.profiles as profile
   where profile.id = v_actor
     and profile.status = 'activ'
     and profile.role in ('bc', 'moderator', 'bce');

  if not found then
    raise exception using
      errcode = '42501',
      message = 'department_team_membership_forbidden';
  end if;

  -- Every roster command takes the Team lock first. This serializes duplicate
  -- and opposing membership changes and races safely with future Team commands.
  select team.dept_id
    into v_dept_id
    from public.teams as team
   where team.id = p_team_id
   for update;

  if not found then
    raise sqlstate 'PT404' using message = 'team_not_found';
  end if;

  if v_dept_id is null then
    raise sqlstate 'PT400' using message = 'department_team_required';
  end if;

  -- Revalidate and hold the actor active after waiting for the Team lock. A
  -- live BC/Moderator manages every Department Team; a live BCE manages only
  -- the Department Teams under a department they actually hold today.
  perform profile.id
    from public.profiles as profile
   where profile.id = v_actor
     and profile.status = 'activ'
     and (
       profile.role in ('bc', 'moderator')
       or (
         profile.role = 'bce'
         and exists (
           select 1
             from public.member_departments as membership
            where membership.member_id = v_actor
              and membership.dept_id = v_dept_id
         )
       )
     )
   for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'department_team_membership_forbidden';
  end if;

  return v_actor;
end;
$$;

comment on function private.require_department_team_membership_manager(text) is
  'Returns auth.uid() only for a live active BC/Moderator, or a live active BCE of the target Team''s own department, and locks the target Department Team before roster changes.';

create function private.add_department_team_member_impl(
  p_team_id text,
  p_member_id uuid
)
returns public.team_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.team_members%rowtype;
begin
  perform private.require_department_team_membership_manager(p_team_id);

  perform profile.id
    from public.profiles as profile
   where profile.id = p_member_id
     and profile.status = 'activ'
   for share;

  if not found then
    raise sqlstate 'PT400' using message = 'team_member_not_eligible';
  end if;

  insert into public.team_members (team_id, member_id)
  values (p_team_id, p_member_id)
  on conflict (team_id, member_id) do nothing;

  select membership.*
    into strict v_membership
    from public.team_members as membership
   where membership.team_id = p_team_id
     and membership.member_id = p_member_id;

  return v_membership;
end;
$$;

comment on function private.add_department_team_member_impl(text, uuid) is
  'Idempotently adds one active OSUBB member to a Department Team.';

create function private.remove_department_team_member_impl(
  p_team_id text,
  p_member_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed_count bigint;
begin
  perform private.require_department_team_membership_manager(p_team_id);

  delete from public.team_members as membership
   where membership.team_id = p_team_id
     and membership.member_id = p_member_id;

  get diagnostics v_removed_count = row_count;
  return v_removed_count = 1;
end;
$$;

comment on function private.remove_department_team_member_impl(text, uuid) is
  'Idempotently removes a Department-Team membership and reports whether a row existed.';

create function public.add_department_team_member(
  p_team_id text,
  p_member_id uuid
)
returns public.team_members
language sql
security invoker
set search_path = ''
as $$
  select private.add_department_team_member_impl(p_team_id, p_member_id);
$$;

create function public.remove_department_team_member(
  p_team_id text,
  p_member_id uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.remove_department_team_member_impl(p_team_id, p_member_id);
$$;

comment on function public.add_department_team_member(text, uuid) is
  'Adds an active OSUBB member to a Department Team; callable only by a live active BC/Moderator, or the live active BCE of that Team''s own department.';
comment on function public.remove_department_team_member(text, uuid) is
  'Removes a member from a Department Team; callable only by a live active BC/Moderator, or the live active BCE of that Team''s own department.';

revoke execute on function private.require_department_team_membership_manager(text)
  from public, anon, authenticated, service_role;
revoke execute on function private.add_department_team_member_impl(text, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.remove_department_team_member_impl(text, uuid)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;
grant execute on function private.add_department_team_member_impl(text, uuid)
  to authenticated;
grant execute on function private.remove_department_team_member_impl(text, uuid)
  to authenticated;

revoke execute on function public.add_department_team_member(text, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.remove_department_team_member(text, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.add_department_team_member(text, uuid)
  to authenticated;
grant execute on function public.remove_department_team_member(text, uuid)
  to authenticated;
