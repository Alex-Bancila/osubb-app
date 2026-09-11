-- #312: leave `difficulty` unset until Evaluation grades the Task. ADR-0007
-- (amended 2026-09-10): Difficulty is not chosen at creation; Evaluation
-- (`complete_task_review` / `mark_task_unfulfilled`, later commands) sets
-- Difficulty and Rating together.
--
-- Existing-data check (2026-09-11, run against this branch's seeded local
-- database before writing this migration):
--   select id, title, status, difficulty, rating from public.tasks
--    where not (
--      case when status in ('completed', 'unfulfilled')
--             then difficulty is not null and rating is not null
--           else rating is null end
--    );
-- returned 0 rows: every seeded Task already carries a rating only once
-- completed, and every completed row already has a difficulty. Staging's
-- demo data comes from a separate manual seed run and can drift from this
-- file (house rule 6), so the guard below checks the two violation shapes
-- explicitly, with a specific message each, instead of trusting
-- `alter table ... add constraint`'s generic violation error. Never repair
-- by nulling a `rating` here — the legacy `sync_task_ledger` trigger
-- (20260819160713_points_engine.sql) deletes the Task's `points_ledger` rows
-- the moment `rating` goes null, which would silently take points away.
do $$
begin
  if exists (
    select 1 from public.tasks
     where status in ('completed', 'unfulfilled')
       and (difficulty is null or rating is null)
  ) then
    raise exception 'tasks holds a completed/unfulfilled row missing difficulty or rating; repair it before #312';
  end if;

  if exists (
    select 1 from public.tasks
     where status not in ('completed', 'unfulfilled')
       and rating is not null
  ) then
    raise exception 'tasks holds a non-terminal-status row with a rating set; repair it before #312 -- do not null the rating, sync_task_ledger would delete its points_ledger rows';
  end if;
end $$;

alter table public.tasks
  alter column difficulty drop not null;

alter table public.tasks
  add constraint tasks_evaluation_inputs_ck check (
    case
      when status in ('completed', 'unfulfilled')
        then difficulty is not null and rating is not null
      else rating is null
    end
  );

comment on constraint tasks_evaluation_inputs_ck on public.tasks is
  'Difficulty and Rating arrive together at Evaluation (status completed/unfulfilled); Difficulty may already be set earlier, Rating never is (ADR-0007).';
