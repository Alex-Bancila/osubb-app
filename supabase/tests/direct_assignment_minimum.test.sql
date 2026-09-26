-- #350: direct reassignment enforces the same hard eligibility as the picker.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(7);
\ir _group_task_fixtures.psql
select pg_temp.g521_task('minimum350', 'project');
-- OD9: a rolled-back setting fixture, not a production Group write path.
update public.groups set min_level=3, application_level=3 where name='Project #521';
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select throws_ok(format('select public.assign_task_executor(%s,%L)',
 (select id from g521_tasks where name='minimum350'),pg_temp.g521_uid(5)),
 'PT400','invalid_executor','BC cannot bypass the Origin Minimum Level');
reset role;
select is((select count(*) from public.task_assignments where task_id=(select id from g521_tasks where name='minimum350')),0::bigint,'denied target creates no Assignment');
select is((select count(*) from public.task_activity where task_id=(select id from g521_tasks where name='minimum350')),0::bigint,'denied target creates no activity');
select is((select count(*) from public.notifications where task_id=(select id from g521_tasks where name='minimum350')),0::bigint,'denied target sends no notification');
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select lives_ok(format('select public.assign_task_executor(%s,%L)',
 (select id from g521_tasks where name='minimum350'),pg_temp.g521_uid(12)),
 'a Member exactly at the Minimum Level may be assigned outside their memberships');
reset role;
select is((select member_id from public.task_assignments where task_id=(select id from g521_tasks where name='minimum350') and ended_at is null),pg_temp.g521_uid(12),'the eligible outsider is the sole active Executor');
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select throws_ok(format('select public.assign_task_executor(%s,%L)',
 (select id from g521_tasks where name='minimum350'),pg_temp.g521_uid(5)),
 'PT409','task_already_assigned','state conflicts retain precedence over target eligibility');
reset role;
select * from finish();
rollback;
