# `app/` — the OSUBB frontend

React + TypeScript + Ionic, built by Vite. This is the app members will actually
open; the backend it talks to lives one directory up, in `supabase/`.

**Before your first screen issue, read
[`docs/superpowers/specs/frontend-mini-spec.md`](../docs/superpowers/specs/frontend-mini-spec.md)** —
folder layout, routes, query conventions and theming are already decided there,
so screen PRs look alike and nobody invents a second architecture.

## The three commands

```bash
npm install     # once, after cloning
npm run dev     # http://localhost:5173, hot-reloads as you edit
npm run build   # typecheck + production build (what CI runs)
```

Also available: `npm run lint` (oxlint), `npm run format` (Prettier, writes),
`npm run format:check` (Prettier, reports), `npm run typecheck`, `npm run preview`
(serve the built output).

Before pushing, the same three that CI runs: `npm run typecheck && npm run lint && npm run build`.

## What's here so far

```
app/
├── index.html            # <html lang="ro">, Montserrat, no-flash theme script
├── public/icon.png       # OSUBB mark (favicon)
└── src/
    ├── main.tsx          # bootstrap: Ionic CSS, our theme, AuthProvider
    ├── App.tsx           # routes + the session and capability guards
    ├── lib/
    │   ├── supabase.ts     # the one shared client, env-driven
    │   ├── auth.tsx        # session + decoded claims, useAuth()
    │   └── capabilities.ts # level thresholds, named as the database names them
    │   └── format.ts       # dates, points, initials — Romanian locale
    ├── queries/
    │   ├── client.ts       # QueryClient defaults; a refusal is not retried
    │   ├── keys.ts         # the key conventions — read this before adding a hook
    │   ├── points.ts       # useMyPoints, useLeaderboard, useDeptCup
    │   └── tasks.ts        # useMyTasks, useOpenTasks
    ├── components/
    │   ├── shell/          # sidebar, topbar, tab bar — one list drives all three
    │   └── states/         # Loading, Empty, ErrorState — every query renders all three
    ├── screens/
    │   ├── Placeholder.tsx # stands in for a screen; says which issue builds it
    │   ├── dashboard/      # points + leaderboard (plain; #93–#95 design it)
    │   ├── tracker/        # my tasks (plain; #88–#92 build the real one)
    │   ├── login/          # magic-link request + the /auth/callback landing
    │   └── no-profile/     # signed in, not a member (ADR-0003 gate 2)
    └── theme/
        ├── tokens.css       # Brand Book palette, copied from mockup/css/tokens.css
        ├── global.css       # maps those tokens onto Ionic's --ion-* variables
        ├── auth-screens.css # the card the three pre-app screens share
        ├── shell.css        # the app frame, lifted from mockup/css/layout.css
        └── screens.css      # cards, query states, the two lists
```

Each screen gets its own folder under `screens/` when there is something real
to put in it.

## Adding a query

Read `src/queries/keys.ts` first — the two rules there (keys mirror the data,
most general segment first) are what make one invalidation refresh everything
that should change. Then copy the shape of `points.ts`:

```tsx
const tasks = useMyTasks();

if (tasks.isPending) return <Loading />;
if (tasks.isError)
  return <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />;
if (tasks.data.length === 0)
  return <Empty text="Nu ai niciun task asignat acum." />;
```

All three states, every time — an empty list is not an error and must say
something a member can act on. Never filter by department, team or role in the
hook: RLS already returned exactly the rows this member may see, and a second
copy of that rule in TypeScript is a weaker one.

## Routes

| Path             | Who reaches it                                                                    | Screen                   |
| ---------------- | --------------------------------------------------------------------------------- | ------------------------ |
| `/login`         | signed out                                                                        | magic-link request       |
| `/auth/callback` | anyone — its job is turning a link into a session, so it runs before there is one | —                        |
| `/no-profile`    | signed in without org claims                                                      | ADR-0003 gate 2          |
| `/`              | members                                                                           | dashboard (#93–#95)      |
| `/tracker`       | members                                                                           | task tracker (#88–#92)   |
| `/calendar`      | members                                                                           | calendar (#96–#98)       |
| `/anunturi`      | members                                                                           | announcements (#99–#101) |
| `/voluntari`     | level >= 5                                                                        | directory (#102–#103)    |
| `/profil`        | members                                                                           | profile (#108)           |
| `/bc`            | level >= 6                                                                        | BC panel (#104–#107)     |

Everything unknown redirects to `/`, where the guard decides.

The guards, and the nav items a role does not see, are **navigation, not
security**: the database returns nothing to a session that may not see it,
whatever the URL says. Someone who types `/bc` by hand gets the screen and no
data. What the guards buy is that a member sees an explanation, or a tab they
can actually use, instead of an app that is silently empty.

## Conventions worth knowing on day one

- **The database decides who sees what.** Queries return exactly the rows the
  signed-in member may see, because RLS says so. Never re-implement a permission
  rule in TypeScript; role checks in the UI are only for hiding a tab or
  disabling a button (mini-spec §1).
- **Use the tokens, never a raw hex.** `var(--red)`, `var(--s-4)`,
  `var(--fs-md)`. Department colours come from the `departments` table, so a new
  department needs no code change.
- **`tokens.css` is a copy, not a fork.** If the palette changes, it changes in
  `mockup/css/tokens.css` first and gets copied across, so the prototype and the
  app never drift. Prettier is told to leave the file alone for the same reason.
- **User-facing text is Romanian; identifiers stay English.** `CONTEXT.md` has
  the vocabulary.

## Tooling notes

- **oxlint, not ESLint.** It is what `create-vite` ships as the default now, it
  runs in milliseconds, and it carries the React Hooks rules that actually catch
  beginner mistakes (`rules-of-hooks`, `exhaustive-deps` — both errors here).
  Prettier does the formatting.
- **The dev server port is pinned** (`strictPort: true`, 5173). Magic links only
  return to an origin on GoTrue's allow-list, and 5174 is not on it — so letting
  Vite quietly move to the next free port would produce a sign-in that fails for
  a reason nothing on screen explains. Better to be told the port is busy.
- **Routing uses `react-router` 7.18.2 directly.** The app uses declarative
  `BrowserRouter` routing and retains Ionic as its component layer, without the
  `@ionic/react-router` compatibility wrapper. `npm audit` has no router
  advisories at this version.
