-- invite_group_refusal.test.sql -- #949: "Invită membru" with several Groups.
--
-- public.provision_group_refusal answers, before invite-member mails anyone,
-- the first refusal public.provision_profile would meet for a new Member of a
-- rank in a set of Groups. This suite pins:
--
--   * who may ask (the server identity only);
--   * each refusal reason, in the Appointment core's order, and the first
--     refusing Group in provision_profile's order (ascending id);
--   * PARITY: for every rank x Group set in a matrix, the preflight's answer
--     is exactly provision_profile's own outcome -- the reason it raises, or
--     acceptance -- so the two cannot drift apart;
--   * the invitation contract the dialog relies on: name + email alone give a
--     Recrut in OSUBB only (Automatic Membership, no roster row) joined today;
--     several Groups are placed together, and one ineligible Group refuses
--     the whole call.
--
-- Mutation guards (each names the assertions that turn red):
--   * the automatic_membership branch removed -> "an Automatic-Membership
--     Group is refused ..." and the parity matrix;
--   * the archived and Minimum-Level branches swapped -> "a Group refusing
--     twice answers the core's first question" and the parity matrix;
--   * `order by 1` removed from the loop -> "the first refusing Group in
--     ascending id order is named";
--   * the rank's level read as 0 (recrut) whatever p_role -> "a rank at the
--     Minimum Level is accepted" and the parity matrix.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(27);

-- ==================== Privileges ====================

select has_function('public', 'provision_group_refusal',
  array['member_role', 'bigint[]'],
  'provision_group_refusal(rank, Group ids) exists');
select ok(
  has_function_privilege('service_role',
    'public.provision_group_refusal(member_role, bigint[])', 'execute'),
  'the server identity may ask before it invites');
select ok(
  not has_function_privilege('authenticated',
    'public.provision_group_refusal(member_role, bigint[])', 'execute'),
  'a signed-in member may not ask');
select ok(
  not has_function_privilege('anon',
    'public.provision_group_refusal(member_role, bigint[])', 'execute'),
  'anon may not ask');

-- ==================== Fixtures ====================

create function pg_temp.i949(n integer) returns uuid language sql immutable as $$
  select ('94900000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- 1 is the inviting BC; 2..6 are invited auth users waiting for a profile.
insert into auth.users (id, email)
select pg_temp.i949(n), 'i' || n || '-949@test.local' from generate_series(1, 6) as n;
insert into public.profiles (id, full_name, email, role, status)
values (pg_temp.i949(1), 'BC #949', 'i1-949@test.local', 'bc', 'activ');

-- Created in this order, so ids ascend down the list: 'Nivel 3' sorts before
-- 'Arhivat' when both are named.
insert into public.groups (name, category, min_level, created_by)
values ('Deschis #949',  'department', 0, pg_temp.i949(1)),
       ('Activi #949',   'department', 2, pg_temp.i949(1)),
       ('Nivel 3 #949',  'department', 3, pg_temp.i949(1)),
       ('Arhivat #949',  'department', 0, pg_temp.i949(1));
insert into public.groups (name, category, min_level, automatic_membership, created_by)
values ('Automat #949', 'department', 0, true, pg_temp.i949(1)),
       -- Refuses on every Group question at once: archived, above every rank
       -- but the Moderator, and Automatic.
       ('Triplu #949',  'department', 7, true, pg_temp.i949(1)),
       -- Refuses on the Minimum Level and on Automatic Membership.
       ('Dublu #949',   'department', 7, true, pg_temp.i949(1));
update public.groups set status = 'archived'
 where name in ('Arhivat #949', 'Triplu #949');

create function pg_temp.g949(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name || ' #949'
$$;

-- What provision_profile itself answers for a new Member of p_role placed in
-- p_ids: the reason it raises, or 'accepted'. The call runs inside its own
-- subtransaction and is always rolled back, so the matrix below can ask it
-- again and again for the same Auth user.
create function pg_temp.provision_outcome(p_role member_role, p_ids bigint[])
returns text language plpgsql as $$
begin
  begin
    perform public.provision_profile(pg_temp.i949(6), 'Paritate #949',
                                     'i6-949@test.local', p_role, p_ids,
                                     pg_temp.i949(1));
    raise exception using errcode = 'P0001', message = 'accepted';
  exception when others then
    return sqlerrm;
  end;
end;
$$;

create function pg_temp.preflight(p_role member_role, p_ids bigint[])
returns text language sql as $$
  select coalesce(
    (select reason from public.provision_group_refusal(p_role, p_ids)),
    'accepted')
$$;

-- ==================== The answers ====================

set local role service_role;

select is_empty(
  $$ select * from provision_group_refusal('recrut', '{}') $$,
  'no Group is never refused');
select is_empty(
  format($$ select * from provision_group_refusal('activ', array[%s, %s]::bigint[]) $$,
         pg_temp.g949('Deschis'), pg_temp.g949('Activi')),
  'several Groups that all admit the rank are not refused');
select is_empty(
  format($$ select * from provision_group_refusal('recrut', array[%s, %s]::bigint[]) $$,
         pg_temp.g949('Deschis'), pg_temp.g949('Deschis')),
  'the same Group named twice is collapsed, as provision_profile collapses it');
select is_empty(
  format($$ select * from provision_group_refusal('vot', array[%s]::bigint[]) $$,
         pg_temp.g949('Nivel 3')),
  'a rank at the Minimum Level is accepted');

select results_eq(
  $$ select * from provision_group_refusal('voluntar', array[-1]::bigint[]) $$,
  $$ values (-1::bigint, 'group_manage_forbidden'::text) $$,
  'an unknown Group is refused with the core''s non-disclosing reason');
select results_eq(
  format($$ select * from provision_group_refusal('voluntar', array[%s]::bigint[]) $$,
         pg_temp.g949('Arhivat')),
  format($$ values (%s::bigint, 'group_archived'::text) $$, pg_temp.g949('Arhivat')),
  'an archived Group is refused');
select results_eq(
  format($$ select * from provision_group_refusal('activ', array[%s]::bigint[]) $$,
         pg_temp.g949('Nivel 3')),
  format($$ values (%s::bigint, 'group_member_below_min_level'::text) $$,
         pg_temp.g949('Nivel 3')),
  'a Group whose Minimum Level is above the rank is refused');
select results_eq(
  format($$ select * from provision_group_refusal('recrut', array[%s]::bigint[]) $$,
         pg_temp.g949('Automat')),
  format($$ values (%s::bigint, 'automatic_group_has_no_roster_members'::text) $$,
         pg_temp.g949('Automat')),
  'an Automatic-Membership Group is refused: it holds no ordinary roster row');

select results_eq(
  format($$ select * from provision_group_refusal('recrut', array[%s]::bigint[]) $$,
         pg_temp.g949('Triplu')),
  format($$ values (%s::bigint, 'group_archived'::text) $$, pg_temp.g949('Triplu')),
  'a Group refusing twice answers the core''s first question (archived before the Minimum Level)');
select results_eq(
  format($$ select * from provision_group_refusal('recrut', array[%s, %s, %s]::bigint[]) $$,
         pg_temp.g949('Arhivat'), pg_temp.g949('Deschis'), pg_temp.g949('Nivel 3')),
  format($$ values (%s::bigint, 'group_member_below_min_level'::text) $$,
         pg_temp.g949('Nivel 3')),
  'the first refusing Group in ascending id order is named, whatever order the ids came in');
select results_eq(
  format($$ select * from provision_group_refusal(null, array[%s]::bigint[]) $$,
         pg_temp.g949('Activi')),
  format($$ values (%s::bigint, 'group_member_below_min_level'::text) $$,
         pg_temp.g949('Activi')),
  'a missing rank reads as Recrut, provision_profile''s default');

reset role;

-- ==================== Parity with provision_profile ====================

create temp table matrix949 as
select rank.id as role, sets.ids
  from public.roles as rank
 cross join (values
   ('{}'::bigint[]),
   (array[pg_temp.g949('Deschis')]),
   (array[pg_temp.g949('Deschis'), pg_temp.g949('Activi')]),
   (array[pg_temp.g949('Activi'), pg_temp.g949('Deschis'), pg_temp.g949('Activi')]),
   (array[pg_temp.g949('Nivel 3')]),
   (array[pg_temp.g949('Arhivat')]),
   (array[pg_temp.g949('Automat')]),
   (array[pg_temp.g949('Triplu')]),
   (array[pg_temp.g949('Dublu')]),
   (array[pg_temp.g949('Deschis'), pg_temp.g949('Arhivat')]),
   (array[pg_temp.g949('Arhivat'), pg_temp.g949('Nivel 3')]),
   (array[pg_temp.g949('Automat'), pg_temp.g949('Activi')]),
   (array[-1::bigint, pg_temp.g949('Deschis')])
 ) as sets(ids);

create temp table parity949 as
select role, ids,
       pg_temp.preflight(role, ids)          as preflight,
       pg_temp.provision_outcome(role, ids)  as provision
  from matrix949;

select is_empty(
  $$ select role, ids, preflight, provision from parity949
      where preflight is distinct from provision $$,
  'for every rank and Group set, the preflight answers exactly what provision_profile does');
select ok(
  (select count(distinct provision) from parity949) >= 5
    and exists (select 1 from parity949 where provision = 'accepted'),
  'the parity matrix meets acceptance and every Group refusal reason');

-- ==================== The invitation contract ====================

-- Name and email only: exactly how invite-member calls when the dialog's
-- Optional section is left alone.
set local role service_role;
select lives_ok(
  format($$ select provision_profile(p_user_id => %L::uuid, p_full_name => 'Doar Nume',
                                     p_email => 'i2-949@test.local',
                                     p_role => 'recrut', p_group_ids => '{}',
                                     p_appointed_by => %L::uuid) $$,
         pg_temp.i949(2), pg_temp.i949(1)),
  'an invitation with only a name and an address provisions');
reset role;
select is((select role from public.profiles where id = pg_temp.i949(2)),
  'recrut'::member_role, 'the default rank is Recrut');
select is((select joined_at from public.profiles where id = pg_temp.i949(2)),
  (now() at time zone 'Europe/Bucharest')::date, 'and they join today (#933)');
select is(
  (select count(*) from public.group_members where member_id = pg_temp.i949(2)),
  0::bigint, 'on no roster: their first Department comes later');
select is(
  (select array_agg(set_row.source)
     from public.groups as grp
    cross join lateral private.group_member_set(grp.id, false) as set_row
    where grp.is_organization and set_row.member_id = pg_temp.i949(2)),
  array['automatic'],
  'and in OSUBB, by Automatic Membership');

set local role service_role;
select lives_ok(
  format($$ select provision_profile(p_user_id => %L::uuid, p_full_name => 'Trei Grupuri',
                                     p_email => 'i3-949@test.local', p_role => 'activ',
                                     p_group_ids => array[%s, %s]::bigint[],
                                     p_appointed_by => %L::uuid) $$,
         pg_temp.i949(3), pg_temp.g949('Activi'), pg_temp.g949('Deschis'),
         pg_temp.i949(1)),
  'an invitation with a rank and several Groups provisions');
reset role;
select is(
  (select array_agg(grp.name order by grp.name)
     from public.group_members as gm join public.groups as grp on grp.id = gm.group_id
    where gm.member_id = pg_temp.i949(3)),
  array['Activi #949', 'Deschis #949'],
  'and places the Member in every chosen Group');

set local role service_role;
select throws_ok(
  format($$ select provision_profile(p_user_id => %L::uuid, p_full_name => 'Unul Refuzat',
                                     p_email => 'i4-949@test.local', p_role => 'voluntar',
                                     p_group_ids => array[%s, %s]::bigint[],
                                     p_appointed_by => %L::uuid) $$,
         pg_temp.i949(4), pg_temp.g949('Deschis'), pg_temp.g949('Activi'),
         pg_temp.i949(1)),
  'PT400', 'group_member_below_min_level',
  'one ineligible Group among several refuses the whole invitation');
reset role;
select is(
  (select count(*) from public.profiles where id = pg_temp.i949(4)),
  0::bigint, 'leaving no profile');
select is(
  (select count(*) from public.group_members where member_id = pg_temp.i949(4)),
  0::bigint, 'and no roster row in the Group that would have admitted them');

select * from finish();
rollback;
