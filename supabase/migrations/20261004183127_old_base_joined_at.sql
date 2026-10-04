-- #1009: the old volunteer base joins on 22 February 2026.
--
-- Every production profile was provisioned on launch day, 2 October 2026, and
-- provision_profile stamps the provisioning day when no date is given (#933),
-- so the whole old base reads joined_at = 2026-10-02 and would wait months for
-- the tenure that Voluntar -> Voluntar Activ (Role Evaluations and the live
-- Promotion Candidate list) counts from joined_at. Alex, 2026-10-04:
-- "everyone except Recruți" gets 22.02.2026, the date he set for the import
-- (docs/ops/volunteer-import-2026-10.md); a Recrut keeps the real date, so the
-- daily Recrut -> Voluntar job still counts from the day they joined.
--
-- A rule, not a list: no name, address or id appears here. It is idempotent
-- (a second run finds no row dated 2026-10-02 outside the Recruți) and a no-op
-- on a database without such rows (local demo data, staging).
--
-- The write path: a migration runs as postgres, so
-- public.guard_profile_privileged_columns lets the joined_at change through
-- (it refuses only authenticated/anon callers below level 6). The column
-- triggers profiles_guard_nickname, profiles_normalize_phone and
-- profiles_guard_text fire on UPDATE OF their own columns, not joined_at, so no
-- stored value is re-validated. The statement triggers fire once each:
-- broadcast_change sends one org:changes signal, and
-- profiles_refresh_promotion_candidates lists every Voluntar who now holds the
-- top_percent rule's tenure and the threshold in force (R35) -- the purpose of
-- the correction. role_history is untouched: a join date is not a Role change.
--
-- Written to replay: supabase/tests/old_base_joined_at_upgrade.test.sh runs
-- this file twice inside a rolled-back transaction.

update public.profiles as profile
   set joined_at = date '2026-02-22'
 where profile.joined_at = date '2026-10-02'
   and profile.role <> 'recrut';
