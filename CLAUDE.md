# OSUBB App

Internal application for OSUBB (Organizația Studenților din Universitatea Babeș-Bolyai, Cluj). See `docs/osubb-app-tech-stack.md` for the chosen technology stack and `docs/superpowers/specs/` for design specs.

## Agent skills

### Issue tracker

Issues are tracked in **GitHub Issues** (via the `gh` CLI) — this activates once the repo is pushed to a GitHub remote; until then no issues are created. External pull requests are **not** a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles, each using its default label string (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

**Single-context** — `CONTEXT.md` (domain glossary) + `docs/adr/` (ADRs 0001–0006) exist at the repo root. See `docs/agents/domain.md`. The mandate requirements (source documents) are in `docs/org/`; the delivery calendar is `docs/roadmap.md`; the team operating model is `docs/team/team-plan.md`.

## Backend / local development

The backend is **Supabase** (PostgreSQL + Row-Level Security + Auth + Edge Functions), managed as migrations in `supabase/`. Design: `docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md`. Glossary: `CONTEXT.md`. Task breakdown: `docs/backend/implementation-issues.md`.

**Prerequisites:** Docker Desktop running; Node. The Supabase CLI is used via `npx supabase` (no global install). Deno is only needed to run Edge Functions locally.

**Run locally:**
- `npx supabase start` — bring up the local stack (Postgres, Auth, Studio, Inbucket email inbox). First run pulls Docker images (several GB).
- Studio → http://127.0.0.1:54323 · API → http://127.0.0.1:54321 · local email inbox → http://127.0.0.1:54324
- `npx supabase db reset` — re-apply every migration in `supabase/migrations/`, then run `supabase/seed.sql`.
- `npx supabase stop` — shut it down.

**Change the schema (never edit the DB by hand):**
- `npx supabase migration new <name>` → write SQL in the new file under `supabase/migrations/`.
- `npx supabase db reset` to apply locally, then commit the migration.
- Reference data (roles, departments, scoring guides) lives in migrations so it reaches production; demo data goes in `seed.sql` (local/staging only).

**Environments:** local (Docker) for dev; a hosted **staging** project (`npx supabase link` + `db push`); **production** on Supabase Pro (Spend Cap ON, backups) — Epic 7.

**Auth is invite-only** (ADR-0003): public sign-up is disabled; accounts are created via admin magic-link invite / CSV import; RLS denies anyone without a `profiles` row.

**Filing the backlog:** after creating the GitHub repo, run `bash scripts/create-github-issues.sh` once to create the labels, milestones, and all backend issues.
