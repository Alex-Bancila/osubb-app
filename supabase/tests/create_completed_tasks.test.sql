-- create_completed_tasks (spec 2026-10-11, Part E): n finished Tasks for n
-- volunteers in ONE transaction -- the same Member may be credited several
-- times. The body loops private.create_completed_task_impl, so every rule of
-- create_completed_task holds per copy; this suite pins the count and
-- executor rules, the repeat, the atomicity and that nothing of its own is
-- locked. Personas and Groups: the #915 fixture shape, prefix 9470.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(23);

create function pg_temp.u947(n integer) returns uuid language sql immutable as $$
  select ('94700000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
grant execute on function pg_temp.u947(integer) to authenticated, anon;
--  1 bce, Manager of Dept E   2 activ, member of Dept E   3 activ, member of Dept E
--  4 voluntar, member of Dept F (outside)   5 bc, member of Dept E (never an Executor)
insert into auth.users (id, email)
select pg_temp.u947(n), 'm947.' || n || '@test.local' from generate_series(1, 5) n;
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.u947(n), 'Membru 947 ' || n, 'm947.' || n || '@test.local',
       (case n when 1 then 'bce' when 4 then 'voluntar' when 5 then 'bc' else 'activ' end)::public.member_role, 'activ'
  from generate_series(1, 5) n;
insert into public.groups (name, category, min_level) values ('Dept E #947', 'department', 0), ('Dept F #947', 'department', 0);
create function pg_temp.g947(p_name text) returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;
grant execute on function pg_temp.g947(text) to authenticated, anon;
insert into public.group_members (group_id, member_id, group_role)
select pg_temp.g947(row_.name), pg_temp.u947(row_.n), row_.group_role
  from (values ('Dept E #947', 1, 'manager'), ('Dept E #947', 2, 'member'), ('Dept E #947', 3, 'member'),
               ('Dept E #947', 5, 'member'), ('Dept F #947', 4, 'member')) as row_ (name, n, group_role);

-- ==================== API surface ====================
select ok(not has_function_privilege('anon',
  'public.create_completed_tasks(uuid[], bigint, text, text, bigint, integer, integer, text, jsonb, integer)', 'execute'),
  'anon cannot execute create_completed_tasks');
select ok(has_function_privilege('authenticated',
  'public.create_completed_tasks(uuid[], bigint, text, text, bigint, integer, integer, text, jsonb, integer)', 'execute'),
  'authenticated executes it; the gate is inside');
select is((select prosecdef from pg_proc where proname = 'create_completed_tasks_impl' and pronamespace = 'private'::regnamespace), true,
  'the body is security definer');
select ok((select proconfig @> array['search_path=""'] from pg_proc where proname = 'create_completed_tasks_impl' and pronamespace = 'private'::regnamespace),
  'the body pins an empty search_path');
select is((select proretset from pg_proc where proname = 'create_completed_tasks' and pronamespace = 'public'::regnamespace), true,
  'create_completed_tasks returns the created rows');
select ok(pg_get_functiondef('private.create_completed_tasks_impl(uuid[], bigint, text, text, bigint, integer, integer, text, jsonb, integer)'::regprocedure) !~* 'for update',
  'the body takes no lock of its own');

-- ==================== Step 1: malformed before the gate ====================
select pg_temp.test_clear_jwt();
set local role authenticated;
select throws_ok($$select count(*) from public.create_completed_tasks(array[pg_temp.u947(2)], pg_temp.g947('Dept E #947'), 'Zero', null,
  p_difficulty => 4, p_rating => 5, p_note => 'ok', p_copies => 0)$$,
  'PT400', 'invalid_copies', 'a count of zero is refused before the gate');
reset role;
select pg_temp.test_login_leadership(pg_temp.u947(1));
select throws_ok($$select count(*) from public.create_completed_tasks(array[pg_temp.u947(2)], pg_temp.g947('Dept E #947'), 'Prea multe', null,
  p_difficulty => 4, p_rating => 5, p_note => 'ok', p_copies => 101)$$,
  'PT400', 'too_many_copies', 'a hundred and one are too many');
select throws_ok($$select count(*) from public.create_completed_tasks(null, pg_temp.g947('Dept E #947'), 'Fara lista', null,
  p_difficulty => 4, p_rating => 5, p_note => 'ok', p_copies => 2)$$,
  'PT400', 'invalid_executors', 'no list at all: a finished Task always names its Executor');
select throws_ok($$select count(*) from public.create_completed_tasks(array[pg_temp.u947(2)], pg_temp.g947('Dept E #947'), 'Unul din doi', null,
  p_difficulty => 4, p_rating => 5, p_note => 'ok', p_copies => 2)$$,
  'PT400', 'invalid_executors', 'one entry for two copies');
select throws_ok($$select count(*) from public.create_completed_tasks(array[pg_temp.u947(2), null], pg_temp.g947('Dept E #947'), 'Gol', null,
  p_difficulty => 4, p_rating => 5, p_note => 'ok', p_copies => 2)$$,
  'PT400', 'invalid_executors', 'an empty entry is refused: no unassigned finished Task');
reset role;
select is((select count(*) from public.tasks where title in ('Zero', 'Prea multe', 'Fara lista', 'Unul din doi', 'Gol'))::int, 0,
  'a refused call creates nothing');

-- ==================== Two volunteers, and the same one twice ====================
select pg_temp.test_login_leadership(pg_temp.u947(1));
select is((select count(*) from public.create_completed_tasks(array[pg_temp.u947(2), pg_temp.u947(3)], pg_temp.g947('Dept E #947'),
  'Doi voluntari #947', 'd', p_difficulty => 4, p_rating => 5, p_note => 'Bine', p_copies => 2))::int, 2,
  'two finished copies for two volunteers come back as two rows');
select is((select count(*) from public.create_completed_tasks(array[pg_temp.u947(2), pg_temp.u947(2), pg_temp.u947(2)], pg_temp.g947('Dept E #947'),
  'De trei ori #947', 'd', p_difficulty => 2, p_rating => 5, p_note => 'Bine', p_copies => 3))::int, 3,
  'the same volunteer three times: three rows');
reset role;
select is((select count(*) from public.tasks where title = 'Doi voluntari #947' and status = 'completed')::int, 2,
  'both copies are completed Tasks');
select set_eq(
  $$ select assignment.member_id from public.task_assignments as assignment
       join public.tasks as task on task.id = assignment.task_id where task.title = 'Doi voluntari #947' $$,
  $$ values (pg_temp.u947(2)), (pg_temp.u947(3)) $$,
  'each copy credits its own volunteer');
select is((select count(*) from public.task_evaluations as evaluation
             join public.tasks as task on task.id = evaluation.task_id where task.title = 'De trei ori #947')::int, 3,
  'three Evaluations for the repeated volunteer');
select is((select sum(ledger.delta) from public.points_ledger as ledger
             join public.tasks as task on task.id = ledger.task_id
            where task.title = 'De trei ori #947' and ledger.member_id = pg_temp.u947(2))::int,
  (3 * (2 * public.rating_mult(5)))::int,
  'and three times the points in the ledger');
select is((select count(*) from public.notifications as notification
             join public.tasks as task on task.id = notification.task_id
            where task.title = 'De trei ori #947' and notification.member_id = pg_temp.u947(2))::int, 3,
  'one "Task evaluat" per copy, as three Tasks are');

-- ==================== Atomicity ====================
select pg_temp.test_login_leadership(pg_temp.u947(1));
select throws_ok($$select count(*) from public.create_completed_tasks(array[pg_temp.u947(2), pg_temp.u947(4)], pg_temp.g947('Dept E #947'),
  'Unul din afara #947', 'd', p_difficulty => 4, p_rating => 5, p_note => 'Bine', p_copies => 2)$$,
  'PT409', 'executor_not_group_member', 'a volunteer outside the Group refuses the whole call');
select throws_ok($$select count(*) from public.create_completed_tasks(array[pg_temp.u947(2), pg_temp.u947(5)], pg_temp.g947('Dept E #947'),
  'Un BC #947', 'd', p_difficulty => 4, p_rating => 5, p_note => 'Bine', p_copies => 2)$$,
  'PT409', 'executor_role_excluded', 'a BC member among the volunteers refuses the whole call');
reset role;
select is((select count(*) from public.tasks where title in ('Unul din afara #947', 'Un BC #947'))::int, 0,
  'nothing of a refused batch exists');
select is((select count(*) from public.points_ledger as ledger
             join public.tasks as task on task.id = ledger.task_id
            where task.title in ('Unul din afara #947', 'Un BC #947'))::int, 0,
  'and no points were written');

select * from finish();
rollback;
