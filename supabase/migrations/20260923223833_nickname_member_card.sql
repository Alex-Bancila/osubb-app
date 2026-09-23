-- #675: Nickname on profiles (R5), full_name a privileged column, every server-side name reads the Nickname, and public.member_card() (R6, R17).
--
-- Folding. Uniqueness ignores case and diacritics: `Ștefan`, `stefan` and
-- `STEFAN` are one Nickname. private.fold_nickname pins the unaccent
-- dictionary by name (the two-argument form), which is what lets it be
-- declared immutable and indexed -- the one-argument unaccent(text) is only
-- stable because it resolves the dictionary at call time. Hosted Supabase
-- ships unaccent. Should a target ever lack it, the fallback is a translate()
-- over the Romanian diacritic set (ăâîșşțţ and their capitals -> aaisstt)
-- inside the same function, followed by lower(); it is documented here and
-- deliberately not built.
--
-- Validation order. The trigger normalizes (NFC, trim, blank -> null) and
-- names the reason (23514 nickname_too_short / nickname_too_long /
-- nickname_invalid / nickname_taken); profiles_nickname_ck and
-- profiles_nickname_fold_uidx stay the invariants underneath it, the index
-- being the only guard under concurrency (its 23505 falls to the client's
-- generic message).

create extension if not exists unaccent with schema extensions;

-- ==================== profiles.nickname ====================

alter table public.profiles add column nickname text;
alter table public.profiles add constraint profiles_nickname_ck check (
  nickname is null
  or (nickname = btrim(nickname) and nickname ~ '^[[:alnum:] ._-]{2,24}$')
);
comment on column public.profiles.nickname is
  'Nickname (R5): the short name shown wherever the application names the Member; null means the full name stands in. Self-editable, and BC/Moderator-editable on any row. 2-24 letters, digits, spaces, ".", "-", "_", unique ignoring case and diacritics.';

create function private.fold_nickname(p_nickname text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, btrim(p_nickname)));
$$;
comment on function private.fold_nickname(text) is
  'The comparison key for Nickname uniqueness: trimmed, unaccented, lower-cased. Immutable because the unaccent dictionary is named explicitly; indexed by profiles_nickname_fold_uidx.';
revoke execute on function private.fold_nickname(text)
  from public, anon, authenticated, service_role;
-- The nickname guard is security invoker and calls this for the caller.
grant execute on function private.fold_nickname(text) to authenticated;

create unique index profiles_nickname_fold_uidx
  on public.profiles (private.fold_nickname(nickname))
  where nickname is not null;

create function private.guard_profile_nickname()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_nickname text;
begin
  v_nickname := nullif(btrim(normalize(new.nickname, nfc)), '');
  if v_nickname is not null then
    if char_length(v_nickname) < 2 then
      raise exception using errcode = '23514', message = 'nickname_too_short';
    elsif char_length(v_nickname) > 24 then
      raise exception using errcode = '23514', message = 'nickname_too_long';
    elsif v_nickname !~ '^[[:alnum:] ._-]+$' then
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
$$;
comment on function private.guard_profile_nickname() is
  'profiles_guard_nickname: trims and NFC-normalizes the Nickname, turns blank into null, and names the reason a Nickname is refused (23514 nickname_too_short / nickname_too_long / nickname_invalid / nickname_taken). Runs as the caller; the unique index stays the guard under concurrency.';
revoke execute on function private.guard_profile_nickname()
  from public, anon, authenticated, service_role;

create trigger profiles_guard_nickname
  before insert or update of nickname on public.profiles
  for each row execute function private.guard_profile_nickname();

-- Every Member reads a colleague's Nickname; a Member writes their own, BC and
-- Moderator anyone's -- the row split is profiles_update_self, unchanged.
grant select (nickname) on public.profiles to authenticated;
grant update (nickname) on public.profiles to authenticated;

create or replace view public.profiles_directory with (security_invoker = on) as
  select id, full_name, role, status, avatar_color, tier, joined_year, created_at, joined_at,
         nickname
    from public.profiles;

-- ==================== full_name becomes privileged (R5) ====================
-- Rebuilt from 20260918114752_profiles_joined_at.sql, the latest body; only
-- the full_name line and the message change. An unchanged full_name still
-- passes (is not distinct from), so a client resending the stored name is
-- not refused.
create or replace function public.guard_profile_privileged_columns() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.full_name       is not distinct from old.full_name
     and new.role        is not distinct from old.role
     and new.status      is not distinct from old.status
     and new.email       is not distinct from old.email
     and new.tier        is not distinct from old.tier
     and new.joined_year is not distinct from old.joined_year
     and new.joined_at   is not distinct from old.joined_at then
    return new;
  end if;
  if public.auth_level() >= 6 or current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  raise exception
    'Only BC (level >= 6) may change full_name, role, status, email, tier, joined_year or joined_at on a profile'
    using errcode = '42501';
end;
$$;

-- ==================== Notification bodies read the Nickname ====================
-- Each body below is main's latest catalog definition with exactly one change:
-- the actor's name is coalesce(nickname, full_name), read at write time.
-- De verificat (submit_task_for_review), Renunțare (give_up_task), Cerere nouă
-- (create_completed_work_request), Executor nou (express_task_interest's
-- first-come branch; #682 retires that branch -- whichever lands second keeps
-- the coalesce), Cerere de înscriere (apply_to_group).

create or replace function private.submit_task_for_review_impl(p_task_id bigint)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid;
  v_actor_name text;
  v_task public.tasks%rowtype;
  v_assignment_id bigint;
begin
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: only the active Executor. Same Umbrella
  --    fallthrough as start_task -- see the header.
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
  perform private.log_task_activity(p_task_id, 'submitted', v_actor, v_assignment_id,
    'in_progress'::public.task_status, 'in_review'::public.task_status, null, '{}'::jsonb);
  select coalesce(profile.nickname, profile.full_name) into v_actor_name
    from public.profiles as profile where profile.id = v_actor;
  perform private.notify(
    array(select private.task_managers(p_task_id, v_actor)),
    'task'::public.noti_kind,
    'De verificat: ' || v_task.title,
    v_actor_name || ' a trimis taskul spre verificare.',
    p_task_id, null, v_actor);
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$function$;

create or replace function private.give_up_task_impl(p_task_id bigint, p_reason text)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $function$
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

create or replace function private.create_completed_work_request_impl(p_description text, p_group_id bigint)
returns public.completed_work_requests
language plpgsql
security definer
set search_path = ''
as $function$
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

create or replace function private.express_task_interest_impl(p_task_id bigint)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid;
  v_task public.tasks%rowtype;
  v_executor uuid;
  v_actor_name text;
  v_candidate_id bigint;
  v_position integer;
  v_pending integer;
begin
  -- 2. Gate + visibility
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked -- the serialization
  --    point for the whole first-come race)
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
  -- 6. State preconditions (PT409) -- umbrella first, see the header.
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
  -- Read under the Task lock, never before it: this is the branch the race
  -- turns on.
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
  -- 7. Mutate, then activity, then notify, then return
  select coalesce(profile.nickname, profile.full_name) into v_actor_name
    from public.profiles as profile where profile.id = v_actor;
  if v_executor is null then
    -- First come: the kit writes the Assignment, its executor_assigned row
    -- (assignment_id set, details.via = 'first_come') and the Executor's own
    -- 'Task nou' notification -- which private.notify then drops, the actor
    -- being the recipient.
    perform private.open_task_assignment(p_task_id, v_actor, v_actor, 'first_come');
    perform private.notify(
      array(select private.task_managers(p_task_id, v_actor)),
      'task'::public.noti_kind,
      'Executor nou: ' || v_task.title,
      v_actor_name || ' a preluat taskul.',
      p_task_id, null, v_actor);
  else
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
  end if;
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$function$;

create or replace function private.apply_to_group_impl(p_group_id bigint, p_note text default null)
returns public.group_applications
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor       uuid;
  v_actor_level integer;
  v_group       public.groups%rowtype;
  v_note        text := nullif(btrim(p_note), '');
  v_row         public.group_applications%rowtype;
  v_recipients  uuid[];
begin
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
  if not found
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


-- ==================== Readers gain nickname beside full_name ====================
-- A returns-table change needs drop + create; wrapper and body alike, grants
-- and comments re-issued (conventions section 4). Ordering is unchanged.

drop function public.visible_task_executors(bigint[]);
drop function private.visible_task_executors(bigint[]);

create function private.visible_task_executors(p_task_ids bigint[])
returns table (
  task_id bigint,
  member_id uuid,
  full_name text,
  nickname text
)
language sql
stable
security definer
set search_path = ''
as $$
  select assignment.task_id, assignment.member_id, profile.full_name, profile.nickname
    from public.task_assignments as assignment
    left join public.profiles as profile on profile.id = assignment.member_id
   where coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null
     and assignment.ended_at is null
     and assignment.task_id = any(coalesce(p_task_ids, array[]::bigint[]))
     and private.can_read_task(assignment.task_id)
   order by assignment.task_id;
$$;

comment on function private.visible_task_executors(bigint[]) is
  'Least-privilege #499 read implementation: returns only the current Executor identity (id, full name, Nickname) for Tasks the live caller may already read; Assignment history and contact fields remain private.';

create function public.visible_task_executors(p_task_ids bigint[])
returns table (
  task_id bigint,
  member_id uuid,
  full_name text,
  nickname text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select executor.task_id, executor.member_id, executor.full_name, executor.nickname
    from private.visible_task_executors(p_task_ids) as executor;
$$;

comment on function public.visible_task_executors(bigint[]) is
  'Authenticated RPC for #499. Accepts Task ids and returns only each readable Task current Executor id, full name and Nickname.';

revoke execute on function private.visible_task_executors(bigint[])
  from public, anon, authenticated, service_role;
revoke execute on function public.visible_task_executors(bigint[])
  from public, anon, authenticated, service_role;
grant execute on function private.visible_task_executors(bigint[]) to authenticated;
grant execute on function public.visible_task_executors(bigint[]) to authenticated;

-- pending_request_decisions has no _impl: it is one invoker function under
-- Request, Group and directory RLS. requester_nickname sits beside its
-- requester_name, the column that already carries the full name.
drop function public.pending_request_decisions();

create function public.pending_request_decisions()
returns table(id bigint, description text, requester_id uuid, requester_name text, requester_nickname text, group_id bigint, group_name text, created_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select request.id, request.description, request.requester_id,
         requester.full_name, requester.nickname, request.group_id, origin.name, request.created_at
    from public.completed_work_requests as request
    join public.profiles_directory as requester on requester.id = request.requester_id
    join public.groups as origin on origin.id = request.group_id
   where coalesce(public.auth_is_member(), false)
     and request.status = 'pending'
     and private.can_decide_request(request.id)
   order by request.created_at, request.id;
$$;
revoke all on function public.pending_request_decisions() from public, anon, authenticated, service_role;
grant execute on function public.pending_request_decisions() to authenticated;
comment on function public.pending_request_decisions() is
  'Read-only pending Request queue delegated to live can_decide_request, under Request, Group and directory RLS. No self-decisions; clients page stable created_at/id order. requester_nickname is the Requester''s Nickname beside requester_name (their full name).';

drop function public.leadership_leaderboard(bigint, bigint);
drop function private.leadership_leaderboard_impl(bigint, bigint);

create function private.leadership_leaderboard_impl(p_group_id bigint, p_campaign_id bigint)
returns table (member_id uuid, full_name text, nickname text, points integer, rank integer)
language sql
stable
security definer
set search_path = ''
as $$
  with task_points as (
    select entry.member_id as member_id,
           sum(entry.delta)::int as points
      from public.points_ledger as entry
      join public.tasks as task on task.id = entry.task_id
      join public.groups as task_group on task_group.id = task.group_id
     where entry.reason in ('task', 'task_reversal')
       and public.auth_level() >= 5
       and (select private.caller_level()) >= 5
       and exists (
         select 1
           from public.profiles as caller
          where caller.id = (select auth.uid())
            and caller.status = 'activ'
       )
       and (p_group_id is null or task_group.path @> array[p_group_id])
       and (p_campaign_id is null or task.campaign_id = p_campaign_id)
     group by entry.member_id
  )
  select scored.member_id,
         member.full_name,
         member.nickname,
         scored.points,
         rank() over (order by scored.points desc)::int
    from task_points as scored
    join public.profiles as member on member.id = scored.member_id
   order by scored.points desc, member.full_name asc;
$$;

comment on function private.leadership_leaderboard_impl(bigint, bigint) is
  'Group-subtree Leaderboard body. Filters follow the Task Group, never the Member roster; Cup participation settings do not restrict the board.';

create function public.leadership_leaderboard(
  p_group_id bigint default null,
  p_campaign_id bigint default null
)
returns table (member_id uuid, full_name text, nickname text, points integer, rank integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
    from private.leadership_leaderboard_impl(
           p_group_id, p_campaign_id)
   order by points desc, full_name asc;
$$;

comment on function public.leadership_leaderboard(bigint, bigint) is
  'Live BCE+ Task-points Leaderboard filtered by Group subtree and Campaign. Retains inactive earners, zero/negative totals, shared ranks on ties, and stable points-descending/name ordering. Returns the Nickname beside the full name.';

revoke execute on function private.leadership_leaderboard_impl(bigint, bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.leadership_leaderboard(bigint, bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.leadership_leaderboard_impl(bigint, bigint) to authenticated;
grant execute on function public.leadership_leaderboard(bigint, bigint) to authenticated;

drop function public.campaign_report(bigint);
drop function private.campaign_report_impl(bigint);

create function private.campaign_report_impl(p_campaign_id bigint)
returns table (member_id uuid, full_name text, nickname text, tasks_completed integer, points integer)
language plpgsql
stable security definer
set search_path = ''
as $function$
begin
  perform private.require_campaign_report_access(p_campaign_id);

  return query
  with campaign_tasks as (
    select task.id, task.status
      from public.tasks as task
     where task.campaign_id = p_campaign_id
  ),
  -- Every Member who ever held the Executor Assignment on a Campaign Task
  -- (ruling 3) -- Assignment History, not the ledger, so a give-up or an
  -- unfulfilled/cancelled outcome still leaves the volunteer on the report.
  executors as (
    select distinct assignment.member_id
      from public.task_assignments as assignment
      join campaign_tasks as ct on ct.id = assignment.task_id
  ),
  -- Net ledger rows per (member, Task): reason in ('task', 'task_reversal')
  -- is the same filter private.leadership_leaderboard_impl and
  -- private.department_cup_rows use, so a reopened-and-re-evaluated Task's
  -- reversal nets against its original credit automatically.
  ledger_rows as (
    select entry.member_id, entry.task_id, entry.delta
      from public.points_ledger as entry
      join campaign_tasks as ct on ct.id = entry.task_id
     where entry.reason in ('task', 'task_reversal')
  ),
  -- One row per (member, Task): the member's NET ledger contribution to that
  -- Task -- both points and tasks_completed are derived from this single
  -- number, never from ledger row counts (fix round 1, controller review).
  -- Without this, a Task that was completed by A, reopened, and reassigned
  -- to B (A: +N then -N, B: +M) left A with a `task` row on a `completed`
  -- Task, so A's net-zero history still counted the Task as completed for
  -- A as well as for B -- two "completions" off one Task.
  member_task_net as (
    select ledger_rows.member_id, ledger_rows.task_id,
           sum(ledger_rows.delta)::int as net_points
      from ledger_rows
     group by ledger_rows.member_id, ledger_rows.task_id
  ),
  points_by_member as (
    select member_task_net.member_id, sum(member_task_net.net_points)::int as points
      from member_task_net
     group by member_task_net.member_id
  ),
  -- A completed Task counts toward tasks_completed only where the member's
  -- OWN net on it is positive -- a fully reversed cycle (net zero, or
  -- negative from a penalty rating) is not "their" completion, whoever else
  -- went on to actually finish the Task.
  completed_by_member as (
    select member_task_net.member_id,
           count(*)::int as tasks_completed
      from member_task_net
      join campaign_tasks as ct
        on ct.id = member_task_net.task_id and ct.status = 'completed'
     where member_task_net.net_points > 0
     group by member_task_net.member_id
  )
  select executors.member_id,
         profile.full_name,
         profile.nickname,
         coalesce(completed_by_member.tasks_completed, 0),
         coalesce(points_by_member.points, 0)
    from executors
    join public.profiles as profile on profile.id = executors.member_id
    left join points_by_member on points_by_member.member_id = executors.member_id
    left join completed_by_member on completed_by_member.member_id = executors.member_id
   order by coalesce(points_by_member.points, 0) desc, profile.full_name asc;
end;
$function$;


comment on function private.campaign_report_impl(bigint) is
  'One row per volunteer who ever held the Executor Assignment on a Task of this Campaign (Assignment History, not the ledger -- ruling 3). points is each member''s net points_ledger sum over the Campaign''s Tasks; tasks_completed counts only a completed Task on which that member''s OWN net for it is positive (fix round 1: a fully-reversed-then-reassigned Task does not count as a completion for the member it was taken away from). PT404 campaign_not_found for an unknown Campaign, checked before authority (ruling 2); 42501 campaign_report_forbidden for a claimless/inactive caller or one private.can_manage_group_work refuses.';

create function public.campaign_report(p_campaign_id bigint)
returns table (
  member_id       uuid,
  full_name       text,
  nickname        text,
  tasks_completed int,
  points          int
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.campaign_report_impl(p_campaign_id);
$$;

comment on function public.campaign_report(bigint) is
  'Per-volunteer Campaign report (member_id, full_name, nickname, tasks_completed, points); callable only by whoever manages work in the Campaign''s Group, or BC/Moderator (private.can_manage_group_work). PT404 campaign_not_found for an unknown Campaign; 42501 campaign_report_forbidden otherwise.';

revoke execute on function private.campaign_report_impl(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.campaign_report(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.campaign_report_impl(bigint) to authenticated;
grant execute on function public.campaign_report(bigint) to authenticated;

-- ==================== The Member Card projection (R6, R17) ====================

create function private.member_card_impl(p_member_id uuid)
returns table (
  member_id           uuid,
  nickname            text,
  full_name           text,
  role                public.member_role,
  joined_at           date,
  avatar_color        text,
  primary_group_id    bigint,
  primary_group_name  text,
  primary_group_color text,
  other_memberships   int,
  memberships         jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with explicit_memberships as (
    select membership.group_id,
           member_group.name,
           member_group.parent_id,
           member_group.color,
           membership.group_role,
           membership.position_title,
           membership.created_at
      from public.group_members as membership
      join public.groups as member_group on member_group.id = membership.group_id
     where membership.member_id = p_member_id
       and member_group.status = 'active'
       and not member_group.is_organization
  ),
  primary_membership as (
    select explicit_memberships.group_id,
           explicit_memberships.name,
           explicit_memberships.color
      from explicit_memberships
     where explicit_memberships.parent_id is null
     order by explicit_memberships.created_at, explicit_memberships.group_id
     limit 1
  )
  select profile.id,
         profile.nickname,
         profile.full_name,
         profile.role,
         profile.joined_at,
         profile.avatar_color,
         primary_membership.group_id,
         primary_membership.name,
         primary_membership.color,
         ((select count(*) from explicit_memberships)
           - (select count(*) from primary_membership))::int,
         coalesce((
           select jsonb_agg(
                    jsonb_build_object(
                      'group_id',       explicit_memberships.group_id,
                      'name',           explicit_memberships.name,
                      'parent_id',      explicit_memberships.parent_id,
                      'color',          explicit_memberships.color,
                      'group_role',     explicit_memberships.group_role,
                      'position_title', explicit_memberships.position_title,
                      'joined_at',      explicit_memberships.created_at)
                    order by explicit_memberships.created_at, explicit_memberships.group_id)
             from explicit_memberships
         ), '[]'::jsonb)
    from public.profiles as profile
    left join primary_membership on true
   where profile.id = p_member_id
     and coalesce(public.auth_is_member(), false)
     and exists (
       select 1
         from public.profiles as caller
        where caller.id = (select auth.uid())
          and caller.status = 'activ'
     );
$$;

comment on function private.member_card_impl(uuid) is
  'Member Card projection body (R6, R17). One row for any Member when the caller carries organization claims and an activ Profile, none otherwise. The chip (primary_group_*) is the roster row with the earliest created_at on an active top-level Group that is not the Organization Group; other_memberships counts the remaining explicit rows on active, non-Organization Groups; memberships lists every such row, the chip''s included, in roster created_at order. No contact column, no points, no rank; the Group label is never read.';

create function public.member_card(p_member_id uuid)
returns table (
  member_id           uuid,
  nickname            text,
  full_name           text,
  role                public.member_role,
  joined_at           date,
  avatar_color        text,
  primary_group_id    bigint,
  primary_group_name  text,
  primary_group_color text,
  other_memberships   int,
  memberships         jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.member_card_impl(p_member_id);
$$;

comment on function public.member_card(uuid) is
  'Member Card (R6): a colleague''s Nickname, full name, Role, join date, avatar colour, first top-level Group chip, "+n" count and explicit Group memberships, for any active Member. Contact details stay behind profiles_contact; points and rank never appear.';

revoke execute on function private.member_card_impl(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.member_card(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.member_card_impl(uuid) to authenticated;
grant execute on function public.member_card(uuid) to authenticated;
