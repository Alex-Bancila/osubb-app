# OSUBB App — Implementation Issues

The build, divided into GitHub-issue-sized tasks grouped by epic (milestone), in dependency order. Run `scripts/create-github-issues.sh` **once** after creating the GitHub repo to file all of these automatically (with labels + milestones).

**Design source of truth:** `docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md` (incl. **Revision 3**: closed decisions, schema deltas, mandate traceability). **Glossary:** `CONTEXT.md`. **Calendar & sprint mapping:** `docs/roadmap.md`. **Team workflow:** `docs/team/team-plan.md`.

Legend: each task lists its **labels** and **acceptance criteria (AC)**. ✅ = already delivered.

---

## Epic 0 — Foundation
- **0.1 Repo & Supabase scaffold** ✅ — git repo, `.gitignore`, `supabase/config.toml`, `supabase start` runs locally. *Delivered.*
- **0.2 Domain & decision docs** ✅ — `CONTEXT.md`, ADRs 0001–0006, `CLAUDE.md`, mandate docs in `docs/org/`. *Delivered.*
- **0.3 Hosted staging project** — Create a **free** Supabase cloud project (EU region); `npx supabase link --project-ref <ref>`; `npx supabase db push`. Store the project ref + anon/service keys in the team **Bitwarden** (not git); set the CI staging secrets (see 7.1).
  - **AC:** staging DB has all migrations applied; `select * from roles;` returns 8 rows on staging.

## Epic 1 — Database schema
- **1.1 Enums, roles, departments, scoring guides** ✅ — in `0001_core_schema.sql`. *Delivered.*
- **1.2 Members, departments, teams** ✅ — `profiles`, `member_departments`, `teams`, `team_members` in `0001`. *Delivered.*
- **1.3 Tasks & requests** — migration adding `tasks` (with `difficulty`, `rating`, generated `points` via `rating_mult()`), `task_assignees`, `task_requests`.
  - **AC:** inserting a task with difficulty 3 / rating 4 yields `points = 6`; `rating` may be null (ungraded).
- **1.4 Points engine** — `rating_mult()` (if not already present), a trigger that writes one `points_ledger` row per assignee when a task is graded/re-graded, and the `member_points`, `leaderboard`, `dept_cup` views.
  - **AC:** grading a task writes correct ledger rows; `leaderboard` reflects the sums; a rating of 1 subtracts points; re-grading updates rather than duplicates.
- **1.5 Events & announcements** — `events`, `event_attendance`, `announcements`, `announcement_reads`.
  - **AC:** an event can be created with a scope + optional team; a member can RSVP once (PK enforced).
- **1.6 Notifications & push** — `notifications`, `notif_suppression` (seed **`bc` + `bce`** × `task`/`event`/`deadline`, per spec Revision 3 resolution 2 — own-task notifications are always delivered), `push_tokens`.
  - **AC:** the six suppression rows exist; `push_tokens` is unique per (member, token).
- **1.7 AG / Interne views** — `ag_eligibility` (points ≥ 300) and `ag_quorum_top25` (top 25% of eligible).
  - **AC:** with demo data, members ≥ 300 pts are `eligible`; the top quarter are `keeps_vote = true`.
- **1.8 P1 schema deltas** — `profiles.joined_at date` (backfillable from `joined_year`); document `points_ledger.reason` values (`'task'`, `'manual_award'`, `'sanction'`) and add `note` for sanction reasons (spec Revision 3 §9.3).
  - **AC:** `joined_at` exists; a sanction can be recorded with a reason note.
- **1.9 Promotion rules & role history (Phase 2)** — `promotion_rules` (from/to role, kind `time|points`, threshold, enabled), `role_history` (member, from, to, actor incl. `'system'`, changed_at), the scheduled job (pg_cron / Edge) for the time rule + ledger-driven check for the points rule, and the promotion notification. Implements **ADR-0004**.
  - **AC:** a seeded recrut whose `joined_at` is a semester ago is promoted to voluntar by the job with a `role_history` row (actor `system`) + notification; a voluntar crossing the points threshold becomes `activ`; no rule ever changes a role with level ≥ 3; demotions never happen automatically.

## Epic 2 — Auth & login
- **2.1 Providers & invite-only** — enable email/password + Google OAuth; set site/redirect URLs; confirm `enable_signup = false`; document the admin-invite onboarding.
  - **AC:** an un-provisioned Google user cannot self-register; an invited user can complete login.
- **2.2 JWT claims hook** — custom access-token hook injecting `member_role`, `member_level`, `dept_ids`, `team_ids`; add `auth_role()`, `auth_level()`, `auth_in_dept()`, `auth_in_team()` helpers (spec §4.2).
  - **AC:** a decoded access token for a seeded BCE carries `member_level = 5` and the correct `dept_ids`.
- **2.3 Invite / provision flow** — an admin routine (service-role) that creates `auth.users` + `profiles` (+ dept/team links) and sends a **magic link** (ADR-0003; temp passwords withdrawn per spec Revision 3). Shared by CSV import.
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
- **4.2 Push dispatch (Phase 2)** — on a new announcement/deadline, compute recipients, drop role-suppressed kinds, write `notifications` rows, and call the push provider (default OneSignal — ADR at build time) with role/department tags (spec §5.2).
  - **AC:** a `task` notification is not delivered to any `bc`/`bce` member; the in-app `notifications` rows match the delivered set.

*(The former "4.3 promotion suggestions" is superseded by ADR-0004 → issue 1.9.)*

## Epic 5 — Seed & demo data
- **5.1 Lookup seed** ✅ — reference lookups seeded by `0001`. *Delivered.*
- **5.2 Demo dataset** — seed routine creating test `auth.users` + `profiles`, teams, tasks, events, announcements mirroring the mockup, for local + staging. Powers the **Sep 15 BC demo**.
  - **AC:** `supabase db reset` yields a populated `leaderboard`; one login per role exists for testing.

## Epic 6 — Testing
- **6.1 Per-role RLS suite** — a test user per role; assert each role reads/writes exactly what §4.3 allows (pgTAP via `supabase test db`).
  - **AC:** a `voluntar` cannot read another member's tracker; `bc` sees the Interne views; suppressed notifications are hidden; the suite runs green locally.
- **6.2 Points-engine tests** — grading, penalties, re-grading, sanctions, and `leaderboard` / `dept_cup` correctness. Built **together with 1.4**.
  - **AC:** deterministic points for known difficulty/rating combos; penalties/sanctions reduce totals.

## Epic 7 — Deploy & CI
- **7.1 CI** — GitHub Actions: on PR, spin up the local stack, apply migrations, lint, run the Epic-6 tests; on merge to `main`, `db push` to **staging**. *(Workflow file landed with the foundation; remaining: set `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF` / `SUPABASE_DB_PASSWORD` secrets once 0.3 exists.)*
  - **AC:** a PR that breaks a policy fails CI; a green merge updates staging automatically.
- **7.2 Production** — Supabase **Pro** project with **Spend Cap ON** and daily backups; migrations promoted to prod via a **manual gated** workflow step. Created in Sprint 3, before real data.
  - **AC:** prod exists on Pro; spend cap verified; a documented one-command promotion applies pending migrations.

## Epic 8 — Frontend foundation
- **8.1 Frontend mini-spec + scaffold** — a short spec (folder structure, routing, data-layer conventions, theming tokens from the mockup) then scaffold `app/`: Vite + React + TypeScript + Ionic + ESLint/Prettier + Vitest. ADR-0002 fixes the stack; the mockup fixes the UX.
  - **AC:** `npm run dev` serves the shell; `npm run build` + `npm test` pass in CI.
- **8.2 Auth + app shell** — login screen (magic link + Google), session handling, role-gated navigation (sidebar desktop / tabs mobile), light/dark theming with OSUBB brand tokens.
  - **AC:** an invited demo user logs in via magic link; nav shows exactly the screens the role allows (mirrors mockup `OSUBB.access`).
- **8.3 Data layer** — typed `supabase-js` client, generated DB types (`supabase gen types`), TanStack Query conventions (query keys, error/loading patterns), AG Grid Community wrapper.
  - **AC:** a sample query renders live rows from local Supabase with generated types; type generation is a documented npm script.

## Epic 9 — Screens (mirroring the mockup views)
- **9.1 Task Tracker** — grid (sort/filter), create task (with scoring-guide button), grade → ledger, claim `open` tasks, task requests + approval flow. *Demo-gate screen.*
  - **AC:** the §5 screen→data mapping works end-to-end for every role; grading updates the leaderboard.
- **9.2 Dashboard** — greeting, own points/tier/rank + "Ești la Z puncte…" message, mini-leaderboard, dept cup, upcoming events, recent announcements. *Demo-gate screen.*
  - **AC:** numbers match `member_points` / `leaderboard` / `dept_cup` views for the logged-in demo users.
- **9.3 Calendar** — month grid colored by department, role-filtered events (`event_read`), RSVP ("Vin/Nu pot veni"), call types, "Evenimente viitoare" zone.
  - **AC:** each role sees exactly the events §4.4 allows; RSVP writes `event_attendance`.
- **9.4 Announcements + notifications** — feed with priority styling, critical red pop-ups until read, mark-as-read; in-app notification center.
  - **AC:** a critical announcement pops up until read; suppressed kinds never appear for bc/bce.
- **9.5 Volunteers directory** — HR-style searchable directory (level ≥ 5), member detail, edit.
  - **AC:** level < 5 cannot open the screen or read directory rows.
- **9.6 BC Panel** — task-request approvals, award points / **sanction** (with reason + notification), role management (`role_history` written), CSV import UI (calls 4.1).
  - **AC:** a sanction writes a `'sanction'` ledger row + notification; role changes write `role_history`.
- **9.7 Profile** — own info, tier progress, teams, "Demisie AG" placeholder (P3), theme toggle.
  - **AC:** a member edits own contact fields only (RLS enforced).

## Epic 10 — Launch ops
- **10.1 Cloudflare Pages deploy** — staging + production environments, SPA routing config, environment variables (anon key/url), deploy on merge.
  - **AC:** the staging URL serves the app against staging Supabase; production is a separate env.
- **10.2 BC/BCE data migration** — import the real leadership task sheet (Google Sheets export → script) into `tasks`/`points_ledger`.
  - **AC:** totals in the app match the current sheet for every BC/BCE member (sign-off from Alex).
- **10.3 BC/BCE onboarding** — invite the ~20 BC/BCE members (magic links), 1-page quickstart (RO), collect first-week feedback.
  - **AC:** every BC/BCE member has logged in at least once by Oct 8.
- **10.4 Org-wide rollout (Phase 2)** — recruit CSV onboarding during the recruitment campaign, promotion engine live (1.9), notification prefs.
  - **AC:** ≥80% of active members have accounts by Dec 1.
