-- #271: reusable project authorization predicates for RLS and commands.
--
-- These functions live outside the exposed Data API schema. They derive the
-- subject from auth.uid(), require both organisation claims and a currently
-- active profile, and never accept a caller-supplied member id.

create function private.is_active_project_member(p_project_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and exists (
       select 1
         from public.project_members as membership
         join public.profiles as profile on profile.id = membership.member_id
        where membership.project_id = p_project_id
          and membership.member_id = (select auth.uid())
          and profile.status = 'activ'
     );
$$;

comment on function private.is_active_project_member(bigint) is
  'Whether the caller is both an active OSUBB member and a member of this project. Archived projects retain relationship identity for historical reads.';

create function private.is_project_lead(p_project_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and exists (
       select 1
         from public.projects as project
         join public.profiles as profile on profile.id = project.leader_id
        where project.id = p_project_id
          and project.leader_id = (select auth.uid())
          and profile.status = 'activ'
     );
$$;

comment on function private.is_project_lead(bigint) is
  'Whether the active caller is the project lead. The relationship remains queryable after archive; work-management checks project status separately.';

create function private.is_project_responsible(p_project_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and exists (
       select 1
         from public.project_members as membership
         join public.profiles as profile on profile.id = membership.member_id
        where membership.project_id = p_project_id
          and membership.member_id = (select auth.uid())
          and membership.project_role = 'responsible'
          and profile.status = 'activ'
     );
$$;

comment on function private.is_project_responsible(bigint) is
  'Whether the active caller holds the Responsible role in this project. Archived projects retain relationship identity for historical reads.';

create function private.can_manage_project_work(p_project_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and exists (
       select 1
         from public.projects as project
         join public.profiles as actor on actor.id = (select auth.uid())
         join public.roles as actor_role on actor_role.id = actor.role
        where project.id = p_project_id
          and project.status = 'active'
          and actor.status = 'activ'
          and (
            actor_role.level >= 6
            or project.leader_id = actor.id
            or exists (
              select 1
                from public.project_members as membership
               where membership.project_id = project.id
                 and membership.member_id = actor.id
                 and membership.project_role = 'responsible'
            )
          )
     );
$$;

comment on function private.can_manage_project_work(bigint) is
  'Whether the active caller may manage work in an active project: its lead, a Project Responsible, BC, or Moderator. Current database role wins over stale JWT level claims.';

-- Private-schema helpers are not RPC endpoints: the schema is not exposed by
-- PostgREST. Authenticated needs USAGE + EXECUTE only so RLS policies can call
-- these predicates. Trigger functions from #270 remain unexecutable.
revoke execute on function private.is_active_project_member(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function private.is_project_lead(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function private.is_project_responsible(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function private.can_manage_project_work(bigint)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;
grant execute on function private.is_active_project_member(bigint)
  to authenticated;
grant execute on function private.is_project_lead(bigint)
  to authenticated;
grant execute on function private.is_project_responsible(bigint)
  to authenticated;
grant execute on function private.can_manage_project_work(bigint)
  to authenticated;
