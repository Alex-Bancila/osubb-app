-- tasks_evaluation_inputs.test.sql — #312: Difficulty is not required at
-- creation; Evaluation (`complete_task_review` / `mark_task_unfulfilled`,
-- later commands) sets Difficulty and Rating together (ADR-0007, amended
-- 2026-09-10). `tasks_evaluation_inputs_ck` enforces the shape directly on
-- the table until those commands exist: a completed/unfulfilled Task must
-- carry both inputs; every other status must carry neither Rating (Difficulty
-- may already be set) nor an early Rating.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(7);

-- ==================== todo: Difficulty is optional ====================
select lives_ok(
  $$ insert into tasks (title, dept_id)
     values ('tei-312-todo-no-difficulty', 'edu') $$,
  'a todo Task may be created without a difficulty');

-- ==================== completed requires both inputs ====================
select throws_ok(
  $$ insert into tasks (title, dept_id, status, rating, completed_at)
     values ('tei-312-completed-no-difficulty', 'edu', 'completed', 4, now()) $$,
  '23514', null,
  'a completed Task without a difficulty is rejected');

select throws_ok(
  $$ insert into tasks (title, dept_id, status, difficulty, completed_at)
     values ('tei-312-completed-no-rating', 'edu', 'completed', 3, now()) $$,
  '23514', null,
  'a completed Task without a rating is rejected');

-- ==================== todo with a rating is rejected ====================
select throws_ok(
  $$ insert into tasks (title, dept_id, difficulty, rating)
     values ('tei-312-todo-with-rating', 'edu', 3, 4) $$,
  '23514', null,
  'a todo Task with a rating is rejected');

-- ==================== unfulfilled requires both inputs too ====================
select lives_ok(
  $$ insert into tasks (title, dept_id, status, difficulty, rating, unfulfilled_at)
     values ('tei-312-unfulfilled-both', 'edu', 'unfulfilled', 2, 1, now()) $$,
  'an unfulfilled Task with both difficulty and rating is accepted');

-- ==================== in_review: Difficulty may already be set, Rating may not ====================
select lives_ok(
  $$ insert into tasks (title, dept_id, status, difficulty, started_at, submitted_at)
     values ('tei-312-in-review-difficulty-only', 'edu', 'in_review', 3, now(), now()) $$,
  'an in_review Task may carry a difficulty without a rating');

-- ==================== cancelled with a rating is rejected ====================
select throws_ok(
  $$ insert into tasks (title, dept_id, status, difficulty, rating, cancelled_at)
     values ('tei-312-cancelled-with-rating', 'edu', 'cancelled', 2, 3, now()) $$,
  '23514', null,
  'a cancelled Task with a rating is rejected');

select * from finish();
rollback;
