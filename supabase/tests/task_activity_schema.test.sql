begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(32);

select has_table('public', 'task_activity', 'Task activity history exists');
select ok(
  (select relrowsecurity from pg_class
    where oid = 'public.task_activity'::regclass),
  'Task activity history enables RLS at birth');

select columns_are(
  'public', 'task_activity',
  array['id', 'task_id', 'kind', 'actor_id', 'assignment_id', 'from_status',
        'to_status', 'note', 'details', 'occurred_at', 'created_at'],
  'Task activity exposes exactly the requested fields');
select has_pk('public', 'task_activity', 'Task activity has a primary key');
select col_type_is('public', 'task_activity', 'id', 'bigint', 'activity id is bigint');
select col_not_null('public', 'task_activity', 'task_id', 'Task is required');
select fk_ok('public', 'task_activity', 'task_id', 'public', 'tasks', 'id',
  'activity references its Task');
select fk_ok('public', 'task_activity', 'assignment_id', 'public', 'task_assignments', 'id',
  'activity can reference an Assignment');
select fk_ok('public', 'task_activity', 'actor_id', 'public', 'profiles', 'id',
  'activity actor references a Profile when known');
select col_type_is('public', 'task_activity', 'from_status', 'task_status',
  'from_status is a task_status');
select col_type_is('public', 'task_activity', 'to_status', 'task_status',
  'to_status is a task_status');
select col_not_null('public', 'task_activity', 'details', 'details is required');
select col_default_is('public', 'task_activity', 'details', '{}',
  'details defaults to an empty object');
select col_not_null('public', 'task_activity', 'occurred_at', 'occurred_at is required');
select col_has_default('public', 'task_activity', 'occurred_at', 'occurred_at is server-written');
select col_not_null('public', 'task_activity', 'created_at', 'created_at is required');
select col_has_default('public', 'task_activity', 'created_at', 'created_at is server-written');
select has_index('public', 'task_activity', 'task_activity_task_timeline_idx',
  'timeline lookup is indexed');
select has_index('public', 'task_activity', 'task_activity_actor_idx',
  'actor lookup is indexed');

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('29200000-0000-0000-0000-000000000001', 'actor-292@test.local');
insert into public.profiles (id, full_name, email, role) values
  ('29200000-0000-0000-0000-000000000001', 'Activity Actor', 'actor-292@test.local', 'voluntar');
insert into public.tasks (title, difficulty, group_id)
values ('Activity history fixture 292', 1, pg_temp.dept_group('edu'));

-- ==================== kind check ====================
select lives_ok(
  $$ insert into public.task_activity (task_id, kind, actor_id, to_status)
     select id, 'created', '29200000-0000-0000-0000-000000000001', 'todo'
       from public.tasks where title = 'Activity history fixture 292' $$,
  'an accepted kind is recorded');

select throws_ok(
  $$ insert into public.task_activity (task_id, kind, actor_id)
     select id, 'flew_away', '29200000-0000-0000-0000-000000000001'
       from public.tasks where title = 'Activity history fixture 292' $$,
  '23514', null, 'an unknown kind is rejected');

-- ==================== timeline order ====================
-- A second row sharing the first row's exact occurred_at proves the index
-- and the timeline ordering tie-break on id, not on insertion order alone.
insert into public.task_activity (task_id, kind, actor_id, occurred_at)
select task_id, 'content_updated', '29200000-0000-0000-0000-000000000001', occurred_at
  from public.task_activity
 where kind = 'created'
   and task_id = (select id from public.tasks
                   where title = 'Activity history fixture 292');

select is(
  (select array_agg(kind order by occurred_at, id)
     from public.task_activity
    where task_id = (select id from public.tasks
                      where title = 'Activity history fixture 292')),
  array['created', 'content_updated'],
  'two rows sharing occurred_at still order deterministically by id');

-- ==================== immutability, proven against the trigger ====================
select throws_ok(
  $$ update public.task_activity set note = 'rewritten'
      where kind = 'created'
        and task_id = (select id from public.tasks
                        where title = 'Activity history fixture 292') $$,
  '23514', 'task_activity_immutable',
  'postgres cannot rewrite an activity row (the trigger, not a grant, blocks it)');
select throws_ok(
  $$ delete from public.task_activity
      where kind = 'created'
        and task_id = (select id from public.tasks
                        where title = 'Activity history fixture 292') $$,
  '23514', 'task_activity_immutable',
  'postgres cannot delete an activity row (the trigger, not a grant, blocks it)');

-- ==================== grants: commands, not clients, write this table ====================
-- #319 added task_activity_read and a SELECT grant; write grants stay absent
-- (no command writes this table yet, #327-#345).
select is(has_table_privilege('authenticated', 'public.task_activity', 'SELECT'), true,
  'authenticated holds SELECT on activity history now that task_activity_read exists (#319)');
select is(has_table_privilege('authenticated', 'public.task_activity', 'INSERT'), false,
  'authenticated cannot insert activity history directly');
select is(has_table_privilege('authenticated', 'public.task_activity', 'UPDATE'), false,
  'authenticated cannot update activity history directly');
select is(has_table_privilege('authenticated', 'public.task_activity', 'DELETE'), false,
  'authenticated cannot delete activity history directly');
select is(has_table_privilege('authenticated', 'public.task_activity', 'TRUNCATE'), false,
  'authenticated cannot truncate activity history');
select is(has_table_privilege('service_role', 'public.task_activity', 'TRUNCATE'), false,
  'service_role cannot truncate activity history either — no server job needs it');
select is(has_table_privilege('service_role', 'public.task_activity', 'UPDATE'), false,
  'service_role cannot update activity history — its grant is narrowed to select, insert');
select is(has_table_privilege('service_role', 'public.task_activity', 'DELETE'), false,
  'service_role cannot delete activity history — its grant is narrowed to select, insert');

select * from finish();
rollback;
