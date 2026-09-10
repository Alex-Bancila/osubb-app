-- #279 follow-up: Department membership determines BCE local authority, so it
-- must only be mutable by live BC/Moderator identities or trusted provisioning.

create function private.can_manage_department_memberships()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and exists (
       select 1
         from public.profiles as actor
        where actor.id = (select auth.uid())
          and actor.status = 'activ'
          and actor.role in ('bc', 'moderator')
     );
$$;

comment on function private.can_manage_department_memberships() is
  'Whether the caller has organization claims and is currently an active BC or Moderator. Live database role and status override stale JWT claims.';

revoke execute on function private.can_manage_department_memberships()
  from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.can_manage_department_memberships()
  to authenticated;

drop policy member_departments_manage on public.member_departments;
create policy member_departments_manage on public.member_departments
  for all to authenticated
  using ((select private.can_manage_department_memberships()))
  with check ((select private.can_manage_department_memberships()));

-- A BCE's Department row is part of the authorization decision made by these
-- commands. Lock it after the Team and actor profile so a concurrent removal
-- cannot commit while a roster mutation is relying on the old authority.
create or replace function private.require_department_team_membership_manager(p_team_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_role public.member_role;
  v_dept_id text;
begin
  if v_actor is null or not coalesce(public.auth_is_member(), false) then
    raise exception using
      errcode = '42501',
      message = 'department_team_membership_forbidden';
  end if;

  -- Deny identities which can never manage a Department Team before looking
  -- up or locking the target, preserving the command's non-disclosure boundary.
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

  select profile.role
    into v_actor_role
    from public.profiles as profile
   where profile.id = v_actor
     and profile.status = 'activ'
     and profile.role in ('bc', 'moderator', 'bce')
   for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'department_team_membership_forbidden';
  end if;

  if v_actor_role = 'bce' then
    perform membership.member_id
      from public.member_departments as membership
     where membership.member_id = v_actor
       and membership.dept_id = v_dept_id
     for share;

    if not found then
      raise exception using
        errcode = '42501',
        message = 'department_team_membership_forbidden';
    end if;
  end if;

  return v_actor;
end;
$$;

comment on function private.require_department_team_membership_manager(text) is
  'Returns auth.uid() only for a live active BC/Moderator, or a live active BCE of the target Team''s own department, locking Team, actor profile, and BCE Department membership before roster changes.';
