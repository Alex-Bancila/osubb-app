-- #162: the ledger vocabulary is task / task_reversal / sanction (manual awards
-- left with #261). Task rows reference their task; sanctions are negative and
-- explained. No environment holds manual_award rows (local and staging are
-- seed-only; production does not exist yet) — the guard below makes a hosted
-- database that does hold one fail loudly instead of silently constraining
-- around it.

-- Staging's demo data only ever arrives via the manual seed workflow, so a
-- push here would run against whatever the last seed left behind — including
-- the old, note-less sanction row. Repair what is mechanically safe (a
-- missing or whitespace-only note has exactly one honest meaning: it predates
-- this requirement) before the CHECK below would otherwise fail the push.
-- Uses the same blank test as the constraint (a regex, not btrim, so a
-- tab/newline-only note counts as blank too — see
-- points_ledger_sanction_shape_ck).
update public.points_ledger
   set note = 'Sanction recorded before notes were required (#162).'
 where reason = 'sanction'
   and not (coalesce(note, '') ~ '[^[:space:]]');

-- Anything else the constraints below would reject is not mechanically
-- repairable without deciding what the row actually means — fail loudly
-- instead of guessing, same posture as the manual_award guard already here.
do $$ begin
  if exists (select 1 from public.points_ledger where reason = 'manual_award') then
    raise exception 'points_ledger still holds manual_award rows; decide their fate before #162';
  end if;

  if exists (
    select 1 from public.points_ledger
     where reason not in ('task', 'task_reversal', 'sanction')
  ) then
    raise exception 'points_ledger holds a reason outside task/task_reversal/sanction; decide its fate before #162';
  end if;

  if exists (
    select 1 from public.points_ledger
     where reason in ('task', 'task_reversal') and task_id is null
  ) then
    raise exception 'points_ledger holds a task or task_reversal row without a task_id; repair it before #162';
  end if;

  if exists (
    select 1 from public.points_ledger
     where reason = 'sanction' and delta >= 0
  ) then
    raise exception 'points_ledger holds a sanction row with a non-negative delta; repair it before #162';
  end if;

  if exists (
    select 1 from public.points_ledger
     where reason = 'sanction' and task_id is not null
  ) then
    raise exception 'points_ledger holds a sanction row with a task_id; repair it before #162';
  end if;
end $$;

alter table public.points_ledger
  add constraint points_ledger_reason_ck
    check (reason in ('task', 'task_reversal', 'sanction')),
  add constraint points_ledger_task_reference_ck
    check ((reason in ('task', 'task_reversal')) = (task_id is not null)),
  add constraint points_ledger_sanction_shape_ck
    check (reason <> 'sanction' or (delta < 0 and coalesce(note, '') ~ '[^[:space:]]'));

comment on column public.points_ledger.reason is
  'task (evaluation), task_reversal (reopen), sanction (BC, negative, with note).';

-- The #261 trigger only rejected manual_award; the check above covers it, and
-- makes the trigger (and its grandfathered-grant note in the conventions doc)
-- dead code.
drop trigger points_ledger_reject_manual_award on public.points_ledger;
drop function public.reject_manual_award();
