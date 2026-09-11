begin;
\set osubb_test_suite true
\ir _helpers.sql

select plan(39);

select has_column('public', 'tasks', 'started_at', 'Tasks record when work starts');
select has_column('public', 'tasks', 'submitted_at', 'Tasks record the current submission');
select has_column('public', 'tasks', 'completed_at', 'Tasks record completion');
select has_column('public', 'tasks', 'unfulfilled_at', 'Tasks record an unfulfilled outcome');
select has_column('public', 'tasks', 'cancelled_at', 'Tasks record cancellation');
select has_column('public', 'tasks', 'queue_opened_at', 'Tasks record queue opening');
select has_column('public', 'tasks', 'queue_closed_at', 'Tasks record queue closure');
select has_column('public', 'tasks', 'review_round', 'Tasks record the review round');
select has_column('public', 'tasks', 'returned_to_progress_at', 'Tasks record return from review');
select col_not_null('public', 'tasks', 'review_round', 'review round is required');
select col_default_is('public', 'tasks', 'review_round', '0', 'review round starts at zero');
select is(
  (select count(*) from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and conname in (
        'tasks_started_at_state_check', 'tasks_submitted_at_state_check',
        'tasks_completed_at_state_check', 'tasks_unfulfilled_at_state_check',
        'tasks_cancelled_at_state_check', 'tasks_review_return_check',
        'tasks_lifecycle_timestamp_order_check', 'tasks_queue_timestamp_state_check')),
  8::bigint, 'all lifecycle and queue cross-column checks exist');
select ok(
  (select count(*) = 9 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks_with_overdue'
      and column_name in (
        'started_at', 'submitted_at', 'completed_at', 'unfulfilled_at',
        'cancelled_at', 'queue_opened_at', 'queue_closed_at',
        'review_round', 'returned_to_progress_at')),
  'the overdue query surface exposes all lifecycle markers');

-- #312: a completed row must carry a rating alongside its difficulty
-- (tasks_evaluation_inputs_ck); reopening it away from completed must clear
-- the rating just as atomically, since a non-terminal status may not hold one.
select lives_ok($$
  insert into public.tasks
    (title, difficulty, dept_id, status, created_at, completed_at, rating)
  values
    ('Completed work then reopen 293', 2, 'edu', 'completed',
     '2026-09-01 10:00+00', '2026-09-01 10:00+00', 3)
$$, 'completed work may have no invented start timestamp');
select is(
  (select started_at from public.tasks where title = 'Completed work then reopen 293'),
  null::timestamptz, 'completed-work history keeps its unknown start null');
select lives_ok($$
  update public.tasks
     set status = 'in_progress', completed_at = null, rating = null
   where title = 'Completed work then reopen 293'
$$, 'reopening completed work changes its lifecycle markers atomically');
select ok(
  exists (select 1 from public.tasks
    where title = 'Completed work then reopen 293'
      and status = 'in_progress' and started_at is null
      and completed_at is null and review_round = 0
      and returned_to_progress_at is null),
  'reopened completed work retains honest unknown-start history');

select lives_ok($$
  insert into public.tasks
    (title, difficulty, dept_id, status, created_at, started_at, submitted_at)
  values
    ('Review return and resubmit 293', 2, 'edu', 'in_review',
     '2026-09-01 10:00+00', '2026-09-01 11:00+00',
     '2026-09-01 12:00+00');
  update public.tasks
     set status = 'in_progress', submitted_at = null, review_round = 1,
         returned_to_progress_at = '2026-09-01 13:00+00'
   where title = 'Review return and resubmit 293';
  update public.tasks
     set status = 'in_review', submitted_at = '2026-09-01 14:00+00'
   where title = 'Review return and resubmit 293'
$$, 'review return and resubmission update current markers atomically');
select ok(
  exists (select 1 from public.tasks
    where title = 'Review return and resubmit 293'
      and status = 'in_review' and review_round = 1
      and returned_to_progress_at = '2026-09-01 13:00+00'
      and submitted_at = '2026-09-01 14:00+00'),
  'resubmission retains the prior review-return markers');

select lives_ok($$
  insert into public.tasks
    (title, difficulty, dept_id, status, created_at, started_at, submitted_at)
  values
    ('Review then cancel 293', 2, 'edu', 'in_review',
     '2026-09-01 10:00+00', '2026-09-01 11:00+00',
     '2026-09-01 12:00+00');
  update public.tasks
     set status = 'cancelled', cancelled_at = '2026-09-01 13:00+00'
   where title = 'Review then cancel 293'
$$, 'cancellation from review may preserve the submission');
select is(
  (select submitted_at from public.tasks where title = 'Review then cancel 293'),
  '2026-09-01 12:00+00'::timestamptz,
  'cancelled review history retains the submission marker');

select lives_ok($$
  insert into public.tasks
    (title, difficulty, dept_id, status, assignment_mode, created_at,
     queue_opened_at, queue_closed_at)
  values
    ('Reopened queue 293', 1, 'edu', 'todo', 'public',
     '2026-09-01 10:00+00', '2026-09-01 11:00+00', '2026-09-01 12:00+00');
  update public.tasks set queue_closed_at = null where title = 'Reopened queue 293'
$$, 'reopening a queue clears only its close marker');
select is(
  (select queue_opened_at from public.tasks where title = 'Reopened queue 293'),
  '2026-09-01 11:00+00'::timestamptz,
  'queue reopening preserves the first opening in this public-mode period');

select throws_ok(
  $$ insert into public.tasks (title, difficulty, dept_id, status, rating)
     values ('Missing completion 293', 1, 'edu', 'completed', 3) $$,
  '23514', null, 'completed requires completed_at');
select throws_ok(
  $$ insert into public.tasks (title, difficulty, dept_id, status, rating)
     values ('Missing unfulfilled 293', 1, 'edu', 'unfulfilled', 2) $$,
  '23514', null, 'unfulfilled requires unfulfilled_at');
select throws_ok(
  $$ insert into public.tasks (title, difficulty, dept_id, status)
     values ('Missing cancellation 293', 1, 'edu', 'cancelled') $$,
  '23514', null, 'cancelled requires cancelled_at');
select throws_ok(
  $$ insert into public.tasks (title, difficulty, dept_id, completed_at)
     values ('Completion on todo 293', 1, 'edu', now()) $$,
  '23514', null, 'completed_at is rejected outside completed');
select throws_ok(
  $$ insert into public.tasks (title, difficulty, dept_id, status)
     values ('Review without submission 293', 1, 'edu', 'in_review') $$,
  '23514', null, 'in-review requires submitted_at');
select throws_ok(
  $$ insert into public.tasks (title, difficulty, dept_id, submitted_at)
     values ('Submission on todo 293', 1, 'edu', now()) $$,
  '23514', null, 'todo cannot retain submitted_at');
select throws_ok(
  $$ insert into public.tasks (title, difficulty, dept_id, started_at)
     values ('Start on todo 293', 1, 'edu', now()) $$,
  '23514', null, 'todo cannot have started_at');
select throws_ok(
  $$ insert into public.tasks
       (title, difficulty, dept_id, review_round)
     values ('Round without return 293', 1, 'edu', 1) $$,
  '23514', null, 'a positive review round requires a return marker');
select throws_ok(
  $$ insert into public.tasks
       (title, difficulty, dept_id, returned_to_progress_at)
     values ('Return without round 293', 1, 'edu', now()) $$,
  '23514', null, 'a return marker requires a positive review round');
select throws_ok(
  $$ insert into public.tasks (title, difficulty, dept_id, review_round)
     values ('Negative review 293', 1, 'edu', -1) $$,
  '23514', null, 'review round cannot be negative');
select throws_ok(
  $$ insert into public.tasks
       (title, difficulty, dept_id, queue_opened_at)
     values ('Direct queue 293', 1, 'edu', now()) $$,
  '23514', null, 'direct Tasks cannot carry queue timestamps');
select throws_ok(
  $$ insert into public.tasks
       (title, difficulty, dept_id, assignment_mode)
     values ('Public without opening 293', 1, 'edu', 'public') $$,
  '23514', null, 'public Tasks require a queue opening');
select throws_ok($$
  insert into public.tasks
    (title, difficulty, dept_id, status, assignment_mode, completed_at,
     queue_opened_at, rating)
  values
    ('Terminal open queue 293', 1, 'edu', 'completed', 'public', now(), now(), 3)
$$, '23514', null, 'terminal public Tasks require a closed queue');
select throws_ok($$
  insert into public.tasks
    (title, difficulty, dept_id, assignment_mode, created_at, queue_opened_at)
  values
    ('Queue before creation 293', 1, 'edu', 'public',
     '2026-09-02 10:00+00', '2026-09-01 10:00+00')
$$, '23514', null, 'a queue cannot open before Task creation');
select throws_ok($$
  insert into public.tasks
    (title, difficulty, dept_id, assignment_mode, created_at,
     queue_opened_at, queue_closed_at)
  values
    ('Queue closes early 293', 1, 'edu', 'public',
     '2026-09-01 10:00+00', '2026-09-01 12:00+00', '2026-09-01 11:00+00')
$$, '23514', null, 'a queue cannot close before it opens');
select throws_ok($$
  insert into public.tasks
    (title, difficulty, dept_id, status, created_at,
     submitted_at, completed_at, rating)
  values
    ('Completion before submission 293', 1, 'edu', 'completed',
     '2026-09-01 10:00+00', '2026-09-01 12:00+00', '2026-09-01 11:00+00', 3)
$$, '23514', null, 'a terminal outcome cannot precede its submission');

select * from finish();
rollback;
