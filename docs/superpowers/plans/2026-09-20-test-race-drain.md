# `test_race` Async Drain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pgTAP `pg_temp.test_race` helper reliably drain and clean up asynchronous `dblink` work on Windows and Linux.

**Architecture:** Keep the change entirely inside the test helper. Consume the expected result from connection B, drain libpq until no result remains, and make exception cleanup connection-aware so the original test failure is never replaced by a leaked asynchronous command.

**Tech Stack:** PostgreSQL PL/pgSQL, `dblink`, pgTAP, Supabase CLI 2.117.0

**Spec:** `docs/superpowers/specs/2026-09-20-stabilization-member-auth-design.md`

## Global Constraints

- Work on `fix/596-test-race-drain`, based on current `origin/main`, in an isolated worktree.
- Modify only `supabase/tests/_helpers.sql`.
- Do not edit migrations or production functions.
- Keep the helper result shape exactly `result_a text, result_b text, b_waited boolean`.
- Do not review or merge any pull request.

---

### Task 1: Reproduce the undrained asynchronous result

**Files:**
- Test: `supabase/tests/groups_sync.test.sql`
- Inspect: `supabase/tests/_helpers.sql`

**Interfaces:**
- Consumes: `pg_temp.test_race(p_setup_sql text, p_sql_a text, p_sql_b text)`.
- Produces: a captured failing run showing the helper leaves connection B busy before transaction cleanup.

- [ ] **Step 1: Install dependencies and start the local stack**

Run: `npm install` followed by `npx supabase start`.

Expected: dependencies are present and the local stack reports healthy services.

- [ ] **Step 2: Reset the database**

Run: `npx supabase db reset`.

Expected: all migrations and the local seed apply successfully.

- [ ] **Step 3: Run the focused existing regression**

Run: `npx supabase test db supabase/tests/groups_sync.test.sql`.

Expected before the fix: FAIL with an asynchronous `dblink` cleanup error such as `another command is already in progress`, or with fewer than all 48 planned assertions executed.

- [ ] **Step 4: Record the mutation caught by the regression**

The production change that must make the test fail is: removing the post-result drain or trying to commit/disconnect connection B while libpq still has a pending result.

### Task 2: Drain and disconnect both race connections

**Files:**
- Modify: `supabase/tests/_helpers.sql` in `pg_temp.test_race`
- Test: `supabase/tests/groups_sync.test.sql`

**Interfaces:**
- Consumes: named `dblink` connections already opened by `pg_temp.test_race`.
- Produces: the unchanged table result `(result_a text, result_b text, b_waited boolean)` with no live named connection after success or failure.

- [ ] **Step 1: Add local state for connection-aware cleanup**

Inside `pg_temp.test_race`, track whether each generated connection name is present using:

```sql
v_connections text[];
v_discard text;
v_original_message text;
v_original_detail text;
v_original_hint text;
v_original_context text;
```

- [ ] **Step 2: Drain connection B before commit on the success path**

After the existing strict read of `result_b`, consume the terminal libpq result before issuing `commit`:

```sql
loop
  select remote_result
    into v_discard
    from extensions.dblink_get_result(v_connection_b)
      as remote(remote_result text);
  exit when not found;
end loop;

perform extensions.dblink_exec(v_connection_b, 'commit');
```

- [ ] **Step 3: Make exception cleanup independent per connection**

At the start of the exception handler, capture the original diagnostics. For each name found in `extensions.dblink_get_connections()`, cancel a busy asynchronous query, drain until `dblink_get_result` returns no row, attempt `rollback`, and disconnect. Wrap cleanup of each connection in its own nested `begin … exception when others then null; end` so one cleanup failure cannot skip the other.

Re-raise the original error with its original SQLSTATE and captured message/detail/hint:

```sql
raise exception using
  errcode = sqlstate,
  message = v_original_message,
  detail = v_original_detail,
  hint = v_original_hint;
```

- [ ] **Step 4: Run the focused test to verify green**

Run: `npx supabase test db supabase/tests/groups_sync.test.sql`.

Expected: PASS with all 48 planned assertions.

- [ ] **Step 5: Run the helper consumers**

Run: `npx supabase test db`.

Expected: all database suites pass once.

- [ ] **Step 6: Run the full database suite a second time without reset**

Run: `npx supabase test db`.

Expected: all database suites pass again, proving no connection or row cleanup leaked from the first run.

### Task 3: Verify interruption recovery and repository gates

**Files:**
- Verify only: `supabase/tests/_helpers.sql`

**Interfaces:**
- Consumes: the completed helper.
- Produces: recorded commands suitable for issue #596's PR body.

- [ ] **Step 1: Run a deliberately failing race call**

Use a temporary pgTAP invocation whose query B raises `select 1 / 0`, then immediately rerun `groups_sync.test.sql`.

Expected: the deliberate call reports division by zero; the subsequent suite still executes all 48 assertions without a named-connection or asynchronous-command error.

- [ ] **Step 2: Run database lint**

Discover the pinned CLI syntax with `npx supabase db lint --help`, then run the local database lint command against the local stack.

Expected: exit 0 with no new warning attributable to `_helpers.sql`.

- [ ] **Step 3: Run the database local-CI gate**

Run: `bash scripts/check-local-ci.sh db`.

Expected: the database gate exits 0.

- [ ] **Step 4: Inspect the exact diff**

Run: `git diff --check` and `git diff -- supabase/tests/_helpers.sql`.

Expected: no whitespace errors and no changed file outside `_helpers.sql`.

- [ ] **Step 5: Commit the issue change**

```bash
git add supabase/tests/_helpers.sql
git commit -m "test(db): drain asynchronous race results"
```
