-- #724: ruling R8's 1000-character limit on the Application notes, the Role/Status change reason and events.cancel_reason.
--
-- The constraints kit (#673) left three free-text surfaces out. This adds the
-- step-1 checks through private.require_text_length -- PT400 note_too_long on
-- apply_to_group and decide_group_application, PT400 reason_too_long on
-- set_member_role and set_member_status -- each measuring the value exactly as
-- the command stores it (trimmed), ahead of every authority verdict because a
-- 1001-character note is malformed for every caller (conventions sections 2-3).
--
-- Every body is rebuilt from main's latest definition, and the check is the
-- only delta:
--   set_member_role_impl / set_member_status_impl  from #612 (20260923220611_member_change_reason.sql)
--   apply_to_group_impl                            from #675 (20260923223833_nickname_member_card.sql)
--   decide_group_application_impl                  from #584 (20260922224243_group_applications.sql)
-- `create or replace` with unchanged signatures keeps every grant and comment.
--
-- events_cancel_reason_length_ck follows #673's two-migration shape: added
-- NOT VALID here with a notice counting the rows already breaking it, then
-- validated by 20260924061034_note_reason_limits_validate.sql. cancel_event
-- already refuses a long reason (#673); the constraint makes the rule total
-- for the other writer, archive_group's cancel_event_effect, and for direct
-- writes.

create or replace function private.set_member_role_impl(
  p_member_id uuid,
  p_role public.member_role,
  p_reason text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid;
  v_actor_role  public.member_role;
  v_from        public.member_role;
  v_role_name   text;
  v_new_level   integer;
  v_groups_left text[];
  v_member      public.profiles%rowtype;
begin
  -- 1. Malformed for every caller, so it is answered ahead of any authority
  --    verdict (conventions section 2). `responsabil` is a *source* rank only:
  --    ADR-0009 replaces the project-Responsible rank with a Group Role, so a
  --    holder may be re-ranked away from it and nobody may be moved onto it.
  if p_role is null or p_role = 'responsabil' then
    raise sqlstate 'PT400' using message = 'invalid_member_role';
  end if;

  -- #724 (ruling R8). Measured exactly as it is stored -- trimmed -- and
  -- malformed for every caller, so it is answered before any authority
  -- verdict; a blank reason still falls back to the fixed string below.
  perform private.require_text_length('reason',
    regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 1000);

  -- 2. Authority. One reason string for every denial -- a caller must not be
  --    able to tell "you are not BC" from "you may not touch that Member" from
  --    "you cannot re-rank yourself" (conventions section 3).
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end;
  if private.actor_level(v_actor) < 6 or v_actor = p_member_id then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  -- 3. Target under lock, then the actor's own row re-read `for share`.
  select * into v_member
    from public.profiles
   where id = p_member_id
   for update;
  if not found then
    raise sqlstate 'PT404' using message = 'member_not_found';
  end if;

  select actor.role into v_actor_role
    from public.profiles as actor
   where actor.id = v_actor
     and actor.status = 'activ'
   for share;
  if not found then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  v_from := v_member.role;

  -- 4. Appointing or unseating leadership is the Moderator's alone. BC holds
  --    every other rank decision. Authority is answered before state, so a BC
  --    reaching for `bc` gets 42501 whether or not the target already holds it.
  if (v_from in ('bc', 'moderator') or p_role in ('bc', 'moderator'))
     and v_actor_role <> 'moderator' then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  if v_from = p_role then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  select role.name, role.level into strict v_role_name, v_new_level
    from public.roles as role
   where role.id = p_role;

  update public.profiles
     set role = p_role
   where id = p_member_id
  returning * into v_member;

  insert into public.role_history (
    member_id, from_role, to_role, changed_by, actor_kind, reason
  ) values (
    p_member_id, v_from, p_role, v_actor, 'human',
    coalesce(nullif(regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
      'Role changed by leadership (set_member_role)')
  );

  -- 5. The one case where a Role change edits rosters. A Group states the rank
  --    its members must hold; once the target falls below it they are not a
  --    member of that Group any more, whatever position they held there, so
  --    the row goes -- ordinary membership and Group Role alike. Only Groups
  --    whose *own* Minimum Level is above the new rank are touched: an
  --    ancestor with a lower Minimum keeps its row, and the authority it
  --    carries still flows down through `groups.path`. This is what makes
  --    T13's invariant (#586, "no roster row below its Group's Minimum
  --    Level") hold from the Role side.
  --
  --    The rows are locked `for update` before anything is decided about
  --    them. `for update of membership` locks `group_members` only: a
  --    `groups` row is read here, never locked, because a share lock on one
  --    would ABBA against any Group command holding it `for update` (the
  --    cross-cutting lock rule). Ordering by `group_id` keeps two concurrent
  --    demotions of different Members over the same Groups in one sequence.
  perform 1
     from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where membership.member_id = p_member_id
      and grp.min_level > v_new_level
    order by membership.group_id
      for update of membership;

  with removed as (
    delete from public.group_members as membership
     using public.groups as grp
     where grp.id = membership.group_id
       and membership.member_id = p_member_id
       and grp.min_level > v_new_level
    returning grp.name as group_name
  )
  select array_agg(distinct group_name order by group_name)
    into v_groups_left
    from removed;

  -- #584 (ruling R30). The Application half of the same rule: a request to
  -- join a Group the target can no longer qualify for is settled here rather
  -- than left for a Manager to be told group_member_below_min_level about.
  -- The rows are locked in id order before anything is decided about them.
  perform 1
     from public.group_applications as application
     join public.groups as grp on grp.id = application.group_id
    where application.member_id = p_member_id
      and application.status = 'pending'
      and grp.min_level > v_new_level
    order by application.id
      for update of application;

  update public.group_applications as application
     set status     = 'withdrawn',
         decided_by = v_actor,
         decided_at = clock_timestamp()
    from public.groups as grp
   where grp.id = application.group_id
     and application.member_id = p_member_id
     and application.status = 'pending'
     and grp.min_level > v_new_level;

  perform private.notify(
    array[p_member_id],
    'system'::public.noti_kind,
    'Rol actualizat',
    case
      when p_role = 'vot' then
        'Rolul tău în OSUBB este acum Voluntar cu Drept de Vot. Ești membru al Adunării Generale.'
      else
        'Rolul tău în OSUBB este acum ' || v_role_name || '.'
    end
    -- A Member who lost Groups to the Minimum Level learns which ones from the
    -- same Notification: the removal is a consequence of the rank decision, not
    -- a separate event, and nothing else will tell them.
    || case
         when v_groups_left is null then ''
         else ' Nu mai faci parte din: '
              || array_to_string(v_groups_left, ', ') || '.'
       end,
    null,
    null,
    v_actor
  );

  return v_member;
end;
$$;


create or replace function private.set_member_status_impl(
  p_member_id uuid,
  p_status public.member_status,
  p_reason text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid;
  v_actor_role public.member_role;
  v_from       public.member_status;
  v_member     public.profiles%rowtype;
begin
  if p_status is null then
    raise sqlstate 'PT400' using message = 'invalid_member_status';
  end if;

  -- #724 (ruling R8). Measured exactly as it is stored -- trimmed -- and
  -- malformed for every caller, so it is answered before any authority
  -- verdict; a blank reason still falls back to the fixed string below.
  perform private.require_text_length('reason',
    regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 1000);

  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end;
  if private.actor_level(v_actor) < 6 or v_actor = p_member_id then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  select * into v_member
    from public.profiles
   where id = p_member_id
   for update;
  if not found then
    raise sqlstate 'PT404' using message = 'member_not_found';
  end if;

  select actor.role into v_actor_role
    from public.profiles as actor
   where actor.id = v_actor
     and actor.status = 'activ'
   for share;
  if not found then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  v_from := v_member.status;

  -- The Moderator-only rule from `set_member_role` reaches Status too, and has
  -- to. `private.actor_level` returns null for anyone not `activ`, so setting a
  -- BC or the Moderator to `inactiv`/`alumni` removes their authority exactly
  -- as thoroughly as re-ranking them would -- and reactivating them restores
  -- it. Leaving this open would let one BC neutralize every other BC and the
  -- Moderator with a command the Moderator-only rank branch was written to
  -- prevent.
  if v_member.role in ('bc', 'moderator') and v_actor_role <> 'moderator' then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  if v_from = p_status then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  update public.profiles
     set status = p_status
   where id = p_member_id
  returning * into v_member;

  insert into public.role_history (
    member_id, from_role, to_role, from_status, to_status,
    changed_by, actor_kind, reason
  ) values (
    p_member_id, v_member.role, v_member.role, v_from, p_status,
    v_actor, 'human',
    coalesce(nullif(regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
      'Status changed by leadership (set_member_status)')
  );

  -- #603. The condition is on the *destination* Status, not on the direction
  -- of travel: every non-`activ` Status ends the Member's access to the
  -- organization, so `inactiv` and `alumni` both revoke. A change *to* `activ`
  -- -- a reactivation, or any future path that lands there -- revokes nothing:
  -- there is no security reason to sign a returning Member out of a session
  -- they are once again entitled to hold.
  if p_status <> 'activ' then
    perform private.revoke_member_sessions(p_member_id);
  end if;

  return v_member;
end;
$$;


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


create or replace function private.decide_group_application_impl(
  p_application_id bigint,
  p_accept         boolean,
  p_note           text default null
)
returns public.group_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid;
  v_group_id bigint;
  v_group    public.groups%rowtype;
  v_row      public.group_applications%rowtype;
  v_note     text := nullif(btrim(p_note), '');
begin
  -- 1. Malformed for every caller, so it is answered ahead of any authority
  --    verdict (conventions section 2). There is no third answer to an
  --    Application: a caller that sends null has not decided anything.
  if p_accept is null then
    raise sqlstate 'PT400' using message = 'invalid_application_decision';
  end if;
  if p_note is not null and v_note is null then
    raise sqlstate 'PT400' using message = 'invalid_decision_note';
  end if;
  -- #724 (ruling R8): the decision note, measured as it is stored (trimmed).
  perform private.require_text_length('note', v_note, null, 1000);

  -- 2. Which Group's authority decides. Read unlocked first, because the gate
  --    must run before any lock on public.groups (#583's shape 6) and the gate
  --    needs the Group id; the row itself is re-read under its own lock at
  --    step 4, where the status that matters is the one under the lock.
  select application.group_id into v_group_id
    from public.group_applications as application
   where application.id = p_application_id;
  if not found then
    raise sqlstate 'PT404' using message = 'application_not_found';
  end if;

  -- Accepting an Application is a Group Responsible's power as much as a
  -- Group Manager's (ADR-0009 Entry paths), exactly like add_group_member —
  -- so this is the work tier, not #582's Manager tier.
  v_actor := private.require_group_work_manager(v_group_id);

  -- 3. Gate -> groups FOR NO KEY UPDATE -> the Application row FOR UPDATE, the
  --    same order every Group command takes.
  select grp.* into v_group
    from public.groups as grp
   where grp.id = v_group_id
   for no key update;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;

  select application.* into v_row
    from public.group_applications as application
   where application.id = p_application_id
   for update of application;
  if not found then
    raise sqlstate 'PT404' using message = 'application_not_found';
  end if;
  if v_row.status <> 'pending' then
    raise sqlstate 'PT409' using message = 'application_not_pending';
  end if;

  -- 4. An accept is an Appointment and goes through the one insert path
  --    (shape 4): the applicant's live rank is judged against the Group's
  --    live Minimum Level there, so an Application filed before a demotion or
  --    a Minimum-Level raise answers PT400 group_member_below_min_level
  --    rather than placing a Member the Group no longer admits. The same call
  --    answers group_member_not_eligible for an applicant deactivated while
  --    pending, already_group_member if they were appointed in the meantime,
  --    and writes the new Member's own Notification.
  if p_accept then
    perform private.appoint_group_member(v_row.group_id, v_row.member_id, v_actor);
  end if;

  update public.group_applications as application
     set status        = case when p_accept then 'accepted' else 'declined' end,
         decided_by    = v_actor,
         decided_at    = clock_timestamp(),
         decision_note = v_note
   where application.id = p_application_id
  returning * into v_row;

  -- 5. The applicant hears the answer. The link is the MEMBER-facing Group
  --    page (#589, ruling R8), not Administrare: an applicant has no reason
  --    and usually no right to open /administrare/grupuri/<id>. The dedupe
  --    key is the same 'application:<id>' the filing used, which collides with
  --    nothing — the filing went to the deciders, never to the applicant.
  perform private.notify(
    array[v_row.member_id], 'system'::public.noti_kind,
    case when p_accept then 'Cerere acceptată: ' || v_group.name
                       else 'Cerere respinsă: ' || v_group.name end,
    case when p_accept then 'Cererea ta de înscriere în grupul ' || v_group.name
                              || ' a fost acceptată.'
                       else 'Cererea ta de înscriere în grupul ' || v_group.name
                              || ' a fost respinsă.' end
      || case when v_note is null then '' else ' „' || v_note || '”' end,
    null, 'application:' || v_row.id::text, v_actor,
    '/grupuri/' || v_row.group_id::text);

  return v_row;
end;
$$;

alter table public.events
  add constraint events_cancel_reason_length_ck
  check (cancel_reason is null or char_length(cancel_reason) <= 1000) not valid;
do $$
declare v_bad bigint;
begin
  select count(*) into v_bad from public.events
   where not (cancel_reason is null or char_length(cancel_reason) <= 1000);
  if v_bad > 0 then raise notice 'events_cancel_reason_length_ck: % existing row(s) violate the new rule', v_bad; end if;
end $$;
