# `app/` — the OSUBB frontend

React + TypeScript, built by Vite. This is the app members will actually
open; the backend it talks to lives one directory up, in `supabase/`.

ADR-0002 fixes the stack as Tailwind + shadcn/ui (Base UI, Nova style) +
TanStack Table in a browser-first, installable PWA. The route-by-route migration
off Ionic finished with the Profil rebuild (#699): no screen imports it and the
dependency is gone. AG Grid is not used.

The Tailwind v4 and shadcn Base UI/Nova foundation is installed. Add shared UI
through `src/components/ui/` and use shadcn for all new work.

Use Node.js 24 or newer—the frontend and its test tooling are developed and
verified on Node 24, matching GitHub Actions.

**Before your first screen issue, read ADR-0002 and
[`docs/superpowers/specs/frontend-mini-spec.md`](../docs/superpowers/specs/frontend-mini-spec.md)** —
folder layout, routes, query conventions and theming are decided there, so
screen PRs look alike and nobody invents a second architecture. The mini-spec's
component choices (Ionic, AG Grid) are superseded by ADR-0002. The
[Brand Book reference](../docs/brand/reference.md) governs visual identity;
CONTEXT.md and accepted ADRs govern domain meaning and capabilities. The mockup
is historical inspiration only. Design frequent Member actions for mobile and
dense coordinator work for desktop, with accessible controls in both layouts.

## The main commands

```bash
npm install     # once, after cloning
npm run dev     # http://localhost:5173, hot-reloads as you edit
npm test        # Vitest watch mode while you code
npm run test:run  # run the test suite once, like CI
npm run build   # typecheck + production build (what CI runs)
```

Also available: `npm run lint` (oxlint), `npm run format` (Prettier, writes),
`npm run format:check` (Prettier, reports), `npm run typecheck`, and
`npm run preview` (serve the built output).

Before pushing, run the same gates as CI: typecheck, lint, format check,
`npm run test:run`, and the production build.

Tests use Vitest with jsdom and React Testing Library. Put a component test next
to the component as `*.test.tsx`; shared browser-test setup lives in
`src/test/setup.ts`. Test user-visible behavior through roles, labels, and text,
not private component state or CSS class names. Use `user-event` for real user
interactions rather than calling event handlers directly.

## What's here so far

```
app/
├── index.html              # <html lang="ro">, Montserrat, no-flash theme script
├── public/icon.png         # OSUBB mark (favicon)
└── src/
    ├── main.tsx            # bootstrap: our theme, AuthProvider
    ├── App.tsx             # routes + the session and capability guards
    ├── vite-env.d.ts
    ├── assets/brand/       # OSUBB mark + wordmark, light/dark (own README)
    ├── lib/
    │   ├── supabase.ts             # the one shared client, env-driven
    │   ├── push-device.ts          # this browser as a Web Push device: subscription + push_tokens row (#704)
    │   ├── auth.tsx                # session + decoded claims, useAuth() (+ auth.test.tsx)
    │   ├── auth-error-message.ts   # maps GoTrue errors to Romanian copy
    │   ├── capabilities.ts         # useCapabilities(): the server capability row (my_capabilities())
    │   ├── calendar-time.ts        # Bucharest wall-clock time conversions (+ calendar-time.test.ts)
    │   ├── database.types.ts       # generated — `npm run gen:types`, never hand-edited
    │   ├── format.ts               # dates, points, initials — Romanian locale
    │   ├── command-reasons.ts      # the one reason → Romanian table (+ test)
    │   ├── normalize.ts            # trim, lowercase email, phone → E.164 (+ test)
    │   ├── schemas/                # one zod schema per entity + fieldForReason (#674)
    │   ├── form-errors.ts          # zod issues + server reason → { field: message }
    │   ├── use-form-validation.ts  # blur/submit validation, server reason under its field
    │   ├── work-filter.ts          # the Work Filter: URL keys, cascade, Campaign rule, RPC bounds (+ test)
    │   └── use-work-filter.ts      # useWorkFilter(): the filter in the query string, and its RPC params
    ├── queries/
    │   ├── client.ts       # QueryClient defaults; a refusal is not retried
    │   ├── keys.ts         # the key conventions — read this before adding a hook
    │   ├── points.ts       # useMyPoints, useLeaderboard, useDeptCup (+ points.test.tsx)
    │   ├── tasks.ts        # useMyTasks, useOpenTasks
    │   ├── events.ts       # calendar reads (+ events.test.ts)
    │   ├── event-rsvp.ts   # the RSVP mutation (+ event-rsvp.test.tsx)
    │   ├── notifications.ts # my notifications, unread count, mark read / all read (+ test)
    │   ├── profile.ts      # the signed-in member's own profile row
    │   ├── push-subscription.ts # usePushSubscription(): the Profil push switch (+ test)
    │   └── reference.ts    # departments/roles lookups for display
    ├── components/
    │   ├── ui/             # locally owned shadcn Base UI/Nova primitives
    │   ├── shell/          # AppShell.tsx, navItems.ts — one list drives sidebar/topbar/tab bar
    │   ├── states/         # Loading, Empty, ErrorState — every query renders all three (+ test)
    │   └── work-filter/    # WorkFilter: Grup principal → Subgrup → Campanie → dates, with chips (+ test)
    ├── screens/
    │   ├── Placeholder.tsx # stands in for a screen; says which issue builds it
    │   ├── dashboard/      # DashboardScreen (+test), DeptCupCard, LeaderboardCard, MyPointsCard,
    │   │                   # NextTaskCard, NextEventCard, next-items (R4's picks + deep links)
    │   ├── tracker/        # TrackerScreen.tsx — my tasks; the full Tracker rebuild is tracked
    │   │                   # in CLAUDE.md's queue, not here
    │   ├── calendar/       # CalendarScreen (+test): Lună (CalendarMonth) / Agendă
    │   │                   # (CalendarAgenda), view per device (calendar-view), Work
    │   │                   # Filter, ?event=<id>; EventCard, EventRsvpControls (+test),
    │   │                   # NewEventControl (+test), calendar-presentation (+test)
    │   ├── notifications/  # NotificationsScreen (+test), notifications-presentation (+test)
    │   ├── login/          # LoginScreen.tsx, AuthCallback.tsx — magic-link request + landing
    │   ├── profile/        # ProfileScreen.tsx (+test), EditProfileSheet.tsx (+test) (#108),
    │   │                   # PushDeviceCard (+test): Notificări pe acest dispozitiv (#704)
    │   └── no-profile/     # signed in, not a member (ADR-0003 gate 2)
    ├── pwa/
    │   ├── pwa-config.ts   # vite-plugin-pwa options: injectManifest, precache globs, manifest (+ test)
    │   ├── sw.ts           # the service worker: precache, fallback, push + notificationclick (ADR-0010)
    │   ├── sw-routes.ts    # its denylist and network-only Supabase rule (tested in pwa-config.test.ts)
    │   ├── push-payload.ts # push payload parsing, tap target, focus-or-open (+ test)
    │   └── PwaUpdatePrompt.tsx # asks before activating a waiting worker (+ test)
    ├── theme/
    │   ├── tokens.css       # Brand Book palette; originated as a copy of mockup/css/tokens.css,
    │   │                    # forked since — check both before assuming they still match
    │   ├── global.css       # element defaults (inherited from Ionic's base CSS, #699)
    │   ├── auth-screens.css # the card the three pre-app screens share
    │   ├── shell.css        # the app frame, lifted from mockup/css/layout.css
    │   ├── screens.css      # cards, query states, the two lists
    │   ├── dashboard.css    # the dashboard's cards and layout
    │   ├── calendar.css     # the calendar screen and RSVP controls
    │   └── font.test.ts     # asserts the bundled Montserrat actually loads
    └── test/setup.ts       # shared Vitest/Testing Library setup
```

Each screen gets its own folder under `screens/` when there is something real
to put in it.

## Forms and validation

Every form follows ruling R8 (#674). Its rules live in one zod schema per
entity under `src/lib/schemas/`, which mirrors the server's limits (#673) and
normalises before it measures: every text is trimmed, an email lowercased, a
phone turned into E.164 exactly as `private.normalize_phone` does. A schema's
issue messages are reason codes, never copy; `src/lib/command-reasons.ts` is
the only place a reason becomes Romanian, for the browser's rules and the
server's refusals alike.

`useFormValidation(schema, values, fieldForReason)` checks a field on blur and
the whole draft on submit, disables nothing before the first try, focuses the
first broken field, and `fail(error, fallback)` puts a server reason under the
field `fieldForReason` names (anything else in the form-level slot). Errors
render through `FieldError` from `components/ui/field.tsx` — do not add a
second error component or a per-feature reason table.

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

| Path             | Who reaches it                                                                    | Screen                     |
| ---------------- | --------------------------------------------------------------------------------- | -------------------------- |
| `/login`         | signed out                                                                        | magic-link request         |
| `/auth/callback` | anyone — its job is turning a link into a session, so it runs before there is one | —                          |
| `/no-profile`    | signed in without org claims                                                      | ADR-0003 gate 2            |
| `/`              | members                                                                           | dashboard (#93–#95)        |
| `/tracker`       | members                                                                           | task tracker (#88–#92)     |
| `/calendar`      | members                                                                           | calendar (#96–#98)         |
| `/anunturi`      | members                                                                           | announcements (#99–#101)   |
| `/notificari`    | members                                                                           | notification centre (#101) |
| `/voluntari`     | capability `seeDirectory` (rank BCE+)                                             | directory (#102–#103)      |
| `/profil`        | members                                                                           | profile (#108)             |
| `/administrare`  | capability `administer` (a Group Role anywhere, or BC+)                           | Administrare (#588)        |

Everything unknown redirects to `/`, where the guard decides.

The guards, and the nav items a role does not see, are **navigation, not
security**: the database returns nothing to a session that may not see it,
whatever the URL says. Someone who types `/administrare` by hand gets the screen and no
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
- **`tokens.css` originated as a copy of `mockup/css/tokens.css`, not a live
  mirror of it.** The two have since forked (interaction states, feedback
  aliases, and other app-only tokens live only here) — check both files rather
  than assuming a palette change in one is reflected in the other. Prettier is
  told to leave the file alone regardless, so a hand edit isn't silently reflowed.
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
  `BrowserRouter` routing (ADR-0002). `npm audit` has no router advisories at this version.
