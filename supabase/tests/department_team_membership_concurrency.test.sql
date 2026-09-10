-- #279: real concurrent duplicate membership commands serialize per Team.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(9);

create function pg_temp.wait_until_blocked(p_application_name text)
returns boolean language plpgsql as $$
begin
  for attempt in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1 from pg_stat_activity
       where application_name = p_application_name
         and wait_event_type = 'Lock'
    ) then
      return true;
    end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end;
$$;

select extensions.dblink_connect('team_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('team_setup', $$
  delete from public.teams where id = 'concurrent-department-team-279';
  delete from public.member_departments where member_id in (
    '27900000-0000-0000-0000-000000000020');
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

select extensions.dblink_connect('team_a', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres application_name=dept_team_membership_a',
  current_database()));
select extensions.dblink_connect('team_b', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres application_name=dept_team_membership_b',
  current_database()));

-- Two adds of the same member wait on the Team lock and converge on one row.
select extensions.dblink_exec('team_a', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select extensions.dblink_exec('team_b', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('team_a', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub','27900000-0000-0000-0000-000000000020','role','authenticated',
    'app_metadata',jsonb_build_object('member_role','bce','member_level',5))::text,true)
$$) as claims(setting text);
select * from extensions.dblink('team_b', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub','27900000-0000-0000-0000-000000000020','role','authenticated',
    'app_metadata',jsonb_build_object('member_role','bce','member_level',5))::text,true)
$$) as claims(setting text);
select extensions.dblink_exec('team_a', 'set local role authenticated');
select extensions.dblink_exec('team_b', 'set local role authenticated');
select * from extensions.dblink('team_a', $$
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
select * from extensions.dblink('team_a', $$
  select (public.add_department_team_member(
    'concurrent-department-team-279',
    '27900000-0000-0000-0000-000000000021')).member_id
$$) as first_add(member_id uuid);
select is(extensions.dblink_send_query('team_b', $$
  select (public.add_department_team_member(
    'concurrent-department-team-279',
    '27900000-0000-0000-0000-000000000021')).member_id
$$), 1, 'the second concurrent add starts');
select ok(pg_temp.wait_until_blocked('dept_team_membership_b'),
  'the duplicate add waits on the Team lock');
select extensions.dblink_exec('team_a', 'commit');
select is((select member_id from extensions.dblink_get_result('team_b')
  as result(member_id uuid)),
  '27900000-0000-0000-0000-000000000021'::uuid,
  'the waiting add returns the existing membership');
select extensions.dblink_exec('team_b', 'commit');
select is((select membership_count from extensions.dblink('team_setup', $$
  select count(*) from public.team_members
   where team_id='concurrent-department-team-279'
     and member_id='27900000-0000-0000-0000-000000000021'
$$) as result(membership_count bigint)), 1::bigint,
  'concurrent duplicate adds commit exactly one row');

-- Two removals serialize on the same lock: true first, then stable false.
select pg_stat_clear_snapshot();
select extensions.dblink_exec('team_a', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select extensions.dblink_exec('team_b', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('team_a', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub','27900000-0000-0000-0000-000000000020','role','authenticated',
    'app_metadata',jsonb_build_object('member_role','bce','member_level',5))::text,true)
$$) as claims(setting text);
select * from extensions.dblink('team_b', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub','27900000-0000-0000-0000-000000000020','role','authenticated',
    'app_metadata',jsonb_build_object('member_role','bce','member_level',5))::text,true)
$$) as claims(setting text);
select extensions.dblink_exec('team_a', 'set local role authenticated');
select extensions.dblink_exec('team_b', 'set local role authenticated');
select * from extensions.dblink('team_a', $$
  select public.remove_department_team_member(
    'concurrent-department-team-279',
    '27900000-0000-0000-0000-000000000021')
$$) as first_remove(removed boolean);
select is(extensions.dblink_send_query('team_b', $$
  select public.remove_department_team_member(
    'concurrent-department-team-279',
    '27900000-0000-0000-0000-000000000021')
$$), 1, 'the second concurrent remove starts');
select ok(pg_temp.wait_until_blocked('dept_team_membership_b'),
  'the duplicate remove waits on the Team lock');
select extensions.dblink_exec('team_a', 'commit');
select is((select removed from extensions.dblink_get_result('team_b')
  as result(removed boolean)), false,
  'the waiting remove reports the committed absence');
select extensions.dblink_exec('team_b', 'commit');
select is((select membership_count from extensions.dblink('team_setup', $$
  select count(*) from public.team_members
   where team_id='concurrent-department-team-279'
     and member_id='27900000-0000-0000-0000-000000000021'
$$) as result(membership_count bigint)), 0::bigint,
  'concurrent duplicate removes leave no row');

select extensions.dblink_disconnect('team_a');
select extensions.dblink_disconnect('team_b');
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
