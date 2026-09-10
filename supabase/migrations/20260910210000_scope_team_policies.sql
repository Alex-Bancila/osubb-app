-- #280: scoped Team discovery, roster reads, and Team creation.
-- Live profile, role, and membership rows are authoritative over JWT claims.

create function private.can_administer_team_structure(p_dept_id text)
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
          and (
            actor.role in ('bc', 'moderator')
            or (
              actor.role = 'bce'
              and p_dept_id is not null
              and exists (
                select 1
                  from public.member_departments as membership
                 where membership.member_id = actor.id
                   and membership.dept_id = p_dept_id
              )
            )
          )
     );
$$;

comment on function private.can_administer_team_structure(text) is
  'Whether active leadership may create Teams and read their context: BC/Moderator globally, or BCE in a current Department. This does not grant planned-work authority.';

create function private.can_read_team(p_team_id text)
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
          and (
            exists (
              select 1
                from public.team_members as membership
               where membership.team_id = p_team_id
                 and membership.member_id = actor.id
            )
            or exists (
              select 1
                from public.teams as team
               where team.id = p_team_id
                 and private.can_administer_team_structure(team.dept_id)
            )
          )
     );
$$;

comment on function private.can_read_team(text) is
  'Whether the active caller belongs to a Team or manages its scope. Runs outside Team RLS so roster policies do not recurse.';

revoke execute on function private.can_administer_team_structure(text)
  from public, anon, authenticated, service_role;
revoke execute on function private.can_read_team(text)
  from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.can_administer_team_structure(text) to authenticated;
grant execute on function private.can_read_team(text) to authenticated;

drop policy teams_manage on public.teams;
drop policy teams_read on public.teams;
drop policy team_members_manage on public.team_members;
drop policy team_members_read on public.team_members;

create policy teams_read on public.teams
  for select to authenticated
  using (
    (select private.can_read_team(id))
    or (select private.can_administer_team_structure(dept_id))
  );

create policy teams_create on public.teams
  for insert to authenticated
  with check ((select private.can_administer_team_structure(dept_id)));

create policy team_members_read on public.team_members
  for select to authenticated
  using ((select private.can_read_team(team_id)));

comment on policy teams_read on public.teams is
  'Active members read their own Teams; local BCE read their Department Teams; BC/Moderator read every Team.';
comment on policy teams_create on public.teams is
  'Live local BCE create Department Teams in their Departments; live BC/Moderator create either Team kind.';
comment on policy team_members_read on public.team_members is
  'A caller who may read a Team may read its complete roster.';
