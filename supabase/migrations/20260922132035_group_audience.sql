-- #601 (Groups Wave 3, T24): private.group_audience() -- the one implementation of CONTEXT.md's
-- Group Audience: every active Member of a Group or of any Group below it, whether through a
-- roster row or through Automatic Membership. Automatic Membership is never materialized (the
-- Organization Group and the Adunarea Generala have no group_members rows), so any fan-out that
-- reads group_members alone reaches nobody for an organization-wide Event or announcement.
--
-- The Event commands switch to it here: private.event_notification_recipients becomes
-- group_audience(event.group_id) plus the current going attendees, and update_event_impl's
-- "old Group" recipients on a move become the old Group's audience instead of its explicit
-- roster. Every Event recipient is filtered through private.can_read_event, the rule events_read
-- now shares, so a Notification never reaches a Member who cannot read the Event. Archived
-- Groups below the audience's Group contribute nobody. #581/#68 fan announcements out through
-- the same helper.

create function private.group_audience(p_group_id bigint)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  -- The subtree: p_group_id itself and every Group below it (path contains p_group_id),
  -- minus any Group that is archived or sits below an archived Group -- judged only on
  -- the part of the path AFTER p_group_id. p_group_id's own status (and its ancestors')
  -- is not read: Events on an archived Group are the commands' business.
  with subtree as (
    select grp.id, grp.automatic_membership, grp.min_level
      from public.groups as grp
     where grp.path @> array[p_group_id]
       and not exists (
         select 1
           from public.groups as between_grp
          where between_grp.id = any (grp.path[array_position(grp.path, p_group_id) + 1:])
            and between_grp.status = 'archived')
  )
  -- (a) roster rows on any Group of the subtree
  select membership.member_id
    from subtree
    join public.group_members as membership on membership.group_id = subtree.id
    join public.profiles as profile on profile.id = membership.member_id
                                    and profile.status = 'activ'
  union
  -- (b) Automatic Membership on any Group of the subtree: every active Member whose live
  --     level (profiles.role -> roles.level, the same lookup as private.actor_level) is at
  --     or above that Group's Minimum Level
  select profile.id
    from subtree
    join public.profiles as profile on profile.status = 'activ'
    join public.roles as role on role.id = profile.role
                             and role.level >= subtree.min_level
   where subtree.automatic_membership;
$$;

comment on function private.group_audience(bigint) is
  'The Group Audience of p_group_id (CONTEXT.md, ADR-0009, #601): the distinct union of (a) every activ Member holding a group_members row -- any Group Role -- on a Group whose path contains p_group_id (the Group itself and every Group below it), and (b) for every such Group with automatic_membership, every activ Member whose live role level is at or above that Group''s min_level. Never an inactive Member; an unknown id yields the empty set. A Group below p_group_id that is archived, or that sits below an archived Group, contributes nobody (a Member reached only through it is not in the audience); p_group_id''s own status is not read -- whether an archived Group may still speak is the caller''s business. Used by private.event_notification_recipients (Event important changes and cancellation) and by the announcement fan-out (#581/#68); Task notifications never use it. Internal: executable by no client role.';

revoke execute on function private.group_audience(bigint)
  from public, anon, authenticated, service_role;


-- ==================== Event visibility: one definition, two readers ====================
-- events_read's rule (#372, ADR-0008 Visibility) was inline: a live, activ Member whose
-- current role level satisfies the Event's Minimum Level. A Notification carries the
-- Event's title, so a recipient who cannot read the Event must never get one -- the
-- recipient set has to ask exactly the question the policy asks. The rule moves into
-- private.can_read_event, and both events_read and event_notification_recipients call it.
-- (The policy's auth_is_member() claims check stays in the policy: it is about the
-- CALLER's token, which a recipient does not have; the live activ + level half is the
-- part that is about a Member, and it is the part the predicate owns.)

create function private.can_read_event(p_min_level integer, p_member uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select role.level >= p_min_level
       from public.profiles as profile
       join public.roles as role on role.id = profile.role
      where profile.id = p_member
        and profile.status = 'activ'),
    false
  );
$$;

comment on function private.can_read_event(integer, uuid) is
  'The Event visibility rule (ADR-0008 Visibility, #372, #601): p_member -- the caller by default -- is a live activ Member whose current role level is at or above p_min_level (the Event''s Minimum Level). False for a missing or inactive profile, so a stale JWT or a deactivated Member never satisfies it. One definition, two readers: the events_read policy (for the caller, after its auth_is_member() claims check) and private.event_notification_recipients (for each recipient), so an Event Notification never reaches a Member who cannot read that Event. Policy predicate: authenticated may execute it.';

revoke execute on function private.can_read_event(integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.can_read_event(integer, uuid) to authenticated;

drop policy events_read on public.events;

create policy events_read on public.events
  for select to authenticated
  using (
    (select public.auth_is_member())
    and private.can_read_event(min_level, (select auth.uid()))
  );

comment on policy events_read on public.events is
  'ADR-0008 Visibility: any active member reads any Event whose Minimum Level they satisfy, regardless of scope (#372). The Member half of the rule is private.can_read_event (#601), shared with private.event_notification_recipients so a Notification never reaches someone this policy would hide the Event from. "Future events only" is a frontend filter, not enforced here -- see 20260911211700_events_read_min_level.sql, decision 2.';


create or replace function private.event_notification_recipients(p_event_id bigint)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select candidate.member_id
    from public.events as event
    cross join lateral (
      select audience.member_id
        from private.group_audience(event.group_id) as audience(member_id)
      union
      select attendance.member_id
        from public.event_attendance as attendance
       where attendance.event_id = event.id and attendance.status = 'going'
    ) as candidate
   where event.id = p_event_id
     and private.can_read_event(event.min_level, candidate.member_id);
$$;

comment on function private.event_notification_recipients(bigint) is
  'The audience for an Event Notification (#248, #601): the Group Audience of the Event''s Group (private.group_audience -- roster rows on the Group and every non-archived Group below it, plus Automatic Membership, so an Organization Group Event reaches every activ Member) together with the Members who said going on it, de-duplicated, and then filtered through private.can_read_event -- the same rule as events_read -- so nobody who cannot read the Event is ever told about it: an inactive Member, a Member below the Event''s Minimum Level, or a going attendee since demoted below it. A Minimum Level raise therefore reaches only the Members who can still read the Event. A Member who declined is reached only through the Group Audience, never as an attendee. private.notify drops the actor, so a command never echoes its own change back to its author.';


-- update_event_impl, rebuilt from its latest definition (20260922090300_event_edit_plan_additions)
-- with one change: on a move, the old Group's recipients are its Group Audience, filtered by
-- private.can_read_event at the new Minimum Level like every other Event recipient.
create or replace function private.update_event_impl(
  p_event_id bigint, p_title text, p_type text, p_group_id bigint,
  p_starts_at timestamptz, p_ends_at timestamptz, p_location text,
  p_capacity integer, p_description text, p_min_level integer
)
returns public.events language plpgsql security definer set search_path = ''
as $$
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
  if p_type is null or p_type not in ('sedinta', 'activitate', 'call', 'eveniment', 'deadline', 'recrutare') then
    raise sqlstate 'PT400' using message = 'invalid_event_type';
  end if;
  if p_starts_at is null or (p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise sqlstate 'PT400' using message = 'invalid_event_interval';
  end if;
  if p_capacity is not null and p_capacity <= 0 then
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
  if exists (select 1 from public.groups where id = v_event.group_id and legacy_dept_id = 'org') then
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
      if v_target.legacy_dept_id = 'org' then
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
$$;

comment on function private.update_event_impl(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer) is
  'Replaces an Event''s whole editable state, authorized by Group Role (ADR-0009 Wave 2, #248). This is a full-state REPLACE, not a patch: every editable column is written from its argument, so a null clears a nullable column (ends_at, location, capacity, description) rather than leaving the old value -- a client that wants to keep a field must send it back. Malformed input is judged first, for everyone, with the same reasons as create_event including event_group_required. A caller who cannot see the Event (below its min_level) is answered PT404 event_not_found, the same as an id that does not exist: hidden is never distinguishable from missing. Authority on the SOURCE: an Organization Group Event (legacy_dept_id = ''org'' until Wave 3 gives it a setting of its own) belongs to its creator or to level >= 6; every other Event goes through private.require_group_work_manager, so a Group Manager or Group Responsible of the Group or any ancestor on its path qualifies. Moving the Event re-runs the rule on the TARGET Group, where an Organization target takes create_event''s rule -- level >= 6 or any live Group Role anywhere -- because the Organization Group is a root Group with no ancestors of its own (one root among several: every Department, Independent Team and Project Group is a root too, and most Group paths never contain it), so nobody could reach it through an ancestor role. A MOVE''s target must be active. An edit that leaves the Event in its own Group is NOT refused when that Group has since been archived: this is a full-state replace, so every call names a Group, and an ungated check would leave such an Event uncorrectable while cancel_event -- same authority rule -- still cancelled it. Who may still edit it is decided by the source rule above alone: BC/Moderator always, a Group Role only while the Group is active, which is can_manage_group_work''s own status gate. Minimum Level is then judged against the target Group and the live actor (PT400 event_min_level_below_group / event_min_level_above_actor), and a cancelled Event is PT409 event_cancelled. The legacy (scope, dept_id, team_id, project_id) Origin is never written here: events_sync_group_origin re-derives it from group_id. Important changes -- schedule, location, Group, Minimum Level -- notify the current going attendees and the new Group''s Group Audience (private.group_audience, #601: roster rows on the Group and every Group below it plus Automatic Membership) -- plus the old Group''s Group Audience when the Event moved, every recipient filtered through private.can_read_event at the new Minimum Level so nobody who cannot read the Event is told -- under dedupe key event:<id>:<field> and link /calendar, so a second unread change to the same field coalesces onto one row carrying the later value; title, type, description and capacity notify nobody.';
comment on function private.cancel_event_impl(bigint, text) is
  'Cancels an Event, authorized exactly as private.update_event_impl authorizes an edit (ADR-0009 Wave 2, #248). The reason is malformed input -- blank or null is PT400 reason_required, raised before the gate, so a claimless caller learns what is wrong with the call -- and it is preserved, trimmed, on the row beside cancelled_at, which events_cancel_reason_ck requires to be set together. Cancellation is terminal: a second call is PT409 event_cancelled, and so is any later edit. The Event row and every event_attendance row survive (ADR-0008: cancellation preserves RSVP history) and the Event stays readable to everyone at or above its min_level. Recipients -- the current going attendees and the Group''s Group Audience (private.group_audience, #601) -- are notified under dedupe key event:<id>:cancelled with the reason as the body and link /calendar.';
