#!/usr/bin/env bash
# #1082's follow-ups: replay the retention_signal_floor migration's backfill
# (the statement between its "backfill: begin" and "backfill: end" markers)
# over Retention Signals stored the way a run stored them before it, inside
# one rollback transaction. Before it, a run put its line on every Signal, so
# a below_floor row named the line, or null when the run ranked nobody. Every
# below_floor row of a run with a Floor takes that Floor, open or closed.
# Nothing else moves: a below_line row keeps its line, a pre-R58 run's rows
# keep its threshold, and so does a below_floor row of a run that recorded no
# Floor, which the backfill never sets to null. A second replay changes
# nothing. The seeded demo Members stand in for the holders.
set -euo pipefail
migration=$(printf '%s\n' supabase/migrations/*_retention_signal_floor.sql)
db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"

backfill() { sed -n '/^-- backfill: begin$/,/^-- backfill: end$/p' "$migration"; }
if ! backfill | grep -q '^update public\.retention_signals'; then
  echo 'The backfill was not found in the migration' >&2; exit 1
fi
{
  cat <<'SQL'
begin;
-- Three runs: an R58 Voluntar Activ run that ranked some (Floor 10, line 40),
-- an R58 Adunarea Generală run that ranked nobody (Floor 100, no line), and a
-- pre-R58 Voluntar Activ run (no Floor, threshold 30).
insert into public.role_evaluations (kind, name, period_from, period_to, run_by, threshold_used, threshold_computed,
                                     ranked_count, eligibility_floor, percent_used, membership_cutoff, evaluated_count)
select run.kind, run.name, current_date - 90, current_date - 1, bc.id, run.threshold_used, run.line,
       run.ranked, run.floor, run.percent, run.cutoff, run.evaluated
  from (values ('voluntar_activ', 'Prag 10 #1082', 45, 40, 3, 10, 35, current_date - 100, 5),
               ('adunarea_generala', 'Prag 100 #1082', 12, null, 0, 100, 25, null, 2),
               ('voluntar_activ', 'Veche #1082', 30, null, 3, null, null, null, null))
       as run (kind, name, threshold_used, line, ranked, floor, percent, cutoff, evaluated),
       public.profiles as bc
 where bc.email = 'bc@demo.osubb';

-- The Signals as those runs stored them; each row's Task Points name it.
insert into public.retention_signals (kind, member_id, role_at_listing, reason, task_points, threshold_used,
                                      role_evaluation_id, closed_at, closed_as)
select run.kind, member.id, s.role_at_listing::public.member_role, s.reason, s.task_points, s.threshold_used,
       run.id, s.closed_at, s.closed_as
  from (values ('Prag 10 #1082', 'activ@demo.osubb', 'activ', 'below_line', 20, 40, null::timestamptz, null),
               ('Prag 10 #1082', 'vot@demo.osubb', 'vot', 'below_floor', 5, 40, null, null),
               ('Prag 10 #1082', 'activ@demo.osubb', 'activ', 'below_floor', 4, 40, now(), 'superseded'),
               ('Prag 100 #1082', 'vot@demo.osubb', 'vot', 'below_floor', 3, null, null, null),
               ('Veche #1082', 'vot@demo.osubb', 'activ', 'below_line', 12, 30, now(), 'superseded'),
               ('Veche #1082', 'activ@demo.osubb', 'activ', 'below_floor', 2, 30, now(), 'superseded'))
       as s (run_name, email, role_at_listing, reason, task_points, threshold_used, closed_at, closed_as)
  join public.role_evaluations as run on run.name = s.run_name
  join public.profiles as member on member.email = s.email;

create temp table floor_signals as
  select s.label, s.expected, signal.id
    from (values ('below_line', 20, 40), ('below_floor', 5, 10), ('closed_below_floor', 4, 10),
                 ('nobody_ranked', 3, 100), ('pre_r58_line', 12, 30), ('pre_r58_floor', 2, 30))
         as s (label, task_points, expected)
    join public.retention_signals as signal on signal.task_points = s.task_points
    join public.role_evaluations as run on run.id = signal.role_evaluation_id
   where run.name like '% #1082';

do $check$
begin
  if (select count(*) from floor_signals) <> 6 then
    raise exception 'the harness stored % of its 6 Signals', (select count(*) from floor_signals);
  end if;
end $check$;

-- Every other Signal in the database, to prove the backfill leaves it alone.
create temp table others_before as
  select signal.* from public.retention_signals as signal
   where signal.id not in (select id from floor_signals);
SQL
  backfill
  cat <<'SQL'
create temp table after_first as
  select floor_signals.label, signal.threshold_used
    from floor_signals join public.retention_signals as signal using (id);
SQL
  backfill
  cat <<'SQL'
do $check$
declare
  v_wrong text[];
begin
  select array_agg(floor_signals.label || ': ' || coalesce(signal.threshold_used::text, 'null')
                   order by floor_signals.label)
    into v_wrong
    from floor_signals join public.retention_signals as signal using (id)
   where signal.threshold_used is distinct from floor_signals.expected;
  if v_wrong is not null then
    raise exception 'after the backfill these Signals carry the wrong figure: %', v_wrong;
  end if;

  if exists (select 1
               from after_first
               join floor_signals using (label)
               join public.retention_signals as signal using (id)
              where signal.threshold_used is distinct from after_first.threshold_used) then
    raise exception 'a second replay of the backfill changed a Signal';
  end if;

  if exists (select * from others_before
             except
             select signal.* from public.retention_signals as signal
              where signal.id not in (select id from floor_signals))
     or (select count(*) from others_before)
        <> (select count(*) from public.retention_signals where id not in (select id from floor_signals)) then
    raise exception 'the backfill changed a Signal the harness did not store';
  end if;
end $check$;
rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q
echo "Retention Signal Floor backfill: below_floor rows take their run's Floor, open or closed; nothing else moves; a second replay changes nothing."
