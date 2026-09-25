-- #49: promotion_rules -- the two automatic Promotion Rules, the close-time Promotion Threshold stamp, and the threshold in force.
--
-- ADR-0004 (thresholds are BC-configurable data, never code; amended
-- 2026-09-21: two doors behind one tenure gate) and ADR-0009 §Promotion hooks.
-- One row per automatic promotion. Two kinds:
--   * time        -- tenure alone, measured from profiles.joined_at (#160):
--                    Recrut -> Voluntar.
--   * top_percent -- the top `percent` of an Evaluation Period's ranking (#47)
--                    AND at least min_tenure_months of tenure, with the
--                    BC-seeded initial_threshold standing in for the Promotion
--                    Threshold until the first Period closes: Voluntar ->
--                    Voluntar Activ (identifier `activ`; roles.name has read
--                    Voluntar Activ since #507).
-- Voluntar Activ -> Voluntar cu Drept de Vot is deliberately not a row: AG
-- Eligibility follows from the Voluntar Activ Role alone and BC confirms Drept
-- de Vot by hand (ADR-0004 amended 2026-09-21).
--
-- Seeds (ruling R20, placeholders BC ratifies): Recrut -> Voluntar after 6
-- months; Voluntar -> Voluntar Activ at the top 30 % with 6 months of tenure,
-- initial threshold 30. Reference data lives here, never in seed.sql (house
-- rule 6).
--
-- Boundary. The table, its kinds, the seeds, the stamp and the in-force read.
-- No client write path: #702's set_promotion_rule(p_rule_id,
-- p_initial_threshold) is the one editor it will get, writing
-- initial_threshold only. Detection is #51, application #52, the close
-- command that calls the stamp #701.
--
-- The Promotion Threshold (ADR-0004 amended 2026-09-21): "the Task Points
-- held by the last Member inside the top x%" of the closing Period's ranking.
-- Precisely, over private.evaluation_period_ranking_rows(p_period_id) -- every
-- Member an in-Period Evaluation credited or debited, inactive earners kept,
-- ordered by Task Points descending:
--   share     = ceil(percent / 100 x ranked Members)  -- 30 % of 7 is 3, not 2
--   threshold = the Task Points of the share-th Member in that order.
-- Ties at the boundary. The issue fixes no tie rule, so the one that follows
-- from the definition applies: Members tied with the share-th Member hold the
-- same Task Points, so the stamped number does not depend on which of them
-- counts as "last", and every one of them reaches it. Read "inside the top
-- x%" as task_points >= closing_threshold and all Members tied at the
-- boundary are inside -- the share can hold more than ceil(...) Members,
-- never fewer. A Period that ranked nobody has no boundary Member: the stamp
-- leaves closing_threshold null and the threshold in force carries over.
--
-- The threshold in force is the closing_threshold of the most recently closed
-- (by closed_at) Period that carries one; with none, the top_percent rule's
-- initial_threshold. A closed Period without a stamp -- nobody ranked, or a
-- close before #701 wires the stamp in -- is skipped rather than read as "no
-- threshold".

-- ---------------------------------------------------------------------------
-- The table.
-- ---------------------------------------------------------------------------
create table public.promotion_rules (
  id                bigint generated always as identity primary key,
  from_role         public.member_role not null references public.roles (id),
  to_role           public.member_role not null references public.roles (id),
  kind              text not null,
  min_tenure_months integer not null,
  percent           integer,
  initial_threshold integer,
  enabled           boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint promotion_rules_kind_ck
    check (kind in ('time', 'top_percent')),
  constraint promotion_rules_roles_ck
    check (from_role <> to_role),
  constraint promotion_rules_tenure_range_ck
    check (min_tenure_months between 0 and 120),
  constraint promotion_rules_percent_range_ck
    check (percent is null or percent between 1 and 100),
  constraint promotion_rules_initial_threshold_range_ck
    check (initial_threshold is null or initial_threshold >= 1),
  -- One shape per kind. Written as implications so an unknown kind fails
  -- promotion_rules_kind_ck alone.
  constraint promotion_rules_time_shape_ck
    check (kind <> 'time' or (percent is null and initial_threshold is null)),
  constraint promotion_rules_top_percent_shape_ck
    check (kind <> 'top_percent' or (percent is not null and initial_threshold is not null)),
  constraint promotion_rules_from_role_to_role_key unique (from_role, to_role),
  constraint promotion_rules_updated_at_ck check (updated_at >= created_at)
);

-- "The top_percent row": the stamp and the in-force read each need exactly one.
create unique index promotion_rules_top_percent_uidx
  on public.promotion_rules (kind)
  where kind = 'top_percent';

alter table public.promotion_rules enable row level security;

create trigger promotion_rules_set_updated_at
before update on public.promotion_rules
for each row execute function private.set_updated_at();

comment on table public.promotion_rules is
  '#49 (ADR-0004, ADR-0009 §Promotion hooks): one row per automatic promotion. kind time: tenure alone, min_tenure_months from profiles.joined_at (Recrut -> Voluntar). kind top_percent: the top `percent` of the Evaluation Period''s ranking at its close, or the Promotion Threshold during the following Period, behind min_tenure_months of tenure (Voluntar -> Voluntar Activ); initial_threshold is the BC-seeded Promotion Threshold used until the first close. At most one top_percent row (promotion_rules_top_percent_uidx). Every live active Member reads every row -- gamification needs visible goals; no client writes one (#702''s set_promotion_rule will write initial_threshold only). Detection #51, application #52.';
comment on column public.promotion_rules.kind is
  '#49: time (tenure alone) or top_percent (a share of the Evaluation Period ranking plus tenure). promotion_rules_kind_ck rejects anything else.';
comment on column public.promotion_rules.min_tenure_months is
  '#49: the required tenure in whole months, measured from profiles.joined_at (#160). For top_percent it is the tenure gate in front of both doors (ADR-0004 amended 2026-09-21).';
comment on column public.promotion_rules.percent is
  '#49: top_percent only -- the share of the closing Period''s ranking inside which a Voluntar with the tenure is promoted, and whose last Member''s Task Points become the Promotion Threshold. Null for time.';
comment on column public.promotion_rules.initial_threshold is
  '#49: top_percent only -- the Promotion Threshold BC seeds by hand, in force until the first Evaluation Period close stamps one (public.promotion_threshold_in_force). Null for time.';
comment on column public.promotion_rules.enabled is
  '#49: whether #51 detects and #52 applies this rule. The close-time stamp is taken regardless, so re-enabling finds a threshold in force.';

-- New public tables inherit select/insert/update/delete for authenticated
-- (20260819171628's default privileges); take everything back, then grant the
-- read alone. There is no write policy behind it either.
revoke all on table public.promotion_rules from public, anon, authenticated;
grant select on table public.promotion_rules to authenticated, service_role;
revoke all on sequence public.promotion_rules_id_seq from public, anon, authenticated;

create policy promotion_rules_read on public.promotion_rules
  for select to authenticated
  using ((select public.auth_is_member()) and (select private.caller_level()) >= 0);

comment on policy promotion_rules_read on public.promotion_rules is
  '#49: every live active Member reads every Promotion Rule -- organization claims (house rule 12) plus a live activ Profile, so a deactivated Member''s still-valid token reads nothing. No write policy: no client writes a rule.';

-- ---------------------------------------------------------------------------
-- The seeds (ruling R20 -- placeholders BC ratifies).
-- ---------------------------------------------------------------------------
insert into public.promotion_rules (from_role, to_role, kind, min_tenure_months, percent, initial_threshold)
values ('recrut',   'voluntar', 'time',        6, null, null),
       ('voluntar', 'activ',    'top_percent', 6, 30,   30);

-- ---------------------------------------------------------------------------
-- The close-time stamp.
-- ---------------------------------------------------------------------------
create function private.stamp_closing_threshold(p_period_id bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period    public.evaluation_periods%rowtype;
  v_percent   integer;
  v_ranked    integer;
  v_threshold integer;
begin
  -- The close command (#701) already holds this row; taking it again in the
  -- same transaction is free, and a stray second caller serializes here.
  select * into v_period
    from public.evaluation_periods as period
   where period.id = p_period_id
   for update;
  if not found then
    raise sqlstate 'PT404' using message = 'evaluation_period_not_found';
  end if;
  if v_period.closed_at is null then
    raise sqlstate 'PT409' using message = 'evaluation_period_open';
  end if;
  -- Fixed at the close, never recomputed: a later reversal of an in-Period
  -- Evaluation changes the ranking, not the threshold it produced.
  if v_period.closing_threshold is not null then
    raise sqlstate 'PT409' using message = 'closing_threshold_stamped';
  end if;

  select rule.percent into v_percent
    from public.promotion_rules as rule
   where rule.kind = 'top_percent'
   for share;
  if not found then
    raise sqlstate 'PT404' using message = 'promotion_rule_not_found';
  end if;

  select count(*)::int into v_ranked
    from private.evaluation_period_ranking_rows(p_period_id);
  if v_ranked = 0 then
    return null;
  end if;

  -- The share-th Member by Task Points; ties at the boundary share its value.
  select ranked.task_points into v_threshold
    from private.evaluation_period_ranking_rows(p_period_id) as ranked
   order by ranked.task_points desc, ranked.member_id
  offset ceil(v_percent * v_ranked / 100.0)::int - 1
   limit 1;

  update public.evaluation_periods
     set closing_threshold = v_threshold
   where id = p_period_id;

  return v_threshold;
end;
$$;

comment on function private.stamp_closing_threshold(bigint) is
  '#49: stamps a closed Evaluation Period''s Promotion Threshold (ADR-0004 amended 2026-09-21) and returns it. Over private.evaluation_period_ranking_rows ordered by Task Points descending, share = ceil(percent / 100 x ranked Members) with the top_percent Promotion Rule''s percent, and closing_threshold = the Task Points of the share-th Member. Members tied with that Member hold the same Task Points, so the number does not depend on which of them is "last" and every one of them reaches it: inside the top x% reads task_points >= closing_threshold, ties at the boundary included. A Period that ranked nobody is left null (the threshold in force carries over) and null is returned. The rule''s enabled flag is not read -- the stamp is a fact of the close. PT404 evaluation_period_not_found, PT409 evaluation_period_open (not yet closed), PT409 closing_threshold_stamped (a close is stamped once and never recomputed), PT404 promotion_rule_not_found (no top_percent row). Granted to nobody: #701''s close_evaluation_period calls it from its security-definer body in the close transaction, which already holds the Period row.';

revoke execute on function private.stamp_closing_threshold(bigint)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The threshold in force.
-- ---------------------------------------------------------------------------
create function public.promotion_threshold_in_force()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select period.closing_threshold
       from public.evaluation_periods as period
      where period.closed_at is not null
        and period.closing_threshold is not null
      order by period.closed_at desc, period.id desc
      limit 1),
    (select rule.initial_threshold
       from public.promotion_rules as rule
      where rule.kind = 'top_percent'));
$$;

comment on function public.promotion_threshold_in_force() is
  '#49: the Promotion Threshold in force -- the closing_threshold of the most recently closed (by closed_at) Evaluation Period that carries one, else the top_percent Promotion Rule''s initial_threshold (BC''s seed, before the first close). A Voluntar with the required tenure whose Task Points inside the current Period reach it becomes Voluntar Activ (#51/#52). Security invoker over two tables every live active Member reads, so a claimless or deactivated session gets null.';

revoke execute on function public.promotion_threshold_in_force()
  from public, anon, authenticated, service_role;
grant execute on function public.promotion_threshold_in_force() to authenticated;
