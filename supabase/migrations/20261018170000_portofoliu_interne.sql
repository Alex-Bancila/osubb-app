-- R58 (Alex, 2026-10-18; spec docs/superpowers/specs/2026-10-18-portofoliu-interne-design.md,
-- section C): Portofoliu Interne replaces Evaluări de rol. A Role Evaluation
-- ranks every eligible Member of its kind in one ranking, a Simulation shows
-- that ranking and writes nothing, and the finalised run measures its
-- Promotion Candidates and Retention Signals against the line it computes.
--
-- Sections:
--   0. public.retention_signals: the Retention Signals a finalised run raises,
--      stored (and, later in this migration, the live Universitate one).
--   1. The two shares move home: x and y become evaluation_settings
--      activ_percent / vot_percent, set to 35 / 25 on day one;
--      org_settings.vote_retention_percent goes. set_evaluation_percent,
--      evaluation_percents() and set_org_setting are restated for it.
--   2. public.role_evaluations records the values a run used (Eligibility
--      Floor, share, Membership Cutoff Date) and how many it evaluated; a
--      kind's first run needs no Promotion Threshold in force.
--   3. The ranking core: private.role_evaluation_rows(kind, from, to, floor,
--      percent, cutoff), one ranking of the eligible.
--   4. The two entry points: public.simulate_role_evaluation (writes nothing)
--      and the seven-argument public.run_role_evaluation (the finalised run).
--   5. public.role_evaluation_ranking(role_evaluation_id): the ranking of a
--      recorded run, recomputed from its own values.

-- ---------------------------------------------------------------------------
-- 0. Retention Signals, stored.
-- ---------------------------------------------------------------------------
-- A Retention Signal used to be derived by the page from the ranking; R58
-- decision 16 makes it a row: a finalised run writes one per holder it found
-- not inside (below_line, below_floor), and the Universitate rule writes the
-- one live kind (not_ubb_student, no run). One open row per (kind, Member,
-- reason); a row closes when BC changes the Role, when its fact reverses, or
-- when the next run of its kind supersedes it.
create table public.retention_signals (
  id                 bigint generated always as identity primary key,
  kind               text not null,
  member_id          uuid not null references public.profiles (id),
  role_at_listing    public.member_role not null,
  reason             text not null,
  task_points        integer,
  threshold_used     integer,
  role_evaluation_id bigint references public.role_evaluations (id),
  created_at         timestamptz not null default now(),
  closed_at          timestamptz,
  closed_as          text,
  constraint retention_signals_kind_ck check (kind in ('voluntar_activ', 'adunarea_generala')),
  constraint retention_signals_reason_ck check (reason in ('below_line', 'below_floor', 'not_ubb_student')),
  constraint retention_signals_closed_as_ck
    check (closed_as is null or closed_as in ('role_changed', 'superseded', 'resolved')),
  constraint retention_signals_closed_shape_ck check ((closed_at is null) = (closed_as is null)),
  -- Only the Universitate Signal is live; every points-based one names its run.
  constraint retention_signals_live_reason_ck
    check (role_evaluation_id is not null or reason = 'not_ubb_student'),
  -- A points-based Signal carries the Member's Task Points (its line may be
  -- null: a run that ranked nobody has none); the Universitate one carries
  -- neither number.
  constraint retention_signals_points_shape_ck
    check ((reason = 'not_ubb_student') = (task_points is null and threshold_used is null))
);

alter table public.retention_signals enable row level security;

create unique index retention_signals_open_uidx
  on public.retention_signals (kind, member_id, reason)
  where closed_at is null;

-- Every foreign key is indexed (advisor_findings.test.sql).
create index retention_signals_member_id_idx on public.retention_signals (member_id);
create index retention_signals_role_evaluation_id_idx on public.retention_signals (role_evaluation_id);

revoke all on table public.retention_signals from public, anon, authenticated, service_role;
grant select on table public.retention_signals to authenticated, service_role;

create policy retention_signals_read on public.retention_signals
  for select to authenticated
  using ((select public.auth_is_member()) and (select private.caller_level()) >= 6);

-- ADR-0011: a domain table broadcasts its changes (Portofoliu Interne's
-- Semnale de retenție panel refetches on the signal).
create trigger broadcast_change after insert or update or delete on public.retention_signals
  for each statement execute function private.broadcast_change();

comment on table public.retention_signals is
  'R58 (section C, decision 16): Retention Signals, stored -- the notice that a holder of a Role a Role Evaluation measures (Voluntar Activ and Voluntar cu Drept de Vot for the Voluntar Activ kind, Voluntar cu Drept de Vot for the Adunarea Generală kind) no longer qualifies for it. A finalised run (public.run_role_evaluation) writes one row per holder it found not inside the line it computed -- below_line when ranked under it, below_floor when under the Eligibility Floor -- after superseding the kind''s open points-based rows; the Universitate rule writes the one live kind (not_ubb_student, no run). One open row per (kind, Member, reason). A row closes as role_changed when BC changes the Member''s Role, resolved when its fact reverses, superseded when the next run of its kind replaces it. Nothing changes a Role: BC decides each withdrawal by hand. Read by live level >= 6 only (BC and the Moderator); no client writes it.';
comment on column public.retention_signals.id is
  'R58: the Retention Signal''s id.';
comment on column public.retention_signals.kind is
  'R58: the Role Evaluation kind the Signal belongs to -- voluntar_activ or adunarea_generala (the live Universitate Signal is always adunarea_generala).';
comment on column public.retention_signals.member_id is
  'R58: the holder the Signal is about.';
comment on column public.retention_signals.role_at_listing is
  'R58: the Member''s Role when the Signal was raised -- activ or vot.';
comment on column public.retention_signals.reason is
  'R58: why the holder no longer qualifies -- below_line (ranked, but under the line the run computed), below_floor (under the Eligibility Floor, so not ranked at all; also every holder of a run that ranked nobody) or not_ubb_student (a Voluntar cu Drept de Vot whose Universitate is known and is not Universitatea Babeș-Bolyai; live, no run).';
comment on column public.retention_signals.task_points is
  'R58: the holder''s Task Points in the run''s Evaluation Period; null exactly for not_ubb_student.';
comment on column public.retention_signals.threshold_used is
  'R58: the line the run computed and measured against (the Promotion Threshold it handed over); null for not_ubb_student and for a run that ranked nobody, which has no line.';
comment on column public.retention_signals.role_evaluation_id is
  'R58: the finalised run that raised the Signal; null for the live not_ubb_student Signal (retention_signals_live_reason_ck).';
comment on column public.retention_signals.created_at is
  'R58: when the Signal was raised.';
comment on column public.retention_signals.closed_at is
  'R58: when the Signal closed; null while it is open. Set together with closed_as.';
comment on column public.retention_signals.closed_as is
  'R58: how the Signal closed -- role_changed (BC changed the Member''s Role), superseded (the next run of its kind replaced it) or resolved (its fact reversed, such as the Universitate set back to UBB); null while open.';
comment on policy retention_signals_read on public.retention_signals is
  'R58: BC and the Moderator (live level >= 6, with organization claims -- house rule 12) read every Retention Signal; nobody else reads any. No write policy: the run, the Universitate rule and the Role-change trigger write it.';

-- ---------------------------------------------------------------------------
-- 1. The shares move home.
-- ---------------------------------------------------------------------------
-- x lived on the top_percent Promotion Rule and y in org_settings because x
-- once defined that rule (R30); R58 drops the Promotion Rules, so both move
-- into the evaluation settings row. Seeded from their homes, then set to
-- R58's day-one values, 35 and 25, each logged once as the migration's
-- change (decision 14) -- y is logged even where it was 25 already, so the
-- history says when R58 fixed it.
alter table public.evaluation_settings
  add column activ_percent integer not null default 35,
  add column vot_percent integer not null default 25,
  add constraint evaluation_settings_activ_percent_ck check (activ_percent between 1 and 100),
  add constraint evaluation_settings_vot_percent_ck check (vot_percent between 1 and 100);

update public.evaluation_settings as setting
   set activ_percent = coalesce((select rule.percent
                                   from public.promotion_rules as rule
                                  where rule.kind = 'top_percent'), setting.activ_percent),
       vot_percent = coalesce((select current_value.value::integer
                                 from public.org_settings as current_value
                                where current_value.key = 'vote_retention_percent'), setting.vot_percent)
 where setting.id = 1;

insert into public.promotion_threshold_changes (kind, field, from_value, to_value, source)
select 'voluntar_activ', 'percent', setting.activ_percent, 35, 'migration'
  from public.evaluation_settings as setting
 where setting.id = 1;
insert into public.promotion_threshold_changes (kind, field, from_value, to_value, source)
select 'adunarea_generala', 'percent', setting.vot_percent, 25, 'migration'
  from public.evaluation_settings as setting
 where setting.id = 1;

update public.evaluation_settings
   set activ_percent = 35,
       vot_percent = 25
 where id = 1;

delete from public.org_settings where key = 'vote_retention_percent';
-- The key's own CHECK guards a row that no longer exists.
alter table public.org_settings drop constraint org_settings_vote_retention_percent_ck;

comment on table public.evaluation_settings is
  'R58 (sections B and C): the one row of evaluation settings BC or the Moderator sets from the app -- eligibility_floor (Eligibility Floor, Prag minim), membership_cutoff (Membership Cutoff Date, Data limită de intrare), points_start_date (Points Start Date, Data de început a punctajului) and the two top shares, activ_percent (x, the Voluntar Activ kind) and vot_percent (y, the Adunarea Generală kind). The first three are null on day one; the shares are 35 and 25. Every live active Member reads the row (a Member may know the rules of their own promotion and from when their points count); no client writes it directly: set_eligibility_floor, set_membership_cutoff, set_points_start_date and set_evaluation_percent are the write path, one command per value, and a finalised Role Evaluation writes the Floor, the share and the cutoff it used. Each change is logged in promotion_threshold_changes (fields floor, cutoff, points_start, percent).';
comment on column public.evaluation_settings.activ_percent is
  'R58 (formerly the top_percent Promotion Rule''s percent, #866): x, the share of the Voluntar Activ kind''s ranking whose last Member''s Task Points become the line -- a whole percentage 1-100, 35 on day one. Prefills the run form; set by set_evaluation_percent and written through by a finalised Voluntar Activ run that used another value.';
comment on column public.evaluation_settings.vot_percent is
  'R58 (formerly org_settings.vote_retention_percent, #48/#866): y, the share of the Adunarea Generală kind''s ranking whose last Member''s Task Points become the line -- a whole percentage 1-100, 25 on day one. Prefills the run form; set by set_evaluation_percent and written through by a finalised Adunarea Generală run that used another value.';
comment on column public.evaluation_settings.updated_by is
  'R58: the Member whose command last changed a value; null while the row is still as its migrations left it, and after a finalised Role Evaluation wrote its values through (promotion_threshold_changes names the run).';
comment on column public.promotion_threshold_changes.field is
  '#866 (ruling R30), extended by #935 and R58: which value changed. threshold (the Promotion Threshold of kind, Task Points; a hand edit or a run''s hand-over) or percent (the kind''s top share: x, evaluation_settings.activ_percent, for voluntar_activ; y, evaluation_settings.vot_percent, for adunarea_generala; 1-100; a hand edit, the share a finalised run wrote through, or the day-one change a migration made) name a kind; tenure (the rule''s min_tenure_months, whole months 0-120) or enabled (the rule''s on/off flag, 0 off and 1 on, always a flip) name a Promotion Rule (promotion_rule_id) and are always manual; floor (the Eligibility Floor, Prag minim: Task Points >= 1, in to_value), cutoff (the Membership Cutoff Date, Data limită de intrare) and points_start (the Points Start Date, Data de început a punctajului), the last two dates in from_date / to_date, name neither (evaluation_settings). Defaults to threshold, the only value before R30.';

create or replace function private.set_evaluation_percent_impl(p_kind text, p_percent integer)
 RETURNS public.promotion_threshold_changes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor  uuid;
  v_from   integer;
  v_change public.promotion_threshold_changes%rowtype;
begin
  -- 1. Malformed for every caller (evaluation_settings_activ_percent_ck,
  --    evaluation_settings_vot_percent_ck): answered before the gate.
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
  --    (47, 1), the kind's threshold row, then the evaluation_settings row,
  --    where both shares live since R58.
  perform pg_catalog.pg_advisory_xact_lock(47, 1);
  perform 1
     from public.promotion_thresholds as setting
    where setting.kind = p_kind
      for no key update;

  select case p_kind when 'voluntar_activ' then setting.activ_percent else setting.vot_percent end
    into v_from
    from public.evaluation_settings as setting
   where setting.id = 1
     for no key update;

  -- 4. State.
  if v_from is not distinct from p_percent then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- 5. Write, and audit.
  update public.evaluation_settings
     set activ_percent = case when p_kind = 'voluntar_activ' then p_percent else activ_percent end,
         vot_percent = case when p_kind = 'adunarea_generala' then p_percent else vot_percent end,
         updated_by = v_actor
   where id = 1;

  insert into public.promotion_threshold_changes (
    kind, field, from_value, to_value, source, changed_by, role_evaluation_id
  ) values (
    p_kind, 'percent', v_from, p_percent, 'manual', v_actor, null
  )
  returning * into v_change;

  return v_change;
end;
$function$;

comment on function private.set_evaluation_percent_impl(text, integer) is
  '#866 (ruling R30), moved home by R58: body of public.set_evaluation_percent. PT400 invalid_role_evaluation_kind, invalid_percent (null, below 1 or above 100) before the gate; private.require_active_member() and live level >= 6, every refusal 42501 evaluation_percent_manage_forbidden; pg_advisory_xact_lock(47, 1), shared with run_role_evaluation, set_promotion_threshold and the evaluation-settings commands, then the kind''s promotion_thresholds row and the evaluation_settings row for no key update; PT409 nothing_to_update for an unchanged value. Writes evaluation_settings.activ_percent (voluntar_activ) or vot_percent (adunarea_generala) with updated_by and one promotion_threshold_changes row, field percent, source manual, changed_by the caller; returns that row.';
comment on function public.set_evaluation_percent(text, integer) is
  '#866 (ruling R30), moved home by R58: BC or the Moderator sets the top share of one Role Evaluation kind -- voluntar_activ: x (evaluation_settings.activ_percent); adunarea_generala: y (evaluation_settings.vot_percent) -- a whole percentage 1-100, at any time. It is the value Portofoliu Interne prefills for the kind''s next run: the share of the eligible Members whose last Task Points become the line; past runs are not recomputed, and a finalised run that used another share writes it through. Every change is logged in promotion_threshold_changes (field percent) with its author. 42501 evaluation_percent_manage_forbidden; PT400 invalid_role_evaluation_kind, invalid_percent; PT409 nothing_to_update. Returns the log row.';

create or replace function public.evaluation_percents()
 RETURNS TABLE(kind text, percent integer, changed_at timestamp with time zone, changed_by uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select share.kind,
         (select case share.kind
                   when 'voluntar_activ' then setting.activ_percent
                   else setting.vot_percent
                 end
            from public.evaluation_settings as setting
           where setting.id = 1),
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
$function$;

comment on function public.evaluation_percents() is
  '#866 (ruling R30), moved home by R58: one row per Role Evaluation kind, voluntar_activ first -- percent, the top share in force (x: evaluation_settings.activ_percent; y: evaluation_settings.vot_percent), and changed_at / changed_by of its last change (a set_evaluation_percent call, a finalised run''s write-through or R58''s day-one migration; changed_by is null for the last two). Security invoker: the shares read under evaluation_settings_read (every live active Member; null for a claimless or deactivated session) and the last change under promotion_threshold_changes_read (live level >= 6; null for everyone else).';

create or replace function private.set_org_setting_impl(p_key text, p_value text)
 RETURNS public.org_settings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

comment on function private.set_org_setting_impl(text, text) is
  '#681, extended by #512, #48, #771, #775, #824 and #866; R58 removed vote_retention_percent: body of public.set_org_setting. Step 1 trims the value (blank -> null), PT400 value_too_long above 2048 characters, PT400 invalid_org_setting_value for an adherence_form_url that is not http(s), an adunarea_generala_group_id or board_group_id that is not a positive integer, a privacy_notice_version that is not dotted numbers (1.0, 1.1, 2.0.1; blank included: the version is never cleared), or an email_daily_quota that is not a whole number 0-99999 (blank included: the quota is never cleared); then 42501 org_settings_manage_forbidden unless the caller is a live active BC or Moderator (level >= 6, Profile held for share); PT404 org_setting_not_found for an unseeded key (vote_retention_percent included: y lives in evaluation_settings since R58); PT400 invalid_org_setting_value for an adunarea_generala_group_id naming no active Group or a board_group_id naming no active Private Group (checked after the gate, so nobody below BC probes Group ids); PT409 nothing_to_update for an unchanged value.';
comment on function public.set_org_setting(text, text) is
  '#681 (ruling R20), extended by #512, #48, #771, #775, #824 and #866: BC or the Moderator sets one organization setting. The value is trimmed and a blank value clears it (null). adherence_form_url must be an http(s) address of at most 2048 characters; #52''s promotion notification reads it. adunarea_generala_group_id must be the id of an active Group -- the Adunarea Generală, whose Group Managers and Group Responsibles (and those of its ancestors) then read the full Role Evaluation ranking. privacy_notice_version must be dotted numbers (1.0, 1.1) and cannot be cleared; raising it makes every Member acknowledge the Privacy Notice again (#771). email_daily_quota must be a whole number 0-99999 and cannot be cleared: how many Email Digests go out per UTC day (#775; 0 pauses them). board_group_id must be the id of an active Private Group -- the Private Group "Biroul de Conducere", whose Group Responsibles'' position_title Profil shows as their board title (#824); it confers nothing. Records updated_by; the trigger moves updated_at. Keys are seeded by migrations: an unknown key is PT404 org_setting_not_found -- vote_retention_percent too since R58, which moved y to evaluation_settings (public.set_evaluation_percent).';
comment on table public.org_settings is
  '#681 (ruling R20): organization-wide settings BC sets from the app instead of a migration. Every live active Member reads every row; the write path is public.set_org_setting (BC/Moderator). Keys are reference data seeded by migrations. adherence_form_url: the adherence form link #52''s promotion notification carries (null until BC sets it). adunarea_generala_group_id (#512): the id of the Group that is the Adunarea Generală -- its Group Managers and Group Responsibles, and those of its ancestors, read the full Role Evaluation ranking (private.can_read_evaluation_rankings); null until BC sets it. privacy_notice_version (#771, ruling L16): the current version of the Privacy Notice every Member acknowledges once (public.acknowledge_privacy_notice); dotted numbers such as 1.0 or 1.1, never null; bumping it re-asks everyone. email_daily_quota (#775): how many Email Digests may be sent per UTC day, a whole number 0-99999 (0 pauses the digest), never null; seeded 90, leaving Resend''s free daily cap of 100 room for sign-in emails. board_group_id (#824, decision D1; #963): the id of the Private Group "Biroul de Conducere", whose Group Responsibles'' position_title is each BC/BCE member''s Board Title -- read by private.board_title for profiles_directory and member_card, and by Profil (Funcția în OSUBB); never an authority input; null until BC sets it. vote_retention_percent (#48, #866) left this table with R58: y is evaluation_settings.vot_percent.';

-- ---------------------------------------------------------------------------
-- 2. The runs carry their values.
-- ---------------------------------------------------------------------------
-- A run records the Eligibility Floor, the share and (Voluntar Activ kind)
-- the Membership Cutoff Date it ranked with, and how many Members it
-- evaluated; ranked_count keeps its meaning, the Members ranked (at or above
-- the Floor). Rows before R58 keep the four new columns null. A kind's first
-- run needs no Promotion Threshold in force (decision 17: a run measures
-- against the line it computes), so threshold_used may be null.
alter table public.role_evaluations
  add column eligibility_floor integer,
  add column percent_used integer,
  add column membership_cutoff date,
  add column evaluated_count integer,
  add constraint role_evaluations_floor_ck check (eligibility_floor is null or eligibility_floor >= 1),
  add constraint role_evaluations_percent_used_ck check (percent_used is null or percent_used between 1 and 100),
  add constraint role_evaluations_evaluated_count_ck check (evaluated_count is null or evaluated_count >= ranked_count);

alter table public.role_evaluations alter column threshold_used drop not null;

comment on table public.role_evaluations is
  '#826 (ruling R28), rebuilt by R58: one row per finalised Role Evaluation BC or the Moderator ran -- an immutable record. kind voluntar_activ or adunarea_generala; the Evaluation Period [period_from, period_to] in inclusive Europe/Bucharest days (Task Evaluations whose evaluated_at falls in it are ranked); who ran it and when; since R58 the values it ranked with (eligibility_floor, percent_used, membership_cutoff for the Voluntar Activ kind) and the Members it evaluated and ranked; the Promotion Threshold in force before it (threshold_used) and the line it computed (threshold_computed), handed over unless BC edits it. A Simulation is never recorded. No overlap or uniqueness rule: a correction run over the same days is legitimate, and the threshold chain follows run_at. Rows up to #826 are the closed Evaluation Periods of the retired open/close model, copied with their ids; rows before R58 carry no Floor, share, cutoff or evaluated count. Every live active Member reads every row; public.run_role_evaluation is the only write path.';
comment on column public.role_evaluations.threshold_used is
  '#826, R58: the kind''s Promotion Threshold in force when the run started -- history only since R58 (decision 17): the run measures against the line it computes, never this one. Null when no threshold was in force (a kind''s first run).';
comment on column public.role_evaluations.threshold_computed is
  '#826, R58: the line the run computed -- the Task Points of the share-th ranked Member (ceil(percent_used x ranked_count / 100), ties at the boundary inside). Its Promotion Candidates and Retention Signals were measured against it, and it was handed over as the kind''s Promotion Threshold. Null when nobody reached the Eligibility Floor (and, before R58, when the holders'' cohort was empty).';
comment on column public.role_evaluations.ranked_count is
  '#826, R58: the Members the run ranked -- since R58, those whose Task Points reached the Eligibility Floor.';
comment on column public.role_evaluations.eligibility_floor is
  'R58: the Eligibility Floor (Prag minim) the run ranked with -- a Member below it was evaluated but not ranked. Null for a run before R58, whose ranking is not recomputed (role_evaluation_ranking returns no rows for it).';
comment on column public.role_evaluations.percent_used is
  'R58: the kind''s top share (x or y, 1-100) the run took over the ranked Members; null before R58.';
comment on column public.role_evaluations.membership_cutoff is
  'R58: the Membership Cutoff Date (Data limită de intrare) a Voluntar Activ run listed Voluntars by -- one who joined on or before it could become a Promotion Candidate. Null for the Adunarea Generală kind, which has none, and before R58.';
comment on column public.role_evaluations.evaluated_count is
  'R58: the Members the run evaluated -- its whole population, ranked or below the Eligibility Floor (at least ranked_count); null before R58.';

-- ---------------------------------------------------------------------------
-- 3. The ranking core.
-- ---------------------------------------------------------------------------
-- R58 decisions 2-4: one ranking per run, not one per Role. The Voluntar
-- Activ kind evaluates every active Member below BCE -- Recruți included,
-- who shape the line though they are never listed -- and the Adunarea
-- Generală kind the Voluntar cu Drept de Vot holders. The Eligibility Floor
-- is the entry gate: below it a Member is evaluated but not ranked and does
-- not shape the line. The tenure rule (joined_at + months) is gone; the
-- Membership Cutoff Date decides who may be listed.
drop function private.role_evaluation_rows(text, date, date, date);

create function private.role_evaluation_rows(
  p_kind text, p_from date, p_to date, p_floor integer, p_percent integer, p_cutoff date)
returns table (member_id uuid, role public.member_role, task_points integer, ranked boolean, rank integer,
               evaluated_count integer, ranked_count integer, share_size integer, line integer,
               inside boolean, listable boolean)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_kind is null or p_kind not in ('voluntar_activ', 'adunarea_generala') then
    raise sqlstate 'PT400' using message = 'invalid_role_evaluation_kind';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise sqlstate 'PT400' using message = 'invalid_date_range';
  end if;
  -- At least 1, so the line -- itself at or above the Floor -- is always a
  -- legal Promotion Threshold.
  if p_floor is null or p_floor < 1 then
    raise sqlstate 'PT400' using message = 'invalid_eligibility_floor';
  end if;
  if p_percent is null or p_percent < 1 or p_percent > 100 then
    raise sqlstate 'PT400' using message = 'invalid_percent';
  end if;
  -- Only the Voluntar Activ kind lists Promotion Candidates, so only it
  -- needs the date a Voluntar must have joined by.
  if p_kind = 'voluntar_activ' and p_cutoff is null then
    raise sqlstate 'PT400' using message = 'membership_cutoff_not_set';
  end if;

  return query
  with points as (
    select earned.member_id, earned.task_points
      from private.task_points_in_range(
             (p_from::timestamp at time zone 'Europe/Bucharest'),
             ((p_to + 1)::timestamp at time zone 'Europe/Bucharest')) as earned
  ),
  -- The population: Task Points 0 when nothing in the range touched them.
  population as (
    select profile.id as member_id,
           profile.role as role,
           profile.joined_at as joined_at,
           coalesce(points.task_points, 0) as task_points,
           coalesce(points.task_points, 0) >= p_floor as ranked
      from public.profiles as profile
      left join points on points.member_id = profile.id
     where profile.status = 'activ'
       and ((p_kind = 'voluntar_activ' and profile.role in ('recrut', 'voluntar', 'activ', 'vot'))
         or (p_kind = 'adunarea_generala' and profile.role = 'vot'))
  ),
  -- Only the ranked get a rank (rank(): ties share it) and a place in the
  -- order the line is read from (Task Points descending, then member_id).
  ordered as (
    select member.*,
           case when member.ranked
                then (rank() over (partition by member.ranked order by member.task_points desc))::int
           end as ranked_rank,
           case when member.ranked
                then (row_number() over (partition by member.ranked
                                         order by member.task_points desc, member.member_id))::int
           end as ranked_place,
           (count(*) over ())::int as evaluated_total,
           (count(*) filter (where member.ranked) over ())::int as ranked_total
      from population as member
  ),
  -- The share is taken over the ranked alone.
  shared as (
    select member.*,
           ceil(p_percent * member.ranked_total / 100.0)::int as share_total
      from ordered as member
  ),
  -- The line: the share-th ranked Member's Task Points (null when nobody
  -- was ranked, the share being 0).
  lined as (
    select member.*,
           max(member.task_points) filter (where member.ranked_place = member.share_total) over () as line_points
      from shared as member
  )
  select member.member_id,
         member.role,
         member.task_points,
         member.ranked,
         member.ranked_rank,
         member.evaluated_total,
         member.ranked_total,
         member.share_total,
         member.line_points,
         -- Everyone at or above the line is inside: ties at the boundary too.
         coalesce(member.ranked and member.task_points >= member.line_points, false),
         coalesce(p_kind = 'voluntar_activ'
                  and member.role = 'voluntar'
                  and member.joined_at is not null
                  and member.joined_at <= p_cutoff, false)
    from lined as member
   order by member.task_points desc, member.member_id;
end;
$$;

comment on function private.role_evaluation_rows(text, date, date, integer, integer, date) is
  'R58 (section C; replaces #826''s per-cohort core): the ranking of one Role Evaluation kind over the Evaluation Period [p_from, p_to] (inclusive Europe/Bucharest days), every row, with the values given -- the Simulation''s rows and the run''s. Live active Members only. voluntar_activ: every Recrut, Voluntar, Voluntar Activ and Voluntar cu Drept de Vot holder, in one ranking; adunarea_generala: every Voluntar cu Drept de Vot holder. task_points is the net in-range total (0 when nothing in range touched them); ranked = task_points >= p_floor (the Eligibility Floor); only ranked rows get rank (rank() by Task Points, ties share it); evaluated_count counts every row and ranked_count the ranked; share_size = ceil(p_percent x ranked_count / 100); line = the Task Points of the share_size-th ranked row by (task_points desc, member_id), null when nobody was ranked; inside = ranked and task_points >= line (ties at the boundary are inside); listable = a Voluntar of the voluntar_activ kind whose joined_at is on or before p_cutoff. Rows ordered by task_points desc, member_id. PT400 invalid_role_evaluation_kind, invalid_date_range, invalid_eligibility_floor (null or below 1), invalid_percent (null or outside 1-100), membership_cutoff_not_set (voluntar_activ without p_cutoff; adunarea_generala ignores it). No visibility rule and no write; granted to nobody.';

revoke execute on function private.role_evaluation_rows(text, date, date, integer, integer, date)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The two entry points.
-- ---------------------------------------------------------------------------
-- Simulare (decision 7): the run form's values ranked and shown, nothing
-- written -- no row, no Notification, no setting. Stable, so it cannot write.
create function private.simulate_role_evaluation_impl(
  p_kind text, p_from date, p_to date, p_floor integer, p_percent integer, p_cutoff date)
returns table (member_id uuid, role public.member_role, task_points integer, ranked boolean, rank integer,
               evaluated_count integer, ranked_count integer, share_size integer, line integer,
               inside boolean, listable boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_actor uuid;
begin
  -- 1. Malformed for every caller: answered before the gate, as the run
  --    answers them.
  if p_kind is null or p_kind not in ('voluntar_activ', 'adunarea_generala') then
    raise sqlstate 'PT400' using message = 'invalid_role_evaluation_kind';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise sqlstate 'PT400' using message = 'invalid_date_range';
  end if;
  if p_to > (now() at time zone 'Europe/Bucharest')::date then
    raise sqlstate 'PT400' using message = 'date_range_in_future';
  end if;
  if p_floor is null or p_floor < 1 then
    raise sqlstate 'PT400' using message = 'invalid_eligibility_floor';
  end if;
  if p_percent is null or p_percent < 1 or p_percent > 100 then
    raise sqlstate 'PT400' using message = 'invalid_percent';
  end if;
  if p_kind = 'voluntar_activ' and p_cutoff is null then
    raise sqlstate 'PT400' using message = 'membership_cutoff_not_set';
  end if;
  -- A cutoff is a day that has begun (set_membership_cutoff's rule).
  if p_cutoff > (now() at time zone 'Europe/Bucharest')::date then
    raise sqlstate 'PT400' using message = 'invalid_membership_cutoff';
  end if;

  -- 2. The gate: claims and a live activ Profile, then BC or Moderator --
  --    the run's gate, since a Simulation shows every Member's standing.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'role_evaluation_manage_forbidden';
  end;
  if coalesce(private.actor_level(v_actor), -1) < 6 then
    raise exception using errcode = '42501', message = 'role_evaluation_manage_forbidden';
  end if;

  -- 3. The ranking, every row. The Adunarea Generală kind has no cutoff.
  return query
  select ranked.member_id,
         ranked.role,
         ranked.task_points,
         ranked.ranked,
         ranked.rank,
         ranked.evaluated_count,
         ranked.ranked_count,
         ranked.share_size,
         ranked.line,
         ranked.inside,
         ranked.listable
    from private.role_evaluation_rows(
           p_kind, p_from, p_to, p_floor, p_percent,
           case when p_kind = 'voluntar_activ' then p_cutoff end) as ranked
   order by ranked.task_points desc, ranked.member_id;
end;
$$;

comment on function private.simulate_role_evaluation_impl(text, date, date, integer, integer, date) is
  'R58: body of public.simulate_role_evaluation. PT400 invalid_role_evaluation_kind / invalid_date_range / date_range_in_future (p_to after today in Europe/Bucharest) / invalid_eligibility_floor / invalid_percent / membership_cutoff_not_set / invalid_membership_cutoff (a cutoff after today) before the gate; private.require_active_member() and live level >= 6, every refusal 42501 role_evaluation_manage_forbidden; then every row of private.role_evaluation_rows with the given values. Stable: it takes no lock and writes nothing.';

create function public.simulate_role_evaluation(
  p_kind text, p_from date, p_to date, p_floor integer, p_percent integer, p_cutoff date default null)
returns table (member_id uuid, role public.member_role, task_points integer, ranked boolean, rank integer,
               evaluated_count integer, ranked_count integer, share_size integer, line integer,
               inside boolean, listable boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
    from private.simulate_role_evaluation_impl(p_kind, p_from, p_to, p_floor, p_percent, p_cutoff)
   order by task_points desc, member_id;
$$;

comment on function public.simulate_role_evaluation(text, date, date, integer, integer, date) is
  'R58 (Simulare): BC or the Moderator ranks one Role Evaluation kind over [p_from, p_to] (inclusive Bucharest days, ending today at the latest) with the Eligibility Floor p_floor, the share p_percent and, for voluntar_activ, the Membership Cutoff Date p_cutoff -- and writes nothing: no run, no Promotion Candidate, no Retention Signal, no Notification, no setting. One row per evaluated Member: role, task_points, ranked (at or above the Floor), rank, evaluated_count, ranked_count, share_size, the line, inside (at or above it) and listable (a Voluntar who joined on or before the cutoff). The would-be Promotion Candidates are the rows listable and inside; the would-be Retention Signals are the holders (activ and vot for voluntar_activ, vot for adunarea_generala) not inside. public.run_role_evaluation with the same values records exactly these rows. 42501 role_evaluation_manage_forbidden; PT400 invalid_role_evaluation_kind, invalid_date_range, date_range_in_future, invalid_eligibility_floor, invalid_percent, membership_cutoff_not_set, invalid_membership_cutoff (a cutoff after today).';

revoke execute on function private.simulate_role_evaluation_impl(text, date, date, integer, integer, date)
  from public, anon, authenticated, service_role;
revoke execute on function public.simulate_role_evaluation(text, date, date, integer, integer, date)
  from public, anon, authenticated, service_role;
grant execute on function private.simulate_role_evaluation_impl(text, date, date, integer, integer, date) to authenticated;
grant execute on function public.simulate_role_evaluation(text, date, date, integer, integer, date) to authenticated;

-- Finalizează: the run with the Simulation's values, recorded. Restated from
-- main's body (20261002120000_live_promotion_candidates.sql) with the
-- swaps R58 names: the core's three values judged at step 1, no threshold
-- in force required, the settings row locked after the threshold row, the
-- Recruți among the locked population, the six-argument ranking, the four
-- new run columns, Candidates and Signals measured against the line this run
-- computes and the Signals stored, the hand-over of that line, and the
-- values used written through to the settings.
drop function public.run_role_evaluation(text, date, date, text);
drop function private.run_role_evaluation_impl(text, date, date, text);

create function private.run_role_evaluation_impl(p_kind text, p_from date, p_to date, p_name text, p_floor integer, p_percent integer, p_cutoff date)
 RETURNS TABLE(role_evaluation_id bigint, candidates integer, retention_signals integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_name        text;
  v_actor       uuid;
  v_today       date;
  v_threshold   public.promotion_thresholds%rowtype;
  v_settings    public.evaluation_settings%rowtype;
  v_cutoff      date;
  v_rows        jsonb;
  v_line        integer;
  v_ranked      integer;
  v_evaluated   integer;
  v_share_was   integer;
  v_run_id      bigint;
  v_candidates  integer := 0;
  v_signals     integer := 0;
  v_leaders     uuid[];
  v_ag_group_id bigint;
  v_span        text;
  v_row         record;
begin
  -- 1. Malformed for every caller: answered before the gate.
  if p_kind is null or p_kind not in ('voluntar_activ', 'adunarea_generala') then
    raise sqlstate 'PT400' using message = 'invalid_role_evaluation_kind';
  end if;
  if p_name is null or p_name !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_role_evaluation_name';
  end if;
  v_name := pg_catalog.regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  perform private.require_text_length('name', v_name, 3, 120);
  if p_from is null or p_to is null or p_to < p_from then
    raise sqlstate 'PT400' using message = 'invalid_date_range';
  end if;
  v_today := (now() at time zone 'Europe/Bucharest')::date;
  if p_to > v_today then
    raise sqlstate 'PT400' using message = 'date_range_in_future';
  end if;
  -- R58: the values the run ranks with, judged as the core judges them.
  if p_floor is null or p_floor < 1 then
    raise sqlstate 'PT400' using message = 'invalid_eligibility_floor';
  end if;
  if p_percent is null or p_percent < 1 or p_percent > 100 then
    raise sqlstate 'PT400' using message = 'invalid_percent';
  end if;
  if p_kind = 'voluntar_activ' and p_cutoff is null then
    raise sqlstate 'PT400' using message = 'membership_cutoff_not_set';
  end if;
  -- A cutoff is a day that has begun, as set_membership_cutoff demands of
  -- the value this run writes through.
  if p_cutoff > v_today then
    raise sqlstate 'PT400' using message = 'invalid_membership_cutoff';
  end if;
  -- The Adunarea Generală kind has no Membership Cutoff Date: one passed
  -- with it is neither used nor recorded.
  v_cutoff := case when p_kind = 'voluntar_activ' then p_cutoff end;

  -- 2. The gate: claims and a live activ Profile, then BC or Moderator.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'role_evaluation_manage_forbidden';
  end;
  if coalesce(private.actor_level(v_actor), -1) < 6 then
    raise exception using errcode = '42501', message = 'role_evaluation_manage_forbidden';
  end if;

  -- 3. Runs, threshold, share and settings edits serialise here, then the
  --    kind's threshold row, then the settings row the run writes through.
  --    R58: no line in force is needed -- the run measures against the line
  --    it computes, so a kind's first run needs none.
  perform pg_catalog.pg_advisory_xact_lock(47, 1);
  select * into v_threshold
    from public.promotion_thresholds as setting
   where setting.kind = p_kind
   for no key update;
  select * into v_settings
    from public.evaluation_settings as setting
   where setting.id = 1
   for no key update;

  -- 4. Role changes wait for this run: set_member_role locks the Profile `for
  -- update` and its role_history trigger then closes candidates, so taking
  -- the population's Profiles `for key share` here (Profiles first,
  -- candidates after -- the order set_member_role uses) keeps the ranking
  -- below from listing a Member promoted underneath it, and the candidate
  -- insert's FK check from deadlocking against that promotion.
  perform 1
     from public.profiles as profile
    where profile.status = 'activ'
      and profile.role in ('recrut', 'voluntar', 'activ', 'vot')
    order by profile.id
      for key share;

  -- 5. The ranking, read once (one snapshot for every step below), with the
  --    values this run was given: the rows a Simulation with the same values
  --    showed.
  select coalesce(jsonb_agg(to_jsonb(evaluated)), '[]'::jsonb) into v_rows
    from private.role_evaluation_rows(p_kind, p_from, p_to, p_floor, p_percent, v_cutoff) as evaluated;

  -- The line every row carries (null when nobody reached the Floor) and the
  -- two counts; an empty population has no row, and counts nothing.
  select ranked.line, ranked.ranked_count, ranked.evaluated_count
    into v_line, v_ranked, v_evaluated
    from jsonb_to_recordset(v_rows) as ranked (line integer, ranked_count integer, evaluated_count integer)
   limit 1;

  insert into public.role_evaluations (
    kind, name, period_from, period_to, run_by, threshold_used, threshold_computed, ranked_count,
    eligibility_floor, percent_used, membership_cutoff, evaluated_count
  ) values (
    p_kind, v_name, p_from, p_to, v_actor, v_threshold.threshold, v_line, coalesce(v_ranked, 0),
    p_floor, p_percent, v_cutoff, coalesce(v_evaluated, 0)
  )
  returning id into v_run_id;

  v_span := pg_catalog.to_char(p_from, 'DD.MM.YYYY') || '–' || pg_catalog.to_char(p_to, 'DD.MM.YYYY');

  select array_agg(profile.id order by profile.id) into v_leaders
    from public.profiles as profile
    join public.roles as role on role.id = profile.role
   where profile.status = 'activ'
     and role.level >= 6;

  -- 6. Promotion Candidates (Voluntar Activ kind): every undecided row --
  --    the previous run's and the live ones -- is superseded; every Voluntar
  --    who joined on or before the cutoff and is inside the line this run
  --    computed gets a row measured against that line (R58 decision 17: the
  --    line in force before plays no part) and one Notification per
  --    BC/Moderator. tenure_since records the join date measured.
  if p_kind = 'voluntar_activ' then
    update public.promotion_candidates as candidate
       set decision = 'superseded',
           decided_at = now(),
           decided_by = v_actor
     where candidate.decision is null;

    for v_row in
      select ranked.member_id,
             ranked.task_points,
             member.joined_at,
             coalesce(member.nickname, member.full_name) as member_name
        from jsonb_to_recordset(v_rows) as ranked (
               member_id uuid, task_points integer, inside boolean, listable boolean)
        join public.profiles as member on member.id = ranked.member_id
       where ranked.listable
         and ranked.inside
       order by ranked.member_id
    loop
      insert into public.promotion_candidates (role_evaluation_id, member_id, task_points, tenure_since, threshold_used)
      values (v_run_id, v_row.member_id, v_row.task_points, v_row.joined_at, v_line);
      v_candidates := v_candidates + 1;

      perform private.notify(
        v_leaders, 'system',
        format('Candidat la promovare: %s', v_row.member_name),
        format('%s are %s puncte de task în evaluarea „%s” (%s), cel puțin pragul de %s puncte, '
               'intrat în OSUBB până la %s. Nu este promovat automat: îl poți promova în Voluntar Activ '
               'din panoul de roluri sau respinge din Portofoliu Interne.',
               v_row.member_name, v_row.task_points, v_name, v_span, v_line,
               pg_catalog.to_char(v_cutoff, 'DD.MM.YYYY')),
        null, 'promotion_candidate:' || v_run_id::text || ':' || v_row.member_id::text,
        null, '/administrare/portofoliu-interne');
    end loop;
  end if;

  -- 7. Retention Signals: the kind's open points-based Signals (below_line,
  --    below_floor) are superseded -- a live not_ubb_student Signal is not
  --    the run's -- and every holder of the kind (Voluntar Activ and Voluntar
  --    cu Drept de Vot for the Voluntar Activ kind, Voluntar cu Drept de Vot
  --    for the Adunarea Generală kind) who is not inside the line gets a row:
  --    below_line when ranked under it, below_floor when under the Floor
  --    (and always when nobody was ranked, so no line exists). Nothing
  --    changes; BC, the Moderator and the Adunarea Generală's Group
  --    Responsibles are told -- but only those at level 5 or above, the
  --    level /tracker/membru/<id> requires (#843, D11): a Responsible below it
  --    would be sent to a page that turns them away. The link stays the
  --    Member's tracker page, which they can open; Portofoliu Interne is BC's
  --    and the Moderator's only.
  update public.retention_signals as signal
     set closed_at = now(),
         closed_as = 'superseded'
   where signal.kind = p_kind
     and signal.closed_at is null
     and signal.reason in ('below_line', 'below_floor');

  select case when setting.value ~ '^[1-9][0-9]{0,17}$' then setting.value::bigint end
    into v_ag_group_id
    from public.org_settings as setting
   where setting.key = 'adunarea_generala_group_id';

  for v_row in
    select ranked.member_id,
           ranked.role,
           ranked.task_points,
           ranked.ranked,
           role.name as role_name,
           coalesce(member.nickname, member.full_name) as member_name
      from jsonb_to_recordset(v_rows) as ranked (
             member_id uuid, role public.member_role, task_points integer, ranked boolean, inside boolean)
      join public.roles as role on role.id = ranked.role
      join public.profiles as member on member.id = ranked.member_id
     where (ranked.role = 'vot' or (p_kind = 'voluntar_activ' and ranked.role = 'activ'))
       and not ranked.inside
     order by ranked.member_id
  loop
    insert into public.retention_signals (
      kind, member_id, role_at_listing, reason, task_points, threshold_used, role_evaluation_id
    ) values (
      p_kind, v_row.member_id, v_row.role,
      case when v_row.ranked then 'below_line' else 'below_floor' end,
      v_row.task_points, v_line, v_run_id
    );
    v_signals := v_signals + 1;
    perform private.notify(
      array(select recipient.id
              from (select unnest(v_leaders)
                    union
                    select held.member_id
                      from public.group_members as held
                     where held.group_id = v_ag_group_id
                       and held.group_role = 'responsible') as recipient (id)
             where recipient.id <> v_row.member_id
               and coalesce(private.actor_level(recipient.id), -1) >= 5
             order by recipient.id),
      'system',
      format('Semnal de retenție: %s', v_row.member_name),
      format('%s (%s) are %s puncte de task în evaluarea „%s” (%s), %s. '
             'Rolul nu se retrage automat: decizia îi aparține BC.',
             v_row.member_name, v_row.role_name, v_row.task_points, v_name, v_span,
             case when not v_row.ranked
                  then format('sub pragul minim de %s puncte', p_floor)
                  when p_kind = 'adunarea_generala'
                  then format('sub pragul Adunării Generale de %s puncte', v_line)
                  else format('sub pragul de promovare de %s puncte', v_line)
             end),
      null, 'retention_signal:' || v_run_id::text || ':' || v_row.member_id::text,
      null, '/tracker/membru/' || v_row.member_id::text);
  end loop;

  -- 8. The hand-over: the line this run computed is in force until the
  --    kind's next run (BC may still edit it by hand). It is never below the
  --    Floor, itself at least 1; a run that ranked nobody has no line and
  --    hands nothing over.
  if v_line is not null and v_line is distinct from v_threshold.threshold then
    update public.promotion_thresholds
       set threshold = v_line,
           updated_by = null
     where kind = p_kind;

    insert into public.promotion_threshold_changes (
      kind, from_value, to_value, source, changed_by, role_evaluation_id
    ) values (
      p_kind, v_threshold.threshold, v_line, 'role_evaluation', null, v_run_id
    );
  end if;

  -- 9. The values this run used become the settings in force (R58 decision
  --    7): the Eligibility Floor, the kind's share and, for the Voluntar
  --    Activ kind, the Membership Cutoff Date -- each changed value written
  --    once and logged once naming the run. updated_by is cleared, as the
  --    hand-over clears the threshold's: the log names the run.
  v_share_was := case p_kind when 'voluntar_activ' then v_settings.activ_percent else v_settings.vot_percent end;
  if p_floor is distinct from v_settings.eligibility_floor
     or p_percent is distinct from v_share_was
     or (p_kind = 'voluntar_activ' and v_cutoff is distinct from v_settings.membership_cutoff) then
    update public.evaluation_settings
       set eligibility_floor = p_floor,
           activ_percent = case when p_kind = 'voluntar_activ' then p_percent else activ_percent end,
           vot_percent = case when p_kind = 'adunarea_generala' then p_percent else vot_percent end,
           membership_cutoff = case when p_kind = 'voluntar_activ' then v_cutoff else membership_cutoff end,
           updated_by = null
     where id = 1;
  end if;
  if p_floor is distinct from v_settings.eligibility_floor then
    insert into public.promotion_threshold_changes (
      field, from_value, to_value, source, changed_by, role_evaluation_id
    ) values (
      'floor', v_settings.eligibility_floor, p_floor, 'role_evaluation', null, v_run_id
    );
  end if;
  if p_percent is distinct from v_share_was then
    insert into public.promotion_threshold_changes (
      kind, field, from_value, to_value, source, changed_by, role_evaluation_id
    ) values (
      p_kind, 'percent', v_share_was, p_percent, 'role_evaluation', null, v_run_id
    );
  end if;
  if p_kind = 'voluntar_activ' and v_cutoff is distinct from v_settings.membership_cutoff then
    insert into public.promotion_threshold_changes (
      field, from_date, to_date, source, changed_by, role_evaluation_id
    ) values (
      'cutoff', v_settings.membership_cutoff, v_cutoff, 'role_evaluation', null, v_run_id
    );
  end if;

  -- 10. #983: the new window opens at p_to + 1 and may already hold points
  --    (a range that ended earlier); whoever is at the threshold in it is
  --    listed now. The run holds (47, 1), so the refresh's shared try-lock
  --    (its own session's) succeeds.
  perform private.refresh_promotion_candidates();

  return query select v_run_id, v_candidates, v_signals;
end;
$function$;

comment on function private.run_role_evaluation_impl(text, date, date, text, integer, integer, date) is
  '#826 (ruling R28), #983, rebuilt by R58 (section C): body of public.run_role_evaluation. Ranks the kind''s population over [p_from, p_to] (Europe/Bucharest days, p_to not after today) with the Eligibility Floor, the share and (voluntar_activ) the Membership Cutoff Date given -- private.role_evaluation_rows, the Simulation''s rows -- and records the run with those values, the counts, the Promotion Threshold in force before (threshold_used, may be null) and the line computed (threshold_computed, null when nobody reached the Floor). Voluntar Activ kind: supersedes every undecided Promotion Candidate, then lists every listable Voluntar inside the line, measured against it. Supersedes the kind''s open below_line / below_floor Retention Signals, then stores one per holder not inside (below_line when ranked, below_floor when not). One Notification per Candidate (to BC and the Moderator, linking /administrare/portofoliu-interne) and per Signal (to BC, the Moderator and the Adunarea Generală''s Group Responsibles at level 5 or above, linking /tracker/membru/<member>). Hands the line over when there is one and it differs; writes the Floor, the share and the cutoff used into evaluation_settings when they differ, each logged with source role_evaluation naming the run; then calls private.refresh_promotion_candidates() (#983). PT400 invalid_role_evaluation_kind / invalid_role_evaluation_name / name_too_short / name_too_long / invalid_date_range / date_range_in_future / invalid_eligibility_floor / invalid_percent / membership_cutoff_not_set / invalid_membership_cutoff (a cutoff after today in Europe/Bucharest, the value set_membership_cutoff would refuse) before the gate; 42501 role_evaluation_manage_forbidden below BC. Serialised on pg_advisory_xact_lock(47, 1), then the kind''s promotion_thresholds row, then the evaluation_settings row, then the population''s Profiles for key share.';

create function public.run_role_evaluation(
  p_kind text, p_from date, p_to date, p_name text, p_floor integer, p_percent integer, p_cutoff date default null)
returns table (role_evaluation_id bigint, candidates integer, retention_signals integer)
language sql
security invoker
set search_path = ''
as $$
  select * from private.run_role_evaluation_impl(p_kind, p_from, p_to, p_name, p_floor, p_percent, p_cutoff);
$$;

comment on function public.run_role_evaluation(text, date, date, text, integer, integer, date) is
  '#826 (ruling R28), rebuilt by R58 (Finalizează): BC or the Moderator records a Role Evaluation of one kind (voluntar_activ or adunarea_generala) over the Evaluation Period [p_from, p_to] (inclusive Bucharest days, ending today at the latest), named p_name (3..120 characters), with the Eligibility Floor p_floor (>= 1), the share p_percent (1-100) and, for voluntar_activ, the Membership Cutoff Date p_cutoff -- the values a Simulation showed. It ranks every eligible Member of the kind in one ranking, stores the run with those values, the line it computed and the threshold in force before, lists the Promotion Candidates (voluntar_activ: Voluntars who joined on or before the cutoff and are inside the line -- never promoted) and stores the Retention Signals (holders not inside the line, or below the Floor), notifies BC and the Moderator of each Candidate and, with the Adunarea Generală''s Group Responsibles at level 5 or above, of each Signal, hands the line over as the kind''s Promotion Threshold, and makes the Floor, share and cutoff it used the settings in force (each change logged naming the run). A run that ranked nobody records no line, hands nothing over, lists nobody and signals every holder below the Floor. No Role changes. 42501 role_evaluation_manage_forbidden; PT400 invalid_role_evaluation_kind, invalid_role_evaluation_name, name_too_short, name_too_long, invalid_date_range, date_range_in_future, invalid_eligibility_floor, invalid_percent, membership_cutoff_not_set, invalid_membership_cutoff (a cutoff after today). Returns (role_evaluation_id, candidates, retention_signals).';

revoke execute on function private.run_role_evaluation_impl(text, date, date, text, integer, integer, date)
  from public, anon, authenticated, service_role;
revoke execute on function public.run_role_evaluation(text, date, date, text, integer, integer, date)
  from public, anon, authenticated, service_role;
grant execute on function private.run_role_evaluation_impl(text, date, date, text, integer, integer, date) to authenticated;
grant execute on function public.run_role_evaluation(text, date, date, text, integer, integer, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The ranking of a recorded run.
-- ---------------------------------------------------------------------------
-- A recorded run's ranking is recomputed with the run's own values (the
-- ranking is a function of the ledger and the parameters; a later reversal
-- moves it, as before R58). The (kind, from, to) form goes: without a Floor
-- and a share there is no ranking to compute, so a run recorded before R58
-- returns none. The read rule is main's: every row for
-- private.can_read_evaluation_rankings(), the caller's own row otherwise.
drop function public.role_evaluation_ranking(text, date, date);
drop function private.role_evaluation_ranking_impl(text, date, date);

create function private.role_evaluation_ranking_impl(p_role_evaluation_id bigint)
returns table (member_id uuid, role public.member_role, task_points integer, ranked boolean, rank integer,
               evaluated_count integer, ranked_count integer, share_size integer, line integer,
               inside boolean, listable boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller    uuid;
  v_full_read boolean;
  v_run       public.role_evaluations%rowtype;
begin
  -- Nothing, and no error, without organization claims or a live activ
  -- Profile (house rule 12).
  if not (coalesce(public.auth_is_member(), false) and private.caller_level() >= 0) then
    return;
  end if;

  -- Every live active Member reads every run (role_evaluations_read), so a
  -- missing one is simply missing.
  select * into v_run
    from public.role_evaluations as run
   where run.id = p_role_evaluation_id;
  if not found then
    raise sqlstate 'PT404' using message = 'role_evaluation_not_found';
  end if;

  -- A run recorded before R58 carries no Floor: nothing to recompute.
  if v_run.eligibility_floor is null then
    return;
  end if;

  v_caller := auth.uid();
  v_full_read := private.can_read_evaluation_rankings();

  return query
  select ranked.member_id,
         ranked.role,
         ranked.task_points,
         ranked.ranked,
         ranked.rank,
         ranked.evaluated_count,
         ranked.ranked_count,
         ranked.share_size,
         ranked.line,
         ranked.inside,
         ranked.listable
    from private.role_evaluation_rows(
           v_run.kind, v_run.period_from, v_run.period_to,
           v_run.eligibility_floor, v_run.percent_used, v_run.membership_cutoff) as ranked
   where v_full_read
      or ranked.member_id = v_caller
   order by ranked.task_points desc, ranked.member_id;
end;
$$;

comment on function private.role_evaluation_ranking_impl(bigint) is
  '#826, rebuilt by R58: body of public.role_evaluation_ranking. Nothing -- and no error -- without organization claims or a live activ Profile; PT404 role_evaluation_not_found for an unknown run; nothing for a run recorded before R58 (eligibility_floor null). Otherwise private.role_evaluation_rows with the run''s own kind, Evaluation Period, Eligibility Floor, share and Membership Cutoff Date, filtered for the caller: every row when #512''s private.can_read_evaluation_rankings() holds (BC, Moderator, the Adunarea Generală''s Group Managers and Group Responsibles and those of its ancestors); the caller''s own row for any other live active Member in the run''s population.';

create function public.role_evaluation_ranking(p_role_evaluation_id bigint)
returns table (member_id uuid, role public.member_role, task_points integer, ranked boolean, rank integer,
               evaluated_count integer, ranked_count integer, share_size integer, line integer,
               inside boolean, listable boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
    from private.role_evaluation_ranking_impl(p_role_evaluation_id)
   order by task_points desc, member_id;
$$;

comment on function public.role_evaluation_ranking(bigint) is
  '#826 (ruling R28), rebuilt by R58: the ranking of one recorded Role Evaluation, recomputed with the run''s own values (kind, Evaluation Period, Eligibility Floor, share, Membership Cutoff Date) -- the rows its Simulation showed, while the ledger is unchanged. One row per evaluated Member: role, task_points, ranked, rank, evaluated_count, ranked_count, share_size, line, inside, listable. BC, Moderator and the Adunarea Generală''s Group Managers and Group Responsibles (and those of its ancestors) read every row; any other live Member reads their own row; a claimless or deactivated session reads nothing. A run recorded before R58 returns no rows. PT404 role_evaluation_not_found.';

revoke execute on function private.role_evaluation_ranking_impl(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.role_evaluation_ranking(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.role_evaluation_ranking_impl(bigint) to authenticated;
grant execute on function public.role_evaluation_ranking(bigint) to authenticated;
