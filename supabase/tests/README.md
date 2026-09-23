# Database tests

Run the complete pgTAP suite with the repository's pinned Supabase CLI:

```sh
npx --yes supabase@2.117.0 test db
```

Pass a file path to run one suite while developing:

```sh
npx --yes supabase@2.117.0 test db supabase/tests/rls_teams_reference.test.sql
```

On NixOS, run the same commands through the compatibility wrapper:

```sh
nix run --impure nixpkgs#steam-run -- npx --yes supabase@2.117.0 test db
```

## Shared helpers

Every `*.test.sql` suite runs in a transaction and sources `_helpers.sql`
immediately after `begin`:

```sql
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
```

The sentinel tells `_helpers.sql` that it is being included. Without the
sentinel, Supabase discovers the helper as an ordinary SQL file and runs its
own 14-assertion contract test. This dual mode keeps the shared test plumbing
covered without repeating those assertions in every suite.

- `pg_temp.test_login(uuid, jsonb)` uses the supplied JSON as the exact
  `app_metadata`, builds the JWT's `sub` and authenticated `role`, and
  switches the SQL role to `authenticated`. Pass JSON arrays explicitly,
  such as `'["edu"]'::jsonb`; the helper deliberately does not derive,
  normalize, or repair stale and forged metadata.
- `pg_temp.test_login_leadership(uuid)` derives canonical role, level,
  Department IDs, Team IDs, and Group IDs from the suite's live profile and
  membership fixtures. Use it only when the test needs those current database
  facts.
- `pg_temp.test_clear_jwt()` clears `request.jwt.claims` but preserves the
  current SQL role. Write `reset role` or `set local role ...` explicitly
  when the next assertion needs a different role.
- `pg_temp.test_race(sql_a, sql_b)` runs two SQL statements under the exact
  current JWT. Each statement must be a `select` returning exactly one text
  cell. Transaction A holds its locks while B is observed either waiting or
  completing; A then commits, the helper retrieves B's result, and B commits.
  The returned columns are `result_a text`, `result_b text`, and
  `b_waited boolean`. The helper applies timeouts and disconnects both
  dblink sessions on success or failure.

Race fixtures must be committed before `test_race` runs because its dblink
sessions cannot see uncommitted rows from the outer test transaction. Those
remote commits also mean the outer `rollback` cannot remove the fixtures.
Create them through a setup connection, delete any stale copies before the
test, and explicitly clean them up afterward. A may already have committed
when B fails, so failure paths need that cleanup too. See
`independent_team_membership_concurrency.test.sql` and the race section in
`project_membership_commands.test.sql`.

Fixture setup connections set a session-level `lock_timeout = '2s'` (#621).
An interrupted run can leave committed rows that the next suite transaction
locks before its side connection reaches cleanup. In that case cleanup fails
quickly with PostgreSQL's relation/tuple context and the named dblink connection,
instead of waiting forever on its own suite. This is the issue's fail-fast option:
it does not promise automatic recovery or delete another session's fixtures.
The timeout applies to setup/cleanup connections only; the competing race
sessions retain their existing timeouts and assertions.

## Seed-independent runs

All SQL files except `demo_seed.test.sql` must pass without demo data:

```bash
npx --yes supabase@2.117.0 db reset --no-seed
test_suites=()
for suite in supabase/tests/*.sql; do
  [[ "$suite" == supabase/tests/demo_seed.test.sql ]] || test_suites+=("$suite")
done
npx --yes supabase@2.117.0 test db "${test_suites[@]}"
npx --yes supabase@2.117.0 db reset
```

The final reset restores the normal seeded development database.

## Upgrade harnesses

`*_upgrade.test.sh` replay one historical migration inside a rolled-back
transaction over a database that already holds rows, which a `db reset` never
does. CI runs every one after the pgTAP suites (`bash "$harness"`), against the
seeded stack.

A harness can only replay a migration whose objects still exist. When a later
migration deletes what an old one creates, the old proof is retired and its
replacement named here:

- **#579 (the origin-bridge drop)** retired `tasks_origin_upgrade.test.sh`
  (#284: the one-Origin CHECK over legacy `dept_id`/`team_id`/`project_id`)
  and `tasks_group_id_backfill_upgrade.test.sh` (#519: the `group_id` backfill
  and the bridge triggers). Both replayed migrations that recreate the legacy
  columns #579 deletes. `origin_drop_upgrade.test.sh` replaces them: it restores
  the pre-drop shape with both identities on every row, replays
  `20260922134557_drop_origin_bridge.sql`, proves a clean database loses
  nothing, and proves each guard (`work_row_group_id_null`,
  `work_row_on_native_group`, and the four `*_group_origin_disagreement`
  reasons) refuses its planted fault. What the retired harnesses proved about
  live rows is now a precondition #579's guards check on the real database.
- `tasks_lifecycle_upgrade.test.sh` stays: its teardown re-adds `tasks.dept_id`
  and `team_id` as plain nullable columns, because the pre-#287 policy it
  replays names them.

Task fixtures in suites and harnesses name their Group, never a legacy id:
`pg_temp.dept_group(text)`, `pg_temp.team_group(text)` and
`pg_temp.project_group(bigint)` in `_helpers.sql` resolve a Department, Team
or Project id to the Group the forward mirror derived for it (security
definer, so the lookup answers the same for a claimless persona). SQL sent
through `dblink` runs in another session with no `pg_temp`, so it inlines the
same lookup as a subquery over `groups.legacy_*`.

## Fixtures and names

Existing test UUIDs are grandfathered. For new fixtures, use a recognizable
UUID prefix tied to the issue number and unique suffixes within the suite.
This makes leaked or conflicting fixtures easy to trace.

If demo rows would affect exact assertions, truncate only the tables the suite
owns, after `begin`, so rollback restores them. Never truncate reference data
such as roles, departments, guides, or capabilities.

Name new suites `<area>_<aspect>.test.sql`, using domain terms from
`CONTEXT.md`.
