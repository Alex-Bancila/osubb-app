-- #522: Group-native Task writes, Request deciders, and Campaign ownership.
-- Legacy argument names remain compatibility inputs until Wave 3.


drop function public.create_task(text, text, timestamptz, text, text, bigint, text, text, uuid, bigint, bigint, text);

drop function private.create_task_impl(text, text, timestamptz, text, text, bigint, text, text, uuid, bigint, bigint, text);

drop function public.create_completed_work_request(text, text, text, bigint);

drop function private.create_completed_work_request_impl(text, text, text, bigint);

drop function public.create_campaign(text, text);

drop function private.create_campaign_impl(text, text);

drop function private.require_campaign_manager(text);

create or replace function private.create_task_impl(
  p_title text, p_description text, p_deadline timestamptz,
  p_dept_id text, p_team_id text, p_project_id bigint,
  p_audience text, p_assignment_mode text,
  p_executor_id uuid, p_campaign_id bigint, p_parent_task_id bigint, p_kind text, p_group_id bigint)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_parent public.tasks%rowtype;
  v_group bigint;
  v_title text;
  v_task public.tasks%rowtype;
  v_constraint text;
begin
  if p_kind is null or p_kind not in ('task', 'umbrella') then
    raise sqlstate 'PT400' using message = 'invalid_task_kind';
  end if;
  if v_actor is null or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'task_command_forbidden';
  end if;
  if p_parent_task_id is not null then
    if p_kind = 'umbrella' then
      raise sqlstate 'PT400' using message = 'subtask_cannot_be_umbrella';
    end if;
    if not coalesce(private.can_read_task(p_parent_task_id), false) then
      raise sqlstate 'PT404' using message = 'task_not_found';
    end if;
    select * into v_parent from public.tasks where id = p_parent_task_id for no key update;
    if v_parent.kind <> 'umbrella' then
      raise sqlstate 'PT409' using message = 'parent_not_umbrella';
    end if;
    if v_parent.status in ('completed', 'unfulfilled', 'cancelled') then
      raise sqlstate 'PT409' using message = 'parent_terminal';
    end if;
    if (p_dept_id is not null and p_dept_id is distinct from v_parent.dept_id)
       or (p_team_id is not null and p_team_id is distinct from v_parent.team_id)
       or (p_project_id is not null and p_project_id is distinct from v_parent.project_id)
       or (p_group_id is not null and p_group_id is distinct from v_parent.group_id) then
      raise sqlstate 'PT400' using message = 'subtask_origin_mismatch';
    end if;
    v_group := v_parent.group_id;
  end if;
  if p_parent_task_id is null then
    if num_nonnulls(p_dept_id, p_team_id, p_project_id, p_group_id) <> 1 then
      raise sqlstate 'PT400' using message = 'invalid_origin';
    end if;
    v_group := coalesce(p_group_id, private.group_id_for_legacy_origin(p_dept_id, p_team_id, p_project_id));
  end if;
  begin
    perform private.require_group_work_manager(v_group);
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end;
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'title_required';
  end if;
  v_title := regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if p_kind = 'umbrella' then
    if p_audience is not null or p_assignment_mode is not null or p_executor_id is not null or p_campaign_id is not null then
      raise sqlstate 'PT400' using message = 'umbrella_has_no_mode';
    end if;
  else
    if p_deadline is null then
      raise sqlstate 'PT400' using message = 'deadline_required';
    end if;
    if p_audience is null or p_audience not in ('local', 'org') then
      raise sqlstate 'PT400' using message = 'invalid_audience';
    end if;
    if p_assignment_mode is null or p_assignment_mode not in ('direct', 'public') then
      raise sqlstate 'PT400' using message = 'invalid_assignment_mode';
    end if;
    if p_assignment_mode = 'public' and p_executor_id is not null then
      raise sqlstate 'PT400' using message = 'executor_not_allowed_for_public';
    end if;
  end if;
  begin
    insert into public.tasks (title, description, deadline, group_id,
                              audience, assignment_mode, campaign_id, parent_task_id, kind,
                              status, created_by, queue_opened_at)
    values (v_title, nullif(regexp_replace(coalesce(p_description, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
            p_deadline, v_group,
            p_audience, p_assignment_mode, p_campaign_id, p_parent_task_id, p_kind,
            'todo', v_actor, case when p_assignment_mode = 'public' then now() end)
    returning * into v_task;
  exception
    when foreign_key_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'tasks_campaign_id_fkey' then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
    when check_violation then
      if sqlerrm in ('task_campaign_origin_mismatch', 'task_campaign_inactive') then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
  end;
  perform private.log_task_activity(v_task.id, 'created', v_actor, null, null, 'todo', null,
    jsonb_build_object('kind', p_kind, 'audience', p_audience, 'assignment_mode', p_assignment_mode,
                       'campaign_id', p_campaign_id, 'parent_task_id', p_parent_task_id,
                       'executor_id', p_executor_id));
  if p_executor_id is not null then
    perform private.open_task_assignment(v_task.id, p_executor_id, v_actor, 'create');
  end if;
  select * into v_task from public.tasks where id = v_task.id;
  return v_task;
end;
$$;

create or replace function public.create_task(
  p_title text, p_description text, p_deadline timestamptz,
  p_dept_id text, p_team_id text, p_project_id bigint,
  p_audience text, p_assignment_mode text,
  p_executor_id uuid default null, p_campaign_id bigint default null,
  p_parent_task_id bigint default null, p_kind text default 'task', p_group_id bigint default null)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.create_task_impl(p_title, p_description, p_deadline, p_dept_id, p_team_id, p_project_id,
                                  p_audience, p_assignment_mode, p_executor_id, p_campaign_id, p_parent_task_id, p_kind, p_group_id);
$$;

create or replace function private.duplicate_task_impl(p_task_id bigint, p_deadline timestamptz)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor         uuid;
  v_source        public.tasks%rowtype;
  v_clone         public.tasks%rowtype;
  v_campaign_id   bigint;
  v_campaign_active boolean;
begin
  if p_deadline is null then
    raise sqlstate 'PT400' using message = 'deadline_required';
  end if;
  v_actor := private.require_task_visible(p_task_id);
  select * into v_source from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  perform private.require_task_manager(p_task_id);
  if v_source.kind <> 'task' then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  v_campaign_id := null;
  if v_source.campaign_id is not null then
    select campaign.is_active into v_campaign_active
      from public.campaigns as campaign
     where campaign.id = v_source.campaign_id
     for share;
    if coalesce(v_campaign_active, false) then
      v_campaign_id := v_source.campaign_id;
    end if;
  end if;

  insert into public.tasks (
    title, description, dept_id, team_id, project_id, group_id, campaign_id,
    audience, assignment_mode, kind, status, deadline, created_by,
    parent_task_id, queue_opened_at, duplicated_from_task_id)
  values (
    v_source.title, v_source.description,
    v_source.dept_id, v_source.team_id, v_source.project_id, v_source.group_id, v_campaign_id,
    v_source.audience, v_source.assignment_mode, 'task', 'todo', p_deadline,
    v_actor, null,
    case when v_source.assignment_mode = 'public' then now() end,
    p_task_id)
  returning * into v_clone;

  perform private.log_task_activity(v_clone.id, 'created', v_actor, null, null, 'todo'::public.task_status, null,
    jsonb_build_object('duplicated_from_task_id', p_task_id));
  perform private.log_task_activity(p_task_id, 'duplicated', v_actor, null, null, null, null,
    jsonb_build_object('clone_task_id', v_clone.id));

  select * into v_clone from public.tasks where id = v_clone.id;
  return v_clone;
end;
$$;

create or replace function private.approve_completed_work_request_impl(
  p_request_id bigint,
  p_difficulty integer,
  p_rating     integer,
  p_note       text)
returns public.completed_work_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := (select auth.uid());
  v_note     text;
  v_request  public.completed_work_requests%rowtype;
  v_task     public.tasks%rowtype;
  v_points   integer;
begin
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 5 then
    raise sqlstate 'PT400' using message = 'invalid_difficulty';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise sqlstate 'PT400' using message = 'invalid_rating';
  end if;
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'evaluation_note_required';
  end if;
  v_note := regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'request_command_forbidden';
  end if;
  select * into v_request from public.completed_work_requests
   where id = p_request_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;
  if v_request.requester_id is distinct from v_actor
     and not coalesce(private.can_manage_group_work(v_request.group_id), false) then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;
  perform private.require_request_decider(p_request_id);
  if v_request.status <> 'pending' then
    raise sqlstate 'PT409' using message = 'request_not_pending';
  end if;
  insert into public.tasks
    (title, description, deadline, dept_id, team_id, project_id, group_id,
     audience, assignment_mode, status, created_by)
  values (left(v_request.description, 120), v_request.description, now(),
          v_request.dept_id, v_request.team_id, v_request.project_id, v_request.group_id,
          'local', 'direct', 'todo', v_actor)
  returning * into v_task;

  perform private.log_task_activity(v_task.id, 'created', v_actor, null, null, 'todo', null,
    jsonb_build_object('from_request_id', p_request_id));
  perform private.open_task_assignment(v_task.id, v_request.requester_id, v_actor, 'request_approval');
  perform private.evaluate_task(v_task.id, 'completed', p_difficulty, p_rating, v_note, v_actor);

  update public.completed_work_requests
     set status        = 'approved',
         decided_by    = v_actor,
         decided_at    = now(),
         decision_note = v_note,
         task_id       = v_task.id
   where id = p_request_id;
  v_points := p_difficulty * public.rating_mult(p_rating);
  perform private.notify(array[v_request.requester_id], 'task'::public.noti_kind,
    'Cerere aprobată: ' || left(v_request.description, 60),
    case when abs(v_points) = 1 then v_points || ' punct' else v_points || ' puncte' end
      || ' (dificultate ' || p_difficulty || ', calificativ ' || p_rating || ').',
    v_task.id, null, v_actor);

  select * into v_request from public.completed_work_requests where id = p_request_id;
  return v_request;
end;
$$;

create or replace function private.reject_completed_work_request_impl(
  p_request_id bigint,
  p_note       text)
returns public.completed_work_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := (select auth.uid());
  v_note    text;
  v_request public.completed_work_requests%rowtype;
begin
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'note_required';
  end if;
  v_note := regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'request_command_forbidden';
  end if;
  select * into v_request from public.completed_work_requests
   where id = p_request_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;
  if v_request.requester_id is distinct from v_actor
     and not coalesce(private.can_manage_group_work(v_request.group_id), false) then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;
  perform private.require_request_decider(p_request_id);
  if v_request.status <> 'pending' then
    raise sqlstate 'PT409' using message = 'request_not_pending';
  end if;
  update public.completed_work_requests
     set status        = 'rejected',
         decided_by    = v_actor,
         decided_at    = now(),
         decision_note = v_note
   where id = p_request_id;

  perform private.notify(array[v_request.requester_id], 'task'::public.noti_kind,
    'Cerere respinsă: ' || left(v_request.description, 60),
    v_note,
    null, null, v_actor);

  select * into v_request from public.completed_work_requests where id = p_request_id;
  return v_request;
end;
$$;

create function private.request_deciders(p_request_id bigint)
returns setof uuid language sql stable security definer set search_path = '' as $$
  with request as (
    select r.requester_id, r.group_id, grp.path, grp.status
    from public.completed_work_requests r join public.groups grp on grp.id = r.group_id
    where r.id = p_request_id)
  select profile.id from request, public.profiles profile
  join public.roles role on role.id = profile.role
  where profile.status = 'activ' and profile.id <> request.requester_id
    and (role.level >= 6 or (request.status = 'active' and exists (
      select 1 from public.group_members gm
      where gm.member_id = profile.id and request.path @> array[gm.group_id]
        and (gm.group_role = 'manager' or (gm.group_role = 'responsible'
          and coalesce(private.group_role_of(request.group_id, request.requester_id), 'member')
              not in ('manager', 'responsible'))))));
$$;

create function private.can_decide_request(p_request_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.auth_is_member(), false) and private.actor_level() is not null
    and (select auth.uid()) in (select private.request_deciders(p_request_id));
$$;

create or replace function private.require_request_decider(p_request_id bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_group bigint;
begin
  select group_id into v_group from public.completed_work_requests where id = p_request_id;
  if not found then raise sqlstate 'PT404' using message = 'request_not_found'; end if;
  if not private.can_decide_request(p_request_id) then
    raise exception using errcode = '42501', message = 'request_decide_forbidden';
  end if;
  begin
    perform private.require_group_work_manager(v_group);
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'request_decide_forbidden';
  end;
  -- Authority may have changed while acquiring the profile/roster locks.
  if not private.can_decide_request(p_request_id) then
    raise exception using errcode = '42501', message = 'request_decide_forbidden';
  end if;
  return v_actor;
end;
$$;

create or replace function private.create_completed_work_request_impl(
  p_description text,
  p_dept_id     text,
  p_team_id     text,
  p_project_id  bigint, p_group_id bigint)
returns public.completed_work_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := (select auth.uid());
  v_description text;
  v_group bigint;
  v_actor_name  text;
  v_request     public.completed_work_requests%rowtype;
begin
  if p_description is null or p_description !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'description_required';
  end if;
  v_description := regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if num_nonnulls(p_dept_id, p_team_id, p_project_id, p_group_id) <> 1 then
    raise sqlstate 'PT400' using message = 'invalid_origin';
  end if;
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'request_command_forbidden';
  end if;
  select profile.full_name into v_actor_name
    from public.profiles as profile where profile.id = v_actor;
  v_group := coalesce(p_group_id, private.group_id_for_legacy_origin(p_dept_id, p_team_id, p_project_id));
  if private.group_role_of(v_group, v_actor) is null
     or (select status from public.groups where id = v_group) is distinct from 'active' then
    raise exception using errcode = '42501', message = 'request_origin_forbidden';
  end if;
  insert into public.completed_work_requests (requester_id, group_id, description, status)
  values (v_actor, v_group, v_description, 'pending') returning * into v_request;
  perform private.notify(array(select private.request_deciders(v_request.id)),
    'task'::public.noti_kind, 'Cerere nouă: ' || left(v_description, 60),
    coalesce(v_actor_name, 'Un membru') || ' a trimis o cerere de muncă realizată.',
    null, 'request:' || v_request.id::text, v_actor);
  return v_request;
end;
$$;

create or replace function public.create_completed_work_request(
  p_description text,
  p_dept_id     text,
  p_team_id     text,
  p_project_id  bigint, p_group_id bigint default null)
returns public.completed_work_requests
language sql
security invoker
set search_path = ''
as $$
  select private.create_completed_work_request_impl(p_description, p_dept_id, p_team_id, p_project_id, p_group_id);
$$;

drop policy completed_work_requests_read on public.completed_work_requests;
create policy completed_work_requests_read on public.completed_work_requests for select to authenticated
using (public.auth_is_member()
  and exists (select 1 from public.profiles caller where caller.id = (select auth.uid()) and caller.status = 'activ')
  and (requester_id = (select auth.uid()) or private.can_manage_group_work(group_id)));

create function private.require_campaign_manager(p_group_id bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  return private.require_group_work_manager(p_group_id);
exception when insufficient_privilege then
  raise exception using errcode = '42501', message = 'campaign_manage_forbidden';
end;
$$;

create or replace function private.create_campaign_impl(
  p_group_id bigint,
  p_name text
)
returns public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_name text;
  v_campaign public.campaigns%rowtype;
  v_constraint text;
begin
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (
       select 1
         from public.profiles as profile
        where profile.id = v_actor
          and profile.status = 'activ'
     ) then
    raise exception using
      errcode = '42501',
      message = 'campaign_manage_forbidden';
  end if;

  perform private.require_campaign_manager(p_group_id);

  if p_name is null or p_name !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_campaign_name';
  end if;
  v_name := regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');

  begin
    insert into public.campaigns (group_id, name, created_by)
    values (p_group_id, v_name, v_actor)
    returning * into v_campaign;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;

      if v_constraint <> 'campaigns_group_name_uidx' then
        raise;
      end if;

      raise sqlstate 'PT409' using message = 'campaign_name_taken';
  end;

  return v_campaign;
end;
$$;

create or replace function private.update_campaign_impl(
  p_campaign_id bigint,
  p_name text
)
returns public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_group_id bigint;
  v_name text;
  v_campaign public.campaigns%rowtype;
  v_constraint text;
begin
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (
       select 1
         from public.profiles as profile
        where profile.id = v_actor
          and profile.status = 'activ'
     ) then
    raise exception using
      errcode = '42501',
      message = 'campaign_manage_forbidden';
  end if;
  select campaign.group_id
    into v_group_id
    from public.campaigns as campaign
   where campaign.id = p_campaign_id
   for update;

  if not found then
    raise sqlstate 'PT404' using message = 'campaign_not_found';
  end if;

  perform private.require_campaign_manager(v_group_id);

  if p_name is null or p_name !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_campaign_name';
  end if;
  v_name := regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');

  begin
    update public.campaigns as campaign
       set name = v_name,
           updated_at = clock_timestamp()
     where campaign.id = p_campaign_id
    returning campaign.* into v_campaign;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;

      if v_constraint <> 'campaigns_group_name_uidx' then
        raise;
      end if;

      raise sqlstate 'PT409' using message = 'campaign_name_taken';
  end;

  return v_campaign;
end;
$$;

create or replace function private.set_campaign_active_impl(
  p_campaign_id bigint,
  p_active boolean
)
returns public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_group_id bigint;
  v_current_active boolean;
  v_campaign public.campaigns%rowtype;
begin
  if p_active is null then
    raise sqlstate 'PT400' using message = 'invalid_campaign_active';
  end if;
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (
       select 1
         from public.profiles as profile
        where profile.id = v_actor
          and profile.status = 'activ'
     ) then
    raise exception using
      errcode = '42501',
      message = 'campaign_manage_forbidden';
  end if;

  select campaign.group_id, campaign.is_active
    into v_group_id, v_current_active
    from public.campaigns as campaign
   where campaign.id = p_campaign_id
   for update;

  if not found then
    raise sqlstate 'PT404' using message = 'campaign_not_found';
  end if;

  perform private.require_campaign_manager(v_group_id);
  if v_current_active = p_active then
    select campaign.*
      into v_campaign
      from public.campaigns as campaign
     where campaign.id = p_campaign_id;

    return v_campaign;
  end if;

  update public.campaigns as campaign
     set is_active = p_active,
         updated_at = clock_timestamp()
   where campaign.id = p_campaign_id
  returning campaign.* into v_campaign;

  return v_campaign;
end;
$$;

create function public.create_campaign(p_group_id bigint, p_name text)
returns public.campaigns language sql security invoker set search_path = '' as $$
  select private.create_campaign_impl(p_group_id, p_name);
$$;
create function public.create_campaign(p_department_id text, p_name text)
returns public.campaigns language sql security invoker set search_path = '' as $$
  select private.create_campaign_impl(
    (select grp.id from public.groups grp where grp.legacy_dept_id = p_department_id), p_name);
$$;

create or replace function private.validate_task_campaign()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign_group bigint;
  v_campaign_active boolean;
  v_task_path bigint[];
begin
  if new.campaign_id is null then return new; end if;
  select campaign.group_id, campaign.is_active into v_campaign_group, v_campaign_active
    from public.campaigns campaign where campaign.id = new.campaign_id;
  select grp.path into v_task_path from public.groups grp where grp.id = new.group_id;
  if v_campaign_group is null or not coalesce(v_task_path @> array[v_campaign_group], false) then
    raise exception using errcode = '23514', message = 'task_campaign_origin_mismatch';
  end if;
  if (tg_op = 'INSERT' or new.campaign_id is distinct from old.campaign_id)
     and not v_campaign_active then
    raise exception using
      errcode = '23514',
      message = 'task_campaign_inactive';
  end if;

  return new;
end;
$$;

create or replace function private.validate_task_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_children   boolean;
  v_parent_kind    text;
  v_parent_parent  bigint;
  v_parent_dept    text;
  v_parent_team    text;
  v_parent_project bigint;
  v_parent_group bigint;
begin
  if tg_op = 'UPDATE' then
    select exists (
      select 1 from public.tasks as child
       where child.parent_task_id = old.id
    ) into v_has_children;
  else
    v_has_children := false;
  end if;
  if v_has_children and new.parent_task_id is not null then
    raise exception using
      errcode = '23514',
      message = 'task_hierarchy_too_deep';
  end if;
  if v_has_children and new.kind is distinct from 'umbrella' then
    raise exception using
      errcode = '23514',
      message = 'umbrella_has_subtasks';
  end if;
  if v_has_children and (
       new.dept_id is distinct from old.dept_id
    or new.team_id is distinct from old.team_id
    or new.project_id is distinct from old.project_id
    or new.group_id is distinct from old.group_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'subtask_origin_immutable';
  end if;
  if tg_op = 'UPDATE' and old.parent_task_id is not null and (
       new.parent_task_id is distinct from old.parent_task_id
    or new.dept_id is distinct from old.dept_id
    or new.team_id is distinct from old.team_id
    or new.project_id is distinct from old.project_id
    or new.group_id is distinct from old.group_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'subtask_origin_immutable';
  end if;

  if new.parent_task_id is not null then
    select parent.kind, parent.parent_task_id, parent.dept_id,
           parent.team_id, parent.project_id, parent.group_id
      into v_parent_kind, v_parent_parent, v_parent_dept,
           v_parent_team, v_parent_project, v_parent_group
      from public.tasks as parent
     where parent.id = new.parent_task_id
     for share;

    if v_parent_kind is distinct from 'umbrella' then
      raise exception using
        errcode = '23514',
        message = 'task_parent_not_umbrella';
    end if;
    if v_parent_parent is not null then
      raise exception using
        errcode = '23514',
        message = 'task_hierarchy_too_deep';
    end if;
    if (tg_op = 'INSERT' or old.parent_task_id is null) and (
         new.dept_id is distinct from v_parent_dept
      or new.team_id is distinct from v_parent_team
      or new.project_id is distinct from v_parent_project
      or new.group_id is distinct from v_parent_group
    ) then
      raise exception using
        errcode = '23514',
        message = 'subtask_origin_mismatch';
    end if;
  end if;

  return new;
end;
$$;

drop trigger tasks_validate_campaign on public.tasks;
create trigger tasks_validate_campaign before insert or update of campaign_id, group_id, dept_id, team_id, project_id
on public.tasks for each row execute function private.validate_task_campaign();
drop trigger tasks_validate_hierarchy on public.tasks;
create trigger tasks_validate_hierarchy before insert or update of parent_task_id, group_id, dept_id, team_id, project_id, kind
on public.tasks for each row execute function private.validate_task_hierarchy();
revoke insert, update, delete on public.campaigns, public.completed_work_requests from authenticated;

revoke execute on function private.create_task_impl(text, text, timestamptz, text, text, bigint, text, text, uuid, bigint, bigint, text, bigint) from public, anon, authenticated, service_role;

grant execute on function private.create_task_impl(text, text, timestamptz, text, text, bigint, text, text, uuid, bigint, bigint, text, bigint) to authenticated;

revoke execute on function public.create_task(text, text, timestamptz, text, text, bigint, text, text, uuid, bigint, bigint, text, bigint) from public, anon, authenticated, service_role;

grant execute on function public.create_task(text, text, timestamptz, text, text, bigint, text, text, uuid, bigint, bigint, text, bigint) to authenticated;

revoke execute on function private.duplicate_task_impl(bigint, timestamptz) from public, anon, authenticated, service_role;

grant execute on function private.duplicate_task_impl(bigint, timestamptz) to authenticated;

revoke execute on function private.approve_completed_work_request_impl(bigint, integer, integer, text) from public, anon, authenticated, service_role;

grant execute on function private.approve_completed_work_request_impl(bigint, integer, integer, text) to authenticated;

revoke execute on function private.reject_completed_work_request_impl(bigint, text) from public, anon, authenticated, service_role;

grant execute on function private.reject_completed_work_request_impl(bigint, text) to authenticated;

revoke execute on function private.request_deciders(bigint) from public, anon, authenticated, service_role;

revoke execute on function private.can_decide_request(bigint) from public, anon, authenticated, service_role;

grant execute on function private.can_decide_request(bigint) to authenticated;

revoke execute on function private.require_request_decider(bigint) from public, anon, authenticated, service_role;

revoke execute on function private.create_completed_work_request_impl(text, text, text, bigint, bigint) from public, anon, authenticated, service_role;

grant execute on function private.create_completed_work_request_impl(text, text, text, bigint, bigint) to authenticated;

revoke execute on function public.create_completed_work_request(text, text, text, bigint, bigint) from public, anon, authenticated, service_role;

grant execute on function public.create_completed_work_request(text, text, text, bigint, bigint) to authenticated;

revoke execute on function private.require_campaign_manager(bigint) from public, anon, authenticated, service_role;

revoke execute on function private.create_campaign_impl(bigint, text) from public, anon, authenticated, service_role;

grant execute on function private.create_campaign_impl(bigint, text) to authenticated;

revoke execute on function private.update_campaign_impl(bigint, text) from public, anon, authenticated, service_role;

grant execute on function private.update_campaign_impl(bigint, text) to authenticated;

revoke execute on function private.set_campaign_active_impl(bigint, boolean) from public, anon, authenticated, service_role;

grant execute on function private.set_campaign_active_impl(bigint, boolean) to authenticated;

revoke execute on function public.create_campaign(bigint, text) from public, anon, authenticated, service_role;

grant execute on function public.create_campaign(bigint, text) to authenticated;

revoke execute on function public.create_campaign(text, text) from public, anon, authenticated, service_role;

grant execute on function public.create_campaign(text, text) to authenticated;

revoke execute on function private.validate_task_campaign() from public, anon, authenticated, service_role;

revoke execute on function private.validate_task_hierarchy() from public, anon, authenticated, service_role;

comment on function private.request_deciders(bigint) is
  'The single live decider and notification set: BC/Moderator and active ancestor Group Managers; Group Responsibles only for ordinary requesters. Always excludes the requester, including BC/Moderator.';
comment on function private.can_decide_request(bigint) is
  'Claims and live membership gated inclusion in request_deciders; callable predicate, not a write path.';
comment on function private.require_request_decider(bigint) is
  'Caller holds Request FOR UPDATE. Revalidates decider membership before and after Group authority locks; requester never decides their own Request.';
comment on function public.create_completed_work_request(text,text,text,bigint,bigint) is
  'Files work in exactly one active Group where the actor has membership, accepting Group or legacy Origin. Notifies precisely request_deciders without an actor echo.';
comment on function public.approve_completed_work_request(bigint,integer,integer,text) is
  'Locks and decides a pending Request through the Group decider set; atomically creates Task, Assignment, Evaluation, points and notification. Requester cannot self-approve.';
comment on function public.create_task(text,text,timestamptz,text,text,bigint,text,text,uuid,bigint,bigint,text,bigint) is
  'Creates Group-owned work through live Group Manager/Responsible authority. Legacy Origin arguments remain compatibility inputs. Subtasks lock the Umbrella FOR NO KEY UPDATE and inherit its Group.';
comment on function private.require_campaign_manager(bigint) is
  'Requires live Group work authority, locking Profile and supporting roster rows. Missing and forbidden Groups share campaign_manage_forbidden.';
comment on function public.create_campaign(bigint,text) is
  'Creates a Campaign owned by any managed Group; its Tasks and all descendant Groups may use the label.';
comment on function public.create_campaign(text,text) is
  'Wave 2 compatibility wrapper resolving a Department to its Group. Unknown or unauthorized Group answers campaign_manage_forbidden; retired in Wave 3.';
comment on function public.update_campaign(bigint,text) is
  'Renames a Campaign under its owning Group authority; ownership stays immutable.';
comment on function public.set_campaign_active(bigint,boolean) is
  'Changes Campaign activity under its owning Group authority; same-value calls revalidate authority.';
