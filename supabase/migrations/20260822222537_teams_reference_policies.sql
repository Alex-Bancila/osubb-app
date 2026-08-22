-- 20260822222537_teams_reference_policies.sql
-- OSUBB backend — Epic 3.2c: reference data, memberships and teams.
-- Source of truth: docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md (§4.3)
-- Tested by supabase/tests/rls_teams_reference.test.sql.
--
-- The organisation's vocabulary (roles, departments, scoring guides,
-- capabilities) and its structure (who is in which department/team) are
-- public *inside* the org: the app cannot render a department chip or a
-- points guide without them, and §4.3's visibility rules already assume
-- membership is common knowledge. Nothing here is personal data —
-- contact details stay gated in 3.2a.
--
-- Every policy is scoped `to authenticated`, so anon keeps seeing nothing
-- (it also holds no table grants since 3.1 — two independent gates).

-- ==================== Reference lookups: read-only for members ====================
-- No write policies at all: reference data changes through migrations
-- (house rule 6), never from the client.
create policy roles_read on roles
  for select to authenticated using (true);
create policy departments_read on departments
  for select to authenticated using (true);
create policy rating_guide_read on rating_guide
  for select to authenticated using (true);
create policy difficulty_guide_read on difficulty_guide
  for select to authenticated using (true);
create policy role_capabilities_read on role_capabilities
  for select to authenticated using (true);

-- ==================== Structure: memberships ====================
-- Readable by every member (the task/event visibility rules join these),
-- managed by BCE and up — `createTeams` is level >= 5 in §4.1.
create policy member_departments_read on member_departments
  for select to authenticated using (true);
create policy member_departments_manage on member_departments
  for all to authenticated
  using (auth_level() >= 5) with check (auth_level() >= 5);

create policy team_members_read on team_members
  for select to authenticated using (true);
create policy team_members_manage on team_members
  for all to authenticated
  using (auth_level() >= 5) with check (auth_level() >= 5);

-- ==================== Structure: teams ====================
create policy teams_read on teams
  for select to authenticated using (true);
create policy teams_manage on teams
  for all to authenticated
  using (auth_level() >= 5) with check (auth_level() >= 5);
