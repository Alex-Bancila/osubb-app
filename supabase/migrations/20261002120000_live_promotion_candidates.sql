-- #983: Promotion Candidates listed as soon as a Voluntar qualifies, not only at a Role Evaluation (ruling R35).
--
-- R28 listed a Promotion Candidate only when BC ran a Voluntar Activ Role
-- Evaluation. Alex (2026-10-02): a Voluntar who is eligible -- the required
-- tenure and, since the kind's last run, at least the Promotion Threshold in
-- force -- joins the list at once. Nothing else moves between runs: no
-- promotion (BC still promotes by hand), no ranking, no threshold
-- computation and no Retention Signal.
--
-- What moves:
--   * promotion_candidates.role_evaluation_id becomes nullable: null marks a
--     row listed between runs ("live"). promotion_candidates.threshold_used
--     carries the line each row was measured against -- the run's for a run
--     row (backfilled), the threshold in force for a live row.
--   * private.refresh_promotion_candidates() computes the eligible set the
--     way my_role_evaluation_standing counts a Member's own standing (net
--     Task Points since the day after the latest Voluntar Activ run's
--     period_to; all time before any run), supersedes the open live rows of
--     Voluntars who no longer qualify, lists each newly eligible Member with
--     one Notification per live BC/Moderator, and returns the number listed.
--     It takes pg_try_advisory_xact_lock_shared(47, 1) and does nothing
--     while a run or a threshold edit holds that lock exclusively: the run
--     re-lists everyone from its range and then calls the refresh itself,
--     and waiting here -- from inside a transaction that may already hold a
--     Profile `for update` (set_member_role, set_member_status) -- could
--     deadlock against the run's `for key share` on the population's
--     Profiles. Shared, so concurrent writers refresh side by side (an
--     exclusive try-lock would make the second of two simultaneous awards
--     skip its refresh and miss its own crossing); the insert is idempotent
--     against the one-open-row index, and only a row actually written is
--     notified.
--   * Statement-level triggers call it after writes to points_ledger,
--     promotion_thresholds, promotion_rules and profiles (any update; role,
--     status and joined_at are what matter). run_role_evaluation_impl calls it last: the new window may
--     already hold points when the range ended earlier. apply_promotions
--     calls it daily, for a tenure reached by the calendar alone.
--   * A live row of a Member who leaves Voluntar is closed by the
--     role_history trigger as before (promoted or superseded, by the actor);
--     the refresh leaves those rows alone, since set_member_role writes the
--     Profile before its role_history row.
--   * A rejection of a live row holds until the next Voluntar Activ run: the
--     refresh lists nobody with a rejected live row created since that run.
--     A run row's rejection holds for its run only, as before.
--
-- Rebuilt here from main's latest definitions:
--   private.run_role_evaluation_impl -- 20260928100000_notification_links.sql
--   private.apply_promotions         -- 20260927220000_role_evaluations.sql

-- ---------------------------------------------------------------------------
-- 1. The table: a row without a run, and the line it was measured against.
-- ---------------------------------------------------------------------------
alter table public.promotion_candidates
  alter column role_evaluation_id drop not null,
  add column threshold_used integer;

update public.promotion_candidates as candidate
   set threshold_used = run.threshold_used
  from public.role_evaluations as run
 where run.id = candidate.role_evaluation_id;

alter table public.promotion_candidates
  alter column threshold_used set not null;

comment on table public.promotion_candidates is
  '#826 (ruling R28), #983 (R35): a Voluntar with the required tenure whose Task Points reached the Voluntar Activ Promotion Threshold -- at a Role Evaluation (role_evaluation_id set) or, between runs, the moment they qualified (role_evaluation_id null, written by private.refresh_promotion_candidates) -- never promoted automatically. decision null while BC has not decided; promoted when the Member leaves Voluntar upward (the role_history trigger, decided_by the BC who changed the Role), rejected by public.reject_promotion_candidate (with BC''s reason), superseded by the next Voluntar Activ run, by leaving Voluntar any other way, or -- a live row only -- by no longer qualifying (decided_by null). At most one undecided row per Member. BC and the Moderator read every row; a Member reads their own. Named role_evaluation_id, not evaluation_id: points_ledger.evaluation_id already means a Task''s Evaluation.';

comment on column public.promotion_candidates.role_evaluation_id is
  '#983: the Voluntar Activ Role Evaluation that listed the row, or null for a row listed between runs the moment the Member qualified.';

comment on column public.promotion_candidates.threshold_used is
  '#983: the Voluntar Activ Promotion Threshold the row was measured against -- the run''s threshold_used for a run row, the threshold in force at the listing for a live row.';

-- ---------------------------------------------------------------------------
-- 2. The refresh: the eligible set, listed and unlisted between runs.
-- ---------------------------------------------------------------------------
create function private.refresh_promotion_candidates()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_today     date;
  v_since     date;
  v_last_run  timestamptz;
  v_rule      public.promotion_rules%rowtype;
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

  v_today := (now() at time zone 'Europe/Bucharest')::date;

  -- The window: the day after the latest Voluntar Activ run's period_to,
  -- exactly as my_role_evaluation_standing counts a Member's own points.
  select run.period_to + 1, run.run_at into v_since, v_last_run
    from public.role_evaluations as run
   where run.kind = 'voluntar_activ'
   order by run.run_at desc, run.id desc
   limit 1;

  select * into v_rule
    from public.promotion_rules as rule
   where rule.kind = 'top_percent';
  select setting.threshold into v_threshold
    from public.promotion_thresholds as setting
   where setting.kind = 'voluntar_activ';

  -- The eligible set, read once: live active Voluntars holding the rule's
  -- tenure today, at or above the threshold in force since the window
  -- opened. Nobody while the rule is off or the threshold unset.
  if coalesce(v_rule.enabled, false) and v_threshold is not null then
    select coalesce(jsonb_agg(to_jsonb(eligible)), '[]'::jsonb) into v_rows
      from (
        select profile.id as member_id,
               earned.task_points,
               (profile.joined_at + make_interval(months => v_rule.min_tenure_months))::date as tenure_since
          from public.profiles as profile
          join private.task_points_in_range(
                 coalesce(v_since::timestamp at time zone 'Europe/Bucharest', '-infinity'::timestamptz),
                 'infinity'::timestamptz) as earned on earned.member_id = profile.id
         where profile.status = 'activ'
           and profile.role = 'voluntar'
           and profile.joined_at is not null
           and (profile.joined_at + make_interval(months => v_rule.min_tenure_months))::date <= v_today
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
      format('%s are %s puncte de task %s, cel puțin pragul în vigoare de %s puncte, și vechimea '
             'cerută. Nu este promovat automat: îl poți promova în Voluntar Activ din panoul de '
             'roluri sau respinge din Evaluări de rol.',
             v_row.member_name, v_row.task_points,
             case when v_since is null then 'în total'
                  else 'de la ultima evaluare Voluntar Activ (din '
                       || pg_catalog.to_char(v_since, 'DD.MM.YYYY') || ')' end,
             v_threshold),
      null, 'promotion_candidate:live:' || v_row.member_id::text,
      null, '/administrare/evaluari');
  end loop;

  return v_listed;
end;
$$;

comment on function private.refresh_promotion_candidates() is
  '#983 (ruling R35): the Promotion Candidate list between Role Evaluations. Reads the eligible set -- live active Voluntars with the top_percent rule''s tenure on today''s Europe/Bucharest date whose net Task Points since the day after the latest Voluntar Activ run''s period_to (all time before any run) reach the Voluntar Activ threshold in force; nobody while the rule is off or the threshold unset -- then supersedes the open live rows of Voluntars who no longer qualify (decided_by null; a Member who left Voluntar is the role_history trigger''s) and lists each eligible Member with no open row and no live rejection since the last run: a promotion_candidates row with role_evaluation_id null and one Notification per live BC/Moderator (dedupe key promotion_candidate:live:<member>, link /administrare/evaluari). Returns the number listed. Takes pg_try_advisory_xact_lock_shared(47, 1) -- shared, so concurrent writers refresh side by side, and the insert is idempotent against the one-open-row index -- and returns 0 at once while a run or a threshold edit holds the lock exclusively. Called by the statement triggers on points_ledger, promotion_thresholds, promotion_rules and profiles, last by run_role_evaluation_impl, and daily by apply_promotions. Executable by nobody.';

revoke execute on function private.refresh_promotion_candidates()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The triggers: every write that can change who qualifies.
-- ---------------------------------------------------------------------------
create function private.refresh_promotion_candidates_on_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_promotion_candidates();
  return null;
end;
$$;

comment on function private.refresh_promotion_candidates_on_write() is
  '#983: statement-trigger body -- calls private.refresh_promotion_candidates() after a write to points_ledger (an award or a reversal), promotion_thresholds (the line), promotion_rules (the tenure or the switch) or profiles (any update -- role, status and joined_at are what matter). Granted to nobody.';

revoke execute on function private.refresh_promotion_candidates_on_write()
  from public, anon, authenticated, service_role;

create trigger points_ledger_refresh_promotion_candidates
after insert or update or delete on public.points_ledger
for each statement execute function private.refresh_promotion_candidates_on_write();

create trigger promotion_thresholds_refresh_promotion_candidates
after update on public.promotion_thresholds
for each statement execute function private.refresh_promotion_candidates_on_write();

create trigger promotion_rules_refresh_promotion_candidates
after update on public.promotion_rules
for each statement execute function private.refresh_promotion_candidates_on_write();

-- No column list: a list would make the trigger depend on the columns it
-- names (the joined_at upgrade harness drops that column to rebuild history),
-- and the refresh is cheap and idempotent on any other change.
create trigger profiles_refresh_promotion_candidates
after update on public.profiles
for each statement execute function private.refresh_promotion_candidates_on_write();

-- ---------------------------------------------------------------------------
-- 4. run_role_evaluation_impl: the candidate row carries the threshold used,
--    and the run lists the new window last. Rebuilt from
--    20260928100000_notification_links.sql; nothing else changes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.run_role_evaluation_impl(p_kind text, p_from date, p_to date, p_name text)
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
        insert into public.promotion_candidates (role_evaluation_id, member_id, task_points, tenure_since, threshold_used)
        values (v_run_id, v_row.member_id, v_row.task_points, v_row.tenure_since, v_threshold.threshold);
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
  --    Responsibles are told -- but only those at level 5 or above, the
  --    level /tracker/membru/<id> requires (#843, D11): a Responsible below it
  --    would be sent to a page that turns them away.
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
               and coalesce(private.actor_level(recipient.id), -1) >= 5
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

  -- 9. #983: the new window opens at p_to + 1 and may already hold points
  --    (a range that ended earlier); whoever is at the threshold in it is
  --    listed now. The run holds (47, 1), so the refresh's shared try-lock
  --    (its own session's) succeeds.
  perform private.refresh_promotion_candidates();

  return query select v_run_id, v_candidates, v_signals;
end;
$function$;

comment on function private.run_role_evaluation_impl(text, date, date, text) is
  '#826 (ruling R28), #983: body of public.run_role_evaluation. Ranks the kind''s population over [p_from, p_to] (Europe/Bucharest days, p_to not after today), records the run with the threshold used and the one computed, writes the Promotion Candidates (Voluntar Activ kind, rule on: every tenured Voluntar at or above the threshold used, with threshold_used, after superseding every undecided row) and the Retention Signals, hands the computed threshold over when it is at least 1, then calls private.refresh_promotion_candidates() so a Voluntar already at the threshold in the new window is listed at once (#983). PT400 invalid_role_evaluation_kind / invalid_role_evaluation_name / name_too_short / name_too_long / invalid_date_range / date_range_in_future before the gate; 42501 role_evaluation_manage_forbidden below BC; PT409 promotion_threshold_not_set. Serialised on pg_advisory_xact_lock(47, 1).';

-- ---------------------------------------------------------------------------
-- 5. apply_promotions: the daily job also refreshes the list, for a tenure
--    reached by the calendar alone. Rebuilt from
--    20260927220000_role_evaluations.sql; nothing else changes.
-- ---------------------------------------------------------------------------
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
  -- #983: a Voluntar whose tenure arrived today with the points already
  -- earned is listed by this run; nothing else wrote anything for them.
  perform private.refresh_promotion_candidates();
  return v_count;
end;
$$;

comment on function private.apply_promotions() is
  '#52, trimmed by #826 (ruling R28), #983: the daily pg_cron job osubb-apply-promotions. Takes pg_advisory_xact_lock(52, 1), then applies every row of private.detect_promotions() -- the tenure rule, Recrut -> Voluntar -- through private.apply_promotion, then calls private.refresh_promotion_candidates() (a tenure reached by the calendar alone; a shared try-lock, so the job never waits on a run). Returns the number of promotions applied; a second run applies none. Never promotes to Voluntar Activ, never demotes or withdraws a Role. Executable by nobody.';
