# OSUBB App

Internal application for OSUBB (Organizația Studenților din Universitatea Babeș-Bolyai, Cluj): tasks + gamified points, calendar/RSVP, announcements, notifications, member/role management. Delivery targets: **BC demo ~Sep 15, 2026 · live for BC/BCE Oct 1 · org-wide Nov**.

**New agent or teammate? Read `docs/agents/onboarding.md` first** — it is the "continue from here" guide (state of the codebase, read order, conventions, current queue).

## Status (2026-08-24)

- **The whole v1 schema exists and is tested.** 17 migrations on `main` (core schema · tasks/requests · points engine · JWT claims hook · RLS everywhere + capabilities · tasks/points policies · events+attendance · announcements+reads · notifications · suppression+push tokens · provision_profile · reference/teams policies · profile reads + contact gating · announcements policies · calendar visibility · `member_level()` · membership required on every policy), **15 pgTAP suites / 266 tests**, all green in CI and mirrored to staging automatically.
- **Also built:** the `invite-member` Edge Function (Deno, 11 tests, its own CI job), proven end-to-end · the demo seed — 8 logins, 16 tasks, 7 events, 5 announcements — plus the manual, guarded workflow that puts it on staging (`.github/workflows/seed-staging.yml`, `docs/backend/seeding-staging.md`) · the frontend mini-spec (`docs/superpowers/specs/frontend-mini-spec.md`).
- **Not built yet:** the remaining policies (#60 #63 #65 #66, then the #67 final sweep), AG views (#47 #48), notification fan-out (#68), and the entire frontend (`app/` does not exist yet — Epic 8/9; **#80 → #81** scaffold it next).
- **Backlog:** 58 open issues, almost all sized **≤1 hour** (label `max-1h`), each with Goal/Why/How/AC/Depends. Map: `docs/backend/implementation-issues.md`. Human-only right now: **#54** (staging dashboard checklist, needs a new `STAGING_DB_URL` secret) before anyone demos off staging.

## House rules (must follow)

1. **Never edit the database by hand.** Schema changes are migrations: `npx supabase migration new <name>` → SQL → `npx supabase db reset`. Studio is for looking, not changing.
2. **New tables enable RLS in the migration that creates them.** Deny-by-default; policies come separately.
3. **New views get `with (security_invoker = on)`** — otherwise they run as owner and bypass RLS.
4. **Functions used by triggers/policies:** `security definer` only when needed, always `set search_path = ''` with fully-qualified names.
5. **Tests ship with the feature, same PR** (`supabase/tests/*.sql`, pgTAP). A test must fail if the feature is removed. Verify locally: `npx supabase db reset && npx supabase test db` — both green before any PR.
6. **Reference data** (roles, departments, guides, suppression, promotion rules) lives **in migrations**; **demo data** lives in `supabase/seed.sql` (local/staging only, never production). **`db push` does not carry `seed.sql`** — a hosted project only gets demo data from the manual *Seed staging demo data* workflow, so the file must stay re-runnable against a live database (CI checks this). See `docs/backend/seeding-staging.md`.
7. **One issue = one branch = one PR**, body says `Closes #n`. CI must be green. **Merging is a human act** — never merge or push to `main` directly (docs-only commits to `main` are the exception).
8. **Secrets never in git** — Bitwarden (humans) + GitHub Actions secrets (CI). Set secrets from a real terminal or browser; `gh secret set` through a non-interactive prompt stores an empty value.
9. **Never re-run one-shot scripts**: `scripts/create-github-issues.sh` (historical) and the 2026-08-19 backlog split are done.
10. **Spec Revision 3 supersedes older spec text where they conflict.** Known trap: notification suppression is **bc + bce** (Revision 3 §9.2), not the bc-only insert shown in spec §3.4.
11. Use `CONTEXT.md` vocabulary in code, issues, tests. When output contradicts an ADR (`docs/adr/0001–0006`), surface it — don't silently override.
12. **Every policy on `authenticated` must be unsatisfiable without org claims** — via `auth_level() >= N` (0 without claims) or explicitly via `auth_is_member()`. `to authenticated` is *not* a membership check: it only excludes `anon`. `auth.uid()` is not one either — a deactivated member keeps their uid and their `profiles` row. The claimless sweep in `rls_deny_by_default.test.sql` enforces this; if it fails naming your table, your policy has an unconditional branch.

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

**Why Docker:** `npx supabase start` doesn't install anything on your machine — it starts ~9 Docker containers (Postgres, GoTrue/Auth, PostgREST/Kong, Studio, Mailpit, the edge runtime, …), pre-wired to match the hosted projects exactly. That's what makes "local" a real Supabase stack rather than a simulation, and why `db reset` can rebuild everything from zero in under a minute: containers are disposable, nothing on the host OS is ever touched.

**Run locally:**
- `npx supabase start` — bring up the local stack (first run pulls several GB of images).
- Studio → http://127.0.0.1:54323 · API → http://127.0.0.1:54321 · Mailpit (local email inbox, catches magic links) → http://127.0.0.1:54324
- `npx supabase db reset` — re-apply every migration + `seed.sql`.
- `npx supabase test db` — run all pgTAP suites.
- `npx supabase stop` — shut down.
- **Windows gotcha:** if start/reset fails with "port is not available / access permissions", Windows reserved our ports after a reboot → admin PowerShell: `net stop winnat` then `net start winnat`.

**Environments:** local (Docker) → **staging** (hosted, auto-updated on merge to `main` via CI) → **production** (Supabase Pro, Spend Cap ON — created in Sprint 3, deploys only via a manually-approved workflow, issue #78). The CI staging job **skipping on PR builds is correct** — deploys happen on merge only.

**Auth is invite-only** (ADR-0003): public sign-up disabled; accounts are created via admin magic-link invite / CSV import; the JWT claims hook stamps role/level/depts/teams; RLS denies anyone without an `activ` `profiles` row. Hosted projects need dashboard config that `config.toml` can't carry (signup off, hook enabled) — see issue #54.
