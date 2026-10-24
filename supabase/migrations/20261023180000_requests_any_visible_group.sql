-- #1099 (ruling R64, 2026-10-23): a Completed-work Request for any Group the Member can see.
--
-- Volunteers help other Departments and Projects, so a Member may file a
-- Request for work done for any active Group they can see whose Minimum Level
-- they meet, member of it or not. Until now create_completed_work_request
-- refused unless the requester held a Group Role or membership there
-- (private.group_role_of).
--
-- One rule, two readers. private.is_request_origin(group, member) is the set:
--   * the Group exists and is active;
--   * the Member can see it (private.can_see_group): a Private Group they are
--     not in stays hidden, and the command refuses it exactly as an unknown
--     Group -- 42501 request_origin_forbidden, the one nondisclosing answer
--     for every failure;
--   * the Member is live and their live level is at or above the Group's
--     Minimum Level;
--   * the Group is not an Automatic-Membership Group, except the Organization
--     Group. Nobody works "for" the Adunarea Generala (#855, B31); work for
--     OSUBB as a whole stays filed on the Organization Group. B31 was a filter
--     in the app only; it moves here so the picker and the command cannot
--     disagree. Biroul de Conducere follows the general rule: it is a Private
--     Group, so only its own holders and BC/the Moderator can see it, as
--     before.
-- create_completed_work_request_impl refuses outside it, and
-- public.request_origins() lists it for the Cereri picker.
--
-- Unchanged: the 30-per-24-hours cap (security pass L3), the decider
-- Notifications (private.request_deciders minus private.group_muted_for), and
-- the accepted lock deviation recorded in docs/backend/conventions.md -- the
-- filing command takes no lock; the worst race is a pending Request on a Group
-- archived or hidden an instant ago, which its deciders still act on. Who
-- decides is unchanged too: private.work_deciders already judges the requester
-- by their positions on the Group's path, never by their membership, and an
-- approval in the Request's own Group checks nothing about membership.
--
-- Rebuilt from main's latest body: create_completed_work_request_impl
-- (20261007180000_preferred_groups.sql).

-- ==================== the rule ====================

create function private.is_request_origin(p_group_id bigint, p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select grp.status = 'active'
       and (grp.is_organization or not grp.automatic_membership)
       and private.can_see_group(grp.id, p_member)
       and coalesce(private.actor_level(p_member), -1) >= grp.min_level
      from public.groups as grp
     where grp.id = p_group_id
  ), false);
$$;

comment on function private.is_request_origin(bigint, uuid) is
  'Ruling R64 (#1099): p_member may file a Completed-work Request for p_group_id -- the Group exists and is active, p_member can see it (private.can_see_group; a Private Group they are not in is false), p_member is a live activ Member at or above its Minimum Level, and it is not an Automatic-Membership Group other than the Organization Group (#855, B31: nobody works for the Adunarea Generala). Membership is not required. The one definition read by create_completed_work_request_impl and public.request_origins. Callable predicate, not a write path.';

revoke execute on function private.is_request_origin(bigint, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.is_request_origin(bigint, uuid) to authenticated;

-- ==================== the command ====================

CREATE OR REPLACE FUNCTION private.create_completed_work_request_impl(p_description text, p_group_id bigint)
 RETURNS completed_work_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor       uuid := (select auth.uid());
  v_description text;
  v_actor_name  text;
  v_request     public.completed_work_requests%rowtype;
begin
  if p_description is null or p_description !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'description_required';
  end if;
  v_description := regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  -- #673 (R8): measured as stored (trimmed).
  perform private.require_text_length('description', v_description, null, 2000);
  if p_group_id is null then
    raise sqlstate 'PT400' using message = 'invalid_origin';
  end if;
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'request_command_forbidden';
  end if;
  select coalesce(profile.nickname, profile.full_name) into v_actor_name
    from public.profiles as profile where profile.id = v_actor;
  -- R64: any active Group the requester can see and whose Minimum Level they
  -- meet, member of it or not. Unknown, hidden, inactive, too high and
  -- automatic are one answer.
  if not private.is_request_origin(p_group_id, v_actor) then
    raise exception using errcode = '42501', message = 'request_origin_forbidden';
  end if;
  -- Security pass L3: at most thirty Completed Work Requests per Member in
  -- any 24 hours, so a Member cannot flood the deciders with Notifications.
  perform private.require_daily_cap('completed_work_request', v_actor);
  insert into public.completed_work_requests (requester_id, group_id, description, status)
  values (v_actor, p_group_id, v_description, 'pending') returning * into v_request;
  -- R43: every decider may still decide (request_deciders is the authority);
  -- one who unselected the Request's Group is not told.
  perform private.notify(array(
      select decider
        from private.request_deciders(v_request.id) as decider
       where not private.group_muted_for(v_request.group_id, decider)),
    'task'::public.noti_kind, 'Cerere nouă: ' || left(v_description, 60),
    coalesce(v_actor_name, 'Un membru') || ' a trimis o cerere de muncă realizată.',
    null, 'request:' || v_request.id::text, v_actor, '/cereri');
  return v_request;
end;
$function$;

comment on function private.create_completed_work_request_impl(text, bigint) is
  'Files one pending Completed-work Request for any Group private.is_request_origin accepts for the live caller (ruling R64: active, visible to them, at or above its Minimum Level, not an Automatic-Membership Group other than the Organization Group; membership not required), else 42501 request_origin_forbidden whatever the reason, so a hidden Private Group answers as an unknown one; the requester is auth.uid(), never a parameter. At most 30 per Member in any 24 hours (private.require_daily_cap). Notifies private.request_deciders without an actor echo, minus a decider who unselected the Request''s Group in Grupuri preferate (R43, private.group_muted_for); every decider may still decide it.';

comment on function public.create_completed_work_request(text, bigint) is
  'Files work for exactly one Group the caller may name (private.is_request_origin, ruling R64: any active Group they can see whose Minimum Level they meet, member or not). The Group is the only Origin (#579). Notifies precisely request_deciders without an actor echo.';

-- ==================== the picker ====================

create function public.request_origins()
returns table (id bigint, name text, path bigint[])
language sql
stable
security invoker
set search_path = ''
as $$
  select grp.id, grp.name, grp.path
    from public.groups as grp
   where coalesce(public.auth_is_member(), false)
     and private.is_request_origin(grp.id, (select auth.uid()))
   order by grp.path, grp.id;
$$;

comment on function public.request_origins() is
  'Ruling R64 (#1099): the Groups the live caller may file a Completed-work Request for -- exactly those create_completed_work_request accepts (private.is_request_origin), under Group RLS. Empty without organization claims. Read by the Cereri Group picker.';

revoke execute on function public.request_origins()
  from public, anon, authenticated, service_role;
grant execute on function public.request_origins() to authenticated;
