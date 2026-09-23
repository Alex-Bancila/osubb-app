-- #586: Groups and their roster are now mastered by Group commands.
drop trigger departments_mirror_group on public.departments;
drop trigger teams_mirror_group on public.teams;
drop trigger projects_mirror_group on public.projects;
drop trigger member_departments_mirror_membership on public.member_departments;
drop trigger team_members_mirror_membership on public.team_members;
drop trigger project_members_mirror_membership on public.project_members;
drop trigger profiles_rederive_group_roles on public.profiles;

drop function private.mirror_department_group();
drop function private.mirror_team_group();
drop function private.mirror_project_group();
drop function private.mirror_department_membership();
drop function private.mirror_team_membership();
drop function private.mirror_project_membership();
drop function private.rederive_department_group_roles();
drop function private.sync_groups_from_legacy();
drop function private.sync_department_groups(text);
drop function private.sync_team_groups(text);
drop function private.sync_project_groups(bigint);
drop function private.sync_department_memberships(uuid, text);
drop function private.sync_team_memberships(text, uuid);
drop function private.sync_project_memberships(bigint, uuid);

-- The mirror could place historical rows below a Group's Minimum Level.
-- With it gone, every roster write must satisfy the invariant.
create or replace function private.validate_group_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.group_id is distinct from old.group_id
       or new.member_id is distinct from old.member_id) then
    raise exception using errcode = '23514', message = 'group_membership_identity_immutable';
  end if;
  if new.group_role = 'member'
     and exists (select 1 from public.groups as target
                  where target.id = new.group_id and target.automatic_membership) then
    raise exception using errcode = '23514', message = 'automatic_group_has_no_roster_members';
  end if;
  if exists (
    select 1
      from public.groups as target
      join public.profiles as member on member.id = new.member_id
      join public.roles as role on role.id = member.role
     where target.id = new.group_id
       and role.level < target.min_level
  ) then
    raise exception using errcode = '23514', message = 'group_member_below_min_level';
  end if;
  return new;
end;
$$;
comment on function private.validate_group_member() is
  'Membership identity is immutable; Automatic-Membership Groups hold no ordinary rows; every roster row must meet its Group Minimum Level (#586).';
