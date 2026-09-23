-- #370: Organization Event creation holds the live Profile and actual Group Role through revocation.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;
select plan(8);
-- Committed remote fixtures are required for lock observations and test_race.
-- Both setup and cleanup are idempotent so an interrupted run can be retried.
select extensions.dblink_connect('commands_370_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres', current_database()));
-- #621: committed fixtures from an interrupted run must not hang cleanup.
select extensions.dblink_exec('commands_370_setup', 'set lock_timeout = ''2s''');
select extensions.dblink_exec('commands_370_setup', $setup$
  drop function if exists public.test_370_event();
  drop function if exists public.test_370_revoke();
  delete from public.events where title='Race event #370';
  delete from public.groups where name = 'Race #370';
  delete from public.projects where name = 'Race #370';
  delete from auth.users where id in ('37000000-0000-0000-0000-000000000090',
    '37000000-0000-0000-0000-000000000091','37000000-0000-0000-0000-000000000092');
  insert into auth.users(id,email) values
    ('37000000-0000-0000-0000-000000000090','coord.race.370@test.local'),
    ('37000000-0000-0000-0000-000000000091','resp.race.370@test.local'),
    ('37000000-0000-0000-0000-000000000092','bc.race.370@test.local');
  insert into public.profiles(id,full_name,email,role,status) values
    ('37000000-0000-0000-0000-000000000090','Race coord','coord.race.370@test.local','voluntar','activ'),
    ('37000000-0000-0000-0000-000000000091','Race resp','resp.race.370@test.local','voluntar','activ'),
    ('37000000-0000-0000-0000-000000000092','Race BC','bc.race.370@test.local','bc','activ');
  insert into public.projects(name,leader_id,created_by) values
    ('Race #370','37000000-0000-0000-0000-000000000090','37000000-0000-0000-0000-000000000092');
  insert into public.project_members(project_id,member_id,project_role)
    select id,'37000000-0000-0000-0000-000000000091','responsible' from public.projects where name='Race #370';
  insert into public.groups(name,category,legacy_project_id)
    select name,'project',id from public.projects where name='Race #370';
  insert into public.group_members(group_id,member_id,group_role)
    select id,'37000000-0000-0000-0000-000000000090','manager' from public.groups where name='Race #370';
  insert into public.group_members(group_id,member_id,group_role)
    select id,'37000000-0000-0000-0000-000000000091','responsible' from public.groups where name='Race #370';
  -- Test-only callable bridge to the owner-only gate, never a production grant.
  create function public.test_370_event() returns text
  language sql security definer set search_path = '' as $$
    select (public.create_event('Race event #370','sedinta',(select id from public.groups where name='Race #370'),now()+interval '1 day')).title
  $$;
  create function public.test_370_revoke() returns text
  language plpgsql security definer set search_path = '' as $$
  begin
    perform set_config('request.jwt.claims', '{"sub":"37000000-0000-0000-0000-000000000092","role":"authenticated","app_metadata":{"member_role":"bc","member_level":6}}', true);
    perform public.set_group_role((select id from public.groups where name='Race #370'),
      '37000000-0000-0000-0000-000000000091', 'member');
    return 'true';
  end;
  $$;
  revoke execute on function public.test_370_event(), public.test_370_revoke() from public,anon,authenticated,service_role;
  grant execute on function public.test_370_event(), public.test_370_revoke() to authenticated;
$setup$);
select extensions.dblink_connect('commands_370_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres', current_database()));
select extensions.dblink_exec('commands_370_lock', 'begin; set local statement_timeout = ''5s''; set local lock_timeout = ''2s'';');
select * from extensions.dblink('commands_370_lock', $$select set_config('request.jwt.claims',
  '{"sub":"37000000-0000-0000-0000-000000000091","role":"authenticated","app_metadata":{"member_role":"voluntar","member_level":1}}',true)$$) as claims(setting text);
select extensions.dblink_exec('commands_370_lock','set local role authenticated');
select * from extensions.dblink('commands_370_lock','select public.test_370_event()') as held(actor text);
select ok(exists(select 1 from extensions.pgrowlocks('public.group_members') l
  join public.group_members gm on gm.ctid=l.locked_row
  where gm.member_id='37000000-0000-0000-0000-000000000091' and 'For Share'=any(l.modes)),
  'gate holds the deciding roster row FOR SHARE');
select ok(exists(select 1 from extensions.pgrowlocks('public.profiles') l
  join public.profiles p on p.ctid=l.locked_row
  where p.id='37000000-0000-0000-0000-000000000091' and 'For Share'=any(l.modes)),
  'gate holds the live actor profile FOR SHARE');
select is((select count(*) from extensions.pgrowlocks('public.groups') l
  join public.groups g on g.ctid=l.locked_row where g.name='Race #370' and not ('For Key Share'=any(l.modes))),0::bigint,
  'command only takes compatible FK Key Share on Group, never an authority Share lock');
select extensions.dblink_exec('commands_370_lock','rollback');
select extensions.dblink_disconnect('commands_370_lock');
select pg_temp.test_login('37000000-0000-0000-0000-000000000091',
  '{"member_role":"voluntar","member_level":1}');
reset role;
create temp table race_370 as select * from pg_temp.test_race(
  'select public.test_370_event()', 'select public.test_370_revoke()');
select is((select result_a from race_370),'Race event #370','Responsible creates Event before revocation');
select ok((select b_waited from race_370),'concurrent public roster revocation waits for Group authority');
select is((select result_b from race_370),'true','revocation completes after the authorized transaction commits');
select is(private.can_manage_group_work((select id from public.groups where name='Race #370')),false,
  'revoked Responsible loses authority despite retained claims');
select throws_ok($$select public.test_370_event()$$,
  '42501','calendar_manage_forbidden','revoked Responsible cannot create another Event');
select extensions.dblink_exec('commands_370_setup', $$
  drop function public.test_370_event();
  drop function public.test_370_revoke();
  delete from public.events where title='Race event #370';
  delete from public.groups where name='Race #370';
  delete from public.projects where name='Race #370';
  delete from auth.users where id in ('37000000-0000-0000-0000-000000000090',
    '37000000-0000-0000-0000-000000000091','37000000-0000-0000-0000-000000000092');
$$);
select extensions.dblink_disconnect('commands_370_setup');

select * from finish();
rollback;
