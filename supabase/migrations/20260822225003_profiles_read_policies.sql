-- 20260822225003_profiles_read_policies.sql
-- OSUBB backend — Epic 3.2a: who may read which *columns* of a profile.
-- Source of truth: docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md (§4.3)
-- Tested by supabase/tests/rls_profiles_read.test.sql.
--
-- §4.3 asks for something RLS alone cannot express: "everyone reads basic
-- profile fields; full contact details only SELF or level >= 5". RLS filters
-- ROWS, never COLUMNS — a row cannot be half-visible. So the rule is split:
--
--   1. an RLS policy makes every profile ROW visible to *members* (names next
--      to tasks, the directory, assignee pickers all need this);
--   2. column privileges take email/phone away from `authenticated`, so no
--      query against the table can return them;
--   3. a view hands the contact columns back, to the right people only.

-- ==================== 0 · "am I a member at all?" ====================
-- ADR-0003 gate 2, as a reusable predicate. The claims hook stamps
-- member_role only for a provisioned profile with status = 'activ', so its
-- presence *is* membership. auth_level() cannot answer this: a recrut is
-- level 0, and so is a stranger — this function tells them apart.
create or replace function auth_is_member() returns boolean language sql stable as
$$ select coalesce(auth.jwt() -> 'app_metadata' ? 'member_role', false) $$;

comment on function auth_is_member() is
  'True when the caller carries org claims, i.e. is a provisioned active member (ADR-0003 gate 2). Use for "any member may read this" policies.';

-- ==================== 1 · rows ====================
-- No write policies here; self-edit and the role-change guard are 3.2b (#60).
create policy profiles_read on profiles
  for select to authenticated using (auth_is_member());

-- ==================== 2 · columns ====================
-- Personal data of ~200 students: unreadable through the table, full stop.
-- NOTE: a column-level `revoke select (email, phone)` would be a no-op while
-- the role still holds table-wide SELECT (a table grant implies every
-- column). The table grant must go first, then the safe columns come back.
-- service_role and supabase_auth_admin (the claims hook) keep their own
-- table-level grants and are unaffected.
revoke select on profiles from authenticated;
grant select (id, full_name, role, status, avatar_color, tier, joined_year, created_at)
  on profiles to authenticated;

-- ==================== 3 · the safe projection ====================
-- What lists, grids and pickers select. `select *` against this view is safe
-- by construction, which matters because the table now rejects `select *`
-- for members (permission denied for column email).
create view profiles_directory with (security_invoker = on) as
  select id, full_name, role, status, avatar_color, tier, joined_year, created_at
    from profiles;

-- ==================== 3b · contact details, gated ====================
-- ⚠️ Deliberate exception to house rule 3 (views get security_invoker = on):
-- this one MUST run with owner rights. Its whole purpose is to read columns
-- the caller cannot read, so an invoker-rights view would fail for exactly
-- the people it exists to serve. Its WHERE clause is therefore the security
-- boundary — treat it like a policy and never widen it casually.
create view profiles_contact as
  select id, email, phone
    from profiles
   where auth_is_member() and (id = auth.uid() or auth_level() >= 5);

comment on view profiles_contact is
  'Contact details for SELF or level >= 5 (spec §4.3). Runs with owner rights on purpose — it re-exposes columns revoked from authenticated — so its WHERE clause is the security boundary, not a filter.';

grant select on profiles_directory, profiles_contact to authenticated;
