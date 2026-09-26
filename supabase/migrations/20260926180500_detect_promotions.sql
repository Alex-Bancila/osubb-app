-- #51: promotion detection -- detect_promotions(), detect_close_promotions(p_period_id) and detect_retention_signals(p_period_id), pure reads.
--
-- ADR-0004 (amended 2026-09-21) and ADR-0009 §Promotion hooks. Voluntar ->
-- Voluntar Activ has two doors behind one tenure gate: during the open
-- Evaluation Period, reaching the Promotion Threshold in force (#49); at a
-- close, being inside the closing Period's top x% (#47, #49). Recrut ->
-- Voluntar is tenure alone. The close also yields Retention Signals (#48):
-- a Voluntar Activ below the top x% and a Voluntar cu Drept de Vot below the
-- top y%, which BC reads before withdrawing a Role by hand. There is no Drept
-- de Vot eligibility signal: AG Eligibility follows from Voluntar Activ alone.
--
-- Boundary. Detection only: nothing here writes a Role, a role_history row
-- or a notification. #52's daily job and #701's close_evaluation_period call
-- these from their own security-definer bodies and apply the rows; the
-- percentages, tenures and thresholds stay in #49's promotion_rules, #49's
-- stamp / threshold in force and #48's vote_retention_percent.
--
-- The rules are read as data, never as Role names in code: a `time` row
-- promotes its from_role to its to_role on tenure alone, the `top_percent`
-- row promotes its from_role to its to_role through either door. A disabled
-- rule (enabled = false) never fires. Only live active Members (profiles
-- status 'activ') are detected; a Member whose Role is not a rule's from_role
-- is not a candidate for it.
--
-- Tenure. A Member holds a rule's tenure on and after joined_at +
-- min_tenure_months (PostgreSQL date + months arithmetic: 31 August + 6
-- months is 28/29 February, as #634's progress line reads it); an unknown
-- joined_at (null, #160) holds no tenure. joined_at is a calendar date, so it
-- is compared with a calendar date in Europe/Bucharest: today's for the
-- continuous run, the Period's closing instant's for the close -- so a close
-- read again later still measures tenure at the close.
--
-- detect_promotions(): the continuous rules. Every enabled `time` rule's
-- tenured holders; and, while a Period is open, every tenured holder of the
-- `top_percent` rule's from_role whose Task Points in the open Period
-- (#47's ranking) reach public.promotion_threshold_in_force(). A Member the
-- open Period's ranking does not list has earned nothing there and reaches
-- no threshold. With no open Period the threshold door is shut and only the
-- tenure rule fires. The two rules are not chained in one run: the threshold
-- door stays open all Period, so a Recrut the job promotes today is judged
-- as a Voluntar on the next run.
--
-- detect_close_promotions(p_period_id): the close. The tenure rule runs first
-- -- measured at the close -- and the top_percent rule then reads each
-- Member's Role as that step leaves it, so a Recrut reaching the tenure at
-- the close who is inside the top x% is returned twice, recrut -> voluntar
-- and then voluntar -> activ (ADR-0004's single run at the close; the top x%
-- is gone the moment the Period is closed). Inside the top x% is #49's rule
-- over the Period's full ranking (every Member an in-Period Evaluation
-- touched, inactive earners included): share = ceil(percent / 100 x ranked
-- Members), inside = rank <= share, so Members tied at the boundary are
-- inside together. The threshold in force is not consulted: the door at a
-- close is the ranking, not the number. PT404 evaluation_period_not_found,
-- PT409 evaluation_period_open -- #49's reasons.
--
-- detect_retention_signals(p_period_id): #48's retention ranking, the rows
-- outside their Role's share, with the Role at risk and which share it is
-- measured against (`top_percent` -- x, the Promotion Rule's percent -- for
-- activ; `vote_retention_percent` -- y -- for vot). Not a promotion rule, so
-- the top_percent rule's enabled flag does not silence it; #48's errors
-- propagate unchanged.
--
-- All three are `stable` and `security definer` with an empty search_path,
-- and executable by nobody: their callers run as the owner.

-- ---------------------------------------------------------------------------
-- The continuous rules.
-- ---------------------------------------------------------------------------
create function private.detect_promotions()
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
  ),
  tenured as (
    select profile.id as member_id,
           rule.from_role,
           rule.to_role,
           rule.id as rule_id,
           rule.kind as rule_kind
      from public.promotion_rules as rule
      join public.profiles as profile
        on profile.role = rule.from_role
       and profile.status = 'activ'
     cross join today
     where rule.enabled
       and profile.joined_at is not null
       and (profile.joined_at + make_interval(months => rule.min_tenure_months))::date <= today.on_date
  ),
  detected as (
    select tenured.member_id, tenured.from_role, tenured.to_role, tenured.rule_id, tenured.rule_kind
      from tenured
     where tenured.rule_kind = 'time'
    union all
    select tenured.member_id, tenured.from_role, tenured.to_role, tenured.rule_id, tenured.rule_kind
      from tenured
      join public.evaluation_periods as period
        on period.closed_at is null
     cross join lateral private.evaluation_period_ranking_rows(period.id) as ranked
     where tenured.rule_kind = 'top_percent'
       and ranked.member_id = tenured.member_id
       and ranked.task_points >= public.promotion_threshold_in_force()
  )
  select detected.member_id, detected.from_role, detected.to_role, detected.rule_id, detected.rule_kind
    from detected
   order by detected.rule_kind <> 'time', detected.member_id;
$$;

comment on function private.detect_promotions() is
  '#51 (ADR-0004 amended 2026-09-21): the continuous Promotion Rules, as rows (member_id, from_role, to_role, rule_id, rule_kind) -- nothing is written. For every enabled promotion_rules row, only live active Members (status activ) holding its from_role with its tenure: joined_at + min_tenure_months on or before today''s Europe/Bucharest date (null joined_at: no tenure). kind time: every such Member (Recrut -> Voluntar). kind top_percent: every such Member whose net Task Points in the open Evaluation Period (#47''s ranking; a Member it does not list has none) reach public.promotion_threshold_in_force() (Voluntar -> Voluntar Activ); with no open Period this door returns nothing and the time rule still fires. The two are not chained in one run. Ordered time rows first, then by member_id. Stable, executable by nobody: #52''s daily job calls it from its security-definer body and applies the rows.';

revoke execute on function private.detect_promotions()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The close.
-- ---------------------------------------------------------------------------
create function private.detect_close_promotions(p_period_id bigint)
returns table (
  member_id uuid,
  from_role public.member_role,
  to_role   public.member_role,
  rule_id   bigint,
  rule_kind text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_closed_at timestamptz;
  v_on_date   date;
begin
  select period.closed_at into v_closed_at
    from public.evaluation_periods as period
   where period.id = p_period_id;
  if not found then
    raise sqlstate 'PT404' using message = 'evaluation_period_not_found';
  end if;
  if v_closed_at is null then
    raise sqlstate 'PT409' using message = 'evaluation_period_open';
  end if;
  -- Tenure is measured at the close, on the Bucharest calendar.
  v_on_date := (v_closed_at at time zone 'Europe/Bucharest')::date;

  return query
  with ranking as (
    select ranked.member_id,
           ranked.rank,
           (count(*) over ())::int as ranked_count
      from private.evaluation_period_ranking_rows(p_period_id) as ranked
  ),
  -- Step 1: the tenure rule, at the close.
  time_step as (
    select profile.id as member_id,
           rule.from_role,
           rule.to_role,
           rule.id as rule_id,
           rule.kind as rule_kind
      from public.promotion_rules as rule
      join public.profiles as profile
        on profile.role = rule.from_role
       and profile.status = 'activ'
     where rule.kind = 'time'
       and rule.enabled
       and profile.joined_at is not null
       and (profile.joined_at + make_interval(months => rule.min_tenure_months))::date <= v_on_date
  ),
  -- Each live active Member's Role as step 1 leaves it.
  stepped as (
    select profile.id as member_id,
           coalesce(promoted.to_role, profile.role) as role,
           profile.joined_at
      from public.profiles as profile
      left join time_step as promoted
        on promoted.member_id = profile.id
     where profile.status = 'activ'
  ),
  -- Step 2: the top x% of the closing Period, behind the same tenure gate.
  top_step as (
    select stepped.member_id,
           rule.from_role,
           rule.to_role,
           rule.id as rule_id,
           rule.kind as rule_kind
      from public.promotion_rules as rule
      join stepped
        on stepped.role = rule.from_role
      join ranking
        on ranking.member_id = stepped.member_id
     where rule.kind = 'top_percent'
       and rule.enabled
       and stepped.joined_at is not null
       and (stepped.joined_at + make_interval(months => rule.min_tenure_months))::date <= v_on_date
       and ranking.rank <= ceil(rule.percent * ranking.ranked_count / 100.0)
  ),
  detected as (
    select 1 as step, time_step.member_id, time_step.from_role, time_step.to_role,
           time_step.rule_id, time_step.rule_kind
      from time_step
    union all
    select 2 as step, top_step.member_id, top_step.from_role, top_step.to_role,
           top_step.rule_id, top_step.rule_kind
      from top_step
  )
  select detected.member_id, detected.from_role, detected.to_role, detected.rule_id, detected.rule_kind
    from detected
   order by detected.step, detected.member_id;
end;
$$;

comment on function private.detect_close_promotions(bigint) is
  '#51 (ADR-0004 amended 2026-09-21): the Promotion Rules at the close of one Evaluation Period, as rows (member_id, from_role, to_role, rule_id, rule_kind) -- nothing is written. Tenure is measured at the Period''s closed_at, on its Europe/Bucharest date: joined_at + min_tenure_months on or before it (null joined_at: no tenure). Only enabled rules and live active Members (status activ). Step 1, kind time: every tenured holder of its from_role (Recrut -> Voluntar). Step 2, kind top_percent: every tenured Member whose Role after step 1 is its from_role and who is inside the Period''s top percent -- over #47''s full ranking, share = ceil(percent / 100 x ranked Members), inside = rank <= share, ties at the boundary inside (#49''s rule) -- so a Recrut reaching the tenure at the close and inside the top x% is returned for both steps. The Promotion Threshold in force is not consulted. Ordered step 1 then step 2, each by member_id -- the order #701''s close applies them in. PT404 evaluation_period_not_found, PT409 evaluation_period_open. Stable, executable by nobody: #701''s close_evaluation_period calls it from its security-definer body.';

revoke execute on function private.detect_close_promotions(bigint)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The Retention Signals.
-- ---------------------------------------------------------------------------
create function private.detect_retention_signals(p_period_id bigint)
returns table (
  member_id   uuid,
  role        public.member_role,
  task_points integer,
  rank        integer,
  share_size  integer,
  rule        text
)
language sql
stable
security definer
set search_path = ''
as $$
  select ranked.member_id,
         ranked.role,
         ranked.task_points,
         ranked.rank,
         ranked.share_size,
         case ranked.role
           when 'activ' then 'top_percent'
           else 'vote_retention_percent'
         end
    from private.retention_ranking_rows(p_period_id) as ranked
   where not ranked.inside
   order by ranked.role, ranked.rank, ranked.member_id;
$$;

comment on function private.detect_retention_signals(bigint) is
  '#51 (ADR-0004 amended 2026-09-21): the Retention Signals of one closed Evaluation Period, as rows (member_id, role, task_points, rank, share_size, rule) -- nothing is written and no Role changes. Every row of #48''s private.retention_ranking_rows outside its share: a live active Voluntar Activ (role activ) below the top x% -- rule top_percent, the Promotion Rule''s percent -- and a live active Voluntar cu Drept de Vot (role vot) below the top y% -- rule vote_retention_percent. role is the Role at risk; task_points, rank (within the Role''s cohort) and share_size are #48''s. Not a promotion rule, so the top_percent rule''s enabled flag does not silence it. There is no Drept de Vot eligibility row. Ordered by role, rank, member_id. PT404 evaluation_period_not_found, PT409 evaluation_period_open, PT404 promotion_rule_not_found, PT404 org_setting_not_found (#48''s). Stable, executable by nobody: #701''s close and #52 read it from security-definer bodies; BC acts on it by hand.';

revoke execute on function private.detect_retention_signals(bigint)
  from public, anon, authenticated, service_role;
