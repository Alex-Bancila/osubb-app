-- #891 (final QA audit F-3): Task notifications speak Romanian.
--
-- An edit notification named the changed fields by their column names
-- ("Modificat: title, deadline."), while the Task history of the same edit
-- says "Task actualizat: titlu, termen" (app/src/screens/tracker/TaskHistory.tsx).
-- The assignment notification said "Deadline:", and CONTEXT.md and every
-- screen call that field "Termen".
--
-- 1. private.task_field_labels: the one map from a changed-field name to its
--    Romanian label, lower-cased and identical to TaskHistory.tsx's `fields`.
--    Both edit bodies (update_task_impl and update_task_content_impl) read it.
-- 2. private.update_task_impl and private.update_task_content_impl: the
--    "Modificat: ..." body goes through the map.
-- 3. private.open_task_assignment: "Deadline:" becomes "Termen:"; the date
--    format and the "—" fallback stay.
--
-- The three bodies are rebuilt from main's latest definitions
-- (pg_get_functiondef on a fresh reset at 20260929090000; latest sources
-- 20260924010111_attached_link_submission_note.sql for update_task_impl,
-- 20260923231125_constraints_kit.sql for update_task_content_impl,
-- 20260924000120_queue_no_first_come.sql for open_task_assignment). Only the
-- notification text changes. `create or replace` keeps each function's
-- owner, grants and comment. No signature changes, so the generated types
-- stay the same. Sent rows are not backfilled: production has none, and
-- staging's demo rows come from seed.sql.

create function private.task_field_labels(p_fields text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
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
             end as label
        from pg_catalog.unnest(p_fields) with ordinality as field(name, ord)
    ) as labelled
   where labelled.label is not null;
$$;
comment on function private.task_field_labels(text[]) is
  '#891 (F-3): the Romanian labels of a Task edit''s changed fields, comma-separated in the server''s order -- the one place the map lives, read by update_task_impl and update_task_content_impl. A helper rather than an inline case because two bodies need it and the labels must match TaskHistory.tsx in both. A name without a label is left out, never printed raw; a list with no labelled name reads "detalii". Granted to nobody: only the security-definer edit bodies call it.';
revoke execute on function private.task_field_labels(text[])
  from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.update_task_impl(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text, p_link_url text, p_accept_consequences boolean)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      'Modificat: ' || private.task_field_labels(array(select jsonb_array_elements_text(v_plan -> 'changed'))) || '.',
      p_task_id, null, v_actor);
  end if;
  return v_task;
end;
$function$;

CREATE OR REPLACE FUNCTION private.update_task_content_impl(p_task_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
  v_title text;
  v_description text;
  v_executor uuid;
  v_changed text[] := '{}'::text[];
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_constraint text;
begin
  -- 1. #673 (R8): malformed for every caller, measured as stored (trimmed).
  perform private.require_text_length('title',
    regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g'), 3, 120);
  perform private.require_text_length('description',
    regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 2000);
  -- 2. Gate + visibility
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked)
  select * into v_task from public.tasks where id = p_task_id for update;
  -- 4. Authority under lock
  perform private.require_task_manager(p_task_id);
  -- 5. Input validation (PT400)
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'title_required';
  end if;
  v_title := regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_description := nullif(regexp_replace(coalesce(p_description, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  if v_task.kind = 'task' and p_deadline is null then
    raise sqlstate 'PT400' using message = 'deadline_required';
  end if;
  if v_task.kind = 'umbrella' and p_campaign_id is not null then
    raise sqlstate 'PT400' using message = 'umbrella_has_no_campaign';
  end if;
  -- 6. State preconditions (PT409)
  if v_task.status in ('completed', 'unfulfilled', 'cancelled') then
    raise sqlstate 'PT409' using message = 'task_terminal';
  end if;
  if v_title is distinct from v_task.title then
    v_changed := array_append(v_changed, 'title');
    v_before := v_before || jsonb_build_object('title', v_task.title);
    v_after := v_after || jsonb_build_object('title', v_title);
  end if;
  if v_description is distinct from v_task.description then
    v_changed := array_append(v_changed, 'description');
    v_before := v_before || jsonb_build_object('description', v_task.description);
    v_after := v_after || jsonb_build_object('description', v_description);
  end if;
  if p_deadline is distinct from v_task.deadline then
    v_changed := array_append(v_changed, 'deadline');
    v_before := v_before || jsonb_build_object('deadline', v_task.deadline);
    v_after := v_after || jsonb_build_object('deadline', p_deadline);
  end if;
  if p_campaign_id is distinct from v_task.campaign_id then
    v_changed := array_append(v_changed, 'campaign_id');
    v_before := v_before || jsonb_build_object('campaign_id', v_task.campaign_id);
    v_after := v_after || jsonb_build_object('campaign_id', p_campaign_id);
  end if;
  if array_length(v_changed, 1) is null then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;
  -- 7. Mutate, then activity, then notify, then return
  begin
    update public.tasks
       set title = v_title, description = v_description, deadline = p_deadline, campaign_id = p_campaign_id
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
      -- private.validate_task_campaign (20260911210600) raises errcode 23514
      -- with exactly these two reasons; any other 23514 is a caller bug and
      -- propagates unchanged (create_task_impl precedent).
      if sqlerrm in ('task_campaign_origin_mismatch', 'task_campaign_inactive') then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
  end;
  perform private.log_task_activity(p_task_id, 'content_updated', v_actor, null, null, null, null,
    jsonb_build_object('changed', v_changed, 'before', v_before, 'after', v_after));
  select member_id into v_executor from public.task_assignments where task_id = p_task_id and ended_at is null;
  if v_executor is not null then
    perform private.notify(array[v_executor], 'task'::public.noti_kind, 'Task actualizat: ' || v_task.title,
      'Modificat: ' || private.task_field_labels(v_changed) || '.', p_task_id, null, v_actor);
  end if;
  return v_task;
end;
$function$;

CREATE OR REPLACE FUNCTION private.open_task_assignment(p_task_id bigint, p_member_id uuid, p_actor uuid, p_via text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id bigint;
  v_title text;
  v_deadline timestamptz;
begin
  -- Closed allow-list: details.via is a pinned structured fact, not free
  -- text. A null or unknown via -- including the two arrival-based paths
  -- #682 retired -- is a caller bug, not a silent no-notification.
  if p_via is null or p_via not in
     ('create', 'assign', 'select', 'reopen', 'request_approval') then
    raise sqlstate 'PT400' using message = 'invalid_assignment_via';
  end if;
  if not exists (select 1 from public.profiles as p where p.id = p_member_id and p.status = 'activ') then
    raise sqlstate 'PT400' using message = 'invalid_executor';
  end if;
  insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
  values (p_task_id, p_member_id, p_actor, now())
  returning id into v_id;
  perform private.log_task_activity(p_task_id, 'executor_assigned', p_actor, v_id, null, null, null,
    jsonb_build_object('via', p_via, 'member_id', p_member_id));
  -- 'reopen' reactivates a past Executor and sends its own "Task redeschis"
  -- notification; every other path announces the new Task. `is distinct
  -- from` (not `<>`) so a null p_via -- already rejected above, but kept
  -- explicit here for defense in depth -- cannot silently skip it.
  if p_via is distinct from 'reopen' then
    select title, deadline into v_title, v_deadline from public.tasks where id = p_task_id;
    perform private.notify(array[p_member_id], 'task'::public.noti_kind,
      'Task nou: ' || v_title,
      'Ți-a fost atribuit acest task. Termen: ' || coalesce(to_char(v_deadline at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI'), '—') || '.',
      p_task_id, null, p_actor);
  end if;
  return v_id;
end;
$function$;
