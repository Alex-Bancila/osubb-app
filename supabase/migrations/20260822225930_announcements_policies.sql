-- 20260822225930_announcements_policies.sql
-- OSUBB backend — Epic 3.5a: announcements + read receipts.
-- Source of truth: docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md (§4.3)
-- Tested by supabase/tests/rls_announcements.test.sql.
--
-- Announcements are the org megaphone: public *inside* the organisation,
-- curated authorship. Department-scoped announcements are readable by
-- everyone too — §4.3 says "everyone reads announcements", and a dept tag is
-- a filing label in the feed, not a secret. (If that ever changes, narrow it
-- here, in one place.)

-- ==================== announcements ====================
create policy announcements_read on announcements
  for select to authenticated using (auth_is_member());

-- Create / edit / delete: level >= 4, the same threshold that manages tasks.
create policy announcements_write on announcements
  for all to authenticated
  using (auth_level() >= 4) with check (auth_level() >= 4);

-- ==================== announcement_reads ====================
-- Strictly self: a read receipt is a statement about you, and the unread
-- badge would be meaningless if anyone could mark anyone else's.
create policy announcement_reads_self on announcement_reads
  for all to authenticated
  using (member_id = auth.uid()) with check (member_id = auth.uid());
