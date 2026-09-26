-- #794: Task visibility follows the Task Audience (ruling R26; ADR-0007 amended 2026-09-25).
--
-- A Member sees the Tasks of their own Groups with a member's visibility; the
-- Group Managers and Responsibles on the path, Shared Work Visibility and
-- BCE/BC/Moderator read as before. From any other Group a Member sees only
-- open public Tasks whose Audience is organization-wide (`org`), and every
-- active Member may see and join those with no Minimum Level gate. A local
-- Opportunity of a Group the Member is not in is invisible again -- the
-- 2026-09-23 amendment (#683, ruling R10: "every open Opportunity is visible
-- at its Group's Minimum Level, whatever its Audience") is superseded.
--
-- 1. private.can_read_task: the R6 arm splits in two. The own-Group
--    Opportunity (any Audience) needs private.is_group_member -- the test the
--    join already applies -- and stays inside the Minimum Level gate. The org
--    Opportunity leaves the Minimum Level gate but stays inside
--    private.can_see_group, so a legacy `org` row in a Private Group (R25)
--    stays hidden from outsiders.
-- 2. groups_read gains one limb, private.has_open_org_opportunity: a Group
--    above the caller's Minimum Level is readable while it owns an open `org`
--    Opportunity, so that Opportunity's card still names its Group.
-- 3. A directly assigned Task carries the local Audience: create_task,
--    update_task / preview_task_update (plan_task_update) and convert_task_mode
--    refuse `direct` + `org` with PT400 direct_task_local_only; convert_task_mode
--    also gains R25's PT400 private_group_local_only, which it never had;
--    duplicate_task writes a direct source's copy as local. Existing `direct` +
--    `org` rows are corrected in place.
-- 4. express_task_interest is unchanged (`org` admits every Member who can
--    read the Task; `local` needs private.is_group_member, 42501
--    task_audience_forbidden); only its comments lose the "Other Opportunity"
--    wording.
--
-- Every body below is rebuilt from main's latest definition, cited above each
-- one. Same signatures, so grants and the policies that call them stand.

-- ==================== 1 · private.can_read_task ====================
-- Rebuilt from 20260924132724_private_groups.sql:153-215 (#759 did not re-issue it).

create or replace function private.can_read_task(p_task_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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
  -- Audience. R7 judged on the Task and its Umbrella.
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
                    and task.status not in ('completed', 'unfulfilled', 'cancelled'))
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
                    or exists (select 1 from public.groups as shared
                                where grp.path @> array[shared.id]
                                  and shared.shared_work_visibility
                                  and (exists (select 1 from public.group_members as gm
                                                where gm.group_id = shared.id and gm.member_id = caller.id)
                                       or (shared.automatic_membership and caller_role.level >= shared.min_level)))
                    or (task.kind = 'task'
                        and task.assignment_mode = 'public'
                        and task.queue_closed_at is null
                        and task.status not in ('completed', 'unfulfilled', 'cancelled')
                        and private.is_group_member(grp.id, caller.id))
                  )
                )
              )
            )
          ));
$$;

comment on function private.can_read_task(bigint) is
  'ADR-0007 as amended 2026-09-25 (ruling R26, #794) on ADR-0009 R1-R7: own Assignments and Candidatures (ever); then, for a Group the caller can see (private.can_see_group): BCE/BC/Moderator; every open organization-wide Opportunity (Audience org, public, queue open, not terminal) for every active Member with no Minimum Level gate; and, subject to the Group''s Minimum Level unless the caller holds a Group Role on the path: Group Managers and Responsibles on the path, Shared Work Visibility, and the open Opportunities of a Group the caller is a member of (private.is_group_member), any Audience. A local Opportunity of a Group the caller is not in is invisible. Also applies to the Umbrella. Direct Tasks, Umbrellas, closed queues and terminal Tasks stay hidden from non-participants whatever their Audience.';

comment on policy tasks_read on public.tasks is
  'ADR-0007 Task visibility (#318, #794), defined once in private.can_read_task: own Assignments (current or ended) and Candidatures; live BCE/BC/Moderator; every open, unfinished public Opportunity whose Audience is org, for every active Member; Group Managers and Responsibles on the path; Shared Work Visibility; the open Opportunities of the caller''s own Groups; and a Subtask whenever its Umbrella is readable. A Private Group''s Tasks reach only those who can see the Group, own work excepted.';

-- ==================== 2 · groups_read: the org-Opportunity limb ====================

create function private.has_open_org_opportunity(p_group_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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
  );
$$;

comment on function private.has_open_org_opportunity(bigint) is
  'The groups_read limb of #794 (ruling R26): true while an active, non-private Group owns an open organization-wide Opportunity (kind task, Audience org, public, queue open, not terminal) -- the rows private.can_read_task shows every active Member with no Minimum Level gate. It lets such an Opportunity''s card name and colour its Group for a Member below the Group''s Minimum Level; it stays behind groups_read''s auth_is_member() and can_see_group gates. Policy predicate: authenticated may execute it.';

revoke execute on function private.has_open_org_opportunity(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.has_open_org_opportunity(bigint) to authenticated;

-- Rebuilt from 20260924132724_private_groups.sql:74-83: the existing limbs
-- unchanged behind the Private Group gate, plus the org-Opportunity limb.
alter policy groups_read on public.groups
  using (
    auth_is_member()
    and private.can_see_group(id, (select auth.uid()))
    and (((status = 'active') and ((select private.caller_level()) >= min_level))
         or ((select private.caller_level()) >= 5)
         or private.can_read_group_roster(id)
         or private.has_pending_group_application(id)
         -- A live Member only, like can_read_task's org arm (caller.status =
         -- 'activ'): caller_level() is -1 for a deactivated one whose token
         -- still carries claims.
         or (((select private.caller_level()) >= 0) and private.has_open_org_opportunity(id)))
  );

comment on policy groups_read on public.groups is
  'An active Member reads an active Group at or above their live level; a Group Manager or Responsible of the Group or of any ancestor reads it whatever their rank; rank BCE and above read every Group, archived ones included; an applicant reads a Group while their own Application on it is pending (#584, ruling R17); and every live active Member reads an active Group while it owns an open organization-wide Opportunity (#794, ruling R26, private.has_open_org_opportunity), so that Opportunity''s card names its Group. A Private Group reads only for those who can see it (private.can_see_group, #756).';

-- ==================== 3 · a direct Task carries the local Audience ====================

-- #794: create_task_impl -- rebuilt from 20260924132724_private_groups.sql:488.
CREATE OR REPLACE FUNCTION private.create_task_impl(p_title text, p_description text, p_deadline timestamp with time zone, p_audience text, p_assignment_mode text, p_executor_id uuid, p_campaign_id bigint, p_parent_task_id bigint, p_kind text, p_group_id bigint, p_link_label text, p_link_url text)
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
  v_link_label text;
  v_link_url text;
  v_task public.tasks%rowtype;
  v_constraint text;
begin
  if p_kind is null or p_kind not in ('task', 'umbrella') then
    raise sqlstate 'PT400' using message = 'invalid_task_kind';
  end if;
  -- #673 (R8): malformed for every caller, measured as stored (trimmed).
  perform private.require_text_length('title',
    regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g'), 3, 120);
  perform private.require_text_length('description',
    regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 2000);
  if p_deadline < now() then
    raise sqlstate 'PT400' using message = 'deadline_in_past';
  end if;
  -- #684 (R7): the Attached Link, trimmed, blank -> null, judged before the gate.
  v_link_label := nullif(regexp_replace(coalesce(p_link_label, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_link_url := nullif(regexp_replace(coalesce(p_link_url, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_attached_link(v_link_label, v_link_url);
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
  begin
    insert into public.tasks (title, description, deadline, group_id,
                              audience, assignment_mode, campaign_id, parent_task_id, kind,
                              status, created_by, queue_opened_at, link_label, link_url)
    values (v_title, nullif(regexp_replace(coalesce(p_description, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
            p_deadline, v_group,
            p_audience, p_assignment_mode, p_campaign_id, p_parent_task_id, p_kind,
            'todo', v_actor, case when p_assignment_mode = 'public' then now() end,
            v_link_label, v_link_url)
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
$function$;


-- #794: plan_task_update -- rebuilt from 20260924132724_private_groups.sql:632.
CREATE OR REPLACE FUNCTION private.plan_task_update(p_task public.tasks, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text, p_link_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_title text;
  v_description text;
  v_link_label text;
  v_link_url text;
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
  -- #684: the Attached Link, normalized as the callers judged it at step 1.
  v_link_label := nullif(regexp_replace(coalesce(p_link_label, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_link_url := nullif(regexp_replace(coalesce(p_link_url, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
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
  if v_link_label is distinct from p_task.link_label then
    v_changed := array_append(v_changed, 'link_label');
    v_before := v_before || jsonb_build_object('link_label', p_task.link_label);
    v_after := v_after || jsonb_build_object('link_label', v_link_label);
  end if;
  if v_link_url is distinct from p_task.link_url then
    v_changed := array_append(v_changed, 'link_url');
    v_before := v_before || jsonb_build_object('link_url', p_task.link_url);
    v_after := v_after || jsonb_build_object('link_url', v_link_url);
  end if;
  if array_length(v_changed, 1) is null then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;
  return jsonb_build_object('title', v_title, 'description', v_description,
    'campaign_id', v_campaign_id, 'link_label', v_link_label, 'link_url', v_link_url,
    'changed', to_jsonb(v_changed), 'before', v_before, 'after', v_after);
end;
$function$;


-- #794: duplicate_task_impl -- rebuilt from 20260924132724_private_groups.sql:764.
CREATE OR REPLACE FUNCTION private.duplicate_task_impl(p_task_id bigint, p_deadline timestamp with time zone)
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
  -- constraint name. The Attached Link needs no such check: tasks_link_ck and
  -- tasks_link_format_ck held it from the moment it was written (#684).
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

  insert into public.tasks (
    title, description, group_id, campaign_id,
    audience, assignment_mode, kind, status, deadline, created_by,
    parent_task_id, queue_opened_at, duplicated_from_task_id,
    link_label, link_url)
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
    v_source.link_label, v_source.link_url)
  returning * into v_clone;

  perform private.log_task_activity(v_clone.id, 'created', v_actor, null, null, 'todo'::public.task_status, null,
    jsonb_build_object('duplicated_from_task_id', p_task_id));
  perform private.log_task_activity(p_task_id, 'duplicated', v_actor, null, null, null, null,
    jsonb_build_object('clone_task_id', v_clone.id));

  select * into v_clone from public.tasks where id = v_clone.id;
  return v_clone;
end;
$function$;


-- #794: convert_task_mode_impl -- rebuilt from 20260914013710_convert_task_mode.sql:24
-- (never re-issued since). Gains direct_task_local_only and R25's
-- private_group_local_only, both judged in step 5.
create or replace function private.convert_task_mode_impl(
  p_task_id bigint, p_assignment_mode text, p_audience text)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
  v_from jsonb;
  v_to jsonb;
begin
  -- 2. Gate + visibility
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked)
  select * into v_task from public.tasks where id = p_task_id for update;
  -- 4. Authority under lock
  perform private.require_task_manager(p_task_id);
  -- 5. Input validation (PT400)
  if p_audience is null or p_audience not in ('local', 'org') then
    raise sqlstate 'PT400' using message = 'invalid_audience';
  end if;
  if p_assignment_mode is null or p_assignment_mode not in ('direct', 'public') then
    raise sqlstate 'PT400' using message = 'invalid_assignment_mode';
  end if;
  -- #794 (ruling R26): a directly assigned Task carries the local Audience.
  if p_assignment_mode = 'direct' and p_audience = 'org' then
    raise sqlstate 'PT400' using message = 'direct_task_local_only';
  end if;
  -- #756 (ruling R25): a Private Group's Tasks carry the local Audience only.
  if p_audience = 'org'
     and exists (select 1 from public.groups as origin
                  where origin.id = v_task.group_id and origin.is_private) then
    raise sqlstate 'PT400' using message = 'private_group_local_only';
  end if;
  -- 6. State preconditions (PT409)
  if v_task.kind = 'umbrella' then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  if v_task.status in ('completed', 'unfulfilled', 'cancelled') then
    raise sqlstate 'PT409' using message = 'task_terminal';
  end if;
  if exists (select 1 from public.task_assignments where task_id = p_task_id) then
    raise sqlstate 'PT409' using message = 'task_already_assigned';
  end if;
  if exists (select 1 from public.task_candidates where task_id = p_task_id) then
    raise sqlstate 'PT409' using message = 'task_has_candidates';
  end if;
  if p_assignment_mode = v_task.assignment_mode and p_audience = v_task.audience then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;
  -- 7. Mutate, then activity, then (no) notify, then return
  v_from := jsonb_build_object('audience', v_task.audience, 'assignment_mode', v_task.assignment_mode);
  v_to := jsonb_build_object('audience', p_audience, 'assignment_mode', p_assignment_mode);
  update public.tasks
     set audience = p_audience,
         assignment_mode = p_assignment_mode,
         queue_opened_at = case
           when p_assignment_mode is distinct from v_task.assignment_mode then
             case when p_assignment_mode = 'public' then now() end
           else queue_opened_at
         end,
         queue_closed_at = case
           when p_assignment_mode is distinct from v_task.assignment_mode then null
           else queue_closed_at
         end
   where id = p_task_id
  returning * into v_task;
  perform private.log_task_activity(p_task_id, 'mode_converted', v_actor, null, null, null, null,
    jsonb_build_object('from', v_from, 'to', v_to));
  return v_task;
end;
$$;

comment on function private.convert_task_mode_impl(bigint, text, text) is
  'Switches a Task between direct/public Assignment Mode and local/org Audience; the actor is auth.uid(), never a parameter. Refuses direct + org (PT400 direct_task_local_only, #794 ruling R26: a directly assigned Task carries the local Audience) and org in a Private Group (PT400 private_group_local_only, #756 ruling R25). Refuses any Task that has ever had an Assignment (PT409 task_already_assigned) or a Candidature of any status, including withdrawn/closed (PT409 task_has_candidates) -- ADR-0007 makes Origin/Audience/Assignment Mode immutable after the first of either, not only while one is live. Also refuses a terminal Task (PT409 task_terminal) and an Umbrella, which has no mode or audience at all (PT409 task_is_umbrella). direct -> public sets queue_opened_at = now() and nulls queue_closed_at; public -> direct nulls both -- safe because the two immutability guards already prove the queue is empty; toggling Audience alone leaves both timestamps untouched. A call that changes neither field is PT409 nothing_to_update. Writes one mode_converted activity row (assignment_id null; details.from/to each hold {audience, assignment_mode}) and sends no notification -- by construction there is no Executor and no Candidate to tell.';

-- The data correction: every existing directly assigned Task takes the local
-- Audience it now must carry. A correction, not an edit -- no activity row.
update public.tasks
   set audience = 'local'
 where assignment_mode = 'direct'
   and audience = 'org';

-- ==================== 4 · express_task_interest: comments only ====================
-- The body (20260924000120_queue_no_first_come.sql:68-163) is unchanged: `org`
-- admits every Member who passes require_task_visible -- now every active
-- Member, whatever the Group's Minimum Level -- and `local` needs
-- private.is_group_member.

comment on function private.express_task_interest_impl(bigint) is
  'A Member joins a public Task''s Candidate Queue; the actor is auth.uid(), never a parameter. Every accepted call inserts a pending Candidate at the end of the arrival order, logs interest_expressed with details.position and details.candidate_id, and coalesces the managers'' "Coadă" notification under task:<id>:queue -- nobody becomes Executor by arriving first (#682, ruling R9); the Task Manager selects with select_task_candidate. The tasks row is locked FOR UPDATE before any Assignment or Candidature is read, so concurrent callers serialize. Refusals in order: task_is_umbrella, task_not_public, task_terminal, task_queue_closed, already_executor, already_candidate. An organization-wide Opportunity admits every active Member who can read it -- since #794 (ruling R26) every one, with no Minimum Level gate. A local Opportunity admits only members of the Task''s own Group (private.is_group_member, 42501 task_audience_forbidden, the caller''s roster row held FOR SHARE); a non-member cannot read it at all (PT404 task_not_found) unless they read it as leadership -- a BCE, or a Group Manager or Responsible on the path -- who gets the 42501.';

comment on function public.express_task_interest(bigint) is
  'Express interest in a public Task: the caller joins the end of its ordered Candidate Queue as a pending Candidate, and the Task Manager chooses the Executor from the queue (#682). An organization-wide Opportunity is open to every live active Member (#794, ruling R26); a local-Audience Opportunity only to the members of its Group.';
