# Pages pass — design plan (2026-09-27, ruling R27)

> Alex's five requests of 2026-09-27 after a walk through Acasă, Clasament, Profil and Administrare as
> the demo BC member: a leadership Acasă, a Clasament that shows one board at full width, a Profil that
> names a board member's position instead of their Groups, an Administrare split into routed tabs, and
> one layout system so that no page has "some things bigger, some smaller". This plan is the design; the
> issues listed at the end build it. It is structure and consistency, not a restyle: the OSUBB red accent,
> Montserrat, the tokens in `app/src/theme/tokens.css` and the existing cards stay. Ruling **R27** in
> `2026-09-23-prod-readiness-grill.md` records it and supersedes R4's "Acasă keeps its leadership cards"
> and R11's side-by-side Clasament/Cupa layout.

**No backend change is needed for any of it.** Every card reads an existing query or a new client-side
composition of existing reads and RPCs; the one place where a backend change _could_ follow is where the
board titles live (decision D1 below), and the default needs none.

## Facts from the code (`main` at `e4ac873`)

- **Page frames disagree.** `.page` (`theme/screens.css:12-16`: `--content-max` 1240 px, padding 24 / 16 px
  under 768) on Acasă, Calendar, Grupuri, Profil and the Administrare member page; Tailwind frames
  elsewhere with five different widths and three paddings: Taskuri `max-w-6xl p-4 sm:p-6`
  (`TrackerScreen.tsx:163`), Clasament `max-w-6xl p-4 md:p-8` (`LeadershipScreen.tsx:211`), the member
  tracker `max-w-4xl p-4 md:p-8` (`MemberTrackerScreen.tsx:221`), Anunțuri and Notificări
  `max-w-4xl p-4 sm:p-6 lg:p-8` (`AnnouncementsScreen.tsx:80`, `NotificationsScreen.tsx:109`), Campanii
  `max-w-3xl p-4 sm:p-6` (`CampaignsScreen.tsx:43`), Cereri `max-w-2xl` (`CompletedWorkRequestScreen.tsx:81`),
  Administrare, Perioade, Voluntari and the Administrare Group page with no width at all and `p-4 md:p-6`
  (`AdministrareScreen.tsx:344`, `PeriodsScreen.tsx:740`, `VolunteersScreen.tsx:171`, `GroupScreen.tsx:198`).
- **Cards disagree.** `.card` (`screens.css:59-66`: radius 13 px, padding 20 px, shadow) vs Tailwind boxes
  `rounded-xl border bg-card p-4 | p-5 | p-4 md:p-5 | p-4 md:p-6` — and `rounded-xl` is **24 px** in this
  theme (`tailwind.css:43`, `--radius-xl: var(--r-xl)`), so two radii sit side by side. Profil overrides
  `.card` to `p-6` (`ProfileScreen.tsx:165,225,…`). The shadcn `Card` (`components/ui/card.tsx`) is used by
  three components only.
- **Headings disagree.** Page titles are `.page-title` (31 / 24 px, 800), `text-2xl font-semibold`,
  `text-2xl font-bold` or `text-3xl font-bold`; section titles are `.card-title` (16 px), `text-lg`,
  `text-xl`, or Acasă's uppercase `.next-title` (`dashboard.css:259-278`). Eyebrows exist on two pages
  only: Clasament's "OSUBB · Conducere" (`LeadershipScreen.tsx:213-215`) and Calendar's "Calendar OSUBB".
- **Three tab implementations.** Taskuri: Base UI `Tabs` with `tabClass` (`TrackerScreen.tsx:159-160,
215-235`, state only, no route); the Administrare Group page: a hand-rolled `role="tablist"`
  (`GroupScreen.tsx:234-263`); Calendar: an `aria-pressed` segmented toggle (`CalendarScreen.tsx:113-131`,
  `theme/calendar.css:42-61`).
- **Unequal rows.** Acasă's `.next-grid` and `.dash-grid` use `align-items: start` (`dashboard.css:119-124,
238-243`), and `.dash-grid` is `1.15fr 1fr`; Clasament's grid is `1.5fr 1fr` with `items-start`
  (`LeadershipScreen.tsx:244`) — the "crushed" leaderboard in the screenshot. Profil is a 1/3 + 2/3 split
  of independently stacked cards (`ProfileScreen.tsx:161-423`). `RoleTimeline` returns `null` while loading
  or on error (`RoleTimeline.tsx:33`) and `PromotionProgress` returns `null` in five places
  (`PromotionProgress.tsx:51-128`), so a grid cannot know how many cells it has.
- **Empty states.** `components/states` `Empty` (plain muted text), shadcn `components/ui/empty.tsx`, and
  hand-written dashed boxes (`LeadershipScreen.tsx:127-132`, `VolunteersScreen.tsx:251`).
- **Acasă** (`DashboardScreen.tsx:40-66`): greeting from `firstName(full_name)` (`:26`), `MyPointsCard`
  (rank tile for `seeLeadership`, otherwise the note "Clasamentul și Cupa Departamentelor sunt vizibile
  pentru BCE și BC." at `MyPointsCard.tsx:86-92`), `NextTaskCard` + `NextEventCard`, then for
  `seeLeadership` `LeaderboardCard` + `DeptCupCard`. `useLeaderboard`, `useMyStanding` and `useDeptCup`
  (`queries/points.ts:70-97`) have no other caller.
- **The copy request.** No string on `main` says that BC/BCE "belong to every Group". The closest are the
  Clasament intro "Un membru apare sub grupul în care a lucrat taskul, chiar dacă nu îi aparține. Alege un
  rând pentru trackerul membrului." (`LeadershipScreen.tsx:217-221`), the Work Filter hints "Grupul include
  toate subgrupurile sale…" (`LeadershipScreen.tsx:240`, `AvailableOpportunities.tsx:32`,
  `ManagerTaskList.tsx:71`) and the `MyPointsCard` note above. This plan removes all three from the pages it
  touches (Acasă, Clasament, Disponibile); if Alex meant another sentence, the issue is amended.
- **"The Work Filter toggle button" does not exist on `main`**: the Work Filter is always open
  (`components/work-filter/WorkFilter.tsx`). The Clasament toggle goes where Calendar's view toggle is — the
  page header's action slot, directly above the filter.
- **Tasks awaiting review**: `useManagedTasks` (`queries/task-tabs.ts:10-33,54-60`) reads
  `my_managed_task_ids()` then the Tasks with their latest `submitted` activity row
  (`latestSubmissionOnly`, `queries/tasks.ts:9-40`), which carries `occurred_at`. `can_evaluate_task`
  (`queries/task-review.ts:20`) answers per Task, because `can_manage_task` is wider than evaluation (a
  Group Responsible manages but never evaluates another Responsible's or a Manager's Task — `CONTEXT.md`).
  The Tracker deep link `?task=<id>` only opens Taskurile mele (`TrackerScreen.tsx:104-125`).
- **Board titles.** BC is a **Role**, not a Group; there is no "Biroul de Conducere" Group in the
  migrations or `seed.sql`. Titles live only in `group_members.position_title` (Group Responsibles; `seed.sql`
  uses "Membru Logistică", "Responsabil proiect", "Responsabil Adunarea Generală") and in the Group setting
  `groups.manager_title`. `private.set_group_role_impl` (latest body `20260927150000_column_limits.sql:481`)
  accepts a Responsible with a title on an Automatic-Membership Group — `seed.sql:365-369` does it on the
  Adunarea Generală — so a title on the Organization Group is possible today. `useMyGroups().membershipRows`
  (`queries/reference.ts:155-194`) already reads the caller's `group_members` rows including the
  Organization Group's, which `buildMemberGroups` then hides (`reference.ts:128`).
- **Administrare** (`AdministrareScreen.tsx:342-424`) stacks, on one page: a link to Perioade (`:382-391`),
  `RolePanel` (`:393`), `PrivacyPanel` (`:394`), the Group tree or Grupurile mele (`:396-422`) and
  `CsvImportPanel` (`:423`). Perioade is its own route holding the period cards _and_ the organization
  settings cards (`PeriodsScreen.tsx:721-806`). Group Applications are read per Group only
  (`GroupApplicationsTab.tsx`), but `group_applications_read` already lets a work manager read every Group
  they manage (`20260922224243_group_applications.sql:131-147`). Links into it: `/administrare?membru=<id>`
  (`PeriodsScreen.tsx:471`), back links (`GroupScreen.tsx:185,364`, `MemberScreen.tsx:136,188`,
  `PeriodsScreen.tsx:746`). The Administrare nav item is `exact` (`navItems.ts:85-90`); Campanii lives at
  `/administrare/campanii` under its own nav item.
- Gates (`my_capabilities()`, `20260922124817_my_capabilities_and_groups.sql:152`): `seeLeadership` level ≥ 5;
  `manageRoles`, `provisionMembers`, `createTopLevelGroups` level ≥ 6; `manageTasks` = `can_manage_tasks()`;
  `administer` = any Group Role or level ≥ 6. `set_org_setting` is level ≥ 6 as well.

## Decisions taken in this plan (reversible) and open points for Alex

- **D1 — where a board title lives (open, default chosen).** Default: the `position_title` of the Member's
  own **Responsible** row on the **Organization Group** (`groups.is_organization`). BC types it in
  Administrare → Grupuri → OSUBB → Roluri, the command that exists today. For a BC member this grants
  nothing new (level 6 already manages everything); for a BCE member it makes them a Responsible of the
  Organization Group, i.e. they may manage the Organization Group's own Tasks and Events. If Alex does not
  want that grant, the alternative is a dedicated Private Group "Biroul de Conducere" whose Responsibles
  carry the titles, found through a new org setting `board_group_id` — one small migration (seeded key,
  `set_org_setting` validation) plus the same frontend. No title set → the Role label ("BC", "BCE").
- **D2 — Responsabil / Coordonator below BCE on Acasă.** Alex's leadership rule replaces the work card for
  "BC / BCE / Responsabil / Coordonator". A Group Responsible below BCE is also an ordinary Executor with
  deadlines, so this plan gives them **both** cards in a 2 × 2 grid (Punctajul meu, De evaluat, Următorul
  task, Următorul eveniment) and replaces the work card only at level ≥ 5. One line to change if Alex wants
  the literal reading.
- **D3 — "Cereri" in Administrare** is the queue of pending **Group Applications** across the Groups the
  viewer manages (`group_applications`, already readable). Completed-work Requests keep their own page
  (`/cereri`).
- **D4 — Taskuri cards in a grid.** The collection grid (1 / 2 / 3 columns) replaces Taskurile mele's single
  column (`TaskCardGrid.tsx:35`). It is the one visible change on a page Alex did not name for redesign; it
  is what "one column grid" means there.

## 1. The shared layout system

New folder `app/src/components/layout/`. Everything is Tailwind utilities over the existing tokens; the
legacy classes (`.page`, `.page-head`, `.card`, `.card-head`, `.next-*`, `.hero-*`, `.dash-grid`) are
deleted as their last user moves.

| Primitive         | What it is                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Page`            | The frame: `<section aria-labelledby>` → `mx-auto w-full min-w-0 px-4 py-4 md:px-6 md:py-6`, width `wide` (default, `max-w-(--content-max)` = 1240 px) or `reading` (`max-w-3xl` = 768 px) for single-column text pages.                                                                                                                                                                        |
| `PageHeader`      | Eyebrow + `h1` + optional one-sentence description, actions on the right (stacked full-width under 640 px). `mb-6`.                                                                                                                                                                                                                                                                             |
| `PageTabs`        | Routed tabs: a `nav` of `NavLink`s with `aria-current="page"`, the Taskuri tab look. Sits right under `PageHeader`, `mb-6`. Exports `tabListClass` / `tabClass` so Taskuri's Base UI `Tabs` and the Group page's tablist use the same classes.                                                                                                                                                  |
| `SegmentedToggle` | Calendar's `aria-pressed` view toggle promoted to a component (`role="group"`, pill track, pressed segment in `--text` on `--surface`). Used by Calendar and Clasament.                                                                                                                                                                                                                         |
| `Section`         | A band of the page: optional `SectionHeader` (`h2`) + one `PageGrid`. `Section`s are `space-y-8` apart.                                                                                                                                                                                                                                                                                         |
| `PageGrid`        | `grid items-stretch gap-4 md:gap-6`, every child `h-full min-w-0`. `columns`: `1` · `2` (1 → 2 from `md`) · `3` (1 → 3 from `xl`, never 2 + 1) · `collection` (1 → 2 from `md` → 3 from `xl`, for lists of like items). Four panels use `columns={2}` (2 × 2).                                                                                                                                  |
| `Panel`           | `<section aria-labelledby>` = `SectionHeader` (`h2`/`h3`) **above** one box `flex-1 rounded-md border border-border bg-card p-4 shadow-(--sh-sm)`; the section is `flex h-full flex-col` so boxes in a row share one height. `bare` drops the box for a child that is itself a card (`TaskCard`, `EventCard`).                                                                                  |
| `SectionHeader`   | One header, everywhere: eyebrow (11.5 px, 800, uppercase, `tracking-[0.08em]`, muted, led by a 16 px lucide icon in `--red-600`) over a title (19 px `--fs-lg`, 700) and an optional 13 px muted description; on the right an optional action — a red 14 px/700 link with `ArrowRight`, 44 px target — or a control. `min-h-11`, `mb-3`, so headers in a row line up with or without an action. |
| `ListRow`         | One list row: `min-h-14` (56 px), `px-3 py-2`, `gap-3`, `grid-cols-[2.5rem_minmax(0,1fr)_auto_auto]` (leading rank/avatar · body · value · action), value `tabular-nums` right-aligned; lists are `divide-y divide-(--border-soft)`; the viewer's own row `bg-primary/5 ring-1 ring-primary/30`.                                                                                                |
| `EmptyState`      | One empty state: centred, `py-8`, 14 px muted text, optional 20 px icon and one action button; inside a box it has no border, on its own (`bare`) a dashed border. `components/states` `Empty` renders it; `Loading` and `ErrorState` take the same `py-8` so a box never jumps height between states.                                                                                          |

**Fixed rules** (the numbers an implementer never re-decides):

- Gutter 16 px under `md` (768), 24 px from `md`; grid gap the same; panel padding 16 px at every width
  (the shadcn `Card` / `TaskCard` spacing, so an item card and a panel line up); panel radius `--r-md`
  (13 px) — `rounded-xl` (24 px) is not used for boxes any more.
- Vertical rhythm: page header → content 24 px; section → section 32 px; header → box 12 px.
- Type: page title 31 px / 24 px under 768, 800 (`.page-title` values); section and panel titles 19 px, 700;
  eyebrow 11.5 px, 800, uppercase. Nothing else is a heading size.
- Every page header has an eyebrow: `OSUBB` by default, the area for sub-areas (`OSUBB · Conducere`,
  `OSUBB · Administrare`), the date on Acasă. A panel's eyebrow names where its data lives — usually the
  page its action opens (`Taskuri`, `Calendar`, `Cont`).
- A panel never renders `null` inside a `PageGrid`: the page decides which panels exist before it renders
  the grid, and a panel shows `Loading` / `ErrorState` / `EmptyState` in its box. `RoleTimeline` and
  `PromotionProgress` lift their gates to the page.
- Columns at the app's breakpoints (Tailwind defaults; the sidebar appears at `lg` 1024): 375–767 one
  column; 768–1279 two for `columns={2 | collection}`, one for `columns={3}`; ≥ 1280 three.
- No horizontal page scroll at 375 px; a `PageTabs` bar wraps like Taskuri's.

**Adoption** — which blocks move onto the system, and in which issue:

| Screen (file)                                                            | Blocks moved                                                                                                                                                                                                                                    | Issue |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Taskuri (`tracker/TrackerScreen.tsx`)                                    | `Page` wide + `PageHeader` (eyebrow `OSUBB`, "Taskuri", `NewTaskControl` as action); tabs take `tabListClass`/`tabClass`; `TaskCardGrid` → `PageGrid collection` (D4); Work Filter box → `Panel` (eyebrow "Filtre"); empty/error → `EmptyState` | #821  |
| Campanii (`campaigns/CampaignsScreen.tsx`, `CampaignsPanel.tsx`)         | `Page` reading + `PageHeader`; the Group chooser and each campaign list → `Panel`; campaign rows → `ListRow`                                                                                                                                    | #821  |
| Calendar (`calendar/CalendarScreen.tsx`)                                 | `Page` wide + `PageHeader` (eyebrow "Calendar OSUBB" kept); `SegmentedToggle` replaces `.calendar-view-toggle`; filter box → `Panel`; month grid and agenda unchanged inside                                                                    | #821  |
| Anunțuri (`announcements/AnnouncementsScreen.tsx`)                       | `Page` reading + `PageHeader` (compose action); list keeps `AnnouncementCard`s in `PageGrid 1`; empty → `EmptyState`                                                                                                                            | #821  |
| Notificări (`notifications/NotificationsScreen.tsx`)                     | `Page` reading + `PageHeader` ("Marchează tot ca citit" as action); items → `ListRow` in one box                                                                                                                                                | #821  |
| Grupuri (`groups/GroupsScreen.tsx`, `MemberGroupScreen.tsx`)             | `Page` wide; Group cards → `PageGrid collection` of `Panel`s; the Group page's Coordonare / Evenimente viitoare → `PageGrid 2`                                                                                                                  | #821  |
| Voluntari (`volunteers/VolunteersScreen.tsx`)                            | `Page` wide + `PageHeader` (Filtrează as action); member cards → `PageGrid collection`; empty → `EmptyState`                                                                                                                                    | #821  |
| Cereri (`requests/CompletedWorkRequestScreen.tsx`)                       | `Page` reading + `PageHeader`; form and "Cererile mele" → `Panel`s; decision queue rows → `ListRow`                                                                                                                                             | #821  |
| Acasă (`dashboard/*`)                                                    | whole page (§2)                                                                                                                                                                                                                                 | #822  |
| Clasament (`leadership/LeadershipScreen.tsx`, `MemberTrackerScreen.tsx`) | whole page (§3); the member tracker page takes `Page` wide + `PageHeader` + `Panel`s                                                                                                                                                            | #823  |
| Profil (`profile/*`)                                                     | whole page (§4)                                                                                                                                                                                                                                 | #824  |
| Administrare (`administrare/*`)                                          | whole area (§5), including the Group, Member and Perioade pages and the Group page's tablist                                                                                                                                                    | #825  |

## 2. Acasă

**Concept.** Acasă answers "what do I do next" in one row of equal boxes. Members see their score, their
next Task and their next Event. Leadership (level ≥ 5) sees the oldest Task waiting for _their_
evaluation instead of a score, and the next Event; the leaderboard and the Cup leave Acasă for Clasament.
A Group Responsible or Coordonator below BCE keeps their score and next Task and gains the review card
(D2). No copy explains who sees what.

Desktop, Member below BCE (`columns={3}`):

```
 SÂMBĂTĂ, 27 SEPTEMBRIE 2026
 Salut, Ioana 👋

 ▍PUNCTAJ                    ▍TASKURI    Vezi în Taskuri →   ▍CALENDAR   Vezi în Calendar →
 Punctajul meu               Următorul task                  Următorul eveniment
 ┌─────────────────────────┐ ┌─────────────────────────────┐ ┌─────────────────────────────┐
 │                         │ │▌Imagine & PR · În lucru     │ │ vineri, 3 octombrie         │
 │  12 puncte              │ │ Postare Instagram gală      │ │▌Ședință departament         │
 │  ● Voluntar             │ │ Termen: 30 sept, 18:00      │ │ 18:00–19:30 · Sala 2        │
 │                         │ │ …                           │ │ [Vin] [Nu vin]              │
 └─────────────────────────┘ └─────────────────────────────┘ └─────────────────────────────┘
```

Desktop, BC / BCE (`columns={2}`):

```
 SÂMBĂTĂ, 27 SEPTEMBRIE 2026
 Salut, Cristina 👋

 ▍TASKURI                          Evaluează →   ▍CALENDAR                 Vezi în Calendar →
 De evaluat                                       Următorul eveniment
 3 taskuri așteaptă evaluarea ta
 ┌──────────────────────────────────────────┐   ┌──────────────────────────────────────────┐
 │▌Financiar · În verificare                │   │ luni, 29 septembrie                      │
 │ Raport cheltuieli septembrie             │   │▌Termen depunere deconturi                │
 │ Trimis spre evaluare: 22 sept            │   │ …                                        │
 └──────────────────────────────────────────┘   └──────────────────────────────────────────┘
```

Group Responsible / Coordonator below BCE (`columns={2}`, 2 × 2): row 1 Punctajul meu · De evaluat;
row 2 Următorul task · Următorul eveniment.

375 px (every case): one column in the same order, each header above its box.

```
 SÂMBĂTĂ, 27 SEPTEMBRIE 2026
 Salut, Cristina 👋
 ▍TASKURI            Evaluează →
 De evaluat
 3 taskuri așteaptă evaluarea ta
 ┌───────────────────────────────┐
 │ TaskCard                      │
 └───────────────────────────────┘
 ▍CALENDAR    Vezi în Calendar →
 Următorul eveniment
 ┌───────────────────────────────┐
 │ EventCard                     │
 └───────────────────────────────┘
```

**Copy** (exact):

- Greeting: `Salut, <Nickname> 👋` when `profiles.nickname` is set, else `Salut, <prenume> 👋`
  (`firstName(full_name)`, as today); eyebrow: the date (`formatLongDate`, first letter capitalised).
- Punctajul meu — eyebrow `Punctaj`, title `Punctajul meu`, body `<n> puncte` + the Role chip. No rank tile,
  no note.
- De evaluat — eyebrow `Taskuri`, title `De evaluat`, description `1 task așteaptă evaluarea ta` /
  `<n> taskuri așteaptă evaluarea ta`, action `Evaluează` → `/tracker?task=<id>`. Empty:
  `Niciun task nu așteaptă evaluarea ta.`
- Următorul task / Următorul eveniment — eyebrows `Taskuri` / `Calendar`, titles, links and empty texts as
  today (`NextTaskCard.tsx`, `NextEventCard.tsx`: `Vezi în Taskuri`, `Niciun task cu termen în lucru.`,
  `Vezi în Calendar`, `Niciun eveniment viitor pentru tine.`).

**Data.**

| Panel               | Read                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Greeting            | `useMyProfile()` (already selects `nickname`, `queries/profile.ts:63-66`).                                                                                                                                                                                                                                                                                                                                                                                     |
| Punctajul meu       | `useMyPoints()` + `useRoles()`; shown when level < 5 (`seeLeadership` false).                                                                                                                                                                                                                                                                                                                                                                                  |
| De evaluat          | **New client read `useAwaitingMyReview()`** in `queries/task-review.ts`: `useManagedTasks(manageTasks)` (same cache key as Taskuri's De gestionat) → rows with `status = 'in_review'` whose current Executor is not the viewer → ordered by the latest `submission.occurred_at` ascending, then `id` → the first for which `can_evaluate_task` is true (checked in order, stops at the first yes). Count = the candidates that pass. Shown when `manageTasks`. |
| Următorul task      | `useMyTasks()` + `nextOwnTask` (unchanged); shown below level 5.                                                                                                                                                                                                                                                                                                                                                                                               |
| Următorul eveniment | `useEventsInRange` + `nextRelevantEvent` (unchanged); everyone.                                                                                                                                                                                                                                                                                                                                                                                                |

**Also in this issue:** `/tracker?task=<id>` for a Task that is not in Taskurile mele but is in De gestionat
selects De gestionat and opens its details sheet (where the Evaluation control is) —
`TrackerScreen.tsx:104-125`. `LeaderboardCard.tsx`, `DeptCupCard.tsx` (its coloured bar row moves to
Clasament, §3), `MyPointsCard.tsx`'s rank branch, `useLeaderboard` / `useMyStanding` / `useDeptCup` and
their tests, and `theme/dashboard.css` are deleted. The backend views stay (a later cleanup, not this pass).

## 3. Clasament

**Concept.** One board at a time, full width. A segmented toggle **Clasament | Cupa Departamentelor** in the
page header's action slot (where Calendar keeps Agendă | Lună), directly above the Work Filter, chooses
the board; the choice is in the URL (`?vedere=cupa`; absent = Clasament) so Back and shared links keep it.
In the Cupa view the Work Filter hides Grup principal / Subgrup, because the Cup ignores them
(`withoutGroup`, `LeadershipScreen.tsx:209`) — which retires the hint that explained that. The Cup takes
Acasă's coloured-bar row (`DeptCupCard.tsx:56-106`).

Desktop:

```
 OSUBB · CONDUCERE
 Clasament                                      ( Clasament | Cupa Departamentelor )
 Punctele taskurilor, pe membri și pe departamente.

 ▍FILTRE
 ┌───────────────────────────────────────────────────────────────────────────────────┐
 │ Grup principal [ Toate grupurile ▾]  Subgrup [ … ▾]  Campanie [ Toate campaniile ▾] │
 │ De la [ zz.ll.aaaa ]  Până la [ zz.ll.aaaa ]                        [×] chips       │
 └───────────────────────────────────────────────────────────────────────────────────┘

 ▍CLASAMENT
 Clasamentul membrilor                                                      6 membri
 ┌───────────────────────────────────────────────────────────────────────────────────┐
 │  1  (AM) Anuța            [Educațional] +1                  24 pct.  Vezi trackerul › │
 │  2  (VC) Vlad             [Imagine & PR]                    19 pct.  Vezi trackerul › │
 │  5  (CȘ) Cristina  tu     [Financiar]                        8 pct.  Vezi trackerul › │
 └───────────────────────────────────────────────────────────────────────────────────┘
```

Cupa view (same header, filter without the two Group fields):

```
 ▍CUPA
 Cupa Departamentelor                                Toate campaniile · toată perioada
 ┌───────────────────────────────────────────────────────────────────────────────────┐
 │  EDU   Educațional     ██████████████████████████████████░░░░   26 pct.   8 membri │
 │  PR    Imagine & PR    ███████████████████████████░░░░░░░░░░░   21 pct.   5 membri │
 └───────────────────────────────────────────────────────────────────────────────────┘
```

375 px: the toggle is full width under the title (two equal segments, labels unchanged); rows keep rank ·
name · points and the chevron (the "Vezi trackerul" text hides, as today at `LeadershipScreen.tsx:114`);
Cup rows drop the member count under the bar (`dashboard.css:215-225` behaviour).

**Copy:** eyebrow `OSUBB · Conducere`; title `Clasament`; description `Punctele taskurilor, pe membri și
pe departamente.`; toggle `Clasament` / `Cupa Departamentelor` (`aria-label="Vizualizare"`); panel titles
`Clasamentul membrilor` (description `<n> membri`) and `Cupa Departamentelor` (description = `cupScope`,
`LeadershipScreen.tsx:181-200`); empty texts as today (`Nu există puncte pentru filtrele alese`,
`Nu există grupuri înscrise în Cupă.`); no Work Filter `hint` on this page. The member tracker page
(`/tracker/membru/:id`) keeps its copy and moves onto `Page` + `PageHeader` + `Panel`.

**Data:** `useLeadershipLeaderboard(params)` and `useLeadershipCup(withoutGroup(params))` as today, only the
visible one enabled; Group colour and short name for the Cup rows from `useGroups()`. `WorkFilterLevels`
(`lib/work-filter.ts:120`) gains `group?: boolean` so the Cupa view can hide the Group levels (URL keeps
them for the way back). No backend change.

## 4. Profil

**Concept.** Three rows of three equal panels. What changes for everyone: the email change moves into the
**Editează profilul** sheet (one place to edit yourself), and the page shows the address read-only in a
**Date de contact** panel next to the phone. What changes for BC/BCE (level ≥ 5): no Groups list; a
**Funcția în OSUBB** panel shows their board position title instead (D1).

Desktop, Member below BCE:

```
 OSUBB
 Profilul meu                                                        [☾ Temă întunecată]
 Informații personale, punctaj și setări de cont

 ▍CONT                      ▍PUNCTAJ                    ▍CONT              Editează →
 Identitate                 Punctaj personal            Date de contact
 ┌───────────────────────┐ ┌─────────────────────────┐ ┌────────────────────────────┐
 │ (IP) Ioana            │ │ 12 puncte               │ │ E-mail   ioana@…           │
 │ Ioana Popescu         │ │                         │ │ Telefon  07…               │
 │ ● Voluntar            │ │                         │ │ Vizibil doar pentru tine…  │
 │ Membru din 2025       │ │                         │ │                            │
 │ [✎ Editează profilul] │ │                         │ │                            │
 └───────────────────────┘ └─────────────────────────┘ └────────────────────────────┘
 ▍GRUPURI                   ▍PARCURS                    ▍PARCURS
 Grupurile mele             Parcursul organizațional    Promovare
 ┌───────────────────────┐ ┌─────────────────────────┐ ┌────────────────────────────┐
 │ ● Educațional  Membru │ │ timeline                │ │ PromotionProgress          │
 │ ● Echipa Recruți …    │ │                         │ │                            │
 │ Alătură-te unui grup  │ │                         │ │                            │
 └───────────────────────┘ └─────────────────────────┘ └────────────────────────────┘
 ▍SETĂRI                    ▍SETĂRI                     ▍SETĂRI
 Notificări pe acest disp.  Email zilnic                Confidențialitate
 ┌───────────────────────┐ ┌─────────────────────────┐ ┌────────────────────────────┐
```

Desktop, BC / BCE: row 1 is Identitate · **Funcția în OSUBB** · Date de contact; row 2 is Parcursul
organizațional alone (`columns={1}`); row 3 unchanged.

```
 ▍BIROUL DE CONDUCERE
 Funcția în OSUBB
 ┌─────────────────────────┐
 │ Președinte              │
 │ BC · OSUBB              │
 └─────────────────────────┘
```

375 px: one column in reading order — Identitate, Punctaj personal | Funcția în OSUBB, Date de contact,
Grupurile mele (below BCE), Parcursul organizațional, Promovare (when shown), Notificări, Email zilnic,
Confidențialitate. The theme button moves under the title, full width.

Editează profilul sheet (both widths):

```
 Editează profilul                                    [Închide]
 ─────────────────────────────────────────────────────────────
 Pseudonim / Telefon / Culoare avatar …   (existing form)
 [ Salvează modificările ]
 ─────────────────────────────────────────────────────────────
 Schimbă adresa de email
 Adresa actuală: ioana@…
 (Confirmare trimisă … — when pending)
 Adresa nouă [                      ]
 [ Schimbă adresa ]
```

**Copy:** panel titles `Identitate`, `Punctaj personal`, `Funcția în OSUBB`, `Date de contact`,
`Grupurile mele` (`Grupuri` at level ≥ 5 is gone), `Parcursul organizațional`, `Promovare`, `Notificări pe
acest dispozitiv`, `Email zilnic`, `Confidențialitate`; eyebrows `Cont`, `Punctaj`, `Biroul de Conducere`
(BC) / `Biroul de Conducere Extins` (BCE), `Grupuri`, `Parcurs`, `Setări`. Funcția body: the title, then
`<Role> · OSUBB`; with no title set: `<Role>` and `Funcția nu este setată încă.` The sheet's email section
heading is `Schimbă adresa de email`; its texts and button are `ChangeEmailSection`'s as today. Date de
contact rows `E-mail` / `Telefon`, with the existing phone note. The Adunarea Generală badge moves from the
Groups card to Identitate so BC/BCE keep it.

**Data:** all existing — `useMyProfile`, `useRoles`, `useMyPoints` (level ≤ 4), `useMyGroups()` (Groups
below BCE; `membershipRows` for the Organization Group's `position_title` at level ≥ 5, D1), the role
history and promotion reads (their `null` gates lifted to the page), push and digest hooks. No backend
change under D1's default.

## 5. Administrare

**Concept.** Administrare becomes an area with routed tabs in Taskuri's tab style; each tab is a page with
its own URL, its own header action and only its own panels. The viewer sees only the tabs their
capabilities allow; `/administrare` redirects to the first. The Group, Member and Group-Campaigns pages stay
sub-pages (back link, no tab bar).

| Tab (order as Alex listed) | Route                             | Gate                                | Content                                                                                                                                                                                             | Header action                           |
| -------------------------- | --------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Membri                     | `/administrare/membri`            | `manageRoles` or `provisionMembers` | Panel **Membri**: `DataTable` of `useAppointableMembers()` (MemberName, Rol, Status), search by name, row → `/administrare/membri/:id`; Panel **Import CSV** (`CsvImportPanel`, `provisionMembers`) | —                                       |
| Grupuri                    | `/administrare/grupuri`           | `administer`                        | Panel **Structura grupurilor** (`GroupTree`, BC/Moderator) or **Grupurile mele** (`MyGroupsTable`)                                                                                                  | `Creează Grup` (`createTopLevelGroups`) |
| Roluri                     | `/administrare/roluri`            | `manageRoles`                       | `RolePanel` (keeps `?membru=<id>`); its two inner boxes → `PageGrid 2`                                                                                                                              | —                                       |
| Cereri                     | `/administrare/cereri`            | `administer`                        | Panel **Cereri de aderare**: pending Group Applications of every Group the viewer manages (D3), `ListRow`s with Acceptă / Respinge                                                                  | —                                       |
| Perioade                   | `/administrare/perioade`          | `manageRoles`                       | `PageGrid 2`: Perioada curentă · Prag de promovare; `PageGrid 1`: Semnale de retenție                                                                                                               | —                                       |
| Confidențialitate          | `/administrare/confidentialitate` | `manageRoles`                       | `PrivacyPanel`                                                                                                                                                                                      | —                                       |
| Setări                     | `/administrare/setari`            | `manageRoles`                       | `PageGrid 2`: Formular de adeziune · Adunarea Generală (moved out of Perioade, `PeriodsScreen.tsx:789-806`)                                                                                         | —                                       |

Desktop (BC):

```
 OSUBB · ADMINISTRARE
 Administrare                                                           [ Creează Grup ]
 Grupurile OSUBB, membrii, rolurile și setările organizației.
 [Membri] [▇Grupuri▇] [Roluri] [Cereri] [Perioade] [Confidențialitate] [Setări]

 ▍GRUPURI                                                        12 grupuri  [Extinde tot]
 Structura grupurilor
 ┌───────────────────────────────────────────────────────────────────────────────────┐
 │ ▸ Educațional          Departament   Activ   Nivel minim 0                            │
 │ ▸ Diverse              Departament   Activ   …                                        │
 └───────────────────────────────────────────────────────────────────────────────────┘
```

A Group Manager sees two tabs, `[Grupuri] [Cereri]`, and the description `Grupurile pe care le coordonezi.`

375 px: the tab bar wraps (three lines for BC, one for a Manager), no horizontal scroll; tables keep
`DataTable`'s own narrow layout; the header action goes full width under the description.

**Copy:** eyebrow `OSUBB · Administrare`; title `Administrare`; description `Grupurile OSUBB, membrii,
rolurile și setările organizației.` (level ≥ 6) / `Grupurile pe care le coordonezi.`; tab labels as the
table; `aria-label="Secțiunile administrării"`; Cereri empty `Nicio cerere de aderare în așteptare.`; Membri
empty `Niciun membru găsit.`; every existing panel keeps its own copy (its `h2` becomes the `SectionHeader`
title). The Perioade page's "Înapoi la Administrare" link goes (the tab bar replaces it).

**Ruling R28 (2026-09-27):** the Perioade tab becomes **Evaluări** (Role Evaluations over a chosen date range, the two Praguri, the Promotion Candidates list and the Retention Signals); its route and panels follow that ruling's issues.

**Data:** existing reads, plus **one new client read** `useManagedGroupApplications()` in
`queries/group-applications.ts`: `group_applications` with `status = 'pending'` and no Group filter, minus
the viewer's own rows — RLS returns exactly the Groups they may decide on — with the applicant identities
and Group names as `fetchGroupApplications` builds them; decisions through the existing
`useApplicationCommand()`. No backend change.

**Routing and links:** an `AdministrareLayout` route (`PageHeader` + `PageTabs` + `<Outlet/>`), each tab its
own lazy route with `RequireCapability`; `/administrare` → first allowed tab. `PeriodsScreen.tsx:471` links
to `/administrare/roluri?membru=<id>`; back links (`GroupScreen.tsx:185,364` → `/administrare/grupuri`,
`MemberScreen.tsx:136,188` → `/administrare/membri`); the Administrare nav item stays active on its tab
routes but not on `/administrare/campanii` or `/administrare/grupuri/:id/campanii` (Campanii's own item) —
replace `exact` with an explicit prefix list in `navItems.ts`. The Group page's tablist
(`GroupScreen.tsx:234-263`) takes `tabListClass`/`tabClass`.

## Issues

Filed 2026-09-27, all `wave-5`, milestone "Wave 5 — Pages and production readiness":

| Issue | Scope                                          | Labels                                    | Blocked by |
| ----- | ---------------------------------------------- | ----------------------------------------- | ---------- |
| #821  | Layout system + adoption on eight screens (§1) | `wave-5`, `shared`, `frontend`            | —          |
| #822  | Acasă (§2)                                     | `wave-5`, `page-acasa`, `frontend`        | #821       |
| #823  | Clasament (§3)                                 | `wave-5`, `page-clasament`, `frontend`    | #821       |
| #824  | Profil (§4)                                    | `wave-5`, `page-profil`, `frontend`       | #821       |
| #825  | Administrare tabs (§5)                         | `wave-5`, `page-administrare`, `frontend` | #821       |

Standing rules for all five: `CONTEXT.md` vocabulary; Romanian copy exactly as above; `MemberName` /
`MemberCard` for every name; the constraints kit for forms; Vitest in the same PR; screenshots in the PR
body under `docs/pr-assets/issue-<n>/` (desktop + 375 px, light and dark); merge when green after
CodeRabbit.
