#!/usr/bin/env bash
# Create the OSUBB backend labels, milestones, and issues on GitHub.
#
# Prerequisites:
#   1. Create the GitHub repo and add it as a remote:
#        gh repo create osubb-app --private --source=. --remote=origin --push
#      (or create it in the GitHub UI, then `git remote add origin <url>`)
#   2. Be authenticated: `gh auth status`
#
# HISTORICAL — EXECUTED 2026-08-12. DO NOT RUN.
# This created the original backlog once. `gh issue create` is not idempotent:
# running it again duplicates ~100 issues (CLAUDE.md house rule 9).
#
# Mirrors docs/backend/implementation-issues.md. Foundation issues 0.1/0.2/1.1/1.2/5.1
# are already delivered in the repo, so they are intentionally NOT created here.

set -euo pipefail

if [ "${I_REALLY_WANT_TO_RECREATE_THE_BACKLOG:-}" != "1" ]; then
  echo "HISTORICAL — EXECUTED 2026-08-12. DO NOT RUN." >&2
  echo "This script would duplicate the whole GitHub backlog. Refusing." >&2
  echo "Override only on a fresh, empty repository: I_REALLY_WANT_TO_RECREATE_THE_BACKLOG=1 bash $0" >&2
  exit 1
fi

command -v gh >/dev/null || { echo "gh CLI not found. Install from https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Not logged in. Run: gh auth login"; exit 1; }
gh repo view >/dev/null 2>&1 || { echo "No GitHub repo detected. Create it and add the 'origin' remote first (see header)."; exit 1; }
echo "Target repo: $(gh repo view --json nameWithOwner -q .nameWithOwner)"

# ------------------------------- Labels -------------------------------
label() { gh label create "$1" --color "$2" --description "$3" --force >/dev/null && echo "  label: $1"; }
echo "Creating labels..."
# Triage (matches docs/agents/triage-labels.md)
label "needs-triage"    "FBCA04" "Maintainer needs to evaluate"
label "needs-info"      "D4C5F9" "Waiting on reporter"
label "ready-for-agent" "0E8A16" "Fully specified, AFK-ready"
label "ready-for-human" "1D76DB" "Needs human implementation"
label "wontfix"         "FFFFFF" "Will not be actioned"
# Area
label "backend"       "5319E7" "Backend / Supabase work"
label "database"      "006B75" "Schema / migrations"
label "auth"          "B60205" "Authentication & login"
label "rls"           "D93F0B" "Row-Level Security policies"
label "edge-function" "0052CC" "Supabase Edge Functions"
label "testing"       "BFD4F2" "Tests"
label "ci"            "C2E0C6" "CI/CD & deploy"
label "docs"          "FEF2C0" "Documentation"
label "frontend"      "E99695" "Ionic/React app work"

# ----------------------------- Milestones -----------------------------
milestone() { gh api "repos/{owner}/{repo}/milestones" -X POST -f title="$1" >/dev/null 2>&1 && echo "  milestone: $1" || echo "  milestone exists: $1"; }
echo "Creating milestones..."
milestone "Epic 0 — Foundation"
milestone "Epic 1 — Database schema"
milestone "Epic 2 — Auth & login"
milestone "Epic 3 — RLS & permissions"
milestone "Epic 4 — Edge Functions"
milestone "Epic 5 — Seed & demo data"
milestone "Epic 6 — Testing"
milestone "Epic 7 — Deploy & CI"
milestone "Epic 8 — Frontend foundation"
milestone "Epic 9 — Screens"
milestone "Epic 10 — Launch ops"

# ------------------------------- Issues -------------------------------
# issue "<title>" "<milestone>" "<comma,labels>"  <<'BODY' ... BODY
issue() {
  local title="$1" milestone="$2" labels="$3" body; body="$(cat)"
  local args=(--title "$title" --body "$body" --milestone "$milestone")
  IFS=',' read -ra L <<< "$labels"; for l in "${L[@]}"; do args+=(--label "$l"); done
  gh issue create "${args[@]}" >/dev/null && echo "  issue: $title"
}
echo "Creating issues..."

issue "0.3 Hosted staging Supabase project" "Epic 0 — Foundation" "backend,ci,needs-triage" <<'BODY'
Create a free Supabase cloud project as shared staging.
- `npx supabase link --project-ref <ref>` then `npx supabase db push`
- Store project ref + anon/service keys in the team password manager (NOT git)

**AC:** migration 0001 applied on staging; `select * from roles;` returns 8 rows.
See docs/backend/implementation-issues.md.
BODY

issue "1.3 Tasks & task requests schema" "Epic 1 — Database schema" "backend,database,ready-for-agent" <<'BODY'
Migration: `tasks` (difficulty, rating, generated `points` via `rating_mult()`), `task_assignees`, `task_requests`.

**AC:** a task with difficulty 3 / rating 4 → `points = 6`; `rating` may be null. Spec §3.3.
BODY

issue "1.4 Points engine (ledger trigger + views)" "Epic 1 — Database schema" "backend,database,ready-for-agent" <<'BODY'
`rating_mult()`, a trigger writing one `points_ledger` row per assignee on grade/re-grade, and `member_points` / `leaderboard` / `dept_cup` views.

**AC:** grading writes correct ledger rows; leaderboard reflects sums; rating 1 subtracts; re-grading updates, not duplicates. Spec §3.3.
BODY

issue "1.5 Events & announcements schema" "Epic 1 — Database schema" "backend,database,ready-for-agent" <<'BODY'
`events`, `event_attendance`, `announcements`, `announcement_reads`.

**AC:** event created with scope + optional team; a member can RSVP once (PK). Spec §3.4.
BODY

issue "1.6 Notifications & push tokens schema" "Epic 1 — Database schema" "backend,database,ready-for-agent" <<'BODY'
`notifications`, `notif_suppression` (seed: **bc + bce** × task/event/deadline — own-task notifications always delivered, per spec Revision 3 resolution 2), `push_tokens`.

**AC:** six suppression rows exist; `push_tokens` unique per (member, token). Spec §3.4 + Revision 3.
BODY

issue "1.8 P1 schema deltas (joined_at, sanction semantics)" "Epic 1 — Database schema" "backend,database,ready-for-agent" <<'BODY'
`profiles.joined_at date` (backfillable from `joined_year`); document `points_ledger.reason` values ('task','manual_award','sanction') and add `note` for sanction reasons. Spec Revision 3 §9.3.

**AC:** `joined_at` exists; a sanction can be recorded with a reason note.
BODY

issue "1.9 Promotion rules, role history & engine (Phase 2, ADR-0004)" "Epic 1 — Database schema" "backend,database,ready-for-agent" <<'BODY'
`promotion_rules` (from/to, kind time|points, threshold, enabled), `role_history` (actor incl. 'system'), scheduled job (pg_cron/Edge) for the time rule + ledger-driven check for the points rule, promotion notification. ADR-0004.

**AC:** a recrut with `joined_at` a semester ago is auto-promoted to voluntar (role_history actor=system + notification); a voluntar crossing the points threshold becomes activ; no automatic change for roles level >= 3; no automatic demotion.
BODY

issue "1.7 AG / Interne views" "Epic 1 — Database schema" "backend,database,ready-for-agent" <<'BODY'
`ag_eligibility` (points ≥ 300) and `ag_quorum_top25` (top 25% of eligible).

**AC:** with demo data, ≥300-pt members are eligible; top quarter `keeps_vote = true`. Spec §3.5.
BODY

issue "2.1 Auth providers & invite-only" "Epic 2 — Auth & login" "backend,auth,ready-for-human" <<'BODY'
Enable email/password + Google OAuth; set site/redirect URLs; confirm `enable_signup = false`; document admin-invite onboarding.

**AC:** an un-provisioned Google user cannot self-register; an invited user can log in. ADR-0003.
BODY

issue "2.2 JWT custom-claims hook + auth helpers" "Epic 2 — Auth & login" "backend,auth,rls,ready-for-agent" <<'BODY'
Custom access-token hook injecting `member_role`, `member_level`, `dept_ids`, `team_ids`; add `auth_role()/auth_level()/auth_in_dept()/auth_in_team()`.

**AC:** a seeded BCE's token carries `member_level = 5` and correct `dept_ids`. Spec §4.2.
BODY

issue "2.3 Invite / provision flow (magic link)" "Epic 2 — Auth & login" "backend,auth,ready-for-human" <<'BODY'
Service-role routine creating `auth.users` + `profiles` (+ dept/team links) and sending a magic link. Shared by CSV import.

**AC:** inviting a member creates the profile with correct role/departments and delivers a magic link (local Inbucket). ADR-0003.
BODY

issue "3.1 Capabilities lookup + enable RLS" "Epic 3 — RLS & permissions" "backend,rls,ready-for-agent" <<'BODY'
`role_capabilities` (seed from spec §4.1) and `enable row level security` on every table (deny-by-default).

**AC:** with no policies yet, a normal user reads zero rows from every table.
BODY

issue "3.2 RLS: members & teams" "Epic 3 — RLS & permissions" "backend,rls,ready-for-human" <<'BODY'
Profile reads, contact-detail gating (level ≥ 5), role edits (level ≥ 6), team management (level ≥ 5). Spec §4.3.
BODY

issue "3.3 RLS: tasks & points" "Epic 3 — RLS & permissions" "backend,rls,ready-for-human" <<'BODY'
Task read (self/dept/team/level ≥ 4), grade & manage (level ≥ 4), claim `open` task, ledger visibility. Spec §4.3–4.4.
BODY

issue "3.4 RLS: calendar visibility" "Epic 3 — RLS & permissions" "backend,rls,ready-for-human" <<'BODY'
`event_read` mirroring `OSUBB.eventVisible()`; self-RSVP/check-in on `event_attendance`. Spec §4.4.
BODY

issue "3.5 RLS: announcements, notifications, Interne" "Epic 3 — RLS & permissions" "backend,rls,ready-for-human" <<'BODY'
Everyone reads announcements; notifications self-only minus role-suppressed kinds; `ag_*` views level ≥ 6. Spec §4.3–4.4.
BODY

issue "4.1 Edge Function: CSV recruit import" "Epic 4 — Edge Functions" "backend,edge-function,ready-for-human" <<'BODY'
Upload CSV → parse → magic-link invite each recruit → insert profile/departments/teams; return created/skipped/errors; gated level ≥ 6.

**AC:** a 3-row CSV creates 3 recruits with correct dept/team + 3 magic links; malformed rows reported, not fatal. Spec §5.1.
BODY

issue "4.2 Edge Function: push dispatch (Phase 2)" "Epic 4 — Edge Functions" "backend,edge-function,ready-for-human" <<'BODY'
On new announcement/deadline: compute recipients, drop role-suppressed kinds, write `notifications`, call the push provider (default OneSignal — ADR at build time) with role/dept tags.

**AC:** a `task` notification is never delivered to a `bc`/`bce` member; in-app rows match the delivered set. Spec §5.2 + Revision 3.
BODY

issue "5.2 Demo dataset seed" "Epic 5 — Seed & demo data" "backend,database,ready-for-agent" <<'BODY'
Seed routine creating test `auth.users` + `profiles`, teams, tasks, events, announcements mirroring the mockup.

**AC:** `supabase db reset` yields a populated `leaderboard`; one login per role exists for testing.
BODY

issue "6.1 Per-role RLS test suite" "Epic 6 — Testing" "backend,testing,rls,ready-for-human" <<'BODY'
A test user per role; assert each role reads/writes exactly what spec §4.3 allows (pgTAP via `supabase test db`).

**AC:** `voluntar` can't read others' trackers; `bc` sees Interne; suppressed notifications hidden; suite green locally.
BODY

issue "6.2 Points-engine tests" "Epic 6 — Testing" "backend,testing,ready-for-agent" <<'BODY'
Grading, penalties, re-grading, sanctions, and leaderboard/dept_cup correctness. Built together with 1.4.

**AC:** deterministic points for known difficulty/rating combos; penalties/sanctions reduce totals.
BODY

issue "7.1 CI: staging secrets + auto db push on merge" "Epic 7 — Deploy & CI" "backend,ci,ready-for-human" <<'BODY'
The CI workflow (.github/workflows/ci.yml) landed with the foundation. Remaining: create the staging project (0.3), then set `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` repo secrets so merges to main push migrations to staging.

**AC:** a PR breaking a policy fails CI; a green merge updates staging automatically.
BODY

issue "7.2 Production Supabase (Pro) + gated promotion" "Epic 7 — Deploy & CI" "backend,ci,needs-triage" <<'BODY'
Supabase Pro project (EU) with Spend Cap ON + daily backups; migrations promoted to prod via a manual gated step. Created in Sprint 3, before real data.

**AC:** prod on Pro; spend cap verified; documented one-command migration promotion.
BODY

issue "8.1 Frontend mini-spec + scaffold" "Epic 8 — Frontend foundation" "frontend,ready-for-human" <<'BODY'
Short spec (folder structure, routing, data-layer conventions, theming tokens from the mockup), then scaffold `app/`: Vite + React + TypeScript + Ionic + ESLint/Prettier + Vitest. ADR-0002 fixes the stack; the mockup fixes the UX.

**AC:** `npm run dev` serves the shell; `npm run build` + `npm test` pass in CI.
BODY

issue "8.2 Auth + app shell" "Epic 8 — Frontend foundation" "frontend,auth,ready-for-human" <<'BODY'
Login (magic link + Google), session handling, role-gated navigation (sidebar desktop / tabs mobile), light/dark OSUBB theming.

**AC:** an invited demo user logs in via magic link; nav shows exactly the screens the role allows (mirrors mockup `OSUBB.access`).
BODY

issue "8.3 Data layer (typed client + query conventions)" "Epic 8 — Frontend foundation" "frontend,ready-for-agent" <<'BODY'
Typed supabase-js client, generated DB types (`supabase gen types` as an npm script), TanStack Query conventions (query keys, error/loading), AG Grid Community wrapper.

**AC:** a sample query renders live rows from local Supabase with generated types.
BODY

issue "9.1 Screen: Task Tracker (demo gate)" "Epic 9 — Screens" "frontend,ready-for-human" <<'BODY'
Grid (sort/filter), create task (+ scoring-guide button), grade -> ledger, claim `open` tasks, task requests + approval flow.

**AC:** spec §5 mapping works end-to-end for every role; grading updates the leaderboard.
BODY

issue "9.2 Screen: Dashboard (demo gate)" "Epic 9 — Screens" "frontend,ready-for-human" <<'BODY'
Greeting, own points/tier/rank + "Ești la Z puncte…" message, mini-leaderboard, dept cup, upcoming events, recent announcements.

**AC:** numbers match `member_points` / `leaderboard` / `dept_cup` for the demo users.
BODY

issue "9.3 Screen: Calendar" "Epic 9 — Screens" "frontend,ready-for-human" <<'BODY'
Month grid colored by department, role-filtered events (`event_read`), RSVP (Vin/Nu pot veni), call types, "Evenimente viitoare" zone.

**AC:** each role sees exactly the events §4.4 allows; RSVP writes `event_attendance`.
BODY

issue "9.4 Screen: Announcements + notifications" "Epic 9 — Screens" "frontend,ready-for-human" <<'BODY'
Feed with priority styling, critical red pop-ups until read, mark-as-read; in-app notification center.

**AC:** a critical announcement pops up until read; suppressed kinds never appear for bc/bce.
BODY

issue "9.5 Screen: Volunteers directory" "Epic 9 — Screens" "frontend,ready-for-human" <<'BODY'
HR-style searchable directory (level >= 5), member detail, edit.

**AC:** level < 5 cannot open the screen or read directory rows.
BODY

issue "9.6 Screen: BC Panel" "Epic 9 — Screens" "frontend,ready-for-human" <<'BODY'
Task-request approvals, award points / sanction (reason + notification), role management (writes `role_history`), CSV import UI (calls 4.1). BC to validate scope (Direcții 6).

**AC:** a sanction writes a 'sanction' ledger row + notification; role changes write `role_history`.
BODY

issue "9.7 Screen: Profile" "Epic 9 — Screens" "frontend,ready-for-human" <<'BODY'
Own info, tier progress, teams, "Demisie AG" placeholder (P3), theme toggle.

**AC:** a member edits own contact fields only (RLS enforced).
BODY

issue "10.1 Cloudflare Pages deploy (staging + prod)" "Epic 10 — Launch ops" "ci,frontend,ready-for-human" <<'BODY'
Staging + production environments, SPA routing config, env vars (anon key/url), deploy on merge.

**AC:** staging URL serves the app against staging Supabase; production is a separate env.
BODY

issue "10.2 BC/BCE data migration" "Epic 10 — Launch ops" "backend,ready-for-human" <<'BODY'
Import the real leadership task sheet (Google Sheets export -> script) into `tasks`/`points_ledger`.

**AC:** totals in the app match the current sheet for every BC/BCE member (sign-off from Alex).
BODY

issue "10.3 BC/BCE onboarding (go-live Oct 1)" "Epic 10 — Launch ops" "docs,ready-for-human" <<'BODY'
Invite the ~20 BC/BCE members (magic links), 1-page quickstart (RO), collect first-week feedback.

**AC:** every BC/BCE member has logged in at least once by Oct 8.
BODY

issue "10.4 Org-wide rollout (Phase 2)" "Epic 10 — Launch ops" "backend,needs-triage" <<'BODY'
Recruit CSV onboarding during the recruitment campaign, promotion engine live (1.9), notification prefs.

**AC:** >=80% of active members have accounts by Dec 1.
BODY

echo "Done. Review the issues at: $(gh repo view --json url -q .url)/issues"
