begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(53);

-- ==================== Structure ====================
select has_table('public', 'task_evaluations', 'the evaluation history table exists');
select ok(
  (select relrowsecurity from pg_class
    where oid = 'public.task_evaluations'::regclass),
  'task_evaluations enables RLS at birth');

select columns_are(
  'public', 'task_evaluations',
  array['id', 'task_id', 'assignment_id', 'evaluated_by', 'outcome',
        'difficulty', 'rating', 'points', 'note', 'evaluated_at',
        'reversed_at', 'reversed_by', 'reversal_reason', 'created_at'],
  'task_evaluations exposes exactly the requested fields');
select has_pk('public', 'task_evaluations', 'an Evaluation has a primary key');
select col_type_is('public', 'task_evaluations', 'id', 'bigint', 'evaluation id is bigint');

select col_not_null('public', 'task_evaluations', 'task_id', 'an Evaluation names its Task');
select fk_ok('public', 'task_evaluations', 'task_id', 'public', 'tasks', 'id',
  'an Evaluation references its Task');
select col_not_null('public', 'task_evaluations', 'assignment_id', 'an Evaluation names its Assignment');
select fk_ok('public', 'task_evaluations', array['assignment_id', 'task_id'],
  'public', 'task_assignments', array['id', 'task_id'],
  'an Evaluation''s Assignment must belong to the same Task');
select col_not_null('public', 'task_evaluations', 'evaluated_by', 'an Evaluation names its evaluator');
select fk_ok('public', 'task_evaluations', 'evaluated_by', 'public', 'profiles', 'id',
  'the evaluator references a Profile');
select col_not_null('public', 'task_evaluations', 'outcome', 'outcome is required');
select col_not_null('public', 'task_evaluations', 'difficulty', 'difficulty is required');
select col_not_null('public', 'task_evaluations', 'rating', 'rating is required');
select col_not_null('public', 'task_evaluations', 'points', 'points is required');
select col_not_null('public', 'task_evaluations', 'note', 'note is required');
select col_not_null('public', 'task_evaluations', 'evaluated_at', 'evaluated_at is required');
select col_has_default('public', 'task_evaluations', 'evaluated_at', 'evaluated_at is server-written');
select fk_ok('public', 'task_evaluations', 'reversed_by', 'public', 'profiles', 'id',
  'a reversal can be attributed to a Profile');
select col_not_null('public', 'task_evaluations', 'created_at', 'created_at is required');
select col_has_default('public', 'task_evaluations', 'created_at', 'created_at is server-written');

select has_index('public', 'task_evaluations', 'task_evaluations_one_open_per_task_uidx',
  'one-open-Evaluation-per-Task lookup is indexed');
select has_index('public', 'task_evaluations', 'task_evaluations_task_history_idx',
  'per-Task history lookup is indexed');

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('31600000-0000-0000-0000-000000000001', 'evaluator-316@test.local'),
  ('31600000-0000-0000-0000-000000000002', 'executor-a-316@test.local'),
  ('31600000-0000-0000-0000-000000000003', 'executor-b-316@test.local');
insert into public.profiles (id, full_name, email, role) values
  ('31600000-0000-0000-0000-000000000001', 'Evaluator 316', 'evaluator-316@test.local', 'responsabil'),
  ('31600000-0000-0000-0000-000000000002', 'Executor A 316', 'executor-a-316@test.local', 'voluntar'),
  ('31600000-0000-0000-0000-000000000003', 'Executor B 316', 'executor-b-316@test.local', 'voluntar');

-- Task A: valid on this base per #312's tasks_evaluation_inputs_ck (a
-- completed Task carries both difficulty and rating) and dobrerares'
-- lifecycle-timestamp checks (completed_at is required once status is
-- completed; started_at/submitted_at may stay null for a direct-mode Task).
insert into public.tasks (title, difficulty, rating, status, completed_at, dept_id)
values ('Evaluation fixture Task A 316', 3, 4, 'completed', now(), 'edu');

-- Task B: isolated, so the "assignment from a different task" case has a
-- real Assignment that genuinely belongs elsewhere.
insert into public.tasks (title, difficulty, rating, status, completed_at, dept_id)
values ('Evaluation fixture Task B 316', 2, 3, 'completed', now(), 'edu');

insert into public.task_assignments (task_id, member_id)
select id, '31600000-0000-0000-0000-000000000002'
  from public.tasks where title = 'Evaluation fixture Task A 316';

insert into public.task_assignments (task_id, member_id)
select id, '31600000-0000-0000-0000-000000000003'
  from public.tasks where title = 'Evaluation fixture Task B 316';

-- ==================== outcome check ====================
select throws_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, '31600000-0000-0000-0000-000000000001',
            'archived', 3, 4, 6, 'a note'
       from public.tasks task
       join public.task_assignments assignment on assignment.task_id = task.id
      where task.title = 'Evaluation fixture Task A 316' $$,
  '23514', null,
  'an outcome outside completed/unfulfilled is rejected');

-- ==================== note must be non-blank ====================
select throws_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, '31600000-0000-0000-0000-000000000001',
            'completed', 3, 4, 6, '   '
       from public.tasks task
       join public.task_assignments assignment on assignment.task_id = task.id
      where task.title = 'Evaluation fixture Task A 316' $$,
  '23514', null,
  'an all-spaces note is rejected');
select throws_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, '31600000-0000-0000-0000-000000000001',
            'completed', 3, 4, 6, E'\t'
       from public.tasks task
       join public.task_assignments assignment on assignment.task_id = task.id
      where task.title = 'Evaluation fixture Task A 316' $$,
  '23514', null,
  'a tab-only note is rejected');

-- ==================== difficulty / rating ranges ====================
select throws_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, '31600000-0000-0000-0000-000000000001',
            'completed', 0, 4, 6, 'a note'
       from public.tasks task
       join public.task_assignments assignment on assignment.task_id = task.id
      where task.title = 'Evaluation fixture Task A 316' $$,
  '23514', null,
  'difficulty below 1 is rejected');
select throws_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, '31600000-0000-0000-0000-000000000001',
            'completed', 6, 4, 6, 'a note'
       from public.tasks task
       join public.task_assignments assignment on assignment.task_id = task.id
      where task.title = 'Evaluation fixture Task A 316' $$,
  '23514', null,
  'difficulty above 5 is rejected');
select throws_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, '31600000-0000-0000-0000-000000000001',
            'completed', 3, 0, 6, 'a note'
       from public.tasks task
       join public.task_assignments assignment on assignment.task_id = task.id
      where task.title = 'Evaluation fixture Task A 316' $$,
  '23514', null,
  'rating below 1 is rejected');
select throws_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, '31600000-0000-0000-0000-000000000001',
            'completed', 3, 6, 6, 'a note'
       from public.tasks task
       join public.task_assignments assignment on assignment.task_id = task.id
      where task.title = 'Evaluation fixture Task A 316' $$,
  '23514', null,
  'rating above 5 is rejected');

-- ==================== assignment must belong to the same task ====================
select throws_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
     select taska.id, assignmentb.id, '31600000-0000-0000-0000-000000000001',
            'completed', 3, 4, 6, 'a note'
       from public.tasks taska
       join public.tasks taskb on taskb.title = 'Evaluation fixture Task B 316'
       join public.task_assignments assignmentb on assignmentb.task_id = taskb.id
      where taska.title = 'Evaluation fixture Task A 316' $$,
  '23503', null,
  'an Assignment from a different Task is rejected');

-- ==================== reversal trio: all-or-nothing, at insert ====================
select throws_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note,
        reversed_at)
     select task.id, assignment.id, '31600000-0000-0000-0000-000000000001',
            'completed', 3, 4, 6, 'a note', now()
       from public.tasks task
       join public.task_assignments assignment on assignment.task_id = task.id
      where task.title = 'Evaluation fixture Task A 316' $$,
  '23514', null,
  'a reversal with only reversed_at set is rejected');

-- ==================== reversal cannot precede evaluation ====================
select throws_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note,
        evaluated_at, reversed_at, reversed_by, reversal_reason)
     select task.id, assignment.id, '31600000-0000-0000-0000-000000000001',
            'completed', 3, 4, 6, 'a note',
            now(), now() - interval '1 hour', '31600000-0000-0000-0000-000000000001',
            'too early'
       from public.tasks task
       join public.task_assignments assignment on assignment.task_id = task.id
      where task.title = 'Evaluation fixture Task A 316' $$,
  '23514', null,
  'a reversal timestamped before its Evaluation is rejected');

-- ==================== the real un-reversed Evaluation for Task A ====================
select lives_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, '31600000-0000-0000-0000-000000000001',
            'completed', 3, 4, 6, 'well done'
       from public.tasks task
       join public.task_assignments assignment on assignment.task_id = task.id
      where task.title = 'Evaluation fixture Task A 316' $$,
  'a valid Evaluation is recorded');

-- ==================== at most one un-reversed Evaluation per Task ====================
select throws_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, '31600000-0000-0000-0000-000000000001',
            'completed', 3, 4, 6, 'a second, uninvited evaluation'
       from public.tasks task
       join public.task_assignments assignment on assignment.task_id = task.id
      where task.title = 'Evaluation fixture Task A 316' $$,
  '23505', null,
  'a second un-reversed Evaluation for the same Task is rejected');

-- ==================== append-only: DELETE is always rejected ====================
select throws_ok(
  $$ delete from public.task_evaluations
      where task_id = (select id from public.tasks
                        where title = 'Evaluation fixture Task A 316') $$,
  '23514', 'task_evaluation_immutable',
  'postgres cannot delete an Evaluation (the trigger, not a grant, blocks it)');

-- ==================== append-only: rewriting a non-reversal column is rejected ====================
select throws_ok(
  $$ update public.task_evaluations set note = 'rewritten'
      where task_id = (select id from public.tasks
                        where title = 'Evaluation fixture Task A 316') $$,
  '23514', 'task_evaluation_immutable',
  'postgres cannot rewrite an Evaluation''s content (the trigger blocks it)');

-- ==================== the one permitted transition: reversal ====================
select lives_ok(
  format($$ update public.task_evaluations
               set reversed_at = now(), reversed_by = '31600000-0000-0000-0000-000000000001',
                   reversal_reason = 'reopened for rework'
             where task_id = %s $$,
    (select id from public.tasks where title = 'Evaluation fixture Task A 316')),
  'the single permitted reversal transition is accepted');

select throws_ok(
  format($$ update public.task_evaluations
               set reversal_reason = 'trying again'
             where task_id = %s $$,
    (select id from public.tasks where title = 'Evaluation fixture Task A 316')),
  '23514', 'task_evaluation_immutable',
  'a second reversal of an already-reversed Evaluation is rejected');

-- ==================== a reversed Evaluation plus a new one is accepted ====================
select lives_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, '31600000-0000-0000-0000-000000000001',
            'completed', 3, 4, 6, 'redone after reopening'
       from public.tasks task
       join public.task_assignments assignment on assignment.task_id = task.id
      where task.title = 'Evaluation fixture Task A 316' $$,
  'a new Evaluation is accepted once the previous one is reversed');

-- ==================== grants: commands, not clients, write this table ====================
select is((select count(*) from pg_policies
  where schemaname = 'public' and tablename = 'task_evaluations'), 0::bigint,
  'task_evaluations starts with no client policies (#319)');

select is(has_table_privilege('authenticated', 'public.task_evaluations', 'SELECT'), false,
  'authenticated cannot read Evaluations directly (no read policy yet, #319)');
select is(has_table_privilege('authenticated', 'public.task_evaluations', 'INSERT'), false,
  'authenticated cannot insert an Evaluation directly (commands only)');
select is(has_table_privilege('authenticated', 'public.task_evaluations', 'UPDATE'), false,
  'authenticated cannot update an Evaluation directly');
select is(has_table_privilege('authenticated', 'public.task_evaluations', 'DELETE'), false,
  'authenticated cannot delete an Evaluation directly');
select is(has_table_privilege('authenticated', 'public.task_evaluations', 'TRUNCATE'), false,
  'authenticated cannot truncate task_evaluations');
select is(has_sequence_privilege('authenticated', 'public.task_evaluations_id_seq', 'USAGE'), false,
  'authenticated cannot allocate evaluation ids');

select is(has_table_privilege('service_role', 'public.task_evaluations', 'SELECT'), true,
  'service_role can read task_evaluations directly ahead of #319');
select is(has_table_privilege('service_role', 'public.task_evaluations', 'INSERT'), false,
  'service_role cannot insert directly — commands run as the table owner, not service_role');
select is(has_table_privilege('service_role', 'public.task_evaluations', 'UPDATE'), false,
  'service_role cannot update task_evaluations directly');
select is(has_table_privilege('service_role', 'public.task_evaluations', 'DELETE'), false,
  'service_role cannot delete from task_evaluations directly');
select is(has_table_privilege('service_role', 'public.task_evaluations', 'TRUNCATE'), false,
  'service_role cannot truncate task_evaluations');
select is(has_sequence_privilege('service_role', 'public.task_evaluations_id_seq', 'usage'), false,
  'service_role never allocates an evaluation id — it only ever reads (SELECT-only)');

select * from finish();
rollback;
