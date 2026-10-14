# Task lists that stay fast — design

**Date:** 2026-10-14 · **Issues:** #1052 (the readers), #1053 (the page) · **Status:** approach delegated by Alex ("i trust you to find the best approach", 2026-10-14); the visible changes of §2 were announced to him in the session.

## 1. Problem

The Legacy Import (#1049) adds about 5 300 finished Tasks. Measured on the local stack with the import file loaded, as a Moderator:

| Read                                                   | Today                                        | Why                                                                                                          |
| ------------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **De gestionat** (`fetchManagedTasks`)                 | 48.6 s, about 90 requests, 170 000 DOM nodes | `my_managed_task_ids()` costs 4.4–5.3 s and is asked once per 500-row page (11 times); then 53 pages of rows |
| **Toate** (`useAllTasks`)                              | same shape, about 38 requests                | every row and every embedded history row runs `private.can_read_task`                                        |
| Filter options on **Clasament** and **Tracker membru** | about 11 s per page, 11 pages                | every evaluated Task is read through three RLS policies to learn which Groups and Campaigns have work        |
| `visible_task_executors`, 200 Tasks                    | 1.3 s                                        | `private.can_read_task` per Task                                                                             |
| The same rows in one set-based query                   | 0.27 s for all, 5 ms for a page of 50        | —                                                                                                            |
| A Member's own list (the busiest Member, 242 Tasks)    | 0.3 s                                        | not a problem; untouched                                                                                     |

The cause is not the amount of data. The server answers "may this Member manage / read this Task?" **one Task at a time**: `private.can_manage_task` and `private.can_read_task` are `security definer` SQL functions that the planner cannot inline, each costing 0.4–0.9 ms (a `plpgsql` twin measured no faster — the time is in the nested helper calls, not in planning). Lists then multiply that by pages, by embedded tables and by a full re-read after every write (`live-changes.ts` invalidates `keys.tasks.all`).

Two things follow, and the design answers both:

1. **A list must decide authority per Group** (about 70 rows), not per Task.
2. **Finished work is an archive that grows for ever** (about 7 500 Tasks a year at the sheet's pace); it must be read by the page, never whole. Open work is bounded by what the organization is doing now and can stay whole.

## 2. What changes for a Member

Only leadership's lists change; a Member's own lists are untouched.

- **De gestionat** and **Toate** open on the open Tasks (De făcut, În lucru, În verificare), in today's order (overdue first, then deadline or title).
- **Finished Tasks follow them**, under the heading **Taskuri încheiate**, newest deadline first (or by title when **Ordonează după** is Titlu), 50 at a time: the next 50 load when the end of the list comes into view, and a **Încarcă mai multe** button does the same for a keyboard or a screen reader. Today they are mixed in by deadline ascending, which after the import would put 5 300 old Tasks above every Task that is not overdue.
- The title search, the Work Filter, **Stare** and Grupuri preferate narrow both parts; for the finished part the server applies them. The search placeholder keeps counting every Task the list shows.
- Everything else reads the same: **Stare** still offers only the states the list holds, the Work Filter still offers only the Groups and Campaigns with work (Rule W), a `?task=` link still lands where it did, the Calendar's **Taskurile gestionate** still shows every managed deadline of the month, Acasă's **De evaluat** still counts the same Tasks.

Recorded as **ruling R54** (the list order of ruling R10, amended): open work first, finished work after it and newest first.

## 3. Server

One migration. No table, policy, index or existing function changes; `public.my_managed_task_ids()` stays (installed clients still call it) and is the oracle of the new suite.

### 3.1 `private.task_list_scope(p_list text) returns table(task_id bigint)`

The one place a list's authority is decided. `security definer`, `stable`, `set search_path = ''`.

- No rows without org claims (`public.auth_is_member()`) or a live `activ` Profile (`private.actor_level()`).
- Each Group is judged **once**, with the existing helpers:
  - `'managed'`: `listed = private.can_manage_group_work(group)`; `whole = level >= 6 or private.group_role_of(group, caller) = 'manager' or not private.has_group_manager(group)`.
  - `'all'`: `listed = level >= 5 and private.can_see_group(group, caller)`; nothing below level 5 (the list is `public.can_read_all_tasks()`'s).
- A Task is in `'managed'` when its Group is `listed` and — the Group is `whole`, **or** the Task has no open Assignment, **or** `private.can_manage_task(task)`. The first two are what `can_manage_task` itself answers in those cases; the per-Task rule remains the fallback and the only authority for a Responsible looking at a Task somebody executes.
- A Task is in `'all'` when its Group is `listed`, **or** `private.can_read_task(task)` (a Private Group's Task the caller reads through their own Assignment, Candidature or its Umbrella).
- Any other `p_list`: no rows (the public readers refuse it first).

Managing a Task implies reading it (level 6 and above read every Group; a Manager or Responsible on the path reads by rule R3 and sees a Private Group by position), so `'managed'` equals `my_managed_task_ids()`. The suite proves that equality for every fixture caller instead of trusting the argument.

### 3.2 `public.task_list(...)`

```
public.task_list(
  p_list        text,                       -- 'managed' | 'all'
  p_finished    boolean     default null,   -- true: finished only; false: open only; null: both
  p_group_id    bigint      default null,   -- that Group and every Group below it
  p_campaign_id bigint      default null,
  p_from        timestamptz default null,   -- deadline in [p_from, p_to)
  p_to          timestamptz default null,
  p_state       text        default null,   -- 'completed' | 'unfulfilled' | 'cancelled' | 'late'
  p_search      text        default null,   -- title contains, folded for case and diacritics
  p_preferred   boolean     default false,  -- R43: leave out the caller's unselected Groups
  p_sort        text        default 'deadline',  -- 'deadline' | 'title'
  p_limit       integer     default 500,    -- 1..500
  p_offset      integer     default 0)
returns table(
  id, group_id, title, description, status, deadline, completed_at, review_round,
  assignment_mode, audience, kind, parent_task_id, campaign_id, duplicated_from_task_id,
  queue_closed_at, links,
  assignments jsonb,   -- [{id, member_id, ended_at}], every Assignment, by id
  evaluations jsonb,   -- [{id, difficulty, rating, points, reversed_at}], every Evaluation, by id
  submission  jsonb,   -- [the latest 'submitted' history row {id, kind, note, details, occurred_at}] or []
  executor    jsonb,   -- {member_id, full_name, nickname, is_current} or null
  total       bigint)  -- rows the filters match, before limit and offset
```

A `security invoker` wrapper over `private.task_list_impl` (definer), the shape of `leadership_leaderboard`. One request carries everything a row draws.

- **No Group or Campaign label travels in a row.** The page reads `groups` and `campaigns` through their own RLS once and joins by id: a label is repeated in no row, a Group the caller may not read keeps saying "Origine indisponibilă", and no function projects `groups.category` (the `conventions.test.sql` sweep).
- **The history embeds are whole**, as the read policies of `task_assignments`, `task_evaluations` and `task_activity` give them to a Task Manager and to level 5 and above — the only callers either list has.
- **The Executor** is the rule of `private.visible_task_executors` (#499, #861): the open Assignment of an open Task (`is_current`), or the latest Assignment a completed or unfulfilled Task's Evaluation ended; none for a cancelled Task. Restated set-based here, and pinned to that function by the suite.
- **Filters.** `p_finished` reads the status (`completed`, `unfulfilled`, `cancelled` are finished). The Group is the subtree (`groups.path @> array[p_group_id]`); the range reads the deadline, half-open, so an undated Task is outside any range; `late` is a completed Task whose `completed_at` is after its deadline; the search is `private.fold_search(title)` containing `private.fold_search(p_search)` (NFD, combining marks removed, lower case — "sedinta" finds "Ședință", as `searchableTitle` does in the page); `p_preferred` leaves out the Groups `private.group_muted_for` still honours for the caller.
- **Order.** Open Tasks first, then finished ones. Open: deadline ascending, undated last, then id. Finished: deadline descending, undated last, then id descending. With `p_sort = 'title'` the title (`ro-x-icu`) leads inside each part. The page sorts the open part itself (overdue first needs the clock); the order matters for the finished part and for stable pages.
- **Refusals**, all `PT400`, before any read: `invalid_list`, `invalid_state`, `invalid_sort`, `invalid_page` (`p_limit` outside 1..500 or `p_offset` below 0), `invalid_date_range` (`private.require_date_range`). A caller with no claims or no live Profile gets no rows, never an error.

### 3.3 `public.task_list_summary(p_list text)`

`returns table(group_id bigint, campaign_id bigint, status public.task_status, late boolean, dated boolean, tasks bigint)` — the list's Tasks counted by Group, Campaign, status, whether completed late and whether they carry a deadline. A few hundred rows at most. It answers, without reading a Task: Rule W's Groups and Campaigns, the states **Stare** offers, how many finished Tasks there are, and the Calendar's filter choices. Same wrapper shape, same `invalid_list`.

### 3.4 `public.leadership_filter_work()`

`returns table(group_id bigint, campaign_id bigint)` — the distinct Group and Campaign of every Task of kind `task` in `'all'` that has an Evaluation through one of its Assignments: what `fetchLeadershipFilters` reads today from 5 300 rows. Nothing below level 5.

### 3.5 `public.can_manage_task(p_task_id bigint) returns boolean`

The twin of `public.can_evaluate_task` (#189): `security invoker`, the Task through its own RLS and `private.can_manage_task`. The details sheet and the `?task=` link ask it for one Task, where today they look the id up in the whole managed list.

### 3.6 Grants

Every new function: `revoke execute … from public, anon, authenticated, service_role`; the four public ones `grant execute … to authenticated`.

## 4. Page

- **`queries/task-lists.ts`** (new): `fetchTaskList` (maps a row to `TaskPresentationRow`, attaching the Group and Campaign labels from the shared reads and `visibleExecutor` from `executor`), `useManagedTasks` / `useAllTasks` (the **open** Tasks, whole, one request per 500), `useFinishedTasks(list, filters)` (`useInfiniteQuery`, 50 per page), `useTaskListSummary(list)`, `useManagedTasksInRange(range)` (the Calendar's month). `task-tabs.ts` keeps the two capabilities and re-exports the list hooks, so Acasă's **De evaluat** (`useAwaitingMyReview`) and every other reader of the managed list keep their import and now read open Tasks only — which is all they ever used.
- **`ManagerTaskList`**: takes the list's name; filters and sorts the open rows as today; asks `useFinishedTasks` with the same filters (skipped while **Stare** names an open state; the open part is empty while it names a finished one); draws the heading, the pages, the sentinel (`lib/use-in-view.ts`, an `IntersectionObserver`), the **Încarcă mai multe** button, the loading line and a retry for a failed page. **Stare** and Rule W read the open rows plus the summary.
- **`TrackerScreen`**: `managedTaskIds` goes. The sheet's `canManage` is `true` for a Task opened from De gestionat and `useTaskManageCapability(id)` otherwise; the `?task=` landing asks the same capability and the details read instead of searching two whole lists; the opening tab counts De gestionat as non-empty when it has an open Task or the summary has a row.
- **Calendar**: `CalendarMonth` reads the managed Tasks of the visible grid (`useManagedTasksInRange`), `useCalendarWork` takes the managed Groups and Campaigns from the summary's dated rows.
- **Clasament, Tracker membru**: `fetchLeadershipFilters` takes `work` from `leadership_filter_work()`.

`my_managed_task_ids` and the 100-ids-per-request row loop leave the page. `attachVisibleTaskExecutors` stays for Taskurile mele, Disponibile and the details sheet.

## 5. Tests

- **pgTAP `task_list.test.sql`**: shape and grants; for every caller of the #521 Group matrix plus Private-Group, archived-Group, inactive and claimless callers, `task_list('managed')` equals `my_managed_task_ids()` and `task_list('all')` equals the Tasks RLS returns (level 5 and above) or nothing; the embeds equal what RLS returns to that caller; the Executor equals `visible_task_executors`; each filter, both orders, pages and `total`; every refusal; the summary's counts; `leadership_filter_work`; `can_manage_task`. A guard with 3 000 generated finished Tasks: a page, the summary and the scope each answer inside a bound a per-Task rule cannot meet. Mutations recorded in the header: drop the `whole` shortcut's fallback, swap `listed` for `true`, drop each filter, restore a per-row scope.
- **vitest**: `task-lists` (mapping, paging, arguments); `ManagerTaskList` (the two parts, heading, filters → arguments, **Stare** from the summary, load more by button and by sentinel, failed page); `TrackerScreen` (capability instead of the id set, landing, opening tab); Calendar month and its filter; leadership filters; `fold` parity cases shared with the suite.
- **Browser**, local stack with the import file: De gestionat, Toate (a BCE), Acasă, Calendar, Clasament, Tracker membru — time to list, requests, DOM nodes, before and after.

## 6. Delivery

Two issues, two PRs: the readers (migration, suite, generated types, `conventions.md`), then the page on top of them. The Legacy Import's production run waits for both: the import's 37 000 live-change signals would otherwise restart every open leader's 48-second load for as long as it runs.

## 7. Out of scope, noted

- Unpaged reads that PostgREST cuts at 500 rows without saying so (`fetchMyTasks`, a Member's Candidatures, open Opportunities, a Member's Requests, Events from today, unread Notification subjects, the Campaign report, the Anunțuri feed, Deals): a correctness risk that does not depend on the import — its own issue.
- Dropping `public.my_managed_task_ids()` once no installed client calls it.
- Rewriting `tasks_read` and the history policies set-based: it would speed up every read, and it is the most sensitive rule in the system; nothing measured needs it once lists stop reading archives whole.
