-- #610: revoke direct profiles.role and profiles.status writes from authenticated.
--
-- Once a command owns a table's writes, the direct write path is revoked from
-- authenticated (docs/backend/conventions.md §2). With public.set_member_role
-- and public.set_member_status merged on main (#580), role and status changes
-- must always route through those commands to guarantee an immutable role_history
-- audit row.
--
-- Server-side paths (provision_profile, seed.sql, Edge Functions csv-import and
-- invite-member, and future promotion jobs) run as migration/definer owner or
-- service_role, not authenticated, and remain completely unaffected.

revoke update (role, status) on table public.profiles from authenticated;
