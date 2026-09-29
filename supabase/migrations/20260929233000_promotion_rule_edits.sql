-- #935: BC or the Moderator edits each Promotion Rule's tenure and turns it
-- on or off, from Evaluări de rol -> Praguri, every change audited beside the
-- threshold and share edits (amends ruling R28).
--
-- R28 retired set_promotion_rule, so since #826 the two rules' tenure
-- (min_tenure_months) and their on/off flag (enabled) changed only by
-- migration. Alex (2026-09-29): "Yes, next to Praguri."
--
-- What the two values already do -- unchanged, and read live:
--   * the time rule (Recrut -> Voluntar): private.detect_promotions, behind the
--     daily job osubb-apply-promotions, reads min_tenure_months and enabled on
--     every run, so an edit applies from the next daily run;
--   * the top_percent rule (Voluntar -> Voluntar Activ): a Voluntar Activ Role
--     Evaluation ranks the Voluntars holding its min_tenure_months
--     (private.role_evaluation_rows) and lists Promotion Candidates only while
--     it is enabled (run_role_evaluation_impl), so an edit applies from the
--     next run; past runs are never recomputed.
--
-- What is new:
--   1. promotion_threshold_changes logs rule edits too: field tenure (whole
--      months 0-120, the table's promotion_rules_tenure_range_ck) or enabled
--      (0 off, 1 on), always manual, naming the rule (promotion_rule_id) in
--      place of a Role Evaluation kind -- the time rule belongs to no kind.
--   2. private.update_promotion_rule_impl / public.update_promotion_rule:
--      one command sets both values of one rule atomically, as the Praguri
--      row saves them, with one log row per value that changed.
--
-- Locks: the command takes pg_advisory_xact_lock(47, 1) -- shared with
-- run_role_evaluation, set_promotion_threshold and set_evaluation_percent --
-- then the rule's row `for no key update` (the parent row of the log it
-- writes -- conventions section 2), so a change never lands between a run's
-- read of the tenure (the ranking) and its read of enabled (the candidates).
-- It then takes the daily job's pg_advisory_xact_lock(52, 1), so a change
-- never commits between the job's detection (private.detect_promotions) and
-- its application of what it detected: an edit applies from the next daily
-- run. The job takes (52, 1) alone and never (47, 1), so the order
-- (47, 1) -> (52, 1) -> the rule row cannot deadlock with it.

-- ---------------------------------------------------------------------------
-- 1. The log learns rule edits.
-- ---------------------------------------------------------------------------
alter table public.promotion_threshold_changes
  add column promotion_rule_id bigint references public.promotion_rules (id);

-- A rule edit has no Role Evaluation kind (the time rule belongs to none).
alter table public.promotion_threshold_changes
  alter column kind drop not null;

alter table public.promotion_threshold_changes
  drop constraint promotion_threshold_changes_field_ck,
  drop constraint promotion_threshold_changes_to_value_range_ck;

alter table public.promotion_threshold_changes
  add constraint promotion_threshold_changes_field_ck
    check (field in ('threshold', 'percent', 'tenure', 'enabled')),
  -- A threshold is at least 1 Task Point; a share has its own 1-100 check
  -- (promotion_threshold_changes_percent_shape_ck); a tenure may be 0 and
  -- enabled is 0 or 1.
  add constraint promotion_threshold_changes_to_value_range_ck
    check (field <> 'threshold' or to_value >= 1),
  -- A threshold or share change names its kind; a rule change names its rule.
  add constraint promotion_threshold_changes_subject_ck
    check ((field in ('threshold', 'percent')
            and kind is not null and promotion_rule_id is null)
        or (field in ('tenure', 'enabled')
            and kind is null and promotion_rule_id is not null)),
  -- A tenure is BC's alone -- no run changes one -- whole months 0-120 both ways.
  add constraint promotion_threshold_changes_tenure_shape_ck
    check (field <> 'tenure'
           or (source = 'manual'
               and from_value is not null and from_value between 0 and 120
               and to_value between 0 and 120)),
  -- On/off is BC's alone: 0 off, 1 on, and a row is always a flip.
  add constraint promotion_threshold_changes_enabled_shape_ck
    check (field <> 'enabled'
           or (source = 'manual'
               and from_value in (0, 1)
               and to_value in (0, 1)
               and from_value <> to_value));

create index promotion_threshold_changes_rule_idx
  on public.promotion_threshold_changes (promotion_rule_id, changed_at desc, id desc)
  where promotion_rule_id is not null;

comment on column public.promotion_threshold_changes.field is
  '#866 (ruling R30), extended by #935: which value changed. threshold (the Promotion Threshold of kind, Task Points; a hand edit or a run''s hand-over) or percent (the kind''s top share: x, the top_percent rule''s percent, for voluntar_activ; y, org_settings.vote_retention_percent, for adunarea_generala; always manual, 1-100) name a kind; tenure (the rule''s min_tenure_months, whole months 0-120) or enabled (the rule''s on/off flag, 0 off and 1 on, always a flip) name a Promotion Rule (promotion_rule_id) and are always manual. Defaults to threshold, the only value before R30.';
comment on column public.promotion_threshold_changes.kind is
  '#826: the Role Evaluation kind whose threshold or share changed (field threshold or percent). Null for a Promotion Rule edit (field tenure or enabled, #935), which names promotion_rule_id instead.';
comment on column public.promotion_threshold_changes.promotion_rule_id is
  '#935: the Promotion Rule whose tenure or on/off flag changed (field tenure or enabled); null for a threshold or share change.';

comment on table public.promotion_threshold_changes is
  '#826 (ruling R28), extended by #866 (ruling R30) and #935: every change of a Promotion Threshold, of a kind''s top share, or of a Promotion Rule''s tenure or on/off flag. field threshold: source manual (BC or the Moderator through set_promotion_threshold; changed_by) or role_evaluation (the value a run computed, handed over; role_evaluation_id). field percent: source manual only, through set_evaluation_percent, values 1-100. field tenure / enabled: source manual only, through update_promotion_rule, naming promotion_rule_id instead of a kind; tenure in whole months 0-120, enabled 0 (off) or 1 (on). from_value is the value before (null only for a threshold never set). Read by live level >= 6 only; written only by the four commands.';

-- ---------------------------------------------------------------------------
-- 2. The command: set one rule's tenure and on/off flag.
-- ---------------------------------------------------------------------------
create function private.update_promotion_rule_impl(
  p_rule_id bigint,
  p_min_tenure_months integer,
  p_enabled boolean
)
returns public.promotion_rules
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_rule  public.promotion_rules%rowtype;
begin
  -- 1. Malformed for every caller (promotion_rules_tenure_range_ck): answered
  --    before the gate.
  if p_min_tenure_months is null or p_min_tenure_months < 0 or p_min_tenure_months > 120 then
    raise sqlstate 'PT400' using message = 'invalid_tenure_months';
  end if;
  if p_enabled is null then
    raise sqlstate 'PT400' using message = 'invalid_promotion_rule_enabled';
  end if;

  -- 2. The gate: claims and a live activ Profile, then BC or Moderator by the
  --    live level (#816), not the claims.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'promotion_rule_manage_forbidden';
  end;
  if coalesce(private.actor_level(v_actor), -1) < 6 then
    raise exception using errcode = '42501', message = 'promotion_rule_manage_forbidden';
  end if;

  -- 3. Serialised with every run and every threshold or share edit, in their
  --    lock order: (47, 1), the daily job's (52, 1), then the rule's row.
  perform pg_catalog.pg_advisory_xact_lock(47, 1);
  -- The daily job's lock: never between its detection and its application.
  perform pg_catalog.pg_advisory_xact_lock(52, 1);
  select * into v_rule
    from public.promotion_rules as rule
   where rule.id = p_rule_id
     for no key update;
  if not found then
    raise sqlstate 'PT404' using message = 'promotion_rule_not_found';
  end if;

  -- 4. State.
  if v_rule.min_tenure_months = p_min_tenure_months and v_rule.enabled = p_enabled then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- 5. Audit each value that changes, then write.
  if v_rule.min_tenure_months <> p_min_tenure_months then
    insert into public.promotion_threshold_changes (
      kind, field, promotion_rule_id, from_value, to_value, source, changed_by, role_evaluation_id
    ) values (
      null, 'tenure', v_rule.id, v_rule.min_tenure_months, p_min_tenure_months, 'manual', v_actor, null
    );
  end if;
  if v_rule.enabled <> p_enabled then
    insert into public.promotion_threshold_changes (
      kind, field, promotion_rule_id, from_value, to_value, source, changed_by, role_evaluation_id
    ) values (
      null, 'enabled', v_rule.id, v_rule.enabled::integer, p_enabled::integer, 'manual', v_actor, null
    );
  end if;

  update public.promotion_rules
     set min_tenure_months = p_min_tenure_months,
         enabled = p_enabled
   where id = v_rule.id
  returning * into v_rule;

  return v_rule;
end;
$$;

comment on function private.update_promotion_rule_impl(bigint, integer, boolean) is
  '#935: body of public.update_promotion_rule. PT400 invalid_tenure_months (null, below 0 or above 120), invalid_promotion_rule_enabled (null) before the gate; private.require_active_member() and live level >= 6, every refusal 42501 promotion_rule_manage_forbidden; pg_advisory_xact_lock(47, 1), shared with run_role_evaluation, set_promotion_threshold and set_evaluation_percent, then the daily job''s (52, 1), then the rule''s row for no key update -- PT404 promotion_rule_not_found for an unknown or null id; PT409 nothing_to_update when both values are unchanged. Writes one promotion_threshold_changes row per changed value (field tenure: months; field enabled: 0 off, 1 on; source manual, changed_by the caller, promotion_rule_id the rule, no kind), then both values; returns the rule.';

create function public.update_promotion_rule(
  p_rule_id bigint,
  p_min_tenure_months integer,
  p_enabled boolean
)
returns public.promotion_rules
language sql
security invoker
set search_path = ''
as $$
  select * from private.update_promotion_rule_impl(p_rule_id, p_min_tenure_months, p_enabled);
$$;

comment on function public.update_promotion_rule(bigint, integer, boolean) is
  '#935 (amends ruling R28): BC or the Moderator sets one Promotion Rule''s tenure -- whole months 0-120 from profiles.joined_at -- and whether it is on, together, at any time. The time rule (Recrut -> Voluntar) applies from the next daily osubb-apply-promotions run: on, every live active Recrut with the tenure becomes Voluntar; off, nobody does. The top_percent rule (Voluntar -> Voluntar Activ) applies from the next Voluntar Activ Role Evaluation: its tenure decides which Voluntars are ranked and can become Promotion Candidates; off, the run lists none. Past runs are not recomputed. The only write path for either value; every change is logged in promotion_threshold_changes (field tenure or enabled, promotion_rule_id) with its author. 42501 promotion_rule_manage_forbidden; PT400 invalid_tenure_months, invalid_promotion_rule_enabled; PT404 promotion_rule_not_found; PT409 nothing_to_update. Returns the rule.';

revoke execute on function private.update_promotion_rule_impl(bigint, integer, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function public.update_promotion_rule(bigint, integer, boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.update_promotion_rule_impl(bigint, integer, boolean) to authenticated;
grant execute on function public.update_promotion_rule(bigint, integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The rule table says who writes it now.
-- ---------------------------------------------------------------------------
comment on table public.promotion_rules is
  '#49, amended by #826 (ruling R28) and #935: one row per Promotion Rule. kind time: tenure alone, min_tenure_months from profiles.joined_at (Recrut -> Voluntar), applied daily by osubb-apply-promotions. kind top_percent (Voluntar -> Voluntar Activ): min_tenure_months is the tenure a Voluntar needs to be ranked and to become a Promotion Candidate at a Voluntar Activ Role Evaluation; percent is x, the Voluntar Activ cohort''s top share whose boundary becomes the next Voluntar Activ Promotion Threshold (y, for Drept de Vot, is org_settings.vote_retention_percent). enabled false: the rule yields no promotion (time) and no Promotion Candidate (top_percent). At most one top_percent row. Every live active Member reads every row; no client writes one directly: public.update_promotion_rule writes min_tenure_months and enabled (#935), public.set_evaluation_percent writes percent (#866), each change logged in promotion_threshold_changes.';
comment on column public.promotion_rules.min_tenure_months is
  '#49, amended by #935: the required tenure in whole months 0-120, measured from profiles.joined_at (#160). Written only by public.update_promotion_rule, every change logged in promotion_threshold_changes (field tenure).';
comment on column public.promotion_rules.enabled is
  '#49, amended by #826 and #935: whether the rule yields anything -- the daily job''s promotions (time) or a Voluntar Activ Role Evaluation''s Promotion Candidates (top_percent). The ranking, the Retention Signals and the threshold hand-over do not read it. Written only by public.update_promotion_rule, every change logged in promotion_threshold_changes (field enabled).';
