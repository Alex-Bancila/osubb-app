# OSUBB App

Internal application for OSUBB (Organizația Studenților din Universitatea Babeș-Bolyai, Cluj): tasks + gamified points, calendar/RSVP, announcements, notifications, member/role management. Delivery targets: **BC demo ~Sep 15, 2026 · live for BC/BCE Oct 1 · org-wide Nov**.

**New agent or teammate? Read `docs/agents/onboarding.md` first** — it is the "continue from here" guide (state of the codebase, read order, conventions, current queue).

## Status (2026-08-19)

- **Backend core is built and tested:** 6 migrations (core schema · tasks/requests · points engine · JWT claims hook · RLS everywhere + capabilities · tasks/points policies), 4 pgTAP suites / 101 tests, all green in CI.
- **Pipeline is live:** PRs #38–#42 merged; every merge to `main` auto-pushes migrations to the hosted **staging** project. Production does not exist yet (created in Sprint 3 — issue #77).
- **Not built yet:** remaining v1 tables (events/announcements/notifications — issues #43–#46), remaining RLS policies (#59–#66), the invite flow (#56–#58), demo seed (#74–#76), and the entire frontend (`app/` does not exist yet — Epic 8/9).
- **Backlog:** 73 open issues, almost all sized **≤1 hour** (label `max-1h`), each with Goal/Why/How/AC/Depends. Map: `docs/backend/implementation-issues.md`. Next batch: #43 #44 #45 #46 (independent), then the invite chain #56→#57→#58.

## House rules (must follow)

1. **Never edit the database by hand.** Schema changes are migrations: `npx supabase migration new <name>` → SQL → `npx supabase db reset`. Studio is for looking, not changing.
2. **New tables enable RLS in the migration that creates them.** Deny-by-default; policies come separately.
3. **New views get `with (security_invoker = on)`** — otherwise they run as owner and bypass RLS.
4. **Functions used by triggers/policies:** `security definer` only when needed, always `set search_path = ''` with fully-qualified names.
5. **Tests ship with the feature, same PR** (`supabase/tests/*.sql`, pgTAP). A test must fail if the feature is removed. Verify locally: `npx supabase db reset && npx supabase test db` — both green before any PR.
6. **Reference data** (roles, departments, guides, suppression, promotion rules) lives **in migrations**; **demo data** lives in `supabase/seed.sql` (local/staging only, never production).
7. **One issue = one branch = one PR**, body says `Closes #n`. CI must be green. **Merging is a human act** — never merge or push to `main` directly (docs-only commits to `main` are the exception).
8. **Secrets never in git** — Bitwarden (humans) + GitHub Actions secrets (CI). Set secrets from a real terminal or browser; `gh secret set` through a non-interactive prompt stores an empty value.
9. **Never re-run one-shot scripts**: `scripts/create-github-issues.sh` (historical) and the 2026-08-19 backlog split are done.
10. **Spec Revision 3 supersedes older spec text where they conflict.** Known trap: notification suppression is **bc + bce** (Revision 3 §9.2), not the bc-only insert shown in spec §3.4.
11. Use `CONTEXT.md` vocabulary in code, issues, tests. When output contradicts an ADR (`docs/adr/0001–0006`), surface it — don't silently override.

## Agent skills

### Issue tracker

Issues are tracked in **GitHub Issues** (via the `gh` CLI) on `Alex-Bancila/osubb-app`. External pull requests are **not** a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles with default strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`); `max-1h` is a size label meaning "one focused hour or less". See `docs/agents/triage-labels.md`.

### Domain docs

**Single-context** — `CONTEXT.md` (domain glossary) + `docs/adr/` (ADRs 0001–0006) at the repo root. See `docs/agents/domain.md`. Mandate source documents: `docs/org/`; delivery calendar: `docs/roadmap.md`; team operating model: `docs/team/team-plan.md`.

## Backend / local development

The backend is **Supabase** (PostgreSQL + Row-Level Security + Auth + Edge Functions), managed as migrations in `supabase/`. Design: `docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md` (incl. **Revision 3**). Task breakdown: `docs/backend/implementation-issues.md`.

**Prerequisites:** Docker Desktop running; Node. The Supabase CLI runs via `npx supabase` (no global install). Deno only for Edge Functions.

**Run locally:**
- `npx supabase start` — bring up the local stack (first run pulls several GB of images).
- Studio → http://127.0.0.1:54323 · API → http://127.0.0.1:54321 · Mailpit (local email inbox, catches magic links) → http://127.0.0.1:54324
- `npx supabase db reset` — re-apply every migration + `seed.sql`.
- `npx supabase test db` — run all pgTAP suites.
- `npx supabase stop` — shut down.
- **Windows gotcha:** if start/reset fails with "port is not available / access permissions", Windows reserved our ports after a reboot → admin PowerShell: `net stop winnat` then `net start winnat`.

**Environments:** local (Docker) → **staging** (hosted, auto-updated on merge to `main` via CI) → **production** (Supabase Pro, Spend Cap ON — created in Sprint 3, deploys only via a manually-approved workflow, issue #78). The CI staging job **skipping on PR builds is correct** — deploys happen on merge only.

**Auth is invite-only** (ADR-0003): public sign-up disabled; accounts are created via admin magic-link invite / CSV import; the JWT claims hook stamps role/level/depts/teams; RLS denies anyone without an `activ` `profiles` row. Hosted projects need dashboard config that `config.toml` can't carry (signup off, hook enabled) — see issue #54.
