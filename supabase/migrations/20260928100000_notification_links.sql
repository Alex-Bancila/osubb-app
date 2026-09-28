-- #843 (frontend QA pass 2026-09-28; Alex's rulings of 2026-09-28): every
-- server-side change the QA fixes need, in one migration.
--
-- Notification links that open their target:
--   D1  Task Notifications linked /tracker/<id>, which has no route (the
--       catch-all sent the Member to Acasă). private.notify now derives
--       /tracker?task=<id>; the rows already delivered are rewritten below.
--       Web Push and the Email Digest read notifications.link at claim time
--       (public.claim_push_deliveries, public.claim_email_digests), so no
--       queue stores a copy; pushes and emails already SENT are rescued by the
--       client alias route of #844.
--   D5  Event changed/cancelled -> /calendar?event=<id>.
--   D6  "Cerere de înscriere" -> /administrare/grupuri/<id>?tab=cereri (#853
--       makes the Group page read ?tab=).
--   D7  Completed Work Request "Cerere nouă" / "Cerere respinsă" -> /cereri.
--       Approval keeps its Task link (D1).
--   D14 "Anunț nou" -> /anunturi?anunt=<id> (#856 opens it).
--   D23 An application declined because its Group was archived, and a removal
--       from a Private Group the Member no longer sees, carry no link: the
--       page would only say "Grup indisponibil".
--   D24 "Rol actualizat" -> /profil.
-- D11 Retention Signals reach only members at level 5 or above -- those who can
--     open /tracker/membru/<id>. An Adunarea Generală Responsible below it gets
--     nothing.
-- B36 "Ai fost adăugat în <Group>" has no body: "Faci parte din grupul <Group>."
--     only repeated the title. (set_group_role's appointment and end-of-
--     appointment bodies name the position, so they stay.)
-- Ruling (1): BC and the Moderator are not ranked on the Leaderboard; BCE is.
--     The Departments Cup is unchanged.
-- Ruling (4), the Privacy Notice 1.1, is not here: #860 bumps
--     privacy_notice_version together with the 1.1 text and the gate fix, so
--     the server is never ahead of the text the app ships.
--
-- Every function below is rebuilt from main's latest body
-- (pg_get_functiondef after a db reset at 20260928090000); only the lines
-- marked #843 differ. No signature, grant or table changes.

-- ---------------------------------------------------------------------------
-- 1. Task links (D1): the default link is /tracker?task=<id>
-- ---------------------------------------------------------------------------
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
  v_title text := left(p_title, 200);
  v_body  text := left(p_body, 2000);
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

-- ---------------------------------------------------------------------------
-- 2. Event links (D5): /calendar?event=<id>
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.update_event_impl(p_event_id bigint, p_title text, p_type text, p_group_id bigint, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_location text, p_capacity integer, p_description text, p_min_level integer, p_campaign_id bigint)
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
  v_constraint text;
begin
  -- 1. Malformed input, judged for everyone before the gate.
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_event_title';
  end if;
  -- #673 (R8): measured as stored (btrim).
  perform private.require_text_length('title', btrim(p_title), 3, 120);
  perform private.require_text_length('description', btrim(p_description), null, 2000);
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
  --    #756: the events_read rule itself, so an Event of a Private Group is
  --    missing for an outsider rather than forbidden.
  v_level := private.actor_level(v_actor);
  if not private.can_read_event(v_event.group_id, v_event.min_level, v_actor) then
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
  -- Minimum Level (private.can_read_event, the events_read rule) -- and, since
  -- #756, in its NEW Group, so a move into a Private Group tells no outsider.
  select array_agg(member_id) into v_old_members
    from private.group_audience(v_event.group_id) as member_id
   where private.can_read_event(p_group_id, p_min_level, member_id);
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
  if v_event.group_id is distinct from v_updated.group_id then
    v_recipients := coalesce(v_recipients, '{}'::uuid[]) || coalesce(v_old_members, '{}'::uuid[]);
  end if;
  -- #691: a Campaign is a label, not an important change -- it is deliberately
  -- absent from this list, so a Campaign-only edit notifies nobody.
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
        null, 'event:' || p_event_id::text || ':' || v_field, v_actor, '/calendar?event=' || p_event_id::text);
    end if;
  end loop;
  return v_updated;
end;
$function$;
CREATE OR REPLACE FUNCTION private.cancel_event_effect(p_event_id bigint, p_reason text, p_actor uuid)
 RETURNS events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_updated    public.events%rowtype;
  v_recipients uuid[];
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
  return v_updated;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Application link (D6): the Group page opened on its Cereri tab
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4. Completed Work Request links (D7): /cereri
-- ---------------------------------------------------------------------------
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
    null, 'request:' || v_request.id::text, v_actor, '/cereri');
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
    null, null, v_actor, '/cereri');

  select * into v_request from public.completed_work_requests where id = p_request_id;
  return v_request;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Announcement link (D14): /anunturi?anunt=<id>
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.fan_out_announcement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_audience_group bigint;
  v_recipients uuid[];
  v_actor uuid;
begin
  v_actor := coalesce((select auth.uid()), new.created_by);
  if new.audience = 'org' then
    select id into v_audience_group from public.groups where is_organization;
  else
    v_audience_group := new.group_id;
  end if;

  select array_agg(recipient.member_id order by recipient.member_id)
    into v_recipients
    from private.group_audience(v_audience_group) as recipient(member_id)
    join public.profiles as profile on profile.id = recipient.member_id
   where not exists (
     select 1 from public.notif_suppression as suppression
      where suppression.role = profile.role and suppression.kind = 'announce'
   )
     -- #756: an organization-wide Announcement of a Private Group reaches
     -- only those who can see the Group (announcements_read agrees).
     and private.can_see_group(new.group_id, recipient.member_id);

  -- #635: a critical Announcement's Notification is critical, so it still
  -- pushes to a Member who muted 'announce'.
  perform private.notify(v_recipients, 'announce',
    'Anunț nou: ' || new.title, new.body, null, null, v_actor, '/anunturi?anunt=' || new.id::text,
    new.priority = 'critical');
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Retention Signal recipients (D11): only those who can open the page
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.run_role_evaluation_impl(p_kind text, p_from date, p_to date, p_name text)
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
  v_holder_role public.member_role;
  v_rule_on     boolean;
  v_rows        jsonb;
  v_computed    integer;
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
  perform private.require_text_length('name', v_name, 3, 120);
  if p_from is null or p_to is null or p_to < p_from then
    raise sqlstate 'PT400' using message = 'invalid_date_range';
  end if;
  v_today := (now() at time zone 'Europe/Bucharest')::date;
  if p_to > v_today then
    raise sqlstate 'PT400' using message = 'date_range_in_future';
  end if;

  -- 2. The gate: claims and a live activ Profile, then BC or Moderator.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'role_evaluation_manage_forbidden';
  end;
  if coalesce(private.actor_level(v_actor), -1) < 6 then
    raise exception using errcode = '42501', message = 'role_evaluation_manage_forbidden';
  end if;

  -- 3. Runs and threshold edits serialise here, then the kind's threshold row.
  perform pg_catalog.pg_advisory_xact_lock(47, 1);
  select * into v_threshold
    from public.promotion_thresholds as setting
   where setting.kind = p_kind
   for no key update;

  -- 4. State: the first threshold of a kind is entered by hand.
  if v_threshold.threshold is null then
    raise sqlstate 'PT409' using message = 'promotion_threshold_not_set';
  end if;

  -- Role changes wait for this run: set_member_role locks the Profile `for
  -- update` and its role_history trigger then closes candidates, so taking
  -- the population's Profiles `for key share` here (Profiles first,
  -- candidates after -- the order set_member_role uses) keeps the ranking
  -- below from listing a Member promoted underneath it, and the candidate
  -- insert's FK check from deadlocking against that promotion.
  perform 1
     from public.profiles as profile
    where profile.status = 'activ'
      and profile.role in ('voluntar', 'activ', 'vot')
    order by profile.id
      for key share;

  -- 5. The ranking, read once (one snapshot for every step below).
  select coalesce(jsonb_agg(to_jsonb(ranked)), '[]'::jsonb) into v_rows
    from private.role_evaluation_rows(p_kind, p_from, p_to, v_today) as ranked;

  v_holder_role := case p_kind
                     when 'voluntar_activ' then 'activ'::public.member_role
                     else 'vot'::public.member_role
                   end;

  -- The boundary of the holders' cohort: the share-th holder's Task Points,
  -- which is the lowest score inside the share (ties share it).
  select min(ranked.task_points) into v_computed
    from jsonb_to_recordset(v_rows) as ranked (role public.member_role, task_points integer, inside boolean)
   where ranked.role = v_holder_role
     and ranked.inside;

  insert into public.role_evaluations (
    kind, name, period_from, period_to, run_by, threshold_used, threshold_computed, ranked_count
  ) values (
    p_kind, v_name, p_from, p_to, v_actor, v_threshold.threshold, v_computed,
    jsonb_array_length(v_rows)
  )
  returning id into v_run_id;

  v_span := pg_catalog.to_char(p_from, 'DD.MM.YYYY') || '–' || pg_catalog.to_char(p_to, 'DD.MM.YYYY');

  select array_agg(profile.id order by profile.id) into v_leaders
    from public.profiles as profile
    join public.roles as role on role.id = profile.role
   where profile.status = 'activ'
     and role.level >= 6;

  -- 6. Promotion Candidates (Voluntar Activ kind): the previous run's
  --    undecided rows are superseded; every tenured Voluntar at or above the
  --    threshold used gets a row and one Notification per BC/Moderator.
  if p_kind = 'voluntar_activ' then
    update public.promotion_candidates as candidate
       set decision = 'superseded',
           decided_at = now(),
           decided_by = v_actor
     where candidate.decision is null;

    select rule.enabled into v_rule_on
      from public.promotion_rules as rule
     where rule.kind = 'top_percent';

    if coalesce(v_rule_on, false) then
      for v_row in
        select ranked.member_id,
               ranked.task_points,
               ranked.tenure_since,
               coalesce(member.nickname, member.full_name) as member_name
          from jsonb_to_recordset(v_rows) as ranked (
                 member_id uuid, role public.member_role, task_points integer, tenure_since date)
          join public.profiles as member on member.id = ranked.member_id
         where ranked.role = 'voluntar'
           and ranked.task_points >= v_threshold.threshold
         order by ranked.member_id
      loop
        insert into public.promotion_candidates (role_evaluation_id, member_id, task_points, tenure_since)
        values (v_run_id, v_row.member_id, v_row.task_points, v_row.tenure_since);
        v_candidates := v_candidates + 1;

        perform private.notify(
          v_leaders, 'system',
          format('Candidat la promovare: %s', v_row.member_name),
          format('%s are %s puncte de task în evaluarea „%s” (%s), cel puțin pragul de %s puncte, '
                 'și vechimea cerută. Nu este promovat automat: îl poți promova în Voluntar Activ '
                 'din panoul de roluri sau respinge din Evaluări de rol.',
                 v_row.member_name, v_row.task_points, v_name, v_span, v_threshold.threshold),
          null, 'promotion_candidate:' || v_run_id::text || ':' || v_row.member_id::text,
          null, '/administrare/evaluari');
      end loop;
    end if;
  end if;

  -- 7. Retention Signals: every holder below the threshold used. Nothing
  --    changes; BC, the Moderator and the Adunarea Generală's Group
  --    Responsibles are told -- but only those at level 5 or above, the
  --    level /tracker/membru/<id> requires (#843, D11): a Responsible below it
  --    would be sent to a page that turns them away.
  select case when setting.value ~ '^[1-9][0-9]{0,17}$' then setting.value::bigint end
    into v_ag_group_id
    from public.org_settings as setting
   where setting.key = 'adunarea_generala_group_id';

  for v_row in
    select ranked.member_id,
           ranked.task_points,
           role.name as role_name,
           coalesce(member.nickname, member.full_name) as member_name
      from jsonb_to_recordset(v_rows) as ranked (
             member_id uuid, role public.member_role, task_points integer)
      join public.roles as role on role.id = ranked.role
      join public.profiles as member on member.id = ranked.member_id
     where ranked.role = v_holder_role
       and ranked.task_points < v_threshold.threshold
     order by ranked.member_id
  loop
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
      format('%s (%s) are %s puncte de task în evaluarea „%s” (%s), sub pragul de %s puncte. '
             'Rolul nu se retrage automat: decizia îi aparține BC.',
             v_row.member_name, v_row.role_name, v_row.task_points, v_name, v_span,
             v_threshold.threshold),
      null, 'retention_signal:' || v_run_id::text || ':' || v_row.member_id::text,
      null, '/tracker/membru/' || v_row.member_id::text);
  end loop;

  -- 8. The hand-over: the computed value is in force for the kind's next run.
  if v_computed >= 1 and v_computed is distinct from v_threshold.threshold then
    update public.promotion_thresholds
       set threshold = v_computed,
           updated_by = null
     where kind = p_kind;

    insert into public.promotion_threshold_changes (
      kind, from_value, to_value, source, changed_by, role_evaluation_id
    ) values (
      p_kind, v_threshold.threshold, v_computed, 'role_evaluation', null, v_run_id
    );
  end if;

  return query select v_run_id, v_candidates, v_signals;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Dead and missing links (D23, D24)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.archive_group_impl(p_group_id bigint)
 RETURNS groups
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      -- #843 (D23): an archived Group's page is unavailable, so no link.
      null);
  end loop;

  update public.groups
     set status = 'archived'
   where path @> array[p_group_id];

  select * into v_updated from public.groups where id = p_group_id;
  return v_updated;
end;
$function$;
CREATE OR REPLACE FUNCTION private.remove_group_member_impl(p_group_id bigint, p_member_id uuid)
 RETURNS group_members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_group public.groups%rowtype;
  v_row   public.group_members%rowtype;
begin
  v_actor := private.require_group_work_manager(p_group_id);

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
  if not found then
    -- PT404 covers "not there" and "not visible" alike (conventions section
    -- 3). An Automatic-Membership Group has no ordinary rows at all, so every
    -- removal there is either this or group_member_holds_role.
    raise sqlstate 'PT404' using message = 'group_member_not_found';
  end if;

  -- This is what replaces the legacy project_members_protect_leader trigger:
  -- a position is ended by the authority that granted it, never by a roster
  -- removal. For a Group Manager that authority is the PARENT's Managers
  -- (shape 1), which is exactly the escalation a silent removal here would
  -- bypass — a Group Responsible could otherwise unseat the Group's Manager.
  if v_row.group_role <> 'member' then
    raise sqlstate 'PT409' using message = 'group_member_holds_role';
  end if;

  delete from public.group_members as membership
   where membership.group_id = p_group_id and membership.member_id = p_member_id;

  perform private.notify(
    array[p_member_id], 'system'::public.noti_kind,
    'Nu mai faci parte din ' || v_group.name,
    'Ai fost eliminat din grupul ' || v_group.name || '.',
    null, null, v_actor,
    -- #843 (D23): a Private Group the Member no longer sees has no page for
    -- them, so the link goes only while the Group stays visible.
    case when private.can_see_group(p_group_id, p_member_id)
         then '/grupuri/' || p_group_id::text end);

  return v_row;
end;
$function$;
CREATE OR REPLACE FUNCTION private.set_member_role_impl(p_member_id uuid, p_role member_role, p_reason text DEFAULT NULL::text)
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor       uuid;
  v_actor_role  public.member_role;
  v_from        public.member_role;
  v_role_name   text;
  v_new_level   integer;
  v_groups_left text[];
  v_form_url    text;
  v_member      public.profiles%rowtype;
begin
  -- 1. Malformed for every caller, so it is answered ahead of any authority
  --    verdict (conventions section 2). The retired rank is no longer a value
  --    of the enum (#593), so it cannot reach this command at all.
  if p_role is null then
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

  -- #826 (ruling R28): Voluntar Activ is granted by hand now, so this is
  -- where AG Eligibility and the adherence form are offered. The address is
  -- read at write time (#681) and goes in the body: notifications.link is an
  -- in-app route.
  if p_role = 'activ' then
    select nullif(btrim(setting.value), '') into v_form_url
      from public.org_settings as setting
     where setting.key = 'adherence_form_url';
  end if;

  perform private.notify(
    array[p_member_id],
    'system'::public.noti_kind,
    'Rol actualizat',
    case
      when p_role = 'vot' then
        'Rolul tău în OSUBB este acum Voluntar cu Drept de Vot. Ești membru al Adunării Generale.'
      when p_role = 'activ' then
        'Rolul tău în OSUBB este acum ' || v_role_name || '. '
        || 'Ca Voluntar Activ ai Eligibilitate AG: poți intra în Adunarea Generală '
        || 'obținând Dreptul de Vot, pe care BC ți-l acordă după ce confirmă formularul de adeziune. '
        || case
             when v_form_url is not null then 'Completează formularul de adeziune: ' || v_form_url
             else 'Formularul de adeziune îl primești de la BC.'
           end
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
    v_actor,
    -- #843 (D24): the new Role is on Profil.
    '/profil'
  );

  return v_member;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Bodies that repeat the title (B36)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.appoint_group_member(p_group_id bigint, p_member_id uuid, p_actor uuid, p_group_role text DEFAULT 'member'::text, p_position_title text DEFAULT NULL::text)
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
  perform private.require_text_length('position_title', v_title, null, 80);
  if p_group_role = 'responsible' and v_title is null then
    raise sqlstate 'PT400' using message = 'position_title_required';
  end if;
  if p_group_role <> 'responsible' and v_title is not null then
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
    v_display := coalesce(v_title, nullif(btrim(v_group.manager_title), ''), 'coordonator de grup');
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Numire în ' || v_group.name,
      'Ai fost numit ' || v_display || ' în grupul ' || v_group.name || '.',
      null, null, p_actor, '/grupuri/' || p_group_id::text);
  end if;

  return v_row;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Leaderboard without BC and the Moderator (ruling 2026-09-28)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.leadership_leaderboard_impl(p_group_id bigint, p_campaign_id bigint, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(member_id uuid, full_name text, nickname text, points integer, rank integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.require_date_range(p_from, p_to);

  with task_points as (
    select entry.member_id as member_id,
           sum(entry.delta)::int as points
      from public.points_ledger as entry
      join public.task_evaluations as evaluation on evaluation.id = entry.evaluation_id
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
       and (p_from is null or evaluation.evaluated_at >= p_from)
       and (p_to is null or evaluation.evaluated_at < p_to)
     group by entry.member_id
  )
  select scored.member_id,
         member.full_name,
         member.nickname,
         scored.points,
         rank() over (order by scored.points desc)::int
    from task_points as scored
    join public.profiles as member on member.id = scored.member_id
   -- Ruling 2026-09-28 (#843): BC and the Moderator are not ranked; rank()
   -- runs after this filter, so the ranks renumber without them. BCE stays.
   where member.role not in ('bc', 'moderator')
   order by scored.points desc, member.full_name asc;
$function$;

-- ---------------------------------------------------------------------------
-- 10. The rows already delivered, rewritten to what the commands now write.
--     Each update matches only the shape its command produced.
-- ---------------------------------------------------------------------------

-- D1: every Task link.
update public.notifications
   set link = '/tracker?task=' || substring(link from '^/tracker/([0-9]+)$')
 where link ~ '^/tracker/[0-9]+$';

-- D5: Event changes and cancellations carry the Event id in their dedupe key.
update public.notifications
   set link = '/calendar?event=' || substring(dedupe_key from '^event:([0-9]+):')
 where dedupe_key ~ '^event:[0-9]+:'
   and link = '/calendar';

-- D6: the deciders' "Cerere de înscriere" (the applicant's answers link the
-- member-facing /grupuri/<id> and are left alone).
update public.notifications
   set link = link || '?tab=cereri'
 where dedupe_key ~ '^application:[0-9]+$'
   and link ~ '^/administrare/grupuri/[0-9]+$';

-- D7: "Cerere nouă" (dedupe request:<id>) and "Cerere respinsă" (a Task-kind
-- row with no Task and no key -- a Group application's refusal is 'system').
update public.notifications
   set link = '/cereri'
 where link is null
   and kind = 'task'
   and task_id is null
   and (dedupe_key ~ '^request:[0-9]+$'
        or (dedupe_key is null and title like 'Cerere respinsă: %'));

-- D14: an Announcement's Notification is written in the insert's own
-- transaction, so its created_at is the Announcement's published_at default.
-- A row is linked only when the match is unambiguous: the one Announcement
-- with that title published at exactly that instant, else the one Announcement
-- with that title published by then. Anything else keeps the feed link rather
-- than risk opening the wrong Announcement.
update public.notifications as notification
   set link = '/anunturi?anunt=' || matched.announcement_id::text
  from (
    select candidate.id as notification_id,
           coalesce(
             (select min(announcement.id)
                from public.announcements as announcement
               where left('Anunț nou: ' || announcement.title, 200) = candidate.title
                 and announcement.published_at = candidate.created_at
              having count(*) = 1),
             (select min(announcement.id)
                from public.announcements as announcement
               where left('Anunț nou: ' || announcement.title, 200) = candidate.title
                 and announcement.published_at <= candidate.created_at
              having count(*) = 1)) as announcement_id
      from public.notifications as candidate
     where candidate.kind = 'announce'
       and candidate.link = '/anunturi'
  ) as matched
 where notification.id = matched.notification_id
   and matched.announcement_id is not null;

-- D23: applications declined by an archive, and removals from a Private Group
-- the Member no longer sees.
update public.notifications as notification
   set link = null
  from public.group_applications as application
 where notification.dedupe_key = 'application:' || application.id::text
   and notification.member_id = application.member_id
   and application.status = 'declined'
   and application.decision_note = 'Grup arhivat'
   and notification.link = '/grupuri/' || application.group_id::text;

update public.notifications as notification
   set link = null
 where notification.kind = 'system'
   and notification.title like 'Nu mai faci parte din %'
   and notification.link ~ '^/grupuri/[0-9]+$'
   and not private.can_see_group(substring(notification.link from '^/grupuri/([0-9]+)$')::bigint,
                                 notification.member_id);

-- D24: "Rol actualizat".
update public.notifications
   set link = '/profil'
 where kind = 'system'
   and title = 'Rol actualizat'
   and link is null;

-- B36: the body that only repeated the title.
update public.notifications
   set body = null
 where kind = 'system'
   and title like 'Ai fost adăugat în %'
   and body = 'Faci parte din grupul ' || substring(title from length('Ai fost adăugat în ') + 1) || '.';

-- ---------------------------------------------------------------------------
-- 11. Function comments that named the old links or recipients. Each
--     sentence is replaced in place; a sentence that is not there fails the
--     migration rather than leaving a stale comment behind.
-- ---------------------------------------------------------------------------
do $$
declare
  v_edit record;
  v_old  text;
begin
  for v_edit in
    select * from (values
      ('private.notify(uuid[],public.noti_kind,text,text,bigint,text,uuid,text,boolean)',
       'derived from p_task_id (''/tracker/<id>'')',
       'derived from p_task_id (''/tracker?task=<id>'', #843)'),
      ('private.update_event_impl(bigint,text,text,bigint,timestamptz,timestamptz,text,integer,text,integer,bigint)',
       'and link /calendar;',
       'and link /calendar?event=<id>;'),
      ('private.cancel_event_effect(bigint,text,uuid)',
       'with link /calendar.',
       'with link /calendar?event=<id>.'),
      ('private.cancel_event_impl(bigint,text)',
       'and link /calendar.',
       'and link /calendar?event=<id>.'),
      ('public.apply_to_group(bigint,text)',
       'with link /administrare/grupuri/<group_id>, because',
       'with link /administrare/grupuri/<group_id>?tab=cereri, because'),
      ('private.run_role_evaluation_impl(text,date,date,text)',
       'and the Adunarea Generală''s Group Responsibles minus the Member',
       'and the Adunarea Generală''s Group Responsibles at level 5 or above (who alone can open that page, #843) minus the Member'),
      ('private.archive_group_impl(bigint)',
       'each applicant notified with a link to the member-facing Group page;',
       'each applicant notified without a link (an archived Group has no page to open, #843);'),
      ('public.remove_group_member(bigint,uuid)',
       'with link /grupuri/<group_id>.',
       'with link /grupuri/<group_id> -- none when the Group is a Private Group the Member no longer sees (#843).'),
      ('public.leadership_leaderboard(bigint,bigint,timestamptz,timestamptz)',
       'Retains inactive earners,',
       'Leaves out current BC and Moderator holders, ranking the rest contiguously (ruling 2026-09-28, #843; BCE stays ranked). Retains inactive earners,')
    ) as edit (fn, old_text, new_text)
  loop
    v_old := obj_description(v_edit.fn::regprocedure, 'pg_proc');
    if v_old is null or strpos(v_old, v_edit.old_text) = 0 then
      raise exception 'comment on % does not contain %', v_edit.fn, v_edit.old_text;
    end if;
    execute format('comment on function %s is %L', v_edit.fn,
                   replace(v_old, v_edit.old_text, v_edit.new_text));
  end loop;
end;
$$;
