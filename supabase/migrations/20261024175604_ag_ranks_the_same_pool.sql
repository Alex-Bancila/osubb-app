-- #1113: the Adunarea Generală Role Evaluation ranks the same pool as the Voluntar Activ one (R58 amendment, 2026-10-24)
--
-- Why (Alex, 2026-10-24). "The pool of volunteers should be the same as the
-- pool of volunteers for voluntari activi ... rank every member that is not
-- BCE or BC or Moderator and has more than the given threshold that makes you
-- eligible to be even considered. It would be wrong to rank 25% from the
-- members and expect to keep the volunteers with this role for long, we want
-- to be fair. Don't show any candidates for this role. It is only to see if
-- adunarea generala has members that are still implicated." The Prag minim is
-- indeed for both runs.
--
-- R58 section C ranked only the Voluntar cu Drept de Vot holders for the
-- Adunarea Generală kind, a misreading of the grill answer: the line was the
-- last voter inside the top y % of the voters alone, a share of a pool that
-- is not the one the organization keeps its volunteers in. Now both kinds
-- rank the same pool -- every live active Member below BCE (Recrut, Voluntar,
-- Voluntar Activ, Voluntar cu Drept de Vot), ranked when at or above the
-- Eligibility Floor -- and the Adunarea Generală line is the Task Points of
-- the last Member inside the top y % of that ranking. The run still judges
-- only the Voluntar cu Drept de Vot holders (a voter not inside the line is a
-- below_line Signal, one under the Floor a below_floor Signal), lists no
-- Promotion Candidate and has no Membership Cutoff Date; the live
-- not_ubb_student Signal is unchanged.
--
-- Only the population filter of private.role_evaluation_rows changes. The
-- function is restated from 20261018170000_portofoliu_interne.sql, its newest
-- definition, with its signature, return type and grants as they were. The
-- run's Signal loop already judges the voters alone (and, for the Voluntar
-- Activ kind, the Voluntar Activ holders), the run already locks all four
-- ranks' Profiles, and the Simulation and role_evaluation_ranking read the
-- core, so none of them changes a body. The three comments that described
-- the Adunarea Generală population are restated (comment only):
-- public.simulate_role_evaluation (20261020172908), and
-- private.run_role_evaluation_impl and public.run_role_evaluation
-- (20261020190031). The comments of private.simulate_role_evaluation_impl,
-- private.role_evaluation_ranking_impl and public.role_evaluation_ranking say
-- nothing about who is ranked and stay as they are.
--
-- Nothing else moves: no table, no setting, no grant, no stored run. A run
-- recorded before this migration keeps its figures; its ranking, recomputed
-- from its own values, now reads the whole pool.

create or replace function private.role_evaluation_rows(
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
  -- Both kinds rank the same pool (Alex, 2026-10-24): every live active
  -- Member below BCE. What differs between the kinds is what a run does with
  -- the rows, never who is in them.
  population as (
    select profile.id as member_id,
           profile.role as role,
           profile.joined_at as joined_at,
           coalesce(points.task_points, 0) as task_points,
           coalesce(points.task_points, 0) >= p_floor as ranked
      from public.profiles as profile
      left join points on points.member_id = profile.id
     where profile.status = 'activ'
       and profile.role in ('recrut', 'voluntar', 'activ', 'vot')
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
  'R58 (section C; replaces #826''s per-cohort core), amended 2026-10-24: the ranking of one Role Evaluation kind over the Evaluation Period [p_from, p_to] (inclusive Europe/Bucharest days), every row, with the values given -- the Simulation''s rows and the run''s. Live active Members only, the same pool for both kinds: every Recrut, Voluntar, Voluntar Activ and Voluntar cu Drept de Vot holder in one ranking, never a BCE, a BC or the Moderator; the kinds differ only in the cutoff (adunarea_generala has none, so nobody is listable in it) and in what a caller does with the rows. task_points is the net in-range total (0 when nothing in range touched them); ranked = task_points >= p_floor (the Eligibility Floor); only ranked rows get rank (rank() by Task Points, ties share it); evaluated_count counts every row and ranked_count the ranked; share_size = ceil(p_percent x ranked_count / 100); line = the Task Points of the share_size-th ranked row by (task_points desc, member_id), null when nobody was ranked; inside = ranked and task_points >= line (ties at the boundary are inside); listable = a Voluntar of the voluntar_activ kind whose joined_at is on or before p_cutoff. Rows ordered by task_points desc, member_id. PT400 invalid_role_evaluation_kind, invalid_date_range, invalid_eligibility_floor (null or below 1), invalid_percent (null or outside 1-100), membership_cutoff_not_set (voluntar_activ without p_cutoff; adunarea_generala ignores it). No visibility rule and no write; granted to nobody.';

revoke execute on function private.role_evaluation_rows(text, date, date, integer, integer, date)
  from public, anon, authenticated, service_role;

comment on function public.simulate_role_evaluation(text, date, date, integer, integer, date) is
  'R58 (Simulare): BC or the Moderator ranks one Role Evaluation kind over [p_from, p_to] (inclusive Bucharest days, ending today at the latest) with the Eligibility Floor p_floor, the share p_percent and, for voluntar_activ, the Membership Cutoff Date p_cutoff -- and writes nothing: no run, no Promotion Candidate, no Retention Signal, no Notification, no setting. One row per evaluated Member: role, task_points, ranked (at or above the Floor), rank, evaluated_count, ranked_count, share_size, the line, inside (at or above it) and listable (a Voluntar who joined on or before the cutoff). Both kinds rank the same pool, every live active Member below BCE (Recrut, Voluntar, Voluntar Activ, Voluntar cu Drept de Vot); adunarea_generala has no cutoff, so nobody is listable in it. The would-be Promotion Candidates are the rows listable and inside; the would-be Retention Signals are the holders (activ and vot for voluntar_activ, vot for adunarea_generala) not inside. public.run_role_evaluation with the same values records exactly these rows. 42501 role_evaluation_manage_forbidden; PT400 invalid_role_evaluation_kind, invalid_date_range, date_range_in_future, invalid_eligibility_floor, invalid_percent, membership_cutoff_not_set, invalid_membership_cutoff (a Voluntar Activ cutoff after today; adunarea_generala ignores p_cutoff).';

comment on function private.run_role_evaluation_impl(text, date, date, text, integer, integer, date) is
  '#826 (ruling R28), #983, rebuilt by R58 (section C): body of public.run_role_evaluation. Ranks the pool -- every live active Member below BCE, the same for both kinds (amended 2026-10-24) -- over [p_from, p_to] (Europe/Bucharest days, p_to not after today) with the Eligibility Floor, the share and (voluntar_activ) the Membership Cutoff Date given -- private.role_evaluation_rows, the Simulation''s rows -- and records the run with those values, the counts, the Promotion Threshold in force before (threshold_used, may be null) and the line computed (threshold_computed, null when nobody reached the Floor). Voluntar Activ kind: supersedes every undecided Promotion Candidate, then lists every listable Voluntar inside the line, measured against it. Supersedes the kind''s open below_line / below_floor Retention Signals, then stores one per holder not inside: below_line when ranked, with the line as threshold_used, below_floor when not, with the Eligibility Floor. One Notification per Candidate (to BC and the Moderator, linking /administrare/portofoliu-interne) and per Signal (to BC, the Moderator and the Adunarea Generală''s Group Responsibles at level 5 or above, linking /tracker/membru/<member>). Hands the line over when there is one and it differs; writes the share it used into evaluation_settings when it differs, logged with source role_evaluation naming the run -- the Floor and the cutoff it used are recorded on the run only and never written back, since Setări alone holds them; then calls private.refresh_promotion_candidates() (#983). PT400 invalid_role_evaluation_kind / invalid_role_evaluation_name / name_too_short / name_too_long / invalid_date_range / date_range_in_future / invalid_eligibility_floor / invalid_percent / membership_cutoff_not_set / invalid_membership_cutoff (a Voluntar Activ cutoff after today in Europe/Bucharest, the value set_membership_cutoff would refuse; the Adunarea Generală kind ignores p_cutoff) before the gate; 42501 role_evaluation_manage_forbidden below BC. Serialised on pg_advisory_xact_lock(47, 1), then the kind''s promotion_thresholds row, then the evaluation_settings row, then the population''s Profiles for key share.';

comment on function public.run_role_evaluation(text, date, date, text, integer, integer, date) is
  '#826 (ruling R28), rebuilt by R58 (Finalizează): BC or the Moderator records a Role Evaluation of one kind (voluntar_activ or adunarea_generala) over the Evaluation Period [p_from, p_to] (inclusive Bucharest days, ending today at the latest), named p_name (3..120 characters), with the Eligibility Floor p_floor (>= 1), the share p_percent (1-100) and, for voluntar_activ, the Membership Cutoff Date p_cutoff -- the values a Simulation showed. It ranks every eligible Member in one ranking -- the same pool for both kinds, every live active Member below BCE (amended 2026-10-24) --, stores the run with those values, the line it computed and the threshold in force before, lists the Promotion Candidates (voluntar_activ: Voluntars who joined on or before the cutoff and are inside the line -- never promoted) and stores the Retention Signals (the holders not inside the line, or below the Floor -- Voluntar Activ and Voluntar cu Drept de Vot holders for voluntar_activ, Voluntar cu Drept de Vot holders alone for adunarea_generala -- each with the figure it fell under), notifies BC and the Moderator of each Candidate and, with the Adunarea Generală''s Group Responsibles at level 5 or above, of each Signal, hands the line over as the kind''s Promotion Threshold, and makes the share it used the one in force (the change logged naming the run); the Floor and the cutoff it used are recorded on the run only, never written back -- Prag minim and Data limită de intrare are Setări''s alone. A run that ranked nobody records no line, hands nothing over, lists nobody and signals every holder below the Floor. No Role changes. 42501 role_evaluation_manage_forbidden; PT400 invalid_role_evaluation_kind, invalid_role_evaluation_name, name_too_short, name_too_long, invalid_date_range, date_range_in_future, invalid_eligibility_floor, invalid_percent, membership_cutoff_not_set, invalid_membership_cutoff (a Voluntar Activ cutoff after today; adunarea_generala ignores p_cutoff). Returns (role_evaluation_id, candidates, retention_signals).';
