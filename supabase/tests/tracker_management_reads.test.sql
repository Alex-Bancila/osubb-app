begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users(id,email)
select ('16800000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid, 'm168.'||i||'@test.local' from generate_series(1,6) i;
insert into public.profiles(id,full_name,email,role,status)
select id,email,email,'voluntar'::public.member_role,'activ'::public.member_status from auth.users where email like 'm168.%@test.local';
update public.profiles set role='bce' where id='16800000-0000-0000-0000-000000000001';
update public.profiles set role='bc',status='inactiv' where id='16800000-0000-0000-0000-000000000004';
update public.profiles set role='bc' where id='16800000-0000-0000-0000-000000000006';
insert into public.member_departments(member_id,dept_id) values('16800000-0000-0000-0000-000000000001','edu');
insert into public.teams(id,name,dept_id) values('m168-independent','M168 Independent',null);
insert into public.team_members(team_id,member_id) values('m168-independent','16800000-0000-0000-0000-000000000002');
insert into public.tasks(title,dept_id,team_id,assignment_mode,audience) values
('m168:edu','edu',null,'direct','local'),('m168:fin','fin',null,'direct','local'),('m168:team',null,'m168-independent','direct','local');

select ok(not (select prosecdef from pg_proc where oid='public.my_managed_task_ids()'::regprocedure),'management reads are invoker-rights');
select ok(not has_function_privilege('anon','public.can_manage_tasks()','execute'),'anon has no capability RPC grant');
select ok(not (select prosecdef from pg_proc where oid='public.can_read_all_tasks()'::regprocedure),'leadership capability is invoker-rights');
select ok(not has_function_privilege('anon','public.can_read_all_tasks()','execute'),'anon has no leadership capability grant');
select pg_temp.test_login_leadership('16800000-0000-0000-0000-000000000001');
select ok(public.can_manage_tasks(),'local BCE has a management tab');
select ok(public.can_read_all_tasks(),'live BCE has the all-Tasks tab');
select is((select array_agg(t.title order by t.title) from public.my_managed_task_ids() m join public.tasks t on t.id=m.task_id where t.title like 'm168:%'),array['m168:edu'],'local BCE manages only EDU');
reset role;
select pg_temp.test_login_leadership('16800000-0000-0000-0000-000000000002');
select ok(public.can_manage_tasks(),'independent Team member has a management tab');
select is((select array_agg(t.title order by t.title) from public.my_managed_task_ids() m join public.tasks t on t.id=m.task_id where t.title like 'm168:%'),array['m168:team'],'Team member manages only own Team');
reset role;
select pg_temp.test_login_leadership('16800000-0000-0000-0000-000000000003');
select ok(not public.can_manage_tasks(),'ordinary Member has no management tab');
select ok(not public.can_read_all_tasks(),'ordinary Member has no all-Tasks tab');
select is((select count(*) from public.my_managed_task_ids()),0::bigint,'ordinary Member has no managed rows');
reset role;
select pg_temp.test_login_leadership('16800000-0000-0000-0000-000000000004');
select ok(not public.can_manage_tasks(),'inactive BC has no management capability');
select is((select count(*) from public.my_managed_task_ids()),0::bigint,'inactive BC has no managed rows');
reset role;
select pg_temp.test_login('16800000-0000-0000-0000-000000000004',jsonb_build_object('member_role','bc','member_level',6,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select ok(not public.can_read_all_tasks(),'inactive BC is denied despite stale leadership claims');
reset role;
select pg_temp.test_login('16800000-0000-0000-0000-000000000005','{}');
select ok(not public.can_manage_tasks(),'claimless has no management capability');
select is((select count(*) from public.my_managed_task_ids()),0::bigint,'claimless has no managed rows');
reset role;
select pg_temp.test_login_leadership('16800000-0000-0000-0000-000000000006');
select is((select count(*) from public.my_managed_task_ids() m join public.tasks t on t.id=m.task_id where t.title like 'm168:%'),3::bigint,'BC manages all fixture Origins');
reset role;
set local role anon;
select throws_ok('select * from public.my_managed_task_ids()','42501',null,'anon cannot call management RPC');
select throws_ok('select public.can_read_all_tasks()','42501',null,'anon cannot call leadership capability RPC');
reset role;
select * from finish();
rollback;
