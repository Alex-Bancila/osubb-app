-- Ruling R46 (2026-10-07): up to five Attached Links on an Announcement (a Deal
-- included) and on a Task. Alex: "the posibility to add more links, and please add
-- this option to all links that exists for now".
--
-- Storage: announcements.links and tasks.links, a jsonb array of at most five
-- {"label": text, "url": text} objects, each judged by the existing one-link rule
-- (private.require_attached_link: label <= 60 non-blank, address ^https?:// <= 2048)
-- through private.require_attached_links, plus too_many_links.
--
-- The old single pair (announcements.form_label/form_url, tasks.link_label/
-- link_url) stays for ONE release: an app version cached from before this Release
-- still reads and writes it. It is backfilled into links here and, from now on,
-- mirrored both ways by a row trigger -- links[0] -> the pair when links is
-- written, the pair -> links[0] when only the pair is written (the old app). The
-- follow-up "Drop announcements.form_* and tasks.link_* after the links column has
-- shipped" removes the pair, the mirror and the legacy RPC parameters.
--
-- The Task commands take p_links jsonb default '[]' (create_task, update_task,
-- preview_task_update, create_completed_task, approve_completed_work_request) and
-- keep p_link_label / p_link_url, defaulting to null: when p_links is empty and the
-- pair is given, the pair is the one link. Each signature is extended in place
-- (dropped and re-created) so PostgREST never sees two overloads. The Submission
-- Note (submit_task_for_review) and a Group's application form stay single.

-- ==================== Columns, constraints, backfill ====================

alter table public.announcements
  add column links jsonb not null default '[]'::jsonb,
  add constraint announcements_links_ck
    check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 5);

alter table public.tasks
  add column links jsonb not null default '[]'::jsonb,
  add constraint tasks_links_ck
    check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 5);

comment on column public.announcements.links is
  'R46: the Announcement''s Attached Links, at most five {label, url} objects in display order. form_label/form_url mirror links[0] for one release.';
comment on column public.tasks.links is
  'R46: the Task''s Attached Links, at most five {label, url} objects in display order. link_label/link_url mirror links[0] for one release.';

-- Every stored pair already passed its constraints (announcements_form_link_ck,
-- tasks_link_format_ck), so it is copied as it is.
update public.announcements
   set links = jsonb_build_array(jsonb_build_object('label', form_label, 'url', form_url))
 where form_label is not null;

update public.tasks
   set links = jsonb_build_array(jsonb_build_object('label', link_label, 'url', link_url))
 where link_label is not null;

-- ==================== The list rule ====================

create function private.require_attached_links(p_links jsonb, p_label text default null, p_url text default null)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_element jsonb;
  v_label text;
  v_url text;
begin
  -- The legacy pair: an app version from before R46 sends only p_link_label /
  -- p_link_url (or form_label / form_url).
  if p_links is null or p_links = '[]'::jsonb then
    v_label := nullif(regexp_replace(coalesce(p_label, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
    v_url := nullif(regexp_replace(coalesce(p_url, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
    perform private.require_attached_link(v_label, v_url);
    if v_label is null then
      return '[]'::jsonb;
    end if;
    return jsonb_build_array(jsonb_build_object('label', v_label, 'url', v_url));
  end if;

  if jsonb_typeof(p_links) <> 'array' then
    raise sqlstate 'PT400' using message = 'invalid_links';
  end if;
  if jsonb_array_length(p_links) > 5 then
    raise sqlstate 'PT400' using message = 'too_many_links';
  end if;
  for v_element in select element from jsonb_array_elements(p_links) as list(element) loop
    if jsonb_typeof(v_element) <> 'object'
       or coalesce(jsonb_typeof(v_element -> 'label'), 'null') not in ('string', 'null')
       or coalesce(jsonb_typeof(v_element -> 'url'), 'null') not in ('string', 'null') then
      raise sqlstate 'PT400' using message = 'invalid_links';
    end if;
    v_label := nullif(regexp_replace(coalesce(v_element ->> 'label', ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
    v_url := nullif(regexp_replace(coalesce(v_element ->> 'url', ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
    perform private.require_attached_link(v_label, v_url);
    -- A row left wholly blank in the editor is no link, not an error.
    if v_label is not null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('label', v_label, 'url', v_url));
    end if;
  end loop;
  return v_out;
end;
$$;

comment on function private.require_attached_links(jsonb, text, text) is
  'R46: judges a list of Attached Links and returns it normalized -- each {label, url} trimmed, a wholly blank row dropped, only those two keys kept. PT400 invalid_links (not an array, an element not an object, a non-text value), too_many_links (more than five), and per link private.require_attached_link''s link_incomplete / link_label_too_long / link_url_too_long / link_url_invalid. An empty or null list falls back to the legacy pair (p_label, p_url), judged the same way, so an app version from before R46 keeps working for one release. Granted to nobody: the security-definer Task commands and announcements_guard_text call it.';

revoke execute on function private.require_attached_links(jsonb, text, text)
  from public, anon, authenticated, service_role;

-- ==================== Announcements: the row guard writes the mirror ====================

create or replace function private.guard_announcement_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pair_changed boolean;
begin
  new.title := regexp_replace(coalesce(new.title, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  new.body := regexp_replace(coalesce(new.body, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  new.form_label := nullif(regexp_replace(new.form_label, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  new.form_url := nullif(regexp_replace(new.form_url, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  if new.title = '' then
    raise exception using errcode = '23514', message = 'title_required';
  elsif char_length(new.title) < 3 then
    raise exception using errcode = '23514', message = 'title_too_short';
  elsif char_length(new.title) > 120 then
    raise exception using errcode = '23514', message = 'title_too_long';
  end if;
  if new.body = '' then
    raise exception using errcode = '23514', message = 'body_required';
  elsif char_length(new.body) > 2000 then
    raise exception using errcode = '23514', message = 'body_too_long';
  end if;

  -- R46: the list is the truth. The legacy pair is honoured only when a write
  -- left links untouched and changed the pair (an app version from before R46):
  -- on insert, an empty links with a pair; on update, the same links with a
  -- different pair, which replaces links[0] and keeps the rest.
  v_pair_changed := case
    when tg_op = 'INSERT' then
      coalesce(new.links, '[]'::jsonb) = '[]'::jsonb
      and (new.form_label is not null or new.form_url is not null)
    else
      new.links is not distinct from old.links
      and (new.form_label is distinct from old.form_label or new.form_url is distinct from old.form_url)
  end;
  begin
    if v_pair_changed then
      new.links := private.require_attached_links(null, new.form_label, new.form_url)
        || case when tg_op = 'UPDATE' and jsonb_array_length(old.links) > 1
                then old.links - 0 else '[]'::jsonb end;
    else
      new.links := private.require_attached_links(coalesce(new.links, '[]'::jsonb));
    end if;
    if jsonb_array_length(new.links) > 5 then
      raise sqlstate 'PT400' using message = 'too_many_links';
    end if;
  exception when sqlstate 'PT400' then
    -- A direct write names the rule as 23514, like every other row guard here.
    raise exception using errcode = '23514', message = sqlerrm;
  end;
  new.form_label := new.links -> 0 ->> 'label';
  new.form_url := new.links -> 0 ->> 'url';
  return new;
end;
$$;

comment on function private.guard_announcement_text() is
  '#673 (R8), R46: announcements_guard_text -- trims title and body, then names the rule a direct write breaks as 23514 title_required / title_too_short / title_too_long / body_required / body_too_long. R46: judges and normalizes links (private.require_attached_links: 23514 invalid_links / too_many_links / link_incomplete / link_label_too_long / link_url_too_long / link_url_invalid) and mirrors links[0] into form_label / form_url for one release; a write from an app version before R46 that changes only the pair has it taken as links[0] (an insert: the one link; an update: replacing the first and keeping the rest). The check constraints stay the invariant underneath. Security definer only so it may call the private helpers; it reads no table.';

-- ==================== Tasks: the mirror trigger ====================

create function private.mirror_task_links()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- R46: every Task command writes links (already judged by
  -- private.require_attached_links); the pair follows links[0]. A write that
  -- changes only the pair (none is left in this schema; kept so the pair can
  -- never drift) is taken as links[0].
  if (tg_op = 'INSERT'
      and new.links = '[]'::jsonb
      and new.link_label is not null)
     or (tg_op = 'UPDATE'
         and new.links is not distinct from old.links
         and (new.link_label is distinct from old.link_label
              or new.link_url is distinct from old.link_url)) then
    new.links := case when new.link_label is not null
                      then jsonb_build_array(jsonb_build_object('label', new.link_label, 'url', new.link_url))
                      else '[]'::jsonb end
              || case when tg_op = 'UPDATE' and jsonb_array_length(old.links) > 1
                      then old.links - 0 else '[]'::jsonb end;
  end if;
  new.link_label := new.links -> 0 ->> 'label';
  new.link_url := new.links -> 0 ->> 'url';
  return new;
end;
$$;

comment on function private.mirror_task_links() is
  'R46: tasks_mirror_links -- keeps the legacy tasks.link_label / link_url equal to links[0] for one release, so an app version from before R46 still reads a Task''s first Attached Link; a write that changes only the pair has it taken as links[0]. Trigger body, granted to nobody.';

revoke execute on function private.mirror_task_links()
  from public, anon, authenticated, service_role;

create trigger tasks_mirror_links
  before insert or update of links, link_label, link_url on public.tasks
  for each row execute function private.mirror_task_links();

-- ==================== Task commands: p_links ====================

drop function public.create_task(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text);
drop function private.create_task_impl(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text);
drop function public.update_task(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean);
drop function private.update_task_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean);
drop function public.preview_task_update(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text);
drop function private.preview_task_update_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text);
drop function private.plan_task_update(public.tasks, bigint, text, text, timestamptz, bigint, text, text, text, text);
drop function public.create_completed_task(uuid, bigint, text, text, text, text, bigint, integer, integer, text);
drop function private.create_completed_task_impl(uuid, bigint, text, text, text, text, bigint, integer, integer, text);
drop function public.approve_completed_work_request(bigint, integer, integer, text, text, text, bigint, text, text, bigint);
drop function private.approve_completed_work_request_impl(bigint, integer, integer, text, text, text, bigint, text, text, bigint);
drop function public.leadership_member_tasks(uuid, timestamptz, timestamptz);
drop function private.leadership_member_tasks_impl(uuid, timestamptz, timestamptz);

create function private.create_task_impl(p_title text, p_description text, p_deadline timestamp with time zone, p_audience text, p_assignment_mode text, p_executor_id uuid, p_campaign_id bigint, p_parent_task_id bigint, p_kind text, p_group_id bigint, p_link_label text, p_link_url text, p_links jsonb)
 returns public.tasks
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_parent public.tasks%rowtype;
  v_group bigint;
  v_title text;
  v_links jsonb;
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
  perform private.require_daily_cap('task_create', v_actor);
  begin
    insert into public.tasks (title, description, deadline, group_id,
                              audience, assignment_mode, campaign_id, parent_task_id, kind,
                              status, created_by, queue_opened_at, links)
    values (v_title, nullif(regexp_replace(coalesce(p_description, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
            p_deadline, v_group,
            p_audience, p_assignment_mode, p_campaign_id, p_parent_task_id, p_kind,
            'todo', v_actor, case when p_assignment_mode = 'public' then now() end,
            v_links)
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

comment on function private.create_task_impl(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb) is
  'Creates one Task, Subtask or Umbrella in a Group the live caller may manage (private.require_group_work_manager, 42501 task_manage_forbidden); the actor is auth.uid(), never a parameter. A top-level Task names its Group (PT400 task_group_required without one); a Subtask locks its Umbrella FOR NO KEY UPDATE, inherits its Group, and refuses a different p_group_id (subtask_origin_mismatch). A direct Executor must be activ and at or above the Group''s Minimum Level (invalid_executor). #684, R46: up to five Attached Links (p_links; or, from an app version before R46, the one pair p_link_label + p_link_url) are judged at step 1 by private.require_attached_links and stored in tasks.links; an Umbrella may carry them like any Task.';

create function public.create_task(p_title text, p_description text, p_deadline timestamp with time zone, p_audience text, p_assignment_mode text, p_executor_id uuid default null, p_campaign_id bigint default null, p_parent_task_id bigint default null, p_kind text default 'task', p_group_id bigint default null, p_link_label text default null, p_link_url text default null, p_links jsonb default '[]'::jsonb)
 returns public.tasks
 language sql
 set search_path to ''
as $function$
  select private.create_task_impl(p_title, p_description, p_deadline, p_audience, p_assignment_mode,
                                  p_executor_id, p_campaign_id, p_parent_task_id, p_kind, p_group_id,
                                  p_link_label, p_link_url, p_links);
$function$;

comment on function public.create_task(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb) is
  'Creates Group-owned work through live Group Manager/Responsible authority. The Group is the only Origin (#579): p_group_id for a top-level Task or Umbrella, inherited from the Umbrella for a Subtask. Subtasks lock the Umbrella FOR NO KEY UPDATE. R46: p_links sets up to five Attached Links ([{label, url}], PT400 invalid_links, too_many_links, link_incomplete, link_label_too_long, link_url_too_long, link_url_invalid); p_link_label + p_link_url, kept for one release, are the one link when p_links is empty.';

create function private.plan_task_update(p_task public.tasks, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_links jsonb)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
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
    'campaign_id', v_campaign_id, 'links', p_links,
    'changed', to_jsonb(v_changed), 'before', v_before, 'after', v_after);
end;
$function$;

comment on function private.plan_task_update(public.tasks, bigint, text, text, timestamptz, bigint, text, text, jsonb) is
  'Shared #627 full-state validator and audit diff. A real Group move needs an active target; same-Group edits retain the prior edit window even on archived Groups. Subtasks cannot move and Umbrellas with Subtasks cannot move. An existing Campaign incompatible with the target Group is normalized to null and included in the changed/before/after diff. R46: the Attached Links (p_links, normalized by private.require_attached_links at the caller''s step 1; an empty list clears them) are one field of the full state, named links in changed/before/after when they differ, and returned for the command to store.';

create function private.preview_task_update_impl(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text, p_link_url text, p_links jsonb)
 returns table(consequence text, member_id uuid)
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_task public.tasks%rowtype;
  v_links jsonb;
begin
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
  perform private.plan_task_update(v_task, p_group_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience, v_links);
  return query
    select c.consequence, c.member_id
      from private.task_update_consequences(p_task_id, p_group_id, p_campaign_id, p_assignment_mode, p_audience) as c;
end;
$function$;

comment on function private.preview_task_update_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb) is
  'Body behind public.preview_task_update (#626): the same step-1 checks as update_task (#673 lengths, R46 Attached Links), the same gate (PT404 task_not_found for an invisible Task, 42501 task_manage_forbidden for a non-manager), the same validation and refusals (private.plan_task_update), then the rows of private.task_update_consequences -- the one definition the command applies. Stable; writes and locks nothing.';

create function public.preview_task_update(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text default null, p_link_url text default null, p_links jsonb default null)
 returns table(consequence text, member_id uuid)
 language sql
 stable
 set search_path to ''
as $function$
  select * from private.preview_task_update_impl(p_task_id, p_group_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience, p_link_label, p_link_url, p_links);
$function$;

comment on function public.preview_task_update(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb) is
  'Lists public.update_task consequences for the same full state -- the Attached Links included (R46: p_links, or the legacy pair) -- without writes: executor_added_to_group, executor_removed, candidate_removed, and campaign_cleared (null member_id). No edit promotes a Candidate (#682). Refuses the same invalid state or authority.';

create function private.update_task_impl(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text, p_link_url text, p_accept_consequences boolean, p_links jsonb)
 returns public.tasks
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
begin
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
    p_campaign_id, p_assignment_mode, p_audience, v_links);
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
           links = v_plan -> 'links',
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

comment on function private.update_task_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb) is
  'Atomic #627 full-state Task update. Locks Umbrella then Task FOR NO KEY UPDATE; for a move, authorizes both Groups, locks both Groups in ID order, rechecks authority, and holds Executor/Candidate Profiles FOR SHARE before applying the shared consequence plan. PT409 task_update_needs_confirmation protects every listed consequence. Uses the #583 Appointment core, ends an ineligible Assignment (group_changed on a move, task_updated on Audience narrowing) and returns the Task to todo, closes ineligible Candidatures, clears an incompatible Campaign, and logs one task_updated activity with the accepted consequences and field diff. No Candidate is ever promoted (#682): the remaining queue stays pending for the manager to select from. R46: the Attached Links are part of the full state (p_links, a sent empty list clears them), judged at step 1 by private.require_attached_links. From an app version before R46, which sends only the pair p_link_label + p_link_url (p_links null), the pair replaces the first link and the others are kept, so an old app never deletes links it cannot show.';

create function public.update_task(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text default null, p_link_url text default null, p_accept_consequences boolean default false, p_links jsonb default null)
 returns public.tasks
 language sql
 set search_path to ''
as $function$
  select private.update_task_impl(p_task_id, p_group_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience, p_link_label, p_link_url, p_accept_consequences, p_links);
$function$;

comment on function public.update_task(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb) is
  'Sets every editable field, including Group and the Attached Links (R46: p_links, up to five, full state -- a sent empty list clears them; p_links not sent (null) is an app version from before R46: p_link_label + p_link_url, kept for one release, replace the first link and the others are kept), at once while todo or in_progress. A real Group move requires authority over source and target. Consequences require explicit acceptance after public.preview_task_update.';

create function private.create_completed_task_impl(p_executor_id uuid, p_group_id bigint, p_title text, p_description text, p_link_label text, p_link_url text, p_campaign_id bigint, p_difficulty integer, p_rating integer, p_note text, p_links jsonb)
 returns public.tasks
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_actor       uuid := (select auth.uid());
  v_note        text;
  v_title       text;
  v_description text;
  v_links       jsonb;
  v_task        public.tasks%rowtype;
  v_constraint  text;
begin
  -- 1. Malformed for every caller, before the gate: the Evaluation's three
  --    inputs (as every evaluating command hoists them) and the Task's text.
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 10 then
    raise sqlstate 'PT400' using message = 'invalid_difficulty';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise sqlstate 'PT400' using message = 'invalid_rating';
  end if;
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'evaluation_note_required';
  end if;
  v_note := regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  perform private.require_text_length('note', v_note, null, 1000);
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'title_required';
  end if;
  v_title := regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  perform private.require_text_length('title', v_title, 3, 120);
  v_description := nullif(regexp_replace(coalesce(p_description, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_text_length('description', v_description, null, 2000);
  v_links := private.require_attached_links(p_links, p_link_label, p_link_url);
  if p_group_id is null then
    raise sqlstate 'PT400' using message = 'task_group_required';
  end if;
  if p_executor_id is null then
    raise sqlstate 'PT400' using message = 'invalid_executor';
  end if;
  -- 2. The actor: a live activ Member with organization claims.
  if v_actor is null or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'task_command_forbidden';
  end if;
  -- 3. Authority and eligibility, under the share locks: create_task's
  --    manage gate, then the evaluator rule for this Executor.
  perform private.require_completed_work_group(p_group_id, p_executor_id,
    'task_manage_forbidden', 'task_evaluate_forbidden', true);
  -- 4. create_task's daily cap: this Task's 'created' row counts toward it.
  perform private.require_daily_cap('task_create', v_actor);
  -- 5. Mutate: the Task, then the Assignment and the Evaluation through the
  --    shared cores -- evaluate_task writes the points, nothing here does.
  begin
    insert into public.tasks
      (title, description, deadline, group_id, campaign_id,
       audience, assignment_mode, kind, status, created_by, links)
    values (v_title, v_description, now(), p_group_id, p_campaign_id,
            'local', 'direct', 'task', 'todo', v_actor, v_links)
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
    jsonb_build_object('kind', 'task', 'audience', 'local', 'assignment_mode', 'direct',
                       'campaign_id', p_campaign_id, 'executor_id', p_executor_id,
                       'completed_task', true));
  perform private.open_task_assignment(v_task.id, p_executor_id, v_actor, 'completed_task');
  perform private.evaluate_task(v_task.id, 'completed', p_difficulty, p_rating, v_note, v_actor);
  select * into v_task from public.tasks where id = v_task.id;
  return v_task;
end;
$function$;

comment on function private.create_completed_task_impl(uuid, bigint, text, text, text, text, bigint, integer, integer, text, jsonb) is
  '#915: records work a Member has already done as a completed Task in one transaction -- the Task (local, direct, deadlined now), the Assignment (private.open_task_assignment via ''completed_task'', which sends no "Task nou"), and the Evaluation and points (private.evaluate_task, whose "Task evaluat" is the Executor''s one Notification). Step 1: PT400 invalid_difficulty / invalid_rating / evaluation_note_required / note_too_long, title_required / title_too_short / title_too_long, description_too_long, the Attached Links reasons (R46: p_links, or the legacy pair), task_group_required, invalid_executor (null). Then 42501 task_command_forbidden (no claims or no live activ profile); private.require_completed_work_group: 42501 task_manage_forbidden, PT409 group_archived, PT400 invalid_executor, PT409 executor_role_excluded (BC/Moderator), PT409 executor_not_group_member, PT409 executor_below_min_level, 42501 task_evaluate_forbidden (the caller is not a decider for this Executor -- including the caller themselves); PT409 rate_limited (task_create); PT400 invalid_campaign.';

-- The trailing parameters gain defaults only so p_link_label / p_link_url may
-- default to null; a missing Difficulty, Rating or note is still PT400 at step 1.
create function public.create_completed_task(p_executor_id uuid, p_group_id bigint, p_title text, p_description text, p_link_label text default null, p_link_url text default null, p_campaign_id bigint default null, p_difficulty integer default null, p_rating integer default null, p_note text default null, p_links jsonb default '[]'::jsonb)
 returns public.tasks
 language sql
 set search_path to ''
as $function$
  select private.create_completed_task_impl(p_executor_id, p_group_id, p_title, p_description,
    p_link_label, p_link_url, p_campaign_id, p_difficulty, p_rating, p_note, p_links);
$function$;

comment on function public.create_completed_task(uuid, bigint, text, text, text, text, bigint, integer, integer, text, jsonb) is
  'Add a completed Task for a Group member ("Adaugă task finalizat", #915): the Task, its Assignment, its Evaluation and the Task Points, atomically. The caller manages work in the Group and decides this Executor''s work there; the Executor is an active member of the Group or of a Group below it, at or above its Minimum Level, never BC or the Moderator and never the caller. R46: p_links carries up to five Attached Links; p_link_label + p_link_url are kept for one release.';

create function private.approve_completed_work_request_impl(p_request_id bigint, p_difficulty integer, p_rating integer, p_note text, p_title text, p_description text, p_group_id bigint, p_link_label text, p_link_url text, p_campaign_id bigint, p_links jsonb)
 returns public.completed_work_requests
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_actor       uuid := (select auth.uid());
  v_note        text;
  v_title       text;
  v_description text;
  v_links       jsonb;
  v_group       bigint;
  v_request     public.completed_work_requests%rowtype;
  v_task        public.tasks%rowtype;
  v_points      integer;
  v_constraint  text;
  v_evaluation  bigint;
begin
  -- 1. Malformed for every caller, before the gate.
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 10 then
    raise sqlstate 'PT400' using message = 'invalid_difficulty';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise sqlstate 'PT400' using message = 'invalid_rating';
  end if;
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'evaluation_note_required';
  end if;
  v_note := regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  -- #673 (R8): measured as stored (trimmed).
  perform private.require_text_length('note', v_note, null, 1000);
  -- #915: the Task's shape, when the decider changes it. Null keeps the
  -- Request's value; a title, once given, cannot be blank.
  if p_title is not null then
    if p_title !~ '[^[:space:]]' then
      raise sqlstate 'PT400' using message = 'title_required';
    end if;
    v_title := regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g');
    perform private.require_text_length('title', v_title, 3, 120);
  end if;
  if p_description is not null then
    v_description := nullif(regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
    perform private.require_text_length('description', v_description, null, 2000);
  end if;
  -- R46: up to five Attached Links, or the legacy pair.
  v_links := private.require_attached_links(p_links, p_link_label, p_link_url);
  -- 2. The actor.
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'request_command_forbidden';
  end if;
  -- 3. The Request, locked; hidden and missing are one answer.
  select * into v_request from public.completed_work_requests
   where id = p_request_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;
  if v_request.requester_id is distinct from v_actor
     and not coalesce(private.can_manage_group_work(v_request.group_id), false) then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;
  -- 4. Authority over the Request as filed, then its state.
  perform private.require_request_decider(p_request_id);
  if v_request.status <> 'pending' then
    raise sqlstate 'PT409' using message = 'request_not_pending';
  end if;
  -- 5. #915: another Group is judged by the rule create_completed_task uses.
  v_group := coalesce(p_group_id, v_request.group_id);
  if v_group is distinct from v_request.group_id then
    perform private.require_completed_work_group(v_group, v_request.requester_id,
      'request_decide_forbidden', 'request_decide_forbidden', false);
  end if;
  -- 6. Mutate: the Task as shaped, then the shared cores.
  begin
    insert into public.tasks
      (title, description, deadline, group_id, campaign_id,
       audience, assignment_mode, status, created_by, links)
    values (coalesce(v_title, left(v_request.description, 120)),
            case when p_description is null then v_request.description else v_description end,
            now(), v_group, p_campaign_id,
            'local', 'direct', 'todo', v_actor, v_links)
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
    jsonb_build_object('from_request_id', p_request_id));
  perform private.open_task_assignment(v_task.id, v_request.requester_id, v_actor, 'request_approval');
  v_evaluation := private.evaluate_task(v_task.id, 'completed', p_difficulty, p_rating, v_note, v_actor);

  update public.completed_work_requests
     set status        = 'approved',
         decided_by    = v_actor,
         decided_at    = now(),
         decision_note = v_note,
         task_id       = v_task.id
   where id = p_request_id;
  -- #985: the award as private.evaluate_task wrote it, never recomputed here.
  select evaluation.points into v_points
    from public.task_evaluations as evaluation where evaluation.id = v_evaluation;
  perform private.notify(array[v_request.requester_id], 'task'::public.noti_kind,
    'Cerere aprobată: ' || left(v_request.description, 60),
    case when abs(v_points) = 1 then v_points || ' punct'
         when abs(v_points) = 0 or abs(v_points) % 100 between 1 and 19 then v_points || ' puncte'
         else v_points || ' de puncte' end
      || ' (dificultate ' || p_difficulty || ', calificativ ' || p_rating || ').',
    v_task.id, null, v_actor);

  select * into v_request from public.completed_work_requests where id = p_request_id;
  return v_request;
end;
$function$;

comment on function private.approve_completed_work_request_impl(bigint, integer, integer, text, text, text, bigint, text, text, bigint, jsonb) is
  'Approves one pending Completed-work Request and, in the same transaction, creates the completed Task it recognizes, shaped by the decider (#915): p_title (default the description''s first 120 characters), p_description (default the Request''s description; blank clears it), p_group_id (default the Request''s Group), the Attached Links (R46: p_links, or the legacy pair p_link_label/p_link_url) and p_campaign_id (default none). The Task is local, direct, deadlined at the approval instant; the requester is opened as its Executor via private.open_task_assignment(..., ''request_approval'') and private.evaluate_task writes the Evaluation, the points, the terminal state and the ended Assignment. Step 1 (before the gate): PT400 invalid_difficulty / invalid_rating / evaluation_note_required / note_too_long, title_required / title_too_short / title_too_long, description_too_long and the Attached Links reasons. Then 42501 request_command_forbidden; the Request locked FOR UPDATE; PT404 request_not_found when missing or unreadable; 42501 request_decide_forbidden (private.require_request_decider); PT409 request_not_pending. A different Group passes private.require_completed_work_group with request_decide_forbidden for both authority refusals: PT409 group_archived, PT400 invalid_executor, PT409 executor_not_group_member / executor_below_min_level. A Campaign that cannot tag a Task of the Group is PT400 invalid_campaign. The requester is then notified of the decision.';

create function public.approve_completed_work_request(p_request_id bigint, p_difficulty integer, p_rating integer, p_note text, p_title text default null, p_description text default null, p_group_id bigint default null, p_link_label text default null, p_link_url text default null, p_campaign_id bigint default null, p_links jsonb default '[]'::jsonb)
 returns public.completed_work_requests
 language sql
 set search_path to ''
as $function$
  select private.approve_completed_work_request_impl(p_request_id, p_difficulty, p_rating, p_note,
    p_title, p_description, p_group_id, p_link_label, p_link_url, p_campaign_id, p_links);
$function$;

comment on function public.approve_completed_work_request(bigint, integer, integer, text, text, text, bigint, text, text, bigint, jsonb) is
  'Approve a Completed-work Request: creates the completed Task it describes -- with the title, details, Group, Attached Links (R46: p_links, up to five; the pair kept for one release) and Campaign the decider chose (#915; each null keeps the Request''s value) -- credits the requester Difficulty x the Rating multiplier, and records the decision, atomically. Callable only by the Request''s decider; a different Group must be one the decider may decide the requester''s work in, active, with the requester a member of it or of a Group below it at or above its Minimum Level. Difficulty is 1..10 (its base points x the Rating multiplier) and Rating 1..5 and a non-blank note is required. Two concurrent approvals leave exactly one Task: the second waits on the Request row and then receives PT409 request_not_pending.';

-- duplicate_task copies the list; the pair follows through tasks_mirror_links.
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
    links)
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
    v_source.links)
  returning * into v_clone;

  perform private.log_task_activity(v_clone.id, 'created', v_actor, null, null, 'todo'::public.task_status, null,
    jsonb_build_object('duplicated_from_task_id', p_task_id));
  perform private.log_task_activity(p_task_id, 'duplicated', v_actor, null, null, null, null,
    jsonb_build_object('clone_task_id', v_clone.id));

  select * into v_clone from public.tasks where id = v_clone.id;
  return v_clone;
end;
$function$;

create function private.leadership_member_tasks_impl(p_member_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 returns table(assignment_id bigint, member_id uuid, assigned_at timestamp with time zone, assigned_by uuid, assignment_ended_at timestamp with time zone, assignment_end_reason text, assignment_end_note text, task_id bigint, title text, description text, link_label text, link_url text, links jsonb, deadline timestamp with time zone, task_kind text, audience text, assignment_mode text, status public.task_status, is_overdue boolean, completed_late boolean, difficulty integer, rating integer, started_at timestamp with time zone, submitted_at timestamp with time zone, review_round integer, returned_to_progress_at timestamp with time zone, completed_at timestamp with time zone, unfulfilled_at timestamp with time zone, cancelled_at timestamp with time zone, cancel_reason text, queue_opened_at timestamp with time zone, queue_closed_at timestamp with time zone, task_created_at timestamp with time zone, task_created_by uuid, duplicated_from_task_id bigint, group_id bigint, group_name text, campaign_id bigint, campaign_name text, parent_task_id bigint, parent_task_title text, subtasks jsonb, evaluation_history jsonb)
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

create function public.leadership_member_tasks(p_member_id uuid, p_from timestamp with time zone default null, p_to timestamp with time zone default null)
 returns table(assignment_id bigint, member_id uuid, assigned_at timestamp with time zone, assigned_by uuid, assignment_ended_at timestamp with time zone, assignment_end_reason text, assignment_end_note text, task_id bigint, title text, description text, link_label text, link_url text, links jsonb, deadline timestamp with time zone, task_kind text, audience text, assignment_mode text, status public.task_status, is_overdue boolean, completed_late boolean, difficulty integer, rating integer, started_at timestamp with time zone, submitted_at timestamp with time zone, review_round integer, returned_to_progress_at timestamp with time zone, completed_at timestamp with time zone, unfulfilled_at timestamp with time zone, cancelled_at timestamp with time zone, cancel_reason text, queue_opened_at timestamp with time zone, queue_closed_at timestamp with time zone, task_created_at timestamp with time zone, task_created_by uuid, duplicated_from_task_id bigint, group_id bigint, group_name text, campaign_id bigint, campaign_name text, parent_task_id bigint, parent_task_title text, subtasks jsonb, evaluation_history jsonb)
 language sql
 stable
 set search_path to ''
as $function$
  select * from private.leadership_member_tasks_impl(p_member_id, p_from, p_to);
$function$;

comment on function private.leadership_member_tasks_impl(uuid, timestamptz, timestamptz) is
  'One row per selected Member Assignment, newest first, labelled by the Task''s owning Group and carrying the Task''s Attached Links (#947; R46: links, with the legacy link_label / link_url = links[0] for one release), optionally narrowed to Task deadlines in [p_from, p_to) (#677); PT400 invalid_date_range first when p_to < p_from. A Task whose Group the caller cannot see (private.can_see_group, #756/#759) is omitted, so a BCE drilling into a Member never learns of their work in a Private Group; BC/Moderator see every row.';
comment on function public.leadership_member_tasks(uuid, timestamptz, timestamptz) is
  'Live BCE+ Assignment history with the owning Group''s id and name, the Task''s Attached Links (links; R46 -- link_label, link_url = the first, kept for one release; #947), plus Task and Evaluation history. The date range (#677, R11) keeps only Assignments whose Task deadline is in [p_from, p_to); a Task with no deadline is excluded whenever either bound is set. PT400 invalid_date_range when p_to < p_from. Assignments of a Task in a Private Group the caller cannot see are omitted (#759, ruling R25).';

-- R46: the edit's changed-field label for the list.
create or replace function private.task_field_labels(p_fields text[])
 returns text
 language sql
 immutable parallel safe
 set search_path to ''
as $function$
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
             end as label
        from pg_catalog.unnest(p_fields) with ordinality as field(name, ord)
    ) as labelled
   where labelled.label is not null;
$function$;

-- ==================== Grants ====================

revoke execute on function private.create_task_impl(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.create_task(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function private.plan_task_update(public.tasks, bigint, text, text, timestamptz, bigint, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function private.preview_task_update_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.preview_task_update(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function private.update_task_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.update_task(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function private.create_completed_task_impl(uuid, bigint, text, text, text, text, bigint, integer, integer, text, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.create_completed_task(uuid, bigint, text, text, text, text, bigint, integer, integer, text, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function private.approve_completed_work_request_impl(bigint, integer, integer, text, text, text, bigint, text, text, bigint, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.approve_completed_work_request(bigint, integer, integer, text, text, text, bigint, text, text, bigint, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function private.leadership_member_tasks_impl(uuid, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
revoke execute on function public.leadership_member_tasks(uuid, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function private.create_task_impl(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb) to authenticated;
grant execute on function public.create_task(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb) to authenticated;
grant execute on function private.preview_task_update_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb) to authenticated;
grant execute on function public.preview_task_update(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, jsonb) to authenticated;
grant execute on function private.update_task_impl(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb) to authenticated;
grant execute on function public.update_task(bigint, bigint, text, text, timestamptz, bigint, text, text, text, text, boolean, jsonb) to authenticated;
grant execute on function private.create_completed_task_impl(uuid, bigint, text, text, text, text, bigint, integer, integer, text, jsonb) to authenticated;
grant execute on function public.create_completed_task(uuid, bigint, text, text, text, text, bigint, integer, integer, text, jsonb) to authenticated;
grant execute on function private.approve_completed_work_request_impl(bigint, integer, integer, text, text, text, bigint, text, text, bigint, jsonb) to authenticated;
grant execute on function public.approve_completed_work_request(bigint, integer, integer, text, text, text, bigint, text, text, bigint, jsonb) to authenticated;
grant execute on function private.leadership_member_tasks_impl(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.leadership_member_tasks(uuid, timestamptz, timestamptz) to authenticated;
