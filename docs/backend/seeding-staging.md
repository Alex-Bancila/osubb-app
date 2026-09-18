# Seeding staging with demo data

Staging gets its schema automatically and its demo data **on request**. This is how you put the demo data there, why it is a separate deliberate act, and what to check afterwards.

## The gap this closes

Merging to `main` runs `supabase db push`, which applies **migrations only**. `supabase/seed.sql` is not a migration: the CLI runs it on `db reset` and `supabase start`, both local. So every demo task, member and announcement we wrote landed on your laptop and nowhere else — staging had the complete schema and **zero rows**.

That is the worst shape a demo can be in, because nothing looks broken. Every screen renders, every query succeeds, and the app is simply empty. Nobody would notice until the day someone opened the staging URL in front of BC.

The workflow **Seed staging demo data** (`.github/workflows/seed-staging.yml`) applies `seed.sql` to staging with `psql`. It is manual on purpose: staging is shared, and re-seeding replaces the demo dataset. That should be a decision someone makes before a demo, not a side effect of a merge.

## One-time setup: the `STAGING_DB_URL` secret

The workflow needs a direct database connection, which `SUPABASE_ACCESS_TOKEN` does not provide.

1. Supabase dashboard → your **staging** project → **Connect**.
2. Choose **Session pooler** and copy the URI. It looks like
   `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`
3. Replace `[YOUR-PASSWORD]` with the database password (the same one in `SUPABASE_DB_PASSWORD`).
4. GitHub → repo **Settings → Secrets and variables → Actions → New repository secret**, named `STAGING_DB_URL`.

Use the **session pooler** (port 5432), not the direct `db.<ref>.supabase.co` connection: GitHub runners are IPv4-only and the direct host is IPv6-only on current projects. The transaction pooler (6543) is for application traffic, not for scripts that run in one transaction.

⚠️ Set this from a browser or a real terminal. `gh secret set` piped from a non-interactive prompt stores an **empty value** — that trap has already cost us one silent CI skip (house rule 8).

## Running it

**Actions → Seed staging demo data → Run workflow**, then type the staging **project ref** to confirm the target (Supabase → Settings → General → Reference ID), and run.

The job refuses to do anything unless both are true:

| Check                                                      | Fails when                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| the ref you typed equals the `SUPABASE_PROJECT_REF` secret | you meant a different project, or mistyped                                     |
| `STAGING_DB_URL` contains that same ref                    | the URL secret points somewhere else — production, another project, an old one |

Then it preflights (are the migrations applied? can this role write `auth.users`?) before writing anything, applies the seed **in a single transaction**, and prints the leaderboard it produced.

Production is not reachable from here. It is a different project with different secrets and its own manually-approved deploy workflow (#77, #78) — and the only thing that could aim this job at it is putting a production URL in `STAGING_DB_URL` _and_ a production ref in `SUPABASE_PROJECT_REF`. Don't.

## What it actually does

`seed.sql` begins by deleting the **demo cohort** — the eight `@demo.osubb` accounts and the rows they own — and then re-inserts everything. That makes it re-runnable, which matters twice: a demo database that has been clicked through gets restored to a known state, and a rerun after a failure is safe.

The delete order is dictated by the foreign keys, not by taste: ledger → Evaluations → activity → Candidates → Assignments → completed-work requests → Tasks → Campaigns → events → announcements → Projects → Teams → `auth.users`. Requests come before Tasks because an approved request names the Task its approval created; Campaigns come after them because a Task pins the Campaign it is labelled with.

The scope is deliberately narrow. A real person invited to staging for testing keeps their profile, the tasks they created and the points they earned; only demo rows are replaced. (Their claim on a _demo_ task disappears with that task — the task itself is re-created.)

"Identical" means the data is identical, not the row ids: `tasks.id` and friends come from identity sequences, which keep counting. Nothing in the app depends on a specific id.

Reference data — roles, departments, the rating and difficulty guides, `role_capabilities`, `notif_suppression` — is **not** touched. It lives in migrations, because production needs it too (house rule 6).

## After it runs

The job log ends with the leaderboard and a row count per table. It should match what you get locally after `npx supabase db reset`:

| what                    | count                       |
| ----------------------- | --------------------------- |
| demo members            | 8                           |
| campaigns               | 5 (one per real department) |
| tasks                   | 19 (8 evaluated)            |
| assignments             | 15                          |
| candidates              | 5                           |
| activity rows           | 78                          |
| evaluations             | 9 (one of them reversed)    |
| ledger rows             | 11                          |
| completed-work requests | 3                           |
| events                  | 7                           |
| announcements           | 5                           |
| notifications           | 7                           |

### What the 19 demo Tasks cover (#296)

The demo dataset is built on the normalized Tracker model (ADR-0007) and carries one Task per approved path, so a role-matrix walkthrough never has to invent data:

- **Origins** — Department (all five real ones), Department Team (`it`, under Diverse), Independent Team (`t-logistica`), and the active Project.
- **Assignment modes** — direct with an Executor from creation; public with an open Queue and nobody in it (in two different Departments — no command leaves a pending Candidate with no Executor); public with a first-come Executor and two Members queued behind them.
- **Lifecycle** — `todo`, `in_progress`, `in_review` after one round of feedback (`review_round = 1`), `completed` on time, `completed` late, `unfulfilled` at Rating 1 (a **negative** ledger row), and `cancelled` with a reason.
- **The awkward ones** — a Task evaluated, reopened and evaluated again (a reversed Evaluation, a `task_reversal` ledger row and a second Evaluation on a second Assignment); an Umbrella whose three Subtasks are completed, in progress and cancelled; a Task duplicated from the unfulfilled one (same title, `duplicated_from_task_id` set); and completed-work requests in all three states, the approved one naming the Task its approval created.

Because the seed runs as the table owner with no `auth.uid()`, it cannot call the commands — it writes every row by hand. `supabase/tests/demo_seed.test.sql` is what proves the commands _could_ have produced the result: it checks the Evaluation/ledger/Assignment triple on every completed Task, the Queue-closed-before-terminal rule, the `assignment_id` stamping rule on activity rows, and that every Task's creator is somebody `private.require_origin_manager` would have accepted.

Then sign in to the app as two different demo accounts and confirm the screens differ. All eight use the password `parola123`:

| Email                    | Role                   | Level | Good for showing                                         |
| ------------------------ | ---------------------- | ----- | -------------------------------------------------------- |
| `recrut@demo.osubb`      | Recrut                 | 0     | the smallest view: 6 events, 6 tasks                     |
| `voluntar@demo.osubb`    | Voluntar               | 1     | a normal member with points, a team and 8 visible tasks  |
| `activ@demo.osubb`       | Voluntar Activ           | 2     | a sanction on the ledger, and a Project Responsible      |
| `vot@demo.osubb`         | Voluntar cu Drept de Vot | 3     | top of the leaderboard; Tineret + Secretariat            |
| `responsabil@demo.osubb` | Responsabil de proiect | 4     | Project lead authority — Department Tasks are not theirs |
| `bce@demo.osubb`         | BCE                    | 5     | Diverse + Team `it`: the one BCE-managed Origin          |
| `bc@demo.osubb`          | BC                     | 6     | everything: 7 events, 19 tasks, the BC panel             |
| `moderator@demo.osubb`   | Moderator              | 9     | the moderation view                                      |

⚠️ `bce@` and `moderator@` belong to **Diverse** and Team **`it`** (issue #296), not to a delivery Department. That is deliberate and visible: `private.can_manage_origin` gives Department authority to BC/Moderator and to a **local BCE of that Department** only, so with no BCE inside `edu`/`pr`/`youth`/`fin`/`hr`, every Department Task in the demo is created and evaluated by `bc@` or `moderator@`. The other three authority branches each have exactly one demo Origin: the Department Team `it` (BCE of its parent Department), the Independent Team `t-logistica` (any active member), and the active Project (its lead and its Responsible).

These accounts exist only because clicking through a demo with eight magic links is miserable. `@demo.osubb` is a domain nobody can receive mail at, and real onboarding stays invite-only and passwordless (ADR-0003).

## Doing the same thing locally

`npx supabase db reset` re-applies every migration and then the seed. To re-seed **without** dropping your local database — the same thing the workflow does to staging:

```bash
docker exec -i supabase_db_osubb-app psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 --single-transaction < supabase/seed.sql
```

⚠️ `--single-transaction` (or `psql -1`) is required, not optional: the seed briefly disables `task_evaluations`' and `task_activity`'s append-only guards around its own demo-cohort cleanup, and that is only safe because a mid-file failure rolls the whole thing back with them. Never pipe `seed.sql` into `psql` without it.

Run it twice; the data will be the same both times. If you change `seed.sql`, check that this still holds — a seed that only works on an empty database is a seed staging cannot use.

**Verify locally:** `bash scripts/check-seed-rerunnable.sh` does the above for you — same content-fingerprint check CI runs on every PR. Prerequisites: Docker running and `npx supabase start` (or `npx supabase db reset`) already applied to the local stack.

## When it goes wrong

| Message                                                                           | What it means                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `The ref you typed is not the staging project ref`                                | typo, or `SUPABASE_PROJECT_REF` is not set to staging. Nothing was written.                                                                                                                                                          |
| `STAGING_DB_URL does not point at the staging project`                            | the URL secret is for a different project. Nothing was written.                                                                                                                                                                      |
| `Migrations are not applied on this project`                                      | staging never got a `db push`. Merge to `main`, let CI finish, then re-run.                                                                                                                                                          |
| `This database role cannot write auth.users`                                      | you are connected as something other than `postgres` — check the URI's username.                                                                                                                                                     |
| `violates foreign key constraint "tasks_team_id_fkey"` (or `events_team_id_fkey`) | somebody's non-demo task or event is attached to a demo team (`t-app`, `t-recruti`), so the team cannot be replaced. The transaction rolled back and nothing was written: move that task to another team, or delete it, then re-run. |
| `violates foreign key constraint "tasks_campaign_id_fkey"`                        | somebody's non-demo task is labelled with a demo Campaign, so the Campaign cannot be replaced. Same fix: clear that task's Campaign, then re-run. Nothing was written.                                                               |
| `violates foreign key constraint "completed_work_requests_task_id_fkey"`          | a completed-work request outside the demo cohort names a demo Task. Decide or delete that request first; nothing was written.                                                                                                        |
| `password authentication failed`                                                  | the password in `STAGING_DB_URL` is wrong or the secret is empty (see the ⚠️ above).                                                                                                                                                 |
| Logins fail with a 500 and _"converting NULL to string is unsupported"_           | GoTrue read a null token column. `seed.sql` sets all eight to `''`; if you add a user by hand, do the same.                                                                                                                          |
| Sign-in works but every screen is empty                                           | the **claims hook** is off on staging — the JWT carries no `member_role`, so RLS denies everything. See `docs/backend/auth-config.md` and issue #54.                                                                                 |

## Related

- `supabase/seed.sql` — the data itself, with the reasoning for each block
- `docs/backend/auth-config.md` — the auth settings staging needs by hand
- `docs/backend/inviting.md` — how real accounts are created
- Issue **#139** — the gap this closes · **#54** — the staging dashboard checklist
