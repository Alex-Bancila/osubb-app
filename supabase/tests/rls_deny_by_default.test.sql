-- rls_deny_by_default.test.sql — Epic 3.1: RLS everywhere, deny-by-default.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(26);

-- ==================== Every table has RLS enabled ====================
select is(
  (select count(*) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0::bigint, 'no table in public is missing row level security');

-- ==================== role_capabilities seed (spec §4.1) ====================
select is((select count(*) from role_capabilities), 17::bigint,
  'capability seed has the expected size');
select is((select count(*) from role_capabilities where role = 'moderator'), 6::bigint,
  'moderator holds every capability');
select is((select count(*) from role_capabilities where role = 'recrut'), 0::bigint,
  'recrut holds none');
select is((select count(*) from role_capabilities where capability = 'createTeams'), 3::bigint,
  'createTeams is level >= 5 (three roles)');
select ok(
  not exists (select 1 from role_capabilities
               where capability = 'createTeams'
                 and role not in ('bce', 'bc', 'moderator')),
  'createTeams goes only to bce/bc/moderator');

-- ==================== Fixtures: a row in every table ====================
-- The sweep below is only as strong as this block. An empty table proves
-- nothing, so every table in public gets at least one row and an assertion
-- enforces that. This is not hypothetical: the open-task leak survived
-- review because the only fixture task defaulted to status 'todo', so the
-- unconditional `or status = 'open'` branch of task_read was never exercised.
insert into auth.users (id, email) values
  ('ffffffff-0000-0000-0000-000000000006', 'flavia.rls@test.local');
insert into profiles (id, full_name, email, role) values
  ('ffffffff-0000-0000-0000-000000000006', 'Flavia Test', 'flavia.rls@test.local', 'voluntar');
insert into member_departments (member_id, dept_id)
  values ('ffffffff-0000-0000-0000-000000000006', 'edu');
insert into teams (id, name, dept_id) values ('t-rls', 'RLS Team', 'edu');
insert into team_members (team_id, member_id)
  values ('t-rls', 'ffffffff-0000-0000-0000-000000000006');

insert into tasks (title, difficulty) values ('rls-t1', 3);
insert into task_assignees (task_id, member_id)
  select id, 'ffffffff-0000-0000-0000-000000000006'::uuid from tasks where title = 'rls-t1';
update tasks set rating = 4 where title = 'rls-t1';   -- writes points_ledger via trigger
insert into task_requests (kind, title, from_member)
  values ('award', 'rls-req', 'ffffffff-0000-0000-0000-000000000006');

-- An OPEN, already-GRADED task: the shape that leaked, and the one an
-- unprovisioned session could have joined to collect points.
insert into tasks (title, difficulty, status) values ('rls-open', 2, 'open');
update tasks set rating = 3 where title = 'rls-open';

insert into events (title, type, scope) values ('rls-event', 'sedinta', 'org');
insert into event_attendance (event_id, member_id)
  select id, 'ffffffff-0000-0000-0000-000000000006'::uuid from events where title = 'rls-event';
insert into announcements (title, body) values ('rls-announce', 'corp');
insert into announcement_reads (announcement_id, member_id)
  select id, 'ffffffff-0000-0000-0000-000000000006'::uuid
    from announcements where title = 'rls-announce';
insert into notifications (member_id, kind, title)
  values ('ffffffff-0000-0000-0000-000000000006', 'announce', 'rls-noti');
insert into push_tokens (member_id, token, platform)
  values ('ffffffff-0000-0000-0000-000000000006', 'rls-token', 'web');

-- ==================== The claimless sweep (AC) ====================
-- `set role authenticated` with no JWT is ADR-0003's gate-2 session: someone
-- who authenticated but carries no org claims — never invited, or deactivated
-- since their token was issued. auth_level() reads 0 (same as a recrut) and
-- auth.uid() is null. Nothing in the app is theirs to see.
--
-- Swept over every table rather than a fixed list, so a future policy with an
-- unconditional branch (`using (true)`, `or status = 'open'`, `or scope =
-- 'org'`) fails here on the day it lands.
create function pg_temp.unpopulated_tables() returns text[]
language plpgsql as $$
declare
  t record; n bigint; empty text[] := '{}';
begin
  for t in
    select c.relname from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r'
     order by c.relname
  loop
    execute format('select count(*) from public.%I', t.relname) into n;
    if n = 0 then empty := empty || t.relname; end if;
  end loop;
  return empty;
end $$;

create function pg_temp.tables_visible_to_claimless() returns text[]
language plpgsql as $$
declare
  t record; n bigint; leaks text[] := '{}';
begin
  for t in
    select c.relname from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r'
     order by c.relname
  loop
    execute format('select count(*) from public.%I', t.relname) into n;
    if n > 0 then leaks := leaks || t.relname; end if;
  end loop;
  return leaks;
end $$;

-- Non-vacuity first: if a table is empty, the sweep below says nothing about it.
select is(pg_temp.unpopulated_tables(), '{}'::text[],
  'every table holds a row, so the sweep cannot pass hollow');

-- Row ids captured while we can still see them. A write attempt phrased as
-- `insert … select … from tasks where …` would insert zero rows once the
-- claimless session can no longer see the task — no rows, no policy check,
-- no exception, and a test that passes for the wrong reason.
create temp table fx as
  select (select id from tasks where title = 'rls-open') as open_task_id;
grant select on fx to authenticated;

set local role authenticated;

select is(pg_temp.tables_visible_to_claimless(), '{}'::text[],
  'a session without org claims reads nothing, from any table');

-- The sensitive core, named explicitly — a sweep failure reports a table, but
-- these say what was actually at stake.
select is((select count(*) from profiles),       0::bigint, 'claimless: profiles hidden');
select is((select count(*) from tasks),          0::bigint, 'claimless: tasks hidden, open ones included');
select is((select count(*) from task_assignees), 0::bigint, 'claimless: task_assignees hidden');
select is((select count(*) from task_requests),  0::bigint, 'claimless: task_requests hidden');
select is((select count(*) from points_ledger),  0::bigint, 'claimless: points_ledger hidden');

-- Views are security_invoker, so they inherit the tables' answers.
select is((select count(*) from member_points),  0::bigint, 'claimless: member_points empty');
select is((select count(*) from leaderboard),    0::bigint, 'claimless: leaderboard empty');
select is((select count(*) from dept_cup),       0::bigint, 'claimless: dept_cup empty');

-- …and writes nothing either.
select throws_ok(
  $$ insert into task_requests (kind, title) values ('award', 'sneaky') $$,
  '42501', null, 'claimless: cannot file a task request');

select throws_ok(
  format($$ insert into task_assignees (task_id, member_id)
            values (%s, 'ffffffff-0000-0000-0000-000000000006') $$,
         (select open_task_id from fx)),
  '42501', null, 'claimless: cannot claim an open task');

reset role;

-- ==================== anon is shut out entirely ====================
set local role anon;

select throws_ok(
  $$ select count(*) from profiles $$,
  '42501', null, 'anon: no table grants at all (invite-only, ADR-0003)');

reset role;

-- ==================== Token issuance survives RLS ====================
-- The 2.2 policies for supabase_auth_admin must let the claims hook read
-- profiles now that RLS is enabled — otherwise every login would break.
-- (postgres may not SET ROLE to supabase_auth_admin locally, so assert the
-- two ingredients directly: the grant and a permissive policy on each table.)
select ok(has_table_privilege('supabase_auth_admin', 'profiles', 'select'),
  'supabase_auth_admin holds SELECT on profiles');

select is(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'roles', 'member_departments', 'team_members')
      and 'supabase_auth_admin' = any (roles)),
  4::bigint, 'claims-hook read policies cover all four tables (logins keep working)');

-- ==================== Grant posture ====================
-- Epic 3.2a narrowed this from a table grant to column grants: members may
-- select a profile's public columns, never email/phone. The grant still
-- exists — RLS is what decides *which rows* come back.
select ok(has_any_column_privilege('authenticated', 'profiles', 'select'),
  'authenticated keeps a SELECT grant — RLS does the row denying');
select ok(not has_column_privilege('authenticated', 'profiles', 'email', 'select'),
  'the contact columns are not part of that grant');
select ok(not has_table_privilege('authenticated', 'profiles', 'truncate'),
  'authenticated cannot TRUNCATE (not governed by RLS)');
select ok(not has_table_privilege('anon', 'profiles', 'select'),
  'anon has no SELECT grant');
select ok(has_table_privilege('service_role', 'profiles', 'select'),
  'service_role keeps DML for admin flows');

select * from finish();
rollback;
