-- 20260819171628_capabilities_and_rls.sql
-- OSUBB backend — Epic 3.1: role_capabilities lookup + RLS enabled everywhere.
-- Source of truth: docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md (§4.1, §4.3)
-- Tested by supabase/tests/rls_deny_by_default.test.sql.
--
-- After this migration the database is deny-by-default: every table has RLS
-- enabled and no client-facing policies exist yet, so anon/authenticated read
-- zero rows everywhere. Epics 3.2–3.5 add the §4.3 policy matrix on top.

-- ==================== Capabilities lookup (spec §4.1) ====================
-- Privilege capabilities only. 'noTaskNotifs' is NOT a capability: per spec
-- Revision 3 (resolution 2) notification suppression lives in
-- notif_suppression, seeded bc + bce in Epic 1.6.
create table role_capabilities (
  role       member_role references roles (id),
  capability text,
  primary key (role, capability)
);

insert into role_capabilities (role, capability)
select r.id, c.capability
  from roles r
  join (values ('seeAllEvents', 4),
               ('manageTasks',  4),
               ('createTeams',  5),
               ('seeAllSheets', 6),
               ('seeInterne',   6),
               ('manageRoles',  6)) as c (capability, min_level)
    on r.level >= c.min_level;

-- ==================== RLS on every remaining table ====================
-- tasks / task_assignees / task_requests / points_ledger enabled their RLS at
-- creation (Epics 1.3–1.4). This covers everything created before that rule.
alter table roles              enable row level security;
alter table departments        enable row level security;
alter table rating_guide       enable row level security;
alter table difficulty_guide   enable row level security;
alter table profiles           enable row level security;
alter table member_departments enable row level security;
alter table teams              enable row level security;
alter table team_members       enable row level security;
alter table role_capabilities  enable row level security;

-- ==================== Grant normalization ====================
-- The platform's default grants are broader than this app ever needs — and
-- TRUNCATE is not governed by RLS at all, so a client key holding it could
-- empty whole tables. Converge local + hosted on least privilege:
--   anon           → nothing (invite-only app, ADR-0003; anon never reads data)
--   authenticated  → DML only; RLS decides the rows (zero until Epics 3.2–3.5)
--   service_role   → DML only; used by admin flows (2.3, 4.1), has BYPASSRLS
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, references, trigger on all tables in schema public
  from authenticated, service_role;
grant select, insert, update, delete on all tables in schema public
  to authenticated, service_role;
grant usage, select on all sequences in schema public
  to authenticated, service_role;

-- Same posture for every future table/sequence created by migrations.
alter default privileges for role postgres in schema public
  revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from authenticated, service_role;
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to authenticated, service_role;
