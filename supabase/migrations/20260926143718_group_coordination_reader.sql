-- #589: the member-facing Group page needs names and positions, not a roster.
-- #675's member_card already makes this identity/membership subset readable to
-- active Members. This bounded projection avoids one request per Member and
-- returns rows only for a Group the caller can read under groups_read.
--
-- A security definer read of a Group-owned row, so conventions §10 (#756,
-- ruling R25) applies: private.can_see_group gates the whole projection and a
-- Private Group's coordinators never reach an outsider, whatever their level,
-- roster or pending Application. Behind that gate the limbs are groups_read's
-- own (rebuilt from 20260925091107_task_visibility_follows_audience.sql),
-- plus an explicit activ-Profile check so a stale token never reads it.
-- private_groups.test.sql names the assertion that goes red if the gate is
-- removed.
create function private.group_coordination_impl(p_group_id bigint)
returns table (
  member_id      uuid,
  full_name      text,
  nickname       text,
  group_role     text,
  position_title text
)
language sql
stable
security definer
set search_path = ''
as $$
  select member.id,
         member.full_name,
         member.nickname,
         roster.group_role,
         roster.position_title
    from public.groups as g
    join public.group_members as roster on roster.group_id = g.id
    join public.profiles as member on member.id = roster.member_id
   where g.id = p_group_id
     and roster.group_role in ('manager', 'responsible')
     and public.auth_is_member()
     and exists (select 1
                   from public.profiles as caller
                  where caller.id = (select auth.uid())
                    and caller.status = 'activ')
     and private.can_see_group(g.id, (select auth.uid()))
     and ((g.status = 'active' and (select private.caller_level()) >= g.min_level)
          or (select private.caller_level()) >= 5
          or private.can_read_group_roster(g.id)
          or private.has_pending_group_application(g.id)
          or ((select private.caller_level()) >= 0 and private.has_open_org_opportunity(g.id)))
   order by coalesce(member.nickname, member.full_name), member.id;
$$;

comment on function private.group_coordination_impl(bigint) is
  'Body of public.group_coordination (#589): the Group Managers and Responsibles of one Group -- id, full name, Nickname, Group Role and position title, the identity subset member_card already exposes. Rows only when the caller carries organization claims, has an activ Profile, can see the Group (private.can_see_group, #756) and passes groups_read''s limbs; none otherwise. Never contact details, points or ordinary roster membership.';

create function public.group_coordination(p_group_id bigint)
returns table (
  member_id      uuid,
  full_name      text,
  nickname       text,
  group_role     text,
  position_title text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.group_coordination_impl(p_group_id);
$$;

comment on function public.group_coordination(bigint) is
  'Identity and position subset of member_card for the coordinators of a Group the caller can read (#589). A Private Group''s coordinators reach only those who can see it (#756). Never contact details, points, or ordinary roster membership.';

revoke execute on function private.group_coordination_impl(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.group_coordination(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.group_coordination_impl(bigint) to authenticated;
grant execute on function public.group_coordination(bigint) to authenticated;
