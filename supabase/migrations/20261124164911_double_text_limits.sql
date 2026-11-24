-- #1228: every text and link limit doubled (Alex, 2026-11-24).
--
-- Alex: "make all the limits double, all the text limits and link limits ...
-- and if anywhere there are smaller limits, just double them". So, on every
-- text a person writes:
--
--   Formatted Text (R60)           2000 visible / 4000 stored -> 4000 / 8000
--   Attached Links (R46)           5 per Announcement or Task  -> 10
--   an Attached Link's label       60                          -> 120
--   any http(s) address            2048                        -> 4096
--   titles and names               120                         -> 240
--   notes and reasons              1000                        -> 2000
--   a Cerere's plain description   2000                        -> 4000
--   a Promotion Candidate reason   500                         -> 1000
--   location                       200                         -> 400
--   position / Manager titles      80                          -> 160
--   a Deal Code                    80                          -> 160
--   a Group's short name           16                          -> 32
--   a Nickname                     24                          -> 48
--   rating guide label / note      60 / 1000                   -> 120 / 2000
--   Difficulty label / glyph       40 / 16                     -> 80 / 32
--
-- Minimums stay. What follows from them grows with them: a deleted Task's
-- title kept on its ledger rows (points_ledger_task_reference_ck), the title
-- a cancelled Event's Announcement gets with "Anulat: " before it (232 + 8),
-- the Task title an approved Cerere takes from its description, and the
-- Notification a command composes (title 400, body 4000), so a long title or
-- text still reaches the bell whole.
--
-- Left as they are, because no member writes them as text: an email address
-- (254, RFC 5321), a push subscription's token and endpoint, the Resend
-- webhook ids, the Legacy Import's sheet ids, a Notification's subject key,
-- stored delivery errors, and every count of ids, rows, copies or seats.
--
-- Every limit only grows, so no stored row can break a new constraint: each
-- is dropped and re-added under its own name in one statement per table.
-- Every function body below is main's latest (read from the catalog after
-- 20261112064417), with only its limits changed.

-- ==================== Constraints ====================

alter table public.announcements
  drop constraint announcements_body_length_ck,
  add constraint announcements_body_length_ck check (char_length(body) <= 8000),
  drop constraint announcements_code_ck,
  add constraint announcements_code_ck
    check (code is null or (kind = 'deal' and char_length(code) between 1 and 160)),
  drop constraint announcements_form_link_ck,
  add constraint announcements_form_link_ck
    check (form_label is null
           or (char_length(form_label) <= 120 and form_url ~ '^https?://' and char_length(form_url) <= 4096)),
  drop constraint announcements_links_ck,
  add constraint announcements_links_ck
    check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 10),
  drop constraint announcements_rejection_reason_ck,
  add constraint announcements_rejection_reason_ck
    check ((approval_status = 'rejected') = (rejection_reason is not null)
           and (rejection_reason is null or char_length(btrim(rejection_reason)) between 1 and 2000)),
  drop constraint announcements_title_length_ck,
  add constraint announcements_title_length_ck check (char_length(title) between 3 and 240);

alter table public.adherence_message
  drop constraint adherence_message_body_length_ck,
  add constraint adherence_message_body_length_ck check (body is null or char_length(body) <= 8000),
  drop constraint adherence_message_link_label_length_ck,
  add constraint adherence_message_link_label_length_ck
    check (link_label is null or char_length(link_label) between 1 and 120),
  drop constraint adherence_message_link_url_ck,
  add constraint adherence_message_link_url_ck
    check (link_url is null or (char_length(link_url) <= 4096 and link_url ~ '^https?://')),
  drop constraint adherence_message_title_length_ck,
  add constraint adherence_message_title_length_ck
    check (title is null or char_length(title) between 1 and 240);

alter table public.campaigns
  drop constraint campaigns_name_length_ck,
  add constraint campaigns_name_length_ck check (char_length(name) between 3 and 240);

alter table public.completed_work_requests
  drop constraint completed_work_requests_decision_note_length_ck,
  add constraint completed_work_requests_decision_note_length_ck
    check (decision_note is null or char_length(decision_note) <= 2000),
  drop constraint completed_work_requests_description_length_ck,
  add constraint completed_work_requests_description_length_ck check (char_length(description) <= 4000);

alter table public.events
  drop constraint events_cancel_reason_length_ck,
  add constraint events_cancel_reason_length_ck check (cancel_reason is null or char_length(cancel_reason) <= 2000),
  drop constraint events_description_length_ck,
  add constraint events_description_length_ck check (description is null or char_length(description) <= 8000),
  drop constraint events_location_length_ck,
  add constraint events_location_length_ck check (location is null or char_length(location) <= 400),
  drop constraint events_rejection_reason_ck,
  add constraint events_rejection_reason_ck
    check ((approval_status = 'rejected') = (rejection_reason is not null)
           and (rejection_reason is null or char_length(btrim(rejection_reason)) between 1 and 2000)),
  drop constraint events_title_length_ck,
  add constraint events_title_length_ck check (char_length(title) between 3 and 240);

alter table public.group_members
  drop constraint group_members_position_title_length_ck,
  add constraint group_members_position_title_length_ck
    check (position_title is null or char_length(position_title) <= 160);

alter table public.groups
  drop constraint groups_application_form_label_ck,
  add constraint groups_application_form_label_ck
    check (application_form_label is null
           or (application_form_label ~ '[^[:space:]]' and char_length(application_form_label) <= 120)),
  drop constraint groups_application_form_url_ck,
  add constraint groups_application_form_url_ck
    check (application_form_url is null
           or (application_form_url ~ '^https?://' and char_length(application_form_url) <= 4096)),
  drop constraint groups_manager_title_length_ck,
  add constraint groups_manager_title_length_ck check (manager_title is null or char_length(manager_title) <= 160),
  drop constraint groups_name_length_ck,
  add constraint groups_name_length_ck check (char_length(name) between 3 and 240),
  drop constraint groups_responsible_title_length_ck,
  add constraint groups_responsible_title_length_ck
    check (responsible_title is null or char_length(responsible_title) <= 160),
  drop constraint groups_short_length_ck,
  add constraint groups_short_length_ck check (short is null or char_length(short) <= 32);

alter table public.notifications
  drop constraint notifications_body_length_ck,
  add constraint notifications_body_length_ck check (body is null or char_length(body) <= 4000),
  drop constraint notifications_title_length_ck,
  add constraint notifications_title_length_ck check (char_length(title) <= 400);

alter table public.org_settings
  drop constraint org_settings_value_length_ck,
  add constraint org_settings_value_length_ck check (value is null or char_length(value) <= 4096);

-- points_ledger carries a deferred constraint trigger; nothing in this
-- migration writes the ledger, so the alter never meets a pending event.
alter table public.points_ledger
  drop constraint points_ledger_note_length_ck,
  add constraint points_ledger_note_length_ck check (note is null or char_length(note) <= 2000),
  drop constraint points_ledger_task_reference_ck,
  add constraint points_ledger_task_reference_ck check (
    case
      when reason in ('task', 'task_reversal') then
        (task_id is not null and evaluation_id is not null and deleted_task_title is null)
        or (task_id is null and evaluation_id is null and deleted_task_title is not null
            and char_length(deleted_task_title) between 1 and 240)
      else task_id is null and evaluation_id is null and deleted_task_title is null
    end);

alter table public.profiles
  drop constraint profiles_full_name_length_ck,
  add constraint profiles_full_name_length_ck check (char_length(full_name) <= 240),
  drop constraint profiles_university_length_ck,
  add constraint profiles_university_length_ck
    check (university is null
           or (char_length(university) between 2 and 240 and university !~ '^[[:space:]]|[[:space:]]$'));

-- The Nickname's length lives in its Latin-only pattern (#675, security pass
-- L5), not in a char_length: {2,24} becomes {2,48}, the class unchanged. It is
-- re-added NOT VALID and validated only when every stored Nickname passes, as
-- 20260927190100 did: a stored Nickname from before L5 may still break the
-- Latin rule (never the length), and a failed validation would stop the
-- Release. New and changed rows are checked either way.
alter table public.profiles
  drop constraint profiles_nickname_ck,
  add constraint profiles_nickname_ck
    check (nickname is null
           or (nickname = btrim(nickname)
               and nickname ~ '^[A-Za-z0-9À-ÖØ-öø-žȘ-ț ._-]{2,48}$'))
    not valid;

do $$
declare
  v_failing bigint;
begin
  select count(*) into v_failing
    from public.profiles
   where nickname is not null
     and not (nickname = btrim(nickname)
              and nickname ~ '^[A-Za-z0-9À-ÖØ-öø-žȘ-ț ._-]{2,48}$');
  if v_failing = 0 then
    alter table public.profiles validate constraint profiles_nickname_ck;
  else
    raise notice 'profiles_nickname_ck left NOT VALID: % stored Nickname(s) break the Latin rule', v_failing;
  end if;
end
$$;

alter table public.promotion_candidates
  drop constraint promotion_candidates_reason_length_ck,
  add constraint promotion_candidates_reason_length_ck check (char_length(reason) between 1 and 1000);

alter table public.rating_guide
  drop constraint rating_guide_label_length_ck,
  add constraint rating_guide_label_length_ck check (char_length(label) <= 120),
  drop constraint rating_guide_note_length_ck,
  add constraint rating_guide_note_length_ck check (note is null or char_length(note) <= 2000);

alter table public.role_evaluations
  drop constraint role_evaluations_name_length_ck,
  add constraint role_evaluations_name_length_ck check (char_length(name) between 3 and 240);

alter table public.task_activity
  drop constraint task_activity_note_length_ck,
  add constraint task_activity_note_length_ck check (note is null or char_length(note) <= 2000);

alter table public.task_assignments
  drop constraint task_assignments_end_note_length_ck,
  add constraint task_assignments_end_note_length_ck check (end_note is null or char_length(end_note) <= 2000);

alter table public.task_difficulty_levels
  drop constraint task_difficulty_levels_glyph_ck,
  add constraint task_difficulty_levels_glyph_ck check (char_length(glyph) <= 32),
  drop constraint task_difficulty_levels_label_ck,
  add constraint task_difficulty_levels_label_ck check (label ~ '[^[:space:]]' and char_length(label) <= 80);

alter table public.task_evaluations
  drop constraint task_evaluations_note_length_ck,
  add constraint task_evaluations_note_length_ck check (char_length(note) <= 2000),
  drop constraint task_evaluations_reversal_reason_length_ck,
  add constraint task_evaluations_reversal_reason_length_ck
    check (reversal_reason is null or char_length(reversal_reason) <= 2000);

alter table public.tasks
  drop constraint tasks_cancel_reason_length_ck,
  add constraint tasks_cancel_reason_length_ck check (cancel_reason is null or char_length(cancel_reason) <= 2000),
  drop constraint tasks_description_length_ck,
  add constraint tasks_description_length_ck check (description is null or char_length(description) <= 8000),
  drop constraint tasks_link_format_ck,
  add constraint tasks_link_format_ck
    check (link_label is null
           or (link_label ~ '[^[:space:]]' and char_length(link_label) <= 120
               and link_url ~ '^https?://' and char_length(link_url) <= 4096)),
  drop constraint tasks_links_ck,
  add constraint tasks_links_ck check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 10),
  drop constraint tasks_title_length_ck,
  add constraint tasks_title_length_ck check (char_length(title) between 3 and 240);

-- ==================== Column comments that name a limit ====================

comment on column public.tasks.link_label is
  'The Attached Link''s label (#684, ruling R7): at most 120 characters, set together with link_url (tasks_link_ck).';
comment on column public.tasks.link_url is
  'The Attached Link''s http(s) address (#684, ruling R7): at most 4096 characters, set together with link_label (tasks_link_ck).';
comment on column public.groups.application_form_label is
  '#697 (ruling R18): the label of the Group''s "Formular de înscriere" Attached Link -- at most 120 characters, set together with application_form_url (groups_application_form_ck). Written only by public.update_group.';
comment on column public.groups.application_form_url is
  '#697 (ruling R18): the http(s) address of the Group''s "Formular de înscriere" Attached Link -- at most 4096 characters, set together with application_form_label (groups_application_form_ck). When set, applicants are sent to the form and joining happens by Appointment (#698). Written only by public.update_group.';
comment on column public.groups.responsible_title is
  '#962: what this Group calls its Group Responsible position ("Coordonator" for a Department''s BCE members) -- at most 160 characters, never blank, null for the plain "Responsabil". The default the appointment form pre-fills and the fallback wherever a Responsible''s own group_members.position_title is absent. Written only by public.update_group.';
comment on column public.announcements.links is
  'R46: the Announcement''s Attached Links, at most ten {label, url} objects in display order. form_label/form_url mirror links[0] for one release.';
comment on column public.tasks.links is
  'R46: the Task''s Attached Links, at most ten {label, url} objects in display order. link_label/link_url mirror links[0] for one release.';
comment on column public.announcements.code is
  'R45: a Deal''s optional Deal Code (at most 160 characters, trimmed). #1152: not readable by authenticated -- the table grant is per column and leaves it out. A reader gets it from public.reveal_deal_code, which records the reveal; whoever may edit the Deal (private.can_manage_deal) from public.deal_code_for_edit, which records nothing. Writable with the row under announcements_create / announcements_update.';
comment on column public.adherence_message.title is
  'R66: the heading BC writes, plain text, 1-240 characters; null while there is no message.';
comment on column public.adherence_message.body is
  'R66: the message, Formatted Text (R60): at most 8000 stored and 4000 visible characters; null while there is no message.';
comment on column public.adherence_message.link_url is
  'R66: the adherence form''s address, http(s), at most 4096 characters; null for no link. Copied on day one from org_settings.adherence_form_url.';
comment on column public.adherence_message.link_label is
  'R66: the label of the link''s button, plain text, 1-120 characters; set exactly when link_url is.';

-- ==================== Functions: main's bodies, limits doubled ====================

-- private.apply_to_group_impl(bigint,text)
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
  -- 0. #724 (ruling R8): a note over 2000 characters is malformed for every
  --    caller, so it is answered before the actor is even resolved. It is
  --    measured as it is stored -- trimmed.
  perform private.require_text_length('note', v_note, null, 2000);

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
  --    there, not on the member-facing page — opened on that tab (#843, D6). private.notify drops the actor,
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
    '/administrare/grupuri/' || p_group_id::text || '?tab=cereri');

  return v_row;
end;
$function$;

-- private.appoint_group_member(bigint,uuid,uuid,text,text,boolean)
CREATE OR REPLACE FUNCTION private.appoint_group_member(p_group_id bigint, p_member_id uuid, p_actor uuid, p_group_role text DEFAULT 'member'::text, p_position_title text DEFAULT NULL::text, p_notify boolean DEFAULT true)
 RETURNS group_members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_group   public.groups%rowtype;
  v_title   text := nullif(btrim(p_position_title), '');
  v_row     public.group_members%rowtype;
  v_display text;
begin
  -- No gate of its own (#582's private.cancel_event_effect established the
  -- shape): every caller brings its own authority — add_group_member_impl the
  -- work tier, set_group_role_impl the Manager tier, create_group_impl the
  -- parent's Managers, #602's provisioning the inviting BC's level. What lives
  -- here is what must be true of the ROSTER ROW whoever writes it, so that no
  -- second path can ever be a shortcut past it.
  --
  -- Malformed arguments first, as in every command (conventions section 2).
  -- set_group_role_impl has already answered these for a client call; a
  -- programmatic caller such as provisioning has not.
  if p_group_role is null or p_group_role not in ('manager', 'responsible', 'member') then
    raise sqlstate 'PT400' using message = 'invalid_group_role';
  end if;
  if p_position_title is not null and v_title is null then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;
  -- Security pass 2026-09-27 (L1): group_members_position_title_length_ck.
  perform private.require_text_length('position_title', v_title, null, 160);
  -- #967: a Responsible's title is required, a Manager's optional, an
  -- ordinary row's refused.
  if p_group_role = 'responsible' and v_title is null then
    raise sqlstate 'PT400' using message = 'position_title_required';
  end if;
  if p_group_role = 'member' and v_title is not null then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;

  select grp.* into v_group
    from public.groups as grp
   where grp.id = p_group_id
   for no key update;
  if not found then
    -- Non-disclosing, like every other refusal in this family: an unknown
    -- Group, an archived one below level 6 and one the caller may not touch
    -- are a single answer.
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;

  -- The Member's profile is held FOR SHARE before a roster row names it, so a
  -- concurrent deactivation serializes behind this decision instead of
  -- committing underneath it (conventions section 2).
  perform 1 from public.profiles as target
    where target.id = p_member_id and target.status = 'activ'
    for share of target;
  if not found then
    raise sqlstate 'PT400' using message = 'group_member_not_eligible';
  end if;
  if coalesce(private.actor_level(p_member_id), -1) < v_group.min_level then
    raise sqlstate 'PT400' using message = 'group_member_below_min_level';
  end if;

  -- Shape 5: a Group whose roster follows the rank holds no ordinary rows.
  if p_group_role = 'member' and v_group.automatic_membership then
    raise sqlstate 'PT409' using message = 'automatic_group_has_no_roster_members';
  end if;

  if exists (select 1 from public.group_members as existing
              where existing.group_id = p_group_id
                and existing.member_id = p_member_id) then
    raise sqlstate 'PT409' using message = 'already_group_member';
  end if;

  insert into public.group_members (group_id, member_id, group_role, position_title)
  values (p_group_id, p_member_id, p_group_role, v_title)
  returning * into v_row;

  -- #861 (Audit D-20): a caller whose own Notification already tells the
  -- target (decide_group_application's "Cerere acceptată: <Group>") passes
  -- p_notify => false, so the target hears about one decision once. Every
  -- other caller keeps the default and this Notification.
  if p_notify is false then
    return v_row;
  end if;

  -- One direct Notification to the TARGET, in the same transaction, never to
  -- the actor (ruling R25 — private.notify drops the actor from the recipient
  -- array by itself, so an actor appointing themselves is told nothing). The
  -- link is the member-facing Group page (#589).
  if p_group_role = 'member' then
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Ai fost adăugat în ' || v_group.name,
      -- #843 (B36): the title says it all.
      null,
      null, null, p_actor, '/grupuri/' || p_group_id::text);
  else
    -- #962: the position's display name -- a Group Responsible's own title,
    -- then the Group setting groups.responsible_title; a Group Manager's own
    -- title (#967), then groups.manager_title.
    if p_group_role = 'responsible' then
      v_display := coalesce(v_title, nullif(btrim(v_group.responsible_title), ''), 'responsabil');
    else
      v_display := coalesce(v_title, nullif(btrim(v_group.manager_title), ''), 'coordonator de grup');
    end if;
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Numire în ' || v_group.name,
      'Ai fost numit ' || v_display || ' în grupul ' || v_group.name || '.',
      null, null, p_actor, '/grupuri/' || p_group_id::text);
  end if;

  return v_row;
end;
$function$;

-- private.approve_completed_work_request_impl(bigint,integer,integer,text,text,text,bigint,text,text,bigint,jsonb)
CREATE OR REPLACE FUNCTION private.approve_completed_work_request_impl(p_request_id bigint, p_difficulty integer, p_rating integer, p_note text, p_title text, p_description text, p_group_id bigint, p_link_label text, p_link_url text, p_campaign_id bigint, p_links jsonb)
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
  perform private.require_text_length('note', v_note, null, 2000);
  -- #915: the Task's shape, when the decider changes it. Null keeps the
  -- Request's value; a title, once given, cannot be blank.
  if p_title is not null then
    if p_title !~ '[^[:space:]]' then
      raise sqlstate 'PT400' using message = 'title_required';
    end if;
    v_title := regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g');
    perform private.require_text_length('title', v_title, 3, 240);
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
    values (coalesce(v_title, left(v_request.description, 240)),
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

-- private.cancel_event_effect(bigint,text,uuid)
CREATE OR REPLACE FUNCTION private.cancel_event_effect(p_event_id bigint, p_reason text, p_actor uuid)
 RETURNS events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_updated    public.events%rowtype;
  v_recipients uuid[];
  v_deciding   text;
begin
  update public.events
     set cancelled_at = clock_timestamp(),
         cancel_reason = btrim(p_reason)
   where id = p_event_id
  returning * into v_updated;
  if not found then
    return null;
  end if;
  select array_agg(recipient) into v_recipients
    from private.event_notification_recipients(p_event_id) as recipient;
  perform private.notify(v_recipients, 'event', 'Eveniment anulat: ' || v_updated.title,
    v_updated.cancel_reason, null, 'event:' || p_event_id::text || ':cancelled', p_actor, '/calendar?event=' || p_event_id::text);
  -- #1150 (audit M8): the Event's own Announcement reads as cancelled --
  -- "Anulat: " before its title, the word the Calendar shows on the Event --
  -- a long title cut so the marked one still fits in 240 characters. A
  -- cancellation is the Event's state, never a content edit: stamp_approval
  -- skips cancelled_at, so it never sends the Event back to BC, and the mark
  -- passes the stamp the way the decision commands' writes do, so it does not
  -- send the Announcement back either. Its readers hear "Anunț actualizat" as
  -- from any edit (R53).
  v_deciding := current_setting('osubb.deciding_approval', true);
  perform set_config('osubb.deciding_approval', 'on', true);
  update public.announcements as announcement
     set title = case when char_length(announcement.title) <= 232
                      then 'Anulat: ' || announcement.title
                      else 'Anulat: ' || rtrim(left(announcement.title, 231)) || '…' end
   where announcement.event_id = p_event_id
     and announcement.title not like 'Anulat: %';
  perform set_config('osubb.deciding_approval', coalesce(v_deciding, ''), true);
  return v_updated;
end;
$function$;

-- private.cancel_event_impl(bigint,text)
CREATE OR REPLACE FUNCTION private.cancel_event_impl(p_event_id bigint, p_reason text)
 RETURNS events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_event public.events%rowtype;
begin
  if p_reason is null or p_reason !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'reason_required';
  end if;
  -- #673 (R8): measured as stored (cancel_event_effect btrims it).
  perform private.require_text_length('reason', btrim(p_reason), null, 2000);
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
  -- #756: the events_read rule itself, so an Event of a Private Group is
  -- missing for an outsider rather than forbidden (update_event agrees).
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
  if v_event.cancelled_at is not null then
    raise sqlstate 'PT409' using message = 'event_cancelled';
  end if;

  -- Every gate above is this command's; the write and the fan-out are the
  -- shared effect (#582, section 4b), which archive_group calls with the
  -- Group's authority instead of an actor's.
  return private.cancel_event_effect(p_event_id, p_reason, v_actor);
end;
$function$;

-- private.cancel_task_impl(bigint,text)
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
  perform private.require_text_length('reason', v_reason, null, 2000);

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

-- private.complete_task_review_impl(bigint,integer,integer,text)
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
    regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 2000);
  --    Difficulty and Rating join it here (whole-wave review, finding 5): a
  --    value outside task_evaluations' 1..10 CHECK could never succeed for ANY
  --    caller, so it is malformed for everyone and is answered before the
  --    gate -- which is what private.approve_completed_work_request_impl, the
  --    third caller of private.evaluate_task, already did.
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 10 then
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

-- private.mark_task_unfulfilled_impl(bigint,integer,integer,text)
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
    regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 2000);
  --    Difficulty and Rating join it here (whole-wave review, finding 5): a
  --    value outside task_evaluations' 1..10 CHECK could never succeed for ANY
  --    caller, so it is malformed for everyone and is answered before the
  --    gate -- which is what private.approve_completed_work_request_impl, the
  --    third caller of private.evaluate_task, already did.
  if p_difficulty is null or p_difficulty < 1 or p_difficulty > 10 then
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

-- private.create_campaign_impl(bigint,text)
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
  v_group_status text;
begin
  -- #673 (R8): malformed for every caller, measured as stored (trimmed).
  perform private.require_text_length('name',
    regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'), 3, 240);
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

  -- #1127 (audit M3): no new Campaign in an archived Group, for the same
  -- reason create_task refuses one -- a state rule, after authority and the
  -- name rules, before the write. #1174: read with the Group row held FOR
  -- SHARE (a row this command only reads; before it the command holds only
  -- the actor's Profile and roster rows, never a tasks row), so a concurrent
  -- archive_group serializes here and the status read is the one it
  -- committed.
  select grp.status into v_group_status
    from public.groups as grp where grp.id = p_group_id for share;
  if v_group_status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;

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

-- private.update_campaign_impl(bigint,text)
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
    regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'), 3, 240);
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

-- private.create_completed_task_impl(uuid,bigint,text,text,text,text,bigint,integer,integer,text,jsonb)
CREATE OR REPLACE FUNCTION private.create_completed_task_impl(p_executor_id uuid, p_group_id bigint, p_title text, p_description text, p_link_label text, p_link_url text, p_campaign_id bigint, p_difficulty integer, p_rating integer, p_note text, p_links jsonb)
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
  perform private.require_text_length('note', v_note, null, 2000);
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'title_required';
  end if;
  v_title := regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  perform private.require_text_length('title', v_title, 3, 240);
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

-- private.create_completed_work_request_impl(text,bigint)
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
  perform private.require_text_length('description', v_description, null, 4000);
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
  -- R64: any active Group the requester can see and whose Minimum Level they
  -- meet, member of it or not. Unknown, hidden, inactive, too high and
  -- automatic are one answer.
  if not private.is_request_origin(p_group_id, v_actor) then
    raise exception using errcode = '42501', message = 'request_origin_forbidden';
  end if;
  -- Security pass L3: at most thirty Completed Work Requests per Member in
  -- any 24 hours, so a Member cannot flood the deciders with Notifications.
  perform private.require_daily_cap('completed_work_request', v_actor);
  insert into public.completed_work_requests (requester_id, group_id, description, status)
  values (v_actor, p_group_id, v_description, 'pending') returning * into v_request;
  -- R43: every decider may still decide (request_deciders is the authority);
  -- one who unselected the Request's Group is not told.
  perform private.notify(array(
      select decider
        from private.request_deciders(v_request.id) as decider
       where not private.group_muted_for(v_request.group_id, decider)),
    'task'::public.noti_kind, 'Cerere nouă: ' || left(v_description, 60),
    coalesce(v_actor_name, 'Un membru') || ' a trimis o cerere de muncă realizată.',
    null, 'request:' || v_request.id::text, v_actor, '/cereri');
  return v_request;
end;
$function$;

-- private.create_event_impl(text,text,bigint,timestamp with time zone,timestamp with time zone,text,integer,text,integer,bigint,boolean,boolean)
CREATE OR REPLACE FUNCTION private.create_event_impl(p_title text, p_type text, p_group_id bigint, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_location text DEFAULT NULL::text, p_capacity integer DEFAULT NULL::integer, p_description text DEFAULT NULL::text, p_min_level integer DEFAULT 0, p_campaign_id bigint DEFAULT NULL::bigint, p_announce boolean DEFAULT false, p_all_day boolean DEFAULT false)
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
  perform private.require_text_length('title', btrim(p_title), 3, 240);
  perform private.require_formatted_text_length('description', btrim(p_description));
  -- Security pass 2026-09-27 (L1): events_location_length_ck, measured as stored.
  perform private.require_text_length('location', btrim(p_location), null, 400);
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
$function$;

-- private.update_event_impl(bigint,text,text,bigint,timestamp with time zone,timestamp with time zone,text,integer,text,integer,bigint,boolean)
CREATE OR REPLACE FUNCTION private.update_event_impl(p_event_id bigint, p_title text, p_type text, p_group_id bigint, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_location text, p_capacity integer, p_description text, p_min_level integer, p_campaign_id bigint, p_all_day boolean DEFAULT NULL::boolean)
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
  v_all_day boolean;
begin
  -- 1. Malformed input, judged for everyone before the gate.
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_event_title';
  end if;
  -- #673 (R8): measured as stored (btrim).
  perform private.require_text_length('title', btrim(p_title), 3, 240);
  perform private.require_formatted_text_length('description', btrim(p_description));
  -- Security pass 2026-09-27 (L1): events_location_length_ck, measured as stored.
  perform private.require_text_length('location', btrim(p_location), null, 400);
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
    -- #1150: the Event's own Announcement follows it, after the Event's
    -- notices, so who hears "new" or "changed" of the Event is decided as
    -- before.
    perform private.sync_event_announcement(v_event, v_updated);
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
  -- #1150 (audit M8): the Event's own Announcement now says what the Event
  -- says -- after the Event's notices, so who hears "new" or "changed" of the
  -- Event is decided exactly as before.
  perform private.sync_event_announcement(v_event, v_updated);
  return v_updated;
end;
$function$;

-- private.create_group_impl(text,text,bigint,integer,uuid,text,text,boolean)
CREATE OR REPLACE FUNCTION private.create_group_impl(p_name text, p_category text, p_parent_id bigint DEFAULT NULL::bigint, p_min_level integer DEFAULT NULL::integer, p_manager_id uuid DEFAULT NULL::uuid, p_color text DEFAULT NULL::text, p_short text DEFAULT NULL::text, p_is_private boolean DEFAULT false)
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
  v_is_private  boolean;
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
  perform private.require_text_length('name', btrim(p_name), 3, 240);
  -- Security pass 2026-09-27 (L1): groups_short_length_ck, measured as stored.
  perform private.require_text_length('short', nullif(btrim(p_short), ''), null, 32);
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
  -- #756 (ruling R25): a Child Group inherits its parent's privacy -- a
  -- Private Group's subtree is private, whatever the caller asked. Making a
  -- Group private is BC's and the Moderator's structural choice, so a
  -- parent's Manager below level 6 may not start a private Child Group
  -- under a public parent (the same non-disclosing 42501 as every refusal
  -- of this gate).
  v_is_private  := coalesce(p_is_private, false) or coalesce(v_parent.is_private, false);
  if v_is_private and not coalesce(v_parent.is_private, false)
     and coalesce(v_actor_level, -1) < 6 then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;

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
  --    there is no parent row to serialize on. Since #591 groups_parent_name_uidx
  --    is total, so the pre-check covers every sibling, exactly as the index does.
  if exists (
    select 1 from public.groups as sibling
     where coalesce(sibling.parent_id, 0) = coalesce(p_parent_id, 0)
       and lower(sibling.name) = lower(btrim(p_name))
  ) then
    raise sqlstate 'PT409' using message = 'group_name_taken';
  end if;

  begin
    insert into public.groups (
      name, category, parent_id, min_level, color, short, created_by, is_private
    ) values (
      btrim(p_name), p_category, p_parent_id, v_min_level,
      p_color, nullif(btrim(p_short), ''), v_actor, v_is_private
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

-- private.update_group_impl(bigint,text,text,text,boolean,integer,boolean,integer,text,text,boolean)
CREATE OR REPLACE FUNCTION private.update_group_impl(p_group_id bigint, p_name text, p_manager_title text, p_responsible_title text, p_accepts_applications boolean, p_application_level integer, p_shared_work_visibility boolean, p_min_level integer, p_application_form_label text, p_application_form_url text, p_confirm_removals boolean DEFAULT false)
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
  v_resp_title  text    := nullif(btrim(p_responsible_title), '');
  v_form_label  text;
  v_form_url    text;
  v_updated     public.groups%rowtype;
  v_below       uuid[];
  v_removed     uuid[];
  v_managers    uuid[];
begin
  if p_name is null or p_name !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_group_name';
  end if;
  -- #673 (R8): measured as stored (btrim).
  perform private.require_text_length('name', btrim(p_name), 3, 240);
  if p_manager_title is not null and p_manager_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;
  -- Security pass 2026-09-27 (L1): groups_manager_title_length_ck.
  perform private.require_text_length('manager_title', v_title, null, 160);
  -- #962: the Group Responsible position's display name, judged exactly as
  -- the Manager's is -- blank is malformed, over 80 is too long.
  if p_responsible_title is not null and p_responsible_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;
  perform private.require_text_length('responsible_title', v_resp_title, null, 160);
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
  -- #697 (R18/R8): the application form link, trimmed (blank -> null) and
  -- judged exactly as a Task's Attached Link is.
  v_form_label := nullif(regexp_replace(coalesce(p_application_form_label, ''),
                                        '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_form_url := nullif(regexp_replace(coalesce(p_application_form_url, ''),
                                      '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_attached_link(v_form_label, v_form_url);

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
  -- #756 (ruling R25): a Private Group accepts no Applications -- the same
  -- reason apply_to_group answers. update_group_structure switched them off
  -- when the Group turned private, so this refuses only turning them on.
  if v_accepts and v_group.is_private then
    raise sqlstate 'PT400' using message = 'group_private';
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
  ) then
    raise sqlstate 'PT409' using message = 'group_name_taken';
  end if;

  if (btrim(p_name), v_title, v_resp_title, v_accepts, p_application_level, v_shared, p_min_level,
      v_form_label, v_form_url)
     is not distinct from
     (v_group.name, v_group.manager_title, v_group.responsible_title, v_group.accepts_applications,
      v_group.application_level, v_group.shared_work_visibility, v_group.min_level,
      v_group.application_form_label, v_group.application_form_url) then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- Review of PR #1123 (CodeRabbit): hold the Events this raise will lift
  -- BEFORE the roster rows. update_event locks its Event first and then the
  -- editor's roster row for share; taking them in the other order here would
  -- form an ABBA cycle with a Responsible below the new level editing an
  -- Event at the same moment (conventions section 2).
  perform 1 from public.events as event
    where event.group_id = p_group_id
      and event.min_level < least(p_min_level, 6)
    order by event.id
    for no key update;

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
         responsible_title      = v_resp_title,
         accepts_applications   = v_accepts,
         application_level      = p_application_level,
         shared_work_visibility = v_shared,
         min_level              = p_min_level,
         application_form_label = v_form_label,
         application_form_url   = v_form_url
   where id = p_group_id
  returning * into v_updated;

  -- Audit 2026-10-30 (H2): the Group's own Events follow its Minimum Level up.
  -- The Event ladder stops at 6; see the migration header.
  update public.events as event
     set min_level = least(p_min_level, 6)
   where event.group_id = p_group_id
     and event.min_level < least(p_min_level, 6);

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

-- private.update_group_structure_impl(bigint,text,boolean,boolean,boolean,integer,text,text,boolean,boolean,boolean)
CREATE OR REPLACE FUNCTION private.update_group_structure_impl(p_group_id bigint, p_category text, p_competes_in_cup boolean, p_counts_toward_parent_cup boolean, p_automatic_membership boolean, p_min_level integer, p_color text, p_short text, p_is_organization boolean, p_is_private boolean, p_confirm_removals boolean DEFAULT false)
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
  v_competes    boolean := coalesce(p_competes_in_cup, false);
  v_counts      boolean := coalesce(p_counts_toward_parent_cup, true);
  v_automatic   boolean := coalesce(p_automatic_membership, false);
  -- #1129: no coalesce -- a null is refused below, never read as false.
  v_is_org      boolean := p_is_organization;
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
  -- Security pass 2026-09-27 (L1): groups_short_length_ck.
  perform private.require_text_length('short', v_short, null, 32);
  -- #756: a full-state replace must say which it is. A null is refused rather
  -- than read as "public", which would un-hide a Private Group by omission.
  if p_is_private is null then
    raise sqlstate 'PT400' using message = 'invalid_group_privacy';
  end if;
  -- #1129: the same for the Organization marker. A null is refused rather than
  -- read as "not the Organization", which would unmark the Organization Group
  -- by omission and leave an org-wide Announcement with no recipients.
  if p_is_organization is null then
    raise sqlstate 'PT400' using message = 'invalid_group_organization';
  end if;
  -- #756: the Organization Group is every Member's, so it cannot be private --
  -- and since privacy cascades down, marking it so would hide the whole tree.
  if p_is_private and v_is_org then
    raise sqlstate 'PT400' using message = 'private_not_allowed_for_organization';
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
  -- ADR-0009, amended 2026-10-13 (Alex, 2026-10-11): the Department Cup is a
  -- Department's. The one place this command reads the label it writes, and
  -- it reads the REQUESTED label: a Group that takes another label leaves the
  -- Cup in the same command or is refused.
  if v_competes and p_category <> 'department' then
    raise sqlstate 'PT409' using message = 'cup_not_department';
  end if;
  if v_is_org and exists (select 1 from public.groups as other
                           where other.is_organization and other.id <> p_group_id) then
    raise sqlstate 'PT409' using message = 'organization_group_exists';
  end if;
  -- #1129: there is always exactly one Organization Group, so its marker is
  -- never cleared here -- not by a full-state replace with false from any
  -- client. The marker does not move through this command.
  if v_group.is_organization and not v_is_org then
    raise sqlstate 'PT409' using message = 'group_protected';
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
    -- #756 (ruling R25): a Private Group's subtree is private. The parent is
    -- held FOR NO KEY UPDATE above, so it cannot turn private underneath.
    if v_parent.is_private and not p_is_private then
      raise sqlstate 'PT400' using message = 'private_parent';
    end if;
  end if;
  if exists (select 1 from public.groups as child
              where child.parent_id = p_group_id and child.min_level < p_min_level) then
    raise sqlstate 'PT400' using message = 'group_min_level_above_children';
  end if;
  if coalesce(v_actor_level, -1) < 9 and p_min_level > coalesce(v_actor_level, -1) then
    raise sqlstate 'PT400' using message = 'group_min_level_above_actor';
  end if;

  if (p_category, v_competes, v_counts, v_automatic, p_min_level, p_color, v_short, v_is_org,
      p_is_private)
     is not distinct from
     (v_group.category, v_group.competes_in_cup, v_group.counts_toward_parent_cup,
      v_group.automatic_membership, v_group.min_level, v_group.color,
      v_group.short, v_group.is_organization, v_group.is_private) then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- Review of PR #1123 (CodeRabbit): hold the Events this raise will lift
  -- BEFORE the roster rows. update_event locks its Event first and then the
  -- editor's roster row for share; taking them in the other order here would
  -- form an ABBA cycle with a Responsible below the new level editing an
  -- Event at the same moment (conventions section 2).
  perform 1 from public.events as event
    where event.group_id = p_group_id
      and event.min_level < least(p_min_level, 6)
    order by event.id
    for no key update;

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
         is_organization          = v_is_org,
         is_private               = p_is_private,
         -- #756: a Private Group accepts no Applications (ruling R25).
         accepts_applications     = accepts_applications and not p_is_private
   where id = p_group_id
  returning * into v_updated;

  -- Audit 2026-10-30 (H2): the Group's own Events follow its Minimum Level up.
  -- The Event ladder stops at 6; see the migration header.
  update public.events as event
     set min_level = least(p_min_level, 6)
   where event.group_id = p_group_id
     and event.min_level < least(p_min_level, 6);

  -- #756 (ruling R25): turning a Group private hides its whole subtree in this
  -- same transaction, and a Private Group accepts no Applications; turning it
  -- public leaves the Child Groups as they are. The descendants are Child rows
  -- of a row already held FOR UPDATE, so the update's own FOR NO KEY UPDATE is
  -- the only lock they take (conventions section 2); archive_group cascades
  -- over the same `path @>` set in the same order.
  --
  -- The cascade repeats until a pass changes nothing. create_group locks only
  -- its parent, so a Child Group created under a descendant while a pass is
  -- waiting on that descendant commits after the pass's snapshot was taken and
  -- the pass cannot see it. The next statement takes a fresh snapshot (READ
  -- COMMITTED) and does. A create that starts later waits on the descendant
  -- this command now holds and reads it private. Locking the whole ancestor
  -- path in create_group instead would invert update_group's and this
  -- command's own child-then-parent order and deadlock them.
  if p_is_private and not v_group.is_private then
    loop
      update public.groups as below
         set is_private           = true,
             accepts_applications = false
       where below.path @> array[p_group_id]
         and below.id <> p_group_id
         and (not below.is_private or below.accepts_applications);
      exit when not found;
    end loop;

    -- An Application filed before the Group turned private is not
    -- grandfathered: it is withdrawn with the actor as decider, exactly as
    -- ruling R23's Minimum-Level removal withdraws one (#584, ruling R30).
    perform 1 from public.group_applications as application
      join public.groups as below on below.id = application.group_id
     where below.path @> array[p_group_id]
       and application.status = 'pending'
     order by application.id
       for update of application;

    update public.group_applications as application
       set status     = 'withdrawn',
           decided_by = v_actor,
           decided_at = clock_timestamp()
      from public.groups as below
     where below.id = application.group_id
       and below.path @> array[p_group_id]
       and application.status = 'pending';
  end if;

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

-- private.create_task_impl(text,text,timestamp with time zone,text,text,uuid,bigint,bigint,text,bigint,text,text,jsonb,integer)
CREATE OR REPLACE FUNCTION private.create_task_impl(p_title text, p_description text, p_deadline timestamp with time zone, p_audience text, p_assignment_mode text, p_executor_id uuid, p_campaign_id bigint, p_parent_task_id bigint, p_kind text, p_group_id bigint, p_link_label text, p_link_url text, p_links jsonb, p_min_level integer)
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
    regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g'), 3, 240);
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

-- private.update_task_impl(bigint,bigint,text,text,timestamp with time zone,bigint,text,text,text,text,boolean,jsonb,integer,timestamp with time zone)
CREATE OR REPLACE FUNCTION private.update_task_impl(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text, p_link_url text, p_accept_consequences boolean, p_links jsonb, p_min_level integer, p_updated_at timestamp with time zone)
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
    regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g'), 3, 240);
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

-- private.preview_task_update_impl(bigint,bigint,text,text,timestamp with time zone,bigint,text,text,text,text,jsonb,integer,timestamp with time zone)
CREATE OR REPLACE FUNCTION private.preview_task_update_impl(p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text, p_link_url text, p_links jsonb, p_min_level integer, p_updated_at timestamp with time zone)
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
    regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g'), 3, 240);
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

-- private.duplicate_task_impl(bigint,timestamp with time zone)
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
  v_group_status  text;
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
  perform private.require_text_length('title', v_source.title, 3, 240);
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

  -- #1127 (audit M3): the copy lands in its source's Group, which must still
  -- be active -- the same state rule create_task applies, judged after the
  -- authority and input refusals and before the cap and the write. #1174:
  -- read with the Group row held FOR SHARE (a row this command only reads),
  -- after the source Task -- the tasks-then-groups order create_task and
  -- update_task take; archive_group never locks a tasks row -- so a
  -- concurrent archive (FOR UPDATE on its target, FOR NO KEY UPDATE on the
  -- subtree) serializes here and the status read is the one it committed.
  select grp.status into v_group_status
    from public.groups as grp where grp.id = v_source.group_id for share;
  if v_group_status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
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

-- private.decide_group_application_impl(bigint,boolean,text)
CREATE OR REPLACE FUNCTION private.decide_group_application_impl(p_application_id bigint, p_accept boolean, p_note text DEFAULT NULL::text)
 RETURNS group_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.require_text_length('note', v_note, null, 2000);

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
    -- #861 (Audit D-20): without the Appointment core's own "Ai fost adăugat
    -- în …": "Cerere acceptată: <Group>" below is the one Notification the
    -- applicant gets for this decision.
    perform private.appoint_group_member(v_row.group_id, v_row.member_id, v_actor,
                                         p_notify => false);
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
$function$;

-- private.event_announcement_body(timestamp with time zone,timestamp with time zone,text,text,boolean)
CREATE OR REPLACE FUNCTION private.event_announcement_body(p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_location text, p_description text, p_all_day boolean DEFAULT false)
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
  v_last date;
  v_line text;
  v_text text;
  v_lines text[];
  v_n integer;
  v_words text;
  v_cut text;
  v_room integer;
  v_body text;
begin
  if coalesce(p_all_day, false) and v_end is not null then
    -- #1098 (R63): "Sâmbătă, 24 octombrie 2026, toată ziua", or with its last
    -- day -- the day before the exclusive end -- when it spans several.
    v_last := (v_end - interval '1 day')::date;
    v_line := v_days[extract(dow from v_start)::int + 1] || ', '
      || extract(day from v_start)::int || ' ' || v_months[extract(month from v_start)::int]
      || ' ' || extract(year from v_start)::int;
    if v_last > v_start::date then
      v_line := v_line || ' – ' || v_days[extract(dow from v_last)::int + 1] || ', '
        || extract(day from v_last)::int || ' ' || v_months[extract(month from v_last)::int]
        || ' ' || extract(year from v_last)::int;
    end if;
    v_line := v_line || ', toată ziua';
  else
    -- "Miercuri, 30 septembrie 2026, 18:40–20:40 · Sala 305", always in Romania.
    v_line := v_days[extract(dow from v_start)::int + 1] || ', '
      || extract(day from v_start)::int || ' ' || v_months[extract(month from v_start)::int]
      || ' ' || extract(year from v_start)::int || ', ' || to_char(v_start, 'HH24:MI');
    if v_end is not null then
      if v_end::date = v_start::date then
        v_line := v_line || '–' || to_char(v_end, 'HH24:MI');
      else
        v_line := v_line || ' – ' || v_days[extract(dow from v_end)::int + 1] || ', '
          || extract(day from v_end)::int || ' ' || v_months[extract(month from v_end)::int]
          || ' ' || extract(year from v_end)::int || ', ' || to_char(v_end, 'HH24:MI');
      end if;
    end if;
  end if;
  v_line := upper(left(v_line, 1)) || substr(v_line, 2);
  if nullif(btrim(p_location), '') is not null then
    v_line := v_line || ' · ' || btrim(p_location);
  end if;
  v_text := nullif(btrim(p_description), '');
  v_body := v_line;
  if v_text is not null then
    v_body := v_body || E'\n\n' || v_text;
  end if;
  -- R60: an Event description is Formatted Text and may use all the 4000
  -- visible characters an Announcement body has; the date line on top must
  -- not push the Announcement over its limit, visible (4000) or stored (8000).
  -- Lines go from the end, so a cut never lands inside a marker (every marker
  -- pairs within its line), and the blank lines it leaves behind go with them.
  -- The date line stays, and the "…" closes the copy on a line of its own,
  -- counted with the candidate it closes, so it never pushes the copy back
  -- over the limit. Each pass drops at least one line, so the loop ends; it
  -- runs only on a description, since with none (notify_event's call) there
  -- are no lines to count down and the date line is the whole body.
  if v_text is not null
     and (char_length(private.formatted_text_plain(v_body)) > 4000 or char_length(v_body) > 8000) then
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
        or (char_length(private.formatted_text_plain(v_body)) <= 4000 and char_length(v_body) <= 8000);
    end loop;
    -- Ruling 10: a description is never dropped whole. When no whole line
    -- fits (one long paragraph, or a first line over the limit by itself) the
    -- copy keeps the plain words of the first line with any, markers gone, so
    -- no cut can land inside one: cut at the last space inside what the date
    -- line, the blank line and the closing "…" leave of the 4000 characters
    -- (at the budget when the line has no space), then "…" on a line of its
    -- own as above. Plain words are as long stored as visible, so the 8000
    -- stored limit holds with the 4000.
    if v_n = 0 then
      select piece.txt into v_words
        from unnest(v_lines) with ordinality as piece (txt, ord)
       where btrim(piece.txt, E' \t\r') <> ''
       order by piece.ord
       limit 1;
      v_words := btrim(coalesce(private.formatted_text_plain(v_words), ''), E' \t\r');
      v_room := 4000 - char_length(v_line) - 4;
      if char_length(v_words) > v_room then
        v_cut := left(v_words, v_room);
        -- A cut that lands inside a word steps back to the space before it.
        if substr(v_words, v_room + 1, 1) !~ '[ \t]' and v_cut ~ '[ \t]' then
          v_cut := regexp_replace(v_cut, '[ \t]+[^ \t]*$', '');
        end if;
        v_words := btrim(v_cut, E' \t');
      end if;
      v_body := v_line
        || case when v_words <> '' then E'\n\n' || v_words else '' end
        || E'\n…';
    end if;
  end if;
  return v_body;
end;
$function$;

-- private.give_up_task_impl(bigint,text)
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
  v_from public.task_status;
  v_to public.task_status;
begin
  -- 1. Malformed for everyone: no reason, no give-up -- checked before the
  --    gate, so a claimless caller gets PT400 too.
  if p_reason is null or p_reason !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'reason_required';
  end if;
  v_reason := regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  -- #673 (R8): measured as stored (trimmed).
  perform private.require_text_length('reason', v_reason, null, 2000);
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
  -- 7. Mutate: end the Assignment; a public Task goes back to todo with its
  --    Candidate Queue untouched, for the manager to select again (#682, R9).
  --    review_round and returned_to_progress_at stay, as in reopen_task. A
  --    direct Task keeps its status and waits for assign_task_executor.
  perform private.end_task_assignment(v_assignment_id, 'gave_up', v_reason);
  if v_task.assignment_mode = 'public' and v_task.status <> 'todo' then
    update public.tasks
       set status = 'todo', started_at = null
     where id = p_task_id;
    v_from := v_task.status;
    v_to := 'todo';
  end if;
  perform private.log_task_activity(p_task_id, 'gave_up', v_actor, v_assignment_id, v_from, v_to,
    v_reason, jsonb_build_object('reason', v_reason));

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

-- private.reopen_task_impl(bigint,text)
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
  perform private.require_text_length('reason', v_reason, null, 2000);

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

-- private.return_task_to_progress_impl(bigint,text)
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
  perform private.require_text_length('note', v_note, null, 2000);
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

-- private.set_member_role_impl(uuid,member_role,text,uuid)
CREATE OR REPLACE FUNCTION private.set_member_role_impl(p_member_id uuid, p_role member_role, p_reason text DEFAULT NULL::text, p_replacement_id uuid DEFAULT NULL::uuid)
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor       uuid;
  v_reason      text := nullif(regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_member      public.profiles%rowtype;
  v_replacement public.profiles%rowtype;
  v_guarded     public.member_role;
  v_other       public.member_role;
begin
  -- 1. Malformed for every caller, so it is answered ahead of any authority
  --    verdict (conventions section 2).
  if p_role is null then
    raise sqlstate 'PT400' using message = 'invalid_member_role';
  end if;

  -- #724 (ruling R8). Measured exactly as it is stored -- trimmed.
  perform private.require_text_length('reason', v_reason, null, 2000);

  -- A Member cannot replace themselves: they are the one leaving the rank.
  if p_replacement_id = p_member_id then
    raise sqlstate 'PT400' using message = 'replacement_is_target';
  end if;

  -- 2. Authority. A live active BC or Moderator (level 6 and up) decides every
  --    rank, bc and moderator included (ruling R31), and never their own. One
  --    reason string for every denial (conventions section 3). Naming
  --    themselves as the replacement is the one self-change allowed; it is not
  --    refused here because the replacement is never the target.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end;
  if private.actor_level(v_actor) < 6 or v_actor = p_member_id then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  -- 3. Locks, in one statement ordered by id: the target, the actor, the named
  --    replacement, and every live holder of bc and moderator. Everything the
  --    last-holder guard counts below is held, so two leadership members
  --    removing the last two holders at once serialize here instead of each
  --    seeing the other's holder as the one who remains.
  perform 1
     from public.profiles as profile
    where profile.id = p_member_id
       or profile.id = v_actor
       or profile.id = p_replacement_id
       or (profile.role in ('bc', 'moderator') and profile.status = 'activ')
    order by profile.id
      for update;

  select * into v_member
    from public.profiles
   where id = p_member_id;
  if not found then
    raise sqlstate 'PT404' using message = 'member_not_found';
  end if;

  -- The actor re-read under the lock: a demotion or deactivation that
  -- committed after the gate above is seen here.
  perform 1
     from public.profiles as actor
     join public.roles as role on role.id = actor.role
    where actor.id = v_actor
      and actor.status = 'activ'
      and role.level >= 6;
  if not found then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  -- 4. State.
  if v_member.role = p_role then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- The last-holder guard (ruling R31): the change takes bc or moderator from
  -- the last live active Member holding it.
  if v_member.status = 'activ'
     and v_member.role in ('bc', 'moderator')
     and not exists (
       select 1
         from public.profiles as other
        where other.role = v_member.role
          and other.status = 'activ'
          and other.id <> p_member_id
     ) then
    v_guarded := v_member.role;
  end if;

  if v_guarded is null then
    if p_replacement_id is not null then
      raise sqlstate 'PT400' using message = 'replacement_not_needed';
    end if;
  else
    if p_replacement_id is null then
      raise sqlstate 'PT409' using message = 'last_' || v_guarded::text || '_needs_replacement';
    end if;

    select * into v_replacement
      from public.profiles
     where id = p_replacement_id;
    if not found then
      raise sqlstate 'PT404' using message = 'replacement_not_found';
    end if;
    if v_replacement.status <> 'activ' then
      raise sqlstate 'PT400' using message = 'replacement_inactive';
    end if;

    -- The replacement cannot be the last holder of the other leadership rank
    -- either, unless the target is taking that rank in the same call (the two
    -- swap seats and neither rank is left empty).
    v_other := case v_guarded
                 when 'moderator' then 'bc'::public.member_role
                 else 'moderator'::public.member_role
               end;
    if v_replacement.role = v_other
       and p_role <> v_other
       and not exists (
         select 1
           from public.profiles as other
          where other.role = v_other
            and other.status = 'activ'
            and other.id <> p_replacement_id
       ) then
      raise sqlstate 'PT409' using message = 'replacement_is_last_' || v_other::text;
    end if;
  end if;

  -- 5. Write. The replacement first, so the rank is never without a holder
  --    even inside the transaction; each change writes its own role_history
  --    row and Notification naming the real actor.
  if v_guarded is not null then
    perform private.apply_member_role(
      p_replacement_id, v_guarded, v_actor,
      coalesce(v_reason, 'Named replacement for the last ' || v_guarded::text || ' (set_member_role)'));
  end if;

  return private.apply_member_role(
    p_member_id, p_role, v_actor,
    coalesce(v_reason, 'Role changed by leadership (set_member_role)'));
end;
$function$;

-- private.set_member_status_impl(uuid,member_status,text,uuid)
CREATE OR REPLACE FUNCTION private.set_member_status_impl(p_member_id uuid, p_status member_status, p_reason text DEFAULT NULL::text, p_replacement_id uuid DEFAULT NULL::uuid)
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor       uuid;
  v_reason      text := nullif(regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_from        public.member_status;
  v_member      public.profiles%rowtype;
  v_replacement public.profiles%rowtype;
  v_guarded     public.member_role;
  v_other       public.member_role;
begin
  -- 1. Malformed for every caller, so it is answered ahead of any authority
  --    verdict (conventions section 2).
  if p_status is null then
    raise sqlstate 'PT400' using message = 'invalid_member_status';
  end if;

  -- #724 (ruling R8). Measured exactly as it is stored -- trimmed; a blank
  -- reason still falls back to the fixed string below.
  perform private.require_text_length('reason', v_reason, null, 2000);

  -- A Member cannot replace themselves: they are the one leaving `activ`.
  if p_replacement_id = p_member_id then
    raise sqlstate 'PT400' using message = 'replacement_is_target';
  end if;

  -- 2. Authority. A live active BC or Moderator (level 6 and up) sets every
  --    Member's Status, a BC or Moderator holder's included (ruling R31,
  --    #917), and never their own. One reason string for every denial
  --    (conventions section 3). Naming themselves as the replacement is the
  --    one self-change allowed: the replacement is never the target.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end;
  if private.actor_level(v_actor) < 6 or v_actor = p_member_id then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  -- 3. Locks, in one statement ordered by id: the target, the actor, the named
  --    replacement, and every live holder of bc and moderator -- the lock
  --    set_member_role takes, so a rank removal and a deactivation of the last
  --    two holders serialize against each other.
  perform 1
     from public.profiles as profile
    where profile.id = p_member_id
       or profile.id = v_actor
       or profile.id = p_replacement_id
       or (profile.role in ('bc', 'moderator') and profile.status = 'activ')
    order by profile.id
      for update;

  select * into v_member
    from public.profiles
   where id = p_member_id;
  if not found then
    raise sqlstate 'PT404' using message = 'member_not_found';
  end if;

  -- The actor re-read under the lock: a demotion or deactivation that
  -- committed after the gate above is seen here.
  perform 1
     from public.profiles as actor
     join public.roles as role on role.id = actor.role
    where actor.id = v_actor
      and actor.status = 'activ'
      and role.level >= 6;
  if not found then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  -- 4. State.
  v_from := v_member.status;
  if v_from = p_status then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- The last-holder guard (ruling R31): the change takes the last live active
  -- holder of bc or moderator out of `activ`.
  if v_from = 'activ'
     and p_status <> 'activ'
     and v_member.role in ('bc', 'moderator')
     and not exists (
       select 1
         from public.profiles as other
        where other.role = v_member.role
          and other.status = 'activ'
          and other.id <> p_member_id
     ) then
    v_guarded := v_member.role;
  end if;

  if v_guarded is null then
    if p_replacement_id is not null then
      raise sqlstate 'PT400' using message = 'replacement_not_needed';
    end if;
  else
    if p_replacement_id is null then
      raise sqlstate 'PT409' using message = 'last_' || v_guarded::text || '_needs_replacement';
    end if;

    select * into v_replacement
      from public.profiles
     where id = p_replacement_id;
    if not found then
      raise sqlstate 'PT404' using message = 'replacement_not_found';
    end if;
    if v_replacement.status <> 'activ' then
      raise sqlstate 'PT400' using message = 'replacement_inactive';
    end if;

    -- The replacement cannot be the last live holder of the other leadership
    -- rank: the target keeps their rank and only leaves `activ`, so nobody
    -- would take the seat the replacement leaves.
    v_other := case v_guarded
                 when 'moderator' then 'bc'::public.member_role
                 else 'moderator'::public.member_role
               end;
    if v_replacement.role = v_other
       and not exists (
         select 1
           from public.profiles as other
          where other.role = v_other
            and other.status = 'activ'
            and other.id <> p_replacement_id
       ) then
      raise sqlstate 'PT409' using message = 'replacement_is_last_' || v_other::text;
    end if;
  end if;

  -- 5. Write. The replacement's rank first, so the rank is never without a
  --    live holder even inside the transaction; it writes its own
  --    role_history row and Notification naming the real actor.
  if v_guarded is not null then
    perform private.apply_member_role(
      p_replacement_id, v_guarded, v_actor,
      coalesce(v_reason, 'Named replacement for the last ' || v_guarded::text || ' (set_member_status)'));
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
    coalesce(v_reason, 'Status changed by leadership (set_member_status)')
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
$function$;

-- private.guard_announcement_settings()
CREATE OR REPLACE FUNCTION private.guard_announcement_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Named ahead of announcements_min_level_ck, so a direct write hears the rule.
  if new.min_level is null or new.min_level not in (0, 1, 2, 3, 5, 6) then
    raise exception using errcode = '23514', message = 'invalid_announcement_min_level';
  end if;
  if tg_op = 'INSERT' and (select auth.uid()) is not null
     and new.deadline is not null and new.deadline < now() then
    raise exception using errcode = '23514', message = 'deadline_in_past';
  end if;
  -- R45: the Deal Code, trimmed (blank -> none), only on a Deal, at most 80.
  new.code := nullif(regexp_replace(coalesce(new.code, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  if new.code is not null and new.kind is distinct from 'deal' then
    raise sqlstate 'PT400' using message = 'code_only_on_deals';
  end if;
  if char_length(new.code) > 160 then
    raise sqlstate 'PT400' using message = 'deal_code_too_long';
  end if;
  -- R45: a Deal goes from the Organization Group to everyone, never critical
  -- or pinned. Nested, so an Announcement row never plans the Deal test.
  if new.kind = 'deal' then
    if new.audience is distinct from 'org'
       or new.min_level is distinct from 0
       or new.priority is distinct from 'normal'
       or new.pinned is distinct from false
       or not exists (select 1 from public.groups as grp
                       where grp.id = new.group_id and grp.is_organization) then
      raise exception using errcode = '23514', message = 'invalid_deal_settings';
    end if;
  end if;
  return new;
end;
$function$;

-- private.guard_announcement_text()
CREATE OR REPLACE FUNCTION private.guard_announcement_text()
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
  elsif char_length(new.title) > 240 then
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
    if jsonb_array_length(new.links) > 10 then
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

-- private.guard_profile_nickname()
CREATE OR REPLACE FUNCTION private.guard_profile_nickname()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_nickname text;
begin
  v_nickname := nullif(btrim(normalize(new.nickname, nfc)), '');
  if v_nickname is not null then
    if char_length(v_nickname) < 2 then
      raise exception using errcode = '23514', message = 'nickname_too_short';
    elsif char_length(v_nickname) > 48 then
      raise exception using errcode = '23514', message = 'nickname_too_long';
    elsif v_nickname !~ '^[A-Za-z0-9À-ÖØ-öø-žȘ-ț ._-]+$' then
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

-- private.guard_profile_text()
CREATE OR REPLACE FUNCTION private.guard_profile_text()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.avatar_color is not null and new.avatar_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception using errcode = '23514', message = 'invalid_avatar_color';
  end if;
  if char_length(new.full_name) > 240 then
    raise exception using errcode = '23514', message = 'full_name_too_long';
  end if;
  return new;
end;
$function$;

-- private.is_http_url(text)
CREATE OR REPLACE FUNCTION private.is_http_url(p_value text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  select p_value is not null
     and btrim(p_value) ~ '^https?://'
     and char_length(btrim(p_value)) <= 4096;
$function$;

-- private.notify(uuid[],noti_kind,text,text,bigint,text,uuid,text,boolean)
CREATE OR REPLACE FUNCTION private.notify(p_recipients uuid[], p_kind noti_kind, p_title text, p_body text, p_task_id bigint, p_dedupe_key text, p_actor uuid, p_link text DEFAULT NULL::text, p_critical boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_link  text;
  v_count integer;
  -- Security pass 2026-09-27 (L1): clipped to notifications_title_length_ck /
  -- notifications_body_length_ck. A Notification is a side effect of a
  -- command, so an over-long composed text is shortened, never refused
  -- (a refusal here would roll back the command that caused it).
  v_title text := left(p_title, 400);
  v_body  text := left(p_body, 4000);
begin
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_notification_title';
  end if;

  -- #843 (D1): the Tracker opens a Task at /tracker?task=<id>; /tracker/<id>
  -- has no route and fell through to Acasă.
  v_link := coalesce(p_link, case when p_task_id is not null then '/tracker?task=' || p_task_id::text else null end);

  -- De-duplicate the recipient array, drop nulls, drop the actor (never
  -- echo an action back to its author -- ADR-0007), and keep only members
  -- whose live profile is activ: a deactivated Member keeps their
  -- auth.uid() and profiles row (house rule 12) but stops receiving new
  -- Notifications the moment they are deactivated.
  if p_dedupe_key is not null then
    insert into public.notifications as notification (
      member_id, kind, title, body, link, critical, task_id, dedupe_key
    )
    select recipient.member_id, p_kind, v_title, v_body, v_link, coalesce(p_critical, false), p_task_id, p_dedupe_key
      from (
        select distinct member_id
          from unnest(p_recipients) as u (member_id)
         where member_id is not null
           and member_id is distinct from p_actor
      ) as recipient
      join public.profiles as profile on profile.id = recipient.member_id
     where profile.status = 'activ'
    on conflict (member_id, dedupe_key) where not read and dedupe_key is not null
    do update
       set title      = excluded.title,
           body       = excluded.body,
           created_at = now();
  else
    insert into public.notifications (
      member_id, kind, title, body, link, critical, task_id, dedupe_key
    )
    select recipient.member_id, p_kind, v_title, v_body, v_link, coalesce(p_critical, false), p_task_id, null
      from (
        select distinct member_id
          from unnest(p_recipients) as u (member_id)
         where member_id is not null
           and member_id is distinct from p_actor
      ) as recipient
      join public.profiles as profile on profile.id = recipient.member_id
     where profile.status = 'activ';
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- private.reject_completed_work_request_impl(bigint,text)
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
  perform private.require_text_length('note', v_note, null, 2000);
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

  -- #1012 (R37): keyed request:<id>, so the requester's Notification carries
  -- the subject completed_work_request:<id> and opening the Request reads it.
  perform private.notify(array[v_request.requester_id], 'task'::public.noti_kind,
    'Cerere respinsă: ' || left(v_request.description, 60),
    v_note,
    null, 'request:' || p_request_id::text, v_actor, '/cereri');

  select * into v_request from public.completed_work_requests where id = p_request_id;
  return v_request;
end;
$function$;

-- private.reject_promotion_candidate_impl(bigint,text)
CREATE OR REPLACE FUNCTION private.reject_promotion_candidate_impl(p_candidate_id bigint, p_reason text)
 RETURNS promotion_candidates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reason    text;
  v_actor     uuid;
  v_candidate public.promotion_candidates%rowtype;
begin
  -- 1. Malformed for every caller.
  if p_reason is null or p_reason !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_rejection_reason';
  end if;
  v_reason := pg_catalog.regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  perform private.require_text_length('reason', v_reason, null, 1000);

  -- 2. The gate.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'promotion_candidate_manage_forbidden';
  end;
  if coalesce(private.actor_level(v_actor), -1) < 6 then
    raise exception using errcode = '42501', message = 'promotion_candidate_manage_forbidden';
  end if;

  -- 3. The target under lock.
  select * into v_candidate
    from public.promotion_candidates as candidate
   where candidate.id = p_candidate_id
   for update;
  if not found then
    raise sqlstate 'PT404' using message = 'promotion_candidate_not_found';
  end if;

  -- 4. State.
  if v_candidate.decision is not null then
    raise sqlstate 'PT409' using message = 'promotion_candidate_decided';
  end if;

  -- 5. Write. No Notification: the decision is BC's own.
  update public.promotion_candidates
     set decision = 'rejected',
         decided_at = now(),
         decided_by = v_actor,
         reason = v_reason
   where id = p_candidate_id
  returning * into v_candidate;

  return v_candidate;
end;
$function$;

-- private.require_attached_link(text,text)
CREATE OR REPLACE FUNCTION private.require_attached_link(p_label text, p_url text)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
  -- The caller passes both values already trimmed, blank -> null.
  if (p_label is null) <> (p_url is null) then
    raise sqlstate 'PT400' using message = 'link_incomplete';
  end if;
  if p_label is null then
    return;
  end if;
  if char_length(p_label) > 120 then
    raise sqlstate 'PT400' using message = 'link_label_too_long';
  end if;
  if char_length(p_url) > 4096 then
    raise sqlstate 'PT400' using message = 'link_url_too_long';
  end if;
  if not private.is_http_url(p_url) then
    raise sqlstate 'PT400' using message = 'link_url_invalid';
  end if;
end;
$function$;

-- private.require_attached_links(jsonb,text,text)
CREATE OR REPLACE FUNCTION private.require_attached_links(p_links jsonb, p_label text DEFAULT NULL::text, p_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
  if jsonb_array_length(p_links) > 10 then
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
$function$;

-- private.require_formatted_text_length(text,text)
CREATE OR REPLACE FUNCTION private.require_formatted_text_length(p_field text, p_value text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  -- Blank is the caller's *_required (or no text at all), as in require_text_length.
  if p_value is null or p_value !~ '[^[:space:]]' then
    return;
  end if;
  if char_length(p_value) > 8000 then
    raise sqlstate 'PT400' using message = p_field || '_too_long';
  end if;
  if char_length(private.formatted_text_plain(p_value)) > 4000 then
    raise sqlstate 'PT400' using message = p_field || '_too_long';
  end if;
end;
$function$;

-- private.require_rejection_reason(text)
CREATE OR REPLACE FUNCTION private.require_rejection_reason(p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise sqlstate 'PT400' using message = 'rejection_reason_required';
  end if;
  if char_length(btrim(p_reason)) > 2000 then
    raise sqlstate 'PT400' using message = 'rejection_reason_too_long';
  end if;
  return btrim(p_reason);
end;
$function$;

-- private.run_role_evaluation_impl(text,date,date,text,integer,integer,date)
CREATE OR REPLACE FUNCTION private.run_role_evaluation_impl(p_kind text, p_from date, p_to date, p_name text, p_floor integer, p_percent integer, p_cutoff date)
 RETURNS TABLE(role_evaluation_id bigint, candidates integer, retention_signals integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_name        text;
  v_actor       uuid;
  v_today       date;
  v_threshold   public.promotion_thresholds%rowtype;
  v_settings    public.evaluation_settings%rowtype;
  v_cutoff      date;
  v_rows        jsonb;
  v_line        integer;
  v_ranked      integer;
  v_evaluated   integer;
  v_share_was   integer;
  v_run_id      bigint;
  v_candidates  integer := 0;
  v_signals     integer := 0;
  v_leaders     uuid[];
  v_ag_group_id bigint;
  v_span        text;
  v_row         record;
begin
  -- 1. Malformed for every caller: answered before the gate.
  if p_kind is null or p_kind not in ('voluntar_activ', 'adunarea_generala') then
    raise sqlstate 'PT400' using message = 'invalid_role_evaluation_kind';
  end if;
  if p_name is null or p_name !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_role_evaluation_name';
  end if;
  v_name := pg_catalog.regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  perform private.require_text_length('name', v_name, 3, 240);
  if p_from is null or p_to is null or p_to < p_from then
    raise sqlstate 'PT400' using message = 'invalid_date_range';
  end if;
  v_today := (now() at time zone 'Europe/Bucharest')::date;
  -- #1131 (audit M10): complete days only -- today's later awards would fall
  -- between this run and the live window that opens at period_to + 1, and
  -- role_evaluation_ranking would recompute the sheet over them.
  if p_to >= v_today then
    raise sqlstate 'PT400' using message = 'date_range_in_future';
  end if;
  -- R58: the values the run ranks with, judged as the core judges them.
  if p_floor is null or p_floor < 1 then
    raise sqlstate 'PT400' using message = 'invalid_eligibility_floor';
  end if;
  if p_percent is null or p_percent < 1 or p_percent > 100 then
    raise sqlstate 'PT400' using message = 'invalid_percent';
  end if;
  if p_kind = 'voluntar_activ' and p_cutoff is null then
    raise sqlstate 'PT400' using message = 'membership_cutoff_not_set';
  end if;
  -- A cutoff is a day that has begun, as set_membership_cutoff demands of
  -- the value in Setări the page sends. The Adunarea Generală kind has no
  -- cutoff, so it is not judged for one.
  if p_kind = 'voluntar_activ' and p_cutoff > v_today then
    raise sqlstate 'PT400' using message = 'invalid_membership_cutoff';
  end if;
  -- The Adunarea Generală kind has no Membership Cutoff Date: one passed
  -- with it is neither used nor recorded.
  v_cutoff := case when p_kind = 'voluntar_activ' then p_cutoff end;

  -- 2. The gate: claims and a live activ Profile, then BC or Moderator.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'role_evaluation_manage_forbidden';
  end;
  if coalesce(private.actor_level(v_actor), -1) < 6 then
    raise exception using errcode = '42501', message = 'role_evaluation_manage_forbidden';
  end if;

  -- 3. Runs, threshold, share and settings edits serialise here, then the
  --    kind's threshold row, then the settings row (the share it may write).
  --    R58: no line in force is needed -- the run measures against the line
  --    it computes, so a kind's first run needs none.
  perform pg_catalog.pg_advisory_xact_lock(47, 1);
  select * into v_threshold
    from public.promotion_thresholds as setting
   where setting.kind = p_kind
   for no key update;
  select * into v_settings
    from public.evaluation_settings as setting
   where setting.id = 1
   for no key update;

  -- 4. Role changes wait for this run: set_member_role locks the Profile `for
  -- update` and its role_history trigger then closes candidates, so taking
  -- the population's Profiles `for key share` here (Profiles first,
  -- candidates after -- the order set_member_role uses) keeps the ranking
  -- below from listing a Member promoted underneath it, and the candidate
  -- insert's FK check from deadlocking against that promotion.
  perform 1
     from public.profiles as profile
    where profile.status = 'activ'
      and profile.role in ('recrut', 'voluntar', 'activ', 'vot')
    order by profile.id
      for key share;

  -- 5. The ranking, read once (one snapshot for every step below), with the
  --    values this run was given: the rows a Simulation with the same values
  --    showed.
  select coalesce(jsonb_agg(to_jsonb(evaluated)), '[]'::jsonb) into v_rows
    from private.role_evaluation_rows(p_kind, p_from, p_to, p_floor, p_percent, v_cutoff) as evaluated;

  -- The line every row carries (null when nobody reached the Floor) and the
  -- two counts; an empty population has no row, and counts nothing.
  select ranked.line, ranked.ranked_count, ranked.evaluated_count
    into v_line, v_ranked, v_evaluated
    from jsonb_to_recordset(v_rows) as ranked (line integer, ranked_count integer, evaluated_count integer)
   limit 1;

  insert into public.role_evaluations (
    kind, name, period_from, period_to, run_by, threshold_used, threshold_computed, ranked_count,
    eligibility_floor, percent_used, membership_cutoff, evaluated_count, members_recorded
  ) values (
    p_kind, v_name, p_from, p_to, v_actor, v_threshold.threshold, v_line, coalesce(v_ranked, 0),
    p_floor, p_percent, v_cutoff, coalesce(v_evaluated, 0), true
  )
  returning id into v_run_id;

  -- #1146 (audit M11): the population this run judged, as the ranking stood
  -- at the run -- one row per evaluated Member, read back by
  -- role_evaluation_ranking(id) whatever the Roles and the ledger do after.
  insert into public.role_evaluation_members
    (role_evaluation_id, member_id, role_at_run, points, rank, below_line, listable)
  select v_run_id, ranked.member_id, ranked.role, ranked.task_points, ranked.rank,
         ranked.ranked and not ranked.inside, ranked.listable
    from jsonb_to_recordset(v_rows) as ranked (
           member_id uuid, role public.member_role, task_points integer, ranked boolean,
           rank integer, inside boolean, listable boolean);

  v_span := pg_catalog.to_char(p_from, 'DD.MM.YYYY') || '–' || pg_catalog.to_char(p_to, 'DD.MM.YYYY');

  select array_agg(profile.id order by profile.id) into v_leaders
    from public.profiles as profile
    join public.roles as role on role.id = profile.role
   where profile.status = 'activ'
     and role.level >= 6;

  -- 6. Promotion Candidates (Voluntar Activ kind): every undecided row --
  --    the previous run's and the live ones -- is superseded; every Voluntar
  --    who joined on or before the cutoff and is inside the line this run
  --    computed gets a row measured against that line (R58 decision 17: the
  --    line in force before plays no part) and one Notification per
  --    BC/Moderator. tenure_since records the join date measured.
  if p_kind = 'voluntar_activ' then
    update public.promotion_candidates as candidate
       set decision = 'superseded',
           decided_at = now(),
           decided_by = v_actor
     where candidate.decision is null;

    for v_row in
      select ranked.member_id,
             ranked.task_points,
             member.joined_at,
             coalesce(member.nickname, member.full_name) as member_name
        from jsonb_to_recordset(v_rows) as ranked (
               member_id uuid, task_points integer, inside boolean, listable boolean)
        join public.profiles as member on member.id = ranked.member_id
       where ranked.listable
         and ranked.inside
       order by ranked.member_id
    loop
      insert into public.promotion_candidates (role_evaluation_id, member_id, task_points, tenure_since, threshold_used)
      values (v_run_id, v_row.member_id, v_row.task_points, v_row.joined_at, v_line);
      v_candidates := v_candidates + 1;

      perform private.notify(
        v_leaders, 'system',
        format('Candidat la promovare: %s', v_row.member_name),
        format('%s are %s puncte de task în evaluarea „%s” (%s), cel puțin pragul de promovare de %s puncte, '
               'intrat în OSUBB până la %s. Nu este promovat automat: îl poți promova în Voluntar Activ '
               'din panoul de roluri sau respinge din Portofoliu Interne.',
               v_row.member_name, v_row.task_points, v_name, v_span, v_line,
               pg_catalog.to_char(v_cutoff, 'DD.MM.YYYY')),
        null, 'promotion_candidate:' || v_run_id::text || ':' || v_row.member_id::text,
        null, '/administrare/portofoliu-interne');
    end loop;
  end if;

  -- 7. Retention Signals: the kind's open points-based Signals (below_line,
  --    below_floor) are superseded -- a live not_ubb_student Signal is not
  --    the run's -- and every holder of the kind (Voluntar Activ and Voluntar
  --    cu Drept de Vot for the Voluntar Activ kind, Voluntar cu Drept de Vot
  --    for the Adunarea Generală kind) who is not inside the line gets a row:
  --    below_line when ranked under it, below_floor when under the Floor
  --    (and always when nobody was ranked, so no line exists), each storing
  --    the figure it fell under: the line, or the Floor. Nothing
  --    changes; BC, the Moderator and the Adunarea Generală's Group
  --    Responsibles are told -- but only those at level 5 or above, the
  --    level /tracker/membru/<id> requires (#843, D11): a Responsible below it
  --    would be sent to a page that turns them away. The link stays the
  --    Member's tracker page, which they can open; Portofoliu Interne is BC's
  --    and the Moderator's only.
  update public.retention_signals as signal
     set closed_at = now(),
         closed_as = 'superseded'
   where signal.kind = p_kind
     and signal.closed_at is null
     and signal.reason in ('below_line', 'below_floor');

  select case when setting.value ~ '^[1-9][0-9]{0,17}$' then setting.value::bigint end
    into v_ag_group_id
    from public.org_settings as setting
   where setting.key = 'adunarea_generala_group_id';

  for v_row in
    select ranked.member_id,
           ranked.role,
           ranked.task_points,
           ranked.ranked,
           role.name as role_name,
           coalesce(member.nickname, member.full_name) as member_name
      from jsonb_to_recordset(v_rows) as ranked (
             member_id uuid, role public.member_role, task_points integer, ranked boolean, inside boolean)
      join public.roles as role on role.id = ranked.role
      join public.profiles as member on member.id = ranked.member_id
     where (ranked.role = 'vot' or (p_kind = 'voluntar_activ' and ranked.role = 'activ'))
       and not ranked.inside
     order by ranked.member_id
  loop
    insert into public.retention_signals (
      kind, member_id, role_at_listing, reason, task_points, threshold_used, role_evaluation_id
    ) values (
      p_kind, v_row.member_id, v_row.role,
      case when v_row.ranked then 'below_line' else 'below_floor' end,
      v_row.task_points, case when v_row.ranked then v_line else p_floor end, v_run_id
    );
    v_signals := v_signals + 1;
    perform private.notify(
      array(select recipient.id
              from (select unnest(v_leaders)
                    union
                    select held.member_id
                      from public.group_members as held
                     where held.group_id = v_ag_group_id
                       and held.group_role = 'responsible') as recipient (id)
             where recipient.id <> v_row.member_id
               and coalesce(private.actor_level(recipient.id), -1) >= 5
             order by recipient.id),
      'system',
      format('Semnal de retenție: %s', v_row.member_name),
      format('%s (%s) are %s puncte de task în evaluarea „%s” (%s), %s. '
             'Rolul nu se retrage automat: decizia îi aparține BC.',
             v_row.member_name, v_row.role_name, v_row.task_points, v_name, v_span,
             case when not v_row.ranked
                  then format('sub pragul minim de %s puncte', p_floor)
                  when p_kind = 'adunarea_generala'
                  then format('sub pragul Adunării Generale de %s puncte', v_line)
                  else format('sub pragul de promovare de %s puncte', v_line)
             end),
      null, 'retention_signal:' || v_run_id::text || ':' || v_row.member_id::text,
      null, '/tracker/membru/' || v_row.member_id::text);
  end loop;

  -- 8. The hand-over: the line this run computed is in force until the
  --    kind's next run (BC may still edit it by hand). It is never below the
  --    Floor, itself at least 1; a run that ranked nobody has no line and
  --    hands nothing over.
  if v_line is not null and v_line is distinct from v_threshold.threshold then
    update public.promotion_thresholds
       set threshold = v_line,
           updated_by = null
     where kind = p_kind;

    insert into public.promotion_threshold_changes (
      kind, from_value, to_value, source, changed_by, role_evaluation_id
    ) values (
      p_kind, v_threshold.threshold, v_line, 'role_evaluation', null, v_run_id
    );
  end if;

  -- 9. The share this run used becomes the share in force (R58 decision 7,
  --    amended 2026-10-20): the kind's Procent, written once and logged once
  --    naming the run. updated_by is cleared, as the hand-over clears the
  --    threshold's: the log names the run. The Eligibility Floor and the
  --    Membership Cutoff Date are Setări's alone (set_eligibility_floor,
  --    set_membership_cutoff) and are never written back: a run carrying a
  --    value BC changed in Setări after the Simulation would silently revert
  --    that edit. The run records the Floor, share and cutoff it used in its
  --    own role_evaluations row, so its history stays exact.
  v_share_was := case p_kind when 'voluntar_activ' then v_settings.activ_percent else v_settings.vot_percent end;
  if p_percent is distinct from v_share_was then
    update public.evaluation_settings
       set activ_percent = case when p_kind = 'voluntar_activ' then p_percent else activ_percent end,
           vot_percent = case when p_kind = 'adunarea_generala' then p_percent else vot_percent end,
           updated_by = null
     where id = 1;

    insert into public.promotion_threshold_changes (
      kind, field, from_value, to_value, source, changed_by, role_evaluation_id
    ) values (
      p_kind, 'percent', v_share_was, p_percent, 'role_evaluation', null, v_run_id
    );
  end if;

  -- 10. #983: the new window opens at p_to + 1 and may already hold points
  --    (a range that ended earlier); whoever is at the threshold in it is
  --    listed now. The run holds (47, 1), so the refresh's shared try-lock
  --    (its own session's) succeeds.
  perform private.refresh_promotion_candidates();

  return query select v_run_id, v_candidates, v_signals;
end;
$function$;

-- private.set_adherence_message_impl(text,text,text,text,boolean)
CREATE OR REPLACE FUNCTION private.set_adherence_message_impl(p_title text, p_body text, p_link_url text, p_link_label text, p_ask_again boolean)
 RETURNS adherence_message
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor   uuid;
  v_title   text;
  v_body    text;
  v_url     text;
  v_label   text;
  v_current public.adherence_message%rowtype;
  v_bump    boolean;
begin
  -- 1. Malformed for every caller. Each text trimmed, blank -> null.
  v_title := nullif(regexp_replace(coalesce(p_title, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_body  := nullif(regexp_replace(coalesce(p_body, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_url   := nullif(regexp_replace(coalesce(p_link_url, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_label := nullif(regexp_replace(coalesce(p_link_label, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  -- A heading and a body go together; both blank turns the message off.
  if v_body is not null and v_title is null then
    raise sqlstate 'PT400' using message = 'title_required';
  end if;
  if v_title is not null and v_body is null then
    raise sqlstate 'PT400' using message = 'body_required';
  end if;
  perform private.require_text_length('title', v_title, null, 240);
  perform private.require_formatted_text_length('body', v_body);
  perform private.require_attached_link(v_label, v_url);

  -- 2. The gate: claims and a live activ Profile, then BC or Moderator.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'adherence_message_manage_forbidden';
  end;
  if coalesce(private.actor_level(v_actor), -1) < 6 then
    raise exception using errcode = '42501', message = 'adherence_message_manage_forbidden';
  end if;

  -- 3. The one row.
  select * into v_current
    from public.adherence_message as message
   where message.id = 1
     for no key update;

  -- 4. State. A new version is due when the result is a message and BC asks
  -- everyone again, or there was no message before.
  v_bump := v_body is not null and (coalesce(p_ask_again, false) or v_current.body is null);
  if not v_bump
     and v_current.title is not distinct from v_title
     and v_current.body is not distinct from v_body
     and v_current.link_url is not distinct from v_url
     and v_current.link_label is not distinct from v_label then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- 5. Write.
  update public.adherence_message
     set title      = v_title,
         body       = v_body,
         link_url   = v_url,
         link_label = v_label,
         version    = version + case when v_bump then 1 else 0 end,
         updated_by = v_actor
   where id = 1
  returning * into v_current;

  return v_current;
end;
$function$;

-- private.set_group_role_impl(bigint,uuid,text,text)
CREATE OR REPLACE FUNCTION private.set_group_role_impl(p_group_id bigint, p_member_id uuid, p_group_role text, p_position_title text DEFAULT NULL::text)
 RETURNS group_members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor        uuid;
  v_parent_id    bigint;
  v_manager_tier boolean;
  v_group        public.groups%rowtype;
  v_row          public.group_members%rowtype;
  v_current      text;
  v_title        text := nullif(btrim(p_position_title), '');
  v_display      text;
  v_old_display  text;
begin
  -- 1. Malformed for every caller, so it is answered ahead of any authority
  --    verdict (conventions section 2). group_members_role_ck holds the same
  --    vocabulary; group_members_position_title_ck rejects a blank title.
  if p_group_role is null or p_group_role not in ('manager', 'responsible', 'member') then
    raise sqlstate 'PT400' using message = 'invalid_group_role';
  end if;
  if p_position_title is not null and v_title is null then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;
  -- Security pass 2026-09-27 (L1): group_members_position_title_length_ck.
  perform private.require_text_length('position_title', v_title, null, 160);
  -- A Group Responsible is always shown under a custom display name
  -- (CONTEXT.md, ADR-0009 Group Roles), so the name is part of the
  -- appointment and not an afterthought. A Group Manager's position is named
  -- by a GROUP setting (groups.manager_title — BCE, Coordonator Principal),
  -- which is update_group's to write; since #967 each Manager MAY also carry
  -- a function name of their own under it, judged by the two checks above.
  -- Ordinary membership has none: sending it a title here is the caller
  -- misunderstanding the model, not a value to silently drop.
  if p_group_role = 'responsible' and v_title is null then
    raise sqlstate 'PT400' using message = 'position_title_required';
  end if;
  if p_group_role = 'member' and v_title is not null then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;

  -- 2. Which tier decides. Read unlocked first: the gate must run before any
  --    lock on public.groups (shape 6), and both inputs it needs — whether
  --    the Group is a root and whether this call grants or removes `manager`
  --    — are re-read under the lock at step 4, where an escalation is caught.
  select grp.parent_id into v_parent_id
    from public.groups as grp where grp.id = p_group_id;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  select existing.group_role into v_current
    from public.group_members as existing
   where existing.group_id = p_group_id and existing.member_id = p_member_id;
  v_manager_tier := p_group_role = 'manager' or coalesce(v_current = 'manager', false);

  -- 3-4. Gate, then locks, then the same question again under them. The loop
  --      runs twice only when the answer changed while the gate ran — a
  --      concurrent promotion to `manager` committing between the unlocked
  --      read and the lock — in which case the STRONGER tier is re-run. The
  --      reverse never needs re-running: a parent's Group Manager holds the
  --      position in every Group below (ADR-0009), and level >= 6 passes
  --      everywhere, so the strong gate always implies the weak one.
  for v_attempt in 1 .. 2 loop
    if v_manager_tier then
      if v_parent_id is null then
        -- A root Group's Managers are BC's and the Moderator's appointment.
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
        -- The PARENT's Managers appoint a Child Group's (shape 1).
        v_actor := private.require_group_manager(v_parent_id);
      end if;
    else
      v_actor := private.require_group_manager(p_group_id);
    end if;

    select grp.* into v_group
      from public.groups as grp
     where grp.id = p_group_id
     for no key update;
    if not found then
      raise exception using errcode = '42501', message = 'group_manage_forbidden';
    end if;
    select existing.* into v_row
      from public.group_members as existing
     where existing.group_id = p_group_id and existing.member_id = p_member_id
     for update of existing;
    v_current := v_row.group_role;

    exit when v_manager_tier
           or not (p_group_role = 'manager' or coalesce(v_current = 'manager', false));
    v_manager_tier := true;
  end loop;

  if v_group.status <> 'active' then
    raise sqlstate 'PT409' using message = 'group_archived';
  end if;

  -- 5. The write the caller asked for, judged against the loaded row.
  if v_current is null then
    -- No roster row yet: this IS an Appointment, so it goes through the one
    -- insert path (shape 3), which re-checks eligibility and Minimum Level,
    -- answers automatic_group_has_no_roster_members for an ordinary row on an
    -- Automatic-Membership Group, and writes the target's Notification.
    return private.appoint_group_member(
      p_group_id, p_member_id, v_actor, p_group_role, v_title);
  end if;

  if (p_group_role, v_title) is not distinct from (v_current, v_row.position_title) then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- Shape 4: a write that PLACES the Member in a position they do not hold
  --  — any appointment — demands a live, eligible Member; a demotion or a
  -- removal never does, or an inactive Group Manager could be neither demoted
  -- here nor removed by remove_group_member.
  if p_group_role in ('manager', 'responsible') then
    perform 1 from public.profiles as target
      where target.id = p_member_id and target.status = 'activ'
      for share of target;
    if not found then
      raise sqlstate 'PT400' using message = 'group_member_not_eligible';
    end if;
    if coalesce(private.actor_level(p_member_id), -1) < v_group.min_level then
      raise sqlstate 'PT400' using message = 'group_member_below_min_level';
    end if;
  end if;

  -- #962: a Group Responsible's position is named by their own title, then
  -- by the Group setting groups.responsible_title; a Group Manager's by their
  -- own title (#967), then groups.manager_title.
  if v_current = 'responsible' then
    v_old_display := coalesce(v_row.position_title,
                              nullif(btrim(v_group.responsible_title), ''),
                              'responsabil');
  else
    v_old_display := coalesce(v_row.position_title,
                              nullif(btrim(v_group.manager_title), ''),
                              'coordonator de grup');
  end if;

  if p_group_role = 'member' and v_group.automatic_membership then
    -- Shape 5: the row goes rather than becoming an ordinary one. The Member
    -- keeps their place in the Group through the derived roster.
    delete from public.group_members as membership
     where membership.group_id = p_group_id and membership.member_id = p_member_id;
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Numire încheiată în ' || v_group.name,
      'Nu mai ești ' || v_old_display || ' în grupul ' || v_group.name || '.',
      null, null, v_actor, '/grupuri/' || p_group_id::text);
    return null;
  end if;

  update public.group_members as membership
     set group_role     = p_group_role,
         position_title = v_title
   where membership.group_id = p_group_id and membership.member_id = p_member_id
  returning * into v_row;

  if p_group_role = 'member' then
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Numire încheiată în ' || v_group.name,
      'Nu mai ești ' || v_old_display || ' în grupul ' || v_group.name
        || ', dar rămâi membru.',
      null, null, v_actor, '/grupuri/' || p_group_id::text);
  else
    if p_group_role = 'responsible' then
      v_display := coalesce(v_title, nullif(btrim(v_group.responsible_title), ''), 'responsabil');
    else
      v_display := coalesce(v_title, nullif(btrim(v_group.manager_title), ''), 'coordonator de grup');
    end if;
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Numire în ' || v_group.name,
      'Ai fost numit ' || v_display || ' în grupul ' || v_group.name || '.',
      null, null, v_actor, '/grupuri/' || p_group_id::text);
  end if;

  return v_row;
end;
$function$;

-- private.set_org_setting_impl(text,text)
CREATE OR REPLACE FUNCTION private.set_org_setting_impl(p_key text, p_value text)
 RETURNS org_settings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor       uuid;
  v_actor_level integer;
  v_value       text;
  v_setting     public.org_settings%rowtype;
begin
  -- 1. Malformed for every caller, so answered ahead of any authority verdict.
  v_value := nullif(regexp_replace(coalesce(p_value, ''),
                                   '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_text_length('value', v_value, null, 4096);
  -- #512, #824: a Group id is a positive integer that fits a bigint.
  if p_key in ('adunarea_generala_group_id', 'board_group_id')
     and v_value is not null
     and v_value !~ '^[1-9][0-9]{0,17}$' then
    raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
  end if;
  -- #771: the Privacy Notice version is dotted numbers and is never cleared.
  if p_key = 'privacy_notice_version'
     and (v_value is null or v_value !~ '^[0-9]{1,3}(\.[0-9]{1,3}){0,2}$') then
    raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
  end if;
  -- #775: the Email Digest quota is a whole number 0-99999 and is never
  -- cleared (0 pauses the digest).
  if p_key = 'email_daily_quota'
     and (v_value is null or v_value !~ '^(0|[1-9][0-9]{0,4})$') then
    raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
  end if;

  -- 2. Authority: BC or Moderator, live, held for the transaction.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'org_settings_manage_forbidden';
  end;

  select role.level into v_actor_level
    from public.profiles as actor
    join public.roles as role on role.id = actor.role
   where actor.id = v_actor
     and actor.status = 'activ'
   for share of actor;
  if coalesce(v_actor_level, -1) < 6 then
    raise exception using errcode = '42501', message = 'org_settings_manage_forbidden';
  end if;

  -- 3. Target under lock.
  select * into v_setting
    from public.org_settings
   where key = p_key
   for update;
  if not found then
    raise sqlstate 'PT404' using message = 'org_setting_not_found';
  end if;
  -- #512, #824: the Adunarea Generală and the board are existing, active
  -- Groups, and the board a Private one. `for key share` keeps the row from being deleted under the write
  -- without blocking the `for no key update` every Group command takes on a
  -- Group row.
  if p_key in ('adunarea_generala_group_id', 'board_group_id') and v_value is not null then
    perform 1
      from public.groups as grp
     where grp.id = v_value::bigint
       and grp.status = 'active'
       and (p_key <> 'board_group_id' or grp.is_private)
       for key share;
    if not found then
      raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
    end if;
  end if;

  -- 4. State.
  if v_value is not distinct from v_setting.value then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- 5. Write.
  update public.org_settings
     set value = v_value,
         updated_by = v_actor
   where key = p_key
  returning * into v_setting;

  return v_setting;
end;
$function$;

-- private.submit_task_for_review_impl(bigint,text,text,text)
CREATE OR REPLACE FUNCTION private.submit_task_for_review_impl(p_task_id bigint, p_note text, p_link_label text, p_link_url text)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_actor_name text;
  v_task public.tasks%rowtype;
  v_assignment_id bigint;
  v_note text;
  v_first_line text;
  v_link_label text;
  v_link_url text;
  v_details jsonb := '{}'::jsonb;
begin
  -- 1. #684 (R7/R8): malformed for every caller, measured as stored
  --    (trimmed, blank -> null), before the gate.
  v_note := nullif(regexp_replace(coalesce(p_note, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_text_length('note', v_note, null, 2000);
  v_link_label := nullif(regexp_replace(coalesce(p_link_label, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_link_url := nullif(regexp_replace(coalesce(p_link_url, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_attached_link(v_link_label, v_link_url);
  -- 2. Gate + visibility.
  v_actor := private.require_task_visible(p_task_id);
  -- 3. Lock the target (always the first row locked).
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- 4. Authority under lock: only the active Executor. Same Umbrella
  --    fallthrough as start_task.
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
  if v_link_label is not null then
    v_details := jsonb_build_object('link_label', v_link_label, 'link_url', v_link_url);
  end if;
  -- The Submission Note lives on the history row the reviewer reads first.
  perform private.log_task_activity(p_task_id, 'submitted', v_actor, v_assignment_id,
    'in_progress'::public.task_status, 'in_review'::public.task_status, v_note, v_details);
  select coalesce(profile.nickname, profile.full_name) into v_actor_name
    from public.profiles as profile where profile.id = v_actor;
  -- The note's first line, cut at 120 characters, follows the pinned copy.
  if v_note is not null then
    v_first_line := regexp_replace(split_part(v_note, E'\n', 1), '[[:space:]]+$', '', 'g');
    if char_length(v_first_line) > 120 then
      v_first_line := left(v_first_line, 120) || '…';
    end if;
  end if;
  perform private.notify(
    array(select private.task_managers(p_task_id, v_actor)),
    'task'::public.noti_kind,
    'De verificat: ' || v_task.title,
    v_actor_name || ' a trimis taskul spre verificare.'
      || coalesce(' ' || v_first_line, ''),
    p_task_id, null, v_actor);
  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$function$;
