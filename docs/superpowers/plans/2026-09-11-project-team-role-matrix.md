# Project and Team Role Matrix — Issue #281 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that Project and Team context, membership commands, and direct-write boundaries obey the accepted role/scope rules, including after membership removal or deactivation.

**Architecture:** Add one seed-independent pgTAP integration suite using the existing SQL-role/JWT helpers. Exercise the real tables and public commands against the same owned fixtures, checking both authorized outcomes and denied operations. This is a tests-only issue; production behavior corrections belong in separate issues.

**Tech Stack:** Supabase CLI 2.117.0, PostgreSQL, pgTAP, existing `supabase/tests/_helpers.sql`, GitHub Actions.

**Spec:** [Issue #281](https://github.com/Alex-Bancila/osubb-app/issues/281), `docs/adr/0007-task-tracker-lifecycle.md` (2026-09-10 amendment), `CONTEXT.md`. Read policies already accepted in #272 and #280 define context/roster visibility; they must not be confused with future Task visibility.

## Global constraints

- Tests only. Do not add new behavior; failures create focused corrective issues.
- Active OSUBB membership is mandatory for every operation.
- Every policy on `authenticated` must be unsatisfiable without org claims.
- Assert scope authority using live membership/profile data; stale JWT claims must not preserve revoked access.
- Existing migrations stay immutable. No new migration, seed change, frontend change, or CI redesign is planned for #281.
- Use current `main` as the implementation base, branch `codex/281-project-team-role-matrix`, and one PR for #281. Human merge only.
- No new package, test framework, or database extension is needed.
- Read the accepted ADR, this plan, and the merged command signatures again at execution time.

---

## Verified starting point — 2026-09-11

Inspected remote `main` at `e9253a88f1929e938d2e329eec71b9c6ffd9551a`.

| Item | Verified state | Consequence |
| --- | --- | --- |
| #275, representative Project seed | Closed through PR #304 | Listed dependency satisfied. |
| #280, scoped Team policies | Closed through PR #394, merged September 10 | Listed dependency satisfied. Use `20260910210000_scope_team_policies.sql`. |
| #278 / #279 Team membership commands | Present on `main` | Both command families are available to test. |
| #311, BC/Moderator Project-roster override | Open; the current helper still requires the actor to be the lead | **Missing acceptance dependency:** final #281 sign-off must follow #311. |
| Current local checkout | `ci/378-secret-scan-deno-cors` | It contains unrelated unmerged CI work and lacks the merged #280 changes. Do not base #281 on this checkout's HEAD. |

Recommended sequence: implement and merge #311 in its own branch/PR, then implement and complete #281 from updated `main`. Test design and fixtures can be prepared earlier in an independent branch, but its BC/Moderator override assertions will remain red until #311 lands. Do not stack the PRs.

GitHub administration recommendation: add #311 to #281's `Blocked by` section before marking #281 ready. This planning turn does not modify GitHub issues or implement #311.

This plan supersedes **Task 8 only** in `2026-09-10-alex-assigned-issues.md`. That older outline incorrectly expected blanket BCE Project reads and BC-only archived reads, and suggested marking known failures as pending. This plan retains the accepted visibility contract and requires genuine passing acceptance.

## Scope and file ownership

| File | Action | Responsibility |
| --- | --- | --- |
| `supabase/tests/project_team_authorization_matrix.test.sql` | Create | Shared fixtures, explicit role/scope cases, public-command outcomes, cross-scope denials, stale-session regressions. |
| `supabase/tests/_helpers.sql` | Reuse without editing | `test_login(uuid,jsonb)`, `test_login_leadership(uuid)`, `test_clear_jwt()`. |
| `supabase/tests/README.md` | Read | Existing fixture conventions, targeted execution, and seed-independent checks. |
| Existing Project/Team suites | Read and run | Preserve detailed validation, invariants, idempotency, and concurrency coverage already present. |
| `.github/workflows/ci.yml` | Reuse without editing | `supabase test db` already discovers the new SQL file. |

Do not copy existing schema-shape assertions or concurrency harnesses into the new suite. Its added value is testing different scopes with the same identities and fixtures. It does not certify the future Task lifecycle, evaluation, Calendar, or frontend.

## Expected authorization contract

All allowed cases below require organization claims **and** a currently active Profile.

| Surface | Allowed | Denied |
| --- | --- | --- |
| Project row and complete roster, active or archived | Current Project members; BC/Moderator globally | Nonmembers, including BCE without Project membership |
| Manage work helper for an active Project | Lead, Project Responsible, BC/Moderator | Plain member; organizational Responsabil or BCE without an explicit Project management role |
| Manage work helper for an archived Project | Nobody | All identities, including BC/Moderator |
| Create/archive Project | BC/Moderator | All other roles, including the lead |
| Add/remove Project members; grant/revoke Responsible | Lead or BC/Moderator after #311 | Project Responsible without another authorization; unrelated BCE/Responsabil/member |
| Mutate archived Project roster | Nobody; an otherwise authorized actor receives `PT409` | Unauthorized caller still receives `42501` |
| Department Team row and complete roster | Its members; BCE currently in the parent Department; BC/Moderator | Department peers without Team membership or leadership; foreign BCE without Team membership |
| Independent Team row and complete roster | Its members; BC/Moderator | Nonmembers, including BCE |
| Create Department Team / manage its roster through commands | Local BCE, BC/Moderator | Ordinary Team members; foreign BCE |
| Create Independent Team / manage its roster through commands | BC/Moderator | Team members, BCE, and all other roles |
| Direct INSERT/UPDATE/DELETE of Project or Team memberships | No authenticated role | Even legitimate managers must use the commands |
| Direct Project writes and Team UPDATE/DELETE | No authenticated role | Team INSERT is the deliberate scoped-policy exception above |

BCE global **Task** visibility does not imply global Project/Team roster visibility. Archived context remains readable to current active participants for history; it does not permit new work or roster changes. Project Responsible is a scoped relationship and is independent of the organizational Responsabil role.

## Task 1 — Establish isolated fixtures and explicit actor identity

**Files:** Create `supabase/tests/project_team_authorization_matrix.test.sql`.

**Interfaces consumed:** `pg_temp.test_login(uuid,jsonb)`, `pg_temp.test_login_leadership(uuid)`, `pg_temp.test_clear_jwt()`.

**Interfaces produced:** suite-local `pg_temp.matrix_uid(integer) returns uuid`; a temporary `matrix_projects` lookup with `active_id`, `archived_id`, and `foreign_id`; fixed Team IDs below. No application APIs.

- [ ] Recheck #275, #280, and #311 and the latest remote `main`. Create the implementation branch from `origin/main` in an isolated worktree. Preserve the existing working branch and its files.
- [ ] Begin one rolled-back transaction and use the standard helper sentinel:

```sql
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.matrix_uid(p_slot integer)
returns uuid language sql immutable as $$
  select ('e2810000-0000-0000-0000-' || lpad(p_slot::text, 12, '0'))::uuid;
$$;
```

Use `no_plan()` while adding the explicit matrix cases; finish with `finish()` so failed assertions still fail CI. Guard actor/scenario fixture counts explicitly, rather than letting an empty loop silently produce fewer tests. Prefer explicit SQL blocks over a new matrix-runner framework.

- [ ] Create `auth.users` and Profile fixtures using these slots; create only the auth row for slot 15. Reference existing `edu` and `fin` Department rows without modifying them.

| Slot | Organizational role/status | Relationships |
| --- | --- | --- |
| 1–5 | `recrut`, `voluntar`, `activ`, `vot`, `responsabil`; all active | Plain members of Project A, archived A, EDU Team A, and Independent Team A; Department `edu` |
| 6 | Active BCE | Department `edu`; no Project or Team membership initially |
| 7 | Active BCE | Department `fin`; lead of unrelated Project B; no Project A/Team A membership |
| 8–9 | Active BC, Moderator | Initially no Project/Team memberships |
| 10 | Active Voluntar | Lead of Project A and archived A |
| 11 | Active Recrut | Project Responsible in Project A and archived A |
| 12 | Active Voluntar | Department `edu`; roster fixture for EDU B/FIN only, with no Project or Team A memberships |
| 13 | Inactive BC | Plain historical member of Project A/archived A and both Team A rosters |
| 14 | Active Voluntar, tested without organization claims | Plain member of Project A/archived A and both Team A rosters |
| 15 | Auth UID without Profile | Supply stale-looking BC claims for denial tests |
| 16 | Active Voluntar | Target for command tests; initially no memberships |
| 17 | Alumni Voluntar | Historical plain member of Project A/archived A and both Team A rosters |

Give each auth row a unique `matrix.281.<slot>@test.local` email. Do not use demo logins or seed IDs. Use legitimate app-metadata claims for ordinary tests and explicitly supplied metadata for stale/claimless cases.

- [ ] Create Projects `Matrix 281 A` (active, lead 10), `Matrix 281 Archived` (archived, lead 10), and `Matrix 281 B` (active, lead 7). Creator is slot 8. Let the existing trigger create lead memberships; add the remaining plain members and Responsible separately.
- [ ] Capture Project IDs into `matrix_projects` as the owner, before switching roles. Grant SELECT on this temporary lookup to `authenticated` and `anon`; never resolve hidden target IDs through a caller's RLS-filtered subquery.
- [ ] Create `matrix-281-edu-a`, `matrix-281-edu-b`, `matrix-281-fin`, and `matrix-281-independent-a`. EDU B and FIN each need a real roster member, e.g. slot 12, so hidden-roster checks cannot pass against an empty table.
- [ ] Add owner assertions for exactly 17 auth users, 16 Profiles, three Projects, four Teams, and each intended membership. Assert slot 13/14/17 actually owns the target memberships used in denial tests. Grant no extra privileges on application tables.
- [ ] End the file with `reset role; select * from finish(); rollback;`. Run the fixture-only suite once to catch invariant violations before writing authorization assertions.

## Task 2 — Prove visible context and complete rosters

**Files:** Extend the new matrix suite. Read `project_read_policies.test.sql`, `project_authorization_helpers.test.sql`, and `team_policies.test.sql`.

**Interfaces consumed:** `projects`, `project_members`, `teams`, `team_members`; `private.can_manage_project_work(bigint)`.

**Deliverable:** Exact visible-row comparisons for every role/scope combination in the contract above.

- [ ] For slots 1–5 separately, assert Project A plus archived A are visible, Project B is hidden, both Team A contexts are visible, EDU B/FIN are hidden, and the caller can see other members in each authorized roster. Same-Department membership alone must not expose EDU B.
- [ ] Verify the lead and Project Responsible see their Project context and can manage active Project work, while an organizational Responsabil with only plain membership cannot. Neither lead nor Responsible can manage unrelated Project B. The foreign BCE who leads B can manage B but not A.
- [ ] Verify local BCE reads both EDU Teams and their rosters, but not FIN or the Independent Team. Foreign BCE reads FIN only, except for their explicitly held Project role. Verify BCE has no global Project-roster override.
- [ ] Verify BC and Moderator read all three Projects, all four Teams, and full rosters. All project work helpers return false for archived Projects.
- [ ] Verify an ordinary same-Department outsider reads no Project A or Team A context. Then add foreign BCE to Independent Team A as a plain member and confirm read access becomes available without gaining roster-management authority. Remove that test membership as the owner afterward to restore the baseline.
- [ ] Compare actual sorted IDs/member IDs against independently written expected sets. Filter assertions by the suite's known IDs; never calculate expected rows with the production authorization helper.

Example for slot 1, using the Task 1 fixture map:

```sql
select pg_temp.test_login_leadership(pg_temp.matrix_uid(1));
select results_eq(
  $$select name from public.projects
     where name in ('Matrix 281 A', 'Matrix 281 Archived', 'Matrix 281 B')
     order by name$$,
  $$values ('Matrix 281 A'::text), ('Matrix 281 Archived'::text)$$,
  'recrut reads their active and archived Project context, not another Project'
);
select results_eq(
  $$select id from public.teams where id like 'matrix-281-%' order by id$$,
  $$values ('matrix-281-edu-a'::text), ('matrix-281-independent-a'::text)$$,
  'recrut reads their Teams, not every Team in their Department'
);
select is(private.can_manage_project_work(
  (select active_id from matrix_projects)), false,
  'plain Project membership does not grant Project work management');
reset role;
```

Run the targeted suite after each persona group. A mismatch is either a fixture/assertion bug or a production contract defect; inspect which before changing any expectation.

## Task 3 — Prove command authority and prevent cross-scope writes

**Files:** Extend the new matrix suite. Reuse established command expectations from Project/Team command suites.

**Public interfaces:**

```text
create_project(text, uuid) -> projects
archive_project(bigint) -> projects
add_project_member(bigint, uuid) -> project_members
remove_project_member(bigint, uuid) -> boolean
grant_project_responsible(bigint, uuid) -> project_members
revoke_project_responsible(bigint, uuid) -> project_members
add_department_team_member(text, uuid) -> team_members
remove_department_team_member(text, uuid) -> boolean
add_independent_team_member(text, uuid) -> team_members
remove_independent_team_member(text, uuid) -> boolean
```

- [ ] Keep mutation cases independent using scratch Projects/Teams or explicit owner cleanup of slot 16's test memberships after assertions. Before a denied removal, insert the target membership as the owner; before a denied addition, prove the target is absent and eligible. Check resulting state after `reset role`, then restore the baseline. Do not roll back emitted pgTAP assertions inside savepoints; keep TAP bookkeeping in the outer transaction.
- [ ] Verify BC/Moderator can create and archive a scratch Project; all other roles cannot. Read the resulting creator/lead/status as owner. Do not archive Project A, which is shared by subsequent tests.
- [ ] On active Project A, test all four roster commands as its lead, BC, and Moderator. Test the same commands as plain members, organizational Responsabil, Project Responsible, and unrelated BCE: `42501`, unchanged state. Check BC/Moderator override with no membership in A, after #311.
- [ ] On archived A, each otherwise-authorized roster manager receives `PT409` without a state change; unrelated users receive `42501`. Check lead-membership protection under both lead and override callers; do not assume #311's actor is always the Project lead.
- [ ] Test both Department-Team commands with local BCE, BC, and Moderator success; foreign BCE, own-Team member, Project lead, and Project Responsible denial. Repeat on FIN with reversed BCE scope.
- [ ] Test both Independent-Team commands: BC/Moderator success; BCE, own-Team member, Project lead, and Project Responsible denial. Authority over Project work does not grant authority over independent rosters.
- [ ] As an authorized BC, send an Independent Team to a Department-Team command, then an EDU Team to an Independent-Team command. Expect `PT400` with `department_team_required` / `independent_team_required`; neither target changes. This catches dispatch across Team kinds.
- [ ] Test scoped Team creation directly through `INSERT ... RETURNING`: local BCE may create EDU only; BC/Moderator may create either kind; ordinary and foreign-scope actors are denied.

Non-vacuous foreign-BCE removal example:

```sql
insert into public.team_members (team_id, member_id)
values ('matrix-281-edu-a', pg_temp.matrix_uid(16));
select pg_temp.test_login_leadership(pg_temp.matrix_uid(7));
select throws_ok(
  $$select public.remove_department_team_member(
      'matrix-281-edu-a', pg_temp.matrix_uid(16))$$,
  '42501', 'department_team_membership_forbidden',
  'FIN BCE cannot remove a real EDU Team member'
);
reset role;
select is((select count(*) from public.team_members
  where team_id = 'matrix-281-edu-a'
    and member_id = pg_temp.matrix_uid(16)), 1::bigint,
  'denied removal preserved the owned membership');
delete from public.team_members
where team_id = 'matrix-281-edu-a'
  and member_id = pg_temp.matrix_uid(16);
```

Do not substitute helper-only tests for public RPC calls. Existing focused suites retain responsibility for exhaustive validation and concurrency races; run those suites unchanged with #281.

## Task 4 — Prove session revocation and direct-write boundaries

**Files:** Extend the new matrix suite.

**Deliverable:** Behavior assertions showing that possessing a UID, a stale role, or a historical membership is insufficient.

- [ ] Test slot 14 with exactly `{}` app metadata: UID remains valid and owns Project/Team rows, but all four context tables return no rows and each command family denies a write with `42501`.
- [ ] Test slot 13 with stale BC claims and real historical memberships. Also test alumni slot 17 with stale organization claims. Both read nothing and cannot mutate either roster kind or Project membership.
- [ ] Test auth-only slot 15 with BC-level metadata: no Profile means no reads or command authority. Test `authenticated` with cleared JWT separately from a real claimless UID.
- [ ] Clear JWT, switch explicitly to `anon`, and attempt reads and one valid-target call in each public command family. Assert `42501` from missing privileges; do not require RLS-style zero rows for anonymous table reads.
- [ ] Remove a live Team membership but retain the old `team_ids` claim; remove a BCE Department membership but retain `dept_ids`; demote BC while retaining BC metadata. Verify both reads and relevant writes lose authority immediately. Use slots without other overlapping grants for each target, and restore the exact original fixture state as the owner after each case.
- [ ] Remove slot 1 from active and archived Project rosters and retain its original claims: both context reads disappear. Revoke slot 11's Project Responsible relationship: context remains as a plain member, but `can_manage_project_work` becomes false.
- [ ] Attempt direct Project and roster INSERT/UPDATE/DELETE even as BC. Use existing rows for UPDATE/DELETE and eligible target members for INSERT. Check table grants where these operations are explicitly revoked and confirm persisted state is unchanged.
- [ ] For Team UPDATE/DELETE, where grants may still exist but no policy allows rows, assert zero affected rows and unchanged owner-visible state. Keep scoped Team INSERT as an intentional exception.
- [ ] For each hidden-row check, pair it with an owner-visible fixture assertion or an allowed actor's positive result. If a target disappeared during test setup, repair setup rather than accepting the denial.

Claimless and silent-update examples:

```sql
select pg_temp.test_login(pg_temp.matrix_uid(14), '{}'::jsonb);
select is(auth.uid(), pg_temp.matrix_uid(14), 'claimless actor has a real UID');
select is((select count(*) from public.team_members
  where team_id = 'matrix-281-edu-a'), 0::bigint,
  'claimless Team member cannot read even their own roster');
select throws_ok(
  $$select public.remove_independent_team_member(
      'matrix-281-independent-a', pg_temp.matrix_uid(14))$$,
  '42501', null, 'claimless owned membership grants no command authority'
);
reset role;
select is((select count(*) from public.team_members
  where team_id = 'matrix-281-independent-a'
    and member_id = pg_temp.matrix_uid(14)), 1::bigint,
  'denied command retained the real owned membership');

select pg_temp.test_login_leadership(pg_temp.matrix_uid(8));
with changed as (
  update public.teams set name = 'Unauthorized rename'
  where id = 'matrix-281-edu-a' returning id
)
select is((select count(*) from changed), 0::bigint,
  'BC cannot bypass Team commands through direct UPDATE');
reset role;
select isnt((select name from public.teams where id = 'matrix-281-edu-a'),
  'Unauthorized rename'::text, 'owner confirms the Team was not renamed');
```

## Task 5 — Validate and hand off the tests-only PR

**Files:** New suite only, plus this plan if carried into the implementation PR.

- [ ] Confirm Docker is running and the local stack belongs to the intended test workspace. Coordinate before resetting a local database used by another developer/session. Execute local commands only; no linked/staging/production resets.
- [ ] Discover CLI flags with `--help` if the pinned version changes. Execute targeted and full checks from the implementation worktree:

```powershell
npx --yes supabase@2.117.0 db reset
npx --yes supabase@2.117.0 test db supabase/tests/project_team_authorization_matrix.test.sql
npx --yes supabase@2.117.0 test db
npx --yes supabase@2.117.0 db lint
```

- [ ] Verify seed independence, then restore the normal local seed even if the targeted test fails:

```powershell
try {
  npx --yes supabase@2.117.0 db reset --no-seed
  if ($LASTEXITCODE -ne 0) { throw 'Seedless reset failed' }
  npx --yes supabase@2.117.0 test db supabase/tests/project_team_authorization_matrix.test.sql
  if ($LASTEXITCODE -ne 0) { throw 'Matrix requires attention without seed' }
} finally {
  npx --yes supabase@2.117.0 db reset
  if ($LASTEXITCODE -ne 0) { throw 'Restore of the seeded local database failed' }
}
```

- [ ] Check an assertion can fail without weakening production policies: temporarily change one expected visible ID to a known wrong ID in the new suite, run it, require failure, restore the expectation, and rerun. Do not edit historical migrations or install permissive policies to test the test.
- [ ] Let existing CI verify generated types and all unrelated gates. A tests-only change should produce no migration or generated-type diff. Check the new suite is actually included in the database job output.
- [ ] If a new contract defect appears, preserve the failing assertion and record the actor, scope, command, expected result, actual result, and commit. Prepare a focused corrective issue for human administration. Keep #281 draft/blocked until the correction merges; do not use skipped/pending assertions or redefine expected behavior to make CI green. Link the known Project override gap to #311 rather than filing it twice.
- [ ] Review the diff: only matrix tests and the plan, no unrelated CI-stack files, secrets, seed edits, snapshots, or production changes.
- [ ] Open one PR against `main`, titled `Tests: project and team authorization matrix`, with `Closes #281`. Summarize the scope, #311 prerequisite, stale-session coverage, local test counts, and CI result. For a multiline body, use a body file. Wait for green CI; human performs the merge.

## Completion and team coordination

Completion means all eight organizational roles, scoped Project roles, both Team kinds, active/archived context, outsiders, inactive/alumni, no-profile, claimless UID, anonymous, stale memberships, and public/direct write boundaries are covered by passing assertions. #311 must be merged for the promised BC/Moderator Project-roster override to pass. No required authorization case is skipped.

One developer can implement #281 after #311; the second can continue independent Task schema or frontend foundation work. No need to wait for the open CI-hygiene PR stack. Avoid concurrent edits to shared test helpers or simultaneous resets of the same local stack.

Planning estimate: about **2–3 focused hours**, excluding CI and defect fixes, because this combines several authorization surfaces. The existing `max-1h` label is optimistic; use two work sessions within #281 or have the human adjust the label. This plan does not create additional issues or change assignments.

This plan uses the writing-plans structure to make the test boundaries explicit. Supabase guidance informed the separate checks for table privileges, row visibility, live membership, and stale JWT claims. Reference: [Supabase database testing](https://supabase.com/docs/guides/database/testing) and [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Planning self-review

- Every #281 acceptance item maps to Tasks 1–4.
- The two listed dependencies are merged; the newly identified #311 dependency is explicit.
- Project archive reads and BCE roster scope match merged #272/#280 contracts.
- Project Responsible and organizational Responsabil are tested separately.
- Known defects remain visible; final sign-off cannot hide failing authorization assertions.
- No implementation, database reset, test execution, GitHub issue edit, or PR creation was performed while preparing this plan.
