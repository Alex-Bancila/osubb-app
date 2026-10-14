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
--
-- Mutation guards (run 2026-10-14 against the local database, each reverted;
-- the assertions that turned red are named):
--   * the trigger returning `new` without reading the registry -> "a
--     legacy_migration Evaluation for a Task outside the registry is still
--     refused";
--   * the points_ledger insert removed -> "each row pays its points once,
--     negative included, dated on the completion day" (and the period read
--     and the promotion candidate with it);
--   * the registry skip removed -> the second call dies on
--     legacy_task_imports_pkey instead of reporting already_imported;
--   * "actor.role = 'moderator'" removed from the gate -> "a BC member cannot
--     run the import";
--   * the Evaluation's evaluated_at written as now() -> "each Evaluation is a
--     legacy_migration one with no evaluator, evaluated on the completion
--     day, written now" and both period reads;
--   * the `created` activity row given the acting Member -> "no activity row
--     names the acting Member, so their task_create cap is untouched".
--   Final review, 2026-10-14:
--   * BC and the Moderator excluded from the Executor check -> the "Leaders,
--     the importer and the Minimum Level" call dies on invalid_executor;
--   * the instant moved to 11:00 -> "a row completed on the day the clocks
--     change is dated 12:00 in Bucharest, summer time (09:00 UTC)" and every
--     dated row beside it;
--   * the description and sheet-Id limits removed, and the DETAIL dropped
--     from one step-1 refusal -> "a description above 2000 characters is
--     malformed", "a sheet Id above 40 characters is malformed", "a malformed
--     row is named too".
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(78);

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
insert into public.groups (name, category, min_level) values ('Board LI', 'department', 5);

-- An ordinary Task with an ended Assignment, for the closed-source probe.
insert into public.tasks (title, group_id, audience, assignment_mode, kind, status, created_by)
values ('Task obișnuit LI', pg_temp.gli('Dept LI'), 'local', 'direct', 'task', 'todo', pg_temp.uli(2));
insert into public.task_assignments (task_id, member_id, assigned_by)
select id, pg_temp.uli(4), pg_temp.uli(2) from public.tasks where title = 'Task obișnuit LI';

-- One command row; p_overrides replaces any key.
create function pg_temp.rli(p_sheet_row integer, p_overrides jsonb default '{}'::jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'tracker_id',   'legacyImportTrackerLI0001',
    'sheet_row',    p_sheet_row,
    'sheet_id',     '9-9-' || p_sheet_row,
    'group_id',     (select id from public.groups where name = 'Dept LI'),
    'executor_id',  pg_temp.uli(4),
    'title',        'Sarcină importată',
    'description',  null,
    'difficulty',   3,
    'rating',       5,
    'outcome',      'completed',
    'completed_on', '2026-03-10',
    'deadline_on',  '2026-03-12',
    'note',         'Observație din foaie: ședință') || p_overrides
$$;
-- The Task a sheet row became.
create function pg_temp.tli(p_sheet_row integer) returns bigint
language sql stable security definer set search_path = '' as $$
  select task_id from public.legacy_task_imports
   where tracker_id = 'legacyImportTrackerLI0001' and sheet_row = p_sheet_row
$$;
-- The DETAIL of the error a statement raises (null when it raises none).
create function pg_temp.detail_li(p_sql text) returns text language plpgsql as $$
declare
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;
-- Noon in Bucharest on a day: the import's only instant.
create function pg_temp.noon(p_day date) returns timestamptz language sql immutable as $$
  select (p_day::timestamp + interval '12 hours') at time zone 'Europe/Bucharest'
$$;
grant execute on function pg_temp.rli(integer, jsonb) to service_role, authenticated;
grant execute on function pg_temp.tli(integer) to service_role, authenticated;
grant execute on function pg_temp.detail_li(text) to service_role, authenticated;
grant execute on function pg_temp.noon(date) to service_role, authenticated;

create temp table rli (name text primary key, result jsonb);
grant all on rli to service_role;

update public.promotion_thresholds set threshold = 30 where kind = 'voluntar_activ';
update public.promotion_rules set enabled = true where kind = 'top_percent';

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

-- ==================== The command: surface ====================

select ok(has_function_privilege('service_role', 'public.import_legacy_tasks(uuid, jsonb, boolean)', 'execute')
          and not has_function_privilege('authenticated', 'public.import_legacy_tasks(uuid, jsonb, boolean)', 'execute')
          and not has_function_privilege('anon', 'public.import_legacy_tasks(uuid, jsonb, boolean)', 'execute'),
  'the import is service role only');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
            where oid = 'public.import_legacy_tasks(uuid, jsonb, boolean)'::regprocedure),
  'the import is a definer with an empty search_path');

-- ==================== Step 1: malformed, before the gate ====================

set local role service_role;

select throws_ok(format($$select public.import_legacy_tasks(null, %L::jsonb)$$, jsonb_build_array(pg_temp.rli(10))),
  'PT400', 'invalid_actor', 'no acting Member is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, '{}'::jsonb)$$, pg_temp.uli(1)),
  'PT400', 'invalid_rows', 'rows that are not an array are malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, '[]'::jsonb)$$, pg_temp.uli(1)),
  'PT400', 'invalid_rows', 'no rows at all is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    (select jsonb_agg(pg_temp.rli(n)) from generate_series(2, 202) as n)),
  'PT400', 'too_many_rows', 'more than 200 rows in one call is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"tracker_id": "scurt"}'))),
  'PT400', 'invalid_tracker_id', 'a tracker id that is no Drive file id is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(1))),
  'PT400', 'invalid_sheet_row', 'the header row is not a sheet row');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"title": "  "}'))),
  'PT400', 'title_required', 'a blank title is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"title": "PV"}'))),
  'PT400', 'title_too_short', 'a two-character title is refused: the limit is not loosened');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, jsonb_build_object('title', repeat('a', 121))))),
  'PT400', 'title_too_long', 'a title above 120 characters is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"group_id": null}'))),
  'PT400', 'task_group_required', 'a row naming no Group is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"executor_id": "cineva"}'))),
  'PT400', 'invalid_executor', 'an Executor that is no uuid is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"difficulty": 11}'))),
  'PT400', 'invalid_difficulty', 'a Difficulty that is no level is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"rating": 6}'))),
  'PT400', 'invalid_rating', 'a Rating outside 1-5 is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"outcome": "cancelled"}'))),
  'PT400', 'invalid_outcome', 'an outcome that is neither completed nor unfulfilled is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"completed_on": "2026-02-30"}'))),
  'PT400', 'invalid_completed_on', 'a completion date that does not exist is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, jsonb_build_object('completed_on',
      to_char((now() at time zone 'Europe/Bucharest')::date + 1, 'YYYY-MM-DD'))))),
  'PT400', 'invalid_completed_on', 'a completion date after today is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"deadline_on": "12/03/2026"}'))),
  'PT400', 'invalid_deadline', 'a deadline that is no ISO date is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"note": " "}'))),
  'PT400', 'evaluation_note_required', 'a blank Evaluation note is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, jsonb_build_object('description', repeat('d', 2001))))),
  'PT400', 'description_too_long', 'a description above 2000 characters is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, jsonb_build_object('sheet_id', repeat('9', 41))))),
  'PT400', 'invalid_sheet_id', 'a sheet Id above 40 characters is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"group_id": "dept"}'))),
  'PT400', 'invalid_origin', 'a Group that is no id is malformed');
select is(
  pg_temp.detail_li(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10), pg_temp.rli(11, '{"rating": 6}')))),
  'row 2 (legacyImportTrackerLI0001, sheet row 11)',
  'a malformed row is named too');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, jsonb_build_object('note', repeat('n', 1001))))),
  'PT400', 'note_too_long', 'an Evaluation note above 1000 characters is malformed');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10), pg_temp.rli(10))),
  'PT400', 'duplicate_row', 'the same sheet row twice in one call is malformed');
select is(
  pg_temp.detail_li(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10), pg_temp.rli(11), pg_temp.rli(10)))),
  'row 3 (legacyImportTrackerLI0001, sheet row 10)',
  'a repeated sheet row is named where it appears again');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(2),
    jsonb_build_array(pg_temp.rli(10, '{"rating": 6}'))),
  'PT400', 'invalid_rating', 'malformed input is judged before the gate');

-- ==================== Step 2: the gate ====================

select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(2),
    jsonb_build_array(pg_temp.rli(10))),
  '42501', 'legacy_import_forbidden', 'a BC member cannot run the import');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(3),
    jsonb_build_array(pg_temp.rli(10))),
  '42501', 'legacy_import_forbidden', 'an inactive Moderator cannot run the import');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(99),
    jsonb_build_array(pg_temp.rli(10))),
  '42501', 'legacy_import_forbidden', 'an unknown actor cannot run the import');

-- ==================== Step 3: against the loaded rows ====================

select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, jsonb_build_object('executor_id', pg_temp.uli(6))))),
  'PT400', 'invalid_executor', 'an inactive Member is no Executor');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, '{"group_id": 987654321}'))),
  'PT400', 'invalid_origin', 'an unknown Group is refused');
select throws_ok(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10, jsonb_build_object('group_id', pg_temp.gli('Arhivat LI'))))),
  'PT409', 'group_archived', 'an archived Group is refused');
select is(
  pg_temp.detail_li(format($$select public.import_legacy_tasks(%L, %L::jsonb)$$, pg_temp.uli(1),
    jsonb_build_array(pg_temp.rli(10), pg_temp.rli(11, jsonb_build_object('executor_id', pg_temp.uli(6)))))),
  'row 2 (legacyImportTrackerLI0001, sheet row 11)',
  'a refusal names the offending row');

reset role;
select is((select count(*) from public.legacy_task_imports where sheet_row in (10, 11)), 0::bigint,
  'one invalid row fails the whole call: the valid row beside it was not written');
set local role service_role;

-- ==================== A dry run ====================

insert into rli select 'dry', public.import_legacy_tasks(pg_temp.uli(1),
  jsonb_build_array(pg_temp.rli(10), pg_temp.rli(11, jsonb_build_object(
    'executor_id', pg_temp.uli(5), 'difficulty', 2, 'rating', 1, 'outcome', 'unfulfilled',
    'completed_on', '2026-04-02', 'deadline_on', null, 'note', 'Nu a livrat'))), true);
select is((select result from rli where name = 'dry'),
  '{"received": 2, "imported": 2, "already_imported": 0, "points": 7, "dry_run": true}'::jsonb,
  'a dry run reports what the real run would import');
reset role;
select is((select count(*) from public.legacy_task_imports where sheet_row in (10, 11)), 0::bigint,
  'a dry run writes nothing');

-- ==================== Two rows, imported ====================

set local role service_role;
insert into rli select 'first', public.import_legacy_tasks(pg_temp.uli(1),
  jsonb_build_array(pg_temp.rli(10), pg_temp.rli(11, jsonb_build_object(
    'executor_id', pg_temp.uli(5), 'title', '  Ședință ratată  ', 'difficulty', 2, 'rating', 1,
    'outcome', 'unfulfilled', 'completed_on', '2026-04-02', 'deadline_on', null, 'note', 'Nu a livrat'))));
select is((select result from rli where name = 'first'),
  '{"received": 2, "imported": 2, "already_imported": 0, "points": 7, "dry_run": false}'::jsonb,
  'the real run reports what it imported');
reset role;

select results_eq(
  $$select task.title, task.status::text, task.difficulty, task.rating, task.created_by, task.created_at,
           task.completed_at, task.unfulfilled_at, task.deadline, task.audience, task.assignment_mode,
           task.kind, task.group_id, task.description
      from public.tasks as task where task.id = pg_temp.tli(10)$$,
  $$values ('Sarcină importată', 'completed', 3, 5, pg_temp.uli(1), pg_temp.noon('2026-03-10'),
            pg_temp.noon('2026-03-10'), null::timestamptz, pg_temp.noon('2026-03-12'), 'local', 'direct',
            'task', pg_temp.gli('Dept LI'), null::text)$$,
  'a completed row is a completed Task dated on its completion day, created by the acting Member');
select results_eq(
  $$select task.title, task.status::text, task.completed_at, task.unfulfilled_at, task.deadline
      from public.tasks as task where task.id = pg_temp.tli(11)$$,
  $$values ('Ședință ratată', 'unfulfilled', null::timestamptz, pg_temp.noon('2026-04-02'), pg_temp.noon('2026-04-02'))$$,
  'an unfulfilled row is an unfulfilled Task; with no deadline in the sheet, the deadline is the completion instant');
select results_eq(
  $$select assignment.member_id, assignment.assigned_by, assignment.assigned_at, assignment.ended_at, assignment.end_reason
      from public.task_assignments as assignment
     where assignment.task_id in (pg_temp.tli(10), pg_temp.tli(11)) order by assignment.task_id$$,
  $$values (pg_temp.uli(4), pg_temp.uli(1), pg_temp.noon('2026-03-10'), pg_temp.noon('2026-03-10'), 'completed'),
           (pg_temp.uli(5), pg_temp.uli(1), pg_temp.noon('2026-04-02'), pg_temp.noon('2026-04-02'), 'failed')$$,
  'each row has one ended Assignment of its Executor, dated like the Task');
select results_eq(
  $$select evaluation.source, evaluation.evaluated_by, evaluation.outcome, evaluation.difficulty, evaluation.rating,
           evaluation.points, evaluation.note, evaluation.evaluated_at, evaluation.created_at = now()
      from public.task_evaluations as evaluation
     where evaluation.task_id in (pg_temp.tli(10), pg_temp.tli(11)) order by evaluation.task_id$$,
  $$values ('legacy_migration', null::uuid, 'completed', 3, 5, 9, 'Observație din foaie: ședință', pg_temp.noon('2026-03-10'), true),
           ('legacy_migration', null::uuid, 'unfulfilled', 2, 1, -2, 'Nu a livrat', pg_temp.noon('2026-04-02'), true)$$,
  'each Evaluation is a legacy_migration one with no evaluator, evaluated on the completion day, written now');
select results_eq(
  $$select entry.member_id, entry.delta, entry.reason, entry.created_at, entry.evaluation_id is not null
      from public.points_ledger as entry
     where entry.task_id in (pg_temp.tli(10), pg_temp.tli(11)) order by entry.task_id$$,
  $$values (pg_temp.uli(4), 9, 'task', pg_temp.noon('2026-03-10'), true),
           (pg_temp.uli(5), -2, 'task', pg_temp.noon('2026-04-02'), true)$$,
  'each row pays its points once, negative included, dated on the completion day');
select results_eq(
  $$select activity.kind, activity.actor_id, activity.occurred_at, activity.to_status::text
      from public.task_activity as activity where activity.task_id = pg_temp.tli(11) order by activity.id$$,
  $$values ('created', null::uuid, pg_temp.noon('2026-04-02'), 'todo'),
           ('executor_assigned', null::uuid, pg_temp.noon('2026-04-02'), null::text),
           ('unfulfilled', null::uuid, pg_temp.noon('2026-04-02'), 'unfulfilled')$$,
  'the Task history is the trail of a finished Task added directly, with no actor');
select is((select count(*) from public.task_activity where actor_id = pg_temp.uli(1)), 0::bigint,
  'no activity row names the acting Member, so their task_create cap is untouched');
select is((select count(*) from public.notifications where member_id in (pg_temp.uli(4), pg_temp.uli(5))), 0::bigint,
  'the import notifies no Executor');
select results_eq(
  $$select registry.sheet_row, registry.sheet_id, registry.imported_by, registry.task_id is not null
      from public.legacy_task_imports as registry where registry.sheet_row in (10, 11) order by 1$$,
  $$values (10, '9-9-10', pg_temp.uli(1), true), (11, '9-9-11', pg_temp.uli(1), true)$$,
  'the registry remembers which sheet row became which Task');

-- ==================== A re-run ====================

set local role service_role;
insert into rli select 'again', public.import_legacy_tasks(pg_temp.uli(1),
  jsonb_build_array(pg_temp.rli(10), pg_temp.rli(11, '{"outcome": "unfulfilled"}')));
insert into rli select 'mixed', public.import_legacy_tasks(pg_temp.uli(1),
  jsonb_build_array(pg_temp.rli(10), pg_temp.rli(12, jsonb_build_object(
    'executor_id', pg_temp.uli(5), 'completed_on', '2026-03-29', 'deadline_on', '2026-03-29'))));
reset role;
select is((select result from rli where name = 'again'),
  '{"received": 2, "imported": 0, "already_imported": 2, "points": 0, "dry_run": false}'::jsonb,
  'a second call with the same rows imports nothing');
select is((select count(*) from public.points_ledger where member_id = pg_temp.uli(4)), 1::bigint,
  'and pays nobody twice');
select is((select result from rli where name = 'mixed'),
  '{"received": 2, "imported": 1, "already_imported": 1, "points": 9, "dry_run": false}'::jsonb,
  'a call mixing imported and new rows imports only the new ones');
select is((select task.completed_at from public.tasks as task where task.id = pg_temp.tli(12)),
  '2026-03-29 09:00:00+00'::timestamptz,
  'a row completed on the day the clocks change is dated 12:00 in Bucharest, summer time (09:00 UTC)');
select is((select task.completed_at from public.tasks as task where task.id = pg_temp.tli(10)),
  '2026-03-10 10:00:00+00'::timestamptz,
  'a winter row is dated 12:00 in Bucharest, winter time (10:00 UTC)');

-- ==================== The scoring guide ====================

set local role service_role;
insert into rli select 'guide', public.import_legacy_tasks(pg_temp.uli(1),
  (select jsonb_agg(pg_temp.rli(1000 + (level - 1) * 5 + rating, jsonb_build_object(
            'executor_id', pg_temp.uli(5), 'difficulty', level, 'rating', rating,
            'completed_on', '2026-05-01', 'deadline_on', null)) order by level, rating)
     from generate_series(1, 10) as level, generate_series(1, 5) as rating));
reset role;
select results_eq(
  $$select evaluation.difficulty, evaluation.rating, evaluation.points
      from public.task_evaluations as evaluation
      join public.legacy_task_imports as registry on registry.task_id = evaluation.task_id
     where registry.sheet_row between 1001 and 1050 order by 1, 2$$,
  $$select level, rating, (array[1, 2, 3, 4, 5, 6, 7, 8, 15, 20])[level] * (array[-1, 0, 1, 2, 3])[rating]
      from generate_series(1, 10) as level, generate_series(1, 5) as rating order by 1, 2$$,
  'all 50 awards are the level''s base points times the Rating multiplier');

-- ==================== Period reads see the past ====================

select is((select earned.task_points from private.task_points_in_range(
             '2026-03-01 00:00+02'::timestamptz, '2026-03-20 00:00+02'::timestamptz) as earned
            where earned.member_id = pg_temp.uli(4)), 9,
  'the imported points fall in the period the work was done in');
select is((select count(*) from private.task_points_in_range(now() - interval '1 day', now() + interval '1 day') as earned
            where earned.member_id = pg_temp.uli(4)), 0::bigint,
  'and not in the period the import ran in');
select pg_temp.test_login_leadership(pg_temp.uli(1));
select is((select count(*) from public.leadership_member_tasks(pg_temp.uli(4),
             '2026-03-12 00:00+02'::timestamptz, '2026-03-13 00:00+02'::timestamptz)), 1::bigint,
  'the Work Filter finds an imported Task on its deadline day');
select pg_temp.test_clear_jwt();
reset role;

-- ==================== Promotion candidates ====================

set local role service_role;
select public.import_legacy_tasks(pg_temp.uli(1), jsonb_build_array(pg_temp.rli(20, jsonb_build_object(
  'executor_id', pg_temp.uli(7), 'difficulty', 10, 'rating', 5, 'completed_on', '2026-06-01'))));
reset role;
select is((select count(*) from public.promotion_candidates
            where member_id = pg_temp.uli(7) and decision is null), 1::bigint,
  'a Voluntar the history carries over the threshold is listed as a promotion candidate');

-- ==================== The totals the script reads back ====================

select ok(has_function_privilege('service_role', 'public.legacy_task_import_totals()', 'execute')
          and not has_function_privilege('authenticated', 'public.legacy_task_import_totals()', 'execute')
          and not has_function_privilege('anon', 'public.legacy_task_import_totals()', 'execute'),
  'the totals read is service role only');
set local role service_role;
insert into rli select 'totals', public.legacy_task_import_totals();
reset role;
select is((select (result ->> 'rows')::integer from rli where name = 'totals'), 54,
  'the totals count every imported Task: 2 + 1 + 50 + 1');
select is((select result -> 'members' -> pg_temp.uli(4)::text from rli where name = 'totals'),
  '{"rows": 1, "points": 9}'::jsonb,
  'the totals are per Member');
select is((select (result -> 'groups' -> pg_temp.gli('Dept LI')::text ->> 'rows')::integer from rli where name = 'totals'), 54,
  'and per Group');
select is((select jsonb_build_object('ledger_rows', result -> 'ledger_rows', 'ledger_points', result -> 'ledger_points',
                                     'points', result -> 'points') from rli where name = 'totals'),
  (select jsonb_build_object('ledger_rows', 54, 'ledger_points', sum(entry.delta), 'points', sum(entry.delta))
     from public.points_ledger as entry
     join public.legacy_task_imports as registry on registry.task_id = entry.task_id),
  'the totals count the ledger rows the import paid, and their sum is the Evaluations'' sum');
select is((select jsonb_build_object('from', result -> 'from', 'to', result -> 'to') from rli where name = 'totals'),
  '{"from": "2026-03-10", "to": "2026-06-01"}'::jsonb,
  'the totals name the first and last completion day, in Bucharest');

-- ==================== Reopen is refused; delete for good works ====================

select pg_temp.test_login_leadership(pg_temp.uli(1));
select throws_ok(
  $$select public.reopen_task(pg_temp.tli(10), 'Motiv de redeschidere pentru test')$$,
  'PT409', 'evaluation_not_found',
  'an imported Task cannot be reopened: reopen reverses a command Evaluation only');
select lives_ok(
  $$select public.delete_task(pg_temp.tli(10), true)$$,
  'an imported Task can be deleted for good with its points');
select pg_temp.test_clear_jwt();
reset role;
select is((select coalesce(sum(delta), 0) from public.points_ledger where member_id = pg_temp.uli(4)), 0::bigint,
  'deleting it reversed its points through the ledger');
set local role service_role;
insert into rli select 'after-delete', public.import_legacy_tasks(pg_temp.uli(1), jsonb_build_array(pg_temp.rli(10)));
reset role;
select is((select result ->> 'already_imported' from rli where name = 'after-delete'), '1',
  'the deleted Task''s sheet row stays claimed: a later call still skips it');

-- ==================== Leaders, the importer and the Minimum Level ====================

set local role service_role;
insert into rli select 'leaders', public.import_legacy_tasks(pg_temp.uli(1), jsonb_build_array(
  pg_temp.rli(30, jsonb_build_object('executor_id', pg_temp.uli(2))),
  pg_temp.rli(31, jsonb_build_object('executor_id', pg_temp.uli(1))),
  pg_temp.rli(32, jsonb_build_object('group_id', pg_temp.gli('Board LI')))));
reset role;
select is((select result from rli where name = 'leaders'),
  '{"received": 3, "imported": 3, "already_imported": 0, "points": 27, "dry_run": false}'::jsonb,
  'a BC Executor, the acting Moderator as Executor and a Group above the Executor''s level are all imported');
select results_eq(
  $$select registry.sheet_row, entry.member_id, entry.delta, origin.name
      from public.legacy_task_imports as registry
      join public.points_ledger as entry on entry.task_id = registry.task_id
      join public.tasks as task on task.id = registry.task_id
      join public.groups as origin on origin.id = task.group_id
     where registry.sheet_row in (30, 31, 32) order by 1$$,
  $$values (30, pg_temp.uli(2), 9, 'Dept LI'), (31, pg_temp.uli(1), 9, 'Dept LI'), (32, pg_temp.uli(4), 9, 'Board LI')$$,
  'each is credited like anyone: the grading was the sheet''s, not the importer''s');

select * from finish();
rollback;
