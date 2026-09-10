-- dept_cup.test.sql — issue #134: complete, active-only department standings.
-- Runs in one transaction and rolls back, leaving the local demo seed intact.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(11);


-- Remove the demo members and every dependent row inside this rolled-back
-- transaction. Reference departments stay untouched: those five rows are the
-- production configuration this view must always return.
truncate public.profiles cascade;

insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'cup.active@test.local'),
  ('c2000000-0000-0000-0000-000000000002', 'cup.inactive@test.local'),
  ('c3000000-0000-0000-0000-000000000003', 'cup.alumni@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('c1000000-0000-0000-0000-000000000001', 'Membru BCE',     'cup.active@test.local',   'bce',       'activ'),
  ('c2000000-0000-0000-0000-000000000002', 'Membru Inactiv', 'cup.inactive@test.local', 'voluntar', 'inactiv'),
  ('c3000000-0000-0000-0000-000000000003', 'Fost Membru',    'cup.alumni@test.local',   'voluntar', 'alumni');

insert into public.member_departments (member_id, dept_id) values
  ('c1000000-0000-0000-0000-000000000001', 'edu'),
  ('c2000000-0000-0000-0000-000000000002', 'pr'),
  ('c3000000-0000-0000-0000-000000000003', 'hr');

insert into public.tasks (title, difficulty) values
  ('cup-active', 5), ('cup-inactive', 5), ('cup-alumni', 5);
insert into public.task_assignees (task_id, member_id)
select t.id, case t.title
  when 'cup-active' then 'c1000000-0000-0000-0000-000000000001'::uuid
  when 'cup-inactive' then 'c2000000-0000-0000-0000-000000000002'::uuid
  else 'c3000000-0000-0000-0000-000000000003'::uuid
end
from public.tasks t
where t.title like 'cup-%';
update public.tasks set rating = 3 where title like 'cup-%';

select ok(
  exists (
    select 1 from pg_class
     where relname = 'dept_cup'
       and 'security_invoker=on' = any (reloptions)
  ),
  'dept_cup remains a security-invoker view');

select pg_temp.test_login_leadership('c1000000-0000-0000-0000-000000000001');

select is((select count(*) from public.dept_cup), 5::bigint,
  'BCE sees all five canonical departments');
select is((select points from public.dept_cup where dept_id = 'edu'), 5,
  'the cup keeps the active member points total');
select is((select members from public.dept_cup where dept_id = 'edu'), 1::bigint,
  'the cup counts the active member');
select is((select points from public.dept_cup where dept_id = 'pr'), 0,
  'an inactive member contributes no points');
select is((select members from public.dept_cup where dept_id = 'pr'), 0::bigint,
  'an inactive member is not counted');
select is((select points from public.dept_cup where dept_id = 'hr'), 0,
  'an alumni member contributes no points');
select is((select members from public.dept_cup where dept_id = 'hr'), 0::bigint,
  'an alumni member is not counted');
select is((select points from public.dept_cup where dept_id = 'fin'), 0,
  'a department without any member remains visible with zero points');

select results_eq(
  $$ select dept_id from public.dept_cup $$,
  $$ values ('edu'::text), ('fin'::text), ('pr'::text), ('hr'::text), ('youth'::text) $$,
  'standings sort by points descending and then by department name');

reset role;

select pg_temp.test_clear_jwt();
set local role authenticated;
select is((select count(*) from public.dept_cup), 0::bigint,
  'a claimless authenticated session still sees no standings');
reset role;

select * from finish();
rollback;
