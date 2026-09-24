-- #635: per-Member push preferences -- a muted kind keeps its in-app Notification and skips the push (ADR-0010).

-- One row per (Member, kind) the Member has touched; an absent row means
-- push is on. Only the three broadcast-shaped kinds are mutable: a Task
-- Notification is about the Member's own work, a system one about their
-- membership, and neither may be silenced (ruling R17). A critical
-- Announcement is an 'announce' row that ignores the preference (below).
create table public.notification_push_preferences (
  member_id    uuid not null references public.profiles (id) on delete cascade,
  kind         public.noti_kind not null,
  push_enabled boolean not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (member_id, kind),
  constraint notification_push_preferences_kind_ck check (kind in ('announce', 'event', 'deadline'))
);

alter table public.notification_push_preferences enable row level security;

revoke all on table public.notification_push_preferences from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.notification_push_preferences to authenticated, service_role;

create trigger notification_push_preferences_set_updated_at
before update on public.notification_push_preferences
for each row execute function private.set_updated_at();

-- Self-only, and only for a live active Member: a stale claim (house rule 12)
-- or a claimless session reads and writes nothing -- the push_tokens shape.
create policy notification_push_preferences_read_self on public.notification_push_preferences
  for select to authenticated
  using (public.auth_is_member()
    and (select private.caller_level()) >= 0
    and member_id = (select auth.uid()));

create policy notification_push_preferences_create_self on public.notification_push_preferences
  for insert to authenticated
  with check (public.auth_is_member()
    and (select private.caller_level()) >= 0
    and member_id = (select auth.uid()));

create policy notification_push_preferences_update_self on public.notification_push_preferences
  for update to authenticated
  using (public.auth_is_member()
    and (select private.caller_level()) >= 0
    and member_id = (select auth.uid()))
  with check (public.auth_is_member()
    and (select private.caller_level()) >= 0
    and member_id = (select auth.uid()));

create policy notification_push_preferences_delete_self on public.notification_push_preferences
  for delete to authenticated
  using (public.auth_is_member()
    and (select private.caller_level()) >= 0
    and member_id = (select auth.uid()));

-- A critical Announcement must reach the device even when 'announce' is
-- muted, so its Notification has to say it is critical when it is inserted:
-- the enqueue trigger fires then. private.notify wrote critical = false
-- always; a trailing optional p_critical keeps every existing caller as is.
drop function private.notify(uuid[], public.noti_kind, text, text, bigint, text, uuid, text);

create function private.notify(
  p_recipients uuid[],
  p_kind       public.noti_kind,
  p_title      text,
  p_body       text,
  p_task_id    bigint,
  p_dedupe_key text,
  p_actor      uuid,
  p_link       text default null,
  p_critical   boolean default false
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
    select recipient.member_id, p_kind, p_title, p_body, v_link, coalesce(p_critical, false), p_task_id, p_dedupe_key
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
    select recipient.member_id, p_kind, p_title, p_body, v_link, coalesce(p_critical, false), p_task_id, null
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

comment on function private.notify(uuid[], public.noti_kind, text, text, bigint, text, uuid, text, boolean) is
  'Writes targeted in-app Notifications for p_recipients, minus nulls, duplicates, p_actor, and any recipient whose live profile is not activ. link uses p_link when supplied, otherwise is derived from p_task_id (''/tracker/<id>''); critical is p_critical, false by default -- only the Announcement fan-out passes true, for a critical Announcement, so its push ignores the recipient''s preferences (#635). With p_dedupe_key set, upserts on (member_id, dedupe_key) while the existing row is unread, replacing title/body/created_at -- the caller supplies the coalesced text (e.g. a Candidate-queue count); once that row is read, the next call with the same key starts a new row. Without a key, every call inserts fresh rows. Returns the number of recipients written. Blank/null title raises PT400 invalid_notification_title. Task Notifications are direct and are never suppressed -- notif_suppression applies only to the broadcast/announcement fan-out (#68), not here.';

revoke execute on function private.notify(uuid[], public.noti_kind, text, text, bigint, text, uuid, text, boolean)
  from public, anon, authenticated, service_role;

-- Rebuilt from #756's body (20260924132724_private_groups.sql); the one
-- change is the trailing p_critical.
create or replace function private.fan_out_announcement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    'Anunț nou: ' || new.title, new.body, null, null, v_actor, '/anunturi',
    new.priority = 'critical');
  return new;
end;
$$;

create or replace function private.enqueue_push_deliveries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- #635: a kind the recipient muted writes no outbox row; the in-app row is
  -- already written. A critical Notification ignores the preference.
  if not new.critical and exists (
    select 1
      from public.notification_push_preferences as preference
     where preference.member_id = new.member_id
       and preference.kind = new.kind
       and not preference.push_enabled
  ) then
    return null;
  end if;

  insert into public.push_deliveries (notification_id, token_id)
  select new.id, push_token.id
    from public.push_tokens as push_token
   where push_token.member_id = new.member_id
     and push_token.platform = 'web';
  return null;
end;
$$;

comment on function private.enqueue_push_deliveries() is
  'After-insert trigger on notifications: one push_deliveries row per web push_tokens row of the recipient -- none when the recipient muted the Notification''s kind in notification_push_preferences and the Notification is not critical (#635); the in-app row stays either way. Suppression is already applied where the Notification row was written, so it is never re-applied here (ADR-0010) -- re-applying notif_suppression would silence BC''s direct Task Notifications. Only an insert enqueues: private.notify''s dedupe upsert of an unread row refreshes its text in place and does not push again.';
