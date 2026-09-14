# Task Tracker command wave — Stack E (2026-09-14)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Task Tracker its write path — the seventeen server commands ADR-0007 names (#327–#342, #344), retire every legacy direct-write path (#345), and rebuild the demo seed on the normalized model (#296) — so that after this stack a Task can be created, queued for, taken, worked, reviewed, evaluated, reopened, cancelled and paid out **only** through atomic, actor-derived commands.

**Architecture:** Eighteen additive Supabase migrations plus one seed rebuild on `main`, one per issue, in one linear stack of nineteen PRs. Every command is the `#343` shape already on `main`: a `security invoker` `public.<verb>_<noun>()` wrapper over a `security definer` `private.<verb>_<noun>_impl()` that gates, checks visibility, locks the `tasks` row `for update`, re-validates authority under `for share` locks, validates input, checks state, mutates, appends `task_activity`, and writes targeted notifications through `private.notify` — all in one transaction. Task 1 ships the shared authority kit every later command calls; Task 11 ships the shared evaluation core that completion, unfulfilled and request approval all reuse. Nothing here touches the frontend beyond regenerated types; the Tracker UI (#164–#191, #346–#354) is the next plan.

**Tech stack:** PostgreSQL 15 on Supabase (RLS, `security definer` plpgsql, `dblink` + `pgrowlocks` for concurrency tests), pgTAP, the repo's `supabase/tests/_helpers.sql` harness (`test_login`, `test_login_leadership`, `test_clear_jwt`, `test_race`, `test_credit_task`).

**Spec:** `docs/adr/0007-task-tracker-lifecycle.md` (amended 2026-09-10) is the authority; the nineteen issue bodies (dumped to the SDD workspace as `command-issues.md`) are its argument; `docs/backend/conventions.md` §2–§5 binds the shape; `CONTEXT.md` binds vocabulary. Where an issue body and the merged schema disagree, **the schema on `main` wins** (see "Verified facts") and the PR body says so.

## Context

Stack C (#430–#450) merged on 2026-09-13 with dobrerares' spine, so `main` now holds the complete normalized model: one Executor with assignment history, six lifecycle states, derived overdue, explicit Origin/Audience/Assignment Mode, Campaigns, Umbrellas, the Candidate Queue table, append-only `task_activity` and `task_evaluations`, `completed_work_requests`, points bound to Evaluations, live-state read policies over all of it, normalized grants pinned as a closed roster, and `private.notify` / `private.task_managers`. **Only one command exists** — `#343`'s Campaign trio, built deliberately as the template for this wave. The four history tables are `select`-only for `authenticated` and have no writers; Tasks themselves can still be written through three legacy level-4 policies (`tasks_create_legacy` / `tasks_update_legacy` / `tasks_delete_legacy`) and `claim_open_task`, none of which stamp history. This stack closes that gap and then removes those paths.

All nineteen issues are **open, unassigned, and unblocked** as of 2026-09-14 (every `## Blocked by` entry is closed; #296's last blocker #281 closed with PR #407). The stack sits directly on `main` — no one else's drafts underneath this time. `delete_branch_on_merge` is on, so bottom-up merging auto-retargets each PR.

### Verified facts that shape the tasks (read against `main` @ `1a91a12`)

These are true of the merged schema and override any looser wording in an issue body:

- **`task_activity.kind` is a fixed `text check` list — no new kinds are needed, but the names differ from the issue prose.** Allowed: `created, content_updated, mode_converted, queue_opened, queue_closed, interest_expressed, interest_withdrawn, candidate_selected, executor_assigned, gave_up, started, submitted, returned_to_progress, evaluated, reopened, cancelled, duplicated, subtask_completed, unfulfilled, umbrella_completed`. Issue text saying `assigned` means `executor_assigned`; `mode_changed` means `mode_converted`; `candidate_joined` means `interest_expressed`. `task_activity.details` is `jsonb not null` — always write at least `'{}'`. `task_activity` is append-only by trigger (`private.reject_task_activity_change`).
- **`task_candidates` has no `position` column.** Queue order is `joined_at, id`; `private.queue_position(task, member)` and `private.pending_candidate_count(task)` already derive it. Statuses `pending | selected | withdrawn | closed`; `task_candidates_decision_shape_ck` requires: `pending` ⇒ no `decided_at/decided_by/assignment_id`; `withdrawn` ⇒ `decided_at` + `decided_by` (the member); `closed` ⇒ `decided_at` (`decided_by` may be null for an automatic close, or the manager); `selected` ⇒ `decided_at` + `decided_by` + `assignment_id`. One `pending` row per (task, member) (`task_candidates_one_pending_per_member_uidx`) — rejoining after withdrawal is a new row.
- **`task_assignments.end_reason`** ∈ `gave_up | replaced | completed | failed | cancelled | legacy_migration`; `end_shape_check` requires `ended_at` + `end_reason` together; **one active assignment per task** is enforced by `task_assignments_one_active_per_task_uidx` (`where ended_at is null`) — a second concurrent insert raises `unique_violation`, which is the safety net behind every race below, but the commands must serialize on the `tasks` row lock so the _second_ caller gets a clean `PT409`, not a constraint error.
- **`task_evaluations`**: `outcome` ∈ `completed | unfulfilled`; `difficulty`/`rating` 1–5; **`note text not null` and non-blank** (`task_evaluations_note_ck`) — so every evaluating command requires a note (`PT400 evaluation_note_required`); `points integer not null`; `source = 'command'` (the trigger `reject_legacy_evaluation_source` blocks `legacy_migration` for good); `evaluated_by` not null for `command`; one open (unreversed) Evaluation per Assignment and per Task (`command` source); the reversal trio (`reversed_at/by/reason`, reason non-blank) is the **only** update the guard trigger permits, exactly once.
- **`points_ledger`**: `reason` ∈ `task | task_reversal | sanction`; `task`/`task_reversal` rows require both `task_id` and `evaluation_id`; `points_ledger_evaluation_reason_uidx` on `(evaluation_id, reason)` allows exactly one `task` and one `task_reversal` row per Evaluation. Points = `difficulty * public.rating_mult(rating)` where `rating_mult` = 1→−1, 2→0, 3→1, 4→2, 5→3.
- **`tasks` constraints that the commands must satisfy on every transition** (the issue bodies omit most of these):
  - `tasks_queue_timestamp_state_check`: `direct` ⇒ both queue timestamps null; `public` ⇒ `queue_opened_at not null`, and **a public Task at `completed`/`unfulfilled`/`cancelled` must have `queue_closed_at not null`**. Every terminal transition on a public Task closes the queue.
  - `tasks_submitted_at_state_check`: `in_review` ⇒ `submitted_at not null`; `submitted_at` may only be non-null in `in_review`/`completed`/`unfulfilled`/`cancelled`. So `return_task_to_progress` **and** `reopen_task` must null `submitted_at`.
  - `tasks_started_at_state_check`: `started_at` null or status ≠ `todo`.
  - `tasks_completed_at_state_check` / `_unfulfilled_at_` / `_cancelled_at_`: each timestamp is non-null **iff** the status matches.
  - `tasks_review_return_check`: `review_round >= 0` and `(review_round > 0) = (returned_to_progress_at is not null)`.
  - `tasks_evaluation_inputs_ck`: ordinary Task at `completed`/`unfulfilled` ⇒ `difficulty` and `rating` both set; any other status ⇒ `rating is null` (difficulty may be pre-set). Umbrellas are exempt.
  - `tasks_umbrella_shape_ck` / `tasks_task_shape_ck`: an Umbrella has null `parent_task_id`, `audience`, `assignment_mode`, `difficulty`, `rating`; an ordinary Task has `audience` and `assignment_mode`.
  - `tasks_lifecycle_timestamp_order_check`: every lifecycle timestamp ≥ `created_at`, and the natural order among them.
  - Triggers `tasks_validate_campaign` (Campaign belongs to the Task's Department or the Team's parent Department, and is active) and `tasks_validate_hierarchy` (one level deep; Subtask origin = Umbrella origin, immutable) fire on the commands' inserts/updates — commands rely on them and re-raise nothing.
- **Columns that do not exist yet**: `tasks.cancel_reason` (Task 14 adds it) and `tasks.duplicated_from_task_id` (Task 16 adds it). **`public.tasks_with_overdue` is `select task.*`-shaped** — any migration that adds a `tasks` column must `drop view` and recreate it with the identical column list plus the new column, `with (security_invoker = on)`, the same comment (`'RLS-aware Task query surface with overdue derived from the current clock and unfinished lifecycle state.'`) and grants (`select` to `authenticated, service_role`), or the column is invisible to the app.
- **Authority helpers already on `main`** (reuse, do not redefine): `private.can_manage_origin(dept, team, project)` (level ≥ 6; local BCE for a Department or a Department-Team's parent; **any active member of an Independent Team**; `can_manage_project_work` for a Project — lead, Responsible, active Project only), `private.can_manage_task(task_id)` (= `can_manage_origin` of the Task's origin), `private.can_read_task(task_id)`, `private.is_task_executor(task_id)`, `private.is_task_candidate(task_id)`, `private.is_project_lead(project_id)`, `private.is_project_responsible(project_id)`, `private.caller_level()`, `private.task_managers(task_id, actor) returns setof uuid` (creator while live and not the actor; else the Origin's managers; else BC/Moderator), `private.notify(recipients uuid[], kind noti_kind, title, body, task_id, dedupe_key, actor) returns integer` (drops the actor, inactive and duplicate recipients; upserts on `(member_id, dedupe_key)` while unread). **Nothing on `main` distinguishes _evaluating_ from _managing_** — `can_manage_origin`'s Independent-Team branch admits every member, and ADR-0007 gives evaluation there to BC/Moderator only. Task 1 adds `private.can_evaluate_task`.
- **`private.task_managers` already excludes the actor and inactive members**, and `private.notify` does too — commands pass the actor and let the helpers drop it; they never filter recipients themselves.
- **Notification copy is Romanian** (seed: `'Task nou: Contactare lectori'`, `'Deadline peste 5 zile.'`); `kind` is `'task'::public.noti_kind` for everything in this wave; deadlines render as `to_char(deadline at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI')`.
- **Legacy surface #345 retires** (exact names on `main`): policies `tasks_create_legacy` (insert, `auth_level() >= 4`), `tasks_update_legacy`, `tasks_delete_legacy`, `assignee_manage` (`for all`, level ≥ 4 — a SELECT leak over `task_assignees`, Stack C review I1), `assignee_read`, `request_create`, `request_decide`, `request_read`; function `public.claim_open_task(bigint)` (`security definer`, writes only `task_assignees`); tables `task_assignees`, `task_requests`; enums `request_kind`, `request_status`. The frontend does **not** call any of them (`app/src` has one `from('tasks')` and it is a `select`; `set_event_rsvp` is the only `rpc`); only `database.types.ts` references them. `seed.sql` still inserts `task_assignees` rows and `scripts/seed-fingerprint.sql` still has an `assignee:` line; `rls_deny_by_default.test.sql` has fixture rows for both tables; `tracker_grants.test.sql` lists both in its object roster with full DML expected.
- **The pinned roster is a closed set.** `supabase/tests/tracker_grants.test.sql` diffs `pg_proc` in schema `private` against an explicit roster in both directions and asserts the exact count (50 today). **Every task that creates a `private` function adds its row and bumps the count in the same commit**, or CI is red. Categories: `impl` (granted to `authenticated`), `predicate` (`can_*`/`is_*`, granted to `authenticated`), `require` (no grant), `trigger` (no grant), `none` (internal helper, no grant), `authenticated_only`.
- **The conventions sweep is on `main`** (`supabase/tests/conventions.test.sql`): every `security definer` function pins `search_path = ''`; nothing in `public`/`private` is executable by `anon`; no `require_*` or trigger function is executable by `authenticated`; `anon`/`service_role` have no `usage` on `private`. It runs in CI now — no hand-run probe needed.
- The test harness (`supabase/tests/_helpers.sql`): `pg_temp.test_login(uid, app_metadata jsonb)` sets exact (possibly stale or forged) claims and `role authenticated`; `pg_temp.test_login_leadership(uid)` derives live claims; `pg_temp.test_clear_jwt()`; `pg_temp.test_race(sql_a, sql_b) returns (result_a, result_b, b_waited)` runs A in one dblink session, starts B in another, reports whether B blocked on a lock before A committed; `pg_temp.test_credit_task(task, member, evaluator, note)` records a `command` Evaluation + ledger row on an already-evaluated fixture Task. `extensions.pgrowlocks('public.tasks')` joined on `ctid` shows a row's current lock modes from a second session (`campaign_commands.test.sql:550-575` is the worked example).

## Global Constraints

Every task's requirements implicitly include this section.

**Process (CLAUDE.md house rules 5, 7, 8, 9, 12, 13; Stack C lessons):**

- One issue = one branch = one PR; body says `Closes #n` **exactly once and only for the issue that PR closes** (never write a closing keyword next to any other issue number). CI green before review. **Never merge; never push to `main`; never force-push; never rebase a pushed branch — stack updates are merge commits only.** Merging is Alex's act (or the controller's, only on his explicit instruction).
- Branches `stacke/<issue>-<slug>`; each PR's base is the previous branch; the bottom PR's base is `main` and is a normal PR; every other PR is a **draft** whose body starts with `Base: <branch> — merge after #<n>.` and `**Do not merge while the base is not main.** Mark ready only after #<n> has merged and this PR's base reads main.`
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Never two database passes at once** (`db reset` / `test db` / a dblink race suite / `check-seed-rerunnable.sh`) — strictly sequential. Never two implementers at once.
- No Prettier `--write` on existing files. Never stage `docs/superpowers/plans/2026-09-11-project-team-role-matrix.md` (another session's).
- Migrations are created with `npx supabase migration new <name>` (the timestamp is automatically above `20260911211700`); first line `-- #<issue>: <purpose>`; never edit a merged migration. `database.types.ts` is regenerated (`cd app && npm run gen:types`) in any task that changes a table/view/enum/`public` function, and left byte-identical otherwise.
- Every PR runs, in order and sequentially: `npx supabase db reset` → `npx supabase test db` (all suites green, `plan(N)` exact) → every `supabase/tests/*_upgrade.test.sh` → `bash scripts/check-seed-rerunnable.sh` → `npx supabase db lint --level warning --fail-on warning` → `cd app && npm run gen:types && npm run typecheck && npm run lint && npm run test:run`.

**Command shape (conventions §2–§4, binding for every command in this stack):**

- `public.<verb>_<noun>(…)` is `language sql security invoker set search_path = ''` and does exactly `select private.<verb>_<noun>_impl(…)`. The `_impl` is `language plpgsql security definer set search_path = ''`, fully qualifies every name, reads the actor as `(select auth.uid())` and **never** accepts it as a parameter. Return the affected `public.tasks` row (`returns public.tasks`) unless the task says otherwise.
- Grants, verbatim per function: `revoke execute on function <f> from public, anon, authenticated, service_role;` then `grant execute on function <f> to authenticated;` **only** for the wrapper, the `_impl`, and any `private.can_*`/`is_*` predicate. `private.require_*` helpers and internal helpers (`log_*`, `open_*`, `end_*`, `close_*`, `evaluate_task`) get **no grant back**. `grant usage on schema private to authenticated;` once per migration (idempotent).
- **Step order inside every `_impl`, and nothing may be reordered:**
  1. **Malformed-for-everyone input** (a null id, a null boolean flag) → `PT400` before anything else (the `#343` `set_campaign_active` precedent).
  2. **Gate + visibility:** `v_actor := private.require_task_visible(p_task_id)` (Task 1) — `42501 task_command_forbidden` for no uid / no claims / not a live `activ` profile; `PT404 task_not_found` when `private.can_read_task` is false. Never let a caller distinguish hidden from missing (conventions §3).
  3. **Lock the target:** `select … from public.tasks where id = p_task_id for update` into a `%rowtype` variable. **The `tasks` row is always the first row locked** by any command; assignment, candidate, evaluation, request rows are locked after it. A command that will touch a Subtask **and** its Umbrella locks the Umbrella row first, then the Subtask (`cancel_task` cascade, `reopen_task` on a Subtask, `complete_umbrella_task`); `evaluate_task` never locks the parent row.
  4. **Authority under lock:** `perform private.require_task_manager(p_task_id)` / `require_task_evaluator` / `v_assignment_id := private.require_task_executor(p_task_id)` — these re-validate against live rows and take `for share` locks on the actor's profile and the membership row their authority rests on, so a concurrent revocation serializes (the `#343` / `#390` discipline). `42501 <scope>_forbidden`.
  5. **Input validation** (`PT400`): blank text via `p_x is null or p_x !~ '[^[:space:]]'`; ranges; foreign ids that must exist (`PT400 invalid_<x>`, never `PT404` for a parameter that is not the target).
  6. **State preconditions** (`PT409`): terminal status, wrong status, umbrella/task kind, queue closed, an assignment already active, a candidature already live.
  7. **Mutate**, then `perform private.log_task_activity(…)`, then `perform private.notify(…)` for each recipient set, then `return v_task` re-read after the update.
- Errors: `42501` via `raise exception using errcode = '42501', message = '<scope>_forbidden';`; `PT4xx` via `raise sqlstate 'PT400' using message = '<snake_case_reason>';`. Reason strings are the ones pinned in each task; the frontend normalizes on the message.
- Text is trimmed with `regexp_replace(p_x, '^[[:space:]]+|[[:space:]]+$', '', 'g')`, never `btrim` (tabs/newlines).
- Timestamps written by commands use `clock_timestamp()` where two writes in one transaction must differ (`occurred_at`, `updated_at`), `now()` for lifecycle columns that the constraints compare with each other (`started_at`, `submitted_at`, `completed_at`, `ended_at`, `decided_at`, `queue_closed_at`, `cancelled_at`) so that `ended_at = completed_at` style equalities hold exactly.
- Once a command owns a table's writes the same migration carries the idempotent `revoke insert, update, delete on table public.<t> from authenticated;` for that table (`campaigns` precedent). For `tasks` this lands in Task 18 (the legacy policies stay until then; the commands themselves already bypass them as definer).

**Activity rows (binding shape):** written only through `private.log_task_activity` (Task 1). `assignment_id` is stamped on every row about the Executor's own work — `executor_assigned`, `gave_up`, `candidate_selected`, `started`, `submitted`, `returned_to_progress`, `evaluated`, `unfulfilled`, `reopened` — and left null on `created`, `content_updated`, `mode_converted`, `queue_opened`, `queue_closed`, `interest_expressed`, `interest_withdrawn`, `cancelled`, `duplicated`, `subtask_completed`, `umbrella_completed` (Stack C Ruling 13: `task_activity_read`'s own-assignment branch depends on this; candidate rows must not carry it). `from_status`/`to_status` are set on every status change and null otherwise. `note` carries the human text of the event (a give-up reason, a review note, a cancel reason, an evaluation note); `details` carries the structured facts each task pins.

**Notifications (binding recipients and copy):** always `'task'::public.noti_kind`, `p_task_id` = the Task the row is about, `p_actor` = the actor. `{title}` is the Task title, `{name}` the actor's `full_name`, `{deadline}` the formatted deadline, `{reason}`/`{note}` the trimmed text.

| Event                                                                                | Recipients                                                                              | Dedupe key                    | Title                                            | Body                                                                      |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| Executor assigned (create direct, assign, select, queue promotion, request approval) | the new Executor                                                                        | null                          | `Task nou: {title}`                              | `Ți-a fost atribuit acest task. Deadline: {deadline}.`                    |
| First-come Executor (self via `express_task_interest`)                               | `task_managers`                                                                         | null                          | `Executor nou: {title}`                          | `{name} a preluat taskul.`                                                |
| Candidate joined / withdrew                                                          | `task_managers`                                                                         | `task:{id}:queue`             | `Coadă: {title}`                                 | `{n} candidați în așteptare.` (`n` = live pending count after the change) |
| Queue closed (manager close, completion, unfulfilled, cancel)                        | the pending Candidates being closed                                                     | null                          | `Coadă închisă: {title}`                         | `Nu mai poți fi selectat pentru acest task.`                              |
| Content updated                                                                      | the active Executor                                                                     | null                          | `Task actualizat: {title}`                       | `Modificat: {changed fields joined by ', '}.`                             |
| Gave up                                                                              | `task_managers`                                                                         | null                          | `Renunțare: {title}`                             | `{name} a renunțat: {reason}`                                             |
| Executor replaced by selection                                                       | the replaced Executor                                                                   | null                          | `Înlocuit: {title}`                              | `Managerul a ales alt executant.`                                         |
| Submitted for review                                                                 | `task_managers`                                                                         | null                          | `De verificat: {title}`                          | `{name} a trimis taskul spre verificare.`                                 |
| Returned to progress                                                                 | the active Executor                                                                     | null                          | `Feedback de implementat: {title}`               | `{note}`                                                                  |
| Evaluated completed                                                                  | the evaluated Executor                                                                  | null                          | `Task evaluat: {title}`                          | `{points} puncte (dificultate {difficulty}, calificativ {rating}).`       |
| Evaluated unfulfilled                                                                | the evaluated Executor                                                                  | null                          | `Task nerealizat: {title}`                       | `{points} puncte (dificultate {difficulty}, calificativ {rating}).`       |
| Reopened                                                                             | the reactivated Executor                                                                | null                          | `Task redeschis: {title}`                        | `{reason}`                                                                |
| Cancelled                                                                            | the active Executor and the pending Candidates                                          | null                          | `Task anulat: {title}`                           | `{reason}`                                                                |
| Subtask became terminal                                                              | `task_managers(umbrella_id, actor)`                                                     | `task:{umbrella_id}:subtasks` | `Subtask încheiat: {umbrella title}`             | `{terminal} din {total} subtaskuri încheiate.`                            |
| Umbrella completed                                                                   | `task_managers(umbrella_id, actor)` (usually empty — the actor is normally the manager) | null                          | `Umbrelă finalizată: {title}`                    | `Toate subtaskurile sunt încheiate.`                                      |
| Completed-work request created                                                       | the request's deciders (Task 17 pins the set)                                           | `request:{id}`                | `Cerere nouă: {description, first 60 chars}`     | `{name} a trimis o cerere de muncă realizată.`                            |
| Request approved                                                                     | the requester                                                                           | null                          | `Cerere aprobată: {description, first 60 chars}` | `{points} puncte (dificultate {difficulty}, calificativ {rating}).`       |
| Request rejected                                                                     | the requester                                                                           | null                          | `Cerere respinsă: {description, first 60 chars}` | `{note}`                                                                  |

**Tests (conventions §8, binding for every command suite):**

- `supabase/tests/<name>.test.sql` per the issue's "Required tests", skeleton `begin; \set osubb_test_suite true \ir _helpers.sql set local search_path = public, extensions; create extension if not exists pgtap with schema extensions;` (+ `pgrowlocks` where a lock probe is used) → `select plan(N);` exact → … → `select * from finish(); rollback;`. Fixture UUIDs prefixed `<issue>00000-0000-0000-0000-0000000000NN` (e.g. `32700000-…`), created as owner (`reset role`) with `auth.users` + `profiles` + memberships; every fixture Task inserted directly as owner in the exact shape the constraints demand.
- Personas, one `test_login` per persona with **explicit claims** (stale where the test needs them): BC (level 6), local BCE of the Origin Department, BCE of another Department, an ordinary member inside the Origin, an ordinary member outside it, an Independent-Team member, a Project lead, a Project Responsible, a plain Project member, a **deactivated member holding a still-valid manager token**, a **claimless real uid**, and `anon` (`set local role anon` after `test_clear_jwt`). One `throws_ok(sql, code, message, description)` per denied persona × operation, with the exact reason string; one `lives_ok`/`is` per allowed one.
- Every `PT400`/`PT404`/`PT409` path the task pins has one assertion naming the code **and** the reason string. Every `42501` path asserts the code and the `_forbidden` reason.
- After each successful command: assert the `task_activity` row (`kind`, `actor_id`, `assignment_id` null or set per the rule above, `from_status`/`to_status`, and the `details` keys the task pins) and the `notifications` rows (**exact recipient set** via `set_eq`, the actor absent, `dedupe_key` where pinned, title prefix) — and that a denied call wrote **no** activity and **no** notification.
- **Concurrency:** where the task says "race", a `pg_temp.test_race` whose second session **blocks** (`b_waited = true`) and whose outcomes are asserted exactly (one success, one `PT409` with the pinned reason, or two successes with the pinned end state). Where no race is required, at least one **lock probe**: run the command in a held dblink transaction and assert from the test session via `extensions.pgrowlocks('public.tasks')` that the Task row is `For Update` and the actor's `profiles` row `For Share` (copy `campaign_commands.test.sql:540-575`).
- A direct-write denial for the command-owned tables the command writes (`insert`/`update` on `task_assignments`, `task_candidates`, `task_activity`, `task_evaluations`, `points_ledger`, `completed_work_requests` as an authorized manager → `42501`), proving the command is the only path.
- RED first: the suite is committed before the migration and fails with `function … does not exist`; the report shows the RED run. Then GREEN on the full suite.
- **Roster:** add every new `private` function to `tracker_grants.test.sql`'s `pinned_private_functions` with its category and bump the `count(*)` assertion; the `unpinned`/`missing` diffs must both be `{}`.

**Ruling authority:** the spec is ADR-0007; where an issue body contradicts the schema on `main`, the schema wins and the deviation is stated in the migration header and PR body. Where neither answers, the plan's rulings below answer; the controller records further rulings in the ledger.

---

## Stack overview

| #   | Issue                                          | Branch                             | Base   | Migration (`migration new` name)    | Suite                                           | Model  |
| --- | ---------------------------------------------- | ---------------------------------- | ------ | ----------------------------------- | ----------------------------------------------- | ------ |
| 1   | #327 create_task + authority kit               | `stacke/327-create-task`           | `main` | `task_command_kit_and_create_task`  | `create_task.test.sql`                          | opus   |
| 2   | #328 update_task_content                       | `stacke/328-update-task-content`   | 1      | `update_task_content`               | `update_task_content.test.sql`                  | sonnet |
| 3   | #329 convert_task_mode                         | `stacke/329-convert-task-mode`     | 2      | `convert_task_mode`                 | `convert_task_mode.test.sql`                    | sonnet |
| 4   | #330 express/withdraw interest (race)          | `stacke/330-task-interest`         | 3      | `task_interest_commands`            | `task_interest.test.sql`                        | opus   |
| 5   | #331 set_task_queue                            | `stacke/331-set-task-queue`        | 4      | `set_task_queue`                    | `set_task_queue.test.sql`                       | sonnet |
| 6   | #342 assign_task_executor                      | `stacke/342-assign-task-executor`  | 5      | `assign_task_executor`              | `assign_task_executor.test.sql`                 | sonnet |
| 7   | #332 give_up_task (race)                       | `stacke/332-give-up-task`          | 6      | `give_up_task`                      | `give_up_task.test.sql`                         | opus   |
| 8   | #333 select_task_candidate (race)              | `stacke/333-select-task-candidate` | 7      | `select_task_candidate`             | `select_task_candidate.test.sql`                | opus   |
| 9   | #334 start_task + submit_task_for_review       | `stacke/334-task-progress`         | 8      | `task_progress_commands`            | `task_progress_commands.test.sql`               | sonnet |
| 10  | #335 return_task_to_progress                   | `stacke/335-return-to-progress`    | 9      | `return_task_to_progress`           | `return_task_to_progress.test.sql`              | sonnet |
| 11  | #336 evaluate_task core + complete_task_review | `stacke/336-complete-task-review`  | 10     | `evaluate_task_and_complete_review` | `complete_task_review.test.sql`                 | opus   |
| 12  | #337 mark_task_unfulfilled                     | `stacke/337-mark-unfulfilled`      | 11     | `mark_task_unfulfilled`             | `mark_task_unfulfilled.test.sql`                | sonnet |
| 13  | #338 reopen_task                               | `stacke/338-reopen-task`           | 12     | `reopen_task`                       | `reopen_task.test.sql`                          | opus   |
| 14  | #339 cancel_task (+ `cancel_reason`, view)     | `stacke/339-cancel-task`           | 13     | `cancel_task`                       | `cancel_task.test.sql`                          | sonnet |
| 15  | #340 complete_umbrella_task                    | `stacke/340-complete-umbrella`     | 14     | `complete_umbrella_task`            | `complete_umbrella_task.test.sql`               | sonnet |
| 16  | #341 duplicate_task (+ column, view)           | `stacke/341-duplicate-task`        | 15     | `duplicate_task`                    | `duplicate_task.test.sql`                       | sonnet |
| 17  | #344 completed-work request commands (race)    | `stacke/344-request-commands`      | 16     | `completed_work_request_commands`   | `completed_work_request_commands.test.sql`      | opus   |
| 18  | #345 retire the legacy write paths             | `stacke/345-retire-legacy-writes`  | 17     | `retire_legacy_task_writes`         | extends `rls_deny_by_default`, `tracker_grants` | opus   |
| 19  | #296 rebuild the demo seed                     | `stacke/296-seed-rebuild`          | 18     | none (seed + tests)                 | `demo_seed.test.sql`                            | opus   |

Why this order: 1 is the kit everything calls; 2–3 are the smallest commands and prove the kit before the races; 4 must precede 5 (closing a queue is tested by an interest attempt) and 7–8 (they consume the queue 4 builds); 6 precedes 7 so "direct task left without an Executor" has its remedy in place; 9 → 10 → 11 → 12/13 is the lifecycle in the ADR's own order, with the evaluation core (11) built once and reused by 12, 13 and 17; 14–16 are independent of the lifecycle and add the two columns (each recreates the view); 17 reuses the core and the kit; 18 is blocked by every command; 19 rebuilds the seed on the finished model and must follow 18 (the seed still inserts the legacy `task_assignees` rows 18 drops).

Review model per task: opus for 1, 4, 7, 8, 11, 13, 17, 18 (concurrency, authority, money, destructive drops); sonnet otherwise.

---

### Task 1: #327 — `create_task` and the shared authority kit

**Files:**

- Create: `supabase/migrations/<ts>_task_command_kit_and_create_task.sql`
- Create: `supabase/tests/create_task.test.sql`
- Modify: `supabase/tests/tracker_grants.test.sql` (roster: +9 rows)
- Modify: `app/src/lib/database.types.ts` (new `public.create_task` function)

**Interfaces — Produces (every later task consumes these exact signatures):**

```text
private.can_evaluate_task(p_task_id bigint) returns boolean                      -- predicate, granted to authenticated
private.require_task_visible(p_task_id bigint) returns uuid                      -- gate + PT404; returns actor
private.require_origin_manager(p_dept_id text, p_team_id text, p_project_id bigint) returns uuid
private.require_task_manager(p_task_id bigint) returns uuid                      -- caller holds the tasks row lock
private.require_task_evaluator(p_task_id bigint) returns uuid                    -- caller holds the tasks row lock
private.require_task_executor(p_task_id bigint) returns bigint                   -- returns the active assignment id, locked for update
private.log_task_activity(p_task_id bigint, p_kind text, p_actor uuid, p_assignment_id bigint,
                          p_from public.task_status, p_to public.task_status, p_note text, p_details jsonb) returns bigint
private.open_task_assignment(p_task_id bigint, p_member_id uuid, p_actor uuid, p_via text) returns bigint
private.end_task_assignment(p_assignment_id bigint, p_reason text, p_note text) returns void
private.close_task_queue(p_task_id bigint, p_decided_by uuid) returns uuid[]     -- pending candidates closed; returns their member ids
public.create_task(p_title text, p_description text, p_deadline timestamptz, p_dept_id text, p_team_id text,
                   p_project_id bigint, p_audience text, p_assignment_mode text, p_executor_id uuid default null,
                   p_campaign_id bigint default null, p_parent_task_id bigint default null, p_kind text default 'task')
                   returns public.tasks
```

**Rulings for this task:**

- The issue asks for `can_manage_task` and `task_origin`; `can_manage_task` already exists on `main` and is reused unchanged; `task_origin` is unnecessary (the locked `%rowtype` carries the origin) and is not created.
- `can_evaluate_task` = `can_manage_task` **minus** the Independent-Team member branch (BC/Moderator only) **minus** a Project Responsible evaluating the lead's active Assignment or their own; the lead evaluates anything on their Project including their own work (ADR-0007 §Authorization). **`private.is_project_lead` / `is_project_responsible` on `main` do not check the Project's status**, so the Project branch below adds `projects.status = 'active'` explicitly — an archived Project's Tasks cannot be evaluated, consistent with `can_manage_project_work` and Stack C's Ruling 17.
- A Subtask created through `create_task` takes the Umbrella's origin from the **Umbrella row**; the caller's `p_dept_id/p_team_id/p_project_id` must be null or equal to it (`PT400 subtask_origin_mismatch` otherwise) — never silently overwritten.
- Direct Task with `p_executor_id`: any active member (ADR amendment). Public Task: `queue_opened_at = now()`, executor parameter must be null (`PT400 executor_not_allowed_for_public`). Umbrella: audience, mode, executor, campaign all null (`PT400 umbrella_has_no_mode`); a Subtask cannot itself be an Umbrella (`PT400 subtask_cannot_be_umbrella`).
- Deadline is required for ordinary Tasks (`PT400 deadline_required`) and optional for an Umbrella.

- [ ] **Step 1: Branch**

```bash
git switch -c stacke/327-create-task origin/main
```

- [ ] **Step 2: Write the failing suite** `supabase/tests/create_task.test.sql`

Fixtures (owner, prefix `32700000-…`): Departments `edu` and `pr` exist; Project `Proiect #327` with lead `…01`, Responsible `…02`, member `…03`; Independent Team `t-327-ind` (`dept_id null`) with member `…04`; Department Team `t-327-dt` under `edu`; personas BC `…05`, local BCE(edu) `…06`, foreign BCE(pr) `…07`, ordinary edu member `…08`, ordinary pr member `…09`, deactivated BC `…10` (`status = 'inactiv'`), claimless `…11`; an active Campaign `Campanie #327` in `edu` and one in `pr`; an existing Umbrella `Umbrelă #327` (edu) and an ordinary Task `Nu e umbrelă #327` (edu). Assertions (plan them exactly; expect ≈ 60):

```sql
-- authority matrix: one lives_ok / throws_ok per persona × origin
select pg_temp.test_login('32700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role','bce','member_level',5,'dept_ids','["edu"]'::jsonb,'team_ids','[]'::jsonb));
select lives_ok($$ select public.create_task('Dept task #327', 'd', now() + interval '7 days',
  'edu', null, null, 'local', 'direct') $$, 'local BCE creates a Department task');
select throws_ok($$ select public.create_task('Foreign #327', 'd', now() + interval '7 days',
  'pr', null, null, 'local', 'direct') $$, '42501', 'task_manage_forbidden',
  'a BCE of another Department cannot create there');
-- ... ordinary member → 42501 on every origin; Independent-Team member → lives_ok on t-327-ind, 42501 on edu;
-- Project lead and Responsible → lives_ok on the Project; plain Project member → 42501;
-- deactivated BC with stale level-6 claims → 42501 task_command_forbidden; claimless → 42501; anon → 42501.

-- direct + executor
select lives_ok($$ select public.create_task('Direct #327', 'd', now() + interval '7 days',
  'edu', null, null, 'local', 'direct', '32700000-0000-0000-0000-000000000009') $$,
  'any active member may be the direct Executor, even outside the Origin');
select is((select count(*) from public.task_assignments a join public.tasks t on t.id = a.task_id
  where t.title = 'Direct #327' and a.ended_at is null and a.member_id = '32700000-0000-0000-0000-000000000009'),
  1::bigint, 'the direct Executor holds the one active Assignment');
select throws_ok($$ select public.create_task('Bad exec #327', 'd', now() + interval '7 days',
  'edu', null, null, 'local', 'direct', '32700000-0000-0000-0000-000000000010') $$,
  'PT400', 'invalid_executor', 'an inactive Executor is rejected');
-- activity rows for 'Direct #327': created (assignment_id null, to_status todo) and executor_assigned (assignment_id set, details.via = 'create')
-- notification: exactly the Executor, title 'Task nou: Direct #327'; the creator got none

-- public
-- lives_ok public/local without executor; is(queue_opened_at is not null); throws PT400 executor_not_allowed_for_public with one

-- subtask
-- lives_ok with p_parent_task_id = Umbrelă, origin params null → inherits edu; throws PT409 parent_not_umbrella for 'Nu e umbrelă';
-- throws PT400 subtask_origin_mismatch when p_dept_id = 'pr' with the edu Umbrella

-- campaign
-- throws PT400 invalid_campaign when the pr Campaign is used on an edu task (the #314 trigger raises; the command maps 23514 → PT400 only for this one constraint, see Step 3)

-- umbrella
-- lives_ok p_kind = 'umbrella' with audience/mode null; throws PT400 umbrella_has_no_mode when audience given

-- lock probe: create_task holds the actor's profile row For Share and, for a BCE, their member_departments row For Share (pgrowlocks from a held dblink session)
-- direct-write denial: BCE insert into task_assignments → 42501
```

Run it: `npx supabase db reset && npx supabase test db` → the new file fails with `function public.create_task(...) does not exist`. Record the RED line.

- [ ] **Step 3: Write the migration** `npx supabase migration new task_command_kit_and_create_task`, header `-- #327: create_task — the only way a Task is created — plus the authority kit every Task command reuses.` Contents, in this order:

```sql
-- ==================== Predicate: who may evaluate ====================
create function private.can_evaluate_task(p_task_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select coalesce(public.auth_is_member(), false)
       and exists (
         select 1
           from public.profiles as actor
           join public.roles as actor_role on actor_role.id = actor.role
          where actor.id = (select auth.uid())
            and actor.status = 'activ'
            and (
              actor_role.level >= 6
              or (task.dept_id is not null and actor.role = 'bce' and exists (
                    select 1 from public.member_departments as m
                     where m.member_id = actor.id and m.dept_id = task.dept_id))
              or (task.team_id is not null and actor.role = 'bce' and exists (
                    select 1 from public.teams as team
                    join public.member_departments as m on m.dept_id = team.dept_id
                   where team.id = task.team_id and team.dept_id is not null and m.member_id = actor.id))
              -- Independent Team: deliberately no member branch (ADR-0007: BC/Moderator evaluates)
              or (task.project_id is not null
                  and exists (select 1 from public.projects as p
                               where p.id = task.project_id and p.status = 'active')
                  and (
                    private.is_project_lead(task.project_id)
                    or (private.is_project_responsible(task.project_id)
                        and not exists (
                          select 1 from public.task_assignments as a
                           where a.task_id = task.id and a.ended_at is null
                             and (a.member_id = actor.id
                                  or a.member_id = (select p.leader_id from public.projects as p where p.id = task.project_id))))))
            )
       )
      from public.tasks as task
     where task.id = p_task_id
  ), false);
$$;

-- ==================== Gate + visibility ====================
create function private.require_task_visible(p_task_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null
     or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'task_command_forbidden';
  end if;
  if not coalesce(private.can_read_task(p_task_id), false) then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  return v_actor;
end;
$$;

-- ==================== Authority under lock ====================
create function private.require_origin_manager(p_dept_id text, p_team_id text, p_project_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role public.member_role;
  v_level integer;
  v_parent_dept text;
begin
  if v_actor is null
     or not coalesce(private.can_manage_origin(p_dept_id, p_team_id, p_project_id), false) then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end if;

  select profile.role, role.level into v_role, v_level
    from public.profiles as profile join public.roles as role on role.id = profile.role
   where profile.id = v_actor and profile.status = 'activ'
   for share of profile;
  if not found then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end if;
  if v_level >= 6 then
    return v_actor;
  end if;

  if p_dept_id is not null then
    perform 1 from public.member_departments as m
     where m.member_id = v_actor and m.dept_id = p_dept_id for share;
  elsif p_team_id is not null then
    select team.dept_id into v_parent_dept from public.teams as team where team.id = p_team_id;
    if v_parent_dept is not null then
      perform 1 from public.member_departments as m
       where m.member_id = v_actor and m.dept_id = v_parent_dept for share;
    else
      perform 1 from public.team_members as tm
       where tm.member_id = v_actor and tm.team_id = p_team_id for share;
    end if;
  elsif p_project_id is not null then
    if private.is_project_lead(p_project_id) then
      perform 1 from public.projects as project where project.id = p_project_id for share;
    else
      perform 1 from public.project_members as pm
       where pm.project_id = p_project_id and pm.member_id = v_actor and pm.project_role = 'responsible' for share;
    end if;
  end if;
  if not found then
    raise exception using errcode = '42501', message = 'task_manage_forbidden';
  end if;
  return v_actor;
end;
$$;

create function private.require_task_manager(p_task_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
begin
  select * into v_task from public.tasks where id = p_task_id;   -- caller already holds FOR UPDATE
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  return private.require_origin_manager(v_task.dept_id, v_task.team_id, v_task.project_id);
end;
$$;

create function private.require_task_evaluator(p_task_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_task public.tasks%rowtype;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise sqlstate 'PT404' using message = 'task_not_found';
  end if;
  if v_actor is null or not coalesce(private.can_evaluate_task(p_task_id), false) then
    raise exception using errcode = '42501', message = 'task_evaluate_forbidden';
  end if;
  -- same locked re-validation as the manager path (profile + the membership the
  -- authority rests on); Independent Teams reach here only at level >= 6
  perform private.require_origin_manager(v_task.dept_id, v_task.team_id, v_task.project_id);
  return v_actor;
end;
$$;

create function private.require_task_executor(p_task_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_assignment_id bigint;
  v_member uuid;
begin
  perform 1 from public.profiles as p where p.id = v_actor and p.status = 'activ' for share;
  if v_actor is null or not found then
    raise exception using errcode = '42501', message = 'task_executor_forbidden';
  end if;
  select a.id, a.member_id into v_assignment_id, v_member
    from public.task_assignments as a
   where a.task_id = p_task_id and a.ended_at is null
   for update;
  if v_assignment_id is null or v_member is distinct from v_actor then
    raise exception using errcode = '42501', message = 'task_executor_forbidden';
  end if;
  return v_assignment_id;
end;
$$;

-- ==================== Internal writers ====================
create function private.log_task_activity(
  p_task_id bigint, p_kind text, p_actor uuid, p_assignment_id bigint,
  p_from public.task_status, p_to public.task_status, p_note text, p_details jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.task_activity (task_id, kind, actor_id, assignment_id, from_status, to_status, note, details, occurred_at)
  values (p_task_id, p_kind, p_actor, p_assignment_id, p_from, p_to,
          nullif(regexp_replace(coalesce(p_note, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
          coalesce(p_details, '{}'::jsonb), clock_timestamp())
  returning id into v_id;
  return v_id;
end;
$$;

create function private.open_task_assignment(p_task_id bigint, p_member_id uuid, p_actor uuid, p_via text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_title text;
  v_deadline timestamptz;
begin
  if not exists (select 1 from public.profiles as p where p.id = p_member_id and p.status = 'activ') then
    raise sqlstate 'PT400' using message = 'invalid_executor';
  end if;
  insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
  values (p_task_id, p_member_id, p_actor, now())
  returning id into v_id;
  perform private.log_task_activity(p_task_id, 'executor_assigned', p_actor, v_id, null, null, null,
    jsonb_build_object('via', p_via, 'member_id', p_member_id));
  -- 'reopen' (Task 13) reactivates a past Executor and sends its own
  -- "Task redeschis" notification; every other path announces the new Task.
  -- 'first_come' is the member assigning themselves: notify() drops the
  -- actor, so no special case is needed for it.
  if p_via <> 'reopen' then
    select title, deadline into v_title, v_deadline from public.tasks where id = p_task_id;
    perform private.notify(array[p_member_id], 'task'::public.noti_kind,
      'Task nou: ' || v_title,
      'Ți-a fost atribuit acest task. Deadline: ' || coalesce(to_char(v_deadline at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI'), '—') || '.',
      p_task_id, null, p_actor);
  end if;
  return v_id;
end;
$$;

create function private.end_task_assignment(p_assignment_id bigint, p_reason text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.task_assignments
     set ended_at = now(), end_reason = p_reason,
         end_note = nullif(regexp_replace(coalesce(p_note, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '')
   where id = p_assignment_id and ended_at is null;
  if not found then
    raise sqlstate 'PT409' using message = 'assignment_not_active';
  end if;
end;
$$;

create function private.close_task_queue(p_task_id bigint, p_decided_by uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_members uuid[];
begin
  update public.tasks set queue_closed_at = now()
   where id = p_task_id and assignment_mode = 'public' and queue_closed_at is null;
  with closed as (
    update public.task_candidates
       set status = 'closed', decided_at = now(), decided_by = p_decided_by
     where task_id = p_task_id and status = 'pending'
    returning member_id)
  select coalesce(array_agg(member_id), '{}') into v_members from closed;
  return v_members;
end;
$$;
```

Then `private.create_task_impl` (`returns public.tasks`), in the binding step order:

```sql
create function private.create_task_impl(
  p_title text, p_description text, p_deadline timestamptz,
  p_dept_id text, p_team_id text, p_project_id bigint,
  p_audience text, p_assignment_mode text,
  p_executor_id uuid, p_campaign_id bigint, p_parent_task_id bigint, p_kind text)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_parent public.tasks%rowtype;
  v_dept text := p_dept_id; v_team text := p_team_id; v_project bigint := p_project_id;
  v_title text;
  v_task public.tasks%rowtype;
  v_assignment_id bigint;
  v_constraint text;
begin
  -- 1. malformed for everyone
  if p_kind is null or p_kind not in ('task', 'umbrella') then
    raise sqlstate 'PT400' using message = 'invalid_task_kind';
  end if;
  -- 2. gate (no target yet: live activ member)
  if v_actor is null or not coalesce(public.auth_is_member(), false)
     or not exists (select 1 from public.profiles as p where p.id = v_actor and p.status = 'activ') then
    raise exception using errcode = '42501', message = 'task_command_forbidden';
  end if;
  -- subtask: lock the Umbrella first, inherit its origin
  if p_parent_task_id is not null then
    if p_kind = 'umbrella' then
      raise sqlstate 'PT400' using message = 'subtask_cannot_be_umbrella';
    end if;
    if not coalesce(private.can_read_task(p_parent_task_id), false) then
      raise sqlstate 'PT404' using message = 'task_not_found';
    end if;
    select * into v_parent from public.tasks where id = p_parent_task_id for update;
    if v_parent.kind <> 'umbrella' then
      raise sqlstate 'PT409' using message = 'parent_not_umbrella';
    end if;
    if v_parent.status in ('completed', 'unfulfilled', 'cancelled') then
      raise sqlstate 'PT409' using message = 'parent_terminal';
    end if;
    if (v_dept is not null and v_dept is distinct from v_parent.dept_id)
       or (v_team is not null and v_team is distinct from v_parent.team_id)
       or (v_project is not null and v_project is distinct from v_parent.project_id) then
      raise sqlstate 'PT400' using message = 'subtask_origin_mismatch';
    end if;
    v_dept := v_parent.dept_id; v_team := v_parent.team_id; v_project := v_parent.project_id;
  end if;
  -- 3/4. authority on the origin (locks profile + membership row)
  if num_nonnulls(v_dept, v_team, v_project) <> 1 then
    raise sqlstate 'PT400' using message = 'invalid_origin';
  end if;
  perform private.require_origin_manager(v_dept, v_team, v_project);
  -- 5. input
  if p_title is null or p_title !~ '[^[:space:]]' then
    raise sqlstate 'PT400' using message = 'title_required';
  end if;
  v_title := regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if p_kind = 'umbrella' then
    if p_audience is not null or p_assignment_mode is not null or p_executor_id is not null or p_campaign_id is not null then
      raise sqlstate 'PT400' using message = 'umbrella_has_no_mode';
    end if;
  else
    if p_deadline is null then
      raise sqlstate 'PT400' using message = 'deadline_required';
    end if;
    if p_audience is null or p_audience not in ('local', 'org') then
      raise sqlstate 'PT400' using message = 'invalid_audience';
    end if;
    if p_assignment_mode is null or p_assignment_mode not in ('direct', 'public') then
      raise sqlstate 'PT400' using message = 'invalid_assignment_mode';
    end if;
    if p_assignment_mode = 'public' and p_executor_id is not null then
      raise sqlstate 'PT400' using message = 'executor_not_allowed_for_public';
    end if;
  end if;
  -- 7. mutate (the #314 / #315 triggers validate campaign and hierarchy)
  begin
    insert into public.tasks (title, description, deadline, dept_id, team_id, project_id,
                              audience, assignment_mode, campaign_id, parent_task_id, kind,
                              status, created_by, queue_opened_at)
    values (v_title, nullif(regexp_replace(coalesce(p_description, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
            p_deadline, v_dept, v_team, v_project,
            p_audience, p_assignment_mode, p_campaign_id, p_parent_task_id, p_kind,
            'todo', v_actor, case when p_assignment_mode = 'public' then now() end)
    returning * into v_task;
  exception
    when foreign_key_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'tasks_campaign_id_fkey' then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
    when check_violation then
      -- private.validate_task_campaign (20260911210600) raises errcode 23514
      -- with exactly these two reasons; any other 23514 (a shape or
      -- hierarchy constraint) is a caller bug and propagates unchanged.
      if sqlerrm in ('task_campaign_origin_mismatch', 'task_campaign_inactive') then
        raise sqlstate 'PT400' using message = 'invalid_campaign';
      end if;
      raise;
  end;
  perform private.log_task_activity(v_task.id, 'created', v_actor, null, null, 'todo', null,
    jsonb_build_object('kind', p_kind, 'audience', p_audience, 'assignment_mode', p_assignment_mode,
                       'campaign_id', p_campaign_id, 'parent_task_id', p_parent_task_id,
                       'executor_id', p_executor_id));
  if p_executor_id is not null then
    v_assignment_id := private.open_task_assignment(v_task.id, p_executor_id, v_actor, 'create');
  end if;
  select * into v_task from public.tasks where id = v_task.id;
  return v_task;
end;
$$;
```

(The two reason strings are copied from `supabase/migrations/20260911210600_task_campaign.sql:55-87`; do not widen the catch beyond them — a hierarchy or shape violation must propagate as `23514`.)

Then the wrapper, grants, and roster comment:

```sql
create function public.create_task(
  p_title text, p_description text, p_deadline timestamptz,
  p_dept_id text, p_team_id text, p_project_id bigint,
  p_audience text, p_assignment_mode text,
  p_executor_id uuid default null, p_campaign_id bigint default null,
  p_parent_task_id bigint default null, p_kind text default 'task')
returns public.tasks
language sql
security invoker
set search_path = ''
as $$
  select private.create_task_impl(p_title, p_description, p_deadline, p_dept_id, p_team_id, p_project_id,
                                  p_audience, p_assignment_mode, p_executor_id, p_campaign_id, p_parent_task_id, p_kind);
$$;

grant usage on schema private to authenticated;
-- four-role revoke on every function above (11 functions), then:
grant execute on function private.can_evaluate_task(bigint) to authenticated;
grant execute on function private.create_task_impl(text, text, timestamptz, text, text, bigint, text, text, uuid, bigint, bigint, text) to authenticated;
grant execute on function public.create_task(text, text, timestamptz, text, text, bigint, text, text, uuid, bigint, bigint, text) to authenticated;
-- no grant back on require_*, log_task_activity, open_task_assignment, end_task_assignment, close_task_queue
```

Add `comment on function` for each with one sentence of intent.

- [ ] **Step 4: Roster** — add to `tracker_grants.test.sql`'s `pinned_private_functions` (alphabetical): `can_evaluate_task` (`predicate`), `close_task_queue` (`none`), `create_task_impl` (`impl`), `end_task_assignment` (`none`), `log_task_activity` (`none`), `open_task_assignment` (`none`), `require_origin_manager` (`require`), `require_task_evaluator` (`require`), `require_task_executor` (`require`), `require_task_manager` (`require`), `require_task_visible` (`require`); count 50 → 61.

- [ ] **Step 5: GREEN + the full gate** — `npx supabase db reset && npx supabase test db` (all green, `create_task.test.sql` at its exact plan), the nine harnesses, `check-seed-rerunnable.sh`, `db lint`, `gen:types` (diff = the new `create_task` function only), typecheck/lint/test.

- [ ] **Step 6: Commit and PR** — `git add docs/superpowers/plans/2026-09-14-tracker-command-wave.md` (this plan is untracked on `main`; the bottom PR carries it, as Stack C's did) plus the migration, suite, roster and types; `feat(db): create_task and the Task command authority kit (#327)`; push; `gh pr create --base main` (normal PR, not draft), body with `Closes #327`, the rulings above, and the RED/GREEN evidence.

---

### Task 2: #328 — `update_task_content`

**Files:** Create `supabase/migrations/<ts>_update_task_content.sql`, `supabase/tests/update_task_content.test.sql`; modify `tracker_grants.test.sql` (+1 `impl`), `database.types.ts`.

**Interfaces — Consumes:** `require_task_visible`, `require_task_manager`, `log_task_activity`, `notify`. **Produces:** `public.update_task_content(p_task_id bigint, p_title text, p_description text, p_deadline timestamptz, p_campaign_id bigint) returns public.tasks`.

**Rulings:** Parameters are the **new full values**, never patches — an audit trail cannot tolerate "null means keep": `p_title` null/blank → `PT400 title_required`; `p_deadline` null → `PT400 deadline_required` for an ordinary Task; `p_description` and `p_campaign_id` null mean **clear**. The activity row lists only fields whose value actually changed; a call that changes nothing is a `PT409 nothing_to_update`. Umbrellas may have their title/description/deadline edited but never a Campaign (`PT400 umbrella_has_no_campaign`).

- [ ] Branch `stacke/328-update-task-content` from `stacke/327-create-task`.
- [ ] Suite (prefix `32800000-…`): manager edits each field alone and all together → `lives_ok`, `details.changed` equals the exact array of changed names, `details.before`/`details.after` hold only those keys, `note` null; Executor (non-manager) → `42501 task_manage_forbidden`; terminal Task (`completed` fixture with difficulty/rating/completed_at set as owner) → `PT409 task_terminal`; unchanged call → `PT409 nothing_to_update`; Campaign from another Department → `PT400 invalid_campaign`; inactive Campaign → `PT400 invalid_campaign`; Umbrella + campaign → `PT400 umbrella_has_no_campaign`; Executor notified (`Task actualizat: …`, body names the fields), manager-actor not; a Task with no Executor writes no notification; claimless/anon/deactivated denials; lock probe (task `For Update`, profile `For Share`); denial writes no activity.
- [ ] Migration, `_impl` in the binding order; mutation:

```sql
update public.tasks
   set title = v_title, description = v_description, deadline = p_deadline, campaign_id = p_campaign_id
 where id = p_task_id
returning * into v_task;
-- catch the #314 campaign trigger / FK exactly as create_task does → PT400 invalid_campaign
perform private.log_task_activity(p_task_id, 'content_updated', v_actor, null, null, null, null,
  jsonb_build_object('changed', v_changed, 'before', v_before, 'after', v_after));
if v_executor is not null then
  perform private.notify(array[v_executor], 'task', 'Task actualizat: ' || v_task.title,
    'Modificat: ' || array_to_string(v_changed, ', ') || '.', p_task_id, null, v_actor);
end if;
```

where `v_changed text[]` is built by comparing each new value `is distinct from` the locked row's, `v_before`/`v_after` are `jsonb_build_object` over exactly those keys, and `v_executor` is `(select member_id from public.task_assignments where task_id = p_task_id and ended_at is null)`.

- [ ] Roster `+update_task_content_impl` (`impl`); full gate; commit `feat(db): update_task_content with field-level audit (#328)`; draft PR, base `stacke/327-create-task`.

---

### Task 3: #329 — `convert_task_mode`

**Files:** Create migration `convert_task_mode`, `supabase/tests/convert_task_mode.test.sql`; roster +1; types.

**Produces:** `public.convert_task_mode(p_task_id bigint, p_assignment_mode text, p_audience text) returns public.tasks`.

**Rulings:** Immutable after the first Assignment **or Candidature of any status** (a withdrawn candidature is still history — ADR-0007 §Task identity). Direct → public sets `queue_opened_at = now()`, `queue_closed_at = null`; public → direct nulls both (the queue was necessarily empty, since any candidature blocks conversion). Same-values call → `PT409 nothing_to_update`.

- [ ] Branch from Task 2's. Suite (prefix `32900000-…`): fresh direct → public `lives_ok`, `queue_opened_at` set; back to direct, both null; `local` ↔ `org` alone; after `create_task` with an executor → `PT409 task_already_assigned`; after an `express_task_interest`-shaped owner-inserted `withdrawn` candidature → `PT409 task_has_candidates`; terminal → `PT409 task_terminal`; umbrella → `PT409 task_is_umbrella`; invalid values → `PT400 invalid_assignment_mode` / `invalid_audience`; activity `mode_converted` with `details.from = {audience, assignment_mode}`, `details.to = {…}`; no notification (nobody to tell); persona denials; lock probe.
- [ ] Migration: precondition query `exists (select 1 from public.task_assignments where task_id = p_task_id)` → `PT409 task_already_assigned`; `exists (select 1 from public.task_candidates where task_id = p_task_id)` → `PT409 task_has_candidates`; update sets the three columns; log activity.
- [ ] Roster `+convert_task_mode_impl`; gate; commit `feat(db): convert_task_mode before the first Assignment or Candidature (#329)`; draft PR.

---

### Task 4: #330 — `express_task_interest` / `withdraw_task_interest` (the queue race)

**Files:** Create migration `task_interest_commands`, `supabase/tests/task_interest.test.sql`; roster +2 `impl`; types.

**Interfaces — Consumes:** `require_task_visible`, `open_task_assignment`, `log_task_activity`, `notify`, `task_managers`, `pending_candidate_count`. **Produces:** `public.express_task_interest(p_task_id bigint) returns public.tasks`, `public.withdraw_task_interest(p_task_id bigint) returns public.tasks`.

**Rulings:**

- Eligibility (all `PT409`/`42501` as pinned): not `public` → `PT409 task_not_public`; terminal → `PT409 task_terminal`; queue closed (`queue_closed_at not null`) → `PT409 task_queue_closed`; umbrella → `PT409 task_is_umbrella`; the actor is already the active Executor → `PT409 already_executor`; a live `pending` candidature exists → `PT409 already_candidate`. Audience `local` and the actor is not a member of the Origin (Department: `member_departments`; Team: `team_members`; Project: `project_members`) → `42501 task_audience_forbidden`. **Visibility is the outer gate**: a local Task the caller cannot read is `PT404` from `require_task_visible` before any of this (closing the queue hides the Opportunity — `can_read_task` already implements that, so no extra check).
- **The Task row lock is the serialization point.** After `for update`, re-check for an active assignment: none → `open_task_assignment(task, actor, actor, 'first_come')` and notify `task_managers` (`Executor nou: …`); one → insert a `pending` candidature and log `interest_expressed` with `details.position = private.queue_position(task, actor)` (computed after the insert), then notify managers with dedupe `task:{id}:queue`. The second session in the race **blocks** on the lock and, on wake, sees the assignment and queues — never a `unique_violation`.
- Withdraw: the actor's `pending` row → `withdrawn`, `decided_at = now()`, `decided_by = actor`; log `interest_withdrawn`; managers get the updated count under the same dedupe key. No pending row → `PT409 not_a_candidate`. Withdrawing is allowed even after the queue closes? No — a closed queue already moved every pending row to `closed`, so there is nothing to withdraw; `PT409 not_a_candidate` naturally.
- Rejoin after withdrawal is a **new** `pending` row (the partial unique allows it) at the end of the order.

- [ ] Branch from Task 3's. Suite (prefix `33000000-…`), assertions to include:
  - the two-session race: `test_race(express A, express B)` on a fresh public/org Task → `b_waited = true`; exactly one active assignment; exactly one `pending` candidature at `queue_position = 1`; both `result_*` are the Task id (both calls succeed);
  - a third caller queues at position 2; withdraw position 1 → position 2 becomes 1 (`queue_position`); rejoin → new row at the end;
  - local Task + outsider → `42501 task_audience_forbidden`; org Task + outsider → executor; a local Task the outsider cannot read → `PT404 task_not_found`;
  - each `PT409` reason above; deactivated-with-stale-claims → `42501 task_command_forbidden`; claimless; anon;
  - notifications: after first-come, managers got `Executor nou` and the actor nothing; after two joins, **one** manager notification row with `dedupe_key = 'task:<id>:queue'` whose body reads `2 candidați în așteptare.`; after a withdraw, the same row's body reads `1 …`;
  - activity: `executor_assigned` (`assignment_id` set, `via = 'first_come'`), `interest_expressed` (`assignment_id` null, `details.position`), `interest_withdrawn`;
  - direct-write denial: an ordinary member inserting into `task_candidates` → `42501`.
- [ ] Migration: two `_impl`s + wrappers; audience membership check as a single `exists` per origin kind; the manager notification body uses `private.pending_candidate_count(p_task_id)` **after** the insert/update.
- [ ] Roster `+express_task_interest_impl`, `+withdraw_task_interest_impl`; gate; commit `feat(db): express_task_interest and withdraw_task_interest, serialized on the Task row (#330)`; draft PR.

---

### Task 5: #331 — `set_task_queue`

**Files:** Create migration `set_task_queue`, `supabase/tests/set_task_queue.test.sql`; roster +1; types.

**Consumes:** `require_task_visible`, `require_task_manager`, `close_task_queue`, `log_task_activity`, `notify`. **Produces:** `public.set_task_queue(p_task_id bigint, p_open boolean) returns public.tasks`.

**Rulings:** `p_open` null → `PT400 invalid_queue_flag` first. Not public → `PT409 task_not_public`; terminal → `PT409 task_terminal`. Close: `v_closed := private.close_task_queue(p_task_id, v_actor)`, log `queue_closed` with `details.closed_candidates = cardinality(v_closed)`, notify each closed candidate (`Coadă închisă: …`). Open: `queue_closed_at = null`, log `queue_opened`. Same state → `PT409 nothing_to_update` (a manager should not be able to "re-close" to re-notify).

- [ ] Branch from Task 4's. Suite (prefix `33100000-…`): close with two pending → both `closed` with `decided_by = manager`, both notified, actor not; a closed Task rejects `express_task_interest` with `PT409 task_queue_closed`; reopen → `queue_closed_at null`, `queue_opened` row, previously closed candidates stay `closed` (they must rejoin); direct Task → `PT409 task_not_public`; same-state → `PT409 nothing_to_update`; persona denials; lock probe.
- [ ] Roster `+set_task_queue_impl`; gate; commit `feat(db): set_task_queue opens or closes a public queue (#331)`; draft PR.

---

### Task 6: #342 — `assign_task_executor`

**Files:** Create migration `assign_task_executor`, `supabase/tests/assign_task_executor.test.sql`; roster +1; types.

**Consumes:** `require_task_visible`, `require_task_manager`, `open_task_assignment`. **Produces:** `public.assign_task_executor(p_task_id bigint, p_member_id uuid) returns public.tasks`.

**Rulings:** direct only (`PT409 task_not_direct`); terminal → `PT409 task_terminal`; umbrella → `PT409 task_is_umbrella`; an active assignment exists → `PT409 task_already_assigned`; `p_member_id` null or not a live `activ` profile → `PT400 invalid_executor` (from `open_task_assignment`). Any active member regardless of Department or level. `details.via = 'assign'`.

- [ ] Branch from Task 5's. Suite (prefix `34200000-…`): manager assigns an outsider to a direct Task → assignment + `executor_assigned` (`assignment_id`, `via = 'assign'`) + `Task nou` to the new Executor only; public Task → `PT409 task_not_direct`; Task with an Executor → `PT409 task_already_assigned`; inactive member → `PT400 invalid_executor`; a Task whose Executor gave up (owner-ended assignment `end_reason = 'gave_up'`) accepts a new Executor; persona denials incl. Independent-Team member on their own Team's Task → allowed; lock probe.
- [ ] Roster `+assign_task_executor_impl`; gate; commit `feat(db): assign_task_executor for a direct Task without one (#342)`; draft PR.

---

### Task 7: #332 — `give_up_task` (race with interest)

**Files:** Create migration `give_up_task`, `supabase/tests/give_up_task.test.sql`; roster +1; types.

**Consumes:** `require_task_visible`, `require_task_executor`, `end_task_assignment`, `open_task_assignment`, `log_task_activity`, `notify`, `task_managers`. **Produces:** `public.give_up_task(p_task_id bigint, p_reason text) returns public.tasks`.

**Rulings:** reason blank → `PT400 reason_required` (checked before the gate — malformed for everyone). Status must be `todo` or `in_progress` (`PT409 task_not_in_progress`; `in_review` is the ADR's blocked case). Order: lock task → `v_assignment_id := require_task_executor` (locks the assignment `for update`) → `end_task_assignment(v_assignment_id, 'gave_up', reason)` → log `gave_up` (`assignment_id = v_assignment_id`, `note = reason`, `details.reason`) → **promotion**: the oldest `pending` candidate by `joined_at, id`, locked with a plain `for update` (the Task row lock already serializes every writer of this Task's candidates, so `skip locked` would only hide a bug) → `open_task_assignment(task, candidate.member_id, actor, 'queue_promotion')`, candidate → `selected` with `decided_at = now()`, `decided_by = actor` (the giver-upper is the actor of record), `assignment_id` = the new one, log `candidate_selected` (`assignment_id` new, `details.candidate_id`, `details.promoted = true`); then notify `task_managers` (`Renunțare: …`). **Status stays as is** (`in_progress` remains `in_progress` for the promoted Executor — `started_at` already set; a `todo` Task stays `todo`). A direct Task simply ends without an Executor.

- [ ] Branch from Task 6's. Suite (prefix `33200000-…`), including:
  - `in_review` → `PT409 task_not_in_progress`; blank reason → `PT400 reason_required`; a manager who is not the Executor → `42501 task_executor_forbidden`; a past Executor → `42501`;
  - public Task with two pending: give up → candidate 1 promoted (`selected`, `assignment_id` set), candidate 2 still `pending` at position 1; manager notified `Renunțare`; promoted member notified `Task nou`; actor got nothing;
  - **race:** Executor gives up (A) while an outsider expresses interest (B) on a public/org Task with an empty queue → `b_waited = true`; end state exactly one active assignment; if A commits first, B becomes Executor directly (first-come); the suite asserts the invariant (`count(*) where ended_at is null = 1`) and that the union of outcomes is one success each;
  - direct Task give-up → no active assignment, `assign_task_executor` then succeeds;
  - activity shape; direct-write denial (Executor updating `task_assignments.ended_at` → `42501`).
- [ ] Roster `+give_up_task_impl`; gate; commit `feat(db): give_up_task with a required reason and atomic queue promotion (#332)`; draft PR.

---

### Task 8: #333 — `select_task_candidate` (race with withdraw)

**Files:** Create migration `select_task_candidate`, `supabase/tests/select_task_candidate.test.sql`; roster +1; types.

**Consumes:** `require_task_visible`, `require_task_manager`, `end_task_assignment`, `open_task_assignment`, `close_task_queue`, `log_task_activity`, `notify`. **Produces:** `public.select_task_candidate(p_task_id bigint, p_candidate_id bigint, p_close_remaining boolean) returns public.tasks`.

**Rulings:** `p_close_remaining` null → `PT400 invalid_close_flag` first; `p_candidate_id` must be a `task_candidates.id` **on this Task** with `status = 'pending'`, locked `for update` after the Task lock — else `PT409 candidate_not_pending` (never disclose whether the id exists on another Task: same reason for "not on this task"). Terminal → `PT409 task_terminal`; `in_review` → `PT409 task_in_review` (the ADR blocks replacement mid-review). If an active assignment exists → `end_task_assignment(it, 'replaced', null)` and notify the replaced Executor (`Înlocuit: …`); then `open_task_assignment(task, candidate.member_id, actor, 'select')`; candidate → `selected` (`decided_at`, `decided_by = actor`, `assignment_id`); if `p_close_remaining` → `close_task_queue(task, actor)` and notify the closed ones; log `candidate_selected` (`assignment_id` new, `details = {candidate_id, replaced_assignment_id, closed_remaining, closed_candidates}`). Status unchanged.

- [ ] Branch from Task 7's. Suite (prefix `33300000-…`): select into an empty Executor slot; replace an Executor (old row `replaced`, notified); `p_close_remaining = true` closes the rest and notifies them, `false` leaves them pending; non-candidate id / a `withdrawn` one / a candidate of another Task → `PT409 candidate_not_pending`; `in_review` → `PT409 task_in_review`; **race:** manager selects candidate X (A) while X withdraws (B) → `b_waited = true`, exactly one of {selected+assignment, withdrawn+`PT409 candidate_not_pending`} and the suite asserts whichever happened is internally consistent (a `selected` row has an assignment; a `withdrawn` row has none and no assignment was created); persona denials; direct-write denial.
- [ ] Roster `+select_task_candidate_impl`; gate; commit `feat(db): select_task_candidate and decide the remaining queue (#333)`; draft PR.

---

### Task 9: #334 — `start_task` and `submit_task_for_review`

**Files:** Create migration `task_progress_commands`, `supabase/tests/task_progress_commands.test.sql`; roster +2; types.

**Consumes:** `require_task_visible`, `require_task_executor`, `log_task_activity`, `notify`, `task_managers`. **Produces:** `public.start_task(p_task_id bigint) returns public.tasks`, `public.submit_task_for_review(p_task_id bigint) returns public.tasks`.

**Rulings:** `start_task`: `todo` → `in_progress`, `started_at = now()` (`PT409 task_not_todo` otherwise); log `started` (`assignment_id`, `todo → in_progress`); no notification. `submit_task_for_review`: `in_progress` → `in_review`, `submitted_at = now()` (`PT409 task_not_in_progress`); log `submitted`; notify `task_managers` (`De verificat: …`). A resubmission after a return sets `submitted_at` again and leaves `review_round`/`returned_to_progress_at` untouched. Managers cannot start on someone's behalf (`42501 task_executor_forbidden`).

- [ ] Branch from Task 8's. Suite (prefix `33400000-…`): Executor starts (timestamps agree, activity), manager cannot; submit → managers notified, actor not; wrong states; a returned Task (owner-set `review_round = 1`, `returned_to_progress_at`) resubmits and `review_round` stays 1; deactivated Executor with stale claims → `42501`; lock probe.
- [ ] Roster `+start_task_impl`, `+submit_task_for_review_impl`; gate; commit `feat(db): start_task and submit_task_for_review for the active Executor (#334)`; draft PR.

---

### Task 10: #335 — `return_task_to_progress`

**Files:** Create migration `return_task_to_progress`, `supabase/tests/return_task_to_progress.test.sql`; roster +1; types.

**Consumes:** `require_task_visible`, `require_task_evaluator`, `log_task_activity`, `notify`. **Produces:** `public.return_task_to_progress(p_task_id bigint, p_note text) returns public.tasks`.

**Rulings:** note blank → `PT400 note_required` first. `in_review` only (`PT409 task_not_in_review`). Update `status = 'in_progress'`, `review_round = review_round + 1`, `returned_to_progress_at = now()`, `submitted_at = null`. Log `returned_to_progress` (`assignment_id` = the active one, `in_review → in_progress`, `note`, `details.review_round`). Notify the Executor (`Feedback de implementat: …`, body = note). Authority is **evaluator** (a Responsible cannot return the lead's work; an Independent-Team member cannot return anything).

- [ ] Branch from Task 9's. Suite (prefix `33500000-…`): first return → `review_round = 1`; resubmit (via `submit_task_for_review`) and second return → 2, `submitted_at` null again; `PT409` on `in_progress`; Responsible returning the lead's Task → `42501 task_evaluate_forbidden`; Responsible returning their own → `42501`; lead returns own → allowed; Independent-Team member → `42501`; BC → allowed; Executor notified with the note; lock probe.
- [ ] Roster `+return_task_to_progress_impl`; gate; commit `feat(db): return_task_to_progress with the review-round marker (#335)`; draft PR.

---

### Task 11: #336 — `private.evaluate_task` core and `complete_task_review`

**Files:** Create migration `evaluate_task_and_complete_review`, `supabase/tests/complete_task_review.test.sql`; roster +2 (`evaluate_task` → `none`, `complete_task_review_impl` → `impl`); types.

**Interfaces — Consumes:** `require_task_visible`, `require_task_evaluator`, `end_task_assignment`, `close_task_queue`, `log_task_activity`, `notify`, `task_managers`, `public.rating_mult`. **Produces (Tasks 12, 13, 17 consume):**

```text
private.evaluate_task(p_task_id bigint, p_outcome text, p_difficulty integer, p_rating integer,
                      p_note text, p_actor uuid) returns bigint    -- the task_evaluations.id
public.complete_task_review(p_task_id bigint, p_difficulty integer, p_rating integer, p_note text) returns public.tasks
```

**Rulings:**

- `evaluate_task` is the single place points are computed and written. It assumes the caller holds the Task row lock and has authorized. It: validates `p_outcome in ('completed','unfulfilled')`, `p_difficulty`/`p_rating` in 1..5 (`PT400 invalid_difficulty` / `invalid_rating`), note non-blank (`PT400 evaluation_note_required`); locks the active assignment `for update` (`PT409 task_has_no_executor` if none); computes `v_points := p_difficulty * public.rating_mult(p_rating)`; inserts `task_evaluations (task_id, assignment_id, source 'command', evaluated_by p_actor, outcome, difficulty, rating, points, note)`; inserts `points_ledger (member_id = executor, delta = v_points, reason 'task', task_id, evaluation_id)`; updates `tasks` (`difficulty`, `rating`, `status = p_outcome`, `completed_at = now()` or `unfulfilled_at = now()`); `end_task_assignment(assignment, case p_outcome when 'completed' then 'completed' else 'failed' end, null)`; `v_closed := close_task_queue(task, null)` (automatic close: `decided_by` null) and notifies the closed candidates; logs `evaluated` or `unfulfilled` (`assignment_id`, `from → to`, `note`, `details = {evaluation_id, difficulty, rating, points}`); notifies the Executor (`Task evaluat` / `Task nerealizat`); **if `parent_task_id` is set**: logs `subtask_completed` on the **Umbrella** (`actor`, `assignment_id` null, `details = {subtask_id, outcome, terminal_count, subtask_count}`) and notifies `task_managers(parent, actor)` with dedupe `task:{parent}:subtasks` — **without locking the parent row** (Global Constraints lock order; the dedupe upsert makes concurrent sibling completions coalesce).
- `complete_task_review`: evaluator authority; `kind = 'task'` (`PT409 task_is_umbrella`); `status = 'in_review'` (`PT409 task_not_in_review`); then `evaluate_task(…, 'completed', …)`. `completed_at > deadline` is simply queryable (no column).
- A zero or negative `points` value is written as is (rating 1 or 2 on a completed Task is legal per the guide).

- [ ] Branch from Task 10's. Suite (prefix `33600000-…`), including:
  - happy path: exactly one `task_evaluations` row (`source command`, `points = d * mult`), exactly one `points_ledger` row for the Executor with that `evaluation_id`, `my_points`/the ledger sum reflects it, a **past** Executor (owner-ended `replaced` assignment on the same Task) has no row; assignment ended `completed`, `ended_at = completed_at`; `queue_closed_at` set on a public Task and pending candidates `closed` + notified;
  - `PT400` on each missing/invalid input incl. blank note; `PT409 task_not_in_review`, `task_is_umbrella`;
  - authority: Responsible evaluating the lead → `42501 task_evaluate_forbidden`; Responsible evaluating themselves → `42501`; lead evaluating own → allowed; Independent-Team member → `42501`; BC → allowed; local BCE on a Department-Team Task → allowed; foreign BCE → `42501`;
  - a Subtask completion writes `subtask_completed` on the Umbrella with `terminal_count`/`subtask_count`, and one manager notification with `dedupe_key = 'task:<umbrella>:subtasks'`; a second Subtask completion **updates** that same row (still one row, body `2 din 3 …`);
  - `completed_at > deadline` for an overdue fixture is true;
  - direct-write denial: an evaluator inserting into `task_evaluations` / `points_ledger` → `42501`;
  - lock probe (task `For Update`, assignment `For Update`).
- [ ] Roster `+evaluate_task` (`none`), `+complete_task_review_impl` (`impl`); gate; commit `feat(db): complete_task_review over the shared evaluate_task core (#336)`; draft PR.

---

### Task 12: #337 — `mark_task_unfulfilled`

**Files:** Create migration `mark_task_unfulfilled`, `supabase/tests/mark_task_unfulfilled.test.sql`; roster +1; types.

**Consumes:** `require_task_visible`, `require_task_evaluator`, `evaluate_task`. **Produces:** `public.mark_task_unfulfilled(p_task_id bigint, p_difficulty integer, p_rating integer, p_note text) returns public.tasks`.

**Rulings:** preconditions after authority: `kind = 'task'` (`PT409 task_is_umbrella`); status in `todo`/`in_progress`/`in_review` (`PT409 task_terminal`); `deadline < now()` (`PT409 task_not_overdue`); an active Executor exists (`PT409 task_has_no_executor` — a queued public Task nobody took cannot be "unfulfilled" by a person; the manager cancels it instead). Then `evaluate_task(…, 'unfulfilled', …)`.

- [ ] Branch from Task 11's. Suite (prefix `33700000-…`): overdue `in_progress` with rating 1 → ledger `delta = -difficulty`; rating 2 → `delta = 0`; assignment ended `failed`, `unfulfilled_at` set, `ended_at = unfulfilled_at`; not yet overdue → `PT409 task_not_overdue`; no Executor → `PT409 task_has_no_executor`; afterwards `express_task_interest` → `PT409 task_terminal`; activity `unfulfilled`; Executor notified `Task nerealizat`; authority matrix as Task 11; lock probe.
- [ ] Roster `+mark_task_unfulfilled_impl`; gate; commit `feat(db): mark_task_unfulfilled for overdue, undelivered work (#337)`; draft PR.

---

### Task 13: #338 — `reopen_task`

**Files:** Create migration `reopen_task`, `supabase/tests/reopen_task.test.sql`; roster +1; types.

**Consumes:** `require_task_visible`, `require_task_evaluator`, `log_task_activity`, `notify`. **Produces:** `public.reopen_task(p_task_id bigint, p_reason text) returns public.tasks`.

**Rulings:**

- reason blank → `PT400 reason_required` first. Status `completed`/`unfulfilled` (`PT409 task_not_evaluated`); umbrella → `PT409 task_is_umbrella` (an Umbrella has no Evaluation; Task 15 defines its completion as a rollup).
- **Lock order:** if `parent_task_id` is set, lock the **Umbrella** `for update` first, then the Task. If the Umbrella is `completed`, reopening the Subtask flips the Umbrella back to `todo` (`completed_at = null`) and logs `reopened` on the Umbrella too (`details.cascade_from = subtask id`) — a completed Umbrella with a live Subtask would violate ADR-0007's rollup rule.
- The open Evaluation: `select … from public.task_evaluations where task_id = p_task_id and reversed_at is null and source = 'command' for update` (`PT409 evaluation_not_found` if none — a legacy-only evaluated Task has nothing to reverse; say so in the header). Update it with `reversed_at = now(), reversed_by = actor, reversal_reason = reason` (the guard trigger permits exactly this). Insert `points_ledger (member_id = the evaluated assignment's member, delta = -evaluation.points, reason 'task_reversal', task_id, evaluation_id)`.
- Reactivate: **a new** `task_assignments` row for the same member via `open_task_assignment(task, member, actor, 'reopen')` — Task 1's helper already skips its `Task nou` notification for `p_via = 'reopen'`, because this command sends `Task redeschis` itself. Update `tasks`: `status = 'in_progress'`, `difficulty = null`, `rating = null`, `completed_at = null`, `unfulfilled_at = null`, `submitted_at = null`; `started_at` is set to `coalesce(started_at, now())` (an `unfulfilled` Task may have been `todo`); `review_round`/`returned_to_progress_at` untouched; **the queue stays closed** (a manager reopens it with `set_task_queue` if wanted). Log `reopened` (`assignment_id` new, `completed|unfulfilled → in_progress`, `note = reason`, `details = {evaluation_id, reversal_ledger_id, new_assignment_id}`). Notify the Executor (`Task redeschis: …`).

- [ ] Branch from Task 12's. Suite (prefix `33800000-…`): reopen a completed Task → member total back to the pre-evaluation value, both ledger rows present (`task` and `task_reversal`, same `evaluation_id`), evaluation reversed with reason, old assignment still `completed`, new active assignment for the same member, status `in_progress`, `rating/difficulty/completed_at/submitted_at` null; re-evaluate via `submit_task_for_review` + `complete_task_review` → a second Evaluation and a new `task` ledger row, first stays reversed; reopen an `unfulfilled` Task that was `todo` → `started_at` set; blank reason → `PT400`; `in_progress` → `PT409 task_not_evaluated`; reopen a Subtask under a completed Umbrella → Umbrella back to `todo` with its own `reopened` row; authority as Task 11; lock probe proving the Umbrella row is `For Update` during a Subtask reopen; direct-write denial (updating `task_evaluations.reversed_at` as an evaluator → `42501`).
- [ ] Roster `+reopen_task_impl`; gate; commit `feat(db): reopen_task with an atomic ledger reversal (#338)`; draft PR.

---

### Task 14: #339 — `cancel_task` (+ `tasks.cancel_reason`, view recreation)

**Files:** Create migration `cancel_task`, `supabase/tests/cancel_task.test.sql`; extend `supabase/tests/tasks_lifecycle_timestamps.test.sql` with the new `tasks_cancel_reason_ck` (one `throws_ok` for a cancelled row without a reason, one for a reason on a non-cancelled row); roster +1; types (new column, view).

**Consumes:** `require_task_visible`, `require_task_manager`, `end_task_assignment`, `close_task_queue`, `log_task_activity`, `notify`. **Produces:** `tasks.cancel_reason text`; `public.cancel_task(p_task_id bigint, p_reason text) returns public.tasks`.

**Rulings:**

- Column: `alter table public.tasks add column cancel_reason text;` then **backfill** `update public.tasks set cancel_reason = 'Anulat înainte de înregistrarea motivelor (#339).' where status = 'cancelled' and cancel_reason is null;` (staging holds seeded cancelled rows), then `add constraint tasks_cancel_reason_ck check ((status = 'cancelled') = (cancel_reason is not null) and (cancel_reason is null or cancel_reason ~ '[^[:space:]]'))`. Recreate `public.tasks_with_overdue` with the column (see "Verified facts").
- reason blank → `PT400 reason_required` first. Terminal → `PT409 task_terminal`. Manager authority (Independent-Team members may cancel their Team's Tasks).
- For the Task itself: `status = 'cancelled'`, `cancelled_at = now()`, `cancel_reason`; active assignment → `end_task_assignment(it, 'cancelled', reason)`; `close_task_queue(task, actor)` and notify the closed candidates; log `cancelled` (`assignment_id` null, `from → cancelled`, `note = reason`); notify the Executor (`Task anulat`).
- **Umbrella cascade:** the Umbrella row is already locked first; then `select id from public.tasks where parent_task_id = p_task_id and status not in ('completed','unfulfilled','cancelled') order by id for update` and apply the same steps to each Subtask with `details.cascade_from = umbrella id`, notifying each Subtask's Executor and closed candidates. Already-terminal Subtasks are untouched. **A Subtask cancelled on its own** writes `subtask_completed` on its Umbrella (`outcome = 'cancelled'`) and notifies the Umbrella's managers under the `task:{umbrella}:subtasks` key (no parent lock).
- History rows are never deleted or edited (only `tasks`, `task_assignments.ended_*`, `task_candidates.status/decided_*` change).

- [ ] Branch from Task 13's. Suite (prefix `33900000-…`): cancel an `in_progress` public Task with two pending → assignment `cancelled` with `end_note = reason`, candidates `closed`, Executor + both candidates notified, `queue_closed_at` set; history counts before/after equal (`task_activity` grew by exactly the pinned rows, `task_assignments`/`task_candidates`/`task_evaluations` counts unchanged); Umbrella with one `completed` and two open Subtasks → the two cancelled with the same `cancel_reason` and `cascade_from`, the completed one untouched, three `cancelled` activity rows; the new constraint: owner insert `status = 'cancelled'` without reason → `23514 tasks_cancel_reason_ck`; `tasks_with_overdue` exposes `cancel_reason`; blank reason `PT400`; terminal `PT409`; persona denials; lock probe proving the Umbrella and one Subtask are both `For Update` mid-cascade.
- [ ] Roster `+cancel_task_impl`; gate (types diff = `cancel_reason` on `tasks` and `tasks_with_overdue` + the function); commit `feat(db): cancel_task with a recorded reason and Umbrella cascade (#339)`; draft PR.

---

### Task 15: #340 — `complete_umbrella_task`

**Files:** Create migration `complete_umbrella_task`, `supabase/tests/complete_umbrella_task.test.sql`; roster +1; types.

**Consumes:** `require_task_visible`, `require_task_manager`, `log_task_activity`, `notify`, `task_managers`. **Produces:** `public.complete_umbrella_task(p_task_id bigint) returns public.tasks`.

**Rulings:** `kind = 'umbrella'` (`PT409 task_not_umbrella`); status not terminal (`PT409 task_terminal`); zero Subtasks → `PT409 umbrella_has_no_subtasks`; lock the Subtasks `for share` (`select id, status from public.tasks where parent_task_id = p_task_id for share`) and any non-terminal one → `PT409 subtasks_not_terminal` (with `detail` = the count, via `using message = …, detail = …`). Set `status = 'completed'`, `completed_at = now()` (no difficulty/rating — the constraint exempts Umbrellas after Stack C's C1 fix). Log `umbrella_completed` (`todo → completed`, `details.subtask_count`). Notify `task_managers(umbrella, actor)` (`Umbrelă finalizată`) — empty when the actor is the manager, which is the usual case; assert both.

- [ ] Branch from Task 14's. Suite (prefix `34000000-…`): one open Subtask blocks → `PT409 subtasks_not_terminal`; after cancelling it (via `cancel_task`) the Umbrella completes; no `task_evaluations`/`points_ledger` rows created; zero Subtasks → `PT409`; ordinary Task → `PT409 task_not_umbrella`; a completed Umbrella rejects `create_task` of a new Subtask (`PT409 parent_terminal`, Task 1); a Subtask reopened under it flips it back (Task 13, cross-check with one assertion); persona denials; lock probe (Umbrella `For Update`, a Subtask `For Share`).
- [ ] Roster `+complete_umbrella_task_impl`; gate; commit `feat(db): complete_umbrella_task once every Subtask is terminal (#340)`; draft PR.

---

### Task 16: #341 — `duplicate_task` (+ `tasks.duplicated_from_task_id`, view recreation)

**Files:** Create migration `duplicate_task`, `supabase/tests/duplicate_task.test.sql`; roster +1; types (column, view, function).

**Consumes:** `require_task_visible`, `require_task_manager`, `log_task_activity`. **Produces:** `tasks.duplicated_from_task_id bigint references public.tasks(id)`; `public.duplicate_task(p_task_id bigint, p_deadline timestamptz) returns public.tasks`.

**Rulings:** `alter table public.tasks add column duplicated_from_task_id bigint references public.tasks(id);` + `create index tasks_duplicated_from_task_id_idx on public.tasks (duplicated_from_task_id) where duplicated_from_task_id is not null;` + recreate `tasks_with_overdue`. `p_deadline` null → `PT400 deadline_required` first. Source `kind = 'task'` (`PT409 task_is_umbrella`); any status (the ADR's case is an unfulfilled/cancelled source, but a completed one is a legitimate template too). Authority: manager of the **source**. Clone: `title`, `description`, `dept_id/team_id/project_id`, `campaign_id` (**only if that Campaign is still active**, else null — the #314 trigger would reject an inactive one), `audience`, `assignment_mode`, `kind = 'task'`, `status = 'todo'`, `deadline = p_deadline`, `created_by = actor`, `parent_task_id = null` (per the issue: the clone is top-level even when the source was a Subtask — state this in the header), `queue_opened_at = now()` when public, `duplicated_from_task_id = source`. No Executor, difficulty, rating. Log `created` on the clone (`details.duplicated_from_task_id`) and `duplicated` on the source (`details.clone_task_id`). No notification.

- [ ] Branch from Task 15's. Suite (prefix `34100000-…`): clone of a cancelled public Task shares the pinned fields, has `queue_opened_at`, no assignment, `difficulty/rating/parent_task_id` null, `duplicated_from_task_id` = source; clone of a Subtask is top-level; a source with an inactive Campaign clones with `campaign_id null`; Umbrella source → `PT409 task_is_umbrella`; null deadline → `PT400`; both activity rows; `tasks_with_overdue` exposes the column; persona denials; lock probe.
- [ ] Roster `+duplicate_task_impl`; gate; commit `feat(db): duplicate_task into a new todo Task (#341)`; draft PR.

---

### Task 17: #344 — completed-work request commands (approval race)

**Files:** Create migration `completed_work_request_commands`, `supabase/tests/completed_work_request_commands.test.sql`; roster +4 (`require_request_decider` → `require`; three `_impl`); types.

**Consumes:** `open_task_assignment`, `evaluate_task`, `log_task_activity`, `notify` (create's membership test is a plain `exists`, not `require_origin_manager` — a requester is a member of the Origin, not its manager). **Produces:**

```text
private.require_request_decider(p_request_id bigint) returns uuid    -- caller holds the request row lock
public.create_completed_work_request(p_description text, p_dept_id text, p_team_id text, p_project_id bigint) returns public.completed_work_requests
public.approve_completed_work_request(p_request_id bigint, p_difficulty integer, p_rating integer, p_note text) returns public.completed_work_requests
public.reject_completed_work_request(p_request_id bigint, p_note text) returns public.completed_work_requests
```

**Rulings:**

- **Create:** gate (live activ member); exactly one origin (`PT400 invalid_origin`); the requester must be a member of it — Department: `member_departments`; Team (either kind): `team_members`; Project: `project_members` on an **active** Project — else `42501 request_origin_forbidden`; description blank → `PT400 description_required`. Insert `pending`; notify the **deciders** with dedupe `request:{id}` (`Cerere nouă: …`). Deciders per ADR §Completed-work requests (this is **narrower than `task_managers`** — Responsibles do not decide): Department / Department-Team → live local BCE of the (parent) Department; Project → the lead only; Independent Team → nobody local; **plus** every live BC/Moderator in all four cases (they are the named deciders here, not a fallback). The decider query is written **once**, in `create_completed_work_request_impl`, and `require_request_decider` tests the actor with the same predicate expressed as an `exists`; the suite asserts that the notified set equals exactly the set of personas that can approve.
- **`require_request_decider`:** the request row is already locked by the caller; authority = level ≥ 6, or (dept / dept-team origin) local BCE, or (project) `is_project_lead` — **not** Responsible, **not** an Independent-Team member; `42501 request_decide_forbidden`; then the same `for share` locks as `require_origin_manager` (profile; `member_departments` for a BCE; `projects` for a lead).
- **Approve:** `p_difficulty`/`p_rating` malformed → `PT400` first; gate (live activ member); `select * from public.completed_work_requests where id = p_request_id for update`; **visibility**: if the row does not exist, or the actor is neither its requester nor satisfies the decider predicate → `PT404 request_not_found` (hidden and missing look the same); if the actor is the requester but not a decider → `42501 request_decide_forbidden` (they can see their own request; they may not decide it); then `perform private.require_request_decider(p_request_id)` (the `for share` locks); `status = 'pending'` (`PT409 request_not_pending`); then in order: `insert into public.tasks` (title = `left(description, 120)`, description, `deadline = now()`, origin, `audience 'local'`, `assignment_mode 'direct'`, `status 'todo'`, `created_by = actor`) → log `created` on it (`details.from_request_id`); `open_task_assignment(task, requester, actor, 'request_approval')`; `evaluate_task(task, 'completed', p_difficulty, p_rating, p_note, actor)`; update the request `status 'approved'`, `decided_by`, `decided_at = now()`, `decision_note = p_note`, `task_id`; notify the requester (`Cerere aprobată`). The `tasks_lifecycle_timestamp_order_check` needs `completed_at >= created_at` — both are `now()` in one transaction, equal, fine.
- **Reject:** note blank → `PT400 note_required` first; lock; `pending` (`PT409 request_not_pending`); `status 'rejected'`, `decided_*`, `decision_note`; notify the requester (`Cerere respinsă`).
- Double decision is a **stable** `PT409 request_not_pending` from the second session after the first commits (the row lock serializes).

- [ ] Branch from Task 16's. Suite (prefix `34400000-…`): create by a Department member → `pending`, deciders notified once with `dedupe_key = 'request:<id>'`, the notified set equals `{local BCE(s), BC}`; outsider → `42501 request_origin_forbidden`; Project member creates → lead + BC notified, Responsible not; approve → one Task (`direct/local`, `completed`, `created_by = approver`), one assignment for the requester ended `completed`, one Evaluation, one `task` ledger row, requester total up by `d * mult`, request `approved` with `task_id`; **race:** two approvals (A, B) → `b_waited = true`, exactly one Task/Evaluation/ledger row, B's result is `PT409 request_not_pending`; Responsible approving a Project request → `42501 request_decide_forbidden`; Independent-Team member approving their Team's request → `42501`; BC approves an Independent-Team request → allowed; reject requires a note; rejected then approve → `PT409`; requester reading their own request stays possible (`completed_work_requests_read` unchanged); direct-write denials; lock probe (request `For Update`).
- [ ] Roster `+require_request_decider` (`require`), `+create_completed_work_request_impl`, `+approve_completed_work_request_impl`, `+reject_completed_work_request_impl` (`impl`); gate; commit `feat(db): create, approve and reject completed-work requests atomically (#344)`; draft PR.

---

### Task 18: #345 — retire the legacy write paths and `task_requests`

**Files:** Create migration `retire_legacy_task_writes`; modify `supabase/seed.sql`, `scripts/seed-fingerprint.sql`, `supabase/tests/rls_deny_by_default.test.sql`, `supabase/tests/tracker_grants.test.sql`, every other suite that references the dropped objects (grep), `docs/backend/conventions.md` (§2 grandfathered commands, §4 grandfathered revokes, §5 grandfathered policies), `app/src/lib/database.types.ts`.

**Rulings:**

- Migration, in this order: `drop policy tasks_create_legacy on public.tasks; drop policy tasks_update_legacy …; drop policy tasks_delete_legacy …;` `drop policy assignee_manage on public.task_assignees; drop policy assignee_read …;` `drop function public.claim_open_task(bigint);` `drop table public.task_assignees;` `drop policy request_create on public.task_requests; drop policy request_decide …; drop policy request_read …;` `drop table public.task_requests;` `drop type public.request_kind; drop type public.request_status;` then the belt-and-braces `revoke insert, update, delete on table public.tasks, public.task_assignments, public.task_candidates, public.task_activity, public.task_evaluations, public.campaigns, public.completed_work_requests from authenticated;`. Every `drop` is written **without** `cascade`: Postgres refuses to drop a table or type that a view or function still depends on, and that refusal in the RED `db reset` is the discovery mechanism — a dependent found that way is fixed in the same PR (dropped or rewritten explicitly), never cascaded past.
- `#290` already backfilled `task_assignments` from `task_assignees`; the migration header cites it and does not re-copy. A pre-drop `do` block counts `task_assignees` rows that have **no** matching `task_assignments (task_id, member_id)` and raises if any exist (`legacy_assignees_not_backfilled`) — staging safety, the T2/C2 posture.
- `seed.sql`: remove every `task_assignees` insert and its cleanup line, every `task_requests` insert; `scripts/seed-fingerprint.sql`: remove the `assignee:` line (record the new hash in the PR body).
- `rls_deny_by_default.test.sql`: remove the two fixture inserts (the sweep iterates `pg_class`, so nothing else changes) and adjust `plan(N)` only if the file counts per-table assertions. `tracker_grants.test.sql`: remove `task_assignees` and `task_requests` from `task_surface_objects()` and `expected_table_privs`; set `tasks` for `authenticated` to `SELECT`; keep `service_role` as it is today unless the migration changes it; `plan(N)` exact.
- `docs/backend/conventions.md`: drop `claim_open_task` from §2's grandfathered commands and §4's two-role list; drop `task_write`, `request_*`, `assignee_*` from §5's grandfathered policies (note `task_read`/`event_read` are already gone since Stack C — remove them too in the same edit). `git grep -n "task_assignees\|task_requests\|claim_open_task\|request_kind\|request_status\|assignee_manage\|tasks_update_legacy"` across `supabase/ app/ scripts/ docs/` must return only historical migrations and the ledger/plans.
- Frontend: regenerate types (the two tables and two enums vanish); typecheck must stay green (nothing references them). No query edits expected — say so with the grep.

- [ ] Branch from Task 17's. RED: run `npx supabase db reset` with the migration in place **before** the seed/test edits → observe the seed fail on `task_assignees` (proves the seed edit is required), then fix the seed and re-run. Extend `rls_deny_by_default.test.sql` with `hasnt_table('public','task_assignees')`, `hasnt_table('public','task_requests')`, `hasnt_function('public','claim_open_task', array['bigint'])`, and, as a BC with live claims, `throws_ok(insert into tasks …, '42501')`, `throws_ok(update tasks set title …, '42501')`, `throws_ok(delete from tasks …, '42501')` — while `create_task` still works for the same persona in the same suite.
- [ ] Full gate: all suites, harnesses (they may reference `task_assignees` in their scratch fixtures — fix each), `check-seed-rerunnable.sh` (new fingerprint), lint, types (diff = the removals), typecheck.
- [ ] Commit `feat(db): retire the legacy Task write paths, task_assignees and task_requests (#345)`; draft PR whose body lists every dropped object and the new fingerprint.

---

### Task 19: #296 — rebuild the demo seed on the normalized model

**Files:** Modify `supabase/seed.sql` (the `Demo work` section, lines ~274–552 today), `scripts/seed-fingerprint.sql` (add `candidate:`, `activity-count:`, `campaign:` lines; the `task:` line gains `kind`, `assignment_mode`, `audience`), `supabase/tests/demo_seed.test.sql`; possibly `docs/backend/seeding-staging.md` (one paragraph on the scenarios).

**Rulings:**

- The seed inserts rows directly as the table owner and cannot call the commands (no `auth.uid()`); every scenario must therefore satisfy the constraints and triggers by construction, and the suite proves the commands **could** have produced it (e.g. every `completed` Task has exactly one `command` Evaluation, one `task` ledger row, an assignment ended `completed` at `completed_at`).
- Scenario matrix (each row at least once; titles Romanian, deadlines relative to `now()`):

| Scenario                                             | Origin                             | Mode / audience | State                                                             | Extras                                                          |
| ---------------------------------------------------- | ---------------------------------- | --------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| Direct, in progress                                  | Department (edu)                   | direct / local  | `in_progress`                                                     | `started`, `executor_assigned`, `created` activity              |
| Public, open queue, no Executor                      | Department (pr)                    | public / org    | `todo`, `queue_opened_at`                                         | 0 candidates                                                    |
| Public, Executor + 2 pending                         | Department (edu)                   | public / local  | `in_progress`                                                     | `interest_expressed` rows                                       |
| In review, once returned                             | Project                            | direct / local  | `in_review`, `review_round = 1`                                   | `returned_to_progress` + `submitted`                            |
| Completed on time                                    | Department Team (it under diverse) | direct / local  | `completed`                                                       | Evaluation + ledger                                             |
| Completed late                                       | Department (edu)                   | public / local  | `completed`, `completed_at > deadline`                            | queue closed, candidates `closed`                               |
| Unfulfilled                                          | Department (pr)                    | direct / local  | `unfulfilled`, rating 1                                           | negative ledger row, assignment `failed`                        |
| Reopened then re-evaluated                           | Department (edu)                   | direct / local  | `completed`                                                       | reversed Evaluation + `task_reversal` + second Evaluation       |
| Cancelled with reason                                | Independent Team                   | public / org    | `cancelled`, `cancel_reason`                                      | assignment `cancelled`, queue closed                            |
| Umbrella with mixed Subtasks                         | Department (edu)                   | —               | Umbrella `todo`; Subtasks `completed`, `in_progress`, `cancelled` | `subtask_completed` rows on the Umbrella                        |
| Duplicated from the unfulfilled one                  | Department (pr)                    | direct / local  | `todo`, `duplicated_from_task_id`                                 | `duplicated` on the source                                      |
| Campaign-labelled                                    | each of the five real Departments  | mixed           | mixed                                                             | one active Campaign per real Department, at least one Task each |
| Completed-work request approved / pending / rejected | edu / project / independent        | —               | —                                                                 | the approved one's Task links back                              |

- Members: Diverse and Secretariat members exist; `bce@demo.osubb` and `moderator@demo.osubb` are remapped to Department `diverse` and Team `it` (the issue's AC); all eight demo accounts keep their passwords and log in.
- Points must reconcile: for every member, `sum(points_ledger.delta)` equals what `leaderboard`/`member_points` show; every `task`/`task_reversal` row names an Evaluation on that member's own assignment.
- `demo_seed.test.sql` gains one assertion per scenario row above (existence + the invariant named in "Extras"), plus "the eight accounts have the expected roles/departments/teams", plus the reconciliation. `check-seed-rerunnable.sh` passes; record the new fingerprint.

- [ ] Branch from Task 18's. Rewrite the `Demo work` section; keep the cleanup block's order (ledger → evaluations → activity → candidates → assignments → tasks → requests) and the single-transaction header; keep the trigger-disable window to the two cleanup statements.
- [ ] Full gate (this task's `db reset` is the real test — a constraint violation in the seed fails it); `demo_seed.test.sql` green; fingerprint recorded; `docs/backend/seeding-staging.md` updated if the scenario list is documented there.
- [ ] Commit `feat(seed): rebuild the demo data on the normalized Tracker model (#296)`; draft PR.

---

## Verification (whole stack)

- Every PR: CI green on its own base; exactly one `Closes #n`; drafts carry the base/warning lines.
- At the tip: `db reset` clean; `test db` all green; the nine harnesses; `check-seed-rerunnable.sh`; `db lint`; `gen:types` no drift; frontend typecheck/lint/test/build; **and** an integration merge of current `main` into the tip (throwaway worktree, `supabase --workdir …`) that passes the same gate — the Stack C lesson: a retarget does not re-run CI.
- End-to-end smoke (one psql session as owner, then personas via `test_login`, rolled back): create a public Task → two members express interest → the second withdraws and rejoins → manager closes the queue → Executor starts, submits → Reviewer returns with a note → Executor resubmits → Reviewer completes → member total reflects `d × mult` → Reviewer reopens → total back → Reviewer completes again → manager duplicates → Umbrella with two Subtasks, one completed one cancelled → Umbrella completes → a completed-work request is approved. Every step succeeds through the public wrappers only, and `authenticated` cannot write any Task table directly.
- Roster at the tip = 50 + every function this stack adds (≈ 31); `unpinned`/`missing` both `{}`.
- SDD ledger at `.superpowers/sdd/2026-09-14-tracker-command-wave/progress.md`.

## Human actions after merge (Alex)

1. Merge bottom-up as before (each merge retargets the next; wait for the retargeted PR to show base `main`). Task 18 is the point of no return for the legacy paths — merge it only after 1–17 are on `main` and staging deployed them.
2. Refresh `CLAUDE.md`'s **Status** section (docs-only commit on `main`): migrations/assertion counts, "the command set is complete", the frontend as the next lane.
3. Post the drafted items still waiting in `.superpowers/sdd/2026-09-11-tracker-schema-completion/github-drafts.md` (the `profiles` security issue especially; the `assignee_manage` item is closed by Task 18).

## Risks and rulings

- **Issue prose vs schema.** Activity-kind names, the missing `position` column, the required evaluation note, queue-closing on terminal transitions and `submitted_at` nulling on reopen are all schema facts the issue bodies omit or contradict; the plan pins the schema's version. Cost if wrong: none — the schema is merged and tested.
- **`can_evaluate_task` semantics** (Task 1) are the plan's reading of ADR-0007 §Authorization; the per-task reviews check each evaluating command against the ADR lines quoted there. Cost if wrong: one predicate to amend.
- **Lock order** (tasks first; Umbrella before Subtask; `evaluate_task` never locks the parent) is chosen to make sibling Subtask completions deadlock-free at the price of a possibly stale `terminal_count` in one coalesced notification. Cost if wrong: a deadlock the suites' races would surface.
- **Reopen under a completed Umbrella** flips the Umbrella back to `todo` (Task 13) — the ADR does not say; the alternative (refusing) strands a Subtask. Cost if wrong: one command branch.
- **Request deciders exclude Responsibles** (Task 17), per the ADR's explicit list; `task_managers` includes them for _notifications_ on Tasks — the two sets differ on purpose and the suite asserts the decider set.
- **Task 18 is destructive on staging** (drops two tables). The pre-drop backfill assertion and the staging-deploy-after-1–17 ordering are the guards. Cost if wrong: a failed staging deploy that blocks nothing already merged.
- **Roster churn**: ~31 new `private` functions across 18 PRs, each bumping the count — the Stack C failure mode (pinning a function that does not yet exist on that branch) is avoided by each task pinning only what its own migration creates.

## Deferred (next plan)

- **Tracker frontend** #164–#191, #346–#354 (36 issues) — needs `app/` conventions from dobrerares' shadcn/TanStack foundation; blocked on this stack's commands.
- **Leadership/points** #258 (SuperGod25), #259, #260, #262; **notifications** #66, #68.
- **#364** consolidation of the five live "who is the caller" helpers (dobrerares).
