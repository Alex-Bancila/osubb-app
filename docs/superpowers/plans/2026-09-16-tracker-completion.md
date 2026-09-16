# Task Tracker completion — Stacks F–J (2026-09-16)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (one implementer per task, a task review after each, one whole-plan review at the end). Each task branches from `main`, opens a normal PR, and is merged as soon as its review is clean and CI is green — the delivery model settled in the command wave. Steps use `- [ ]` syntax.

**Goal:** Take the Task Tracker from "backend complete, one Ionic screen" to the product the BC/BCE go-live on **1 October 2026** needs: every member and manager flow runs through the 24 server commands, leadership sees a task-points-only Leaderboard and an Origin-based Department Cup with filters, and nothing in `app/` writes a Task table directly.

**Architecture:** Three lanes that converge. (1) **Unblock** dobrerares' 13-PR frontend stack and 4 backend PRs, all built before the command wave retired the legacy tables — they need one rebase, regenerated types and a re-pinned roster before anything else can build on them. (2) **Finish the reporting backend** — the `leaderboard`/`dept_cup` views on `main` are still the legacy all-ledger, current-membership ones; ADR-0007 wants task points only, attributed to the Task's Origin, with Department/Team/Project/Campaign filters and a member drill-down. (3) **Build the remaining screens** over one typed command layer, grouped by persona: member flows, manager flows, leadership and notifications.

**Tech stack:** Supabase (PostgreSQL 15, RLS, pgTAP) for the reporting RPCs; Vite + React + TypeScript + React Router + TanStack Query + TanStack Table + shadcn/Base UI + Tailwind v4 in `app/`; `supabase.rpc()` for every mutation.

**Spec:** `docs/adr/0007-task-tracker-lifecycle.md` (amended 2026-09-10) and `CONTEXT.md` §Task Tracker are the authority; the open issue bodies (#176–#191, #346–#354, #258–#262, #101, #69) are the per-task requirements; `docs/backend/conventions.md` binds every migration. Where an issue body and the ADR disagree, the ADR wins; where the ADR is silent, `docs/superpowers/plans/2026-09-14-tracker-command-wave.md` §Execution rulings records what the backend actually does.

---

## Verified state on `main` @ `5eb328c` (2026-09-16)

Read these before arguing with any task below; every line was checked, not remembered.

**Backend — complete.** All 24 commands in ADR-0007's server-command boundary exist as `public.<verb>_<noun>()` wrappers over `private.*_impl`, including `create_campaign`, `update_campaign`, `set_campaign_active` and the three Completed-work Request commands. `task_assignees`, `task_requests`, `claim_open_task` and every direct-DML policy are gone (#345). The pinned `private` roster is **83**. `app/src/lib/database.types.ts` is current: every command is under `Functions`, every Tracker table and view under `Tables`/`Views`.

**Backend — reporting is still legacy.** `public.leaderboard` (`20260907204817`) ranks `member_points` — the *whole* ledger, not task points — for level ≥ 5 and active profiles only; `public.dept_cup` sums it by the member's *current* department. ADR-0007 §Lifecycle and points requires: member name + Task points only; Cup by the **Task's Origin** (Department and Department-Team Tasks; Project and Independent-Team work never); filters by Department (including its Teams), Team, Project, Campaign applied to the producing Task; a row opens that member's authorized full Tracker; eligibility regardless of current Profile status. That is #258 (SuperGod25), #259 and #260 (dobrerares, PRs #475/#476 — see below), #262, and the frontend #354.

**Backend — notifications.** `public.notifications` **has** self policies since `20260911030000_notification_self_access.sql` (`select` own rows; `update (read)` own rows); `private.notify` writes Task-kind rows with a `link` column meant for in-app routes. `push_tokens` has **no** policies (#66). No deadline reminder job exists (#69). Web Push is a deferred decision (#70). Realtime is not configured; ADR-0007 allows it only as a cache-invalidation signal, and 30 s `staleTime` polling is acceptable for the go-live.

**Frontend — one screen.** `app/src/screens/tracker/TrackerScreen.tsx` renders "Taskurile mele" from `task_assignments` (post-#490: all statuses, one row per Task). `useOpenTasks` exists and is unused. **Zero of the 21 Task commands have a caller in `app/src`**; the only `.rpc()` in the app is `set_event_rsvp`. Leaderboard and Cup are Dashboard cards over the legacy views. No notifications UI, no requests UI, no manager UI. The shell is shadcn; the Tracker, Dashboard and Calendar screens still wrap content in Ionic (`IonPage`/`IonContent`). shadcn primitives (`button card badge alert empty field label separator sheet table`) and a generic `DataTable` (TanStack Table) exist. `capabilities.ts` defines `manageTasks: 4` and `seeLeadership: 5`; nothing in the Tracker uses `manageTasks`. `keys.ts` reserves `notifications.*` and `announcements.*` families with no queries behind them.

**Frontend — dobrerares' open stack, and why it is stuck.** Seventeen open PRs. A **13-deep frontend stack** rooted at `#471 tracker/164-presentation-model → main`, then `#472 (#173) → #473 (#167) → #479 (#165) → #480 (#166) → #481 (#169) → #482 (#170) → #483 (#175) → #484 (#171) → #485 (#174) → #486 (#172) → #487 (#168) → #488 (#351)`. Only #471 has a real green CI run; the other twelve show failures with **zero steps executed** — the Actions quota outage of 2026-09-15, not code. But every one of them carries a `database.types.ts` generated **before #345**, still containing `task_assignees` — the "Generated types match the schema" gate will fail on each the moment CI reruns. #487 ships a migration (`20260915193556_my_managed_task_ids.sql`: `public.can_manage_tasks()`, `public.can_read_all_tasks()`, `public.my_managed_task_ids()`) and edits `tracker_grants.test.sql` against a pre-wave roster; #482's `task-interest.ts` reads a `task_queue_summary` view that does not exist on `main`. A **backend stack** `#475 (#259) → main` and `#476 (#260) → #475` has **real** failures (13 steps ran, `Migrations + db tests` failed) and #475 is `CONFLICTING`; `#477 (#364) → main` is `CONFLICTING` (it centralizes actor helpers the wave already touched); `#478 (#370)` is Calendar. dobrerares also owns the issues #164–#175, #351, #259, #260, #364, #370; SuperGod25 owns #258.

**Frontend issues open and unassigned:** #176–#191 (except none — all unassigned), #346–#350, #352–#354, #101, #193, #200, #376, #88–#92 (umbrellas). Their `## Blocked by` lines all name backend issues that are now closed: every one is startable.

---

## Global constraints

- House rules 1–15 in `CLAUDE.md`; `docs/backend/conventions.md` for every migration (seven-step command order, the four-role revoke idiom, the parent-lock rule `for no key update`, error vocabulary, Ruling 23: a `throws_ok` on a constraint names the constraint). The roster count is **read off the branch, never assumed**; a new `private` function adds a row and bumps the count by exactly one.
- **Browsers never change Task state directly** (ADR-0007 §Server-command boundary). Every mutation in `app/` goes through `supabase.rpc('<command>', …)` via the shared command layer of Task H1. A `.from('tasks'|'task_*'|'completed_work_requests'|'campaigns'|'points_ledger').insert|update|delete` in `app/src` is a review-blocking defect.
- **RLS is the authority; capabilities are cosmetic.** `can(claims, 'manageTasks')` hides a tab; the server decides on every row. A screen must render correctly when the server refuses (`42501`/`PT404`) despite the claim.
- **Error vocabulary is the API.** `42501 <scope>_forbidden`, `PT400 invalid_*|*_required`, `PT404 *_not_found`, `PT409 <subject>_<state>`; the reason is in `error.message`. The command layer maps kind + reason to Romanian copy once; screens never string-match SQL errors themselves.
- **Query keys mirror data, most general first** (`keys.ts` rules). Every Task command invalidates `keys.tasks.all`; anything that writes points also invalidates `keys.points.all`; requests and campaigns get their own families (Task H1).
- **Romanian copy everywhere the member reads**; plural agreement (`1 punct`/`N puncte`, `1 candidat`/`2–19 candidați`/`20+ de candidați`); deadlines rendered in `Europe/Bucharest`.
- **Owner boundaries.** Do not open a PR that edits a file dobrerares' open stack also edits until his PR touching it has merged (`app/src/screens/tracker/TaskCard.tsx`, `TrackerScreen.tsx`, `TaskDetailsSheet.tsx`, `task-presentation.ts`, `DataTable.tsx`, `keys.ts` additions he makes, `queries/task-*.ts`). Stack F exists to get those merged first. Where a task below names one of his components, the implementer reads the **merged** file first and adapts; the names cited are from his branches on 2026-09-16.
- **One issue = one branch = one PR, `Closes #n`, CI green, merged as you go.** When GitHub Actions is out of quota, `bash scripts/check-local-ci.sh` (all 24 gates) is the merge gate and the run's summary goes in the PR.
- **Never** stage `docs/superpowers/plans/2026-09-11-project-team-role-matrix.md` (another session's untracked file). Python hangs on this machine — use the editor tools; `psql` is absent — scripts fall back to `docker exec -i supabase_db_osubb-app psql`.

---

## Stack overview and order

| Stack | Tasks | What it delivers | Owner | Blocks |
| --- | --- | --- | --- | --- |
| **F — Unblock** | F1, F2 | dobrerares' 13 frontend PRs rebased onto post-wave `main` and merged bottom-up; his 2 reporting PRs rebased | dobrerares (spec written here; I do it with his go-ahead) | everything in H–J that touches his files |
| **G — Reporting backend** | G1–G4 | `leadership_leaderboard(filters)`, `department_cup(filters)`, `leadership_member_tasks`, the points authorization matrix, the deadline reminder job | G1 SuperGod25 (#258); G2 dobrerares (#259/#260 → aligned to one filter signature); G3, G4 unassigned | J1 |
| **H — Command layer + member flows** | H1–H4 | one typed `callCommand()`, start/submit/give-up, own points + ledger, my requests | unassigned | I, J |
| **I — Manager flows** | I1–I7 | task form (direct/public, umbrella/subtask, campaign), edit/convert/duplicate, queue management, the evaluation dialog family, umbrella progress, campaigns panel, request decisions | unassigned | — |
| **J — Leadership + notifications** | J1–J3 | `/clasament` with filters and drill-down, notifications screen + badge, Tracker off Ionic + routing tests | unassigned | — |

**Critical path to 1 October:** F1 → H1 → I1 (create) → I4 (evaluate) → H2 (start/submit) → J1 (leaderboard). Those six give BC/BCE the loop they run today in Google Sheets: create work, hand it out, evaluate it, see the standings. Everything else improves it.

**Parallelism rules:** F runs alone first (it rewrites the base every frontend task builds on). After F, G runs in parallel with H (different layers, no shared files). I and J start once H1 has merged; two frontend implementers may run concurrently only when their task rows share no file.

---

## Stack F — Unblock the open stack

### Task F1: rebase the 13-PR frontend stack onto post-wave `main`

**Files:** every branch `tracker/164-presentation-model` … `requests/351-submit-work`; on each, `app/src/lib/database.types.ts` (regenerated) and, on `tracker/168-role-tabs`, `supabase/tests/tracker_grants.test.sql` and the migration's timestamp; on `tracker/170-express-interest`, `app/src/queries/task-interest.ts` (the `task_queue_summary` read). Model: standard tier — mechanical, but a 13-deep rebase with conflict judgement.

**Rulings:**

- This is dobrerares' work. The plan writes the exact procedure so it takes an hour, not a day; **who runs it is his call** (he can hand it to me — the branches are on the shared remote). Nothing in Stack H–J that touches his files starts before this merges.
- Rebase **bottom-up**, one branch at a time, each onto its rebased parent; after each rebase run `cd app && npm run gen:types` and commit only if the file changed. Because the stack's tips carry the same stale types, most branches will show only the regenerated file as their own change.
- `#487`'s migration `20260915193556_my_managed_task_ids.sql` sorts **before** `20260915193604_retire_legacy_task_writes.sql` on `main`; rename it to a timestamp **after** `20260916101117_tracker_wave_closeout.sql` (`npx supabase migration new my_managed_task_ids` and move the body) so it applies on top of the wave, then re-pin the roster: it adds three **public** functions and no `private` ones, so the count stays **83** and only `expected_function_privs` gains three rows.
- ~~`#482` reads `task_queue_summary`, which does not exist.~~ **Corrected 2026-09-16 before execution: the view *does* exist on `main`**, created by `20260911211200_task_history_read_policies.sql` (`security_invoker`, `select` to `authenticated`/`service_role`), exposing `task_id`, `pending_count` and `my_position` through the `SECURITY DEFINER` helpers `private.pending_candidate_count` and `private.queue_position`. `#482`'s read is correct as written and needs no change. The research note behind the original ruling was wrong; nothing in the stack creates or needs to create that view.
- Each rebased PR must pass **the types gate and the roster gate**; a red types diff means a branch still carries a `task_assignees` or `task_requests` type — search the file, do not hand-edit it.

- [ ] For each branch bottom-up: `git fetch origin && git switch <branch> && git rebase origin/<parent>` (parent = `main` for #471), resolve, `cd app && npm run gen:types`, `git add app/src/lib/database.types.ts && git commit -m "chore(types): regenerate after #345"` when changed, `git push --force-with-lease`.
- [ ] On `tracker/168-role-tabs`: move the migration to a post-closeout timestamp; read the roster count on the branch (`grep -n "pinned_private_functions)::int" supabase/tests/tracker_grants.test.sql`); it must read 83; add the three wrappers to `expected_function_privs`.
- [ ] On `tracker/170-express-interest`: fix the `task_queue_summary` read per the ruling; keep `taskInterestError`'s mapping — Task H1 generalizes it, it does not replace it here.
- [ ] Run `bash scripts/check-local-ci.sh` on the stack tip (`requests/351-submit-work`); every gate green.
- [ ] Merge bottom-up: `gh pr merge 471 --merge`, wait for GitHub to retarget #472 to `main`, wait for **its** CI on the retargeted base (a retarget does not re-run CI — the Stack C lesson; `gh pr checks <n> --watch`), merge, repeat. Never merge a PR whose base is still a `tracker/*` branch.

### Task F2: rebase the reporting PRs and align them with G

**Files:** `backend/259-department-cup` (`20260915170000_department_cup_task_origins.sql`, tests), `backend/260-member-tracker` (`20260915171000_leadership_member_task_drilldown.sql`, tests). Model: standard tier.

**Rulings:**

- Both were written before the wave; `#475` is `CONFLICTING` and its db job fails for real. Rebase onto `main`, re-pin the roster (each adds `private` functions: read, then `+N`), re-timestamp after the closeout migration.
- `#475`'s `private.department_cup_rows()` already attributes points to `coalesce(task.dept_id, team.dept_id)` over `reason in ('task','task_reversal')` — the ADR rule. Keep it, but **align its signature with G1**: `department_cup(p_team_id text default null, p_project_id bigint default null, p_campaign_id bigint default null)` is meaningless for the Cup (Cup rows *are* departments); the Cup takes only `p_campaign_id`. Rule: `department_cup_rows(p_campaign_id bigint default null)`, filtering `task.campaign_id = p_campaign_id` when given.
- `#476`'s `public.leadership_member_tasks(p_member_id uuid)` is the drill-down J1's row click needs; keep its shape, make sure it returns `tasks_with_overdue` columns plus the member's Assignment state and the Evaluation (difficulty, rating, points) so the drill-down needs no second query.
- The five-department hard-code `department.id in ('edu','pr','youth','fin','hr')` in #475 duplicates `departments.kind = 'department'`; keep only the `kind` predicate (ADR: `diverse`/`secretariat` never enter the Cup, and they are `kind <> 'department'`).

- [ ] Rebase both; fix the roster; re-run `check-local-ci.sh`; open/refresh the PRs against `main` (`#476` retargets to `main` after `#475` merges).
- [ ] Add one pgTAP assertion per PR that pins the new filter/parameter behavior named above.

---

## Stack G — Leadership reporting backend

### Task G1: `public.leadership_leaderboard(filters)` — task points only, attributed to the producing Task (#258)

**Files:** Create migration `leadership_leaderboard`, `supabase/tests/leadership_leaderboard.test.sql`; roster +1 (`leadership_leaderboard_impl`); types. Owner: SuperGod25 — the SQL below is the contract J1 codes against; if he prefers, I implement it with his go-ahead.

**Interfaces — Produces:**

```text
public.leadership_leaderboard(
  p_department_id text default null,
  p_team_id       text default null,
  p_project_id    bigint default null,
  p_campaign_id   bigint default null
) returns table (member_id uuid, full_name text, points int, rank int)
```

**Rulings:**

- Sum only `points_ledger.reason in ('task','task_reversal')`, joined to `tasks` through `entry.task_id`; awards, sanctions and every other reason are excluded (ADR: "Awards do not exist. Sanctions … may affect a member's personal total" — the Leaderboard is *Task* points).
- **Filters apply to the producing Task, never to the member's memberships.** `p_department_id` matches `task.dept_id = p_department_id` **or** `task.team_id in (select id from teams where dept_id = p_department_id)` (a Department includes its Department Teams — the same rule as the Cup). `p_team_id`, `p_project_id`, `p_campaign_id` match the Task's column directly. Filters combine with `and`. All null = unfiltered.
- **Eligibility regardless of current Profile status**: join `profiles` for the name only; no `status = 'activ'` predicate (ADR: "Anyone with completed Task history remains eligible").
- Rows: `member_id, full_name, points, rank() over (order by points desc, full_name asc)`; members with zero task points are **not** rows (the Leaderboard is "members ordered by Task Points").
- Gate: `private.caller_level() >= 5` with a live `activ` profile → else return **no rows** (a view-like surface returns empty rather than raising, matching `leaderboard`'s current behavior and #258's AC "forbidden … receive no protected rows").
- Shape: `security definer set search_path = ''` `_impl` behind a `security invoker` wrapper, grants per conventions §4.

- [ ] Migration:

```sql
create function private.leadership_leaderboard_impl(
  p_department_id text, p_team_id text, p_project_id bigint, p_campaign_id bigint)
returns table (member_id uuid, full_name text, points int, rank int)
language sql stable security definer set search_path = '' as $$
  with allowed as (
    select 1 from public.profiles as caller
     where caller.id = (select auth.uid()) and caller.status = 'activ'
       and coalesce((select private.caller_level()), 0) >= 5
  ), task_points as (
    select entry.member_id, sum(entry.delta)::int as points
      from public.points_ledger as entry
      join public.tasks as task on task.id = entry.task_id
      left join public.teams as team on team.id = task.team_id
     where exists (select 1 from allowed)
       and entry.reason in ('task', 'task_reversal')
       and (p_department_id is null
            or task.dept_id = p_department_id
            or team.dept_id = p_department_id)
       and (p_team_id     is null or task.team_id     = p_team_id)
       and (p_project_id  is null or task.project_id  = p_project_id)
       and (p_campaign_id is null or task.campaign_id = p_campaign_id)
     group by entry.member_id
  )
  select tp.member_id, pr.full_name, tp.points,
         rank() over (order by tp.points desc, pr.full_name asc)::int
    from task_points as tp
    join public.profiles as pr on pr.id = tp.member_id
   order by tp.points desc, pr.full_name asc;
$$;

create function public.leadership_leaderboard(
  p_department_id text default null, p_team_id text default null,
  p_project_id bigint default null, p_campaign_id bigint default null)
returns table (member_id uuid, full_name text, points int, rank int)
language sql stable security invoker set search_path = '' as $$
  select * from private.leadership_leaderboard_impl(p_department_id, p_team_id, p_project_id, p_campaign_id);
$$;

revoke execute on function private.leadership_leaderboard_impl(text, text, bigint, bigint) from public, anon, authenticated, service_role;
revoke execute on function public.leadership_leaderboard(text, text, bigint, bigint) from public, anon, authenticated, service_role;
grant  execute on function private.leadership_leaderboard_impl(text, text, bigint, bigint) to authenticated;
grant  execute on function public.leadership_leaderboard(text, text, bigint, bigint) to authenticated;
```

- [ ] Suite (owned fixtures, personas via `pg_temp.test_login`): a member with a Department Task award and a Department-Team Task award appears once with the sum; the Department filter includes the Team award; the Team filter returns only it; a Project award is excluded by every Department filter and included unfiltered; a reversed award nets to zero and the member disappears; a **deactivated** member with history still appears; a sanction row is excluded; `voluntar` (level 0–3) gets zero rows; claimless gets zero rows; BCE gets rows. Roster `+leadership_leaderboard_impl`; `expected_function_privs` row for the wrapper.
- [ ] Do **not** drop `public.leaderboard` yet — `points.ts` still reads it for the Dashboard card; J1 switches the card and a later cleanup drops the legacy views (#376 lists it).

### Task G2: Department Cup by Origin + member drill-down land with one filter vocabulary (#259, #260)

Delivered by F2's rebased PRs. The only plan-level rulings: `department_cup(p_campaign_id)` and `leadership_member_tasks(p_member_id)` are the names J1 calls; both gate at level ≥ 5 exactly as G1; both add `expected_function_privs` rows. Owner: dobrerares.

### Task G3: the points authorization matrix (#262)

**Files:** `supabase/tests/points_authorization_matrix.test.sql` (new); no migration. Model: standard tier. Blocked by G1, G2.

- [ ] One suite that logs in as each identity — anonymous, claimless uid, inactive member, roles at levels 0, 1, 2, 3, 4, BCE (5), BC (6), Moderator (6), `service_role` — and asserts, with `set_eq`, the exact rows of `my_points`, the member's own `points_ledger` selection, `leadership_leaderboard()`, `department_cup()` and `leadership_member_tasks(<other>)`. Every "forbidden" case asserts **zero rows** (not merely "no error"); every allowed case asserts the fixture's exact ids. Non-vacuity: each protected surface has at least one identity that sees rows.

### Task G4: daily deadline reminder job (#69)

**Files:** Create migration `remind_deadlines`; `supabase/tests/remind_deadlines.test.sql`; roster +1 (`private.remind_deadlines`, `none` grant). Model: cheap tier. Independent of everything above; small.

- [ ] `private.remind_deadlines()`: for every `tasks` row with `status in ('todo','in_progress','in_review')`, `kind = 'task'`, `deadline between now() and now() + interval '48 hours'`, and an active `task_assignments` row, call `private.notify(array[executor], 'task', 'Termen apropiat', '<title> — termenul este <deadline in Europe/Bucharest>', task_id, format('task:%s:deadline:%s', task_id, to_char(now() at time zone 'Europe/Bucharest', 'YYYY-MM-DD')), null)`. The dedupe key makes a second run in the same day a no-op. Umbrellas are skipped by `kind`.
- [ ] Schedule with `pg_cron` at 08:00 Bucharest if the extension is available locally; otherwise ship the function and a `select cron.schedule(...)` guarded by `if exists (select 1 from pg_extension where extname = 'pg_cron')`, and document the hosted step in `docs/backend/`.
- [ ] Suite: call twice on fixtures — exactly one notification per due-soon Executor; a terminal Task and an Umbrella produce none; a Task due in 3 days produces none.

---

## Stack H — the command layer and member flows

### Task H1: one typed command layer for all 24 commands (no issue — foundation; reference #170/#171's `task-interest.ts` as the precedent)

**Files:** Create `app/src/queries/commands.ts`, `app/src/queries/commands.test.ts`; modify `app/src/queries/keys.ts` (add `requests`, `campaigns`, `leadership` families). Model: standard tier. **Blocked by F1** (`keys.ts` and `task-interest.ts` merge first; H1 generalizes `taskInterestError`, it must not fork it).

**Interfaces — Produces (every later frontend task consumes):**

```ts
export type CommandName = keyof Database['public']['Functions'];
export type CommandArgs<F extends CommandName> = Database['public']['Functions'][F]['Args'];
export type CommandResult<F extends CommandName> = Database['public']['Functions'][F]['Returns'];
export type CommandErrorKind = 'forbidden' | 'not_found' | 'conflict' | 'invalid' | 'unknown';
export class CommandError extends Error { readonly kind: CommandErrorKind; readonly code?: string; readonly reason?: string; }
export function classifyCommandError(error: { code?: string; message?: string } | null): CommandError;
export async function callCommand<F extends CommandName>(fn: F, args: CommandArgs<F>): Promise<CommandResult<F>>;
export function commandMessage(error: CommandError): string;   // Romanian, by reason, with a per-kind fallback
export const invalidations: { task: QueryKey[]; points: QueryKey[]; requests: QueryKey[]; campaigns: QueryKey[] };
```

**Rulings:**

- `classifyCommandError`: `42501 → forbidden`; `PT404 → not_found`; `PT409 → conflict`; `PT400 → invalid`; else `unknown`. `reason` = the SQL `message` when it is a single snake_case token (the backend guarantees this), else undefined.
- `commandMessage` maps **reasons**, not kinds, first — the reason is the product vocabulary: `task_terminal` → "Taskul este deja închis.", `task_not_in_review` → "Taskul nu este în verificare.", `task_not_in_progress` → "Taskul nu este în lucru.", `task_not_todo` → "Taskul a fost deja început.", `reason_required` → "Scrie un motiv.", `note_required` → "Scrie o notă.", `evaluation_note_required` → "Scrie nota de evaluare.", `invalid_difficulty` → "Alege dificultatea (1–5).", `invalid_rating` → "Alege calificativul (1–5).", `task_has_no_executor` → "Taskul nu are executant.", `already_executor` → "Ești deja executantul acestui task.", `already_candidate` → "Ești deja în coadă.", `candidate_not_pending` → "Candidatul nu mai este în așteptare.", `subtasks_not_terminal` → "Mai există subtaskuri deschise.", `umbrella_cancelled` → "Taskul-umbrelă a fost anulat.", `request_not_pending` → "Cererea a fost deja decisă.", `nothing_to_update` → "Nu ai schimbat nimic.", `task_not_overdue` → "Taskul nu a depășit termenul.", `task_is_umbrella` → "Acțiunea nu se aplică unui task-umbrelă.", `task_not_umbrella` → "Taskul nu este umbrelă.", `task_already_evaluated` → "Taskul a fost deja evaluat."; fallbacks per kind: forbidden "Nu ai dreptul să faci asta.", not_found "Taskul nu există sau nu îl poți vedea.", conflict "Taskul s-a schimbat. Lista a fost actualizată.", invalid "Datele nu sunt valide.", unknown "Nu am putut confirma acțiunea. Reîncarcă și încearcă din nou.".
- `invalidations.task = [keys.tasks.all]`; `points = [keys.tasks.all, keys.points.all, keys.leadership.all]`; `requests = [keys.requests.all, keys.tasks.all, keys.points.all]`; `campaigns = [keys.campaigns.all]`. Every mutation hook uses `onSettled` (not `onSuccess`) so a `conflict` also refetches.
- `keys.ts` additions: `requests: { all, mine(memberId), queue(originKey) }`, `campaigns: { all, byDepartment(deptId) }`, `leadership: { all, leaderboard(filters), cup(campaignId), member(memberId) }`.
- `callCommand` never swallows a null result: a command that `returns public.tasks` and yields `null` is `unknown`.

- [ ] Write `commands.ts` per the interfaces; write the test: the classification table (one case per code), the reason → message table (every reason above), the `null` result case, and that `taskInterestError` (already merged) agrees with `classifyCommandError` for `42501`/`PT409`/`PT404`/`PT400` — pin the agreement so the two cannot drift.
- [ ] Commit `feat(app): typed command layer over the Tracker RPCs`; PR.

### Task H2: start, submit, give up (#185, #186, #176)

**Files:** Create `app/src/queries/task-progress-commands.ts` (+ test), `app/src/screens/tracker/GiveUpDialog.tsx` (+ test); modify the merged `TaskCard.tsx` (actions slot). Model: standard tier. Blocked by F1, H1. One PR per issue (three small PRs sharing the query file's growth), or one PR closing all three if the reviewer accepts the batch — ruling: **three PRs**, `Closes #185` / `#186` / `#176`, since each has its own acceptance criteria and gating.

**Rulings:** actions appear only for the member's **own active** Assignment: `Începe` when `status = 'todo'` → `start_task`; `Trimite la verificare` when `in_progress` → `submit_task_for_review`; `Renunță` when `todo|in_progress` → `GiveUpDialog` (required non-blank reason) → `give_up_task(p_task_id, p_reason)`. No give-up in `in_review` (ADR). After give-up the card disappears from "Taskurile mele" on invalidation; a public Task shows nothing about promotion to the leaver (the promoted Candidate learns by notification — #176's AC "reflects automatic candidate promotion" is satisfied by the queue position refresh on the *other* member's card, test that through the query invalidation, not through UI the leaver cannot see).

- [ ] Mutations: `useStartTask()`, `useSubmitTaskForReview()`, `useGiveUpTask()` over `callCommand`, `onSettled: invalidations.task`.
- [ ] `GiveUpDialog`: shadcn `sheet` or dialog, textarea, disabled submit on blank, shows `commandMessage` on error, closes on success.
- [ ] Tests: button visibility per status × ownership; payloads; conflict path re-renders from the refetched status.

### Task H3: own points and own ledger (no new issue — ADR §Lifecycle and points: "Ordinary members see only their own total and own ledger rows")

**Files:** modify `app/src/queries/points.ts` (add `useMyLedger()`), create `app/src/screens/tracker/MyPointsPanel.tsx` (+ test); route `/tracker/puncte` or a panel on `/tracker`. Model: cheap tier. Blocked by F1.

- [ ] No migration: `ledger_read` on `public.points_ledger` was narrowed to own rows in `20260910123134_points_ledger_own_rows.sql` and `select` is granted to `authenticated` (verified 2026-09-16). Read the policy once to confirm the predicate before relying on it; another member's rows must stay invisible — the existing pgTAP coverage in that migration's suite is the proof, do not duplicate it.
- [ ] Panel: total (`my_points`), then rows: Task title (join `tasks`), `reason` label (`task` → "Task evaluat", `task_reversal` → "Evaluare anulată", `sanction` → "Sancțiune"), `delta` with sign, date. Plural copy for the total.

### Task H4: my requests list and status (#352; #351 is dobrerares' form)

**Files:** create `app/src/queries/my-requests.ts` (+ test), `app/src/screens/requests/MyRequestsList.tsx` (+ test); the merged `CompletedWorkRequestScreen.tsx` gains the list under the form. Model: cheap tier. Blocked by F1 (#488 merges first), H1.

- [ ] `useMyRequests(memberId)`: `completed_work_requests` where `requester_id = memberId` (the read policy already admits the requester), newest first; status chip `pending|approved|rejected`; an approved row links to its Task (`task_id`) in the details sheet; a rejected row shows `decision_note`.

---

## Stack I — manager flows

Every task here is gated in the UI by `can(claims, 'manageTasks')` **and** by the server; a level-4 member without an Origin to manage sees the tab and an empty state, never a failing form. The manager surface is the merged `ManagerTaskTable` (#166) plus `TaskDetailsSheet` (#172).

### Task I1: the create-task form — direct/public, audience, origin, campaign, umbrella/subtask (#180, #182, #183; part of #348)

**Files:** create `app/src/screens/tracker/TaskForm.tsx`, `TaskForm.test.tsx`, `app/src/queries/task-create.ts` (+ test), `app/src/queries/campaigns.ts` (read side; the write side is I6), `app/src/queries/members.ts` (`useActiveMembers()` over `profiles_directory` or `profiles` — verify which the level-4 caller may read; if neither admits level 4, the executor picker uses the Origin's members via `member_departments`/`team_members`/`project_members`, which the manager can read). Model: most capable tier (form state, conditional fields, three issues). Blocked by F1, H1. Three PRs: #182 (origin/audience validation model, pure functions), #180 (the form, no write), #183 (executor picker + the `create_task` call).

**Interfaces — Consumes:** `create_task(p_title, p_description, p_dept_id, p_team_id, p_project_id, p_campaign_id, p_audience, p_assignment_mode, p_deadline, p_executor_id, p_kind, p_parent_task_id)` — read the exact argument list from `database.types.ts` `Functions.create_task.Args`; the plan does not restate it because it is generated.

**Rulings:**

- Exactly one Origin: a segmented control Department / Team / Project, then one select populated from **what the caller manages** (Departments where the caller is local BCE or level ≥ 6; Teams the caller may manage — Department Teams by parent Department, Independent Teams by membership; Projects where the caller is lead or Responsible). Source those lists from `public.can_manage_tasks()` / `my_managed_task_ids()` if #487 shipped them as reusable, else from the membership tables.
- No Difficulty field (evaluation sets it — ADR). Campaign select only for Department origins, active Campaigns only. `kind`: ordinary / umbrella / subtask-of; a Subtask locks Origin to the parent and hides Audience/Mode? — **no**: a Subtask has its own Audience and Mode (ADR §Umbrella), only the Origin is inherited; lock Origin, keep the rest.
- Direct mode shows the executor picker (any active member — ADR "the manager may choose any active OSUBB member"); public mode shows Audience (`local`/`org`). Deadline is a datetime in `Europe/Bucharest`, must be in the future.
- Server errors surface through `commandMessage`; `invalid_origin`, `deadline_required`, `title_required` map to field errors, not a toast.

- [ ] #182: `validateTaskDraft(draft): FieldErrors` pure module + tests (one origin, deadline future, executor required iff direct, campaign only with a Department origin, subtask inherits origin).
- [ ] #180: the form over #182, rendering only; storybook-free component test per field visibility rule.
- [ ] #183: `useCreateTask()` → `callCommand('create_task', …)` → `invalidations.task`; on success open the new Task's details sheet.

### Task I2: edit content/deadline/campaign, convert mode, duplicate (#184, #347; `convert_task_mode` has no issue — fold into #184's PR as a second action, ruling recorded)

**Files:** create `app/src/screens/tracker/EditTaskSheet.tsx` (+ test), `app/src/queries/task-edit.ts` (+ test). Model: standard tier. Blocked by I1 (reuses the form's field components).

- [ ] `update_task_content(p_task_id, p_title, p_description, p_deadline, p_campaign_id)`: send only changed fields (the command answers `nothing_to_update` otherwise); show the audit that content edits notify the Executor.
- [ ] `convert_task_mode(p_task_id, p_assignment_mode, p_audience)`: only before the first Assignment/Candidature — the server refuses otherwise; the UI hides the action once `assignment_mode` is locked (a Task with any Assignment or Candidate), test both.
- [ ] `duplicate_task(p_task_id, p_deadline)` (#347): a deadline picker in the details sheet's overflow menu; on success open the clone.

### Task I3: queue management — open/close, select a candidate, decide the remaining queue, assign a direct executor (#179, #177, #178, #350)

**Files:** create `app/src/screens/tracker/CandidateQueuePanel.tsx` (+ test), `app/src/queries/task-queue-commands.ts` (+ test). Model: standard tier. Blocked by F1 (#483's queue position and #487's manager tabs merge first), H1. Two PRs: #179+#350 (toggle + assign), #177+#178 (select with the close-remaining decision — one dialog, one command).

**Rulings:**

- `set_task_queue(p_task_id, p_open boolean)` — the toggle in the details sheet; copy explains that closing hides the Opportunity from non-participants.
- `select_task_candidate(p_task_id, p_candidate_id, p_close_remaining boolean)` — the queue panel lists `pending` Candidates in `joined_at` order (managers may read them); "Alege" opens a confirm with the radio "Restul cozii rămâne deschisă / se închide" (that is #178 — one dialog, one command call, not two).
- `assign_task_executor(p_task_id, p_executor_id)` — only on a **direct** Task with no active Executor (the command refuses public Tasks: `executor_not_allowed_for_public`); the picker reuses I1's member picker.
- Candidate names come from `profiles` through the manager's read; a Candidate who is no longer `activ` is shown greyed (the server skips them on promotion — Ruling 4 of the wave — but a manager **may** still select them? No: `select_task_candidate` fails loudly with `PT400 invalid_executor` for an inactive choice; disable the button with that explanation).

### Task I4: the evaluation dialog family — return, scoring guide, evaluate, unfulfilled, reopen, cancel (#187, #188, #189, #346, #190, #191)

**Files:** create `app/src/screens/tracker/EvaluationDialog.tsx` (+ test) — **one** component reused by evaluate, unfulfilled and (I7) request approval; `ScoringGuide.tsx` (+ test) over `rating_guide`/the difficulty guide reference tables; `ReasonDialog.tsx` (return note / reopen reason / cancel reason — one component, three copies); `app/src/queries/task-review-commands.ts` (+ test). Model: most capable tier (six issues, one shared dialog, points preview). Blocked by F1, H1. PRs: #188 (guide, pure), #189 (dialog + `complete_task_review`), #187 (`return_task_to_progress`), #346 (`mark_task_unfulfilled` reusing the dialog), #190 (`reopen_task`), #191 (`cancel_task`).

**Rulings:**

- The dialog collects Difficulty 1–5, Rating 1–5, note (all required) and **previews the points**: `difficulty × mult(rating)` with `mult = {1:-1, 2:0, 3:1, 4:2, 5:3}` — read the multipliers from the `rating_guide` reference table at runtime, do not hard-code them in the component; the preview copy uses `1 punct`/`N puncte` and shows negative values plainly ("−3 puncte").
- Evaluate is offered only when `status = 'in_review'` and the caller passes the server (the UI cannot compute `can_evaluate_task`; it shows the action to `manageTasks` callers and renders the `42501 task_evaluate_forbidden` message inline when refused — ADR-0007 §Authorization is enforced server-side, and the Responsible-cannot-evaluate-the-lead rule is exactly the case the UI cannot know).
- Unfulfilled is offered only when the Task is **overdue** (`deadline < now()`, derived client-side from `tasks_with_overdue.is_overdue`) and not terminal; same dialog, title "Marchează nerealizat".
- Return (`return_task_to_progress(p_task_id, p_note)`), reopen (`reopen_task(p_task_id, p_reason)`) and cancel (`cancel_task(p_task_id, p_reason)`) share `ReasonDialog`; cancel on an Umbrella warns that open Subtasks are cancelled with the same reason (ADR).
- Double submission: the mutation's `isPending` disables the button; a second click during flight is a no-op; the server's row lock makes a real double call answer `task_already_evaluated`/`task_not_in_review`, which the dialog shows and then closes on refetch.
- Success invalidates `invalidations.points` (the member's total, the Leaderboard, the Cup all refresh — #189's AC).

- [ ] Build in the PR order above; each PR's test covers visibility rule, payload, points preview (for the dialog), and the refused path.

### Task I5: umbrella progress and completion (#348)

**Files:** create `app/src/screens/tracker/UmbrellaProgress.tsx` (+ test); modify the merged `TaskDetailsSheet.tsx` to render it for `kind = 'umbrella'`; `app/src/queries/subtasks.ts` (`useSubtasks(parentId)` over `tasks_with_overdue where parent_task_id = …`). Model: standard tier. Blocked by I1 (subtask creation reuses the form), I4 (cancel).

- [ ] Progress line "x / n finalizate" counts `completed|unfulfilled|cancelled`; "Finalizează umbrela" enabled only when `x = n` and `n > 0`, calling `complete_umbrella_task(p_task_id)`; the disabled state names how many remain (the server's `subtasks_not_terminal` carries the count in `detail` — show the local count, they agree).
- [ ] "Adaugă subtask" opens I1's form with `parent_task_id` set and Origin locked. Member cards show "parte din: <umbrella title>" on Subtasks (that is a `TaskCard` change — coordinate with the merged file).

### Task I6: campaigns panel (#349)

**Files:** create `app/src/screens/bc/CampaignsPanel.tsx` (+ test), `app/src/queries/campaigns.ts` (write side: `useCreateCampaign`, `useRenameCampaign`, `useSetCampaignActive`); route under `/bc` gated by `manageTasks` and further by "Departments I manage". Model: cheap tier. Blocked by H1.

- [ ] Commands `create_campaign(p_department_id, p_name)`, `update_campaign(p_campaign_id, p_name)`, `set_campaign_active(p_campaign_id, p_active)` — read the exact args from the generated types; `invalidations.campaigns`. Local BCE sees only their Departments (the server's read policy already scopes `campaigns`); BC sees all.
- [ ] Deactivated Campaigns leave I1's select but stay in J1's filter (both read `useCampaigns(deptId, { includeInactive })`).

### Task I7: manager decision queue for Completed-work Requests (#353)

**Files:** create `app/src/screens/requests/RequestDecisionQueue.tsx` (+ test), `app/src/queries/request-decisions.ts` (+ test). Model: standard tier. Blocked by F1 (#488), H1, I4 (the evaluation dialog).

- [ ] List `completed_work_requests where status = 'pending'` — the read policy scopes it to Origins the caller manages plus the caller's own; hide the caller's **own** pending requests from the decision list (deciding one's own is allowed by the backend — wave Ruling 27 — but the UI should not invite it; record this in the component comment).
- [ ] Approve → `EvaluationDialog` → `approve_completed_work_request(p_request_id, p_difficulty, p_rating, p_note)`; reject → `ReasonDialog` → `reject_completed_work_request(p_request_id, p_note)`; `request_not_pending` closes the row on refetch. Invalidate `invalidations.requests`.

---

## Stack J — leadership and notifications

### Task J1: `/clasament` — Leaderboard and Cup with filters and drill-down (#354)

**Files:** create `app/src/screens/leadership/LeadershipScreen.tsx` (+ test), `LeaderboardTable.tsx`, `DeptCupCard.tsx` (move from the Dashboard), `MemberTrackerScreen.tsx` at `/tracker/membru/:id` (+ tests); `app/src/queries/leadership.ts` (`useLeadershipLeaderboard(filters)`, `useDepartmentCup(campaignId)`, `useMemberTasks(memberId)`); modify `points.ts` to point the Dashboard card at the new RPC; route gating `seeLeadership`. Model: standard tier. Blocked by G1, G2, F1 (`DataTable` filtering from #479/#480), H1 (keys).

- [ ] Filters: Department (includes its Teams — copy says so), Team, Project, Campaign — chips bound to URL search params so a filtered view is shareable; `keys.leadership.leaderboard(filters)`.
- [ ] Table: name, points only (ADR); rank as the row number; row click → `/tracker/membru/:id`, which renders `leadership_member_tasks(:id)` in the Tracker's own card/table components (read-only, with the same status/overdue presentation).
- [ ] Cup card beside the table over `department_cup(campaignId)`; the Campaign chip drives both.
- [ ] AC test: the same member shows different totals under two Department filters; unfiltered equals the sum; level < 5 is redirected with an explanation.
- [ ] Follow-up recorded, not done here: drop `public.leaderboard`/`public.dept_cup`/`member_points` once nothing reads them (#376).

### Task J2: notifications screen and badge (#101)

**Files:** create `app/src/queries/notifications.ts` (+ test), `app/src/screens/notifications/NotificationsScreen.tsx` (+ test), a badge in `AppShell`'s nav item; route `/notificari`. Model: cheap tier. Blocked by F1 (shell nav items). Backend needs nothing: self-read and `update (read)` policies exist.

- [ ] `useNotifications(memberId)`: own rows newest first (`keys.notifications.all` → `['notifications', 'mine', {memberId}]`); `useUnreadCount(memberId)` with `head: true, count: 'exact'` over `read = false`, `staleTime` 30 s.
- [ ] Mark read on open (`update notifications set read = true where id = …` — the **only** direct table write the app makes, permitted by the column grant; say so in a comment) and "Marchează toate ca citite"; `link` navigates in-app (`/tracker/<id>` — the details sheet opens by id).
- [ ] AC: the seeded `bc@demo.osubb` sees Task-kind rows addressed to them and no broadcast rows the suppression hides — assert against the #296 seed's notifications.

### Task J3: the Tracker off Ionic, routing tests, consolidation (#193, #376, ADR-0002)

**Files:** `TrackerScreen.tsx`, `DashboardScreen.tsx` (Ionic wrappers → shadcn layout), `App.test.tsx` (deep links, guards, history), `points.ts` (leaderboard reads consolidated). Model: standard tier. Last, after I and J1 — it touches the files everyone else edits.

- [ ] Remove `IonPage`/`IonContent`/`IonIcon` from the Tracker and Dashboard screens; keep the app booting under `IonApp` until Calendar follows (its own plan). Deep links `/tracker/<id>`, `/tracker/membru/<id>`, `/clasament`, `/notificari` covered by `App.test.tsx`. #376's dead-code and error-normalization items close by pointing everything at `commands.ts`.

---

## Verification (whole plan)

- Every PR: CI green on `main` as base (or `scripts/check-local-ci.sh` 24/24 when Actions is out of quota, with the summary in the PR); `Closes #n`; no `.insert|.update|.delete` on a Task table in `app/src` except J2's `notifications.read` (grep in the whole-plan review).
- At the end: `bash scripts/smoke-tracker-commands.sh` still passes; `npx supabase test db` green with the roster reconciled; `cd app && npm run typecheck && npm run lint && npm run test:run && npm run build` green; the frontend calls **all 24 commands** (grep `callCommand('` and `.rpc('` — the whole-plan review lists any command with no caller and says why).
- Manual acceptance on staging with the #296 seed, as `bce@demo.osubb`: create a public Department Task → as `voluntar@` express interest → as `bce@` see the Candidate, close the queue, watch the Executor start and submit → return with a note → complete with Difficulty 3 / Rating 4 → the Leaderboard shows +6 for `voluntar@`, the Cup shows +6 for the Department, the Department filter and the Campaign filter agree → reopen → totals back → complete again. Then file a Completed-work Request as `voluntar@` and approve it as `bce@`. Every step through the UI only.
- SDD ledger at `.superpowers/sdd/2026-09-16-tracker-completion/progress.md`; workspace deleted after the whole-plan review; the plan's "Execution rulings" section (to be added, as the command wave did) is the durable record.

## Human actions (Alex)

1. **Tell dobrerares** the F1/F2 procedure exists and ask whether he runs it or hands the branches over; nothing in H–J touching his files starts before F1 merges. Ask SuperGod25 the same for G1 (#258) — the SQL is written above.
2. Post the two issue drafts from `docs/superpowers/plans/2026-09-14-tracker-command-wave.md` §Issue drafts to post (self-award authority; `require_member()` — the latter overlaps #364, dobrerares' conflicting PR; decide which survives).
3. Fix one line in `CLAUDE.md` Status: "notification fan-out and the notification tables' RLS (#65, #68)" → `notifications` self policies exist; only `push_tokens` (#66) and the announcement fan-out (#68) remain. A docs-only commit; I can do it with the first PR of this plan.
4. After J1 merges, decide when the legacy `leaderboard`/`dept_cup`/`member_points` views are dropped (#376).

## Risks and rulings

- **The open stack is the schedule risk, not the code.** Thirteen stacked PRs with stale types and a colliding migration cannot merge until F1; every day it waits, `main` moves further. Cost if F1 slips: H–J build on his `TaskCard`/`DataTable` contracts blind and rework on merge. Mitigation: F1 is the first task, alone, and its procedure is written to be handed over.
- **Two owners hold the reporting backend** (#258 SuperGod25, #259/#260 dobrerares). The plan writes G1's SQL as the contract J1 codes against, so J1 can start on a stub the moment G1's signature is agreed. Cost if wrong: one RPC signature to change in `leadership.ts`.
- **Evaluation authority cannot be computed client-side.** The UI shows the action to `manageTasks` callers and lets the server refuse (`task_evaluate_forbidden`). Cost: a Responsible sees a button that fails for the lead's Task — the message explains why. Alternative (a `can_evaluate_task(task_id)` RPC — it is already granted to `authenticated`) is a one-line optimization for I4 if the reviewer wants it.
- **Points preview must not drift from the guide.** I4 reads multipliers from the reference table; the seed and `rating_mult()` are the same source of truth. Cost if hard-coded: a guide change silently mispreviews.
- **Realtime is deferred.** 30 s `staleTime` plus invalidation-on-mutation is enough for ~20 leaders; a Realtime channel that invalidates `keys.tasks.all` on `tasks`/`task_assignments` changes is a one-task follow-up once the screens exist.
- **Web Push, sanctions, Calendar, production deploy** are out of this plan (#70, #104, #248/#370, #77/#78/#109) — the delivery order puts them after the Tracker.
