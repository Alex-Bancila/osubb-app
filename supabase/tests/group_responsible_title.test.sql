-- #962: a display name for the Group Responsible position -- groups.responsible_title.
--
-- The Group Manager's position has been named per Group since #582
-- (groups.manager_title); this is the same setting for the Group Responsible
-- position, so a Department's BCE members can be its "Coordonator" rather
-- than its "Responsabil". Each Responsible still carries their own title
-- (group_members.position_title); the Group's is the default and the fallback.
--
-- In the order the command answers: the schema and its two named constraints
-- (Ruling 23: every throws_ok names its constraint), the step-1 rules for
-- everyone (claimless callers included), the persona matrix of
-- private.require_group_manager, the full-state replace (set, trim, change,
-- clear, nothing_to_update), the Notification wording, and the signature.
--
-- Mutation guards, each named against the assertion that turns red:
--   * drop groups_responsible_title_ck / _length_ck -> section 1's direct
--     writes stop throwing;
--   * drop the blank check or the private.require_text_length call -> the
--     claimless caller in section 2 hears 42501 instead of PT400;
--   * drop the btrim -> "stored trimmed" reads the padded value;
--   * drop the column from the nothing_to_update tuple -> the first set is
--     refused as nothing_to_update;
--   * drop the column from the UPDATE's SET list -> every stored-value read
--     fails;
--   * drop the Responsible branch of the display name in
--     private.set_group_role_impl -> the demoted untitled Responsibles are
--     told they are no longer "coordonator de grup".
--
-- Fixture Groups and roster rows are inserted directly (conventions OD9:
-- owner-run, rolled back).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(35);

-- ==================== Fixtures ====================

create function pg_temp.g962_uid(n integer) returns uuid language sql immutable as $$
  select ('96200000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users (id, email)
select pg_temp.g962_uid(n), 'member.' || n || '.962@test.local' from generate_series(1, 9) n;

-- 1 BC, 2 Group Manager of both roots, 3 titled Group Responsible of the
-- Department, 4 ordinary member of the Department, 5 claimless, 6 an
-- UNTITLED Group Responsible of the Department and 7 of the Team (a row a
-- migration backfill could leave -- no constraint requires the title), 8 and
-- 9 on no roster, appointed in section 5.
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.g962_uid(n), 'Member #962 ' || n, 'member.' || n || '.962@test.local',
  (case n when 1 then 'bc' else 'voluntar' end)::public.member_role,
  'activ'::public.member_status
from generate_series(1, 9) n;

insert into public.groups (name, category, min_level, created_by)
values ('Departament #962', 'department', 0, pg_temp.g962_uid(1)),
       ('Echipă #962',      'team',       0, pg_temp.g962_uid(1));

create function pg_temp.g962_group(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;

insert into public.group_members (group_id, member_id, group_role, position_title)
values (pg_temp.g962_group('Departament #962'), pg_temp.g962_uid(2), 'manager',     null),
       (pg_temp.g962_group('Departament #962'), pg_temp.g962_uid(3), 'responsible', 'Responsabil IT #962'),
       (pg_temp.g962_group('Departament #962'), pg_temp.g962_uid(4), 'member',      null),
       (pg_temp.g962_group('Departament #962'), pg_temp.g962_uid(6), 'responsible', null),
       (pg_temp.g962_group('Echipă #962'),      pg_temp.g962_uid(2), 'manager',     null),
       (pg_temp.g962_group('Echipă #962'),      pg_temp.g962_uid(7), 'responsible', null);

create function pg_temp.g962_bc() returns void language sql as $$
  select pg_temp.test_login(pg_temp.g962_uid(1), '{"member_role":"bc","member_level":6}'::jsonb) $$;
create function pg_temp.g962_as(n integer) returns void language sql as $$
  select pg_temp.test_login(pg_temp.g962_uid(n), '{"member_role":"voluntar","member_level":1}'::jsonb) $$;

-- The Department's full operational state, with only the two titles varying.
create function pg_temp.g962_set(p_manager text, p_responsible text) returns text
language sql as $$
  select format($f$select public.update_group(%s, 'Departament #962', %L, %L, false, null, false, 0, null, null)$f$,
                pg_temp.g962_group('Departament #962'), p_manager, p_responsible)
$$;
create function pg_temp.g962_titles(p_name text) returns text[]
language sql stable security definer set search_path = '' as $$
  select array[manager_title, responsible_title] from public.groups where name = p_name
$$;
create function pg_temp.g962_body(n integer) returns text
language sql stable security definer set search_path = '' as $$
  select body from public.notifications
   where member_id = pg_temp.g962_uid(n)
   order by id desc limit 1
$$;

-- ==================== 1 · schema and the two named constraints ====================

select has_column('public', 'groups', 'responsible_title', 'groups.responsible_title exists');
select col_type_is('public', 'groups', 'responsible_title', 'text', 'groups.responsible_title is text');
select col_is_null('public', 'groups', 'responsible_title',
  'groups.responsible_title is optional: a Group without the setting says "Responsabil"');

select throws_ok(
  $$ update public.groups set responsible_title = '   ' where name = 'Echipă #962' $$,
  '23514', 'new row for relation "groups" violates check constraint "groups_responsible_title_ck"',
  'groups_responsible_title_ck: a whitespace-only title is refused on a direct write');
select throws_ok(
  $$ update public.groups set responsible_title = repeat('r', 81) where name = 'Echipă #962' $$,
  '23514', 'new row for relation "groups" violates check constraint "groups_responsible_title_length_ck"',
  'groups_responsible_title_length_ck: a title over 80 characters is refused on a direct write');
select is(
  (select array_agg(conname::text order by conname) from pg_constraint
    where conrelid = 'public.groups'::regclass and contype = 'c' and convalidated
      and conname in ('groups_responsible_title_ck', 'groups_responsible_title_length_ck')),
  array['groups_responsible_title_ck', 'groups_responsible_title_length_ck'],
  'both constraints exist and are validated');

select pg_temp.g962_bc();
select throws_ok(
  $$ update public.groups set responsible_title = 'Coordonator' where name = 'Echipă #962' $$,
  '42501', 'permission denied for table groups',
  'authenticated -- even BC -- cannot write the title directly: update_group is the only write path');

-- ==================== 2 · step 1: malformed for everyone, before the gate ====================

reset role;
select pg_temp.test_login(pg_temp.g962_uid(5), '{"provider":"email"}'::jsonb);
select throws_ok(pg_temp.g962_set(null, '   '),
  'PT400', 'invalid_position_title',
  'a claimless caller sending a blank (not null) title gets PT400 invalid_position_title, as for the Manager title');
select throws_ok(pg_temp.g962_set(null, repeat('r', 81)),
  'PT400', 'responsible_title_too_long',
  'a claimless caller sending 81 characters gets PT400 responsible_title_too_long, ahead of the gate');
select throws_ok(pg_temp.g962_set(null, ' ' || repeat('r', 80) || ' '),
  '42501', 'group_manage_forbidden',
  'the title is measured as stored (trimmed): 80 characters padded pass step 1 and meet the gate');

-- ==================== 3 · authority: private.require_group_manager ====================

reset role;
select pg_temp.g962_as(4);
select throws_ok(pg_temp.g962_set(null, 'Coordonator'),
  '42501', 'group_manage_forbidden',
  'an ordinary member (a Voluntar) cannot name the position');

reset role;
select pg_temp.g962_as(3);
select throws_ok(pg_temp.g962_set(null, 'Coordonator'),
  '42501', 'group_manage_forbidden',
  'a Group RESPONSIBLE cannot name their own position -- it is an operational setting of the Manager tier');

reset role;
select is(pg_temp.g962_titles('Departament #962'), array[null, null]::text[],
  'nothing refused above reached the row');

-- ==================== 4 · the full-state replace ====================

select pg_temp.g962_as(2);
select lives_ok(pg_temp.g962_set(null, E'  Coordonator \t'),
  'the Group''s Manager names the Responsible position through update_group');
select is(pg_temp.g962_titles('Departament #962'), array[null, 'Coordonator'],
  'stored trimmed, and the Manager title is untouched');
select throws_ok(pg_temp.g962_set(null, 'Coordonator '),
  'PT409', 'nothing_to_update',
  'sending the same title back (differently padded) is nothing_to_update');
select lives_ok(pg_temp.g962_set('Vicepreședinte', 'Coordonator'),
  'the two position names are set in one call');
select is(pg_temp.g962_titles('Departament #962'), array['Vicepreședinte', 'Coordonator'],
  'and stored side by side, each in its own column');
select lives_ok(pg_temp.g962_set('Vicepreședinte', repeat('ș', 80)),
  'an 80-character title is accepted (counted in characters, not bytes)');
select is((select char_length(responsible_title) from public.groups where name = 'Departament #962'), 80,
  'and stored whole');
select lives_ok(pg_temp.g962_set('Vicepreședinte', null),
  'a null title clears the setting (full-state replace, OD5)');
select is(pg_temp.g962_titles('Departament #962'), array['Vicepreședinte', null],
  'the cleared title is gone and the Manager title stays');
select throws_ok(pg_temp.g962_set('Vicepreședinte', null),
  'PT409', 'nothing_to_update',
  'clearing a title that is already clear is nothing_to_update');
select lives_ok(pg_temp.g962_set(null, 'Coordonator'),
  'the Department names its Responsibles Coordonator and its Manager nothing, for section 5');

-- ==================== 5 · the Notification names the position ====================

select lives_ok(
  format($$select public.set_group_role(%s, %L, 'member')$$,
         pg_temp.g962_group('Departament #962'), pg_temp.g962_uid(6)),
  'the Manager ends the position of a Responsible whose row carries no title');
reset role;
select is(pg_temp.g962_body(6),
  'Nu mai ești Coordonator în grupul Departament #962, dar rămâi membru.',
  'the untitled Responsible hears the Group''s name for the position');

select pg_temp.g962_as(2);
select lives_ok(
  format($$select public.set_group_role(%s, %L, 'member')$$,
         pg_temp.g962_group('Echipă #962'), pg_temp.g962_uid(7)),
  'the same in a Group without the setting');
reset role;
select is(pg_temp.g962_body(7),
  'Nu mai ești responsabil în grupul Echipă #962, dar rămâi membru.',
  'without the setting a Responsible is "responsabil", never the Manager''s "coordonator de grup"');

select pg_temp.g962_as(2);
select lives_ok(
  format($$select public.set_group_role(%s, %L, 'responsible', 'Responsabil Foto #962')$$,
         pg_temp.g962_group('Departament #962'), pg_temp.g962_uid(9)),
  'the Manager appoints a Responsible under a title of their own');
reset role;
select is(pg_temp.g962_body(9),
  'Ai fost numit Responsabil Foto #962 în grupul Departament #962.',
  'the Responsible''s own title comes before the Group''s');

select pg_temp.g962_bc();
select lives_ok(
  format($$select public.set_group_role(%s, %L, 'manager')$$,
         pg_temp.g962_group('Departament #962'), pg_temp.g962_uid(8)),
  'BC appoints a Manager of the Department');
reset role;
select is(pg_temp.g962_body(8),
  'Ai fost numit coordonator de grup în grupul Departament #962.',
  'a Manager is never named after the Responsible position: no Manager title still says "coordonator de grup"');

-- ==================== 6 · one signature, the title after the Manager's ====================

select is(
  (select count(*)::integer from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_group'),
  1, 'public.update_group exists under exactly one signature');
select is(
  (select p.proargnames[4] from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_group'),
  'p_responsible_title', 'public.update_group takes p_responsible_title right after p_manager_title');
select is(
  (select p.proargnames[4] from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'update_group_impl'),
  'p_responsible_title', 'private.update_group_impl takes it in the same place');

select * from finish();
rollback;
