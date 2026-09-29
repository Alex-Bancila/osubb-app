-- points_engine.test.sql — the points engine after #317.
--
-- Epic 1.4 built the engine out of two triggers: editing `tasks.rating` (or
-- the generated `tasks.points`) wrote, rewrote or deleted ledger rows, and
-- editing the legacy assignee join table added or removed them. #317 retired
-- both triggers; #345 then dropped the join table itself. Points
-- are now decided once, recorded on an append-only `task_evaluations` row,
-- and credited by a single `points_ledger` row that names that Evaluation;
-- reopening appends a `task_reversal` row against the same Evaluation rather
-- than rewriting or deleting the credit (ADR-0007, Lifecycle and points).
--
-- This suite therefore asserts the opposite of what it used to: that moving a
-- Rating moves no points at all, and that the Evaluation is the only thing
-- that does. The scoring guide itself (rating_mult) is
-- unchanged and still proven here, because it is what an Evaluation's points
-- must equal.
--
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(29);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'ana.points@test.local'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bogdan.points@test.local'),
  ('cccccccc-0000-0000-0000-000000000003', 'carmen.points@test.local');

insert into profiles (id, full_name, email, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Ana Test',    'ana.points@test.local',    'voluntar'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Bogdan Test', 'bogdan.points@test.local', 'voluntar'),
  ('cccccccc-0000-0000-0000-000000000003', 'Carmen Test', 'carmen.points@test.local', 'vot');

-- Own throwaway department so department_cup assertions stay exact even after
-- Epic 5.2 seeds demo members into the real departments.
insert into pg_temp.fixture_departments (id, name, short, color, kind)
  values ('tst', 'Test Dept', 'TST', '#123456', 'department');
insert into pg_temp.fixture_member_departments (member_id, dept_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'tst');

-- ==================== rating_mult ====================
select is(rating_mult(1), -1, 'rating 1 → multiplier -1 (penalty)');
select is(rating_mult(2),  0, 'rating 2 → multiplier 0');
select is(rating_mult(3),  1, 'rating 3 → multiplier 1');
select is(rating_mult(4),  2, 'rating 4 → multiplier 2');
select is(rating_mult(5),  3, 'rating 5 → multiplier 3');

-- ==================== The retired engine is gone ====================
select hasnt_column('public', 'tasks', 'points',
  'tasks no longer carries a generated points column — points live on the Evaluation');
-- #936: tasks_with_overdue is dropped outright; public.tasks is the only
-- Task read surface and never carried this column either.

select ok(
  (select count(*) from pg_trigger trigger
     join pg_class table_ on table_.oid = trigger.tgrelid
    where table_.relname = 'tasks'
      and trigger.tgname = 'tasks_sync_ledger') = 0,
  'no ledger sync trigger survives on tasks (the assignee-side trigger went with its table in #345)');

select hasnt_function('public', 'sync_task_ledger',
  'sync_task_ledger() is gone, not merely detached from its trigger');
select hasnt_function('public', 'sync_assignee_ledger',
  'sync_assignee_ledger() is gone, not merely detached from its trigger');

-- The AC in its strongest form: nothing a writer does to `tasks` may move a
-- ledger row.
insert into tasks (title, difficulty, group_id) values ('pe-t1', 3, pg_temp.dept_group('edu'));

-- #312: a Rating may only be set once the Task is terminal, so grading also
-- completes it. Under the old engine this single statement credited every
-- participant of the Task.
update tasks set status = 'completed', completed_at = now(), rating = 4 where title = 'pe-t1';

select is(
  (select count(*) from points_ledger l join tasks t on t.id = l.task_id
    where t.title = 'pe-t1'),
  0::bigint, 'grading a Task writes no ledger row by itself');

-- ==================== An Evaluation is what credits a member ====================
insert into task_assignments (task_id, member_id, ended_at, end_reason)
  select id, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, completed_at, 'completed'
    from tasks where title = 'pe-t1';

insert into task_evaluations
  (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
  select task.id, assignment.id, 'cccccccc-0000-0000-0000-000000000003',
         'completed', task.difficulty, task.rating,
         task.difficulty * rating_mult(task.rating), 'evaluated for the suite'
    from tasks task
    join task_assignments assignment on assignment.task_id = task.id
   where task.title = 'pe-t1';

insert into points_ledger (member_id, delta, reason, task_id, evaluation_id)
  select assignment.member_id, evaluation.points, 'task',
         evaluation.task_id, evaluation.id
    from task_evaluations evaluation
    join task_assignments assignment on assignment.id = evaluation.assignment_id
    join tasks task on task.id = evaluation.task_id
   where task.title = 'pe-t1';

select is(
  (select l.delta from points_ledger l join tasks t on t.id = l.task_id
    where t.title = 'pe-t1'),
  6, 'the Evaluation credits Difficulty × the Rating multiplier (3 × 2)');

select is(
  (select count(*) from points_ledger l join tasks t on t.id = l.task_id
    where t.title = 'pe-t1'),
  1::bigint,
  'only the evaluated Executor is credited — one Evaluation, one ledger row');

-- #936: member_points is dropped; as postgres (no RLS) a direct ledger sum
-- is the same total the owner-rights view computed.
select is(
  (select coalesce(sum(delta), 0)::int from points_ledger where member_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  6, 'the ledger sums to the Evaluation credit (#936, was member_points)');

-- Re-rating the Task afterwards is exactly the edit that used to rewrite the
-- credit in place. It must now leave the recorded history alone.
update tasks set rating = 5 where title = 'pe-t1';

select is(
  (select l.delta from points_ledger l join tasks t on t.id = l.task_id
    where t.title = 'pe-t1'),
  6, 'changing the Task''s Rating afterwards does not move the recorded credit');

select is(
  (select evaluation.rating from task_evaluations evaluation
     join tasks task on task.id = evaluation.task_id
    where task.title = 'pe-t1'),
  4, 'the Evaluation preserves the Rating it was made with');

-- ==================== A credit and its reversal coexist (#317 AC) ====================
-- The old points_ledger_task_member_uidx keyed on (task_id, member_id) and
-- made this impossible; points_ledger_evaluation_reason_uidx keys on
-- (evaluation_id, reason) and allows exactly one of each.
select lives_ok(
  $$ insert into points_ledger (member_id, delta, reason, task_id, evaluation_id, note)
     select ledger.member_id, -ledger.delta, 'task_reversal',
            ledger.task_id, ledger.evaluation_id, 'reopened for rework'
       from points_ledger ledger
       join tasks task on task.id = ledger.task_id
      where task.title = 'pe-t1' and ledger.reason = 'task' $$,
  'a task_reversal row may stand beside the task row it reverses');

select is(
  (select coalesce(sum(delta), 0)::int from points_ledger where member_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0, 'the reversal nets the credit back to zero without deleting it (#936, was member_points)');

select is(
  (select count(*) from points_ledger l join tasks t on t.id = l.task_id
    where t.title = 'pe-t1'),
  2::bigint, 'both rows survive — the ledger stays append-only');

select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, task_id, evaluation_id, note)
     select ledger.member_id, -ledger.delta, 'task_reversal',
            ledger.task_id, ledger.evaluation_id, 'reversed twice'
       from points_ledger ledger
       join tasks task on task.id = ledger.task_id
      where task.title = 'pe-t1' and ledger.reason = 'task' $$,
  '23505', null,
  'one Evaluation cannot be reversed twice');

-- A Task whose credit has been reversed may be evaluated again, but only once
-- the first Evaluation is actually reversed — ADR-0007's "reopening reverses
-- the ledger effect atomically", enforced by
-- task_evaluations_one_open_per_task_uidx.
insert into task_assignments (task_id, member_id, ended_at, end_reason)
  select id, 'bbbbbbbb-0000-0000-0000-000000000002'::uuid, completed_at, 'completed'
    from tasks where title = 'pe-t1';

select throws_ok(
  $$ insert into task_evaluations
       (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, 'cccccccc-0000-0000-0000-000000000003',
            'completed', 3, 5, 9, 'a second live evaluation'
       from tasks task
       join task_assignments assignment
         on assignment.task_id = task.id
        and assignment.member_id = 'bbbbbbbb-0000-0000-0000-000000000002'
      where task.title = 'pe-t1' $$,
  '23505', null,
  'a second un-reversed Evaluation for the same Task is still rejected');

update task_evaluations
   set reversed_at = now(),
       reversed_by = 'cccccccc-0000-0000-0000-000000000003',
       reversal_reason = 'reopened for rework'
 where task_id = (select id from tasks where title = 'pe-t1');

select lives_ok(
  $$ insert into task_evaluations
       (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, 'cccccccc-0000-0000-0000-000000000003',
            'completed', 3, 5, 9, 'the evaluation after the reopen'
       from tasks task
       join task_assignments assignment
         on assignment.task_id = task.id
        and assignment.member_id = 'bbbbbbbb-0000-0000-0000-000000000002'
      where task.title = 'pe-t1' $$,
  'once the first Evaluation is reversed, the Task may be evaluated again');

-- ==================== A rating of 1 still subtracts ====================
insert into tasks (title, difficulty, rating, status, completed_at, group_id)
  values ('pe-t2', 2, 1, 'completed', now(), pg_temp.dept_group('edu'));

select is(
  (select pg_temp.test_credit_task(
     (select id from tasks where title = 'pe-t2'),
     'aaaaaaaa-0000-0000-0000-000000000001',
     'cccccccc-0000-0000-0000-000000000003')),
  -2, 'rating 1 subtracts points (2 × -1)');

select is(
  (select coalesce(sum(delta), 0)::int from points_ledger where member_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  -2, 'a penalty lowers the member total (0 - 2) (#936, was member_points)');

-- ==================== A rating of 2 still records a zero-point credit ====================
insert into tasks (title, difficulty, rating, status, completed_at, group_id)
  values ('pe-t3', 5, 2, 'completed', now(), pg_temp.dept_group('edu'));

select is(
  (select pg_temp.test_credit_task(
     (select id from tasks where title = 'pe-t3'),
     'bbbbbbbb-0000-0000-0000-000000000002',
     'cccccccc-0000-0000-0000-000000000003')),
  0, 'rating 2 records a zero-point credit (the grade is visible, no points)');

select is(
  (select coalesce(sum(delta), 0)::int from points_ledger where member_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0, 'a zero-point credit does not change the total (#936, was member_points)');

-- ==================== Sanctions reduce totals ====================
insert into points_ledger (member_id, delta, reason, note)
  values ('aaaaaaaa-0000-0000-0000-000000000001', -5, 'sanction', 'test sanction');

select is(
  (select coalesce(sum(delta), 0)::int from points_ledger where member_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  -7, 'a sanction reduces the member total (-2 - 5) (#936, was member_points)');

-- #936: leaderboard is dropped. leadership_leaderboard is not a substitute
-- for this section's ranking check: it sums only 'task'/'task_reversal'
-- ledger rows (never the 'sanction' row just inserted above), and its BCE+
-- gate has no trusted-server-role bypass, so it would see no rows at all
-- under this file's postgres session (no test_login call is ever made here).
-- The ranking behaviour itself (rank() over points desc, shared ranks on
-- ties) is proven live in leadership_leaderboard.test.sql instead.

-- ==================== Views ====================
select is(
  (select count(*) from public.department_cup(null::bigint, null::timestamptz, null::timestamptz) where group_id = pg_temp.dept_group('tst')),
  0::bigint, 'the database owner sees no department_cup row for tst either -- this suite''s own extra department competes under a real BCE+ session (department_cup_task_origins.test.sql), the owner just never sees any row at all (next assertion) (#936, was dept_cup)');

select is(
  (select count(*) from public.department_cup(null::bigint, null::timestamptz, null::timestamptz)),
  0::bigint, 'the database owner does not bypass the authenticated BCE+ Department Cup gate (#936, was dept_cup)');

-- ==================== Security posture ====================
select ok(
  (select relrowsecurity from pg_class
    where relname = 'points_ledger' and relnamespace = 'public'::regnamespace),
  'RLS is enabled on points_ledger');

-- #936: leaderboard, dept_cup and member_points are dropped, along with the
-- reloptions checks that pinned their security posture as views. The
-- function-level equivalent (public.department_cup's `security invoker`
-- against private.department_cup_rows's `security definer`) is pinned in
-- department_cup_task_origins.test.sql instead.

select * from finish();
rollback;
