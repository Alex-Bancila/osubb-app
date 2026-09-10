## Summary

<!-- What changed and why, in two or three sentences. Name the ADR / CONTEXT.md term when behavior changes. -->

Closes #

## Checks run locally

- [ ] `npx supabase db reset && npx supabase test db` (any change under `supabase/`)
- [ ] `cd app && npm run typecheck && npm run lint && npm run format:check && npm run test:run && npm run build` (any change under `app/`)
- [ ] `app/src/lib/database.types.ts` regenerated (`npm run gen:types`) if the schema changed

## Reviewer notes

<!-- Stacked PR? First line: "Base: <branch> — merge after #n". Anything deliberately left out? -->
