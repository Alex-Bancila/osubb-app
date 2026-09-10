-- team_policies.test.sql — issue #280: scoped Team and roster access.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(28);

insert into auth.users (id, email) values
  ('28000000-0000-0000-0000-000000000001', 'member.280@test.local'),
  ('28000000-0000-0000-0000-000000000002', 'outsider.280@test.local'),
  ('28000000-0000-0000-0000-000000000003', 'bce.edu.280@test.local'),
  ('28000000-0000-0000-0000-000000000004', 'bce.pr.280@test.local'),
  ('28000000-0000-0000-0000-000000000005', 'bc.280@test.local'),
  ('28000000-0000-0000-0000-000000000006', 'inactive.280@test.local'),
  ('28000000-0000-0000-0000-000000000007', 'moderator.280@test.local');

insert into profiles (id, full_name, email, role, status) values
  ('28000000-0000-0000-0000-000000000001', 'Team Recruit', 'member.280@test.local', 'recrut', 'activ'),
  ('28000000-0000-0000-0000-000000000002', 'Team Outsider', 'outsider.280@test.local', 'voluntar', 'activ'),
  ('28000000-0000-0000-0000-000000000003', 'EDU BCE', 'bce.edu.280@test.local', 'bce', 'activ'),
  ('28000000-0000-0000-0000-000000000004', 'PR BCE', 'bce.pr.280@test.local', 'bce', 'activ'),
  ('28000000-0000-0000-0000-000000000005', 'Global BC', 'bc.280@test.local', 'bc', 'activ'),
  ('28000000-0000-0000-0000-000000000006', 'Inactive BC', 'inactive.280@test.local', 'bc', 'inactiv'),
  ('28000000-0000-0000-0000-000000000007', 'Moderator', 'moderator.280@test.local', 'moderator', 'activ');

insert into member_departments (member_id, dept_id) values
  ('28000000-0000-0000-0000-000000000001', 'edu'),
  ('28000000-0000-0000-0000-000000000002', 'edu'),
  ('28000000-0000-0000-0000-000000000003', 'edu'),
  ('28000000-0000-0000-0000-000000000004', 'pr');

insert into teams (id, name, dept_id) values
  ('team-own-280', 'Own EDU Team', 'edu'),
  ('team-other-edu-280', 'Other EDU Team', 'edu'),
  ('team-pr-280', 'PR Team', 'pr'),
  ('team-independent-280', 'Independent Team', null);
insert into team_members (team_id, member_id) values
  ('team-own-280', '28000000-0000-0000-0000-000000000001'),
  ('team-own-280', '28000000-0000-0000-0000-000000000002'),
  ('team-other-edu-280', '28000000-0000-0000-0000-000000000002'),
  ('team-independent-280', '28000000-0000-0000-0000-000000000001');

select pg_temp.test_login_leadership('28000000-0000-0000-0000-000000000001');
select is((select array_agg(id order by id) from teams where id like '%-280'),
  array['team-independent-280','team-own-280'], 'ordinary member reads only their own Teams');
select is((select count(*) from team_members where team_id = 'team-own-280'), 2::bigint,
  'ordinary member reads the complete roster of their Team');
select is((select count(*) from team_members where team_id = 'team-other-edu-280'), 0::bigint,
  'ordinary member cannot discover another Team in their Department');
select throws_ok($$insert into teams (id, name, dept_id) values ('member-new-280','No','edu')$$,
  '42501', null, 'ordinary member cannot create a Team');
select throws_ok($$insert into team_members (team_id, member_id) values
  ('team-own-280','28000000-0000-0000-0000-000000000003')$$,
  '42501', null, 'ordinary member cannot directly add a roster row');
select throws_ok($$update team_members set member_id='28000000-0000-0000-0000-000000000003'
  where team_id='team-own-280' and member_id='28000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'ordinary member cannot directly update a roster row');
select throws_ok($$delete from team_members
  where team_id='team-own-280' and member_id='28000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'ordinary member cannot directly delete a roster row');
reset role;

delete from team_members
 where team_id = 'team-independent-280'
   and member_id = '28000000-0000-0000-0000-000000000001';
select pg_temp.test_login('28000000-0000-0000-0000-000000000001',
  '{"member_role":"recrut","member_level":0,"dept_ids":["edu"],"team_ids":["team-own-280","team-independent-280"]}'::jsonb);
select is((select array_agg(id order by id) from teams where id like '%-280'),
  array['team-own-280'], 'removed Team membership revokes reads despite stale Team claims');
reset role;

select pg_temp.test_login_leadership('28000000-0000-0000-0000-000000000003');
select is((select array_agg(id order by id) from teams where id like '%-280'),
  array['team-other-edu-280','team-own-280'], 'local BCE reads every Team in their Department');
select is((select count(*) from team_members where team_id = 'team-own-280'), 2::bigint,
  'local BCE reads complete rosters in their Department');
with inserted as (
  insert into teams (id, name, dept_id) values ('bce-new-280','BCE Team','edu') returning id
)
select is((select id from inserted), 'bce-new-280'::text,
  'local BCE creates and receives their Department Team');
select throws_ok($$insert into teams (id, name, dept_id) values ('bce-pr-280','No','pr')$$,
  '42501', null, 'local BCE cannot create another Department Team');
select throws_ok($$insert into teams (id, name) values ('bce-independent-280','No')$$,
  '42501', null, 'local BCE cannot create an Independent Team');
reset role;

delete from member_departments
 where member_id = '28000000-0000-0000-0000-000000000003'
   and dept_id = 'edu';
select pg_temp.test_login('28000000-0000-0000-0000-000000000003',
  '{"member_role":"bce","member_level":5,"dept_ids":["edu"],"team_ids":[]}'::jsonb);
select is((select count(*) from teams where id like '%-280'), 0::bigint,
  'removed BCE Department membership revokes reads despite stale claims');
select throws_ok($$insert into teams (id, name, dept_id) values ('stale-bce-280','No','edu')$$,
  '42501', null, 'removed BCE Department membership revokes Team creation');
reset role;

select pg_temp.test_login_leadership('28000000-0000-0000-0000-000000000005');
select is((select count(*) from teams where id like '%-280'), 5::bigint,
  'BC reads all Team kinds');
select is((select count(*) from team_members where team_id in ('team-own-280','team-other-edu-280')), 3::bigint,
  'BC reads all Team rosters');
with inserted as (
  insert into teams (id, name) values ('bc-independent-280','BC Independent') returning id
)
select is((select id from inserted), 'bc-independent-280'::text,
  'BC creates and receives an Independent Team');
select lives_ok($$insert into teams (id, name, dept_id) values ('bc-dept-280','BC Department','pr')$$,
  'BC creates a Department Team');
reset role;

select pg_temp.test_login_leadership('28000000-0000-0000-0000-000000000007');
select is((select count(*) from teams where id like '%-280'), 7::bigint,
  'Moderator reads all Team kinds');
select lives_ok($$insert into teams (id, name) values ('moderator-independent-280','Moderator Independent')$$,
  'Moderator creates an Independent Team');
reset role;

select pg_temp.test_login('28000000-0000-0000-0000-000000000006',
  '{"member_role":"bc","member_level":6,"dept_ids":[],"team_ids":[]}'::jsonb);
select is((select count(*) from teams where id like '%-280'), 0::bigint,
  'inactive member cannot read Teams despite stale leadership claims');
select throws_ok($$insert into teams (id, name) values ('inactive-new-280','No')$$,
  '42501', null, 'inactive member cannot create despite stale leadership claims');
reset role;

select pg_temp.test_clear_jwt();
set local role authenticated;
select is((select count(*) from teams where id like '%-280'), 0::bigint,
  'claimless authenticated identity cannot read Teams');
select is((select count(*) from team_members where team_id like '%-280'), 0::bigint,
  'claimless authenticated identity cannot read Team rosters');
select throws_ok($$insert into teams (id, name) values ('claimless-new-280','No')$$,
  '42501', null, 'claimless authenticated identity cannot create Teams');
reset role;

select pg_temp.test_login('28000000-0000-0000-0000-000000000002', '{}'::jsonb);
select is((select count(*) from teams where id like '%-280'), 0::bigint,
  'real authenticated uid without organization claims cannot read Teams');
reset role;

set local role anon;
select throws_ok($$select count(*) from teams$$, '42501', null,
  'anonymous identity has no Team access');
reset role;

select * from finish();
rollback;
