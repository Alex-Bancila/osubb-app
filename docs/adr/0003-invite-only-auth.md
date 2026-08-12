# ADR-0003 — Invite-only access with magic-link provisioning

- **Status:** Accepted (2026-07-07)
- **Deciders:** Alex Băncilă + team

## Context

The app is an internal org tool. Real volunteers use **personal email addresses** (mostly Gmail), so restricting sign-in to an `@osubb.ro` domain would lock most members out. At the same time, random people must not be able to create accounts and land inside the org's data. Recruits are onboarded in bulk from a CSV at recruitment events.

## Decision

**Invite-only access.** Anyone may *authenticate* (email/password or Google, any address), but access requires a **BC-provisioned `profiles` row**. Concretely:

1. **Public sign-up is disabled** in Supabase Auth (`enable_signup = false`).
2. Accounts are created only by BC via an **admin magic-link invite** — individually, or in bulk through the **CSV recruit import** Edge Function (Epic 4.1). The invite creates the `auth.users` row + the `profiles` row (with role/departments/teams) in one step.
3. **RLS is the backstop:** a member with no `profiles` row (or `status <> 'activ'`) is denied every row, so even an authenticated stranger sees nothing.

Recruits receive a **magic-link email** (no passwords to generate or distribute). Members may later also sign in with Google if it matches their invited email (Supabase links identities by email).

## Consequences

- **+** No password handling/distribution; volunteers use whatever email they already have.
- **+** Two independent gates (no sign-up + RLS-needs-profile) — defense in depth.
- **−** Every member must be invited/imported before first login; there is no self-service onboarding (acceptable and desired for an internal tool).
- **−** Google OAuth for a brand-new (un-invited) address is refused — expected behavior, must be documented for users.
