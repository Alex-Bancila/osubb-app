-- legacy_task_import.test.sql -- #1050: the Legacy Import, closed (ruling R53).
--
-- The import ran once in production on 2026-10-17 (recorded on #1049) and
-- its command is gone. What stays is the registry, as the record of which
-- sheet row became which Task, and the legacy-source trigger, which now
-- refuses every legacy_migration Evaluation -- a registered Task included,
-- since 5 411 of them are registered and the old exception would admit a
-- second legacy Evaluation onto any of them.
--
-- Mutation guards (run 2026-10-18 against the local database, each reverted;
-- the assertion that turned red is named):
--   * before the migration (CI run 39072510378, commit cc87b40d) -> "the import
--     command is gone", "its read-back is gone with it", "no function in
--     public or private writes the registry" and "a legacy_migration
--     Evaluation is refused, even for a Task the import registered";
--   * the trigger letting a registered Task through again -> "a
--     legacy_migration Evaluation is refused, even for a Task the import
--     registered";
--   * a function inserting into the registry -> "no function in public or
--     private writes the registry";
--   * select on the registry granted to authenticated, and (CodeRabbit)
--     update granted to service_role -> "no role reads, inserts, updates or
--     deletes the registry directly";
--   * a public.import_legacy_tasks back in place -> "the import command is
--     gone: nobody can run the Legacy Import again".
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(9);

\ir _group_task_fixtures.psql
reset role;

-- A finished Task with its Executor's Assignment, registered as an imported
-- row -- the case the old exception let through.
select pg_temp.g521_task('li_closed', 'dept', 5, 'completed');
insert into public.legacy_task_imports (tracker_id, sheet_row, task_id)
select 'legacyImportTrackerLI0001', 2, id from g521_tasks where name = 'li_closed';

-- An imported Task as the run wrote it: finished, its Executor's ended
-- Assignment, a legacy_migration Evaluation with its ledger row, and its
-- registry row. The trigger refuses that Evaluation now, so it is written
-- past it the way reopen_task.test.sql and supabase/seed.sql build one.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status,
   difficulty, rating, created_at, started_at, completed_at, created_by)
values
  ('Importat LI', 'Din tracker', now() - interval '20 days',
   (select id from public.groups where name = 'Department #521'), 'local', 'direct', 'completed',
   3, 4, now() - interval '30 days', now() - interval '29 days', now() - interval '20 days',
   pg_temp.g521_uid(1));
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at, ended_at, end_reason)
select id, pg_temp.g521_uid(5), pg_temp.g521_uid(1), now() - interval '29 days', now() - interval '20 days', 'completed'
  from public.tasks where title = 'Importat LI';
set local session_replication_role = 'replica';
insert into public.task_evaluations
  (task_id, assignment_id, source, evaluated_by, outcome, difficulty, rating, points, note, evaluated_at)
select task.id, assignment.id, 'legacy_migration', null, 'completed', 3, 4, 6,
       'Importat din tracker', now() - interval '20 days'
  from public.tasks as task
  join public.task_assignments as assignment on assignment.task_id = task.id
 where task.title = 'Importat LI';
set local session_replication_role = 'origin';
insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id, created_at)
select pg_temp.g521_uid(5), 6, 'task', evaluation.task_id, evaluation.id, evaluation.evaluated_at
  from public.task_evaluations as evaluation
  join public.tasks as task on task.id = evaluation.task_id
 where task.title = 'Importat LI';
insert into public.legacy_task_imports (tracker_id, sheet_row, task_id)
select 'legacyImportTrackerLI0002', 2, id from public.tasks where title = 'Importat LI';

-- ==================== The command is gone ====================

select hasnt_function('public', 'import_legacy_tasks',
  'the import command is gone: nobody can run the Legacy Import again');
select hasnt_function('public', 'legacy_task_import_totals',
  'its read-back is gone with it');

-- ==================== The registry stays, a record ====================

select has_table('public', 'legacy_task_imports',
  'the registry stays as the record of which sheet row became which Task');
select is_empty($$
  select role.name || ' ' || privilege.name
    from unnest(array['anon', 'authenticated', 'service_role']) as role(name)
   cross join unnest(array['select', 'insert', 'update', 'delete']) as privilege(name)
   where has_table_privilege(role.name, 'public.legacy_task_imports', privilege.name)
$$, 'no role reads, inserts, updates or deletes the registry directly');
select is_empty($$
  select proc.oid::regprocedure::text
    from pg_proc as proc
    join pg_namespace as ns on ns.oid = proc.pronamespace
   where ns.nspname in ('public', 'private')
     and proc.prosrc ~* 'insert\s+into\s+public\.legacy_task_imports'
$$, 'no function in public or private writes the registry');

-- ==================== The legacy source, closed ====================

select throws_ok(
  $$insert into public.task_evaluations (task_id, assignment_id, source, evaluated_by, outcome, difficulty, rating, points, note)
    select task.id, assignment.id, 'legacy_migration', null, 'completed', 3, 5, 9, 'încă o dată'
      from g521_tasks as named
      join public.tasks as task on task.id = named.id
      join public.task_assignments as assignment on assignment.task_id = task.id
     where named.name = 'li_closed'
     limit 1$$,
  '23514', 'task_evaluation_legacy_source_closed',
  'a legacy_migration Evaluation is refused, even for a Task the import registered');

-- ==================== An imported Task is still deleted for good ====================
-- Deleting for good is the only correction left for an imported Task (ADR-0007,
-- amendment of 2026-10-14): it reverses the points, and the registry keeps its
-- row with the Task cleared, so the sheet row stays claimed.

create temp table li_doomed as select id from public.tasks where title = 'Importat LI';
grant select on li_doomed to authenticated;
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select lives_ok(format('select public.delete_task(%s, true)', (select id from li_doomed)),
  'BC deletes an imported Task for good, its points with it');
reset role;
select pg_temp.test_clear_jwt();
select is((select sum(delta)::int from public.points_ledger
            where member_id = pg_temp.g521_uid(5) and deleted_task_title = 'Importat LI'),
  0, 'its points are reversed: the Executor''s ledger nets to zero for it');
select is((select count(*)::int from public.legacy_task_imports
            where tracker_id = 'legacyImportTrackerLI0002' and sheet_row = 2 and task_id is null),
  1, 'the registry keeps the sheet row, its Task cleared');

select * from finish();
rollback;
