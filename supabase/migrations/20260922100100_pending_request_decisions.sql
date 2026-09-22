-- #353: return only pending Requests the live caller may decide.
-- RLS remains in force, and request_deciders stays the single authority rule.
create function public.pending_request_decisions()
returns table(id bigint, description text, requester_id uuid, requester_name text, group_id bigint, group_name text, created_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select request.id, request.description, request.requester_id,
         requester.full_name, request.group_id, origin.name, request.created_at
    from public.completed_work_requests as request
    join public.profiles_directory as requester on requester.id = request.requester_id
    join public.groups as origin on origin.id = request.group_id
   where coalesce(public.auth_is_member(), false)
     and request.status = 'pending'
     and private.can_decide_request(request.id)
   order by request.created_at, request.id;
$$;
revoke all on function public.pending_request_decisions() from public, anon, authenticated, service_role;
grant execute on function public.pending_request_decisions() to authenticated;
comment on function public.pending_request_decisions() is
  'Read-only pending Request queue delegated to live can_decide_request, under Request, Group and directory RLS. No self-decisions; clients page stable created_at/id order.';
