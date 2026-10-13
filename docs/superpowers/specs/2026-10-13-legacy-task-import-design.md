# Legacy Task Tracker import — design

Date: 2026-10-13. Status: design approved in conversation on 2026-10-13 and this document approved in writing on 2026-10-14 ("I like the specs"), with the three rulings of that day folded in — the `PV` titles, the Moderator as the acting Member, BC and the Moderator credited. It is the binding spec for the plan that implements it. Nothing in it has been built or run.

## Decision

OSUBB's pre-app points system — the Google Sheets "Department/Project list" → "Activities List" → "Task Tracker" chain — is imported **once** into the application as real Tasks: one sheet row becomes one terminal Task with its Executor, Evaluation and Task Points, **dated on the day the work was completed**. The import is the second and last writer of Task Points beside `private.evaluate_task`, is marked forever by the reserved `legacy_migration` Evaluation source, sends no Notification, and is removed from the database after the run is verified.

The rules, as given:

- "I want all the tasks with every detail." One Task per row, never a balance.
- Only rows whose **Date of completion** is on or after **2026-02-01**; "if the tasks don't have a timestamp just ignore them".
- A row that is not `Realizat` still counts when it carries points ("maybe they got negative points and we count those"); a blank Status with a date is "completed at the date specified".
- "The dates should be real."
- Department rows go to the top-level Department Group; a Project's rows all go to one Project Group, whatever category they sat under in the sheet. Activities are not Groups and "activity name is not needed".
- Points follow the application's formula; "ignore what is in the sheet".
- "If the rows are completely identical, add only one"; rows that only share an Id are separate Tasks.
- A person with no account is skipped: "meanwhile they graduated and osubb is only for students".
- Future-dated rows are ignored — "the rest of tasks will be the responsibility of those whom managed the teams, not ours" — except the one proven year typo.
- `Nerealizat` becomes an unfulfilled Task; every other row a completed Task.
- Titles are kept as written; the one title above 120 characters is cut, and the rows titled `PV`, too short for the database, become "PV Ședință".
- The promotion candidates the history produces are wanted: "those tasks count for the current role of volunteers, that's the reason we add them right now".
- The creator of the imported Tasks is the **Moderator** account, which runs the import.
- BC members and the Moderator are credited like everyone else: "Add those BC and Moderator rows i don't mind."

## The import set

The rows are prepared **outside the repository** (they carry Members' names), in the local folder `../osubb-legacy-import/` beside the checkout: `import-set.json`, rebuilt by `parse.js` → `match.js` → `build-import.js` from the 228 verified tracker exports. Every exclusion is listed with its reason in `excluded.csv`. The data decisions live in that folder's `REPORT.md`; this spec only fixes the contract between that file and the database.

At the time of writing the set holds 5 270 rows, 28 609 points, 219 Members, completion dates 2025-12-18 … 2026-10-11 (the single date before the cutoff is the corrected year typo). Every row names an existing Group since 2026-10-14: the tracker's Projects are old editions and land in Groups created for them (UBB Festival 2025, Sfertul Academic 2025, Mind Matters 2025, Carvana UBB 2025, JSUXIX, FutureUPVI, Gala OSUBB 29), Campusfera in the current one, "Ședințe generale" on the Organization Group, and Interne on Diverse.

Each row of the file carries: `tracker_id` (the Drive file id), `sheet_row` (the row number in the tracker's Tasks tab, header = 1), `group_id`, `profile_id`, `title`, `full_title` (only when the title was cut), `deadline` (sheet text, may be empty), `difficulty_level` (1–10), `rating` (1–5), `sheet_status`, `completed_on` (`YYYY-MM-DD`), `observations`.

## What one row becomes

All instants below are **the completion day at 12:00 Europe/Bucharest** ("the completion instant"), so the day is the same in every read.

| Row                          | Written as                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.tasks`               | `title`; `description` = the full title when it was cut, else null; `group_id`; `kind` `task`, `audience` `local`, `assignment_mode` `direct`; no Campaign, no Attached Link; `created_by` = the acting Member; `created_at` = the completion instant; `deadline` = the sheet's deadline day at 12:00 Europe/Bucharest, or the completion instant when the sheet has none (the Work Filter ranges on the deadline, so a Task without one would never be found by date); `difficulty`, `rating`; `status` `completed` with `completed_at`, or `unfulfilled` with `unfulfilled_at`, = the completion instant |
| `public.task_assignments`    | the Executor; `assigned_at` = `ended_at` = the completion instant; `end_reason` `completed` or `failed`; `assigned_by` = the acting Member                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `public.task_evaluations`    | `source` **`legacy_migration`**; `evaluated_by` null (the sheet's evaluator is unknown — the case the source exists for); `outcome`; `difficulty`, `rating`; `points` = the level's `base_points` × `public.rating_mult(rating)`; `note` = the sheet's Observations, or `Importat din Task Tracker.` when there are none; `evaluated_at` = the completion instant; `created_at` stays the real write time                                                                                                                                                                                                  |
| `public.points_ledger`       | `member_id` = the Executor; `delta` = the points; `reason` `task`; `task_id`, `evaluation_id`; `created_at` = the completion instant                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `public.task_activity`       | the three rows `create_completed_task` leaves — `created` (`details.completed_task` and `details.legacy_import` true), `executor_assigned` (`details.via` `completed_task`), and `evaluated` or `unfulfilled` (the usual `evaluation_id` / `difficulty` / `rating` / `points` details) — all with `occurred_at` = the completion instant and **no actor** (the history shows "Sistem"): the `task_create` daily cap counts a Member's `created` rows of the last 24 hours, and 5 270 of them would lock the Moderator out of creating Tasks for a day                                                      |
| `public.legacy_task_imports` | the provenance row (below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Not written: any Notification, any Candidate Queue row, any `task_create` daily-cap spend.

**Outcome.** `sheet_status` `Nerealizat` → `unfulfilled`; anything else → `completed`. A zero or negative award is written exactly as computed, as everywhere else.

**Titles.** `tasks_title_length_ck` (3–120 characters) binds every Task and is not loosened for this import. The 13 rows titled `PV` are therefore stored as `PV Ședință` (ruling of 2026-10-14); the one 130-character title is cut at 120 and kept whole in the description. Both are build-time rules in `build-import.js`, which stops on any other title shorter than three characters instead of renaming it.

**Who is credited.** Every matched `activ` Member, whatever their Role today — including the 9 BC members and the Moderator (393 rows, 2 260 points), whom the direct completed-work path refuses (`executor_role_excluded`, F-27). The reason that rule exists is a leader crediting themselves; here the Evaluation was made in the sheet by the managers of the time and the import only copies it. Confirmed on 2026-10-14. The Moderator is among them (49 rows) and is also the acting Member: the import credits its own runner, knowingly. The Group's Minimum Level is not applied either: the work predates it.

## The command

`public.import_legacy_tasks(p_actor uuid, p_rows jsonb, p_dry_run boolean default false) returns jsonb` — `security definer`, `set search_path = ''`, executable by **`service_role` only**: the shape of #991's `public.import_member`, the existing exception to conventions §2 for a bulk load driven by a script holding the secret key. The acting Member is a parameter because no session exists, and is re-checked live.

Order of work, one transaction per call:

1. **Malformed, before the gate** (`PT400`): `p_actor` null (`invalid_actor`); `p_rows` not a non-empty array or above 200 rows (`invalid_rows` / `too_many_rows`); per row — `invalid_tracker_id`, `invalid_sheet_row`, `title_required` / `title_too_short` / `title_too_long` (through `private.require_text_length`), `description_too_long`, `task_group_required`, `invalid_executor` (null), `invalid_difficulty` (not a level of `task_difficulty_levels`), `invalid_rating`, `invalid_outcome`, `invalid_completed_on` (not a date, or after today in Europe/Bucharest), `invalid_deadline`, `evaluation_note_required` / `note_too_long`; the same `(tracker_id, sheet_row)` twice in one call (`duplicate_row`). The error's `detail` names the offending row's index and key.
2. **The gate**: `42501 legacy_import_forbidden` unless `p_actor` is a live `activ` **Moderator** (level 9), held `for share`.
3. **Against loaded rows** (`PT400` / `PT409`): `invalid_executor` unless the Executor is a live `activ` Member; `invalid_origin` for an unknown Group; `group_archived` for an archived one.
4. **Skip what is already in**: a row whose `(tracker_id, sheet_row)` is registered is counted as `already_imported` and written nowhere — a re-run after a dropped connection completes the import and can never double it.
5. **Write** the remaining rows as the table above, under one transaction-level advisory lock so two runs can never interleave — the registry row before the Evaluation, because the trigger below reads it. The ledger rows of a call go in **one** `insert … select`, so the statement-level `points_ledger_refresh_promotion_candidates` trigger runs once per call, not once per row.
6. **Return** `{ "received", "imported", "already_imported", "points", "dry_run" }`.

With `p_dry_run` the function does steps 1–4, computes the same counts and points, and writes nothing.

One invalid row fails the whole call; nothing of it is kept.

## Provenance and the closed source

`public.legacy_task_imports`: `tracker_id text`, `sheet_row integer`, primary key `(tracker_id, sheet_row)`; `sheet_id text` (the sheet's own Id, not unique); `task_id bigint` unique, `references public.tasks on delete set null` — a Task later deleted for good (#1017) keeps its key claimed; `imported_by uuid references public.profiles on delete set null`; `created_at`. RLS on with one restrictive deny-all policy for the client roles and no grant to any role, like #991's `member_imports`; an index covers `imported_by`; the script reads its totals back through `public.legacy_task_import_totals()` (service role only, dropped together with the command). Excluded by name from the live-change broadcast (`supabase/tests/live_changes.test.sql`, ADR-0011): no client reads it.

`private.reject_legacy_evaluation_source` keeps refusing every `legacy_migration` Evaluation with `23514 task_evaluation_legacy_source_closed`, **except** for a Task registered in `legacy_task_imports`. The registry is written only by the command, so once the command is dropped the source is closed again without touching the trigger.

Imported Evaluations sit outside `task_evaluations_one_open_per_task_uidx` (it covers `command` only) and keep `evaluated_by` null under `task_evaluations_evaluator_ck`; both were designed for this source. What can still happen to an imported Task is pinned by tests, not assumed. **Delete for good** works as for any Task and reverses the points through the ledger. **Reopen is refused**: `reopen_task` reverses only a `command` Evaluation and answers `PT409 evaluation_not_found` for an imported Task — the history is a closed record, corrected by deleting the Task and, if needed, adding the finished work again. The command is not changed; `evaluation_not_found` gets Romanian copy saying so.

## The script

`scripts/import-legacy-tasks.mjs`, Node 24, no dependency beyond the bootstrap script's request helper:

```bash
SUPABASE_URL=… SUPABASE_SECRET_KEY=sb_secret_… \
node scripts/import-legacy-tasks.mjs --file <import-set.json> --actor <the Moderator's address> --dry-run
# then the same line with --execute
```

- Resolves `--actor` to a Profile id; refuses a file with a row whose `group_id` is not a number (a Group still pending).
- `--dry-run` sends every batch with `p_dry_run => true` and prints the plan: rows and points per Group, the number of Members, the date range. It writes nothing and is safe against production.
- `--execute` sends batches of 100 rows (the roles' 8 s statement timeout is the bound), stops at the first refusal naming the row, and on a call that got no answer says so instead of guessing; re-running is the recovery, because registered rows are skipped.
- After the last batch it reads the totals back — rows and points per Group and per Member from `legacy_task_imports` ⨝ `task_evaluations` — and compares them with the file. Any difference is printed and the run exits non-zero.
- The secret key is read from the environment only; the import file is never copied into the repository.

## Accepted consequences

- **Promotion candidates.** With the history in, 67 Voluntari meet the Voluntar Activ rule in force (30 Task Points since the last run, six months of tenure). Each is listed as a candidate and every Member of level ≥ 6 receives one Notification per candidate. Wanted, per the rule above; promotion stays a manual decision.
- **Period reads see the past.** Clasament, the Department Cup (Departments only, R52) and Evaluation rankings range on `evaluated_at`, so every 2026 period now includes the imported work.
- **The creator's lists.** The Moderator is the Task Manager of 5 270 terminal Tasks and sees them wherever "created by me" is read.
- **Live changes.** Each call broadcasts its rows to open clients; the run is done at a quiet hour.
- **No Member is notified** that their history arrived; they find it in their Tasks and their total.

## Rollout

1. PR 1 — the registry, the trigger change, the command, the script, the tests, the documents.
2. Before PR 1 merges, a local rehearsal on its branch: placeholder Members and Groups carrying the production ids are provisioned on the local stack, the real import file is run end to end, and the totals match.
3. After PR 1's Release reaches production: a backup is confirmed, then `--dry-run`, then `--execute`, then the read-back comparison. A handful of imported Tasks, one Member's points and one Clasament period are checked in the application.
4. PR 2 — drops `public.import_legacy_tasks`; `legacy_task_imports` stays as provenance. The script joins house rule 9's list of one-shot scripts.

There is no undo command. A wrong run is corrected from the backup, or Task by Task with delete-for-good, which reverses the points through the ledger.

## Tests

pgTAP (`supabase/tests/legacy_task_import.test.sql`):

- one completed and one unfulfilled row: every column of the six tables above, including the historical instants and `task_evaluations.created_at` staying current;
- points equal `private.evaluate_task`'s for all 50 (level, rating) pairs;
- `private.task_points_in_range` and the Work Filter find an imported Task in its historical range and not in today's;
- no row in `public.notifications` for the Executor; the `task_create` cap untouched;
- a second call with the same rows imports nothing and reports `already_imported`; a call mixing old and new rows imports only the new;
- `p_dry_run` writes nothing and returns the same counts;
- every `PT400` reason of step 1, `42501 legacy_import_forbidden` for a BC actor (level 6), an unknown one and a deactivated Moderator, `invalid_executor`, `invalid_origin`, `group_archived`;
- one invalid row rolls the whole call back;
- a direct `legacy_migration` insert for an unregistered Task is still refused (`throws_ok` naming the reason);
- `authenticated` and `anon` cannot execute the command; the registry is unreadable to both;
- reopen of an imported Task is refused with `PT409 evaluation_not_found`; delete-for-good reverses its points and leaves its key claimed, so a later call still skips the row;
- the acting Member has no `created` activity row, so their `task_create` cap is untouched;
- the promotion-candidate refresh lists a Voluntar the import carries over the threshold.

Acceptance by mutation: with the registry check removed from the trigger, the closed-source assertion must fail; with the ledger insert removed, the points assertions must fail.

Tooling (`scripts/import-legacy-tasks.test.mjs`, `npm run test:tooling`): the dry-run plan for a fixture file, batching, the stop on refusal, the resume, the read-back mismatch, the pending-Group refusal. Frontend (vitest): the copy for `evaluation_not_found`. The Task history already renders a row without an actor as "Sistem".

## Documents

- ADR-0007: an amendment (the next free ruling number) — the legacy import is the second and last writer of Task Points, what it writes, and that it is closed.
- `docs/backend/conventions.md` §3: the new reasons; §2: the second service-role bulk command beside `import_member`.
- `docs/backend/legacy-task-import.md`: the runbook — where the import set comes from, the two commands, the checks, the recovery.
- `CONTEXT.md`: **Legacy Import** as a term, so imported Tasks have a name in issues and tests.
- `CLAUDE.md`: the status line and house rule 9.

## Out of scope

Rows before 2026-02-01, undated or future-dated rows, and people without an account; activity names and Campaigns; re-evaluating or correcting what the sheets recorded beyond the formula; any change to `private.evaluate_task`, to the title limits or to the promotion rules; an undo command; a second import.
