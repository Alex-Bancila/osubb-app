-- task_restart_after_return.test.sql — a Task that was returned from review
-- and then lost its Executor must be startable again by the next one.
--
-- #1117 (audit 2026-10-30, finding H1). tasks_lifecycle_timestamp_order_ck used to
-- demand returned_to_progress_at >= started_at. give_up_task (#682) and an
-- update_task that removes the Executor both clear started_at and keep
-- returned_to_progress_at (review_round is history), so the next Executor's
-- start_task wrote a started_at later than the old return and the row failed
-- the check with a raw 23514: the Task could only be cancelled or duplicated.
-- The fixtures backdate the return by an hour -- inside one test transaction
-- now() never moves, and a real second HTTP call sees it advance for real.
-- Runs in one transaction and rolls back.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(10);

-- ==================== Fixtures — prefix 11170000-… ====================
-- 1 the Group Manager (BCE); 2 and 3 Voluntari in the Group; 4 a voter in
-- the level-3 Group.
create function pg_temp.u_h1(n integer) returns uuid language sql immutable as $$
  select ('11170000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users (id, email)
select pg_temp.u_h1(n), 'restart.' || n || '.h1@test.local' from generate_series(1, 4) n;
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.u_h1(n), 'Restart H1 ' || n, 'restart.' || n || '.h1@test.local',
       (case n when 1 then 'bce' when 4 then 'vot' else 'voluntar' end)::member_role,
       'activ'::member_status
  from generate_series(1, 4) n;

insert into public.groups (name, category, min_level) values ('Restart #H1', 'team', 0);
insert into public.groups (name, category, min_level, parent_id)
values ('Restart sus #H1', 'team', 3, (select id from public.groups where name = 'Restart #H1'));
insert into public.group_members (group_id, member_id, group_role)
select grp.id, pg_temp.u_h1(roster.n), roster.role
  from (values (1, 'manager'), (2, 'member'), (3, 'member')) as roster(n, role)
 cross join public.groups as grp
 where grp.name = 'Restart #H1';
insert into public.group_members (group_id, member_id, group_role)
select grp.id, pg_temp.u_h1(4), 'member'
  from public.groups as grp where grp.name = 'Restart sus #H1';

create function pg_temp.task_h1(p_title text) returns bigint language sql stable as $$
  select id from public.tasks where title = p_title
$$;
create function pg_temp.state_h1(p_title text) returns text
language sql stable security definer set search_path = '' as $$
  select format('%s|%s|%s', task.status, (task.started_at is null)::text,
                (task.returned_to_progress_at is not null)::text)
    from public.tasks as task where task.title = p_title
$$;

-- T1: a public Task returned from review once (review_round 1), in progress
-- with Executor 2, Candidate 3 waiting -- exactly the state after
-- return_task_to_progress, an hour later.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status,
   created_at, queue_opened_at, started_at, review_round, returned_to_progress_at, created_by)
values
  ('Restart public #H1', 'Returnat din verificare', '2030-07-01 09:00:00+00',
   (select id from public.groups where name = 'Restart #H1'), 'local', 'public', 'in_progress',
   now() - interval '4 hours', now() - interval '4 hours', now() - interval '3 hours',
   1, now() - interval '1 hour', pg_temp.u_h1(1));
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
values (pg_temp.task_h1('Restart public #H1'), pg_temp.u_h1(2), pg_temp.u_h1(1), now() - interval '3 hours');
insert into public.task_candidates (task_id, member_id, status, joined_at)
values (pg_temp.task_h1('Restart public #H1'), pg_temp.u_h1(3), 'pending', now() - interval '2 hours');

-- T2: a direct Task in the same state, whose Executor an edit will remove.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status,
   created_at, started_at, review_round, returned_to_progress_at, created_by)
values
  ('Restart direct #H1', 'Returnat din verificare', '2030-07-02 09:00:00+00',
   (select id from public.groups where name = 'Restart #H1'), 'local', 'direct', 'in_progress',
   now() - interval '4 hours', now() - interval '3 hours',
   1, now() - interval '1 hour', pg_temp.u_h1(1));
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
values (pg_temp.task_h1('Restart direct #H1'), pg_temp.u_h1(2), pg_temp.u_h1(1), now() - interval '3 hours');

-- ==================== 1. Public Task: return -> give up -> select -> start ====================

select pg_temp.test_login_leadership(pg_temp.u_h1(2));
select lives_ok(
  $$ select public.give_up_task(pg_temp.task_h1('Restart public #H1'), 'Nu mai pot') $$,
  'the returned Executor gives the public Task up');
reset role;
select is(pg_temp.state_h1('Restart public #H1'), 'todo|true|true',
  'the Task is todo with started_at cleared and the return kept (#682, review_round is history)');

select pg_temp.test_login_leadership(pg_temp.u_h1(1));
select lives_ok(
  $$ select public.select_task_candidate(pg_temp.task_h1('Restart public #H1'),
       (select id from public.task_candidates
         where task_id = pg_temp.task_h1('Restart public #H1') and member_id = pg_temp.u_h1(3)),
       false) $$,
  'the manager selects the waiting Candidate as the next Executor');
reset role;

select pg_temp.test_login_leadership(pg_temp.u_h1(3));
select lives_ok(
  $$ select public.start_task(pg_temp.task_h1('Restart public #H1')) $$,
  'the next Executor starts the Task although their start postdates the earlier return');
reset role;
select is(pg_temp.state_h1('Restart public #H1'), 'in_progress|false|true',
  'the Task is in progress again, started now, with the return still recorded');

-- ==================== 2. Direct Task: return -> edit removes the Executor -> assign -> start ====================

select pg_temp.test_login_leadership(pg_temp.u_h1(1));
select lives_ok(
  $$ select public.update_task(pg_temp.task_h1('Restart direct #H1'),
       (select id from public.groups where name = 'Restart sus #H1'),
       'Restart direct #H1', 'Returnat din verificare', '2030-07-02 09:00:00+00'::timestamptz,
       null, 'direct', 'local', null, null, true, '[]'::jsonb, null) $$,
  'the manager moves the Task into a level-3 Group, accepting that the Voluntar Executor is removed');
reset role;
select is(pg_temp.state_h1('Restart direct #H1'), 'todo|true|true',
  'the edit left the Task todo with started_at cleared and the return kept');

select pg_temp.test_login_leadership(pg_temp.u_h1(1));
select lives_ok(
  $$ select public.assign_task_executor(pg_temp.task_h1('Restart direct #H1'), pg_temp.u_h1(4)) $$,
  'the manager assigns a voter of the new Group');
reset role;

select pg_temp.test_login_leadership(pg_temp.u_h1(4));
select lives_ok(
  $$ select public.start_task(pg_temp.task_h1('Restart direct #H1')) $$,
  'the assigned Executor starts the Task after the earlier return');
reset role;
select is(pg_temp.state_h1('Restart direct #H1'), 'in_progress|false|true',
  'the direct Task is in progress again with the return still recorded');

select * from finish();
rollback;
