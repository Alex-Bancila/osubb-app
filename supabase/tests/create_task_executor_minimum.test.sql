begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path=public,extensions;
create extension if not exists pgtap with schema extensions;
select plan(8);
\ir _group_task_fixtures.psql
select pg_temp.g521_task('parent348','project',null,'todo','direct','umbrella');
-- Rolled-back settings fixture, not a production Group mutation path.
update public.groups set min_level=3,application_level=3 where name='Project #521';
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select throws_ok($$select public.create_task('Denied root #348', null, now()+interval '1 day', 'local', 'direct', p_executor_id => pg_temp.g521_uid(5), p_group_id => (select group_id from public.tasks where id=(select id from g521_tasks where name='parent348')))$$,'PT400','invalid_executor','root Task creation rejects an active but below-minimum Executor');
select throws_ok($$select public.create_task('Denied child #348', null, now()+interval '1 day', 'local', 'direct', p_executor_id => pg_temp.g521_uid(5), p_parent_task_id => (select id from g521_tasks where name='parent348'))$$,'PT400','invalid_executor','Subtask creation enforces the inherited Group Minimum Level');
reset role;
select is((select count(*) from public.tasks where title like 'Denied % #348'),0::bigint,'failed creation leaves no Task, Assignment, activity or notification to reference');
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select lives_ok($$select public.create_task('Eligible child #348', null, now()+interval '1 day', 'local', 'direct', p_executor_id => pg_temp.g521_uid(12), p_parent_task_id => (select id from g521_tasks where name='parent348'))$$,'a Member exactly at Minimum Level can execute a Subtask outside their memberships');
reset role;
select is((select a.member_id from public.task_assignments a join public.tasks t on t.id=a.task_id where t.title='Eligible child #348' and a.ended_at is null),pg_temp.g521_uid(12),'eligible outsider receives the sole active Assignment');
select is((select group_id from public.tasks where title='Eligible child #348'),(select group_id from public.tasks where id=(select id from g521_tasks where name='parent348')),'the created Subtask keeps its parent Group');
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select lives_ok($$select public.create_task('Unassigned child #348', null, now()+interval '1 day', 'local', 'direct', p_parent_task_id => (select id from g521_tasks where name='parent348'))$$,'a direct Subtask may still start without an Executor');
select lives_ok($$select public.create_task('Public child #348', null, now()+interval '1 day', 'local', 'public', p_parent_task_id => (select id from g521_tasks where name='parent348'))$$,'public Subtask creation remains unchanged');
reset role;
select * from finish();
rollback;
