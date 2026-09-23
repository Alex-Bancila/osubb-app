-- #589: the member-facing Group page needs names and positions, not a roster.
-- #675's member_card already makes this identity/membership subset readable to
-- active Members. This bounded projection avoids one request per Member and
-- additionally requires the owning Group to be visible under groups_read.
create function private.group_coordination_impl(p_group_id bigint)
returns table(member_id uuid, full_name text, nickname text, group_role text, position_title text)
language sql stable security definer set search_path = '' as $$
 select member.id,member.full_name,member.nickname,roster.group_role,roster.position_title
 from public.groups g join public.group_members roster on roster.group_id=g.id
 join public.profiles member on member.id=roster.member_id
 where g.id=p_group_id and roster.group_role in ('manager','responsible')
 and public.auth_is_member()
 and exists(select 1 from public.profiles caller where caller.id=(select auth.uid()) and caller.status='activ')
 and ((g.status='active' and (select private.caller_level())>=g.min_level)
   or (select private.caller_level())>=5
   or private.can_read_group_roster(g.id)
   or private.has_pending_group_application(g.id))
 order by coalesce(member.nickname,member.full_name),member.id;
$$;
create function public.group_coordination(p_group_id bigint)
returns table(member_id uuid, full_name text, nickname text, group_role text, position_title text)
language sql stable security invoker set search_path = '' as $$
 select * from private.group_coordination_impl(p_group_id);
$$;
revoke execute on function private.group_coordination_impl(bigint) from public,anon,authenticated,service_role;
revoke execute on function public.group_coordination(bigint) from public,anon,authenticated,service_role;
grant execute on function private.group_coordination_impl(bigint),public.group_coordination(bigint) to authenticated;
comment on function public.group_coordination(bigint) is 'Identity and position subset of member_card for coordinators of a visible Group. Never contact details, points, or ordinary roster membership.';
