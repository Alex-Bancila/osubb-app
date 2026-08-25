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
    ├── main.tsx          # bootstrap: Ionic CSS, our theme, setupIonicReact()
    ├── App.tsx           # placeholder shell — replaced by the real one in #84
    └── theme/
        ├── tokens.css    # Brand Book palette, copied from mockup/css/tokens.css
        └── global.css    # maps those tokens onto Ionic's --ion-* variables
```

`src/lib/`, `src/queries/`, `src/components/` and `src/screens/` don't exist yet
on purpose — each arrives with the issue that first needs it (#82 onwards), in
the shape the mini-spec §2 describes.

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
- **No router yet.** `react-router` and Ionic's `IonReactRouter` arrive with the
  app shell (#84), which is where the route map gets built. Installing them now
  would be an unused dependency.
