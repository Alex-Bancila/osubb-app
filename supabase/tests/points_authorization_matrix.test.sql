-- points_authorization_matrix.test.sql — #262: final, non-vacuous points
-- read boundary across every browser persona and the trusted server role.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(94);

-- ==================== 1. Surface and grants ====================

select has_view('public', 'my_points', 'the personal-total endpoint exists');
select ok(
  exists (
    select 1 from pg_class
     where oid = 'public.my_points'::regclass
       and 'security_invoker=on' = any (reloptions)
  ),
  'my_points executes with caller privileges'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.points_ledger'::regclass),
  'points_ledger has RLS enabled'
);
select ok(has_table_privilege('authenticated', 'public.my_points', 'select'),
  'authenticated has an explicit my_points read grant');
select ok(has_table_privilege('authenticated', 'public.points_ledger', 'select'),
  'authenticated has an explicit ledger read grant');
select ok(
  not has_table_privilege('anon', 'public.my_points', 'select')
  and not has_table_privilege('anon', 'public.points_ledger', 'select'),
  'anonymous clients have neither points read grant'
);
select ok(has_function_privilege('authenticated', 'public.leadership_leaderboard(bigint,bigint)', 'execute'),
  'authenticated may reach the gated leadership Leaderboard');
select ok(has_function_privilege('authenticated', 'public.department_cup(bigint)', 'execute'),
  'authenticated may reach the gated Department Cup');
select ok(has_function_privilege('authenticated', 'public.leadership_member_tasks(uuid)', 'execute'),
  'authenticated may reach the gated member drill-down');
select ok(
  not has_function_privilege('service_role', 'public.leadership_leaderboard(bigint,bigint)', 'execute')
  and not has_function_privilege('service_role', 'public.department_cup(bigint)', 'execute')
  and not has_function_privilege('service_role', 'public.leadership_member_tasks(uuid)', 'execute'),
  'service_role has no accidental leadership-wrapper bypass'
);

-- ==================== 2. Owned fixtures ====================
-- Remove demo Profiles and everything that depends on them. Reference rows
-- such as Departments and Teams may remain, but every assertion below names
-- this suite's 262-prefixed rows and never depends on seed content.
truncate public.profiles cascade;

insert into auth.users (id, email) values
  ('26200000-0000-0000-0000-000000000000', 'matrix.recrut@test.local'),
  ('26200000-0000-0000-0000-000000000001', 'matrix.voluntar@test.local'),
  ('26200000-0000-0000-0000-000000000002', 'matrix.activ@test.local'),
  ('26200000-0000-0000-0000-000000000003', 'matrix.vot@test.local'),
  ('26200000-0000-0000-0000-000000000004', 'matrix.responsabil@test.local'),
  ('26200000-0000-0000-0000-000000000005', 'matrix.bce@test.local'),
  ('26200000-0000-0000-0000-000000000006', 'matrix.bc@test.local'),
  ('26200000-0000-0000-0000-000000000009', 'matrix.moderator@test.local'),
  ('26200000-0000-0000-0000-000000000010', 'matrix.inactive@test.local'),
  ('26200000-0000-0000-0000-000000000011', 'matrix.second@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('26200000-0000-0000-0000-000000000000', 'Matrix Recrut', 'matrix.recrut@test.local', 'recrut', 'activ'),
  ('26200000-0000-0000-0000-000000000001', 'Matrix Voluntar', 'matrix.voluntar@test.local', 'voluntar', 'activ'),
  ('26200000-0000-0000-0000-000000000002', 'Matrix Activ', 'matrix.activ@test.local', 'activ', 'activ'),
  ('26200000-0000-0000-0000-000000000003', 'Matrix Vot', 'matrix.vot@test.local', 'vot', 'activ'),
  ('26200000-0000-0000-0000-000000000004', 'Matrix Responsabil', 'matrix.responsabil@test.local', 'responsabil', 'activ'),
  ('26200000-0000-0000-0000-000000000005', 'Matrix BCE', 'matrix.bce@test.local', 'bce', 'activ'),
  ('26200000-0000-0000-0000-000000000006', 'Matrix BC', 'matrix.bc@test.local', 'bc', 'activ'),
  ('26200000-0000-0000-0000-000000000009', 'Matrix Moderator', 'matrix.moderator@test.local', 'moderator', 'activ'),
  ('26200000-0000-0000-0000-000000000010', 'Matrix Inactive', 'matrix.inactive@test.local', 'activ', 'inactiv'),
  ('26200000-0000-0000-0000-000000000011', 'Matrix Second', 'matrix.second@test.local', 'voluntar', 'activ');

insert into public.departments (id, name, short, color, kind) values
  ('262-dept', 'Matrix Department', 'M262', '#284C93', 'department');
insert into public.teams (id, name, dept_id) values
  ('262-dept-team', 'Matrix Department Team', '262-dept'),
  ('262-independent-team', 'Matrix Independent Team', null);
insert into public.member_departments (member_id, dept_id) values
  ('26200000-0000-0000-0000-000000000001', '262-dept'),
  ('26200000-0000-0000-0000-000000000011', '262-dept');
insert into public.team_members (team_id, member_id) values
  ('262-independent-team', '26200000-0000-0000-0000-000000000011');

insert into public.projects (id, name, status, leader_id, created_by)
overriding system value values (
  2620001, 'Matrix Project', 'active',
  '26200000-0000-0000-0000-000000000005',
  '26200000-0000-0000-0000-000000000005'
);

insert into public.tasks
  (title, description, deadline, group_id, status,
   difficulty, rating, created_by, created_at, completed_at)
select fixture.title, 'Matrix fixture', now() - interval '1 day',
       coalesce(pg_temp.dept_group(fixture.dept_id), pg_temp.team_group(fixture.team_id),
                pg_temp.project_group(fixture.project_id)), 'completed',
       fixture.difficulty, fixture.rating,
       '26200000-0000-0000-0000-000000000005',
       now() - interval '2 days', now()
  from (values
    ('Matrix Department Task',       '262-dept'::text, null::text,             null::bigint, 3, 4),
    ('Matrix Department Team Task',  null,             '262-dept-team',        null,         1, 5),
    ('Matrix Project Task',          null,             null,                   2620001,      3, 5),
    ('Matrix Independent Team Task', null,             '262-independent-team', null,         2, 5)
  ) as fixture(title, dept_id, team_id, project_id, difficulty, rating);

select pg_temp.test_credit_task(task.id, credit.member_id,
                                '26200000-0000-0000-0000-000000000005')
  from (values
    ('Matrix Department Task',       '26200000-0000-0000-0000-000000000001'::uuid),
    ('Matrix Department Team Task',  '26200000-0000-0000-0000-000000000011'::uuid),
    ('Matrix Project Task',          '26200000-0000-0000-0000-000000000010'::uuid),
    ('Matrix Independent Team Task', '26200000-0000-0000-0000-000000000011'::uuid)
  ) as credit(title, member_id)
  join public.tasks as task on task.title = credit.title
 order by task.id;

insert into public.points_ledger (member_id, delta, reason, note) values
  ('26200000-0000-0000-0000-000000000000', -1, 'sanction', 'matrix sanction'),
  ('26200000-0000-0000-0000-000000000001', -2, 'sanction', 'matrix sanction'),
  ('26200000-0000-0000-0000-000000000002', -3, 'sanction', 'matrix sanction'),
  ('26200000-0000-0000-0000-000000000003', -4, 'sanction', 'matrix sanction'),
  ('26200000-0000-0000-0000-000000000004', -5, 'sanction', 'matrix sanction'),
  ('26200000-0000-0000-0000-000000000005', -6, 'sanction', 'matrix sanction'),
  ('26200000-0000-0000-0000-000000000006', -7, 'sanction', 'matrix sanction'),
  ('26200000-0000-0000-0000-000000000009', -9, 'sanction', 'matrix sanction');

-- Non-vacuity: the deny matrix below names data that definitely exists.
select is((select count(*) from public.points_ledger where reason = 'task'), 4::bigint,
  'four Task ledger rows exist');
select is((select count(*) from public.points_ledger where reason = 'sanction'), 8::bigint,
  'eight persona-owned sanction rows exist');
select is((select count(*) from public.tasks where title like 'Matrix % Task'), 4::bigint,
  'all four origin fixtures exist');
select results_eq(
  $$ select count(grp.legacy_dept_id)::int, count(grp.legacy_team_id)::int, count(grp.legacy_project_id)::int
       from public.tasks as task join public.groups as grp on grp.id = task.group_id
      where task.title like 'Matrix % Task' $$,
  $$ values (1, 2, 1) $$,
  'the fixture contains one Department, two Team, and one Project Task'
);
select is((select count(*) from public.task_assignments
            where member_id = '26200000-0000-0000-0000-000000000001'), 1::bigint,
  'the drill-down target has one real Assignment');
select is((select count(*) from public.points_ledger
            where member_id = '26200000-0000-0000-0000-000000000010'
              and reason = 'task'), 1::bigint,
  'the inactive member really has Task history');
select is((select sum(entry.delta)::int
             from public.points_ledger as entry
             join public.tasks as task on task.id = entry.task_id
             join public.groups as task_group on task_group.id = task.group_id
            where entry.reason in ('task', 'task_reversal')
              and task_group.path @> array[pg_temp.dept_group('262-dept')]), 9,
  'the owned Department Cup contribution is non-vacuously 9');
select results_eq(
  $$ select member_id, sum(delta)::int from public.points_ledger
      where reason in ('task', 'task_reversal') group by member_id
      order by member_id $$,
  $$ values
      ('26200000-0000-0000-0000-000000000001'::uuid, 6),
      ('26200000-0000-0000-0000-000000000010'::uuid, 9),
      ('26200000-0000-0000-0000-000000000011'::uuid, 9) $$,
  'the three expected Task earners and their exact totals exist'
);

-- ==================== 3. Claimless and inactive identities ====================

select pg_temp.test_login('26200000-0000-0000-0000-000000000001', '{}'::jsonb);
select is((select count(*) from public.my_points), 0::bigint, 'claimless UID: no personal total');
select is((select count(*) from public.points_ledger), 0::bigint, 'claimless UID: no ledger rows');
select is((select count(*) from public.leadership_leaderboard()), 0::bigint, 'claimless UID: no Leaderboard rows');
select is((select count(*) from public.department_cup()), 0::bigint, 'claimless UID: no Cup rows');
select is((select count(*) from public.leadership_member_tasks('26200000-0000-0000-0000-000000000001')), 0::bigint,
  'claimless UID: no member drill-down rows');
reset role;

select pg_temp.test_login('26200000-0000-0000-0000-000000000010', jsonb_build_object(
  'member_role', 'activ', 'member_level', 2, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select count(*) from public.my_points), 0::bigint, 'inactive stale claims: no personal total');
select is((select count(*) from public.points_ledger), 0::bigint, 'inactive stale claims: no ledger rows');
select is((select count(*) from public.leadership_leaderboard()), 0::bigint, 'inactive stale claims: no Leaderboard rows');
select is((select count(*) from public.department_cup()), 0::bigint, 'inactive stale claims: no Cup rows');
select is((select count(*) from public.leadership_member_tasks('26200000-0000-0000-0000-000000000001')), 0::bigint,
  'inactive stale claims: no member drill-down rows');
reset role;

-- ==================== 4. Roles 0–4: own rows only ====================

select pg_temp.test_login_leadership('26200000-0000-0000-0000-000000000000');
select is((select points from public.my_points), -1, 'Recrut: exact personal total');
select is((select count(*) from public.points_ledger), 1::bigint, 'Recrut: exactly own ledger');
select is((select count(*) from public.points_ledger where member_id <> auth.uid()), 0::bigint, 'Recrut: no other ledger');
select is((select count(*) from public.leadership_leaderboard()), 0::bigint, 'Recrut: no Leaderboard');
select is((select count(*) from public.department_cup()), 0::bigint, 'Recrut: no Cup');
select is((select count(*) from public.leadership_member_tasks('26200000-0000-0000-0000-000000000001')), 0::bigint, 'Recrut: no drill-down');
reset role;

select pg_temp.test_login_leadership('26200000-0000-0000-0000-000000000001');
select is((select points from public.my_points), 4, 'Voluntar: Task plus sanction personal total');
select is((select count(*) from public.points_ledger), 2::bigint, 'Voluntar: exactly two own ledger rows');
select is((select count(*) from public.points_ledger where member_id <> auth.uid()), 0::bigint, 'Voluntar: no other ledger');
select is((select count(*) from public.leadership_leaderboard()), 0::bigint, 'Voluntar: no Leaderboard');
select is((select count(*) from public.department_cup()), 0::bigint, 'Voluntar: no Cup');
select is((select count(*) from public.leadership_member_tasks('26200000-0000-0000-0000-000000000011')), 0::bigint, 'Voluntar: no drill-down');
reset role;

select pg_temp.test_login_leadership('26200000-0000-0000-0000-000000000002');
select is((select points from public.my_points), -3, 'Membru Activ: exact personal total');
select is((select count(*) from public.points_ledger), 1::bigint, 'Membru Activ: exactly own ledger');
select is((select count(*) from public.points_ledger where member_id <> auth.uid()), 0::bigint, 'Membru Activ: no other ledger');
select is((select count(*) from public.leadership_leaderboard()), 0::bigint, 'Membru Activ: no Leaderboard');
select is((select count(*) from public.department_cup()), 0::bigint, 'Membru Activ: no Cup');
select is((select count(*) from public.leadership_member_tasks('26200000-0000-0000-0000-000000000001')), 0::bigint, 'Membru Activ: no drill-down');
reset role;

select pg_temp.test_login_leadership('26200000-0000-0000-0000-000000000003');
select is((select points from public.my_points), -4, 'Membru cu Drept de Vot: exact personal total');
select is((select count(*) from public.points_ledger), 1::bigint, 'Membru cu Drept de Vot: exactly own ledger');
select is((select count(*) from public.points_ledger where member_id <> auth.uid()), 0::bigint, 'Membru cu Drept de Vot: no other ledger');
select is((select count(*) from public.leadership_leaderboard()), 0::bigint, 'Membru cu Drept de Vot: no Leaderboard');
select is((select count(*) from public.department_cup()), 0::bigint, 'Membru cu Drept de Vot: no Cup');
select is((select count(*) from public.leadership_member_tasks('26200000-0000-0000-0000-000000000001')), 0::bigint, 'Membru cu Drept de Vot: no drill-down');
reset role;

select pg_temp.test_login_leadership('26200000-0000-0000-0000-000000000004');
select is((select points from public.my_points), -5, 'Responsabil: exact personal total');
select is((select count(*) from public.points_ledger), 1::bigint, 'Responsabil: exactly own ledger');
select is((select count(*) from public.points_ledger where member_id <> auth.uid()), 0::bigint, 'Responsabil: no other ledger');
select is((select count(*) from public.leadership_leaderboard()), 0::bigint, 'Responsabil: no Leaderboard');
select is((select count(*) from public.department_cup()), 0::bigint, 'Responsabil: no Cup');
select is((select count(*) from public.leadership_member_tasks('26200000-0000-0000-0000-000000000001')), 0::bigint, 'Responsabil: no drill-down');
reset role;

-- ==================== 5. BCE, BC, Moderator: exact leadership boundary ====================

select pg_temp.test_login_leadership('26200000-0000-0000-0000-000000000005');
select is((select points from public.my_points), -6, 'BCE: personal total remains caller-only');
select is((select count(*) from public.points_ledger), 12::bigint, 'BCE: complete global ledger');
select results_eq(
  $$ select full_name, points, rank from public.leadership_leaderboard() $$,
  $$ values ('Matrix Inactive'::text, 9, 1), ('Matrix Second', 9, 1), ('Matrix Voluntar', 6, 3) $$,
  'BCE: exact Task-only Leaderboard, including inactive earner'
);
select is((select points from public.department_cup() where group_id = pg_temp.dept_group('262-dept')), 9, 'BCE: exact Department Cup total');
select is((select count(*) from public.leadership_member_tasks('26200000-0000-0000-0000-000000000001')), 1::bigint, 'BCE: member drill-down row');
select is((select count(*) from public.points_ledger where member_id = '26200000-0000-0000-0000-000000000000'), 1::bigint, 'BCE: another member ledger row is visible');
reset role;

select pg_temp.test_login_leadership('26200000-0000-0000-0000-000000000006');
select is((select points from public.my_points), -7, 'BC: personal total remains caller-only');
select is((select count(*) from public.points_ledger), 12::bigint, 'BC: complete global ledger');
select results_eq(
  $$ select full_name, points, rank from public.leadership_leaderboard() $$,
  $$ values ('Matrix Inactive'::text, 9, 1), ('Matrix Second', 9, 1), ('Matrix Voluntar', 6, 3) $$,
  'BC: exact Task-only Leaderboard'
);
select is((select points from public.department_cup() where group_id = pg_temp.dept_group('262-dept')), 9, 'BC: exact Department Cup total');
select is((select count(*) from public.leadership_member_tasks('26200000-0000-0000-0000-000000000001')), 1::bigint, 'BC: member drill-down row');
select is((select count(*) from public.points_ledger where member_id = '26200000-0000-0000-0000-000000000000'), 1::bigint, 'BC: another member ledger row is visible');
reset role;

select pg_temp.test_login_leadership('26200000-0000-0000-0000-000000000009');
select is((select points from public.my_points), -9, 'Moderator: personal total remains caller-only');
select is((select count(*) from public.points_ledger), 12::bigint, 'Moderator: complete global ledger');
select results_eq(
  $$ select full_name, points, rank from public.leadership_leaderboard() $$,
  $$ values ('Matrix Inactive'::text, 9, 1), ('Matrix Second', 9, 1), ('Matrix Voluntar', 6, 3) $$,
  'Moderator: exact Task-only Leaderboard'
);
select is((select points from public.department_cup() where group_id = pg_temp.dept_group('262-dept')), 9, 'Moderator: exact Department Cup total');
select is((select count(*) from public.leadership_member_tasks('26200000-0000-0000-0000-000000000001')), 1::bigint, 'Moderator: member drill-down row');
select is((select count(*) from public.points_ledger where member_id = '26200000-0000-0000-0000-000000000000'), 1::bigint, 'Moderator: another member ledger row is visible');
reset role;

-- ==================== 6. Anonymous and service-role boundaries ====================

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select * from public.my_points $$, '42501', null, 'anonymous: my_points denied');
select throws_ok($$ select * from public.points_ledger $$, '42501', null, 'anonymous: ledger denied');
select throws_ok($$ select * from public.leadership_leaderboard() $$, '42501', null, 'anonymous: Leaderboard execute denied');
select throws_ok($$ select * from public.department_cup() $$, '42501', null, 'anonymous: Cup execute denied');
select throws_ok($$ select * from public.leadership_member_tasks('26200000-0000-0000-0000-000000000001') $$,
  '42501', null, 'anonymous: member drill-down execute denied');
reset role;

select pg_temp.test_clear_jwt();
set local role service_role;
select is((select count(*) from public.my_points), 0::bigint,
  'service_role: explicitly granted personal view still returns no caller row without membership claims');
select is((select count(*) from public.points_ledger), 12::bigint,
  'service_role: explicit table grant plus BYPASSRLS reaches the complete ledger');
select throws_ok($$ select * from public.leadership_leaderboard() $$, '42501', null,
  'service_role: no accidental Leaderboard wrapper bypass');
select throws_ok($$ select * from public.department_cup() $$, '42501', null,
  'service_role: no accidental Cup wrapper bypass');
select throws_ok($$ select * from public.leadership_member_tasks('26200000-0000-0000-0000-000000000001') $$,
  '42501', null, 'service_role: no accidental drill-down wrapper bypass');
reset role;


-- #521: Group authority regression matrix.
\ir _group_task_fixtures.psql
insert into public.points_ledger(member_id,delta,reason,note,awarded_by)
select pg_temp.g521_uid(n),-1,'sanction','Own ledger #521',pg_temp.g521_uid(1) from generate_series(2,5) n;
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select is((select count(*) from public.points_ledger where member_id<>pg_temp.g521_uid(2)),0::bigint,'Group persona 2 sees no other Member ledger');
select is((select count(*) from public.points_ledger where member_id=pg_temp.g521_uid(2)),1::bigint,'Group persona 2 retains own ledger');
select is((select count(*) from public.leadership_leaderboard()),0::bigint,'Group persona 2 does not gain leadership ranking');
select is((select count(*) from public.department_cup()),0::bigint,'Group persona 2 does not gain Department Cup');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select is((select count(*) from public.points_ledger where member_id<>pg_temp.g521_uid(3)),0::bigint,'Group persona 3 sees no other Member ledger');
select is((select count(*) from public.points_ledger where member_id=pg_temp.g521_uid(3)),1::bigint,'Group persona 3 retains own ledger');
select is((select count(*) from public.leadership_leaderboard()),0::bigint,'Group persona 3 does not gain leadership ranking');
select is((select count(*) from public.department_cup()),0::bigint,'Group persona 3 does not gain Department Cup');
reset role;

select * from finish();
rollback;
