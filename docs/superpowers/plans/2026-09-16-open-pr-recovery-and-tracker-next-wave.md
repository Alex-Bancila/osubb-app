# Open PR Recovery and Task Tracker Next Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely finish and merge PRs #492, #477, and #478 against the current `main`, close the remaining Task Tracker backend verification work, and start the next conflict-free Task Tracker frontend wave.

**Architecture:** Recover the existing branches sequentially without rebasing or force-pushing teammate history. PR #492 lands its reviewed reporting contract first; PR #477 then centralizes live actor authorization on top of that exact schema; #262 verifies the final points boundary; the stacked Calendar PR #478 is explicitly retargeted and reconciled only after #477 lands. Frontend work begins from the resulting stable RPC contracts and remains split into independent leadership and member-action lanes.

**Tech Stack:** Git/GitHub pull requests, Supabase/PostgreSQL, SQL migrations, RLS, SECURITY DEFINER/INVOKER functions, pgTAP, Supabase CLI, React 19, React Router 7, TanStack Query, shadcn/Base UI, Vitest/Testing Library.

**Spec:** `docs/adr/0007-task-tracker-lifecycle.md`, `docs/adr/0008-calendar-visibility.md`, `CONTEXT.md`, `docs/backend/conventions.md`, `.superpowers/sdd/2026-09-16-tracker-completion/review-g1-verdict.md`, and the live GitHub issue bodies referenced below.

## Global Constraints

- Human users merge PRs. Agents may repair branches, push commits, update PR metadata, and wait for checks, but never merge.
- One issue, one branch, one PR. Do not open a new stacked PR. PR #478 is an existing legacy stack and must be recovered by retargeting it to `main` after #477 merges.
- Merge current `origin/main` into an existing teammate branch; do not rebase or force-push shared history.
- Never treat an old green check as proof after the branch or its base changes. Every updated PR needs a fresh complete Actions run.
- Never edit a previously merged migration. The unmerged migrations in the three open PRs may still be corrected on their existing branches.
- Do not stage `docs/superpowers/plans/2026-09-11-project-team-role-matrix.md`; it is untracked user work.
- Before every `git add`, run `git status --short` and add exact paths only. Never use `git add .` or `git add -A`.
- Every database branch must pass `npx supabase db reset`, `npx supabase test db`, generated-type drift verification, and the complete local CI script before it is pushed.
- Keep `private` SECURITY DEFINER functions at `set search_path = ''`, fully qualify objects, and preserve explicit revokes/grants.
- A read gate must fail closed for anonymous, claimless-UID, inactive, stale-claim, and below-threshold callers.
- Branch counts in `tracker_grants.test.sql` are derived from the merged schema. The expected counts below are valid only for the stated merge order.

---

## Verified State at Plan Creation

| Surface | Verified state on 2026-09-16 | Consequence |
| --- | --- | --- |
| `origin/main` | `450b3d6`, through PR #476 | The reporting Cup and member drill-down are already on `main`. |
| PR #492 / #258 | Remote head `0959015`, `CLEAN`, old checks green | The green run predates the review fixes and is no longer sufficient. |
| Local #492 worktree | Two unstaged files: the leaderboard migration and test; test now declares `plan(58)` | Preserve and finish this work before switching branches or pulling. |
| PR #477 / #364 | Remote head `defb7b0`, `DIRTY`; old checks green | It conflicts with current `main`; the verified textual conflict is `supabase/tests/tracker_grants.test.sql`. |
| PR #478 / #370 | Remote head `4326677`, based on `backend/364-actor-helpers`, old checks red | It must not be merged into its feature-branch base. Merge #477, retarget #478 to `main`, reconcile, and rerun all checks. |
| Task Tracker backend milestone | Open: #258, #364, #262, optional #379 | #296 and the lifecycle-command wave are closed. |

---

### Task 1: Finish the PR #492 review-fix round without losing local work

**Files:**
- Modify: `supabase/migrations/20260916174640_leadership_leaderboard.sql`
- Modify: `supabase/tests/leadership_leaderboard.test.sql`
- Local-only report: `.superpowers/sdd/2026-09-16-tracker-completion/task-g1-report.md`
- Never stage: `docs/superpowers/plans/2026-09-11-project-team-role-matrix.md`

**Interfaces:**
- Consumes: `private.department_cup_rows(bigint)`, `private.caller_level()`, Task-origin columns, and `points_ledger.reason in ('task', 'task_reversal')`.
- Produces: `public.leadership_leaderboard(text, text, bigint, bigint)` with shared ranks, deterministic display order, and one row for every member with in-scope Task history, including a zero or negative net.

- [x] **Step 1: Record the exact dirty state before doing anything else**

Run:

```powershell
git status --short --branch
git diff --check
git diff --stat
```

Expected: only the two #492 SQL files are modified plus the known untracked user plan. Do not switch branches while those two modifications are unstaged.

- [x] **Step 2: Verify the review corrections are all represented in the diff**

The migration must contain all of these behaviors:

```sql
-- Zero-net members remain rows because there is no HAVING clause.
group by entry.member_id

-- Equal point totals share a rank; the name only orders displayed peers.
rank() over (order by scored.points desc)::int
...
order by scored.points desc, member.full_name asc
```

The test suite must independently prove:

1. a reversed award appears at exactly `0`;
2. a larger reversal produces a negative total;
3. equal totals share a rank and the following rank has the standard gap;
4. Independent-Team work appears unfiltered and under its Team filter, but under no Department filter;
5. Leaderboard and Department Cup membership/total attribution agree for every `departments.kind = 'department'` row;
6. Moderator is on the allow side;
7. `leaderboard`, `dept_cup`, and `member_points` remain present;
8. the public wrapper repeats `order by points desc, full_name asc`;
9. the migration documents that paging belongs to the frontend because the RPC is unbounded.

Expected test declaration after the final review fix set: `select plan(59);`.

- [x] **Step 3: Run the focused suite from a fresh schema**

Run:

```powershell
npx supabase db reset
npx supabase test db supabase/tests/leadership_leaderboard.test.sql
```

Expected: 59 assertions pass. If the CLI version does not accept a file argument, discover the supported syntax with `npx supabase test db --help`, then run the equivalent focused command rather than guessing.

- [x] **Step 4: Mutation-prove reversal subtraction**

Record the clean migration hash:

```powershell
Get-FileHash supabase/migrations/20260916174640_leadership_leaderboard.sql -Algorithm SHA256
```

Perform each mutation separately, run the focused test, confirm a failure, then restore the exact original file before the next mutation:

```sql
-- Mutation A: wrong absolute-value total.
sum(abs(entry.delta))::int

-- Mutation B: wrong reason set.
entry.reason in ('task')
```

Expected: at least one zero/negative reversal assertion fails for each mutation. After restoration, the SHA-256 hash must match the recorded value byte-for-byte.

- [x] **Step 5: Mutation-prove Independent-Team exclusion from Department filters**

Temporarily replace the Team-origin Department predicate with the known-bad coercion:

```sql
coalesce(origin_team.dept_id, '') = p_department_id
```

Run the focused suite and confirm the all-Department exclusion assertion fails. Restore the file and confirm the original SHA-256 hash again.

- [x] **Step 6: Run every local gate**

Run:

```bash
bash scripts/check-local-ci.sh
```

Expected: all 24 local gates pass. Record the summary and the three mutation failures in the ignored local report under a new `## Fix round 1` section.

- [x] **Step 7: Commit only the two tracked #492 files**

Run:

```powershell
git status --short
git add supabase/migrations/20260916174640_leadership_leaderboard.sql
git add supabase/tests/leadership_leaderboard.test.sql
git diff --cached --check
git commit -m "fix(db): align leadership leaderboard review contract (#258)"
git push origin backend/258-leadership-leaderboard
```

Do not stage the ignored SDD report or either plan document.

- [x] **Step 8: Correct the PR description and wait for fresh checks**

Update PR #492 so it no longer says that zero-net members disappear or tied members receive consecutive ranks. The body must say:

- zero/negative net members remain visible when they have Task history;
- equal points share a rank;
- paging is a frontend responsibility;
- the suite has 59 assertions and includes three mutation proofs.

Run:

```powershell
gh pr checks 492 --watch
```

Expected: Repository, database, Edge Function, frontend, and secret-scan jobs pass on the new commit. The staging job skips on the PR by design.

### Task 2: Human-merge PR #492 and establish the new baseline

**Files:** None.

**Interfaces:**
- Consumes: fresh green PR #492.
- Produces: `main` with the final #258 contract and private-function roster count `86`.

- [ ] **Step 1: Merge #492 only after its new checks are green**

Human action: merge PR #492 and delete its branch.

- [ ] **Step 2: Verify the merged-main run, not just the PR run**

Run:

```powershell
gh run list --repo Alex-Bancila/osubb-app --branch main --limit 3
git fetch origin main --prune
git log -1 --oneline origin/main
```

Expected: the newest `main` workflow is green and contains the #492 merge. If staging deployment fails while all verification jobs pass, investigate deployment independently before starting another migration merge.

### Task 3: Reconcile PR #477 / issue #364 with post-#492 `main`

**Files:**
- Modify: `supabase/tests/tracker_grants.test.sql`
- Review, and modify only if required by current definitions: `supabase/migrations/20260915222925_actor_authorization_helpers.sql`
- Review: `supabase/tests/actor_level.test.sql`
- Update: PR #477 body and issue #364 body/status notes

**Interfaces:**
- Consumes: private-function roster `86`, `private.caller_level()` contract, all merged Task commands, and the #258 leadership gate.
- Produces: `private.actor_level(uuid default auth.uid())`, `private.require_active_member()`, preserved `private.caller_level()` `-1` sentinel, preserved `public.member_level(uuid)` `0` sentinel, and final roster count `88`.

- [ ] **Step 1: Start only after Task 2 and bring the shared branch forward without rewriting history**

Run from a clean worktree:

```powershell
git switch backend/364-actor-helpers
git fetch origin main backend/364-actor-helpers
git merge origin/main
```

Expected: the known textual conflict is in `supabase/tests/tracker_grants.test.sql`. Stop and re-audit if Git reports any additional semantic conflict.

- [ ] **Step 2: Resolve the grants roster by union, not by choosing one side**

The resolved roster must preserve:

```text
#259 private.department_cup_rows
#260 private.leadership_member_tasks_impl
#258 private.leadership_leaderboard_impl
#364 private.actor_level
#364 private.require_active_member
```

With no other migration merged between Tasks 2 and 3, the expected private-function count is:

```sql
select is(
  (select count(*) from pinned_private_functions)::int,
  88,
  'the audited roster contains the 86 post-#258 functions plus actor_level and require_active_member'
);
```

Do not retain either side's old `85`/`86` explanatory text.

- [ ] **Step 3: Re-audit #364 against the completed command wave**

The issue text still says “five call sites,” but the branch now redefines the final live authorization consumers, including the Completed-work Request decider. Verify the installed definitions rather than grepping historical migrations, because old immutable migrations must continue to contain their original SQL.

After `npx supabase db reset`, inspect live definitions with:

```sql
select n.nspname,
       p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       pg_get_functiondef(p.oid) as definition
  from pg_proc as p
  join pg_namespace as n on n.oid = p.pronamespace
 where n.nspname in ('private', 'public')
   and p.proname in (
     'caller_level',
     'member_level',
     'can_manage_project_work',
     'require_project_admin',
     'require_active_project_lead',
     'can_manage_origin',
     'can_evaluate_task',
     'is_global_task_reader',
     'can_read_task',
     'require_origin_manager',
     'require_request_decider'
   )
 order by n.nspname, p.proname, args;
```

Check the definitions consume `private.actor_level(...)` / `private.require_active_member()` where they need a live actor. Do not require historical migration files to lose their old joins.

- [ ] **Step 4: Prove all three identity channels disagree safely**

Keep/add pgTAP cases in `supabase/tests/actor_level.test.sql` proving:

```text
active profile + org claims       -> live level and active member id
inactive profile + stale claims   -> null live level and 42501 not_active_member
missing profile + valid sub       -> null live level and 42501 not_active_member
active profile + no org claims    -> 42501 not_active_member
member_level(inactive member)     -> 0
caller_level(inactive caller)     -> -1
```

The existing command suites must still prove their command-specific stable error codes; #364 must not replace them with a generic error visible to clients.

- [ ] **Step 5: Run the full verification gate**

Run:

```powershell
npx supabase db reset
npx supabase test db
npm run gen:types --prefix app
git diff --exit-code -- app/src/lib/database.types.ts
```

Then run:

```bash
bash scripts/check-local-ci.sh
```

Expected: no generated-type change, all pgTAP suites pass, and all 24 local gates pass.

- [ ] **Step 6: Commit, push, and refresh PR metadata**

Run `git status --short`, add only the files changed by the reconciliation, commit the merge resolution, and push `backend/364-actor-helpers` normally.

Update PR #477 to replace the obsolete “five call sites” and billing-block notes with:

- the final consumer list;
- roster `86 → 88`;
- the live-definition audit method;
- the new full local-CI result.

Wait for fresh checks:

```powershell
gh pr checks 477 --watch
```

### Task 4: Human-merge PR #477 and unblock both backend verification and Calendar recovery

**Files:** None.

**Interfaces:**
- Consumes: green #477 against post-#492 `main`.
- Produces: final shared live-actor helpers used by subsequent authorization tests and #478.

- [ ] **Step 1: Human-merge #477 and delete its branch only after green Actions**

- [ ] **Step 2: Verify merged-main CI and staging migration application**

The #477 migration timestamp is older than #492's but is semantically independent and the workflow uses `--include-all`. Confirm the merged-main deployment applies the missing migration rather than assuming timestamp order handled it.

### Task 5: Implement #262 as the final Task Tracker points authorization matrix

**Files:**
- Create: `supabase/tests/points_authorization_matrix.test.sql`
- Do not modify implementation or grants unless the matrix exposes a real defect.

**Interfaces:**
- Consumes: `public.my_points`, `public.points_ledger`, `public.leadership_leaderboard(text,text,bigint,bigint)`, `public.department_cup(bigint)`, and `public.leadership_member_tasks(uuid)`.
- Produces: one non-vacuous matrix proving the complete points read boundary across all relevant identities.

- [ ] **Step 1: Branch from post-#477 `main`**

```powershell
git switch main
git pull --ff-only
git switch -c codex/262-points-authorization-matrix
```

- [ ] **Step 2: Write owned fixtures before persona assertions**

The new pgTAP transaction must create its own:

- active ordinary member with one Task ledger row and one sanction row;
- second member with Task history;
- inactive member with Task history;
- Department Task, Department-Team Task, Project Task, and Independent-Team Task;
- one real Department Cup contribution;
- one leadership drill-down result.

Add non-vacuity assertions as `postgres` proving every expected row exists before changing role. Seed data must not make an assertion pass.

- [ ] **Step 3: Encode the exact authorization matrix**

The test must exercise:

| Persona | `my_points` | own ledger | another ledger | leaderboard | Cup | member drill-down |
| --- | --- | --- | --- | --- | --- | --- |
| anonymous | none/denied | none | none | no execute/no rows | no execute/no rows | no execute/no rows |
| valid UID, no org claims | none | none | none | no rows | no rows | no rows |
| inactive with stale claims | none | none | none | no rows | no rows | no rows |
| levels 0–3 | own total | own rows | none | no rows | no rows | no rows |
| Responsabil level 4 | own total | own rows | none | no rows | no rows | no rows |
| BCE level 5 | own total | globally authorized ledger rows | globally authorized rows | rows | rows | rows |
| BC level 6 | same leadership boundary | same | same | rows | rows | rows |
| Moderator level 9 | same leadership boundary | same | same | rows | rows | rows |
| `service_role` | only explicitly granted server surfaces | only explicit grants | no accidental public-wrapper bypass | no accidental leadership bypass | no accidental leadership bypass | no accidental leadership bypass |

For each “no rows” case, use a known fixture ID and assert exact zero. For each allowed case, assert exact IDs/totals, not only `lives_ok`.

- [ ] **Step 4: Run red before green**

First run the new file with one deliberately inverted expected result and confirm pgTAP reports that named assertion red. Restore the intended expectation, then run:

```powershell
npx supabase db reset
npx supabase test db supabase/tests/points_authorization_matrix.test.sql
npx supabase test db
```

Expected: the focused matrix and every existing suite pass.

- [ ] **Step 5: Keep verification separate from implementation fixes**

If the matrix uncovers a real authorization defect, preserve the failing test and open a small dedicated fix issue/PR. Do not hide a semantic migration inside #262's “verification matrix” scope.

- [ ] **Step 6: Run full local CI, commit the one test file, open a PR closing #262**

Expected: no migration and no generated type diff. Merge #262 before declaring the Task Tracker backend complete.

### Task 6: Recover and finish PR #478 / issue #370 after #477 lands

**Files:**
- Modify as needed: `supabase/tests/tracker_grants.test.sql`
- Regenerate: `app/src/lib/database.types.ts`
- Review: `supabase/migrations/20260915230000_create_event_scope_authorization.sql`
- Review: `supabase/tests/create_event.test.sql`
- Review: `supabase/tests/event_constraints.test.sql`
- Review: `supabase/tests/rls_events.test.sql`

**Interfaces:**
- Consumes: `private.actor_level`, `private.require_active_member`, project/team membership helpers, and ADR-0008.
- Produces: final `public.create_event(..., p_project_id bigint, p_min_level integer)` and `private.create_event_impl(...)`; final private-function roster `89` for the stated merge order.

- [ ] **Step 1: Retarget the legacy stack explicitly**

Only after #477 is merged:

```powershell
gh pr edit 478 --base main
git switch backend/370-create-event
git fetch origin main backend/370-create-event
git merge origin/main
```

The resulting PR must show only #370's Event changes, not #364's entire helper migration.

- [ ] **Step 2: Resolve the roster and generated types from the merged schema**

Preserve the post-#477 roster and add only:

```text
private.create_event_impl(...)
```

With Tasks 1–5 merged and #262 test-only, the count is `89`. Regenerate, never hand-edit, `app/src/lib/database.types.ts` so `create_event` includes `p_project_id` and `p_min_level`.

- [ ] **Step 3: Re-run the complete ADR-0008 creation matrix**

The tests must prove:

```text
org: Responsible+ allowed; lower roles denied
department: local BCE/BC/Moderator allowed; foreign BCE denied
department team: parent-department BCE/BC/Moderator allowed
independent team: active team member allowed; nonmember denied
project: active lead/Responsible allowed; plain member denied
minimum level: creator cannot choose above live level; Moderator exempt
created_by: always auth.uid(), never client supplied
scope fields: exactly one valid scope relationship
```

Do not rely on JWT level alone; include inactive/stale-claim and claimless-UID denials.

- [ ] **Step 4: Run full local and hosted verification**

Run `npx supabase db reset`, all pgTAP suites, generated-type drift, and `bash scripts/check-local-ci.sh`. Push normally, update the PR body to remove the stale stacked/billing notes, and wait for fresh Actions. Human-merge #478 only after it is green against `main`.

### Task 7: Resolve optional #379 without blocking delivery

**Files:** None by default.

**Interfaces:**
- Consumes: final backend milestone state.
- Produces: an explicit backlog decision rather than an indefinitely open optional blocker.

- [ ] **Step 1: Remove #379 from the backend completion path**

Recommended action: close #379 as `wontfix`/superseded with a comment that naming conventions apply to new objects and behavior/security migrations take priority. Renaming mature policies and constraints offers no product capability and creates migration risk.

If the team insists on it later, move it to a maintenance milestone and split semantic constraints from cosmetic renames; do not combine `departments.kind`, `tasks.type`, `profiles.tier`, and `push_tokens.id` changes under the label “cosmetic.”

- [ ] **Step 2: Close the Task Tracker backend milestone only when #258, #364, and #262 are closed**

#478 belongs to Calendar and does not determine Tracker backend completion.

---

## Next Task Tracker Frontend Wave

The backend command wave is already merged. The safest immediate frontend work is two parallel lanes with no intended file overlap.

### Task 8: Lane A — issue #354 leadership leaderboard and Cup

**Files:**
- Create: `app/src/queries/leadership-points.ts`
- Create: `app/src/queries/leadership-points.test.ts`
- Create: `app/src/screens/leadership/LeadershipScreen.tsx`
- Create: `app/src/screens/leadership/LeadershipScreen.test.tsx`
- Create: `app/src/screens/leadership/LeadershipTable.tsx`
- Create: `app/src/screens/leadership/LeadershipFilters.tsx`
- Modify: `app/src/queries/keys.ts`
- Modify: `app/src/App.tsx`
- Modify: `app/src/components/shell/navItems.ts`

**Interfaces:**
- Consumes: `leadership_leaderboard`, `department_cup`, `leadership_member_tasks`, `LEVEL.seeLeadership = 5`.
- Produces: `/clasament`, filter state keyed by Department/Team/Project/Campaign, and member-row navigation to `/tracker/membru/:memberId`.

- [ ] **Step 1: Add filter-aware keys and typed RPC hooks**

Use one serializable filter object in both key and RPC call:

```ts
export interface LeadershipFilters {
  departmentId: string | null;
  teamId: string | null;
  projectId: number | null;
  campaignId: number | null;
}
```

The query calls `leadership_leaderboard` and orders/paginates the RPC result client-side using its contract. The Cup receives only `campaignId`; do not send meaningless Department/Team/Project filters to it.

- [ ] **Step 2: Write component tests before the screen**

Tests must prove:

- level 4 never renders/navigates to the leadership screen;
- changing a filter changes the query key and RPC parameters;
- equal-rank members render their server rank unchanged;
- clicking a row navigates with the exact member UUID;
- empty, loading, denied, and retry states do not expose stale data.

- [ ] **Step 3: Implement the route and navigation**

Wrap `/clasament` in `RequireCapability capability="seeLeadership"`. Use name + Task points only in the table; do not add role, email, status, or current Department.

- [ ] **Step 4: Verify frontend and backend denial together**

Run the frontend gates, then use one level-4 and one BCE seeded session. The level-4 route redirect is UX; the same caller's direct RPC call must still return no protected rows.

### Task 9: Lane B — issue #176 give up an assigned task

**Files:**
- Create: `app/src/queries/task-give-up.ts`
- Create: `app/src/queries/task-give-up.test.ts`
- Create: `app/src/screens/tracker/GiveUpTaskDialog.tsx`
- Create: `app/src/screens/tracker/GiveUpTaskDialog.test.tsx`
- Modify: `app/src/screens/tracker/TaskDetailsSheet.tsx`
- Modify: `app/src/screens/tracker/TaskDetailsSheet.test.tsx`
- Modify: `app/src/queries/keys.ts` only if a missing detail/queue invalidation prefix is proven.

**Interfaces:**
- Consumes: `give_up_task(p_task_id bigint, p_reason text)` and the existing Task details/current-stage data.
- Produces: executor-only give-up action for `todo`/`in_progress`, with automatic-promotion feedback after invalidation.

- [ ] **Step 1: Write mutation classification tests**

Map stable server outcomes to Romanian feedback:

```text
42501 -> Nu poți renunța la acest task.
PT404 -> Taskul nu mai este disponibil.
PT409 -> Taskul s-a schimbat. Reîncarcă detaliile și încearcă din nou.
```

Invalidate Task detail, My Tasks, Available, management, queue, and history families after success.

- [ ] **Step 2: Write dialog behavior tests**

Prove the action is shown only to the active executor in `todo` or `in_progress`, a trimmed nonblank reason is required, duplicate submit is disabled, and `in_review`/terminal work exposes no give-up action.

- [ ] **Step 3: Implement with the existing shadcn primitives**

Call only:

```ts
supabase.rpc('give_up_task', {
  p_task_id: taskId,
  p_reason: reason.trim(),
});
```

Never send an executor/member ID. After success, refetch and show whether the Task became unassigned or the oldest candidate was promoted.

### Task 10: Continue the member-action lane sequentially with #185 then #186

**Files:**
- Create: `app/src/queries/task-progress-actions.ts`
- Create: `app/src/queries/task-progress-actions.test.ts`
- Modify: `app/src/screens/tracker/TaskStageSummary.tsx`
- Modify: `app/src/screens/tracker/TaskDetailsSheet.tsx`
- Modify corresponding tests.

**Interfaces:**
- Consumes: `start_task(p_task_id bigint)` and `submit_task_for_review(p_task_id bigint)`.
- Produces: one state-aware executor action module shared by #185 and #186.

- [ ] **Step 1: Implement #185 on its own branch after #176 merges**

Only active executor + `todo` renders “Începe taskul.” Success invalidates details/history/My Tasks and moves the visible stage to `in_progress`.

- [ ] **Step 2: Implement #186 on a fresh branch after #185 merges**

Only active executor + `in_progress` renders “Trimite la verificare.” Success invalidates details/history/management and moves the visible stage to `in_review`.

Do not implement both issues in one PR even though they share the same module.

### Task 11: Queue the next independent frontend work without file collisions

After Tasks 8–10:

1. **Manager queue lane:** #177 → #178 → #179, sequential because all alter queue controls/details.
2. **Evaluation lane:** #188 first, then #189; #187 may run before #189 if it uses its own return-to-progress dialog.
3. **Creation lane:** #180, #182, and #183 may be developed as separate branches only if each creates isolated form/query components; integrate through #184 after all three merge.
4. **Requests lane:** #352 can run independently; #353 waits for #189's reusable evaluation dialog.
5. **Maintenance:** #376 runs after #354 so it can consolidate the new leadership query rather than refactoring the old API twice.

Recommended two-person allocation:

```text
Developer A: #354 → #376
Developer B: #176 → #185 → #186
```

Then:

```text
Developer A: #188 → #189
Developer B: #177 → #178 → #179
```

The two lanes do not intentionally share files inside a wave. If a PR reveals an overlap, merge the older PR first, update the second branch from `main`, rerun all checks, and only then merge it.

---

## Final Verification and Definition of Done

The recovery tranche is complete only when:

- PR #492 contains the reviewed 58-test contract and fresh green checks;
- PR #477 is green against post-#492 `main`, with roster count 88 and no stale five-call-site claim;
- #262 proves every points boundary with owned fixtures and exact rows;
- PR #478 is retargeted to `main`, shows only Calendar work, carries roster count 89, and is green;
- #379 is explicitly deferred/closed rather than silently blocking the milestone;
- merged-main CI and staging migration deployment are green after each migration PR;
- #354 and #176 begin from current `main` as independent, non-stacked PRs.

For every backend PR:

```powershell
npx supabase db reset
npx supabase test db
```

```bash
bash scripts/check-local-ci.sh
```

For every frontend PR:

```powershell
cd app
npm run typecheck
npm run lint
npm run format:check
npm run test:run
npm run build
npm audit --audit-level=high
```

No stale green badge, successful local test from an older base, or “mergeable” status substitutes for these gates on the exact commit that will be merged.
