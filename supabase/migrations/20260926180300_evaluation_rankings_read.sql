-- #512: the Adunarea Generală's eligibility data -- who reads the full Evaluation Period ranking.
--
-- ADR-0009 §Other rulings retires is_interne: Interne tracks AG eligibility
-- as the Group Responsibles of the Adunarea Generală, an ordinary Appointment
-- into an ordinary Group. So the full read belongs to BC and the Moderator
-- (live level >= 6) and to whoever holds group_role manager or responsible on
-- the Adunarea Generală Group or on any ancestor of it -- read from
-- groups.path, as the Wave 2 authority helpers read it
-- (private.can_read_group_roster: held.group_id = any (target.path)). Never
-- from a rank below 6, never from level 4 or the retired responsabil value,
-- and never from a flag. Every other live active Member reads their own row
-- alone: their standing in the Period. This replaces #47's interim branch
-- ("every row for level >= 5"), so a BCE without a Group Role on that path
-- now reads only their own row.
--
-- Which Group is the Adunarea Generală. BC creates and names it (ADR-0009
-- §Groups, CONTEXT.md), so the predicate may not match a name; and it is not
-- the Organization Group (groups.is_organization marks "OSUBB", Automatic
-- Membership at Minimum Level 0 -- the Adunarea Generală is a separate Group
-- at Minimum Level 3). Nothing identified its row yet, so this migration adds
-- the smallest identifier ruling R20 already provides for: one organization
-- setting, adunarea_generala_group_id, whose value is the Group's id. BC or
-- the Moderator points it at the Group through the existing
-- public.set_org_setting -- no new command, no new column on groups, no
-- change to update_group_structure's signature. Empty (null) until set: then
-- only level >= 6 reads every row. The value is shaped by a table CHECK (a
-- positive integer that fits a bigint) and, when set through the command,
-- must name an existing active Group (PT400 invalid_org_setting_value). An
-- archived Group keeps the setting pointing at it until BC re-points it:
-- authority follows the setting, as it follows the roster, and the roster
-- predicate it mirrors does not read status either.
--
-- Boundary: visibility only. No ranking, no signal and no Role change is
-- created here (#47 ranks, #48 the retention ranking, #51 the Retention
-- Signals, #52 the notifications, #105 Drept de Vot). The Promotion Threshold
-- in force (#49) stays readable by every live active Member: it is the goal a
-- Voluntar works toward during the Period (ADR-0004 amended 2026-09-21), not
-- eligibility data about anyone.
--
-- Reuse: #48's retention ranking gates its full read on
-- private.can_read_evaluation_rankings() with the same own-row branch as
-- private.evaluation_period_ranking_impl below. The predicate is granted to
-- nobody: it is read from security-definer bodies only.

-- ---------------------------------------------------------------------------
-- The setting that names the Adunarea Generală Group.
-- ---------------------------------------------------------------------------
alter table public.org_settings
  add constraint org_settings_adunarea_generala_group_id_ck
  check (key <> 'adunarea_generala_group_id' or value is null or value ~ '^[1-9][0-9]{0,17}$');

insert into public.org_settings (key, value) values ('adunarea_generala_group_id', null);

comment on table public.org_settings is
  '#681 (ruling R20): organization-wide settings BC sets from the app instead of a migration. Every live active Member reads every row; the only write path is public.set_org_setting (BC/Moderator). Keys are reference data seeded by migrations. adherence_form_url: the adherence form link #52''s promotion notification carries (null until BC sets it). adunarea_generala_group_id (#512): the id of the Group that is the Adunarea Generală -- its Group Managers and Group Responsibles, and those of its ancestors, read the full Evaluation Period ranking (private.can_read_evaluation_rankings); null until BC sets it.';

-- ---------------------------------------------------------------------------
-- The read predicate.
-- ---------------------------------------------------------------------------
create function private.can_read_evaluation_rankings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and (private.caller_level() >= 6
          or (private.caller_level() >= 0
              and exists (
                select 1
                  from public.groups as target
                  join public.group_members as held
                    on held.group_id = any (target.path)
                 where target.id = (
                         select case when setting.value ~ '^[1-9][0-9]{0,17}$'
                                     then setting.value::bigint end
                           from public.org_settings as setting
                          where setting.key = 'adunarea_generala_group_id')
                   and held.member_id = (select auth.uid())
                   and held.group_role in ('manager', 'responsible'))));
$$;

comment on function private.can_read_evaluation_rankings() is
  '#512 (ADR-0009 §Other rulings): whether the caller reads the Adunarea Generală''s eligibility data in full -- every row of an Evaluation Period ranking, and #48''s retention ranking. True for a caller with organization claims (house rule 12) who is live active at level >= 6 (BC, Moderator), or live active and holding group_role manager or responsible on the Adunarea Generală Group or on any ancestor of it (held.group_id = any (target.path), as private.can_read_group_roster reads authority down the chain). The Adunarea Generală is identified by its row, never by its name: org_settings.adunarea_generala_group_id, which BC sets through public.set_org_setting; null there means only level >= 6 reads everything. Authority is the live roster and level >= 6, nothing else. Granted to nobody: read from security-definer bodies (private.evaluation_period_ranking_impl, #48).';

revoke execute on function private.can_read_evaluation_rankings()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The ranking the caller may read: #47's body with the full-read branch
-- replaced by the predicate.
-- ---------------------------------------------------------------------------
create or replace function private.evaluation_period_ranking_impl(p_period_id bigint)
returns table (member_id uuid, task_points integer, rank integer)
language sql
stable
security definer
set search_path = ''
as $$
  select ranked.member_id, ranked.task_points, ranked.rank
    from private.evaluation_period_ranking_rows(p_period_id) as ranked
   where (select public.auth_is_member())
     and (select private.caller_level()) >= 0
     and (ranked.member_id = (select auth.uid())
          or (select private.can_read_evaluation_rankings()))
   order by ranked.task_points desc, ranked.member_id;
$$;

comment on function private.evaluation_period_ranking_impl(bigint) is
  '#47, narrowed by #512: body of public.evaluation_period_ranking. private.evaluation_period_ranking_rows filtered for the caller: nothing without organization claims or a live activ Profile (house rule 12, ADR-0003''s stale-token window); the caller''s own row, carrying their rank among every Member, for any active Member; every row when private.can_read_evaluation_rankings() holds -- BC and Moderator, and the Group Managers and Group Responsibles of the Adunarea Generală or of an ancestor of it. Level 5 alone reads its own row only.';

comment on function public.evaluation_period_ranking(bigint) is
  '#47, narrowed by #512: the Task-Point ranking of one Evaluation Period -- member_id, task_points (net, from Evaluations whose instant falls in [opened_at, closed_at)), rank (shared on ties, counted among every Member). A Member reads their own row; BC, Moderator and the Adunarea Generală''s Group Managers and Group Responsibles (and those of its ancestors) read every row (private.can_read_evaluation_rankings); a claimless or deactivated session reads nothing. The open Period is the evaluation_periods row with closed_at null.';

-- ---------------------------------------------------------------------------
-- set_org_setting learns the new key. Rebuilt from #681's body
-- (20260924053559_org_settings.sql, its only definition); what is new is the
-- adunarea_generala_group_id shape in step 1 and its target check after the
-- gate, so a caller below BC cannot probe which Group ids exist.
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
  -- #512: a Group id is a positive integer that fits a bigint.
  if p_key = 'adunarea_generala_group_id'
     and v_value is not null
     and v_value !~ '^[1-9][0-9]{0,17}$' then
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
  -- #512: the Adunarea Generală is an existing, active Group. `for key share`
  -- keeps the row from being deleted under the write without blocking the
  -- `for no key update` every Group command takes on a Group row.
  if p_key = 'adunarea_generala_group_id' and v_value is not null then
    perform 1
      from public.groups as grp
     where grp.id = v_value::bigint
       and grp.status = 'active'
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
  '#681, extended by #512: body of public.set_org_setting. Step 1 trims the value (blank -> null), PT400 value_too_long above 2048 characters, PT400 invalid_org_setting_value for an adherence_form_url that is not http(s) or an adunarea_generala_group_id that is not a positive integer; then 42501 org_settings_manage_forbidden unless the caller is a live active BC or Moderator (level >= 6, Profile held for share); PT404 org_setting_not_found for an unseeded key; PT400 invalid_org_setting_value for an adunarea_generala_group_id naming no active Group (checked after the gate, so nobody below BC probes Group ids); PT409 nothing_to_update for an unchanged value.';

comment on function public.set_org_setting(text, text) is
  '#681 (ruling R20), extended by #512: BC or the Moderator sets one organization setting. The value is trimmed and a blank value clears it (null). adherence_form_url must be an http(s) address of at most 2048 characters; #52''s promotion notification reads it. adunarea_generala_group_id must be the id of an active Group -- the Adunarea Generală, whose Group Managers and Group Responsibles (and those of its ancestors) then read the full Evaluation Period ranking. Records updated_by; the trigger moves updated_at. The Administrare "Perioade de evaluare" panel (#702) calls it. Keys are seeded by migrations: an unknown key is PT404 org_setting_not_found.';
