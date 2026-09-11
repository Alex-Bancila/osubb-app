# OSUBB App

Internal application for **OSUBB** (Organizația Studenților din Universitatea Babeș-Bolyai, Cluj): tasks with gamified points, calendar + RSVP, announcements, in-app notifications, and member/role management for an 8-role × 5-department organization.

**Delivery order:** Task Tracker backend → web foundation → Task Tracker frontend → Calendar → Web Push → Cloudflare production, gated by milestone acceptance rather than a date (see `CLAUDE.md`'s Status block for where that stands now).

**Stack:** Supabase (PostgreSQL + Row-Level Security + Auth magic links + Edge Functions) · migrations-as-code with pgTAP tests · GitHub Actions CI with auto-deploy to staging · a React 19 + Vite app in `app/` on TypeScript + React Router + TanStack Query, currently on temporary Ionic components; the target (ADR-0002) is a browser-first, installable PWA on Tailwind + shadcn/ui (Base UI, Nova) + TanStack Table, in progress on the web-foundation stack · Cloudflare hosting. Decisions are recorded as ADRs in `docs/adr/` — see `docs/adr/README.md` for the index.

## Quickstart (local backend)

Prerequisites: Docker Desktop (running), Node, Git.

```bash
git clone https://github.com/Alex-Bancila/osubb-app.git && cd osubb-app
npx supabase start        # first run downloads several GB
npx supabase db reset     # build the database from migrations + seed
npx supabase test db      # run all pgTAP suites → "All tests successful"
```

Studio (DB browser): http://127.0.0.1:54323 · Mailpit (local email inbox): http://127.0.0.1:54324

Windows note: if start/reset fails with "port is not available", run `net stop winnat && net start winnat` in an **admin** PowerShell.

## Contributing (team + agents)

Work is cut into **≤1-hour issues** (label `max-1h`), each with goal, reasoning, steps, and acceptance criteria: `gh issue list --label max-1h --state open`. The loop: branch → build → `db reset` + `test db` green → PR with `Closes #n` → CI green → review → merge (staging's **schema** updates automatically; its demo data is a separate manual workflow — `docs/backend/seeding-staging.md`).

- **People:** start with `docs/team/team-plan.md` and the kickoff handout.
- **AI agents:** start with `CLAUDE.md` (rules) and **`docs/agents/onboarding.md`** (state of the codebase, patterns to copy, current queue, known traps).

## Where everything is written down

`docs/README.md` is the index of every document here, marked authoritative or historical, with one line on what still holds — start there if a doc conflicts with what you're reading below.

| Question | File |
|---|---|
| What do the words mean? | `CONTEXT.md` (domain glossary) |
| Why is X built this way? | `docs/adr/README.md` (index of ADRs 0001–0008) |
| What exists / what's next? | `CLAUDE.md`'s Status block and the live GitHub issue graph |
| How do we work as a team? | `docs/team/team-plan.md` |
| Requirements source (RO) | `docs/org/` |

Private repo · secrets live in Bitwarden + GitHub Actions secrets, never in git.
