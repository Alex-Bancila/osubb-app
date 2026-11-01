-- #1127: no new work inside an archived Group -- create_task, duplicate_task and create_campaign refuse group_archived; managed_work_groups() carries status.
--
-- Audit finding M3 (docs/review/2026-10-30-codebase-audit.md). The three
-- creators had no status check: their gate, private.can_manage_group_work,
-- lets level 6 and up through on an archived Group, so BC or the Moderator
-- could create a todo Task or a Campaign where archive_group's "no open work"
-- invariant said none could exist -- and where the Group's own Managers can
-- no longer manage it (can_manage_group_work is false below level 6 on an
-- archived Group). create_completed_task and the Request approval already
-- answer PT409 group_archived, create_event reloads the Group as active, and
-- update_task refuses a move into an archived Group. On the page,
-- public.managed_work_groups() returned no status, so Task nou offered
-- archived Groups to BC.
--
-- Each body below is main's latest -- create_task_impl and
-- duplicate_task_impl from 20261020213926_formatted_text.sql,
-- create_campaign_impl from 20260923231125_constraints_kit.sql -- with one
-- block added: PT409 group_archived unless the Group (the Task's, the copy's
-- source's, the Campaign's) is active, a state rule judged after the
-- authority and input refusals and before the cap and the write (conventions
-- section 3). The read is unlocked here; #1145 moves it under the Group lock
-- together with create_event's. create_tasks goes through create_task_impl
-- and needs nothing of its own. managed_work_groups() gains status (a RETURNS
-- TABLE change, so it is dropped and recreated); the forms keep offering an
-- edit's current Group when it is archived, so the edit can still be saved
-- without a move. supabase/tests/archived_group_no_new_work.test.sql failed
-- before this file.

-- ==================== private.create_task_impl ====================
create or replace function private.create_task_impl(p_title text, p_description text, p_deadline timestamp with time zone, p_audience text, p_assignment_mode text, p_executor_id uuid, p_campaign_id bigint, p_parent_task_id bigint, p_kind text, p_group_id bigint, p_link_label text, p_link_url text, p_links jsonb, p_min_level integer)
 RETURNS tasks
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
  perform private.require_formatted_text_length('description',
    regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g'));
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
  -- #1127 (audit M3): no new work in an archived Group. can_manage_group_work
  -- lets level 6 and up through on one, and archive_group's "no open work"
  -- invariant must hold after it commits. A state rule (step 6): after every
  -- authority and input refusal, before the cap and the write. #1145 moves
  -- this read under the Group lock.
  if (select grp.status from public.groups as grp where grp.id = v_group) <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
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
  'Creates one Task, Subtask or Umbrella in a Group the live caller may manage (private.require_group_work_manager, 42501 task_manage_forbidden); the actor is auth.uid(), never a parameter. A top-level Task names its Group (PT400 task_group_required without one); a Subtask locks its Umbrella FOR NO KEY UPDATE, inherits its Group, and refuses a different p_group_id (subtask_origin_mismatch). A direct Executor must be activ and at or above the Group''s Minimum Level (invalid_executor). #684, R46: up to five Attached Links (p_links; or, from an app version before R46, the one pair p_link_label + p_link_url) are judged at step 1 by private.require_attached_links and stored in tasks.links; an Umbrella may carry them like any Task. R57 (2026-10-14): p_min_level, the Task''s Minimum Level (0 by default; stored only on an ordinary public Task, a direct Task or an Umbrella stays at 0; PT400 invalid_task_min_level off the ladder, task_min_level_above_actor above the creator''s own Level). #1127 (audit M3): PT409 group_archived unless the Task''s Group is active, judged after every authority and input refusal and before the cap and the write -- no new work lands in an archived Group, whoever the caller is.';

-- ==================== private.duplicate_task_impl ====================
create or replace function private.duplicate_task_impl(p_task_id bigint, p_deadline timestamp with time zone)
 RETURNS tasks
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
  perform private.require_formatted_text_length('description', v_source.description);
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

  -- #1127 (audit M3): the copy lands in its source's Group, which must still
  -- be active -- the same state rule create_task applies, judged after the
  -- authority and input refusals and before the cap and the write.
  if (select grp.status from public.groups as grp where grp.id = v_source.group_id) <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
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


comment on function private.duplicate_task_impl(bigint, timestamptz) is
  'The SOURCE Task''s manager (private.require_task_manager, 42501 task_manage_forbidden) clones it into a brand-new todo Task with the caller''s own deadline; the actor is auth.uid(), never a parameter. A null deadline is PT400 deadline_required and a past one deadline_in_past, raised before the membership gate. Locks the source plain FOR UPDATE (never FOR NO KEY UPDATE -- this command takes no second lock, so no ABBA cycle with private.evaluate_task can form) with an `if not found` PT404 task_not_found guard. PT409 task_is_umbrella for an Umbrella source; every other status, including completed, is accepted. Clones title, description, the Group, audience, assignment_mode, the Attached Link (#684) and the Campaign -- but only when that Campaign is still active, else the clone carries none. Always sets kind = task, status = todo, created_by = the actor, parent_task_id = null (a clone of a Subtask is top-level: this command has no Umbrella parameter to re-validate a parent against), queue_opened_at = now() only when the clone is public, and duplicated_from_task_id = the source. No Executor, Difficulty or Rating. Logs `created` on the clone (details.duplicated_from_task_id) and `duplicated` on the source (details.clone_task_id, from/to_status null -- the source''s own status never changes). Sends no notification. #1127 (audit M3): PT409 group_archived unless the source''s Group -- the copy''s -- is active, judged after the authority and input refusals and before the cap and the write.';

-- ==================== private.create_campaign_impl ====================
CREATE OR REPLACE FUNCTION private.create_campaign_impl(p_group_id bigint, p_name text)
 RETURNS campaigns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_name text;
  v_campaign public.campaigns%rowtype;
  v_constraint text;
begin
  -- #673 (R8): malformed for every caller, measured as stored (trimmed).
  perform private.require_text_length('name',
    regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'), 3, 120);
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

  -- #1127 (audit M3): no new Campaign in an archived Group, for the same
  -- reason create_task refuses one -- a state rule, after authority and the
  -- name rules, before the write.
  if (select grp.status from public.groups as grp where grp.id = p_group_id) <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;

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
$function$;


-- main carried no comment on this body; this is its first.
comment on function private.create_campaign_impl(bigint, text) is
  'Creates a Campaign in a Group the live caller may manage Campaigns for (private.require_campaign_manager, 42501 campaign_manage_forbidden; the actor is auth.uid(), never a parameter); the name is measured as stored (#673, R8: name_too_short / name_too_long at step 1, invalid_campaign_name when blank) and must be unique within the Group (PT409 campaign_name_taken). #1127 (audit M3): PT409 group_archived unless the Group is active, judged after the authority and name refusals and before the write.';

-- ==================== public.managed_work_groups() carries status ====================
drop function public.managed_work_groups();
create function public.managed_work_groups()
returns table (id bigint, name text, path bigint[], min_level integer, status text)
language sql stable security invoker set search_path = ''
as $$
  select grp.id, grp.name, grp.path, grp.min_level, grp.status
    from public.groups as grp
   where coalesce(public.auth_is_member(), false)
     and private.can_manage_group_work(grp.id)
   order by grp.path, grp.id;
$$;
revoke all on function public.managed_work_groups() from public, anon, authenticated, service_role;
grant execute on function public.managed_work_groups() to authenticated;
comment on function public.managed_work_groups() is
  'Read-only Task Origins the live caller manages, through Group RLS and can_manage_group_work; includes managed descendants at every depth. Clients page the stable path/id ordering. #1127 (audit M3): each row carries the Group''s status -- BC and the Moderator manage archived Groups too, but no new Task or Campaign may be created in one, so the forms offer only the active ones (plus an edit''s current Group, so the edit can be saved without a move).';
