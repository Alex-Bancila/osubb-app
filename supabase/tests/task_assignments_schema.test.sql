begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(40);

select has_table('public', 'task_assignments',
  'Task Assignment history exists');
select ok(
  (select relrowsecurity from pg_class
    where oid = 'public.task_assignments'::regclass),
  'Task Assignment history enables RLS at birth');

select has_column('public', 'task_assignments', 'id', 'Assignment has an id');
select has_column('public', 'task_assignments', 'task_id', 'Assignment identifies its Task');
select has_column('public', 'task_assignments', 'member_id', 'Assignment identifies its Executor');
select has_column('public', 'task_assignments', 'assigned_at', 'Assignment records when it began');
select has_column('public', 'task_assignments', 'assigned_by', 'Assignment records its actor when known');
select has_column('public', 'task_assignments', 'end_reason', 'Assignment records why it ended');
select has_column('public', 'task_assignments', 'ended_at', 'Assignment records when it ended');
select has_column('public', 'task_assignments', 'end_note', 'Assignment can preserve an ending explanation');
select col_not_null('public', 'task_assignments', 'task_id', 'Task is required');
select col_not_null('public', 'task_assignments', 'member_id', 'Executor is required');
select col_not_null('public', 'task_assignments', 'assigned_at', 'Assignment start is required');
select has_pk('public', 'task_assignments', 'Assignment has a primary key');
select fk_ok('public', 'task_assignments', 'task_id', 'public', 'tasks', 'id',
  'Assignment references its Task');
select fk_ok('public', 'task_assignments', 'member_id', 'public', 'profiles', 'id',
  'Executor references a Profile');
select fk_ok('public', 'task_assignments', 'assigned_by', 'public', 'profiles', 'id',
  'assigning actor references a Profile');
select has_index('public', 'task_assignments',
  'task_assignments_one_active_per_task_uidx',
  'one-active Assignment lookup is indexed');
select has_index('public', 'task_assignments', 'task_assignments_task_history_idx',
  'Task history is indexed chronologically');
select has_index('public', 'task_assignments', 'task_assignments_member_history_idx',
  'Member history is indexed chronologically');
select has_index('public', 'task_assignments', 'task_assignments_assigned_by_idx',
  'assigning actors are indexed for Profile deletion');

insert into auth.users (id, email) values
  ('28900000-0000-0000-0000-000000000001', 'executor-one-289@test.local'),
  ('28900000-0000-0000-0000-000000000002', 'executor-two-289@test.local'),
  ('28900000-0000-0000-0000-000000000003', 'assigner-289@test.local');
insert into public.profiles (id, full_name, email, role) values
  ('28900000-0000-0000-0000-000000000001', 'Executor One', 'executor-one-289@test.local', 'voluntar'),
  ('28900000-0000-0000-0000-000000000002', 'Executor Two', 'executor-two-289@test.local', 'voluntar'),
  ('28900000-0000-0000-0000-000000000003', 'Assigner', 'assigner-289@test.local', 'responsabil');
insert into public.tasks (title, difficulty, group_id)
values ('Assignment history fixture 289', 1, pg_temp.dept_group('edu'));

insert into public.task_assignments (task_id, member_id, assigned_by)
select id, '28900000-0000-0000-0000-000000000001',
       '28900000-0000-0000-0000-000000000003'
  from public.tasks where title = 'Assignment history fixture 289';

select throws_ok(
  $$ insert into public.task_assignments (task_id, member_id)
     select id, '28900000-0000-0000-0000-000000000002'
       from public.tasks where title = 'Assignment history fixture 289' $$,
  '23505', null,
  'a Task rejects a second active Executor');

update public.task_assignments
   set ended_at = now(), end_reason = 'gave_up', end_note = 'Could not continue'
 where task_id = (select id from public.tasks
                   where title = 'Assignment history fixture 289')
   and member_id = '28900000-0000-0000-0000-000000000001';
insert into public.task_assignments (task_id, member_id)
select id, '28900000-0000-0000-0000-000000000002'
  from public.tasks where title = 'Assignment history fixture 289';

select is((select count(*) from public.task_assignments
            where task_id = (select id from public.tasks
                              where title = 'Assignment history fixture 289')),
  2::bigint,
  'historical and active Assignments coexist');
select is((select count(*) from public.task_assignments
            where task_id = (select id from public.tasks
                              where title = 'Assignment history fixture 289')
              and ended_at is null), 1::bigint,
  'exactly one Assignment remains active');
select is((select end_note from public.task_assignments
            where task_id = (select id from public.tasks
                              where title = 'Assignment history fixture 289')
              and member_id = '28900000-0000-0000-0000-000000000001'),
  'Could not continue', 'an ending explanation is preserved');

select throws_ok(
  $$ update public.task_assignments set end_reason = 'replaced'
      where task_id = (select id from public.tasks
                        where title = 'Assignment history fixture 289')
        and member_id = '28900000-0000-0000-0000-000000000002' $$,
  '23514', null, 'an active Assignment cannot have an end reason');
select throws_ok(
  $$ update public.task_assignments set ended_at = now()
      where task_id = (select id from public.tasks
                        where title = 'Assignment history fixture 289')
        and member_id = '28900000-0000-0000-0000-000000000002' $$,
  '23514', null, 'an ended Assignment requires a reason');
select throws_ok(
  $$ update public.task_assignments set ended_at = now(), end_reason = 'unknown'
      where task_id = (select id from public.tasks
                        where title = 'Assignment history fixture 289')
        and member_id = '28900000-0000-0000-0000-000000000002' $$,
  '23514', null, 'an Assignment rejects an unknown end reason');
select throws_ok(
      $$ update public.task_assignments
        set ended_at = assigned_at - interval '1 second', end_reason = 'replaced'
      where task_id = (select id from public.tasks
                        where title = 'Assignment history fixture 289')
        and member_id = '28900000-0000-0000-0000-000000000002' $$,
  '23514', null, 'an Assignment cannot end before it began');
select throws_ok(
      $$ update public.task_assignments
        set ended_at = now(), end_reason = 'gave_up', end_note = '   '
      where task_id = (select id from public.tasks
                        where title = 'Assignment history fixture 289')
        and member_id = '28900000-0000-0000-0000-000000000002' $$,
  '23514', null, 'an ending explanation cannot be blank when provided');

select lives_ok(
      $$ update public.task_assignments
        set ended_at = now(), end_reason = 'legacy_migration'
      where task_id = (select id from public.tasks
                        where title = 'Assignment history fixture 289')
        and member_id = '28900000-0000-0000-0000-000000000002' $$,
  'legacy migration can mark displaced assignee evidence');

select throws_ok(
  $$ delete from public.tasks
      where title = 'Assignment history fixture 289' $$,
  '23503', null, 'Assignment history blocks deletion of its Task');

delete from public.profiles
 where id = '28900000-0000-0000-0000-000000000003';
select is(
  (select assigned_by from public.task_assignments
    where task_id = (select id from public.tasks
                      where title = 'Assignment history fixture 289')
      and member_id = '28900000-0000-0000-0000-000000000001'),
  null::uuid, 'deleting the assigning actor preserves history with a null actor');

delete from public.profiles
 where id = '28900000-0000-0000-0000-000000000001';
select is(
  (select array_agg(member_id order by member_id)
     from public.task_assignments
    where task_id = (select id from public.tasks
                      where title = 'Assignment history fixture 289')),
  array['28900000-0000-0000-0000-000000000002'::uuid],
  'deleting an Executor cascades only that Member history');

-- #319 added task_assignments_read and a SELECT grant; write grants stay
-- absent below (commands only).
select is((select count(*) from pg_policies
  where schemaname = 'public' and tablename = 'task_assignments'), 1::bigint,
  'Task Assignment history carries exactly the #319 read policy');
select is(has_table_privilege('authenticated', 'public.task_assignments', 'SELECT'), true,
  'authenticated holds SELECT on Assignment history now that task_assignments_read exists (#319)');
select is(has_table_privilege('authenticated', 'public.task_assignments', 'INSERT'), false,
  'authenticated cannot insert Assignment history directly');
select is(has_table_privilege('authenticated', 'public.task_assignments', 'UPDATE'), false,
  'authenticated cannot update Assignment history directly');
select is(has_table_privilege('authenticated', 'public.task_assignments', 'DELETE'), false,
  'authenticated cannot delete Assignment history directly');
select is(has_sequence_privilege('authenticated', 'public.task_assignments_id_seq', 'USAGE'), false,
  'authenticated cannot allocate Assignment ids');

select * from finish();
rollback;
