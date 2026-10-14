# Legacy Task Tracker import — issue drafts

Drafts for review. Nothing here is on GitHub yet: the two issues are created, in this order, only after one explicit go-ahead (Task 0 of `2026-10-14-legacy-task-import.md`). `#1049` is the first issue's number once it exists.

Checked before drafting: no open or closed issue, no PR and nothing on `main` covers an import of the legacy Task Tracker (`gh issue list --search "legacy import" --state all`, `gh pr list --search "legacy import" --state all`, `grep -ri "legacy_task_import" supabase docs` — run them again before creating).

---

## Issue 1

**Title:** Legacy Task Tracker import: the one-time import command, script and tests

**Labels:** `ready-for-agent`

## Goal

Import OSUBB's pre-app points history — the Google Sheets Task Tracker, rows completed on or after 2026-02-01 — into the application once, as terminal Tasks dated on the day the work was completed, with their Task Points.

## Why

The volunteer base was imported without history (#991), so every Member starts at zero while eight months of evaluated work sit in the sheets. That work counts for the volunteers' current role, so it has to be in the application before the next Voluntar Activ evaluation, and with its real dates so that Clasament, the Department Cup and Evaluation rankings place it where it happened.

## What to build

Spec: `docs/superpowers/specs/2026-10-13-legacy-task-import-design.md`. Plan: `docs/superpowers/plans/2026-10-14-legacy-task-import.md`.

- `public.legacy_task_imports` — which sheet row became which Task; the idempotency key.
- `private.reject_legacy_evaluation_source` — keeps refusing the `legacy_migration` Evaluation source, except for a Task in that registry.
- `public.import_legacy_tasks(p_actor, p_rows, p_dry_run)` — service role only, the Moderator as acting Member; up to 200 rows per call; each row written as Task + Assignment + `legacy_migration` Evaluation + ledger row + activity, dated at 12:00 Europe/Bucharest on its completion day; points by the application's formula; no Notification; registered rows skipped.
- `public.legacy_task_import_totals()` — what the script compares its file with.
- `scripts/import-legacy-tasks.mjs` — dry run, batches of 100, resume, read-back comparison; `scripts/legacy-import-rehearsal.sh` for the local end-to-end rehearsal.
- Romanian copy for `evaluation_not_found` (an imported Task cannot be reopened).
- ADR-0007 amendment (the next free ruling), `CONTEXT.md` (**Legacy Import**), conventions §2–§3, the runbook `docs/backend/legacy-task-import.md`.

## Implementation boundary

- The import file holds Members' names and stays outside the repository; tests use invented rows.
- `private.evaluate_task`, `reopen_task`, the title limits and the promotion rules are not changed.
- No production run in this issue: it happens after the Release, by the runbook, and is recorded here.
- Dropping the command is the next issue.

## Acceptance criteria

- [ ] A sheet row becomes a `completed` or `unfulfilled` Task whose `created_at`, `completed_at`/`unfulfilled_at`, Assignment, `evaluated_at` and ledger `created_at` are 12:00 Europe/Bucharest on its completion day; its deadline is the sheet's day, else that instant.
- [ ] Points equal base points × the Rating multiplier for all 50 (level, rating) pairs.
- [ ] The Evaluation's source is `legacy_migration` and it has no evaluator; a `legacy_migration` insert for an unregistered Task is still refused.
- [ ] A second call with the same rows imports nothing; a mixed call imports only the new rows; one invalid row fails the whole call and names the row.
- [ ] Only a live `activ` Moderator may be the acting Member; `authenticated` and `anon` cannot execute the command.
- [ ] No Notification reaches an Executor; no activity row names the acting Member.
- [ ] Period reads find the work in its historical range; a Voluntar carried over the threshold becomes a promotion candidate.
- [ ] An imported Task cannot be reopened (`PT409 evaluation_not_found`, with copy) and can be deleted for good, which reverses its points and leaves its sheet row claimed.
- [ ] The local rehearsal with the real file ends `REHEARSAL PASSED`.

## Required tests

- `supabase/tests/legacy_task_import.test.sql` — 68 assertions, with the six mutation guards of the plan recorded in its header.
- `scripts/import-legacy-tasks.test.mjs` — 13 tests against an in-memory fake project, in `npm run test:tooling`.
- One vitest for the `evaluation_not_found` copy.
- `supabase/tests/live_changes.test.sql` and `conventions.test.sql` stay green.

## Blocked by

None — can start immediately.

---

## Issue 2

**Title:** Close the Legacy Import: drop the import command after the verified production run

**Labels:** `ready-for-human`

## Goal

Remove `public.import_legacy_tasks` and `public.legacy_task_import_totals` once the Legacy Import has run in production and its totals are verified, so that nothing can write a `legacy_migration` Evaluation again.

## Why

The import is the second writer of Task Points and is meant to be used exactly once (ADR-0007, amendment of 2026-10-14). While its command exists, a holder of the secret key could run it again with a different file. Dropping it closes the reserved source for good; the registry stays as the record of which sheet row became which Task.

## What to build

- A migration that drops the two functions and rewrites the registry's comment.
- `supabase/tests/legacy_task_import.test.sql` replaced by the closed-state suite: the functions are gone, the registry stays and is readable by no role, no function writes it, a `legacy_migration` insert is refused.
- `CLAUDE.md`: house rule 9 names `scripts/import-legacy-tasks.mjs`; the Status line records the date, rows and points of the run.
- `docs/backend/legacy-task-import.md` marked closed; conventions §2 updated.

## Implementation boundary

- `public.legacy_task_imports` is not dropped and its rows are not touched.
- The script, its test and the rehearsal scripts stay in the repository as the record of what ran.

## Acceptance criteria

- [ ] `public.import_legacy_tasks` and `public.legacy_task_import_totals` do not exist.
- [ ] A `legacy_migration` Evaluation insert is refused with `23514 task_evaluation_legacy_source_closed`.
- [ ] No function in `public` or `private` inserts into `public.legacy_task_imports`.
- [ ] Generated types no longer list the two functions.

## Required tests

- The closed-state suite (6 assertions).

## Blocked by

- #1049 — merged, released, and its production run recorded in that issue with the read-back comparison passing.
