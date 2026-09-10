# Project Lifecycle, Membership, and Demo Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete issues #273, #274, and #275 as three independent, sequential pull requests: secure project lifecycle commands, lead-owned membership commands, and representative re-runnable demo data.

**Architecture:** Public RPC names form the browser-facing API, while privileged writes are implemented by tightly scoped functions that derive the actor from `auth.uid()`, verify current profile state and authority, and run the whole change in one PostgreSQL transaction. Direct authenticated writes remain unavailable. Demo projects live only in `supabase/seed.sql` and are included in the existing re-runnability fingerprint.

**Tech Stack:** Supabase PostgreSQL, PL/pgSQL, Row-Level Security, explicit grants, pgTAP, Supabase CLI, generated TypeScript database types, GitHub Actions.

**Spec:** `docs/adr/0007-task-tracker-lifecycle.md`

## Global Constraints

- Implement in strict order: **#273 → merge → #274 → merge → #275**.
- Start every branch from the latest `main`; never stack these pull requests.
- The primary checkout currently contains unrelated user files. Execute each issue in its own clean worktree so those files are never staged or overwritten.
- Create migrations with the exact `npx supabase migration new project_lifecycle_commands` and `npx supabase migration new project_membership_commands` commands below; the CLI owns each timestamp.
- Never edit an existing migration.
- Every privileged function uses `set search_path = ''` and fully qualified relation names.
- Public and `anon` receive no command execution; only `authenticated` receives the exact public RPC grants.
- Authorization uses current `profiles.status` and current `roles.level`, not a caller-supplied actor or stale JWT level.
- `auth_is_member()` remains the organization-claim gate; a real UID without organization claims must fail.
- No mutation policy is added to `projects` or `project_members`.
- Tests must use owned fixtures and must prove denied writes did not happen.
- Regenerate `app/src/lib/database.types.ts` after every migration that adds an RPC.
- A human merges each PR only after every CI job is green; confirm the main-branch staging deployment before starting the dependent issue.

## Planned public interfaces

```sql
public.create_project(p_name text, p_leader_id uuid)
  returns public.projects

public.archive_project(p_project_id bigint)
  returns public.projects

public.add_project_member(p_project_id bigint, p_member_id uuid)
  returns public.project_members

public.remove_project_member(p_project_id bigint, p_member_id uuid)
  returns boolean

public.set_project_member_role(
  p_project_id bigint,
  p_member_id uuid,
  p_project_role text
)
  returns public.project_members
```

Each public RPC is a `security invoker` wrapper. It calls its corresponding
`private.*_impl` function, which is `security definer`; privileged code therefore
stays outside the exposed Data API schema. Both layers use an empty search path.
Only the wrapper and its corresponding private implementation receive
`authenticated` EXECUTE. The new `private.require_project_admin()` helper
remains unexecutable by client roles.

The membership role setter accepts only `member` and `responsible`. Granting a Responsible means setting `responsible`; revoking it means setting `member`.

## Stable command outcomes

| Condition | SQLSTATE | Message |
|---|---:|---|
| Caller is not an active BC/Moderator | `42501` | `project_admin_forbidden` |
| Caller is not the active project lead | `42501` | `project_membership_manage_forbidden` |
| Blank project name | `PT400` | `invalid_project_name` |
| Proposed leader is missing/inactive | `PT400` | `project_leader_not_eligible` |
| Project does not exist for an authorized lifecycle caller | `PT404` | `project_not_found` |
| Project is archived during roster management | `PT409` | `project_archived` |
| Proposed member for add/promotion is missing/inactive | `PT400` | `project_member_not_eligible` |
| Membership role is unsupported | `PT400` | `invalid_project_role` |
| Role change targets a missing membership | `PT404` | `project_membership_not_found` |
| Attempt to remove the current leader | `PT409` | `project_leader_membership_required` |

Creating an already-existing membership is idempotent and returns the existing row without downgrading a Responsible. Removing a membership is idempotent: it returns `true` when one row was removed and `false` when it was already absent. Archiving is idempotent and returns the unchanged archived project on repeated calls.

---

### Task 1 / Issue #273: Create and archive projects through BC commands

**Files:**

- Create via CLI: migration with suffix `project_lifecycle_commands.sql`
- Create: `supabase/tests/project_lifecycle_commands.test.sql`
- Modify by generation only: `app/src/lib/database.types.ts`

**Interfaces:**

- Consumes: `public.projects`, `public.project_members`, `public.auth_is_member()`, the #270 leader-membership triggers, and `public.roles.level`.
- Produces: `public.create_project(text, uuid)` and `public.archive_project(bigint)` for later administration UI; leaves roster management to #274.

- [ ] **Step 1: Synchronize and branch**

```powershell
cd C:\Users\alexb\dev\osubb-app
git fetch origin
git worktree add C:\Users\alexb\AppData\Local\Temp\codex-osubb-273 `
  -b codex/273-project-lifecycle-commands origin/main
cd C:\Users\alexb\AppData\Local\Temp\codex-osubb-273
```

Confirm #272 is present and `git status --short` is empty.

- [ ] **Step 2: Create the focused pgTAP test before the migration**

Create `supabase/tests/project_lifecycle_commands.test.sql` in one rolled-back transaction. Add fixed UUID fixtures for an active volunteer leader, BC, Moderator, BCE, Responsabil, inactive BC, and claimless user.

The RED suite must assert:

1. both public functions exist with exactly the signatures above;
2. `authenticated` can execute them while `anon` and `PUBLIC` cannot;
3. authenticated direct `INSERT`, `UPDATE`, `DELETE`, and sequence use are revoked;
4. active BC creates a trimmed-name project;
5. `created_by = auth.uid()` even though no actor parameter exists;
6. the requested leader is stored and receives exactly one membership row;
7. current BC succeeds despite stale lower-level JWT claims;
8. Moderator succeeds;
9. BCE, Responsabil, ordinary member, inactive BC, claimless UID, no-JWT, and anonymous callers are denied;
10. blank names and inactive/missing leaders return the stable errors above;
11. BC archives an active project without deleting its memberships or changing its leader/creator;
12. a repeated archive returns the same archived row and does not advance `updated_at` again;
13. an authorized caller receives `project_not_found` for a missing ID;
14. direct table writes still fail after the RPCs exist;
15. public wrappers are security-invoker and privileged implementations live only in `private` with `search_path = ''`.

Use `pg_temp.login(...)` with organization claims, and reset both role and `request.jwt.claims` between identities.

- [ ] **Step 3: Run the focused test and prove RED**

```powershell
npx supabase db reset
npx supabase test db supabase/tests/project_lifecycle_commands.test.sql
```

Expected: failures identify missing RPCs and old authenticated DML/sequence privileges. Fix test syntax or fixture mistakes, but do not weaken an authorization assertion.

- [ ] **Step 4: Create the migration through the CLI**

```powershell
npx supabase migration new project_lifecycle_commands
```

Create `private.require_project_admin()` returning the authorized actor UUID.
It derives `auth.uid()`, requires `auth_is_member()`, joins `profiles` to
`roles`, and requires `status = 'activ'` and `level >= 6` from the live
database. It raises `42501/project_admin_forbidden` otherwise.

Implement `private.create_project_impl(text, uuid)` and
`private.archive_project_impl(bigint)` as the privileged transactional
functions. Implement `public.create_project(text, uuid)` and
`public.archive_project(bigint)` as security-invoker wrappers that return the
private implementation result.

`create_project` must:

```text
authorize actor
→ validate and trim name
→ verify leader has an active profile
→ INSERT(name, leader_id, created_by = actor)
→ let #270 atomically create the leader membership
→ return the complete project row
```

`archive_project` must:

```text
authorize actor
→ SELECT the project FOR UPDATE
→ PT404 if absent
→ return immediately if already archived
→ UPDATE status = 'archived', updated_at = now()
→ return the complete project row
```

After defining the functions:

```sql
revoke insert, update, delete on table public.projects from authenticated;
revoke usage, select on sequence public.projects_id_seq from authenticated;
revoke execute on function public.create_project(text, uuid)
  from public, anon;
revoke execute on function public.archive_project(bigint)
  from public, anon;
grant execute on function public.create_project(text, uuid)
  to authenticated;
grant execute on function public.archive_project(bigint)
  to authenticated;
```

Revoke every new private function from `PUBLIC`, `anon`, `authenticated`, and
`service_role`; then grant `authenticated` only the two `*_impl` functions
needed by the public wrappers. Do not grant client execution on
`private.require_project_admin()`, and do not expose the `private` schema
through the Data API.

- [ ] **Step 5: Prove GREEN and mutation safety**

```powershell
npx supabase db reset
npx supabase test db supabase/tests/project_lifecycle_commands.test.sql
npx supabase test db
```

Expected: focused suite and complete suite pass. Specifically inspect the assertions proving inactive/stale/claimless identities cannot create or archive.

- [ ] **Step 6: Regenerate types and run advisors**

```powershell
cd app
npm run gen:types
cd ..
npx supabase db lint --schema public
npx supabase db lint --schema private
npx supabase migration list --local
```

Review the generated function signatures; do not hand-edit `database.types.ts`. Existing advisor findings may be recorded, but this migration must introduce none.

- [ ] **Step 7: Commit, push, and open the human-merge PR**

```powershell
git add supabase/migrations supabase/tests/project_lifecycle_commands.test.sql app/src/lib/database.types.ts
git commit -m "feat(projects): add lifecycle commands (#273)"
git push -u origin codex/273-project-lifecycle-commands
gh pr create --title "Projects: create and archive through BC commands" --body "Closes #273"
```

Wait for CI. A human merges, deletes the branch, and confirms staging deployment is green before Task 2 begins.

---

### Task 2 / Issue #274: Let the project lead manage members and Responsibles

**Files:**

- Create via CLI: migration with suffix `project_membership_commands.sql`
- Create: `supabase/tests/project_membership_commands.test.sql`
- Modify by generation only: `app/src/lib/database.types.ts`

**Interfaces:**

- Consumes: merged #273 direct-write revocations, `private.is_project_lead(bigint)`, `public.project_members`, and #270 invariants.
- Produces: the three membership RPCs listed above. No frontend, task command, project-lead reassignment, or global BC roster override is added.

- [ ] **Step 1: Start only after #273 is on main**

```powershell
cd C:\Users\alexb\dev\osubb-app
git fetch origin
git worktree add C:\Users\alexb\AppData\Local\Temp\codex-osubb-274 `
  -b codex/274-project-membership-commands origin/main
cd C:\Users\alexb\AppData\Local\Temp\codex-osubb-274
```

Verify `public.create_project` exists in the generated types before proceeding.

- [ ] **Step 2: Write the command contract as a RED pgTAP suite**

Create an active project with an active lead, Responsible, ordinary member, outsider, inactive target, BCE outsider, BC outsider, Moderator outsider, inactive former lead fixture, and claimless UID fixture.

Assert:

1. all three functions exist with exact signatures and return types;
2. only `authenticated` can execute them;
3. the active lead adds an active member;
4. duplicate add returns the existing row and does not create a duplicate;
5. duplicate add never downgrades an existing Responsible;
6. the lead promotes a member to `responsible` and can demote them to `member`;
7. repeating the same role assignment is idempotent;
8. the lead removes ordinary members and Responsibles;
9. first remove returns `true`; repeated remove returns `false`;
10. current leader removal returns `project_leader_membership_required` and leaves the row present;
11. missing/inactive targets cannot be added or promoted;
12. an unsupported role and a role change for a missing membership return the stable errors;
13. archived project rosters cannot be changed;
14. Project Responsible, ordinary member, outsider, BCE, non-lead BC, non-lead Moderator, inactive lead, claimless UID, no-JWT, and anonymous callers cannot manage the roster;
15. direct table insert/update/delete remain unavailable;
16. sequential duplicate calls demonstrate the deterministic result backed by the primary key and project-row lock.

- [ ] **Step 3: Run RED**

```powershell
npx supabase db reset
npx supabase test db supabase/tests/project_membership_commands.test.sql
```

Expected: missing-function failures only after fixture/test syntax is valid.

- [ ] **Step 4: Create and implement the migration**

```powershell
npx supabase migration new project_membership_commands
```

Every command must lock the project row first, require `status = 'active'`, and prove the live actor is that project's lead. This matches #270's lock order and serializes duplicate roster changes.

Implement privileged `private.add_project_member_impl`,
`private.remove_project_member_impl`, and
`private.set_project_member_role_impl` functions plus the three matching
security-invoker `public` wrappers. Implement these data operations:

```sql
-- add: preserve an existing Responsible
insert into public.project_members (project_id, member_id, project_role)
values (p_project_id, p_member_id, 'member')
on conflict (project_id, member_id) do nothing;

-- set role: role is validated before this update
update public.project_members
   set project_role = p_project_role
 where project_id = p_project_id
   and member_id = p_member_id;

-- remove: return whether DELETE matched one row
delete from public.project_members
 where project_id = p_project_id
   and member_id = p_member_id;
```

Read the final row back for add/set-role. Derive the actor from `auth.uid()`; no command accepts actor or lead IDs. Validate target profiles under the project lock. Translate the protected-leader case into `PT409/project_leader_membership_required` rather than exposing the trigger's generic `23514` message.

Revoke function execution from `PUBLIC`/`anon`, grant only to `authenticated`, and preserve the #273 table DML revocations.

- [ ] **Step 5: Run focused and complete verification**

```powershell
npx supabase db reset
npx supabase test db supabase/tests/project_membership_commands.test.sql
npx supabase test db
```

Mutation review: temporarily remove the lead check and confirm forbidden-role tests fail; restore it. Temporarily remove the active-profile target check and confirm inactive-target tests fail; restore it.

- [ ] **Step 6: Regenerate types, lint, and inspect privileges**

```powershell
cd app
npm run gen:types
cd ..
npx supabase db lint --schema public
npx supabase db lint --schema private
npx supabase migration list --local
```

Use catalog assertions in the test to prove there are still no `INSERT`, `UPDATE`, or `DELETE` policies on `project_members`.

- [ ] **Step 7: Commit and open the PR**

```powershell
git add supabase/migrations supabase/tests/project_membership_commands.test.sql app/src/lib/database.types.ts
git commit -m "feat(projects): add membership commands (#274)"
git push -u origin codex/274-project-membership-commands
gh pr create --title "Projects: let the lead manage memberships and Responsibles" --body "Closes #274"
```

Wait for human merge, branch deletion, and a green staging deployment before Task 3.

---

### Task 3 / Issue #275: Seed representative project memberships

**Files:**

- Modify: `supabase/seed.sql`
- Create: `supabase/tests/project_demo_seed.test.sql`
- Modify: `.github/workflows/ci.yml` (seed fingerprint only)

**Interfaces:**

- Consumes: merged project schema, read policies, lifecycle commands, and membership commands.
- Produces: stable local/staging fixtures for one active project and one archived project, with lead, Responsible, ordinary member, and outsider scenarios. It creates no production/reference data.

- [ ] **Step 1: Start from merged #274**

```powershell
cd C:\Users\alexb\dev\osubb-app
git fetch origin
git worktree add C:\Users\alexb\AppData\Local\Temp\codex-osubb-275 `
  -b codex/275-project-demo-seed origin/main
cd C:\Users\alexb\AppData\Local\Temp\codex-osubb-275
```

- [ ] **Step 2: Write the seed acceptance test first**

Create `supabase/tests/project_demo_seed.test.sql`. Assert by stable project names—not generated IDs—that:

1. exactly two OSUBB demo projects exist;
2. `Proiect Campus Verde` is active;
3. `Arhiva Orientare 2025` is archived;
4. each project has exactly one stored leader;
5. each leader also has a `project_members` row;
6. the active project has at least one `responsible` and one ordinary `member` besides its lead;
7. the archived project preserves a Responsible and ordinary member;
8. one named demo account is deliberately outside both projects;
9. every referenced profile belongs to the eight `@demo.osubb` accounts;
10. no duplicate `(project_id, member_id)` rows exist;
11. all eight demo accounts and all eight roles still exist;
12. both project states and all three authorization scenarios are available to later Tracker tests.

Run it before editing the seed and expect the project-count assertions to fail.

```powershell
npx supabase test db supabase/tests/project_demo_seed.test.sql
```

- [ ] **Step 3: Extend staging-safe cleanup in `seed.sql`**

Delete demo-owned Tasks/events first as the file already does. Before deleting `auth.users`, delete only the two named demo projects or projects whose creator is in the demo cohort and whose name matches the project seed set. `project_members` will cascade from the project rows.

Do not delete projects created by real staging testers. Keep the foreign-key order explicit in comments because `projects.leader_id` and `projects.created_by` prevent deleting demo profiles while projects remain.

- [ ] **Step 4: Insert two representative projects and memberships**

After demo profiles exist, insert:

| Project | State | Lead | Responsible | Ordinary member | Outsider |
|---|---|---|---|---|---|
| Proiect Campus Verde | active | Ioana Popescu (`voluntar`) | Raluca Ionescu (`responsabil`) | Vlad Constantin (`activ`) | Andrei Mureșan (`recrut`) |
| Arhiva Orientare 2025 | archived | Maria Dobre (`vot`) | Alex Băncilă (`bce`) | Cristina Șerban (`bc`) | Andrei Mureșan (`recrut`) |

Set `created_by` to Cristina Șerban for both. Insert projects directly as seed data; do not fake an authenticated RPC call. The #270 trigger must create each leader membership. Insert only the additional Responsible and ordinary-member rows, using project-name subqueries so generated identity IDs never become fixture constants.

- [ ] **Step 5: Include projects in the CI content fingerprint**

Extend `.github/workflows/ci.yml`'s existing `fingerprint.sql` union with deterministic values that omit generated IDs:

```sql
union all
select format('project:%s:%s:%s:%s', project.name, project.status,
              leader.full_name, creator.full_name)
  from projects as project
  join profiles as leader on leader.id = project.leader_id
  join profiles as creator on creator.id = project.created_by
union all
select format('project-member:%s:%s:%s', project.name,
              member.full_name, membership.project_role)
  from project_members as membership
  join projects as project on project.id = membership.project_id
  join profiles as member on member.id = membership.member_id
```

This makes the existing second seed application fail if a project or role is duplicated, omitted, or changed.

- [ ] **Step 6: Verify fresh and repeated seeding**

```powershell
npx supabase db reset
npx supabase test db supabase/tests/project_demo_seed.test.sql
npx supabase test db
```

Then apply the seed once more to the already-seeded local database using the same single-transaction mechanism as CI and rerun the focused test. Expected: the project and membership counts remain identical and no constraint fails.

- [ ] **Step 7: Verify existing demo access still works**

Check that all eight demo profiles remain present, project fixtures are readable according to #272, and existing tasks/events/leaderboard seed tests remain green. Do not change passwords, UUIDs, role assignments, or department memberships in this issue.

- [ ] **Step 8: Commit and open the PR**

```powershell
git add supabase/seed.sql supabase/tests/project_demo_seed.test.sql .github/workflows/ci.yml
git commit -m "test(seed): add representative projects (#275)"
git push -u origin codex/275-project-demo-seed
gh pr create --title "Projects: seed representative memberships" --body "Closes #275"
```

The PR is complete only when CI proves both the pgTAP suite and the seed re-runnability fingerprint are green.

---

## Chain acceptance checklist

- [ ] #273 is merged before #274 branches.
- [ ] #274 is merged before #275 branches.
- [ ] No PR targets another feature branch.
- [ ] BC/Moderator lifecycle authority uses current database role and active status.
- [ ] Only the active project lead manages membership and project roles.
- [ ] No browser command accepts an actor ID.
- [ ] Archived projects preserve complete history and cannot receive roster mutations.
- [ ] Direct authenticated project/project-membership writes are revoked.
- [ ] Anonymous, claimless UID, inactive, and wrong-role paths are tested with owned fixtures.
- [ ] Demo seed remains scoped, re-runnable, and safe for real staging testers.
- [ ] Generated types and all pgTAP suites pass after #273 and #274.
- [ ] Main-branch staging deployment is green after every merge.
