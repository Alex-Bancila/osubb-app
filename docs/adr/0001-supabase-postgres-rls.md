# ADR-0001 — Supabase (PostgreSQL + Row-Level Security) as the backend

- **Status:** Accepted (2026-07-07)
- **Deciders:** Alex Băncilă (IT Coordinator) + team
- **Context docs:** `docs/osubb-app-tech-stack.md` §10.3, `docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md`

## Context

The app's defining requirement is **complex relational access control** — 8 roles × 5 departments with row-level rules (e.g. "a volunteer sees only their own tracker; BC sees all sheets"). The data is relational (members ↔ departments ↔ tasks ↔ points ↔ leaderboards). Scale is small (≤500 concurrent users, ≤1000 volunteers) and the budget is an NGO one. The team accepts a learning curve but is small and non-senior-led, so operational burden must stay low.

## Decision

Use **Supabase** as the single backend: managed **PostgreSQL** with **Row-Level Security (RLS)** as the authorization engine, plus Supabase **Auth** (email + Google), **Storage**, **Realtime**, and **Edge Functions**.

- Authorization is expressed as **SQL RLS policies** keyed off the member's role/level/departments/teams, carried in the JWT via a custom access-token hook. The client holds no authority.
- The database schema is managed as **migration files in git** (Supabase CLI) — no dashboard-clicking, no drift.

## Consequences

- **+** RLS is the only option that natively expresses relational, attribute-derived row rules and enforces them at the data layer regardless of client.
- **+** One managed service covers auth, DB, storage, realtime, and serverless functions — minimal ops for a small team. Postgres is the most portable/low-lock-in target (`pg_dump` anywhere).
- **+** Free tier for development; **Pro ($25/mo)** at launch for daily backups, no idle auto-pause, and 500 realtime connections.
- **−** RLS has a real learning curve and must be tested carefully (a per-role test suite, Epic 6) to avoid data-leak bugs.
- **Rejected:** Firebase/Firestore (NoSQL fights relational RBAC; uncapped billing risk), Appwrite (permission model can't derive relational row rules), fully-custom backend (rebuild/operate auth, realtime, storage — too much ops for this team).
