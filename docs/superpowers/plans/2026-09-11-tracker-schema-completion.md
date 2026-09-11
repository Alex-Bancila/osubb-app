# Stack C — Tracker schema completion (2026-09-11)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Task Tracker *schema* layer so the command wave (#327–#345) can start: every table, column, invariant, read policy, index and grant the commands need — built on top of the spine dobrerares' open PRs deliver — plus the five issues that are startable today regardless of his stack.

**Architecture (revised 2026-09-11 on Alex's instruction: "stack them over dobre's, even if they are blocked"):** two stacks, one issue = one branch = one PR each.

- **Stack C — 18 PRs in one line on top of dobrerares' Tasks-spine tip** (branch `batch2/290-legacy-assignment-backfill`, his PR #429, which already contains #283, #285, #286, #313, #371, #284, #287, #288, #293, #289, #290): #161 → #162 → #292 → #312 → #291 → #316 → #314 → #315 → #321 → #343 → #320 → #318 → #319 → #294 → #295 → #317 → #369 → #372 (priority order: clean-ups, then Tracker, then Calendar). The four startable issues (#161, #162, #369, #372) are in this stack rather than on `main` because his spine rewrites `supabase/seed.sql`, `scripts/seed-fingerprint.sql`, `demo_seed.test.sql` and the points/RLS fixtures they also touch — built on top of his, they cannot conflict with it whichever order things merge in. #317 comes after #316 and #162, which it needs.
- **Stack D — 2 PRs on `main`:** #374 part 1 → #374 part 2 (docs only; his spine touches no documentation).

Consequence to accept (Alex's call, house rule 14 overridden explicitly): nothing in Stack C can reach `main` before his spine does, and when he pushes to his branches the stack is updated by merging his branch into Stack C's bottom and cascading merge commits upward — never by rebasing or force-pushing.

**Tech stack:** Supabase CLI 2.117.0 (`npx supabase`), PostgreSQL 15, pgTAP with `supabase/tests/_helpers.sql`, GitHub Actions. Conventions: `docs/backend/conventions.md` (#366) — enforced by `supabase/tests/conventions.test.sql` (#365).

**Spec:** ADR-0007 (amended 2026-09-10) for every Task object; ADR-0008 for #369/#372; the issue bodies; `docs/backend/conventions.md` for shape, names, errors, grants.

## The board on 2026-09-11 (why this batch is what it is)

dobrerares has **24 open PRs, all drafts**, in four stacks. Bottom of each stack targets `main`; each PR above targets the one below. GitHub only computes "closes #n" for PRs whose base is `main`, so the stacked ones show no linked issue until they are retargeted — the body does carry `Closes #n` (checked on #405 and #428).

| Stack | PRs bottom → top | Issues |
|---|---|---|
| Frontend / web foundation (8 deep) | #402 → #405 → #409 → #414 → #417 → #418 → #423 → #425 | #362, #198, #377, #322, #218, #324, #323, #325 |
| Tasks spine (5, then forks) | #404 → #408 → #410 → #411 → #412, then #420 and #421 both on #412, then #424 → #426 → #427 → #428 → #429 on #421 | #283, #285, #286, #313, #371 · #368 · #284 → #287, #288, #293, #289, #290 |
| Projects | #403 → #407 | #311, #281 |
| Standalone | #413, #422 | #65, #375 |

Merge protocol for those (same trap as #391/#392 and #397–#400): merge only a PR whose base reads `main`; **delete the branch on merge** so GitHub retargets the next one (auto-delete is still off in Settings → General); CI does not re-run on retarget — close/reopen the PR or wait for his next push; never squash a stacked PR. The two forks off #412 (#420, #421) both retarget to `main` when `batch/371-…` is deleted.

What his stacks leave **unclaimed** and in the priorities' order (clean → inconsistencies → Tracker backend → Calendar): #161/#162, #374 (clean-ups, startable now); every Tracker schema issue above the spine (#291, #292, #312, #314–#321, #294, #295, #343); #369/#372 (Calendar, startable now). Everything Tracker-frontend (#164–#191, #346–#354) waits for his web foundation stack; nothing there is startable by anyone yet. Skipped on purpose: #66 (its `push_tokens` half is worth doing only once #70 picks the Web Push architecture; its AG-views half belongs to #47/#48), #160/#163 (legacy, low value), #379 (optional rename), #193/#200/#202 (moot once #325 replaces the Ionic shell).

## Global Constraints

- One issue = one branch = one PR, body `Closes #n`, CI green; **never merge, never push to `main`** (house rule 7). Commits end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- **Stacking.** Stack C's first branch is created from `origin/batch2/290-legacy-assignment-backfill`; each later Stack C branch from the previous one. Stack D's first branch from `origin/main`. Every stacked PR's body starts `Base: <branch> — merge after #<n>` and still carries `Closes #<issue>` (GitHub links it once the PR is retargeted to `main`). Branch names: `stackc/<issue>-<slug>`, `stackd/374-<part>`.
- **Migration versions are assigned, not generated.** His spine's versions run up to `20260911106000` and his #420 uses `20260911200000`; a version from `npx supabase migration new` today would sort *before* his and break `db reset` (my FKs to `task_assignments` would run first). Create the file with `migration new`, then rename it to the version in the table below.

| # | Issue | Branch | Base | Migration version |
|---|---|---|---|---|
| 1 | #161 | `stackc/161-ledger-note` | `batch2/290-legacy-assignment-backfill` (his #429) | `20260911210000` |
| 2 | #162 | `stackc/162-ledger-semantics` | `stackc/161-ledger-note` | `20260911210100` |
| 3 | #292 | `stackc/292-task-activity` | `stackc/162-ledger-semantics` | `20260911210200` |
| 4 | #312 | `stackc/312-nullable-difficulty` | `stackc/292-task-activity` | `20260911210300` |
| 5 | #291 | `stackc/291-task-candidates` | `stackc/312-nullable-difficulty` | `20260911210400` |
| 6 | #316 | `stackc/316-task-evaluations` | `stackc/291-task-candidates` | `20260911210500` |
| 7 | #314 | `stackc/314-task-campaign` | `stackc/316-task-evaluations` | `20260911210600` |
| 8 | #315 | `stackc/315-umbrella-tasks` | `stackc/314-task-campaign` | `20260911210700` |
| 9 | #321 | `stackc/321-completed-work-requests` | `stackc/315-umbrella-tasks` | `20260911210800` |
| 10 | #343 | `stackc/343-campaign-commands` | `stackc/321-completed-work-requests` | `20260911210900` |
| 11 | #320 | `stackc/320-notify-helpers` | `stackc/343-campaign-commands` | `20260911211000` |
| 12 | #318 | `stackc/318-task-read` | `stackc/320-notify-helpers` | `20260911211100` |
| 13 | #319 | `stackc/319-history-read` | `stackc/318-task-read` | `20260911211200` |
| 14 | #294 | `stackc/294-tracker-indexes` | `stackc/319-history-read` | `20260911211300` |
| 15 | #295 | `stackc/295-tracker-grants` | `stackc/294-tracker-indexes` | `20260911211400` |
| 16 | #317 | `stackc/317-ledger-evaluations` | `stackc/295-tracker-grants` | `20260911211500` |
| 17 | #369 | `stackc/369-events-schema` | `stackc/317-ledger-evaluations` | `20260911211600` |
| 18 | #372 | `stackc/372-events-min-level` | `stackc/369-events-schema` | `20260911211700` |

This table overrides any branch or base named inside a task section below.
- **What Stack C's base does not contain:** `main`'s last 14 commits (Stack A/B: `docs/backend/conventions.md`, `supabase/tests/conventions.test.sql`, the #215 rename, CLAUDE.md edits) and dobrerares' forks off the spine (#420 `private.set_updated_at()`, #413 notification policies). Follow the conventions doc anyway (read it from `main`: `git show origin/main:docs/backend/conventions.md`); do not edit files that exist only on `main`. The final review runs the whole stack merged with `main` once.
- `docs/backend/conventions.md` is binding: migration header `-- #<issue>: <purpose>`; new vocabularies are `text … check (col in (…))` named `<table>_<what>_ck`; indexes `<table>_<cols>_idx` / `_uidx`; policies `<table>_<verb>[_qualifier]`; every function revokes EXECUTE from `public, anon, authenticated, service_role` and grants back only what must call it (wrappers, `_impl` and policy predicate helpers → `authenticated`; `require_*` and trigger functions → nothing); every `security definer` sets `search_path = ''`; error codes `42501` / `PT400` / `PT404` / `PT409` / `23514` with snake_case messages; every table has `created_at timestamptz not null default now()`; `updated_at` only where rows are edited in place, maintained by `private.set_updated_at()` (#368, arriving in his #420 — not in Stack C's base, so a command that edits `campaigns` sets `updated_at` itself and says so, as the doc allows).
- New tables enable RLS in the creating migration, get a fixture row in `rls_deny_by_default.test.sql` (the sweep refuses hollow tables), `revoke all … from anon`, and — because commands will be their only writers — `revoke insert, update, delete … from authenticated`; `grant select` to `authenticated` only where a read policy exists or is the next task.
- Tests ship in the same PR and must fail without the feature (write them first, run them red). `npx supabase db reset && npx supabase test db` strictly sequential — never two database passes at once (this machine also hosts a peer session; `pg_stat_activity` tells a deadlock from a bug).
- Any schema-shape change regenerates `app/src/lib/database.types.ts` (`cd app && npm run gen:types`); data-only changes must leave it byte-identical.
- `supabase/seed.sql` changes only where a task says so; `scripts/check-seed-rerunnable.sh` must still pass locally.
- **Never edit, push to, or merge into dobrerares' branches.** Stack C builds on his spine; it never changes it.
- GitHub-visible edits beyond the PRs themselves (issue-body changes, comments on his PRs) are drafted in the report and left for Alex.
- **Stack C PRs are opened as drafts** (`gh pr create --draft`). Their base is a dobrerares branch, and a draft cannot be merged into it by accident. The body's first two lines: `Base: <branch> — merge after #<n>.` and `**Do not merge while the base is not main.** Mark ready only after the PR below has merged and this PR's base reads main.` CI runs on drafts.
- **The conventions sweep is not in Stack C's base** — run it by hand before every Stack C commit: `git show origin/main:supabase/tests/conventions.test.sql > supabase/tests/zz_conventions_probe.test.sql && npx supabase test db supabase/tests/zz_conventions_probe.test.sql; rm -f supabase/tests/zz_conventions_probe.test.sql`. It must pass, and `git status --short` must not list the probe file afterwards.
- **`public.tasks_with_overdue` is `select task.*`** (his #426/#427). Postgres expands `*` when a view is created, so a column added to `tasks` later is missing from the view, and a `tasks` column cannot be dropped while the view depends on it. Every task that adds or drops a `tasks` column (#314 `campaign_id`, #315 `kind`/`parent_task_id`, #317 `points`) drops and recreates the view in the same migration with his exact definition, grants (`revoke all … from public, anon, authenticated, service_role; grant select … to authenticated, service_role`) and comment, and asserts the new column is visible through it.

## What Stack C's base contains

Before each Stack C dispatch, `git fetch` and check whether `origin/batch2/290-legacy-assignment-backfill` moved since the previous task; if it did, merge it into Stack C's bottom branch and cascade (merge commits only) before continuing, and ledger it. The spine tip contains these migrations (#420 and #413 are **not** in it):

| His issue | PR | Migration |
|---|---|---|
| #283 deadline `timestamptz` | #404 | `20260911090000_tasks_precise_deadlines.sql` |
| #285 `audience` | #408 | `20260911091000_tasks_audience.sql` |
| #286 `assignment_mode` | #410 | `20260911092000_tasks_assignment_mode.sql` |
| #313 `campaigns` | #411 | `20260911093000_campaigns_schema.sql` |
| #368 `private.set_updated_at()` | #420 | `20260911200000_shared_timestamps.sql` — **not in the base** (fork off #412) |
| #284 `project_id` + origin XOR | #421 | `20260911101000_tasks_exactly_one_origin.sql` |
| #287 six-state `task_status` | #424 | `20260911102000_tasks_six_state_lifecycle.sql` |
| #288 `tasks_with_overdue` | #426 | `20260911103000_tasks_derived_overdue.sql` |
| #293 lifecycle timestamps | #427 | `20260911104000_tasks_lifecycle_timestamps.sql` |
| #289 `task_assignments` | #428 | `20260911105000_task_assignments.sql` |
| #290 legacy backfill | #429 | `20260911106000_backfill_task_assignments.sql` |
| #65 notification policies | #413 | `20260911030000_notification_self_access.sql` — **not in the base** (standalone) |

### Names his PRs introduce (verified from the diffs; re-verify on `main` before use)

- `tasks.deadline timestamptz` (converted in place, legacy dates → 23:59 Bucharest); `tasks.audience text not null default 'local'` (`local`|`org`, constraint `tasks_audience_check`); `tasks.assignment_mode text not null default 'direct'` (`direct`|`public`, `tasks_assignment_mode_check`); `tasks.project_id bigint references projects(id)`, constraint `tasks_exactly_one_origin_check`, index `tasks_project_idx` (legacy rows with both `dept_id` and `team_id` became Team-origin).
- `task_status` enum recreated as `('todo','in_progress','in_review','completed','unfulfilled','cancelled')`; the old type survives as `task_status_legacy`; `claim_open_task` recreated on the new statuses with `private.task_is_unassigned(bigint)`; `task_read` rewritten but still keyed on `auth_level() >= 4`, `auth_in_dept`, `auth_in_team`, `is_assigned(id)` and a `todo + public + org + unassigned` branch — **that is the baseline #318 replaces**.
- `tasks` gains `started_at, submitted_at, completed_at, unfulfilled_at, cancelled_at, queue_opened_at, queue_closed_at, review_round int not null default 0, returned_to_progress_at`, with `tasks_*_state_check` constraints; view `public.tasks_with_overdue` (`is_overdue = deadline < statement_timestamp() and status in ('todo','in_progress','in_review')`).
- `task_assignments(id, task_id, member_id, assigned_at, assigned_by, end_reason ∈ {gave_up, replaced, completed, failed, cancelled, legacy_migration}, ended_at, end_note)`, unique `task_assignments_one_active_per_task_uidx`, RLS enabled, **no policies** (that is #319).
- `campaigns(id, department_id, name, is_active, created_by, created_at, updated_at)` — note **`department_id`**, not `dept_id`; unique `campaigns_department_name_uidx`; policy `campaigns_read`; `campaigns_set_updated_at` trigger from #368.
- `notifications_read_self`, `notifications_mark_read_self`, `notif_suppression_read` policies (#65).

His constraint names (`_check`) do not follow the conventions doc's `_ck`; that is his to change or not — new objects in this plan follow the doc.

---

## Stack C tasks — the startable four (rows 1, 2, 17, 18 of the table)

### Task 1: #161 — `points_ledger.note`

**Files:** Create `supabase/migrations/<ts>_points_ledger_note.sql`; create `supabase/tests/points_ledger_note.test.sql`; regenerate `app/src/lib/database.types.ts`.

- [ ] Branch, base and migration version: row 1 of the Stack C table.
- [ ] RED — new suite (`plan(4)`): `has_column('public','points_ledger','note')`; a `sanction` row inserted as `postgres` with `note = 'întârziere repetată'` reads back; a row without a note still inserts (nullable); the seed member's `my_points`/`member_points` total is unchanged before vs after the insert-and-delete of a zero-delta probe — or simpler, assert `sum(delta)` over the seeded rows equals the value read before the migration in the test's own fixture. Run → fails on the missing column.
- [ ] Migration:
  ```sql
  -- #161: sanctions and reversals carry a written reason beside the immutable
  -- points entry. Nullable here; #162 requires it for sanctions.
  alter table public.points_ledger add column note text;
  comment on column public.points_ledger.note is
    'Human-readable reason for the entry. Required for sanctions (#162); optional otherwise.';
  ```
- [ ] GREEN: `npx supabase db reset && npx supabase test db`; `cd app && npm run gen:types` → `database.types.ts` gains `note` on `points_ledger` (commit it).
- [ ] Commit `feat(db): add points_ledger.note (#161)`; PR → `main`, `Closes #161`.

### Task 2: #162 — ledger reason and delta semantics

**Files:** Create `supabase/migrations/<ts>_points_ledger_reason_semantics.sql`; create `supabase/tests/points_ledger_semantics.test.sql`; modify `supabase/seed.sql` (the sanction row gains a note), `supabase/tests/{rls_tasks_points,points_ledger_read,my_points,points_engine}.test.sql` (sanction fixtures gain notes), `supabase/tests/manual_awards.test.sql` (see ruling). Branch, base and version: row 2 of the Stack C table. Dropping `reject_manual_award` makes `docs/backend/conventions.md` §4's grandfathered-grant note about it stale — that file exists only on `main`, so do not edit it here; list it in the PR body as a follow-up.

- [ ] RED — new suite: accepted/rejected pairs per reason — `task` with `task_id` accepted, `task` without `task_id` rejected (`23514`); `task_reversal` likewise; `sanction` with negative delta and note accepted, `sanction` with positive delta rejected, with blank note rejected, with whitespace-only note rejected, with a `task_id` rejected; `manual_award` rejected (`23514`); any other string rejected. Run → red.
- [ ] Migration:
  ```sql
  -- #162: the ledger vocabulary is task / task_reversal / sanction (manual awards
  -- left with #261). Task rows reference their task; sanctions are negative and
  -- explained. No environment holds manual_award rows (local and staging are
  -- seed-only; production does not exist yet) — the guard below makes a hosted
  -- database that does hold one fail loudly instead of silently constraining
  -- around it.
  do $$ begin
    if exists (select 1 from public.points_ledger where reason = 'manual_award') then
      raise exception 'points_ledger still holds manual_award rows; decide their fate before #162';
    end if;
  end $$;

  alter table public.points_ledger
    add constraint points_ledger_reason_ck
      check (reason in ('task', 'task_reversal', 'sanction')),
    add constraint points_ledger_task_reference_ck
      check ((reason in ('task', 'task_reversal')) = (task_id is not null)),
    add constraint points_ledger_sanction_shape_ck
      check (reason <> 'sanction' or (delta < 0 and btrim(coalesce(note, '')) <> ''));

  comment on column public.points_ledger.reason is
    'task (evaluation), task_reversal (reopen), sanction (BC, negative, with note).';

  -- The #261 trigger only rejected manual_award; the check above covers it.
  drop trigger points_ledger_reject_manual_award on public.points_ledger;
  drop function public.reject_manual_award();
  ```
  Ruling: dropping the #261 trigger is in scope — the constraint makes it dead code, and the conventions doc lists it as a grandfathered grant exception that then disappears. Move `manual_awards.test.sql`'s still-valid assertions (BC cannot insert `manual_award`; error code `23514`) into the new suite and delete the old file; keep its persona fixtures if useful.
- [ ] Seed: the sanction at `supabase/seed.sql:280` gains `note`. Tests: every `insert into points_ledger (… 'sanction' …)` fixture gains a note (grep `'sanction'` under `supabase/tests`).
- [ ] GREEN: full reset + suite; `bash scripts/check-seed-rerunnable.sh` still passes; `database.types.ts` unchanged (constraints only).
- [ ] Commit `feat(db): constrain points_ledger reasons, task references and sanction shape (#162)`; PR `Closes #162`.

### Task 3: #369 — events schema: project scope, Minimum Level, cancellation

**Files:** Create `supabase/migrations/<ts>_events_min_level_project_cancellation.sql`; modify `supabase/tests/event_constraints.test.sql`; regenerate types.

- [ ] Branch, base and migration version: row 17 of the Stack C table.
- [ ] RED — extend `event_constraints.test.sql` (`plan(19)` → count the additions): `min_level` default 0 on an existing seeded event; `min_level = 2` rejected, `3` accepted; `cancelled_at` without `cancel_reason` rejected, with blank reason rejected, with reason accepted; `scope = 'project'` without `project_id` rejected, with `project_id` and null dept/team accepted; `scope = 'dept'` with a `project_id` rejected; `org` with `project_id` rejected.
- [ ] Migration (constraint names per the doc; the existing `events_scope_fields_ck` is dropped and recreated with five branches):
  ```sql
  -- #369: ADR-0008 §Consequences — Project scope, Minimum Level, cancellation state.
  alter table public.events
    add column project_id bigint references public.projects (id),
    add column min_level integer not null default 0,
    add column cancelled_at timestamptz,
    add column cancel_reason text,
    add constraint events_min_level_ck check (min_level in (0, 3, 4, 5, 6)),
    add constraint events_cancel_reason_ck
      check (cancelled_at is null or btrim(coalesce(cancel_reason, '')) <> '');
  alter table public.events drop constraint events_scope_fields_ck;
  alter table public.events add constraint events_scope_fields_ck check (
       (scope = 'org'     and dept_id is null     and team_id is null     and project_id is null)
    or (scope = 'dept'    and dept_id is not null and team_id is null     and project_id is null)
    or (scope = 'team'    and dept_id is not null and team_id is not null and project_id is null)
    or (scope = 'project' and dept_id is null     and team_id is null     and project_id is not null)
  );
  create index events_project_idx on public.events (project_id);
  create index events_starts_min_level_idx on public.events (starts_at, min_level);
  comment on column public.events.min_level is 'ADR-0008 Minimum Level: 0 everyone, 3 AG/Voting Member+, 4 Responsible+, 5 BCE+, 6 BC+.';
  ```
  Keep `team` scope's `dept_id not null` (Department Teams only, as today — Independent-Team events arrive with #370's `create_event` rewrite, which will relax that branch); say so in the header.
- [ ] `create_event` still rejects `project` scope (unchanged; #370). Frontend `EVENT_FIELDS` unchanged. GREEN: reset + suite; regenerate types (shape change) and commit.
- [ ] Commit `feat(db): events gain project scope, Minimum Level and cancellation state (#369)`; PR `Closes #369`.

### Task 4: #372 — `event_read` on Minimum Level; retire `for_recruits`

**Files:** Create `supabase/migrations/<ts>_event_read_min_level.sql`; rewrite `supabase/tests/rls_events.test.sql`; modify `supabase/seed.sql` (teams insert loses `for_recruits`; the AG event gets `min_level = 3`), `supabase/tests/demo_seed.test.sql` (the two `for_recruits` assertions), `scripts/seed-fingerprint.sql` (its `team:` line prints `for_recruits` — replace the column with nothing, keep the line's shape otherwise), regenerate types. Branch, base and version: row 18 of the Stack C table. `docs/agents/onboarding.md:104` (names `team_admits_recruits` as a helper-pattern example) is rewritten by #374 part 2 on `main`; do not edit it here.

- [ ] RED — rewrite `rls_events.test.sql` for the ADR-0008 rule *"every active member reads every event whose Minimum Level they satisfy, regardless of scope"*: fixtures with `min_level` 0/3/4/5/6 across org, dept and team scopes; Recrut (level 0) sees exactly the `min_level = 0` rows — including a foreign department's and a team's he is not in; Voluntar (level 1?) same set — check `roles.level` for each persona; Responsabil (4) sees ≤ 4; BCE (5) ≤ 5; BC (6) all; a stranger (real uid, no claims) and anon see nothing; a member of a former `for_recruits` team gets nothing extra. Keep the file's persona layout.
- [ ] Migration:
  ```sql
  -- #372: ADR-0008 — visibility is Minimum Level, not scope membership or the
  -- recruit-team flag. Relevance (primary vs gray) is a frontend concern.
  drop policy event_read on public.events;
  create policy events_read on public.events
    for select to authenticated
    using (public.auth_is_member() and public.auth_level() >= min_level);
  drop function public.team_admits_recruits(text);
  alter table public.teams drop column for_recruits;
  ```
  (`events_read` follows the doc's `<table>_<verb>` scheme; `event_read` was grandfathered only until rewritten — say so in the header. `docs/backend/conventions.md` §5 still lists `event_read`; that file exists only on `main`, so leave it and name it in the PR body as a follow-up.)
- [ ] Seed: `t-recruti` keeps existing as a plain Department Team (drop the column from the insert; leave the team — demo accounts reference it); `Adunarea Generală de toamnă` gets `min_level = 3` so the demo shows a gated event; `Training pentru recruți` stays `0`. `demo_seed.test.sql:71,206-207` rewritten accordingly (assert one event with `min_level = 3` exists). `grep -n for_recruits scripts/seed-fingerprint.sql supabase/ app/src docs` → only historical specs remain.
- [ ] GREEN: reset + full suite; `bash scripts/check-seed-rerunnable.sh`; regenerate types (column dropped) and commit; `app` typecheck still green (`for_recruits` appears only in the generated types).
- [ ] Commit `feat(db): read events by Minimum Level; retire for_recruits (#372)`; PR `Closes #372` — body names the behaviour change (department events become visible org-wide at level 0, as ADR-0008 intends) and that "ordinary members do not receive past Events" is *not* implemented here (a later Calendar issue).

### Task 5: #374 — docs truth pass (Stack D, two PRs on `main`)

Stack D is independent of Stack C and of his spine. dobrerares' draft #422 (repo-wide Prettier + link check) touches the same documents; whichever lands second re-runs the formatter — say so in both PR bodies. Branches: `stackd/374-indexes-and-banners` from `origin/main`, then `stackd/374-truth-pass` from it.

**PR 5a — indexes, banners, headers** (`stackd/374-indexes-and-banners`, body "Part 1 of #374", no `Closes`; also commits this plan file):
- `docs/README.md`: one table — authoritative (CLAUDE.md, CONTEXT.md, ADR 0001–0008, `docs/backend/*` incl. `conventions.md`, `docs/agents/*`, `docs/team/team-plan.md`) vs historical (`docs/osubb-app-tech-stack.md`, `docs/roadmap.md`, `docs/superpowers/specs/2026-06-2*`, `docs/backend/implementation-issues.md`, `docs/superpowers/specs/frontend-mini-spec.md`, `mockup/`) with one line each on what still holds.
- `docs/adr/README.md`: index 0001–0008 (title, status, date, one-line decision). Apply one header template to all eight ADRs — `Status · Date · Deciders · Supersedes · Superseded by · Related` — without changing any decision text.
- Historical banner (three lines: "Historical — superseded by …; kept for provenance") at the top of the four documents above plus `frontend-mini-spec.md` §7 and `mockup/README.md`.
- `docs/agents/domain.md`: delete the `CONTEXT-MAP.md` sentences (single-context repo).
- Verify: every link in the two new indexes resolves (`for p in $(grep -oE '\]\([^)]+\)' … )`), Prettier clean on the new files.

**PR 5b — rewrites** (`stackd/374-truth-pass`, base `stackd/374-indexes-and-banners`, `Closes #374`):
- `docs/agents/onboarding.md`: replace the tree's counts (`15 pgTAP suites, 266 tests`) with commands (`ls supabase/migrations | wc -l`, `npx supabase test db`), extend the migration tour to the September groups (Projects #268–#274, Teams #276–#280, departments #310, grants #363/#365, Stack A/B), fix the helper-pattern line (no `in_my_dept`, no `team_admits_recruits`), `mockup/` = historical provenance for tokens/logos, `app/` = shadcn target per ADR-0002.
- `README.md`: stack line (browser-first PWA, shadcn — no "Ionic, Capacitor later"), ADR range 0001–0008 → link `docs/adr/README.md`, remove hard dates that have passed, point at `docs/README.md`.
- `app/README.md`: regenerate the file tree; drop "tokens.css is a copy of the mockup".
- `CLAUDE.md` Status block: replace the hard counts (35 migrations / 31 suites / 761 assertions / 9 files / 55 tests) with a dated line plus the commands that print the live numbers; refresh the queue line (his stacks; this plan).
- `docs/team/team-plan.md`: "Ionic/React screens" → "shadcn/React screens (ADR-0002)".
- `CONTEXT.md`: appendix **Term → identifier** (`youth` = Tineret, `pr` = Imagine & PR, `edu` = Educațional; `activ` as Role vs `activ` as Status; `profiles` rows are Members and `member_id` columns reference them; `event_scope` ↔ Origin; `noti_kind` ↔ Notification kind; the five role display names ↔ `roles.id`).
- AC greps from the issue: `git grep -n "0001…0006\|Capacitor later\|UX source"` hits only banner-marked files; a new agent following CLAUDE.md → onboarding meets no contradiction (the reviewer reads that path end to end).

---

## Stack C tasks — the blocked ones (rows 3–16; dispatch in table order)

Each task: branch `stackc/<issue>-<slug>` from the previous Stack C branch, rename the migration to its assigned version (Global Constraints), RED test first, migration, GREEN full suite, regenerate types when the shape changes, add each new table's fixture row to `rls_deny_by_default.test.sql`, commit `feat(db): … (#n)`, push, PR with base = the previous Stack C branch, body starting `Base: <branch> — merge after #<n>` and carrying `Closes #n`. The "gate" after each title names the issues whose content the task needs — all of them are in the base by the time the task runs.

### Task 6: #292 — `task_activity` (append-only timeline) · gate: #287

```sql
create table public.task_activity (
  id            bigint generated always as identity primary key,
  task_id       bigint not null references public.tasks (id),
  kind          text not null constraint task_activity_kind_ck check (kind in (
                  'created','content_updated','mode_converted','queue_opened','queue_closed',
                  'interest_expressed','interest_withdrawn','candidate_selected','executor_assigned',
                  'gave_up','started','submitted','returned_to_progress','evaluated','reopened',
                  'cancelled','duplicated','subtask_completed','unfulfilled')),
  actor_id      uuid references public.profiles (id),        -- null = system (deadline job)
  assignment_id bigint references public.task_assignments (id),
  from_status   public.task_status,
  to_status     public.task_status,
  note          text,
  details       jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index task_activity_task_timeline_idx on public.task_activity (task_id, occurred_at, id);
create index task_activity_actor_idx on public.task_activity (actor_id);
alter table public.task_activity enable row level security;
```
Immutability: `revoke insert, update, delete … from authenticated` **and** a `before update or delete` trigger `private.reject_task_activity_change()` raising `23514 task_activity_immutable` (definer commands must not be able to rewrite history either). Tests `task_activity_schema.test.sql`: shape, kind check, immutability as `postgres` and as `authenticated`, timeline order, claimless sweep. No command writes yet.

### Task 7: #312 — `difficulty` nullable until Evaluation · gate: #287

`alter column difficulty drop not null`; constraint `tasks_evaluation_inputs_ck check (case when status in ('completed','unfulfilled') then difficulty is not null and rating is not null else rating is null end)`. Safe with the legacy `sync_task_ledger` trigger: it only inserts when `rating is not null`, and the constraint then guarantees `difficulty` (so `points`) is not null; a rating cleared on reopen takes the delete branch. Seed: remove `difficulty` from every demo task not `completed`/`unfulfilled`. Tests: the three cases from the issue in `tasks_evaluation_inputs.test.sql`; adjust `points_engine.test.sql` fixtures that graded a task without moving it to `completed` first. Types regenerate (`difficulty` becomes nullable).

### Task 8: #291 — `task_candidates` (ordered queue) · gate: #286, #289

```sql
create table public.task_candidates (
  id            bigint generated always as identity primary key,
  task_id       bigint not null references public.tasks (id),
  member_id     uuid not null references public.profiles (id) on delete cascade,
  status        text not null default 'pending'
                constraint task_candidates_status_ck check (status in ('pending','selected','withdrawn','closed')),
  joined_at     timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references public.profiles (id),
  assignment_id bigint references public.task_assignments (id),
  created_at    timestamptz not null default now(),
  constraint task_candidates_decision_shape_ck check (
       (status = 'pending'  and decided_at is null     and decided_by is null and assignment_id is null)
    or (status = 'withdrawn' and decided_at is not null and assignment_id is null)
    or (status = 'closed'    and decided_at is not null and assignment_id is null)
    or (status = 'selected'  and decided_at is not null and decided_by is not null and assignment_id is not null)),
  constraint task_candidates_chronology_ck check (decided_at is null or decided_at >= joined_at)
);
create unique index task_candidates_one_live_per_member_uidx
  on public.task_candidates (task_id, member_id) where status in ('pending','selected');
create index task_candidates_queue_order_idx
  on public.task_candidates (task_id, joined_at, id) where status = 'pending';
create index task_candidates_member_idx on public.task_candidates (member_id);
```
Queue order is `(joined_at, id)`; a rejoin is a new row (the withdrawn one stays — the partial unique index permits it). "Queue only on public tasks" and "no candidature for the current Executor" are command invariants (#330), not schema — say so in the header. Tests `task_candidates_schema.test.sql`: one live candidature per member, rejoin after withdrawal, decision-shape cases, order determinism, denied client writes, sweep.

### Task 9: #316 — `task_evaluations` · gate: #287, #289

The table exactly as the issue body specifies, plus `created_at`, `reversed_at >= evaluated_at` in the chronology check, and `assignment_id` tied to the same task declaratively: add `constraint task_assignments_id_task_key unique (id, task_id)` on `task_assignments` and reference it with `foreign key (assignment_id, task_id) references public.task_assignments (id, task_id)`. Partial unique `task_evaluations_one_open_per_task_uidx on (task_id) where reversed_at is null`. RLS on; no policies; no client write grants ever. Tests `task_evaluations_schema.test.sql` per the issue's AC.

### Task 10: #314 — `tasks.campaign_id` with origin consistency · gate: #313, #284

Column + `tasks_campaign_idx`. Constraint trigger `private.validate_task_campaign()` (`before insert or update of campaign_id, dept_id, team_id, project_id`): null campaign → ok; otherwise read `campaigns.department_id, is_active`; `project_id is not null` → `23514 task_campaign_origin_mismatch`; `team_id is not null` → the team's `dept_id` must be non-null (Department Team) and equal the campaign's department; else `dept_id` must equal it; and when `campaign_id` is newly set or changed, the campaign must be active (`23514 task_campaign_inactive`) — existing tasks keep a campaign that is later deactivated. Tests for the issue's four cases plus the inactive case. Types regenerate.

### Task 11: #315 — Umbrella Tasks and Subtasks · gate: #284, #285, #286, #287

`kind text not null default 'task'` (`tasks_kind_ck`), `parent_task_id bigint references tasks(id)`, `tasks_parent_idx`. Drop NOT NULL on `audience` and `assignment_mode` (keep their defaults — his tests and the seed rely on them; an umbrella insert must pass explicit nulls, which `create_task` will). Declarative: `tasks_umbrella_shape_ck check (kind = 'task' or (parent_task_id is null and audience is null and assignment_mode is null and difficulty is null and rating is null))` and `tasks_task_shape_ck check (kind = 'umbrella' or (audience is not null and assignment_mode is not null))`. Trigger `private.validate_task_hierarchy()` (`before insert or update of parent_task_id, dept_id, team_id, project_id`): a parent must be `kind = 'umbrella'` with `parent_task_id is null` (`23514 task_parent_not_umbrella` / `task_hierarchy_too_deep`); a subtask's three origin columns equal the parent's on insert and never change afterwards (`23514 subtask_origin_immutable`). Tests per the issue's four AC lines. Types regenerate.

### Task 12: #321 — `completed_work_requests` · gate: #284, #287

Table exactly as the issue body, origin XOR via `num_nonnulls(dept_id, team_id, project_id) = 1`, the three status-shape checks, indexes on `requester_id`, `status`, the three origin columns. **Introduce the shared origin-authority predicate here** so #318, #319 and #320 reuse it: `private.can_manage_origin(p_dept_id text, p_team_id text, p_project_id bigint) returns boolean` — live profile must be `activ`; level ≥ 6 → true; Department origin → caller is `bce` with a `member_departments` row for it; Department-Team origin → same test against the team's parent department; Independent Team → caller is an active `team_members` row; Project → `private.can_manage_project_work(p_project_id)`. Grant to `authenticated` (policy predicate helper). Read policy `completed_work_requests_read`: `auth_is_member() and (requester_id = auth.uid() or private.can_manage_origin(dept_id, team_id, project_id))`. Tests: the issue's read matrix and constraint cases.

### Task 13: #343 — Campaign commands · gate: #313, #368

Per the conventions doc: `public.create_campaign(p_department_id text, p_name text)`, `public.update_campaign(p_campaign_id bigint, p_name text)`, `public.set_campaign_active(p_campaign_id bigint, p_active boolean)` → `private.*_impl`, with `private.require_campaign_manager(p_department_id text) returns uuid` (live `activ` profile; level ≥ 6, or `bce` with a `member_departments` row for that department; department must exist and have `kind <> 'org'` → `PT400 campaign_department_invalid`; blank name → `PT400 invalid_campaign_name`; `unique_violation` caught and re-raised `PT409 campaign_name_taken`; unknown campaign → `PT404 campaign_not_found`). `private.set_updated_at()` (#368) is in dobrerares' #420, which is not in this stack's base — so `update_campaign` and `set_campaign_active` set `updated_at = now()` themselves, with a comment saying the trigger will make that redundant once #420 lands (the conventions doc allows exactly this). Four-role revokes; wrappers and `_impl` granted to `authenticated`. Tests `campaign_commands.test.sql`: local BCE succeeds in own department and gets `42501` elsewhere; BC anywhere; Responsabil/Voluntar/inactive/claimless/anon denied; name collision → `PT409`; deactivate then `set_campaign_active(true)` round-trips.

### Task 14: #320 — notification helpers · gate: #65 (his #413), #284

`notifications.task_id bigint references tasks(id)`, `notifications.dedupe_key text`, partial unique `notifications_member_dedupe_unread_uidx on (member_id, dedupe_key) where not read`. `private.notify(p_recipients uuid[], p_kind noti_kind, p_title text, p_body text, p_task_id bigint, p_dedupe_key text, p_actor uuid) returns integer`: drops `p_actor` and non-`activ` profiles, sets `link = '/tracker/' || p_task_id` when a task is given, upserts `on conflict (member_id, dedupe_key) where not read do update set title, body, created_at = now()`, returns rows written. `private.task_managers(p_task_id bigint) returns setof uuid`: `tasks.created_by` if `activ`; else the Origin's managers — Department / Department-Team → active `bce` members of the (parent) department; Project → leader + `responsible` members; Independent Team → active team members; if that set is empty → active `bc`/`moderator` (ruling: coordination departments may have no BCE, and a task must always have a manager to notify). Neither helper is granted to any role. Tests `notify_helper.test.sql` per the issue's AC plus the fallback chain. Types regenerate.

### Task 15: #317 — bind the ledger to Evaluations, drop the sync triggers · gate: Task 9 (#316), Task 2 (#162), #290

`points_ledger.evaluation_id bigint references task_evaluations(id)`; drop `points_ledger_task_member_uidx`; add unique `points_ledger_evaluation_reason_uidx on (evaluation_id, reason) where evaluation_id is not null`; `points_ledger_task_reference_ck` from #162 extends to require `evaluation_id` for `task`/`task_reversal` rows **after** the backfill. Backfill (documented in the header, deterministic by `task_id, member_id`): for each existing `reason = 'task'` row create one `task_evaluations` row (`outcome = 'completed'`, difficulty/rating from the task, `points = delta`, `evaluated_by = coalesce(awarded_by, task.created_by)`, `assignment_id` = that member's `task_assignments` row from #290's backfill, `note = 'legacy_migration'`) and set `evaluation_id`. Drop `tasks_sync_ledger`, `task_assignees_sync_ledger` and their functions; drop the generated `tasks.points` column (points now live on the Evaluation) — if `app/src` reads `tasks.points` (grep before starting), replace that read with the Evaluation's points or remove the field; the regenerated types make CI catch anything missed. `seed.sql` writes evaluations and ledger rows directly; `rls_deny_by_default.test.sql` (~57–69) and `points_engine.test.sql` rewritten for the trigger-free model; `member_points`, `my_points`, `leaderboard`, `dept_cup` fixtures still sum correctly.

### Task 16: #318 — `task_read` for the normalized model · gate: #284–#288, #293, Task 8 (#291), Task 11 (#315)

Helpers (definer, `search_path = ''`, granted to `authenticated` as policy predicates): `private.is_task_executor(p_task_id)` (any `task_assignments` row for the caller, active or ended — past Executors keep reading their history), `private.is_task_candidate(p_task_id)` (any `task_candidates` row), `private.can_manage_task(p_task_id)` (`private.can_manage_origin` over the task's three origin columns), `private.can_read_task(p_task_id)` (the full rule, recursing once to the parent for subtasks). Policy `tasks_read` on `authenticated`: `auth_is_member()` and (level ≥ 5 — BCE/BC/Moderator read all per #257 — or executor, or candidate, or manage, or team member of a Team-origin task, or Project lead/Responsible of a Project-origin task, or an eligible public Opportunity: `kind = 'task' and assignment_mode = 'public' and status = 'todo' and queue open (`queue_closed_at is null`) and (audience = 'org' or caller belongs to the origin department/team)`, or parent readable). Drop `public.is_assigned(bigint)` and its consumers (`task_read` was the last). Matrix test `rls_tasks_read_matrix.test.sql` per the issue's AC; strip the legacy read cases from `rls_tasks_points.test.sql`.

### Task 17: #319 — read policies for the four history tables · gate: Tasks 6, 8, 9, #289, #290

Policies (`<table>_read`) on `task_assignments`, `task_candidates`, `task_activity`, `task_evaluations`: own rows (`member_id`/`actor_id`/`evaluated_by` … as applies) or `private.can_manage_task(task_id)` or Team member of a Team-origin task (complete Activity for Team members per ADR-0007). Candidate identities: RLS cannot hide a column, so fellow candidates get **no rows of others**; positions come from a `security invoker` view `task_queue_summary(task_id, pending_count, my_position)` over a definer helper `private.queue_position(p_task_id, p_member_id)`. Tests `rls_task_history_read.test.sql` per the AC; claimless sweep with fixture rows in all four tables.

### Task 18: #294 — indexes for Tracker predicates · gate: all of the above

Catalogue what exists (`\di` on the six tables), then add only what the read policies and the tracker queries use and lack: e.g. `tasks (status)`, `(dept_id, status)`, `(team_id, status)`, `(project_id, status)`, a partial `(assignment_mode, audience, status) where kind = 'task' and queue_closed_at is null` for Opportunities, `(deadline) where status in ('todo','in_progress','in_review')` for overdue scans, `(parent_task_id)` if #315 did not add it. `EXPLAIN` evidence for five representative predicates in the report; catalog assertions in `tracker_indexes.test.sql`; no duplicates of existing indexes.

### Task 19: #295 — grants and default privileges for the Task surface · gate: Task 18

One migration asserting the posture on every Task table/sequence/view from #283–#294: `revoke all … from anon`; `revoke truncate, references, trigger … from authenticated, service_role`; `revoke insert, update, delete` on command-owned tables from `authenticated` (all six history/queue tables; `tasks` itself stays writable until #345 retires `task_write`); views select-only; every `private.*` helper's grant matches the conventions doc (policy predicates → `authenticated`; `require_*`/trigger → none). No `alter default privileges` (see the Stack B ledger: Supabase's explicit `anon` default cannot be undone per schema). Test `tracker_grants.test.sql` with `has_table_privilege` / `has_function_privilege` matrices; the conventions sweep stays green.

---

## Verification (whole batch)

- Per PR: CI green, `Closes #n`, trailer + footer, types regenerated when the shape changed, `bash scripts/check-seed-rerunnable.sh` passes whenever the seed changed.
- After Phase 1: `select name, min_level from events` shows the AG event at 3; `teams` has no `for_recruits`; a `sanction` without a note is rejected; `points_ledger.note` exists.
- After Phase 2: `npx supabase db reset && npx supabase test db` green with the eight new suites; the command wave's blockers (#295, #320, #314, #315, #312, #316, #317, #321) are all closed; `gh issue list --label backend --state open` under "Task Tracker backend" shows only #327–#345, #258–#262, #296 and #345.
- SDD ledger: `.superpowers/sdd/2026-09-11-tracker-schema-completion/progress.md`.

## Risks and rulings

- **His PRs may change before they merge.** Every Phase 2 spec cites names from his diffs on 2026-09-11; the gate check plus a `\d` of the touched tables before each dispatch is mandatory, and a mismatch is a ledger ruling, not a silent adaptation.
- **`department_id` vs `dept_id`.** His `campaigns` uses `department_id` against the rest of the schema's `dept_id`; this plan follows his column (renaming it is his call, or #379's).
- **Dropping `tasks.points` (#317) can break the frontend build** — that is the point of the regenerated types; the same PR makes the minimal `app/src` change.
- **`event_read` → Minimum Level (#372) is a visible behaviour change**: department events become readable org-wide at level 0. ADR-0008 accepted that on 2026-09-07; the PR body says it plainly.
- **Two-deep stacks in Phase 1** are the only stacking; the merge protocol above applies, and I retarget on request.
- **Peer sessions on this machine** (Codex worktrees run their own stacks) — the operational rule stands: one database pass at a time in `supabase_db_osubb-app`.

## Not in this plan

The command wave (#327–#345) — next plan, once #295 and #320 are on `main`. Leadership reads (#258 SuperGod25, #259, #260, #262) — after #317. Tracker frontend — after his web foundation. #66 (waits for #70), #160, #163, #379, #47/#48.
