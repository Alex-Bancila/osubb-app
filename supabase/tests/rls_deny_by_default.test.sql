-- rls_deny_by_default.test.sql — Epic 3.1: RLS everywhere, deny-by-default.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(40);

-- ==================== Every table has RLS enabled ====================
select is(
  (select count(*) from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0::bigint, 'no table in public is missing row level security');

select hasnt_table('public', 'role_capabilities',
  'the unused capability lookup is retired');

-- ==================== Fixtures: a row in every table ====================
-- The sweep below is only as strong as this block. An empty table proves
-- nothing, so every table in public gets at least one row and an assertion
-- enforces that. This is not hypothetical: the open-task leak survived
-- review because the only fixture task defaulted to status 'todo', so the
-- public-opportunity branch of task_read was never exercised.
insert into auth.users (id, email) values
  ('ffffffff-0000-0000-0000-000000000006', 'flavia.rls@test.local'),
  ('eeeeeeee-0000-0000-0000-000000000156', 'dana.claimless@test.local');
insert into profiles (id, full_name, email, role, status) values
  ('ffffffff-0000-0000-0000-000000000006', 'Flavia Test', 'flavia.rls@test.local', 'voluntar', 'activ'),
  ('eeeeeeee-0000-0000-0000-000000000156', 'Dana Claimless', 'dana.claimless@test.local', 'voluntar', 'inactiv');
insert into projects (name, leader_id, created_by) values
  ('RLS Project',
   'ffffffff-0000-0000-0000-000000000006',
   'ffffffff-0000-0000-0000-000000000006');
-- The project-manager invariant creates the leader membership, keeping this
-- fixture non-vacuous without a duplicate manual insert.
insert into member_departments (member_id, dept_id)
  values ('ffffffff-0000-0000-0000-000000000006', 'edu');
insert into campaigns (group_id, name, created_by)
  values (pg_temp.dept_group('edu'), 'RLS Campaign', 'ffffffff-0000-0000-0000-000000000006');
insert into teams (id, name, dept_id) values ('t-rls', 'RLS Team', 'edu');
insert into team_members (team_id, member_id)
  values ('t-rls', 'ffffffff-0000-0000-0000-000000000006');
-- #507: the Group model's two Wave 1 shadow tables. They hold no rows of
-- their own yet (#508 backfills), so without these fixtures both sweeps below
-- would pass hollow over them.
insert into groups (name, category) values ('RLS Group', 'team');
insert into group_members (group_id, member_id, group_role)
  select id, 'ffffffff-0000-0000-0000-000000000006', 'manager' from groups where name = 'RLS Group';

insert into tasks (title, difficulty, group_id) values ('rls-t1', 3, pg_temp.dept_group('edu'));
insert into task_assignments (task_id, member_id, assigned_by)
  select id, 'ffffffff-0000-0000-0000-000000000006'::uuid,
         'ffffffff-0000-0000-0000-000000000006'::uuid
    from tasks where title = 'rls-t1';
insert into task_activity (task_id, kind, actor_id, to_status)
  select id, 'created', 'ffffffff-0000-0000-0000-000000000006'::uuid, 'todo'
    from tasks where title = 'rls-t1';
insert into task_candidates (task_id, member_id)
  select id, 'ffffffff-0000-0000-0000-000000000006'::uuid from tasks where title = 'rls-t1';
-- #312: rating may only be set once completed (tasks_evaluation_inputs_ck).
-- #317 retired the sync triggers, so this update no longer writes a ledger
-- row by itself: the Evaluation and its ledger entry are written below, in
-- the order the evaluation commands will write them.
update tasks set status = 'completed', completed_at = now(), rating = 4
 where title = 'rls-t1';
-- #316: a real Evaluation record, tied to the same Task as its Assignment,
-- carrying the Task's own Difficulty and the scoring guide's points.
insert into task_evaluations
  (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
  select task.id, assignment.id, 'ffffffff-0000-0000-0000-000000000006'::uuid,
         'completed', task.difficulty, task.rating,
         task.difficulty * rating_mult(task.rating), 'rls fixture evaluation'
    from tasks task
    join task_assignments assignment on assignment.task_id = task.id
   where task.title = 'rls-t1';
-- #317: the credit itself — a task ledger row names both its Task and the
-- Evaluation that produced it (points_ledger_task_reference_ck).
insert into points_ledger (member_id, delta, reason, task_id, evaluation_id)
  select assignment.member_id, evaluation.points, 'task',
         evaluation.task_id, evaluation.id
    from task_evaluations evaluation
    join task_assignments assignment on assignment.id = evaluation.assignment_id
    join tasks task on task.id = evaluation.task_id
   where task.title = 'rls-t1';
-- #321: a Completed-work Request row, one Origin only.
insert into completed_work_requests (requester_id, group_id, description)
  values ('ffffffff-0000-0000-0000-000000000006', pg_temp.dept_group('edu'), 'rls fixture completed-work request');

-- A second row owned by the claimless uid itself: the general sweep below
-- only proves a stranger sees nothing, not that the requester branch of
-- completed_work_requests_read still requires auth_is_member(). Without
-- this row, a mutated policy reading `requester_id = auth.uid() or (...)`
-- (the auth_is_member() guard moved to cover only the manage branch) would
-- pass every assertion here, because no fixture row's requester_id matches
-- the claimless session's own uid.
insert into completed_work_requests (requester_id, group_id, description)
  values ('eeeeeeee-0000-0000-0000-000000000156', pg_temp.dept_group('edu'), 'rls fixture completed-work request (claimless owner)');

-- An OPEN task: the shape that leaked, and the one an unprovisioned session
-- could have joined. #312's tasks_evaluation_inputs_ck now makes the
-- historical "already-graded and still open" combination impossible to
-- construct at all (a todo Task can no longer carry a Rating) — the
-- remaining exposure this fixture proves closed is visibility of the row
-- itself, still todo/public/org/unassigned, to a claimless or deactivated
-- session.
insert into tasks
  (title, difficulty, status, group_id, audience, assignment_mode, queue_opened_at)
  values ('rls-open', 2, 'todo', pg_temp.dept_group('edu'), 'org', 'public', now());

insert into events (title, type, group_id, starts_at)
  values ('rls-event', 'sedinta', pg_temp.dept_group('org'), now());
insert into event_attendance (event_id, member_id)
  select id, 'ffffffff-0000-0000-0000-000000000006'::uuid from events where title = 'rls-event';
insert into announcements (title, body) values
  ('rls-announce', 'corp'),
  ('rls-announce-unread', 'corp');
insert into announcement_reads (announcement_id, member_id)
  select id, member_id
    from announcements
    cross join (values
      ('ffffffff-0000-0000-0000-000000000006'::uuid),
      ('eeeeeeee-0000-0000-0000-000000000156'::uuid)
    ) as claimless_fixture(member_id)
   where title = 'rls-announce';
insert into notifications (member_id, kind, title)
  values ('ffffffff-0000-0000-0000-000000000006', 'announce', 'rls-noti');
insert into role_history (member_id, from_role, to_role, actor_kind, reason) values
  ('eeeeeeee-0000-0000-0000-000000000156', 'recrut', 'voluntar', 'automatic', 'Claimless owner history fixture');

insert into push_tokens (member_id, token, platform)
  values ('ffffffff-0000-0000-0000-000000000006', 'rls-token', 'web');

-- ==================== The claimless sweep (AC) ====================
-- `set role authenticated` with no JWT has no caller identity at all:
-- auth_level() reads 0 (same as a recrut) and auth.uid() is null. It proves
-- the anonymous JWT shape fails closed, but cannot exercise self policies
-- against a deactivated member, whose JWT retains a real auth uid.
--
-- Swept over every table rather than a fixed list, so a future policy with an
-- unconditional branch (`using (true)`, a bare public-Task predicate, `or scope =
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
    begin
      execute format('select count(*) from public.%I', t.relname) into n;
    exception
      when insufficient_privilege then
        if has_table_privilege(
             current_user,
             format('public.%I', t.relname),
             'SELECT'
           )
           or has_any_column_privilege(
             current_user,
             format('public.%I', t.relname),
             'SELECT'
           ) then
          -- A readable table can still raise here because an RLS helper is
          -- broken or lacks EXECUTE. Preserve that diagnostic.
          raise;
        end if;

        -- With no readable columns, the permission denial itself proves that
        -- this role cannot see rows; task_assignments intentionally uses this
        -- stricter deny-by-default shape until command read paths exist.
        n := 0;
    end;
    if n > 0 then leaks := leaks || t.relname; end if;
  end loop;
  return leaks;
end $$;

-- Regression: do not disguise a permission failure inside an RLS helper as
-- an empty result merely because both errors use insufficient_privilege.
create function public.claimless_sweep_denied_helper_289()
returns boolean
language sql
stable
as $$ select true $$;
revoke all on function public.claimless_sweep_denied_helper_289()
  from public, anon, authenticated;

create table public.claimless_sweep_regression_289 (id bigint primary key);
alter table public.claimless_sweep_regression_289 enable row level security;
insert into public.claimless_sweep_regression_289 values (1);
grant select on public.claimless_sweep_regression_289 to authenticated;
create policy claimless_sweep_regression_read_289
  on public.claimless_sweep_regression_289
  for select
  to authenticated
  using (public.claimless_sweep_denied_helper_289());

set local role authenticated;
select throws_ok(
  $$ select pg_temp.tables_visible_to_claimless() $$,
  '42501', null,
  'the sweep surfaces a denied RLS helper on a readable table');
reset role;

drop table public.claimless_sweep_regression_289;
drop function public.claimless_sweep_denied_helper_289();

-- This is ADR-0003 gate 2's real deactivated-user shape: the id belongs to an
-- actual auth user and retained inactive profile, while the JWT deliberately
-- omits member_role, member_level, dept_ids, and team_ids.

-- Non-vacuity first: if a table is empty, the sweep below says nothing about it.
select is(pg_temp.unpopulated_tables(), '{}'::text[],
  'every table holds a row, so the sweep cannot pass hollow');

-- Row ids captured while we can still see them. A write attempt phrased as
-- `insert … select … from tasks where …` would insert zero rows once the
-- claimless session can no longer see the task — no rows, no policy check,
-- no exception, and a test that passes for the wrong reason.
create temp table fx as
  select
    (select id from tasks where title = 'rls-open') as open_task_id,
    (select id from announcements where title = 'rls-announce-unread') as unread_announcement_id;
grant select on fx to authenticated;

-- Be explicit: a missing JWT and a real uid with no org claims are distinct
-- security shapes. `reset role` alone does not clear a JWT from a previous
-- test persona.
select pg_temp.test_clear_jwt();
set local role authenticated;

select is(pg_temp.tables_visible_to_claimless(), '{}'::text[],
  'a session without org claims reads nothing, from any table');

-- The sensitive core, named explicitly — a sweep failure reports a table, but
-- these say what was actually at stake.
select is((select count(*) from profiles),       0::bigint, 'claimless: profiles hidden');
select is((select count(*) from tasks),          0::bigint, 'claimless: tasks hidden, open ones included');
select is((select count(*) from task_assignments), 0::bigint, 'claimless: Assignment history hidden');
select is((select count(*) from completed_work_requests), 0::bigint, 'claimless: Completed-work Requests hidden');
select is((select count(*) from points_ledger),  0::bigint, 'claimless: points_ledger hidden');

-- Views are security_invoker, so they inherit the tables' answers.
select is((select count(*) from member_points),  0::bigint, 'claimless: member_points empty');
select is((select count(*) from leaderboard),    0::bigint, 'claimless: leaderboard empty');
select is((select count(*) from dept_cup),       0::bigint, 'claimless: dept_cup empty');

-- …and writes nothing either. #345 retired the two legacy tables these
-- attempts used to target; their successors are commands, so the attempt is
-- now a command call and the denial comes from the command's own gate.
select throws_ok(
  $$ select public.create_completed_work_request('sneaky', pg_temp.dept_group('edu')) $$,
  '42501', 'request_command_forbidden', 'claimless: cannot file a Completed-work Request');

select throws_ok(
  format($$ select public.express_task_interest(%s) $$,
         (select open_task_id from fx)),
  '42501', 'task_command_forbidden', 'claimless: cannot join an open Task''s Candidate Queue');

reset role;

-- ==================== Real uid without organisation claims ====================
select pg_temp.test_login('eeeeeeee-0000-0000-0000-000000000156', jsonb_build_object('provider', 'email'));
set local role authenticated;

select is(auth.uid(), 'eeeeeeee-0000-0000-0000-000000000156'::uuid,
  'real claimless user: JWT sub remains a real auth uid');
select ok(not auth_is_member(),
  'real claimless user: no organisation metadata means not a member');
select is(pg_temp.tables_visible_to_claimless(), '{}'::text[],
  'real claimless user: no public table is readable, including owned rows');

-- These views are protected independently of their source tables: two run
-- with owner rights, while the others inherit RLS through security_invoker.
select is((select count(*) from profiles_directory), 0::bigint,
  'real claimless user: profiles_directory is empty');
select is((select count(*) from profiles_contact), 0::bigint,
  'real claimless user: profiles_contact is empty');
select is((select count(*) from member_points), 0::bigint,
  'real claimless user: member_points is empty');
select is((select count(*) from leaderboard), 0::bigint,
  'real claimless user: leaderboard is empty');
select is((select count(*) from dept_cup), 0::bigint,
  'real claimless user: dept_cup is empty');

select throws_ok(
  $$ select public.create_completed_work_request('real-uid-sneaky', pg_temp.dept_group('edu')) $$,
  '42501', 'request_command_forbidden',
  'real claimless user: cannot file a self-owned Completed-work Request');
select throws_ok(
  format($$ insert into announcement_reads (announcement_id, member_id)
            values (%s, 'eeeeeeee-0000-0000-0000-000000000156') $$,
         (select unread_announcement_id from fx)),
  '42501', null, 'real claimless user: cannot create a self-owned announcement read receipt');

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
      and tablename in ('profiles', 'roles', 'member_departments', 'team_members', 'groups', 'group_members')
      and 'supabase_auth_admin' = any (roles)),
  6::bigint, 'claims-hook read policies cover all six tables (logins keep working)');

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

-- ==================== #345: the legacy write paths are gone ====================
-- Two halves, and both are needed. First: the retired objects no longer
-- exist, so nothing can reach them by name. Second, and the point of the
-- whole issue: for one and the same live manager, in one and the same
-- session, the direct door onto `public.tasks` is shut while the command
-- door is open. Asserting only the first would be satisfied by a migration
-- that broke the Tracker outright.
select hasnt_table('public', 'task_assignees',
  '#345: the legacy multi-assignee join table is gone -- task_assignments is the Assignment History');
select hasnt_table('public', 'task_requests',
  '#345: the legacy award/new-task request table is gone -- completed_work_requests replaced it');
select hasnt_function('public', 'claim_open_task', array['bigint'],
  '#345: the legacy volunteer claim command is gone -- express_task_interest and select_task_candidate replaced it');

insert into auth.users (id, email)
  values ('34500000-0000-0000-0000-000000000001', 'bc.345@test.local');
insert into profiles (id, full_name, email, role, status)
  values ('34500000-0000-0000-0000-000000000001', 'BC 345', 'bc.345@test.local', 'bc', 'activ');

create temp table fx345 as
  select (select id from tasks where title = 'rls-t1') as task_id;
grant select on fx345 to authenticated;

select pg_temp.test_login('34500000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6,
  'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));

select throws_ok(
  $$ insert into tasks (title, difficulty, group_id, audience, assignment_mode)
     values ('345 direct insert', 1, pg_temp.dept_group('edu'), 'local', 'direct') $$,
  '42501', 'permission denied for table tasks',
  '#345: a BC with live claims cannot INSERT a Task directly');
select throws_ok(
  format($$ update tasks set title = '345 direct update' where id = %s $$,
         (select task_id from fx345)),
  '42501', 'permission denied for table tasks',
  '#345: nor UPDATE one');
select throws_ok(
  format($$ delete from tasks where id = %s $$, (select task_id from fx345)),
  '42501', 'permission denied for table tasks',
  '#345: nor DELETE one');

-- The same persona, the same session, through the command: this is what
-- makes the three denials above a retirement rather than an outage.
select lives_ok(
  $$ select public.create_task('Task prin comandă #345', 'descriere', now() + interval '7 days', 'local', 'direct', p_group_id => pg_temp.dept_group('edu')) $$,
  '#345: and the very same BC still creates a Task through public.create_task');

reset role;

select * from finish();
rollback;
