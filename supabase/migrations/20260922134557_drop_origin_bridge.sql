-- #579 (Groups Wave 3, T6): the legacy Origin bridge and event_scope go.
--
-- Since Wave 2 (#519) the four work tables carried two identities side by side: the
-- owning Group (group_id, the authority every command reads) and the legacy Origin
-- (tasks/completed_work_requests dept_id/team_id/project_id, events scope + dept_id/
-- team_id/project_id, campaigns.department_id), kept in agreement by four two-way
-- *_sync_group_origin triggers. That bridge is what made task_group_origin_unmapped
-- unavoidable: a Group with no legacy_* mapping could carry no Task. This migration
-- removes the legacy identity entirely, so the Group is the only Origin a row has.
--
-- Forward-only and guarded. Nothing here can put a column back, so before anything is
-- dropped the migration proves no row would lose information, and refuses loudly
-- (23514, snake_case reason, the offending count) otherwise:
--   * work_row_group_id_null            -- any of the four tables holding a null group_id
--                                          (a tripwire: group_id is NOT NULL since #519);
--   * work_row_on_native_group          -- a row whose Group has no legacy_* mapping. The
--                                          bridge refused those; one existing means the
--                                          bridge was bypassed, and its legacy side cannot
--                                          be reconciled. Stronger than "no native Group
--                                          exists" and independent of guard order;
--   * tasks_group_origin_disagreement,
--     completed_work_requests_group_origin_disagreement,
--     campaigns_group_origin_disagreement,
--     events_group_origin_disagreement  -- a row whose group_id is not the Group its legacy
--                                          Origin names. Dropping the legacy side would
--                                          silently pick the group_id answer.
-- The null tripwire runs first and the native-Group check before the disagreement
-- checks, so each planted fault answers under exactly one reason
-- (supabase/tests/origin_drop_upgrade.test.sh proves every failure path).
--
-- Then, in order (the plan's T6 outline, re-derived from the catalog of main):
--   1. drop tasks_with_overdue (it expands task.* and so depends on the legacy columns);
--   2. drop the four *_sync_group_origin triggers and their functions;
--   3. validate_task_hierarchy / validate_task_campaign lose their legacy clauses; their
--      trigger column lists become (parent_task_id, group_id, kind) / (campaign_id,
--      group_id), so a Group-only UPDATE still fires both;
--   4. create_task / create_completed_work_request: the old arities are DROPPED before
--      the new ones are created, so PostgREST never sees two candidates (PGRST 300).
--      create_task takes p_group_id only (PT400 task_group_required when neither it nor
--      p_parent_task_id is given); create_completed_work_request(p_description,
--      p_group_id). Every other function that wrote or read the legacy columns is
--      re-issued from its latest definition without them: duplicate_task_impl,
--      approve_completed_work_request_impl, and express_task_interest_impl, whose local
--      Audience rule now reads private.is_group_member(task.group_id, actor) -- the rule
--      update_task (#626, R-E8) and can_read_task already apply to a local Opportunity;
--   5. drop the legacy create_campaign(text, text) overload;
--   6. drop the shims can_manage_origin / require_origin_manager and the resolver
--      group_id_for_legacy_origin (the guards above are its last caller);
--   7. constraints, foreign keys and indexes on the legacy columns, before the columns;
--   8. the columns themselves, then the event_scope type (R18). events.group_id NOT NULL
--      and events_group_id_fkey are now the whole Event Origin invariant -- the same
--      invariant tasks, completed_work_requests and campaigns carry on their group_id;
--   9. tasks_with_overdue again (security_invoker, same grants); department_cup_rows /
--      department_cup / dept_cup without the compatibility dept_id column; and
--      leadership_member_tasks without origin_type/origin_id/origin_name and the three
--      legacy joins.
--
-- Untouched on purpose (implementation boundary): the forward mirror (mirror_* /
-- sync_*) keeps writing groups / group_members from the legacy structure tables until
-- #586, and groups.legacy_* stays for it (and for the Organization Group's
-- legacy_dept_id = 'org' readers in the Event commands, which #582 moves to
-- is_organization). No Group command exists yet; p_group_id is usable end-to-end once
-- #582 can create a native Group.

-- ==================== 0. Guards ====================
do $$
declare
  v_count bigint;
begin
  -- Tripwire: group_id is NOT NULL on all four tables, so this can only fire on a
  -- database whose constraint was tampered with.
  select (select count(*) from public.tasks where group_id is null)
       + (select count(*) from public.completed_work_requests where group_id is null)
       + (select count(*) from public.campaigns where group_id is null)
       + (select count(*) from public.events where group_id is null)
    into v_count;
  if v_count > 0 then
    raise exception using errcode = '23514', message = 'work_row_group_id_null',
      detail = v_count || ' work row(s) carry no group_id.';
  end if;

  select (select count(*) from public.tasks as work
            join public.groups as grp on grp.id = work.group_id
           where num_nonnulls(grp.legacy_dept_id, grp.legacy_team_id, grp.legacy_project_id) = 0)
       + (select count(*) from public.completed_work_requests as work
            join public.groups as grp on grp.id = work.group_id
           where num_nonnulls(grp.legacy_dept_id, grp.legacy_team_id, grp.legacy_project_id) = 0)
       + (select count(*) from public.campaigns as work
            join public.groups as grp on grp.id = work.group_id
           where num_nonnulls(grp.legacy_dept_id, grp.legacy_team_id, grp.legacy_project_id) = 0)
       + (select count(*) from public.events as work
            join public.groups as grp on grp.id = work.group_id
           where num_nonnulls(grp.legacy_dept_id, grp.legacy_team_id, grp.legacy_project_id) = 0)
    into v_count;
  if v_count > 0 then
    raise exception using errcode = '23514', message = 'work_row_on_native_group',
      detail = v_count || ' work row(s) belong to a Group with no legacy mapping.';
  end if;

  select count(*) into v_count
    from public.tasks as task
   where task.group_id is distinct from
         private.group_id_for_legacy_origin(task.dept_id, task.team_id, task.project_id);
  if v_count > 0 then
    raise exception using errcode = '23514', message = 'tasks_group_origin_disagreement',
      detail = v_count || ' Task(s) whose group_id is not the Group their legacy Origin names.';
  end if;

  select count(*) into v_count
    from public.completed_work_requests as request
   where request.group_id is distinct from
         private.group_id_for_legacy_origin(request.dept_id, request.team_id, request.project_id);
  if v_count > 0 then
    raise exception using errcode = '23514', message = 'completed_work_requests_group_origin_disagreement',
      detail = v_count || ' Request(s) whose group_id is not the Group their legacy Origin names.';
  end if;

  -- A Campaign's legacy side is the single nullable department_id: null for a Team or
  -- Project Group. It agrees when it equals its Group's own legacy_dept_id (the bridge's
  -- both-sides-written rule), which a resolver lookup could not express for a null.
  select count(*) into v_count
    from public.campaigns as campaign
    join public.groups as grp on grp.id = campaign.group_id
   where campaign.department_id is distinct from grp.legacy_dept_id;
  if v_count > 0 then
    raise exception using errcode = '23514', message = 'campaigns_group_origin_disagreement',
      detail = v_count || ' Campaign(s) whose department_id is not their Group''s.';
  end if;

  -- An Event's legacy side resolves as private.sync_event_group_origin resolved it:
  -- scope 'org' is the Organization Group; otherwise the most specific Origin column,
  -- dept_id counting only for a 'dept' Event (a Team Event also carries its parent
  -- Department). events_scope_fields_ck and events_team_department_fkey vouch for the
  -- rest of the row's shape.
  select count(*) into v_count
    from public.events as event
   where event.group_id is distinct from
         case when event.scope = 'org'
              then (select grp.id from public.groups as grp where grp.legacy_dept_id = 'org')
              else private.group_id_for_legacy_origin(
                     case when event.scope = 'dept' then event.dept_id end,
                     event.team_id, event.project_id)
         end;
  if v_count > 0 then
    raise exception using errcode = '23514', message = 'events_group_origin_disagreement',
      detail = v_count || ' Event(s) whose group_id is not the Group their scope and Origin name.';
  end if;
end;
$$;

-- ==================== 1. tasks_with_overdue depends on task.* ====================
drop view public.tasks_with_overdue;

-- ==================== 2. The four bridge triggers ====================
drop trigger tasks_sync_group_origin on public.tasks;
drop trigger completed_work_requests_sync_group_origin on public.completed_work_requests;
drop trigger campaigns_sync_group_origin on public.campaigns;
drop trigger events_sync_group_origin on public.events;
drop function private.sync_task_group_origin();
drop function private.sync_request_group_origin();
drop function private.sync_campaign_group_origin();
drop function private.sync_event_group_origin();

-- ==================== 3. The two validators, Group-only ====================
create or replace function private.validate_task_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_children  boolean;
  v_parent_kind   text;
  v_parent_parent bigint;
  v_parent_group  bigint;
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
  if v_has_children and new.group_id is distinct from old.group_id then
    raise exception using
      errcode = '23514',
      message = 'subtask_origin_immutable';
  end if;
  if tg_op = 'UPDATE' and old.parent_task_id is not null and (
       new.parent_task_id is distinct from old.parent_task_id
    or new.group_id is distinct from old.group_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'subtask_origin_immutable';
  end if;

  if new.parent_task_id is not null then
    select parent.kind, parent.parent_task_id, parent.group_id
      into v_parent_kind, v_parent_parent, v_parent_group
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
    if (tg_op = 'INSERT' or old.parent_task_id is null)
       and new.group_id is distinct from v_parent_group then
      raise exception using
        errcode = '23514',
        message = 'subtask_origin_mismatch';
    end if;
  end if;

  return new;
end;
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

drop trigger tasks_validate_hierarchy on public.tasks;
create trigger tasks_validate_hierarchy
  before insert or update of parent_task_id, group_id, kind on public.tasks
  for each row execute function private.validate_task_hierarchy();
drop trigger tasks_validate_campaign on public.tasks;
create trigger tasks_validate_campaign
  before insert or update of campaign_id, group_id on public.tasks
  for each row execute function private.validate_task_campaign();

comment on function private.validate_task_hierarchy() is
  'Trigger on tasks (insert, or update of parent_task_id, group_id, kind): one level of Umbrella nesting, an Umbrella with Subtasks stays an Umbrella, a Subtask carries its Umbrella''s Group, and neither side of an existing hierarchy may change its Group or re-parent. The parent row is read FOR SHARE. The Group is the only Origin (#579).';
comment on function private.validate_task_campaign() is
  'Trigger on tasks (insert, or update of campaign_id, group_id): a Campaign may tag a Task only when the Campaign''s Group is on the Task Group''s path (task_campaign_origin_mismatch), and a newly attached Campaign must be active (task_campaign_inactive).';

-- ==================== 4. Commands: new arities, legacy writers re-issued ====================
drop function public.create_task(text, text, timestamptz, text, text, bigint, text, text, uuid, bigint, bigint, text, bigint);
drop function private.create_task_impl(text, text, timestamptz, text, text, bigint, text, text, uuid, bigint, bigint, text, bigint);
drop function public.create_completed_work_request(text, text, text, bigint, bigint);
drop function private.create_completed_work_request_impl(text, text, text, bigint, bigint);

create function private.create_task_impl(
  p_title text,
  p_description text,
  p_deadline timestamptz,
  p_audience text,
  p_assignment_mode text,
  p_executor_id uuid,
  p_campaign_id bigint,
  p_parent_task_id bigint,
  p_kind text,
  p_group_id bigint
)
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
    if p_group_id is not null and p_group_id is distinct from v_parent.group_id then
      raise sqlstate 'PT400' using message = 'subtask_origin_mismatch';
    end if;
    v_group := v_parent.group_id;
  else
    if p_group_id is null then
      raise sqlstate 'PT400' using message = 'task_group_required';
    end if;
    v_group := p_group_id;
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
    -- Hold the target's live profile against deactivation or demotion. The
    -- picker is a convenience: the public command must enforce eligibility.
    perform 1 from public.profiles as candidate
      where candidate.id = p_executor_id and candidate.status = 'activ'
      for share of candidate;
    if not found then
      raise sqlstate 'PT400' using message = 'invalid_executor';
    end if;
    -- Re-read after any lock wait; Group settings are not authority locks.
    if coalesce(private.actor_level(p_executor_id), -1) <
       (select origin.min_level from public.groups as origin where origin.id = v_group) then
      raise sqlstate 'PT400' using message = 'invalid_executor';
    end if;
    perform private.open_task_assignment(v_task.id, p_executor_id, v_actor, 'create');
  end if;
  select * into v_task from public.tasks where id = v_task.id;
  return v_task;
end;
$$;

create function public.create_task(
  p_title text,
  p_description text,
  p_deadline timestamptz,
  p_audience text,
  p_assignment_mode text,
  p_executor_id uuid default null,
  p_campaign_id bigint default null,
  p_parent_task_id bigint default null,
  p_kind text default 'task',
  p_group_id bigint default null
)
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.create_task_impl(p_title, p_description, p_deadline, p_audience, p_assignment_mode,
                                  p_executor_id, p_campaign_id, p_parent_task_id, p_kind, p_group_id);
$$;

create function private.create_completed_work_request_impl(p_description text, p_group_id bigint)
returns public.completed_work_requests
language plpgsql
security definer
set search_path = ''
as $$
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
  if p_group_id is null then
    raise sqlstate 'PT400' using message = 'invalid_origin';
  end if;
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'request_command_forbidden';
  end if;
  select profile.full_name into v_actor_name
    from public.profiles as profile where profile.id = v_actor;
  if private.group_role_of(p_group_id, v_actor) is null
     or (select status from public.groups where id = p_group_id) is distinct from 'active' then
    raise exception using errcode = '42501', message = 'request_origin_forbidden';
  end if;
  insert into public.completed_work_requests (requester_id, group_id, description, status)
  values (v_actor, p_group_id, v_description, 'pending') returning * into v_request;
  perform private.notify(array(select private.request_deciders(v_request.id)),
    'task'::public.noti_kind, 'Cerere nouă: ' || left(v_description, 60),
    coalesce(v_actor_name, 'Un membru') || ' a trimis o cerere de muncă realizată.',
    null, 'request:' || v_request.id::text, v_actor);
  return v_request;
end;
$$;

create function public.create_completed_work_request(p_description text, p_group_id bigint)
returns public.completed_work_requests
language sql
security invoker
set search_path = ''
as $$
  select private.create_completed_work_request_impl(p_description, p_group_id);
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
    title, description, group_id, campaign_id,
    audience, assignment_mode, kind, status, deadline, created_by,
    parent_task_id, queue_opened_at, duplicated_from_task_id)
  values (
    v_source.title, v_source.description, v_source.group_id, v_campaign_id,
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
  p_request_id bigint, p_difficulty integer, p_rating integer, p_note text)
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
    (title, description, deadline, group_id,
     audience, assignment_mode, status, created_by)
  values (left(v_request.description, 120), v_request.description, now(),
          v_request.group_id,
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

create or replace function private.express_task_interest_impl(p_task_id bigint)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
  v_executor uuid;
  v_actor_name text;
  v_candidate_id bigint;
  v_position integer;
  v_pending integer;
begin
  -- 2. Gate + visibility
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked -- the serialization
  --    point for the whole first-come race)
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: the Audience rule, re-validated against live
  --    rows and holding them FOR SHARE.
  perform 1 from public.profiles as profile
   where profile.id = v_actor and profile.status = 'activ' for share;
  if not found then
    raise exception using errcode = '42501', message = 'task_command_forbidden';
  end if;
  if v_task.audience = 'local' then
    -- A local Opportunity admits the members of its own Group (ADR-0009): an explicit
    -- roster row of any Group Role, or Automatic Membership at or above the Group's
    -- Minimum Level -- private.is_group_member, the test can_read_task and update_task
    -- (R-E8) apply. The actor's roster row, when there is one, is held FOR SHARE so a
    -- concurrent removal cannot race the check; never a lock on the groups row.
    perform 1 from public.group_members as membership
     where membership.group_id = v_task.group_id and membership.member_id = v_actor
     for share of membership;
    if not coalesce(private.is_group_member(v_task.group_id, v_actor), false) then
      raise exception using errcode = '42501', message = 'task_audience_forbidden';
    end if;
  end if;
  -- 5. Input validation: the only parameter is the target itself, already
  --    resolved by require_task_visible.
  -- 6. State preconditions (PT409) -- umbrella first, see the header.
  if v_task.kind = 'umbrella' then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  if v_task.assignment_mode is distinct from 'public' then
    raise sqlstate 'PT409' using message = 'task_not_public';
  end if;
  if v_task.status in ('completed', 'unfulfilled', 'cancelled') then
    raise sqlstate 'PT409' using message = 'task_terminal';
  end if;
  if v_task.queue_closed_at is not null then
    raise sqlstate 'PT409' using message = 'task_queue_closed';
  end if;
  -- Read under the Task lock, never before it: this is the branch the race
  -- turns on.
  select assignment.member_id into v_executor
    from public.task_assignments as assignment
   where assignment.task_id = p_task_id and assignment.ended_at is null
   for update;
  if v_executor = v_actor then
    raise sqlstate 'PT409' using message = 'already_executor';
  end if;
  if exists (select 1 from public.task_candidates as candidate
              where candidate.task_id = p_task_id
                and candidate.member_id = v_actor
                and candidate.status = 'pending') then
    raise sqlstate 'PT409' using message = 'already_candidate';
  end if;
  -- 7. Mutate, then activity, then notify, then return
  select profile.full_name into v_actor_name
    from public.profiles as profile where profile.id = v_actor;
  if v_executor is null then
    -- First come: the kit writes the Assignment, its executor_assigned row
    -- (assignment_id set, details.via = 'first_come') and the Executor's own
    -- 'Task nou' notification -- which private.notify then drops, the actor
    -- being the recipient.
    perform private.open_task_assignment(p_task_id, v_actor, v_actor, 'first_come');
    perform private.notify(
      array(select private.task_managers(p_task_id, v_actor)),
      'task'::public.noti_kind,
      'Executor nou: ' || v_task.title,
      v_actor_name || ' a preluat taskul.',
      p_task_id, null, v_actor);
  else
    insert into public.task_candidates (task_id, member_id, status, joined_at)
    values (p_task_id, v_actor, 'pending', now())
    returning id into v_candidate_id;
    -- After the insert, by contract: the position is the one the Member
    -- actually joined at. queue_position is self-gated but answers for the
    -- caller's own id, which is exactly v_actor here.
    v_position := private.queue_position(p_task_id, v_actor);
    perform private.log_task_activity(p_task_id, 'interest_expressed', v_actor, null, null, null, null,
      jsonb_build_object('position', v_position, 'candidate_id', v_candidate_id));
    v_pending := private.pending_candidate_count(p_task_id);
    perform private.notify(
      array(select private.task_managers(p_task_id, v_actor)),
      'task'::public.noti_kind,
      'Coadă: ' || v_task.title,
      case when v_pending = 1 then '1 candidat în așteptare.'
           when v_pending < 20 then v_pending::text || ' candidați în așteptare.'
           else v_pending::text || ' de candidați în așteptare.' end,
      p_task_id, 'task:' || p_task_id::text || ':queue', v_actor);
  end if;
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

revoke execute on function private.create_task_impl(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint) from public, anon, authenticated, service_role;
grant execute on function private.create_task_impl(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint) to authenticated;
revoke execute on function public.create_task(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint) from public, anon, authenticated, service_role;
grant execute on function public.create_task(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint) to authenticated;
revoke execute on function private.create_completed_work_request_impl(text, bigint) from public, anon, authenticated, service_role;
grant execute on function private.create_completed_work_request_impl(text, bigint) to authenticated;
revoke execute on function public.create_completed_work_request(text, bigint) from public, anon, authenticated, service_role;
grant execute on function public.create_completed_work_request(text, bigint) to authenticated;

comment on function private.create_task_impl(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint) is
  'Creates one Task, Subtask or Umbrella in a Group the live caller may manage (private.require_group_work_manager, 42501 task_manage_forbidden); the actor is auth.uid(), never a parameter. A top-level Task names its Group (PT400 task_group_required without one); a Subtask locks its Umbrella FOR NO KEY UPDATE, inherits its Group, and refuses a different p_group_id (subtask_origin_mismatch). A direct Executor must be activ and at or above the Group''s Minimum Level (invalid_executor).';
comment on function public.create_task(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint) is
  'Creates Group-owned work through live Group Manager/Responsible authority. The Group is the only Origin (#579): p_group_id for a top-level Task or Umbrella, inherited from the Umbrella for a Subtask. Subtasks lock the Umbrella FOR NO KEY UPDATE.';
comment on function private.create_completed_work_request_impl(text, bigint) is
  'Files one pending Completed-work Request in one active Group where the live caller holds a Group Role or membership (private.group_role_of, 42501 request_origin_forbidden); the requester is auth.uid(), never a parameter. Notifies private.request_deciders without an actor echo.';
comment on function public.create_completed_work_request(text, bigint) is
  'Files work in exactly one active Group where the actor has membership. The Group is the only Origin (#579). Notifies precisely request_deciders without an actor echo.';
comment on function private.express_task_interest_impl(bigint) is
  'A Member takes a public Task or joins its Candidate Queue; the actor is auth.uid(), never a parameter. The tasks row is locked FOR UPDATE before any Assignment state is read, so concurrent callers serialize: the first opens the one Assignment (first come), every later one joins the queue. A local Opportunity admits only members of the Task''s own Group (private.is_group_member, 42501 task_audience_forbidden), the caller''s roster row held FOR SHARE.';

-- ==================== 5. The legacy Campaign overload ====================
drop function public.create_campaign(text, text);

-- ==================== 6. Shims and resolver ====================
drop function private.can_manage_origin(text, text, bigint);
drop function private.require_origin_manager(text, text, bigint);
drop function private.group_id_for_legacy_origin(text, text, bigint);

-- ==================== 7. Constraints, foreign keys, indexes ====================
alter table public.tasks
  drop constraint tasks_exactly_one_origin_ck,
  drop constraint tasks_dept_id_fkey,
  drop constraint tasks_team_id_fkey,
  drop constraint tasks_project_id_fkey;
alter table public.completed_work_requests
  drop constraint completed_work_requests_origin_ck,
  drop constraint completed_work_requests_dept_id_fkey,
  drop constraint completed_work_requests_team_id_fkey,
  drop constraint completed_work_requests_project_id_fkey;
alter table public.events
  drop constraint events_scope_fields_ck,
  drop constraint events_team_department_fkey,
  drop constraint events_dept_id_fkey,
  drop constraint events_project_id_fkey;
alter table public.campaigns
  drop constraint campaigns_department_id_fkey;

drop index public.tasks_dept_idx;
drop index public.tasks_team_idx;
drop index public.tasks_project_idx;
drop index public.completed_work_requests_dept_idx;
drop index public.completed_work_requests_team_idx;
drop index public.completed_work_requests_project_idx;
drop index public.events_dept_idx;
drop index public.events_team_idx;
drop index public.events_project_idx;

-- ==================== 8. Columns, then event_scope ====================
alter table public.tasks
  drop column dept_id,
  drop column team_id,
  drop column project_id;
alter table public.completed_work_requests
  drop column dept_id,
  drop column team_id,
  drop column project_id;
alter table public.events
  drop column scope,
  drop column dept_id,
  drop column team_id,
  drop column project_id;
alter table public.campaigns
  drop column department_id;

-- events.group_id NOT NULL + events_group_id_fkey are now the whole Event Origin
-- invariant; nothing references the enum once events.scope is gone (R18).
drop type public.event_scope;

comment on column public.events.group_id is
  'The owning Group, and the Event''s only Origin since #579 dropped scope/dept_id/team_id/project_id: NOT NULL plus events_group_id_fkey are the whole invariant. Visibility is min_level (events_read), never the Group.';

-- ==================== 9. Readers recreated from group_id alone ====================
create view public.tasks_with_overdue
with (security_invoker = on)
as
select
  task.*,
  (
    coalesce(task.deadline < statement_timestamp(), false)
    and task.status in ('todo', 'in_progress', 'in_review')
  ) as is_overdue
from public.tasks as task;
revoke all on public.tasks_with_overdue
  from public, anon, authenticated, service_role;
grant select on public.tasks_with_overdue to authenticated, service_role;
comment on view public.tasks_with_overdue is
  'RLS-aware Task query surface with overdue derived from the current clock and unfinished lifecycle state.';

drop view public.dept_cup;
drop function public.department_cup(bigint);
drop function private.department_cup_rows(bigint);

create function private.department_cup_rows(p_campaign_id bigint)
returns table (
  group_id bigint,
  name text,
  points int,
  members bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with task_points as (
    select cup.id as cup_group_id, sum(entry.delta)::int as points
      from public.points_ledger as entry
      join public.tasks as task on task.id = entry.task_id
      join public.groups as task_group on task_group.id = task.group_id
      join lateral (
        select competing.id, ancestor.depth
          from unnest(task_group.path) with ordinality as ancestor(id, depth)
          join public.groups as competing on competing.id = ancestor.id and competing.competes_in_cup
         order by ancestor.depth desc
         limit 1
      ) as cup on true
     where entry.reason in ('task', 'task_reversal')
       and (p_campaign_id is null or task.campaign_id = p_campaign_id)
       and not exists (
         select 1 from unnest(task_group.path) with ordinality as link(id, depth)
           join public.groups as node on node.id = link.id
          where link.depth > cup.depth and not node.counts_toward_parent_cup)
     group by cup.id
  ), active_members as (
    select membership.group_id, count(*)::bigint as members
      from public.group_members as membership
      join public.profiles as member on member.id = membership.member_id
     where member.status = 'activ'
     group by membership.group_id
  )
  select grp.id, grp.name,
         coalesce(task_points.points, 0), coalesce(active_members.members, 0)
    from public.groups as grp
    left join task_points on task_points.cup_group_id = grp.id
    left join active_members on active_members.group_id = grp.id
   where public.auth_level() >= 5
     and (select private.caller_level()) >= 5
     and exists (
       select 1
         from public.profiles as caller
        where caller.id = (select auth.uid())
          and caller.status = 'activ'
     )
     and grp.competes_in_cup
   order by coalesce(task_points.points, 0) desc, grp.name asc;
$$;

create function public.department_cup(p_campaign_id bigint default null)
returns table (
  group_id bigint,
  name text,
  points int,
  members bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.department_cup_rows(p_campaign_id);
$$;

create view public.dept_cup with (security_invoker = on) as
  select cup.group_id, cup.name, cup.points, cup.members
  from private.department_cup_rows(null::bigint) as cup
  order by cup.points desc, cup.name asc;
revoke all on public.dept_cup from public, anon, authenticated, service_role;
grant select on public.dept_cup to authenticated;

revoke execute on function private.department_cup_rows(bigint) from public, anon, authenticated, service_role;
grant execute on function private.department_cup_rows(bigint) to authenticated;
revoke execute on function public.department_cup(bigint) from public, anon, authenticated, service_role;
grant execute on function public.department_cup(bigint) to authenticated;

comment on function private.department_cup_rows(bigint) is
  'Live BCE+ Cup rows from competing Group settings. Task/reversal ledger points reach the nearest competing ancestor only when every lower link counts. Members are the active explicit roster of the competitor itself.';
comment on function public.department_cup(bigint) is
  'Campaign-filtered Group Cup standings as (group_id, name, points, members); the compatibility Department id went with the bridge (#579). Failed leadership gates return no rows.';
comment on view public.dept_cup is
  'Unfiltered Cup standings by competing Group as (group_id, name, points, members). Only Task points and reversals count, attributed through the Group ancestor chain.';

drop function public.leadership_member_tasks(uuid);
drop function private.leadership_member_tasks_impl(uuid);

create function private.leadership_member_tasks_impl(p_member_id uuid)
returns table (
  assignment_id bigint, member_id uuid, assigned_at timestamptz, assigned_by uuid,
  assignment_ended_at timestamptz, assignment_end_reason text, assignment_end_note text,
  task_id bigint, title text, description text, deadline timestamptz, task_kind text,
  audience text, assignment_mode text,
  status public.task_status, is_overdue boolean, completed_late boolean,
  difficulty int, rating int, started_at timestamptz, submitted_at timestamptz,
  review_round int, returned_to_progress_at timestamptz, completed_at timestamptz,
  unfulfilled_at timestamptz, cancelled_at timestamptz, cancel_reason text,
  queue_opened_at timestamptz, queue_closed_at timestamptz,
  task_created_at timestamptz, task_created_by uuid, duplicated_from_task_id bigint,
  group_id bigint, group_name text, campaign_id bigint,
  campaign_name text, parent_task_id bigint, parent_task_title text,
  subtasks jsonb, evaluation_history jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select assignment.id,
         assignment.member_id,
         assignment.assigned_at,
         assignment.assigned_by,
         assignment.ended_at,
         assignment.end_reason,
         assignment.end_note,
         task.id,
         task.title,
         task.description,
         task.deadline,
         task.kind,
         task.audience,
         task.assignment_mode,
         task.status,
         coalesce(task.deadline < statement_timestamp(), false)
           and task.status in ('todo', 'in_progress', 'in_review'),
         task.status = 'completed'
           and coalesce(task.completed_at > task.deadline, false),
         task.difficulty,
         task.rating,
         task.started_at,
         task.submitted_at,
         task.review_round,
         task.returned_to_progress_at,
         task.completed_at,
         task.unfulfilled_at,
         task.cancelled_at,
         task.cancel_reason,
         task.queue_opened_at,
         task.queue_closed_at,
         task.created_at,
         task.created_by,
         task.duplicated_from_task_id,
         task.group_id,
         origin_group.name,
         campaign.id,
         campaign.name,
         parent.id,
         parent.title,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', child.id,
                    'title', child.title,
                    'status', child.status,
                    'completed_late', child.status = 'completed'
                      and coalesce(child.completed_at > child.deadline, false)
                  ) order by child.created_at, child.id)
             from public.tasks as child
            where child.parent_task_id = task.id
         ), '[]'::jsonb),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', evaluation.id,
                    'source', evaluation.source,
                    'outcome', evaluation.outcome,
                    'difficulty', evaluation.difficulty,
                    'rating', evaluation.rating,
                    'points', evaluation.points,
                    'note', evaluation.note,
                    'evaluated_at', evaluation.evaluated_at,
                    'evaluated_by', evaluation.evaluated_by,
                    'reversed_at', evaluation.reversed_at,
                    'reversed_by', evaluation.reversed_by,
                    'reversal_reason', evaluation.reversal_reason
                  ) order by evaluation.evaluated_at, evaluation.id)
             from public.task_evaluations as evaluation
            where evaluation.assignment_id = assignment.id
         ), '[]'::jsonb)
    from public.task_assignments as assignment
    join public.tasks as task on task.id = assignment.task_id
    join public.groups as origin_group on origin_group.id = task.group_id
    left join public.campaigns as campaign on campaign.id = task.campaign_id
    left join public.tasks as parent on parent.id = task.parent_task_id
   where assignment.member_id = p_member_id
     and public.auth_level() >= 5
     and (select private.caller_level()) >= 5
     and exists (
       select 1
         from public.profiles as caller
        where caller.id = (select auth.uid())
          and caller.status = 'activ'
     )
   order by assignment.assigned_at desc, assignment.id desc;
$$;

create function public.leadership_member_tasks(p_member_id uuid)
returns table (
  assignment_id bigint, member_id uuid, assigned_at timestamptz, assigned_by uuid,
  assignment_ended_at timestamptz, assignment_end_reason text, assignment_end_note text,
  task_id bigint, title text, description text, deadline timestamptz, task_kind text,
  audience text, assignment_mode text,
  status public.task_status, is_overdue boolean, completed_late boolean,
  difficulty int, rating int, started_at timestamptz, submitted_at timestamptz,
  review_round int, returned_to_progress_at timestamptz, completed_at timestamptz,
  unfulfilled_at timestamptz, cancelled_at timestamptz, cancel_reason text,
  queue_opened_at timestamptz, queue_closed_at timestamptz,
  task_created_at timestamptz, task_created_by uuid, duplicated_from_task_id bigint,
  group_id bigint, group_name text, campaign_id bigint,
  campaign_name text, parent_task_id bigint, parent_task_title text,
  subtasks jsonb, evaluation_history jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.leadership_member_tasks_impl(p_member_id);
$$;

revoke execute on function private.leadership_member_tasks_impl(uuid) from public, anon, authenticated, service_role;
grant execute on function private.leadership_member_tasks_impl(uuid) to authenticated;
revoke execute on function public.leadership_member_tasks(uuid) from public, anon, authenticated, service_role;
grant execute on function public.leadership_member_tasks(uuid) to authenticated;

comment on function public.leadership_member_tasks(uuid) is
  'Live BCE+ Assignment history with the owning Group''s id and name, plus Task and Evaluation history. The legacy Origin presentation triple went with the bridge (#579).';
comment on function private.leadership_member_tasks_impl(uuid) is
  'One row per selected Member Assignment, newest first, labelled by the Task''s owning Group.';

-- ==================== 10. Two comments that described the bridge ====================
-- private.create_event_impl and private.update_event_impl are untouched by this migration,
-- but each says in prose that events_sync_group_origin derives the legacy Origin from
-- group_id. That trigger is gone, so the sentence is replaced in place rather than the
-- whole comment being restated here (and drifting from the one #248/#370 wrote).
do $$
declare
  v_event_impl constant text :=
    'private.create_event_impl(text,text,bigint,timestamptz,timestamptz,text,integer,text,integer)';
  v_update_impl constant text :=
    'private.update_event_impl(bigint,text,text,bigint,timestamptz,timestamptz,text,integer,text,integer)';
  v_comment text;
begin
  v_comment := replace(obj_description(v_event_impl::regprocedure, 'pg_proc'),
    'The legacy (scope, dept_id, team_id, project_id) Origin is NEVER written here: the events_sync_group_origin trigger (#519) derives it from group_id, which is what makes an Independent Team Event -- scope team, no Department -- expressible at all.',
    'The Group is the Event''s only Origin (#579 dropped scope, dept_id, team_id and project_id): an Independent Team Event is simply one whose Group is that Team''s.');
  execute format('comment on function %s is %L', v_event_impl, v_comment);

  v_comment := replace(obj_description(v_update_impl::regprocedure, 'pg_proc'),
    'The legacy (scope, dept_id, team_id, project_id) Origin is never written here: events_sync_group_origin re-derives it from group_id.',
    'The Group is the Event''s only Origin (#579 dropped scope, dept_id, team_id and project_id), so a move rewrites exactly group_id.');
  execute format('comment on function %s is %L', v_update_impl, v_comment);
end;
$$;
