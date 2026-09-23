# Task Tracker Next Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the next usable Task Tracker manager slice, then unlock task creation and evaluation without duplicating server authorization rules in React.

**Architecture:** The merged Supabase command layer remains authoritative. React reads only RLS-authorized rows, calls public RPC wrappers for every state change, and invalidates TanStack Query caches after mutations. Task-specific controls are rendered from server-derived capability data, never from role labels or stale JWT claims.

**Tech Stack:** React 19, TypeScript 6, React Router 7, TanStack Query, Base UI/shadcn components, Vitest/Testing Library, Supabase/PostgreSQL/RLS/pgTAP.

**Spec:** `docs/adr/0007-task-tracker-lifecycle.md`

## Global Constraints

- Start every issue from updated `main`; one issue, one branch, one PR; never stack PRs.
- Human users merge only after local checks and available CI checks pass.
- Preserve the two unrelated untracked plan files already present in the main checkout.
- Use `CONTEXT.md` terms and Romanian interface copy: Executor, Candidate Queue, Task Manager, Evaluation, and Nerealizat.
- The browser never writes Task state tables directly and never sends an actor/member id when the server can derive it.
- Do not infer local authority from JWT role/level. Use live server capability rows or let the RPC deny the action.
- Every mutation maps `PT400`, `PT404`, `PT409`, and `42501` to safe Romanian feedback and invalidates data on conflicts.
- New public database objects need explicit grants; exposed tables/views need RLS or a documented owner-rights boundary.
- Any `security definer` implementation stays in `private`, pins `search_path = ''`, uses qualified names, and has explicit execute revokes/grants.
- The Supabase Data API is moving to explicit exposure; every new public function/view must be explicitly granted rather than relying on default privileges.
- Frontend verification for every issue: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:run`, `npm run build`.
- Backend verification for every database issue: `npx supabase db reset`, `npx supabase test db`, `npx supabase db lint --level warning --fail-on warning`, and generated-type drift verification.

---

## Current state and corrected dependency graph

The Task Tracker backend milestone is functionally complete. Issues #254–#345, #363–#368, and #371 are closed. #379 is optional cosmetic naming cleanup and does not block product work.

The member frontend already supports viewing Tasks, Available work, Task details/history, queue position, expressing/withdrawing interest, giving up, starting, and submitting for review. It also shows the current Executor and has fixed card separation/scrolling.

The next existing issues are ordered as follows:

```text
Manager queue: #177 -> #178 -> #179

Creation foundations (parallel):
  new manageable-origins contract -> #180
  #183 -----------------------------> #180
  #349 -----------------------------> #180
  #180 -> #182 -> new create-task submit issue -> #184 / #347 / #348

Evaluation foundations:
  #188 ------------------------------> #189 -> #346 / #353
  new evaluable-task contract -------> #189
  #187, #190, #191 use the same task-action area and therefore merge sequentially

Later independent UI:
  #352 requests list
  #354 leadership metrics
```

Do not assign #180 or #189 yet. Their current GitHub blockers mention only merged backend commands, but each lacks one live authorization contract needed by the frontend.

---

## Wave 1 — Candidate Queue manager controls

These three issues deliberately run in one sequential lane because they modify the same Task-details action area. A second developer can implement #188 while this lane runs.

### Task 1: #177 — Select a queued Candidate

**Files:**
- Create: `app/src/queries/task-candidate-selection.ts`
- Create: `app/src/queries/task-candidate-selection.test.tsx`
- Create: `app/src/screens/tracker/TaskCandidateSelector.tsx`
- Create: `app/src/screens/tracker/TaskCandidateSelector.test.tsx`
- Modify: `app/src/queries/keys.ts`
- Modify: `app/src/screens/tracker/TaskDetailsSheet.tsx`
- Modify: `app/src/screens/tracker/TaskDetailsSheet.test.tsx`
- Modify: `app/src/screens/tracker/TrackerScreen.tsx`
- Modify: `app/src/screens/tracker/TrackerScreen.test.tsx`

**Interfaces:**
- Consumes: `public.task_candidates`, `public.profiles_directory`, `public.my_managed_task_ids()`, and `public.select_task_candidate(bigint,bigint,boolean)`.
- Produces:

```ts
export type PendingTaskCandidate = {
  id: number;
  memberId: string;
  fullName: string;
  joinedAt: string;
};

export async function fetchPendingTaskCandidates(
  taskId: number,
): Promise<PendingTaskCandidate[]>;

export async function selectTaskCandidate(input: {
  taskId: number;
  candidateId: number;
  closeRemaining: boolean;
}): Promise<void>;
```

- [ ] **Step 1: Add failing query tests**

Test that the query filters by `task_id` and `status = pending`, orders by `joined_at` then `id`, maps only authorized returned rows, and does not accept a member id as mutation input.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm run test:run -- src/queries/task-candidate-selection.test.tsx`

Expected: fail because the module does not exist.

- [ ] **Step 3: Implement the query and mutation boundary**

Query `task_candidates` with the explicit `task_candidates_member_id_fkey` relation to the safe `profiles_directory` projection. Call only:

```ts
supabase.rpc('select_task_candidate', {
  p_task_id: taskId,
  p_candidate_id: candidateId,
  p_close_remaining: closeRemaining,
});
```

For #177, submit `closeRemaining: false`; #178 replaces that fixed safe default with an explicit choice. On every settled mutation invalidate `keys.tasks.all`; on `PT409`, show stale-queue copy and refetch candidates before another submission.

- [ ] **Step 4: Add failing component tests**

Cover oldest-first Candidate rendering, Candidate name, disabled pending state, one selected id, manager-only rendering, keyboard operation, and `PT409` feedback.

- [ ] **Step 5: Implement the selector**

Render real radio controls and one confirmation button. Never build a free-form member-id input. Obtain the per-task manager flag from the already-authoritative managed Task ids and pass it into the details sheet; do not use `claims.level` as a proxy.

- [ ] **Step 6: Verify the issue**

Run the focused query/component/sheet tests, then the complete frontend verification commands from Global Constraints.

### Task 2: #178 — Decide the remaining queue in the same transaction

**Files:**
- Modify: `app/src/screens/tracker/TaskCandidateSelector.tsx`
- Modify: `app/src/screens/tracker/TaskCandidateSelector.test.tsx`
- Modify: `app/src/queries/task-candidate-selection.test.tsx`

**Interfaces:**
- Consumes: `selectTaskCandidate({ taskId, candidateId, closeRemaining })` from Task 1.
- Produces: an explicit `closeRemaining` decision before the single RPC call.

- [ ] **Step 1: Write failing decision tests**

When another pending Candidate remains, require one of:

```text
Păstrează coada deschisă
Închide coada rămasă
```

When the selected Candidate is the last pending row, omit the question and submit `false` because no remaining row can be closed.

- [ ] **Step 2: Confirm focused tests fail**

Run: `npm run test:run -- src/screens/tracker/TaskCandidateSelector.test.tsx`

- [ ] **Step 3: Implement the explicit decision**

Keep Candidate selection and queue decision in one form and one `select_task_candidate` call. Do not call `set_task_queue` as a second transaction.

- [ ] **Step 4: Verify cache and feedback behavior**

Assert one mutation, one feedback message, no duplicate invalidation, and stale data refetched after `PT409`.

- [ ] **Step 5: Run complete frontend verification**

Use the commands in Global Constraints.

### Task 3: #179 — Open or close a public Candidate Queue

**Files:**
- Create: `app/src/queries/task-queue-management.ts`
- Create: `app/src/queries/task-queue-management.test.tsx`
- Create: `app/src/screens/tracker/TaskQueueControl.tsx`
- Create: `app/src/screens/tracker/TaskQueueControl.test.tsx`
- Modify: `app/src/screens/tracker/TaskDetailsSheet.tsx`
- Modify: `app/src/screens/tracker/TaskDetailsSheet.test.tsx`

**Interfaces:**
- Consumes: `TaskPresentation.assignmentMode`, `TaskPresentation.queueClosed`, the per-task manager flag, and `public.set_task_queue(bigint,boolean)`.
- Produces:

```ts
export async function setTaskQueue(input: {
  taskId: number;
  open: boolean;
}): Promise<void>;
```

- [ ] **Step 1: Write failing mutation tests**

Pin exact RPC arguments, map `PT409` to “starea cozii s-a schimbat”, map `42501` to forbidden copy, and invalidate `keys.tasks.all` even after a conflict.

- [ ] **Step 2: Implement the mutation hook**

Call only `set_task_queue`; never update `tasks.queue_closed_at` or Candidate rows from React.

- [ ] **Step 3: Write failing control tests**

The control appears only for a manager of a nonterminal public Task. It says “Închide coada” while open and “Redeschide coada” while closed, confirms the destructive close, prevents duplicate submission, and remains hidden for direct Tasks and Umbrellas.

- [ ] **Step 4: Implement and integrate the control**

Place it beside the selector in the Task details manager-actions section. Preserve Candidate/participant visibility after closing; the server and RLS own that behavior.

- [ ] **Step 5: Verify the issue**

Run focused tests and complete frontend verification.

---

## Wave 1B — Independent scoring-guide component

### Task 4: #188 — Present the canonical scoring guide

**Files:**
- Create: `app/src/queries/scoring-guide.ts`
- Create: `app/src/queries/scoring-guide.test.ts`
- Create: `app/src/screens/tracker/ScoringGuide.tsx`
- Create: `app/src/screens/tracker/ScoringGuide.test.tsx`
- Modify: `app/src/queries/keys.ts`

**Interfaces:**
- Consumes: RLS-protected `public.rating_guide` and the immutable points formula `difficulty × multiplier`.
- Produces: `<ScoringGuide difficulty?: number />`, reusable by #189, #346, and #353.

- [ ] **Step 1: Write failing data tests**

Require ratings ordered 1–5 and expose `rating`, `multiplier`, `label`, and `note`. Missing or malformed rows are an error, not a silently invented guide.

- [ ] **Step 2: Implement the reference query**

Cache it under `keys.reference` with the same long-lived reference-data convention as departments and roles.

- [ ] **Step 3: Write failing component/accessibility tests**

Assert all five ratings, text labels for negative/zero/positive outcomes, no color-only meaning, keyboard-readable markup, and a points preview when Difficulty is supplied.

- [ ] **Step 4: Implement responsive presentation**

Use compact cards or a semantic table that remains readable on mobile. Do not add Evaluation controls in this issue.

- [ ] **Step 5: Run complete frontend verification**

Use the commands in Global Constraints.

---

## Wave 2 — Required authorization contracts for creation and evaluation

These are new issues that should be created individually before assigning #180 or #189.

### Task 5: New backend issue — Expose manageable Task Origins

**Suggested issue title:** `Tracker: expose the current member's manageable Origins`

**Files:**
- Create: new timestamped migration via `npx supabase migration new manageable_task_origins`
- Create: `supabase/tests/manageable_task_origins.test.sql`
- Modify: `supabase/tests/tracker_grants.test.sql`
- Modify: `app/src/lib/database.types.ts` through generated types only

**Interface:**

```sql
public.my_manageable_task_origins()
returns table (
  origin_type text,
  origin_id text,
  origin_name text,
  parent_department_id text
)
```

- [ ] **Step 1: Write a failing pgTAP role/scope matrix**

Cover local BCE, Independent-Team member, Project lead, Project Responsible, BC, ordinary nonmanager, inactive member, claimless uid, and anon. `parent_department_id` is populated only for Department Teams.

- [ ] **Step 2: Implement the narrow read contract**

Return only Origins for which live `private.can_manage_origin(...)` is true. The public wrapper is callable only by `authenticated`; anon and service role have no execute grant. Do not expose the private predicate itself through the Data API.

- [ ] **Step 3: Add roster/grant checks and regenerate types**

Pin function signature, invoker/definer shape, empty search path where applicable, and explicit grants.

- [ ] **Step 4: Run all backend verification**

Use the commands in Global Constraints.

### Task 6: New backend issue — Expose evaluable Task ids

**Suggested issue title:** `Tracker: expose the current member's evaluable Tasks`

**Files:**
- Create: new timestamped migration via `npx supabase migration new evaluable_task_ids`
- Create: `supabase/tests/evaluable_task_ids.test.sql`
- Modify: `supabase/tests/tracker_grants.test.sql`
- Modify: `app/src/lib/database.types.ts` through generated types only

**Interface:**

```sql
public.my_evaluable_task_ids()
returns table (task_id bigint)
```

- [ ] **Step 1: Write the failing authorization matrix**

Cover Department/local BCE, Department Team/local BCE, Independent Team/BC only, Project lead, Project Responsible evaluating an ordinary member, Responsible blocked on self and lead, BC, inactive, claimless uid, and anon.

- [ ] **Step 2: Implement from the existing live predicate**

Return visible Task ids for which `private.can_evaluate_task(task.id)` is true. Do not reproduce role/project rules in a second SQL expression.

- [ ] **Step 3: Pin grants and regenerate types**

Use explicit execute grants and add the function to the conventions roster.

- [ ] **Step 4: Run all backend verification**

Use the commands in Global Constraints.

---

## Wave 3 — Task creation

Run #183 and #349 in parallel. Merge both before #180 so the form composes stable inputs rather than replacing temporary controls.

### Task 7: #183 — Searchable active-member selector

Create a reusable `MemberPicker` backed by `profiles_directory`, filtering `status = activ` and returning exactly one UUID. Department, Team, Project, and Campaign filters are conveniences only; no filter may remove an otherwise active Member permanently. Tests pin search, filters, selection, keyboard use, empty/error states, and clearing an invalid selection when form context changes.

### Task 8: #349 — Campaign query and management

Add `useCampaigns(departmentId, includeInactive)` and the local BCE/BC/Moderator management panel. Active Campaigns feed the creation form; inactive Campaigns remain available to historical filters. Tests pin create/rename/activate RPC payloads and live authority gating.

### Task 9: #180 — Compose the direct/public Task form

Build a pure form that produces this value and performs no write:

```ts
export type TaskDraft = {
  title: string;
  description: string | null;
  deadline: string | null;
  origin: { type: 'department' | 'team' | 'project'; id: string };
  audience: 'local' | 'org' | null;
  assignmentMode: 'direct' | 'public' | null;
  executorId: string | null;
  campaignId: number | null;
  parentTaskId: number | null;
  kind: 'task' | 'umbrella';
};
```

Origins come only from `my_manageable_task_origins()`. Ordinary Tasks require Audience and Assignment Mode; direct Tasks require the #183 selector; public Tasks never send an Executor. Umbrellas send no deadline, Audience, Assignment Mode, Executor, or Campaign. Subtasks lock their Origin to the parent. Difficulty never appears here.

### Task 10: #182 — Pure Task-draft validation

Create `validateTaskDraft(draft, references)` as a pure module. It rejects blank titles, missing/invalid Bucharest deadlines, incomplete Origin, invalid Campaign/Department relation, forbidden Campaign on Project/Independent Team, missing Executor for direct Tasks, Executor on public Tasks, and forbidden fields on Umbrellas. Return field-keyed Romanian messages; server `PT400` remains authoritative.

### Task 11: New frontend issue — Submit through `create_task`

**Suggested issue title:** `Tracker: create a Task through the server command`

Create `app/src/queries/task-create.ts` with one mutation that maps `TaskDraft` to the exact `create_task` RPC signature. Add a manager-facing “Task nou” action, pending/success/error feedback, reset on success, navigation to the created Task, and invalidation of `keys.tasks.all`. Tests pin every nullable origin field and prove no direct table insert occurs.

### Task 12: #184 and the missing mode-conversion issue

Implement #184 over `update_task_content`, reusing the form fields for title, description, deadline, and Campaign. File a separate issue titled `Tracker: convert Assignment Mode before participation` for `convert_task_mode`; do not put mode conversion into #184 because it has a separate server command and state rule.

---

## Wave 4 — Review and terminal outcomes

Use one sequential Task-details action lane to reduce merge conflicts:

1. #187 — return `in_review` work to progress with a required note.
2. #189 — shared Evaluation dialog using #188 and `my_evaluable_task_ids()`.
3. #346 — reuse that dialog for overdue Nerealizat.
4. #190 — reopen with a required reason and explicit points-reversal warning.
5. #191 — cancel with a reason and Umbrella cascade warning.

Every action gets its own query module and component test. The details sheet receives server-derived `canEvaluate`/`canManage` flags. Do not render Evaluation actions from role level alone. All successful or conflicting outcomes invalidate Tasks, history, points, and leadership metric families as applicable.

---

## Wave 5 — Advanced management and complete product surfaces

Implement in this order:

1. #350 — assign an active Executor to an unassigned direct Task; reuse #183.
2. #347 — duplicate a Task with a new Bucharest deadline.
3. #348 — Umbrella progress, Subtask creation, and completion.
4. #352 — Member's completed-work request status list.
5. #353 — manager request queue; reuse #189 Evaluation fields.
6. #354 — BCE+ Leadership Leaderboard, Department Cup, filters, and member drill-down.

Close umbrellas only after acceptance:

- #88 after My Tasks and details/lifecycle behavior are complete.
- #89 after Candidate selection and queue management are complete.
- #90 after create/edit/assign/duplicate/Umbrella creation are complete.
- #91 after return/evaluate/Nerealizat/reopen/cancel are complete.
- #92 after #351–#353 are complete.

#104 remains deferred. #379 remains optional and should be done only when no product PR touches policies/constraints.

---

## Team allocation without merge conflicts

For two developers:

```text
Developer A — Task-details action lane
#177 -> #178 -> #179 -> #187 -> #189 -> #346 -> #190 -> #191

Developer B — standalone foundations and screens
#188 -> new manageable-Origins backend issue -> #183 -> #349 -> #352
                    new evaluable-Tasks backend issue can run before #189
```

After #183 and #349 merge, assign #180 -> #182 -> the new create-submit issue sequentially to one developer. The other developer can continue #352 or prepare #354. Do not run two PRs that both edit `TaskDetailsSheet.tsx` or the same form component in parallel.

Keep only the immediate 3–5 issues labeled `ready-for-agent`: initially #177, #188, the manageable-Origins contract, and the evaluable-Tasks contract. Add #178 only after #177 merges.

## Milestone acceptance

The next Tracker milestone is accepted when:

- A manager opens a Task, sees only authorized Candidates, selects one, and explicitly keeps or closes the remaining queue.
- A manager opens/closes a public queue and stale concurrent actions recover through refetch.
- A manager creates a direct or public Task only for a live manageable Origin.
- Difficulty appears only during Evaluation.
- An authorized Reviewer returns or evaluates submitted work; unauthorized managers never see Evaluation controls.
- Personal and leadership points refresh after Evaluation, Nerealizat, or reopen.
- Ordinary Members still see only their own Tasks, Candidates, points, and eligible Opportunities.
- A fresh `npx supabase db reset` plus full pgTAP and frontend suites pass.
- Desktop/mobile keyboard use has no console errors and every touch target is at least 44×44 px.

