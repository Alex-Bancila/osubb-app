-- create_event.test.sql — #370 scope-local Calendar creation authority.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(29);

truncate public.events, public.event_attendance cascade;

insert into auth.users (id, email) values
 ('37000000-0000-0000-0000-000000000001','edu.resp.370@test.local'),
 ('37000000-0000-0000-0000-000000000002','fin.bce.370@test.local'),
 ('37000000-0000-0000-0000-000000000003','ind.member.370@test.local'),
 ('37000000-0000-0000-0000-000000000004','outsider.370@test.local'),
 ('37000000-0000-0000-0000-000000000005','project.lead.370@test.local'),
 ('37000000-0000-0000-0000-000000000006','project.resp.370@test.local'),
 ('37000000-0000-0000-0000-000000000007','project.member.370@test.local'),
 ('37000000-0000-0000-0000-000000000008','bc.370@test.local'),
 ('37000000-0000-0000-0000-000000000009','inactive.370@test.local');
insert into public.profiles (id, full_name, email, role, status) values
 ('37000000-0000-0000-0000-000000000001','Edu Responsabil','edu.resp.370@test.local','responsabil','activ'),
 ('37000000-0000-0000-0000-000000000002','Finance BCE','fin.bce.370@test.local','bce','activ'),
 ('37000000-0000-0000-0000-000000000003','Independent Member','ind.member.370@test.local','voluntar','activ'),
 ('37000000-0000-0000-0000-000000000004','Outsider','outsider.370@test.local','voluntar','activ'),
 ('37000000-0000-0000-0000-000000000005','Project Lead','project.lead.370@test.local','voluntar','activ'),
 ('37000000-0000-0000-0000-000000000006','Project Responsible','project.resp.370@test.local','responsabil','activ'),
 ('37000000-0000-0000-0000-000000000007','Project Member','project.member.370@test.local','voluntar','activ'),
 ('37000000-0000-0000-0000-000000000008','Global BC','bc.370@test.local','bc','activ'),
 ('37000000-0000-0000-0000-000000000009','Inactive BC','inactive.370@test.local','bc','inactiv');
insert into public.member_departments (member_id, dept_id) values
 ('37000000-0000-0000-0000-000000000001','edu'),
 ('37000000-0000-0000-0000-000000000002','fin');
insert into public.teams (id, name, dept_id) values
 ('calendar-dept-team-370','Finance Team #370','fin'),
 ('calendar-independent-370','Independent Team #370',null);
insert into public.team_members (team_id, member_id) values
 ('calendar-independent-370','37000000-0000-0000-0000-000000000003');
insert into public.projects (name, leader_id, created_by) values
 ('Calendar Project #370','37000000-0000-0000-0000-000000000005','37000000-0000-0000-0000-000000000008');
insert into public.project_members (project_id, member_id, project_role)
select project.id, member_id, project_role from public.projects as project
cross join (values
 ('37000000-0000-0000-0000-000000000006'::uuid,'responsible'),
 ('37000000-0000-0000-0000-000000000007'::uuid,'member')
) as membership(member_id, project_role) where project.name='Calendar Project #370';
create temp table fx as select id as project_id from public.projects where name='Calendar Project #370';
grant select on fx to authenticated;

select has_function('public','create_event',array['text','text','text','timestamp with time zone','timestamp with time zone','text','integer','text','text','text','bigint','integer'],'create_event exposes the #370 signature');
select has_function('private','create_event_impl',array['text','text','text','timestamp with time zone','timestamp with time zone','text','integer','text','text','text','bigint','integer'],'the private implementation exists');
select ok(not (select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_event'),'the public wrapper is security invoker');
select ok((select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='create_event_impl'),'the private implementation is security definer');
select ok(has_function_privilege('authenticated','public.create_event(text,text,text,timestamp with time zone,timestamp with time zone,text,integer,text,text,text,bigint,integer)','execute'),'authenticated may call the wrapper');
select ok(not has_function_privilege('anon','public.create_event(text,text,text,timestamp with time zone,timestamp with time zone,text,integer,text,text,text,bigint,integer)','execute'),'anon cannot call the wrapper');
select ok(not has_table_privilege('authenticated','public.events','insert'),'direct Event inserts remain revoked');

select pg_temp.test_login('37000000-0000-0000-0000-000000000001',jsonb_build_object('member_role','responsabil','member_level',4,'dept_ids','["edu"]'::jsonb,'team_ids','[]'::jsonb));
select lives_ok($$select public.create_event('Org Event','sedinta','org',now()+interval '1 day',p_min_level:=4)$$,'a Responsible creates an organization Event');
select throws_ok($$select public.create_event('Finance denied','sedinta','dept',now()+interval '1 day',p_dept_id:='fin')$$,'42501','calendar_manage_forbidden','an EDU Responsible cannot create a Finance Event');
select throws_ok($$select public.create_event('Too high','sedinta','org',now()+interval '1 day',p_min_level:=5)$$,'PT400','event_min_level_exceeds_actor','Minimum Level cannot exceed the creator live level');
reset role;

select pg_temp.test_login('37000000-0000-0000-0000-000000000002',jsonb_build_object('member_role','bce','member_level',5,'dept_ids','["fin"]'::jsonb,'team_ids','[]'::jsonb));
select lives_ok($$select public.create_event('Finance Event','sedinta','dept',now()+interval '2 days',p_dept_id:='fin',p_min_level:=5)$$,'the local Finance BCE creates a Finance Event');
select lives_ok($$select public.create_event('Finance Team Event','call','team',now()+interval '2 days',p_team_id:='calendar-dept-team-370')$$,'the parent-Department BCE creates its Department-Team Event');
select throws_ok($$select public.create_event('BCE too high','sedinta','org',now()+interval '1 day',p_min_level:=6)$$,'PT400','event_min_level_exceeds_actor','a BCE cannot select BC+');
reset role;

select pg_temp.test_login('37000000-0000-0000-0000-000000000003',jsonb_build_object('member_role','voluntar','member_level',1,'dept_ids','[]'::jsonb,'team_ids','["calendar-independent-370"]'::jsonb));
select lives_ok($$select public.create_event('Independent Event','activitate','team',now()+interval '3 days',p_team_id:='calendar-independent-370')$$,'a level-1 active Independent-Team member creates its Event');
reset role;
select is((select dept_id from public.events where title='Independent Event'),null::text,'an Independent-Team Event stores no Department');

select pg_temp.test_login('37000000-0000-0000-0000-000000000004',jsonb_build_object('member_role','voluntar','member_level',1,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$select public.create_event('Independent denied','activitate','team',now()+interval '3 days',p_team_id:='calendar-independent-370')$$,'42501','calendar_manage_forbidden','a nonmember cannot create an Independent-Team Event');
reset role;

select pg_temp.test_login('37000000-0000-0000-0000-000000000005',jsonb_build_object('member_role','voluntar','member_level',1,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select lives_ok($$select public.create_event('Lead Project Event','deadline','project',now()+interval '4 days',p_project_id:=(select project_id from fx))$$,'the Project lead creates a Project Event');
reset role;
select pg_temp.test_login('37000000-0000-0000-0000-000000000006',jsonb_build_object('member_role','responsabil','member_level',4,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select lives_ok($$select public.create_event('Responsible Project Event','deadline','project',now()+interval '4 days',p_project_id:=(select project_id from fx),p_min_level:=4)$$,'a Project Responsible creates a Project Event');
reset role;
select pg_temp.test_login('37000000-0000-0000-0000-000000000007',jsonb_build_object('member_role','voluntar','member_level',1,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$select public.create_event('Member Project denied','deadline','project',now()+interval '4 days',p_project_id:=(select project_id from fx))$$,'42501','calendar_manage_forbidden','a plain Project member cannot create a Project Event');
reset role;

select pg_temp.test_login('37000000-0000-0000-0000-000000000008',jsonb_build_object('member_role','bc','member_level',6,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select lives_ok($$select public.create_event('BC override','eveniment','team',now()+interval '5 days',p_team_id:='calendar-independent-370',p_min_level:=6)$$,'BC has global scope override');
select throws_ok($$select public.create_event('Invalid minimum','sedinta','org',now()+interval '1 day',p_min_level:=2)$$,'PT400','invalid_event_min_level','unsupported Minimum Level is rejected cleanly');
select throws_ok($$select public.create_event('Missing team','sedinta','team',now()+interval '1 day',p_team_id:='missing')$$,'PT404','team_not_found','a missing Team has a stable error');
select throws_ok($$select public.create_event('Missing project','sedinta','project',now()+interval '1 day',p_project_id:=999999999)$$,'PT404','project_not_found','a missing Project has a stable error');
select throws_ok($$select public.create_event('Bad fields','sedinta','org',now()+interval '1 day',p_dept_id:='edu')$$,'PT400','invalid_event_scope_fields','inconsistent scope fields are rejected');
reset role;

select pg_temp.test_login('37000000-0000-0000-0000-000000000009',jsonb_build_object('member_role','bc','member_level',6,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$select public.create_event('Inactive','sedinta','org',now()+interval '1 day')$$,'42501','calendar_manage_forbidden','an inactive Member is denied despite stale claims');
reset role;

select is((select count(*) from public.events),7::bigint,'only authorized calls created Events');
select is((select project_id from public.events where title='Lead Project Event'),(select project_id from fx),'a Project Event stores its Project owner');
select is((select min_level from public.events where title='Finance Event'),5,'the selected Minimum Level is stored');

select pg_temp.test_clear_jwt(); set local role anon;
select throws_ok($$select public.create_event('Anon','sedinta','org',now()+interval '1 day')$$,'42501',null,'anon cannot execute create_event');
reset role;
select * from finish();
rollback;
