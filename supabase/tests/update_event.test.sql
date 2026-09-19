begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(36);
insert into auth.users(id,email)
select ('24800000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid, 'event248-'||n||'@test.local'
from generate_series(1,9) n;
insert into public.profiles(id,full_name,email,role,status)
select id, 'Event fixture '||split_part(email,'@',1), email,
case right(id::text,1) when '1' then 'bc' when '8' then 'moderator' else 'voluntar' end::public.member_role,
case right(id::text,1) when '9' then 'inactiv' else 'activ' end::public.member_status
from auth.users where id::text like '24800000-%';
insert into public.projects(name,leader_id,created_by) values
('Events A #248','24800000-0000-0000-0000-000000000002','24800000-0000-0000-0000-000000000001'),
('Events B #248','24800000-0000-0000-0000-000000000005','24800000-0000-0000-0000-000000000001');
insert into public.project_members(project_id,member_id,project_role)
select id,'24800000-0000-0000-0000-000000000003','responsible' from public.projects where name='Events A #248';
insert into public.project_members(project_id,member_id,project_role)
select id,'24800000-0000-0000-0000-000000000004','member' from public.projects where name='Events A #248';
create temp table gx as select id, case when name='Events A #248' then 'a' when name='Events B #248' then 'b' else 'org' end name
from public.groups where name in ('Events A #248','Events B #248') or legacy_dept_id='org';
grant select on gx to authenticated,anon;
insert into public.events(title,type,group_id,starts_at,created_by,min_level)
select 'Event '||name||' #248','sedinta',id,'2026-10-01 12:00+00','24800000-0000-0000-0000-000000000002',0 from gx;
insert into public.events(title,type,group_id,starts_at,created_by,min_level)
select 'Hidden #248','sedinta',id,'2026-10-01 12:00+00','24800000-0000-0000-0000-000000000001',5 from gx where name='a';
create temp table ex as select id,group_id,title,updated_at from public.events where title like '%#248';
grant select on ex to authenticated,anon;
insert into public.event_attendance(event_id,member_id,status)
select id,'24800000-0000-0000-0000-000000000006','going' from ex where title='Event a #248';
insert into public.event_attendance(event_id,member_id,status)
select id,'24800000-0000-0000-0000-000000000007','declined' from ex where title='Event a #248';
insert into public.event_attendance(event_id,member_id,status)
select id,'24800000-0000-0000-0000-000000000009','going' from ex where title='Event a #248';
select ok(not (select prosecdef from pg_proc where oid='public.update_event(bigint,text,text,bigint,timestamptz,timestamptz,text,integer,text,integer)'::regprocedure),'update wrapper is invoker');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000002');
select lives_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='a'),'2026-10-01 12:00+00',null,null,null,null,0)$q$,'Project Manager edits Event');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000003');
select lives_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Responsible','sedinta',(select id from gx where name='a'),'2026-10-01 12:00+00',null,null,null,null,0)$q$,'Project Responsible edits Event');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000004');
select throws_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='a'),'2026-10-01 12:00+00',null,null,null,null,0)$q$,'42501','calendar_manage_forbidden','ordinary member denied');
select throws_ok($q$select public.update_event((select id from ex where title='Hidden #248'),'Hidden','sedinta',(select id from gx where name='a'),now(),null,null,null,null,5)$q$,'PT404','event_not_found','hidden Event answers missing');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000005');
select throws_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='a'),'2026-10-01 12:00+00',null,null,null,null,0)$q$,'42501','calendar_manage_forbidden','unrelated Manager denied');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000002');
select throws_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='b'),'2026-10-01 12:00+00',null,null,null,null,0)$q$,'42501','calendar_manage_forbidden','moving requires target authority');
select lives_ok($q$select public.update_event((select id from ex where title='Event org #248'),'Updated','sedinta',(select id from gx where name='org'),'2026-10-01 12:00+00',null,null,null,null,0)$q$,'Organization creator edits own Event');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000003');
select throws_ok($q$select public.update_event((select id from ex where title='Event org #248'),'Updated','sedinta',(select id from gx where name='org'),'2026-10-01 12:00+00',null,null,null,null,0)$q$,'42501','calendar_manage_forbidden','other Group Role cannot edit Organization Event');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000001');
select lives_ok($q$select public.update_event((select id from ex where title='Event org #248'),'Updated','sedinta',(select id from gx where name='org'),'2026-10-01 12:00+00',null,null,null,null,0)$q$,'BC edits Organization Event');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000002');
select throws_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='a'),'2026-10-01 12:00+00',null,null,null,null,3)$q$,'PT400','event_min_level_above_actor','Minimum Level ceiling enforced');
reset role;
update public.groups set min_level=3,application_level=3 where id=(select id from gx where name='b');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000001');
select throws_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='b'),'2026-10-01 12:00+00',null,null,null,null,0)$q$,'PT400','event_min_level_below_group','target Group floor enforced');
select throws_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='a'),'2026-10-01 12:00+00',null,null,null,null,4)$q$,'PT400','invalid_event_min_level','retired level4 refused');
select throws_ok($q$select public.update_event((select id from ex where title='Event a #248'),' ','sedinta',(select id from gx where name='a'),'2026-10-01 12:00+00',null,null,null,null,0)$q$,'PT400','invalid_event_title','blank title refused');
select throws_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','invalid',(select id from gx where name='a'),'2026-10-01 12:00+00',null,null,null,null,0)$q$,'PT400','invalid_event_type','invalid type refused');
select throws_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='a'),'2026-10-01 12:00+00','2026-10-01 11:00+00',null,null,null,0)$q$,'PT400','invalid_event_interval','reversed interval refused');
select throws_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='a'),'2026-10-01 12:00+00',null,null,0,null,0)$q$,'PT400','invalid_event_capacity','nonpositive capacity refused');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000008');
select lives_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='a'),'2026-10-01 12:00+00',null,null,null,null,6)$q$,'Moderator may raise Minimum Level');
reset role;
update public.events set min_level=0 where id=(select id from ex where title='Event a #248');
delete from public.notifications where member_id::text like '24800000-%';
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000002');
select lives_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Quiet','activitate',(select id from gx where name='a'),'2026-10-01 12:00+00',null,null,20,'Only text',0)$q$,'nonimportant edits succeed');
reset role;
select is((select count(*) from public.notifications where member_id::text like '24800000-%'),0::bigint,'title type description capacity do not notify');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000002');
select lives_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='a'),'2026-10-02 12:00+00','2026-10-02 13:00+00','Sala',null,null,0)$q$,'schedule and location change atomically');
reset role;
select is((select count(*) from public.notifications where member_id::text like '24800000-%'),6::bigint,'three distinct active nonactor recipients per changed field');
select is((select count(*) from public.notifications where member_id in ('24800000-0000-0000-0000-000000000002','24800000-0000-0000-0000-000000000007','24800000-0000-0000-0000-000000000009')),0::bigint,'actor declined outsider and inactive attendee excluded');
select ok((select bool_and(link='/calendar' and kind='event') from public.notifications where member_id::text like '24800000-%'),'Event notifications link to Calendar');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000002');
select lives_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='a'),'2026-10-03 12:00+00',null,'Sala',null,null,0)$q$,'subsequent unread schedule change coalesces');
reset role;
select is((select count(*) from public.notifications where member_id::text like '24800000-%'),6::bigint,'schedule key deduplicates unread changes');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000001');
select lives_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='b'),'2026-10-03 12:00+00',null,'Sala',null,null,3)$q$,'BC moves Event and raises floor');
reset role;
select is((select count(*) from public.notifications where dedupe_key like 'event:%:group' and member_id::text like '24800000-%'),5::bigint,'move notifies old and new Group plus going attendee');
select is((select count(*) from public.notifications where dedupe_key like 'event:%:min_level' and member_id::text like '24800000-%'),5::bigint,'Minimum Level change notifies recipients');
select lives_ok($q$select private.notify(array['24800000-0000-0000-0000-000000000004'::uuid],'event','Compatibility',null,null,null,null)$q$,'existing seven-argument notify remains callable');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000001');
select lives_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='b'),'2026-10-01 12:00+00',null,null,null,null,3)$q$,'nullable replacement fields can be cleared');
reset role;
select ok((select ends_at is null and location is null and capacity is null and description is null from public.events where id=(select id from ex where title='Event a #248')),'NULL means clear');
select ok((select updated_at>(select updated_at from ex where title='Event a #248') from public.events where id=(select id from ex where title='Event a #248')),'updated_at maintained');
select pg_temp.test_login('24800000-0000-0000-0000-000000000001','{}');
select throws_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='a'),'2026-10-01 12:00+00',null,null,null,null,0)$q$,'42501','calendar_manage_forbidden','claimless denied');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000009');
select throws_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='a'),'2026-10-01 12:00+00',null,null,null,null,0)$q$,'42501','calendar_manage_forbidden','inactive denied');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='a'),'2026-10-01 12:00+00',null,null,null,null,0)$q$,'42501',null,'anon cannot execute');
reset role;
select * from finish();
rollback;
