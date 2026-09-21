-- department_cup_task_origins.test.sql — #259: Department Cup totals follow the
-- Task Origin, never the Executor's current memberships, and the Cup takes
-- exactly one filter: the Campaign.
--
-- Fixture prefix: 25900000-… (issue #259). Runs in one transaction and rolls
-- back, so the local demo seed survives untouched; every "before" figure is
-- captured from the live Cup rather than assumed, because the seed moves.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(45);

-- ==================== 1. Surface, shape and grants ====================

select has_view('public', 'dept_cup', 'the unfiltered Department Cup remains a public read endpoint');
select is(
  (select reloptions::text from pg_class where oid = 'public.dept_cup'::regclass),
  '{security_invoker=on}', 'the Department Cup view is security-invoker');
select ok(has_table_privilege('authenticated', 'public.dept_cup', 'SELECT'),
  'authenticated may select the Department Cup view');
select ok(not has_table_privilege('anon', 'public.dept_cup', 'SELECT'),
  'anon cannot select the Department Cup view');
select has_function('public', 'department_cup', array['bigint'],
  'the Campaign-filtered Department Cup read exists');
select ok(has_function_privilege('authenticated', 'public.department_cup(bigint)', 'EXECUTE'),
  'authenticated may execute the Campaign-filtered Department Cup read');
select ok(not has_function_privilege('anon', 'public.department_cup(bigint)', 'EXECUTE'),
  'anon cannot execute the Campaign-filtered Department Cup read');
select ok(not has_function_privilege('service_role', 'private.department_cup_rows(bigint)', 'EXECUTE'),
  'the server role cannot bypass the BCE+ gate through the private body');
-- Pins the view-level revoke too, not only the function grant above: dept_cup
-- is security_invoker over a body service_role has no `usage` on `private` to
-- reach anyway (conventions.test.sql), so a retained grant here could never
-- return rows -- it would fail 42501 on the private schema. Nothing needs it
-- (grepped app/, supabase/functions/, scripts/, .github/workflows/), so the
-- revoke stands and this assertion keeps a future migration from quietly
-- restoring it.
select ok(not has_table_privilege('service_role', 'public.dept_cup', 'SELECT'),
  'service_role holds no select on the Department Cup view -- it could never satisfy it without private schema usage');

-- ==================== 2. Group settings define the competing set ====================
select set_eq(
  $$select legacy_dept_id from public.groups where competes_in_cup$$,
  $$select unnest(array['edu','pr','youth','fin','hr']::text[])$$,
  'seeded Group settings identify the five current competitors');

-- ==================== 3. Fixtures ====================

insert into auth.users (id, email) values
  ('25900000-0000-0000-0000-000000000001', 'bce259@example.test'),
  ('25900000-0000-0000-0000-000000000002', 'member259@example.test'),
  ('25900000-0000-0000-0000-000000000003', 'inactive259@example.test'),
  ('25900000-0000-0000-0000-000000000004', 'responsabil259@example.test'),
  ('25900000-0000-0000-0000-000000000005', 'bc259@example.test');
insert into public.profiles (id, full_name, email, role, status) values
  ('25900000-0000-0000-0000-000000000001', 'BCE 259', 'bce259@example.test', 'bce', 'activ'),
  ('25900000-0000-0000-0000-000000000002', 'Member 259', 'member259@example.test', 'activ', 'activ'),
  ('25900000-0000-0000-0000-000000000003', 'Inactive BCE 259', 'inactive259@example.test', 'bce', 'inactiv'),
  -- Level 4 -- the rank directly below the gate. This is the persona that
  -- pins the threshold: `app/src/lib/capabilities.ts` carries `manageTasks: 4`
  -- for `responsabil`, so a gate accidentally loosened to `>= 4` must be
  -- caught here rather than shipping unnoticed (review finding 1).
  ('25900000-0000-0000-0000-000000000004', 'Responsabil 259', 'responsabil259@example.test', 'responsabil', 'activ'),
  -- Level 6 -- proves the allow side is not carried by BCE alone.
  ('25900000-0000-0000-0000-000000000005', 'BC 259', 'bc259@example.test', 'bc', 'activ');

-- The Executor belongs to no Department at all: every point below has to reach
-- a Department through its Task's Origin or not at all.
insert into public.teams (id, name, dept_id) values
  ('259-dept-team', 'Department Team 259', 'edu'),
  ('259-independent', 'Independent Team 259', null);

-- `campaigns.id` and `projects.id` are GENERATED ALWAYS, so the fixture
-- overrides them: the Campaign filter is asserted against literal ids below,
-- and a literal beats threading a lookup through every assertion.
insert into public.campaigns (id, department_id, name, created_by)
overriding system value values
  (2590001, 'edu', 'Campania A 259', '25900000-0000-0000-0000-000000000001'),
  (2590002, 'edu', 'Campania B 259', '25900000-0000-0000-0000-000000000001');

insert into public.projects (id, name, status, leader_id, created_by)
overriding system value values
  (2590003, 'Project 259', 'active', '25900000-0000-0000-0000-000000000001',
   '25900000-0000-0000-0000-000000000001');

-- Every Task is already evaluated; `pg_temp.test_credit_task` below writes the
-- Assignment, the Evaluation and the ledger entry, so the award is always
-- difficulty x rating_mult(5) = difficulty x 3.
insert into public.tasks
  (title, description, deadline, dept_id, team_id, project_id, campaign_id,
   status, difficulty, rating, created_by, created_at, completed_at)
select fixture.title, 'Fixture', now() - interval '2 days',
       fixture.dept_id, fixture.team_id, fixture.project_id, fixture.campaign_id,
       'completed', fixture.difficulty, 5,
       '25900000-0000-0000-0000-000000000001',
       -- completed_at is `now()`, not a past instant: pg_temp.test_credit_task
       -- ends the Assignment at completed_at, and task_assignments_end_
       -- chronology_check refuses an end before the Assignment's own start.
       now() - interval '3 days', now()
  from (values
    -- Campaign A: one award that stands (4 x 3 = 12)…
    ('Cup A Department Task 259',      'edu'::text, null::text,        null::bigint, 2590001::bigint, 4),
    -- …and one that is reversed to nothing (3 x 3 = 9, then -9).
    ('Cup A Reversed Task 259',        'edu',       null,             null,         2590001,         3),
    -- Campaign B, on a Department Team whose parent Department is edu (5 x 3 = 15).
    ('Cup B Department Team Task 259', null,        '259-dept-team',  null,         2590002,         5),
    -- An Independent Team has no parent Department: 2 x 3 = 6 reaches no Cup row.
    ('Cup Independent Team Task 259',  null,        '259-independent', null,        null,            2),
    -- Project work never enters the Cup: 5 x 3 = 15 reaches no Cup row either.
    ('Cup Project Task 259',           null,        null,             2590003,      null,            5)
  ) as fixture (title, dept_id, team_id, project_id, campaign_id, difficulty);

-- Snapshot the Cup before any of the fixture points land, as leadership: the
-- demo seed already puts real Task points on real Departments.
select pg_temp.test_login_leadership('25900000-0000-0000-0000-000000000001');
create temporary table cup259_before as
  select dept_id, points from public.dept_cup;
reset role;

select pg_temp.test_credit_task(task.id, '25900000-0000-0000-0000-000000000002',
                                '25900000-0000-0000-0000-000000000001')
  from public.tasks as task
 where task.title like 'Cup %259'
 order by task.id;

-- Reverse the second Campaign-A award exactly the way reopen_task does.
update public.task_evaluations as evaluation
   set reversed_at = now(),
       reversed_by = '25900000-0000-0000-0000-000000000001',
       reversal_reason = 'fixture reversal 259'
  from public.tasks as task
 where task.id = evaluation.task_id
   and task.title = 'Cup A Reversed Task 259';

insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id)
select assignment.member_id, -evaluation.points, 'task_reversal',
       evaluation.task_id, evaluation.id
  from public.task_evaluations as evaluation
  join public.task_assignments as assignment on assignment.id = evaluation.assignment_id
 where evaluation.reversal_reason = 'fixture reversal 259';

-- A sanction is a personal matter; it must never move a Department's standing.
insert into public.points_ledger (member_id, delta, reason, note, awarded_by) values
  ('25900000-0000-0000-0000-000000000002', -7, 'sanction', 'Sanction excluded 259',
   '25900000-0000-0000-0000-000000000001');

-- ==================== 4. Unfiltered standings follow the Task Origin ====================

select pg_temp.test_login_leadership('25900000-0000-0000-0000-000000000001');

select is((select count(*) from public.dept_cup), 5::bigint,
  'BCE sees all five competing Departments, including the ones on zero');

select is((select points from public.dept_cup where dept_id = 'edu'),
          (select points + 27 from cup259_before where dept_id = 'edu'),
          'a Department Task (12) and a Department-Team Task on a child Team (15) both credit the parent Department, and the reversed award nets to zero');

select is((select sum(points)::int from public.dept_cup),
          (select sum(points)::int + 27 from cup259_before),
          'the Project Task (15) and the Independent-Team Task (6) credit no Department at all -- the whole Cup moved by exactly the two qualifying awards');

select is((select count(*) from public.dept_cup where dept_id in ('diverse', 'secretariat', 'org')), 0::bigint,
  'coordination structures and the org row never appear as Cup rows');

select is((select array_agg(dept_id) from public.dept_cup),
          (select array_agg(dept_id order by points desc, name) from public.dept_cup),
          'rows use points descending with the stable Department-name tiebreak');

-- ==================== 5. The Campaign filter ====================

select is((select points from public.department_cup(2590001) where dept_id = 'edu'), 12,
  'Campania A shows only its own surviving award');
select is((select points from public.department_cup(2590002) where dept_id = 'edu'), 15,
  'Campania B shows only its own award -- the same Department, a different total under each Campaign');
select is((select sum(points)::int from public.department_cup(2590001)), 12,
  'no other Department picks up points from a Campaign it did not run');
select is((select count(*) from public.department_cup(2590001)), 5::bigint,
  'a filtered Cup still lists every competing Department, on zero where it earned nothing');
select is((select sum(points)::int from public.department_cup(-1)), 0,
  'an unknown Campaign id yields a Cup of zeroes, not the unfiltered totals');
select set_eq(
  $$ select dept_id, points, members from public.department_cup(null) $$,
  $$ select dept_id, points, members from public.dept_cup $$,
  'department_cup(null) is the view: one body, two entry points');

-- #523: settings and deep paths, all changed only in this rolled-back fixture.
reset role;
update public.groups set counts_toward_parent_cup=false where legacy_team_id='259-dept-team';
select is((select points from public.department_cup(2590002) where dept_id='edu'),0,
  'a child link that does not count blocks its Task points');
update public.groups set counts_toward_parent_cup=true where legacy_team_id='259-dept-team';
update public.groups set competes_in_cup=false where legacy_dept_id='youth';
select is((select count(*) from public.dept_cup where dept_id='youth'),0::bigint,
  'disabling competition removes a Group row');
update public.groups set competes_in_cup=true where legacy_dept_id='youth';

-- Two native ancestors above a mapped leaf exercise arbitrary depth without
-- bypassing #519's Task/Request legacy-Origin compatibility boundary.
insert into public.groups(name,category,parent_id,path)
select 'Cup native child 523','team',id,'{}' from public.groups where legacy_dept_id='edu';
insert into public.groups(name,category,parent_id,path)
select 'Cup native grandchild 523','project',id,'{}' from public.groups where name='Cup native child 523';
update public.groups set parent_id=(select id from public.groups where name='Cup native grandchild 523')
where legacy_team_id='259-dept-team';
select is((select points from public.department_cup(2590002) where dept_id='edu'),15,
  'two native levels and the mapped leaf all count toward the competing root');
update public.groups set counts_toward_parent_cup=false where name='Cup native grandchild 523';
select is((select points from public.department_cup(2590002) where dept_id='edu'),0,
  'the deepest native link can block the Cup contribution');
update public.groups set counts_toward_parent_cup=true where name='Cup native grandchild 523';
update public.groups set counts_toward_parent_cup=false where name='Cup native child 523';
select is((select points from public.department_cup(2590002) where dept_id='edu'),0,
  'the upper native link can independently block the Cup contribution');
select is((select points from public.leadership_leaderboard((select id from public.groups where legacy_dept_id='edu'),2590002)
  where member_id='25900000-0000-0000-0000-000000000002'),15,
  'Cup participation settings never remove work from a Group subtree Leaderboard');
update public.groups set counts_toward_parent_cup=true where name='Cup native child 523';
update public.groups set counts_toward_parent_cup=false where legacy_dept_id='edu';
select is((select points from public.department_cup(2590002) where dept_id='edu'),15,
  'the root flag is not a link below itself and does not discard descendant points');
select is((select points from public.department_cup(2590001) where dept_id='edu'),12,
  'a competing Group keeps its own direct work regardless of its parent flag');
update public.groups set counts_toward_parent_cup=true where legacy_dept_id='edu';

update public.groups set competes_in_cup=true where legacy_project_id=2590003;
select is((select points from public.dept_cup where group_id=(select id from public.groups where legacy_project_id=2590003)),15,
  'a Project presentation label never prevents a Group from competing');
update public.groups set competes_in_cup=false where legacy_project_id=2590003;
select ok(exists(select 1 from public.dept_cup cup join public.groups grp on grp.id=cup.group_id where grp.legacy_dept_id='edu'),
  'unfiltered Cup includes the actual Group identifier');
select ok(exists(select 1 from public.department_cup(2590001) cup join public.groups grp on grp.id=cup.group_id where grp.legacy_dept_id='edu'),
  'Campaign-filtered Cup includes the actual Group identifier');
select is((select members from public.dept_cup where dept_id='edu'),
  (select count(*) from public.group_members gm join public.profiles p on p.id=gm.member_id and p.status='activ' where gm.group_id=(select id from public.groups where legacy_dept_id='edu')),
  'Cup roster counts active explicit members of the competitor itself');
select pg_temp.test_login_leadership('25900000-0000-0000-0000-000000000001');

-- ==================== 6. The BCE+ gate returns no rows, never an error ====================

select pg_temp.test_login_leadership('25900000-0000-0000-0000-000000000002');
select is((select count(*) from public.dept_cup), 0::bigint,
  'an ordinary Member (level 2) sees no protected rows');
select is((select count(*) from public.department_cup(2590001)), 0::bigint,
  'an ordinary Member gets no rows from the filtered read either -- and no error');

-- Pins the threshold itself, not merely "some level is denied". A responsabil
-- is level 4, the rank directly below the gate, and is the plausible-drift
-- case named in review finding 1: loosening `>= 5` to `>= 4` would leave every
-- other persona in this suite green.
select pg_temp.test_login_leadership('25900000-0000-0000-0000-000000000004');
select is((select count(*) from public.dept_cup), 0::bigint,
  'a responsabil (level 4, one rank below the gate) sees no protected rows');
select is((select count(*) from public.department_cup(2590001)), 0::bigint,
  'a responsabil gets no rows from the filtered read either -- the gate is >= 5, not >= 4');

-- Pins the allow side above BCE alone: a gate accidentally narrowed to `= 5`
-- must fail here.
select pg_temp.test_login_leadership('25900000-0000-0000-0000-000000000005');
select is((select count(*) from public.dept_cup), 5::bigint,
  'a BC (level 6) also sees the Department Cup -- the gate is >= 5, not = 5');
select is((select points from public.department_cup(2590001) where dept_id = 'edu'), 12,
  'a BC sees the same Campaign-filtered totals a BCE would');

select pg_temp.test_login('25900000-0000-0000-0000-000000000002',
  '{"member_role":"bce","member_level":5,"dept_ids":[],"team_ids":[]}'::jsonb);
select is((select count(*) from public.dept_cup), 0::bigint,
  'a stale BCE claim loses to the live role: demotion takes effect before the token expires');

select pg_temp.test_login_leadership('25900000-0000-0000-0000-000000000003');
select is((select count(*) from public.dept_cup), 0::bigint,
  'an inactive BCE sees no protected rows despite live leadership claims');

select pg_temp.test_login('25900000-0000-0000-0000-000000000001', '{}'::jsonb);
select is((select count(*) from public.dept_cup), 0::bigint,
  'a claimless session sees no standings, even as a real active BCE uid');
select is((select count(*) from public.department_cup(2590001)), 0::bigint,
  'a claimless session gets no rows from the filtered read either');

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok('select * from public.dept_cup', '42501', null,
  'anon holds no grant on the Department Cup view');
select throws_ok('select * from public.department_cup(1)', '42501', null,
  'anon holds no grant on the Campaign-filtered Department Cup read');
reset role;

select * from finish();
rollback;
