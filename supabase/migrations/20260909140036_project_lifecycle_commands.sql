-- #273: create and archive projects through narrow BC/Moderator commands.
--
-- Browser-facing functions remain SECURITY INVOKER. The writes themselves
-- live in the non-exposed private schema because authenticated clients no
-- longer receive direct project-table or identity-sequence privileges.

create function private.require_project_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (
       select 1
         from public.profiles as profile
         join public.roles as member_role on member_role.id = profile.role
        where profile.id = v_actor
          and profile.status = 'activ'
          and member_role.level >= 6
     ) then
    raise exception using
      errcode = '42501',
      message = 'project_admin_forbidden';
  end if;

  return v_actor;
end;
$$;

comment on function private.require_project_admin() is
  'Returns auth.uid() only for an active BC/Moderator with organization claims; current database role overrides stale JWT level.';

create function private.create_project_impl(
  p_name text,
  p_leader_id uuid
)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_project_admin();
  v_name text := regexp_replace(
    p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'
  );
  v_created public.projects%rowtype;
begin
  if v_name is null or v_name = '' then
    raise sqlstate 'PT400' using message = 'invalid_project_name';
  end if;

  -- Keep the target eligible through the insert. The #270 trigger takes the
  -- same lock and atomically adds the leader's membership row.
  perform profile.id
    from public.profiles as profile
   where profile.id = p_leader_id
     and profile.status = 'activ'
   for share;

  if not found then
    raise sqlstate 'PT400' using message = 'project_leader_not_eligible';
  end if;

  insert into public.projects (name, leader_id, created_by)
  values (v_name, p_leader_id, v_actor)
  returning * into v_created;

  return v_created;
end;
$$;

comment on function private.create_project_impl(text, uuid) is
  'Privileged implementation for create_project; validates the live actor and leader and stamps created_by from auth.uid().';

create function private.archive_project_impl(p_project_id bigint)
returns public.projects
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
begin
  perform private.require_project_admin();

  select project.*
    into v_project
    from public.projects as project
   where project.id = p_project_id
   for update;

  if not found then
    raise sqlstate 'PT404' using message = 'project_not_found';
  end if;

  if v_project.status = 'archived' then
    return v_project;
  end if;

  update public.projects as project
     set status = 'archived',
         updated_at = clock_timestamp()
   where project.id = p_project_id
  returning project.* into v_project;

  return v_project;
end;
$$;

comment on function private.archive_project_impl(bigint) is
  'Privileged, idempotent project archive implementation. It preserves the creator, leader, and complete roster.';

create function public.create_project(
  p_name text,
  p_leader_id uuid
)
returns public.projects
language sql
security invoker
set search_path = ''
as $$
  select private.create_project_impl(p_name, p_leader_id);
$$;

comment on function public.create_project(text, uuid) is
  'Creates one active project as auth.uid(); available only to active BC/Moderator members.';

create function public.archive_project(p_project_id bigint)
returns public.projects
language sql
security invoker
set search_path = ''
as $$
  select private.archive_project_impl(p_project_id);
$$;

comment on function public.archive_project(bigint) is
  'Archives one project without deleting its roster or historical identity; available only to active BC/Moderator members.';

-- The browser can only mutate project lifecycle through the two commands.
revoke insert, update, delete on table public.projects from authenticated;
revoke usage, select on sequence public.projects_id_seq from authenticated;

-- PostgreSQL grants function execution to PUBLIC by default. Remove that
-- default at both layers, then expose only the intended wrapper path.
revoke execute on function private.require_project_admin()
  from public, anon, authenticated, service_role;
revoke execute on function private.create_project_impl(text, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.archive_project_impl(bigint)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;
grant execute on function private.create_project_impl(text, uuid)
  to authenticated;
grant execute on function private.archive_project_impl(bigint)
  to authenticated;

revoke execute on function public.create_project(text, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.archive_project(bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.create_project(text, uuid)
  to authenticated;
grant execute on function public.archive_project(bigint)
  to authenticated;
