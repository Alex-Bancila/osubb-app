-- #189: the public capability delegates to the same live gate as evaluation.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(9);
insert into auth.users(id,email) values
('18900000-0000-0000-0000-000000000001','bc.189@test.local'),
('18900000-0000-0000-0000-000000000002','member.189@test.local');
insert into public.profiles(id,full_name,email,role,status) values
('18900000-0000-0000-0000-000000000001','BC 189','bc.189@test.local','bc','activ'),
('18900000-0000-0000-0000-000000000002','Member 189','member.189@test.local','voluntar','activ');
insert into public.tasks(title,description,deadline,dept_id,audience,assignment_mode,status,created_by)
values ('Capability #189','Review capability',now()+interval '1 day','edu','org','public','todo','18900000-0000-0000-0000-000000000001');
create temporary table target as select id from public.tasks where title='Capability #189';
grant select on target to authenticated;
select has_function('public','can_evaluate_task',array['bigint']);
select ok(not has_function_privilege('anon','public.can_evaluate_task(bigint)','execute'),'anon cannot query capability');
select ok(has_function_privilege('authenticated','public.can_evaluate_task(bigint)','execute'),'members may query capability');
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
select is(public.can_evaluate_task((select id from target)),false,'claimless caller denied for an existing task');
select set_config('request.jwt.claims','{"sub":"18900000-0000-0000-0000-000000000002","app_metadata":{"member_role":"voluntar","member_level":1,"dept_ids":[],"team_ids":[]}}',true);
select is(public.can_evaluate_task((select id from target)),false,'ordinary member cannot evaluate');
select set_config('request.jwt.claims','{"sub":"18900000-0000-0000-0000-000000000001","app_metadata":{"member_role":"bc","member_level":6,"dept_ids":[],"team_ids":[]}}',true);
select is(public.can_evaluate_task((select id from target)),true,'live BC can evaluate');
select is(public.can_evaluate_task(-189),false,'missing target denied');
reset role;
update public.profiles set status='inactiv' where id='18900000-0000-0000-0000-000000000001';
set local role authenticated;
select is(public.can_evaluate_task((select id from target)),false,'stale BC claims cannot revive an inactive member');
reset role;
select ok(not prosecdef,'wrapper retains Task RLS') from pg_proc where oid='public.can_evaluate_task(bigint)'::regprocedure;
select * from finish();
rollback;
