-- #364: centralize the live active-Member level lookup used by commands and
-- policies. The optional argument lets the service-only member_level(uuid)
-- endpoint reuse the same authoritative query; ordinary callers omit it.

create function private.actor_level(
  p_actor uuid default auth.uid()
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select role.level
    from public.profiles as profile
    join public.roles as role on role.id = profile.role
   where profile.id = p_actor
     and profile.status = 'activ';
$$;

comment on function private.actor_level(uuid) is
  'Live role level for an active Member, defaulting to auth.uid(); null for a missing or inactive profile. Internal authorization primitive (#364).';

create function private.require_active_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or private.actor_level(v_actor) is null then
    raise exception using errcode = '42501', message = 'not_active_member';
  end if;

  return v_actor;
end;
$$;

comment on function private.require_active_member() is
  'Returns auth.uid() for a caller with organization claims and a live active profile; otherwise raises 42501 not_active_member (#364).';

revoke execute on function private.actor_level(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.require_active_member()
  from public, anon, authenticated, service_role;

-- Keep caller_level() as the authenticated policy predicate introduced by
-- #372. Its public contract remains -1 for no active profile.
create or replace function private.caller_level()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.actor_level(), -1);
$$;

comment on function private.caller_level() is
  'Policy-facing live caller level: delegates to actor_level() and preserves the #372 -1 sentinel for no active membership.';

revoke execute on function private.caller_level()
  from public, anon, authenticated, service_role;
grant execute on function private.caller_level() to authenticated;

-- Preserve the service endpoint's 0 sentinel while sharing the live lookup.
create or replace function public.member_level(p_member uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.actor_level(p_member), 0);
$$;

revoke execute on function public.member_level(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.member_level(uuid) to service_role;

-- Project policy predicates and command gates now consume the shared lookup.
create or replace function private.can_manage_project_work(p_project_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null
     and exists (
       select 1
         from public.projects as project
        where project.id = p_project_id
          and project.status = 'active'
          and (
            private.actor_level() >= 6
            or project.leader_id = (select auth.uid())
            or exists (
              select 1
                from public.project_members as membership
               where membership.project_id = project.id
                 and membership.member_id = (select auth.uid())
                 and membership.project_role = 'responsible'
            )
          )
     );
$$;

create or replace function private.require_project_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'project_admin_forbidden';
  end;
  if private.actor_level(v_actor) < 6 then
    raise exception using errcode = '42501', message = 'project_admin_forbidden';
  end if;
  return v_actor;
end;
$$;

create or replace function private.require_active_project_lead(p_project_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_actor_level integer;
  v_leader uuid;
  v_status text;
begin
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'project_lead_forbidden';
  end;

  select project.leader_id, project.status
    into v_leader, v_status
    from public.projects as project
   where project.id = p_project_id
   for update;
  if not found then
    raise exception using errcode = '42501', message = 'project_lead_forbidden';
  end if;

  perform 1 from public.profiles as actor
   where actor.id = v_actor and actor.status = 'activ'
   for share;
  v_actor_level := private.actor_level(v_actor);
  if not found or (v_leader <> v_actor and v_actor_level < 6) then
    raise exception using errcode = '42501', message = 'project_lead_forbidden';
  end if;
  if v_status <> 'active' then
    raise sqlstate 'PT409' using message = 'project_archived';
  end if;
  return v_actor;
end;
$$;

drop policy projects_read on public.projects;
create policy projects_read on public.projects
for select to authenticated
using (
  public.auth_is_member()
  and (private.is_active_project_member(id) or (select private.caller_level()) >= 6)
);

drop policy project_members_read on public.project_members;
create policy project_members_read on public.project_members
for select to authenticated
using (
  public.auth_is_member()
  and (private.is_active_project_member(project_id) or (select private.caller_level()) >= 6)
);

-- Current Calendar command, kept behavior-identical until #370 replaces its
-- scope rules. Only its duplicated actor lookup changes here.
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
  v_actor uuid;
  v_actor_level integer;
  v_event_dept_id text;
  v_created public.events%rowtype;
begin
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end;
  v_actor_level := private.actor_level(v_actor);
  if v_actor_level < 4 then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_event_title';
  end if;
  if p_type is null or p_type not in ('sedinta', 'activitate', 'call', 'eveniment', 'deadline', 'recrutare') then
    raise sqlstate 'PT400' using message = 'invalid_event_type';
  end if;
  if p_starts_at is null or (p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise sqlstate 'PT400' using message = 'invalid_event_interval';
  end if;
  if p_capacity is not null and p_capacity <= 0 then
    raise sqlstate 'PT400' using message = 'invalid_event_capacity';
  end if;
  if p_scope is null or p_scope not in ('org', 'dept', 'team', 'project') or p_scope = 'project' then
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
    if not exists (select 1 from public.departments as department where department.id = p_dept_id) then
      raise sqlstate 'PT404' using message = 'department_not_found';
    end if;
    v_event_dept_id := p_dept_id;
  elsif p_scope = 'team' then
    if p_team_id is null or p_dept_id is not null then
      raise sqlstate 'PT400' using message = 'invalid_event_scope_fields';
    end if;
    select team.dept_id into v_event_dept_id
      from public.teams as team where team.id = p_team_id;
    if not found then raise sqlstate 'PT404' using message = 'team_not_found'; end if;
    if v_event_dept_id is null then raise sqlstate 'PT400' using message = 'team_department_required'; end if;
  end if;
  insert into public.events (
    title, type, scope, starts_at, ends_at, location, capacity, description,
    dept_id, team_id, created_by
  ) values (
    btrim(p_title), p_type::public.event_type, p_scope::public.event_scope,
    p_starts_at, p_ends_at, nullif(btrim(p_location), ''), p_capacity,
    nullif(btrim(p_description), ''), v_event_dept_id,
    case when p_scope = 'team' then p_team_id else null end, v_actor
  ) returning * into v_created;
  return v_created;
end;
$$;

revoke execute on function public.create_event(text, text, text, timestamptz, timestamptz, text, integer, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_event(text, text, text, timestamptz, timestamptz, text, integer, text, text, text)
  to authenticated;

-- Maintain explicit privilege posture after CREATE OR REPLACE.
revoke execute on function private.can_manage_project_work(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.can_manage_project_work(bigint) to authenticated;
revoke execute on function private.require_project_admin()
  from public, anon, authenticated, service_role;
revoke execute on function private.require_active_project_lead(bigint)
  from public, anon, authenticated, service_role;

-- Tracker predicates added after #364 was drafted also use the same live
-- level primitive. Actor profile reads remain where the role name or member
-- id is needed; only the profiles/roles level join is centralized.
create or replace function private.can_manage_origin(
  p_dept_id text, p_team_id text, p_project_id bigint
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select num_nonnulls(p_dept_id, p_team_id, p_project_id) = 1
    and coalesce(public.auth_is_member(), false)
    and exists (
      select 1 from public.profiles as actor
       where actor.id = (select auth.uid()) and actor.status = 'activ'
         and (
           private.actor_level(actor.id) >= 6
           or (p_dept_id is not null and actor.role = 'bce' and exists (
             select 1 from public.member_departments as membership
              where membership.member_id = actor.id and membership.dept_id = p_dept_id))
           or (p_team_id is not null and actor.role = 'bce' and exists (
             select 1 from public.teams as team
             join public.member_departments as membership on membership.dept_id = team.dept_id
              where team.id = p_team_id and team.dept_id is not null
                and membership.member_id = actor.id))
           or (p_team_id is not null and exists (
             select 1 from public.teams as team
             join public.team_members as membership on membership.team_id = team.id
              where team.id = p_team_id and team.dept_id is null
                and membership.member_id = actor.id))
           or (p_project_id is not null and private.can_manage_project_work(p_project_id))
         ));
$$;

create or replace function private.can_evaluate_task(p_task_id bigint)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select coalesce(public.auth_is_member(), false) and exists (
      select 1 from public.profiles as actor
       where actor.id = (select auth.uid()) and actor.status = 'activ'
         and (
           private.actor_level(actor.id) >= 6
           or (task.dept_id is not null and actor.role = 'bce' and exists (
             select 1 from public.member_departments as membership
              where membership.member_id = actor.id and membership.dept_id = task.dept_id))
           or (task.team_id is not null and actor.role = 'bce' and exists (
             select 1 from public.teams as team
             join public.member_departments as membership on membership.dept_id = team.dept_id
              where team.id = task.team_id and team.dept_id is not null
                and membership.member_id = actor.id))
           or (task.project_id is not null
             and exists (select 1 from public.projects as project
                          where project.id = task.project_id and project.status = 'active')
             and (private.is_project_lead(task.project_id)
               or (private.is_project_responsible(task.project_id) and not exists (
                 select 1 from public.task_assignments as assignment
                  where assignment.task_id = task.id and assignment.ended_at is null
                    and (assignment.member_id = actor.id or assignment.member_id = (
                      select project.leader_id from public.projects as project
                       where project.id = task.project_id))))))
         ))
      from public.tasks as task where task.id = p_task_id
  ), false);
$$;

create or replace function private.is_global_task_reader()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and coalesce(private.actor_level() >= 5, false);
$$;

create or replace function private.can_read_task(p_task_id bigint)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null
     and exists (
       select 1
         from public.tasks as target
         join public.tasks as task on task.id = target.id or task.id = target.parent_task_id
        where target.id = p_task_id
          and (
            private.actor_level() >= 5
            or exists (select 1 from public.task_assignments as assignment
                        where assignment.task_id = task.id and assignment.member_id = (select auth.uid()))
            or exists (select 1 from public.task_candidates as candidature
                        where candidature.task_id = task.id and candidature.member_id = (select auth.uid()))
            or exists (select 1 from public.team_members as membership
                        where membership.team_id = task.team_id and membership.member_id = (select auth.uid()))
            or exists (select 1 from public.projects as project
                        where project.id = task.project_id and project.leader_id = (select auth.uid()))
            or exists (select 1 from public.project_members as membership
                        where membership.project_id = task.project_id
                          and membership.member_id = (select auth.uid())
                          and membership.project_role = 'responsible')
            or (task.kind = 'task' and task.assignment_mode = 'public'
              and task.queue_closed_at is null
              and task.status not in ('completed', 'unfulfilled', 'cancelled')
              and (task.audience = 'org' or (task.audience = 'local' and (
                exists (select 1 from public.member_departments as membership
                         where membership.dept_id = task.dept_id
                           and membership.member_id = (select auth.uid()))
                or exists (select 1 from public.project_members as membership
                            where membership.project_id = task.project_id
                              and membership.member_id = (select auth.uid()))))))
          ));
$$;

create or replace function private.require_origin_manager(
  p_dept_id text, p_team_id text, p_project_id bigint
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_level integer;
  v_parent_dept text;
begin
  if v_actor is null
     or not coalesce(private.can_manage_origin(p_dept_id, p_team_id, p_project_id), false) then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end if;
  perform 1 from public.profiles as profile
   where profile.id = v_actor and profile.status = 'activ' for share;
  if not found then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end if;
  v_level := private.actor_level(v_actor);
  if v_level >= 6 then return v_actor; end if;
  if p_dept_id is not null then
    perform 1 from public.member_departments as membership
     where membership.member_id = v_actor and membership.dept_id = p_dept_id for share;
  elsif p_team_id is not null then
    select team.dept_id into v_parent_dept from public.teams as team where team.id = p_team_id;
    if v_parent_dept is not null then
      perform 1 from public.member_departments as membership
       where membership.member_id = v_actor and membership.dept_id = v_parent_dept for share;
    else
      perform 1 from public.team_members as membership
       where membership.member_id = v_actor and membership.team_id = p_team_id for share;
    end if;
  elsif p_project_id is not null then
    if private.is_project_lead(p_project_id) then
      perform 1 from public.projects as project where project.id = p_project_id for share;
    else
      perform 1 from public.project_members as membership
       where membership.project_id = p_project_id and membership.member_id = v_actor
         and membership.project_role = 'responsible' for share;
    end if;
  end if;
  if not found then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end if;
  return v_actor;
end;
$$;

revoke execute on function private.can_manage_origin(text, text, bigint),
  private.can_evaluate_task(bigint), private.is_global_task_reader(),
  private.can_read_task(bigint), private.require_origin_manager(text, text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.can_manage_origin(text, text, bigint),
  private.can_evaluate_task(bigint), private.is_global_task_reader(),
  private.can_read_task(bigint) to authenticated;

-- #344 landed after #364 was opened. Its decider gate is another live caller
-- level consumer; keep its narrower authority matrix and locking unchanged.
create or replace function private.require_request_decider(p_request_id bigint)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_request public.completed_work_requests%rowtype;
  v_level integer;
  v_parent_dept text;
begin
  select * into v_request from public.completed_work_requests where id = p_request_id;
  if not found then raise sqlstate 'PT404' using message = 'request_not_found'; end if;

  if v_actor is null or not exists (
    select 1 from public.profiles as decider
     where decider.status = 'activ' and decider.id = v_actor
       and (
         private.actor_level(decider.id) >= 6
         or (v_request.dept_id is not null and decider.role = 'bce' and exists (
           select 1 from public.member_departments as membership
            where membership.member_id = decider.id and membership.dept_id = v_request.dept_id))
         or (v_request.team_id is not null and decider.role = 'bce' and exists (
           select 1 from public.teams as team
           join public.member_departments as membership on membership.dept_id = team.dept_id
            where team.id = v_request.team_id and team.dept_id is not null
              and membership.member_id = decider.id))
         or (v_request.project_id is not null and exists (
           select 1 from public.projects as project
            where project.id = v_request.project_id and project.status = 'active'
              and project.leader_id = decider.id))
       )) then
    raise exception using errcode = '42501', message = 'request_decide_forbidden';
  end if;

  perform 1 from public.profiles as profile
   where profile.id = v_actor and profile.status = 'activ' for share;
  if not found then
    raise exception using errcode = '42501', message = 'request_decide_forbidden';
  end if;
  v_level := private.actor_level(v_actor);
  if v_level >= 6 then return v_actor; end if;

  if v_request.dept_id is not null then
    perform 1 from public.member_departments as membership
     where membership.member_id = v_actor and membership.dept_id = v_request.dept_id for share;
  elsif v_request.team_id is not null then
    select team.dept_id into v_parent_dept from public.teams as team where team.id = v_request.team_id;
    if v_parent_dept is null then
      raise exception using errcode = '42501', message = 'request_decide_forbidden';
    end if;
    perform 1 from public.member_departments as membership
     where membership.member_id = v_actor and membership.dept_id = v_parent_dept for share;
  else
    perform 1 from public.projects as project
     where project.id = v_request.project_id and project.leader_id = v_actor for share;
  end if;
  if not found then
    raise exception using errcode = '42501', message = 'request_decide_forbidden';
  end if;
  return v_actor;
end;
$$;

revoke execute on function private.require_request_decider(bigint)
  from public, anon, authenticated, service_role;
