# ADR-0005 — Rollout: PWA-first, BC/BCE-first, org-wide at recruitment

- **Status:** Accepted (2026-08-12)
- **Deciders:** Alex Băncilă (IT Coordinator)
- **Context docs:** architecture spec §8.2, `docs/osubb-app-tech-stack.md` §9, `docs/roadmap.md`

## Context

Two launch questions were open: **PWA-only vs native app stores from day one** (spec §8.2), and **who gets the app first**. The mandate promises migrating the existing BC/BCE Google Sheets task tracking into the app (Plan IV.1.a) and an org-wide tracker (IV.1.b). Hard dates exist: a **full core-app demo to BC by ~15 Sep 2026** and a **live deployment by 1 Oct 2026**. The org onboards recruits in bulk during the autumn recruitment campaign (Oct–Nov).

## Decision

1. **PWA-first.** The app ships as a browser-delivered PWA on Cloudflare Pages. Native store builds (Capacitor wrap, Codemagic, Apple nonprofit waiver, Google Play $25) come later, when the phone surface earns it — not for launch. In-app notifications suffice for v1; the push-provider decision (spec §8.3, default OneSignal) is deferred to Phase 2 and gets its own ADR when built.
2. **BC/BCE-first.** v1 goes live for the ~20 BC/BCE members on **1 Oct 2026**, replacing the leadership Google Sheets tracker — a supervisable migration with a small blast radius and a measurable success criterion.
3. **Org-wide at recruitment.** All members (including new recruits via CSV import) onboard during the autumn recruitment campaign, target **end of Nov 2026** — after the promotion engine (ADR-0004) and notification preferences land.
4. **v1 scope = core app only:** tasks + points + requests, accounts/roles, personal dashboard, calendar + RSVP, announcements, in-app notifications. Calendar sync, QR check-in, recruitment pipeline, forms engine, and contracts are explicitly out of v1 (phases in `docs/roadmap.md`); forms remain Google Forms links (`announcements.form_label` already supports this).

## Consequences

- **+** No store review latency or fees on the critical path; the browser build is the desktop deliverable anyway (ADR-0002).
- **+** Each rollout ring (BC/BCE → org) validates RLS and migration quality before the blast radius grows.
- **−** iOS PWA installation is less familiar to users ("Add to Home Screen") — acceptable for the leadership ring; revisit natives before org-wide if it bites.
- **−** No push notifications in v1 — mitigated by the in-app notification center; BC/BCE live in the desktop app for tracking anyway.
