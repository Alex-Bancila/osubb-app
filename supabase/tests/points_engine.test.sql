-- points_engine.test.sql — Epic 6.2: pgTAP suite for the points engine (Epic 1.4).
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(28);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'ana.points@test.local'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bogdan.points@test.local');

insert into profiles (id, full_name, email, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Ana Test',    'ana.points@test.local',    'voluntar'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Bogdan Test', 'bogdan.points@test.local', 'voluntar');

-- Own throwaway department so dept_cup assertions stay exact even after
-- Epic 5.2 seeds demo members into the real departments.
insert into departments (id, name, short, color, kind)
  values ('tst', 'Test Dept', 'TST', '#123456', 'department');
insert into member_departments (member_id, dept_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'tst');

-- ==================== rating_mult ====================
select is(rating_mult(1), -1, 'rating 1 → multiplier -1 (penalty)');
select is(rating_mult(2),  0, 'rating 2 → multiplier 0');
select is(rating_mult(3),  1, 'rating 3 → multiplier 1');
select is(rating_mult(4),  2, 'rating 4 → multiplier 2');
select is(rating_mult(5),  3, 'rating 5 → multiplier 3');

-- ==================== Grading writes ledger rows ====================
insert into tasks (title, difficulty, dept_id) values ('pe-t1', 3, 'edu');
insert into task_assignees (task_id, member_id)
  select id, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid from tasks where title = 'pe-t1'
  union all
  select id, 'bbbbbbbb-0000-0000-0000-000000000002'::uuid from tasks where title = 'pe-t1';

update tasks set rating = 4 where title = 'pe-t1';

select is(
  (select count(*) from points_ledger l join tasks t on t.id = l.task_id
    where t.title = 'pe-t1' and l.reason = 'task'),
  2::bigint, 'grading writes one ledger row per assignee');

select is(
  (select l.delta from points_ledger l join tasks t on t.id = l.task_id
    where t.title = 'pe-t1' and l.member_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  6, 'difficulty 3 × rating 4 → +6');

select is(
  (select points from member_points where member_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  6, 'member_points sums the ledger');

-- ==================== Re-grading updates, never duplicates ====================
update tasks set rating = 5 where title = 'pe-t1';

select is(
  (select count(*) from points_ledger l join tasks t on t.id = l.task_id
    where t.title = 'pe-t1' and l.member_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1::bigint, 're-grading keeps a single row per assignee');

select is(
  (select l.delta from points_ledger l join tasks t on t.id = l.task_id
    where t.title = 'pe-t1' and l.member_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  9, 're-grading updates the delta (3 × 3)');

update tasks set difficulty = 4 where title = 'pe-t1';

select is(
  (select l.delta from points_ledger l join tasks t on t.id = l.task_id
    where t.title = 'pe-t1' and l.member_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  12, 'difficulty change after grading re-syncs the delta (4 × 3)');

-- ==================== Rating 1 subtracts ====================
insert into tasks (title, difficulty, dept_id) values ('pe-t2', 2, 'edu');
insert into task_assignees (task_id, member_id)
  select id, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid from tasks where title = 'pe-t2';

update tasks set rating = 1 where title = 'pe-t2';

select is(
  (select l.delta from points_ledger l join tasks t on t.id = l.task_id
    where t.title = 'pe-t2'),
  -2, 'rating 1 subtracts points (2 × -1)');

select is(
  (select points from member_points where member_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  10, 'penalty lowers the member total (12 - 2)');

-- ==================== Rating 2 still records a zero-point row ====================
insert into tasks (title, difficulty, dept_id) values ('pe-t3', 5, 'edu');
insert into task_assignees (task_id, member_id)
  select id, 'bbbbbbbb-0000-0000-0000-000000000002'::uuid from tasks where title = 'pe-t3';

update tasks set rating = 2 where title = 'pe-t3';

select is(
  (select l.delta from points_ledger l join tasks t on t.id = l.task_id
    where t.title = 'pe-t3'),
  0, 'rating 2 records a zero-point row (grade is visible, no points)');

select is(
  (select points from member_points where member_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  12, 'zero-point grade does not change the total (12 + 0)');

-- ==================== Clearing the grade removes the rows ====================
update tasks set rating = null where title = 'pe-t2';

select is(
  (select count(*) from points_ledger l join tasks t on t.id = l.task_id
    where t.title = 'pe-t2'),
  0::bigint, 'clearing the grade deletes the task''s ledger rows');

select is(
  (select points from member_points where member_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  12, 'the member total is restored after un-grading');

-- ==================== Assignees changing on a graded task ====================
insert into tasks (title, difficulty, dept_id) values ('pe-t4', 2, 'edu');
insert into task_assignees (task_id, member_id)
  select id, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid from tasks where title = 'pe-t4';

update tasks set rating = 3 where title = 'pe-t4';

insert into task_assignees (task_id, member_id)
  select id, 'bbbbbbbb-0000-0000-0000-000000000002'::uuid from tasks where title = 'pe-t4';

select is(
  (select l.delta from points_ledger l join tasks t on t.id = l.task_id
    where t.title = 'pe-t4' and l.member_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  2, 'an assignee added after grading gets a ledger row (2 × 1)');

delete from task_assignees ta
  using tasks t
  where t.id = ta.task_id and t.title = 'pe-t4'
    and ta.member_id = 'bbbbbbbb-0000-0000-0000-000000000002';

select is(
  (select count(*) from points_ledger l join tasks t on t.id = l.task_id
    where t.title = 'pe-t4' and l.member_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0::bigint, 'removing an assignee removes their ledger row');

-- ==================== Sanctions reduce totals ====================
insert into points_ledger (member_id, delta, reason, note)
  values ('aaaaaaaa-0000-0000-0000-000000000001', -5, 'sanction', 'test sanction');

select is(
  (select points from member_points where member_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  9, 'a sanction reduces the member total (12 + 2 - 5)');

-- ==================== Views ====================
select is(
  (select points from leaderboard where member_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  9, 'leaderboard reflects the ledger sums');

select ok(
  (select rank from leaderboard where member_id = 'bbbbbbbb-0000-0000-0000-000000000002')
  < (select rank from leaderboard where member_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'higher total ranks higher (Bogdan 12 over Ana 9)');

select is(
  (select points from dept_cup where dept_id = 'tst'),
  9, 'dept_cup sums its members'' totals');

select is(
  (select members from dept_cup where dept_id = 'tst'),
  1::bigint, 'dept_cup counts distinct members');

-- ==================== Security posture ====================
select ok(
  (select relrowsecurity from pg_class
    where relname = 'points_ledger' and relnamespace = 'public'::regnamespace),
  'RLS is enabled on points_ledger');

-- The two views a member reads directly run as the caller, so the policies on
-- profiles and member_departments still decide who gets rows at all.
select ok(
  exists (select 1 from pg_class
           where relname = 'leaderboard'
             and relnamespace = 'public'::regnamespace
             and 'security_invoker=on' = any (reloptions)),
  'leaderboard runs with security_invoker (caller''s RLS applies)');
select ok(
  exists (select 1 from pg_class
           where relname = 'dept_cup'
             and relnamespace = 'public'::regnamespace
             and 'security_invoker=on' = any (reloptions)),
  'dept_cup runs with security_invoker (caller''s RLS applies)');

-- `member_points` is the deliberate exception (1.4b): owner rights, so a total
-- is summed over the whole ledger rather than over the rows the caller happens
-- to be allowed to read. Totals are public inside the org; the ledger behind
-- them is not. Its own auth_is_member() clause is what keeps it gated, and
-- points_visibility.test.sql is where that behaviour is proven.
select ok(
  not exists (select 1 from pg_class
               where relname = 'member_points'
                 and relnamespace = 'public'::regnamespace
                 and 'security_invoker=on' = any (reloptions)),
  'member_points deliberately runs with owner rights (1.4b)');

select * from finish();
rollback;
