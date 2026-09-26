-- #47: Evaluation Periods -- the table, its one-open / no-overlap invariants, and the Period-scoped Task-Point ranking.
--
-- ADR-0009 §Promotion hooks and ADR-0004 (amended 2026-09-21): BC opens and
-- closes named Evaluation Periods, and every promotion signal is measured
-- inside one -- the top x% at a close, the Promotion Threshold fixed at that
-- close (#49 stamps closing_threshold), the Retention Signals (#48, #51). The
-- 300-point ag_eligibility / ag_quorum_top25 views have no successor; this
-- migration does not bring them back under another name.
--
-- Boundary. Table, invariants and ranking only. The commands that open and
-- close a Period are #701 (open_evaluation_period / close_evaluation_period);
-- until they ship, only a migration or a rolled-back test fixture writes a
-- row. closing_threshold is a column here and a computation in #49. #512
-- narrows the ranking's full read to BC/Moderator and the Adunarea Generală's
-- Group Managers and Responsibles.
--
-- The Period is the half-open span [opened_at, closed_at): an open Period
-- (closed_at null) runs to infinity. Two constraints hold the shape:
--   * evaluation_periods_open_uidx -- a partial unique index, so at most one
--     row has closed_at null. It is created before the exclusion constraint,
--     so a second open Period is refused by it (23505) rather than by the
--     overlap rule, which would also catch it -- two open spans both run to
--     infinity -- and the test can tell the two apart.
--   * evaluation_periods_span_excl -- an exclusion constraint over
--     tstzrange(opened_at, closed_at, '[)') with &&, so no two Periods share
--     an instant, the open one included (its span has no upper bound, so no
--     Period may start after it opened). Adjacent Periods -- one closing at
--     the instant the next opens -- do not overlap. A range operand needs no
--     btree_gist.
-- closed_at >= opened_at, not >: #701's commands stamp now(), so a Period
-- opened and closed in one transaction is an empty span, which overlaps
-- nothing and ranks nobody.
--
-- The ranking. Task Points are the points_ledger rows with reason 'task' or
-- 'task_reversal' -- exactly what private.evaluate_task writes and reopen_task
-- offsets; a 'sanction' row is not a Task Point. A row counts toward a Period
-- when its Evaluation's instant, task_evaluations.evaluated_at through
-- points_ledger.evaluation_id, falls inside the span -- the award instant
-- #677's Work Filter reads, shared by a credit and its reversal, so a
-- reversed in-Period award nets to zero in that Period and never leaves a
-- phantom negative in a later one. The ledger row's own created_at is not
-- read. The rows are therefore exactly the Leadership Leaderboard's over the
-- Period's range (ADR-0009 speaks of "the Period's Leaderboard"): a Member
-- appears when an Evaluation inside the Period credited or debited them --
-- with their net total, zero included when an in-Period award was reversed --
-- and a Member with no such Evaluation does not appear. Inactive earners are
-- kept, as on the Leaderboard; eligibility is #49/#51's rule, not the
-- ranking's. Ties share a rank (rank(), not row_number()).
--
-- Three functions, because the readers differ:
--   * private.evaluation_period_ranking_rows(p_period_id) -- every row, no
--     visibility rule, granted to nobody. #49's close-time stamp, #48's
--     retention ranking and #51's detection call it from security-definer
--     bodies (#52's daily job has no caller at all), so it must not filter on
--     auth.uid().
--   * private.evaluation_period_ranking_impl(p_period_id) -- the same rows,
--     filtered for the caller: nothing without organization claims or a live
--     activ Profile (house rule 12); the caller's own row -- with its rank
--     among everyone -- for any active Member; every row for level >= 5
--     (BCE, BC, Moderator), by claims and by live level, as the Leaderboard
--     gates. #512 replaces that last branch with its leadership predicate.
--   * public.evaluation_period_ranking(p_period_id) -- the invoker wrapper
--     PostgREST publishes.
-- An unknown Period id ranks nobody; the table itself is readable by every
-- Member, so there is nothing to hide and nothing to report.

-- ---------------------------------------------------------------------------
-- The table.
-- ---------------------------------------------------------------------------
create table public.evaluation_periods (
  id                bigint generated always as identity primary key,
  name              text not null,
  opened_at         timestamptz not null default now(),
  opened_by         uuid not null references public.profiles (id),
  closed_at         timestamptz,
  closed_by         uuid references public.profiles (id),
  closing_threshold integer,
  created_at        timestamptz not null default now(),
  -- R8's title limit, measured as #701 stores the name: trimmed.
  constraint evaluation_periods_name_length_ck
    check (char_length(name) between 3 and 120),
  constraint evaluation_periods_name_trimmed_ck
    check (name !~ '^[[:space:]]|[[:space:]]$'),
  -- Closing stamps the instant and the actor together.
  constraint evaluation_periods_close_shape_ck
    check ((closed_at is null) = (closed_by is null)),
  constraint evaluation_periods_chronology_ck
    check (closed_at is null or closed_at >= opened_at),
  -- The Promotion Threshold is fixed at the close (#49), never before it.
  constraint evaluation_periods_threshold_ck
    check (closing_threshold is null or closed_at is not null)
);

-- Before the exclusion constraint on purpose -- see the header.
create unique index evaluation_periods_open_uidx
  on public.evaluation_periods ((closed_at is null))
  where closed_at is null;

alter table public.evaluation_periods
  add constraint evaluation_periods_span_excl
  exclude using gist (tstzrange(opened_at, closed_at, '[)') with &&);

alter table public.evaluation_periods enable row level security;

comment on table public.evaluation_periods is
  '#47 (ADR-0009 §Promotion hooks, ADR-0004 amended 2026-09-21): a named Evaluation Period BC opens and closes, the span [opened_at, closed_at) inside which Task Points are ranked for the Promotion Rules and the Retention Signals. At most one Period is open (evaluation_periods_open_uidx) and no two share an instant (evaluation_periods_span_excl). Every live active Member reads every row; no client writes one -- #701''s open_evaluation_period / close_evaluation_period are the write path. Ranking: public.evaluation_period_ranking(p_period_id).';
comment on column public.evaluation_periods.opened_by is
  '#47: the Member (BC or Moderator, #701) who opened the Period.';
comment on column public.evaluation_periods.closed_at is
  '#47: the closing instant, exclusive -- an Evaluation at exactly this instant belongs to no earlier Period. Null while the Period is open; set together with closed_by.';
comment on column public.evaluation_periods.closed_by is
  '#47: the Member (BC or Moderator, #701) who closed the Period. Null while open.';
comment on column public.evaluation_periods.closing_threshold is
  '#47: the Promotion Threshold fixed at this Period''s close -- the Task Points of the last Member inside the top x% of its ranking (ADR-0004 amended 2026-09-21). Null while the Period is open and until #49''s private.stamp_closing_threshold writes it in the close transaction (#701); no client writes it.';

-- New public tables inherit select/insert/update/delete for authenticated
-- (20260819171628's default privileges); take everything back, then grant the
-- read alone. There is no write policy behind it either.
revoke all on table public.evaluation_periods from public, anon, authenticated;
grant select on table public.evaluation_periods to authenticated, service_role;
revoke all on sequence public.evaluation_periods_id_seq from public, anon, authenticated;

create policy evaluation_periods_read on public.evaluation_periods
  for select to authenticated
  using ((select public.auth_is_member()) and (select private.caller_level()) >= 0);

comment on policy evaluation_periods_read on public.evaluation_periods is
  '#47: every live active Member reads every Period -- organization claims (house rule 12) plus a live activ Profile, so a deactivated Member''s still-valid token reads nothing. No write policy: #701''s commands are the only write path.';

-- ---------------------------------------------------------------------------
-- The ranking core: every row, no visibility rule.
-- ---------------------------------------------------------------------------
create function private.evaluation_period_ranking_rows(p_period_id bigint)
returns table (member_id uuid, task_points integer, rank integer)
language sql
stable
set search_path = ''
as $$
  with period as (
    select span.opened_at, span.closed_at
      from public.evaluation_periods as span
     where span.id = p_period_id
  ),
  totals as (
    select entry.member_id as member_id,
           sum(entry.delta)::int as task_points
      from period
      join public.task_evaluations as evaluation
        on evaluation.evaluated_at >= period.opened_at
       and (period.closed_at is null or evaluation.evaluated_at < period.closed_at)
      join public.points_ledger as entry on entry.evaluation_id = evaluation.id
     where entry.reason in ('task', 'task_reversal')
     group by entry.member_id
  )
  select totals.member_id,
         totals.task_points,
         (rank() over (order by totals.task_points desc))::int
    from totals
   order by totals.task_points desc, totals.member_id;
$$;

comment on function private.evaluation_period_ranking_rows(bigint) is
  '#47: every Member''s net Task Points inside one Evaluation Period, ranked -- points_ledger rows of reason task/task_reversal whose Evaluation (task_evaluations.evaluated_at via points_ledger.evaluation_id) falls in [opened_at, closed_at), an open Period running to infinity. The same rows as the Leadership Leaderboard over that range: a Member credited or debited by an in-Period Evaluation appears with the net total (zero after a reversal), anyone else does not; inactive earners are kept; ties share a rank. No visibility rule and granted to nobody: the core #49''s close-time stamp, #48''s retention ranking and #51''s detection read from security-definer bodies. A later reversal of an in-Period Evaluation changes a closed Period''s rows; what a close decides is stamped at the close. An unknown id ranks nobody.';

revoke execute on function private.evaluation_period_ranking_rows(bigint)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The ranking the caller may read.
-- ---------------------------------------------------------------------------
create function private.evaluation_period_ranking_impl(p_period_id bigint)
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
          or ((select public.auth_level()) >= 5
              and (select private.caller_level()) >= 5))
   order by ranked.task_points desc, ranked.member_id;
$$;

comment on function private.evaluation_period_ranking_impl(bigint) is
  '#47: body of public.evaluation_period_ranking. private.evaluation_period_ranking_rows filtered for the caller: nothing without organization claims or a live activ Profile (house rule 12, ADR-0003''s stale-token window); the caller''s own row, carrying their rank among every Member, for any active Member; every row for level >= 5 (BCE, BC, Moderator) by claims and by live level, as the Leadership Leaderboard gates. #512 replaces the level >= 5 branch with its leadership predicate (BC/Moderator and the Adunarea Generală''s Group Managers and Group Responsibles); the own-row branch stays.';

create function public.evaluation_period_ranking(p_period_id bigint)
returns table (member_id uuid, task_points integer, rank integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
    from private.evaluation_period_ranking_impl(p_period_id)
   order by task_points desc, member_id;
$$;

comment on function public.evaluation_period_ranking(bigint) is
  '#47: the Task-Point ranking of one Evaluation Period -- member_id, task_points (net, from Evaluations whose instant falls in [opened_at, closed_at)), rank (shared on ties, counted among every Member). A Member reads their own row; BCE and above read every row until #512 narrows the full read to BC/Moderator and the Adunarea Generală''s Group Managers and Group Responsibles; a claimless or deactivated session reads nothing. The open Period is the evaluation_periods row with closed_at null.';

revoke execute on function private.evaluation_period_ranking_impl(bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.evaluation_period_ranking(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.evaluation_period_ranking_impl(bigint) to authenticated;
grant execute on function public.evaluation_period_ranking(bigint) to authenticated;
