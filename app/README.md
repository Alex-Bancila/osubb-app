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
    ├── App.tsx           # routes + the three session guards
    ├── lib/
    │   ├── supabase.ts   # the one shared client, env-driven
    │   └── auth.tsx      # session + decoded claims, useAuth()
    ├── screens/
    │   ├── login/        # magic-link request + the /auth/callback landing
    │   ├── no-profile/   # signed in, not a member (ADR-0003 gate 2)
    │   └── home/         # placeholder dashboard — the real shell is #84
    └── theme/
        ├── tokens.css       # Brand Book palette, copied from mockup/css/tokens.css
        ├── global.css       # maps those tokens onto Ionic's --ion-* variables
        └── auth-screens.css # the card the three pre-app screens share
```

`src/queries/` and `src/components/` don't exist yet on purpose — each arrives
with the issue that first needs it, in the shape the mini-spec §2 describes.

## Routes so far

| Path             | Who reaches it                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `/login`         | signed out. Signed-in visitors are sent home (or to `/no-profile`).                      |
| `/auth/callback` | anyone — its job is to turn a magic link into a session, so it runs before there is one. |
| `/no-profile`    | signed in without org claims.                                                            |
| `/`              | members. Everything unknown redirects here and the guard decides.                        |

The guards are **navigation, not security**: the database returns nothing to a
session without claims whatever the URL says. What they buy is that someone in
that position sees an explanation rather than an app that is silently empty.

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
- **`npm audit` reports two moderate advisories in `react-router` 6.** They are
  real and they do not apply to us, so please don't "fix" them by force:
  - _Arbitrary constructor injection in `deserializeErrors()`_ — server-side
    rendering only. We are a pure SPA; the code path does not exist here.
  - _Open redirect via backslash in `<Link>`/`useNavigate`_ — needs a navigation
    target the user controls. Every destination in this app is a literal, and
    `App.tsx` deliberately carries no "return to the page you wanted" through
    the URL, so there is nothing to aim.

  The fix is `react-router` 8, which `@ionic/react-router` 9 does not support
  (it pins `>=6.4 <7`). We take Ionic's navigation — the thing ADR-0002 chose
  Ionic for, and what makes tabs and native transitions work — and revisit when
  Ionic supports a newer router.
