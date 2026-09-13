# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

**This repo is single-context:** one `CONTEXT.md` + `docs/adr/` at the repo root. Both exist — `CONTEXT.md` is the OSUBB domain glossary, and `docs/adr/` holds ADRs 0001–0008. ADR-0007 is authoritative for the Task Tracker model and ADR-0008 for Calendar behavior. New ADRs get the next number in sequence; the domain-modeling skills add terms and decisions lazily as they get resolved.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo (this repo):

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-supabase-postgres-rls.md
│   ├── 0002-frontend-browser-pwa.md
│   ├── 0003-invite-only-auth.md
│   ├── 0004-promotion-policy.md
│   ├── 0005-rollout-strategy.md
│   ├── 0006-data-retention.md
│   ├── 0007-task-tracker-lifecycle.md
│   └── 0008-calendar-visibility.md
└── (app source)
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
