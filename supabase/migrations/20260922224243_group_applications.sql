-- #584: Applications — the second Entry path into a Group (ADR-0009 Wave 3,
-- T11, ruling R5): public.group_applications plus apply_to_group,
-- withdraw_group_application and decide_group_application.
--
-- #583 shipped Appointment: a Group Manager or Responsible places a Member.
-- This file ships the other direction — a Member at or above a Group's
-- Application Level asks to join a Group that accepts Applications, and a
-- Group Manager or Responsible accepts or declines. Nothing else joins a
-- Group: an accepted Application does not insert a roster row of its own, it
-- calls private.appoint_group_member, the one insert path (rulings R6/R27),
-- so an Application can never place a Member the Appointment rules would have
-- refused.
--
-- Five shapes are worth stating once, here.
--
-- 1. WHO MAY APPLY IS TWO SEPARATE QUESTIONS, ANSWERED IN THIS ORDER.
--    Visibility first: a Group the caller cannot see is PT404
--    group_not_found, exactly as an unknown id is — hidden is never
--    distinguishable from missing (conventions section 3). Only then the
--    Application Level, which is a real refusal the caller can act on:
--    42501 group_apply_forbidden. Between them sit the state conflicts a
--    caller can also act on — the Group takes no Applications, they are
--    already a member, they already have one pending.
--
-- 2. THE APPLICATION LEVEL IS NOT THE MINIMUM LEVEL. A Department sets
--    Minimum 0 and Application 1 (ADR-0009 Entry paths), so a Recrut is
--    PLACED into a Department by Appointment but only a Voluntar APPLIES to
--    one. groups_application_level_ck already holds application_level >=
--    min_level, so passing the Application Level implies passing the Minimum
--    Level at the moment of applying — and not one moment later, which is
--    what shape 4 is about.
--
-- 3. THE RECIPIENTS OF A FILED APPLICATION ARE ONE FUNCTION.
--    private.group_application_recipients is private.group_managers(group_id)
--    — the Group's own live Managers, else the nearest ancestor's, else the
--    chain's Responsibles plus BC/Moderator — union every live Group
--    Responsible on the Group's path, because accepting an Application is
--    explicitly a Responsible's power (ADR-0009) and a Responsible who may
--    decide must hear that there is something to decide. Both the filing and
--    the decision resolve through it; neither carries an inline copy.
--
-- 4. A DECISION IS JUDGED WHEN IT IS MADE, NOT WHEN IT WAS FILED. An
--    Application can sit pending across a demotion or a Minimum-Level raise.
--    Accepting one runs the whole Appointment core again, so the Member's
--    live rank is checked against the Group's live Minimum Level and a fallen
--    Level answers PT400 group_member_below_min_level. Nothing is
--    grandfathered by having applied earlier.
--
-- 5. AN APPLICANT MUST BE ABLE TO SEE WHAT THEY APPLIED TO (ruling R17).
--    groups_read gains a pending-Application limb, so an applicant whose
--    Group's Minimum Level rises while their Application is pending still
--    reads the Group's name — and stops the moment the Application leaves
--    'pending'. A Member below the Minimum Level with NO Application still
--    sees nothing: the limb is about a live request, not about rank.
--
-- Ruling R30 is also discharged here. Three commands that shipped before this
-- table existed carry a `comment on function` line saying their Application
-- clause is owed to #584: private.set_member_role_impl (#580, a demotion
-- withdraws the target's pending Applications), private.update_group_impl and
-- private.update_group_structure_impl (#582, a raised Minimum Level withdraws
-- the removed Members' pending Applications), and private.archive_group_impl
-- (#582, archiving declines the subtree's pending Applications with the
-- archiver as the decider). Section 8 re-issues all four bodies from main's
-- latest definition with the clause added and the owed line removed.
--
-- Every row that leaves 'pending' writes BOTH decided_by and decided_at, which
-- is what group_applications_decision_ck demands: the deciding Manager for an
-- accept or a decline, the archiver for an archive-decline, and the applicant
-- themselves for a self-withdrawal — they decided it. No row is ever left
-- half-decided (ruling R30).

-- ==================== 1 · the table ====================

create table public.group_applications (
  id            bigint generated always as identity primary key,
  group_id      bigint not null references public.groups (id) on delete cascade,
  member_id     uuid   not null references public.profiles (id) on delete cascade,
  -- The applicant's own note, optional but never blank when present. The
  -- decider's note is a separate column: an archive-decline records "Grup
  -- arhivat" (ruling R21) and overwriting the applicant's words with it would
  -- destroy the only thing they wrote.
  note          text
                constraint group_applications_note_ck check (
                  note is null or note ~ '[^[:space:]]'),
  status        text not null default 'pending'
                constraint group_applications_status_ck check (
                  status in ('pending', 'accepted', 'declined', 'withdrawn')),
  decided_by    uuid references public.profiles (id),
  decided_at    timestamptz,
  decision_note text
                constraint group_applications_decision_note_ck check (
                  decision_note is null or decision_note ~ '[^[:space:]]'),
  created_at    timestamptz not null default now(),

  -- Decided if and only if both halves of the trace are there (ruling R30). A
  -- pending row carries no decider, no moment and no decision note; a row in
  -- any other status carries the first two. The decision note stays optional:
  -- a plain accept needs no words.
  constraint group_applications_decision_ck check (
    case when status = 'pending'
         then decided_by is null and decided_at is null and decision_note is null
         else decided_by is not null and decided_at is not null
    end),

  constraint group_applications_decided_chronology_ck check (
    decided_at is null or decided_at >= created_at)
);

-- One pending Application per (Group, Member) — and only pending ones, so a
-- declined Application can be filed again as ADR-0009 intends. This is the
-- constraint apply_to_group's pre-check explains and its exception arm catches.
create unique index group_applications_pending_uidx
  on public.group_applications (group_id, member_id)
  where status = 'pending';

-- The two reads the Applications UI (#589) makes: a Member's own Applications
-- and one Group's queue of them.
create index group_applications_member_idx
  on public.group_applications (member_id);
create index group_applications_group_status_idx
  on public.group_applications (group_id, status);

alter table public.group_applications enable row level security;

-- Own rows, or the Groups whose work the caller manages — the same predicate
-- that decides who may accept. The live-status test is written here rather
-- than left to auth_is_member(), on completed_work_requests_read's precedent:
-- a deactivated applicant keeps their auth.uid() and an unexpired token
-- (house rule 12), and must stop reading immediately rather than once
-- can_manage_group_work happens to say no.
create policy group_applications_read
  on public.group_applications
  for select
  to authenticated
  using (
    public.auth_is_member()
    and exists (
      select 1
        from public.profiles as caller
       where caller.id = (select auth.uid())
         and caller.status = 'activ'
    )
    and (
      member_id = (select auth.uid())
      or private.can_manage_group_work(group_id)
    )
  );

comment on policy group_applications_read on public.group_applications is
  'An applicant (live status = activ, checked here so a deactivated applicant''s unexpired token stops reading immediately) reads their own Applications; anyone who may manage the Group''s work — its Group Managers and Group Responsibles, those of every ancestor, and BC/Moderator — reads the Group''s queue. Reading is exactly as wide as deciding here, unlike Completed-work Requests: private.require_group_work_manager is the same predicate decide_group_application gates on.';

-- 20260819171628_capabilities_and_rls.sql's default privileges hand every new
-- public table INSERT/UPDATE/DELETE to authenticated, so the no-client-writes
-- rule is an explicit revoke, not an omission (conventions section 2).
revoke all on table public.group_applications
  from public, anon, authenticated, service_role;
grant select on table public.group_applications to authenticated, service_role;

comment on table public.group_applications is
  'A Member''s request to join a Group that accepts Applications (ADR-0009 Entry paths, ruling R5). At most one pending row per (Group, Member) — group_applications_pending_uidx — and a declined or withdrawn row never blocks a new attempt, so a Member may apply again after a decline. Written only by public.apply_to_group, public.withdraw_group_application and public.decide_group_application, plus the three commands that settle Applications as a consequence of something else: a demotion below a Group''s Minimum Level (private.set_member_role_impl), a raised Minimum Level (private.update_group_impl / private.update_group_structure_impl) and archiving (private.archive_group_impl). No client write path.';

comment on column public.group_applications.note is
  'The applicant''s own optional note, never blank when present. Never overwritten by a decision — the decider writes decision_note.';
comment on column public.group_applications.status is
  'pending (default), accepted, declined or withdrawn. Every status but pending carries decided_by and decided_at (group_applications_decision_ck, ruling R30): the deciding Manager for an accept or decline, the archiver for an archive-decline, the applicant themselves for a self-withdrawal.';
comment on column public.group_applications.decided_by is
  'Who settled this Application. Null while pending. For a withdrawal this is the applicant: they decided it, and the row is never left half-decided.';
comment on column public.group_applications.decided_at is
  'When the Application was settled. Null while pending; required and >= created_at once settled.';
comment on column public.group_applications.decision_note is
  'The decider''s optional note, never blank when present. An archive-decline records "Grup arhivat" (ruling R21).';

-- ==================== 2 · the recipient set (shape 3) ====================

create function private.group_application_recipients(p_application_id bigint)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- private.group_managers already falls back — the Group's own live
  -- Managers, else the nearest ancestor's, else the chain's Responsibles plus
  -- every live BC/Moderator — so this union only ADDS the Responsibles that
  -- fallback skips when a Manager does exist. union, not union all: a
  -- Responsible of an ancestor that also has the Managers is one recipient.
  select manager
    from public.group_applications as application
    cross join lateral private.group_managers(application.group_id) as manager
   where application.id = p_application_id
  union
  select gm.member_id
    from public.group_applications as application
    join public.groups as target on target.id = application.group_id
    join public.group_members as gm on target.path @> array[gm.group_id]
    join public.profiles as peer on peer.id = gm.member_id and peer.status = 'activ'
   where application.id = p_application_id
     and gm.group_role = 'responsible';
$$;

comment on function private.group_application_recipients(bigint) is
  'Who hears that an Application was filed (#584, shape 3): private.group_managers of the Application''s Group — its own live Group Managers, else the nearest ancestor''s, else the path''s Group Responsibles plus every live BC/Moderator — union every live Group Responsible on that Group''s path, because accepting an Application is a Group Responsible''s power (ADR-0009 Entry paths) and whoever may decide must hear there is something to decide. One definition for both the filing fan-out and any later reader; no command carries an inline copy. Executable by no client role.';

-- ==================== 3 · the groups_read pending-Application limb (R17) ====================

-- A definer predicate rather than an inline `exists` in the policy, for the
-- same reason private.can_read_group_roster is one: a policy expression that
-- reads another RLS-protected table is evaluated under THAT table's policy
-- too, so the rule would depend on group_applications_read staying shaped the
-- way it is today. This runs outside RLS and answers one question.
create function private.has_pending_group_application(p_group_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.group_applications as application
     where application.group_id = p_group_id
       and application.member_id = (select auth.uid())
       and application.status = 'pending');
$$;

comment on function private.has_pending_group_application(bigint) is
  'Whether the caller has a pending Application on this Group (#584, ruling R17). The groups_read limb that lets an applicant keep seeing the Group they applied to when its Minimum Level rises underneath them — and stops the moment the Application is accepted, declined or withdrawn. Runs outside RLS so the policy does not depend on group_applications_read''s own shape.';

drop policy groups_read on public.groups;

create policy groups_read on public.groups
  for select to authenticated
  using (
    public.auth_is_member()
    and (
      (status = 'active' and (select private.caller_level()) >= min_level)
      or (select private.caller_level()) >= 5
      -- Authority flows down the chain (ADR-0009 Group Roles), so it overrides
      -- the Minimum Level gate for the Group row itself. Without this branch
      -- the two policies would disagree about one authority: a level-1 Group
      -- Manager of a Department could read its level-3 Child Group's roster
      -- through group_members_read while the Group row naming it stayed hidden,
      -- and every roster join would drop the rows it had just been allowed.
      or private.can_read_group_roster(id)
      -- #584, ruling R17: a live Application is a live relationship with this
      -- Group. Without this limb an applicant would stop being able to read
      -- the name of the Group they are waiting on the moment its Minimum
      -- Level was raised above them — while their Application still sat in a
      -- Manager's queue. A Member below the Minimum Level with no Application
      -- is unaffected: this limb asks about a request, never about rank.
      or private.has_pending_group_application(id)
    )
  );

comment on policy groups_read on public.groups is
  'An active Member reads an active Group at or above their live level; a Group Manager or Responsible of the Group or of any ancestor reads it whatever their rank; rank BCE and above read every Group, archived ones included; and an applicant reads a Group while their own Application on it is pending (#584, ruling R17), whatever their rank, so a Minimum-Level raise cannot hide the Group they are waiting on.';

-- ==================== 4 · apply_to_group ====================

create function private.apply_to_group_impl(
  p_group_id bigint,
  p_note     text default null
)
returns public.group_applications
language plpgsql
security definer
set search_path = ''
as $$
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
    (select profile.full_name from public.profiles as profile where profile.id = v_actor)
      || ' vrea să intre în grupul ' || v_group.name || '.'
      || case when v_note is null then '' else ' „' || v_note || '”' end,
    null, 'application:' || v_row.id::text, v_actor,
    '/administrare/grupuri/' || p_group_id::text);

  return v_row;
end;
$$;

-- ==================== 5 · withdraw_group_application ====================

create function private.withdraw_group_application_impl(p_application_id bigint)
returns public.group_applications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_row   public.group_applications%rowtype;
begin
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'application_withdraw_forbidden';
  end;

  perform 1 from public.profiles as applicant
    where applicant.id = v_actor and applicant.status = 'activ'
    for share of applicant;
  if not found then
    raise exception using errcode = '42501', message = 'application_withdraw_forbidden';
  end if;

  select application.* into v_row
    from public.group_applications as application
   where application.id = p_application_id
   for update of application;

  -- PT404 covers "not there" and "not visible" alike (conventions section 3),
  -- so an id belonging to a Group the caller has nothing to do with is
  -- indistinguishable from an id that was never issued. Only a caller who can
  -- READ the row is told it exists and then refused: that is a Group Manager
  -- or Responsible looking at their own queue, who must use
  -- decide_group_application instead of quietly retracting someone's request.
  if not found
     or not (v_row.member_id = v_actor
             or coalesce(private.can_manage_group_work(v_row.group_id), false)) then
    raise sqlstate 'PT404' using message = 'application_not_found';
  end if;
  if v_row.member_id <> v_actor then
    raise exception using errcode = '42501', message = 'application_withdraw_forbidden';
  end if;
  if v_row.status <> 'pending' then
    raise sqlstate 'PT409' using message = 'application_not_pending';
  end if;

  -- The applicant is the decider of their own withdrawal (ruling R30): both
  -- halves of the trace are written, so no row is ever left half-decided.
  update public.group_applications as application
     set status     = 'withdrawn',
         decided_by = v_actor,
         decided_at = clock_timestamp()
   where application.id = p_application_id
  returning * into v_row;

  -- No Notification: the only party to this decision is the actor, and
  -- private.notify drops the actor from every recipient array (ruling R25).
  return v_row;
end;
$$;

-- ==================== 6 · decide_group_application ====================

create function private.decide_group_application_impl(
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

-- ==================== 7 · wrappers ====================

create function public.apply_to_group(p_group_id bigint, p_note text default null)
returns public.group_applications
language sql
security invoker
set search_path = ''
as $$
  select private.apply_to_group_impl(p_group_id, p_note);
$$;

create function public.withdraw_group_application(p_application_id bigint)
returns public.group_applications
language sql
security invoker
set search_path = ''
as $$
  select private.withdraw_group_application_impl(p_application_id);
$$;

create function public.decide_group_application(
  p_application_id bigint,
  p_accept         boolean,
  p_note           text default null
)
returns public.group_applications
language sql
security invoker
set search_path = ''
as $$
  select private.decide_group_application_impl(p_application_id, p_accept, p_note);
$$;

-- ==================== 8 · ruling R30: the four bodies that owed this table a clause ====================
-- Each body below is main's latest definition with one clause added and the
-- "not yet done here" sentence removed from its comment. Nothing else moved.

-- 8a. #580: a demotion below a Group's Minimum Level already deletes the
--     target's roster rows on that Group. It now also withdraws their pending
--     Applications to every Group whose Minimum Level is above their new rank
--     — including Groups they were never a member of, because an Application
--     that could now only be answered group_member_below_min_level is dead
--     the moment the rank falls, and leaving it pending would keep the Group
--     visible to them through ruling R17's limb forever. The actor is the
--     decider: they caused it.
create or replace function private.set_member_role_impl(
  p_member_id uuid,
  p_role public.member_role
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
  if p_role is null or p_role = 'responsabil' then
    raise sqlstate 'PT400' using message = 'invalid_member_role';
  end if;

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

  v_from := v_member.role;

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
    'Role changed by leadership (set_member_role)'
  );

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

-- 8b/8c. #582: both update commands already delete the roster rows a raised
--        Minimum Level leaves behind. They now also withdraw those Members'
--        pending Applications on the same Group — a Member removed from a
--        Group in the same breath as their request to join it would otherwise
--        keep an Application that can only ever be refused.
create or replace function private.update_group_impl(
  p_group_id               bigint,
  p_name                   text,
  p_manager_title          text,
  p_accepts_applications   boolean,
  p_application_level      integer,
  p_shared_work_visibility boolean,
  p_min_level              integer,
  p_confirm_removals       boolean default false
)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function private.update_group_structure_impl(
  p_group_id                 bigint,
  p_category                 text,
  p_competes_in_cup          boolean,
  p_counts_toward_parent_cup boolean,
  p_automatic_membership     boolean,
  p_min_level                integer,
  p_color                    text,
  p_short                    text,
  p_is_organization          boolean,
  p_confirm_removals         boolean default false
)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid;
  v_actor_level integer;
  v_group       public.groups%rowtype;
  v_parent      public.groups%rowtype;
  v_competes    boolean := coalesce(p_competes_in_cup, false);
  v_counts      boolean := coalesce(p_counts_toward_parent_cup, true);
  v_automatic   boolean := coalesce(p_automatic_membership, false);
  v_is_org      boolean := coalesce(p_is_organization, false);
  v_short       text    := nullif(btrim(p_short), '');
  v_updated     public.groups%rowtype;
  v_below       uuid[];
  v_removed     uuid[];
  v_managers    uuid[];
begin
  if p_category is null
     or p_category not in ('department', 'project', 'team', 'organization') then
    raise sqlstate 'PT400' using message = 'invalid_group_category';
  end if;
  if p_min_level is null or p_min_level not in (0, 1, 2, 3, 5, 6, 9) then
    raise sqlstate 'PT400' using message = 'invalid_group_min_level';
  end if;
  if p_color is not null and p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise sqlstate 'PT400' using message = 'invalid_group_color';
  end if;

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
  v_actor_level := private.actor_level(v_actor);
  if coalesce(v_actor_level, -1) < 6 then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  if v_group.parent_id is not null
     and p_min_level is distinct from v_group.min_level then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;

  if v_competes and v_group.parent_id is not null then
    raise sqlstate 'PT409' using message = 'cup_not_top_level';
  end if;
  if v_is_org and exists (select 1 from public.groups as other
                           where other.is_organization and other.id <> p_group_id) then
    raise sqlstate 'PT409' using message = 'organization_group_exists';
  end if;
  if v_automatic and not v_group.automatic_membership
     and exists (select 1 from public.group_members as membership
                  where membership.group_id = p_group_id
                    and membership.group_role = 'member') then
    raise sqlstate 'PT409' using message = 'automatic_group_has_roster_members';
  end if;
  if v_automatic and v_group.accepts_applications then
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

  if (p_category, v_competes, v_counts, v_automatic, p_min_level, p_color, v_short, v_is_org)
     is not distinct from
     (v_group.category, v_group.competes_in_cup, v_group.counts_toward_parent_cup,
      v_group.automatic_membership, v_group.min_level, v_group.color,
      v_group.short, v_group.is_organization) then
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
     set category                 = p_category,
         competes_in_cup          = v_competes,
         counts_toward_parent_cup = v_counts,
         automatic_membership     = v_automatic,
         min_level                = p_min_level,
         color                    = p_color,
         short                    = v_short,
         is_organization          = v_is_org
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
$$;

-- 8d. #582: archiving settles what has no executor. Pending Applications on
--     the subtree are one of those things (ruling R21) — nobody is left who
--     could accept them — so they are DECLINED with the archiver as the
--     decider and "Grup arhivat" as the decision note, and every applicant is
--     told. The link is the member-facing Group page (ruling R8): an applicant
--     has no right to Administrare.
create or replace function private.archive_group_impl(p_group_id bigint)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid;
  v_group       public.groups%rowtype;
  v_updated     public.groups%rowtype;
  v_event_id    bigint;
  v_application record;
begin
  select * into v_group from public.groups where id = p_group_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

  if v_group.parent_id is null then
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
    v_actor := private.require_group_manager(p_group_id);
  end if;

  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_already_archived';
  end if;

  perform 1
     from public.groups as descendant
    where descendant.path @> array[p_group_id]
      and descendant.id <> p_group_id
    order by descendant.id
    for no key update;

  if exists (
    select 1
      from public.tasks as task
      join public.groups as owner on owner.id = task.group_id
     where owner.path @> array[p_group_id]
       and task.status not in ('completed', 'unfulfilled', 'cancelled')
  ) or exists (
    select 1
      from public.completed_work_requests as request
      join public.groups as owner on owner.id = request.group_id
     where owner.path @> array[p_group_id]
       and request.status = 'pending'
  ) then
    raise sqlstate 'PT409' using message = 'group_has_open_work';
  end if;

  for v_event_id in
    select event.id
      from public.events as event
      join public.groups as owner on owner.id = event.group_id
     where owner.path @> array[p_group_id]
       and event.cancelled_at is null
       and event.starts_at > now()
     order by event.id
     for no key update of event
  loop
    perform private.cancel_event_effect(v_event_id, 'Grup arhivat', v_actor);
  end loop;

  -- #584 (ruling R30 discharging ruling R21's Application half). The rows are
  -- locked in id order before anything is decided about them, the same
  -- discipline the Event loop above follows.
  perform 1
     from public.group_applications as application
     join public.groups as owner on owner.id = application.group_id
    where owner.path @> array[p_group_id]
      and application.status = 'pending'
    order by application.id
    for update of application;

  for v_application in
    update public.group_applications as application
       set status        = 'declined',
           decided_by    = v_actor,
           decided_at    = clock_timestamp(),
           decision_note = 'Grup arhivat'
      from public.groups as owner
     where owner.id = application.group_id
       and owner.path @> array[p_group_id]
       and application.status = 'pending'
    returning application.member_id, application.id as application_id,
              application.group_id, owner.name as group_name
  loop
    perform private.notify(
      array[v_application.member_id], 'system'::public.noti_kind,
      'Cerere respinsă: ' || v_application.group_name,
      'Grupul ' || v_application.group_name
        || ' a fost arhivat, așa că cererea ta de înscriere a fost respinsă.',
      null, 'application:' || v_application.application_id::text, v_actor,
      '/grupuri/' || v_application.group_id::text);
  end loop;

  update public.groups
     set status = 'archived'
   where path @> array[p_group_id];

  select * into v_updated from public.groups where id = p_group_id;
  return v_updated;
end;
$$;

-- ==================== 9 · comments ====================

comment on function public.apply_to_group(bigint, text) is
  'A Member asks to join a Group (#584, ADR-0009 Entry paths: Application). Requires a live active Member: a claimless session, an unknown Profile and a deactivated Member are one 42501 group_apply_forbidden. Then, in order: PT404 group_not_found for a Group that does not exist OR that the caller cannot see — an active Group at or above their live Level, any Group at rank BCE and above, a Group they hold a position on or of which an ancestor gives them one, or one they already have a pending Application to (ruling R17) — because hidden is never distinguishable from missing; PT409 group_not_accepting_applications, which also answers an archived Group whatever its settings say; PT409 already_group_member (membership of THIS Group only, an explicit roster row of any Group Role or Automatic Membership at or above the Minimum Level, so a Department member may still apply to its Child Team); PT409 application_pending, at most one pending Application per (Group, Member), enforced by group_applications_pending_uidx and re-raised from its unique violation; and last 42501 group_apply_forbidden below the Group''s Application Level — the Application Level is NOT the Minimum Level (a Department sets Minimum 0 and Application 1, so a Recrut is PLACED by Appointment but only a Voluntar APPLIES). A declined or withdrawn Application never blocks a new one. The optional note is trimmed and a blank one becomes none. Holds the Group FOR NO KEY UPDATE and the applicant''s own profiles row FOR SHARE, so a concurrent Minimum-Level raise or demotion serializes behind the decision. Writes one system Notification to private.group_application_recipients — the Group''s Managers union the path''s live Group Responsibles — under dedupe key application:<id> with link /administrare/grupuri/<group_id>, because the Cereri tab lives in Administrare.';

comment on function public.withdraw_group_application(bigint) is
  'The applicant retracts their own pending Application (#584). PT404 application_not_found for an unknown id AND for one the caller cannot read — an Application belonging to a Group they have nothing to do with is indistinguishable from an id that was never issued. 42501 application_withdraw_forbidden is reached only by a caller who CAN read the row and is not its applicant: a Group Manager or Responsible looking at their own queue, who must decline it with decide_group_application rather than quietly retract someone''s request. PT409 application_not_pending once it has been accepted, declined or already withdrawn. The withdrawal writes BOTH decided_by (the applicant themselves — they decided it) and decided_at, as group_applications_decision_ck requires and ruling R30 states: no row is ever left half-decided. It writes no Notification, because the only party to the decision is the actor and private.notify drops the actor from every recipient array (ruling R25). After a withdrawal the applicant stops seeing the Group through ruling R17''s groups_read limb, exactly as they stop seeing it after a decline.';

comment on function public.decide_group_application(bigint, boolean, text) is
  'A Group Manager or Group Responsible accepts or declines a pending Application (#584, ADR-0009 Entry paths). Gated by private.require_group_work_manager — the work tier, not #582''s Manager tier, because accepting an Application is explicitly a Group Responsible''s power, exactly like add_group_member — so every authority refusal is the one non-disclosing 42501 group_manage_forbidden. PT400 invalid_application_decision for a null verdict and invalid_decision_note for a blank one; PT404 application_not_found; PT409 group_archived and application_not_pending. AN ACCEPT IS AN APPOINTMENT: it goes through private.appoint_group_member, the one insert path into public.group_members, so the applicant''s LIVE rank is judged against the Group''s LIVE Minimum Level and an Application filed before a demotion or a Minimum-Level raise answers PT400 group_member_below_min_level rather than placing a Member the Group no longer admits — nothing is grandfathered by having applied earlier. That same call answers PT400 group_member_not_eligible for an applicant deactivated while pending and PT409 already_group_member if they were appointed in the meantime, and it writes the new Member''s own Appointment Notification. The decision itself writes decided_by, decided_at and the optional trimmed decision_note, and one system Notification to the APPLICANT under the same dedupe key application:<id> the filing used — with link /grupuri/<group_id>, the member-facing Group page (ruling R8), not Administrare: an applicant has no reason and usually no right to open a Group''s management screen.';

comment on function private.apply_to_group_impl(bigint, text) is
  'Body behind public.apply_to_group (#584): the actor, the Group under FOR NO KEY UPDATE, the visibility test that mirrors groups_read limb for limb against LIVE rank rather than the claim, the three state conflicts, the Application Level, the insert with its unique-violation arm, and the fan-out through private.group_application_recipients. The Application Level is answered LAST because it is the only refusal that tells the caller something about themselves; everything before it is about the Group, and an invisible Group is answered PT404 before any of it.';
comment on function private.withdraw_group_application_impl(bigint) is
  'Body behind public.withdraw_group_application (#584): the actor, the row under FOR UPDATE, the PT404-then-42501 split that keeps an unreadable Application indistinguishable from a missing one, and the withdrawal that records the applicant as its own decider (ruling R30).';
comment on function private.decide_group_application_impl(bigint, boolean, text) is
  'Body behind public.decide_group_application (#584): argument validation, the unlocked Group-id read that the gate needs, private.require_group_work_manager, then the gate -> groups FOR NO KEY UPDATE -> Application FOR UPDATE order every Group command takes, the Appointment on accept, and the applicant''s Notification.';

comment on function private.set_member_role_impl(uuid, public.member_role) is
  'Body behind public.set_member_role (#580): authority, the audited rank change, and ruling R23''s Minimum-Level consequences. When the new rank falls below a Group''s min_level the target''s rows on that Group are deleted — ordinary membership and Group Role alike — and, since #584 (ruling R30), their pending Applications to every Group whose Minimum Level now exceeds their rank are withdrawn with the actor as decider: such an Application could only ever be answered group_member_below_min_level, and leaving it pending would keep the Group visible to them through ruling R17''s groups_read limb indefinitely. An ancestor Group with a lower Minimum Level keeps its row and its authority still flows down through groups.path. It leaves Group Roles alone everywhere else (ruling R15): a promotion to BCE does not appoint a Department Group Manager and a demotion from it does not remove one.';

comment on function private.update_group_impl(bigint, text, text, boolean, integer, boolean, integer, boolean) is
  'Body behind public.update_group (#582): the operational settings, the top-level Minimum-Level split, the tree and actor bounds, the full-state replace and ruling R23''s Minimum-Level removal behind p_confirm_removals. Since #584 (ruling R30) the removal also withdraws those Members'' pending Applications on this Group, with the actor as decider — a Member removed from a Group in the same breath as their request to join it must not keep an Application that can only ever be refused.';

comment on function private.update_group_structure_impl(bigint, text, boolean, boolean, boolean, integer, text, text, boolean, boolean) is
  'Body behind public.update_group_structure (#582): BC''s and the Moderator''s structural settings, the child Minimum-Level split, the tree and actor bounds, the full-state replace and ruling R23''s Minimum-Level removal behind p_confirm_removals. Since #584 (ruling R30) the removal also withdraws those Members'' pending Applications on this Group, with the actor as decider, exactly as private.update_group_impl does. This is one of the two Group commands allowed to write the presentation label — it and private.create_group_impl are the only writers beside the three Wave 1 mirror functions, and conventions.test.sql''s sweep names them (ruling R16). It never writes groups.parent_id: a Group''s parent is fixed at creation (ruling R20).';

comment on function private.archive_group_impl(bigint) is
  'Body behind public.archive_group (#582, ADR-0009). A top-level Group is BC''s and the Moderator''s; a Child Group belongs to its Managers through private.require_group_manager. Unknown and unauthorized are the same 42501 group_manage_forbidden; an already-archived Group is PT409 group_already_archived. ARCHIVING NEVER CANCELS A TASK (ruling R21): while the subtree holds a Task that is not completed, unfulfilled or cancelled, or a Completed-work Request still pending, the command refuses with PT409 group_has_open_work. What has no executor it settles itself, in the same transaction: every future Event of the subtree is cancelled with the reason "Grup arhivat" through private.cancel_event_effect — the shared write-and-fan-out that carries no gate of its own — while past Events stay as history; since #584 (ruling R30) every pending Application on the subtree is DECLINED with the archiver as decider and "Grup arhivat" as its decision note, each applicant notified with a link to the member-facing Group page; then the status cascades to the whole subtree in ONE statement, because can_manage_group_work reads the target Group''s status alone and a live Child Group under an archived parent would otherwise stay manageable (ruling R19). It deliberately does NOT go through private.cancel_event_impl: that command re-decides authority per Event from the actor, so it would refuse a Group Manager who did not create an Organization Event and answer PT404 event_not_found for any Event raised above the archiver''s own Minimum Level, aborting the whole archive with a reason that names neither the Group nor the cause. The authority for these cancellations and declines is the GROUP, which the archiver already passed require_group_manager on.';

-- ==================== 10 · grants (conventions section 4, four-role revoke) ====================

revoke execute on function private.group_application_recipients(bigint)
  from public, anon, authenticated, service_role;

revoke execute on function private.has_pending_group_application(bigint)
  from public, anon, authenticated, service_role;
-- A policy predicate, so it runs as the calling role inside groups_read and
-- must stay callable by authenticated (conventions section 4).
grant execute on function private.has_pending_group_application(bigint)
  to authenticated;

revoke execute on function private.apply_to_group_impl(bigint, text)
  from public, anon, authenticated, service_role;
revoke execute on function private.withdraw_group_application_impl(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function private.decide_group_application_impl(bigint, boolean, text)
  from public, anon, authenticated, service_role;

grant execute on function private.apply_to_group_impl(bigint, text)
  to authenticated;
grant execute on function private.withdraw_group_application_impl(bigint)
  to authenticated;
grant execute on function private.decide_group_application_impl(bigint, boolean, text)
  to authenticated;

revoke execute on function public.apply_to_group(bigint, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.withdraw_group_application(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.decide_group_application(bigint, boolean, text)
  from public, anon, authenticated, service_role;

grant execute on function public.apply_to_group(bigint, text)
  to authenticated;
grant execute on function public.withdraw_group_application(bigint)
  to authenticated;
grant execute on function public.decide_group_application(bigint, boolean, text)
  to authenticated;
