-- #370: create Events through live Group Roles; retain only the Group-based RPC.
drop function public.create_event(text,text,text,timestamptz,timestamptz,text,integer,text,text,text);

create function private.create_event_impl(
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
revoke execute on function private.create_event_impl(text,text,bigint,timestamptz,timestamptz,text,integer,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function private.create_event_impl(text,text,bigint,timestamptz,timestamptz,text,integer,text,integer)
  to authenticated;

create function public.create_event(
  p_title text, p_type text, p_group_id bigint, p_starts_at timestamptz,
  p_ends_at timestamptz default null, p_location text default null,
  p_capacity integer default null, p_description text default null, p_min_level integer default 0
)
returns public.events language sql security invoker set search_path = ''
as $$
  select private.create_event_impl(p_title,p_type,p_group_id,p_starts_at,p_ends_at,p_location,p_capacity,p_description,p_min_level);
$$;
revoke execute on function public.create_event(text,text,bigint,timestamptz,timestamptz,text,integer,text,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.create_event(text,text,bigint,timestamptz,timestamptz,text,integer,text,integer)
  to authenticated;
revoke insert, update, delete on public.events from authenticated;
