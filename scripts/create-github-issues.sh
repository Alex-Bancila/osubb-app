#!/usr/bin/env bash
# Create the OSUBB backend labels, milestones, and issues on GitHub.
#
# Prerequisites:
#   1. Create the GitHub repo and add it as a remote:
#        gh repo create osubb-app --private --source=. --remote=origin --push
#      (or create it in the GitHub UI, then `git remote add origin <url>`)
#   2. Be authenticated: `gh auth status`
#
# Run ONCE (gh issue create is not idempotent — re-running duplicates issues):
#   bash scripts/create-github-issues.sh
#
# Mirrors docs/backend/implementation-issues.md. Foundation issues 0.1/0.2/1.1/1.2/5.1
# are already delivered in the repo, so they are intentionally NOT created here.

set -euo pipefail

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
`notifications`, `notif_suppression` (seed: bc × task/event/deadline), `push_tokens`.

**AC:** three BC suppression rows exist; `push_tokens` unique per (member, token). Spec §3.4.
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

issue "4.2 Edge Function: push dispatch (OneSignal)" "Epic 4 — Edge Functions" "backend,edge-function,ready-for-human" <<'BODY'
On new announcement/deadline: compute recipients, drop role-suppressed kinds, write `notifications`, call OneSignal REST with role/dept tags.

**AC:** a `task` notification is never delivered to a `bc` member; in-app rows match the delivered set. Spec §5.2.
BODY

issue "4.3 (Optional) Promotion suggestions job" "Epic 4 — Edge Functions" "backend,edge-function,needs-triage" <<'BODY'
Flag members crossing a tier threshold for BC review — manual-first, no auto-promote.

**AC:** a member crossing 300 pts appears in a "suggested for AG" list; no role changes automatically.
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
Grading, penalties, re-grading, and leaderboard/dept_cup correctness.

**AC:** deterministic points for known difficulty/rating combos; penalties reduce totals.
BODY

issue "7.1 CI: migrations + tests on PR, push to staging" "Epic 7 — Deploy & CI" "backend,ci,ready-for-human" <<'BODY'
GitHub Actions: on PR spin up Postgres, apply migrations, run Epic-6 tests; on merge to main `db push` to staging.

**AC:** a PR breaking a policy fails CI; a green merge updates staging automatically.
BODY

issue "7.2 Production Supabase (Pro) + gated promotion" "Epic 7 — Deploy & CI" "backend,ci,needs-triage" <<'BODY'
Supabase Pro project with Spend Cap ON + daily backups; migrations promoted to prod via a manual gated step.

**AC:** prod on Pro; spend cap verified; documented one-command migration promotion.
BODY

echo "Done. Review the issues at: $(gh repo view --json url -q .url)/issues"
