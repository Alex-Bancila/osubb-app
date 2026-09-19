# Group model — Wave 2 (authority and commands read Groups) + issue graph (2026-09-19)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. On approval this file is copied to `docs/superpowers/plans/2026-09-19-group-model-wave-2.md` and executed task-by-task (one implementer per task, task review after each, one whole-wave review at the end). Steps use `- [ ]` syntax. Each PR is opened against `main` and merged once its task review is clean and CI is green (Alex's standing merge-as-you-go instruction). Every subagent dispatch carries the bounded-command rule from Wave 1: no single command over ~8 minutes, database gates as separate calls.

**Goal:** Land Wave 2 of ADR-0009 — every authority decision in the Tracker, Calendar, Campaign and Completed-work Request commands is made from `groups` / `group_members` (Group Role on the Group or an ancestor, rank BC/Moderator override, rank BCE global read) instead of the `dept_id / team_id / project_id` branches; Tasks and Events carry one `group_id`; Campaigns are owned by any Group; the conventions suite forbids branching on `groups.category`; and the GitHub issue graph is updated for what Wave 2 changes and what Wave 3 inherits.

**Architecture:** _Flip the readers, keep the writers._ Legacy tables stay the write master for structure and rosters (Wave 3 flips that). Wave 2 (1) adds `tasks.group_id`, `events.group_id`, `campaigns.group_id`, backfilled from the legacy columns and kept consistent both ways by triggers so every existing fixture that inserts a Task with `dept_id` keeps working; (2) introduces one Group-based authority kit in `private` (`group_role_of`, `is_group_manager`, `is_group_responsible`, `can_manage_group_work`, `can_evaluate_in_group`, `can_read_group_work`, `group_managers`) that walks `groups.path`; (3) redefines the existing `require_*` / `can_*` helpers and the read policies on top of that kit, keeping every public command signature and error code unchanged so the frontend and the smoke test do not notice; (4) moves Calendar create/update and Campaign management onto the same kit; (5) makes the pinned roster, the points authorization matrix and the persona suites prove the new matrix, and adds the no-category-branch check.

**Tech stack:** Supabase (PostgreSQL 15, RLS, pgTAP), migrations via `npx supabase migration new`, `scripts/check-local-ci.sh` (24 gates, run per group), `scripts/smoke-tracker-commands.sh`, `gh` for the issue graph.

**Spec:** `docs/adr/0009-groups.md` (§Authority five-row matrix, §Group Roles, §Minimum Level, §Campaigns, §Calendar, §Migration Wave 2), `docs/backend/conventions.md` (§2 command shape and lock modes, §3 errors, §4 grants, §10 Groups shadow model), `CONTEXT.md`, umbrella issue #505 (scope), the Wave 1 plan's "Execution rulings" (deferrals Wave 2 inherits: `path @> array[id]` for ancestry probes, the one-row-per-statement re-parent rule, the conditional self-heal, level 4 and `is_interne` untouched until Wave 3).

## Context

Wave 1 (merged 2026-09-18/19, PRs #503, #513–#518) put the Group model in place as a read-only shadow: every Department, Team and Project is a `groups` row with an ancestor `path`, every roster row is a `group_members` row with a Group Role (BCE → `manager`, Project lead → `manager`, Independent-Team member → `responsible`), and the claims carry `group_ids`. Nothing consumes it yet: the ~90 `private` helpers still decide authority from three parallel branches, and that is the hardcoding Alex asked to remove. Wave 2 is the flip. It must not change what any member can do today except where ADR-0009 deliberately does (Group Responsibles, ancestor authority, Campaigns on any Group), it must keep the 21 command signatures and error vocabulary stable, and it must leave the Tracker frontend issues (#180, #182, #183, #184, #349, #350, #354) unblocked at its end.

### Verified facts that shape the tasks (origin/main @ 6eb1921)

- **Scale:** 112 migrations (latest `20260918233009_groups_resync_after_triggers.sql`), 98 pgTAP suites + 11 upgrade harnesses, 3,720 planned assertions, private roster pinned at **107**. Suites that insert legacy rosters: `member_departments` 45, `teams` 39, `projects` 30, `team_members` 27, `project_members` 20; 26 suites are named after a command.
- **The three-branch family to flip** (all in `20260915222925_actor_authorization_helpers.sql` unless noted): `can_manage_origin(text,text,bigint)` (level ≥ 6 · dept: BCE + membership · dept-team: BCE + parent membership · **independent team: any member, no role filter** · project: `can_manage_project_work`), `require_origin_manager` (same + `for share` re-lock of the membership row), `can_evaluate_task` (BCE for dept/dept-team; project lead, or Responsible except for the lead's or own Assignment; **no independent-team branch**), `can_read_task` (level ≥ 5 · own Assignment/Candidature · `team_members` on `task.team_id` · project lead/Responsible · open public Opportunity by audience), `require_request_decider` (**narrower**: BCE dept/parent-dept, project lead only), `can_manage_task` / `require_task_manager` / `require_task_evaluator` / `require_task_visible` delegate to those; `is_task_team_member` (`20260911211200`) backs `task_activity_read`; `private.task_managers` (`20260911211000`) resolves notification recipients creator-first then per origin then BC/Moderator; the decider predicate is **duplicated three times** (`require_request_decider` + two inline copies in `create_completed_work_request_impl`). `public.can_manage_tasks()` and `my_managed_task_ids()` are the only management reads the app calls (`app/src/queries/task-tabs.ts`).
- **Policies that branch through the helpers:** `tasks_read` → `can_read_task`; the four history policies (`task_assignments/candidates/activity/evaluations_read`) → `can_read_task` + own/`is_global_task_reader`/`can_manage_task`/`is_task_team_member`; `completed_work_requests_read` → `can_manage_origin(dept_id, team_id, project_id)`; `campaigns_read` = any active member; `events_read` = `caller_level() >= min_level` (scope no longer consulted); `attendance_read` still has an `auth_level() >= 4` branch and `announcements_write` is `auth_level() >= 4` (both outside Wave 2, listed as deferrals).
- **Origin columns today:** `tasks.dept_id/team_id/project_id` under `tasks_exactly_one_origin_check` (`num_nonnulls = 1`), written by `create_task_impl` (`20260916101117`), `duplicate_task_impl`, `approve_completed_work_request_impl`; triggers `tasks_validate_campaign` (`before … of campaign_id, dept_id, team_id, project_id`; Projects and Independent Teams can never carry a Campaign) and `tasks_validate_hierarchy` (Subtask inherits origin). `tasks_with_overdue` is `select task.*` and **must be dropped and recreated** when a column is added (pattern in `20260915151447`). `completed_work_requests` mirrors the triple under `completed_work_requests_origin_ck`. `campaigns.department_id` is `not null` with `campaigns_department_name_uidx (department_id, lower(name))`; `require_campaign_manager` allow-lists `departments.kind in ('department','coordination')`.
- **Events:** `scope event_scope not null` + `dept_id/team_id/project_id`, `events_scope_fields_ck` requires `dept_id not null` for `scope='team'` (so an Independent Team can have no Event), composite deferrable FK `events(team_id, dept_id) → teams(id, dept_id)` (passes when a column is null), `events_min_level_ck in (0,3,4,5,6)`; `create_event` is a grandfathered direct-definer gated on a flat `actor_level() >= 4` and rejects `project` scope; **`update_event` and `cancel_event` do not exist**; `set_event_rsvp` is `security invoker` over `events_read`. Frontend reads `scope, dept_id, team_id` and filters `.neq('scope','project')` (`app/src/queries/events.ts`); seed has one `org` Event at `min_level 3`, no `project` Event, no `min_level 4`.
- **Leadership reads:** `leadership_leaderboard(text,text,bigint,bigint)` (all four filters; dept filter = `task.dept_id = p or origin_team.dept_id = p`), `department_cup(p_campaign_id)` over `private.department_cup_rows` (rows = `departments.kind = 'department'`; `coalesce(task.dept_id, team.dept_id)`), `dept_cup` view (read by `app/src/queries/points.ts` as `dept_id, name, points, members`), `leadership_member_tasks(uuid)` (origin triple). No frontend caller of the two RPCs yet (#354 unbuilt); `leaderboard`/`member_points` views untouched.
- **Frontend impact of Wave 2:** additive only. Nothing breaks from adding `group_id`; `app/src/test/task-fixtures.ts` needs `group_id` only if the `Insert` type makes it required; `database.types.ts` is byte-diffed by CI and must be regenerated in every PR touching `public`. `completed-work-requests.ts` passes `p_dept_id/p_team_id/p_project_id` (three-nulls pattern) — an added defaulted `p_group_id` must not break PostgREST overload resolution.
- **Seed and smoke:** demo Tasks cover Department, Department Team (`it`), Independent Team (`t-logistica`), Project (`Festivalul Studențesc 2026`), Umbrella/Subtasks, Campaigns on five departments; `seed-fingerprint.sql` reads `campaigns.department_id` and `events.scope` (keep both columns); the smoke script exercises the 21 Task commands + the Request commands with legacy origin args and never calls `create_campaign`/`create_event`.
- **Conventions check:** `conventions.test.sql` uses `pg_temp` helpers returning offending names; `groups.category` is referenced only by the three Wave 1 `private.sync_*_groups` writers, so a "no function/policy mentions `category`" check (excluding those three) is green on day one.
- **Rulings inherited from Wave 1:** ancestry with `path @> array[id]`; re-parent one row per statement; no unconditional `on conflict … do update` on a row another session may hold; level 4, `is_interne`, `departments.kind` drop, `org` pseudo-department row → Wave 3.
- **Ruling 2026-09-19 (Alex): Independent Teams — peers manage, BC evaluates.** Where a Group and all its ancestors have no Group Manager, its Group Responsibles manage each other's Tasks as today; evaluation of a Responsible's Task still needs a Manager and therefore falls to BC/Moderator. Keyed on "no Manager on the path", never on category.

## Rulings on the Plan agent's draft (recorded so nobody re-litigates them mid-wave)

These rulings are **binding**. The eight task sections below carry the full steps, SQL and assertion tables; where any of that text disagrees with a row of this table, the row wins and the task text has already been amended to match. Nothing here is reopened mid-wave.

| Point                                                                                  | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Why                                                                                                                         | Cost if wrong                          |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| D1 read branch status-agnostic                                                         | Accepted: `can_read_task`'s Group-Role branch ignores `groups.status`; managing and evaluating stay status-gated.                                                                                                                                                                                                                                                                                                                                                                     | An archived Project's former lead keeps reading its history (R5 today).                                                     | None.                                  |
| **D2 ancestor membership**                                                             | **Rejected — per Group.** `group_role_of`'s `member` tier counts only an explicit `member` row or Automatic Membership **on the Group itself**; `manager`/`responsible` still flow down from ancestors. A local Opportunity admits members of the Task's own Group; Shared Work Visibility applies to the Tasks of the Group that has it on; Requests are filed against a Group the Member belongs to. Test 11 of `group_authority` and change (a) of `rls_tasks_read_matrix` invert. | CONTEXT.md: "local to its Origin Group"; a Department member is not a Team member. Keeps today's visibility sets.           | Two join conditions.                   |
| D3 evaluating an outsider Executor                                                     | Accepted: a Responsible may evaluate a Task whose Executor holds no Group Role on the chain, including an Independent-Team peer evaluating an outsider's Task.                                                                                                                                                                                                                                                                                                                        | The matrix forbids only own, peer and Manager Tasks.                                                                        | One `coalesce`.                        |
| **D4 recipients with no Manager**                                                      | **Ruled: Responsibles ∪ BC/Moderator.** `group_managers` returns the Group's Managers, else the nearest ancestor's; when no Manager exists anywhere on the path it returns the chain's live Responsibles plus every live BC/Moderator. Managers-only when a Manager exists.                                                                                                                                                                                                           | "Peers manage" (Alex 2026-09-19): the peers who manage a Task must hear it was given up; evaluation notices still reach BC. | Recipient `set_eq`s in six suites.     |
| D5 `duplicate_task` signature                                                          | Accepted: unchanged; the clone copies `source.group_id`.                                                                                                                                                                                                                                                                                                                                                                                                                              | Re-originating a clone is Wave 3.                                                                                           | None.                                  |
| D6 three trigger reasons                                                               | Accepted (`<row>_group_origin_mismatch`, `<row>_group_required`, `<row>_group_origin_unmapped`).                                                                                                                                                                                                                                                                                                                                                                                      | Crisper than a 23502 ahead of the origin check.                                                                             | None.                                  |
| D7 `group_manage_forbidden` remapped per caller                                        | Accepted (the `require_task_evaluator` idiom).                                                                                                                                                                                                                                                                                                                                                                                                                                        | Ruling 28.                                                                                                                  | None.                                  |
| D8 `create_task` gains trailing `p_group_id default null`                              | Accepted; every positional or named call keeps working; only the generated Args type changes. Same for `create_completed_work_request`; both old-arity twins are **dropped**, never left beside the new one (PostgREST 300).                                                                                                                                                                                                                                                          | The constraint was about callers, not the catalog.                                                                          | Types regenerated.                     |
| D9 Campaign text overload on an unknown Department                                     | Accepted: `42501 campaign_manage_forbidden` (non-disclosing; the overload dies in Wave 3).                                                                                                                                                                                                                                                                                                                                                                                            | One retired assertion.                                                                                                      | None.                                  |
| D10 `events.updated_at` in #248                                                        | Accepted (conventions §7).                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                           | None.                                  |
| OD3 Events at `min_level 4`                                                            | Move up to 5, never down.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | A "Responsible+" gate must not open to level 3.                                                                             | A one-row update if staging disagrees. |
| OD4 `private.notify` link                                                              | Add a trailing `p_link text default null` in #248; Event notifications link to `/calendar` (no per-Event route exists yet). Roster args row changes, count does not.                                                                                                                                                                                                                                                                                                                  | Notifications without a link are dead ends.                                                                                 | One parameter.                         |
| OD5 `update_event` semantics                                                           | Full-state replace.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Matches how the form submits; a field can be cleared.                                                                       | —                                      |
| OD8 Organization-Group Campaigns                                                       | Allowed; only level ≥ 6 manages them.                                                                                                                                                                                                                                                                                                                                                                                                                                                 | No category branch; the org Group is a Group.                                                                               | —                                      |
| OD9 test fixtures writing `groups.min_level` / native Groups inside rolled-back suites | Accepted exception, recorded in conventions §10.                                                                                                                                                                                                                                                                                                                                                                                                                                      | The kit cannot be tested otherwise before Wave 3.                                                                           | —                                      |
| Issue numbers                                                                          | Task 0 files N1–N8 first; `#519`…`#524` are substituted into the plan (docs-only commit) before Task 1 is dispatched, as in Wave 1.                                                                                                                                                                                                                                                                                                                                                   | —                                                                                                                           | —                                      |

## Global constraints

- One issue = one branch = one PR, body `Closes #n`, CI green; PRs against `main`; merge once task review is clean and CI green. Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **GitHub-visible actions need review first**: issue bodies and edits drafted to files under the SDD workspace, shown as a dry run, applied only after one go-ahead, in dependency order. `scripts/create-github-issues.sh` is never run.
- **Public command signatures, error codes and reason strings do not change in Wave 2.** A caller that worked before a task merges works identically after it; the smoke script (`scripts/smoke-tracker-commands.sh`) passes unchanged at every merge.
- **No rule branches on `groups.category`** (ADR-0009); `conventions.test.sql` gains the check in the first task that could violate it, and it stays green for the rest of the wave.
- Every migration follows `docs/backend/conventions.md`: `security definer` only in `private`, `set search_path = ''`, fully qualified names, four-role revoke and explicit grant back; every `to authenticated` policy unsatisfiable without org claims (house rule 12); parent rows locked `for no key update`, never `for update`; ancestry probed with `path @> array[id]`, never `= any (path)`; error vocabulary `42501 <scope>_forbidden`, `PT400`, `PT404`, `PT409`, `23514` snake_case reasons.
- Legacy tables stay the write master; `groups`/`group_members` are never written by hand (conventions §10). `tasks.dept_id/team_id/project_id`, `events.*`, `campaigns.department_id` stay present and consistent with `group_id` until Wave 3 drops them.
- Tests ship with the feature in the same PR and must fail if the feature is removed; mutation-prove every gate; every new `private` function is a row in `tracker_grants.test.sql`'s pinned roster (107 today) with its category; `npx supabase db reset && npx supabase test db` green, then the 24 gates per group, before any PR.
- **Bounded commands in every dispatch:** no single command over ~8 minutes; `db reset`, `test db`, the harness loop, the seed check, lint, `gen:types`, `check-local-ci.sh repo`, each frontend gate — separate calls with explicit timeouts; a stalled agent is resumed from its transcript after checking `git status` and that no `supabase`/`vite`/`python3` process is alive. Never `python`; `psql` absent (`docker exec -i supabase_db_osubb-app psql -U postgres -d postgres`); never stage the three untracked files under `docs/superpowers/plans/`; one implementer and one database pass at a time; reviewers read-only.

## Part B — the eight tasks (one PR each; full steps, SQL and assertion tables in the merged plan)

**Cross-cutting decisions the draft fixes** (kept): `group_id bigint not null references groups(id)` on `tasks`, `events`, `campaigns`, `completed_work_requests` with a `before insert or update` trigger per table (`<table>_sync_group_origin`, sorting before `tasks_validate_campaign`/`_hierarchy`) that derives whichever side was not written and raises 23514 on disagreement; resolver `private.group_id_for_legacy_origin(text,text,bigint)` (project > team > dept); `require_group_work_manager` locks the actor's profile and their `group_members` rows on the path `for share` and never a `groups` row (#509 ruling); ancestry probed with `path @> array[x]`; roster 107 → 112 → 120 → 120 → 122 → 123 → 126; nothing gates on level 4 after #370 (`announcements_write`, `attendance_read`, `capabilities.ts` deferred to Wave 3).

- **Task 1 — #519 `group_id` columns.** Migration adds the four columns, indexes, `campaigns.department_id` nullable + `campaigns_group_name_uidx` replacing the department index (handlers in `create/update_campaign_impl` re-issued), relaxed `events_scope_fields_ck` (a `team` Event may have `dept_id null`), `events_min_level_ck in (0,3,5,6)` after moving 4 → 5, backfill through `legacy_*` with an "unmapped row IDs" guard, `set not null`, the four trigger functions, `tasks_with_overdue` recreated. Suite `group_origin_sync.test.sql` (≈34: both derivation directions per table, mismatch, required, unmapped, fill-when-null vs FK, trigger order pin, view column); retargets in `tasks_origin`, `completed_work_requests_schema`, `campaigns_schema`, `event_constraints`, `rls_events`, `rls_event_attendance`, `set_event_rsvp`, `leadership_member_tasks`; harness `tasks_group_id_backfill_upgrade.test.sh` (happy path + orphan failure path + live post-check); `seed-fingerprint` campaign line `coalesce`; types regenerated.
- **Task 2 — #520 authority kit.** `private.group_role_of(bigint,uuid)` (manager/responsible from the path, member per Group — ruling D2), `is_group_member`, `has_group_manager`, `is_group_manager`, `is_group_responsible`, `can_manage_group_work` (level ≥ 6, or Manager/Responsible on the path of an active Group), `require_group_work_manager` (`42501 group_manage_forbidden`), `group_managers` (Managers → nearest ancestor's → Responsibles ∪ BC when none — ruling D4). Suite `group_authority.test.sql` (≈44 over Department → Child Team (min 3), Project active/archived, Independent Team, Organization Group, native automatic Group; 14 personas incl. stale-claim, inactive, claimless, anon; `pgrowlocks` lock pin; `test_race` revocation wait). `conventions.test.sql` gains the two `category` sweeps with probes (plan 10 → 14).
- **Task 3 — #521 Task predicates on Groups.** `create or replace` with unchanged signatures: `can_manage_task` (manage-work ∧ (level ≥ 6 ∨ Manager on path ∨ no Manager on path ∨ Executor not a Manager/Responsible of the chain)), `can_evaluate_task` (level ≥ 6 ∨ Manager on active path ∨ Responsible when the Executor is ordinary/outsider and not the caller), `can_read_task` (R1 level ≥ 5; R2 own Assignment/Candidature; then Minimum Level unless a Group Role on the path; R3 Group Role on the path; R4 Shared Work Visibility of the Task's Group; R6 open Opportunity, `org` by level, `local` by membership of the Task's Group — ruling D2; judged on Task and Umbrella), `is_task_team_member` (member of the Task's Group with Shared Work Visibility on), shims `can_manage_origin`/`require_origin_manager` over the resolver, `require_task_manager`/`require_task_evaluator` (Task rule first, then the locked re-validation, reasons preserved), `task_managers` (creator first, else `group_managers`), `public.can_manage_tasks()`. Suites: `can_manage_origin` rewritten as shim + `can_manage_task` matrix, `rls_tasks_read_matrix` re-derived (new personas: level-1 Coordonator, below-min-level member, stale role), `points_authorization_matrix` + Coordonator/Responsible personas, 16 command suites gain Coordonator / Responsible-on-peer / Independent-Team-peer / Department-Team-member assertions, recipient `set_eq`s per D4, `rls_task_history_read`, `tracker_management_reads`, `notify_helper`. Re-run #318's 5,000-Task timing before merge.
- **Task 4 — #522 commands, Requests, Campaigns.** `create_task(+p_group_id)` writes `group_id` (old arity dropped); `duplicate`/`approve` copy it; `private.request_deciders(p_request_id) returns setof uuid` + `can_decide_request` as the single decider source (Manager on path; Responsible for ordinary requesters; level ≥ 6), `require_request_decider` delegates, the two inline copies removed, `create_completed_work_request(+p_group_id)` (membership = `group_role_of(...) is not null` on the Group itself), `completed_work_requests_read` on `can_manage_group_work(group_id)`; `require_campaign_manager(bigint)`, `create_campaign(bigint,text)` + the `(text,text)` compat overload (distinct parameter names), `validate_task_campaign` on the path (Projects and Independent Teams may carry Campaigns), `validate_task_hierarchy`/`validate_task_campaign` `of` lists gain `group_id`. Suites `completed_work_request_commands`, `campaign_commands`, `tasks_campaign` rewritten; `create_task`, `duplicate_task`, `tasks_umbrella` extended; roster 120 → 122; types + frontend gates (`completed-work-requests.ts` compiles unchanged).
- **Task 5 — #370 `create_event`.** Wrapper + `private.create_event_impl(p_title, p_type, p_group_id, p_starts_at, p_ends_at, p_location, p_capacity, p_description, p_min_level)`; Organization Group → any live Group-Role holder or level ≥ 6, otherwise `require_group_work_manager`; `PT400 event_min_level_below_group` / `event_min_level_above_actor` (Moderator exempt); legacy `scope/dept_id/team_id` derived by the N1 trigger; the 10-arg direct-definer dropped; `create_event.test.sql` rewritten (Coordonator on a Project Event, Independent-Team Event, ancestor Manager, ordinary member refused, min-level bounds); conventions §2 grandfathered list updated; roster 122 → 123.
- **Task 6 — #248 `update_event`, `cancel_event`.** Full-state `update_event` and `cancel_event(p_event_id, p_reason)`; authority: Organization Group Events by creator or level ≥ 6, others by `can_manage_group_work` on the path; `private.event_notification_recipients` = current attendees ∪ explicit members of the Event's Group; important changes (`starts_at`/`ends_at`, location, Group, `min_level`, cancellation) notify with `dedupe_key 'event:<id>:<field>'` and `p_link '/calendar'` (OD4: `private.notify` gains `p_link`); `events.updated_at` + trigger; suites `update_event.test.sql`, `cancel_event.test.sql`; roster 123 → 126.
- **Task 7 — #523 leadership.** `leadership_leaderboard(p_group_id bigint default null, p_campaign_id bigint default null)` (Group filter includes every Group below via `path @>`); `private.department_cup_rows` credits a Task to the nearest ancestor-or-self with `competes_in_cup` only when every link up to it has `counts_toward_parent_cup` (`departments.kind` no longer read); `dept_cup` keeps `dept_id, name, points, members` and appends `group_id`; `leadership_member_tasks` adds `group_id, group_name`; suites `leadership_leaderboard`, `department_cup_task_origins`, `dept_cup`, `leadership_member_tasks` rewritten; the Dashboard's `points.ts` contract untouched.
- **Task 8 — #524 closeout.** Smoke script gains four scenarios (Coordonator manages a Project Task; a Responsible refused on a Manager's Task; an Independent-Team peer manages a teammate's Task; a below-min-level member sees no org Opportunity) and two denials; `docs/backend/conventions.md` §10 → "Groups (Waves 1–2)" (kit, shims, trigger ordering rule for future BEFORE triggers on `tasks`, OD9 fixture exception); `CONTEXT.md` identifiers (`tasks.group_id`, `events.group_id`, `campaigns.group_id`); ADR-0008/0009 amendments (`create_event` signature, the two new commands, Campaign ownership landed); `CLAUDE.md` Status.

## Verification (whole wave)

- Per PR: the bounded sequence (`db reset` → the task's suites → full run in two halves → `db lint` → the 12 harnesses → seed check → `gen:types` diff → `check-local-ci.sh repo` → frontend gates only when types changed → `db reset` + smoke). CI green; `push-staging` succeeds on merge.
- After Task 8: every persona in `rls_tasks_read_matrix` and `points_authorization_matrix` matches the ADR matrix; `conventions.test.sql` reports no `category` reader; `tracker_grants` roster 126 and every row categorised; the smoke script prints `SMOKE TEST PASSED` with its 23 steps; the four staging queries from Wave 1 still return clean, plus `select count(*) from public.tasks where group_id is null` = 0 and `select bool_and(private.group_id_for_legacy_origin(dept_id, team_id, project_id) = group_id) from public.tasks` = `t` on staging.
- Whole-wave review (most capable model) at the end, one fix dispatch, ledger closeout, execution rulings appended to the plan, workspace deleted — as in Wave 1.

## Deferred, with a home

Level 4 in `announcements_write`, `attendance_read` and `capabilities.ts`; the `responsabil` enum value; structure and roster gates on the legacy tables; `announcements.group_id`; the `create_completed_work_request` legacy parameters, the `create_campaign(text,text)` overload and the two shims; the `org` pseudo-department row; `is_interne`; `departments.kind` — all Wave 3 (#506).

## Task 0 — Issue graph (GitHub-visible; drafted to files, one go-ahead, created in dependency order)

Same mechanics as Wave 1's Task 0: every body drafted under `.superpowers/sdd/2026-09-19-group-model-wave-2/issues/` (`current-<n>.json` saved first, `new-<k>.md`, `edit-<n>.md`, `DRY-RUN.md` with a table and a unified diff per edit), shown to Alex, applied only after one go-ahead: new issues in lane order so each `## Blocked by` names the previous number, then `gh issue edit #505 --body-file` to fill the child numbers into its Scope, then the edits. No new milestone: milestone 18 "Group model — Wave 2: authority and commands" exists. Never `scripts/create-github-issues.sh`.

### A1. New issues (lane order; all milestone 18; `ready-for-agent` + area labels; `max-1h` only where honest)

| Order | Title                                                                                                                      | Labels                                  | Blocked by                                      |
| ----- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------- |
| N1    | `Groups: group_id on tasks, events, campaigns and completed-work requests, kept consistent with the legacy origin columns` | `backend`, `database`, `testing`        | `None — can start immediately.`                 |
| N2    | `Groups: the Group authority kit in private and the no-category-branch check`                                              | `backend`, `database`, `rls`, `testing` | N1                                              |
| N3    | `Tracker: task read, manage and evaluate authority decided from Groups`                                                    | `backend`, `database`, `rls`, `testing` | N2                                              |
| N4    | `Tracker: commands write group_id; Completed-work Requests and Campaigns owned and decided by Groups`                      | `backend`, `database`, `testing`        | N3                                              |
| N5    | (existing **#370**, re-milestoned) `Calendar: create_event authorizes by Group Role`                                       | keep                                    | N2 (+ existing `#276 #364 #369` already closed) |
| N6    | (existing **#248**, retitled) `Calendar: update and cancel an Event by Group Role`                                         | keep                                    | N5, `#98`                                       |
| N7    | `Leadership: Leaderboard and Cup filter by Group and attribute by Cup settings`                                            | `backend`, `database`, `testing`        | N4                                              |
| N8    | `Groups Wave 2 closeout: smoke test, roster, conventions and status`                                                       | `docs`, `backend`, `max-1h`             | N7, N6                                          |

Body rules unchanged (house rule 15 sections, CONTEXT.md terms, `## What to build` / `## Acceptance criteria` / `## Required tests` lifted from the matching plan task). #370 keeps its assignee; Alex's take-over instruction covers it.

### A2. Edits to existing issues

| Issue                              | Change                                                                                                                                                                                                                                                                                                                                                                                                                                      | Blockers / milestone                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| #505                               | Fill child numbers N1–N8 into `## Scope`; add one sentence: roster and structure gates (`add/remove_*_team_member`, `add/remove_project_member`, `grant/revoke_project_responsible`, `can_administer_team_structure`, `can_manage_department_memberships`) stay on the legacy tables until Wave 3 replaces them with Group commands.                                                                                                        | —                                                   |
| #370                               | Milestone Calendar rebuild → Wave 2; title `Calendar: create_event authorizes by Group Role`; body: wrapper + `private.create_event_impl`, `p_group_id` replaces `p_scope/p_dept_id/p_team_id` (legacy params kept as defaulted aliases for one release), `events.group_id` from N1, Organization Group Event by any Group-Role holder, ancestor Managers/Responsibles otherwise, min-level rules; Independent-Team Events become possible. | `- #520` (replace the closed `#276 #364 #369 #505`) |
| #248                               | Title `Calendar: update and cancel an Event by Group Role`; body: `update_event` and `cancel_event` do not exist today — this issue creates both (wrapper + impl), important-change notifications through `private.notify`, cancellation reason preserved.                                                                                                                                                                                  | `- #370`, `- #98` (replace `#505`)                  |
| #353                               | Append ADR-0009 note: deciders are the Group Managers of the Request's Group or an ancestor, Group Responsibles for ordinary members' Requests, BC/Moderator; "local BCE sees only their departments' requests" becomes "a Group Manager sees the Requests of their Groups and every Group below".                                                                                                                                          | `+ #522`                                            |
| #349                               | Append: `create_campaign(p_group_id, p_name)`; the Department-only kind check is gone; Campaigns of a Group tag Tasks of that Group and every Group below it.                                                                                                                                                                                                                                                                               | `#505` → `#522`                                     |
| #180, #182, #183, #184, #350, #354 | Replace the `#505` blocker with the concrete Wave 2 child each depends on: #180/#182/#184 → `#522` (campaign rule) ; #183/#350 → `#521` (Minimum-Level exclusion, manage authority); #354 → `#523`. No body change beyond the blocker line.                                                                                                                                                                                                 | as stated                                           |
| #67                                | `#505` → `#521` (the per-role sweep needs the rewritten Task authority, not the whole wave).                                                                                                                                                                                                                                                                                                                                                |                                                     |
| #68                                | Append: "Department announcements fan out to that Department's Group members, including every Group below it, once `announcements` carries `group_id` (Wave 3, #506)".                                                                                                                                                                                                                                                                      | `+ #506`                                            |
| #98, #96                           | Append an ADR-0009 note restating "organization, department, team, project" as "the Event's Group, its ancestors, and the Organization Group"; #98's children stay #370 and #248.                                                                                                                                                                                                                                                           | —                                                   |
| #379                               | Append: skip the `departments.kind` check constraint — Wave 3 (#506) drops the column.                                                                                                                                                                                                                                                                                                                                                      | —                                                   |
| #200                               | Append: raw department ids disappear when the shell reads Groups (Wave 3).                                                                                                                                                                                                                                                                                                                                                                  | `+ #506`                                            |
| #506                               | Add to Scope: the roster and structure gates listed above move to Group commands here; `create_completed_work_request`'s legacy origin parameters and `create_event`'s legacy aliases are dropped here.                                                                                                                                                                                                                                     | —                                                   |

Dry-run output as in Wave 1; #160-style conditional skips do not apply (no issue in the list can close before the go-ahead).

---

## 0. Cross-cutting decisions this plan takes (read before any task)

1. **Ownership columns.** `tasks.group_id`, `events.group_id`, `campaigns.group_id`, `completed_work_requests.group_id` — `bigint references public.groups (id)` (NO ACTION, like `tasks.team_id → teams`), plain btree index `<table>_group_idx`, `not null` after backfill. Consistency is a `before insert or update` trigger per table (`<table>_sync_group_origin` on `private.sync_<row>_group_origin()`), with **three** 23514 reasons per table: `<row>_group_origin_mismatch` (both sides given and disagreeing), `<row>_group_required` (the legacy side names no Group — an unknown legacy id, or no Origin at all), `<row>_group_origin_unmapped` (the Group has no legacy master — impossible until Wave 3 creates native Groups; campaigns have no `_unmapped`, `department_id` is nullable). The trigger name sorts after `tasks_duplicate_provenance_guard` and **before** `tasks_validate_campaign` / `tasks_validate_hierarchy` (`s` < `v`), so both validators always see `new.group_id` populated.
2. **Resolver.** `private.group_id_for_legacy_origin(p_dept_id text, p_team_id text, p_project_id bigint) returns bigint` — most specific wins (project > team > dept), because an Event row carries `team_id` **and** `dept_id` together. Used by the four triggers, the two shims (`can_manage_origin`, `require_origin_manager`), `create_task_impl`, `create_completed_work_request_impl` and the `create_campaign(text,text)` compatibility overload.
3. **Membership is per Group; only authority flows down (ruling D2).** `group_role_of(g, m)` returns the strongest of: a `manager`/`responsible` row on `g` **or any ancestor**; an explicit `member` row on `g` **itself**, or Automatic Membership of `g` itself (live level ≥ `g.min_level`). A plain member of a Department is **not** a member of its Child Team — CONTEXT.md's "local to its Origin Group", and #318 decision (a) stands: a Department Team's _local_ Opportunity admits only that Team's own members. `is_group_member(g, m)` is the same per-Group test without the role tiers, used where a setting of one Group on the path is applied (Shared Work Visibility, local Audience).
4. **Status gate.** `can_manage_group_work(g)` requires `groups.status = 'active'` for the role branches (today's `can_manage_project_work` semantics: an archived Project is managed by BC/Moderator only). The **read** predicate uses the role, status-agnostic, so an archived Project's former lead/Responsible keep reading its history (R5 today; `rls_tasks_read_matrix` pins it).
5. **One reason per `require_*`.** `require_group_work_manager` raises `42501 group_manage_forbidden`; each caller remaps inside `begin … exception when insufficient_privilege then raise …` to its own pinned reason (`task_manage_forbidden`, `task_evaluate_forbidden`, `campaign_manage_forbidden`, `calendar_manage_forbidden`) — the idiom `require_task_evaluator` and `require_project_admin` already use. No parameterized reason strings.
6. **Locks.** Under lock, `require_group_work_manager` holds the actor's `profiles` row `for share` and the caller's `group_members` row(s) on the path `for share`. It never locks a `groups` row: `for share` conflicts with `for no key update`, which every mirror upsert takes on the conflicting Group row even when it writes nothing (#509 ruling 9) — locking Groups here would re-create the `select_task_candidate` hang.
7. **Ancestry idiom.** A member's roster rows against a known path: `grp.path @> array[gm.group_id]` (the binding's operator; the join drives from the member-indexed `group_members` rows). Iterating a path root-first (nearest-manager search, Cup attribution): `unnest(grp.path) with ordinality`. Never `= any (path)`.
8. **Roster arithmetic** (start 107): N1 +5 → 112 · N2 +8 → 120 · N3 +0 → 120 · N4 +2 → 122 · #370 +1 → 123 · #248 +3 → 126 · N7 +0 → 126 · N8 +0 → 126. Signature changes that keep the count: N4 `create_task_impl` (+`p_group_id`), `create_completed_work_request_impl` (+`p_group_id`), `require_campaign_manager(text)→(bigint)`, `create_campaign_impl(text,text)→(bigint,text)`; N7 `leadership_leaderboard_impl(text,text,bigint,bigint)→(bigint,bigint)`.
9. **Level 4.** After this wave nothing in the Tracker/Calendar authority gates on level 4 (`create_event`'s `>= 4` goes in #370). Out of scope, deferred to Wave 3: `announcements_write` (`20260822225930_announcements_policies.sql:19`), `attendance_read` (`20260829140318_secure_event_attendance.sql:32`), `app/src/lib/capabilities.ts` (`manageTasks: 4`, `seeAllEvents: 4`), the `responsabil` enum value and `roles` row.
10. **Notification links (ruling OD4).** `private.notify` derives `link` from `p_task_id` only; #248 adds a trailing `p_link text default null` to it, and Event notifications pass `'/calendar'` (no per-Event route exists yet). The `tracker_grants` args row for `notify` changes; the roster count does not.

## Shared verification sequence (every task; each line is one bounded call)

```
npx supabase db reset                                              # applies migrations + seed
npx supabase test db supabase/tests/<suite-1>.test.sql ...         # the task's own suites first (red -> green)
npx supabase test db supabase/tests/[a-l]*.sql                      # full run, halved to stay under ~8 min
npx supabase test db supabase/tests/[m-z]*.sql
npx supabase db lint --level warning --fail-on warning
for h in supabase/tests/*_upgrade.test.sh; do bash "$h"; done       # 12 harnesses; split in two calls if it nears 8 min
bash scripts/check-seed-rerunnable.sh
(cd app && npm run gen:types) && git diff --stat app/src/lib/database.types.ts
bash scripts/check-local-ci.sh repo
(cd app && npm run typecheck); (cd app && npm run lint); (cd app && npm run format:check); (cd app && npm run test:run); (cd app && npm run build)   # only when database.types.ts changed
npx supabase db reset && bash scripts/smoke-tracker-commands.sh    # two calls; must print SMOKE TEST PASSED unchanged
```

Commit message shape (one commit per task; the PR body ends with the Claude Code attribution line):

```
<type>(db): <one line, imperative> (#<issue>)

<why, 2-6 lines: the ADR-0009 rule this lands, the behavior that changes, the pins that move>

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

---

## Task 1 — #519: `group_id` on tasks, events, campaigns, completed_work_requests

**Issue/Branch:** `#519` · `backend/N1-group-id-columns`

**Files**

- create `supabase/migrations/<ts>_group_id_on_work_and_events.sql`
- create `supabase/tests/tasks_group_id_backfill_upgrade.test.sh`
- create `supabase/tests/group_origin_sync.test.sql` (the two-way trigger suite)
- modify `supabase/tests/tracker_grants.test.sql` (roster 107 → 112), `campaigns_schema.test.sql`, `completed_work_requests_schema.test.sql`, `event_constraints.test.sql`, `rls_events.test.sql`, `rls_event_attendance.test.sql`, `set_event_rsvp.test.sql`, `leadership_member_tasks.test.sql`, `tasks_origin.test.sql`
- modify `scripts/seed-fingerprint.sql` (line 41: `coalesce(campaign.department_id, '-')`)
- modify `app/src/lib/database.types.ts` (regenerated)

**Interfaces**

- produces columns `tasks.group_id`, `events.group_id`, `campaigns.group_id`, `completed_work_requests.group_id` (`bigint not null references public.groups (id)`), indexes `tasks_group_idx`, `events_group_idx`, `campaigns_group_idx`, `completed_work_requests_group_idx`, unique index `campaigns_group_name_uidx (group_id, lower(name))`
- produces `private.group_id_for_legacy_origin(text, text, bigint) returns bigint` [none]; `private.sync_task_group_origin()`, `private.sync_event_group_origin()`, `private.sync_campaign_group_origin()`, `private.sync_request_group_origin()` [trigger]
- changes `campaigns.department_id` → nullable; drops `campaigns_department_name_uidx`; `events_scope_fields_ck` relaxed; `events_min_level_ck` → `in (0, 3, 5, 6)`; `tasks_with_overdue` recreated (now carries `group_id`)
- consumes `groups.legacy_dept_id / legacy_team_id / legacy_project_id`, `teams.dept_id`

**Decision recorded here — the old campaign unique index is dropped, not kept.** `(department_id, lower(name))` is implied by `(group_id, lower(name))` for every Department Campaign because the trigger makes `department_id` a function of `group_id`; keeping both means two unique checks per write and two constraint names for `create_campaign_impl`'s `unique_violation` handler to recognise. Dropping it here means the handler in `private.create_campaign_impl` / `private.update_campaign_impl` is re-issued in this migration (`create or replace`, one constraint name changed) so a duplicate name never surfaces as a raw `23505` between N1 and N4. `campaigns_schema.test.sql:59` pins the new name.

**Steps**

- [ ] 1. Write `group_origin_sync.test.sql` first (fixture prefix = the issue number zero-padded, e.g. `52100000-0000-0000-0000-0000000000NN`; a Department Team under `edu`, an Independent Team and an active Project created through the legacy tables so the mirror creates the Groups). Assertion list under **Tests**. Run it: red.
- [ ] 2. Migration header and the resolver:

```sql
-- #519: group_id on tasks, events, campaigns and completed_work_requests -- backfilled from the
-- legacy Origin through groups.legacy_*, kept consistent both ways by trigger (ADR-0009 Wave 2).
-- Legacy columns stay the write master; the two-way trigger lets the Wave 2 commands write
-- group_id while every older writer (seed, smoke script, the 21 commands until #522) keeps
-- writing dept_id/team_id/project_id.

create function private.group_id_for_legacy_origin(
  p_dept_id text, p_team_id text, p_project_id bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  -- Most specific first: an Event carries team_id AND its parent dept_id together.
  select grp.id
    from public.groups as grp
   where case
           when p_project_id is not null then grp.legacy_project_id = p_project_id
           when p_team_id    is not null then grp.legacy_team_id    = p_team_id
           when p_dept_id    is not null then grp.legacy_dept_id    = p_dept_id
           else false
         end;
$$;
comment on function private.group_id_for_legacy_origin(text, text, bigint) is
  'The Group that masters a legacy Origin (project, else team, else department). Null when nothing matches. Wave 2 bridge; dropped in Wave 3 (#519).';
revoke execute on function private.group_id_for_legacy_origin(text, text, bigint)
  from public, anon, authenticated, service_role;
```

- [ ] 3. Columns, indexes, the Campaign changes, the two Event constraints:

```sql
drop view public.tasks_with_overdue;

alter table public.tasks                   add column group_id bigint references public.groups (id);
alter table public.events                  add column group_id bigint references public.groups (id);
alter table public.campaigns               add column group_id bigint references public.groups (id);
alter table public.completed_work_requests add column group_id bigint references public.groups (id);

create index tasks_group_idx                   on public.tasks (group_id);
create index events_group_idx                  on public.events (group_id);
create index campaigns_group_idx               on public.campaigns (group_id);
create index completed_work_requests_group_idx on public.completed_work_requests (group_id);

alter table public.campaigns alter column department_id drop not null;
drop index public.campaigns_department_name_uidx;
create unique index campaigns_group_name_uidx on public.campaigns (group_id, lower(name));

-- events: an Independent Team has no Department; scope stays until Wave 3 and is derived
-- from the Group by the trigger below.
alter table public.events drop constraint events_scope_fields_ck;
alter table public.events add constraint events_scope_fields_ck check (
     (scope = 'org'     and dept_id is null     and team_id is null     and project_id is null)
  or (scope = 'dept'    and dept_id is not null and team_id is null     and project_id is null)
  or (scope = 'team'    and team_id is not null and project_id is null)
  or (scope = 'project' and dept_id is null     and team_id is null     and project_id is not null)
);

-- Level 4 is retired (ADR-0009 Ranks). Existing rows move UP to 5, never down: a gate that
-- meant "Responsible+" must not silently open to Voluntar cu Drept de Vot.
update public.events set min_level = 5 where min_level = 4;
alter table public.events drop constraint events_min_level_ck;
alter table public.events add constraint events_min_level_ck check (min_level in (0, 3, 5, 6));
```

- [ ] 4. Backfill with plain updates **before** the triggers exist, then the unmapped-row guard that names offenders (the `tasks_origin_upgrade.test.sh` "originless Task IDs:" pattern), then `set not null`:

```sql
update public.tasks set group_id = private.group_id_for_legacy_origin(dept_id, team_id, project_id) where group_id is null;
update public.events
   set group_id = case when scope = 'org'
                       then (select grp.id from public.groups as grp where grp.legacy_dept_id = 'org')
                       else private.group_id_for_legacy_origin(
                              case when scope = 'dept' then dept_id end, team_id, project_id) end
 where group_id is null;
update public.campaigns set group_id = private.group_id_for_legacy_origin(department_id, null, null) where group_id is null;
update public.completed_work_requests set group_id = private.group_id_for_legacy_origin(dept_id, team_id, project_id) where group_id is null;

do $$
declare v_ids text;
begin
  select string_agg(format('%s:%s', tbl, id), ', ') into v_ids from (
    select 'tasks' as tbl, id from public.tasks where group_id is null
    union all select 'events', id from public.events where group_id is null
    union all select 'campaigns', id from public.campaigns where group_id is null
    union all select 'completed_work_requests', id from public.completed_work_requests where group_id is null
  ) as unmapped;
  if v_ids is not null then
    raise exception 'group_id backfill: rows whose Origin has no Group (run private.sync_groups_from_legacy() first) -- unmapped row IDs: %', v_ids;
  end if;
end $$;

alter table public.tasks                   alter column group_id set not null;
alter table public.events                  alter column group_id set not null;
alter table public.campaigns               alter column group_id set not null;
alter table public.completed_work_requests alter column group_id set not null;
```

- [ ] 5. The four trigger functions. The Task one in full; the other three differ only in the columns named:

```sql
create function private.sync_task_group_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy_changed boolean;
  v_group_changed  boolean;
  v_from_legacy    bigint;
  v_grp            public.groups%rowtype;
begin
  v_legacy_changed := tg_op = 'INSERT'
    or new.dept_id    is distinct from old.dept_id
    or new.team_id    is distinct from old.team_id
    or new.project_id is distinct from old.project_id;
  v_group_changed  := tg_op = 'INSERT' or new.group_id is distinct from old.group_id;
  v_from_legacy    := private.group_id_for_legacy_origin(new.dept_id, new.team_id, new.project_id);

  if (tg_op = 'INSERT' and new.group_id is not null
      and num_nonnulls(new.dept_id, new.team_id, new.project_id) = 0)
     or (tg_op = 'UPDATE' and v_group_changed and not v_legacy_changed) then
    -- Group side written: derive the legacy triple.
    select * into v_grp from public.groups where id = new.group_id;
    if not found then
      return new;                                   -- tasks_group_id_fkey answers
    end if;
    if num_nonnulls(v_grp.legacy_dept_id, v_grp.legacy_team_id, v_grp.legacy_project_id) = 0 then
      raise exception using errcode = '23514', message = 'task_group_origin_unmapped';
    end if;
    new.dept_id    := v_grp.legacy_dept_id;
    new.team_id    := v_grp.legacy_team_id;
    new.project_id := v_grp.legacy_project_id;
  elsif new.group_id is null
     or (tg_op = 'UPDATE' and v_legacy_changed and not v_group_changed) then
    -- Legacy side written (every pre-Wave-2 writer): derive the Group.
    if v_from_legacy is null then
      raise exception using errcode = '23514', message = 'task_group_required';
    end if;
    new.group_id := v_from_legacy;
  elsif v_from_legacy is distinct from new.group_id then
    raise exception using errcode = '23514', message = 'task_group_origin_mismatch';
  end if;
  return new;
end;
$$;
comment on function private.sync_task_group_origin() is
  'Keeps tasks.group_id and the legacy Origin triple consistent both ways (ADR-0009 Wave 2): a legacy write derives group_id, a Group write derives dept_id/team_id/project_id, and a row that sets both inconsistently is refused (23514 task_group_origin_mismatch). task_group_required: the legacy side names no Group; task_group_origin_unmapped: the Group has no legacy master (only reachable once Wave 3 creates native Groups).';

create trigger tasks_sync_group_origin
before insert or update of group_id, dept_id, team_id, project_id on public.tasks
for each row execute function private.sync_task_group_origin();
```

`private.sync_request_group_origin()` is the same body over `completed_work_requests` (reasons `request_group_required` / `request_group_origin_unmapped` / `request_group_origin_mismatch`; trigger `completed_work_requests_sync_group_origin … of group_id, dept_id, team_id, project_id`).

`private.sync_campaign_group_origin()`: the legacy side is `department_id` alone; the Group side sets `department_id := v_grp.legacy_dept_id` (null for a Team or Project Group — the reason the column went nullable; no `_unmapped` reason); reasons `campaign_group_required` / `campaign_group_origin_mismatch`; trigger `campaigns_sync_group_origin … of group_id, department_id`.

`private.sync_event_group_origin()` — the decisive lines (the branch structure is the Task function's; the legacy side is `(scope, dept_id, team_id, project_id)`):

```sql
  -- legacy -> Group: scope decides which column is the Origin
  v_from_legacy := case when new.scope = 'org'
                        then (select grp.id from public.groups as grp where grp.legacy_dept_id = 'org')
                        else private.group_id_for_legacy_origin(
                               case when new.scope = 'dept' then new.dept_id end, new.team_id, new.project_id) end;
  -- Group -> legacy: scope, the Origin column, and the Team's parent Department
  if v_grp.legacy_dept_id = 'org' then
    new.scope := 'org';     new.dept_id := null; new.team_id := null; new.project_id := null;
  elsif v_grp.legacy_dept_id is not null then
    new.scope := 'dept';    new.dept_id := v_grp.legacy_dept_id; new.team_id := null; new.project_id := null;
  elsif v_grp.legacy_team_id is not null then
    new.scope := 'team';    new.team_id := v_grp.legacy_team_id; new.project_id := null;
    select team.dept_id into new.dept_id from public.teams as team where team.id = v_grp.legacy_team_id;
  elsif v_grp.legacy_project_id is not null then
    new.scope := 'project'; new.project_id := v_grp.legacy_project_id; new.dept_id := null; new.team_id := null;
  else
    raise exception using errcode = '23514', message = 'event_group_origin_unmapped';
  end if;
  -- legacy-path normalisation: a Team Event fills its parent Department when the caller left it
  -- null (an Independent Team keeps null). A client-supplied WRONG Department is never
  -- overwritten -- events_team_department_fkey keeps answering 23503 for it.
  if new.scope = 'team' and new.dept_id is null then
    select team.dept_id into new.dept_id from public.teams as team where team.id = new.team_id;
  end if;
```

Trigger: `events_sync_group_origin before insert or update of group_id, scope, dept_id, team_id, project_id on public.events`.

- [ ] 6. Recreate `tasks_with_overdue` verbatim from `20260915151447` (definition, `revoke all … / grant select … to authenticated, service_role`, comment) so `task.*` now carries `group_id`.
- [ ] 7. Re-issue `private.create_campaign_impl(text, text)` and `private.update_campaign_impl(bigint, text)` with `create or replace`, changing only `campaigns_department_name_uidx` → `campaigns_group_name_uidx` in the `unique_violation` handler (`create or replace` preserves their ACL; the roster does not move).
- [ ] 8. Grants: `revoke execute … from public, anon, authenticated, service_role` on the five new functions, no grant back (resolver `none`, four `trigger`). Column comments on the four `group_id` columns (Wave 2 bridge; legacy stays master; Wave 3 drops the triple).
- [ ] 9. Update the suites listed under **Files** (details below), the roster (+5 rows, count 112, label text), `scripts/seed-fingerprint.sql`.
- [ ] 10. Write `tasks_group_id_backfill_upgrade.test.sh` (outline below). Run the bounded sequence. Regenerate types.

**Tests**

`group_origin_sync.test.sql` (new; owner-side inserts; `plan(N)` counted at the end):

| #     | operation                                                                                                                                                                                                                                                  | expectation                                                                                                                           | mutation caught                                                      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1–5   | insert task / event / campaign / request with legacy columns only (dept, dept team, independent team, project; org Event)                                                                                                                                  | `group_id` = the mirrored Group                                                                                                       | trigger not deriving                                                 |
| 6–9   | insert each with `group_id` only                                                                                                                                                                                                                           | legacy triple / `department_id` / `scope`+`dept_id`+`team_id` derived; the Independent-Team Event gets `scope = 'team', dept_id null` | derivation branch missing; relaxed `events_scope_fields_ck` reverted |
| 10–13 | insert each with both sides consistent                                                                                                                                                                                                                     | lives                                                                                                                                 | mismatch branch too strict                                           |
| 14–17 | insert each with both sides inconsistent                                                                                                                                                                                                                   | `throws_ok('23514', '<row>_group_origin_mismatch')`                                                                                   | mismatch branch missing                                              |
| 18–19 | update task `set dept_id = 'pr'` (legacy changed, Group unchanged) → `group_id` follows; update `set group_id = <pr Group>` → `dept_id` follows                                                                                                            | both UPDATE directions                                                                                                                | UPDATE branches missing                                              |
| 20    | update task `set group_id = <pr Group>, dept_id = 'edu'`                                                                                                                                                                                                   | mismatch                                                                                                                              | both-changed check                                                   |
| 21–22 | insert task with an unknown `dept_id` / with no Origin at all                                                                                                                                                                                              | `throws_ok('23514', 'task_group_required')`                                                                                           | trigger returning null (NOT NULL would answer 23502 instead)         |
| 23    | insert task with the `group_id` of a native Group (owner-created `insert into public.groups (name, category)` — the `rls_deny_by_default` precedent)                                                                                                       | `task_group_origin_unmapped`                                                                                                          | unmapped guard missing                                               |
| 24    | event insert `scope = 'team'`, `team_id` = dept team, `dept_id null`                                                                                                                                                                                       | lives; `dept_id` filled from the Team                                                                                                 | fill-when-null missing                                               |
| 25    | event insert `scope = 'team'`, `team_id` = dept team, `dept_id = 'pr'` (wrong)                                                                                                                                                                             | `throws_ok('23503', null)` — the FK, never overwritten                                                                                | overwrite instead of fill                                            |
| 26–29 | `col_not_null` on the four `group_id` columns; `fk_ok` to `groups`                                                                                                                                                                                         | shape                                                                                                                                 | NOT NULL/FK dropped                                                  |
| 30    | `has_index` ×4 and `pg_get_indexdef('public.campaigns_group_name_uidx'::regclass)`                                                                                                                                                                         | shape                                                                                                                                 | index missing                                                        |
| 31    | `hasnt_index('campaigns_department_name_uidx')` + `col_is_null('campaigns', 'department_id')`                                                                                                                                                              | decision recorded                                                                                                                     | old index kept                                                       |
| 32    | `min_level 4` insert → `throws_ok('23514', 'new row for relation "events" violates check constraint "events_min_level_ck"')`; `min_level 5` lives                                                                                                          | level 4 retired                                                                                                                       | old list restored                                                    |
| 33    | trigger order pin: `array(select tgname from pg_trigger where tgrelid = 'public.tasks'::regclass and not tgisinternal order by tgname)` = `{tasks_duplicate_provenance_guard, tasks_sync_group_origin, tasks_validate_campaign, tasks_validate_hierarchy}` | derive-before-validate order                                                                                                          | a rename that breaks ordering                                        |
| 34    | `has_column('public', 'tasks_with_overdue', 'group_id')`                                                                                                                                                                                                   | view recreated                                                                                                                        | the `*` expansion trap                                               |

Existing suites to retarget (one line each, the reason in the assertion text):

- `tasks_origin.test.sql:56–60, 84–89` — 'missing Origin' and 'lose its Origin' become `throws_ok('23514', 'task_group_required')` (the trigger answers before `tasks_exactly_one_origin_check` can; the two-Origins cases still hit the constraint).
- `completed_work_requests_schema.test.sql:117–121` → `request_group_required`; `columns_are` gains `group_id`.
- `campaigns_schema.test.sql` — `columns_are` gains `group_id`; `col_not_null department_id` → `col_is_null`; line 59 names `campaigns_group_name_uidx`; add `fk_ok group_id → groups`.
- `event_constraints.test.sql:49–53` (project without project), `:163–166`, `:188–191` → `event_group_required`; `:182–186` 'a team event requires its department' → `lives_ok` + `is(dept_id, 'edu')`; `:193–197` stays `23503`.
- `rls_events.test.sql` — the two `min_level 4` rows become 5 ('Dept gated 5', 'Recrutare grea' 5); the Responsabil set drops them; BCE/BC sets keep them.
- `rls_event_attendance.test.sql:69`, `set_event_rsvp.test.sql:41` — 'RSVP imagine' `min_level 4 → 3` (still hidden from the level-1 Voluntar, still read by the level-4 persona; every expectation unchanged).
- `leadership_member_tasks.test.sql:41–43` — the exclusion list gains `('group_id')` with a `-- #523 exposes it` note (removed again in Task 7).
- `tracker_grants.test.sql` — five rows: `group_id_for_legacy_origin` `none`; `sync_task_group_origin`, `sync_event_group_origin`, `sync_campaign_group_origin`, `sync_request_group_origin` `trigger`; count 107 → 112.

**Harness outline — `supabase/tests/tasks_group_id_backfill_upgrade.test.sh`** (model: `tasks_origin_upgrade.test.sh` for the teardown and the failure path, `groups_backfill_upgrade.test.sh` for the post-transaction proof)

1. `live_before=$(… select count(*) from public.tasks where group_id is not null)`.
2. One rollback-only transaction: `drop view public.tasks_with_overdue`; `drop trigger tasks_sync_group_origin on public.tasks` and the three siblings; drop the four NOT NULLs, FKs, indexes and columns; `drop index public.campaigns_group_name_uidx`; re-create `campaigns_department_name_uidx`; re-add the pre-N1 `events_scope_fields_ck` (team requires `dept_id`) and `events_min_level_ck (0,3,4,5,6)`. Insert legacy-shaped fixtures (prefix from the issue): a Department Task, a Department-Team Task, an Independent-Team Task, a Project Task, an org Event, a Department-Team Event with its Department, one Event at `min_level 4`, a Campaign, a Request. Do **not** truncate `groups` (the backfill needs the mirror). `cat "$migration"`, then assert: every fixture row's `group_id` equals the Group whose `legacy_*` names its Origin; the `min_level 4` Event became 5; `campaigns.department_id` still filled; the old index gone and the new present; `rollback`.
3. Failure path, second transaction: same teardown, then a Team with no Group — `alter table public.teams disable trigger teams_mirror_group; insert into public.teams (id, name, dept_id) values ('upgrade-orphan-N1', 'Orphan N1', null); alter table public.teams enable trigger teams_mirror_group; insert into public.tasks (title, difficulty, team_id) values ('Orphan N1', 1, 'upgrade-orphan-N1');` then `cat "$migration"` → must fail; assert stderr contains `unmapped row IDs:` and `tasks:`; the `tasks` fingerprint before/after is identical (rolled back).
4. Post-check: `live_after == live_before` and `select bool_and(group_id is not null) from public.tasks` is `t`.

**Verification:** shared sequence; the new harness runs in the loop; `check-seed-rerunnable.sh` proves the seed's delete order (`tasks`, `completed_work_requests`, `campaigns`, `events` before `projects`/`teams`) survives the four new FKs; smoke unchanged.

**Commit:** `feat(db): group_id on tasks, events, campaigns and completed-work requests, kept in sync with the legacy Origin both ways (#519)`.

---

## Task 2 — #520: the Group authority kit + `group_authority.test.sql` + the no-category-branch check

**Issue/Branch:** `#520` · `backend/N2-group-authority-kit`

**Files**

- create `supabase/migrations/<ts>_group_authority_kit.sql`
- create `supabase/tests/group_authority.test.sql`
- modify `supabase/tests/conventions.test.sql` (`plan(10)` → `plan(14)`; two `pg_temp` helpers; probe function + probe policy), `supabase/tests/tracker_grants.test.sql` (roster 112 → 120)

**Interfaces** (all `security definer`, `set search_path = ''`; `stable` where `language sql`)

- `private.group_role_of(p_group_id bigint, p_member uuid) returns text` [none]
- `private.is_group_member(p_group_id bigint, p_member uuid) returns boolean` [none]
- `private.has_group_manager(p_group_id bigint) returns boolean` [none]
- `private.is_group_manager(p_group_id bigint) returns boolean` [predicate]
- `private.is_group_responsible(p_group_id bigint) returns boolean` [predicate]
- `private.can_manage_group_work(p_group_id bigint) returns boolean` [predicate]
- `private.require_group_work_manager(p_group_id bigint) returns uuid` [require]
- `private.group_managers(p_group_id bigint) returns setof uuid` [none]
- consumes `groups (path, status, automatic_membership, min_level)`, `group_members`, `private.actor_level`, `public.auth_is_member`

**Steps**

- [ ] 1. Write `group_authority.test.sql` (fixture tree below) and the `conventions.test.sql` additions. Red.
- [ ] 2. The kit:

```sql
-- #520: the Group authority kit (ADR-0009 Wave 2): one family of predicates over groups.path
-- and group_members.group_role that #521 puts under every Task predicate, #522 under the
-- Request and Campaign commands, #370/#248 under the Calendar. Nothing here reads the
-- presentation label on groups (conventions.test.sql now machine-checks that).

create function private.group_role_of(p_group_id bigint, p_member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- Strongest Group Role the live active member holds on the Group: manager > responsible >
  -- member. Manager and Responsible flow down from any ancestor; plain membership is per Group
  -- (ruling D2) -- an explicit 'member' row on the Group itself, or Automatic Membership of the
  -- Group itself at or above its Minimum Level. Null for an inactive member or no relationship.
  with target as (
    select grp.id, grp.path, grp.automatic_membership, grp.min_level
      from public.groups as grp where grp.id = p_group_id
  ),
  held as (
    select case gm.group_role when 'manager' then 1 else 2 end as rank
      from target
      join public.group_members as gm
        on target.path @> array[gm.group_id]
       and gm.member_id = p_member
       and gm.group_role in ('manager', 'responsible')
    union all
    select 3
      from target
      join public.group_members as gm
        on gm.group_id = target.id
       and gm.member_id = p_member
       and gm.group_role = 'member'
    union all
    select 3
      from target
     where target.automatic_membership
       and private.actor_level(p_member) >= target.min_level
  )
  select case min(held.rank) when 1 then 'manager' when 2 then 'responsible' when 3 then 'member' end
    from held
   where private.actor_level(p_member) is not null;
$$;

create function private.is_group_member(p_group_id bigint, p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Membership of THIS Group only (a setting of one Group on the path is applied per Group):
  -- an explicit roster row of any role, or Automatic Membership at or above its Minimum Level.
  select private.actor_level(p_member) is not null
     and exists (
       select 1
         from public.groups as grp
        where grp.id = p_group_id
          and (exists (select 1 from public.group_members as gm
                        where gm.group_id = grp.id and gm.member_id = p_member)
               or (grp.automatic_membership and private.actor_level(p_member) >= grp.min_level)));
$$;

create function private.has_group_manager(p_group_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.groups as target
      join public.group_members as gm on target.path @> array[gm.group_id]
      join public.profiles as manager on manager.id = gm.member_id and manager.status = 'activ'
     where target.id = p_group_id
       and gm.group_role = 'manager');
$$;

create function private.is_group_manager(p_group_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and private.group_role_of(p_group_id, (select auth.uid())) = 'manager';
$$;

create function private.is_group_responsible(p_group_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and private.group_role_of(p_group_id, (select auth.uid())) = 'responsible';
$$;

create function private.can_manage_group_work(p_group_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- BC/Moderator everywhere (archived Groups included, as can_manage_origin's level>=6
  -- short-circuit does today); otherwise a Group Manager or Group Responsible on the path of
  -- an ACTIVE Group (can_manage_project_work's status rule, generalised). False for a missing
  -- Group, so an unknown id is indistinguishable from an unauthorised one.
  select coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null
     and exists (
       select 1
         from public.groups as grp
        where grp.id = p_group_id
          and (private.actor_level() >= 6
               or (grp.status = 'active'
                   and private.group_role_of(grp.id, (select auth.uid())) in ('manager', 'responsible'))));
$$;

create function private.require_group_work_manager(p_group_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_level integer;
begin
  if v_actor is null or not coalesce(private.can_manage_group_work(p_group_id), false) then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  select role.level into v_level
    from public.profiles as profile
    join public.roles as role on role.id = profile.role
   where profile.id = v_actor and profile.status = 'activ'
   for share of profile;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  if v_level >= 6 then
    return v_actor;
  end if;
  -- The roster rows the authority rests on -- never the groups row (for share conflicts with
  -- the for no key update every mirror upsert takes on a Group row, #509 ruling 9).
  perform 1
     from public.groups as target
     join public.group_members as gm on target.path @> array[gm.group_id]
    where target.id = p_group_id
      and gm.member_id = v_actor
      and gm.group_role in ('manager', 'responsible')
      for share of gm;
  if not found then
    raise exception using errcode = '42501', message = 'group_manage_forbidden';
  end if;
  return v_actor;
end;
$$;

create function private.group_managers(p_group_id bigint)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_path  bigint[];
  v_depth integer;
  v_ids   uuid[];
begin
  select grp.path into v_path from public.groups as grp where grp.id = p_group_id;
  if v_path is null then
    return;
  end if;
  -- The Group's own live Managers, else the nearest ancestor's. When no Manager exists anywhere
  -- on the path (ruling D4, "peers manage, BC evaluates"): the chain's live Group Responsibles
  -- plus every live BC/Moderator, so the peers who manage the work hear about it and evaluation
  -- notices still reach BC (ADR-0009 Group Roles).
  for v_depth in reverse cardinality(v_path) .. 1 loop
    select array_agg(gm.member_id) into v_ids
      from public.group_members as gm
      join public.profiles as manager on manager.id = gm.member_id and manager.status = 'activ'
     where gm.group_id = v_path[v_depth]
       and gm.group_role = 'manager';
    if v_ids is not null then
      return query select unnest(v_ids);
      return;
    end if;
  end loop;
  return query
    select gm.member_id
      from public.group_members as gm
      join public.profiles as peer on peer.id = gm.member_id and peer.status = 'activ'
     where v_path @> array[gm.group_id]
       and gm.group_role = 'responsible'
    union
    select profile.id
      from public.profiles as profile
      join public.roles as role on role.id = profile.role
     where role.level >= 6 and profile.status = 'activ';
end;
$$;

revoke execute on function
  private.group_role_of(bigint, uuid), private.is_group_member(bigint, uuid),
  private.has_group_manager(bigint), private.is_group_manager(bigint),
  private.is_group_responsible(bigint), private.can_manage_group_work(bigint),
  private.require_group_work_manager(bigint), private.group_managers(bigint)
  from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.is_group_manager(bigint), private.is_group_responsible(bigint),
  private.can_manage_group_work(bigint) to authenticated;
```

- [ ] 3. `conventions.test.sql` additions (after the four existing helpers; header comment gains a sixth machine-checked rule):

```sql
-- ADR-0009 Groups: no authority, visibility, membership, notification or Cup rule may branch
-- on the Group's presentation label. The three Wave 1 mirror functions WRITE that column and
-- are excluded by name.
create function pg_temp.category_branching_functions() returns text[]
language sql as $$
  select coalesce(array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname), '{}')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.prokind = 'f'
     and p.proname not in ('sync_department_groups', 'sync_team_groups', 'sync_project_groups')
     and pg_get_functiondef(p.oid) ~ '\mcategory\M';
$$;
create function pg_temp.category_branching_policies() returns text[]
language sql as $$
  select coalesce(array_agg(pol.tablename || '.' || pol.policyname order by 1), '{}')
    from pg_policies pol
   where pol.schemaname = 'public'
     and (coalesce(pol.qual, '') ~ '\mcategory\M' or coalesce(pol.with_check, '') ~ '\mcategory\M');
$$;
select is(pg_temp.category_branching_functions(), '{}'::text[],
  'no function in public/private branches on groups.category (ADR-0009: a presentation label only)');
select is(pg_temp.category_branching_policies(), '{}'::text[],
  'no policy qual or with_check mentions groups.category');
-- Non-hollow: a probe function and a probe policy that do branch must be named.
create function public.conventions_probe_category(g bigint) returns boolean
language sql security definer set search_path = '' as $$
  select exists (select 1 from public.groups where id = g and category = 'team') $$;
create policy conventions_probe_category on public.groups
  for select to authenticated using (public.auth_is_member() and category = 'team');
select is(pg_temp.category_branching_functions(), array['public.conventions_probe_category'],
  'a function whose body reads category is reported by name');
select is(pg_temp.category_branching_policies(), array['groups.conventions_probe_category'],
  'a policy whose qual reads category is reported by name');
drop policy conventions_probe_category on public.groups;
drop function public.conventions_probe_category(bigint);
```

Because the sweep reads the **definition text**, the word `category` must never appear inside a function body — not even in a comment (put such prose in `comment on function`). `pg_get_functiondef` is called only for `prokind = 'f'` (it raises for aggregates and procedures). The three excluded names are the only ones allowed to carry it; a fourth writer needs a reasoned edit of the allow-list.

- [ ] 4. Roster: eight rows (categories above); count 112 → 120; label text. Bounded sequence.

**Tests — `group_authority.test.sql`** (fixture prefix from the issue; built through the legacy tables so the mirror creates the Groups; then, as owner and inside the rolled-back transaction, `update public.groups set min_level = 3 where legacy_team_id = '<child team>'` to obtain a gated Child Group — `min_level` is not among the columns the Department/Team resync rewrites, so the mirror leaves it alone; plus one native `insert into public.groups (name, category, min_level, automatic_membership) values ('AG N2', 'team', 3, true)` for the Automatic-Membership case, the `rls_deny_by_default` precedent).

Tree: root Department `edu` (exists) with Child Team `t-N2-dt` (min 3 after the update); Project `P-N2` (top-level, active) and `P-N2-arch` (archived, same leader); Independent Team `t-N2-ind` (two members); the Organization Group (exists); `AG N2` (native, automatic, min 3).

Personas: `bc` (level 6); `bce_edu` (rank bce + `member_departments edu` → manager of `edu`); `bce_foreign` (bce in `pr`); `coord` (voluntar, leader of `P-N2` → manager of the Project Group; also in `member_departments edu`); `resp` (voluntar, `project_role responsible` on `P-N2`); `ordinary_edu` (voluntar in `edu`); `ordinary_proj` (voluntar, `project_role member`); `ind_a`, `ind_b` (voluntar, `team_members t-N2-ind` → responsibles); `dt_member` (voluntar, `team_members t-N2-dt`, level 1 — below the child's min 3); `vot` (level 3, no memberships); `inactive_bce` (bce, edu, `status inactiv`); `claimless` (voluntar, edu, JWT `{"provider":"email"}`); `anon`.

| #     | persona × operation                                                                                                                                                                                                                                                                  | expected                                             | mutation caught                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| 1–8   | shape: eight functions exist, `security definer`, `search_path=""`, grants per category (3 predicates executable by `authenticated`, the other 5 by nobody), `anon` execute → `42501` on `can_manage_group_work`                                                                     | shape                                                | grant drift                                                             |
| 9     | `group_role_of(dt, bce_edu)` = `manager`                                                                                                                                                                                                                                             | authority flows down                                 | ancestor join dropped                                                   |
| 10    | `group_role_of(edu, dt_member)` is null                                                                                                                                                                                                                                              | membership never flows up                            | wrong join direction                                                    |
| 11    | `group_role_of(dt, ordinary_edu)` is null, while `group_role_of(edu, ordinary_edu)` = `member`                                                                                                                                                                                       | plain membership is per Group (ruling D2)            | `member` tier joined on the whole path                                  |
| 12    | `group_role_of(P, coord)` = `manager`, `(P, resp)` = `responsible`, `(P, ordinary_proj)` = `member`, `(P, ordinary_edu)` null                                                                                                                                                        | role vocabulary                                      | role mapping                                                            |
| 13    | `group_role_of(ind, ind_a)` = `responsible`                                                                                                                                                                                                                                          | Independent Team                                     | rank order                                                              |
| 14    | `group_role_of(edu, coord)` = `member` while `group_role_of(P, coord)` = `manager`                                                                                                                                                                                                   | roles are per path, not global                       | global max across all Groups                                            |
| 15    | `group_role_of(org, vot)` = `member`; `(AG, vot)` = `member`; `(AG, ordinary_edu)` null (level 1 < 3)                                                                                                                                                                                | Automatic Membership honours `min_level`             | min gate dropped                                                        |
| 16    | `group_role_of(edu, inactive_bce)` null                                                                                                                                                                                                                                              | liveness                                             | `actor_level` gate dropped                                              |
| 17–18 | `has_group_manager(dt)` true; `has_group_manager(ind)` false; inside a savepoint deactivate `bce_edu` → `has_group_manager(dt)` false                                                                                                                                                | "no manager on the path"                             | status filter dropped                                                   |
| 19–24 | `can_manage_group_work(edu)` as bc ✔, bce_edu ✔, bce_foreign ✘, ordinary_edu ✘, vot ✘, claimless ✘                                                                                                                                                                                   | matrix                                               | any branch                                                              |
| 25–28 | `can_manage_group_work(dt)` as bce_edu ✔ (ancestor), dt_member ✘; `(P)` as coord ✔, resp ✔, ordinary_proj ✘; `(ind)` as ind_a ✔, bce_edu ✘                                                                                                                                           | path + role                                          | ancestor / responsible branch                                           |
| 29–30 | `can_manage_group_work(P_arch)` as coord ✘, as bc ✔                                                                                                                                                                                                                                  | status gate only below level 6                       | status dropped / applied to BC                                          |
| 31    | stale JWT: `test_login(ordinary_edu, {member_role bc, member_level 6, …})` → `can_manage_group_work(edu)` false                                                                                                                                                                      | live level, never the claim                          | JWT read                                                                |
| 32    | `is_group_manager(P)` coord ✔ resp ✘; `is_group_responsible(P)` resp ✔ coord ✘                                                                                                                                                                                                       | the two caller predicates                            | swapped                                                                 |
| 33–36 | `require_group_work_manager(P)` as owner with `request.jwt.claims` of coord → coord's uuid; as resp → uuid; as ordinary_proj → `throws_ok('42501', 'group_manage_forbidden')`; as claimless → same                                                                                   | require semantics                                    | reason string / gate                                                    |
| 37    | `pgrowlocks` after `require_group_work_manager(P)` as coord: the `group_members (P, coord)` row is `For Share`; no `groups` row is locked                                                                                                                                            | lock discipline                                      | locking the Group row                                                   |
| 38    | `test_race`: A = `require_group_work_manager(P)` as resp holding its tx; B = `remove_project_member` of resp as bc → `b_waited = true`                                                                                                                                               | revocation serialises behind the decision            | `for share` dropped                                                     |
| 39–41 | `group_managers(dt)` = {bce_edu}; `group_managers(ind)` = the Team's live Responsibles ∪ every live level ≥ 6 (ruling D4; bc only on the BC side, after quieting the seed's bc/moderator the #344 way); `group_managers(P)` = {coord} — Responsibles excluded while a Manager exists | nearest-manager search, then the no-Manager fallback | fallback order, or Responsibles leaking into a Group that has a Manager |
| 42    | deactivate `coord` in a savepoint → `group_managers(P)` = the BC fallback                                                                                                                                                                                                            | liveness                                             | status filter                                                           |
| 43–44 | `is_group_member(dt, dt_member)` true, `(edu, dt_member)` false, `(org, vot)` true, `(AG, ordinary_edu)` false; `anon` → `42501`                                                                                                                                                     | per-Group membership                                 | `is_group_member` walking the path                                      |

`plan(44)` (adjust to the final count).

**Commit:** `feat(db): Group authority kit -- group_role_of, can_manage_group_work, require_group_work_manager, group_managers -- and the no-category-branch conventions check (#520)`.

---

## Task 3 — #521: the Task predicates and `require_*` helpers read Groups

**Issue/Branch:** `#521` · `backend/N3-task-authority-on-groups`

**Files**

- create `supabase/migrations/<ts>_task_authority_on_groups.sql`
- rewrite `supabase/tests/can_manage_origin.test.sql` (becomes the shim + `can_manage_task` matrix over Groups), `supabase/tests/rls_tasks_read_matrix.test.sql`, `supabase/tests/points_authorization_matrix.test.sql`
- modify (new personas/assertions, listed below): `create_task.test.sql`, `update_task_content.test.sql`, `convert_task_mode.test.sql`, `set_task_queue.test.sql`, `assign_task_executor.test.sql`, `select_task_candidate.test.sql`, `cancel_task.test.sql`, `complete_umbrella_task.test.sql`, `duplicate_task.test.sql`, `return_task_to_progress.test.sql`, `complete_task_review.test.sql`, `mark_task_unfulfilled.test.sql`, `reopen_task.test.sql`, `give_up_task.test.sql`, `task_interest.test.sql`, `task_progress_commands.test.sql`, `rls_task_history_read.test.sql`, `tracker_management_reads.test.sql`, `notify_helper.test.sql`
- `tracker_grants.test.sql`: no roster change (every function below keeps its signature); `database.types.ts`: unchanged (no `public` signature changes)

**Interfaces (all REDEFINED with `create or replace`, same signatures — the ACL survives)**

- `private.can_manage_task(bigint)`, `private.can_evaluate_task(bigint)`, `private.can_read_task(bigint)`, `private.is_task_team_member(bigint)` [predicate]
- `private.can_manage_origin(text, text, bigint)` [predicate, shim], `private.require_origin_manager(text, text, bigint)` [require, shim]
- `private.require_task_manager(bigint)`, `private.require_task_evaluator(bigint)` [require]
- `private.task_managers(bigint, uuid)` [none]
- `public.can_manage_tasks()` (invoker; `public.my_managed_task_ids()` unchanged)
- consumes Task 2's kit; the four history read policies (`task_assignments_read` …) keep calling `can_read_task` / `can_manage_task` / `is_task_team_member` / `is_global_task_reader` by name and are not touched

**Steps**

- [ ] 1. Rewrite the three matrix suites and add the personas to the command suites (below). Red.
- [ ] 2. The predicates:

```sql
-- #521: every Task predicate and require_* helper reads Groups (ADR-0009 Wave 2). Signatures
-- are unchanged; the four history read policies, the 21 commands and the Request commands
-- keep calling the same names. can_manage_origin / require_origin_manager become shims over
-- the legacy id -> Group mapping and are dropped in Wave 3.

create or replace function private.can_manage_task(p_task_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  -- Manage = may manage work in the Task's Group, AND one of: level >= 6; a Group Manager on
  -- the path; the Task's current Executor is not a Manager/Responsible of the chain (a Task
  -- with no Executor is manageable by any Responsible on the path); or no Manager exists
  -- anywhere on the path -- "Peers manage, BC evaluates" (Alex, 2026-09-19): where a Group
  -- and all its ancestors have no Group Manager, its Responsibles manage each other's Tasks.
  select coalesce((
    select private.can_manage_group_work(task.group_id)
       and (
         private.actor_level() >= 6
         or private.group_role_of(task.group_id, (select auth.uid())) = 'manager'
         or not private.has_group_manager(task.group_id)
         or coalesce(private.group_role_of(task.group_id, executor.member_id), 'member')
              not in ('manager', 'responsible')
       )
      from public.tasks as task
      left join public.task_assignments as executor
        on executor.task_id = task.id and executor.ended_at is null
     where task.id = p_task_id
  ), false);
$$;

create or replace function private.can_evaluate_task(p_task_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  -- Evaluate = level >= 6; a Group Manager on the path of an active Group; or a Group
  -- Responsible on the path when the Executor is an ordinary member of the chain (or an
  -- outsider) and is not the caller. No Independent-Team special case: with no Manager,
  -- every teammate is a Responsible, so evaluation falls to BC/Moderator by construction.
  -- "The Executor" is the active Assignment, else the most recent one (reopen_task judges a
  -- completed Task, whose Assignment has already ended).
  select coalesce((
    select coalesce(public.auth_is_member(), false)
       and private.actor_level() is not null
       and (
         private.actor_level() >= 6
         or (grp.status = 'active' and (
              private.group_role_of(grp.id, (select auth.uid())) = 'manager'
              or (private.group_role_of(grp.id, (select auth.uid())) = 'responsible'
                  and executor.member_id is distinct from (select auth.uid())
                  and coalesce(private.group_role_of(grp.id, executor.member_id), 'member')
                        not in ('manager', 'responsible'))))
       )
      from public.tasks as task
      join public.groups as grp on grp.id = task.group_id
      left join lateral (
        select assignment.member_id
          from public.task_assignments as assignment
         where assignment.task_id = task.id
         order by (assignment.ended_at is null) desc, assignment.assigned_at desc, assignment.id desc
         limit 1
      ) as executor on true
     where task.id = p_task_id
  ), false);
$$;

create or replace function private.can_read_task(p_task_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  -- R1 level >= 5; R2 own Assignment/Candidature (ever); then, subject to the Group's Minimum
  -- Level unless the caller holds a Group Role on the path: R3 a Group Role on the path
  -- (status-agnostic: an archived Project's former lead keeps reading its history); R4 Shared
  -- Work Visibility of a Group on the path the caller belongs to; R6 an open public
  -- Opportunity -- audience org for every Member at/above the Minimum Level, local for
  -- members of the Task's own Group (ruling D2); R7 judged on the Task and its Umbrella.
  select coalesce(public.auth_is_member(), false)
     and exists (
       select 1
         from public.profiles as caller
         join public.roles as caller_role on caller_role.id = caller.role
         join public.tasks as target on target.id = p_task_id
         join public.tasks as task on task.id = target.id or task.id = target.parent_task_id
         join public.groups as grp on grp.id = task.group_id
        where caller.id = (select auth.uid())
          and caller.status = 'activ'
          and (
            caller_role.level >= 5
            or exists (select 1 from public.task_assignments as assignment
                        where assignment.task_id = task.id and assignment.member_id = caller.id)
            or exists (select 1 from public.task_candidates as candidature
                        where candidature.task_id = task.id and candidature.member_id = caller.id)
            or (
              (caller_role.level >= grp.min_level
               or exists (select 1 from public.group_members as held
                           where held.member_id = caller.id
                             and held.group_role in ('manager', 'responsible')
                             and grp.path @> array[held.group_id]))
              and (
                exists (select 1 from public.group_members as held
                         where held.member_id = caller.id
                           and held.group_role in ('manager', 'responsible')
                           and grp.path @> array[held.group_id])
                or exists (select 1 from public.groups as shared
                            where grp.path @> array[shared.id]
                              and shared.shared_work_visibility
                              and (exists (select 1 from public.group_members as gm
                                            where gm.group_id = shared.id and gm.member_id = caller.id)
                                   or (shared.automatic_membership and caller_role.level >= shared.min_level)))
                or (task.kind = 'task'
                    and task.assignment_mode = 'public'
                    and task.queue_closed_at is null
                    and task.status not in ('completed', 'unfulfilled', 'cancelled')
                    and (task.audience = 'org'
                         or (task.audience = 'local'
                             and (exists (select 1 from public.group_members as gm
                                           where gm.group_id = grp.id and gm.member_id = caller.id)
                                  or (grp.automatic_membership and caller_role.level >= grp.min_level)))))
              )
            )
          ));
$$;

create or replace function private.is_task_team_member(p_task_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  -- Renamed in meaning, not in name: a member of a Group on the Task's path whose Shared Work
  -- Visibility is on (every backfilled Team Group has it on, so today's Team members keep
  -- their complete Task Activity). task_activity_read keeps calling this name.
  select coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null
     and exists (
       select 1
         from public.tasks as task
         join public.groups as grp on grp.id = task.group_id
         join public.groups as shared on grp.path @> array[shared.id] and shared.shared_work_visibility
        where task.id = p_task_id
          and private.is_group_member(shared.id, (select auth.uid())));
$$;
```

- [ ] 3. The shims, the `require_*` helpers, the recipient resolver, the capability read:

```sql
create or replace function private.can_manage_origin(p_dept_id text, p_team_id text, p_project_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  -- Wave 2 shim: the one non-null legacy id names a Group; the Group decides. Dropped in Wave 3.
  select num_nonnulls(p_dept_id, p_team_id, p_project_id) = 1
     and private.can_manage_group_work(private.group_id_for_legacy_origin(p_dept_id, p_team_id, p_project_id));
$$;

create or replace function private.require_origin_manager(p_dept_id text, p_team_id text, p_project_id bigint)
returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  if num_nonnulls(p_dept_id, p_team_id, p_project_id) <> 1 then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end if;
  begin
    return private.require_group_work_manager(
      private.group_id_for_legacy_origin(p_dept_id, p_team_id, p_project_id));
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end;
end;
$$;

create or replace function private.require_task_manager(p_task_id bigint)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_task  public.tasks%rowtype;
begin
  select * into v_task from public.tasks where id = p_task_id;   -- caller already holds FOR UPDATE
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  -- The Task-level rule (peers, no-manager chains) first, then the locked re-validation.
  if v_actor is null or not coalesce(private.can_manage_task(p_task_id), false) then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end if;
  begin
    perform private.require_group_work_manager(v_task.group_id);
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end;
  return v_actor;
end;
$$;

create or replace function private.require_task_evaluator(p_task_id bigint)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_task  public.tasks%rowtype;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  if v_actor is null or not coalesce(private.can_evaluate_task(p_task_id), false) then
    raise exception using errcode = '42501', message = 'task_evaluate_forbidden';
  end if;
  begin
    perform private.require_group_work_manager(v_task.group_id);
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'task_evaluate_forbidden';
  end;
  return v_actor;
end;
$$;

create or replace function private.task_managers(p_task_id bigint, p_actor uuid)
returns setof uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_created_by uuid;
  v_group_id   bigint;
  v_recipients uuid[];
begin
  select task.created_by, task.group_id into v_created_by, v_group_id
    from public.tasks as task where task.id = p_task_id;
  if not found then
    return;
  end if;
  -- The Task Manager is the creator (ADR-0007), while live and not the actor.
  if v_created_by is not null and v_created_by is distinct from p_actor
     and exists (select 1 from public.profiles as creator
                  where creator.id = v_created_by and creator.status = 'activ') then
    return next v_created_by;
    return;
  end if;
  -- Else the Group's Managers, then the nearest ancestor's, then BC/Moderator -- minus the
  -- actor; and if that leaves nobody, BC/Moderator minus the actor (a Task always has someone
  -- to notify, Ruling 24).
  select array_agg(manager) into v_recipients
    from private.group_managers(v_group_id) as manager
   where manager is distinct from p_actor;
  if v_recipients is null then
    select array_agg(profile.id) into v_recipients
      from public.profiles as profile
      join public.roles as role on role.id = profile.role
     where role.level >= 6 and profile.status = 'activ' and profile.id is distinct from p_actor;
  end if;
  return query select unnest(coalesce(v_recipients, '{}'::uuid[]));
end;
$$;

create or replace function public.can_manage_tasks()
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(public.auth_is_member(), false)
     and exists (select 1 from public.groups as grp where private.can_manage_group_work(grp.id));
$$;
```

- [ ] 4. Re-issue `comment on function` for every redefined function (the ADR-0009 rule each now implements; `create or replace` keeps ACLs and does not touch comments). No grant statements are needed; state that in the migration.
- [ ] 5. Bounded sequence. `tracker_grants` unchanged. Smoke unchanged (BC drives every step through the shims).

**Tests**

`can_manage_origin.test.sql` → rewritten as the shim + `can_manage_task` matrix (keep the file name; `plan(56)` becomes whatever the new count is). Personas: the Task 2 tree + `exec_peer` (a Responsible who is the current Executor of a Project Task), `exec_outsider` (an active Member of no Group executing a Project Task), `ind_exec` (an Independent-Team member executing a Team Task).

| persona × operation                                                                                                                                                                           | expected                                                         | mutation                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------- |
| shim: `can_manage_origin('edu',null,null)` as bc/bce_edu ✔; bce_foreign, ordinary_edu, vot, claimless, no-JWT, deactivated/demoted stale-claim personas ✘ (the current file's 17 rows)        | unchanged answers through the Group                              | shim not delegating                |
| shim arity: two/three/zero ids ✘ even for bc                                                                                                                                                  | `num_nonnulls` guard                                             | guard dropped                      |
| shim on `P_arch`: coord ✘, bc ✔; missing project id ✘ for coord                                                                                                                               | status through `can_manage_group_work`                           | status gate                        |
| `can_manage_task(P task, executor = ordinary_proj)` as coord ✔, resp ✔, ordinary_proj ✘                                                                                                       | base                                                             | role branch                        |
| `can_manage_task(P task, executor = resp)` as resp ✘, as coord ✔, as bc ✔                                                                                                                     | a Responsible never manages a peer's Task where a Manager exists | peer rule dropped                  |
| `can_manage_task(P task, executor = coord)` as resp ✘                                                                                                                                         | nor the Manager's                                                | same                               |
| `can_manage_task(P task, no executor)` as resp ✔                                                                                                                                              | unassigned work                                                  | executor null mishandled           |
| `can_manage_task(ind task, executor = ind_b)` as ind_a ✔                                                                                                                                      | no Manager on the path: peers manage (Alex 2026-09-19)           | `has_group_manager` branch dropped |
| `can_manage_task(ind task, executor = ind_a)` as ind_a ✔                                                                                                                                      | and their own                                                    | same                               |
| `can_manage_task(dt task)` as bce_edu ✔, dt_member ✘, ordinary_edu ✘                                                                                                                          | ancestor Manager                                                 | ancestor join                      |
| `require_origin_manager(...)` as owner with coord's claims on `(null,null,P)` → uuid; on `(null,null,P_arch)` → `throws_ok('42501','task_manage_forbidden')` (never `group_manage_forbidden`) | remap                                                            | remap dropped                      |

`rls_tasks_read_matrix.test.sql` → same 24-row core + the two Umbrellas + participation Tasks, with expected sets re-derived under R1–R7 above. Changes versus today, each pinned by a named assertion: (a) `recrut_in`/`voluntar_in`/`activ_in`/`vot_in` (edu members) still do **not** read `DT-loc-open` — plain membership is per Group (ruling D2), so a Department Team's local Opportunity admits only that Team's own members, exactly as #318 decision (a) has it; a named assertion pins the negative; (b) `responsabil` (level 4) still reads like levels 0–3; (c) new personas: `coord_p` (level-1 manager of the Project Group) reads every `P-*` Task and `PA-dir` (archived history, status-agnostic role branch) and manages the active ones; `below_min` (level 1 in a Group whose `min_level` was set to 3 as owner) reads no Task of that Group, its org-wide Opportunity included, but does read one it is assigned to; `stale_role` (a former Project lead demoted through `set_project_leader`… or simply removed from `project_members` after the JWT was built) reads only R6; (d) the helper sweep keeps `helper_triples(false) = {}` and re-pins the non-vacuity count.

`points_authorization_matrix.test.sql` → keep every existing assertion; add `coord` (level-1 Group Manager) and `resp` personas proving a Group Role grants no ledger read beyond own rows and no leadership rows (rank ≥ 5 stays the gate); the `has_function_privilege` lines still name `leadership_leaderboard(text,text,bigint,bigint)` here — Task 7 changes them.

Command suites — add these personas/assertions (one `throws_ok`/`lives_ok` each, mutation = the rule it pins):

- every manager-gated suite (`update_task_content`, `convert_task_mode`, `set_task_queue`, `assign_task_executor`, `select_task_candidate`, `cancel_task`, `complete_umbrella_task`, `duplicate_task`, `create_task` Subtask path): **Coordonator** (level-1 Project leader) `lives_ok`; **Responsible on a peer's Task** (`exec = resp2`) `42501 task_manage_forbidden`; **Independent-Team peer on a teammate's Task** `lives_ok`; **Department-Team member** `42501`.
- every evaluator-gated suite (`return_task_to_progress`, `complete_task_review`, `mark_task_unfulfilled`, `reopen_task`, `cancel_task`'s evaluator path if any): Coordonator `lives_ok` (including on their own Assignment); Responsible on an ordinary member's Task `lives_ok`; Responsible on their own / a peer's / the Manager's Task `42501 task_evaluate_forbidden`; Independent-Team peer `42501 task_evaluate_forbidden`, BC `lives_ok`.
- recipient suites (`give_up_task`, `task_interest`, `task_progress_commands`, `complete_umbrella_task`, `cancel_task`, `complete_task_review`): the `set_eq` on `private.task_managers` becomes {creator} else `group_managers` (ruling D4: Project — the leader only, a Responsible no longer hears, because a Manager exists on the path; Independent Team — its live Responsibles ∪ every live BC/Moderator, so teammates keep hearing about a give-up).
- `rls_task_history_read.test.sql`: `is_task_team_member` still admits the Department-Team member to `task_activity`; add a Project member (Shared Work Visibility off) who is refused.
- `tracker_management_reads.test.sql`: `can_manage_tasks()` true for the Coordonator and the Independent-Team member, false for the ordinary Member; `my_managed_task_ids()` sets re-derived.
- `notify_helper.test.sql`: recipient expectations follow `task_managers` above.

**Commit:** `feat(db): Task predicates, require_* helpers and task_managers read Groups; can_manage_origin/require_origin_manager become shims (#521)`.

---

## Task 4 — #522: commands write `group_id`; Requests and Campaigns decide by Group

**Issue/Branch:** `#522` · `backend/N4-commands-on-groups`

**Files**

- create `supabase/migrations/<ts>_commands_write_group_id.sql`
- rewrite `supabase/tests/completed_work_request_commands.test.sql`, `campaign_commands.test.sql`, `tasks_campaign.test.sql`; modify `create_task.test.sql`, `duplicate_task.test.sql`, `tasks_umbrella.test.sql`, `completed_work_requests_schema.test.sql` (policy), `tracker_grants.test.sql` (roster 120 → 122; `expected_function_privs` rows for `create_task`, `create_completed_work_request`, the second `create_campaign`), `rls_deny_by_default.test.sql` if its Request fixture needs `group_id` (it does not: legacy insert derives it)
- modify `app/src/lib/database.types.ts` (regenerated: `create_task` and `create_completed_work_request` Args gain optional `p_group_id`; `create_campaign` gains an overload)
- frontend: `app/src/queries/completed-work-requests.ts` keeps passing the three legacy keys (no change; the cast still compiles)

**Interfaces**

- `public.create_task(…12 existing params…, p_group_id bigint default null)` / `private.create_task_impl(…, p_group_id bigint)` — trailing optional param; every existing positional/named call keeps working (drop + create, since `create or replace` cannot add a parameter; re-issue the four-role grants)
- `private.duplicate_task_impl(bigint, timestamptz)` unchanged signature; the clone now writes `group_id = source.group_id` explicitly (ruling D5)
- `private.request_deciders(p_request_id bigint) returns setof uuid` [none] — the one spelling of the decider set
- `private.can_decide_request(p_request_id bigint) returns boolean` [predicate] — `auth.uid()` ∈ deciders, plus claims/liveness
- `private.require_request_decider(bigint)` redefined over `can_decide_request` + `require_group_work_manager` locks (reason stays `request_decide_forbidden`)
- `public.create_completed_work_request(p_description text, p_dept_id text, p_team_id text, p_project_id bigint, p_group_id bigint default null)` / `_impl(+p_group_id)` — exactly one of the four; **no second overload is left behind** (drop the 4-arg pair first), so PostgREST resolution is unambiguous when the frontend sends three nulls
- policy `completed_work_requests_read` → `requester_id = auth.uid() or private.can_manage_group_work(group_id)`
- `private.require_campaign_manager(p_group_id bigint) returns uuid` (the `text` overload dropped); `private.create_campaign_impl(p_group_id bigint, p_name text)` (the `(text,text)` impl dropped); `public.create_campaign(p_group_id bigint, p_name text)` new; `public.create_campaign(p_department_id text, p_name text)` kept as a compatibility wrapper that resolves the Department's Group (`PT404 department_not_found` when none) — dropped in Wave 3
- `private.validate_task_campaign()` and `private.validate_task_hierarchy()` redefined; their triggers re-created with `group_id` in the `of` lists

**Steps (decisive lines)**

- [ ] 1. Suites first (below). Red.
- [ ] 2. `create_task_impl` — origin resolution replaces the `num_nonnulls(v_dept, v_team, v_project) <> 1` block:

```sql
  -- 3/4. exactly one Origin, in either vocabulary, then authority on its Group
  if p_parent_task_id is null then
    if num_nonnulls(p_dept_id, p_team_id, p_project_id, p_group_id) <> 1 then
      raise sqlstate 'PT400' using message = 'invalid_origin';
    end if;
    v_group := coalesce(p_group_id, private.group_id_for_legacy_origin(p_dept_id, p_team_id, p_project_id));
  else
    -- a Subtask inherits its Umbrella's Group; caller-supplied ids must be null or identical
    if (p_group_id is not null and p_group_id is distinct from v_parent.group_id)
       or (p_dept_id is not null and p_dept_id is distinct from v_parent.dept_id)
       or (p_team_id is not null and p_team_id is distinct from v_parent.team_id)
       or (p_project_id is not null and p_project_id is distinct from v_parent.project_id) then
      raise sqlstate 'PT400' using message = 'subtask_origin_mismatch';
    end if;
    v_group := v_parent.group_id;
  end if;
  begin
    perform private.require_group_work_manager(v_group);      -- null / unknown Group: 42501, non-disclosing
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end;
  …
  insert into public.tasks (title, description, deadline, group_id, audience, assignment_mode, campaign_id,
                            parent_task_id, kind, status, created_by, queue_opened_at)
  values (…, v_group, …)   -- the legacy triple is derived by tasks_sync_group_origin
```

The `check_violation` handler keeps mapping `task_campaign_origin_mismatch` / `task_campaign_inactive` to `PT400 invalid_campaign`; the three new `task_group_*` reasons propagate (a caller bug).

- [ ] 3. `duplicate_task_impl`: add `group_id` to the insert's column list with `v_source.group_id` (and keep the legacy triple — consistent, so the trigger's both-sides branch passes). `approve_completed_work_request_impl` `Task insert (~:433)`: add `group_id` = `v_request.group_id`.
- [ ] 4. Requests:

```sql
create function private.request_deciders(p_request_id bigint)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  -- BC/Moderator; the Group Managers on the path of an active Group; the Group Responsibles on
  -- the path when the requester is an ordinary member of the chain (or an outsider) -- never
  -- the requester themselves.
  with request as (
    select r.requester_id, r.group_id, grp.path, grp.status
      from public.completed_work_requests as r join public.groups as grp on grp.id = r.group_id
     where r.id = p_request_id)
  select profile.id
    from request, public.profiles as profile
    join public.roles as role on role.id = profile.role
   where profile.status = 'activ'
     and (role.level >= 6
          or (request.status = 'active' and exists (
                select 1 from public.group_members as gm
                 where gm.member_id = profile.id and request.path @> array[gm.group_id]
                   and (gm.group_role = 'manager'
                        or (gm.group_role = 'responsible'
                            and profile.id <> request.requester_id
                            and coalesce(private.group_role_of(request.group_id, request.requester_id), 'member')
                                  not in ('manager', 'responsible'))))));
$$;

create function private.can_decide_request(p_request_id bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null
     and (select auth.uid()) in (select private.request_deciders(p_request_id));
$$;
```

`require_request_decider`: `PT404 request_not_found` for a missing row; `42501 request_decide_forbidden` unless `can_decide_request`; then `require_group_work_manager(v_request.group_id)` remapped to `request_decide_forbidden`. `create_completed_work_request_impl`: step 1 `num_nonnulls(p_dept_id, p_team_id, p_project_id, p_group_id) <> 1 → PT400 invalid_origin`; `v_group := coalesce(p_group_id, group_id_for_legacy_origin(…))`; step 3 membership → `private.group_role_of(v_group, v_actor) is not null and (select status from public.groups where id = v_group) = 'active'` else `42501 request_origin_forbidden` (same answer for an unknown Group); step 4 insert `(requester_id, group_id, description, status)` (legacy derived); step 5 `perform private.notify(array(select private.request_deciders(v_request.id)), …, 'request:' || v_request.id, v_actor)`. `approve`/`reject` visibility test: `requester_id is distinct from v_actor and not can_manage_group_work(v_request.group_id) → PT404`. Policy:

```sql
drop policy completed_work_requests_read on public.completed_work_requests;
create policy completed_work_requests_read on public.completed_work_requests
  for select to authenticated
  using (public.auth_is_member()
         and exists (select 1 from public.profiles as caller
                      where caller.id = (select auth.uid()) and caller.status = 'activ')
         and (requester_id = (select auth.uid()) or private.can_manage_group_work(group_id)));
```

- [ ] 5. Campaigns — `require_campaign_manager(p_group_id bigint)`: `if v_actor is null then 42501`; `begin return private.require_group_work_manager(p_group_id); exception when insufficient_privilege then raise 42501 campaign_manage_forbidden; end;` (an unknown or archived Group is `campaign_manage_forbidden`, non-disclosing; the `departments.kind` allow-list and `PT400 invalid_campaign_department` disappear — the Organization Group may own a Campaign, and only level ≥ 6 manages it). The cheap pre-lock gate in the three impls (`profile.role in ('bc','moderator','bce')`) becomes "live active member with claims" (a level-1 Coordonator must reach the Group check); `create_campaign_impl(p_group_id, p_name)` inserts `(group_id, name, created_by)` (`department_id` derived); `update_campaign_impl`/`set_campaign_active_impl` read `campaign.group_id` for the lock-then-authorise step. The `(text,text)` wrapper: `select private.create_campaign_impl(coalesce(private.group_id_for_legacy_origin(p_department_id, null, null), -1), p_name)` is not acceptable (leaks); instead the wrapper stays SQL and calls a second impl branch: simplest — keep it `security invoker` calling `private.create_campaign_impl((select grp.id from public.groups as grp where grp.legacy_dept_id = p_department_id), p_name)`; a null resolves to `42501 campaign_manage_forbidden` inside the impl, which is what an unknown Department now answers to every caller (ruling D9: the existing `PT404 department_not_found` assertion is retired with a note; the overload itself dies in Wave 3).
- [ ] 6. `validate_task_campaign()`:

```sql
  select campaign.group_id, campaign.is_active into v_campaign_group, v_campaign_active
    from public.campaigns as campaign where campaign.id = new.campaign_id;
  select grp.path into v_task_path from public.groups as grp where grp.id = new.group_id;
  if v_campaign_group is null or not (v_task_path @> array[v_campaign_group]) then
    raise exception using errcode = '23514', message = 'task_campaign_origin_mismatch';
  end if;
  -- activity rule unchanged (only a newly set or changed Campaign must be active)
```

`create trigger tasks_validate_campaign before insert or update of campaign_id, group_id, dept_id, team_id, project_id …` (drop + create). `validate_task_hierarchy()`: add `new.group_id is distinct from old.group_id` to both immutability checks and `new.group_id is distinct from v_parent_group` to the inheritance check; `of parent_task_id, group_id, dept_id, team_id, project_id, kind`. Both triggers still sort after `tasks_sync_group_origin`.

- [ ] 7. Grants: four-role revoke on every dropped-and-recreated function, grant back per category; `revoke insert, update, delete on table public.campaigns / public.completed_work_requests from authenticated` restated. Roster: +`request_deciders` (none), +`can_decide_request` (predicate); `create_task_impl` / `create_completed_work_request_impl` args rows updated; `require_campaign_manager` / `create_campaign_impl` args rows updated; count 120 → 122. `expected_function_privs`: `create_task` args gain `, p_group_id bigint`; `create_completed_work_request` likewise; add `('create_campaign', 'p_group_id bigint, p_name text', false, true, false, false)`.
- [ ] 8. Bounded sequence; `gen:types`; frontend gates (types changed); smoke unchanged (legacy args through the shims).

**Tests (persona × operation; mutation in parentheses)**

`completed_work_request_commands.test.sql` (rewrite; fixture tree from Task 2 + the #344 personas): create by Department member ✔ / by Department member naming `p_group_id` of `edu` ✔ / four ids ✘ `invalid_origin` / zero ids ✘ `invalid_origin` / Project member on the archived Project ✘ `request_origin_forbidden` / Independent-Team member ✔ / claimless ✘ `request_command_forbidden` (arity guard, resolver, status gate); `set_eq` of the notified set per shape: Department → {bce_edu, bc}; Department-Team → {bce_edu, bc}; Project by ordinary member → {coord, resp, bc} (**Responsibles now decide ordinary members' Requests**); Project by `resp` → {coord, bc} (a peer never decides a Responsible's); Project by `coord` → {bc}; Independent Team → {bc} (every teammate is a Responsible); then every member of each set approves or rejects a twin Request `lives_ok` and every non-member gets `42501 request_decide_forbidden` or `PT404 request_not_found` per the read policy (single source: `request_deciders`); the #344 race (`b_waited`, `PT409 request_not_pending`) unchanged; the approved Task carries `group_id` = the Request's (`approve` copy); `completed_work_requests_read`: Coordonator reads the Project's Requests, an ordinary Project member only their own, a Department Team member none of the Department's.

`campaign_commands.test.sql` (rewrite): `create_campaign(<edu group>, …)` as bce_edu ✔ / bce_foreign ✘ `campaign_manage_forbidden` / coord on `<P group>` ✔ (**Projects carry Campaigns**) / ind_a on `<ind group>` ✔ / ordinary ✘ / on the archived Project ✘ `campaign_manage_forbidden` / on the Organization Group: bc ✔, bce_edu ✘; `create_campaign('edu', …)` (text overload) still works for bce_edu; unknown Department → `campaign_manage_forbidden`; `campaign_name_taken` on `campaigns_group_name_uidx` and the same name on two Groups ✔; `update_campaign`/`set_campaign_active` by coord on the Project's Campaign ✔, by resp ✔ (Responsibles manage Campaigns), by bce_foreign ✘; lock probe (`group_members` row `For Share`, no `groups` row) and the revocation race.

`tasks_campaign.test.sql` (rewrite): Department Task + Department Campaign ✔; Department-Team Task + parent Department's Campaign ✔ (path); Project Task + Project Campaign ✔ (new); Project Task + Department Campaign ✘ `task_campaign_origin_mismatch`; Independent-Team Task + its own Campaign ✔ (new); Department Task + Team Campaign ✘ (a Campaign of a **descendant** never tags an ancestor's Task); update `set group_id = <pr group>` on a Task carrying an `edu` Campaign ✘ `task_campaign_origin_mismatch` (the `of group_id` list); the inactive-Campaign carve-out unchanged.

`create_task.test.sql`: add `p_group_id`-only creation by coord ✔; `p_group_id` + `p_project_id` both ✘ `invalid_origin`; Subtask with `p_group_id` ≠ Umbrella's ✘ `subtask_origin_mismatch`; the created row's `dept_id/team_id/project_id` derived; unknown `p_group_id` ✘ `task_manage_forbidden` for coord **and** for bc. `duplicate_task.test.sql`: the clone's `group_id` equals the source's. `tasks_umbrella.test.sql`: `update … set group_id` on a Subtask ✘ `subtask_origin_immutable`.

**Commit:** `feat(db): create_task/duplicate_task write group_id; Requests decide by Group Role; Campaigns owned by any Group (#522)`.

---

## Task 5 — #370: `create_event` by Group Role

**Issue/Branch:** `#370` · `backend/370-create-event-by-group`

**Files**

- create `supabase/migrations/<ts>_create_event_by_group.sql`
- rewrite `supabase/tests/create_event.test.sql`; one-line change in `rls_events.test.sql:117–124` (the `create_event` call moves to the new signature; every visibility assertion untouched); `tracker_grants.test.sql` (roster 122 → 123; `expected_function_privs` gains `create_event` with the new args); `docs/backend/conventions.md` §2 "Grandfathered direct-definer commands" → none left, §4 grandfathered two-role list loses `create_event`
- `database.types.ts` regenerated (new `create_event` Args)

**Interfaces**

- `public.create_event(p_title text, p_type text, p_group_id bigint, p_starts_at timestamptz, p_ends_at timestamptz default null, p_location text default null, p_capacity integer default null, p_description text default null, p_min_level integer default 0) returns public.events` — `security invoker` wrapper over `private.create_event_impl(…same…)` [impl]; the 10-arg `create_event(text,text,text,timestamptz,timestamptz,text,integer,text,text,text)` is dropped (no caller in `app/`, verified by grep)
- consumes `require_group_work_manager`, `groups (min_level, status, legacy_dept_id)`, `group_members`, `private.actor_level`

**Steps (decisive lines)**

- [ ] 1. `create_event.test.sql` rewritten (below). Red.
- [ ] 2. Impl step order:

```sql
  -- 1. malformed for everyone
  if p_group_id is null then raise sqlstate 'PT400' using message = 'event_group_required'; end if;
  if p_title is null or p_title !~ '[^[:space:]]' then … 'invalid_event_title' …
  if p_type is null or p_type not in ('sedinta','activitate','call','eveniment','deadline','recrutare') then … 'invalid_event_type'
  if p_starts_at is null or (p_ends_at is not null and p_ends_at <= p_starts_at) then … 'invalid_event_interval'
  if p_capacity is not null and p_capacity <= 0 then … 'invalid_event_capacity'
  if p_min_level is null or p_min_level not in (0, 3, 5, 6) then … 'invalid_event_min_level'
  -- 2. gate
  begin v_actor := private.require_active_member();
  exception when insufficient_privilege then raise exception using errcode = '42501', message = 'calendar_manage_forbidden'; end;
  -- 3/4. authority (no target row yet). The Organization Group is the row legacy_dept_id = 'org'
  --      until Wave 3 gives it a setting of its own.
  select * into v_group from public.groups as grp where grp.id = p_group_id;
  if not found or v_group.status <> 'active' then
    raise exception using errcode = '42501', message = 'calendar_manage_forbidden';   -- indistinguishable from unauthorised
  end if;
  if v_group.legacy_dept_id = 'org' then
    -- any Member holding any Group Role anywhere, live, or level >= 6
    perform 1 from public.profiles as profile where profile.id = v_actor and profile.status = 'activ' for share;
    if private.actor_level(v_actor) < 6 then
      perform 1 from public.group_members as gm
        where gm.member_id = v_actor and gm.group_role in ('manager', 'responsible') for share;
      if not found then raise exception using errcode = '42501', message = 'calendar_manage_forbidden'; end if;
    end if;
  else
    begin perform private.require_group_work_manager(p_group_id);
    exception when insufficient_privilege then raise exception using errcode = '42501', message = 'calendar_manage_forbidden'; end;
  end if;
  -- 5. input judged against the loaded rows
  if p_min_level < v_group.min_level then raise sqlstate 'PT400' using message = 'event_min_level_below_group'; end if;
  if p_min_level > private.actor_level(v_actor) and private.actor_level(v_actor) < 9 then
    raise sqlstate 'PT400' using message = 'event_min_level_above_actor';
  end if;
  -- 7. mutate: scope / dept_id / team_id / project_id are derived by events_sync_group_origin
  insert into public.events (title, type, group_id, starts_at, ends_at, location, capacity, description, min_level, created_by)
  values (btrim(p_title), p_type::public.event_type, p_group_id, p_starts_at, p_ends_at, nullif(btrim(p_location), ''),
          p_capacity, nullif(btrim(p_description), ''), p_min_level, v_actor)
  returning * into v_created;
```

- [ ] 3. `drop function public.create_event(text, text, text, timestamptz, timestamptz, text, integer, text, text, text)`; create the pair; four-role revoke, grant back to `authenticated` on wrapper and impl. Roster +1 (`create_event_impl` impl → 123).
- [ ] 4. Bounded sequence; `gen:types`; frontend gates; smoke unchanged.

**Tests — `create_event.test.sql`** (rewrite; tree from Task 2 plus the seed-independent personas of today's file): shape (9-arg signature, `p_created_by` absent, wrapper invoker, impl definer, grants, no direct `insert`); **Organization Group**: coord (level 1, a Group Role) ✔ · resp ✔ · ind_a (Responsible of an Independent Team) ✔ · ordinary_edu ✘ `calendar_manage_forbidden` · vot with no role ✘ · bc ✔ · `min_level 3` by coord (level 1) ✘ `event_min_level_above_actor` · `min_level 3` by vot… (vot holds no role → forbidden first) · `min_level 6` by moderator ✔ (exempt); **Department Group `edu`**: bce_edu ✔ · bce_foreign ✘ · coord ✘; **Child Team `dt` (min 3)**: bce_edu with `min_level 0` ✘ `event_min_level_below_group`, with `min_level 3` ✘ `event_min_level_above_actor`? (bce is level 5 → ✔; use coord-as-member? coord holds no role on `dt` → forbidden) so: bce_edu `min_level 3` ✔, `min_level 0` ✘ below_group; **Project**: coord ✔ (`scope = 'project'`, `project_id` derived), resp ✔, ordinary_proj ✘, archived Project ✘ `calendar_manage_forbidden`; **Independent Team**: ind_a ✔ with `scope = 'team'`, `dept_id null`, `team_id` derived — the constraint relaxation used by a command for the first time; **Department Team**: bce_edu ✔ with `dept_id` = `edu` derived; malformed inputs (title, type, interval, capacity, `min_level 4`, `min_level 2`, null Group) each `PT400` with the reasons above, raised before the gate (claimless caller gets `PT400`, not `42501`, for a blank title); claimless / inactive / no-profile → `42501 calendar_manage_forbidden`; unknown Group as bc → `42501` (non-disclosing); `anon` → `42501` on execute; `hasnt_function` for the 10-arg overload.

**Commit:** `feat(db): create_event by Group Role -- wrapper + impl, p_group_id, Minimum Level rules, Organization Group rule (#370)`.

---

## Task 6 — #248: `update_event`, `cancel_event`, important-change notifications

**Issue/Branch:** `#248` · `backend/248-update-cancel-event`

**Files**

- create `supabase/migrations/<ts>_update_and_cancel_event.sql`
- create `supabase/tests/update_event.test.sql`, `supabase/tests/cancel_event.test.sql`
- modify `tracker_grants.test.sql` (roster 123 → 126; two public rows), `shared_timestamps.test.sql` if `events.updated_at` is added (see step 2), `scripts/seed-fingerprint.sql` unchanged (`event:` line reads title/scope/min_level)
- `database.types.ts` regenerated

**Interfaces**

- `public.update_event(p_event_id bigint, p_title text, p_type text, p_group_id bigint, p_starts_at timestamptz, p_ends_at timestamptz, p_location text, p_capacity integer, p_description text, p_min_level integer) returns public.events` — full-state replace (every field supplied; null means null for nullable fields) over `private.update_event_impl` [impl]
- `public.cancel_event(p_event_id bigint, p_reason text) returns public.events` over `private.cancel_event_impl` [impl]
- `private.event_notification_recipients(p_event_id bigint) returns setof uuid` [none] — attendees with `status = 'going'` ∪ explicit `group_members` of the Event's Group (any role), live profiles only
- consumes `require_group_work_manager`, `private.notify` (kind `'event'`, `p_task_id null`, dedupe `'event:<id>:<field>'`)

**Steps (decisive lines)**

- [ ] 1. Both suites first. Red.
- [ ] 2. Schema: `alter table public.events add column updated_at timestamptz not null default now()` + `create trigger events_set_updated_at before update on public.events for each row execute function private.set_updated_at()` (conventions §7: rows edited in place). Ruling D10: it is added here.
- [ ] 3. `update_event_impl`: step 1 the same malformed-input checks as create (plus `p_event_id null → PT404 event_not_found` falls out of the lock); step 2 gate (`calendar_manage_forbidden`); step 3 `select * into v_event from public.events where id = p_event_id for update; if not found → PT404 event_not_found`; step 4 visibility `if private.caller_level() < v_event.min_level → PT404 event_not_found` (hidden = missing, the `events_read` predicate), then authority: **Organization Group Event** (`v_event.group_id`'s row has `legacy_dept_id = 'org'`) → `v_event.created_by = v_actor or actor_level >= 6` else `42501 calendar_manage_forbidden` (profile `for share`); otherwise `require_group_work_manager(v_event.group_id)` remapped; when `p_group_id <> v_event.group_id`, the same rule again on the target Group (an org target applies the org rule: any Group Role); step 5 `p_min_level` vs the **target** Group's `min_level` and the actor's level (same two reasons as create); step 6 `if v_event.cancelled_at is not null → PT409 event_cancelled`; step 7 `update … set title, type, group_id, starts_at, ends_at, location, capacity, description, min_level` (legacy columns re-derived by the trigger because `group_id` is in its `of` list — when the Group does not change, the trigger's UPDATE branch sees neither side changed and leaves the row alone); then for each important change — `starts_at/ends_at` (`schedule`), `location`, `group_id` (`group`), `min_level` — one `private.notify(array(select private.event_notification_recipients(p_event_id)) || <old Group's explicit members when the Group moved>, 'event', 'Eveniment actualizat: ' || v_event.title, <body naming the field and the new value in Bucharest time>, null, 'event:' || p_event_id || ':' || <field>, v_actor)`; title/type/description/capacity changes notify nobody.
- [ ] 4. `cancel_event_impl`: step 1 `p_reason` blank → `PT400 reason_required`; steps 2–4 as update; step 6 `cancelled_at is not null → PT409 event_cancelled`; step 7 `update … set cancelled_at = now(), cancel_reason = <trimmed>`; notify recipients with dedupe `'event:<id>:cancelled'`, title `'Eveniment anulat: ' || title`, body = the reason. Attendance rows are kept (ADR-0008: cancellation preserves RSVP history).
- [ ] 5. Grants (four-role, wrapper + impl to `authenticated`, resolver none); roster +3 (`update_event_impl` impl, `cancel_event_impl` impl, `event_notification_recipients` none) → 126; `expected_function_privs` += `update_event`, `cancel_event`.
- [ ] 6. Bounded sequence; `gen:types`; frontend gates; smoke unchanged.

**Tests**

`update_event.test.sql`: shape/grants; **Project Event**: coord ✔, resp ✔, ordinary_proj ✘ `42501`, bce_foreign ✘ (cannot even read a `min_level 6` one → `PT404 event_not_found`; can read a `min_level 0` one → `42501`); **Organization Group Event** created by coord: coord ✔, resp (holds a role, is not the creator) ✘ `42501`, bc ✔; move Project Event to `dt` by coord ✘ `42501` (no role on the target), by bce_edu ✔ only if they also manage the source — they do not → ✘; by bc ✔ and the row's `scope/dept_id/team_id/project_id` re-derived; `min_level` below the target Group's ✘ `event_min_level_below_group`; above the actor's ✘ `event_min_level_above_actor`; cancelled Event ✘ `PT409 event_cancelled`; claimless ✘ `42501`; unknown id ✘ `PT404`; **notifications**: change `starts_at` → exactly {going attendees ∪ explicit members} minus actor, dedupe `event:<id>:schedule`; a second schedule change while unread coalesces (one row, new body); change `location` → key `:location`; change `min_level` → `:min_level`; change Group → `:group`, recipients include the old Group's explicit members; change `description`/`capacity` → zero new rows (`is_empty`); a `declined` attendee is not notified; a deactivated member is not notified; `updated_at` moved (if step 2 kept).

`cancel_event.test.sql`: reason blank ✘ `PT400 reason_required` before the gate (claimless gets `PT400`); authority matrix as above; double cancel ✘ `PT409 event_cancelled`; `cancelled_at`/`cancel_reason` set together (`events_cancel_reason_ck` named in a direct-insert negative); attendance rows intact after cancel; notification `event:<id>:cancelled` to the same recipient set; `update_event` after cancel ✘ `PT409 event_cancelled`; `events_read` still shows the cancelled row to everyone at/above `min_level`.

**Commit:** `feat(db): update_event and cancel_event by Group Role with important-change notifications (#248)`.

---

## Task 7 — #523: leadership filters by Group; Department Cup by settings

**Issue/Branch:** `#523` · `backend/N7-leadership-on-groups`

**Files**

- create `supabase/migrations/<ts>_leadership_on_groups.sql`
- rewrite `supabase/tests/leadership_leaderboard.test.sql`, `department_cup_task_origins.test.sql`, `dept_cup.test.sql`, `leadership_member_tasks.test.sql`; modify `points_authorization_matrix.test.sql` (the `has_function_privilege` lines now name `leadership_leaderboard(bigint,bigint)`), `tracker_grants.test.sql` (args rows for `leadership_leaderboard_impl` and the public `leadership_leaderboard`; count unchanged at 126)
- `database.types.ts` regenerated (`leadership_leaderboard` Args; `department_cup`, `leadership_member_tasks`, `dept_cup` Row gain `group_id` / `group_name`)
- frontend: `app/src/queries/points.ts` reads `dept_cup` with an explicit column list (`dept_id, name, points, members`) — no change

**Interfaces**

- `public.leadership_leaderboard(p_group_id bigint default null, p_campaign_id bigint default null)` / `private.leadership_leaderboard_impl(bigint, bigint)` — the 4-arg pair dropped; `p_group_id` includes every Group below it: `task_group.path @> array[p_group_id]`
- `private.department_cup_rows(p_campaign_id bigint) returns table (dept_id text, name text, points int, members bigint, group_id bigint)` [authenticated_only]; `public.department_cup(bigint)` returns the same five columns (drop + create: return type change); view `public.dept_cup` keeps `dept_id, name, points, members` and appends `group_id` (`create or replace view` may add trailing columns)
- `public.leadership_member_tasks(uuid)` / `_impl` add `group_id bigint, group_name text` right after `origin_name` (drop + create)

**Steps (decisive lines)**

- [ ] 1. Suites first. Red.
- [ ] 2. Cup attribution: a Task credits the nearest ancestor-or-self that competes (top-level by constraint, so the path root), only if every link from the Task's Group up to it has `counts_toward_parent_cup`:

```sql
  with task_points as (
    select cup.id as cup_group_id, sum(entry.delta)::int as points
      from public.points_ledger as entry
      join public.tasks as task on task.id = entry.task_id
      join public.groups as task_group on task_group.id = task.group_id
      join lateral (
        -- nearest competing ancestor-or-self, walking root-ward
        select competing.id, ancestor.depth
          from unnest(task_group.path) with ordinality as ancestor(id, depth)
          join public.groups as competing on competing.id = ancestor.id and competing.competes_in_cup
         order by ancestor.depth desc
         limit 1
      ) as cup on true
     where entry.reason in ('task', 'task_reversal')
       and (p_campaign_id is null or task.campaign_id = p_campaign_id)
       and not exists (   -- every link strictly below the competing Group counts toward its parent
         select 1 from unnest(task_group.path) with ordinality as link(id, depth)
           join public.groups as node on node.id = link.id
          where link.depth > cup.depth and not node.counts_toward_parent_cup)
     group by cup.id
  ), roster as (
    select gm.group_id, count(*)::bigint as members
      from public.group_members as gm
      join public.profiles as member on member.id = gm.member_id and member.status = 'activ'
     group by gm.group_id
  )
  select grp.legacy_dept_id, grp.name, coalesce(task_points.points, 0), coalesce(roster.members, 0), grp.id
    from public.groups as grp
    left join task_points on task_points.cup_group_id = grp.id
    left join roster on roster.group_id = grp.id
   where <the #259 BCE+ gate, character-identical>
     and grp.competes_in_cup
   order by coalesce(task_points.points, 0) desc, grp.name asc;
```

`members` = active explicit roster of the competing Group itself (the Department Group's roster mirrors `member_departments`, so today's figures are reproduced; Department-Team members are not counted, as today). `departments.kind` is no longer read anywhere in `private`/`public` except the Wave 1 mirror.

- [ ] 3. `leadership_leaderboard_impl(p_group_id, p_campaign_id)`: `join public.groups as task_group on task_group.id = task.group_id` and `(p_group_id is null or task_group.path @> array[p_group_id])`; the `order by` contract and the gate unchanged. `leadership_member_tasks_impl`: add `task.group_id, origin_group.name` (`join public.groups as origin_group on origin_group.id = task.group_id`); the `origin_type/origin_id/origin_name` triple stays until Wave 3.
- [ ] 4. Grants per category on every recreated function; `dept_cup`: `revoke all … from public, anon, authenticated, service_role; grant select … to authenticated` restated (never `service_role`, conventions §4). Roster: two args rows change, count 126.
- [ ] 5. Bounded sequence; `gen:types`; frontend gates.

**Tests**

`leadership_leaderboard.test.sql` (rewrite; the #258 fixture world rebuilt on Groups): shape (2-arg signature, result type unchanged, wrapper invoker/impl definer, grants, the three views still exist); Department filter = its Group id includes the Department-Team Task; Team filter = the Team's Group id; Project filter; Independent Team reachable only under its own id; Campaign filter; `null, null` = the whole board (scoped assertions); ties, no `having`, inactive earner, `responsabil` (level 4) no rows, moderator rows; the #258 cross-check against `department_cup_rows` re-expressed by Group.

`department_cup_task_origins.test.sql` (rewrite): the "competing set" pin becomes `select legacy_dept_id from public.groups where competes_in_cup` = `{edu, pr, youth, fin, hr}`; attribution: Department Task ✔, Department-Team Task credits the root ✔, Project ✘, Independent Team ✘, reversed award nets to zero; **new**: as owner set `counts_toward_parent_cup = false` on the Department-Team Group → its Task no longer reaches the Department; set `competes_in_cup = false` on `youth` → the row disappears; a two-level chain (native Child of the Child, owner-inserted) credits the root only when both links count; Campaign filter; gate personas (`responsabil` no rows; inactive no rows; claimless no rows); `group_id` column present in `department_cup` and `dept_cup`.

`dept_cup.test.sql`: the twelve #134 assertions unchanged in meaning (five rows, points follow the Origin, members count active roster, ordering) plus `results_eq` on the column list `dept_id, name, points, members, group_id`.

`leadership_member_tasks.test.sql`: the exclusion list goes back to the eight columns (`group_id` is carried now); `group_id`/`group_name` asserted for the fixture Subtask; the rest unchanged.

**Commit:** `feat(db): leadership Leaderboard filters by Group subtree; Department Cup rows and attribution follow Group settings (#523)`.

---

## Task 8 — #524: closeout — smoke scenarios, docs, CONTEXT, ADR amendments, CLAUDE.md

**Issue/Branch:** `#524` · `chore/N8-groups-wave2-closeout`

**Files**

- modify `scripts/smoke-tracker-commands.sql` (new steps 20–23; the existing 19 untouched), `scripts/smoke-tracker-commands.sh` (unchanged unless the docker-splice needs the new `\gset` names)
- modify `docs/backend/conventions.md` §10 → "Groups (ADR-0009 Waves 1–2)", §2 (grandfathered direct-definer: none), §3 code table (the new reasons), §4 (the `create_event` grandfather entry removed)
- modify `CONTEXT.md` "Term → identifier" (`tasks.group_id`, `events.group_id`, `campaigns.group_id`, `completed_work_requests.group_id`; "Organization Group → `legacy_dept_id = 'org'`" now also names it as `create_event`'s org rule; the retired `event_scope` sentence gains "derived by trigger until Wave 3")
- modify `docs/adr/0009-groups.md` §Calendar (the `create_event(p_title, p_type, p_group_id, …, p_min_level)` signature; `update_event`/`cancel_event`; the org-Event edit rule as implemented) and §Migration (Wave 2 as landed: `group_id` on four tables, two-way trigger, shims, what Wave 3 still drops); `docs/adr/0008-calendar-visibility.md` amendment note gains the command names
- modify `CLAUDE.md` Status (Groups Wave 2 on `main`; the list of what reads Groups; Wave 3 next); `docs/superpowers/plans/<this plan>.md` gains its "Execution rulings"
- no migration; no roster change

**Smoke additions** (each step resolves ids with `\gset` from names, never hard-coded uuids; all inside the same rolled-back transaction):

- step 20 — _a Coordonator managing a Project Task_: `select leader_id … from projects where name = 'Festivalul Studențesc 2026' \gset`; log in as that leader (level `responsabil` today — irrelevant, the Group Role decides); `create_task(p_group_id => <Project Group>, …)`, `update_task_content`, `assign_task_executor(voluntar@)`, `set_task_queue` … `lives`; assert `group_id`, derived `project_id`.
- step 21 — _a Responsible refused on a Manager's Task_: the Project's Responsible (`activ@`) calls `cancel_task` on the Task the leader created **and executes** (assign the leader first as bc) → `smoke_denied` expects `42501 task_manage_forbidden`; then on an ordinary member's Task → lives.
- step 22 — _an Independent-Team peer managing a teammate's Task_: `t-logistica` has two members (`vot@`, `bc@`); as `vot@` create a Team Task assigned to `bc@`… (bc is a manager everywhere, so use the seed's other member if present, else create the peer through `add_independent_team_member` as bc first), then `vot@` calls `update_task_content` on the peer's Task → lives; `complete_task_review` → `42501 task_evaluate_forbidden`; bc evaluates → lives.
- step 23 — _a below-min-level member not seeing an org Opportunity_: as owner `update public.groups set min_level = 3 where legacy_team_id = 't-logistica'` (a scratch edit inside the rolled-back transaction, called out in a comment); bc creates a public org-Audience Task on that Group; `recrut@` (level 0) `select count(*) from public.tasks where id = :t_gated` = 0 and `express_task_interest` → `PT404 task_not_found`; `vot@` (level 3) sees it.
- step 19's "authenticated cannot write" block gains `insert into public.groups` and `insert into public.group_members` denials.

**Docs checklist**: conventions §10 rewritten to say what reads Groups now (every Task predicate, the Request and Campaign commands, the Calendar commands, the leadership reads), what still writes legacy (`departments/teams/projects` and the six roster tables, the structure gates), the two-way trigger contract (set one side; both sides only if consistent), the shims' drop date, the "never write `groups` by hand" rule with the test-fixture exception (`update … min_level` inside a rolled-back suite), the `category`-word rule for function bodies, the roster arithmetic (107 → 126), and the level-4 deferrals; `docs/README.md` index line for this plan.

**Verification:** `npx supabase db reset`; `bash scripts/smoke-tracker-commands.sh`; `bash scripts/check-local-ci.sh repo` (links, prettier on the docs); no db suites change.

**Commit:** `chore(db,docs): Groups Wave 2 closeout -- smoke Group scenarios, conventions §10, CONTEXT, ADR-0008/0009 amendments, CLAUDE.md status (#524)`.

---

## Risks, ranked

1. **Two-way trigger vs. `validate_task_campaign` / `validate_task_hierarchy` firing order and `of` lists.** Same-event BEFORE triggers fire in name order; `tasks_sync_group_origin` must sort before both validators (it does: `s` < `v`), and both validators' `of` lists must gain `group_id` in N4 or a Group-only update slips past them. Pinned by the trigger-order assertion in `group_origin_sync.test.sql` and the `set group_id` negatives in `tasks_campaign` / `tasks_umbrella`. Also: a BEFORE trigger cannot see a Group-only UPDATE's derived legacy triple until it runs, so any _other_ BEFORE trigger added later on `tasks` must sort after it — document in conventions §10.
2. **Recipient-set behavior (ruling D4, settled before Task 2).** `group_managers` falls back to the chain's Responsibles ∪ BC/Moderator only when no Manager exists anywhere on the path, so Independent-Team give-ups keep reaching teammates while a Project's Responsibles stop receiving its Manager-side notices. Task 2 implements the fallback and Task 3's recipient `set_eq`s are written against it; changing the ruling later moves every one of them.
3. **`tasks_with_overdue` dependents and column pins.** `leadership_member_tasks.test.sql` pins the view's column set (goes red in N1 unless the exclusion list is amended — planned), `tasks_campaign.test.sql:134` and `duplicate_task` read it, `app/src/queries/tasks.ts`'s `TASK_PRESENTATION_FIELDS` may select explicit columns (fine) or `*` (then a generated-type diff only). Verify with `grep -rn "tasks_with_overdue" app/src supabase/tests` before N1.
4. **Events composite FK with a null `dept_id`.** `events_team_department_fkey` is MATCH SIMPLE: a Team Event with `dept_id null` is no longer checked against `teams(id, dept_id)`. The trigger fills `dept_id` from the Team when null, so the only unchecked shape is an Independent-Team Event (whose Team really has `dept_id null`). A later writer that sets `dept_id null` on a Department-Team Event bypasses the FK — the trigger's fill-when-null is what closes it; pinned by test 24 of `group_origin_sync`.
5. **Seed `min_level` values and the retirement of 4.** The seed carries only 0 and 3; three suites carry a 4 (`rls_events`, `rls_event_attendance`, `set_event_rsvp`) and are retargeted in N1. Staging rows at 4 move to 5 by the migration (ruling OD3: never downwards). `demo_seed.test.sql:136/887` unaffected.
6. **The smoke script's legacy args through the shim.** Every smoke step runs as `bc@` (level 6), so the shims' `level >= 6` short-circuit hides a broken legacy→Group mapping; the manager-side scenarios are exercised only by the suites until N8 adds steps 20–23. Mitigation: `can_manage_origin.test.sql` (rewritten in N3) keeps the shim matrix for non-BC personas.
7. **`create_completed_work_request` overload resolution through PostgREST.** The frontend sends `p_dept_id/p_team_id/p_project_id` (two nulls). If the 4-arg wrapper were left beside the 5-arg one, PostgREST could not choose (both match the key set once defaults are considered) → 300 Multiple Choices. N4 must `drop` the 4-arg pair before creating the 5-arg one; `tracker_grants`'s `expected_function_privs` row (single args string) proves only one exists. Same care for `create_task`. `create_campaign` deliberately has two overloads with **different parameter names**, which PostgREST disambiguates by key.
8. **`can_read_task` cost under the read policies.** The rewrite adds per-row probes on `group_members` (member-indexed) and `groups` (tiny, `path @>` on a handful of rows); no nested `security definer` calls on the hot branches (they are inlined like #318 did after the 2.5 s → 0.25 s finding). Re-run #318's 5,000-Task timing as a plain member before merging N3; if it regresses past ~0.5 s, hoist the caller's roster rows into a CTE evaluated once per statement (`(select array_agg(group_id) …)` as an InitPlan) and probe with `@>` against that array.
9. **`group_role_of` with several roles across the chain** (e.g. `member` of `edu`, `manager` of its Child Team, or a BCE who is also a Project's ordinary member). The function takes the strongest across the path of the _target_ Group only, so a Project `member` who is BCE of an unrelated Department stays `member` on the Project. The one trap is Automatic Membership on an ancestor above a role on the Child: `min()` of ranks handles it. Test 14 pins per-path evaluation.
10. **Lock semantics of `require_group_work_manager`.** Holding the caller's `group_members` row `for share` blocks a concurrent mirror re-sync of _that same member's_ row (`on conflict … do update` takes `for no key update` even when nothing changes) for the command's duration — the same wait a `member_departments` `for share` causes today. Never widen it to the `groups` row (#509 ruling 9). Pinned by the `pgrowlocks` assertion (Task 2, test 37).
11. **`sync_groups_from_legacy()`'s orphan sweep vs. the new FKs.** A Group referenced by `tasks.group_id` whose legacy row disappeared can no longer be deleted by the repair function (23503). Unreachable while every legacy delete already fails on `tasks.team_id`/`project_id`, but the repair function's comment should say so (N1).
12. **The `category` sweep reads function text.** Any comment containing the word `category` inside a function body fails `conventions.test.sql`; the three mirror functions are excluded by name, nothing else. Reviewers must keep the prose in `comment on function`.
13. **`db lint` on the new plpgsql.** `require_task_manager` assigns nothing unused; `group_managers` uses `return query select unnest(v_ids)` (fine); watch `v_group_changed`/`v_legacy_changed` in the trigger bodies — both are read.
14. **Harness teardown drift.** `tasks_group_id_backfill_upgrade.test.sh` re-creates the pre-N1 constraints by hand; if a later migration changes `events_scope_fields_ck` again, the harness must be updated in the same PR (as `tasks_origin_upgrade.test.sh` had to be for #314/#315).

## Verification summary

| Task | Gates that must change                                                                                                                                                                                                                                                                                                                                                         | Gates that must not change                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1   | `group_origin_sync` new (34); `tasks_group_id_backfill_upgrade.test.sh` new; retargets in `tasks_origin`, `completed_work_requests_schema`, `campaigns_schema`, `event_constraints`, `rls_events`, `rls_event_attendance`, `set_event_rsvp`, `leadership_member_tasks` (exclusion list); `tracker_grants` count 107→112; `seed-fingerprint` campaign line; `database.types.ts` | every command suite; `rls_tasks_read_matrix`; `rls_deny_by_default` (fixtures derive `group_id`); `groups_*`; `demo_seed`; smoke; `check-seed-rerunnable` |
| N2   | `group_authority` new (44); `conventions` plan 10→14; `tracker_grants` 112→120                                                                                                                                                                                                                                                                                                 | everything else (no existing function changes)                                                                                                            |
| N3   | `can_manage_origin` (rewritten), `rls_tasks_read_matrix` (rewritten), `points_authorization_matrix` (+personas), the 16 command suites (+personas), `rls_task_history_read`, `tracker_management_reads`, `notify_helper`                                                                                                                                                       | `tracker_grants` (no roster change); `database.types.ts`; smoke (BC path); `groups_*`                                                                     |
| N4   | `completed_work_request_commands`, `campaign_commands`, `tasks_campaign` (rewritten); `create_task`, `duplicate_task`, `tasks_umbrella` (+assertions); `tracker_grants` 120→122 + 3 public rows; `database.types.ts`; frontend gates                                                                                                                                           | smoke (legacy args still accepted); `rls_deny_by_default`; `completed-work-requests.ts` compiles unchanged                                                |
| #370 | `create_event` (rewritten); `rls_events` one call; `tracker_grants` 122→123 + `create_event` row; conventions.md §2/§4; `database.types.ts`                                                                                                                                                                                                                                    | `rls_events` visibility sets; `event_constraints`; `events_attendance`; `set_event_rsvp`; smoke                                                           |
| #248 | `update_event`, `cancel_event` new; `tracker_grants` 123→126 + 2 rows; `shared_timestamps` if `updated_at`; `database.types.ts`                                                                                                                                                                                                                                                | `create_event`; `rls_events`; `notify_helper`; smoke                                                                                                      |
| N7   | `leadership_leaderboard`, `department_cup_task_origins`, `dept_cup`, `leadership_member_tasks` (rewritten); `points_authorization_matrix` signature lines; `tracker_grants` 2 args rows; `database.types.ts`; frontend gates (`points.ts` unchanged but types regenerated)                                                                                                     | Dashboard `dept_cup` column contract; every command suite; smoke                                                                                          |
| N8   | smoke script (+4 steps, +2 denials); docs; `check-local-ci.sh repo`                                                                                                                                                                                                                                                                                                            | every db suite; `tracker_grants`                                                                                                                          |
