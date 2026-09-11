-- points_ledger_semantics.test.sql — #162: the ledger vocabulary is task /
-- task_reversal / sanction (manual awards left retired by #261). Task rows
-- must reference their task; sanctions must be negative and explained.
-- Supersedes manual_awards.test.sql (#261), whose still-meaningful
-- assertions (a manual_award insert is rejected, including one attempted by
-- an active BC) move here now that the CHECK constraints — not a trigger —
-- are what reject it.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(13);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000162', 'ana.ledgersemantics@test.local'),
  ('26200000-0000-0000-0000-000000000001', '262.bc@test.local');

insert into profiles (id, full_name, email, role, status) values
  ('aaaaaaaa-0000-0000-0000-000000000162', 'Ana Test', 'ana.ledgersemantics@test.local', 'voluntar', 'activ'),
  ('26200000-0000-0000-0000-000000000001', '262 BC', '262.bc@test.local', 'bc', 'activ');

-- A task fixture so 'task'/'task_reversal' rows (which now require a
-- task_id) can be inserted below.
insert into tasks (title, difficulty, dept_id)
  values ('ledger-semantics-fixture-162', 3, 'edu');

-- ==================== 'task' requires a task_id ====================
select lives_ok(
  $$ insert into points_ledger (member_id, delta, reason, task_id)
     select 'aaaaaaaa-0000-0000-0000-000000000162', 5, 'task', id
       from tasks where title = 'ledger-semantics-fixture-162' $$,
  'a task row with a task_id is accepted');

select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason)
     values ('aaaaaaaa-0000-0000-0000-000000000162', 5, 'task') $$,
  '23514', null,
  'a task row without a task_id is rejected');

-- ==================== 'task_reversal' requires a task_id too ====================
select lives_ok(
  $$ insert into points_ledger (member_id, delta, reason, task_id)
     select 'aaaaaaaa-0000-0000-0000-000000000162', -5, 'task_reversal', id
       from tasks where title = 'ledger-semantics-fixture-162' $$,
  'a task_reversal row with a task_id is accepted');

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
  'a sanction with a whitespace-only note is rejected');

select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, note, task_id)
     select 'aaaaaaaa-0000-0000-0000-000000000162', -3, 'sanction', 'test sanction', id
       from tasks where title = 'ledger-semantics-fixture-162' $$,
  '23514', null,
  'a sanction with a task_id is rejected');

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

-- ==================== manual_award is doubly blocked for an authenticated actor ====================
-- The #261 trigger fired before RLS for every role, so a BC's manual_award
-- attempt used to surface 23514 regardless of privilege. Dropping it in
-- favor of the CHECK changes which layer answers first: RLS's WITH CHECK is
-- evaluated before table CHECK constraints for a non-owner role (proven by
-- the "BC may still sanction" case below, which passes RLS then fails the
-- shape CHECK when malformed — see rls_tasks_points.test.sql), and
-- ledger_sanction admits only reason = 'sanction'. So an active BC now hits
-- RLS (42501) before the constraint is ever reached; only a session that
-- bypasses RLS (e.g. the owner-run inserts above) surfaces the CHECK's
-- 23514 directly.
select pg_temp.test_login('26200000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));

select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, awarded_by)
     values ('26200000-0000-0000-0000-000000000001', 5, 'manual_award',
             '26200000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'an active BC cannot create a manual award — no policy admits the reason, so RLS denies it');

select lives_ok(
  $$ insert into points_ledger (member_id, delta, reason, note, awarded_by)
     values ('26200000-0000-0000-0000-000000000001', -1, 'sanction', 'test sanction',
             '26200000-0000-0000-0000-000000000001') $$,
  'an active BC may still create a properly-shaped sanction');

reset role;

select * from finish();
rollback;
