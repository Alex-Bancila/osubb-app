# OSUBB App

Internal application for OSUBB (Organizația Studenților din Universitatea Babeș-Bolyai, Cluj): Task Tracker + points, Calendar/RSVP, announcements, notifications, and member/role management. The accepted delivery order is **Task Tracker backend → web foundation → Task Tracker frontend → Calendar → Web Push → Cloudflare production**; readiness is proven by milestone acceptance, not an old date forecast.

**New agent or teammate? Read this file, then `CONTEXT.md`, ADR-0007, and ADR-0008 before taking work.** Use `docs/agents/onboarding.md` for setup and collaboration conventions, but use the status and issue graph below for the current queue.

## Status (2026-09-10)

- **Merged backend foundation:** 35 additive migrations; 31 pgTAP suites / **761 assertions**; JWT organization claims; deny-by-default RLS; tasks and points; the `my_points` own-total endpoint; Calendar/RSVP; announcements; notifications; invite/provisioning; and guarded local/staging demo data. CI rebuilds the database, runs all suites, checks generated types, checks Edge Functions, checks the frontend, and deploys migrations to staging only after a merge.
- **Merged Project foundation (#268–#274):** Projects, Project memberships, active lead/Responsible invariants, authorization helpers, read policies, BC/Moderator lifecycle commands, and lead-only membership/Responsible commands. Project commands derive the actor from `auth.uid()`, use server-side authorization, and serialize conflicting changes.
- **Frontend exists in `app/`:** Vite 8, React 19, TypeScript 6, React Router 7, TanStack Query, locally bundled Montserrat, authentication/route guards, responsive shell, Dashboard, Tracker foundations, and Calendar/RSVP views. Vitest/Testing Library currently cover **9 files / 55 tests**. Ionic is temporary migration code; the accepted target is Tailwind + shadcn/Base UI (Nova) + TanStack Table, browser-first and installable as a PWA — none of it is installed yet.
- **Current backend queue:** the team lane is #276 → #277 → (#278 and #279) → #280 → #281. Task normalization follows #283–#296, the 2026-09-10 schema issues #310–#321, the server commands #327–#345, and the leadership/points work #256–#262, each using its explicit `## Blocked by` section. Startable now: #276, #283, #285, #286, #287, #261, #65, #66, #310, #311, #313; on the web side #322 and #326.
- **Not built yet:** the normalized single-executor Task lifecycle, Candidate Queue and atomic Task commands (#327–#345); Campaigns, Umbrella Tasks, the `unfulfilled` outcome, Completed-work Requests, and notification fan-out (#310–#321, #65, #68; the notification tables still lack RLS policies); shadcn/PWA foundation (#322–#325); completed Task Tracker frontend (#164–#191, #346–#354); rebuilt Calendar scope model; Web Push provider; and Cloudflare production deployment. The legacy claim/open/multi-assignee paths are transitional and must not be extended.
- **Source of truth:** issue bodies and their numeric blockers define assignable work. ADR-0007 (amended 2026-09-10) defines the target Tracker model; ADR-0008 defines Calendar behavior; ADR-0002/0005 define the browser/PWA architecture and rollout. Older roadmap/spec/presentation text is historical where it conflicts.

## House rules (must follow)

1. **Never edit the database by hand.** Schema changes are migrations: `npx supabase migration new <name>` → SQL → `npx supabase db reset`. Studio is for looking, not changing.
2. **New tables enable RLS in the migration that creates them.** Deny-by-default; policies come separately.
3. **New views get `with (security_invoker = on)`** — otherwise they run as owner and bypass RLS.
4. **Functions used by triggers/policies:** `security definer` only when needed, always `set search_path = ''` with fully-qualified names.
5. **Tests ship with the feature, same PR** (`supabase/tests/*.sql`, pgTAP). A test must fail if the feature is removed. Verify locally: `npx supabase db reset && npx supabase test db` — both green before any PR.
6. **Reference data** (roles, departments, guides, suppression, promotion rules) lives **in migrations**; **demo data** lives in `supabase/seed.sql` (local/staging only, never production). **`db push` does not carry `seed.sql`** — a hosted project only gets demo data from the manual _Seed staging demo data_ workflow, so the file must stay re-runnable against a live database (CI checks this). See `docs/backend/seeding-staging.md`.
7. **One issue = one branch = one PR**, body says `Closes #n`. CI must be green. **Merging is a human act** — never merge or push to `main` directly (docs-only commits to `main` are the exception).
8. **Secrets never in git** — Bitwarden (humans) + GitHub Actions secrets (CI). Set secrets from a real terminal or browser; `gh secret set` through a non-interactive prompt stores an empty value.
9. **Never re-run one-shot scripts**: `scripts/create-github-issues.sh` (historical) and the 2026-08-19 backlog split are done.
10. **Spec Revision 3 supersedes older spec text where they conflict.** Known trap: notification suppression is **bc + bce** (Revision 3 §9.2), not the bc-only insert shown in spec §3.4.
11. Use `CONTEXT.md` vocabulary in code, issues, tests. When output contradicts an ADR (`docs/adr/0001–0008`), surface it — don't silently override.
12. **Every policy on `authenticated` must be unsatisfiable without org claims** — via `auth_level() >= N` (0 without claims) or explicitly via `auth_is_member()`. `to authenticated` is _not_ a membership check: it only excludes `anon`. `auth.uid()` is not one either — a deactivated member keeps their uid and their `profiles` row. The claimless sweep in `rls_deny_by_default.test.sql` enforces this; if it fails naming your table, your policy has an unconditional branch.
13. **ADR-0007 and ADR-0008 supersede the legacy Task/Calendar model.** Do not add behavior to multi-assignee Tasks, `open`/`overdue` stored statuses, award requests, direct client state changes, or level-4-global Calendar writes. Migrate toward one Executor, Assignment History, Candidate Queue, atomic commands, and scope-local authority.
14. **Respect issue blockers before assignment.** An open issue’s `## Blocked by` list is authoritative. Start it only when every listed issue is closed/merged. `None — can start immediately` means it is safe to take. If code reveals a missing dependency, update the issue before implementation.
15. **GitHub descriptions use real Markdown.** Use `## Goal`/`## What to build`, `## Why`, `## Implementation boundary`, `## Acceptance criteria`, `## Required tests`, and `## Blocked by` as appropriate. Never publish literal `\n` escape sequences or vague blockers such as “the schema issue”; link concrete `#issue` numbers.

## Agent skills

### Issue tracker

Issues are tracked in **GitHub Issues** (via the `gh` CLI) on `Alex-Bancila/osubb-app`. External pull requests are **not** a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles with default strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`); `max-1h` is a size label meaning "one focused hour or less". See `docs/agents/triage-labels.md`.

### Domain docs

**Single-context** — `CONTEXT.md` (domain glossary) + `docs/adr/` (ADRs 0001–0008) at the repo root. See `docs/agents/domain.md`. ADR-0007/0008 are authoritative for Tracker/Calendar. Mandate source documents: `docs/org/`; historical delivery calendar: `docs/roadmap.md`; team operating model: `docs/team/team-plan.md`.

## Backend / local development

The backend is **Supabase** (PostgreSQL + Row-Level Security + Auth + Edge Functions), managed as migrations in `supabase/`. Read ADR-0007/0008 before changing Tracker or Calendar behavior. The older architecture spec and `docs/backend/implementation-issues.md` provide history, but current GitHub issues and accepted ADRs win when they conflict.

**Prerequisites:** Docker Desktop running; Node. The Supabase CLI runs via `npx supabase` (no global install). Deno only for Edge Functions.

**Why Docker:** `npx supabase start` doesn't install anything on your machine — it starts ~9 Docker containers (Postgres, GoTrue/Auth, PostgREST/Kong, Studio, Mailpit, the edge runtime, …), pre-wired to match the hosted projects exactly. That's what makes "local" a real Supabase stack rather than a simulation, and why `db reset` can rebuild everything from zero in under a minute: containers are disposable, nothing on the host OS is ever touched.

**Run locally:**

- `npx supabase start` — bring up the local stack (first run pulls several GB of images).
- Studio → http://127.0.0.1:54323 · API → http://127.0.0.1:54321 · Mailpit (local email inbox, catches magic links) → http://127.0.0.1:54324
- `npx supabase db reset` — re-apply every migration + `seed.sql`.
- `npx supabase test db` — run all pgTAP suites.
- `npx supabase stop` — shut down.
- **Windows gotcha:** if start/reset fails with "port is not available / access permissions", Windows reserved our ports after a reboot → admin PowerShell: `net stop winnat` then `net start winnat`. If `git ls-files --eol | grep w/crlf` lists files, an editor wrote CRLF into your checkout: restore only those files — `git ls-files --eol | grep w/crlf | cut -f2 | xargs git checkout --` (the tab-delimited second field is the path) — rather than `git checkout -- .`, which would discard any other uncommitted work in the tree. `.gitattributes` (`eol=lf`) is what keeps checkouts LF; `.editorconfig` only keeps editors writing LF going forward.

**Environments:** local (Docker) → **staging** (hosted, auto-updated on merge to `main` via CI) → **production** (Supabase Pro, Spend Cap ON — created in Sprint 3, deploys only via a manually-approved workflow, issue #78). The CI staging job **skipping on PR builds is correct** — deploys happen on merge only.

**Auth is invite-only** (ADR-0003): public sign-up disabled; accounts are created via admin magic-link invite / CSV import; the JWT claims hook stamps role/level/depts/teams; RLS denies anyone without an `activ` `profiles` row. Hosted projects need dashboard config that `config.toml` can't carry (signup off, hook enabled) — see issue #54.
