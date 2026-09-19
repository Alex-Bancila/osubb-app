-- #522: real command transactions hold Group authority against roster revocation.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;
select plan(11);
-- Committed remote fixtures are required for lock observations and test_race.
-- Both setup and cleanup are idempotent so an interrupted run can be retried.
select extensions.dblink_connect('commands_522_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres', current_database()));
select extensions.dblink_exec('commands_522_setup', $setup$
  drop function if exists public.test_522_campaign();
  drop function if exists public.test_522_revoke();
  delete from public.campaigns where name='Race campaign #522';
  delete from public.completed_work_requests where description='Race request #522';
  delete from public.projects where name = 'Race #522';
  delete from auth.users where id in ('52200000-0000-0000-0000-000000000090',
    '52200000-0000-0000-0000-000000000091','52200000-0000-0000-0000-000000000092');
  insert into auth.users(id,email) values
    ('52200000-0000-0000-0000-000000000090','coord.race.522@test.local'),
    ('52200000-0000-0000-0000-000000000091','resp.race.522@test.local'),
    ('52200000-0000-0000-0000-000000000092','bc.race.522@test.local');
  insert into public.profiles(id,full_name,email,role,status) values
    ('52200000-0000-0000-0000-000000000090','Race coord','coord.race.522@test.local','voluntar','activ'),
    ('52200000-0000-0000-0000-000000000091','Race resp','resp.race.522@test.local','voluntar','activ'),
    ('52200000-0000-0000-0000-000000000092','Race BC','bc.race.522@test.local','bc','activ');
  insert into public.projects(name,leader_id,created_by) values
    ('Race #522','52200000-0000-0000-0000-000000000090','52200000-0000-0000-0000-000000000092');
  insert into public.project_members(project_id,member_id,project_role)
    select id,'52200000-0000-0000-0000-000000000091','responsible' from public.projects where name='Race #522';
  -- Test-only callable bridge to the owner-only gate, never a production grant.
  create function public.test_522_campaign() returns text
  language sql security definer set search_path = '' as $$
    select (public.create_campaign((select id from public.groups where name='Race #522'),'Race campaign #522')).name
  $$;
  create function public.test_522_revoke() returns text
  language plpgsql security definer set search_path = '' as $$
  begin
    perform set_config('request.jwt.claims', '{"sub":"52200000-0000-0000-0000-000000000092","role":"authenticated","app_metadata":{"member_role":"bc","member_level":6}}', true);
    return public.remove_project_member((select id from public.projects where name='Race #522'),
      '52200000-0000-0000-0000-000000000091')::text;
  end;
  $$;
  revoke execute on function public.test_522_campaign(), public.test_522_revoke() from public,anon,authenticated,service_role;
  grant execute on function public.test_522_campaign(), public.test_522_revoke() to authenticated;
$setup$);
select extensions.dblink_connect('commands_522_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres', current_database()));
select extensions.dblink_exec('commands_522_lock', 'begin; set local statement_timeout = ''5s''; set local lock_timeout = ''2s'';');
select * from extensions.dblink('commands_522_lock', $$select set_config('request.jwt.claims',
  '{"sub":"52200000-0000-0000-0000-000000000091","role":"authenticated","app_metadata":{"member_role":"voluntar","member_level":1}}',true)$$) as claims(setting text);
select extensions.dblink_exec('commands_522_lock','set local role authenticated');
select * from extensions.dblink('commands_522_lock','select public.test_522_campaign()') as held(actor text);
select ok(exists(select 1 from extensions.pgrowlocks('public.group_members') l
  join public.group_members gm on gm.ctid=l.locked_row
  where gm.member_id='52200000-0000-0000-0000-000000000091' and 'For Share'=any(l.modes)),
  'gate holds the deciding roster row FOR SHARE');
select ok(exists(select 1 from extensions.pgrowlocks('public.profiles') l
  join public.profiles p on p.ctid=l.locked_row
  where p.id='52200000-0000-0000-0000-000000000091' and 'For Share'=any(l.modes)),
  'gate holds the live actor profile FOR SHARE');
select is((select count(*) from extensions.pgrowlocks('public.groups') l
  join public.groups g on g.ctid=l.locked_row where g.name='Race #522' and not ('For Key Share'=any(l.modes))),0::bigint,
  'command only takes compatible FK Key Share on Group, never an authority Share lock');
select extensions.dblink_exec('commands_522_lock','rollback');
select extensions.dblink_disconnect('commands_522_lock');
select pg_temp.test_login('52200000-0000-0000-0000-000000000091',
  '{"member_role":"voluntar","member_level":1}');
reset role;
create temp table race_522 as select * from pg_temp.test_race(
  'select public.test_522_campaign()', 'select public.test_522_revoke()');
select is((select result_a from race_522),'Race campaign #522','Responsible creates Campaign before revocation');
select ok((select b_waited from race_522),'concurrent public roster revocation waits for Group authority');
select is((select result_b from race_522),'true','revocation completes after the authorized transaction commits');
select is(private.can_manage_group_work((select id from public.groups where name='Race #522')),false,
  'revoked Responsible loses authority despite retained claims');
select throws_ok($$select public.test_522_campaign()$$,
  '42501','campaign_manage_forbidden','revoked Responsible cannot create another Campaign');
select extensions.dblink_exec('commands_522_setup', $setup$
  insert into public.project_members(project_id,member_id,project_role)
    select id,'52200000-0000-0000-0000-000000000091','responsible' from public.projects where name='Race #522';
  insert into public.completed_work_requests(requester_id,group_id,description)
    select '52200000-0000-0000-0000-000000000092',id,'Race request #522' from public.groups where name='Race #522';
$setup$);
create temp table request_race_522 as select * from pg_temp.test_race(
  $q$select (public.reject_completed_work_request((select id from public.completed_work_requests where description='Race request #522'),'Decided before revocation')).status$q$,
  'select public.test_522_revoke()');
select is((select result_a from request_race_522),'rejected','Responsible decides ordinary Request before revocation');
select ok((select b_waited from request_race_522),'roster revocation waits for the Request decision transaction');
select is((select result_b from request_race_522),'true','revocation completes after Request decision commits');
select extensions.dblink_exec('commands_522_setup', $$
  drop function public.test_522_campaign();
  drop function public.test_522_revoke();
  delete from public.campaigns where name='Race campaign #522';
  delete from public.completed_work_requests where description='Race request #522';
  delete from public.projects where name='Race #522';
  delete from auth.users where id in ('52200000-0000-0000-0000-000000000090',
    '52200000-0000-0000-0000-000000000091','52200000-0000-0000-0000-000000000092');
$$);
select extensions.dblink_disconnect('commands_522_setup');

select * from finish();
rollback;
