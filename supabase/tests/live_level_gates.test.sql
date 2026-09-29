-- live_level_gates.test.sql — security pass M4 (2026-09-27): row gates read the
-- live Profile, never the token's member_level; a BC cannot edit the Moderator's
-- or another BC's Profile.
--
-- Every stale persona carries a token that still says what the Profile used to
-- be. Putting auth_level() back into any gate turns its "stale" assertion red.
-- Runs in one transaction and rolls back.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(26);

truncate public.profiles cascade;

insert into auth.users (id, email) values
  ('e4700000-0000-0000-0000-000000000009', 'gate.moderator@test.local'),
  ('e4700000-0000-0000-0000-000000000006', 'gate.bc@test.local'),
  ('e4700000-0000-0000-0000-000000000016', 'gate.bc.two@test.local'),
  ('e4700000-0000-0000-0000-000000000056', 'gate.demoted.bc@test.local'),
  ('e4700000-0000-0000-0000-000000000035', 'gate.demoted.bce@test.local'),
  ('e4700000-0000-0000-0000-000000000066', 'gate.deactivated.bc@test.local'),
  ('e4700000-0000-0000-0000-000000000000', 'gate.recrut@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('e4700000-0000-0000-0000-000000000009', 'Gate Moderator', 'gate.moderator@test.local', 'moderator', 'activ'),
  ('e4700000-0000-0000-0000-000000000006', 'Gate BC', 'gate.bc@test.local', 'bc', 'activ'),
  ('e4700000-0000-0000-0000-000000000016', 'Gate BC Doi', 'gate.bc.two@test.local', 'bc', 'activ'),
  -- was BC, now BCE: the token still says bc / 6
  ('e4700000-0000-0000-0000-000000000056', 'Gate Retrogradat', 'gate.demoted.bc@test.local', 'bce', 'activ'),
  -- was BCE, now vot: the token still says bce / 5
  ('e4700000-0000-0000-0000-000000000035', 'Gate Fost BCE', 'gate.demoted.bce@test.local', 'vot', 'activ'),
  -- was an active BC, now deactivated: the token still says bc / 6
  ('e4700000-0000-0000-0000-000000000066', 'Gate Dezactivat', 'gate.deactivated.bc@test.local', 'bc', 'inactiv'),
  ('e4700000-0000-0000-0000-000000000000', 'Gate Recrut', 'gate.recrut@test.local', 'recrut', 'activ');

insert into public.points_ledger (member_id, delta, reason, awarded_by, note) values
  ('e4700000-0000-0000-0000-000000000000', -1, 'sanction', 'e4700000-0000-0000-0000-000000000006', 'fixture');

create temp table gate_updates (label text primary key, rows int not null);
grant select, insert on gate_updates to authenticated;

-- ==================== profiles_update_self: who may edit whom ====================

select pg_temp.test_login('e4700000-0000-0000-0000-000000000006', '{"member_role":"bc","member_level":6}');
with u as (update public.profiles set nickname = 'Recrutul' where id = 'e4700000-0000-0000-0000-000000000000' returning 1)
insert into gate_updates select 'bc_recrut_nickname', count(*) from u;
with u as (update public.profiles set full_name = 'Gate Recrut Nou' where id = 'e4700000-0000-0000-0000-000000000000' returning 1)
insert into gate_updates select 'bc_recrut_full_name', count(*) from u;
with u as (update public.profiles set full_name = 'Gate BC Nou' where id = 'e4700000-0000-0000-0000-000000000006' returning 1)
insert into gate_updates select 'bc_self_full_name', count(*) from u;
with u as (update public.profiles set nickname = 'Moderatorul' where id = 'e4700000-0000-0000-0000-000000000009' returning 1)
insert into gate_updates select 'bc_moderator_nickname', count(*) from u;
with u as (update public.profiles set email = 'captured@test.local' where id = 'e4700000-0000-0000-0000-000000000009' returning 1)
insert into gate_updates select 'bc_moderator_email', count(*) from u;
with u as (update public.profiles set email = 'captured.bc@test.local' where id = 'e4700000-0000-0000-0000-000000000016' returning 1)
insert into gate_updates select 'bc_other_bc_email', count(*) from u;
reset role;

select pg_temp.test_login('e4700000-0000-0000-0000-000000000009', '{"member_role":"moderator","member_level":9}');
with u as (update public.profiles set email = 'gate.bc.doi@test.local' where id = 'e4700000-0000-0000-0000-000000000016' returning 1)
insert into gate_updates select 'moderator_bc_email', count(*) from u;
reset role;

select pg_temp.test_login('e4700000-0000-0000-0000-000000000056', '{"member_role":"bc","member_level":6}');
with u as (update public.profiles set nickname = 'Furat' where id = 'e4700000-0000-0000-0000-000000000000' returning 1)
insert into gate_updates select 'stale_bc_recrut_nickname', count(*) from u;
with u as (update public.profiles set nickname = 'Retrogradat' where id = 'e4700000-0000-0000-0000-000000000056' returning 1)
insert into gate_updates select 'stale_bc_self_nickname', count(*) from u;
reset role;

select pg_temp.test_login('e4700000-0000-0000-0000-000000000066', '{"member_role":"bc","member_level":6}');
with u as (update public.profiles set nickname = 'Dezactivat' where id = 'e4700000-0000-0000-0000-000000000066' returning 1)
insert into gate_updates select 'deactivated_self_nickname', count(*) from u;
with u as (update public.profiles set nickname = 'Furat Doi' where id = 'e4700000-0000-0000-0000-000000000000' returning 1)
insert into gate_updates select 'deactivated_recrut_nickname', count(*) from u;
reset role;

select is((select rows from gate_updates where label = 'bc_recrut_nickname'), 1,
  'a BC edits a Profile below level 6');
select is((select rows from gate_updates where label = 'bc_recrut_full_name'), 1,
  'a BC changes a privileged column on a Profile below level 6');
select is((select rows from gate_updates where label = 'bc_self_full_name'), 1,
  'a BC edits their own Profile, privileged columns included');
select is((select rows from gate_updates where label = 'bc_moderator_nickname'), 0,
  'a BC cannot edit the Moderator''s Profile');
select is((select rows from gate_updates where label = 'bc_moderator_email'), 0,
  'a BC cannot rewrite the Moderator''s email');
select is((select rows from gate_updates where label = 'bc_other_bc_email'), 0,
  'a BC cannot rewrite another BC''s email');
select is((select rows from gate_updates where label = 'moderator_bc_email'), 1,
  'the Moderator edits a BC''s Profile');
select is((select rows from gate_updates where label = 'stale_bc_recrut_nickname'), 0,
  'stale token: a BC demoted to BCE no longer edits colleagues'' Profiles');
select is((select rows from gate_updates where label = 'stale_bc_self_nickname'), 1,
  'a demoted BC still edits their own non-privileged columns');
select is((select rows from gate_updates where label = 'deactivated_self_nickname'), 0,
  'stale token: a deactivated Member cannot edit even their own Profile');
select is((select rows from gate_updates where label = 'deactivated_recrut_nickname'), 0,
  'stale token: a deactivated BC cannot edit colleagues'' Profiles');
select is((select email from public.profiles where id = 'e4700000-0000-0000-0000-000000000009'),
  'gate.moderator@test.local', 'the Moderator''s email is unchanged after the BC''s attempt');

-- ==================== guard_profile_privileged_columns ====================

select pg_temp.test_login('e4700000-0000-0000-0000-000000000056', '{"member_role":"bc","member_level":6}');
select throws_ok(
  $$ update public.profiles set full_name = 'Nume Nou' where id = 'e4700000-0000-0000-0000-000000000056' $$,
  '42501', null,
  'stale token: the guard refuses a demoted BC''s privileged-column change');
reset role;

select pg_temp.test_login('e4700000-0000-0000-0000-000000000006', '{"member_role":"bc","member_level":6}');
select lives_ok(
  $$ update public.profiles set joined_year = 2021 where id = 'e4700000-0000-0000-0000-000000000006' $$,
  'the guard admits a live BC''s privileged-column change (#936: tier dropped, joined_year is still a guarded column)');
reset role;

-- #936: member_points and leaderboard are dropped. Neither department_cup nor
-- leadership_leaderboard is a drop-in replacement for this section's own
-- read-gate assertions -- both new aggregates sum only 'task'/'task_reversal'
-- ledger rows, never a 'sanction' like the one this fixture writes, so the
-- same live-vs-stale-level behaviour this section pinned is already covered,
-- for the raw ledger, by the points_ledger assertions below.

-- ==================== profiles_contact ====================

select pg_temp.test_login('e4700000-0000-0000-0000-000000000006', '{"member_role":"bc","member_level":6}');
select is((select count(*) from public.profiles_contact), 7::bigint,
  'a live BC reads every Member''s contact details');
reset role;

select pg_temp.test_login('e4700000-0000-0000-0000-000000000035', '{"member_role":"bce","member_level":5}');
select is((select count(*) from public.profiles_contact), 1::bigint,
  'stale token: a BCE demoted to vot reads only their own contact details');
select is((select array_agg(id) from public.profiles_contact), array['e4700000-0000-0000-0000-000000000035'::uuid],
  'the one row a demoted BCE reads is their own');
reset role;

select pg_temp.test_login('e4700000-0000-0000-0000-000000000066', '{"member_role":"bc","member_level":6}');
select is((select count(*) from public.profiles_contact), 0::bigint,
  'stale token: a deactivated BC reads no contact details, their own included');
reset role;

-- ==================== points_ledger ====================

select pg_temp.test_login('e4700000-0000-0000-0000-000000000006', '{"member_role":"bc","member_level":6}');
select is((select count(*) from public.points_ledger), 1::bigint,
  'a live BC reads a colleague''s ledger row');
select lives_ok(
  $$ insert into public.points_ledger (member_id, delta, reason, awarded_by, note)
     values ('e4700000-0000-0000-0000-000000000000', -2, 'sanction', 'e4700000-0000-0000-0000-000000000006', 'live bc') $$,
  'a live BC records a sanction');
reset role;

select pg_temp.test_login('e4700000-0000-0000-0000-000000000035', '{"member_role":"bce","member_level":5}');
select is((select count(*) from public.points_ledger), 0::bigint,
  'stale token: a BCE demoted to vot reads no colleague ledger rows');
reset role;

select pg_temp.test_login('e4700000-0000-0000-0000-000000000056', '{"member_role":"bc","member_level":6}');
select throws_ok(
  $$ insert into public.points_ledger (member_id, delta, reason, awarded_by, note)
     values ('e4700000-0000-0000-0000-000000000000', -3, 'sanction', 'e4700000-0000-0000-0000-000000000056', 'stale bc') $$,
  '42501', null,
  'stale token: a BC demoted to BCE cannot record a sanction');
reset role;

-- ==================== the claims guard still stands ====================

select pg_temp.test_login('e4700000-0000-0000-0000-000000000006', jsonb_build_object('provider', 'email'));
select is((select count(*) from public.profiles_contact), 0::bigint,
  'a live BC Profile without organisation claims reads no contact details');
select is((select count(*) from public.points_ledger), 0::bigint,
  'a live BC Profile without organisation claims reads no ledger rows');
with u as (update public.profiles set nickname = 'Fara Revendicari' where id = 'e4700000-0000-0000-0000-000000000000' returning 1)
select is((select count(*) from u)::int, 0,
  'a live BC Profile without organisation claims edits no Profile');
select throws_ok(
  $$ insert into public.points_ledger (member_id, delta, reason, awarded_by, note)
     values ('e4700000-0000-0000-0000-000000000000', -4, 'sanction', 'e4700000-0000-0000-0000-000000000006', 'claimless') $$,
  '42501', null,
  'a live BC Profile without organisation claims records no sanction');
reset role;
-- #936: member_points and leaderboard (and the viewdef pin on its own claims
-- guard) are dropped; points_ledger above already answers nothing without
-- claims, and profiles_contact and points_ledger elsewhere in this file pin
-- the same live-claims boundary on the surviving surfaces.

select * from finish();
rollback;
