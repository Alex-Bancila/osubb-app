-- #168: expose server-derived Tracker management capability and Task ids.
-- Invoker reads retain tasks/Origin RLS and reuse the command authority helper.
create function public.can_manage_tasks()
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(public.auth_is_member(), false) and (
    exists (select 1 from public.departments d where private.can_manage_origin(d.id, null, null))
    or exists (select 1 from public.teams t where private.can_manage_origin(null, t.id, null))
    or exists (select 1 from public.projects p where private.can_manage_origin(null, null, p.id))
  );
$$;
revoke execute on function public.can_manage_tasks() from public, anon, authenticated, service_role;
grant execute on function public.can_manage_tasks() to authenticated;

create function public.my_managed_task_ids()
returns table(task_id bigint) language sql stable security invoker set search_path = '' as $$
  select t.id from public.tasks t
   where coalesce(public.auth_is_member(), false) and private.can_manage_task(t.id)
   order by t.id;
$$;
revoke execute on function public.my_managed_task_ids() from public, anon, authenticated, service_role;
grant execute on function public.my_managed_task_ids() to authenticated;
