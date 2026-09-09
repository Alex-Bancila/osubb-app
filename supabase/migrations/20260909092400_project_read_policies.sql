-- #272: expose project context only to active participants and the global
-- BC/Moderator readers accepted by ADR-0007.
--
-- Project relationships remain visible after archive so historical Tracker
-- records keep their context. Current profile state and database role are
-- authoritative: a stale JWT cannot preserve access after deactivation or
-- demotion. Mutation policies are deliberately left for later commands.

create policy projects_read
on public.projects
for select
to authenticated
using (
  public.auth_is_member()
  and (
    private.is_active_project_member(id)
    or (select exists (
      select 1
        from public.profiles as actor
        join public.roles as actor_role on actor_role.id = actor.role
       where actor.id = (select auth.uid())
         and actor.status = 'activ'
         and actor_role.level >= 6
    ))
  )
);

comment on policy projects_read on public.projects is
  'Active project members read their projects; active BC/Moderator read all projects, including archived history.';

create policy project_members_read
on public.project_members
for select
to authenticated
using (
  public.auth_is_member()
  and (
    private.is_active_project_member(project_id)
    or (select exists (
      select 1
        from public.profiles as actor
        join public.roles as actor_role on actor_role.id = actor.role
       where actor.id = (select auth.uid())
         and actor.status = 'activ'
         and actor_role.level >= 6
    ))
  )
);

comment on policy project_members_read on public.project_members is
  'Active project members read complete project rosters; active BC/Moderator read all rosters, including archived history.';

-- Keep Data API access explicit ahead of Supabase's default-grant change.
-- No INSERT/UPDATE/DELETE policy is added, so direct client mutations remain
-- denied even though earlier foundation migrations reserved DML grants for
-- the future command layer.
grant select on table public.projects, public.project_members
  to authenticated, service_role;
