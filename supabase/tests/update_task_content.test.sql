-- #328: public.update_task_content — the only way a Task's title,
-- description, deadline or Campaign is edited after creation.
--
-- Parameters are the new full values, never patches (an audit trail cannot
-- tolerate "null means keep"): p_title null/blank is title_required, a null
-- p_deadline is deadline_required for an ordinary Task, and p_description /
-- p_campaign_id null mean the field is cleared. The activity row records
-- only the fields that actually changed (details.changed / before / after);
-- a call that changes nothing at all is PT409 nothing_to_update rather than
-- a silent success. An Umbrella may have its title/description/deadline
-- edited but never a Campaign (PT400 umbrella_has_no_campaign).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(80);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('32800000-0000-0000-0000-000000000001', 'manager.328@test.local'),
  ('32800000-0000-0000-0000-000000000002', 'executor.328@test.local'),
  ('32800000-0000-0000-0000-000000000003', 'inactive.bc.328@test.local'),
  ('32800000-0000-0000-0000-000000000004', 'claimless.328@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('32800000-0000-0000-0000-000000000001', 'Manager 328', 'manager.328@test.local', 'bce', 'activ'),
  ('32800000-0000-0000-0000-000000000002', 'Executant 328', 'executor.328@test.local', 'voluntar', 'activ'),
  ('32800000-0000-0000-0000-000000000003', 'BC Inactiv 328', 'inactive.bc.328@test.local', 'bc', 'inactiv'),
  ('32800000-0000-0000-0000-000000000004', 'Fara Claimuri 328', 'claimless.328@test.local', 'voluntar', 'activ');

insert into public.member_departments (member_id, dept_id) values
  ('32800000-0000-0000-0000-000000000001', 'edu');
-- #586: materialize this suite's legacy setup as rolled-back Group fixtures.
select pg_temp.materialize_legacy_groups();


insert into public.campaigns (group_id, name, is_active, created_by) values
  (pg_temp.dept_group('edu'), 'Campanie #328', true, '32800000-0000-0000-0000-000000000001'),
  (pg_temp.dept_group('pr'), 'Campanie PR #328', true, '32800000-0000-0000-0000-000000000001'),
  (pg_temp.dept_group('edu'), 'Campanie inactiva #328', false, '32800000-0000-0000-0000-000000000001');

insert into public.tasks (title, description, deadline, group_id, status, created_by) values
  ('Authority edit #328', 'Descriere autoritate', '2027-01-05 09:00:00+00', pg_temp.dept_group('edu'), 'todo', '32800000-0000-0000-0000-000000000001'),
  ('Executor denied #328', 'Descriere O', '2027-01-24 09:00:00+00', pg_temp.dept_group('edu'), 'todo', '32800000-0000-0000-0000-000000000001'),
  ('Bad input task #328', 'Descriere input', '2027-01-06 09:00:00+00', pg_temp.dept_group('edu'), 'todo', '32800000-0000-0000-0000-000000000001'),
  ('Unchanged task #328', 'Descriere I', '2027-01-18 09:00:00+00', pg_temp.dept_group('edu'), 'todo', '32800000-0000-0000-0000-000000000001'),
  ('Field title only #328', 'Descriere neschimbata A', '2027-01-10 09:00:00+00', pg_temp.dept_group('edu'), 'todo', '32800000-0000-0000-0000-000000000001'),
  ('Field description only #328', 'Descriere veche B', '2027-01-11 09:00:00+00', pg_temp.dept_group('edu'), 'todo', '32800000-0000-0000-0000-000000000001'),
  ('Field deadline only #328', 'Descriere neschimbata C', '2027-01-12 09:00:00+00', pg_temp.dept_group('edu'), 'todo', '32800000-0000-0000-0000-000000000001'),
  ('Field campaign only #328', 'Descriere neschimbata D', '2027-01-13 09:00:00+00', pg_temp.dept_group('edu'), 'todo', '32800000-0000-0000-0000-000000000001'),
  ('Field all together #328', 'Descriere veche E', '2027-01-14 09:00:00+00', pg_temp.dept_group('edu'), 'todo', '32800000-0000-0000-0000-000000000001'),
  ('Clear description #328', 'De sters #328', '2027-01-15 09:00:00+00', pg_temp.dept_group('edu'), 'todo', '32800000-0000-0000-0000-000000000001'),
  ('Wrong dept campaign #328', 'Descriere J', '2027-01-19 09:00:00+00', pg_temp.dept_group('edu'), 'todo', '32800000-0000-0000-0000-000000000001'),
  ('Inactive campaign task #328', 'Descriere K', '2027-01-20 09:00:00+00', pg_temp.dept_group('edu'), 'todo', '32800000-0000-0000-0000-000000000001'),
  ('Executor notified #328', 'Descriere L', '2027-01-21 09:00:00+00', pg_temp.dept_group('edu'), 'todo', '32800000-0000-0000-0000-000000000001'),
  ('Self executor #328', 'Descriere M', '2027-01-22 09:00:00+00', pg_temp.dept_group('edu'), 'todo', '32800000-0000-0000-0000-000000000001'),
  ('No executor #328', 'Descriere N', '2027-01-23 09:00:00+00', pg_temp.dept_group('edu'), 'todo', '32800000-0000-0000-0000-000000000001'),
  ('Gate denial task #328', 'Descriere gate', '2027-01-26 09:00:00+00', pg_temp.dept_group('edu'), 'todo', '32800000-0000-0000-0000-000000000001'),
  ('Direct write task #328', 'Descriere P', '2027-01-25 09:00:00+00', pg_temp.dept_group('edu'), 'todo', '32800000-0000-0000-0000-000000000001');

insert into public.tasks (title, description, deadline, group_id, campaign_id, status, created_by) values
  ('Clear campaign #328', 'Descriere G', '2027-01-16 09:00:00+00', pg_temp.dept_group('edu'),
   (select id from public.campaigns where group_id = pg_temp.dept_group('edu') and name = 'Campanie #328'),
   'todo', '32800000-0000-0000-0000-000000000001');

insert into public.tasks
  (title, description, deadline, group_id, difficulty, rating, status, completed_at, created_by)
values
  ('Terminal task #328', 'Descriere H', '2027-01-17 09:00:00+00', pg_temp.dept_group('edu'), 3, 4, 'completed', now(),
   '32800000-0000-0000-0000-000000000001');

insert into public.tasks
  (title, group_id, kind, audience, assignment_mode, difficulty, rating, description, status, created_by)
values
  ('Umbrella #328', pg_temp.dept_group('edu'), 'umbrella', null, null, null, null, 'Umbrella desc', 'todo',
   '32800000-0000-0000-0000-000000000001');

create temp table f328 as
select
  (select id from public.campaigns where group_id = pg_temp.dept_group('edu') and name = 'Campanie #328') as edu_campaign_id,
  (select id from public.campaigns where group_id = pg_temp.dept_group('pr') and name = 'Campanie PR #328') as pr_campaign_id,
  (select id from public.campaigns where group_id = pg_temp.dept_group('edu') and name = 'Campanie inactiva #328') as inactive_campaign_id,
  9223372036854775807::bigint as missing_id,
  (select id from public.tasks where title = 'Gate denial task #328') as gate_denial_task_id;
grant select on f328 to authenticated, anon;

insert into public.task_assignments (task_id, member_id, assigned_by)
select task.id, '32800000-0000-0000-0000-000000000002', '32800000-0000-0000-0000-000000000001'
  from public.tasks as task where task.title = 'Executor notified #328';

insert into public.task_assignments (task_id, member_id, assigned_by)
select task.id, '32800000-0000-0000-0000-000000000001', '32800000-0000-0000-0000-000000000001'
  from public.tasks as task where task.title = 'Self executor #328';

insert into public.task_assignments (task_id, member_id, assigned_by)
select task.id, '32800000-0000-0000-0000-000000000002', '32800000-0000-0000-0000-000000000001'
  from public.tasks as task where task.title = 'Executor denied #328';

-- ==================== 1. API shape and privileges ====================

select has_function('public', 'update_task_content',
  array['bigint', 'text', 'text', 'timestamptz', 'bigint'],
  'public.update_task_content exists with the pinned five-parameter signature');

select is(pg_get_function_identity_arguments(
    'public.update_task_content(bigint,text,text,timestamptz,bigint)'::regprocedure),
  'p_task_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint',
  'update_task_content exposes no actor parameter — the actor is always auth.uid()');

select is(pg_get_function_result(
    'public.update_task_content(bigint,text,text,timestamptz,bigint)'::regprocedure),
  'tasks', 'update_task_content returns the updated Task row');

select ok(not (select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public' and procedure.proname = 'update_task_content'),
  'the public command is a security invoker wrapper');

select ok((select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private' and procedure.proname = 'update_task_content_impl'),
  'private.update_task_content_impl runs as owner (security definer)');

select ok(coalesce((
    select bool_and('search_path=""' = any(procedure.proconfig))
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private' and procedure.proname = 'update_task_content_impl'
  ), false), 'update_task_content_impl pins an empty search_path');

select ok(has_function_privilege('authenticated',
  'public.update_task_content(bigint,text,text,timestamptz,bigint)'::regprocedure,
  'execute'), 'authenticated can execute public.update_task_content');

select ok(not has_function_privilege('anon',
  'public.update_task_content(bigint,text,text,timestamptz,bigint)'::regprocedure,
  'execute'), 'anon cannot execute public.update_task_content');

select ok(has_function_privilege('authenticated',
  'private.update_task_content_impl(bigint,text,text,timestamptz,bigint)'::regprocedure,
  'execute'), 'authenticated can execute private.update_task_content_impl');

-- ==================== 2. Authority ====================

select pg_temp.test_login('32800000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.update_task_content(%s, 'Titlu autoritate #328',
  'Descriere autoritate', '2027-01-05 09:00:00+00'::timestamptz, null) $$,
  (select id from public.tasks where title = 'Authority edit #328')),
  'the local BCE edits a Task in their own Department');
reset role;

select pg_temp.test_login('32800000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.update_task_content(%s, 'Denied edit #328', 'Descriere O',
  '2027-01-24 09:00:00+00'::timestamptz, null) $$,
  (select id from public.tasks where title = 'Executor denied #328')),
  '42501', 'task_manage_forbidden',
  'the Task''s own Executor cannot edit its content — being the Executor is not managing authority');
reset role;
select is((select count(*) from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Executor denied #328'), 0::bigint,
  'a denied edit writes no activity row');
select is((select title from public.tasks where id =
             (select id from public.tasks where title = 'Executor denied #328')),
  'Executor denied #328', 'a denied edit writes no change to the Task');

select pg_temp.test_login('32800000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.update_task_content(%s, 'Unreachable #328', 'd',
  now() + interval '7 days', null) $$,
  (select missing_id from f328)), 'PT404', 'task_not_found',
  'an unknown or invisible Task is not found, not forbidden');
reset role;

-- ==================== 3. Input validation ====================

select pg_temp.test_login('32800000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.update_task_content(%s, '   ', 'd',
  now() + interval '7 days', null) $$,
  (select id from public.tasks where title = 'Bad input task #328')),
  'PT400', 'title_required', 'a blank title is rejected');
select throws_ok(format($$ select public.update_task_content(%s, null, 'd',
  now() + interval '7 days', null) $$,
  (select id from public.tasks where title = 'Bad input task #328')),
  'PT400', 'title_required', 'a null title is rejected');
select throws_ok(format($$ select public.update_task_content(%s, 'No deadline #328', 'd', null, null) $$,
  (select id from public.tasks where title = 'Bad input task #328')),
  'PT400', 'deadline_required', 'an ordinary Task requires a deadline');
select throws_ok(format($$ select public.update_task_content(%s, 'Umbrela cu campanie #328', 'd', null, %s) $$,
  (select id from public.tasks where title = 'Umbrella #328'),
  (select edu_campaign_id from f328)),
  'PT400', 'umbrella_has_no_campaign', 'an Umbrella can never carry a Campaign');
select lives_ok(format($$ select public.update_task_content(%s, 'Umbrela editata #328',
  'Descriere umbrela noua', null, null) $$,
  (select id from public.tasks where title = 'Umbrella #328')),
  'an Umbrella''s title, description and (null) deadline may still be edited');
reset role;
select is((select count(*) from public.tasks where title = 'Umbrela cu campanie #328'), 0::bigint,
  'the denied Umbrella Campaign edit wrote no change');
select is((select format('%s|%s', task.title, task.description)
             from public.tasks as task where task.title = 'Umbrela editata #328'),
  'Umbrela editata #328|Descriere umbrela noua',
  'the Umbrella''s title and description were updated');

-- ==================== 4. State preconditions ====================

select pg_temp.test_login('32800000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.update_task_content(%s, 'Terminat #328', 'Descriere H',
  '2027-01-17 09:00:00+00'::timestamptz, null) $$,
  (select id from public.tasks where title = 'Terminal task #328')),
  'PT409', 'task_terminal', 'a terminal Task can no longer have its content edited');
select is((select count(*) from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Terminal task #328'), 0::bigint,
  'the denied terminal-Task edit wrote no activity row');

select throws_ok(format($$ select public.update_task_content(%s, %L, %L, %L, %L) $$,
  (select id from public.tasks where title = 'Unchanged task #328'),
  (select title from public.tasks where title = 'Unchanged task #328'),
  (select description from public.tasks where title = 'Unchanged task #328'),
  (select deadline from public.tasks where title = 'Unchanged task #328'),
  (select campaign_id from public.tasks where title = 'Unchanged task #328')),
  'PT409', 'nothing_to_update', 'a call that changes nothing at all is rejected, not a silent success');
select is((select count(*) from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Unchanged task #328'), 0::bigint,
  'an unchanged call writes no activity row');
reset role;

-- ==================== 5. Field-level audit ====================

select pg_temp.test_login('32800000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));

-- ---- title alone ----
select lives_ok(format($$ select public.update_task_content(%s, 'Titlu nou #328',
  'Descriere neschimbata A', '2027-01-10 09:00:00+00'::timestamptz, null) $$,
  (select id from public.tasks where title = 'Field title only #328')),
  'the manager edits the title alone');
select is((select format('%s|%s|%s|%s|%s|%s', activity.kind, activity.actor_id,
                         (activity.assignment_id is null)::text,
                         (activity.from_status is null)::text, (activity.to_status is null)::text,
                         (activity.note is null)::text)
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Titlu nou #328' and activity.kind = 'content_updated'),
  'content_updated|32800000-0000-0000-0000-000000000001|true|true|true|true',
  'the content_updated activity row names the actor, carries no assignment_id or status change, and no note');
select is((select activity.details -> 'changed'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Titlu nou #328' and activity.kind = 'content_updated'),
  to_jsonb(array['title']), 'details.changed lists exactly the title field');
select is((select activity.details -> 'before'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Titlu nou #328' and activity.kind = 'content_updated'),
  jsonb_build_object('title', 'Field title only #328'), 'details.before holds only the old title');
select is((select activity.details -> 'after'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Titlu nou #328' and activity.kind = 'content_updated'),
  jsonb_build_object('title', 'Titlu nou #328'), 'details.after holds only the new title');

-- ---- description alone ----
select lives_ok(format($$ select public.update_task_content(%s, 'Field description only #328',
  'Descriere noua B', '2027-01-11 09:00:00+00'::timestamptz, null) $$,
  (select id from public.tasks where title = 'Field description only #328')),
  'the manager edits the description alone');
select is((select activity.details -> 'changed'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Field description only #328' and activity.kind = 'content_updated'),
  to_jsonb(array['description']), 'details.changed lists exactly the description field');
select is((select activity.details -> 'before'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Field description only #328' and activity.kind = 'content_updated'),
  jsonb_build_object('description', 'Descriere veche B'), 'details.before holds only the old description');
select is((select activity.details -> 'after'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Field description only #328' and activity.kind = 'content_updated'),
  jsonb_build_object('description', 'Descriere noua B'), 'details.after holds only the new description');

-- ---- deadline alone ----
select lives_ok(format($$ select public.update_task_content(%s, 'Field deadline only #328',
  'Descriere neschimbata C', '2027-02-12 09:00:00+00'::timestamptz, null) $$,
  (select id from public.tasks where title = 'Field deadline only #328')),
  'the manager edits the deadline alone');
select is((select activity.details -> 'changed'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Field deadline only #328' and activity.kind = 'content_updated'),
  to_jsonb(array['deadline']), 'details.changed lists exactly the deadline field');
select is((select activity.details -> 'before'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Field deadline only #328' and activity.kind = 'content_updated'),
  jsonb_build_object('deadline', '2027-01-12 09:00:00+00'::timestamptz), 'details.before holds only the old deadline');
select is((select activity.details -> 'after'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Field deadline only #328' and activity.kind = 'content_updated'),
  jsonb_build_object('deadline', '2027-02-12 09:00:00+00'::timestamptz), 'details.after holds only the new deadline');

-- ---- campaign alone ----
select lives_ok(format($$ select public.update_task_content(%s, 'Field campaign only #328',
  'Descriere neschimbata D', '2027-01-13 09:00:00+00'::timestamptz, %s) $$,
  (select id from public.tasks where title = 'Field campaign only #328'),
  (select edu_campaign_id from f328)),
  'the manager attaches a Campaign alone');
select is((select activity.details -> 'changed'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Field campaign only #328' and activity.kind = 'content_updated'),
  to_jsonb(array['campaign_id']), 'details.changed lists exactly the campaign_id field');
select is((select activity.details -> 'before'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Field campaign only #328' and activity.kind = 'content_updated'),
  jsonb_build_object('campaign_id', null::bigint), 'details.before holds the null campaign_id');
select is((select activity.details -> 'after'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Field campaign only #328' and activity.kind = 'content_updated'),
  (select jsonb_build_object('campaign_id', edu_campaign_id) from f328),
  'details.after holds the newly attached campaign_id');

-- ---- all four together ----
select lives_ok(format($$ select public.update_task_content(%s, 'Titlu nou E #328',
  'Descriere noua E', '2027-03-14 09:00:00+00'::timestamptz, %s) $$,
  (select id from public.tasks where title = 'Field all together #328'),
  (select edu_campaign_id from f328)),
  'the manager edits all four fields together');
select is((select activity.details -> 'changed'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Titlu nou E #328' and activity.kind = 'content_updated'),
  to_jsonb(array['title', 'description', 'deadline', 'campaign_id']),
  'details.changed lists all four changed fields, in mutation order');
select is((select activity.details -> 'before'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Titlu nou E #328' and activity.kind = 'content_updated'),
  jsonb_build_object('title', 'Field all together #328', 'description', 'Descriere veche E',
    'deadline', '2027-01-14 09:00:00+00'::timestamptz, 'campaign_id', null::bigint),
  'details.before holds the four old values');
select is((select activity.details -> 'after'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Titlu nou E #328' and activity.kind = 'content_updated'),
  (select jsonb_build_object('title', 'Titlu nou E #328', 'description', 'Descriere noua E',
    'deadline', '2027-03-14 09:00:00+00'::timestamptz, 'campaign_id', edu_campaign_id) from f328),
  'details.after holds the four new values');

-- ---- clear description ----
select lives_ok(format($$ select public.update_task_content(%s, 'Clear description #328',
  null, '2027-01-15 09:00:00+00'::timestamptz, null) $$,
  (select id from public.tasks where title = 'Clear description #328')),
  'the manager clears the description with an explicit null');
select is((select activity.details -> 'changed'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Clear description #328' and activity.kind = 'content_updated'),
  to_jsonb(array['description']), 'clearing the description is the only changed field');
select is((select activity.details -> 'before'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Clear description #328' and activity.kind = 'content_updated'),
  jsonb_build_object('description', 'De sters #328'), 'details.before holds the description that was cleared');
select is((select activity.details -> 'after'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Clear description #328' and activity.kind = 'content_updated'),
  jsonb_build_object('description', null::text), 'details.after holds an explicit null for the cleared description');
select is((select description from public.tasks where title = 'Clear description #328'), null,
  'the Task''s description column is now null');

-- ---- clear campaign ----
select lives_ok(format($$ select public.update_task_content(%s, 'Clear campaign #328',
  'Descriere G', '2027-01-16 09:00:00+00'::timestamptz, null) $$,
  (select id from public.tasks where title = 'Clear campaign #328')),
  'the manager clears the Campaign with an explicit null');
select is((select activity.details -> 'changed'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Clear campaign #328' and activity.kind = 'content_updated'),
  to_jsonb(array['campaign_id']), 'clearing the Campaign is the only changed field');
select is((select activity.details -> 'before'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Clear campaign #328' and activity.kind = 'content_updated'),
  (select jsonb_build_object('campaign_id', edu_campaign_id) from f328),
  'details.before holds the campaign_id that was cleared');
select is((select activity.details -> 'after'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Clear campaign #328' and activity.kind = 'content_updated'),
  jsonb_build_object('campaign_id', null::bigint), 'details.after holds an explicit null campaign_id');
select is((select campaign_id from public.tasks where title = 'Clear campaign #328'), null,
  'the Task''s campaign_id column is now null');
reset role;

-- ==================== 6. Campaign validation ====================

select pg_temp.test_login('32800000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.update_task_content(%s, 'Wrong dept campaign #328',
  'Descriere J', '2027-01-19 09:00:00+00'::timestamptz, %s) $$,
  (select id from public.tasks where title = 'Wrong dept campaign #328'),
  (select pr_campaign_id from f328)),
  'PT400', 'invalid_campaign',
  'a Campaign from another Department is mapped from the #314 trigger''s 23514 to PT400');
select throws_ok(format($$ select public.update_task_content(%s, 'Inactive campaign task #328',
  'Descriere K', '2027-01-20 09:00:00+00'::timestamptz, %s) $$,
  (select id from public.tasks where title = 'Inactive campaign task #328'),
  (select inactive_campaign_id from f328)),
  'PT400', 'invalid_campaign', 'a deactivated Campaign cannot be attached to an existing Task');
reset role;
select is((select campaign_id from public.tasks where title = 'Wrong dept campaign #328'), null,
  'the denied cross-Department Campaign attach wrote no change');
select is((select campaign_id from public.tasks where title = 'Inactive campaign task #328'), null,
  'the denied inactive-Campaign attach wrote no change');

-- ==================== 7. Notifications ====================

select pg_temp.test_login('32800000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.update_task_content(%s, 'Executor notificat #328',
  'Descriere L', '2027-01-21 09:00:00+00'::timestamptz, null) $$,
  (select id from public.tasks where title = 'Executor notified #328')),
  'the manager edits a Task that has an active Executor');
select lives_ok(format($$ select public.update_task_content(%s, 'Self executor editat #328',
  'Descriere M', '2027-01-22 09:00:00+00'::timestamptz, null) $$,
  (select id from public.tasks where title = 'Self executor #328')),
  'the manager edits a Task where they are also the active Executor');
select lives_ok(format($$ select public.update_task_content(%s, 'No executor editat #328',
  'Descriere N', '2027-01-23 09:00:00+00'::timestamptz, null) $$,
  (select id from public.tasks where title = 'No executor #328')),
  'the manager edits a Task with no active Executor');
reset role;

select set_eq(
  $$ select notification.member_id from public.notifications as notification
       join public.tasks as task on task.id = notification.task_id
      where task.title = 'Executor notificat #328' $$,
  $$ values ('32800000-0000-0000-0000-000000000002'::uuid) $$,
  'only the active Executor is notified of a content edit — never the manager who made it');
select is((select format('%s|%s', notification.title, notification.body)
             from public.notifications as notification
             join public.tasks as task on task.id = notification.task_id
            where task.title = 'Executor notificat #328'),
  'Task actualizat: Executor notificat #328|Modificat: title.',
  'the Executor notification uses the pinned Romanian title and names the changed field');
select is((select count(*) from public.notifications as notification
             join public.tasks as task on task.id = notification.task_id
            where task.title = 'Self executor editat #328'), 0::bigint,
  'a manager editing their own Assignment notifies nobody — notify() drops the actor');
select is((select count(*) from public.notifications as notification
             join public.tasks as task on task.id = notification.task_id
            where task.title = 'No executor editat #328'), 0::bigint,
  'a Task with no active Executor gets no notification at all');

-- ==================== 8. Gate denials ====================

select pg_temp.test_login('32800000-0000-0000-0000-000000000004',
  jsonb_build_object('provider', 'email'));
select throws_ok(format($$ select public.update_task_content(%s, 'Claimless edit #328', 'd',
  now() + interval '7 days', null) $$,
  (select gate_denial_task_id from f328)),
  '42501', 'task_command_forbidden', 'a real uid without organisation claims is denied by the gate');
reset role;

select pg_temp.test_login('32800000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.update_task_content(%s, 'Deactivated edit #328', 'd',
  now() + interval '7 days', null) $$,
  (select gate_denial_task_id from f328)),
  '42501', 'task_command_forbidden',
  'a deactivated BC holding a still-valid level-6 token is denied by the gate');
reset role;

set local role anon;
select throws_ok(format($$ select public.update_task_content(%s, 'Anon edit #328', 'd',
  now() + interval '7 days', null) $$,
  (select gate_denial_task_id from f328)),
  '42501', 'permission denied for function update_task_content',
  'anon cannot execute update_task_content at all — the literal grant-denial text, not a gate that happens to raise 42501');
reset role;

select is((select title from public.tasks where id =
             (select id from public.tasks where title = 'Gate denial task #328')),
  'Gate denial task #328', 'none of the three denied gate attempts wrote any change');
select is((select count(*) from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Gate denial task #328'), 0::bigint,
  'none of the three denied gate attempts wrote an activity row');

-- ==================== 9. The command is the only write path ====================

select pg_temp.test_login('32800000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ insert into public.task_activity (task_id, kind, actor_id, details)
  values (%s, 'content_updated', '32800000-0000-0000-0000-000000000001', '{}'::jsonb) $$,
  (select id from public.tasks where title = 'Direct write task #328')),
  '42501', null, 'an authorized manager still cannot append Task activity directly');
reset role;

-- ==================== 10. Locks held while the command runs ====================
-- House rule 5: without this probe no test would fail if require_task_manager
-- (via require_origin_manager) skipped its FOR SHARE re-validation, or if the
-- target Task row were not locked FOR UPDATE before authority is checked.
-- Pattern copied from create_task.test.sql:701-776 / campaign_commands.test.sql.
select extensions.dblink_connect('utc_lock_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('utc_lock_setup', $$
  delete from public.tasks where title = 'Lock Probe Task #328';
  delete from public.member_departments where member_id = '32800000-0000-0000-0000-000000000021';
  delete from auth.users where id = '32800000-0000-0000-0000-000000000021';
  insert into auth.users (id, email) values
    ('32800000-0000-0000-0000-000000000021', 'lock.probe.bce.328@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('32800000-0000-0000-0000-000000000021', 'Lock Probe BCE 328',
     'lock.probe.bce.328@test.local', 'bce', 'activ');
  insert into public.member_departments (member_id, dept_id)
  values ('32800000-0000-0000-0000-000000000021', 'edu');
  -- #586: committed race fixtures need an explicit native Group roster.
  insert into public.group_members(group_id,member_id,group_role)
  select g.id,md.member_id,case when p.role='bce' then 'manager' else 'member' end
    from public.member_departments md join public.groups g on g.legacy_dept_id=md.dept_id
    join public.profiles p on p.id=md.member_id
   where md.member_id::text like '32800000-%'
  on conflict (group_id,member_id) do nothing;
  insert into public.tasks (title, description, deadline, group_id, status, created_by) values
    ('Lock Probe Task #328', 'Descriere lock', '2027-02-01 09:00:00+00', (select id from public.groups where legacy_dept_id = 'edu'), 'todo',
     '32800000-0000-0000-0000-000000000021');
$$);

select extensions.dblink_connect('utc_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('utc_lock', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('utc_lock', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '32800000-0000-0000-0000-000000000021', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'bce', 'member_level', 5,
      'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text, true)
$$) as remote_claims(setting text);
select extensions.dblink_exec('utc_lock', 'set local role authenticated');
select * from extensions.dblink('utc_lock', $$
  select (public.update_task_content(
    (select id from public.tasks where title = 'Lock Probe Task #328'),
    'Lock Probe Task #328', 'Descriere lock noua', '2027-02-01 09:00:00+00'::timestamptz, null)).title
$$) as locked_update(title text);

select ok(coalesce((
  select 'For Update' = any(row_lock.modes)
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.title = 'Lock Probe Task #328'
), false), 'update_task_content holds the target Task row FOR UPDATE while it runs');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.profiles') as row_lock
    join public.profiles as profile on profile.ctid = row_lock.locked_row
   where profile.id = '32800000-0000-0000-0000-000000000021'
), false), 'update_task_content holds the actor''s live profile row FOR SHARE');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.group_members') as row_lock
    join public.group_members as membership on membership.ctid = row_lock.locked_row
    join public.groups as authority_group on authority_group.id = membership.group_id
   where membership.member_id = '32800000-0000-0000-0000-000000000021'
     and authority_group.legacy_dept_id = 'edu'
), false), 'update_task_content holds the Group roster row its authority rests on FOR SHARE');

select extensions.dblink_exec('utc_lock', 'rollback');
select extensions.dblink_disconnect('utc_lock');
select extensions.dblink_exec('utc_lock_setup', $$
  delete from public.tasks where title = 'Lock Probe Task #328';
  delete from public.member_departments where member_id = '32800000-0000-0000-0000-000000000021';
  delete from auth.users where id = '32800000-0000-0000-0000-000000000021';
$$);
select extensions.dblink_disconnect('utc_lock_setup');


-- #521: Group authority regression matrix.
\ir _group_task_fixtures.psql
reset role;
select pg_temp.g521_task('command0','project',5,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($$select public.update_task_content((select id from g521_tasks where name='command0'),'Updated #521',null,now()+interval '1 day',null)$$,'update_task_content: Group persona 2 on executor 5 in project');
reset role;
select pg_temp.g521_task('command1','project',4,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select throws_ok($$select public.update_task_content((select id from g521_tasks where name='command1'),'Updated #521',null,now()+interval '1 day',null)$$,'42501','task_manage_forbidden','update_task_content: Group persona 3 on executor 4 in project');
reset role;
select pg_temp.g521_task('command2','ind',7,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(6));
select lives_ok($$select public.update_task_content((select id from g521_tasks where name='command2'),'Updated #521',null,now()+interval '1 day',null)$$,'update_task_content: Group persona 6 on executor 7 in ind');
reset role;
select pg_temp.g521_task('command3','dt',5,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(8));
select throws_ok($$select public.update_task_content((select id from g521_tasks where name='command3'),'Updated #521',null,now()+interval '1 day',null)$$,'42501','task_manage_forbidden','update_task_content: Group persona 8 on executor 5 in dt');
reset role;

select * from finish();
rollback;
