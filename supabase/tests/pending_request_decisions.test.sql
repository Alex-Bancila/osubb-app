begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path=public,extensions;
create extension if not exists pgtap with schema extensions;
select plan(12);
\ir _group_task_fixtures.psql
insert into public.completed_work_requests(requester_id,group_id,description)
select pg_temp.g521_uid(n),g.id,'decision353-'||n from public.groups g cross join (values(1),(2),(3),(5)) members(n) where g.legacy_project_id=(select id from public.projects where name='Project #521');
select ok(not has_function_privilege('anon','public.pending_request_decisions()','execute'),'anonymous has no endpoint grant');
select ok(not has_function_privilege('service_role','public.pending_request_decisions()','execute'),'service role has no endpoint grant');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select is((select count(*) from public.pending_request_decisions() where description like 'decision353-%'),3::bigint,'BC sees all other pending requesters, never self');
select ok(not exists(select 1 from public.pending_request_decisions() where requester_id=auth.uid()),'self excluded explicitly');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select is((select count(*) from public.pending_request_decisions() where description like 'decision353-%'),3::bigint,'Group Manager can decide other requesters');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select is((select count(*) from public.pending_request_decisions() where description like 'decision353-%'),2::bigint,'Responsible sees ordinary and BC requester without Group role, not manager or self');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(4));
select ok(not exists(select 1 from public.pending_request_decisions() where requester_id=pg_temp.g521_uid(3)),'Responsible cannot decide peer Responsible');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(5));
select is((select count(*) from public.pending_request_decisions()),0::bigint,'ordinary requester does not get decision actions');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(12));
select is((select count(*) from public.pending_request_decisions()),0::bigint,'outside voting Member does not get decision actions');
reset role;
select pg_temp.test_login(pg_temp.g521_uid(1),'{}'::jsonb);
select is((select count(*) from public.pending_request_decisions()),0::bigint,'claimless session gets no queue');
reset role;
update public.profiles set status='inactiv' where id=pg_temp.g521_uid(1);
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select is((select count(*) from public.pending_request_decisions()),0::bigint,'live deactivation overrides stale claims');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok(format('select public.reject_completed_work_request(%s,%L)',(select id from public.completed_work_requests where description='decision353-5'),'Notă'),'queue uses the existing decision command');
reset role;
select * from finish();
rollback;
