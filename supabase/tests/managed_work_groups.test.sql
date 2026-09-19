-- #180: draft-form origins use live server authority, never token-side role guesses.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(14);
select has_function('public', 'managed_work_groups', array[]::text[], 'read-only origin RPC exists');
select is((select prosecdef from pg_proc where oid = 'public.managed_work_groups()'::regprocedure), false, 'origin RPC uses invoker RLS');
insert into auth.users(id,email) values
('18000000-0000-0000-0000-000000000001','manager180@test.local'),
('18000000-0000-0000-0000-000000000002','ordinary180@test.local'),
('18000000-0000-0000-0000-000000000003','bc180@test.local');
insert into public.profiles(id,email,full_name,role,status) values
('18000000-0000-0000-0000-000000000001','manager180@test.local','Manager 180','voluntar','activ'),
('18000000-0000-0000-0000-000000000002','ordinary180@test.local','Ordinary 180','voluntar','activ'),
('18000000-0000-0000-0000-000000000003','bc180@test.local','BC 180','bc','activ');
-- Native hierarchy fixtures, rolled back with the test (Wave 2 authority coverage).
insert into public.groups(name,category) values ('Parent #180','team'),('Foreign #180','team'),('Archived #180','team');
insert into public.groups(name,category,parent_id) select 'Child #180','team',id from public.groups where name='Parent #180';
insert into public.groups(name,category,parent_id) select 'Grandchild #180','team',id from public.groups where name='Child #180';
insert into public.groups(name,category,parent_id) select 'Deep child #180','team',id from public.groups where name='Grandchild #180';
update public.groups set parent_id=(select id from public.groups where name='Parent #180') where name='Archived #180';
update public.groups set status='archived' where name='Archived #180';
insert into public.group_members(group_id,member_id,group_role)
select id,'18000000-0000-0000-0000-000000000001','manager' from public.groups where name='Parent #180';
select pg_temp.test_login_leadership('18000000-0000-0000-0000-000000000001');
select is((select count(*) from public.managed_work_groups() where name like '%#180'),4::bigint,'ancestor Manager receives the full four-level hierarchy');
select is((select cardinality(path) from public.managed_work_groups() where name='Deep child #180'),4,'deep Group retains its path for nesting');
select is((select count(*) from public.managed_work_groups() where name='Foreign #180'),0::bigint,'unrelated readable Group is not a managed origin');
select is((select count(*) from public.managed_work_groups() where name='Archived #180'),0::bigint,'Group Manager cannot manage an archived descendant');
reset role;
update public.group_members set group_role='responsible' where member_id='18000000-0000-0000-0000-000000000001';
select pg_temp.test_login_leadership('18000000-0000-0000-0000-000000000001');
select is((select count(*) from public.managed_work_groups() where name like '%#180'),4::bigint,'ancestor Responsible can prepare work throughout the hierarchy');
reset role;
select pg_temp.test_login_leadership('18000000-0000-0000-0000-000000000002');
select is((select count(*) from public.managed_work_groups()),0::bigint,'ordinary Member has no managed origins');
reset role;
select pg_temp.test_login_leadership('18000000-0000-0000-0000-000000000003');
select is((select count(*) from public.managed_work_groups() where name like '%#180'),6::bigint,'BC receives every managed fixture Group including archived Groups');
select is((select count(*) from public.managed_work_groups() where name='Archived #180'),1::bigint,'BC archive override matches live command authority');
reset role;
update public.profiles set status='inactiv' where id='18000000-0000-0000-0000-000000000001';
select pg_temp.test_login_leadership('18000000-0000-0000-0000-000000000001');
select is((select count(*) from public.managed_work_groups()),0::bigint,'inactive actor cannot use stale Group role authority');
reset role;
select set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*) from public.managed_work_groups()),0::bigint,'claimless session has no origins');
reset role;
select ok(not has_function_privilege('anon','public.managed_work_groups()','EXECUTE'),'anon cannot execute');
select ok(not has_function_privilege('service_role','public.managed_work_groups()','EXECUTE'),'service role has no public RPC grant');
select * from finish();
rollback;
