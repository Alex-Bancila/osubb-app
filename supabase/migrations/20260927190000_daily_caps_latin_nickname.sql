-- Security pass, backend findings L3 and L5 (2026-09-27).
--
-- L3 -- per-Member daily caps. Five writes notify other people: an
-- Application (the Group's Managers), an expression of interest (the Task's
-- managers), a Completed Work Request (its deciders), a new Task and an
-- Announcement (their audiences). Each is now capped per Member over a rolling
-- 24 hours, counted on the write's own durable rows -- no new table:
--
--   group_application       10  public.group_applications      (member_id, created_at)
--   task_interest           30  public.task_activity 'interest_expressed' (actor_id, created_at)
--   completed_work_request  30  public.completed_work_requests (requester_id, created_at)
--   task_create            100  public.task_activity 'created'  (actor_id, created_at);
--                                create_task and duplicate_task both spend it
--   announcement            20  public.announcements           (created_by, published_at)
--
-- A Member over a cap is refused with PT409 rate_limited; the DETAIL names the
-- cap and its window. The count runs under a transaction-scoped advisory lock
-- keyed on (cap, Member), taken after the command's own row locks, so two
-- concurrent calls by the same Member cannot both see the last free slot.
-- Withdrawn Applications and withdrawn interest still count: that is the
-- apply/withdraw loop the cap exists to stop.
--
-- L5 -- a Latin-only Nickname. [[:alnum:]] admits Cyrillic and Greek letters,
-- and fold_nickname only unaccents and lower-cases, so "Аlex" (Cyrillic А)
-- could sit beside "Alex". A Nickname is now ASCII letters and digits, the
-- Latin-1 and Latin Extended-A letters (U+00C0-U+017E less U+00D7 and U+00F7),
-- the Romanian comma-below letters Ș ș Ț ț (U+0218-U+021B), space, '.', '-'
-- and '_'. Existing rows are not changed: the constraint is added NOT VALID
-- with a NOTICE counting the stored Nicknames it would refuse, and
-- 20260927190100 validates it only when that count is zero.
--
-- Command bodies below are main's latest definitions (create_task_impl,
-- duplicate_task_impl and express_task_interest_impl from 20260925091107, apply_to_group_impl from
-- 20260924132724, create_completed_work_request_impl from 20260923231125,
-- guard_profile_nickname from 20260923223833) with only the cap call added.

create function private.require_daily_cap(p_cap text, p_actor uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_used  bigint;
  v_since timestamptz;
begin
  v_limit := case p_cap
    when 'group_application'      then 10
    when 'task_interest'          then 30
    when 'completed_work_request' then 30
    when 'task_create'            then 100
    when 'announcement'           then 20
  end;
  if v_limit is null then
    raise exception 'unknown daily cap: %', p_cap;
  end if;
  if p_actor is null then
    return;
  end if;

  -- One writer per (cap, Member) at a time; released at commit or rollback.
  perform pg_advisory_xact_lock(hashtextextended('osubb.daily_cap:' || p_cap || ':' || p_actor::text, 0));
  v_since := clock_timestamp() - interval '24 hours';

  v_used := case p_cap
    when 'group_application' then
      (select count(*) from public.group_applications as row_
        where row_.member_id = p_actor and row_.created_at > v_since)
    when 'task_interest' then
      (select count(*) from public.task_activity as row_
        where row_.actor_id = p_actor and row_.kind = 'interest_expressed' and row_.created_at > v_since)
    when 'completed_work_request' then
      (select count(*) from public.completed_work_requests as row_
        where row_.requester_id = p_actor and row_.created_at > v_since)
    when 'task_create' then
      (select count(*) from public.task_activity as row_
        where row_.actor_id = p_actor and row_.kind = 'created' and row_.created_at > v_since)
    when 'announcement' then
      (select count(*) from public.announcements as row_
        where row_.created_by = p_actor and row_.published_at > v_since)
  end;

  if v_used >= v_limit then
    raise sqlstate 'PT409' using
      message = 'rate_limited',
      detail  = format('%s: at most %s per Member in any 24 hours', p_cap, v_limit);
  end if;
end;
$$;

comment on function private.require_daily_cap(text, uuid) is
  'Security pass L3: refuses PT409 rate_limited when p_actor already has the cap''s limit of writes in the last 24 hours (group_application 10, task_interest 30, completed_work_request 30, task_create 100, announcement 20), counted on the write''s own rows under a (cap, Member) advisory lock. A null actor (a server-side write) is never capped.';

revoke execute on function private.require_daily_cap(text, uuid)
  from public, anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION private.apply_to_group_impl(p_group_id bigint, p_note text DEFAULT NULL::text)
 RETURNS group_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor       uuid;
  v_actor_level integer;
  v_group       public.groups%rowtype;
  v_note        text := nullif(btrim(p_note), '');
  v_row         public.group_applications%rowtype;
  v_recipients  uuid[];
begin
  -- 0. #724 (ruling R8): a note over 1000 characters is malformed for every
  --    caller, so it is answered before the actor is even resolved. It is
  --    measured as it is stored -- trimmed.
  perform private.require_text_length('note', v_note, null, 1000);

  -- 1. The actor. A claimless session, a session with no live Profile and a
  --    deactivated Member are one answer, and it is the command's own scope
  --    word rather than the Group tier's: nothing about the Group has been
  --    read yet, so nothing about it may be revealed.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'group_apply_forbidden';
  end;

  -- The actor's own Profile is held `for share` before a decision rests on
  -- their rank, so a concurrent deactivation or demotion serializes behind
  -- this Application instead of committing underneath it (conventions
  -- section 2).
  perform 1 from public.profiles as applicant
    where applicant.id = v_actor and applicant.status = 'activ'
    for share of applicant;
  if not found then
    raise exception using errcode = '42501', message = 'group_apply_forbidden';
  end if;
  v_actor_level := private.actor_level(v_actor);

  -- 2. The Group, FOR NO KEY UPDATE: this command does not write it, it needs
  --    the settings it judges the Application against — status, Minimum
  --    Level, Accepts Applications, Application Level — to hold still, which
  --    is exactly what serializes it against a concurrent update_group. Never
  --    FOR SHARE on a groups row (the cross-cutting lock rule).
  select grp.* into v_group
    from public.groups as grp
   where grp.id = p_group_id
   for no key update;

  -- 3. Visibility (shape 1), mirroring groups_read limb for limb against LIVE
  --    rank rather than the claim. An unknown Group and one the caller cannot
  --    see are the same answer; the pending-Application limb is included so
  --    the command and the policy cannot disagree about which Groups exist
  --    for this caller — a re-application by someone whose Level has since
  --    fallen is answered application_pending at step 5, not "no such Group".
  --    #756: groups_read's Private Group gate comes first, as in the policy.
  if not found
     or not private.can_see_group(p_group_id, v_actor)
     or not (
       (v_group.status = 'active' and coalesce(v_actor_level, -1) >= v_group.min_level)
       or coalesce(v_actor_level, -1) >= 5
       or coalesce(private.group_role_of(p_group_id, v_actor) in ('manager', 'responsible'), false)
       or private.has_pending_group_application(p_group_id)
     ) then
    raise sqlstate 'PT404' using message = 'group_not_found';
  end if;

  -- 4. State conflicts the caller can act on. An archived Group accepts
  --    nothing whatever its settings say, and it reaches this line only for a
  --    caller at level >= 5, who can see archived Groups.
  --    #756 (ruling R25): a Private Group accepts no Applications whatever
  --    its settings say -- entry is by Appointment. Only a caller who can see
  --    it reaches this line (a member of a Group below it, a Manager or
  --    Responsible on its path, BC or the Moderator).
  if v_group.is_private then
    raise sqlstate 'PT400' using message = 'group_private';
  end if;
  if v_group.status <> 'active' or not v_group.accepts_applications then
    raise sqlstate 'PT409' using message = 'group_not_accepting_applications';
  end if;

  -- private.is_group_member answers for THIS Group only — an explicit roster
  -- row of any Group Role, or Automatic Membership at or above the Minimum
  -- Level. Membership of an ancestor is not membership here (Wave 2 ruling
  -- D2), so a Department member may apply to its Child Team.
  if coalesce(private.is_group_member(p_group_id, v_actor), false) then
    raise sqlstate 'PT409' using message = 'already_group_member';
  end if;

  -- 5. One pending Application per pair. The pre-check answers deterministically
  --    under the Group's lock; the exception arm below catches the window two
  --    concurrent calls can still open between this read and the insert.
  if exists (
    select 1 from public.group_applications as pending
     where pending.group_id = p_group_id
       and pending.member_id = v_actor
       and pending.status = 'pending'
  ) then
    raise sqlstate 'PT409' using message = 'application_pending';
  end if;

  -- 6. The Application Level (shape 2), the one refusal that is about the
  --    caller rather than about the Group. It is answered last because it is
  --    the only one that tells the caller something about themselves, and
  --    because groups_application_level_ck guarantees it is never null here:
  --    a Group that accepts Applications names its Level.
  if coalesce(v_actor_level, -1) < coalesce(v_group.application_level, v_group.min_level) then
    raise exception using errcode = '42501', message = 'group_apply_forbidden';
  end if;

  -- 6b. Security pass L3: at most ten Applications per Member in any 24 hours,
  --     whatever became of them, so an apply/withdraw loop cannot keep
  --     notifying the Group's Managers. After every other refusal, so the
  --     caller hears the specific reason first.
  perform private.require_daily_cap('group_application', v_actor);

  begin
    insert into public.group_applications (group_id, member_id, note)
    values (p_group_id, v_actor, v_note)
    returning * into v_row;
  exception when unique_violation then
    raise sqlstate 'PT409' using message = 'application_pending';
  end;

  -- 7. The people who can decide it hear about it, through the one recipient
  --    set (shape 3). The link is Administrare's Group screen, because that is
  --    where the Cereri tab lives (#589) — a Manager or Responsible acts on it
  --    there, not on the member-facing page. private.notify drops the actor,
  --    so a Manager who somehow applies to a Group below their own is not told
  --    about their own Application.
  select array_agg(recipient) into v_recipients
    from private.group_application_recipients(v_row.id) as recipient;

  perform private.notify(
    v_recipients, 'system'::public.noti_kind,
    'Cerere de înscriere: ' || v_group.name,
    (select coalesce(profile.nickname, profile.full_name) from public.profiles as profile where profile.id = v_actor)
      || ' vrea să intre în grupul ' || v_group.name || '.'
      || case when v_note is null then '' else ' „' || v_note || '”' end,
    null, 'application:' || v_row.id::text, v_actor,
    '/administrare/grupuri/' || p_group_id::text);

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION private.express_task_interest_impl(p_task_id bigint)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
  v_executor uuid;
  v_candidate_id bigint;
  v_position integer;
  v_pending integer;
begin
  -- 2. Gate + visibility
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked -- concurrent joins
  --    serialize here, so positions and the coalesced count never race)
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: the Audience rule, re-validated against live
  --    rows and holding them FOR SHARE.
  perform 1 from public.profiles as profile
   where profile.id = v_actor and profile.status = 'activ' for share;
  if not found then
    raise exception using errcode = '42501', message = 'task_command_forbidden';
  end if;
  if v_task.audience = 'local' then
    -- A local Opportunity admits the members of its own Group (ADR-0009): an explicit
    -- roster row of any Group Role, or Automatic Membership at or above the Group's
    -- Minimum Level -- private.is_group_member, the test can_read_task and update_task
    -- (R-E8) apply. The actor's roster row, when there is one, is held FOR SHARE so a
    -- concurrent removal cannot race the check; never a lock on the groups row.
    perform 1 from public.group_members as membership
     where membership.group_id = v_task.group_id and membership.member_id = v_actor
     for share of membership;
    if not coalesce(private.is_group_member(v_task.group_id, v_actor), false) then
      raise exception using errcode = '42501', message = 'task_audience_forbidden';
    end if;
  end if;
  -- 5. Input validation: the only parameter is the target itself, already
  --    resolved by require_task_visible.
  -- 6. State preconditions (PT409) -- umbrella first.
  if v_task.kind = 'umbrella' then
    raise sqlstate 'PT409' using message = 'task_is_umbrella';
  end if;
  if v_task.assignment_mode is distinct from 'public' then
    raise sqlstate 'PT409' using message = 'task_not_public';
  end if;
  if v_task.status in ('completed', 'unfulfilled', 'cancelled') then
    raise sqlstate 'PT409' using message = 'task_terminal';
  end if;
  if v_task.queue_closed_at is not null then
    raise sqlstate 'PT409' using message = 'task_queue_closed';
  end if;
  -- Read under the Task lock: the Executor the manager selected may not also
  -- queue for their own Task.
  select assignment.member_id into v_executor
    from public.task_assignments as assignment
   where assignment.task_id = p_task_id and assignment.ended_at is null
   for update;
  if v_executor = v_actor then
    raise sqlstate 'PT409' using message = 'already_executor';
  end if;
  if exists (select 1 from public.task_candidates as candidate
              where candidate.task_id = p_task_id
                and candidate.member_id = v_actor
                and candidate.status = 'pending') then
    raise sqlstate 'PT409' using message = 'already_candidate';
  end if;
  -- Security pass L3: at most thirty expressions of interest per Member in any
  -- 24 hours (the interest_expressed activity rows are append-only), so an
  -- express/withdraw loop cannot keep notifying the Task's managers.
  perform private.require_daily_cap('task_interest', v_actor);
  -- 7. Mutate, then activity, then notify, then return. Always a pending
  --    Candidate, whether or not the Task has an Executor (#682, R9).
  insert into public.task_candidates (task_id, member_id, status, joined_at)
  values (p_task_id, v_actor, 'pending', now())
  returning id into v_candidate_id;
  -- After the insert, by contract: the position is the one the Member
  -- actually joined at. queue_position is self-gated but answers for the
  -- caller's own id, which is exactly v_actor here.
  v_position := private.queue_position(p_task_id, v_actor);
  perform private.log_task_activity(p_task_id, 'interest_expressed', v_actor, null, null, null, null,
    jsonb_build_object('position', v_position, 'candidate_id', v_candidate_id));
  v_pending := private.pending_candidate_count(p_task_id);
  perform private.notify(
    array(select private.task_managers(p_task_id, v_actor)),
    'task'::public.noti_kind,
    'Coadă: ' || v_task.title,
    case when v_pending = 1 then '1 candidat în așteptare.'
         when v_pending < 20 then v_pending::text || ' candidați în așteptare.'
         else v_pending::text || ' de candidați în așteptare.' end,
    p_task_id, 'task:' || p_task_id::text || ':queue', v_actor);
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
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
  -- Security pass L3: at most thirty Completed Work Requests per Member in
  -- any 24 hours, so a Member cannot flood the deciders with Notifications.
  perform private.require_daily_cap('completed_work_request', v_actor);
  insert into public.completed_work_requests (requester_id, group_id, description, status)
  values (v_actor, p_group_id, v_description, 'pending') returning * into v_request;
  perform private.notify(array(select private.request_deciders(v_request.id)),
    'task'::public.noti_kind, 'Cerere nouă: ' || left(v_description, 60),
    coalesce(v_actor_name, 'Un membru') || ' a trimis o cerere de muncă realizată.',
    null, 'request:' || v_request.id::text, v_actor);
  return v_request;
end;
$function$;

CREATE OR REPLACE FUNCTION private.create_task_impl(p_title text, p_description text, p_deadline timestamp with time zone, p_audience text, p_assignment_mode text, p_executor_id uuid, p_campaign_id bigint, p_parent_task_id bigint, p_kind text, p_group_id bigint, p_link_label text, p_link_url text)
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
  -- Security pass L3: at most one hundred Tasks created per Member in any 24
  -- hours (counted on the append-only 'created' activity rows), after every
  -- validation so a malformed call still hears its own reason.
  perform private.require_daily_cap('task_create', v_actor);
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

  -- Security pass L3: a duplicate is a new Task, so it spends the same
  -- one-hundred-a-day allowance as create_task (its 'created' row counts).
  perform private.require_daily_cap('task_create', v_actor);

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

-- Announcements are written by direct table DML (RLS: announcements_create),
-- so their cap is a BEFORE INSERT row guard, named to fire after
-- announcements_guard_text (row triggers fire in name order), so a malformed
-- Announcement still hears its own reason first. It runs as the owner to count
-- every one of the author's rows, not only those the author can still read.
-- A write with no auth.uid() (seed, migrations, server jobs) is not capped.
create function private.guard_announcement_daily_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_daily_cap('announcement', (select auth.uid()));
  return new;
end;
$$;

comment on function private.guard_announcement_daily_cap() is
  'Trigger body (security pass L3): at most twenty Announcements per author in any 24 hours; PT409 rate_limited beyond.';

revoke execute on function private.guard_announcement_daily_cap()
  from public, anon, authenticated, service_role;

create trigger announcements_rate_cap
  before insert on public.announcements
  for each row execute function private.guard_announcement_daily_cap();

-- ==================== L5: a Latin-only Nickname ====================


CREATE OR REPLACE FUNCTION private.guard_profile_nickname()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_nickname text;
begin
  v_nickname := nullif(btrim(normalize(new.nickname, nfc)), '');
  if v_nickname is not null then
    if char_length(v_nickname) < 2 then
      raise exception using errcode = '23514', message = 'nickname_too_short';
    elsif char_length(v_nickname) > 24 then
      raise exception using errcode = '23514', message = 'nickname_too_long';
    elsif v_nickname !~ '^[A-Za-z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017E\u0218-\u021B ._-]+$' then
      raise exception using errcode = '23514', message = 'nickname_invalid';
    end if;
    if exists (
      select 1
        from public.profiles as other
       where other.nickname is not null
         and private.fold_nickname(other.nickname) = private.fold_nickname(v_nickname)
         and other.id <> new.id
    ) then
      raise exception using errcode = '23514', message = 'nickname_taken';
    end if;
  end if;
  new.nickname := v_nickname;
  return new;
end;
$function$;


alter table public.profiles drop constraint profiles_nickname_ck;
alter table public.profiles add constraint profiles_nickname_ck check (
  nickname is null
  or (nickname = btrim(nickname)
      and nickname ~ '^[A-Za-z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017E\u0218-\u021B ._-]{2,24}$')
) not valid;

-- Existing data is never rewritten. The count of stored Nicknames the new rule
-- refuses is reported here; 20260927190100 validates the constraint only when
-- that count is zero (conventions: a new limit on an existing table ships as
-- NOT VALID, then a later validate).
do $$
declare
  v_failing bigint;
begin
  select count(*) into v_failing
    from public.profiles
   where nickname is not null
     and not (nickname = btrim(nickname)
              and nickname ~ '^[A-Za-z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017E\u0218-\u021B ._-]{2,24}$');
  raise notice 'profiles_nickname_ck (Latin-only): % stored Nickname(s) would fail', v_failing;
end
$$;
