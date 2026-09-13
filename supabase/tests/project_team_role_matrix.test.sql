-- #281: one cross-scope authorization matrix for Projects, Department Teams,
-- and Independent Teams. Fixtures are owned by this suite and seed-independent.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(36);

insert into auth.users (id, email) values
  ('a2810000-0000-0000-0000-000000000000', 'recrut.matrix@test.local'),
  ('a2810000-0000-0000-0000-000000000001', 'voluntar.matrix@test.local'),
  ('a2810000-0000-0000-0000-000000000002', 'activ.matrix@test.local'),
  ('a2810000-0000-0000-0000-000000000003', 'vot.matrix@test.local'),
  ('a2810000-0000-0000-0000-000000000004', 'responsabil.matrix@test.local'),
  ('a2810000-0000-0000-0000-000000000005', 'bce.local.matrix@test.local'),
  ('a2810000-0000-0000-0000-000000000006', 'bce.foreign.matrix@test.local'),
  ('a2810000-0000-0000-0000-000000000007', 'bc.matrix@test.local'),
  ('a2810000-0000-0000-0000-000000000008', 'moderator.matrix@test.local'),
  ('a2810000-0000-0000-0000-000000000009', 'inactive.matrix@test.local'),
  ('a2810000-0000-0000-0000-000000000010', 'claimless.matrix@test.local'),
  ('a2810000-0000-0000-0000-000000000011', 'target.matrix@test.local');

insert into profiles (id, full_name, email, role, status) values
  ('a2810000-0000-0000-0000-000000000000', 'Matrix Recrut', 'recrut.matrix@test.local', 'recrut', 'activ'),
  ('a2810000-0000-0000-0000-000000000001', 'Matrix Voluntar', 'voluntar.matrix@test.local', 'voluntar', 'activ'),
  ('a2810000-0000-0000-0000-000000000002', 'Matrix Activ', 'activ.matrix@test.local', 'activ', 'activ'),
  ('a2810000-0000-0000-0000-000000000003', 'Matrix Vot', 'vot.matrix@test.local', 'vot', 'activ'),
  ('a2810000-0000-0000-0000-000000000004', 'Matrix Responsabil', 'responsabil.matrix@test.local', 'responsabil', 'activ'),
  ('a2810000-0000-0000-0000-000000000005', 'Matrix Local BCE', 'bce.local.matrix@test.local', 'bce', 'activ'),
  ('a2810000-0000-0000-0000-000000000006', 'Matrix Foreign BCE', 'bce.foreign.matrix@test.local', 'bce', 'activ'),
  ('a2810000-0000-0000-0000-000000000007', 'Matrix BC', 'bc.matrix@test.local', 'bc', 'activ'),
  ('a2810000-0000-0000-0000-000000000008', 'Matrix Moderator', 'moderator.matrix@test.local', 'moderator', 'activ'),
  ('a2810000-0000-0000-0000-000000000009', 'Matrix Inactive BC', 'inactive.matrix@test.local', 'bc', 'inactiv'),
  ('a2810000-0000-0000-0000-000000000010', 'Matrix Claimless', 'claimless.matrix@test.local', 'voluntar', 'activ'),
  ('a2810000-0000-0000-0000-000000000011', 'Matrix Target', 'target.matrix@test.local', 'voluntar', 'activ');

insert into member_departments (member_id, dept_id) values
  ('a2810000-0000-0000-0000-000000000005', 'edu'),
  ('a2810000-0000-0000-0000-000000000006', 'pr');

insert into projects (name, status, leader_id, created_by) values
  ('Matrix Active #281', 'active', 'a2810000-0000-0000-0000-000000000004', 'a2810000-0000-0000-0000-000000000007'),
  ('Matrix Archived #281', 'archived', 'a2810000-0000-0000-0000-000000000004', 'a2810000-0000-0000-0000-000000000007');

insert into project_members (project_id, member_id, project_role)
select project.id, member_id, 'member'
  from projects as project
 cross join (values
   ('a2810000-0000-0000-0000-000000000000'::uuid),
   ('a2810000-0000-0000-0000-000000000002'::uuid),
   ('a2810000-0000-0000-0000-000000000010'::uuid)
 ) as members(member_id)
 where project.name in ('Matrix Active #281', 'Matrix Archived #281');

insert into teams (id, name, dept_id) values
  ('dept-edu-281', 'Matrix EDU Team #281', 'edu'),
  ('dept-pr-281', 'Matrix PR Team #281', 'pr'),
  ('independent-281', 'Matrix Independent Team #281', null);
insert into team_members (team_id, member_id) values
  ('dept-edu-281', 'a2810000-0000-0000-0000-000000000000'),
  ('independent-281', 'a2810000-0000-0000-0000-000000000001'),
  ('dept-pr-281', 'a2810000-0000-0000-0000-000000000002'),
  ('dept-edu-281', 'a2810000-0000-0000-0000-000000000010'),
  ('independent-281', 'a2810000-0000-0000-0000-000000000011');

create temp table fx as
select max(id) filter (where name = 'Matrix Active #281') active_project_id,
       max(id) filter (where name = 'Matrix Archived #281') archived_project_id
  from projects;
grant select on fx to authenticated;

-- Roles 0-3: organizational level alone grants no cross-scope access.
select pg_temp.test_login_leadership('a2810000-0000-0000-0000-000000000000');
select is((select count(*) from projects where name like 'Matrix % #281'), 2::bigint,
  'level 0 Project member reads active and archived memberships');
select is((select array_agg(id order by id) from teams where id like '%-281'),
  array['dept-edu-281']::text[], 'level 0 Team member reads only their Department Team');
reset role;

select pg_temp.test_login_leadership('a2810000-0000-0000-0000-000000000001');
select is((select count(*) from projects where name like 'Matrix % #281'), 0::bigint,
  'level 1 nonmember reads no Project');
select is((select array_agg(id order by id) from teams where id like '%-281'),
  array['independent-281']::text[], 'level 1 Team member reads only their Independent Team');
reset role;

select pg_temp.test_login_leadership('a2810000-0000-0000-0000-000000000002');
select is((select count(*) from projects where name like 'Matrix % #281'), 2::bigint,
  'level 2 Project member reads active and archived memberships');
select is((select array_agg(id order by id) from teams where id like '%-281'),
  array['dept-pr-281']::text[], 'level 2 Team member reads only their Team');
reset role;

select pg_temp.test_login_leadership('a2810000-0000-0000-0000-000000000003');
select is((select count(*) from projects where name like 'Matrix % #281'), 0::bigint,
  'level 3 nonmember reads no Project');
select is((select count(*) from teams where id like '%-281'), 0::bigint,
  'level 3 nonmember reads no Team');
reset role;

-- Responsabil and BCE retain local authority rather than global level power.
select pg_temp.test_login_leadership('a2810000-0000-0000-0000-000000000004');
select is((select count(*) from projects where name like 'Matrix % #281'), 2::bigint,
  'Responsabil Project lead reads active and archived Projects');
select is((select count(*) from teams where id like '%-281'), 0::bigint,
  'Responsabil without Team membership reads no Team');
select is((public.add_project_member((select active_project_id from fx),
  'a2810000-0000-0000-0000-000000000011')).project_role, 'member',
  'Project lead manages their active Project roster');
reset role;

select pg_temp.test_login_leadership('a2810000-0000-0000-0000-000000000005');
select is((select count(*) from projects where name like 'Matrix % #281'), 0::bigint,
  'local BCE has no global Project read');
select is((select array_agg(id order by id) from teams where id like '%-281'),
  array['dept-edu-281']::text[], 'local BCE reads only Teams in their Department');
select is((public.add_department_team_member('dept-edu-281',
  'a2810000-0000-0000-0000-000000000011')).team_id, 'dept-edu-281',
  'local BCE manages their Department Team roster');
select throws_ok($$select public.add_independent_team_member('independent-281',
  'a2810000-0000-0000-0000-000000000003')$$, '42501',
  'independent_team_membership_forbidden', 'local BCE cannot manage an Independent Team');
select throws_ok($$select public.add_project_member((select active_project_id from fx),
  'a2810000-0000-0000-0000-000000000003')$$, '42501',
  'project_lead_forbidden', 'local BCE cannot manage a Project they do not lead');
reset role;

select pg_temp.test_login_leadership('a2810000-0000-0000-0000-000000000006');
select is((select array_agg(id order by id) from teams where id like '%-281'),
  array['dept-pr-281']::text[], 'foreign BCE reads only their own Department Teams');
select throws_ok($$select public.remove_department_team_member('dept-edu-281',
  'a2810000-0000-0000-0000-000000000011')$$, '42501',
  'department_team_membership_forbidden', 'foreign BCE cannot manage another Department Team');
reset role;
select is((select count(*) from team_members where team_id = 'dept-edu-281'
  and member_id = 'a2810000-0000-0000-0000-000000000011'), 1::bigint,
  'foreign BCE denial leaves the existing Department-Team roster row unchanged');

-- BC and Moderator have global read and command override.
select pg_temp.test_login('a2810000-0000-0000-0000-000000000007',
  '{"member_role":"voluntar","member_level":1,"dept_ids":[],"team_ids":[]}'::jsonb);
select is((select count(*) from projects where name like 'Matrix % #281'), 2::bigint,
  'live BC reads all Projects despite stale low JWT claims');
select is((select count(*) from teams where id like '%-281'), 3::bigint,
  'live BC reads all Team kinds despite stale low JWT claims');
select is(public.remove_project_member((select active_project_id from fx),
  'a2810000-0000-0000-0000-000000000011'), true,
  'BC manages a Project roster globally');
select is(public.remove_department_team_member('dept-edu-281',
  'a2810000-0000-0000-0000-000000000011'), true,
  'BC manages a Department Team roster globally');
select is(public.remove_independent_team_member('independent-281',
  'a2810000-0000-0000-0000-000000000011'), true,
  'BC manages an Independent Team roster globally');
reset role;

select pg_temp.test_login_leadership('a2810000-0000-0000-0000-000000000008');
select is((select count(*) from projects where name like 'Matrix % #281'), 2::bigint,
  'Moderator reads all active and archived Projects');
select is((select count(*) from teams where id like '%-281'), 3::bigint,
  'Moderator reads all Team kinds');
reset role;

-- Live state defeats stale claims; claimless and anonymous identities get none.
insert into team_members (team_id, member_id) values
  ('independent-281', 'a2810000-0000-0000-0000-000000000011');
select pg_temp.test_login('a2810000-0000-0000-0000-000000000009',
  '{"member_role":"bc","member_level":6,"dept_ids":["edu"],"team_ids":["dept-edu-281"]}'::jsonb);
select is((select count(*) from projects where name like 'Matrix % #281'), 0::bigint,
  'inactive BC reads no Project despite stale leadership claims');
select is((select count(*) from teams where id like '%-281'), 0::bigint,
  'inactive BC reads no Team despite stale leadership claims');
select throws_ok($$select public.remove_independent_team_member('independent-281',
  'a2810000-0000-0000-0000-000000000011')$$, '42501',
  'independent_team_membership_forbidden', 'inactive BC cannot mutate a proven Team roster row');
reset role;

select pg_temp.test_login('a2810000-0000-0000-0000-000000000010',
  jsonb_build_object('provider', 'email'));
select is((select count(*) from projects where name like 'Matrix % #281'), 0::bigint,
  'claimless Project member reads no Project');
select is((select count(*) from teams where id like '%-281'), 0::bigint,
  'claimless Team member reads no Team');
reset role;

set local role anon;
select throws_ok($$select count(*) from projects$$, '42501', null,
  'anonymous cannot read Projects');
select throws_ok($$select count(*) from teams$$, '42501', null,
  'anonymous cannot read Teams');
reset role;

-- Prove denied writes targeted real rows and did not pass vacuously.
select is((select count(*) from team_members where team_id = 'independent-281'
  and member_id = 'a2810000-0000-0000-0000-000000000011'), 1::bigint,
  'inactive BC denial leaves the restored Independent-Team roster row unchanged');
select is((select count(*) from projects where name like 'Matrix % #281'), 2::bigint,
  'the suite owns both active and archived Project fixtures');
select is((select count(*) from teams where id like '%-281'), 3::bigint,
  'the suite owns both Department Teams and its Independent Team');

select * from finish();
rollback;
