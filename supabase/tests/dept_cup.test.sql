-- dept_cup.test.sql — issue #134: complete, active-only department standings.
-- Runs in one transaction and rolls back, leaving the local demo seed intact.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(17);


-- Remove the demo members and every dependent row inside this rolled-back
-- transaction. Reference departments stay untouched: those five rows are the
-- production configuration this view must always return.
truncate public.profiles cascade;
-- TRUNCATE also empties the Group mirror; restore every reference competitor,
-- including Groups with no fixture memberships.
select pg_temp.materialize_legacy_groups();

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'cup.active@test.local'),
  ('c2000000-0000-0000-0000-000000000002', 'cup.inactive@test.local'),
  ('c3000000-0000-0000-0000-000000000003', 'cup.alumni@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('c1000000-0000-0000-0000-000000000001', 'Membru BCE',     'cup.active@test.local',   'bce',       'activ'),
  ('c2000000-0000-0000-0000-000000000002', 'Membru Inactiv', 'cup.inactive@test.local', 'voluntar', 'inactiv'),
  ('c3000000-0000-0000-0000-000000000003', 'Fost Membru',    'cup.alumni@test.local',   'voluntar', 'alumni');

insert into pg_temp.fixture_member_departments (member_id, dept_id) values
  ('c1000000-0000-0000-0000-000000000001', 'edu'),
  ('c2000000-0000-0000-0000-000000000002', 'pr'),
  ('c3000000-0000-0000-0000-000000000003', 'hr');
-- #586: materialize this suite's legacy setup as rolled-back Group fixtures.
select pg_temp.materialize_legacy_groups();


insert into public.tasks (title, difficulty, group_id) values
  ('cup-active', 5, pg_temp.dept_group('hr')), ('cup-inactive', 5, pg_temp.dept_group('hr')), ('cup-alumni', 5, pg_temp.dept_group('hr'));
-- #312: rating may only be set once completed (tasks_evaluation_inputs_ck).
update public.tasks set status = 'completed', completed_at = now(), rating = 3
 where title like 'cup-%';
-- #317: the Rating no longer credits anyone by itself — each participant's
-- Evaluation and ledger entry are written explicitly (5 x 1 = 5 each).
-- #345 retired the task_assignees join table this list used to live in;
-- pg_temp.test_credit_task writes the Assignment each Evaluation needs.
select pg_temp.test_credit_task(task.id, participant.member_id,
                                'c1000000-0000-0000-0000-000000000001')
  from (values
    ('cup-active',   'c1000000-0000-0000-0000-000000000001'::uuid),
    ('cup-inactive', 'c2000000-0000-0000-0000-000000000002'::uuid),
    ('cup-alumni',   'c3000000-0000-0000-0000-000000000003'::uuid)
  ) as participant (title, member_id)
  join public.tasks task on task.title = participant.title;

-- #936: the dept_cup view is dropped; the same rows come from
-- public.department_cup(null, null, null) (unbounded Campaign and date range).
select pg_temp.test_login_leadership('c1000000-0000-0000-0000-000000000001');

select is((select count(*) from public.department_cup(null::bigint, null::timestamptz, null::timestamptz)), 5::bigint,
  'BCE sees all five canonical departments');
select is((select points from public.department_cup(null::bigint, null::timestamptz, null::timestamptz) where group_id = pg_temp.dept_group('edu')), 0,
  'current Department membership does not redirect another Origin''s Task Points');
select is((select members from public.department_cup(null::bigint, null::timestamptz, null::timestamptz) where group_id = pg_temp.dept_group('edu')), 1::bigint,
  'the cup counts the active member');
select is((select points from public.department_cup(null::bigint, null::timestamptz, null::timestamptz) where group_id = pg_temp.dept_group('pr')), 0,
  'a Department that owns no Task shows zero, regardless of its members'' status');
select is((select members from public.department_cup(null::bigint, null::timestamptz, null::timestamptz) where group_id = pg_temp.dept_group('pr')), 0::bigint,
  'an inactive member is not counted');
select is((select points from public.department_cup(null::bigint, null::timestamptz, null::timestamptz) where group_id = pg_temp.dept_group('hr')), 15,
  'Task Points follow the Department Task Origin regardless of Executor membership status');
select is((select members from public.department_cup(null::bigint, null::timestamptz, null::timestamptz) where group_id = pg_temp.dept_group('hr')), 0::bigint,
  'an alumni member is not counted');
-- ADR-0007 keeps anyone with completed Task history eligible regardless of
-- profile status: the inactive and alumni Executors' own credits are exactly
-- what make hr 15 rather than 5 (the active member's own award alone) --
-- proven positively, not left implicit in the total above.
select is(
  (select sum(entry.delta)::int from public.points_ledger as entry
     join public.tasks as task on task.id = entry.task_id
    where entry.member_id in ('c2000000-0000-0000-0000-000000000002',
                               'c3000000-0000-0000-0000-000000000003')
      and task.group_id = pg_temp.dept_group('hr')),
  10,
  'the inactive and alumni Executors'' own Task credits (5 each) are what carry hr to 15, not merely the active member''s');
select is((select points from public.department_cup(null::bigint, null::timestamptz, null::timestamptz) where group_id = pg_temp.dept_group('fin')), 0,
  'a department without any member remains visible with zero points');

select results_eq(
  $$ select group_id from public.department_cup(null::bigint, null::timestamptz, null::timestamptz) order by points desc, name asc $$,
  $$ values (pg_temp.dept_group('hr')), (pg_temp.dept_group('edu')), (pg_temp.dept_group('fin')),
            (pg_temp.dept_group('pr')), (pg_temp.dept_group('youth')) $$,
  'standings sort by points descending and then by department name');

reset role;

select pg_temp.test_clear_jwt();
set local role authenticated;
select is((select count(*) from public.department_cup(null::bigint, null::timestamptz, null::timestamptz)), 0::bigint,
  'a claimless authenticated session still sees no standings');
reset role;

-- #936: the dept_id-column check (view had no compatibility column) tested the
-- dropped view's schema and has no equivalent over a function; not ported.

-- #677: department_cup(null, null, null) is the unbounded read; the Work Filter's award date range
-- narrows department_cup only. One more hr award (2 x 1 = 2), dated
-- 2001-03-10 10:00Z by its Evaluation, far from the three awarded at now().
insert into public.tasks (title, difficulty, group_id) values ('cup-dated', 2, pg_temp.dept_group('hr'));
update public.tasks set status = 'completed', completed_at = now(), rating = 3
 where title = 'cup-dated';
select pg_temp.test_credit_task(task.id, 'c1000000-0000-0000-0000-000000000001',
                                'c1000000-0000-0000-0000-000000000001',
                                p_awarded_at => '2001-03-10 10:00:00+00')
  from public.tasks task where task.title = 'cup-dated';

select pg_temp.test_login_leadership('c1000000-0000-0000-0000-000000000001');
select is((select points from public.department_cup(null::bigint, null::timestamptz, null::timestamptz) where group_id = pg_temp.dept_group('hr')), 17,
  'department_cup(null, null, null) carries every award whenever it was made (15 + 2) -- unbounded takes no range');
select is((select points from public.department_cup(null, '2001-03-10 10:00:00+00', '2001-03-11 10:00:00+00')
            where group_id = pg_temp.dept_group('hr')), 2,
  'department_cup over [T1, T1 + 1 day) holds only the award evaluated at T1');
select is((select points from public.department_cup(null, '2001-03-11 10:00:00+00', null)
            where group_id = pg_temp.dept_group('hr')), 15,
  'and from the day after it holds only the three awards made since');
reset role;

-- #861 (Audit D-10): an archived Group has left the Cup, even with points
-- and the competes_in_cup flag still set -- unbounded and in every range
-- and Campaign of department_cup.
update public.groups set status = 'archived' where id = pg_temp.dept_group('hr');
select pg_temp.test_login_leadership('c1000000-0000-0000-0000-000000000001');
select is(
  (select count(*) from public.department_cup(null::bigint, null::timestamptz, null::timestamptz) where group_id = pg_temp.dept_group('hr')), 0::bigint,
  '#861: an archived competing Group is absent from department_cup(null, null, null) despite its 17 points');
select is(
  (select count(*) from public.department_cup(null, '2001-03-10 10:00:00+00', '2001-03-11 10:00:00+00')
    where group_id = pg_temp.dept_group('hr'))
  + (select count(*) from public.department_cup(-861) where group_id = pg_temp.dept_group('hr')),
  0::bigint,
  '#861: an archived competing Group is absent from department_cup for a date range and for a Campaign');
select is((select count(*) from public.department_cup(null::bigint, null::timestamptz, null::timestamptz)), 4::bigint,
  '#861: the four active Departments still compete');
reset role;
select * from finish();
rollback;
