# Agent Onboarding — continue from here

You are picking up a project mid-flight. This file gets you from zero context to productive on one ≤1h issue without asking a human anything. It complements `CLAUDE.md` (auto-loaded rules) with the *why*, the *what exists*, and the *patterns to copy*.

## Read order (≈15 min of context)

1. `CLAUDE.md` — rules + status (you likely already have it).
2. `CONTEXT.md` — the ubiquitous language. Use these exact terms everywhere.
3. `docs/adr/0001…0006` — the six locked decisions (Supabase+RLS · React/Ionic/Capacitor · invite-only auth · promotion policy · rollout strategy · data retention). Never contradict one silently.
4. `docs/backend/implementation-issues.md` — the backlog map (issue numbers ↔ epics).
5. `docs/roadmap.md` — sprint calendar, success metrics, deferred-decisions log.
6. The architecture spec `docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md` — **don't read it linearly**; jump to the section your issue cites (§3.x schema DDL, §4.x RLS matrix + policy sketches, §5.x edge functions, §9 Revision 3 = the newest truth).
7. The issue you're working: `gh issue view <n>` — every open issue carries Goal/Why/How/AC/Est/Depends.

## What exists (the codebase tour)

```
supabase/
├── config.toml                  # local auth config: signup OFF, JWT hook ON
├── migrations/
│   ├── 0001_core_schema.sql             # enums · roles(8, with levels) · departments ·
│   │                                    # rating/difficulty guides · profiles · member_departments ·
│   │                                    # teams · team_members (+ reference data seeded here)
│   ├── 20260812184706_tasks_and_requests.sql   # tasks (points = generated column via rating_mult) ·
│   │                                           # task_assignees · task_requests · RLS enabled
│   ├── 20260819160713_points_engine.sql        # points_ledger · grading triggers (sync_task_ledger,
│   │                                           # sync_assignee_ledger) · views member_points/
│   │                                           # leaderboard/dept_cup (security_invoker)
│   ├── 20260819163238_jwt_claims_hook.sql      # custom_access_token_hook (stamps role/level/depts/teams)
│   │                                           # · auth_level()/auth_role()/auth_in_dept()/auth_in_team()
│   │                                           # · supabase_auth_admin grants + dormant read policies
│   ├── 20260819171628_capabilities_and_rls.sql # role_capabilities (17 rows from level thresholds) ·
│   │                                           # RLS enabled on ALL tables · grant normalization
│   │                                           # (anon = nothing; no TRUNCATE for clients)
│   └── 20260819172728_tasks_points_policies.sql # policies: tasks/task_assignees/points_ledger/
│                                                # task_requests · helpers is_assigned()/in_my_dept()
├── seed.sql                     # EMPTY on purpose until issues #74–#76 (demo data)
└── tests/                       # pgTAP; run via `npx supabase test db`
    ├── points_engine.test.sql       # 26 tests — the formula, triggers, views
    ├── auth_claims.test.sql         # 17 tests — hook + helpers + privileges
    ├── rls_deny_by_default.test.sql # 30 tests — zero rows everywhere, grants posture
    └── rls_tasks_points.test.sql    # 28 tests — four simulated personas vs the policy matrix
```

Also: `.github/workflows/ci.yml` (PR = fresh db + all tests; merge to main = auto `db push` to staging), `scripts/` (historical one-shots — never re-run), `mockup/` (the clickable HTML prototype = UX source for Epic 9 screens), `docs/org/` (mandate requirements in Romanian), `docs/team/` (operating model). **There is no `app/` yet** — the frontend starts at issue #79.

## Patterns to copy (don't invent, imitate)

| You're writing… | Copy from |
|---|---|
| a schema migration | `20260812184706_tasks_and_requests.sql` (tables + indexes + RLS enable + header comment) |
| a trigger / definer function | `20260819160713_points_engine.sql` (search_path='', qualified names, upsert-on-partial-index) |
| RLS policies | `20260819172728_tasks_points_policies.sql` (+ its recursion-breaking helpers) |
| pgTAP schema tests | `points_engine.test.sql` (fixtures via auth.users+profiles, plan(N), rollback) |
| per-role RLS tests | `rls_tasks_points.test.sql` (the `pg_temp.login()` JWT simulator — reuse it) |
| an Edge Function | none yet — #57 creates the first; follow Supabase docs + spec §5.1 |

## The work loop

```bash
git checkout main && git pull
git checkout -b feat/<code>-<slug>          # e.g. feat/1.5a-events
# … build per the issue's How steps …
npx supabase db reset && npx supabase test db   # BOTH green, always
git add -A && git commit -m "feat(db): <what> (<code>)"
git push -u origin <branch>
gh pr create --title "<code> <title>" --body "…\n\nCloses #<n>"
gh pr checks <pr> --watch                    # CI green, then a HUMAN merges
```

Definition of done = migration applies on reset · tests pass and would fail without the feature · CI green · the issue's AC boxes checked · PR closes the issue. After merge: staging updates itself; delete the branch.

## Current queue (as of 2026-08-22)

Done since the last update: #43–#46 (v1 tables), #56 (provisioning RPC), #61 (reference/teams policies) — merged. In review as a stack: #122 → #124 → #125 (profiles, announcements, calendar policies).

1. **#57 → #58** — the invite chain. First Deno/Edge Function in the repo; #58 proves the magic link end-to-end in Mailpit and writes the BC runbook. Unblocks human task #54.
2. **#60** (self-edit + role guard, needs #122 merged) · **#63** (RSVP, needs #125) · **#65** (notifications + suppression) · **#123** (apply `auth_is_member()` to the reference-data policies).
3. **#47 → #48** (AG views) then **#66**; **#68** (fan-out) once #65 lands.
4. Sprint 2: **#74 → #75 → #76** (demo seed) and **#79 → #80 → #81** (frontend scaffold), then the screens.

Always confirm against live state: `gh issue list --label max-1h --state open`. Dependencies are stated in each issue body — don't start a blocked one.

## Known traps

- **Suppression is bc + bce** (spec Revision 3 §9.2). Spec §3.4's `insert into notif_suppression values ('bc',…)` is superseded — seeding bc-only fails review.
- **`to authenticated` is not "a member".** A session can be authenticated with **no org claims** (never invited, or deactivated since its token was issued — ADR-0003 gate 2). `auth_level()` cannot tell them apart from a recrut, who is also level 0, and **`auth.uid()` cannot either** — a deactivated member keeps their uid *and* their `profiles` row. Any "every member may do this" policy uses **`auth_is_member()`**; `using (true)` is a bug, and so is any disjunct that never mentions the caller (`or status = 'open'`, `or scope = 'org'`). An audit on 2026-08-23 found 12 policies written this way — one of which let a deactivated member join an open graded task and have the ledger trigger **award them points** (migration `20260823140923_require_membership_policies.sql`). The claimless sweep in `rls_deny_by_default.test.sql` now fails, naming the table, if it comes back.
- **A column-level `revoke select (col)` is a no-op** while the role still holds table-wide SELECT — a table grant implies every column. Revoke the table grant, then grant the safe columns back (see `20260822225003_profiles_read_policies.sql`).
- **`reset role` does not clear the JWT.** In per-role tests, the previous `pg_temp.login()` claims survive, so a "stranger sees nothing" block silently runs as the last persona and passes for free. Clear it: `select set_config('request.jwt.claims', '', true);`
- **A write denied by RLS is not always an error.** INSERT without a matching policy raises 42501; UPDATE/DELETE without one matches zero rows and returns *silently*. Assert the value is unchanged, not `throws_ok`.
- **Policies should not depend on other tables' policies.** Use a `security definer` helper (`is_assigned`, `in_my_dept`, `team_admits_recruits`) so narrowing one table later cannot silently change another table's visibility.
- **`profiles_contact` is deliberately owner-rights** (the one exception to house rule 3) because it re-exposes columns revoked from `authenticated`. Its WHERE clause is the security boundary — don't "fix" it to `security_invoker`, that breaks it for everyone it serves.
- **Don't stack PRs unless you must, and never merge a stack quickly.** A PR whose base is another feature branch is retargeted to `main` only *after* its base merges, and not instantly. Three stacked PRs merged inside 32 seconds on 2026-08-22 put two of them into their base branches instead of `main`: both showed "Merged" with green CI, while `main` silently lacked the code (recovered by PR #126). If a branch must build on unmerged work, merge the base, **confirm the next PR now targets `main`**, then merge it — or avoid the stack by waiting.
- `rating_mult()` already exists (migration 3) — don't recreate it.
- Enabling RLS on a table read by the auth hook without a `supabase_auth_admin` policy breaks logins — the four needed policies already exist (migration 4); keep the pattern for any new hook-read table.
- Views without `security_invoker = on` silently bypass RLS. The deny-by-default test suite has a guard that fails any new RLS-less table — that's intentional; fix the table, not the test.
- `seed.sql` is empty until #74 — tests must create their own fixtures inside a rolled-back transaction (see any existing test file).
- Windows: "port not available" on supabase start → admin PowerShell `net stop winnat && net start winnat`.
- The CI job "Push migrations to staging" **skipping on PRs is correct** (deploys happen on merge). Skipping *on main* with "secrets not configured" would mean the repo secrets are broken — investigate, don't ignore.

## Humans-only (never attempt as an agent)

Merging PRs · anything in a browser dashboard (Supabase staging/prod settings — #54, #77; Cloudflare — #109) · creating accounts/tokens · BC decisions (scoring guide, Membru Activ threshold) · running one-shot import scripts against production (#112).
