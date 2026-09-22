-- #370: name the missing Group as malformed input, before any authority gate.
--
-- 20260922090000_group_event_creation.sql left `p_group_id => null` to fall out of the Group
-- lookup as `42501 calendar_manage_forbidden`, which reads as "you may not" for what is in
-- fact "you did not say where". The Wave 2 plan's step order puts every malformed-input check
-- ahead of the gate so a claimless caller is told what is wrong with the call rather than
-- being refused: a null Group now raises `PT400 event_group_required`, the same reason
-- private.sync_event_group_origin already uses for an Event that names no Group (23514 there,
-- because a trigger-enforced invariant is a different layer than a rejected argument).
--
-- The check is placed LAST in the malformed block rather than first: the block's internal
-- precedence is already pinned by supabase/tests/create_event.test.sql, whose claimless cases
-- pass a null Group alongside each other malformed argument and expect that argument's reason.
-- Precedence between two malformed arguments is not a behaviour worth churning; what matters
-- is that all of them precede the gate.
--
-- Nothing else in the body changes. Re-stated in full because `create or replace` has no
-- partial form.
create or replace function private.create_event_impl(
  p_title text, p_type text, p_group_id bigint, p_starts_at timestamptz,
  p_ends_at timestamptz default null, p_location text default null,
  p_capacity integer default null, p_description text default null, p_min_level integer default 0
)
returns public.events
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_level integer;
  v_group public.groups%rowtype;
  v_created public.events%rowtype;
begin
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_event_title';
  end if;
  if p_type is null or p_type not in ('sedinta','activitate','call','eveniment','deadline','recrutare') then
    raise sqlstate 'PT400' using message = 'invalid_event_type';
  end if;
  if p_starts_at is null or (p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise sqlstate 'PT400' using message = 'invalid_event_interval';
  end if;
  if p_capacity is not null and p_capacity <= 0 then
    raise sqlstate 'PT400' using message = 'invalid_event_capacity';
  end if;
  if p_min_level is null or p_min_level not in (0,3,5,6) then
    raise sqlstate 'PT400' using message = 'invalid_event_min_level';
  end if;
  if p_group_id is null then
    raise sqlstate 'PT400' using message = 'event_group_required';
  end if;

  select * into v_group from public.groups where id = p_group_id and status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  begin
    if v_group.legacy_dept_id = 'org' then
      v_actor := private.require_active_member();
      perform 1 from public.profiles as profile
        where profile.id = v_actor and profile.status = 'activ' for share of profile;
      if not found then
        raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
      end if;
      v_level := private.actor_level(v_actor);
      if v_level < 6 then
        -- An Organization Event needs a real live Group Role, not an old rank or JWT roster.
        -- Lock only roster rows: Group SHARE locks conflict with legacy mirror upserts.
        perform 1 from public.group_members as gm
          where gm.member_id = v_actor and gm.group_role in ('manager','responsible')
          order by gm.group_id for share of gm;
        if not found then
          raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
        end if;
      end if;
    else
      v_actor := private.require_group_work_manager(p_group_id);
    end if;
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end;
  -- Refresh settings and level after any wait for live authority.
  select * into v_group from public.groups where id = p_group_id and status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  v_level := private.actor_level(v_actor);
  if p_min_level < v_group.min_level then
    raise sqlstate 'PT400' using message = 'event_min_level_below_group';
  end if;
  if v_level < 9 and p_min_level > v_level then
    raise sqlstate 'PT400' using message = 'event_min_level_above_actor';
  end if;
  insert into public.events(title,type,group_id,starts_at,ends_at,location,capacity,description,min_level,created_by)
    values (btrim(p_title),p_type::public.event_type,p_group_id,p_starts_at,p_ends_at,
      nullif(btrim(p_location),''),p_capacity,nullif(btrim(p_description),''),p_min_level,v_actor)
    returning * into v_created;
  return v_created;
end;
$$;

comment on function private.create_event_impl(text,text,bigint,timestamptz,timestamptz,text,integer,text,integer) is
  'Creates an Event on a Group, authorized by Group Role (ADR-0009 Wave 2, #370). Malformed input is judged first, for everyone, so a caller without organization claims learns what is wrong with the call: PT400 invalid_event_title / invalid_event_type / invalid_event_interval / invalid_event_capacity / invalid_event_min_level / event_group_required. The Organization Group (the row legacy_dept_id = ''org'' until Wave 3 gives it a setting of its own) is open to any live Member holding any Group Role anywhere -- that is how a Department''s leadership gets an organization-wide Event -- or to level >= 6; every other Group goes through private.require_group_work_manager, so a Group Manager or Group Responsible on the path, an ancestor''s included, qualifies and an ordinary member does not. Every refusal is the single non-disclosing 42501 calendar_manage_forbidden, so a missing, archived or forbidden Group are indistinguishable. Minimum Level is then judged against the loaded rows: PT400 event_min_level_below_group (an Event may not be more open than its Group) and PT400 event_min_level_above_actor (nobody raises an Event above their own live level), the latter with Moderator exempt -- an exemption that is inert while min_level is capped at 6 and Moderator is level 9, and is kept as the statement of the rule. The legacy (scope, dept_id, team_id, project_id) Origin is NEVER written here: the events_sync_group_origin trigger (#519) derives it from group_id, which is what makes an Independent Team Event -- scope team, no Department -- expressible at all.';

comment on function public.create_event(text,text,bigint,timestamptz,timestamptz,text,integer,text,integer) is
  'Security-invoker wrapper over private.create_event_impl (#370). Replaces the grandfathered direct-definer command that gated on a flat level >= 4; no Tracker or Calendar authority reads level 4 any more.';
