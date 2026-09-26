-- #691: an Event may carry one Campaign (events.campaign_id, same validity rule as a Task's), set by create_event/update_event; past Events readable by design (ADR-0008 amended 2026-09-23, ruling R14).
--
-- Why each piece has the shape it has:
--   1. The column is nullable and has no default: every existing Event and every
--      caller that names no Campaign keeps meaning "no Campaign". supabase/seed.sql
--      names its columns, so it keeps running.
--   2. Validity is a trigger, not a command check, and mirrors
--      private.validate_task_campaign(): the invariant holds for every write path
--      (the two commands, rolled-back fixtures, and whatever writes events next),
--      and it lists group_id in its `of` columns so a Group-only move revalidates
--      (conventions §10: a before trigger that depends on the owning Group must).
--   3. create_event / update_event gain p_campaign_id by drop-and-recreate: one
--      signature per name, because PostgREST cannot pick between overloads. The
--      bodies are rebuilt from main's latest (#673's constraints kit,
--      20260923231125_constraints_kit.sql); the only changes are the argument, the
--      written column and the 23514 -> PT400 invalid_campaign mapping, which is the
--      string create_task_impl already uses for the same condition (conventions §3).
--   4. update_event is a full-state replace, so p_campaign_id has no default there
--      and a null clears the Campaign. A Campaign is a label, never an important
--      change: it stays out of the notification loop.
--   5. events_read does not change. No future clause ever existed in the database
--      (the "future only" rule was the browser's filter); only its comment is
--      corrected, and rls_events.test.sql now pins a past Event as readable.

-- ==================== 1. The column ====================

alter table public.events
  add column campaign_id bigint references public.campaigns (id);

create index events_campaign_idx on public.events (campaign_id);

comment on column public.events.campaign_id is
  'The Event''s Campaign label (ADR-0008, amended 2026-09-23; #691), or null. Only a Campaign owned by the Event''s Group or by a Group above it on its path (events_validate_campaign). A label only: it decides no visibility or authority, and Campaigns earn points only through Tasks.';

-- ==================== 2. The validity trigger ====================

create function private.validate_event_campaign()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign_group bigint;
  v_campaign_active boolean;
  v_event_path bigint[];
begin
  if new.campaign_id is null then return new; end if;
  select campaign.group_id, campaign.is_active into v_campaign_group, v_campaign_active
    from public.campaigns campaign where campaign.id = new.campaign_id;
  select grp.path into v_event_path from public.groups grp where grp.id = new.group_id;
  if v_campaign_group is null or not coalesce(v_event_path @> array[v_campaign_group], false) then
    raise exception using errcode = '23514', message = 'event_campaign_origin_mismatch';
  end if;
  -- A Campaign attached by THIS statement must be active; one already attached
  -- that went inactive later is preserved, exactly as on Tasks.
  if (tg_op = 'INSERT' or new.campaign_id is distinct from old.campaign_id)
     and not v_campaign_active then
    raise exception using errcode = '23514', message = 'event_campaign_inactive';
  end if;
  return new;
end;
$$;

comment on function private.validate_event_campaign() is
  'Trigger on events (insert, or update of campaign_id, group_id; #691): a Campaign may tag an Event only when the Campaign''s Group is on the Event Group''s path (event_campaign_origin_mismatch), and a newly attached Campaign must be active (event_campaign_inactive); a Campaign deactivated after it was attached is preserved. The mirror of private.validate_task_campaign().';

revoke execute on function private.validate_event_campaign()
  from public, anon, authenticated, service_role;

create trigger events_validate_campaign
  before insert or update of campaign_id, group_id on public.events
  for each row execute function private.validate_event_campaign();

-- ==================== 3. create_event ====================

drop function public.create_event(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer);
drop function private.create_event_impl(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer);

create function private.create_event_impl(
  p_title text, p_type text, p_group_id bigint, p_starts_at timestamptz,
  p_ends_at timestamptz default null, p_location text default null,
  p_capacity integer default null, p_description text default null, p_min_level integer default 0,
  p_campaign_id bigint default null
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
  -- #691: events_validate_campaign judges the Campaign against the Event's Group;
  -- its two reasons, and an unknown id, reach the caller as create_task_impl's
  -- PT400 invalid_campaign (same condition, same string).
  begin
    insert into public.events(title,type,group_id,starts_at,ends_at,location,capacity,description,min_level,campaign_id,created_by)
      values (btrim(p_title),p_type::public.event_type,p_group_id,p_starts_at,p_ends_at,
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
  return v_created;
end;
$$;

comment on function private.create_event_impl(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint) is
  'Creates an Event on a Group, authorized by Group Role (ADR-0009 Wave 2, #370). Malformed input is judged first, for everyone, so a caller without organization claims learns what is wrong with the call: PT400 invalid_event_title / invalid_event_type / invalid_event_interval / invalid_event_capacity / invalid_event_min_level / event_group_required. The Organization Group — since #582 the Group carrying groups.is_organization, not the row mirroring the legacy org pseudo-department — is open to any live Member holding any Group Role anywhere, which is how a Department''s leadership gets an organization-wide Event, or to level >= 6; every other Group goes through private.require_group_work_manager, so a Group Manager or Group Responsible on the path, an ancestor''s included, qualifies and an ordinary member does not. Every refusal is the single non-disclosing 42501 calendar_manage_forbidden, so a missing, archived or forbidden Group are indistinguishable. Minimum Level is then judged against the loaded rows: PT400 event_min_level_below_group (an Event may not be more open than its Group) and PT400 event_min_level_above_actor (nobody raises an Event above their own live level), the latter with Moderator exempt. An optional Campaign (#691, ADR-0008 amended 2026-09-23) must be owned by the Event''s Group or a Group above it and be active (events_validate_campaign); anything else is PT400 invalid_campaign, the string create_task uses for the same condition.';

revoke execute on function private.create_event_impl(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.create_event_impl(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint)
  to authenticated;

create function public.create_event(
  p_title text, p_type text, p_group_id bigint, p_starts_at timestamptz,
  p_ends_at timestamptz default null, p_location text default null,
  p_capacity integer default null, p_description text default null, p_min_level integer default 0,
  p_campaign_id bigint default null
)
returns public.events language sql security invoker set search_path = ''
as $$
  select private.create_event_impl(p_title, p_type, p_group_id, p_starts_at, p_ends_at,
    p_location, p_capacity, p_description, p_min_level, p_campaign_id);
$$;

comment on function public.create_event(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint) is
  'Security-invoker wrapper over private.create_event_impl (#370; p_campaign_id #691). Replaces the grandfathered direct-definer command that gated on a flat level >= 4; no Tracker or Calendar authority reads level 4 any more.';

revoke execute on function public.create_event(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.create_event(text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint)
  to authenticated;

-- ==================== 4. update_event ====================

drop function public.update_event(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer);
drop function private.update_event_impl(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer);

create function private.update_event_impl(
  p_event_id bigint, p_title text, p_type text, p_group_id bigint,
  p_starts_at timestamptz, p_ends_at timestamptz, p_location text,
  p_capacity integer, p_description text, p_min_level integer, p_campaign_id bigint
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
        null, 'event:' || p_event_id::text || ':' || v_field, v_actor, '/calendar');
    end if;
  end loop;
  return v_updated;
end;
$$;

comment on function private.update_event_impl(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint) is
  'Replaces an Event''s whole editable state, authorized by Group Role (ADR-0009 Wave 2, #248). This is a full-state REPLACE, not a patch: every editable column is written from its argument, so a null clears a nullable column (ends_at, location, capacity, description, campaign_id) rather than leaving the old value -- a client that wants to keep a field must send it back. Malformed input is judged first, for everyone, with the same reasons as create_event including event_group_required. A caller who cannot see the Event (below its min_level) is answered PT404 event_not_found, the same as an id that does not exist: hidden is never distinguishable from missing. Authority on the SOURCE: an Organization Group Event (since #582 the Group carrying groups.is_organization) belongs to its creator or to level >= 6; every other Event goes through private.require_group_work_manager, so a Group Manager or Group Responsible of the Group or any ancestor on its path qualifies. Moving the Event re-runs the rule on the TARGET Group, where an Organization target takes create_event''s rule -- level >= 6 or any live Group Role anywhere -- because the Organization Group is a root Group with no ancestors of its own (one root among several: every Department, Independent Team and Project Group is a root too, and most Group paths never contain it), so nobody could reach it through an ancestor role. A MOVE''s target must be active. An edit that leaves the Event in its own Group is NOT refused when that Group has since been archived: this is a full-state replace, so every call names a Group, and an ungated check would leave such an Event uncorrectable while cancel_event -- same authority rule -- still cancelled it. Who may still edit it is decided by the source rule above alone: BC/Moderator always, a Group Role only while the Group is active, which is can_manage_group_work''s own status gate. Minimum Level is then judged against the target Group and the live actor (PT400 event_min_level_below_group / event_min_level_above_actor), and a cancelled Event is PT409 event_cancelled. The Campaign (#691, ADR-0008 amended 2026-09-23) must be owned by the Event''s Group -- the new one, on a move -- or a Group above it, and a newly attached one must be active (events_validate_campaign); anything else is PT400 invalid_campaign, and a Campaign deactivated after it was attached is kept when sent back unchanged. Important changes -- schedule, location, Group, Minimum Level -- notify the current going attendees and the new Group''s Group Audience (private.group_audience, #601), plus the old Group''s Group Audience when the Event moved, every recipient filtered through private.can_read_event at the new Minimum Level, under dedupe key event:<id>:<field> and link /calendar; title, type, description, capacity and Campaign notify nobody.';

revoke execute on function private.update_event_impl(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.update_event_impl(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint)
  to authenticated;

create function public.update_event(
  p_event_id bigint, p_title text, p_type text, p_group_id bigint,
  p_starts_at timestamptz, p_ends_at timestamptz, p_location text,
  p_capacity integer, p_description text, p_min_level integer, p_campaign_id bigint
)
returns public.events language sql security invoker set search_path = ''
as $$
  select private.update_event_impl(p_event_id, p_title, p_type, p_group_id,
    p_starts_at, p_ends_at, p_location, p_capacity, p_description, p_min_level, p_campaign_id);
$$;

comment on function public.update_event(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint) is
  'Security-invoker wrapper over private.update_event_impl (#248; p_campaign_id #691). A full-state replace: p_campaign_id has no default, and null clears the Campaign.';

revoke execute on function public.update_event(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.update_event(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer, bigint)
  to authenticated;

-- ==================== 5. events_read: the comment, not the predicate ====================

comment on policy events_read on public.events is
  'ADR-0008 Visibility (amended 2026-09-23): any active member reads any Event, past or future, whose Minimum Level they satisfy, regardless of Group (#372, #691). Past Events are readable by design -- there is no starts_at clause, and rls_events.test.sql pins a past Event as readable. The Member half of the rule is private.can_read_event (#601), shared with private.event_notification_recipients so a Notification never reaches someone this policy would hide the Event from.';
