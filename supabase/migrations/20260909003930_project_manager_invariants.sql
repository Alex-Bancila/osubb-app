-- #270: project leaders and Responsibles must remain valid project members.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

-- Project changes lock every affected manager profile in UUID order. A new
-- leader must be active even when assigned while the project is archived;
-- activating a project additionally validates every Responsible. A concurrent
-- deactivation therefore either finishes first and makes this statement fail,
-- or waits and then sees the committed active project.
create function private.validate_project_manager_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
     or tg_op = 'INSERT'
     or (tg_op = 'UPDATE' and new.leader_id is distinct from old.leader_id) then
    perform profile.id
      from public.profiles as profile
     where profile.id in (
       select new.leader_id
       union
       select membership.member_id
         from public.project_members as membership
        where membership.project_id = new.id
          and membership.project_role = 'responsible'
          and new.status = 'active'
     )
     order by profile.id
     for key share;

    if exists (
      select 1
        from (
          select new.leader_id as member_id
          union
          select membership.member_id
            from public.project_members as membership
           where membership.project_id = new.id
             and membership.project_role = 'responsible'
             and new.status = 'active'
        ) as manager
        left join public.profiles as profile on profile.id = manager.member_id
       where profile.id is null
          or profile.status <> 'activ'
    ) then
      raise exception using
        errcode = '23514',
        message = 'active project managers must be active OSUBB members';
    end if;
  end if;

  return new;
end;
$$;

create function private.sync_project_leader_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, member_id, project_role)
  values (new.id, new.leader_id, 'member')
  on conflict (project_id, member_id) do nothing;

  return new;
end;
$$;

revoke execute on function private.sync_project_leader_membership()
  from public, anon, authenticated, service_role;

-- Membership identity is immutable: changing a member or project is a delete
-- plus insert. Lock the project before the profile so manager changes and
-- archive/reactivation always acquire locks in the same order.
create function private.validate_project_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_status text;
begin
  if tg_op = 'UPDATE'
     and (old.project_id is distinct from new.project_id
       or old.member_id is distinct from new.member_id) then
    raise exception using
      errcode = '23514',
      message = 'project membership identity cannot be changed';
  end if;

  select project.status
    into project_status
    from public.projects as project
   where project.id = new.project_id
   for update;

  if new.project_role = 'responsible' and project_status = 'active' then
    perform 1
      from public.profiles as profile
     where profile.id = new.member_id
       and profile.status = 'activ'
     for key share;

    if not found then
      raise exception using
        errcode = '23514',
        message = 'active project Responsible must be an active OSUBB member';
    end if;
  end if;

  return new;
end;
$$;

create function private.protect_project_leader_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
    from public.projects as project
   where project.id = old.project_id
     and project.leader_id = old.member_id
   for update;

  if found then
    raise exception using
      errcode = '23514',
      message = 'current project leader membership cannot be removed';
  end if;

  return old;
end;
$$;

-- An archived project keeps its historical roster but no longer prevents a
-- person from leaving OSUBB. Reactivation validates the preserved managers.
create function private.protect_active_project_manager_deactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'activ'
     and new.status <> 'activ'
     and (
       exists (
         select 1
           from public.projects as project
          where project.status = 'active'
            and project.leader_id = new.id
       )
       or exists (
         select 1
           from public.project_members as membership
           join public.projects as project on project.id = membership.project_id
          where project.status = 'active'
            and membership.member_id = new.id
            and membership.project_role = 'responsible'
       )
     ) then
    raise exception using
      errcode = '23514',
      message = 'active project manager cannot be deactivated';
  end if;

  return new;
end;
$$;

revoke execute on function private.validate_project_manager_state()
  from public, anon, authenticated, service_role;
revoke execute on function private.validate_project_membership_change()
  from public, anon, authenticated, service_role;
revoke execute on function private.protect_project_leader_membership()
  from public, anon, authenticated, service_role;
revoke execute on function private.protect_active_project_manager_deactivation()
  from public, anon, authenticated, service_role;

create trigger projects_validate_leader_profile
before insert or update of leader_id, status on public.projects
for each row execute function private.validate_project_manager_state();

create trigger projects_sync_leader_membership
after insert or update of leader_id on public.projects
for each row execute function private.sync_project_leader_membership();

create trigger project_members_validate_manager
before insert or update of project_id, member_id, project_role
on public.project_members
for each row execute function private.validate_project_membership_change();

create trigger project_members_protect_leader
before delete on public.project_members
for each row execute function private.protect_project_leader_membership();

create trigger profiles_protect_active_project_managers
before update of status on public.profiles
for each row execute function private.protect_active_project_manager_deactivation();

-- Existing projects may have been created between #268/#269 and this
-- migration. Make their leader membership explicit before validating them.
insert into public.project_members (project_id, member_id, project_role)
select project.id, project.leader_id, 'member'
  from public.projects as project
on conflict (project_id, member_id) do nothing;

do $$
begin
  if exists (
    select 1
      from public.projects as project
      join public.profiles as leader on leader.id = project.leader_id
     where project.status = 'active'
       and leader.status <> 'activ'
  ) or exists (
    select 1
      from public.project_members as membership
      join public.projects as project on project.id = membership.project_id
      join public.profiles as responsible on responsible.id = membership.member_id
     where project.status = 'active'
       and membership.project_role = 'responsible'
       and responsible.status <> 'activ'
  ) then
    raise exception using
      errcode = '23514',
      message = 'existing active project managers must be active OSUBB members';
  end if;
end;
$$;
