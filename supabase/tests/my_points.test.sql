-- my_points.test.sql — #255: each active member can read only their own total.
-- Runs in one transaction and rolls back, leaving demo data untouched.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(13);


select has_view(
  'public',
  'my_points',
  'the authenticated own-total endpoint exists'
);
select ok(
  exists (
    select 1
      from pg_class
     where relname = 'my_points'
       and relnamespace = 'public'::regnamespace
       and 'security_invoker=on' = any (reloptions)
  ),
  'my_points runs with caller privileges'
);
select ok(
  has_table_privilege('authenticated', 'public.my_points', 'select'),
  'authenticated holds the explicit read grant'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.my_points',
    'insert,update,delete'
  ),
  'authenticated holds no write grants on my_points'
);
select ok(
  not has_table_privilege('anon', 'public.my_points', 'select'),
  'anonymous clients hold no read grant'
);

insert into auth.users (id, email) values
  ('a5100000-0000-0000-0000-000000000001', 'own.points@test.local'),
  ('a5100000-0000-0000-0000-000000000002', 'zero.points@test.local'),
  ('a5100000-0000-0000-0000-000000000003', 'leader.points@test.local'),
  ('a5100000-0000-0000-0000-000000000004', 'inactive.points@test.local'),
  ('a5100000-0000-0000-0000-000000000005', 'no.profile.points@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('a5100000-0000-0000-0000-000000000001', 'Own Points', 'own.points@test.local', 'voluntar', 'activ'),
  ('a5100000-0000-0000-0000-000000000002', 'Zero Points', 'zero.points@test.local', 'recrut', 'activ'),
  ('a5100000-0000-0000-0000-000000000003', 'Leader Points', 'leader.points@test.local', 'bce', 'activ'),
  ('a5100000-0000-0000-0000-000000000004', 'Inactive Points', 'inactive.points@test.local', 'voluntar', 'inactiv');

-- Produce a real +6 task entry through an Evaluation (#317 retired the
-- grading triggers), then apply a -2 sanction. The endpoint must return the
-- complete personal total, not only positive task points.
insert into public.tasks (title, difficulty, status, created_by, group_id)
values (
  'my-points-task',
  3,
  'todo',
  'a5100000-0000-0000-0000-000000000003',
  pg_temp.dept_group('edu')
);
-- #345 retired task_assignees; pg_temp.test_credit_task below opens the
-- Assignment its Evaluation needs, so the participant is named there.
-- #312: rating may only be set once completed (tasks_evaluation_inputs_ck).
update public.tasks set status = 'completed', completed_at = now(), rating = 4
 where title = 'my-points-task';
select pg_temp.test_credit_task(
  (select id from public.tasks where title = 'my-points-task'),
  'a5100000-0000-0000-0000-000000000001',
  'a5100000-0000-0000-0000-000000000003');   -- 3 × 2 = +6

insert into public.points_ledger (member_id, delta, reason, note) values
  ('a5100000-0000-0000-0000-000000000001', -2, 'sanction', 'test sanction'),
  ('a5100000-0000-0000-0000-000000000003', -11, 'sanction', 'test sanction'),
  ('a5100000-0000-0000-0000-000000000004', -7, 'sanction', 'test sanction');

select pg_temp.test_login('a5100000-0000-0000-0000-000000000001', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select results_eq(
  $$ select member_id, points from public.my_points $$,
  $$ values ('a5100000-0000-0000-0000-000000000001'::uuid, 4::int) $$,
  'an active volunteer receives exactly their task-plus-sanction total'
);
select is(
  (select count(*) from public.my_points
    where member_id = 'a5100000-0000-0000-0000-000000000003'),
  0::bigint,
  'the endpoint never exposes another member'
);
reset role;

select pg_temp.test_login('a5100000-0000-0000-0000-000000000002', jsonb_build_object(
    'member_role', 'recrut', 'member_level', 0,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select results_eq(
  $$ select member_id, points from public.my_points $$,
  $$ values ('a5100000-0000-0000-0000-000000000002'::uuid, 0::int) $$,
  'an active member without ledger rows receives zero'
);
reset role;

select pg_temp.test_login('a5100000-0000-0000-0000-000000000003', jsonb_build_object(
    'member_role', 'bce', 'member_level', 5,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select results_eq(
  $$ select member_id, points from public.my_points $$,
  $$ values ('a5100000-0000-0000-0000-000000000003'::uuid, -11::int) $$,
  'a leader also receives only their own total'
);
reset role;

-- A valid Auth identity without organization claims must not inherit access
-- merely because auth.uid() still returns a real user ID.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'a5100000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'app_metadata', '{}'::jsonb
  )::text,
  true
);
set local role authenticated;
select is(
  (select count(*) from public.my_points),
  0::bigint,
  'a claimless real user receives no row'
);
reset role;

select pg_temp.test_login('a5100000-0000-0000-0000-000000000005', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(
  (select count(*) from public.my_points),
  0::bigint,
  'an authenticated identity without a profile receives no row'
);
reset role;

-- This models a stale token after deactivation: the JWT still has valid org
-- claims, while the current profile row is already inactive.
select pg_temp.test_login('a5100000-0000-0000-0000-000000000004', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(
  (select count(*) from public.my_points),
  0::bigint,
  'an inactive member with stale claims receives no row'
);
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(
  $$ select * from public.my_points $$,
  '42501',
  null,
  'anonymous clients cannot read my_points'
);
reset role;

select * from finish();
rollback;
