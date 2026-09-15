-- #370: authorize Event creation by its owning scope (ADR-0008), support
-- Independent-Team and Project Events, and accept a creator-capped Minimum
-- Level. The browser-facing wrapper is an invoker over one definer impl.

alter table public.events drop constraint events_scope_fields_ck;
alter table public.events add constraint events_scope_fields_ck check (
     (scope = 'org'     and dept_id is null     and team_id is null     and project_id is null)
  or (scope = 'dept'    and dept_id is not null and team_id is null     and project_id is null)
  or (scope = 'team'    and team_id is not null and project_id is null)
  or (scope = 'project' and dept_id is null     and team_id is null     and project_id is not null)
);

drop function public.create_event(
  text, text, text, timestamptz, timestamptz, text, integer, text, text, text
);

create function private.create_event_impl(
  p_title text,
  p_type text,
  p_scope text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_location text,
  p_capacity integer,
  p_description text,
  p_dept_id text,
  p_team_id text,
  p_project_id bigint,
  p_min_level integer
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_actor_level integer;
  v_actor_role public.member_role;
  v_event_dept_id text;
  v_created public.events%rowtype;
begin
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_event_title';
  end if;
  if p_type is null or p_type not in (
    'sedinta', 'activitate', 'call', 'eveniment', 'deadline', 'recrutare'
  ) then
    raise sqlstate 'PT400' using message = 'invalid_event_type';
  end if;
  if p_starts_at is null or (p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise sqlstate 'PT400' using message = 'invalid_event_interval';
  end if;
  if p_capacity is not null and p_capacity <= 0 then
    raise sqlstate 'PT400' using message = 'invalid_event_capacity';
  end if;
  if p_scope is null or p_scope not in ('org', 'dept', 'team', 'project') then
    raise sqlstate 'PT400' using message = 'unsupported_event_scope';
  end if;
  if p_min_level is null or p_min_level not in (0, 3, 4, 5, 6) then
    raise sqlstate 'PT400' using message = 'invalid_event_min_level';
  end if;

  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end;
  v_actor_level := private.actor_level(v_actor);
  select profile.role into v_actor_role
    from public.profiles as profile
   where profile.id = v_actor and profile.status = 'activ';

  if v_actor_role <> 'moderator' and p_min_level > v_actor_level then
    raise sqlstate 'PT400' using message = 'event_min_level_exceeds_actor';
  end if;

  if p_scope = 'org' then
    if p_dept_id is not null or p_team_id is not null or p_project_id is not null then
      raise sqlstate 'PT400' using message = 'invalid_event_scope_fields';
    end if;
    if v_actor_level < 4 then
      raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
    end if;
    v_event_dept_id := null;

  elsif p_scope = 'dept' then
    if p_dept_id is null or p_team_id is not null or p_project_id is not null then
      raise sqlstate 'PT400' using message = 'invalid_event_scope_fields';
    end if;
    if not exists (select 1 from public.departments as department where department.id = p_dept_id) then
      raise sqlstate 'PT404' using message = 'department_not_found';
    end if;
    if v_actor_level < 6 and not (
      v_actor_role = 'bce' and exists (
        select 1 from public.member_departments as membership
         where membership.member_id = v_actor and membership.dept_id = p_dept_id
      )
    ) then
      raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
    end if;
    v_event_dept_id := p_dept_id;

  elsif p_scope = 'team' then
    if p_team_id is null or p_dept_id is not null or p_project_id is not null then
      raise sqlstate 'PT400' using message = 'invalid_event_scope_fields';
    end if;
    select team.dept_id into v_event_dept_id
      from public.teams as team where team.id = p_team_id;
    if not found then
      raise sqlstate 'PT404' using message = 'team_not_found';
    end if;
    if v_actor_level < 6 and not (
      (v_event_dept_id is not null and v_actor_role = 'bce' and exists (
        select 1 from public.member_departments as membership
         where membership.member_id = v_actor and membership.dept_id = v_event_dept_id
      ))
      or (v_event_dept_id is null and exists (
        select 1 from public.team_members as membership
         where membership.member_id = v_actor and membership.team_id = p_team_id
      ))
    ) then
      raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
    end if;

  else
    if p_project_id is null or p_dept_id is not null or p_team_id is not null then
      raise sqlstate 'PT400' using message = 'invalid_event_scope_fields';
    end if;
    if not exists (select 1 from public.projects as project
                    where project.id = p_project_id and project.status = 'active') then
      raise sqlstate 'PT404' using message = 'project_not_found';
    end if;
    if not coalesce(private.can_manage_project_work(p_project_id), false) then
      raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
    end if;
    v_event_dept_id := null;
  end if;

  insert into public.events (
    title, type, scope, starts_at, ends_at, location, capacity, description,
    dept_id, team_id, project_id, min_level, created_by
  ) values (
    btrim(p_title), p_type::public.event_type, p_scope::public.event_scope,
    p_starts_at, p_ends_at, nullif(btrim(p_location), ''), p_capacity,
    nullif(btrim(p_description), ''), v_event_dept_id,
    case when p_scope = 'team' then p_team_id else null end,
    case when p_scope = 'project' then p_project_id else null end,
    p_min_level, v_actor
  ) returning * into v_created;
  return v_created;
end;
$$;

create function public.create_event(
  p_title text,
  p_type text,
  p_scope text,
  p_starts_at timestamptz,
  p_ends_at timestamptz default null,
  p_location text default null,
  p_capacity integer default null,
  p_description text default null,
  p_dept_id text default null,
  p_team_id text default null,
  p_project_id bigint default null,
  p_min_level integer default 0
)
returns public.events
language sql
security invoker
set search_path = ''
as $$
  select private.create_event_impl(
    p_title, p_type, p_scope, p_starts_at, p_ends_at, p_location, p_capacity,
    p_description, p_dept_id, p_team_id, p_project_id, p_min_level
  );
$$;

comment on function public.create_event(text, text, text, timestamptz, timestamptz, text, integer, text, text, text, bigint, integer) is
  'Creates an Event owned by an authorized organization, Department, Team, or Project scope; derives actor and Team parent Department server-side and caps Minimum Level at the creator live level (#370, ADR-0008).';

revoke execute on function private.create_event_impl(text, text, text, timestamptz, timestamptz, text, integer, text, text, text, bigint, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.create_event(text, text, text, timestamptz, timestamptz, text, integer, text, text, text, bigint, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.create_event_impl(text, text, text, timestamptz, timestamptz, text, integer, text, text, text, bigint, integer)
  to authenticated;
grant execute on function public.create_event(text, text, text, timestamptz, timestamptz, text, integer, text, text, text, bigint, integer)
  to authenticated;
