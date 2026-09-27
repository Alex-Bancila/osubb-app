-- Security pass 2026-09-27 (backend findings M3 + L1): the avatar colour and
-- the text columns that had no length limit.
--
-- M3. profiles.avatar_color is self-writable and colleagues' browsers paint it
-- as a CSS background. Free text there is CSS injection and a fetch beacon
-- (`url(https://…)`), and an unbounded value bloats every roster. It becomes
-- `#RRGGBB` or null. The app's default colour IS null -- every screen paints a
-- Member without one in var(--brand-red) -- so a stored value that is not
-- `#RRGGBB` is reset to null before the constraint, never guessed at.
--
-- L1. Text a privileged caller (or, for profiles, the Member) writes gets the
-- #673 constraints-kit shape: a CHECK constraint on the column, and, where a
-- command writes it, the same limit at step 1 of the command through
-- private.require_text_length, so the caller sees PT400 <field>_too_long
-- ahead of any authority verdict (conventions section 2):
--
--   events.location                 200  create_event, update_event -> location_too_long
--   group_members.position_title     80  set_group_role (+ appoint_group_member) -> position_title_too_long
--   groups.manager_title             80  update_group -> manager_title_too_long
--   groups.short                     16  create_group, update_group_structure -> short_too_long
--   profiles.full_name              120  direct update (BC) / provisioning -> 23514 full_name_too_long
--   profiles.avatar_color      #RRGGBB  direct update (self) -> 23514 invalid_avatar_color
--   profiles.email                  254  (RFC 5321) raw check only
--   points_ledger.note             1000  raw check only (the sanction insert is direct)
--   rating_guide.label / note    60/1000  reference data, raw check only
--   difficulty_guide.note          1000  reference data, raw check only
--   notifications.title / body 200/2000  private.notify clips, the check backs it
--
-- The Group limits match what the forms already allow (maxLength 16 on
-- Prescurtare, 80 on both title inputs), so no value the app could have
-- saved is refused now.
--
-- profiles is written directly by the app, so -- as #673 did for the phone --
-- a before-row guard names the reason as 23514 and no client sees a raw
-- constraint name. private.notify clips instead of refusing: a Notification
-- is a side effect of a command, and refusing it would roll the command back.
--
-- No client-writable JSONB column exists (task_activity.details is written by
-- command bodies only; push_tokens.token is text and is finding M2's), so no
-- pg_column_size cap is added here.
--
-- Two migrations, as #673 did: this one adds every constraint NOT VALID
-- (enforced on every new write from now on) and raises a NOTICE counting the
-- existing rows that break it; 20260927150100_column_limits_validate.sql
-- validates them, and fails loudly -- naming table and constraint -- if a row
-- still breaks one. No row is trimmed to fit (house rule 1).
--
-- Every function below is rebuilt from main's latest body (pg_get_functiondef
-- of the database main builds); the only changes are the lines marked
-- "Security pass 2026-09-27".

-- ==================== 1. profiles ====================
update public.profiles
   set avatar_color = null
 where avatar_color is not null
   and avatar_color !~ '^#[0-9A-Fa-f]{6}$';

create function private.guard_profile_text()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.avatar_color is not null and new.avatar_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception using errcode = '23514', message = 'invalid_avatar_color';
  end if;
  if char_length(new.full_name) > 120 then
    raise exception using errcode = '23514', message = 'full_name_too_long';
  end if;
  return new;
end;
$$;
comment on function private.guard_profile_text() is
  'Security pass 2026-09-27 (M3, L1): names profiles_avatar_color_ck / profiles_full_name_length_ck as 23514 invalid_avatar_color / full_name_too_long for the direct writes the app makes.';
revoke execute on function private.guard_profile_text() from public, anon, authenticated, service_role;

create trigger profiles_guard_text
  before insert or update of full_name, avatar_color on public.profiles
  for each row execute function private.guard_profile_text();

alter table public.profiles
  add constraint profiles_avatar_color_ck
  check (avatar_color is null or avatar_color ~ '^#[0-9A-Fa-f]{6}$') not valid;
do $$ begin
  raise notice '%: % existing row(s) break it', 'profiles_avatar_color_ck',
    (select count(*) from public.profiles where not (avatar_color is null or avatar_color ~ '^#[0-9A-Fa-f]{6}$'));
end $$;

alter table public.profiles
  add constraint profiles_full_name_length_ck check (char_length(full_name) <= 120) not valid;
do $$ begin
  raise notice '%: % existing row(s) break it', 'profiles_full_name_length_ck',
    (select count(*) from public.profiles where not (char_length(full_name) <= 120));
end $$;

alter table public.profiles
  add constraint profiles_email_length_ck check (char_length(email) <= 254) not valid;
do $$ begin
  raise notice '%: % existing row(s) break it', 'profiles_email_length_ck',
    (select count(*) from public.profiles where not (char_length(email) <= 254));
end $$;

-- ==================== 2. events, groups, group_members ====================
alter table public.events
  add constraint events_location_length_ck
  check (location is null or char_length(location) <= 200) not valid;
do $$ begin
  raise notice '%: % existing row(s) break it', 'events_location_length_ck',
    (select count(*) from public.events where not (location is null or char_length(location) <= 200));
end $$;

alter table public.group_members
  add constraint group_members_position_title_length_ck
  check (position_title is null or char_length(position_title) <= 80) not valid;
do $$ begin
  raise notice '%: % existing row(s) break it', 'group_members_position_title_length_ck',
    (select count(*) from public.group_members where not (position_title is null or char_length(position_title) <= 80));
end $$;

alter table public.groups
  add constraint groups_manager_title_length_ck
  check (manager_title is null or char_length(manager_title) <= 80) not valid;
do $$ begin
  raise notice '%: % existing row(s) break it', 'groups_manager_title_length_ck',
    (select count(*) from public.groups where not (manager_title is null or char_length(manager_title) <= 80));
end $$;

alter table public.groups
  add constraint groups_short_length_ck
  check (short is null or char_length(short) <= 16) not valid;
do $$ begin
  raise notice '%: % existing row(s) break it', 'groups_short_length_ck',
    (select count(*) from public.groups where not (short is null or char_length(short) <= 16));
end $$;

-- ==================== 3. ledger, guides, notifications ====================
alter table public.points_ledger
  add constraint points_ledger_note_length_ck
  check (note is null or char_length(note) <= 1000) not valid;
do $$ begin
  raise notice '%: % existing row(s) break it', 'points_ledger_note_length_ck',
    (select count(*) from public.points_ledger where not (note is null or char_length(note) <= 1000));
end $$;

alter table public.rating_guide
  add constraint rating_guide_label_length_ck
  check (char_length(label) <= 60) not valid;
do $$ begin
  raise notice '%: % existing row(s) break it', 'rating_guide_label_length_ck',
    (select count(*) from public.rating_guide where not (char_length(label) <= 60));
end $$;

alter table public.rating_guide
  add constraint rating_guide_note_length_ck
  check (note is null or char_length(note) <= 1000) not valid;
do $$ begin
  raise notice '%: % existing row(s) break it', 'rating_guide_note_length_ck',
    (select count(*) from public.rating_guide where not (note is null or char_length(note) <= 1000));
end $$;

alter table public.difficulty_guide
  add constraint difficulty_guide_note_length_ck
  check (note is null or char_length(note) <= 1000) not valid;
do $$ begin
  raise notice '%: % existing row(s) break it', 'difficulty_guide_note_length_ck',
    (select count(*) from public.difficulty_guide where not (note is null or char_length(note) <= 1000));
end $$;

alter table public.notifications
  add constraint notifications_title_length_ck check (char_length(title) <= 200) not valid;
do $$ begin
  raise notice '%: % existing row(s) break it', 'notifications_title_length_ck',
    (select count(*) from public.notifications where not (char_length(title) <= 200));
end $$;

alter table public.notifications
  add constraint notifications_body_length_ck
  check (body is null or char_length(body) <= 2000) not valid;
do $$ begin
  raise notice '%: % existing row(s) break it', 'notifications_body_length_ck',
    (select count(*) from public.notifications where not (body is null or char_length(body) <= 2000));
end $$;

-- ==================== 4. The commands, rebuilt from main ====================
CREATE OR REPLACE FUNCTION private.create_event_impl(p_title text, p_type text, p_group_id bigint, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_location text DEFAULT NULL::text, p_capacity integer DEFAULT NULL::integer, p_description text DEFAULT NULL::text, p_min_level integer DEFAULT 0, p_campaign_id bigint DEFAULT NULL::bigint)
 RETURNS public.events
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
  perform private.require_text_length('title', btrim(p_title), 3, 120);
  perform private.require_text_length('description', btrim(p_description), null, 2000);
  -- Security pass 2026-09-27 (L1): events_location_length_ck, measured as stored.
  perform private.require_text_length('location', btrim(p_location), null, 200);
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
$function$;

CREATE OR REPLACE FUNCTION private.update_event_impl(p_event_id bigint, p_title text, p_type text, p_group_id bigint, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_location text, p_capacity integer, p_description text, p_min_level integer, p_campaign_id bigint)
 RETURNS public.events
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
        null, 'event:' || p_event_id::text || ':' || v_field, v_actor, '/calendar');
    end if;
  end loop;
  return v_updated;
end;
$function$;

CREATE OR REPLACE FUNCTION private.set_group_role_impl(p_group_id bigint, p_member_id uuid, p_group_role text, p_position_title text DEFAULT NULL::text)
 RETURNS public.group_members
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
  perform private.require_text_length('position_title', v_title, null, 80);
  -- A Group Responsible is always shown under a custom display name
  -- (CONTEXT.md, ADR-0009 Group Roles), so the name is part of the
  -- appointment and not an afterthought. A Group Manager's display name is a
  -- GROUP setting (groups.manager_title — BCE, Coordonator Principal), which
  -- is update_group's to write, and ordinary membership has none: sending
  -- either one a title here is the caller misunderstanding the model, not a
  -- value to silently drop.
  if p_group_role = 'responsible' and v_title is null then
    raise sqlstate 'PT400' using message = 'position_title_required';
  end if;
  if p_group_role <> 'responsible' and v_title is not null then
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

  v_old_display := coalesce(v_row.position_title,
                            nullif(btrim(v_group.manager_title), ''),
                            'coordonator de grup');

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
    v_display := coalesce(v_title, nullif(btrim(v_group.manager_title), ''), 'coordonator de grup');
    perform private.notify(
      array[p_member_id], 'system'::public.noti_kind,
      'Numire în ' || v_group.name,
      'Ai fost numit ' || v_display || ' în grupul ' || v_group.name || '.',
      null, null, v_actor, '/grupuri/' || p_group_id::text);
  end if;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION private.appoint_group_member(p_group_id bigint, p_member_id uuid, p_actor uuid, p_group_role text DEFAULT 'member'::text, p_position_title text DEFAULT NULL::text)
 RETURNS public.group_members
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
      'Faci parte din grupul ' || v_group.name || '.',
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

CREATE OR REPLACE FUNCTION private.update_group_impl(p_group_id bigint, p_name text, p_manager_title text, p_accepts_applications boolean, p_application_level integer, p_shared_work_visibility boolean, p_min_level integer, p_application_form_label text, p_application_form_url text, p_confirm_removals boolean DEFAULT false)
 RETURNS public.groups
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
  perform private.require_text_length('name', btrim(p_name), 3, 120);
  if p_manager_title is not null and p_manager_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_position_title';
  end if;
  -- Security pass 2026-09-27 (L1): groups_manager_title_length_ck.
  perform private.require_text_length('manager_title', v_title, null, 80);
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

  if (btrim(p_name), v_title, v_accepts, p_application_level, v_shared, p_min_level,
      v_form_label, v_form_url)
     is not distinct from
     (v_group.name, v_group.manager_title, v_group.accepts_applications,
      v_group.application_level, v_group.shared_work_visibility, v_group.min_level,
      v_group.application_form_label, v_group.application_form_url) then
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
         min_level              = p_min_level,
         application_form_label = v_form_label,
         application_form_url   = v_form_url
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
$function$;

CREATE OR REPLACE FUNCTION private.create_group_impl(p_name text, p_category text, p_parent_id bigint DEFAULT NULL::bigint, p_min_level integer DEFAULT NULL::integer, p_manager_id uuid DEFAULT NULL::uuid, p_color text DEFAULT NULL::text, p_short text DEFAULT NULL::text, p_is_private boolean DEFAULT false)
 RETURNS public.groups
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
  perform private.require_text_length('name', btrim(p_name), 3, 120);
  -- Security pass 2026-09-27 (L1): groups_short_length_ck, measured as stored.
  perform private.require_text_length('short', nullif(btrim(p_short), ''), null, 16);
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

CREATE OR REPLACE FUNCTION private.update_group_structure_impl(p_group_id bigint, p_category text, p_competes_in_cup boolean, p_counts_toward_parent_cup boolean, p_automatic_membership boolean, p_min_level integer, p_color text, p_short text, p_is_organization boolean, p_is_private boolean, p_confirm_removals boolean DEFAULT false)
 RETURNS public.groups
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
  -- Security pass 2026-09-27 (L1): groups_short_length_ck.
  perform private.require_text_length('short', v_short, null, 16);
  -- #756: a full-state replace must say which it is. A null is refused rather
  -- than read as "public", which would un-hide a Private Group by omission.
  if p_is_private is null then
    raise sqlstate 'PT400' using message = 'invalid_group_privacy';
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

CREATE OR REPLACE FUNCTION private.notify(p_recipients uuid[], p_kind public.noti_kind, p_title text, p_body text, p_task_id bigint, p_dedupe_key text, p_actor uuid, p_link text DEFAULT NULL::text, p_critical boolean DEFAULT false)
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

  v_link := coalesce(p_link, case when p_task_id is not null then '/tracker/' || p_task_id::text else null end);

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
