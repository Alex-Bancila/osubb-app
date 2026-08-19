# OSUBB App

Internal application for **OSUBB** (Organizația Studenților din Universitatea Babeș-Bolyai, Cluj): tasks with gamified points, calendar + RSVP, announcements, in-app notifications, and member/role management for an 8-role × 5-department organization.

**Targets:** BC demo ~Sep 15, 2026 · live for BC/BCE Oct 1 · org-wide November.

**Stack:** Supabase (PostgreSQL + Row-Level Security + Auth magic links + Edge Functions) · migrations-as-code with pgTAP tests · GitHub Actions CI with auto-deploy to staging · frontend (Sprint 2): Vite + React + TypeScript + Ionic, Capacitor later · Cloudflare Pages hosting. Decisions are recorded as ADRs in `docs/adr/`.

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

Work is cut into **≤1-hour issues** (label `max-1h`), each with goal, reasoning, steps, and acceptance criteria: `gh issue list --label max-1h --state open`. The loop: branch → build → `db reset` + `test db` green → PR with `Closes #n` → CI green → review → merge (staging updates automatically).

- **People:** start with `docs/team/team-plan.md` and the kickoff handout.
- **AI agents:** start with `CLAUDE.md` (rules) and **`docs/agents/onboarding.md`** (state of the codebase, patterns to copy, current queue, known traps).

## Where everything is written down

| Question | File |
|---|---|
| What do the words mean? | `CONTEXT.md` (domain glossary) |
| Why is X built this way? | `docs/adr/0001…0006` |
| What exists / what's next? | `docs/backend/implementation-issues.md` (backlog map) |
| When is what due? | `docs/roadmap.md` |
| How do we work as a team? | `docs/team/team-plan.md` |
| Full technical design | `docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md` (incl. Revision 3) |
| Requirements source (RO) | `docs/org/` |
| Tech-stack comparison | `docs/osubb-app-tech-stack.md` |

Private repo · secrets live in Bitwarden + GitHub Actions secrets, never in git.
