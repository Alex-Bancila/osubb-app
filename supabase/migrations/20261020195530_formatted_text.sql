-- R60: Formatted Text, the server's half.
--
-- Four fields carry a restricted Markdown (Announcement body, Task and Event
-- description, Group description). The database never renders it; it only
-- needs the words, so the visible-length limits count them and a Notification
-- carries them. The sections below build that in the order the later ones use:
--
--   1. private.formatted_text_plain, the stripper.
--   2. The visible-length limits: private.require_formatted_text_length, the
--      three stored caps, the announcements row guard and the Task and Event
--      commands.
--   3. Plain Notifications and the Event copy: private.notify_announcement
--      hands over the words of the body, and private.event_announcement_body
--      cuts a long description at whole lines.

-- ==================== 1. private.formatted_text_plain (R60) ====================

-- Markdown in, plain words out. A regexp chain whose order matters: block
-- markers first (they are anchored at a line start), then links and the paired
-- inline markers, and the backslash escapes last so an escaped marker survives
-- every pattern before it. Each pattern that anchors on `^` runs newline-
-- sensitive ('n'), so `^` means the start of a line and a bracket expression
-- never crosses one. The single-character markers (`*`, `_`, `~`) only pair at
-- a word boundary, so `5*3*2`, `nume_prenume` and `ăla*b*` stay as typed; a
-- word character is spelled out as 0-9, A-Z, a-z and U+00C0-U+024F (every
-- Romanian letter) rather than [[:alnum:]], and a space is spelled out as
-- space, tab, newline, carriage return, form feed and vertical tab rather than
-- [[:space:]] (which counts U+2003 and U+2028 under some locales), so the
-- result never depends on the database locale and the TypeScript twin spells
-- the same two classes. The TypeScript twin (toPlainText) runs the same chain,
-- and both are tested against the fixture lines of
-- supabase/tests/formatted_text_plain.test.sql.
create function private.formatted_text_plain(p_text text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v text;
begin
  if p_text is null then
    return null;
  end if;

  v := replace(p_text, E'\r\n', E'\n');
  -- Headings and quotes lose their marker; list markers become a bullet
  -- (a numbered item keeps its number).
  v := regexp_replace(v, '^[ \t]*#{1,6}[ \t]+', '', 'gn');
  v := regexp_replace(v, '^[ \t]*>[ \t]?', '', 'gn');
  v := regexp_replace(v, '^([ \t]*)[-*+][ \t]+', '\1• ', 'gn');
  -- A Text Link shows its words; only http(s) is a link, so [x](javascript:..)
  -- stays text.
  v := regexp_replace(v, '\[([^]\n]*)\]\((https?://[^) \t\n\r\f\v]+)\)', '\1', 'g');
  -- Paired markers. The doubled ones pair anywhere on a line; the single
  -- ones only at a word boundary.
  v := regexp_replace(v, '\*\*([^*\n]+)\*\*', '\1', 'g');
  v := regexp_replace(v, '~~([^~\n]+)~~', '\1', 'g');
  v := regexp_replace(v, '==([^=\n]+)==', '\1', 'g');
  v := regexp_replace(v, '(^|[^0-9A-Za-zÀ-ɏ*\\])\*([^* \t\n\r\f\v]([^*\n]*[^* \t\n\r\f\v])?)\*(?![0-9A-Za-zÀ-ɏ*])', '\1\2', 'gn');
  v := regexp_replace(v, '(^|[^0-9A-Za-zÀ-ɏ_\\])_([^_ \t\n\r\f\v]([^_\n]*[^_ \t\n\r\f\v])?)_(?![0-9A-Za-zÀ-ɏ_])', '\1\2', 'gn');
  v := regexp_replace(v, '(^|[^0-9A-Za-zÀ-ɏ~\\])~([^~ \t\n\r\f\v]([^~\n]*[^~ \t\n\r\f\v])?)~(?![0-9A-Za-zÀ-ɏ~])', '\1\2', 'gn');
  -- A backslash escape shows the escaped character.
  v := regexp_replace(v, '\\([\\`*_{}\[\]()#+.!~=>|-])', '\1', 'g');

  return btrim(v);
end;
$$;

comment on function private.formatted_text_plain(text) is
  'R60 (Formatted Text): the words of a restricted-Markdown text -- heading, quote and list markers, paired bold/italic/strike/highlight markers and http(s) Text Link syntax removed, list items bulleted, backslash escapes unescaped, CRLF folded to LF, trimmed. Null in, null out. The visible-length limits count its result and a Notification body carries it; the TypeScript twin toPlainText gives the same words, both tested against supabase/tests/formatted_text_plain.test.sql.';
revoke execute on function private.formatted_text_plain(text)
  from public, anon, authenticated, service_role;

-- ==================== 2. The visible-length limits (R60) ====================

-- Formatted Text is at most 2000 visible characters (what formatted_text_plain
-- leaves, the count a reader sees) and at most 4000 stored (the Markdown as
-- typed, so a well-formatted text keeps its room). This helper is the only
-- place the visible limit is judged. A CHECK constraint runs as the writing
-- role and formatted_text_plain is revoked from authenticated, so no
-- constraint may call it: the three *_length_ck constraints below carry the
-- stored cap alone, and the visible limit is judged by the announcements row
-- guard and the Task and Event commands, every one security definer. The
-- stored cap is judged first, so the stripper never runs on an unbounded
-- value. The browser's twins are requiredFormattedText / optionalFormattedText
-- in app/src/lib/schemas/text.ts.
create function private.require_formatted_text_length(p_field text, p_value text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  -- Blank is the caller's *_required (or no text at all), as in require_text_length.
  if p_value is null or p_value !~ '[^[:space:]]' then
    return;
  end if;
  if char_length(p_value) > 4000 then
    raise sqlstate 'PT400' using message = p_field || '_too_long';
  end if;
  if char_length(private.formatted_text_plain(p_value)) > 2000 then
    raise sqlstate 'PT400' using message = p_field || '_too_long';
  end if;
end;
$$;

comment on function private.require_formatted_text_length(text, text) is
  'R60 (Formatted Text): raises PT400 <field>_too_long when an already-trimmed Formatted Text is over 4000 stored characters or over 2000 visible ones (char_length of private.formatted_text_plain); null or blank passes, so the caller''s *_required reason stays in charge of it. The only judge of the visible limit: called by private.guard_announcement_text (which names it 23514) and by the security-definer Task and Event commands. The stored cap alone is also each column''s *_length_ck.';
revoke execute on function private.require_formatted_text_length(text, text)
  from public, anon, authenticated, service_role;

-- The stored cap, inline. It is looser than the 2000 characters it replaces,
-- so every stored row already meets it and validating in this same migration
-- cannot fail (a tighter limit ships the two-migration way of
-- docs/backend/conventions.md §3).
alter table public.announcements drop constraint announcements_body_length_ck;
alter table public.announcements add constraint announcements_body_length_ck
  check (char_length(body) <= 4000) not valid;
alter table public.announcements validate constraint announcements_body_length_ck;

alter table public.tasks drop constraint tasks_description_length_ck;
alter table public.tasks add constraint tasks_description_length_ck
  check (description is null or char_length(description) <= 4000) not valid;
alter table public.tasks validate constraint tasks_description_length_ck;

alter table public.events drop constraint events_description_length_ck;
alter table public.events add constraint events_description_length_ck
  check (description is null or char_length(description) <= 4000) not valid;
alter table public.events validate constraint events_description_length_ck;

-- The row guard of the table the app writes directly: an Announcement's or a
-- Deal's body is judged by the one rule, and its PT400 is named 23514
-- body_too_long, as the guard names its link reasons. Restated from
-- 20261007190000_attached_links_five.sql; only the body's length branch changes.
create or replace function private.guard_announcement_text()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  end if;
  -- R60: Formatted Text, judged by its one rule and named as a row guard names it.
  begin
    perform private.require_formatted_text_length('body', new.body);
  exception when sqlstate 'PT400' then
    raise exception using errcode = '23514', message = sqlerrm;
  end;

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
$function$;

-- The Task and Event commands: each step-1 description check now measures
-- Formatted Text, on the same value as before; nothing else in these bodies
-- changes. Restated from main's latest definitions: create_task_impl,
-- update_task_impl, preview_task_update_impl and duplicate_task_impl from
-- 20261014225803_task_min_level.sql, create_completed_task_impl and
-- approve_completed_work_request_impl from 20261007190000_attached_links_five.sql,
-- create_event_impl and update_event_impl from 20261014204000_event_min_roles.sql.
-- A Cerere's description (create_completed_work_request_impl) stays plain:
-- 2000 characters as typed.

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

create or replace function private.update_task_impl(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text, p_link_url text, p_accept_consequences boolean, p_links jsonb, p_min_level integer)
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

create or replace function private.preview_task_update_impl(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text, p_link_url text, p_links jsonb, p_min_level integer)
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

create or replace function private.create_completed_task_impl(p_executor_id uuid, p_group_id bigint, p_title text, p_description text, p_link_label text, p_link_url text, p_campaign_id bigint, p_difficulty integer, p_rating integer, p_note text, p_links jsonb)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.require_formatted_text_length('description', v_description);
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

create or replace function private.approve_completed_work_request_impl(p_request_id bigint, p_difficulty integer, p_rating integer, p_note text, p_title text, p_description text, p_group_id bigint, p_link_label text, p_link_url text, p_campaign_id bigint, p_links jsonb)
 RETURNS completed_work_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    perform private.require_formatted_text_length('description', v_description);
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

create or replace function private.create_event_impl(p_title text, p_type text, p_group_id bigint, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_location text DEFAULT NULL::text, p_capacity integer DEFAULT NULL::integer, p_description text DEFAULT NULL::text, p_min_level integer DEFAULT 0, p_campaign_id bigint DEFAULT NULL::bigint, p_announce boolean DEFAULT false)
 RETURNS events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_level integer;
  v_group public.groups%rowtype;
  v_created public.events%rowtype;
  v_constraint text;
begin
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_event_title';
  end if;
  -- #673 (R8): measured as stored (btrim).
  perform private.require_text_length('title', btrim(p_title), 3, 120);
  perform private.require_formatted_text_length('description', btrim(p_description));
  -- Security pass 2026-09-27 (L1): events_location_length_ck, measured as stored.
  perform private.require_text_length('location', btrim(p_location), null, 200);
  if p_type is null or p_type not in ('sedinta','activitate','call','eveniment','deadline','recrutare') then
    raise sqlstate 'PT400' using message = 'invalid_event_type';
  end if;
  if p_starts_at is null or (p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise sqlstate 'PT400' using message = 'invalid_event_interval';
  end if;
  -- #673 (R8): an Event's start is judged against now only at creation.
  if p_starts_at < now() then
    raise sqlstate 'PT400' using message = 'starts_at_in_past';
  end if;
  -- #673 (R8): capacity 1-1000 (events_capacity_range_ck).
  if p_capacity is not null and (p_capacity <= 0 or p_capacity > 1000) then
    raise sqlstate 'PT400' using message = 'invalid_event_capacity';
  end if;
  -- R57: every Role on the ladder.
  if p_min_level is null or p_min_level not in (0, 1, 2, 3, 5, 6) then
    raise sqlstate 'PT400' using message = 'invalid_event_min_level';
  end if;
  if p_group_id is null then
    raise sqlstate 'PT400' using message = 'event_group_required';
  end if;

  select * into v_group from public.groups where id = p_group_id and status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  begin
    -- #582: the Organization is the Group carrying the marker, not the row
    -- that happens to mirror the legacy `org` pseudo-department.
    if v_group.is_organization then
      v_actor := private.require_active_member();
      perform 1 from public.profiles as profile
        where profile.id = v_actor and profile.status = 'activ' for share of profile;
      if not found then
        raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
      end if;
      v_level := private.actor_level(v_actor);
      if v_level < 6 then
        -- An Organization Event needs a real live Group Role, not an old rank or JWT roster.
        -- Lock only roster rows: Group SHARE locks conflict with legacy mirror upserts.
        perform 1 from public.group_members as gm
          where gm.member_id = v_actor and gm.group_role in ('manager','responsible')
          order by gm.group_id for share of gm;
        if not found then
          raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
        end if;
      end if;
    else
      v_actor := private.require_group_work_manager(p_group_id);
    end if;
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end;
  -- Refresh settings and level after any wait for live authority.
  select * into v_group from public.groups where id = p_group_id and status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  v_level := private.actor_level(v_actor);
  if p_min_level < v_group.min_level then
    raise sqlstate 'PT400' using message = 'event_min_level_below_group';
  end if;
  if v_level < 9 and p_min_level > v_level then
    raise sqlstate 'PT400' using message = 'event_min_level_above_actor';
  end if;
  -- #909: the Announcement is judged before anything is written. This function
  -- runs as the owner, so its insert below bypasses announcements_create: ask
  -- the policy's own predicate, or the caller would publish with more
  -- authority than a direct insert gives them.
  if coalesce(p_announce, false) then
    if not private.can_publish_announcement(p_group_id) then
      raise exception using errcode = '42501', message = 'announcement_publish_forbidden';
    end if;
  end if;
  -- R39: the Event notifies its audience, so it spends a daily cap (security
  -- pass L3), judged after every row lock the gate took.
  perform private.require_daily_cap('event_create', v_actor);
  -- #691: events_validate_campaign judges the Campaign against the Event's Group;
  -- its two reasons, and an unknown id, reach the caller as create_task_impl's
  -- PT400 invalid_campaign (same condition, same string).
  begin
    insert into public.events(title,type,group_id,starts_at,ends_at,location,capacity,description,min_level,campaign_id,created_by)
      values (btrim(p_title),p_type::public.event_type,p_group_id,p_starts_at,p_ends_at,
        nullif(btrim(p_location),''),p_capacity,nullif(btrim(p_description),''),p_min_level,p_campaign_id,v_actor)
      returning * into v_created;
  exception
    when foreign_key_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'events_campaign_id_fkey' then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
    when check_violation then
      if sqlerrm in ('event_campaign_origin_mismatch', 'event_campaign_inactive') then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
  end;
  -- Spec 2026-10-11: a pending Event (OSUBB-wide, writer below BC -- the stamp
  -- decided) tells nobody yet; BC are asked by the request trigger. Its
  -- Announcement, if asked for, is written when approve_event publishes it.
  if v_created.approval_status = 'pending' then
    if coalesce(p_announce, false) then
      update public.events set announce_on_approval = true where id = v_created.id returning * into v_created;
    end if;
    return v_created;
  end if;
  -- #909: the Announcement goes through the table's own row guards (text,
  -- Termen, authorship stamp, the author's daily cap) and its fan-out trigger;
  -- any refusal there rolls the Event back with it. It copies the Event's
  -- Minimum Level, so it reaches exactly the Members who can see the Event.
  if coalesce(p_announce, false) then
    -- R53: the Announcement records the Event it was written for
    -- (private.guard_announcement_event reads this setting, never a client).
    perform set_config('osubb.announcement_event', v_created.id::text, true);
    insert into public.announcements(title, body, group_id, audience, min_level, deadline, created_by)
      values (v_created.title,
              private.event_announcement_body(v_created.starts_at, v_created.ends_at,
                                              v_created.location, v_created.description),
              v_created.group_id,
              case when v_group.is_organization then 'org' else 'local' end,
              v_created.min_level,
              v_created.starts_at,
              v_actor);
    perform set_config('osubb.announcement_event', '', true);
  else
    -- R39: without the Announcement, the Event tells its audience itself.
    perform private.notify_event_created(v_created, v_actor);
  end if;
  return v_created;
end;
$function$;

create or replace function private.update_event_impl(p_event_id bigint, p_title text, p_type text, p_group_id bigint, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_location text, p_capacity integer, p_description text, p_min_level integer, p_campaign_id bigint)
 RETURNS events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_level integer;
  v_event public.events%rowtype;
  v_updated public.events%rowtype;
  v_target public.groups%rowtype;
  v_recipients uuid[];
  v_old_members uuid[];
  v_fields text[];
  v_parts text[];
  v_constraint text;
begin
  -- 1. Malformed input, judged for everyone before the gate.
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_event_title';
  end if;
  -- #673 (R8): measured as stored (btrim).
  perform private.require_text_length('title', btrim(p_title), 3, 120);
  perform private.require_formatted_text_length('description', btrim(p_description));
  -- Security pass 2026-09-27 (L1): events_location_length_ck, measured as stored.
  perform private.require_text_length('location', btrim(p_location), null, 200);
  if p_type is null or p_type not in ('sedinta', 'activitate', 'call', 'eveniment', 'deadline', 'recrutare') then
    raise sqlstate 'PT400' using message = 'invalid_event_type';
  end if;
  if p_starts_at is null or (p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise sqlstate 'PT400' using message = 'invalid_event_interval';
  end if;
  -- #673 (R8): capacity 1-1000 (events_capacity_range_ck).
  if p_capacity is not null and (p_capacity <= 0 or p_capacity > 1000) then
    raise sqlstate 'PT400' using message = 'invalid_event_capacity';
  end if;
  -- R57: every Role on the ladder.
  if p_min_level is null or p_min_level not in (0, 1, 2, 3, 5, 6) then
    raise sqlstate 'PT400' using message = 'invalid_event_min_level';
  end if;
  if p_group_id is null then
    raise sqlstate 'PT400' using message = 'event_group_required';
  end if;

  -- 2. Gate.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end;

  -- 3. Lock the Event before inspecting its state; concurrent edits and cancellation serialize.
  select * into v_event from public.events where id = p_event_id for no key update;
  if not found or coalesce(private.actor_level(v_actor), -1) < v_event.min_level then
    raise sqlstate 'PT404' using message = 'event_not_found';
  end if;
  perform 1 from public.profiles where id = v_actor and status = 'activ' for share;
  if not found then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;

  -- 4. Visibility is judged before authority: a hidden Event is a missing one.
  --    #756: the events_read rule itself, so an Event of a Private Group is
  --    missing for an outsider rather than forbidden.
  v_level := private.actor_level(v_actor);
  if not private.can_read_event(v_event.group_id, v_event.min_level, v_actor) then
    raise sqlstate 'PT404' using message = 'event_not_found';
  end if;
  -- #934: who manages the Event is one rule, private.can_manage_event, which
  -- the other command and the event_attendance_read policy read too. Hold the
  -- roster rows a Group Role answer rests on FOR SHARE, then ask again on the
  -- locked snapshot (require_group_work_manager's discipline), so a Group Role
  -- removed concurrently serializes behind this decision. BC, the Moderator and
  -- an Organization Event's creator rest on the Profile row held above.
  if not private.can_manage_event(p_event_id) then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  perform 1
     from public.groups as target
     join public.group_members as gm on target.path @> array[gm.group_id]
    where target.id = v_event.group_id
      and gm.member_id = v_actor
      and gm.group_role in ('manager', 'responsible')
    order by gm.group_id
      for share of gm;
  if not private.can_manage_event(p_event_id) then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;

  -- An unknown Group is refused as "you may not", never as "no such Group".
  -- The ACTIVE requirement belongs to the move, not to the argument: see the
  -- header (reason 2). An edit that keeps the Event in its own Group is left
  -- to step 4's rule, which already gates a Group Role on the Group's status.
  select * into v_target from public.groups where id = p_group_id;
  if not found
     or (p_group_id is distinct from v_event.group_id and v_target.status <> 'active') then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  if p_group_id is distinct from v_event.group_id then
    -- Even an Organization Event's creator must hold authority in the new Group.
    begin
      if v_target.is_organization then
        if v_level < 6 then
          -- Lock only roster rows: Group SHARE locks conflict with legacy mirror upserts.
          perform 1 from public.group_members as gm
            where gm.member_id = v_actor and gm.group_role in ('manager', 'responsible')
            order by gm.group_id for share of gm;
          if not found then
            raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
          end if;
        end if;
      else
        perform private.require_group_work_manager(p_group_id);
      end if;
    exception when insufficient_privilege then
      raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
    end;
  end if;

  -- 5. Minimum Level, judged against the loaded target Group and the live actor.
  if p_min_level < v_target.min_level then
    raise sqlstate 'PT400' using message = 'event_min_level_below_group';
  end if;
  if v_level < 9 and p_min_level > v_level then
    raise sqlstate 'PT400' using message = 'event_min_level_above_actor';
  end if;

  -- 6. Terminal state.
  if v_event.cancelled_at is not null then
    raise sqlstate 'PT409' using message = 'event_cancelled';
  end if;

  -- 7. Full-state replace: every column the caller names is written, so a null
  --    argument CLEARS a nullable column instead of leaving the old value.
  -- #601: the old Group's whole Group Audience, not only its explicit roster -- and,
  -- like every Event recipient, only those who can read the Event at its NEW
  -- Minimum Level (private.can_read_event, the events_read rule) -- and, since
  -- #756, in its NEW Group, so a move into a Private Group tells no outsider.
  -- #929 (R32): the Group Audience that Notifications reach, so no BC or
  -- Moderator hears of it through membership.
  -- Final review of 2026-10-13 (I2): an audience never told of a pending or
  -- rejected Event is not told of its move either.
  if v_event.approval_status = 'approved' then
    select array_agg(member_id) into v_old_members
      from private.group_notification_audience(v_event.group_id) as member_id
     where private.can_read_event(p_group_id, p_min_level, member_id);
  end if;
  -- #691: the Campaign is judged by events_validate_campaign against the Event's
  -- (possibly new) Group; a move carrying a Campaign off the new path, an unknown
  -- id or a newly attached inactive Campaign is PT400 invalid_campaign.
  begin
    update public.events set title = btrim(p_title), type = p_type::public.event_type,
      group_id = p_group_id, starts_at = p_starts_at, ends_at = p_ends_at,
      location = nullif(btrim(p_location), ''), capacity = p_capacity,
      description = nullif(btrim(p_description), ''), min_level = p_min_level,
      campaign_id = p_campaign_id
     where id = p_event_id returning * into v_updated;
  exception
    when foreign_key_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'events_campaign_id_fkey' then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
    when check_violation then
      if sqlerrm in ('event_campaign_origin_mismatch', 'event_campaign_inactive') then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
  end;
  select array_agg(recipient) into v_recipients
    from private.event_notification_recipients(p_event_id) as recipient;
  -- Published by the move (spec 2026-10-11, final review I2): a pending or
  -- rejected OSUBB-wide Event that left the Organization Group is approved by
  -- private.stamp_approval; its new Group hears of it as a new Event, not of
  -- the changes to one it never saw.
  if v_event.approval_status <> 'approved' and v_updated.approval_status = 'approved' then
    perform private.notify_event_created(v_updated, v_actor);
    return v_updated;
  end if;
  if v_event.group_id is distinct from v_updated.group_id then
    v_recipients := coalesce(v_recipients, '{}'::uuid[]) || coalesce(v_old_members, '{}'::uuid[]);
  end if;
  -- R53 (2026-10-14): every content change tells them, in one notice per
  -- edit that names what changed and spells out a new schedule, place, Group
  -- or Minimum Level (private.notify_event: "Eveniment nou" to anyone never
  -- told of the Event, such as a new Group's audience). #691: a Campaign is a
  -- label -- absent from both lists, so a Campaign-only edit tells nobody.
  v_fields := array_remove(array[
    case when v_event.title is distinct from v_updated.title then 'titlu' end,
    case when v_event.description is distinct from v_updated.description then 'descriere' end,
    case when v_event.type is distinct from v_updated.type then 'tip' end,
    case when v_event.starts_at is distinct from v_updated.starts_at
           or v_event.ends_at is distinct from v_updated.ends_at then 'programare' end,
    case when v_event.location is distinct from v_updated.location then 'locație' end,
    case when v_event.capacity is distinct from v_updated.capacity then 'capacitate' end,
    case when v_event.group_id is distinct from v_updated.group_id then 'grup' end,
    case when v_event.min_level is distinct from v_updated.min_level then 'nivel minim' end
  ], null);
  -- The notice names what changed, then always the current schedule and
  -- place: a later edit refreshes an unread notice in place, and must never
  -- hide that the time or the place moved before it.
  if cardinality(v_fields) > 0 then
    v_parts := array_remove(array[
      'Modificat: ' || array_to_string(v_fields, ', '),
      'Programare: '
        || to_char(v_updated.starts_at at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI')
        || coalesce(' - ' || to_char(v_updated.ends_at at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI'), ''),
      'Locație: ' || v_updated.location,
      case when v_event.group_id is distinct from v_updated.group_id then 'Grup: ' || v_target.name end,
      case when v_event.min_level is distinct from v_updated.min_level
        then 'Nivel minim: ' || v_updated.min_level::text end
    ], null);
    perform private.notify_event(v_updated, v_actor, v_recipients, array_to_string(v_parts, '. '));
  end if;
  return v_updated;
end;
$function$;

-- ==================== 3. Plain Notifications and the Event copy (R60) ====================

-- A Notification is plain text wherever it is read (the bell, the push, the
-- Email Digest), so an Announcement's Notification carries the words of its
-- body, not its Markdown; and the copy of an Event's description into its
-- Announcement is cut at whole lines, never inside a marker. Neither
-- function changes its signature. private.notify already clips at 2000
-- characters, which a plain body never passes now.

-- Restated from 20261014153142_edit_notices.sql; only the two body arguments
-- change (the first notice and the told-again one), plus the comment above them.
create or replace function private.notify_announcement(p_row announcements, p_actor uuid, p_changed text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_recipients uuid[] := coalesce(private.announcement_recipients(p_row), '{}'::uuid[]);
  v_key text := 'announcement:' || p_row.id::text;
  v_told uuid[];
  v_deal boolean := p_row.kind = 'deal';
  v_link text := case when p_row.kind = 'deal' then '/anunturi/deals?deal=' else '/anunturi?anunt=' end
                 || p_row.id::text;
begin
  -- Whoever holds a notice about it, or opened it, knows it.
  v_told := private.told_of(v_recipients, v_key)
            || array(select reading.member_id from public.announcement_reads as reading
                      where reading.announcement_id = p_row.id and reading.member_id = any (v_recipients));
  -- #635: a critical Announcement's Notification is critical, so it still
  -- pushes to a Member who muted 'announce'. #861 (Audit D-20): keyed
  -- announcement:<id>, so reading the Announcement finds and clears it -- and
  -- an unread notice is refreshed in place rather than doubled. R45: a Deal
  -- says so and opens on the OSUBB Deals tab. R60: the body is Formatted Text
  -- and a Notification is plain, so it carries the words of the body, whether
  -- the Member is told for the first time or told again.
  perform private.notify(
    array(select member from unnest(v_recipients) as member where member <> all (v_told)),
    'announce', case when v_deal then 'Deal nou: ' else 'Anunț nou: ' end || p_row.title,
    private.formatted_text_plain(p_row.body), null, v_key, p_actor, v_link, p_row.priority = 'critical');
  perform private.notify(v_told, 'announce',
    case when v_deal then 'Deal actualizat: ' else 'Anunț actualizat: ' end || p_row.title,
    coalesce(p_changed, private.formatted_text_plain(p_row.body)), null, v_key, p_actor, v_link, p_row.priority = 'critical');
end;
$function$;

comment on function private.notify_announcement(public.announcements, uuid, text) is
  'R53: tells private.announcement_recipients of the Announcement, never p_actor -- "Anunț nou" ("Deal nou") with its text to whoever does not know it, "Anunț actualizat" ("Deal actualizat") to whoever does -- holds a notice about it (private.told_of) or opened it, with p_changed or, for an approval, its text. R60: its text is the words of the body (private.formatted_text_plain), never the Markdown. Keyed announcement:<id>. Granted to nobody.';

-- Restated from 20260929170000_announcement_deadline.sql; only the clip changes.
create or replace function private.event_announcement_body(p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_location text, p_description text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_days constant text[] := array['duminică','luni','marți','miercuri','joi','vineri','sâmbătă'];
  v_months constant text[] := array['ianuarie','februarie','martie','aprilie','mai','iunie',
    'iulie','august','septembrie','octombrie','noiembrie','decembrie'];
  v_start timestamp := p_starts_at at time zone 'Europe/Bucharest';
  v_end timestamp := p_ends_at at time zone 'Europe/Bucharest';
  v_line text;
  v_text text;
  v_lines text[];
  v_n integer;
  v_body text;
begin
  -- "Miercuri, 30 septembrie 2026, 18:40–20:40 · Sala 305", always in Romania.
  v_line := v_days[extract(dow from v_start)::int + 1] || ', '
    || extract(day from v_start)::int || ' ' || v_months[extract(month from v_start)::int]
    || ' ' || extract(year from v_start)::int || ', ' || to_char(v_start, 'HH24:MI');
  v_line := upper(left(v_line, 1)) || substr(v_line, 2);
  if v_end is not null then
    if v_end::date = v_start::date then
      v_line := v_line || '–' || to_char(v_end, 'HH24:MI');
    else
      v_line := v_line || ' – ' || v_days[extract(dow from v_end)::int + 1] || ', '
        || extract(day from v_end)::int || ' ' || v_months[extract(month from v_end)::int]
        || ' ' || extract(year from v_end)::int || ', ' || to_char(v_end, 'HH24:MI');
    end if;
  end if;
  if nullif(btrim(p_location), '') is not null then
    v_line := v_line || ' · ' || btrim(p_location);
  end if;
  v_text := nullif(btrim(p_description), '');
  v_body := v_line;
  if v_text is not null then
    v_body := v_body || E'\n\n' || v_text;
  end if;
  -- R60: an Event description is Formatted Text and may use all the 2000
  -- visible characters an Announcement body has; the date line on top must
  -- not push the Announcement over its limit, visible (2000) or stored (4000).
  -- Lines go from the end, so a cut never lands inside a marker (every marker
  -- pairs within its line), and the blank lines it leaves behind go with them.
  -- The date line stays, and the "…" closes the copy on a line of its own,
  -- counted with the candidate it closes, so it never pushes the copy back
  -- over the limit. Each pass drops at least one line, so the loop ends.
  if char_length(private.formatted_text_plain(v_body)) > 2000 or char_length(v_body) > 4000 then
    v_lines := string_to_array(v_text, E'\n');
    v_n := cardinality(v_lines);
    loop
      v_n := v_n - 1;
      while v_n > 0 and btrim(v_lines[v_n], E' \t\r') = '' loop
        v_n := v_n - 1;
      end loop;
      v_body := v_line
        || case when v_n > 0 then E'\n\n' || array_to_string(v_lines[1:v_n], E'\n') else '' end
        || E'\n…';
      exit when v_n = 0
        or (char_length(private.formatted_text_plain(v_body)) <= 2000 and char_length(v_body) <= 4000);
    end loop;
  end if;
  return v_body;
end;
$function$;

comment on function private.event_announcement_body(timestamptz, timestamptz, text, text) is
  '#909: the body of the Announcement create_event(p_announce) publishes -- "Miercuri, 30 septembrie 2026, 18:40–20:40 · Sala 305", a blank line and the description, in Romania''s time zone. R60: the description stays Formatted Text. When the body would pass the 2000 visible characters (private.formatted_text_plain) or the 4000 stored ones an Announcement body allows, lines go from the end of the description until it fits with "…" closing it on a line of its own, so a cut never lands inside a marker; the date line is never dropped.';
