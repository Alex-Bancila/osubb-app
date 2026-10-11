# BC-wide Atribuții, Task copies, scrollable bars, full-height date picker — design

**Date:** 2026-10-11. **Decided with:** Alex, after a BC discussion. **Status:** approved in conversation; this file is the written spec the implementation plan follows.

Four independent changes that ship together on one branch and one PR (Alex opens it). Each part has its own section with the rule, the backend, the frontend, the tests and the docs it touches. Nothing here creates GitHub issues; the three placeholder issues #1030, #1031, #1032 stay as they are.

---

## Part A — Every BC member holds every Atribuție

### Decision

BC decided that an Atribuție is no longer given to one BC member. **Every BC member and the Moderator hold every Atribuție's powers by default.** There is no holder, nothing to tick, nothing to withdraw, and therefore no Administrare BC page. The BC decision supersedes ruling R44's holder model; a new ruling row (R47) records it, see _Docs_ below.

OSUBB Deals stays its own page under Administrare. Its team is two places, a **Coordonator** (a live BCE member) and a **Responsabil** (any live active Member). Any BC member or the Moderator sets both places. The Coordonator keeps today's powers: everything except choosing the Coordonator, so they still pick the Responsabil. The Responsabil publishes Deals and manages their own. Nothing dissolves the team any more; a place changes only when someone sets or clears it.

Future Atribuții (Pagina Interne, Anunțuri Educaționale, Anunțuri de Tineret) follow the same shape: BC-wide powers, optionally a team, never a holder.

### Authority matrix (after)

| Actor (live rows, never the token)       | Publish a Deal | Edit / delete any Deal | Edit / delete own Deal | Set Coordonator | Set Responsabil | Sees Administrare › OSUBB Deals |
| ---------------------------------------- | -------------- | ---------------------- | ---------------------- | --------------- | --------------- | ------------------------------- |
| Moderator (level 9)                      | yes            | yes                    | yes                    | yes             | yes             | yes                             |
| BC member (level 6)                      | yes            | yes                    | yes                    | yes             | yes             | yes                             |
| Coordonator (live level 5, in the place) | yes            | yes                    | yes                    | no              | yes             | yes                             |
| Responsabil (live active, in the place)  | yes            | no                     | yes                    | no              | no              | yes, and only that page         |
| Anyone else                              | no             | no                     | no                     | no              | no              | no                              |

Today's matrix differs in one row only: a BC member who was not the holder could neither publish nor set the team. Everything else is unchanged.

### Backend

One migration, dated after `20261008090000_moderator_deals_team.sql` (the newest on `main`; re-check with `ls supabase/migrations | tail -1` before creating it). Every `create or replace` body is rebuilt from `main`'s latest version of that function.

1. **Drop the holder surface.** `public.set_bc_assignment`, `private.set_bc_assignment_impl`, `public.bc_assignments_directory`, `private.bc_assignments_directory_impl`, then the table `public.bc_assignments` (its policy, indexes and `broadcast_change` trigger go with it). Order matters: the team table's foreign key is dropped first.
2. **`public.assignment_team`** keeps its rows (the current Coordonator and Responsabil survive the migration). Drop the foreign key to `bc_assignments`; add `assignment_team_assignment_ck check (assignment in ('osubb_deals'))`. Adding a future Atribuție is: a new value in that check and a label in `private.assignment_label`. `docs/backend/deals.md` says so.
3. **`private.assignment_team_role(p_assignment, p_member)`** returns, in order: `'holder'` when `private.actor_level(p_member) >= 6` (a live BC member or the Moderator), `'coordinator'` for the live level-5 member in that place, `'responsible'` for the live active member in that place, else null. The word `holder` stays as the internal name so the seven callers (`can_publish_announcement`, `can_read_announcement`, `can_manage_deal`, `announcement_readers_impl`, `deal_code_reveal_count_impl`, `my_capabilities_impl`, `set_assignment_team_member_impl`) need no body change; its comment says "holder now means BC or the Moderator".
4. **`private.set_assignment_team_member_impl`.** Authority: role `holder` sets both places; role `coordinator` sets `responsible` only; anything else raises `42501 assignment_team_forbidden`. The parent-row lock (`bc_assignments … for no key update`) becomes `pg_advisory_xact_lock(hashtext('osubb.assignment_team:' || p_assignment))`, taken before reading the team rows. The "target is the holder" duplicate check is deleted; "target already holds the other place" stays (`PT409 assignment_team_duplicate`). `coordinator_not_bce` (live level 5 exactly) and `invalid_team_member` (live `activ`) stay. The two team notifications ("Ești acum …", "Nu mai ești …") stay. A null `p_member_id` still clears a place.
5. **`public.my_capabilities()`** loses `administer_bc`. The function is dropped and recreated (a column removal cannot be `create or replace`), the same way R44 added the column. The remaining Deals flags follow from the helper: a BC member reads `manage_deals`, `manage_deals_team` and `pick_deals_coordinator` true; the Coordonator reads the first two true; the Responsabil the first only. `administer` is unchanged.
6. **`private.assignment_label`** stays (notification titles).
7. **Error vocabulary.** `bc_assignment_forbidden`, `bc_assignment_not_bc`, `bc_assignment_held`, `invalid_assignment` are retired from `docs/backend/conventions.md` and from `app/src/lib/command-reasons.ts`. `assignment_team_forbidden`, `coordinator_not_bce`, `invalid_team_member`, `assignment_team_duplicate` stay.
8. **Seed** (`supabase/seed.sql`): delete the `bc_assignments` insert; the `assignment_team` insert loses its `exists (… bc_assignments …)` guard. The seed stays re-runnable (it already deletes the demo cohort first).

### Backend tests

- `supabase/tests/bc_assignments.test.sql` is replaced by `supabase/tests/assignment_team.test.sql`: a BC member sets both places; a second BC member changes them; the Moderator sets both; the Coordonator sets the Responsabil and is refused for the Coordonator; the Responsabil, a BCE member outside the team, a Voluntar, a claimless caller and a demoted (stale-token) BC member are refused; `coordinator_not_bce`, `invalid_team_member`, `assignment_team_duplicate`; clearing a place; notifications to the new and former member; `set_bc_assignment`, `bc_assignments_directory` and `bc_assignments` no longer exist; the capability matrix above; the migration keeps existing team rows (asserted against the seed personas). Mutation check: reverting the helper's `>= 6` branch must fail a named assertion.
- `supabase/tests/osubb_deals.test.sql`: the fixtures stop inserting a holder; "a BC member outside the team cannot publish a Deal" becomes "a BC member publishes a Deal without being on the team"; the "once the team dissolves" assertions become "once the Responsabil is cleared".
- `supabase/tests/my_capabilities.test.sql`: the BC persona rows gain the three Deals flags; the column list shrinks; the stale comment about the Moderator is fixed.
- `supabase/tests/tracker_grants.test.sql` and `supabase/tests/rls_deny_by_default.test.sql`: remove the dropped functions and table from their inventories.
- `supabase/tests/conventions.test.sql` needs nothing, but must stay green.

### Frontend

Delete: `screens/administrare/AdminBcTab.tsx` and its test, `screens/administrare/bc-assignments-view.ts`, `queries/bc-assignments.ts`, the lazy import and the `bc` route in `App.tsx`, the Administrare BC entry in `screens/administrare/administrare-tabs.ts`, `'/administrare/bc'` in `components/shell/navItems.ts`, `administerBc` in `lib/capabilities.ts` and every test literal, `keys.assignments.holders`, the `bc_assignments` row in `queries/live-changes.ts`, the four retired reasons in `lib/command-reasons.ts`.

Change:

- `queries/deals.ts`: `DealsTeam` becomes `{ coordinatorId, responsibleId }`; `fetchDealsTeam` reads `assignment_team` only.
- `screens/deals/deals-presentation.ts`: candidates no longer exclude a holder; comments rewritten.
- `screens/deals/DealsTeamPanel.tsx`: the `held` gate goes; two `TeamPlace`s, Coordonator and Responsabil, on one row (`sm:grid-cols-2`); `TeamPlace` loses `hint`; a picker shows when the viewer holds `pickDealsCoordinator` / `manageDealsTeam`, a name otherwise; the header comment states the new rule.
- `screens/deals/DealsAdminTab.tsx`: comment only; "Deal nou" already follows `manageDeals`.
- `lib/database.types.ts` regenerated (`npm run gen:types` in `app/`).

Frontend tests to update: `DealsTeamPanel.test.tsx` (a BC member picks both; the Coordonator picks the Responsabil only; the Responsabil sees names; no "nobody holds it" case), `DealsAdminTab.test.tsx` (a BC member gets "Deal nou" and edit), `AdministrareLayout.test.tsx` (no Administrare BC tile for anyone), `App.test.tsx` (the `/administrare/bc` guard case goes), `lib/auth-destination.test.ts`, `queries/deals.test.ts`, `lib/capabilities.test.tsx`, `AppShell.test.tsx`.

### Docs

- `docs/superpowers/plans/2026-09-23-prod-readiness-grill.md`: a new row **R47** after R46, "Atribuții held by every BC member (2026-10-11)", quoting Alex ("All of BC members should be able to do all the specific actions … this button should disappear and by default they will be able to do anything. OSUBB Deals will remain as a separate page, but only the BCE and Responsabil will be selected, thing that can be done by any BC/Moderator"), stating the matrix above, that R44's holder, checkboxes, move and dissolve are superseded, that the Coordonator keeps their powers, and that the three placeholder Atribuții follow the same shape. R44's row gets one trailing sentence pointing at R47.
- `CONTEXT.md`, glossary entry _Atribuție_: "A named BC responsibility area, independent of Roles and Group positions (R44, amended by R47 on 2026-10-11). Every BC member and the Moderator hold its powers by default; nobody is its holder. The first is OSUBB Deals: BC or the Moderator pick a Coordonator (a BCE member) and a Responsabil (any active Member); the Coordonator can do everything except pick the Coordonator; the Responsabil publishes Deals and manages their own." Keep `_Avoid_`.
- `docs/backend/deals.md`: the Atribuții section rewritten (no holder table, the check list, the matrix, the advisory lock, the retired reasons); `docs/README.md` line 20 reworded.
- `docs/backend/conventions.md` §3: the retired reasons removed.
- `CLAUDE.md` status: one sentence that Atribuții are BC-wide since 2026-10-11.

---

## Part B — Create n copies of a Task: `create_tasks`

### Decision

A manager creating a Task can ask for **n identical copies**. For a public Task that is n Opportunities in Disponibile. For a direct Task the app asks for one Executor per copy before anything is created. The same applies to Subtasks of an Umbrella Task. The copies are created **atomically by one server command**: all n exist or none.

### Command contract

```
public.create_tasks(
  p_title text, p_description text, p_deadline timestamptz,
  p_audience text, p_assignment_mode text,
  p_executor_ids uuid[] default null,
  p_campaign_id bigint default null, p_parent_task_id bigint default null,
  p_kind text default 'task', p_group_id bigint default null,
  p_links jsonb default '[]'::jsonb,
  p_copies integer default 1)
returns setof public.tasks   -- the created rows, in creation order
```

`language sql`, security invoker, delegating to `private.create_tasks_impl` (`security definer`, `set search_path = ''`). No legacy `p_link_label` / `p_link_url` pair: the new command only knows `p_links`. `public.create_task` is untouched.

Step 1 (malformed input, before the gate), in this order:

- `p_copies` null or below 1 → `PT400 invalid_copies`; above 100 → `PT400 too_many_copies` (the `too_many_links` precedent). Raised from 20 to 100 on 2026-10-11 (Alex: "add a greater limit, like 100 for both options" — this command and Part E's).
- `p_kind = 'umbrella'` with `p_copies > 1` → `PT400 invalid_copies` (an Umbrella has no copies; its Subtasks do).
- `p_assignment_mode = 'public'` with a non-empty `p_executor_ids` → `PT400 invalid_executors`.
- `p_assignment_mode = 'direct'` with `p_executor_ids` present and `array_length <> p_copies` → `PT400 invalid_executors`. A null array means n unassigned direct copies; a null element means that copy is unassigned (a direct Task may already start without an Executor). The same Member may appear twice: the server allows what n separate `create_task` calls allow; the app's picker is what prevents repeats.

Then the loop: `for i in 1..p_copies loop … private.create_task_impl(p_title, …, p_executor_id => p_executor_ids[i], …)`, collecting each returned row. Everything else is inherited per copy: the gate, `require_group_work_manager`, every shape and audience rule, `invalid_executor` for an Executor below the Group's Minimum Level, the Umbrella parent lock (`for no key update`, re-taken harmlessly each iteration, never `for update`), `require_daily_cap('task_create')` counted per copy inside the one transaction (100 copies spend the whole day's 100; a batch the cap cannot hold raises `PT409 rate_limited` and rolls back all), the `created` and `executor_assigned` activity rows, and one "Task nou" notification per assigned Executor (two copies to one Member are two notifications, as two Tasks are). Copies carry no provenance link to each other.

Grants: the four-role revoke then `grant execute … to authenticated` for both functions, like every command.

### Backend tests

New `supabase/tests/create_tasks.test.sql`: signature and grants (anon cannot execute; invoker wrapper, definer impl with empty `search_path`); `invalid_copies` (0, null, Umbrella with 2), `too_many_copies` (101; 21 are accepted), `invalid_executors` (public with executors, direct with 2 executors for 3 copies); 3 public copies are 3 `todo` Tasks with open queues and one `created` row each, no notification; 3 direct copies with 3 Executors notify each once and write two activity rows each; a null element leaves that copy unassigned; **atomicity**: 3 copies where the third Executor is below the Group's Minimum Level creates nothing and raises `invalid_executor`; the cap: with 99 creations spent today, 2 copies raise `rate_limited` and create nothing; 3 Subtasks under one Umbrella inherit its Group, and the Umbrella is held exactly `For No Key Update` during the call (the `pgrowlocks` probe pattern from `create_task.test.sql`); `p_copies = 1` behaves as `create_task`. Rosters: `tracker_grants.test.sql` (wrapper and impl rows, count pins), `scripts/smoke-tracker-commands.sql` (one call with 2 public copies), ADR-0007 command list, conventions §3 (the three reasons).

### Frontend

- `lib/schemas/task.ts`: `copies` (integer 1–100, default 1), `executorIds` (array, direct only). `fieldForReason` maps the three reasons to `copies` / the dialog.
- `screens/tracker/task-form-model.ts`: `TaskDraft` gains `copies` and `executorIds: (string | null)[]`; an Umbrella forces `copies = 1`.
- `screens/tracker/TaskForm.tsx`: a number field **Exemplare** (`Input type="number" min=1 max=100 step=1 inputMode="numeric"`, the Event capacity pattern) after _Mod de atribuire_, hidden for an Umbrella. At `copies = 1` the form is exactly today's form. Public with `copies > 1`: the submit button reads "Creează n taskuri" ("Creează n subtaskuri" under an Umbrella). Direct with `copies > 1`: the in-form `DirectExecutorSelector` is replaced by a `FieldDescription` "Executorii se aleg la pasul următor" and the button reads "Continuă".
- New `screens/tracker/CopiesExecutorsDialog.tsx`: a `Dialog` (`fullScreenOnPhone`), title "Executorii celor n taskuri", description "Alege câte un executor pentru fiecare exemplar.", one `DirectExecutorSelector` per copy labelled "Exemplarul i", each required, a Member chosen in one picker excluded from the others (`DirectExecutorSelector` gains an optional `excludeIds` prop), footer _Înapoi_ / "Creează n taskuri"; `busy` while the mutation runs; a server refusal shows in the dialog under the matching picker when `invalid_executor` names one, else as the dialog's error line.
- `queries/task-umbrella.ts`: `createTasks(draft)` → `supabase.rpc('create_tasks', …)` returning the rows; `useCreateTasks` invalidates `keys.tasks.all` once. The form submits through `createTasks` for every `copies`, including 1 (one path; `create_task` stays for the smoke script and other callers).
- `screens/tracker/NewTaskControl.tsx` and `screens/tracker/UmbrellaTaskSection.tsx`: own the two-step flow (form → dialog when direct and `copies > 1`); on success with one Task behave as today (open its details); with more, close the sheet and report "n taskuri create." / "n subtaskuri create." through the existing notice slot (`TrackerScreen`'s `created` state gains a plural variant without an id; the Umbrella section refreshes its Subtask list). No details sheet opens for n above 1.
- `lib/command-reasons.ts`: Romanian copy for `invalid_copies` ("Numărul de exemplare nu e valid."), `too_many_copies` ("Cel mult 100 de exemplare odată."), `invalid_executors` ("Alege câte un executor pentru fiecare exemplar.").
- `lib/database.types.ts` regenerated.
- `DESIGN.md`, the dialog rule: "A dialog confirms or asks for a reason — three fields at most, or one like field per copy (the Executors of n Tasks)."

Frontend tests: `TaskForm.test.tsx` (field hidden for an Umbrella; labels at n; executor picker gives way at direct n>1), `CopiesExecutorsDialog.test.tsx` (n pickers, exclusion, all required, Înapoi returns to the form, refusal shown), `NewTaskControl.test.tsx` and `UmbrellaTaskSection.test.tsx` (the rpc is `create_tasks` with the right `p_copies` / `p_executor_ids`; the plural receipt; no details open), `queries/task-umbrella.test.ts`.

---

## Part C — Scrollable tab bars

### Rule

Both tab tracks, the phone's bottom bar (`components/shell/TabBar.tsx`) and the in-page strip (`components/layout/PageTabs.tsx` and everything on `tabListClass` / `tabClass`), **keep exactly their current look**. When their tabs do not fit, the track **scrolls sideways with no visible scrollbar** instead of squeezing, truncating or clipping. The current tab is brought into view by moving the track's own scroll position, never the page's.

Bottom bar names, fit first, scroll last: the current tab shows its full name if the five fit; if not, its short name; only if the five still overflow does the bar scroll. A new width starts again from the full name (today's reset). In-page strips keep collapsing to icons at the same `labelsFrom` widths as today, and scroll only when even the collapsed tabs overflow. Labels no longer truncate anywhere.

### Implementation

- `tabListClass` and the bottom bar's track add `overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`; tabs become `flex-auto shrink-0` (grow to share the track when there is room, never shrink below their content); the label spans drop `truncate`.
- The thumb is unchanged: it is positioned against the track and scrolls with it.
- A shared hook `useScrollCurrentTabIntoView(trackRef, currentSelector)` in `components/layout/tab-scroll.ts`: after a route change, if the current tab's left is before `scrollLeft` or its right is after `scrollLeft + clientWidth`, set `scrollLeft` so it is fully visible, with `behavior: 'smooth'` unless `prefers-reduced-motion`. Used by `PageTabs` and `TabBar`. Base UI `Tabs` lists (Profil, Taskuri, a Member's page) get the classes only: the tab a Member taps is already in view.
- `TabBar`'s short-name measurement changes from "the label clips" to "the track overflows" (`track.scrollWidth > track.clientWidth + 1`): full name overflowing → short name; short name still overflowing → leave it and let it scroll.
- `DESIGN.md` line 215 ("Never scrolls sideways …") and the comments at the top of `PageTabs.tsx` and `TabBar.tsx` are rewritten to the rule above.

Tests: `PageTabs.test.tsx` (classes present; the hook moves `scrollLeft` when the current tab is out of view and leaves it when in view, with mocked geometry) and a new `TabBar.test.tsx` (full name when nothing overflows; short name when the full one overflows; short name kept, no further change, when it still overflows).

---

## Part D — The date picker popup shows everything

### Rule

The date/time popup (`components/ui/date-picker.tsx`, used by the Task, Deal, Event and Announcement forms, the Duplicate control, the Work Filter and two Administrare screens) is **always its full height**: month grid, Azi/Mâine/clear, the time and Gata all visible, never a scrollbar inside it.

### Implementation

- The popup drops `max-h-(--available-height) overflow-y-auto overscroll-contain`.
- The positioner keeps `side="bottom" align="start" sideOffset={6} collisionPadding={12}` and adds `collisionAvoidance={{ side: 'shift', align: 'shift', fallbackAxisSide: 'none' }}` (Base UI 1.8.0): the popup prefers opening under the field and, near the bottom of the screen, slides up as far as needed, over the field if it must, instead of flipping and being clamped.
- `date-picker.test.tsx`: the popup carries no max-height or overflow class; the positioner is configured to shift.

---

## Part E — Add a finished Task n times for n volunteers: `create_completed_tasks`

Added 2026-10-11, after Parts A–D landed. Alex: "i also want to be able to add finished task for n number of times for n number of people, but make sure to be able to select the same person more than once, it should work as we talked for the duplication before" and, approving it, "add a greater limit, like 100 for both options".

### Decision

"Adaugă task finalizat" can add the same finished Task for **n volunteers at once**, and the same person may be chosen more than once. The flow is Part B's: an **Exemplare** count on the form; at n above 1 the volunteer picker gives way and "Continuă" opens a dialog that asks one volunteer per copy; the n finished Tasks, their Evaluations and their points are written **atomically by one server command**. The limit is **100 copies**, for this command and for `create_tasks` alike. The approval of a Completed-work Request and Trackerul membrului keep one copy.

### Command contract

```
public.create_completed_tasks(
  p_executor_ids uuid[], p_group_id bigint, p_title text, p_description text,
  p_campaign_id bigint default null, p_difficulty integer default null,
  p_rating integer default null, p_note text default null,
  p_links jsonb default '[]'::jsonb, p_copies integer default 1)
returns setof public.tasks   -- the created rows, in creation order
```

`language sql`, security invoker, delegating to `private.create_completed_tasks_impl` (`security definer`, `set search_path = ''`). No legacy `p_link_label` / `p_link_url` pair. `public.create_completed_task` is untouched.

Step 1 (malformed input, before the gate), in this order:

- `p_copies` null or below 1 → `PT400 invalid_copies`; above 100 → `PT400 too_many_copies`.
- `p_executor_ids` null, of a length other than `p_copies`, or holding a null entry → `PT400 invalid_executors`: a finished Task always names its Executor. The same Member may appear any number of times.

Then the loop: `for i in 1..p_copies loop … private.create_completed_task_impl(p_executor_ids[i], p_group_id, p_title, p_description, null, null, p_campaign_id, p_difficulty, p_rating, p_note, p_links)`, collecting each returned row. Everything else is inherited per copy: the authority rule of `completed_task_groups`, the eligibility refusals (`executor_not_group_member`, `executor_below_min_level`, `executor_role_excluded`), the completed Task and its ended Assignment, the Evaluation and its points, the one "Task evaluat" notification, and `require_daily_cap('task_create')`. One refusal rolls back all. Copies carry no link to each other.

The `task_create` cap is 100 creations per actor per day: a batch at the limit spends the whole day's allowance, and a batch the cap cannot hold raises `PT409 rate_limited` and creates nothing.

Grants: the four-role revoke then `grant execute … to authenticated` for both functions.

### Backend tests

New `supabase/tests/create_completed_tasks.test.sql`: surface and grants (anon cannot execute; invoker wrapper, definer impl with empty `search_path`, set-returning); `invalid_copies` (0, before the gate), `too_many_copies` (101), `invalid_executors` (no list; one entry for two copies; a null entry); nothing exists after a refusal; two volunteers → two completed Tasks, each crediting its own volunteer; the same volunteer three times → three Evaluations, three times the points in the ledger, three "Task evaluat" notifications; **atomicity**: a volunteer outside the Group, or a BC member, among the list refuses the whole call with the inherited reason and writes nothing; the body takes no lock of its own. Rosters: `tracker_grants.test.sql` (wrapper and impl rows, the private pin), ADR-0007's command list, conventions (the copies paragraph).

### Frontend

- `screens/tracker/CopiesExecutorsDialog.tsx` becomes the one "one picker per copy" dialog: new optional props `title`, `description`, `confirmLabel`, `busyLabel`, `allowRepeats` and `renderPicker`; their defaults keep Part B's callers exactly as they are. With `allowRepeats` no picker excludes another's choice.
- `VolunteerPicker` moves out of `CompletedTaskForm.tsx` into `components/tasks/VolunteerPicker.tsx`, with `label` (default "Voluntar") and `excludeIds` (default none).
- `lib/schemas/completed-task.ts`: `copies` as typed (a string), parsed like Part B's — `invalid_copies` for a blank, a fraction, zero; `too_many_copies` above 100 — under Exemplare; the volunteer is required only at one copy; `invalid_executors` lands under the volunteer field.
- `components/tasks/CompletedTaskForm.tsx`: prop `copies` (the manager's "Adaugă task finalizat" passes it; approvals and Trackerul membrului do not); the **Exemplare** field after the Group, with the hint "Adaugă același task finalizat pentru mai mulți voluntari odată, până la 100. Alegi voluntarii la pasul următor; aceeași persoană poate fi aleasă de mai multe ori."; at n above 1 the picker gives way to "Voluntarii se aleg la pasul următor, câte unul pentru fiecare exemplar." and the button reads "Continuă"; the draft carries `copies` and, at n above 1, no `executorId`.
- `queries/completed-tasks.ts`: `createCompletedTasks({ draft, executorIds })` → `supabase.rpc('create_completed_tasks', …)` with `p_executor_ids` the list (or `[draft.executorId]` at one copy) and `p_copies`; `useCreateCompletedTasks` invalidates `keys.tasks.all` and `keys.points.all`. `createCompletedTask` stays for the approval flow.
- `screens/tracker/AddCompletedTaskControl.tsx`: the manager variant owns the two-step flow (form → dialog at n above 1): dialog title "Voluntarii celor n taskuri finalizate", description "Alege câte un voluntar pentru fiecare exemplar.", confirm "Adaugă n taskuri și acordă punctele", busy "Se salvează…", repeats allowed; `onAdded({ ids, title })`. One copy behaves as today (the details open). Trackerul membrului reports one id.
- `screens/tracker/TrackerScreen.tsx`: at one id today's notice and details; at more, the receipt "n taskuri finalizate adăugate. Punctele au fost acordate." in the plural slot.
- `lib/command-reasons.ts`: "Cel mult 100 de exemplare odată."; `lib/database.types.ts` regenerated.

Frontend tests: `CopiesExecutorsDialog.test.tsx` (repeats allowed, given title and labels), `AddCompletedTaskControl.test.tsx` (three copies, the same person twice, through the dialog to `create_completed_tasks`; Exemplare hides the picker and reads "Continuă"), `queries/completed-tasks.test.ts`, `lib/schemas/completed-task.test.ts`, `TrackerScreen.test.tsx` (the plural receipt).

---

## Delivery

- One branch, `feat/bc-powers-task-copies-bars`, one PR opened by Alex. Commits are per part (A backend, A frontend, A docs, B backend, B frontend, C, D) so review reads in order.
- Verification before hand-off: `npx supabase db reset && npx supabase test db` green; in `app/`: `npm run typecheck`, `npm run lint`, `npm run test:run`, `npm run gen:types` leaves no diff; `scripts/check-local-ci.sh` as the final mirror of CI; the dev server checked by hand for the Deals page as a BC member, a 3-copy public Task, a 2-copy direct Task with the dialog, 2 Subtasks under an Umbrella, the bars on a 320 px viewport, and the date picker near the bottom of a sheet.
- Out of scope: sanctions and the other after-launch items; any change to how a single Task is created; edge fades or arrows on the scrolling tracks; a new look for the bars.
