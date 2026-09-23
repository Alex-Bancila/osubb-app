-- provision_profile.test.sql — the one provisioning path (Epic 2.3a), placing
-- a new Member's initial Groups by Appointment since #602 (ADR-0009 Wave 3).
--
-- What this suite is really pinning, beyond "the profile is created":
--
--   * provisioning writes the roster through #583's private.appoint_group_member
--     and never around it, so every roster invariant applies to the only door
--     into the application exactly as it applies to add_group_member;
--   * the inviting BC reaches the core as the Notification's actor;
--   * one refusing Group fails the WHOLE call -- no half-placed Member;
--   * the legacy membership tables are no longer written at all (#590 drops
--     them), which the Department-Group section below states as an assertion
--     rather than leaving to a reader of the migration.
--
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(35);

-- ==================== Privileges ====================
select has_function('public', 'provision_profile', 'provision_profile() exists');

select ok(
  has_function_privilege('service_role',
    'public.provision_profile(uuid, text, text, member_role, bigint[], uuid)', 'execute'),
  'the server identity may provision');
select ok(
  not has_function_privilege('authenticated',
    'public.provision_profile(uuid, text, text, member_role, bigint[], uuid)', 'execute'),
  'a logged-in member may not provision');
select ok(
  not has_function_privilege('anon',
    'public.provision_profile(uuid, text, text, member_role, bigint[], uuid)', 'execute'),
  'anon may not provision');

select is(
  (select prosecdef from pg_proc where proname = 'provision_profile'),
  true, 'runs as its owner (security definer) so it bypasses RLS');

-- The department/team overload is GONE, not merely unused: leaving it behind
-- would keep a second provisioning path alive that writes the legacy tables.
select is(
  (select count(*) from pg_proc as p
     join pg_namespace as n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.proname = 'provision_profile'
      and pg_get_function_identity_arguments(p.oid)
          = 'p_user_id uuid, p_full_name text, p_email text, p_role member_role, p_dept_ids text[], p_team_ids text[]'),
  0::bigint, 'the dept_ids/team_ids overload is dropped, not left beside the new one');

-- ==================== Fixtures ====================

create function pg_temp.g602_uid(n integer) returns uuid language sql immutable as $$
  select ('60200000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- 1 is the inviting BC; 2..10 are the invited auth users waiting for a profile.
insert into auth.users (id, email)
select pg_temp.g602_uid(n), 'member.' || n || '.602@test.local' from generate_series(1, 10) n;

insert into public.profiles (id, full_name, email, role, status)
values (pg_temp.g602_uid(1), 'BC #602', 'member.1.602@test.local', 'bc', 'activ');

insert into public.groups (name, category, min_level, created_by)
values ('Grup #602',     'department', 0, pg_temp.g602_uid(1)),
       ('Arhivat #602',  'department', 0, pg_temp.g602_uid(1)),
       ('Nivel #602',    'department', 3, pg_temp.g602_uid(1));
insert into public.groups (name, category, min_level, automatic_membership, created_by)
values ('Automat #602', 'department', 0, true, pg_temp.g602_uid(1));
update public.groups set status = 'archived' where name = 'Arhivat #602';

create function pg_temp.g602_group(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;

insert into public.groups (name, category, parent_id, min_level, created_by)
values ('Echipă #602', 'team', pg_temp.g602_group('Grup #602'), 0, pg_temp.g602_uid(1));

create function pg_temp.g602_roster(p_group text, n integer) returns text
language sql stable security definer set search_path = '' as $$
  select gm.group_role
    from public.group_members as gm
   where gm.group_id = (select id from public.groups where name = p_group)
     and gm.member_id = pg_temp.g602_uid(n)
$$;

create function pg_temp.g602_roster_legacy(n integer) returns text
language sql stable security definer set search_path = '' as $$
  select gm.group_role
    from public.group_members as gm
    join public.groups as grp on grp.id = gm.group_id and grp.legacy_dept_id = 'fin'
   where gm.member_id = pg_temp.g602_uid(n)
$$;

create function pg_temp.g602_notifications(n integer) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.notifications where member_id = pg_temp.g602_uid(n)
$$;

-- ==================== One call = a complete, placed Member ====================

set local role service_role;
select is(
  provision_profile(pg_temp.g602_uid(2), 'Ioana Test',
                    '  Ioana.Provision@Test.Local  ', 'voluntar',
                    array[pg_temp.g602_group('Echipă #602'),
                          pg_temp.g602_group('Grup #602')],
                    pg_temp.g602_uid(1)),
  pg_temp.g602_uid(2),
  'provisioning returns the member id');
reset role;

select is(
  (select role from profiles where id = pg_temp.g602_uid(2)),
  'voluntar'::member_role, 'the requested role is applied');
select is(
  (select status from profiles where id = pg_temp.g602_uid(2)),
  'activ'::member_status, 'the new Member is active from the first second');
select is(
  (select email from profiles where id = pg_temp.g602_uid(2)),
  'ioana.provision@test.local', 'the email is normalised (lowercased, trimmed)');

select is(
  (select count(*) from group_members where member_id = pg_temp.g602_uid(2)),
  2::bigint, 'one roster row per requested Group');
select is(
  array[pg_temp.g602_roster('Grup #602', 2), pg_temp.g602_roster('Echipă #602', 2)],
  array['member', 'member'],
  'the initial Groups are ordinary membership -- provisioning appoints nobody to a position');

-- The Appointment Notification is the core's, which is the point: provisioning
-- and add_group_member cannot drift apart because only one of them writes it.
select is(
  (select count(*) from notifications
    where member_id = pg_temp.g602_uid(2)
      and title = 'Ai fost adăugat în Grup #602'
      and link = '/grupuri/' || pg_temp.g602_group('Grup #602')::text),
  1::bigint, 'the new Member is told about each initial Group, with the Group link');
select is(pg_temp.g602_notifications(2), 2,
  'exactly one Notification per Group and none beyond them');

-- p_appointed_by really reaches the core as p_actor. private.notify drops the
-- actor from the recipient array, so a Member provisioned as their own
-- appointer is told nothing -- which is false the moment the actor stops being
-- threaded through.
set local role service_role;
select lives_ok(
  format($$ select provision_profile(%L::uuid, 'Actor Test', 'actor.602@test.local',
                                     'voluntar', array[%s::bigint], %L::uuid) $$,
         pg_temp.g602_uid(3), pg_temp.g602_group('Grup #602'), pg_temp.g602_uid(3)),
  'provisioning accepts any actor the Edge Function verified');
reset role;
select is(pg_temp.g602_notifications(3), 0,
  'the actor is p_appointed_by: appointing a Member as their own appointer notifies nobody');
select is(pg_temp.g602_roster('Grup #602', 3), 'member',
  'and the roster row is written all the same');

-- A recruit with no Group yet is a normal case, not an error.
set local role service_role;
select lives_ok(
  format($$ select provision_profile(%L::uuid, 'Mihai Test', 'mihai.provision@test.local',
                                     'recrut') $$, pg_temp.g602_uid(4)),
  'a recruit can be provisioned without any Group');
reset role;
select is(
  (select count(*) from group_members where member_id = pg_temp.g602_uid(4)),
  0::bigint, 'and lands on no roster at all');

-- The same Group twice is a CSV row naming a Team that is also its Department,
-- not an error: the ids are collapsed before the core sees them.
set local role service_role;
select lives_ok(
  format($$ select provision_profile(%L::uuid, 'Dubla Test', 'dubla.602@test.local',
                                     'voluntar', array[%s::bigint, %s::bigint], %L::uuid) $$,
         pg_temp.g602_uid(5), pg_temp.g602_group('Grup #602'),
         pg_temp.g602_group('Grup #602'), pg_temp.g602_uid(1)),
  'the same Group named twice is collapsed rather than refused');
reset role;
select is(
  (select count(*) from group_members where member_id = pg_temp.g602_uid(5)),
  1::bigint, 'and produces exactly one roster row');

-- ==================== Every refusal fails the WHOLE call ====================
-- The core's reason survives verbatim; only the class is normalised to PT400,
-- because from a service-role caller these are all malformed provisioning
-- input (the migration's shape 3). group_member_not_eligible is the one reason
-- provisioning cannot reach: the profile it is about was created `activ` one
-- statement earlier.

select throws_ok(
  format($$ select provision_profile(%L::uuid, 'Arhiva Test', 'arhiva.602@test.local',
                                     'voluntar', array[%s::bigint, %s::bigint], %L::uuid) $$,
         pg_temp.g602_uid(6), pg_temp.g602_group('Grup #602'),
         pg_temp.g602_group('Arhivat #602'), pg_temp.g602_uid(1)),
  'PT400', 'group_archived', 'an archived Group refuses the whole provisioning');
select is(
  (select count(*) from profiles where id = pg_temp.g602_uid(6)),
  0::bigint, 'no half-created Member survives an archived Group');
select is(
  (select count(*) from group_members where member_id = pg_temp.g602_uid(6)),
  0::bigint, 'the successful first Appointment is rolled back with the failed second Group');
select is(pg_temp.g602_notifications(6), 0,
  'the first Appointment Notification is rolled back too');

select throws_ok(
  format($$ select provision_profile(%L::uuid, 'Automat Test', 'automat.602@test.local',
                                     'voluntar', array[%s::bigint], %L::uuid) $$,
         pg_temp.g602_uid(7), pg_temp.g602_group('Automat #602'), pg_temp.g602_uid(1)),
  'PT400', 'automatic_group_has_no_roster_members',
  'an Automatic-Membership Group holds no ordinary roster row, so it cannot be an initial Group');
select is(
  (select count(*) from profiles where id = pg_temp.g602_uid(7)),
  0::bigint, 'no half-created Member survives an Automatic-Membership Group');

select throws_ok(
  format($$ select provision_profile(%L::uuid, 'Nivel Test', 'nivel.602@test.local',
                                     'recrut', array[%s::bigint], %L::uuid) $$,
         pg_temp.g602_uid(8), pg_temp.g602_group('Nivel #602'), pg_temp.g602_uid(1)),
  'PT400', 'group_member_below_min_level',
  'a Recrut cannot be provisioned into a Group whose Minimum Level is above them');
select is(
  (select count(*) from profiles where id = pg_temp.g602_uid(8)),
  0::bigint, 'no half-created Member survives a below-Minimum-Level placement');

select throws_ok(
  format($$ select provision_profile(%L::uuid, 'Fantoma Test', 'fantoma.602@test.local',
                                     'voluntar', array[-1::bigint], %L::uuid) $$,
         pg_temp.g602_uid(9), pg_temp.g602_uid(1)),
  'PT400', 'group_manage_forbidden',
  'an unknown Group id keeps the core''s non-disclosing reason');
select is(
  (select count(*) from profiles where id = pg_temp.g602_uid(9)),
  0::bigint, 'no half-created Member survives an unknown Group id');

-- ==================== The legacy tables are not written (#590) ====================
-- Provisioning into a legacy-backed Department Group proves the stance rather
-- than asserting it about a native Group, where there is nothing to write.

set local role service_role;
select lives_ok(
  format($$ select provision_profile(%L::uuid, 'Legacy Test', 'legacy.602@test.local',
                                     'voluntar', array[%s::bigint], %L::uuid) $$,
         pg_temp.g602_uid(10),
         (select id from public.groups where legacy_dept_id = 'fin'),
         pg_temp.g602_uid(1)),
  'a legacy-backed Department Group is appointed like any other');
reset role;
select is(pg_temp.g602_roster_legacy(10), 'member',
  'the Department Group roster row is written directly, not derived by the mirror');
select is(to_regclass('public.member_departments'), null::regclass,
  'legacy Department roster storage is absent');
select is(to_regclass('public.team_members'), null::regclass,
  'legacy Team roster storage is absent');

select * from finish();
rollback;
