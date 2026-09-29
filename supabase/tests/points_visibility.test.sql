-- points_visibility.test.sql — #254: global metrics are leadership-only.
-- Runs in one transaction and rolls back, leaving the demo seed untouched.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(15);

-- #936: member_points, leaderboard and dept_cup are dropped views; their own
-- reloptions pins go with them. The surviving function-level split
-- (public.department_cup security invoker over private.department_cup_rows
-- security definer, same for leadership_leaderboard) is pinned in
-- department_cup_task_origins.test.sql and leadership_leaderboard.test.sql.

truncate public.profiles cascade;
-- TRUNCATE also empties the Group mirror; restore every reference competitor,
-- including Groups with no fixture memberships.
select pg_temp.materialize_legacy_groups();

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-0000000000f1', 'flor.vol@test.local'),
  ('f2000000-0000-0000-0000-0000000000f2', 'felix.resp@test.local'),
  ('f3000000-0000-0000-0000-0000000000f3', 'fiona.bce@test.local'),
  ('f4000000-0000-0000-0000-0000000000f4', 'frida.bc@test.local'),
  ('f5000000-0000-0000-0000-0000000000f5', 'fane.mod@test.local');

insert into public.profiles (id, full_name, email, role) values
  ('f1000000-0000-0000-0000-0000000000f1', 'Flor Voluntar',   'flor.vol@test.local',   'voluntar'),
  ('f2000000-0000-0000-0000-0000000000f2', 'Felix Responsabil','felix.resp@test.local', 'vot'),
  ('f3000000-0000-0000-0000-0000000000f3', 'Fiona BCE',       'fiona.bce@test.local',  'bce'),
  ('f4000000-0000-0000-0000-0000000000f4', 'Frida BC',        'frida.bc@test.local',   'bc'),
  ('f5000000-0000-0000-0000-0000000000f5', 'Fane Moderator',  'fane.mod@test.local',   'moderator');

insert into pg_temp.fixture_member_departments (member_id, dept_id) values
  ('f1000000-0000-0000-0000-0000000000f1', 'edu'),
  ('f2000000-0000-0000-0000-0000000000f2', 'edu'),
  ('f3000000-0000-0000-0000-0000000000f3', 'pr'),
  ('f4000000-0000-0000-0000-0000000000f4', 'fin'),
  ('f5000000-0000-0000-0000-0000000000f5', 'hr');
-- #586: materialize this suite's legacy setup as rolled-back Group fixtures.
select pg_temp.materialize_legacy_groups();


insert into public.tasks (title, difficulty, group_id) values
  ('pv-flor', 1, pg_temp.dept_group('edu')), ('pv-felix', 2, pg_temp.dept_group('edu')), ('pv-fiona', 3, pg_temp.dept_group('edu')),
  ('pv-frida', 4, pg_temp.dept_group('edu')), ('pv-fane', 5, pg_temp.dept_group('edu'));
-- #312: rating may only be set once completed (tasks_evaluation_inputs_ck).
update public.tasks set status = 'completed', completed_at = now(), rating = 3
 where title like 'pv-%';
-- #317: one Evaluation and one ledger entry per participant — the Rating
-- alone no longer credits anybody. #345 retired the task_assignees join
-- table the participant list used to live in; pg_temp.test_credit_task
-- opens the Assignment each Evaluation needs.
select pg_temp.test_credit_task(task.id, participant.member_id,
                                'f5000000-0000-0000-0000-0000000000f5')
  from (values
    ('pv-flor',  'f1000000-0000-0000-0000-0000000000f1'::uuid),
    ('pv-felix', 'f2000000-0000-0000-0000-0000000000f2'::uuid),
    ('pv-fiona', 'f3000000-0000-0000-0000-0000000000f3'::uuid),
    ('pv-frida', 'f4000000-0000-0000-0000-0000000000f4'::uuid),
    ('pv-fane',  'f5000000-0000-0000-0000-0000000000f5'::uuid)
  ) as participant (title, member_id)
  join public.tasks task on task.title = participant.title;

-- Ordinary members, including Responsabil, receive no global metrics.
select pg_temp.test_login('f1000000-0000-0000-0000-0000000000f1', jsonb_build_object(
    'member_role', 'voluntar',
    'member_level', 1,
    'dept_ids', '["edu"]'::jsonb,
    'team_ids', '[]'::jsonb
  ));
-- #936: member_points dropped, no ported equivalent -- leadership_leaderboard
-- and department_cup below already pin this exact BCE+ gate on two other
-- surfaces.
select is((select count(*) from public.leadership_leaderboard()), 0::bigint,
  'a voluntar reads no leaderboard rows');
select is((select count(*) from public.department_cup(null::bigint, null::timestamptz, null::timestamptz)), 0::bigint,
  'a voluntar reads no Department Cup rows');
select is(
  (select count(*) from public.points_ledger
    where member_id = 'f2000000-0000-0000-0000-0000000000f2'),
  0::bigint,
  'a voluntar reads none of another member''s ledger rows');
select is(
  (select count(*) from public.points_ledger),
  1::bigint,
  'a voluntar still reads exactly their own ledger row');
reset role;

select pg_temp.test_login('f2000000-0000-0000-0000-0000000000f2', jsonb_build_object(
    'member_role', 'vot',
    'member_level', 4,
    'dept_ids', '["edu"]'::jsonb,
    'team_ids', '[]'::jsonb
  ));
select is((select count(*) from public.leadership_leaderboard()), 0::bigint,
  'a Responsabil reads no leaderboard rows');
select is((select count(*) from public.department_cup(null::bigint, null::timestamptz, null::timestamptz)), 0::bigint,
  'a Responsabil reads no Department Cup rows');
reset role;

-- BCE, BC, and Moderator retain leadership visibility.
select pg_temp.test_login('f3000000-0000-0000-0000-0000000000f3', jsonb_build_object(
    'member_role', 'bce',
    'member_level', 5,
    'dept_ids', '["pr"]'::jsonb,
    'team_ids', '[]'::jsonb
  ));
select is((select count(*) from public.leadership_leaderboard()), 2::bigint,
  'BCE reads the leadership leaderboard: the two ranked Members (BCE, BC and the Moderator are not ranked, #907)');
select is((select count(*) from public.department_cup(null::bigint, null::timestamptz, null::timestamptz)), 5::bigint,
  'BCE reads all five Department Cup rows');
reset role;

select pg_temp.test_login('f4000000-0000-0000-0000-0000000000f4', jsonb_build_object(
    'member_role', 'bc',
    'member_level', 6,
    'dept_ids', '["fin"]'::jsonb,
    'team_ids', '[]'::jsonb
  ));
select is((select count(*) from public.leadership_leaderboard()), 2::bigint,
  'BC reads the leadership leaderboard: the two ranked Members (BCE, BC and the Moderator are not ranked, #907)');
select is((select count(*) from public.department_cup(null::bigint, null::timestamptz, null::timestamptz)), 5::bigint,
  'BC reads all five Department Cup rows');
select is(
  (select count(*) from public.points_ledger
    where member_id = 'f2000000-0000-0000-0000-0000000000f2'),
  1::bigint,
  'BC retains access to the ledger rows behind another member''s total');
reset role;

select pg_temp.test_login('f5000000-0000-0000-0000-0000000000f5', jsonb_build_object(
    'member_role', 'moderator',
    'member_level', 9,
    'dept_ids', '["hr"]'::jsonb,
    'team_ids', '[]'::jsonb
  ));
select is((select count(*) from public.leadership_leaderboard()), 2::bigint,
  'Moderator reads the leadership leaderboard: the two ranked Members (BCE, BC and the Moderator are not ranked, #907)');
select is((select count(*) from public.department_cup(null::bigint, null::timestamptz, null::timestamptz)), 5::bigint,
  'Moderator reads all five Department Cup rows');
reset role;

-- A real Auth user with a valid sub but no organization metadata is denied.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'f1000000-0000-0000-0000-0000000000f1',
    'role', 'authenticated',
    'app_metadata', '{}'::jsonb
  )::text,
  true
);
set local role authenticated;
select is((select count(*) from public.leadership_leaderboard()), 0::bigint,
  'a claimless real user reads no leaderboard rows');
select is((select count(*) from public.department_cup(null::bigint, null::timestamptz, null::timestamptz)), 0::bigint,
  'a claimless real user reads no Department Cup rows');
reset role;

-- #936: member_points is dropped along with the owner-rights bypass it gave
-- postgres/service_role. Neither department_cup nor leadership_leaderboard
-- has a trusted-role escape hatch -- as postgres, both now see no rows at
-- all (pinned in points_engine.test.sql and department_cup_task_origins.test.sql),
-- so there is nothing left here for the database owner to still aggregate.

select * from finish();
rollback;
