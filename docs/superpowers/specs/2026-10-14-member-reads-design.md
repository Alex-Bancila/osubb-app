# Fast reads everywhere: the Task read rule, the Member's lists, Anunțuri and loading states

Date: 2026-10-14 · Status: proposed · Follows: [the fast Task lists](2026-10-14-fast-task-lists-design.md) (#1052, #1053) and #1058

## Why

Alex, 2026-10-14: _"do every improvement you said … i want everything"_, and _"when a page takes longer to load add a skeleton loading to don't appear as the app just froze"_. The improvements named were:

1. the Task read rule costs about 0.5 ms per Task on every read of Tasks;
2. Taskurile mele and Disponibile still read through that rule in several requests one after another;
3. lists that grow for ever are read whole although people look at their top;
4. the four small findings left from the review of #1053.

### Measured (local stack, 2026-10-14)

Production-shaped data: the Legacy Import command run with a synthetic file (5 300 finished Tasks over 13 Groups, 300 of them on the demo Volunteer), plus 120 open public Tasks created through `create_task` and 25 pending Candidatures of the Volunteer through `express_task_interest`. 5 445 Tasks in all. Signed in as the demo Volunteer.

| What                                                                         | Time              | Notes                                                                                            |
| ---------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| Every Task the Volunteer may read (`select count(*) from tasks` through RLS) | **2.77 s** server | 5 445 rows × the per-Task rule; 381 readable                                                     |
| Taskurile mele, data                                                         | 240–490 ms        | 4–6 requests, 3 of them one after another; the slowest (Assignments with their Tasks) 200–250 ms |
| Taskurile mele, until every card is drawn                                    | **0.77 s**        | 306 cards, 10 617 DOM nodes                                                                      |
| Disponibile, data                                                            | 160–220 ms        | 5 requests, 4 steps one after another                                                            |
| Disponibile, until every card is drawn                                       | 0.4 s             | 74 cards, 2 239 DOM nodes                                                                        |

Locally there is no network. In production every request that waits for the one before it adds a round trip (about 40–100 ms from Cluj, more on a phone), and the busiest Member gains about 300 Tasks a year.

## What changes

Six parts, each its own issue and PR, in this order.

### 1. The Task read rule, decided once per request (backend)

`tasks_read` calls `private.can_read_task(id)` for every row it looks at. That function is security-definer SQL, so Postgres cannot inline it: each call runs a seven-table join. Every rule in it but one depends only on the caller and the Task's Group:

- **R2** — the caller's own Assignment or Candidature, ever, on the Task or on its Umbrella;
- **R1, R3, R4, R6-own, R6-org** — what the caller may see of a Group (`private.can_see_group`), their level against its Minimum Level, a Group Role on its path, Shared Work Visibility on its path, membership;
- the one per-Task part: _is the Task an open public Opportunity_ (kind `task`, mode `public`, queue open, not finished), and its Audience.

**R7 reduces to R2.** A sub-Task's Group is its Umbrella's: `private.validate_task_hierarchy` refuses a sub-Task created elsewhere (`subtask_origin_mismatch`), and neither a sub-Task nor an Umbrella that has sub-Tasks can change Group (`subtask_origin_immutable`, `umbrella_has_subtasks`). The Group rules therefore judge the Umbrella exactly as they judge the sub-Task, and an Umbrella is never an Opportunity. What is left of "judged on the Task and its Umbrella" is the caller's own Assignment or Candidature on the Umbrella.

The new rule computes four small sets once per statement, each through `(select …)` so Postgres runs it as an InitPlan:

| Function (security definer, stable) | Returns                                                                   | From the rule |
| ----------------------------------- | ------------------------------------------------------------------------- | ------------- |
| `private.own_task_ids()`            | ids of the Tasks the caller holds or held an Assignment or Candidature on | R2            |
| `private.task_read_groups('whole')` | Groups whose every Task the caller reads                                  | R1, R3, R4    |
| `private.task_read_groups('open')`  | Groups whose open public Opportunities the caller reads, any Audience     | R6-own        |
| `private.task_read_groups('org')`   | Groups whose open public org-Audience Opportunities the caller reads      | R6-org        |

```sql
tasks_read using (
  (select public.auth_is_member())
  and (   id = any ((select private.own_task_ids())::bigint[])
       or parent_task_id = any ((select private.own_task_ids())::bigint[])
       or group_id = any ((select private.task_read_groups('whole'))::bigint[])
       or (    kind = 'task' and assignment_mode = 'public' and queue_closed_at is null
           and status not in ('completed', 'unfulfilled', 'cancelled')
           and (   group_id = any ((select private.task_read_groups('open'))::bigint[])
                or (audience = 'org' and group_id = any ((select private.task_read_groups('org'))::bigint[]))))))
```

The Group sets are built per Group from the same helpers and the same expressions `private.can_read_task` uses today, and are empty for a caller who is not a live `activ` Member, as today.

The Assignment, Candidature, Evaluation and Task history read policies replace their `private.can_read_task(task_id)` with `exists (select 1 from public.tasks as task where task.id = <row>.task_id)`, which `tasks_read` now answers cheaply. Their second half (own row, `private.is_global_task_reader()`, `private.can_manage_task(task_id)`) stays.

**`private.can_read_task` stays.** Commands ask it about one Task, and it is the reference the new rule is tested against.

**Tests.** A parity suite logs in as every Member of a fixture that covers each branch of the rule, and asserts that the Tasks `tasks_read` returns are exactly those for which `private.can_read_task` is true. The same holds for the four child tables against their old expressions. The fixture includes:

- a Private Group, and a Member reading it only through their own Assignment;
- an Umbrella with an own Assignment, and its sub-Tasks;
- Shared Work Visibility through a roster row and through Automatic Membership;
- a Group Role above a Minimum Level the holder does not reach;
- open, queue-closed and finished Opportunities of each Audience;
- a deactivated Member, and a caller without claims.

The mutation record names the assertion each removed branch breaks. A timing guard reads every Task as a Volunteer: 2.77 s today, required under 300 ms.

### 2. The Member's lists through the list reader (backend)

`public.task_list`, `public.task_list_summary` and `private.task_list_scope` (#1052) take two more lists:

- **`mine`**: the Tasks whose newest Assignment of the caller did not end in `gave_up`, `replaced`, `task_updated` or `group_changed`. This is exactly what `fetchMyTasks` keeps today.
- **`available`**: the open public Tasks of kind `task` the caller reads with their queue open, plus every Task the caller is a pending Candidate on whatever its queue. This is exactly what `fetchTaskOpportunities` reads today. It has no finished part.

A new column, `my_candidature`, carries the caller's Candidature status (or null), so Disponibile needs no second read.

For the leadership lists each row embeds every Assignment and Evaluation, which their callers may read. **For `mine` and `available`, the embeds follow the read policies:**

- the caller's own rows;
- every row when the caller is a global Task reader (level 5 and up);
- every row of a Task in the caller's managed set (`private.task_list_scope('managed')`, computed once).

The parity suite compares these embeds with what the four policies return to the same caller.

**Order.**

- `mine`: open Tasks by deadline (soonest first, undated last), then title (`ro-x-icu`), then id; finished Tasks newest first.
- `available`: open Tasks only, by deadline, then title, then id. This is today's Disponibile order.

### 3. Taskurile mele and Disponibile pages (frontend)

This mirrors #1053:

- **Taskurile mele** reads its open Tasks whole and its finished ones under **Taskuri încheiate**, 50 at a time:
  - the next page comes when the end of the list comes into view, or from **Încarcă mai multe**;
  - the title search and the Work Filter narrow both parts; the server applies them to the finished part. Taskurile mele keeps no **Stare** and no **Ordonează**, as today (ruling in the build: the paging adds no filter);
  - Rule W reads the open rows and `task_list_summary('mine')`.
- `useMyTasks` keeps its name and means the open Tasks, which is all Acasă's tiles and **Urmează** use (checked per consumer in the plan).
- The Calendar month reads the Member's Tasks of the month it shows (`mine` with `p_from` / `p_to`), as De gestionat's Calendar does.
- **Disponibile** reads `task_list('available')`, and the Member's Groups beside it rather than after it. That is 2 requests side by side where today there are 5 in 4 steps. The `relevant` and `joinable` flags stay on the page.

### 4. Anunțuri by pages (backend and frontend)

`public.announcement_feed(p_group_id, p_preferred, p_limit, p_offset)` returns the feed:

- what the page reads today, with the reader's own `read_at`;
- narrowed by Grupuri preferate (R43: a preferred Group, or critical, or organization-wide, or the caller's own) and by the Group filter (the chosen Group and every Group below it);
- ordered by R15 (pinned, then unread, then read; newest first in each; id last);
  - _Amended 2026-10-23 (ruling R62, #1097):_ the Announcements past their Termen at `p_as_of` come after every other, under **Termen expirat**, each list in R15's order; each row carries `expired`;
- 20 rows a page, with the unpaged count.

`public.announcement_feed_summary(p_preferred)` returns the unread count the header shows and the newest unread critical Announcement the banner points at.

The page:

- reads the first 20 and the rest on scroll or from **Încarcă mai multe**;
- reads the Announcement a `?anunt=` link names by its id;
- reads authors per page.

Marking an Announcement read updates the loaded rows in place and never reorders them: the order is read again only when the feed is read again from the top. This keeps a row from moving between pages while they load.

### 5. What the review of #1053 left (frontend)

- A failed summary read is no longer silent: **Stare** and the Work Filter show a retry.
- A retried label read keeps the rows on screen instead of flipping the list back to loading.
- A live change re-reads the first page of the finished part and drops the others, instead of re-reading every page loaded.
- The finished read starts beside the open read, not after it.

### 6. Loading states everywhere (frontend)

The app already has the skeleton (`Loading`: three pulsing rows, 49 uses) and lazy routes show it while their code loads. What remains is page by page. Every route is opened as each of the demo roles with every API request held back 1.5 s (Playwright route interception), and the first two seconds are recorded. The rules:

1. **No page is blank or a bare heading while its main data loads.** It shows a skeleton shaped like what is coming: list rows, cards, a table, the month grid, the header figures. `Loading` gains those shapes (`variant`), keeping its `role="status"` and spoken label.
2. **A list re-read after a filter change says so:** the rows stay, dimmed, under a thin progress bar. They are not swapped for an empty state.
3. **A page being loaded at the end of a list shows skeleton rows** where the rows will appear, not only a line of text.
4. **Nothing waits silently longer than 300 ms.**

The PR lists every route with what it showed before and after.

### Not changed: the Calendar

On inspection the Calendar already reads only what it shows:

- the month view reads its month;
- the Agendă reads the range the Work Filter sets;
- without a range, the Agendă reads **Ce urmează**, from today on, which is bounded by the Events still to come.

Nothing there grows without bound, so "past Calendar Events" in the list of improvements was wrong.

## Rulings proposed (Alex may veto)

- **R55 (amends R10 for the Member's own list):** Taskurile mele shows its open Tasks first and its finished Tasks after them under **Taskuri încheiate**, newest first, 50 at a time. This is De gestionat's R54, applied to the Member's own list. Today finished Tasks are mixed in by deadline.
- **R56:** Anunțuri shows its newest 20 and loads more on scroll. The R15 order is unchanged.
  - _Amended 2026-10-23 (ruling R62):_ the expired Announcements now follow every other, under **Termen expirat**; R15's order holds inside each list.

## Delivery

| #   | Issue                                                             | Blocked by                             |
| --- | ----------------------------------------------------------------- | -------------------------------------- |
| A   | The Task read rule is decided once per request                    | —                                      |
| B   | `task_list` reads the Member's lists (`mine`, `available`)        | A                                      |
| C   | Taskurile mele and Disponibile read through the list reader (R55) | B                                      |
| D   | Anunțuri reads by pages (R56)                                     | —                                      |
| E   | The four findings left from #1053                                 | —                                      |
| F   | Every page shows its loading state                                | C, D, E (it audits their screens last) |

Each PR follows the house gates: pgTAP and harnesses for the backend, vitest, tsc, oxlint and prettier for the frontend, a fresh-context review, CodeRabbit, and a merge on green. Database suites and the full vitest never run at the same time on this machine. When the work is done, the measurement above is repeated with the same synthetic data, before and after side by side.

## Risks

- **The read rule is security.** A wrong Group set shows or hides Tasks for real Members. The parity suite is the guard: it must cover every branch, and a mutation run proves it would catch a broken one. The old function stays as the reference.
- **A Group set grows with the number of Groups** (tens, not thousands), and `own_task_ids` with the caller's own Tasks (hundreds). `= any(array)` on a few hundred elements per row is cheap; the timing guard holds it to that.
- **Paged Anunțuri moves four client rules to the server** (R43, the Group filter, the unread count, the banner). Each one gets the server and page parity cases the search key got in #1052.
- **The local stack is shared** with other sessions on this machine. The synthetic measurement data is loaded by a scratch script that never enters the repository, and the database is reset when the work is done.
