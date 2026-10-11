# OSUBB-wide approval (Cerere de aprobare) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is executed inline by the author of the spec, on the same branch as the spec (Alex, 2026-10-11: "on the same branch").

**Goal:** An Announcement or Event on the Organization Group written by anyone below BC waits as a Cerere de aprobare until a BC member or the Moderator approves it from the item's own form (or rejects it with a reason); the requests sit behind a counted icon in Calendar and Anunțuri that shows only when there are any.

**Architecture:** One migration adds the approval columns to `announcements` and `events`, one `before` trigger that stamps the status (pending for an OSUBB-wide row by a writer below level 6, re-entry on an author's content edit) and one `after` trigger that asks BC, narrows the two read rules and the unread count to approved rows (author and BC excepted), moves the Announcement fan-out and the "Eveniment nou" notice into row helpers that the approve commands reuse, and adds four decision commands plus one read. The browser gets one icon-and-sheet component placed in two pages, a review mode on the two existing edit forms, badges and receipts for authors.

**Tech Stack:** Supabase (Postgres 17, PL/pgSQL, RLS, pgTAP), React 19 + TypeScript + Vite, Base UI 1.8.0, TanStack Query, zod, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-11-org-wide-approval-design.md`

## Global Constraints

- Branch `feat/bc-powers-task-copies-bars`; no GitHub issues; Alex opens the PR. Never push to or merge into `main`.
- The migration is `supabase/migrations/20261011140000_org_wide_approval.sql` (after `20261011130000_announcement_manage_author.sql`; verify with `ls supabase/migrations | tail -1`). Every `create or replace` body is rebuilt from the latest definition quoted in this plan.
- Every `security definer` function has `set search_path = ''` and fully-qualified names; a command is `public.<verb>_<noun>` (`language sql`, invoker) over `private.<verb>_<noun>_impl` (`security definer`); grants are "revoke from public, anon, authenticated, service_role" then "grant to authenticated" for both; a trigger function is executable by nobody.
- Reasons are `snake_case`, raised `raise sqlstate 'PT400' using message = '<reason>'` or `raise exception using errcode = '42501', message = '<reason>'`; every new reason gets Romanian copy in `app/src/lib/command-reasons.ts`.
- A parent row is locked `for no key update`, never `for update`.
- Every policy branch stays under `public.auth_is_member()` (house rule 12).
- Vocabulary from `CONTEXT.md`; UI copy is Romanian. Tests ship in the same commit as the code they prove. `npx supabase db reset && npx supabase test db` and, in `app/`, `npm run typecheck && npm run lint && npm run test:run` are green before every commit that touches their side.
- Files are LF. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Working directory for every command is the repo root unless it says `app/`.

## Review Focus

1. A pending OSUBB-wide Announcement must never reach the unread badge, the critical banner, the feed or the readers list of a third Member (Task 1 pins the policy and `my_unread_announcements_count`; the banner and feed read under the policy).
2. BC's own edit of a pending item (review mode) must not change its status; the author's edit of an approved item must (Task 1's trigger tests both).
3. `approve_event` with `announce_on_approval` must write the Announcement as the original author, approved, with one fan-out and no "Anunț nou" to the author (Task 2).
4. `cancel_event` by the author on an approved OSUBB-wide Event must not re-enter review (`cancelled_at`, `cancel_reason`, `updated_at`, `pinned`, `announce_on_approval` and the approval columns are outside the content comparison; Task 1).
5. The icon renders nothing for a non-BC viewer and at a count of 0, and the requests sheet never lists an item the viewer cannot open (Task 4).

---

### Task 1: Backend model — columns, stamp and request triggers, read rules, fan-out helpers

**Files:**

- Create: `supabase/migrations/20261011140000_org_wide_approval.sql` (sections 1–6 of the file below), `supabase/tests/approvals.test.sql`
- Modify: nothing else in this task.

**Interfaces:**

- Consumes: `private.fan_out_announcement()` (latest body in `20261007190200_osubb_deals.sql`), `private.create_event_impl(...)` (latest body in `20261006000111_event_created_notification.sql`), `private.stamp_announcement_authorship()` (latest in `20260929234000_retire_dead_surface.sql`), `public.my_unread_announcements_count(text)` (latest in `20261007190200_osubb_deals.sql`), `private.notify(uuid[], noti_kind, text, text, bigint, text, uuid, text, boolean)`, `private.caller_level()`, `private.actor_level(uuid)`, `private.event_notification_recipients(bigint)`, `private.event_announcement_body(...)`.
- Produces: columns `approval_status`, `approval_decided_by`, `approval_decided_at`, `rejection_reason` on both tables and `events.announce_on_approval`; `private.stamp_approval()` (before insert or update, both tables); `private.request_approval()` (after insert or update, both tables); `private.fan_out_announcement_row(p_row public.announcements, p_actor uuid)`; `private.notify_event_created(p_event public.events, p_actor uuid)`; the transaction settings `osubb.deciding_approval` ('on' while a decision command writes the approval columns) and `osubb.announcement_author` (the author an Announcement is inserted on behalf of).

- [ ] **Step 1: Write the failing suite (part 1)**

Create `supabase/tests/approvals.test.sql` with the fixture and the part-1 assertions. Personas (prefix 4700): 1 BCE, Manager of `Dept A #4700` (may post OSUBB-wide: holds a Group Role); 2 BC; 3 Moderator; 4 Voluntar, member of Dept A; 5 Voluntar on no roster.

```sql
-- Cerere de aprobare (spec 2026-10-11, org-wide approval): an Announcement or
-- Event on the Organization Group by a writer below BC waits for BC/Moderator.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(40);

create function pg_temp.u47(n integer) returns uuid language sql immutable as $$
  select ('47000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
grant execute on function pg_temp.u47(integer) to authenticated, anon;
insert into auth.users (id, email)
select pg_temp.u47(n), 'm47.' || n || '@test.local' from generate_series(1, 5) n;
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.u47(n), 'Membru 47 ' || n, 'm47.' || n || '@test.local',
       (case n when 1 then 'bce' when 2 then 'bc' when 3 then 'moderator' else 'voluntar' end)::public.member_role, 'activ'
  from generate_series(1, 5) n;
insert into public.groups (name, category, min_level) values ('Dept A #4700', 'department', 0);
insert into public.group_members (group_id, member_id, group_role)
select g.id, pg_temp.u47(r.n), r.role
  from (values (1, 'manager'), (4, 'member')) as r (n, role)
  join public.groups as g on g.name = 'Dept A #4700';
create temp table fx47 as
select (select id from public.groups where is_organization) as org,
       (select id from public.groups where name = 'Dept A #4700') as dept;
grant select on fx47 to authenticated;
create function pg_temp.ann(p_title text) returns public.announcements language sql stable security definer set search_path = '' as $$
  select * from public.announcements where title = p_title
$$;
create function pg_temp.ev(p_title text) returns public.events language sql stable security definer set search_path = '' as $$
  select * from public.events where title = p_title
$$;
-- Notifications of one title, as persona numbers.
create function pg_temp.told(p_title text) returns setof integer language sql stable security definer set search_path = '' as $$
  select right(member_id::text, 12)::integer from public.notifications
   where title = p_title and member_id::text like '47000000-%' order by 1
$$;

-- ==================== 1. the stamp ====================
select pg_temp.test_login_leadership(pg_temp.u47(1));
insert into announcements (title, body, group_id, audience) select 'Ann pending #4700', 'x', org, 'org' from fx47;
insert into announcements (title, body, group_id, audience) select 'Ann local #4700', 'x', dept, 'local' from fx47;
reset role;
select is((pg_temp.ann('Ann pending #4700')).approval_status, 'pending',
  'an OSUBB-wide Announcement by a BCE waits for approval');
select is((pg_temp.ann('Ann local #4700')).approval_status, 'approved',
  'a local Group Announcement by the same author publishes at once');
select is((select count(*) from pg_temp.told('Anunț nou: Ann pending #4700'))::int, 0,
  'nobody is told of a pending Announcement');
select results_eq($$select * from pg_temp.told('Cerere de aprobare: Ann pending #4700')$$, $$values (2), (3)$$,
  'BC and the Moderator get one request each');
select pg_temp.test_login_leadership(pg_temp.u47(2));
insert into announcements (title, body, group_id, audience) select 'Ann by BC #4700', 'x', org, 'org' from fx47;
reset role;
select is((pg_temp.ann('Ann by BC #4700')).approval_status, 'approved', 'BC publishes OSUBB-wide at once');
select is((select count(*) from pg_temp.told('Anunț nou: Ann by BC #4700') where told in (4, 5))::int, 2,
  'and its fan-out ran');

-- ==================== 2. who sees a pending row ====================
select pg_temp.test_login_leadership(pg_temp.u47(4));
select is((select count(*) from announcements where title = 'Ann pending #4700'), 0::bigint,
  'a third Member cannot read a pending Announcement');
select is(public.my_unread_announcements_count(), (select count(*)::int from announcements where title in ('Ann by BC #4700')),
  'and it never counts as unread for them');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(1));
select is((select count(*) from announcements where title = 'Ann pending #4700'), 1::bigint, 'the author reads their own pending Announcement');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(3));
select is((select count(*) from announcements where title = 'Ann pending #4700'), 1::bigint, 'the Moderator reads it too');
reset role;

-- ==================== 3. re-entering review ====================
select pg_temp.test_login_leadership(pg_temp.u47(2));
update announcements set body = 'edited by BC' where title = 'Ann by BC #4700';
reset role;
select is((pg_temp.ann('Ann by BC #4700')).approval_status, 'approved', 'a BC edit never changes the status');
select pg_temp.test_login_leadership(pg_temp.u47(1));
insert into announcements (title, body, group_id, audience) select 'Ann approved later #4700', 'x', org, 'org' from fx47;
reset role;
update announcements set approval_status = 'approved', approval_decided_by = pg_temp.u47(2), approval_decided_at = now()
 where title = 'Ann approved later #4700';  -- as the owner, standing in for the approve command of Task 2
select pg_temp.test_login_leadership(pg_temp.u47(1));
update announcements set pinned = true where title = 'Ann approved later #4700';
reset role;
select is((pg_temp.ann('Ann approved later #4700')).approval_status, 'approved', 'pinning is not a content edit');
select pg_temp.test_login_leadership(pg_temp.u47(1));
update announcements set body = 'edited by the author' where title = 'Ann approved later #4700';
reset role;
select is((pg_temp.ann('Ann approved later #4700')).approval_status, 'pending', 'the author editing an approved OSUBB-wide Announcement re-enters review');
select is((pg_temp.ann('Ann approved later #4700')).approval_decided_by, null, 'and the old decision is cleared');
select is((select count(*) from pg_temp.told('Cerere de aprobare: Ann approved later #4700'))::int, 2, 'BC and the Moderator are asked again');
select pg_temp.test_login_leadership(pg_temp.u47(1));
update announcements set approval_status = 'approved' where title = 'Ann pending #4700';
reset role;
select is((pg_temp.ann('Ann pending #4700')).approval_status, 'pending', 'a client cannot write the status');

-- ==================== 4. Events ====================
select pg_temp.test_login_leadership(pg_temp.u47(1));
select lives_ok($$select public.create_event('Ev pending #4700', 'activitate', (select org from fx47), '2031-05-05 10:00+00')$$,
  'a BCE creates an OSUBB-wide Event');
select lives_ok($$select public.create_event('Ev announced #4700', 'activitate', (select org from fx47), '2031-05-06 10:00+00',
  p_announce => true)$$, 'and one that asks for its Announcement');
reset role;
select is((pg_temp.ev('Ev pending #4700')).approval_status, 'pending', 'the Event waits for approval');
select is((select count(*) from pg_temp.told('Eveniment nou: Ev pending #4700'))::int, 0, 'nobody is told of a pending Event');
select results_eq($$select * from pg_temp.told('Cerere de aprobare: Ev pending #4700')$$, $$values (2), (3)$$, 'BC and the Moderator get the request');
select is((pg_temp.ev('Ev announced #4700')).announce_on_approval, true, 'the Announcement waits for the approval');
select is((select count(*) from announcements where title = 'Ev announced #4700'), 0::bigint, 'so no Announcement row exists yet');
select pg_temp.test_login_leadership(pg_temp.u47(4));
select is((select count(*) from events where title = 'Ev pending #4700'), 0::bigint, 'a third Member cannot read a pending Event');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(2));
select lives_ok($$select public.create_event('Ev by BC #4700', 'activitate', (select org from fx47), '2031-05-07 10:00+00')$$, 'BC creates one');
reset role;
select is((pg_temp.ev('Ev by BC #4700')).approval_status, 'approved', 'published at once');
select ok(4 in (select * from pg_temp.told('Eveniment nou: Ev by BC #4700')), 'and its audience is told');
select pg_temp.test_login_leadership(pg_temp.u47(1));
select lives_ok($$select public.create_event('Ev to cancel #4700', 'activitate', (select dept from fx47), '2031-05-08 10:00+00')$$, 'a local Event by the BCE');
reset role;
update events set group_id = (select org from fx47), approval_status = 'approved' where title = 'Ev to cancel #4700';  -- owner: an approved OSUBB-wide Event of the BCE
select pg_temp.test_login_leadership(pg_temp.u47(1));
select lives_ok($$select public.cancel_event((pg_temp.ev('Ev to cancel #4700')).id, 'Nu mai e nevoie')$$, 'the author cancels it');
reset role;
select is((pg_temp.ev('Ev to cancel #4700')).approval_status, 'approved', 'a cancellation is not a content edit: no re-entry');

select * from finish();
rollback;
```

The part-2 assertions (Task 2) replace the `select * from finish();` line; the `plan(40)` is the whole suite's count — fix it to pgTAP's report at the end of Task 2 (part 1 alone reports "planned 40, ran N": acceptable red evidence).

Run: `npx supabase test db supabase/tests/approvals.test.sql`
Expected: FAIL — `column "approval_status" does not exist`.

- [ ] **Step 2: The migration, sections 1–6**

Create `supabase/migrations/20261011140000_org_wide_approval.sql`:

```sql
-- Cerere de aprobare (spec docs/superpowers/specs/2026-10-11-org-wide-approval-design.md,
-- Alex 2026-10-11): an Announcement or Event on the Organization Group by a writer
-- below BC (a BCE, a Group Manager or Responsible) waits as a request until a BC
-- member or the Moderator approves it from the item's own form or rejects it
-- with a reason. BC and the Moderator keep publishing OSUBB-wide items at once;
-- local Group items are untouched.

-- ==================== 1. the columns ====================
alter table public.announcements
  add column approval_status text not null default 'approved',
  add column approval_decided_by uuid references public.profiles (id),
  add column approval_decided_at timestamptz,
  add column rejection_reason text,
  add constraint announcements_approval_status_ck check (approval_status in ('pending', 'approved', 'rejected')),
  add constraint announcements_rejection_reason_ck check (
    (approval_status = 'rejected') = (rejection_reason is not null)
    and (rejection_reason is null or char_length(btrim(rejection_reason)) between 1 and 1000));
alter table public.events
  add column approval_status text not null default 'approved',
  add column approval_decided_by uuid references public.profiles (id),
  add column approval_decided_at timestamptz,
  add column rejection_reason text,
  add column announce_on_approval boolean not null default false,
  add constraint events_approval_status_ck check (approval_status in ('pending', 'approved', 'rejected')),
  add constraint events_rejection_reason_ck check (
    (approval_status = 'rejected') = (rejection_reason is not null)
    and (rejection_reason is null or char_length(btrim(rejection_reason)) between 1 and 1000));
comment on column public.announcements.approval_status is 'approved for every row BC/Moderator write and for every local Group Announcement; pending for an OSUBB-wide Announcement by a writer below level 6 until approve_announcement / reject_announcement decide it (spec 2026-10-11). Written by private.stamp_approval and the two commands only.';
comment on column public.events.approval_status is 'approved for every row BC/Moderator write and for every local Group Event; pending for an OSUBB-wide Event by a writer below level 6 until approve_event / reject_event decide it (spec 2026-10-11). Written by private.stamp_approval and the two commands only.';
comment on column public.events.announce_on_approval is 'A pending OSUBB-wide Event created with p_announce: its Announcement is written when approve_event publishes it, as the original author.';

-- ==================== 2. the stamp (before insert or update, both tables) ====================
create function private.stamp_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_level integer;
  v_org boolean;
  v_skip constant text[] := array['approval_status', 'approval_decided_by', 'approval_decided_at', 'rejection_reason',
                                  'updated_at', 'pinned', 'cancelled_at', 'cancel_reason', 'announce_on_approval'];
  v_changed boolean;
begin
  -- The decision commands write the approval columns themselves.
  if coalesce(current_setting('osubb.deciding_approval', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- A client value is ignored: the stamp decides.
    new.approval_status := 'approved';
    new.approval_decided_by := null;
    new.approval_decided_at := null;
    new.rejection_reason := null;
    if v_actor is null then
      return new;  -- migrations, seed, jobs: published
    end if;
    select grp.is_organization into v_org from public.groups as grp where grp.id = new.group_id;
    v_level := coalesce(private.actor_level(v_actor), 0);
    if coalesce(v_org, false) and v_level < 6 then
      new.approval_status := 'pending';
    end if;
    return new;
  end if;
  -- UPDATE: the approval columns are kept; an author's content edit of a
  -- decided OSUBB-wide row re-enters review.
  new.approval_status := old.approval_status;
  new.approval_decided_by := old.approval_decided_by;
  new.approval_decided_at := old.approval_decided_at;
  new.rejection_reason := old.rejection_reason;
  if v_actor is null then
    return new;
  end if;
  select grp.is_organization into v_org from public.groups as grp where grp.id = new.group_id;
  if not coalesce(v_org, false) then
    return new;
  end if;
  v_level := coalesce(private.actor_level(v_actor), 0);
  if v_level >= 6 then
    return new;
  end if;
  v_changed := (to_jsonb(new) - v_skip) is distinct from (to_jsonb(old) - v_skip);
  if v_changed and old.approval_status in ('approved', 'rejected') then
    new.approval_status := 'pending';
    new.approval_decided_by := null;
    new.approval_decided_at := null;
    new.rejection_reason := null;
  end if;
  return new;
end;
$$;
comment on function private.stamp_approval() is
  'announcements_stamp_approval / events_stamp_approval (before insert or update; spec 2026-10-11): on insert the status is pending for a row on the Organization Group by a signed-in writer below level 6 and approved otherwise (a client value is ignored; a write with no auth.uid() publishes); on update the approval columns are kept, except that a writer below level 6 changing the content of a decided OSUBB-wide row (anything but the approval columns, updated_at, pinned, cancelled_at, cancel_reason and announce_on_approval) sends it back to pending with the decision cleared. The decision commands set osubb.deciding_approval = on for their own write.';
revoke execute on function private.stamp_approval() from public, anon, authenticated, service_role;
create trigger announcements_stamp_approval before insert or update on public.announcements
  for each row execute function private.stamp_approval();
create trigger events_stamp_approval before insert or update on public.events
  for each row execute function private.stamp_approval();

-- ==================== 3. the request (after insert or update, both tables) ====================
create function private.request_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipients uuid[];
  v_group text;
  v_author text;
  v_link text;
  v_kind public.noti_kind;
begin
  if new.approval_status <> 'pending' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.approval_status = 'pending' then
    return new;  -- an edit while pending is not a new request
  end if;
  select array_agg(profile.id order by profile.id) into v_recipients
    from public.profiles as profile
    join public.roles as role on role.id = profile.role
   where profile.status = 'activ' and role.level >= 6;
  select grp.name into v_group from public.groups as grp where grp.id = new.group_id;
  select profile.full_name into v_author from public.profiles as profile where profile.id = new.created_by;
  if tg_table_name = 'events' then
    v_kind := 'event'; v_link := '/calendar?event=' || new.id::text;
  else
    v_kind := 'announce'; v_link := '/anunturi?anunt=' || new.id::text;
  end if;
  perform private.notify(v_recipients, v_kind, 'Cerere de aprobare: ' || new.title,
    coalesce(v_author, 'Un membru') || ' · ' || coalesce(v_group, 'OSUBB'),
    null, 'approval:' || tg_table_name || ':' || new.id::text, new.created_by, v_link);
  return new;
end;
$$;
comment on function private.request_approval() is
  'announcements_request_approval / events_request_approval (after insert or update; spec 2026-10-11): when a row becomes pending (new, or re-entering review) every live BC member and the Moderator get one Notification "Cerere de aprobare: <title>" with the author and the Group, keyed approval:<table>:<id> so a second request while the first is unread merges into it, linking to the item. The author (private.notify drops the actor) is never a recipient.';
revoke execute on function private.request_approval() from public, anon, authenticated, service_role;
create trigger announcements_request_approval after insert or update on public.announcements
  for each row execute function private.request_approval();
create trigger events_request_approval after insert or update on public.events
  for each row execute function private.request_approval();

-- ==================== 4. who reads a pending row ====================
alter policy events_read on public.events
  using ((select auth_is_member())
         and private.can_read_event(group_id, min_level, (select auth.uid()))
         and (approval_status = 'approved'
              or created_by = (select auth.uid())
              or coalesce((select private.caller_level()), 0) >= 6));
drop policy announcements_read on public.announcements;
create policy announcements_read on public.announcements
  for select to authenticated
  using (private.can_read_announcement(group_id, audience, min_level, created_by, kind, deadline)
         and (approval_status = 'approved'
              or created_by = (select auth.uid())
              or coalesce((select private.caller_level()), 0) >= 6));
```

Then **section 5**: `create or replace function public.my_unread_announcements_count(p_kind text default null)` with the body quoted in Task 1's Consumes, adding `and announcement.approval_status = 'approved'` right after the `from public.announcements as announcement` `where` opens (before the level branch), and the comment gaining "A pending or rejected Announcement never counts (spec 2026-10-11)."

**Section 6**: the fan-out, the authorship stamp and the Event notice.

```sql
-- ==================== 6a. the Announcement fan-out as a row helper ====================
create function private.fan_out_announcement_row(p_row public.announcements, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audience_group bigint;
  v_recipients uuid[];
  v_critical boolean := p_row.priority = 'critical';
  v_deal boolean := p_row.kind = 'deal';
begin
  -- [the whole body of private.fan_out_announcement() from 20261007190200_osubb_deals.sql,
  --  with every `new.` read as `p_row.`, `v_actor` replaced by `p_actor`, and `return new`
  --  dropped — the recipient set, the notify call and the author's announcement_reads row]
end;
$$;
comment on function private.fan_out_announcement_row(public.announcements, uuid) is
  'The Announcement fan-out (#68, R32, R42, R43, R45, #756, #909, #861 — see announcements_fan_out) as a helper over one row: the trigger calls it for an approved insert and approve_announcement for a pending row that just became approved, with the author as the actor to drop, so the author never gets "Anunț nou" of their own Announcement.';
revoke execute on function private.fan_out_announcement_row(public.announcements, uuid) from public, anon, authenticated, service_role;

create or replace function private.fan_out_announcement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A pending Announcement tells nobody yet; approve_announcement fans it out.
  if new.approval_status <> 'approved' then
    return new;
  end if;
  perform private.fan_out_announcement_row(new,
    coalesce(nullif(current_setting('osubb.announcement_author', true), '')::uuid, (select auth.uid()), new.created_by));
  return new;
end;
$$;
-- (the existing comment on private.fan_out_announcement() is re-stated with one sentence added:
--  "Since the approval flow (spec 2026-10-11) it skips a pending row and delegates to
--   private.fan_out_announcement_row; the actor dropped is the author an approve command
--   inserts on behalf of (osubb.announcement_author), else the caller.")

-- ==================== 6b. an Announcement inserted on behalf of its author ====================
create or replace function private.stamp_announcement_authorship()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_on_behalf uuid := nullif(current_setting('osubb.announcement_author', true), '')::uuid;
begin
  if v_actor is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_on_behalf, v_actor);
    new.published_at := now();
  else
    new.created_by := old.created_by;
    new.published_at := old.published_at;
  end if;
  return new;
end;
$$;
-- (comment re-stated with: "approve_event sets osubb.announcement_author to the Event's
--  creator for the Announcement it publishes on their behalf (spec 2026-10-11).")

-- ==================== 6c. the "Eveniment nou" notice as a helper; create_event_impl ====================
create function private.notify_event_created(p_event public.events, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipients uuid[];
begin
  select array_agg(recipient) into v_recipients
    from private.event_notification_recipients(p_event.id) as recipient;
  perform private.notify(v_recipients, 'event', 'Eveniment nou: ' || p_event.title,
    private.event_announcement_body(p_event.starts_at, p_event.ends_at, p_event.location, null),
    null, 'event:' || p_event.id::text || ':created', p_actor,
    '/calendar?event=' || p_event.id::text);
end;
$$;
comment on function private.notify_event_created(public.events, uuid) is
  'Ruling R39''s "Eveniment nou" notice over one Event row: create_event_impl calls it for an approved Event without its Announcement, approve_event for a pending one that just became approved (the author as the actor to drop).';
revoke execute on function private.notify_event_created(public.events, uuid) from public, anon, authenticated, service_role;
```

Then `create or replace function private.create_event_impl(...)` with the body quoted in `20261006000111_event_created_notification.sql`, changed in two places only: (1) the `v_recipients` declaration goes; (2) after the insert, in place of the `if coalesce(p_announce, false) then … else … end if;` block:

```sql
  -- Spec 2026-10-11: a pending Event (OSUBB-wide, writer below BC -- the stamp
  -- decided) tells nobody yet; BC are asked by the request trigger. Its
  -- Announcement, if asked for, is written when approve_event publishes it.
  if v_created.approval_status = 'pending' then
    if coalesce(p_announce, false) then
      update public.events set announce_on_approval = true where id = v_created.id returning * into v_created;
    end if;
    return v_created;
  end if;
  if coalesce(p_announce, false) then
    insert into public.announcements(title, body, group_id, audience, min_level, deadline, created_by)
      values (v_created.title,
              private.event_announcement_body(v_created.starts_at, v_created.ends_at,
                                              v_created.location, v_created.description),
              v_created.group_id,
              case when v_group.is_organization then 'org' else 'local' end,
              v_created.min_level,
              v_created.starts_at,
              v_actor);
  else
    perform private.notify_event_created(v_created, v_actor);
  end if;
  return v_created;
```

The function's comment is re-stated with one sentence added at the end: "Spec 2026-10-11: an OSUBB-wide Event by a writer below BC is written pending (private.stamp_approval), tells nobody and keeps p_announce as announce_on_approval for approve_event."

- [ ] **Step 3: Rebuild and run part 1**

Run: `npx supabase db reset && npx supabase test db supabase/tests/approvals.test.sql`
Expected: every part-1 assertion `ok`; pgTAP complains only that fewer than 40 ran. `npx supabase db lint --level warning` shows nothing for the new functions.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261011140000_org_wide_approval.sql supabase/tests/approvals.test.sql
git commit -m "feat(db): OSUBB-wide Announcements and Events by a writer below BC wait for approval

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Backend commands — approve, reject, the requests read; rosters; generated types

**Files:**

- Modify: `supabase/migrations/20261011140000_org_wide_approval.sql` (sections 7–9 appended), `supabase/tests/approvals.test.sql` (part 2), `supabase/tests/tracker_grants.test.sql` (five wrapper rows, four impl rows, two trigger rows, two helper rows, the private pin 220 → 228 and its message), `docs/backend/conventions.md` (the reasons), `app/src/lib/database.types.ts` (generated)

**Interfaces:**

- Consumes: Task 1's columns, helpers and settings.
- Produces: `public.approve_announcement(p_id bigint) returns public.announcements`, `public.reject_announcement(p_id bigint, p_reason text) returns public.announcements`, `public.approve_event(p_id bigint) returns public.events`, `public.reject_event(p_id bigint, p_reason text) returns public.events`, `public.approval_requests() returns table (kind text, id bigint, title text, group_id bigint, created_by uuid, created_at timestamptz, starts_at timestamptz)`. Reasons: `42501 approval_forbidden`; `PT404 announcement_not_found` / `event_not_found`; `PT409 not_pending`; `PT400 rejection_reason_required`, `rejection_reason_too_long`.

- [ ] **Step 1: The failing suite (part 2)**

Append before `select * from finish();` (and set `plan` to the final count):

```sql
-- ==================== 5. decisions ====================
select pg_temp.test_login_leadership(pg_temp.u47(4));
select throws_ok($$select public.approve_announcement((pg_temp.ann('Ann pending #4700')).id)$$, '42501', 'approval_forbidden',
  'a Member below BC cannot approve');
select throws_ok($$select public.reject_event((pg_temp.ev('Ev pending #4700')).id, 'x')$$, '42501', 'approval_forbidden', 'nor reject');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(2));
select throws_ok($$select public.reject_announcement((pg_temp.ann('Ann pending #4700')).id, '  ')$$, 'PT400', 'rejection_reason_required',
  'a rejection needs its reason');
select throws_ok($$select public.reject_announcement((pg_temp.ann('Ann pending #4700')).id, repeat('x', 1001))$$, 'PT400', 'rejection_reason_too_long',
  'of at most 1000 characters');
select throws_ok($$select public.approve_announcement((pg_temp.ann('Ann by BC #4700')).id)$$, 'PT409', 'not_pending',
  'an approved Announcement is not decided again');
select throws_ok($$select public.approve_announcement(0)$$, 'PT404', 'announcement_not_found', 'an unknown id');
select lives_ok($$select public.reject_announcement((pg_temp.ann('Ann pending #4700')).id, 'Lipsesc detaliile.')$$, 'BC rejects with a reason');
reset role;
select is((pg_temp.ann('Ann pending #4700')).approval_status, 'rejected', 'the Announcement is rejected');
select is((pg_temp.ann('Ann pending #4700')).rejection_reason, 'Lipsesc detaliile.', 'with the reason');
select results_eq($$select * from pg_temp.told('Anunțul tău a fost respins: Ann pending #4700')$$, $$values (1)$$, 'the author is told');
select is((select body from notifications where title = 'Anunțul tău a fost respins: Ann pending #4700' limit 1), 'Lipsesc detaliile.', 'with the reason as the body');
select pg_temp.test_login_leadership(pg_temp.u47(4));
select is((select count(*) from announcements where title = 'Ann pending #4700'), 0::bigint, 'a rejected Announcement stays invisible to others');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(1));
update announcements set body = 'now with details' where title = 'Ann pending #4700';
reset role;
select is((pg_temp.ann('Ann pending #4700')).approval_status, 'pending', 'the author''s edit re-submits a rejected Announcement');
select is((pg_temp.ann('Ann pending #4700')).rejection_reason, null, 'and clears the reason');
select pg_temp.test_login_leadership(pg_temp.u47(3));
update announcements set body = 'tidied by the Moderator' where title = 'Ann pending #4700';
select lives_ok($$select public.approve_announcement((pg_temp.ann('Ann pending #4700')).id)$$, 'the Moderator edits and approves it');
reset role;
select is((pg_temp.ann('Ann pending #4700')).approval_status, 'approved', 'approved');
select is((pg_temp.ann('Ann pending #4700')).approval_decided_by, pg_temp.u47(3), 'by the Moderator');
select is((pg_temp.ann('Ann pending #4700')).created_by, pg_temp.u47(1), 'still posted by its author');
select results_eq($$select * from pg_temp.told('Anunț nou: Ann pending #4700')$$, $$values (4), (5)$$,
  'the fan-out runs once, on approval, and never to the author');
select results_eq($$select * from pg_temp.told('Anunțul tău a fost aprobat: Ann pending #4700')$$, $$values (1)$$, 'the author is told');
select pg_temp.test_login_leadership(pg_temp.u47(4));
select is((select count(*) from announcements where title = 'Ann pending #4700'), 1::bigint, 'and everyone reads it now');
reset role;

-- ==================== 6. Events: approval and the Announcement on behalf ====================
select pg_temp.test_login_leadership(pg_temp.u47(3));
select lives_ok($$select public.approve_event((pg_temp.ev('Ev pending #4700')).id)$$, 'the Moderator approves the Event');
select lives_ok($$select public.approve_event((pg_temp.ev('Ev announced #4700')).id)$$, 'and the announced one');
select throws_ok($$select public.approve_event((pg_temp.ev('Ev pending #4700')).id)$$, 'PT409', 'not_pending', 'not twice');
select throws_ok($$select public.reject_event((pg_temp.ev('Ev by BC #4700')).id, 'x')$$, 'PT409', 'not_pending', 'nor an approved one rejected');
reset role;
select results_eq($$select * from pg_temp.told('Eveniment nou: Ev pending #4700')$$, $$values (4), (5)$$,
  'the audience hears of the approved Event once, the author not');
select is((select count(*) from pg_temp.told('Eveniment nou: Ev announced #4700'))::int, 0,
  'an announced Event tells through its Announcement only');
select is((pg_temp.ann('Ev announced #4700')).created_by, pg_temp.u47(1), 'the Announcement is written as the Event''s author');
select is((pg_temp.ann('Ev announced #4700')).approval_status, 'approved', 'approved');
select is((pg_temp.ev('Ev announced #4700')).announce_on_approval, false, 'and the flag is spent');
select results_eq($$select * from pg_temp.told('Anunț nou: Ev announced #4700')$$, $$values (4), (5)$$, 'its fan-out ran, never to the author');
select results_eq($$select * from pg_temp.told('Evenimentul tău a fost aprobat: Ev pending #4700')$$, $$values (1)$$, 'the author is told');

-- ==================== 7. the requests read ====================
select pg_temp.test_login_leadership(pg_temp.u47(1));
insert into announcements (title, body, group_id, audience) select 'Ann listed #4700', 'x', org, 'org' from fx47;
select lives_ok($$select public.create_event('Ev listed #4700', 'activitate', (select org from fx47), '2031-06-01 10:00+00')$$, 'one more of each, pending');
select is((select count(*) from public.approval_requests()), 0::bigint, 'the read answers nothing below BC');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(2));
select results_eq($$select kind, title from public.approval_requests() where title like '%#4700'$$,
  $$values ('event', 'Ev listed #4700'), ('announcement', 'Ann listed #4700'), ('announcement', 'Ann approved later #4700')$$,
  'BC lists the pending rows of both kinds, newest first');
reset role;
select pg_temp.test_clear_jwt(); set local role authenticated;
select throws_ok($$select public.approve_announcement(1)$$, '42501', null, 'no claims, no decision');
reset role;
```

Run: `npx supabase test db supabase/tests/approvals.test.sql`
Expected: FAIL — `function public.approve_announcement(bigint) does not exist`.

- [ ] **Step 2: Sections 7–9**

```sql
-- ==================== 7. the decisions ====================
create function private.approval_decider() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := private.require_active_member();
  if coalesce(private.actor_level(v_actor), 0) < 6 then
    raise exception using errcode = '42501', message = 'approval_forbidden';
  end if;
  return v_actor;
end; $$;
revoke execute on function private.approval_decider() from public, anon, authenticated, service_role;

create function private.require_rejection_reason(p_reason text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise sqlstate 'PT400' using message = 'rejection_reason_required';
  end if;
  if char_length(btrim(p_reason)) > 1000 then
    raise sqlstate 'PT400' using message = 'rejection_reason_too_long';
  end if;
  return btrim(p_reason);
end; $$;
revoke execute on function private.require_rejection_reason(text) from public, anon, authenticated, service_role;

create function private.approve_announcement_impl(p_id bigint) returns public.announcements
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_row public.announcements%rowtype; v_decider text;
begin
  v_actor := private.approval_decider();
  select * into v_row from public.announcements where id = p_id for no key update;
  if not found then raise sqlstate 'PT404' using message = 'announcement_not_found'; end if;
  if v_row.approval_status <> 'pending' then raise sqlstate 'PT409' using message = 'not_pending'; end if;
  perform set_config('osubb.deciding_approval', 'on', true);
  update public.announcements
     set approval_status = 'approved', approval_decided_by = v_actor, approval_decided_at = now(), rejection_reason = null
   where id = p_id returning * into v_row;
  perform set_config('osubb.deciding_approval', 'off', true);
  -- The notice the Announcement would have given when written: once, now, never to its author.
  perform private.fan_out_announcement_row(v_row, v_row.created_by);
  select full_name into v_decider from public.profiles where id = v_actor;
  perform private.notify(array[v_row.created_by], 'announce', 'Anunțul tău a fost aprobat: ' || v_row.title,
    'Publicat de ' || coalesce(v_decider, 'BC') || '.', null, 'approval:announcements:' || p_id::text || ':approved', v_actor,
    '/anunturi?anunt=' || p_id::text);
  return v_row;
end; $$;

create function private.reject_announcement_impl(p_id bigint, p_reason text) returns public.announcements
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_row public.announcements%rowtype; v_reason text;
begin
  v_reason := private.require_rejection_reason(p_reason);
  v_actor := private.approval_decider();
  select * into v_row from public.announcements where id = p_id for no key update;
  if not found then raise sqlstate 'PT404' using message = 'announcement_not_found'; end if;
  if v_row.approval_status <> 'pending' then raise sqlstate 'PT409' using message = 'not_pending'; end if;
  perform set_config('osubb.deciding_approval', 'on', true);
  update public.announcements
     set approval_status = 'rejected', approval_decided_by = v_actor, approval_decided_at = now(), rejection_reason = v_reason
   where id = p_id returning * into v_row;
  perform set_config('osubb.deciding_approval', 'off', true);
  perform private.notify(array[v_row.created_by], 'announce', 'Anunțul tău a fost respins: ' || v_row.title,
    v_reason, null, 'approval:announcements:' || p_id::text || ':rejected', v_actor, '/anunturi?anunt=' || p_id::text);
  return v_row;
end; $$;

create function private.approve_event_impl(p_id bigint) returns public.events
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_row public.events%rowtype; v_group public.groups%rowtype; v_decider text;
begin
  v_actor := private.approval_decider();
  select * into v_row from public.events where id = p_id for no key update;
  if not found then raise sqlstate 'PT404' using message = 'event_not_found'; end if;
  if v_row.approval_status <> 'pending' then raise sqlstate 'PT409' using message = 'not_pending'; end if;
  select * into v_group from public.groups where id = v_row.group_id;
  perform set_config('osubb.deciding_approval', 'on', true);
  update public.events
     set approval_status = 'approved', approval_decided_by = v_actor, approval_decided_at = now(),
         rejection_reason = null, announce_on_approval = false
   where id = p_id returning * into v_row;
  perform set_config('osubb.deciding_approval', 'off', true);
  if (select announce_on_approval from public.events where id = p_id) is false and
     exists (select 1 from public.events where id = p_id) then null; end if;  -- (no-op; the flag was read below before the update)
  return v_row;
end; $$;
```

The approve_event body above must read the flag **before** clearing it; write it as:

```sql
  v_announce := v_row.announce_on_approval;
  update public.events set approval_status = 'approved', approval_decided_by = v_actor, approval_decided_at = now(),
         rejection_reason = null, announce_on_approval = false where id = p_id returning * into v_row;
  perform set_config('osubb.deciding_approval', 'off', true);
  if v_announce then
    -- The Announcement the Event asked for, as the Event's author (the authorship
    -- stamp honours osubb.announcement_author), approved since BC inserts it, with
    -- its own fan-out -- and never "Anunț nou" to that author.
    perform set_config('osubb.announcement_author', v_row.created_by::text, true);
    insert into public.announcements(title, body, group_id, audience, min_level, deadline, created_by)
      values (v_row.title,
              private.event_announcement_body(v_row.starts_at, v_row.ends_at, v_row.location, v_row.description),
              v_row.group_id, case when v_group.is_organization then 'org' else 'local' end,
              v_row.min_level, v_row.starts_at, v_row.created_by);
    perform set_config('osubb.announcement_author', '', true);
  else
    perform private.notify_event_created(v_row, v_row.created_by);
  end if;
  select full_name into v_decider from public.profiles where id = v_actor;
  perform private.notify(array[v_row.created_by], 'event', 'Evenimentul tău a fost aprobat: ' || v_row.title,
    'Publicat de ' || coalesce(v_decider, 'BC') || '.', null, 'approval:events:' || p_id::text || ':approved', v_actor,
    '/calendar?event=' || p_id::text);
  return v_row;
```

(declare `v_announce boolean;` and drop the no-op lines.) `reject_event_impl(p_id, p_reason)` mirrors `reject_announcement_impl` with `event_not_found`, kind `event`, title "Evenimentul tău a fost respins: …" and link `/calendar?event=<id>`.

```sql
-- ==================== 8. the wrappers and the read ====================
create function public.approve_announcement(p_id bigint) returns public.announcements
language sql set search_path = '' as $$ select private.approve_announcement_impl(p_id); $$;
create function public.reject_announcement(p_id bigint, p_reason text) returns public.announcements
language sql set search_path = '' as $$ select private.reject_announcement_impl(p_id, p_reason); $$;
create function public.approve_event(p_id bigint) returns public.events
language sql set search_path = '' as $$ select private.approve_event_impl(p_id); $$;
create function public.reject_event(p_id bigint, p_reason text) returns public.events
language sql set search_path = '' as $$ select private.reject_event_impl(p_id, p_reason); $$;

create function public.approval_requests()
returns table (kind text, id bigint, title text, group_id bigint, created_by uuid, created_at timestamptz, starts_at timestamptz)
language sql stable set search_path = '' as $$
  -- Invoker: the two read policies already show BC the pending rows; the gate
  -- keeps the list empty for everyone else.
  select * from (
    select 'announcement'::text, a.id, a.title, a.group_id, a.created_by, a.published_at, null::timestamptz
      from public.announcements as a where a.approval_status = 'pending' and a.kind = 'announcement'
    union all
    select 'event', e.id, e.title, e.group_id, e.created_by, e.created_at, e.starts_at
      from public.events as e where e.approval_status = 'pending'
  ) as pending (kind, id, title, group_id, created_by, created_at, starts_at)
   where coalesce((select private.caller_level()), 0) >= 6
   order by created_at desc, id desc;
$$;
-- comments on the five public functions (what they do, their reasons), then:
revoke execute on function private.approve_announcement_impl(bigint), private.reject_announcement_impl(bigint, text),
  private.approve_event_impl(bigint), private.reject_event_impl(bigint, text),
  public.approve_announcement(bigint), public.reject_announcement(bigint, text),
  public.approve_event(bigint), public.reject_event(bigint, text), public.approval_requests()
  from public, anon, authenticated, service_role;
grant execute on function private.approve_announcement_impl(bigint), private.reject_announcement_impl(bigint, text),
  private.approve_event_impl(bigint), private.reject_event_impl(bigint, text),
  public.approve_announcement(bigint), public.reject_announcement(bigint, text),
  public.approve_event(bigint), public.reject_event(bigint, text), public.approval_requests() to authenticated;
```

Section 9 is empty (docs live in files); keep the header as a note that `broadcast_change` on both tables already carries every change (ADR-0011).

- [ ] **Step 3: Rosters**

`supabase/tests/tracker_grants.test.sql`: wrapper rows `('approve_announcement', 'p_id bigint', false, true, false, false)`, `('reject_announcement', 'p_id bigint, p_reason text', …)`, `('approve_event', 'p_id bigint', …)`, `('reject_event', 'p_id bigint, p_reason text', …)`, `('approval_requests', '', false, true, false, false)` after `('my_unread_announcements_count', …)`; private rows `('approve_announcement_impl', 'p_id bigint', 'impl')`, `('reject_announcement_impl', 'p_id bigint, p_reason text', 'impl')`, `('approve_event_impl', …, 'impl')`, `('reject_event_impl', …, 'impl')`, `('approval_decider', '', 'none')`, `('require_rejection_reason', 'p_reason text', 'none')`, `('fan_out_announcement_row', 'p_row announcements, p_actor uuid', 'none')`, `('notify_event_created', 'p_event events, p_actor uuid', 'none')`, `('stamp_approval', '', 'trigger')`, `('request_approval', '', 'trigger')` after `('fan_out_announcement', '', 'trigger')`; the pin 220 → 230 and the message gaining "the approval flow's two trigger bodies, four decision bodies and four helpers (spec 2026-10-11)". Check the 'none' kind's meaning in the file's header comment before using it; if the roster has a different word for "no client executes it", use that.

`docs/backend/conventions.md`: after the copies paragraph, one paragraph: "**OSUBB-wide approval (spec 2026-10-11).** `approve_*` / `reject_*` refuse with `42501 approval_forbidden` below level 6, `PT404 announcement_not_found` / `event_not_found`, `PT409 not_pending`; a rejection needs `p_reason` (`PT400 rejection_reason_required`, `rejection_reason_too_long` above 1000). The approval columns are written only by `private.stamp_approval` and these commands (`osubb.deciding_approval`); an Announcement inserted on behalf of an Event's author sets `osubb.announcement_author`."

- [ ] **Step 4: Rebuild, run everything, regenerate the types, commit**

Run: `npx supabase db reset && npx supabase test db` → green (fix `plan(N)` to the count pgTAP reports for approvals.test.sql). `npx supabase db lint --level warning` → nothing new. In `app/`: `npm run gen:types` → `database.types.ts` gains the five functions and the columns.

```bash
git add supabase/migrations/20261011140000_org_wide_approval.sql supabase/tests/approvals.test.sql supabase/tests/tracker_grants.test.sql docs/backend/conventions.md app/src/lib/database.types.ts
git commit -m "feat(db): approve_/reject_ announcement and event, approval_requests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Frontend queries, presentations and copy

**Files:**

- Create: `app/src/queries/approvals.ts`, `app/src/queries/approvals.test.ts`
- Modify: `app/src/queries/keys.ts` (`approvals: { all: ['approvals'] as const }`), `app/src/queries/live-changes.ts` (changes on `announcements` and `events` also invalidate `keys.approvals.all`; read the file's table map first), `app/src/queries/events.ts` (`EVENT_FIELDS` + `approval_status, rejection_reason`; `EventPresentation.approvalStatus: 'pending' | 'approved' | 'rejected'`, `rejectionReason: string | null`; `toEventPresentation` maps them), `app/src/screens/announcements/announcements-presentation.ts` (`AnnouncementPresentation` gains the same two; `toAnnouncementPresentation` maps them) and `app/src/queries/announcements.ts` (`ANNOUNCEMENT_FIELDS` + the two columns), `app/src/lib/command-reasons.ts` (copy), every test fixture that builds a presentation literal (`approvalStatus: 'approved', rejectionReason: null` — typecheck lists them).

**Interfaces:**

- Produces: `ApprovalRequest = { kind: 'announcement' | 'event'; id: number; title: string; groupId: number; createdBy: string | null; createdAt: string; startsAt: string | null }`; `fetchApprovalRequests()`; `useApprovalRequests(kind?)` (BC/Moderator only: enabled when `useCapability('manageRoles').data === true`, else `data: []`); `useApproveAnnouncement()`, `useRejectAnnouncement()`, `useApproveEvent()`, `useRejectEvent()` — `mutateAsync({ id })` / `({ id, reason })`, throwing `CommandError`, invalidating `keys.approvals.all`, `keys.events.all`, `keys.notifications?.all` and the announcements keys (the ones `useUpdateAnnouncement` invalidates).
- Copy: `approval_forbidden` → "Doar BC și Moderatorul aprobă sau resping."; `not_pending` → "Cererea a fost deja decisă."; `rejection_reason_required` → "Scrie motivul respingerii."; `rejection_reason_too_long` → "Motivul are cel mult 1000 de caractere."; `announcement_not_found` → "Anunțul nu mai există."; `event_not_found` (if missing) → "Evenimentul nu mai există.".

- [ ] **Step 1: Failing tests** — `approvals.test.ts`: the read maps rows to `ApprovalRequest`s and calls `approval_requests`; each mutation calls its rpc with `{ p_id }` / `{ p_id, p_reason }` and turns `{ code: 'PT400', message: 'rejection_reason_required' }` into the Romanian copy. `command-reasons.test.ts` lists the new reasons if it keeps a covered list. Run: FAIL (module missing).
- [ ] **Step 2: Implement; `npm run typecheck` names every presentation literal to extend; run the touched suites green.**
- [ ] **Step 3: Commit** `feat(app): approval requests queries and presentation fields`.

---

### Task 4: The request icon and the requests sheet, in Calendar and Anunțuri

**Files:**

- Create: `app/src/components/approvals/ApprovalRequestsButton.tsx`, `ApprovalRequestsSheet.tsx`, `ApprovalRequestsButton.test.tsx`
- Modify: `app/src/screens/calendar/CalendarMonth.tsx` (after the Taskurile gestionate button, inside the same row: `<ApprovalRequestsButton kind="event" />`), `app/src/screens/calendar/CalendarAgenda.tsx` (first child of `.calendar-agenda-view`: `<div className="calendar-agenda-tools empty:hidden"><ApprovalRequestsButton kind="event" /></div>`), `app/src/screens/announcements/AnnouncementsScreen.tsx` (in the header actions, before `<AnnouncementComposeSheet />`: `<ApprovalRequestsButton kind="announcement" />`), their tests (the hook mocked: 0 → no button; 2 → the button with its count).

**Interfaces:**

- `ApprovalRequestsButton({ kind })`: renders null unless `useApprovalRequests(kind).data?.length > 0`; a `Button variant="outline" size="icon"` with `MailQuestion`, `aria-label={approvalRequestsLabel(n)}` ("1 cerere de aprobare" / "n cereri de aprobare" / "n de cereri de aprobare" from 20), the count in a destructive `Badge` on the icon's corner as the bell draws it; opens `ApprovalRequestsSheet`.
- `ApprovalRequestsSheet({ kind, open, onOpenChange })`: a `Sheet` titled "Cereri de aprobare"; rows (title, `MemberName` of the author via `useMemberIdentities`, the Group's name via `useGroups`, "cerută <relative time>" and the Event's date); a row opens the review form (Task 5 / Task 6) for that item: announcements through `useAnnouncementsFeed` (the feed already holds the pending rows for BC) by id, events through `useEvent(id)`; a receipt line after a decision ("Anunțul a fost publicat." / "… respins." / "Evenimentul …") and the list refetched.

- [ ] **Step 1: Failing tests** — button hidden at 0 and for a non-BC viewer; shown with "2 cereri de aprobare" at 2; the sheet lists the two titles and authors; CalendarMonth/CalendarAgenda/AnnouncementsScreen render the button where the spec says (mock `useApprovalRequests`). Run: FAIL.
- [ ] **Step 2: Implement** (the row click wiring to the forms lands in Tasks 5–6; here the row is a button that calls `onOpen(request)` and the sheet keeps `reviewing: ApprovalRequest | null`).
- [ ] **Step 3: Commit** `feat(app): the Cereri de aprobare icon and list in Calendar and Anunțuri`.

---

### Task 5: Review mode on the Announcement edit sheet

**Files:**

- Modify: `app/src/screens/announcements/AnnouncementEditSheet.tsx` (prop `review?: { onDecided: (outcome: 'approved' | 'rejected') => void }`; in review mode the footer is Respinge — a `TaskReasonDialog` with `field="reason"`, `fieldLabel="Motivul respingerii"`, `title="Respinge anunțul"`, `confirmLabel="Respinge"`, `onConfirm={(reason) => reject.mutateAsync({ id, reason })}`, `onSuccess={() => review.onDecided('rejected')}` — and **Aprobă și publică** (primary): validate, save the changes if any through `update.mutateAsync`, then `approve.mutateAsync({ id })`, then `review.onDecided('approved')`; a refusal lands through `form.fail`), `ApprovalRequestsSheet.tsx` (opens it for `kind === 'announcement'`), tests `AnnouncementEditSheet.test.tsx` (or the sheet's existing suite) and `ApprovalRequestsButton.test.tsx`.

- [ ] **Step 1: Failing tests** — in review mode the footer reads Respinge / Aprobă și publică; Aprobă with an edited title calls update then approve and reports approved; Aprobă with nothing changed skips the update; Respinge needs a reason ("Scrie motivul respingerii." under the field) then calls reject and reports rejected; a server `not_pending` shows in the form. Run: FAIL.
- [ ] **Step 2: Implement; run green; commit** `feat(app): approve or reject an Announcement from its edit sheet`.

---

### Task 6: Review mode on the Event form

**Files:**

- Modify: `app/src/screens/calendar/EventManageControls.tsx` (extract and export `EditEventSheet({ event, groups, options, open, onOpenChange, review?, onSaved })` from `EditEventDialog`, which keeps its Editează button and renders it), `ApprovalRequestsSheet.tsx` (for `kind === 'event'`: `useEvent(id)`, `useEventFormOptions()`, `useGroups()` map; opens `EditEventSheet` with `review`), tests.

- [ ] **Step 1: Failing tests** — `EditEventSheet` in review mode: footer Respinge / Aprobă și publică; Aprobă with a changed field calls `updateEvent` then `approve_event`; unchanged skips the update; Respinge needs a reason then calls `reject_event`. The requests sheet opens it for an event row. Run: FAIL.
- [ ] **Step 2: Implement; run green; commit** `feat(app): approve or reject an Event from its edit sheet`.

---

### Task 7: The author's side — badges, reasons, receipts

**Files:**

- Modify: `app/src/screens/announcements/AnnouncementMeta.tsx` (a `Badge`: "În așteptare" for pending, "Respins" for rejected, destructive-outline), `AnnouncementDetailsSheet.tsx` (a paragraph "Respins: <reason>" under the meta for a rejected row; Editează stays for the author), `AnnouncementComposeSheet.tsx` (receipt "Anunțul așteaptă aprobarea BC." when the chosen Group is the Organization Group and `claims.member_level < 6`), `app/src/screens/calendar/EventCard.tsx` (`event-pending-badge` "În așteptare" / "Respins" beside the cancelled badge; the reason block as the cancellation's), `NewEventControl.tsx` (`created.approval_status === 'pending'` → `setEventReceipt(id, 'Evenimentul așteaptă aprobarea BC.' + (announce ? ' Anunțul lui va fi publicat odată cu el.' : ''))`), the CSS beside `event-cancelled-badge`, tests for each.

- [ ] **Step 1: Failing tests; Step 2: implement, green; Step 3: commit** `feat(app): pending and rejected Announcements and Events say so to their author`.

---

### Task 8: Documents, gates, live check

- `docs/adr/0008-calendar-visibility.md`: an **Amended:** 2026-10-11 line — an OSUBB-wide Event by a writer below BC is pending until BC/Moderator approve it; pending rows read only for the author and BC; the "Eveniment nou" notice moves to approval.
- `CONTEXT.md`: under Communication, **Cerere de aprobare** (an OSUBB-wide Announcement or Event by a Member below BC, waiting for a BC member or the Moderator to approve it from its own form or reject it with a reason; visible only to its author and BC until approved; an author's later edit asks again); the Announcement and Event entries gain one sentence each.
- The grill plan: ruling R49 with Alex's words.
- Gates: `npx supabase db reset && npx supabase test db`; in `app/`: `npm run gen:types` (no diff), `npm run typecheck && npm run lint && npm run format:check && npm run test:run`; `npm run check:root`.
- Live: as a BCE with a Group Role (seed `bce@demo.osubb`), post an OSUBB-wide Announcement → "Anunțul așteaptă aprobarea BC.", the card badge; as BC the icon with 1 on Anunțuri, the sheet, Aprobă și publică → the receipt and the badge gone; the same for an Event in Calendar; the icon absent at 0.
- Commit `docs: Cerere de aprobare in ADR-0008, CONTEXT.md and the grill plan`; push the branch.
