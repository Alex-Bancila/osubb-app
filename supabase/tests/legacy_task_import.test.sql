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
--   * select on the registry granted to authenticated -> "no role reads or
--     writes the registry directly";
--   * a public.import_legacy_tasks back in place -> "the import command is
--     gone: nobody can run the Legacy Import again".
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(6);

\ir _group_task_fixtures.psql
reset role;

-- A finished Task with its Executor's Assignment, registered as an imported
-- row -- the case the old exception let through.
select pg_temp.g521_task('li_closed', 'dept', 5, 'completed');
insert into public.legacy_task_imports (tracker_id, sheet_row, task_id)
select 'legacyImportTrackerLI0001', 2, id from g521_tasks where name = 'li_closed';

-- ==================== The command is gone ====================

select hasnt_function('public', 'import_legacy_tasks',
  'the import command is gone: nobody can run the Legacy Import again');
select hasnt_function('public', 'legacy_task_import_totals',
  'its read-back is gone with it');

-- ==================== The registry stays, a record ====================

select has_table('public', 'legacy_task_imports',
  'the registry stays as the record of which sheet row became which Task');
select ok(not has_table_privilege('anon', 'public.legacy_task_imports', 'select')
          and not has_table_privilege('anon', 'public.legacy_task_imports', 'insert')
          and not has_table_privilege('authenticated', 'public.legacy_task_imports', 'select')
          and not has_table_privilege('authenticated', 'public.legacy_task_imports', 'insert')
          and not has_table_privilege('service_role', 'public.legacy_task_imports', 'select')
          and not has_table_privilege('service_role', 'public.legacy_task_imports', 'insert'),
  'no role reads or writes the registry directly');
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

select * from finish();
rollback;
