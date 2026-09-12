-- #295: normalize grants and default privileges across the Task surface.
--
-- Audit (docker exec psql against the reset local db, before this file):
-- anon holds zero privileges on every Task table/sequence/view already (the
-- schema-wide `revoke all ... from anon` in 20260819171628 and its default
-- privileges cover every table created since). Every `private` function
-- (49, enumerated in supabase/tests/tracker_grants.test.sql) already follows
-- the wrapper/_impl/predicate/require_*/trigger idiom exactly -- including
-- the one dobrerares flagged on #295 (`private.task_is_unassigned`, granted
-- to authenticated only, because the Task read policy and claim_open_task
-- both call it). `usage on schema private` is authenticated-only. The two
-- views (`tasks_with_overdue`, `task_queue_summary`) are already
-- security_invoker, select-only for authenticated/service_role, nothing for
-- anon. The gaps this migration closes:
--
--   1. `public.campaigns` and `public.task_assignments` (#313, #289 -- his
--      spine, not Stack C) each ran `grant all on table ... to service_role`
--      after creation. Postgres's per-table privilege set for ALL is
--      SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER, so this
--      re-added TRUNCATE/REFERENCES/TRIGGER (never governed by RLS) plus
--      unused INSERT/UPDATE/DELETE on top of what a `revoke all` had just
--      cleared -- the opposite of every other command-owned table in this
--      stack (task_activity/task_evaluations/task_candidates/
--      completed_work_requests all narrow service_role to `select`, or
--      `select, insert` for task_activity, matching "the minimum each table
--      actually needs"). Neither table has a service_role write path --
--      #327-#345's commands run as the table owner, not service_role -- so
--      both are narrowed to the same select-only posture here.
--   2. `public.points_ledger` still carries the original schema-wide
--      default (select/insert/update/delete) for service_role from
--      20260819171628, never revisited. Its own migration comment says only
--      the grading trigger, running as table owner, may reconcile rows --
--      no role should write it directly. authenticated keeps its existing
--      insert (`ledger_sanction` -- `ledger_award` was dropped by #261's
--      20260910135327_remove_manual_awards.sql) and select privileges
--      unchanged; only service_role narrows to `select`.
--   3. Three sequences (`tasks_id_seq`, `task_requests_id_seq`,
--      `points_ledger_id_seq`) carry an ambient UPDATE privilege for
--      authenticated (and the first two for service_role) alongside the
--      USAGE/SELECT they need for `nextval()` on insert. UPDATE on a
--      sequence permits `setval()` -- rewriting the id counter directly,
--      unneeded by any insert path and not visible to RLS. This predates
--      Stack C (present since the tables' original creation, before
--      20260819171628's default-privilege statement for sequences ran, and
--      never fully cleared because `grant usage, select` is additive, not a
--      reset). Revoked here for the two roles/sequences that don't need it;
--      `points_ledger_id_seq`'s service_role privilege drops to nothing
--      entirely, following from point 2 (no service_role insert path left).
--   4. `public.claim_open_task(bigint)` (#287, grandfathered by
--      docs/backend/conventions.md #4 as a pre-four-role-form revoke) only
--      ever revoked execute from `public, anon`. The schema-wide default ACL
--      that grants EXECUTE on every new public function to service_role
--      (conventions.md #4) was therefore never cleared for it, and
--      service_role -- which has no self-service claim to make -- could
--      still call it directly. Revoked here; the function's own two-role
--      shape is left alone (out of scope for #295 to rewrite).
--
-- No `alter default privileges` statements are added (Stack B's ledger:
-- Supabase's PUBLIC-role default for functions can't be closed per schema,
-- and a global revoke breaks the pg_temp test helpers -- see
-- docs/backend/conventions.md #4). `private` has no tables, so there is no
-- table default-privilege gap for that schema to close either.

-- ==================== 1. campaigns / task_assignments: service_role ====================

revoke all on table public.campaigns from service_role;
revoke all on sequence public.campaigns_id_seq from service_role;
grant select on table public.campaigns to service_role;

revoke all on table public.task_assignments from service_role;
revoke all on sequence public.task_assignments_id_seq from service_role;
grant select on table public.task_assignments to service_role;

-- ==================== 2. points_ledger: service_role ====================

revoke all on table public.points_ledger from service_role;
revoke all on sequence public.points_ledger_id_seq from service_role;
grant select on table public.points_ledger to service_role;

-- ==================== 3. Sequence UPDATE (setval) excess ====================
-- authenticated keeps USAGE/SELECT (it still inserts into both tables
-- directly, unchanged); only the unneeded UPDATE (setval) is revoked.
-- service_role's points_ledger_id_seq privilege is already fully cleared by
-- section 2 above (its table insert path is gone); tasks_id_seq and
-- task_requests_id_seq are untouched at the table level, so service_role
-- keeps USAGE/SELECT there and only loses UPDATE.

revoke update on sequence public.tasks_id_seq from authenticated, service_role;
revoke update on sequence public.task_requests_id_seq from authenticated, service_role;
revoke update on sequence public.points_ledger_id_seq from authenticated;

-- ==================== 4. claim_open_task: service_role ====================

revoke execute on function public.claim_open_task(bigint) from service_role;
