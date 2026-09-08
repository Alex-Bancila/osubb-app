-- points_visibility.test.sql — #254: global metrics are leadership-only.
-- Runs in one transaction and rolls back, leaving the demo seed untouched.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(26);

create function pg_temp.login(uid uuid, r text, lvl int, depts jsonb)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', uid,
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'member_role', r,
      'member_level', lvl,
      'dept_ids', depts,
      'team_ids', '[]'::jsonb
    )
  )::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

select ok(
  not exists (
    select 1 from pg_class
     where relname = 'member_points'
       and 'security_invoker=on' = any (reloptions)
  ),
  'member_points keeps owner rights so it can aggregate the protected ledger');
select ok(
  exists (
    select 1 from pg_class
     where relname = 'leaderboard'
       and 'security_invoker=on' = any (reloptions)
  ),
  'leaderboard remains a security-invoker view');
select ok(
  exists (
    select 1 from pg_class
     where relname = 'dept_cup'
       and 'security_invoker=on' = any (reloptions)
  ),
  'dept_cup remains a security-invoker view');

truncate public.profiles cascade;

insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-0000000000f1', 'flor.vol@test.local'),
  ('f2000000-0000-0000-0000-0000000000f2', 'felix.resp@test.local'),
  ('f3000000-0000-0000-0000-0000000000f3', 'fiona.bce@test.local'),
  ('f4000000-0000-0000-0000-0000000000f4', 'frida.bc@test.local'),
  ('f5000000-0000-0000-0000-0000000000f5', 'fane.mod@test.local');

insert into public.profiles (id, full_name, email, role) values
  ('f1000000-0000-0000-0000-0000000000f1', 'Flor Voluntar',   'flor.vol@test.local',   'voluntar'),
  ('f2000000-0000-0000-0000-0000000000f2', 'Felix Responsabil','felix.resp@test.local', 'responsabil'),
  ('f3000000-0000-0000-0000-0000000000f3', 'Fiona BCE',       'fiona.bce@test.local',  'bce'),
  ('f4000000-0000-0000-0000-0000000000f4', 'Frida BC',        'frida.bc@test.local',   'bc'),
  ('f5000000-0000-0000-0000-0000000000f5', 'Fane Moderator',  'fane.mod@test.local',   'moderator');

insert into public.member_departments (member_id, dept_id) values
  ('f1000000-0000-0000-0000-0000000000f1', 'edu'),
  ('f2000000-0000-0000-0000-0000000000f2', 'edu'),
  ('f3000000-0000-0000-0000-0000000000f3', 'pr'),
  ('f4000000-0000-0000-0000-0000000000f4', 'fin'),
  ('f5000000-0000-0000-0000-0000000000f5', 'hr');

insert into public.points_ledger (member_id, delta, reason) values
  ('f1000000-0000-0000-0000-0000000000f1', 10, 'manual_award'),
  ('f2000000-0000-0000-0000-0000000000f2', 20, 'manual_award'),
  ('f3000000-0000-0000-0000-0000000000f3', 30, 'manual_award'),
  ('f4000000-0000-0000-0000-0000000000f4', 40, 'manual_award'),
  ('f5000000-0000-0000-0000-0000000000f5', 50, 'manual_award');

-- Ordinary members, including Responsabil, receive no global metrics.
select pg_temp.login(
  'f1000000-0000-0000-0000-0000000000f1', 'voluntar', 1, '["edu"]'
);
select is((select count(*) from public.member_points), 0::bigint,
  'a voluntar reads no global member totals');
select is((select count(*) from public.leaderboard), 0::bigint,
  'a voluntar reads no leaderboard rows');
select is((select count(*) from public.dept_cup), 0::bigint,
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

select pg_temp.login(
  'f2000000-0000-0000-0000-0000000000f2', 'responsabil', 4, '["edu"]'
);
select is((select count(*) from public.member_points), 0::bigint,
  'a Responsabil reads no global member totals');
select is((select count(*) from public.leaderboard), 0::bigint,
  'a Responsabil reads no leaderboard rows');
select is((select count(*) from public.dept_cup), 0::bigint,
  'a Responsabil reads no Department Cup rows');
reset role;

-- BCE, BC, and Moderator retain leadership visibility.
select pg_temp.login(
  'f3000000-0000-0000-0000-0000000000f3', 'bce', 5, '["pr"]'
);
select is((select count(*) from public.member_points), 5::bigint,
  'BCE reads every member total');
select is((select count(*) from public.leaderboard), 5::bigint,
  'BCE reads the global leaderboard');
select is((select count(*) from public.dept_cup), 5::bigint,
  'BCE reads all five Department Cup rows');
reset role;

select pg_temp.login(
  'f4000000-0000-0000-0000-0000000000f4', 'bc', 6, '["fin"]'
);
select is((select count(*) from public.member_points), 5::bigint,
  'BC reads every member total');
select is((select count(*) from public.leaderboard), 5::bigint,
  'BC reads the global leaderboard');
select is((select count(*) from public.dept_cup), 5::bigint,
  'BC reads all five Department Cup rows');
select is(
  (select count(*) from public.points_ledger
    where member_id = 'f2000000-0000-0000-0000-0000000000f2'),
  1::bigint,
  'BC retains access to the ledger rows behind another member''s total');
reset role;

select pg_temp.login(
  'f5000000-0000-0000-0000-0000000000f5', 'moderator', 9, '["hr"]'
);
select is((select count(*) from public.member_points), 5::bigint,
  'Moderator reads every member total');
select is((select count(*) from public.leaderboard), 5::bigint,
  'Moderator reads the global leaderboard');
select is((select count(*) from public.dept_cup), 5::bigint,
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
select is((select count(*) from public.member_points), 0::bigint,
  'a claimless real user reads no member totals');
select is((select count(*) from public.leaderboard), 0::bigint,
  'a claimless real user reads no leaderboard rows');
select is((select count(*) from public.dept_cup), 0::bigint,
  'a claimless real user reads no Department Cup rows');
reset role;

-- Trusted server-side roles still support promotion and maintenance jobs.
select is((select count(*) from public.member_points), 5::bigint,
  'the database owner can still aggregate member totals');
select is((select points from public.member_points
            where member_id = 'f5000000-0000-0000-0000-0000000000f5'),
          50,
  'the owner-rights aggregate preserves the real total');

select * from finish();
rollback;
