-- #771: the Privacy Notice version as an organization setting, the Privacy Acknowledgement record, its command and BC's status read.
--
-- Ruling L16 of the 2026-09-25 launch grill. The Privacy Notice
-- (docs/legal/politica-de-confidentialitate.md) is versioned; every Member
-- acknowledges the current version once, on a full-screen step after sign-in,
-- and BC and the Moderator see who has. A Privacy Acknowledgement is a record
-- of information given, not a consent (CONTEXT.md): writing one changes
-- nothing else about the Member.
--
-- The current version lives in org_settings (#681) under
-- `privacy_notice_version`, seeded with the document's version and set by BC
-- through public.set_org_setting. Bumping it re-asks everyone; the older
-- acknowledgement rows stay.
--
-- Write side. public.acknowledge_privacy_notice is the path the app uses:
--   1. step 1, for every caller: the version is trimmed; blank ->
--      PT400 notice_version_required;
--   2. the gate: private.require_active_member() (organization claims and a
--      live activ Profile), then the actor's Profile held `for share`; one
--      reason for every denial -- 42501 privacy_acknowledgement_forbidden;
--   3. the current version, its org_settings row held `for share`, so a
--      concurrent set_org_setting (which takes the row `for update`) either
--      lands before -- and this call answers stale -- or waits for the
--      acknowledgement to commit; PT409 privacy_notice_version_stale when the
--      caller acknowledges any other version;
--   4. PT409 privacy_notice_already_acknowledged when the row exists (checked
--      by the insert itself, so two taps racing each other get one row and
--      one conflict, never a 23505);
--   5. the row, stamped by the database.
-- The issue also asks RLS to let a Member insert only their own row. That
-- policy exists and repeats the command's rule (own row, live activ, the
-- current version), and the grant covers member_id and notice_version only,
-- so a direct insert can neither backdate acknowledged_at nor record a
-- version the Member was never shown. No update or delete grant or policy:
-- an acknowledgement is never edited or withdrawn.
--
-- Read side. A Member reads their own rows (the post-sign-in step asks
-- whether one exists for the current version); BC and the Moderator
-- (auth_level() >= 6, re-checked live) read every row.
-- public.privacy_acknowledgement_status() is BC's list: every active Member
-- with their latest acknowledged version and when, null when none.

-- ---------------------------------------------------------------------------
-- The current version, as an organization setting.
-- ---------------------------------------------------------------------------
alter table public.org_settings
  add constraint org_settings_privacy_notice_version_ck
  check (key <> 'privacy_notice_version'
         or (value is not null and value ~ '^[0-9]{1,3}(\.[0-9]{1,3}){0,2}$'));

-- The version "Versiunea 1.0" of docs/legal/politica-de-confidentialitate.md.
-- app/src/screens/privacy/privacy-notice.test.tsx keeps the app's copy of the
-- text on the same version as the document.
insert into public.org_settings (key, value) values ('privacy_notice_version', '1.0');

comment on table public.org_settings is
  '#681 (ruling R20): organization-wide settings BC sets from the app instead of a migration. Every live active Member reads every row; the only write path is public.set_org_setting (BC/Moderator). Keys are reference data seeded by migrations. adherence_form_url: the adherence form link #52''s promotion notification carries (null until BC sets it). privacy_notice_version (#771, ruling L16): the current version of the Privacy Notice every Member acknowledges once (public.acknowledge_privacy_notice); dotted numbers such as 1.0 or 1.1, never null; bumping it re-asks everyone.';

-- ---------------------------------------------------------------------------
-- set_org_setting learns the new key. Rebuilt from #681's body
-- (20260924053559_org_settings.sql, the latest definition on main); what is
-- new is the privacy_notice_version shape in step 1.
-- ---------------------------------------------------------------------------
create or replace function private.set_org_setting_impl(p_key text, p_value text)
returns public.org_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid;
  v_actor_level integer;
  v_value       text;
  v_setting     public.org_settings%rowtype;
begin
  -- 1. Malformed for every caller, so answered ahead of any authority verdict.
  v_value := nullif(regexp_replace(coalesce(p_value, ''),
                                   '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_text_length('value', v_value, null, 2048);
  if p_key = 'adherence_form_url'
     and v_value is not null
     and not private.is_http_url(v_value) then
    raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
  end if;
  -- #771: the Privacy Notice version is dotted numbers and is never cleared.
  if p_key = 'privacy_notice_version'
     and (v_value is null or v_value !~ '^[0-9]{1,3}(\.[0-9]{1,3}){0,2}$') then
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
$$;

comment on function private.set_org_setting_impl(text, text) is
  '#681, extended by #771: body of public.set_org_setting. Step 1 trims the value (blank -> null), PT400 value_too_long above 2048 characters, PT400 invalid_org_setting_value for an adherence_form_url that is not http(s) or a privacy_notice_version that is not dotted numbers (1.0, 1.1, 2.0.1; blank included: the version is never cleared); then 42501 org_settings_manage_forbidden unless the caller is a live active BC or Moderator (level >= 6, Profile held for share); PT404 org_setting_not_found for an unseeded key; PT409 nothing_to_update for an unchanged value.';

comment on function public.set_org_setting(text, text) is
  '#681 (ruling R20), extended by #771: BC or the Moderator sets one organization setting. The value is trimmed and a blank value clears it (null). adherence_form_url must be an http(s) address of at most 2048 characters; #52''s promotion notification reads it (select value from public.org_settings where key = ''adherence_form_url''). privacy_notice_version must be dotted numbers (1.0, 1.1) and cannot be cleared; raising it makes every Member acknowledge the Privacy Notice again (#771). Records updated_by; the trigger moves updated_at. Keys are seeded by migrations: an unknown key is PT404 org_setting_not_found.';

-- ---------------------------------------------------------------------------
-- The Privacy Acknowledgement.
-- ---------------------------------------------------------------------------
-- No created_at beside acknowledged_at (conventions section 7): the row is
-- written once and never edited, so the instant it was created is the
-- acknowledgement's own time, and one column says it.
create table public.privacy_notice_acknowledgements (
  member_id       uuid not null references public.profiles (id) on delete cascade,
  notice_version  text not null,
  acknowledged_at timestamptz not null default now(),
  primary key (member_id, notice_version),
  constraint privacy_notice_acknowledgements_notice_version_ck
    check (notice_version ~ '^[0-9]{1,3}(\.[0-9]{1,3}){0,2}$')
);

alter table public.privacy_notice_acknowledgements enable row level security;

comment on table public.privacy_notice_acknowledgements is
  '#771 (ruling L16): Privacy Acknowledgements -- a Member''s one-time confirmation, per Privacy Notice version, that they read it, with the time. A record of information given, not a consent. Written by public.acknowledge_privacy_notice (or a direct insert the policy holds to the same rule); never updated or deleted. A Member reads their own rows; BC and the Moderator read every row and public.privacy_acknowledgement_status().';

-- New public tables inherit select/insert/update/delete for authenticated
-- (conventions section 3); take everything back, then grant the read and the
-- two-column insert alone.
revoke all on table public.privacy_notice_acknowledgements from public, anon, authenticated;
grant select on table public.privacy_notice_acknowledgements to authenticated, service_role;
grant insert (member_id, notice_version)
  on table public.privacy_notice_acknowledgements to authenticated;

create policy privacy_notice_acknowledgements_read
  on public.privacy_notice_acknowledgements
  for select to authenticated
  using (
    (select public.auth_is_member())
    and (
      (member_id = (select auth.uid()) and (select private.caller_level()) >= 0)
      or ((select public.auth_level()) >= 6 and (select private.caller_level()) >= 6)
    )
  );

comment on policy privacy_notice_acknowledgements_read on public.privacy_notice_acknowledgements is
  '#771: a live active Member reads their own acknowledgements; BC and the Moderator (auth_level() >= 6, re-checked live so a deactivated or demoted token reads only what its live rank allows) read every row. Organization claims first (house rule 12).';

create policy privacy_notice_acknowledgements_create_self
  on public.privacy_notice_acknowledgements
  for insert to authenticated
  with check (
    (select public.auth_is_member())
    and (select private.caller_level()) >= 0
    and member_id = (select auth.uid())
    and notice_version = (
      select setting.value
        from public.org_settings as setting
       where setting.key = 'privacy_notice_version')
  );

comment on policy privacy_notice_acknowledgements_create_self on public.privacy_notice_acknowledgements is
  '#771: a live active Member inserts only their own row, and only for the current Privacy Notice version (org_settings.privacy_notice_version) -- the rule public.acknowledge_privacy_notice enforces, repeated for the direct path. The insert grant covers member_id and notice_version only, so acknowledged_at is always the database''s now().';

-- ---------------------------------------------------------------------------
-- The command.
-- ---------------------------------------------------------------------------
create function private.acknowledge_privacy_notice_impl(p_version text)
returns public.privacy_notice_acknowledgements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid;
  v_version text;
  v_current text;
  v_row     public.privacy_notice_acknowledgements%rowtype;
begin
  -- 1. Malformed for every caller.
  v_version := nullif(regexp_replace(coalesce(p_version, ''),
                                     '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  if v_version is null then
    raise sqlstate 'PT400' using message = 'notice_version_required';
  end if;

  -- 2. Authority: a live active Member, held for the transaction.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'privacy_acknowledgement_forbidden';
  end;

  perform 1
    from public.profiles as actor
   where actor.id = v_actor
     and actor.status = 'activ'
   for share;
  if not found then
    raise exception using errcode = '42501', message = 'privacy_acknowledgement_forbidden';
  end if;

  -- 3. The current version, held against a concurrent bump.
  select setting.value into v_current
    from public.org_settings as setting
   where setting.key = 'privacy_notice_version'
   for share;
  if v_current is distinct from v_version then
    raise sqlstate 'PT409' using message = 'privacy_notice_version_stale';
  end if;

  -- 4 and 5. One row per Member and version; the insert is the check.
  insert into public.privacy_notice_acknowledgements (member_id, notice_version)
  values (v_actor, v_version)
  on conflict (member_id, notice_version) do nothing
  returning * into v_row;
  if not found then
    raise sqlstate 'PT409' using message = 'privacy_notice_already_acknowledged';
  end if;

  return v_row;
end;
$$;

comment on function private.acknowledge_privacy_notice_impl(text) is
  '#771: body of public.acknowledge_privacy_notice. PT400 notice_version_required for a blank version; 42501 privacy_acknowledgement_forbidden unless the caller has organization claims and a live activ Profile (held for share); PT409 privacy_notice_version_stale unless p_version is org_settings.privacy_notice_version (that row held for share, so a concurrent bump serializes); PT409 privacy_notice_already_acknowledged when the caller already acknowledged it. Inserts the caller''s own row, stamped now(), and returns it. Changes nothing else.';

create function public.acknowledge_privacy_notice(p_version text)
returns public.privacy_notice_acknowledgements
language sql
security invoker
set search_path = ''
as $$
  select * from private.acknowledge_privacy_notice_impl(p_version);
$$;

comment on function public.acknowledge_privacy_notice(text) is
  '#771 (ruling L16): the caller acknowledges the Privacy Notice version they were shown -- the "Am citit și am înțeles" step after sign-in. Only the current version (org_settings.privacy_notice_version) is accepted, once per Member; the row is a record of information given, not a consent.';

-- ---------------------------------------------------------------------------
-- BC's status read.
-- ---------------------------------------------------------------------------
create function private.privacy_acknowledgement_status_impl()
returns table (member_id uuid, notice_version text, acknowledged_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.auth_is_member(), false)
     or coalesce(private.actor_level(), -1) < 6 then
    raise exception using errcode = '42501', message = 'privacy_acknowledgements_forbidden';
  end if;

  return query
    select profile.id, latest.notice_version, latest.acknowledged_at
      from public.profiles as profile
      left join lateral (
        select ack.notice_version, ack.acknowledged_at
          from public.privacy_notice_acknowledgements as ack
         where ack.member_id = profile.id
         order by ack.acknowledged_at desc, ack.notice_version desc
         limit 1
      ) as latest on true
     where profile.status = 'activ'
     order by profile.id;
end;
$$;

comment on function private.privacy_acknowledgement_status_impl() is
  '#771: body of public.privacy_acknowledgement_status. 42501 privacy_acknowledgements_forbidden unless the caller has organization claims and a live activ level >= 6 (BC, Moderator). One row per activ Member: their most recently acknowledged Privacy Notice version and when, both null when they never acknowledged one. Ordered by member_id.';

create function public.privacy_acknowledgement_status()
returns table (member_id uuid, notice_version text, acknowledged_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.privacy_acknowledgement_status_impl();
$$;

comment on function public.privacy_acknowledgement_status() is
  '#771 (ruling L16): for BC and the Moderator, every active Member with the latest Privacy Notice version they acknowledged and when (null when none). Administrare''s Confidențialitate panel compares it with org_settings.privacy_notice_version; the member page shows one row.';

revoke execute on function private.acknowledge_privacy_notice_impl(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.acknowledge_privacy_notice(text)
  from public, anon, authenticated, service_role;
revoke execute on function private.privacy_acknowledgement_status_impl()
  from public, anon, authenticated, service_role;
revoke execute on function public.privacy_acknowledgement_status()
  from public, anon, authenticated, service_role;
grant execute on function private.acknowledge_privacy_notice_impl(text) to authenticated;
grant execute on function public.acknowledge_privacy_notice(text) to authenticated;
grant execute on function private.privacy_acknowledgement_status_impl() to authenticated;
grant execute on function public.privacy_acknowledgement_status() to authenticated;
