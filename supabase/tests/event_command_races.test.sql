-- #248: command authority and Event terminal state survive real concurrent writes.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(8);
select extensions.dblink_connect('events_248_setup', format(
 'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',current_database()));
select extensions.dblink_exec('events_248_setup',$setup$
 delete from public.notifications where member_id::text like '24800000-%';
 delete from public.events where title='Race #248';
 delete from public.projects where name='Race #248';
 delete from auth.users where id in ('24800000-0000-0000-0000-000000000090','24800000-0000-0000-0000-000000000091','24800000-0000-0000-0000-000000000092');
 insert into auth.users(id,email) values
 ('24800000-0000-0000-0000-000000000090','lead.race248@test.local'),
 ('24800000-0000-0000-0000-000000000091','resp.race248@test.local'),
 ('24800000-0000-0000-0000-000000000092','bc.race248@test.local');
 insert into public.profiles(id,full_name,email,role,status) values
 ('24800000-0000-0000-0000-000000000090','Leader','lead.race248@test.local','voluntar','activ'),
 ('24800000-0000-0000-0000-000000000091','Responsible','resp.race248@test.local','voluntar','activ'),
 ('24800000-0000-0000-0000-000000000092','BC','bc.race248@test.local','bc','activ');
 insert into public.projects(name,leader_id,created_by) values
 ('Race #248','24800000-0000-0000-0000-000000000090','24800000-0000-0000-0000-000000000092');
 insert into public.project_members(project_id,member_id,project_role)
 select id,'24800000-0000-0000-0000-000000000091','responsible' from public.projects where name='Race #248'
  on conflict (project_id, member_id) do update set project_role = excluded.project_role;
 insert into public.events(title,type,group_id,starts_at,created_by)
 select 'Race #248','sedinta',id,'2026-10-01 12:00+00','24800000-0000-0000-0000-000000000090' from public.groups where name='Race #248';
 create or replace function public.test_248_edit() returns text language plpgsql security definer set search_path='' as $$
 declare e public.events%rowtype;
 begin
 select * into e from public.events where title='Race #248';
 return (public.update_event(e.id,e.title,e.type::text,e.group_id,e.starts_at,e.ends_at,e.location,30,e.description,e.min_level)).title;
 exception when sqlstate 'PT409' then return sqlstate || ':' || sqlerrm;
 end; $$;
 create or replace function public.test_248_cancel() returns text language sql security definer set search_path='' as $$
 select (public.cancel_event((select id from public.events where title='Race #248'),'Race reason')).cancel_reason;
 $$;
 create or replace function public.test_248_revoke() returns text language plpgsql security definer set search_path='' as $$
 begin
 perform set_config('request.jwt.claims','{"sub":"24800000-0000-0000-0000-000000000092","role":"authenticated","app_metadata":{"member_role":"bc","member_level":6}}',true);
 perform public.set_group_role((select id from public.groups where name='Race #248'),
      '24800000-0000-0000-0000-000000000091', 'member');
    return 'true';
 end; $$;
 revoke execute on function public.test_248_edit(),public.test_248_cancel(),public.test_248_revoke() from public,anon,authenticated,service_role;
 grant execute on function public.test_248_edit(),public.test_248_cancel(),public.test_248_revoke() to authenticated;
$setup$);
select pg_temp.test_login('24800000-0000-0000-0000-000000000091','{"member_role":"voluntar","member_level":1}');
reset role;
create temp table edit_race as select * from pg_temp.test_race('select public.test_248_edit()','select public.test_248_revoke()');
select is((select result_a from edit_race),'Race #248','authorized edit succeeds');
select ok((select b_waited from edit_race),'revocation waits for edit authority lock');
select is((select result_b from edit_race),'true','revocation completes after edit');
select extensions.dblink_exec('events_248_setup',$setup$
 insert into public.project_members(project_id,member_id,project_role)
 select id,'24800000-0000-0000-0000-000000000091','responsible' from public.projects where name='Race #248'
  on conflict (project_id, member_id) do update set project_role = excluded.project_role;
$setup$);
create temp table cancel_race as select * from pg_temp.test_race('select public.test_248_cancel()','select public.test_248_revoke()');
select is((select result_a from cancel_race),'Race reason','authorized cancellation succeeds');
select ok((select b_waited from cancel_race),'revocation waits for cancellation authority lock');
select extensions.dblink_exec('events_248_setup',$setup$
 update public.events set cancelled_at=null,cancel_reason=null where title='Race #248';
 insert into public.project_members(project_id,member_id,project_role)
 select id,'24800000-0000-0000-0000-000000000091','responsible' from public.projects where name='Race #248'
  on conflict (project_id, member_id) do update set project_role = excluded.project_role;
$setup$);
create temp table terminal_race as select * from pg_temp.test_race('select public.test_248_cancel()','select public.test_248_edit()');
select is((select result_a from terminal_race),'Race reason','cancellation wins before concurrent edit');
select ok((select b_waited from terminal_race),'edit waits for Event state lock');
select is((select result_b from terminal_race),'PT409:event_cancelled','waiting edit rechecks cancelled state');
select extensions.dblink_exec('events_248_setup',$cleanup$
 drop function public.test_248_edit();
 drop function public.test_248_cancel();
 drop function public.test_248_revoke();
 delete from public.notifications where member_id::text like '24800000-%';
 delete from public.events where title='Race #248';
 delete from public.projects where name='Race #248';
 delete from auth.users where id in ('24800000-0000-0000-0000-000000000090','24800000-0000-0000-0000-000000000091','24800000-0000-0000-0000-000000000092');
$cleanup$);
select extensions.dblink_disconnect('events_248_setup');
select * from finish();
rollback;
