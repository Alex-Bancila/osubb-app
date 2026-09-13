-- #368: shared server-maintained timestamps.

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

comment on function private.set_updated_at() is
  'Trigger helper that stamps updated_at for every changed row.';

revoke execute on function private.set_updated_at()
  from public, anon, authenticated, service_role;

create trigger projects_set_updated_at
before update on public.projects
for each row execute function private.set_updated_at();

create trigger campaigns_set_updated_at
before update on public.campaigns
for each row execute function private.set_updated_at();

alter table public.events
  add column created_at timestamptz not null default now();

alter table public.project_members
  add column created_at timestamptz not null default now();

-- The trigger is now the sole owner of projects.updated_at. Keep the existing
-- command contract while removing its hand-maintained timestamp assignment.
create or replace function private.archive_project_impl(p_project_id bigint)
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
     set status = 'archived'
   where project.id = p_project_id
  returning project.* into v_project;

  return v_project;
end;
$$;

revoke execute on function private.archive_project_impl(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.archive_project_impl(bigint)
  to authenticated;
