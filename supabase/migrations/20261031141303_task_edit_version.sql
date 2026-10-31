-- #1132: a stale Task edit is refused -- tasks.updated_at and p_updated_at on update_task / preview_task_update.
--
-- Audit finding M12 (docs/review/2026-10-30-codebase-audit.md). The edit form
-- is a full-state replace, and while it is open the details query is refetched
-- by live changes, so a save from a form opened before someone else's edit put
-- every field back to what the first Manager saw -- and because the form
-- recomputed its initial deadline from the live row, it even invented a
-- deadline change nobody typed. The command had no version argument.
--
-- The finding's note that tasks.updated_at already existed was wrong: no
-- migration ever added one (public.tasks had created_at only). Conventions
-- section 7: updated_at belongs to tables whose rows are edited in place,
-- maintained by the shared private.set_updated_at trigger -- so this file
-- adds the column, stamped on every update by that trigger, and the version
-- argument on both commands. Existing rows take the migration's instant as
-- their first version: no backfill, because an UPDATE of every Task would run
-- the row guards (tasks_validate_campaign and the hierarchy check) over
-- legacy rows and broadcast one live change per row, for a value nothing
-- reads as history. No updated_at >= created_at check either: the Group and
-- Project tables carry one, and the only way it ever fails is the local VM's
-- clock stepping back between now() and clock_timestamp() inside one
-- transaction (a recorded test flake); a version stamp needs no ordering.
--
-- Both _impl bodies are main's latest (20261020213926_formatted_text.sql) and
-- both wrappers main's latest (20261014225803_task_min_level.sql), each with
-- p_updated_at timestamptz last and one block added: under the Task lock
-- (the preview against the row it reads), p_updated_at distinct from
-- tasks.updated_at is PT409 task_changed, judged right after authority and
-- before every other state rule, so a stale form hears that before
-- nothing_to_update or a consequence; null -- the default on the wrappers --
-- skips the check for a caller that sends no version (the smoke script, an
-- installed client from before this release). The old signatures are dropped
-- so each command keeps one overload. The tracker_grants roster and
-- update_task.test.sql's API-shape pins move to the new signatures;
-- supabase/tests/update_task_version.test.sql failed before this file.

-- ==================== The version column ====================
alter table public.tasks
  add column updated_at timestamptz not null default now();

comment on column public.tasks.updated_at is
  'When the row last changed, stamped by private.set_updated_at on every update (#1132): the version the edit form was seeded from and sends back as p_updated_at, so a form opened before someone else''s save is refused (PT409 task_changed) instead of applied over it. Rows from before #1132 carry the instant that migration ran.';

create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function private.set_updated_at();

-- ==================== The old signatures go ====================
drop function public.update_task(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb, integer);
drop function public.preview_task_update(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb, integer);
drop function private.update_task_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb, integer);
drop function private.preview_task_update_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb, integer);

-- ==================== private.update_task_impl ====================
create function private.update_task_impl(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text, p_link_url text, p_accept_consequences boolean, p_links jsonb, p_min_level integer, p_updated_at timestamp with time zone)
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
  perform private.require_formatted_text_length('description',
    regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g'));
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
  -- #1132 (audit M12): the version the form was seeded from, judged first
  -- among the state rules and under the lock: a form opened before someone
  -- else's save is refused whole, never applied over their change. Null is
  -- a caller that sends no version (the smoke script, an installed client
  -- from before this release) and skips the check.
  if p_updated_at is not null and p_updated_at is distinct from v_task.updated_at then
    raise sqlstate 'PT409' using message = 'task_changed';
  end if;
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


comment on function private.update_task_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb, integer, timestamptz) is
  'Atomic #627 full-state Task update. Locks Umbrella then Task FOR NO KEY UPDATE; for a move, authorizes both Groups, locks both Groups in ID order, rechecks authority, and holds Executor/Candidate Profiles FOR SHARE before applying the shared consequence plan. PT409 task_update_needs_confirmation protects every listed consequence. Uses the #583 Appointment core, ends an ineligible Assignment (group_changed on a move, task_updated on Audience narrowing) and returns the Task to todo, closes ineligible Candidatures, clears an incompatible Campaign, and logs one task_updated activity with the accepted consequences and field diff. No Candidate is ever promoted (#682): the remaining queue stays pending for the manager to select from. R46: the Attached Links are part of the full state (p_links, a sent empty list clears them), judged at step 1 by private.require_attached_links. From an app version before R46, which sends only the pair p_link_label + p_link_url (p_links null), the pair replaces the first link and the others are kept, so an old app never deletes links it cannot show. R57 (2026-10-14): p_min_level, the Task''s Minimum Level (null keeps it; a direct Task or an Umbrella is stored at 0; PT400 invalid_task_min_level off the ladder, task_min_level_above_actor when the editor is below the stored or the new value, a change to Direct included). Raising it removes the waiting Candidates and the Executor below it, as consequences to confirm (task_update_needs_confirmation). #1132 (audit M12): p_updated_at, the tasks.updated_at the form was seeded from -- PT409 task_changed when it differs from the row''s, judged right after authority and before every other state rule; null (the default) skips the check.';

-- ==================== private.preview_task_update_impl ====================
create function private.preview_task_update_impl(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text, p_link_url text, p_links jsonb, p_min_level integer, p_updated_at timestamp with time zone)
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
  perform private.require_formatted_text_length('description',
    regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g'));
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
  -- #1132 (audit M12): the command's version rule, against the row this
  -- stable function read -- so the preview refuses exactly what the save
  -- would, before listing any consequence.
  if p_updated_at is not null and p_updated_at is distinct from v_task.updated_at then
    raise sqlstate 'PT409' using message = 'task_changed';
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


comment on function private.preview_task_update_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb, integer, timestamptz) is
  'Body behind public.preview_task_update (#626): the same step-1 checks as update_task (#673 lengths, R46 Attached Links), the same gate (PT404 task_not_found for an invisible Task, 42501 task_manage_forbidden for a non-manager), the same validation and refusals (private.plan_task_update), then the rows of private.task_update_consequences -- the one definition the command applies. Stable; writes and locks nothing. R57 (2026-10-14): p_min_level, the Task''s Minimum Level (null keeps it; a direct Task or an Umbrella is stored at 0; PT400 invalid_task_min_level off the ladder, task_min_level_above_actor when the editor is below the stored or the new value, a change to Direct included). Raising it removes the waiting Candidates and the Executor below it, as consequences to confirm (task_update_needs_confirmation). #1132 (audit M12): p_updated_at, the tasks.updated_at the form was seeded from -- PT409 task_changed when it differs from the row''s, judged right after authority and before every other state rule; null (the default) skips the check.';

-- ==================== public wrappers ====================
create function public.update_task(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text DEFAULT NULL::text, p_link_url text DEFAULT NULL::text, p_accept_consequences boolean DEFAULT false, p_links jsonb DEFAULT NULL::jsonb, p_min_level integer DEFAULT NULL::integer, p_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS public.tasks
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select private.update_task_impl(p_task_id, p_group_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience, p_link_label, p_link_url, p_accept_consequences, p_links, p_min_level, p_updated_at);
$function$;


comment on function public.update_task(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb, integer, timestamptz) is
  'Sets every editable field, including Group and the Attached Links (R46: p_links, up to five, full state -- a sent empty list clears them; p_links not sent (null) is an app version from before R46: p_link_label + p_link_url, kept for one release, replace the first link and the others are kept), at once while todo or in_progress. A real Group move requires authority over source and target. Consequences require explicit acceptance after public.preview_task_update. R57 (2026-10-14): p_min_level, the Task''s Minimum Level (null keeps it; a direct Task or an Umbrella is stored at 0; PT400 invalid_task_min_level off the ladder, task_min_level_above_actor when the editor is below the stored or the new value, a change to Direct included). Raising it removes the waiting Candidates and the Executor below it, as consequences to confirm (task_update_needs_confirmation). #1132 (audit M12): p_updated_at, the tasks.updated_at the form was seeded from -- PT409 task_changed when it differs from the row''s, judged right after authority and before every other state rule; null (the default) skips the check.';

create function public.preview_task_update(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text DEFAULT NULL::text, p_link_url text DEFAULT NULL::text, p_links jsonb DEFAULT NULL::jsonb, p_min_level integer DEFAULT NULL::integer, p_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(consequence text, member_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select * from private.preview_task_update_impl(p_task_id, p_group_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience, p_link_label, p_link_url, p_links, p_min_level, p_updated_at);
$function$;


comment on function public.preview_task_update(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb, integer, timestamptz) is
  'Lists public.update_task consequences for the same full state -- the Attached Links included (R46: p_links, or the legacy pair) -- without writes: executor_added_to_group, executor_removed, candidate_removed, and campaign_cleared (null member_id). No edit promotes a Candidate (#682). Refuses the same invalid state or authority. R57 (2026-10-14): p_min_level, the Task''s Minimum Level (null keeps it; a direct Task or an Umbrella is stored at 0; PT400 invalid_task_min_level off the ladder, task_min_level_above_actor when the editor is below the stored or the new value, a change to Direct included). Raising it removes the waiting Candidates and the Executor below it, as consequences to confirm (task_update_needs_confirmation). #1132 (audit M12): p_updated_at, the tasks.updated_at the form was seeded from -- PT409 task_changed when it differs from the row''s, judged right after authority and before every other state rule; null (the default) skips the check.';

-- ==================== Grants (conventions Sec4, four-role form) ====================
revoke execute on function private.update_task_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb, integer, timestamptz)
  from public, anon, authenticated, service_role;
revoke execute on function private.preview_task_update_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb, integer, timestamptz)
  from public, anon, authenticated, service_role;
revoke execute on function public.update_task(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb, integer, timestamptz)
  from public, anon, authenticated, service_role;
revoke execute on function public.preview_task_update(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb, integer, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function private.update_task_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb, integer, timestamptz) to authenticated;
grant execute on function private.preview_task_update_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb, integer, timestamptz) to authenticated;
grant execute on function public.update_task(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb, integer, timestamptz) to authenticated;
grant execute on function public.preview_task_update(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb, integer, timestamptz) to authenticated;
