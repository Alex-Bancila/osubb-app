-- #684: the Attached Link on Tasks and the Submission Note on submit_task_for_review.
--
-- Ruling R7 of the 2026-09-23 grill; CONTEXT.md "Attached Link" and "Submission
-- Note". A Task carries at most one Attached Link -- tasks.link_label and
-- tasks.link_url, set together -- through create_task, update_task /
-- preview_task_update and duplicate_task. submit_task_for_review takes an
-- optional Submission Note and one Attached Link and writes them on the
-- `submitted` history row (task_activity.note and details.link_label/link_url),
-- which task_activity_read already lets the Executor and the managers read.
-- The reviewer's "De verificat" notification carries the note's first line.
--
-- The rules follow the constraints kit (#673, ruling R8), measured on the
-- trimmed value at step 1, before the gate, one PT400 reason per rule:
-- link_incomplete (one of the pair without the other), link_label_too_long
-- (over 60), link_url_too_long (over 2048), link_url_invalid (not http(s)),
-- note_too_long (over 1000). The link reasons are the ones the kit's
-- announcements_guard_text already names; link_incomplete is the pair rule's
-- own reason, the `<field>_incomplete` shape #697 uses for the Group's
-- application-form link. Blank values become null. Text fields stay plain text.
--
-- Signatures change, so each public wrapper and its _impl (and the shared
-- private.plan_task_update) is dropped and recreated -- PostgREST must never
-- see two overloads. Bodies are rebuilt from main's latest catalog definitions
-- (#682's update_task_impl, #673's step-1 checks, #675's Nickname).

-- ---------------------------------------------------------------------------
-- The columns and their invariants.
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column link_label text,
  add column link_url text,
  add constraint tasks_link_ck check ((link_url is null) = (link_label is null)),
  add constraint tasks_link_format_ck check (
    link_label is null
    or (link_label ~ '[^[:space:]]'
        and char_length(link_label) <= 60
        and link_url ~ '^https?://'
        and char_length(link_url) <= 2048));

comment on column public.tasks.link_label is
  'The Attached Link''s label (#684, ruling R7): at most 60 characters, set together with link_url (tasks_link_ck).';
comment on column public.tasks.link_url is
  'The Attached Link''s http(s) address (#684, ruling R7): at most 2048 characters, set together with link_label (tasks_link_ck).';

-- ---------------------------------------------------------------------------
-- The shared step-1 rule for an Attached Link.
-- ---------------------------------------------------------------------------
create function private.require_attached_link(p_label text, p_url text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  -- The caller passes both values already trimmed, blank -> null.
  if (p_label is null) <> (p_url is null) then
    raise sqlstate 'PT400' using message = 'link_incomplete';
  end if;
  if p_label is null then
    return;
  end if;
  if char_length(p_label) > 60 then
    raise sqlstate 'PT400' using message = 'link_label_too_long';
  end if;
  if char_length(p_url) > 2048 then
    raise sqlstate 'PT400' using message = 'link_url_too_long';
  end if;
  if not private.is_http_url(p_url) then
    raise sqlstate 'PT400' using message = 'link_url_invalid';
  end if;
end;
$$;

revoke execute on function private.require_attached_link(text, text) from public, anon, authenticated, service_role;

comment on function private.require_attached_link(text, text) is
  '#684 (rulings R7/R8): the step-1 rule for one Attached Link, given its trimmed label and address (blank -> null). PT400 link_incomplete when exactly one is set, link_label_too_long over 60 characters, link_url_too_long over 2048, link_url_invalid when the address is not http(s). Both null is no link. Called by create_task, update_task, preview_task_update and submit_task_for_review before their gates; granted to nobody.';

-- ---------------------------------------------------------------------------
-- create_task: two trailing optional link parameters.
-- ---------------------------------------------------------------------------
drop function public.create_task(text, text, timestamp with time zone, text, text, uuid, bigint, bigint, text, bigint);
drop function private.create_task_impl(text, text, timestamp with time zone, text, text, uuid, bigint, bigint, text, bigint);

create function private.create_task_impl(
  p_title text, p_description text, p_deadline timestamp with time zone, p_audience text,
  p_assignment_mode text, p_executor_id uuid, p_campaign_id bigint, p_parent_task_id bigint,
  p_kind text, p_group_id bigint, p_link_label text, p_link_url text)
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
    if p_assignment_mode = 'public' and p_executor_id is not null then
      raise sqlstate 'PT400' using message = 'executor_not_allowed_for_public';
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
$$;

create function public.create_task(
  p_title text, p_description text, p_deadline timestamp with time zone, p_audience text,
  p_assignment_mode text, p_executor_id uuid default null, p_campaign_id bigint default null,
  p_parent_task_id bigint default null, p_kind text default 'task', p_group_id bigint default null,
  p_link_label text default null, p_link_url text default null)
returns public.tasks
language sql
set search_path = ''
as $$
  select private.create_task_impl(p_title, p_description, p_deadline, p_audience, p_assignment_mode,
                                  p_executor_id, p_campaign_id, p_parent_task_id, p_kind, p_group_id,
                                  p_link_label, p_link_url);
$$;

revoke execute on function private.create_task_impl(text, text, timestamp with time zone, text, text, uuid, bigint, bigint, text, bigint, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.create_task(text, text, timestamp with time zone, text, text, uuid, bigint, bigint, text, bigint, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.create_task_impl(text, text, timestamp with time zone, text, text, uuid, bigint, bigint, text, bigint, text, text)
  to authenticated;
grant execute on function public.create_task(text, text, timestamp with time zone, text, text, uuid, bigint, bigint, text, bigint, text, text)
  to authenticated;

comment on function private.create_task_impl(text, text, timestamp with time zone, text, text, uuid, bigint, bigint, text, bigint, text, text) is
  'Creates one Task, Subtask or Umbrella in a Group the live caller may manage (private.require_group_work_manager, 42501 task_manage_forbidden); the actor is auth.uid(), never a parameter. A top-level Task names its Group (PT400 task_group_required without one); a Subtask locks its Umbrella FOR NO KEY UPDATE, inherits its Group, and refuses a different p_group_id (subtask_origin_mismatch). A direct Executor must be activ and at or above the Group''s Minimum Level (invalid_executor). #684: an optional Attached Link (p_link_label + p_link_url, trimmed, blank -> null) is judged at step 1 by private.require_attached_link and stored on the row; an Umbrella may carry one like any Task.';

comment on function public.create_task(text, text, timestamp with time zone, text, text, uuid, bigint, bigint, text, bigint, text, text) is
  'Creates Group-owned work through live Group Manager/Responsible authority. The Group is the only Origin (#579): p_group_id for a top-level Task or Umbrella, inherited from the Umbrella for a Subtask. Subtasks lock the Umbrella FOR NO KEY UPDATE. #684: p_link_label and p_link_url set the Task''s one Attached Link, together or not at all (PT400 link_incomplete, link_label_too_long, link_url_too_long, link_url_invalid).';

-- ---------------------------------------------------------------------------
-- private.plan_task_update: the link joins the full-state diff.
-- ---------------------------------------------------------------------------
drop function private.plan_task_update(public.tasks, bigint, text, text, timestamp with time zone, bigint, text, text);

create function private.plan_task_update(
  p_task public.tasks, p_group_id bigint, p_title text, p_description text,
  p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text,
  p_audience text, p_link_label text, p_link_url text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
$$;

revoke execute on function private.plan_task_update(public.tasks, bigint, text, text, timestamp with time zone, bigint, text, text, text, text)
  from public, anon, authenticated, service_role;

comment on function private.plan_task_update(public.tasks, bigint, text, text, timestamp with time zone, bigint, text, text, text, text) is
  'Shared #627 full-state validator and audit diff. A real Group move needs an active target; same-Group edits retain the prior edit window even on archived Groups. Subtasks cannot move and Umbrellas with Subtasks cannot move. An existing Campaign incompatible with the target Group is normalized to null and included in the changed/before/after diff. #684: the Attached Link (link_label, link_url; trimmed, blank -> null, null clears it) is part of the full state -- each column that differs is named in changed/before/after, and the normalized pair is returned for the command to store.';

-- ---------------------------------------------------------------------------
-- update_task / preview_task_update: the link joins the full state, with no
-- defaults (OD5: null clears the link).
-- ---------------------------------------------------------------------------
drop function public.update_task(bigint, bigint, text, text, timestamp with time zone, bigint, text, text, boolean);
drop function private.update_task_impl(bigint, bigint, text, text, timestamp with time zone, bigint, text, text, boolean);
drop function public.preview_task_update(bigint, bigint, text, text, timestamp with time zone, bigint, text, text);
drop function private.preview_task_update_impl(bigint, bigint, text, text, timestamp with time zone, bigint, text, text);

create function private.update_task_impl(
  p_task_id bigint, p_group_id bigint, p_title text, p_description text,
  p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text,
  p_audience text, p_link_label text, p_link_url text, p_accept_consequences boolean)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_parent_id bigint;
  v_task public.tasks%rowtype;
  v_plan jsonb;
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
begin
  -- 1. #673 (R8): malformed for every caller, measured as stored (trimmed).
  --    No deadline_in_past here: R8 judges the deadline only at creation.
  perform private.require_text_length('title',
    regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g'), 3, 120);
  perform private.require_text_length('description',
    regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 2000);
  -- #684 (R7): the Attached Link, trimmed, blank -> null.
  perform private.require_attached_link(
    nullif(regexp_replace(coalesce(p_link_label, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
    nullif(regexp_replace(coalesce(p_link_url, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''));
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
  if p_group_id is distinct from v_task.group_id then
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
    p_campaign_id, p_assignment_mode, p_audience, p_link_label, p_link_url);
  -- Consequences, shared with the preview; none may apply unaccepted.
  select coalesce(jsonb_agg(jsonb_build_object('consequence', c.consequence, 'member_id', c.member_id)
                            order by c.ord), '[]'::jsonb)
    into v_consequences
    from private.task_update_consequences(p_task_id, p_group_id, p_campaign_id, p_assignment_mode, p_audience)
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
    perform private.end_task_assignment(v_assignment_id,
      case when v_group_changed then 'group_changed' else 'task_updated' end, null);
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
           link_label = v_plan ->> 'link_label',
           link_url = v_plan ->> 'link_url',
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
      case when v_group_changed
        then 'Taskul a fost mutat într-un grup pentru care nu ești eligibil.'
        else 'Nu mai ești executorul acestui task: audiența lui s-a schimbat.' end,
      p_task_id, null, v_actor);
  end if;
  select assignment.member_id into v_executor
    from public.task_assignments as assignment
   where assignment.task_id = p_task_id and assignment.ended_at is null;
  if v_executor is not null then
    perform private.notify(array[v_executor], 'task'::public.noti_kind,
      'Task actualizat: ' || v_task.title,
      'Modificat: ' || array_to_string(array(select jsonb_array_elements_text(v_plan -> 'changed')), ', ') || '.',
      p_task_id, null, v_actor);
  end if;
  return v_task;
end;
$$;

create function public.update_task(
  p_task_id bigint, p_group_id bigint, p_title text, p_description text,
  p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text,
  p_audience text, p_link_label text, p_link_url text, p_accept_consequences boolean default false)
returns public.tasks
language sql
set search_path = ''
as $$
  select private.update_task_impl(p_task_id, p_group_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience, p_link_label, p_link_url, p_accept_consequences);
$$;

create function private.preview_task_update_impl(
  p_task_id bigint, p_group_id bigint, p_title text, p_description text,
  p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text,
  p_audience text, p_link_label text, p_link_url text)
returns table(consequence text, member_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
begin
  -- #673 (R8) and #684 (R7): the command's step 1, so preview and command agree.
  perform private.require_text_length('title',
    regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g'), 3, 120);
  perform private.require_text_length('description',
    regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 2000);
  perform private.require_attached_link(
    nullif(regexp_replace(coalesce(p_link_label, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
    nullif(regexp_replace(coalesce(p_link_url, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''));
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
  perform private.plan_task_update(v_task, p_group_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience, p_link_label, p_link_url);
  return query
    select c.consequence, c.member_id
      from private.task_update_consequences(p_task_id, p_group_id, p_campaign_id, p_assignment_mode, p_audience) as c;
end;
$$;

create function public.preview_task_update(
  p_task_id bigint, p_group_id bigint, p_title text, p_description text,
  p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text,
  p_audience text, p_link_label text, p_link_url text)
returns table(consequence text, member_id uuid)
language sql
stable
set search_path = ''
as $$
  select * from private.preview_task_update_impl(p_task_id, p_group_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience, p_link_label, p_link_url);
$$;

revoke execute on function private.update_task_impl(bigint, bigint, text, text, timestamp with time zone, bigint, text, text, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function public.update_task(bigint, bigint, text, text, timestamp with time zone, bigint, text, text, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function private.preview_task_update_impl(bigint, bigint, text, text, timestamp with time zone, bigint, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.preview_task_update(bigint, bigint, text, text, timestamp with time zone, bigint, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.update_task_impl(bigint, bigint, text, text, timestamp with time zone, bigint, text, text, text, text, boolean)
  to authenticated;
grant execute on function public.update_task(bigint, bigint, text, text, timestamp with time zone, bigint, text, text, text, text, boolean)
  to authenticated;
grant execute on function private.preview_task_update_impl(bigint, bigint, text, text, timestamp with time zone, bigint, text, text, text, text)
  to authenticated;
grant execute on function public.preview_task_update(bigint, bigint, text, text, timestamp with time zone, bigint, text, text, text, text)
  to authenticated;

comment on function private.update_task_impl(bigint, bigint, text, text, timestamp with time zone, bigint, text, text, text, text, boolean) is
  'Atomic #627 full-state Task update. Locks Umbrella then Task FOR NO KEY UPDATE; for a move, authorizes both Groups, locks both Groups in ID order, rechecks authority, and holds Executor/Candidate Profiles FOR SHARE before applying the shared consequence plan. PT409 task_update_needs_confirmation protects every listed consequence. Uses the #583 Appointment core, ends an ineligible Assignment (group_changed on a move, task_updated on Audience narrowing) and returns the Task to todo, closes ineligible Candidatures, clears an incompatible Campaign, and logs one task_updated activity with the accepted consequences and field diff. No Candidate is ever promoted (#682): the remaining queue stays pending for the manager to select from. #684: the Attached Link is part of the full state (p_link_label, p_link_url, no defaults; null clears it), judged at step 1 by private.require_attached_link.';

comment on function public.update_task(bigint, bigint, text, text, timestamp with time zone, bigint, text, text, text, text, boolean) is
  'Sets every editable field, including Group and the Attached Link (#684: p_link_label + p_link_url, null clears it), at once while todo or in_progress. A real Group move requires authority over source and target. Consequences require explicit acceptance after public.preview_task_update.';

comment on function private.preview_task_update_impl(bigint, bigint, text, text, timestamp with time zone, bigint, text, text, text, text) is
  'Body behind public.preview_task_update (#626): the same step-1 checks as update_task (#673 lengths, #684 Attached Link), the same gate (PT404 task_not_found for an invisible Task, 42501 task_manage_forbidden for a non-manager), the same validation and refusals (private.plan_task_update), then the rows of private.task_update_consequences -- the one definition the command applies. Stable; writes and locks nothing.';

comment on function public.preview_task_update(bigint, bigint, text, text, timestamp with time zone, bigint, text, text, text, text) is
  'Lists public.update_task consequences for the same full state -- the Attached Link included (#684) -- without writes: executor_added_to_group, executor_removed, candidate_removed, and campaign_cleared (null member_id). No edit promotes a Candidate (#682). Refuses the same invalid state or authority.';

-- ---------------------------------------------------------------------------
-- private.duplicate_task_impl: the clone copies the Attached Link.
-- ---------------------------------------------------------------------------
create or replace function private.duplicate_task_impl(p_task_id bigint, p_deadline timestamp with time zone)
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
    v_source.audience, v_source.assignment_mode, 'task', 'todo', p_deadline,
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
$$;

comment on function private.duplicate_task_impl(bigint, timestamp with time zone) is
  'The SOURCE Task''s manager (private.require_task_manager, 42501 task_manage_forbidden) clones it into a brand-new todo Task with the caller''s own deadline; the actor is auth.uid(), never a parameter. A null deadline is PT400 deadline_required and a past one deadline_in_past, raised before the membership gate. Locks the source plain FOR UPDATE (never FOR NO KEY UPDATE -- this command takes no second lock, so no ABBA cycle with private.evaluate_task can form) with an `if not found` PT404 task_not_found guard. PT409 task_is_umbrella for an Umbrella source; every other status, including completed, is accepted. Clones title, description, the Group, audience, assignment_mode, the Attached Link (#684) and the Campaign -- but only when that Campaign is still active, else the clone carries none. Always sets kind = task, status = todo, created_by = the actor, parent_task_id = null (a clone of a Subtask is top-level: this command has no Umbrella parameter to re-validate a parent against), queue_opened_at = now() only when the clone is public, and duplicated_from_task_id = the source. No Executor, Difficulty or Rating. Logs `created` on the clone (details.duplicated_from_task_id) and `duplicated` on the source (details.clone_task_id, from/to_status null -- the source''s own status never changes). Sends no notification.';

-- ---------------------------------------------------------------------------
-- submit_task_for_review: the optional Submission Note and Attached Link.
-- ---------------------------------------------------------------------------
drop function public.submit_task_for_review(bigint);
drop function private.submit_task_for_review_impl(bigint);

create function private.submit_task_for_review_impl(
  p_task_id bigint, p_note text, p_link_label text, p_link_url text)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_actor_name text;
  v_task public.tasks%rowtype;
  v_assignment_id bigint;
  v_note text;
  v_first_line text;
  v_link_label text;
  v_link_url text;
  v_details jsonb := '{}'::jsonb;
begin
  -- 1. #684 (R7/R8): malformed for every caller, measured as stored
  --    (trimmed, blank -> null), before the gate.
  v_note := nullif(regexp_replace(coalesce(p_note, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_text_length('note', v_note, null, 1000);
  v_link_label := nullif(regexp_replace(coalesce(p_link_label, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_link_url := nullif(regexp_replace(coalesce(p_link_url, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_attached_link(v_link_label, v_link_url);
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: only the active Executor. Same Umbrella
  --    fallthrough as start_task.
  v_assignment_id := private.require_task_executor(p_task_id);
  -- 6. State precondition.
  if v_task.status <> 'in_progress' then
    raise sqlstate 'PT409' using message = 'task_not_in_progress';
  end if;
  -- 7. Mutate (review_round / returned_to_progress_at are never named here,
  --    so a resubmission after a return cannot change either -- #335/#337
  --    own those columns), then activity, then notify the Task's managers.
  update public.tasks set status = 'in_review', submitted_at = now()
   where id = p_task_id;
  if v_link_label is not null then
    v_details := jsonb_build_object('link_label', v_link_label, 'link_url', v_link_url);
  end if;
  -- The Submission Note lives on the history row the reviewer reads first.
  perform private.log_task_activity(p_task_id, 'submitted', v_actor, v_assignment_id,
    'in_progress'::public.task_status, 'in_review'::public.task_status, v_note, v_details);
  select coalesce(profile.nickname, profile.full_name) into v_actor_name
    from public.profiles as profile where profile.id = v_actor;
  -- The note's first line, cut at 120 characters, follows the pinned copy.
  if v_note is not null then
    v_first_line := regexp_replace(split_part(v_note, E'\n', 1), '[[:space:]]+$', '', 'g');
    if char_length(v_first_line) > 120 then
      v_first_line := left(v_first_line, 120) || '…';
    end if;
  end if;
  perform private.notify(
    array(select private.task_managers(p_task_id, v_actor)),
    'task'::public.noti_kind,
    'De verificat: ' || v_task.title,
    v_actor_name || ' a trimis taskul spre verificare.'
      || coalesce(' ' || v_first_line, ''),
    p_task_id, null, v_actor);
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

create function public.submit_task_for_review(
  p_task_id bigint, p_note text default null, p_link_label text default null, p_link_url text default null)
returns public.tasks
language sql
set search_path = ''
as $$
  select private.submit_task_for_review_impl(p_task_id, p_note, p_link_label, p_link_url);
$$;

revoke execute on function private.submit_task_for_review_impl(bigint, text, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.submit_task_for_review(bigint, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.submit_task_for_review_impl(bigint, text, text, text) to authenticated;
grant execute on function public.submit_task_for_review(bigint, text, text, text) to authenticated;

comment on function private.submit_task_for_review_impl(bigint, text, text, text) is
  'The Task''s own live active Executor moves it from in_progress to in_review, stamping submitted_at = now(); the actor is auth.uid(), never a parameter. Step 1, before the gate (#684, rulings R7/R8): the optional Submission Note is trimmed, blank -> null, at most 1000 characters (PT400 note_too_long); the optional Attached Link is judged by private.require_attached_link. private.require_task_executor is the entire authority rule (42501 task_executor_forbidden for a manager, a past Executor, or an Umbrella, which has no Assignment at all). PT409 task_not_in_progress for any other status. A resubmission after #337''s return_task_to_progress sets submitted_at again but never mentions review_round or returned_to_progress_at, so both survive untouched. Writes one submitted activity row carrying the active Assignment id, the in_progress -> in_review transition, the Submission Note as its note and the link as details.link_label/link_url (''{}'' without one), then notifies private.task_managers with the pinned "De verificat" copy naming the Executor, followed -- when there is a note -- by one space and the note''s first line cut at 120 characters with an ellipsis; the actor is dropped by private.notify.';

comment on function public.submit_task_for_review(bigint, text, text, text) is
  'Submit an in_progress Task you hold as its Executor for review, optionally with a Submission Note (at most 1000 characters) and one Attached Link (#684). Callable only by the Task''s live active Executor (42501 task_executor_forbidden otherwise, including on an Umbrella, which never has one) while the Task is in_progress (PT409 task_not_in_progress); a resubmission after being returned to progress is allowed and leaves review_round / returned_to_progress_at untouched. The note and link land on the submitted history row; the managers'' notification carries the note''s first line.';
