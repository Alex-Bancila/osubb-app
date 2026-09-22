-- #248: the plan-required additions to Event editing and cancellation.
--
-- 20260922090200_group_event_update_cancel.sql already lands the pair, the
-- recipient set, private.notify's trailing p_link and events.updated_at. This
-- migration adds only what the ADR-0009 Wave 2 plan asks for and that file does
-- not do. A merged migration is never edited (conventions §1), so each body is
-- restated in full through `create or replace`, which has no partial form.
--
-- 1. The malformed-input block gains `event_group_required`. #370's
--    20260922090100_create_event_group_required.sql made a null Group a PT400
--    on create_event; sibling commands over one core must agree (conventions
--    §3), and a null Group on update otherwise fell out of the Group lookup as
--    42501 calendar_manage_forbidden -- "you may not" for what is in fact "you
--    did not say where". Placed last in the block, for the same reason #370
--    placed it last: precedence between two malformed arguments is not a
--    behaviour worth churning.
--
-- 2. A MOVE's target Group must be `status = 'active'`, as create_event
--    requires: without it an Event could be moved INTO an archived Group,
--    which no command can create one in. The check is deliberately gated on
--    `p_group_id is distinct from v_event.group_id` and is not a property of
--    the target argument alone. update_event is a full-state REPLACE, so every
--    call names a p_group_id, including a caller who is not moving anything --
--    an ungated check would refuse every edit of an Event whose own Group has
--    since been archived, BC/Moderator included, while cancel_event (same
--    authority rule, no target argument) still allowed one. That Event's time
--    could then never be corrected, only cancelled. An edit that keeps the
--    Event where it is is therefore decided by the authority rule at step 4
--    alone, and that rule already carries the right status gate:
--    can_manage_group_work admits level >= 6 anywhere, archived Groups
--    included, and a Group Role only on an ACTIVE Group.
--
-- 3. An Organization-Group TARGET applies the Organization rule rather than
--    private.require_group_work_manager. The Organization Group is a root
--    Group with no ancestors of its own -- one root among several, since every
--    Department, Independent Team and Project Group is a root too and most
--    paths never contain it -- so nobody can reach it from above:
--    can_manage_group_work on it is satisfied only by an explicit role on that
--    row, and a Department Coordinator who may CREATE an organization-wide
--    Event (#370) could not move one there. The rule is create_event's:
--    level >= 6, or any live Group Role anywhere. The SOURCE side of an
--    Organization Event keeps the narrower creator-or-level-6 rule -- editing
--    someone else's Event is not the same act as raising one of your own.
--
-- 4. Step order. Minimum Level is judged against the loaded rows, so it is
--    step 5 (conventions §2: "validation that can only be judged against the
--    loaded row ... belongs at step 5"), and the terminal-state conflict is
--    step 6. Both target-Group resolution and its authority move ahead of the
--    PT409, so a caller with no authority over the move is refused before
--    learning the Event is cancelled.
--
-- 5. Notification text. The plan's important-change Notification carries the
--    Event's name in its title and the changed field's NEW VALUE in its body,
--    rendered in Bucharest wall-clock time for the schedule. This is what
--    makes the dedupe key useful: a second unread schedule change coalesces
--    onto the same row and must leave the reader the later time, not the same
--    sentence twice. Titles become 'Eveniment actualizat: <name>' and
--    'Eveniment anulat: <name>'; cancellation keeps the reason as its body.
--
-- Nothing else in either body changes.

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
  select array_agg(member_id) into v_old_members
    from public.group_members where group_id = v_event.group_id;
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
  'Replaces an Event''s whole editable state, authorized by Group Role (ADR-0009 Wave 2, #248). This is a full-state REPLACE, not a patch: every editable column is written from its argument, so a null clears a nullable column (ends_at, location, capacity, description) rather than leaving the old value -- a client that wants to keep a field must send it back. Malformed input is judged first, for everyone, with the same reasons as create_event including event_group_required. A caller who cannot see the Event (below its min_level) is answered PT404 event_not_found, the same as an id that does not exist: hidden is never distinguishable from missing. Authority on the SOURCE: an Organization Group Event (legacy_dept_id = ''org'' until Wave 3 gives it a setting of its own) belongs to its creator or to level >= 6; every other Event goes through private.require_group_work_manager, so a Group Manager or Group Responsible of the Group or any ancestor on its path qualifies. Moving the Event re-runs the rule on the TARGET Group, where an Organization target takes create_event''s rule -- level >= 6 or any live Group Role anywhere -- because the Organization Group is a root Group with no ancestors of its own (one root among several: every Department, Independent Team and Project Group is a root too, and most Group paths never contain it), so nobody could reach it through an ancestor role. A MOVE''s target must be active. An edit that leaves the Event in its own Group is NOT refused when that Group has since been archived: this is a full-state replace, so every call names a Group, and an ungated check would leave such an Event uncorrectable while cancel_event -- same authority rule -- still cancelled it. Who may still edit it is decided by the source rule above alone: BC/Moderator always, a Group Role only while the Group is active, which is can_manage_group_work''s own status gate. Minimum Level is then judged against the target Group and the live actor (PT400 event_min_level_below_group / event_min_level_above_actor), and a cancelled Event is PT409 event_cancelled. The legacy (scope, dept_id, team_id, project_id) Origin is never written here: events_sync_group_origin re-derives it from group_id. Important changes -- schedule, location, Group, Minimum Level -- notify the current attendees and the new Group''s explicit members (plus the old Group''s, when the Event moved) under dedupe key event:<id>:<field> and link /calendar, so a second unread change to the same field coalesces onto one row carrying the later value; title, type, description and capacity notify nobody.';

comment on function public.update_event(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer) is
  'Security-invoker wrapper over private.update_event_impl (#248).';


create or replace function private.cancel_event_impl(p_event_id bigint, p_reason text)
returns public.events language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_level integer;
  v_event public.events%rowtype;
  v_updated public.events%rowtype;
  v_recipients uuid[];
begin
  if p_reason is null or p_reason !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'reason_required';
  end if;
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
  if v_event.cancelled_at is not null then
    raise sqlstate 'PT409' using message = 'event_cancelled';
  end if;

  update public.events set cancelled_at = clock_timestamp(), cancel_reason = btrim(p_reason)
   where id = p_event_id returning * into v_updated;
  select array_agg(recipient) into v_recipients
    from private.event_notification_recipients(p_event_id) as recipient;
  perform private.notify(v_recipients, 'event', 'Eveniment anulat: ' || v_updated.title, v_updated.cancel_reason,
    null, 'event:' || p_event_id::text || ':cancelled', v_actor, '/calendar');
  return v_updated;
end;
$$;

comment on function private.cancel_event_impl(bigint, text) is
  'Cancels an Event, authorized exactly as private.update_event_impl authorizes an edit (ADR-0009 Wave 2, #248). The reason is malformed input -- blank or null is PT400 reason_required, raised before the gate, so a claimless caller learns what is wrong with the call -- and it is preserved, trimmed, on the row beside cancelled_at, which events_cancel_reason_ck requires to be set together. Cancellation is terminal: a second call is PT409 event_cancelled, and so is any later edit. The Event row and every event_attendance row survive (ADR-0008: cancellation preserves RSVP history) and the Event stays readable to everyone at or above its min_level. Recipients -- the current going attendees and the Group''s explicit members -- are notified under dedupe key event:<id>:cancelled with the reason as the body and link /calendar.';

comment on function public.cancel_event(bigint, text) is
  'Security-invoker wrapper over private.cancel_event_impl (#248).';

comment on function private.event_notification_recipients(bigint) is
  'The audience for an Event Notification (#248): the Members who said going on it, plus every explicit public.group_members row of the Event''s Group whatever their Group Role, restricted to live (activ) profiles and de-duplicated by the union. It is deliberately explicit membership, not the Group path: an ancestor''s roster is not automatically an audience, and a Member who declined is not one either. private.notify drops the actor, so a command never echoes its own change back to its author.';
