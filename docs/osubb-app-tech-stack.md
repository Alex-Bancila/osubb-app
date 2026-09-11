# OSUBB App — Technology Stack & Decision Document

> **Historical** — superseded by [ADR-0001](adr/0001-supabase-postgres-rls.md) (backend) and [ADR-0002](adr/0002-frontend-browser-pwa.md) (frontend).
>
> Kept for provenance; where it conflicts with `CLAUDE.md`, `CONTEXT.md`, or the ADRs, those win.

**Project:** Full-stack OSUBB application
**Author:** Alex Băncilă (IT Coordinator) + team
**Date:** 2026-06-29 · **Revision 2**
**Status:** Recommended stack — pending team review

> **Revision 2 — what changed in the criteria.** The original recommendation assumed we'd reuse the existing HTML/CSS/JS mockup and keep the learning curve gentle for a web team. Those assumptions are **dropped**: the mockup was only a presentation aid for the board (BC) and is disregarded; the team accepts **new languages and a harder learning curve**; and we'll **pay ~$20/month where the developer experience or value clearly justifies it**. Everything below is re-judged on **technical merit**. The headline picks largely survive — but for stronger reasons — and **Flutter is now a genuine co-leader**, not a dismissed option. Full head-to-head comparisons are in §9.

---

## 1. Requirements & constraints

| Constraint | Value |
|---|---|
| **Platforms** | Android phones + iPhones + **desktop (Windows/Mac browsers)** |
| **Concurrent users (peak)** | ≤ 500 |
| **Volunteer records in DB** | ≤ ~1,000 |
| **Budget** | NGO — minimal; willing to pay ~$20/mo where it's clearly justified |
| **Team** | Small student team, non-senior lead; **fine with new languages / harder curve** |

**Core features:** email + Google login; role-based access for **8 roles × 5 departments** (complex, row-level rules); task tracker with a points/scoring engine and leaderboards ("Cupa departamentelor"); calendar with role-based visibility; announcements (critical/pinned); ~1,000-row volunteer DB with **CSV bulk-import** of recruit accounts; push notifications with per-role suppression; light/dark theming.

> **The defining trait of this app:** it's a **permission-heavy admin/data dashboard**. Its dominant, hardest surface is dense, accessible, keyboard-driven **tables and forms on the desktop browser** (used by coordinators); the phone surface (tasks, calendar, feed, push) is lighter (used by volunteers). On merit, that profile rewards real web tech for the dashboard + a relational database with row-level security for the permissions.

---

## 2. The recommended stack at a glance

| Layer | Choice | Recurring cost |
|---|---|---|
| **Frontend / cross-platform** | **Capacitor + React + Ionic**, with a real web **data grid** (AG Grid Community / TanStack Table) as the heart of the dashboard | **$0** (all OSS/MIT) |
| **Backend + Database** | **Supabase** — PostgreSQL + **Row-Level Security** + Auth + Realtime + Storage | **$0** dev → **$25/mo** Pro at launch |
| **Business-logic service** | **Supabase Edge Functions** (Deno/TypeScript) — scoring engine, CSV import, push fan-out | **$0** (included) |
| **Auth** | **Supabase Auth** (Google OAuth + JWT custom claims feeding RLS) | **$0** (rides Supabase) |
| **Web/desktop hosting** | **Cloudflare Pages** (Free) + free Workers/Cron | **$0** (~$5 if functions get busy) |
| **Push notifications** | **OneSignal** (Free) — per-role/department targeting console | **$0** |
| **CI / native builds** | **Codemagic** (no-Mac iOS) + **GitHub Actions** (web/Android glue) | **$0** within free tiers |
| **App stores** (when going native) | Apple Developer (nonprofit **fee waiver**) + Google Play | Apple **$0** / Google **$25 one-time** |

**Total cost of ownership:** **$0 during development**, **~$25/month at launch** (Supabase Pro is the only recurring line). One-time: ~$25 (Google Play) + ~$12/yr (domain).

---

## 3. Languages, frameworks & tools — and why each

### Languages

| Language | Used for | Why |
|---|---|---|
| **TypeScript** | Whole frontend + Edge Functions | One typed language across web, mobile shell, and serverless. Static typing catches errors early — valuable for a student team and PR review. Largest ecosystem. |
| **HTML5 + CSS3** | The dashboard UI | The desktop admin surface (dense tables/forms) is *best built in real DOM/CSS* — the single biggest technical reason for this frontend. |
| **SQL + PL/pgSQL** | Schema, **permissions (RLS)**, points engine, leaderboards | The 8×5 permission model and scoring live in the database as SQL — enforced close to the data, impossible to bypass from a client. Durable, portable skill. |

### Frameworks, libraries & the data grid

| Tool | Role | Why this one |
|---|---|---|
| **React** | UI component library | Biggest ecosystem; required to use the mature React-DOM data-grid libraries below. |
| **Ionic Framework** | Mobile-grade UI + theming | Phone-quality components (lists, modals, tabs, nav) that also render correctly in a desktop browser. MIT. |
| **Capacitor** | Native runtime bridge | Wraps the *same* web bundle into real iOS/Android apps + native APIs (push, filesystem). MIT, no lock-in. Capacitor 8 adds Swift Package Manager support. |
| **AG Grid Community** *(or TanStack Table)* | The dashboard data grid | **MIT, free for production.** Sorting/filtering/virtualization/CSV out of the box — this is what makes the dense admin tables (sheets, trackers, leaderboards, volunteer DB) excellent. AG Grid *Enterprise* (~$999/dev) is **not** needed. |
| **Vite** | Build tool / dev server | Fast hot-reload, simple config. |
| **TanStack Query** | Server-state / data fetching | Removes hand-written loading/error/refetch code against Supabase. |
| **supabase-js** | Backend client SDK | Typed client for Auth, queries, Realtime, Storage; can generate TS types from the schema. |

### Platform & services

| Service | Role | Why |
|---|---|---|
| **Supabase** | Backend (Postgres + RLS + Auth + Realtime + Storage + Edge Functions) | The decisive RBAC requirement is relational → Postgres **Row-Level Security** is the only native fit. (See §4.2 / §10.3.) |
| **PostgreSQL** | Relational database | Relational data + RLS; most portable (pg_dump anywhere), lowest lock-in. |
| **Deno (TypeScript)** | Edge Functions runtime | The thin companion service: scoring engine, CSV import (service-role), push fan-out + per-role suppression. |
| **Cloudflare Pages** | Static hosting / CDN | Free, unlimited bandwidth, **commercial use allowed**, Bucharest edge PoP near Cluj. (See §10.2.) |
| **OneSignal** | Push provider | Console-driven **per-role/department** targeting on a Capacitor frontend; free & unlimited for mobile push. |
| **Codemagic** | CI for iOS/native builds | Cloud macOS builders → **no Mac needed**; free 500 macOS min/mo; also the Flutter-native pipeline if we ever switch. |
| **GitHub + Actions** | Source control + web/Android CI | PR workflow + free CI; reserve macOS jobs for Codemagic. |
| **Git, ESLint/Prettier, Vitest, Playwright, Supabase CLI** | Tooling | Version control, consistent code, testing (esp. a **test per role** for RLS), migrations-in-git to avoid schema drift. |

> **If we chose Flutter instead** (the co-leader — see §10.1), the languages/frameworks shift to **Dart + Flutter SDK**, **Syncfusion Flutter DataGrid** (free for OSUBB under Syncfusion's Community License), **Codemagic** CI, **OneSignal** or **firebase_messaging** for push, and **supabase_flutter** as the client. The backend (Supabase + RLS) is identical.

---

## 4. Why each layer (brief — comparisons in §10)

### 4.1 Frontend → Capacitor + React + Ionic + a web data grid — **$0**
On pure merit, the app's heaviest surface is a dense, accessible, keyboard-driven **admin dashboard delivered in a browser**. Real web tech wins that outright (real DOM/HTML tables, full CSS, native keyboard handling, strongest accessibility, mature grids). Capacitor makes the **same codebase** the browser dashboard *and* wraps it into real iOS/Android apps; the lighter phone surface tolerates the WebView's softer native feel. This is the truest single codebase where the browser-delivered desktop target is **not** a compromise. **Flutter is an extremely close co-leader** (see §9.1); **Expo/React Native is demoted** because React Native Web is its weakest target and a dense dashboard would force a *second* web codebase, breaking the "one app" goal.

### 4.2 Backend + Database → Supabase (Postgres + RLS) — **$0 → $25/mo**
The hardest, defining requirement — 8 roles × 5 departments with row-level rules ("see only your own tracker" vs "see all sheets") — is an intrinsically **relational** authorization problem. Postgres **Row-Level Security** is the only option that expresses it natively (full SQL in policies: joins, role-rank-within-department, JWT claims) and enforces it at the data layer regardless of client. Supabase adds Google OAuth, Realtime, Storage, and an admin API for CSV bulk-account creation. **Removing the easy-curve assumption did not change this — RLS was never chosen for the curve, it's the structural fit.**

### 4.3 Companion service → Supabase Edge Functions — **$0**
The best use of the now-allowed "new language / harder curve" freedom is a *thin* custom layer for the few jobs RLS shouldn't do: the points/scoring engine, CSV import via service-role, and push fan-out with per-role suppression. Keeping these as Edge Functions (Deno/TS) inside the Supabase project avoids a second vendor/host.

### 4.4 Hosting → Cloudflare Pages — **$0**
The natural build is a static SPA/PWA (Capacitor web export) talking to Supabase — no SSR/ISR needed, which neutralizes Vercel's biggest advantage. Cloudflare Pages Free legitimately allows org use, gives unlimited bandwidth, and serves Cluj from a Bucharest edge PoP. **Is Vercel's $20/mo worth it? For this app, no — see the full verdict in §10.2.**

### 4.5 Auth → Supabase Auth — **$0**
It natively drives Postgres RLS (role/department claims in the JWT feed policies with zero bridging) and is free to 50,000 users with RBAC/MFA included. **Auth0 is eliminated on value** (its 2026 free tier removed RBAC/MFA); **Clerk** is the alternative only if we don't run Supabase.

### 4.6 Push → OneSignal (Free) — **$0**
On a Capacitor (non-Expo) frontend, OneSignal gives a coordinator-facing console for **per-role/department targeting** without building our own segmentation backend, and is free/unlimited for mobile push. Raw FCM/APNs is the alternative if we want no third-party processor.

### 4.7 CI → Codemagic + GitHub Actions — **$0**
The binding constraint is building **iOS without owning a Mac**. Codemagic does it in the cloud (free 500 macOS min/mo, enough for our release cadence); GitHub Actions handles the web/Android build and glue.

### 4.8 App stores
Apple $99/yr is **waivable for nonprofits → $0**; Google Play is **$25 one-time**. **PWA-first** can defer both entirely.

---

## 5. Total cost of ownership

| Scenario | Monthly | Year one | Ongoing/yr |
|---|---|---|---|
| **Development** (all free tiers) | ~$0 | — | — |
| **Recommended production** (Supabase Pro; native apps) | **~$25** | **~$337** ($300 Supabase + $25 Google Play + $12 domain; Apple $0 via waiver) | **~$312** |
| If you adopt Next.js SSR + Vercel Pro | ~$45 | ~$577 | ~$552 |

Only recurring line: **Supabase Pro ($25/mo)**. Cloudflare, Supabase Auth, Edge Functions, OneSignal, Codemagic free tier, AG Grid Community — all $0.

---

## 6. "Is it worth paying for?" — verdicts

| Item | Verdict |
|---|---|
| **Vercel Pro $20/mo** (vs Cloudflare Free) | **No** for this app — a static SPA/PWA never uses SSR/ISR/image-optimization, so you'd pay ~$240/yr for DX polish only. Worth it **only** if you commit to Next.js SSR. (And since Vercel's free Hobby tier is non-commercial, the real comparison is Cloudflare **$0** vs Vercel **$20**.) |
| **Supabase Pro $25/mo** | **Yes, at launch** — not for quota but for *operational safety*: removes the 7-day idle auto-pause and adds daily backups + point-in-time recovery for real volunteer data. Stay on Free during dev. |
| **Auth0 paid $35+/mo** | **No** — the clear "not worth it." Its 2026 free tier stripped RBAC/MFA, so a permission-heavy app must pay $35+ for what Supabase Auth/Clerk give free. |
| **OneSignal Growth $19/mo** | **No** — Free is unlimited for mobile push and covers per-role targeting; Growth only adds automated Journeys we won't use. |
| **Clerk Pro $20-25/mo** | **Skip** — we use Supabase Auth. (If using Clerk standalone, its 50k-user free tier suffices.) |
| **Codemagic pay-as-you-go** | Free 500 macOS min/mo covers us; pay only if exceeded. The $3,990/yr team plan is unjustified at this scale. |
| **AG Grid Enterprise ~$999/dev** | **Unnecessary** — AG Grid Community (MIT) covers the dashboard. (Flutter equivalent: Syncfusion DataGrid is free for OSUBB.) |

---

## 7. Cost model: managed (fixed-cost) vs self-hosted VPS

A team concern (raised by Dobre) deserves a written answer: **serverless/usage-based services have *variable* costs, and a bug can produce a runaway bill** (the classic "$X,000 Vercel/Firebase surprise"). A **VPS is a fixed cost** — predictable resources; if the code is inefficient it runs slow or crashes rather than billing you. This is a legitimate point for an NGO budget. Here's how it applies to **our** stack.

### 7.1 Our recommended stack is already fixed-cost (this is the key correction)

The runaway-bill nightmare targets two products we **already rejected**:
- **Vercel** pay-as-you-go and **Firebase Blaze** (no hard spend cap) are the genuine "surprise bill" risks. We chose **Cloudflare** and **Supabase** precisely to avoid them.
- **Cloudflare Pages** = free/flat for static hosting (no bandwidth metering, no per-request blow-up).
- **Supabase Pro** = a **flat $25/month** with included quotas, and it has a **Spend Cap** toggle: turn it on and Supabase **refuses to bill overages** (it throttles instead of charging). At our scale (~1,000 rows / ≤500 users) we never approach the included limits anyway.

**So our stack already gives Dobre's fixed-cost predictability — without owning a server to maintain.** Action item regardless of decision: **enable the Supabase Spend Cap**, and never put this app on Vercel pay-as-you-go or Firebase Blaze.

### 7.2 Managed vs self-hosted VPS — the actual trade

The two options are close on price; the deciding factor is **ops burden, not money**.

| | Managed (Supabase Pro + Cloudflare) | Self-host on a VPS |
|---|---|---|
| **Cost** | ~$25/mo, flat, spend-capped | €20–30/mo, flat |
| **Ops burden** | Almost none | You own OS patching, security hardening, SSL, **backups**, uptime, upgrades |
| **Backups / recovery** | Daily backups + point-in-time recovery included | You must build it — and store it **off-box** |
| **Failure mode** | Degrades within managed limits; provider on-call | One box = single point of failure; disk dies → app + DB + local backups die together |
| **Reliability at peak** (recruitment events, ~500 concurrent) | Scales within managed limits | A single VPS can run slow/crash under load |
| **Control / data ownership** | Good (EU region, exportable via `pg_dump`) | Total |

**The risk that actually matters for a student team isn't a €10 cost swing — it's ops debt:** a missed backup, an unpatched server, or the person who set up the VPS graduating and leaving. That's why **production should stay managed** unless someone on the team genuinely wants to own backups + uptime.

### 7.3 The recommended compromise

- **Production:** managed **Supabase Pro + Cloudflare** (fixed cost, spend-capped, ~zero ops).
- **Staging / testing:** a cheap **VPS** (€5–10 is plenty) — this is where Dobre's "fixed cost + full control + dedicated test env" wish costs almost nothing if it breaks. Satisfies the desire without risking production.
- **Full self-host remains a viable fallback** if the team wants total ownership: Supabase is open-source and self-hostable via Docker. **But** self-hosting Supabase is ~a dozen containers (Postgres, auth, realtime, storage, gateway…) — real setup/maintenance. A lighter single-binary alternative is **PocketBase**, but its permission model is weaker for our complex **8×5 RBAC**, which is the heart of this app. So full self-host trades managed-simplicity for either heavy setup (Supabase) or weaker permissions (PocketBase).

### 7.4 Object storage (avatars, CSV uploads)

Minor and contingent on the above — our object-storage needs are tiny:
- **If managed → Supabase Storage** (S3-compatible, included; 1 GB free / 100 GB on Pro — far more than we need).
- **If self-hosted / decoupled → Cloudflare R2** is the right pick (Dobre is correct: R2 has **no egress fees** and is simpler than AWS S3).

### 7.5 Convex

Considered and **ruled out** — Convex is pleasant but document/reactive, an awkward fit for our heavily relational, permission-driven data (8×5 RBAC, leaderboards, joins). This reinforces the Postgres choice.

---

## 8. Risks & mitigations

1. **No first-party managed cloud build for Capacitor** (Ionic's Appflow is discontinued). → Use **Codemagic** (free macOS minutes) or GitHub macOS runners; iOS still needs no local Mac.
2. **Supabase Free auto-pauses after 7 days idle + no backups.** → Move to **Pro ($25)** before loading real volunteer data.
3. **Free-tier realtime caps at 200 connections.** → Pro raises it to 500; use short-poll for non-critical views.
4. **RLS policies for 8×5 permissions are easy to get subtly wrong.** → Centralize policies, push role+dept into the JWT, write a **test per role** before launch.
5. **WebView mobile feel is less "native."** → Acceptable for this app's light phone surface; if mobile becomes demanding, that's the trigger to reconsider **Flutter** (§10.1).
6. **Multiple contributors → schema drift.** → Supabase CLI migrations in git; separate staging project.

---

## 9. Build order (phasing)

- **Phase 0 — MVP ($0):** Scaffold Vite + React + Ionic + AG Grid. Stand up Supabase Free (schema via CLI migrations). Wire Supabase Auth (email + Google) and the core RLS policies. Ship task tracker + points + announcements. Host on Cloudflare Pages; CI on GitHub Actions. Runs in all browsers as a PWA — no store fees yet.
- **Phase 1 — Harden ($25/mo):** Upgrade Supabase to Pro before real data. CSV bulk-import + scoring via Edge Functions. Role-based calendar. Full 8×5 policy matrix + per-role test suite. OneSignal web push.
- **Phase 2 — Go native (+$25 one-time):** Add Capacitor, wrap the bundle for iOS/Android, OneSignal native push, Codemagic builds, Apple waiver, Google Play, submit to stores.
- **Phase 3 — Optional:** Realtime leaderboards; pinned/critical announcement push.

---

## 10. Head-to-head comparisons

All figures current as of mid-2026. "Worth paying" verdicts assume **this** project (≤500 users, ≤1,000 records, NGO budget, permission-heavy dashboard).

### 10.1 Frontend framework — Capacitor vs Flutter vs Expo/React Native

| Dimension | Winner | Notes |
|---|---|---|
| True single-codebase across iOS+Android+desktop | **Flutter & Capacitor tie** | Flutter has first-party native targets for all platforms + web from one engine. Capacitor's browser build **is** the desktop deliverable. Expo/RN is weakest (no first-party desktop; RN Web is its weakest target). |
| **Desktop data/admin dashboard** (dense tables, forms, keyboard, a11y) — via browser | **Capacitor** | Real DOM/HTML tables, full CSS, mature grids (AG Grid Community, MIT), strongest accessibility. Flutter Web renders to canvas (accessibility off by default, weak text-field labels). RN Web weakest for dense layouts. |
| Native mobile feel (light volunteer use) | **Expo/RN** (Flutter very close) | Capacitor is a WebView — last place, but the gap is small for this app's light phone surface. |
| Build/release tooling + no-Mac iOS builds | **Expo/RN (EAS)** | EAS is the only first-party managed cloud build + OTA. Flutter & Capacitor both use Codemagic for no-Mac iOS. |
| Push notifications | **Expo/RN** | Free Expo Push abstracts FCM/APNs. Flutter & Capacitor wire FCM/APNs (or OneSignal) themselves. |
| Ecosystem / hiring (2026) | **Expo/RN & Capacitor** (web pool) | RN has ~8× more job listings than Dart/Flutter; Flutter leads new-project share but a smaller, Dart-specific pool. |
| Cost at this scale | **All ~$0** | Grids are free (AG Grid Community MIT; Syncfusion free for OSUBB). The one clean paid win (EAS Starter $19) only applies if you pick Expo. |

**Recommendation:** **Capacitor + React + Ionic + a web data grid** — the dense, browser-delivered dashboard is the most-weighted surface and only real web tech does it best, while Capacitor still ships real phone apps. **Flutter is the co-leader and the right pick if** you deliver the coordinator desktop as a **free native Windows/macOS app** (sidestepping Flutter Web's accessibility gaps) **or** expect the mobile app to grow demanding/native. **Expo/React Native is demoted** — great mobile, but its desktop story (RN Web) would force a second web codebase.

**What changed:** Previously the pick rode partly on reusing the mockup + the team's web skills. On pure merit it's still Capacitor — but now the **data grid is named as the core**, and **Flutter rises from "dismissed for Dart" to genuine co-leader.**

### 10.2 Hosting — Cloudflare Pages vs Vercel (the "$20 worth it?" question)

| Dimension | Winner | Notes |
|---|---|---|
| Developer experience (deploys, previews, rollback, logs, analytics) | **Vercel** | More polished: per-PR preview URLs with inline comments, one-click rollback, clean log explorer, Speed Insights. Cloudflare has all the primitives but more config friction. For a static SPA the gap narrows. |
| Next.js SSR/ISR/PPR | **Vercel** | Native + zero-config. On Cloudflare it's the OpenNext adapter (no ISR/PPR yet). **Decisive only if you use Next.js SSR.** |
| Static SPA / PWA / Flutter Web / Expo Web | **Tie (slight edge Cloudflare)** | All emit static bundles; both serve them from a global edge. This is the likely OSUBB shape — neutralizing Vercel's edge. |
| Free-tier limits | **Cloudflare** | Unlimited bandwidth, 500 builds/mo, unlimited previews. Vercel Hobby: 100 GB transfer, US-only functions. |
| **Commercial / org use on free tier** | **Cloudflare** | **The pivotal difference.** Vercel Hobby is *non-commercial personal use only* — an official org app needs Pro ($20). Cloudflare Pages Free explicitly allows org use at $0. |
| Edge functions / cron | **Cloudflare** | Workers at the Bucharest edge, 100k req/day + free Cron — ideal for push dispatch / CSV import / scoring cron. Vercel Hobby functions are pinned to the US. |
| Bandwidth | **Cloudflare** | Unlimited on every tier (incl. Free). Vercel meters it. |
| EU latency for Cluj | **Cloudflare** | Bucharest PoP (~330 km, sub-~20ms) for static *and* dynamic. Vercel caches static in Frankfurt; Hobby functions run in the US. |
| Paid-tier value for this project | **Cloudflare** | Cloudflare = legitimate org host at $0. Vercel's $20 buys DX polish + Next.js SSR — value only if you actually use SSR. |

**Verdict — is Vercel's $20/mo worth it?** **No, for this app.** An authenticated static SPA/PWA + Supabase never invokes SSR/ISR/PPR or image optimization, so the $240/yr buys DX polish you won't cash in. Cloudflare Pages Free does the job legitimately at $0 with unlimited bandwidth and a closer EU edge. **Vercel Pro becomes the better buy only if** the team deliberately commits to a **Next.js SSR/ISR** architecture and wants the premium DX + EU function region. Because Vercel's free Hobby tier is non-commercial, the honest comparison for an org app is **Cloudflare $0 vs Vercel $20** — and $240/yr is better spent on Supabase Pro.

### 10.3 Backend + Database — Supabase vs Firebase vs Appwrite vs Custom

| Dimension | Winner | Notes |
|---|---|---|
| **Complex relational RBAC (8×5, row-level)** — the decisive requirement | **Supabase (Postgres + RLS)** | RLS runs full SQL against JWT claims + joined tables → expresses role-rank-within-department natively, enforced at the DB. Firestore rules can't join/cascade; Appwrite grants can't derive rules from relational attributes; custom = build the whole engine. |
| Auth + Google OAuth + CSV bulk creation | **Supabase** | Built-in OAuth + admin API (`createUser`/`inviteUserByEmail`). |
| Realtime + push | **Tie (Supabase / Phoenix)** | At ≤500 users Supabase Realtime is ample; FCM is great for push. |
| Operational burden (small team) | **Supabase** | Managed auth/realtime/storage/backups. Custom backend = you own/operate all of it. |
| Longevity / lock-in | **Supabase (Postgres)** | Postgres is the most portable target; Firestore/Appwrite lock you into proprietary authz. (Even Firebase now ships "SQL Connect" = Postgres.) |
| Cost fit (~$20 ceiling) | **Supabase Pro** | $25/mo buys no-pause + backups; Firebase Blaze has *no hard spend cap* (budget risk); self-host = $0 license but VPS + ops. |
| Best use of new-language freedom | **Custom companion service** | Not for replacing Postgres — for a thin Go/NestJS/Deno service owning scoring/CSV/push. |

**Recommendation:** **Supabase (Postgres + RLS)** — unchanged, and on merit the case is *stronger*, not weaker. A fully-custom Postgres backend (NestJS+Prisma / Django) is a credible but distant #2 (you'd rebuild auth, realtime, storage, push, backups). Firestore/Appwrite are the worst fits for relational permissions.

### 10.4 Supporting tech — CI, Push, Auth

| Area | Recommendation | Why / alternative |
|---|---|---|
| **CI / build** | **Codemagic** (no-Mac iOS, free 500 macOS min/mo) + **GitHub Actions** (web/Android glue) | Match CI to the frontend. **EAS** only if you pick Expo (its OTA is high-leverage there). GitHub macOS runners are 10×-multiplied — reserve for glue, not the primary iOS path. |
| **Push** | **OneSignal Free** | Console-based per-role/department targeting on Capacitor; unlimited mobile push free. **Raw FCM/APNs** if you want no third-party processor. **Expo Push** is RN-only (off the table here). |
| **Auth** | **Supabase Auth** | Drives RLS directly, free to 50k users, RBAC/MFA included. **Clerk** if standalone/turnkey UI wanted. **Auth0 eliminated on value** (free tier dropped RBAC/MFA). |

---

## 11. Summary

A single **TypeScript/React + Ionic** codebase, presented through a real **web data grid** and wrapped by **Capacitor**, runs on desktop browsers, Android, and iOS — judged on merit, the best fit for a permission-heavy dashboard whose desktop surface is the priority. **Supabase (PostgreSQL + Row-Level Security)** is the single backend for the 8×5 permission model, with a thin **Edge Functions** layer for scoring/CSV/push. **Cloudflare Pages + OneSignal + Codemagic** keep everything else at $0; **Vercel's $20/mo isn't worth it** unless you adopt Next.js SSR. The only recurring bill is **~$25/month** for production-grade durability. **Flutter is the serious alternative** — choose it if the coordinator desktop ships as a free native app or the mobile experience needs to grow truly native.
