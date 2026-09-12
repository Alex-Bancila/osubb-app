-- #294: index the Tracker authorization and screen predicates. Four
-- indexes, chosen from the candidate list in the brief and confirmed
-- against a ~20k-row, RLS-gated fixture (a plain persona and a live BCE,
-- `set local role authenticated` + forged JWT claims via a scratch
-- pg_temp login helper) — EXPLAIN (ANALYZE, BUFFERS) evidence for all of
-- them, including the rejected candidates, is in the PR description and
-- task-18-report.md; nothing here changes behavior.
--
--   - task_evaluations (evaluated_by) — the own-row branch of
--     task_evaluations_read (`evaluated_by = auth.uid()`, #319) had no
--     index: a caller's own evaluation history forced a Seq Scan of the
--     whole table (cost 4592.98 at 20k Tasks / 4444 Evaluations). Indexed,
--     the same query is a Bitmap Heap Scan seeking straight to the
--     caller's own rows (cost 13.71).
--   - task_candidates (task_id, member_id), non-partial — can_read_task's
--     R2 own-Candidature branch and task_candidates_read's own-row branch
--     match a Candidature of ANY status, but the only two-column index on
--     this table, task_candidates_one_pending_per_member_uidx, is partial
--     to status = 'pending' and cannot serve a withdrawn/selected/closed
--     row. Cost for a (task_id, member_id) point lookup dropped from
--     34.37 (Bitmap Heap Scan via task_candidates_member_idx, filtering
--     task_id after the fact) to 9.35 (Index Scan on both columns, no
--     rows filtered).
--   - tasks (audience) where assignment_mode = 'public' and
--     queue_closed_at is null — can_read_task's R6 Opportunity branch, and
--     the eventual Opportunity-list screen, filter on exactly this triple.
--     assignment_mode and queue_closed_at are plain-column, leakproof
--     predicates that Postgres can push ahead of the row-security qual, so
--     a partial index scoped to them serves both Audience values. Cost for
--     an org-wide Opportunity list dropped from 5690.50 (Seq Scan, 16965
--     of 20000 rows filtered) to 1413.95 (Bitmap Heap Scan, 0 rows
--     filtered); a local, Department-scoped Opportunity list (BitmapAnd
--     with tasks_dept_idx) dropped from 581.51 to 436.84.
--   - tasks (deadline) where status in ('todo', 'in_progress',
--     'in_review') — the Tracker's overdue-first ordering and #69's
--     reminder job scan only unfinished Tasks by deadline; the plain
--     tasks_deadline_idx makes every already-finished Task's deadline
--     recheck the status filter too. Cost for the overdue scan dropped
--     from 4688.10 (Bitmap Heap Scan via tasks_deadline_idx, 5008 of
--     15010 candidate rows filtered on status) to 2491.12 (Bitmap Heap
--     Scan via this index, 0 rows filtered — the partial predicate matches
--     the query's own condition exactly).
--
-- Rejected after measurement, not added (evidence in task-18-report.md):
--   - task_assignments (task_id, member_id): identical plan and cost
--     (Index Scan, cost=0.58..9.35, same buffers, same rows) to the
--     existing task_assignments_task_history_idx (task_id, assigned_at
--     desc, id desc) either way. task_assignments_one_active_per_task_uidx
--     already caps a Task at one active Assignment, so a Task's row count
--     in this table stays small enough that a second key column changes
--     nothing.
--   - tasks (dept_id, status) / (team_id, status) / (project_id, status):
--     under RLS — where `(select public.auth_is_member())` and
--     `private.can_read_task(id)` sit in the same qual list as the
--     caller's own predicate — Postgres used only the composite's leading
--     column (dept_id/team_id/project_id) and left status to a Filter,
--     identical plan and cost to the existing single-column tasks_dept_idx
--     / tasks_team_idx / tasks_project_idx (measured delta 0.7%, 1.7%, and
--     0.0% respectively). The same composite index bypassing RLS (run as
--     the table owner) DOES use both columns and roughly halves the cost —
--     confirming this is an RLS qual-pushdown limit in this Postgres
--     version, not a cardinality problem, and not one a Stack C migration
--     can fix. Revisit if a future Postgres/PostgREST upgrade changes this.
--   - tasks (parent_task_id): already added by #315 (tasks_parent_idx) —
--     nothing to do.

-- task_evaluations_read's own-row branch (#319):
--   `evaluated_by = (select auth.uid())`.
create index task_evaluations_evaluated_by_idx
  on public.task_evaluations (evaluated_by);

-- can_read_task's R2 own-Candidature branch and task_candidates_read's
-- own-row branch (#318, #319): `candidature.member_id = caller.id` for a
-- specific `task_id`, any status — non-partial, unlike the existing
-- pending-only unique index.
create index task_candidates_task_member_idx
  on public.task_candidates (task_id, member_id);

-- can_read_task's R6 Opportunity branch (#318): an ordinary (`kind =
-- 'task'`), unfinished, public Task whose queue is still open, filtered by
-- Audience. Partial on assignment_mode/queue_closed_at, not audience,
-- because those two legs are the ones Postgres can push ahead of RLS.
create index tasks_audience_open_idx
  on public.tasks (audience)
  where assignment_mode = 'public' and queue_closed_at is null;

-- The Tracker's overdue-first ordering and #69's reminder job: only Tasks
-- still in an unfinished lifecycle state ever need a deadline scan.
create index tasks_deadline_active_idx
  on public.tasks (deadline)
  where status in ('todo', 'in_progress', 'in_review');
