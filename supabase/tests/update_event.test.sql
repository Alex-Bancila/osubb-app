begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(57);
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
-- #248: the recipient set carries the live-profile rule itself. Every other
-- assertion here reads it through private.notify, which drops a deactivated
-- Member on its own -- so the filter inside the set is invisible end to end and
-- has to be pinned where it lives, or it can be deleted with the suite green.
select is((select count(*) from private.event_notification_recipients((select id from ex where title='Event a #248')) as r where r='24800000-0000-0000-0000-000000000009'),0::bigint,'the recipient set itself drops a deactivated going attendee');
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
-- #248: each important change carries its OWN dedupe key, and the text tells the
-- reader which field moved and what it moved to -- a Notification whose body is
-- only the Event's name cannot say anything a coalesced second change would update.
select is((select count(*) from public.notifications where dedupe_key like 'event:%:schedule' and member_id::text like '24800000-%'),3::bigint,'a schedule change carries the schedule dedupe key');
select is((select count(*) from public.notifications where dedupe_key like 'event:%:location' and member_id::text like '24800000-%'),3::bigint,'a location change carries the location dedupe key');
select ok((select bool_and(title='Eveniment actualizat: Updated') from public.notifications where member_id::text like '24800000-%'),'the important-change title names the Event');
select ok((select bool_and(body='Noua programare: 02.10.2026 15:00 - 02.10.2026 16:00') from public.notifications where dedupe_key like 'event:%:schedule' and member_id::text like '24800000-%'),'the schedule body carries the new interval in Bucharest time');
select ok((select bool_and(body='Noua locație: Sala') from public.notifications where dedupe_key like 'event:%:location' and member_id::text like '24800000-%'),'the location body carries the new location');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000002');
select lives_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='a'),'2026-10-03 12:00+00',null,'Sala',null,null,0)$q$,'subsequent unread schedule change coalesces');
reset role;
select is((select count(*) from public.notifications where member_id::text like '24800000-%'),6::bigint,'schedule key deduplicates unread changes');
-- #248: coalescing is only useful if the surviving row carries the LATER value.
select ok((select bool_and(body='Noua programare: 03.10.2026 15:00') from public.notifications where dedupe_key like 'event:%:schedule' and member_id::text like '24800000-%'),'the coalesced row carries the second change, not the first');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000001');
select lives_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Updated','sedinta',(select id from gx where name='b'),'2026-10-03 12:00+00',null,'Sala',null,null,3)$q$,'BC moves Event and raises floor');
reset role;
select is((select count(*) from public.notifications where dedupe_key like 'event:%:group' and member_id::text like '24800000-%'),5::bigint,'move notifies old and new Group plus going attendee');
select is((select count(*) from public.notifications where dedupe_key like 'event:%:min_level' and member_id::text like '24800000-%'),5::bigint,'Minimum Level change notifies recipients');
-- #248: the command never writes the legacy Origin -- events_sync_group_origin (#519)
-- re-derives scope/dept_id/team_id/project_id from the Group the move named.
select ok((select scope='project' and project_id=(select legacy_project_id from public.groups where id=(select id from gx where name='b')) and dept_id is null and team_id is null from public.events where id=(select id from ex where title='Event a #248')),'moving the Event re-derives its legacy Origin from the new Group');
select ok((select bool_and(body='Noul grup: Events B #248') from public.notifications where dedupe_key like 'event:%:group' and member_id::text like '24800000-%'),'the Group body names the new Group');
select ok((select bool_and(body='Noul nivel minim: 3') from public.notifications where dedupe_key like 'event:%:min_level' and member_id::text like '24800000-%'),'the Minimum Level body carries the new level');
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

-- ===== #248 plan additions =================================================
-- Two facts the Project fixtures above cannot reach. (1) The Project Groups are
-- roots (path = {self}), so nothing in this file exercises the ancestor half of
-- can_manage_group_work; a Department lead editing a Team Event of a Team under
-- that Department does. (2) The Organization Group is a root too, which is
-- exactly why a move INTO it cannot go through require_group_work_manager --
-- nobody has an ancestor role over the root -- and takes create_event's rule
-- instead: level >= 6, or any live Group Role anywhere.
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
insert into public.events(title,type,group_id,starts_at,created_by,min_level)
select 'Team ancestor #248','sedinta',id,'2026-10-01 12:00+00','24800000-0000-0000-0000-000000000001',0
  from public.groups where legacy_team_id='it';
insert into public.events(title,type,group_id,starts_at,created_by,min_level)
select 'Move to org #248','sedinta',id,'2026-10-01 12:00+00','24800000-0000-0000-0000-000000000002',0
  from gx where name='a';
create temp table ex2 as select id,title,group_id from public.events where title in ('Team ancestor #248','Move to org #248');
grant select on ex2 to authenticated,anon;
select is((select count(*) from public.group_members where member_id='24800000-0000-0000-0000-000000000011' and group_role='manager'),1::bigint,'the Department lead fixture holds exactly its own Group Role');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000011');
select lives_ok($q$select public.update_event((select id from ex2 where title='Team ancestor #248'),'Ancestor','sedinta',(select group_id from ex2 where title='Team ancestor #248'),'2026-10-04 12:00+00',null,null,null,null,0)$q$,'a Department lead edits a Team Event through the Group path');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000012');
select throws_ok($q$select public.update_event((select id from ex2 where title='Team ancestor #248'),'Ancestor','sedinta',(select group_id from ex2 where title='Team ancestor #248'),'2026-10-04 12:00+00',null,null,null,null,0)$q$,'42501','calendar_manage_forbidden','a lead of another Department has no reach onto that path');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000002');
select lives_ok($q$select public.update_event((select id from ex2 where title='Move to org #248'),'To org','sedinta',(select id from gx where name='org'),'2026-10-01 12:00+00',null,null,null,null,0)$q$,'any live Group Role may move an Event onto the Organization Group');
reset role;
select ok((select scope='org' and dept_id is null and team_id is null and project_id is null from public.events where id=(select id from ex2 where title='Move to org #248')),'the Organization move re-derives an org Origin');
-- #601: the recipients are the Group Audience (private.group_audience), not the
-- explicit roster. The Organization Group has no roster rows at all -- its
-- members belong by Automatic Membership -- so a move INTO it must reach every
-- active Member but the actor, where the explicit-roster reading reached only
-- the old Project's roster.
select set_eq($q$select member_id from public.notifications where dedupe_key='event:'||(select id from ex2 where title='Move to org #248')||':group'$q$,$q$select id from public.profiles where status='activ' and id<>'24800000-0000-0000-0000-000000000002'$q$,'a move onto the Organization Group notifies every active Member except the actor');
select set_eq($q$select * from private.event_notification_recipients((select id from ex where title='Event a #248'))$q$,$q$select * from private.group_audience((select group_id from public.events where id=(select id from ex where title='Event a #248'))) union select member_id from public.event_attendance a join public.profiles p on p.id=a.member_id and p.status='activ' where a.event_id=(select id from ex where title='Event a #248') and a.status='going'$q$,'the recipient set is the Event Group''s Group Audience plus its active going attendees');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000001');
select throws_ok($q$select public.update_event(-1,'Updated','sedinta',(select id from gx where name='a'),'2026-10-01 12:00+00',null,null,null,null,0)$q$,'PT404','event_not_found','an unknown Event answers missing');
reset role;
select pg_temp.test_login('24800000-0000-0000-0000-000000000001','{}');
select throws_ok($q$select public.update_event((select id from ex2 where title='Team ancestor #248'),'Updated','sedinta',null,'2026-10-01 12:00+00',null,null,null,null,0)$q$,'PT400','event_group_required','a null Group is malformed input, named before the gate');
reset role;
update public.groups set status='archived' where id=(select id from gx where name='b');
reset role;
select pg_temp.test_login_leadership('24800000-0000-0000-0000-000000000001');
select throws_ok($q$select public.update_event((select id from ex2 where title='Team ancestor #248'),'Updated','sedinta',(select id from gx where name='b'),'2026-10-04 12:00+00',null,null,null,null,3)$q$,'42501','calendar_manage_forbidden','an Event cannot be moved into an archived Group');
-- #248: the other direction of the same rule. `Event a #248` already LIVES in
-- Group b, archived a moment ago. The active requirement belongs to the MOVE:
-- an edit that keeps the Event where it is is decided by the source authority
-- rule alone, or an archived Group's Events could never be corrected again --
-- only cancelled, since cancel_event has no target argument and no such check.
select lives_ok($q$select public.update_event((select id from ex where title='Event a #248'),'Archived-group edit','sedinta',(select id from gx where name='b'),'2026-10-01 12:00+00',null,null,null,null,3)$q$,'BC still edits an Event whose own Group has been archived');
reset role;
select * from finish();
rollback;
