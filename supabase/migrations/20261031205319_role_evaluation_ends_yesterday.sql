-- #1131: a Role Evaluation run or Simulation covers complete days only -- its Evaluation Period ends yesterday at the latest.
--
-- Finding M10 of the codebase audit of 2026-10-30
-- (docs/review/2026-10-30-codebase-audit.md). run_role_evaluation and
-- simulate_role_evaluation refused only p_to after today, and the form
-- defaulted "Până la" to today. The live Candidate window and Profil's
-- standing open at period_to + 1, and the next contiguous run starts there
-- too, so a Task evaluated later on the day of a run ending today counted in
-- no run and no live window -- while role_evaluation_ranking(id), recomputed
-- over the same range, showed it, and the run's sheet drifted from the
-- Candidates and Signals it recorded. supabase/tests/role_evaluation_command
-- .test.sql and role_evaluation_simulation.test.sql, "ending today", failed
-- before this file.
--
-- Both bodies are rebuilt from main's latest (simulate_role_evaluation_impl
-- from 20261020172908_retention_signal_floor.sql, run_role_evaluation_impl
-- from 20261020190031_run_writes_only_the_share.sql) with one comparison each:
-- p_to >= today (Europe/Bucharest) is PT400 date_range_in_future, the reason
-- the form already places under "Până la". The heavier alternative -- a live
-- window from greatest(period_to + 1, run_at) and a recorded cut-off instant
-- -- is not built: the recompute would still differ. The comments of the four
-- functions say "yesterday at the latest"; grants persist through create or
-- replace.

-- ==================== 1. simulate_role_evaluation_impl ====================
create or replace function private.simulate_role_evaluation_impl(
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
  -- #1131 (audit M10): complete days only -- today's later awards would fall
  -- between this range and the live window that opens at p_to + 1.
  if p_to >= (now() at time zone 'Europe/Bucharest')::date then
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
  -- A cutoff is a day that has begun (set_membership_cutoff's rule). The
  -- Adunarea Generală kind ignores the cutoff, so it is not judged for it.
  if p_kind = 'voluntar_activ' and p_cutoff > (now() at time zone 'Europe/Bucharest')::date then
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
  'R58: body of public.simulate_role_evaluation. PT400 invalid_role_evaluation_kind / invalid_date_range / date_range_in_future (p_to today or after, in Europe/Bucharest -- #1131: a run covers complete days, so yesterday is the latest end) / invalid_eligibility_floor / invalid_percent / membership_cutoff_not_set / invalid_membership_cutoff (a Voluntar Activ cutoff after today; the Adunarea Generală kind ignores p_cutoff, so neither cutoff reason applies to it) before the gate; private.require_active_member() and live level >= 6, every refusal 42501 role_evaluation_manage_forbidden; then every row of private.role_evaluation_rows with the given values. Stable: it takes no lock and writes nothing.';

comment on function public.simulate_role_evaluation(text, date, date, integer, integer, date) is
  'R58 (Simulare): BC or the Moderator ranks one Role Evaluation kind over [p_from, p_to] (inclusive Bucharest days, ending yesterday at the latest -- #1131: today is not a complete day) with the Eligibility Floor p_floor, the share p_percent and, for voluntar_activ, the Membership Cutoff Date p_cutoff -- and writes nothing: no run, no Promotion Candidate, no Retention Signal, no Notification, no setting. One row per evaluated Member: role, task_points, ranked (at or above the Floor), rank, evaluated_count, ranked_count, share_size, the line, inside (at or above it) and listable (a Voluntar who joined on or before the cutoff). Both kinds rank the same pool, every live active Member below BCE (Recrut, Voluntar, Voluntar Activ, Voluntar cu Drept de Vot); adunarea_generala has no cutoff, so nobody is listable in it. The would-be Promotion Candidates are the rows listable and inside; the would-be Retention Signals are the holders (activ and vot for voluntar_activ, vot for adunarea_generala) not inside. public.run_role_evaluation with the same values records exactly these rows. 42501 role_evaluation_manage_forbidden; PT400 invalid_role_evaluation_kind, invalid_date_range, date_range_in_future, invalid_eligibility_floor, invalid_percent, membership_cutoff_not_set, invalid_membership_cutoff (a Voluntar Activ cutoff after today; adunarea_generala ignores p_cutoff).';

-- ==================== 2. run_role_evaluation_impl ====================
create or replace function private.run_role_evaluation_impl(p_kind text, p_from date, p_to date, p_name text, p_floor integer, p_percent integer, p_cutoff date)
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
  -- #1131 (audit M10): complete days only -- today's later awards would fall
  -- between this run and the live window that opens at period_to + 1, and
  -- role_evaluation_ranking would recompute the sheet over them.
  if p_to >= v_today then
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
  -- the value in Setări the page sends. The Adunarea Generală kind has no
  -- cutoff, so it is not judged for one.
  if p_kind = 'voluntar_activ' and p_cutoff > v_today then
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
  --    kind's threshold row, then the settings row (the share it may write).
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
  --    (and always when nobody was ranked, so no line exists), each storing
  --    the figure it fell under: the line, or the Floor. Nothing
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
      v_row.task_points, case when v_row.ranked then v_line else p_floor end, v_run_id
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

  -- 9. The share this run used becomes the share in force (R58 decision 7,
  --    amended 2026-10-20): the kind's Procent, written once and logged once
  --    naming the run. updated_by is cleared, as the hand-over clears the
  --    threshold's: the log names the run. The Eligibility Floor and the
  --    Membership Cutoff Date are Setări's alone (set_eligibility_floor,
  --    set_membership_cutoff) and are never written back: a run carrying a
  --    value BC changed in Setări after the Simulation would silently revert
  --    that edit. The run records the Floor, share and cutoff it used in its
  --    own role_evaluations row, so its history stays exact.
  v_share_was := case p_kind when 'voluntar_activ' then v_settings.activ_percent else v_settings.vot_percent end;
  if p_percent is distinct from v_share_was then
    update public.evaluation_settings
       set activ_percent = case when p_kind = 'voluntar_activ' then p_percent else activ_percent end,
           vot_percent = case when p_kind = 'adunarea_generala' then p_percent else vot_percent end,
           updated_by = null
     where id = 1;

    insert into public.promotion_threshold_changes (
      kind, field, from_value, to_value, source, changed_by, role_evaluation_id
    ) values (
      p_kind, 'percent', v_share_was, p_percent, 'role_evaluation', null, v_run_id
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
  '#826 (ruling R28), #983, rebuilt by R58 (section C): body of public.run_role_evaluation. Ranks the pool -- every live active Member below BCE, the same for both kinds (amended 2026-10-24) -- over [p_from, p_to] (Europe/Bucharest days, p_to before today -- #1131: complete days only) with the Eligibility Floor, the share and (voluntar_activ) the Membership Cutoff Date given -- private.role_evaluation_rows, the Simulation''s rows -- and records the run with those values, the counts, the Promotion Threshold in force before (threshold_used, may be null) and the line computed (threshold_computed, null when nobody reached the Floor). Voluntar Activ kind: supersedes every undecided Promotion Candidate, then lists every listable Voluntar inside the line, measured against it. Supersedes the kind''s open below_line / below_floor Retention Signals, then stores one per holder not inside: below_line when ranked, with the line as threshold_used, below_floor when not, with the Eligibility Floor. One Notification per Candidate (to BC and the Moderator, linking /administrare/portofoliu-interne) and per Signal (to BC, the Moderator and the Adunarea Generală''s Group Responsibles at level 5 or above, linking /tracker/membru/<member>). Hands the line over when there is one and it differs; writes the share it used into evaluation_settings when it differs, logged with source role_evaluation naming the run -- the Floor and the cutoff it used are recorded on the run only and never written back, since Setări alone holds them; then calls private.refresh_promotion_candidates() (#983). PT400 invalid_role_evaluation_kind / invalid_role_evaluation_name / name_too_short / name_too_long / invalid_date_range / date_range_in_future / invalid_eligibility_floor / invalid_percent / membership_cutoff_not_set / invalid_membership_cutoff (a Voluntar Activ cutoff after today in Europe/Bucharest, the value set_membership_cutoff would refuse; the Adunarea Generală kind ignores p_cutoff) before the gate; 42501 role_evaluation_manage_forbidden below BC. Serialised on pg_advisory_xact_lock(47, 1), then the kind''s promotion_thresholds row, then the evaluation_settings row, then the population''s Profiles for key share.';

comment on function public.run_role_evaluation(text, date, date, text, integer, integer, date) is
  '#826 (ruling R28), rebuilt by R58 (Finalizează): BC or the Moderator records a Role Evaluation of one kind (voluntar_activ or adunarea_generala) over the Evaluation Period [p_from, p_to] (inclusive Bucharest days, ending yesterday at the latest -- #1131: today is not a complete day), named p_name (3..120 characters), with the Eligibility Floor p_floor (>= 1), the share p_percent (1-100) and, for voluntar_activ, the Membership Cutoff Date p_cutoff -- the values a Simulation showed. It ranks every eligible Member in one ranking -- the same pool for both kinds, every live active Member below BCE (amended 2026-10-24) --, stores the run with those values, the line it computed and the threshold in force before, lists the Promotion Candidates (voluntar_activ: Voluntars who joined on or before the cutoff and are inside the line -- never promoted) and stores the Retention Signals (the holders not inside the line, or below the Floor -- Voluntar Activ and Voluntar cu Drept de Vot holders for voluntar_activ, Voluntar cu Drept de Vot holders alone for adunarea_generala -- each with the figure it fell under), notifies BC and the Moderator of each Candidate and, with the Adunarea Generală''s Group Responsibles at level 5 or above, of each Signal, hands the line over as the kind''s Promotion Threshold, and makes the share it used the one in force (the change logged naming the run); the Floor and the cutoff it used are recorded on the run only, never written back -- Prag minim and Data limită de intrare are Setări''s alone. A run that ranked nobody records no line, hands nothing over, lists nobody and signals every holder below the Floor. No Role changes. 42501 role_evaluation_manage_forbidden; PT400 invalid_role_evaluation_kind, invalid_role_evaluation_name, name_too_short, name_too_long, invalid_date_range, date_range_in_future, invalid_eligibility_floor, invalid_percent, membership_cutoff_not_set, invalid_membership_cutoff (a Voluntar Activ cutoff after today; adunarea_generala ignores p_cutoff). Returns (role_evaluation_id, candidates, retention_signals).';
