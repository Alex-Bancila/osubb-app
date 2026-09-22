-- dept_cup.test.sql — issue #134: complete, active-only department standings.
-- Runs in one transaction and rolls back, leaving the local demo seed intact.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(13);


-- Remove the demo members and every dependent row inside this rolled-back
-- transaction. Reference departments stay untouched: those five rows are the
-- production configuration this view must always return.
truncate public.profiles cascade;
-- TRUNCATE also empties the Group mirror; restore every reference competitor,
-- including Groups with no fixture memberships.
select private.sync_department_groups();

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

insert into public.tasks (title, difficulty, group_id) values
  ('cup-active', 5, pg_temp.dept_group('hr')), ('cup-inactive', 5, pg_temp.dept_group('hr')), ('cup-alumni', 5, pg_temp.dept_group('hr'));
-- #312: rating may only be set once completed (tasks_evaluation_inputs_ck).
update public.tasks set status = 'completed', completed_at = now(), rating = 3
 where title like 'cup-%';
-- #317: the Rating no longer credits anyone by itself — each participant's
-- Evaluation and ledger entry are written explicitly (5 x 1 = 5 each).
-- #345 retired the task_assignees join table this list used to live in;
-- pg_temp.test_credit_task writes the Assignment each Evaluation needs.
select pg_temp.test_credit_task(task.id, participant.member_id,
                                'c1000000-0000-0000-0000-000000000001')
  from (values
    ('cup-active',   'c1000000-0000-0000-0000-000000000001'::uuid),
    ('cup-inactive', 'c2000000-0000-0000-0000-000000000002'::uuid),
    ('cup-alumni',   'c3000000-0000-0000-0000-000000000003'::uuid)
  ) as participant (title, member_id)
  join public.tasks task on task.title = participant.title;

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
select is((select points from public.dept_cup where group_id = pg_temp.dept_group('edu')), 0,
  'current Department membership does not redirect another Origin''s Task Points');
select is((select members from public.dept_cup where group_id = pg_temp.dept_group('edu')), 1::bigint,
  'the cup counts the active member');
select is((select points from public.dept_cup where group_id = pg_temp.dept_group('pr')), 0,
  'a Department that owns no Task shows zero, regardless of its members'' status');
select is((select members from public.dept_cup where group_id = pg_temp.dept_group('pr')), 0::bigint,
  'an inactive member is not counted');
select is((select points from public.dept_cup where group_id = pg_temp.dept_group('hr')), 15,
  'Task Points follow the Department Task Origin regardless of Executor membership status');
select is((select members from public.dept_cup where group_id = pg_temp.dept_group('hr')), 0::bigint,
  'an alumni member is not counted');
-- ADR-0007 keeps anyone with completed Task history eligible regardless of
-- profile status: the inactive and alumni Executors' own credits are exactly
-- what make hr 15 rather than 5 (the active member's own award alone) --
-- proven positively, not left implicit in the total above.
select is(
  (select sum(entry.delta)::int from public.points_ledger as entry
     join public.tasks as task on task.id = entry.task_id
    where entry.member_id in ('c2000000-0000-0000-0000-000000000002',
                               'c3000000-0000-0000-0000-000000000003')
      and task.group_id = pg_temp.dept_group('hr')),
  10,
  'the inactive and alumni Executors'' own Task credits (5 each) are what carry hr to 15, not merely the active member''s');
select is((select points from public.dept_cup where group_id = pg_temp.dept_group('fin')), 0,
  'a department without any member remains visible with zero points');

select results_eq(
  $$ select group_id from public.dept_cup $$,
  $$ values (pg_temp.dept_group('hr')), (pg_temp.dept_group('edu')), (pg_temp.dept_group('fin')),
            (pg_temp.dept_group('pr')), (pg_temp.dept_group('youth')) $$,
  'standings sort by points descending and then by department name');

reset role;

select pg_temp.test_clear_jwt();
set local role authenticated;
select is((select count(*) from public.dept_cup), 0::bigint,
  'a claimless authenticated session still sees no standings');
reset role;

select results_eq($$select column_name::text collate "C" from information_schema.columns where table_schema='public' and table_name='dept_cup' order by ordinal_position$$,
  $$select unnest(array['group_id','name','points','members']::text[]) collate "C"$$,
  'the Cup is keyed by Group alone -- the compatibility dept_id column went with the bridge (#579)');
select * from finish();
rollback;
