#!/usr/bin/env bash
# R58 (ruling 14): replay the Portofoliu Interne migration's day-one block --
# the latest run of each kind has its Retention Signals stored, one open
# below_line row per Member its retention_signal Notifications name -- first
# on a database with no run (nothing is stored), then over pre-R58 runs of
# both kinds, inside one rollback transaction. The block is the migration's
# only DO block; the seeded demo Members stand in for the holders.
set -euo pipefail
migration=$(printf '%s\n' supabase/migrations/*_portofoliu_interne.sql)
db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"
day_one() { sed -n '/^do \$\$$/,/^end \$\$;$/p' "$migration"; }
if [ -z "$(day_one)" ]; then
  echo 'The day-one block was not found in the migration' >&2; exit 1
fi
{
  cat <<'SQL'
begin;
create temp table before_r58 as select count(*) as n from public.retention_signals;
do $check$
begin
  if exists (select 1 from public.role_evaluations) then
    raise exception 'the harness expects a seeded database with no Role Evaluation';
  end if;
end $check$;
SQL
  day_one
  cat <<'SQL'
do $check$
begin
  if (select count(*) from public.retention_signals) <> (select n from before_r58) then
    raise exception 'with no run the day-one block stored a Signal';
  end if;
end $check$;

-- Pre-R58 runs (no Floor): an older and the latest Voluntar Activ run, and the
-- latest Adunarea Generală run, each with the Notifications it sent.
insert into public.role_evaluations (kind, name, period_from, period_to, run_by, threshold_used, ranked_count, run_at)
select run.kind, run.name, run.period_from, run.period_to, bc.id, run.threshold_used, 3, run.run_at
  from (values ('voluntar_activ', 'Vechi VA', current_date - 400, current_date - 200, 30, now() - interval '199 days'),
               ('voluntar_activ', 'Ultima VA', current_date - 90, current_date - 1, 35, now() - interval '1 day'),
               ('adunarea_generala', 'Ultima AG', current_date - 90, current_date - 1, 12, now() - interval '1 day'))
       as run (kind, name, period_from, period_to, threshold_used, run_at),
       public.profiles as bc
 where bc.email = 'bc@demo.osubb';

insert into public.notifications (member_id, kind, title, dedupe_key)
select recipient.id, 'system', 'Semnal de retenție', note.prefix || run.id || ':' || subject.id
  from (values ('Vechi VA', 'retention_signal:', 'activ@demo.osubb', 'bc@demo.osubb'),
               ('Ultima VA', 'retention_signal:', 'activ@demo.osubb', 'bc@demo.osubb'),
               ('Ultima VA', 'retention_signal:', 'activ@demo.osubb', 'moderator@demo.osubb'),
               ('Ultima VA', 'retention_signal:', 'vot@demo.osubb', 'bc@demo.osubb'),
               ('Ultima VA', 'promotion_candidate:', 'voluntar@demo.osubb', 'bc@demo.osubb'),
               ('Ultima AG', 'retention_signal:', 'vot@demo.osubb', 'bc@demo.osubb'))
       as note (run_name, prefix, subject_email, recipient_email)
  join public.role_evaluations as run on run.name = note.run_name
  join public.profiles as subject on subject.email = note.subject_email
  join public.profiles as recipient on recipient.email = note.recipient_email;
SQL
  day_one
  cat <<'SQL'
do $check$
declare
  v_stored text[];
  v_wrong  bigint;
begin
  -- Exactly the Members the latest run of each kind named in a
  -- retention_signal Notification, once each: not the older run's, not a
  -- Candidate's, not twice for two recipients.
  select array_agg(run.name || ':' || member.email order by run.name, member.email)
    into v_stored
    from public.retention_signals as signal
    join public.role_evaluations as run on run.id = signal.role_evaluation_id
    join public.profiles as member on member.id = signal.member_id;
  if v_stored is distinct from array['Ultima AG:vot@demo.osubb', 'Ultima VA:activ@demo.osubb',
                                     'Ultima VA:vot@demo.osubb'] then
    raise exception 'day-one Signals are %', v_stored;
  end if;

  -- Each row: the run's kind, below_line, the Member's current Role, their
  -- Task Points over the run's Evaluation Period, the run's line and
  -- instant, open.
  select count(*) into v_wrong
    from public.retention_signals as signal
    join public.role_evaluations as run on run.id = signal.role_evaluation_id
    join public.profiles as member on member.id = signal.member_id
    left join lateral (
      select earned.task_points
        from private.task_points_in_range(
               (run.period_from::timestamp at time zone 'Europe/Bucharest'),
               ((run.period_to + 1)::timestamp at time zone 'Europe/Bucharest')) as earned
       where earned.member_id = member.id) as points on true
   where not (signal.kind = run.kind
              and signal.reason = 'below_line'
              and signal.role_at_listing = member.role
              and signal.task_points = coalesce(points.task_points, 0)
              and signal.threshold_used = run.threshold_used
              and signal.created_at = run.run_at
              and signal.closed_at is null
              and signal.closed_as is null);
  if v_wrong <> 0 then
    raise exception '% day-one Signal(s) carry the wrong values', v_wrong;
  end if;

  -- The points really come from the period: the demo voter earned in it.
  if not exists (select 1 from public.retention_signals where task_points <> 0) then
    raise exception 'no day-one Signal carries Task Points: the period was not read';
  end if;
end $check$;
rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q
echo 'Day-one Retention Signals: none without a run; the latest run of each kind, once per Member it named.'
