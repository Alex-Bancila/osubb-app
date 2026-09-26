# Production bootstrap (#112)

Production starts with zero profiles, and every door into the application (`invite-member`, `csv-import`, Administrare) needs a level-6 caller. `scripts/bootstrap-production.mjs` opens the first door: it creates the Moderator, then the BC/BCE Members with one initial Group Appointment each, then imports their historical Tasks and grades (ruling L18). It is the only time the service key provisions anyone, and it refuses to run a second time.

When: `--dry-run` against staging on Thursday 1 October with Dobre ([runbook §11.6](../ops/launch-runbook-2026-10.md#11-acceptance-production-pages-project-first-release--thursday-1-oct)); the real run against production on Friday 2 October, after the first Release and before any invitation ([runbook §12.1](../ops/launch-runbook-2026-10.md#12-launch-day--friday-2-oct)).

## The two commands

From the repository root, in Git Bash, with Node 24:

```bash
# Thursday: dry run against staging. Reads only; prints every call the real run would make.
SUPABASE_URL=https://<staging-ref>.supabase.co \
SUPABASE_SECRET_KEY=sb_secret_… \
node scripts/bootstrap-production.mjs --members members.csv --tasks tasks.csv --dry-run

# Friday: the real run against production.
SUPABASE_URL=https://<production-ref>.supabase.co \
SUPABASE_SECRET_KEY=sb_secret_… \
SUPABASE_PUBLISHABLE_KEY=sb_publishable_… \
node scripts/bootstrap-production.mjs --members members.csv --tasks tasks.csv --execute
```

In PowerShell, set the variables first (`$env:SUPABASE_URL = "…"`, and so on) and run the same `node` line.

| Variable                   | Where it comes from                                                                           | Needed by   |
| -------------------------- | --------------------------------------------------------------------------------------------- | ----------- |
| `SUPABASE_URL`             | Project Settings → API → Project URL                                                          | both        |
| `SUPABASE_SECRET_KEY`      | Project Settings → API Keys → Secret keys (`sb_secret_…`); the legacy JWT key is refused (L8) | both        |
| `SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys → Publishable key (the legacy anon key also works)                | `--execute` |

The secret key is read from the environment only and never printed. Keep `members.csv` and `tasks.csv` out of the repository: they hold real names, addresses and phone numbers. Delete them after the run, like the dumps.

**On staging the dry run prints a warning and carries on**: staging has demo profiles, so it says the real run would stop there (`PT409 bootstrap_refused`), then prints the whole plan anyway. That is expected; what you compare with the sheet is the plan, row by row. A dry run exits `2` and lists every input error at once when a row does not fit the contract; fix the sheet and run it again.

## The input contract

Two UTF-8 CSV files with the header row exactly as below. Rows are numbered like a spreadsheet: the header is row 1, the first data row is row 2, and every message names the file, the row and the column. Values are trimmed; quoted values follow normal CSV rules, so `"Pop, Ana"` is one cell. The mapping document of #111 (`docs/backend/bcbce-import-mapping.md`) says which column of the BC sheet becomes which column here.

Templates: [`production-bootstrap-members.example.csv`](production-bootstrap-members.example.csv) and [`production-bootstrap-tasks.example.csv`](production-bootstrap-tasks.example.csv).

### Members file

```csv
email,full_name,phone,role,group_path,group_role,position_title,joined_at,appointed_by_email
```

| Column               | Required                      | Meaning                                                                                                                                                                                                                                                                                                        |
| -------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email`              | yes                           | The sign-in address, lowercased. Unique in the file. **Row 2 is the Moderator**: the IT Coordinator's own `@osubb.ro` address.                                                                                                                                                                                 |
| `full_name`          | yes                           | The Member's full name.                                                                                                                                                                                                                                                                                        |
| `phone`              | no                            | Any spelling rule R8 accepts (`0730 655 145`, `+40 730…`, `0040…`); stored in E.164. A number R8 cannot read is an error, never dropped silently.                                                                                                                                                              |
| `role`               | yes                           | `moderator` on row 2 and nowhere else; otherwise `bc`, `bce`, `vot`, `activ`, `voluntar` or `recrut` (expected: `bc` and `bce`).                                                                                                                                                                               |
| `group_path`         | yes, except for the Moderator | The initial Appointment: a Department (`EDU`, `Educațional`) or a Group below it written as a path (`Diverse / Echipa IT`). Matched like `csv-import` — short or display name, case and diacritics ignored, active Groups only, each segment below the previous one. An unknown or ambiguous name is an error. |
| `group_role`         | no                            | `member` (blank), `manager` (a BCE running their Department, shown under the Group's manager title) or `responsible`.                                                                                                                                                                                          |
| `position_title`     | only for `responsible`        | The Group Responsible's display name, e.g. `Coordonator IT`. Must be blank otherwise.                                                                                                                                                                                                                          |
| `joined_at`          | no                            | The join date `YYYY-MM-DD` shown on the Member Card; blank leaves it unset.                                                                                                                                                                                                                                    |
| `appointed_by_email` | no                            | Who the Appointment Notification names: blank means the Moderator; otherwise the address of an **earlier** `bc` row.                                                                                                                                                                                           |

### Tasks file (historical Tasks and grades)

```csv
executor_email,title,group_path,deadline,difficulty,rating,evaluated_at,points_note
```

| Column           | Required | Meaning                                                                                                                                                             |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `executor_email` | yes      | A Member of the members file.                                                                                                                                       |
| `title`          | yes      | The Task title, 3–120 characters.                                                                                                                                   |
| `group_path`     | yes      | The Task's Group, same matching as above. It must be the Executor's own Appointment Group, or a Group below it when the Executor is its `manager` or `responsible`. |
| `deadline`       | no       | The original deadline `YYYY-MM-DD`, kept in the Evaluation note.                                                                                                    |
| `difficulty`     | yes      | 1–5.                                                                                                                                                                |
| `rating`         | yes      | 1–5. Task Points = Difficulty × (−1, 0, 1, 2, 3 for Rating 1–5); the dry run prints each row's points and each Member's total.                                      |
| `evaluated_at`   | no       | The original evaluation date `YYYY-MM-DD`, kept in the Evaluation note.                                                                                             |
| `points_note`    | no       | Free text appended to the Evaluation note (the whole note stays within 1000 characters).                                                                            |

## What the real run does, in order

1. **Reads first, refuses early.** It counts `public.profiles` and stops with `PT409 bootstrap_refused` if there is even one; it also stops if Auth already holds any address from the members file. It loads the active Groups and validates both files completely. Nothing has been written at this point, and a refusal or an input error leaves the project untouched.
2. **Members, Moderator first.** For each row: an Auth user is created with the address already confirmed and **no email sent**; then `public.provision_profile(p_user_id, p_full_name, p_email, p_role, p_group_ids, p_appointed_by)` creates the profile and the one Appointment in the row's Group, with the Moderator (or the named BC) as `p_appointed_by`; then the phone and join date, if any, are written to the profile. The Moderator is row 2, so every later row can name them.
3. **Sessions.** One session each for the Moderator and every Executor in the tasks file (see below), made with the Auth admin API's magic-link generator and verified at once, so no email leaves.
4. **Group Roles.** As the Moderator, `public.set_group_role` makes each `manager` and `responsible` row what the sheet says.
5. **History.** For each Task row: as the Executor, `public.create_completed_work_request(title, group)`; then, as the Moderator, `public.approve_completed_work_request(request, difficulty, rating, note)`. The Moderator's own rows are approved by the first `bc` row, because nobody approves their own Request.
6. **Sign-out and summary.** Every session the run opened is signed out again (`scope=local`, so a session you opened yourself on your phone survives), and the run prints the Members created, the Group Roles set, the Tasks imported and each Member's Task Points. Exit code `0` means everything above happened.

## Why the history goes through Completed Work Requests

The issue asks for the Task commands and `private.evaluate_task` semantics, and forbids a direct Points Ledger insert. The service key cannot do that alone: every Task command is granted to `authenticated` only and takes its actor from the session (`auth.uid()`), and `start_task` and `submit_task_for_review` accept only the Task's own Executor. `private.*` is closed to `service_role` entirely.

The glossary already has the path for work finished outside the application: a **Completed Work Request**, filed by the Member who did the work and approved by someone who may decide it; approval creates the completed Task, its Assignment, its Evaluation and the Task Points in one transaction, through `private.evaluate_task` — the one place points are computed. That is two calls per Task instead of five, and every row is attributed exactly as the application would attribute it. It needs a session for each Executor and one for the Moderator, which the script makes with the Auth admin API (`generate_link` + `verify`) and closes when it is done.

What this means, stated once so nobody is surprised on 2 October:

- **The dates are the run's.** `create_task` refuses a past deadline and the approval stamps `now()`, so every imported Task carries the run day as its deadline and its Task Points are dated the run day: the Work Filter's date range and an Evaluation Period open that day see them then. The original deadline and evaluation date live in each Task's Evaluation note (`Import istoric BC/BCE (#112). Termen inițial: … Evaluat inițial: …`).
- **Addresses are confirmed and the Executors have signed in once.** The script confirms each address when it creates the user, and each Executor's single script session counts as their first sign-in. BC/BCE therefore receive **no "Ai fost invitat" email**: their invitation (#36) is your message pointing at `https://app.osubb.ro`, where the login screen sends the usual link and six-digit code. `reinvite-member` answers `already_confirmed` / `already_active` for them, which is correct.
- **Notifications are real.** Each Member finds their Appointment, the Moderator the "Cerere nouă" of every Request, and each Executor a "Cerere aprobată" with the points. They are the in-app history of what the run did.

## When something fails

- **Before the first Task write** (Members, sessions, Group Roles): the run deletes every Auth user it created, newest first; the profile, its Appointment and its Notifications go with it (`on delete cascade`). The project is back to zero profiles and the run can simply be repeated after the fix. If a deletion itself fails, the run names the address: delete it in Authentication → Users before running again.
- **During the Task import**: nothing is rolled back, because Tasks, Evaluations and Points Ledger rows are history and have no delete path. The run stops at the failing row, prints the rows already imported and the exact command to continue:

  ```bash
  node scripts/bootstrap-production.mjs --members members.csv --tasks tasks.csv --execute --resume-tasks-from <row>
  ```

  `--resume-tasks-from` skips the Members (they must all exist already) and imports the Task rows from that row on. If the failing row had already filed its Request, the run says so and gives the Request's number: approve it in Administrare → Cereri with that row's Difficulty and Rating, and resume from the next row, which is the row the printed command names.

- **When a call gets no answer at all** (a dropped connection or a timeout rather than a refusal), the run cannot know whether it wrote, and says so instead of guessing. Inside the history it prints two resume commands: one for when the row's Request is not in Administrare → Cereri, one for when it is. Before the history, the next run's preflight refuses if the lost call did create a user.

## Rehearsing the real run

A dry run exercises the reads and the plan, not the writes. To see the writes work end to end before production, run the real thing against a local stack with no demo data, then put the demo data back:

```bash
npx supabase db reset --no-seed
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SECRET_KEY=<SECRET_KEY from npx supabase status> \
SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY from npx supabase status> \
node scripts/bootstrap-production.mjs --members members.csv --tasks tasks.csv --execute
npx supabase db reset
```

Auth rate-limits token verifications per IP address (Authentication → Rate Limits; 30 per five minutes unless changed). The run makes one per session, so before a sheet with more Executors than that limit, raise it for the morning and put it back afterwards.

## Tests

`scripts/bootstrap-production.test.mjs` (`npm run test:tooling`) runs the script against an in-memory fake of the Auth and PostgREST APIs: the dry-run plan for the example files, the refusals, the Moderator-first order, the rollback before the history, the resume after a history failure, and every input rule, including the R8 phone rule, which the script imports from the app's `normalize.ts`, the TypeScript twin of `private.normalize_phone`.
