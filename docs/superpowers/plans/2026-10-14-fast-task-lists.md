# Task lists that stay fast — implementation plan

> **For agentic workers:** executed inline (superpowers:executing-plans) by the session that wrote it. Steps use checkbox (`- [ ]`) syntax. Every task is test-first: the named tests are written and seen failing before the code they cover. Interfaces, files and test names are exact; bodies are written during execution against the spec, which is binding.

**Goal:** leadership's Task lists and filter options answer in well under a second with thousands of finished Tasks, and keep doing so as the archive grows.

**Architecture:** list authority is decided per Group in one private function (`private.task_list_scope`), with the per-Task rules as the fallback; `public.task_list` returns a page of ready rows in one request; the page reads open Tasks whole and finished Tasks by infinite scroll, and takes filter choices from `public.task_list_summary`.

**Tech stack:** Postgres 17 (Supabase, pgTAP), PostgREST, React 19, TanStack Query v5, vitest.

**Spec:** `docs/superpowers/specs/2026-10-14-fast-task-lists-design.md`

## Global constraints

- No table, policy, index or existing function changes. `public.my_managed_task_ids()` stays.
- Every new function: `set search_path = ''`, fully qualified names, `revoke execute … from public, anon, authenticated, service_role`; public ones `grant execute … to authenticated`. Definer only on `private.*_impl` and `private.task_list_scope`.
- No function body mentions `groups.category` (`conventions.test.sql`).
- The migration is dated after the newest on `main` when it merges.
- Refusals are `PT400` with the reasons of spec §3.2; reasons get Romanian copy in `app/src/lib/command-reasons.ts` only if a page can show them (none can: the page never sends an invalid argument).
- Full vitest never overlaps `db reset`, pgTAP or `check:root`.
- UI copy is Romanian, in `CONTEXT.md`'s vocabulary: **Taskuri încheiate**, **Încarcă mai multe**.

## Review focus

1. A Responsible in a Group that has a Manager, looking at a Task executed by another Responsible: must not be listed in `'managed'` (the fallback, not the shortcut, decides).
2. A level-5 caller and a Private Group they cannot see: its Tasks are in `'all'` only through their own Assignment, Candidature or the Umbrella rule.
3. A page boundary while Tasks finish: a Task must not be drawn twice (the page dedupes by id) and `total` comes from the first page.
4. **Stare** naming a state the list no longer holds after a refetch: cleared, as today.
5. A `?task=` link to a finished Task that is on no loaded page: lands on De gestionat with the sheet open and its manager controls present.

---

## PR A — the readers (branch `feat/<issue A>-task-list-readers`)

### Task 1: the scope

**Files:** create `supabase/migrations/<stamp>_task_list_readers.sql`; create `supabase/tests/task_list.test.sql`.

**Produces:** `private.fold_search(p_text text) returns text` (immutable); `private.task_list_scope(p_list text) returns table(task_id bigint)`.

- [ ] Suite, part 1 (fixtures: `_group_task_fixtures.psql` matrix; a Private Group with a member, a Responsible and an outsider at level 5; an archived Group; Tasks open with a Manager / Responsible / member as Executor, open without Executor, completed, unfulfilled, cancelled, an Umbrella with a Subtask in another Group). A temp function `pg_temp.scope_ids(p_list)` reads the scope through a `security definer` test wrapper granted to `authenticated`. Assertions: definer and `search_path`; no execute for `anon`, `authenticated`, `service_role`; for each caller `scope('managed')` = `my_managed_task_ids()`; `scope('all')` = `select id from public.tasks` for level ≥ 5 and empty below; inactive and claimless callers get nothing; an unknown list gets nothing; `fold_search` cases (`'Ședință'`, `'ŞEDINŢĂ'`, `'  Mixed Çase '`, null).
- [ ] Run: fails (functions missing).
- [ ] Migration: the two functions. Run: passes.
- [ ] Commit.

### Task 2: `task_list`

**Consumes:** Task 1. **Produces:** `private.require_task_list_args(p_list text, p_state text, p_sort text, p_limit integer, p_offset integer) returns void`; `private.task_list_impl(…12 arguments…)`; `public.task_list(…)` exactly as spec §3.2.

- [ ] Suite, part 2: wrapper is invoker, impl is definer, grants; every refusal with its reason; row columns equal the `tasks` row; `assignments`, `evaluations`, `submission` equal what PostgREST's embeds give that caller through RLS (compared as jsonb built from the RLS'd tables under the caller's role); `executor` equals `public.visible_task_executors` for open, completed, unfulfilled and cancelled Tasks; `p_finished` true / false / null; Group subtree; Campaign; range (half-open, undated out); each `p_state`; search (case, diacritics, no match); `p_preferred` with an unselected Group and with a locked one; order for both sorts including undated rows; `p_limit` / `p_offset` pages are disjoint and cover the set; `total` on every row and unaffected by the page.
- [ ] Run: fails. Migration. Run: passes. Commit.

### Task 3: summary, leadership filter work, capability

**Produces:** `public.task_list_summary(p_list text)`, `public.leadership_filter_work()`, `public.can_manage_task(p_task_id bigint)` (+ their private impls where definer is needed).

- [ ] Suite, part 3: summary counts per (Group, Campaign, status, late, dated) and `sum(tasks)` = scope size; `invalid_list`; `leadership_filter_work` lists an evaluated Task's pair once, not an unevaluated Task, not an Umbrella, not a Task of a Private Group the caller cannot see, nothing below level 5; `can_manage_task` equals `private.can_manage_task` for a readable Task, false for an unknown id, refused for `anon`.
- [ ] Run: fails. Migration. Run: passes. Commit.

### Task 4: the guard, the sweeps, the types

- [ ] Guard in the suite: 3 000 generated completed Tasks (direct inserts as the table owner, one ended Assignment each) in one Group managed by a level-3 Responsible; `performs_ok` for a 50-row page, the summary and `leadership_filter_work` at 2 000 ms (set-based: about 0.1 s; per Task: above 3 s).
- [ ] Mutation record in the suite header: each mutation applied to the live database, the named assertion fails, the function is restored.
- [ ] `npx supabase db reset && npx supabase test db` (all suites), `npx supabase db lint --level warning`, generated types (`app/src/lib/database.types.ts`), `docs/backend/conventions.md` (a paragraph under read functions: lists decide authority per Group; no page reads an archive whole), `scripts/check-local-ci.sh` gates that apply.
- [ ] Commit.

## PR B — the page (branch `feat/<issue B>-task-lists-page`, on top of A)

### Task 5: `queries/task-lists.ts`

**Produces:**

```ts
export type TaskListName = "managed" | "all";
export type FinishedState = "completed" | "unfulfilled" | "cancelled" | "late";
export type FinishedFilters = WorkFilterParams & {
  p_state?: FinishedState;
  p_search?: string;
  p_preferred?: boolean;
  p_sort?: ManagerTaskSort;
};
export const FINISHED_PAGE = 50;
export function taskListRow(
  row: TaskListRpcRow,
  labels: TaskListLabels,
): TaskPresentationRow;
export async function fetchOpenTasks(
  list: TaskListName,
  memberId: string,
): Promise<TaskPresentationRow[]>;
export async function fetchFinishedPage(
  list,
  filters,
  offset,
  memberId,
): Promise<{ rows: TaskPresentationRow[]; total: number }>;
export async function fetchTaskListSummary(
  list: TaskListName,
): Promise<TaskListSummaryRow[]>;
export function useManagedTasks(enabled: boolean);
export function useAllTasks(enabled: boolean);
export function useFinishedTasks(
  list,
  filters: FinishedFilters | null,
  enabled: boolean,
); // useInfiniteQuery
export function useTaskListSummary(list, enabled: boolean);
export function useManagedTasksInRange(
  range: { from: string; to: string } | null,
  enabled: boolean,
);
export function useTaskManageCapability(
  taskId: number | null,
  enabled?: boolean,
);
```

Keys under `keys.tasks.*` so every existing invalidation reaches them. `task-tabs.ts` re-exports `useManagedTasks` / `useAllTasks`; `fetchManagedTasks` is removed with its test cases rewritten.

- [ ] Tests first (`task-lists.test.ts`): arguments sent; the 500-row loop stops on a short page; mapping (labels joined, withheld Group → no `group`, executor → `visibleExecutor`, null executor → `null`); finished page returns `total`; infinite query's next offset and stop; summary rows. Then the code. Commit.

### Task 6: `ManagerTaskList`

- [ ] Tests first: open rows as before; heading and finished rows after them; filters, search, state, preferred and sort reach `task_list` as arguments; an open **Stare** asks for no finished page; a finished **Stare** shows no open row; **Stare** options and Rule W include the summary; count in the placeholder; **Încarcă mai multe** asks the next page; the sentinel does too (`lib/use-in-view.ts` with a stubbed `IntersectionObserver`); a failed page shows a retry and keeps what is loaded; rows are never duplicated; empty states.
- [ ] Code (`ManagerTaskList.tsx`, `manager-task-list.ts`, `lib/use-in-view.ts`). Commit.

### Task 7: `TrackerScreen` and the details sheet

- [ ] Tests first: the sheet's manager controls for a Task opened from De gestionat (no capability request), from Toate and from a `?task=` link (capability request); landing on De gestionat for a finished managed Task; landing on Toate for a readable unmanaged one; opening tab with only finished managed Tasks. Then the code. Commit.

### Task 8: Calendar

- [ ] Tests first: month asks `task_list` with the grid's range and both parts; chips for a finished managed Task; `useCalendarWork` offers the summary's dated Groups and Campaigns. Then the code. Commit.

### Task 9: leadership filters

- [ ] Tests first: `fetchLeadershipFilters` calls `leadership_filter_work` and no longer reads `tasks`. Then the code. Commit.

### Task 10: records and proof

- [ ] R54 where the rulings live; `CLAUDE.md` status; `docs/README.md` index.
- [ ] Full gates (`scripts/check-local-ci.sh` or its parts in sequence).
- [ ] Browser, local stack with the import file loaded: the six screens of spec §5, numbers recorded in the PR.
- [ ] Whole-branch review by a fresh reviewer; one fix pass.
