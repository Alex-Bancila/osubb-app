-- leadership_member_tasks.test.sql — #260: the BCE+ drill-down behind a
-- Leaderboard row. Fixture prefix 26000000-…; runs in one transaction and
-- rolls back, leaving the demo seed intact.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(40);

select has_function('public', 'leadership_member_tasks', array['uuid', 'timestamp with time zone', 'timestamp with time zone'], 'leadership drill-down is a public RPC');
select function_returns('public', 'leadership_member_tasks', array['uuid', 'timestamp with time zone', 'timestamp with time zone'], 'setof record', 'drill-down returns records');
-- #523: the wrapper/body split itself. The gate lives in the private body,
-- which is the only thing allowed to read Assignment history past RLS; the
-- public entry point must stay invoker so it cannot become a second, wider
-- door. Both directions of that mutation -- a `security definer` wrapper, or a
-- `security invoker` body -- leave every behavioural assertion below green,
-- which is why the split is pinned here rather than inferred from them.
select is((select prosecdef from pg_proc where oid = 'public.leadership_member_tasks(uuid, timestamptz, timestamptz)'::regprocedure),
  false, 'the public drill-down wrapper is security invoker');
select is((select prosecdef from pg_proc where oid = 'private.leadership_member_tasks_impl(uuid, timestamptz, timestamptz)'::regprocedure),
  true, 'the private drill-down body is security definer -- it reads past RLS and gates itself');
select ok(has_function_privilege('authenticated', 'public.leadership_member_tasks(uuid, timestamptz, timestamptz)', 'EXECUTE'), 'authenticated may call the gated RPC');
select ok(not has_function_privilege('anon', 'public.leadership_member_tasks(uuid, timestamptz, timestamptz)', 'EXECUTE'), 'anon cannot call the RPC');
select ok(not has_function_privilege('service_role', 'public.leadership_member_tasks(uuid, timestamptz, timestamptz)', 'EXECUTE'), 'server role has no BCE+ bypass');

-- ==================== The drill-down carries the whole Task ====================
-- J1's row click must render without a second query, so the drill-down has to
-- carry every `tasks_with_overdue` column. Eight are exposed under another
-- name: four would collide with an Assignment-level column (`id`,
-- `created_at`, `created_by`, `kind` -> task_id / task_created_at /
-- task_created_by / task_kind), and `type` is the retired legacy column
-- nothing reads. (#579 dropped the Origin triple with the legacy columns it
-- rendered: group_id / group_name are the whole Origin.) Pinning the *difference* rather than the overlap is
-- what makes this fail the day a migration adds a column to public.tasks --
-- silence would otherwise be mistaken for coverage.
create function pg_temp.drilldown_columns() returns text[]
language sql as $$
  select coalesce(array_agg(a.name), '{}')
    from pg_proc p,
         unnest(p.proargnames, p.proargmodes) as a(name, mode)
   where p.oid = 'public.leadership_member_tasks(uuid, timestamptz, timestamptz)'::regprocedure
     and a.mode = 't'
$$;

select set_eq(
  format($$ select column_name::text from information_schema.columns
             where table_schema = 'public' and table_name = 'tasks_with_overdue'
               and column_name <> all (%L::text[]) $$, pg_temp.drilldown_columns()),
  $$ values ('id'::text), ('created_at'), ('created_by'), ('kind'),
            ('type') $$,
  'the drill-down exposes every tasks_with_overdue column under its own name except the four renamed for the Assignment row and the retired legacy `type`');

insert into auth.users (id, email) values
  ('26000000-0000-0000-0000-000000000001', 'bce260@example.test'),
  ('26000000-0000-0000-0000-000000000002', 'target260@example.test'),
  ('26000000-0000-0000-0000-000000000003', 'ordinary260@example.test'),
  ('26000000-0000-0000-0000-000000000004', 'inactive260@example.test'),
  ('26000000-0000-0000-0000-000000000005', 'responsabil260@example.test'),
  ('26000000-0000-0000-0000-000000000006', 'bc260@example.test');
-- The two personas at the end pin the THRESHOLD rather than merely "some level
-- is denied": a responsabil sits at level 4, one rank below the gate, so a gate
-- accidentally loosened to `>= 4` must turn an assertion red; and a BC keeps the
-- allow side from resting on BCE alone.
insert into public.profiles (id, full_name, email, role, status) values
  ('26000000-0000-0000-0000-000000000001', 'BCE 260', 'bce260@example.test', 'bce', 'activ'),
  ('26000000-0000-0000-0000-000000000002', 'Target 260', 'target260@example.test', 'activ', 'activ'),
  ('26000000-0000-0000-0000-000000000003', 'Ordinary 260', 'ordinary260@example.test', 'activ', 'activ'),
  ('26000000-0000-0000-0000-000000000004', 'Inactive BCE 260', 'inactive260@example.test', 'bce', 'inactiv'),
  ('26000000-0000-0000-0000-000000000005', 'Responsabil 260', 'responsabil260@example.test', 'vot', 'activ'),
  ('26000000-0000-0000-0000-000000000006', 'BC 260', 'bc260@example.test', 'bc', 'activ');

insert into public.campaigns (group_id, name, created_by) values
  (pg_temp.dept_group('edu'), 'Campaign 260', '26000000-0000-0000-0000-000000000001');
insert into public.tasks
  (title, description, deadline, group_id, kind, audience, assignment_mode, difficulty, rating, created_by)
values
  ('Umbrella 260', 'Parent details 260', now() + interval '2 days', pg_temp.dept_group('edu'), 'umbrella', null, null, null, null,
   '26000000-0000-0000-0000-000000000001');
insert into public.tasks
  (title, description, deadline, group_id, campaign_id, status, difficulty, rating,
   created_by, created_at, started_at, submitted_at, unfulfilled_at, parent_task_id)
select 'Historical Subtask 260', 'Full details 260', now() - interval '2 days', pg_temp.dept_group('edu'), campaign.id,
       'unfulfilled', 2, 1, '26000000-0000-0000-0000-000000000001', now() - interval '5 days',
       now() - interval '4 days', now() - interval '3 days', now() - interval '1 day', parent.id
  from public.campaigns as campaign
  cross join public.tasks as parent
 where campaign.name = 'Campaign 260' and parent.title = 'Umbrella 260';
insert into public.task_assignments
  (task_id, member_id, assigned_by, assigned_at, ended_at, end_reason, end_note)
select id, '26000000-0000-0000-0000-000000000002', '26000000-0000-0000-0000-000000000001',
       now() - interval '4 days', now() - interval '1 day', 'failed', 'Preserved end note 260'
  from public.tasks where title = 'Historical Subtask 260';
insert into public.task_evaluations
  (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note, evaluated_at,
   reversed_at, reversed_by, reversal_reason)
select task.id, assignment.id, '26000000-0000-0000-0000-000000000001', 'unfulfilled', 2, 1, -2,
       'Evaluation note 260', now() - interval '1 day', now() - interval '12 hours',
       '26000000-0000-0000-0000-000000000001', 'Reopened briefly 260'
  from public.tasks as task
  join public.task_assignments as assignment on assignment.task_id = task.id
 where task.title = 'Historical Subtask 260';

select pg_temp.test_login_leadership('26000000-0000-0000-0000-000000000001');
select is((select count(*) from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 1::bigint,
  'BCE sees the selected Member historical Assignment without current Origin membership');
select is((select group_id from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), pg_temp.dept_group('edu'),
  'Task Origin is explicit: the owning Group');
select is((select campaign_name from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 'Campaign 260',
  'Campaign details are exposed');
select is((select parent_task_title from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 'Umbrella 260',
  'the Subtask identifies its parent Umbrella');
select is((select status::text from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 'unfulfilled',
  'unfulfilled is retained as the outcome state');
select is((select completed_late from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), false,
  'an unfulfilled outcome is not mislabeled as completed late');
select is((select evaluation_history -> 0 ->> 'note' from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 'Evaluation note 260',
  'Evaluation and reversal history is present');

-- The Assignment state for that Task, in the same row: who held it, when it
-- started, how it ended and why.
select is(
  (select array[assignment_end_reason, assignment_end_note]
     from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')),
  array['failed', 'Preserved end note 260'],
  'the Assignment''s own outcome and note travel with the Task row');
select ok(
  (select assignment_ended_at is not null and assignment_ended_at >= assigned_at
     from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')),
  'the Assignment carries both of its instants, in order');
select is(
  (select assigned_by from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')),
  '26000000-0000-0000-0000-000000000001'::uuid,
  'the Assignment names who handed the work out');

-- The Evaluation that produced the points, in the same row: difficulty,
-- rating and points, so the drill-down never needs a second query.
select is(
  (select array[evaluation_history -> 0 ->> 'difficulty',
                evaluation_history -> 0 ->> 'rating',
                evaluation_history -> 0 ->> 'points',
                evaluation_history -> 0 ->> 'outcome']
     from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')),
  array['2', '1', '-2', 'unfulfilled'],
  'the Evaluation''s Difficulty, Rating, points and outcome are in the row');
select ok(
  (select evaluation_history -> 0 ->> 'reversal_reason' = 'Reopened briefly 260'
     from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')),
  'a reversed Evaluation says so, rather than disappearing from the history');

-- A Member with no Assignment history at all is an ordinary, empty answer:
-- the Leaderboard opens on anyone, and "never held a Task" is not an error.
select is((select count(*) from public.leadership_member_tasks('26000000-0000-0000-0000-000000000003')), 0::bigint,
  'a Member with no Assignment history returns zero rows rather than raising');
select lives_ok(
  $$ select * from public.leadership_member_tasks('26000000-0000-0000-0000-000000000099') $$,
  'a uuid that is nobody returns quietly too -- the drill-down never raises on its argument');

select pg_temp.test_login_leadership('26000000-0000-0000-0000-000000000003');
select is((select count(*) from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 0::bigint,
  'ordinary Member cannot inspect someone else');
select pg_temp.test_login('26000000-0000-0000-0000-000000000003',
  '{"member_role":"bce","member_level":5,"dept_ids":[],"team_ids":[]}'::jsonb);
select is((select count(*) from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 0::bigint,
  'live demotion defeats stale BCE claims');
select pg_temp.test_login_leadership('26000000-0000-0000-0000-000000000004');
select is((select count(*) from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 0::bigint,
  'inactive BCE sees no protected rows despite stale claims');
-- The gate is `>= 5`, not `>= 4`. Without this pair every denied persona here
-- is level 2, inactive, demoted or claimless, so loosening the threshold by one
-- rank would leave the whole suite green -- and level 4 is exactly where the UI
-- already draws a different line (capabilities.ts: manageTasks: 4).
select pg_temp.test_login_leadership('26000000-0000-0000-0000-000000000005');
select is((select count(*) from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 0::bigint,
  'a responsabil (level 4, one rank below the gate) cannot open another Member''s Tracker');
select pg_temp.test_login_leadership('26000000-0000-0000-0000-000000000006');
select isnt((select count(*) from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 0::bigint,
  'a BC does see the drill-down -- the allow side is not carried by BCE alone');
select pg_temp.test_login('26000000-0000-0000-0000-000000000001', '{}'::jsonb);
select is((select count(*) from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 0::bigint,
  'claimless caller sees no protected rows');
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select * from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'anon has no RPC grant');

reset role;
select pg_temp.test_login_leadership('26000000-0000-0000-0000-000000000001');
select results_eq(
  $$select distinct group_id,group_name from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002') where title='Historical Subtask 260'$$,
  $$select id,name from public.groups where name = 'Educațional'$$,
  'the fixture Subtask carries its owning Group id and name');

-- #523: `group_name` has to come from the Group, not from the legacy Origin
-- name sitting two columns to its left. Every Wave 1 Group is mirrored from its
-- legacy structure and therefore *carries that structure's own name*, so the
-- assertion above reads the same whether `group_name` is wired to
-- `origin_group.name` or to `coalesce(origin_department.name, …)`. Renaming the
-- Group alone -- inside this rolled-back transaction, leaving
-- `pg_temp.fixture_departments` untouched -- is what separates the two columns.
reset role;
update public.groups set name = 'Grup Redenumit 523' where name = 'Educațional';
select pg_temp.test_login_leadership('26000000-0000-0000-0000-000000000001');
select is(
  (select distinct group_name from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')
    where title = 'Historical Subtask 260'),
  'Grup Redenumit 523',
  'group_name follows the Group''s own name, not the legacy Origin name beside it');
select ok(not (array['origin_type', 'origin_id', 'origin_name'] && pg_temp.drilldown_columns()),
  'the legacy Origin triple is gone -- group_id / group_name are the whole Origin (#579)');

-- ==================== #677: the Work Filter deadline range ====================
-- The drill-down's range reads the Task deadline, half-open [p_from, p_to).
-- A Member of their own with two Assignments: one on a Task due at
-- T1 = 2001-03-10 10:00Z, one on a Task with no deadline at all, which any
-- bound excludes.
reset role;
insert into auth.users (id, email) values
  ('26000000-0000-0000-0000-000000000007', 'range260@example.test');
insert into public.profiles (id, full_name, email, role, status) values
  ('26000000-0000-0000-0000-000000000007', 'Range 260', 'range260@example.test', 'activ', 'activ');
insert into public.tasks (title, description, deadline, group_id, created_by)
values
  ('Dated Task 260', 'Due at T1', '2001-03-10 10:00:00+00', pg_temp.dept_group('edu'),
   '26000000-0000-0000-0000-000000000001'),
  ('Undated Task 260', 'No deadline', null, pg_temp.dept_group('edu'),
   '26000000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by)
select id, '26000000-0000-0000-0000-000000000007', '26000000-0000-0000-0000-000000000001'
  from public.tasks where title in ('Dated Task 260', 'Undated Task 260');

select is((select count(*)::int from pg_proc
            where proname = 'leadership_member_tasks' and pronamespace = 'public'::regnamespace), 1,
  'exactly one leadership_member_tasks overload exists -- PostgREST can resolve the call (no PGRST203)');

select pg_temp.test_login_leadership('26000000-0000-0000-0000-000000000001');
select is((select count(*) from public.leadership_member_tasks('26000000-0000-0000-0000-000000000007')), 2::bigint,
  'with no range both Assignments are there, the undated Task included');
select results_eq(
  $$ select title from public.leadership_member_tasks('26000000-0000-0000-0000-000000000007',
       '2001-03-10 10:00:00+00', '2001-03-10 10:00:01+00') $$,
  $$ values ('Dated Task 260'::text) $$,
  'a Task due at T1 is in [T1, T1 + 1s) -- the from bound is inclusive');
select is((select count(*) from public.leadership_member_tasks('26000000-0000-0000-0000-000000000007',
            '2001-03-10 10:00:00.000001+00', null)), 0::bigint,
  'and not in [T1 + 1us, open) -- the from bound really filters, and the undated Task is out');
select is((select count(*) from public.leadership_member_tasks('26000000-0000-0000-0000-000000000007',
            null, '2001-03-10 10:00:00+00')), 0::bigint,
  'nor in [open, T1) -- the to bound is exclusive and really filters');
select results_eq(
  $$ select title from public.leadership_member_tasks('26000000-0000-0000-0000-000000000007',
       null, '2100-01-01 00:00:00+00') $$,
  $$ values ('Dated Task 260'::text) $$,
  'a to bound alone drops the Task with no deadline');
select results_eq(
  $$ select title from public.leadership_member_tasks('26000000-0000-0000-0000-000000000007',
       '1900-01-01 00:00:00+00', null) $$,
  $$ values ('Dated Task 260'::text) $$,
  'and so does a from bound alone');

-- Step 1, before authority: an ordinary Member otherwise gets no rows.
select pg_temp.test_login_leadership('26000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ select * from public.leadership_member_tasks('26000000-0000-0000-0000-000000000007',
       '2001-04-10 10:00:00+00', '2001-03-10 10:00:00+00') $$,
  'PT400', 'invalid_date_range',
  'an inverted range is PT400 invalid_date_range, before the BCE+ gate');

reset role;
select * from finish();
rollback;
