-- R57 (Alex, 2026-10-14; spec docs/superpowers/specs/2026-10-14-minimum-role-filter-design.md):
-- a public Task's Minimum Level -- the lowest Level that sees it as an
-- Opportunity or through Shared Work Visibility and may join its Candidate
-- Queue. It never gates a Group Role on the path, BCE and above, or one's own
-- Assignments and Candidatures, and it never widens who the Audience reaches.
-- Every existing Task gets 0, so nothing anyone sees changes until a Role is
-- chosen. Bodies restated here are main's latest with only the R57 lines added.

-- ==================== 1 · the column ====================
alter table public.tasks
  add column min_level integer not null default 0,
  add constraint tasks_min_level_ck check (min_level in (0, 1, 2, 3, 5, 6)),
  add constraint tasks_min_level_public_ck
    check (min_level = 0 or (kind = 'task' and assignment_mode = 'public'));
comment on column public.tasks.min_level is
  'R57: the lowest Level that sees this public Task as an Opportunity or through Shared Work Visibility and may join its Candidate Queue -- 0 Recrut, 1 Voluntar, 2 Voluntar Activ, 3 Voluntar cu Drept de Vot, 5 BCE, 6 BC. Never widens the Audience. 0 for a direct Task and an Umbrella. Written only by the Task commands.';

-- ==================== 2 · who reads a Task ====================
create or replace function private.can_read_task(p_task_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- R2 own Assignment/Candidature (ever) -- kept outside the Private Group gate:
  -- a Task Manager may name an Executor who is not a member, and a Member's own
  -- work stays theirs to read. Every other rule reads only a Group the caller
  -- can see (#756, private.can_see_group): R1 level >= 5; R6-org an open public
  -- Opportunity whose Audience is org, for every active Member whatever the
  -- Group's Minimum Level (#794, ruling R26); then, subject to the Group's
  -- Minimum Level unless the caller holds a Group Role on the path: R3 a Group
  -- Role on the path (status-agnostic: an archived Project's former lead keeps
  -- reading its history); R4 Shared Work Visibility of a Group on the path the
  -- caller belongs to; R6-own an open public Opportunity of a Group the caller
  -- is a member of (private.is_group_member, the test the join applies), any
  -- Audience. R7 judged on the Task and its Umbrella. R57: R6-org, R6-own and R4
  -- also need the caller at or above the Task's own Minimum Level, judged on
  -- the Task itself (target), also when it is read through its Umbrella.
  select coalesce(public.auth_is_member(), false)
     and exists (
       select 1
         from public.profiles as caller
         join public.roles as caller_role on caller_role.id = caller.role
         join public.tasks as target on target.id = p_task_id
         join public.tasks as task on task.id = target.id or task.id = target.parent_task_id
         join public.groups as grp on grp.id = task.group_id
        where caller.id = (select auth.uid())
          and caller.status = 'activ'
          and (
            exists (select 1 from public.task_assignments as assignment
                     where assignment.task_id = task.id and assignment.member_id = caller.id)
            or exists (select 1 from public.task_candidates as candidature
                        where candidature.task_id = task.id and candidature.member_id = caller.id)
            or (
              private.can_see_group(grp.id, caller.id)
              and (
                caller_role.level >= 5
                or (task.kind = 'task'
                    and task.audience = 'org'
                    and task.assignment_mode = 'public'
                    and task.queue_closed_at is null
                    and task.status not in ('completed', 'unfulfilled', 'cancelled')
                    and caller_role.level >= target.min_level)
                or (
                  (caller_role.level >= grp.min_level
                   or exists (select 1 from public.group_members as held
                               where held.member_id = caller.id
                                 and held.group_role in ('manager', 'responsible')
                                 and grp.path @> array[held.group_id]))
                  and (
                    exists (select 1 from public.group_members as held
                             where held.member_id = caller.id
                               and held.group_role in ('manager', 'responsible')
                               and grp.path @> array[held.group_id])
                    or (caller_role.level >= target.min_level and exists (select 1 from public.groups as shared
                                where grp.path @> array[shared.id]
                                  and shared.shared_work_visibility
                                  and (exists (select 1 from public.group_members as gm
                                                where gm.group_id = shared.id and gm.member_id = caller.id)
                                       or (shared.automatic_membership and caller_role.level >= shared.min_level))))
                    or (task.kind = 'task'
                        and task.assignment_mode = 'public'
                        and task.queue_closed_at is null
                        and task.status not in ('completed', 'unfulfilled', 'cancelled')
                        and private.is_group_member(grp.id, caller.id)
                        and caller_role.level >= target.min_level)
                  )
                )
              )
            )
          ));
$function$;

comment on function private.can_read_task(bigint) is
  'ADR-0007 as amended 2026-09-25 (ruling R26, #794) and 2026-10-14 (ruling R57) on ADR-0009 R1-R7: own Assignments and Candidatures (ever); then, for a Group the caller can see (private.can_see_group): BCE/BC/Moderator; every open organization-wide Opportunity (Audience org, public, queue open, not terminal) for every active Member at or above the Task''s own Minimum Level, whatever the Group''s; and, subject to the Group''s Minimum Level unless the caller holds a Group Role on the path: Group Managers and Responsibles on the path, Shared Work Visibility and the open Opportunities of a Group the caller is a member of (private.is_group_member), any Audience -- these two also at or above the Task''s Minimum Level. The Task''s Minimum Level is judged on the Task itself, also when it is read through its Umbrella. A local Opportunity of a Group the caller is not in is invisible. Direct Tasks, Umbrellas, closed queues and terminal Tasks stay hidden from non-participants whatever their Audience.';

-- #1064's sets: R4 leaves 'whole' for its own 'shared' set, so 'whole' keeps
-- R1 and R3, which a Task's Minimum Level never gates.
create or replace function private.task_read_groups(p_kind text)
 RETURNS bigint[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with caller as (
    select caller.id, caller_role.level
      from public.profiles as caller
      join public.roles as caller_role on caller_role.id = caller.role
     where caller.id = (select auth.uid())
       and caller.status = 'activ'
       and coalesce(public.auth_is_member(), false)
  ),
  judged as (
    select grp.id,
           private.can_see_group(grp.id, caller.id) as seen,
           caller.level >= 5 as global_reader,
           caller.level >= grp.min_level as at_level,
           exists (select 1
                     from public.group_members as held
                    where held.member_id = caller.id
                      and held.group_role in ('manager', 'responsible')
                      and grp.path @> array[held.group_id]) as role_on_path,
           exists (select 1
                     from public.groups as shared
                    where grp.path @> array[shared.id]
                      and shared.shared_work_visibility
                      and (exists (select 1
                                     from public.group_members as gm
                                    where gm.group_id = shared.id
                                      and gm.member_id = caller.id)
                           or (shared.automatic_membership
                               and caller.level >= shared.min_level))) as shared_on_path,
           private.is_group_member(grp.id, caller.id) as member
      from public.groups as grp
     cross join caller
  )
  select coalesce(array_agg(judged.id order by judged.id), '{}'::bigint[])
    from judged
   where judged.seen
     and case p_kind
           -- R1 level 5 and up; R3 a Group Role on the path. Neither is
           -- gated by a Task's own Minimum Level (R57).
           when 'whole' then judged.global_reader or judged.role_on_path
           -- R4 Shared Work Visibility on the path, at the Minimum Level unless
           -- a Group Role is held; tasks_read adds the Task's own Minimum
           -- Level (R57).
           when 'shared' then (judged.at_level or judged.role_on_path) and judged.shared_on_path
           -- R6-own: an open public Opportunity of a Group one is a member of.
           when 'open' then (judged.at_level or judged.role_on_path) and judged.member
           -- R6-org: an open public org-Audience Opportunity of any Group one sees.
           when 'org' then true
           else false
         end;
$function$;

comment on function private.task_read_groups(text) is
  'Fast reads part 1 (spec 2026-10-14 member reads), split by R57: the Group half of the Task read rule as sets, judged per Group by the expressions private.can_read_task applies to a Task''s Group, all within private.can_see_group. ''whole'': every Task of the Group is read (R1 level >= 5, or R3 a Group Role on its path). ''shared'': its Tasks are read through R4 Shared Work Visibility on the path (a roster row or Automatic Membership), at the Group''s Minimum Level unless a Group Role is held -- tasks_read adds the Task''s own Minimum Level. ''open'': its open public Opportunities, any Audience (R6-own: a member, at the Minimum Level or holding a Group Role on the path). ''org'': its open public org-Audience Opportunities (R6-org). Empty without organization claims or a live activ Profile, and for any other kind. Read by tasks_read through (select ...), once per statement.';

alter policy tasks_read on public.tasks
  using (
    (select public.auth_is_member())
    and (   id = any ((select private.own_task_ids())::bigint[])
         or parent_task_id = any ((select private.own_task_ids())::bigint[])
         or group_id = any ((select private.task_read_groups('whole'))::bigint[])
         or (    min_level <= (select private.caller_level())
             and (   group_id = any ((select private.task_read_groups('shared'))::bigint[])
                  or (    kind = 'task'
                      and assignment_mode = 'public'
                      and queue_closed_at is null
                      and status not in ('completed', 'unfulfilled', 'cancelled')
                      and (   group_id = any ((select private.task_read_groups('open'))::bigint[])
                           or (    audience = 'org'
                               and group_id = any ((select private.task_read_groups('org'))::bigint[]))))))));
comment on policy tasks_read on public.tasks is
  'The Task read rule (private.can_read_task) decided once per statement: R2/R7 through private.own_task_ids(), R1/R3 through task_read_groups(''whole''), and -- at or above the Task''s own Minimum Level (R57) -- R4 through ''shared'', R6-own and R6-org through ''open'' and ''org'' on an open public Opportunity. supabase/tests/task_read_sets.test.sql holds it to private.can_read_task for every caller.';

-- An Opportunity's card names its Group only for a caller who may see it.
create or replace function private.has_open_org_opportunity(p_group_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- The same open state as can_read_task's org arm: an ordinary public Task,
  -- queue open, not terminal, Audience org -- owned by an active public Group.
  select exists (
    select 1
      from public.groups as grp
      join public.tasks as task on task.group_id = grp.id
     where grp.id = p_group_id
       and grp.status = 'active'
       and not grp.is_private
       and task.kind = 'task'
       and task.audience = 'org'
       and task.assignment_mode = 'public'
       and task.queue_closed_at is null
       and task.status not in ('completed', 'unfulfilled', 'cancelled')
       -- R57: only an Opportunity the caller may see names its Group.
       and task.min_level <= private.caller_level()
  );
$function$;

comment on function private.has_open_org_opportunity(bigint) is
  'The groups_read limb of #794 (ruling R26), gated by R57: true while an active, non-private Group owns an open organization-wide Opportunity (kind task, Audience org, public, queue open, not terminal) at or below the caller''s live Level (the Task''s own Minimum Level, private.caller_level()) -- the rows private.can_read_task shows every active Member at or above the Task''s Minimum Level, whatever the Group''s. It lets such an Opportunity''s card name and colour its Group for a Member below the Group''s Minimum Level; it stays behind groups_read''s auth_is_member() and can_see_group gates. Policy predicate: authenticated may execute it.';

-- ==================== 4 · creating ====================
-- The Role travels with every copy; a direct Task or an Umbrella is stored at 0.
drop function public.create_tasks(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer);
drop function private.create_tasks_impl(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer);
drop function public.create_task(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb);
drop function private.create_task_impl(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb);

create function private.create_task_impl(p_title text, p_description text, p_deadline timestamp with time zone, p_audience text, p_assignment_mode text, p_executor_id uuid, p_campaign_id bigint, p_parent_task_id bigint, p_kind text, p_group_id bigint, p_link_label text, p_link_url text, p_links jsonb, p_min_level integer)
 RETURNS public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_parent public.tasks%rowtype;
  v_group bigint;
  v_title text;
  v_links jsonb;
  v_task public.tasks%rowtype;
  v_constraint text;
  v_min_level integer;
begin
  if p_kind is null or p_kind not in ('task', 'umbrella') then
    raise sqlstate 'PT400' using message = 'invalid_task_kind';
  end if;
  -- R57: the ladder, malformed for every caller.
  if p_min_level is not null and p_min_level not in (0, 1, 2, 3, 5, 6) then
    raise sqlstate 'PT400' using message = 'invalid_task_min_level';
  end if;
  -- Only an ordinary public Task has a Candidate Queue to gate; a direct
  -- Task or an Umbrella is stored at 0 whatever was sent.
  v_min_level := case when p_kind = 'task' and p_assignment_mode = 'public'
                      then coalesce(p_min_level, 0) else 0 end;
  -- #673 (R8): malformed for every caller, measured as stored (trimmed).
  perform private.require_text_length('title',
    regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g'), 3, 120);
  perform private.require_text_length('description',
    regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 2000);
  if p_deadline < now() then
    raise sqlstate 'PT400' using message = 'deadline_in_past';
  end if;
  -- #684 (R7), R46: the Attached Links, normalized, judged before the gate.
  v_links := private.require_attached_links(p_links, p_link_label, p_link_url);
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
    -- #794 (ruling R26): the Audience opens a Candidate Queue to the whole
    -- organization; a directly assigned Task has none, so it is local.
    if p_assignment_mode = 'direct' and p_audience = 'org' then
      raise sqlstate 'PT400' using message = 'direct_task_local_only';
    end if;
    if p_assignment_mode = 'public' and p_executor_id is not null then
      raise sqlstate 'PT400' using message = 'executor_not_allowed_for_public';
    end if;
    -- #756 (ruling R25): a Private Group offers no organization-wide
    -- Opportunity, so its Tasks carry only the local Audience. Judged on the
    -- loaded Group after the gate, so an outsider learns nothing from it.
    if p_audience = 'org'
       and exists (select 1 from public.groups as origin
                    where origin.id = v_group and origin.is_private) then
      raise sqlstate 'PT400' using message = 'private_group_local_only';
    end if;
  end if;
  -- Security pass L3: at most one hundred Tasks created per Member in any 24
  -- hours (counted on the append-only 'created' activity rows), after every
  -- validation so a malformed call still hears its own reason.
  -- R57: never above the creator's own Level (the Moderator's 9 sets any).
  if v_min_level > 0 and coalesce(private.actor_level(v_actor), -1) < 9
     and v_min_level > coalesce(private.actor_level(v_actor), -1) then
    raise sqlstate 'PT400' using message = 'task_min_level_above_actor';
  end if;
  perform private.require_daily_cap('task_create', v_actor);
  begin
    insert into public.tasks (title, description, deadline, group_id,
                              audience, assignment_mode, campaign_id, parent_task_id, kind,
                              status, created_by, queue_opened_at, links, min_level)
    values (v_title, nullif(regexp_replace(coalesce(p_description, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
            p_deadline, v_group,
            p_audience, p_assignment_mode, p_campaign_id, p_parent_task_id, p_kind,
            'todo', v_actor, case when p_assignment_mode = 'public' then now() end,
            v_links, v_min_level)
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
                       'executor_id', p_executor_id, 'min_level', v_min_level));
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
$function$;

comment on function private.create_task_impl(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb, integer) is
  'Creates one Task, Subtask or Umbrella in a Group the live caller may manage (private.require_group_work_manager, 42501 task_manage_forbidden); the actor is auth.uid(), never a parameter. A top-level Task names its Group (PT400 task_group_required without one); a Subtask locks its Umbrella FOR NO KEY UPDATE, inherits its Group, and refuses a different p_group_id (subtask_origin_mismatch). A direct Executor must be activ and at or above the Group''s Minimum Level (invalid_executor). #684, R46: up to five Attached Links (p_links; or, from an app version before R46, the one pair p_link_label + p_link_url) are judged at step 1 by private.require_attached_links and stored in tasks.links; an Umbrella may carry them like any Task. R57 (2026-10-14): p_min_level, the Task''s Minimum Level (0 by default; stored only on an ordinary public Task, a direct Task or an Umbrella stays at 0; PT400 invalid_task_min_level off the ladder, task_min_level_above_actor above the creator''s own Level).';

create function private.create_tasks_impl(p_title text, p_description text, p_deadline timestamp with time zone, p_audience text, p_assignment_mode text, p_executor_ids uuid[], p_campaign_id bigint, p_parent_task_id bigint, p_kind text, p_group_id bigint, p_links jsonb, p_copies integer, p_min_level integer)
 RETURNS SETOF public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_executors uuid[] := coalesce(p_executor_ids, '{}'::uuid[]);
  v_given     integer := coalesce(array_length(v_executors, 1), 0);
  v_task      public.tasks%rowtype;
begin
  -- 1. Malformed for every caller (conventions section 2: before the gate).
  if p_copies is null or p_copies < 1 then
    raise sqlstate 'PT400' using message = 'invalid_copies';
  end if;
  if p_copies > 100 then
    raise sqlstate 'PT400' using message = 'too_many_copies';
  end if;
  if p_kind = 'umbrella' and p_copies > 1 then
    raise sqlstate 'PT400' using message = 'invalid_copies';
  end if;
  if p_assignment_mode = 'public' and v_given > 0 then
    raise sqlstate 'PT400' using message = 'invalid_executors';
  end if;
  if p_assignment_mode = 'direct' and v_given > 0 and v_given <> p_copies then
    raise sqlstate 'PT400' using message = 'invalid_executors';
  end if;

  -- 2. One create per copy, in creation order, in this one transaction. A
  --    null entry (or no list at all) leaves that copy unassigned, as a
  --    direct Task may start today. The legacy link pair is never sent.
  for i in 1..p_copies loop
    v_task := private.create_task_impl(
      p_title, p_description, p_deadline, p_audience, p_assignment_mode,
      case when v_given > 0 then v_executors[i] end,
      p_campaign_id, p_parent_task_id, p_kind, p_group_id,
      null, null, p_links, p_min_level);
    return next v_task;
  end loop;
  return;
end;
$function$;

comment on function private.create_tasks_impl(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer, integer) is
  'Body of public.create_tasks: p_copies identical Tasks (or Subtasks of one Umbrella; an Umbrella itself allows one copy) in one transaction, each through private.create_task_impl, so every create_task rule holds per copy and one refusal rolls back all. Step 1: PT400 invalid_copies (null, below 1, or above 1 for an Umbrella), too_many_copies (above 100), invalid_executors (any executors on a public Task; a direct list whose length is not p_copies). A direct copy''s Executor is p_executor_ids[i]; a null entry or no list leaves it unassigned. Each copy spends one task_create slot and notifies its Executor once ("Task nou"). R57 (2026-10-14): p_min_level, the Task''s Minimum Level (0 by default; stored only on an ordinary public Task, a direct Task or an Umbrella stays at 0; PT400 invalid_task_min_level off the ladder, task_min_level_above_actor above the creator''s own Level).';

create function public.create_task(p_title text, p_description text, p_deadline timestamp with time zone, p_audience text, p_assignment_mode text, p_executor_id uuid DEFAULT NULL::uuid, p_campaign_id bigint DEFAULT NULL::bigint, p_parent_task_id bigint DEFAULT NULL::bigint, p_kind text DEFAULT 'task'::text, p_group_id bigint DEFAULT NULL::bigint, p_link_label text DEFAULT NULL::text, p_link_url text DEFAULT NULL::text, p_links jsonb DEFAULT '[]'::jsonb, p_min_level integer DEFAULT 0)
 RETURNS public.tasks
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.create_task_impl(p_title, p_description, p_deadline, p_audience, p_assignment_mode,
                                  p_executor_id, p_campaign_id, p_parent_task_id, p_kind, p_group_id,
                                  p_link_label, p_link_url, p_links, p_min_level);
$function$;

comment on function public.create_task(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb, integer) is
  'Creates Group-owned work through live Group Manager/Responsible authority. The Group is the only Origin (#579): p_group_id for a top-level Task or Umbrella, inherited from the Umbrella for a Subtask. Subtasks lock the Umbrella FOR NO KEY UPDATE. R46: p_links sets up to five Attached Links ([{label, url}], PT400 invalid_links, too_many_links, link_incomplete, link_label_too_long, link_url_too_long, link_url_invalid); p_link_label + p_link_url, kept for one release, are the one link when p_links is empty. R57 (2026-10-14): p_min_level, the Task''s Minimum Level (0 by default; stored only on an ordinary public Task, a direct Task or an Umbrella stays at 0; PT400 invalid_task_min_level off the ladder, task_min_level_above_actor above the creator''s own Level).';

create function public.create_tasks(p_title text, p_description text, p_deadline timestamp with time zone, p_audience text, p_assignment_mode text, p_executor_ids uuid[] DEFAULT NULL::uuid[], p_campaign_id bigint DEFAULT NULL::bigint, p_parent_task_id bigint DEFAULT NULL::bigint, p_kind text DEFAULT 'task'::text, p_group_id bigint DEFAULT NULL::bigint, p_links jsonb DEFAULT '[]'::jsonb, p_copies integer DEFAULT 1, p_min_level integer DEFAULT 0)
 RETURNS SETOF public.tasks
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select * from private.create_tasks_impl(p_title, p_description, p_deadline, p_audience, p_assignment_mode,
                                          p_executor_ids, p_campaign_id, p_parent_task_id, p_kind, p_group_id,
                                          p_links, p_copies, p_min_level);
$function$;

comment on function public.create_tasks(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer, integer) is
  'Creates p_copies (1..100) identical Tasks -- or Subtasks of the Umbrella p_parent_task_id -- atomically, returning the rows in creation order; the arguments are create_task''s with p_executor_ids (one entry per direct copy, null entries allowed) in place of p_executor_id and no legacy link pair. Reasons of its own: PT400 invalid_copies, too_many_copies, invalid_executors; every other reason is create_task''s, per copy. R57 (2026-10-14): p_min_level, the Task''s Minimum Level (0 by default; stored only on an ordinary public Task, a direct Task or an Umbrella stays at 0; PT400 invalid_task_min_level off the ladder, task_min_level_above_actor above the creator''s own Level).';

revoke execute on function private.create_task_impl(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.create_task(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb, integer)
  from public, anon, authenticated, service_role;
revoke execute on function private.create_tasks_impl(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.create_tasks(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.create_task_impl(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb, integer) to authenticated;
grant execute on function public.create_task(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb, integer) to authenticated;
grant execute on function private.create_tasks_impl(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer, integer) to authenticated;
grant execute on function public.create_tasks(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer, integer) to authenticated;

-- ==================== 5 · duplicating ====================
create or replace function private.duplicate_task_impl(p_task_id bigint, p_deadline timestamp with time zone)
 RETURNS public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- #673 (R8): a duplicate is a creation, so its deadline is judged too.
  if p_deadline < now() then
    raise sqlstate 'PT400' using message = 'deadline_in_past';
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
  -- #673 (R8): the copied text is the only text a duplicate writes. A source
  -- stored before the kit (not yet validated) answers the reason, not a raw
  -- constraint name. The Attached Links need no such check: tasks_links_ck and
  -- the guards behind them held them from the moment they were written (#684, R46).
  perform private.require_text_length('title', v_source.title, 3, 120);
  perform private.require_text_length('description', v_source.description, null, 2000);
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

  -- Security pass L3: a duplicate is a new Task, so it spends the same
  -- one-hundred-a-day allowance as create_task (its 'created' row counts).
  perform private.require_daily_cap('task_create', v_actor);

  insert into public.tasks (
    title, description, group_id, campaign_id,
    audience, assignment_mode, kind, status, deadline, created_by,
    parent_task_id, queue_opened_at, duplicated_from_task_id,
    links, min_level)
  values (
    v_source.title, v_source.description, v_source.group_id, v_campaign_id,
    -- #756 (ruling R25): a copy made inside a Private Group is local, even
    -- when its source predates the Group turning private. #794 (ruling R26):
    -- so is the copy of a directly assigned Task.
    case when v_source.assignment_mode = 'direct'
           or exists (select 1 from public.groups as origin
                       where origin.id = v_source.group_id and origin.is_private)
         then 'local' else v_source.audience end,
    v_source.assignment_mode, 'task', 'todo', p_deadline,
    v_actor, null,
    case when v_source.assignment_mode = 'public' then now() end,
    p_task_id,
    v_source.links,
    -- R57: the copy keeps its source's Role (0 unless it is public).
    case when v_source.assignment_mode = 'public' then v_source.min_level else 0 end)
  returning * into v_clone;

  perform private.log_task_activity(v_clone.id, 'created', v_actor, null, null, 'todo'::public.task_status, null,
    jsonb_build_object('duplicated_from_task_id', p_task_id));
  perform private.log_task_activity(p_task_id, 'duplicated', v_actor, null, null, null, null,
    jsonb_build_object('clone_task_id', v_clone.id));

  select * into v_clone from public.tasks where id = v_clone.id;
  return v_clone;
end;
$function$;


-- ==================== 6 · joining ====================
create or replace function private.express_task_interest_impl(p_task_id bigint)
 RETURNS public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
  v_executor uuid;
  v_candidate_id bigint;
  v_position integer;
  v_pending integer;
begin
  -- 2. Gate + visibility
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked -- concurrent joins
  --    serialize here, so positions and the coalesced count never race)
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
  -- R57: the Task's Minimum Level, judged on the live Level of the profile
  -- held FOR SHARE above. Whoever reads the Task anyway -- a Group Role on
  -- the path, a past Candidate -- hears why.
  if coalesce(private.actor_level(v_actor), -1) < v_task.min_level then
    raise exception using errcode = '42501', message = 'task_level_forbidden';
  end if;
  -- 5. Input validation: the only parameter is the target itself, already
  --    resolved by require_task_visible.
  -- 6. State preconditions (PT409) -- umbrella first.
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
  -- Read under the Task lock: the Executor the manager selected may not also
  -- queue for their own Task.
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
  -- Security pass L3: at most thirty expressions of interest per Member in any
  -- 24 hours (the interest_expressed activity rows are append-only), so an
  -- express/withdraw loop cannot keep notifying the Task's managers.
  perform private.require_daily_cap('task_interest', v_actor);
  -- 7. Mutate, then activity, then notify, then return. Always a pending
  --    Candidate, whether or not the Task has an Executor (#682, R9).
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
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$function$;

comment on function private.express_task_interest_impl(bigint) is
  'A Member joins a public Task''s Candidate Queue; the actor is auth.uid(), never a parameter. Every accepted call inserts a pending Candidate at the end of the arrival order, logs interest_expressed with details.position and details.candidate_id, and coalesces the managers'' "Coadă" notification under task:<id>:queue -- nobody becomes Executor by arriving first (#682, ruling R9); the Task Manager selects with select_task_candidate. The tasks row is locked FOR UPDATE before any Assignment or Candidature is read, so concurrent callers serialize. Refusals in order: task_is_umbrella, task_not_public, task_terminal, task_queue_closed, already_executor, already_candidate. An organization-wide Opportunity admits every active Member who can read it -- since #794 (ruling R26) every one at or above the Task''s Minimum Level (R57; below it 42501 task_level_forbidden, judged under the Task lock, also for a reader through a Group Role on the path or their own past Candidature). A local Opportunity admits only members of the Task''s own Group (private.is_group_member, 42501 task_audience_forbidden, the caller''s roster row held FOR SHARE); a non-member cannot read it at all (PT404 task_not_found) unless they read it as leadership -- a BCE, or a Group Manager or Responsible on the path -- who gets the 42501.';
comment on function public.express_task_interest(bigint) is
  'Express interest in a public Task: the caller joins the end of its ordered Candidate Queue as a pending Candidate, and the Task Manager chooses the Executor from the queue (#682). An organization-wide Opportunity is open to every live active Member at or above the Task''s Minimum Level (#794, ruling R26; R57); a local-Audience Opportunity only to the members of its Group.';
