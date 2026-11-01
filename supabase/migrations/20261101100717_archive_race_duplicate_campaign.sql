-- #1174: duplicate_task and create_campaign no longer race archive_group -- the Group is held FOR SHARE and judged under the lock.
--
-- #1145 closed this race for create_event, create_task and update_event's
-- move (20261101003738_archive_group_races.sql). The other two creators #1127
-- taught to refuse an archived Group (20261031210933_archived_group_no_new_work.sql)
-- kept reading the Group's status unlocked, and their inserts took only the
-- foreign key's KEY SHARE on the Group row: behind archive_group's FOR UPDATE
-- on its target that waited and then succeeded, and with its FOR NO KEY
-- UPDATE on a descendant it did not even wait -- so a copy or a Campaign
-- could land in a Group being archived in the same instant, where its own
-- Managers can no longer manage it.
--
-- Both bodies are main's latest (the #1127 file; nothing rebuilt them since)
-- with that one read made FOR SHARE, #1145's mode: a row these commands only
-- read (conventions section 2), which conflicts with exactly the locks
-- archive_group takes and with every structural write of a Group while
-- concurrent creators share it. duplicate_task takes it after the source
-- Task, the tasks-then-groups order create_task and update_task take;
-- archive_group never locks a tasks row, so no cycle forms. No signature
-- changes: the grants and the tracker_grants roster are untouched.
-- supabase/tests/archive_group_races.test.sql sections 4 and 5 failed before
-- this file (both copies and both Campaigns landed).

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
  v_group_status  text;
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
  -- authority and input refusals and before the cap and the write. #1174:
  -- read with the Group row held FOR SHARE (a row this command only reads),
  -- after the source Task -- the tasks-then-groups order create_task and
  -- update_task take; archive_group never locks a tasks row -- so a
  -- concurrent archive (FOR UPDATE on its target, FOR NO KEY UPDATE on the
  -- subtree) serializes here and the status read is the one it committed.
  select grp.status into v_group_status
    from public.groups as grp where grp.id = v_source.group_id for share;
  if v_group_status <> 'active' then
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
  'The SOURCE Task''s manager (private.require_task_manager, 42501 task_manage_forbidden) clones it into a brand-new todo Task with the caller''s own deadline; the actor is auth.uid(), never a parameter. A null deadline is PT400 deadline_required and a past one deadline_in_past, raised before the membership gate. Locks the source plain FOR UPDATE (never FOR NO KEY UPDATE -- this command takes no second lock, so no ABBA cycle with private.evaluate_task can form) with an `if not found` PT404 task_not_found guard. PT409 task_is_umbrella for an Umbrella source; every other status, including completed, is accepted. Clones title, description, the Group, audience, assignment_mode, the Attached Link (#684) and the Campaign -- but only when that Campaign is still active, else the clone carries none. Always sets kind = task, status = todo, created_by = the actor, parent_task_id = null (a clone of a Subtask is top-level: this command has no Umbrella parameter to re-validate a parent against), queue_opened_at = now() only when the clone is public, and duplicated_from_task_id = the source. No Executor, Difficulty or Rating. Logs `created` on the clone (details.duplicated_from_task_id) and `duplicated` on the source (details.clone_task_id, from/to_status null -- the source''s own status never changes). Sends no notification. #1127 (audit M3): PT409 group_archived unless the source''s Group -- the copy''s -- is active, judged after the authority and input refusals and before the cap and the write. #1174: that status is read with the Group row held FOR SHARE (after the source Task), so a concurrent archive_group serializes ahead of the copy.';

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
  v_group_status text;
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
  -- name rules, before the write. #1174: read with the Group row held FOR
  -- SHARE (a row this command only reads; it locks no other row first), so a
  -- concurrent archive_group serializes here and the status read is the one
  -- it committed.
  select grp.status into v_group_status
    from public.groups as grp where grp.id = p_group_id for share;
  if v_group_status <> 'active' then
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


comment on function private.create_campaign_impl(bigint, text) is
  'Creates a Campaign in a Group the live caller may manage Campaigns for (private.require_campaign_manager, 42501 campaign_manage_forbidden; the actor is auth.uid(), never a parameter); the name is measured as stored (#673, R8: name_too_short / name_too_long at step 1, invalid_campaign_name when blank) and must be unique within the Group (PT409 campaign_name_taken). #1127 (audit M3): PT409 group_archived unless the Group is active, judged after the authority and name refusals and before the write. #1174: that status is read with the Group row held FOR SHARE, so a concurrent archive_group serializes ahead of the insert.';
