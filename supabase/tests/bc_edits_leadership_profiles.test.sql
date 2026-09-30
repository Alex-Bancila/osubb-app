-- bc_edits_leadership_profiles.test.sql — #944, ruling R31 follow-up: a live
-- active BC member edits a BC's or the Moderator's Profile fields (full name,
-- Nickname, join date, email) exactly as the Moderator does; rank and Status
-- stay behind set_member_role / set_member_status; everyone below BC keeps
-- today's rules, their own Profile included.
--
-- Mutation proofs (each turns the named assertions red):
--   * restore M4's `role_row.level < 6` limb in profiles_update_self
--       -> "BC edits another BC's ..." / "BC edits the Moderator's ..."
--   * lower the limb to caller_level() >= 5
--       -> "a BCE edits no BC's ..." / "a BCE edits no Moderator's ..."
--   * re-grant `update (role, status)` to authenticated
--       -> "a BC cannot re-rank ..." / "a BC cannot change ... Status"
--   * read auth_level() instead of caller_level()
--       -> the stale-token assertions
--   * drop the `id = auth.uid()` self limb
--       -> "a BCE still edits their own Nickname"
-- Runs in one transaction and rolls back.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(21);

truncate public.profiles cascade;

insert into auth.users (id, email) values
  ('e9440000-0000-0000-0000-000000000009', 'r31.moderator@test.local'),
  ('e9440000-0000-0000-0000-000000000006', 'r31.bc@test.local'),
  ('e9440000-0000-0000-0000-000000000016', 'r31.bc.doi@test.local'),
  ('e9440000-0000-0000-0000-000000000005', 'r31.bce@test.local'),
  ('e9440000-0000-0000-0000-000000000003', 'r31.vot@test.local'),
  ('e9440000-0000-0000-0000-000000000056', 'r31.demoted.bc@test.local'),
  ('e9440000-0000-0000-0000-000000000066', 'r31.deactivated.bc@test.local');

insert into public.profiles (id, full_name, email, role, status, joined_at) values
  ('e9440000-0000-0000-0000-000000000009', 'R31 Moderator', 'r31.moderator@test.local', 'moderator', 'activ', '2020-10-01'),
  ('e9440000-0000-0000-0000-000000000006', 'R31 BC', 'r31.bc@test.local', 'bc', 'activ', '2021-10-01'),
  ('e9440000-0000-0000-0000-000000000016', 'R31 BC Doi', 'r31.bc.doi@test.local', 'bc', 'activ', '2022-10-01'),
  ('e9440000-0000-0000-0000-000000000005', 'R31 BCE', 'r31.bce@test.local', 'bce', 'activ', '2023-10-01'),
  ('e9440000-0000-0000-0000-000000000003', 'R31 Vot', 'r31.vot@test.local', 'vot', 'activ', '2023-10-01'),
  -- was BC, now BCE: the token below still says bc / 6
  ('e9440000-0000-0000-0000-000000000056', 'R31 Retrogradat', 'r31.demoted.bc@test.local', 'bce', 'activ', '2021-10-01'),
  -- was an active BC, now deactivated: the token below still says bc / 6
  ('e9440000-0000-0000-0000-000000000066', 'R31 Dezactivat', 'r31.deactivated.bc@test.local', 'bc', 'inactiv', '2021-10-01');

create temp table r31_updates (label text primary key, rows int not null);
grant select, insert on r31_updates to authenticated;

-- ==================== a live BC on leadership Profiles ====================

select pg_temp.test_login('e9440000-0000-0000-0000-000000000006', '{"member_role":"bc","member_level":6}');
with u as (update public.profiles set full_name = 'R31 BC Doi Nou' where id = 'e9440000-0000-0000-0000-000000000016' returning 1)
insert into r31_updates select 'bc_bc_full_name', count(*) from u;
with u as (update public.profiles set joined_at = '2022-09-15' where id = 'e9440000-0000-0000-0000-000000000016' returning 1)
insert into r31_updates select 'bc_bc_joined_at', count(*) from u;
with u as (update public.profiles set full_name = 'R31 Moderator Nou' where id = 'e9440000-0000-0000-0000-000000000009' returning 1)
insert into r31_updates select 'bc_moderator_full_name', count(*) from u;
with u as (update public.profiles set joined_at = '2020-09-15' where id = 'e9440000-0000-0000-0000-000000000009' returning 1)
insert into r31_updates select 'bc_moderator_joined_at', count(*) from u;
with u as (update public.profiles set nickname = 'Moderatorul' where id = 'e9440000-0000-0000-0000-000000000009' returning 1)
insert into r31_updates select 'bc_moderator_nickname', count(*) from u;
with u as (update public.profiles set joined_at = '2021-09-15' where id = 'e9440000-0000-0000-0000-000000000006' returning 1)
insert into r31_updates select 'bc_self_joined_at', count(*) from u;
select throws_ok(
  $$ update public.profiles set role = 'bce' where id = 'e9440000-0000-0000-0000-000000000016' $$,
  '42501', null,
  'a BC cannot re-rank another BC through a Profile edit -- set_member_role owns rank');
select throws_ok(
  $$ update public.profiles set status = 'inactiv' where id = 'e9440000-0000-0000-0000-000000000009' $$,
  '42501', null,
  'a BC cannot change the Moderator''s Status through a Profile edit -- set_member_status owns it');
reset role;

select is((select rows from r31_updates where label = 'bc_bc_full_name'), 1,
  'a BC edits another BC''s full name');
select is((select rows from r31_updates where label = 'bc_bc_joined_at'), 1,
  'a BC edits another BC''s join date');
select is((select rows from r31_updates where label = 'bc_moderator_full_name'), 1,
  'a BC edits the Moderator''s full name');
select is((select rows from r31_updates where label = 'bc_moderator_joined_at'), 1,
  'a BC edits the Moderator''s join date');
select is((select rows from r31_updates where label = 'bc_moderator_nickname'), 1,
  'a BC edits the Moderator''s Nickname');
select is(
  (select array[full_name, joined_at::text, nickname] from public.profiles where id = 'e9440000-0000-0000-0000-000000000009'),
  array['R31 Moderator Nou', '2020-09-15', 'Moderatorul'],
  'the BC''s edits to the Moderator''s Profile are stored');
select is(
  (select array[role::text, status::text] from public.profiles where id = 'e9440000-0000-0000-0000-000000000016'),
  array['bc', 'activ'],
  'the other BC keeps their rank and Status');
select is(
  (select array[role::text, status::text] from public.profiles where id = 'e9440000-0000-0000-0000-000000000009'),
  array['moderator', 'activ'],
  'the Moderator keeps their rank and Status');
select is((select rows from r31_updates where label = 'bc_self_joined_at'), 1,
  'self rule unchanged: a BC edits their own join date');

-- ==================== the Moderator: unchanged ====================

select pg_temp.test_login('e9440000-0000-0000-0000-000000000009', '{"member_role":"moderator","member_level":9}');
with u as (update public.profiles set joined_at = '2021-09-01' where id = 'e9440000-0000-0000-0000-000000000006' returning 1)
select is((select count(*) from u)::int, 1, 'the Moderator still edits a BC''s join date');
reset role;

-- ==================== below BC: unchanged ====================

select pg_temp.test_login('e9440000-0000-0000-0000-000000000005', '{"member_role":"bce","member_level":5}');
with u as (update public.profiles set joined_at = '2000-01-01' where id = 'e9440000-0000-0000-0000-000000000016' returning 1)
insert into r31_updates select 'bce_bc_joined_at', count(*) from u;
with u as (update public.profiles set nickname = 'Furat' where id = 'e9440000-0000-0000-0000-000000000009' returning 1)
insert into r31_updates select 'bce_moderator_nickname', count(*) from u;
with u as (update public.profiles set nickname = 'Bceul' where id = 'e9440000-0000-0000-0000-000000000005' returning 1)
insert into r31_updates select 'bce_self_nickname', count(*) from u;
select throws_ok(
  $$ update public.profiles set full_name = 'R31 BCE Nou' where id = 'e9440000-0000-0000-0000-000000000005' $$,
  '42501', null,
  'self rule unchanged: a BCE cannot rename themselves -- the full name is BC''s');
reset role;

select pg_temp.test_login('e9440000-0000-0000-0000-000000000003', '{"member_role":"vot","member_level":3}');
with u as (update public.profiles set joined_at = '2000-01-01' where id = 'e9440000-0000-0000-0000-000000000009' returning 1)
insert into r31_updates select 'vot_moderator_joined_at', count(*) from u;
reset role;

select is((select rows from r31_updates where label = 'bce_bc_joined_at'), 0,
  'a BCE edits no BC''s join date');
select is((select rows from r31_updates where label = 'bce_moderator_nickname'), 0,
  'a BCE edits no Moderator''s Nickname');
select is((select rows from r31_updates where label = 'bce_self_nickname'), 1,
  'self rule unchanged: a BCE still edits their own Nickname');
select is((select rows from r31_updates where label = 'vot_moderator_joined_at'), 0,
  'a Member with Drept de Vot edits no Moderator''s join date');

-- ==================== stale tokens and missing claims ====================

select pg_temp.test_login('e9440000-0000-0000-0000-000000000056', '{"member_role":"bc","member_level":6}');
with u as (update public.profiles set full_name = 'Furat' where id = 'e9440000-0000-0000-0000-000000000009' returning 1)
insert into r31_updates select 'stale_demoted_moderator', count(*) from u;
reset role;

select pg_temp.test_login('e9440000-0000-0000-0000-000000000066', '{"member_role":"bc","member_level":6}');
with u as (update public.profiles set joined_at = '2000-01-01' where id = 'e9440000-0000-0000-0000-000000000016' returning 1)
insert into r31_updates select 'stale_deactivated_bc', count(*) from u;
reset role;

select pg_temp.test_login('e9440000-0000-0000-0000-000000000006', jsonb_build_object('provider', 'email'));
with u as (update public.profiles set nickname = 'Fara Revendicari' where id = 'e9440000-0000-0000-0000-000000000009' returning 1)
insert into r31_updates select 'claimless_bc_moderator', count(*) from u;
reset role;

select is((select rows from r31_updates where label = 'stale_demoted_moderator'), 0,
  'stale token: a BC demoted to BCE edits no Moderator''s Profile');
select is((select rows from r31_updates where label = 'stale_deactivated_bc'), 0,
  'stale token: a deactivated BC edits no BC''s Profile');
select is((select rows from r31_updates where label = 'claimless_bc_moderator'), 0,
  'a live BC Profile without organisation claims edits no leadership Profile');
select is(
  (select array[full_name, joined_at::text, coalesce(nickname, '')] from public.profiles where id = 'e9440000-0000-0000-0000-000000000016'),
  array['R31 BC Doi Nou', '2022-09-15', ''],
  'the refused writes left the other BC''s Profile as the live BC stored it');

select * from finish();
rollback;
