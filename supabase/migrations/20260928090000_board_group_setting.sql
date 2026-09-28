-- #824 (ruling R27; pages-pass plan 2026-09-27, decision D1): where a BC or
-- BCE member's board title lives.
--
-- BC is a Role, not a Group, so "Președinte" or "Coordonator IT" had nowhere
-- to live. D1 puts the board in a dedicated Private Group, "Biroul de
-- Conducere": each BC/BCE member is appointed to it as a Group Responsible and
-- their group_members.position_title there is their board title. Profil's
-- "Funcția în OSUBB" panel reads the caller's own roster row on that Group --
-- through the existing group_members read, no new function -- and falls back
-- to the Role label when there is none.
--
-- This migration adds only the pointer: org_settings.board_group_id, the id
-- of that Group, found by row and never by name, set by BC or the Moderator
-- through public.set_org_setting and validated exactly like #512's
-- adunarea_generala_group_id (a positive integer naming an active Group),
-- and additionally a Private one, so a board title is never read off a
-- public roster. The
-- Group itself is created in the app (Administrare -> Grupuri, Private) and
-- the titles are typed with the existing set_group_role; the demo seed does
-- both for the demo BC and BCE.
--
-- No authority is derived from this Group or from this setting: nothing but
-- Profil reads board_group_id, and no authority helper, policy or command
-- names it. The Group is Private -- visible only to its roster, the Managers
-- and Responsibles on its path, and BC/Moderator -- and nobody manages Tasks
-- or Events there: it holds only the board's Responsible rows, whose Group
-- Role reaches that empty Group alone (a Group Responsible never manages
-- another Responsible's work, and BC already manages everything at level 6).

-- ---------------------------------------------------------------------------
-- 1. The setting.
-- ---------------------------------------------------------------------------
alter table public.org_settings
  add constraint org_settings_board_group_id_ck
  check (key <> 'board_group_id' or value is null or value ~ '^[1-9][0-9]{0,17}$');

insert into public.org_settings (key, value) values ('board_group_id', null);

comment on table public.org_settings is
  '#681 (ruling R20): organization-wide settings BC sets from the app instead of a migration. Every live active Member reads every row; the only write path is public.set_org_setting (BC/Moderator). Keys are reference data seeded by migrations. adherence_form_url: the adherence form link #52''s promotion notification carries (null until BC sets it). adunarea_generala_group_id (#512): the id of the Group that is the Adunarea Generală -- its Group Managers and Group Responsibles, and those of its ancestors, read the full Evaluation Period ranking (private.can_read_evaluation_rankings); null until BC sets it. vote_retention_percent (#48): y, the Vote Retention Threshold -- the top share, a whole percentage 1-100, of the Voluntar cu Drept de Vot cohort a holder must reach in a closed Evaluation Period to stay inside it (public.retention_ranking); seeded 25 (R20''s placeholder BC ratifies), never null. privacy_notice_version (#771, ruling L16): the current version of the Privacy Notice every Member acknowledges once (public.acknowledge_privacy_notice); dotted numbers such as 1.0 or 1.1, never null; bumping it re-asks everyone. email_daily_quota (#775): how many Email Digests may be sent per UTC day, a whole number 0-99999 (0 pauses the digest), never null; seeded 90, leaving Resend''s free daily cap of 100 room for sign-in emails. board_group_id (#824, decision D1): the id of the Private Group "Biroul de Conducere", whose Group Responsibles'' position_title is each BC/BCE member''s board title on Profil (Funcția în OSUBB); read by Profil only, never an authority input; null until BC sets it.';

-- ---------------------------------------------------------------------------
-- 2. set_org_setting learns the new key. Rebuilt from #775's body
-- (20260927200000_email_digest.sql, the latest definition on main); what is
-- new is board_group_id beside adunarea_generala_group_id in step 1 and in
-- the active-Group check after the gate, which for the board also demands a
-- Private Group.
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
  -- #512, #824: a Group id is a positive integer that fits a bigint.
  if p_key in ('adunarea_generala_group_id', 'board_group_id')
     and v_value is not null
     and v_value !~ '^[1-9][0-9]{0,17}$' then
    raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
  end if;
  -- #48: y is a whole percentage 1-100 and is never cleared.
  if p_key = 'vote_retention_percent'
     and (v_value is null or v_value !~ '^([1-9][0-9]?|100)$') then
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
$$;

comment on function private.set_org_setting_impl(text, text) is
  '#681, extended by #512, #48, #771, #775 and #824: body of public.set_org_setting. Step 1 trims the value (blank -> null), PT400 value_too_long above 2048 characters, PT400 invalid_org_setting_value for an adherence_form_url that is not http(s), an adunarea_generala_group_id or board_group_id that is not a positive integer, a vote_retention_percent that is not a whole number 1-100 (blank included: y is never cleared), a privacy_notice_version that is not dotted numbers (1.0, 1.1, 2.0.1; blank included: the version is never cleared), or an email_daily_quota that is not a whole number 0-99999 (blank included: the quota is never cleared); then 42501 org_settings_manage_forbidden unless the caller is a live active BC or Moderator (level >= 6, Profile held for share); PT404 org_setting_not_found for an unseeded key; PT400 invalid_org_setting_value for an adunarea_generala_group_id naming no active Group or a board_group_id naming no active Private Group (checked after the gate, so nobody below BC probes Group ids); PT409 nothing_to_update for an unchanged value.';

comment on function public.set_org_setting(text, text) is
  '#681 (ruling R20), extended by #512, #48, #771, #775 and #824: BC or the Moderator sets one organization setting. The value is trimmed and a blank value clears it (null). adherence_form_url must be an http(s) address of at most 2048 characters; #52''s promotion notification reads it. adunarea_generala_group_id must be the id of an active Group -- the Adunarea Generală, whose Group Managers and Group Responsibles (and those of its ancestors) then read the full Evaluation Period ranking. vote_retention_percent must be a whole percentage 1-100 and cannot be cleared -- y, the share of the Voluntar cu Drept de Vot cohort public.retention_ranking marks inside. privacy_notice_version must be dotted numbers (1.0, 1.1) and cannot be cleared; raising it makes every Member acknowledge the Privacy Notice again (#771). email_daily_quota must be a whole number 0-99999 and cannot be cleared: how many Email Digests go out per UTC day (#775; 0 pauses them). board_group_id must be the id of an active Private Group -- the Private Group "Biroul de Conducere", whose Group Responsibles'' position_title Profil shows as their board title (#824); it confers nothing. Records updated_by; the trigger moves updated_at. The Administrare "Perioade de evaluare" panel (#702) calls it. Keys are seeded by migrations: an unknown key is PT404 org_setting_not_found.';
