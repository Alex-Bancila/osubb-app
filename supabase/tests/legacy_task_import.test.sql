-- legacy_task_import.test.sql -- #1049: the one-time Legacy Import (spec 2026-10-13, ruling R53).
--
-- public.legacy_task_imports, the legacy-source trigger's one exception,
-- public.import_legacy_tasks and public.legacy_task_import_totals.
--
-- Fixtures (owner, rolled back), ids 10490000-...-0000000000NN:
--   01 Moderator, activ      the acting Member
--   02 BC, activ             may not run the import
--   03 Moderator, inactiv    may not run it either
--   04 Voluntar, activ       Executor of the two base rows
--   05 Vot, activ            Executor of the other rows
--   06 Voluntar, inactiv     never an Executor
--   07 Voluntar, activ       crosses the Voluntar Activ threshold
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(8);

create function pg_temp.uli(n integer) returns uuid language sql immutable as $$
  select ('10490000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.gli(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;
grant execute on function pg_temp.uli(integer) to service_role, authenticated;
grant execute on function pg_temp.gli(text) to service_role, authenticated;

insert into auth.users (id, email)
select pg_temp.uli(n), 'li' || n || '@test.local' from generate_series(1, 7) as n;
insert into public.profiles (id, full_name, email, role, status, joined_at) values
  (pg_temp.uli(1), 'Moderator LI',         'li1@test.local', 'moderator', 'activ',   '2025-01-01'),
  (pg_temp.uli(2), 'BC LI',                'li2@test.local', 'bc',        'activ',   '2025-01-01'),
  (pg_temp.uli(3), 'Moderator inactiv LI', 'li3@test.local', 'moderator', 'inactiv', '2025-01-01'),
  (pg_temp.uli(4), 'Voluntar LI',          'li4@test.local', 'voluntar',  'activ',   '2025-01-01'),
  (pg_temp.uli(5), 'Vot LI',               'li5@test.local', 'vot',       'activ',   '2025-01-01'),
  (pg_temp.uli(6), 'Voluntar inactiv LI',  'li6@test.local', 'voluntar',  'inactiv', '2025-01-01'),
  (pg_temp.uli(7), 'Voluntar prag LI',     'li7@test.local', 'voluntar',  'activ',   '2025-01-01');
insert into public.groups (name, category, min_level) values ('Dept LI', 'department', 0);
insert into public.groups (name, category, min_level, status) values ('Arhivat LI', 'department', 0, 'archived');

-- An ordinary Task with an ended Assignment, for the closed-source probe.
insert into public.tasks (title, group_id, audience, assignment_mode, kind, status, created_by)
values ('Task obișnuit LI', pg_temp.gli('Dept LI'), 'local', 'direct', 'task', 'todo', pg_temp.uli(2));
insert into public.task_assignments (task_id, member_id, assigned_by)
select id, pg_temp.uli(4), pg_temp.uli(2) from public.tasks where title = 'Task obișnuit LI';

-- ==================== Schema ====================

select has_table('public', 'legacy_task_imports', 'the registry exists');
select col_is_pk('public', 'legacy_task_imports', array['tracker_id', 'sheet_row'],
  'a sheet row is identified by its tracker and row number');
select ok((select relrowsecurity from pg_class where oid = 'public.legacy_task_imports'::regclass),
  'the registry has RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.legacy_task_imports', 'select')
          and not has_table_privilege('anon', 'public.legacy_task_imports', 'select')
          and not has_table_privilege('service_role', 'public.legacy_task_imports', 'select')
          and not has_table_privilege('service_role', 'public.legacy_task_imports', 'insert'),
  'no role reads or writes the registry directly');
select throws_ok(
  $$insert into public.legacy_task_imports (tracker_id, sheet_row) values ('short', 2)$$,
  '23514', 'new row for relation "legacy_task_imports" violates check constraint "legacy_task_imports_tracker_id_ck"',
  'a tracker id is a Drive file id');
select throws_ok(
  $$insert into public.legacy_task_imports (tracker_id, sheet_row) values ('legacyImportTrackerLI0001', 1)$$,
  '23514', 'new row for relation "legacy_task_imports" violates check constraint "legacy_task_imports_sheet_row_ck"',
  'the header row is not a sheet row');

-- ==================== The closed source ====================

select throws_ok(
  $$insert into public.task_evaluations (task_id, assignment_id, source, evaluated_by, outcome, difficulty, rating, points, note)
    select task.id, assignment.id, 'legacy_migration', null, 'completed', 3, 5, 9, 'fără registru'
      from public.tasks as task join public.task_assignments as assignment on assignment.task_id = task.id
     where task.title = 'Task obișnuit LI'$$,
  '23514', 'task_evaluation_legacy_source_closed',
  'a legacy_migration Evaluation for a Task outside the registry is still refused');

-- Registers the ordinary Task, inserts its legacy Evaluation, and rolls both
-- back by raising inside its own block: true means the insert got through.
-- Rolled back so that the probe never counts in the totals asserted later.
create function pg_temp.registered_probe_li() returns boolean language plpgsql as $$
begin
  insert into public.legacy_task_imports (tracker_id, sheet_row, task_id)
  select 'legacyImportTrackerLI0002', 2, id from public.tasks where title = 'Task obișnuit LI';
  insert into public.task_evaluations (task_id, assignment_id, source, evaluated_by, outcome, difficulty, rating, points, note)
  select task.id, assignment.id, 'legacy_migration', null, 'completed', 3, 5, 9, 'cu registru'
    from public.tasks as task join public.task_assignments as assignment on assignment.task_id = task.id
   where task.title = 'Task obișnuit LI';
  raise exception 'probe' using errcode = 'LI001';
exception when sqlstate 'LI001' then
  return true;
end;
$$;
select ok(pg_temp.registered_probe_li(),
  'a registered Task accepts its legacy_migration Evaluation');

select * from finish();
rollback;
