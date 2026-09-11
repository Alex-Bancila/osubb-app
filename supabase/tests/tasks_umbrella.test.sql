-- tasks_umbrella.test.sql — #315: tasks.kind ('task'|'umbrella') and
-- tasks.parent_task_id, with the invariants for Umbrella Tasks and Subtasks
-- (ADR-0007 Sec "Umbrella Tasks and Subtasks", amended 2026-09-10). One
-- level deep; a Subtask inherits its Umbrella's Origin immutably; the
-- Umbrella has no Executor, queue, Difficulty, Rating, or points.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(25);

insert into auth.users (id, email) values
  ('31500000-0000-0000-0000-000000000001', 'umbrella-actor-315@test.local');
insert into public.profiles (id, full_name, email, role, status) values
  ('31500000-0000-0000-0000-000000000001', 'Umbrella Actor 315',
   'umbrella-actor-315@test.local', 'responsabil', 'activ');

-- ==================== schema ====================
select has_column('public', 'tasks', 'kind',
  'Tasks expose a kind (task|umbrella)');
select has_column('public', 'tasks', 'parent_task_id',
  'Tasks expose a parent_task_id for Subtasks');
select has_index('public', 'tasks', 'tasks_parent_idx',
  'Subtask lookups by parent are indexed');
select fk_ok('public', 'tasks', 'parent_task_id', 'public', 'tasks', 'id',
  'a Subtask''s parent_task_id references another Task');

-- ==================== valid shapes ====================
-- An Umbrella insert must pass explicit nulls: the audience/assignment_mode
-- columns keep their defaults ('local'/'direct') even after `not null` is
-- dropped, so omitting them here would silently fail tasks_umbrella_shape_ck.
select lives_ok(
  $$ insert into public.tasks
       (title, kind, dept_id, audience, assignment_mode, difficulty, rating)
     values
       ('Umbrella 315', 'umbrella', 'edu', null, null, null, null) $$,
  'a valid Umbrella (explicit nulls) is accepted');

select lives_ok(
  format($$ insert into public.tasks (title, dept_id, difficulty, parent_task_id)
            values ('Subtask 315', 'edu', 2, %L) $$,
    (select id from public.tasks where title = 'Umbrella 315')),
  'a valid Subtask inheriting its Umbrella''s Origin is accepted');

-- Fixtures for the "parent must be an Umbrella" checks below.
insert into public.tasks (title, dept_id, difficulty) values
  ('Ordinary task 315', 'edu', 1);

-- ==================== AC: umbrella with a mode, audience, difficulty or parent: rejected ====================
select throws_ok(
  $$ insert into public.tasks
       (title, kind, dept_id, audience, assignment_mode, difficulty, rating)
     values
       ('Umbrella with mode 315', 'umbrella', 'edu', null, 'direct', null, null) $$,
  '23514', 'new row for relation "tasks" violates check constraint "tasks_umbrella_shape_ck"',
  'an Umbrella with an Assignment Mode is rejected');

select throws_ok(
  $$ insert into public.tasks
       (title, kind, dept_id, audience, assignment_mode, difficulty, rating)
     values
       ('Umbrella with audience 315', 'umbrella', 'edu', 'org', null, null, null) $$,
  '23514', 'new row for relation "tasks" violates check constraint "tasks_umbrella_shape_ck"',
  'an Umbrella with an Audience is rejected');

select throws_ok(
  $$ insert into public.tasks
       (title, kind, dept_id, audience, assignment_mode, difficulty, rating)
     values
       ('Umbrella with difficulty 315', 'umbrella', 'edu', null, null, 3, null) $$,
  '23514', 'new row for relation "tasks" violates check constraint "tasks_umbrella_shape_ck"',
  'an Umbrella with a Difficulty is rejected');

select throws_ok(
  format($$ insert into public.tasks
              (title, kind, dept_id, audience, assignment_mode, difficulty, rating, parent_task_id)
            values
              ('Umbrella with parent 315', 'umbrella', 'edu', null, null, null, null, %L) $$,
    (select id from public.tasks where title = 'Umbrella 315')),
  '23514', 'new row for relation "tasks" violates check constraint "tasks_umbrella_shape_ck"',
  'an Umbrella with a parent_task_id is rejected');

-- ==================== AC: subtask under a subtask, or under an ordinary task: rejected ====================
select throws_ok(
  format($$ insert into public.tasks (title, dept_id, parent_task_id)
            values ('Subtask under ordinary 315', 'edu', %L) $$,
    (select id from public.tasks where title = 'Ordinary task 315')),
  '23514', 'task_parent_not_umbrella',
  'a Task cannot be parented under an ordinary (non-Umbrella) Task');

select throws_ok(
  format($$ insert into public.tasks (title, dept_id, parent_task_id)
            values ('Subtask under subtask 315', 'edu', %L) $$,
    (select id from public.tasks where title = 'Subtask 315')),
  '23514', 'task_parent_not_umbrella',
  'a Task cannot be parented under an existing Subtask (one level deep)');

-- ==================== AC: subtask with a different origin, or an origin update on a subtask: rejected ====================
select throws_ok(
  format($$ insert into public.tasks (title, dept_id, parent_task_id)
            values ('Subtask wrong origin 315', 'pr', %L) $$,
    (select id from public.tasks where title = 'Umbrella 315')),
  '23514', 'subtask_origin_mismatch',
  'a Subtask with a different Origin than its Umbrella is rejected');

select throws_ok(
  $$ update public.tasks set dept_id = 'pr' where title = 'Subtask 315' $$,
  '23514', 'subtask_origin_immutable',
  'updating a Subtask''s inherited Origin is rejected');

-- ==================== AC: ordinary task still requires audience and mode ====================
select throws_ok(
  $$ insert into public.tasks (title, dept_id, audience)
     values ('Task missing audience 315', 'edu', null) $$,
  '23514', 'new row for relation "tasks" violates check constraint "tasks_task_shape_ck"',
  'an ordinary Task still requires an Audience (explicit null rejected)');

select throws_ok(
  $$ insert into public.tasks (title, dept_id, assignment_mode)
     values ('Task missing mode 315', 'edu', null) $$,
  '23514', 'new row for relation "tasks" violates check constraint "tasks_task_shape_ck"',
  'an ordinary Task still requires an Assignment Mode (explicit null rejected)');

-- ==================== further invariants ====================
select throws_ok(
  $$ update public.tasks set parent_task_id = null where title = 'Subtask 315' $$,
  '23514', 'subtask_origin_immutable',
  'detaching a Subtask from its Umbrella (clearing parent_task_id) is rejected');

select throws_ok(
  $$ update public.tasks set kind = 'task' where title = 'Umbrella 315' $$,
  '23514', 'umbrella_has_subtasks',
  'an Umbrella with existing Subtasks cannot change kind away from umbrella');

-- A second top-level Umbrella, purely as a reparent target below.
insert into public.tasks
    (title, kind, dept_id, audience, assignment_mode, difficulty, rating)
  values
    ('Other umbrella 315', 'umbrella', 'edu', null, null, null, null);

select throws_ok(
  format($$ update public.tasks set parent_task_id = %L where title = 'Umbrella 315' $$,
    (select id from public.tasks where title = 'Other umbrella 315')),
  '23514', 'task_hierarchy_too_deep',
  'an Umbrella that already has Subtasks cannot itself become a Subtask');

-- ==================== Fix round 1: first link by UPDATE must check origin too ====================
-- An ordinary Task (parent_task_id null) can also become a Subtask through
-- `update ... set parent_task_id = <umbrella>`, not just at INSERT time. The
-- origin-equality check must fire on that first link regardless of which
-- statement performs it.
insert into public.tasks (title, dept_id, difficulty) values
  ('Ordinary task wrong-origin link 315', 'pr', 1);

select throws_ok(
  format($$ update public.tasks set parent_task_id = %L
            where title = 'Ordinary task wrong-origin link 315' $$,
    (select id from public.tasks where title = 'Umbrella 315')),
  '23514', 'subtask_origin_mismatch',
  'first linking a Task to an Umbrella of a different Origin via UPDATE is rejected');

insert into public.tasks (title, dept_id, difficulty) values
  ('Ordinary task same-origin link 315', 'edu', 1);

select lives_ok(
  format($$ update public.tasks set parent_task_id = %L
            where title = 'Ordinary task same-origin link 315' $$,
    (select id from public.tasks where title = 'Umbrella 315')),
  'first linking a Task to an Umbrella of the same Origin via UPDATE is allowed');

-- ==================== Fix round 1: umbrella-origin-change invariant, now exercised ====================
-- "An Umbrella with existing Subtasks cannot change its own Origin"
-- (~lines 128-136) previously had no assertion. Isolated: 'Umbrella 315'
-- carries no Campaign (#314's trigger returns immediately on a null
-- campaign_id) and 'fin' is a valid, distinct Department.
select throws_ok(
  $$ update public.tasks set dept_id = 'fin' where title = 'Umbrella 315' $$,
  '23514', 'subtask_origin_immutable',
  'an Umbrella with existing Subtasks cannot change its own Origin');

-- ==================== #314 interaction: a Campaign on an Umbrella ====================
insert into public.campaigns (department_id, name, is_active, created_by) values
  ('edu', 'Campaign Edu 315', true, '31500000-0000-0000-0000-000000000001');

select lives_ok(
  format($$ insert into public.tasks
              (title, kind, dept_id, audience, assignment_mode, difficulty, rating, campaign_id)
            values
              ('Umbrella with campaign 315', 'umbrella', 'edu', null, null, null, null, %L) $$,
    (select id from public.campaigns where name = 'Campaign Edu 315')),
  'an Umbrella accepts a same-Department Campaign (#314 interaction unchanged)');

-- ==================== tasks_with_overdue exposure ====================
select is(
  (select kind from public.tasks_with_overdue where title = 'Subtask 315'),
  'task',
  'kind is visible through tasks_with_overdue');

select is(
  (select parent_task_id from public.tasks_with_overdue where title = 'Subtask 315'),
  (select id from public.tasks where title = 'Umbrella 315'),
  'parent_task_id is visible through tasks_with_overdue');

select * from finish();
rollback;
