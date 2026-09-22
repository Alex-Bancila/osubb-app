-- #248: atomic Group-authorized Event updates/cancellation and targeted notifications.
-- Keep existing seven-argument notify callers working through the trailing default.
drop function private.notify(uuid[], public.noti_kind, text, text, bigint, text, uuid);

create function private.notify(
  p_recipients uuid[],
  p_kind       public.noti_kind,
  p_title      text,
  p_body       text,
  p_task_id    bigint,
  p_dedupe_key text,
  p_actor      uuid,
  p_link       text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link  text;
  v_count integer;
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
    select recipient.member_id, p_kind, p_title, p_body, v_link, false, p_task_id, p_dedupe_key
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
    select recipient.member_id, p_kind, p_title, p_body, v_link, false, p_task_id, null
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
$$;

comment on function private.notify(uuid[], public.noti_kind, text, text, bigint, text, uuid, text) is
  'Writes targeted in-app Notifications for p_recipients, minus nulls, duplicates, p_actor, and any recipient whose live profile is not activ. link uses p_link when supplied, otherwise is derived from p_task_id (''/tracker/<id>''); critical is always false here. With p_dedupe_key set, upserts on (member_id, dedupe_key) while the existing row is unread, replacing title/body/created_at -- the caller supplies the coalesced text (e.g. a Candidate-queue count); once that row is read, the next call with the same key starts a new row. Without a key, every call inserts fresh rows. Returns the number of recipients written. Blank/null title raises PT400 invalid_notification_title. Task Notifications are direct and are never suppressed -- notif_suppression applies only to the broadcast/announcement fan-out (#68), not here.';

revoke execute on function private.notify(uuid[], public.noti_kind, text, text, bigint, text, uuid, text)
  from public, anon, authenticated, service_role;


alter table public.events add column updated_at timestamptz not null default now();
create trigger events_set_updated_at before update on public.events
for each row execute function private.set_updated_at();

create function private.event_notification_recipients(p_event_id bigint)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select membership.member_id
    from public.events as event
    join public.group_members as membership on membership.group_id = event.group_id
    join public.profiles as profile on profile.id = membership.member_id and profile.status = 'activ'
   where event.id = p_event_id
  union
  select attendance.member_id
    from public.event_attendance as attendance
    join public.profiles as profile on profile.id = attendance.member_id and profile.status = 'activ'
   where attendance.event_id = p_event_id and attendance.status = 'going';
$$;
revoke execute on function private.event_notification_recipients(bigint)
from public, anon, authenticated, service_role;

create function private.update_event_impl(
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
begin
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

  select * into v_target from public.groups where id = p_group_id;
  if not found then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
  end if;
  if p_group_id is distinct from v_event.group_id then
    -- Even an Organization Event's creator must hold authority in the new Group.
    begin
      perform private.require_group_work_manager(p_group_id);
    exception when insufficient_privilege then
      raise exception using errcode = '42501', message = 'calendar_manage_forbidden';
    end;
  end if;
  if p_min_level < v_target.min_level then
    raise sqlstate 'PT400' using message = 'event_min_level_below_group';
  end if;
  if v_level < 9 and p_min_level > v_level then
    raise sqlstate 'PT400' using message = 'event_min_level_above_actor';
  end if;
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
      perform private.notify(v_recipients, 'event', 'Eveniment actualizat', v_updated.title,
        null, 'event:' || p_event_id::text || ':' || v_field, v_actor, '/calendar');
    end if;
  end loop;
  return v_updated;
end;
$$;

create function public.update_event(
  p_event_id bigint, p_title text, p_type text, p_group_id bigint,
  p_starts_at timestamptz, p_ends_at timestamptz, p_location text,
  p_capacity integer, p_description text, p_min_level integer
)
returns public.events language sql security invoker set search_path = ''
as $$
  select private.update_event_impl(p_event_id, p_title, p_type, p_group_id,
    p_starts_at, p_ends_at, p_location, p_capacity, p_description, p_min_level);
$$;

create function private.cancel_event_impl(p_event_id bigint, p_reason text)
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
  perform private.notify(v_recipients, 'event', 'Eveniment anulat', v_updated.cancel_reason,
    null, 'event:' || p_event_id::text || ':cancelled', v_actor, '/calendar');
  return v_updated;
end;
$$;

create function public.cancel_event(p_event_id bigint, p_reason text)
returns public.events language sql security invoker set search_path = ''
as $$ select private.cancel_event_impl(p_event_id, p_reason); $$;

revoke execute on function public.update_event(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer),
  private.update_event_impl(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer),
  public.cancel_event(bigint, text), private.cancel_event_impl(bigint, text)
from public, anon, authenticated, service_role;
grant execute on function public.update_event(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer),
  private.update_event_impl(bigint, text, text, bigint, timestamptz, timestamptz, text, integer, text, integer),
  public.cancel_event(bigint, text), private.cancel_event_impl(bigint, text)
to authenticated;
