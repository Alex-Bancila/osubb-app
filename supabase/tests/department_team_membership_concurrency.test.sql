-- #279: real concurrent duplicate membership commands serialize per Team.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(10);

select extensions.dblink_connect('team_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
-- #621: committed fixtures from an interrupted run must not hang cleanup.
select extensions.dblink_exec('team_setup', 'set lock_timeout = ''2s''');
select extensions.dblink_exec('team_setup', $$
  delete from public.teams where id = 'concurrent-department-team-279';
  delete from public.member_departments where member_id = '27900000-0000-0000-0000-000000000020';
  delete from auth.users where id in (
    '27900000-0000-0000-0000-000000000020',
    '27900000-0000-0000-0000-000000000021');
  insert into auth.users (id, email) values
    ('27900000-0000-0000-0000-000000000020', 'concurrent.edu.bce.dteam@test.local'),
    ('27900000-0000-0000-0000-000000000021', 'concurrent.target.dteam@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('27900000-0000-0000-0000-000000000020', 'Concurrent EDU BCE Team',
     'concurrent.edu.bce.dteam@test.local', 'bce', 'activ'),
    ('27900000-0000-0000-0000-000000000021', 'Concurrent Target Team',
     'concurrent.target.dteam@test.local', 'voluntar', 'activ');
  insert into public.member_departments (member_id, dept_id)
  values ('27900000-0000-0000-0000-000000000020', 'edu');
  insert into public.teams (id, name, dept_id)
  values ('concurrent-department-team-279', 'Concurrent Department Team #279', 'edu');
$$);

-- A direct probe retains the structural assertion that even a no-op command
-- locks its Team row. The shared harness owns the two-statement races below.
select extensions.dblink_connect('team_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('team_lock', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('team_lock', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub','27900000-0000-0000-0000-000000000020','role','authenticated',
    'app_metadata',jsonb_build_object('member_role','bce','member_level',5))::text,true)
$$) as claims(setting text);
select extensions.dblink_exec('team_lock', 'set local role authenticated');
select * from extensions.dblink('team_lock', $$
  select public.remove_department_team_member(
    'concurrent-department-team-279',
    '27900000-0000-0000-0000-009999999999')
$$) as no_op_remove(removed boolean);
select ok(coalesce((
  select 'For Update' = any(row_lock.modes)
    from extensions.pgrowlocks('public.teams') as row_lock
    join public.teams as team on team.ctid = row_lock.locked_row
   where team.id = 'concurrent-department-team-279'
), false), 'even a no-op command holds the Team row FOR UPDATE');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.member_departments') as row_lock
    join public.member_departments as membership on membership.ctid = row_lock.locked_row
   where membership.member_id = '27900000-0000-0000-0000-000000000020'
     and membership.dept_id = 'edu'
), false), 'a BCE command holds its Department membership FOR SHARE');
select extensions.dblink_exec('team_lock', 'rollback');
select extensions.dblink_disconnect('team_lock');

select pg_temp.test_login(
  '27900000-0000-0000-0000-000000000020',
  jsonb_build_object('member_role','bce','member_level',5));
reset role;

create temp table add_race as
select * from pg_temp.test_race(
  $$ select (public.add_department_team_member(
       'concurrent-department-team-279',
       '27900000-0000-0000-0000-000000000021')).member_id::text $$,
  $$ select (public.add_department_team_member(
       'concurrent-department-team-279',
       '27900000-0000-0000-0000-000000000021')).member_id::text $$
);
select is((select result_a from add_race),
  '27900000-0000-0000-0000-000000000021', 'the first add succeeds');
select ok((select b_waited from add_race), 'the duplicate add waits on the Team lock');
select is((select result_b from add_race),
  '27900000-0000-0000-0000-000000000021',
  'the waiting add returns the existing membership');
select is((select membership_count from extensions.dblink('team_setup', $$
  select count(*) from public.team_members
   where team_id='concurrent-department-team-279'
     and member_id='27900000-0000-0000-0000-000000000021'
$$) as result(membership_count bigint)), 1::bigint,
  'concurrent duplicate adds commit exactly one row');

create temp table remove_race as
select * from pg_temp.test_race(
  $$ select public.remove_department_team_member(
       'concurrent-department-team-279',
       '27900000-0000-0000-0000-000000000021')::text $$,
  $$ select public.remove_department_team_member(
       'concurrent-department-team-279',
       '27900000-0000-0000-0000-000000000021')::text $$
);
select is((select result_a from remove_race), 'true',
  'the first remove reports the deleted row');
select ok((select b_waited from remove_race), 'the duplicate remove waits on the Team lock');
select is((select result_b from remove_race), 'false',
  'the waiting remove reports the committed absence');
select is((select membership_count from extensions.dblink('team_setup', $$
  select count(*) from public.team_members
   where team_id='concurrent-department-team-279'
     and member_id='27900000-0000-0000-0000-000000000021'
$$) as result(membership_count bigint)), 0::bigint,
  'concurrent duplicate removes leave no row');

select extensions.dblink_exec('team_setup', $$
  delete from public.teams where id = 'concurrent-department-team-279';
  delete from public.member_departments where member_id = '27900000-0000-0000-0000-000000000020';
  delete from auth.users where id in (
    '27900000-0000-0000-0000-000000000020',
    '27900000-0000-0000-0000-000000000021');
$$);
select extensions.dblink_disconnect('team_setup');

select * from finish();
rollback;
