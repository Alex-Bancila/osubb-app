# Group model — Wave 1 (schema, backfill, mirroring, claims) + issue graph (2026-09-18)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Executed task-by-task (one implementer per task, task review after each, one whole-wave review at the end). Steps use `- [ ]` syntax. Alex merges each PR once review and CI are green (standing instruction: merge as you go, no draft chains).

**Goal:** Land Wave 1 of ADR-0009 — the `groups` / `group_members` model with its settings, backfilled from the six legacy structure tables and kept in sync while those tables remain the write master, plus the `group_ids` organization claim — and bring the GitHub issue graph in line with the ADR (edit the issues it names, file the Wave 1 issues, file Wave 2/3 umbrellas).

**Architecture:** _Shadow model, legacy-mastered._ Wave 1 adds the new tables and their read policies, backfills them, and mirrors every legacy write into them through triggers, so nothing that exists today changes behavior: every pgTAP fixture that inserts into `member_departments`, `teams`, `projects`, … keeps working, every FK stays, and the 21 Task commands are untouched. Wave 2 flips the authority helpers and commands to read Groups; Wave 3 flips mastership (Group commands + Administrare), drops the legacy tables and level 4. This is a refinement of the ADR's "read-only compatibility views" wording: views cannot be FK targets and would break ~97 fixture suites on day one, so the views arrive in Wave 3 where the tables are dropped.

**Tech stack:** Supabase (PostgreSQL 15, RLS, pgTAP), migrations via `npx supabase migration new`, `scripts/check-local-ci.sh` (24 gates), `gh` for the issue graph.

**Spec:** `docs/adr/0009-groups.md` (authoritative), `CONTEXT.md` (glossary terms Group, Child Group, Group Category, Minimum Level, Group Role, Group Manager, Group Responsible, Appointment, Application, Application Level, Shared Work Visibility, Automatic Membership, Organization Group), `docs/backend/conventions.md` (binding on every migration).

## Context

Alex ran a grilling session on 2026-09-18 that produced ADR-0009 (merged as PR #502): Departments, Teams, Projects and the Adunarea Generală become one `Group` entity with settings instead of kinds, three Group Roles everywhere, a seven-rank ladder with level 4 retired, and a three-wave strangler migration. This plan is Wave 1 plus the issue-graph work the ADR's Consequences section lists. Wave 2 (authority helpers + commands) and Wave 3 (frontend, Administrare, cleanup) get their own plans once Wave 1 is on `main`.

### Verified facts that shape the tasks (origin/main @ f830497, after #502)

- **105 migrations**, latest `20260917133540_visible_task_executors.sql`; **93 pgTAP suites**; no `ltree`, no `slug`, no recursive CTE, no `create extension` anywhere — a `bigint[]` path column maintained by trigger is the least novel way to store ancestry.
- **Legacy tables today:** `departments(id text, name, short, color, kind text default 'department')` — rows `edu, pr, youth, fin, hr` = `department`, `diverse, secretariat` = `coordination`, `org` = `org` (a pseudo-department that becomes the Organization Group); `teams(id text, name, dept_id text null, is_interne bool)` (`lead_id`, `for_recruits` already dropped); `projects(id bigint identity, name, status, leader_id, created_by, created_at, updated_at)`; `project_members(project_id, member_id, project_role in (member, responsible), created_at)`; `member_departments(member_id, dept_id)`; `team_members(team_id, member_id)`; `campaigns(id, department_id, name, is_active, created_by, created_at, updated_at)`.
- **Writers of the legacy tables** (all keep working, all fire the new mirror triggers): `provision_profile` (service_role) writes `member_departments` + `team_members`; **`member_departments` is also written by direct client DML** under policy `member_departments_manage` (BC/Moderator), and **`teams` inserts are client DML** under `teams_create` — the two tables with no command wrapper; `add/remove_department_team_member`, `add/remove_independent_team_member`, `create_project`, `archive_project`, `add/remove_project_member`, `grant/revoke_project_responsible` are commands; `projects_sync_leader_membership` trigger inserts the leader's `project_members` row; `seed.sql` re-runs by **delete-then-insert** of the demo cohort (teams, projects, campaigns deleted and recreated; rosters cascade), never `on conflict`.
- **FKs into the legacy tables** (untouched by Wave 1): `tasks.dept_id/team_id/project_id/campaign_id`, `events.dept_id/project_id` and the **deferrable composite** `events(team_id, dept_id) → teams(id, dept_id)`, `announcements.dept_id`, `completed_work_requests.dept_id/team_id/project_id`, `campaigns.department_id`, `private.legacy_team_leads.team_id`.
- **Claims:** `custom_access_token_hook` (`20260819163238`, never redefined) emits `member_role, member_level, dept_ids, team_ids`; `auth_in_dept/auth_in_team` have **zero live callers** (every policy already reads live `private.*` helpers), so `group_ids` + `auth_in_group(bigint)` ship as claims helpers with no consumers yet. Pins to bump: `grants_hardening.test.sql` "all five JWT helpers" (5 → 6), `tracker_grants.test.sql` `expected_function_privs`, `rls_deny_by_default.test.sql` "exactly 4 auth_admin_read policies" (→ 6), `auth_claims.test.sql` literal claim object, `_helpers.sql` `test_login_leadership` (the one place `group_ids` must be derived so every suite matches the real token).
- **Fixture blast radius (why shadow, not views):** 44 suites insert into `member_departments`, 37 into `teams`, 29 into `projects`, 25 into `team_members`, 19 into `project_members`, 12 into `campaigns`.
- **Test gates that self-discover new objects:** `rls_deny_by_default.test.sql` asserts every `public` table has RLS, holds ≥ 1 fixture row (fixture block :27-125) and is invisible claimless; `tracker_grants.test.sql` pins the closed roster `pinned_private_functions` (**count 89**; add `(proname, args, category)` rows, bump `plan(N)`); `conventions.test.sql` (10 checks: definer `search_path=""`, no `anon` execute, no `authenticated` execute on trigger/`require_*`, `security_invoker` views, no `anon`/`service_role` usage on `private`).
- **Seed gates:** `scripts/seed-fingerprint.sql` fingerprints 5 of the 7 legacy tables (not `departments`, `team_members`) and must gain `groups`/`group_members` lines; `scripts/check-seed-rerunnable.sh` inserts a sentinel profile with **`role = 'responsabil'`** and cleans up only `task_assignments, tasks, projects, auth.users` — mirror triggers must run as owner with `auth.uid()` null, and `group_members` must cascade from `groups`.
- **Frontend touchpoints in Wave 1:** `app/src/lib/auth.tsx` `MemberClaims` (+ four test fixtures that spell out claims), `app/src/lib/database.types.ts` regenerated with `cd app && npm run gen:types` (CI diffs it byte-for-byte). `reference.ts`, `completed-work-requests.ts`, `task-opportunities.ts` read the legacy tables and stay as they are until Wave 3.
- **Historical harnesses:** CI loops `bash supabase/tests/*_upgrade.test.sh` (8 today); the backfill gets a ninth.
- **GitHub:** 73 open issues; **no PR open**; no Groups milestone or label; 16 milestones all open (12-16 are the delivery-order series). Old-format issues (#47-#52, #66, #103, #105, #107 use `**Depends on:**`; #160 uses `**Dependencies**`) need a full house-rule-15 rewrite, not an append; #248's blockers are prose (rule-15 violation); #370 is assigned to dobrerares but has no PR.

## Global constraints

- One issue = one branch = one PR, body `Closes #n`, CI green; PRs open against `main`; Alex merges (house rule 7 — never push to `main` except docs-only commits). Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **GitHub-visible actions need review first**: issue bodies and edits are drafted to files under `.superpowers/sdd/<plan>/issues/`, shown to Alex as a dry run, created/edited only after one go-ahead, in dependency order. `scripts/create-github-issues.sh` is never run (house rule 9).
- Every migration follows `docs/backend/conventions.md`: new tables enable RLS in the creating migration; every `authenticated` policy is unsatisfiable without org claims (house rule 12; the claimless sweep in `rls_deny_by_default.test.sql` must list every new table); `security definer` only in `private`, `set search_path = ''`, fully qualified names, explicit revoke/grant; views `with (security_invoker = on)`; error vocabulary `42501 <scope>_forbidden`, `PT400 invalid_*|*_required`, `PT404 *_not_found`, `PT409 <subject>_<state>`; a parent row is locked `for no key update`, never `for update`.
- **No rule branches on Group category** (ADR-0009). Anything Wave 1 adds that decides visibility, membership or Cup reads settings, never `category`.
- **Legacy tables stay the write master in Wave 1.** No existing command, policy, fixture, seed statement or FK changes meaning. Mirroring is one-directional (legacy → groups) and idempotent, because `seed.sql` must stay re-runnable (CI's seed re-runnability gate).
- Tests ship with the feature in the same PR; a test must fail if the feature is removed; mutation-prove every gate. `npx supabase db reset && npx supabase test db` green, then `bash scripts/check-local-ci.sh` (24 gates) before any PR. Never shell out to `python`; `psql` is absent — use `docker exec -i supabase_db_osubb-app psql -U postgres -d postgres`.
- Never stage the untracked `docs/superpowers/plans/2026-09-11-project-team-role-matrix.md` (another session's file) or the other two untracked plan files.
- Never two database passes at once; never two implementers at once; reviewers are read-only.
- **Verification order per PR** (sequential, never two db passes at once): `npx supabase db reset` → `npx supabase test db` → `for h in supabase/tests/*_upgrade.test.sh; do bash "$h"; done` → `bash scripts/check-seed-rerunnable.sh` → `npx supabase db lint --level warning --fail-on warning` → `cd app && npm run gen:types && npm run typecheck && npm run lint && npm run format:check && npm run test:run` → `git status` shows `database.types.ts` changed only when the public surface changed. `bash scripts/check-local-ci.sh` runs all of it in CI's order.
- **Fixture prefixes and placeholders:** `#A`–`#E` stand for the issue numbers Task 0 creates; fixture UUID prefixes are `<issue>00000-0000-0000-0000-00000000000N` (e.g. `51000000-…` for #510); branches `backend/<issue>-<slug>` (`docs/<issue>-<slug>` for Task 6).

## Rulings on the draft's open points (2026-09-18, recorded so nobody re-litigates them mid-wave)

| Point                                          | Ruling                                                                                                                                                                                                                                                             | Why                                                                                                                                                                                                        | Cost if wrong                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Deviation 1 — sibling-name unique index        | **Partial: native Groups only** (`where legacy_*_id is null`), total in Wave 3 after the drop-legacy migration dedupes names.                                                                                                                                      | `scripts/check-seed-rerunnable.sh:199` inserts a second top-level Project named exactly like the demo one; legacy names were never unique and a legacy-mastered row cannot honour a rule its master lacks. | One `drop index` + `create unique index` in Wave 3. |
| Deviation 2 — `groups.created_by`              | `references public.profiles (id) on delete set null`.                                                                                                                                                                                                              | A Group must outlive its creator; the seed deletes demo profiles after their Projects.                                                                                                                     | None.                                               |
| Deviation 3 — `service_role` grants            | `select` only on `groups` and `group_members`.                                                                                                                                                                                                                     | Nothing but the mirror writes them; the `campaigns` precedent in `tracker_grants.test.sql`.                                                                                                                | A one-line grant later.                             |
| Deviation 4 — auth-admin policy names          | `groups_read_auth_admin`, `group_members_read_auth_admin` (conventions §5).                                                                                                                                                                                        | `auth_admin_read_*` is the grandfathered family; the count assertion is by role, not name.                                                                                                                 | None.                                               |
| (d) `group_ids` and archived Groups            | Included.                                                                                                                                                                                                                                                          | Mirrors `dept_ids`/`team_ids`, which know no status; Wave 2 decides per policy.                                                                                                                            | A `where status = 'active'` in the hook.            |
| (e) `application_level` on backfilled rows     | Pre-filled to the ADR values (Departments 1, Teams/Projects 0, OSUBB null); `accepts_applications` false everywhere.                                                                                                                                               | No Application flow exists before Wave 3; flipping the switch later is one column.                                                                                                                         | None.                                               |
| (f) `manager_title` on Diverse and Secretariat | `'BCE'`, like the five departments.                                                                                                                                                                                                                                | ADR-0009: they share every Department setting except the Cup.                                                                                                                                              | A two-row update.                                   |
| (g) `roles.name` rename                        | Inside Task 2's PR as a second migration file and a second commit.                                                                                                                                                                                                 | Two-line reference-data change; CONTEXT.md already calls the drift out.                                                                                                                                    | None.                                               |
| Task numbering                                 | The issue graph is **Task 0**; the draft's Tasks 1–6 keep their numbers so `scripts/task-brief` finds them. `#A`–`#E` in Tasks 2–6 are the numbers Task 0 creates for N1–N5, in that order; substitute them in this file (docs-only commit) as soon as they exist. | —                                                                                                                                                                                                          | —                                                   |
| Merging                                        | Alex's standing instruction for planned multi-PR work applies: each PR is opened against `main` and merged once its task review is clean and CI is green.                                                                                                          | —                                                                                                                                                                                                          | —                                                   |

## Task order and dependencies

```
Task 0 (issue graph) ---- first; its go-ahead gates every `Closes #n` below
Task 1 (#160 joined_at) ---- independent, merge any time after Task 0 starts
Task 2 (schema + roles rename) -> Task 3 (backfill + harness) -> Task 4 (sync triggers) -> Task 5 (claims) -> Task 6 (docs)
```

Task 5 could technically follow Task 2, but its hook and `_helpers` assertions only mean something once Task 4 mirrors fixture rows; keep it after 4.

---

## Task 0 — Issue graph (GitHub-visible; drafted to files, one go-ahead, created in dependency order)

All bodies are drafted first under `.superpowers/sdd/2026-09-18-group-model-wave-1/issues/` (`milestones.md`, `new-<k>.md`, `edit-<n>.md`), listed to Alex as a dry run (title, labels, milestone, blockers, first lines), and applied only after his go-ahead with `gh api … /milestones -X POST`, `gh issue create --title … --body-file … --label … --milestone …` and `gh issue edit <n> --body-file … --milestone … --add-label …`. Never `scripts/create-github-issues.sh`.

### A1. Three milestones

| Title                                                   | Description                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `Group model — Wave 1: schema and claims`               | ADR-0009 Wave 1: `groups`/`group_members` shadow model, backfill, legacy→Group mirroring, `group_ids` claim.  |
| `Group model — Wave 2: authority and commands`          | ADR-0009 Wave 2: authority helpers and the 21 Task commands read Groups; `tasks.group_id`, `events.group_id`. |
| `Group model — Wave 3: frontend, Administrare, cleanup` | ADR-0009 Wave 3: Group commands, Administrare, frontend on Groups, legacy tables and level 4 dropped.         |

### A2. New issues — creation order

Umbrellas first (Scope paragraphs name child titles; child numbers are filled in by a second `gh issue edit` once the children exist), then the Wave 1 children in lane order so each `## Blocked by` can name the previous number.

| Order | Title                                                                                    | Labels                                                        | Milestone | Blocked by                      |
| ----- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------- | ------------------------------- |
| U1    | `Umbrella: Group model — Wave 1 (schema, backfill, mirroring, claims)`                   | `backend`, `database`                                         | Wave 1    | — (umbrella, no `max-1h`)       |
| U2    | `Umbrella: Group model — Wave 2 (authority helpers and commands read Groups)`            | `backend`, `database`, `rls`                                  | Wave 2    | U1                              |
| U3    | `Umbrella: Group model — Wave 3 (Group commands, Administrare, frontend, cleanup)`       | `backend`, `frontend`                                         | Wave 3    | U2                              |
| N1    | `Groups: create groups and group_members with settings, ancestor path and read policies` | `ready-for-agent`, `backend`, `database`, `rls`, `testing`    | Wave 1    | `None — can start immediately.` |
| N2    | `Groups: backfill from departments, teams, projects and their rosters`                   | `ready-for-agent`, `backend`, `database`, `testing`, `max-1h` | Wave 1    | N1                              |
| N3    | `Groups: mirror legacy structure and roster writes into groups`                          | `ready-for-agent`, `backend`, `database`, `testing`           | Wave 1    | N2                              |
| N4    | `Claims: add group_ids and auth_in_group beside dept_ids and team_ids`                   | `ready-for-agent`, `backend`, `auth`, `frontend`, `max-1h`    | Wave 1    | N3                              |
| N5    | `Docs: Groups Wave 1 conventions, glossary identifiers and status`                       | `ready-for-agent`, `docs`, `max-1h`                           | Wave 1    | N4                              |

Body rules: house rule 15 sections (`## Goal`, `## Why`, `## What to build`, `## Implementation boundary`, `## Acceptance criteria`, `## Required tests`, `## Blocked by`), CONTEXT.md terms, each AC a checkbox that a reviewer can tick from the PR. Umbrellas use the #90 shape: `## Outcome`, `## Scope` (one dense paragraph with inline `#n`), closing sentence "This is an umbrella and does not receive `max-1h`." U2's Scope names: the `private` helper rewrite (`can_manage_origin`, `require_origin_manager`, `can_evaluate_task`, `can_read_task`, `require_request_decider`, `task_managers`, the two roster gates), `tasks.group_id` + `events.group_id` written by the commands, Campaign ownership by any Group, Calendar create/update by Group Role (#370, #248), the no-category-branch check in `conventions.test.sql`, roster pin and smoke-script rewrite. U3's Scope names: Group commands (create/update/archive Group, appoint Group Manager/Responsible, add/remove member, apply, decide Application, Evaluation Periods), the Administrare screen absorbing #103/#104/#105/#107, the 18 `app/src` files and `capabilities.ts` (`manageTasks: 4` removed), BC creating the Adunarea Generală, dropping legacy tables/columns, `event_scope`, `is_interne`, level 4 and the `responsabil` enum value after BC re-ranks its holders.

### A3. Existing issues — edits (one draft file each; full rewrite where the body predates house rule 15)

| Issue                  | Change                                                                                                                                                                                                                                                                  | New blockers / milestone                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| #160                   | Full rule-15 rewrite (currently `**Dependencies** None.`); unchanged scope (`profiles.joined_at date`, backfill Jan 1 of `joined_year`, nullable, types regenerated); note it is the tenure source for ADR-0009's Promotion Rules.                                      | `None — can start immediately.` · milestone Wave 1 |
| #47                    | Retitle `Evaluation Periods: table and current-period Task-Point ranking`; body: BC opens/closes named Periods (AGO to AGO), a ranking view of Task Points inside the current Period; the 300-point `ag_eligibility` view has no successor (ADR-0009 §Promotion hooks). | U3 · milestone Wave 3                              |
| #48                    | Retitle `Vote retention ranking: top y% of the Evaluation Period for BC`; percent is BC-configured, result is shown to BC who withdraws Drept de Vot by hand; nobody is removed automatically.                                                                          | #47, U3 · Wave 3                                   |
| #49                    | `promotion_rules` gains Period-scoped kinds (`top_percent` + tenure) beside `time`; seeds per ADR-0009 (Recrut→Voluntar tenure; Voluntar→Voluntar Activ top x% + tenure); display name Voluntar Activ.                                                                  | #47, U3 · Wave 3                                   |
| #50                    | Keep scope; add that BC's confirmation of Drept de Vot and every withdrawal write `role_history` with the BC actor.                                                                                                                                                     | `None — can start immediately.` (independent)      |
| #51                    | `detect_promotions()` is Period-aware; returns automatic promotions plus a separate "eligible for Drept de Vot" signal that never changes a role.                                                                                                                       | #49, #160, U3 · Wave 3                             |
| #52                    | The job applies only automatic rules; for Vot eligibility it sends the adherence-form notification to the Member and a decision notification to BC.                                                                                                                     | #50, #51, U3 · Wave 3                              |
| #66                    | Split: keep `push_tokens` strictly-self policies (unblocked, rule-15 rewrite); replace the AG-view gating with "AG eligibility data is visible to BC and to Group Responsibles of the Adunarea Generală"; drop the `responsabil` persona from the test expectation.     | AG half: U3 · Wave 3; token half stays Epic 3      |
| #6, #67                | Append an ADR-0009 note: #6 unchanged children; #67's final sweep must cover Group Roles once Wave 2 lands (add U2 to its blockers).                                                                                                                                    | #67: + U2                                          |
| #103, #104, #105, #107 | Rule-15 rewrite each; they become panels of the single Administrare area (ADR-0009 §Management surface); role management writes the seven-rank ladder.                                                                                                                  | U3 · milestone Wave 3                              |
| #180                   | Append ADR-0009 note: the origin select is a **Group picker** (any Group the caller manages, Child Groups nested), the Campaign select lists Campaigns of the chosen Group and its ancestors.                                                                           | + U2                                               |
| #182                   | Note: validation is "one Group + audience", the five-way department/project/team matrix collapses; a Campaign must belong to the Task's Group or an ancestor.                                                                                                           | + U2                                               |
| #183, #350             | Note: the picker's convenience filters become one Group filter (with descendants) plus Campaign.                                                                                                                                                                        | + U2                                               |
| #349                   | Retitle `Campaigns: manage a Group's campaigns`; managed by the Group's Managers and Responsibles; `useCampaigns(groupId)`.                                                                                                                                             | + U2                                               |
| #354                   | Note: filters are one Group filter (including every Group below it) plus Campaign; the Cup card reads Groups set to compete.                                                                                                                                            | + U2                                               |
| #184                   | Note: the Campaign select follows #180's Group rule.                                                                                                                                                                                                                    | + U2                                               |
| #100                   | Note: the level-4 gate becomes "holds a Group Role" or BCE+ once level 4 retires (Wave 3); no change before.                                                                                                                                                            | + U3                                               |
| #248                   | Rule-15 fix (prose blockers → `#98`, U2); body restated as Group-Role authority: a Group's Managers and Responsibles and its ancestors' edit its Events; org Events only by creator or BC/Moderator.                                                                    | #98, U2 · Wave 2                                   |
| #370                   | Restate as Group-Role authority (any Group Role may create an Organization Group Event; Managers/Responsibles of the Group or an ancestor otherwise); keep dobrerares assigned; note it lands in Wave 2.                                                                | + U2 · Wave 2                                      |

Dry-run output shown to Alex before any call: one line per milestone/issue with title, labels, milestone, blockers, and the draft path; edits additionally show a unified diff of old vs new body (`gh issue view <n> --json body` saved beside the draft).

**Steps**

- [ ] Create the SDD workspace (`scripts/sdd-workspace` of the subagent-driven-development skill) and `issues/` under it. Save every current body first: `gh issue view <n> --json title,body,labels,milestone > issues/current-<n>.json` for each issue in A3.
- [ ] Draft `issues/milestones.md` (A1), `issues/new-u1.md` … `new-u3.md`, `issues/new-n1.md` … `new-n5.md` (A2), and `issues/edit-<n>.md` for every row of A3 — full bodies in house-rule-15 shape (umbrellas in the #90 shape), CONTEXT.md terms, ADR-0009 section references, Romanian UI terms where the issue names screens. Each `new-n*.md` body's `## What to build` / `## Acceptance criteria` / `## Required tests` is lifted from the matching Task 2–6 of this plan (files, functions, test suites, roster/plan bumps), never invented.
- [ ] Produce `issues/DRY-RUN.md`: one line per milestone/issue (action, title, labels, milestone, blockers, draft path) plus a unified diff per edit (`current-<n>` body vs `edit-<n>.md`). Show it to Alex and **stop until he gives the go-ahead**. Nothing below runs before that.
- [ ] Apply in order: milestones (`gh api repos/Alex-Bancila/osubb-app/milestones -X POST -f title=… -f description=…`); U1, U2, U3 (`gh issue create --title … --body-file … --label … --milestone …`); N1–N5 in lane order, each `## Blocked by` naming the previous number; then `gh issue edit U1..U3 --body-file` with the child numbers filled in; then every A3 edit (`gh issue edit <n> --body-file … --milestone … --add-label … --remove-label …`, and `--title` where A3 retitles).
- [ ] Record the mapping N1→#A … N5→#E in the ledger, substitute the real numbers into this plan file (Tasks 2–6 headings, `Closes`, fixture prefixes, branch names), commit that as a docs-only change to `main`, and mark Task 0 complete.

---

---

## Task 1 — #160: `profiles.joined_at`

**Issue:** #160 · **Branch:** `backend/160-profiles-joined-at`

**Files**

- Create: `supabase/migrations/<ts>_profiles_joined_at.sql`
- Create: `supabase/tests/profiles_joined_at.test.sql`
- Create: `supabase/tests/profiles_joined_at_upgrade.test.sh`
- Modify: `supabase/seed.sql` (the eight demo `profiles` rows gain `joined_at`), `supabase/tests/demo_seed.test.sql` (+1), `supabase/tests/rls_profiles_write.test.sql` (+1), `app/src/lib/database.types.ts` (regenerated)

**Interfaces**

- Produces: column `public.profiles.joined_at date null`; `profiles_directory` gains `joined_at`; `authenticated` may `select (joined_at)`; `update (joined_at)` is column-granted but guarded like `joined_year`.
- Consumes: `public.guard_profile_privileged_columns()` (extended in place), `profiles_directory` view.

**Steps**

- [ ] `npx supabase migration new profiles_joined_at`. Content:
  ```sql
  -- #160: profiles.joined_at, the exact join date the Recrut -> Voluntar tenure rule needs; backfilled from joined_year as January 1.
  -- `date`, not timestamptz, on purpose: a join date is a calendar fact with no
  -- instant behind it (conventions section 7 governs instants). Null means unknown.
  alter table public.profiles add column joined_at date;
  comment on column public.profiles.joined_at is
    'Exact join date. Null when genuinely unknown; #160 backfilled known members as January 1 of joined_year.';

  update public.profiles
     set joined_at = make_date(joined_year, 1, 1)
   where joined_year is not null
     and joined_at is null;

  -- Same visibility as joined_year: members read it; only BC (or a server-side
  -- caller) writes it, enforced by the existing privileged-column guard.
  grant select (joined_at) on public.profiles to authenticated;
  grant update (joined_at) on public.profiles to authenticated;

  create or replace view public.profiles_directory with (security_invoker = on) as
    select id, full_name, role, status, avatar_color, tier, joined_year, created_at, joined_at
      from public.profiles;

  create or replace function public.guard_profile_privileged_columns() returns trigger
    language plpgsql
    set search_path = ''
  as $$
  begin
    if new.role            is not distinct from old.role
       and new.status      is not distinct from old.status
       and new.email       is not distinct from old.email
       and new.tier        is not distinct from old.tier
       and new.joined_year is not distinct from old.joined_year
       and new.joined_at   is not distinct from old.joined_at then
      return new;
    end if;
    if public.auth_level() >= 6 or current_user not in ('authenticated', 'anon') then
      return new;
    end if;
    raise exception
      'Only BC (level >= 6) may change role, status, email, tier, joined_year or joined_at on a profile'
      using errcode = '42501';
  end;
  $$;
  ```
  `create or replace` keeps the function's existing revoke posture; `conventions.test.sql` staying green confirms it. `create or replace view` may append a column, which is all this does.
- [ ] `supabase/seed.sql`: extend the demo `profiles` insert (`seed.sql:224-233`) with a `joined_at` column equal to January 1 of each row's `joined_year` (`'2026-01-01'`, `'2025-01-01'`, ...), so a rebuilt database and a backfilled live one agree (issue AC 3). The fingerprint's `member:` line does not read it, so `check-seed-rerunnable.sh` is unaffected.
- [ ] `supabase/tests/profiles_joined_at.test.sql` (fixture prefix `16000000-...`), `plan(9)`:
  1. `has_column('public','profiles','joined_at')`
  2. `col_type_is(... 'date')`
  3. `col_is_null(...)` — nullable
  4. a fixture inserted with `joined_year = 2024` and no `joined_at` keeps `joined_at null` — documents that the backfill is one-shot, not a trigger (the harness proves the backfill itself)
  5. `has_column_privilege('authenticated','profiles','joined_at','select')` is true
  6. `has_column('public','profiles_directory','joined_at')`
  7. persona SELF (`test_login`): `update profiles set joined_at = '2019-01-01' where id = self` -> `throws_ok ... '42501'` — mutation caught: guard not extended
  8. persona BC (`test_login`, level 6): same update `lives_ok` and the value lands
  9. persona claimless: `update` affects zero rows — assert the value is unchanged, not `throws_ok` (`rls_profiles_write.test.sql:89-90` explains why)
- [ ] `supabase/tests/rls_profiles_write.test.sql`: add one `throws_ok` twin of `:82-84` for `joined_at`; bump its `plan`.
- [ ] `supabase/tests/demo_seed.test.sql`: `ok(not exists (select 1 from profiles where email like '%@demo.osubb' and joined_at is distinct from make_date(joined_year, 1, 1)))`; bump `plan`.
- [ ] `supabase/tests/profiles_joined_at_upgrade.test.sh` — copy `remove_team_lead_upgrade.test.sh`'s frame; scratch transaction:
  ```sql
  begin;
  set local client_min_messages = warning;
  -- pre-#160 shape: the view enumerates columns, so it goes first
  drop view public.profiles_directory;
  alter table public.profiles drop column joined_at;
  create view public.profiles_directory with (security_invoker = on) as
    select id, full_name, role, status, avatar_color, tier, joined_year, created_at from public.profiles;
  insert into auth.users (id, email) values
    ('16000000-0000-0000-0000-000000000011', 'known-year-160@test.local'),
    ('16000000-0000-0000-0000-000000000012', 'unknown-year-160@test.local');
  insert into public.profiles (id, full_name, email, role, joined_year) values
    ('16000000-0000-0000-0000-000000000011', 'Known Year 160', 'known-year-160@test.local', 'voluntar', 2024),
    ('16000000-0000-0000-0000-000000000012', 'Unknown Year 160', 'unknown-year-160@test.local', 'voluntar', null);
  ```
  then `cat "$migration"`, then a `do $assert$` block: known-year row `joined_at = date '2024-01-01'`; unknown row `joined_at is null`; demo `bce@demo.osubb` (`joined_year 2023`) = `2023-01-01`; `profiles_directory` exposes `joined_at`; then `rollback;`. Post-check outside the transaction: `select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'joined_at'` = 1 (the scratch drop did not survive).
- [ ] `cd app && npm run gen:types` (types gain `joined_at` on `profiles` and `profiles_directory`).
- [ ] Run the full verification list.

**Commit:** `feat(db): add profiles.joined_at backfilled from joined_year (#160)` + trailer.

---

## Task 2 — #A: Groups schema, invariants, read policies, roles display names

**Issue:** #A ("Groups Wave 1: `groups` and `group_members` schema") · **Branch:** `backend/A-groups-schema`

**Files**

- Create: `supabase/migrations/<ts>_groups_schema.sql`, `supabase/migrations/<ts>_roles_display_names.sql`
- Create: `supabase/tests/groups_schema.test.sql`, `supabase/tests/roles_display_names.test.sql`
- Modify: `supabase/tests/rls_deny_by_default.test.sql` (fixture rows), `supabase/tests/tracker_grants.test.sql` (roster 89 -> 93), `scripts/seed-fingerprint.sql` (+2 lines), `docs/adr/0009-groups.md` (Migration items 1 and 3), `CONTEXT.md:304` (drop the two "known drift" parentheticals), `docs/backend/seeding-staging.md:90-92` (role display names), `app/src/lib/database.types.ts` (regenerated)

**Interfaces**

- Produces: tables `public.groups`, `public.group_members`; trigger functions `private.validate_group_hierarchy()`, `private.cascade_group_path()`, `private.validate_group_member()`; predicate `private.can_read_group_roster(bigint)`; policies `groups_read`, `group_members_read`; 23514 reasons `group_parent_not_found`, `group_cycle`, `group_min_level_below_parent`, `group_min_level_above_children`, `automatic_group_has_no_roster_members`, `group_membership_identity_immutable`.
- Consumes: `private.set_updated_at()` (`20260911200000_shared_timestamps.sql`), `private.caller_level()` / `private.actor_level()` (`20260915222925_actor_authorization_helpers.sql`), `public.auth_is_member()`.

**Steps**

- [ ] `npx supabase migration new groups_schema`. Tables and indexes:
  ```sql
  -- #A: Groups (ADR-0009 Wave 1): groups and group_members as read-only shadow tables with
  -- ancestor paths, Group Roles and the settings ADR-0009 names. Legacy tables stay the
  -- write master; #B backfills, #C mirrors. Clients read, never write.

  create table public.groups (
    id                       bigint generated always as identity primary key,
    name                     text not null,
    category                 text not null,
    parent_id                bigint references public.groups (id),
    path                     bigint[] not null,
    competes_in_cup          boolean not null default false,
    counts_toward_parent_cup boolean not null default true,
    min_level                integer not null default 0,
    accepts_applications     boolean not null default false,
    application_level        integer,
    shared_work_visibility   boolean not null default false,
    automatic_membership     boolean not null default false,
    manager_title            text,
    status                   text not null default 'active',
    short                    text,
    color                    text,
    legacy_dept_id           text unique,
    legacy_team_id           text unique,
    legacy_project_id        bigint unique,
    created_by               uuid references public.profiles (id) on delete set null,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now(),

    constraint groups_name_ck
      check (name ~ '[^[:space:]]'),
    constraint groups_category_ck
      check (category in ('department', 'project', 'team', 'organization')),
    constraint groups_competes_top_level_ck
      check (not competes_in_cup or parent_id is null),
    constraint groups_min_level_ck
      check (min_level in (0, 1, 2, 3, 5, 6, 9)),
    constraint groups_application_level_ck
      check (application_level is null
             or (application_level in (0, 1, 2, 3, 5, 6, 9) and application_level >= min_level)),
    constraint groups_applications_shape_ck
      check (not accepts_applications or application_level is not null),
    constraint groups_automatic_no_applications_ck
      check (not automatic_membership or not accepts_applications),
    constraint groups_manager_title_ck
      check (manager_title is null or manager_title ~ '[^[:space:]]'),
    constraint groups_status_ck
      check (status in ('active', 'archived')),
    constraint groups_legacy_one_ck
      check (num_nonnulls(legacy_dept_id, legacy_team_id, legacy_project_id) <= 1),
    constraint groups_path_ck
      check (cardinality(path) >= 1 and path[cardinality(path)] = id),
    constraint groups_timestamps_ck
      check (updated_at >= created_at)
  );

  comment on table public.groups is
    'One body of OSUBB people and work (ADR-0009). Wave 1: mirrored from departments/teams/projects by private.sync_* and never written directly; legacy_* names the row that masters it.';
  comment on column public.groups.path is
    'Root-first ancestor chain ending in this row''s own id, maintained by groups_validate_hierarchy; authority helpers read it instead of recursing.';
  comment on column public.groups.category is
    'Presentation label only (Department, Project, Team, or the one Organization root). No rule may branch on it.';

  -- Deviation 1 (plan): native Groups only until Wave 3 dedupes legacy names.
  create unique index groups_parent_name_uidx
    on public.groups (coalesce(parent_id, 0), lower(name))
    where legacy_dept_id is null and legacy_team_id is null and legacy_project_id is null;
  create index groups_parent_idx on public.groups (parent_id);
  create index groups_path_idx on public.groups using gin (path);

  create table public.group_members (
    group_id       bigint not null references public.groups (id) on delete cascade,
    member_id      uuid   not null references public.profiles (id) on delete cascade,
    group_role     text   not null default 'member',
    position_title text,
    created_at     timestamptz not null default now(),

    primary key (group_id, member_id),
    constraint group_members_role_ck
      check (group_role in ('manager', 'responsible', 'member')),
    constraint group_members_position_title_ck
      check (position_title is null or position_title ~ '[^[:space:]]')
  );
  create index group_members_member_idx on public.group_members (member_id, group_id);

  comment on table public.group_members is
    'Explicit roster of a Group with its Group Role. Automatic-membership Groups hold only manager/responsible rows.';
  ```
- [ ] Same migration, invariant trigger functions (plpgsql, `security definer`, `set search_path = ''`, 23514 with snake_case reasons — the `20260909003930_project_manager_invariants.sql` shape):
  ```sql
  create function private.validate_group_hierarchy()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
  declare
    v_parent public.groups%rowtype;
  begin
    if new.parent_id is null then
      new.path := array[new.id];
    else
      -- The parent is locked for no key update, never for update (conventions section 2):
      -- this row's path is derived from the parent's, so a concurrent re-parent of the
      -- parent must serialize behind it, while FK key-share readers keep flowing.
      select parent.* into v_parent
        from public.groups as parent
       where parent.id = new.parent_id
         for no key update;
      if not found then
        raise exception using errcode = '23514', message = 'group_parent_not_found';
      end if;
      if new.id = any (v_parent.path) then
        raise exception using errcode = '23514', message = 'group_cycle';
      end if;
      if new.min_level < v_parent.min_level then
        raise exception using errcode = '23514', message = 'group_min_level_below_parent';
      end if;
      new.path := v_parent.path || new.id;
    end if;

    if tg_op = 'UPDATE'
       and new.min_level > old.min_level
       and exists (select 1 from public.groups as child
                    where child.parent_id = new.id and child.min_level < new.min_level) then
      raise exception using errcode = '23514', message = 'group_min_level_above_children';
    end if;

    if new.automatic_membership
       and (tg_op = 'INSERT' or not old.automatic_membership)
       and exists (select 1 from public.group_members as membership
                    where membership.group_id = new.id and membership.group_role = 'member') then
      raise exception using errcode = '23514', message = 'automatic_group_has_no_roster_members';
    end if;

    return new;
  end;
  $$;

  create function private.cascade_group_path()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
  begin
    if new.path is distinct from old.path then
      update public.groups as descendant
         set path = new.path || descendant.path[cardinality(old.path) + 1 :]
       where descendant.path[1 : cardinality(old.path)] = old.path
         and descendant.id <> new.id;
    end if;
    return null;
  end;
  $$;

  create function private.validate_group_member()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
  begin
    if tg_op = 'UPDATE'
       and (new.group_id is distinct from old.group_id
         or new.member_id is distinct from old.member_id) then
      raise exception using errcode = '23514', message = 'group_membership_identity_immutable';
    end if;
    if new.group_role = 'member'
       and exists (select 1 from public.groups as target
                    where target.id = new.group_id and target.automatic_membership) then
      raise exception using errcode = '23514', message = 'automatic_group_has_no_roster_members';
    end if;
    return new;
  end;
  $$;

  create trigger groups_validate_hierarchy
  before insert or update of parent_id, min_level, automatic_membership on public.groups
  for each row execute function private.validate_group_hierarchy();

  create trigger groups_cascade_path
  after update of parent_id on public.groups
  for each row execute function private.cascade_group_path();

  create trigger groups_set_updated_at
  before update on public.groups
  for each row execute function private.set_updated_at();

  create trigger group_members_validate
  before insert or update on public.group_members
  for each row execute function private.validate_group_member();
  ```
  Implementer notes: identity defaults are assigned before BEFORE ROW triggers run, so `new.id` is available when the path is computed; `groups_path_ck` is evaluated after the trigger; the parent lookup raises `group_parent_not_found` itself because the FK check is an AFTER action and would otherwise fire second with a less useful message; the cascade updates only `path`, so `groups_validate_hierarchy` (column-scoped) does not re-fire on descendants and there is no recursion.
- [ ] Same migration, read predicate, RLS and grants (`private.can_read_team` in `20260910210000_scope_team_policies.sql:36-75` is the predicate precedent; the four-role revoke idiom is `20260909151741_project_membership_commands.sql`):
  ```sql
  create function private.can_read_group_roster(p_group_id bigint)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
  as $$
    select coalesce(public.auth_is_member(), false)
       and private.actor_level() is not null
       and exists (
         select 1
           from public.groups as target
           join public.group_members as held
             on held.group_id = any (target.path)
          where target.id = p_group_id
            and held.member_id = (select auth.uid())
            and held.group_role in ('manager', 'responsible')
       );
  $$;
  comment on function private.can_read_group_roster(bigint) is
    'Whether the live active caller is a Group Manager or Group Responsible of the Group or of any ancestor on its path. Runs outside RLS so group_members_read does not recurse.';

  alter table public.groups enable row level security;
  alter table public.group_members enable row level security;

  create policy groups_read on public.groups
    for select to authenticated
    using (
      public.auth_is_member()
      and (
        (status = 'active' and (select private.caller_level()) >= min_level)
        or (select private.caller_level()) >= 5
      )
    );

  create policy group_members_read on public.group_members
    for select to authenticated
    using (
      public.auth_is_member()
      and (
        (member_id = (select auth.uid()) and (select private.caller_level()) >= 0)
        or (select private.caller_level()) >= 5
        or private.can_read_group_roster(group_id)
      )
    );

  -- Read-only for everyone but the mirror (which runs as the table owner).
  revoke all on table public.groups        from public, anon, authenticated, service_role;
  revoke all on table public.group_members from public, anon, authenticated, service_role;
  revoke all on sequence public.groups_id_seq from public, anon, authenticated, service_role;
  grant select on table public.groups        to authenticated, service_role;
  grant select on table public.group_members to authenticated, service_role;

  revoke execute on function private.validate_group_hierarchy()    from public, anon, authenticated, service_role;
  revoke execute on function private.cascade_group_path()          from public, anon, authenticated, service_role;
  revoke execute on function private.validate_group_member()       from public, anon, authenticated, service_role;
  revoke execute on function private.can_read_group_roster(bigint) from public, anon, authenticated, service_role;
  grant usage on schema private to authenticated;
  grant execute on function private.can_read_group_roster(bigint) to authenticated;
  ```
  `caller_level()` returns -1 for a caller with no live active profile, so an inactive Member with stale claims fails both branches; house rule 12 is satisfied by `auth_is_member()` on every branch.
- [ ] `npx supabase migration new roles_display_names`:
  ```sql
  -- #A: roles.name follows CONTEXT.md — Voluntar Activ and Voluntar cu Drept de Vot (display names only; the member_role enum and the 8-row ladder are untouched).
  update public.roles set name = 'Voluntar Activ'           where id = 'activ';
  update public.roles set name = 'Voluntar cu Drept de Vot' where id = 'vot';
  ```
- [ ] `supabase/tests/roles_display_names.test.sql`, `plan(3)`: `name` for `activ` = `Voluntar Activ`; for `vot` = `Voluntar cu Drept de Vot`; `count(*) = 8` (the staging preflight contract in `seed-staging.yml:81`).
- [ ] `supabase/tests/rls_deny_by_default.test.sql` fixture block, after the `team_members` insert (`:44-45`):
  ```sql
  insert into groups (name, category) values ('RLS Group', 'team');
  insert into group_members (group_id, member_id, group_role)
    select id, 'ffffffff-0000-0000-0000-000000000006', 'manager' from groups where name = 'RLS Group';
  ```
  No `plan` change: the two sweeps discover the tables. Mutation caught by the existing sweep: any unconditional branch on either table.
- [ ] `supabase/tests/tracker_grants.test.sql`: add `('can_read_group_roster', 'p_group_id bigint', 'predicate')`, `('cascade_group_path', '', 'trigger')`, `('validate_group_hierarchy', '', 'trigger')`, `('validate_group_member', '', 'trigger')`; count `89 -> 93`; message: "...plus the four Group invariant/predicate helpers (#A)".
- [ ] `scripts/seed-fingerprint.sql`, two new lines (names, never ids — Project Group ids change on every re-seed):
  ```sql
  union all select format('group:%s:%s:%s:%s:%s:%s', grp.name, grp.category, coalesce(parent.name, '-'),
                          grp.status, grp.competes_in_cup, grp.min_level)
              from groups grp left join groups parent on parent.id = grp.parent_id
  union all select format('group-member:%s:%s:%s', grp.name, member.full_name, membership.group_role)
              from group_members membership
              join groups grp on grp.id = membership.group_id
              join profiles member on member.id = membership.member_id
  ```
- [ ] `supabase/tests/groups_schema.test.sql` (fixture prefix `<A>00000-...`; recount `plan(N)` when written, expect about 46). Assertions and the mutation each catches:
      _Shape (postgres):_ `has_table` x2; `col_type_is(groups.path, 'bigint[]')`; `has_index('public','groups','groups_path_idx')`; `has_index('public','group_members','group_members_member_idx')`.
      _Constraints, each `throws_ok(..., '23514', 'new row for relation "groups" violates check constraint "<name>"')` per Ruling 23:_ blank name -> `groups_name_ck`; category `'club'` -> `groups_category_ck`; child with `competes_in_cup = true` -> `groups_competes_top_level_ck`; `min_level 4` -> `groups_min_level_ck`; `application_level 0` on `min_level 3` -> `groups_application_level_ck`; `accepts_applications` without a level -> `groups_applications_shape_ck`; automatic + accepts -> `groups_automatic_no_applications_ck`; status `'draft'` -> `groups_status_ck`; two `legacy_*` set -> `groups_legacy_one_ck`; `group_role 'lead'` -> `group_members_role_ck`; two native siblings `'Echipa X'` / `'echipa x'` -> `23505` naming `groups_parent_name_uidx`; the same two names with `legacy_team_id` set on both -> `lives_ok` (documents Deviation 1 — delete this assertion when Wave 3 makes the index total).
      _Path and hierarchy:_ root path `= array[id]`; child `= array[root, child]`; grandchild three deep; `update grandchild set parent_id = null` re-roots (`path = array[id]`); `update root set parent_id = grandchild` -> `23514 group_cycle`; `update root set parent_id = root` -> `group_cycle`; insert with `parent_id = 999999` -> `group_parent_not_found`; child `min_level 0` under parent `min_level 3` -> `group_min_level_below_parent`; `update parent set min_level = 5` over a child at 3 -> `group_min_level_above_children`; move a subtree under another root and assert every descendant's path prefix changed (mutation: `groups_cascade_path` dropped); `updated_at` advances on update (mutation: `groups_set_updated_at` dropped).
      _Automatic membership:_ insert `'member'` into an automatic Group -> `automatic_group_has_no_roster_members`; `'manager'` into it -> `lives_ok`; flip `automatic_membership` on while a `'member'` row exists -> same reason; `update group_members set member_id = ...` -> `group_membership_identity_immutable`.
      _Read policies (fixtures: root A `min_level 0`, child B `min_level 3`, archived C, high D `min_level 9`; personas via `test_login`: claimless, `anon`, inactive-with-stale-BC-claims, Recrut 0, Vot 3, BCE 5, BC 6):_ claimless `count(groups) = 0` and `count(group_members) = 0`; `anon` -> `42501`; inactive with stale claims -> 0 rows (mutation: `caller_level()` swapped for `auth_level()`); Recrut sees A only; Vot sees A and B; BCE sees A, B, C, D; BC the same; roster: an ordinary member of B sees only their own row (mutation: the `member_id = auth.uid()` branch widened); a manager of A sees B's roster through the path (mutation: `any (target.path)` -> `= target.id`); a responsible of A likewise; a manager of an unrelated root does not see B; BCE sees every roster row; an inactive manager with stale claims sees nothing (mutation: `actor_level() is not null` dropped from the predicate).
      _Grants:_ as BC with live claims, insert/update/delete on both tables -> `42501 permission denied for table ...` (three `throws_ok`, the `rls_deny_by_default.test.sql:379-392` idiom); `has_function_privilege('authenticated', 'private.can_read_group_roster(bigint)', 'execute')` true; `... 'private.validate_group_hierarchy()' ...` false; `has_sequence_privilege('authenticated', 'public.groups_id_seq', 'usage')` false.
- [ ] `docs/adr/0009-groups.md` Migration section: item 1 "keep those tables as read-only compatibility views; add `group_ids` to the organization claims" -> "keep those tables as the write master, mirrored one way into `groups`/`group_members` by triggers (no compatibility views); add `group_ids` to the organization claims"; item 3 "drop the legacy columns, the `event_scope` enum values, the compatibility views, and level 4" -> "drop the legacy columns and tables, the mirror triggers and `groups.legacy_*`, the `event_scope` enum values, and level 4". Add one Consequences bullet: "Until Wave 3 dedupes legacy names, the sibling-name rule binds native Groups only."
- [ ] `CONTEXT.md:304`: remove both "(the database's `roles.name` still reads ... — known drift; the glossary term wins)" parentheticals. `docs/backend/seeding-staging.md:90-92`: `Membru Activ` -> `Voluntar Activ`, `Membru cu Drept de Vot` -> `Voluntar cu Drept de Vot` (leave `Responsabil de proiect`; level 4 is Wave 3's).
- [ ] `cd app && npm run gen:types`; run the full verification list. `db lint` sees only plpgsql bodies with every declared variable read.

**Commit:** `feat(db): groups and group_members shadow schema with path, Group Role and read policies (#A)` + trailer. If Alex wants the rename separate, a second commit in the same PR: `chore(db): roles display names follow CONTEXT.md (#A)`.

---

## Task 3 — #B: Backfill from the legacy tables (+ the sync helpers the triggers reuse)

**Issue:** #B ("Groups Wave 1: backfill `groups`/`group_members` from departments, teams, projects and rosters") · **Branch:** `backend/B-groups-backfill`

**Files**

- Create: `supabase/migrations/<ts>_groups_backfill_from_legacy.sql`
- Create: `supabase/tests/groups_backfill.test.sql`, `supabase/tests/groups_backfill_upgrade.test.sh`
- Modify: `supabase/tests/tracker_grants.test.sql` (roster 93 -> 100). `app/src/lib/database.types.ts` stays byte-identical (private functions only).

**Interfaces**

- Produces: `private.sync_department_groups(text)`, `private.sync_team_groups(text)`, `private.sync_project_groups(bigint)`, `private.sync_department_memberships(uuid, text)`, `private.sync_team_memberships(text, uuid)`, `private.sync_project_memberships(bigint, uuid)`, `private.sync_groups_from_legacy()` — all `security definer`, category `none` (no caller but the migration and #C's triggers). Every argument defaults to null = whole table; a non-null argument scopes the upsert **and** the stale-row delete to that key. Every `do update` carries an `is distinct from` guard so a no-op resync leaves `updated_at` alone (the fixpoint test depends on it).
- Consumes: Task 2's tables and invariant triggers (the path is computed by `groups_validate_hierarchy`, never by the sync).

**Mapping (one place, reused by Task 4):**

| Legacy                            | Group                                                                                                                                                                   | Roster                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `departments.kind = 'department'` | category `department`, `competes_in_cup true`, `min_level 0`, `application_level 1`, `accepts_applications false`, `manager_title 'BCE'`, `short`/`color` carried       | `member_departments` -> `member`; `profiles.role = 'bce'` -> `manager`                                                                             |
| `kind = 'coordination'`           | as above but `competes_in_cup false`                                                                                                                                    | same                                                                                                                                               |
| `kind = 'org'`                    | name `OSUBB`, category `organization`, `automatic_membership true`, `min_level 0`, `application_level null`, `manager_title null`, competes false                       | **nothing mirrored**                                                                                                                               |
| `teams.dept_id not null`          | category `team`, parent = that Department's Group, `counts_toward_parent_cup true`, `shared_work_visibility true`, `application_level 0`, `manager_title 'Coordonator'` | `team_members` -> `member`                                                                                                                         |
| `teams.dept_id null`              | top-level `team`, competes false, `shared_work_visibility true`, `manager_title null`                                                                                   | `team_members` -> `responsible`                                                                                                                    |
| `projects`                        | category `project`, `status` carried, `manager_title 'Coordonator Principal'`, `created_by`/`created_at` carried, `application_level 0`                                 | `project_members.member` -> `member`, `.responsible` -> `responsible`, `projects.leader_id` -> `manager` (wins over its own `project_members` row) |

`is_interne` is not mirrored (retired by the ADR). `accepts_applications` stays false everywhere: no Application flow exists before Wave 3; `application_level` is pre-filled to the ADR values so flipping it on later is a one-column change.

**Steps**

- [ ] `npx supabase migration new groups_backfill_from_legacy`. Group syncs (all `create or replace` — the harness replays this file). Header and the Department sync:
  ```sql
  -- #B: backfill groups/group_members from departments, teams, projects and their rosters
  -- (ADR-0009 Wave 1). The private.sync_* helpers are set-based and key-scoped so #C's
  -- mirror triggers call the very same code per row; create or replace keeps the file
  -- replayable by groups_backfill_upgrade.test.sh.

  create or replace function private.sync_department_groups(p_dept_id text default null)
  returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
  begin
    insert into public.groups as grp
      (name, category, parent_id, competes_in_cup, counts_toward_parent_cup, min_level,
       accepts_applications, application_level, shared_work_visibility, automatic_membership,
       manager_title, status, short, color, legacy_dept_id)
    select case when dept.kind = 'org' then 'OSUBB' else dept.name end,
           case when dept.kind = 'org' then 'organization' else 'department' end,
           null,
           dept.kind = 'department',
           true,
           0,
           false,
           case when dept.kind = 'org' then null else 1 end,
           false,
           dept.kind = 'org',
           case when dept.kind = 'org' then null else 'BCE' end,
           'active',
           dept.short, dept.color, dept.id
      from public.departments as dept
     where p_dept_id is null or dept.id = p_dept_id
    on conflict (legacy_dept_id) do update
       set name = excluded.name, category = excluded.category,
           competes_in_cup = excluded.competes_in_cup,
           application_level = excluded.application_level,
           automatic_membership = excluded.automatic_membership,
           manager_title = excluded.manager_title,
           short = excluded.short, color = excluded.color
     where (grp.name, grp.category, grp.competes_in_cup, grp.application_level,
            grp.automatic_membership, grp.manager_title, grp.short, grp.color)
           is distinct from
           (excluded.name, excluded.category, excluded.competes_in_cup, excluded.application_level,
            excluded.automatic_membership, excluded.manager_title, excluded.short, excluded.color);
  end;
  $$;
  ```
- [ ] Same migration, Team and Project Group syncs:
  ```sql
  create or replace function private.sync_team_groups(p_team_id text default null)
  returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
  begin
    if p_team_id is not null then
      -- Self-healing: the parent Department Group must exist before the child row
      -- (a suite that truncates profiles cascade has just wiped groups).
      perform private.sync_department_groups(team.dept_id)
         from public.teams as team
        where team.id = p_team_id and team.dept_id is not null;
    end if;

    insert into public.groups as grp
      (name, category, parent_id, competes_in_cup, counts_toward_parent_cup, min_level,
       accepts_applications, application_level, shared_work_visibility, automatic_membership,
       manager_title, status, legacy_team_id)
    select team.name, 'team', parent.id, false, true, 0, false, 0, true, false,
           case when team.dept_id is null then null else 'Coordonator' end,
           'active', team.id
      from public.teams as team
      left join public.groups as parent on parent.legacy_dept_id = team.dept_id
     where p_team_id is null or team.id = p_team_id
    on conflict (legacy_team_id) do update
       set name = excluded.name, parent_id = excluded.parent_id,
           manager_title = excluded.manager_title
     where (grp.name, grp.parent_id, grp.manager_title)
           is distinct from (excluded.name, excluded.parent_id, excluded.manager_title);
  end;
  $$;

  create or replace function private.sync_project_groups(p_project_id bigint default null)
  returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
  begin
    insert into public.groups as grp
      (name, category, parent_id, competes_in_cup, counts_toward_parent_cup, min_level,
       accepts_applications, application_level, shared_work_visibility, automatic_membership,
       manager_title, status, legacy_project_id, created_by, created_at)
    select project.name, 'project', null, false, true, 0, false, 0, false, false,
           'Coordonator Principal', project.status, project.id, project.created_by, project.created_at
      from public.projects as project
     where p_project_id is null or project.id = p_project_id
    on conflict (legacy_project_id) do update
       set name = excluded.name, status = excluded.status
     where (grp.name, grp.status) is distinct from (excluded.name, excluded.status);
  end;
  $$;
  ```
  A `do update` that sets `parent_id` fires `groups_validate_hierarchy` (path recomputed, cycle and min-level re-checked) and `groups_cascade_path`; when nothing changed the `is distinct from` guard skips the update entirely.
- [ ] Same migration, roster syncs. Each one first ensures its Group (self-healing), then upserts the scoped roster, then deletes scoped rows the legacy tables no longer justify:
  ```sql
  create or replace function private.sync_department_memberships(
    p_member_id uuid default null, p_dept_id text default null)
  returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
  begin
    if p_dept_id is not null then
      perform private.sync_department_groups(p_dept_id);
    end if;

    insert into public.group_members as membership (group_id, member_id, group_role)
    select grp.id, md.member_id,
           case when member.role = 'bce' then 'manager' else 'member' end
      from public.member_departments as md
      join public.departments as dept on dept.id = md.dept_id and dept.kind <> 'org'
      join public.groups as grp on grp.legacy_dept_id = md.dept_id
      join public.profiles as member on member.id = md.member_id
     where (p_member_id is null or md.member_id = p_member_id)
       and (p_dept_id is null or md.dept_id = p_dept_id)
    on conflict (group_id, member_id) do update
       set group_role = excluded.group_role
     where membership.group_role is distinct from excluded.group_role;

    -- The Organization Group's roster is never the mirror's to touch.
    delete from public.group_members as membership
     using public.groups as grp
     join public.departments as dept on dept.id = grp.legacy_dept_id and dept.kind <> 'org'
     where grp.id = membership.group_id
       and (p_member_id is null or membership.member_id = p_member_id)
       and (p_dept_id is null or grp.legacy_dept_id = p_dept_id)
       and not exists (
         select 1 from public.member_departments as md
          where md.member_id = membership.member_id
            and md.dept_id = grp.legacy_dept_id);
  end;
  $$;

  create or replace function private.sync_team_memberships(
    p_team_id text default null, p_member_id uuid default null)
  returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
  begin
    if p_team_id is not null then
      perform private.sync_team_groups(p_team_id);
    end if;

    insert into public.group_members as membership (group_id, member_id, group_role)
    select grp.id, tm.member_id,
           case when team.dept_id is null then 'responsible' else 'member' end
      from public.team_members as tm
      join public.teams as team on team.id = tm.team_id
      join public.groups as grp on grp.legacy_team_id = tm.team_id
     where (p_team_id is null or tm.team_id = p_team_id)
       and (p_member_id is null or tm.member_id = p_member_id)
    on conflict (group_id, member_id) do update
       set group_role = excluded.group_role
     where membership.group_role is distinct from excluded.group_role;

    delete from public.group_members as membership
     using public.groups as grp
     where grp.id = membership.group_id
       and grp.legacy_team_id is not null
       and (p_team_id is null or grp.legacy_team_id = p_team_id)
       and (p_member_id is null or membership.member_id = p_member_id)
       and not exists (
         select 1 from public.team_members as tm
          where tm.team_id = grp.legacy_team_id and tm.member_id = membership.member_id);
  end;
  $$;
  ```
- [ ] Same migration, Project roster sync, the full resync, grants, and the backfill call:
  ```sql
  create or replace function private.sync_project_memberships(
    p_project_id bigint default null, p_member_id uuid default null)
  returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
  begin
    if p_project_id is not null then
      perform private.sync_project_groups(p_project_id);
    end if;

    -- The leader is unioned in so the result never depends on whether
    -- projects_sync_leader_membership has already written the leader's row.
    insert into public.group_members as membership (group_id, member_id, group_role)
    select grp.id, roster.member_id, roster.group_role
      from (
        select pm.project_id, pm.member_id,
               case when project.leader_id = pm.member_id then 'manager'
                    when pm.project_role = 'responsible' then 'responsible'
                    else 'member' end as group_role
          from public.project_members as pm
          join public.projects as project on project.id = pm.project_id
        union
        select project.id, project.leader_id, 'manager'
          from public.projects as project
      ) as roster
      join public.groups as grp on grp.legacy_project_id = roster.project_id
     where (p_project_id is null or roster.project_id = p_project_id)
       and (p_member_id is null or roster.member_id = p_member_id)
    on conflict (group_id, member_id) do update
       set group_role = excluded.group_role
     where membership.group_role is distinct from excluded.group_role;

    delete from public.group_members as membership
     using public.groups as grp
     where grp.id = membership.group_id
       and grp.legacy_project_id is not null
       and (p_project_id is null or grp.legacy_project_id = p_project_id)
       and (p_member_id is null or membership.member_id = p_member_id)
       and not exists (
         select 1 from public.project_members as pm
          where pm.project_id = grp.legacy_project_id and pm.member_id = membership.member_id)
       and not exists (
         select 1 from public.projects as project
          where project.id = grp.legacy_project_id and project.leader_id = membership.member_id);
  end;
  $$;

  create or replace function private.sync_groups_from_legacy()
  returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
  begin
    -- 1. Orphans: a legacy row deleted while no mirror existed.
    delete from public.groups as grp
     where (grp.legacy_dept_id is not null
            and not exists (select 1 from public.departments as dept where dept.id = grp.legacy_dept_id))
        or (grp.legacy_team_id is not null
            and not exists (select 1 from public.teams as team where team.id = grp.legacy_team_id))
        or (grp.legacy_project_id is not null
            and not exists (select 1 from public.projects as project where project.id = grp.legacy_project_id));
    -- 2. Groups, parents before children.
    perform private.sync_department_groups();
    perform private.sync_team_groups();
    perform private.sync_project_groups();
    -- 3. Rosters.
    perform private.sync_department_memberships();
    perform private.sync_team_memberships();
    perform private.sync_project_memberships();
  end;
  $$;

  revoke execute on function
    private.sync_department_groups(text), private.sync_team_groups(text),
    private.sync_project_groups(bigint), private.sync_department_memberships(uuid, text),
    private.sync_team_memberships(text, uuid), private.sync_project_memberships(bigint, uuid),
    private.sync_groups_from_legacy()
    from public, anon, authenticated, service_role;

  -- The backfill itself. On a fresh reset this sees reference data only (the seed runs
  -- afterwards and #C's triggers mirror it); on staging it converts the live database.
  select private.sync_groups_from_legacy();
  ```
- [ ] `supabase/tests/tracker_grants.test.sql`: seven rows, category `none` — `('sync_department_groups','p_dept_id text','none')`, `('sync_team_groups','p_team_id text','none')`, `('sync_project_groups','p_project_id bigint','none')`, `('sync_department_memberships','p_member_id uuid, p_dept_id text','none')`, `('sync_team_memberships','p_team_id text, p_member_id uuid','none')`, `('sync_project_memberships','p_project_id bigint, p_member_id uuid','none')`, `('sync_groups_from_legacy','','none')` (`pg_get_function_identity_arguments` omits defaults, so these strings match); count `93 -> 100`.
- [ ] `supabase/tests/groups_backfill.test.sql` (prefix `<B>00000-...`, seed-independent; recount `plan(N)`, expect about 24). Fixtures as `postgres`: scratch departments `b-dept` (kind `department`) and `b-coord` (`coordination`); Teams `b-team-dept` under `b-dept` and `b-team-ind` (null dept); profiles bce, voluntar, bc; `member_departments` bce->`b-dept`, voluntar->`b-dept`, bc->`org`; `team_members` voluntar->`b-team-dept`, bce->`b-team-ind`; Projects `B Active` (leader bce, created_by bc, `created_at '2026-01-02 10:00+00'`) with voluntar `member` and bc `responsible`, and `B Archived` (archived). Then `select private.sync_groups_from_legacy();` (before Task 4 this is what creates the mirror; after Task 4 the triggers already did and the call is a no-op — every assertion holds in both worlds). Assertions and what each catches:
  1. `count(groups where legacy_dept_id is not null) = count(departments)` (a department left unmirrored)
  2. `edu` Group: `category department, competes true, parent null, min_level 0, application_level 1, accepts false, manager_title 'BCE', short 'EDU', color '#284C93'` (mapping drift)
  3. `b-coord` Group: `competes false, category department, manager_title 'BCE'` (coordination treated as competing)
  4. `org` Group: `name 'OSUBB', category organization, automatic true, min_level 0, competes false, application_level null, manager_title null` (org mapped as a department)
  5. reference Team `it`: `category team, parent = diverse Group, path = array[diverse_id, it_id], shared true, counts true, manager_title 'Coordonator', competes false` (path/parent lost)
  6. `b-team-ind`: `parent null, competes false, shared true, manager_title null, path = array[self]` (independent mapped under a Department)
  7. `B Active`: `category project, status active, manager_title 'Coordonator Principal', created_by = bc, created_at = '2026-01-02 10:00+00'`; `B Archived`: `status archived` (status not carried)
  8. roster: voluntar in `b-dept` -> `member`; bce in `b-dept` -> `manager` (BCE rule dropped); OSUBB roster `count = 0` (org exclusion dropped)
  9. voluntar in `b-team-dept` -> `member`; bce in `b-team-ind` -> `responsible` (Independent Team rule dropped)
  10. `B Active`: voluntar `member`, bc `responsible`, bce `manager` although `project_members` says `member` for the leader (leader override dropped)
  11. re-parent through legacy: `update teams set dept_id = 'b-coord' where id = 'b-team-ind'` then `sync_groups_from_legacy()` -> parent = `b-coord` Group, path two deep, bce's row now `member` (roster not re-derived on re-parent)
  12. idempotency: snapshot `jsonb_agg(to_jsonb(g) order by g.id)` of both tables (including `updated_at`), call `sync_groups_from_legacy()` again, `is()` equal for each table (a `do update` without its `is distinct from` guard bumps `updated_at`; an insert without `on conflict` errors)
  13. orphan cleanup: `delete from team_members where team_id = 'b-team-ind'; delete from teams where id = 'b-team-ind';` then resync -> no Group with `legacy_team_id = 'b-team-ind'` (orphan step dropped; after Task 4 the trigger already removed it and the assertion still holds)
  14. self-healing: `truncate public.groups cascade; select private.sync_team_memberships('b-team-dept');` -> a Group for `b-team-dept` exists **with** a parent Group for `b-dept` and voluntar's `member` row (the ensure step dropped)
  15. grants: `has_function_privilege('authenticated', 'private.sync_groups_from_legacy()', 'execute')` false; same for `service_role`; `to_regprocedure('private.sync_groups_from_legacy()') is not null`
- [ ] `supabase/tests/groups_backfill_upgrade.test.sh` — the staging shape (legacy rows exist, no mirror), replayed. Frame from `task_assignments_backfill_upgrade.test.sh`:
  ```bash
  #!/usr/bin/env bash
  # #B: the Wave 1 backfill replayed over a database that already holds legacy rows but no
  # mirror -- the staging shape on deploy day. A db reset runs the migration against reference
  # data only, so this harness is the only place the conversion of live rows is proven.
  set -euo pipefail
  db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"
  migration="supabase/migrations/<ts>_groups_backfill_from_legacy.sql"
  {
    cat <<'SQL'
  begin;
  set local client_min_messages = warning;
  -- legacy fixtures as a live database would hold them (prefix <B>00000-)
  --   profiles: bce, voluntar, bc; teams: upgrade-dept-team-B (edu), upgrade-independent-B (null);
  --   member_departments: bce->edu, voluntar->edu, voluntar->org; team_members: voluntar->dept team,
  --   bce->independent; projects: 'Upgrade Project B' active (leader bce, created_by bc) with
  --   voluntar 'responsible', 'Upgrade Archived B' archived.
  -- pre-#B shape: no mirror at all. Once #C lands the fixtures above are mirrored on insert;
  -- wiping makes the replay honest in both worlds.
  truncate public.groups cascade;
  create temp table before_b as
    select (select count(*) from public.departments)
         + (select count(*) from public.teams)
         + (select count(*) from public.projects) as expected_groups;
  SQL
    cat "$migration"
    cat <<'SQL'
  do $assert$
  begin
    -- one Group per legacy row, none extra
    -- bce is manager of edu; voluntar is member of edu; OSUBB has no roster rows
    -- independent-team member is responsible; department-team member is member
    -- both project leaders are managers; voluntar is responsible on the active project
    -- 'Upgrade Archived B' Group is archived; dept team path = array[edu Group, team Group]
    -- if the demo seed is present (CI): bce@demo.osubb is manager of diverse, t-logistica
    --   members are responsible, the Festivalul leader is manager
    -- every raise is 'groups backfill ...: <what>' so a red run names the rule
  end
  $assert$;
  rollback;
  SQL
  } | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q

  # The truncate must not have survived: live groups still match the legacy tables.
  live=$(docker exec "$db_container" psql -X -At -U postgres -d postgres -c \
    "select (select count(*) from public.groups) = (select count(*) from public.departments) + (select count(*) from public.teams) + (select count(*) from public.projects)")
  if [ "$live" != "t" ]; then
    echo "groups no longer match the legacy tables; the scratch transaction did not roll back." >&2
    exit 1
  fi
  echo "Groups backfill upgrade checks passed."
  ```
  (The fixture inserts and assertions are spelled out in full in the real file; the comment lines above are the checklist.)
- [ ] Run the full verification list; confirm `git status` shows no change to `app/src/lib/database.types.ts`.

**Commit:** `feat(db): backfill groups and group_members from the legacy structure tables (#B)` + trailer.

---

## Task 4 — #C: One-way sync triggers on the six legacy tables + profiles role re-derivation

**Issue:** #C ("Groups Wave 1: mirror legacy writes into groups by trigger") · **Branch:** `backend/C-groups-sync-triggers`

**Files**

- Create: `supabase/migrations/<ts>_groups_sync_triggers.sql`
- Create: `supabase/tests/groups_sync.test.sql`
- Modify: `supabase/tests/tracker_grants.test.sql` (roster 100 -> 107), `supabase/tests/demo_seed.test.sql` (+6). `database.types.ts` byte-identical.

**Interfaces**

- Produces: trigger functions `private.mirror_department_group()`, `private.mirror_team_group()`, `private.mirror_project_group()`, `private.mirror_department_membership()`, `private.mirror_team_membership()`, `private.mirror_project_membership()`, `private.rederive_department_group_roles()`; triggers `departments_mirror_group`, `teams_mirror_group`, `projects_mirror_group`, `member_departments_mirror_membership`, `team_members_mirror_membership`, `project_members_mirror_membership`, `profiles_rederive_group_roles`.
- Consumes: Task 3's `private.sync_*`. Nothing in `public` changes.

**Steps**

- [ ] `npx supabase migration new groups_sync_triggers`. All seven are `after ... for each row`, `security definer` (the legacy writes arrive from `authenticated` sessions that hold no write grant on `groups`), `set search_path = ''`, return `null`:
  ```sql
  -- #C: mirror departments, teams, projects and their rosters into groups/group_members one
  -- way (legacy -> groups) and re-derive Department Group Managers when a profile's role
  -- changes (ADR-0009 Wave 1). Definer on purpose: member_departments_manage, teams_create
  -- and profiles_self_update let authenticated sessions write the legacy rows, and those
  -- sessions must never hold a write grant on the mirror.

  create function private.mirror_department_group()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
  begin
    if tg_op = 'DELETE' then
      delete from public.groups where legacy_dept_id = old.id;
      return null;
    end if;
    if tg_op = 'UPDATE' and new.id is distinct from old.id then
      delete from public.groups where legacy_dept_id = old.id;
    end if;
    perform private.sync_department_groups(new.id);
    return null;
  end;
  $$;

  create function private.mirror_team_group()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
  begin
    if tg_op = 'DELETE' then
      delete from public.groups where legacy_team_id = old.id;
      return null;
    end if;
    if tg_op = 'UPDATE' and new.id is distinct from old.id then
      delete from public.groups where legacy_team_id = old.id;
    end if;
    perform private.sync_team_groups(new.id);
    if tg_op = 'UPDATE' and new.dept_id is distinct from old.dept_id then
      -- Department Team <-> Independent Team flips every roster role.
      perform private.sync_team_memberships(new.id);
    end if;
    return null;
  end;
  $$;

  create function private.mirror_project_group()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
  begin
    if tg_op = 'DELETE' then
      delete from public.groups where legacy_project_id = old.id;
      return null;
    end if;
    perform private.sync_project_groups(new.id);
    if tg_op = 'INSERT' or new.leader_id is distinct from old.leader_id then
      -- The roster sync unions the leader in, so this does not depend on
      -- projects_sync_leader_membership (which fires after this trigger) having run.
      perform private.sync_project_memberships(new.id);
    end if;
    return null;
  end;
  $$;

  create function private.mirror_department_membership()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
  begin
    if tg_op in ('UPDATE', 'DELETE') then
      perform private.sync_department_memberships(old.member_id, old.dept_id);
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      perform private.sync_department_memberships(new.member_id, new.dept_id);
    end if;
    return null;
  end;
  $$;

  -- private.mirror_team_membership() is identical with
  --   sync_team_memberships(old.team_id, old.member_id) / (new.team_id, new.member_id);
  -- private.mirror_project_membership() with
  --   sync_project_memberships(old.project_id, old.member_id) / (new.project_id, new.member_id).

  create function private.rederive_department_group_roles()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
  begin
    if (new.role = 'bce') is distinct from (old.role = 'bce') then
      perform private.sync_department_groups(md.dept_id)
         from public.member_departments as md
        where md.member_id = new.id;
      perform private.sync_department_memberships(new.id);
    end if;
    return null;
  end;
  $$;

  create trigger departments_mirror_group
  after insert or update or delete on public.departments
  for each row execute function private.mirror_department_group();
  create trigger teams_mirror_group
  after insert or update of id, name, dept_id or delete on public.teams
  for each row execute function private.mirror_team_group();
  create trigger projects_mirror_group
  after insert or update of name, status, leader_id or delete on public.projects
  for each row execute function private.mirror_project_group();
  create trigger member_departments_mirror_membership
  after insert or update or delete on public.member_departments
  for each row execute function private.mirror_department_membership();
  create trigger team_members_mirror_membership
  after insert or update or delete on public.team_members
  for each row execute function private.mirror_team_membership();
  create trigger project_members_mirror_membership
  after insert or update or delete on public.project_members
  for each row execute function private.mirror_project_membership();
  create trigger profiles_rederive_group_roles
  after update of role on public.profiles
  for each row execute function private.rederive_department_group_roles();

  revoke execute on function
    private.mirror_department_group(), private.mirror_team_group(), private.mirror_project_group(),
    private.mirror_department_membership(), private.mirror_team_membership(),
    private.mirror_project_membership(), private.rederive_department_group_roles()
    from public, anon, authenticated, service_role;
  ```
  Why deletes are safe in either trigger order: a `delete from teams` runs the RI cascade (`RI_ConstraintTrigger_*`, sorts first) that removes `team_members` and fires `team_members_mirror_membership` per row (the Team row is already gone, so the scoped sync only deletes stale roster rows), then `teams_mirror_group` deletes the Group and `group_members.group_id ... on delete cascade` sweeps whatever is left. The seed's delete-then-insert of `t-app`/`t-recruti`/`t-logistica` and of both demo Projects therefore yields exactly one Group per legacy row after every run; ids move, names do not, and the fingerprint reads names.
- [ ] `supabase/tests/tracker_grants.test.sql`: seven rows, category `trigger` — `mirror_department_group`, `mirror_team_group`, `mirror_project_group`, `mirror_department_membership`, `mirror_team_membership`, `mirror_project_membership`, `rederive_department_group_roles` (all args `''`); count `100 -> 107`.
- [ ] `supabase/tests/groups_sync.test.sql` (prefix `<C>00000-...`; recount `plan(N)`, expect about 48). Personas: `postgres` for legacy-only writes; BC via `test_login_leadership` for `member_departments` direct DML and the Project/Independent-Team commands; a local BCE of `edu` via `test_login_leadership` for `teams_create` and the Department-Team commands. Assertions (persona x operation -> mutation caught):
      _Triggers exist:_ seven `pg_trigger` existence checks by name and table (`shared_timestamps.test.sql:16-31` idiom) — a dropped trigger with the function still pinned.
      _departments (postgres):_ insert scratch `c-dept` -> Group with `manager_title 'BCE'`, competes true; `update ... set name` -> renamed; delete (after removing its memberships) -> Group gone.
      _teams:_ **BCE, authenticated**, `insert into teams ('c-bce-team', 'Echipa C', 'edu')` -> Group under the `edu` Group with `manager_title 'Coordonator'` (mutation: function not `security definer` -> `42501 permission denied for table groups`); postgres `update teams set name` -> renamed; postgres `update teams set dept_id = null` -> `parent_id null`, `path = array[self]`, every roster row `responsible`; back to `'edu'` -> rows `member` (mutation: the `dept_id` branch dropped); postgres `delete from teams` -> Group and roster gone.
      _projects:_ BC `select public.create_project('Proiect C', leader)` -> Group `status active`, `created_by = BC`, leader `manager` (mutation: leader union dropped -> the manager row appears only after `projects_sync_leader_membership`, which the fixpoint below also catches); BC `archive_project` -> `status archived`; postgres `update projects set leader_id = other` -> new leader `manager`, old leader `member`; postgres `delete from projects` -> Group gone.
      _member_departments (BC, authenticated):_ insert voluntar->`fin` -> `member`; insert a bce profile->`fin` -> `manager`; `update ... set dept_id = 'hr'` -> `fin` row gone, `hr` row present (mutation: the `old` scope call dropped leaves a stale row); delete -> gone; insert voluntar->`org` -> OSUBB roster still empty.
      _team_members:_ BCE `add_department_team_member` -> `member`; BC `add_independent_team_member` -> `responsible`; both removals -> gone.
      _project_members:_ BC `add_project_member` -> `member`; `grant_project_responsible` -> `responsible`; `revoke_project_responsible` -> `member`; `remove_project_member` -> gone.
      _profiles:_ postgres `update profiles set role = 'bce'` on a member of `fin` and `hr` -> both rows `manager`; back to `'voluntar'` -> both `member`; promoting the org-only member -> still no OSUBB row; **BC through `profiles_self_update` (authenticated)** promoting a member -> `manager` (mutation: definer dropped on the profiles trigger).
      _Fixpoint:_ snapshot both tables, `select private.sync_groups_from_legacy()`, `is()` equal for each (trigger mapping drifted from the backfill mapping — the one assertion that guards Task 3 and Task 4 against each other).
      _Seed-shape re-run:_ postgres deletes `c-bce-team` and re-inserts the same id/name with the same members -> exactly one Group with that `legacy_team_id`, roster restored.
      _Self-healing:_ `truncate public.profiles cascade` (as the four points suites do), then insert a profile and a `member_departments` row -> the `edu` Group exists again and the roster row is present.
      _Grants:_ `has_function_privilege('authenticated', 'private.mirror_team_group()', 'execute')` false (the conventions sweep also covers it).
- [ ] `supabase/tests/demo_seed.test.sql` (+6, seed-dependent by design): `count(groups) = count(departments) + count(teams) + count(projects)`; `bce@` is `manager` of the `diverse` Group and `member` of nothing else in Departments; `bc@` is `member` of `fin` and the OSUBB Group has no roster rows; `t-logistica` members (`vot@`, `bc@`) are `responsible`; `Festivalul Studentesc 2026`: `responsabil@` `manager`, `activ@` `responsible`, `voluntar@` `member`; `Gala Voluntarilor 2025` Group is `archived` with `vot@` `manager`. Bump `plan`.
- [ ] Run the full verification list. `check-seed-rerunnable.sh` is the seed-idempotency proof: the `group:`/`group-member:` fingerprint lines must be identical before and after the second apply. Confirm `database.types.ts` is unchanged.

**Commit:** `feat(db): mirror legacy structure tables into groups with one-way triggers (#C)` + trailer.

---

## Task 5 — #D: `group_ids` claim, `auth_in_group()`, auth-admin read path, helpers, frontend type

**Issue:** #D ("Groups Wave 1: `group_ids` organization claim") · **Branch:** `backend/D-group-ids-claim`

**Files**

- Create: `supabase/migrations/<ts>_groups_claims.sql`
- Modify: `supabase/tests/_helpers.sql`, `supabase/tests/auth_claims.test.sql`, `supabase/tests/grants_hardening.test.sql`, `supabase/tests/tracker_grants.test.sql` (public function table only), `supabase/tests/rls_deny_by_default.test.sql` (policy count 4 -> 6), `supabase/tests/README.md`, `docs/backend/auth-config.md`, `app/src/lib/auth.tsx`, `app/src/App.test.tsx`, `app/src/components/shell/AppShell.test.tsx`, `app/src/lib/capabilities.test.ts`, `app/src/screens/dashboard/DashboardScreen.test.tsx`, `app/src/lib/auth.test.tsx` (one new case), `app/src/lib/database.types.ts` (regenerated: `auth_in_group` under Functions)

**Interfaces**

- Produces: `app_metadata.group_ids` (jsonb array of numbers, ascending, explicit `group_members` rows only), `public.auth_in_group(g bigint) returns boolean`, policies `groups_read_auth_admin`, `group_members_read_auth_admin`, `select` grants to `supabase_auth_admin`, `pg_temp.test_login_leadership` deriving `group_ids`, `MemberClaims.group_ids: number[]`.
- Consumes: `public.custom_access_token_hook(jsonb)` (`20260819163238_jwt_claims_hook.sql`, replaced in place so its `supabase_auth_admin`-only grant survives), Task 4's mirrored rows.

**Steps**

- [ ] `npx supabase migration new groups_claims`. The hook diff (only the `select` list and the `jsonb_build_object` change; the body is otherwise `20260819163238`'s):
  ```diff
     select p.role, r.level,
            coalesce((select jsonb_agg(md.dept_id)
                        from public.member_departments md
                       where md.member_id = p.id), '[]'::jsonb) as dept_ids,
            coalesce((select jsonb_agg(tm.team_id)
                        from public.team_members tm
                       where tm.member_id = p.id), '[]'::jsonb) as team_ids
  +          ,
  +         -- Explicit roster rows only: Automatic Membership (the Organization Group) is
  +         -- derived from the Role and is never a claim. Numbers, ascending, so a token is
  +         -- byte-stable for the same roster.
  +         coalesce((select jsonb_agg(gm.group_id order by gm.group_id)
  +                     from public.group_members gm
  +                    where gm.member_id = p.id), '[]'::jsonb) as group_ids
       into member
       from public.profiles p
       join public.roles r on r.id = p.role
      where p.id = (event ->> 'user_id')::uuid
        and p.status = 'activ';
   ...
                  'dept_ids',     member.dept_ids,
  -                'team_ids',     member.team_ids);
  +                'team_ids',     member.team_ids,
  +                'group_ids',    member.group_ids);
  ```
  Written as `create or replace function public.custom_access_token_hook(event jsonb) returns jsonb language plpgsql stable set search_path = '' as $$ ... $$;` — `create or replace` preserves the existing ACL (`supabase_auth_admin` only). Then:
  ```sql
  -- The Auth server reads group_members while issuing a token. groups is granted too so a
  -- later hook that filters by groups.status cannot break logins (the same dormant-policy
  -- reasoning 20260819163238 used before RLS was enabled).
  grant select on table public.groups, public.group_members to supabase_auth_admin;
  create policy groups_read_auth_admin on public.groups
    for select to supabase_auth_admin using (true);
  create policy group_members_read_auth_admin on public.group_members
    for select to supabase_auth_admin using (true);

  -- Numeric ids: `?` only matches string elements, so containment does the test.
  create function public.auth_in_group(g bigint)
  returns boolean
  language sql
  stable
  set search_path = ''
  as $$
    select coalesce(auth.jwt() -> 'app_metadata' -> 'group_ids' @> to_jsonb(g), false)
  $$;
  comment on function public.auth_in_group(bigint) is
    'True when the caller''s token lists the Group id in group_ids (explicit membership only). JWT-only; pair with a live check where authority is exercised.';

  revoke execute on function public.auth_in_group(bigint) from public, anon, authenticated, service_role;
  grant execute on function public.auth_in_group(bigint) to authenticated, service_role;
  ```
  (`'[1,2]'::jsonb @> '2'::jsonb` is true by the documented array-contains-primitive rule; a string-shaped `["2"]` does not contain `2`, so a forged text array fails closed.)
- [ ] `supabase/tests/_helpers.sql:40-53`: add to `test_login_leadership`'s object
  ```sql
  'group_ids', coalesce((
    select jsonb_agg(membership.group_id order by membership.group_id)
      from public.group_members as membership
     where membership.member_id = profile.id
  ), '[]'::jsonb)
  ```
  and change its contract assertion (`:295-298`) to expect `'group_ids', (select jsonb_agg(grp.id) from public.groups grp where grp.legacy_dept_id = 'edu')` (the fixture BCE is in `edu`, so Task 4 mirrored one `manager` row) with message `'leadership login derives role, level, Departments, Teams and Groups'`. `supabase/tests/README.md:43-45`: "Department IDs, Team IDs, and Group IDs".
- [ ] `supabase/tests/auth_claims.test.sql` (`plan(18)` -> about 28). Existing fixtures (Carmen, BCE in `edu` and Team `t-test`) now carry mirrored rows. Add one fixture `insert into member_departments (carmen, 'org')`. New assertions:
  1. `group_ids` `@> to_jsonb((select id from groups where legacy_dept_id = 'edu'))` — hook does not read `group_members`
  2. `@>` the `t-test` Team's Group id
  3. does **not** contain the OSUBB Group id although Carmen is in `org` — hook reading `member_departments` instead of the roster
  4. `jsonb_typeof(group_ids) = 'array'` and every element is `'number'` (`bool_and(jsonb_typeof(e) = 'number')` over `jsonb_array_elements`) — ids emitted as text
  5. elements are ascending (`= (select jsonb_agg(x order by x) ...)`) — nondeterministic token bytes
  6. un-provisioned and inactive users: event unchanged (existing two assertions stay; a `group_ids` key on them would fail the equality)
  7. `auth_in_group(1)` is false with no JWT (helper defaults section)
  8. simulated JWT `{"app_metadata":{"member_role":"bce","member_level":5,"dept_ids":["edu"],"team_ids":["t-test"],"group_ids":[42,7]}}`: `auth_in_group(42)` true, `auth_in_group(43)` false, `auth_in_group(null)` false
  9. simulated JWT with `"group_ids":["42"]` (forged strings): `auth_in_group(42)` false — a `::text` cast or `?` operator sneaking in
  10. privileges: `has_function_privilege('anon', 'public.auth_in_group(bigint)', 'execute')` false; `supabase_auth_admin` holds `select` on `groups` and `group_members`; the hook is still not executable by `authenticated` (existing).
- [ ] `supabase/tests/grants_hardening.test.sql`: proname list gains `'auth_in_group'`, expected `6::bigint`, message `'all six JWT helpers pin search_path'`; add `select is(has_function_privilege('anon', 'public.auth_in_group(bigint)', 'execute'), false, 'anon: auth_in_group denied');` and `select is(has_function_privilege('authenticated', 'public.auth_in_group(bigint)', 'execute'), true, 'authenticated: auth_in_group allowed');`; `plan(15)` -> `plan(17)`.
- [ ] `supabase/tests/tracker_grants.test.sql` `expected_function_privs`: `('auth_in_group', 'g bigint', false, true, true, false)` next to `auth_in_team`; mention it in the assertion message. No roster change (public function).
- [ ] `supabase/tests/rls_deny_by_default.test.sql:330-335`: `tablename in ('profiles', 'roles', 'member_departments', 'team_members', 'groups', 'group_members')`, `6::bigint`, `'claims-hook read policies cover all six tables (logins keep working)'`.
- [ ] Frontend, `app/src/lib/auth.tsx`: `MemberClaims` gains `group_ids: number[];` (doc comment: "Explicit Group memberships (ADR-0009 Wave 1); the Organization Group is automatic and never listed"); `decodeClaims` returns `group_ids: Array.isArray(meta.group_ids) ? (meta.group_ids as number[]) : []`. Add `group_ids: [],` to the four fixture objects (`App.test.tsx:51-56`, `AppShell.test.tsx:20-25`, `capabilities.test.ts:17-22`, `DashboardScreen.test.tsx:39-44`). `app/src/lib/auth.test.tsx`: one new case building a token whose base64url payload is `{"app_metadata":{"member_role":"bc","member_level":6,"dept_ids":[],"team_ids":[],"group_ids":[3,9]}}` and asserting `claims?.group_ids` equals `[3, 9]` (mutation: decode line dropped -> `[]`).
- [ ] `docs/backend/auth-config.md:20`: "Stamps `member_role`, `member_level`, `dept_ids`, `team_ids`, `group_ids` into the token"; `:68`: "access_token whose app_metadata has member_role / member_level / dept_ids / group_ids".
- [ ] `cd app && npm run gen:types` (adds `auth_in_group` to `Functions`), then the full verification list (frontend gates included).

**Commit:** `feat(auth): group_ids organization claim and auth_in_group() (#D)` + trailer.

---

## Task 6 — #E: Docs closeout

**Issue:** #E ("Groups Wave 1: document the shadow model") · **Branch:** `docs/E-groups-wave1`

**Files**

- Modify: `docs/backend/conventions.md`, `CONTEXT.md` (Term -> identifier), `CLAUDE.md` (Status + the auth sentence at `:66`).

**Steps**

- [ ] `docs/backend/conventions.md`: new section **"10. Groups (ADR-0009 Wave 1)"** before the PR checklist, five short paragraphs: (1) `public.groups` / `public.group_members` exist and are **read-only shadows**; `departments`, `teams`, `projects`, `member_departments`, `team_members`, `project_members` remain the write master until Wave 3; (2) never write the two tables directly — no client grant exists, and a migration that hand-edits them is overwritten by the next scoped sync; to change what a Group looks like, change the legacy row or extend the mapping in `private.sync_*` (`<ts>_groups_backfill_from_legacy.sql`) and the fixpoint assertion in `groups_sync.test.sql`; (3) the mirror is the seven triggers `departments_mirror_group`, `teams_mirror_group`, `projects_mirror_group`, `member_departments_mirror_membership`, `team_members_mirror_membership`, `project_members_mirror_membership`, `profiles_rederive_group_roles`, all `security definer` because client DML on the legacy tables fires them; `private.sync_groups_from_legacy()` is the repair/fixpoint and is safe to run any time as `postgres`; (4) new authority reads `groups.path` and `group_members.group_role` (house rule 13) and pairs `public.auth_in_group()` with a live check exactly as `auth_in_dept()` is paired today; (5) `groups_parent_name_uidx` is partial (native Groups only) until Wave 3 dedupes legacy names. Add a checklist line: "Touching the six legacy structure tables or `profiles.role`? `groups_sync.test.sql`'s fixpoint stays green and nothing writes `groups` by hand."
- [ ] `CONTEXT.md` Term -> identifier: add **"Group -> `groups`; Group Role -> `group_members.group_role`"**: `manager` -> Group Manager, `responsible` -> Group Responsible, `member` -> ordinary membership; `groups.category` is the Group Category; `groups.path` the root-first ancestor chain; `legacy_dept_id` / `legacy_team_id` / `legacy_project_id` name the legacy row that still masters a Wave 1 Group (dropped in Wave 3). Add **"Organization Group -> the `groups` row with `legacy_dept_id = 'org'`"** (name `OSUBB`, `automatic_membership = true`; never the `departments` row itself). Add **"`group_ids` claim"**: explicit roster memberships only; Automatic Membership is never in the token.
- [ ] `CLAUDE.md`: in Status, replace "the Group model of ADR-0009 (three strangler waves, the next thing to plan)" under **Not built yet** with a new bullet "**Groups Wave 1 is on `main`**: `groups`/`group_members` mirrored from the legacy tables by trigger, read-only to clients, `group_ids` in the claims; Waves 2 (authority helpers and commands read Groups) and 3 (Administrare, legacy drop) are the next plans"; `:66` "stamps role/level/depts/teams" -> "stamps role/level/depts/teams/groups".
- [ ] `npm run check:root` (prettier on Markdown + `remark-validate-links`) must pass; format only the touched files by hand or with `npx prettier --write <file>` on exactly those paths.

**Commit:** `docs: record the Groups Wave 1 shadow model (#E)` + trailer.

## Risks (ranked)

1. **Sibling-name uniqueness vs. live scripts and fixtures.** A total unique index on `(coalesce(parent_id,0), lower(name))` breaks `scripts/check-seed-rerunnable.sh:198-201` (second Project named `Festivalul Studentesc 2026`) the first time CI runs it, and is one same-named Team fixture away from breaking any suite. Recommendation: partial index (native Groups only), total in Wave 3. Needs a decision before Task 2.
2. **TRUNCATE CASCADE reaches `groups` through `created_by`.** Four suites `truncate public.profiles cascade`; `project_read_policies.test.sql` truncates `projects restart identity cascade`. Without self-healing syncs the next `member_departments`/`teams` insert in those suites would hit a missing parent Group (`group_parent_not_found`) or a `legacy_project_id` collision. Mitigation is designed in (ensure-parent step, upsert by legacy id, `truncate` assertions in `groups_backfill`/`groups_sync`); residual risk is a future suite asserting on `groups` right after such a truncate without re-syncing.
3. **Security-definer trigger functions on client-writable tables.** `teams_create`, `member_departments_manage` and `profiles_self_update` let `authenticated` fire code that writes `groups` as the table owner. The functions read only `new`/`old` and call key-scoped syncs, `conventions.test.sql` keeps them non-executable and `search_path`-pinned, but `db lint` does not lint trigger functions — review them by eye, and never add a caller-controlled parameter path.
4. **Trigger-order and roster-pin coupling.** `projects_mirror_group` fires before `projects_sync_leader_membership` only because of alphabetical order; the leader union in `sync_project_memberships` makes the result order-independent, and the fixpoint assertion in `groups_sync.test.sql` catches any future drift. Separately, Tasks 2-4 add 18 `private` functions (89 -> 107): one forgotten roster row, revoke or `search_path` turns `tracker_grants`, `conventions` and possibly the claimless sweep red at once.
5. **Claims staleness and shape.** Project/Team Group ids change on every staging re-seed (delete-then-insert), so a signed-in demo user carries stale `group_ids` for up to `jwt_expiry` (1 h) — the same class of staleness `dept_ids`/`team_ids` already have; Wave 2 policies must keep pairing `auth_in_group()` with live row checks. `group_ids` must stay numeric: a text array makes `auth_in_group()` fail closed and the UI empty (pinned by the forged-string assertion). Token size grows about 4 bytes per membership — negligible at 200 members.
6. **`responsabil` holders.** `seed.sql`, `shared_timestamps.test.sql:37`, and `check-seed-rerunnable.sh:160` insert role `responsabil`; Wave 1 never refuses them (the ADR's refusal belongs to Wave 3's level-4 drop). They mirror as ordinary `member`/`manager` rows like any other rank.
7. **Deferrable composite FK `events(team_id, dept_id) -> teams(id, dept_id)`.** Not touched by the mirror, but a future `#310`-style Department move now also re-parents the Team's Group (path cascade) and flips its roster roles inside the same `update teams set dept_id` statement; keep the `set constraints ... deferred` dance and expect `teams_mirror_group` to run once per moved Team.
8. **Harness replay and DDL idempotency.** `groups_backfill_upgrade.test.sh` replays the backfill migration over a database where it already ran; every function in it must be `create or replace` and the final `select private.sync_groups_from_legacy();` is what the harness exercises. `profiles_joined_at_upgrade.test.sh` must drop and recreate `profiles_directory` to drop the column (the view enumerates columns).
9. **`_helpers.sql` contract coupling.** `test_login_leadership`'s exact-metadata assertion goes red the moment `group_ids` is added to the helper; Task 5 changes both in one commit. Every suite that calls `test_login_leadership` now logs in with `group_ids` — harmless today because no policy reads them.
10. **Performance envelope.** Row triggers call key-scoped set-based syncs (index lookups on the `legacy_*_id` unique indexes and the two PKs). A `delete from auth.users` of a member with N memberships runs N scoped syncs; a full `sync_groups_from_legacy()` is O(rows) and runs once per deploy. Fine at OSUBB scale; the GIN index on `path` serves `any(path)` ancestor probes.
11. **`date` for `joined_at`.** Conventions section 7 says instants are `timestamptz`; a join date is a calendar fact, the issue asks for `date`, and the migration comment says why. Newly provisioned members get `joined_at null` until `provision_profile`/the invite function set it — file a follow-up, out of #160's boundary.
12. **Generated types drift.** Tasks 1, 2 and 5 change the public surface and must commit a regenerated `database.types.ts`; Tasks 3, 4 and 6 must not touch it. CI diffs byte-for-byte.

## Verification summary (what "green" means per task)

| Task | Gates that must change                                                                                                                                         | Gates that must not change                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1    | `profiles_joined_at.test.sql`, `profiles_joined_at_upgrade.test.sh`, `rls_profiles_write` +1, `demo_seed` +1, `database.types.ts`                              | fingerprint, roster count                                             |
| 2    | `groups_schema.test.sql`, `roles_display_names.test.sql`, `tracker_grants` 89 -> 93, fingerprint +2 lines, `rls_deny_by_default` fixtures, `database.types.ts` | auth-admin policy count 4, `plan` of `auth_claims`/`grants_hardening` |
| 3    | `groups_backfill.test.sql`, `groups_backfill_upgrade.test.sh`, `tracker_grants` 93 -> 100                                                                      | `database.types.ts`, `check-seed-rerunnable`                          |
| 4    | `groups_sync.test.sql`, `demo_seed` +6, `tracker_grants` 100 -> 107, fingerprint values (more rows, still equal before/after)                                  | `database.types.ts`                                                   |
| 5    | `auth_claims`, `grants_hardening` 15 -> 17, `rls_deny_by_default` 4 -> 6, `_helpers` contract, four frontend fixtures, `database.types.ts`                     | roster count 107                                                      |
| 6    | `npm run check:root`                                                                                                                                           | everything else                                                       |

### Critical Files for Implementation

- `C:\Users\alexb\dev\osubb-app\supabase\migrations\20260909003930_project_manager_invariants.sql` — the trigger style (definer, `search_path = ''`, 23514, four-role revoke) every new trigger copies, and the existing project triggers the mirror must coexist with.
- `C:\Users\alexb\dev\osubb-app\supabase\tests\tracker_grants.test.sql` — the closed `private` roster (89 -> 107 across Tasks 2-4) and the public-function grant table (`auth_in_group`).
- `C:\Users\alexb\dev\osubb-app\supabase\tests\rls_deny_by_default.test.sql` — fixture block, claimless sweep, and the auth-admin policy count (4 -> 6).
- `C:\Users\alexb\dev\osubb-app\supabase\migrations\20260819163238_jwt_claims_hook.sql` — the hook body Task 5 replaces in place, and the auth-admin grant/policy pattern it extends.
- `C:\Users\alexb\dev\osubb-app\scripts\check-seed-rerunnable.sh` — the seed-idempotency gate (`group:`/`group-member:` fingerprint lines) and the same-named sentinel Project behind Deviation 1.
