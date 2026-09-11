# Backend conventions

A reference for writing Supabase migrations in this repo — not a tutorial. Each section states the rule and points at one real example on `main`. Where the code currently has two shapes, the rule below picks one and names the grandfathered exceptions so nobody "fixes" them casually. `supabase/tests/conventions.test.sql` (#365, landing in a parallel PR) machine-checks the parts that can be checked mechanically; the rest is reviewed by eye against this page.

## 1. Migrations

Create every migration with `npx supabase migration new <snake_case_name>`; migrations are forward-only and additive (no editing a merged file — add another one). The first line is `-- #<issue>: <one-line purpose>`; further comments explain _why_ a choice was made, not what the SQL already says. Reference data (roles, Departments, rating/difficulty guides, notification suppression) lives in migrations; demo data lives in `supabase/seed.sql` (house rule 6). `supabase/migrations/0001_core_schema.sql` is the one non-timestamped file in the directory and is never renamed.

Example: `supabase/migrations/20260910173341_departments_diverse_secretariat.sql` (first line `-- #310: coordination structures Diverse (Department Teams it, interne) and Secretariat; retire the legacy 'it' department.`).

## 2. Command shape

A client-callable write is two functions. `public.<verb>_<noun>(…)` is `security invoker`, `set search_path = ''`, and does nothing but call `private.<verb>_<noun>_impl(…)`. The `_impl` function is `security definer`, also `set search_path = ''`, fully-qualifies every name, and does the real work. The actor is always `(select auth.uid())` — never a parameter a caller could spoof. A `private.require_<authority>(…) returns uuid` helper performs authorization and returns the actor; the command locks its target row `for update` first, re-validates the actor's live membership `for share`, then mutates, and returns the affected row.

Grants follow §4's function idiom: `revoke execute … from public, anon, authenticated, service_role` on every function in the pair — wrapper, `_impl`, and the `require_*` helper — then `grant execute … to authenticated` back on the wrapper and the `_impl` only (the invoker wrapper calls the `_impl` as the caller, and `private` is never listed in `supabase/config.toml`'s `api.schemas`, so PostgREST cannot reach it directly). `require_*` helpers and trigger functions get no grant back at all — only the command that calls them needs to run them, and it runs as `security definer`.

Example: `supabase/migrations/20260909151741_project_membership_commands.sql` — `private.require_active_project_lead` locks the Project, then the actor's Profile, before `private.add_project_member_impl` / `remove_project_member_impl` / `grant_project_responsible_impl` / `revoke_project_responsible_impl` mutate, each behind a one-line `public.*` SQL wrapper.

**Grandfathered direct-definer commands** (public, `security definer`, no `private.*_impl` split): `claim_open_task` (retires with #345) and `create_event` (rewritten by #370). Do not copy their shape for new work.

## 3. Errors

Two syntaxes are both in current use, split by error code family — pick the one that matches the code, not either at random. A standard Postgres SQLSTATE (`42501` not authorized, `23514` a trigger-enforced invariant) is raised `raise exception using errcode = '<code>', message = '<reason>';`. An app-defined `PT4xx` code is raised `raise sqlstate '<code>' using message = '<reason>';`. Every `<reason>` is `snake_case` going forward.

Code table:

| Code    | Meaning                       | Reason shape                                                                         |
| ------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| `42501` | not authorized                | `<scope>_forbidden`                                                                  |
| `PT400` | invalid input or precondition | `invalid_*`, `*_required`, `*_not_eligible`                                          |
| `PT404` | not found **or not visible**  | `*_not_found` / `*_not_visible` — never let a caller distinguish hidden from missing |
| `PT409` | state conflict                | `*_archived`, `task_not_open`                                                        |
| `23514` | trigger-enforced invariant    | `snake_case` reason going forward                                                    |

Wrappers never catch an error the `_impl` function raises — let it propagate. PostgREST maps `PT4xx` to the matching HTTP 4xx status; the frontend normalizes on the message, not the code.

Example: `supabase/migrations/20260909151741_project_membership_commands.sql` raises `42501` (`errcode` form) and `PT400`/`PT404`/`PT409` (`sqlstate` form) in one file. `23514` example: `supabase/migrations/20260909003930_project_manager_invariants.sql`.

**Grandfathered:** the six `23514` messages in `20260909003930_project_manager_invariants.sql` are full English sentences (e.g. `'active project managers must be active OSUBB members'`), not `snake_case` reasons — leave them as they are.

## 4. Grants and RLS

Every new table enables RLS in the migration that creates it (house rule 2). Every policy `to authenticated` contains `auth_is_member()` or `auth_level() >= N` — `to authenticated` alone only excludes `anon`, it is not a membership check (house rule 12; enforced by the claimless sweep in `supabase/tests/rls_deny_by_default.test.sql`). Views get `with (security_invoker = on)` except `member_points` and `profiles_contact`, whose `where` clause _is_ the security boundary — do not "fix" them to `security_invoker`, it breaks them for everyone they serve.

**Tables and views** follow one idiom: `revoke … from public, anon` followed by an explicit `grant … to authenticated, service_role`; never `grant … to anon`. The `private` schema gets `usage` granted to `authenticated` only — it is never exposed to PostgREST.

**Functions follow a different idiom: revoke execute from everyone, then grant back only what is needed.** Every `create function` gets its own `revoke execute … from public, anon, authenticated, service_role`, then an explicit `grant execute … to <role>` for exactly the roles that must call it: the public wrapper and its `private.*_impl` each get `grant execute … to authenticated` (the `_impl` is called by the invoker wrapper as the caller); `private.require_*` helpers and trigger functions get no grant back at all — nothing should ever call them directly. None of the command migrations grant function execute back to `service_role`. This is not optional cleanup: Supabase's default ACL grants EXECUTE on new `public`-schema functions to `anon`, `authenticated`, and `service_role` explicitly, and Postgres grants EXECUTE to `PUBLIC` in every schema by default, so **a function without its own revoke is callable by all three roles the moment it is created** — `private` included. `supabase/tests/conventions.test.sql` (#365) fails CI naming any function that is missing one.

Policy predicate helpers (`private.is_*`, `private.can_*`) follow the wrapper/`_impl` half of this idiom, not the `require_*` half: revoke from all four roles, then `grant execute … to authenticated` — they run as the calling role inside RLS policies and must stay callable by `authenticated` (e.g. `private.can_read_team`, `supabase/migrations/20260910210000_scope_team_policies.sql:75`). The `public.auth_*` JWT-claim helpers are a grandfathered variant: revoked from `public, anon` only and granted to `authenticated, service_role` (`supabase/migrations/20260910140508_grants_hardening.sql:50-57`).

**Grandfathered:** `reject_manual_award()` revokes in an older three-role form that predates this shape and does not name `service_role` — `revoke all on function public.reject_manual_award() from public, anon, authenticated;` (`supabase/migrations/20260910135327_remove_manual_awards.sql:23`). New work follows the four-role form above, not this precedent; either form is safe at runtime, since Postgres checks EXECUTE on a trigger function only at `create trigger`, never when the trigger fires.

**Do not try to close this with `alter default privileges`.** A per-schema `alter default privileges` cannot revoke the global `PUBLIC` grant, and a global revoke for the migration role would also strip the `pg_temp` helper functions the test suites create and call as `authenticated` (`supabase/tests/_helpers.sql`). The fix that actually works is the one above: an explicit revoke on every function, every time.

If `supabase db lint` (run with `--fail-on warning`) reports a false positive, fix the function or explain the exception in the PR description — never drop `--fail-on warning` to make the noise go away.

Example — tables and views: `supabase/migrations/20260910140508_grants_hardening.sql` (revokes all privileges on the leadership views from every role, then grants `select` back explicitly). Example — functions: `supabase/migrations/20260909151741_project_membership_commands.sql`, `supabase/migrations/20260910154759_independent_team_membership_commands.sql`, and `supabase/migrations/20260910180228_department_team_membership_commands.sql` each revoke execute on every function — wrapper, `_impl`, and `require_*` — from `public, anon, authenticated, service_role`, then grant execute back to `authenticated` only on the wrapper and `_impl`.

## 5. Naming

Policies are `<table>_<verb>[_qualifier]`, named after the table's real name, with verbs `read`/`create`/`update`/`delete`/`manage` and qualifiers like `self`/`leadership` (`projects_read`, `teams_create`, `team_members_read`, `member_departments_manage`). Constraints are `<table>_<what>_ck`; unique constraints are `<table>_<cols>_key`, or `<table>_<cols>_uidx` when built as a unique index; ordinary indexes are `<table>_<cols>_idx`; foreign keys keep Postgres' generated `_fkey`. Functions: `auth_*` for JWT-claim readers, `private.is_*` / `private.can_*` for boolean predicates, `private.require_*` for helpers that raise or return the actor, `private.<verb>_<noun>_impl` for command bodies. Triggers are `<table>_<what>` on functions named `private.<verb>_<noun>()`. Columns are `snake_case`, foreign keys end `_id`, timestamps end `_at`, actor columns end `_by`.

Example: `supabase/migrations/20260909151741_project_membership_commands.sql` (`private.require_active_project_lead`, `private.add_project_member_impl`); trigger naming in `supabase/migrations/20260909003930_project_manager_invariants.sql` (`projects_validate_leader_profile` on `private.validate_project_manager_state()`).

**Grandfathered until #379 or the issue that rewrites them:**

- Policies: `task_read`, `task_write`, `event_read`, `ledger_read`, `ledger_sanction`, `announcements_write`, `announcement_reads_self`, `profiles_self_update`, `request_*` (`request_create`, `request_decide`, `request_read`), `assignee_*` (`assignee_read`, `assignee_manage`), `attendance_*` (`attendance_read`, `attendance_insert_self`, `attendance_update_self`), `auth_admin_read_*` (`auth_admin_read_profiles`, `auth_admin_read_roles`, `auth_admin_read_member_departments`, `auth_admin_read_team_members`) — verb-first, domain-specific, wrong-verb, or oddly-ordered names instead of `<table>_<verb>[_qualifier]`.
- Constraints: `projects_name_not_blank`, `projects_status_valid`, `projects_timestamps_ordered`, `project_members_role_valid` (no `_ck` suffix); `teams_id_dept_unique` (a unique constraint named `_unique`, not `_key`).

## 6. Enum vs. `text check`

Use a Postgres `enum` only for the fixed vocabularies already declared in `0001_core_schema.sql` (`member_role`, `member_status`, `task_status`, `event_type`, `event_scope`, `noti_kind`, `request_kind`, `request_status`, …). Adding a value to an existing enum cannot run in the same transaction that then uses the new value, which makes enums a poor fit for anything still evolving. Any new or still-changing vocabulary — lifecycle states, modes, kinds — is `text not null check (col in (…))`, named `<table>_<col>_ck` per §5.

Example: `projects.status` and `project_members.project_role` in `supabase/migrations/20260908083829_projects_schema.sql` and `supabase/migrations/20260908174343_project_members_schema.sql`.

## 7. Timestamps

Every table gets `created_at timestamptz not null default now()`. `updated_at` is added only to tables whose rows are edited in place, and is maintained by the shared `private.set_updated_at()` trigger — until #368 lands that helper, the command itself sets `updated_at = clock_timestamp()` and its PR says so explicitly. Instants are always `timestamptz`, never `date` — Bucharest wall-clock rendering is a presentation concern, not a storage one (`tasks.deadline` is currently the one exception, a `date` column that #283 converts).

Example: `supabase/migrations/20260908083829_projects_schema.sql` (`created_at`/`updated_at timestamptz`, `updated_at >= created_at` check); manual `updated_at` maintenance in `supabase/migrations/20260909140036_project_lifecycle_commands.sql:109`.

## 8. Tests

Name suites `supabase/tests/<area>_<aspect>.test.sql`, using `CONTEXT.md` domain terms. Follow the skeleton in `supabase/tests/README.md`: `begin;` → `\set osubb_test_suite true` → `\ir _helpers.sql` → `set local search_path = public, extensions;` → `create extension if not exists pgtap with schema extensions;` → `select plan(N);` with the exact assertion count → `select * from finish(); rollback;`. Give each suite a recognizable fixture UUID prefix tied to its issue number, unique per fixture within the suite. For authorization, write one assertion per persona × operation, including **claimless, `anon`, and inactive-Member** denials — the claimless sweep needs one fixture row per table. Anything that serializes concurrent writers needs a two-session race via `pg_temp.test_race`. Write the test first and watch it fail: a test that stays green with the feature removed is not testing the feature.

Example: `supabase/tests/department_team_membership_commands.test.sql` (skeleton order, `select plan(40);`, fixtures prefixed `27900000-…` for #279).

## 9. Pull-request checklist

- [ ] Migration header is `-- #<issue>: <purpose>`.
- [ ] New tables have RLS enabled in the same migration.
- [ ] Every `authenticated` policy contains a membership predicate (`auth_is_member()` or `auth_level() >= N`).
- [ ] Every `security definer` function sets `search_path = ''` and fully-qualifies names.
- [ ] Every new function revokes execute from `public, anon, authenticated, service_role`, then grants it back only to the roles that must call it (§4: `authenticated` for wrappers, `_impl`, and policy helpers; no grant at all for `require_*`/trigger functions).
- [ ] Errors use the code table in §3, not ad hoc codes or messages.
- [ ] Names follow §5 (policies, constraints, indexes, functions, triggers, columns).
- [ ] Tests ship in the same PR and fail if the feature is reverted.
