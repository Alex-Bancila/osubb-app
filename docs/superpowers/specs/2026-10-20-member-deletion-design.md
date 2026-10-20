# Member Deletion — design

- **Date:** 2026-10-20
- **Decided by:** Alex Băncilă, in the grill session of 2026-10-20 (ruling R59)
- **Status:** built (#1087).
- **Amends:** nothing; adds the glossary term **Member Deletion** to `CONTEXT.md` §Access.

## The request

> "add the option to delete an account for good. This crud should be only done by a BC/Moderator for now, i will come with different members that could delete a volunteer later. But right now, i made a mistake and added an account that does not exist, and i cannot delete it from the app. I want you to add the option to permanently delete a user."

## What exists (main at 3b2b9809)

Nothing in the app deletes a Member. Deactivation (`set_member_status`) keeps the Profile and its history. The login and the Profile are joined by one foreign key, and it cascades:

- `profiles.id` references `auth.users (id) on delete cascade`, so deleting the login deletes the Profile.
- **17 tables cascade from `profiles`**: `announcement_reads`, `assignment_team`, `deal_code_reveals`, `event_attendance`, `group_applications` (`member_id`), `group_members`, `member_group_unselected`, `member_imports`, `notification_email_preferences`, `notification_push_preferences`, `notifications`, **`points_ledger`**, `privacy_notice_acknowledgements`, `private.email_digests`, `push_tokens`, **`task_assignments`**, `task_candidates` (`member_id`).
- **24 columns are `NO ACTION`** and refuse the delete when they name the Member: `announcements` (`created_by`, `approval_decided_by`), `campaigns.created_by`, `completed_work_requests` (`requester_id`, `decided_by`), `evaluation_settings.updated_by`, `events` (`created_by`, `approval_decided_by`), `group_applications.decided_by`, `org_settings.updated_by`, `points_ledger.awarded_by`, `promotion_candidates` (`member_id`, `decided_by`), `promotion_threshold_changes.changed_by`, `promotion_thresholds.updated_by`, `retention_signals.member_id` (R58, #1082), `role_evaluations.run_by`, `role_history` (`member_id`, `changed_by`), `task_activity.actor_id`, `task_candidates.decided_by`, `task_evaluations` (`evaluated_by`, `reversed_by`), `tasks.created_by`.
- **5 are `SET NULL`**: `assignment_team.set_by`, `groups.created_by`, `legacy_task_imports.imported_by`, `member_imports.imported_by`, `task_assignments.assigned_by`.
- `auth.users` cascades into `identities`, `sessions` (and through them `refresh_tokens`), `mfa_factors`, `one_time_tokens`, the OAuth and WebAuthn tables. `auth.flow_state.user_id` has no foreign key.
- `role_history` is immutable: `private.guard_role_history` refuses every UPDATE and DELETE.

The cascade is the hazard. An unchecked delete of a Member who was credited directly (`create_completed_task`, R51) or by the Legacy Import erases their Task Points and Assignment History without a word, because nothing `NO ACTION` names them. The Supabase dashboard's "Delete user" does exactly that today. "Never signed in" is no safe test either: the Legacy Import gave Task Points to 219 Members, many of whom have not signed in yet.

The hosted `postgres` role, which owns every function the migrations create, may `delete` from `auth.users` (checked on production on 2026-10-20; `auth.users` is owned by `supabase_auth_admin`).

## Decisions (ruling R59)

Each numbered point is one answer Alex gave, in the order asked; where he took the recommendation, it is written out.

1. **v1 deletes only a Member with no history.** It refuses every other Member with a reason that names what holds the account. Sign-in plays no part. Erasing a Member with history is its own later design (§Later).
2. **What goes with the account, and what holds it.** Rows that are only the account's own go with it: ordinary Group memberships (`group_members` with `group_role = 'member'`), its Notifications, push devices, notification and email preferences, Email Digests, Grupuri preferate, Announcement reads, Deal Code reveals, Privacy Acknowledgements, its volunteer-import record (`member_imports.member_id`), and **the Role and Status History about it**, so an account already deactivated can still be deleted. Everything else holds it: any Task it created, an Assignment, a Candidature, Task Activity it acted in, an Evaluation it made or reversed, a Points Ledger row in its name or awarded by it, a Completed-work Request, an Event or an RSVP, an Announcement, a Campaign, a Group Application, a Group Manager or Group Responsible position, a seat on the OSUBB Deals team, a Promotion Candidate, a Retention Signal, and every decision it recorded: Role changes of others, Applications or Candidatures it decided, Groups it created, imports it ran, Role Evaluations it ran, settings and thresholds it changed. A `SET NULL` actor column holds the account too: a decision someone made stays theirs.
3. **Placement.** A **Ștergere** panel at the end of the Member page's **Cont** tab, shown only to BC and the Moderator and never on one's own page. It reads the preview when the page opens. With no history it shows a red **Șterge definitiv** that opens the house `DeleteForGoodDialog`, which lists what goes with the account and asks for the full name to be typed. With history there is no button, only one line naming what holds the account, pointing to deactivation under **Roluri**.
4. **Who.** BC and the Moderator, at live level ≥ 6, through one private rule (`private.can_delete_member(actor, member)`) that Alex can widen later ("different members that could delete a volunteer") without touching the command. Never oneself. Never the last active BC member or the last active Moderator (the R31 last-holder rule; a deletion names no replacement, so it refuses).
5. **One SQL command deletes the login.** `public.delete_member` (invoker wrapper) over `private.delete_member_impl` (`security definer`) locks the Member, checks for history and deletes their `auth.users` row in one transaction. The cascade removes the Profile and the account's own rows. An Edge Function would split the check (SQL) and the delete (Auth's admin API) across two systems with no shared transaction, so a Task assigned in the gap would be erased by the cascade. The trade-off: Auth's admin API is skipped, so Auth writes no log line of its own. An access token already issued stays valid for up to an hour but reads nothing, since RLS needs an `activ` Profile.
6. **Nothing survives.** No audit row, no reason field, no record that the account existed. In Alex's words: "nothing should survive, the gdpr states that the data of the volunteers will be deleted after they are not part of osubb anymore". So the command also deletes **other Members' Notifications that name the account**, such as the re-invite notice (`link = '/administrare/membri/<id>'`, its body carries the name and email) and any `promotion_candidate:<id>` / `retention_signal:<id>` subject, and the account's `auth.flow_state` rows. The hosting providers' own logs (Auth sign-in logs, the email provider's send log, access logs) keep their own retention, as the Privacy Notice's _Date tehnice_ paragraph already says. The command does not reach into them.

## Design

### Database (one migration, dated after `20261018180000`)

- **`private.member_deletion_holds(p_member_id uuid) returns jsonb`.** The one definition of "history", **read from the catalog** rather than from a list: every foreign key into `profiles` or `auth.users` outside the `auth` schema holds the account, except the account's own columns (`private.member_deletion_goes`), an ordinary Group membership (`group_members` with `group_role = 'member'`) and the Role History about the Member (`role_history.member_id`, and `changed_by` on those same rows). One key per referencing column (`tasks.created_by`, `points_ledger.member_id`…) with its count, only the non-zero ones. A table added later therefore holds accounts until someone adds its column to the account's own list, which is the safe default; the suite proves it with a table created inside the test. The page maps each table to Romanian copy. Not granted to anyone.
- **`private.member_deletion_goes(p_member_id uuid) returns jsonb`.** The account's own rows, counted by table, for the preview's list of what goes.
- **`private.member_last_holder(p_member_id uuid) returns text`.** `'bc'` or `'moderator'` when the Member is the last active holder, else null.
- **`private.can_delete_member(p_actor uuid, p_member uuid) returns boolean`.** Live `activ` actor at level ≥ 6 and `p_actor <> p_member`. The only authority rule; `private.require_member_deleter(p_member_id) returns uuid` raises `42501 member_manage_forbidden` when it is false (claimless and inactive callers included, through `private.require_active_member()`).
- **`public.member_delete_preview(p_member_id uuid) returns jsonb`** (invoker wrapper + definer `_impl`): `{ holds: {…}, goes: { group_memberships, notifications, devices, … }, last_holder: 'bc' | 'moderator' | null }`. Same gate and same `PT404` as the command. It locks nothing.
- **`public.delete_member(p_member_id uuid) returns jsonb`** (invoker wrapper + definer `_impl`), in the house steps:
  1. `PT400 invalid_member` for a null id.
  2. `private.require_member_deleter`.
  3. One id-ordered statement locks the target, the actor and every live `activ` holder of `bc` and `moderator` **`for update`**. `for update`, not `for no key update`: the key itself is deleted, and only `for update` conflicts with the `for key share` lock every foreign-key insert takes on the Profile. So a concurrent write that would name the Member (an Assignment, a Candidature, an RSVP…) either commits first and is seen by step 5, or waits and then fails on the missing key. No row is ever cascaded away unseen.
  4. `PT404 member_not_found`; the actor re-read under the lock (`42501 member_manage_forbidden` after a concurrent demotion).
  5. `PT409 member_is_last_bc` / `member_is_last_moderator`, then `PT409 member_has_history`, its DETAIL listing the non-zero keys with their counts.
  6. Deletes the other Members' Notifications naming the account, the account's `role_history` rows (the guard admits a DELETE only for the `member_id` named in the transaction-local setting `osubb.deleting_member_id`, never for a client role), its `auth.flow_state` rows, then `delete from auth.users where id = p_member_id`.
  7. Returns `{ "member_id": … }`.
- `private.guard_role_history` is re-issued from `main`'s latest body with the one DELETE exception. Its `vot` rule stays as it is.
- Grants: the four-role revoke on every function; `authenticated` gets the two wrappers and their `_impl`s; no grant on `require_member_deleter`, `can_delete_member`, `member_deletion_holds`, `member_deletion_goes` or `member_last_holder`.

### Tests (`supabase/tests/member_deletion.test.sql`, same PR)

- Persona × operation for both functions: claimless, `anon`, an inactive BC, a BCE, a Group Manager below level 6 → `42501`; self → `42501`; BC and the Moderator succeed.
- A fresh invited Member (Profile, an Appointment, a Notification, a push device, a Privacy Acknowledgement, an import record, a deactivation in Role History) is deleted. Afterwards no row anywhere names the id, the BC's re-invite Notification about it is gone, and `auth.users` and `auth.identities` are empty for it.
- One fixture per holding kind refuses with `PT409 member_has_history` and a DETAIL naming that kind, and writes nothing.
- The last active BC member and the last active Moderator refuse; a second active holder lets the delete through.
- **A table added later holds the account:** the suite creates a table with a cascading foreign key into `profiles`, and the deletion refuses naming it. After a deletion, a catalog sweep counts every row in every table whose foreign key names the id, and finds none.
- A race through `pg_temp.test_race`: session A holds an uncommitted Candidature for the Member, session B's `delete_member` waits, then refuses with `member_has_history`.
- `tracker_grants.test.sql`'s roster and count pin grow by the new functions; `role_history`'s guard still refuses a client DELETE.

### Frontend

- `app/src/queries/member-deletion.ts`: `useMemberDeletePreview(memberId, enabled)` and `useDeleteMember()`. On success it drops the Member's queries and the Membri list.
- `MemberDeletePanel` at the end of Cont, mounted behind `manageRoles` and never for the viewer's own id. Copy for every `holds` key. The dialog lists `goes`, asks for the full name, and on success returns to Administrare → Membri with the receipt _„Contul lui <nume> a fost șters definitiv.”_
- `app/src/lib/command-reasons.ts`: `invalid_member`, `member_has_history`, `member_is_last_bc`, `member_is_last_moderator` (`member_manage_forbidden` and `member_not_found` exist).
- vitest for the panel's three states (loading, deletable, held), the typed-name gate, each refusal's copy and the receipt.

### Docs in the same PR

`docs/backend/conventions.md` (a paragraph beside R38's "Deleting for good"), `docs/backend/inviting.md` (deleting a mistaken invitation), `docs/README.md` (this spec), one `CLAUDE.md` status line.

## Notes

- A Member created by the volunteer import loses their `member_imports` row with them. Running the import again on an unchanged sheet creates them again, so the sheet row is fixed first.
- Deleting a Member never changes a total, since a Member with Task Points cannot be deleted.

## Later

- **Erasing a Member with history** (Privacy Notice §7, "dreptul la ștergere"): taking back their Task Points, removing or anonymising their Tasks, Events, RSVPs and decisions. Totals change retroactively. **Open for that design:** Alex said on 2026-10-20 that volunteers' data is deleted once they are no longer part of OSUBB. The Privacy Notice in force says the opposite (`docs/legal/politica-de-confidentialitate.md`, _După încheierea calității de membru_: the account becomes inactive; name, Roles, Tasks and points stay in the organization's history; full deletion only on request). One of them changes, and a Notice change is a new version every Member acknowledges.
- Widening who may delete (Alex's "different members that could delete a volunteer"): a change to `private.can_delete_member` alone.
- A delete action in the **De invitat** grid for imported Members never invited.
