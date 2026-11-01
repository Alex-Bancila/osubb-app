-- #1129 (audit 2026-10-30, M5): the Groups delete_group protects are never
-- archived either, and the Organization marker cannot be cleared by omission.
--
-- archive_group needed only level >= 6 and no open work, while delete_group
-- refused PT409 group_protected for the Organization Group, an
-- Automatic-Membership Group and the Groups named by org_settings
-- board_group_id / adunarea_generala_group_id. Archiving cancels every future
-- Event of the subtree with a fan-out to every attendee, and unarchive (R65)
-- never un-cancels. update_group_structure read a null p_is_organization as
-- false while refusing a null p_is_private, so a full-state replace that left
-- the flag out unmarked the Organization Group, after which an org-wide
-- Announcement reached nobody.
--
-- Mutation proof: dropping the is_protected_group gate from archive_group_impl
-- turns the five archive refusals red; reading a null p_is_organization as
-- false again turns "a null p_is_organization is malformed" red; dropping the
-- clearing refusal turns "the Organization Group keeps its marker" red.
--
-- Personas (prefix 1129): 1 BC activ, 2 voluntar activ (an ordinary member).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(17);

create function pg_temp.u1129(n integer) returns uuid language sql immutable as $$
  select ('11290000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users (id, email)
select pg_temp.u1129(n), 'protected.' || n || '.1129@test.local' from generate_series(1, 2) n;
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.u1129(n), 'Protected #1129 ' || n, 'protected.' || n || '.1129@test.local',
       (case n when 1 then 'bc' else 'voluntar' end)::public.member_role, 'activ'
  from generate_series(1, 2) n;

insert into public.groups (name, category, min_level, created_by)
values ('Obișnuit #1129',         'department', 0, pg_temp.u1129(1)),
       ('Birou #1129',            'department', 0, pg_temp.u1129(1)),
       ('Adunare #1129',          'department', 0, pg_temp.u1129(1)),
       ('Părinte protejat #1129', 'department', 0, pg_temp.u1129(1));
insert into public.groups (name, category, min_level, automatic_membership, created_by)
values ('Automat #1129', 'department', 0, true, pg_temp.u1129(1));

create function pg_temp.g1129(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;
create function pg_temp.org1129() returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where is_organization
$$;

insert into public.groups (name, category, parent_id, min_level, automatic_membership, created_by)
values ('Copil automat #1129', 'team', pg_temp.g1129('Părinte protejat #1129'), 0, true, pg_temp.u1129(1));

-- The seeded Organization Group also has Automatic Membership; switch that off
-- so the Organization arm of the protection is proven on its own.
update public.groups set automatic_membership = false where is_organization;
update public.org_settings set value = pg_temp.g1129('Birou #1129')::text where key = 'board_group_id';
update public.org_settings set value = pg_temp.g1129('Adunare #1129')::text where key = 'adunarea_generala_group_id';

-- A future Event on a protected Group: the refusal must leave it standing.
insert into public.events (title, type, starts_at, group_id, created_by)
values ('Ședință Birou #1129', 'activitate', now() + interval '10 days',
        pg_temp.g1129('Birou #1129'), pg_temp.u1129(1));

-- ==================== update_group_structure ====================
-- First, while every Group is still active: a refusal here must be its own,
-- never group_archived from a section below.

select pg_temp.test_login_leadership(pg_temp.u1129(1));
select throws_ok(
  format($$select public.update_group_structure(%s, 'department', false, true, false, 0, '#112233', null, null, false)$$,
         pg_temp.g1129('Birou #1129')),
  'PT400', 'invalid_group_organization',
  'update_group_structure: a null p_is_organization is malformed -- a full-state replace must say which it is, as for p_is_private');
select throws_ok(
  format($$select public.update_group_structure(%s, 'organization', false, true, false, 0, '#112233', 'ORG', false, false)$$,
         pg_temp.org1129()),
  'PT409', 'group_protected',
  'update_group_structure: the Organization Group keeps its marker -- there is always exactly one');
select lives_ok(
  format($$select public.update_group_structure(%s, 'organization', false, true, false, 0, '#112233', 'ORG', true, false)$$,
         pg_temp.org1129()),
  'update_group_structure: every other edit of the Organization Group goes through as before');
reset role;
select is(
  (select is_organization::text || ':' || color from public.groups where id = pg_temp.org1129()),
  'true:#112233',
  'and the marker stays while the colour changed');

-- ==================== archive_group ====================

select pg_temp.test_login_leadership(pg_temp.u1129(2));
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.org1129()),
  '42501', 'group_manage_forbidden',
  'archive_group: the authority check comes first -- an ordinary member learns nothing about protection');
reset role;

select pg_temp.test_login_leadership(pg_temp.u1129(1));
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.org1129()),
  'PT409', 'group_protected', 'archive_group: the Organization Group is never archived');
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g1129('Automat #1129')),
  'PT409', 'group_protected', 'archive_group: an Automatic-Membership Group is never archived');
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g1129('Birou #1129')),
  'PT409', 'group_protected', 'archive_group: the board Group set in Setări is never archived');
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g1129('Adunare #1129')),
  'PT409', 'group_protected', 'archive_group: the Adunarea Generală set in Setări is never archived');
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g1129('Părinte protejat #1129')),
  'PT409', 'group_protected', 'archive_group: nor is a Group whose subtree holds a protected Group -- the archive would cascade onto it');
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g1129('Copil automat #1129')),
  'PT409', 'group_protected', 'archive_group: the protected Child Group is refused on its own too, through the Child branch of the authority');
reset role;

select is(
  (select cancelled_at from public.events where title = 'Ședință Birou #1129'),
  null,
  'the refused archive wrote nothing: the board Group''s future Event stands');
select is(
  (select count(*) from public.groups
    where status = 'archived'
      and (is_organization or name in ('Automat #1129', 'Birou #1129', 'Adunare #1129',
                                       'Părinte protejat #1129', 'Copil automat #1129'))),
  0::bigint,
  'and none of the protected Groups changed status');

select pg_temp.test_login_leadership(pg_temp.u1129(1));
select lives_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g1129('Obișnuit #1129')),
  'archive_group: an ordinary Group archives as before');
reset role;
select is(
  (select status from public.groups where name = 'Obișnuit #1129'), 'archived',
  'and is archived');

-- ==================== the helper both commands read ====================
-- Last, so that on a database without it the refusals above still report
-- on their own before the missing function aborts the suite.

select is(
  array[private.is_protected_group(pg_temp.g1129('Obișnuit #1129')),
        private.is_protected_group(pg_temp.org1129()),
        private.is_protected_group(pg_temp.g1129('Automat #1129')),
        private.is_protected_group(pg_temp.g1129('Birou #1129')),
        private.is_protected_group(pg_temp.g1129('Adunare #1129')),
        private.is_protected_group(pg_temp.g1129('Părinte protejat #1129')),
        private.is_protected_group(pg_temp.g1129('Copil automat #1129')),
        private.is_protected_group(999999999)],
  array[false, true, true, true, true, true, true, false],
  'is_protected_group: the Organization Group, an Automatic-Membership Group, the board and AG Groups, a Group above one and the protected Child itself; never an ordinary or unknown Group');
select is(
  public.group_delete_preview(pg_temp.g1129('Părinte protejat #1129')) -> 'protected', 'true'::jsonb,
  'group_delete_preview reads the same helper');

select * from finish();
rollback;
