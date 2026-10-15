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

-- ==================== 7 · the shared edit definitions ====================
drop function public.update_task(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb);
drop function private.update_task_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb);
drop function public.preview_task_update(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb);
drop function private.preview_task_update_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb);
drop function private.plan_task_update(public.tasks, bigint, text, text, timestamptz, bigint, text, text, jsonb);
drop function private.task_update_consequences(bigint, bigint, bigint, text, text);

create function private.plan_task_update(p_task public.tasks, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_links jsonb, p_min_level integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_title text;
  v_description text;
  v_changed text[] := '{}'::text[];
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_campaign_id bigint := p_campaign_id;
  v_campaign_group bigint;
  v_target_path bigint[];
begin
  -- 5. Input validation (PT400).
  if p_group_id is null or (p_group_id is distinct from p_task.group_id
    and not exists (select 1 from public.groups where id = p_group_id and status = 'active')) then
    raise sqlstate 'PT400' using message = 'invalid_group';
  end if;
  if p_group_id is distinct from p_task.group_id then
    if p_task.parent_task_id is not null then
      raise sqlstate 'PT409' using message = 'subtask_origin_immutable';
    end if;
    if p_task.kind = 'umbrella' and exists (select 1 from public.tasks where parent_task_id = p_task.id) then
      raise sqlstate 'PT409' using message = 'umbrella_has_subtasks';
    end if;
  end if;
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'title_required';
  end if;
  v_title := regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_description := nullif(regexp_replace(coalesce(p_description, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  if p_task.kind = 'task' then
    if p_deadline is null then
      raise sqlstate 'PT400' using message = 'deadline_required';
    end if;
    if p_audience is null or p_audience not in ('local', 'org') then
      raise sqlstate 'PT400' using message = 'invalid_audience';
    end if;
    if p_assignment_mode is null or p_assignment_mode not in ('direct', 'public') then
      raise sqlstate 'PT400' using message = 'invalid_assignment_mode';
    end if;
    -- #794 (ruling R26): a directly assigned Task carries the local Audience,
    -- whichever of the two fields the edit changes.
    if p_assignment_mode = 'direct' and p_audience = 'org' then
      raise sqlstate 'PT400' using message = 'direct_task_local_only';
    end if;
    -- #756 (ruling R25): the Group the edit leaves the Task in -- the current
    -- one or a new one -- decides; a Private Group's Tasks are local only.
    if p_audience = 'org'
       and exists (select 1 from public.groups as origin
                    where origin.id = p_group_id and origin.is_private) then
      raise sqlstate 'PT400' using message = 'private_group_local_only';
    end if;
  elsif p_campaign_id is not null then
    raise sqlstate 'PT400' using message = 'umbrella_has_no_campaign';
  end if;
  -- R57: p_min_level is the resolved value (the caller's step 4). Only an
  -- actor at or above both the stored and the new value changes it (the
  -- Moderator's 9 excepted): nobody below a Role raises, lowers or clears it
  -- (making the Task Direct clears it). An unchanged one is not judged, so a
  -- Manager below a Role BC chose can still edit everything else.
  if p_min_level is distinct from p_task.min_level
     and coalesce(private.actor_level(), -1) < 9
     and greatest(p_min_level, p_task.min_level) > coalesce(private.actor_level(), -1) then
    raise sqlstate 'PT400' using message = 'task_min_level_above_actor';
  end if;
  -- 6. State preconditions (PT409): umbrella shape, then the edit window.
  if p_task.kind = 'umbrella' and (p_audience is not null or p_assignment_mode is not null) then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  if p_task.status = 'in_review' then
    raise sqlstate 'PT409' using message = 'task_in_review';
  end if;
  if p_task.status in ('completed', 'unfulfilled', 'cancelled') then
    raise sqlstate 'PT409' using message = 'task_terminal';
  end if;
  if v_title is distinct from p_task.title then
    v_changed := array_append(v_changed, 'title');
    v_before := v_before || jsonb_build_object('title', p_task.title);
    v_after := v_after || jsonb_build_object('title', v_title);
  end if;
  if v_description is distinct from p_task.description then
    v_changed := array_append(v_changed, 'description');
    v_before := v_before || jsonb_build_object('description', p_task.description);
    v_after := v_after || jsonb_build_object('description', v_description);
  end if;
  if p_deadline is distinct from p_task.deadline then
    v_changed := array_append(v_changed, 'deadline');
    v_before := v_before || jsonb_build_object('deadline', p_task.deadline);
    v_after := v_after || jsonb_build_object('deadline', p_deadline);
  end if;
  if p_group_id is distinct from p_task.group_id then
    v_changed := array_append(v_changed, 'group_id');
    v_before := v_before || jsonb_build_object('group_id', p_task.group_id);
    v_after := v_after || jsonb_build_object('group_id', p_group_id);
  end if;
  if p_group_id is distinct from p_task.group_id and p_campaign_id = p_task.campaign_id and p_campaign_id is not null then
    select grp.path into v_target_path from public.groups grp where grp.id = p_group_id;
    select campaign.group_id into v_campaign_group from public.campaigns campaign where campaign.id = p_campaign_id;
    if v_campaign_group is not null and not v_target_path @> array[v_campaign_group] then
      v_campaign_id := null;
    end if;
  end if;
  if v_campaign_id is distinct from p_task.campaign_id then
    v_changed := array_append(v_changed, 'campaign_id');
    v_before := v_before || jsonb_build_object('campaign_id', p_task.campaign_id);
    v_after := v_after || jsonb_build_object('campaign_id', v_campaign_id);
  end if;
  if p_audience is distinct from p_task.audience then
    v_changed := array_append(v_changed, 'audience');
    v_before := v_before || jsonb_build_object('audience', p_task.audience);
    v_after := v_after || jsonb_build_object('audience', p_audience);
  end if;
  if p_assignment_mode is distinct from p_task.assignment_mode then
    v_changed := array_append(v_changed, 'assignment_mode');
    v_before := v_before || jsonb_build_object('assignment_mode', p_task.assignment_mode);
    v_after := v_after || jsonb_build_object('assignment_mode', p_assignment_mode);
  end if;
  if p_min_level is distinct from p_task.min_level then
    v_changed := array_append(v_changed, 'min_level');
    v_before := v_before || jsonb_build_object('min_level', p_task.min_level);
    v_after := v_after || jsonb_build_object('min_level', p_min_level);
  end if;
  -- R46: the Attached Links, already normalized by the caller's step 1, are one
  -- field of the full state.
  if p_links is distinct from p_task.links then
    v_changed := array_append(v_changed, 'links');
    v_before := v_before || jsonb_build_object('links', p_task.links);
    v_after := v_after || jsonb_build_object('links', p_links);
  end if;
  if array_length(v_changed, 1) is null then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;
  return jsonb_build_object('title', v_title, 'description', v_description,
    'campaign_id', v_campaign_id, 'links', p_links, 'min_level', p_min_level,
    'changed', to_jsonb(v_changed), 'before', v_before, 'after', v_after);
end;
$function$;

comment on function private.plan_task_update(public.tasks, bigint, text, text, timestamptz, bigint, text, text, jsonb, integer) is
  'Shared #627 full-state validator and audit diff. A real Group move needs an active target; same-Group edits retain the prior edit window even on archived Groups. Subtasks cannot move and Umbrellas with Subtasks cannot move. An existing Campaign incompatible with the target Group is normalized to null and included in the changed/before/after diff. R46: the Attached Links (p_links, normalized by private.require_attached_links at the caller''s step 1; an empty list clears them) are one field of the full state, named links in changed/before/after when they differ, and returned for the command to store. R57 (2026-10-14): p_min_level is the resolved Minimum Level (the caller''s step 4); a change by an actor below the stored or the new value is PT400 task_min_level_above_actor (raising, lowering or clearing it alike), an unchanged one is never judged; a change is the field min_level ("cine îl vede").';
revoke execute on function private.plan_task_update(public.tasks, bigint, text, text, timestamptz, bigint, text, text, jsonb, integer)
  from public, anon, authenticated, service_role;

create function private.task_update_consequences(p_task_id bigint, p_group_id bigint, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_min_level integer)
 RETURNS TABLE(consequence text, member_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with task as (
    select target.id, target.group_id, target.audience, target.assignment_mode,
           target.campaign_id, grp.min_level, grp.path, target.min_level as task_min_level
      from public.tasks as target
      join public.groups as grp on grp.id = p_group_id
     where target.id = p_task_id and target.kind = 'task'
  ),
  narrowed as (
    select task.* from task
     where p_assignment_mode = 'public' and p_audience = 'local'
       and task.audience is distinct from 'local'
  ),
  moving as (select * from task where group_id is distinct from p_group_id),
  -- R57: a raised Minimum Level (p_min_level is the resolved value).
  raised as (select * from task where p_min_level > task.task_min_level),
  removed_candidates as (
    select candidate.id, candidate.member_id, candidate.joined_at
      from task
      join public.task_candidates as candidate
        on candidate.task_id = task.id and candidate.status = 'pending'
     where (task.assignment_mode = 'public' and p_assignment_mode = 'direct')
        or (exists (select 1 from narrowed)
            and not private.is_group_member(p_group_id, candidate.member_id))
        or (exists (select 1 from moving)
            and coalesce(private.actor_level(candidate.member_id), -1) < task.min_level)
        or (exists (select 1 from raised)
            and coalesce(private.actor_level(candidate.member_id), -1) < p_min_level)
  ),
  active_executor as (
    select assignment.member_id, task.min_level
      from task join public.task_assignments as assignment
        on assignment.task_id = task.id and assignment.ended_at is null
  ),
  removed_executor as (
    select executor.member_id from active_executor executor
     where (exists (select 1 from moving)
            and coalesce(private.actor_level(executor.member_id), -1) < executor.min_level)
        or (not exists (select 1 from moving) and exists (select 1 from narrowed)
            and not private.is_group_member(p_group_id, executor.member_id))
        or (exists (select 1 from raised)
            and coalesce(private.actor_level(executor.member_id), -1) < p_min_level)
  ),
  added_executor as (
    select executor.member_id from active_executor executor
     where exists (select 1 from moving)
       and coalesce(private.actor_level(executor.member_id), -1) >= executor.min_level
       and not private.is_group_member(p_group_id, executor.member_id)
       and not (exists (select 1 from raised)
                and coalesce(private.actor_level(executor.member_id), -1) < p_min_level)
  ),
  cleared_campaign as (
    select null::uuid as member_id from moving
      join public.campaigns campaign on campaign.id = moving.campaign_id
     where p_campaign_id = moving.campaign_id
       and not moving.path @> array[campaign.group_id]
  ),
  consequences as (
    select 1 as rank, 'executor_added_to_group'::text as consequence,
           added_executor.member_id, null::timestamptz as joined_at, null::bigint as candidate_id
      from added_executor
    union all select 2, 'executor_removed', removed_executor.member_id, null, null from removed_executor
    union all select 3, 'candidate_removed', removed_candidates.member_id,
                     removed_candidates.joined_at, removed_candidates.id from removed_candidates
    union all select 4, 'campaign_cleared', cleared_campaign.member_id, null, null from cleared_campaign
  )
  select consequences.consequence, consequences.member_id from consequences
   order by consequences.rank, consequences.joined_at, consequences.candidate_id;
$function$;

comment on function private.task_update_consequences(bigint, bigint, bigint, text, text, integer) is
  'One shared #627 preview/command consequence definition. On a move: an eligible Executor outside the target roster is appointed; one below target Minimum Level loses the Assignment; pending Candidates below target Minimum Level leave the queue; an incompatible existing Campaign is cleared. Explicit Audience narrowing removes a non-member Executor and non-member Candidates; Public -> Direct closes every pending Candidature. No Candidate is ever promoted (#682): a removed Executor leaves the Task todo with its remaining queue intact for the manager to select from. Stable; no writes or locks. R57 (2026-10-14): p_min_level is the resolved Minimum Level; a raised one removes the pending Candidates and the active Executor below it, and an Executor it removes is not also appointed to a target Group.';
revoke execute on function private.task_update_consequences(bigint, bigint, bigint, text, text, integer)
  from public, anon, authenticated, service_role;

create or replace function private.task_field_labels(p_fields text[])
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  select coalesce(pg_catalog.string_agg(labelled.label, ', ' order by labelled.ord), 'detalii')
    from (
      select field.ord,
             case field.name
               when 'title'           then 'titlu'
               when 'description'     then 'descriere'
               when 'deadline'        then 'termen'
               when 'group_id'        then 'grup'
               when 'campaign_id'     then 'campanie'
               when 'audience'        then 'audiență'
               when 'assignment_mode' then 'atribuire'
               when 'link_label'      then 'etichetă link'
               when 'link_url'        then 'adresă link'
               when 'links'           then 'linkuri'
               when 'min_level'       then 'cine îl vede'
             end as label
        from pg_catalog.unnest(p_fields) with ordinality as field(name, ord)
    ) as labelled
   where labelled.label is not null;
$function$;


-- ==================== 8 · the edit commands ====================
create function private.preview_task_update_impl(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text, p_link_url text, p_links jsonb, p_min_level integer)
 RETURNS TABLE(consequence text, member_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_task public.tasks%rowtype;
  v_links jsonb;
  v_min_level integer;
begin
  -- R57: the ladder, malformed for every caller (the command's step 1 too).
  if p_min_level is not null and p_min_level not in (0, 1, 2, 3, 5, 6) then
    raise sqlstate 'PT400' using message = 'invalid_task_min_level';
  end if;
  -- #673 (R8) and #684 (R7), R46: the command's step 1, so preview and command agree.
  perform private.require_text_length('title',
    regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g'), 3, 120);
  perform private.require_text_length('description',
    regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 2000);
  v_links := private.require_attached_links(p_links, p_link_label, p_link_url);
  -- The command's gate, without its locks: a stable function takes none.
  perform private.require_task_visible(p_task_id);
  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  if not coalesce(private.can_manage_task(p_task_id), false) then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end if;
  if p_group_id is distinct from v_task.group_id and not coalesce(private.can_manage_group_work(p_group_id), false) then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  -- R46: an app version from before R46 sends only the pair (p_links not sent):
  -- it edits the first link it shows and keeps the others it cannot show.
  if p_links is null then
    v_links := v_links || case when jsonb_array_length(v_task.links) > 1
                               then v_task.links - 0 else '[]'::jsonb end;
  end if;
  -- R57: null keeps the stored Role; a direct Task or an Umbrella has none.
  v_min_level := case when v_task.kind = 'task' and p_assignment_mode = 'public'
                      then coalesce(p_min_level, v_task.min_level) else 0 end;
  perform private.plan_task_update(v_task, p_group_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience, v_links, v_min_level);
  return query
    select c.consequence, c.member_id
      from private.task_update_consequences(p_task_id, p_group_id, p_campaign_id, p_assignment_mode, p_audience, v_min_level) as c;
end;
$function$;

comment on function private.preview_task_update_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb, integer) is
  'Body behind public.preview_task_update (#626): the same step-1 checks as update_task (#673 lengths, R46 Attached Links), the same gate (PT404 task_not_found for an invisible Task, 42501 task_manage_forbidden for a non-manager), the same validation and refusals (private.plan_task_update), then the rows of private.task_update_consequences -- the one definition the command applies. Stable; writes and locks nothing. R57 (2026-10-14): p_min_level, the Task''s Minimum Level (null keeps it; a direct Task or an Umbrella is stored at 0; PT400 invalid_task_min_level off the ladder, task_min_level_above_actor when the editor is below the stored or the new value, a change to Direct included). Raising it removes the waiting Candidates and the Executor below it, as consequences to confirm (task_update_needs_confirmation).';

create function public.preview_task_update(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text DEFAULT NULL::text, p_link_url text DEFAULT NULL::text, p_links jsonb DEFAULT NULL::jsonb, p_min_level integer DEFAULT NULL::integer)
 RETURNS TABLE(consequence text, member_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select * from private.preview_task_update_impl(p_task_id, p_group_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience, p_link_label, p_link_url, p_links, p_min_level);
$function$;

comment on function public.preview_task_update(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb, integer) is
  'Lists public.update_task consequences for the same full state -- the Attached Links included (R46: p_links, or the legacy pair) -- without writes: executor_added_to_group, executor_removed, candidate_removed, and campaign_cleared (null member_id). No edit promotes a Candidate (#682). Refuses the same invalid state or authority. R57 (2026-10-14): p_min_level, the Task''s Minimum Level (null keeps it; a direct Task or an Umbrella is stored at 0; PT400 invalid_task_min_level off the ladder, task_min_level_above_actor when the editor is below the stored or the new value, a change to Direct included). Raising it removes the waiting Candidates and the Executor below it, as consequences to confirm (task_update_needs_confirmation).';

create function private.update_task_impl(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text, p_link_url text, p_accept_consequences boolean, p_links jsonb, p_min_level integer)
 RETURNS public.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_parent_id bigint;
  v_task public.tasks%rowtype;
  v_plan jsonb;
  v_links jsonb;
  v_consequences jsonb;
  v_removed_candidates uuid[];
  v_removed_executor uuid;
  v_added_executor uuid;
  v_campaign_id bigint;
  v_closed uuid[] := '{}'::uuid[];
  v_assignment_id bigint;
  v_executor uuid;
  v_mode_changed boolean;
  v_group_changed boolean;
  v_from public.task_status;
  v_to public.task_status;
  v_details jsonb;
  v_constraint text;
  v_min_level integer;
  v_old_min_level integer;
  v_removed_reason text;
begin
  -- R57: the ladder, malformed for every caller.
  if p_min_level is not null and p_min_level not in (0, 1, 2, 3, 5, 6) then
    raise sqlstate 'PT400' using message = 'invalid_task_min_level';
  end if;
  -- 1. #673 (R8): malformed for every caller, measured as stored (trimmed).
  --    No deadline_in_past here: R8 judges the deadline only at creation.
  perform private.require_text_length('title',
    regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g'), 3, 120);
  perform private.require_text_length('description',
    regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 2000);
  -- #684 (R7), R46: the Attached Links, normalized.
  v_links := private.require_attached_links(p_links, p_link_label, p_link_url);
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. The locks. This unlocked read only learns WHICH parent to lock first;
  --    every decision below is made from the locked rows. Both rows FOR NO
  --    KEY UPDATE, never FOR UPDATE (conventions section 2).
  select parent_task_id into v_parent_id from public.tasks where id = p_task_id;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  if v_parent_id is not null then
    perform 1 from public.tasks where id = v_parent_id for no key update;
    if not found then
      raise sqlstate 'PT404' using message = 'task_not_found';
    end if;
  end if;
  select * into v_task from public.tasks where id = p_task_id for no key update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock.
  perform private.require_task_manager(p_task_id);
  -- R46: an app version from before R46 sends only the pair (p_links not sent):
  -- it edits the first link it shows and keeps the others it cannot show.
  if p_links is null then
    v_links := v_links || case when jsonb_array_length(v_task.links) > 1
                               then v_task.links - 0 else '[]'::jsonb end;
  end if;
  -- R57: null keeps the stored Role; a direct Task or an Umbrella has none.
  v_old_min_level := v_task.min_level;
  v_min_level := case when v_task.kind = 'task' and p_assignment_mode = 'public'
                      then coalesce(p_min_level, v_task.min_level) else 0 end;
  if v_task.parent_task_id is distinct from v_parent_id then
    raise sqlstate 'PT409' using message = 'task_parent_changed';
  end if;
  if p_group_id is distinct from v_task.group_id then
    perform private.require_group_work_manager(p_group_id);
    perform 1 from public.groups grp
      where grp.id in (v_task.group_id, p_group_id)
      order by grp.id for no key update;
    perform private.require_group_work_manager(v_task.group_id);
    perform private.require_group_work_manager(p_group_id);
  end if;
  -- A move or a raised Role judges the queue's live Levels: hold them.
  if p_group_id is distinct from v_task.group_id or v_min_level > v_old_min_level then
    perform 1 from public.profiles profile
     where profile.id in (
       select assignment.member_id from public.task_assignments assignment
        where assignment.task_id = p_task_id and assignment.ended_at is null
       union
       select candidate.member_id from public.task_candidates candidate
        where candidate.task_id = p_task_id and candidate.status = 'pending')
     order by profile.id for share of profile;
  end if;
  -- 5 + 6. Input validation and state preconditions, shared with the preview.
  v_plan := private.plan_task_update(v_task, p_group_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience, v_links, v_min_level);
  -- Consequences, shared with the preview; none may apply unaccepted.
  select coalesce(jsonb_agg(jsonb_build_object('consequence', c.consequence, 'member_id', c.member_id)
                            order by c.ord), '[]'::jsonb)
    into v_consequences
    from private.task_update_consequences(p_task_id, p_group_id, p_campaign_id, p_assignment_mode, p_audience, v_min_level)
         with ordinality as c (consequence, member_id, ord);
  if jsonb_array_length(v_consequences) > 0 and not coalesce(p_accept_consequences, false) then
    raise sqlstate 'PT409' using message = 'task_update_needs_confirmation';
  end if;
  select coalesce(array_agg((e ->> 'member_id')::uuid) filter (where e ->> 'consequence' = 'candidate_removed'), '{}'::uuid[]),
         (array_agg((e ->> 'member_id')::uuid) filter (where e ->> 'consequence' = 'executor_removed'))[1],
         (array_agg((e ->> 'member_id')::uuid) filter (where e ->> 'consequence' = 'executor_added_to_group'))[1]
    into v_removed_candidates, v_removed_executor, v_added_executor
    from jsonb_array_elements(v_consequences) as e;
  v_campaign_id := (v_plan ->> 'campaign_id')::bigint;
  v_mode_changed := p_assignment_mode is distinct from v_task.assignment_mode;
  v_group_changed := p_group_id is distinct from v_task.group_id;

  if v_added_executor is not null then
    perform private.appoint_group_member(p_group_id, v_added_executor, v_actor);
  end if;
  -- 7. Mutate. Candidatures first: close_task_queue must run while the Task
  --    is still public (it is a no-op otherwise).
  if v_task.assignment_mode = 'public' and p_assignment_mode = 'direct' then
    v_closed := private.close_task_queue(p_task_id, v_actor);
  elsif cardinality(v_removed_candidates) > 0 then
    with closed as (
      update public.task_candidates as candidate
         set status = 'closed', decided_at = now(), decided_by = v_actor
       where candidate.task_id = p_task_id
         and candidate.status = 'pending'
         and candidate.member_id = any (v_removed_candidates)
      returning candidate.member_id)
    select coalesce(array_agg(closed.member_id), '{}'::uuid[]) into v_closed from closed;
  end if;
  -- A removed Executor leaves the Task todo; the remaining queue is left
  -- exactly as it is for the manager to select from (#682, R9).
  if v_removed_executor is not null then
    select assignment.id into v_assignment_id
      from public.task_assignments as assignment
     where assignment.task_id = p_task_id and assignment.ended_at is null
       and assignment.member_id = v_removed_executor
     for update;
    -- Final review of R57: the reason is the removed Executor's own, read on
    -- the live Level the FOR SHARE hold above keeps still -- a move only
    -- removes one below the target Group, a raise one below the new Role,
    -- and anything else is the narrower Audience.
    v_removed_reason := case
      when v_group_changed
           and coalesce(private.actor_level(v_removed_executor), -1)
               < (select grp.min_level from public.groups as grp where grp.id = p_group_id)
        then 'group'
      when v_min_level > v_old_min_level
           and coalesce(private.actor_level(v_removed_executor), -1) < v_min_level
        then 'role'
      else 'audience'
    end;
    perform private.end_task_assignment(v_assignment_id,
      case when v_removed_reason = 'group' then 'group_changed' else 'task_updated' end, null);
    if v_task.status <> 'todo' then
      v_from := v_task.status;
      v_to := 'todo';
    end if;
  end if;
  begin
    update public.tasks
       set title = v_plan ->> 'title',
           description = v_plan ->> 'description',
           deadline = p_deadline,
           campaign_id = v_campaign_id,
           group_id = p_group_id,
           audience = p_audience,
           assignment_mode = p_assignment_mode,
           links = v_plan -> 'links',
           min_level = v_min_level,
           queue_opened_at = case
             when v_mode_changed then case when p_assignment_mode = 'public' then now() end
             else queue_opened_at
           end,
           queue_closed_at = case when v_mode_changed then null else queue_closed_at end,
           status = case when v_removed_executor is not null then 'todo'::public.task_status else status end,
           started_at = case when v_removed_executor is not null then null else started_at end
     where id = p_task_id
    returning * into v_task;
  exception
    when foreign_key_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'tasks_campaign_id_fkey' then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
    when check_violation then
      -- private.validate_task_campaign raises 23514 with exactly these two
      -- reasons (update_task_content precedent); any other 23514 propagates.
      if sqlerrm in ('task_campaign_origin_mismatch', 'task_campaign_inactive') then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
  end;
  v_details := jsonb_build_object('changed', v_plan -> 'changed', 'before', v_plan -> 'before',
    'after', v_plan -> 'after', 'consequences', v_consequences);
  if v_assignment_id is not null then
    v_details := v_details || jsonb_build_object('ended_assignment_id', v_assignment_id);
  end if;
  perform private.log_task_activity(p_task_id, 'task_updated', v_actor, null, v_from, v_to, null, v_details);

  -- Notifications.
  perform private.notify(v_closed, 'task'::public.noti_kind,
    'Coadă închisă: ' || v_task.title,
    'Nu mai poți fi selectat pentru acest task.',
    p_task_id, null, v_actor);
  if v_removed_executor is not null then
    perform private.notify(array[v_removed_executor], 'task'::public.noti_kind,
      'Task actualizat: ' || v_task.title,
      case v_removed_reason
        when 'group'
        then 'Taskul a fost mutat într-un grup pentru care nu ești eligibil.'
        when 'role'
        then 'Nu mai ești executorul acestui task: e acum doar pentru '
             || (select role.name from public.roles as role where role.level = v_min_level)
             || ' și peste.'
        else 'Nu mai ești executorul acestui task: audiența lui s-a schimbat.' end,
      p_task_id, null, v_actor);
  end if;
  select assignment.member_id into v_executor
    from public.task_assignments as assignment
   where assignment.task_id = p_task_id and assignment.ended_at is null;
  -- R53: a Campaign is a label; a change of the Campaign alone tells nobody.
  if v_executor is not null
     and exists (select 1 from jsonb_array_elements_text(v_plan -> 'changed') as field(name)
                  where field.name <> 'campaign_id') then
    perform private.notify(array[v_executor], 'task'::public.noti_kind,
      'Task actualizat: ' || v_task.title,
      'Modificat: ' || private.task_field_labels(array(select jsonb_array_elements_text(v_plan -> 'changed'))) || '.',
      p_task_id, null, v_actor);
  end if;
  return v_task;
end;
$function$;

comment on function private.update_task_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb, integer) is
  'Atomic #627 full-state Task update. Locks Umbrella then Task FOR NO KEY UPDATE; for a move, authorizes both Groups, locks both Groups in ID order, rechecks authority, and holds Executor/Candidate Profiles FOR SHARE before applying the shared consequence plan. PT409 task_update_needs_confirmation protects every listed consequence. Uses the #583 Appointment core, ends an ineligible Assignment (group_changed on a move, task_updated on Audience narrowing) and returns the Task to todo, closes ineligible Candidatures, clears an incompatible Campaign, and logs one task_updated activity with the accepted consequences and field diff. No Candidate is ever promoted (#682): the remaining queue stays pending for the manager to select from. R46: the Attached Links are part of the full state (p_links, a sent empty list clears them), judged at step 1 by private.require_attached_links. From an app version before R46, which sends only the pair p_link_label + p_link_url (p_links null), the pair replaces the first link and the others are kept, so an old app never deletes links it cannot show. R57 (2026-10-14): p_min_level, the Task''s Minimum Level (null keeps it; a direct Task or an Umbrella is stored at 0; PT400 invalid_task_min_level off the ladder, task_min_level_above_actor when the editor is below the stored or the new value, a change to Direct included). Raising it removes the waiting Candidates and the Executor below it, as consequences to confirm (task_update_needs_confirmation).';

create function public.update_task(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text DEFAULT NULL::text, p_link_url text DEFAULT NULL::text, p_accept_consequences boolean DEFAULT false, p_links jsonb DEFAULT NULL::jsonb, p_min_level integer DEFAULT NULL::integer)
 RETURNS public.tasks
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.update_task_impl(p_task_id, p_group_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience, p_link_label, p_link_url, p_accept_consequences, p_links, p_min_level);
$function$;

comment on function public.update_task(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb, integer) is
  'Sets every editable field, including Group and the Attached Links (R46: p_links, up to five, full state -- a sent empty list clears them; p_links not sent (null) is an app version from before R46: p_link_label + p_link_url, kept for one release, replace the first link and the others are kept), at once while todo or in_progress. A real Group move requires authority over source and target. Consequences require explicit acceptance after public.preview_task_update. R57 (2026-10-14): p_min_level, the Task''s Minimum Level (null keeps it; a direct Task or an Umbrella is stored at 0; PT400 invalid_task_min_level off the ladder, task_min_level_above_actor when the editor is below the stored or the new value, a change to Direct included). Raising it removes the waiting Candidates and the Executor below it, as consequences to confirm (task_update_needs_confirmation).';

revoke execute on function private.preview_task_update_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.preview_task_update(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb, integer)
  from public, anon, authenticated, service_role;
revoke execute on function private.update_task_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.update_task(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.preview_task_update_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb, integer) to authenticated;
grant execute on function public.preview_task_update(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb, integer) to authenticated;
grant execute on function private.update_task_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb, integer) to authenticated;
grant execute on function public.update_task(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb, integer) to authenticated;

-- ==================== 9 · the list readers carry the Role ====================
-- A new column changes the RETURNS TABLE, so each is dropped and recreated
-- from main's latest body with min_level beside audience.
drop function public.task_list(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer);
drop function private.task_list_impl(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer);
drop function public.leadership_member_tasks(uuid, timestamptz, timestamptz);
drop function private.leadership_member_tasks_impl(uuid, timestamptz, timestamptz);

create function private.task_list_impl(p_list text, p_finished boolean, p_group_id bigint, p_campaign_id bigint, p_from timestamp with time zone, p_to timestamp with time zone, p_state text, p_search text, p_preferred boolean, p_sort text, p_limit integer, p_offset integer)
 RETURNS TABLE(id bigint, group_id bigint, title text, description text, status public.task_status, deadline timestamp with time zone, completed_at timestamp with time zone, review_round integer, assignment_mode text, audience text, min_level integer, kind text, parent_task_id bigint, campaign_id bigint, duplicated_from_task_id bigint, queue_closed_at timestamp with time zone, links jsonb, assignments jsonb, evaluations jsonb, submission jsonb, executor jsonb, my_candidature text, total bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.require_task_list_args(p_list, p_finished, p_state, p_sort, p_limit, p_offset);
  select private.require_date_range(p_from, p_to);

  with reader as materialized (
    -- Who embeds what. A leadership list's caller reads every row of these
    -- tables; for the Member's lists the read policies decide: own rows,
    -- every row from level 5 up (private.is_global_task_reader), or on a Task
    -- the caller manages (private.can_manage_task, as the managed scope).
    select (select auth.uid()) as id,
           p_list in ('managed', 'all')
           or coalesce((select private.actor_level()) >= 5, false) as whole
  ),
  managed as materialized (
    select scope.task_id
      from private.task_list_scope('managed') as scope
     where p_list in ('mine', 'available')
       and not (select reader.whole from reader)
  ),
  muted as (
    -- R43: the Groups the caller unselected that private.group_muted_for
    -- still honours, for the preferred view of a leadership list only; it
    -- never narrows the Member's own lists.
    select unselected.group_id
      from public.member_group_unselected as unselected
     where coalesce(p_preferred, false)
       and p_list in ('managed', 'all')
       and unselected.member_id = (select auth.uid())
       and private.group_muted_for(unselected.group_id, unselected.member_id)
  ),
  needle as (
    select private.fold_search(btrim(coalesce(p_search, ''))) as value
  ),
  matched as (
    select task.id, task.group_id, task.title, task.description, task.status, task.deadline,
           task.completed_at, task.review_round, task.assignment_mode, task.audience, task.min_level, task.kind,
           task.parent_task_id, task.campaign_id, task.duplicated_from_task_id,
           task.queue_closed_at, task.links,
           task.status in ('completed', 'unfulfilled', 'cancelled') as finished
      from private.task_list_scope(p_list) as scope
      join public.tasks as task on task.id = scope.task_id
      join public.groups as task_group on task_group.id = task.group_id
     cross join needle
     where (p_finished is null
            or (task.status in ('completed', 'unfulfilled', 'cancelled')) = p_finished)
       -- The Work Filter (#677): the Group subtree, the exact Campaign, and
       -- the deadline in [p_from, p_to), so an undated Task is outside any range.
       and (p_group_id is null or task_group.path @> array[p_group_id])
       and (p_campaign_id is null or task.campaign_id = p_campaign_id)
       and (p_from is null or task.deadline >= p_from)
       and (p_to is null or task.deadline < p_to)
       and (p_state is null
            or case p_state
                 when 'late' then task.status = 'completed' and task.completed_at > task.deadline
                 else task.status::text = p_state
               end)
       and (needle.value = '' or strpos(private.fold_search(task.title), needle.value) > 0)
       and task.group_id not in (select muted.group_id from muted)
  ),
  placed as (
    -- Open Tasks first, soonest deadline first; then finished ones, newest
    -- deadline first; undated last in both. A title sort leads inside each
    -- part; the Member's lists also break an equal deadline by the title,
    -- as their pages did. The id ends every tie, so a page boundary never
    -- wobbles.
    select matched.*,
           count(*) over () as total,
           row_number() over (
             order by matched.finished,
                      (case when p_sort = 'title' then matched.title end) collate pg_catalog."ro-x-icu",
                      (case when not matched.finished then matched.deadline end) asc nulls last,
                      (case when matched.finished then matched.deadline end) desc nulls last,
                      (case when not matched.finished and p_list in ('mine', 'available')
                            then matched.title end) collate pg_catalog."ro-x-icu",
                      (case when matched.finished then -matched.id else matched.id end)) as place
      from matched
  ),
  page as (
    select placed.* from placed order by placed.place limit p_limit offset p_offset
  )
  select page.id, page.group_id, page.title, page.description, page.status, page.deadline,
         page.completed_at, page.review_round, page.assignment_mode, page.audience, page.min_level, page.kind,
         page.parent_task_id, page.campaign_id, page.duplicated_from_task_id,
         page.queue_closed_at, page.links,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', held.id, 'member_id', held.member_id, 'ended_at', held.ended_at)
                    order by held.id)
             from public.task_assignments as held
            where held.task_id = page.id
              and (   (select reader.whole from reader)
                   or held.member_id = (select reader.id from reader)
                   or page.id in (select managed.task_id from managed))), '[]'::jsonb),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', evaluation.id, 'difficulty', evaluation.difficulty,
                    'rating', evaluation.rating, 'points', evaluation.points,
                    'reversed_at', evaluation.reversed_at)
                    order by evaluation.id)
             from public.task_evaluations as evaluation
            where evaluation.task_id = page.id
              and (   (select reader.whole from reader)
                   or evaluation.evaluated_by = (select reader.id from reader)
                   or exists (select 1 from public.task_assignments as own
                               where own.id = evaluation.assignment_id
                                 and own.member_id = (select reader.id from reader))
                   or page.id in (select managed.task_id from managed))), '[]'::jsonb),
         -- The latest `submitted` history row the caller reads: the
         -- Submission Note (#685).
         coalesce((
           select jsonb_build_array(jsonb_build_object(
                    'id', event.id, 'kind', event.kind, 'note', event.note,
                    'details', event.details, 'occurred_at', event.occurred_at))
             from public.task_activity as event
            where event.task_id = page.id
              and event.kind = 'submitted'
              and (   (select reader.whole from reader)
                   or event.actor_id = (select reader.id from reader)
                   or exists (select 1 from public.task_assignments as own
                               where own.id = event.assignment_id
                                 and own.member_id = (select reader.id from reader))
                   or page.id in (select managed.task_id from managed)
                   or private.is_task_team_member(page.id))
            order by event.id desc
            limit 1), '[]'::jsonb),
         -- The Executor, by the rule of private.visible_task_executors (#499,
         -- #861): the open Assignment of an open Task, or the latest Assignment
         -- the Evaluation of a completed or unfulfilled Task ended; none otherwise.
         (select jsonb_build_object(
                   'member_id', executor.member_id, 'full_name', profile.full_name,
                   'nickname', profile.nickname, 'is_current', executor.is_current)
            from (select held.member_id, held.ended_at is null as is_current
                    from public.task_assignments as held
                   where held.task_id = page.id
                     and ((held.ended_at is null
                           and page.status not in ('completed', 'unfulfilled', 'cancelled'))
                          or (page.status in ('completed', 'unfulfilled')
                              and held.end_reason in ('completed', 'failed')))
                   order by held.ended_at desc nulls first, held.id desc
                   limit 1) as executor
            left join public.profiles as profile on profile.id = executor.member_id),
         (select candidature.status
            from public.task_candidates as candidature
           where candidature.task_id = page.id
             and candidature.member_id = (select reader.id from reader)
           order by candidature.id desc
           limit 1),
         page.total
    from page
   order by page.place;
$function$;
comment on function private.task_list_impl(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer) is
  'Body of public.task_list. The rows are private.task_list_scope(p_list), narrowed by the Work Filter on the Task itself (Group subtree, Campaign, deadline in [p_from, p_to)), a finished state, the folded title search and -- p_preferred, R43, leadership lists only -- the Groups the caller keeps selected; ordered open first then finished newest first (the Member''s lists break an equal deadline of an open Task by its title); cut by p_limit and p_offset with the unpaged count in total. Each row carries its Assignment History, its Evaluations, its latest submission and its Executor -- whole for the leadership lists, whose callers read every row; for mine and available exactly the rows the read policies of those tables give the caller -- and my_candidature, the status of the caller''s newest Candidature on it. R57 (2026-10-14): each row carries the Task''s min_level (its Minimum Level), so a form opened from it shows the real Role.';

create function public.task_list(p_list text, p_finished boolean DEFAULT NULL::boolean, p_group_id bigint DEFAULT NULL::bigint, p_campaign_id bigint DEFAULT NULL::bigint, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_state text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_preferred boolean DEFAULT false, p_sort text DEFAULT 'deadline'::text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0)
 RETURNS TABLE(id bigint, group_id bigint, title text, description text, status public.task_status, deadline timestamp with time zone, completed_at timestamp with time zone, review_round integer, assignment_mode text, audience text, min_level integer, kind text, parent_task_id bigint, campaign_id bigint, duplicated_from_task_id bigint, queue_closed_at timestamp with time zone, links jsonb, assignments jsonb, evaluations jsonb, submission jsonb, executor jsonb, my_candidature text, total bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select *
    from private.task_list_impl(
           p_list, p_finished, p_group_id, p_campaign_id, p_from, p_to,
           p_state, p_search, p_preferred, p_sort, p_limit, p_offset);
$function$;
comment on function public.task_list(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer) is
  'A page of a Task list, ready to draw, in one request. p_list: managed (the Tasks the caller manages, exactly my_managed_task_ids()), all (every Task the caller reads, from level 5 up), mine (Taskurile mele: the Tasks the caller holds or held to the end) or available (Disponibile: the open public Opportunities the caller reads and the Tasks of their pending Candidatures; no finished part). p_finished: true the finished Tasks, false the open ones, null both. The Work Filter reads the Task: p_group_id that Group and every Group below it, p_campaign_id exact, the deadline in [p_from, p_to). p_state: completed, unfulfilled, cancelled, or late (completed after its deadline). p_search: the title contains it, case and diacritics ignored. p_preferred (R43): without the Groups the caller unselected, for managed and all. Order: open first by deadline ascending (mine and available then by title), then finished by deadline descending, undated last; p_sort title leads with the title inside each part. p_limit 1..500 and p_offset cut the page; total is the count before the cut. my_candidature: the caller''s newest Candidature status on the Task, or null. PT400 invalid_list, invalid_state, invalid_sort, invalid_page, invalid_date_range. No rows without org claims or a live activ Profile. R57 (2026-10-14): each row carries the Task''s min_level (its Minimum Level), so a form opened from it shows the real Role.';

create function private.leadership_member_tasks_impl(p_member_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(assignment_id bigint, member_id uuid, assigned_at timestamp with time zone, assigned_by uuid, assignment_ended_at timestamp with time zone, assignment_end_reason text, assignment_end_note text, task_id bigint, title text, description text, link_label text, link_url text, links jsonb, deadline timestamp with time zone, task_kind text, audience text, min_level integer, assignment_mode text, status public.task_status, is_overdue boolean, completed_late boolean, difficulty integer, rating integer, started_at timestamp with time zone, submitted_at timestamp with time zone, review_round integer, returned_to_progress_at timestamp with time zone, completed_at timestamp with time zone, unfulfilled_at timestamp with time zone, cancelled_at timestamp with time zone, cancel_reason text, queue_opened_at timestamp with time zone, queue_closed_at timestamp with time zone, task_created_at timestamp with time zone, task_created_by uuid, duplicated_from_task_id bigint, group_id bigint, group_name text, campaign_id bigint, campaign_name text, parent_task_id bigint, parent_task_title text, subtasks jsonb, evaluation_history jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.require_date_range(p_from, p_to);

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
         task.link_label,
         task.link_url,
         task.links,
         task.deadline,
         task.kind,
         task.audience,
         task.min_level,
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
     and (p_from is null or task.deadline >= p_from)
     and (p_to is null or task.deadline < p_to)
     and private.can_see_group(task.group_id, (select auth.uid()))
   order by assignment.assigned_at desc, assignment.id desc;
$function$;
comment on function private.leadership_member_tasks_impl(uuid, timestamptz, timestamptz) is
  'One row per selected Member Assignment, newest first, labelled by the Task''s owning Group and carrying the Task''s Attached Links (#947; R46: links, with the legacy link_label / link_url = links[0] for one release), optionally narrowed to Task deadlines in [p_from, p_to) (#677); PT400 invalid_date_range first when p_to < p_from. A Task whose Group the caller cannot see (private.can_see_group, #756/#759) is omitted, so a BCE drilling into a Member never learns of their work in a Private Group; BC/Moderator see every row. R57 (2026-10-14): each row carries the Task''s min_level (its Minimum Level), so a form opened from it shows the real Role.';

create function public.leadership_member_tasks(p_member_id uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(assignment_id bigint, member_id uuid, assigned_at timestamp with time zone, assigned_by uuid, assignment_ended_at timestamp with time zone, assignment_end_reason text, assignment_end_note text, task_id bigint, title text, description text, link_label text, link_url text, links jsonb, deadline timestamp with time zone, task_kind text, audience text, min_level integer, assignment_mode text, status public.task_status, is_overdue boolean, completed_late boolean, difficulty integer, rating integer, started_at timestamp with time zone, submitted_at timestamp with time zone, review_round integer, returned_to_progress_at timestamp with time zone, completed_at timestamp with time zone, unfulfilled_at timestamp with time zone, cancelled_at timestamp with time zone, cancel_reason text, queue_opened_at timestamp with time zone, queue_closed_at timestamp with time zone, task_created_at timestamp with time zone, task_created_by uuid, duplicated_from_task_id bigint, group_id bigint, group_name text, campaign_id bigint, campaign_name text, parent_task_id bigint, parent_task_title text, subtasks jsonb, evaluation_history jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select * from private.leadership_member_tasks_impl(p_member_id, p_from, p_to);
$function$;
comment on function public.leadership_member_tasks(uuid, timestamptz, timestamptz) is
  'Live BCE+ Assignment history with the owning Group''s id and name, the Task''s Attached Links (links; R46 -- link_label, link_url = the first, kept for one release; #947), plus Task and Evaluation history. The date range (#677, R11) keeps only Assignments whose Task deadline is in [p_from, p_to); a Task with no deadline is excluded whenever either bound is set. PT400 invalid_date_range when p_to < p_from. Assignments of a Task in a Private Group the caller cannot see are omitted (#759, ruling R25). R57 (2026-10-14): each row carries the Task''s min_level (its Minimum Level), so a form opened from it shows the real Role.';

revoke execute on function private.task_list_impl(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.task_list(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer)
  from public, anon, authenticated, service_role;
revoke execute on function private.leadership_member_tasks_impl(uuid, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
revoke execute on function public.leadership_member_tasks(uuid, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.task_list_impl(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer) to authenticated;
grant execute on function public.task_list(text, boolean, bigint, bigint, timestamptz, timestamptz, text, text, boolean, text, integer, integer) to authenticated;
grant execute on function private.leadership_member_tasks_impl(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.leadership_member_tasks(uuid, timestamptz, timestamptz) to authenticated;

-- ==================== 10 · the Member's Available list follows the read rule ====================
-- #1065 copied tasks_read's test into task_list_scope('available'); it
-- takes the same 'shared' split and Minimum Level row test as the policy
-- (section 3), restated from #1065's body (20261014210000_member_task_lists.sql).
create or replace function private.task_list_scope(p_list text)
 RETURNS TABLE(task_id bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- One row for a caller with org claims and a live activ Profile; none
  -- otherwise, which empties everything below (no rows, never an error).
  with caller as materialized (
    select (select auth.uid()) as id, level.value as level
      from (select private.actor_level() as value) as level
     where coalesce(public.auth_is_member(), false)
       and level.value is not null
  ),
  -- Each Group judged once, by the helpers the per-Task rules call.
  --   managed: `listed` is can_manage_group_work; `whole` is the part of
  --     private.can_manage_task that does not read the Executor (level 6 up,
  --     a Group Manager on the path, or no Manager anywhere on it).
  --   all: `listed` is rule R1 of private.can_read_task (level 5 up and a
  --     Group the caller can see); nothing below level 5.
  judged as materialized (
    select grp.id,
           case p_list
             when 'managed' then private.can_manage_group_work(grp.id)
             when 'all' then caller.level >= 5 and private.can_see_group(grp.id, caller.id)
             else false
           end as listed,
           case
             when p_list <> 'managed' then true
             when caller.level >= 6 then true
             else private.group_role_of(grp.id, caller.id) = 'manager'
                  or not private.has_group_manager(grp.id)
           end as whole
      from caller
     cross join public.groups as grp
     where p_list in ('managed', 'all')
  )
  select task.id
    from judged
    join public.tasks as task on task.group_id = judged.id
   where case p_list
           -- A Task of a listed Group is managed when the Group is whole or
           -- nobody executes it (what can_manage_task answers there); any
           -- other Task of a listed Group is asked of can_manage_task itself.
           when 'managed' then
             judged.listed
             and (judged.whole
                  or not exists (select 1 from public.task_assignments as held
                                  where held.task_id = task.id and held.ended_at is null)
                  or private.can_manage_task(task.id))
           -- Outside a listed Group a Task is still read through the caller's
           -- own Assignment or Candidature: can_read_task decides.
           when 'all' then
             (select caller.level from caller) >= 5
             and (judged.listed or private.can_read_task(task.id))
           else false
         end
  union all
  -- mine: the newest own Assignment of each Task decides; leaving it (given
  -- up, replaced, taken off by an edit or a change of Group) drops the Task.
  -- An own Assignment is always readable (R2).
  select own.task_id
    from (select distinct on (assignment.task_id) assignment.task_id, assignment.end_reason
            from caller
            join public.task_assignments as assignment on assignment.member_id = caller.id
           where p_list = 'mine'
           order by assignment.task_id, assignment.assigned_at desc, assignment.id desc) as own
   where coalesce(own.end_reason, '') not in ('gave_up', 'replaced', 'task_updated', 'group_changed')
  union all
  -- available: an open public Opportunity tasks_read gives the caller (the
  -- same sets, the same test -- since R57 R4 in 'shared', and 'shared',
  -- 'open' and 'org' only at or above the Task's own Minimum Level), and the
  -- Tasks of their pending Candidatures, read through R2 whatever their queue.
  select open_work.id
    from (select task.id
            from caller
           cross join public.tasks as task
           where p_list = 'available'
             and task.kind = 'task'
             and task.assignment_mode = 'public'
             and task.queue_closed_at is null
             and task.status in ('todo', 'in_progress', 'in_review')
             and (   task.id = any ((select private.own_task_ids())::bigint[])
                  or task.parent_task_id = any ((select private.own_task_ids())::bigint[])
                  or task.group_id = any ((select private.task_read_groups('whole'))::bigint[])
                  or (    task.min_level <= (select private.caller_level())
                      and (   task.group_id = any ((select private.task_read_groups('shared'))::bigint[])
                           or task.group_id = any ((select private.task_read_groups('open'))::bigint[])
                           or (    task.audience = 'org'
                               and task.group_id = any ((select private.task_read_groups('org'))::bigint[])))))
          union
          select task.id
            from caller
            join public.task_candidates as candidature on candidature.member_id = caller.id
            join public.tasks as task on task.id = candidature.task_id
           where p_list = 'available'
             and candidature.status = 'pending'
             and task.kind = 'task'
             and task.assignment_mode = 'public') as open_work;
$function$;
comment on function private.task_list_scope(text) is
  'The Tasks of a Task list for the caller. Leadership lists, authority decided once per Group: ''managed'' is exactly public.my_managed_task_ids() (private.can_manage_task, which implies tasks_read), ''all'' is exactly what tasks_read returns from level 5 up and nothing below; private.can_manage_task and private.can_read_task remain the per-Task fallback for the rows a Group cannot decide. The Member''s lists (spec 2026-10-14 member reads): ''mine'' is every Task whose newest Assignment of the caller did not end in gave_up, replaced, task_updated or group_changed; ''available'' is every open public Task of kind task with an open queue that tasks_read gives the caller (private.own_task_ids and private.task_read_groups, as the policy reads them), plus every public Task of kind task the caller is a pending Candidate on. No rows without org claims or a live activ Profile, or for any other list. R57 (2026-10-14): ''available'' reads R4 through task_read_groups(''shared'') and, like tasks_read, takes ''shared'', ''open'' and ''org'' only at or above the Task''s own Minimum Level.';
