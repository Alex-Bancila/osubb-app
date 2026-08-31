-- #245: the only client-facing path for creating calendar events.
--
-- Direct writes are removed from authenticated clients. SECURITY DEFINER is
-- therefore required for this narrow RPC, which performs both JWT membership
-- and live database authorization before inserting. The empty search_path and
-- explicit grants keep the elevated surface as small as possible.
create or replace function public.create_event(
  p_title text,
  p_type text,
  p_scope text,
  p_starts_at timestamptz,
  p_ends_at timestamptz default null,
  p_location text default null,
  p_capacity integer default null,
  p_description text default null,
  p_dept_id text default null,
  p_team_id text default null
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_level integer;
  v_event_dept_id text;
  v_created public.events%rowtype;
begin
  -- Organization claims are the normal gate, while this live profile lookup
  -- closes the short stale-token window after deactivation or demotion.
  if v_actor is null or not coalesce(public.auth_is_member(), false) then
    raise exception using
      errcode = '42501',
      message = 'calendar_manage_forbidden';
  end if;

  select r.level
    into v_actor_level
    from public.profiles p
    join public.roles r on r.id = p.role
   where p.id = v_actor
     and p.status = 'activ';

  if coalesce(v_actor_level, -1) < 4 then
    raise exception using
      errcode = '42501',
      message = 'calendar_manage_forbidden';
  end if;

  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_event_title';
  end if;

  if p_type is null or p_type not in (
    'sedinta', 'activitate', 'call', 'eveniment', 'deadline', 'recrutare'
  ) then
    raise sqlstate 'PT400' using message = 'invalid_event_type';
  end if;

  if p_starts_at is null
     or (p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise sqlstate 'PT400' using message = 'invalid_event_interval';
  end if;

  if p_capacity is not null and p_capacity <= 0 then
    raise sqlstate 'PT400' using message = 'invalid_event_capacity';
  end if;

  if p_scope is null
     or p_scope not in ('org', 'dept', 'team', 'project')
     or p_scope = 'project' then
    raise sqlstate 'PT400' using message = 'unsupported_event_scope';
  elsif p_scope = 'org' then
    if p_dept_id is not null or p_team_id is not null then
      raise sqlstate 'PT400' using message = 'invalid_event_scope_fields';
    end if;
    v_event_dept_id := null;
  elsif p_scope = 'dept' then
    if p_dept_id is null or p_team_id is not null then
      raise sqlstate 'PT400' using message = 'invalid_event_scope_fields';
    end if;

    if not exists (
      select 1 from public.departments d where d.id = p_dept_id
    ) then
      raise sqlstate 'PT404' using message = 'department_not_found';
    end if;
    v_event_dept_id := p_dept_id;
  elsif p_scope = 'team' then
    -- The client selects a team only. Its department is authoritative here,
    -- so a caller can neither forge nor accidentally mismatch the pair.
    if p_team_id is null or p_dept_id is not null then
      raise sqlstate 'PT400' using message = 'invalid_event_scope_fields';
    end if;

    select t.dept_id
      into v_event_dept_id
      from public.teams t
     where t.id = p_team_id;

    if not found then
      raise sqlstate 'PT404' using message = 'team_not_found';
    end if;

    if v_event_dept_id is null then
      raise sqlstate 'PT400' using message = 'team_department_required';
    end if;
  end if;

  insert into public.events (
    title,
    type,
    scope,
    starts_at,
    ends_at,
    location,
    capacity,
    description,
    dept_id,
    team_id,
    created_by
  ) values (
    btrim(p_title),
    p_type::public.event_type,
    p_scope::public.event_scope,
    p_starts_at,
    p_ends_at,
    nullif(btrim(p_location), ''),
    p_capacity,
    nullif(btrim(p_description), ''),
    v_event_dept_id,
    case when p_scope = 'team' then p_team_id else null end,
    v_actor
  )
  returning * into v_created;

  return v_created;
end;
$$;

-- `event_write FOR ALL` previously bundled create/edit/delete together. The
-- following commands replace that broad path one at a time, so no direct
-- authenticated mutation remains between issues.
drop policy if exists event_write on public.events;
revoke insert, update, delete on table public.events from authenticated;

revoke execute on function public.create_event(
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  text,
  integer,
  text,
  text,
  text
) from public, anon;
grant execute on function public.create_event(
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  text,
  integer,
  text,
  text,
  text
) to authenticated;

comment on function public.create_event(
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  text,
  integer,
  text,
  text,
  text
) is
  'Creates one validated org, department, or team event as auth.uid(); requires a live level-4+ member.';
