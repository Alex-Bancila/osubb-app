-- #365: no function in public or private is executable by anon — trigger
-- functions included, so the conventions sweep can state the rule without an
-- exception list. These three predate the repository's revoke discipline;
-- Postgres checks EXECUTE on a trigger function only at CREATE TRIGGER, never
-- when the trigger fires, so revoking changes nothing at runtime (precedent:
-- reject_manual_award in 20260910135327).
revoke all on function public.guard_profile_privileged_columns() from public, anon, authenticated;
revoke all on function public.sync_task_ledger()               from public, anon, authenticated;
revoke all on function public.sync_assignee_ledger()           from public, anon, authenticated;
