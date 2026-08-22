-- rls_deny_by_default.test.sql — Epic 3.1: RLS everywhere, deny-by-default.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(23);

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

-- ==================== Fixtures: data that could leak ====================
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
update tasks set rating = 4 where title = 'rls-t1';
insert into task_requests (kind, title, from_member)
  values ('award', 'rls-req', 'ffffffff-0000-0000-0000-000000000006');

-- ==================== Nothing leaks without an explicit policy (AC) ====================
-- Written as a sweep rather than a fixed list: as each Epic-3 issue opens a
-- slice, that table drops out of the sweep automatically and its own suite
-- asserts the exact rows it now shows. Any *new* table that reaches main
-- without a considered read policy fails here on the day it lands.
create function pg_temp.tables_leaking_without_policy() returns text[]
language plpgsql as $$
declare
  t record;
  n bigint;
  leaks text[] := '{}';
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r'
       and not exists (
         select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = c.relname
            and p.cmd in ('SELECT', 'ALL')
            and p.roles && array['authenticated', 'public']::name[])
     order by c.relname
  loop
    execute format('select count(*) from public.%I', t.relname) into n;
    if n > 0 then
      leaks := leaks || t.relname;
    end if;
  end loop;
  return leaks;
end $$;

set local role authenticated;

select is(pg_temp.tables_leaking_without_policy(), '{}'::text[],
  'no table without a read policy returns rows to a member');

-- The sensitive core, named explicitly. `set role authenticated` with no JWT
-- means no claims, so auth_level() reads 0 and auth.uid() is null: this is
-- ADR-0003's "authenticated but not provisioned" stranger. Tasks and points
-- do have policies now (Epic 3.3) — they must still answer nothing here.
select is((select count(*) from profiles),       0::bigint, 'authenticated: profiles hidden');
select is((select count(*) from tasks),          0::bigint, 'authenticated: tasks hidden');
select is((select count(*) from task_assignees), 0::bigint, 'authenticated: task_assignees hidden');
select is((select count(*) from task_requests),  0::bigint, 'authenticated: task_requests hidden');
select is((select count(*) from points_ledger),  0::bigint, 'authenticated: points_ledger hidden');

-- Views are security_invoker, so they inherit the tables' answers.
select is((select count(*) from member_points),  0::bigint, 'authenticated: member_points empty');
select is((select count(*) from leaderboard),    0::bigint, 'authenticated: leaderboard empty');
select is((select count(*) from dept_cup),       0::bigint, 'authenticated: dept_cup empty');

select throws_ok(
  $$ insert into task_requests (kind, title) values ('award', 'sneaky') $$,
  '42501', null, 'authenticated: writes are denied without a policy');

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
select ok(has_table_privilege('authenticated', 'profiles', 'select'),
  'authenticated keeps the SELECT grant — RLS does the denying');
select ok(not has_table_privilege('authenticated', 'profiles', 'truncate'),
  'authenticated cannot TRUNCATE (not governed by RLS)');
select ok(not has_table_privilege('anon', 'profiles', 'select'),
  'anon has no SELECT grant');
select ok(has_table_privilege('service_role', 'profiles', 'select'),
  'service_role keeps DML for admin flows');

select * from finish();
rollback;
