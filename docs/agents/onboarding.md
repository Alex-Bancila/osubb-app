# Agent Onboarding — continue from here

You are picking up a project mid-flight. This file gets you from zero context to productive on one ≤1h issue without asking a human anything. It complements `CLAUDE.md` (auto-loaded rules) with the *why*, the *what exists*, and the *patterns to copy*.

## Read order (≈15 min of context)

1. `CLAUDE.md` — rules + status (you likely already have it).
2. `CONTEXT.md` — the ubiquitous language. Use these exact terms everywhere.
3. `docs/adr/0001…0008` — the locked decisions (Supabase+RLS · browser-first shadcn PWA · invite-only auth · promotion policy · browser-first rollout · data retention · Task Tracker lifecycle · Calendar visibility). ADR-0007 (amended 2026-09-10) and ADR-0008 are authoritative for Tracker/Calendar. Never contradict one silently.
4. `docs/backend/implementation-issues.md` — the backlog map (issue numbers ↔ epics).
5. `docs/roadmap.md` — sprint calendar, success metrics, deferred-decisions log.
6. The architecture spec `docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md` — **don't read it linearly**; jump to the section your issue cites (§3.x schema DDL, §4.x RLS matrix + policy sketches, §5.x edge functions, §9 Revision 3 = the newest truth).
7. The issue you're working: `gh issue view <n>` — every open issue carries Goal/Why/How/AC/Est/Depends.
8. `docs/README.md` — the index of every document in this repo, marked authoritative or historical, with one line on what still holds. When two documents disagree, it says which one wins.

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
│   ├── 20260819172728_tasks_points_policies.sql # policies: tasks/task_assignees/points_ledger/
│   │                                            # task_requests · helpers is_assigned()/in_my_dept()
│   ├── 202608222*                       # the v1 tables and their policies: events+event_attendance ·
│   │                                    # announcements+announcement_reads · notifications ·
│   │                                    # notif_suppression (bc+bce)+push_tokens · provision_profile()
│   │                                    # · reference/teams reads · profiles column grants +
│   │                                    # profiles_directory/profiles_contact · calendar visibility
│   ├── 20260823*                        # member_level() · auth_is_member() required on all 14
│   │                                    # member-facing policies (the claimless audit)
│   ├── 20260908083829…20260909151741_project_*.sql (7 files)   # Projects (#268–#274): schema ·
│   │                                    # memberships · lead/Responsible invariants ·
│   │                                    # private-schema authorization helpers
│   │                                    # (`private.can_manage_project_work` et al.) · read
│   │                                    # policies · BC/Moderator lifecycle + lead-only membership
│   │                                    # commands
│   ├── 20260910140508_grants_hardening.sql   # #363: closes default execute grants, pins
│   │                                         # search_path on the JWT helpers, drops the dead
│   │                                         # in_my_dept() helper
│   ├── 20260910144803…20260910210000_scope_team_policies.sql  # Teams (#276–#280): Independent
│   │                                    # Teams allowed · the legacy single-lead model retired ·
│   │                                    # actor-derived Independent-/Department-Team membership
│   │                                    # commands · department-membership hardening · scoped
│   │                                    # Team discovery and creation (`private.can_read_team` et
│   │                                    # al.) — this range also contains #310, below
│   ├── 20260910173341_departments_diverse_secretariat.sql   # #310: Diverse (hosting the IT and
│   │                                                        # Interne Department Teams) and
│   │                                                        # Secretariat replace the legacy 'it'
│   │                                                        # department; both excluded from the
│   │                                                        # Department Cup
│   └── 20260911003013_revoke_trigger_function_execute.sql   # #365: no function in public/private
│                                        # is executable by anon, trigger functions included; backs
│                                        # the machine-checked conventions sweep
│                                        # (`supabase/tests/conventions.test.sql`). Read
│                                        # `docs/backend/conventions.md` before writing your first
│                                        # migration — it is binding on shape, naming, and grants.
├── functions/invite-member/     # the only Deno code, and the only way an account is created:
│                                # deps.ts (the injectable port) · handler.ts (all the logic) ·
│                                # index.ts (six lines of wiring) · handler.test.ts (11 tests)
├── seed.sql                     # demo data: 8 logins (parola123) · 16 tasks · 7 events ·
│                                # 5 announcements. Re-runnable — staging gets this same file.
└── tests/                       # pgTAP suites; run `npx supabase test db` for pass/fail, or
                                 # `ls supabase/migrations | wc -l` / `ls supabase/tests/*.test.sql
                                 # | wc -l` for the live migration/suite counts — don't hardcode
                                 # either number here, it's stale the day it's written
    ├── points_engine · auth_claims · provision_profile · member_level      # functions & triggers
    ├── events_attendance · announcements · notifications ·
    │   notif_suppression · demo_seed                                       # tables & seeded data
    ├── rls_deny_by_default · rls_tasks_points · rls_profiles_read ·
    │   rls_events · rls_announcements · rls_teams_reference                # policy matrix per role
    └── projects_schema · project_members_schema · project_authorization_helpers ·
        project_read_policies · project_lifecycle_commands · project_membership_commands ·
        teams_schema · team_policies · departments_reference · conventions             # …and more;
                                                                                        # this list
                                                                                        # is not exhaustive
```

Also: `.github/workflows/ci.yml` (PR = fresh db + all tests + Deno checks + a seed re-runnability check; merge to main = auto `db push` to staging), `.github/workflows/seed-staging.yml` (manual: puts the demo data on staging — `db push` never carries `seed.sql`), `scripts/` (`create-github-issues.sh` is a guarded historical one-shot — never re-run; `check-seed-rerunnable.sh` is the local seed re-runnability check named in `docs/backend/seeding-staging.md`), `mockup/` (the clickable HTML prototype — historical now that `app/` is the real frontend; kept for provenance of tokens, logos, and the original click-through flows, see `docs/README.md`), `docs/org/` (mandate requirements in Romanian), `docs/team/` (operating model). The frontend lives in `app/` (start with `app/README.md`); its Ionic code is temporary per ADR-0002, and new screens use shadcn + TanStack Table.

## Patterns to copy (don't invent, imitate)

| You're writing… | Copy from |
|---|---|
| a schema migration | `20260812184706_tasks_and_requests.sql` (tables + indexes + RLS enable + header comment) |
| a trigger / definer function | `20260819160713_points_engine.sql` (search_path='', qualified names, upsert-on-partial-index) |
| RLS policies | `20260819172728_tasks_points_policies.sql` (+ its recursion-breaking helpers) |
| pgTAP schema tests | `points_engine.test.sql` (fixtures via auth.users+profiles, plan(N), rollback) |
| per-role RLS tests | `rls_tasks_points.test.sql` (the `pg_temp.login()` JWT simulator — reuse it) |
| an Edge Function | `functions/invite-member/` — logic in `handler.ts` behind a `Deps` port, `index.ts` only wires the real clients, so every path is testable without a server |
| a frontend screen | `app/src/screens/calendar/` for the query + three-states pattern; build new screens with shadcn per ADR-0002, never Ionic or AG Grid |

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

## Queue snapshot (historical, 2026-08-23 — `CLAUDE.md` holds the current queue)

Done since the last update and merged: the v1 tables (#43–#46) · the provisioning RPC (#56) · the invite Edge Function and its end-to-end proof (#57, #58) · every policy that has landed so far (#59 profiles, #61 reference/teams, #62 calendar, #64 announcements, #129 the claimless audit) · the demo seed (#74–#76) · the frontend mini-spec (#79).

1. **#80 → #81** — scaffold `app/` (Vite + React + TypeScript + Ionic, per the mini-spec), then give it CI. First frontend code in the repo, and the point at which the demo becomes clickable.
2. The remaining policies: **#60** (self-edit + role-change guard) · **#63** (RSVP) · **#65** (notifications + suppression) · **#66** (Interne gating), then the **#67** final cross-role sweep.
3. **#47 → #48** (AG views), and **#68** (notification fan-out) once #65 lands.
4. Then the screens, in mockup order: **#83** (login) → **#85** (the three session states) → **#88–#92** (tracker) → **#93–#95** (dashboard) → the rest of Epic 9.

Always confirm against live state: `gh issue list --label max-1h --state open`. Dependencies are stated in each issue body — don't start a blocked one.

## Known traps

- **Suppression is bc + bce** (spec Revision 3 §9.2). Spec §3.4's `insert into notif_suppression values ('bc',…)` is superseded — seeding bc-only fails review.
- **`to authenticated` is not "a member".** A session can be authenticated with **no org claims** (never invited, or deactivated since its token was issued — ADR-0003 gate 2). `auth_level()` cannot tell them apart from a recrut, who is also level 0, and **`auth.uid()` cannot either** — a deactivated member keeps their uid *and* their `profiles` row. Any "every member may do this" policy uses **`auth_is_member()`**; `using (true)` is a bug, and so is any disjunct that never mentions the caller (`or status = 'open'`, `or scope = 'org'`). An audit on 2026-08-23 found 12 policies written this way — one of which let a deactivated member join an open graded task and have the ledger trigger **award them points** (migration `20260823140923_require_membership_policies.sql`). The claimless sweep in `rls_deny_by_default.test.sql` now fails, naming the table, if it comes back.
- **A column-level `revoke select (col)` is a no-op** while the role still holds table-wide SELECT — a table grant implies every column. Revoke the table grant, then grant the safe columns back (see `20260822225003_profiles_read_policies.sql`).
- **`reset role` does not clear the JWT.** In per-role tests, the previous `pg_temp.login()` claims survive, so a "stranger sees nothing" block silently runs as the last persona and passes for free. Clear it: `select set_config('request.jwt.claims', '', true);`
- **A write denied by RLS is not always an error.** INSERT without a matching policy raises 42501; UPDATE/DELETE without one matches zero rows and returns *silently*. Assert the value is unchanged, not `throws_ok`.
- **Policies should not depend on other tables' policies.** Use a `security definer` helper (`is_assigned`, `private.can_read_team`, `private.can_manage_project_work`) so narrowing one table later cannot silently change another table's visibility.
- **Conventions are written down:** `docs/backend/conventions.md` — read it before your first migration.
- **`profiles_contact` is deliberately owner-rights** (one of the two exceptions to house rule 3, alongside `member_points`) because it re-exposes columns revoked from `authenticated`. Its WHERE clause is the security boundary — don't "fix" it to `security_invoker`, that breaks it for everyone it serves.
- **Never open a stacked PR.** This cost two recoveries (#126, #137). A PR whose base is another feature branch is retargeted to `main` only when that base branch is **deleted** — merging the base is not enough, and neither is waiting. The stacked PR then merges *into the still-existing feature branch*: it reads "Merged", CI is green, the issue stays open, and `main` silently lacks the code. Nothing about the UI says anything is wrong. If work depends on unmerged work, **put both in one PR**, or wait for the base to land on `main` before opening the next one. It is never worth the recovery.
- `rating_mult()` already exists (migration 3) — don't recreate it.
- Enabling RLS on a table read by the auth hook without a `supabase_auth_admin` policy breaks logins — the four needed policies already exist (migration 4); keep the pattern for any new hook-read table.
- Views without `security_invoker = on` silently bypass RLS. The deny-by-default test suite has a guard that fails any new RLS-less table — that's intentional; fix the table, not the test.
- **`seed.sql` fills every table, and it runs in CI too** (`supabase start` seeds). Any suite that counts rows exactly must `truncate` the tables it owns at the top of its transaction — see `rls_events.test.sql`. An assertion like "a recrut sees four events" is a claim about that file's fixtures, not about the demo calendar; without the truncate it breaks the next time the seed grows, and someone eventually "fixes" the assertion instead of the policy.
- **`db push` deploys migrations only — it has never carried `seed.sql`.** Merging the whole demo dataset therefore changed nothing on staging, whose deploy log cheerfully read *"Remote database is up to date"* while the project sat there with the full schema and zero rows (#139). Demo data reaches staging only through the manual **Seed staging demo data** workflow, which applies the file with `psql`. Consequence for anyone editing the seed: it must stay **re-runnable against a live database** — it clears the `@demo.osubb` cohort before re-inserting it, and a CI step applies it twice and compares a content fingerprint. A seed that only works on an empty database is one staging cannot use. See `docs/backend/seeding-staging.md`.
- Windows: "port not available" on supabase start → admin PowerShell `net stop winnat && net start winnat`.
- The CI job "Push migrations to staging" **skipping on PRs is correct** (deploys happen on merge). Skipping *on main* with "secrets not configured" would mean the repo secrets are broken — investigate, don't ignore.

## Humans-only (never attempt as an agent)

Merging PRs · anything in a browser dashboard (Supabase staging/prod settings — #54, #77; Cloudflare — #109) · creating accounts/tokens · BC decisions (scoring guide, Membru Activ threshold) · running one-shot import scripts against production (#112).
