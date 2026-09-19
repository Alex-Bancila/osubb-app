-- #189: expose the existing command evaluator capability through Task RLS.
-- No new authority rules: Wave 2 can replace the private helper without a UI rewrite.
create function public.can_evaluate_task(p_task_id bigint)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(public.auth_is_member(), false) and exists (
    select 1 from public.tasks as task where task.id = p_task_id
      and private.can_evaluate_task(task.id)
  );
$$;
revoke execute on function public.can_evaluate_task(bigint) from public, anon, authenticated, service_role;
grant execute on function public.can_evaluate_task(bigint) to authenticated;
comment on function public.can_evaluate_task(bigint) is
  'Read-only capability for review controls; commands revalidate authority under lock.';
