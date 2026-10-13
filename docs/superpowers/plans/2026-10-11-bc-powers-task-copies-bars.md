# BC-wide Atribuții, Task copies, scrollable bars, full-height date picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the per-member Atribuție holder so every BC member and the Moderator hold every Atribuție's powers; add one atomic `create_tasks` command and the "Exemplare" flow that creates n Task copies (with one Executor per direct copy); make both tab tracks scroll sideways without changing their look; make the date picker popup always its full height.

**Architecture:** Four independent parts on one branch. Part A is one migration that drops the holder table and its commands, widens the one authority helper (`private.assignment_team_role`) to level ≥ 6, and deletes the Administrare BC screen. Part B is one migration adding `private.create_tasks_impl` (a loop over the existing `private.create_task_impl` in one transaction) behind a `public.create_tasks` wrapper, plus a count field, an executors dialog and plural receipts in the Tracker. Parts C and D are front-end only: a scroll-into-view hook and overflow classes on the two tab tracks; a positioner change on the date picker.

**Tech Stack:** Supabase (Postgres 15, PL/pgSQL, RLS, pgTAP), React 19 + TypeScript + Vite, Base UI 1.8.0, TanStack Query, zod, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-11-bc-powers-task-copies-bars-design.md`

## Global Constraints

- Branch `feat/bc-powers-task-copies-bars`; no GitHub issues are created; Alex opens the one PR. Never push to or merge into `main`.
- A new migration is dated after `20261008090000_moderator_deals_team.sql` (verify with `ls supabase/migrations | tail -1` before creating it). Every `create or replace` body is rebuilt from `main`'s latest definition of that function (the ones quoted in this plan are those).
- Every `security definer` function has `set search_path = ''` and fully-qualified names; a command is `public.<verb>_<noun>` (`language sql`, security invoker) over `private.<verb>_<noun>_impl` (`security definer`); grants are "revoke from public, anon, authenticated, service_role" then "grant to authenticated" for both.
- Error reasons are `snake_case`, raised `raise sqlstate 'PT400' using message = '<reason>'` or `raise exception using errcode = '42501', message = '<reason>'`; every new reason gets Romanian copy in `app/src/lib/command-reasons.ts`.
- The Umbrella parent row is locked `for no key update`, never `for update`.
- Copies: 1 to 100 (20 until Task 14; Alex, 2026-10-11: "add a greater limit, like 100 for both options"). Reasons: `invalid_copies`, `too_many_copies`, `invalid_executors`.
- Vocabulary from `CONTEXT.md`: Member, Task, Subtask, Umbrella Task, Executor, Group, BC, BCE, Moderator, Atribuție, Deal, Coordonator, Responsabil. UI copy is Romanian.
- Tests ship in the same commit as the code they prove. Both `npx supabase db reset && npx supabase test db` and, in `app/`, `npm run typecheck && npm run lint && npm run test:run` are green before every commit that touches their side.
- Files are LF. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Working directory for every command below is the repo root `C:\Users\alexb\dev\osubb-app` unless it says `app/`.

## Review Focus

1. `create_tasks` with an executor id that is no profile at all: `create_task_impl` must answer `PT400 invalid_executor` and nothing of the n copies may exist (test in Task 6).
2. "Exemplare" typed as `2.5`, `abc` or left blank: the form shows `invalid_copies` copy under the field and never calls the server (test in Task 8).
3. The executors dialog dismissed with Escape or Înapoi: the form sheet stays open with the draft intact and nothing is created (test in Task 10).
4. The bottom bar on a page outside the five (Profil, Notificări): no current tab, so no short name, no scroll call, no crash (test in Task 11).
5. The Deals team panel while the capability row is still loading (`capabilities` undefined): names only, no pickers, no crash (test in Task 3).

## Where the plan departs from the spec

- `invalid_assignment` stays: the team command still needs a step-1 reason for an unknown Atribuție key. Only `bc_assignment_forbidden`, `bc_assignment_not_bc`, `bc_assignment_held` and `granted_required` are retired.
- The browser schema carries `copies` only. The executors dialog hands its list to `createTasks({ draft, executorIds })` beside the draft instead of a schema field `executorIds`; the dialog itself enforces "one per copy, all chosen".
- `docs/backend/conventions.md` §3 named none of the retired reasons, so nothing is removed there; Part B adds its three reasons.

---

### Task 1: Part A backend — the new team suite (red)

**Files:**

- Create: `supabase/tests/assignment_team.test.sql`
- Delete: `supabase/tests/bc_assignments.test.sql`

**Interfaces:**

- Consumes: today's `public.set_assignment_team_member(text, text, uuid)`, `public.my_capabilities()`, `private.notify`.
- Produces: the assertions Task 2's migration must satisfy.

- [ ] **Step 1: Delete the holder suite**

```bash
git rm -q supabase/tests/bc_assignments.test.sql
```

- [ ] **Step 2: Write the new suite**

Create `supabase/tests/assignment_team.test.sql`:

```sql
-- R47 (2026-10-11): every BC member and the Moderator hold every Atribuție's
-- powers; nobody is a holder. The OSUBB Deals team -- a Coordonator (live BCE)
-- and a Responsabil (live activ) -- is set by any BC member or the Moderator;
-- the Coordonator still sets the Responsabil. Live rows, never the token.
--
-- Mutation check: revert the `>= 6` branch of private.assignment_team_role to
-- `>= 9` and "a BC member sets the Coordonator" plus "BC: every Deals
-- capability" go red.
--
-- Personas (prefix 4747):
--   1 moderator  2 bc  3 bc  4 bce  5 bce  6 voluntar  7 voluntar  8 recrut
--   9 voluntar, inactiv
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(41);

create function pg_temp.u47(n integer) returns uuid language sql immutable as $$
  select ('47470000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users(id, email)
select pg_temp.u47(n), 'echipa.' || n || '.r47@test.local' from generate_series(1, 9) n;
insert into public.profiles(id, full_name, email, role, status)
select pg_temp.u47(n), 'Echipa R47 ' || n, 'echipa.' || n || '.r47@test.local',
       (case n when 1 then 'moderator' when 2 then 'bc' when 3 then 'bc' when 4 then 'bce'
               when 5 then 'bce' when 8 then 'recrut' else 'voluntar' end)::public.member_role,
       (case n when 9 then 'inactiv' else 'activ' end)::public.member_status
  from generate_series(1, 9) n;
-- The demo seed's team is not part of this suite.
delete from public.assignment_team where assignment = 'osubb_deals';

create function pg_temp.notified(p_title text) returns integer[] language sql stable as $$
  select coalesce(array_agg(right(member_id::text, 12)::integer order by right(member_id::text, 12)::integer), '{}')
    from public.notifications
   where title = p_title and member_id::text like '47470000-%'
$$;
-- administer, manage_deals, manage_deals_team, pick_deals_coordinator
create function pg_temp.caps() returns text language sql stable as $$
  select format('%s,%s,%s,%s', c.administer::text, c.manage_deals::text,
                c.manage_deals_team::text, c.pick_deals_coordinator::text)
    from public.my_capabilities() as c
$$;
grant execute on function pg_temp.u47(integer), pg_temp.notified(text), pg_temp.caps() to authenticated, anon;

-- ==================== API surface ====================
select ok(not has_function_privilege('anon', 'public.set_assignment_team_member(text, text, uuid)', 'execute'),
  'anon cannot execute set_assignment_team_member');
select ok(has_function_privilege('authenticated', 'public.set_assignment_team_member(text, text, uuid)', 'execute'),
  'authenticated executes it; the gate is inside');
select ok(not exists (select 1 from pg_proc
                       where proname in ('set_bc_assignment', 'set_bc_assignment_impl',
                                         'bc_assignments_directory', 'bc_assignments_directory_impl')),
  'the holder commands and the Administrare BC directory are gone (R47)');
select hasnt_table('public', 'bc_assignments', 'the holder table is gone (R47)');
select hasnt_fk('public', 'assignment_team', 'the team no longer hangs off a holder row');
select has_check('public', 'assignment_team', 'the known Atribuții are the team table''s check constraint');
select ok(not has_table_privilege('authenticated', 'public.assignment_team', 'insert')
      and not has_table_privilege('authenticated', 'public.assignment_team', 'update')
      and not has_table_privilege('authenticated', 'public.assignment_team', 'delete'),
  'no direct writes on assignment_team: the command is the only write path');

-- ==================== BC sets both places ====================
select pg_temp.test_login_leadership(pg_temp.u47(2));
select is((public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u47(4))).member_id, pg_temp.u47(4),
  'a BC member sets the Coordonator');
select is((public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(6))).member_id, pg_temp.u47(6),
  'a BC member sets the Responsabil');
reset role;
select is(pg_temp.notified('Ești acum Coordonator OSUBB Deals'), array[4], 'the Coordonator set is told');
select is(pg_temp.notified('Ești acum Responsabil OSUBB Deals'), array[6], 'the Responsabil set is told');
select is((select set_by from public.assignment_team where team_role = 'coordinator'), pg_temp.u47(2),
  'set_by records the BC member');
select pg_temp.test_login_leadership(pg_temp.u47(3));
select is((public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u47(5))).member_id, pg_temp.u47(5),
  'another BC member replaces the Coordonator');
reset role;
select is(pg_temp.notified('Nu mai ești Coordonator OSUBB Deals'), array[4], 'the one replaced is told');

-- ==================== The Moderator sets both places ====================
select pg_temp.test_login_leadership(pg_temp.u47(1));
select is((public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u47(4))).member_id, pg_temp.u47(4),
  'the Moderator sets the Coordonator');
select is((public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(7))).member_id, pg_temp.u47(7),
  'the Moderator sets the Responsabil');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u47(6))$$,
  'PT400', 'coordinator_not_bce', 'a Voluntar cannot be the Coordonator');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u47(3))$$,
  'PT400', 'coordinator_not_bce', 'a BC member cannot be the Coordonator either: the place is a BCE member''s');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(9))$$,
  'PT400', 'invalid_team_member', 'an inactive Member cannot be the Responsabil');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(4))$$,
  'PT400', 'assignment_team_duplicate', 'the Coordonator cannot also be the Responsabil');
select is((public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(3))).member_id, pg_temp.u47(3),
  'a BC member may sit in the Responsabil place: nothing forbids it, their powers are theirs anyway');
select is((public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(7))).member_id, pg_temp.u47(7),
  'and is replaced like anyone else');
reset role;

-- ==================== The Coordonator keeps their powers ====================
select pg_temp.test_login_leadership(pg_temp.u47(4));
select is((public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(6))).member_id, pg_temp.u47(6),
  'the Coordonator sets the Responsabil');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u47(5))$$,
  '42501', 'assignment_team_forbidden', 'the Coordonator cannot choose the Coordonator');
reset role;

-- ==================== Everyone else is refused ====================
select pg_temp.test_login_leadership(pg_temp.u47(6));
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(7))$$,
  '42501', 'assignment_team_forbidden', 'the Responsabil cannot pick the team');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(5));
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(7))$$,
  '42501', 'assignment_team_forbidden', 'a BCE member outside the team cannot pick the team');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(7));
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(7))$$,
  '42501', 'assignment_team_forbidden', 'a Voluntar cannot pick the team');
reset role;
select pg_temp.test_clear_jwt();
set local role authenticated;
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(7))$$,
  '42501', 'assignment_team_forbidden', 'a claimless caller cannot pick the team');
reset role;
-- Live rows, not the token: a BC member demoted to Voluntar keeps the token but loses the power.
update public.profiles set role = 'voluntar' where id = pg_temp.u47(3);
select pg_temp.test_login('47470000-0000-0000-0000-000000000003',
  '{"member_role":"bc","member_level":6,"group_ids":[]}'::jsonb);
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(7))$$,
  '42501', 'assignment_team_forbidden', 'a BC member demoted to Voluntar cannot pick the team, whatever the token says');
reset role;
update public.profiles set role = 'bc' where id = pg_temp.u47(3);

-- ==================== Clearing a place ====================
delete from public.notifications where member_id::text like '47470000-%';
select pg_temp.test_login_leadership(pg_temp.u47(2));
select ok((public.set_assignment_team_member('osubb_deals', 'responsible', null)) is null,
  'clearing the Responsabil returns no row');
reset role;
select is((select count(*) from public.assignment_team where team_role = 'responsible')::int, 0,
  'and the place is empty');
select is(pg_temp.notified('Nu mai ești Responsabil OSUBB Deals'), array[6], 'the one cleared is told');
select pg_temp.test_login_leadership(pg_temp.u47(2));
select ok((public.set_assignment_team_member('osubb_deals', 'responsible', null)) is null,
  'clearing an empty place returns no row');
reset role;
select is((select count(*) from public.notifications where member_id::text like '47470000-%')::int, 1,
  'and tells nobody');

-- ==================== Capabilities per persona ====================
-- administer, manage_deals, manage_deals_team, pick_deals_coordinator
select pg_temp.test_login_leadership(pg_temp.u47(1));
select is((public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(6))).member_id, pg_temp.u47(6),
  'the team is whole again: Coordonator 4, Responsabil 6');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(2));
select is(pg_temp.caps(), 'true,true,true,true', 'BC: every Deals capability, without a place in the team (R47)');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(1));
select is(pg_temp.caps(), 'true,true,true,true', 'the Moderator: every Deals capability');
select ok((select c::text from public.my_capabilities() as c)
          ~ '^\((t|f),(t|f),(t|f),(t|f),(t|f),(t|f),(t|f),(t|f),(t|f),(t|f),(t|f)\)$',
  'the capability row has eleven columns: administer_bc is gone');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(4));
select is(pg_temp.caps(), 'true,true,true,false', 'Coordonator: manages Deals and the team, never picks the Coordonator');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(6));
select is(pg_temp.caps(), 'true,true,false,false', 'Responsabil: manage_deals alone, which opens Administrare');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(7));
select is(pg_temp.caps(), 'false,false,false,false', 'a Voluntar outside the team: nothing');
reset role;

select * from finish();
rollback;
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx supabase test db supabase/tests/assignment_team.test.sql`
Expected: FAIL. "a BC member sets the Coordonator" raises `assignment_team_forbidden`, "the holder commands … are gone" is false, `hasnt_table` fails. If pgTAP reports "planned 38 but ran N", fix `plan(41)` to N now.

- [ ] **Step 4: Commit the red suite**

```bash
git add -A supabase/tests/assignment_team.test.sql supabase/tests/bc_assignments.test.sql
git commit -m "test(db): the OSUBB Deals team is set by BC and the Moderator (R47, red)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Part A backend — the migration, the seed and the other suites (green)

**Files:**

- Create: `supabase/migrations/20261011120000_atributii_held_by_bc.sql`
- Modify: `supabase/seed.sql:1840-1857`, `supabase/tests/osubb_deals.test.sql`, `supabase/tests/my_capabilities.test.sql`, `supabase/tests/tracker_grants.test.sql`, `supabase/tests/rls_deny_by_default.test.sql`

**Interfaces:**

- Produces: `private.assignment_team_role` answering `'holder'` for live level ≥ 6; `public.my_capabilities()` with eleven columns (no `administer_bc`); `public.set_assignment_team_member` unchanged in signature.

- [ ] **Step 1: Confirm the date is the newest**

Run: `ls supabase/migrations | tail -1`
Expected: `20261008090000_moderator_deals_team.sql`. If something newer exists, name the new file later than it.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20261011120000_atributii_held_by_bc.sql`:

```sql
-- R47 (2026-10-11): every BC member and the Moderator hold every Atribuție's
-- powers by default (Alex, after the BC meeting: "All of BC members should be
-- able to do all the specific actions ... this button should disappear and by
-- default they will be able to do anything"). Nobody holds an Atribuție: the
-- holder table, its commands and the Moderator's Administrare BC directory go.
-- The OSUBB Deals team stays -- a Coordonator (live BCE) and a Responsabil
-- (live activ) -- set by any BC member or the Moderator; the Coordonator still
-- sets the Responsabil. Existing team rows survive: only their foreign key to
-- the holder row is dropped.
-- Spec: docs/superpowers/specs/2026-10-11-bc-powers-task-copies-bars-design.md

-- ==================== 1. The holder commands go ====================

drop function public.set_bc_assignment(text, uuid, boolean, boolean);
drop function private.set_bc_assignment_impl(text, uuid, boolean, boolean);
drop function public.bc_assignments_directory();
drop function private.bc_assignments_directory_impl();

-- ==================== 2. The one authority definition ====================

create or replace function private.assignment_team_role(p_assignment text, p_member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- Live rows only: a Coordonator no longer bce, or anyone no longer activ,
  -- keeps the row but loses the power until someone changes the place.
  select case
    -- R47: every live BC member (level 6) and the Moderator (level 9) hold
    -- every Atribuție's powers. "holder" is the word the callers know;
    -- nobody holds anything any more. The one place that says so.
    when private.actor_level(p_member) >= 6
      then 'holder'
    when exists (select 1 from public.assignment_team as team
                  where team.assignment = p_assignment and team.member_id = p_member
                    and team.team_role = 'coordinator')
         and private.actor_level(p_member) = 5
      then 'coordinator'
    when exists (select 1 from public.assignment_team as team
                  where team.assignment = p_assignment and team.member_id = p_member
                    and team.team_role = 'responsible')
         and private.actor_level(p_member) is not null
      then 'responsible'
  end;
$$;

comment on function private.assignment_team_role(text, uuid) is
  'R44/R47: the Member''s live powers in an Atribuție -- holder (any live BC member, level 6, or the live Moderator, level 9: since R47 each of them holds every Atribuție''s powers by default, and nobody is a holder in R44''s sense), coordinator (the team''s Coordonator and live bce, level 5), responsible (the team''s Responsabil and live activ) -- or null. The one definition every capability, policy and command reads. Granted to nobody: definer code calls it; policies call private.deals_team_role().';

comment on function private.deals_team_role() is
  'R44/R45/R47: the caller''s live powers in the OSUBB Deals team (holder -- any BC member or the Moderator --, coordinator, responsible) or null; null without organization claims. Policy predicate: authenticated may execute it.';

-- ==================== 3. set_assignment_team_member ====================

create or replace function private.set_assignment_team_member_impl(p_assignment text, p_team_role text, p_member_id uuid)
returns public.assignment_team
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid;
  v_actor_role   text;
  v_old          uuid;
  v_other        uuid;
  v_target_level integer;
  v_row          public.assignment_team%rowtype;
  v_place        text;
begin
  -- 1. Malformed for every caller.
  if p_assignment is null or p_assignment not in ('osubb_deals') then
    raise sqlstate 'PT400' using message = 'invalid_assignment';
  end if;
  if p_team_role is null or p_team_role not in ('coordinator', 'responsible') then
    raise sqlstate 'PT400' using message = 'invalid_team_role';
  end if;
  v_place := case p_team_role when 'coordinator' then 'Coordonator' else 'Responsabil' end;

  -- 2. The actor, live, held for the transaction.
  v_actor := (select auth.uid());
  if v_actor is null or not coalesce(public.auth_is_member(), false) then
    raise exception using errcode = '42501', message = 'assignment_team_forbidden';
  end if;
  perform 1 from public.profiles as actor
   where actor.id = v_actor and actor.status = 'activ'
   for share of actor;

  -- 3. R47: BC or the Moderator (role holder) set either place; the
  --    Coordonator the Responsabil only. One Atribuție's team changes one
  --    place at a time: a transaction advisory lock per Atribuție stands in
  --    for the parent row the team no longer has.
  perform pg_advisory_xact_lock(hashtext('osubb.assignment_team:' || p_assignment));
  v_actor_role := private.assignment_team_role(p_assignment, v_actor);
  if not coalesce(v_actor_role = 'holder'
                  or (v_actor_role = 'coordinator' and p_team_role = 'responsible'), false) then
    raise exception using errcode = '42501', message = 'assignment_team_forbidden';
  end if;

  -- 4. The place, locked.
  select team.member_id into v_old
    from public.assignment_team as team
   where team.assignment = p_assignment and team.team_role = p_team_role
   for update;
  select team.member_id into v_other
    from public.assignment_team as team
   where team.assignment = p_assignment and team.team_role <> p_team_role;

  if p_member_id is null then
    if v_old is null then
      return null;
    end if;
    delete from public.assignment_team
     where assignment = p_assignment and team_role = p_team_role;
    perform private.notify(array[v_old], 'system'::public.noti_kind,
      'Nu mai ești ' || v_place || ' OSUBB Deals', null, null, null, v_actor);
    return null;
  end if;

  -- 5. The person: a Coordonator is live bce, a Responsabil any live Member;
  --    never the other place's member.
  select role.level into v_target_level
    from public.profiles as target
    join public.roles as role on role.id = target.role
   where target.id = p_member_id
     and target.status = 'activ'
   for share of target;
  if p_team_role = 'coordinator' and coalesce(v_target_level, -1) <> 5 then
    raise sqlstate 'PT400' using message = 'coordinator_not_bce';
  end if;
  if p_team_role = 'responsible' and v_target_level is null then
    raise sqlstate 'PT400' using message = 'invalid_team_member';
  end if;
  if p_member_id is not distinct from v_other then
    raise sqlstate 'PT400' using message = 'assignment_team_duplicate';
  end if;
  if p_member_id is not distinct from v_old then
    select * into v_row from public.assignment_team
     where assignment = p_assignment and team_role = p_team_role;
    return v_row;
  end if;

  insert into public.assignment_team (assignment, team_role, member_id, set_by)
  values (p_assignment, p_team_role, p_member_id, v_actor)
  on conflict (assignment, team_role) do update
     set member_id = excluded.member_id, set_by = excluded.set_by, set_at = now()
  returning * into v_row;

  perform private.notify(array[p_member_id], 'system'::public.noti_kind,
    'Ești acum ' || v_place || ' OSUBB Deals', null, null, null, v_actor, '/administrare/deals');
  if v_old is not null then
    perform private.notify(array[v_old], 'system'::public.noti_kind,
      'Nu mai ești ' || v_place || ' OSUBB Deals', null, null, null, v_actor);
  end if;
  return v_row;
end;
$$;

comment on function private.set_assignment_team_member_impl(text, text, uuid) is
  'R47: body of public.set_assignment_team_member. Step 1: PT400 invalid_assignment, invalid_team_role. Then 42501 assignment_team_forbidden unless the live caller is BC or the Moderator (either place) or the Coordonator (the responsible place only), judged by private.assignment_team_role under a transaction advisory lock per Atribuție. The place is locked FOR UPDATE. A null member clears it. Otherwise PT400 coordinator_not_bce (a Coordonator is live bce, level 5), invalid_team_member (a Responsabil is a live activ Member), assignment_team_duplicate (the member of the other place); the same member again changes nothing. Notifies the member set ("Ești acum Coordonator/Responsabil OSUBB Deals", link /administrare/deals) and the one replaced or cleared ("Nu mai ești ..."), kind system. Returns the row, or null when cleared.';

comment on function public.set_assignment_team_member(text, text, uuid) is
  'R47: BC, the Moderator or (the Responsabil only) the Coordonator fill or clear a place in an Atribuție''s team. Reasons: PT400 invalid_assignment / invalid_team_role / coordinator_not_bce / invalid_team_member / assignment_team_duplicate, 42501 assignment_team_forbidden.';

-- ==================== 4. The team table stands on its own ====================

alter table public.assignment_team
  drop constraint assignment_team_assignment_fkey;
alter table public.assignment_team
  add constraint assignment_team_assignment_ck check (assignment in ('osubb_deals'));

comment on table public.assignment_team is
  'R44/R47: an Atribuție''s team -- at most one Coordonator (a BCE member) and one Responsabil (any active Member), never one person twice. Set by BC or the Moderator (either place) or the Coordonator (the Responsabil) through public.set_assignment_team_member; nothing dissolves it. The known Atribuții are assignment_team_assignment_ck. Readable by every live Member: the OSUBB Deals page shows the team.';

drop table public.bc_assignments;

-- ==================== 5. my_capabilities without administer_bc ====================

drop function public.my_capabilities();
drop function private.my_capabilities_impl();

create function private.my_capabilities_impl()
returns table (manages_any_group boolean, manage_tasks boolean, see_directory boolean,
               see_leadership boolean, manage_roles boolean, provision_members boolean,
               create_top_level_groups boolean, administer boolean,
               manage_deals boolean, manage_deals_team boolean, pick_deals_coordinator boolean)
language sql
stable
security definer
set search_path = ''
as $$
  -- A FROM-less select: exactly one row whatever the caller. Without organization claims, or
  -- with a stale claim over an inactive Profile, the live level is null and every comparison
  -- below collapses to false.
  with actor as (
    select case when coalesce(public.auth_is_member(), false) then private.actor_level() end
             as level
  ),
  facts as (
    select actor.level,
           actor.level is not null and coalesce(private.holds_any_group_role(), false)
             as holds_role,
           actor.level is not null and coalesce(public.can_manage_tasks(), false)
             as manage_tasks,
           -- R44/R47: the caller's live powers in the OSUBB Deals team.
           case when actor.level is not null
                then private.assignment_team_role('osubb_deals', (select auth.uid())) end
             as deals_role
      from actor
  )
  select coalesce(facts.holds_role or facts.level >= 6, false),
         facts.manage_tasks,
         coalesce(facts.level >= 5, false),
         coalesce(facts.level >= 5, false),
         coalesce(facts.level >= 6, false),
         coalesce(facts.level >= 6, false),
         coalesce(facts.level >= 6, false),
         coalesce(facts.holds_role or facts.level >= 6 or facts.deals_role is not null, false),
         facts.deals_role is not null,
         coalesce(facts.deals_role in ('holder', 'coordinator'), false),
         coalesce(facts.deals_role = 'holder', false)
    from facts;
$$;

comment on function private.my_capabilities_impl() is
  'The body of public.my_capabilities() (#576). Always exactly one row; every column false for a caller without organization claims or whose Profile is not activ (a stale claim is not authority). Columns from live state only: manages_any_group = holds_any_group_role() or level >= 6; manage_tasks = public.can_manage_tasks() (one predicate, two readers); see_directory and see_leadership = level >= 5; manage_roles, provision_members and create_top_level_groups = level >= 6; administer = manages_any_group or level >= 6 or manage_deals (R44: the Deals team reaches Administrare); manage_deals = any Deals power (BC, the Moderator, the Coordonator or the Responsabil, private.assignment_team_role); manage_deals_team = BC, the Moderator or the Coordonator; pick_deals_coordinator = BC or the Moderator. R47 dropped administer_bc: there is no Administrare BC.';

create function public.my_capabilities()
returns table (manages_any_group boolean, manage_tasks boolean, see_directory boolean,
               see_leadership boolean, manage_roles boolean, provision_members boolean,
               create_top_level_groups boolean, administer boolean,
               manage_deals boolean, manage_deals_team boolean, pick_deals_coordinator boolean)
language sql
stable
set search_path = ''
as $$
  select * from private.my_capabilities_impl();
$$;

comment on function public.my_capabilities() is
  'Read-only: the live caller''s capability row for the frontend (ADR-0009 Decision 6, #576; R44 added manage_deals, manage_deals_team, pick_deals_coordinator; R47 dropped administer_bc). Cosmetic for the client -- every command and policy still decides on its own. Exactly one row, all false without organization claims or an activ Profile.';

revoke execute on function private.my_capabilities_impl()
  from public, anon, authenticated, service_role;
revoke execute on function public.my_capabilities()
  from public, anon, authenticated, service_role;
grant execute on function private.my_capabilities_impl() to authenticated;
grant execute on function public.my_capabilities() to authenticated;
```

- [ ] **Step 3: Fix the seed**

In `supabase/seed.sql`, replace the block from `-- ==================== OSUBB Deals (R44, R45) ====================` through the `on conflict do nothing;` that ends the `assignment_team` insert (today lines 1840–1856) with:

```sql
-- ==================== OSUBB Deals (R44, R45, R47) ====================
-- Nobody holds an Atribuție (R47): the demo BCE member is Coordonator and the
-- demo Voluntar Responsabil, set by the demo BC member. On a staging database
-- where a real team sits in the places, the demo leaves it alone (on conflict
-- do nothing). The rows go with the demo profiles on the next run (on delete
-- cascade). Two Deals: an active one with a code and two Attached Links, and
-- an expired one only the team, BC and the Moderator still see.
insert into assignment_team (assignment, team_role, member_id, set_by)
values ('osubb_deals', 'coordinator', 'd0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000007'),
       ('osubb_deals', 'responsible', 'd0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000007')
on conflict do nothing;
```

- [ ] **Step 4: Update the Deals suite**

In `supabase/tests/osubb_deals.test.sql`:

- Lines 40–41: delete `delete from public.bc_assignments;` and the `insert into public.bc_assignments(...)` line. Keep the `assignment_team` insert (its `set_by` stays `pg_temp.u45(2)`).
- Line ~104: replace the `throws_ok` whose description is `'a BC member outside the team cannot publish a Deal'` with
  ```sql
  select lives_ok($$insert into public.announcements(kind, title, body, group_id, audience)
    values ('deal', 'Deal R45 x6', 'Corp.', pg_temp.org(), 'org')$$,
    'a BC member publishes a Deal without a place in the team (R47)');
  reset role;
  delete from public.announcements where title = 'Deal R45 x6';
  ```
  (the delete keeps every later count unchanged; keep the `reset role;` that already follows if it is there, do not duplicate it).
- Line ~109: reword `'the Moderator publishes a Deal without holding the Atribuție (R44 amended: every Atribuție''s powers)'` to `'the Moderator publishes a Deal (R47: every Atribuție''s powers)'`.
- Line ~181: reword `'the holder edits any Deal'` to `'a BC member edits any Deal'`; line ~204 `'a BC member outside the team deletes a Deal (a leftover after the team dissolves)'` to `'a BC member deletes any Deal'`.
- Lines ~333–336: replace `delete from public.bc_assignments;` with `delete from public.assignment_team where assignment = 'osubb_deals' and team_role = 'responsible';`, and the section title with `-- ==================== The Responsabil is cleared, the Deals stay ====================`; reword the three descriptions to `'once the Responsabil is cleared, the former Responsabil no longer reads an expired Deal'`, `'nor edits their own Deal'`, `'the Moderator removes a leftover Deal'`.

- [ ] **Step 5: Update the capability suite**

In `supabase/tests/my_capabilities.test.sql` every persona string has twelve values; remove the ninth (`administer_bc`) from each, so `'(t,t,t,t,t,t,t,t,f,f,f,f)'` becomes `'(t,t,t,t,t,t,t,t,f,f,f)'`. Then:

- persona 11 "BC (level 6)" becomes `'(t,t,t,t,t,t,t,t,t,t,t)'`;
- persona 12 "Moderator" becomes `'(t,t,t,t,t,t,t,t,t,t,t)'` and its comment reads `-- 12. Moderator (level 9): every Deals power (R47).`;
- the "BCE promoted to BC" assertion (line ~188) becomes `'(t,t,t,t,t,t,t,t,t,t,t)'` with the text `'BCE promoted to BC: every level-6 input flips, the Deals powers included (R47)'`;
- any persona already BC or Moderator elsewhere in the file gets the last three `t`; update the header comment (lines 5–8) to say the row has eleven columns and that BC holds the three Deals flags since R47.

- [ ] **Step 6: Update the grant rosters and the RLS sweep**

In `supabase/tests/tracker_grants.test.sql`:

- delete the two wrapper rows `('set_bc_assignment', …)` and `('bc_assignments_directory', …)` (keep `set_assignment_team_member`), and reword the comment above them to `-- R44/R47: the team command. Same wrapper shape; BC / Moderator / Coordonator gates live in the body.`;
- delete the two private rows `('set_bc_assignment_impl', …)` and `('bc_assignments_directory_impl', …)`, reword the comment above `assignment_team_role` to drop "the two command bodies and the directory body";
- change the private count pin `220` (line ~925) to `218`.

In `supabase/tests/rls_deny_by_default.test.sql` delete lines `delete from bc_assignments;` and the two-line `insert into bc_assignments (...) values (...)`; keep the `assignment_team` insert; reword the comment above to `-- R44/R45/R47: the OSUBB Deals team and the Deal Code reveals. These rows stand on their own.`

- [ ] **Step 7: Rebuild and run everything**

Run: `npx supabase db reset && npx supabase test db`
Expected: every suite green, `assignment_team.test.sql` included. If `tracker_grants` reports a different private count, set the pin to the number it reports. If `osubb_deals` reports a shifted count after the `lives_ok`, check the `delete from public.announcements where title = 'Deal R45 x6'` ran as `postgres` (after `reset role`).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261011120000_atributii_held_by_bc.sql supabase/seed.sql supabase/tests
git commit -m "feat(db): every BC member holds every Atribuție (R47)

Drop the holder table, its grant command and the Administrare BC directory.
private.assignment_team_role answers holder for any live BC member or the
Moderator; the team command serializes on an advisory lock and lets BC, the
Moderator and -- for the Responsabil -- the Coordonator set the places.
my_capabilities loses administer_bc. Existing team rows survive.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Part A frontend — Administrare BC goes, the Echipa panel shows two places

**Files:**

- Delete: `app/src/screens/administrare/AdminBcTab.tsx`, `app/src/screens/administrare/AdminBcTab.test.tsx`, `app/src/screens/administrare/bc-assignments-view.ts`, `app/src/queries/bc-assignments.ts`
- Modify: `app/src/App.tsx:80,499-505`, `app/src/screens/administrare/administrare-tabs.ts:95-101`, `app/src/components/shell/navItems.ts:139`, `app/src/lib/capabilities.ts`, `app/src/queries/keys.ts:254-262`, `app/src/queries/live-changes.ts:88-90`, `app/src/lib/command-reasons.ts:34-48`, `app/src/queries/deals.ts:238-324`, `app/src/screens/deals/deals-presentation.ts:110-205`, `app/src/screens/deals/DealsTeamPanel.tsx`, `app/src/screens/deals/DealsAdminTab.tsx:17-25`, `app/src/lib/database.types.ts` (generated)
- Test: `app/src/screens/deals/DealsTeamPanel.test.tsx`, `app/src/screens/deals/DealsAdminTab.test.tsx`, `app/src/screens/administrare/AdministrareLayout.test.tsx`, `app/src/App.test.tsx`, `app/src/lib/auth-destination.test.ts`, `app/src/queries/deals.test.ts`, `app/src/lib/capabilities.test.tsx`, `app/src/components/shell/AppShell.test.tsx`, `app/src/queries/event-creation.test.ts`, `app/src/queries/event-edit.test.ts`

**Interfaces:**

- Consumes: Task 2's `my_capabilities()` (eleven columns) and `assignment_team` as the only team table.
- Produces: `DealsTeam = { coordinatorId, responsibleId }`; `Capabilities` without `administerBc`.

- [ ] **Step 1: Regenerate the database types**

Run (in `app/`): `npm run gen:types`
Expected: `src/lib/database.types.ts` loses `bc_assignments`, `bc_assignments_directory`, `set_bc_assignment`, and `my_capabilities`'s row type loses `administer_bc`. `npm run typecheck` now fails in the files below: that is the red state.

- [ ] **Step 2: Write the failing panel tests**

Replace the body of `app/src/screens/deals/DealsTeamPanel.test.tsx` from `const state = vi.hoisted(` through the end of the `beforeEach` with:

```tsx
const state = vi.hoisted(() => ({
  caps: undefined as Record<string, boolean> | undefined,
  team: {
    coordinatorId: null as string | null,
    responsibleId: null as string | null,
  },
  members: [] as AppointableMember[],
  mutate: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({ supabase: {} }));
vi.mock("../../lib/capabilities", () => ({
  useCapabilities: () => ({ data: state.caps }),
  useCapability: (name: string) => ({ data: state.caps?.[name] === true }),
}));
vi.mock("../../queries/deals", () => ({
  useDealsTeam: () => ({
    data: state.team,
    isPending: false,
    isError: false,
  }),
  useSetDealsTeamMember: () => ({ mutate: state.mutate, isPending: false }),
}));
vi.mock("../../queries/groups-admin", () => ({
  useAppointableMembers: () => ({ data: state.members, isPending: false }),
}));
vi.mock("../../queries/member-identities", () => ({
  useMemberIdentities: () => ({
    data: new Map(
      state.members.map((m) => [
        m.memberId,
        { memberId: m.memberId, fullName: m.name },
      ]),
    ),
  }),
}));
vi.mock(
  "../../queries/member-card",
  () => import("../../test/member-card-mock"),
);

import { DealsTeamPanel } from "./DealsTeamPanel";

function member(memberId: string, name: string, level: number) {
  return {
    memberId,
    name,
    nickname: null,
    avatarColor: null,
    status: "activ",
    roleId: null,
    roleLabel: level === 5 ? "BCE" : level === 6 ? "BC" : "Voluntar",
    level,
  } satisfies AppointableMember;
}

/* R47: a BC member's capability row -- every Deals power, no place needed. */
const BC = {
  manageRoles: true,
  administer: true,
  manageDeals: true,
  manageDealsTeam: true,
  pickDealsCoordinator: true,
};

beforeEach(() => {
  state.members = [
    member("bc", "Bogdan BC", 6),
    member("bce", "Carmen BCE", 5),
    member("vol", "Victor Voluntar", 2),
  ];
  state.team = { coordinatorId: null, responsibleId: null };
  state.caps = BC;
  state.mutate.mockReset();
});

const pickers = () => screen.queryAllByRole("combobox");
```

Then replace every `it(...)` in the file with these:

```tsx
describe("the OSUBB Deals team, per persona (R47)", () => {
  it("shows two places on one row, Coordonator and Responsabil, without hints", () => {
    render(<DealsTeamPanel />);
    const terms = screen.getAllByRole("term").map((term) => term.textContent);
    expect(terms).toEqual(["Coordonator", "Responsabil"]);
    expect(screen.queryByText(/Membru BCE/)).toBeNull();
    expect(screen.queryByText(/Orice membru activ/)).toBeNull();
    expect(screen.queryByText(/Atribuție BC/)).toBeNull();
    expect(screen.queryByText(/Responsabil OSUBB Deals/)).toBeNull();
    expect(document.querySelector("dl")).toHaveClass("sm:grid-cols-2");
  });

  it("lets a BC member pick both places and offers BCE members alone as Coordonator", async () => {
    const user = userEvent.setup();
    state.mutate.mockImplementation(
      (_input: unknown, options?: { onSuccess?: () => void }) =>
        options?.onSuccess?.(),
    );
    render(<DealsTeamPanel />);
    const [coordinator, responsible] = pickers();
    expect(pickers()).toHaveLength(2);
    if (!coordinator || !responsible) throw new Error("two pickers expected");
    await user.click(coordinator);
    await screen.findByPlaceholderText("Caută un membru");
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Fără coordonator", "Carmen BCE"]);
    await user.click(screen.getByRole("option", { name: /Carmen BCE/ }));
    expect(state.mutate).toHaveBeenCalledWith(
      { role: "coordinator", memberId: "bce" },
      expect.anything(),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Carmen BCE este acum Coordonator OSUBB Deals.",
    );
  });

  it("lets the Coordonator pick the Responsabil only", () => {
    state.caps = { manageDeals: true, manageDealsTeam: true, administer: true };
    state.team = { coordinatorId: "bce", responsibleId: null };
    render(<DealsTeamPanel />);
    expect(pickers()).toHaveLength(1);
    expect(screen.getByText("Carmen BCE")).toBeVisible();
    expect(pickers()[0]).toHaveTextContent("Fără responsabil");
  });

  it("shows the Responsabil names only", () => {
    state.caps = { manageDeals: true, administer: true };
    state.team = { coordinatorId: "bce", responsibleId: "vol" };
    render(<DealsTeamPanel />);
    expect(pickers()).toHaveLength(0);
    expect(screen.getByText("Carmen BCE")).toBeVisible();
    expect(screen.getByText("Victor Voluntar")).toBeVisible();
  });

  it("shows names only while the capability row is still loading", () => {
    state.caps = undefined;
    state.team = { coordinatorId: "bce", responsibleId: null };
    render(<DealsTeamPanel />);
    expect(pickers()).toHaveLength(0);
    expect(screen.getByText("Carmen BCE")).toBeVisible();
    expect(screen.getByText("Neales")).toBeVisible();
  });

  it("keeps the other place out of a picker: the Coordonator is not offered as Responsabil", async () => {
    const user = userEvent.setup();
    state.team = { coordinatorId: "bce", responsibleId: null };
    render(<DealsTeamPanel />);
    const responsible = pickers()[1];
    if (!responsible) throw new Error("no Responsabil picker");
    await user.click(responsible);
    await screen.findByPlaceholderText("Caută un membru");
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Fără responsabil", "Bogdan BC", "Victor Voluntar"]);
  });
});
```

Keep the file's existing imports (`render, screen, within`, `userEvent`, `beforeEach, describe, expect, it, vi`, `AppointableMember`); drop `within` if unused.

- [ ] **Step 3: Run the panel tests, confirm red**

Run (in `app/`): `npx vitest run src/screens/deals/DealsTeamPanel.test.tsx`
Expected: FAIL ("Coordonator" terms list has three entries, hints present, `sm:grid-cols-2` missing).

- [ ] **Step 4: Rewrite the queries and presentation**

In `app/src/queries/deals.ts` replace the `team` section from `/** The OSUBB Deals team: … */` through the end of `fetchDealsTeam` with:

```ts
/** The OSUBB Deals team (R47): the two places BC or the Moderator fill. */
export type DealsTeam = {
  coordinatorId: string | null;
  responsibleId: string | null;
};

export type TeamRole = "coordinator" | "responsible";

/**
 * Who sits in the OSUBB Deals team (R44/R47). The table is readable by every
 * live Member; nobody writes it directly.
 */
export async function fetchDealsTeam(): Promise<DealsTeam> {
  const team = await supabase
    .from("assignment_team")
    .select("team_role, member_id")
    .eq("assignment", OSUBB_DEALS_ASSIGNMENT);
  if (team.error) throw team.error;
  const place = (role: TeamRole) =>
    (team.data ?? []).find((row) => row.team_role === role)?.member_id ?? null;
  return {
    coordinatorId: place("coordinator"),
    responsibleId: place("responsible"),
  };
}
```

and reword `setDealsTeamMember`'s comment to `BC and the Moderator set both places, the Coordonator the Responsabil only (R47); the server decides, and notifies the person set and the one replaced.`

In `app/src/screens/deals/deals-presentation.ts`:

- `DealsViewer` comments: `manageDealsTeam`: `BC, the Moderator or the Coordonator (my_capabilities().manage_deals_team).`; `manageDeals`: `Any Deals power: BC, the Moderator, the Coordonator or the Responsabil (manage_deals).`
- `mayEditDeal`'s doc comment: `Editează (R47): BC, the Moderator and the Coordonator on every Deal, the Responsabil on their own. Presentation only: the policies decide.`
- `teamMemberIds` returns `[team.coordinatorId, team.responsibleId].filter(...)`.
- `notOnTeam` drops the `team?.holderId !== memberId &&` line.
- `coordinatorCandidates` comment: `The Coordonator picker's choices (R47): active BCE members (level 5), never the Responsabil.`

In `app/src/screens/deals/DealsTeamPanel.tsx`:

- replace the header doc comment with:
  ```tsx
  /**
   * The OSUBB Deals team (ruling R47): a Coordonator — a BCE member — and a
   * Responsabil — any active Member. Any BC member or the Moderator picks both;
   * the Coordonator picks the Responsabil. Whoever may not pick a place sees
   * its name. Each pick takes effect at once: the server tells the person set
   * and the one replaced, and a receipt says it here.
   */
  ```
- replace the three lines `const held = …`, `const pickCoordinator = …`, `const pickResponsible = …` with
  ```tsx
  const pickCoordinator = capabilities?.pickDealsCoordinator === true;
  const pickResponsible = capabilities?.manageDealsTeam === true;
  ```
- replace `<dl className="m-0 grid gap-x-6 gap-y-4 sm:grid-cols-3">` with `<dl className="m-0 grid gap-x-6 gap-y-4 sm:grid-cols-2">`;
- delete the whole `<TeamPlace label="Responsabil OSUBB Deals" hint="Atribuție BC">…</TeamPlace>` block;
- change `<TeamPlace label="Coordonator" hint="Membru BCE">` to `<TeamPlace label="Coordonator">` and `<TeamPlace label="Responsabil" hint="Orice membru activ">` to `<TeamPlace label="Responsabil">`;
- replace `TeamPlace` with
  ```tsx
  function TeamPlace({
    label,
    children,
  }: {
    label: string;
    children: ReactNode;
  }) {
    return (
      <div className="min-w-0 space-y-1.5">
        <dt className="text-xs font-semibold text-foreground">{label}</dt>
        <dd className="m-0 min-w-0">{children}</dd>
      </div>
    );
  }
  ```

In `app/src/screens/deals/DealsAdminTab.tsx` replace the doc comment with:

```tsx
/**
 * Administrare › OSUBB Deals (ruling R47): the team, then every Deal —
 * active and expired — each with Editează and Șterge as the viewer may, and
 * how many Members opened its code. Every BC member and the Moderator see it
 * with Deal nou, Editează, Șterge and both team pickers; the Coordonator the
 * same except the Coordonator picker; the Responsabil sees the list, Deal nou
 * and their own Deals' Editează and Șterge.
 */
```

- [ ] **Step 5: Remove Administrare BC**

```bash
git rm -q app/src/screens/administrare/AdminBcTab.tsx app/src/screens/administrare/AdminBcTab.test.tsx app/src/screens/administrare/bc-assignments-view.ts app/src/queries/bc-assignments.ts
```

Then:

- `app/src/App.tsx`: delete line 80 (`const AdminBcTab = lazy(...)`) and the `<Route path="bc" …>…</Route>` block (lines 499–505).
- `app/src/screens/administrare/administrare-tabs.ts`: delete the `/administrare/bc` entry (the object with `label: 'Administrare BC'` and its comment), remove `Crown` from the `lucide-react` import if nothing else uses it, and change the comment `then R44's two` to `then R44's OSUBB Deals`.
- `app/src/components/shell/navItems.ts`: delete the line `'/administrare/bc',`.
- `app/src/lib/capabilities.ts`: delete the `administerBc` property and its comment from the type, and `administerBc: data.administer_bc,` from `fetchCapabilities`; reword the three Deals comments to `/** Any Deals power (R47): BC, the Moderator, the Coordonator or the Responsabil: Administrare › OSUBB Deals. */`, `/** BC, the Moderator or the Coordonator: picks the Responsabil, manages every Deal. */`, `/** BC or the Moderator: picks the Coordonator. */`.
- `app/src/queries/keys.ts`: delete the `holders:` entry; comment becomes `/* The OSUBB Deals team (R44/R47). */`.
- `app/src/queries/live-changes.ts`: delete the `['bc_assignments', …]` row; comment becomes `// R47: a team place changes who may do what.`
- `app/src/lib/command-reasons.ts`: delete the `bc_assignment_forbidden`, `bc_assignment_not_bc` and `bc_assignment_held` entries; keep `invalid_assignment` (still raised for an unknown Atribuție key) and the team reasons; the section comment becomes `/* ---- The OSUBB Deals team and Deals (R44, R45, R47) ---- */`.

- [ ] **Step 6: Update the other tests**

- `AdministrareLayout.test.tsx`: remove `administerBc: false,` from the three `Capabilities` literals; delete the line `const MODERATOR: Capabilities = { ...BC, administerBc: true };` and its comment; delete the test `'adds Administrare BC for the Moderator alone (R44)'`. If `MODERATOR` is used elsewhere in the file, replace it with `BC`.
- `App.test.tsx`: remove `'administerBc',` from `EVERY_CAPABILITY`; delete the test `'opens Administrare BC to the Moderator only, never to BC'`; remove any `AdminBcTab` mock (search `Administrare BC tab`).
- `lib/auth-destination.test.ts`: delete the `'/administrare/bc',` line.
- `queries/deals.test.ts` `fetchDealsTeam` case: the mock no longer answers a `bc_assignments` read; expect `{ coordinatorId: 'coord', responsibleId: 'resp' }`; replace `expect(supabaseMock.from).toHaveBeenCalledWith('bc_assignments')` with `expect(supabaseMock.from).not.toHaveBeenCalledWith('bc_assignments')`.
- `lib/capabilities.test.tsx`: remove `administer_bc: false,` and `administerBc: false,`.
- `components/shell/AppShell.test.tsx`, `queries/event-creation.test.ts`, `queries/event-edit.test.ts`, `screens/deals/DealsAdminTab.test.tsx:171`: remove every `administerBc:` line.
- `screens/deals/DealsAdminTab.test.tsx`: replace the two tests `'gives BC and the Moderator Șterge only, and no Deal nou'` and `'keeps a BC member who does not hold it to Șterge, with no Deal nou'` with one:

  ```tsx
  it("gives a BC member Deal nou, Editează and Șterge on any Deal (R47)", async () => {
    viewer.caps = {
      manageRoles: true,
      administer: true,
      manageDeals: true,
      manageDealsTeam: true,
      pickDealsCoordinator: true,
    };
    renderTab();
    const other = await card("Expirat de la Coordonator");
    expect(screen.getByRole("button", { name: "Deal nou" })).toBeVisible();
    expect(
      within(other).getByRole("button", { name: /Editează/ }),
    ).toBeVisible();
    expect(within(other).getByRole("button", { name: /Șterge/ })).toBeVisible();
  });
  ```

  (use the file's existing `viewer`, `renderTab` and `card` helpers; if the "Deal nou" control's accessible name differs in this file's other tests, use that name).

- [ ] **Step 7: Typecheck, lint, test**

Run (in `app/`): `npm run typecheck && npm run lint && npm run test:run`
Expected: all green. `grep -rn "administerBc\|bc_assignments\|holderId" src --include=*.ts --include=*.tsx` prints nothing.

- [ ] **Step 8: Commit**

```bash
git add -A app/src
git commit -m "feat(app): Administrare BC retired; the Deals team is two places BC sets (R47)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Part A docs — ruling R47, glossary, deals doc, CLAUDE.md

**Files:**

- Modify: `docs/superpowers/plans/2026-09-23-prod-readiness-grill.md:75` (R44 row) and a new row after line 77; `CONTEXT.md:27-29`; `docs/backend/deals.md`; `docs/README.md:20`; `CLAUDE.md:10`

- [ ] **Step 1: The ruling**

In `docs/superpowers/plans/2026-09-23-prod-readiness-grill.md`, append to the end of the R44 row's text cell (before its closing `|`): ` **Superseded in part by R47 (2026-10-11): nobody holds an Atribuție; see R47.**` Then add a new table row after R46:

```
| R47 | **Atribuții held by every BC member (2026-10-11).** After a BC meeting, Alex: "All of BC members should be able to do all the specific actions, it means that this button should disappear and by default they will be able to do anything. OSUBB Deals will remain as a separate page, but only the BCE and Responsabil will be selected, thing that can be done by any BC/Moderator." **Every BC member and the Moderator hold every Atribuție's powers by default; nobody is its holder.** R44's holder, the checkboxes, the move and the dissolve are retired, and so is Administrare BC. OSUBB Deals keeps its page under Administrare: any BC member or the Moderator picks the **Coordonator** (a live BCE member) and the **Responsabil** (any live active Member); the Coordonator keeps every power except picking the Coordonator (Alex: "the coordinator still have their powers"); the Responsabil publishes Deals and manages their own; nothing dissolves the team. Who sees the page: every BC member, the Moderator, the Coordonator and the Responsabil (who still sees only that page in Administrare). The three placeholder Atribuții (Pagina Interne, Anunțuri Educaționale, Anunțuri de Tineret, #1030–#1032) follow the same shape: BC-wide powers, optionally a team, never a holder. The Echipa panel shows the two places on one row without hints. Spec: `docs/superpowers/specs/2026-10-11-bc-powers-task-copies-bars-design.md`. | backend; frontend; page-administrare |
```

- [ ] **Step 2: The glossary**

In `CONTEXT.md` replace the _Atribuție_ entry (the paragraph under `**Atribuție** (BC Assignment):`, keeping the `_Avoid_` line) with:

```
A named BC responsibility area, independent of Roles and Group positions (ruling R44, 2026-10-07, amended by R47 on 2026-10-11). Every BC member and the Moderator hold its powers by default; nobody is its holder. The first is OSUBB Deals: any BC member or the Moderator picks a Coordonator (a BCE member) and a Responsabil (any active Member); the Coordonator can do everything except pick the Coordonator; the Responsabil publishes Deals and manages their own. Nothing dissolves the team.
```

- [ ] **Step 3: The deals doc**

In `docs/backend/deals.md`:

- first paragraph: after `20261008090000_moderator_deals_team.sql` carries R44's amendment …`, add `; \`20261011120000_atributii_held_by_bc.sql\` carries R47 (2026-10-11): every BC member and the Moderator hold every Atribuție's powers, nobody is a holder.`
- replace the whole `## Atribuții (R44)` section (heading through the **Capabilities** paragraph) with:

```markdown
## Atribuții (R44, R47)

An Atribuție is a named BC responsibility area. Since R47 (2026-10-11) **every live BC member (level 6) and the Moderator (level 9) hold every Atribuție's powers by default; nobody is its holder.** The only one today is `osubb_deals`, **OSUBB Deals**; adding another is a new value in `assignment_team_assignment_ck`, in `set_assignment_team_member_impl`'s step-1 list and in `private.assignment_label`.

| Object                                                                      | What it is                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.assignment_team`                                                    | The team: at most one `coordinator` and one `responsible` (primary key `(assignment, team_role)`), never one person twice; `assignment` is checked against the known Atribuții. Readable by every live Member; no direct writes.                                              |
| `public.set_assignment_team_member(p_assignment, p_team_role, p_member_id)` | BC and the Moderator set either place; the Coordonator sets only the Responsabil. A null member clears the place. Serialized per Atribuție by a transaction advisory lock.                                                                                                    |
| `private.assignment_team_role(p_assignment, p_member)`                      | The one live definition: `holder` (any live BC member or the live Moderator -- the word the callers know), `coordinator` (the place and live bce), `responsible` (the place and live activ), or null. Every capability, policy and command reads it; nothing reads the token. |

| Actor (live rows)                      | Publish a Deal | Edit / delete any Deal | Edit / delete own Deal | Set Coordonator | Set Responsabil |
| -------------------------------------- | -------------- | ---------------------- | ---------------------- | --------------- | --------------- |
| Moderator (9) or BC member (6)         | yes            | yes                    | yes                    | yes             | yes             |
| Coordonator (live 5, in the place)     | yes            | yes                    | yes                    | no              | yes             |
| Responsabil (live activ, in the place) | yes            | no                     | yes                    | no              | no              |
| anyone else                            | no             | no                     | no                     | no              | no              |

**Setting a place.** A Coordonator must be live bce (`PT400 coordinator_not_bce`), a Responsabil a live activ Member (`invalid_team_member`); the member of the other place is refused (`assignment_team_duplicate`); naming the current member again changes nothing. **Notifications** (kind `system`): the member set hears "Ești acum Coordonator/Responsabil OSUBB Deals" (`/administrare/deals`), the one replaced or cleared "Nu mai ești Coordonator/Responsabil OSUBB Deals". R44's holder table (`bc_assignments`), `set_bc_assignment`, `bc_assignments_directory` and the grant/withdraw notifications were dropped by R47; the team rows survived the migration (only their foreign key went).

**Capabilities** (`public.my_capabilities()`, mapped in `app/src/lib/capabilities.ts`): `manage_deals` (any Deals power), `manage_deals_team` (BC, the Moderator, the Coordonator), `pick_deals_coordinator` (BC, the Moderator); `administer` is also true for `manage_deals`, so a Responsabil reaches Administrare with only the OSUBB Deals tab. `administer_bc` no longer exists.
```

- in `## OSUBB Deals (R45)`, **Publish**: replace `a place in the OSUBB Deals team (the Moderator has the holder's)` with `any Deals power (BC, the Moderator, the Coordonator, the Responsabil)`; **Edit and delete**: replace `BC and the Moderator (live level ≥ 6) and the holder and Coordonator any Deal` with `BC, the Moderator and the Coordonator any Deal`, and delete `Leftover Deals of a dissolved team stay deletable by BC and the Moderator.`
- `## Error reasons` table: `42501` row becomes `assignment_team_forbidden`, `deal_code_forbidden`; `PT400` row loses `bc_assignment_not_bc`, `granted_required`; the `PT409` row becomes `—` (no reason) or is deleted.
- `## Tests`: replace `supabase/tests/bc_assignments.test.sql` with `supabase/tests/assignment_team.test.sql`.

- [ ] **Step 4: README, CLAUDE.md**

`docs/README.md` line 20: the summary becomes `The server contract of R44–R47: the OSUBB Deals team (every BC member and the Moderator hold every Atribuție's powers since R47), the Deal kind, its read, edit and fan-out rules and the Deal Code reveal, and up to five Attached Links with the old single pair mirrored for one release.`

`CLAUDE.md` line 10 (the "Groups Waves 1–2" status bullet): append the sentence ` **Atribuții are BC-wide since 2026-10-11 (ruling R47):** every BC member and the Moderator hold every Atribuție's powers, nobody is a holder, Administrare BC is gone; the OSUBB Deals team (Coordonator, Responsabil) is set by any BC member or the Moderator.`

- [ ] **Step 5: Commit**

```bash
git add docs CONTEXT.md CLAUDE.md
git commit -m "docs: ruling R47 -- every BC member holds every Atribuție

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Part B backend — the `create_tasks` suite (red)

**Files:**

- Create: `supabase/tests/create_tasks.test.sql`

**Interfaces:**

- Consumes: `supabase/tests/_group_task_fixtures.psql` (personas `pg_temp.g521_uid(n)`: 1 bc and manager everywhere, 3/4/5 voluntari in `Project #521`, 12 vot (level 3); `pg_temp.g521_task(name, origin, executor, status, mode, kind)`; temp table `g521_tasks(name, id)`).
- Produces: the contract Task 6 implements: `public.create_tasks(p_title, p_description, p_deadline, p_audience, p_assignment_mode, p_executor_ids uuid[] default null, p_campaign_id, p_parent_task_id, p_kind default 'task', p_group_id, p_links default '[]', p_copies integer default 1) returns setof public.tasks`.

- [ ] **Step 1: Write the suite**

Create `supabase/tests/create_tasks.test.sql`:

```sql
-- create_tasks (spec 2026-10-11, Part B): n identical copies of a Task,
-- Subtask or (n = 1 only) Umbrella in ONE transaction -- all exist or none.
-- The body loops private.create_task_impl, so every rule of create_task holds
-- per copy; this suite pins the count and executor rules, the atomicity, the
-- daily cap counted per copy, and that no lock of its own is taken.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(33);
\ir _group_task_fixtures.psql

create function pg_temp.project() returns bigint language sql stable as $$
  select id from public.groups where name = 'Project #521'
$$;
grant execute on function pg_temp.project() to authenticated;

-- ==================== API surface ====================
select ok(not has_function_privilege('anon',
  'public.create_tasks(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer)', 'execute'),
  'anon cannot execute create_tasks');
select ok(has_function_privilege('authenticated',
  'public.create_tasks(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer)', 'execute'),
  'authenticated executes create_tasks; the gate is inside');
select is((select prosecdef from pg_proc where proname = 'create_tasks'
            and pronamespace = 'public'::regnamespace), false,
  'the wrapper is security invoker');
select is((select prosecdef from pg_proc where proname = 'create_tasks_impl'
            and pronamespace = 'private'::regnamespace), true,
  'the body is security definer');
select ok((select proconfig @> array['search_path='] from pg_proc where proname = 'create_tasks_impl'
            and pronamespace = 'private'::regnamespace),
  'the body pins an empty search_path');
select is((select proretset from pg_proc where proname = 'create_tasks'
            and pronamespace = 'public'::regnamespace), true,
  'create_tasks returns a set: the created rows');
select ok(pg_get_functiondef('private.create_tasks_impl(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer)'::regprocedure)
          !~* 'for update',
  'create_tasks_impl takes no row lock of its own: the Umbrella lock is create_task_impl''s For No Key Update');

-- ==================== Step 1: malformed before the gate ====================
select pg_temp.test_clear_jwt();
set local role authenticated;
select throws_ok($$select count(*) from public.create_tasks('Zero', null, now() + interval '7 days', 'local', 'public',
  p_group_id => pg_temp.project(), p_copies => 0)$$,
  'PT400', 'invalid_copies', 'a count of zero is malformed for every caller: refused before the gate');
reset role;

select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select throws_ok($$select count(*) from public.create_tasks('Nul', null, now() + interval '7 days', 'local', 'public',
  p_group_id => pg_temp.project(), p_copies => null)$$,
  'PT400', 'invalid_copies', 'a null count is refused');
select throws_ok($$select count(*) from public.create_tasks('Prea multe', null, now() + interval '7 days', 'local', 'public',
  p_group_id => pg_temp.project(), p_copies => 21)$$,
  'PT400', 'too_many_copies', 'twenty-one copies are too many');
select throws_ok($$select count(*) from public.create_tasks('Umbrela dubla', null, null, null, null,
  p_kind => 'umbrella', p_group_id => pg_temp.project(), p_copies => 2)$$,
  'PT400', 'invalid_copies', 'an Umbrella has no copies');
select throws_ok($$select count(*) from public.create_tasks('Public cu executori', null, now() + interval '7 days', 'local', 'public',
  p_executor_ids => array[pg_temp.g521_uid(3)], p_group_id => pg_temp.project(), p_copies => 1)$$,
  'PT400', 'invalid_executors', 'a public Task takes no executors');
select throws_ok($$select count(*) from public.create_tasks('Doi din trei', null, now() + interval '7 days', 'local', 'direct',
  p_executor_ids => array[pg_temp.g521_uid(3), pg_temp.g521_uid(4)], p_group_id => pg_temp.project(), p_copies => 3)$$,
  'PT400', 'invalid_executors', 'a direct Task takes exactly one executor entry per copy');
reset role;
select is((select count(*) from public.tasks where title in ('Zero', 'Nul', 'Prea multe', 'Umbrela dubla', 'Public cu executori', 'Doi din trei'))::int, 0,
  'a refused call creates nothing');

-- ==================== Three public copies ====================
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select is((select count(*) from public.create_tasks('Trei publice #47', 'd', now() + interval '7 days', 'local', 'public',
  p_group_id => pg_temp.project(), p_copies => 3))::int, 3,
  'three public copies come back as three rows');
reset role;
select is((select count(*) from public.tasks where title = 'Trei publice #47'
            and status = 'todo' and assignment_mode = 'public' and queue_opened_at is not null
            and group_id = pg_temp.project())::int, 3,
  'three todo Tasks with open Candidate Queues in the Group');
select is((select count(*) from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Trei publice #47' and activity.kind = 'created')::int, 3,
  'one created activity row per copy');
select is((select count(*) from public.notifications as notification
             join public.tasks as task on task.id = notification.task_id
            where task.title = 'Trei publice #47')::int, 0,
  'a public copy notifies nobody, like a public Task');

-- ==================== Three direct copies, three Executors ====================
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select is((select count(*) from public.create_tasks('Trei directe #47', 'd', now() + interval '7 days', 'local', 'direct',
  p_executor_ids => array[pg_temp.g521_uid(3), pg_temp.g521_uid(4), pg_temp.g521_uid(5)],
  p_group_id => pg_temp.project(), p_copies => 3))::int, 3,
  'three direct copies come back as three rows');
reset role;
select set_eq(
  $$ select assignment.member_id from public.task_assignments as assignment
       join public.tasks as task on task.id = assignment.task_id
      where task.title = 'Trei directe #47' and assignment.ended_at is null $$,
  $$ values (pg_temp.g521_uid(3)), (pg_temp.g521_uid(4)), (pg_temp.g521_uid(5)) $$,
  'each copy has its own Executor, in order');
select is((select count(*) from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Trei directe #47')::int, 6,
  'two activity rows per direct copy: created and executor_assigned');
select set_eq(
  $$ select notification.member_id from public.notifications as notification
       join public.tasks as task on task.id = notification.task_id
      where task.title = 'Trei directe #47' $$,
  $$ values (pg_temp.g521_uid(3)), (pg_temp.g521_uid(4)), (pg_temp.g521_uid(5)) $$,
  'each Executor is told once: "Task nou"');

-- A null entry leaves that copy unassigned, as a direct Task may start today.
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select is((select count(*) from public.create_tasks('Unul liber #47', 'd', now() + interval '7 days', 'local', 'direct',
  p_executor_ids => array[pg_temp.g521_uid(3), null],
  p_group_id => pg_temp.project(), p_copies => 2))::int, 2,
  'two direct copies, one of them unassigned');
reset role;
select is((select count(*) from public.task_assignments as assignment
             join public.tasks as task on task.id = assignment.task_id
            where task.title = 'Unul liber #47')::int, 1,
  'only the named copy has an Executor');

-- ==================== Subtasks under one Umbrella ====================
select pg_temp.g521_task('umbrela47', 'project', null, 'todo', 'direct', 'umbrella');
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select is((select count(*) from public.create_tasks('Trei subtaskuri #47', 'd', now() + interval '7 days', 'local', 'public',
  p_parent_task_id => (select id from g521_tasks where name = 'umbrela47'), p_copies => 3))::int, 3,
  'three Subtasks under one Umbrella');
reset role;
select is((select count(*) from public.tasks where title = 'Trei subtaskuri #47'
            and parent_task_id = (select id from g521_tasks where name = 'umbrela47')
            and group_id = pg_temp.project())::int, 3,
  'each Subtask names the Umbrella and inherits its Group');

-- ==================== Atomicity ====================
-- Rolled-back settings fixture: the Project now asks for level 3, which the
-- voluntari (3, 4, 5) lack and the vot member (12) has.
update public.groups set min_level = 3, application_level = 3 where id = pg_temp.project();
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select throws_ok($$select count(*) from public.create_tasks('Al treilea cade #47', 'd', now() + interval '7 days', 'local', 'direct',
  p_executor_ids => array[pg_temp.g521_uid(12), pg_temp.g521_uid(12), pg_temp.g521_uid(5)],
  p_group_id => pg_temp.project(), p_copies => 3)$$,
  'PT400', 'invalid_executor', 'one Executor below the Minimum Level refuses the whole call');
select throws_ok($$select count(*) from public.create_tasks('Necunoscut #47', 'd', now() + interval '7 days', 'local', 'direct',
  p_executor_ids => array[pg_temp.g521_uid(12), '00000000-0000-0000-0000-00000000dead'::uuid],
  p_group_id => pg_temp.project(), p_copies => 2)$$,
  'PT400', 'invalid_executor', 'an id that is no profile at all refuses the whole call');
reset role;
select is((select count(*) from public.tasks where title in ('Al treilea cade #47', 'Necunoscut #47'))::int, 0,
  'nothing of a refused batch exists: no Task');
select is((select count(*) from public.notifications where title in ('Task nou: Al treilea cade #47', 'Task nou: Necunoscut #47'))::int, 0,
  'and no notification');
update public.groups set min_level = 0, application_level = 0 where id = pg_temp.project();

-- ==================== The daily cap, counted per copy ====================
insert into public.task_activity (task_id, kind, actor_id)
select (select id from g521_tasks where name = 'umbrela47'), 'created', pg_temp.g521_uid(1)
  from generate_series(1, 99 - (select count(*)::int from public.task_activity
                                  where actor_id = pg_temp.g521_uid(1) and kind = 'created'));
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select throws_ok($$select count(*) from public.create_tasks('Plafon 101 #47', 'd', now() + interval '7 days', 'local', 'public',
  p_group_id => pg_temp.project(), p_copies => 2)$$,
  'PT409', 'rate_limited', 'two copies with one slot left: the second hits the cap and the first rolls back too');
select is((select count(*) from public.create_tasks('Plafon 100 #47', 'd', now() + interval '7 days', 'local', 'public',
  p_group_id => pg_temp.project(), p_copies => 1))::int, 1,
  'one copy still fits: the hundredth creation of the day');
reset role;
select is((select count(*) from public.tasks where title = 'Plafon 101 #47')::int, 0,
  'the refused pair left nothing behind');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it, confirm red**

Run: `npx supabase test db supabase/tests/create_tasks.test.sql`
Expected: FAIL — `function public.create_tasks(...) does not exist`. If pgTAP reports a plan mismatch once the function exists (Task 6), set `plan(33)` to the number it reports.

- [ ] **Step 3: Commit the red suite**

```bash
git add supabase/tests/create_tasks.test.sql
git commit -m "test(db): create_tasks -- n copies in one transaction (red)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Part B backend — the migration, rosters, smoke, ADR and conventions (green)

**Files:**

- Create: `supabase/migrations/20261011121000_create_tasks.sql`
- Modify: `supabase/tests/tracker_grants.test.sql` (wrapper roster after `create_task`, private roster after `create_task_impl`, the count pin), `scripts/smoke-tracker-commands.sql` (after step 1), `docs/adr/0007-task-tracker-lifecycle.md:108`, `docs/backend/conventions.md` (§3, before `## 4. Grants and RLS`)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261011121000_create_tasks.sql`:

```sql
-- Task copies (spec 2026-10-11, Part B; Alex: "I want to be able to create a
-- custom number of duplicate tasks ... when a direct task is created n number
-- of times, a new popup should appear that requires the executors"). One
-- atomic command: public.create_tasks takes what create_task takes, a list of
-- Executors instead of one, and a count; private.create_tasks_impl loops the
-- existing create body once per copy inside the one transaction, so all n
-- copies exist or none. Every rule of create_task holds per copy: the gate,
-- Group authority, shape and audience, the Executor's Minimum Level, the
-- Umbrella parent lock (FOR NO KEY UPDATE, re-taken harmlessly per copy), the
-- task_create daily cap (one slot per copy) and one "Task nou" notification per
-- assigned Executor. public.create_task is untouched.

create function private.create_tasks_impl(
  p_title text, p_description text, p_deadline timestamp with time zone,
  p_audience text, p_assignment_mode text, p_executor_ids uuid[],
  p_campaign_id bigint, p_parent_task_id bigint, p_kind text, p_group_id bigint,
  p_links jsonb, p_copies integer)
returns setof public.tasks
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_executors uuid[] := coalesce(p_executor_ids, '{}'::uuid[]);
  v_given     integer := coalesce(array_length(v_executors, 1), 0);
  v_task      public.tasks%rowtype;
  i           integer;
begin
  -- 1. Malformed for every caller (conventions section 2: before the gate).
  if p_copies is null or p_copies < 1 then
    raise sqlstate 'PT400' using message = 'invalid_copies';
  end if;
  if p_copies > 20 then
    raise sqlstate 'PT400' using message = 'too_many_copies';
  end if;
  if p_kind = 'umbrella' and p_copies > 1 then
    raise sqlstate 'PT400' using message = 'invalid_copies';
  end if;
  if p_assignment_mode = 'public' and v_given > 0 then
    raise sqlstate 'PT400' using message = 'invalid_executors';
  end if;
  if p_assignment_mode = 'direct' and v_given > 0 and v_given <> p_copies then
    raise sqlstate 'PT400' using message = 'invalid_executors';
  end if;

  -- 2. One create per copy, in creation order, in this one transaction. A
  --    null entry (or no list at all) leaves that copy unassigned, as a
  --    direct Task may start today. The legacy link pair is never sent.
  for i in 1..p_copies loop
    v_task := private.create_task_impl(
      p_title, p_description, p_deadline, p_audience, p_assignment_mode,
      case when v_given > 0 then v_executors[i] end,
      p_campaign_id, p_parent_task_id, p_kind, p_group_id,
      null, null, p_links);
    return next v_task;
  end loop;
  return;
end;
$$;

comment on function private.create_tasks_impl(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer) is
  'Body of public.create_tasks: p_copies identical Tasks (or Subtasks of one Umbrella; an Umbrella itself allows one copy) in one transaction, each through private.create_task_impl, so every create_task rule holds per copy and one refusal rolls back all. Step 1: PT400 invalid_copies (null, below 1, or above 1 for an Umbrella), too_many_copies (above 20), invalid_executors (any executors on a public Task; a direct list whose length is not p_copies). A direct copy''s Executor is p_executor_ids[i]; a null entry or no list leaves it unassigned. Each copy spends one task_create slot and notifies its Executor once ("Task nou").';

create function public.create_tasks(
  p_title text, p_description text, p_deadline timestamp with time zone,
  p_audience text, p_assignment_mode text,
  p_executor_ids uuid[] default null,
  p_campaign_id bigint default null, p_parent_task_id bigint default null,
  p_kind text default 'task', p_group_id bigint default null,
  p_links jsonb default '[]'::jsonb,
  p_copies integer default 1)
returns setof public.tasks
language sql
set search_path to ''
as $$
  select * from private.create_tasks_impl(p_title, p_description, p_deadline, p_audience, p_assignment_mode,
                                          p_executor_ids, p_campaign_id, p_parent_task_id, p_kind, p_group_id,
                                          p_links, p_copies);
$$;

comment on function public.create_tasks(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer) is
  'Creates p_copies (1..20) identical Tasks -- or Subtasks of the Umbrella p_parent_task_id -- atomically, returning the rows in creation order; the arguments are create_task''s with p_executor_ids (one entry per direct copy, null entries allowed) in place of p_executor_id and no legacy link pair. Reasons of its own: PT400 invalid_copies, too_many_copies, invalid_executors; every other reason is create_task''s, per copy.';

revoke execute on function private.create_tasks_impl(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.create_tasks(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.create_tasks_impl(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer) to authenticated;
grant execute on function public.create_tasks(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer) to authenticated;
```

- [ ] **Step 2: Rosters**

In `supabase/tests/tracker_grants.test.sql`:

- after the `('create_task', …)` wrapper row add
  ```sql
  -- Task copies (spec 2026-10-11): n copies in one transaction, same wrapper shape.
  ('create_tasks',       'p_title text, p_description text, p_deadline timestamp with time zone, p_audience text, p_assignment_mode text, p_executor_ids uuid[], p_campaign_id bigint, p_parent_task_id bigint, p_kind text, p_group_id bigint, p_links jsonb, p_copies integer',
                                                                     false, true,  false, false),
  ```
- after the `('create_task_impl', …)` private row add
  ```sql
  ('create_tasks_impl',                           'p_title text, p_description text, p_deadline timestamp with time zone, p_audience text, p_assignment_mode text, p_executor_ids uuid[], p_campaign_id bigint, p_parent_task_id bigint, p_kind text, p_group_id bigint, p_links jsonb, p_copies integer', 'impl'),
  ```
- the private count pin becomes `219` (218 after Task 2, plus one).

- [ ] **Step 3: Smoke, ADR, conventions**

In `scripts/smoke-tracker-commands.sql`, right after the `step 1: create_task left a todo public Task …` assertion block, add:

```sql
-- ==================== step 1b: two public copies at once ====================

select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000007');
select count(*) as copies_made from public.create_tasks(
  p_title           => 'SMOKE Exemplare publice',
  p_description     => 'Doua copii create de smoke-test.sql',
  p_deadline        => now() + interval '30 days',
  p_group_id        => :edu_group,
  p_audience        => 'local',
  p_assignment_mode => 'public',
  p_copies          => 2) \gset
reset role;

select pg_temp.smoke_assert(
  (:copies_made = 2 and (select count(*) = 2 from public.tasks
    where title = 'SMOKE Exemplare publice' and status = 'todo' and queue_opened_at is not null)),
  'step 1b: create_tasks left two identical todo public Tasks with open queues');
```

In `docs/adr/0007-task-tracker-lifecycle.md`, in the command list after `create_task`, add the line `create_tasks         (n identical copies, or n Subtasks of one Umbrella, in one transaction; one Executor per direct copy; spec 2026-10-11)`.

In `docs/backend/conventions.md`, insert before `## 4. Grants and RLS`:

```markdown
**Task copies (`create_tasks`, spec 2026-10-11) add three step-1 reasons.** `invalid_copies` (a null count, below 1, or above 1 for an Umbrella), `too_many_copies` (above 20; the `too_many_links` shape) and `invalid_executors` (any executors on a public Task, or a direct list whose length is not the count). Every other refusal is `create_task`'s, raised per copy inside the one transaction, so one bad copy rolls back all of them; the `task_create` cap is spent once per copy.
```

- [ ] **Step 4: Rebuild, run everything, run the smoke**

Run: `npx supabase db reset && npx supabase test db`
Expected: all green, `create_tasks.test.sql` included (fix its `plan(N)` if pgTAP reports a different count).

Run: `bash scripts/smoke-tracker-commands.sh`
Expected: every step passes, step 1b included. (If the script requires a reset first, it says so; follow it.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261011121000_create_tasks.sql supabase/tests/tracker_grants.test.sql supabase/tests/create_tasks.test.sql scripts/smoke-tracker-commands.sql docs/adr/0007-task-tracker-lifecycle.md docs/backend/conventions.md
git commit -m "feat(db): create_tasks -- n identical copies in one transaction

Loops private.create_task_impl once per copy so every create_task rule holds
per copy and one refusal rolls back all; one Executor per direct copy; counts
1..20; three step-1 reasons.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Part B frontend — the draft gains `copies`; the mutation calls `create_tasks`

**Files:**

- Modify: `app/src/lib/schemas/task.ts`, `app/src/screens/tracker/task-form-model.ts`, `app/src/queries/task-umbrella.ts`, `app/src/lib/command-reasons.ts`, `app/src/lib/database.types.ts` (generated)
- Test: `app/src/queries/task-umbrella.test.ts`

**Interfaces:**

- Consumes: `public.create_tasks` from Task 6 (`Database['public']['Functions']['create_tasks']` after `npm run gen:types`).
- Produces: `TaskDraft.copies: number`; `TaskFormValues.copies: string`; `MAX_TASK_COPIES = 20`; `createTasksArgs({ draft, executorIds? })`; `createTasks(input): Promise<Task[]>`; `useCreateTasks()`; reasons `invalid_copies`, `too_many_copies`, `invalid_executors` with copy.

- [ ] **Step 1: Regenerate types**

Run (in `app/`): `npm run gen:types`
Expected: `database.types.ts` gains `create_tasks` under `Functions` with `Args` including `p_copies?: number` and `p_executor_ids?: string[]`, `Returns: Tasks[]`.

- [ ] **Step 2: Write the failing mutation tests**

In `app/src/queries/task-umbrella.test.ts`, add `copies: 1` to the `draft` literal, change the import to also take `createTasksArgs, createTasks`, and append:

```ts
describe("create_tasks arguments", () => {
  it("sends one Executor as a one-entry list for a single direct Task", () => {
    expect(
      createTasksArgs({
        draft: {
          ...draft,
          parentTaskId: null,
          assignmentMode: "direct",
          audience: "local",
          executorId: "executor-1",
        },
      }),
    ).toMatchObject({ p_executor_ids: ["executor-1"], p_copies: 1 });
  });
  it("sends the dialog’s Executors, one per copy, for n direct copies", () => {
    expect(
      createTasksArgs({
        draft: {
          ...draft,
          assignmentMode: "direct",
          audience: "local",
          copies: 3,
        },
        executorIds: ["a", "b", "c"],
      }),
    ).toMatchObject({ p_executor_ids: ["a", "b", "c"], p_copies: 3 });
  });
  it("sends no Executors for public copies, whatever the form held", () => {
    expect(
      createTasksArgs({ draft: { ...draft, copies: 4, executorId: "stale" } }),
    ).toMatchObject({
      p_executor_ids: null,
      p_copies: 4,
      p_assignment_mode: "public",
    });
  });
  it("calls create_tasks and returns the rows", async () => {
    rpc.mockResolvedValue({ data: [{ id: 1 }, { id: 2 }], error: null });
    await expect(
      createTasks({ draft: { ...draft, copies: 2 } }),
    ).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    expect(rpc).toHaveBeenLastCalledWith(
      "create_tasks",
      expect.objectContaining({ p_copies: 2, p_executor_ids: null }),
    );
  });
});
```

Run (in `app/`): `npx vitest run src/queries/task-umbrella.test.ts`
Expected: FAIL — `createTasksArgs` is not exported; `copies` is not a known property.

- [ ] **Step 3: The schema**

In `app/src/lib/schemas/task.ts`:

- after the imports add `export const MAX_TASK_COPIES = 20;`
- in `taskDraftSchema`'s `z.object({ … })` add `copies: z.number(),` after `campaignId`;
- in `superRefine`, before `const umbrella = draft.kind === 'umbrella';` add:
  ```ts
  // Task copies (spec 2026-10-11): 1 to 20; an Umbrella has exactly one.
  if (!Number.isInteger(draft.copies) || draft.copies < 1)
    issue("copies", "invalid_copies");
  else if (draft.copies > MAX_TASK_COPIES) issue("copies", "too_many_copies");
  else if (draft.kind === "umbrella" && draft.copies !== 1)
    issue("copies", "invalid_copies");
  ```
- in `fieldForReason` add, after `umbrella_has_no_campaign: 'campaignId',`:

  ```ts
  // Task copies (spec 2026-10-11).
  invalid_copies: 'copies',
  too_many_copies: 'copies',
  invalid_executors: 'executorId',
  ```

- [ ] **Step 4: The model**

In `app/src/screens/tracker/task-form-model.ts`:

- `TaskDraft` gains `/** How many identical Tasks to create at once (1–20; 1 for an Umbrella). */ copies: number;` after `campaignId`;
- `TaskFormValues` gains `/** "Exemplare" as typed; the schema judges it. */ copies: string;` after `campaignId`;
- in `taskDraftInput`'s returned object, add after `campaignId: …`:

  ```ts
  copies: umbrella
    ? 1
    : values.copies.trim() === ''
      ? Number.NaN
      : Number(values.copies),
  ```

  and change the `executorId` entry to

  ```ts
  // With more than one copy the Executors come from the dialog, not the form.
  executorId:
    !umbrella &&
    values.assignmentMode === 'direct' &&
    !(Number(values.copies) > 1)
      ? values.executorId
      : null,
  ```

- [ ] **Step 5: The mutation**

In `app/src/queries/task-umbrella.ts` add after `createTask`:

```ts
/** What the Tracker sends `create_tasks`: the draft, plus the dialog's Executors for n direct copies. */
export type CreateTasksInput = {
  draft: TaskDraft;
  /** One Executor per copy, from the executors dialog; only for direct copies above one. */
  executorIds?: readonly string[];
};

/**
 * `create_tasks`' arguments (spec 2026-10-11): a single direct Task sends its
 * one Executor as a one-entry list, n direct copies send the dialog's list,
 * anything public or an Umbrella sends none.
 */
export function createTasksArgs({ draft, executorIds }: CreateTasksInput) {
  const direct = draft.assignmentMode === "direct";
  const executors = !direct
    ? null
    : draft.copies > 1
      ? [...(executorIds ?? [])]
      : draft.executorId
        ? [draft.executorId]
        : null;
  return {
    p_group_id: draft.groupId,
    p_kind: draft.kind,
    p_parent_task_id: draft.parentTaskId,
    p_executor_ids: executors,
    p_campaign_id: draft.campaignId,
    p_audience: draft.audience,
    p_assignment_mode: draft.assignmentMode,
    p_title: draft.title,
    p_description: draft.description,
    p_deadline: draft.deadline,
    p_links: draft.links,
    p_copies: draft.copies,
  };
}

/** The Tracker's one create path: n copies (n = 1 included) in one transaction. */
export async function createTasks(input: CreateTasksInput) {
  if (input.draft.kind === "umbrella" && input.draft.parentTaskId !== null)
    throw new Error("An Umbrella cannot be a Subtask");
  const { data, error } = await supabase.rpc(
    "create_tasks",
    createTasksArgs(
      input,
    ) as unknown as Database["public"]["Functions"]["create_tasks"]["Args"],
  );
  if (error) throw error;
  return data;
}

export function useCreateTasks() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: createTasks,
    onSettled: () => client.invalidateQueries({ queryKey: keys.tasks.all }),
  });
}
```

Keep `createTask`, `createTaskMutationOptions` and `useCreateTask` as they are (the smoke script and existing tests use the single command).

- [ ] **Step 6: The copy**

In `app/src/lib/command-reasons.ts` add, after the `rate_limited` entry:

```ts
/* ---- Task copies (spec 2026-10-11) ---- */
['invalid_copies', 'Numărul de exemplare nu e valid: între 1 și 20.'],
['too_many_copies', 'Cel mult 20 de exemplare odată.'],
['invalid_executors', 'Alege câte un executor pentru fiecare exemplar.'],
```

- [ ] **Step 7: Run, fix every literal, commit**

Run (in `app/`): `npm run typecheck`
Expected: errors only where a `TaskDraft` literal lacks `copies` (tests such as `task-umbrella.test.ts`, `TaskForm.test.tsx` fixtures, `UmbrellaTaskSection.test.tsx`). Add `copies: 1` to each. Then:

Run (in `app/`): `npm run typecheck && npm run lint && npx vitest run src/queries/task-umbrella.test.ts src/lib/schemas`
Expected: PASS.

```bash
git add app/src
git commit -m "feat(app): a Task draft carries its copy count; createTasks calls create_tasks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Part B frontend — the "Exemplare" field

**Files:**

- Modify: `app/src/screens/tracker/TaskForm.tsx`, `app/src/screens/tracker/ManagedTaskForm.tsx`
- Test: `app/src/screens/tracker/TaskForm.test.tsx`

**Interfaces:**

- Consumes: Task 7's `TaskFormValues.copies`, `MAX_TASK_COPIES`, `fieldForReason`.
- Produces: `TaskForm` props `plural?: 'taskuri' | 'subtaskuri'` (default `'taskuri'`); the submit button reads `submitLabel` at one copy, `Creează n <plural>` for public copies, `Continuă` for direct copies; the in-form Executor picker is hidden for direct copies above one. `ManagedTaskForm` passes `plural` through.

- [ ] **Step 1: Write the failing form tests**

Append to `app/src/screens/tracker/TaskForm.test.tsx` (reuse its `options`, `chooseOrigin`, `DEADLINE`, `pickDate` helpers; the `onDraft` mock pattern of the file's other cases):

```tsx
it("offers Exemplare to a Task, not to an Umbrella, and labels the button by the count", async () => {
  const user = userEvent.setup();
  render(
    <TaskForm
      options={options}
      onDraft={vi.fn()}
      submitLabel="Creează taskul"
    />,
  );
  const copies = screen.getByLabelText("Exemplare");
  expect(copies).toHaveValue(1);
  expect(copies).toHaveAttribute("max", "20");
  expect(
    screen.getByRole("button", { name: "Creează taskul" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "Public" }));
  await user.clear(copies);
  await user.type(copies, "3");
  expect(
    screen.getByRole("button", { name: "Creează 3 taskuri" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "Task-umbrelă" }));
  expect(screen.queryByLabelText("Exemplare")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Creează taskul" }),
  ).toBeInTheDocument();
});

it("hands direct copies to the next step: no Executor picker, the button says Continuă", async () => {
  const user = userEvent.setup();
  const onDraft = vi.fn();
  render(
    <TaskForm
      options={options}
      onDraft={onDraft}
      submitLabel="Creează taskul"
    />,
  );
  await chooseOrigin(user, "Tineret");
  expect(
    screen.getByRole("combobox", { name: "Executor" }),
  ).toBeInTheDocument();
  const copies = screen.getByLabelText("Exemplare");
  await user.clear(copies);
  await user.type(copies, "2");
  expect(screen.queryByRole("combobox", { name: "Executor" })).toBeNull();
  expect(screen.getByText(/Executorii se aleg la pasul următor/)).toBeVisible();
  await user.type(screen.getByLabelText("Titlu"), "Două afișe");
  await pickDate(user, screen.getByLabelText(/Termen/), DEADLINE);
  await user.click(screen.getByRole("button", { name: "Continuă" }));
  await waitFor(() => expect(onDraft).toHaveBeenCalledTimes(1));
  expect(onDraft.mock.calls[0]?.[0]).toMatchObject({
    copies: 2,
    assignmentMode: "direct",
    executorId: null,
  });
});

it.each([
  ["", "Numărul de exemplare nu e valid"],
  ["abc", "Numărul de exemplare nu e valid"],
  ["2.5", "Numărul de exemplare nu e valid"],
  ["0", "Numărul de exemplare nu e valid"],
  ["21", "Cel mult 20 de exemplare"],
])('refuses "%s" copies in the browser', async (typed, message) => {
  const user = userEvent.setup();
  const onDraft = vi.fn();
  render(
    <TaskForm
      options={options}
      onDraft={onDraft}
      submitLabel="Creează taskul"
    />,
  );
  await chooseOrigin(user, "Tineret");
  await user.type(screen.getByLabelText("Titlu"), "Fără număr");
  await pickDate(user, screen.getByLabelText(/Termen/), DEADLINE);
  const copies = screen.getByLabelText("Exemplare");
  await user.clear(copies);
  if (typed) fireEvent.change(copies, { target: { value: typed } });
  await user.click(screen.getByRole("button", { name: /Creează|Continuă/ }));
  expect(await screen.findByText(new RegExp(message))).toBeVisible();
  expect(onDraft).not.toHaveBeenCalled();
});
```

(If the file's `TaskForm` renders need a `QueryClientProvider` or other wrapper in the existing cases, use the same wrapper. The Executor picker's accessible name is the `label` the selector renders — "Executor".)

Run (in `app/`): `npx vitest run src/screens/tracker/TaskForm.test.tsx`
Expected: FAIL — no field labelled "Exemplare".

- [ ] **Step 2: The field**

In `app/src/screens/tracker/TaskForm.tsx`:

- import `MAX_TASK_COPIES` from `'../../lib/schemas/task'` (same line as `fieldForReason, taskDraftSchema`);
- add the prop `plural = 'taskuri',` to the destructured props with the type `/** The noun the button counts: "subtaskuri" under an Umbrella. */ plural?: 'taskuri' | 'subtaskuri';`;
- add `copies: '1',` to the initial `values`;
- after `const lockedToParent = parentTaskId !== null;` add:
  ```tsx
  const copies = Number(values.copies);
  // Above one copy the Executors are chosen at the next step, one per copy.
  const manyCopies = Number.isInteger(copies) && copies > 1;
  const label =
    !umbrella && manyCopies
      ? values.assignmentMode === "direct"
        ? "Continuă"
        : `Creează ${copies} ${plural}`
      : submitLabel;
  ```
- add after the `COPIES` constants at the top of the file:
  ```tsx
  const COPIES_INFO =
    "Creează mai multe taskuri identice odată, până la 20. Pentru un task direct alegi câte un executor pentru fiecare exemplar la pasul următor.";
  ```
- inside the `!umbrella && (<>…</>)` fragment, right after `<AssignmentModeField … />`, insert:
  ```tsx
  <div className="grid gap-1.5">
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={`${id}-copies`} className="text-sm font-medium">
        Exemplare
      </label>
      <InfoHint label="Despre exemplare" id={`${id}-copies-info`}>
        {COPIES_INFO}
      </InfoHint>
    </div>
    <Input
      id={`${id}-copies`}
      type="number"
      min="1"
      max={MAX_TASK_COPIES}
      step="1"
      inputMode="numeric"
      className="w-28"
      value={values.copies}
      onChange={(event) => update({ copies: event.target.value })}
      {...form.field("copies", `${id}-copies-info`)}
    />
    <FieldError {...form.errorProps("copies")} />
  </div>
  ```
- change the Executor block to
  ```tsx
  {
    values.assignmentMode === "direct" && origin && !manyCopies && (
      <div className="grid gap-1.5" {...form.slot("executorId")}>
        <DirectExecutorSelector
          originGroupId={origin.id}
          value={values.executorId}
          onChange={(executorId) => update({ executorId })}
        />
        <FieldError {...form.errorProps("executorId")} />
      </div>
    );
  }
  {
    values.assignmentMode === "direct" && manyCopies && (
      <p className="text-sm text-muted-foreground" {...form.slot("executorId")}>
        Executorii se aleg la pasul următor, câte unul pentru fiecare exemplar.
      </p>
    );
  }
  ```
- change `<Button type="submit">{submitLabel}</Button>` to `<Button type="submit">{label}</Button>`.

In `app/src/screens/tracker/ManagedTaskForm.tsx` add the prop `plural,` (type `plural?: 'taskuri' | 'subtaskuri';`) and pass `plural={plural}` to `<TaskForm …>`.

- [ ] **Step 3: Run, commit**

Run (in `app/`): `npm run typecheck && npm run lint && npx vitest run src/screens/tracker/TaskForm.test.tsx src/screens/tracker/NewTaskControl.test.tsx`
Expected: `TaskForm.test.tsx` PASS. `NewTaskControl.test.tsx` may still pass (it calls `create_task`); it is rewritten in Task 10.

```bash
git add app/src/screens/tracker/TaskForm.tsx app/src/screens/tracker/ManagedTaskForm.tsx app/src/screens/tracker/TaskForm.test.tsx
git commit -m "feat(app): \"Exemplare\" on the Task form -- the count, the button, the next step

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Part B frontend — the executors dialog

**Files:**

- Create: `app/src/screens/tracker/CopiesExecutorsDialog.tsx`, `app/src/screens/tracker/CopiesExecutorsDialog.test.tsx`
- Modify: `app/src/screens/tracker/DirectExecutorSelector.tsx`

**Interfaces:**

- Consumes: `DirectExecutorSelector`, `Dialog*` from `components/ui/dialog`, `Button`.
- Produces: `DirectExecutorSelector` props `label?: string` (default `'Executor'`) and `excludeIds?: readonly string[]`; `CopiesExecutorsDialog({ count, originGroupId, plural, busy, error, onBack, onConfirm })` — mounted only while needed, always open; `EXECUTORS_REQUIRED` copy constant.

- [ ] **Step 1: Write the failing dialog tests**

Create `app/src/screens/tracker/CopiesExecutorsDialog.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/supabase", () => ({ supabase: {} }));
vi.mock("./DirectExecutorSelector", () => ({
  DirectExecutorSelector: ({
    label,
    value,
    excludeIds,
    onChange,
  }: {
    label: string;
    value: string | null;
    excludeIds?: readonly string[];
    onChange: (id: string | null) => void;
  }) => (
    <div data-testid="picker" data-excluded={(excludeIds ?? []).join(",")}>
      <span>{label}</span>
      <button type="button" onClick={() => onChange(`${label}-ales`)}>
        {value ? `${label}: ${value}` : `Alege pentru ${label}`}
      </button>
    </div>
  ),
}));
import { CopiesExecutorsDialog } from "./CopiesExecutorsDialog";

function renderDialog(
  overrides: Partial<Parameters<typeof CopiesExecutorsDialog>[0]> = {},
) {
  const props = {
    count: 3,
    originGroupId: 4,
    plural: "taskuri" as const,
    busy: false,
    error: null,
    onBack: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
  render(<CopiesExecutorsDialog {...props} />);
  return { ...props, user: userEvent.setup() };
}

describe("the executors of n Tasks", () => {
  it("asks for one Executor per copy, titled by the count", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog", {
      name: "Executorii celor 3 taskuri",
    });
    expect(dialog).toHaveAccessibleDescription(
      "Alege câte un executor pentru fiecare exemplar.",
    );
    expect(screen.getAllByTestId("picker")).toHaveLength(3);
    expect(within(dialog).getByText("Exemplarul 1")).toBeVisible();
    expect(within(dialog).getByText("Exemplarul 3")).toBeVisible();
    expect(
      within(dialog)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(expect.arrayContaining(["Înapoi", "Creează 3 taskuri"]));
  });

  it("keeps a chosen Member out of the other pickers", async () => {
    const { user } = renderDialog({ count: 2 });
    await user.click(
      screen.getByRole("button", { name: "Alege pentru Exemplarul 1" }),
    );
    const [first, second] = screen.getAllByTestId("picker");
    expect(first).toHaveAttribute("data-excluded", "");
    expect(second).toHaveAttribute("data-excluded", "Exemplarul 1-ales");
  });

  it("refuses to create until every copy has an Executor, then confirms with the list", async () => {
    const { user, onConfirm } = renderDialog({ count: 2 });
    await user.click(screen.getByRole("button", { name: "Creează 2 taskuri" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Alege câte un executor pentru fiecare exemplar.",
    );
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Alege pentru Exemplarul 1" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Alege pentru Exemplarul 2" }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Creează 2 taskuri" }));
    expect(onConfirm).toHaveBeenCalledWith([
      "Exemplarul 1-ales",
      "Exemplarul 2-ales",
    ]);
  });

  it("shows the server’s refusal and goes back on Înapoi or Escape", async () => {
    const { user, onBack } = renderDialog({
      error: "Executorul nu mai este eligibil.",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Executorul nu mai este eligibil.",
    );
    await user.click(screen.getByRole("button", { name: "Înapoi" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it("is full screen on a phone and disables its buttons while busy", () => {
    renderDialog({ busy: true });
    expect(screen.getByRole("dialog").className).toContain(
      "max-sm:h-(--visible-height)",
    );
    expect(screen.getByRole("button", { name: "Înapoi" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Se creează…" })).toBeDisabled();
  });
});
```

Run (in `app/`): `npx vitest run src/screens/tracker/CopiesExecutorsDialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 2: Extend the executor picker**

In `app/src/screens/tracker/DirectExecutorSelector.tsx`:

- props: add `/** The field's label; "Exemplarul 2" in the executors dialog. */ label = 'Executor',` and `/** Members already chosen for another copy: not offered here. */ excludeIds = [],` with types `label?: string; excludeIds?: readonly string[];`;
- after `const [groupId, setGroupId] = useState<number | null>(null);` add
  ```tsx
  const excludedKey = excludeIds.join(",");
  const excluded = useMemo(
    () => new Set(excludedKey ? excludedKey.split(",") : []),
    [excludedKey],
  );
  ```
- change the `eligible` memo to
  ```tsx
  const eligible = useMemo(
    () =>
      data
        ? eligibleExecutors(data, originGroupId).filter(
            (member) => member.id === value || !excluded.has(member.id),
          )
        : [],
    [data, originGroupId, excluded, value],
  );
  ```
- change `const filtered = filterExecutors(data, originGroupId, groupId);` to
  ```tsx
  const filtered = filterExecutors(data, originGroupId, groupId).filter(
    (member) => member.id === value || !excluded.has(member.id),
  );
  ```
- change the label text `Executor` inside `<label id={`${id}-member`} …>` to `{label}`.

- [ ] **Step 3: The dialog**

Create `app/src/screens/tracker/CopiesExecutorsDialog.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { DirectExecutorSelector } from "./DirectExecutorSelector";

/** The same words the server uses for `invalid_executors`. */
export const EXECUTORS_REQUIRED =
  "Alege câte un executor pentru fiecare exemplar.";

/**
 * The second step of n direct copies (spec 2026-10-11): one Executor per
 * copy, all required, a Member chosen for one copy not offered for another.
 * Mounted only while the step is on: its state starts afresh each time.
 * Full screen on a phone; Înapoi (or Escape) returns to the form with the
 * draft intact; a server refusal is shown here.
 */
export function CopiesExecutorsDialog({
  count,
  originGroupId,
  plural,
  busy,
  error,
  onBack,
  onConfirm,
}: {
  count: number;
  originGroupId: number;
  plural: "taskuri" | "subtaskuri";
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: (executorIds: string[]) => void;
}) {
  const [ids, setIds] = useState<(string | null)[]>(() =>
    Array.from({ length: count }, () => null),
  );
  const [missing, setMissing] = useState(false);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (ids.some((id) => id === null)) {
      setMissing(true);
      return;
    }
    setMissing(false);
    onConfirm(ids.filter((id): id is string => id !== null));
  }
  const shown = missing ? EXECUTORS_REQUIRED : error;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onBack();
      }}
    >
      <DialogContent fullScreenOnPhone className="sm:max-w-lg">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              Executorii celor {count} {plural}
            </DialogTitle>
            <DialogDescription>{EXECUTORS_REQUIRED}</DialogDescription>
          </DialogHeader>
          <ol className="m-0 grid list-none gap-5 p-0">
            {ids.map((id, index) => (
              // The list is fixed at mount: the index is the copy's number.
              // eslint-disable-next-line react/no-array-index-key
              <li key={index} className="grid gap-1.5">
                <DirectExecutorSelector
                  label={`Exemplarul ${index + 1}`}
                  originGroupId={originGroupId}
                  value={id}
                  excludeIds={ids.filter(
                    (other, position): other is string =>
                      position !== index && other !== null,
                  )}
                  onChange={(next) => {
                    setIds((current) =>
                      current.map((value, position) =>
                        position === index ? next : value,
                      ),
                    );
                    setMissing(false);
                  }}
                  disabled={busy}
                />
              </li>
            ))}
          </ol>
          {shown && (
            <p role="alert" className="text-sm text-destructive">
              {shown}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onBack}
            >
              Înapoi
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Se creează…" : `Creează ${count} ${plural}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

(If `oxlint` does not know the `react/no-array-index-key` rule, drop that comment line.)

- [ ] **Step 4: Run, commit**

Run (in `app/`): `npm run typecheck && npm run lint && npx vitest run src/screens/tracker/CopiesExecutorsDialog.test.tsx src/screens/tracker/DirectExecutorSelector.test.tsx`
Expected: PASS (the selector's existing tests still pass with the default label).

```bash
git add app/src/screens/tracker/CopiesExecutorsDialog.tsx app/src/screens/tracker/CopiesExecutorsDialog.test.tsx app/src/screens/tracker/DirectExecutorSelector.tsx
git commit -m "feat(app): the executors dialog -- one Executor per direct copy

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Part B frontend — the two-step flow and the plural receipts

**Files:**

- Modify: `app/src/screens/tracker/NewTaskControl.tsx`, `app/src/screens/tracker/UmbrellaTaskSection.tsx:19-160`, `app/src/screens/tracker/TrackerScreen.tsx:249-262,436-462,488-494`, `DESIGN.md:119-121`
- Test: `app/src/screens/tracker/NewTaskControl.test.tsx`, `app/src/screens/tracker/UmbrellaTaskSection.test.tsx`

**Interfaces:**

- Consumes: `useCreateTasks`, `CreateTasksInput` (Task 7), `CopiesExecutorsDialog` (Task 9), `commandErrorMessage` from `lib/command-reasons`, `TaskActionSuccess` (already imported in `TrackerScreen`).
- Produces: `NewTaskControl` prop `onCreated: (created: { ids: number[] }) => void`; `TrackerScreen` state `createdMany: { key: number; receipt: string } | null`.

- [ ] **Step 1: Rewrite the New Task tests (red)**

In `app/src/screens/tracker/NewTaskControl.test.tsx`:

- the `DirectExecutorSelector` mock gains `label = 'Executor'` and renders `{value ? `${label} ales: ${value}`:`Alege ${label}`}`, choosing `'executor-1'` when `label === 'Executor'` and `` `${label}-ales` `` otherwise:
  ```tsx
  vi.mock("./DirectExecutorSelector", () => ({
    DirectExecutorSelector: ({
      label = "Executor",
      value,
      onChange,
    }: {
      label?: string;
      value: string | null;
      onChange: (id: string | null) => void;
    }) => (
      <button
        type="button"
        onClick={() =>
          onChange(label === "Executor" ? "executor-1" : `${label}-ales`)
        }
      >
        {value ? `${label} ales: ${value}` : `Alege ${label}`}
      </button>
    ),
  }));
  ```
- every `screen.getByRole('button', { name: 'Alege Executorul' })` becomes `{ name: 'Alege Executor' }`, and `'Executor ales: executor-1'` stays as is;
- every `state.rpc.mockResolvedValue({ data: { id: N }, error: null })` becomes `{ data: [{ id: N }], error: null }` and every `expect(onCreated).toHaveBeenCalledWith(N)` becomes `toHaveBeenCalledWith({ ids: [N] })`;
- the direct-Task case expects `'create_tasks'` with `p_executor_ids: ['executor-1']` (instead of `p_executor_id`) and `p_copies: 1`; the public case's `toMatchObject` uses `p_executor_ids: null, p_copies: 1`; the Umbrella case's `toEqual` uses `p_executor_ids: null` and `p_copies: 1` in place of `p_executor_id: null`;
- append:

```tsx
it("creates three public copies and reports them without opening one", async () => {
  state.rpc.mockResolvedValue({
    data: [{ id: 51 }, { id: 52 }, { id: 53 }],
    error: null,
  });
  const { user, onCreated } = renderControl();
  await openDialog(user);
  await pickOrigin(user);
  await fillContent(user, "Voluntari la trei standuri");
  await user.click(screen.getByRole("radio", { name: "Public" }));
  const copies = screen.getByLabelText("Exemplare");
  await user.clear(copies);
  await user.type(copies, "3");
  await user.click(screen.getByRole("button", { name: "Creează 3 taskuri" }));
  await waitFor(() =>
    expect(onCreated).toHaveBeenCalledWith({ ids: [51, 52, 53] }),
  );
  expect(state.rpc.mock.calls[0]?.[1]).toMatchObject({
    p_copies: 3,
    p_executor_ids: null,
    p_assignment_mode: "public",
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("asks for one Executor per direct copy, then creates them all at once", async () => {
  state.rpc.mockResolvedValue({ data: [{ id: 61 }, { id: 62 }], error: null });
  const { user, onCreated } = renderControl();
  await openDialog(user);
  await pickOrigin(user);
  await fillContent(user, "Două afișe");
  const copies = screen.getByLabelText("Exemplare");
  await user.clear(copies);
  await user.type(copies, "2");
  expect(screen.queryByRole("button", { name: "Alege Executor" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Continuă" }));
  const step = await screen.findByRole("dialog", {
    name: "Executorii celor 2 taskuri",
  });
  expect(state.rpc).not.toHaveBeenCalled();
  await user.click(
    within(step).getByRole("button", { name: "Alege Exemplarul 1" }),
  );
  await user.click(
    within(step).getByRole("button", { name: "Alege Exemplarul 2" }),
  );
  await user.click(
    within(step).getByRole("button", { name: "Creează 2 taskuri" }),
  );
  await waitFor(() =>
    expect(onCreated).toHaveBeenCalledWith({ ids: [61, 62] }),
  );
  expect(state.rpc).toHaveBeenCalledWith(
    "create_tasks",
    expect.objectContaining({
      p_copies: 2,
      p_assignment_mode: "direct",
      p_executor_ids: ["Exemplarul 1-ales", "Exemplarul 2-ales"],
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("returns to the form with the draft intact when the executors step is dismissed", async () => {
  const { user, onCreated } = renderControl();
  await openDialog(user);
  await pickOrigin(user);
  await fillContent(user, "Draft cu două exemplare");
  const copies = screen.getByLabelText("Exemplare");
  await user.clear(copies);
  await user.type(copies, "2");
  await user.click(screen.getByRole("button", { name: "Continuă" }));
  await screen.findByRole("dialog", { name: "Executorii celor 2 taskuri" });
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: /Executorii/ })).toBeNull(),
  );
  expect(screen.getByRole("dialog", { name: "Task nou" })).toBeVisible();
  expect(screen.getByLabelText("Titlu")).toHaveValue("Draft cu două exemplare");
  expect(screen.getByLabelText("Exemplare")).toHaveValue(2);
  expect(state.rpc).not.toHaveBeenCalled();
  expect(onCreated).not.toHaveBeenCalled();
});

it("shows a refusal inside the executors step and keeps it open", async () => {
  state.rpc.mockResolvedValue({
    data: null,
    error: { code: "PT400", message: "invalid_executor" },
  });
  const { user } = renderControl();
  await openDialog(user);
  await pickOrigin(user);
  await fillContent(user, "Refuzat");
  const copies = screen.getByLabelText("Exemplare");
  await user.clear(copies);
  await user.type(copies, "2");
  await user.click(screen.getByRole("button", { name: "Continuă" }));
  const step = await screen.findByRole("dialog", {
    name: "Executorii celor 2 taskuri",
  });
  await user.click(
    within(step).getByRole("button", { name: "Alege Exemplarul 1" }),
  );
  await user.click(
    within(step).getByRole("button", { name: "Alege Exemplarul 2" }),
  );
  await user.click(
    within(step).getByRole("button", { name: "Creează 2 taskuri" }),
  );
  expect(await within(step).findByRole("alert")).toHaveTextContent(
    "Executorul nu mai este eligibil",
  );
  expect(
    screen.getByRole("dialog", { name: "Executorii celor 2 taskuri" }),
  ).toBeVisible();
});
```

Run (in `app/`): `npx vitest run src/screens/tracker/NewTaskControl.test.tsx`
Expected: FAIL (still `create_task`, `onCreated(41)`).

- [ ] **Step 2: Rewrite `NewTaskControl`**

Replace `app/src/screens/tracker/NewTaskControl.tsx` with:

```tsx
import { useRef, useState } from "react";
import { PlusIcon } from "lucide-react";
import { FabAction } from "../../components/layout";
import { FormSheet } from "../../components/ui/form-sheet";
import { commandErrorMessage } from "../../lib/command-reasons";
import { useTaskManagement } from "../../queries/task-tabs";
import {
  useCreateTasks,
  type CreateTasksInput,
} from "../../queries/task-umbrella";
import { CopiesExecutorsDialog } from "./CopiesExecutorsDialog";
import { ManagedTaskForm } from "./ManagedTaskForm";
import type { TaskDraft } from "./task-form-model";

export type TasksCreated = { ids: number[] };

/**
 * "Task nou": a top-level Task or Umbrella, for a member who manages work in
 * some Group (the same `can_manage_tasks()` read the Campanii entry uses).
 * Hidden while that read loads or fails; `create_tasks` stays authoritative.
 * The form opens in a form sheet; n direct copies add a second step, the
 * executors dialog, before anything is created (spec 2026-10-11).
 */
export function NewTaskControl({
  onCreated,
}: {
  onCreated: (created: TasksCreated) => void;
}) {
  const management = useTaskManagement();
  if (management.data !== true) return null;
  return <NewTaskDialog onCreated={onCreated} />;
}

function NewTaskDialog({
  onCreated,
}: {
  onCreated: (created: TasksCreated) => void;
}) {
  const create = useCreateTasks();
  const [open, setOpen] = useState(false);
  // Each opening starts from an empty draft; a refusal keeps the current one.
  const [attempt, setAttempt] = useState(0);
  // A direct draft with several copies waits here for its Executors.
  const [pendingDraft, setPendingDraft] = useState<TaskDraft | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  // After a Task opens, focus belongs to its details, not this button.
  const created = useRef(false);
  async function finish(input: CreateTasksInput) {
    const tasks = await create.mutateAsync(input);
    created.current = tasks.length === 1;
    setPendingDraft(null);
    setOpen(false);
    onCreated({ ids: tasks.map((task) => task.id) });
  }
  return (
    <>
      <FabAction
        label="Task nou"
        icon={PlusIcon}
        onSelect={() => {
          created.current = false;
          setAttempt((current) => current + 1);
          setOpen(true);
        }}
      />
      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title="Task nou"
        busy={create.isPending}
        finalFocus={() => !created.current}
        className="sm:max-w-2xl"
      >
        <ManagedTaskForm
          key={attempt}
          allowSubtask={false}
          heading={null}
          submitLabel="Creează taskul"
          pendingLabel="Se creează taskul…"
          onCancel={() => {
            if (!create.isPending) setOpen(false);
          }}
          onDraft={async (draft) => {
            if (draft.assignmentMode === "direct" && draft.copies > 1) {
              setStepError(null);
              setPendingDraft(draft);
              return;
            }
            await finish({ draft });
          }}
        />
      </FormSheet>
      {pendingDraft && (
        <CopiesExecutorsDialog
          count={pendingDraft.copies}
          originGroupId={pendingDraft.groupId}
          plural="taskuri"
          busy={create.isPending}
          error={stepError}
          onBack={() => setPendingDraft(null)}
          onConfirm={async (executorIds) => {
            setStepError(null);
            try {
              await finish({ draft: pendingDraft, executorIds });
            } catch (failure) {
              setStepError(
                commandErrorMessage(
                  failure,
                  "Nu am putut crea taskurile. Încearcă din nou.",
                ),
              );
            }
          }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: The Umbrella section**

In `app/src/screens/tracker/UmbrellaTaskSection.tsx`:

- imports: replace `useCreateTask` with `useCreateTasks, type CreateTasksInput`; add `import { CopiesExecutorsDialog } from './CopiesExecutorsDialog';` and `import type { TaskDraft } from './task-form-model';`;
- `const create = useCreateTask();` becomes `const create = useCreateTasks();`;
- add state after `const [done, setDone] = useState(false);`:
  ```tsx
  // n Subtasks at once: the receipt stays on the Umbrella (no details open).
  const [added, setAdded] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<TaskDraft | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  ```
- add after `closeForm`:
  ```tsx
  async function finish(input: CreateTasksInput) {
    const tasks = await create.mutateAsync(input);
    if (!mounted.current) return;
    setPendingDraft(null);
    setAdding(false);
    const [first] = tasks;
    if (tasks.length === 1 && first) {
      created.current = true;
      onNavigate(first.id);
    } else {
      setAdded(`${tasks.length} subtaskuri create.`);
    }
  }
  ```
- render `{added && <p role="status">{added}</p>}` right after `{done && …}`;
- pass `plural="subtaskuri"` to `<ManagedTaskForm …>` and replace its `onDraft` with:
  ```tsx
  onDraft={async (draft) => {
    if (
      !mounted.current ||
      attempt !== formAttempt.current ||
      isTerminalTask(currentStatus.current)
    )
      return;
    setAdded(null);
    if (draft.assignmentMode === 'direct' && draft.copies > 1) {
      setStepError(null);
      setPendingDraft(draft);
      return;
    }
    await finish({ draft });
  }}
  ```
- after the `</FormSheet>` add:
  ```tsx
  {
    pendingDraft && (
      <CopiesExecutorsDialog
        count={pendingDraft.copies}
        originGroupId={pendingDraft.groupId}
        plural="subtaskuri"
        busy={create.isPending}
        error={stepError}
        onBack={() => setPendingDraft(null)}
        onConfirm={async (executorIds) => {
          setStepError(null);
          try {
            await finish({ draft: pendingDraft, executorIds });
          } catch (failure) {
            setStepError(
              commandErrorMessage(
                failure,
                "Nu am putut crea subtaskurile. Încearcă din nou.",
              ),
            );
          }
        }}
      />
    );
  }
  ```
- in `UmbrellaTaskSection.test.tsx`, the mock `useCreateTask: () => ({ mutateAsync: create, isPending: false })` becomes `useCreateTasks: () => ({ mutateAsync: create, isPending: false })`, and every `create.mockResolvedValue({ id: N })` becomes `create.mockResolvedValue([{ id: N }])`; the mocked `ManagedTaskForm`'s button sends `{ parentTaskId, title: 'Copil nou', copies: 1, assignmentMode: 'public' }`. Add one case:

  ```tsx
  it("reports several Subtasks on the Umbrella instead of opening one", async () => {
    create.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const onNavigate = vi.fn();
    render(
      <UmbrellaTaskSection {...common} onNavigate={onNavigate} subtasks={[]} />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Adaugă subtask" }));
    await act(async () => {
      form.onDraft({
        parentTaskId: 10,
        title: "Copil nou",
        copies: 2,
        assignmentMode: "public",
      });
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "2 subtaskuri create.",
    );
    expect(onNavigate).not.toHaveBeenCalled();
  });
  ```

- [ ] **Step 4: The Tracker receipt**

In `app/src/screens/tracker/TrackerScreen.tsx`:

- after the `deleted` state add
  ```tsx
  // Several Tasks created at once (spec 2026-10-11): the list says so; no
  // details sheet opens. Keyed so a second batch announces itself afresh.
  const [createdMany, setCreatedMany] = useState<{
    key: number;
    receipt: string;
  } | null>(null);
  ```
- replace the `NewTaskControl` `onCreated` handler with
  ```tsx
  onCreated={({ ids }) => {
    const [only] = ids;
    if (ids.length === 1 && only !== undefined) {
      setCreated({ id: only, notice: 'Taskul a fost creat.' });
      setDetailId(only);
      return;
    }
    setCreatedMany({ key: Date.now(), receipt: `${ids.length} taskuri create.` });
  }}
  ```
- next to the `deleted` receipt (`{view === 'taskuri' && deleted !== null && (…)}`) add

  ```tsx
  {
    view === "taskuri" && createdMany !== null && (
      <TaskActionSuccess key={createdMany.key}>
        {createdMany.receipt}
      </TaskActionSuccess>
    );
  }
  ```

- [ ] **Step 5: DESIGN.md**

In `DESIGN.md` rule 1, change `A _dialog_ confirms or asks for a reason — three fields at most.` to `A _dialog_ confirms or asks for a reason — three fields at most, or one like field per copy (the Executors of n Tasks).`

- [ ] **Step 6: Run everything, commit**

Run (in `app/`): `npm run typecheck && npm run lint && npm run test:run`
Expected: PASS. If `TrackerScreen.test.tsx` asserts the `onCreated` shape, update it to `{ ids: [id] }`.

```bash
git add app/src DESIGN.md
git commit -m "feat(app): n Task copies from the form -- executors step for direct ones, plural receipts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Part C — both tab tracks scroll sideways, look unchanged

**Files:**

- Create: `app/src/components/layout/tab-scroll.ts`, `app/src/components/layout/tab-scroll.test.ts`, `app/src/components/shell/TabBar.test.tsx`
- Modify: `app/src/components/layout/PageTabs.tsx`, `app/src/components/shell/TabBar.tsx`, `DESIGN.md:215`
- Test: `app/src/components/layout/PageTabs.test.tsx`

**Interfaces:**

- Produces: `scrollTabIntoView(track, tab, smooth)` (pure), `useScrollCurrentTabIntoView(trackRef, selector)` (runs on every route change); `tabListClass` and `tabClass` gain the overflow and no-shrink classes; `tabLabelsFrom[*].label` loses `truncate`.

- [ ] **Step 1: Failing tests — the pure scroll rule**

Create `app/src/components/layout/tab-scroll.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { scrollTabIntoView } from "./tab-scroll";

function track(scrollLeft: number, clientWidth: number) {
  return {
    scrollLeft,
    clientWidth,
    scrollTo: vi.fn(),
  } as unknown as HTMLElement & {
    scrollTo: ReturnType<typeof vi.fn>;
  };
}
const tab = (offsetLeft: number, offsetWidth: number) =>
  ({ offsetLeft, offsetWidth }) as unknown as HTMLElement;

describe("scrollTabIntoView", () => {
  it("leaves a tab already in view where it is", () => {
    const t = track(0, 300);
    scrollTabIntoView(t, tab(40, 80), false);
    expect(t.scrollLeft).toBe(0);
    expect(t.scrollTo).not.toHaveBeenCalled();
  });
  it("brings a tab cut off on the right to the right edge", () => {
    const t = track(0, 300);
    scrollTabIntoView(t, tab(260, 100), false);
    expect(t.scrollLeft).toBe(60);
  });
  it("brings a tab hidden on the left to the left edge", () => {
    const t = track(200, 300);
    scrollTabIntoView(t, tab(50, 80), false);
    expect(t.scrollLeft).toBe(50);
  });
  it("animates when motion is allowed and the element can scroll smoothly", () => {
    const t = track(0, 300);
    scrollTabIntoView(t, tab(260, 100), true);
    expect(t.scrollTo).toHaveBeenCalledWith({ left: 60, behavior: "smooth" });
  });
});
```

Append to `app/src/components/layout/PageTabs.test.tsx`:

```tsx
it("scrolls sideways when its tabs do not fit, with no scrollbar and no shrinking tabs", () => {
  render(
    <MemoryRouter>
      <PageTabs label="Secțiuni" tabs={tabs} />
    </MemoryRouter>,
  );
  const nav = screen.getByRole("navigation", { name: "Secțiuni" });
  expect(nav).toHaveClass(
    "overflow-x-auto",
    "[scrollbar-width:none]",
    "[&::-webkit-scrollbar]:hidden",
  );
  for (const link of screen.getAllByRole("link"))
    expect(link).toHaveClass("shrink-0");
  // Labels never truncate any more: the track scrolls instead.
  for (const size of Object.values(tabLabelsFrom))
    expect(size.label).not.toContain("truncate");
});
```

Create `app/src/components/shell/TabBar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Home, ListTodo, Calendar, Megaphone, ShieldCheck } from "lucide-react";
import { TabBar } from "./TabBar";
import type { NavItem } from "./navItems";

const tabs: NavItem[] = [
  { path: "/tracker", label: "Taskuri", icon: ListTodo },
  { path: "/calendar", label: "Calendar", icon: Calendar },
  { path: "/", label: "Acasă", icon: Home },
  { path: "/anunturi", label: "Anunțuri", icon: Megaphone },
  {
    path: "/administrare",
    label: "Administrare",
    shortLabel: "Admin",
    icon: ShieldCheck,
  },
] as NavItem[];

/** jsdom lays nothing out: the track's overflow is whatever the test says. */
function trackOverflows(by: number) {
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(300);
  vi.spyOn(Element.prototype, "scrollWidth", "get").mockReturnValue(300 + by);
}
afterEach(() => vi.restoreAllMocks());

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TabBar tabs={tabs} badges={{}} />
    </MemoryRouter>,
  );
}
const track = () =>
  screen.getByRole("navigation", { name: "Navigare rapidă" })
    .firstElementChild as HTMLElement;

describe("the phone bar: fit first, scroll last", () => {
  it("spells the current tab’s full name when the five fit", () => {
    trackOverflows(0);
    renderAt("/administrare");
    expect(screen.getByRole("link", { name: "Administrare" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("Administrare")).toBeVisible();
    expect(track()).toHaveClass("overflow-x-auto", "[scrollbar-width:none]");
  });
  it("falls back to the short name when the full one overflows the track", () => {
    trackOverflows(40);
    renderAt("/administrare");
    expect(screen.getByText("Admin")).toBeVisible();
    expect(screen.queryByText("Administrare")).toBeNull();
  });
  it("keeps the short name and lets the bar scroll when even that overflows", () => {
    trackOverflows(400);
    renderAt("/administrare");
    expect(screen.getByText("Admin")).toBeVisible();
  });
  it("shows a short name only to the current tab: a page outside the five changes nothing", () => {
    trackOverflows(400);
    expect(() => renderAt("/profil")).not.toThrow();
    for (const name of [
      "Taskuri",
      "Calendar",
      "Acasă",
      "Anunțuri",
      "Administrare",
    ])
      expect(screen.getByRole("link", { name })).not.toHaveAttribute(
        "aria-current",
      );
    expect(screen.queryByText("Admin")).toBeNull();
  });
});
```

(If `NavItem` requires more fields than the literals above, add them with the values `navItems.ts` uses; the shape that matters is `path`, `label`, `shortLabel`, `icon`.)

Run (in `app/`): `npx vitest run src/components/layout src/components/shell/TabBar.test.tsx`
Expected: FAIL — `tab-scroll` missing; overflow classes missing; the short-name case still measures the label, not the track.

- [ ] **Step 2: The hook**

Create `app/src/components/layout/tab-scroll.ts`:

```ts
import { useEffect, type RefObject } from "react";
import { useLocation } from "react-router";

/**
 * Bring one tab fully into its track's view by moving the track's own
 * scroll position — never the page's. Nothing happens when it already fits.
 */
export function scrollTabIntoView(
  track: HTMLElement,
  tab: HTMLElement,
  smooth: boolean,
) {
  const left = tab.offsetLeft;
  const right = left + tab.offsetWidth;
  const viewLeft = track.scrollLeft;
  const viewRight = viewLeft + track.clientWidth;
  const next =
    left < viewLeft
      ? left
      : right > viewRight
        ? right - track.clientWidth
        : null;
  if (next === null) return;
  if (smooth && typeof track.scrollTo === "function")
    track.scrollTo({ left: next, behavior: "smooth" });
  else track.scrollLeft = next;
}

/**
 * After every route change, the tab matching `selector` (the current one) is
 * scrolled into the track's view, smoothly unless the member prefers reduced
 * motion. Both tab tracks use it (DESIGN.md, Navigation).
 */
export function useScrollCurrentTabIntoView(
  track: RefObject<HTMLElement | null>,
  selector: string,
) {
  const { pathname } = useLocation();
  useEffect(() => {
    const root = track.current;
    const current = root?.querySelector<HTMLElement>(selector);
    if (!root || !current) return;
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollTabIntoView(root, current, !reduce);
  }, [track, selector, pathname]);
}
```

- [ ] **Step 3: PageTabs**

In `app/src/components/layout/PageTabs.tsx`:

- replace the file comment's two bullets with:
  ```
   * - The track is as wide as the content column and its tabs share it; it has
   *   no margin of its own (in a `Page` the 24 px gap spaces it).
   * - Tabs never shrink or truncate. When they do not fit, the track scrolls
   *   sideways with no visible scrollbar and the current tab is brought into
   *   view (`useScrollCurrentTabIntoView`). With `tabLabelsFrom`, narrower
   *   screens still collapse the other tabs to icons first; the track scrolls
   *   only when even those overflow.
  ```
- `tabListClass` becomes
  ```ts
  export const tabListClass =
    "relative flex w-full min-w-0 gap-0.5 overflow-x-auto overscroll-x-contain rounded-lg border border-border bg-(--surface-3) p-[3px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
  ```
- in `tabClass` replace `flex-auto` with `flex-auto shrink-0`;
- in `tabLabelsFrom`, every `label` string loses `truncate` (`'min-w-0 truncate'` → `'min-w-0'`, `'min-w-0 truncate max-sm:sr-only …'` → `'min-w-0 max-sm:sr-only …'`, and so on for `md`, `lg`, `xl`, `2xl`);
- import `useScrollCurrentTabIntoView` from `'./tab-scroll'` and call `useScrollCurrentTabIntoView(nav, '[aria-current="page"]');` right after the `useSlidingThumb` line in `PageTabs` (after PR #1041, `nav` is the `track` ref that hook returns; the thumb measuring code the old plan text mentions now lives in `components/ui/sliding-thumb.tsx` and is not touched).

- [ ] **Step 4: TabBar**

In `app/src/components/shell/TabBar.tsx`:

- import `useScrollCurrentTabIntoView` from `'../layout/tab-scroll'`;
- replace the doc comment's last paragraph with:
  ```
   * Fit first, scroll last: the current tab spells its full name if the five
   * fit; if not, its short name (`shortLabel`); only if the five still
   * overflow does the bar scroll sideways, with no scrollbar, the current tab
   * brought into view. A new width starts from the full name again. While a
   * phone keyboard is open the bar steps aside (#1013).
  ```
- in `measure`, replace the label check
  ```ts
  const label = current?.querySelector<HTMLElement>('[data-slot="tab-label"]');
  if (label && label.scrollWidth > label.clientWidth + 1)
    setShortFor(current?.dataset.path ?? null);
  ```
  with
  ```ts
  // The track, not the label, says whether the full name fits: labels no
  // longer clip. Overflowing with the short name already shown changes
  // nothing more -- the bar scrolls.
  const track = bar.current;
  if (current && track && track.scrollWidth > track.clientWidth + 1)
    setShortFor(current.dataset.path ?? null);
  ```
- after the `useEffect` with the `ResizeObserver`, add `useScrollCurrentTabIntoView(bar, '[aria-current="page"]');`
- the track `div`'s className becomes
  ```
  'relative mx-auto flex max-w-md gap-1 overflow-x-auto overscroll-x-contain rounded-full border border-border bg-card p-[5px] shadow-(--sh-md) [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
  ```
- in the `Link`'s `cn(...)`: `current ? 'min-w-0 flex-1 text-(--surface)'` becomes `current ? 'flex-auto shrink-0 text-(--surface)'`; the inactive branch `!current && (active ? 'flex-none' : 'flex-1')` becomes `!current && (active ? 'flex-none' : 'flex-auto shrink-0')`;
- the label span's `current ? 'min-w-0 overflow-hidden text-clip' : 'sr-only'` becomes `current ? 'whitespace-nowrap' : 'sr-only'`.

- [ ] **Step 5: DESIGN.md**

Line 215's third cell becomes: `The one tab look: a pill track with a sliding thumb. Tabs never shrink or truncate: when they do not fit, the track scrolls sideways with no scrollbar and the current tab is brought into view. The phone bar fits first (full name, then \`shortLabel\`) and scrolls last; \`tabLabelsFrom\` still collapses the other tabs to icons on narrow screens before the track scrolls.`

- [ ] **Step 6: Run, commit**

Run (in `app/`): `npm run typecheck && npm run lint && npm run test:run`
Expected: PASS. (`AppShell.test.tsx` may assert the old label classes; align it with the new `whitespace-nowrap`.)

```bash
git add app/src/components DESIGN.md
git commit -m "feat(app): both tab tracks scroll sideways -- fit first, scroll last, look unchanged

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Part D — the date picker popup shows everything

**Files:**

- Modify: `app/src/components/ui/date-picker.tsx:204-213`
- Test: `app/src/components/ui/date-picker.test.tsx`

- [ ] **Step 1: Failing test**

Append to the `describe('DateTimePicker', …)` block in `app/src/components/ui/date-picker.test.tsx` (use the file's existing render-and-open helper; the popup is `role="dialog"` named "Alege data și ora"):

```tsx
it("is always its full height: nothing scrolls inside the popup", async () => {
  const user = userEvent.setup();
  render(<DateTimePicker id="d" value="" onChange={() => undefined} />);
  await user.click(screen.getByRole("button", { name: /Alege data și ora/ }));
  const popup = await screen.findByRole("dialog", {
    name: "Alege data și ora",
  });
  expect(popup.className).not.toMatch(
    /max-h-|overflow-y-auto|overscroll-contain/,
  );
});
```

Run (in `app/`): `npx vitest run src/components/ui/date-picker.test.tsx`
Expected: FAIL — the class list has `max-h-(--available-height) … overflow-y-auto overscroll-contain`.

- [ ] **Step 2: The change**

In `app/src/components/ui/date-picker.tsx`:

- the `Popover.Positioner` gains, after `collisionPadding={12}`:
  ```tsx
  // The popup is always its full height (spec 2026-10-11): it prefers
  // opening under the field and, near the screen's edge, slides along the
  // axis -- over the field if it must -- instead of flipping and being
  // clamped to the room on one side.
  collisionAvoidance={{ side: 'shift', align: 'shift', fallbackAxisSide: 'none' }}
  ```
- the `Popover.Popup` className loses `max-h-(--available-height) `, ` overflow-y-auto overscroll-contain`:

  ```
  'w-[min(20rem,calc(100vw-1.5rem))] origin-(--transform-origin) rounded-lg bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10 transition-[opacity,scale] outline-none motion-reduce:transition-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0'
  ```

- [ ] **Step 3: Run, commit**

Run (in `app/`): `npm run typecheck && npm run lint && npx vitest run src/components/ui/date-picker.test.tsx`
Expected: PASS.

```bash
git add app/src/components/ui/date-picker.tsx app/src/components/ui/date-picker.test.tsx
git commit -m "fix(app): the date picker popup is always its full height

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Final verification

**Files:** none new.

- [ ] **Step 1: Whole-suite gates**

Run: `npx supabase db reset && npx supabase test db`
Expected: green.

Run (in `app/`): `npm run gen:types && git status --short src/lib/database.types.ts`
Expected: no diff (the committed types match the database).

Run (in `app/`): `npm run typecheck && npm run lint && npm run format:check && npm run test:run`
Expected: green. If `format:check` lists files, run `npm run format` and amend the last commit of the part that owns them.

Run: `bash scripts/check-local-ci.sh`
Expected: every gate CI runs passes locally.

- [ ] **Step 2: The dev server, by hand (browser pane, `preview_start app-dev`, signed in as `bc@demo.osubb`)**

- Administrare: no Administrare BC tile. OSUBB Deals: Echipa shows Coordonator and Responsabil on one row, no hints, both pickers enabled for the BC account; change the Responsabil and read the receipt; "Deal nou" is offered.
- Taskuri › Task nou: Exemplare = 3, Public → three identical cards in Disponibile and the receipt "3 taskuri create." on the list, no details sheet.
- Task nou: Exemplare = 2, Direct → "Continuă" opens "Executorii celor 2 taskuri"; pick two different Members; the second picker does not offer the first's choice; create → "2 taskuri create."; each copy shows its Executor.
- An Umbrella's details › Adaugă subtask with Exemplare = 2 → "2 subtaskuri create." on the Umbrella.
- `resize_window` to 320×640: the bottom bar shows "Admin" on Administrare, no horizontal scrollbar; the Administrare tab strip scrolls with the current tab in view; `resize_window preset desktop` afterwards.
- Open a Deal form and the date picker from a field near the bottom of the sheet: the whole calendar, shortcuts, time and Gata are visible, no inner scrollbar.

- [ ] **Step 3: Report**

Summarize per part what shipped and what was verified, list the commits, and hand the branch to Alex for the PR. Do not push unless Alex asks.

---

### Task 14: The copies limit becomes 100 on both sides (red, then green)

Alex, approving Part E: "add a greater limit, like 100 for both options". `create_tasks` and its browser mirror still say 20. The migration `20261011121000_create_tasks.sql` is unmerged (this branch only, never applied to staging), so its body is edited in place rather than replaced by a new migration.

**Files:**

- Modify: `supabase/migrations/20261011121000_create_tasks.sql` (`p_copies > 20` → `> 100`; both comments: `above 20` → `above 100`, `(1..20)` → `(1..100)`), `supabase/tests/create_tasks.test.sql` (the 21 case becomes 101; a new case proves 21 are accepted; `plan(33)` → `plan(34)`), `app/src/lib/schemas/task.ts` (`MAX_TASK_COPIES = 100`), `app/src/lib/schemas/task.test.ts`, `app/src/screens/tracker/TaskForm.tsx` (`COPIES_INFO`: "până la 100"), `app/src/screens/tracker/TaskForm.test.tsx` (`max` is `'100'`), `app/src/lib/command-reasons.ts` ("Cel mult 100 de exemplare odată."), `docs/backend/conventions.md` (the copies paragraph: "above 100"), this plan's Global Constraints line ("Copies: 1 to 100").

**Interfaces:**

- Consumes: Part B as merged (`MAX_TASK_COPIES`, `too_many_copies`).
- Produces: the limit `100` that Task 15's command and Task 16's schema reuse; `MAX_TASK_COPIES` is the one browser constant for both forms.

- [ ] **Step 1: The failing tests**

`supabase/tests/create_tasks.test.sql`: replace the 21 case with

```sql
select throws_ok($$select count(*) from public.create_tasks('Prea multe', null, now() + interval '7 days', 'local', 'public',
  p_group_id => pg_temp.project(), p_copies => 101)$$,
  'PT400', 'too_many_copies', 'a hundred and one copies are too many');
select is((select count(*) from public.create_tasks('Douazeci si unu', null, now() + interval '7 days', 'local', 'public',
  p_group_id => pg_temp.project(), p_copies => 21))::int, 21,
  'twenty-one copies are accepted since the limit became 100 (2026-10-11)');
```

and `plan(33)` → `plan(34)`.

`app/src/lib/schemas/task.test.ts`: where the copies cases live, `copies: 21` → `too_many_copies` becomes `copies: 101`, and a `copies: 21` draft parses with no issue on `copies`; `MAX_TASK_COPIES` is `100`.

`app/src/screens/tracker/TaskForm.test.tsx:749`: `expect(copies).toHaveAttribute('max', '100');`.

Run: `npx supabase test db supabase/tests/create_tasks.test.sql` and, in `app/`, `npx vitest run src/lib/schemas/task.test.ts src/screens/tracker/TaskForm.test.tsx`
Expected: FAIL — 21 copies raise `too_many_copies`; `MAX_TASK_COPIES` is 20; `max` is `'20'`.

- [ ] **Step 2: The code and the words**

The migration body: `if p_copies > 100 then`; its two comments say `above 100` and `(1..100)`. `MAX_TASK_COPIES = 100`. `COPIES_INFO` "…până la 100…". `command-reasons.ts`: `['too_many_copies', 'Cel mult 100 de exemplare odată.']`. `docs/backend/conventions.md`: `too_many_copies` (above 100; …). This plan: "Copies: 1 to 100."

- [ ] **Step 3: Rebuild, run, commit**

Run: `npx supabase db reset && npx supabase test db supabase/tests/create_tasks.test.sql` → 34/34; in `app/`: `npm run typecheck && npm run lint && npx vitest run src/lib/schemas src/screens/tracker/TaskForm.test.tsx` → green.

```bash
git add supabase/migrations/20261011121000_create_tasks.sql supabase/tests/create_tasks.test.sql app/src/lib/schemas/task.ts app/src/lib/schemas/task.test.ts app/src/screens/tracker/TaskForm.tsx app/src/screens/tracker/TaskForm.test.tsx app/src/lib/command-reasons.ts docs/backend/conventions.md docs/superpowers/plans/2026-10-11-bc-powers-task-copies-bars.md docs/superpowers/specs/2026-10-11-bc-powers-task-copies-bars-design.md
git commit -m "feat: the Task copies limit is 100, on the server and in the form

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Part E — Finished Tasks × n (added 2026-10-11, after the Part A/B backend landed)

Alex: "i also want to be able to add finished task for n number of times for n number of people, but make sure to be able to select the same person more than once, it should work as we talked for the duplication before". Spec section "Part E" (appended the same day). Four tasks: the limit raise, then three that reuse Part B's dialog and reasons.

### Task 15: Part E backend — `create_completed_tasks` (red, then green)

**Files:**

- Create: `supabase/tests/create_completed_tasks.test.sql`, `supabase/migrations/20261011123000_create_completed_tasks.sql`
- Modify: `supabase/tests/tracker_grants.test.sql` (wrapper row after `create_completed_task`, impl row after `create_completed_task_impl`, pin 219 → 220), `docs/adr/0007-task-tracker-lifecycle.md` (command list after `create_completed_task`), `docs/backend/conventions.md` (the Task-copies paragraph)

**Interfaces:**

- Consumes: `private.create_completed_task_impl(uuid, bigint, text, text, text, text, bigint, integer, integer, text, jsonb)` from `20261007190000_attached_links_five.sql:799`; the `#915` persona pattern of `completed_work_tasks.test.sql` (`pg_temp.u915`, `pg_temp.g915`, `pg_temp.c915`).
- Produces: `public.create_completed_tasks(p_executor_ids uuid[], p_group_id bigint, p_title text, p_description text, p_campaign_id bigint default null, p_difficulty integer default null, p_rating integer default null, p_note text default null, p_links jsonb default '[]'::jsonb, p_copies integer default 1) returns setof public.tasks`. Step 1: `invalid_copies` (null, below 1), `too_many_copies` (above 100), `invalid_executors` (no list, a list whose length is not `p_copies`, or any null entry: a finished Task always has its Executor). The same Member may appear several times. Loops `private.create_completed_task_impl(v_executors[i], p_group_id, p_title, p_description, null, null, p_campaign_id, p_difficulty, p_rating, p_note, p_links)`; everything else (authority, eligibility, the Evaluation and points, the one "Task evaluat" notification per copy, the `task_create` cap per copy) is inherited.

- [ ] **Step 1: Write the failing suite**

Create `supabase/tests/create_completed_tasks.test.sql`:

```sql
-- create_completed_tasks (spec 2026-10-11, Part E): n finished Tasks for n
-- volunteers in ONE transaction -- the same Member may be credited several
-- times. The body loops private.create_completed_task_impl, so every rule of
-- create_completed_task holds per copy; this suite pins the count and
-- executor rules, the repeat, the atomicity and that nothing of its own is
-- locked. Personas and Groups: the #915 fixture shape, prefix 9470.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(22);

create function pg_temp.u947(n integer) returns uuid language sql immutable as $$
  select ('94700000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
grant execute on function pg_temp.u947(integer) to authenticated, anon;
--  1 bce, Manager of Dept E   2 activ, member of Dept E   3 activ, member of Dept E
--  4 voluntar, member of Dept F (outside)   5 bc, member of Dept E (never an Executor)
insert into auth.users (id, email)
select pg_temp.u947(n), 'm947.' || n || '@test.local' from generate_series(1, 5) n;
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.u947(n), 'Membru 947 ' || n, 'm947.' || n || '@test.local',
       (case n when 1 then 'bce' when 4 then 'voluntar' when 5 then 'bc' else 'activ' end)::public.member_role, 'activ'
  from generate_series(1, 5) n;
insert into public.groups (name, category, min_level) values ('Dept E #947', 'department', 0), ('Dept F #947', 'department', 0);
create function pg_temp.g947(p_name text) returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;
grant execute on function pg_temp.g947(text) to authenticated, anon;
insert into public.group_members (group_id, member_id, group_role)
select pg_temp.g947(row_.name), pg_temp.u947(row_.n), row_.group_role
  from (values ('Dept E #947', 1, 'manager'), ('Dept E #947', 2, 'member'), ('Dept E #947', 3, 'member'),
               ('Dept E #947', 5, 'member'), ('Dept F #947', 4, 'member')) as row_ (name, n, group_role);

-- ==================== API surface ====================
select ok(not has_function_privilege('anon',
  'public.create_completed_tasks(uuid[], bigint, text, text, bigint, integer, integer, text, jsonb, integer)', 'execute'),
  'anon cannot execute create_completed_tasks');
select ok(has_function_privilege('authenticated',
  'public.create_completed_tasks(uuid[], bigint, text, text, bigint, integer, integer, text, jsonb, integer)', 'execute'),
  'authenticated executes it; the gate is inside');
select is((select prosecdef from pg_proc where proname = 'create_completed_tasks_impl' and pronamespace = 'private'::regnamespace), true,
  'the body is security definer');
select ok((select proconfig @> array['search_path=""'] from pg_proc where proname = 'create_completed_tasks_impl' and pronamespace = 'private'::regnamespace),
  'the body pins an empty search_path');
select is((select proretset from pg_proc where proname = 'create_completed_tasks' and pronamespace = 'public'::regnamespace), true,
  'create_completed_tasks returns the created rows');
select ok(pg_get_functiondef('private.create_completed_tasks_impl(uuid[], bigint, text, text, bigint, integer, integer, text, jsonb, integer)'::regprocedure) !~* 'for update',
  'the body takes no lock of its own');

-- ==================== Step 1: malformed before the gate ====================
select pg_temp.test_clear_jwt();
set local role authenticated;
select throws_ok($$select count(*) from public.create_completed_tasks(array[pg_temp.u947(2)], pg_temp.g947('Dept E #947'), 'Zero', null,
  p_difficulty => 4, p_rating => 5, p_note => 'ok', p_copies => 0)$$,
  'PT400', 'invalid_copies', 'a count of zero is refused before the gate');
reset role;
select pg_temp.test_login_leadership(pg_temp.u947(1));
select throws_ok($$select count(*) from public.create_completed_tasks(array[pg_temp.u947(2)], pg_temp.g947('Dept E #947'), 'Prea multe', null,
  p_difficulty => 4, p_rating => 5, p_note => 'ok', p_copies => 101)$$,
  'PT400', 'too_many_copies', 'a hundred and one are too many');
select throws_ok($$select count(*) from public.create_completed_tasks(null, pg_temp.g947('Dept E #947'), 'Fara lista', null,
  p_difficulty => 4, p_rating => 5, p_note => 'ok', p_copies => 2)$$,
  'PT400', 'invalid_executors', 'no list at all: a finished Task always names its Executor');
select throws_ok($$select count(*) from public.create_completed_tasks(array[pg_temp.u947(2)], pg_temp.g947('Dept E #947'), 'Unul din doi', null,
  p_difficulty => 4, p_rating => 5, p_note => 'ok', p_copies => 2)$$,
  'PT400', 'invalid_executors', 'one entry for two copies');
select throws_ok($$select count(*) from public.create_completed_tasks(array[pg_temp.u947(2), null], pg_temp.g947('Dept E #947'), 'Gol', null,
  p_difficulty => 4, p_rating => 5, p_note => 'ok', p_copies => 2)$$,
  'PT400', 'invalid_executors', 'an empty entry is refused: no unassigned finished Task');
reset role;
select is((select count(*) from public.tasks where title in ('Zero', 'Prea multe', 'Fara lista', 'Unul din doi', 'Gol'))::int, 0,
  'a refused call creates nothing');

-- ==================== Two volunteers, and the same one twice ====================
select pg_temp.test_login_leadership(pg_temp.u947(1));
select is((select count(*) from public.create_completed_tasks(array[pg_temp.u947(2), pg_temp.u947(3)], pg_temp.g947('Dept E #947'),
  'Doi voluntari #947', 'd', p_difficulty => 4, p_rating => 5, p_note => 'Bine', p_copies => 2))::int, 2,
  'two finished copies for two volunteers come back as two rows');
select is((select count(*) from public.create_completed_tasks(array[pg_temp.u947(2), pg_temp.u947(2), pg_temp.u947(2)], pg_temp.g947('Dept E #947'),
  'De trei ori #947', 'd', p_difficulty => 2, p_rating => 5, p_note => 'Bine', p_copies => 3))::int, 3,
  'the same volunteer three times: three rows');
reset role;
select is((select count(*) from public.tasks where title = 'Doi voluntari #947' and status = 'completed')::int, 2,
  'both copies are completed Tasks');
select set_eq(
  $$ select assignment.member_id from public.task_assignments as assignment
       join public.tasks as task on task.id = assignment.task_id where task.title = 'Doi voluntari #947' $$,
  $$ values (pg_temp.u947(2)), (pg_temp.u947(3)) $$,
  'each copy credits its own volunteer');
select is((select count(*) from public.task_evaluations as evaluation
             join public.tasks as task on task.id = evaluation.task_id where task.title = 'De trei ori #947')::int, 3,
  'three Evaluations for the repeated volunteer');
select is((select sum(ledger.delta) from public.points_ledger as ledger
             join public.tasks as task on task.id = ledger.task_id
            where task.title = 'De trei ori #947' and ledger.member_id = pg_temp.u947(2)),
  3 * (2 * public.rating_mult(5)),
  'and three times the points in the ledger');
select is((select count(*) from public.notifications as notification
             join public.tasks as task on task.id = notification.task_id
            where task.title = 'De trei ori #947' and notification.member_id = pg_temp.u947(2))::int, 3,
  'one "Task evaluat" per copy, as three Tasks are');

-- ==================== Atomicity ====================
select pg_temp.test_login_leadership(pg_temp.u947(1));
select throws_ok($$select count(*) from public.create_completed_tasks(array[pg_temp.u947(2), pg_temp.u947(4)], pg_temp.g947('Dept E #947'),
  'Unul din afara #947', 'd', p_difficulty => 4, p_rating => 5, p_note => 'Bine', p_copies => 2)$$,
  'PT409', 'executor_not_group_member', 'a volunteer outside the Group refuses the whole call');
select throws_ok($$select count(*) from public.create_completed_tasks(array[pg_temp.u947(2), pg_temp.u947(5)], pg_temp.g947('Dept E #947'),
  'Un BC #947', 'd', p_difficulty => 4, p_rating => 5, p_note => 'Bine', p_copies => 2)$$,
  'PT409', 'executor_role_excluded', 'a BC member among the volunteers refuses the whole call');
reset role;
select is((select count(*) from public.tasks where title in ('Unul din afara #947', 'Un BC #947'))::int, 0,
  'nothing of a refused batch exists');
select is((select count(*) from public.points_ledger as ledger
             join public.tasks as task on task.id = ledger.task_id
            where task.title in ('Unul din afara #947', 'Un BC #947'))::int, 0,
  'and no points were written');

select * from finish();
rollback;
```

Run: `npx supabase test db supabase/tests/create_completed_tasks.test.sql`
Expected: FAIL — `function public.create_completed_tasks(...) does not exist`. Commit the red suite:

```bash
git add supabase/tests/create_completed_tasks.test.sql
git commit -m "test(db): create_completed_tasks -- n finished Tasks in one transaction (red)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 2: The migration**

Create `supabase/migrations/20261011123000_create_completed_tasks.sql` (date it after the newest migration on the branch):

```sql
-- Finished Tasks x n (spec 2026-10-11, Part E; Alex: "add finished task for n
-- number of times for n number of people, but make sure to be able to select
-- the same person more than once"). One atomic command over the existing
-- private.create_completed_task_impl: one Executor per copy, repeats allowed,
-- every rule (authority, eligibility, Evaluation, points, the one "Task
-- evaluat", the task_create cap) per copy; one refusal rolls back all.

create function private.create_completed_tasks_impl(
  p_executor_ids uuid[], p_group_id bigint, p_title text, p_description text,
  p_campaign_id bigint, p_difficulty integer, p_rating integer, p_note text,
  p_links jsonb, p_copies integer)
returns setof public.tasks
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_given integer := coalesce(array_length(p_executor_ids, 1), 0);
  v_task  public.tasks%rowtype;
  i       integer;
begin
  -- 1. Malformed for every caller, before the gate.
  if p_copies is null or p_copies < 1 then
    raise sqlstate 'PT400' using message = 'invalid_copies';
  end if;
  if p_copies > 100 then
    raise sqlstate 'PT400' using message = 'too_many_copies';
  end if;
  -- A finished Task always names its Executor: exactly one entry per copy, none empty.
  if v_given <> p_copies or exists (select 1 from unnest(p_executor_ids) as entry where entry is null) then
    raise sqlstate 'PT400' using message = 'invalid_executors';
  end if;
  -- 2. One finished Task per copy, in order, in this one transaction.
  for i in 1..p_copies loop
    v_task := private.create_completed_task_impl(
      p_executor_ids[i], p_group_id, p_title, p_description,
      null, null, p_campaign_id, p_difficulty, p_rating, p_note, p_links);
    return next v_task;
  end loop;
  return;
end;
$$;

comment on function private.create_completed_tasks_impl(uuid[], bigint, text, text, bigint, integer, integer, text, jsonb, integer) is
  'Body of public.create_completed_tasks: p_copies finished Tasks, one per entry of p_executor_ids (the same Member may repeat), each through private.create_completed_task_impl in one transaction, so every create_completed_task rule holds per copy and one refusal rolls back all. Step 1: PT400 invalid_copies (null, below 1), too_many_copies (above 100), invalid_executors (no list, a length other than p_copies, or an empty entry).';

create function public.create_completed_tasks(
  p_executor_ids uuid[], p_group_id bigint, p_title text, p_description text,
  p_campaign_id bigint default null, p_difficulty integer default null,
  p_rating integer default null, p_note text default null,
  p_links jsonb default '[]'::jsonb, p_copies integer default 1)
returns setof public.tasks
language sql
set search_path to ''
as $$
  select * from private.create_completed_tasks_impl(p_executor_ids, p_group_id, p_title, p_description,
                                                    p_campaign_id, p_difficulty, p_rating, p_note, p_links, p_copies);
$$;

comment on function public.create_completed_tasks(uuid[], bigint, text, text, bigint, integer, integer, text, jsonb, integer) is
  'Adds p_copies (1..100) finished Tasks at once -- one per volunteer in p_executor_ids, repeats allowed -- atomically, returning the rows in order; the arguments are create_completed_task''s with a list in place of p_executor_id and no legacy link pair. Reasons of its own: PT400 invalid_copies, too_many_copies, invalid_executors; every other reason is create_completed_task''s, per copy.';

revoke execute on function private.create_completed_tasks_impl(uuid[], bigint, text, text, bigint, integer, integer, text, jsonb, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.create_completed_tasks(uuid[], bigint, text, text, bigint, integer, integer, text, jsonb, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.create_completed_tasks_impl(uuid[], bigint, text, text, bigint, integer, integer, text, jsonb, integer) to authenticated;
grant execute on function public.create_completed_tasks(uuid[], bigint, text, text, bigint, integer, integer, text, jsonb, integer) to authenticated;
```

- [ ] **Step 3: Rosters, ADR, conventions**

`supabase/tests/tracker_grants.test.sql`: after the `('create_completed_task', …)` wrapper row add

```sql
  ('create_completed_tasks', 'p_executor_ids uuid[], p_group_id bigint, p_title text, p_description text, p_campaign_id bigint, p_difficulty integer, p_rating integer, p_note text, p_links jsonb, p_copies integer', false, true, false, false),
```

after the `('create_completed_task_impl', …)` private row add

```sql
  ('create_completed_tasks_impl',                  'p_executor_ids uuid[], p_group_id bigint, p_title text, p_description text, p_campaign_id bigint, p_difficulty integer, p_rating integer, p_note text, p_links jsonb, p_copies integer', 'impl'),
```

and the private pin `219` → `220`.

`docs/adr/0007-task-tracker-lifecycle.md`: after `create_completed_task` in the command list add `create_completed_tasks (n finished Tasks for n volunteers, repeats allowed, in one transaction; spec 2026-10-11)` — if `create_completed_task` is not listed, add both lines after `create_tasks`.

`docs/backend/conventions.md`, the Task-copies paragraph: append `\`create_completed_tasks\` (Part E) reuses the three; there an empty entry or a missing list is also \`invalid_executors\`, since a finished Task always names its Executor, and the same Member may be listed several times.`

- [ ] **Step 4: Rebuild, run, commit**

Run: `npx supabase db reset && npx supabase test db`
Expected: green, `create_completed_tasks.test.sql` 22/22 (fix `plan(22)` to the number pgTAP reports if it differs).

```bash
git add supabase/migrations/20261011123000_create_completed_tasks.sql supabase/tests/create_completed_tasks.test.sql supabase/tests/tracker_grants.test.sql docs/adr/0007-task-tracker-lifecycle.md docs/backend/conventions.md
git commit -m "feat(db): create_completed_tasks -- n finished Tasks for n volunteers in one transaction

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Part E frontend — the shared executors dialog and the finished-Task flow

**Files:**

- Create: `app/src/components/tasks/VolunteerPicker.tsx` (moved out of `CompletedTaskForm.tsx`, plus `label` and `excludeIds` props)
- Modify: `app/src/screens/tracker/CopiesExecutorsDialog.tsx` (props `title`, `confirmLabel`, `allowRepeats`, `renderPicker`), `app/src/lib/schemas/completed-task.ts` (`copies`), `app/src/components/tasks/CompletedTaskForm.tsx` (Exemplare, "Continuă", `copies` prop), `app/src/queries/completed-tasks.ts` (`createCompletedTasks`, `useCreateCompletedTasks`), `app/src/screens/tracker/AddCompletedTaskControl.tsx` (two-step flow, plural `onAdded`), `app/src/screens/tracker/TrackerScreen.tsx` (plural receipt), `app/src/lib/database.types.ts` (generated)
- Test: `app/src/screens/tracker/CopiesExecutorsDialog.test.tsx`, `app/src/screens/tracker/AddCompletedTaskControl.test.tsx`, `app/src/queries/completed-tasks.test.ts`, `app/src/lib/schemas/completed-task.test.ts`

**Interfaces:**

- Consumes: Task 15's `create_completed_tasks`; Part B's `CopiesExecutorsDialog`, `MAX_TASK_COPIES`, `createdMany` receipt in `TrackerScreen`.
- Produces: `CopiesExecutorsDialog` props `title: string`, `confirmLabel: string`, `allowRepeats?: boolean` (default false), `renderPicker?: (slot: { index: number; value: string | null; excludeIds: string[]; disabled: boolean; onChange: (id: string | null) => void }) => ReactNode` (default: `DirectExecutorSelector` with `originGroupId`); `VolunteerPicker({ groupId, value, onChange, disabled, invalid, errorId, label = 'Voluntar', excludeIds = [] })`; `CompletedTaskDraft.copies: number` (`executorId` null when `copies > 1`); `createCompletedTasks({ draft, executorIds? })`; `useCreateCompletedTasks()`; `AddCompletedTaskControl` prop `onAdded: (created: { ids: number[]; title: string }) => void`.

- [ ] **Step 1: Failing tests**

`CopiesExecutorsDialog.test.tsx`, add:

```tsx
it("with repeats allowed, excludes nothing and keeps the given title and confirm label", async () => {
  const { user, onConfirm } = renderDialog({
    count: 2,
    allowRepeats: true,
    title: "Voluntarii celor 2 taskuri finalizate",
    confirmLabel: "Adaugă 2 taskuri și acordă punctele",
  });
  expect(
    screen.getByRole("dialog", {
      name: "Voluntarii celor 2 taskuri finalizate",
    }),
  ).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "Alege pentru Exemplarul 1" }),
  );
  const [, second] = screen.getAllByTestId("picker");
  expect(second).toHaveAttribute("data-excluded", "");
  await user.click(
    screen.getByRole("button", { name: "Alege pentru Exemplarul 2" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Adaugă 2 taskuri și acordă punctele" }),
  );
  expect(onConfirm).toHaveBeenCalledWith([
    "Exemplarul 1-ales",
    "Exemplarul 2-ales",
  ]);
});
```

(`renderDialog` passes `title`/`confirmLabel` defaults `Executorii celor 3 taskuri` / `Creează 3 taskuri` so the Part B cases still read as before.)

`AddCompletedTaskControl.test.tsx`, add (reuse `open`, `pick`, `evaluate`, `volunteerBox`; mock `VolunteerPicker` the way the dialog test mocks its picker, keyed by `label`; mock `useCreateCompletedTasks` beside `useCreateCompletedTask`):

```tsx
it("adds the same finished Task for three volunteers at once, the same person allowed twice", async () => {
  state.createMany.mockResolvedValue([
    { id: 71, title: "Atelier" },
    { id: 72, title: "Atelier" },
    { id: 73, title: "Atelier" },
  ]);
  const user = userEvent.setup();
  const dialog = await open(user);
  await pick(
    user,
    within(dialog).getByRole("combobox", { name: "Grup principal" }),
    /^Educație/,
  );
  const copies = within(dialog).getByLabelText("Exemplare");
  await user.clear(copies);
  await user.type(copies, "3");
  expect(
    within(dialog).queryByRole("combobox", { name: "Voluntar" }),
  ).toBeNull();
  await user.type(within(dialog).getByLabelText("Titlu"), "Atelier");
  await evaluate(user, dialog);
  await user.click(within(dialog).getByRole("button", { name: "Continuă" }));
  const step = await screen.findByRole("dialog", {
    name: "Voluntarii celor 3 taskuri finalizate",
  });
  await user.click(
    within(step).getByRole("button", { name: "Alege pentru Exemplarul 1" }),
  );
  await user.click(
    within(step).getByRole("button", { name: "Alege pentru Exemplarul 2" }),
  );
  await user.click(
    within(step).getByRole("button", { name: "Alege pentru Exemplarul 3" }),
  );
  await user.click(
    within(step).getByRole("button", {
      name: "Adaugă 3 taskuri și acordă punctele",
    }),
  );
  await waitFor(() =>
    expect(onAdded).toHaveBeenCalledWith({
      ids: [71, 72, 73],
      title: "Atelier",
    }),
  );
  expect(state.createMany).toHaveBeenCalledWith(
    expect.objectContaining({
      executorIds: ["ana", "ana", "bogdan"],
      draft: expect.objectContaining({
        copies: 3,
        groupId: 7,
        title: "Atelier",
        executorId: null,
      }),
    }),
  );
});
```

(the mocked picker chooses `ana` for Exemplarul 1 and 2 and `bogdan` for 3, by `label`.)

`completed-tasks.test.ts`: `createCompletedTasks({ draft: { …, copies: 1, executorId: 'ana' } })` calls `create_completed_tasks` with `p_executor_ids: ['ana'], p_copies: 1`; with `copies: 2, executorIds: ['ana', 'ana']` → `p_executor_ids: ['ana', 'ana'], p_copies: 2`.

`completed-task.test.ts`: `copies` `0`, `101`, `NaN` → `invalid_copies` / `too_many_copies` on `copies`; with `copies: 2` a null `executorId` is accepted.

Run them: FAIL (missing props, module, fields).

- [ ] **Step 2: The dialog and the picker**

`CopiesExecutorsDialog.tsx`: props gain `title`, `confirmLabel`, `allowRepeats = false`, `renderPicker`, and `originGroupId` becomes optional (required only when `renderPicker` is omitted). The title and the confirm button read the props; `excludeIds` passed to each picker is `[]` when `allowRepeats`; the default picker is today's `DirectExecutorSelector` call. Part B's two callers pass `title={`Executorii celor ${n} ${plural}`}` and `confirmLabel={`Creează ${n} ${plural}`}`.

Move `VolunteerPicker` from `CompletedTaskForm.tsx` into `components/tasks/VolunteerPicker.tsx`, exported, with `label = 'Voluntar'` on its `<span id=…-label>` and `excludeIds` filtering `members` (keeping `value`). `CompletedTaskForm` imports it.

- [ ] **Step 3: Schema, form, query, control, receipt**

- `lib/schemas/completed-task.ts`: `CompletedTaskInput.copies: string`; the schema parses `copies` as in Part B (`invalid_copies`, `too_many_copies` on `copies`); `executorId` is required only when `copies <= 1`; `completedTaskFieldForReason` maps `invalid_copies`/`too_many_copies` → `copies`, `invalid_executors` → the volunteer field.
- `CompletedTaskForm.tsx`: prop `copies?: boolean` (default false; `AddCompletedTaskControl`'s manager variant passes `true`, the fixed-volunteer variant nothing); initial `copies: '1'`; the **Exemplare** field (same markup as Part B, `InfoHint` "Despre exemplare": "Adaugă același task finalizat pentru mai mulți voluntari odată, până la 100. Alegi voluntarii la pasul următor; aceeași persoană poate fi aleasă de mai multe ori.") rendered after the Group cascade when `copies && !volunteer`; at `copies > 1` the `VolunteerPicker` gives way to "Voluntarii se aleg la pasul următor, câte unul pentru fiecare exemplar." and the submit label becomes `Continuă`; `onSubmit` receives `copies` and `executorId: null` in that case.
- `queries/completed-tasks.ts`: `CompletedTaskDraft.copies: number`; `createCompletedTasks({ draft, executorIds })` → `supabase.rpc('create_completed_tasks', { p_executor_ids: draft.copies > 1 ? executorIds : [draft.executorId], p_group_id, p_title, p_description, p_links, p_campaign_id, p_difficulty, p_rating, p_note, p_copies: draft.copies })`, throwing `CommandError(error, FAILED)`; `useCreateCompletedTasks` invalidates `keys.tasks.all` and `keys.points.all`. `createCompletedTask` stays for the approval flow.
- `AddCompletedTaskControl.tsx`: the manager variant uses `useCreateCompletedTasks` with the Part B two-step pattern (`pendingDraft`, `stepError`, `CopiesExecutorsDialog` with `title={`Voluntarii celor ${n} taskuri finalizate`}`, `confirmLabel={`Adaugă ${n} taskuri și acordă punctele`}`, `allowRepeats`, `renderPicker` → `VolunteerPicker` for `pendingDraft.groupId`); `onAdded({ ids, title })`. The fixed-volunteer variant keeps one copy and reports `{ ids: [id], title }`.
- `TrackerScreen.tsx`: `onAdded={({ ids, title })` → one id: today's notice and details; more: `setCreatedMany({ key: Date.now(), receipt: `${ids.length} taskuri finalizate adăugate. Punctele au fost acordate.` })`. `MemberTrackerScreen` (the fixed-volunteer caller) adapts to the new shape with one id.
- `npm run gen:types`.

- [ ] **Step 4: Run, commit**

Run (in `app/`): `npm run typecheck && npm run lint && npm run test:run`
Expected: PASS.

```bash
git add app/src
git commit -m "feat(app): finished Tasks x n -- one volunteer per copy, the same person allowed twice

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: Part E final gates and the live check

The spec's Part E section and the limit text were written before Task 14 (the spec is the authority the plan argues from). `docs/backend/conventions.md` was amended in Tasks 14 and 15; `DESIGN.md` needs nothing new (the dialog clause from Part B covers "one like field per copy").

**Files:** none new.

- [ ] **Step 1: Whole-suite gates**

Run: `npx supabase db reset && npx supabase test db`
Expected: green, `create_completed_tasks.test.sql` among the files.

Run (in `app/`): `npm run gen:types && git status --short src/lib/database.types.ts`
Expected: no diff.

Run (in `app/`): `npm run typecheck && npm run lint && npm run format:check && npm run test:run`
Expected: green.

Run: `npm run check:root`
Expected: green (the spec and the plan are Prettier-clean).

- [ ] **Step 2: The dev server, by hand (browser pane, signed in as `bc@demo.osubb`)**

- Taskuri › De gestionat › Adaugă task finalizat: Exemplare = 3 hides Voluntar and the button reads "Continuă"; the dialog "Voluntarii celor 3 taskuri finalizate" offers every volunteer in every picker; choose the same person for 1 and 2 and another for 3; "Adaugă 3 taskuri și acordă punctele" → the receipt "3 taskuri finalizate adăugate. Punctele au fost acordate." and three completed cards.
- Exemplare = 1 behaves as before: the details sheet opens on the new Task.
- Task nou with Exemplare = 21, Public → 21 cards in Disponibile (the raised limit).
- At 320 px (`resize_window`): the dialog is full screen, each picker on its own row, Înapoi and the confirm button reachable; `resize_window preset desktop` afterwards.

- [ ] **Step 3: Ledger and report**

Append `Task 17: complete (...)` with the gate results, then the final report to Alex: what Part E shipped, the limit raise, the rulings made during Tasks 14–17, the daily-cap note (100 creations per actor per day: a batch at the limit spends the whole day's allowance), and the open follow-up (Trackerul membrului keeps one copy).

---
