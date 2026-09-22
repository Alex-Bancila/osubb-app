-- #370: Group Event creation, least privilege, validation and read integration.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(59);
truncate public.events, public.event_attendance cascade;
create temp table people (n integer, name text, role public.member_role, status public.member_status);
insert into people values
(1,'bc','bc','activ'),(2,'bce_edu','bce','activ'),(3,'bce_foreign','bce','activ'),
(4,'coord','voluntar','activ'),(5,'resp','voluntar','activ'),(6,'ordinary_edu','voluntar','activ'),
(7,'ordinary_proj','voluntar','activ'),(8,'ind_a','voluntar','activ'),(9,'ind_b','voluntar','activ'),
(10,'dt_member','voluntar','activ'),(11,'vot','vot','activ'),(12,'inactive_bce','bce','inactiv'),
(13,'claimless','voluntar','activ'),(14,'moderator','moderator','activ');
insert into auth.users(id,email)
select ('37000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid, name || '.370@test.local' from people;
insert into public.profiles(id,full_name,email,role,status)
select ('37000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,name,name || '.370@test.local',role,status from people;
insert into public.member_departments(member_id,dept_id)
select ('37000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
case when n=3 then 'pr' else 'edu' end from people where n in (2,3,4,6,12,13);
insert into public.teams(id,name,dept_id) values ('t-370-dt','Child #370','edu'),('t-370-ind','Independent #370',null);
insert into public.team_members(team_id,member_id) values
('t-370-dt','37000000-0000-0000-0000-000000000010'),
('t-370-ind','37000000-0000-0000-0000-000000000008'),
('t-370-ind','37000000-0000-0000-0000-000000000009');
insert into public.projects(name,leader_id,created_by) values
('Project #370','37000000-0000-0000-0000-000000000004','37000000-0000-0000-0000-000000000001'),
('Archived #370','37000000-0000-0000-0000-000000000004','37000000-0000-0000-0000-000000000001');
insert into public.project_members(project_id,member_id,project_role)
select id,'37000000-0000-0000-0000-000000000005','responsible' from public.projects where name='Project #370';
insert into public.project_members(project_id,member_id,project_role)
select id,'37000000-0000-0000-0000-000000000007','member' from public.projects where name='Project #370';
update public.projects set status='archived' where name='Archived #370';
-- Wave 2 OD9 exception: gated/native fixtures only, rolled back with this suite.

insert into public.groups(name,category,min_level,automatic_membership) values ('AG #370','team',3,true);
create temp table fx as
select id, case when legacy_dept_id='edu' then 'edu' when legacy_dept_id='org' then 'org'
when legacy_team_id='t-370-dt' then 'dt' when legacy_team_id='t-370-ind' then 'ind'
when name='Project #370' then 'project' when name='Archived #370' then 'archived'
when name='AG #370' then 'ag' end as name from public.groups;
grant select on fx to authenticated,anon;

create function pg_temp.login(n integer) returns void language plpgsql as $$
begin
 perform pg_temp.test_login(('37000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 '{"member_role":"bc","member_level":6}'::jsonb);
end; $$;
select hasnt_function('public','create_event',array['text','text','text','timestamp with time zone','timestamp with time zone','text','integer','text','text','text'],'legacy overload is removed');
select ok(not (select prosecdef from pg_proc where oid='public.create_event(text,text,bigint,timestamptz,timestamptz,text,integer,text,integer)'::regprocedure),'wrapper is invoker');
select ok((select prosecdef from pg_proc where oid='private.create_event_impl(text,text,bigint,timestamptz,timestamptz,text,integer,text,integer)'::regprocedure),'implementation is definer');
select ok(not has_table_privilege('authenticated','public.events','insert'),'direct insert denied');
select ok(not has_table_privilege('authenticated','public.events','update'),'direct update denied');
select ok(not has_table_privilege('authenticated','public.events','delete'),'direct delete denied');
select pg_temp.login(2);
select lives_ok($$select public.create_event('case-2-edu','sedinta',(select id from fx where name='edu'),now()+interval '1 day')$$,'persona 2 creates in edu');
reset role;
select pg_temp.login(2);
select lives_ok($$select public.create_event('case-2-dt','sedinta',(select id from fx where name='dt'),now()+interval '1 day')$$,'persona 2 creates in dt');
reset role;
select pg_temp.login(3);
select throws_ok($$select public.create_event('case-3-edu','sedinta',(select id from fx where name='edu'),now()+interval '1 day')$$,'42501','calendar_manage_forbidden','persona 3 denied in edu');
reset role;
select pg_temp.login(6);
select throws_ok($$select public.create_event('case-6-edu','sedinta',(select id from fx where name='edu'),now()+interval '1 day')$$,'42501','calendar_manage_forbidden','persona 6 denied in edu');
reset role;
-- #370 delta: a Group Role held on ANOTHER Group is not authority here. Only the Organization
-- Group reads "any Group Role anywhere"; every other Group asks require_group_work_manager
-- about its own path. Persona 4 is Coordonator (Manager) of Project #370 and nothing in edu.
select pg_temp.login(4);
select throws_ok($$select public.create_event('case-4-edu','sedinta',(select id from fx where name='edu'),now()+interval '1 day')$$,'42501','calendar_manage_forbidden','a Manager of another Group is denied in edu');
reset role;
select pg_temp.login(4);
select lives_ok($$select public.create_event('case-4-project','sedinta',(select id from fx where name='project'),now()+interval '1 day')$$,'persona 4 creates in project');
reset role;
select pg_temp.login(5);
select lives_ok($$select public.create_event('case-5-project','sedinta',(select id from fx where name='project'),now()+interval '1 day')$$,'persona 5 creates in project');
reset role;
select pg_temp.login(7);
select throws_ok($$select public.create_event('case-7-project','sedinta',(select id from fx where name='project'),now()+interval '1 day')$$,'42501','calendar_manage_forbidden','persona 7 denied in project');
reset role;
select pg_temp.login(8);
select lives_ok($$select public.create_event('case-8-ind','sedinta',(select id from fx where name='ind'),now()+interval '1 day')$$,'persona 8 creates in ind');
reset role;
select pg_temp.login(10);
select throws_ok($$select public.create_event('case-10-dt','sedinta',(select id from fx where name='dt'),now()+interval '1 day')$$,'42501','calendar_manage_forbidden','persona 10 denied in dt');
reset role;
select pg_temp.login(1);
select lives_ok($$select public.create_event('case-1-edu','sedinta',(select id from fx where name='edu'),now()+interval '1 day')$$,'persona 1 creates in edu');
reset role;
select pg_temp.login(14);
select lives_ok($$select public.create_event('case-14-project','sedinta',(select id from fx where name='project'),now()+interval '1 day')$$,'persona 14 creates in project');
reset role;
select pg_temp.login(4);
select lives_ok($$select public.create_event('case-4-org','sedinta',(select id from fx where name='org'),now()+interval '1 day')$$,'persona 4 creates in org');
reset role;
select pg_temp.login(5);
select lives_ok($$select public.create_event('case-5-org','sedinta',(select id from fx where name='org'),now()+interval '1 day')$$,'persona 5 creates in org');
reset role;
select pg_temp.login(8);
select lives_ok($$select public.create_event('case-8-org','sedinta',(select id from fx where name='org'),now()+interval '1 day')$$,'persona 8 creates in org');
reset role;
select pg_temp.login(6);
select throws_ok($$select public.create_event('case-6-org','sedinta',(select id from fx where name='org'),now()+interval '1 day')$$,'42501','calendar_manage_forbidden','persona 6 denied in org');
reset role;
-- #370 delta: rank alone is not a Group Role. Persona 11 is Membru cu Drept de Vot (level 3,
-- above three of the four Minimum Levels) and holds no roster row anywhere.
select pg_temp.login(11);
select throws_ok($$select public.create_event('case-11-org','sedinta',(select id from fx where name='org'),now()+interval '1 day')$$,'42501','calendar_manage_forbidden','a ranked member holding no Group Role is denied in org');
reset role;
select pg_temp.login(1);
select lives_ok($$select public.create_event('case-1-org','sedinta',(select id from fx where name='org'),now()+interval '1 day')$$,'persona 1 creates in org');
reset role;
select pg_temp.login(12);
select throws_ok($$select public.create_event('case-12-org','sedinta',(select id from fx where name='org'),now()+interval '1 day')$$,'42501','calendar_manage_forbidden','persona 12 denied in org');
reset role;
select pg_temp.login(1);
select throws_ok($$select public.create_event('case-1-archived','sedinta',(select id from fx where name='archived'),now()+interval '1 day')$$,'42501','calendar_manage_forbidden','persona 1 denied in archived');
reset role;
select pg_temp.login(4);
select throws_ok($$select public.create_event('case-4-archived','sedinta',(select id from fx where name='archived'),now()+interval '1 day')$$,'42501','calendar_manage_forbidden','persona 4 denied in archived');
reset role;
select is((select scope::text||':'||coalesce(dept_id,'-') from public.events where title='case-8-ind'),'team:-','Independent Team has no Department');
select is((select dept_id from public.events where title='case-2-dt'),'edu','Department-Team parent is derived');
select is((select created_by from public.events where title='case-5-project'),'37000000-0000-0000-0000-000000000005'::uuid,'creator comes from authenticated identity');
-- #370 delta: the command inserts group_id and nothing legacy; events_sync_group_origin (#519)
-- derives the whole (scope, dept_id, team_id, project_id) Origin. Pinned for the two shapes the
-- suite did not already pin -- a Project Group and the Organization Group.
select is((select e.scope::text||':'||coalesce(e.dept_id,'-')||':'||coalesce(e.team_id,'-')||':'||coalesce(e.project_id::text,'-')
           from public.events as e where e.title='case-4-project'),
          'project:-:-:'||(select p.id::text from public.projects as p where p.name='Project #370'),
          'a Project Group derives scope project and project_id, nothing else');
select is((select e.scope::text||':'||coalesce(e.dept_id,'-')||':'||coalesce(e.team_id,'-')||':'||coalesce(e.project_id::text,'-')
           from public.events as e where e.title='case-1-org'),
          'org:-:-:-',
          'the Organization Group derives scope org and no Origin column at all');
-- A legacy-mapped Event owner can sit below arbitrarily deep native ancestors.
insert into public.groups(name,category,parent_id)
values ('Middle #370','team',(select id from fx where name='project'));
update public.groups set parent_id=(select id from public.groups where name='Middle #370')
where id=(select id from fx where name='dt');
select pg_temp.login(5);
select lives_ok($$select public.create_event('deep responsible','sedinta',(select id from fx where name='dt'),now())$$,'Responsible authority flows through a native intermediate ancestor');
reset role;
update public.groups set parent_id=(select id from fx where name='edu') where id=(select id from fx where name='dt');
select pg_temp.login(1);
select throws_ok($$select public.create_event('missing','sedinta',-1,now())$$,'42501','calendar_manage_forbidden','missing Group is indistinguishable');
reset role;
select pg_temp.test_login('37000000-0000-0000-0000-000000000004','{"provider":"email"}'::jsonb);
select throws_ok($$select public.create_event('claimless','sedinta',(select id from fx where name='org'),now())$$,'42501','calendar_manage_forbidden','claimless denied');
select throws_ok($$select public.create_event(null,'sedinta',null,now())$$,'PT400','invalid_event_title','malformed title precedes claimless gate');
select throws_ok($$select public.create_event(E'\t\n','sedinta',null,now())$$,'PT400','invalid_event_title','malformed title precedes claimless gate');
select throws_ok($$select public.create_event('x','wrong',null,now())$$,'PT400','invalid_event_type','malformed type precedes claimless gate');
select throws_ok($$select public.create_event('x',null,null,now())$$,'PT400','invalid_event_type','malformed type precedes claimless gate');
select throws_ok($$select public.create_event('x','sedinta',null,null)$$,'PT400','invalid_event_interval','malformed interval precedes claimless gate');
select throws_ok($$select public.create_event('x','sedinta',null,now(),now())$$,'PT400','invalid_event_interval','malformed interval precedes claimless gate');
select throws_ok($$select public.create_event('x','sedinta',null,now(),p_capacity:=0)$$,'PT400','invalid_event_capacity','malformed capacity precedes claimless gate');
select throws_ok($$select public.create_event('x','sedinta',null,now(),p_min_level:=4)$$,'PT400','invalid_event_min_level','malformed min_level precedes claimless gate');
select throws_ok($$select public.create_event('x','sedinta',null,now(),p_min_level:=null)$$,'PT400','invalid_event_min_level','malformed min_level precedes claimless gate');
-- #370 delta: a call that names no Group is malformed, not forbidden -- the claimless caller is
-- told what is missing instead of being refused. Same reason string the #519 trigger uses for an
-- Event that names no Group; PT400 here because a rejected argument is not a trigger invariant.
select throws_ok($$select public.create_event('x','sedinta',null,now())$$,'PT400','event_group_required','a null Group is malformed and precedes the claimless gate');
reset role;
select pg_temp.login(1);
select throws_ok($$select public.create_event('x','sedinta',null,now())$$,'PT400','event_group_required','a null Group is malformed for an authorized caller too, never calendar_manage_forbidden');
reset role;
update public.groups set min_level=3,application_level=3 where legacy_team_id='t-370-dt';
select pg_temp.login(2);
select throws_ok($$select public.create_event('below','sedinta',(select id from fx where name='dt'),now())$$,'PT400','event_min_level_below_group','Event cannot lower Group minimum');
select lives_ok($$select public.create_event('matching','sedinta',(select id from fx where name='dt'),now(),p_min_level:=3)$$,'Event matches Group minimum');
select lives_ok($$select public.create_event('leaders only','sedinta',(select id from fx where name='org'),now(),p_min_level:=5)$$,'Group manager creates raised-minimum Organization Event');
-- #370 delta: the upper bound is the actor's LIVE level and the exemption starts above BC --
-- persona 2 is BCE (level 5) and cannot reach the highest supported minimum.
select throws_ok($$select public.create_event('bce reaches too high','sedinta',(select id from fx where name='org'),now(),p_min_level:=6)$$,'PT400','event_min_level_above_actor','a BCE cannot raise an Event above level 5');
reset role;
-- #370 delta: the same bound inside the Organization branch, where authority came from a Group
-- Role rather than rank -- holding a Manager row does not raise your level.
select pg_temp.login(4);
select throws_ok($$select public.create_event('coord reaches too high','sedinta',(select id from fx where name='org'),now(),p_min_level:=3)$$,'PT400','event_min_level_above_actor','a Group Manager at level 1 cannot raise an Organization Event to level 3');
reset role;
select pg_temp.login(5);
select throws_ok($$select public.create_event('above','sedinta',(select id from fx where name='project'),now(),p_min_level:=3)$$,'PT400','event_min_level_above_actor','live level overrides inflated token');
select is((select count(*) from public.events where title='leaders only'),0::bigint,'level1 cannot read newly created level5 Event');
reset role;
select pg_temp.login(3);
select is((select count(*) from public.events where title='leaders only'),1::bigint,'eligible unrelated BCE reads new level5 Event');
reset role;
select pg_temp.login(12);
select is((select count(*) from public.events where title='leaders only'),0::bigint,'inactive stale claim cannot read new Event');
reset role;
select pg_temp.test_login('37000000-0000-0000-0000-000000000004','{"provider":"email"}'::jsonb);
select is((select count(*) from public.events),0::bigint,'claimless reads no Events');
reset role;
select pg_temp.login(14);
select lives_ok($$select public.create_event('moderator','sedinta',(select id from fx where name='org'),now(),p_min_level:=6)$$,'Moderator creates highest supported minimum');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$select public.create_event('anon','sedinta',null,now())$$,'42501',null,'anon cannot call command');
-- #370 delta: the assertion above passes on the code alone, which anon would still raise if the
-- wrapper were granted to it (it would then fail one step later, on usage of schema private).
-- Pin the message so the revoke on the WRAPPER is what this suite is testing.
select throws_ok($$select public.create_event('anon','sedinta',null,now())$$,'42501','permission denied for function create_event','anon is stopped at the wrapper, not at the private schema behind it');
reset role;
select * from finish();
rollback;
