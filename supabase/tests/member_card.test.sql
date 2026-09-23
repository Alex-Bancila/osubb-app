-- member_card.test.sql — #675: public.member_card(p_member_id), the Member
-- Card projection (R6) whose chip rule is R17's. Persona matrix, chip
-- selection against an earlier Child-Group membership and a later top-level
-- one, exclusion of the Organization Group and an archived Group, and the
-- absence of any contact, points or rank column on the return type.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(26);

-- ==================== 1. Surface, shape and grants ====================

select has_function('public', 'member_card', array['uuid'], 'public.member_card(uuid) exists');
select has_function('private', 'member_card_impl', array['uuid'],
  'its security-definer body exists in private');
select ok(
  (select not procedure.prosecdef and procedure.provolatile = 's'
          and 'search_path=""' = any(procedure.proconfig)
     from pg_proc as procedure where procedure.oid = 'public.member_card(uuid)'::regprocedure),
  'the wrapper is stable, security invoker, and pins search_path');
select ok(
  (select procedure.prosecdef and procedure.provolatile = 's'
          and 'search_path=""' = any(procedure.proconfig)
     from pg_proc as procedure where procedure.oid = 'private.member_card_impl(uuid)'::regprocedure),
  'the body is stable, security definer, and pins search_path');
select is(
  pg_get_function_result('public.member_card(uuid)'::regprocedure),
  'TABLE(member_id uuid, nickname text, full_name text, role member_role, joined_at date, avatar_color text, primary_group_id bigint, primary_group_name text, primary_group_color text, other_memberships integer, memberships jsonb)',
  'the projection returns exactly the Member Card columns');
-- R6: contact only for viewers who can already read profiles_contact, never
-- here; never points or rank. Asserted on both functions' declared columns.
select is(
  (select count(*)
     from pg_proc as procedure
     cross join lateral unnest(procedure.proargnames) as argument(name)
    where procedure.oid in ('public.member_card(uuid)'::regprocedure,
                            'private.member_card_impl(uuid)'::regprocedure)
      and argument.name in ('email', 'phone', 'points', 'rank', 'tier')),
  0::bigint,
  'no email, phone, points, rank or tier column exists on either return type');
select ok(
  has_function_privilege('authenticated', 'public.member_card(uuid)', 'execute')
  and has_function_privilege('authenticated', 'private.member_card_impl(uuid)', 'execute'),
  'authenticated executes the wrapper and its body');
select is(
  (select count(*)
     from pg_proc as procedure
    where procedure.oid in ('public.member_card(uuid)'::regprocedure,
                            'private.member_card_impl(uuid)'::regprocedure)
      and (has_function_privilege('anon', procedure.oid, 'execute')
           or has_function_privilege('service_role', procedure.oid, 'execute')
           or has_function_privilege('public', procedure.oid, 'execute'))),
  0::bigint, 'anon, service_role and PUBLIC execute neither');

-- ==================== 2. Fixtures — prefix 67510000-… ====================

insert into auth.users (id, email) values
  ('67510000-0000-0000-0000-000000000001', 'viewer.6751@test.local'),
  ('67510000-0000-0000-0000-000000000002', 'target.6751@test.local'),
  ('67510000-0000-0000-0000-000000000003', 'nogroups.6751@test.local'),
  ('67510000-0000-0000-0000-000000000004', 'inactive.6751@test.local'),
  ('67510000-0000-0000-0000-000000000005', 'formerly.6751@test.local');
insert into public.profiles (id, full_name, email, phone, role, status, joined_at, avatar_color) values
  ('67510000-0000-0000-0000-000000000001', 'Privitor 6751',   'viewer.6751@test.local',   '0700675101', 'voluntar', 'activ',   '2025-10-01', null),
  ('67510000-0000-0000-0000-000000000002', 'Ținta Completă 6751', 'target.6751@test.local', '0700675102', 'activ', 'activ', '2024-10-15', '#284C93'),
  ('67510000-0000-0000-0000-000000000003', 'Fara Grupuri 6751', 'nogroups.6751@test.local', null,      'recrut',   'activ',   null,         null),
  ('67510000-0000-0000-0000-000000000004', 'Inactiv 6751',    'inactive.6751@test.local', null,         'voluntar', 'inactiv', null,         null),
  ('67510000-0000-0000-0000-000000000005', 'Fost Membru 6751', 'formerly.6751@test.local', null,        'voluntar', 'inactiv', '2023-10-01', null);
update public.profiles set nickname = 'Ținta'
 where id = '67510000-0000-0000-0000-000000000002';

-- A top-level parent whose Child Group the target joined FIRST; an archived
-- top-level Group joined before the chip's; the chip itself; a later
-- top-level Group. Plus a roster row on the Organization Group, earliest of
-- all (a Group Role there -- the Organization's Automatic Membership admits
-- no plain 'member' rows).
insert into public.groups (name, category, min_level, color, created_by) values
  ('Părinte #6751',  'department', 0, '#111111', '67510000-0000-0000-0000-000000000001'),
  ('Arhivat #6751',  'department', 0, '#222222', '67510000-0000-0000-0000-000000000001'),
  ('Primul #6751',   'department', 0, '#333333', '67510000-0000-0000-0000-000000000001'),
  ('Al doilea #6751', 'project',   0, '#444444', '67510000-0000-0000-0000-000000000001');

create function pg_temp.g6751(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;

insert into public.groups (name, category, parent_id, min_level, color, created_by)
values ('Copil #6751', 'team', pg_temp.g6751('Părinte #6751'), 0, '#555555',
        '67510000-0000-0000-0000-000000000001');

insert into public.group_members (group_id, member_id, group_role, position_title, created_at) values
  ((select id from public.groups where is_organization),
                               '67510000-0000-0000-0000-000000000002', 'manager', null,             '2024-01-01 09:00:00+00'),
  (pg_temp.g6751('Copil #6751'),  '67510000-0000-0000-0000-000000000002', 'responsible', 'Coordonator', '2024-02-01 09:00:00+00'),
  (pg_temp.g6751('Arhivat #6751'), '67510000-0000-0000-0000-000000000002', 'member', null,             '2024-03-01 09:00:00+00'),
  (pg_temp.g6751('Primul #6751'),  '67510000-0000-0000-0000-000000000002', 'member', null,             '2024-04-01 09:00:00+00'),
  (pg_temp.g6751('Al doilea #6751'), '67510000-0000-0000-0000-000000000002', 'manager', null,          '2024-05-01 09:00:00+00'),
  (pg_temp.g6751('Primul #6751'),  '67510000-0000-0000-0000-000000000005', 'member', null,             '2023-10-01 09:00:00+00');
update public.groups set status = 'archived' where name = 'Arhivat #6751';

create function pg_temp.as6751(n integer) returns void language sql as $$
  select pg_temp.test_login(('67510000-0000-0000-0000-00000000000' || n)::uuid,
    '{"member_role":"voluntar","member_level":1,"dept_ids":[],"team_ids":[],"group_ids":[]}'::jsonb) $$;

-- ==================== 3. Any active Member reads any Member's card ====================

select pg_temp.as6751(1);

select is(
  (select count(*) from public.group_members
    where member_id = '67510000-0000-0000-0000-000000000002'),
  0::bigint,
  'the gap R6 closes: roster RLS hides a colleague''s Groups from an ordinary Member');
select is(
  (select count(*) from public.member_card('67510000-0000-0000-0000-000000000002')),
  1::bigint, 'an active level-1 Member gets exactly one card for a colleague');
select is(
  (select format('%s|%s|%s|%s|%s', member_id, nickname, full_name, role, joined_at)
     from public.member_card('67510000-0000-0000-0000-000000000002')),
  '67510000-0000-0000-0000-000000000002|Ținta|Ținta Completă 6751|activ|2024-10-15',
  'the card carries the Nickname, full name, Role and join date');
select is(
  (select avatar_color from public.member_card('67510000-0000-0000-0000-000000000002')),
  '#284C93', 'and the avatar colour');
select is(
  (select format('%s|%s', primary_group_name, primary_group_color)
     from public.member_card('67510000-0000-0000-0000-000000000002')),
  'Primul #6751|#333333',
  'the chip is the earliest-joined ACTIVE, TOP-LEVEL, non-Organization Group -- not the earlier Child Group, the archived Group or the Organization');
select is(
  (select primary_group_id from public.member_card('67510000-0000-0000-0000-000000000002')),
  pg_temp.g6751('Primul #6751'), 'and names its id');
select is(
  (select other_memberships from public.member_card('67510000-0000-0000-0000-000000000002')),
  2, '"+n" counts the Child Group and the later top-level Group, nothing archived and not the Organization');
select is(
  (select array_agg((membership.entry ->> 'group_id')::bigint order by membership.position)
     from public.member_card('67510000-0000-0000-0000-000000000002') as card
     cross join lateral jsonb_array_elements(card.memberships)
       with ordinality as membership(entry, position)),
  array[pg_temp.g6751('Copil #6751'), pg_temp.g6751('Primul #6751'), pg_temp.g6751('Al doilea #6751')],
  'the membership list is every explicit active non-Organization row, the chip''s included, in roster order');
select is(
  (select card.memberships -> 0
     from public.member_card('67510000-0000-0000-0000-000000000002') as card),
  jsonb_build_object(
    'group_id', pg_temp.g6751('Copil #6751'),
    'name', 'Copil #6751',
    'parent_id', pg_temp.g6751('Părinte #6751'),
    'color', '#555555',
    'group_role', 'responsible',
    'position_title', 'Coordonator',
    'joined_at', '2024-02-01T09:00:00+00:00'),
  'each entry is {group_id, name, parent_id, color, group_role, position_title, joined_at}');

select is(
  (select format('%s|%s|%s|%s', coalesce(primary_group_id::text, 'null'), other_memberships,
                 memberships, coalesce(nickname, 'null'))
     from public.member_card('67510000-0000-0000-0000-000000000003')),
  'null|0|[]|null',
  'a Member with no Groups and no Nickname still has a card: no chip, "+0", an empty list');
select is(
  (select format('%s|%s', full_name, primary_group_name)
     from public.member_card('67510000-0000-0000-0000-000000000005')),
  'Fost Membru 6751|Primul #6751',
  'any Member means any Member: a deactivated colleague''s card is still readable');
select is(
  (select count(*) from public.member_card('67519999-0000-0000-0000-000000000000')),
  0::bigint, 'an unknown id returns no row');
select is(
  (select count(*) from public.member_card('67510000-0000-0000-0000-000000000001')),
  1::bigint, 'a Member reads their own card');
reset role;

-- A leadership caller reads the same projection, with no extra column.
select pg_temp.test_login('67510000-0000-0000-0000-000000000002',
  '{"member_role":"bc","member_level":6,"dept_ids":[],"team_ids":[],"group_ids":[]}'::jsonb);
select is(
  (select other_memberships from public.member_card('67510000-0000-0000-0000-000000000002')),
  2, 'the projection does not vary by viewer');
reset role;

-- ==================== 4. Denials: inactive, claimless, anon ====================

select pg_temp.as6751(4);
select is(
  (select count(*) from public.member_card('67510000-0000-0000-0000-000000000002')),
  0::bigint, 'an inactive caller with stale organization claims gets no row');
reset role;

select pg_temp.test_login('67510000-0000-0000-0000-000000000001', '{}'::jsonb);
select is(
  (select count(*) from public.member_card('67510000-0000-0000-0000-000000000002')),
  0::bigint, 'an active uid without organization claims gets no row');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(
  $$ select * from public.member_card('67510000-0000-0000-0000-000000000002') $$,
  '42501', null, 'anon cannot execute the Member Card read');
reset role;

-- ==================== 5. The label is never read ====================

select ok(
  pg_get_functiondef('private.member_card_impl(uuid)'::regprocedure) !~* 'category'
  and pg_get_functiondef('public.member_card(uuid)'::regprocedure) !~* 'category',
  'neither function mentions the Group label (conventions section 10, R17)');

select * from finish();
rollback;
