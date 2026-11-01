-- #1142: a transaction that writes many ledger rows refreshes the Promotion Candidates once, at its end, not once per INSERT statement.
--
-- Finding M26 of the codebase audit of 2026-10-30
-- (docs/review/2026-10-30-codebase-audit.md). The trigger
-- points_ledger_refresh_promotion_candidates was a statement trigger, but
-- every evaluation (private.evaluate_task) and every reversal
-- (private.delete_tasks_effect) is its own INSERT statement, and
-- private.refresh_promotion_candidates aggregates task_points_in_range over
-- the whole window and writes Notifications: create_completed_tasks with 100
-- copies ran 100 refreshes, delete_task on an Umbrella or delete_group on a
-- Department one per award, all inside one transaction holding the Task,
-- Group and roster locks, so every Task command on that subtree waited.
-- supabase/tests/promotion_candidates_live.test.sql, section 10, failed before
-- this file.
--
-- Two triggers replace the one. A BEFORE statement trigger
-- (private.flag_promotion_refresh) marks the transaction-local flag
-- osubb.promotion_refresh_pending at every ledger write; a deferred
-- constraint trigger of the same name as before, FOR EACH ROW, runs
-- private.refresh_promotion_candidates when the queued events fire -- at
-- commit, or when SET CONSTRAINTS makes them immediate -- the first event
-- clearing the flag so the rest of the queue finds nothing pending. So a
-- transaction refreshes once however many ledger rows it wrote, while a
-- session that sets the constraint immediate (every pgTAP suite through
-- _helpers.sql, the seed check's live cases) keeps today's refresh at each
-- statement's end and reads the list right after an award. The refresh counts
-- its runs in the transaction-local osubb.promotion_refresh_count, which the
-- suite reads; nothing else about it changes -- the shared advisory lock, the
-- window, the rule (R58) and the Notifications are as 20261018170000 wrote
-- them, restated here from that file. The triggers on promotion_thresholds,
-- evaluation_settings and profiles stay statement triggers: their writes are
-- one statement each.

-- ==================== 1. refresh_promotion_candidates counts its runs ====================
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
  -- #1142: how many times this ran in the transaction, for the suites that
  -- prove one refresh per transaction (transaction-local, never persisted).
  perform set_config('osubb.promotion_refresh_count',
    (coalesce(nullif(current_setting('osubb.promotion_refresh_count', true), ''), '0')::integer + 1)::text, true);
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
  '#983 (ruling R35), rebuilt by R58: the Promotion Candidate list between Role Evaluations. Reads the eligible set -- live active Voluntars who joined on or before evaluation_settings.membership_cutoff (the Membership Cutoff Date) whose net Task Points since the window opened reach the Voluntar Activ threshold in force; nobody while the cutoff or the threshold is unset. The window opens on the later of the day after the latest Voluntar Activ run''s period_to and the Points Start Date (Ruling 17), and from the beginning while neither exists -- the window my_role_evaluation_standing counts. Then supersedes the open live rows of Voluntars who no longer qualify (decided_by null; a Member who left Voluntar is the role_history trigger''s) and lists each eligible Member with no open row and no live rejection since the last run: a promotion_candidates row with role_evaluation_id null and tenure_since = joined_at, and one Notification per live BC/Moderator (dedupe key promotion_candidate:live:<member>, link /administrare/portofoliu-interne) naming the points since the window opened, the line and the cutoff. Returns the number listed. Takes pg_try_advisory_xact_lock_shared(47, 1) -- shared, so concurrent writers refresh side by side, and the insert is idempotent against the one-open-row index -- and returns 0 at once while a run, a threshold edit or an evaluation-settings edit holds the lock exclusively. Called once per transaction after any write to points_ledger (#1142: a deferred constraint trigger, so create_completed_tasks with many copies, delete_task on an Umbrella or delete_group on a Department refresh once, at the end; a session that sets the constraint immediate -- every pgTAP suite, through _helpers.sql -- keeps the refresh at each statement''s end), by the statement triggers on promotion_thresholds, evaluation_settings and profiles, and last by run_role_evaluation_impl. Counts its runs in the transaction-local osubb.promotion_refresh_count. Executable by nobody.';

-- ==================== 2. The ledger's refresh, once per transaction ====================
create function private.flag_promotion_refresh()
returns trigger
language plpgsql
-- House rule 4: set_config needs no owner privilege, so no definer.
security invoker
set search_path = ''
as $$
begin
  -- A statement is about to write the ledger: the refresh queued behind its
  -- rows must run, once, when the queue fires.
  perform set_config('osubb.promotion_refresh_pending', 'on', true);
  return null;
end;
$$;

comment on function private.flag_promotion_refresh() is
  '#1142: BEFORE statement trigger body on points_ledger (security invoker: it only sets a transaction-local setting) -- marks the transaction-local flag osubb.promotion_refresh_pending, which private.refresh_promotion_candidates_deferred reads when the ledger''s queued constraint-trigger events fire. Granted to nobody.';

revoke execute on function private.flag_promotion_refresh()
  from public, anon, authenticated, service_role;

create function private.refresh_promotion_candidates_deferred()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- One queued event per ledger row. The first to fire after a write runs
  -- the refresh; the rest of the queue finds nothing pending.
  if coalesce(current_setting('osubb.promotion_refresh_pending', true), '') = 'on' then
    perform set_config('osubb.promotion_refresh_pending', 'off', true);
    perform private.refresh_promotion_candidates();
  end if;
  return null;
end;
$$;

comment on function private.refresh_promotion_candidates_deferred() is
  '#1142: body of the deferred constraint trigger points_ledger_refresh_promotion_candidates (AFTER insert, update or delete, FOR EACH ROW, DEFERRABLE INITIALLY DEFERRED). Its events fire at commit -- or when SET CONSTRAINTS makes them immediate, at each statement''s end -- and the first one after a ledger write (osubb.promotion_refresh_pending, set by private.flag_promotion_refresh) runs private.refresh_promotion_candidates once and clears the flag, so a transaction that wrote a hundred awards or reversals refreshes once, at its end. Granted to nobody.';

revoke execute on function private.refresh_promotion_candidates_deferred()
  from public, anon, authenticated, service_role;

drop trigger points_ledger_refresh_promotion_candidates on public.points_ledger;

create trigger points_ledger_flag_promotion_refresh
before insert or update or delete on public.points_ledger
for each statement execute function private.flag_promotion_refresh();

create constraint trigger points_ledger_refresh_promotion_candidates
after insert or update or delete on public.points_ledger
deferrable initially deferred
for each row execute function private.refresh_promotion_candidates_deferred();

comment on function private.refresh_promotion_candidates_on_write() is
  '#983, R58: statement-trigger body -- calls private.refresh_promotion_candidates() after a write to promotion_thresholds (the line), evaluation_settings (the Membership Cutoff Date, the Points Start Date and a run''s write-through; R58 moved this trigger here from the dropped promotion_rules) or profiles (any update -- role, status and joined_at are what matter). #1142: points_ledger has its own pair of triggers, which refresh once per transaction. Granted to nobody.';
