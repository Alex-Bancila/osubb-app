# Backend conventions — Stack B Implementation Plan (2026-09-11)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three unassigned backend-conventions issues — #215 (Educațional display name), #366 (`docs/backend/conventions.md`), #365 (machine-checked house rules: `db lint` that can fail, plus a conventions pgTAP sweep) — as three independent PRs to `main`.

**Architecture:** One data-only migration (#215); one document plus two pointer lines (#366); one small grants migration, one new pgTAP suite and two CI steps (#365). No product behaviour changes. **No stacking**: the repo's "Automatically delete head branches" setting is still off (`delete_branch_on_merge=false`, checked 2026-09-11), which is what turned the last two stacks into mis-merges, and none of these three PRs needs another's content to build. Three branches from `main`, three PRs to `main`.

**Tech stack:** Supabase CLI 2.117.0 (`npx supabase`, pinned at the repo root), PostgreSQL 15, pgTAP, GitHub Actions.

**Spec:** the three issue bodies (#215, #366, #365) and CLAUDE.md house rules 1–5 and 12. ADR-0007 §Server-command boundary defines the command shape the conventions doc records.

**Skipped, on purpose:** #371 (retire `role_capabilities`) is assigned to dobrerares. #379 (policy/constraint rename migration) is optional and blocked by #366 — left for a later decision; the conventions doc names the target scheme so #379 has something to apply.

## Global Constraints

- One issue = one branch = one PR, body `Closes #n`, CI green; **never merge, never push to `main`** (house rule 7). Commits end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Every schema change is a migration created with `npx supabase migration new <name>`; never edit the database by hand (house rule 1). Reference data lives in migrations, not `seed.sql` (rule 6).
- Tests ship in the same PR and must fail if the feature is removed (rule 5). Verify with `npx supabase db reset && npx supabase test db`, **strictly sequentially — never two database passes at once** (the dblink race suites deadlock). Another interactive session (`osubb-app-78`) is open on this machine; if a reset or test run hangs, check `docker exec -i supabase_db_osubb-app psql -U postgres -At -c "select pid, state, wait_event_type, left(query,60) from pg_stat_activity where datname='postgres' and pid<>pg_backend_pid()"` before assuming a bug.
- Migration header convention: first line `-- #<issue>: <one-line purpose>`; comments explain *why*.
- Test skeleton (from `supabase/tests/README.md`): `begin;` → `\set osubb_test_suite true` → `\ir _helpers.sql` → `set local search_path = public, extensions;` → `create extension if not exists pgtap with schema extensions;` → `select plan(N);` … `select * from finish(); rollback;`.
- Generated types: a data-only migration must not change `app/src/lib/database.types.ts`; a schema-shape change must regenerate it (`cd app && npm run gen:types`) or CI fails.
- Do not touch demo copy in `supabase/seed.sql` (out of #215's boundary; #296 rebuilds the seed). Do not edit `scripts/create-github-issues.sh` and never execute it.

## Facts verified on `main` @ `3e84ab4` (2026-09-11)

- `departments` row `edu` has `name = 'Educational'` (`supabase/migrations/0001_core_schema.sql:43`); `CONTEXT.md:36` and `docs/brand/reference.md:19` spell it `Educațional` with **U+021B** (ț, comma below) — the same codepoint `0001_core_schema.sql` already uses in `Organizație`. `app/src` hardcodes no department names (they come from the table). `supabase/tests/departments_reference.test.sql` exists (`plan(8)`, added by #310) and is the natural home for the new assertions. Seed rows `'Ședință Educational'` (events, `seed.sql:293`) and announcement `author = 'Educational'` (`seed.sql:343`) are demo copy — leave them.
- **Live sweep baseline** (read-only queries against the local stack at current `main`):
  - Definers lacking `search_path`: none in `public`/`private` (only Supabase's own `graphql.get_schema_version`/`increment_schema_version` — out of scope).
  - Functions in `public` executable by `anon`: exactly three, all **trigger functions** — `guard_profile_privileged_columns()`, `sync_task_ledger()`, `sync_assignee_ledger()` — because they predate the repo's revoke discipline and Postgres grants EXECUTE to PUBLIC by default. Nothing in `private` is anon-executable. Every new function starts anon-executable until someone revokes it: Supabase's own default ACL (`pg_default_acl`, role `postgres`, schema `public`, type `f`) grants EXECUTE to `anon`, `authenticated` and `service_role` **explicitly**, and Postgres's built-in global default grants it to PUBLIC in every schema. A probe function created as `postgres` (rolled back) confirmed it: `public` → `anon=true` (ACL `=X/postgres … anon=X/postgres …`); `private` → `anon=true` via PUBLIC. **Changing the defaults is not a safe fix:** per-schema `alter default privileges` cannot revoke a globally granted privilege (Postgres docs, ALTER DEFAULT PRIVILEGES), and a *global* revoke for role `postgres` would also strip PUBLIC from `pg_temp` functions the test suites create and later call as `authenticated` (`_helpers.sql`, `rls_deny_by_default.test.sql`). Enforcement therefore stays where it already works — an explicit revoke per function, and the sweep naming any function that lacks one.
  - Views: `member_points` (`security_invoker=off`) and `profiles_contact` (no option = owner rights) are the two documented exceptions; `dept_cup`, `leaderboard`, `my_points`, `profiles_directory` are invoker.
  - `private` schema: USAGE granted to `authenticated` only (policies evaluate `private.can_*`/`is_*` helpers as the caller); `anon` and `service_role` have none. `pgrst.db_schemas` is not a GUC locally (`current_setting` → null), so PostgREST exposure can only be checked in `supabase/config.toml` (`[api] schemas = ["public", "graphql_public"]`).
- **`supabase db lint` at 2.117.0** already lints `private` by default (output: "Linting schema: private / public") and is clean at `--level warning`. Its `--fail-on` flag defaults to `none`, so **the current CI step can never fail** — that, not the schema list, is the real gap. Flags confirmed from `--help`: `--schema/-s`, `--level {warning,error}`, `--fail-on {none,warning,error}`.
- **`supabase test db` connects as `postgres`** (verified with a scratch suite: `current_user = 'postgres'`, `rolsuper = false` — Supabase's `postgres` is privileged, not a superuser). Migrations run as the same role, so a function the suite creates inherits exactly the ACL a migration's function would — which is what makes Task 3's probe a faithful stand-in for "a migration that forgot its revoke".
- Revoke precedent for a trigger function: `20260910135327_remove_manual_awards.sql:23` — `revoke all on function public.reject_manual_award() from public, anon, authenticated;`. Postgres checks EXECUTE on a trigger function only at `CREATE TRIGGER`, never when the trigger fires, so revoking is runtime-neutral.
- Conventions the doc must record, as the code actually is today: 24 `raise exception using errcode = …` vs 27 `raise sqlstate 'PTxxx' using message = 'snake_case'`; six `23514` trigger messages are English sentences (`20260909003930`); policy names are mostly `<table>_<verb>[_qualifier]` (`projects_read`, `teams_create`, `attendance_insert_self`) with legacy singulars (`task_read`, `event_read`, `ledger_read`, `request_*`, `assignee_*`); constraints end `_ck` (9) with a few descriptive tails from the Projects work (`_valid`, `_ordered`, `_not_blank`); indexes `_idx` (27) / `_uidx` (1); the wrapper→`private.*_impl` command shape with `require_*` helpers returning the actor uuid (`20260909151741_project_membership_commands.sql`, `20260910154759`, `20260910180228`); `private.*_impl` functions are executable by `authenticated` (an invoker wrapper calls them as the caller) while `private.require_*` and trigger functions are not; `projects.updated_at` is maintained by hand in one command (`#368` will add `private.set_updated_at()`); `tasks.deadline` is a `date` (#283 converts it). `docs/backend/` holds `auth-config.md`, `implementation-issues.md`, `inviting.md`, `seeding-staging.md` — no conventions file. CLAUDE.md house rules are lines 18–32; rule 4 (line 21) is the natural anchor for the pointer.

---

### Task 1: #215 — display the Educațional department with its diacritic

**Files:**
- Create: `supabase/migrations/<timestamp>_educational_display_name.sql` (via `npx supabase migration new educational_display_name`)
- Modify: `supabase/tests/departments_reference.test.sql` (header comment, `plan(8)` → `plan(11)`, three assertions)

**Interfaces:** none. Data-only; `database.types.ts` must be byte-identical afterwards.

- [ ] **Step 1: Branch** — `git switch -c fix/215-educational-name origin/main`.
- [ ] **Step 2: Write the failing tests** — append to `departments_reference.test.sql` (before `select * from finish();`), and change `select plan(8);` to `select plan(11);`; add `-- #215: display name corrected to Educațional.` to the file's header comment:

```sql
-- #215: the display name carries the comma-below ț (U+021B) that CONTEXT.md
-- and 0001_core_schema.sql's own 'Organizație' use — not the cedilla form —
-- and the stable identifier is untouched.
select is((select name from departments where id = 'edu'), 'Educațional',
  'edu displays as Educațional');
select ok((select position(chr(539) in name) > 0 from departments where id = 'edu'),
  'the ț in Educațional is U+021B (comma below), matching CONTEXT.md');
select is((select count(*) from departments where id = 'edu'), 1::bigint,
  'exactly one edu department, id unchanged');
```

- [ ] **Step 3: Run it to see it fail** — `npx supabase test db supabase/tests/departments_reference.test.sql`. Expected: the first two new assertions fail (`Educational` ≠ `Educațional`; no U+021B), the third passes. Paste the output in the report.
- [ ] **Step 4: Migration** — `npx supabase migration new educational_display_name`, then the file body (copy the `ț` from `CONTEXT.md`; the file is UTF-8, no BOM):

```sql
-- #215: the Educațional department's display name was stored without its
-- diacritic ('Educational', 0001_core_schema.sql:43). Correct the display value
-- only. The identifier 'edu' is referenced by foreign keys, the JWT dept_ids
-- claim, seed rows and tests, and must never change.
update public.departments
   set name = 'Educațional'
 where id = 'edu'
   and name is distinct from 'Educațional';
```

- [ ] **Step 5: Reset and run the whole suite** — `npx supabase db reset && npx supabase test db`. Expected: all suites pass (departments_reference now `1..11`).
- [ ] **Step 6: Prove types are unchanged** — `cd app && npm run gen:types && git diff --exit-code src/lib/database.types.ts && cd ..`. Expected: no diff (data-only). If it diffs, stop: something else changed the schema.
- [ ] **Step 7: Prove the codepoint in the file** — `node -e "const s=require('fs').readFileSync(process.argv[1],'utf8');console.log([...s.match(/Educa(.)ional/)[1]][0].codePointAt(0).toString(16))" supabase/migrations/<timestamp>_educational_display_name.sql` → `21b`.
- [ ] **Step 8: Commit and PR** — `git add supabase/migrations/<timestamp>_educational_display_name.sql supabase/tests/departments_reference.test.sql`; commit `fix(db): display the Educațional department with its diacritic (#215)`; push; `gh pr create --base main --title "Departments: correct the Educațional display name" --body …` with `Closes #215`, a note that seed demo copy (`Ședință Educational`, announcement author) was deliberately left for #296, and the footer. Wait for CI; report per job.

### Task 2: #366 — `docs/backend/conventions.md`

**Files:**
- Create: `docs/backend/conventions.md`
- Modify: `CLAUDE.md:21` (house rule 4 — append one sentence), `docs/agents/onboarding.md:104` (one added bullet in the same list)

**Interfaces:** Task 3's suite header cites this file by path; the doc cites `supabase/tests/conventions.test.sql` by name. Both merge independently — a dangling name for a few hours is acceptable.

- [ ] **Step 1: Branch** — `git switch -c docs/366-backend-conventions origin/main`.
- [ ] **Step 2: Write the document.** Every rule below is derived from the code as it is on `main`; where the code has two variants, the rule picks one and names the grandfathered exceptions so nobody "fixes" them casually. Each section: the rule in two or three sentences, then one real example with a file path. Keep the whole page under ~250 lines — it is a reference, not a tutorial. Sections and the exact rules:

  1. **Migrations.** `npx supabase migration new <snake_case>`; forward-only and additive; first line `-- #<issue>: <purpose>`; comments explain why, not what; reference data (roles, departments, guides, suppression) in migrations, demo data in `seed.sql` (rule 6); `0001_core_schema.sql` is the one non-timestamped file and is never renamed. Example: `20260910173341_departments_diverse_secretariat.sql`.
  2. **Command shape.** Public `security invoker` wrapper `public.<verb>_<noun>(…)` → `private.<verb>_<noun>_impl(…)` `security definer set search_path = ''`, fully-qualified names throughout; actor is `auth.uid()`, never a parameter; a `private.require_<authority>(…) returns uuid` helper does the authorization and returns the actor; lock the target row `for update` **first**, then re-validate the actor's live membership `for share`, then mutate; return the affected row. Grants: wrapper `revoke execute … from public, anon; grant execute … to authenticated`; `_impl` `revoke from public, anon` + `grant to authenticated` (the invoker wrapper calls it as the caller; `private` is never in `api.schemas`, so PostgREST cannot reach it); `require_*` and trigger functions get no grant to `authenticated` at all. Example: `20260909151741_project_membership_commands.sql`. Grandfathered direct definers: `claim_open_task` (retires with #345) and `create_event` (rewritten by #370).
  3. **Errors.** One syntax everywhere: `raise sqlstate '<code>' using message = '<snake_case_reason>';`. Code table — `42501` not authorized (`<scope>_forbidden`); `PT400` invalid input or precondition (`invalid_*`, `*_required`, `*_not_eligible`); `PT404` not found **or not visible** (`*_not_found`, `*_not_visible` — never let a caller distinguish hidden from missing); `PT409` state conflict (`*_archived`, `task_not_open`); `23514` trigger-enforced invariant (constraint triggers; snake_case message going forward — the six English sentences in `20260909003930` are grandfathered). Wrappers never catch. PostgREST maps `PT4xx` to HTTP 4xx; the frontend normalizes on the message.
  4. **Grants and RLS.** Tables enable RLS in the migration that creates them; every `to authenticated` policy contains `auth_is_member()` or `auth_level() >= N` (rule 12; `rls_deny_by_default.test.sql` sweeps it); views `with (security_invoker = on)` except `member_points` and `profiles_contact`, whose WHERE clause is the security boundary (do not "fix" them); idiom `revoke … from public, anon` then explicit `grant … to authenticated, service_role`; never `grant … to anon`; `private` schema: USAGE to `authenticated` only, never exposed. **Every `create function` needs its own `revoke execute … from public, anon`** (triggers and `require_*` helpers: `revoke all … from public, anon, authenticated`): Supabase's default ACL grants EXECUTE on new `public` functions to `anon` explicitly, and Postgres grants it to PUBLIC in every schema, so a function without a revoke is anon-callable. `supabase/tests/conventions.test.sql` (#365) fails CI naming any function you miss. Do not try to fix this with `alter default privileges` — a per-schema revoke cannot remove the global PUBLIC grant, and a global one breaks the `pg_temp` helpers the test suites call as `authenticated`. If `supabase db lint` (run with `--fail-on warning` after #365) reports a false positive, fix the function or explain it in the PR — never drop the flag. Example: `20260910140508_grants_hardening.sql`.
  5. **Naming.** Policies `<table>_<verb>[_qualifier]` with the table's real name (`projects_read`, `teams_create`, `attendance_insert_self`; verbs read/create/update/delete/manage; qualifiers `self`, `leadership`, …); constraints `<table>_<what>_ck`; unique constraints `<table>_<cols>_key` or expression indexes `_uidx`; indexes `<table>_<cols>_idx`; FKs keep Postgres' `_fkey`; functions `auth_*` (JWT claim readers), `private.is_*` / `private.can_*` (boolean predicates), `private.require_*` (raise or return the actor), `private.<cmd>_impl`; triggers `<table>_<what>` on functions `private.<verb>_<noun>()`; columns snake_case, `*_id` FKs, `*_at` timestamps, `*_by` actor uuids. Grandfathered until #379 or the issue that rewrites them: `task_read`, `event_read`, `ledger_read`, `request_*`, `assignee_*`, `projects_status_valid`, `projects_timestamps_ordered`.
  6. **Enum vs `text check`.** Enums only for the vocabularies already in `0001_core_schema.sql` (`member_role`, `task_status`, `noti_kind`, `event_type`, `event_scope`, …) — adding a value to an enum cannot run inside the same transaction that uses it. New or evolving vocabularies (lifecycle states, modes, kinds) are `text not null check (col in (…))` named `<table>_<col>_ck`. Example: `projects.status`, `project_members.project_role`.
  7. **Timestamps.** Every table: `created_at timestamptz not null default now()`. `updated_at` only on tables whose rows are edited in place, maintained by the shared `private.set_updated_at()` trigger (#368; until it lands, the command sets it and the PR says so). Instants are `timestamptz`, never `date` (`tasks.deadline` is being converted by #283); Bucharest wall-clock is a presentation concern.
  8. **Tests.** `supabase/tests/<area>_<aspect>.test.sql`; the README skeleton; exact `plan(N)`; per-suite reserved UUID prefix for fixtures; for authorization, one assertion per persona × operation including **claimless, anon and inactive** denials; anything that serializes gets a two-session race via `pg_temp.test_race`; the claimless sweep needs one fixture row per table; a test must fail if the feature is removed (write it first and watch it fail).
  9. **Pull-request checklist** (eight lines: migration header · RLS enabled · policy has a membership predicate · definer has `search_path` · grants revoked from `public, anon` · error codes from the table · names per §5 · tests fail without the feature).

- [ ] **Step 3: Pointers.** CLAUDE.md rule 4 (line 21), append: ` Full backend conventions — command shape, error codes, grants, naming, timestamps, test layout — live in `docs/backend/conventions.md`; `supabase/tests/conventions.test.sql` (#365) enforces the machine-checkable ones.` In `docs/agents/onboarding.md`, add one bullet to the list around line 104: `- **Conventions are written down:** `docs/backend/conventions.md` — read it before your first migration.` Do not otherwise edit onboarding (its `in_my_dept` mention is stale; #374 owns that).
- [ ] **Step 4: Verify** — `cd app && npx prettier --check ../docs/backend/conventions.md ../CLAUDE.md ../docs/agents/onboarding.md` (the app's Prettier config is the only one in the repo; if it rejects the docs, run `npx prettier --write` on the new file only and leave the two existing files' formatting as they were); every file path cited in the doc exists (`for p in $(grep -oE 'supabase/[a-z_/0-9.-]+\.sql|docs/[a-z_/0-9.-]+\.md' docs/backend/conventions.md | sort -u); do test -e "$p" || echo "MISSING $p"; done` prints nothing except `supabase/tests/conventions.test.sql`, which Task 3 creates); every issue number cited is open or merged (`gh issue view <n> --json state`).
- [ ] **Step 5: Commit and PR** — commit `docs(backend): write the conventions reference and link it from the house rules (#366)`; push; `gh pr create --base main --title "Docs: backend conventions (command shape, errors, grants, naming, timestamps)" --body …` with `Closes #366`, a sentence that the rules describe `main` as it is and name the grandfathered exceptions, the footer. Docs-only: CI's docs/format checks must be green.

### Task 3: #365 — a `db lint` that can fail, and the conventions pgTAP sweep

**Files:**
- Create: `supabase/migrations/<timestamp>_revoke_trigger_function_execute.sql` (via `npx supabase migration new revoke_trigger_function_execute`)
- Create: `supabase/tests/conventions.test.sql`
- Modify: `.github/workflows/ci.yml` (the `Lint database` step; one new step after it)

**Interfaces:** the suite's header cites `docs/backend/conventions.md` (Task 2). The allow-list `('member_points', 'profiles_contact')` is the same pair the doc names.

- [ ] **Step 1: Branch** — `git switch -c ci/365-conventions-sweep origin/main`.
- [ ] **Step 2: Write the failing suite** — `supabase/tests/conventions.test.sql`:

```sql
-- #365: machine-checked house rules 3 and 4 plus the grant posture #363
-- established — every security definer function in public/private pins
-- search_path, nothing in public or private is executable by anon (trigger
-- functions included), every view runs as the caller except the two
-- documented owner-rights exceptions, and the private schema is invisible to
-- anon. Each check returns the offending objects by name, so a red run says
-- what to fix. Supabase-owned schemas (graphql, auth, storage) are out of
-- scope. The written rules: docs/backend/conventions.md.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(9);

create function pg_temp.definers_without_search_path() returns text[]
language sql as $$
  select coalesce(array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname), '{}')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                      where c like 'search_path=%');
$$;

create function pg_temp.anon_executable_functions() returns text[]
language sql as $$
  select coalesce(array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname), '{}')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and has_function_privilege('anon', p.oid, 'execute');
$$;

create function pg_temp.owner_rights_views() returns text[]
language sql as $$
  select coalesce(array_agg(c.relname order by c.relname), '{}')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=on%'
     and c.relname not in ('member_points', 'profiles_contact');
$$;

select is(pg_temp.definers_without_search_path(), '{}'::text[],
  'every security definer function in public/private pins search_path');
select is(pg_temp.anon_executable_functions(), '{}'::text[],
  'anon can execute no function in public or private, trigger functions included');
select is(pg_temp.owner_rights_views(), '{}'::text[],
  'every view is security_invoker except the two documented owner-rights exceptions');
select is(has_schema_privilege('anon', 'private', 'usage'), false,
  'anon has no usage on the private schema');
select is(has_schema_privilege('service_role', 'private', 'usage'), false,
  'service_role has no usage on private either — commands go through public wrappers');
-- The allow-list stays honest: both exceptions must still exist and still be
-- owner-rights. Retire an entry here the day the view goes invoker.
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and c.relname in ('member_points', 'profiles_contact')
      and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=on%'),
  2::bigint,
  'member_points and profiles_contact are the two owner-rights views');

-- The sweep is not hollow. A throwaway definer created the way a careless
-- migration would — no search_path, no revoke — must be named by BOTH checks:
-- the first because it lacks search_path, the second because Supabase's
-- default ACL grants EXECUTE on new public functions to anon. That second
-- assertion also documents why every migration needs an explicit revoke.
-- The probe is dropped (and the whole suite rolls back).
create function public.conventions_probe_definer() returns int
language sql security definer as $$ select 1 $$;
select is(pg_temp.definers_without_search_path(), array['public.conventions_probe_definer'],
  'a definer without search_path is reported by name');
select is(pg_temp.anon_executable_functions(), array['public.conventions_probe_definer'],
  'a function created without a revoke is anon-executable and reported by name');
drop function public.conventions_probe_definer();
select is(pg_temp.definers_without_search_path() || pg_temp.anon_executable_functions(), '{}'::text[],
  'both sweeps are clean again once the probe is dropped');

select * from finish();
rollback;
```

- [ ] **Step 3: Run it to see it fail** — `npx supabase test db supabase/tests/conventions.test.sql`. Expected on current `main`: assertion 2 fails naming `public.guard_profile_privileged_columns`, `public.sync_assignee_ledger`, `public.sync_task_ledger`; assertions 8 and 9 fail too, because the anon sweep returns those three alongside (or instead of) the probe; assertions 1, 3–7 pass. Paste the output — it is the evidence the sweep discriminates.
- [ ] **Step 4: Migration** — `npx supabase migration new revoke_trigger_function_execute`:

```sql
-- #365: no function in public or private is executable by anon — trigger
-- functions included, so the conventions sweep can state the rule without an
-- exception list. These three predate the repository's revoke discipline;
-- Postgres checks EXECUTE on a trigger function only at CREATE TRIGGER, never
-- when the trigger fires, so revoking changes nothing at runtime (precedent:
-- reject_manual_award in 20260910135327).
revoke all on function public.guard_profile_privileged_columns() from public, anon, authenticated;
revoke all on function public.sync_task_ledger()               from public, anon, authenticated;
revoke all on function public.sync_assignee_ledger()           from public, anon, authenticated;
```

  Deliberately **no** `alter default privileges`: see the Facts section — a per-schema revoke cannot remove Postgres's global PUBLIC grant, and a global one would strip PUBLIC from the `pg_temp` helpers the suites call as `authenticated`. The sweep, not the defaults, is the enforcement.

- [ ] **Step 5: Reset and run everything** — `npx supabase db reset && npx supabase test db`. Expected: all suites green, `conventions.test.sql` `1..9`. If any *other* suite now fails, the revoke broke a runtime path the precedent said was impossible — stop and report the failing assertion verbatim; do not paper over it.
- [ ] **Step 6: CI** — in `.github/workflows/ci.yml` replace the `Lint database` step's `run: supabase db lint` with `run: supabase db lint --schema public,private --level warning --fail-on warning` and add a comment above it: the CLI already lints both schemas, but `--fail-on` defaults to `none`, so without it this step could never fail; the baseline is clean at warning level. Then add, right after it:

```yaml
      # The private schema holds security-definer helpers and command
      # implementations that PostgREST must never expose. pgrst.db_schemas is
      # not a GUC locally, so the only place to check is the config that
      # `supabase start` and the hosted project read.
      - name: private schema stays out of the Data API
        run: |
          if grep -nE '^\s*schemas\s*=.*\bprivate\b' supabase/config.toml; then
            echo "::error::supabase/config.toml exposes the private schema through PostgREST"
            exit 1
          fi
```

  Lint the workflow: `MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest` (the `MSYS_NO_PATHCONV` is a Git-Bash-on-Windows quirk, see the #357 report).
- [ ] **Step 7: The issue's acceptance criterion, literally** — create a throwaway migration `npx supabase migration new zz_probe` containing `create function public.zz_probe() returns int language sql security definer as $$ select 1 $$;`, then `npx supabase db reset && npx supabase test db supabase/tests/conventions.test.sql` → assertion 1 fails naming `public.zz_probe`. Delete the probe migration file, `npx supabase db reset && npx supabase test db supabase/tests/conventions.test.sql` → green. Finish with `git status --porcelain supabase/migrations` showing only your real migration.
- [ ] **Step 8: Types** — `cd app && npm run gen:types && git diff --exit-code src/lib/database.types.ts && cd ..` → no diff (grants do not change shape).
- [ ] **Step 9: Commit and PR** — `git add supabase/migrations/<timestamp>_revoke_trigger_function_execute.sql supabase/tests/conventions.test.sql .github/workflows/ci.yml`; commit `ci(db): fail lint on warnings and add the conventions pgTAP sweep (#365)`; push; `gh pr create --base main --title "CI: lint the private schema and add a conventions pgTAP sweep" --body …` with `Closes #365`, the three revoked trigger functions and why it is runtime-neutral, why default privileges were deliberately left alone (every migration keeps its explicit revoke; the sweep names any it misses), the `--fail-on` finding, and a heads-up that **open PRs will meet this gate on rebase** (dobrerares has nine open; any new definer without `search_path` or any new anon-executable function fails CI by name — that is the point). Footer. Wait for CI; report per job.

---

## Verification (whole batch)

- Each PR: CI green on `main` as base; `Closes #n`; commit trailer and PR footer present.
- After all three merge: `npx supabase db reset && npx supabase test db` green with `departments_reference` at `1..11` and `conventions` at `1..9`; `gh run view` on `main`'s run shows the lint step using `--fail-on warning` and the new config-check step; `docs/backend/conventions.md` reachable from CLAUDE.md rule 4 and onboarding; `select name from departments where id='edu'` → `Educațional` (the app shows it wherever department names render — Dashboard and Tracker chips).
- SDD ledger: `.superpowers/sdd/2026-09-11-backend-conventions/progress.md`; delete the workspace after the final review.

## Risks and rulings

- **Default privileges are deliberately untouched** (corrected 2026-09-11 in pre-flight — the first draft proposed per-schema `revoke execute on functions from public`, which Postgres silently ignores for a globally granted privilege and which Supabase's explicit `anon` grant would have defeated anyway). The cost is that every future migration must keep writing its revoke; the sweep turns a forgotten one into a red CI run naming the function.
- **Revoking EXECUTE on the three trigger functions** is runtime-neutral by Postgres semantics; the full suite in Step 5 (which drives every trigger through `authenticated` DML) is the proof. If it is not neutral, the task stops and reports — it does not switch the sweep to an exception list.
- **`--fail-on warning`** can start failing on a future plpgsql_check warning that is a false positive. The remedy is fixing the function or explaining it in the PR, not dropping the flag — Task 2 writes that into the conventions doc §4 (Task 3 does not edit the doc; the two PRs are independent).
- **Two PRs touch CLAUDE.md?** No — only Task 2 edits it. Task 3 touches `ci.yml`, which no other open PR of ours edits.
- **Concurrent database use** by the peer session on this machine can wedge a reset; the pre-flight query in Global Constraints tells a deadlock from a bug.
- **#215 seed copy left as-is** (`Ședință Educational`, announcement author `Educational`): the issue's boundary excludes unrelated copy, and #296 rebuilds the seed. Cost if wrong: two demo strings with a missing diacritic until then.

## Not in this plan

- #371 (dobrerares). #379 optional rename migration — decide after #366 lands. #368 (`set_updated_at`) sits in Stack C. #374 docs truth pass owns onboarding's stale `in_my_dept`/`team_admits_recruits` line and the `supabase/tests/README.md` hardcoded CLI version.
