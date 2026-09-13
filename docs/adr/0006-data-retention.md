# ADR-0006 — Data retention: alumni keep history; deletion only on GDPR request

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** Alex Băncilă (IT Coordinator)
- **Supersedes:** —
- **Superseded by:** —
- **Related:** architecture spec §8.6, `docs/org/plan-managerial.md` §IV.4 (IMG&PR), ADR-0003

## Context

Spec §8.6 left open what happens to a member's points and history when they leave. The mandate plan itself answers part of it: IMG&PR wants **alumni and honorary members kept in the database** (birthday posts, historical reporting — Plan IV.4.iii and "centralizarea datelor pentru etapa de raportare istorică"). At the same time, members are real people with GDPR rights over personal data held by the NGO.

## Decision

1. **Default: leaving = `status → 'alumni'`, nothing is deleted.** The profile, ledger, task and attendance history remain; RLS already scopes who can see them (directory reads are level ≥ 5). Alumni/onorifici stay queryable for PR (birthdays) and historical reports.
2. **`profiles.birthday` is added** (Phase 2) as an **optional, consent-based** field — collected for the PR birthday use, never required.
3. **Hard deletion happens only on an explicit (GDPR) request:** delete the `auth.users` row → `profiles` and all personal rows cascade (`on delete cascade` is already in place across the schema). Consequence accepted: the member's ledger rows disappear, so historical leaderboards/dept totals recompute without them. No anonymized-stub scheme — at ≤1,000 records, simplicity beats aggregate-preserving complexity.
4. **Access revocation ≠ deletion:** setting `status = 'inactiv'`/`'alumni'` (or removing the role) cuts app access via RLS (ADR-0003's backstop) while preserving history.

## Consequences

- **+** Matches the org's actual needs (alumni birthdays, historical reporting) with zero extra machinery.
- **+** GDPR erasure is one operation with well-defined cascade semantics.
- **−** A GDPR deletion retroactively changes historical aggregates — accepted and documented; if a department cup season must stay frozen, snapshot it as a report before deleting.
- Data stays in Supabase's EU region (project created in EU) and is exportable via `pg_dump` (ADR-0001).
