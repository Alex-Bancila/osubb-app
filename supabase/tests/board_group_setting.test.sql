-- board_group_setting.test.sql -- #824 (ruling R27, pages-pass decision D1):
-- org_settings.board_group_id names the Private Group "Biroul de Conducere",
-- and a BC/BCE member's board title is their own group_members.position_title
-- there. Profil reads it with two plain reads and no new function: the
-- setting (every live active Member reads org_settings) and the caller's own
-- roster rows (group_members_read's own-row limb, behind the Private Group
-- gate).
--
-- In order: the seed row and its table CHECK; set_org_setting's rules for the
-- key (step-1 shape for every caller, the gate, the active-Group target rule
-- after the gate, the success path and clearing); the read -- the board
-- member reads their own title, a BCE outside the board and an ordinary
-- Member read no roster row of the Private Group, BC reads the whole board.
--
-- Mutation guards, each named against the assertion that turns red:
--   * drop 'board_group_id' from step 1's integer shape -> "a non-integer
--     board_group_id is invalid_org_setting_value" becomes a raw 22P02 from
--     the ::bigint cast, and the BCE's step-1 assertion becomes 42501;
--   * drop 'board_group_id' from the active-Group check -> "a board_group_id
--     naming no Group" and "an archived Group" are stored instead of refused;
--   * drop the level check -> "a BCE (level 5) cannot set board_group_id"
--     succeeds;
--   * drop the seed row -> "the board_group_id key is seeded" fails and the
--     success path is PT404.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(20);

-- ==================== Fixtures ====================

insert into auth.users (id, email) values
  ('82400000-0000-0000-0000-000000000001', 'bc824@test.local'),
  ('82400000-0000-0000-0000-000000000002', 'bce824@test.local'),
  ('82400000-0000-0000-0000-000000000003', 'bceout824@test.local'),
  ('82400000-0000-0000-0000-000000000004', 'vol824@test.local'),
  ('82400000-0000-0000-0000-000000000005', 'mod824@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('82400000-0000-0000-0000-000000000001', 'BC 824',          'bc824@test.local',     'bc',        'activ'),
  ('82400000-0000-0000-0000-000000000002', 'BCE 824',         'bce824@test.local',    'bce',       'activ'),
  -- A BCE who is not on the board: level 5 reads every public roster, but
  -- not a Private Group's.
  ('82400000-0000-0000-0000-000000000003', 'BCE în afară 824', 'bceout824@test.local', 'bce',       'activ'),
  ('82400000-0000-0000-0000-000000000004', 'Voluntar 824',    'vol824@test.local',    'voluntar',  'activ'),
  ('82400000-0000-0000-0000-000000000005', 'Moderator 824',   'mod824@test.local',    'moderator', 'activ');

insert into public.groups (name, category, min_level, is_private)
values ('Biroul 824', 'team', 5, true);
insert into public.groups (name, category, min_level, status)
values ('Arhivat 824', 'team', 0, 'archived');

create temp table fx824 as
  select (select id from public.groups where name = 'Biroul 824')  as board,
         (select id from public.groups where name = 'Arhivat 824') as archived;
grant select on fx824 to authenticated, anon;

insert into public.group_members (group_id, member_id, group_role, position_title)
select fx824.board, fixture.member_id::uuid, 'responsible', fixture.title
  from fx824,
       lateral (values
         ('82400000-0000-0000-0000-000000000001', 'Președinte 824'),
         ('82400000-0000-0000-0000-000000000002', 'Coordonator IT 824')
       ) as fixture (member_id, title);

-- The frontend's read, as the caller: the setting, then the caller's own
-- roster row on the Group it names.
create function pg_temp.my_board_title() returns text language sql stable as $$
  select membership.position_title
    from public.group_members as membership
   where membership.member_id = auth.uid()
     and membership.group_id = (select setting.value::bigint
                                  from public.org_settings as setting
                                 where setting.key = 'board_group_id');
$$;

-- ==================== 1. The seed row and the table CHECK ====================

select is((select count(*)::int from public.org_settings where key = 'board_group_id'), 1,
  'the board_group_id key is seeded');
select throws_ok(
  $$ update public.org_settings set value = 'Biroul' where key = 'board_group_id' $$,
  '23514', 'new row for relation "org_settings" violates check constraint "org_settings_board_group_id_ck"',
  'org_settings_board_group_id_ck: a direct write of a non-integer board_group_id is refused');
select matches(obj_description('public.org_settings'::regclass, 'pg_class'), 'board_group_id \(#824',
  'the table comment documents board_group_id');

-- Start from a known empty value whatever the demo seed pointed it at.
update public.org_settings set value = null, updated_by = null where key = 'board_group_id';

-- ==================== 2. set_org_setting: step 1, the gate ====================

select pg_temp.test_login_leadership('82400000-0000-0000-0000-000000000001');
select throws_ok(
  $$ select public.set_org_setting('board_group_id', 'Biroul de Conducere') $$,
  'PT400', 'invalid_org_setting_value',
  'BC: a non-integer board_group_id is invalid_org_setting_value');
select throws_ok(
  $$ select public.set_org_setting('board_group_id', '0') $$,
  'PT400', 'invalid_org_setting_value',
  'BC: board_group_id 0 is invalid_org_setting_value');
reset role;

select pg_temp.test_login_leadership('82400000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.set_org_setting('board_group_id', '-3') $$,
  'PT400', 'invalid_org_setting_value',
  'a BCE sending a malformed id is answered invalid_org_setting_value before the gate');
select throws_ok(
  format('select public.set_org_setting(%L, %L)', 'board_group_id', (select board from fx824)::text),
  '42501', 'org_settings_manage_forbidden',
  'a BCE (level 5) cannot set board_group_id, even to the board itself');
select throws_ok(
  $$ select public.set_org_setting('board_group_id', '999999999') $$,
  '42501', 'org_settings_manage_forbidden',
  'a BCE naming a missing Group is refused by the gate, not told whether it exists');
reset role;

-- ==================== 3. set_org_setting: BC and the Moderator ====================

select pg_temp.test_login_leadership('82400000-0000-0000-0000-000000000001');
select throws_ok(
  $$ select public.set_org_setting('board_group_id', '999999999') $$,
  'PT400', 'invalid_org_setting_value',
  'BC: a board_group_id naming no Group is invalid_org_setting_value');
select throws_ok(
  format('select public.set_org_setting(%L, %L)', 'board_group_id', (select archived from fx824)::text),
  'PT400', 'invalid_org_setting_value',
  'BC: a board_group_id naming an archived Group is invalid_org_setting_value');
select results_eq(
  format('select value, updated_by from public.set_org_setting(%L, %L)',
         'board_group_id', ' ' || (select board from fx824)::text || ' '),
  format('values (%L::text, %L::uuid)', (select board from fx824)::text,
         '82400000-0000-0000-0000-000000000001'),
  'BC names the board Group -- stored trimmed, BC recorded as updated_by');
reset role;

-- ==================== 4. The read ====================

select pg_temp.test_login_leadership('82400000-0000-0000-0000-000000000002');
select is(pg_temp.my_board_title(), 'Coordonator IT 824',
  'a BCE on the board reads their own title through the setting and their own roster row');
reset role;
select pg_temp.test_login_leadership('82400000-0000-0000-0000-000000000001');
select is(pg_temp.my_board_title(), 'Președinte 824',
  'BC reads their own board title');
select is(
  (select count(*)::int from public.group_members, fx824 where group_id = fx824.board),
  2,
  'BC reads the whole board roster (BC sees every Private Group)');
reset role;
select pg_temp.test_login_leadership('82400000-0000-0000-0000-000000000003');
select is(pg_temp.my_board_title(), null,
  'a BCE outside the board has no board title -- Profil falls back to the Role label');
select is(
  (select count(*)::int from public.group_members, fx824 where group_id = fx824.board),
  0,
  'a BCE outside the board reads no roster row of the Private board Group');
reset role;
select pg_temp.test_login_leadership('82400000-0000-0000-0000-000000000004');
select is(
  (select value from public.org_settings where key = 'board_group_id'),
  (select board from fx824)::text,
  'an ordinary Member reads the setting itself (every Member reads org_settings)');
select is(
  (select count(*)::int from public.group_members, fx824 where group_id = fx824.board),
  0,
  'an ordinary Member reads nothing of the board roster');
reset role;

-- ==================== 5. Clearing ====================

select pg_temp.test_login_leadership('82400000-0000-0000-0000-000000000005');
select is(
  (select value from public.set_org_setting('board_group_id', '')),
  null,
  'the Moderator clears board_group_id with a blank value');
reset role;
select pg_temp.test_login_leadership('82400000-0000-0000-0000-000000000002');
select is(pg_temp.my_board_title(), null,
  'with the setting cleared the board member has no board title');
reset role;

select * from finish();
rollback;
