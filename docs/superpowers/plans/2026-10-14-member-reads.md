# Fast reads everywhere — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Every Task read is cheap; Taskurile mele, Disponibile and Anunțuri read what they show in one request and page the rest; no page looks frozen while it loads.

**Architecture:** The Task read rule becomes four caller-scoped sets computed once per statement (InitPlans), with `private.can_read_task` kept as the tested reference. The #1052 list reader gains the Member's lists. Anunțuri gets a reader of its own. The frontend mirrors #1053, and a slowed-network audit gives every page a loading shape.

**Tech stack:** Supabase Postgres 17, pgTAP, PostgREST; React 19, TanStack Query v5, vitest, Playwright for the audit.

**Spec:** `docs/superpowers/specs/2026-10-14-member-reads-design.md` (approved by Alex 2026-10-14: "you can go ahead with the 6 issues … implement based on this session and then create the pr"; no GitHub issues, so PR bodies carry no `Closes`).

## Global constraints

- Migrations dated after `main`'s newest (`20261014120000`); a `create or replace` body is rebuilt from `main`'s latest version.
- `docs/backend/conventions.md` is binding: invoker wrapper plus definer `_impl`; the four-role revoke, then `grant … to authenticated`; `set search_path = ''`; PT400/PT404/PT409 vocabulary; every new `private.*` function gets a row in `supabase/tests/tracker_grants.test.sql`'s roster, with the count pin bumped.
- Database gates run on the isolated stack (project `osubb-reads`, ports +100) through `scratchpad/reads-gate.sh`; the shared stack is never reset by this work.
- Full vitest never overlaps a database reset or pgTAP run.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Each PR: fresh-context review (Opus), CodeRabbit (`@coderabbitai review`), merge on green CI with a merge commit. Never push to `main`.
- Visible copy is Romanian and uses the CONTEXT.md vocabulary.

## Review focus

1. A Member who reads a Task **only** through their own Assignment on its Umbrella, in a Private Group they cannot see: must still read the sub-Task.
2. A Group Role above a Minimum Level the holder does not reach: must still read the Group's Tasks (R3), but not through R6-own.
3. An org-Audience Opportunity in a Private Group the caller cannot see: hidden (R6-org requires `can_see_group`).
4. A deactivated Member with stale claims: reads nothing through any branch.
5. Disponibile after a Candidature is withdrawn: the Task leaves the list unless it is still an open Opportunity the caller may join.

---

## PR A — the Task read rule, decided once per request

**Files:**

- Create `supabase/migrations/20261014180000_task_read_sets.sql`.
- Create `supabase/tests/task_read_sets.test.sql`.
- Modify `supabase/tests/tracker_grants.test.sql`, and `docs/backend/conventions.md` §4 (one paragraph on per-statement sets in policies).

**Interfaces (produces):**

- `private.own_task_ids() returns bigint[]`
- `private.task_read_groups(p_kind text) returns bigint[]`, with `p_kind` in `'whole' | 'open' | 'org'`

Both are `stable security definer`, with `set search_path = ''`, and `grant execute … to authenticated` (policies run as the caller).

- [ ] **A1 — failing suite.** `task_read_sets.test.sql`. Fixture (names `#TR …`):
  - Groups: an Organization-level public Group; a Private Group P with a child Group; a Group G3 with Minimum Level 3 and a Manager whose level is 2; a Group S with `shared_work_visibility` and a roster Member; an automatic-membership Group with shared visibility.
  - Tasks in each Group: a closed Task; an open local public Opportunity; an open org-Audience Opportunity; a queue-closed Opportunity; a finished Opportunity; an Umbrella in P with a sub-Task.
  - Members: a Volunteer (level 2) with an Assignment on the P Umbrella; a Volunteer with a Candidature in G3; a BCE (5); a BC (6); the G3 Manager; a roster Member of S; a non-member level-3 Member; a deactivated Member with claims; a claimless caller.

  Assertions:
  - **parity:** for each Member, the ids `select id from public.tasks` returns as them equal the ids for which `private.can_read_task(id)` is true, computed as postgres with their claims. The same holds for `task_assignments`, `task_candidates`, `task_evaluations` and `task_activity` against the old policy expressions, evaluated in a definer helper inside the test;
  - `private.own_task_ids()` and each `task_read_groups` kind, per Member, named exactly;
  - claimless and deactivated callers get empty sets;
  - **timing:** 3 000 Tasks across the fixture Groups, read whole as the Volunteer, take under 300 ms.

  Run `bash reads-gate.sh <wt> test supabase/tests/task_read_sets.test.sql`. Expected: FAIL (the functions do not exist; the timing assertion fails).

- [ ] **A2 — migration.**
  - `own_task_ids`: `array_agg(distinct task_id)` over the caller's `task_assignments` ∪ `task_candidates`, only when `private.actor_level()` is not null (a live `activ` caller).
  - `task_read_groups`: one pass over `public.groups`, with the same expressions `private.can_read_task` uses, the Task's columns replaced by the Group's:
    - `whole` = `can_see_group(g) and (level >= 5 or ((level >= g.min_level or role_on_path(g)) and (role_on_path(g) or shared_on_path(g))))`
    - `open` = `can_see_group(g) and (level >= g.min_level or role_on_path(g)) and is_group_member(g)`
    - `org` = `can_see_group(g)`
    - every kind is empty unless `auth_is_member()` and `actor_level()` is not null.
  - Policies, dropped and recreated:
    - `tasks_read`: as in the spec;
    - `task_assignments_read`, `task_candidates_read`, `task_evaluations_read`, `task_activity_read`: replace `private.can_read_task(task_id)` with `exists (select 1 from public.tasks as task where task.id = <table>.task_id)`, keeping the rest verbatim from `main`'s latest definition.
  - Function comments name #-less "spec 2026-10-14 member reads, part 1".
  - Expected: suite PASS.
- [ ] **A3 — roster, docs, gates.**
  - Roster rows and the count pin; the conventions paragraph.
  - `reads-gate.sh <wt> all`: every suite, the harnesses, lint, advisors and types current. Types should not change, because the functions are private.
  - Mutation record in the suite header: break each branch of `task_read_groups` and `own_task_ids` once; name the assertion that fails.
- [ ] **A4 — PR.** Push; open the PR (spec and plan included); fresh review; CodeRabbit; merge on green.

## PR B — the Member's lists in the list reader

**Files:**

- Create `supabase/migrations/20261014190000_member_task_lists.sql`.
- Modify `supabase/tests/task_list.test.sql` (new block), the upgrade harnesses (drop the new signature), `tracker_grants.test.sql` and `app/src/lib/database.types.ts` (regenerated).

**Interfaces:**

- `private.task_list_scope(p_list)`, `public.task_list(...)` and `public.task_list_summary(p_list)` accept `'mine'` and `'available'`.
- `task_list` returns a new column `my_candidature text` (the caller's Candidature status on the Task, or null), before `total`.
- `p_finished => true` with `'available'` is PT400 `invalid_list`.

- [ ] **B1 — failing cases** in `task_list.test.sql`:
  - `mine` equals the `fetchMyTasks` rule: newest own Assignment not ended in `gave_up`/`replaced`/`task_updated`/`group_changed`; a reopened Task with two Assignments listed once;
  - `available` equals open public queue-open readable Tasks ∪ pending-Candidature Tasks;
  - `my_candidature` is set;
  - for a Volunteer, embeds hold only their own Assignment and Evaluation; for a BCE or a Manager of the Group, every one, matching the four policies;
  - order: `mine` open by deadline, title, id; finished newest first. `available` by deadline, title, id;
  - `task_list_summary('mine')`;
  - PT400 for `available` with `p_finished`.

  Expected: FAIL.

- [ ] **B2 — migration:** rebuild `task_list_scope`, `require_task_list_args`, `task_list_impl`, `task_list`, `task_list_summary_impl` and `task_list_summary` from #1052's text, plus the lists, the column and the embed filter (own, `level >= 5`, or Task in `task_list_scope('managed')`, computed once in a CTE). Expected: PASS.
- [ ] **B3 — gates.** Regenerate types; `reads-gate.sh all`; harness drops updated.
- [ ] **B4 — PR**, as A4.

## PR E — what the review of #1053 left (frontend, independent)

**Files:** `app/src/queries/task-lists.ts`, `app/src/screens/tracker/ManagerTaskList.tsx`, `TrackerScreen.tsx`, `app/src/lib/live-changes*` (only the invalidation of `tasks.finished`), and their tests.

- [ ] Failing tests first:
  - a failed `task_list_summary` read shows **Stare**'s and the Work Filter's retry notice;
  - a label read retried while rows are shown keeps the rows (`isPending` stays false);
  - a live change on Tasks resets the finished infinite query to one page (`resetQueries`) rather than refetching every page, asserted by the number of `task_list` calls;
  - the finished read is asked in the same tick as the open read (no `enabled` gate on the open data).
- [ ] Implement; targeted vitest, tsc, oxlint, prettier; PR.

## PR C — Taskurile mele and Disponibile through the reader (after B)

**Files:** `app/src/queries/task-lists.ts` (lists `mine` and `available`), `queries/tasks.ts` (`useMyTasks` → open `mine`), `queries/task-opportunities.ts` (one `task_list('available')` read beside `fetchMyGroups`), `screens/tracker/MyTaskList.tsx` (open plus **Taskuri încheiate**, sharing the finished-part pieces with `ManagerTaskList`), `CalendarMonth.tsx` (`useMyTasksInRange`), `work-filter-options.ts` (`summary('mine')`), the dashboard consumers checked one by one, ADR-0007 (R55), and tests.

- [ ] Failing tests per consumer: what each reads and renders; the finished part's paging and its end-of-list watch; Disponibile's two parallel reads and its `relevant` / `joinable` flags from `my_candidature`.
- [ ] Implement; gates; browser check as the demo Volunteer on the synthetic data, with timings before and after; PR.

## PR D — Anunțuri by pages

**Files:**

- Backend: `supabase/migrations/20261014200000_announcement_feed.sql` (`public.announcement_feed`, `public.announcement_feed_summary`, with `_impl`s), `supabase/tests/announcement_feed.test.sql`, grants roster, types.
- Frontend: `app/src/queries/announcements.ts` (infinite query, summary, one-by-id read), `screens/announcements/AnnouncementsScreen.tsx`, ADR or CONTEXT note for R56, and tests.

- [ ] Server cases:
  - R43 (preferred, critical, org, own); the Group subtree filter; the R15 order with id last; the page and total;
  - the summary's unread count, and the newest unread critical Announcement;
  - parity with `announcements_read` (nothing is returned that RLS would hide).
- [ ] Page cases: first 20, more on scroll and by button; marking read updates the row in place without reordering; `?anunt=` reads by id; the badge and the banner come from the summary.
- [ ] Gates; PR.

## PR F — loading states on every page (last)

- [ ] Audit: every route as each demo role, with Playwright holding API requests 1.5 s. Record per route what shows at 0.3 s and 1.5 s. Write the table into the PR.
- [ ] `Loading` gains `variant` (`rows` default, `cards`, `table`, `grid`, `stats`); a `Refreshing` wrapper (dimmed rows plus a thin bar); skeleton rows for the load-more end.
- [ ] Per page found wanting: a failing test of the loading shape first, then the fix.
- [ ] Re-run the audit; PR with the before/after table.

## Finish

Repeat the measurement on the synthetic data (same script), record before/after in the last PR, reset the shared database, and remove the isolated stack (`npx supabase stop --workdir … --no-backup`).
