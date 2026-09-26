# ADR-0002 — React and shadcn browser-first PWA

- **Status:** Accepted
- **Date:** 2026-09-07 (rewritten)
- **Amended:** 2026-09-23 — ADR-0010 records the Web Push service-worker design and the `injectManifest` migration reserved below
- **Deciders:** Alex Băncilă + team
- **Supersedes:** the earlier Capacitor + Ionic + AG Grid decision recorded in this file
- **Superseded by:** —
- **Related:** ADR-0001, ADR-0003, ADR-0005, `docs/brand/reference.md`

## Context

OSUBB needs one internal application that works well on volunteers' phones and on the wider desktop screens used by coordinators. Maintaining separate browser, iOS, Android, and desktop applications is not realistic for the available student team. The product therefore needs a web architecture that is easy to learn, deploy, review, and progressively install as a PWA.

The rushed HTML mockup is historical exploration, not a design authority. The official OSUBB Brand Book, the domain rules, accessibility requirements, and tested user journeys determine the finished interface.

## Decision

Build one **browser-first, installable PWA** in the existing `app/` Vite workspace with:

- **Vite + React 19 + TypeScript** for the application;
- **React Router 7** for browser routing;
- **TanStack Query** for server-state fetching, invalidation, and refetching;
- **Tailwind CSS** plus **shadcn/ui using Base UI and the Nova style** for accessible, locally owned interface components;
- **TanStack Table** for dense desktop tables, with shadcn-rendered markup;
- **Supabase** for authentication, PostgreSQL, Row-Level Security, Realtime, and atomic server commands;
- **Cloudflare** for the future hosted web application at `app.osubb.ro`.

The application remains responsive rather than becoming separate mobile and desktop products. Mobile volunteer journeys use touch-first cards and controls. Coordinator journeys may use denser desktop tables while retaining a usable mobile representation.

The finished architecture does **not** include React Native, Expo, Capacitor, AG Grid, TanStack Router, or TanStack Start. Ionic may coexist temporarily while routes are migrated, but no new finished screen or shared primitive should depend on it. Remove Ionic only after every route has an equivalent shadcn implementation.

## Design and accessibility boundary

- The Brand Book overrides shadcn presets and the mockup.
- Official logo files, Montserrat, OSUBB red, and department colors remain unchanged.
- Role hierarchy uses neutral badges; department color communicates department context.
- Color is never the only cue.
- Every interactive target is at least 44×44 CSS pixels where practical.
- Keyboard focus, contrast, reduced motion, mobile layout, and Romanian copy are acceptance criteria, not later polish.

## PWA boundary

The service worker may precache only hashed application-shell and brand assets. Supabase Auth, REST, and Realtime traffic is network-only. Member/API responses are never persisted in an offline cache, and offline writes or background synchronization are not queued.

Start with `vite-plugin-pwa` in `generateSW` mode and prompt-based updates. If Web Push later requires a custom service-worker handler, record that design and migrate to `injectManifest` deliberately.

> **Amended 2026-09-23 by [ADR-0010](0010-web-push-edge-function.md).** Web Push needs that handler, so the design is recorded: the worker moves to `injectManifest` with a `src/pwa/sw.ts` that keeps the precache, navigation fallback, denylist and network-only rules above and adds the `push` and `notificationclick` handlers (#704).

## Consequences

- **Positive:** one deployable codebase serves phone and desktop browsers and can be installed without app-store operations.
- **Positive:** shadcn components are owned in the repository and can follow OSUBB's visual identity without fighting a mobile framework theme.
- **Positive:** TanStack Table supplies behavior without owning markup, making accessible branded tables easier to review.
- **Positive:** React Router and the existing Vite application remain; the team avoids an unnecessary framework rewrite.
- **Cost:** the existing Ionic shell and screens must be migrated route by route, so both systems will coexist briefly.
- **Cost:** the team owns responsive and accessibility quality instead of inheriting a complete mobile component system.
- **Constraint:** a future native application, if ever justified, is a separate decision. It may share non-visual TypeScript contracts and business logic, not web UI components.

## Migration rule

Each migration issue must leave the application runnable. Do not remove an Ionic dependency until no merged route imports it. Do not add AG Grid while the old Tracker is replaced; use shadcn Table with TanStack Table for the new manager views.
