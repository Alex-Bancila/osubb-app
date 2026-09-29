-- provision_profile_rank_cap.test.sql -- security pass 2026-09-27, finding H1,
-- widened by ruling R31 (#917).
--
-- Only leadership creates a BC or Moderator account. provision_profile is
-- service_role only, so the actor is p_appointed_by: the caller invite-member
-- verified. H1 reserved it to the Moderator; ruling R31 (#917) gives it to
-- every live active BC member too, the actor set_member_role accepts. Each
-- refusal below goes green only while the rank check in provision_profile
-- exists; drop it and the BCE, deactivated-appointer and null-appointer cases
-- go red.
--
-- The bootstrap path is pinned too: scripts/bootstrap-production.mjs creates
-- the first Moderator with the service key and no appointer, then every BC
-- appointed by that Moderator.
--
-- Runs in one transaction and rolls back -- leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(21);

-- ==================== Fixtures ====================

create function pg_temp.rc_uid(n integer) returns uuid language sql immutable as $$
  select ('70700000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- 1 a BC, 2 the Moderator, 3 an inactive Moderator, 13 a BCE, 14 an inactive
-- BC; 4..12, 15 and 16 auth users waiting for a profile.
insert into auth.users (id, email)
select pg_temp.rc_uid(n), 'rank.' || n || '@test.local' from generate_series(1, 16) n;

insert into public.profiles (id, full_name, email, role, status)
values (pg_temp.rc_uid(1),  'BC Rank',        'rank.1@test.local',  'bc',        'activ'),
       (pg_temp.rc_uid(2),  'Moderator Rank', 'rank.2@test.local',  'moderator', 'activ'),
       (pg_temp.rc_uid(3),  'Fost Moderator', 'rank.3@test.local',  'moderator', 'inactiv'),
       (pg_temp.rc_uid(13), 'BCE Rank',       'rank.13@test.local', 'bce',       'activ'),
       (pg_temp.rc_uid(14), 'Fost BC',        'rank.14@test.local', 'bc',        'inactiv');

create function pg_temp.rc_profiles(n integer) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from public.profiles where id = pg_temp.rc_uid(n)
$$;

create function pg_temp.rc_provision(n integer, p_role text, p_appointer integer)
returns text language sql immutable as $$
  select format(
    $f$ select public.provision_profile(%L::uuid, 'Rank Test', %L, %L::public.member_role, '{}'::bigint[], %L::uuid) $f$,
    pg_temp.rc_uid(n), 'rank.' || n || '@test.local', p_role,
    case when p_appointer is null then null else pg_temp.rc_uid(p_appointer) end)
$$;

set local role service_role;

-- ==================== Below leadership, nobody creates it ====================

-- The level gate: a BCE (level 5) is the highest rank below BC.
select throws_ok(pg_temp.rc_provision(4, 'bc', 13),
  '42501', 'member_manage_forbidden',
  'a BCE may not create a BC account');
select throws_ok(pg_temp.rc_provision(4, 'moderator', 13),
  '42501', 'member_manage_forbidden',
  'a BCE may not create a Moderator account');

-- The live gate: an inactive Moderator or BC is not leadership. The check is
-- live, as in set_member_role_impl, not "has ever held the rank".
select throws_ok(pg_temp.rc_provision(4, 'bc', 3),
  '42501', 'member_manage_forbidden',
  'a deactivated Moderator may not create a BC account');
select throws_ok(pg_temp.rc_provision(4, 'moderator', 14),
  '42501', 'member_manage_forbidden',
  'a deactivated BC may not create a Moderator account');

-- An appointer with no profile at all (a stale id, or the invitee themself).
select throws_ok(pg_temp.rc_provision(4, 'moderator', 4),
  '42501', 'member_manage_forbidden',
  'an appointer with no profile may not create leadership');

-- With an active Moderator in place, the null-appointer bootstrap path is
-- closed: it creates the FIRST Moderator and nothing else.
select throws_ok(pg_temp.rc_provision(4, 'moderator', null),
  '42501', 'member_manage_forbidden',
  'no second Moderator through the bootstrap path once one is active');
select throws_ok(pg_temp.rc_provision(4, 'bc', null),
  '42501', 'member_manage_forbidden',
  'a BC always needs a leadership appointer, never nobody');

reset role;
select is(pg_temp.rc_profiles(4), 0::bigint,
  'every refusal is raised before the profile is written');
set local role service_role;

-- ==================== What is allowed ====================

select lives_ok(pg_temp.rc_provision(5, 'bce', 1),
  'a BC may create a BCE account');
select lives_ok(pg_temp.rc_provision(6, 'voluntar', 1),
  'a BC may create an ordinary account');
select lives_ok(pg_temp.rc_provision(15, 'bc', 1),
  'a BC may create a BC account (ruling R31, #917)');
select lives_ok(pg_temp.rc_provision(16, 'moderator', 1),
  'a BC may create a Moderator account (ruling R31, #917)');
select lives_ok(pg_temp.rc_provision(7, 'bc', 2),
  'the Moderator may create a BC account');
select lives_ok(pg_temp.rc_provision(8, 'moderator', 2),
  'the Moderator may create a Moderator account');
-- The existing null-appointer path for ordinary ranks is unchanged.
select lives_ok(pg_temp.rc_provision(9, 'recrut', null),
  'an ordinary rank with no appointer is unchanged');

reset role;
select is(
  (select array_agg(role::text order by id) from public.profiles
    where id in (pg_temp.rc_uid(5), pg_temp.rc_uid(7), pg_temp.rc_uid(8),
                 pg_temp.rc_uid(15), pg_temp.rc_uid(16))),
  array['bce', 'bc', 'moderator', 'bc', 'moderator'],
  'the allowed calls store the requested rank');

-- ==================== The service-role bootstrap ====================
-- A fresh production database: no active Moderator anywhere. Every active
-- Moderator -- the seed's, and the ones created above -- steps aside inside
-- this rolled-back transaction.

update public.profiles set status = 'inactiv'
 where role = 'moderator' and status = 'activ';

set local role service_role;
select lives_ok(pg_temp.rc_provision(10, 'moderator', null),
  'bootstrap: the first Moderator is created with the service key and no appointer');
select lives_ok(pg_temp.rc_provision(11, 'bc', 10),
  'bootstrap: a BC appointed by that Moderator follows');
select lives_ok(pg_temp.rc_provision(12, 'bc', 11),
  'bootstrap: and a BC appointed by that BC (ruling R31, #917)');
reset role;

select is(
  (select role::text from public.profiles where id = pg_temp.rc_uid(10) and status = 'activ'),
  'moderator', 'the bootstrap Moderator is active from the first second');
select is(
  (select role::text from public.profiles where id = pg_temp.rc_uid(12) and status = 'activ'),
  'bc', 'and the BC-appointed BC is active too');

select * from finish();
rollback;
