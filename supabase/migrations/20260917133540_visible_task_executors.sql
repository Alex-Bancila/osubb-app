-- #499: expose only the active Executor's safe identity for readable Tasks.

create function private.visible_task_executors(p_task_ids bigint[])
returns table (
  task_id bigint,
  member_id uuid,
  full_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select assignment.task_id, assignment.member_id, profile.full_name
    from public.task_assignments as assignment
    left join public.profiles as profile on profile.id = assignment.member_id
   where coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null
     and assignment.ended_at is null
     and assignment.task_id = any(coalesce(p_task_ids, array[]::bigint[]))
     and private.can_read_task(assignment.task_id)
   order by assignment.task_id;
$$;

comment on function private.visible_task_executors(bigint[]) is
  'Least-privilege #499 read implementation: returns only the current Executor identity for Tasks the live caller may already read; Assignment history and contact fields remain private.';

create function public.visible_task_executors(p_task_ids bigint[])
returns table (
  task_id bigint,
  member_id uuid,
  full_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select executor.task_id, executor.member_id, executor.full_name
    from private.visible_task_executors(p_task_ids) as executor;
$$;

comment on function public.visible_task_executors(bigint[]) is
  'Authenticated RPC for #499. Accepts Task ids and returns only each readable Task current Executor id and display name.';

revoke execute on function private.visible_task_executors(bigint[])
  from public, anon, authenticated, service_role;
revoke execute on function public.visible_task_executors(bigint[])
  from public, anon, authenticated, service_role;

grant execute on function private.visible_task_executors(bigint[]) to authenticated;
grant execute on function public.visible_task_executors(bigint[]) to authenticated;
