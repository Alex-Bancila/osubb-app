-- #1081: Portofoliu Interne replaces Evaluări de rol -- one ranking, stored Retention Signals, the shares at home (R58, part 3).
--
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
--   6. (The Retention Signals table is section 0: the run of section 4
--      writes it, so it comes first.)
--   7. The live Universitate Signal: private.refresh_university_signals on
--      every write of a Profile's university or status; a Role change closes
--      a Member's open Signals; Notification subjects for the live key.
--   8. The live Promotion Candidates read the Membership Cutoff Date instead
--      of the Promotion Rule's tenure, from no earlier than the Points Start
--      Date (as my_role_evaluation_standing now counts), and refresh on
--      every write of the evaluation settings.
--   9. Day one and the drops: the latest run of each kind has its Retention
--      Signals stored; the daily job, its two functions, the Promotion Rule
--      command and public.promotion_rules are dropped; the change log keeps
--      the rules' tenure and on/off rows as history.

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
  'R58: the line the holder was measured against -- since R58 the line the run computed and handed over as the Promotion Threshold; for a row stored on day one from a pre-R58 run, that run''s threshold in force (role_evaluations.threshold_used). A below_floor row fell under the run''s Eligibility Floor (role_evaluations.eligibility_floor), not under this number: the column still names the line. Null for not_ubb_student and for a run that ranked nobody, which has no line.';
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
-- R58's day-one values, 35 and 25 (decision 14), each logged as the
-- migration's change only where the value actually moves (Ruling 16: no
-- writer logs a change that changes nothing) -- on a fresh database x moves
-- 30 -> 35 and is logged, y is 25 already and is not.
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
 where setting.id = 1
   and setting.activ_percent <> 35;
insert into public.promotion_threshold_changes (kind, field, from_value, to_value, source)
select 'adunarea_generala', 'percent', setting.vot_percent, 25, 'migration'
  from public.evaluation_settings as setting
 where setting.id = 1
   and setting.vot_percent <> 25;

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
        format('%s are %s puncte de task în evaluarea „%s” (%s), cel puțin pragul de promovare de %s puncte, '
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

-- ---------------------------------------------------------------------------
-- 7. The live Universitate Signal.
-- ---------------------------------------------------------------------------
-- R58 decisions 10 and 16: the one live Retention Signal. Only a UBB student
-- may hold Drept de Vot (section A); a voter whose Universitate is known and
-- is not Universitatea Babeș-Bolyai holds one open not_ubb_student Signal of
-- the Adunarea Generală kind, raised the moment the value -- or the holder's
-- status -- changes, not at the next run. Unknown (null) opens nothing:
-- every voter is null until the backfill (Review Focus 1), and null never
-- counts as UBB or as not UBB. The refresh re-reads every voter, so a voter a
-- provisioning insert left at another university is caught by the next
-- write. The Signal closes as resolved when its fact reverses and as
-- role_changed when BC changes the Role (the role_history trigger below).
create function private.refresh_university_signals()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_leaders     uuid[];
  v_ag_group_id bigint;
  v_opened      integer := 0;
  v_row         record;
begin
  -- 1. The fact reversed: every open live Signal whose holder no longer
  --    qualifies -- UBB again, unknown again, no longer activ (or no longer
  --    a voter, which the role_history trigger has normally closed first) --
  --    closes as resolved.
  update public.retention_signals as signal
     set closed_at = now(),
         closed_as = 'resolved'
   where signal.reason = 'not_ubb_student'
     and signal.closed_at is null
     and not exists (select 1
                       from public.profiles as holder
                      where holder.id = signal.member_id
                        and holder.status = 'activ'
                        and holder.role = 'vot'
                        and holder.university is not null
                        and holder.university is distinct from private.ubb_university());

  -- 2. Every qualifying voter with no open live Signal gets one, and the
  --    run's Signal recipients are told once: BC, the Moderator and the
  --    Adunarea Generală's Group Responsibles at level 5 or above -- the
  --    level /tracker/membru/<id> requires (#843, D11) -- never the voter.
  select array_agg(profile.id order by profile.id) into v_leaders
    from public.profiles as profile
    join public.roles as role on role.id = profile.role
   where profile.status = 'activ'
     and role.level >= 6;

  select case when setting.value ~ '^[1-9][0-9]{0,17}$' then setting.value::bigint end
    into v_ag_group_id
    from public.org_settings as setting
   where setting.key = 'adunarea_generala_group_id';

  for v_row in
    select profile.id as member_id,
           profile.university,
           coalesce(profile.nickname, profile.full_name) as member_name
      from public.profiles as profile
     where profile.status = 'activ'
       and profile.role = 'vot'
       -- Review Focus 1: the explicit null guard, ahead of a comparison that
       -- would otherwise count an unknown Universitate as not UBB.
       and profile.university is not null
       and profile.university is distinct from private.ubb_university()
       and not exists (select 1
                         from public.retention_signals as signal
                        where signal.member_id = profile.id
                          and signal.kind = 'adunarea_generala'
                          and signal.reason = 'not_ubb_student'
                          and signal.closed_at is null)
     order by profile.id
  loop
    -- Idempotent against retention_signals_open_uidx: a concurrent refresh
    -- may have opened it first, and only a row actually written is told.
    insert into public.retention_signals (kind, member_id, role_at_listing, reason)
    values ('adunarea_generala', v_row.member_id, 'vot', 'not_ubb_student')
    on conflict (kind, member_id, reason) where closed_at is null do nothing;
    if not found then
      continue;
    end if;
    v_opened := v_opened + 1;

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
      format('%s nu mai este student UBB (%s). Drept de Vot cere calitatea de student UBB; '
             'rolul nu se retrage automat: decizia îi aparține BC.',
             v_row.member_name, v_row.university),
      null, 'retention_signal:live:' || v_row.member_id::text,
      null, '/tracker/membru/' || v_row.member_id::text);
  end loop;

  return v_opened;
end;
$$;

comment on function private.refresh_university_signals() is
  'R58 (sections A and C, decisions 10 and 16): the live Universitate Retention Signal. First closes as resolved every open not_ubb_student Signal whose holder no longer qualifies -- Universitatea Babeș-Bolyai again, unknown again (null), no longer activ, or no longer a Voluntar cu Drept de Vot. Then opens one Signal (kind adunarea_generala, role_at_listing vot, no run and no numbers) for every live active vot holder whose university is known (not null) and is not private.ubb_university() and who holds none open -- idempotent against retention_signals_open_uidx -- and, per row actually opened, tells the run''s Signal recipients once: every live BC and Moderator and the Adunarea Generală''s Group Responsibles at level 5 or above (#843 D11), never the holder (dedupe key retention_signal:live:<member>, link /tracker/membru/<member>). An unknown Universitate opens nothing (Review Focus 1). Returns the number opened. Called after every write of profiles.university or profiles.status (profiles_refresh_university_signals) and once by the migration that created it. Executable by nobody.';

revoke execute on function private.refresh_university_signals()
  from public, anon, authenticated, service_role;

create function private.refresh_university_signals_on_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_university_signals();
  return null;
end;
$$;

comment on function private.refresh_university_signals_on_write() is
  'R58: statement-trigger body of profiles_refresh_university_signals -- calls private.refresh_university_signals() after an update of profiles.university (BC''s edit, the backfill) or profiles.status (a voter deactivated or reactivated). Granted to nobody.';

revoke execute on function private.refresh_university_signals_on_write()
  from public, anon, authenticated, service_role;

-- Named columns: a role change is the role_history trigger's, and a write of
-- any other column cannot change who qualifies.
create trigger profiles_refresh_university_signals
after update of university, status on public.profiles
for each statement execute function private.refresh_university_signals_on_write();

-- A Role change closes the Member's open Retention Signals. Restated from
-- main's body (20260927220000_role_evaluations.sql, section 16) with the
-- Signal close added after the Candidate close.
create or replace function private.close_promotion_candidates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_from_level integer;
  v_to_level   integer;
begin
  if new.from_role = 'voluntar' and new.to_role is distinct from 'voluntar' then
    select role.level into v_from_level from public.roles as role where role.id::text = new.from_role;
    select role.level into v_to_level from public.roles as role where role.id::text = new.to_role;

    update public.promotion_candidates as candidate
       set decision = case when v_to_level > v_from_level then 'promoted' else 'superseded' end,
           decided_at = now(),
           decided_by = new.changed_by
     where candidate.member_id = new.member_id
       and candidate.decision is null;
  end if;

  -- R58: a Role change closes every open Retention Signal of the Member, of
  -- either kind and for any reason: BC has decided. A status change writes a
  -- role_history row with the Role unchanged, and closes nothing here.
  if new.to_role is distinct from new.from_role then
    update public.retention_signals as signal
       set closed_at = now(),
           closed_as = 'role_changed'
     where signal.member_id = new.member_id
       and signal.closed_at is null;
  end if;
  return null;
end;
$function$;

comment on function private.close_promotion_candidates() is
  '#826, extended by R58: trigger body of role_history_close_promotion_candidates. When a role_history row moves a Member off Voluntar, their undecided Promotion Candidate row closes: promoted when the new Role is higher (decided_by = the BC who changed it, changed_by), superseded otherwise. Since R58 every Role change (to_role distinct from from_role; a status change, which keeps the Role, is not one) also closes every open Retention Signal of the Member -- of either kind, for any reason -- as role_changed: BC has decided. Granted to nobody.';

-- A live Signal's Notification is about retention_signal:<member>, as a
-- run's is. Restated from 20261014160759_reminders.sql with the
-- retention_signal pattern widened to the live key.
create or replace function private.notification_subject(p_task_id bigint, p_dedupe_key text, p_link text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    'task:' || p_task_id::text,
    case
      when p_dedupe_key ~ '^task:[0-9]+(:|$)'
        then 'task:' || substring(p_dedupe_key from '^task:([0-9]+)')
      when p_dedupe_key ~ '^event:[0-9]+(:|$)'
        then 'event:' || substring(p_dedupe_key from '^event:([0-9]+)')
      -- R53: a Termen reminder (announcement:<id>:termen:<date>) is about its
      -- Announcement too, a Deal's included, whose link maps to no subject.
      when p_dedupe_key ~ '^announcement:[0-9]+(:|$)'
        then 'announcement:' || substring(p_dedupe_key from '^announcement:([0-9]+)')
      when p_dedupe_key ~ '^request:[0-9]+$'
        then 'completed_work_request:' || substring(p_dedupe_key from '^request:([0-9]+)$')
      when p_dedupe_key ~ '^application:[0-9]+$'
        then 'group_application:' || substring(p_dedupe_key from '^application:([0-9]+)$')
      when p_dedupe_key ~ '^promotion_candidate:(live|[0-9]+):[0-9a-f-]{36}$'
        then 'promotion_candidate:' || substring(p_dedupe_key from '([0-9a-f-]{36})$')
      when p_dedupe_key ~ '^retention_signal:(live|[0-9]+):[0-9a-f-]{36}$'
        then 'retention_signal:' || substring(p_dedupe_key from '([0-9a-f-]{36})$')
    end,
    case
      when p_link ~ '^/tracker\?task=[0-9]+$'
        then 'task:' || substring(p_link from '^/tracker\?task=([0-9]+)$')
      when p_link ~ '^/tracker/[0-9]+$'
        then 'task:' || substring(p_link from '^/tracker/([0-9]+)$')
      when p_link ~ '^/calendar\?event=[0-9]+$'
        then 'event:' || substring(p_link from '^/calendar\?event=([0-9]+)$')
      when p_link ~ '^/anunturi\?anunt=[0-9]+$'
        then 'announcement:' || substring(p_link from '^/anunturi\?anunt=([0-9]+)$')
    end
  );
$function$;

comment on function private.notification_subject(bigint, text, text) is
  '#1012 (R37), extended by R53 and R58: the subject a Notification row is about, from its task_id (task:<id>), else its dedupe key (task:/event:<id>:<field>, announcement:<id> and its Termen reminders announcement:<id>:termen:<date>, request:<id> -> completed_work_request:<id>, application:<id> -> group_application:<id>, promotion_candidate:<run|live>:<member> -> promotion_candidate:<member>, retention_signal:<run|live>:<member> -> retention_signal:<member>), else its link (/tracker?task=, /tracker/<id>, /calendar?event=, /anunturi?anunt=), else null. Pure; used by the insert trigger and the backfill. Executable by no client role.';

-- The rule applies to the state it finds: a voter BC already moved to another
-- university between the Universitate column and this migration is
-- signalled now, not at the next write. This call must follow the
-- notification_subject restate just above: the Notification it sends is about
-- retention_signal:<member> only under the widened rule, and a stored subject
-- of null would leave it unread when BC opens the Member's tracker page.
select private.refresh_university_signals();

-- ---------------------------------------------------------------------------
-- 8. The live Promotion Candidates read the Membership Cutoff Date.
-- ---------------------------------------------------------------------------
-- R58 decisions 6 and 15: the tenure rule (joined_at + the top_percent
-- rule's months, checked against today) and the rule's on/off flag go; a
-- Voluntar may be listed when they joined on or before the Membership Cutoff
-- Date, and nobody is listed while it is unset. tenure_since records the join
-- date measured. Ruling 17: the window opens no earlier than the Points Start
-- Date, so a Voluntar is never listed for points no total shows. A write of
-- the evaluation settings -- the cutoff, the Points Start Date, a run's
-- write-through -- refreshes the list at once (Review Focus 4), in place of
-- a write of the Promotion Rules. Restated from
-- 20261002120000_live_promotion_candidates.sql; the shared try-lock stays.
create or replace function private.refresh_promotion_candidates()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_since     date;
  v_last_run  timestamptz;
  v_cutoff    date;
  v_start     date;
  v_by_start  boolean;
  v_threshold integer;
  v_rows      jsonb;
  v_leaders   uuid[];
  v_listed    integer := 0;
  v_row       record;
begin
  -- A run or a threshold edit holds (47, 1) exclusively: it re-lists from
  -- its range and calls this last. Shared, so concurrent writers refresh
  -- side by side; never wait here (the header says why).
  if not pg_catalog.pg_try_advisory_xact_lock_shared(47, 1) then
    return 0;
  end if;

  -- The window: the day after the latest Voluntar Activ run's period_to,
  -- exactly as my_role_evaluation_standing counts a Member's own points.
  select run.period_to + 1, run.run_at into v_since, v_last_run
    from public.role_evaluations as run
   where run.kind = 'voluntar_activ'
   order by run.run_at desc, run.id desc
   limit 1;

  -- R58: the Membership Cutoff Date replaces the rule's tenure. Ruling 17:
  -- the window opens no earlier than the Points Start Date -- the later of
  -- the two (greatest ignores a null), and the Notification names whichever
  -- opened it.
  select setting.membership_cutoff, setting.points_start_date
    into v_cutoff, v_start
    from public.evaluation_settings as setting
   where setting.id = 1;
  v_by_start := v_start is not null and (v_since is null or v_start > v_since);
  v_since := greatest(v_since, v_start);

  select setting.threshold into v_threshold
    from public.promotion_thresholds as setting
   where setting.kind = 'voluntar_activ';

  -- The eligible set, read once: live active Voluntars who joined on or
  -- before the Membership Cutoff Date, at or above the threshold in force
  -- since the window opened. Nobody while the cutoff or the threshold is
  -- unset.
  if v_cutoff is not null and v_threshold is not null then
    select coalesce(jsonb_agg(to_jsonb(eligible)), '[]'::jsonb) into v_rows
      from (
        select profile.id as member_id,
               earned.task_points,
               profile.joined_at as tenure_since
          from public.profiles as profile
          join private.task_points_in_range(
                 coalesce(v_since::timestamp at time zone 'Europe/Bucharest', '-infinity'::timestamptz),
                 'infinity'::timestamptz) as earned on earned.member_id = profile.id
         where profile.status = 'activ'
           and profile.role = 'voluntar'
           and profile.joined_at is not null
           and profile.joined_at <= v_cutoff
           and earned.task_points >= v_threshold
         order by profile.id
      ) as eligible;
  else
    v_rows := '[]'::jsonb;
  end if;

  -- (a) A live row whose Voluntar no longer qualifies is superseded by
  --     nobody. A Member who left Voluntar is the role_history trigger's.
  update public.promotion_candidates as candidate
     set decision = 'superseded',
         decided_at = now(),
         decided_by = null
   where candidate.role_evaluation_id is null
     and candidate.decision is null
     and exists (select 1
                   from public.profiles as profile
                  where profile.id = candidate.member_id
                    and profile.role = 'voluntar')
     and not exists (select 1
                       from jsonb_to_recordset(v_rows) as eligible (member_id uuid)
                      where eligible.member_id = candidate.member_id);

  -- (b) Each eligible Member with no open row and no live rejection since
  --     the window opened gets a live row and one Notification per leader.
  --     The key is per Member: a Member listed, unlisted and listed again
  --     while the first Notification is unread rewrites it, not a pile.
  select array_agg(profile.id order by profile.id) into v_leaders
    from public.profiles as profile
    join public.roles as role on role.id = profile.role
   where profile.status = 'activ'
     and role.level >= 6;

  for v_row in
    select eligible.member_id,
           eligible.task_points,
           eligible.tenure_since,
           coalesce(member.nickname, member.full_name) as member_name
      from jsonb_to_recordset(v_rows) as eligible (member_id uuid, task_points integer, tenure_since date)
      join public.profiles as member on member.id = eligible.member_id
     where not exists (select 1
                         from public.promotion_candidates as open
                        where open.member_id = eligible.member_id
                          and open.decision is null)
       and not exists (select 1
                         from public.promotion_candidates as refused
                        where refused.member_id = eligible.member_id
                          and refused.role_evaluation_id is null
                          and refused.decision = 'rejected'
                          and refused.created_at >= coalesce(v_last_run, '-infinity'::timestamptz))
     order by eligible.member_id
  loop
    -- Idempotent against promotion_candidates_open_member_uidx: a concurrent
    -- refresh may have listed the Member first, and only a row actually
    -- written is notified.
    insert into public.promotion_candidates (role_evaluation_id, member_id, task_points, tenure_since, threshold_used)
    values (null, v_row.member_id, v_row.task_points, v_row.tenure_since, v_threshold)
    on conflict (member_id) where decision is null do nothing;
    if not found then
      continue;
    end if;
    v_listed := v_listed + 1;

    perform private.notify(
      v_leaders, 'system',
      format('Candidat la promovare: %s', v_row.member_name),
      format('%s are %s puncte de task %s, cel puțin pragul de promovare de %s puncte, intrat în '
             'OSUBB până la %s. Nu este promovat automat: îl poți promova în Voluntar Activ din '
             'panoul de roluri sau respinge din Portofoliu Interne.',
             v_row.member_name, v_row.task_points,
             case when v_since is null then 'în total'
                  when v_by_start then 'de la ' || pg_catalog.to_char(v_since, 'DD.MM.YYYY')
                  else 'de la ultima evaluare Voluntar Activ (din '
                       || pg_catalog.to_char(v_since, 'DD.MM.YYYY') || ')' end,
             v_threshold, pg_catalog.to_char(v_cutoff, 'DD.MM.YYYY')),
      null, 'promotion_candidate:live:' || v_row.member_id::text,
      null, '/administrare/portofoliu-interne');
  end loop;

  return v_listed;
end;
$function$;

comment on function private.refresh_promotion_candidates() is
  '#983 (ruling R35), rebuilt by R58: the Promotion Candidate list between Role Evaluations. Reads the eligible set -- live active Voluntars who joined on or before evaluation_settings.membership_cutoff (the Membership Cutoff Date) whose net Task Points since the window opened reach the Voluntar Activ threshold in force; nobody while the cutoff or the threshold is unset. The window opens on the later of the day after the latest Voluntar Activ run''s period_to and the Points Start Date (Ruling 17), and from the beginning while neither exists -- the window my_role_evaluation_standing counts. Then supersedes the open live rows of Voluntars who no longer qualify (decided_by null; a Member who left Voluntar is the role_history trigger''s) and lists each eligible Member with no open row and no live rejection since the last run: a promotion_candidates row with role_evaluation_id null and tenure_since = joined_at, and one Notification per live BC/Moderator (dedupe key promotion_candidate:live:<member>, link /administrare/portofoliu-interne) naming the points since the window opened, the line and the cutoff. Returns the number listed. Takes pg_try_advisory_xact_lock_shared(47, 1) -- shared, so concurrent writers refresh side by side, and the insert is idempotent against the one-open-row index -- and returns 0 at once while a run, a threshold edit or an evaluation-settings edit holds the lock exclusively. Called by the statement triggers on points_ledger, promotion_thresholds, evaluation_settings and profiles, and last by run_role_evaluation_impl. Executable by nobody.';

comment on function private.refresh_promotion_candidates_on_write() is
  '#983, R58: statement-trigger body -- calls private.refresh_promotion_candidates() after a write to points_ledger (an award or a reversal), promotion_thresholds (the line), evaluation_settings (the Membership Cutoff Date, the Points Start Date and a run''s write-through; R58 moved this trigger here from the dropped promotion_rules) or profiles (any update -- role, status and joined_at are what matter). Granted to nobody.';

drop trigger promotion_rules_refresh_promotion_candidates on public.promotion_rules;

create trigger evaluation_settings_refresh_promotion_candidates
after update on public.evaluation_settings
for each statement execute function private.refresh_promotion_candidates_on_write();

-- Ruling 17: a Member's own standing counts the same window -- from no
-- earlier than the Points Start Date, for either kind. Restated from
-- 20260927220000_role_evaluations.sql.
create or replace function private.my_role_evaluation_standing_impl(p_kind text)
 RETURNS TABLE(since date, task_points integer, threshold integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_caller uuid;
  v_since  date;
begin
  if not (coalesce(public.auth_is_member(), false) and private.caller_level() >= 0) then
    return;
  end if;
  if p_kind is null or p_kind not in ('voluntar_activ', 'adunarea_generala') then
    raise sqlstate 'PT400' using message = 'invalid_role_evaluation_kind';
  end if;
  v_caller := auth.uid();

  select run.period_to + 1 into v_since
    from public.role_evaluations as run
   where run.kind = p_kind
   order by run.run_at desc, run.id desc
   limit 1;

  -- Ruling 17 (R58): the window opens no earlier than the Points Start Date,
  -- the later of the two (greatest ignores a null).
  v_since := greatest(v_since, (select setting.points_start_date
                                  from public.evaluation_settings as setting
                                 where setting.id = 1));

  return query
  select v_since,
         coalesce((select earned.task_points
                     from private.task_points_in_range(
                            coalesce(v_since::timestamp at time zone 'Europe/Bucharest', '-infinity'::timestamptz),
                            'infinity'::timestamptz) as earned
                    where earned.member_id = v_caller), 0),
         (select setting.threshold
            from public.promotion_thresholds as setting
           where setting.kind = p_kind);
end;
$function$;

comment on function private.my_role_evaluation_standing_impl(text) is
  '#826, Ruling 17 (R58): body of public.my_role_evaluation_standing. For the caller only: since = the later of the day after the period_to of the kind''s latest Role Evaluation (by run_at) and the Points Start Date (null while neither exists), task_points = the caller''s net Task Points from Evaluations since then (all time when since is null), threshold = the kind''s Promotion Threshold in force. Nothing without organization claims or a live activ Profile; PT400 invalid_role_evaluation_kind.';
comment on function public.my_role_evaluation_standing(text) is
  '#826 (for #634''s Profil progress), Ruling 17 (R58): one row for the caller -- since (the later of the day after the kind''s last Role Evaluation''s period_to and the Points Start Date; null while neither exists), task_points (own net Task Points since then, or all time) and threshold (the kind''s Promotion Threshold in force, null while unset) -- the window the live Promotion Candidates count too. Never another Member''s points and no rank (R6). Nothing for a claimless or deactivated session; PT400 invalid_role_evaluation_kind.';

-- ---------------------------------------------------------------------------
-- 9. Day one, and the drops.
-- ---------------------------------------------------------------------------
-- (a) Ruling 14: the latest run of each kind has its Retention Signals
-- stored. Before R58 they were not rows: the page derived them from the
-- ranking, and the run told BC once per Signal. Those Notifications
-- (retention_signal:<run>:<member>) are the exact record of what was raised,
-- so each Member they name becomes one below_line row of the run: the Role
-- the run listed (a run before R58 signalled only the Voluntar Activ holders
-- of its Voluntar Activ kind and the Voluntar cu Drept de Vot holders of its
-- Adunarea Generală kind), their Task Points over the run's Evaluation Period
-- (0 when nothing touched them), the line the run measured against, and the
-- run's instant. Decision 16: a Role change closes a Signal, and BC may have
-- acted since the run -- a Member with a role_history row changing the Role
-- after the run's instant arrives closed as role_changed, at the first such
-- change. A Member no longer activ arrives open; the next run of the kind
-- closes it. A database with no run gets nothing.
-- retention_signals_day_one_upgrade.test.sh replays this block.
do $$
declare
  v_run record;
begin
  for v_run in
    select distinct on (run.kind)
           run.id, run.kind, run.period_from, run.period_to, run.threshold_used, run.run_at
      from public.role_evaluations as run
     order by run.kind, run.run_at desc, run.id desc
  loop
    insert into public.retention_signals (
      kind, member_id, role_at_listing, reason, task_points, threshold_used, role_evaluation_id, created_at,
      closed_at, closed_as
    )
    select v_run.kind, member.id,
           (case v_run.kind when 'voluntar_activ' then 'activ' else 'vot' end)::public.member_role,
           'below_line', coalesce(earned.task_points, 0),
           v_run.threshold_used, v_run.id, v_run.run_at,
           changed.changed_at,
           case when changed.changed_at is not null then 'role_changed' end
      from public.profiles as member
      left join private.task_points_in_range(
             (v_run.period_from::timestamp at time zone 'Europe/Bucharest'),
             ((v_run.period_to + 1)::timestamp at time zone 'Europe/Bucharest')) as earned
        on earned.member_id = member.id
      left join lateral (
             select min(history.created_at) as changed_at
               from public.role_history as history
              where history.member_id = member.id
                and history.to_role <> history.from_role
                and history.created_at > v_run.run_at) as changed on true
     where member.id::text in (
             select split_part(notification.dedupe_key, ':', 3)
               from public.notifications as notification
              where notification.dedupe_key ~ ('^retention_signal:' || v_run.id::text || ':[0-9a-f-]{36}$'))
     order by member.id;
  end loop;
end $$;

-- (b) Nothing promotes by the calendar (decision 5): the daily job goes.
select cron.unschedule('osubb-apply-promotions')
 where exists (select 1 from cron.job where jobname = 'osubb-apply-promotions');

-- (c) The job's two functions, its detection, and the Promotion Rule command.
drop function private.apply_promotions();
drop function private.apply_promotion(uuid, public.member_role, public.member_role, text);
drop function private.detect_promotions();
drop function public.update_promotion_rule(bigint, integer, boolean);
drop function private.update_promotion_rule_impl(bigint, integer, boolean);

-- (d) The change log keeps the rules' tenure and on/off rows as history:
-- promotion_rule_id stays, a plain bigint naming a rule no table holds.
alter table public.promotion_threshold_changes
  drop constraint promotion_threshold_changes_promotion_rule_id_fkey;

-- (e) Both Promotion Rules: x moved to evaluation_settings (section 1), the
-- tenure to the Membership Cutoff Date (section 8), and Recrut -> Voluntar is
-- BC's by hand.
drop table public.promotion_rules;

-- (f) What still described the rules.
comment on table public.promotion_threshold_changes is
  '#826 (ruling R28), extended by #866 (ruling R30), #935 and R58: every change of a Promotion Threshold, of a kind''s top share or of an evaluation setting -- and, kept as history, of the retired Promotion Rules'' tenure or on/off flag. field threshold: source manual (BC or the Moderator through set_promotion_threshold; changed_by) or role_evaluation (the value a run computed, handed over; role_evaluation_id). field percent: values 1-100 (x, evaluation_settings.activ_percent; y, evaluation_settings.vot_percent); source manual (set_evaluation_percent; changed_by), role_evaluation (the share a finalised run used, written through; role_evaluation_id) or migration (R58''s day-one change of a share that moved). field tenure / enabled: history only -- written, source manual, by update_promotion_rule until R58 dropped it with the Promotion Rules; they name promotion_rule_id (the dropped rule''s id, a plain number) instead of a kind; tenure in whole months 0-120, enabled 0 (off) or 1 (on). field floor (the Eligibility Floor, Prag minim: a number >= 1 in to_value) / cutoff (the Membership Cutoff Date, Data limită de intrare) / points_start (the Points Start Date, Data de început a punctajului), the last two dates in from_date / to_date with no number: source manual through the evaluation-settings commands or migration, and for floor and cutoff also role_evaluation (a finalised run writes the values it used); a run never writes points_start. from_value / from_date is the value before (null for a threshold, a share or a setting never set; a tenure or enabled row always carries from_value). Read by live level >= 6 only; written by the commands, a finalised run and the R58 migrations.';
comment on column public.promotion_threshold_changes.field is
  '#866 (ruling R30), extended by #935 and R58: which value changed. threshold (the Promotion Threshold of kind, Task Points; a hand edit or a run''s hand-over) or percent (the kind''s top share: x, evaluation_settings.activ_percent, for voluntar_activ; y, evaluation_settings.vot_percent, for adunarea_generala; 1-100; a hand edit, the share a finalised run wrote through, or the day-one change a migration made) name a kind; tenure (a Promotion Rule''s min_tenure_months, whole months 0-120) or enabled (its on/off flag, 0 off and 1 on, always a flip) name promotion_rule_id, were always manual and are history since R58 dropped the Promotion Rules; floor (the Eligibility Floor, Prag minim: Task Points >= 1, in to_value), cutoff (the Membership Cutoff Date, Data limită de intrare) and points_start (the Points Start Date, Data de început a punctajului), the last two dates in from_date / to_date, name neither (evaluation_settings). Defaults to threshold, the only value before R30.';
comment on column public.promotion_threshold_changes.kind is
  '#826: the Role Evaluation kind whose threshold or share changed (field threshold or percent). Null for a Promotion Rule edit (field tenure or enabled, #935; history since R58), which names promotion_rule_id instead, and for a settings change (field floor, cutoff or points_start, R58).';
comment on column public.promotion_threshold_changes.promotion_rule_id is
  '#935, R58: the Promotion Rule whose tenure or on/off flag changed (field tenure or enabled); null for every other field. R58 dropped public.promotion_rules and this column''s foreign key with it: the id is kept as a plain number, so the history still says which rule a row was about (the time rule moved Recrut -> Voluntar, the top_percent rule Voluntar -> Voluntar Activ).';

comment on table public.promotion_candidates is
  '#826 (ruling R28), #983 (R35), R58: a Voluntar who joined on or before the Membership Cutoff Date (before R58: who held the required tenure) and whose Task Points reached the Voluntar Activ Promotion Threshold -- at a Role Evaluation (role_evaluation_id set, measured against the line the run computed) or, between runs, the moment they qualified (role_evaluation_id null, written by private.refresh_promotion_candidates) -- never promoted automatically. decision null while BC has not decided; promoted when the Member leaves Voluntar upward (the role_history trigger, decided_by the BC who changed the Role), rejected by public.reject_promotion_candidate (with BC''s reason), superseded by the next Voluntar Activ run, by leaving Voluntar any other way, or -- a live row only -- by no longer qualifying (decided_by null). At most one undecided row per Member. BC and the Moderator read every row; a Member reads their own. Named role_evaluation_id, not evaluation_id: points_ledger.evaluation_id already means a Task''s Evaluation.';
comment on column public.promotion_candidates.tenure_since is
  '#826, R58: the join date measured -- profiles.joined_at when the row was listed, judged against the Membership Cutoff Date. Before R58, the day the Voluntar reached the top_percent rule''s tenure (joined_at plus its months); the name is kept for those rows.';
comment on table public.promotion_thresholds is
  '#826 (ruling R28), R58: the Promotion Threshold in force per Role Evaluation kind -- voluntar_activ (a Voluntar who joined on or before the Membership Cutoff Date and reaches it between runs becomes a live Promotion Candidate) and adunarea_generala. A finalised run measures its own Candidates and Retention Signals against the line it computes and hands that line over; this value is in force until the kind''s next run. Null until BC enters the first value or a run computes one. BC or the Moderator edits it at any time (public.set_promotion_threshold). Every change is logged in promotion_threshold_changes. Every live active Member reads it; no client writes it directly.';

comment on column public.profiles.joined_at is
  'Exact join date; the Membership Cutoff Date (R58) is measured against it -- a Voluntar who joined on or before it may be listed as a Promotion Candidate (before R58, tenure for Recrut -> Voluntar and the Promotion Candidate cohort counted from it). provision_profile stamps it (#933): the given date, otherwise the provisioning day on the Europe/Bucharest calendar. #160 backfilled known members as January 1 of joined_year; #933 backfilled the rest from the Europe/Bucharest date of profiles.created_at. BC edits historical dates (#932). Null only for a profile inserted outside provision_profile without one.';

-- provision_profile's body said the join date is what tenure counts from;
-- restated from 20260929210000_provision_joined_at.sql with that one comment
-- changed and nothing else.
create or replace function public.provision_profile(p_user_id uuid, p_full_name text, p_email text, p_role member_role DEFAULT 'recrut'::member_role, p_group_ids bigint[] DEFAULT '{}'::bigint[], p_appointed_by uuid DEFAULT NULL::uuid, p_joined_at date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_group_id  bigint;
  v_reason    text;
begin
  -- The rank ceiling (H1, widened by #917). A leadership account is created
  -- by leadership -- a live active BC or Moderator, the actor set_member_role
  -- accepts -- and answered before anything is written.
  if p_role in ('bc', 'moderator') then
    if p_appointed_by is null then
      -- The bootstrap path: the first Moderator, appointed by nobody. Once an
      -- `activ` Moderator exists, a null appointer creates no leadership.
      -- Two concurrent bootstrap calls would both see "no Moderator yet", so
      -- the `moderator` Role row is locked first: the second call waits, and
      -- its check below (a new snapshot under read committed) sees the
      -- first's committed row. `for no key update`, the house mode for a row
      -- other tables reference, so a key-share lock on it is never blocked.
      if p_role = 'moderator' then
        perform 1
           from public.roles as role
          where role.id = 'moderator'
            for no key update;
      end if;
      if p_role <> 'moderator'
         or exists (select 1
                      from public.profiles as holder
                     where holder.role = 'moderator'
                       and holder.status = 'activ') then
        raise exception using errcode = '42501', message = 'member_manage_forbidden';
      end if;
    else
      -- #917: the appointer is a live active BC or Moderator, read under a
      -- share lock so a concurrent demotion or deactivation of them waits.
      perform 1
         from public.profiles as appointer
         join public.roles as role on role.id = appointer.role
        where appointer.id = p_appointed_by
          and appointer.status = 'activ'
          and role.level >= 6
          for share of appointer;
      if not found then
        raise exception using errcode = '42501', message = 'member_manage_forbidden';
      end if;
    end if;
  end if;

  -- #933: the join date -- the given one, or the provisioning day on the
  -- Europe/Bucharest calendar. R58 measures the Membership Cutoff Date
  -- against it.
  insert into public.profiles (id, full_name, email, role, joined_at)
  values (p_user_id, p_full_name, lower(trim(p_email)), p_role,
          coalesce(p_joined_at, (now() at time zone 'Europe/Bucharest')::date));

  -- Shape 4: ascending id, duplicates collapsed.
  begin
    for v_group_id in
      select distinct g
        from unnest(coalesce(p_group_ids, '{}'::bigint[])) as g
       order by 1
    loop
      -- Shape 1 and 2: the one insert path, with the inviting BC as the actor.
      perform private.appoint_group_member(v_group_id, p_user_id, p_appointed_by);
    end loop;
  exception
    -- Shape 3: keep the core's reason, normalise the class. Anything else --
    -- a 23505 on the profiles row, say, which invite-member reads to tell a
    -- race from a typo -- passes through untouched, because it is raised
    -- outside this block.
    when insufficient_privilege or sqlstate 'PT400' or sqlstate 'PT409' then
      get stacked diagnostics v_reason = message_text;
      raise sqlstate 'PT400' using message = v_reason;
  end;

  return p_user_id;
end;
$function$;

comment on function public.provision_profile(uuid, text, text, public.member_role, bigint[], uuid, date) is
  'Atomically provisions an invited auth user (ADR-0003, #602): the profiles row, then one Appointment per p_group_ids Group through private.appoint_group_member -- the ONE insert path into public.group_members (rulings R6/R27), which carries every roster invariant and writes the new Member''s Appointment Notification. The profile''s joined_at (#933) is p_joined_at when given, otherwise the provisioning day on the Europe/Bucharest calendar, so the Membership Cutoff Date (R58) measures the Member from the day they joined. p_appointed_by is the inviting BC or Moderator, whose live level >= 6 the Edge Function verifies from the database, and it reaches the core as p_actor, so the Notification is attributed to them (and private.notify drops the actor, so provisioning somebody as their own appointer notifies nobody). Rank ceiling (security pass 2026-09-27, H1; widened by ruling R31, #917): a bc or moderator profile is provisioned only when p_appointed_by is a live activ BC or Moderator (level 6 and up, read FOR SHARE) -- the actor set_member_role accepts -- or, for the bootstrap, when p_appointed_by is null, the role is moderator and no activ Moderator exists yet; anything else is 42501 member_manage_forbidden before anything is written. Groups are appointed in ascending id order with duplicates collapsed, so the FOR NO KEY UPDATE locks the core takes can never deadlock two concurrent calls. Any refusal from the core -- group_archived, group_member_not_eligible, group_member_below_min_level, automatic_group_has_no_roster_members, already_group_member, or the non-disclosing group_manage_forbidden for an unknown id -- fails the WHOLE call as PT400 carrying the core''s own reason string, so no half-placed Member survives. Writes no legacy membership table: #590 drops both. Service-role only; shared by the single-invite and CSV-import flows and the production bootstrap.';
