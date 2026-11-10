-- points_ledger_semantics.test.sql — #162: the ledger vocabulary is task /
-- task_reversal / sanction (manual awards left retired by #261). Task rows
-- must reference their task; sanctions must be negative and explained.
-- Supersedes manual_awards.test.sql (#261), whose still-meaningful
-- assertions (a manual_award insert is rejected, including one attempted by
-- an active BC) move here now that the CHECK constraints — not a trigger —
-- are what reject it.
--
-- #1182 (audit L4): no client role inserts into the ledger any more. The
-- direct Sanction path (policy points_ledger_create_sanction and the INSERT
-- grant to authenticated) is closed until #104 builds a Sanction command, so
-- every direct insert by a signed-in Member stops at the table grant.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(25);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000162', 'ana.ledgersemantics@test.local'),
  ('26200000-0000-0000-0000-000000000001', '262.bc@test.local'),
  ('26200000-0000-0000-0000-000000000002', '262.bc.inactive@test.local');

insert into profiles (id, full_name, email, role, status) values
  ('aaaaaaaa-0000-0000-0000-000000000162', 'Ana Test', 'ana.ledgersemantics@test.local', 'voluntar', 'activ'),
  ('26200000-0000-0000-0000-000000000001', '262 BC', '262.bc@test.local', 'bc', 'activ'),
  ('26200000-0000-0000-0000-000000000002', '262 BC Inactive', '262.bc.inactive@test.local', 'bc', 'inactiv');

-- A graded Task with its Assignment and Evaluation, so 'task'/'task_reversal'
-- rows (which need a task_id from #162 and an evaluation_id from #317) can be
-- inserted below.
insert into tasks (title, difficulty, rating, status, completed_at, group_id)
  values ('ledger-semantics-fixture-162', 3, 4, 'completed', now(), pg_temp.dept_group('edu'));

insert into task_assignments (task_id, member_id, ended_at, end_reason)
  select id, 'aaaaaaaa-0000-0000-0000-000000000162', completed_at, 'completed'
    from tasks where title = 'ledger-semantics-fixture-162';

insert into task_evaluations
  (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
  select task.id, assignment.id, 'aaaaaaaa-0000-0000-0000-000000000162',
         'completed', task.difficulty, task.rating,
         task.difficulty * rating_mult(task.rating), 'semantics fixture evaluation'
    from tasks task
    join task_assignments assignment on assignment.task_id = task.id
   where task.title = 'ledger-semantics-fixture-162';

-- ==================== 'task' requires a task_id and an Evaluation ====================
select lives_ok(
  $$ insert into points_ledger (member_id, delta, reason, task_id, evaluation_id)
     select 'aaaaaaaa-0000-0000-0000-000000000162', 5, 'task',
            evaluation.task_id, evaluation.id
       from task_evaluations evaluation
       join tasks task on task.id = evaluation.task_id
      where task.title = 'ledger-semantics-fixture-162' $$,
  'a task row with a task_id and an evaluation_id is accepted');

select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason)
     values ('aaaaaaaa-0000-0000-0000-000000000162', 5, 'task') $$,
  '23514', null,
  'a task row without a task_id is rejected');

-- #317: the Evaluation is as required as the Task. A task row that names
-- only its Task is a credit nobody decided.
select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, task_id)
     select 'aaaaaaaa-0000-0000-0000-000000000162', 5, 'task', id
       from tasks where title = 'ledger-semantics-fixture-162' $$,
  '23514', null,
  'a task row without an evaluation_id is rejected (#317)');

-- ==================== 'task_reversal' requires both too ====================
select lives_ok(
  $$ insert into points_ledger (member_id, delta, reason, task_id, evaluation_id)
     select 'aaaaaaaa-0000-0000-0000-000000000162', -5, 'task_reversal',
            evaluation.task_id, evaluation.id
       from task_evaluations evaluation
       join tasks task on task.id = evaluation.task_id
      where task.title = 'ledger-semantics-fixture-162' $$,
  'a task_reversal row with a task_id and an evaluation_id is accepted');

select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason)
     values ('aaaaaaaa-0000-0000-0000-000000000162', -5, 'task_reversal') $$,
  '23514', null,
  'a task_reversal row without a task_id is rejected');

-- ==================== 'sanction' is negative, explained, and untethered from a task ====================
select lives_ok(
  $$ insert into points_ledger (member_id, delta, reason, note)
     values ('aaaaaaaa-0000-0000-0000-000000000162', -3, 'sanction', 'test sanction') $$,
  'a sanction with a negative delta and a note is accepted');

select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, note)
     values ('aaaaaaaa-0000-0000-0000-000000000162', 3, 'sanction', 'test sanction') $$,
  '23514', null,
  'a sanction with a positive delta is rejected');

select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, note)
     values ('aaaaaaaa-0000-0000-0000-000000000162', -3, 'sanction', '') $$,
  '23514', null,
  'a sanction with a blank note is rejected');

select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, note)
     values ('aaaaaaaa-0000-0000-0000-000000000162', -3, 'sanction', '   ') $$,
  '23514', null,
  'a sanction with a whitespace-only (spaces) note is rejected');

-- btrim() only strips spaces, so the shape check uses a "has a non-space
-- character" regex instead (same predicate as events_title_not_blank_ck) —
-- a tab- or newline-only note must be rejected too.
select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, note)
     values ('aaaaaaaa-0000-0000-0000-000000000162', -3, 'sanction', E'\t') $$,
  '23514', null,
  'a sanction with a tab-only note is rejected');

select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, note)
     values ('aaaaaaaa-0000-0000-0000-000000000162', -3, 'sanction', E'\n') $$,
  '23514', null,
  'a sanction with a newline-only note is rejected');

select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, note, task_id)
     select 'aaaaaaaa-0000-0000-0000-000000000162', -3, 'sanction', 'test sanction', id
       from tasks where title = 'ledger-semantics-fixture-162' $$,
  '23514', null,
  'a sanction with a task_id is rejected');

-- #317: and a sanction may not borrow an Evaluation either — sanctions are
-- governance, not Task work.
select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, note, evaluation_id)
     select 'aaaaaaaa-0000-0000-0000-000000000162', -3, 'sanction', 'test sanction',
            evaluation.id
       from task_evaluations evaluation
       join tasks task on task.id = evaluation.task_id
      where task.title = 'ledger-semantics-fixture-162' $$,
  '23514', null,
  'a sanction with an evaluation_id is rejected (#317)');

-- ==================== Retired and unknown reasons ====================
select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason)
     values ('aaaaaaaa-0000-0000-0000-000000000162', 5, 'manual_award') $$,
  '23514', null,
  'a manual_award row is rejected — #261 retired the vocabulary, #162 makes it a CHECK violation');

select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason)
     values ('aaaaaaaa-0000-0000-0000-000000000162', 5, 'not_a_real_reason') $$,
  '23514', null,
  'an arbitrary reason string is rejected');

-- ==================== no signed-in Member inserts directly (#1182) ====================
-- Since #1182 authenticated holds no INSERT on the ledger, so a direct insert
-- is refused by the table grant (42501) before RLS or any CHECK is consulted,
-- whatever its reason. Only the owner-run inserts above, standing in for the
-- commands, reach the CHECK constraints and their 23514.
select pg_temp.test_login('26200000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));

select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, awarded_by)
     values ('26200000-0000-0000-0000-000000000001', 5, 'manual_award',
             '26200000-0000-0000-0000-000000000001') $$,
  '42501', 'permission denied for table points_ledger',
  'an active BC cannot create a manual award: the table grant refuses it');

select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, note, awarded_by)
     values ('26200000-0000-0000-0000-000000000001', -1, 'sanction', 'test sanction',
             '26200000-0000-0000-0000-000000000001') $$,
  '42501', 'permission denied for table points_ledger',
  'an active BC cannot write a Sanction by a direct insert: the path is closed until #104 builds a command (#1182)');

reset role;

-- ==================== an inactive BC is denied both paths ====================
-- The table grant refuses every signed-in Member (#1182), active or not.
select pg_temp.test_login('26200000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));

select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, awarded_by)
     values ('26200000-0000-0000-0000-000000000002', 5, 'manual_award',
             '26200000-0000-0000-0000-000000000002') $$,
  '42501', 'permission denied for table points_ledger',
  'an inactive BC cannot create a manual award: the table grant refuses it');

select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, note, awarded_by)
     values ('26200000-0000-0000-0000-000000000002', -1, 'sanction', 'test sanction',
             '26200000-0000-0000-0000-000000000002') $$,
  '42501', 'permission denied for table points_ledger',
  'an inactive BC cannot create a sanction: the table grant refuses it');

reset role;

-- ==================== a claimless session is denied too ====================
-- Same real BC uid as above, but a token with no org claims at all (never
-- invited, or issued before the claims hook ran); the grant refuses it too.
select pg_temp.test_login('26200000-0000-0000-0000-000000000001', '{"provider":"email"}'::jsonb);

select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, awarded_by)
     values ('26200000-0000-0000-0000-000000000001', 5, 'manual_award',
             '26200000-0000-0000-0000-000000000001') $$,
  '42501', 'permission denied for table points_ledger',
  'a claimless session cannot create a manual award: the table grant refuses it');

reset role;

-- ==================== grants shape who can even reach RLS ====================
select ok(
  not has_table_privilege('authenticated', 'public.points_ledger', 'insert'),
  'authenticated holds no INSERT on the ledger: every row is written by a command (#1182)');
select ok(
  not has_sequence_privilege('authenticated', 'public.points_ledger_id_seq', 'usage'),
  'nor USAGE on its id sequence, which only the direct insert needed (#1182)');
select is_empty(
  $$ select policyname::text from pg_policies
      where schemaname = 'public' and tablename = 'points_ledger'
        and cmd in ('INSERT', 'ALL') $$,
  'no INSERT policy is left on the ledger: points_ledger_create_sanction is dropped (#1182)');
-- Every writer runs as the owner, so the revoke cannot break a command: a
-- security-invoker body that inserted into the ledger would now fail for its
-- signed-in caller.
select is_empty(
  $$ select p.oid::regprocedure::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
        and p.prosrc ~* 'insert\s+into\s+public\.points_ledger'
        and not p.prosecdef $$,
  'every function that inserts into the ledger is security definer (#1182)');
select ok(
  not has_table_privilege('anon', 'public.points_ledger', 'insert'),
  'anonymous clients cannot insert ledger rows');

select * from finish();
rollback;
