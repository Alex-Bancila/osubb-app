begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(22);
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
select pg_temp.materialize_legacy_groups();
create temp table gx as select id, case when name='Events A #248' then 'a' when name='Events B #248' then 'b' else 'org' end name
from public.groups where name in ('Events A #248','Events B #248') or legacy_dept_id='org';
grant select on gx to authenticated,anon;
insert into public.events(title,type,group_id,starts_at,created_by,min_level)
select 'Event '||name||' #248','sedinta',id,'2026-10-01 12:00+00','24800000-0000-0000-0000-000000000002',0 from gx;
insert into public.events(title,type,group_id,starts_at,created_by,min_level)
select 'Hidden #248','sedinta',id,'2026-10-01 12:00+00','24800000-0000-0000-0000-000000000001',5 from gx where name='a';
create temp table ex as select id,group_id,title from public.events where title like '%#248';
grant select on ex to authenticated,anon;
insert into public.event_attendance(event_id,member_id,status)
select id,'24800000-0000-0000-0000-000000000006','going' from ex where title='Event a #248';
insert into public.event_attendance(event_id,member_id,status)
select id,'24800000-0000-0000-0000-000000000007','declined' from ex where title='Event a #248';
insert into public.event_attendance(event_id,member_id,status)
select id,'24800000-0000-0000-0000-000000000009','going' from ex where title='Event a #248';
select ok(not (select prosecdef from pg_proc where oid='public.cancel_event(bigint,text)'::regprocedure),'cancel wrapper is invoker');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000004');
select throws_ok($q$select public.cancel_event((select id from ex where title='Event a #248'),'Anulat')$q$,'42501','calendar_manage_forbidden','ordinary member cannot cancel');
select throws_ok($q$select public.cancel_event((select id from ex where title='Hidden #248'),'Reason')$q$,'PT404','event_not_found','hidden Event remains missing');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000005');
select throws_ok($q$select public.cancel_event((select id from ex where title='Event a #248'),'Anulat')$q$,'42501','calendar_manage_forbidden','unrelated manager denied');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000003');
select throws_ok($q$select public.cancel_event((select id from ex where title='Event org #248'),'Anulat')$q$,'42501','calendar_manage_forbidden','Group Responsible cannot cancel another Organization Event');
reset role;
select pg_temp.test_login('24800000-0000-0000-0000-000000000001','{}');
select throws_ok($q$select public.cancel_event((select id from ex where title='Event a #248'),' ')$q$,'PT400','reason_required','blank reason checked before authority');
select throws_ok($q$select public.cancel_event((select id from ex where title='Event a #248'),'Anulat')$q$,'42501','calendar_manage_forbidden','claimless cannot cancel');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000009');
select throws_ok($q$select public.cancel_event((select id from ex where title='Event a #248'),'Anulat')$q$,'42501','calendar_manage_forbidden','inactive denied');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000003');
select lives_ok($q$select public.cancel_event((select id from ex where title='Event a #248'),'  Vreme nefavorabilă  ')$q$,'Project Responsible cancels');
reset role;
select ok((select cancelled_at is not null and cancel_reason='Vreme nefavorabilă' from public.events where id=(select id from ex where title='Event a #248')),'cancellation timestamp and normalized reason stored');
select is((select count(*) from public.event_attendance where event_id=(select id from ex where title='Event a #248')),3::bigint,'attendance survives cancellation');
select is((select count(*) from public.notifications where dedupe_key like 'event:%:cancelled' and member_id::text like '24800000-%'),3::bigint,'cancellation has exact deduplicated active nonactor recipients');
select ok((select bool_and(body='Vreme nefavorabilă' and link='/calendar') from public.notifications where dedupe_key like 'event:%:cancelled' and member_id::text like '24800000-%'),'cancellation reason and route sent');
-- #248: the body is the reason, so the Event has to be named by the title -- a
-- recipient on several Groups otherwise reads "Eveniment anulat" with no subject.
select ok((select bool_and(title='Eveniment anulat: Event a #248') from public.notifications where dedupe_key like 'event:%:cancelled' and member_id::text like '24800000-%'),'the cancellation title names the Event');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000003');
select throws_ok($q$select public.cancel_event((select id from ex where title='Event a #248'),'Anulat')$q$,'PT409','event_cancelled','double cancellation rejected');
select throws_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='a'),'2026-10-01 12:00+00',null,null,null,null,0)$q$,'PT409','event_cancelled','cancelled Event cannot be edited');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000004');
select is((select count(*) from public.events where id=(select id from ex where title='Event a #248')),1::bigint,'cancelled Event remains readable');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000002');
select lives_ok($q$select public.cancel_event((select id from ex where title='Event org #248'),'Anulat')$q$,'creator cancels Organization Event');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000001');
select lives_ok($q$select public.cancel_event((select id from ex where title='Event b #248'),'Anulat')$q$,'BC cancels another Group Event');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($q$select public.cancel_event((select id from ex where title='Event a #248'),'Anulat')$q$,'42501',null,'anon cannot execute');
reset role;

-- ===== #248 plan addition ==================================================
-- Every cancellation above is authorized either by an explicit Group Role on the
-- Event's own Group or by BC's level, and the Project Groups are roots, so
-- nothing here separates the ancestor half of can_manage_group_work from the
-- level >= 6 shortcut: an own-row-only rule passes this whole file. A lead of
-- the Department that owns the Team is the case that needs the path walked.
select pg_temp.test_clear_jwt();
reset role;
insert into auth.users(id,email) values
  ('24800000-0000-0000-0000-000000000011','diverse248@test.local'),
  ('24800000-0000-0000-0000-000000000012','edu248@test.local');
insert into public.profiles(id,full_name,email,role,status) values
  ('24800000-0000-0000-0000-000000000011','Diverse lead #248','diverse248@test.local','bce','activ'),
  ('24800000-0000-0000-0000-000000000012','Edu lead #248','edu248@test.local','bce','activ');
insert into public.member_departments(member_id,dept_id) values
  ('24800000-0000-0000-0000-000000000011','diverse'),
  ('24800000-0000-0000-0000-000000000012','edu');
select pg_temp.materialize_legacy_groups();
insert into public.events(title,type,group_id,starts_at,created_by,min_level)
select 'Team ancestor #248','sedinta',id,'2026-10-01 12:00+00','24800000-0000-0000-0000-000000000001',0
  from public.groups where legacy_team_id='it';
create temp table ex2 as select id,title from public.events where title='Team ancestor #248';
grant select on ex2 to authenticated,anon;
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000012');
select throws_ok($q$select public.cancel_event((select id from ex2 where title='Team ancestor #248'),'Anulat')$q$,'42501','calendar_manage_forbidden','a lead of another Department cannot cancel on that path');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000011');
select lives_ok($q$select public.cancel_event((select id from ex2 where title='Team ancestor #248'),'Anulat')$q$,'a Department lead cancels a Team Event through the Group path');
reset role;
select * from finish();
rollback;
