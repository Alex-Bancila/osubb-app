# ADR-0005 — Browser-first rollout through Cloudflare

- **Status:** Accepted
- **Date:** 2026-09-07 (rewritten)
- **Amended:** 2026-09-23 — ADR-0010 decides the Web Push comparison below: a Supabase Edge Function
- **Amended:** 2026-09-25 — the launch-infrastructure grill (`docs/superpowers/plans/2026-09-25-launch-infrastructure-grill.md`, rulings L1–L20) fixes the hosting product, the release pipeline, the email provider, the sign-in link shape, the privacy notice and the go-live condition; see the notes below
- **Deciders:** Alex Băncilă (IT Coordinator) + team
- **Supersedes:** the dated BC/BCE-first rollout recorded in the earlier version of this file
- **Superseded by:** —
- **Related:** ADR-0001, ADR-0002, ADR-0003, ADR-0006

## Context

The project is maintained by a small student team. Shipping and operating separate native and web applications would slow the core Task Tracker and Calendar work and create release responsibilities the team cannot currently sustain. The rollout must therefore follow demonstrated product readiness and security evidence, not a calendar forecast.

OSUBB controls the `osubb.ro` domain and intends to host the finished browser application through Cloudflare. Supabase remains the backend and authentication authority.

## Decision

### Delivery shape

Ship one responsive, installable **Progressive Web App**. The future production address is `app.osubb.ro`, hosted through Cloudflare. Native app-store packages are not part of this rollout.

> **Amended 2026-09-25 (L1, L3, L10).** Hosting is **Cloudflare Pages**, two Direct Upload projects (`osubb-staging` with PR previews, `osubb-app` at `app.osubb.ro`), deployed **only from GitHub Actions**. Pages is chosen against Cloudflare's "start new projects with Workers" guidance because `osubb.ro`'s DNS stays at its registrar for launch and a Workers custom domain requires the zone on Cloudflare; `app.osubb.ro` is one CNAME added there. Migrate to Workers when the zone moves to Cloudflare, when Pages receives an end-of-life date, or when server code at the edge is ever needed. Cloudflare's Git integration is not used: it deploys production on every push and cannot be gated. The production deploy is a **Release** (glossary), a `workflow_dispatch` workflow behind a GitHub Environment with required reviewers; "promote" is never used for it.

The implementation order is:

1. complete the Task Tracker backend;
2. replace the frontend foundation with shadcn/Base UI and Tailwind;
3. complete the Task Tracker frontend;
4. rebuild Calendar backend and frontend;
5. decide and implement member Web Push;
6. finish Cloudflare hosting and production operations.

No delivery date is promised by this ADR. A milestone is ready only when its acceptance run passes from a fresh local environment and the required staging checks are recorded.

### Environments

- **Local:** Docker runs the complete Supabase stack and seeded demo data. Developers rebuild it through migrations and `seed.sql`.
- **Staging:** a hosted Supabase project receives merged migrations and deployed Edge Functions after every required CI gate passes. Demo data is applied only through the guarded manual seed workflow.
- **Production:** a separate hosted Supabase project and Cloudflare deployment. Production database changes, secrets, custom-domain actions, and rollout approvals remain human-gated.

Preview deployments must not silently share production secrets or production member data. The Cloudflare Access policy for previews and production is a separate operational decision.

> **Amended 2026-09-25 (L5, L7, L9, L11, L16).** Staging and previews stay public (demo data, invite-only auth). Secrets live in GitHub Environments `preview`, `staging` (`main` only) and `production` (`main` only, reviewers), never at repository level. Auth email is sent through **Resend** over custom SMTP as `noreply@app.osubb.ro` in both environments with separate keys. Emailed sign-in links open a click-to-confirm page (`/auth/confirm` with the token hash) so link scanners cannot spend the one-time token; the six-digit code remains. A versioned Privacy Notice is shown in the app and each Member records a Privacy Acknowledgement before use.

### Rollout gates

Before expanding access, the team must prove:

- authorization across anonymous, no-profile, inactive, ordinary, scoped-manager, BCE, BC, and Moderator identities;
- the complete Task Tracker lifecycle and two-session queue race;
- Calendar visibility, relevance ordering, RSVP, and scope management;
- safe PWA cache boundaries: application shell and brand assets only;
- no secrets in Git, no high/critical dependency advisories, and no browser-console errors;
- a teammate who did not build the feature can follow the runbook successfully.

> **Amended 2026-09-25 (L15, L17).** The go-live condition "Wave 5 accepted on staging" is replaced: go-live is the acceptance run of ruling L17 passing on staging (the gates above that apply, plus PWA install and push on a real iPhone and Android, headers and manifest checks) **and** the IT Coordinator's explicit decision to open the doors. The launch scope is every open issue except those labelled `after-launch`; the target date is 2 October 2026; if items remain open on that day, the decision to launch or wait is taken that day with the open list in view.

### Push notifications

In-app notifications remain part of the core data model. Browser push delivery is deferred until after Task Tracker and Calendar.

Cloudflare account notifications monitor Cloudflare resources; they are **not** member-facing Web Push. The team must compare a Cloudflare Worker/Queue, a Supabase Edge Function, and an external provider, then record provider, retry, deduplication, privacy, service-worker, and operational decisions in a separate ADR. OneSignal is not a default.

> **Amended 2026-09-23 by [ADR-0010](0010-web-push-edge-function.md).** The comparison is decided: Web Push is a Supabase Edge Function using VAPID and the Web Push protocol, fed by a `pg_cron` outbox. The Cloudflare Worker/Queue and external providers are rejected; no option remains open.

## Consequences

- **Positive:** one web release reaches supported phones and desktops and can be installed without app-store review.
- **Positive:** local, staging, and production responsibilities stay distinct and reproducible.
- **Positive:** feature readiness is evidence-based instead of being declared because a date arrived.
- **Cost:** OSUBB must teach users how to install a PWA where browsers do not surface installation clearly.
- **Cost:** Cloudflare domain, security-header, access-policy, and deployment decisions remain explicit launch work.
- **Constraint:** the service worker never caches Supabase Auth, REST, Realtime, or member/API responses and never queues offline writes.

## Operational ownership

Agents and contributors may create branches, migrations, tests, documentation, and pull requests. Humans merge pull requests, manage GitHub/Supabase/Cloudflare secrets, approve production deployments, run guarded staging seed jobs, and attach `app.osubb.ro`.
