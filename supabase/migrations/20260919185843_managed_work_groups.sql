-- #180: read-only task-form origins, using the same live authority as commands.
create function public.managed_work_groups()
returns table (id bigint, name text, path bigint[], min_level integer)
language sql stable security invoker set search_path = ''
as $$
  select grp.id, grp.name, grp.path, grp.min_level
    from public.groups as grp
   where coalesce(public.auth_is_member(), false)
     and private.can_manage_group_work(grp.id)
   order by grp.path, grp.id;
$$;
revoke all on function public.managed_work_groups() from public, anon, authenticated, service_role;
grant execute on function public.managed_work_groups() to authenticated;
comment on function public.managed_work_groups() is
  'Read-only Task Origins the live caller manages, through Group RLS and can_manage_group_work; includes managed descendants at every depth. Clients page the stable path/id ordering.';
