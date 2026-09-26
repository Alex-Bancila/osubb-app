-- #590: retire legacy structure storage; Groups own every live roster.
do $$
begin
  if exists(select 1 from public.announcements where group_id is null) then
    raise exception 'announcement_group_required';
  end if;
end;
$$;

-- #591 removes these compatibility claims; until then derive them from Groups,
-- so a token issued between the two migrations never queries a dropped table.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  member record;
  claims jsonb;
  meta   jsonb;
begin
  select p.role, r.level,
         coalesce((select jsonb_agg(g.legacy_dept_id order by g.legacy_dept_id)
                     from public.group_members gm join public.groups g on g.id=gm.group_id
                    where gm.member_id=p.id and g.legacy_dept_id is not null), '[]'::jsonb) as dept_ids,
         coalesce((select jsonb_agg(g.legacy_team_id order by g.legacy_team_id)
                     from public.group_members gm join public.groups g on g.id=gm.group_id
                    where gm.member_id=p.id and g.legacy_team_id is not null), '[]'::jsonb) as team_ids,
         -- Explicit roster rows only: Automatic Membership (the Organization Group) is
         -- derived from the Role and is never a claim. Numbers, ascending, so a token is
         -- byte-stable for the same roster.
         coalesce((select jsonb_agg(gm.group_id order by gm.group_id)
                     from public.group_members gm
                    where gm.member_id = p.id), '[]'::jsonb) as group_ids
    into member
    from public.profiles p
    join public.roles r on r.id = p.role
   where p.id = (event ->> 'user_id')::uuid
     and p.status = 'activ';

  if not found then
    return event;
  end if;

  claims := coalesce(event -> 'claims', '{}'::jsonb);
  meta   := coalesce(claims -> 'app_metadata', '{}'::jsonb)
            || jsonb_build_object(
                 'member_role',  member.role,
                 'member_level', member.level,
                 'dept_ids',     member.dept_ids,
                 'team_ids',     member.team_ids,
                 'group_ids',    member.group_ids);
  return jsonb_set(event, '{claims}', jsonb_set(claims, '{app_metadata}', meta));
end;
$$;


drop table private.legacy_team_leads;
alter table public.announcements drop column dept_id;
drop policy teams_read on public.teams;
drop policy team_members_read on public.team_members;
drop policy projects_read on public.projects;
drop policy project_members_read on public.project_members;
drop policy member_departments_manage on public.member_departments;
drop function private.can_read_team(text);
drop function private.is_active_project_member(bigint);
drop function private.can_manage_department_memberships();
drop table public.member_departments;
drop table public.team_members;
drop table public.project_members;
drop table public.teams;
drop table public.projects;
drop table public.departments;
