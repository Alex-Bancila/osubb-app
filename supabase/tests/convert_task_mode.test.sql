-- #329: public.convert_task_mode -- the only way a Task's Audience or
-- Assignment Mode changes after creation, and only before its first
-- Assignment or Candidature (of any status -- a withdrawn Candidature is
-- still history, ADR-0007 Sec Task identity).
--
-- direct -> public opens the Candidate Queue (queue_opened_at = now(),
-- queue_closed_at = null). public -> direct nulls both -- always safe,
-- because any live-or-past Candidature already blocks the conversion, so the
-- queue is necessarily empty. Toggling Audience alone (local <-> org) while
-- Assignment Mode is unchanged never touches the queue timestamps. A call
-- that changes neither field is PT409 nothing_to_update, writing no activity
-- row. An Umbrella has no mode or audience at all (PT409 task_is_umbrella).
-- There is no Executor and no Candidate to notify -- zero notifications is
-- the deliberate, asserted outcome, not an oversight.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(52);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('32900000-0000-0000-0000-000000000001', 'manager.329@test.local'),
  ('32900000-0000-0000-0000-000000000002', 'executor.329@test.local'),
  ('32900000-0000-0000-0000-000000000003', 'member.329@test.local'),
  ('32900000-0000-0000-0000-000000000004', 'inactive.bc.329@test.local'),
  ('32900000-0000-0000-0000-000000000005', 'claimless.329@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('32900000-0000-0000-0000-000000000001', 'Manager 329', 'manager.329@test.local', 'bce', 'activ'),
  ('32900000-0000-0000-0000-000000000002', 'Executant 329', 'executor.329@test.local', 'voluntar', 'activ'),
  ('32900000-0000-0000-0000-000000000003', 'Membru 329', 'member.329@test.local', 'voluntar', 'activ'),
  ('32900000-0000-0000-0000-000000000004', 'BC Inactiv 329', 'inactive.bc.329@test.local', 'bc', 'inactiv'),
  ('32900000-0000-0000-0000-000000000005', 'Fara Claimuri 329', 'claimless.329@test.local', 'voluntar', 'activ');

insert into public.member_departments (member_id, dept_id) values
  ('32900000-0000-0000-0000-000000000001', 'edu'),
  ('32900000-0000-0000-0000-000000000003', 'edu');

-- Ordinary Tasks, one per scenario, all in dept 'edu' so the manager may act.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, created_by)
values
  ('Authority edit #329', 'Direct to public', '2027-01-05 09:00:00+00', 'edu', 'local', 'direct', 'todo', '32900000-0000-0000-0000-000000000001'),
  ('Executor denied #329', 'Descriere O', '2027-01-24 09:00:00+00', 'edu', 'local', 'direct', 'todo', '32900000-0000-0000-0000-000000000001'),
  ('Bad audience task #329', 'Descriere input A', '2027-01-06 09:00:00+00', 'edu', 'local', 'direct', 'todo', '32900000-0000-0000-0000-000000000001'),
  ('Bad mode task #329', 'Descriere input B', '2027-01-07 09:00:00+00', 'edu', 'local', 'direct', 'todo', '32900000-0000-0000-0000-000000000001'),
  ('Nothing to update #329', 'Descriere unchanged', '2027-01-18 09:00:00+00', 'edu', 'local', 'direct', 'todo', '32900000-0000-0000-0000-000000000001'),
  ('Already assigned #329', 'Descriere assigned', '2027-01-08 09:00:00+00', 'edu', 'local', 'direct', 'todo', '32900000-0000-0000-0000-000000000001'),
  ('Gate denial task #329', 'Descriere gate', '2027-01-26 09:00:00+00', 'edu', 'local', 'direct', 'todo', '32900000-0000-0000-0000-000000000001'),
  ('Direct write task #329', 'Descriere P', '2027-01-25 09:00:00+00', 'edu', 'local', 'direct', 'todo', '32900000-0000-0000-0000-000000000001');

-- A public, local, active Opportunity in dept 'edu': visible to any Member
-- of that Department (task_read R6), including the ordinary member persona,
-- who still has no manage authority over it (not a BCE).
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, queue_opened_at, created_by)
values
  ('Member denied #329', 'Descriere member', '2027-01-27 09:00:00+00', 'edu', 'local', 'public', 'todo',
   '2027-01-01 00:00:00+00', '32900000-0000-0000-0000-000000000001');

-- Already-public Task, its queue opened in the past, used for public -> direct.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, queue_opened_at, created_by)
values
  ('Public to direct #329', 'Descriere public', '2027-01-09 09:00:00+00', 'edu', 'local', 'public', 'todo',
   '2027-01-01 00:00:00+00', '32900000-0000-0000-0000-000000000001');

-- Already-public Task with a fixed queue_opened_at, used to prove that
-- toggling Audience alone (mode unchanged) never touches the queue timestamps.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, queue_opened_at, created_by)
values
  ('Audience toggle #329', 'Descriere audience', '2027-01-10 09:00:00+00', 'edu', 'local', 'public', 'todo',
   '2027-01-02 00:00:00+00', '32900000-0000-0000-0000-000000000001');

-- Task with a live Candidature -- withdrawn is still history (Ruling).
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, queue_opened_at, created_by)
values
  ('Has candidates #329', 'Descriere candidates', '2027-01-11 09:00:00+00', 'edu', 'local', 'public', 'todo',
   '2027-01-03 00:00:00+00', '32900000-0000-0000-0000-000000000001');

-- Terminal Task (completed) -- immutable regardless of Assignment/Candidature.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, difficulty, rating, status, completed_at, created_by)
values
  ('Terminal task #329', 'Descriere H', '2027-01-17 09:00:00+00', 'edu', 'local', 'direct', 3, 4, 'completed', now(),
   '32900000-0000-0000-0000-000000000001');

-- Umbrella -- no mode or audience at all.
insert into public.tasks
  (title, dept_id, kind, audience, assignment_mode, difficulty, rating, description, status, created_by)
values
  ('Umbrella #329', 'edu', 'umbrella', null, null, null, null, 'Umbrella desc', 'todo',
   '32900000-0000-0000-0000-000000000001');

create temp table f329 as
select
  9223372036854775807::bigint as missing_id,
  (select id from public.tasks where title = 'Gate denial task #329') as gate_denial_task_id,
  (select id from public.tasks where title = 'Already assigned #329') as assigned_task_id,
  (select id from public.tasks where title = 'Has candidates #329') as has_candidates_task_id,
  (select id from public.tasks where title = 'Member denied #329') as member_denied_task_id;
grant select on f329 to authenticated, anon;

insert into public.task_assignments (task_id, member_id, assigned_by)
select task.id, '32900000-0000-0000-0000-000000000002', '32900000-0000-0000-0000-000000000001'
  from public.tasks as task where task.title = 'Executor denied #329';

insert into public.task_assignments (task_id, member_id, assigned_by)
select task.id, '32900000-0000-0000-0000-000000000002', '32900000-0000-0000-0000-000000000001'
  from public.tasks as task where task.title = 'Already assigned #329';

-- An express_task_interest-shaped withdrawn Candidature: history, still blocks.
insert into public.task_candidates (task_id, member_id, status, joined_at, decided_at, decided_by)
select task.id, '32900000-0000-0000-0000-000000000002', 'withdrawn',
       '2027-01-01 00:00:00+00', '2027-01-01 01:00:00+00', '32900000-0000-0000-0000-000000000002'
  from public.tasks as task where task.title = 'Has candidates #329';

-- ==================== 1. API shape and privileges ====================

select has_function('public', 'convert_task_mode',
  array['bigint', 'text', 'text'],
  'public.convert_task_mode exists with the pinned three-parameter signature');

select is(pg_get_function_identity_arguments(
    'public.convert_task_mode(bigint,text,text)'::regprocedure),
  'p_task_id bigint, p_assignment_mode text, p_audience text',
  'convert_task_mode exposes no actor parameter -- the actor is always auth.uid()');

select is(pg_get_function_result(
    'public.convert_task_mode(bigint,text,text)'::regprocedure),
  'tasks', 'convert_task_mode returns the updated Task row');

select ok(not (select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public' and procedure.proname = 'convert_task_mode'),
  'the public command is a security invoker wrapper');

select ok((select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private' and procedure.proname = 'convert_task_mode_impl'),
  'private.convert_task_mode_impl runs as owner (security definer)');

select ok(coalesce((
    select bool_and('search_path=""' = any(procedure.proconfig))
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private' and procedure.proname = 'convert_task_mode_impl'
  ), false), 'convert_task_mode_impl pins an empty search_path');

select ok(has_function_privilege('authenticated',
  'public.convert_task_mode(bigint,text,text)'::regprocedure,
  'execute'), 'authenticated can execute public.convert_task_mode');

select ok(not has_function_privilege('anon',
  'public.convert_task_mode(bigint,text,text)'::regprocedure,
  'execute'), 'anon cannot execute public.convert_task_mode');

select ok(has_function_privilege('authenticated',
  'private.convert_task_mode_impl(bigint,text,text)'::regprocedure,
  'execute'), 'authenticated can execute private.convert_task_mode_impl');

-- ==================== 2. Authority ====================

select pg_temp.test_login('32900000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.convert_task_mode(%s, 'public', 'local') $$,
  (select id from public.tasks where title = 'Authority edit #329')),
  'the local BCE converts a Task from direct to public');
reset role;

select pg_temp.test_login('32900000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.convert_task_mode(%s, 'public', 'local') $$,
  (select id from public.tasks where title = 'Executor denied #329')),
  '42501', 'task_manage_forbidden',
  'the Task''s own Executor cannot convert its mode -- being the Executor is not managing authority');
reset role;

select pg_temp.test_login('32900000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.convert_task_mode(%s, 'public', 'local') $$,
  (select member_denied_task_id from f329)),
  '42501', 'task_manage_forbidden',
  'an ordinary member with no relation to the Task cannot convert its mode');
reset role;

select is((select count(*) from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title in ('Executor denied #329', 'Member denied #329')), 0::bigint,
  'the two denied conversions wrote no activity row');

select pg_temp.test_login('32900000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.convert_task_mode(%s, 'public', 'local') $$,
  (select missing_id from f329)), 'PT404', 'task_not_found',
  'an unknown or invisible Task is not found, not forbidden');
reset role;

-- ==================== 3. Input validation ====================

select pg_temp.test_login('32900000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.convert_task_mode(%s, 'direct', 'bogus') $$,
  (select id from public.tasks where title = 'Bad audience task #329')),
  'PT400', 'invalid_audience', 'an unknown Audience value is rejected');
select throws_ok(format($$ select public.convert_task_mode(%s, 'direct', null) $$,
  (select id from public.tasks where title = 'Bad audience task #329')),
  'PT400', 'invalid_audience', 'a null Audience value is rejected');
select throws_ok(format($$ select public.convert_task_mode(%s, 'bogus', 'local') $$,
  (select id from public.tasks where title = 'Bad mode task #329')),
  'PT400', 'invalid_assignment_mode', 'an unknown Assignment Mode value is rejected');
select throws_ok(format($$ select public.convert_task_mode(%s, null, 'local') $$,
  (select id from public.tasks where title = 'Bad mode task #329')),
  'PT400', 'invalid_assignment_mode', 'a null Assignment Mode value is rejected');
reset role;
select is((select count(*) from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title in ('Bad audience task #329', 'Bad mode task #329')), 0::bigint,
  'the four rejected input calls wrote no activity row');

-- ==================== 4. State preconditions ====================

select pg_temp.test_login('32900000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));

select throws_ok(format($$ select public.convert_task_mode(%s, 'public', 'local') $$,
  (select id from public.tasks where title = 'Umbrella #329')),
  'PT409', 'task_is_umbrella', 'an Umbrella has no mode or audience to convert');

select throws_ok(format($$ select public.convert_task_mode(%s, 'public', 'local') $$,
  (select id from public.tasks where title = 'Terminal task #329')),
  'PT409', 'task_terminal', 'a terminal Task can no longer have its mode converted');

select throws_ok(format($$ select public.convert_task_mode(%s, 'public', 'local') $$,
  (select assigned_task_id from f329)),
  'PT409', 'task_already_assigned',
  'a Task with any Assignment (of any status) is immutable, even for the manager');

select throws_ok(format($$ select public.convert_task_mode(%s, 'direct', 'local') $$,
  (select has_candidates_task_id from f329)),
  'PT409', 'task_has_candidates',
  'a Task with a withdrawn (historical) Candidature is still immutable');

select throws_ok(format($$ select public.convert_task_mode(%s, 'direct', 'local') $$,
  (select id from public.tasks where title = 'Nothing to update #329')),
  'PT409', 'nothing_to_update', 'a call that changes neither field is rejected, not a silent success');

reset role;
select is((select count(*) from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title in ('Umbrella #329', 'Terminal task #329', 'Nothing to update #329')
               or task.id in (select assigned_task_id from f329)
               or task.id in (select has_candidates_task_id from f329)), 0::bigint,
  'none of the five rejected state-precondition calls wrote an activity row');

-- ==================== 5. Successful conversions, queue timestamps, audit ====================

select pg_temp.test_login('32900000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));

-- ---- direct -> public opens the queue ----
select is((select format('%s|%s', task.audience, task.assignment_mode)
             from public.tasks as task where task.title = 'Authority edit #329'),
  'local|public', 'the direct -> public conversion in section 2 changed Audience Mode as pinned');
select ok((select queue_opened_at is not null and queue_opened_at >= created_at
             from public.tasks where title = 'Authority edit #329'),
  'direct -> public sets queue_opened_at');
select is((select queue_closed_at from public.tasks where title = 'Authority edit #329'), null,
  'direct -> public leaves queue_closed_at null');

select is((select format('%s|%s|%s|%s|%s|%s', activity.kind, activity.actor_id,
                         (activity.assignment_id is null)::text,
                         (activity.from_status is null)::text, (activity.to_status is null)::text,
                         (activity.note is null)::text)
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Authority edit #329' and activity.kind = 'mode_converted'),
  'mode_converted|32900000-0000-0000-0000-000000000001|true|true|true|true',
  'the mode_converted activity row names the actor, carries no assignment_id, no status change and no note');
select is((select activity.details -> 'from'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Authority edit #329' and activity.kind = 'mode_converted'),
  jsonb_build_object('audience', 'local', 'assignment_mode', 'direct'),
  'details.from holds the pre-conversion Audience and Assignment Mode');
select is((select activity.details -> 'to'
             from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.title = 'Authority edit #329' and activity.kind = 'mode_converted'),
  jsonb_build_object('audience', 'local', 'assignment_mode', 'public'),
  'details.to holds the post-conversion Audience and Assignment Mode');
select is((select count(*) from public.notifications as notification
             join public.tasks as task on task.id = notification.task_id
            where task.title = 'Authority edit #329'), 0::bigint,
  'a mode conversion sends no notification -- nobody to tell');

-- ---- public -> direct nulls both queue timestamps ----
select lives_ok(format($$ select public.convert_task_mode(%s, 'direct', 'local') $$,
  (select id from public.tasks where title = 'Public to direct #329')),
  'the manager converts a public Task back to direct');
select is((select format('%s|%s', (task.queue_opened_at is null)::text, (task.queue_closed_at is null)::text)
             from public.tasks as task where task.title = 'Public to direct #329'),
  'true|true', 'public -> direct nulls both queue timestamps');
select is((select count(*) from public.notifications as notification
             join public.tasks as task on task.id = notification.task_id
            where task.title = 'Public to direct #329'), 0::bigint,
  'the public -> direct conversion sends no notification');

-- ---- local <-> org alone leaves the queue untouched ----
select lives_ok(format($$ select public.convert_task_mode(%s, 'public', 'org') $$,
  (select id from public.tasks where title = 'Audience toggle #329')),
  'the manager toggles Audience alone, Assignment Mode unchanged');
select is((select format('%s|%s|%s', task.audience, task.assignment_mode, task.queue_opened_at)
             from public.tasks as task where task.title = 'Audience toggle #329'),
  'org|public|2027-01-02 00:00:00+00', 'toggling Audience alone never touches queue_opened_at');
select is((select queue_closed_at from public.tasks where title = 'Audience toggle #329'), null,
  'toggling Audience alone leaves queue_closed_at untouched (still null)');
select is((select count(*) from public.notifications as notification
             join public.tasks as task on task.id = notification.task_id
            where task.title = 'Audience toggle #329'), 0::bigint,
  'the Audience-alone toggle sends no notification');

reset role;

-- ==================== 6. Gate denials ====================

select pg_temp.test_login('32900000-0000-0000-0000-000000000005',
  jsonb_build_object('provider', 'email'));
select throws_ok(format($$ select public.convert_task_mode(%s, 'public', 'local') $$,
  (select gate_denial_task_id from f329)),
  '42501', 'task_command_forbidden', 'a real uid without organisation claims is denied by the gate');
reset role;

select pg_temp.test_login('32900000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.convert_task_mode(%s, 'public', 'local') $$,
  (select gate_denial_task_id from f329)),
  '42501', 'task_command_forbidden',
  'a deactivated BC holding a still-valid level-6 token is denied by the gate');
reset role;

set local role anon;
select throws_ok(format($$ select public.convert_task_mode(%s, 'public', 'local') $$,
  (select gate_denial_task_id from f329)),
  '42501', 'permission denied for function convert_task_mode',
  'anon cannot execute convert_task_mode at all -- the literal grant-denial text, not a gate that happens to raise 42501');
reset role;

select is((select format('%s|%s', task.audience, task.assignment_mode)
             from public.tasks as task where task.id =
               (select gate_denial_task_id from f329)),
  'local|direct', 'none of the three denied gate attempts wrote any change');
select is((select count(*) from public.task_activity as activity
             join public.tasks as task on task.id = activity.task_id
            where task.id = (select gate_denial_task_id from f329)), 0::bigint,
  'none of the three denied gate attempts wrote an activity row');

-- ==================== 7. The command is the only write path ====================

select pg_temp.test_login('32900000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ insert into public.task_activity (task_id, kind, actor_id, details)
  values (%s, 'mode_converted', '32900000-0000-0000-0000-000000000001', '{}'::jsonb) $$,
  (select id from public.tasks where title = 'Direct write task #329')),
  '42501', null, 'an authorized manager still cannot append Task activity directly');
reset role;

-- ==================== 8. Locks held while the command runs ====================
-- House rule 5: without this probe no test would fail if require_task_manager
-- (via require_origin_manager) skipped its FOR SHARE re-validation, or if the
-- target Task row were not locked FOR UPDATE before authority is checked.
-- Pattern copied from update_task_content.test.sql / campaign_commands.test.sql.
select extensions.dblink_connect('ctm_lock_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('ctm_lock_setup', $$
  delete from public.tasks where title = 'Lock Probe Task #329';
  delete from public.member_departments where member_id = '32900000-0000-0000-0000-000000000021';
  delete from auth.users where id = '32900000-0000-0000-0000-000000000021';
  insert into auth.users (id, email) values
    ('32900000-0000-0000-0000-000000000021', 'lock.probe.bce.329@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('32900000-0000-0000-0000-000000000021', 'Lock Probe BCE 329',
     'lock.probe.bce.329@test.local', 'bce', 'activ');
  insert into public.member_departments (member_id, dept_id)
  values ('32900000-0000-0000-0000-000000000021', 'edu');
  insert into public.tasks (title, description, deadline, dept_id, audience, assignment_mode, status, created_by) values
    ('Lock Probe Task #329', 'Descriere lock', '2027-02-01 09:00:00+00', 'edu', 'local', 'direct', 'todo',
     '32900000-0000-0000-0000-000000000021');
$$);

select extensions.dblink_connect('ctm_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('ctm_lock', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('ctm_lock', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '32900000-0000-0000-0000-000000000021', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'bce', 'member_level', 5,
      'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text, true)
$$) as remote_claims(setting text);
select extensions.dblink_exec('ctm_lock', 'set local role authenticated');
select * from extensions.dblink('ctm_lock', $$
  select (public.convert_task_mode(
    (select id from public.tasks where title = 'Lock Probe Task #329'),
    'public', 'local')).assignment_mode
$$) as locked_update(assignment_mode text);

-- pgrowlocks reports a real UPDATE (not merely a SELECT ... FOR UPDATE hold)
-- as a plain 'Update' mode, without the 'For ' prefix used for a lock-only
-- tuple (verified empirically against this exact schema: unlike a command
-- that wraps its UPDATE in a nested exception block -- which produces an
-- implicit subtransaction and a composite {"For Update","No Key Update"} --
-- convert_task_mode_impl's single top-level UPDATE consolidates its own
-- prior FOR UPDATE hold into one 'Update' entry). Either way the row is
-- exclusively locked for the duration of the command; this is what the
-- probe proves.
select ok(coalesce((
  select 'Update' = any(row_lock.modes)
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.title = 'Lock Probe Task #329'
), false), 'convert_task_mode holds the target Task row exclusively locked while it runs');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.profiles') as row_lock
    join public.profiles as profile on profile.ctid = row_lock.locked_row
   where profile.id = '32900000-0000-0000-0000-000000000021'
), false), 'convert_task_mode holds the actor''s live profile row FOR SHARE');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.group_members') as row_lock
    join public.group_members as membership on membership.ctid = row_lock.locked_row
    join public.groups as authority_group on authority_group.id = membership.group_id
   where membership.member_id = '32900000-0000-0000-0000-000000000021'
     and authority_group.legacy_dept_id = 'edu'
), false), 'convert_task_mode holds the Group roster row its authority rests on FOR SHARE');

select extensions.dblink_exec('ctm_lock', 'rollback');
select extensions.dblink_disconnect('ctm_lock');
select extensions.dblink_exec('ctm_lock_setup', $$
  delete from public.tasks where title = 'Lock Probe Task #329';
  delete from public.member_departments where member_id = '32900000-0000-0000-0000-000000000021';
  delete from auth.users where id = '32900000-0000-0000-0000-000000000021';
$$);
select extensions.dblink_disconnect('ctm_lock_setup');


-- #521: Group authority regression matrix.
\ir _group_task_fixtures.psql
reset role;
select pg_temp.g521_task('command0','project',null,'todo','direct','task');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($$select public.convert_task_mode((select id from g521_tasks where name='command0'),'public','org')$$,'convert_task_mode: Group persona 2 in project');
reset role;
select pg_temp.g521_task('command1','project',null,'todo','direct','task');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select lives_ok($$select public.convert_task_mode((select id from g521_tasks where name='command1'),'public','org')$$,'convert_task_mode: Group persona 3 in project');
reset role;
select pg_temp.g521_task('command2','ind',null,'todo','direct','task');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(6));
select lives_ok($$select public.convert_task_mode((select id from g521_tasks where name='command2'),'public','org')$$,'convert_task_mode: Group persona 6 in ind');
reset role;
select pg_temp.g521_task('command3','dt',null,'todo','direct','task');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(8));
select throws_ok($$select public.convert_task_mode((select id from g521_tasks where name='command3'),'public','org')$$,'42501','task_manage_forbidden','convert_task_mode: Group persona 8 in dt');
reset role;

select * from finish();
rollback;
