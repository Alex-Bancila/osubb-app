-- #627: a Task move must hold an already-rostered Executor's live Level until
-- commit. This fails if the pre-consequence Profile lock is removed, since
-- the Appointment core never runs for an existing target Group member.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(4);

select extensions.dblink_connect('task_627_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres', current_database()));
select extensions.dblink_exec('task_627_setup', 'set lock_timeout = ''2s''');
select extensions.dblink_exec('task_627_setup', $setup$
  drop function if exists public.test_627_demote();
  set session_replication_role = 'replica';
  delete from public.task_activity where task_id in (select id from public.tasks where title='Race task #627');
  set session_replication_role = 'origin';
  delete from public.notifications where task_id in (select id from public.tasks where title='Race task #627')
    or member_id in ('62700000-0000-0000-0000-000000000090','62700000-0000-0000-0000-000000000091');
  delete from public.task_assignments where task_id in (select id from public.tasks where title='Race task #627');
  delete from public.tasks where title='Race task #627';
  delete from public.group_members where group_id in (select id from public.groups where name='Race Group #627');
  delete from public.groups where name='Race Group #627';
  set session_replication_role = 'replica';
  delete from public.role_history where member_id in ('62700000-0000-0000-0000-000000000090','62700000-0000-0000-0000-000000000091');
  set session_replication_role = 'origin';
  delete from auth.users where id in ('62700000-0000-0000-0000-000000000090','62700000-0000-0000-0000-000000000091');
  insert into auth.users(id,email) values
    ('62700000-0000-0000-0000-000000000090','bc.race.627@test.local'),
    ('62700000-0000-0000-0000-000000000091','executor.race.627@test.local');
  insert into public.profiles(id,full_name,email,role,status) values
    ('62700000-0000-0000-0000-000000000090','Race BC 627','bc.race.627@test.local','bc','activ'),
    ('62700000-0000-0000-0000-000000000091','Race Executor 627','executor.race.627@test.local','bce','activ');
  insert into public.groups(name,category,min_level,created_by)
    values ('Race Group #627','department',2,'62700000-0000-0000-0000-000000000090');
  insert into public.group_members(group_id,member_id,group_role)
    values ((select id from public.groups where name='Race Group #627'),
      '62700000-0000-0000-0000-000000000091','member');
  insert into public.tasks(title,description,deadline,group_id,status,started_at,audience,assignment_mode,kind,created_by,created_at)
    values ('Race task #627','Before move',now()+interval '2 days',
      (select id from public.groups where legacy_dept_id='edu'),
      'in_progress',now()-interval '1 hour','local','direct','task','62700000-0000-0000-0000-000000000090',now()-interval '2 hours');
  insert into public.task_assignments(task_id,member_id,assigned_by)
    values ((select id from public.tasks where title='Race task #627'),
      '62700000-0000-0000-0000-000000000091','62700000-0000-0000-0000-000000000090');
  -- A direct non-key Role UPDATE isolates the Profile FOR SHARE lock.
  -- The production Role command takes additional locks that could mask it.
  create or replace function public.test_627_demote() returns text
  language sql security definer set search_path='' as $body$
    update public.profiles set role='voluntar'
     where id='62700000-0000-0000-0000-000000000091' returning role::text
  $body$;
  revoke execute on function public.test_627_demote() from public,anon,authenticated,service_role;
  grant execute on function public.test_627_demote() to authenticated;
$setup$);

select pg_temp.test_login('62700000-0000-0000-0000-000000000090',
  '{"member_role":"bc","member_level":6}');
reset role;
create temp table race_627 as select * from pg_temp.test_race(
  $q$select (public.update_task(
    (select id from public.tasks where title='Race task #627'),
    (select id from public.groups where name='Race Group #627'),
    'Race task #627', 'Before move',
    (select deadline from public.tasks where title='Race task #627'),
    null,'direct','local',null,null,true)).status::text$q$,
  'select public.test_627_demote()');
select is((select result_a from race_627),'in_progress',
  'move keeps already-rostered eligible Executor assigned before demotion');
select ok((select b_waited from race_627),
  'concurrent Profile Role demotion waits for move eligibility lock');
select is((select result_b from race_627),'voluntar',
  'demotion completes after move commits');
select is((select count(*) from public.task_activity where task_id=(select id from public.tasks where title='Race task #627')
  and kind='task_updated' and details->'consequences' = '[]'::jsonb),
  1::bigint, 'committed move logged no appointment for existing target member');

select extensions.dblink_exec('task_627_setup', $cleanup$
  drop function if exists public.test_627_demote();
  set session_replication_role = 'replica';
  delete from public.task_activity where task_id in (select id from public.tasks where title='Race task #627');
  set session_replication_role = 'origin';
  delete from public.notifications where task_id in (select id from public.tasks where title='Race task #627')
    or member_id in ('62700000-0000-0000-0000-000000000090','62700000-0000-0000-0000-000000000091');
  delete from public.task_assignments where task_id in (select id from public.tasks where title='Race task #627');
  delete from public.tasks where title='Race task #627';
  delete from public.group_members where group_id in (select id from public.groups where name='Race Group #627');
  delete from public.groups where name='Race Group #627';
  set session_replication_role = 'replica';
  delete from public.role_history where member_id in ('62700000-0000-0000-0000-000000000090','62700000-0000-0000-0000-000000000091');
  set session_replication_role = 'origin';
  delete from auth.users where id in ('62700000-0000-0000-0000-000000000090','62700000-0000-0000-0000-000000000091');
$cleanup$);
select extensions.dblink_disconnect('task_627_setup');
select * from finish();
rollback;
