-- create_tasks (spec 2026-10-11, Part B): n identical copies of a Task,
-- Subtask or (n = 1 only) Umbrella in ONE transaction -- all exist or none.
-- The body loops private.create_task_impl, so every rule of create_task holds
-- per copy; this suite pins the count and executor rules, the atomicity, the
-- daily cap counted per copy, and that no lock of its own is taken.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(34);
\ir _group_task_fixtures.psql

create function pg_temp.project() returns bigint language sql stable as $$
  select id from public.groups where name = 'Project #521'
$$;
grant execute on function pg_temp.project() to authenticated;

-- ==================== API surface ====================
select ok(not has_function_privilege('anon',
  'public.create_tasks(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer, integer)', 'execute'),
  'anon cannot execute create_tasks');
select ok(has_function_privilege('authenticated',
  'public.create_tasks(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer, integer)', 'execute'),
  'authenticated executes create_tasks; the gate is inside');
select is((select prosecdef from pg_proc where proname = 'create_tasks'
            and pronamespace = 'public'::regnamespace), false,
  'the wrapper is security invoker');
select is((select prosecdef from pg_proc where proname = 'create_tasks_impl'
            and pronamespace = 'private'::regnamespace), true,
  'the body is security definer');
select ok((select proconfig @> array['search_path=""'] from pg_proc where proname = 'create_tasks_impl'
            and pronamespace = 'private'::regnamespace),
  'the body pins an empty search_path');
select is((select proretset from pg_proc where proname = 'create_tasks'
            and pronamespace = 'public'::regnamespace), true,
  'create_tasks returns a set: the created rows');
select ok(pg_get_functiondef('private.create_tasks_impl(text, text, timestamptz, text, text, uuid[], bigint, bigint, text, bigint, jsonb, integer, integer)'::regprocedure)
          !~* 'for update',
  'create_tasks_impl takes no row lock of its own: the Umbrella lock is create_task_impl''s For No Key Update');

-- ==================== Step 1: malformed before the gate ====================
select pg_temp.test_clear_jwt();
set local role authenticated;
select throws_ok($$select count(*) from public.create_tasks('Zero', null, now() + interval '7 days', 'local', 'public',
  p_group_id => pg_temp.project(), p_copies => 0)$$,
  'PT400', 'invalid_copies', 'a count of zero is malformed for every caller: refused before the gate');
reset role;

select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select throws_ok($$select count(*) from public.create_tasks('Nul', null, now() + interval '7 days', 'local', 'public',
  p_group_id => pg_temp.project(), p_copies => null)$$,
  'PT400', 'invalid_copies', 'a null count is refused');
select throws_ok($$select count(*) from public.create_tasks('Prea multe', null, now() + interval '7 days', 'local', 'public',
  p_group_id => pg_temp.project(), p_copies => 101)$$,
  'PT400', 'too_many_copies', 'a hundred and one copies are too many');
select is((select count(*) from public.create_tasks('Douazeci si unu', null, now() + interval '7 days', 'local', 'public',
  p_group_id => pg_temp.project(), p_copies => 21))::int, 21,
  'twenty-one copies are accepted since the limit became 100 (2026-10-11)');
select throws_ok($$select count(*) from public.create_tasks('Umbrela dubla', null, null, null, null,
  p_kind => 'umbrella', p_group_id => pg_temp.project(), p_copies => 2)$$,
  'PT400', 'invalid_copies', 'an Umbrella has no copies');
select throws_ok($$select count(*) from public.create_tasks('Public cu executori', null, now() + interval '7 days', 'local', 'public',
  p_executor_ids => array[pg_temp.g521_uid(3)], p_group_id => pg_temp.project(), p_copies => 1)$$,
  'PT400', 'invalid_executors', 'a public Task takes no executors');
select throws_ok($$select count(*) from public.create_tasks('Doi din trei', null, now() + interval '7 days', 'local', 'direct',
  p_executor_ids => array[pg_temp.g521_uid(3), pg_temp.g521_uid(4)], p_group_id => pg_temp.project(), p_copies => 3)$$,
  'PT400', 'invalid_executors', 'a direct Task takes exactly one executor entry per copy');
reset role;
select is((select count(*) from public.tasks where title in ('Zero', 'Nul', 'Prea multe', 'Umbrela dubla', 'Public cu executori', 'Doi din trei'))::int, 0,
  'a refused call creates nothing');

-- ==================== Three public copies ====================
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select is((select count(*) from public.create_tasks('Trei publice #47', 'd', now() + interval '7 days', 'local', 'public',
  p_group_id => pg_temp.project(), p_copies => 3))::int, 3,
  'three public copies come back as three rows');
reset role;
select is((select count(*) from public.tasks where title = 'Trei publice #47'
            and status = 'todo' and assignment_mode = 'public' and queue_opened_at is not null
            and group_id = pg_temp.project())::int, 3,
  'three todo Tasks with open Candidate Queues in the Group');
select is((select count(*) from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Trei publice #47' and activity.kind = 'created')::int, 3,
  'one created activity row per copy');
select is((select count(*) from public.notifications as notification
             join public.tasks as task on task.id = notification.task_id
            where task.title = 'Trei publice #47')::int, 0,
  'a public copy notifies nobody, like a public Task');

-- ==================== Three direct copies, three Executors ====================
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select is((select count(*) from public.create_tasks('Trei directe #47', 'd', now() + interval '7 days', 'local', 'direct',
  p_executor_ids => array[pg_temp.g521_uid(3), pg_temp.g521_uid(4), pg_temp.g521_uid(5)],
  p_group_id => pg_temp.project(), p_copies => 3))::int, 3,
  'three direct copies come back as three rows');
reset role;
select set_eq(
  $$ select assignment.member_id from public.task_assignments as assignment
       join public.tasks as task on task.id = assignment.task_id
      where task.title = 'Trei directe #47' and assignment.ended_at is null $$,
  $$ values (pg_temp.g521_uid(3)), (pg_temp.g521_uid(4)), (pg_temp.g521_uid(5)) $$,
  'each copy has its own Executor, in order');
select is((select count(*) from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Trei directe #47')::int, 6,
  'two activity rows per direct copy: created and executor_assigned');
select set_eq(
  $$ select notification.member_id from public.notifications as notification
       join public.tasks as task on task.id = notification.task_id
      where task.title = 'Trei directe #47' $$,
  $$ values (pg_temp.g521_uid(3)), (pg_temp.g521_uid(4)), (pg_temp.g521_uid(5)) $$,
  'each Executor is told once: "Task nou"');

-- A null entry leaves that copy unassigned, as a direct Task may start today.
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select is((select count(*) from public.create_tasks('Unul liber #47', 'd', now() + interval '7 days', 'local', 'direct',
  p_executor_ids => array[pg_temp.g521_uid(3), null],
  p_group_id => pg_temp.project(), p_copies => 2))::int, 2,
  'two direct copies, one of them unassigned');
reset role;
select is((select count(*) from public.task_assignments as assignment
             join public.tasks as task on task.id = assignment.task_id
            where task.title = 'Unul liber #47')::int, 1,
  'only the named copy has an Executor');

-- ==================== Subtasks under one Umbrella ====================
select pg_temp.g521_task('umbrela47', 'project', null, 'todo', 'direct', 'umbrella');
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select is((select count(*) from public.create_tasks('Trei subtaskuri #47', 'd', now() + interval '7 days', 'local', 'public',
  p_parent_task_id => (select id from g521_tasks where name = 'umbrela47'), p_copies => 3))::int, 3,
  'three Subtasks under one Umbrella');
reset role;
select is((select count(*) from public.tasks where title = 'Trei subtaskuri #47'
            and parent_task_id = (select id from g521_tasks where name = 'umbrela47')
            and group_id = pg_temp.project())::int, 3,
  'each Subtask names the Umbrella and inherits its Group');

-- ==================== Atomicity ====================
-- Rolled-back settings fixture: the Project now asks for level 3, which the
-- voluntari (3, 4, 5) lack and the vot member (12) has.
update public.groups set min_level = 3, application_level = 3 where id = pg_temp.project();
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select throws_ok($$select count(*) from public.create_tasks('Al treilea cade #47', 'd', now() + interval '7 days', 'local', 'direct',
  p_executor_ids => array[pg_temp.g521_uid(12), pg_temp.g521_uid(12), pg_temp.g521_uid(5)],
  p_group_id => pg_temp.project(), p_copies => 3)$$,
  'PT400', 'invalid_executor', 'one Executor below the Minimum Level refuses the whole call');
select throws_ok($$select count(*) from public.create_tasks('Necunoscut #47', 'd', now() + interval '7 days', 'local', 'direct',
  p_executor_ids => array[pg_temp.g521_uid(12), '00000000-0000-0000-0000-00000000dead'::uuid],
  p_group_id => pg_temp.project(), p_copies => 2)$$,
  'PT400', 'invalid_executor', 'an id that is no profile at all refuses the whole call');
reset role;
select is((select count(*) from public.tasks where title in ('Al treilea cade #47', 'Necunoscut #47'))::int, 0,
  'nothing of a refused batch exists: no Task');
select is((select count(*) from public.notifications where title in ('Task nou: Al treilea cade #47', 'Task nou: Necunoscut #47'))::int, 0,
  'and no notification');
update public.groups set min_level = 0, application_level = 0 where id = pg_temp.project();

-- ==================== The daily cap, counted per copy ====================
insert into public.task_activity (task_id, kind, actor_id)
select (select id from g521_tasks where name = 'umbrela47'), 'created', pg_temp.g521_uid(1)
  from generate_series(1, 99 - (select count(*)::int from public.task_activity
                                  where actor_id = pg_temp.g521_uid(1) and kind = 'created'));
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select throws_ok($$select count(*) from public.create_tasks('Plafon 101 #47', 'd', now() + interval '7 days', 'local', 'public',
  p_group_id => pg_temp.project(), p_copies => 2)$$,
  'PT409', 'rate_limited', 'two copies with one slot left: the second hits the cap and the first rolls back too');
select is((select count(*) from public.create_tasks('Plafon 100 #47', 'd', now() + interval '7 days', 'local', 'public',
  p_group_id => pg_temp.project(), p_copies => 1))::int, 1,
  'one copy still fits: the hundredth creation of the day');
reset role;
select is((select count(*) from public.tasks where title = 'Plafon 101 #47')::int, 0,
  'the refused pair left nothing behind');

select * from finish();
rollback;
