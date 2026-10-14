# Minimum Role on Events and public Tasks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anything reaching all of OSUBB can require a minimum Role: an Event offers every Role (PR 1), and a public Task gets its own Minimum Level (PR 2).

**Architecture:** PR 1 widens `events_min_level_ck` and the two Event commands' ladder checks, and the app's Event ladder. PR 2 adds `tasks.min_level`, gated in the Task read rule (`private.can_read_task` and #1064's `tasks_read` sets), the join command, and the create, duplicate and edit commands (edit through the shared consequence definition). The leadership list rows carry it, and the app shows it as **Cine îl vede**.

**Tech Stack:** Supabase Postgres (plpgsql/sql, pgTAP), React + TypeScript (vitest, zod), the local Docker stack.

**Spec:** `docs/superpowers/specs/2026-10-14-minimum-role-filter-design.md` (ruling R57)

## Global Constraints

- **Ladder.** 0 Recrut, 1 Voluntar, 2 Voluntar Activ, 3 Voluntar cu Drept de Vot, 5 BCE, 6 BC. 9 (Moderator) is never offered and 4 is retired. The SQL set is `(0, 1, 2, 3, 5, 6)`. The app takes `GROUP_MINIMUM_LEVELS` / `minimumLevelOptions` from `app/src/lib/minimum-level.ts`.
- **Migrations.**
  - Created with `npx supabase migration new <name>`; each must sort after the newest file on `main` at the time.
  - Each `create or replace` body is restated from `main`'s latest definition (`pg_get_functiondef` on a stack reset to `main`), changed only by the exact swaps below.
  - `create or replace` keeps a function's comment and grants. A function dropped and recreated (a new signature) gets both restated.
- **Database safety.** Local stack only, never the production project. Database gates (`db reset`, `supabase test db`, `check-local-ci.sh db`, `check:root`) never run at the same time as the full vitest.
- **Copy.**
  - The field is labelled `Cine îl vede`; the details fact reads `De la {Rol}`; the change label in notices is `cine îl vede`.
  - Reasons:
    - `invalid_task_min_level`: `Alege cine vede taskul dintre rolurile din listă.`
    - `task_min_level_above_actor`: `Nu poți alege un rol peste al tău.`
    - `task_level_forbidden`: `Taskul e doar pentru un rol mai mare decât al tău.` The spec's `{Rol}` already shows beside it as the **Cine îl vede** fact, since the interest error layer has no Task.
  - The removed Executor hears `Nu mai ești executorul acestui task: e acum doar pentru {Rol} și peste.`, with `{Rol}` taken from `public.roles.name`.
- **Order.** PR 2 starts only after #1064 (`feat/member-reads`) is merged. If #1064's later parts (`task_list` `mine` / `available`) merged first, Task 6 restates their versions.
- **Shipping.**
  - One branch and one PR per part; the body carries the spec link and `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
  - A review (`@coderabbitai review`; when its quota means a long wait, a fresh-context reviewer instead, with the notes posted on the PR), then merge on green CI with `gh pr merge --merge --delete-branch`, then check the staging push with `gh run list --commit <merge sha>`.
  - Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An older app.** An installed app that edits a Task without `p_min_level` keeps the stored Role. Pinned in Task 5 (`null keeps`).
2. **Public to Direct.** A public Task with a Role, switched to Direct, stores 0 and never trips `tasks_min_level_public_ck`. Pinned in Task 5.
3. **A Subtask through its Umbrella.** A Subtask above the reader's Role stays hidden when its Umbrella is read through Shared Work Visibility, in both `can_read_task` and `tasks_read`. Pinned in Task 3.
4. **Editing from a leadership list.** A Task opened from a leadership list prefills its real Role and never sends 0 by accident. Pinned in Task 6 (the row carries `min_level`) and Task 7 (the edit control sends `null` when the row has none).
5. **Move and raise in one edit.** Moving a Task while raising its Role gives each person one consequence, never `executor_added_to_group` plus `executor_removed`. Pinned in Task 5.

---

## Tooling used by every restate step

`$S` below is the session scratchpad: `C:\Users\alexb\AppData\Local\Temp\claude\C--Users-alexb-dev-osubb-app\c246d5ab-8a80-4451-ab73-fd2d8b513f7c\scratchpad\r57` (create it). Dumps come from a stack reset to `main`:

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

---

# PR 1 — an Event offers every Role (branch `feat/event-min-roles`)

### Task 1: The Event ladder in the database

**Files:**

- Create: `supabase/migrations/<ts>_event_min_roles.sql`
- Create: `supabase/tests/event_min_roles.test.sql`
- Modify: `supabase/tests/event_constraints.test.sql:72-76`

**Interfaces:**

- Consumes: `private.create_event_impl` (main: `20261014160759_reminders.sql`), `private.update_event_impl` (main: `20261014153142_edit_notices.sql`), `private.can_read_event`.
- Produces: `events_min_level_ck check (min_level in (0, 1, 2, 3, 5, 6))`; both commands accept the same set.

- [ ] **Step 1: Branch.** `git checkout main && git pull --ff-only && git checkout -b feat/event-min-roles`

- [ ] **Step 2: Write the failing suite** `supabase/tests/event_min_roles.test.sql`:

```sql
-- R57 (Alex, 2026-10-14): an Event's Cine îl vede offers every Role on the
-- ladder, Voluntar and Voluntar Activ included. Spec
-- docs/superpowers/specs/2026-10-14-minimum-role-filter-design.md.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(12);

create function pg_temp.u57(n integer) returns uuid language sql immutable as $$
  select ('57000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users(id, email)
select pg_temp.u57(n), 'roles.' || n || '.57@test.local' from generate_series(1, 4) n;
insert into profiles(id, full_name, email, role, status)
select pg_temp.u57(n), 'Roles #57 ' || n, 'roles.' || n || '.57@test.local',
       (case n when 1 then 'recrut' when 2 then 'voluntar' else 'activ' end)::member_role,
       'activ'::member_status
  from generate_series(1, 4) n;
insert into groups(name, category, min_level) values ('Roles #57', 'team', 0);
insert into group_members(group_id, member_id, group_role)
select grp.id, pg_temp.u57(roster.n), roster.role
  from (values (4, 'manager'), (1, 'member'), (2, 'member'), (3, 'member')) as roster(n, role)
 cross join groups as grp
 where grp.name = 'Roles #57';

-- Created by the Group's Manager, a Voluntar Activ (level 2).
select pg_temp.test_login_leadership(pg_temp.u57(4));
select lives_ok($$select public.create_event('Voluntar #57', 'sedinta',
  (select id from groups where name = 'Roles #57'), '2030-11-20 18:00+02',
  null, null, null, null, 1)$$, 'an Event can be for Voluntar and up');
select lives_ok($$select public.create_event('Activ #57', 'sedinta',
  (select id from groups where name = 'Roles #57'), '2030-11-21 18:00+02',
  null, null, null, null, 2)$$, 'an Event can be for Voluntar Activ and up');
reset role;
select is((select min_level from events where title = 'Voluntar #57'), 1, 'stored at Voluntar');
select is((select count(*)::int from notifications
            where member_id = pg_temp.u57(1) and title = 'Eveniment nou: Voluntar #57'), 0,
  'a Recrut of the Group is not told of a Voluntar Event');
select is((select count(*)::int from notifications
            where member_id = pg_temp.u57(2) and title = 'Eveniment nou: Voluntar #57'), 1,
  'a Voluntar of the Group is told of it');

select pg_temp.test_login_leadership(pg_temp.u57(1));
select is((select count(*)::int from events where title = 'Voluntar #57'), 0, 'a Recrut does not read it');
select pg_temp.test_login_leadership(pg_temp.u57(2));
select is((select count(*)::int from events where title = 'Voluntar #57'), 1, 'a Voluntar reads it');
select is((select count(*)::int from events where title = 'Activ #57'), 0, 'a Voluntar does not read a Voluntar Activ Event');
select pg_temp.test_login_leadership(pg_temp.u57(3));
select is((select count(*)::int from events where title = 'Activ #57'), 1, 'a Voluntar Activ reads it');

select pg_temp.test_login_leadership(pg_temp.u57(4));
select lives_ok($$select public.update_event((select id from events where title = 'Activ #57'),
  'Activ #57', 'sedinta', (select id from groups where name = 'Roles #57'), '2030-11-21 18:00+02',
  null, null, null, null, 1, null)$$, 'an edit can lower it to Voluntar');
reset role;
select is((select min_level from events where title = 'Activ #57'), 1, 'stored at Voluntar after the edit');
select pg_temp.test_login_leadership(pg_temp.u57(2));
select is((select count(*)::int from events where title = 'Activ #57'), 1, 'the Voluntar now reads it');
reset role;

select * from finish();
rollback;
```

- [ ] **Step 3: Run it to watch it fail.**
      `npx supabase test db supabase/tests/event_min_roles.test.sql`
      Expected: FAIL — `invalid_event_min_level` on the first two `lives_ok`.

- [ ] **Step 4: Dump and write the swaps.** `dump 'private.create_event_impl(text,text,bigint,timestamptz,timestamptz,text,integer,text,integer,bigint,boolean)' create_event_impl` and `dump 'private.update_event_impl(bigint,text,text,bigint,timestamptz,timestamptz,text,integer,text,integer,bigint)' update_event_impl`.

`$S/create_event.swaps`:

```perl
(q{  if p_min_level is null or p_min_level not in (0,3,5,6) then},
 q{  -- R57: every Role on the ladder.
  if p_min_level is null or p_min_level not in (0, 1, 2, 3, 5, 6) then})
```

`$S/update_event.swaps`:

```perl
(q{  if p_min_level is null or p_min_level not in (0, 3, 5, 6) then},
 q{  -- R57: every Role on the ladder.
  if p_min_level is null or p_min_level not in (0, 1, 2, 3, 5, 6) then})
```

- [ ] **Step 5: Write the migration.** Run `npx supabase migration new event_min_roles` and confirm that it sorts last. Its content, in order:

```sql
-- R57 (Alex, 2026-10-14; spec docs/superpowers/specs/2026-10-14-minimum-role-filter-design.md):
-- an Event's Cine îl vede offers every Role on the ladder. events_min_level_ck
-- admitted only the pre-ADR-0009 levels {0, 3, 5, 6}, so "at least Voluntar"
-- could not be chosen. private.can_read_event already compares
-- level >= min_level, so readers, notices, RSVP and reminders follow unchanged.
alter table public.events drop constraint events_min_level_ck;
alter table public.events
  add constraint events_min_level_ck check (min_level in (0, 1, 2, 3, 5, 6));
comment on column public.events.min_level is
  'ADR-0008 Minimum Level, amended by R57: the lowest Role that reads the Event -- 0 Recrut, 1 Voluntar, 2 Voluntar Activ, 3 Voluntar cu Drept de Vot, 5 BCE, 6 BC; never below its Group''s Minimum Level nor above its writer''s Level.';
```

Then append `perl $S/swap.pl $S/create_event_impl.sql $S/create_event.swaps`, then the same for `update_event_impl`.

- [ ] **Step 6: Fix the old constraint case.** In `supabase/tests/event_constraints.test.sql`, the insert at `min_level` 2 now passes. Change `2)` to `4)` in that statement, and the description to `'min_level rejects the retired level 4'`.

- [ ] **Step 7: Run green.** `npx supabase db reset` then `npx supabase test db supabase/tests/event_min_roles.test.sql supabase/tests/event_constraints.test.sql supabase/tests/create_event.test.sql supabase/tests/update_event.test.sql`
      Expected: all pass (the 12 new ones included).

- [ ] **Step 8: Commit.** `git add supabase/migrations/*_event_min_roles.sql supabase/tests/event_min_roles.test.sql supabase/tests/event_constraints.test.sql && git commit -m "feat: an Event can be for any Role on the ladder (R57)"`

### Task 2: The Event ladder in the app, docs, PR

**Files:**

- Modify: `app/src/lib/minimum-level.ts:25-26`, `app/src/lib/minimum-level.test.ts:51-56`, `app/src/screens/calendar/event-form-model.test.ts`, `app/src/screens/calendar/event-form-model.ts:91-92` (doc comment)
- Modify: `docs/adr/0008-calendar-visibility.md` (header and §Visibility table), `CONTEXT.md` (**Minimum Level** entry)

- [ ] **Step 1: Failing tests.** In `minimum-level.test.ts`, the Event case becomes:

```ts
it("offers every rung for an Event, same order (R57)", () => {
  expect(EVENT_MINIMUM_LEVELS).toEqual([0, 1, 2, 3, 5, 6]);
  expect(
    minimumLevelOptions(EVENT_MINIMUM_LEVELS).map((option) => option.label),
  ).toEqual([
    "Recrut",
    "Voluntar",
    "Voluntar Activ",
    "Voluntar cu Drept de Vot",
    "BCE",
    "BC",
  ]);
});
```

In `event-form-model.test.ts`, the expectations become `minimumLevelChoices(0, 9)` values `[0, 1, 2, 3, 5, 6]`. The labels case lists all six. `minimumLevelChoices(1, 6)` labels are `['Voluntar', 'Voluntar Activ', 'Voluntar cu Drept de Vot', 'BCE', 'BC']`, and `minimumLevelChoices(3, 5)` stays `[3, 5]`. Run `npm --prefix app run test:run -- src/lib/minimum-level.test.ts src/screens/calendar/event-form-model.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement.** In `minimum-level.ts`:

```ts
/** An Event's Minimum Level: the whole ladder since R57 (`events_min_level_ck`). */
export const EVENT_MINIMUM_LEVELS: readonly number[] = GROUP_MINIMUM_LEVELS;
```

Update the `event-form-model.ts` doc comment ("the ladder rungs `events_min_level_ck` accepts" stays true). Then `grep -rn "Voluntar cu Drept de Vot" app/src/screens/calendar --include=*.test.tsx` and update any EventForm option expectations it finds.

- [ ] **Step 3: Run green.** Run the same two files and the calendar folder: `npm --prefix app run test:run -- src/lib src/screens/calendar`. Expected: PASS.

- [ ] **Step 4: Docs.**
  - **ADR-0008.** Add the header line `- **Amended:** 2026-10-14 — ruling R57: an Event's Minimum Level may be any Role on the ladder (Voluntar and Voluntar Activ added); the Event's Announcement copies it`. In §Visibility, the table gains rows `Voluntar+ | 1` and `Voluntar Activ+ | 2`. The sentence under it reads: ``"Responsible+" (level 4) stays retired; since R57 `events_min_level_ck` admits `{0, 1, 2, 3, 5, 6}`.``
  - **CONTEXT.md.** The **Minimum Level** entry's Event clause reads "an Event may raise it to any Role but never lower it".
  - **Rulings.** Add row R57 to `docs/superpowers/plans/2026-09-23-prod-readiness-grill.md` after R53: _A minimum Role on whatever reaches all of OSUBB (2026-10-14)._ Alex: "add a filter of role for every create that has the whole osubb as scope". He chose every public Task, hidden below the Role, Deals unchanged; Events get the whole ladder (PR 1) and Tasks their own Minimum Level (PR 2). Spec `docs/superpowers/specs/2026-10-14-minimum-role-filter-design.md`.

- [ ] **Step 5: Gates** (sequenced):
      `npm --prefix app run typecheck && npm --prefix app run lint && npm --prefix app run format:check`, then `npm --prefix app run test:run` (full), then `bash scripts/check-local-ci.sh db`, then `npm run check:root`. Expected: all green. Fix anything red before going on.

- [ ] **Step 6: Commit, push, PR.** `git commit -am "docs: R57 for the Event ladder" && git push -u origin feat/event-min-roles`. Then `gh pr create --title "An Event can be for any Role (R57, part 1)" --body-file .superpowers/pr-body-event-min-roles.md`. The body names the spec, the migration, the tests and the gates. Then `gh pr comment <n> --body "@coderabbitai review"`.

- [ ] **Step 7: Review and merge.** Apply real findings. If CodeRabbit's quota reply means a long wait, dispatch a fresh reviewer (Opus) on `git diff main...HEAD` and post its notes on the PR. On green CI for the head SHA: `gh pr merge <n> --merge --delete-branch`, then check `gh run list --commit <merge sha>` until "Push migrations to staging" succeeds.

---

# PR 2 — a public Task's Minimum Level (branch `feat/task-min-level`)

**Precondition:** #1064 is merged (`gh pr view 1064 --json state` says `MERGED`). Then `git checkout main && git pull --ff-only && npx supabase db reset && git checkout -b feat/task-min-level` and run `npx supabase migration new task_min_level`. Every SQL step below appends to that one migration, in task order. Re-dump every function from the reset stack and do not reuse PR 1's dumps: #1064 or another merge may have changed them.

### Task 3: The column and the read rule

**Files:**

- Modify: `supabase/migrations/<ts>_task_min_level.sql` (sections 1–3)
- Create: `supabase/tests/task_min_level.test.sql` (the read part)
- Modify: `supabase/tests/task_read_sets.test.sql` (the `'whole'` set contents move R4 Groups to `'shared'`; parity cases stay)

**Interfaces:**

- Consumes: #1064's `private.task_read_groups(text)`, `private.own_task_ids()` and the `tasks_read` expression; `private.caller_level()` (`coalesce(private.actor_level(), -1)`).
- Produces:
  - `tasks.min_level integer not null default 0`;
  - `private.task_read_groups('shared')`, with R4 moved out of `'whole'`;
  - `private.can_read_task` and `tasks_read` gate R4, R6-own and R6-org on `target.min_level`;
  - `private.has_open_org_opportunity` counts only rungs at or below `private.caller_level()`.

- [ ] **Step 1: Write the failing read cases** in `supabase/tests/task_min_level.test.sql`. Tasks 4 and 5 append more, so the plan count is final only at Task 5.

```sql
-- R57 (Alex, 2026-10-14): a public Task's Minimum Level -- the lowest Level
-- that sees it as an Opportunity or through Shared Work Visibility and may join
-- its Candidate Queue. Spec docs/superpowers/specs/2026-10-14-minimum-role-filter-design.md.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(51);

create function pg_temp.m(n integer) returns uuid language sql immutable as $$
  select ('57100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
-- 1 recrut, 2 voluntar, 3 activ, 4 bc, 5 activ (Manager), 6 recrut (Responsible),
-- 7 voluntar and 8 recrut (Shared Work Visibility), 9 recrut (nothing to do with it).
insert into auth.users(id, email)
select pg_temp.m(n), 'level.' || n || '.57@test.local' from generate_series(1, 9) n;
insert into profiles(id, full_name, email, role, status)
select pg_temp.m(n), 'Level #57 ' || n, 'level.' || n || '.57@test.local',
       (case n when 1 then 'recrut' when 2 then 'voluntar' when 3 then 'activ' when 4 then 'bc'
               when 5 then 'activ' when 6 then 'recrut' when 7 then 'voluntar' else 'recrut' end)::member_role,
       'activ'::member_status
  from generate_series(1, 9) n;
insert into groups(name, category, min_level, shared_work_visibility) values
  ('Min #57', 'team', 0, false), ('Shared #57', 'team', 0, true),
  ('Floor #57', 'team', 1, false), ('Card #57', 'team', 3, false);
insert into group_members(group_id, member_id, group_role)
select grp.id, pg_temp.m(roster.n), roster.role
  from (values ('Min #57', 5, 'manager'), ('Min #57', 4, 'manager'), ('Min #57', 6, 'responsible'),
               ('Min #57', 1, 'member'), ('Min #57', 2, 'member'), ('Min #57', 3, 'member'),
               ('Shared #57', 5, 'manager'), ('Shared #57', 7, 'member'), ('Shared #57', 8, 'member'),
               ('Floor #57', 5, 'manager'), ('Floor #57', 2, 'member'), ('Floor #57', 3, 'member'),
               ('Card #57', 5, 'manager')) as roster(grp, n, role)
  join groups as grp on grp.name = roster.grp;
create function pg_temp.g(p_name text) returns bigint language sql stable as $$
  select id from public.groups where name = p_name
$$;
create function pg_temp.t(p_title text) returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.tasks where title = p_title
$$;
create function pg_temp.reads(p_member integer, p_title text) returns integer language plpgsql as $$
declare v_count integer;
begin
  perform pg_temp.test_login_leadership(pg_temp.m(p_member));
  select count(*)::int into v_count from public.tasks where title = p_title;
  perform set_config('role', 'postgres', true);
  perform pg_temp.test_clear_jwt();
  return v_count;
end;
$$;

insert into tasks (title, group_id, deadline, status, kind, audience, assignment_mode, queue_opened_at, min_level) values
  ('Org V #57',    pg_temp.g('Min #57'),    '2030-11-20 18:00+02', 'todo', 'task', 'org',   'public', now(), 1),
  ('Org R #57',    pg_temp.g('Min #57'),    '2030-11-20 18:00+02', 'todo', 'task', 'org',   'public', now(), 0),
  ('Local A #57',  pg_temp.g('Floor #57'),  '2030-11-20 18:00+02', 'todo', 'task', 'local', 'public', now(), 2),
  ('Card V #57',   pg_temp.g('Card #57'),   '2030-11-20 18:00+02', 'todo', 'task', 'org',   'public', now(), 1);
insert into tasks (title, group_id, deadline, status, kind, audience, assignment_mode, queue_opened_at, queue_closed_at, min_level)
values ('Shared V #57', pg_temp.g('Shared #57'), '2030-11-20 18:00+02', 'todo', 'task', 'local', 'public', now(), now(), 1);
insert into tasks (title, group_id, status, kind) values ('Umb #57', pg_temp.g('Shared #57'), 'todo', 'umbrella');
insert into tasks (title, group_id, parent_task_id, deadline, status, kind, audience, assignment_mode, queue_opened_at, queue_closed_at, min_level)
values ('Sub V #57', pg_temp.g('Shared #57'), pg_temp.t('Umb #57'), '2030-11-20 18:00+02', 'todo', 'task', 'local', 'public', now(), now(), 1);

-- ==================== Who reads ====================
select is(pg_temp.reads(2, 'Org V #57'), 1, 'an org-wide Opportunity at Voluntar reaches a Voluntar');
select is(pg_temp.reads(1, 'Org V #57'), 0, '... and not a Recrut');
select is(pg_temp.reads(1, 'Org R #57'), 1, 'at Recrut it still reaches everyone (R26 kept)');
select is(pg_temp.reads(2, 'Local A #57'), 0, 'a local one at Voluntar Activ is hidden from a Voluntar member');
select is(pg_temp.reads(3, 'Local A #57'), 1, '... and read by a Voluntar Activ member');
select is(pg_temp.reads(7, 'Shared V #57'), 1, 'Shared Work Visibility shows it at the Role');
select is(pg_temp.reads(8, 'Shared V #57'), 0, '... and hides it below the Role');
select is(pg_temp.reads(8, 'Umb #57'), 1, 'the Umbrella is read through Shared Work Visibility');
select is(pg_temp.reads(8, 'Sub V #57'), 0, 'its Subtask above the Role stays hidden (judged on the Task itself)');
select is(pg_temp.reads(7, 'Sub V #57'), 1, '... and shows at the Role');
select is(pg_temp.reads(6, 'Org V #57'), 1, 'a Group Responsible below the Role still reads it (R3)');
select is(pg_temp.reads(4, 'Org V #57'), 1, 'BC reads it (R1)');
select pg_temp.test_login_leadership(pg_temp.m(8));
select is(private.can_read_task(pg_temp.t('Sub V #57')), false, 'can_read_task agrees: hidden below the Role');
select pg_temp.test_login_leadership(pg_temp.m(7));
select is(private.can_read_task(pg_temp.t('Sub V #57')), true, 'can_read_task agrees: read at the Role');
reset role;
select pg_temp.test_clear_jwt();
-- The Group card: Card #57 sits at level 3; its only org Opportunity at Voluntar.
select pg_temp.test_login_leadership(pg_temp.m(2));
select is((select count(*)::int from groups where name = 'Card #57'), 1, 'a Voluntar reads the Group of an Opportunity they may see');
select pg_temp.test_login_leadership(pg_temp.m(1));
select is((select count(*)::int from groups where name = 'Card #57'), 0, '... a Recrut does not');
reset role;
select pg_temp.test_clear_jwt();
-- A past Candidate keeps reading it (R2).
insert into task_candidates (task_id, member_id, status, joined_at, decided_at)
values (pg_temp.t('Org V #57'), pg_temp.m(1), 'withdrawn', now(), now());
select is(pg_temp.reads(1, 'Org V #57'), 1, 'a past Candidate below the Role still reads it');
select throws_ok($$insert into tasks (title, group_id, deadline, status, kind, audience, assignment_mode, min_level)
  values ('Direct #57', (select id from groups where name = 'Min #57'), '2030-11-20 18:00+02', 'todo', 'task', 'local', 'direct', 1)$$,
  '23514', null, 'a direct Task carries no Minimum Level (tasks_min_level_public_ck)');
```

Check `task_candidates`' columns and its `withdrawn` shape against its constraints when writing this: `\d public.task_candidates` on the stack. If the shape requires other columns, add them; that needs no ledger ruling.

Run: `npx supabase test db supabase/tests/task_min_level.test.sql`. Expected: FAIL (`column "min_level" of relation "tasks" does not exist`).

- [ ] **Step 2: Migration section 1, the column.**

```sql
-- R57 (Alex, 2026-10-14; spec docs/superpowers/specs/2026-10-14-minimum-role-filter-design.md):
-- a public Task's Minimum Level. Every existing Task gets 0, so nothing anyone
-- sees changes until a Role is chosen.

-- 1. The column.
alter table public.tasks
  add column min_level integer not null default 0,
  add constraint tasks_min_level_ck check (min_level in (0, 1, 2, 3, 5, 6)),
  add constraint tasks_min_level_public_ck
    check (min_level = 0 or (kind = 'task' and assignment_mode = 'public'));
comment on column public.tasks.min_level is
  'R57: the lowest Level that sees this public Task as an Opportunity or through Shared Work Visibility and may join its Candidate Queue -- 0 Recrut, 1 Voluntar, 2 Voluntar Activ, 3 Voluntar cu Drept de Vot, 5 BCE, 6 BC. Never widens the Audience. 0 for a direct Task and an Umbrella. Written only by the Task commands.';
```

- [ ] **Step 3: Section 2, `can_read_task`.** `dump 'private.can_read_task(bigint)' can_read_task`. Swaps (`$S/can_read_task.swaps`). Confirm each `old` against the dump; the assembler dies on a mismatch.

```perl
(q{                    and task.status not in ('completed', 'unfulfilled', 'cancelled'))
                or (},
 q{                    and task.status not in ('completed', 'unfulfilled', 'cancelled')
                    and caller_role.level >= target.min_level)
                or (},
 q{                    or exists (select 1 from public.groups as shared},
 q{                    or (caller_role.level >= target.min_level and exists (select 1 from public.groups as shared},
 q{                                       or (shared.automatic_membership and caller_role.level >= shared.min_level)))},
 q{                                       or (shared.automatic_membership and caller_role.level >= shared.min_level))))},
 q{                        and private.is_group_member(grp.id, caller.id))},
 q{                        and private.is_group_member(grp.id, caller.id)
                        and caller_role.level >= target.min_level)})
```

Then restate the comment:

```sql
comment on function private.can_read_task(bigint) is
  'ADR-0007 as amended 2026-09-25 (ruling R26, #794) and 2026-10-14 (ruling R57) on ADR-0009 R1-R7: own Assignments and Candidatures (ever); then, for a Group the caller can see (private.can_see_group): BCE/BC/Moderator; every open organization-wide Opportunity (Audience org, public, queue open, not terminal) for every active Member at or above the Task''s own Minimum Level, whatever the Group''s; and, subject to the Group''s Minimum Level unless the caller holds a Group Role on the path: Group Managers and Responsibles on the path, Shared Work Visibility and the open Opportunities of a Group the caller is a member of (private.is_group_member), any Audience -- these two also at or above the Task''s Minimum Level. The Task''s Minimum Level is judged on the Task itself, also when it is read through its Umbrella. A local Opportunity of a Group the caller is not in is invisible. Direct Tasks, Umbrellas, closed queues and terminal Tasks stay hidden from non-participants whatever their Audience.';
```

- [ ] **Step 4: Section 3, the sets, the policy and the Group card.** `dump 'private.task_read_groups(text)' task_read_groups`. Swaps against #1064's text. The `when 'whole'` branch keeps R1 and R3, and a new `'shared'` branch holds R4:

```perl
(q{           when 'whole' then judged.global_reader
                             or ((judged.at_level or judged.role_on_path)
                                 and (judged.role_on_path or judged.shared_on_path))},
 q{           when 'whole' then judged.global_reader or judged.role_on_path
           -- R4 Shared Work Visibility on the path, at the Minimum Level unless
           -- a Group Role is held; tasks_read adds the Task's own Minimum
           -- Level (R57), which never gates R1 or R3.
           when 'shared' then (judged.at_level or judged.role_on_path) and judged.shared_on_path})
```

Restate its comment so it names `'shared'` and R57. Then the policy:

```sql
alter policy tasks_read on public.tasks
  using (
    (select public.auth_is_member())
    and (   id = any ((select private.own_task_ids())::bigint[])
         or parent_task_id = any ((select private.own_task_ids())::bigint[])
         or group_id = any ((select private.task_read_groups('whole'))::bigint[])
         or (    min_level <= (select private.caller_level())
             and (   group_id = any ((select private.task_read_groups('shared'))::bigint[])
                  or (    kind = 'task'
                      and assignment_mode = 'public'
                      and queue_closed_at is null
                      and status not in ('completed', 'unfulfilled', 'cancelled')
                      and (   group_id = any ((select private.task_read_groups('open'))::bigint[])
                           or (    audience = 'org'
                               and group_id = any ((select private.task_read_groups('org'))::bigint[]))))))));
comment on policy tasks_read on public.tasks is
  'The Task read rule (private.can_read_task) decided once per statement: R2/R7 through private.own_task_ids(), R1/R3 through task_read_groups(''whole''), and -- at or above the Task''s own Minimum Level (R57) -- R4 through ''shared'', R6-own and R6-org through ''open'' and ''org'' on an open public Opportunity. supabase/tests/task_read_sets.test.sql holds it to private.can_read_task for every caller.';
```

If #1064's merged policy differs from the text quoted in the spec, rebuild it from the merged text with the same split and record a ledger ruling. Then `dump 'private.has_open_org_opportunity(bigint)' has_open_org_opportunity` with one swap:

```perl
(q{       and task.status not in ('completed', 'unfulfilled', 'cancelled')
  );},
 q{       and task.status not in ('completed', 'unfulfilled', 'cancelled')
       -- R57: only an Opportunity the caller may see names its Group.
       and task.min_level <= private.caller_level()
  );})
```

Its comment: replace "with no Minimum Level gate" with "at or above the Task's own Minimum Level (R57)".

- [ ] **Step 5: `task_read_sets.test.sql`.** Find its set-content assertions (`grep -n "'whole'" supabase/tests/task_read_sets.test.sql`). Every Group expected in `'whole'` only through R4 moves to a new `'shared'` expectation, so the plan count grows by the number of new assertions. Add its fixtures' `min_level` above 0 on two public Tasks: one reached through R4 and one through R6-org. The parity cases then cover the new row test.

- [ ] **Step 6: Run green.** `npx supabase db reset && npx supabase test db supabase/tests/task_min_level.test.sql supabase/tests/task_read_sets.test.sql`. Expected: the read cases pass; the plan count fails until Task 5, which is expected.

- [ ] **Step 7: Mutation check.** Revert each of the three `can_read_task` swaps in turn, and the policy's `min_level <=` line, on the local stack (`create or replace` in psql inside `begin … rollback` with the suite run in between, or edit → reset → run). Confirm the named assertion fails each time; record which one in the PR body.

- [ ] **Step 8: Commit.** `git add -A supabase && git commit -m "feat: a public Task's Minimum Level gates who reads it (R57)"`

### Task 4: Create, duplicate, join

**Files:**

- Modify: the migration (sections 4–6)
- Modify: `supabase/tests/task_min_level.test.sql` (append)
- Modify: `supabase/tests/create_task.test.sql:228` (the 14-arg regprocedure), `supabase/tests/tracker_grants.test.sql` (rows `create_task`, `create_tasks`, `create_task_impl`, `create_tasks_impl`: append `, p_min_level integer`), `supabase/tests/origin_drop_upgrade.test.sh:39-45` (drop the 14-arg signatures; extend the comment: "R57 then added p_min_level.")

**Interfaces:**

- Produces:
  - `public.create_task(…, p_links jsonb default '[]', p_min_level integer default 0) returns tasks`;
  - `public.create_tasks(…, p_copies integer default 1, p_min_level integer default 0) returns setof tasks`;
  - private impls with the same new last parameter;
  - `express_task_interest` refuses `42501 task_level_forbidden`.

- [ ] **Step 1: Append the failing cases:**

```sql
-- ==================== Joining ====================
select pg_temp.test_login_leadership(pg_temp.m(6));
select throws_ok($$select public.express_task_interest((select id from tasks where title = 'Org V #57'))$$,
  '42501', 'task_level_forbidden', 'a reader below the Role cannot join');
select pg_temp.test_login_leadership(pg_temp.m(9));
select throws_ok($$select public.express_task_interest(pg_temp.t('Org V #57'))$$,
  'PT404', 'task_not_found', 'anyone else does not even see it');
select pg_temp.test_login_leadership(pg_temp.m(2));
select lives_ok($$select public.express_task_interest((select id from tasks where title = 'Org V #57'))$$,
  'a Voluntar joins it');

-- ==================== Creating ====================
select pg_temp.test_login_leadership(pg_temp.m(5));
select lives_ok($$select public.create_task(p_title := 'Made A #57', p_description := null,
  p_deadline := '2030-11-20 18:00+02', p_audience := 'org', p_assignment_mode := 'public',
  p_group_id := (select id from groups where name = 'Min #57'), p_min_level := 2)$$,
  'a Manager makes a Task for Voluntar Activ and up');
select throws_ok($$select public.create_task(p_title := 'Too high #57', p_description := null,
  p_deadline := '2030-11-20 18:00+02', p_audience := 'org', p_assignment_mode := 'public',
  p_group_id := (select id from groups where name = 'Min #57'), p_min_level := 3)$$,
  'PT400', 'task_min_level_above_actor', 'never above the creator''s own Level');
select throws_ok($$select public.create_task(p_title := 'Off #57', p_description := null,
  p_deadline := '2030-11-20 18:00+02', p_audience := 'org', p_assignment_mode := 'public',
  p_group_id := (select id from groups where name = 'Min #57'), p_min_level := 4)$$,
  'PT400', 'invalid_task_min_level', 'only the ladder');
select lives_ok($$select public.create_task(p_title := 'Made D #57', p_description := null,
  p_deadline := '2030-11-20 18:00+02', p_audience := 'local', p_assignment_mode := 'direct',
  p_group_id := (select id from groups where name = 'Min #57'), p_min_level := 2)$$,
  'a direct Task ignores the Role sent');
select lives_ok($$select public.create_task(p_title := 'Made U #57', p_description := null,
  p_deadline := null, p_audience := null, p_assignment_mode := null, p_kind := 'umbrella',
  p_group_id := (select id from groups where name = 'Min #57'), p_min_level := 2)$$,
  'so does an Umbrella');
select lives_ok($$select public.create_tasks(p_title := 'Copies #57', p_description := null,
  p_deadline := '2030-11-20 18:00+02', p_audience := 'org', p_assignment_mode := 'public',
  p_group_id := (select id from groups where name = 'Min #57'), p_copies := 3, p_min_level := 1)$$,
  'copies made in one go');
select lives_ok($$select public.duplicate_task((select id from tasks where title = 'Made A #57'), '2030-11-27 18:00+02')$$,
  'a duplicate');
reset role;
select pg_temp.test_clear_jwt();
select is((select min_level from tasks where title = 'Made A #57' and duplicated_from_task_id is null), 2, 'stored at Voluntar Activ');
select is((select min_level from tasks where title = 'Made D #57'), 0, 'the direct Task is stored at 0');
select is((select min_level from tasks where title = 'Made U #57'), 0, 'the Umbrella is stored at 0');
select is((select array_agg(min_level order by id) from tasks where title = 'Copies #57'), array[1, 1, 1], 'every copy carries it');
select is((select min_level from tasks where duplicated_from_task_id = pg_temp.t('Made A #57')), 2, 'the duplicate copies it');
```

Run it. Expected: FAIL (`function public.create_task(… p_min_level …) does not exist`).

- [ ] **Step 2: Section 4, create.** Dump `private.create_task_impl(text,text,timestamptz,text,text,uuid,bigint,bigint,text,bigint,text,text,jsonb)`, `private.create_tasks_impl(text,text,timestamptz,text,text,uuid[],bigint,bigint,text,bigint,jsonb,integer)` and both public wrappers. Save each function's comment: `select obj_description('<sig>'::regprocedure)`. The section:

```sql
-- 4. Creating: the Role travels with every copy; a direct Task or an Umbrella is stored at 0.
drop function public.create_tasks(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer);
drop function private.create_tasks_impl(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer);
drop function public.create_task(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb);
drop function private.create_task_impl(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb);
```

Then each function recreated from its dump with `create function` (not `or replace`; the `swap.pl` prefix line is changed by hand) and these swaps.

`create_task_impl`:

```perl
(q{p_link_url text, p_links jsonb)
 RETURNS tasks},
 q{p_link_url text, p_links jsonb, p_min_level integer)
 RETURNS tasks},
 q{  v_constraint text;
begin},
 q{  v_constraint text;
  v_min_level integer;
begin},
 q{  if p_kind is null or p_kind not in ('task', 'umbrella') then
    raise sqlstate 'PT400' using message = 'invalid_task_kind';
  end if;},
 q{  if p_kind is null or p_kind not in ('task', 'umbrella') then
    raise sqlstate 'PT400' using message = 'invalid_task_kind';
  end if;
  -- R57: the ladder, malformed for every caller.
  if p_min_level is not null and p_min_level not in (0, 1, 2, 3, 5, 6) then
    raise sqlstate 'PT400' using message = 'invalid_task_min_level';
  end if;
  -- Only an ordinary public Task has a Candidate Queue to gate.
  v_min_level := case when p_kind = 'task' and p_assignment_mode = 'public'
                      then coalesce(p_min_level, 0) else 0 end;},
 q{  perform private.require_daily_cap('task_create', v_actor);},
 q{  -- R57: never above the creator's own Level (the Moderator's 9 sets any).
  if v_min_level > 0 and coalesce(private.actor_level(v_actor), -1) < 9
     and v_min_level > coalesce(private.actor_level(v_actor), -1) then
    raise sqlstate 'PT400' using message = 'task_min_level_above_actor';
  end if;
  perform private.require_daily_cap('task_create', v_actor);},
 q{status, created_by, queue_opened_at, links)},
 q{status, created_by, queue_opened_at, links, min_level)},
 q{            v_links)
    returning * into v_task;},
 q{            v_links, v_min_level)
    returning * into v_task;},
 q{                       'executor_id', p_executor_id));},
 q{                       'executor_id', p_executor_id, 'min_level', v_min_level));})
```

`create_tasks_impl`: the signature gains `, p_min_level integer` after `p_copies integer`. The loop call's `null, null, p_links);` becomes `null, null, p_links, p_min_level);`.

Public wrappers: the signature gains `, p_min_level integer default 0`, and the call passes `p_min_level` last.

Then restate the four comments, each the saved text plus ` R57 (2026-10-14): p_min_level, the Task''s Minimum Level (0 by default; stored only on an ordinary public Task; PT400 invalid_task_min_level off the ladder, task_min_level_above_actor above the actor''s Level).` Finally:

```sql
revoke execute on function private.create_task_impl(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb, integer) from public, anon;
revoke execute on function public.create_task(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb, integer) from public, anon;
revoke execute on function private.create_tasks_impl(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer, integer) from public, anon;
revoke execute on function public.create_tasks(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer, integer) from public, anon;
grant execute on function private.create_task_impl(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb, integer) to authenticated;
grant execute on function public.create_task(text, text, timestamptz, text, text, uuid, bigint, bigint, text, bigint, text, text, jsonb, integer) to authenticated;
grant execute on function private.create_tasks_impl(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer, integer) to authenticated;
grant execute on function public.create_tasks(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer, integer) to authenticated;
```

Before writing these lines, compare them with the grants in `20261007190000_attached_links_five.sql:1268+` and the `service_role` lines there, and mirror them exactly.

- [ ] **Step 3: Section 5, duplicate.** Dump `private.duplicate_task_impl(bigint,timestamptz)` (`create or replace`, same signature):

```perl
(q{    parent_task_id, queue_opened_at, duplicated_from_task_id,
    links)},
 q{    parent_task_id, queue_opened_at, duplicated_from_task_id,
    links, min_level)},
 q{    p_task_id,
    v_source.links)},
 q{    p_task_id,
    v_source.links,
    -- R57: the copy keeps its source's Role (0 unless it is public).
    case when v_source.assignment_mode = 'public' then v_source.min_level else 0 end)})
```

- [ ] **Step 4: Section 6, join.** Dump `private.express_task_interest_impl(bigint)` (`create or replace`):

```perl
(q{  -- 5. Input validation: the only parameter is the target itself, already},
 q{  -- R57: the Task's Minimum Level, judged on the live Level of the profile
  -- held FOR SHARE above. Whoever reads the Task anyway -- a Group Role on
  -- the path, a past Candidate -- hears why.
  if coalesce(private.actor_level(v_actor), -1) < v_task.min_level then
    raise exception using errcode = '42501', message = 'task_level_forbidden';
  end if;
  -- 5. Input validation: the only parameter is the target itself, already})
```

Restate its comment: replace "since #794 (ruling R26) every one, with no Minimum Level gate" with "since #794 (ruling R26) every one at or above the Task's Minimum Level (R57; 42501 task_level_forbidden below it)". Update `public.express_task_interest`'s comment the same way.

- [ ] **Step 5: The fixed references.** Update `create_task.test.sql:228`, the four `tracker_grants.test.sql` rows and `origin_drop_upgrade.test.sh:44-45` to the new signatures. Then `grep -rn "create_task(\|create_tasks(" supabase/tests | grep -i "regprocedure\|::regproc"` and fix any other hit.

- [ ] **Step 6: Run green.** `npx supabase db reset && npx supabase test db supabase/tests/task_min_level.test.sql supabase/tests/create_task.test.sql supabase/tests/create_tasks.test.sql supabase/tests/tracker_grants.test.sql supabase/tests/task_interest*.test.sql`, plus `bash supabase/tests/origin_drop_upgrade.test.sh`. Expected: all pass except the plan count of `task_min_level`.

- [ ] **Step 7: Commit.** `git commit -am "feat: Tasks are made, copied and joined with their Role (R57)"`

### Task 5: Editing and its consequences

**Files:**

- Modify: the migration (sections 7–8)
- Modify: `supabase/tests/task_min_level.test.sql` (append; final `plan(n)`)
- Modify: `supabase/tests/update_task.test.sql:218-220` (new regprocedures), `:599` (`= 8` → `= 9`, description "all nine changeable fields, the Role among them"), `supabase/tests/tracker_grants.test.sql` (rows `update_task`, `preview_task_update`, `update_task_impl`, `preview_task_update_impl`: append `, p_min_level integer`)

**Interfaces:**

- Produces:
  - `public.update_task(…, p_links jsonb default null, p_min_level integer default null)`;
  - `public.preview_task_update(…, p_links jsonb default null, p_min_level integer default null)`;
  - `private.plan_task_update(p_task tasks, …, p_links jsonb, p_min_level integer)`, which takes the resolved value;
  - `private.task_update_consequences(p_task_id, p_group_id, p_campaign_id, p_assignment_mode, p_audience, p_min_level integer)`;
  - `private.task_field_labels` maps `min_level` → `cine îl vede`.
- Resolved value, in both callers: `case when v_task.kind = 'task' and p_assignment_mode = 'public' then coalesce(p_min_level, v_task.min_level) else 0 end`.

- [ ] **Step 1: Append the failing cases:**

```sql
-- ==================== Editing ====================
create function pg_temp.edit(p_title text, p_min integer, p_accept boolean,
                             p_mode text default 'public', p_audience text default 'org',
                             p_group text default null, p_new_title text default null)
returns setof public.tasks language sql as $$
  select (public.update_task(p_task_id := task.id,
           p_group_id := coalesce((select id from public.groups where name = p_group), task.group_id),
           p_title := coalesce(p_new_title, task.title), p_description := task.description,
           p_deadline := task.deadline, p_campaign_id := task.campaign_id,
           p_assignment_mode := p_mode, p_audience := p_audience,
           p_accept_consequences := p_accept, p_links := task.links, p_min_level := p_min)).*
    from public.tasks as task where task.title = p_title
$$;
create function pg_temp.preview(p_title text, p_min integer, p_group text default null)
returns text[] language sql as $$
  select array_agg(c.consequence || ':' || c.member_id::text order by c.consequence, c.member_id::text)
    from public.tasks as task
   cross join lateral public.preview_task_update(p_task_id := task.id,
           p_group_id := coalesce((select id from public.groups where name = p_group), task.group_id),
           p_title := task.title, p_description := task.description, p_deadline := task.deadline,
           p_campaign_id := task.campaign_id, p_assignment_mode := task.assignment_mode,
           p_audience := task.audience, p_links := task.links, p_min_level := p_min) as c
   where task.title = p_title
$$;
insert into tasks (title, group_id, deadline, status, kind, audience, assignment_mode, queue_opened_at, min_level) values
  ('Edit #57', pg_temp.g('Min #57'), '2030-11-20 18:00+02', 'todo', 'task', 'org', 'public', now(), 0),
  ('High #57', pg_temp.g('Min #57'), '2030-11-20 18:00+02', 'todo', 'task', 'org', 'public', now(), 0),
  ('Move #57', pg_temp.g('Min #57'), '2030-11-20 18:00+02', 'todo', 'task', 'org', 'public', now(), 0);
-- The queue of Edit #57: a Recrut and a Voluntar Activ wait; a Voluntar executes.
select pg_temp.test_login_leadership(pg_temp.m(1));
select public.express_task_interest(pg_temp.t('Edit #57'));
select pg_temp.test_login_leadership(pg_temp.m(2));
select public.express_task_interest(pg_temp.t('Edit #57'));
select pg_temp.test_login_leadership(pg_temp.m(3));
select public.express_task_interest(pg_temp.t('Edit #57'));
select pg_temp.test_login_leadership(pg_temp.m(7));
select public.express_task_interest(pg_temp.t('Move #57'));
select pg_temp.test_login_leadership(pg_temp.m(5));
select public.select_task_candidate(pg_temp.t('Edit #57'),
  (select id from task_candidates where task_id = pg_temp.t('Edit #57') and member_id = pg_temp.m(2)), false);
select public.select_task_candidate(pg_temp.t('Move #57'),
  (select id from task_candidates where task_id = pg_temp.t('Move #57') and member_id = pg_temp.m(7)), false);

select is(pg_temp.preview('Edit #57', 2),
  array['candidate_removed:' || pg_temp.m(1), 'executor_removed:' || pg_temp.m(2)],
  'raising it removes the waiting Recrut and the Voluntar Executor, nobody at the Role');
select throws_ok($$select pg_temp.edit('Edit #57', 2, false)$$, 'PT409', 'task_update_needs_confirmation',
  'not without confirmation');
select lives_ok($$select pg_temp.edit('Edit #57', 2, true)$$, 'confirmed, it applies');
reset role;
select pg_temp.test_clear_jwt();
select is((select min_level from tasks where title = 'Edit #57'), 2, 'stored at Voluntar Activ');
select is((select status from task_candidates where task_id = pg_temp.t('Edit #57') and member_id = pg_temp.m(1)), 'closed',
  'the Recrut''s Candidature is closed');
select is((select count(*)::int from task_assignments where task_id = pg_temp.t('Edit #57')
            and member_id = pg_temp.m(2) and ended_at is null), 0, 'the Voluntar is no longer the Executor');
select is((select count(*)::int from notifications where member_id = pg_temp.m(2)
            and title = 'Task actualizat: Edit #57'
            and body = 'Nu mai ești executorul acestui task: e acum doar pentru Voluntar Activ și peste.'), 1,
  'the removed Executor is told why');
select is((select status from task_candidates where task_id = pg_temp.t('Edit #57') and member_id = pg_temp.m(3)), 'pending',
  'the Voluntar Activ still waits');

select pg_temp.test_login_leadership(pg_temp.m(5));
select is(pg_temp.preview('Edit #57', 0), null::text[], 'lowering it removes nobody');
select public.select_task_candidate(pg_temp.t('Edit #57'),
  (select id from task_candidates where task_id = pg_temp.t('Edit #57') and member_id = pg_temp.m(3)), false);
select lives_ok($$select pg_temp.edit('Edit #57', 1, false)$$, 'lowered to Voluntar, nothing to confirm');
select lives_ok($$select pg_temp.edit('Edit #57', null, false, p_new_title := 'Edit 2 #57')$$,
  'an edit that does not send the Role');
reset role;
select pg_temp.test_clear_jwt();
select is((select min_level from tasks where title = 'Edit 2 #57'), 1, 'null keeps it (an older app changes nothing)');
select is((select count(*)::int from notifications where member_id = pg_temp.m(3)
            and title = 'Task actualizat: Edit #57' and body = 'Modificat: cine îl vede.'), 1,
  'the Executor''s edit notice names the Role');

-- An unchanged Role above the editor's Level is never judged; a changed one is.
select pg_temp.test_login_leadership(pg_temp.m(4));
select lives_ok($$select pg_temp.edit('High #57', 6, false)$$, 'BC sets it to BC');
select pg_temp.test_login_leadership(pg_temp.m(5));
select lives_ok($$select pg_temp.edit('High #57', 6, false, p_new_title := 'High 2 #57')$$,
  'a Manager below it still edits the rest');
select throws_ok($$select pg_temp.edit('High 2 #57', 5, false)$$, 'PT400', 'task_min_level_above_actor',
  'but cannot choose another Role above their own');
select lives_ok($$select pg_temp.edit('High 2 #57', 6, false, p_mode := 'direct', p_audience := 'local')$$,
  'made Direct with the Role still sent');
reset role;
select pg_temp.test_clear_jwt();
select is((select min_level from tasks where title = 'High 2 #57'), 0, 'a direct Task is stored at 0');

-- Moving and raising at once: one consequence for the Executor.
select pg_temp.test_login_leadership(pg_temp.m(5));
select is(pg_temp.preview('Move #57', 2, 'Floor #57'), array['executor_removed:' || pg_temp.m(7)],
  'a Voluntar Executor moved into a Voluntar Group but below the new Role is only removed');
reset role;
select pg_temp.test_clear_jwt();
select is(private.task_field_labels(array['min_level']), 'cine îl vede', 'the change has a Romanian label');
```

After the last case, set `select plan(<n>)` to the real count. Run it. Expected: FAIL (`p_min_level` unknown).

- [ ] **Step 2: Section 7, the shared definitions.** Dump `private.plan_task_update(tasks,bigint,text,text,timestamptz,bigint,text,text,jsonb)` and `private.task_update_consequences(bigint,bigint,bigint,text,text)`, then drop both and recreate them with `create function` (comments restated plus an R57 sentence; neither is granted to anyone, so mirror `revoke … from public` exactly as `attached_links_five.sql` did).

`plan_task_update` swaps:

```perl
(q{p_audience text, p_links jsonb)
 RETURNS jsonb},
 q{p_audience text, p_links jsonb, p_min_level integer)
 RETURNS jsonb},
 q{  -- 6. State preconditions (PT409): umbrella shape, then the edit window.},
 q{  -- R57: p_min_level is the resolved value (the caller's step 4). A changed
  -- one is never above the actor's own Level; an unchanged one is not judged,
  -- so a Manager below a Role BC chose can still edit everything else.
  if p_min_level is distinct from p_task.min_level
     and coalesce(private.actor_level(), -1) < 9
     and p_min_level > coalesce(private.actor_level(), -1) then
    raise sqlstate 'PT400' using message = 'task_min_level_above_actor';
  end if;
  -- 6. State preconditions (PT409): umbrella shape, then the edit window.},
 q{  -- R46: the Attached Links, already normalized by the caller's step 1, are one},
 q{  if p_min_level is distinct from p_task.min_level then
    v_changed := array_append(v_changed, 'min_level');
    v_before := v_before || jsonb_build_object('min_level', p_task.min_level);
    v_after := v_after || jsonb_build_object('min_level', p_min_level);
  end if;
  -- R46: the Attached Links, already normalized by the caller's step 1, are one},
 q{    'campaign_id', v_campaign_id, 'links', p_links,},
 q{    'campaign_id', v_campaign_id, 'links', p_links, 'min_level', p_min_level,})
```

`task_update_consequences` swaps:

```perl
(q{p_assignment_mode text, p_audience text)},
 q{p_assignment_mode text, p_audience text, p_min_level integer)},
 q{           target.campaign_id, grp.min_level, grp.path},
 q{           target.campaign_id, grp.min_level, grp.path, target.min_level as task_min_level},
 q{  moving as (select * from task where group_id is distinct from p_group_id),},
 q{  moving as (select * from task where group_id is distinct from p_group_id),
  -- R57: a raised Minimum Level (p_min_level is the resolved value).
  raised as (select * from task where p_min_level > task.task_min_level),},
 q{        or (exists (select 1 from moving)
            and coalesce(private.actor_level(candidate.member_id), -1) < task.min_level)
  ),},
 q{        or (exists (select 1 from moving)
            and coalesce(private.actor_level(candidate.member_id), -1) < task.min_level)
        or (exists (select 1 from raised)
            and coalesce(private.actor_level(candidate.member_id), -1) < p_min_level)
  ),},
 q{        or (not exists (select 1 from moving) and exists (select 1 from narrowed)
            and not private.is_group_member(p_group_id, executor.member_id))},
 q{        or (not exists (select 1 from moving) and exists (select 1 from narrowed)
            and not private.is_group_member(p_group_id, executor.member_id))
        or (exists (select 1 from raised)
            and coalesce(private.actor_level(executor.member_id), -1) < p_min_level)},
 q{       and not private.is_group_member(p_group_id, executor.member_id)
  ),},
 q{       and not private.is_group_member(p_group_id, executor.member_id)
       and not (exists (select 1 from raised)
                and coalesce(private.actor_level(executor.member_id), -1) < p_min_level)
  ),})
```

`task_field_labels` (`create or replace`) gets one swap: `when 'links'           then 'linkuri'` → that line plus `\n               when 'min_level'       then 'cine îl vede'`.

- [ ] **Step 3: Section 8, the commands.** Dump the two impls and two wrappers, drop all four, and recreate each with a trailing `p_min_level integer` (`default null` on the wrappers).

`preview_task_update_impl`:

```perl
(q{p_link_url text, p_links jsonb)
 RETURNS TABLE},
 q{p_link_url text, p_links jsonb, p_min_level integer)
 RETURNS TABLE},
 q{  v_links jsonb;
begin},
 q{  v_links jsonb;
  v_min_level integer;
begin
  -- R57: the ladder, malformed for every caller (the command's step 1 too).
  if p_min_level is not null and p_min_level not in (0, 1, 2, 3, 5, 6) then
    raise sqlstate 'PT400' using message = 'invalid_task_min_level';
  end if;},
 q{  perform private.plan_task_update(v_task, p_group_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience, v_links);},
 q{  -- R57: null keeps the stored Role; a direct Task or an Umbrella has none.
  v_min_level := case when v_task.kind = 'task' and p_assignment_mode = 'public'
                      then coalesce(p_min_level, v_task.min_level) else 0 end;
  perform private.plan_task_update(v_task, p_group_id, p_title, p_description, p_deadline,
    p_campaign_id, p_assignment_mode, p_audience, v_links, v_min_level);},
 q{from private.task_update_consequences(p_task_id, p_group_id, p_campaign_id, p_assignment_mode, p_audience) as c;},
 q{from private.task_update_consequences(p_task_id, p_group_id, p_campaign_id, p_assignment_mode, p_audience, v_min_level) as c;})
```

`update_task_impl`:

```perl
(q{p_accept_consequences boolean, p_links jsonb)
 RETURNS tasks},
 q{p_accept_consequences boolean, p_links jsonb, p_min_level integer)
 RETURNS tasks},
 q{  v_constraint text;
begin},
 q{  v_constraint text;
  v_min_level integer;
  v_old_min_level integer;
begin
  -- R57: the ladder, malformed for every caller.
  if p_min_level is not null and p_min_level not in (0, 1, 2, 3, 5, 6) then
    raise sqlstate 'PT400' using message = 'invalid_task_min_level';
  end if;},
 q{  if v_task.parent_task_id is distinct from v_parent_id then},
 q{  -- R57: null keeps the stored Role; a direct Task or an Umbrella has none.
  v_old_min_level := v_task.min_level;
  v_min_level := case when v_task.kind = 'task' and p_assignment_mode = 'public'
                      then coalesce(p_min_level, v_task.min_level) else 0 end;
  if v_task.parent_task_id is distinct from v_parent_id then},
 q{  if p_group_id is distinct from v_task.group_id then
    perform 1 from public.profiles profile},
 q{  -- A move or a raised Role judges the queue's live Levels: hold them.
  if p_group_id is distinct from v_task.group_id or v_min_level > v_old_min_level then
    perform 1 from public.profiles profile},
 q{    p_campaign_id, p_assignment_mode, p_audience, v_links);},
 q{    p_campaign_id, p_assignment_mode, p_audience, v_links, v_min_level);},
 q{    from private.task_update_consequences(p_task_id, p_group_id, p_campaign_id, p_assignment_mode, p_audience)},
 q{    from private.task_update_consequences(p_task_id, p_group_id, p_campaign_id, p_assignment_mode, p_audience, v_min_level)},
 q{           links = v_plan -> 'links',},
 q{           links = v_plan -> 'links',
           min_level = v_min_level,},
 q{        then 'Taskul a fost mutat într-un grup pentru care nu ești eligibil.'
        else},
 q{        then 'Taskul a fost mutat într-un grup pentru care nu ești eligibil.'
        when v_min_level > v_old_min_level
        then 'Nu mai ești executorul acestui task: e acum doar pentru '
             || (select role.name from public.roles as role where role.level = v_min_level)
             || ' și peste.'
        else})
```

The wrappers pass `p_min_level` last. Restate the four comments (saved text plus ` R57 (2026-10-14): p_min_level, the Task''s Minimum Level; null keeps it; raising it removes the waiting Candidates and the Executor below it, as consequences to confirm.`). Mirror the grants of `attached_links_five.sql` for the four new signatures.

- [ ] **Step 4: Fixed references.** Update `update_task.test.sql:218-220` and `:599`, and the tracker_grants rows. Then `grep -rn "update_task(\|preview_task_update(\|plan_task_update(\|task_update_consequences(" supabase/tests | grep -i regproc` and fix every hit.

- [ ] **Step 5: Run green.** `npx supabase db reset && npx supabase test db supabase/tests/task_min_level.test.sql supabase/tests/update_task.test.sql supabase/tests/tracker_grants.test.sql supabase/tests/edit_notices.test.sql supabase/tests/task_read_sets.test.sql`. Expected: all pass, the final plan count included.

- [ ] **Step 6: Commit.** `git commit -am "feat: editing a Task's Role, with its consequences confirmed (R57)"`

### Task 6: The lists carry the Role

**Files:**

- Modify: the migration (section 9)
- Modify: `app/src/queries/tasks.ts:12` (`TASK_PRESENTATION_FIELDS` gains `min_level` after `audience`), `app/src/lib/database.types.ts` (regenerated)
- Modify: `supabase/tests/task_list.test.sql` (one case)

- [ ] **Step 1: Failing case.** Append to `task_list.test.sql`, adjusting its plan count: a Task the fixture's leadership caller reads gets `min_level` 2 (`update tasks set min_level = 2 where …`, with the Task public), and `select is((select min_level from public.task_list(…) where id = …), 2, 'a list row carries the Task''s Minimum Level (R57)')`. Use the suite's own caller and argument style. Run it. Expected: FAIL (`column "min_level" does not exist`).

- [ ] **Step 2: Section 9.** Dump `private.task_list_impl` and `public.task_list` (their latest signatures, which may include #1064's later parts). Drop both and recreate them with the `RETURNS TABLE(…)` gaining `min_level integer` right after `audience text`, and every select list that produces `audience` gaining `min_level` beside it (`task.audience, task.min_level` / `page.audience, page.min_level`). Restate comments and grants. If any other function returns `setof` that table type or calls `task_list_impl`, `grep` finds it; restate it the same way.

- [ ] **Step 3: Types and fields.** `npm --prefix app run gen:types` against the reset stack, after every database gate is done. Then add `min_level` to `TASK_PRESENTATION_FIELDS`. `npm --prefix app run typecheck`: fix every fixture typed as a Task row by adding `min_level: 0`, as #1062 did for `event_id`.

- [ ] **Step 4: Run green.** `npx supabase test db supabase/tests/task_list.test.sql` and `npm --prefix app run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -am "feat: Task list rows carry the Role (R57)"`

### Task 7: The app

**Files:**

- Modify:
  - `app/src/lib/minimum-level.ts` (a Task helper)
  - `app/src/screens/tracker/task-form-model.ts` (`TaskFormValues.minLevel`, `TaskDraft.minLevel`, `taskDraftInput`)
  - `app/src/lib/schemas/task.ts` (`minLevel` in both schemas, `fieldForReason`)
  - `app/src/screens/tracker/TaskModeFields.tsx` (`MinimumLevelField`)
  - `app/src/screens/tracker/TaskForm.tsx`
  - `app/src/screens/tracker/TaskEditControl.tsx`
  - `app/src/queries/task-umbrella.ts`, `app/src/queries/task-edit.ts`
  - `app/src/screens/tracker/task-presentation.ts`, `app/src/screens/tracker/TaskDetailsSheet.tsx`
  - `app/src/screens/tracker/TaskHistory.tsx`
  - `app/src/queries/task-opportunities.ts`, `app/src/queries/task-interest.ts`
  - `app/src/lib/command-reasons.ts`
- Test: `minimum-level.test.ts`, `task-form-model.test.ts`, `TaskForm.test.tsx`, `TaskEditControl.test.tsx`, `TaskDetailsSheet.test.tsx`, `task-presentation.test.ts`, `TaskHistory.test.tsx`, plus a `task-opportunities` test (the existing one, found by `grep -rln orderOpportunities app/src --include=*.test.*`), and `TaskInterestControls.test.tsx`.

**Interfaces:**

- Consumes: `tasks.min_level` / row `min_level` (Task 6); the RPC args `p_min_level` (Tasks 4–5).
- Produces:
  - `taskMinimumLevelChoices(origin: { min_level: number } | undefined, audience: 'local' | 'org', actorLevel: number): MinimumLevelOption[]`;
  - `MinimumLevelField`;
  - `TaskDraft.minLevel: number`;
  - `TaskUpdateInput.minLevel: number | null`.

- [ ] **Step 1: Failing model tests.** In `minimum-level.test.ts`:

```ts
it("offers a Task every Role when org-wide, the Group floor up when local, never above the actor (R57)", () => {
  const levels = (floor: number, audience: "local" | "org", actor: number) =>
    taskMinimumLevelChoices({ min_level: floor }, audience, actor).map(
      (rung) => rung.level,
    );
  expect(levels(3, "org", 6)).toEqual([0, 1, 2, 3, 5, 6]);
  expect(levels(3, "local", 6)).toEqual([3, 5, 6]);
  expect(levels(0, "org", 2)).toEqual([0, 1, 2]);
  expect(levels(0, "org", 9)).toEqual([0, 1, 2, 3, 5, 6]);
  expect(levels(5, "local", 2)).toEqual([]);
});
```

In `task-form-model.test.ts`, `taskDraftInput` sends:

- `minLevel` 0 for an Umbrella and for Direct, whatever was chosen;
- the choice when it is offered;
- the lowest choice when it is not (another Group raised the floor, the actor dropped);
- 0 when no choice is offered.

Run both. Expected: FAIL.

- [ ] **Step 2: Implement the model.** In `minimum-level.ts`:

```ts
/**
 * A public Task's **Cine îl vede** (R57): every Role for an organisation-wide
 * Task (R26: it reaches below its Group's floor); from the Group's Minimum
 * Level up for a local one, whose Audience is that Group already; never above
 * the actor's own Level, the Moderator's 9 excepted.
 */
export function taskMinimumLevelChoices(
  origin: { min_level: number } | undefined,
  audience: "local" | "org",
  actorLevel: number,
): MinimumLevelOption[] {
  const floor = audience === "local" ? (origin?.min_level ?? 0) : 0;
  return minimumLevelOptions(
    GROUP_MINIMUM_LEVELS,
    (level) => level >= floor && (actorLevel >= 9 || level <= actorLevel),
  );
}
```

In `task-form-model.ts`:

- `TaskFormValues` gains `minLevel: number`, and `TaskDraft` gains `minLevel: number`.
- `taskDraftInput` takes a third argument, `actorLevel: number`, and sets:

```ts
    // R57: only an ordinary public Task has a queue to gate; a choice no
    // longer offered (another Group, another Audience) falls to the lowest.
    minLevel: (() => {
      if (umbrella || values.assignmentMode !== 'public') return 0;
      const audience = isPrivateGroup(origin?.id, options) ? 'local' : values.audience;
      const choices = taskMinimumLevelChoices(origin, audience, actorLevel);
      return choices.some((rung) => rung.level === values.minLevel)
        ? values.minLevel
        : (choices[0]?.level ?? 0);
    })(),
```

In `lib/schemas/task.ts`, both schemas gain `minLevel: z.number()`. `TaskUpdateValues` gains `minLevel: number | null`. `fieldForReason` maps `invalid_task_min_level` and `task_min_level_above_actor` to `'minLevel'`. Run the model tests. Expected: PASS.

- [ ] **Step 3: Failing component tests.**
  - **`TaskForm.test.tsx`.** **Cine îl vede** is absent while Direct. It appears under **Audiență** when Public, listing the Roles from `taskMinimumLevelChoices`. Choosing `Voluntar` sends `p_min_level: 1` in `create_tasks`' args (assert on the mocked rpc call, as the file's other cases do).
  - **`TaskEditControl.test.tsx`.**
    - The field is prefilled from the row's `min_level`.
    - A row without `min_level` sends `p_min_level: null` and hides the field (Review Focus 4).
    - The preview's `executor_removed` / `candidate_removed` lines show as today.
  - **`TaskDetailsSheet.test.tsx`.** A public Task with `min_level: 1` shows the fact `Cine îl vede` with `De la Voluntar`; `min_level: 0` shows none.
  - **`TaskHistory.test.tsx`.** A `task_updated` entry whose `changed` holds `min_level` reads `Task actualizat: cine îl vede`.
  - **The opportunities test.** A row at `min_level: 2` is not joinable for a viewer at level 1 unless pending, and is joinable at level 2.
  - **`TaskInterestControls.test.tsx`.** A `42501` with message `task_level_forbidden` shows `Taskul e doar pentru un rol mai mare decât al tău.`

Run them. Expected: FAIL.

- [ ] **Step 4: Implement the components.**
  - **`TaskModeFields.tsx`** gains a field:

```tsx
/**
 * **Cine îl vede** (R57), under Audiență while the mode is Public: the lowest
 * Role that sees the Task and may join its queue.
 */
export function MinimumLevelField({
  id,
  value,
  choices,
  onChange,
  form,
}: {
  id: string;
  value: number;
  choices: readonly MinimumLevelOption[];
  onChange: (value: number) => void;
  form: Bound;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={`${id}-min-level`} className="text-sm font-medium">
        Cine îl vede
      </label>
      <Select
        id={`${id}-min-level`}
        name="min_level"
        value={String(value)}
        options={choices.map((choice) => ({
          value: String(choice.level),
          label: choice.label,
        }))}
        onValueChange={(level) => onChange(Number(level))}
        {...form.field("minLevel")}
      />
      <FieldError {...form.errorProps("minLevel")} />
    </div>
  );
}
```

    Import `Select` from the same place `AnnouncementFields.tsx` does, and `MinimumLevelOption` from `lib/minimum-level`.

- **`TaskForm.tsx`.**
  - `actorLevel` comes from `useAuth()` claims (`claims?.member_level ?? 0`), as in `AnnouncementComposeSheet.tsx:56`.
  - Initial `minLevel: 0`.
  - `taskDraftInput(values, options, actorLevel)`.
  - Render `MinimumLevelField` after `AudienceField` while `values.assignmentMode === 'public'`, with `choices={taskMinimumLevelChoices(origin, localOnly ? 'local' : values.audience, actorLevel)}`, and the shown value equal to the draft's `minLevel`, so a dropped choice shows the lowest.
- **`task-umbrella.ts`.** Both arg builders gain `p_min_level: draft.minLevel`.
- **`task-edit.ts`.** `TaskUpdateInput` gains `minLevel: number | null`, and `commandArgs` passes `p_min_level: input.minLevel`.
- **`TaskEditControl.tsx`.**
  - Same field after its `AudienceField` (line ~489), and the same choices from the Task's Group row in its options.
  - Initial value `task.min_level`. When the row has no `min_level` (`undefined`), hide the field and send `null`.
  - When the mode is Direct, send `0`.
- **`task-presentation.ts`.** The presented Task gains `minLevelLabel: string | null` (`min_level > 0 ? \`De la ${minimumLevelText(min_level)}\` : null`).
- **`TaskDetailsSheet.tsx`.** After the **Audiență** fact:

```tsx
{
  task.assignmentMode === "public" && task.minLevelLabel && (
    <Fact icon={ShieldCheck} label="Cine îl vede">
      {task.minLevelLabel}
    </Fact>
  );
}
```

    `ShieldCheck` comes from `lucide-react`; check that the file imports icons from there.

- **`TaskHistory.tsx`.** `fields` gains `min_level: 'Cine îl vede'`.
- **`task-opportunities.ts`.**
  - `OpportunityViewer` gains `level?: number`.
  - `joinable` becomes `pending.has(task.id) || ((relevant || task.audience === 'org') && (level === undefined || (task.min_level ?? 0) <= level))`.
  - `fetchTaskOpportunities` takes the viewer's level and passes it through. Its caller reads `claims?.member_level`.
- **`task-interest.ts`.**
  - `TaskInterestErrorKind` gains `'level'`, with message `Taskul e doar pentru un rol mai mare decât al tău.`.
  - `taskInterestError(code, message?)` returns `'level'` when `message === 'task_level_forbidden'`.
  - `expressTaskInterest` passes `error.message`.
- **`command-reasons.ts`.** Add the three reasons with the Global Constraints copy, beside the other Task reasons.

- [ ] **Step 5: Run green.** `npm --prefix app run test:run -- src/lib src/screens/tracker src/queries`, then `npm --prefix app run typecheck && npm --prefix app run lint && npm --prefix app run format:check`. Expected: PASS.

- [ ] **Step 6: See it.** Start the dev server with `preview_start`. Sign in on the local stack as a demo leadership Member (seed credentials from the project's seed or its docs) and open the Task form:
  - Public shows **Cine îl vede** under **Audiență**; Direct hides it.
  - Switching the Audience to the Group re-floors the list.
  - Make one at Voluntar, then see its details fact.

  Screenshot for the PR.

- [ ] **Step 7: Commit.** `git commit -am "feat: Cine îl vede on public Tasks in the app (R57)"`

### Task 8: Docs, gates, PR, merge

**Files:** `CONTEXT.md`, `docs/adr/0007-task-tracker-lifecycle.md`, `docs/superpowers/plans/2026-09-23-prod-readiness-grill.md` (R57 row: add "PR 2" once it merges), `.superpowers/pr-body-task-min-level.md` (git-ignored).

- [ ] **Step 1: Docs.**
  - **CONTEXT.md.**
    - **Minimum Level** gains: "A public Task's Minimum Level: the lowest Level that sees it as an Opportunity or through Shared Work Visibility and may join its Candidate Queue; a local one's choices start at its Group's, an organisation-wide one's at Recrut (ruling R57)."
    - **Task Audience** ends "…by every active Member, in both cases at or above the Task's Minimum Level".
    - **Opportunity** adds "open to eligible Members at or above its Minimum Level".
  - **ADR-0007.** Header line `- **Amended:** 2026-10-14 — ruling R57: a public Task carries a Minimum Level (any Role, never above its writer's); below it a Member does not see the Opportunity, does not see it through Shared Work Visibility and cannot join; raising it removes the waiting Candidates and the Executor below it, as confirmed consequences; R26's "no Minimum Level gate" becomes "at or above the Task's Minimum Level"`. Then a short section at the end in the style of the other amendments.

- [ ] **Step 2: Gates** (sequenced, never overlapping):
  1. `bash scripts/check-local-ci.sh db` (reset, pgTAP, lint, advisors, upgrade harnesses, seed re-run, types check);
  2. `npm --prefix app run typecheck && npm --prefix app run lint && npm --prefix app run format:check`;
  3. `npm --prefix app run test:run` (full);
  4. `npm run check:root`.

  Expected: all green. A red one is fixed before going on.

- [ ] **Step 3: Final review.** Dispatch a fresh-context reviewer (Opus, `feature-dev:code-reviewer`) with the spec, this plan's Review Focus, and `git diff main...HEAD`. Re-grade its findings. Critical and Important ones get a failing test, then the fix, then the suite again; minor ones are listed in the PR body.

- [ ] **Step 4: PR.** `git push -u origin feat/task-min-level` and `gh pr create --title "A public Task's Minimum Level (R57, part 2)" --body-file .superpowers/pr-body-task-min-level.md`. The body covers: the spec, what changes per area, the mutation record from Task 3, the tests and gates, the screenshot, and Deferred minors. Then `@coderabbitai review`.

- [ ] **Step 5: Merge.** Real findings applied; on green CI for the head SHA, `gh pr merge <n> --merge --delete-branch`. Then check the staging push via `gh run list --commit <merge sha>`, and docs-only on `main`: mark the R57 row done for both parts.
