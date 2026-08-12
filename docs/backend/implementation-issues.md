# OSUBB Backend — Implementation Issues

The backend build, divided into GitHub-issue-sized tasks grouped by epic (milestone), in dependency order. Run `scripts/create-github-issues.sh` after creating the GitHub repo to file all of these automatically (with labels + milestones).

**Design source of truth:** `docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md`. **Glossary:** `CONTEXT.md`.

Legend: each task lists its **labels** and **acceptance criteria (AC)**. ✅ = already delivered in the foundation commit.

---

## Epic 0 — Foundation
- **0.1 Repo & Supabase scaffold** ✅ — git repo, `.gitignore`, `supabase/config.toml`, `supabase start` runs locally. *Delivered.*
- **0.2 Domain & decision docs** ✅ — `CONTEXT.md`, ADRs 0001–0003, `CLAUDE.md` backend section. *Delivered.*
- **0.3 Hosted staging project** — Create a **free** Supabase cloud project; `npx supabase link --project-ref <ref>`; `npx supabase db push`. Store the project ref + anon/service keys in the team password manager (not git).
  - **AC:** staging DB has migration 0001 applied; `select * from roles;` returns 8 rows on staging.

## Epic 1 — Database schema
- **1.1 Enums, roles, departments, scoring guides** ✅ — in `0001_core_schema.sql`. *Delivered.*
- **1.2 Members, departments, teams** ✅ — `profiles`, `member_departments`, `teams`, `team_members` in `0001`. *Delivered.*
- **1.3 Tasks & requests** — migration adding `tasks` (with `difficulty`, `rating`, generated `points` via `rating_mult()`), `task_assignees`, `task_requests`.
  - **AC:** inserting a task with difficulty 3 / rating 4 yields `points = 6`; `rating` may be null (ungraded).
- **1.4 Points engine** — `rating_mult()` (if not already present), a trigger that writes one `points_ledger` row per assignee when a task is graded/re-graded, and the `member_points`, `leaderboard`, `dept_cup` views.
  - **AC:** grading a task writes correct ledger rows; `leaderboard` reflects the sums; a rating of 1 subtracts points; re-grading updates rather than duplicates.
- **1.5 Events & announcements** — `events`, `event_attendance`, `announcements`, `announcement_reads`.
  - **AC:** an event can be created with a scope + optional team; a member can RSVP once (PK enforced).
- **1.6 Notifications & push** — `notifications`, `notif_suppression` (seed: `bc` × `task`/`event`/`deadline`), `push_tokens`.
  - **AC:** `notif_suppression` has the three BC rows; `push_tokens` is unique per (member, token).
- **1.7 AG / Interne views** — `ag_eligibility` (points ≥ 300) and `ag_quorum_top25` (top 25% of eligible).
  - **AC:** with demo data, members ≥ 300 pts are `eligible`; the top quarter are `keeps_vote = true`.

## Epic 2 — Auth & login
- **2.1 Providers & invite-only** — enable email/password + Google OAuth; set site/redirect URLs; confirm `enable_signup = false`; document the admin-invite onboarding.
  - **AC:** an un-provisioned Google user cannot self-register; an invited user can complete login.
- **2.2 JWT claims hook** — custom access-token hook injecting `member_role`, `member_level`, `dept_ids`, `team_ids`; add `auth_role()`, `auth_level()`, `auth_in_dept()`, `auth_in_team()` helpers (spec §4.2).
  - **AC:** a decoded access token for a seeded BCE carries `member_level = 5` and the correct `dept_ids`.
- **2.3 Invite / provision flow** — an admin routine (service-role) that creates `auth.users` + `profiles` (+ dept/team links) and sends a magic link. Shared by CSV import.
  - **AC:** inviting a member creates a profile with the right role/departments and delivers a magic link (visible in the local Inbucket inbox).

## Epic 3 — RLS & permissions (security core — spec §4.3–4.4)
- **3.1 Capabilities + enable RLS** — `role_capabilities` lookup (seeded from spec §4.1) and `enable row level security` on every table (deny-by-default).
  - **AC:** with no policies yet, a normal user reads zero rows from every table.
- **3.2 Members / teams policies** — profile reads, contact-detail gating (level ≥ 5), role edits (level ≥ 6), team management (level ≥ 5).
- **3.3 Tasks / points policies** — task read (self / dept / team / level ≥ 4), grade & manage (level ≥ 4), claim an `open` task, ledger visibility (self / dept lead / level ≥ 6).
- **3.4 Calendar policies** — `event_read` mirroring `OSUBB.eventVisible()` (spec §4.4); self-RSVP / self-check-in on `event_attendance`.
- **3.5 Announcements / notifications / Interne policies** — everyone reads announcements; notifications self-only **minus** role-suppressed kinds; `ag_*` views level ≥ 6 only.
  - **AC (whole epic):** each role reads/writes exactly what the §4.3 matrix allows — verified by Epic 6.1.

## Epic 4 — Business logic (Edge Functions, Deno/TS)
- **4.1 CSV recruit import** — upload a CSV (name, email, dept, team) → parse → magic-link invite each recruit → insert `profiles` + `member_departments` + `team_members`; returns created/skipped/errors; gated level ≥ 6 (spec §5.1).
  - **AC:** a 3-row CSV creates 3 recruits with the right department/team and sends 3 magic links; malformed rows are reported, not fatal.
- **4.2 Push dispatch** — on a new announcement/deadline, compute recipients, drop role-suppressed kinds, write `notifications` rows, and call the **OneSignal** REST API with role/department tags (spec §5.2).
  - **AC:** a `task` notification is not delivered to any `bc` member; the in-app `notifications` rows match the delivered set.
- **4.3 (Optional) Promotion suggestions** — a job that flags members crossing a tier threshold for BC review (no auto-promote).
  - **AC:** a member crossing 300 pts appears in a "suggested for AG" list; no role is changed automatically.

## Epic 5 — Seed & demo data
- **5.1 Lookup seed** ✅ — reference lookups seeded by `0001`. *Delivered.*
- **5.2 Demo dataset** — seed routine creating test `auth.users` + `profiles`, teams, tasks, events, announcements mirroring the mockup, for local + staging.
  - **AC:** `supabase db reset` yields a populated `leaderboard`; one login per role exists for testing.

## Epic 6 — Testing
- **6.1 Per-role RLS suite** — a test user per role; assert each role reads/writes exactly what §4.3 allows (pgTAP via `supabase test db`).
  - **AC:** a `voluntar` cannot read another member's tracker; `bc` sees the Interne views; suppressed notifications are hidden; the suite runs green locally.
- **6.2 Points-engine tests** — grading, penalties, re-grading, and `leaderboard` / `dept_cup` correctness.
  - **AC:** deterministic points for known difficulty/rating combos; penalties reduce totals.

## Epic 7 — Deploy & CI
- **7.1 CI** — GitHub Actions: on PR/merge, spin up Postgres, apply migrations, run the Epic-6 tests; on merge to `main`, `db push` to **staging**.
  - **AC:** a PR that breaks a policy fails CI; a green merge updates staging automatically.
- **7.2 Production** — Supabase **Pro** project with **Spend Cap ON** and daily backups; migrations promoted to prod via a **manual gated** workflow step.
  - **AC:** prod exists on Pro; spend cap verified; a documented one-command promotion applies pending migrations.
