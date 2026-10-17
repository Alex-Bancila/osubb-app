# Portofoliu Interne Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Evaluări de rol with Portofoliu Interne: Universitate on the Profile with the UBB rule for Drept de Vot, the three evaluation settings with the Points Start Date applied in every total, and Role Evaluations rebuilt as one ranking of the eligible with a Simulation before every finalised run.

**Architecture:** Three PRs, merged in order. PR 1 adds `profiles.university`, a `profiles` trigger that refuses a Role change into `vot` without UBB, and Privacy Notice 1.2. PR 2 adds the one-row `public.evaluation_settings` with three commands, widens the change log to dates, and puts `private.points_floor()` into every display total. PR 3 rebuilds the ranking core, adds `simulate_role_evaluation`, the seven-argument `run_role_evaluation`, the stored `retention_signals` with the live Universitate signal, drops both Promotion Rules and the daily job, moves the two shares into `evaluation_settings`, and ships the Portofoliu Interne page at its new route with a redirect.

**Tech Stack:** Supabase Postgres (plpgsql/sql, pgTAP), React 19 + TypeScript (vitest, zod, TanStack Query), the local Docker stack.

**Spec:** `docs/superpowers/specs/2026-10-18-portofoliu-interne-design.md` (ruling R58). Glossary: `CONTEXT.md` §Members and structure (Universitate), §Task Tracker (Points Start Date), §Governance. ADR-0004, amendment of 2026-10-18.

## Global Constraints

- **Canonical UBB value:** `Universitatea Babeș-Bolyai`, held once in SQL by `private.ubb_university()` and once in the app by `UBB` in `app/src/lib/universities.ts`. Null never counts as UBB.
- **Roles and levels:** recrut 0, voluntar 1, activ 2, vot 3, bce 5, bc 6, moderator 9. "BC or the Moderator" is `coalesce(private.actor_level(v_actor), -1) >= 6` after `private.require_active_member()`; the refusal code is `42501`.
- **Kinds:** `voluntar_activ` and `adunarea_generala`, unchanged. Holder Role per kind: `activ` and `vot`.
- **Defaults on day one:** x = 35, y = 25; both Promotion Thresholds in force kept; Prag minim, Data limită de intrare and Data de început a punctajului null.
- **Percentile rule:** over the ranked Members only, `share_size = ceil(p_percent * ranked_count / 100.0)`, `line` = the Task Points of the `share_size`-th row ordered by Task Points descending then `member_id`; `inside = ranked and task_points >= line` (ties at the boundary are inside). `ranked_count = 0` gives `line = null`.
- **Eligibility Floor is at least 1** (`eligibility_floor >= 1`), so a computed line is always a legal `promotion_thresholds.threshold`.
- **Instants.** A points floor or an Evaluation Period day is a Europe/Bucharest day: `(d::timestamp at time zone 'Europe/Bucharest')` for its start, `((d + 1)::timestamp at time zone 'Europe/Bucharest')` for the exclusive end.
- **Migrations.** Created with `npx supabase migration new <name>` and sorting after the newest on `main` at that moment (today `20261014225803_task_min_level.sql`). Every `create or replace` body is restated from `main`'s latest definition (`pg_get_functiondef` on a stack reset to `main`), changed only by the swaps the task names. A function whose signature changes is dropped and recreated with its comment and grants restated. Every new function ends with `revoke execute … from public, anon, authenticated, service_role;` and, for a public wrapper or a private `_impl`, `grant execute … to authenticated;`.
- **Rosters.** `supabase/tests/tracker_grants.test.sql` pins every public command (`expected_function_privs`, :246-436) and every private function (`pinned_private_functions`, :477-977, count pin `252` at :979-981). Each task that adds, drops or re-signs a function updates the rows and the count.
- **New tables** enable RLS, carry `broadcast_change` (`create trigger broadcast_change after insert or update or delete on public.<t> for each statement execute function private.broadcast_change();`), get a `FAMILIES_BY_TABLE` line in `app/src/queries/live-changes.ts`, a fixture row in `rls_deny_by_default.test.sql` (:224-237), a policy named `<table>_read`, and an index on every FK (`advisor_findings.test.sql`).
- **Database safety.** Local stack only, never the production project. Database gates (`db reset`, `supabase test db`, `check-local-ci.sh db`, `check:root`) never run at the same time as the full vitest.
- **Copy (Romanian).** Page and tab `Portofoliu Interne`; fields `Prag minim`, `Procent`, `Data limită de intrare`, `Data de început a punctajului`, `Universitate`; buttons `Simulează`, `Finalizează`, `Modifică valorile`; thresholds `Prag de promovare` (Voluntar Activ) and `Prag Adunarea Generală`; Profil panel `Date personale`. The copy never says "prag" alone, never "vechime", never "semestru" for the period. Reasons:
  - `vote_requires_ubb_student` → `Doar un student UBB poate primi Drept de Vot.`
  - `invalid_university` → `Universitatea are între 2 și 120 de caractere.`
  - `eligibility_floor_not_set` → `Setează pragul minim înainte de a rula o evaluare.`
  - `membership_cutoff_not_set` → `Setează data limită de intrare înainte de a rula evaluarea Voluntar Activ.`
  - `invalid_eligibility_floor` → `Pragul minim este un număr întreg de cel puțin 1.`
  - `invalid_membership_cutoff` → `Data limită de intrare este o zi de cel târziu azi.`
  - `invalid_points_start_date` → `Data de început a punctajului este o zi de cel târziu azi.`
  - `evaluation_settings_manage_forbidden` → `Doar BC și Moderatorul pot schimba setările evaluărilor.`
  - `role_evaluation_not_found` → `Evaluarea nu mai există. Reîncarcă pagina.`
  - `org_setting_not_settable` keeps its key; its copy becomes `Setarea se schimbă din Portofoliu Interne.`
- **Shipping.** One branch and one PR per part; the body carries the spec link and `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. A review (`@coderabbitai review`; when its quota means a long wait, a fresh-context reviewer instead, with the notes posted on the PR), then merge on green CI with `gh pr merge --merge --delete-branch`, then check the staging push with `gh run list --commit <merge sha>`. Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Nothing is pushed or merged without Alex's go-ahead on the PR.

## Review Focus

1. **A voter with an unknown Universitate on day one.** Every voter has `university = null` until Alex's backfill runs; the live Retention Signal must not list them all. Pinned in Task 10 (the refresh lists only `university is not null and university <> private.ubb_university()`).
2. **A deleted-for-good Task whose award predates the Points Start Date and whose deletion follows it.** `my_points` must not count the orphaned reversal alone and go negative. Pinned in Task 6 (orphaned `task`/`task_reversal` rows never count).
3. **Finalising when nobody reaches the Prag minim.** The run is recorded with `threshold_computed = null`, the threshold in force is untouched, no Candidate is listed, every holder raises a `below_floor` Signal. Pinned in Task 9.
4. **Moving the cutoff date after a live Candidate was listed.** A Voluntar who joined after the new date leaves the list at once, and comes back when the date moves again. Pinned in Task 10.
5. **An old Notification link.** Rows stored before PR 3 link to `/administrare/evaluari`; the redirect must carry a signed-in BC member to the new page. Pinned in Task 12.

---

## Tooling used by every restate step

`$S` below is the session scratchpad (create `$S/r58`). Dumps come from a stack reset to `main`:

```bash
dump() { docker exec -i supabase_db_osubb-app psql -U postgres -At -c "select pg_get_functiondef('$1'::regprocedure)" > "$S/$2.sql"; }
```

`$S/swap.pl` applies ordered swaps to one dump. Each swap must match exactly once. It writes `create or replace function …` with the body unchanged except for the swaps (Write tool, not a heredoc — heredocs fail in this shell):

```perl
use utf8; binmode(STDOUT, ':utf8'); local $/;
my ($in, $swaps) = @ARGV;
open my $h, '<:encoding(UTF-8)', $in or die "$in: $!"; my $s = <$h>; close $h;
my @pairs = do $swaps or die "swaps $swaps: $@ $!";
while (my ($old, $new) = splice(@pairs, 0, 2)) {
  my $i = index($s, $old); die "no match: " . substr($old, 0, 80) if $i < 0;
  die "ambiguous: " . substr($old, 0, 80) if index($s, $old, $i + 1) >= 0;
  substr($s, $i, length($old)) = $new;
}
$s =~ s/^CREATE OR REPLACE FUNCTION/create or replace function/;
$s =~ s/\s*\z/;\n/;
print $s;
```

A swaps file is a Perl list of `q{old}, q{new}` pairs. Use `q{…}`, never `q~…~`, which clashes with SQL `~`.

Every pgTAP suite opens with the house header (`begin; \set osubb_test_suite true \ir _helpers.sql set local search_path = public, extensions; create extension if not exists pgtap with schema extensions; select plan(N);`) and closes with `select * from finish(); rollback;`. Sign in with `pg_temp.test_login(uuid, jsonb)` / `pg_temp.test_login_leadership(uuid)` from `_helpers.sql`. Run one suite with `npx supabase test db supabase/tests/<file>`.

---

# PR 1 — Universitate (branch `feat/universitate`)

**Precondition:** `git checkout main && git pull --ff-only && npx supabase db reset && git checkout -b feat/universitate`, then `npx supabase migration new profiles_university`. Every SQL step of Tasks 1–2 appends to that one migration, in task order.

### Task 1: The column, its guard and the UBB rule

**Files:**

- Create: `supabase/migrations/<ts>_profiles_university.sql` (sections 1–4)
- Create: `supabase/tests/profiles_university.test.sql`
- Modify: `supabase/tests/member_commands.test.sql:320,662,733`, `supabase/tests/promotion_candidates.test.sql:253`, `supabase/tests/retired_surface.test.sql:48-49`, `supabase/tests/profiles_nickname.test.sql:34-40`, `supabase/tests/member_card.test.sql:32`, `supabase/tests/tracker_grants.test.sql`
- Modify: `supabase/seed.sql:342-350`, `scripts/check-seed-rerunnable.sh:215-217`

**Interfaces:**

- Consumes: `public.guard_profile_privileged_columns()` (main: `20260929234000_retire_dead_surface.sql:131-150`), `public.profiles_directory` (main: `20260930200000_board_title_directory.sql:67-83`), `private.member_card_impl(uuid)` / `public.member_card(uuid)` (main: `20260930200000:94-179`).
- Produces: `profiles.university text null` with `profiles_university_length_ck`; `grant select (university), update (university) on public.profiles to authenticated`; `private.ubb_university() returns text immutable`; trigger `profiles_guard_vote_university before update of role on public.profiles for each row when (new.role = 'vot' and old.role is distinct from 'vot') execute function private.guard_vote_university()` raising `PT409 vote_requires_ubb_student`; `profiles_directory` with `university` as its last column; `member_card` returning `… memberships jsonb, university text`.

- [ ] **Step 1: Write the failing suite** `supabase/tests/profiles_university.test.sql`, `plan(18)`:

```sql
-- R58 (Alex, 2026-10-18): Universitate on the Profile; only a UBB student
-- may be granted Drept de Vot. Spec docs/superpowers/specs/2026-10-18-portofoliu-interne-design.md.
-- Fixtures: pg_temp.u58(n) uuids, four profiles: 1 bc, 2 activ UBB, 3 activ other, 4 activ null.
select has_column('public', 'profiles', 'university', 'university exists');
select col_type_is('public', 'profiles', 'university', 'text', 'text');
select col_is_null('public', 'profiles', 'university', 'nullable: unknown');
select throws_ok($$update profiles set university = 'U' where id = pg_temp.u58(2)$$, '23514', null, 'too short');
select throws_ok($$update profiles set university = ' Universitatea X' where id = pg_temp.u58(2)$$, '23514', null, 'not trimmed');
select is(private.ubb_university(), 'Universitatea Babeș-Bolyai', 'the canonical value');
select is((select university from profiles_directory where id = pg_temp.u58(2)), 'Universitatea Babeș-Bolyai', 'directory carries it');
select is((select university from member_card(pg_temp.u58(2))), 'Universitatea Babeș-Bolyai', 'member card carries it');
-- Column grants: a Member reads it, a Member below BC cannot write it (the privileged guard).
select ok(has_column_privilege('authenticated', 'public.profiles', 'university', 'SELECT'), 'select granted');
select ok(has_column_privilege('authenticated', 'public.profiles', 'university', 'UPDATE'), 'update granted, guarded');
-- as member 2 (level 2): update refused by the guard 42501
-- as member 1 (bc): update of member 3's university succeeds
-- The rule.
-- as bc: set_member_role(u58(2), 'vot') succeeds (UBB)
-- as bc: set_member_role(u58(3), 'vot') throws PT409 vote_requires_ubb_student (other university)
-- as bc: set_member_role(u58(4), 'vot') throws PT409 vote_requires_ubb_student (unknown)
-- as owner: update profiles set role = 'vot' where id = u58(4) throws PT409 (any writer)
-- as owner: update profiles set university = 'Universitatea Tehnică din Cluj-Napoca' where id = u58(2) (a voter) succeeds: the rule is on the grant only
-- as owner: insert a profile with role 'vot' and university null succeeds (provisioning is outside the rule; R58 §Later)
-- trigger exists: has_trigger('public', 'profiles', 'profiles_guard_vote_university')
```

Write each commented line as a real assertion with `lives_ok` / `throws_ok` and the exact codes.

- [ ] **Step 2: Run it to watch it fail.** `npx supabase test db supabase/tests/profiles_university.test.sql`. Expected: the `has_column` assertion fails first.

- [ ] **Step 3: Migration section 1, the column.**

```sql
alter table public.profiles add column university text;
alter table public.profiles add constraint profiles_university_length_ck
  check (university is null or (char_length(university) between 2 and 120 and university !~ '^[[:space:]]|[[:space:]]$'));
comment on column public.profiles.university is '#R58: the university the Member studies at, chosen from the app''s list (Universitatea Babeș-Bolyai is the one that counts for Drept de Vot). Null until known. BC or the Moderator writes it (guard_profile_privileged_columns); the Member reads it.';
grant select (university) on public.profiles to authenticated;
grant update (university) on public.profiles to authenticated;
create function private.ubb_university() returns text language sql immutable set search_path = '' as $$ select 'Universitatea Babeș-Bolyai'::text $$;
revoke execute on function private.ubb_university() from public, anon, authenticated, service_role;
```

- [ ] **Step 4: Section 2, the privileged guard.** `dump 'public.guard_profile_privileged_columns()' guard`. Swaps: add `and new.university is not distinct from old.university` after the `joined_at` comparison; the message becomes `'Only BC (level >= 6) may change full_name, role, status, email, joined_at or university on a profile'`.

- [ ] **Step 5: Section 3, the UBB rule.**

```sql
create function private.guard_vote_university() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.university is distinct from private.ubb_university() then
    raise sqlstate 'PT409' using message = 'vote_requires_ubb_student';
  end if;
  return new;
end $$;
revoke execute on function private.guard_vote_university() from public, anon, authenticated, service_role;
create trigger profiles_guard_vote_university before update of role on public.profiles
  for each row when (new.role = 'vot' and old.role is distinct from 'vot')
  execute function private.guard_vote_university();
```

Comment on the trigger function: the rule of the organization (ADR-0004, 2026-10-18); a provisioning insert of a voter is outside it until the import carries the university.

- [ ] **Step 6: Section 4, the reads.** `create or replace view public.profiles_directory` restated from main with `profiles.university` appended after `board_title`; restate its `revoke`/`grant`. Drop `public.member_card(uuid)` and `private.member_card_impl(uuid)`, recreate both from the dumps with `university text` appended to the result table and `profile.university` appended to the select list; restate comments and grants.

- [ ] **Step 7: Fixed references.** `member_commands.test.sql:320,662,733` and `promotion_candidates.test.sql:253`: before each `set_member_role(…, 'vot')`, `update profiles set university = private.ubb_university() where id = <target>` (as owner, before the login). `retired_surface.test.sql:48-49` and `profiles_nickname.test.sql:34-40`: append `university` to the `columns_are` arrays. `member_card.test.sql:32`: append `university text` to the pinned result type. `tracker_grants.test.sql`: add rows `('ubb_university', '', 'none')` and `('guard_vote_university', '', 'trigger')` to `pinned_private_functions`, count `254`. `seed.sql:342-350`: add `university` to the column list; Maria Dobre and Raluca Ionescu (the two voters) get `'Universitatea Babeș-Bolyai'`, the others alternate UBB and `'Universitatea Tehnică din Cluj-Napoca'`, one null. `check-seed-rerunnable.sh:215-217`: its voter insert sets `university` to the canonical value.

- [ ] **Step 8: Run green.** `npx supabase db reset && npx supabase test db supabase/tests/profiles_university.test.sql supabase/tests/member_commands.test.sql supabase/tests/promotion_candidates.test.sql supabase/tests/member_card.test.sql supabase/tests/retired_surface.test.sql supabase/tests/profiles_nickname.test.sql supabase/tests/tracker_grants.test.sql`. Expected: all green.

- [ ] **Step 9: Mutation check.** Drop the trigger in a scratch transaction; the three `vote_requires_ubb_student` assertions must fail. Record the result for the PR body.

- [ ] **Step 10: Commit.** `git add -A supabase scripts && git commit -m "feat: Universitate on the Profile; only a UBB student is granted Drept de Vot (R58)"`

### Task 2: Universitate in the app

**Files:**

- Create: `app/src/lib/universities.ts`, `app/src/lib/universities.test.ts`
- Modify: `app/src/queries/admin-member.ts` (after `updateMemberJoinedAt`, :152-170), `app/src/lib/schemas/member-identity.ts` (after :95), `app/src/screens/administrare/MemberScreen.tsx` (a `UniversityRow` beside `JoinDateRow`, :267-399, mounted at :461), `app/src/queries/profile.ts:12-21,63`, `app/src/screens/profile/ProfileScreen.tsx:365-410`, `app/src/queries/member-card.ts:40-80,165`, `app/src/components/member/MemberCard.tsx:94,131-137`, `app/src/queries/groups-admin.ts:213-233`, `app/src/screens/administrare/RolePanel.tsx:301-310,575-606`, `app/src/lib/command-reasons.ts` (§Members and profiles, :456)
- Tests: `app/src/screens/administrare/MemberScreen.test.tsx`, `app/src/screens/profile/ProfileScreen.test.tsx` (the ten `Date de contact` references at :404,1072,1077,1152,1184,1315,1412,1430,1467,1485 and the row pin at :1483-1492), `app/src/components/member/MemberCard.test.tsx`, `app/src/queries/member-card.test.ts`, `app/src/screens/administrare/RolePanel.test.tsx:175-200`, `app/src/lib/command-reasons.test.ts`, fixtures carrying `MyProfile` (`ProfileScreen.test.tsx:80-90`, `ChangeEmailSection.test.tsx:33`, `EditProfileSheet.test.tsx:35`, `RoleTimeline.test.tsx:52`, `queries/profile.test.tsx:60-141`)

**Interfaces:**

- Consumes: Task 1's column, `member_card.university`, `profiles_directory.university`.
- Produces:

```ts
// app/src/lib/universities.ts
export const UBB = "Universitatea Babeș-Bolyai";
export const UNIVERSITIES: readonly string[]; // UBB first, then UTCN, UMF „Iuliu Hațieganu”, USAMV, UAD, Academia de Muzică „Gheorghe Dima”, Sapientia
export const OTHER_UNIVERSITY = "other";
export function universityOption(value: string | null): string | null; // the list entry, OTHER_UNIVERSITY for a value outside it, null for null
export function isUbbStudent(value: string | null | undefined): boolean; // value === UBB
// app/src/lib/schemas/member-identity.ts
export const memberUniversitySchema; // { option: string; other: string } → university: string, 2–120 trimmed when option === OTHER_UNIVERSITY, else the option; reasons invalid_university
export const universityFieldForReason: Readonly<Record<string, "university">>;
// app/src/queries/admin-member.ts
export async function updateMemberUniversity(input: {
  memberId: string;
  university: string;
}): Promise<void>;
export function useUpdateMemberUniversity(); // invalidates keys.members.all, keys.profile.all
```

- [ ] **Step 1: Failing model tests** in `universities.test.ts`: `universityOption(UBB) === UBB`, `universityOption('Universitatea Sapientia') === 'Universitatea Sapientia'`, `universityOption('Universitatea din București') === OTHER_UNIVERSITY`, `universityOption(null) === null`, `isUbbStudent(null) === false`; in `member-identity.test.ts`: the schema trims, refuses 1 character with `invalid_university`, passes the option through unchanged.

- [ ] **Step 2: Implement** `universities.ts`, the schema and the two query functions (the update is `.from('profiles').update({ university }).eq('id', memberId).select('id').single()`, like `updateMemberJoinedAt`).

- [ ] **Step 3: Failing component tests.**
  - `MemberScreen.test.tsx`: `it('BC edits Universitate from a list, with Altă universitate as free text')` — the row labelled `Universitate` shows `Necompletată` for null; the pencil opens a `Select` whose options are `UNIVERSITIES` plus `Altă universitate`; choosing `Altă universitate` shows an `Input` labelled `Numele universității`; `Salvează` calls `useUpdateMemberUniversity` with the typed name; receipt `Universitatea a fost salvată.`
  - `ProfileScreen.test.tsx`: rename every `Date de contact` to `Date personale`; the row pin at :1483-1492 becomes `['E-mailmaria@osubb.ro', 'Telefon0722334455', 'UniversitateUniversitatea Babeș-Bolyai']`; a null shows `Necompletată` in italics.
  - `MemberCard.test.tsx`: the meta line reads `Membru din 12 mar. 2024 · Universitatea Babeș-Bolyai`; without a university it reads as today.
  - `RolePanel.test.tsx`: `it('offers Drept de Vot only to a UBB student')` — for a member whose `university` is other or null, the `vot` option is disabled and the note `Doar un student UBB poate primi Drept de Vot.` shows under the Select; for a UBB student it is enabled.
  - `command-reasons.test.ts`: `vote_requires_ubb_student` and `invalid_university` have their copy.

- [ ] **Step 4: Implement the components.** `MemberScreen`: `UniversityRow` mirrors `JoinDateRow` (same pencil, `EditorActions`, receipt pattern; `canEdit` gate). `ProfileScreen`: panel title `Date personale`, pencil label `Editează datele personale`, a third read-only `SettingRow` `Universitate`; `MyProfile` gains `university: string | null` and the self select adds `university`. `MemberCard`: `MemberCardData.university`, `CardRow.university`, the meta line appends ` · {university}` when set. `groups-admin.ts`: `AppointableMember.university`, the directory select adds `university`. `RolePanel`: `roleOptions` marks `vot` `disabled: !isUbbStudent(member.university)` (keep the option visible, unlike the filtered leadership ranks, so BC sees why); the note renders under the Select whenever the chosen Member is not a UBB student. `command-reasons.ts`: the two entries.

- [ ] **Step 5: Types.** `npm --prefix app run gen:types` against the reset stack, then `npm --prefix app run typecheck`.

- [ ] **Step 6: Run green.** `npm --prefix app run test:run -- src/lib src/queries src/screens/administrare src/screens/profile src/components/member`. Expected: green.

- [ ] **Step 7: Commit.** `git commit -am "feat: Universitate in Profil, on the Member Card and in Administrare; Drept de Vot offered only to UBB students (R58)"`

### Task 3: Privacy Notice 1.2, docs, gates, PR

**Files:**

- Modify: `app/src/screens/privacy/PrivacyNoticeContent.tsx:19-21,199,270`, `docs/legal/politica-de-confidentialitate.md:14,28,52,104`
- Create: `supabase/migrations/<ts>_privacy_notice_1_2.sql` (pattern `20260929090000_privacy_notice_1_1.sql`)
- Modify the `'1.1'` pins: `app/src/components/shell/PrivacyGate.test.tsx:13,79,88,109,120,135,141,149`, `supabase/tests/org_settings.test.sql:120,187`, `supabase/tests/privacy_notice_acknowledgements.test.sql`, `supabase/tests/privacy_notice_version.test.sql:47`
- Modify: `docs/superpowers/specs/2026-10-18-portofoliu-interne-design.md` §Later (one line: a voter provisioned directly by `provision_profile` / the volunteer import is outside the trigger until the import carries the university); `CONTEXT.md` **Privacy Notice** unchanged.

- [ ] **Step 1: The notice.** In the TSX at :199 the "Apartenența la organizație" list gains `universitatea la care studiezi` after `data intrării`; at :270 the sentence listing what every Member sees gains `universitatea`. Mirror both in the markdown word for word, add the changelog line `1.2 — <date>: universitatea la care studiezi, vizibilă oricărui membru`, set `PRIVACY_NOTICE_VERSION = '1.2'` and `PRIVACY_NOTICE_DATE` to the merge day (set on the final commit). The migration raises `org_settings.privacy_notice_version` to `1.2` with the 1.1 pattern. Update every `'1.1'` pin listed above.

- [ ] **Step 2: Run** `npm --prefix app run test:run -- src/screens/privacy src/components/shell` and `npx supabase test db supabase/tests/org_settings.test.sql supabase/tests/privacy_notice_acknowledgements.test.sql supabase/tests/privacy_notice_version.test.sql`. Expected: green.

- [ ] **Step 3: Gates** (sequenced, never overlapping): `bash scripts/check-local-ci.sh db`; then `npm --prefix app run typecheck && npm --prefix app run lint && npm --prefix app run format:check`; then `npm --prefix app run test:run`; then `npm run check:root`. Expected: all green.

- [ ] **Step 4: See it.** `preview_start` the app, sign in on the local stack as the demo BC member, open Administrare → Membri → a Member, edit Universitate; open Profil (Date personale) and a Member Card. Screenshots to `docs/pr-assets/r58-universitate/` (1280 and 375, light and dark).

- [ ] **Step 5: Commit, push, PR.** `git commit -am "docs: Privacy Notice 1.2 names Universitate (R58)" && git push -u origin feat/universitate`, then `gh pr create --title "Universitate on the Profile; Drept de Vot only for UBB students (R58, part 1)" --body-file .superpowers/pr-body-universitate.md` (the body: spec, migration sections, the trigger's scope and the provisioning gap, the mutation record, tests, gates, screenshots). Then `gh pr comment <n> --body "@coderabbitai review"`.

- [ ] **Step 6: Review and merge** per Global Constraints → Shipping, after Alex's go-ahead.

---

# PR 2 — the settings and the Points Start Date (branch `feat/evaluation-settings`)

**Precondition:** PR 1 merged. `git checkout main && git pull --ff-only && npx supabase db reset && git checkout -b feat/evaluation-settings`, then `npx supabase migration new evaluation_settings`. Tasks 4–6 append to that migration in order.

### Task 4: `evaluation_settings` and the widened change log

**Files:**

- Create: `supabase/migrations/<ts>_evaluation_settings.sql` (sections 1–2)
- Create: `supabase/tests/evaluation_settings.test.sql`
- Modify: `supabase/tests/role_evaluations.test.sql:373` (the log `columns_are`), `supabase/tests/rls_deny_by_default.test.sql:224-237`, `supabase/tests/live_changes.test.sql` (no exclusion; the trigger), `supabase/seed.sql:185-189` (null `evaluation_settings.updated_by` beside the `org_settings` pattern), `scripts/check-seed-rerunnable.sh:346`

**Interfaces:**

- Produces:

```sql
create table public.evaluation_settings (
  id                 smallint primary key,
  eligibility_floor  integer,
  membership_cutoff  date,
  points_start_date  date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.profiles (id),
  constraint evaluation_settings_singleton_ck check (id = 1),
  constraint evaluation_settings_floor_ck check (eligibility_floor is null or eligibility_floor >= 1),
  constraint evaluation_settings_updated_at_ck check (updated_at >= created_at)
);
-- RLS on; grant select to authenticated, service_role; policy evaluation_settings_read: auth_is_member() and caller_level() >= 0;
-- triggers evaluation_settings_set_updated_at (private.set_updated_at) and broadcast_change; index evaluation_settings_updated_by_idx;
-- insert (id) values (1).
-- promotion_threshold_changes: field in ('threshold','percent','tenure','enabled','floor','cutoff','points_start');
--   to_value drop not null; add from_date date, to_date date;
--   source in ('manual','role_evaluation','migration');
--   source_shape_ck gains: source = 'migration' => changed_by is null and role_evaluation_id is null;
--   new date_shape_ck: field in ('cutoff','points_start') => to_date is not null and to_value is null and from_value is null;
--                      field not in ('cutoff','points_start') => to_value is not null and to_date is null and from_date is null;
--   subject_ck gains: field in ('floor','cutoff','points_start') => kind is null and promotion_rule_id is null;
--   floor rows: to_value >= 1.
```

- [ ] **Step 1: Write the failing suite** `evaluation_settings.test.sql`, `plan(16)`: `has_table`, `col_is_pk`, the singleton check (`insert … (2)` throws `23514`), `eligibility_floor = 0` throws `23514`, exactly one row after reset with all three values null, `has_trigger` for `broadcast_change` and `evaluation_settings_set_updated_at`, the policy name `evaluation_settings_read` exists, a Voluntar (level 1) with claims reads the row, a claimless session reads nothing, `authenticated` has no insert/update/delete privilege; on the log: `columns_are` with the two new date columns, a `cutoff` row with `to_value` set throws `23514`, a `floor` row with `to_date` set throws `23514`, a `migration` row with `changed_by` set throws `23514`.

- [ ] **Step 2: Watch it fail.** `npx supabase test db supabase/tests/evaluation_settings.test.sql`.

- [ ] **Step 3: Migration section 1, the table** (as in Interfaces; comments on the table and each column from the glossary) **and section 2, the log** (drop and recreate `promotion_threshold_changes_field_ck`, `_source_ck`, `_source_shape_ck`, `_subject_ck`, `_to_value_range_ck`; add the columns and `promotion_threshold_changes_date_shape_ck`).

- [ ] **Step 4: Fixed references.** `role_evaluations.test.sql:373` array gains `from_date`, `to_date`. `rls_deny_by_default.test.sql`: the seeded row satisfies the fixture requirement; add `evaluation_settings` to the claimless sweep's table list if it is enumerated there. `seed.sql`: `update public.evaluation_settings set updated_by = null where updated_by in (<demo ids>)` beside :185-189. `check-seed-rerunnable.sh:346`: unchanged unless it pins the log's column count.

- [ ] **Step 5: Run green** on the suite plus `role_evaluations.test.sql`, `rls_deny_by_default.test.sql`, `live_changes.test.sql`, `schema_naming.test.sql`, `advisor_findings.test.sql`.

- [ ] **Step 6: Commit.** `git commit -am "feat: evaluation_settings and a change log that holds dates (R58)"`

### Task 5: The three commands

**Files:**

- Modify: the migration (section 3)
- Create: `supabase/tests/evaluation_settings_commands.test.sql`
- Modify: `supabase/tests/tracker_grants.test.sql` (public rows for the three commands; private rows for the three `_impl`s and `points_floor`; count `258`)

**Interfaces:**

- Produces (each `_impl` plpgsql security definer, each wrapper sql security invoker, both granted to `authenticated`):

```sql
private.set_eligibility_floor_impl(p_points integer)  returns public.evaluation_settings
public.set_eligibility_floor(p_points integer)        returns public.evaluation_settings
private.set_membership_cutoff_impl(p_date date)       returns public.evaluation_settings
public.set_membership_cutoff(p_date date)             returns public.evaluation_settings
private.set_points_start_date_impl(p_date date)       returns public.evaluation_settings
public.set_points_start_date(p_date date)             returns public.evaluation_settings
private.points_floor() returns timestamptz  -- stable, security invoker, granted to nobody: the Bucharest start of points_start_date, null when unset
```

Order inside each `_impl`: 1. `PT400 invalid_eligibility_floor` (null or < 1) / `invalid_membership_cutoff` / `invalid_points_start_date` (null or after `(now() at time zone 'Europe/Bucharest')::date`); 2. gate: `private.require_active_member()` remapped to `42501 evaluation_settings_manage_forbidden`, then level < 6 → the same; 3. `pg_advisory_xact_lock(47, 1)`, then `select … from public.evaluation_settings where id = 1 for no key update`; 4. `PT409 nothing_to_update` when equal; 5. update value, `updated_by`; 6. one log row: `field 'floor'` with `from_value/to_value`, or `field 'cutoff' | 'points_start'` with `from_date/to_date`, `source 'manual'`, `changed_by = v_actor`, `kind null`.

- [ ] **Step 1: Write the failing suite** `evaluation_settings_commands.test.sql`, `plan(30)`: for each command: refused for a Voluntar (`42501 evaluation_settings_manage_forbidden`), refused claimless, accepted for BC with the row returned and the value stored, `nothing_to_update` on a repeat, the malformed value's `PT400` (floor 0; a date tomorrow), one log row per change with the right `field`, `from_*`/`to_*`, `changed_by`; `points_floor()` is null before and the Bucharest midnight instant after; a race probe in `pg_temp.test_race` that the command waits on `(47, 1)`.

- [ ] **Step 2: Watch it fail.**

- [ ] **Step 3: Migration section 3**, the six functions and `points_floor`, with comments and grants. Model the gate on `private.set_promotion_threshold_impl` (main: `20260927220000_role_evaluations.sql:895-951`).

- [ ] **Step 4: Rosters.** `tracker_grants.test.sql`: public rows `('set_eligibility_floor', 'p_points integer', false, true, false, false)`, `('set_membership_cutoff', 'p_date date', …)`, `('set_points_start_date', 'p_date date', …)`; private rows for the three `_impl`s (`impl`) and `('points_floor', '', 'none')`; count `258`.

- [ ] **Step 5: Run green** on the suite and `tracker_grants.test.sql`.

- [ ] **Step 6: Commit.** `git commit -am "feat: set_eligibility_floor, set_membership_cutoff, set_points_start_date (R58)"`

### Task 6: The Points Start Date in every total

**Files:**

- Modify: the migration (section 4)
- Create: `supabase/tests/points_start_date.test.sql`
- Modify: `supabase/tests/my_points.test.sql`, `supabase/tests/leadership_leaderboard.test.sql`, `supabase/tests/dept_cup.test.sql`, `supabase/tests/campaign_report.test.sql` (only if their fixtures assume no floor; none should, since the seeded value is null)

**Interfaces:**

- Consumes: `private.points_floor()`; main's `public.my_points` (`20260910111231_member_own_points.sql:4-14`), `private.leadership_leaderboard_impl(bigint, bigint, timestamptz, timestamptz, boolean)` (`20261007180000_preferred_groups.sql:623-712`), `private.department_cup_rows(bigint, timestamptz, timestamptz)` (`20260928120000_audit_d_server_fixes.sql:125-181`), `private.campaign_report_impl(bigint, timestamptz, timestamptz)` and `private.campaign_totals_impl(bigint, timestamptz, timestamptz)` (`20260924013452_work_filter_date_ranges.sql:249-325, 353-410`).
- Produces: the same signatures with these rules:
  - `my_points`: a ledger row counts when `evaluation_id is not null and evaluation.evaluated_at >= floor`, or when `reason not in ('task','task_reversal') and created_at >= floor`; an orphaned `task`/`task_reversal` row (`evaluation_id is null`) never counts; `floor` is `coalesce(private.points_floor(), '-infinity')`; the bound lives in the `left join … on` clause so the zero row survives.
  - `leadership_leaderboard_impl` and `department_cup_rows` (the Clasament page): the lower bound is `coalesce(p_from, private.points_floor())` — an explicit `p_from` is honoured even when earlier (the lookback).
  - `campaign_report_impl` and `campaign_totals_impl`: a second conjunct `(private.points_floor() is null or evaluation.evaluated_at >= private.points_floor())` beside the `p_from` one, also on `campaign_totals_impl`'s `awarded_at` bound; no lookback.
  - Untouched: `private.task_points_in_range`, `my_role_evaluation_standing`, `refresh_promotion_candidates`, every stake/reconciliation sum (`task_points_at_stake`, `delete_tasks_effect`, `group_delete_summary`, `legacy_task_import_totals`).

- [ ] **Step 1: Write the failing suite** `points_start_date.test.sql`, `plan(14)`. Fixture: one Department Group with two Members, three Tasks evaluated at 2026-03-01, 2026-09-01 and 2026-10-05 (use the existing `complete_task_review`-style helpers from `points_engine.test.sql`), a Sanction row dated 2026-04-01, a Campaign on the Tasks. Then `set_points_start_date('2026-09-01')` as BC and assert: `my_points` for the earner = the September + October awards only (sanction excluded by date); `leadership_leaderboard()` with no range sums the same; `leadership_leaderboard(p_from := '2026-01-01')` sums all three (lookback); `department_cup()` without a range follows the floor and with `p_from` 2026-01-01 looks back; `campaign_totals(id)` and `campaign_report(id)` without a range follow the floor, and with `p_from := '2026-01-01'` **still** follow the floor; `tasks_completed` follows too; `my_role_evaluation_standing('voluntar_activ')` ignores the floor. Review Focus 2: delete the March Task for good after setting the floor; `my_points` is unchanged (the orphan pair does not count); with the floor cleared back to null (no command clears it: do it as owner in the test), the pair nets to zero and the total equals all awards.

- [ ] **Step 2: Watch it fail.**

- [ ] **Step 3: Section 4.** Restate the view and the four `_impl`s from the dumps with the swaps named in Interfaces (`create or replace`; signatures unchanged, so wrappers and grants stay).

- [ ] **Step 4: Run green** on the suite plus `my_points.test.sql`, `leadership_leaderboard.test.sql`, `group_member_set.test.sql`, `preferred_groups.test.sql`, `dept_cup.test.sql`, `department_cup_task_origins.test.sql`, `campaign_report.test.sql`, `points_authorization_matrix.test.sql`, `delete_for_good.test.sql`.

- [ ] **Step 5: Mutation check.** Revert the `my_points` swap alone: the suite's `my_points` assertion must fail; revert the leaderboard swap alone: the no-range leaderboard assertion must fail.

- [ ] **Step 6: Commit.** `git commit -am "feat: every total counts from the Points Start Date; Clasament may look back (R58)"`

### Task 7: The settings and the start date in the app

**Files:**

- Create: `app/src/queries/evaluation-settings.ts`, `app/src/queries/evaluation-settings.test.ts`
- Modify: `app/src/queries/keys.ts:362-382` (`evaluation.settings(memberId)`), `app/src/queries/live-changes.ts:127-138` (`evaluation_settings` → `[keys.evaluation.all, keys.points.all, keys.campaigns.all]`), `app/src/lib/command-reasons.ts:585-648` (the five new reasons; `org_setting_not_settable` copy), `app/src/screens/dashboard/PointsStat.tsx:42-45`, `app/src/components/profile/PromotionProgress.tsx:84-99` (`PointsTotal`), `app/src/screens/tracker/PersonalScoreHeader.tsx:23`, `app/src/screens/leadership/LeadershipScreen.tsx:355-376` (`cupScope`), `app/src/screens/leadership/MemberTrackerScreen.tsx:219`, `app/src/queries/leadership.ts:70-112` (`fetchLeadershipMemberTotal`'s browser fallback applies the floor when no `p_from`)
- Tests: `PointsStat` via `DashboardScreen.test.tsx`, `PromotionProgress.test.tsx`, `LeadershipScreen.test.tsx`, `MemberTrackerScreen.test.tsx`, `queries/leadership.test.ts`, `command-reasons.test.ts`, `live-changes.test.tsx`

The Setări panel that edits these three values ships in PR 3 with the page; PR 2 only reads them.

**Interfaces:**

```ts
// app/src/queries/evaluation-settings.ts
export type EvaluationSettings = {
  eligibilityFloor: number | null;
  membershipCutoff: string | null;
  pointsStartDate: string | null;
  updatedAt: string;
  updatedBy: string | null;
};
export async function fetchEvaluationSettings(): Promise<EvaluationSettings>; // from('evaluation_settings').select(...).eq('id', 1).single()
export function useEvaluationSettings();
export function usePointsStartDate(): string | null | undefined; // the one field, for the points surfaces
export type EvaluationSettingCommand =
  | { kind: "floor"; points: number }
  | { kind: "cutoff"; date: string }
  | { kind: "pointsStart"; date: string };
export async function runEvaluationSettingCommand(
  command: EvaluationSettingCommand,
): Promise<void>; // the three RPCs; CommandError with FAILED copy
export function useEvaluationSettingCommand(); // invalidates keys.evaluation.all, keys.points.all, keys.campaigns.all
export function pointsSinceText(date: string | null | undefined): string | null; // 'din 01.09.2026' or null
```

- [ ] **Step 1: Failing tests.** `evaluation-settings.test.ts`: the three commands call `set_eligibility_floor` / `set_membership_cutoff` / `set_points_start_date` with `p_points` / `p_date`; a refusal becomes a `CommandError` with its reason; `pointsSinceText('2026-09-01') === 'din 01.09.2026'`, null for null. `DashboardScreen.test.tsx`: with a start date the points stat reads `14 puncte · Voluntar · din 01.09.2026`. `PromotionProgress.test.tsx`: `PointsTotal` shows `din 01.09.2026` under the number when set. `LeadershipScreen.test.tsx`: without a range and with a start date the Cup caption reads `puncte acordate din 01.09.2026`; with `de_la` earlier than the start date it reads the range as today (the lookback). `leadership.test.ts`: the fallback ledger sum filters `evaluated_at >= floor` when no `p_from`.

- [ ] **Step 2: Implement.** Keep `pointsSinceText` and the query module the only readers of the date; every surface imports from there.

- [ ] **Step 3: Types, typecheck, run green.** `npm --prefix app run gen:types`, `npm --prefix app run typecheck`, `npm --prefix app run test:run -- src/queries src/screens/dashboard src/screens/leadership src/components/profile src/lib`.

- [ ] **Step 4: Commit.** `git commit -am "feat: the Points Start Date beside every total in the app (R58)"`

### Task 8: Docs, gates, PR

- [ ] **Step 1: Docs.** `docs/backend/conventions.md` (none needed unless a convention moved); `docs/adr/0011-live-updates-broadcast.md:24` table list gains `evaluation_settings`; `docs/backend/seeding-staging.md` mentions the nulled `updated_by`.
- [ ] **Step 2: Gates** (sequenced): `bash scripts/check-local-ci.sh db`; `npm --prefix app run typecheck && npm --prefix app run lint && npm --prefix app run format:check`; `npm --prefix app run test:run`; `npm run check:root`.
- [ ] **Step 3: See it.** Set a start date as owner on the local stack (`select public.set_points_start_date(...)` through a BC login in Studio's SQL editor is a hand edit of data, not schema: allowed for a look), open Acasă, Profil, Clasament with and without `de_la`. Screenshots to `docs/pr-assets/r58-points-start-date/`.
- [ ] **Step 4: PR.** `git push -u origin feat/evaluation-settings`, `gh pr create --title "Evaluation settings and the Points Start Date (R58, part 2)" --body-file .superpowers/pr-body-evaluation-settings.md`, `@coderabbitai review`, then review and merge after Alex's go-ahead.

---

# PR 3 — Portofoliu Interne (branch `feat/portofoliu-interne`)

**Precondition:** PR 2 merged. `git checkout main && git pull --ff-only && npx supabase db reset && git checkout -b feat/portofoliu-interne`, then `npx supabase migration new portofoliu_interne`. Tasks 9–11 append to that migration in order; re-dump every function from the reset stack.

### Task 9: The ranking core, the Simulation and the finalised run

**Files:**

- Modify: the migration (sections 1–5)
- Create: `supabase/tests/role_evaluation_simulation.test.sql`
- Modify: `supabase/tests/role_evaluation_ranking.test.sql`, `supabase/tests/role_evaluation_command.test.sql` (new signature; the verbatim notification texts at :381-384, :415), `supabase/tests/role_evaluations.test.sql:111` (`columns_are`), `supabase/tests/evaluation_percent_command.test.sql`, `supabase/tests/org_settings.test.sql:104-131,186-193` (the `vote_retention_percent` seed assertions go), `scripts/check-seed-rerunnable.sh:332-339` (the seven-argument run), `supabase/tests/tracker_grants.test.sql`

**Interfaces:**

- Consumes: main's `private.role_evaluation_rows(text, date, date, date)`, `private.role_evaluation_ranking_impl(text, date, date)`, `public.role_evaluation_ranking(text, date, date)`, `private.run_role_evaluation_impl(text, date, date, text)` (`20261002120000_live_promotion_candidates.sql:268-487`), `public.run_role_evaluation(text, date, date, text)`, `private.set_evaluation_percent_impl(text, integer)` and `public.evaluation_percents()` (`20260928110000_evaluation_percentages.sql`), `private.notify(uuid[], noti_kind, text, text, bigint, text, uuid, text, boolean)`.
- Produces:

```sql
-- Section 0: public.retention_signals -- the table described under Task 10 "Section 6" is created HERE, as this migration's first section (ledger Ruling 1), because this task's run writes it and this task's suite asserts the rows; its rls_deny_by_default fixture and live_changes trigger come with it. Task 10 keeps sections 7-9.
-- Section 1: the shares move home.
alter table public.evaluation_settings
  add column activ_percent integer not null default 35, add column vot_percent integer not null default 25,
  add constraint evaluation_settings_activ_percent_ck check (activ_percent between 1 and 100),
  add constraint evaluation_settings_vot_percent_ck check (vot_percent between 1 and 100);
-- seed activ_percent from promotion_rules.percent (top_percent) and vot_percent from org_settings.vote_retention_percent,
-- then set both to 35 / 25 with one log row each: field 'percent', kind 'voluntar_activ' / 'adunarea_generala', source 'migration'.
-- delete from org_settings where key = 'vote_retention_percent'; set_org_setting_impl loses its special case (restate: the branch raising org_setting_not_settable goes).
-- set_evaluation_percent_impl writes evaluation_settings (lock (47,1), the kind's promotion_thresholds row, then evaluation_settings for no key update); evaluation_percents() reads it.

-- Section 2: the runs carry their values.
alter table public.role_evaluations
  add column eligibility_floor integer, add column percent_used integer, add column membership_cutoff date, add column evaluated_count integer,
  add constraint role_evaluations_floor_ck check (eligibility_floor is null or eligibility_floor >= 1),
  add constraint role_evaluations_percent_used_ck check (percent_used is null or percent_used between 1 and 100),
  add constraint role_evaluations_evaluated_count_ck check (evaluated_count is null or evaluated_count >= ranked_count);
-- ranked_count keeps its meaning: Members ranked (at or above the Floor). Pre-R58 rows keep the four new columns null.

-- Section 3: the core.
drop function private.role_evaluation_rows(text, date, date, date);
create function private.role_evaluation_rows(p_kind text, p_from date, p_to date, p_floor integer, p_percent integer, p_cutoff date)
returns table (member_id uuid, role public.member_role, task_points integer, ranked boolean, rank integer,
               evaluated_count integer, ranked_count integer, share_size integer, line integer, inside boolean, listable boolean)
-- plpgsql stable, not definer, granted to nobody. PT400 invalid_role_evaluation_kind, invalid_date_range,
-- invalid_eligibility_floor (null or < 1), invalid_percent (null or outside 1-100); p_cutoff may be null for adunarea_generala, PT400 membership_cutoff_not_set for voluntar_activ.
-- population: voluntar_activ -> status activ and role in ('recrut','voluntar','activ','vot'); adunarea_generala -> status activ and role = 'vot'.
-- task_points from private.task_points_in_range over the period; ranked = task_points >= p_floor; rank = rank() over ranked rows by task_points desc;
-- line = task_points of the share_size-th row by (task_points desc, member_id) among ranked rows; inside = ranked and task_points >= line;
-- listable = p_kind = 'voluntar_activ' and role = 'voluntar' and joined_at is not null and joined_at <= p_cutoff.

-- Section 4: the two entry points.
create function private.simulate_role_evaluation_impl(p_kind text, p_from date, p_to date, p_floor integer, p_percent integer, p_cutoff date)
returns table (<the core's columns>)  -- plpgsql stable security definer; date_range_in_future when p_to > today; gate 42501 role_evaluation_manage_forbidden; returns the core's rows; writes nothing.
create function public.simulate_role_evaluation(p_kind text, p_from date, p_to date, p_floor integer, p_percent integer, p_cutoff date default null) returns table (<same>);

drop function public.run_role_evaluation(text, date, date, text); drop function private.run_role_evaluation_impl(text, date, date, text);
create function private.run_role_evaluation_impl(p_kind text, p_from date, p_to date, p_name text, p_floor integer, p_percent integer, p_cutoff date)
returns table (role_evaluation_id bigint, candidates integer, retention_signals integer);
create function public.run_role_evaluation(p_kind text, p_from date, p_to date, p_name text, p_floor integer, p_percent integer, p_cutoff date default null) returns table (<same>);

-- Section 5: the ranking of a recorded run.
drop function public.role_evaluation_ranking(text, date, date); drop function private.role_evaluation_ranking_impl(text, date, date);
create function private.role_evaluation_ranking_impl(p_role_evaluation_id bigint) returns table (<the core's columns>);
create function public.role_evaluation_ranking(p_role_evaluation_id bigint) returns table (<same>);
-- PT404 role_evaluation_not_found; a pre-R58 run (eligibility_floor is null) returns no rows; the visibility rule of main (can_read_evaluation_rankings or own row) stands.
```

`run_role_evaluation_impl`, in order: the PT400 checks of main plus the core's; name length; gate; `pg_advisory_xact_lock(47, 1)`; the kind's `promotion_thresholds` row `for no key update`; `evaluation_settings` row `for no key update`; the population's Profiles `for key share` (`role in ('recrut','voluntar','activ','vot')`); the core's rows into `v_rows`; `v_line` = any row's `line`; insert `role_evaluations` (`threshold_used` = the threshold in force, may be null now that nothing requires it; `threshold_computed = v_line`; the four new columns; `ranked_count`, `evaluated_count`); supersede the kind's open Promotion Candidates (voluntar_activ) and the kind's open `retention_signals` with reason in `('below_line','below_floor')`; insert Candidates for `listable and inside` with `threshold_used = v_line` and one `private.notify` each (the body text of main with "cel puțin pragul de %s puncte" reading the new line and the "și vechimea cerută" clause replaced by `, intrat în OSUBB până la DD.MM.YYYY`; link `/administrare/portofoliu-interne`); insert a Signal for every holder (`activ`/`vot` for voluntar_activ; `vot` for adunarea_generala) with `not inside` — reason `below_line` when ranked else `below_floor`, `task_points`, `threshold_used = v_line` — and one `notify` each (main's text, with `sub pragul de %s puncte` → `sub pragul de promovare de %s puncte` or `sub pragul minim de %s puncte`); hand `v_line` over when not null and distinct (log `source 'role_evaluation'`); write `eligibility_floor`, the kind's percent and (voluntar_activ) `membership_cutoff` into `evaluation_settings` when distinct, one log row each with `source 'role_evaluation'` and `role_evaluation_id`; `perform private.refresh_promotion_candidates()`; return. The `threshold_used` column's `not null` is dropped: a first run of a kind needs no prior line (PT409 `promotion_threshold_not_set` goes).

- [ ] **Step 1: Write the failing suite** `role_evaluation_simulation.test.sql`, `plan(34)`. Fixture (put it in `supabase/tests/_r58_fixtures.psql`, shared with Task 10): one BC member and ten active Members with these Task Points from Evaluations inside `[2026-03-01, 2026-09-30]`: Recrut A 60, Recrut B 0, Voluntar C (joined 2026-01-10) 50, Voluntar D (joined 2026-02-20) 40, Voluntar E (joined 2026-04-01) 30, Voluntar F (joined 2026-05-01) 25, Voluntar Activ G 20, Voluntar Activ H 15, voter I (UBB) 10, voter J (other university) 5. Assert for `simulate_role_evaluation('voluntar_activ', '2026-03-01', '2026-09-30', 10, 35, '2026-03-01')`: `evaluated_count = 10`, `ranked_count = 8` (B and J are below the Floor), `share_size = 3`, `line = 40` (A, C, D), `inside` true for exactly those three, `listable` only for C and D, every table's row count unchanged and no Notification after the call; floor 0 → `PT400 invalid_eligibility_floor`; `p_to` tomorrow → `PT400 date_range_in_future`; a Voluntar caller → `42501`; `adunarea_generala` with the same floor and 25 → `evaluated_count = 2`, `ranked_count = 1`, `line = 10`. Then `run_role_evaluation(... 'Evaluare S1', 10, 35, '2026-03-01')`: one `role_evaluations` row with the four values, `threshold_computed = 40`, `promotion_thresholds.threshold = 40` for the kind, one log row of `field 'threshold'`, one of `'floor'` (null → 10) and one of `'cutoff'`, Candidates = C and D with `threshold_used = 40`, Signals = G and H and I as `below_line` and J as `below_floor`, one Notification per Candidate and Signal with the new link; A (a Recrut inside) is neither Candidate nor Signal; E and F (joined after the cutoff) are neither; a second run with floor 100 (Review Focus 3): `threshold_computed` null, `promotion_thresholds` unchanged, no Candidate, a `below_floor` Signal for G, H, I and J, the first run's Signals `superseded`. `role_evaluation_ranking(<first run id>)` returns the same rows as the Simulation; for an id with `eligibility_floor is null` (insert one as owner) it returns no rows; an unknown id → `PT404 role_evaluation_not_found`. `evaluation_percents()` reads 35 / 25 after reset and `set_evaluation_percent('voluntar_activ', 40)` writes `evaluation_settings.activ_percent` with a log row; `org_settings` holds no `vote_retention_percent`.

- [ ] **Step 2: Watch it fail.**

- [ ] **Step 3: Sections 1–5.** Write section 1 by hand; restate `set_evaluation_percent_impl`, `evaluation_percents`, `set_org_setting_impl` from dumps with the swaps named above. Write the new core by hand (the comment block of main's core, updated). Write `simulate_role_evaluation_impl` by hand. Dump `run_role_evaluation_impl`, drop both, recreate from the dump with the swaps listed in Interfaces (the ranking call, the population lock, the insert column list, the candidate and signal loops, the hand-over, the settings write-through), then restate the wrapper, comments and grants. Section 5 by hand, modelled on main's `role_evaluation_ranking_impl`.

- [ ] **Step 4: Fixed references.** `role_evaluation_ranking.test.sql`: rewrite its calls to the six-argument core / the id-based ranking and drop its per-cohort assertions (the cohort rule is retired; keep its tie and visibility cases). `role_evaluation_command.test.sql`: the seven-argument run, the verbatim texts, the first-run-without-threshold case now succeeds. `role_evaluations.test.sql:111`: the four new columns. `org_settings.test.sql`: remove the `vote_retention_percent` assertions. `check-seed-rerunnable.sh:332-339`: `run_role_evaluation('voluntar_activ', current_date - 365, current_date, 'Evaluare demo #901', 1, 35, current_date)`. `tracker_grants.test.sql`: public rows for `run_role_evaluation` (new args), `role_evaluation_ranking` (`p_role_evaluation_id bigint`), `simulate_role_evaluation`; private rows for `role_evaluation_rows` (new args), `role_evaluation_ranking_impl`, `run_role_evaluation_impl`, `simulate_role_evaluation_impl`; count `259`.

- [ ] **Step 5: Run green** on the suite plus `role_evaluation_ranking.test.sql`, `role_evaluation_command.test.sql`, `role_evaluations.test.sql`, `evaluation_percent_command.test.sql`, `org_settings.test.sql`, `promotion_threshold_command.test.sql`, `tracker_grants.test.sql`.

- [ ] **Step 6: Mutation check.** Change `ranked = task_points >= p_floor` to `> p_floor`: the `ranked_count = 8` assertion must fail (the 10 is eligible). Change the Candidate loop to measure against `threshold_used`: the Candidates assertion must fail.

- [ ] **Step 7: Commit.** `git commit -am "feat: one ranking of the eligible, a Simulation, and a run that measures against the line it computes (R58)"`

### Task 10: Retention Signals stored, the live Universitate signal, the drops

**Files:**

- Modify: the migration (sections 6–9)
- Create: `supabase/tests/retention_signals.test.sql`
- Modify: `supabase/tests/promotion_candidates_live.test.sql:140,176,202-208`, `supabase/tests/promotion_candidates.test.sql`, `supabase/tests/apply_promotions.test.sql` (delete), `supabase/tests/detect_promotions.test.sql` (delete), `supabase/tests/promotion_rules.test.sql` (keep only the `promotion_thresholds` / `promotion_threshold_in_force` half, renamed `promotion_thresholds.test.sql`), `supabase/tests/promotion_rule_command.test.sql` (delete), `supabase/tests/provision_joined_at.test.sql:57,105,113-114`, `supabase/tests/legacy_task_import.test.sql:129`, `supabase/tests/retired_surface.test.sql`, `supabase/tests/notification_read_rules.test.sql`, `supabase/tests/live_changes.test.sql`, `supabase/tests/rls_deny_by_default.test.sql`, `supabase/tests/tracker_grants.test.sql`, `supabase/seed.sql:137-155`, `scripts/check-seed-rerunnable.sh:369-370`

**Interfaces:**

- Consumes: main's `private.refresh_promotion_candidates()` (`20261002120000:76-215`), `private.close_promotion_candidates()` (`20260927220000:1059-1082`), `private.notification_subject(bigint, text, text)` (`20261014160759_reminders.sql:592`).
- Produces:

```sql
-- Section 6: the table (the shape; CREATED BY TASK 9 as its section 0 per ledger Ruling 1 -- Task 10 writes nothing for it).
create table public.retention_signals (
  id                 bigint generated always as identity primary key,
  kind               text not null check (kind in ('voluntar_activ','adunarea_generala')),
  member_id          uuid not null references public.profiles (id),
  role_at_listing    public.member_role not null,
  reason             text not null check (reason in ('below_line','below_floor','not_ubb_student')),
  task_points        integer,
  threshold_used     integer,
  role_evaluation_id bigint references public.role_evaluations (id),   -- null: live
  created_at         timestamptz not null default now(),
  closed_at          timestamptz,
  closed_as          text check (closed_as in ('role_changed','superseded','resolved')),
  constraint retention_signals_closed_shape_ck check ((closed_at is null) = (closed_as is null)),
  constraint retention_signals_live_reason_ck check (role_evaluation_id is not null or reason = 'not_ubb_student'),
  constraint retention_signals_points_shape_ck check ((reason = 'not_ubb_student') = (task_points is null and threshold_used is null))
);
-- unique index retention_signals_open_uidx on (kind, member_id, reason) where closed_at is null; indexes on member_id, role_evaluation_id;
-- RLS; policy retention_signals_read: auth_is_member() and caller_level() >= 6; grant select to authenticated, service_role; broadcast_change.

-- Section 7: the live Universitate signal.
create function private.refresh_university_signals() returns integer  -- security definer, granted to nobody.
--   opens one live row (kind adunarea_generala, reason not_ubb_student, role_at_listing vot) for every active vot holder with
--   university is not null and university <> private.ubb_university() who has no open such row, with one private.notify to the
--   run's recipient set (every active level >= 6 Member plus the Adunarea Generală's Group Responsibles at level >= 5, never the Member) (title 'Semnal de retenție: %s', body '%s nu mai este student UBB (%s). Drept de Vot cere calitatea de student UBB; rolul nu se retrage automat: decizia îi aparține BC.',
--   dedupe 'retention_signal:live:' || member_id, link '/administrare/portofoliu-interne'); closes as 'resolved' every open such row whose holder is
--   UBB again, null again, or no longer activ; returns the number opened.
create function private.refresh_university_signals_on_write() returns trigger;  -- statement trigger body
create trigger profiles_refresh_university_signals after update of university, status on public.profiles for each statement execute function private.refresh_university_signals_on_write();
-- role changes: extend private.close_promotion_candidates() (role_history after insert) to also close every open retention_signals row of the Member as 'role_changed' when new.to_role is distinct from new.from_role.
-- private.notification_subject: the retention_signal pattern becomes '^retention_signal:(live|[0-9]+):[0-9a-f-]{36}$'.

-- Section 8: the refresh reads the cutoff.
-- restate private.refresh_promotion_candidates(): the promotion_rules read goes; v_cutoff from evaluation_settings.membership_cutoff;
--   nobody is eligible while v_cutoff is null or the voluntar_activ threshold is null; eligible = status activ, role voluntar, joined_at is not null and joined_at <= v_cutoff, task_points >= threshold;
--   tenure_since := joined_at (the column stays; it now records the join date measured).
--   the notification body's 'și vechimea cerută' becomes ', intrat în OSUBB până la ' || to_char(v_cutoff, 'DD.MM.YYYY').
-- drop trigger promotion_rules_refresh_promotion_candidates on promotion_rules;
-- create trigger evaluation_settings_refresh_promotion_candidates after update on public.evaluation_settings for each statement execute function private.refresh_promotion_candidates_on_write();

-- Section 9: the drops and the day-one data.
-- insert into retention_signals the Signals of the latest run of each kind, from the OLD core (still present until this section): kind, member_id, role, 'below_line', task_points, run.threshold_used, run.id, created_at = run.run_at.
-- select cron.unschedule('osubb-apply-promotions');
-- drop function private.apply_promotions(); drop function private.apply_promotion(uuid, member_role, member_role, text); drop function private.detect_promotions();
-- drop function public.update_promotion_rule(bigint, integer, boolean); drop function private.update_promotion_rule_impl(bigint, integer, boolean);
-- alter table promotion_threshold_changes drop constraint promotion_threshold_changes_promotion_rule_id_fkey;  -- the column and its tenure/enabled rows stay as history
-- drop table public.promotion_rules;
```

- [ ] **Step 1: Write the failing suite** `retention_signals.test.sql`, `plan(28)`: table shape and policy (a BC reads, a Voluntar reads nothing, claimless nothing); after a run (`\ir _r58_fixtures.psql`, Task 9's fixture), the Signals rows exist with reasons and the page-facing columns; a Role change through `set_member_role` closes the Member's open rows as `role_changed`; the live signal: a voter's `university` set to another university opens one `not_ubb_student` row and one Notification per BC member with dedupe `retention_signal:live:<uuid>` and subject `retention_signal:<uuid>` (Review Focus 1: setting `university` to null opens nothing; a voter whose university is null after reset has no row); setting it back to UBB closes the row as `resolved`; a second change does not duplicate an open row; a status change to `inactiv` closes it. Candidates (Review Focus 4): with the threshold 20 and `membership_cutoff` 2026-03-01, a Voluntar who joined 2026-02-01 and holds 25 points is listed live; `set_membership_cutoff('2026-01-15')` supersedes the row at once; `set_membership_cutoff('2026-03-01')` lists them again. Drops: `hasnt_table('public','promotion_rules')`, `hasnt_function` for the five functions, `cron.job` has no `osubb-apply-promotions`, `promotion_threshold_changes` still holds its `tenure` rows, `has_trigger('public','evaluation_settings','evaluation_settings_refresh_promotion_candidates')`.

- [ ] **Step 2: Watch it fail.**

- [ ] **Step 3: Sections 6–9** as in Interfaces. Section 9's data move runs before the drops, in one `do $$ … $$` block that calls the old four-argument core per latest run.

- [ ] **Step 4: Fixed references.** `promotion_candidates_live.test.sql`: the `promotion_rules` writes become `set_membership_cutoff` / `evaluation_settings` updates; the `has_trigger` on `promotion_rules` becomes the `evaluation_settings` one; the body text pin. `provision_joined_at.test.sql`: remove the `apply_promotions` calls and their assertions (plan down). `legacy_task_import.test.sql:129`: the `promotion_rules` update becomes an `evaluation_settings` update (or goes if #1074 removed the suite first). `retired_surface.test.sql`: `hasnt_` pins for `promotion_rules`, `update_promotion_rule`, `apply_promotions`, `apply_promotion`, `detect_promotions`, `role_evaluation_ranking(text,date,date)`, `run_role_evaluation(text,date,date,text)`. `notification_read_rules.test.sql`: a `live` retention case. `live_changes.test.sql`: nothing to exclude; `rls_deny_by_default.test.sql`: a `retention_signals` fixture row. `seed.sql:137-155`: the regex already allows `live`; add a `delete from retention_signals` by demo member before the `role_evaluations` delete. `check-seed-rerunnable.sh:369-370`: the orphan count accepts a `live` second segment for `retention_signal` too. `tracker_grants.test.sql`: drop the public row of `update_promotion_rule` and the private rows of `apply_promotions`, `apply_promotion`, `detect_promotions`, `update_promotion_rule_impl`; add `refresh_university_signals` (`none`), `refresh_university_signals_on_write` (`trigger`); count `257`. Delete `apply_promotions.test.sql`, `detect_promotions.test.sql`, `promotion_rule_command.test.sql`; split `promotion_rules.test.sql`.

- [ ] **Step 5: Run green** on the suite, Task 9's suite, `promotion_candidates.test.sql`, `promotion_candidates_live.test.sql`, `promotion_thresholds.test.sql`, `notification_read_rules.test.sql`, `retired_surface.test.sql`, `live_changes.test.sql`, `rls_deny_by_default.test.sql`, `advisor_findings.test.sql`, `schema_naming.test.sql`, `tracker_grants.test.sql`, `provision_joined_at.test.sql`, then the full `npx supabase test db`.

- [ ] **Step 6: Mutation check.** Remove the `university is not null and` guard in the refresh: the Review Focus 1 assertion must fail. Remove the `evaluation_settings` refresh trigger: the Review Focus 4 assertion must fail.

- [ ] **Step 7: Commit.** `git commit -am "feat: Retention Signals stored, live on Universitate; the Promotion Rules and the daily job are gone (R58)"`

### Task 11: Types and the data layer of the page

**Files:**

- Modify: `app/src/lib/database.types.ts` (generated), `app/src/queries/role-evaluations.ts`, `app/src/queries/role-evaluations.test.ts`, `app/src/queries/evaluation-settings.ts` (`EvaluationSettings` gains `activPercent` and `votPercent`; the `percent` command stays in `role-evaluations.ts`), `app/src/queries/promotion-progress.ts:48` and `app/src/components/profile/promotion-state.ts` (the tenure state reads `membershipCutoff` and `joined_at`), `app/src/queries/live-changes.ts` (`retention_signals` → `[keys.evaluation.all]`; `promotion_rules` line goes), `app/src/lib/schemas/role-evaluation.ts` (`runSchema` gains `floor`, `percent`, `cutoff`; `promotionRuleSchema` goes), `app/src/queries/keys.ts` (`evaluation.rules` goes; `evaluation.signals(memberId)`, `evaluation.ranking(runId, memberId)`), `app/src/lib/command-reasons.ts` (the `tenure`/`rule` reasons go)

**Interfaces:**

```ts
// role-evaluations.ts
export type RoleEvaluation = { …as today…; eligibility_floor: number | null; percent_used: number | null; membership_cutoff: string | null; evaluated_count: number | null };
export type RankingRow = { memberId: string; role: MemberRole; taskPoints: number; ranked: boolean; rank: number | null; evaluatedCount: number; rankedCount: number; shareSize: number; line: number | null; inside: boolean; listable: boolean };
export type RunValues = { kind: RoleEvaluationKind; from: string; to: string; name: string; floor: number; percent: number; cutoff: string | null };
export async function simulateRoleEvaluation(values: Omit<RunValues, 'name'>): Promise<RankingRow[]>;      // rpc simulate_role_evaluation
export async function fetchRoleEvaluationRanking(runId: number): Promise<RankingRow[]>;                     // rpc role_evaluation_ranking({ p_role_evaluation_id })
export type RetentionSignal = { id: number; kind: string; memberId: string; roleAtListing: MemberRole; reason: 'below_line' | 'below_floor' | 'not_ubb_student'; taskPoints: number | null; thresholdUsed: number | null; roleEvaluationId: number | null; listedAt: string };
export async function fetchRetentionSignals(): Promise<RetentionSignal[]>;                                 // open rows, kind then lowest points first
export function useRetentionSignals();
export function simulationOutcome(rows: readonly RankingRow[], kind: RoleEvaluationKind): { line: number | null; rankedCount: number; evaluatedCount: number; candidates: RankingRow[]; signals: { row: RankingRow; reason: 'below_line' | 'below_floor' }[] };
export type RoleEvaluationCommand =
  | { kind: 'run'; values: RunValues }                          // rpc run_role_evaluation with p_floor, p_percent, p_cutoff
  | { kind: 'threshold'; evaluationKind: RoleEvaluationKind; threshold: number }
  | { kind: 'percent'; evaluationKind: RoleEvaluationKind; percent: number }
  | { kind: 'reject'; candidateId: number; reason: string };
// promotion-state.ts: PromotionState.tenure becomes { cutoff: string | null; joinedAt: string | null; met: boolean } (met = joinedAt <= cutoff)
```

- [ ] **Step 1: Types.** `npm --prefix app run gen:types` against the reset stack with the migration applied; `npm --prefix app run typecheck` lists every breakage: that list is this task's checklist.

- [ ] **Step 2: Failing query tests.** `role-evaluations.test.ts`: `simulateRoleEvaluation` sends the six arguments; the run sends seven; `fetchRoleEvaluationRanking(12)` sends `{ p_role_evaluation_id: 12 }`; `simulationOutcome` on a fixture of six rows returns the line, the two listable-and-inside Candidates, and the holders not inside with `below_line` when ranked and `below_floor` when not; `fetchRetentionSignals` orders by kind then points. `promotion-progress.test.ts`: the tenure state is met when `joined_at <= membershipCutoff` and unmet when the cutoff is null. `schemas/role-evaluation.test.ts`: `runSchema` requires `floor >= 1`, `percent` 1–100, and `cutoff` only for `voluntar_activ`.

- [ ] **Step 3: Implement**, deleting `fetchPromotionRules`, `usePromotionRules`, the `rule` command, `promotionRuleSchema`, and `useRoleEvaluationRanking(run)` in favour of `useRoleEvaluationRanking(runId: number | null)`.

- [ ] **Step 4: Run green.** `npm --prefix app run typecheck && npm --prefix app run test:run -- src/queries src/lib src/components/profile`.

- [ ] **Step 5: Commit.** `git commit -am "feat: the page's reads and commands for Portofoliu Interne (R58)"`

### Task 12: The page, the route, the redirect

**Files:**

- Create: `app/src/screens/administrare/portofoliu/PortofoliuInterneScreen.tsx` (the default export; layout and the kind switch), `RunPanel.tsx` (form → Simulație → Finalizează), `SimulationResult.tsx` (line, counts, Candidates, Signals, **Vezi clasamentul** opening `RankingSheet`), `RankingSheet.tsx` (the details-sheet pattern of `DealDetailsSheet.tsx:69-93`, a `DataTable` of the rows: Member, Role, points, rank or `sub prag minim`, inside), `SettingsPanel.tsx` (five `SettingRow`s: Prag minim, Data limită de intrare, Data de început a punctajului, Procent Voluntar Activ, Procent Adunarea Generală, plus the two `ThresholdRow`s under a `Praguri în vigoare` sub-heading), `CandidatesPanel.tsx`, `SignalsPanel.tsx`, `HistoryPanel.tsx`, `ChangeLogPanel.tsx`, `portofoliu-text.ts`, and their `.test.tsx` files; move the surviving components out of `RoleEvaluationsScreen.tsx` (`Name`, `SettingRow`, `EditorActions`, `PercentRow`, `ThresholdRow`, `RejectDialog`, `useChangeAuthors`) into `portofoliu/shared.tsx`
- Delete: `app/src/screens/administrare/RoleEvaluationsScreen.tsx`, `RoleEvaluationsScreen.test.tsx`, `role-evaluation-text.ts`, `role-evaluation-text.test.ts` (their surviving tests move with their components)
- Modify: `app/src/screens/administrare/administrare-tabs.ts:66-71` (`path: '/administrare/portofoliu-interne'`, `label: 'Portofoliu Interne'`), `app/src/App.tsx:69-71,449-461` (lazy import; `path="portofoliu-interne"`; `evaluari` and `perioade` both `<Navigate to="/administrare/portofoliu-interne" replace />`), `app/src/App.test.tsx:120-122,323-341,350,622`, `app/src/components/shell/navItems.ts:126-127`, `app/src/components/shell/AppShell.test.tsx:480`, `app/src/lib/auth-destination.test.ts:60`, `app/src/screens/administrare/AdminSettingsTab.tsx:543` (`to: '/administrare/portofoliu-interne'`, label `Setările evaluărilor`), `AdminSettingsTab.test.tsx:160-163`, `AdministrareLayout.test.tsx:88,125,138-139,275`, `app/src/lib/command-reasons.ts:624`

**Interfaces:**

- Consumes: Task 11's reads and commands, Task 7's `useEvaluationSettings` / `useEvaluationSettingCommand`, `useEvaluationPercents`.
- Produces (in `portofoliu-text.ts`):

```ts
export function formatDay(iso: string | null | undefined): string; // as before
export function defaultRangeStart(
  lastTo: string | null | undefined,
  today: string,
): string;
export function finalizeConsequences(args: {
  kind: RoleEvaluationKind;
  from: string;
  to: string;
  floor: number;
  percent: number;
  cutoff: string | null;
  line: number | null;
}): string; // the spec's §F confirmation text; with line null: 'Nimeni nu atinge pragul minim: evaluarea se înregistrează fără prag nou, iar toți deținătorii devin semnale de retenție.'
export function runResultText(args: {
  kind: RoleEvaluationKind;
  name: string;
  candidates: number;
  retentionSignals: number;
}): string;
export function signalReasonText(
  signal: Pick<RetentionSignal, "reason" | "taskPoints" | "thresholdUsed">,
): string; // 'sub pragul de promovare (12 din 40 de puncte)' | 'sub pragul minim (3 din 10 puncte)' | 'nu mai este student UBB'
export function promoteHref(candidate: PromotionCandidate): string; // reason text names the run or the listing day, as before
export const SIMULATION_NOTE = "Simulare, nimic nu a fost salvat.";
```

Layout: `ReceiptTurnScope` → `SegmentedRadio` **Tip** with two options (Vechime is gone) → `PageGrid columns={2} alignHeaders` with `RunPanel` and `SettingsPanel` → `PageGrid columns={1}` with `CandidatesPanel`, `SignalsPanel`, `HistoryPanel`, `ChangeLogPanel`. `RunPanel` state machine: `form` → (Simulează, pending) → `result` (shows `SimulationResult` with `SIMULATION_NOTE`, **Finalizează** opening the confirmation `Dialog` with `finalizeConsequences`, **Modifică valorile** back to `form` keeping the values); after a finalised run, the receipt `runResultText` and the form resets as today (`defaultRangeStart`). The form is prefilled from `useEvaluationSettings` and `useEvaluationPercents` on first render and after every finalised run; **Simulează** is disabled while `eligibilityFloor` is null with the hint `eligibility_floor_not_set` copy, and for `voluntar_activ` while `membershipCutoff` is null. `HistoryPanel` columns: name, kind, range, Prag minim, Procent, Data limită, run by, run at, line in force before, line computed, ranked / evaluated; a row opens `RankingSheet` for that run (empty state for a pre-R58 run: `Clasamentul evaluărilor de dinainte de Portofoliu Interne nu mai este disponibil.`). `ChangeLogPanel` words per field: `prag`, `procent`, `prag minim`, `data limită de intrare`, `data de început a punctajului`, and the historical `vechime` / `regulă pornită`.

- [ ] **Step 1: Failing tests** (one file per component; mock supabase as `RoleEvaluationsScreen.test.tsx:80-300` did, the RPC switch gaining `simulate_role_evaluation`, `set_eligibility_floor`, `set_membership_cutoff`, `set_points_start_date` and losing `update_promotion_rule`):
  - `RunPanel.test.tsx`: `simulates, shows the line and the lists, and finalises only after a confirmation that names the consequences`; `keeps the typed values on Modifică valorile`; `is disabled until Prag minim is set, and for Voluntar Activ until Data limită de intrare is set`; `places a server refusal under its field` (`invalid_eligibility_floor` → Prag minim).
  - `SettingsPanel.test.tsx`: `edits each setting on Salvează and logs it` (five rows), `shows a refusal under the row's field`.
  - `SignalsPanel.test.tsx`: `lists the open Retention Signals with their reason and a link to Roluri`, `says so when none is open`.
  - `HistoryPanel.test.tsx`: `lists runs newest first with their values, and opens the ranking of a run`, `explains a pre-R58 run has no ranking`.
  - `CandidatesPanel.test.tsx`, `ChangeLogPanel.test.tsx`: the surviving assertions of the old file (:1143-1348, :598-724) moved over.
  - `PortofoliuInterneScreen.test.tsx`: `shows Run and Setări before the first run, and the lists once something exists`, `calls none of the retired commands` (adds `update_promotion_rule`, the four-argument `run_role_evaluation`, the three-argument `role_evaluation_ranking`).
  - `App.test.tsx`: the mock path and heading become `PortofoliuInterneScreen` / `Portofoliu Interne tab`; the route test asserts `/administrare/portofoliu-interne`, and that `/administrare/evaluari` **and** `/administrare/perioade` both land there (Review Focus 5); the two `it.each` rows updated.
  - `AdministrareLayout.test.tsx`, `AppShell.test.tsx`, `auth-destination.test.ts`, `AdminSettingsTab.test.tsx`: the new label and path.

- [ ] **Step 2: Implement** per Interfaces and Layout. Prefer `DatePicker` with `max={today}` for the three date fields, `Input type="number"` with a `%` suffix for the shares (the `PercentRow` pattern), `Input inputMode="numeric"` for Prag minim.

- [ ] **Step 3: Run green.** `npm --prefix app run test:run -- src/screens/administrare src/App.test.tsx src/components/shell src/lib`, then `npm --prefix app run typecheck && npm --prefix app run lint`.

- [ ] **Step 4: See it.** `preview_start`, sign in as the demo BC member, open Administrare → Portofoliu Interne: set Prag minim 10 and Data limită de intrare, simulate the Voluntar Activ kind over the demo data, open the ranking sheet, finalise, check the Candidates and Signals, the history row and the log; visit `/administrare/evaluari` and watch the redirect; check 375 px. Screenshots to `docs/pr-assets/r58-portofoliu-interne/` (1280 and 375, light and dark; the simulation card and the finalised page).

- [ ] **Step 5: Commit.** `git commit -am "feat: Portofoliu Interne replaces Evaluări de rol (R58)"`

### Task 13: Docs, gates, PR

**Files:** `CONTEXT.md` (already carries R58; verify nothing drifted), `docs/adr/0011-live-updates-broadcast.md:24` (`promotion_rules` out, `retention_signals` and `evaluation_settings` in), `docs/backend/seeding-staging.md:60-62` (the Role Evaluation delete order gains `retention_signals`; the daily promotion sentence goes), `docs/backend/legacy-task-import.md:44` (Administrare → Portofoliu Interne), `docs/backend/implementation-issues.md:29` (historical note: #49/#51/#52 retired by R58), `docs/backend/push.md` only if it names the cron list, `docs/superpowers/plans/2026-09-23-prod-readiness-grill.md:59-66` (R28/R30/R33/R35 rows: "amended by R58"), `CLAUDE.md` status line (built, PR numbers), `.superpowers/pr-body-portofoliu-interne.md`.

- [ ] **Step 1: Docs** as listed.
- [ ] **Step 2: Gates** (sequenced): `bash scripts/check-local-ci.sh db`; `npm --prefix app run typecheck && npm --prefix app run lint && npm --prefix app run format:check`; `npm --prefix app run test:run`; `npm run check:root`. Also `bash scripts/check-seed-rerunnable.sh` on its own, since this PR changes what it calls.
- [ ] **Step 3: Final review.** Dispatch a fresh-context reviewer (Opus, `feature-dev:code-reviewer`) with the spec, this plan's Review Focus, and `git diff main...HEAD`. Critical and Important findings get a failing test, then the fix, then the suite again; minor ones go in the PR body.
- [ ] **Step 4: PR.** `git push -u origin feat/portofoliu-interne`, `gh pr create --title "Portofoliu Interne: one ranking of the eligible, Simulation, stored Retention Signals, no calendar promotion (R58, part 3)" --body-file .superpowers/pr-body-portofoliu-interne.md`, `@coderabbitai review`. Merge after Alex's go-ahead; then docs-only on `main`: the CLAUDE.md status line says built.
- [ ] **Step 5: After staging.** Remind Alex (in the PR body's checklist) that production needs, in this order, by hand on Portofoliu Interne: Prag minim, Data limită de intrare, Data de început a punctajului, then the university backfill script (R58 §Later) before the first Adunarea Generală run.

---

## Not in this plan (R58 §Later)

- The university backfill script (`scripts/import-universities.mjs` over a sheet of Members, through the service role), needing PR 1.
- A voter created directly by `provision_profile` / the volunteer import without UBB; closed when that import carries the university.
- A list of Recruți above the line; a multi-select in Roluri for promoting a cohort.
