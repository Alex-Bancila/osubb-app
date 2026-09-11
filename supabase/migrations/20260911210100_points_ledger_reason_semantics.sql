-- #162: the ledger vocabulary is task / task_reversal / sanction (manual awards
-- left with #261). Task rows reference their task; sanctions are negative and
-- explained. No environment holds manual_award rows (local and staging are
-- seed-only; production does not exist yet) — the guard below makes a hosted
-- database that does hold one fail loudly instead of silently constraining
-- around it.
do $$ begin
  if exists (select 1 from public.points_ledger where reason = 'manual_award') then
    raise exception 'points_ledger still holds manual_award rows; decide their fate before #162';
  end if;
end $$;

alter table public.points_ledger
  add constraint points_ledger_reason_ck
    check (reason in ('task', 'task_reversal', 'sanction')),
  add constraint points_ledger_task_reference_ck
    check ((reason in ('task', 'task_reversal')) = (task_id is not null)),
  add constraint points_ledger_sanction_shape_ck
    check (reason <> 'sanction' or (delta < 0 and btrim(coalesce(note, '')) <> ''));

comment on column public.points_ledger.reason is
  'task (evaluation), task_reversal (reopen), sanction (BC, negative, with note).';

-- The #261 trigger only rejected manual_award; the check above covers it, and
-- makes the trigger (and its grandfathered-grant note in the conventions doc)
-- dead code.
drop trigger points_ledger_reject_manual_award on public.points_ledger;
drop function public.reject_manual_award();
