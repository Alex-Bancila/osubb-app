-- #681: organization settings -- a key-value table every Member reads and BC/Moderator write through one command.
--
-- Ruling R20 of the 2026-09-23 grill: organization-wide values BC sets from
-- the app instead of a migration. The first key is `adherence_form_url`, the
-- adherence form a Member promoted to Voluntar Activ is offered (ADR-0004 as
-- amended 2026-09-21, CONTEXT.md "AG Eligibility"); #52's promotion
-- notification is its first reader. Keys are reference data (house rule 6):
-- a migration seeds each one, and no client ever creates or deletes a key --
-- the next key is a one-line seed in its own migration. Not a feature-flag
-- system.
--
-- Read side: every live active Member reads every row. The policy pairs
-- auth_is_member() (organization claims -- house rule 12) with the live
-- private.caller_level() >= 0, so a deactivated Member whose token still
-- carries claims (ADR-0003's window) reads nothing either.
--
-- Write side: public.set_org_setting is the only write path. The table grants
-- authenticated select alone, so a direct insert/update/delete is 42501 before
-- RLS is consulted, and there is no write policy behind that.
--
-- Command order (conventions section 2):
--   1. step 1, for every caller: the value is trimmed, blank -> null, measured
--      by #673's private.require_text_length (PT400 value_too_long above 2048
--      characters, the kit's <field>_<rule> reason), then judged per key --
--      adherence_form_url must be an http(s) address (#673's
--      private.is_http_url), else PT400 invalid_org_setting_value;
--   2. the gate: private.require_active_member() (organization claims and a
--      live activ Profile), then the actor's Profile held `for share` and its
--      live level checked >= 6 (BC or Moderator) in the same read, so the one
--      level check is also the lock; one reason for every denial -- 42501
--      org_settings_manage_forbidden, as set_member_role answers every denial
--      with one reason;
--   3. the row `for update`; PT404 org_setting_not_found for a key no
--      migration seeded (after the gate, so a non-BC caller cannot probe keys);
--   4. PT409 nothing_to_update when the stored value would not change;
--   5. write value and updated_by; the shared trigger moves updated_at.
-- updated_by / updated_at are the audit of who last changed a setting.

-- ---------------------------------------------------------------------------
-- The table.
-- ---------------------------------------------------------------------------
create table public.org_settings (
  key        text primary key,
  value      text,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint org_settings_key_ck check (key ~ '^[a-z][a-z0-9_]*$'),
  constraint org_settings_value_length_ck
    check (value is null or char_length(value) <= 2048),
  -- Inline rather than private.is_http_url: a CHECK expression runs as the
  -- writing role, and the kit's helpers are granted to nobody.
  constraint org_settings_adherence_form_url_ck
    check (key <> 'adherence_form_url' or value is null or value ~ '^https?://')
);

alter table public.org_settings enable row level security;

create trigger org_settings_set_updated_at
before update on public.org_settings
for each row execute function private.set_updated_at();

comment on table public.org_settings is
  '#681 (ruling R20): organization-wide settings BC sets from the app instead of a migration. Every live active Member reads every row; the only write path is public.set_org_setting (BC/Moderator). Keys are reference data seeded by migrations. First key: adherence_form_url, the adherence form link #52''s promotion notification carries -- select value from public.org_settings where key = ''adherence_form_url'' (null until BC sets it).';
comment on column public.org_settings.updated_by is
  '#681: the Member whose set_org_setting call last changed the value; null while the value is still as its migration seeded it.';

-- New public tables inherit select/insert/update/delete for authenticated
-- (conventions section 3); take everything back, then grant the read alone.
revoke all on table public.org_settings from public, anon, authenticated;
grant select on table public.org_settings to authenticated, service_role;

create policy org_settings_read on public.org_settings
  for select to authenticated
  using ((select public.auth_is_member()) and (select private.caller_level()) >= 0);

comment on policy org_settings_read on public.org_settings is
  '#681: every live active Member reads every setting -- organization claims (house rule 12) plus a live activ Profile, so a deactivated Member''s still-valid token reads nothing. No write policy: public.set_org_setting is the only write path.';

-- ---------------------------------------------------------------------------
-- Reference data: the first key, empty until BC sets it.
-- ---------------------------------------------------------------------------
insert into public.org_settings (key, value) values ('adherence_form_url', null);

-- ---------------------------------------------------------------------------
-- The command.
-- ---------------------------------------------------------------------------
create function private.set_org_setting_impl(p_key text, p_value text)
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
  '#681: body of public.set_org_setting. Step 1 trims the value (blank -> null), PT400 value_too_long above 2048 characters, PT400 invalid_org_setting_value for an adherence_form_url that is not http(s); then 42501 org_settings_manage_forbidden unless the caller is a live active BC or Moderator (level >= 6, Profile held for share); PT404 org_setting_not_found for an unseeded key; PT409 nothing_to_update for an unchanged value.';

create function public.set_org_setting(p_key text, p_value text)
returns public.org_settings
language sql
security invoker
set search_path = ''
as $$
  select * from private.set_org_setting_impl(p_key, p_value);
$$;

comment on function public.set_org_setting(text, text) is
  '#681 (ruling R20): BC or the Moderator sets one organization setting. The value is trimmed and a blank value clears it (null); an adherence_form_url must be an http(s) address of at most 2048 characters. Records updated_by; the trigger moves updated_at. The Administrare "Perioade de evaluare" panel (#702) calls it; #52''s promotion notification reads the value it writes (select value from public.org_settings where key = ''adherence_form_url''). Keys are seeded by migrations: an unknown key is PT404 org_setting_not_found.';

revoke execute on function private.set_org_setting_impl(text, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.set_org_setting(text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.set_org_setting_impl(text, text) to authenticated;
grant execute on function public.set_org_setting(text, text) to authenticated;
