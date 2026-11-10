-- task_evaluate_bc_executor.test.sql — #1180 (audit L9, decision 1 of #1144):
-- a Task whose Executor is BC or the Moderator (live level 6 or above) is
-- evaluated only by BC or the Moderator. A Group Manager or Responsible below
-- level 6 is refused with 42501 task_evaluate_forbidden, and the completed-work
-- decider rule (private.is_work_decider, and the set private.work_deciders
-- fans out to) says the same, so the two paths agree. An ordinary Member's
-- Task keeps exactly the evaluators it had.
--
-- Before #1180, private.can_evaluate_task and private.is_work_decider read a
-- BC Executor outside the Group as an ordinary 'member', so the Project's
-- Manager and Responsible both passed: tests 1-6 and 14-18 fail there.
-- Runs in one transaction and rolls back.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(19);

-- 1 the Moderator, 2 a BC evaluator, 3 a BC Executor, 4 the Project's
-- Manager, 5 its Responsible, 6 an ordinary Member of the Project.
create function pg_temp.u(n integer) returns uuid language sql immutable as $$
  select ('e1180000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users (id, email)
select pg_temp.u(n), 'persona.' || n || '.1180@test.local'
  from generate_series(1, 6) as n;

insert into public.profiles (id, full_name, email, role, status)
select pg_temp.u(n), 'Persona #1180 ' || n, 'persona.' || n || '.1180@test.local',
       (case n when 1 then 'moderator' when 2 then 'bc' when 3 then 'bc' else 'voluntar' end)::public.member_role,
       'activ'
  from generate_series(1, 6) as n;

insert into public.groups (name, category, application_level, manager_title, created_by)
values ('Project #1180', 'project', 0, 'Coordonator Principal', pg_temp.u(2));

create temp table g1180 as select id from public.groups where name = 'Project #1180';
grant select on g1180 to authenticated;

insert into public.group_members (group_id, member_id, group_role) values
  ((select id from g1180), pg_temp.u(4), 'manager'),
  ((select id from g1180), pg_temp.u(5), 'responsible'),
  ((select id from g1180), pg_temp.u(6), 'member');

-- Each Task waits in review with one live Assignment, written as the owner
-- the way the shared Group fixture writes its Tasks.
create temp table t1180 (name text primary key, id bigint not null);
grant select on t1180 to authenticated;

create function pg_temp.submitted_task(p_name text, p_executor integer)
returns void language plpgsql as $$
declare v_id bigint;
begin
  insert into public.tasks (title, group_id, created_by, deadline, status, audience,
                            assignment_mode, kind, started_at, submitted_at, created_at)
  values ('Task #1180 ' || p_name, (select id from g1180), pg_temp.u(2),
          now() + interval '1 day', 'in_review', 'org', 'direct', 'task',
          now() - interval '2 days', now() - interval '1 day', now() - interval '3 days')
  returning id into v_id;
  insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
  values (v_id, pg_temp.u(p_executor), pg_temp.u(2), now() - interval '2 days');
  insert into t1180 values (p_name, v_id);
end;
$$;

do $$
begin
  perform pg_temp.submitted_task('bc_refused', 3);
  perform pg_temp.submitted_task('mod_refused', 1);
  perform pg_temp.submitted_task('bc_by_bc', 3);
  perform pg_temp.submitted_task('bc_by_mod', 3);
  perform pg_temp.submitted_task('mod_by_bc', 1);
  perform pg_temp.submitted_task('member_by_manager', 6);
  perform pg_temp.submitted_task('member_by_responsible', 6);
end;
$$;

create function pg_temp.task(p_name text) returns bigint language sql stable as $$
  select id from t1180 where name = p_name
$$;

-- ==================== 1. Below level 6, a BC or Moderator Executor is out of reach ====================

select pg_temp.test_login_leadership(pg_temp.u(4));
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Bine') $$, pg_temp.task('bc_refused')),
  '42501', 'task_evaluate_forbidden',
  'the Project''s Manager (level 1) cannot evaluate a BC member''s Task');
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Bine') $$, pg_temp.task('mod_refused')),
  '42501', 'task_evaluate_forbidden',
  'nor the Moderator''s Task');
select is(public.can_evaluate_task(pg_temp.task('bc_refused')), false,
  'and the capability the page reads tells the Manager so: no Evaluează on a BC member''s Task');
reset role;

select pg_temp.test_login_leadership(pg_temp.u(5));
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Bine') $$, pg_temp.task('bc_refused')),
  '42501', 'task_evaluate_forbidden',
  'the Project''s Responsible cannot evaluate a BC member''s Task');
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Bine') $$, pg_temp.task('mod_refused')),
  '42501', 'task_evaluate_forbidden',
  'nor the Moderator''s Task');
select is(public.can_evaluate_task(pg_temp.task('bc_refused')), false,
  'and the capability tells the Responsible so too');
reset role;

-- ==================== 2. BC and the Moderator still evaluate it ====================

select pg_temp.test_login_leadership(pg_temp.u(2));
select is(public.can_evaluate_task(pg_temp.task('bc_refused')), true,
  'a BC member may evaluate another BC member''s Task');
select lives_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Bine') $$, pg_temp.task('bc_by_bc')),
  'and does: BC evaluates a BC member''s Task');
reset role;

select is((select count(*)::int from public.points_ledger
            where task_id = pg_temp.task('bc_by_bc') and member_id = pg_temp.u(3) and reason = 'task'),
  1, 'and the evaluation writes the BC Executor''s Task Points');

select pg_temp.test_login_leadership(pg_temp.u(1));
select lives_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Bine') $$, pg_temp.task('bc_by_mod')),
  'the Moderator evaluates a BC member''s Task');
reset role;

select pg_temp.test_login_leadership(pg_temp.u(2));
select lives_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Bine') $$, pg_temp.task('mod_by_bc')),
  'BC evaluates the Moderator''s Task');
reset role;

-- ==================== 3. An ordinary Member's Task: the same evaluators as before ====================

select pg_temp.test_login_leadership(pg_temp.u(4));
select lives_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Bine') $$, pg_temp.task('member_by_manager')),
  'the Project''s Manager still evaluates an ordinary Member''s Task');
reset role;

select pg_temp.test_login_leadership(pg_temp.u(5));
select lives_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Bine') $$, pg_temp.task('member_by_responsible')),
  'and so does its Responsible');
reset role;

-- ==================== 4. The completed-work decider rule agrees ====================

select is(private.is_work_decider((select id from g1180), pg_temp.u(3), pg_temp.u(4)), false,
  'the Project''s Manager decides no completed work of a BC member');
select is(private.is_work_decider((select id from g1180), pg_temp.u(3), pg_temp.u(5)), false,
  'nor does its Responsible');
select is(private.is_work_decider((select id from g1180), pg_temp.u(1), pg_temp.u(4)), false,
  'the Project''s Manager decides no completed work of the Moderator');
select is(private.is_work_decider((select id from g1180), pg_temp.u(1), pg_temp.u(5)), false,
  'nor does its Responsible');
select is(array(select decider from private.work_deciders((select id from g1180), pg_temp.u(3)) as decider
                 where decider::text like 'e1180000-%' order by decider),
  array[pg_temp.u(1), pg_temp.u(2)],
  'a BC member''s completed work reaches only the Moderator and the other BC member');
select is(array(select decider from private.work_deciders((select id from g1180), pg_temp.u(6)) as decider
                 where decider::text like 'e1180000-%' order by decider),
  array[pg_temp.u(1), pg_temp.u(2), pg_temp.u(3), pg_temp.u(4), pg_temp.u(5)],
  'an ordinary Member''s completed work reaches the same deciders as before: BC, the Moderator, the Manager and the Responsible');

select * from finish();
rollback;
