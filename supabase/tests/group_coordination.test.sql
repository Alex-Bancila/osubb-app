begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path=public,extensions;
create extension if not exists pgtap with schema extensions;
select plan(9);
insert into auth.users(id,email) select ('58900000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'reader589-'||n||'@test.local' from generate_series(1,4) n;
insert into public.profiles(id,email,full_name,role,status)
select id,email,'Reader #589 '||right(id::text,1),'voluntar','activ' from auth.users where email like 'reader589-%';
update public.profiles set role='bce' where id='58900000-0000-0000-0000-000000000002';
insert into public.groups(name,category,min_level) values('Coordination #589','team',1),('Hidden coordination #589','team',5);
insert into public.group_members(group_id,member_id,group_role,position_title)
select g.id,('58900000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
 case n when 2 then 'manager' when 3 then 'responsible' else 'member' end,
 case when n=3 then 'Responsabil comunicare' end
from public.groups g cross join generate_series(2,4) n where g.name='Coordination #589';
insert into public.group_members(group_id,member_id,group_role)
select id,'58900000-0000-0000-0000-000000000002','manager' from public.groups where name='Hidden coordination #589';
create function pg_temp.visible589() returns bigint language sql security definer set search_path='' as $$select id from public.groups where name='Coordination #589'$$;
update public.profiles set nickname='Coordonator 589' where id='58900000-0000-0000-0000-000000000002';
select pg_temp.test_login_leadership('58900000-0000-0000-0000-000000000001');
select is((select count(*) from public.group_members where group_id=(select id from public.groups where name='Coordination #589')),0::bigint,'ordinary roster read remains closed');
select is((select count(*) from public.group_coordination((select id from public.groups where name='Coordination #589'))),2::bigint,'ordinary active Member sees only coordinators');
select is((select nickname from public.group_coordination((select id from public.groups where name='Coordination #589')) where group_role='manager'),'Coordonator 589','nickname is returned with the full name');
select is((select position_title from public.group_coordination((select id from public.groups where name='Coordination #589')) where group_role='responsible'),'Responsabil comunicare','custom Responsible title survives');
reset role;
create function pg_temp.hidden589() returns bigint language sql security definer set search_path='' as $$select id from public.groups where name='Hidden coordination #589'$$;
select pg_temp.test_login_leadership('58900000-0000-0000-0000-000000000001');
select is((select count(*) from public.group_coordination(pg_temp.hidden589())),0::bigint,'below-level Group is not exposed');
reset role;
select pg_temp.test_login('58900000-0000-0000-0000-000000000001','{}');
select is((select count(*) from public.group_coordination(pg_temp.visible589())),0::bigint,'claimless session sees no coordination');
reset role;
update public.profiles set status='inactiv' where id='58900000-0000-0000-0000-000000000001';
select pg_temp.test_login('58900000-0000-0000-0000-000000000001','{"member_role":"bc","member_level":6}');
select is((select count(*) from public.group_coordination(pg_temp.visible589())),0::bigint,'inactive caller cannot reuse stale claims');
reset role;
select ok(not has_function_privilege('anon','public.group_coordination(bigint)','execute'),'anon cannot call the projection');
select ok((select not (proargnames && array['email','phone','points','rank']) from pg_proc where oid='public.group_coordination(bigint)'::regprocedure),'projection has no contact or scoring fields');
select * from finish();
rollback;
