-- #866: the Voluntar Activ share x and the Adunarea Generală share y are
-- BC-editable (ruling R30).
--
-- R30 (2026-09-28): BC or the Moderator changes x (the top share of the
-- Voluntar Activ cohort) and y (the Vote Retention Threshold, the top share of
-- the Voluntar cu Drept de Vot cohort) from Evaluări de rol -> Praguri, a
-- whole number from 1 to 100 %, every change audited beside the threshold
-- edits. A change applies from the next Role Evaluation: a past run and the
-- threshold it computed are never recomputed.
--
-- Where the values live -- unchanged, on purpose. x stays the `top_percent`
-- Promotion Rule's `percent` (the parameter that names the rule, #49) and y
-- stays `org_settings.vote_retention_percent` (#48). Moving both into
-- `promotion_thresholds` would give "one place" for the panel, but it would
-- empty the top_percent rule of its defining value, drop an org setting whose
-- CHECK already guards the range, and rewrite every reader of both (the
-- ranking core, the #49 and #681 suites, the app) for no behaviour change.
-- What makes the pair coherent instead is the write side: ONE command,
-- public.set_evaluation_percent, is the only way either value changes, and
-- every change is a row of the existing threshold log. To keep it the only
-- way, set_org_setting stops writing y (PT400 org_setting_not_settable); x has
-- had no command since #826 dropped set_promotion_rule.
--
-- What is new:
--   1. promotion_threshold_changes.field ('threshold' | 'percent'): a percent
--      change is always manual (a run never computes a share) and both of its
--      values are whole percentages 1-100. The column defaults to 'threshold'
--      so run_role_evaluation_impl and set_promotion_threshold_impl, which
--      write threshold rows, keep their bodies.
--   2. private.set_evaluation_percent_impl / public.set_evaluation_percent.
--   3. public.evaluation_percents(): both shares in force and each one's last
--      change, for the Praguri panel.
--   4. set_org_setting_impl refuses vote_retention_percent.
--
-- Locks: set_evaluation_percent takes run_role_evaluation's order --
-- pg_advisory_xact_lock(47, 1), then the kind's promotion_thresholds row
-- `for no key update` (the parent row of the log it writes -- conventions
-- section 2), then the value's own row `for no key update` -- so a change can
-- never land between a run's read of the share and its hand-over: the run
-- reads x and y (through private.role_evaluation_rows) only after it holds
-- (47, 1).

-- ---------------------------------------------------------------------------
-- 1. The log learns which value changed.
-- ---------------------------------------------------------------------------
alter table public.promotion_threshold_changes
  add column field text not null default 'threshold';

alter table public.promotion_threshold_changes
  add constraint promotion_threshold_changes_field_ck
    check (field in ('threshold', 'percent')),
  -- A share is BC's alone -- no run computes one -- and a whole 1-100 both ways.
  add constraint promotion_threshold_changes_percent_shape_ck
    check (field <> 'percent'
           or (source = 'manual'
               and to_value between 1 and 100
               and (from_value is null or from_value between 1 and 100)));

comment on column public.promotion_threshold_changes.field is
  '#866 (ruling R30): which value of the kind changed -- threshold (the Promotion Threshold, Task Points; a hand edit or a run''s hand-over) or percent (the kind''s top share: x, the top_percent rule''s percent, for voluntar_activ; y, org_settings.vote_retention_percent, for adunarea_generala; always manual, 1-100). Defaults to threshold, the only value before R30.';

comment on table public.promotion_threshold_changes is
  '#826 (ruling R28), extended by #866 (ruling R30): every change of a Promotion Threshold or of a kind''s top share. field threshold: source manual (BC or the Moderator through set_promotion_threshold; changed_by) or role_evaluation (the value a run computed, handed over; role_evaluation_id). field percent: source manual only, through set_evaluation_percent (changed_by), values 1-100. from_value is the value before (null when none was set). Read by live level >= 6 only; written only by the three commands.';

-- ---------------------------------------------------------------------------
-- 2. The command: set a kind's top share.
-- ---------------------------------------------------------------------------
create function private.set_evaluation_percent_impl(p_kind text, p_percent integer)
returns public.promotion_threshold_changes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid;
  v_from   integer;
  v_change public.promotion_threshold_changes%rowtype;
begin
  -- 1. Malformed for every caller (promotion_rules_percent_range_ck,
  --    org_settings_vote_retention_percent_ck): answered before the gate.
  if p_kind is null or p_kind not in ('voluntar_activ', 'adunarea_generala') then
    raise sqlstate 'PT400' using message = 'invalid_role_evaluation_kind';
  end if;
  if p_percent is null or p_percent < 1 or p_percent > 100 then
    raise sqlstate 'PT400' using message = 'invalid_percent';
  end if;

  -- 2. The gate: claims and a live activ Profile, then BC or Moderator by the
  --    live level (#816), not the claims.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'evaluation_percent_manage_forbidden';
  end;
  if coalesce(private.actor_level(v_actor), -1) < 6 then
    raise exception using errcode = '42501', message = 'evaluation_percent_manage_forbidden';
  end if;

  -- 3. Serialised with every run and threshold edit, in their lock order:
  --    (47, 1), the kind's threshold row, then the value's own row.
  perform pg_catalog.pg_advisory_xact_lock(47, 1);
  perform 1
     from public.promotion_thresholds as setting
    where setting.kind = p_kind
      for no key update;

  if p_kind = 'voluntar_activ' then
    select rule.percent into v_from
      from public.promotion_rules as rule
     where rule.kind = 'top_percent'
       for no key update;
    if not found then
      raise sqlstate 'PT404' using message = 'promotion_rule_not_found';
    end if;
  else
    select setting.value::integer into v_from
      from public.org_settings as setting
     where setting.key = 'vote_retention_percent'
       for no key update;
    if not found then
      raise sqlstate 'PT404' using message = 'org_setting_not_found';
    end if;
  end if;

  -- 4. State.
  if v_from is not distinct from p_percent then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- 5. Write, and audit.
  if p_kind = 'voluntar_activ' then
    update public.promotion_rules
       set percent = p_percent
     where kind = 'top_percent';
  else
    update public.org_settings
       set value = p_percent::text,
           updated_by = v_actor
     where key = 'vote_retention_percent';
  end if;

  insert into public.promotion_threshold_changes (
    kind, field, from_value, to_value, source, changed_by, role_evaluation_id
  ) values (
    p_kind, 'percent', v_from, p_percent, 'manual', v_actor, null
  )
  returning * into v_change;

  return v_change;
end;
$$;

comment on function private.set_evaluation_percent_impl(text, integer) is
  '#866 (ruling R30): body of public.set_evaluation_percent. PT400 invalid_role_evaluation_kind, invalid_percent (null, below 1 or above 100) before the gate; private.require_active_member() and live level >= 6, every refusal 42501 evaluation_percent_manage_forbidden; pg_advisory_xact_lock(47, 1), shared with run_role_evaluation and set_promotion_threshold, then the kind''s promotion_thresholds row and the value''s row (the top_percent rule, or the vote_retention_percent setting) for no key update -- PT404 promotion_rule_not_found / org_setting_not_found if either is missing; PT409 nothing_to_update for an unchanged value. Writes the value (with updated_by on the setting) and one promotion_threshold_changes row, field percent, source manual, changed_by the caller; returns that row.';

create function public.set_evaluation_percent(p_kind text, p_percent integer)
returns public.promotion_threshold_changes
language sql
security invoker
set search_path = ''
as $$
  select * from private.set_evaluation_percent_impl(p_kind, p_percent);
$$;

comment on function public.set_evaluation_percent(text, integer) is
  '#866 (ruling R30): BC or the Moderator sets the top share of one Role Evaluation kind -- voluntar_activ: x, the share of the Voluntar Activ cohort (the top_percent Promotion Rule''s percent); adunarea_generala: y, the Vote Retention Threshold (org_settings.vote_retention_percent) -- a whole percentage 1-100, at any time. It applies from the kind''s next Role Evaluation: the share decides which holder''s Task Points become the threshold that run computes; past runs are not recomputed. The only write path for either value; every change is logged in promotion_threshold_changes (field percent) with its author. 42501 evaluation_percent_manage_forbidden; PT400 invalid_role_evaluation_kind, invalid_percent; PT409 nothing_to_update. Returns the log row.';

revoke execute on function private.set_evaluation_percent_impl(text, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.set_evaluation_percent(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.set_evaluation_percent_impl(text, integer) to authenticated;
grant execute on function public.set_evaluation_percent(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The read: both shares and their last change.
-- ---------------------------------------------------------------------------
create function public.evaluation_percents()
returns table (kind text, percent integer, changed_at timestamptz, changed_by uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select share.kind,
         case share.kind
           when 'voluntar_activ' then
             (select rule.percent
                from public.promotion_rules as rule
               where rule.kind = 'top_percent')
           else
             (select setting.value::integer
                from public.org_settings as setting
               where setting.key = 'vote_retention_percent')
         end,
         last_change.changed_at,
         last_change.changed_by
    from (values ('voluntar_activ', 1), ('adunarea_generala', 2)) as share (kind, ord)
    left join lateral (
      select change.changed_at, change.changed_by
        from public.promotion_threshold_changes as change
       where change.kind = share.kind
         and change.field = 'percent'
       order by change.changed_at desc, change.id desc
       limit 1
    ) as last_change on true
   order by share.ord;
$$;

comment on function public.evaluation_percents() is
  '#866 (ruling R30): one row per Role Evaluation kind, voluntar_activ first -- percent, the top share in force (x: the top_percent rule''s percent; y: org_settings.vote_retention_percent), and changed_at / changed_by of its last set_evaluation_percent (null before any). Security invoker: the shares read under promotion_rules_read / org_settings_read (every live active Member; null for a claimless or deactivated session) and the last change under promotion_threshold_changes_read (live level >= 6; null for everyone else).';

revoke execute on function public.evaluation_percents()
  from public, anon, authenticated, service_role;
grant execute on function public.evaluation_percents() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. set_org_setting no longer writes y. Rebuilt from #824's body
-- (20260928090000_board_group_setting.sql, the latest definition on main);
-- what changes is step 1's vote_retention_percent branch, which now refuses
-- the key for every caller instead of validating it.
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
  -- #866 (ruling R30): y changes only through public.set_evaluation_percent,
  -- which logs it -- no value of this key is ever accepted here.
  if p_key = 'vote_retention_percent' then
    raise sqlstate 'PT400' using message = 'org_setting_not_settable',
      hint = 'Use public.set_evaluation_percent(''adunarea_generala'', <1-100>).';
  end if;
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
  '#681, extended by #512, #48, #771, #775, #824 and #866: body of public.set_org_setting. Step 1 refuses vote_retention_percent outright (PT400 org_setting_not_settable: since ruling R30, y changes only through public.set_evaluation_percent, which logs it), trims the value (blank -> null), PT400 value_too_long above 2048 characters, PT400 invalid_org_setting_value for an adherence_form_url that is not http(s), an adunarea_generala_group_id or board_group_id that is not a positive integer, a privacy_notice_version that is not dotted numbers (1.0, 1.1, 2.0.1; blank included: the version is never cleared), or an email_daily_quota that is not a whole number 0-99999 (blank included: the quota is never cleared); then 42501 org_settings_manage_forbidden unless the caller is a live active BC or Moderator (level >= 6, Profile held for share); PT404 org_setting_not_found for an unseeded key; PT400 invalid_org_setting_value for an adunarea_generala_group_id naming no active Group or a board_group_id naming no active Private Group (checked after the gate, so nobody below BC probes Group ids); PT409 nothing_to_update for an unchanged value.';

comment on function public.set_org_setting(text, text) is
  '#681 (ruling R20), extended by #512, #48, #771, #775, #824 and #866: BC or the Moderator sets one organization setting. The value is trimmed and a blank value clears it (null). adherence_form_url must be an http(s) address of at most 2048 characters; #52''s promotion notification reads it. adunarea_generala_group_id must be the id of an active Group -- the Adunarea Generală, whose Group Managers and Group Responsibles (and those of its ancestors) then read the full Role Evaluation ranking. vote_retention_percent is not set here: PT400 org_setting_not_settable -- public.set_evaluation_percent(''adunarea_generala'', n) changes y and logs it (ruling R30). privacy_notice_version must be dotted numbers (1.0, 1.1) and cannot be cleared; raising it makes every Member acknowledge the Privacy Notice again (#771). email_daily_quota must be a whole number 0-99999 and cannot be cleared: how many Email Digests go out per UTC day (#775; 0 pauses them). board_group_id must be the id of an active Private Group -- the Private Group "Biroul de Conducere", whose Group Responsibles'' position_title Profil shows as their board title (#824); it confers nothing. Records updated_by; the trigger moves updated_at. Keys are seeded by migrations: an unknown key is PT404 org_setting_not_found.';

comment on table public.org_settings is
  '#681 (ruling R20): organization-wide settings BC sets from the app instead of a migration. Every live active Member reads every row; the write path is public.set_org_setting (BC/Moderator), except vote_retention_percent, which only public.set_evaluation_percent writes (#866, ruling R30). Keys are reference data seeded by migrations. adherence_form_url: the adherence form link #52''s promotion notification carries (null until BC sets it). adunarea_generala_group_id (#512): the id of the Group that is the Adunarea Generală -- its Group Managers and Group Responsibles, and those of its ancestors, read the full Role Evaluation ranking (private.can_read_evaluation_rankings); null until BC sets it. vote_retention_percent (#48, #866): y, the Vote Retention Threshold -- the top share, a whole percentage 1-100, of the Voluntar cu Drept de Vot cohort whose boundary an Adunarea Generală Role Evaluation computes as its next threshold; seeded 25 (R20''s placeholder), never null, BC-editable through set_evaluation_percent with every change in promotion_threshold_changes. privacy_notice_version (#771, ruling L16): the current version of the Privacy Notice every Member acknowledges once (public.acknowledge_privacy_notice); dotted numbers such as 1.0 or 1.1, never null; bumping it re-asks everyone. email_daily_quota (#775): how many Email Digests may be sent per UTC day, a whole number 0-99999 (0 pauses the digest), never null; seeded 90, leaving Resend''s free daily cap of 100 room for sign-in emails. board_group_id (#824, decision D1): the id of the Private Group "Biroul de Conducere", whose Group Responsibles'' position_title is each BC/BCE member''s board title on Profil (Funcția în OSUBB); read by Profil only, never an authority input; null until BC sets it.';

comment on column public.promotion_rules.percent is
  '#49, amended by #826 and #866: top_percent only -- x, the share of the Voluntar Activ cohort whose last holder''s Task Points become the Voluntar Activ Promotion Threshold computed by a Role Evaluation. Written only by public.set_evaluation_percent (ruling R30), every change logged in promotion_threshold_changes. Null for time.';
