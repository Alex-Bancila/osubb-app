# Alex's assigned issues — Implementation Plan (2026-09-10)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Alex's eight assigned issues — six unblocked now (#363, #257, #310, #361, #360, #326) and two that wait on dobrerares' team lane (#279 ← #276/#277, #281 ← #280) — as one-issue-one-PR branches that never collide with the teammates' open work.

**Architecture:** Backend changes are additive Supabase migrations with a pgTAP suite in the same PR; frontend changes are config + small hook/provider edits with Vitest coverage. Ordering avoids file overlap with dobrerares (#364 adds `private.actor_level`, #287 changes `task_status`, #276/#277 change `teams`), PaulSchiop (#283/#285 on `tasks`) and SuperGod25 (#258/#261 on leaderboard/awards).

**Tech Stack:** PostgreSQL 15 via Supabase CLI 2.117 (`npx supabase`), pgTAP, React 19 + TypeScript + TanStack Query 5 + Vitest 4 + oxlint in `app/`.

**Spec:** GitHub issues #363, #257, #310, #361, #360, #326, #279, #281 (bodies are authoritative); ADR-0007 (amended 2026-09-10) and ADR-0008 in `docs/adr/`; house rules in `CLAUDE.md`.

## Global Constraints

- Never edit the database by hand; every schema change is `npx supabase migration new <name>` → SQL → `npx supabase db reset` (CLAUDE.md rule 1).
- `security definer` only when needed, always `set search_path = ''` with fully-qualified names (rule 4).
- Tests ship in the same PR; `npx supabase db reset && npx supabase test db` both green before opening it (rule 5).
- Every policy on `authenticated` must be unsatisfiable without org claims (rule 12).
- One issue = one branch = one PR, body says `Closes #n`; a human merges (rule 7). Branch name `feat/<n>-<slug>`; commit prefix `feat(db):` / `feat(app):` / `test(db):`; end commit messages with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` when Claude co-authors.
- Frontend gates before pushing: `cd app && npm run typecheck && npm run lint && npm run format:check && npm run test:run && npm run build`.
- Start every branch from a fresh `git checkout main && git pull --ff-only`; PR #355 (CLAUDE.md queue line) should be merged first so the status block matches.
- User-facing copy is Romanian with diacritics; identifiers English (CONTEXT.md).

## Recommended order and why

| #   | Issue                     | Area       | Why here                                                                                                                           |
| --- | ------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | #363 grants hardening     | DB         | Unblocked, no file overlap with anyone, smallest risk; the conventions sweep (#365, dobrerares later) builds on it.                |
| 2   | #257 ledger BCE reads     | DB         | One `alter policy` + one test edit; `points_ledger_read.test.sql` already has the placeholder case.                                |
| 3   | #310 Diverse/Secretariat  | DB + seed  | Touches `departments`/`teams` reference rows and `seed.sql`; land before #276/#277 change `teams` columns to keep rebases trivial. |
| 4   | #361 strict + lint        | app config | Do before #360/#326 so their new code is written under the stricter flags.                                                         |
| 5   | #360 cache clear + keys   | app        | Changes `queries/points.ts` key shape; #326 builds on it.                                                                          |
| 6   | #326 dashboard gating     | app        | Depends on #360's `useMyStanding` changes.                                                                                         |
| 7   | #279 dept-team membership | DB         | Wait for #276 and #277 to merge (dobrerares).                                                                                      |
| 8   | #281 role matrix          | DB tests   | Wait for #280 to merge (dobrerares).                                                                                               |

---

### Task 1: #363 — grants hardening migration

**Files:**

- Create: `supabase/migrations/<timestamp>_grants_hardening.sql` (via `npx supabase migration new grants_hardening`)
- Create: `supabase/tests/grants_hardening.test.sql`

**Interfaces:**

- Consumes: existing functions `public.rating_mult(int)`, `public.auth_level()`, `public.auth_role()`, `public.auth_in_dept(text)`, `public.auth_in_team(text)`, `public.auth_is_member()`, `public.in_my_dept(uuid)`; views `member_points`, `leaderboard`, `dept_cup`, `profiles_directory`, `profiles_contact`.
- Produces: same function signatures, now `set search_path = ''`, executable by `authenticated`/`service_role` only; views select-only; `in_my_dept` gone. Later tasks (#279) rely on `auth_in_dept(text)` still existing with the same name.

Facts you need: `auth_level/auth_in_dept/auth_in_team` bodies live in `20260819163238_jwt_claims_hook.sql:79-89`; `auth_is_member` in `20260822225003_profiles_read_policies.sql:21-22`; `auth_role` was already fixed in `20260830122310_set_event_rsvp.sql:10-17` (copy that exact `create or replace … set search_path = ''` form). Blanket DML on all tables/views comes from `20260819171628_capabilities_and_rls.sql:51-70`. The `my_points` revoke-then-grant pattern is `20260910111231_member_own_points.sql:22-23`. `in_my_dept` is referenced only by superseded versions of `ledger_read`; the live policy (`20260910123134`) no longer uses it, so dropping it after that migration is safe. `rating_mult` feeds the generated `tasks.points` column, so `authenticated` and `service_role` must keep execute.

- [ ] **Step 1: Branch and create the migration file**

```bash
git checkout main && git pull --ff-only
git checkout -b feat/363-grants-hardening
npx supabase migration new grants_hardening
```

- [ ] **Step 2: Write the failing test first**

Create `supabase/tests/grants_hardening.test.sql`:

```sql
-- #363: helper functions are not anon RPC surface, views are read-only,
-- JWT helpers pin search_path, the dead in_my_dept helper is gone.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap;
select plan(15);

-- search_path pinned on every JWT helper (auth_role was fixed in #237).
select is(
  (select count(*)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('auth_level','auth_role','auth_in_dept','auth_in_team','auth_is_member')
      and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'),
  5::bigint,
  'all five JWT helpers pin search_path'
);

-- anon holds no execute on any helper.
select is(has_function_privilege('anon', 'public.rating_mult(integer)', 'execute'), false, 'anon: rating_mult denied');
select is(has_function_privilege('anon', 'public.auth_level()', 'execute'), false, 'anon: auth_level denied');
select is(has_function_privilege('anon', 'public.auth_role()', 'execute'), false, 'anon: auth_role denied');
select is(has_function_privilege('anon', 'public.auth_in_dept(text)', 'execute'), false, 'anon: auth_in_dept denied');
select is(has_function_privilege('anon', 'public.auth_in_team(text)', 'execute'), false, 'anon: auth_in_team denied');
select is(has_function_privilege('anon', 'public.auth_is_member()', 'execute'), false, 'anon: auth_is_member denied');

-- authenticated keeps execute (policies and the generated points column need it).
select is(has_function_privilege('authenticated', 'public.auth_level()', 'execute'), true, 'authenticated: auth_level allowed');
select is(has_function_privilege('authenticated', 'public.rating_mult(integer)', 'execute'), true, 'authenticated: rating_mult allowed');

-- views: select only.
select is(has_table_privilege('authenticated', 'public.profiles_directory', 'insert'), false, 'profiles_directory: no insert');
select is(has_table_privilege('authenticated', 'public.leaderboard', 'update'), false, 'leaderboard: no update');
select is(has_table_privilege('authenticated', 'public.dept_cup', 'delete'), false, 'dept_cup: no delete');
select is(has_table_privilege('authenticated', 'public.member_points', 'insert'), false, 'member_points: no insert');
select is(has_table_privilege('authenticated', 'public.leaderboard', 'select'), true, 'leaderboard: select kept');

-- dead helper removed.
select hasnt_function('public', 'in_my_dept', array['uuid'], 'in_my_dept dropped');

select * from finish();
rollback;
```

- [ ] **Step 3: Run the suite to see it fail**

Run: `npx supabase db reset && npx supabase test db`
Expected: `grants_hardening.test.sql` fails on the search_path count (4 not 5), every anon-denied assertion, the view DML assertions, and `hasnt_function`.

- [ ] **Step 4: Write the migration**

Put this in the file created in Step 1:

```sql
-- #363: close default execute grants on the helper functions, make the
-- leadership views select-only, drop the dead in_my_dept helper, and pin
-- search_path on the JWT helpers (same fix #237 applied to auth_role).

-- 1 · JWT helpers, same bodies, now safe under an empty search_path.
create or replace function public.auth_level()
returns int
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'member_level')::int, 0)
$$;

create or replace function public.auth_in_dept(d text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' -> 'dept_ids' ? d, false)
$$;

create or replace function public.auth_in_team(t text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' -> 'team_ids' ? t, false)
$$;

create or replace function public.auth_is_member()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ? 'member_role', false)
$$;

-- 2 · Execute grants: policies run as the querying role, so authenticated
--     and service_role keep execute; anon and public never needed it.
revoke execute on function public.rating_mult(int)       from public, anon;
revoke execute on function public.auth_level()           from public, anon;
revoke execute on function public.auth_role()            from public, anon;
revoke execute on function public.auth_in_dept(text)     from public, anon;
revoke execute on function public.auth_in_team(text)     from public, anon;
revoke execute on function public.auth_is_member()       from public, anon;
grant execute on function
  public.rating_mult(int),
  public.auth_level(),
  public.auth_role(),
  public.auth_in_dept(text),
  public.auth_in_team(text),
  public.auth_is_member()
to authenticated, service_role;

-- 3 · Views: the blanket table grant from 20260819171628 (and its default
--     privileges) gave these views INSERT/UPDATE/DELETE. profiles_directory
--     is auto-updatable, so that grant was live. Same pattern as my_points.
revoke all on table
  public.member_points,
  public.leaderboard,
  public.dept_cup,
  public.profiles_directory,
  public.profiles_contact
from public, anon, authenticated, service_role;
grant select on table
  public.member_points,
  public.leaderboard,
  public.dept_cup,
  public.profiles_directory,
  public.profiles_contact
to authenticated, service_role;

-- 4 · Dead since 20260910123134 rewrote ledger_read without it.
drop function public.in_my_dept(uuid);
```

- [ ] **Step 5: Reset and run all suites**

Run: `npx supabase db reset && npx supabase test db`
Expected: all suites green including the new one. If any _existing_ suite that runs `set local role anon` now errors with `permission denied for function auth_level` instead of returning zero rows, the offending policy lacks `to authenticated` — fix that policy in this migration (`alter policy … to authenticated`) rather than re-granting to anon.

- [ ] **Step 6: Regenerate types and check drift**

Run: `cd app && npm run gen:types && git diff --exit-code src/lib/database.types.ts; cd ..`
Expected: no diff (a dropped function may remove an `in_my_dept` entry — if so, commit the regenerated file).

- [ ] **Step 7: Commit and open the PR**

```bash
git add supabase/migrations/*_grants_hardening.sql supabase/tests/grants_hardening.test.sql app/src/lib/database.types.ts
git commit -m "feat(db): revoke anon execute on helpers, make leadership views select-only, drop in_my_dept (#363)"
git push -u origin feat/363-grants-hardening
gh pr create --title "Security: harden helper grants and view privileges" --body "Closes #363"
```

---

### Task 2: #257 — BCE, BC, Moderator read the whole ledger

**Files:**

- Create: `supabase/migrations/<timestamp>_points_ledger_leadership_reads.sql`
- Modify: `supabase/tests/points_ledger_read.test.sql:135-141`

**Interfaces:**

- Consumes: policy `ledger_read` as left by `20260910123134_points_ledger_own_rows.sql:9-23`.
- Produces: `ledger_read` with threshold `auth_level() >= 5`; #258/#262 (SuperGod25) rely on this exact policy name.

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull --ff-only
git checkout -b feat/257-ledger-leadership-reads
npx supabase migration new points_ledger_leadership_reads
```

- [ ] **Step 2: Change the test first**

In `supabase/tests/points_ledger_read.test.sql` replace lines 135–141 with:

```sql
-- #257: BCE reads the whole ledger, like BC and Moderator.
select pg_temp.login('b5600000-0000-0000-0000-000000000005', 'bce', 5);
select is(
  (select count(*) from public.points_ledger),
  9::bigint,
  'BCE reads every ledger row'
);
reset role;
```

`plan(20)` at line 7 stays (one assertion replaced one). Keep the Responsabil case at 127–132 untouched — level 4 must remain own-only.

- [ ] **Step 3: Run to see it fail**

Run: `npx supabase db reset && npx supabase test db`
Expected: `points_ledger_read.test.sql` fails "BCE reads every ledger row" (got 1, expected 9).

- [ ] **Step 4: Write the migration**

```sql
-- #257: leadership (BCE, BC, Moderator) reads the whole points ledger;
-- Responsabil and below stay on their own rows. Same live-profile guard as
-- #256 so a stale token cannot outlive deactivation.
alter policy ledger_read on public.points_ledger
using (
  (select public.auth_is_member())
  and (select exists (
        select 1 from public.profiles p
         where p.id = (select auth.uid()) and p.status = 'activ'))
  and (member_id = (select auth.uid()) or (select public.auth_level()) >= 5)
);

comment on policy ledger_read on public.points_ledger is
  'Own rows for everyone; whole ledger for level >= 5 (BCE, BC, Moderator). #257';
```

- [ ] **Step 5: Run all suites**

Run: `npx supabase db reset && npx supabase test db`
Expected: green; the forged-BC-claims (line ~181) and inactive-stale-claims (~190) cases still deny.

- [ ] **Step 6: Commit and PR**

```bash
git add supabase/migrations/*_points_ledger_leadership_reads.sql supabase/tests/points_ledger_read.test.sql
git commit -m "feat(db): let BCE, BC and Moderator read the whole points ledger (#257)"
git push -u origin feat/257-ledger-leadership-reads
gh pr create --title "Points ledger: leadership global reads" --body "Closes #257"
```

---

### Task 3: #310 — Diverse and Secretariat departments, retire legacy `it`

**Files:**

- Create: `supabase/migrations/<timestamp>_departments_diverse_secretariat.sql`
- Modify: `supabase/seed.sql:154,157,170,173-177,236-237,300`
- Modify: `supabase/tests/rls_teams_reference.test.sql:40-41` (count 7 → 8)
- Modify: `supabase/tests/demo_seed.test.sql` (add two assertions, bump `plan`)
- Create: `supabase/tests/departments_reference.test.sql`
- Modify: `docs/brand/reference.md` (one line: neutral colour for coordination structures)

**Interfaces:**

- Consumes: `departments(id,name,short,color,kind)` (`0001_core_schema.sql:35-41`), `teams(id,name,dept_id,lead_id,for_recruits,is_interne)`, `member_departments` PK `(member_id, dept_id)`, `team_members` PK `(team_id, member_id)`; FK `events_team_department_fkey (team_id, dept_id) → teams(id, dept_id)` (`20260830210038:12-14`, **not deferrable**).
- Produces: departments `diverse`, `secretariat` (`kind='coordination'`); teams `it`, `interne` (`dept_id='diverse'`, `interne.is_interne=true`); no `it` department. #296 (seed rebuild) and #66 (Interne gating) rely on these ids.

Colour: the Brand Book (`docs/brand/reference.md:14-22`) defines colours only for the five departments. Use the mockup's neutral `#5C5C61` (`mockup/css/tokens.css:58`, "Activități externe") for both coordination structures and record that in `reference.md`. Department UI always shows the name too, so colour is never the only cue.

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull --ff-only
git checkout -b feat/310-departments-diverse-secretariat
npx supabase migration new departments_diverse_secretariat
```

- [ ] **Step 2: Write the reference-data test first**

Create `supabase/tests/departments_reference.test.sql`:

```sql
-- #310: Diverse and Secretariat exist as coordination structures, the
-- legacy 'it' department is gone, and its teams live under Diverse.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap;
select plan(7);

select results_eq(
  $$ select id from departments where kind = 'coordination' order by id $$,
  $$ values ('diverse'), ('secretariat') $$,
  'exactly two coordination structures'
);
select is((select count(*) from departments where id = 'it'), 0::bigint, 'legacy it department removed');
select is((select dept_id from teams where id = 'it'), 'diverse', 'IT team belongs to Diverse');
select is((select dept_id from teams where id = 'interne'), 'diverse', 'Interne team belongs to Diverse');
select is((select is_interne from teams where id = 'interne'), true, 'Interne team is flagged is_interne');
select is(
  (select count(*) from departments where kind = 'department'),
  5::bigint,
  'still exactly five cup departments'
);
-- No row anywhere still points at the retired department.
select is(
  (select count(*) from (
     select dept_id from member_departments where dept_id = 'it'
     union all select dept_id from teams where dept_id = 'it'
     union all select dept_id from tasks where dept_id = 'it'
     union all select dept_id from events where dept_id = 'it'
     union all select dept_id from announcements where dept_id = 'it'
     union all select dept_id from task_requests where dept_id = 'it') x),
  0::bigint,
  'nothing references department it'
);

select * from finish();
rollback;
```

- [ ] **Step 3: Update the existing assertions**

`supabase/tests/rls_teams_reference.test.sql:40-41`: change `7::bigint` to `8::bigint` and the description to `'eight departments (5 + diverse, secretariat, org)'`.

`supabase/tests/demo_seed.test.sql`: after the team assertions (~line 66–69) add, and bump `plan(N)` by 2:

```sql
select ok(
  exists (select 1 from member_departments
           where member_id = 'd0000000-0000-0000-0000-000000000006' and dept_id = 'diverse'),
  'bce@ demo account belongs to Diverse'
);
select ok(
  exists (select 1 from team_members
           where member_id = 'd0000000-0000-0000-0000-000000000008' and team_id = 'it'),
  'moderator@ demo account is on the IT team'
);
```

- [ ] **Step 4: Run to see failures**

Run: `npx supabase db reset && npx supabase test db`
Expected: `departments_reference` fails on all seven; `rls_teams_reference` fails the count; `demo_seed` fails the two new `ok`s.

- [ ] **Step 5: Write the migration**

```sql
-- #310: coordination structures Diverse (Department Teams it, interne) and
-- Secretariat; retire the legacy 'it' department. Both use kind =
-- 'coordination', so dept_cup (kind = 'department') never lists them.
-- Colour: Brand Book defines only the five departments; #5C5C61 is the
-- mockup's neutral (see docs/brand/reference.md).

insert into public.departments (id, name, short, color, kind) values
  ('diverse',     'Diverse',     'DIV', '#5C5C61', 'coordination'),
  ('secretariat', 'Secretariat', 'SEC', '#5C5C61', 'coordination')
on conflict (id) do nothing;

insert into public.teams (id, name, dept_id, for_recruits, is_interne) values
  ('it',      'Echipa IT',      'diverse', false, false),
  ('interne', 'Echipa Interne', 'diverse', false, true)
on conflict (id) do nothing;

-- Members of the retired department join Diverse and the IT team.
insert into public.member_departments (member_id, dept_id)
select md.member_id, 'diverse'
  from public.member_departments md
 where md.dept_id = 'it'
on conflict (member_id, dept_id) do nothing;

insert into public.team_members (team_id, member_id)
select 'it', md.member_id
  from public.member_departments md
 where md.dept_id = 'it'
on conflict (team_id, member_id) do nothing;

-- events(team_id, dept_id) → teams(id, dept_id) is NO ACTION and not
-- deferrable, which makes moving a team between departments impossible in
-- either order. Make it deferrable, defer it for this transaction, then move.
alter table public.events
  alter constraint events_team_department_fkey deferrable initially immediate;
set constraints public.events_team_department_fkey deferred;

update public.teams         set dept_id = 'diverse' where dept_id = 'it';
update public.events        set dept_id = 'diverse' where dept_id = 'it';
update public.tasks         set dept_id = 'diverse' where dept_id = 'it';
update public.task_requests set dept_id = 'diverse' where dept_id = 'it';
update public.announcements set dept_id = 'diverse' where dept_id = 'it';

delete from public.member_departments where dept_id = 'it';
delete from public.departments where id = 'it';
```

- [ ] **Step 6: Update seed.sql**

- Line 154 and 157: `'it'` → `'diverse'`.
- Line 170: `'t-app', 'Echipa Aplicație', 'it', …` → `'diverse'`.
- After line 177 add memberships on the reference IT team:

```sql
  ('it',        'd0000000-0000-0000-0000-000000000006'),
  ('it',        'd0000000-0000-0000-0000-000000000008')
```

(turn the previous line's `;` into `,`).

- Lines 236–237 (two tasks) and 300 (event): `'it'` → `'diverse'`.
- Check the seed's cleanup block (`seed.sql:45-102`) still removes these rows on re-run: `team_members` cascades from the demo `profiles` delete, so no change is needed; confirm by running the seed twice (Step 8).

- [ ] **Step 7: Brand note**

In `docs/brand/reference.md`, after the department colour list, add: `- Structuri de coordonare (Diverse, Secretariat): neutru \`#5C5C61\`; numele structurii apare întotdeauna lângă culoare.`

- [ ] **Step 8: Reset, test, prove re-runnability**

Run:

```bash
npx supabase db reset && npx supabase test db
psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')" -f supabase/seed.sql
npx supabase test db
```

Expected: all green both times (the second seed run is what CI's fingerprint step checks).

- [ ] **Step 9: Regenerate types, commit, PR**

```bash
cd app && npm run gen:types && cd ..
git add supabase/migrations/*_departments_diverse_secretariat.sql supabase/seed.sql supabase/tests/departments_reference.test.sql supabase/tests/rls_teams_reference.test.sql supabase/tests/demo_seed.test.sql docs/brand/reference.md app/src/lib/database.types.ts
git commit -m "feat(db): add Diverse and Secretariat, retire the legacy IT department (#310)"
git push -u origin feat/310-departments-diverse-secretariat
gh pr create --title "Departments: Diverse, Secretariat, retire legacy IT" --body "Closes #310"
```

Note for the PR body: JWT `dept_ids` for real `it` members update on their next token refresh; #215 (Educațional display name, unassigned) touches the same table — whichever lands second rebases.

---

### Task 4: #361 — TypeScript strict mode, deny lint warnings, Vitest hygiene

**Files:**

- Modify: `app/tsconfig.app.json`, `app/tsconfig.node.json`, `app/.oxlintrc.json`, `app/package.json`, `app/vite.config.ts`
- Modify: `app/src/lib/format.ts:76`, `app/src/main.tsx:45`, `app/src/queries/points.ts:61,88`, `app/src/queries/profile.ts:30`, `app/src/queries/tasks.ts:34`

**Interfaces:**

- Produces: `npm run lint` fails on any warning; `strict` + `noUncheckedIndexedAccess` on; hooks use TanStack's `skipToken` instead of `id!`. Tasks 5 and 6 write code under these flags.

Facts: `tsc --strict --noUncheckedIndexedAccess` fails only at `format.ts:76`; `oxlint --deny-warnings` is clean today; enabling the `suspicious` category reports 267 false positives of `react/react-in-jsx-scope` (React 19 automatic runtime) and one real `no-underscore-dangle` on `window.__supabase` (`lib/supabase.ts:34`, DEV-only); the five non-null assertions are `main.tsx:45`, `points.ts:61,88`, `profile.ts:30`, `tasks.ts:34`.

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull --ff-only
git checkout -b feat/361-strict-and-deny-warnings
```

- [ ] **Step 2: Turn the flags on and watch them fail**

`app/tsconfig.app.json` compilerOptions — add:

```json
"strict": true,
"noUncheckedIndexedAccess": true
```

`app/tsconfig.node.json` compilerOptions — add `"strict": true`.

Run: `cd app && npm run typecheck`
Expected: `src/lib/format.ts(76,13): error TS2532` (twice).

- [ ] **Step 3: Fix `initials()`**

`app/src/lib/format.ts:72-79`:

```ts
export function initials(nameOrEmail: string | undefined | null): string {
  if (!nameOrEmail) return "?";
  const parts = nameOrEmail.trim().split(/\s+/);
  const first = parts[0]?.[0];
  const second = parts[1]?.[0];
  if (first && second && !nameOrEmail.includes("@")) {
    return (first + second).toUpperCase();
  }
  return nameOrEmail.slice(0, 2).toUpperCase();
}
```

Run: `npm run typecheck` → clean.

- [ ] **Step 4: Lint config**

`app/.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "categories": { "correctness": "error", "suspicious": "warn" },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/exhaustive-deps": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }],
    "react/react-in-jsx-scope": "off",
    "typescript/no-non-null-assertion": "warn",
    "no-underscore-dangle": ["warn", { "allow": ["__supabase"] }]
  },
  "ignorePatterns": ["dist"]
}
```

`app/package.json` scripts: `"lint": "oxlint --deny-warnings"`, add `"test:coverage": "vitest run --coverage"`.
Install coverage: `npm i -D @vitest/coverage-v8@^4.1.0` (match the installed vitest 4.x).

Run: `npm run lint`
Expected: exactly five errors, all `typescript/no-non-null-assertion`.

- [ ] **Step 5: Remove the non-null assertions**

`app/src/main.tsx:45`:

```ts
const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");
createRoot(root).render(/* unchanged */);
```

`app/src/queries/points.ts` — `useMyStanding` (lines 50–95): replace `enabled: Boolean(id)` + `id!` with `skipToken`:

```ts
import { skipToken, useQuery } from "@tanstack/react-query";

export function useMyStanding() {
  const { session } = useAuth();
  const id = session?.user.id;

  return useQuery({
    queryKey: keys.points.standing(),
    queryFn: id ? () => fetchStanding(id) : skipToken,
  });
}

async function fetchStanding(memberId: string) {
  const mine = await supabase
    .from("leaderboard")
    .select("rank, points")
    .eq("member_id", memberId)
    .maybeSingle();
  if (mine.error) throw mine.error;

  const total = await supabase
    .from("leaderboard")
    .select("member_id", { count: "exact", head: true });
  if (total.error) throw total.error;

  if (!mine.data?.rank) {
    return { rank: null, total: total.count ?? 0, next: null };
  }

  const above = await supabase
    .from("leaderboard")
    .select("rank, points")
    .gt("points", mine.data.points ?? 0)
    .order("points", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (above.error) throw above.error;

  return {
    rank: mine.data.rank,
    total: total.count ?? 0,
    next:
      above.data && above.data.rank !== null
        ? {
            rank: above.data.rank,
            gap: (above.data.points ?? 0) - (mine.data.points ?? 0),
          }
        : null,
  };
}
```

Apply the same `queryFn: id ? () => fetch(id) : skipToken` shape to `useMyProfile` (`profile.ts:17-32`) and `useMyTasks` (`tasks.ts:23-35`), extracting `fetchMyProfile(memberId: string)` / `fetchMyTasks(memberId: string)`.

- [ ] **Step 6: Vitest config**

`app/vite.config.ts` test block:

```ts
test: {
  environment: 'jsdom',
  setupFiles: './src/test/setup.ts',
  restoreMocks: true,
  coverage: { provider: 'v8', include: ['src/**/*.{ts,tsx}'], exclude: ['src/**/*.test.*', 'src/lib/database.types.ts'] },
},
```

Then delete the now-redundant `vi.clearAllMocks()` calls in `beforeEach` blocks (`points.test.tsx`, `event-rsvp.test.tsx`, `CalendarScreen.test.tsx`) — `restoreMocks` covers them.

- [ ] **Step 7: All gates**

Run: `npm run typecheck && npm run lint && npm run format:check && npm run test:run && npm run build`
Expected: green. Prove the guardrail: add `const x: any = 1;` anywhere, run `npm run lint` → fails; remove it.

- [ ] **Step 8: Commit and PR**

```bash
git add app
git commit -m "feat(app): enable strict TypeScript, deny lint warnings, restoreMocks and coverage (#361)"
git push -u origin feat/361-strict-and-deny-warnings
gh pr create --title "Frontend: strict mode and deny-warnings lint" --body "Closes #361"
```

---

### Task 5: #360 — clear the query cache on sign-out, member-scope self keys

**Files:**

- Modify: `app/src/lib/auth.tsx:75-122`
- Modify: `app/src/queries/keys.ts:16-59`
- Modify: `app/src/queries/points.ts` (`useMyStanding` key), `app/src/queries/profile.ts` (`useMyProfile` key), `app/src/queries/tasks.ts` (`useMyTasks` key)
- Create: `app/src/lib/auth.test.tsx`
- Modify: `app/src/queries/points.test.tsx` (key assertion at ~59–64)

**Interfaces:**

- Consumes: `QueryClientProvider` is above `AuthProvider` in `main.tsx:47-51`, so `useQueryClient()` works inside `AuthProvider`.
- Produces: `keys.points.standing(memberId)`, `keys.profile.me(memberId)`, `keys.tasks.mine(memberId)` all take `string | undefined`; Task 6 uses `keys.points.standing(id)`.

- [ ] **Step 1: Branch (after Task 4 merges, or rebase onto it)**

```bash
git checkout main && git pull --ff-only
git checkout -b feat/360-cache-clear-on-signout
```

- [ ] **Step 2: Write the failing provider test**

Create `app/src/lib/auth.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

type Listener = (event: string, session: unknown) => void;
const auth = vi.hoisted(() => {
  let listener: Listener | null = null;
  return {
    listener: () => listener,
    getSession: vi.fn(async () => ({ data: { session: null } })),
    onAuthStateChange: vi.fn((cb: Listener) => {
      listener = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signOut: vi.fn(async () => ({ error: null })),
  };
});
vi.mock("./supabase", () => ({
  supabase: {
    auth: {
      getSession: auth.getSession,
      onAuthStateChange: auth.onAuthStateChange,
      signOut: auth.signOut,
    },
  },
}));

import { AuthProvider } from "./auth";

function sessionFor(id: string) {
  return { user: { id }, access_token: "test-token" };
}

describe("AuthProvider cache hygiene", () => {
  it("clears the query cache on SIGNED_OUT", async () => {
    const client = new QueryClient();
    client.setQueryData(["tasks", "mine", { memberId: "a" }], [{ id: 1 }]);
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <div />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(auth.listener()).not.toBeNull());

    auth.listener()!("SIGNED_IN", sessionFor("a"));
    auth.listener()!("SIGNED_OUT", null);

    await waitFor(() =>
      expect(client.getQueryCache().getAll()).toHaveLength(0),
    );
  });

  it("clears the query cache when a different member signs in", async () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <div />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(auth.listener()).not.toBeNull());

    auth.listener()!("SIGNED_IN", sessionFor("a"));
    client.setQueryData(["profile", "me", { memberId: "a" }], {
      full_name: "A",
    });
    auth.listener()!("SIGNED_IN", sessionFor("b"));

    await waitFor(() =>
      expect(
        client.getQueryData(["profile", "me", { memberId: "a" }]),
      ).toBeUndefined(),
    );
  });
});
```

(The `!` on `auth.listener()` is inside a test; if `no-non-null-assertion` from Task 4 flags it, replace with a local `const l = auth.listener(); if (!l) throw new Error('no listener');`.)

Run: `cd app && npx vitest run src/lib/auth.test.tsx`
Expected: both fail (cache still populated).

- [ ] **Step 3: Implement in `AuthProvider`**

`app/src/lib/auth.tsx` — add imports `useRef`, `useQueryClient`; inside `AuthProvider`:

```tsx
const queryClient = useQueryClient();
const lastUserId = useRef<string | null>(null);

// Everything cached belongs to one member. When the member changes — sign-out,
// or a different account signing in on a shared device — drop it all before
// the next render can show the previous person's data.
const userId = session?.user.id ?? null;
useEffect(() => {
  if (lastUserId.current !== null && lastUserId.current !== userId) {
    queryClient.clear();
  }
  lastUserId.current = userId;
}, [userId, queryClient]);
```

and in the memoised value:

```tsx
signOut: async () => {
  await supabase.auth.signOut();
  queryClient.clear();
},
```

with `queryClient` added to that `useMemo` dependency array.

Run the test file → both pass.

- [ ] **Step 4: Member-scope the self keys**

`app/src/queries/keys.ts` — replace the three factories and extend the doc comment:

```ts
 *  3. **Self data is keyed by member.** Anything that answers "mine" carries
 *     `{ memberId }` so two members on one device never share an entry; the
 *     provider also clears the cache when the member changes.
```

```ts
standing: (memberId: string | undefined) => ['points', 'standing', { memberId }] as const,
…
me: (memberId: string | undefined) => ['profile', 'me', { memberId }] as const,
…
mine: (memberId: string | undefined) => ['tasks', 'mine', { memberId }] as const,
```

Update the three hooks to pass `id`: `keys.points.standing(id)`, `keys.profile.me(id)`, `keys.tasks.mine(id)`.

- [ ] **Step 5: Extend the key test**

In `app/src/queries/points.test.tsx` near the existing key-isolation assertion (~59–64) add:

```tsx
it("scopes standing by member", () => {
  expect(keys.points.standing("m1")).toEqual([
    "points",
    "standing",
    { memberId: "m1" },
  ]);
  expect(keys.profile.me("m1")).toEqual(["profile", "me", { memberId: "m1" }]);
  expect(keys.tasks.mine("m1")).toEqual(["tasks", "mine", { memberId: "m1" }]);
});
```

(import `keys` from `./keys`.)

- [ ] **Step 6: All gates + manual check**

Run: `npm run typecheck && npm run lint && npm run format:check && npm run test:run && npm run build`
Then `npm run dev`: sign in as `voluntar@demo.osubb` (parola123), open Dashboard, sign out, sign in as `bce@demo.osubb` → the greeting and cards must not flash Ioana's data.

- [ ] **Step 7: Commit and PR**

```bash
git add app/src
git commit -m "feat(app): clear the query cache when the member changes and key self queries by member (#360)"
git push -u origin feat/360-cache-clear-on-signout
gh pr create --title "Frontend: cache hygiene on sign-out" --body "Closes #360"
```

---

### Task 6: #326 — gate leadership cards behind level 5

**Files:**

- Modify: `app/src/lib/capabilities.ts:14-25`
- Modify: `app/src/screens/dashboard/DashboardScreen.tsx`
- Modify: `app/src/screens/dashboard/MyPointsCard.tsx:21-53,82-99`
- Modify: `app/src/queries/points.ts` (`useMyStanding` gains an options argument)
- Create: `app/src/screens/dashboard/DashboardScreen.test.tsx`

**Interfaces:**

- Consumes: `can(claims, capability)` from `lib/capabilities.ts`; `useAuth()`; `useMyStanding` after Task 5 (`keys.points.standing(id)`, `skipToken`).
- Produces: `LEVEL.seeLeadership = 5`; `useMyStanding({ enabled })`; `<MyPointsCard showStanding />`.

The DB gate is `auth_level() >= 5` in `20260907204817_leadership_only_global_points.sql`; the UI mirrors it. A disabled TanStack query stays `status: 'pending'`, so the card must not wait on `standing` when it is not shown.

- [ ] **Step 1: Branch (after Task 5)**

```bash
git checkout main && git pull --ff-only
git checkout -b feat/326-dashboard-leadership-gate
```

- [ ] **Step 2: Failing screen test**

Create `app/src/screens/dashboard/DashboardScreen.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock("../../lib/auth", () => ({ useAuth: auth.useAuth }));
vi.mock("../../queries/profile", () => ({
  useMyProfile: () => ({
    data: { full_name: "Ioana Popescu", role: "voluntar", tier: null },
  }),
}));
vi.mock("../../queries/reference", () => ({
  useRoles: () => ({ data: new Map() }),
}));
vi.mock("../../queries/points", () => ({
  useMyPoints: () => ({ isPending: false, isError: false, data: 12 }),
  useMyStanding: () => ({
    isPending: false,
    isError: false,
    data: { rank: 4, total: 8, next: { rank: 3, gap: 3 } },
  }),
  useLeaderboard: () => ({ isPending: false, isError: false, data: [] }),
  useDeptCup: () => ({ isPending: false, isError: false, data: [] }),
}));
vi.mock("@ionic/react", () => ({
  IonPage: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  IonContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import DashboardScreen from "./DashboardScreen";

function claims(level: number) {
  return {
    claims: {
      member_role: "x",
      member_level: level,
      dept_ids: [],
      team_ids: [],
    },
    session: { user: { id: "m" } },
    loading: false,
    signOut: vi.fn(),
  };
}

describe("DashboardScreen leadership gate", () => {
  it("hides leaderboard, cup and rank for a level-1 member", () => {
    auth.useAuth.mockReturnValue(claims(1));
    render(<DashboardScreen />);
    expect(screen.getByText(/12/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /clasament/i })).toBeNull();
    expect(screen.queryByText(/din 8 membri/)).toBeNull();
    expect(screen.getByText(/vizibil pentru BCE/i)).toBeInTheDocument();
  });

  it("shows everything for a level-5 member", () => {
    auth.useAuth.mockReturnValue(claims(5));
    render(<DashboardScreen />);
    expect(screen.getByText(/din 8 membri/)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /clasament/i }),
    ).toBeInTheDocument();
  });
});
```

The leaderboard heading is `<h2 className="card-title">… Clasament</h2>` (`LeaderboardCard.tsx:95-98`), so `{ name: /clasament/i }` matches as written. `LeaderboardCard` also imports `IonIcon` from `@ionic/react`; extend the `@ionic/react` mock with `IonIcon: () => null` so the render does not pull in Ionic.

Run: `npx vitest run src/screens/dashboard` → fails (no gate yet).

- [ ] **Step 3: Capability**

`app/src/lib/capabilities.ts` — add inside `LEVEL`:

```ts
/* Mirrors 20260907204817_leadership_only_global_points.sql: leaderboard,
   dept_cup and member_points return rows only at level >= 5. */
seeLeadership: 5,
```

- [ ] **Step 4: `useMyStanding` accepts `enabled`**

`app/src/queries/points.ts`:

```ts
export function useMyStanding({ enabled = true }: { enabled?: boolean } = {}) {
  const { session } = useAuth();
  const id = session?.user.id;
  return useQuery({
    queryKey: keys.points.standing(id),
    queryFn: id && enabled ? () => fetchStanding(id) : skipToken,
  });
}
```

- [ ] **Step 5: Screen and card**

`DashboardScreen.tsx`:

```tsx
import { useAuth } from '../../lib/auth';
import { can } from '../../lib/capabilities';
…
const { claims } = useAuth();
const leader = can(claims, 'seeLeadership');
…
<MyPointsCard showStanding={leader} />
{leader && (
  <div className="dash-grid">
    <LeaderboardCard />
    <DeptCupCard />
  </div>
)}
```

`MyPointsCard.tsx`:

```tsx
export default function MyPointsCard({ showStanding }: { showStanding: boolean }) {
  const points = useMyPoints();
  const standing = useMyStanding({ enabled: showStanding });
  …
  if (points.isError || (showStanding && standing.isError)) { /* unchanged body */ }
  if (points.isPending || (showStanding && standing.isPending)) { /* unchanged body */ }
  …
  {/* rank block */}
  {!showStanding ? (
    <div className="hero-rank">
      <p className="hero-rank-note">Clasamentul și Cupa Departamentelor sunt vizibile pentru BCE și BC.</p>
    </div>
  ) : standing.data?.rank == null ? (
    <div className="hero-rank"><p className="hero-rank-note">Nu ești în clasament.</p></div>
  ) : (
    /* existing rank markup using standing.data */
  )}
```

Replace `const { rank, total, next } = standing.data;` with reads off `standing.data` inside the branch (it is `undefined` when disabled).

- [ ] **Step 6: Gates + manual check**

Run: `npm run typecheck && npm run lint && npm run format:check && npm run test:run && npm run build`
Manual: `voluntar@` sees points + the note, no cards; `bce@` sees rank, leaderboard, cup.

- [ ] **Step 7: Commit and PR**

```bash
git add app/src
git commit -m "feat(app): show leaderboard, cup and rank only to level 5+ (#326)"
git push -u origin feat/326-dashboard-leadership-gate
gh pr create --title "Dashboard: leadership-only cards" --body "Closes #326"
```

---

### Task 7: #279 — department-team membership through local leadership (blocked by #276, #277)

**Do not start until #276 and #277 are merged** (both dobrerares). Re-read the merged migrations first: #276 makes `teams.dept_id` nullable (independent teams), #277 removes `teams.lead_id`. If #364 (`private.actor_level()` / `require_active_member()`, dobrerares) has merged, use it inside the helper below instead of the inline `profiles ⋈ roles` lookup; if #278 (independent-team commands) has merged, mirror its command names and error codes exactly so the two team kinds read as one API.

**Files:**

- Create: `supabase/migrations/<timestamp>_department_team_membership_commands.sql`
- Create: `supabase/tests/department_team_membership_commands.test.sql`

**Interfaces:**

- Produces: `public.add_department_team_member(p_team_id text, p_member_id uuid)`, `public.remove_department_team_member(p_team_id text, p_member_id uuid)`; helper `private.require_department_team_manager(p_team_id text)`; errors `42501 department_team_forbidden`, `PT404 team_not_found`, `PT409 team_is_independent`, `PT400 member_not_active`, `PT404 team_member_not_found`.

Pattern to copy (line ranges in `20260909151741_project_membership_commands.sql`): helper 7–62 (row lock first, `42501` on failure), impls 64–136, public `security invoker` wrappers 210–253, revoke/grant block 264–310; race test in `project_membership_commands.test.sql:490-620`.

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull --ff-only
git checkout -b feat/279-department-team-membership
npx supabase migration new department_team_membership_commands
```

- [ ] **Step 2: Failing test**

Create `supabase/tests/department_team_membership_commands.test.sql` with `plan(14)`: fixtures — departments `edu` and `fin` (reference rows exist), a department team `t-edu-x` under `edu` created by the test, an independent team `t-indep` (`dept_id null`), personas via the suite's `pg_temp.login(uid, role, level, depts jsonb, teams jsonb)` helper (copy the version from `rls_teams_reference.test.sql:11`): `edu` BCE, `fin` BCE, BC, Moderator, Responsabil, voluntar, an inactive BCE, claimless UID, anon. Assertions:

1. `edu` BCE adds a member to `t-edu-x` → row exists.
2. `edu` BCE removes it → row gone.
3. `fin` BCE on `t-edu-x` → `throws_ok(…, '42501')`.
4. BC adds → ok. 5. Moderator removes → ok.
5. Responsabil (4) → `42501`. 7. voluntar → `42501`.
6. Inactive BCE with valid claims → `42501`.
7. Claimless UID → `42501`. 10. anon → `42501`.
8. Independent team `t-indep` → `PT409 team_is_independent`.
9. Unknown team → `PT404`. 13. Inactive target member → `PT400`.
10. Remove a non-member → `PT404`.

- [ ] **Step 3: Migration**

```sql
-- #279: department-team rosters are managed by the parent department's BCE,
-- BC, or Moderator. Independent teams are handled by #278.
create or replace function private.require_department_team_manager(p_team_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_level int;
  v_dept text;
begin
  if v_actor is null or not coalesce(public.auth_is_member(), false) then
    raise exception using errcode = '42501', message = 'department_team_forbidden';
  end if;

  select t.dept_id into v_dept
    from public.teams t
   where t.id = p_team_id
   for update;
  if not found then
    raise sqlstate 'PT404' using message = 'team_not_found';
  end if;
  if v_dept is null then
    raise sqlstate 'PT409' using message = 'team_is_independent';
  end if;

  -- Live level, not the token: a demoted or deactivated BCE loses this at once.
  select r.level into v_level
    from public.profiles p
    join public.roles r on r.id = p.role
   where p.id = v_actor and p.status = 'activ';

  if coalesce(v_level, -1) >= 6 then
    return v_dept;
  end if;
  if coalesce(v_level, -1) >= 5
     and exists (select 1 from public.member_departments md
                  where md.member_id = v_actor and md.dept_id = v_dept) then
    return v_dept;
  end if;
  raise exception using errcode = '42501', message = 'department_team_forbidden';
end;
$$;

create or replace function private.add_department_team_member_impl(p_team_id text, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_department_team_manager(p_team_id);
  if not exists (select 1 from public.profiles p where p.id = p_member_id and p.status = 'activ') then
    raise sqlstate 'PT400' using message = 'member_not_active';
  end if;
  insert into public.team_members (team_id, member_id)
  values (p_team_id, p_member_id)
  on conflict (team_id, member_id) do nothing;
end;
$$;

create or replace function private.remove_department_team_member_impl(p_team_id text, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_department_team_manager(p_team_id);
  delete from public.team_members
   where team_id = p_team_id and member_id = p_member_id;
  if not found then
    raise sqlstate 'PT404' using message = 'team_member_not_found';
  end if;
end;
$$;

create or replace function public.add_department_team_member(p_team_id text, p_member_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.add_department_team_member_impl(p_team_id, p_member_id) $$;

create or replace function public.remove_department_team_member(p_team_id text, p_member_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.remove_department_team_member_impl(p_team_id, p_member_id) $$;

revoke execute on function
  private.require_department_team_manager(text),
  private.add_department_team_member_impl(text, uuid),
  private.remove_department_team_member_impl(text, uuid)
from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function
  private.add_department_team_member_impl(text, uuid),
  private.remove_department_team_member_impl(text, uuid)
to authenticated;
revoke execute on function
  public.add_department_team_member(text, uuid),
  public.remove_department_team_member(text, uuid)
from public, anon, authenticated, service_role;
grant execute on function
  public.add_department_team_member(text, uuid),
  public.remove_department_team_member(text, uuid)
to authenticated;
```

Leave `team_members_manage` (`20260822222537:40-42`) in place — #280 replaces the policies for both team kinds; note that in the PR body.

- [ ] **Step 4: Run, commit, PR**

Run: `npx supabase db reset && npx supabase test db` → green.

```bash
git add supabase/migrations/*_department_team_membership_commands.sql supabase/tests/department_team_membership_commands.test.sql
git commit -m "feat(db): manage department-team membership through local leadership commands (#279)"
git push -u origin feat/279-department-team-membership
gh pr create --title "Department teams: local-leadership membership commands" --body "Closes #279"
```

---

### Task 8: #281 — project and team role matrix (blocked by #280)

**Do not start until #280 is merged.** Tests only; any failure becomes a new focused issue, not a fix inside this PR.

**Files:**

- Create: `supabase/tests/authorization_matrix.test.sql`

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull --ff-only
git checkout -b test/281-role-matrix
```

- [ ] **Step 2: Build the fixture set once at the top of the file**

Owned fixtures (never seed rows): departments `edu`/`fin` (reference), one department team `t-m-edu` under `edu`, one independent team `t-m-indep`, one active project `p-m-active` (lead L, Responsible R, plain member M) and one archived project `p-m-archived`. Personas (uuid prefix `81000000-…`): recrut(0), voluntar(1), activ(2), vot(3), Responsabil(4), BCE-edu, BCE-fin, BC, Moderator, inactive-BCE, claimless UID, anon; plus L, R, M, and an outsider O. Use the suite's `pg_temp.login(uid, role, level, depts, teams)` helper (or the shared helper from #367 if merged).

- [ ] **Step 3: Assert the matrix**

For every persona × every surface below, one `results_eq`/`is`/`throws_ok`. Expected outcomes:

| Surface                                                        | Allowed                                        | Everyone else              |
| -------------------------------------------------------------- | ---------------------------------------------- | -------------------------- |
| read `projects` row (active)                                   | L, R, M, BC, Moderator, BCE (read-only global) | zero rows                  |
| read `projects` row (archived)                                 | BC, Moderator                                  | zero rows                  |
| read `project_members` roster                                  | active members of that project, BC, Moderator  | zero rows                  |
| `add_project_member`                                           | L, BC, Moderator (after #311)                  | `42501`                    |
| `grant_project_responsible`                                    | L, BC, Moderator                               | `42501`                    |
| read `teams`/`team_members` for `t-m-edu`                      | members, BCE-edu, BC, Moderator (per #280)     | zero rows                  |
| `add_department_team_member` on `t-m-edu`                      | BCE-edu, BC, Moderator                         | `42501` (BCE-fin included) |
| independent-team membership command (#278 name) on `t-m-indep` | BC, Moderator                                  | `42501` (BCE-edu included) |
| any write as inactive-BCE / claimless / anon                   | —                                              | `42501` or zero rows       |

At least one denied write per persona group keeps the suite from passing vacuously. `plan(N)` = number of assertions; count them.

- [ ] **Step 4: Run, commit, PR**

Run: `npx supabase db reset && npx supabase test db`.
Expected: green — or specific failures, each of which you file as `Authorization: <surface> lets <persona> …` with the failing assertion quoted, then mark the assertion `todo` in this suite until that issue merges.

```bash
git add supabase/tests/authorization_matrix.test.sql
git commit -m "test(db): full project and team authorization matrix (#281)"
git push -u origin test/281-role-matrix
gh pr create --title "Tests: project and team role matrix" --body "Closes #281"
```

---

## Verification (whole plan)

- After Tasks 1–3: `npx supabase db reset && npx supabase test db` green; `cd app && npm run gen:types && git diff --exit-code src/lib/database.types.ts` clean; staging auto-deploy succeeds after each merge (CI "Push migrations to staging").
- After Tasks 4–6: all five app gates green; the two manual walkthroughs (member switch with no data flash; `voluntar@` vs `bce@` dashboards) done in `npm run dev`.
- Coordination: before starting Task 3, check `gh pr list --search "276 OR 277"`; before Task 7, `gh issue view 276 277 278 364 --json state`; before Task 8, `gh issue view 280 --json state`.
