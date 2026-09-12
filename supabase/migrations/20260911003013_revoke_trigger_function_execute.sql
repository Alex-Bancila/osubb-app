-- #365: no function in public or private is executable by anon — trigger
-- functions included, so the conventions sweep can state the rule without an
-- exception list. These three predate the repository's revoke discipline;
-- Postgres checks EXECUTE on a trigger function only at CREATE TRIGGER, never
-- when the trigger fires, so revoking changes nothing at runtime. This is new
-- work, so it follows the four-role revoke form in docs/backend/conventions.md
-- §4 (public, anon, authenticated, service_role) rather than the older
-- three-role variant.
revoke all on function public.guard_profile_privileged_columns() from public, anon, authenticated, service_role;
revoke all on function public.sync_task_ledger()               from public, anon, authenticated, service_role;
revoke all on function public.sync_assignee_ledger()           from public, anon, authenticated, service_role;
