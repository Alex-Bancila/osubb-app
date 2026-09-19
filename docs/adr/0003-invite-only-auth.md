# ADR-0003 — Invite-only access with magic-link provisioning

- **Status:** Accepted
- **Date:** 2026-07-07
- **Amended:** 2026-09-19 — magic links are the only member sign-in method in v1 (#204)
- **Deciders:** Alex Băncilă + team
- **Supersedes:** —
- **Superseded by:** —
- **Related:** —

## Context

The app is an internal org tool. Real volunteers use **personal email addresses** (mostly Gmail), so restricting sign-in to an `@osubb.ro` domain would lock most members out. At the same time, random people must not be able to create accounts and land inside the org's data. Recruits are onboarded in bulk from a CSV at recruitment events.

## Decision

**Invite-only, magic-link-only access.** A provisioned Member signs in with an email magic link sent to their invited personal address. Magic links are the only member sign-in method in v1: password login and Google OAuth are not part of the accepted member flow. Authentication alone never grants organization access; that requires a **BC-provisioned `profiles` row**. Concretely:

1. **Public sign-up is disabled** in Supabase Auth (`enable_signup = false`).
2. Accounts are created only by BC via an **admin magic-link invite** — individually, or in bulk through the **CSV recruit import** Edge Function (Epic 4.1). The invite creates the `auth.users` row + the `profiles` row (with role/departments/teams) in one step.
3. **RLS is the backstop:** a member with no `profiles` row (or `status <> 'activ'`) is denied every row, so even an authenticated stranger sees nothing.

Recruits receive a **magic-link email**, and subsequent sign-ins use another magic link to the same invited address. There are no temporary member passwords or alternate-provider sign-in paths. The local/staging demo password fixtures remain development tools, not a member authentication method. This decision changes neither provisioning nor the signed-in-without-profile state.

## Consequences

- **+** No password handling/distribution; volunteers use whatever email they already have.
- **+** Two independent gates (no sign-up + RLS-needs-profile) — defense in depth.
- **−** Every member must be invited/imported before first login; there is no self-service onboarding (acceptable and desired for an internal tool).
- **+** One member sign-in flow avoids password recovery and provider-linking complexity, and makes invite-only behavior easier to explain and test.
- **−** Sign-in depends on email delivery and access to the invited mailbox; magic links must be short-lived and their redirect destinations controlled. This is the deliberate simplicity/security tradeoff instead of maintaining additional sign-in methods.

## Amendment (2026-08-23) — what "gate 2" means in practice

Gate 2 is enforced through the **JWT claims**, not through a database lookup on every request: the access-token hook stamps `member_role` only for a profile with `status = 'activ'`, so the presence of org claims _is_ proof of membership. `auth_is_member()` is that check, and house rule 12 requires every policy to depend on it (or on a level threshold, which is 0 without claims).

Two consequences worth stating plainly:

- **`auth.uid()` does not prove membership.** A deactivated member keeps their uid and their `profiles` row, so any policy keyed only on `auth.uid()` still admits them. This is not theoretical — it is how a suspended member could once claim an open graded task and have the ledger trigger award them the points (fixed 2026-08-23).
- **Deactivation takes effect within the token lifetime.** `jwt_expiry = 3600`, so a member set to `inactiv` keeps read access for at most one hour, then their refreshed token carries no claims and every policy denies. Decision (2026-08-23): this window is accepted rather than paid for with per-request database lookups — the whole point of putting claims in the token. To bound it, **the role-management UI must revoke the member's sessions** via the Auth admin API when it sets `status = 'inactiv'` (tracked on issue #105), which removes the refresh path and leaves only the unexpired access token.

Retention is unaffected: ADR-0006 keeps an alumnus's history in the database. What they lose is _access_, not their record.
