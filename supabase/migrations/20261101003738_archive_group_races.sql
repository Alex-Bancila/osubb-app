-- #1145: archive_group no longer races create_event, create_task and the Event-move branch of update_event -- the owning Group is held FOR NO KEY UPDATE and judged under that lock.
--
-- Audit finding M6 (docs/review/2026-10-30-codebase-audit.md).
-- private.archive_group_impl holds the target FOR UPDATE and its descendants
-- FOR NO KEY UPDATE, cancels the subtree's future Events, then flips the
-- status; the three creators read the Group unlocked. Their inserts took only
-- the foreign key's KEY SHARE on the Group row, which waits behind FOR UPDATE
-- on the target and then succeeds, and does not conflict with NO KEY UPDATE
-- on a descendant at all -- so an Event or Task could land in a Group being
-- archived in the same instant, which only BC could still touch, and whose
-- audience had just been told "Eveniment nou".
--
-- Each body below is main's latest -- create_event_impl from
-- 20261023190000_all_day_events.sql, create_task_impl from
-- 20261031210933_archived_group_no_new_work.sql (#1127), update_event_impl
-- from 20261031203938_move_to_pending_tells_old_group_at_approval.sql (#1130)
-- -- with the owning Group read FOR SHARE -- a row these commands only read
-- (conventions section 2); it conflicts with exactly the locks archive_group
-- takes and with every structural write of the Group, while concurrent
-- creators share the row -- and PT409 group_archived judged on the locked row
-- after authority: create_event takes the lock first thing and
-- drops its two unlocked "active" reads (an unknown or unauthorized Group
-- stays 42501 calendar_manage_forbidden; an archived one now answers the
-- creators' reason); create_task takes it where #1127 read the status --
-- after the Umbrella, the tasks-then-groups order update_task's move takes,
-- so no ABBA cycle forms with it, and archive_group never locks a tasks row;
-- update_event holds the Group the call names before the Event row (always,
-- since whether the call is a move is known only under the Event lock; an
-- edit in place only waits), the Groups-then-Events order
-- archive_group takes. No signature changes: grants and the
-- tracker_grants roster are untouched. supabase/tests/archive_group_races.test.sql
-- and create_event.test.sql's BC-on-archived pin failed before this file.

-- ==================== private.create_event_impl ====================
create or replace function private.create_event_impl(
  p_title text,
  p_type text,
  p_group_id bigint,
  p_starts_at timestamptz,
  p_ends_at timestamptz default null,
  p_location text default null,
  p_capacity integer default null,
  p_description text default null,
  p_min_level integer default 0,
  p_campaign_id bigint default null,
  p_announce boolean default false,
  p_all_day boolean default false
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
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
  -- #1098 (R63): events_all_day_bounds_ck, said before anything is judged.
  if coalesce(p_all_day, false) and (
       p_ends_at is null
       or (p_starts_at at time zone 'Europe/Bucharest')::time <> time '00:00'
       or (p_ends_at at time zone 'Europe/Bucharest')::time <> time '00:00') then
    raise sqlstate 'PT400' using message = 'invalid_all_day_bounds';
  end if;
  -- #673 (R8): an Event's start is judged against now only at creation.
  -- #1098: an all-day Event starts at today's midnight, so it is judged by
  -- its Bucharest day -- today's may still be created.
  if (case when coalesce(p_all_day, false)
          then (p_starts_at at time zone 'Europe/Bucharest')::date
               < (now() at time zone 'Europe/Bucharest')::date
          else p_starts_at < now() end) then
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

  -- #1145 (audit M6): the Group row is held FOR SHARE before anything else is
  -- read or written -- a row this command only reads (conventions section 2).
  -- FOR SHARE conflicts with exactly the locks archive_group takes (the target
  -- FOR UPDATE, the subtree FOR NO KEY UPDATE) and with every structural write
  -- of the Group, while concurrent creators share it, so an archive serializes
  -- here and the status judged below is the one it committed. An unknown
  -- Group is still "you may not" (42501), never "no such Group".
  select * into v_group from public.groups where id = p_group_id for share;
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
        -- Lock only roster rows here; the Group row itself is held FOR SHARE
        -- above (#1145). The legacy mirror upserts that once made a Group
        -- SHARE lock unsafe are gone since #586.
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
  -- Refresh the level after any wait for live authority; the Group row is
  -- the locked snapshot. #1145: an archived Group is refused here, after
  -- authority, with the creators' reason (PT409 group_archived, #1127) -- a
  -- Group Role below level 6 already failed the authority rule on it.
  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
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
    insert into public.events(title,type,group_id,starts_at,ends_at,all_day,location,capacity,description,min_level,campaign_id,created_by)
      values (btrim(p_title),p_type::public.event_type,p_group_id,p_starts_at,p_ends_at,coalesce(p_all_day, false),
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
                                              v_created.location, v_created.description,
                                              v_created.all_day),
              v_created.group_id,
              case when v_group.is_organization then 'org' else 'local' end,
              v_created.min_level,
              -- The Termen is the Event's start. #1098 (R63): an all-day Event
              -- starts at a midnight and lasts its whole days, so its
              -- Announcement has no Termen (a timed start is never past here).
              case when not v_created.all_day then v_created.starts_at end,
              v_actor);
    perform set_config('osubb.announcement_event', '', true);
  else
    -- R39: without the Announcement, the Event tells its audience itself.
    perform private.notify_event_created(v_created, v_actor);
  end if;
  return v_created;
end;
$$;


comment on function private.create_event_impl(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean, boolean) is
  'Creates an Event on a Group, authorized by Group Role (ADR-0009 Wave 2, #370). Malformed input is judged first, for everyone, so a caller without organization claims learns what is wrong with the call: PT400 invalid_event_title / invalid_event_type / invalid_event_interval / invalid_all_day_bounds / invalid_event_capacity / invalid_event_min_level / event_group_required. #1098 (R63): p_all_day = true stores a Toată ziua Event, whose bounds must be Bucharest midnights with an end (exclusive, the midnight after its last day) -- anything else is PT400 invalid_all_day_bounds, the rule of events_all_day_bounds_ck -- and whose start is judged against today by its Bucharest day (PT400 starts_at_in_past only for a day before today). The Organization Group — since #582 the Group carrying groups.is_organization, not the row mirroring the legacy org pseudo-department — is open to any live Member holding any Group Role anywhere, which is how a Department''s leadership gets an organization-wide Event, or to level >= 6; every other Group goes through private.require_group_work_manager, so a Group Manager or Group Responsible on the path, an ancestor''s included, qualifies and an ordinary member does not. Every refusal is the single non-disclosing 42501 calendar_manage_forbidden, so a missing, archived or forbidden Group are indistinguishable. Minimum Level is then judged against the loaded rows: PT400 event_min_level_below_group (an Event may not be more open than its Group) and PT400 event_min_level_above_actor (nobody raises an Event above their own live level), the latter with Moderator exempt. An optional Campaign (#691, ADR-0008 amended 2026-09-23) must be owned by the Event''s Group or a Group above it and be active (events_validate_campaign); anything else is PT400 invalid_campaign, the string create_task uses for the same condition. #909: p_announce = true also publishes one Announcement in the same transaction (title, a Romanian date/time/place/description body from private.event_announcement_body, the Event''s Group, audience org for the Organization Group else local, min_level = the Event''s, deadline = starts_at -- none for an all-day Event, #1098 --, the caller as author, normal fan-out); it is judged before the Event is written by the announcements_create predicate private.can_publish_announcement (42501 announcement_publish_forbidden). Any refusal, including the Announcement''s own row guards, leaves no Event behind. Ruling R39 (2026-10-06): without p_announce the new Event notifies its audience once -- private.event_notification_recipients (the Group Audience that Notifications reach, minus BC and the Moderator per R32 save a BC member whose Group position reaches the Event''s Group per R42, read through private.can_read_event: Minimum Level and Private Groups), never the creator -- with kind event, title Eveniment nou: <title>, the date line and place of private.event_announcement_body as body, link /calendar?event=<id> and dedupe key event:<id>:created (subject event:<id>, R37), in one private.notify insert. With p_announce the Announcement''s fan-out is that notice, so no Event Notification is written: one notice per Member. Every creation spends the event_create daily cap (50 per Member in any 24 hours, private.require_daily_cap; PT409 rate_limited), judged after the gate and before the Event is written. Spec 2026-10-11: an OSUBB-wide Event by a writer below BC is written pending (private.stamp_approval), tells nobody and keeps p_announce as announce_on_approval for approve_event; the "Eveniment nou" notice lives in private.notify_event_created. #1145 (audit M6): the Group row is held FOR SHARE before anything else, so a concurrent archive_group (FOR UPDATE on its target, FOR NO KEY UPDATE on the subtree) serializes ahead of the insert while concurrent creators share the row; an archived Group then answers PT409 group_archived after authority (an unknown or unauthorized one stays 42501 calendar_manage_forbidden).';

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
  v_group_status text;
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
  -- authority and input refusal, before the cap and the write. #1145 (audit
  -- M6): the Group row is held FOR SHARE (a row this command only reads) --
  -- after the Umbrella, the tasks-then-groups order update_task's move takes,
  -- so the two cannot form an ABBA cycle; archive_group never locks a tasks
  -- row -- so a concurrent archive (FOR UPDATE on its target, FOR NO KEY UPDATE
  -- on the subtree) serializes here and the status read is the one it
  -- committed, while concurrent creators share the row.
  select grp.status into v_group_status
    from public.groups as grp where grp.id = v_group for share;
  if v_group_status <> 'active' then
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
  'Creates one Task, Subtask or Umbrella in a Group the live caller may manage (private.require_group_work_manager, 42501 task_manage_forbidden); the actor is auth.uid(), never a parameter. A top-level Task names its Group (PT400 task_group_required without one); a Subtask locks its Umbrella FOR NO KEY UPDATE, inherits its Group, and refuses a different p_group_id (subtask_origin_mismatch). A direct Executor must be activ and at or above the Group''s Minimum Level (invalid_executor). #684, R46: up to five Attached Links (p_links; or, from an app version before R46, the one pair p_link_label + p_link_url) are judged at step 1 by private.require_attached_links and stored in tasks.links; an Umbrella may carry them like any Task. R57 (2026-10-14): p_min_level, the Task''s Minimum Level (0 by default; stored only on an ordinary public Task, a direct Task or an Umbrella stays at 0; PT400 invalid_task_min_level off the ladder, task_min_level_above_actor above the creator''s own Level). #1127 (audit M3): PT409 group_archived unless the Task''s Group is active, judged after every authority and input refusal and before the cap and the write -- no new work lands in an archived Group, whoever the caller is. #1145 (audit M6): that status is read with the Group row held FOR SHARE (after the Umbrella, the order update_task takes), so a concurrent archive_group serializes ahead of the insert while concurrent creators share the row.';

-- ==================== private.update_event_impl ====================
create or replace function private.update_event_impl(
  p_event_id bigint,
  p_title text,
  p_type text,
  p_group_id bigint,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_location text,
  p_capacity integer,
  p_description text,
  p_min_level integer,
  p_campaign_id bigint,
  p_all_day boolean default null
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
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
  v_all_day boolean;
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
  -- #1098 (R63): events_all_day_bounds_ck, create_event's reason. A null
  -- p_all_day (a client from before it) keeps the Event's own, judged at
  -- step 5 once the row is loaded.
  if p_all_day and (
       p_ends_at is null
       or (p_starts_at at time zone 'Europe/Bucharest')::time <> time '00:00'
       or (p_ends_at at time zone 'Europe/Bucharest')::time <> time '00:00') then
    raise sqlstate 'PT400' using message = 'invalid_all_day_bounds';
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

  -- 3a. #1145 (audit M6): the Group the call names -- a move's target, or the
  --     Event's own on an edit in place -- is held FOR SHARE before the Event
  --     row, the order archive_group takes (the Groups, then the subtree's
  --     Events), so the two serialize instead of deadlocking and a move's
  --     target status, judged after authority, is the one a concurrent
  --     archive committed; concurrent edits share the row. Unconditional on
  --     purpose: whether the call is a move is known only once the Event row
  --     is locked, and an edit in place only waits here (it is still not
  --     refused when its Group has been archived meanwhile, the header's
  --     reason 2). An unknown Group locks nothing and is judged below.
  perform 1 from public.groups as target where target.id = p_group_id for share;
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
  -- On a move this reads the row step 3a holds.
  select * into v_target from public.groups where id = p_group_id;
  if not found then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  if p_group_id is distinct from v_event.group_id then
    -- Even an Organization Event's creator must hold authority in the new Group.
    begin
      if v_target.is_organization then
        if v_level < 6 then
          -- Lock only roster rows here; on a move the target Group row is
          -- held FOR SHARE at step 3a (#1145). The legacy mirror upserts that
          -- once made a Group SHARE lock unsafe are gone since #586.
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
    -- #1145 (audit M6): the target must be active, judged after its authority
    -- on the row held at step 3a (PT409 group_archived, the creators' reason
    -- since #1127). A Group Role below level 6 already failed the rule above.
    if v_target.status <> 'active' then
      raise sqlstate 'PT409' using message = 'group_archived';
    end if;
  end if;

  -- 5. Minimum Level, judged against the loaded target Group and the live actor.
  if p_min_level < v_target.min_level then
    raise sqlstate 'PT400' using message = 'event_min_level_below_group';
  end if;
  if v_level < 9 and p_min_level > v_level then
    raise sqlstate 'PT400' using message = 'event_min_level_above_actor';
  end if;
  -- #1098 (R63): Toată ziua as asked, or -- p_all_day null, a client from
  -- before it -- as the Event already is, so such an edit never turns an
  -- all-day Event into a timed one; its bounds then answer to the kept value.
  v_all_day := coalesce(p_all_day, v_event.all_day);
  if p_all_day is null and v_all_day and (
       p_ends_at is null
       or (p_starts_at at time zone 'Europe/Bucharest')::time <> time '00:00'
       or (p_ends_at at time zone 'Europe/Bucharest')::time <> time '00:00') then
    raise sqlstate 'PT400' using message = 'invalid_all_day_bounds';
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
      all_day = v_all_day,
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
  -- #1130 (audit M7): the old Group's audience hears of the move only while
  -- the Event stays approved. A move by a Manager below BC onto the
  -- Organization Group sends it back to pending (private.stamp_approval), so
  -- v_recipients is empty and the old audience must not get "Eveniment
  -- actualizat" of an Event events_read now hides from them: approve_event
  -- tells them, "new" or "changed" through private.told_of, with the rest of
  -- the organisation once BC decides.
  if v_event.group_id is distinct from v_updated.group_id
     and v_updated.approval_status = 'approved' then
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
           or v_event.ends_at is distinct from v_updated.ends_at
           or v_event.all_day is distinct from v_updated.all_day then 'programare' end,
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
        || case when v_updated.all_day then
             -- #1098: days only, the last one the day before the exclusive end.
             to_char(v_updated.starts_at at time zone 'Europe/Bucharest', 'DD.MM.YYYY')
             || case when ((v_updated.ends_at at time zone 'Europe/Bucharest') - interval '1 day')::date
                          > (v_updated.starts_at at time zone 'Europe/Bucharest')::date
                     then ' - ' || to_char((v_updated.ends_at at time zone 'Europe/Bucharest') - interval '1 day', 'DD.MM.YYYY')
                     else '' end
             || ', toată ziua'
           else
             to_char(v_updated.starts_at at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI')
             || coalesce(' - ' || to_char(v_updated.ends_at at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI'), '')
           end,
      'Locație: ' || v_updated.location,
      case when v_event.group_id is distinct from v_updated.group_id then 'Grup: ' || v_target.name end,
      case when v_event.min_level is distinct from v_updated.min_level
        then 'Nivel minim: ' || v_updated.min_level::text end
    ], null);
    perform private.notify_event(v_updated, v_actor, v_recipients, array_to_string(v_parts, '. '));
  end if;
  return v_updated;
end;
$$;


comment on function private.update_event_impl(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint, boolean) is
  'Replaces an Event''s whole editable state, authorized by Group Role (ADR-0009 Wave 2, #248). This is a full-state REPLACE, not a patch: every editable column is written from its argument, so a null clears a nullable column (ends_at, location, capacity, description, campaign_id) rather than leaving the old value -- a client that wants to keep a field must send it back; p_all_day (#1098, R63) is written too when given; null or absent (a client from before it) keeps the Event''s own all_day, and the bounds are then judged against it (PT400 invalid_all_day_bounds at step 5). Malformed input is judged first, for everyone, with the same reasons as create_event including event_group_required and invalid_all_day_bounds. A caller who cannot see the Event (below its min_level) is answered PT404 event_not_found, the same as an id that does not exist: hidden is never distinguishable from missing. Authority on the SOURCE: an Organization Group Event (since #582 the Group carrying groups.is_organization) belongs to its creator or to level >= 6; every other Event goes through private.require_group_work_manager, so a Group Manager or Group Responsible of the Group or any ancestor on its path qualifies. Moving the Event re-runs the rule on the TARGET Group, where an Organization target takes create_event''s rule -- level >= 6 or any live Group Role anywhere -- because the Organization Group is a root Group with no ancestors of its own (one root among several: every Department, Independent Team and Project Group is a root too, and most Group paths never contain it), so nobody could reach it through an ancestor role. A MOVE''s target must be active. An edit that leaves the Event in its own Group is NOT refused when that Group has since been archived: this is a full-state replace, so every call names a Group, and an ungated check would leave such an Event uncorrectable while cancel_event -- same authority rule -- still cancelled it. Who may still edit it is decided by the source rule above alone: BC/Moderator always, a Group Role only while the Group is active, which is can_manage_group_work''s own status gate. Minimum Level is then judged against the target Group and the live actor (PT400 event_min_level_below_group / event_min_level_above_actor), and a cancelled Event is PT409 event_cancelled. The Campaign (#691, ADR-0008 amended 2026-09-23) must be owned by the Event''s Group -- the new one, on a move -- or a Group above it, and a newly attached one must be active (events_validate_campaign); anything else is PT400 invalid_campaign, and a Campaign deactivated after it was attached is kept when sent back unchanged. R53 (2026-10-14): every content change -- title, description, type, schedule (an all-day switch included), location, capacity, Group, Minimum Level -- notifies, in one notice per edit that names what changed and carries the current schedule (for an all-day Event its days and "toată ziua", no hour) and place, the current going attendees and the new Group''s Group Audience as Notifications reach it (private.group_notification_audience: #601, minus every live BC member and Moderator, #929, plus the BC members whose Group position reaches it, R42), plus the old Group''s when the Event moved, every recipient filtered through private.can_read_event at the new Minimum Level, link /calendar?event=<id>: private.notify_event tells whoever knows the Event "Eveniment actualizat" (event:<id>:changed) and whoever does not "Eveniment nou"; a Campaign alone notifies nobody. #934: the source-authority rule is private.can_manage_event, the one definition event_attendance_read also reads; the command holds the roster rows it rests on FOR SHARE and asks it again. Spec 2026-10-11 (final review of 2026-10-13): a pending or rejected OSUBB-wide Event moved off the Organization Group is published by the move (private.stamp_approval) -- its new Group hears "Eveniment nou" through private.notify_event_created and no change notice is sent; the old Group''s audience is told of a move only when the Event had been approved and stays approved (#1130, audit M7 of 2026-10-30: a move by a Manager below BC onto the Organization Group makes it pending again, tells the old audience nothing of an Event events_read now hides from them, and leaves them to approve_event, which tells them with the rest of the organisation). #1145 (audit M6): a move holds the target Group FOR SHARE before the Event row (the order archive_group takes), so a concurrent archive serializes ahead of the move while concurrent moves share the row, and an archived target then answers PT409 group_archived after its authority rule.';
