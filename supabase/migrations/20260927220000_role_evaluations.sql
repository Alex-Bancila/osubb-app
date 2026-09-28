-- #826: Role Evaluations -- run_role_evaluation over an Evaluation Period, two Promotion Thresholds, Promotion Candidates (ruling R28).
--
-- R28 (2026-09-27) retires R20's open/close model. No Evaluation Period is
-- ever opened or closed and nothing ranks live: BC or the Moderator runs a
-- Role Evaluation from Administrare over a date range chosen at that moment
-- (the Evaluation Period, inclusive Europe/Bucharest days), of one kind:
--   * voluntar_activ    -- ranks the live active Voluntar Activ holders and
--                          the Voluntars holding the top_percent rule's
--                          tenure. A tenured Voluntar at or above the
--                          threshold in force becomes a Promotion Candidate:
--                          a row in promotion_candidates and one Notification
--                          to every BC/Moderator. Nobody is promoted: BC
--                          promotes by hand through set_member_role (#105),
--                          which closes the candidate row as `promoted`.
--   * adunarea_generala -- ranks the live active Voluntar cu Drept de Vot
--                          holders only. No promotion path.
-- Decisions taken on the drafting notes (issue #826 § Decisions):
--   1. an undecided Candidate is `superseded` at the next Voluntar Activ run;
--      a rejected one comes back at a later run while still above the line.
--   2. each Role is ranked within its own cohort (#48's per-cohort share), so
--      the Voluntar Activ kind's top share is read from the Voluntar Activ
--      cohort alone, never mixed with the tenured Voluntars.
--   3. the threshold of each kind is also its retention line: a holder
--      (activ for voluntar_activ, vot for adunarea_generala) whose Task Points
--      in the range are below the threshold used raises a Retention Signal.
--      Each run computes the next threshold -- the Task Points of the last
--      holder inside the top x% (Voluntar Activ) / y% (Drept de Vot) of the
--      holders' cohort, #49's boundary rule -- which is in force for that
--      kind's next run unless BC edits it. A computed value below 1 (the
--      boundary holder earned nothing) is recorded but not handed over.
--   4. Recrut -> Voluntar stays automatic by tenure in the daily job.
--
-- What moves:
--   * public.evaluation_periods -> public.role_evaluations (closed Periods
--     copied in with their ids; an open Period stops the migration).
--   * promotion_rules.initial_threshold and the close-time stamp ->
--     public.promotion_thresholds (one row per kind) with the audit log
--     public.promotion_threshold_changes.
--   * open_/close_evaluation_period, stamp_closing_threshold,
--     apply_close_promotions, detect_close_promotions,
--     detect_retention_signals, the Period and retention rankings and
--     set_promotion_rule are dropped; run_role_evaluation,
--     role_evaluation_ranking, set_promotion_threshold,
--     reject_promotion_candidate, my_role_evaluation_standing and
--     promotion_threshold_in_force(p_kind) replace them.
--   * the daily job osubb-apply-promotions keeps only the tenure rule.
--   * set_member_role's Notification to a new Voluntar Activ carries the AG
--     Eligibility and adherence-form text the automatic promotion used to.
--
-- Locks: pg_advisory_xact_lock(47, 1) serialises runs and threshold edits,
-- then the kind's promotion_thresholds row is taken `for no key update` (a
-- parent row: promotion_threshold_changes references it -- conventions
-- section 2), then the population's live Profiles `for key share`, so a
-- set_member_role (Profile `for update`) waits for the run. The daily job keeps
-- (52, 1) and never takes (47, 1).

-- ---------------------------------------------------------------------------
-- 1. Guard: an open Period cannot be carried into a model without one.
-- ---------------------------------------------------------------------------
do $$
declare
  v_open bigint;
begin
  select count(*) into v_open from public.evaluation_periods where closed_at is null;
  if v_open > 0 then
    raise exception using errcode = '23514', message = 'open_evaluation_period_remains',
      detail = format('%s Evaluation Period(s) still open.', v_open),
      hint = 'Close it with public.close_evaluation_period first (ruling R28); nothing was changed.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The Promotion Thresholds, one per kind, seeded from today's value.
-- ---------------------------------------------------------------------------
create table public.promotion_thresholds (
  kind       text primary key,
  threshold  integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint promotion_thresholds_kind_ck
    check (kind in ('voluntar_activ', 'adunarea_generala')),
  constraint promotion_thresholds_threshold_range_ck
    check (threshold is null or threshold >= 1),
  constraint promotion_thresholds_updated_at_ck check (updated_at >= created_at)
);

alter table public.promotion_thresholds enable row level security;

create trigger promotion_thresholds_set_updated_at
before update on public.promotion_thresholds
for each row execute function private.set_updated_at();

-- The Voluntar Activ threshold carries over what was in force (the last
-- close's stamp, else the seeded initial value); a value below 1 -- a stamp
-- over net-negative points -- is not a usable line, so BC enters one by hand.
-- The Adunarea Generală threshold never existed: BC enters the first one.
insert into public.promotion_thresholds (kind, threshold)
select 'voluntar_activ', case when in_force.value >= 1 then in_force.value end
  from (select public.promotion_threshold_in_force() as value) as in_force
union all
select 'adunarea_generala', null;

comment on table public.promotion_thresholds is
  '#826 (ruling R28): the Promotion Threshold in force per Role Evaluation kind -- voluntar_activ (a tenured Voluntar at or above it becomes a Promotion Candidate; a Voluntar Activ below it raises a Retention Signal) and adunarea_generala (a Voluntar cu Drept de Vot below it raises a Retention Signal). Null until BC enters the first value. BC or the Moderator edits it at any time (public.set_promotion_threshold); each public.run_role_evaluation hands over the value it computed. Every change is logged in promotion_threshold_changes. Every live active Member reads it; no client writes it directly.';
comment on column public.promotion_thresholds.threshold is
  '#826: Task Points, a whole number >= 1; null until BC enters the first value (a run of that kind is refused meanwhile: PT409 promotion_threshold_not_set).';
comment on column public.promotion_thresholds.updated_by is
  '#826: the Member who last edited the value by hand; null when a Role Evaluation handed it over (promotion_threshold_changes names the run).';

revoke all on table public.promotion_thresholds from public, anon, authenticated, service_role;
grant select on table public.promotion_thresholds to authenticated, service_role;

create policy promotion_thresholds_read on public.promotion_thresholds
  for select to authenticated
  using ((select public.auth_is_member()) and (select private.caller_level()) >= 0);

comment on policy promotion_thresholds_read on public.promotion_thresholds is
  '#826: every live active Member reads both thresholds -- the goal a Voluntar works toward (#634). Organization claims (house rule 12) plus a live activ Profile. No write policy: set_promotion_threshold and run_role_evaluation are the write paths.';

-- ---------------------------------------------------------------------------
-- 3. The Role Evaluations, the closed Periods copied in.
-- ---------------------------------------------------------------------------
create table public.role_evaluations (
  id                 bigint generated always as identity primary key,
  kind               text not null,
  name               text not null,
  period_from        date not null,
  period_to          date not null,
  run_by             uuid not null references public.profiles (id),
  run_at             timestamptz not null default now(),
  threshold_used     integer not null,
  threshold_computed integer,
  ranked_count       integer not null,
  constraint role_evaluations_kind_ck
    check (kind in ('voluntar_activ', 'adunarea_generala')),
  -- R8's title limit, measured as run_role_evaluation stores the name: trimmed.
  constraint role_evaluations_name_length_ck
    check (char_length(name) between 3 and 120),
  constraint role_evaluations_name_trimmed_ck
    check (name !~ '^[[:space:]]|[[:space:]]$'),
  constraint role_evaluations_range_ck
    check (period_to >= period_from),
  constraint role_evaluations_ranked_count_ck
    check (ranked_count >= 0)
);

create index role_evaluations_kind_run_at_idx
  on public.role_evaluations (kind, run_at desc, id desc);

alter table public.role_evaluations enable row level security;

-- Closed Periods keep their ids (so retention_signal:<id>:<member> keys stay
-- unique): [opened_at, closed_at) becomes the Bucharest days it covered, the
-- closer is the runner, the threshold used is the one in force at that close
-- (the previous stamped close, else the seeded initial value) and the stamp
-- is the threshold computed.
insert into public.role_evaluations (
  id, kind, name, period_from, period_to, run_by, run_at,
  threshold_used, threshold_computed, ranked_count
)
overriding system value
select period.id,
       'voluntar_activ',
       period.name,
       (period.opened_at at time zone 'Europe/Bucharest')::date,
       greatest((period.opened_at at time zone 'Europe/Bucharest')::date,
                ((period.closed_at - interval '1 microsecond') at time zone 'Europe/Bucharest')::date),
       period.closed_by,
       period.closed_at,
       coalesce(
         (select earlier.closing_threshold
            from public.evaluation_periods as earlier
           where earlier.closed_at is not null
             and earlier.closing_threshold is not null
             and (earlier.closed_at, earlier.id) < (period.closed_at, period.id)
           order by earlier.closed_at desc, earlier.id desc
           limit 1),
         (select rule.initial_threshold
            from public.promotion_rules as rule
           where rule.kind = 'top_percent'),
         0),
       period.closing_threshold,
       (select count(*)::int from private.evaluation_period_ranking_rows(period.id))
  from public.evaluation_periods as period
 where period.closed_at is not null;

select pg_catalog.setval(
  pg_catalog.pg_get_serial_sequence('public.role_evaluations', 'id'),
  coalesce((select max(id) from public.role_evaluations), 0) + 1,
  false);

comment on table public.role_evaluations is
  '#826 (ruling R28): one row per Role Evaluation BC or the Moderator ran -- an immutable record. kind voluntar_activ or adunarea_generala; the Evaluation Period [period_from, period_to] in inclusive Europe/Bucharest days (Task Evaluations whose evaluated_at falls in it are ranked); who ran it and when; the Promotion Threshold used (in force at run time) and computed (the boundary of the holders'' cohort top share; null when the cohort was empty), handed over to the kind''s next run unless BC edits it; ranked_count, the Members the run ranked. No overlap or uniqueness rule: a correction run over the same days is legitimate, and the threshold chain follows run_at. Rows up to #826 are the closed Evaluation Periods of the retired open/close model, copied with their ids. Every live active Member reads every row; public.run_role_evaluation is the only write path.';
comment on column public.role_evaluations.threshold_computed is
  '#826: the Task Points of the share-th holder (ceil(percent x cohort / 100), x for Voluntar Activ, y for Drept de Vot) -- ties at the boundary share the value. Handed over to promotion_thresholds when >= 1; null when the holders'' cohort was empty.';

revoke all on table public.role_evaluations from public, anon, authenticated, service_role;
grant select on table public.role_evaluations to authenticated, service_role;
revoke all on sequence public.role_evaluations_id_seq from public, anon, authenticated;

create policy role_evaluations_read on public.role_evaluations
  for select to authenticated
  using ((select public.auth_is_member()) and (select private.caller_level()) >= 0);

comment on policy role_evaluations_read on public.role_evaluations is
  '#826: every live active Member reads every Role Evaluation, as they read every Evaluation Period before R28 -- organization claims (house rule 12) plus a live activ Profile. No write policy: run_role_evaluation is the only write path.';

-- ---------------------------------------------------------------------------
-- 4. The threshold audit log.
-- ---------------------------------------------------------------------------
create table public.promotion_threshold_changes (
  id                 bigint generated always as identity primary key,
  kind               text not null references public.promotion_thresholds (kind),
  from_value         integer,
  to_value           integer not null,
  source             text not null,
  changed_by         uuid references public.profiles (id),
  role_evaluation_id bigint references public.role_evaluations (id),
  changed_at         timestamptz not null default now(),
  constraint promotion_threshold_changes_source_ck
    check (source in ('manual', 'role_evaluation')),
  -- A hand edit names its author; a hand-over names its run.
  constraint promotion_threshold_changes_source_shape_ck
    check ((source = 'manual' and changed_by is not null and role_evaluation_id is null)
        or (source = 'role_evaluation' and changed_by is null and role_evaluation_id is not null)),
  constraint promotion_threshold_changes_to_value_range_ck
    check (to_value >= 1)
);

create index promotion_threshold_changes_kind_idx
  on public.promotion_threshold_changes (kind, changed_at desc, id desc);

alter table public.promotion_threshold_changes enable row level security;

comment on table public.promotion_threshold_changes is
  '#826 (ruling R28): every change of a Promotion Threshold -- source manual (BC or the Moderator through set_promotion_threshold; changed_by) or role_evaluation (the value a run computed, handed over; role_evaluation_id). from_value is the value before (null when none was set). Read by live level >= 6 only; written only by the two commands.';

revoke all on table public.promotion_threshold_changes from public, anon, authenticated, service_role;
grant select on table public.promotion_threshold_changes to authenticated, service_role;
revoke all on sequence public.promotion_threshold_changes_id_seq from public, anon, authenticated;

create policy promotion_threshold_changes_read on public.promotion_threshold_changes
  for select to authenticated
  using ((select public.auth_is_member()) and (select private.caller_level()) >= 6);

comment on policy promotion_threshold_changes_read on public.promotion_threshold_changes is
  '#826: BC and the Moderator (live level >= 6, with organization claims) read the threshold log. No write policy.';

-- ---------------------------------------------------------------------------
-- 5. The Promotion Candidates.
-- ---------------------------------------------------------------------------
create table public.promotion_candidates (
  id                 bigint generated always as identity primary key,
  role_evaluation_id bigint not null references public.role_evaluations (id),
  member_id          uuid not null references public.profiles (id),
  task_points        integer not null,
  tenure_since       date not null,
  decision           text,
  decided_at         timestamptz,
  decided_by         uuid references public.profiles (id),
  reason             text,
  created_at         timestamptz not null default now(),
  constraint promotion_candidates_decision_ck
    check (decision is null or decision in ('promoted', 'rejected', 'superseded')),
  constraint promotion_candidates_decision_shape_ck
    check ((decision is null) = (decided_at is null)),
  -- A rejection is BC's and says why; nothing else carries a reason.
  constraint promotion_candidates_reason_shape_ck
    check ((reason is not null) = (decision is not distinct from 'rejected')),
  constraint promotion_candidates_rejected_by_ck
    check (decision is distinct from 'rejected' or decided_by is not null),
  constraint promotion_candidates_reason_length_ck
    check (char_length(reason) between 1 and 500),
  constraint promotion_candidates_role_evaluation_id_member_id_key
    unique (role_evaluation_id, member_id)
);

-- One undecided row per Member: a run supersedes the open rows first.
create unique index promotion_candidates_open_member_uidx
  on public.promotion_candidates (member_id)
  where decision is null;

alter table public.promotion_candidates enable row level security;

comment on table public.promotion_candidates is
  '#826 (ruling R28): a Voluntar with the required tenure whose Task Points reached the Voluntar Activ Promotion Threshold at a Role Evaluation -- never promoted automatically. decision null while BC has not decided; promoted when the Member leaves Voluntar upward (the role_history trigger, decided_by the BC who changed the Role), rejected by public.reject_promotion_candidate (with BC''s reason), superseded by the next Voluntar Activ run or by leaving Voluntar any other way. At most one undecided row per Member. BC and the Moderator read every row; a Member reads their own. Named role_evaluation_id, not evaluation_id: points_ledger.evaluation_id already means a Task''s Evaluation.';

revoke all on table public.promotion_candidates from public, anon, authenticated, service_role;
grant select on table public.promotion_candidates to authenticated, service_role;
revoke all on sequence public.promotion_candidates_id_seq from public, anon, authenticated;

create policy promotion_candidates_read on public.promotion_candidates
  for select to authenticated
  using ((select public.auth_is_member())
         and ((select private.caller_level()) >= 6
              or (member_id = (select auth.uid()) and (select private.caller_level()) >= 0)));

comment on policy promotion_candidates_read on public.promotion_candidates is
  '#826: BC and the Moderator (live level >= 6) read every Promotion Candidate; any live active Member reads their own rows. Organization claims on both limbs (house rule 12). No write policy: run_role_evaluation, reject_promotion_candidate and the role_history trigger are the write paths.';

-- ---------------------------------------------------------------------------
-- 6. Drop the open/close model.
-- ---------------------------------------------------------------------------
drop function public.open_evaluation_period(text);
drop function private.open_evaluation_period_impl(text);
drop function public.close_evaluation_period(bigint);
drop function private.close_evaluation_period_impl(bigint);
drop function private.stamp_closing_threshold(bigint);
drop function private.apply_close_promotions(bigint);
drop function private.detect_close_promotions(bigint);
drop function private.detect_retention_signals(bigint);
drop function public.evaluation_period_ranking(bigint);
drop function private.evaluation_period_ranking_impl(bigint);
drop function private.evaluation_period_ranking_rows(bigint);
drop function public.retention_ranking(bigint);
drop function private.retention_ranking_impl(bigint);
drop function private.retention_ranking_rows(bigint);
drop function public.set_promotion_rule(bigint, integer);
drop function private.set_promotion_rule_impl(bigint, integer);
-- Never overloaded (PGRST203): the per-kind read replaces it below.
drop function public.promotion_threshold_in_force();
-- Loses p_period_id: the daily job is its only caller now.
drop function private.apply_promotion(uuid, public.member_role, public.member_role, text, bigint);

-- Its one-open index, exclusion constraint and read policy go with it.
drop table public.evaluation_periods;

-- ---------------------------------------------------------------------------
-- 7. promotion_rules loses the initial threshold.
-- ---------------------------------------------------------------------------
alter table public.promotion_rules
  drop constraint promotion_rules_time_shape_ck,
  drop constraint promotion_rules_top_percent_shape_ck,
  drop constraint promotion_rules_initial_threshold_range_ck,
  drop column initial_threshold;

alter table public.promotion_rules
  add constraint promotion_rules_time_shape_ck
    check (kind <> 'time' or percent is null),
  add constraint promotion_rules_top_percent_shape_ck
    check (kind <> 'top_percent' or percent is not null);

comment on table public.promotion_rules is
  '#49, amended by #826 (ruling R28): one row per Promotion Rule. kind time: tenure alone, min_tenure_months from profiles.joined_at (Recrut -> Voluntar), applied daily by osubb-apply-promotions. kind top_percent (Voluntar -> Voluntar Activ): min_tenure_months is the tenure a Voluntar needs to be ranked and to become a Promotion Candidate at a Voluntar Activ Role Evaluation; percent is x, the Voluntar Activ cohort''s top share whose boundary becomes the next Voluntar Activ Promotion Threshold (y, for Drept de Vot, is org_settings.vote_retention_percent). enabled false: the rule yields no promotion (time) and no Promotion Candidate (top_percent). At most one top_percent row. Every live active Member reads every row; no client writes one.';
comment on column public.promotion_rules.percent is
  '#49, amended by #826: top_percent only -- x, the share of the Voluntar Activ cohort whose last holder''s Task Points become the Voluntar Activ Promotion Threshold computed by a Role Evaluation. Null for time.';
comment on column public.promotion_rules.enabled is
  '#49, amended by #826: whether the rule yields anything -- the daily job''s promotions (time) or a Voluntar Activ Role Evaluation''s Promotion Candidates (top_percent). The ranking, the Retention Signals and the threshold hand-over do not read it.';

-- ---------------------------------------------------------------------------
-- 8. The Task Points core over a range.
-- ---------------------------------------------------------------------------
create function private.task_points_in_range(p_from timestamptz, p_to timestamptz)
returns table (member_id uuid, task_points integer)
language sql
stable
set search_path = ''
as $$
  select entry.member_id,
         sum(entry.delta)::int
    from public.task_evaluations as evaluation
    join public.points_ledger as entry on entry.evaluation_id = evaluation.id
   where evaluation.evaluated_at >= p_from
     and evaluation.evaluated_at < p_to
     and entry.reason in ('task', 'task_reversal')
   group by entry.member_id;
$$;

comment on function private.task_points_in_range(timestamptz, timestamptz) is
  '#826 (#47''s core over a range): every Member''s net Task Points from Task Evaluations whose instant (task_evaluations.evaluated_at, through points_ledger.evaluation_id) falls in [p_from, p_to) -- points_ledger rows of reason task/task_reversal, so a reversed in-range award nets to zero and a sanction is not a Task Point. A Member no in-range Evaluation touched has no row. No visibility rule; granted to nobody: security-definer bodies read it.';

revoke execute on function private.task_points_in_range(timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. The ranking of one kind over one Evaluation Period, every row.
-- ---------------------------------------------------------------------------
create function private.role_evaluation_rows(
  p_kind        text,
  p_period_from date,
  p_period_to   date,
  p_on_date     date
)
returns table (
  member_id    uuid,
  role         public.member_role,
  task_points  integer,
  rank         integer,
  cohort_size  integer,
  share_size   integer,
  inside       boolean,
  tenure_since date
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_activ_percent integer;
  v_tenure_months integer;
  v_vot_percent   integer;
begin
  if p_kind is null or p_kind not in ('voluntar_activ', 'adunarea_generala') then
    raise sqlstate 'PT400' using message = 'invalid_role_evaluation_kind';
  end if;
  if p_period_from is null or p_period_to is null or p_period_to < p_period_from then
    raise sqlstate 'PT400' using message = 'invalid_date_range';
  end if;

  -- x and the tenure: the top_percent Promotion Rule's (#49).
  select rule.percent, rule.min_tenure_months into v_activ_percent, v_tenure_months
    from public.promotion_rules as rule
   where rule.kind = 'top_percent';
  if not found then
    raise sqlstate 'PT404' using message = 'promotion_rule_not_found';
  end if;

  -- y: the Vote Retention Threshold (#48); its CHECK keeps it a whole 1-100.
  select setting.value::integer into v_vot_percent
    from public.org_settings as setting
   where setting.key = 'vote_retention_percent';
  if v_vot_percent is null then
    raise sqlstate 'PT404' using message = 'org_setting_not_found';
  end if;

  return query
  with points as (
    select earned.member_id, earned.task_points
      from private.task_points_in_range(
             (p_period_from::timestamp at time zone 'Europe/Bucharest'),
             ((p_period_to + 1)::timestamp at time zone 'Europe/Bucharest')) as earned
  ),
  population as (
    select profile.id as member_id,
           profile.role as role,
           coalesce(points.task_points, 0) as task_points,
           case when profile.role = 'voluntar'
                then (profile.joined_at + make_interval(months => v_tenure_months))::date
           end as tenure_since
      from public.profiles as profile
      left join points on points.member_id = profile.id
     where profile.status = 'activ'
       and ((p_kind = 'voluntar_activ'
             and (profile.role = 'activ'
                  or (profile.role = 'voluntar'
                      and profile.joined_at is not null
                      and (profile.joined_at + make_interval(months => v_tenure_months))::date <= p_on_date)))
         or (p_kind = 'adunarea_generala' and profile.role = 'vot'))
  ),
  cohorts as (
    select member.member_id,
           member.role,
           member.task_points,
           member.tenure_since,
           (rank() over (partition by member.role order by member.task_points desc))::int as cohort_rank,
           (count(*) over (partition by member.role))::int as cohort_count
      from population as member
  )
  select cohort.member_id,
         cohort.role,
         cohort.task_points,
         cohort.cohort_rank,
         cohort.cohort_count,
         ceil(case when cohort.role = 'vot' then v_vot_percent else v_activ_percent end
              * cohort.cohort_count / 100.0)::int,
         cohort.cohort_rank <= ceil(case when cohort.role = 'vot' then v_vot_percent else v_activ_percent end
                                    * cohort.cohort_count / 100.0)::int,
         cohort.tenure_since
    from cohorts as cohort
   order by cohort.role, cohort.cohort_rank, cohort.member_id;
end;
$$;

comment on function private.role_evaluation_rows(text, date, date, date) is
  '#826 (ruling R28; #47''s ranking, #48''s cohorts, #49''s boundary): the ranking of one Role Evaluation kind over the Evaluation Period [p_period_from, p_period_to] (inclusive Europe/Bucharest days), every row. Live active Members only. voluntar_activ: every Voluntar Activ holder plus every Voluntar whose joined_at + the top_percent rule''s min_tenure_months falls on or before p_on_date (tenure_since is that date). adunarea_generala: every Voluntar cu Drept de Vot holder. Task Points are the net in-range total (0 when nothing in range touched them). Each Role is ranked within its own cohort (rank(), ties share it), share_size = ceil(percent x cohort_size / 100) with x (the top_percent rule''s percent) for voluntar/activ and y (org_settings.vote_retention_percent) for vot, inside = rank <= share_size. PT400 invalid_role_evaluation_kind, invalid_date_range; PT404 promotion_rule_not_found, org_setting_not_found. No visibility rule; granted to nobody.';

revoke execute on function private.role_evaluation_rows(text, date, date, date)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. The ranking the caller may read.
-- ---------------------------------------------------------------------------
create function private.role_evaluation_ranking_impl(p_kind text, p_from date, p_to date)
returns table (
  member_id    uuid,
  role         public.member_role,
  task_points  integer,
  rank         integer,
  cohort_size  integer,
  share_size   integer,
  inside       boolean,
  tenure_since date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_caller    uuid;
  v_full_read boolean;
begin
  -- Nothing, and no error, without organization claims or a live activ
  -- Profile (house rule 12).
  if not (coalesce(public.auth_is_member(), false) and private.caller_level() >= 0) then
    return;
  end if;
  v_caller := auth.uid();
  v_full_read := private.can_read_evaluation_rankings();

  return query
  select ranked.member_id,
         ranked.role,
         ranked.task_points,
         ranked.rank,
         ranked.cohort_size,
         ranked.share_size,
         ranked.inside,
         ranked.tenure_since
    from private.role_evaluation_rows(
           p_kind, p_from, p_to, (now() at time zone 'Europe/Bucharest')::date) as ranked
   where v_full_read
      or ranked.member_id = v_caller
   order by ranked.role, ranked.rank, ranked.member_id;
end;
$$;

comment on function private.role_evaluation_ranking_impl(text, date, date) is
  '#826: body of public.role_evaluation_ranking. private.role_evaluation_rows (tenure measured today, Europe/Bucharest) filtered for the caller: nothing -- and no error -- without organization claims or a live activ Profile; the caller''s own row for any live active Member in the kind''s population; every row when #512''s private.can_read_evaluation_rankings() holds (BC, Moderator, the Adunarea Generală''s Group Managers and Group Responsibles and those of its ancestors). PT400 invalid_role_evaluation_kind / invalid_date_range for a live Member.';

create function public.role_evaluation_ranking(p_kind text, p_from date, p_to date)
returns table (
  member_id    uuid,
  role         public.member_role,
  task_points  integer,
  rank         integer,
  cohort_size  integer,
  share_size   integer,
  inside       boolean,
  tenure_since date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
    from private.role_evaluation_ranking_impl(p_kind, p_from, p_to)
   order by role, rank, member_id;
$$;

comment on function public.role_evaluation_ranking(text, date, date) is
  '#826 (ruling R28; replaces evaluation_period_ranking and retention_ranking): the ranking of one Role Evaluation kind (voluntar_activ or adunarea_generala) over the Evaluation Period [p_from, p_to], inclusive Bucharest days -- per live active Member of the kind''s population (Voluntar Activ holders and tenured Voluntars; or Voluntar cu Drept de Vot holders): role, task_points (net, in range; 0 if none), rank within that Role''s cohort (ties share it), cohort_size, share_size = ceil(percent x cohort_size / 100) (x, or y for Drept de Vot), inside (rank <= share_size) and tenure_since (Voluntars: the day their tenure was reached). BC, Moderator and the Adunarea Generală''s Group Managers and Group Responsibles (and those of its ancestors) read every row; any other live Member reads their own row; a claimless or deactivated session reads nothing. PT400 invalid_role_evaluation_kind, invalid_date_range.';

revoke execute on function private.role_evaluation_ranking_impl(text, date, date)
  from public, anon, authenticated, service_role;
revoke execute on function public.role_evaluation_ranking(text, date, date)
  from public, anon, authenticated, service_role;
grant execute on function private.role_evaluation_ranking_impl(text, date, date) to authenticated;
grant execute on function public.role_evaluation_ranking(text, date, date) to authenticated;

comment on function private.can_read_evaluation_rankings() is
  '#512 (ADR-0009 §Other rulings), read by #826''s private.role_evaluation_ranking_impl: whether the caller reads the Adunarea Generală''s eligibility data in full -- every row of a Role Evaluation ranking. True for a caller with organization claims (house rule 12) who is live active at level >= 6 (BC, Moderator), or live active and holding group_role manager or responsible on the Adunarea Generală Group or on any ancestor of it (held.group_id = any (target.path)). The Adunarea Generală is identified by org_settings.adunarea_generala_group_id, never by its name; null there means only level >= 6 reads everything. Granted to nobody: read from security-definer bodies.';

-- ---------------------------------------------------------------------------
-- 11. The threshold in force, per kind.
-- ---------------------------------------------------------------------------
create function public.promotion_threshold_in_force(p_kind text)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select threshold.threshold
    from public.promotion_thresholds as threshold
   where threshold.kind = p_kind;
$$;

comment on function public.promotion_threshold_in_force(text) is
  '#826 (ruling R28; replaces #49''s argument-less read): the Promotion Threshold in force for one Role Evaluation kind (voluntar_activ or adunarea_generala) -- promotion_thresholds.threshold, null while BC has not entered it or for an unknown kind. Security invoker over a table every live active Member reads, so a claimless or deactivated session gets null.';

revoke execute on function public.promotion_threshold_in_force(text)
  from public, anon, authenticated, service_role;
grant execute on function public.promotion_threshold_in_force(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. The caller's standing since the kind's last Role Evaluation (#634).
-- ---------------------------------------------------------------------------
create function private.my_role_evaluation_standing_impl(p_kind text)
returns table (since date, task_points integer, threshold integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
$$;

comment on function private.my_role_evaluation_standing_impl(text) is
  '#826: body of public.my_role_evaluation_standing. For the caller only: since = the day after the period_to of the kind''s latest Role Evaluation (by run_at; null before any), task_points = the caller''s net Task Points from Evaluations since then (all time when since is null), threshold = the kind''s Promotion Threshold in force. Nothing without organization claims or a live activ Profile; PT400 invalid_role_evaluation_kind.';

create function public.my_role_evaluation_standing(p_kind text)
returns table (since date, task_points integer, threshold integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.my_role_evaluation_standing_impl(p_kind);
$$;

comment on function public.my_role_evaluation_standing(text) is
  '#826 (for #634''s Profil progress): one row for the caller -- since (the day after the kind''s last Role Evaluation''s period_to; null before any), task_points (own net Task Points since then, or all time) and threshold (the kind''s Promotion Threshold in force, null while unset). Never another Member''s points and no rank (R6). Nothing for a claimless or deactivated session; PT400 invalid_role_evaluation_kind.';

revoke execute on function private.my_role_evaluation_standing_impl(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.my_role_evaluation_standing(text)
  from public, anon, authenticated, service_role;
grant execute on function private.my_role_evaluation_standing_impl(text) to authenticated;
grant execute on function public.my_role_evaluation_standing(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. The command: run a Role Evaluation.
-- ---------------------------------------------------------------------------
create function private.run_role_evaluation_impl(p_kind text, p_from date, p_to date, p_name text)
returns table (role_evaluation_id bigint, candidates integer, retention_signals integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_name        text;
  v_actor       uuid;
  v_today       date;
  v_threshold   public.promotion_thresholds%rowtype;
  v_holder_role public.member_role;
  v_rule_on     boolean;
  v_rows        jsonb;
  v_computed    integer;
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

  -- 2. The gate: claims and a live activ Profile, then BC or Moderator.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'role_evaluation_manage_forbidden';
  end;
  if coalesce(private.actor_level(v_actor), -1) < 6 then
    raise exception using errcode = '42501', message = 'role_evaluation_manage_forbidden';
  end if;

  -- 3. Runs and threshold edits serialise here, then the kind's threshold row.
  perform pg_catalog.pg_advisory_xact_lock(47, 1);
  select * into v_threshold
    from public.promotion_thresholds as setting
   where setting.kind = p_kind
   for no key update;

  -- 4. State: the first threshold of a kind is entered by hand.
  if v_threshold.threshold is null then
    raise sqlstate 'PT409' using message = 'promotion_threshold_not_set';
  end if;

  -- Role changes wait for this run: set_member_role locks the Profile `for
  -- update` and its role_history trigger then closes candidates, so taking
  -- the population's Profiles `for key share` here (Profiles first,
  -- candidates after -- the order set_member_role uses) keeps the ranking
  -- below from listing a Member promoted underneath it, and the candidate
  -- insert's FK check from deadlocking against that promotion.
  perform 1
     from public.profiles as profile
    where profile.status = 'activ'
      and profile.role in ('voluntar', 'activ', 'vot')
    order by profile.id
      for key share;

  -- 5. The ranking, read once (one snapshot for every step below).
  select coalesce(jsonb_agg(to_jsonb(ranked)), '[]'::jsonb) into v_rows
    from private.role_evaluation_rows(p_kind, p_from, p_to, v_today) as ranked;

  v_holder_role := case p_kind
                     when 'voluntar_activ' then 'activ'::public.member_role
                     else 'vot'::public.member_role
                   end;

  -- The boundary of the holders' cohort: the share-th holder's Task Points,
  -- which is the lowest score inside the share (ties share it).
  select min(ranked.task_points) into v_computed
    from jsonb_to_recordset(v_rows) as ranked (role public.member_role, task_points integer, inside boolean)
   where ranked.role = v_holder_role
     and ranked.inside;

  insert into public.role_evaluations (
    kind, name, period_from, period_to, run_by, threshold_used, threshold_computed, ranked_count
  ) values (
    p_kind, v_name, p_from, p_to, v_actor, v_threshold.threshold, v_computed,
    jsonb_array_length(v_rows)
  )
  returning id into v_run_id;

  v_span := pg_catalog.to_char(p_from, 'DD.MM.YYYY') || '–' || pg_catalog.to_char(p_to, 'DD.MM.YYYY');

  select array_agg(profile.id order by profile.id) into v_leaders
    from public.profiles as profile
    join public.roles as role on role.id = profile.role
   where profile.status = 'activ'
     and role.level >= 6;

  -- 6. Promotion Candidates (Voluntar Activ kind): the previous run's
  --    undecided rows are superseded; every tenured Voluntar at or above the
  --    threshold used gets a row and one Notification per BC/Moderator.
  if p_kind = 'voluntar_activ' then
    update public.promotion_candidates as candidate
       set decision = 'superseded',
           decided_at = now(),
           decided_by = v_actor
     where candidate.decision is null;

    select rule.enabled into v_rule_on
      from public.promotion_rules as rule
     where rule.kind = 'top_percent';

    if coalesce(v_rule_on, false) then
      for v_row in
        select ranked.member_id,
               ranked.task_points,
               ranked.tenure_since,
               coalesce(member.nickname, member.full_name) as member_name
          from jsonb_to_recordset(v_rows) as ranked (
                 member_id uuid, role public.member_role, task_points integer, tenure_since date)
          join public.profiles as member on member.id = ranked.member_id
         where ranked.role = 'voluntar'
           and ranked.task_points >= v_threshold.threshold
         order by ranked.member_id
      loop
        insert into public.promotion_candidates (role_evaluation_id, member_id, task_points, tenure_since)
        values (v_run_id, v_row.member_id, v_row.task_points, v_row.tenure_since);
        v_candidates := v_candidates + 1;

        perform private.notify(
          v_leaders, 'system',
          format('Candidat la promovare: %s', v_row.member_name),
          format('%s are %s puncte de task în evaluarea „%s” (%s), cel puțin pragul de %s puncte, '
                 'și vechimea cerută. Nu este promovat automat: îl poți promova în Voluntar Activ '
                 'din panoul de roluri sau respinge din Evaluări de rol.',
                 v_row.member_name, v_row.task_points, v_name, v_span, v_threshold.threshold),
          null, 'promotion_candidate:' || v_run_id::text || ':' || v_row.member_id::text,
          null, '/administrare/evaluari');
      end loop;
    end if;
  end if;

  -- 7. Retention Signals: every holder below the threshold used. Nothing
  --    changes; BC, the Moderator and the Adunarea Generală's Group
  --    Responsibles are told.
  select case when setting.value ~ '^[1-9][0-9]{0,17}$' then setting.value::bigint end
    into v_ag_group_id
    from public.org_settings as setting
   where setting.key = 'adunarea_generala_group_id';

  for v_row in
    select ranked.member_id,
           ranked.task_points,
           role.name as role_name,
           coalesce(member.nickname, member.full_name) as member_name
      from jsonb_to_recordset(v_rows) as ranked (
             member_id uuid, role public.member_role, task_points integer)
      join public.roles as role on role.id = ranked.role
      join public.profiles as member on member.id = ranked.member_id
     where ranked.role = v_holder_role
       and ranked.task_points < v_threshold.threshold
     order by ranked.member_id
  loop
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
             order by recipient.id),
      'system',
      format('Semnal de retenție: %s', v_row.member_name),
      format('%s (%s) are %s puncte de task în evaluarea „%s” (%s), sub pragul de %s puncte. '
             'Rolul nu se retrage automat: decizia îi aparține BC.',
             v_row.member_name, v_row.role_name, v_row.task_points, v_name, v_span,
             v_threshold.threshold),
      null, 'retention_signal:' || v_run_id::text || ':' || v_row.member_id::text,
      null, '/tracker/membru/' || v_row.member_id::text);
  end loop;

  -- 8. The hand-over: the computed value is in force for the kind's next run.
  if v_computed >= 1 and v_computed is distinct from v_threshold.threshold then
    update public.promotion_thresholds
       set threshold = v_computed,
           updated_by = null
     where kind = p_kind;

    insert into public.promotion_threshold_changes (
      kind, from_value, to_value, source, changed_by, role_evaluation_id
    ) values (
      p_kind, v_threshold.threshold, v_computed, 'role_evaluation', null, v_run_id
    );
  end if;

  return query select v_run_id, v_candidates, v_signals;
end;
$$;

comment on function private.run_role_evaluation_impl(text, date, date, text) is
  '#826: body of public.run_role_evaluation. Step 1 (before the gate): PT400 invalid_role_evaluation_kind, invalid_role_evaluation_name (null or blank), name_too_short / name_too_long (trimmed, 3..120), invalid_date_range (a null end or p_to < p_from), date_range_in_future (p_to after today in Bucharest). Step 2: private.require_active_member() and live level >= 6, every refusal 42501 role_evaluation_manage_forbidden. Step 3: pg_advisory_xact_lock(47, 1), then the kind''s promotion_thresholds row for no key update. Step 4: PT409 promotion_threshold_not_set while it is null. Then, in one transaction: the ranking (private.role_evaluation_rows, tenure measured today) read once; the run inserted with threshold_used and threshold_computed (the lowest score inside the holders'' cohort share, null when empty); for voluntar_activ, every undecided Promotion Candidate superseded and, when the top_percent rule is enabled, one candidate per tenured Voluntar at or above the threshold used with one system Notification to every live BC/Moderator (dedupe promotion_candidate:<run>:<member>, link /administrare/evaluari); one Retention Signal Notification per holder (activ, or vot) below the threshold used, to every live BC/Moderator and the Adunarea Generală''s Group Responsibles minus the Member (dedupe retention_signal:<run>:<member>, link /tracker/membru/<id>); the computed threshold handed over (with a role_evaluation change row) when >= 1 and different. No Role changes. Returns (role_evaluation_id, candidates, retention_signals).';

create function public.run_role_evaluation(p_kind text, p_from date, p_to date, p_name text)
returns table (role_evaluation_id bigint, candidates integer, retention_signals integer)
language sql
security invoker
set search_path = ''
as $$
  select * from private.run_role_evaluation_impl(p_kind, p_from, p_to, p_name);
$$;

comment on function public.run_role_evaluation(text, date, date, text) is
  '#826 (ruling R28): BC or the Moderator runs a Role Evaluation of one kind (voluntar_activ or adunarea_generala) over the Evaluation Period [p_from, p_to] (inclusive Bucharest days, ending today at the latest), named p_name (3..120 characters). It ranks the kind''s population by Task Points in the range, stores the threshold used and the one computed (in force for the kind''s next run unless BC edits it), writes Promotion Candidates (voluntar_activ: tenured Voluntars at or above the threshold -- never promoted) and notifies BC/Moderator of each candidate and each Retention Signal (a holder below the threshold). Nothing is opened or closed and no Role changes. 42501 role_evaluation_manage_forbidden; PT400 invalid_role_evaluation_kind, invalid_role_evaluation_name, name_too_short, name_too_long, invalid_date_range, date_range_in_future; PT409 promotion_threshold_not_set. Returns (role_evaluation_id, candidates, retention_signals).';

revoke execute on function private.run_role_evaluation_impl(text, date, date, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.run_role_evaluation(text, date, date, text)
  from public, anon, authenticated, service_role;
grant execute on function private.run_role_evaluation_impl(text, date, date, text) to authenticated;
grant execute on function public.run_role_evaluation(text, date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 14. The command: edit a Promotion Threshold (replaces set_promotion_rule).
-- ---------------------------------------------------------------------------
create function private.set_promotion_threshold_impl(p_kind text, p_threshold integer)
returns public.promotion_thresholds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid;
  v_current public.promotion_thresholds%rowtype;
  v_from    integer;
begin
  -- 1. Malformed for every caller (promotion_thresholds_kind_ck, _range_ck).
  if p_kind is null or p_kind not in ('voluntar_activ', 'adunarea_generala') then
    raise sqlstate 'PT400' using message = 'invalid_role_evaluation_kind';
  end if;
  if p_threshold is null or p_threshold < 1 then
    raise sqlstate 'PT400' using message = 'invalid_promotion_threshold';
  end if;

  -- 2. The gate: claims and a live activ Profile, then BC or Moderator.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'promotion_threshold_manage_forbidden';
  end;
  if coalesce(private.actor_level(v_actor), -1) < 6 then
    raise exception using errcode = '42501', message = 'promotion_threshold_manage_forbidden';
  end if;

  -- 3. Serialised with every run, in its lock order: (47, 1), then the row.
  perform pg_catalog.pg_advisory_xact_lock(47, 1);
  select * into v_current
    from public.promotion_thresholds as setting
   where setting.kind = p_kind
   for no key update;

  -- 4. State. Editable at any time -- before or after a run (R28).
  if v_current.threshold is not distinct from p_threshold then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- 5. Write, and audit.
  v_from := v_current.threshold;
  update public.promotion_thresholds
     set threshold = p_threshold,
         updated_by = v_actor
   where kind = p_kind
  returning * into v_current;

  insert into public.promotion_threshold_changes (
    kind, from_value, to_value, source, changed_by, role_evaluation_id
  ) values (
    p_kind, v_from, p_threshold, 'manual', v_actor, null
  );

  return v_current;
end;
$$;

comment on function private.set_promotion_threshold_impl(text, integer) is
  '#826: body of public.set_promotion_threshold. PT400 invalid_role_evaluation_kind, invalid_promotion_threshold (null or below 1) before the gate; private.require_active_member() and live level >= 6, every refusal 42501 promotion_threshold_manage_forbidden; pg_advisory_xact_lock(47, 1), shared with run_role_evaluation, then the kind''s row for no key update; PT409 nothing_to_update for an unchanged value. Writes the threshold with updated_by and one manual promotion_threshold_changes row (from_value, to_value, changed_by). No "after a run" refusal (R28).';

create function public.set_promotion_threshold(p_kind text, p_threshold integer)
returns public.promotion_thresholds
language sql
security invoker
set search_path = ''
as $$
  select * from private.set_promotion_threshold_impl(p_kind, p_threshold);
$$;

comment on function public.set_promotion_threshold(text, integer) is
  '#826 (ruling R28; replaces set_promotion_rule): BC or the Moderator sets the Promotion Threshold of one Role Evaluation kind (voluntar_activ or adunarea_generala) -- a whole number of Task Points >= 1, at any time, before or after a run. The value is in force for the kind''s next Role Evaluation; every edit is logged in promotion_threshold_changes with its author. 42501 promotion_threshold_manage_forbidden; PT400 invalid_role_evaluation_kind, invalid_promotion_threshold; PT409 nothing_to_update. Returns the promotion_thresholds row.';

revoke execute on function private.set_promotion_threshold_impl(text, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.set_promotion_threshold(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.set_promotion_threshold_impl(text, integer) to authenticated;
grant execute on function public.set_promotion_threshold(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 15. The command: reject a Promotion Candidate.
-- ---------------------------------------------------------------------------
create function private.reject_promotion_candidate_impl(p_candidate_id bigint, p_reason text)
returns public.promotion_candidates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason    text;
  v_actor     uuid;
  v_candidate public.promotion_candidates%rowtype;
begin
  -- 1. Malformed for every caller.
  if p_reason is null or p_reason !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'invalid_rejection_reason';
  end if;
  v_reason := pg_catalog.regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  perform private.require_text_length('reason', v_reason, null, 500);

  -- 2. The gate.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'promotion_candidate_manage_forbidden';
  end;
  if coalesce(private.actor_level(v_actor), -1) < 6 then
    raise exception using errcode = '42501', message = 'promotion_candidate_manage_forbidden';
  end if;

  -- 3. The target under lock.
  select * into v_candidate
    from public.promotion_candidates as candidate
   where candidate.id = p_candidate_id
   for update;
  if not found then
    raise sqlstate 'PT404' using message = 'promotion_candidate_not_found';
  end if;

  -- 4. State.
  if v_candidate.decision is not null then
    raise sqlstate 'PT409' using message = 'promotion_candidate_decided';
  end if;

  -- 5. Write. No Notification: the decision is BC's own.
  update public.promotion_candidates
     set decision = 'rejected',
         decided_at = now(),
         decided_by = v_actor,
         reason = v_reason
   where id = p_candidate_id
  returning * into v_candidate;

  return v_candidate;
end;
$$;

comment on function private.reject_promotion_candidate_impl(bigint, text) is
  '#826: body of public.reject_promotion_candidate. PT400 invalid_rejection_reason (null or blank), reason_too_long (trimmed, above 500) before the gate; private.require_active_member() and live level >= 6, every refusal 42501 promotion_candidate_manage_forbidden; the candidate for update -- PT404 promotion_candidate_not_found, PT409 promotion_candidate_decided. Writes decision rejected, decided_at, decided_by and the trimmed reason. Sends no Notification.';

create function public.reject_promotion_candidate(p_candidate_id bigint, p_reason text)
returns public.promotion_candidates
language sql
security invoker
set search_path = ''
as $$
  select * from private.reject_promotion_candidate_impl(p_candidate_id, p_reason);
$$;

comment on function public.reject_promotion_candidate(bigint, text) is
  '#826 (ruling R28): BC or the Moderator rejects an undecided Promotion Candidate with a reason (1..500 characters, trimmed). The rejection holds for that Role Evaluation only: a later Voluntar Activ run lists the Member again while they are still at or above the threshold. 42501 promotion_candidate_manage_forbidden; PT400 invalid_rejection_reason, reason_too_long; PT404 promotion_candidate_not_found; PT409 promotion_candidate_decided. Returns the row.';

revoke execute on function private.reject_promotion_candidate_impl(bigint, text)
  from public, anon, authenticated, service_role;
revoke execute on function public.reject_promotion_candidate(bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function private.reject_promotion_candidate_impl(bigint, text) to authenticated;
grant execute on function public.reject_promotion_candidate(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 16. A Member leaving Voluntar closes their open candidate row.
-- ---------------------------------------------------------------------------
create function private.close_promotion_candidates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
  return null;
end;
$$;

comment on function private.close_promotion_candidates() is
  '#826: trigger body of role_history_close_promotion_candidates. When a role_history row moves a Member off Voluntar, their undecided Promotion Candidate row closes: promoted when the new Role is higher (decided_by = the BC who changed it, changed_by), superseded otherwise. Granted to nobody.';

revoke execute on function private.close_promotion_candidates()
  from public, anon, authenticated, service_role;

create trigger role_history_close_promotion_candidates
after insert on public.role_history
for each row execute function private.close_promotion_candidates();

-- ---------------------------------------------------------------------------
-- 17. The daily job keeps the tenure rule only. Rebuilt from
--     20260927120000_retire_level_four.sql (detect_promotions,
--     apply_promotion) and 20260926180600_apply_promotions.sql
--     (apply_promotions): the top_percent arm, the Period and the Voluntar
--     Activ copy are gone.
-- ---------------------------------------------------------------------------
create or replace function private.detect_promotions()
returns table (
  member_id uuid,
  from_role public.member_role,
  to_role   public.member_role,
  rule_id   bigint,
  rule_kind text
)
language sql
stable
security definer
set search_path = ''
as $$
  with today as (
    select (now() at time zone 'Europe/Bucharest')::date as on_date
  )
  select profile.id,
         rule.from_role,
         rule.to_role,
         rule.id,
         rule.kind
    from public.promotion_rules as rule
    join public.profiles as profile
      on profile.role = rule.from_role
     and profile.status = 'activ'
   cross join today
   where rule.kind = 'time'
     and rule.enabled
     and profile.joined_at is not null
     and (profile.joined_at + make_interval(months => rule.min_tenure_months))::date <= today.on_date
   order by profile.id;
$$;

comment on function private.detect_promotions() is
  '#51, trimmed by #826 (ruling R28): the automatic Promotion Rules, as rows (member_id, from_role, to_role, rule_id, rule_kind) -- nothing is written. Only enabled kind time rules (Recrut -> Voluntar): every live active Member holding its from_role whose joined_at + min_tenure_months falls on or before today''s Europe/Bucharest date (null joined_at: no tenure). Voluntar -> Voluntar Activ is never automatic: a Voluntar Activ Role Evaluation lists Promotion Candidates and BC promotes by hand. Ordered by member_id. Stable, executable by nobody: the daily job calls it.';

create function private.apply_promotion(
  p_member_id uuid,
  p_from_role public.member_role,
  p_to_role   public.member_role,
  p_rule_kind text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member     public.profiles%rowtype;
  v_from_level integer;
  v_to_level   integer;
  v_to_name    text;
  v_history_id bigint;
begin
  -- The Profile under lock, re-read: detection ran before the lock.
  select * into v_member
    from public.profiles
   where id = p_member_id
   for no key update;
  if not found or v_member.status <> 'activ' or v_member.role <> p_from_role then
    return false;
  end if;

  -- Never a demotion, never a sideways move: the Role must rise.
  select role.level into v_from_level from public.roles as role where role.id = p_from_role;
  select role.level, role.name into v_to_level, v_to_name
    from public.roles as role
   where role.id = p_to_role;
  if v_from_level is null or v_to_level is null or v_to_level <= v_from_level then
    return false;
  end if;

  update public.profiles
     set role = p_to_role
   where id = p_member_id;

  insert into public.role_history (
    member_id, from_role, to_role, changed_by, actor_kind, reason
  ) values (
    p_member_id, p_from_role, p_to_role, null, 'automatic',
    format('Automatic promotion (apply_promotions, %s rule)', p_rule_kind)
  )
  returning id into v_history_id;

  perform private.notify(
    array[p_member_id], 'system',
    format('Felicitări! Acum ești %s', v_to_name),
    format('Rolul tău în OSUBB este acum %s: ai împlinit vechimea cerută de regula de promovare.', v_to_name),
    null, 'promotion:' || v_history_id::text, null, '/profil');

  return true;
end;
$$;

comment on function private.apply_promotion(uuid, public.member_role, public.member_role, text) is
  '#52, trimmed by #826: the core of private.apply_promotions -- applies one row #51 detected. Locks the Profile for no key update and re-reads it: skipped (false) unless the Member is live active and still holds p_from_role, and unless p_to_role''s level is above p_from_role''s (never a demotion). Otherwise sets profiles.role, writes one role_history row with the system actor (actor_kind automatic, changed_by null, #50) and one system Notification to the Member (link /profil, dedupe key promotion:<role_history id>). Executable by nobody.';

revoke execute on function private.apply_promotion(uuid, public.member_role, public.member_role, text)
  from public, anon, authenticated, service_role;

create or replace function private.apply_promotions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   record;
  v_count integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(52, 1);
  for v_row in
    select detected.member_id, detected.from_role, detected.to_role, detected.rule_kind
      from private.detect_promotions() as detected
  loop
    if private.apply_promotion(v_row.member_id, v_row.from_role, v_row.to_role,
                               v_row.rule_kind) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

comment on function private.apply_promotions() is
  '#52, trimmed by #826 (ruling R28): the daily pg_cron job osubb-apply-promotions. Takes pg_advisory_xact_lock(52, 1), then applies every row of private.detect_promotions() -- the tenure rule, Recrut -> Voluntar -- through private.apply_promotion. Returns the number of promotions applied; a second run applies none. Never promotes to Voluntar Activ, never demotes or withdraws a Role. Executable by nobody.';

-- ---------------------------------------------------------------------------
-- 18. set_member_role: a new Voluntar Activ hears about AG Eligibility and the
--     adherence form -- the text the automatic promotion carried. Rebuilt
--     from 20260927120000_retire_level_four.sql (its latest definition); what
--     is new is the v_form_url read and the 'activ' branch of the body.
-- ---------------------------------------------------------------------------
create or replace function private.set_member_role_impl(p_member_id uuid, p_role public.member_role, p_reason text default null::text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor       uuid;
  v_actor_role  public.member_role;
  v_from        public.member_role;
  v_role_name   text;
  v_new_level   integer;
  v_groups_left text[];
  v_form_url    text;
  v_member      public.profiles%rowtype;
begin
  -- 1. Malformed for every caller, so it is answered ahead of any authority
  --    verdict (conventions section 2). The retired rank is no longer a value
  --    of the enum (#593), so it cannot reach this command at all.
  if p_role is null then
    raise sqlstate 'PT400' using message = 'invalid_member_role';
  end if;

  -- #724 (ruling R8). Measured exactly as it is stored -- trimmed -- and
  -- malformed for every caller, so it is answered before any authority
  -- verdict; a blank reason still falls back to the fixed string below.
  perform private.require_text_length('reason',
    regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'), null, 1000);

  -- 2. Authority. One reason string for every denial -- a caller must not be
  --    able to tell "you are not BC" from "you may not touch that Member" from
  --    "you cannot re-rank yourself" (conventions section 3).
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end;
  if private.actor_level(v_actor) < 6 or v_actor = p_member_id then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  -- 3. Target under lock, then the actor's own row re-read `for share`.
  select * into v_member
    from public.profiles
   where id = p_member_id
   for update;
  if not found then
    raise sqlstate 'PT404' using message = 'member_not_found';
  end if;

  select actor.role into v_actor_role
    from public.profiles as actor
   where actor.id = v_actor
     and actor.status = 'activ'
   for share;
  if not found then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  v_from := v_member.role;

  -- 4. Appointing or unseating leadership is the Moderator's alone. BC holds
  --    every other rank decision. Authority is answered before state, so a BC
  --    reaching for `bc` gets 42501 whether or not the target already holds it.
  if (v_from in ('bc', 'moderator') or p_role in ('bc', 'moderator'))
     and v_actor_role <> 'moderator' then
    raise exception using errcode = '42501', message = 'member_manage_forbidden';
  end if;

  if v_from = p_role then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  select role.name, role.level into strict v_role_name, v_new_level
    from public.roles as role
   where role.id = p_role;

  update public.profiles
     set role = p_role
   where id = p_member_id
  returning * into v_member;

  insert into public.role_history (
    member_id, from_role, to_role, changed_by, actor_kind, reason
  ) values (
    p_member_id, v_from, p_role, v_actor, 'human',
    coalesce(nullif(regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
      'Role changed by leadership (set_member_role)')
  );

  -- 5. The one case where a Role change edits rosters. A Group states the rank
  --    its members must hold; once the target falls below it they are not a
  --    member of that Group any more, whatever position they held there, so
  --    the row goes -- ordinary membership and Group Role alike. Only Groups
  --    whose *own* Minimum Level is above the new rank are touched: an
  --    ancestor with a lower Minimum keeps its row, and the authority it
  --    carries still flows down through `groups.path`. This is what makes
  --    T13's invariant (#586, "no roster row below its Group's Minimum
  --    Level") hold from the Role side.
  --
  --    The rows are locked `for update` before anything is decided about
  --    them. `for update of membership` locks `group_members` only: a
  --    `groups` row is read here, never locked, because a share lock on one
  --    would ABBA against any Group command holding it `for update` (the
  --    cross-cutting lock rule). Ordering by `group_id` keeps two concurrent
  --    demotions of different Members over the same Groups in one sequence.
  perform 1
     from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where membership.member_id = p_member_id
      and grp.min_level > v_new_level
    order by membership.group_id
      for update of membership;

  with removed as (
    delete from public.group_members as membership
     using public.groups as grp
     where grp.id = membership.group_id
       and membership.member_id = p_member_id
       and grp.min_level > v_new_level
    returning grp.name as group_name
  )
  select array_agg(distinct group_name order by group_name)
    into v_groups_left
    from removed;

  -- #584 (ruling R30). The Application half of the same rule: a request to
  -- join a Group the target can no longer qualify for is settled here rather
  -- than left for a Manager to be told group_member_below_min_level about.
  -- The rows are locked in id order before anything is decided about them.
  perform 1
     from public.group_applications as application
     join public.groups as grp on grp.id = application.group_id
    where application.member_id = p_member_id
      and application.status = 'pending'
      and grp.min_level > v_new_level
    order by application.id
      for update of application;

  update public.group_applications as application
     set status     = 'withdrawn',
         decided_by = v_actor,
         decided_at = clock_timestamp()
    from public.groups as grp
   where grp.id = application.group_id
     and application.member_id = p_member_id
     and application.status = 'pending'
     and grp.min_level > v_new_level;

  -- #826 (ruling R28): Voluntar Activ is granted by hand now, so this is
  -- where AG Eligibility and the adherence form are offered. The address is
  -- read at write time (#681) and goes in the body: notifications.link is an
  -- in-app route.
  if p_role = 'activ' then
    select nullif(btrim(setting.value), '') into v_form_url
      from public.org_settings as setting
     where setting.key = 'adherence_form_url';
  end if;

  perform private.notify(
    array[p_member_id],
    'system'::public.noti_kind,
    'Rol actualizat',
    case
      when p_role = 'vot' then
        'Rolul tău în OSUBB este acum Voluntar cu Drept de Vot. Ești membru al Adunării Generale.'
      when p_role = 'activ' then
        'Rolul tău în OSUBB este acum ' || v_role_name || '. '
        || 'Ca Voluntar Activ ai Eligibilitate AG: poți intra în Adunarea Generală '
        || 'obținând Dreptul de Vot, pe care BC ți-l acordă după ce confirmă formularul de adeziune. '
        || case
             when v_form_url is not null then 'Completează formularul de adeziune: ' || v_form_url
             else 'Formularul de adeziune îl primești de la BC.'
           end
      else
        'Rolul tău în OSUBB este acum ' || v_role_name || '.'
    end
    -- A Member who lost Groups to the Minimum Level learns which ones from the
    -- same Notification: the removal is a consequence of the rank decision, not
    -- a separate event, and nothing else will tell them.
    || case
         when v_groups_left is null then ''
         else ' Nu mai faci parte din: '
              || array_to_string(v_groups_left, ', ') || '.'
       end,
    null,
    null,
    v_actor
  );

  return v_member;
end;
$function$;

comment on function private.set_member_role_impl(uuid, public.member_role, text) is
  'Body behind public.set_member_role (#580): authority, the audited rank change, and ruling R23''s Minimum-Level consequences. When the new rank falls below a Group''s min_level the target''s rows on that Group are deleted — ordinary membership and Group Role alike — and, since #584 (ruling R30), their pending Applications to every Group whose Minimum Level now exceeds their rank are withdrawn with the actor as decider: such an Application could only ever be answered group_member_below_min_level, and leaving it pending would keep the Group visible to them through ruling R17''s groups_read limb indefinitely. An ancestor Group with a lower Minimum Level keeps its row and its authority still flows down through groups.path. It leaves Group Roles alone everywhere else (ruling R15): a promotion to BCE does not appoint a Department Group Manager and a demotion from it does not remove one. p_reason (#612) is stored trimmed in role_history.reason, falling back to a fixed string when omitted or blank. Since #826 (ruling R28) promotion to Voluntar Activ is BC''s by hand: its Notification names AG Eligibility and the path to Drept de Vot and carries org_settings.adherence_form_url, read at write time; the role_history row closes the Member''s undecided Promotion Candidate (role_history_close_promotion_candidates).';
