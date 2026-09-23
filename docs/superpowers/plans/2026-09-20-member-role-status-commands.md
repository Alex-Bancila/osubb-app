# Member Role and Membership Status Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish issue #580's atomic Member Role and Membership Status commands, audit trail, direct-write closure, and Role-change Notification.

**Architecture:** Continue the user-owned migration and pgTAP suite already present on `feat/580-member-commands`, which is stacked on `feat/50-role-history`/PR #527. Keep the public invoker/private definer command boundary, add one direct `system` Notification to successful Role changes, and leave all Group roster and Application mutations to the separately blocked follow-up.

**Tech Stack:** PostgreSQL PL/pgSQL, pgTAP, Supabase Auth/RLS, Supabase CLI 2.117.0

**Spec:** `docs/superpowers/specs/2026-09-20-stabilization-member-auth-design.md`

## Global Constraints

- Work in the existing `feat/580-member-commands` checkout; do not clean, reset, or switch it.
- Preserve every pre-existing modified and untracked file; stage exact paths only.
- Keep #580 stacked on open PR #527 until that prerequisite merges.
- Do not mutate `groups`, `group_members`, legacy roster tables, or future Group Applications.
- Membership Status changes never alter rosters and never notify.
- Role changes notify only the active target; `private.notify` filters the actor.
- Do not review or merge any pull request.

---

### Task 1: Capture the started implementation baseline

**Files:**
- Inspect: `supabase/migrations/20260920192117_member_role_status_commands.sql`
- Inspect: `supabase/tests/member_commands.test.sql`
- Inspect: `supabase/tests/rls_profiles_write.test.sql`
- Inspect: `supabase/tests/tracker_grants.test.sql`

**Interfaces:**
- Consumes: the uncommitted #580 command implementation and its existing 49-assertion suite.
- Produces: a precise baseline without changing user-owned work.

- [ ] **Step 1: Record status and diff**

Run `git status --short`, then inspect these exact paths:

```powershell
git diff -- CONTEXT.md docs/adr/0003-invite-only-auth.md docs/adr/0004-promotion-policy.md docs/adr/0008-calendar-visibility.md docs/adr/0009-groups.md supabase/tests/rls_profiles_write.test.sql supabase/tests/tracker_grants.test.sql
git diff --no-index NUL supabase/migrations/20260920192117_member_role_status_commands.sql
git diff --no-index NUL supabase/tests/member_commands.test.sql
```

Expected: only the already-known user-owned changes are present.

- [ ] **Step 2: Reset the local database with the untracked migration included**

Run: `npx supabase db reset`.

Expected: the migration applies; if it fails, fix only a demonstrated #580 defect and retain the exact failing output.

- [ ] **Step 3: Run the existing focused suite**

Run: `npx supabase test db supabase/tests/member_commands.test.sql`.

Expected: all currently planned assertions pass before adding the missing Notification contract.

### Task 2: Add a failing Role Notification contract

**Files:**
- Modify: `supabase/tests/member_commands.test.sql`
- Modify: `supabase/migrations/20260920192117_member_role_status_commands.sql`

**Interfaces:**
- Consumes: `private.notify(uuid[], public.noti_kind, text, text, uuid, text, uuid)`.
- Produces: one `system` Notification for the changed Member after `public.set_member_role(uuid, member_role)`.

- [ ] **Step 1: Add mutation-sensitive pgTAP assertions**

After an active target's successful Role change, assert the literal stored result:

```sql
select is(
  (select format('%s|%s|%s|%s', kind, title, body, coalesce(link, ''))
     from public.notifications
    where member_id = '58000000-0000-0000-0000-000000000004'
    order by created_at desc limit 1),
  'system|Rol actualizat|Rolul tău în OSUBB este acum BCE.|',
  'a successful Role change sends the active target one direct system Notification');

select is(
  (select count(*) from public.notifications where member_id = '58000000-0000-0000-0000-000000000002'),
  0::bigint,
  'the Role command never echoes its Notification to the actor');
```

Use fixture UUID literals already declared in this suite; do not invent a second fixture vocabulary. Add a separate `vot` assertion with the literal AG sentence from the spec, and assert that the existing Membership Status call leaves the target's Notification count unchanged.

- [ ] **Step 2: Run the focused suite to verify red**

Run: `npx supabase test db supabase/tests/member_commands.test.sql`.

Expected: FAIL only on the new Notification assertions because the command does not call `private.notify` yet.

- [ ] **Step 3: Load the Role display name and notify after the audited update**

In `private.set_member_role_impl`, select the new display name from `public.roles`, then call:

```sql
perform private.notify(
  array[p_member_id],
  'system'::public.noti_kind,
  'Rol actualizat',
  case
    when p_role = 'vot' then
      'Rolul tău în OSUBB este acum Voluntar cu Drept de Vot. Ești membru al Adunării Generale.'
    else
      'Rolul tău în OSUBB este acum ' || v_role_name || '.'
  end,
  null,
  null,
  v_actor
);
```

Keep this inside the same transaction as the Profile update and `role_history` insert. Do not notify from `set_member_status_impl`.

- [ ] **Step 4: Document the temporary Group boundary in the function comment**

State that Group Roles are independent, Membership Status never edits rosters, and Minimum-Level cleanup is deferred until the native Group roster and Application model exists. Do not promise behavior the function does not perform.

- [ ] **Step 5: Run the focused suite to verify green**

Run: `npx supabase test db supabase/tests/member_commands.test.sql`.

Expected: every planned assertion passes, including normal Role copy, `vot` copy, actor filtering, and silent Membership Status changes.

### Task 3: Close the command, audit, grant, and roster boundaries

**Files:**
- Modify: `supabase/tests/rls_profiles_write.test.sql`
- Modify: `supabase/tests/tracker_grants.test.sql`
- Modify: `CONTEXT.md`
- Modify: `docs/adr/0003-invite-only-auth.md`
- Modify: `docs/adr/0004-promotion-policy.md`
- Modify: `docs/adr/0008-calendar-visibility.md`
- Modify: `docs/adr/0009-groups.md`

**Interfaces:**
- Consumes: wrappers `public.set_member_role` and `public.set_member_status` and private `_impl` functions.
- Produces: authenticated execute only on wrappers/implementations, no authenticated direct column updates, and docs matching the approved split.

- [ ] **Step 1: Verify the existing boundary assertions are behavior-based**

Ensure the tests execute functions and attempt actual direct writes instead of grepping migration text. They must catch removal of the column privilege revoke, widening wrapper access, or a Role-history row changing both dimensions.

- [ ] **Step 2: Add the safe Group preservation case**

Use an existing fixture whose memberships all have `minimum_level` at or below both old and new Roles. Snapshot that Member's `group_members` rows, execute the Role change, and assert the rows are byte-for-byte unchanged. Keep the existing two-way Membership Status preservation assertions.

- [ ] **Step 3: Run focused security suites**

Run:

```bash
npx supabase test db supabase/tests/member_commands.test.sql
npx supabase test db supabase/tests/rls_profiles_write.test.sql
npx supabase test db supabase/tests/tracker_grants.test.sql
npx supabase test db supabase/tests/conventions.test.sql
```

Expected: all focused suites pass.

- [ ] **Step 4: Run the full backend verification**

Run `npx supabase test db`, database lint discovered via `npx supabase db lint --help`, and the database path of `bash scripts/check-local-ci.sh`.

Expected: exit 0 for each command. If #596 is not yet applied and a race suite fails only with its known cleanup signature, record that as an external blocker rather than masking it.

- [ ] **Step 5: Verify generated types do not drift**

Run `npm --prefix app run gen:types`, then `git diff --exit-code -- app/src/lib/database.types.ts`.

Expected: no generated type change; these commands return existing enum types and Profile rows.

- [ ] **Step 6: Inspect and commit exact #580 files**

Run `git diff --check`, inspect every #580 diff, then stage only the migration, the three SQL tests, and the approved domain/ADR edits that accurately describe this command boundary.

Commit message:

```bash
git commit -m "feat(members): add role and status commands"
```
