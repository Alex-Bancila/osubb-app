# ADR-0003 — Invite-only access with magic-link provisioning

- **Status:** Accepted
- **Date:** 2026-07-07
- **Amended:** 2026-08-23 — what "gate 2" means in practice: claims prove membership; deactivation revokes sessions
- **Amended:** 2026-09-20 — the emailed six-digit code beside the link; sessions refresh on focus; the demotion window; the revoke function; the Moderator seat and the first accounts
- **Deciders:** Alex Băncilă + team
- **Supersedes:** —
- **Superseded by:** —
- **Related:** —

## Context

The app is an internal org tool. Real volunteers use **personal email addresses** (mostly Gmail), so restricting sign-in to an `@osubb.ro` domain would lock most members out. At the same time, random people must not be able to create accounts and land inside the org's data. Recruits are onboarded in bulk from a CSV at recruitment events.

## Decision

**Invite-only access.** Anyone may _authenticate_ (email/password or Google, any address), but access requires a **BC-provisioned `profiles` row**. Concretely:

1. **Public sign-up is disabled** in Supabase Auth (`enable_signup = false`).
2. Accounts are created only by BC via an **admin magic-link invite** — individually, or in bulk through the **CSV recruit import** Edge Function (Epic 4.1). The invite creates the `auth.users` row + the `profiles` row (with role/departments/teams) in one step.
3. **RLS is the backstop:** a member with no `profiles` row (or `status <> 'activ'`) is denied every row, so even an authenticated stranger sees nothing.

Recruits receive a **magic-link email** (no passwords to generate or distribute). Members may later also sign in with Google if it matches their invited email (Supabase links identities by email).

## Consequences

- **+** No password handling/distribution; volunteers use whatever email they already have.
- **+** Two independent gates (no sign-up + RLS-needs-profile) — defense in depth.
- **−** Every member must be invited/imported before first login; there is no self-service onboarding (acceptable and desired for an internal tool).
- **−** Google OAuth for a brand-new (un-invited) address is refused — expected behavior, must be documented for users.

## Amendment (2026-08-23) — what "gate 2" means in practice

Gate 2 is enforced through the **JWT claims**, not through a database lookup on every request: the access-token hook stamps `member_role` only for a profile with `status = 'activ'`, so the presence of org claims _is_ proof of membership. `auth_is_member()` is that check, and house rule 12 requires every policy to depend on it (or on a level threshold, which is 0 without claims).

Two consequences worth stating plainly:

- **`auth.uid()` does not prove membership.** A deactivated member keeps their uid and their `profiles` row, so any policy keyed only on `auth.uid()` still admits them. This is not theoretical — it is how a suspended member could once claim an open graded task and have the ledger trigger award them the points (fixed 2026-08-23).
- **Deactivation takes effect within the token lifetime.** `jwt_expiry = 3600`, so a member set to `inactiv` keeps read access for at most one hour, then their refreshed token carries no claims and every policy denies. Decision (2026-08-23): this window is accepted rather than paid for with per-request database lookups — the whole point of putting claims in the token. To bound it, **the role-management UI must revoke the member's sessions** via the Auth admin API when it sets `status = 'inactiv'` (tracked on issue #105), which removes the refresh path and leaves only the unexpired access token.

Retention is unaffected: ADR-0006 keeps an alumnus's history in the database. What they lose is _access_, not their record.

## Amendment (2026-09-20) — the sign-in code, stale claims, and who holds the keys

**The link and the code are one OTP.** Every magic-link and invite email carries both the link and the six-digit code Supabase issues with it. The code exists for two cases the link cannot serve: the installed app on iPhone, whose storage is separate from Safari's so a link tapped in Mail signs in the wrong context, and a link opened on a different device than the one that typed the address. Typing the code into the login screen completes the same OTP with the same expiry; an address without a `profiles` row still receives no claims. This changes nothing about invite-only access and adds no second auth path.

**Claims refresh on focus.** The token is refreshed when the app regains focus and the token is more than about fifteen minutes old, so a promotion, a confirmed Drept de Vot, or a Group's changed Minimum Level reaches the Member's reads within minutes. The one-hour expiry is unchanged.

**Demotion keeps the same window as deactivation.** A Member demoted from BC keeps level-6 claims for up to an hour. Decision: accepted, for the same reason as the 2026-08-23 amendment. Stale claims affect reads only; every write goes through a command that reads the actor's live Level from the database, so a demoted Member cannot act on their old rank, only see what it saw. Sessions are revoked on deactivation, not on demotion.

**The revoke path is an Edge Function.** A Postgres command cannot call the Auth admin API, so "the role-management UI must revoke the member's sessions" is a dedicated `revoke-sessions` Edge Function that reads the caller's level from the database and refuses unless the target is already `inactiv`. The Administrare status editor calls the deactivation command, then the function; if the function fails, the window above applies and the interface says so.

**The Moderator seat is transferable; the first accounts are bootstrapped once.** Moderator is a Role held by the IT Coordinator on their own address, not a shared mailbox: the sitting Moderator grants it to the successor, who then removes it from the predecessor; nobody may change their own Role or Status, and only a Moderator may change a Member holding BC or Moderator, so the seat can never be emptied by its holder or by BC. On a fresh production database the Moderator and the first BC/BCE Members are created by a one-shot service-role script, the only time the service key provisions anyone; every later account comes through the invite, the CSV import, or Administrare, each of which appoints the new Member's initial Groups.
