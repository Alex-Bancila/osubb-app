# ADR-0005 — Browser-first rollout through Cloudflare

- **Status:** Accepted (rewritten 2026-09-07)
- **Deciders:** Alex Băncilă (IT Coordinator) + team
- **Supersedes:** the dated BC/BCE-first rollout recorded in the earlier version of this file
- **Related:** ADR-0001, ADR-0002, ADR-0003, ADR-0006

## Context

The project is maintained by a small student team. Shipping and operating separate native and web applications would slow the core Task Tracker and Calendar work and create release responsibilities the team cannot currently sustain. The rollout must therefore follow demonstrated product readiness and security evidence, not a calendar forecast.

OSUBB controls the `osubb.ro` domain and intends to host the finished browser application through Cloudflare. Supabase remains the backend and authentication authority.

## Decision

### Delivery shape

Ship one responsive, installable **Progressive Web App**. The future production address is `app.osubb.ro`, hosted through Cloudflare. Native app-store packages are not part of this rollout.

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

### Rollout gates

Before expanding access, the team must prove:

- authorization across anonymous, no-profile, inactive, ordinary, scoped-manager, BCE, BC, and Moderator identities;
- the complete Task Tracker lifecycle and two-session queue race;
- Calendar visibility, relevance ordering, RSVP, and scope management;
- safe PWA cache boundaries: application shell and brand assets only;
- no secrets in Git, no high/critical dependency advisories, and no browser-console errors;
- a teammate who did not build the feature can follow the runbook successfully.

### Push notifications

In-app notifications remain part of the core data model. Browser push delivery is deferred until after Task Tracker and Calendar.

Cloudflare account notifications monitor Cloudflare resources; they are **not** member-facing Web Push. The team must compare a Cloudflare Worker/Queue, a Supabase Edge Function, and an external provider, then record provider, retry, deduplication, privacy, service-worker, and operational decisions in a separate ADR. OneSignal is not a default.

## Consequences

- **Positive:** one web release reaches supported phones and desktops and can be installed without app-store review.
- **Positive:** local, staging, and production responsibilities stay distinct and reproducible.
- **Positive:** feature readiness is evidence-based instead of being declared because a date arrived.
- **Cost:** OSUBB must teach users how to install a PWA where browsers do not surface installation clearly.
- **Cost:** Cloudflare domain, security-header, access-policy, and deployment decisions remain explicit launch work.
- **Constraint:** the service worker never caches Supabase Auth, REST, Realtime, or member/API responses and never queues offline writes.

## Operational ownership

Agents and contributors may create branches, migrations, tests, documentation, and pull requests. Humans merge pull requests, manage GitHub/Supabase/Cloudflare secrets, approve production deployments, run guarded staging seed jobs, and attach `app.osubb.ro`.
