# OSUBB App — Mockup Design Spec

**Date:** 2026-06-28
**Author:** Alex Băncilă (Coordonator IT, candidat 2026–2027), with Claude
**Status:** Approved direction → prototype build

## 1. Purpose

A clickable, brand-accurate prototype of the **OSUBB application** (Organizația
Studenților din Universitatea Babeș-Bolyai) to present the IT mandate's vision and,
specifically, the **end-of-summer 2026 deliverables**. It demonstrates how the
organization's internal processes (tasks, points, calendar, announcements,
volunteers, recruitment) become a single digital product.

Source documents:

- `Plan managerial Coordonator IT Băncilă Alex.pdf` — full vision.
- `02. Direcții și priorități IT [Coord. IT 2026-2027].pdf` — summer scope (the MVP).
- `BRAND BOOK OSUBB 2025.pdf` — visual identity.

## 2. Decisions (locked)

| Decision    | Choice                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------- |
| Form factor | **Responsive web** (phone → desktop, one design)                                          |
| Scope       | **Summer priorities (6 areas) + signature vision touches** (gamification, HR recruitment) |
| Deliverable | **Clickable HTML prototype** (`mockup/index.html`), no build step                         |
| Language    | Romanian, informal 2nd-person tone (per brand book)                                       |
| Brand       | Master **red `#ED2025`** + black + white; department colors as accent tags; Montserrat    |
| Logo        | Authentic OSUBB logo extracted from the brand book (light + dark variants)                |

## 3. Visual system

- **Colors:** `#ED2025` (brand/action), `#000`, `#fff`, plus neutral ramp for hierarchy.
  Department accents (brand book): Educațional `#284C93`, Resurse Umane `#F2A700`,
  Financiar `#007F33`, Imagine&PR `#7500A0`, Tineret `#FF3B3B`, IT/general `#ED2025`.
  **Critical alerts = red pop-ups** (priorities §3.7).
- **Type:** Montserrat (Google Fonts + system fallback). Extrabold headings.
- **Direction:** "Clean dashboard, OSUBB personality" — white surfaces, red accents,
  left sidebar (desktop) / bottom tab bar (mobile).

## 4. Screens

1. **Login** — branded hero + role-aware demo sign-in.
2. **Dashboard (Acasă)** — greeting, gamified tier progress, points/rank stats,
   upcoming week, my tasks, announcements, mini-leaderboard. _(priorities §2.2)_
3. **Task Tracker** — sortable/filterable table; scoring legend; task templates;
   teams/groups; task request; personal sheet; AG-threshold sheet. _(§1)_
4. **Calendar** — June 2026 month grid, color-coded by dept; join activities;
   call types; overlap detection; "Evenimente viitoare". _(§3)_
5. **Anunțuri** — feed with priority styling; critical red pop-ups; active forms/calls;
   compose (BC/responsabil). _(§4)_
6. **Bază de date voluntari** — HR-style searchable directory. _(§5)_
7. **Recrutare** — applicant pipeline, interview scheduling, auto-scored interview grid,
   dept selection, accept/reject + notify. _(vision §4 Resurse umane)_
8. **Profil / Gamification** — tier, rank message, benefits, **Cupa departamentelor**,
   leaderboard, teams, calendar integrations. _(§2.2 + §8)_
9. **Panou BC** — task requests, award points / sanctions (→ notification),
   export report, role management, quick actions. _(§6)_
10. **Notificări** — center + red critical pop-ups, per-type preferences ("doar taskurile mele").

- **Role switcher** (topbar): preview the app as Recrut / Voluntar / Voluntar activ /
  Drept de vot / Responsabil / BC, with role-based nav access.

## 5. Architecture (no build step)

```
mockup/
  index.html            app shell + login + script wiring
  assets/               authentic OSUBB logos (light/dark/icon, transparent PNG)
  css/  tokens · base · components · layout   (single shared design system)
  js/   data · icons · state · router · app   (global OSUBB namespace, classic scripts)
  js/views/<screen>.js  one self-registering view per screen
```

- Views register via `OSUBB.registerView(id, { label, icon, render(ctx), mount(root,ctx) })`.
- Router builds nav from registered views filtered by `OSUBB.access` (role permissions),
  swaps the `#view` container, and re-renders on role change.
- All content is mock data in `js/data.js` (anchored to "today" = 28 June 2026).
- The shared `css/components.css` is the visual contract; each view composes documented
  classes only (so screens stay consistent and the build could be parallelized).

## 6. How to run

Open `mockup/index.html` in a browser. Any email/password signs in; switch roles from
the top bar to see role-based access. (For Chrome `file://` font/asset quirks, optionally
serve it: `python -m http.server` inside `mockup/`.)

## 7. Out of scope (prototype)

Real backend/auth/database, Google/Outlook calendar sync, QR scanning, push delivery —
represented visually but not wired to live services. The prototype is for presentation and
to anchor the implementation plan for the summer build.

## Revizia 2 (2026-06-29)

- **Login:** centered card, no app description, logo on top, **Continuă cu Google** option.
- **Scoring:** task points = **difficulty (1–5 ★, 1pt/star) × rating multiplier**
  (rating 1→×−1, 2→×0, 3→×1, 4→×2, 5→×3). Points can be negative/zero. The **Ghid de
  punctare** opens from inside _Task nou_ and _Acordă puncte_ (and a header button).
- **Roles (8):** Recrut · Voluntar · Membru Activ · Membru cu Drept de Vot ·
  Responsabil de proiect · BCE · BC · Moderator. Promotions: Recrut→Voluntar after 6 months;
  →Membru Activ if top 35% after a semester; Drept de vot retained only for top 25% each AGO.
  BC see all _Fișele Voluntarului_; BC receive **no** task/event notifications. Moderator = single
  full-access account. Governance: AG elects BC (Moderator updates, BC can too); BC names BCE +
  Responsabili de proiect.
- **Departments (5):** Educational, Imagine&PR, Tineret, Financiar, Resurse Umane.
  **IT is a team** (Coordonator IT, BCE), not a department.
- **Task Tracker visibility:** volunteers see only their own _Fișă_ (+ available/first-taker tasks)
  and leaderboard/gamification; managers (Responsabil/BCE/BC/Moderator) create tasks & award points;
  BC/Moderator also get _Fișele voluntarilor_ + _Pentru Interne_ (two auto sheets: AG threshold +
  AG members with points, for VP Interne & Echipa Interne).
- **Calendar:** role-filtered (members see only events they can access; managers see all to avoid
  overlaps, with the change/overlap popup).
- **Recrutare** is a calendar **event** (not a nav screen); accepted recruits get auto-generated
  accounts from a CSV (random passwords) via _Importă recruți_ in Panou BC.
- Alignment/responsive polish throughout.
