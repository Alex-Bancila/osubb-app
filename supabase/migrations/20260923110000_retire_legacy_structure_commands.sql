-- #585: retire legacy structure writes after Group commands own the roster.

drop policy teams_create on public.teams;

-- Legacy Team reads remain until #590. Their authority now comes from the
-- Group roster, so the old Team-creation predicate can leave with its policy.
create or replace function private.can_read_team(p_team_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null
     and exists (
       select 1
         from public.groups as g
        where g.legacy_team_id = p_team_id
          and (
            private.group_role_of(g.id, (select auth.uid())) is not null
            or private.actor_level() >= 6
          )
     );
$$;
comment on function private.can_read_team(text) is
  'Read compatibility for legacy Teams until #590: a live Group member or an inherited Manager/Responsible reads the Team, with live BC/Moderator override.';

drop policy teams_read on public.teams;
create policy teams_read on public.teams
  for select to authenticated
  using ((select private.can_read_team(id)));
comment on policy teams_read on public.teams is
  'Legacy Team reads follow live Group Roles until the legacy Team table is dropped by #590.';

drop function public.create_project(text, uuid);
drop function public.archive_project(bigint);
drop function public.add_project_member(bigint, uuid);
drop function public.remove_project_member(bigint, uuid);
drop function public.grant_project_responsible(bigint, uuid);
drop function public.revoke_project_responsible(bigint, uuid);
drop function public.add_department_team_member(text, uuid);
drop function public.remove_department_team_member(text, uuid);
drop function public.add_independent_team_member(text, uuid);
drop function public.remove_independent_team_member(text, uuid);

drop function private.create_project_impl(text, uuid);
drop function private.archive_project_impl(bigint);
drop function private.add_project_member_impl(bigint, uuid);
drop function private.remove_project_member_impl(bigint, uuid);
drop function private.grant_project_responsible_impl(bigint, uuid);
drop function private.revoke_project_responsible_impl(bigint, uuid);
drop function private.add_department_team_member_impl(text, uuid);
drop function private.remove_department_team_member_impl(text, uuid);
drop function private.add_independent_team_member_impl(text, uuid);
drop function private.remove_independent_team_member_impl(text, uuid);

drop function private.require_project_admin();
drop function private.require_active_project_lead(bigint);
drop function private.require_department_team_membership_manager(text);
drop function private.require_independent_team_membership_manager(text);
drop function private.can_administer_team_structure(text);
drop function private.is_project_lead(bigint);
drop function private.is_project_responsible(bigint);
drop function private.can_manage_project_work(bigint);

drop trigger projects_validate_leader_profile on public.projects;
drop trigger projects_sync_leader_membership on public.projects;
drop trigger project_members_validate_manager on public.project_members;
drop trigger project_members_protect_leader on public.project_members;
drop trigger profiles_protect_active_project_managers on public.profiles;

drop function private.validate_project_manager_state();
drop function private.sync_project_leader_membership();
drop function private.validate_project_membership_change();
drop function private.protect_project_leader_membership();
drop function private.protect_active_project_manager_deactivation();
