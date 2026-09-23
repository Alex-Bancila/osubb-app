-- #673: constraints kit, server side (ruling R8) -- every input limit as a NOT VALID check constraint, a command check and two row guards.
--
-- Two migrations, one PR. This one (A) adds every new check constraint NOT
-- VALID: Postgres enforces a NOT VALID constraint on every insert and on every
-- update of a row from the moment it is added, and defers only the scan over
-- the rows already stored. Each constraint is followed by a count of the
-- existing rows that already break it, raised as a NOTICE -- informational
-- only; no existing row is trimmed, padded or truncated to fit (house rule 1),
-- a human fixes it through the ordinary commands. The next migration
-- (constraints_kit_validate) validates every one of them and fails loudly,
-- naming table and constraint, if a row still breaks one.
--
-- Reasons. A command answers PT400 <field>_<rule> at step 1, before the gate
-- (conventions section 2): a value outside a CHECK constraint's range is
-- malformed for every caller. The two tables the app writes directly
-- (announcements, profiles.phone) get a before-row trigger that names the
-- reason as 23514, so no client ever sees a raw constraint name for these
-- rules. Every value is measured exactly as it is stored -- the caller's own
-- trim -- so "  ab  " and "ab" are judged alike, and a value that is only
-- whitespace stays the command's existing *_required reason.
--
-- The two row-guard trigger functions are security definer, not invoker: a
-- security-invoker function that calls a private helper needs that helper
-- granted to the writing role (Postgres checks EXECUTE against the current
-- user inside a trigger body and inside a CHECK expression alike), and the
-- helpers here are granted to nobody. For the same reason
-- announcements_form_link_ck spells the http(s) rule out inline instead of
-- calling private.is_http_url.

-- ==================== helpers ====================

create function private.require_text_length(p_field text, p_value text, p_min integer, p_max integer)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  -- Blank is the caller's *_required, never *_too_short.
  if p_value is null or p_value !~ '[^[:space:]]' then
    return;
  end if;
  if char_length(p_value) < coalesce(p_min, 0) then
    raise sqlstate 'PT400' using message = p_field || '_too_short';
  end if;
  if char_length(p_value) > p_max then
    raise sqlstate 'PT400' using message = p_field || '_too_long';
  end if;
end;
$$;
comment on function private.require_text_length(text, text, integer, integer) is
  '#673 (R8): raises PT400 <field>_too_short / <field>_too_long when an already-trimmed text is outside [p_min, p_max] characters; null or blank passes, so the caller''s *_required reason stays in charge of it. p_min null means no minimum.';
revoke execute on function private.require_text_length(text, text, integer, integer)
  from public, anon, authenticated, service_role;

create function private.is_http_url(p_value text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_value is not null
     and btrim(p_value) ~ '^https?://'
     and char_length(btrim(p_value)) <= 2048;
$$;
comment on function private.is_http_url(text) is
  '#673 (R8): an Attached Link address -- trimmed, http:// or https://, at most 2048 characters.';
revoke execute on function private.is_http_url(text)
  from public, anon, authenticated, service_role;

create function private.normalize_phone(p_phone text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  v_phone  text;
  v_digits text;
begin
  -- Strip spaces, dots, dashes and parentheses.
  v_phone := regexp_replace(coalesce(p_phone, ''), '[[:space:].()-]', '', 'g');
  if v_phone = '' then
    return null;
  end if;
  if v_phone ~ '^00' then
    v_phone := '+' || substr(v_phone, 3);
  elsif v_phone !~ '^\+' then
    v_phone := '+40' || v_phone;
  end if;
  if v_phone !~ '^\+[0-9]+$' then
    return null;
  end if;
  if v_phone ~ '^\+40' then
    v_digits := regexp_replace(substr(v_phone, 4), '^0', '');
    return case when v_digits ~ '^7[0-9]{8}$' then '+40' || v_digits end;
  end if;
  if v_phone ~ '^\+373' then
    v_digits := regexp_replace(substr(v_phone, 5), '^0', '');
    return case when v_digits ~ '^[0-9]{8}$' then '+373' || v_digits end;
  end if;
  -- Any other explicit country: E.164 length alone. A country code never
  -- starts with 0.
  return case when v_phone ~ '^\+[1-9][0-9]{7,14}$' then v_phone end;
end;
$$;
comment on function private.normalize_phone(text) is
  '#673 (R8): a phone number in E.164, or null when it cannot be normalised. Strips spaces, dots, dashes and parentheses; 00 -> +; no prefix -> +40; drops a trunk 0 after +40 or +373; +40 must be followed by 9 digits starting with 7, +373 by 8 digits; any other +<country> is accepted on E.164 length alone (8-15 digits).';
revoke execute on function private.normalize_phone(text)
  from public, anon, authenticated, service_role;

-- ==================== check constraints, NOT VALID ====================
-- Every one is validated, in this order, by the next migration.

alter table public.tasks
  add constraint tasks_title_length_ck check (char_length(title) between 3 and 120) not valid;
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad from public.tasks where not (char_length(title) between 3 and 120);
  if v_bad > 0 then raise notice 'tasks_title_length_ck: % existing row(s) violate the new rule', v_bad; end if;
end $$;

alter table public.tasks
  add constraint tasks_description_length_ck
  check (description is null or char_length(description) <= 2000) not valid;
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad from public.tasks
   where not (description is null or char_length(description) <= 2000);
  if v_bad > 0 then raise notice 'tasks_description_length_ck: % existing row(s) violate the new rule', v_bad; end if;
end $$;

alter table public.events
  add constraint events_title_length_ck check (char_length(title) between 3 and 120) not valid;
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad from public.events where not (char_length(title) between 3 and 120);
  if v_bad > 0 then raise notice 'events_title_length_ck: % existing row(s) violate the new rule', v_bad; end if;
end $$;

alter table public.events
  add constraint events_description_length_ck
  check (description is null or char_length(description) <= 2000) not valid;
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad from public.events
   where not (description is null or char_length(description) <= 2000);
  if v_bad > 0 then raise notice 'events_description_length_ck: % existing row(s) violate the new rule', v_bad; end if;
end $$;

-- Replaces events_capacity_positive_ck: the same floor plus R8's ceiling.
alter table public.events drop constraint events_capacity_positive_ck;
alter table public.events
  add constraint events_capacity_range_ck
  check (capacity is null or capacity between 1 and 1000) not valid;
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad from public.events
   where not (capacity is null or capacity between 1 and 1000);
  if v_bad > 0 then raise notice 'events_capacity_range_ck: % existing row(s) violate the new rule', v_bad; end if;
end $$;

-- R8 says "titles 3-120"; a Campaign's or a Group's name is its title.
alter table public.campaigns
  add constraint campaigns_name_length_ck check (char_length(name) between 3 and 120) not valid;
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad from public.campaigns where not (char_length(name) between 3 and 120);
  if v_bad > 0 then raise notice 'campaigns_name_length_ck: % existing row(s) violate the new rule', v_bad; end if;
end $$;

alter table public.groups
  add constraint groups_name_length_ck check (char_length(name) between 3 and 120) not valid;
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad from public.groups where not (char_length(name) between 3 and 120);
  if v_bad > 0 then raise notice 'groups_name_length_ck: % existing row(s) violate the new rule', v_bad; end if;
end $$;

alter table public.announcements
  add constraint announcements_title_length_ck check (char_length(title) between 3 and 120) not valid;
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad from public.announcements where not (char_length(title) between 3 and 120);
  if v_bad > 0 then raise notice 'announcements_title_length_ck: % existing row(s) violate the new rule', v_bad; end if;
end $$;

alter table public.announcements
  add constraint announcements_body_length_ck check (char_length(body) <= 2000) not valid;
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad from public.announcements where not (char_length(body) <= 2000);
  if v_bad > 0 then raise notice 'announcements_body_length_ck: % existing row(s) violate the new rule', v_bad; end if;
end $$;

-- Beside announcements_form_ck (label and address together or not at all).
-- The address rule is private.is_http_url's, spelled out: see the header.
alter table public.announcements
  add constraint announcements_form_link_ck
  check (form_label is null
         or (char_length(form_label) <= 60
             and form_url ~ '^https?://'
             and char_length(form_url) <= 2048)) not valid;
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad from public.announcements
   where not (form_label is null
              or (char_length(form_label) <= 60
                  and form_url ~ '^https?://'
                  and char_length(form_url) <= 2048));
  if v_bad > 0 then raise notice 'announcements_form_link_ck: % existing row(s) violate the new rule', v_bad; end if;
end $$;

-- Notes and reasons: at most 1000 characters.
alter table public.task_activity
  add constraint task_activity_note_length_ck
  check (note is null or char_length(note) <= 1000) not valid;
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad from public.task_activity
   where not (note is null or char_length(note) <= 1000);
  if v_bad > 0 then raise notice 'task_activity_note_length_ck: % existing row(s) violate the new rule', v_bad; end if;
end $$;

alter table public.task_assignments
  add constraint task_assignments_end_note_length_ck
  check (end_note is null or char_length(end_note) <= 1000) not valid;
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad from public.task_assignments
   where not (end_note is null or char_length(end_note) <= 1000);
  if v_bad > 0 then raise notice 'task_assignments_end_note_length_ck: % existing row(s) violate the new rule', v_bad; end if;
end $$;

alter table public.task_evaluations
  add constraint task_evaluations_note_length_ck check (char_length(note) <= 1000) not valid;
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad from public.task_evaluations where not (char_length(note) <= 1000);
  if v_bad > 0 then raise notice 'task_evaluations_note_length_ck: % existing row(s) violate the new rule', v_bad; end if;
end $$;

alter table public.task_evaluations
  add constraint task_evaluations_reversal_reason_length_ck
  check (reversal_reason is null or char_length(reversal_reason) <= 1000) not valid;
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad from public.task_evaluations
   where not (reversal_reason is null or char_length(reversal_reason) <= 1000);
  if v_bad > 0 then raise notice 'task_evaluations_reversal_reason_length_ck: % existing row(s) violate the new rule', v_bad; end if;
end $$;

alter table public.tasks
  add constraint tasks_cancel_reason_length_ck
  check (cancel_reason is null or char_length(cancel_reason) <= 1000) not valid;
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad from public.tasks
   where not (cancel_reason is null or char_length(cancel_reason) <= 1000);
  if v_bad > 0 then raise notice 'tasks_cancel_reason_length_ck: % existing row(s) violate the new rule', v_bad; end if;
end $$;

alter table public.completed_work_requests
  add constraint completed_work_requests_decision_note_length_ck
  check (decision_note is null or char_length(decision_note) <= 1000) not valid;
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad from public.completed_work_requests
   where not (decision_note is null or char_length(decision_note) <= 1000);
  if v_bad > 0 then raise notice 'completed_work_requests_decision_note_length_ck: % existing row(s) violate the new rule', v_bad; end if;
end $$;

-- R8 is silent on the Request description; it is a description, and
-- approve_completed_work_request already titles its Task with the first 120
-- characters of it.
alter table public.completed_work_requests
  add constraint completed_work_requests_description_length_ck
  check (char_length(description) <= 2000) not valid;
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad from public.completed_work_requests
   where not (char_length(description) <= 2000);
  if v_bad > 0 then raise notice 'completed_work_requests_description_length_ck: % existing row(s) violate the new rule', v_bad; end if;
end $$;

-- ==================== row guards on the two directly written tables ====================

create function private.guard_announcement_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
  if new.form_label is not null and char_length(new.form_label) > 60 then
    raise exception using errcode = '23514', message = 'link_label_too_long';
  end if;
  if new.form_url is not null then
    if char_length(new.form_url) > 2048 then
      raise exception using errcode = '23514', message = 'link_url_too_long';
    elsif not private.is_http_url(new.form_url) then
      raise exception using errcode = '23514', message = 'link_url_invalid';
    end if;
  end if;
  return new;
end;
$$;
comment on function private.guard_announcement_text() is
  '#673 (R8): announcements_guard_text -- trims title, body, link label and address (a blank label or address becomes null), then names the rule a direct write breaks as 23514 title_required / title_too_short / title_too_long / body_required / body_too_long / link_label_too_long / link_url_too_long / link_url_invalid. The check constraints stay the invariant underneath. Security definer only so it may call private.is_http_url; it reads no table.';
revoke execute on function private.guard_announcement_text()
  from public, anon, authenticated, service_role;

create trigger announcements_guard_text
  before insert or update on public.announcements
  for each row execute function private.guard_announcement_text();

create function private.normalize_profile_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
begin
  if new.phone is null or new.phone !~ '[^[:space:]]' then
    new.phone := null;
    return new;
  end if;
  v_phone := private.normalize_phone(new.phone);
  if v_phone is null then
    raise exception using errcode = '23514', message = 'phone_invalid';
  end if;
  new.phone := v_phone;
  return new;
end;
$$;
comment on function private.normalize_profile_phone() is
  '#673 (R8): profiles_normalize_phone -- blank becomes null, anything else is stored in E.164 by private.normalize_phone, or refused as 23514 phone_invalid. Security definer only so it may call the helper; it reads no table.';
revoke execute on function private.normalize_profile_phone()
  from public, anon, authenticated, service_role;

create trigger profiles_normalize_phone
  before insert or update of phone on public.profiles
  for each row execute function private.normalize_profile_phone();

-- Defensive: no migration, seed row or Edge Function writes a phone. A value
-- the normaliser cannot read stays as it is until its owner edits it.
update public.profiles
   set phone = private.normalize_phone(phone)
 where phone is not null
   and private.normalize_phone(phone) is not null
   and phone is distinct from private.normalize_phone(phone);

-- ==================== commands: step-1 checks ====================
-- Every body below is rebuilt from its newest version on main (the live
-- catalog after 20260923223833_nickname_member_card.sql); only the lines
-- marked #673 change. Existing grants survive create or replace.

CREATE OR REPLACE FUNCTION private.create_task_impl(p_title text, p_description text, p_deadline timestamp with time zone, p_audience text, p_assignment_mode text, p_executor_id uuid, p_campaign_id bigint, p_parent_task_id bigint, p_kind text, p_group_id bigint)
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
                              status, created_by, queue_opened_at)
    values (v_title, nullif(regexp_replace(coalesce(p_description, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
            p_deadline, v_group,
            p_audience, p_assignment_mode, p_campaign_id, p_parent_task_id, p_kind,
            'todo', v_actor, case when p_assignment_mode = 'public' then now() end)
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
      'Modificat: ' || array_to_string(v_changed, ', ') || '.', p_task_id, null, v_actor);
  end if;
  return v_task;
end;
$function$;

CREATE OR REPLACE FUNCTION private.update_task_impl(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_accept_consequences boolean)
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
  v_promoted uuid;
  v_closed uuid[] := '{}'::uuid[];
  v_assignment_id bigint;
  v_candidate public.task_candidates%rowtype;
  v_new_assignment_id bigint;
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
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. The locks. This unlocked read only learns WHICH parent to lock first;
  --    every decision below is made from the locked rows. Both rows FOR NO
  --    KEY UPDATE, never FOR UPDATE -- see the header.
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
    p_campaign_id, p_assignment_mode, p_audience);
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
         (array_agg((e ->> 'member_id')::uuid) filter (where e ->> 'consequence' = 'candidate_promoted'))[1],
         (array_agg((e ->> 'member_id')::uuid) filter (where e ->> 'consequence' = 'executor_added_to_group'))[1]
    into v_removed_candidates, v_removed_executor, v_promoted, v_added_executor
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

  -- The vacated slot goes to the head of the remaining queue, as in
  -- give_up_task: the kit opens the Assignment (executor_assigned row, 'Task
  -- nou' notification) and the Candidature becomes selected.
  if v_promoted is not null then
    select candidate.* into v_candidate
      from public.task_candidates as candidate
     where candidate.task_id = p_task_id and candidate.member_id = v_promoted
       and candidate.status = 'pending'
     for update;
    v_new_assignment_id := private.open_task_assignment(p_task_id, v_promoted, v_actor, 'queue_promotion');
    update public.task_candidates as candidate
       set status = 'selected', decided_at = now(), decided_by = v_actor,
           assignment_id = v_new_assignment_id
     where candidate.id = v_candidate.id;
    perform private.log_task_activity(p_task_id, 'candidate_selected', v_actor, v_new_assignment_id,
      null, null, null,
      jsonb_build_object('candidate_id', v_candidate.id, 'member_id', v_promoted, 'promoted', true));
  end if;

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
  if v_promoted is null then
    select assignment.member_id into v_executor
      from public.task_assignments as assignment
     where assignment.task_id = p_task_id and assignment.ended_at is null;
    if v_executor is not null then
      perform private.notify(array[v_executor], 'task'::public.noti_kind,
        'Task actualizat: ' || v_task.title,
        'Modificat: ' || array_to_string(array(select jsonb_array_elements_text(v_plan -> 'changed')), ', ') || '.',
        p_task_id, null, v_actor);
    end if;
  end if;
  return v_task;
end;
$function$;

CREATE OR REPLACE FUNCTION private.preview_task_update_impl(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text)
 RETURNS TABLE(consequence text, member_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_task public.tasks%rowtype;
begin
  -- #673 (R8): the command's step 1, so preview and command agree.
  perform private.require_text_length('title',
    regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g'), 3, 120);
  perform private.require_text_length('description',
    regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 2000);
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
    p_campaign_id, p_assignment_mode, p_audience);
  return query
    select c.consequence, c.member_id
      from private.task_update_consequences(p_task_id, p_group_id, p_campaign_id, p_assignment_mode, p_audience) as c;
end;
$function$;

CREATE OR REPLACE FUNCTION private.duplicate_task_impl(p_task_id bigint, p_deadline timestamp with time zone)
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
  -- constraint name.
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
    parent_task_id, queue_opened_at, duplicated_from_task_id)
  values (
    v_source.title, v_source.description, v_source.group_id, v_campaign_id,
    v_source.audience, v_source.assignment_mode, 'task', 'todo', p_deadline,
    v_actor, null,
    case when v_source.assignment_mode = 'public' then now() end,
    p_task_id)
  returning * into v_clone;

  perform private.log_task_activity(v_clone.id, 'created', v_actor, null, null, 'todo'::public.task_status, null,
    jsonb_build_object('duplicated_from_task_id', p_task_id));
  perform private.log_task_activity(p_task_id, 'duplicated', v_actor, null, null, null, null,
    jsonb_build_object('clone_task_id', v_clone.id));

  select * into v_clone from public.tasks where id = v_clone.id;
  return v_clone;
end;
$function$;

CREATE OR REPLACE FUNCTION private.create_event_impl(p_title text, p_type text, p_group_id bigint, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_location text DEFAULT NULL::text, p_capacity integer DEFAULT NULL::integer, p_description text DEFAULT NULL::text, p_min_level integer DEFAULT 0)
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
begin
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_event_title';
  end if;
  -- #673 (R8): measured as stored (btrim).
  perform private.require_text_length('title', btrim(p_title), 3, 120);
  perform private.require_text_length('description', btrim(p_description), null, 2000);
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
  if p_min_level is null or p_min_level not in (0,3,5,6) then
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
  insert into public.events(title,type,group_id,starts_at,ends_at,location,capacity,description,min_level,created_by)
    values (btrim(p_title),p_type::public.event_type,p_group_id,p_starts_at,p_ends_at,
      nullif(btrim(p_location),''),p_capacity,nullif(btrim(p_description),''),p_min_level,v_actor)
    returning * into v_created;
  return v_created;
end;
$function$;

CREATE OR REPLACE FUNCTION private.update_event_impl(p_event_id bigint, p_title text, p_type text, p_group_id bigint, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_location text, p_capacity integer, p_description text, p_min_level integer)
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
  v_field text;
  v_body text;
begin
  -- 1. Malformed input, judged for everyone before the gate.
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_event_title';
  end if;
  -- #673 (R8): measured as stored (btrim).
  perform private.require_text_length('title', btrim(p_title), 3, 120);
  perform private.require_text_length('description', btrim(p_description), null, 2000);
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
  if p_min_level is null or p_min_level not in (0, 3, 5, 6) then
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
  v_level := private.actor_level(v_actor);
  if coalesce(v_level, -1) < v_event.min_level then
    raise sqlstate 'PT404' using message = 'event_not_found';
  end if;
  -- #582: the Organization is the Group carrying the marker.
  if exists (select 1 from public.groups where id = v_event.group_id and is_organization) then
    if v_event.created_by is distinct from v_actor and v_level < 6 then
      raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
    end if;
  else
    begin
      perform private.require_group_work_manager(v_event.group_id);
    exception when insufficient_privilege then
      raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
    end;
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
  -- Minimum Level (private.can_read_event, the events_read rule).
  select array_agg(member_id) into v_old_members
    from private.group_audience(v_event.group_id) as member_id
   where private.can_read_event(p_min_level, member_id);
  update public.events set title = btrim(p_title), type = p_type::public.event_type,
    group_id = p_group_id, starts_at = p_starts_at, ends_at = p_ends_at,
    location = nullif(btrim(p_location), ''), capacity = p_capacity,
    description = nullif(btrim(p_description), ''), min_level = p_min_level
   where id = p_event_id returning * into v_updated;
  select array_agg(recipient) into v_recipients
    from private.event_notification_recipients(p_event_id) as recipient;
  if v_event.group_id is distinct from v_updated.group_id then
    v_recipients := coalesce(v_recipients, '{}'::uuid[]) || coalesce(v_old_members, '{}'::uuid[]);
  end if;
  foreach v_field in array array[
    case when v_event.starts_at is distinct from v_updated.starts_at or v_event.ends_at is distinct from v_updated.ends_at then 'schedule' end,
    case when v_event.location is distinct from v_updated.location then 'location' end,
    case when v_event.group_id is distinct from v_updated.group_id then 'group' end,
    case when v_event.min_level is distinct from v_updated.min_level then 'min_level' end
  ] loop
    if v_field is not null then
      v_body := case v_field
        when 'schedule' then 'Noua programare: '
          || to_char(v_updated.starts_at at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI')
          || coalesce(' - ' || to_char(v_updated.ends_at at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI'), '')
        when 'location' then 'Noua locație: ' || coalesce(v_updated.location, 'nespecificată')
        when 'group' then 'Noul grup: ' || v_target.name
        when 'min_level' then 'Noul nivel minim: ' || v_updated.min_level::text
      end;
      perform private.notify(v_recipients, 'event', 'Eveniment actualizat: ' || v_updated.title, v_body,
        null, 'event:' || p_event_id::text || ':' || v_field, v_actor, '/calendar');
    end if;
  end loop;
  return v_updated;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cancel_event_impl(p_event_id bigint, p_reason text)
 RETURNS events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_level integer;
  v_event public.events%rowtype;
begin
  if p_reason is null or p_reason !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'reason_required';
  end if;
  -- #673 (R8): measured as stored (cancel_event_effect btrims it).
  perform private.require_text_length('reason', btrim(p_reason), null, 1000);
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end;
  -- Lock the Event before inspecting its state; concurrent edits and cancellation serialize.
  select * into v_event from public.events where id = p_event_id for no key update;
  if not found or coalesce(private.actor_level(v_actor), -1) < v_event.min_level then
    raise sqlstate 'PT404' using message = 'event_not_found';
  end if;
  perform 1 from public.profiles where id = v_actor and status = 'activ' for share;
  if not found then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  v_level := private.actor_level(v_actor);
  if coalesce(v_level, -1) < v_event.min_level then
    raise sqlstate 'PT404' using message = 'event_not_found';
  end if;
  -- #582: the Organization is the Group carrying the marker.
  if exists (select 1 from public.groups where id = v_event.group_id and is_organization) then
    if v_event.created_by is distinct from v_actor and v_level < 6 then
      raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
    end if;
  else
    begin
      perform private.require_group_work_manager(v_event.group_id);
    exception when insufficient_privilege then
      raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
    end;
  end if;
  if v_event.cancelled_at is not null then
    raise sqlstate 'PT409' using message = 'event_cancelled';
  end if;

  -- Every gate above is this command's; the write and the fan-out are the
  -- shared effect (#582, section 4b), which archive_group calls with the
  -- Group's authority instead of an actor's.
  return private.cancel_event_effect(p_event_id, p_reason, v_actor);
end;
$function$;

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

CREATE OR REPLACE FUNCTION private.update_campaign_impl(p_campaign_id bigint, p_name text)
 RETURNS campaigns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_group_id bigint;
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
  select campaign.group_id
    into v_group_id
    from public.campaigns as campaign
   where campaign.id = p_campaign_id
   for update;

  if not found then
    raise sqlstate 'PT404' using message = 'campaign_not_found';
  end if;

  perform private.require_campaign_manager(v_group_id);

  if p_name is null or p_name !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_campaign_name';
  end if;
  v_name := regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');

  begin
    update public.campaigns as campaign
       set name = v_name,
           updated_at = clock_timestamp()
     where campaign.id = p_campaign_id
    returning campaign.* into v_campaign;
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

CREATE OR REPLACE FUNCTION private.create_group_impl(p_name text, p_category text, p_parent_id bigint DEFAULT NULL::bigint, p_min_level integer DEFAULT NULL::integer, p_manager_id uuid DEFAULT NULL::uuid, p_color text DEFAULT NULL::text, p_short text DEFAULT NULL::text)
 RETURNS groups
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor       uuid;
  v_actor_level integer;
  v_parent      public.groups%rowtype;
  v_min_level   integer;
  v_created     public.groups%rowtype;
begin
  -- 1. Malformed for every caller, so it is answered ahead of any authority
  --    verdict (conventions section 2). The presentation label is validated
  --    against the same vocabulary groups_category_ck holds, minus
  --    'organization': the Organization marker is a structural setting BC moves
  --    with update_group_structure, never something a create call may claim.
  if p_name is null or p_name !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_group_name';
  end if;
  -- #673 (R8): measured as stored (btrim).
  perform private.require_text_length('name', btrim(p_name), 3, 120);
  if p_category is null or p_category not in ('department', 'project', 'team') then
    raise sqlstate 'PT400' using message = 'invalid_group_category';
  end if;
  if p_min_level is not null and p_min_level not in (0, 1, 2, 3, 5, 6, 9) then
    raise sqlstate 'PT400' using message = 'invalid_group_min_level';
  end if;
  if p_color is not null and p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise sqlstate 'PT400' using message = 'invalid_group_color';
  end if;

  -- 2. Authority. A root Group is BC's and the Moderator's alone; a Child
  --    Group belongs to its parent's Managers. Every denial is the same
  --    42501, so an unknown parent, an archived one and one the caller may
  --    not touch are indistinguishable.
  if p_parent_id is null then
    begin
      v_actor := private.require_active_member();
    exception when insufficient_privilege then
      raise exception using errcode = '42501', message = 'group_manage_forbidden';
    end;
    perform 1 from public.profiles as profile
      where profile.id = v_actor and profile.status = 'activ'
      for share of profile;
    if not found then
      raise exception using errcode = '42501', message = 'group_manage_forbidden';
    end if;
    if coalesce(private.actor_level(v_actor), -1) < 6 then
      raise exception using errcode = '42501', message = 'group_manage_forbidden';
    end if;
  else
    -- The parent is a parent row, so it is locked FOR NO KEY UPDATE and never
    -- FOR UPDATE (conventions section 1): the new row's path is derived from
    -- it, two creates under one parent must serialize, and the foreign-key
    -- KEY SHARE every child insert takes must keep flowing.
    select parent.* into v_parent
      from public.groups as parent
     where parent.id = p_parent_id
     for no key update;
    if not found then
      raise exception using errcode = '42501', message = 'group_manage_forbidden';
    end if;
    v_actor := private.require_group_manager(p_parent_id);
    -- Reached only by a level-6 actor: below that, can_manage_group_work has
    -- already refused an archived parent with 42501. An authorized actor gets
    -- the real state conflict instead of a forbidden.
    if v_parent.status <> 'active' then
      raise sqlstate 'PT409' using message = 'group_archived';
    end if;
  end if;

  v_actor_level := private.actor_level(v_actor);
  v_min_level   := coalesce(p_min_level, v_parent.min_level, 0);

  -- 3. Minimum Level, judged against the loaded parent and the live actor.
  if v_parent.id is not null and v_min_level < v_parent.min_level then
    raise sqlstate 'PT400' using message = 'group_min_level_below_parent';
  end if;
  -- Moderator is exempt, as ADR-0009 already rules for Events: nobody else
  -- may put a Group out of their own reach.
  if coalesce(v_actor_level, -1) < 9 and v_min_level > coalesce(v_actor_level, -1) then
    raise sqlstate 'PT400' using message = 'group_min_level_above_actor';
  end if;

  -- 4. The Manager appointed with the Group (ruling R19: create_group is
  --    atomic, like create_project(p_leader_id) was). The profile is held
  --    `for share` before a roster row names it, so a concurrent deactivation
  --    serializes behind the decision. The same two reasons are raised again
  --    by the Appointment core at step 6; they are checked here first because
  --    an ineligible Manager must refuse before the Group row exists.
  if p_manager_id is not null then
    perform 1 from public.profiles as manager
      where manager.id = p_manager_id and manager.status = 'activ'
      for share of manager;
    if not found then
      raise sqlstate 'PT400' using message = 'group_member_not_eligible';
    end if;
    if coalesce(private.actor_level(p_manager_id), -1) < v_min_level then
      raise sqlstate 'PT400' using message = 'group_member_below_min_level';
    end if;
  end if;

  -- 5. Sibling names. The pre-check answers deterministically under the
  --    parent's lock; the exception arm below catches two roots racing, where
  --    there is no parent row to serialize on. groups_parent_name_uidx is
  --    still partial (native Groups only) until #591 dedupes the legacy names,
  --    so the pre-check matches the index exactly rather than being stricter
  --    than the constraint it explains.
  if exists (
    select 1 from public.groups as sibling
     where coalesce(sibling.parent_id, 0) = coalesce(p_parent_id, 0)
       and lower(sibling.name) = lower(btrim(p_name))
       and num_nonnulls(sibling.legacy_dept_id, sibling.legacy_team_id, sibling.legacy_project_id) = 0
  ) then
    raise sqlstate 'PT409' using message = 'group_name_taken';
  end if;

  begin
    insert into public.groups (
      name, category, parent_id, min_level, color, short, created_by
    ) values (
      btrim(p_name), p_category, p_parent_id, v_min_level,
      p_color, nullif(btrim(p_short), ''), v_actor
    )
    returning * into v_created;
  exception when unique_violation then
    raise sqlstate 'PT409' using message = 'group_name_taken';
  end;

  -- 6. The Manager's own roster row, written here so the Group is never
  --    created leaderless in a separate round trip -- and written through
  --    #583's Appointment core, the one insert path into public.group_members,
  --    which also tells the new Group Manager they were appointed.
  if p_manager_id is not null then
    perform private.appoint_group_member(v_created.id, p_manager_id, v_actor, 'manager');
  end if;

  return v_created;
end;
$function$;

CREATE OR REPLACE FUNCTION private.update_group_impl(p_group_id bigint, p_name text, p_manager_title text, p_accepts_applications boolean, p_application_level integer, p_shared_work_visibility boolean, p_min_level integer, p_confirm_removals boolean DEFAULT false)
 RETURNS groups
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor       uuid;
  v_actor_level integer;
  v_group       public.groups%rowtype;
  v_parent      public.groups%rowtype;
  v_accepts     boolean := coalesce(p_accepts_applications, false);
  v_shared      boolean := coalesce(p_shared_work_visibility, false);
  v_title       text    := nullif(btrim(p_manager_title), '');
  v_updated     public.groups%rowtype;
  v_below       uuid[];
  v_removed     uuid[];
  v_managers    uuid[];
begin
  if p_name is null or p_name !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_group_name';
  end if;
  -- #673 (R8): measured as stored (btrim).
  perform private.require_text_length('name', btrim(p_name), 3, 120);
  if p_manager_title is not null and p_manager_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;
  if p_min_level is null or p_min_level not in (0, 1, 2, 3, 5, 6, 9) then
    raise sqlstate 'PT400' using message = 'invalid_group_min_level';
  end if;
  if p_application_level is not null and p_application_level not in (0, 1, 2, 3, 5, 6, 9) then
    raise sqlstate 'PT400' using message = 'invalid_application_level';
  end if;
  if v_accepts and p_application_level is null then
    raise sqlstate 'PT400' using message = 'invalid_application_level';
  end if;
  if p_application_level is not null and p_application_level < p_min_level then
    raise sqlstate 'PT400' using message = 'application_level_below_min_level';
  end if;

  v_actor := private.require_group_manager(p_group_id);
  v_actor_level := private.actor_level(v_actor);

  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  if v_group.parent_id is null
     and p_min_level is distinct from v_group.min_level
     and coalesce(v_actor_level, -1) < 6 then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;

  if v_accepts and v_group.automatic_membership then
    raise sqlstate 'PT409' using message = 'automatic_group_accepts_no_applications';
  end if;

  if v_group.parent_id is not null then
    select parent.* into v_parent
      from public.groups as parent
     where parent.id = v_group.parent_id
     for no key update;
    if v_parent.id is not null and p_min_level < v_parent.min_level then
      raise sqlstate 'PT400' using message = 'group_min_level_below_parent';
    end if;
  end if;
  if exists (select 1 from public.groups as child
              where child.parent_id = p_group_id and child.min_level < p_min_level) then
    raise sqlstate 'PT400' using message = 'group_min_level_above_children';
  end if;
  if coalesce(v_actor_level, -1) < 9 and p_min_level > coalesce(v_actor_level, -1) then
    raise sqlstate 'PT400' using message = 'group_min_level_above_actor';
  end if;

  if exists (
    select 1 from public.groups as sibling
     where sibling.id <> p_group_id
       and coalesce(sibling.parent_id, 0) = coalesce(v_group.parent_id, 0)
       and lower(sibling.name) = lower(btrim(p_name))
       and num_nonnulls(sibling.legacy_dept_id, sibling.legacy_team_id, sibling.legacy_project_id) = 0
  ) then
    raise sqlstate 'PT409' using message = 'group_name_taken';
  end if;

  if (btrim(p_name), v_title, v_accepts, p_application_level, v_shared, p_min_level)
     is not distinct from
     (v_group.name, v_group.manager_title, v_group.accepts_applications,
      v_group.application_level, v_group.shared_work_visibility, v_group.min_level) then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  select array_agg(membership.member_id order by membership.member_id)
    into v_below
    from public.group_members as membership
    join public.profiles as profile on profile.id = membership.member_id
    join public.roles as role on role.id = profile.role
   where membership.group_id = p_group_id
     and role.level < p_min_level;

  if v_below is not null then
    if not coalesce(p_confirm_removals, false) then
      raise sqlstate 'PT409' using
        message = 'group_has_members_below_level',
        detail  = cardinality(v_below)::text;
    end if;

    perform 1 from public.group_members as membership
      where membership.group_id = p_group_id
        and membership.member_id = any (v_below)
      order by membership.member_id
      for update of membership;

    delete from public.group_members as membership
     where membership.group_id = p_group_id
       and membership.member_id = any (v_below);
    v_removed := v_below;

    -- #584 (ruling R30), the Application half of ruling R23.
    perform 1 from public.group_applications as application
      where application.group_id = p_group_id
        and application.member_id = any (v_removed)
        and application.status = 'pending'
      order by application.id
      for update of application;

    update public.group_applications as application
       set status     = 'withdrawn',
           decided_by = v_actor,
           decided_at = clock_timestamp()
     where application.group_id = p_group_id
       and application.member_id = any (v_removed)
       and application.status = 'pending';
  end if;

  update public.groups
     set name                   = btrim(p_name),
         manager_title          = v_title,
         accepts_applications   = v_accepts,
         application_level      = p_application_level,
         shared_work_visibility = v_shared,
         min_level              = p_min_level
   where id = p_group_id
  returning * into v_updated;

  if v_removed is not null then
    perform private.notify(
      v_removed, 'system'::public.noti_kind,
      'Nu mai faci parte din ' || v_updated.name,
      'Nivelul minim al grupului ' || v_updated.name
        || ' a fost ridicat, așa că nu mai faci parte din el.',
      null, null, v_actor);
    select array_agg(manager) into v_managers
      from private.group_managers(p_group_id) as manager;
    perform private.notify(
      v_managers, 'system'::public.noti_kind,
      'Nivel minim actualizat: ' || v_updated.name,
      cardinality(v_removed)::text || ' membri au fost eliminați din '
        || v_updated.name || ' după ridicarea nivelului minim.',
      null, null, v_actor, '/administrare/grupuri/' || p_group_id::text);
  end if;

  return v_updated;
end;
$function$;

CREATE OR REPLACE FUNCTION private.give_up_task_impl(p_task_id bigint, p_reason text)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
  v_reason text;
  v_assignment_id bigint;
  v_actor_name text;
  v_candidate public.task_candidates%rowtype;
  v_new_assignment_id bigint;
begin
  -- 1. Malformed for everyone: no reason, no give-up -- checked before the
  --    gate, so a claimless caller gets PT400 too (see the header).
  if p_reason is null or p_reason !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'reason_required';
  end if;
  v_reason := regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  -- #673 (R8): measured as stored (trimmed).
  perform private.require_text_length('reason', v_reason, null, 1000);
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked -- the serialization
  --    point this command shares with express_task_interest).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: being the live active Executor IS the authority.
  --    The helper locks the active Assignment FOR UPDATE and the actor's
  --    profile FOR SHARE, so a concurrent deactivation serializes behind this
  --    command rather than committing underneath it (#343 / #390).
  v_assignment_id := private.require_task_executor(p_task_id);
  -- 5. Input validation: p_reason, the only parameter besides the target, was
  --    validated at step 1.
  -- 6. State preconditions (PT409).
  if v_task.status not in ('todo', 'in_progress') then
    raise sqlstate 'PT409' using message = 'task_not_in_progress';
  end if;
  -- 7. Mutate: end the Assignment, record it, promote, then notify.
  perform private.end_task_assignment(v_assignment_id, 'gave_up', v_reason);
  perform private.log_task_activity(p_task_id, 'gave_up', v_actor, v_assignment_id, null, null,
    v_reason, jsonb_build_object('reason', v_reason));

  -- Promotion: the head of the derived queue, locked plainly (see the
  -- header). Joined to profiles filtered to activ so a deactivated Member is
  -- skipped rather than promoted (stack-context.md carry-forward, #332); the
  -- skipped row is untouched -- closing it is a manager act, not a side
  -- effect of this command. candidate.member_id <> v_actor is defensive: the
  -- giver-upper cannot legitimately hold a pending Candidature on the Task
  -- they are actively leaving today, but a future command (#338 reopen_task,
  -- #344 request approval) could assign them while still queued, and without
  -- this guard a give-up would instantly re-promote the person who just left.
  select candidate.* into v_candidate
    from public.task_candidates as candidate
    join public.profiles as profile on profile.id = candidate.member_id
   where candidate.task_id = p_task_id
     and candidate.status = 'pending'
     and profile.status = 'activ'
     and candidate.member_id <> v_actor
   order by candidate.joined_at, candidate.id
   limit 1
   for update of candidate;
  if found then
    -- The kit writes the Assignment, its executor_assigned row
    -- (details.via = 'queue_promotion') and the new Executor's 'Task nou'
    -- notification. private.open_task_assignment still checks the promoted
    -- Member's liveness itself (PT400 invalid_executor) -- belt and braces
    -- behind the activ filter above, not a substitute for it.
    v_new_assignment_id := private.open_task_assignment(
      p_task_id, v_candidate.member_id, v_actor, 'queue_promotion');
    update public.task_candidates as candidate
       set status = 'selected', decided_at = now(), decided_by = v_actor,
           assignment_id = v_new_assignment_id
     where candidate.id = v_candidate.id;
    perform private.log_task_activity(p_task_id, 'candidate_selected', v_actor, v_new_assignment_id,
      null, null, null,
      jsonb_build_object('candidate_id', v_candidate.id, 'member_id', v_candidate.member_id,
                         'promoted', true));
  end if;

  select coalesce(profile.nickname, profile.full_name) into v_actor_name
    from public.profiles as profile where profile.id = v_actor;
  perform private.notify(
    array(select private.task_managers(p_task_id, v_actor)),
    'task'::public.noti_kind,
    'Renunțare: ' || v_task.title,
    v_actor_name || ' a renunțat: ' || v_reason,
    p_task_id, null, v_actor);

  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$function$;

CREATE OR REPLACE FUNCTION private.return_task_to_progress_impl(p_task_id bigint, p_note text)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
  v_note text;
  v_assignment_id bigint;
  v_executor_id uuid;
  v_new_round integer;
begin
  -- 1. Malformed for everyone: no note, no feedback -- checked before the
  --    gate, so a claimless caller gets PT400 too.
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'note_required';
  end if;
  v_note := regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  -- #673 (R8): measured as stored (trimmed).
  perform private.require_text_length('note', v_note, null, 1000);
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: the Task's evaluator, never its manager.
  perform private.require_task_evaluator(p_task_id);
  -- 6. State precondition.
  if v_task.status <> 'in_review' then
    raise sqlstate 'PT409' using message = 'task_not_in_review';
  end if;
  -- 7. Mutate, then activity, then notify the active Executor.
  v_new_round := v_task.review_round + 1;
  update public.tasks
     set status = 'in_progress',
         review_round = v_new_round,
         returned_to_progress_at = now(),
         submitted_at = null
   where id = p_task_id;

  select assignment.id, assignment.member_id into v_assignment_id, v_executor_id
    from public.task_assignments as assignment
   where assignment.task_id = p_task_id and assignment.ended_at is null;

  perform private.log_task_activity(p_task_id, 'returned_to_progress', v_actor, v_assignment_id,
    'in_review'::public.task_status, 'in_progress'::public.task_status, v_note,
    jsonb_build_object('review_round', v_new_round));

  perform private.notify(
    array[v_executor_id],
    'task'::public.noti_kind,
    'Feedback de implementat: ' || v_task.title,
    v_note,
    p_task_id, null, v_actor);

  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$function$;

CREATE OR REPLACE FUNCTION private.reopen_task_impl(p_task_id bigint, p_reason text)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor              uuid;
  v_reason             text;
  v_task               public.tasks%rowtype;
  v_parent             public.tasks%rowtype;
  v_parent_id          bigint;
  v_evaluation         public.task_evaluations%rowtype;
  v_member_id          uuid;
  v_reversal_ledger_id bigint;
  v_new_assignment_id  bigint;
begin
  -- 1. Malformed for everyone: a reversal without a reason can never be
  --    written (task_evaluations_reversal_shape_ck), so it is rejected
  --    before the gate.
  if p_reason is null or p_reason !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'reason_required';
  end if;
  v_reason := regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  -- #673 (R8): measured as stored (trimmed).
  perform private.require_text_length('reason', v_reason, null, 1000);

  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);

  -- 3. The locks. This unlocked read exists only to learn WHICH parent row
  --    to lock first; every decision below is made from the locked rows.
  select parent_task_id into v_parent_id from public.tasks where id = p_task_id;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;

  -- FOR NO KEY UPDATE, not FOR UPDATE: private.evaluate_task takes an
  -- implicit FOR KEY SHARE on this same row through its parent-naming
  -- task_activity/notifications inserts, and FOR UPDATE would conflict with
  -- it and deadlock. See the header -- do not strengthen this.
  if v_parent_id is not null then
    select * into v_parent from public.tasks where id = v_parent_id for no key update;
    if not found then
      raise sqlstate 'PT404' using message = 'task_not_found';
    end if;
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;

  -- 4. Authority under lock: the Task's evaluator, never merely its manager.
  perform private.require_task_evaluator(p_task_id);

  -- 5. Input validation: none beyond the reason, already checked at step 1.

  -- 6. State preconditions.
  -- Defensive, and first: the Task's parent is re-read under its own lock,
  -- and a mismatch would mean the unlocked read above sent us to lock the
  -- wrong row -- i.e. the command would be holding no lock on the parent it
  -- is about to cascade into, silently breaking the lock order this whole
  -- file rests on. No command writes parent_task_id after creation, so the
  -- only writer that can produce this today is the legacy
  -- `tasks_update_legacy` policy, which #345 retires. Refuse rather than
  -- proceed unlocked; the caller retries and finds a consistent Task. It
  -- lives here, below the gate, so it answers only a caller step 4 has
  -- already authorized.
  if v_task.parent_task_id is distinct from v_parent_id then
    raise sqlstate 'PT409' using message = 'task_parent_changed';
  end if;

  -- #339, THE ONLY CHANGE IN THIS FUNCTION. A cancelled Umbrella has been
  -- called off in full -- public.cancel_task cascaded every non-terminal
  -- Subtask with it -- so putting one Subtask back to work under it would
  -- resurrect live work beneath a dead parent, the same rollup contradiction
  -- ADR-0007 forbids in the other direction (a completed Umbrella over a
  -- live Subtask, which the cascade below repairs). Unreachable before #339
  -- because an Umbrella could not be cancelled at all. It sits beside the
  -- other parent-shaped precondition, above task_is_umbrella, because a
  -- Subtask under a cancelled Umbrella is refused whatever its own status:
  -- there is no reopening it while its parent stands cancelled, and
  -- cancellation is terminal.
  if v_parent_id is not null and v_parent.status = 'cancelled' then
    raise sqlstate 'PT409' using message = 'umbrella_cancelled';
  end if;

  -- Kind next -- see the header.
  if v_task.kind <> 'task' then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  if v_task.status not in ('completed', 'unfulfilled') then
    raise sqlstate 'PT409' using message = 'task_not_evaluated';
  end if;

  -- 7. Mutate. The Evaluation is locked before it is reversed so that two
  --    concurrent reopens can never both see it open (the tasks row lock
  --    above already serializes them; this is the inner safety net, and the
  --    row the reversal and the ledger entry both hang off).
  select * into v_evaluation
    from public.task_evaluations as evaluation
   where evaluation.task_id = p_task_id
     and evaluation.reversed_at is null
     and evaluation.source = 'command'
   for update;
  if not found then
    raise sqlstate 'PT409' using message = 'evaluation_not_found';
  end if;

  -- The member the points were credited to: the EVALUATED Assignment's
  -- member. Read from that Assignment, never from the Task's current state.
  select assignment.member_id into v_member_id
    from public.task_assignments as assignment
   where assignment.id = v_evaluation.assignment_id;

  -- The evaluate-authority refinement, now decided on Groups (#524). It used
  -- to read the legacy Origin directly; the rule is unchanged, the source of
  -- truth is not. private.can_evaluate_task's Group Responsible carve-out is
  -- keyed on "the active Assignment, else the most recent one", so the same
  -- rule is re-applied here against the Assignment actually being REVERSED: a
  -- Group Responsible below level 6 may undo neither a Group Manager's nor
  -- another Responsible's award nor their own -- including their own
  -- `unfulfilled` penalty (ADR-0007, ADR-0009 Wave 2). Roles come from
  -- private.group_role_of, which walks the Group path, so an ancestor's
  -- Manager is a Manager here; level comes from the live Profile, never from
  -- the token. A member with no live role reads as an ordinary member, the
  -- same coalesce private.can_evaluate_task uses. Before any write.
  if coalesce(private.actor_level(v_actor), -1) < 6
     and private.group_role_of(v_task.group_id, v_actor) = 'responsible'
     and (v_member_id = v_actor
          or coalesce(private.group_role_of(v_task.group_id, v_member_id), 'member')
               in ('manager', 'responsible'))
  then
    raise exception using errcode = '42501', message = 'task_evaluate_forbidden';
  end if;

  -- Exactly the trio, exactly once -- the only UPDATE
  -- private.guard_task_evaluation_change permits.
  update public.task_evaluations
     set reversed_at     = now(),
         reversed_by     = v_actor,
         reversal_reason = v_reason
   where id = v_evaluation.id;

  insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id)
  values (v_member_id, -v_evaluation.points, 'task_reversal', p_task_id, v_evaluation.id)
  returning id into v_reversal_ledger_id;

  update public.tasks
     set status         = 'in_progress',
         difficulty     = null,
         rating         = null,
         completed_at   = null,
         unfulfilled_at = null,
         submitted_at   = null,
         started_at     = coalesce(started_at, now())
   where id = p_task_id;

  -- A NEW Assignment for the same member; the old one keeps its ending.
  -- p_via = 'reopen' suppresses the helper's own "Task nou" notification.
  v_new_assignment_id := private.open_task_assignment(p_task_id, v_member_id, v_actor, 'reopen');

  -- The cascade: only a COMPLETED Umbrella is an impossible parent for a
  -- live Subtask (ADR-0007's rollup rule). Any other status is left alone.
  if v_parent_id is not null and v_parent.status = 'completed' then
    update public.tasks
       set status = 'todo', completed_at = null
     where id = v_parent_id;
    perform private.log_task_activity(v_parent_id, 'reopened', v_actor, null,
      'completed'::public.task_status, 'todo'::public.task_status, v_reason,
      jsonb_build_object('cascade_from', p_task_id));
  end if;

  perform private.log_task_activity(p_task_id, 'reopened', v_actor, v_new_assignment_id,
    v_task.status, 'in_progress'::public.task_status, v_reason,
    jsonb_build_object('evaluation_id', v_evaluation.id,
                       'reversal_ledger_id', v_reversal_ledger_id,
                       'new_assignment_id', v_new_assignment_id));

  -- The reactivated Executor only. The Umbrella's managers get nothing of
  -- their own: the cascade is bookkeeping that follows from this Subtask,
  -- and the durable record is the Umbrella's own `reopened` activity row.
  -- private.notify drops the actor, so an evaluator reopening their own work
  -- is not messaged about it.
  perform private.notify(array[v_member_id], 'task'::public.noti_kind,
    'Task redeschis: ' || v_task.title, v_reason, p_task_id, null, v_actor);

  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cancel_task_impl(p_task_id bigint, p_reason text)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor          uuid;
  v_reason         text;
  v_task           public.tasks%rowtype;
  v_sub            public.tasks%rowtype;
  v_subtask_ids    bigint[] := '{}'::bigint[];
  v_subtask_id     bigint;
  v_assignment_id  bigint;
  v_executor_id    uuid;
  v_closed         uuid[];
  v_parent_title   text;
  v_subtask_count  integer;
  v_terminal_count integer;
begin
  -- 1. Malformed for everyone: tasks_cancel_reason_ck makes a reasonless
  --    cancellation unwritable, so it is refused before the gate.
  if p_reason is null or p_reason !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'reason_required';
  end if;
  v_reason := regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  -- #673 (R8): measured as stored (trimmed).
  perform private.require_text_length('reason', v_reason, null, 1000);

  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);

  -- 3. The locks. FOR NO KEY UPDATE, never FOR UPDATE -- see the header.
  select * into v_task from public.tasks where id = p_task_id for no key update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;

  -- The cascade set, locked in ONE statement before anything is written, in
  -- a deterministic id order. Terminal Subtasks are neither locked nor
  -- touched: their outcome is history.
  if v_task.kind = 'umbrella' then
    select coalesce(array_agg(locked.id order by locked.id), '{}'::bigint[])
      into v_subtask_ids
      from (
        select sub.id
          from public.tasks as sub
         where sub.parent_task_id = p_task_id
           and sub.status not in ('completed', 'unfulfilled', 'cancelled')
         order by sub.id
           for no key update
      ) as locked;
  end if;

  -- 4. Authority under lock: the Task's MANAGER (see the header for why not
  --    its evaluator). Re-validates against live rows and holds the actor's
  --    profile -- and the membership the authority rests on -- FOR SHARE.
  perform private.require_task_manager(p_task_id);

  -- 5. Input validation: none beyond the reason, already checked at step 1.

  -- 6. State preconditions. An Umbrella is deliberately allowed.
  if v_task.status in ('completed', 'unfulfilled', 'cancelled') then
    raise sqlstate 'PT409' using message = 'task_terminal';
  end if;

  -- 7. Mutate: the target first, then each locked Subtask.

  -- The one active Assignment, if any. FOR UPDATE because this is the row
  -- private.end_task_assignment is about to close; the tasks row lock above
  -- already serializes callers, this is the inner safety net.
  select assignment.id, assignment.member_id
    into v_assignment_id, v_executor_id
    from public.task_assignments as assignment
   where assignment.task_id = p_task_id and assignment.ended_at is null
   for update;

  -- Before the status write: tasks_queue_timestamp_state_check requires
  -- queue_closed_at on a public Task the instant it becomes terminal. A
  -- direct Task or an Umbrella is a no-op and v_closed comes back '{}'.
  v_closed := private.close_task_queue(p_task_id, v_actor);

  update public.tasks
     set status        = 'cancelled',
         cancelled_at  = now(),
         cancel_reason = v_reason
   where id = p_task_id;

  if v_assignment_id is not null then
    perform private.end_task_assignment(v_assignment_id, 'cancelled', v_reason);
  end if;

  -- assignment_id stays NULL on a `cancelled` row (Global Constraints'
  -- activity-row rule); the Assignment that was ended is recorded in details.
  perform private.log_task_activity(p_task_id, 'cancelled', v_actor, null,
    v_task.status, 'cancelled'::public.task_status, v_reason,
    jsonb_build_object('ended_assignment_id', v_assignment_id,
                       'closed_candidates', coalesce(array_length(v_closed, 1), 0))
    || case when v_task.kind = 'umbrella'
              then jsonb_build_object('cascaded_subtask_ids', to_jsonb(v_subtask_ids))
            else '{}'::jsonb end);

  perform private.notify(v_closed, 'task'::public.noti_kind,
    'Coadă închisă: ' || v_task.title,
    'Nu mai poți fi selectat pentru acest task.',
    p_task_id, null, v_actor);

  if v_executor_id is not null then
    perform private.notify(array[v_executor_id], 'task'::public.noti_kind,
      'Task anulat: ' || v_task.title, v_reason, p_task_id, null, v_actor);
  end if;

  -- The cascade. Every id here was locked in step 3.
  foreach v_subtask_id in array v_subtask_ids loop
    select * into v_sub from public.tasks where id = v_subtask_id;

    select assignment.id, assignment.member_id
      into v_assignment_id, v_executor_id
      from public.task_assignments as assignment
     where assignment.task_id = v_subtask_id and assignment.ended_at is null
     for update;

    v_closed := private.close_task_queue(v_subtask_id, v_actor);

    update public.tasks
       set status        = 'cancelled',
           cancelled_at  = now(),
           cancel_reason = v_reason
     where id = v_subtask_id;

    if v_assignment_id is not null then
      perform private.end_task_assignment(v_assignment_id, 'cancelled', v_reason);
    end if;

    perform private.log_task_activity(v_subtask_id, 'cancelled', v_actor, null,
      v_sub.status, 'cancelled'::public.task_status, v_reason,
      jsonb_build_object('cascade_from', p_task_id,
                         'ended_assignment_id', v_assignment_id,
                         'closed_candidates', coalesce(array_length(v_closed, 1), 0)));

    perform private.notify(v_closed, 'task'::public.noti_kind,
      'Coadă închisă: ' || v_sub.title,
      'Nu mai poți fi selectat pentru acest task.',
      v_subtask_id, null, v_actor);

    if v_executor_id is not null then
      perform private.notify(array[v_executor_id], 'task'::public.noti_kind,
        'Task anulat: ' || v_sub.title, v_reason, v_subtask_id, null, v_actor);
    end if;
  end loop;

  -- The independent-Subtask rollup: a Subtask cancelled ON ITS OWN tells its
  -- Umbrella's managers how far the Umbrella has got. No parent lock -- see
  -- the header. Counts are taken AFTER the status update, so this Subtask is
  -- already inside terminal_count.
  if v_task.parent_task_id is not null then
    select parent.title into v_parent_title
      from public.tasks as parent where parent.id = v_task.parent_task_id;

    select count(*),
           count(*) filter (where sub.status in ('completed', 'unfulfilled', 'cancelled'))
      into v_subtask_count, v_terminal_count
      from public.tasks as sub
     where sub.parent_task_id = v_task.parent_task_id;

    perform private.log_task_activity(v_task.parent_task_id, 'subtask_completed',
      v_actor, null, null, null, null,
      jsonb_build_object('subtask_id', p_task_id,
                         'outcome', 'cancelled',
                         'terminal_count', v_terminal_count,
                         'subtask_count', v_subtask_count));

    -- Romanian numeral agreement, the rule the wave applies everywhere:
    -- singular at 1, bare plural for 2-19, `de` + plural from 20 up. The
    -- noun agrees with the total (the numeral it follows).
    perform private.notify(
      array(select private.task_managers(v_task.parent_task_id, v_actor)),
      'task'::public.noti_kind,
      'Subtask încheiat: ' || v_parent_title,
      case
        when v_subtask_count = 1 then v_terminal_count || ' din 1 subtask încheiat.'
        when v_subtask_count < 20 then
          v_terminal_count || ' din ' || v_subtask_count || ' subtaskuri încheiate.'
        else v_terminal_count || ' din ' || v_subtask_count || ' de subtaskuri încheiate.'
      end,
      v_task.parent_task_id,
      'task:' || v_task.parent_task_id::text || ':subtasks',
      v_actor);
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$function$;

CREATE OR REPLACE FUNCTION private.complete_task_review_impl(p_task_id bigint, p_difficulty integer, p_rating integer, p_note text)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_task  public.tasks%rowtype;
begin
  -- 1. Malformed for everyone: an Evaluation without a note can never be
  --    written (task_evaluations_note_ck), so it is rejected before the gate
  --    -- the #335 precedent for the other evaluator-gated command.
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'evaluation_note_required';
  end if;
  -- #673 (R8): measured as private.evaluate_task stores it (trimmed).
  perform private.require_text_length('note',
    regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 1000);
  --    Difficulty and Rating join it here (whole-wave review, finding 5): a
  --    value outside task_evaluations' 1..5 CHECK could never succeed for ANY
  --    caller, so it is malformed for everyone and is answered before the
  --    gate -- which is what private.approve_completed_work_request_impl, the
  --    third caller of private.evaluate_task, already did.
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 5 then
    raise sqlstate 'PT400' using message = 'invalid_difficulty';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise sqlstate 'PT400' using message = 'invalid_rating';
  end if;
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: the Task's evaluator, never merely its manager.
  perform private.require_task_evaluator(p_task_id);
  -- 5. Input validation: nothing is left here -- both numeric inputs are
  --    range-checked at step 1 above, and the note with them.
  -- 6. State preconditions. Kind first: an Umbrella is never in_review
  --    either, so checking status first would answer task_not_in_review and
  --    hide the real reason an Umbrella can never be reviewed at all.
  if v_task.kind <> 'task' then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  if v_task.status <> 'in_review' then
    raise sqlstate 'PT409' using message = 'task_not_in_review';
  end if;
  -- 7. Mutate through the shared core, then re-read.
  perform private.evaluate_task(p_task_id, 'completed', p_difficulty, p_rating, p_note, v_actor);
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$function$;

CREATE OR REPLACE FUNCTION private.mark_task_unfulfilled_impl(p_task_id bigint, p_difficulty integer, p_rating integer, p_note text)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_task  public.tasks%rowtype;
begin
  -- 1. Malformed for everyone: an Evaluation without a note can never be
  --    written (task_evaluations_note_ck), so it is rejected before the
  --    gate -- the #336 precedent for the other evaluator-gated command.
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'evaluation_note_required';
  end if;
  -- #673 (R8): measured as private.evaluate_task stores it (trimmed).
  perform private.require_text_length('note',
    regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 1000);
  --    Difficulty and Rating join it here (whole-wave review, finding 5): a
  --    value outside task_evaluations' 1..5 CHECK could never succeed for ANY
  --    caller, so it is malformed for everyone and is answered before the
  --    gate -- which is what private.approve_completed_work_request_impl, the
  --    third caller of private.evaluate_task, already did.
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 5 then
    raise sqlstate 'PT400' using message = 'invalid_difficulty';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise sqlstate 'PT400' using message = 'invalid_rating';
  end if;
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: the Task's evaluator, never merely its manager.
  perform private.require_task_evaluator(p_task_id);
  -- 5. Input validation: nothing is left here -- both numeric inputs are
  --    range-checked at step 1 above, and the note with them.
  -- 6. State preconditions, in the brief's pinned order.
  if v_task.kind <> 'task' then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  if v_task.status not in ('todo', 'in_progress', 'in_review') then
    raise sqlstate 'PT409' using message = 'task_terminal';
  end if;
  if v_task.deadline is null or v_task.deadline >= now() then
    raise sqlstate 'PT409' using message = 'task_not_overdue';
  end if;
  if not exists (
    select 1 from public.task_assignments as assignment
     where assignment.task_id = p_task_id and assignment.ended_at is null
  ) then
    raise sqlstate 'PT409' using message = 'task_has_no_executor';
  end if;
  -- 7. Mutate through the shared core, then re-read.
  perform private.evaluate_task(p_task_id, 'unfulfilled', p_difficulty, p_rating, p_note, v_actor);
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$function$;

CREATE OR REPLACE FUNCTION private.approve_completed_work_request_impl(p_request_id bigint, p_difficulty integer, p_rating integer, p_note text)
 RETURNS completed_work_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor    uuid := (select auth.uid());
  v_note     text;
  v_request  public.completed_work_requests%rowtype;
  v_task     public.tasks%rowtype;
  v_points   integer;
begin
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 5 then
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
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'request_command_forbidden';
  end if;
  select * into v_request from public.completed_work_requests
   where id = p_request_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;
  if v_request.requester_id is distinct from v_actor
     and not coalesce(private.can_manage_group_work(v_request.group_id), false) then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;
  perform private.require_request_decider(p_request_id);
  if v_request.status <> 'pending' then
    raise sqlstate 'PT409' using message = 'request_not_pending';
  end if;
  insert into public.tasks
    (title, description, deadline, group_id,
     audience, assignment_mode, status, created_by)
  values (left(v_request.description, 120), v_request.description, now(),
          v_request.group_id,
          'local', 'direct', 'todo', v_actor)
  returning * into v_task;

  perform private.log_task_activity(v_task.id, 'created', v_actor, null, null, 'todo', null,
    jsonb_build_object('from_request_id', p_request_id));
  perform private.open_task_assignment(v_task.id, v_request.requester_id, v_actor, 'request_approval');
  perform private.evaluate_task(v_task.id, 'completed', p_difficulty, p_rating, v_note, v_actor);

  update public.completed_work_requests
     set status        = 'approved',
         decided_by    = v_actor,
         decided_at    = now(),
         decision_note = v_note,
         task_id       = v_task.id
   where id = p_request_id;
  v_points := p_difficulty * public.rating_mult(p_rating);
  perform private.notify(array[v_request.requester_id], 'task'::public.noti_kind,
    'Cerere aprobată: ' || left(v_request.description, 60),
    case when abs(v_points) = 1 then v_points || ' punct' else v_points || ' puncte' end
      || ' (dificultate ' || p_difficulty || ', calificativ ' || p_rating || ').',
    v_task.id, null, v_actor);

  select * into v_request from public.completed_work_requests where id = p_request_id;
  return v_request;
end;
$function$;

CREATE OR REPLACE FUNCTION private.reject_completed_work_request_impl(p_request_id bigint, p_note text)
 RETURNS completed_work_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor   uuid := (select auth.uid());
  v_note    text;
  v_request public.completed_work_requests%rowtype;
begin
  if p_note is null or p_note !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'note_required';
  end if;
  v_note := regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  -- #673 (R8): measured as stored (trimmed).
  perform private.require_text_length('note', v_note, null, 1000);
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'request_command_forbidden';
  end if;
  select * into v_request from public.completed_work_requests
   where id = p_request_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;
  if v_request.requester_id is distinct from v_actor
     and not coalesce(private.can_manage_group_work(v_request.group_id), false) then
    raise sqlstate 'PT404' using message = 'request_not_found';
  end if;
  perform private.require_request_decider(p_request_id);
  if v_request.status <> 'pending' then
    raise sqlstate 'PT409' using message = 'request_not_pending';
  end if;
  update public.completed_work_requests
     set status        = 'rejected',
         decided_by    = v_actor,
         decided_at    = now(),
         decision_note = v_note
   where id = p_request_id;

  perform private.notify(array[v_request.requester_id], 'task'::public.noti_kind,
    'Cerere respinsă: ' || left(v_request.description, 60),
    v_note,
    null, null, v_actor);

  select * into v_request from public.completed_work_requests where id = p_request_id;
  return v_request;
end;
$function$;

CREATE OR REPLACE FUNCTION private.create_completed_work_request_impl(p_description text, p_group_id bigint)
 RETURNS completed_work_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor       uuid := (select auth.uid());
  v_description text;
  v_actor_name  text;
  v_request     public.completed_work_requests%rowtype;
begin
  if p_description is null or p_description !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'description_required';
  end if;
  v_description := regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  -- #673 (R8): measured as stored (trimmed).
  perform private.require_text_length('description', v_description, null, 2000);
  if p_group_id is null then
    raise sqlstate 'PT400' using message = 'invalid_origin';
  end if;
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'request_command_forbidden';
  end if;
  select coalesce(profile.nickname, profile.full_name) into v_actor_name
    from public.profiles as profile where profile.id = v_actor;
  if private.group_role_of(p_group_id, v_actor) is null
     or (select status from public.groups where id = p_group_id) is distinct from 'active' then
    raise exception using errcode = '42501', message = 'request_origin_forbidden';
  end if;
  insert into public.completed_work_requests (requester_id, group_id, description, status)
  values (v_actor, p_group_id, v_description, 'pending') returning * into v_request;
  perform private.notify(array(select private.request_deciders(v_request.id)),
    'task'::public.noti_kind, 'Cerere nouă: ' || left(v_description, 60),
    coalesce(v_actor_name, 'Un membru') || ' a trimis o cerere de muncă realizată.',
    null, 'request:' || v_request.id::text, v_actor);
  return v_request;
end;
$function$;
