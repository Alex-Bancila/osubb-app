begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(67);

-- ==================== Structure ====================
select has_table('public', 'task_evaluations', 'the evaluation history table exists');
select ok(
  (select relrowsecurity from pg_class
    where oid = 'public.task_evaluations'::regclass),
  'task_evaluations enables RLS at birth');

select columns_are(
  'public', 'task_evaluations',
  array['id', 'task_id', 'assignment_id', 'source', 'evaluated_by', 'outcome',
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
select col_not_null('public', 'task_evaluations', 'source', 'source is required (defaults to command)');
select col_default_is('public', 'task_evaluations', 'source', 'command', 'source defaults to command for new work');
select fk_ok('public', 'task_evaluations', 'evaluated_by', 'public', 'profiles', 'id',
  'the evaluator, when named, references a Profile');
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
  'one-open-command-Evaluation-per-Task lookup is indexed');
select has_index('public', 'task_evaluations', 'task_evaluations_one_open_per_assignment_uidx',
  'one-open-Evaluation-per-Assignment lookup is indexed, regardless of source');
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
-- real Assignment that genuinely belongs elsewhere. Also doubles as the
-- legacy_migration fixture below, once that case is reached.
insert into public.tasks (title, difficulty, rating, status, completed_at, dept_id)
values ('Evaluation fixture Task B 316', 2, 3, 'completed', now(), 'edu');

insert into public.task_assignments (task_id, member_id)
select id, '31600000-0000-0000-0000-000000000002'
  from public.tasks where title = 'Evaluation fixture Task A 316';

insert into public.task_assignments (task_id, member_id)
select id, '31600000-0000-0000-0000-000000000003'
  from public.tasks where title = 'Evaluation fixture Task B 316';

-- ==================== source check ====================
-- Run before either Task A's or Task B's Assignment carries any Evaluation,
-- so this failure can only be the source check, not a uniqueness collision.
select throws_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, source, evaluated_by, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, 'imported', '31600000-0000-0000-0000-000000000001',
            'completed', 3, 4, 6, 'a note'
       from public.tasks task
       join public.task_assignments assignment on assignment.task_id = task.id
      where task.title = 'Evaluation fixture Task B 316' $$,
  '23514', null,
  'a source outside command/legacy_migration is rejected');

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

-- ==================== evaluator check: command requires evaluated_by ====================
-- Task A's Assignment still carries no Evaluation at this point, so this
-- failure can only be the evaluator check, not a uniqueness collision.
select throws_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, source, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, 'command',
            'completed', 3, 4, 6, 'a note'
       from public.tasks task
       join public.task_assignments assignment on assignment.task_id = task.id
      where task.title = 'Evaluation fixture Task A 316' $$,
  '23514', null,
  'a command Evaluation without evaluated_by is rejected (evaluator check)');

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

-- ==================== reversal_reason must be non-blank, even when the
-- trio is set together at insert ====================
insert into public.tasks (title, difficulty, rating, status, completed_at, dept_id)
values ('Evaluation fixture Task E 316 (blank reversal reason)', 3, 4, 'completed', now(), 'edu');
insert into public.task_assignments (task_id, member_id)
select id, '31600000-0000-0000-0000-000000000002'
  from public.tasks where title = 'Evaluation fixture Task E 316 (blank reversal reason)';

select throws_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note,
        reversed_at, reversed_by, reversal_reason)
     select task.id, assignment.id, '31600000-0000-0000-0000-000000000001',
            'completed', 3, 4, 6, 'a note',
            now(), '31600000-0000-0000-0000-000000000001', '   '
       from public.tasks task
       join public.task_assignments assignment on assignment.task_id = task.id
      where task.title = 'Evaluation fixture Task E 316 (blank reversal reason)' $$,
  '23514', null,
  'a reversal_reason of all spaces is rejected even with the other two reversal columns set');

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

-- ==================== at most one open command Evaluation per Task ====================
select throws_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, '31600000-0000-0000-0000-000000000001',
            'completed', 3, 4, 6, 'a second, uninvited evaluation'
       from public.tasks task
       join public.task_assignments assignment on assignment.task_id = task.id
      where task.title = 'Evaluation fixture Task A 316' $$,
  '23505', null,
  'a second open command Evaluation for the same Task (and Assignment) is rejected');

-- ==================== per-Task command cap holds across two different
-- Assignments of the same Task, isolated from the per-Assignment cap
-- (the test above reuses one Assignment, so it cannot tell which index
-- actually rejected the second insert) ====================
insert into public.tasks (title, difficulty, rating, status, completed_at, dept_id)
values ('Evaluation fixture Task D 316 (per-task cap)', 3, 4, 'completed', now(), 'edu');
-- One ended Assignment (replaced) and one still-active Assignment, both on
-- Task D — task_assignments_one_active_per_task_uidx only bars two
-- simultaneously active rows, not this shape.
insert into public.task_assignments (task_id, member_id, ended_at, end_reason)
select id, '31600000-0000-0000-0000-000000000002', now(), 'replaced'
  from public.tasks where title = 'Evaluation fixture Task D 316 (per-task cap)';
insert into public.task_assignments (task_id, member_id)
select id, '31600000-0000-0000-0000-000000000003'
  from public.tasks where title = 'Evaluation fixture Task D 316 (per-task cap)';

select lives_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, '31600000-0000-0000-0000-000000000001',
            'completed', 3, 4, 6, 'command evaluation on the ended assignment'
       from public.tasks task
       join public.task_assignments assignment
         on assignment.task_id = task.id
        and assignment.member_id = '31600000-0000-0000-0000-000000000002'
      where task.title = 'Evaluation fixture Task D 316 (per-task cap)' $$,
  'a command Evaluation on Task D''s first (ended) Assignment is recorded');

select throws_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, '31600000-0000-0000-0000-000000000001',
            'completed', 2, 3, 4, 'a second command evaluation, different assignment, same task'
       from public.tasks task
       join public.task_assignments assignment
         on assignment.task_id = task.id
        and assignment.member_id = '31600000-0000-0000-0000-000000000003'
      where task.title = 'Evaluation fixture Task D 316 (per-task cap)' $$,
  '23505', null,
  'a second open command Evaluation on Task D''s other Assignment is rejected by the per-Task cap alone (the two rows share no Assignment)');

-- ==================== source: legacy_migration may omit an evaluator ====================
-- Task B's Assignment still carries no Evaluation at this point (the
-- earlier source-check and Assignment-mismatch tests on it never
-- succeeded), so this is its first real row.
select lives_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, source, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, 'legacy_migration',
            'completed', 2, 3, 4, 'backfilled from #317, no historical evaluator identified'
       from public.tasks task
       join public.task_assignments assignment on assignment.task_id = task.id
      where task.title = 'Evaluation fixture Task B 316' $$,
  'a legacy_migration Evaluation without evaluated_by is accepted (dobrerares, #316)');

-- ==================== source: legacy_migration allows two open Evaluations
-- on one Task across two different Assignments (the multi-assignee case:
-- "Migrare bază de date" has two assignees and two legitimate ledger
-- credits) ====================
insert into public.tasks (title, difficulty, rating, status, completed_at, dept_id)
values ('Evaluation fixture Task C 316 (multi-assignee legacy)', 3, 4, 'completed', now(), 'edu');
-- Both Assignments are ended, per #290's backfill
-- (20260911106000_backfill_task_assignments.sql) and the matching block in
-- seed.sql: for a *completed* legacy Task, every participant's Assignment
-- ends at the Task's completed_at with end_reason = 'completed' —
-- end_reason 'legacy_migration' is reserved for participants displaced from
-- an *unfinished* Task (todo/in_progress/in_review), not for this
-- completed-Task case. task_assignments permits only one active
-- (ended_at is null) row per Task at a time
-- (task_assignments_one_active_per_task_uidx), which is why both
-- participants must be ended history rather than two simultaneously active
-- Assignments.
insert into public.task_assignments (task_id, member_id, ended_at, end_reason)
select id, '31600000-0000-0000-0000-000000000002', completed_at, 'completed'
  from public.tasks where title = 'Evaluation fixture Task C 316 (multi-assignee legacy)';
insert into public.task_assignments (task_id, member_id, ended_at, end_reason)
select id, '31600000-0000-0000-0000-000000000003', completed_at, 'completed'
  from public.tasks where title = 'Evaluation fixture Task C 316 (multi-assignee legacy)';

select lives_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, source, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, 'legacy_migration',
            'completed', 3, 4, 6, 'legacy credit for executor A'
       from public.tasks task
       join public.task_assignments assignment
         on assignment.task_id = task.id
        and assignment.member_id = '31600000-0000-0000-0000-000000000002'
      where task.title = 'Evaluation fixture Task C 316 (multi-assignee legacy)' $$,
  'the first legacy Evaluation on a multi-assignee legacy Task is accepted');

select lives_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, source, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, 'legacy_migration',
            'completed', 2, 3, 4, 'legacy credit for executor B'
       from public.tasks task
       join public.task_assignments assignment
         on assignment.task_id = task.id
        and assignment.member_id = '31600000-0000-0000-0000-000000000003'
      where task.title = 'Evaluation fixture Task C 316 (multi-assignee legacy)' $$,
  'a second open legacy Evaluation on the same Task, for a different Assignment, is accepted (the multi-assignee case)');

-- ==================== at most one open Evaluation per Assignment,
-- regardless of source ====================
select throws_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, source, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, 'legacy_migration',
            'completed', 3, 4, 6, 'a second legacy credit for the same Assignment'
       from public.tasks task
       join public.task_assignments assignment
         on assignment.task_id = task.id
        and assignment.member_id = '31600000-0000-0000-0000-000000000002'
      where task.title = 'Evaluation fixture Task C 316 (multi-assignee legacy)' $$,
  '23505', null,
  'a second open legacy Evaluation for the same Assignment is rejected');

select throws_ok(
  $$ insert into public.task_evaluations
       (task_id, assignment_id, source, evaluated_by, outcome, difficulty, rating, points, note)
     select task.id, assignment.id, 'command', '31600000-0000-0000-0000-000000000001',
            'completed', 3, 4, 6, 'a command Evaluation racing the open legacy credit'
       from public.tasks task
       join public.task_assignments assignment
         on assignment.task_id = task.id
        and assignment.member_id = '31600000-0000-0000-0000-000000000003'
      where task.title = 'Evaluation fixture Task C 316 (multi-assignee legacy)' $$,
  '23505', null,
  'an open command Evaluation is rejected when its Assignment already carries an open legacy Evaluation (the per-Assignment cap applies regardless of source)');

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

-- ==================== source is immutable, even alongside a valid reversal ====================
-- Task B's legacy row (still open at this point) tries to reverse itself
-- correctly while also relabeling its source — the guard trigger's
-- unchanged-columns tuple now includes source, so this must still be
-- rejected as a whole, not silently accepted with source rewritten.
select throws_ok(
  format($$ update public.task_evaluations
               set reversed_at = now(), reversed_by = '31600000-0000-0000-0000-000000000001',
                   reversal_reason = 'reclassifying during reversal',
                   source = 'command'
             where task_id = %s $$,
    (select id from public.tasks where title = 'Evaluation fixture Task B 316')),
  '23514', 'task_evaluation_immutable',
  'a reversal that also changes source is rejected (source is immutable)');

select throws_ok(
  format($$ update public.task_evaluations
               set reversal_reason = 'trying again'
             where task_id = %s $$,
    (select id from public.tasks where title = 'Evaluation fixture Task A 316')),
  '23514', 'task_evaluation_immutable',
  'a second reversal of an already-reversed Evaluation is rejected');

-- ==================== a legacy Evaluation with a null evaluator can still
-- be reversed correctly (proves the guard's unchanged-columns comparison is
-- null-safe: evaluated_by stays null on both sides, which must read as
-- "unchanged", not as "distinct") ====================
select lives_ok(
  format($$ update public.task_evaluations
               set reversed_at = now(), reversed_by = '31600000-0000-0000-0000-000000000001',
                   reversal_reason = 'legacy credit reopened for correction'
             where task_id = %s $$,
    (select id from public.tasks where title = 'Evaluation fixture Task B 316')),
  'a legacy Evaluation with a null evaluated_by is reversed successfully');

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
-- #319 added task_evaluations_read and a SELECT grant; write grants stay
-- absent below (commands land in #327-#345).
select is((select count(*) from pg_policies
  where schemaname = 'public' and tablename = 'task_evaluations'), 1::bigint,
  'task_evaluations carries exactly the #319 read policy');

select is(has_table_privilege('authenticated', 'public.task_evaluations', 'SELECT'), true,
  'authenticated holds SELECT on Evaluations now that task_evaluations_read exists (#319)');
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
