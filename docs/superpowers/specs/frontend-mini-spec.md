# Frontend mini-spec

> **Historical** — superseded by [ADR-0002](../../adr/0002-frontend-browser-pwa.md) for the stack (Tailwind + shadcn, not Ionic/AG Grid); folder layout, routing, and data-layer rules still apply.
>
> Kept for provenance; where it conflicts with `CLAUDE.md`, `CONTEXT.md`, or the ADRs, those win.

**Status:** proposed (issue #79) · **Stack fixed by:** ADR-0002 · **Visual authority:** OSUBB Brand Book 2025 ([app reference](../../brand/reference.md))

> **Partly superseded (2026-09-07/10):** ADR-0002 now fixes Tailwind + shadcn/ui (Base UI, Nova) + TanStack Table in a browser-first PWA. The Ionic and AG Grid guidance in §2 (`DataGrid.tsx`) and §7, and the PWA timing in §9, are historical. Folder layout, routes, auth, data layer and theming rules still apply.

ADR-0002 chose the stack. This fixes _how we use it_, so that every screen PR looks the same, two volunteers don't invent two architectures, and an Epic-9 issue can say "per §4 of the mini-spec" instead of re-deciding.

Before frontend work, read the [OSUBB brand reference](../../brand/reference.md).

### Source hierarchy

1. The official **OSUBB Brand Book 2025** decides visual identity; the [brand reference](../../brand/reference.md) translates it into app guidance.
2. `CONTEXT.md`, accepted ADRs, and the server's capability model decide domain meaning, permissions, and behavior. Colour or a prototype never grants authority. ADR-0009 makes Task management a Group Role decision; the historical level-4 example in §4 is not current guidance.
3. This mini-spec supplies folder, route, and query conventions where they agree with those sources.
4. `mockup/` is historical inspiration for exploring layouts and flows, never a requirement to copy its tokens, assets, or screens.

Design frequent Member actions for mobile: readable cards, concise labels, and reachable controls. Give coordinators a desktop layout for comparing and managing many rows, with TanStack Table and shadcn controls under ADR-0002. Both layouts must preserve the same server-authorized actions, keyboard access, and accessible feedback; neither device changes permissions.

Read this once before your first frontend issue. It is deliberately short; where it doesn't say, copy the nearest existing screen.

---

## 1. The one rule that outranks the rest

**The database decides who sees what. The UI only decides what's worth drawing.**

Every table is protected by RLS keyed on the member's JWT claims. A query for tasks returns exactly the tasks that member may see — the frontend does not filter by department, does not check levels before fetching, and never re-implements a policy in TypeScript.

Role checks in the UI exist for **cosmetics and kindness**: hiding a tab nobody can use, disabling a button that would fail. They are never the security boundary. If you find yourself writing `if (role === 'bc')` around _data_, stop — that logic belongs in a policy, and probably already exists.

Practical consequence: a screen built against the demo seed shows different data for `voluntar@demo.osubb` and `bc@demo.osubb` **with no conditional code at all**. That's the intended feel.

## 2. Folder structure

```
app/
├── index.html
├── vite.config.ts
├── src/
│   ├── main.tsx                 # bootstrap: providers, router, Ionic setup
│   ├── App.tsx                  # shell + routes
│   ├── lib/
│   │   ├── supabase.ts          # the client (env-driven), typed with Database
│   │   ├── database.types.ts    # GENERATED — never edit by hand (§5)
│   │   ├── auth.tsx             # session + claims context, useAuth()
│   │   └── format.ts            # dates, points, initials — Romanian locale
│   ├── queries/                 # one file per domain: tasks.ts, points.ts, …
│   ├── components/              # shared, screen-agnostic
│   │   ├── DeptChip.tsx  RoleBadge.tsx  PointsPill.tsx
│   │   ├── DataGrid.tsx         # historical — ADR-0002 uses TanStack Table + shadcn Table instead
│   │   └── states/              # Loading, Empty, ErrorState
│   ├── screens/                 # one folder per route (§3)
│   │   └── tracker/ dashboard/ calendar/ announcements/ volunteers/ bcpanel/ profile/
│   └── theme/
│       ├── tokens.css           # app tokens verified against the Brand Book (§6)
│       └── global.css
└── package.json
```

Rules: a component used by one screen lives in that screen's folder. It moves to `components/` the second time it's needed, not before. No `utils.ts` grab-bag — name the file after what it does.

## 3. Routes

| Path             | Screen                                      | Who                  | Issue     |
| ---------------- | ------------------------------------------- | -------------------- | --------- |
| `/login`         | magic-link request + "check your email"     | signed out           | #83       |
| `/auth/callback` | completes the session from the link         | —                    | #83       |
| `/no-profile`    | "contul tău nu este activ — contactează BC" | signed in, no claims | #85       |
| `/`              | Dashboard                                   | everyone             | #93–#95   |
| `/tracker`       | Task Tracker                                | everyone             | #88–#92   |
| `/calendar`      | Calendar                                    | everyone             | #96–#98   |
| `/anunturi`      | Announcements + notifications               | everyone             | #99–#101  |
| `/voluntari`     | Volunteers directory                        | level ≥ 5            | #102–#103 |
| `/bc`            | BC Panel                                    | level ≥ 6            | #104–#107 |
| `/profil`        | Profile                                     | everyone             | #108      |

Paths are Romanian because members read them; code identifiers stay English (`CONTEXT.md` rule).

**Navigation order** (route convention, independent of the historical mockup): sidebar `dashboard · tracker · calendar · anunturi · voluntari · profil · bc`; mobile tab bar shows five — `dashboard · calendar · tracker · anunturi · profil`.

**Three session states**, and every one of them is a real screen (#85):
signed out → `/login` · signed in **without claims** → `/no-profile` · signed in with claims → the app. The middle one is not an error; it's ADR-0003 working, and it must look intentional.

## 4. Auth and claims

`useAuth()` (from `lib/auth.tsx`) is the only place that reads the session:

```ts
const { session, claims, loading, signOut } = useAuth();
// claims: { member_role, member_level, dept_ids, team_ids } | null
```

Claims are decoded **once** from the access token's `app_metadata`. Do not call the database to find out who you are — the token already says, which is the entire point of the JWT-claims design.

Gate navigation on `claims.member_level`, using the same thresholds as the backend (`role_capabilities`, spec §4.1): `manageTasks` and `seeAllEvents` ≥ 4, `createTeams` ≥ 5, `seeInterne`/`manageRoles` ≥ 6. Prefer a named helper over a bare number:

```ts
const canManageTasks = (claims?.member_level ?? 0) >= 4;
```

`claims === null` while signed in means **no membership** — route to `/no-profile`, never to an empty dashboard.

## 5. Data layer

**Types are generated, never written.** `npm run gen:types` writes `lib/database.types.ts`; the client is `createClient<Database>(…)`. A renamed column then breaks the build instead of the demo.

**Query keys** are arrays, most general first, and mirror the data — not the screen:

```ts
["tasks", "mine"][("tasks", "open")][("tasks", { dept: "edu" })][
  ("points", "me")
][("points", "leaderboard")][("points", "deptCup")][("events", "upcoming")][
  ("announcements", "feed")
][("notifications", "unread")];
```

Two screens showing the same data share a key and therefore share a cache entry. After a mutation, invalidate the **prefix** (`['points']`), not each leaf.

**Read from views where one exists** — `leaderboard`, `dept_cup`, `member_points`, `profiles_directory`, `profiles_contact`. They already carry the right joins and the right permissions.

⚠️ **Never `select('*')` on `profiles`.** Members hold column grants, not a table grant: `email` and `phone` are revoked, so `*` fails with _permission denied for column email_. Use `profiles_directory` for lists and `profiles_contact` when you actually need contact details (it returns your own row, or everyone's at level ≥ 5).

**Every query renders three states** — loading, error, empty — using `components/states/`. An empty list is not an error and must say something useful in Romanian ("Niciun task deschis acum"). Errors are human, never a raw Postgres string:

```tsx
if (isLoading) return <Loading />;
if (error) return <ErrorState onRetry={refetch} />;
if (!data?.length) return <Empty text="Niciun task deschis acum" />;
```

**Writes** are `useMutation` + invalidate. Expect RLS to say no — a claim that lost a race, a task someone else took — and show a toast, not a crash. A denial is `42501` or an update that quietly affects zero rows; treat both as "asta nu se mai poate face acum" and refetch.

## 6. Theming

Maintain `src/theme/tokens.css` against the [brand reference](../../brand/reference.md) and the official Brand Book. The existing tokens originated in the prototype, but copying `mockup/css/tokens.css` is not a validation step: verify each identity value against the authoritative source.

- OSUBB red, black, and white define the brand; the reference lists the approved Department accents.
- Montserrat and approved logo variants follow the Brand Book; verify provenance before reusing a prototype asset.
- Spacing, radii, shadows, semantic feedback, and light/dark interaction states are app decisions constrained by accessibility, rather than Brand Book claims.
- Pair Department colours and semantic states with labels; colour never communicates a Role or permission.
  Use the tokens; do not introduce raw hex in a component. Department colours come from the `departments` table (`color`), so a new department needs no code change — `<DeptChip deptId="edu" />` looks it up.

Dark mode is a client-side toggle on `data-theme`, persisted in `localStorage`, defaulting to the system preference.

## 7. Components

> **Superseded by ADR-0002:** new screens use shadcn/ui (Base UI, Nova) with Tailwind; dense tables use TanStack Table with shadcn markup. Do not add Ionic or AG Grid to new work. The paragraphs below describe the transitional code only.

**Ionic** provides the shell, navigation, modals and form controls — use `IonPage`/`IonContent` per screen so mobile gestures and safe areas work. Don't hand-roll a modal.

**AG Grid Community** is for the two dense tables only: the tracker and the volunteers directory. Everything else is a list of cards. Wrap it once in `components/DataGrid.tsx` (theme, locale, empty message, sizing) so a change lands in one place.

**Romanian, ordinary, and specific** in all user-facing copy. Buttons say what happens: _Revendică_, _Notează_, _Trimite invitația_. Numbers use `ro-RO` formatting; a negative points value shows as `−6`, not `-6`.

## 8. Definition of done for a screen

- reads through a hook in `queries/`, with all three states handled
- no permission logic beyond nav gating (§1)
- verified by logging in as **at least two** demo roles and seeing different data
- `npm run typecheck && npm run lint && npm run build` clean — CI runs these (#81)
- follows the Brand Book/reference, domain vocabulary, and server capabilities; checks mobile Member and desktop coordinator layouts without requiring mockup fidelity

## 9. Open, deliberately

- **Component tests.** Not set up yet; the backend carries the safety net for now. Revisit once screens stabilise — a test that asserts a mocked query renders is mostly testing the mock.
- **Realtime.** Spec §6 limits it to the leaderboard and critical announcements. Ship polling first; add Realtime when it visibly helps.
- **Offline / PWA install.** ADR-0005 says PWA-first, but the service worker lands with launch prep (#109–#110), not with the first screen.
