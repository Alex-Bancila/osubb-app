# Legacy Task Tracker Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import 5 270 rows of OSUBB's Google Sheets Task Tracker into production once, as terminal Tasks dated on their completion day, with their Task Points, and then close the door.

**Architecture:** One migration adds a provenance registry (`public.legacy_task_imports`), lets the reserved `legacy_migration` Evaluation source through for registered Tasks only, and adds a service-role-only bulk command, `public.import_legacy_tasks`, that writes Task + Assignment + Evaluation + ledger row + activity directly with historical instants. A Node script feeds it the prepared import file in batches and reads the totals back. A second PR drops the command after the verified production run.

**Tech Stack:** PostgreSQL 17 (Supabase), plpgsql, pgTAP, Node 24 (`node:test`), PostgREST, React/vitest for one copy entry.

**Spec:** `docs/superpowers/specs/2026-10-13-legacy-task-import-design.md` — read it before any task.

## Global Constraints

- The import file `../osubb-legacy-import/import-set.json` holds Members' names. It is **never** copied into the repository, a test, a fixture, a PR, an issue or a log pasted anywhere. Tests use invented rows.
- Every instant the import writes is **the completion day at 12:00 Europe/Bucharest**; a deadline is the deadline day at 12:00 Europe/Bucharest, or the completion instant when the sheet has none.
- Points are `task_difficulty_levels.base_points × public.rating_mult(rating)`: bases 1, 2, 3, 4, 5, 6, 7, 8, 15, 20 for levels 1–10; multipliers −1, 0, 1, 2, 3 for ratings 1–5. Never clamped.
- Titles are 3–120 characters (`tasks_title_length_ck`); the constraint is not loosened.
- The acting Member is the **Moderator** (`profiles.role = 'moderator'`, `status = 'activ'`); nobody else may run the import.
- The command is executable by `service_role` only; at most 200 rows per call; the script sends 100.
- The import writes **no** Notification and **no** activity row with an actor.
- `private.evaluate_task`, `reopen_task`, the title limits and the promotion rules are not changed.
- House rules of `CLAUDE.md` bind every step: migrations only (`npx supabase migration new`), dated after the newest on `main`; RLS in the creating migration; `security definer` with `set search_path = ''` and fully-qualified names; tests in the same PR; `Closes #n`; conventions `docs/backend/conventions.md` §§1–4, 7, 8.
- This machine has **one** checkout and **one** Docker stack, shared with other sessions. Work in a git worktree (superpowers:using-git-worktrees) and make sure no other session is mid-`db reset` before running database commands.
- Issue numbers do not exist until Task 0. Below, `#1049` is the import issue and `#1050` the closing issue; replace both everywhere once they exist. The ruling is **R53** if `grep -rhoE "ruling R[0-9]+" docs CLAUDE.md | sort -V | tail -1` still answers `ruling R52`; otherwise the next free number.

## Review Focus

1. **A date the script cannot read** (`6.12.2025`, `12-03-2026`, an empty completion date): the script must stop before any call and name the row, never send a guessed date. Test in Task 4.
2. **A call that gets no answer** (dropped connection, statement timeout): re-running must complete the import without doubling a single row, and the script must say "no answer" rather than "refused". Tests in Tasks 2 and 4.
3. **A Member deactivated or a Group archived between the build and the run**: the whole batch is refused and the error names the offending row, so the operator can fix the file. Test in Task 2 (the `detail`).
4. **Daylight saving**: a row completed on 2026-03-29 (the clocks change that night) must still be dated 29 March in Bucharest. Test in Task 2.
5. **Diacritics**: `Ședință` and a note with `ș`/`ț`/`ă` must arrive byte-for-byte through JSON and PostgREST. Tests in Tasks 2 and 4.

---

## File Structure

| File                                                                                                                                                                        | Responsibility                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `supabase/migrations/<ts>_legacy_task_import.sql` (create)                                                                                                                  | registry table, trigger exception, the command, the totals read            |
| `supabase/tests/legacy_task_import.test.sql` (create)                                                                                                                       | every database rule of the spec                                            |
| `supabase/tests/live_changes.test.sql` (modify)                                                                                                                             | `legacy_task_imports` joins the excluded tables                            |
| `scripts/import-legacy-tasks.mjs` (create)                                                                                                                                  | file → command rows, batching, dry run, execute, read-back comparison      |
| `scripts/import-legacy-tasks.test.mjs` (create)                                                                                                                             | the script against an in-memory fake project                               |
| `scripts/legacy-import-rehearsal-fixture.mjs` (create)                                                                                                                      | SQL that provisions placeholder Members and Groups carrying the file's ids |
| `scripts/legacy-import-rehearsal.sh` (create)                                                                                                                               | local end-to-end rehearsal with the real file                              |
| `package.json` (modify)                                                                                                                                                     | `test:tooling` runs the new suite                                          |
| `app/src/lib/command-reasons.ts` + its test (modify)                                                                                                                        | Romanian copy for `evaluation_not_found`                                   |
| `app/src/lib/database.types.ts` (regenerate)                                                                                                                                | generated types                                                            |
| `docs/adr/0007-task-tracker-lifecycle.md`, `CONTEXT.md`, `docs/backend/conventions.md`, `docs/backend/legacy-task-import.md`, `docs/README.md`, `CLAUDE.md` (modify/create) | the documents the spec names                                               |
| `supabase/migrations/<ts>_legacy_task_import_closed.sql` (create, PR 2)                                                                                                     | drops the two functions                                                    |

---

### Task 0: Issues, branch, worktree

**Files:**

- Read: `docs/superpowers/plans/2026-10-14-legacy-task-import-issue-drafts.md`

- [ ] **Step 1: Get the go-ahead for the two issues.** The drafts are in the file above. GitHub-visible actions wait for one explicit go-ahead; do not create the issues before it.

- [ ] **Step 2: Create the issues in dependency order** (one command each, the import issue first):

```bash
gh issue create --repo Alex-Bancila/osubb-app --title "Legacy Task Tracker import: the one-time import command, script and tests" --body-file /tmp/issue-1049.md --label ready-for-agent
```

```bash
gh issue create --repo Alex-Bancila/osubb-app --title "Close the Legacy Import: drop the import command after the verified production run" --body-file /tmp/issue-1050.md --label ready-for-human
```

Write each body file from its draft first. Put the first issue's number into the second body's `## Blocked by` before creating it.

- [ ] **Step 3: Replace `#1049` and `#1050`** in this plan, in the spec and in the drafts file with the two numbers.

- [ ] **Step 4: Worktree and branch** from an up-to-date `main`:

```bash
git fetch origin && git worktree add ../osubb-app-legacy-import -b feat/1049-legacy-task-import origin/main
```

The spec, this plan and the drafts file are untracked in the main checkout. Copy the three files into the same paths of the worktree, then delete them from the main checkout so no other session commits them by accident.

- [ ] **Step 5: Commit the spec and plan** (in the worktree)

```bash
git add docs/superpowers/specs/2026-10-13-legacy-task-import-design.md docs/superpowers/plans/2026-10-14-legacy-task-import.md docs/superpowers/plans/2026-10-14-legacy-task-import-issue-drafts.md
git commit -m "docs(spec): the one-time Legacy Task Tracker import"
```

---

### Task 1: The registry and the closed source

**Files:**

- Create: `supabase/migrations/<ts>_legacy_task_import.sql`
- Create: `supabase/tests/legacy_task_import.test.sql`
- Modify: `supabase/tests/live_changes.test.sql:14-24`

**Interfaces:**

- Produces: table `public.legacy_task_imports (tracker_id text, sheet_row integer, sheet_id text, task_id bigint, imported_by uuid, created_at timestamptz)`, primary key `(tracker_id, sheet_row)`; trigger function `private.reject_legacy_evaluation_source()` that lets a `legacy_migration` Evaluation through only when `new.task_id` is registered.

- [ ] **Step 1: Create the migration file**

```bash
npx supabase migration new legacy_task_import
```

Check that its timestamp sorts after `ls supabase/migrations | tail -1` on `origin/main`.

- [ ] **Step 2: Write the failing tests** — create `supabase/tests/legacy_task_import.test.sql`. The fixture prefix is the issue number followed by zeros (`#1049` → `10490000`); it appears once, in `pg_temp.uli`.

```sql
-- legacy_task_import.test.sql -- #1049: the one-time Legacy Import (spec 2026-10-13, ruling R53).
--
-- public.legacy_task_imports, the legacy-source trigger's one exception,
-- public.import_legacy_tasks and public.legacy_task_import_totals.
--
-- Fixtures (owner, rolled back), ids 10490000-...-0000000000NN:
--   01 Moderator, activ      the acting Member
--   02 BC, activ             may not run the import
--   03 Moderator, inactiv    may not run it either
--   04 Voluntar, activ       Executor of the two base rows
--   05 Vot, activ            Executor of the other rows
--   06 Voluntar, inactiv     never an Executor
--   07 Voluntar, activ       crosses the Voluntar Activ threshold
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(8);

create function pg_temp.uli(n integer) returns uuid language sql immutable as $$
  select ('10490000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.gli(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;
grant execute on function pg_temp.uli(integer) to service_role, authenticated;
grant execute on function pg_temp.gli(text) to service_role, authenticated;

insert into auth.users (id, email)
select pg_temp.uli(n), 'li' || n || '@test.local' from generate_series(1, 7) as n;
insert into public.profiles (id, full_name, email, role, status, joined_at) values
  (pg_temp.uli(1), 'Moderator LI',         'li1@test.local', 'moderator', 'activ',   '2025-01-01'),
  (pg_temp.uli(2), 'BC LI',                'li2@test.local', 'bc',        'activ',   '2025-01-01'),
  (pg_temp.uli(3), 'Moderator inactiv LI', 'li3@test.local', 'moderator', 'inactiv', '2025-01-01'),
  (pg_temp.uli(4), 'Voluntar LI',          'li4@test.local', 'voluntar',  'activ',   '2025-01-01'),
  (pg_temp.uli(5), 'Vot LI',               'li5@test.local', 'vot',       'activ',   '2025-01-01'),
  (pg_temp.uli(6), 'Voluntar inactiv LI',  'li6@test.local', 'voluntar',  'inactiv', '2025-01-01'),
  (pg_temp.uli(7), 'Voluntar prag LI',     'li7@test.local', 'voluntar',  'activ',   '2025-01-01');
insert into public.groups (name, category, min_level) values ('Dept LI', 'department', 0);
insert into public.groups (name, category, min_level, status) values ('Arhivat LI', 'department', 0, 'archived');

-- An ordinary Task with an ended Assignment, for the closed-source probe.
insert into public.tasks (title, group_id, audience, assignment_mode, kind, status, created_by)
values ('Task obișnuit LI', pg_temp.gli('Dept LI'), 'local', 'direct', 'task', 'todo', pg_temp.uli(2));
insert into public.task_assignments (task_id, member_id, assigned_by)
select id, pg_temp.uli(4), pg_temp.uli(2) from public.tasks where title = 'Task obișnuit LI';

-- ==================== Schema ====================

select has_table('public', 'legacy_task_imports', 'the registry exists');
select col_is_pk('public', 'legacy_task_imports', array['tracker_id', 'sheet_row'],
  'a sheet row is identified by its tracker and row number');
select ok((select relrowsecurity from pg_class where oid = 'public.legacy_task_imports'::regclass),
  'the registry has RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.legacy_task_imports', 'select')
          and not has_table_privilege('anon', 'public.legacy_task_imports', 'select')
          and not has_table_privilege('service_role', 'public.legacy_task_imports', 'select')
          and not has_table_privilege('service_role', 'public.legacy_task_imports', 'insert'),
  'no role reads or writes the registry directly');
select throws_ok(
  $$insert into public.legacy_task_imports (tracker_id, sheet_row) values ('short', 2)$$,
  '23514', 'new row for relation "legacy_task_imports" violates check constraint "legacy_task_imports_tracker_id_ck"',
  'a tracker id is a Drive file id');
select throws_ok(
  $$insert into public.legacy_task_imports (tracker_id, sheet_row) values ('legacyImportTrackerLI0001', 1)$$,
  '23514', 'new row for relation "legacy_task_imports" violates check constraint "legacy_task_imports_sheet_row_ck"',
  'the header row is not a sheet row');

-- ==================== The closed source ====================

select throws_ok(
  $$insert into public.task_evaluations (task_id, assignment_id, source, evaluated_by, outcome, difficulty, rating, points, note)
    select task.id, assignment.id, 'legacy_migration', null, 'completed', 3, 5, 9, 'fără registru'
      from public.tasks as task join public.task_assignments as assignment on assignment.task_id = task.id
     where task.title = 'Task obișnuit LI'$$,
  '23514', 'task_evaluation_legacy_source_closed',
  'a legacy_migration Evaluation for a Task outside the registry is still refused');

-- Registers the ordinary Task, inserts its legacy Evaluation, and rolls both
-- back by raising inside its own block: true means the insert got through.
-- Rolled back so that the probe never counts in the totals asserted later.
create function pg_temp.registered_probe_li() returns boolean language plpgsql as $$
begin
  insert into public.legacy_task_imports (tracker_id, sheet_row, task_id)
  select 'legacyImportTrackerLI0002', 2, id from public.tasks where title = 'Task obișnuit LI';
  insert into public.task_evaluations (task_id, assignment_id, source, evaluated_by, outcome, difficulty, rating, points, note)
  select task.id, assignment.id, 'legacy_migration', null, 'completed', 3, 5, 9, 'cu registru'
    from public.tasks as task join public.task_assignments as assignment on assignment.task_id = task.id
   where task.title = 'Task obișnuit LI';
  raise exception 'probe' using errcode = 'LI001';
exception when sqlstate 'LI001' then
  return true;
end;
$$;
select ok(pg_temp.registered_probe_li(),
  'a registered Task accepts its legacy_migration Evaluation');

select * from finish();
rollback;
```

Both `throws_ok` on the registry's own CHECKs name their constraint (Ruling 23), and `('short', 2)` can only fail `legacy_task_imports_tracker_id_ck`: Postgres evaluates CHECKs in name order and the two that sort before it pass.

- [ ] **Step 3: Run it and watch it fail**

Run: `npx supabase db reset && npx supabase test db supabase/tests/legacy_task_import.test.sql`
Expected: FAIL — `relation "public.legacy_task_imports" does not exist`.

- [ ] **Step 4: Write the migration's first two sections**

```sql
-- #1049: the one-time Legacy Import of the Google Sheets Task Tracker (spec 2026-10-13, ruling R53)
--
-- OSUBB's pre-app points system is imported once, as real Tasks dated on the
-- day the work was completed. This file adds:
--
-- 1. public.legacy_task_imports: which sheet row became which Task. It is the
--    import's idempotency key (a re-run skips a registered row) and the only
--    thing the legacy-source trigger accepts.
-- 2. private.reject_legacy_evaluation_source: #317 closed the reserved
--    `legacy_migration` Evaluation source for good and said a later backfill
--    would disable the trigger "deliberately". This one does not disable it:
--    the trigger now lets the source through for a registered Task only, so
--    nothing else can ever write it and no window opens.
-- 3. public.import_legacy_tasks: the bulk command, service role only.
-- 4. public.legacy_task_import_totals: the read the import script compares
--    its file with.
--
-- 3 and 4 are dropped by #1050 once the production run is verified. The
-- registry stays as provenance.

-- ---------------------------------------------------------------------------
-- 1. The registry
-- ---------------------------------------------------------------------------
create table public.legacy_task_imports (
  tracker_id  text    not null,
  sheet_row   integer not null,
  sheet_id    text,
  task_id     bigint  references public.tasks (id) on delete set null,
  imported_by uuid    references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint legacy_task_imports_pkey primary key (tracker_id, sheet_row),
  constraint legacy_task_imports_task_id_key unique (task_id),
  constraint legacy_task_imports_tracker_id_ck check (tracker_id ~ '^[A-Za-z0-9_-]{20,80}$'),
  constraint legacy_task_imports_sheet_row_ck check (sheet_row between 2 and 100000),
  constraint legacy_task_imports_sheet_id_ck check (sheet_id is null or char_length(sheet_id) between 1 and 40)
);

alter table public.legacy_task_imports enable row level security;
revoke all on table public.legacy_task_imports from public, anon, authenticated, service_role;

comment on table public.legacy_task_imports is
  '#1049: one row per row of a legacy Google Sheets Task Tracker that the Legacy Import turned into a Task -- the Drive file id of the tracker, the row number in its Tasks tab (header = 1), the sheet''s own Id (not unique there) and the Task. A Task later deleted for good keeps its row with task_id null, so the key stays claimed and a later call still skips the row. RLS on with no policy and no grant to any role: public.import_legacy_tasks writes it and public.legacy_task_import_totals reads it, both as definer. Excluded from the live change broadcast.';

-- ---------------------------------------------------------------------------
-- 2. The legacy source, closed except for a registered Task
-- ---------------------------------------------------------------------------
create or replace function private.reject_legacy_evaluation_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1
               from public.legacy_task_imports as imported
              where imported.task_id = new.task_id) then
    return new;
  end if;
  raise exception using
    errcode = '23514',
    message = 'task_evaluation_legacy_source_closed';
end;
$$;

revoke all on function private.reject_legacy_evaluation_source()
  from public, anon, authenticated, service_role;

comment on function private.reject_legacy_evaluation_source() is
  '#317, #1049: BEFORE INSERT on public.task_evaluations for source = legacy_migration. Refuses with 23514 task_evaluation_legacy_source_closed unless the Task is registered in public.legacy_task_imports, which only the Legacy Import writes. Definer because the registry is readable by no role.';
```

- [ ] **Step 5: Exclude the registry from the live broadcast** — in `supabase/tests/live_changes.test.sql`, `pg_temp.excluded_tables()` ends with `'member_imports'];`. Change that line to:

```sql
               'member_imports', 'legacy_task_imports'];
```

- [ ] **Step 6: Run and pass**

Run: `npx supabase db reset && npx supabase test db supabase/tests/legacy_task_import.test.sql supabase/tests/live_changes.test.sql supabase/tests/conventions.test.sql`
Expected: PASS, 8 assertions in the new suite; the other two unchanged.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations supabase/tests/legacy_task_import.test.sql supabase/tests/live_changes.test.sql
git commit -m "feat(db): the Legacy Import registry and the legacy source's one exception (#1049)"
```

---

### Task 2: The import command

**Files:**

- Modify: `supabase/migrations/<ts>_legacy_task_import.sql` (append section 3)
- Modify: `supabase/tests/legacy_task_import.test.sql`

**Interfaces:**

- Consumes: `public.legacy_task_imports`, the trigger exception (Task 1).
- Produces: `public.import_legacy_tasks(p_actor uuid, p_rows jsonb, p_dry_run boolean default false) returns jsonb`.
  One element of `p_rows`: `{"tracker_id": text, "sheet_row": int, "sheet_id": text|null, "group_id": int, "executor_id": uuid, "title": text, "description": text|null, "difficulty": 1..10, "rating": 1..5, "outcome": "completed"|"unfulfilled", "completed_on": "YYYY-MM-DD", "deadline_on": "YYYY-MM-DD"|null, "note": text}`.
  Returns `{"received": int, "imported": int, "already_imported": int, "points": int, "dry_run": bool}`.

- [ ] **Step 1: Add the fixtures and helpers the command's tests need** — in the suite, directly after the `Task obișnuit LI` inserts:

```sql
-- One command row; p_overrides replaces any key.
create function pg_temp.rli(p_sheet_row integer, p_overrides jsonb default '{}'::jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tracker_id',   'legacyImportTrackerLI0001',
    'sheet_row',    p_sheet_row,
    'sheet_id',     '9-9-' || p_sheet_row,
    'group_id',     (select id from public.groups where name = 'Dept LI'),
    'executor_id',  pg_temp.uli(4),
    'title',        'Sarcină importată',
    'description',  null,
    'difficulty',   3,
    'rating',       5,
    'outcome',      'completed',
    'completed_on', '2026-03-10',
    'deadline_on',  '2026-03-12',
    'note',         'Observație din foaie: ședință') || p_overrides
$$;
-- The Task a sheet row became.
create function pg_temp.tli(p_sheet_row integer) returns bigint
language sql stable security definer set search_path = '' as $$
  select task_id from public.legacy_task_imports
   where tracker_id = 'legacyImportTrackerLI0001' and sheet_row = p_sheet_row
$$;
-- The DETAIL of the error a statement raises (null when it raises none).
create function pg_temp.detail_li(p_sql text) returns text language plpgsql as $$
declare
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;
-- Noon in Bucharest on a day: the import's only instant.
create function pg_temp.noon(p_day date) returns timestamptz language sql immutable as $$
  select (p_day::timestamp + interval '12 hours') at time zone 'Europe/Bucharest'
$$;
grant execute on function pg_temp.rli(integer, jsonb) to service_role, authenticated;
grant execute on function pg_temp.tli(integer) to service_role, authenticated;
grant execute on function pg_temp.detail_li(text) to service_role, authenticated;
grant execute on function pg_temp.noon(date) to service_role, authenticated;

create temp table rli (name text primary key, result jsonb);
grant all on rli to service_role;

update public.promotion_thresholds set threshold = 30 where kind = 'voluntar_activ';
update public.promotion_rules set enabled = true where kind = 'top_percent';
```

- [ ] **Step 2: Write the failing tests for the surface, the malformed input and the gate** — replace `select plan(8);` with `select plan(41);` and insert this block before `select * from finish();`:

```sql
-- ==================== The command: surface ====================

select ok(has_function_privilege('service_role', 'public.import_legacy_tasks(uuid, jsonb, boolean)', 'execute')
          and not has_function_privilege('authenticated', 'public.import_legacy_tasks(uuid, jsonb, boolean)', 'execute')
          and not has_function_privilege('anon', 'public.import_legacy_tasks(uuid, jsonb, boolean)', 'execute'),
  'the import is service role only');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
            where oid = 'public.import_legacy_tasks(uuid, jsonb, boolean)'::regprocedure),
  'the import is a definer with an empty search_path');

-- ==================== Step 1: malformed, before the gate ====================

set local role service_role;

select throws_ok(format($$select public.import_legacy_tasks(null, %L::jsonb)$$, jsonb_build_array(pg_temp.rli(10))),
  'PT400', 'invalid_actor', 'no acting Member is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, '{}'::jsonb)$$, pg_temp.uli(1)),
  'PT400', 'invalid_rows', 'rows that are not an array are malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, '[]'::jsonb)$$, pg_temp.uli(1)),
  'PT400', 'invalid_rows', 'no rows at all is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    (select jsonb_agg(pg_temp.rli(n)) from generate_series(2, 202) as n)),
  'PT400', 'too_many_rows', 'more than 200 rows in one call is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"tracker_id": "scurt"}'))),
  'PT400', 'invalid_tracker_id', 'a tracker id that is no Drive file id is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(1))),
  'PT400', 'invalid_sheet_row', 'the header row is not a sheet row');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"title": "  "}'))),
  'PT400', 'title_required', 'a blank title is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"title": "PV"}'))),
  'PT400', 'title_too_short', 'a two-character title is refused: the limit is not loosened');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, jsonb_build_object('title', repeat('a', 121))))),
  'PT400', 'title_too_long', 'a title above 120 characters is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"group_id": null}'))),
  'PT400', 'task_group_required', 'a row naming no Group is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"executor_id": "cineva"}'))),
  'PT400', 'invalid_executor', 'an Executor that is no uuid is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"difficulty": 11}'))),
  'PT400', 'invalid_difficulty', 'a Difficulty that is no level is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"rating": 6}'))),
  'PT400', 'invalid_rating', 'a Rating outside 1-5 is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"outcome": "cancelled"}'))),
  'PT400', 'invalid_outcome', 'an outcome that is neither completed nor unfulfilled is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"completed_on": "2026-02-30"}'))),
  'PT400', 'invalid_completed_on', 'a completion date that does not exist is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, jsonb_build_object('completed_on',
      to_char((now() at time zone 'Europe/Bucharest')::date + 1, 'YYYY-MM-DD'))))),
  'PT400', 'invalid_completed_on', 'a completion date after today is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"deadline_on": "12/03/2026"}'))),
  'PT400', 'invalid_deadline', 'a deadline that is no ISO date is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"note": " "}'))),
  'PT400', 'evaluation_note_required', 'a blank Evaluation note is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, jsonb_build_object('note', repeat('n', 1001))))),
  'PT400', 'note_too_long', 'an Evaluation note above 1000 characters is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10), pg_temp.rli(10))),
  'PT400', 'duplicate_row', 'the same sheet row twice in one call is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(2),
    jsonb_build_array(pg_temp.rli(10, '{"rating": 6}'))),
  'PT400', 'invalid_rating', 'malformed input is judged before the gate');

-- ==================== Step 2: the gate ====================

select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(2),
    jsonb_build_array(pg_temp.rli(10))),
  '42501', 'legacy_import_forbidden', 'a BC member cannot run the import');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(3),
    jsonb_build_array(pg_temp.rli(10))),
  '42501', 'legacy_import_forbidden', 'an inactive Moderator cannot run the import');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(99),
    jsonb_build_array(pg_temp.rli(10))),
  '42501', 'legacy_import_forbidden', 'an unknown actor cannot run the import');

-- ==================== Step 3: against the loaded rows ====================

select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, jsonb_build_object('executor_id', pg_temp.uli(6))))),
  'PT400', 'invalid_executor', 'an inactive Member is no Executor');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"group_id": 987654321}'))),
  'PT400', 'invalid_origin', 'an unknown Group is refused');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, jsonb_build_object('group_id', pg_temp.gli('Arhivat LI'))))),
  'PT409', 'group_archived', 'an archived Group is refused');
select is(
  pg_temp.detail_li(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10), pg_temp.rli(11, jsonb_build_object('executor_id', pg_temp.uli(6)))))),
  'row 2 (legacyImportTrackerLI0001, sheet row 11)',
  'a refusal names the offending row');

reset role;
select is((select count(*) from public.legacy_task_imports where sheet_row in (10, 11)), 0::bigint,
  'one invalid row fails the whole call: the valid row beside it was not written');
set local role service_role;

-- ==================== A dry run ====================

insert into rli select 'dry', public.import_legacy_tasks(pg_temp.uli(1),
  jsonb_build_array(pg_temp.rli(10), pg_temp.rli(11, jsonb_build_object(
    'executor_id', pg_temp.uli(5), 'difficulty', 2, 'rating', 1, 'outcome', 'unfulfilled',
    'completed_on', '2026-04-02', 'deadline_on', null, 'note', 'Nu a livrat'))), true);
select is((select result from rli where name = 'dry'),
  '{"received": 2, "imported": 2, "already_imported": 0, "points": 7, "dry_run": true}'::jsonb,
  'a dry run reports what the real run would import');
reset role;
select is((select count(*) from public.legacy_task_imports where sheet_row in (10, 11)), 0::bigint,
  'a dry run writes nothing');
```

- [ ] **Step 3: Run and watch them fail**

Run: `npx supabase db reset && npx supabase test db supabase/tests/legacy_task_import.test.sql`
Expected: FAIL — `function public.import_legacy_tasks(uuid, jsonb, boolean) does not exist`.

- [ ] **Step 4: Append section 3 to the migration**

```sql
-- ---------------------------------------------------------------------------
-- 3. The import command
-- ---------------------------------------------------------------------------
create function public.import_legacy_tasks(p_actor uuid, p_rows jsonb, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_today       date := (now() at time zone 'Europe/Bucharest')::date;
  v_item        jsonb;
  v_index       integer;
  v_where       text;
  v_text        text;
  v_date        date;
  v_received    integer;
  v_imported    integer := 0;
  v_already     integer := 0;
  v_points      integer := 0;
  v_row         record;
  v_at          timestamptz;
  v_deadline    timestamptz;
  v_award       integer;
  v_task_id     bigint;
  v_assignment  bigint;
  v_evaluation  bigint;
  v_members     uuid[]        := '{}';
  v_deltas      integer[]     := '{}';
  v_tasks       bigint[]      := '{}';
  v_evaluations bigint[]      := '{}';
  v_instants    timestamptz[] := '{}';
begin
  -- 1. Malformed for every caller (conventions section 2). Each refusal names
  --    the row in DETAIL: the operator has a file of thousands to fix.
  if p_actor is null then
    raise sqlstate 'PT400' using message = 'invalid_actor';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise sqlstate 'PT400' using message = 'invalid_rows';
  end if;
  v_received := jsonb_array_length(p_rows);
  if v_received > 200 then
    raise sqlstate 'PT400' using message = 'too_many_rows';
  end if;

  for v_item, v_index in
    select entry.value, entry.ordinality::integer
      from jsonb_array_elements(p_rows) with ordinality as entry
     order by entry.ordinality
  loop
    v_where := 'row ' || v_index;
    if jsonb_typeof(v_item) <> 'object' then
      raise sqlstate 'PT400' using message = 'invalid_rows', detail = v_where;
    end if;
    if coalesce(v_item ->> 'tracker_id', '') !~ '^[A-Za-z0-9_-]{20,80}$' then
      raise sqlstate 'PT400' using message = 'invalid_tracker_id', detail = v_where;
    end if;
    if coalesce(v_item ->> 'sheet_row', '') !~ '^[0-9]{1,6}$'
       or (v_item ->> 'sheet_row')::integer not between 2 and 100000 then
      raise sqlstate 'PT400' using message = 'invalid_sheet_row', detail = v_where;
    end if;
    v_where := format('row %s (%s, sheet row %s)', v_index, v_item ->> 'tracker_id', v_item ->> 'sheet_row');
    if char_length(coalesce(v_item ->> 'sheet_id', '')) > 40 then
      raise sqlstate 'PT400' using message = 'invalid_sheet_id', detail = v_where;
    end if;

    v_text := regexp_replace(coalesce(v_item ->> 'title', ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
    if v_text = '' then
      raise sqlstate 'PT400' using message = 'title_required', detail = v_where;
    end if;
    if char_length(v_text) < 3 then
      raise sqlstate 'PT400' using message = 'title_too_short', detail = v_where;
    end if;
    if char_length(v_text) > 120 then
      raise sqlstate 'PT400' using message = 'title_too_long', detail = v_where;
    end if;
    if char_length(regexp_replace(coalesce(v_item ->> 'description', ''), '^[[:space:]]+|[[:space:]]+$', '', 'g')) > 2000 then
      raise sqlstate 'PT400' using message = 'description_too_long', detail = v_where;
    end if;

    if v_item ->> 'group_id' is null then
      raise sqlstate 'PT400' using message = 'task_group_required', detail = v_where;
    end if;
    if v_item ->> 'group_id' !~ '^[1-9][0-9]{0,17}$' then
      raise sqlstate 'PT400' using message = 'invalid_origin', detail = v_where;
    end if;
    if coalesce(v_item ->> 'executor_id', '')
         !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise sqlstate 'PT400' using message = 'invalid_executor', detail = v_where;
    end if;
    if coalesce(v_item ->> 'difficulty', '') !~ '^[0-9]{1,2}$'
       or not exists (select 1 from public.task_difficulty_levels as level
                       where level.level = (v_item ->> 'difficulty')::integer) then
      raise sqlstate 'PT400' using message = 'invalid_difficulty', detail = v_where;
    end if;
    if coalesce(v_item ->> 'rating', '') !~ '^[1-5]$' then
      raise sqlstate 'PT400' using message = 'invalid_rating', detail = v_where;
    end if;
    if coalesce(v_item ->> 'outcome', '') not in ('completed', 'unfulfilled') then
      raise sqlstate 'PT400' using message = 'invalid_outcome', detail = v_where;
    end if;

    if coalesce(v_item ->> 'completed_on', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise sqlstate 'PT400' using message = 'invalid_completed_on', detail = v_where;
    end if;
    begin
      v_date := (v_item ->> 'completed_on')::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise sqlstate 'PT400' using message = 'invalid_completed_on', detail = v_where;
    end;
    if v_date > v_today then
      raise sqlstate 'PT400' using message = 'invalid_completed_on', detail = v_where;
    end if;
    if v_item ->> 'deadline_on' is not null then
      if v_item ->> 'deadline_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise sqlstate 'PT400' using message = 'invalid_deadline', detail = v_where;
      end if;
      begin
        v_date := (v_item ->> 'deadline_on')::date;
      exception when datetime_field_overflow or invalid_datetime_format then
        raise sqlstate 'PT400' using message = 'invalid_deadline', detail = v_where;
      end;
    end if;

    v_text := regexp_replace(coalesce(v_item ->> 'note', ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
    if v_text = '' then
      raise sqlstate 'PT400' using message = 'evaluation_note_required', detail = v_where;
    end if;
    if char_length(v_text) > 1000 then
      raise sqlstate 'PT400' using message = 'note_too_long', detail = v_where;
    end if;
  end loop;

  if (select count(*) <> count(distinct (entry.value ->> 'tracker_id', entry.value ->> 'sheet_row'))
        from jsonb_array_elements(p_rows) as entry) then
    raise sqlstate 'PT400' using message = 'duplicate_row';
  end if;

  -- 2. The gate: a live activ Moderator, held FOR SHARE so a concurrent
  --    removal of the seat waits for this call.
  perform 1
     from public.profiles as actor
    where actor.id = p_actor
      and actor.status = 'activ'
      and actor.role = 'moderator'
      for share of actor;
  if not found then
    raise exception using errcode = '42501', message = 'legacy_import_forbidden';
  end if;

  -- One import at a time: two runs can never interleave their registry reads
  -- and writes. Released at commit or rollback.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('osubb.legacy_task_import', 0));

  -- 3. Against the loaded rows, each locked FOR SHARE in id order so a
  --    concurrent deactivation or archive waits instead of landing underneath.
  perform 1
     from public.profiles as executor
    where executor.id in (select (entry.value ->> 'executor_id')::uuid
                            from jsonb_array_elements(p_rows) as entry)
    order by executor.id
      for share of executor;
  select format('row %s (%s, sheet row %s)', entry.ordinality, entry.value ->> 'tracker_id', entry.value ->> 'sheet_row')
    into v_where
    from jsonb_array_elements(p_rows) with ordinality as entry
   where not exists (select 1 from public.profiles as executor
                      where executor.id = (entry.value ->> 'executor_id')::uuid
                        and executor.status = 'activ')
   order by entry.ordinality
   limit 1;
  if found then
    raise sqlstate 'PT400' using message = 'invalid_executor', detail = v_where;
  end if;

  perform 1
     from public.groups as origin
    where origin.id in (select (entry.value ->> 'group_id')::bigint
                          from jsonb_array_elements(p_rows) as entry)
    order by origin.id
      for share of origin;
  select format('row %s (%s, sheet row %s)', entry.ordinality, entry.value ->> 'tracker_id', entry.value ->> 'sheet_row')
    into v_where
    from jsonb_array_elements(p_rows) with ordinality as entry
   where not exists (select 1 from public.groups as origin
                      where origin.id = (entry.value ->> 'group_id')::bigint)
   order by entry.ordinality
   limit 1;
  if found then
    raise sqlstate 'PT400' using message = 'invalid_origin', detail = v_where;
  end if;
  select format('row %s (%s, sheet row %s)', entry.ordinality, entry.value ->> 'tracker_id', entry.value ->> 'sheet_row')
    into v_where
    from jsonb_array_elements(p_rows) with ordinality as entry
    join public.groups as origin on origin.id = (entry.value ->> 'group_id')::bigint
   where origin.status <> 'active'
   order by entry.ordinality
   limit 1;
  if found then
    raise sqlstate 'PT409' using message = 'group_archived', detail = v_where;
  end if;

  -- 4 and 5. Row by row, in file order: skip what is registered, write the rest.
  for v_row in
    select entry.value ->> 'tracker_id'             as tracker_id,
           (entry.value ->> 'sheet_row')::integer   as sheet_row,
           nullif(entry.value ->> 'sheet_id', '')   as sheet_id,
           (entry.value ->> 'group_id')::bigint     as group_id,
           (entry.value ->> 'executor_id')::uuid    as executor_id,
           regexp_replace(entry.value ->> 'title', '^[[:space:]]+|[[:space:]]+$', '', 'g') as title,
           nullif(regexp_replace(coalesce(entry.value ->> 'description', ''),
                                 '^[[:space:]]+|[[:space:]]+$', '', 'g'), '') as description,
           (entry.value ->> 'difficulty')::integer  as difficulty,
           (entry.value ->> 'rating')::integer      as rating,
           entry.value ->> 'outcome'                as outcome,
           (entry.value ->> 'completed_on')::date   as completed_on,
           (entry.value ->> 'deadline_on')::date    as deadline_on,
           regexp_replace(entry.value ->> 'note', '^[[:space:]]+|[[:space:]]+$', '', 'g') as note
      from jsonb_array_elements(p_rows) with ordinality as entry
     order by entry.ordinality
  loop
    if exists (select 1 from public.legacy_task_imports as imported
                where imported.tracker_id = v_row.tracker_id
                  and imported.sheet_row = v_row.sheet_row) then
      v_already := v_already + 1;
      continue;
    end if;

    -- ADR-0007's scoring guide, the same expression private.evaluate_task
    -- uses: the level's base points times rating_mult. Never clamped.
    select level.base_points * public.rating_mult(v_row.rating) into v_award
      from public.task_difficulty_levels as level
     where level.level = v_row.difficulty;
    v_imported := v_imported + 1;
    v_points := v_points + v_award;
    if p_dry_run then
      continue;
    end if;

    -- The one instant of a row: noon in Bucharest on its completion day, so
    -- the day is the same in every read on either side of a clock change.
    v_at := (v_row.completed_on::timestamp + interval '12 hours') at time zone 'Europe/Bucharest';
    -- The Work Filter ranges on the deadline; a Task without one would never
    -- be found by date.
    v_deadline := coalesce((v_row.deadline_on::timestamp + interval '12 hours') at time zone 'Europe/Bucharest', v_at);

    insert into public.tasks
      (title, description, deadline, group_id, audience, assignment_mode, kind, status,
       difficulty, rating, created_by, created_at, completed_at, unfulfilled_at)
    values (v_row.title, v_row.description, v_deadline, v_row.group_id, 'local', 'direct', 'task',
            v_row.outcome::public.task_status, v_row.difficulty, v_row.rating, p_actor, v_at,
            case when v_row.outcome = 'completed' then v_at end,
            case when v_row.outcome = 'unfulfilled' then v_at end)
    returning id into v_task_id;

    -- Before the Evaluation: the legacy-source trigger reads this row.
    insert into public.legacy_task_imports (tracker_id, sheet_row, sheet_id, task_id, imported_by)
    values (v_row.tracker_id, v_row.sheet_row, v_row.sheet_id, v_task_id, p_actor);

    insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at, ended_at, end_reason)
    values (v_task_id, v_row.executor_id, p_actor, v_at, v_at,
            case v_row.outcome when 'completed' then 'completed' else 'failed' end)
    returning id into v_assignment;

    insert into public.task_evaluations
      (task_id, assignment_id, source, evaluated_by, outcome, difficulty, rating, points, note, evaluated_at)
    values (v_task_id, v_assignment, 'legacy_migration', null, v_row.outcome,
            v_row.difficulty, v_row.rating, v_award, v_row.note, v_at)
    returning id into v_evaluation;

    -- The trail create_completed_task leaves, with no actor: the task_create
    -- daily cap counts a Member's `created` rows of the last 24 hours, and
    -- thousands of them would lock the Moderator out of creating Tasks.
    insert into public.task_activity
      (task_id, kind, actor_id, assignment_id, from_status, to_status, note, details, occurred_at)
    values
      (v_task_id, 'created', null::uuid, null::bigint, null::public.task_status, 'todo'::public.task_status, null::text,
       jsonb_build_object('kind', 'task', 'audience', 'local', 'assignment_mode', 'direct',
                          'campaign_id', null, 'executor_id', v_row.executor_id,
                          'completed_task', true, 'legacy_import', true), v_at),
      (v_task_id, 'executor_assigned', null, v_assignment, null, null, null,
       jsonb_build_object('via', 'completed_task', 'member_id', v_row.executor_id), v_at),
      (v_task_id, case v_row.outcome when 'completed' then 'evaluated' else 'unfulfilled' end,
       null, v_assignment, 'todo'::public.task_status, v_row.outcome::public.task_status, v_row.note,
       jsonb_build_object('evaluation_id', v_evaluation, 'difficulty', v_row.difficulty,
                          'rating', v_row.rating, 'points', v_award), v_at);

    v_members     := v_members || v_row.executor_id;
    v_deltas      := v_deltas || v_award;
    v_tasks       := v_tasks || v_task_id;
    v_evaluations := v_evaluations || v_evaluation;
    v_instants    := v_instants || v_at;
  end loop;

  -- One statement for the whole call: points_ledger_refresh_promotion_candidates
  -- is a statement-level trigger, so the candidate refresh runs once per call.
  if cardinality(v_members) > 0 then
    insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id, created_at)
    select entry.member_id, entry.delta, 'task', entry.task_id, entry.evaluation_id, entry.created_at
      from unnest(v_members, v_deltas, v_tasks, v_evaluations, v_instants)
           as entry (member_id, delta, task_id, evaluation_id, created_at);
  end if;

  return jsonb_build_object(
    'received', v_received,
    'imported', v_imported,
    'already_imported', v_already,
    'points', v_points,
    'dry_run', p_dry_run);
end;
$function$;

revoke execute on function public.import_legacy_tasks(uuid, jsonb, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.import_legacy_tasks(uuid, jsonb, boolean) to service_role;

comment on function public.import_legacy_tasks(uuid, jsonb, boolean) is
  '#1049 (spec 2026-10-13, ruling R53): the one-time Legacy Import -- up to 200 rows of the legacy Google Sheets Task Tracker per call, each written as a terminal Task with its Assignment, a legacy_migration Evaluation (evaluated_by null), its Task Points ledger row and the three activity rows of create_completed_task, all dated at 12:00 Europe/Bucharest on the completion day; the deadline is the sheet''s day at that hour, else the completion instant. Points are the level''s base points times rating_mult, as in private.evaluate_task; this is the second and last writer of Task Points. Step 1, malformed for everyone, each with the row in DETAIL: PT400 invalid_actor, invalid_rows, too_many_rows, invalid_tracker_id, invalid_sheet_row, invalid_sheet_id, title_required, title_too_short, title_too_long, description_too_long, task_group_required, invalid_origin, invalid_executor, invalid_difficulty, invalid_rating, invalid_outcome, invalid_completed_on (not a date, or after today in Bucharest), invalid_deadline, evaluation_note_required, note_too_long, duplicate_row. Step 2: 42501 legacy_import_forbidden unless p_actor is a live activ Moderator. Step 3: PT400 invalid_executor (not a live activ Member), PT400 invalid_origin (unknown Group), PT409 group_archived. A row whose (tracker_id, sheet_row) is already in public.legacy_task_imports is skipped and counted, so a re-run completes an interrupted import and never doubles it. No Notification, no daily cap, no activity actor; BC, the Moderator and Members below the Group''s Minimum Level are credited like anyone (the Evaluation was made in the sheet). p_dry_run does everything but write. One invalid row fails the whole call. Service role only, like import_member (#991); dropped by #1050 after the verified production run.';
```

- [ ] **Step 5: Run and pass**

Run: `npx supabase db reset && npx supabase test db supabase/tests/legacy_task_import.test.sql`
Expected: PASS, 41 assertions.

- [ ] **Step 6: Write the failing tests for what a row becomes** — change `select plan(41);` to `select plan(60);` and append before `select * from finish();`:

```sql
-- ==================== Two rows, imported ====================

set local role service_role;
insert into rli select 'first', public.import_legacy_tasks(pg_temp.uli(1),
  jsonb_build_array(pg_temp.rli(10), pg_temp.rli(11, jsonb_build_object(
    'executor_id', pg_temp.uli(5), 'title', '  Ședință ratată  ', 'difficulty', 2, 'rating', 1,
    'outcome', 'unfulfilled', 'completed_on', '2026-04-02', 'deadline_on', null, 'note', 'Nu a livrat'))));
select is((select result from rli where name = 'first'),
  '{"received": 2, "imported": 2, "already_imported": 0, "points": 7, "dry_run": false}'::jsonb,
  'the real run reports what it imported');
reset role;

select results_eq(
  $$select task.title, task.status::text, task.difficulty, task.rating, task.created_by, task.created_at,
           task.completed_at, task.unfulfilled_at, task.deadline, task.audience, task.assignment_mode,
           task.kind, task.group_id, task.description
      from public.tasks as task where task.id = pg_temp.tli(10)$$,
  $$values ('Sarcină importată', 'completed', 3, 5, pg_temp.uli(1), pg_temp.noon('2026-03-10'),
            pg_temp.noon('2026-03-10'), null::timestamptz, pg_temp.noon('2026-03-12'), 'local', 'direct',
            'task', pg_temp.gli('Dept LI'), null::text)$$,
  'a completed row is a completed Task dated on its completion day, created by the acting Member');
select results_eq(
  $$select task.title, task.status::text, task.completed_at, task.unfulfilled_at, task.deadline
      from public.tasks as task where task.id = pg_temp.tli(11)$$,
  $$values ('Ședință ratată', 'unfulfilled', null::timestamptz, pg_temp.noon('2026-04-02'), pg_temp.noon('2026-04-02'))$$,
  'an unfulfilled row is an unfulfilled Task; with no deadline in the sheet, the deadline is the completion instant');
select results_eq(
  $$select assignment.member_id, assignment.assigned_by, assignment.assigned_at, assignment.ended_at, assignment.end_reason
      from public.task_assignments as assignment
     where assignment.task_id in (pg_temp.tli(10), pg_temp.tli(11)) order by assignment.task_id$$,
  $$values (pg_temp.uli(4), pg_temp.uli(1), pg_temp.noon('2026-03-10'), pg_temp.noon('2026-03-10'), 'completed'),
           (pg_temp.uli(5), pg_temp.uli(1), pg_temp.noon('2026-04-02'), pg_temp.noon('2026-04-02'), 'failed')$$,
  'each row has one ended Assignment of its Executor, dated like the Task');
select results_eq(
  $$select evaluation.source, evaluation.evaluated_by, evaluation.outcome, evaluation.difficulty, evaluation.rating,
           evaluation.points, evaluation.note, evaluation.evaluated_at, evaluation.created_at = now()
      from public.task_evaluations as evaluation
     where evaluation.task_id in (pg_temp.tli(10), pg_temp.tli(11)) order by evaluation.task_id$$,
  $$values ('legacy_migration', null::uuid, 'completed', 3, 5, 9, 'Observație din foaie: ședință', pg_temp.noon('2026-03-10'), true),
           ('legacy_migration', null::uuid, 'unfulfilled', 2, 1, -2, 'Nu a livrat', pg_temp.noon('2026-04-02'), true)$$,
  'each Evaluation is a legacy_migration one with no evaluator, evaluated on the completion day, written now');
select results_eq(
  $$select entry.member_id, entry.delta, entry.reason, entry.created_at, entry.evaluation_id is not null
      from public.points_ledger as entry
     where entry.task_id in (pg_temp.tli(10), pg_temp.tli(11)) order by entry.task_id$$,
  $$values (pg_temp.uli(4), 9, 'task', pg_temp.noon('2026-03-10'), true),
           (pg_temp.uli(5), -2, 'task', pg_temp.noon('2026-04-02'), true)$$,
  'each row pays its points once, negative included, dated on the completion day');
select results_eq(
  $$select activity.kind, activity.actor_id, activity.occurred_at, activity.to_status::text
      from public.task_activity as activity where activity.task_id = pg_temp.tli(11) order by activity.id$$,
  $$values ('created', null::uuid, pg_temp.noon('2026-04-02'), 'todo'),
           ('executor_assigned', null::uuid, pg_temp.noon('2026-04-02'), null::text),
           ('unfulfilled', null::uuid, pg_temp.noon('2026-04-02'), 'unfulfilled')$$,
  'the Task history is the trail of a finished Task added directly, with no actor');
select is((select count(*) from public.task_activity where actor_id = pg_temp.uli(1)), 0::bigint,
  'no activity row names the acting Member, so their task_create cap is untouched');
select is((select count(*) from public.notifications where member_id in (pg_temp.uli(4), pg_temp.uli(5))), 0::bigint,
  'the import notifies no Executor');
select results_eq(
  $$select registry.sheet_row, registry.sheet_id, registry.imported_by, registry.task_id is not null
      from public.legacy_task_imports as registry where registry.sheet_row in (10, 11) order by 1$$,
  $$values (10, '9-9-10', pg_temp.uli(1), true), (11, '9-9-11', pg_temp.uli(1), true)$$,
  'the registry remembers which sheet row became which Task');

-- ==================== A re-run ====================

set local role service_role;
insert into rli select 'again', public.import_legacy_tasks(pg_temp.uli(1),
  jsonb_build_array(pg_temp.rli(10), pg_temp.rli(11, '{"outcome": "unfulfilled"}')));
insert into rli select 'mixed', public.import_legacy_tasks(pg_temp.uli(1),
  jsonb_build_array(pg_temp.rli(10), pg_temp.rli(12, jsonb_build_object(
    'executor_id', pg_temp.uli(5), 'completed_on', '2026-03-29', 'deadline_on', '2026-03-29'))));
reset role;
select is((select result from rli where name = 'again'),
  '{"received": 2, "imported": 0, "already_imported": 2, "points": 0, "dry_run": false}'::jsonb,
  'a second call with the same rows imports nothing');
select is((select count(*) from public.points_ledger where member_id = pg_temp.uli(4)), 1::bigint,
  'and pays nobody twice');
select is((select result from rli where name = 'mixed'),
  '{"received": 2, "imported": 1, "already_imported": 1, "points": 9, "dry_run": false}'::jsonb,
  'a call mixing imported and new rows imports only the new ones');
select is((select (task.completed_at at time zone 'Europe/Bucharest')::date from public.tasks as task
            where task.id = pg_temp.tli(12)), '2026-03-29'::date,
  'a row completed on the day the clocks change keeps its day in Bucharest');

-- ==================== The scoring guide ====================

set local role service_role;
insert into rli select 'guide', public.import_legacy_tasks(pg_temp.uli(1),
  (select jsonb_agg(pg_temp.rli(1000 + (level - 1) * 5 + rating, jsonb_build_object(
            'executor_id', pg_temp.uli(5), 'difficulty', level, 'rating', rating,
            'completed_on', '2026-05-01', 'deadline_on', null)) order by level, rating)
     from generate_series(1, 10) as level, generate_series(1, 5) as rating));
reset role;
select results_eq(
  $$select evaluation.difficulty, evaluation.rating, evaluation.points
      from public.task_evaluations as evaluation
      join public.legacy_task_imports as registry on registry.task_id = evaluation.task_id
     where registry.sheet_row between 1001 and 1050 order by 1, 2$$,
  $$select level, rating, (array[1, 2, 3, 4, 5, 6, 7, 8, 15, 20])[level] * (array[-1, 0, 1, 2, 3])[rating]
      from generate_series(1, 10) as level, generate_series(1, 5) as rating order by 1, 2$$,
  'all 50 awards are the level''s base points times the Rating multiplier');

-- ==================== Period reads see the past ====================

select is((select earned.task_points from private.task_points_in_range(
             '2026-03-01 00:00+02'::timestamptz, '2026-03-20 00:00+02'::timestamptz) as earned
            where earned.member_id = pg_temp.uli(4)), 9,
  'the imported points fall in the period the work was done in');
select is((select count(*) from private.task_points_in_range(now() - interval '1 day', now() + interval '1 day') as earned
            where earned.member_id = pg_temp.uli(4)), 0::bigint,
  'and not in the period the import ran in');
select pg_temp.test_login_leadership(pg_temp.uli(1));
select is((select count(*) from public.leadership_member_tasks(pg_temp.uli(4),
             '2026-03-12 00:00+02'::timestamptz, '2026-03-13 00:00+02'::timestamptz)), 1::bigint,
  'the Work Filter finds an imported Task on its deadline day');
select pg_temp.test_clear_jwt();
reset role;

-- ==================== Promotion candidates ====================

set local role service_role;
select public.import_legacy_tasks(pg_temp.uli(1), jsonb_build_array(pg_temp.rli(20, jsonb_build_object(
  'executor_id', pg_temp.uli(7), 'difficulty', 10, 'rating', 5, 'completed_on', '2026-06-01'))));
reset role;
select is((select count(*) from public.promotion_candidates
            where member_id = pg_temp.uli(7) and decision is null), 1::bigint,
  'a Voluntar the history carries over the threshold is listed as a promotion candidate');
```

`private.task_points_in_range(timestamptz, timestamptz)` returns `table (member_id uuid, task_points integer)`; `public.leadership_member_tasks(uuid, timestamptz, timestamptz)` is the Work Filter's read and ranges on the Task deadline.

- [ ] **Step 7: Run and pass**

Run: `npx supabase db reset && npx supabase test db supabase/tests/legacy_task_import.test.sql`
Expected: PASS, 60 assertions. The function already exists, so a failure here is a real defect in Step 4's body or a wrong expectation: fix whichever the spec contradicts.

- [ ] **Step 8: Acceptance by mutation.** Each mutation is applied to the local database only (`docker exec -i supabase_db_osubb-app psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -f -` with the changed `create or replace function`), the suite is run, the named assertion must turn red, and `npx supabase db reset` restores the migration.

| Mutation                                               | Assertion that must fail                                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| the trigger returns `new` without reading the registry | "a legacy_migration Evaluation for a Task outside the registry is still refused"                            |
| the `insert into public.points_ledger` removed         | "each row pays its points once, negative included, dated on the completion day"                             |
| the registry `exists` skip removed                     | "a second call with the same rows imports nothing" (it raises a unique violation instead)                   |
| `actor.role = 'moderator'` removed from the gate       | "a BC member cannot run the import"                                                                         |
| `v_at` replaced by `now()` in the Evaluation insert    | "each Evaluation is a legacy_migration one with no evaluator, evaluated on the completion day, written now" |
| `actor_id` of the `created` row set to `p_actor`       | "no activity row names the acting Member, so their task_create cap is untouched"                            |

Record the six results in the suite's header comment, in the style of `volunteer_import.test.sql`'s "Mutation guards" block.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations supabase/tests/legacy_task_import.test.sql
git commit -m "feat(db): import_legacy_tasks writes a sheet row as a dated terminal Task (#1049)"
```

---

### Task 3: The totals read, and what can still happen to an imported Task

**Files:**

- Modify: `supabase/migrations/<ts>_legacy_task_import.sql` (append section 4)
- Modify: `supabase/tests/legacy_task_import.test.sql`

**Interfaces:**

- Consumes: `public.import_legacy_tasks`, `pg_temp.tli`, `pg_temp.rli`, `rli` (Task 2).
- Produces: `public.legacy_task_import_totals() returns jsonb` — `{"rows": int, "points": int, "groups": {"<group_id>": {"rows": int, "points": int}}, "members": {"<member_id>": {"rows": int, "points": int}}}`, counting only imported Tasks that still exist with an unreversed Evaluation.

- [ ] **Step 1: Write the failing tests** — change `select plan(60);` to `select plan(68);` and append before `select * from finish();`:

```sql
-- ==================== The totals the script reads back ====================

select ok(has_function_privilege('service_role', 'public.legacy_task_import_totals()', 'execute')
          and not has_function_privilege('authenticated', 'public.legacy_task_import_totals()', 'execute')
          and not has_function_privilege('anon', 'public.legacy_task_import_totals()', 'execute'),
  'the totals read is service role only');
set local role service_role;
insert into rli select 'totals', public.legacy_task_import_totals();
reset role;
select is((select (result ->> 'rows')::integer from rli where name = 'totals'), 54,
  'the totals count every imported Task: 2 + 1 + 50 + 1');
select is((select result -> 'members' -> pg_temp.uli(4)::text from rli where name = 'totals'),
  '{"rows": 1, "points": 9}'::jsonb,
  'the totals are per Member');
select is((select (result -> 'groups' -> pg_temp.gli('Dept LI')::text ->> 'rows')::integer from rli where name = 'totals'), 54,
  'and per Group');

-- ==================== Reopen is refused; delete for good works ====================

select pg_temp.test_login_leadership(pg_temp.uli(1));
select throws_ok(
  $$select public.reopen_task(pg_temp.tli(10), 'Motiv de redeschidere pentru test')$$,
  'PT409', 'evaluation_not_found',
  'an imported Task cannot be reopened: reopen reverses a command Evaluation only');
select lives_ok(
  $$select public.delete_task(pg_temp.tli(10), true)$$,
  'an imported Task can be deleted for good with its points');
select pg_temp.test_clear_jwt();
reset role;
select is((select coalesce(sum(delta), 0) from public.points_ledger where member_id = pg_temp.uli(4)), 0::bigint,
  'deleting it reversed its points through the ledger');
set local role service_role;
insert into rli select 'after-delete', public.import_legacy_tasks(pg_temp.uli(1), jsonb_build_array(pg_temp.rli(10)));
reset role;
select is((select result ->> 'already_imported' from rli where name = 'after-delete'), '1',
  'the deleted Task''s sheet row stays claimed: a later call still skips it');
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx supabase db reset && npx supabase test db supabase/tests/legacy_task_import.test.sql`
Expected: FAIL — `function public.legacy_task_import_totals() does not exist`.

- [ ] **Step 3: Append section 4 to the migration**

```sql
-- ---------------------------------------------------------------------------
-- 4. The totals the import script compares its file with
-- ---------------------------------------------------------------------------
create function public.legacy_task_import_totals()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with imported as (
    select task.group_id, assignment.member_id, evaluation.points
      from public.legacy_task_imports as registry
      join public.tasks as task on task.id = registry.task_id
      join public.task_evaluations as evaluation
        on evaluation.task_id = task.id
       and evaluation.source = 'legacy_migration'
       and evaluation.reversed_at is null
      join public.task_assignments as assignment on assignment.id = evaluation.assignment_id
  )
  select jsonb_build_object(
    'rows',   (select count(*) from imported),
    'points', (select coalesce(sum(points), 0) from imported),
    'groups', coalesce((select jsonb_object_agg(by_group.group_id::text,
                                 jsonb_build_object('rows', by_group.row_count, 'points', by_group.points))
                          from (select group_id, count(*) as row_count, sum(points) as points
                                  from imported group by group_id) as by_group), '{}'::jsonb),
    'members', coalesce((select jsonb_object_agg(by_member.member_id::text,
                                  jsonb_build_object('rows', by_member.row_count, 'points', by_member.points))
                           from (select member_id, count(*) as row_count, sum(points) as points
                                   from imported group by member_id) as by_member), '{}'::jsonb));
$$;

revoke execute on function public.legacy_task_import_totals()
  from public, anon, authenticated, service_role;
grant execute on function public.legacy_task_import_totals() to service_role;

comment on function public.legacy_task_import_totals() is
  '#1049: what the Legacy Import has written and still stands -- rows and Task Points in total, per Group and per Member -- for scripts/import-legacy-tasks.mjs to compare with its file after a run. Counts an imported Task only while it exists with an unreversed legacy_migration Evaluation. Service role only; dropped by #1050 with the command.';
```

- [ ] **Step 4: Run and pass**

Run: `npx supabase db reset && npx supabase test db`
Expected: PASS for every suite; the new one has 68 assertions.

- [ ] **Step 5: Regenerate the types**

```bash
npm --prefix app run gen:types
```

Expected: `app/src/lib/database.types.ts` gains `legacy_task_imports`, `import_legacy_tasks` and `legacy_task_import_totals`, nothing else.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations supabase/tests/legacy_task_import.test.sql app/src/lib/database.types.ts
git commit -m "feat(db): the Legacy Import totals read; reopen and delete pinned for imported Tasks (#1049)"
```

---

### Task 4: The import script

**Files:**

- Create: `scripts/import-legacy-tasks.mjs`
- Create: `scripts/import-legacy-tasks.test.mjs`
- Modify: `package.json` (`scripts.test:tooling`)

**Interfaces:**

- Consumes: `POST /rest/v1/rpc/import_legacy_tasks {p_actor, p_rows, p_dry_run}`, `POST /rest/v1/rpc/legacy_task_import_totals {}`, `GET /rest/v1/profiles?select=id,email,role,status&email=eq.<email>`.
- Produces: `main(argv, { env, fetchImpl, log, readFile }) → Promise<0 | 1 | 2>`; `toCommandRow(fileRow)`; `parseSheetDate(text)`; `planTotals(fileRows)`; `BASE_POINTS`.
  A file row (from `build-import.js`): `{tracker_id, sheet_row, sheet_id, group_id, group, profile_id, title, full_title, deadline, difficulty_level, rating, sheet_status, completed_on, observations, …}`.

- [ ] **Step 1: Write the failing tests** — create `scripts/import-legacy-tasks.test.mjs`:

```js
// node:test suite for scripts/import-legacy-tasks.mjs (#1049). Every call goes
// to an in-memory fake of PostgREST; no test touches a network or a database.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BASE_POINTS,
  main,
  parseSheetDate,
  planTotals,
  toCommandRow,
} from "./import-legacy-tasks.mjs";

const MODERATOR = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "mod@example.com",
  role: "moderator",
  status: "activ",
};
const BC = {
  id: "00000000-0000-4000-8000-000000000002",
  email: "bc@example.com",
  role: "bc",
  status: "activ",
};

function fileRow(n, overrides = {}) {
  return {
    tracker_id: "trackerFileIdForTests0001",
    sheet_row: n + 1,
    sheet_id: `1-1-${n}`,
    group_id: 4,
    group: "Resurse Umane",
    profile_id: `00000000-0000-4000-8000-${String(100 + (n % 3)).padStart(12, "0")}`,
    title: "Ședință",
    full_title: null,
    deadline: "3/12/2026",
    difficulty_level: 2,
    rating: 3,
    sheet_status: "Realizat",
    completed_on: "2026-03-10",
    observations: "",
    ...overrides,
  };
}

/** An in-memory project: profiles, the registry the command keeps, and switches for the failures. */
function fakeProject({
  profiles = [MODERATOR, BC],
  refuseAtCall = null,
  dropAtCall = null,
  tamperTotals = false,
} = {}) {
  const registry = new Map();
  const calls = [];
  const json = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const fetchImpl = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    assert.equal(
      init.headers.apikey,
      "sb_secret_test",
      "every request carries the secret key",
    );
    if (pathname === "/rest/v1/profiles") {
      const email = (searchParams.get("email") ?? "").replace(/^eq\./, "");
      return json(
        200,
        profiles.filter((profile) => profile.email === email),
      );
    }
    if (pathname === "/rest/v1/rpc/import_legacy_tasks") {
      calls.push(body);
      if (dropAtCall === calls.length) throw new TypeError("fetch failed");
      if (refuseAtCall === calls.length) {
        return json(400, {
          code: "PT400",
          message: "invalid_executor",
          details: "row 2 (trackerFileIdForTests0001, sheet row 3)",
        });
      }
      let imported = 0;
      let already = 0;
      let points = 0;
      for (const row of body.p_rows) {
        const key = `${row.tracker_id}#${row.sheet_row}`;
        if (registry.has(key)) {
          already += 1;
          continue;
        }
        imported += 1;
        points += BASE_POINTS[row.difficulty] * (row.rating - 2);
        if (!body.p_dry_run) registry.set(key, row);
      }
      return json(200, {
        received: body.p_rows.length,
        imported,
        already_imported: already,
        points,
        dry_run: body.p_dry_run,
      });
    }
    if (pathname === "/rest/v1/rpc/legacy_task_import_totals") {
      const totals = { rows: 0, points: 0, groups: {}, members: {} };
      for (const row of registry.values()) {
        const points = BASE_POINTS[row.difficulty] * (row.rating - 2);
        totals.rows += 1;
        totals.points += points;
        for (const [bucket, id] of [
          ["groups", String(row.group_id)],
          ["members", row.executor_id],
        ]) {
          totals[bucket][id] ??= { rows: 0, points: 0 };
          totals[bucket][id].rows += 1;
          totals[bucket][id].points += points;
        }
      }
      if (tamperTotals) totals.points += 1;
      return json(200, totals);
    }
    return json(404, { message: `unexpected ${pathname}` });
  };
  return { fetchImpl, calls, registry };
}

async function run(args, project, rows) {
  const lines = [];
  const code = await main(args, {
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_test",
    },
    fetchImpl: project.fetchImpl,
    log: (line) => lines.push(line),
    readFile: () => JSON.stringify(rows),
  });
  return { code, output: lines.join("\n") };
}

const rows250 = Array.from({ length: 250 }, (_, index) => fileRow(index + 1));

test("a sheet date is read in the two shapes the sheets hold, and nothing else", () => {
  assert.equal(parseSheetDate("3/12/2026"), "2026-03-12");
  assert.equal(parseSheetDate("12/25/2025"), "2025-12-25");
  assert.equal(parseSheetDate("6.12.2025"), "2025-12-06");
  assert.equal(parseSheetDate("09.02.2026"), "2026-02-09");
  assert.equal(parseSheetDate(""), null);
  assert.equal(parseSheetDate(null), null);
  assert.throws(
    () => parseSheetDate("12-03-2026"),
    /unreadable date "12-03-2026"/,
  );
  assert.throws(
    () => parseSheetDate("2/30/2026"),
    /unreadable date "2\/30\/2026"/,
  );
});

test("a file row becomes a command row", () => {
  assert.deepEqual(
    toCommandRow(
      fileRow(1, { observations: " urgent ", full_title: "Titlul întreg" }),
    ),
    {
      tracker_id: "trackerFileIdForTests0001",
      sheet_row: 2,
      sheet_id: "1-1-1",
      group_id: 4,
      executor_id: "00000000-0000-4000-8000-000000000101",
      title: "Ședință",
      description: "Titlul întreg",
      difficulty: 2,
      rating: 3,
      outcome: "completed",
      completed_on: "2026-03-10",
      deadline_on: "2026-03-12",
      note: "urgent",
    },
  );
  const unfulfilled = toCommandRow(
    fileRow(2, { sheet_status: "Nerealizat", deadline: "", observations: "" }),
  );
  assert.equal(unfulfilled.outcome, "unfulfilled");
  assert.equal(unfulfilled.deadline_on, null);
  assert.equal(unfulfilled.note, "Importat din Task Tracker.");
  assert.equal(
    toCommandRow(fileRow(3, { sheet_status: "(blank)" })).outcome,
    "completed",
  );
});

test("a row whose Group is still pending, or whose date cannot be read, stops the file before any call", async () => {
  const project = fakeProject();
  const pending = await run(
    ["--file", "f.json", "--actor", "mod@example.com", "--dry-run"],
    project,
    [
      fileRow(1),
      fileRow(2, { group_id: "PENDING", group: "Mind Matters 2025" }),
    ],
  );
  assert.equal(pending.code, 1);
  assert.match(
    pending.output,
    /trackerFileIdForTests0001 row 3: its Group is not set \(Mind Matters 2025\)/,
  );
  const badDate = await run(
    ["--file", "f.json", "--actor", "mod@example.com", "--dry-run"],
    project,
    [fileRow(1, { deadline: "12-03-2026" })],
  );
  assert.equal(badDate.code, 1);
  assert.match(
    badDate.output,
    /trackerFileIdForTests0001 row 2: unreadable date "12-03-2026"/,
  );
  assert.equal(project.calls.length, 0, "no call was made");
});

test("the plan totals are the file totals", () => {
  const totals = planTotals([
    fileRow(1),
    fileRow(2, { difficulty_level: 10, rating: 5, group_id: 5 }),
  ]);
  assert.equal(totals.rows, 2);
  assert.equal(totals.points, 2 + 60);
  assert.deepEqual(totals.groups, {
    4: { rows: 1, points: 2 },
    5: { rows: 1, points: 60 },
  });
  assert.equal(totals.from, "2026-03-10");
});

test("a dry run sends every batch as a dry run, prints the plan and writes nothing", async () => {
  const project = fakeProject();
  const { code, output } = await run(
    ["--file", "f.json", "--actor", "mod@example.com", "--dry-run"],
    project,
    rows250,
  );
  assert.equal(code, 0);
  assert.deepEqual(
    project.calls.map((call) => [
      call.p_rows.length,
      call.p_dry_run,
      call.p_actor,
    ]),
    [
      [100, true, MODERATOR.id],
      [100, true, MODERATOR.id],
      [50, true, MODERATOR.id],
    ],
  );
  assert.equal(project.registry.size, 0);
  assert.match(
    output,
    /250 rows, 500 points, 3 Members, 2026-03-10 … 2026-03-10/,
  );
  assert.match(output, /Group 4: 250 rows, 500 points/);
  assert.match(
    output,
    /Dry run: 250 would be imported, 0 already imported\. Nothing was written\./,
  );
});

test("the real run imports in batches and verifies the totals it reads back", async () => {
  const project = fakeProject();
  const { code, output } = await run(
    ["--file", "f.json", "--actor", "mod@example.com", "--execute"],
    project,
    rows250,
  );
  assert.equal(code, 0);
  assert.equal(project.registry.size, 250);
  assert.match(
    output,
    /Batch 3\/3 \(rows 201–250\): 50 imported, 0 already imported/,
  );
  assert.match(
    output,
    /Verified: 250 rows and 500 points are in, matching the file for every Group and Member\./,
  );
});

test("--batch-size changes the batch", async () => {
  const project = fakeProject();
  const { code } = await run(
    [
      "--file",
      "f.json",
      "--actor",
      "mod@example.com",
      "--execute",
      "--batch-size",
      "200",
    ],
    project,
    rows250,
  );
  assert.equal(code, 0);
  assert.deepEqual(
    project.calls.map((call) => call.p_rows.length),
    [200, 50],
  );
});

test("a refusal stops the run at that batch and names the row", async () => {
  const project = fakeProject({ refuseAtCall: 2 });
  const { code, output } = await run(
    ["--file", "f.json", "--actor", "mod@example.com", "--execute"],
    project,
    rows250,
  );
  assert.equal(code, 1);
  assert.equal(project.calls.length, 2, "the third batch was never sent");
  assert.match(
    output,
    /Batch 2\/3 \(rows 101–200\) was refused: PT400 invalid_executor — row 2 \(trackerFileIdForTests0001, sheet row 3\)/,
  );
  assert.match(
    output,
    /Batches before it are in\. Fix the file and run again: rows already imported are skipped\./,
  );
});

test("a call that gets no answer is reported as such, and the next run completes the import", async () => {
  const dropped = fakeProject({ dropAtCall: 2 });
  const first = await run(
    ["--file", "f.json", "--actor", "mod@example.com", "--execute"],
    dropped,
    rows250,
  );
  assert.equal(first.code, 1);
  assert.match(
    first.output,
    /Batch 2\/3 \(rows 101–200\) got no answer \(fetch failed\)\. It may or may not have been written\./,
  );

  const resumed = fakeProject();
  for (const row of rows250.slice(0, 100))
    resumed.registry.set(
      `${row.tracker_id}#${row.sheet_row}`,
      toCommandRow(row),
    );
  const second = await run(
    ["--file", "f.json", "--actor", "mod@example.com", "--execute"],
    resumed,
    rows250,
  );
  assert.equal(second.code, 0);
  assert.match(
    second.output,
    /Batch 1\/3 \(rows 1–100\): 0 imported, 100 already imported/,
  );
  assert.equal(resumed.registry.size, 250);
});

test("totals that differ from the file fail the run", async () => {
  const project = fakeProject({ tamperTotals: true });
  const { code, output } = await run(
    ["--file", "f.json", "--actor", "mod@example.com", "--execute"],
    project,
    rows250,
  );
  assert.equal(code, 1);
  assert.match(
    output,
    /MISMATCH points: the file has 500, the database has 501/,
  );
});

test("only the Moderator may be the acting Member, checked before any call", async () => {
  const project = fakeProject();
  const bc = await run(
    ["--file", "f.json", "--actor", "bc@example.com", "--execute"],
    project,
    rows250,
  );
  assert.equal(bc.code, 1);
  assert.match(bc.output, /bc@example\.com is not the active Moderator/);
  const nobody = await run(
    ["--file", "f.json", "--actor", "who@example.com", "--execute"],
    project,
    rows250,
  );
  assert.equal(nobody.code, 1);
  assert.equal(project.calls.length, 0);
});

test("usage errors answer 2 and make no call", async () => {
  const project = fakeProject();
  assert.equal(
    (
      await run(
        ["--file", "f.json", "--actor", "mod@example.com"],
        project,
        rows250,
      )
    ).code,
    2,
  );
  assert.equal(
    (
      await run(
        [
          "--file",
          "f.json",
          "--actor",
          "mod@example.com",
          "--dry-run",
          "--execute",
        ],
        project,
        rows250,
      )
    ).code,
    2,
  );
  assert.equal(
    (await run(["--actor", "mod@example.com", "--dry-run"], project, rows250))
      .code,
    2,
  );
  assert.equal(
    (
      await run(
        [
          "--file",
          "f.json",
          "--actor",
          "mod@example.com",
          "--dry-run",
          "--batch-size",
          "201",
        ],
        project,
        rows250,
      )
    ).code,
    2,
  );
  assert.equal(project.calls.length, 0);
});

test("a plain-http URL is accepted for the local stack only", async () => {
  const project = fakeProject();
  const lines = [];
  const code = await main(
    ["--file", "f.json", "--actor", "mod@example.com", "--dry-run"],
    {
      env: {
        SUPABASE_URL: "http://example.com",
        SUPABASE_SECRET_KEY: "sb_secret_test",
      },
      fetchImpl: project.fetchImpl,
      log: (line) => lines.push(line),
      readFile: () => JSON.stringify(rows250),
    },
  );
  assert.equal(code, 2);
  assert.match(lines.join("\n"), /SUPABASE_URL must be https/);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/import-legacy-tasks.test.mjs`
Expected: FAIL — `Cannot find module … import-legacy-tasks.mjs`.

- [ ] **Step 3: Write the script** — create `scripts/import-legacy-tasks.mjs`:

```js
// scripts/import-legacy-tasks.mjs -- #1049: the one-time Legacy Import.
//
// Feeds the prepared import file (kept OUTSIDE this repository: it holds
// Members' names) to public.import_legacy_tasks in batches, then reads the
// totals back and compares them with the file. Contract, checks and recovery:
// docs/backend/legacy-task-import.md. A one-shot script: after the verified
// production run it is never run again (CLAUDE.md, house rule 9).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const BATCH_SIZE = 100;
/** Base points of the ten Difficulty levels (ADR-0007, #985). */
export const BASE_POINTS = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 15,
  10: 20,
};
const DEFAULT_NOTE = "Importat din Task Tracker.";

export class RefusedError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** A sheet date as the trackers hold it: M/D/YYYY, or D.M.YYYY where someone typed it. */
export function parseSheetDate(text) {
  const value = String(text ?? "").trim();
  if (value === "") return null;
  let year;
  let month;
  let day;
  const slashed = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const dotted = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (slashed) [, month, day, year] = slashed;
  else if (dotted) [, day, month, year] = dotted;
  else throw new Error(`unreadable date "${value}"`);
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    throw new Error(`unreadable date "${value}"`);
  }
  return iso;
}

function where(row) {
  return `${row.tracker_id} row ${row.sheet_row}`;
}

function rowPoints(row) {
  return BASE_POINTS[row.difficulty_level] * (row.rating - 2);
}

/** One row of import-set.json as one element of p_rows. Throws, naming the row, on what the file must fix. */
export function toCommandRow(row) {
  if (!Number.isInteger(row.group_id)) {
    throw new Error(`${where(row)}: its Group is not set (${row.group})`);
  }
  if (
    !(row.difficulty_level in BASE_POINTS) ||
    ![1, 2, 3, 4, 5].includes(row.rating)
  ) {
    throw new Error(
      `${where(row)}: Difficulty ${row.difficulty_level} / Rating ${row.rating} cannot be evaluated`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.completed_on ?? ""))) {
    throw new Error(
      `${where(row)}: unreadable completion date "${row.completed_on}"`,
    );
  }
  let deadline;
  try {
    deadline = parseSheetDate(row.deadline);
  } catch (error) {
    throw new Error(`${where(row)}: ${error.message}`);
  }
  return {
    tracker_id: row.tracker_id,
    sheet_row: row.sheet_row,
    sheet_id: row.sheet_id ?? null,
    group_id: row.group_id,
    executor_id: row.profile_id,
    title: row.title,
    description: row.full_title ?? null,
    difficulty: row.difficulty_level,
    rating: row.rating,
    outcome: row.sheet_status === "Nerealizat" ? "unfulfilled" : "completed",
    completed_on: row.completed_on,
    deadline_on: deadline,
    note: String(row.observations ?? "").trim() || DEFAULT_NOTE,
  };
}

/** What the file says the database must hold after the run. */
export function planTotals(rows) {
  const totals = {
    rows: 0,
    points: 0,
    groups: {},
    members: {},
    from: null,
    to: null,
  };
  for (const row of rows) {
    const points = rowPoints(row);
    totals.rows += 1;
    totals.points += points;
    for (const [bucket, id] of [
      ["groups", String(row.group_id)],
      ["members", row.profile_id],
    ]) {
      totals[bucket][id] ??= { rows: 0, points: 0 };
      totals[bucket][id].rows += 1;
      totals[bucket][id].points += points;
    }
    if (totals.from === null || row.completed_on < totals.from)
      totals.from = row.completed_on;
    if (totals.to === null || row.completed_on > totals.to)
      totals.to = row.completed_on;
  }
  return totals;
}

/** The three calls the script makes, all with the secret key (service_role). */
export function createClient({ url, secretKey, fetchImpl }) {
  const base = url.replace(/\/+$/, "");
  const request = async (method, path, body) => {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    if (text !== "") {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      throw new RefusedError(
        response.status,
        String(data?.code ?? ""),
        String(data?.message ?? text),
        String(data?.details ?? ""),
      );
    }
    return data;
  };
  return {
    profilesByEmail: (email) =>
      request(
        "GET",
        `/rest/v1/profiles?select=id,email,role,status&email=eq.${encodeURIComponent(email)}`,
      ),
    importBatch: (actorId, rows, dryRun) =>
      request("POST", "/rest/v1/rpc/import_legacy_tasks", {
        p_actor: actorId,
        p_rows: rows,
        p_dry_run: dryRun,
      }),
    totals: () => request("POST", "/rest/v1/rpc/legacy_task_import_totals", {}),
  };
}

function compareTotals(plan, actual) {
  const mismatches = [];
  for (const key of ["rows", "points"]) {
    if (plan[key] !== actual[key]) {
      mismatches.push(
        `MISMATCH ${key}: the file has ${plan[key]}, the database has ${actual[key]}`,
      );
    }
  }
  for (const [bucket, label] of [
    ["groups", "Group"],
    ["members", "Member"],
  ]) {
    const ids = new Set([
      ...Object.keys(plan[bucket]),
      ...Object.keys(actual[bucket] ?? {}),
    ]);
    for (const id of [...ids].sort()) {
      const expected = plan[bucket][id] ?? { rows: 0, points: 0 };
      const found = actual[bucket]?.[id] ?? { rows: 0, points: 0 };
      if (expected.rows !== found.rows || expected.points !== found.points) {
        mismatches.push(
          `MISMATCH ${label} ${id}: the file has ${expected.rows} rows / ${expected.points} points, ` +
            `the database has ${found.rows} rows / ${found.points} points`,
        );
      }
    }
  }
  return mismatches;
}

const USAGE = `Usage:
  node scripts/import-legacy-tasks.mjs --file <import-set.json> --actor <the Moderator's address> --dry-run
  node scripts/import-legacy-tasks.mjs --file <import-set.json> --actor <the Moderator's address> --execute

Options:
  --batch-size <n>   rows per call, 1-200 (default ${BATCH_SIZE})

Environment:
  SUPABASE_URL         https://<project-ref>.supabase.co (or http://127.0.0.1:54321)
  SUPABASE_SECRET_KEY  the project's secret key

The contract, the checks and the recovery: docs/backend/legacy-task-import.md`;

export async function main(argv, { env, fetchImpl, log, readFile }) {
  let options;
  try {
    ({ values: options } = parseArgs({
      args: argv,
      options: {
        file: { type: "string" },
        actor: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        execute: { type: "boolean", default: false },
        "batch-size": { type: "string" },
        help: { type: "boolean", default: false },
      },
      strict: true,
    }));
  } catch (error) {
    log(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    log(USAGE);
    return 0;
  }
  const dryRun = options["dry-run"];
  if (dryRun === options.execute || !options.file || !options.actor) {
    log(
      `Give --file, --actor and exactly one of --dry-run or --execute.\n\n${USAGE}`,
    );
    return 2;
  }
  const batchSize =
    options["batch-size"] === undefined
      ? BATCH_SIZE
      : Number(options["batch-size"]);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 200) {
    log("--batch-size takes a whole number from 1 to 200.");
    return 2;
  }

  const url = env.SUPABASE_URL ?? "";
  const secretKey = env.SUPABASE_SECRET_KEY ?? "";
  // The secret key travels on every request, so plain http is for the local stack only.
  let parsedUrl = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = null;
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(
    parsedUrl?.hostname ?? "",
  );
  if (
    !parsedUrl ||
    !(
      parsedUrl.protocol === "https:" ||
      (parsedUrl.protocol === "http:" && loopback)
    )
  ) {
    log(
      "SUPABASE_URL must be https (plain http is accepted for the local stack only).",
    );
    return 2;
  }
  if (secretKey === "") {
    log("SUPABASE_SECRET_KEY is not set.");
    return 2;
  }

  let fileRows;
  let commandRows;
  try {
    fileRows = JSON.parse(readFile(options.file));
    if (!Array.isArray(fileRows) || fileRows.length === 0)
      throw new Error("the file holds no rows");
    commandRows = fileRows.map(toCommandRow);
  } catch (error) {
    log(`${options.file} cannot be imported: ${error.message}`);
    return 1;
  }

  const plan = planTotals(fileRows);
  log(
    `${plan.rows} rows, ${plan.points} points, ${Object.keys(plan.members).length} Members, ` +
      `${plan.from} … ${plan.to}`,
  );
  for (const id of Object.keys(plan.groups).sort(
    (a, b) => Number(a) - Number(b),
  )) {
    log(
      `  Group ${id}: ${plan.groups[id].rows} rows, ${plan.groups[id].points} points`,
    );
  }

  const client = createClient({ url, secretKey, fetchImpl });
  let actor;
  try {
    const found = await client.profilesByEmail(
      options.actor.trim().toLowerCase(),
    );
    actor = found.find(
      (profile) => profile.role === "moderator" && profile.status === "activ",
    );
  } catch (error) {
    log(`The acting Member could not be read: ${error.message}`);
    return 1;
  }
  if (!actor) {
    log(
      `${options.actor} is not the active Moderator: only the Moderator runs the Legacy Import.`,
    );
    return 1;
  }

  const batches = [];
  for (let start = 0; start < commandRows.length; start += batchSize) {
    batches.push(commandRows.slice(start, start + batchSize));
  }
  let imported = 0;
  let already = 0;
  for (const [index, batch] of batches.entries()) {
    const first = index * batchSize + 1;
    const label = `Batch ${index + 1}/${batches.length} (rows ${first}–${first + batch.length - 1})`;
    try {
      const result = await client.importBatch(actor.id, batch, dryRun);
      imported += result.imported;
      already += result.already_imported;
      log(
        `${label}: ${result.imported} imported, ${result.already_imported} already imported`,
      );
    } catch (error) {
      if (error instanceof RefusedError) {
        log(
          `${label} was refused: ${error.code} ${error.message}${error.details ? ` — ${error.details}` : ""}`,
        );
        if (!dryRun) {
          log(
            "Batches before it are in. Fix the file and run again: rows already imported are skipped.",
          );
        }
      } else {
        log(
          `${label} got no answer (${error.message}). It may or may not have been written.`,
        );
        log("Run the same command again: rows already imported are skipped.");
      }
      return 1;
    }
  }

  if (dryRun) {
    log(
      `Dry run: ${imported} would be imported, ${already} already imported. Nothing was written.`,
    );
    return 0;
  }

  let actual;
  try {
    actual = await client.totals();
  } catch (error) {
    log(
      `The import ran, but the totals could not be read back: ${error.message}`,
    );
    return 1;
  }
  const mismatches = compareTotals(plan, actual);
  if (mismatches.length > 0) {
    mismatches.forEach((line) => log(line));
    log(
      "The database does not match the file. Do not close the import; see docs/backend/legacy-task-import.md.",
    );
    return 1;
  }
  log(
    `Verified: ${actual.rows} rows and ${actual.points} points are in, matching the file for every Group and Member.`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2), {
    env: process.env,
    fetchImpl: fetch,
    log: (line) => console.log(line),
    readFile: (path) => readFileSync(path, "utf8"),
  });
}
```

- [ ] **Step 4: Run and pass**

Run: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/import-legacy-tasks.test.mjs`
Expected: PASS, 13 tests.

- [ ] **Step 5: Wire it into `test:tooling`** — in `package.json`, the `test:tooling` script ends with `--test scripts/bootstrap-production.test.mjs`. Change that ending to:

```
--test scripts/bootstrap-production.test.mjs scripts/import-legacy-tasks.test.mjs
```

Run: `npm run test:tooling`
Expected: PASS, both suites listed.

- [ ] **Step 6: Commit**

```bash
git add scripts/import-legacy-tasks.mjs scripts/import-legacy-tasks.test.mjs package.json
git commit -m "feat(scripts): import-legacy-tasks feeds the import file in batches and verifies the totals (#1049)"
```

---

### Task 5: The copy for a reopen that is refused

**Files:**

- Modify: `app/src/lib/command-reasons.ts` (the `REASON_COPY` map)
- Modify: `app/src/lib/command-reasons.test.ts` (create it beside the module if it does not exist)

**Interfaces:**

- Consumes: `PT409 evaluation_not_found` from `reopen_task`.
- Produces: `commandErrorMessage(error, fallback)` answers the copy below for that reason.

- [ ] **Step 1: Write the failing test** — add to the reasons test file (if the file exists, add the `it` inside its top-level `describe`; if not, create it with these imports):

```ts
import { describe, expect, it } from "vitest";

import { commandErrorMessage } from "./command-reasons";

describe("evaluation_not_found", () => {
  it("says an imported Task cannot be reopened and what to do instead", () => {
    expect(
      commandErrorMessage({ message: "evaluation_not_found" }, "fallback"),
    ).toBe(
      "Taskul vine din importul vechiului Task Tracker și nu poate fi redeschis. Îl poți șterge definitiv, cu punctele lui.",
    );
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm --prefix app run test:run -- command-reasons`
Expected: FAIL — received `'fallback'`.

- [ ] **Step 3: Add the copy** — in `app/src/lib/command-reasons.ts`, as the first entry of `REASON_COPY` (directly after `const REASON_COPY = new Map<string, string>([`):

```ts
  /* ---- Legacy Import (spec 2026-10-13): reopen reverses a command Evaluation only ---- */
  [
    'evaluation_not_found',
    'Taskul vine din importul vechiului Task Tracker și nu poate fi redeschis. Îl poți șterge definitiv, cu punctele lui.',
  ],
```

- [ ] **Step 4: Run and pass**

Run: `npm --prefix app run test:run -- command-reasons && npm --prefix app run typecheck && npm --prefix app run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/command-reasons.ts app/src/lib/command-reasons.test.ts
git commit -m "feat(app): say why an imported Task cannot be reopened (#1049)"
```

---

### Task 6: The documents

**Files:**

- Modify: `docs/adr/0007-task-tracker-lifecycle.md` (header list, new amendment at the end)
- Modify: `CONTEXT.md` (after the **Completed-work Request** entry)
- Modify: `docs/backend/conventions.md` (§2 and §3)
- Create: `docs/backend/legacy-task-import.md`
- Modify: `docs/README.md` (index the runbook as authoritative)
- Modify: `CLAUDE.md` (Status)

- [ ] **Step 1: ADR-0007.** Add to the header list, after the last `- **Amended:**` line:

```markdown
- **Amended:** 2026-10-14 — #1049 (ruling R53): the Legacy Import writes the pre-app Task Tracker history once, as terminal Tasks dated on their completion day with `legacy_migration` Evaluations; it is the second and last writer of Task Points and is closed after the run
```

Add at the end of the file:

```markdown
## Amendment (2026-10-14) — the Legacy Import (ruling R53)

`private.evaluate_task` stays the one place a live Evaluation computes and writes Task Points. Beside it there is exactly one other writer, used once: the **Legacy Import** (#1049, spec `docs/superpowers/specs/2026-10-13-legacy-task-import-design.md`), which copies OSUBB's pre-app Google Sheets Task Tracker — rows completed on or after 2026-02-01 — into the application.

One sheet row becomes one terminal Task (`completed`, or `unfulfilled` for a row marked "Nerealizat"), one ended Assignment of its Executor, one Evaluation and one `task` ledger row, all dated at 12:00 Europe/Bucharest on the day the sheet says the work was completed, so that every period read — Clasament, the Department Cup, Evaluation rankings — places the work where it happened. The points are the application's own formula applied to the sheet's Difficulty and Rating; the sheet's Mark is ignored.

The Evaluation carries the reserved source `legacy_migration` and no evaluator: the people who graded the work in the sheet are not recorded. That source stays closed to everything else — a trigger refuses it for any Task the import did not register in `public.legacy_task_imports` — and the import command is dropped after the verified run (#1050), which closes it for good.

What differs from a finished Task added in the application, deliberately: BC members and the Moderator are credited like anyone, and the Group's Minimum Level is not applied (the grading was not the importer's and predates both rules); no Notification is sent; the activity trail has no actor; the Moderator who ran the import is the Task's creator. An imported Task cannot be reopened — reopen reverses a `command` Evaluation only — and is corrected by deleting it for good, which reverses its points through the ledger as for any Task.
```

- [ ] **Step 2: CONTEXT.md.** After the **Completed-work Request** entry's last line, add:

```markdown
**Legacy Import**:
The one-time copy of OSUBB's pre-app Google Sheets Task Tracker into the application (2026-10): each sheet row completed on or after 2026-02-01 became a terminal Task dated on its completion day, with its Task Points. An imported Task is told apart by its Evaluation's `legacy_migration` source; it cannot be reopened, only deleted for good.
_Avoid_: Migration, backfill, opening balance
```

- [ ] **Step 3: conventions.md.** At the end of §2 "Command shape", before its `Example:` paragraph, add:

```markdown
**Two bulk loads are service-role commands, not wrapper + `_impl` pairs.** `public.import_member` (#991) and `public.import_legacy_tasks` (#1049, until #1050 drops it) are driven by a script or an Edge Function holding the secret key, so no session exists: each is a single `security definer` function in `public`, executable by `service_role` only, that takes the acting Member as a parameter and re-checks them live, held `for share`. Nothing else may take this shape.
```

In §3, after the "OSUBB-wide approval" paragraph, add:

```markdown
**The Legacy Import (#1049, spec 2026-10-13)** raises every refusal with the offending row in `DETAIL` (`row 3 (<tracker id>, sheet row 41)`). Step 1: `PT400 invalid_actor`, `invalid_rows`, `too_many_rows` (above 200), `invalid_tracker_id`, `invalid_sheet_row`, `invalid_sheet_id`, the Task's `title_required` / `title_too_short` / `title_too_long` / `description_too_long`, `task_group_required`, `invalid_origin`, `invalid_executor`, `invalid_difficulty`, `invalid_rating`, `invalid_outcome`, `invalid_completed_on`, `invalid_deadline`, `evaluation_note_required`, `note_too_long`, `duplicate_row`. Then `42501 legacy_import_forbidden` (not the live Moderator), `PT400 invalid_executor` / `invalid_origin` against the loaded rows, and `PT409 group_archived`. `23514 task_evaluation_legacy_source_closed` still answers any `legacy_migration` Evaluation for a Task outside `public.legacy_task_imports`.
```

- [ ] **Step 4: The runbook.** Create `docs/backend/legacy-task-import.md`:

````markdown
# Legacy Task Tracker import (#1049)

The one-time copy of the pre-app Google Sheets Task Tracker into production. Design: [the spec](../superpowers/specs/2026-10-13-legacy-task-import-design.md); rule: ADR-0007, amendment of 2026-10-14. After the verified production run the command is dropped (#1050) and none of this is ever run again.

## What you need

| Thing                 | Where it comes from                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `import-set.json`     | `../osubb-legacy-import/`, built by `node parse.js && node match.js && node build-import.js`. Never in this repo. |
| `SUPABASE_URL`        | Project Settings → API → Project URL                                                                              |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → Secret keys. Read from the environment only; never printed.                         |
| The Moderator's email | The acting Member. Nobody else may run the import.                                                                |

Every Group the file names must exist and be active, and every Member must be `activ`. The dry run says which row is not.

## Rehearse locally first

On a branch that has the migration, with the local stack up and no other session using it:

```bash
npx supabase db reset
```

```bash
bash scripts/legacy-import-rehearsal.sh ../osubb-legacy-import/import-set.json
```

It provisions placeholder Members and Groups carrying the file's ids, runs the dry run, the real run and a second run, and ends with `REHEARSAL PASSED`. Open a few imported Tasks, one Member's points and a Clasament period in the local app, then reset the database again.

## The production run

Pick a quiet hour: every batch broadcasts its rows to open clients, and 67 promotion-candidate Notifications reach BC and the Moderator when the points land.

1. **Confirm a backup.** Dashboard → Database → Backups: note the time of the latest one. It is the only undo.
2. **Dry run** — writes nothing:

```bash
SUPABASE_URL=https://<production-ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_… node scripts/import-legacy-tasks.mjs --file ../osubb-legacy-import/import-set.json --actor <the Moderator's address> --dry-run
```

It must end with `Dry run: 5270 would be imported, 0 already imported. Nothing was written.` and the per-Group lines must match `import-summary.json`.

3. **The real run** — the same line with `--execute`. It must end with `Verified: … matching the file for every Group and Member.`
4. **Look.** Three imported Tasks from different Groups, one Member's total, Clasament for March 2026, the promotion candidates in Administrare → Evaluări de rol.

## When something goes wrong

- **A batch was refused.** The line names the row. Nothing of that batch was written; the batches before it are in. Fix the row in `../osubb-legacy-import` (or the Member or Group in the app), rebuild the file and run the same command again: registered rows are skipped.
- **A batch got no answer.** It may or may not have been written. Run the same command again; the registry decides.
- **A timeout** (`57014`). Run again with `--batch-size 50`.
- **The totals do not match.** Do not close the import. The mismatch lines name the Group or Member; compare with `import-set.csv`. A Task deleted for good since the run explains a lower total.
- **The data itself is wrong.** One Task: delete it for good in the app, which reverses its points. Many: restore the backup of step 1.

## Closing

When the run is verified, #1050 drops `public.import_legacy_tasks` and `public.legacy_task_import_totals`. `public.legacy_task_imports` stays: it is the record of which sheet row became which Task.
````

- [ ] **Step 5: Index and status.** In `docs/README.md`, add the runbook to the authoritative backend documents, in the list's own style, as: `docs/backend/legacy-task-import.md — the one-time Legacy Import runbook (#1049)`. In `CLAUDE.md`, add a Status bullet after the "Launch grill" bullet:

```markdown
- **The Legacy Import (#1049, ruling R53, spec `docs/superpowers/specs/2026-10-13-legacy-task-import-design.md`)** copies the pre-app Google Sheets Task Tracker into production once: `public.import_legacy_tasks` (service role only, the Moderator as acting Member) writes each sheet row as a terminal Task dated on its completion day with a `legacy_migration` Evaluation, and `scripts/import-legacy-tasks.mjs` feeds it the file kept outside the repository (`docs/backend/legacy-task-import.md`). It is the second and last writer of Task Points; #1050 drops the command after the verified run.
```

- [ ] **Step 6: Check the documents**

Run: `npm run format && npm run check:root`
Expected: PASS (format, links, tooling).

- [ ] **Step 7: Commit**

```bash
git add docs CONTEXT.md CLAUDE.md
git commit -m "docs: ADR-0007 amendment, glossary, conventions and runbook for the Legacy Import (#1049)"
```

---

### Task 7: The rehearsal

**Files:**

- Create: `scripts/legacy-import-rehearsal-fixture.mjs`
- Create: `scripts/legacy-import-rehearsal.sh`

**Interfaces:**

- Consumes: `import-set.json` (ids only), `scripts/import-legacy-tasks.mjs`.
- Produces: exit 0 and `REHEARSAL PASSED` when the real file imports end to end on the local stack and its totals verify twice.

- [ ] **Step 1: The fixture generator** — create `scripts/legacy-import-rehearsal-fixture.mjs`:

```js
// scripts/legacy-import-rehearsal-fixture.mjs -- #1049: SQL for the LOCAL rehearsal of the Legacy Import.
//
// Reads the import file and prints SQL that provisions one placeholder Member
// per profile_id and one placeholder Group per group_id, carrying the file's
// ids, plus the rehearsal Moderator. No name from the file is read or printed.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const REHEARSAL_MODERATOR = {
  id: "facade00-0000-4000-8000-000000000001",
  email: "rehearsal-moderator@test.local",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function fixtureSql(rows) {
  const members = [...new Set(rows.map((row) => row.profile_id))].sort();
  const groups = [...new Set(rows.map((row) => row.group_id))].sort(
    (a, b) => a - b,
  );
  for (const id of members)
    if (!UUID.test(id)) throw new Error(`not a uuid: ${id}`);
  for (const id of groups)
    if (!Number.isInteger(id)) throw new Error(`not a Group id: ${id}`);
  const lines = ["begin;"];
  const users = [
    [REHEARSAL_MODERATOR.id, REHEARSAL_MODERATOR.email],
    ...members.map((id, n) => [id, `rehearsal-${n + 1}@test.local`]),
  ];
  lines.push(
    "insert into auth.users (id, email) values",
    users.map(([id, email]) => `  ('${id}', '${email}')`).join(",\n"),
    "on conflict (id) do nothing;",
  );
  lines.push(
    "insert into public.profiles (id, full_name, email, role, status, joined_at) values",
    [
      `  ('${REHEARSAL_MODERATOR.id}', 'Moderator repetiție', '${REHEARSAL_MODERATOR.email}', 'moderator', 'activ', '2025-01-01')`,
      ...members.map(
        (id, n) =>
          `  ('${id}', 'Membru repetiție ${n + 1}', 'rehearsal-${n + 1}@test.local', 'voluntar', 'activ', '2025-01-01')`,
      ),
    ].join(",\n"),
    "on conflict (id) do nothing;",
  );
  lines.push(
    "insert into public.groups (id, name, category, min_level) overriding system value values",
    groups
      .map((id) => `  (${id}, 'Grup repetiție ${id}', 'project', 0)`)
      .join(",\n"),
    "on conflict (id) do nothing;",
    "select setval(pg_get_serial_sequence('public.groups', 'id'), (select max(id) from public.groups));",
    "update public.groups set status = 'active' where id in (" +
      groups.join(", ") +
      ");",
  );
  lines.push("commit;");
  return lines.join("\n") + "\n";
}

// Only when run as a script: importing fixtureSql must not read a file.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!process.argv[2]) {
    console.error(
      "usage: node scripts/legacy-import-rehearsal-fixture.mjs <import-set.json>",
    );
    process.exitCode = 2;
  } else {
    process.stdout.write(
      fixtureSql(JSON.parse(readFileSync(process.argv[2], "utf8"))),
    );
  }
}
```

- [ ] **Step 2: The runner** — create `scripts/legacy-import-rehearsal.sh`:

```bash
#!/usr/bin/env bash
# scripts/legacy-import-rehearsal.sh -- #1049: the Legacy Import, end to end, on the LOCAL stack with the real file.
#
#   npx supabase db reset && bash scripts/legacy-import-rehearsal.sh ../osubb-legacy-import/import-set.json
#
# Provisions placeholder Members and Groups carrying the file's ids, then runs
# the import script three times: a dry run, the real run, and the real run
# again (every row already imported, totals still verified). Local only: the
# database container and API URL come from the local stack, never from the
# environment. Reset the database afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:?usage: bash scripts/legacy-import-rehearsal.sh <import-set.json>}"
[ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 2; }

CONTAINER="supabase_db_$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml)"
STATUS="$(npx supabase status -o env)"
API_URL="$(printf '%s\n' "$STATUS" | sed -n 's/^API_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
SECRET="$(printf '%s\n' "$STATUS" | sed -n 's/^SECRET_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
[ -n "$SECRET" ] || SECRET="$(printf '%s\n' "$STATUS" | sed -n 's/^SERVICE_ROLE_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"

case "$API_URL" in
  http://127.0.0.1:* | http://localhost:*) ;;
  *) echo "Refusing to rehearse against '$API_URL': the rehearsal only ever runs on the local stack." >&2; exit 2 ;;
esac
[ -n "$SECRET" ] || { echo "The local secret key could not be read from 'supabase status'." >&2; exit 2; }

echo "Provisioning placeholder Members and Groups in $CONTAINER"
node scripts/legacy-import-rehearsal-fixture.mjs "$FILE" \
  | docker exec -i "$CONTAINER" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -q -f -

run() {
  SUPABASE_URL="$API_URL" SUPABASE_SECRET_KEY="$SECRET" \
    node scripts/import-legacy-tasks.mjs --file "$FILE" --actor rehearsal-moderator@test.local "$@"
}

echo "--- dry run ---";            run --dry-run
echo "--- the real run ---";       run --execute
echo "--- the real run, again ---"; run --execute

echo "REHEARSAL PASSED: the file imported end to end and its totals verified twice."
echo "Now look at the result in the local app, then: npx supabase db reset"
```

- [ ] **Step 3: Shell and tooling checks**

Run: `npm run lint:shell && node --check scripts/legacy-import-rehearsal-fixture.mjs`
Expected: PASS.

- [ ] **Step 4: Rehearse with the real file.** Confirm no other session is using the local stack, then:

```bash
npx supabase db reset
```

```bash
bash scripts/legacy-import-rehearsal.sh ../osubb-legacy-import/import-set.json
```

Expected: the dry run ends `Dry run: 5270 would be imported, 0 already imported. Nothing was written.`; the real run ends `Verified: 5270 rows and 28609 points are in, matching the file for every Group and Member.`; the second real run reports every batch as `0 imported, 100 already imported` and verifies again; the last line is `REHEARSAL PASSED`. Note the slowest batch's time: it must stay well under the 8-second statement timeout; if it does not, production runs with `--batch-size 50`.

If the file's totals have changed since this plan was written, the expected numbers are those of `../osubb-legacy-import/import-summary.json`.

- [ ] **Step 5: Look at the result in the local app** (`preview_start` with the app's dev server, signed in as a seeded leader): one imported Task's details and history ("Sistem" as the actor, the completion day as the date), one placeholder Member's points, Clasament with a March 2026 range, the promotion candidates. Then:

```bash
npx supabase db reset
```

- [ ] **Step 6: Commit**

```bash
git add scripts/legacy-import-rehearsal-fixture.mjs scripts/legacy-import-rehearsal.sh
git commit -m "feat(scripts): a local end-to-end rehearsal of the Legacy Import (#1049)"
```

---

### Task 8: PR 1

- [ ] **Step 1: Every gate, locally**

Run: `npx supabase db reset && npx supabase test db && bash scripts/check-local-ci.sh`
Expected: every gate PASS. Do not run the vitest gate while a `db reset` or the pgTAP run is in progress.

- [ ] **Step 2: Push and open the PR** (title and body below; the body ends with the attribution line this session's reminder gives):

```bash
git push -u origin feat/1049-legacy-task-import
```

```bash
gh pr create --repo Alex-Bancila/osubb-app --base main --title "The one-time Legacy Task Tracker import (#1049)" --body-file /tmp/pr-1049.md
```

`/tmp/pr-1049.md`:

```markdown
Closes #1049

## What

The one-time Legacy Import (spec `docs/superpowers/specs/2026-10-13-legacy-task-import-design.md`, ADR-0007 amendment of 2026-10-14, ruling R53):

- `public.legacy_task_imports` — which sheet row became which Task; the idempotency key.
- `private.reject_legacy_evaluation_source` — still refuses `legacy_migration`, except for a registered Task.
- `public.import_legacy_tasks` — service role only, the Moderator as acting Member; writes a sheet row as a terminal Task dated on its completion day, with its points; no Notification.
- `public.legacy_task_import_totals` — the read the script compares its file with.
- `scripts/import-legacy-tasks.mjs` — dry run, batches, resume, read-back comparison.
- `scripts/legacy-import-rehearsal.sh` — the local end-to-end rehearsal.

## Not in this PR

The production run (after the Release; `docs/backend/legacy-task-import.md`) and dropping the command (#1050). No import data is in the repository.

## Tests

`supabase/tests/legacy_task_import.test.sql` (68 assertions, six mutation guards recorded in its header), `scripts/import-legacy-tasks.test.mjs` (13 tests), one copy test. Rehearsed locally with the real file: 5 270 rows / 28 609 points verified twice.
```

- [ ] **Step 3: Review.** Wait for CodeRabbit, apply its real findings, answer the rest. Bind the PR and read CI with the ccd_pr tools; never poll.

- [ ] **Step 4: Merge when CI is green and the review is settled** (the standing "merge as you go" instruction), then delete the branch and the worktree. The Release to production is Alex's approval in the GitHub Environment.

---

### Task 9: The production run

Done together with Alex, following `docs/backend/legacy-task-import.md`. Nothing here is done without him at the keyboard for the secret key.

- [ ] **Step 1: Preconditions.** PR 1 is released to production (`select 1 from pg_proc where proname = 'import_legacy_tasks'` answers a row); every Group the file names exists and is active; the file was rebuilt today (`node parse.js && node match.js && node build-import.js`) so a Member deactivated since is caught by the dry run.
- [ ] **Step 2: Backup confirmed** — its time written into the issue.
- [ ] **Step 3: Dry run** — the plan lines match `import-summary.json`; `0 already imported`.
- [ ] **Step 4: The real run** — ends with `Verified: …`.
- [ ] **Step 5: Look** — three Tasks, one Member, Clasament for March 2026, the promotion candidates.
- [ ] **Step 6: Record the result** in #1049's thread (rows, points, the time) and in `../osubb-legacy-import/REPORT.md`.

---

### Task 10: PR 2 — close the import (#1050)

**Files:**

- Create: `supabase/migrations/<ts>_legacy_task_import_closed.sql`
- Replace: `supabase/tests/legacy_task_import.test.sql`
- Modify: `CLAUDE.md`, `docs/backend/legacy-task-import.md`, `docs/backend/conventions.md`, `app/src/lib/database.types.ts`
- Keep: `scripts/import-legacy-tasks.mjs`, its test and the rehearsal scripts stay in the repository as the record of what ran.

**Interfaces:**

- Consumes: the verified production run (Task 9).
- Produces: a database with no way to write a `legacy_migration` Evaluation.

- [ ] **Step 1: Branch**

```bash
git fetch origin && git worktree add ../osubb-app-legacy-close -b chore/1050-close-legacy-task-import origin/main
```

- [ ] **Step 2: Replace the suite with the closed-state suite** — `supabase/tests/legacy_task_import.test.sql` becomes:

```sql
-- legacy_task_import.test.sql -- #1050: the Legacy Import is closed.
--
-- #1049's command wrote the pre-app Task Tracker history once and is gone.
-- What stays is pinned here: the registry as provenance, readable by no
-- role, and the legacy source refused for every Task outside it -- with
-- nothing left that can register one.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(6);

select hasnt_function('public', 'import_legacy_tasks', array['uuid', 'jsonb', 'boolean'],
  'the import command is gone');
select hasnt_function('public', 'legacy_task_import_totals', '{}'::name[],
  'the totals read is gone');
select has_table('public', 'legacy_task_imports', 'the registry stays as provenance');
select ok(not has_table_privilege('authenticated', 'public.legacy_task_imports', 'select')
          and not has_table_privilege('service_role', 'public.legacy_task_imports', 'select')
          and not has_table_privilege('service_role', 'public.legacy_task_imports', 'insert'),
  'no role reads or writes the registry');
select is(
  (select count(*) from pg_proc as fn
    where fn.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and fn.prosrc ~* 'insert\s+into\s+public\.legacy_task_imports'),
  0::bigint, 'no function writes the registry any more');

insert into auth.users (id, email) values ('10500000-0000-0000-0000-000000000001', 'lc1@test.local');
insert into public.profiles (id, full_name, email, role, status)
values ('10500000-0000-0000-0000-000000000001', 'Voluntar LC', 'lc1@test.local', 'voluntar', 'activ');
insert into public.groups (name, category, min_level) values ('Dept LC', 'department', 0);
insert into public.tasks (title, group_id, audience, assignment_mode, kind, status)
select 'Task LC', id, 'local', 'direct', 'task', 'todo' from public.groups where name = 'Dept LC';
insert into public.task_assignments (task_id, member_id)
select id, '10500000-0000-0000-0000-000000000001' from public.tasks where title = 'Task LC';
select throws_ok(
  $$insert into public.task_evaluations (task_id, assignment_id, source, evaluated_by, outcome, difficulty, rating, points, note)
    select task.id, assignment.id, 'legacy_migration', null, 'completed', 3, 5, 9, 'închis'
      from public.tasks as task join public.task_assignments as assignment on assignment.task_id = task.id
     where task.title = 'Task LC'$$,
  '23514', 'task_evaluation_legacy_source_closed',
  'a legacy_migration Evaluation is refused');

select * from finish();
rollback;
```

The fixture prefix `10500000` is #1050's number followed by zeros.

- [ ] **Step 3: Run and watch it fail**

Run: `npx supabase db reset && npx supabase test db supabase/tests/legacy_task_import.test.sql`
Expected: FAIL — "the import command is gone".

- [ ] **Step 4: The migration**

```bash
npx supabase migration new legacy_task_import_closed
```

```sql
-- #1050: the Legacy Import is closed -- its command and its totals read are dropped
--
-- #1049 imported the pre-app Task Tracker history into production on the day
-- recorded in that issue, verified against its file. Nothing writes
-- public.legacy_task_imports any more, so private.reject_legacy_evaluation_source
-- refuses every new legacy_migration Evaluation again without being touched.
-- The registry stays: it is the record of which sheet row became which Task.
drop function public.import_legacy_tasks(uuid, jsonb, boolean);
drop function public.legacy_task_import_totals();

comment on table public.legacy_task_imports is
  '#1049, #1050: the closed record of the Legacy Import -- one row per row of a legacy Google Sheets Task Tracker that became a Task in 2026-10 (the Drive file id of the tracker, the row number in its Tasks tab, the sheet''s own Id, the Task). A Task deleted for good since keeps its row with task_id null. Nothing writes this table any more: the import command was dropped by #1050. RLS on with no policy and no grant to any role. Excluded from the live change broadcast.';
```

- [ ] **Step 5: Run, regenerate types, pass**

Run: `npx supabase db reset && npx supabase test db && npm --prefix app run gen:types`
Expected: PASS; `database.types.ts` loses the two functions.

- [ ] **Step 6: The documents.**
  - `package.json` is not changed: `test:tooling` keeps running `scripts/import-legacy-tasks.test.mjs`, which needs no database.
  - `CLAUDE.md` house rule 9 becomes: `9. **Never re-run one-shot scripts**: \`scripts/create-github-issues.sh\` (historical), the 2026-08-19 backlog split, \`scripts/bootstrap-production.mjs\` (#112) and \`scripts/import-legacy-tasks.mjs\` with its rehearsal (#1049) are done; the Legacy Import's command no longer exists (#1050).` If rule 9 already names the bootstrap script, add only the Legacy Import clause.
  - `CLAUDE.md` Status: the Legacy Import bullet's last sentence becomes `It ran in production on <date> (<rows> rows, <points> points) and is closed: #1050 dropped the command, and \`public.legacy_task_imports\` remains as provenance.`
  - `docs/backend/legacy-task-import.md`: add under the title `> **Closed.** The import ran on <date> and its command was dropped by #1050. This page is the record of how it was done; nothing on it can be run any more.`
  - `docs/backend/conventions.md` §2: in the bulk-loads paragraph, `(#1049, until #1050 drops it)` becomes `(#1049, dropped by #1050 after its one run)`.

- [ ] **Step 7: Gates, PR, review, merge** — as Task 8, with:

```bash
gh pr create --repo Alex-Bancila/osubb-app --base main --title "Close the Legacy Import: drop its command (#1050)" --body-file /tmp/pr-1050.md
```

`/tmp/pr-1050.md`:

```markdown
Closes #1050

The Legacy Import ran in production on <date>: <rows> rows and <points> points, verified against its file (#1049). This drops `public.import_legacy_tasks` and `public.legacy_task_import_totals`. Nothing writes `public.legacy_task_imports` any more, so the `legacy_migration` Evaluation source is closed again without touching its trigger; the registry stays as provenance. The suite now pins the closed state.
```

---

## Self-Review

- **Spec coverage.** Decision and rules → Tasks 2, 4 (mapping) and the import file; "What one row becomes" → Task 2 Steps 4 and 6; the command's six steps → Task 2; provenance and the closed source → Tasks 1 and 3; the script → Task 4; accepted consequences → Task 2 (promotion candidates, period reads, no Notification, no actor), Task 6 (runbook: quiet hour); rollout → Tasks 7–10; tests → Tasks 1–5; documents → Task 6 and Task 10; out of scope → nothing built.
- **Changed while planning, and folded back into the spec:** the registry has no grant at all and the totals come from a function; the activity rows have no actor (the `task_create` cap); reopen of an imported Task is refused by the unchanged `reopen_task`, with copy for it; `imported_by` is nullable.
- **Names.** `public.legacy_task_imports`, `public.import_legacy_tasks(uuid, jsonb, boolean)`, `public.legacy_task_import_totals()`, `private.reject_legacy_evaluation_source()`, `scripts/import-legacy-tasks.mjs` and the row keys (`tracker_id`, `sheet_row`, `sheet_id`, `group_id`, `executor_id`, `title`, `description`, `difficulty`, `rating`, `outcome`, `completed_on`, `deadline_on`, `note`) are the same in every task.
- **Review Focus.** Unreadable dates: Task 4, tests 1 and 3. No answer and resume: Task 2 ("a second call…", "a call mixing…") and Task 4 ("a call that gets no answer…"). Deactivated Member or archived Group: Task 2 ("a refusal names the offending row", `group_archived`). Daylight saving: Task 2 ("a row completed on the day the clocks change…"). Diacritics: Task 2 (`Ședință ratată`, `Observație din foaie: ședință`) and Task 4 (`Ședință`, `Titlul întreg`).
