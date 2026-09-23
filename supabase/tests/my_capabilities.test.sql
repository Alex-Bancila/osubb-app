-- #576 (ADR-0009 Decision 6): public.my_capabilities() is one row of booleans computed from
-- live rank and live Group Roles, and private.holds_any_group_role() is its Group-Role input.
--
-- Every row is compared as a whole (`c::text`), so an assertion that one column moved also
-- proves no other column did. Column order:
--   (manages_any_group, manage_tasks, see_directory, see_leadership,
--    manage_roles, provision_members, create_top_level_groups, administer)
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(62);

select has_function('public', 'my_capabilities', array[]::text[], 'public.my_capabilities() exists');
select is((select prosecdef from pg_proc where oid = 'public.my_capabilities()'::regprocedure), false,
  'the wrapper is security invoker; the definer body is private.my_capabilities_impl');
select ok(not has_function_privilege('anon', 'public.my_capabilities()', 'execute'),
  'anon cannot execute my_capabilities() -- a signed-out visitor has no capability row at all');
select ok(not has_function_privilege('anon', 'private.holds_any_group_role()', 'execute'),
  'anon cannot execute holds_any_group_role()');
select ok(has_function_privilege('authenticated', 'private.holds_any_group_role()', 'execute'),
  'authenticated may execute holds_any_group_role() -- it is a policy helper');

-- ==================== fixtures (rolled back) ====================
insert into auth.users (id, email) values
  ('57600000-0000-0000-0000-000000000002', 'recrut576@test.local'),
  ('57600000-0000-0000-0000-000000000003', 'voluntar576@test.local'),
  ('57600000-0000-0000-0000-000000000004', 'coordonator576@test.local'),
  ('57600000-0000-0000-0000-000000000005', 'responsible576@test.local'),
  ('57600000-0000-0000-0000-000000000006', 'vot576@test.local'),
  ('57600000-0000-0000-0000-000000000007', 'responsabil576@test.local'),
  ('57600000-0000-0000-0000-000000000008', 'bce576@test.local'),
  ('57600000-0000-0000-0000-000000000009', 'bcemanager576@test.local'),
  ('57600000-0000-0000-0000-000000000010', 'bc576@test.local'),
  ('57600000-0000-0000-0000-000000000011', 'moderator576@test.local'),
  ('57600000-0000-0000-0000-000000000012', 'stale576@test.local'),
  ('57600000-0000-0000-0000-000000000013', 'inactive576@test.local'),
  ('57600000-0000-0000-0000-000000000014', 'archived576@test.local');
insert into public.profiles (id, email, full_name, role, status) values
  ('57600000-0000-0000-0000-000000000002', 'recrut576@test.local',      'Recrut 576',      'recrut',      'activ'),
  ('57600000-0000-0000-0000-000000000003', 'voluntar576@test.local',    'Voluntar 576',    'voluntar',    'activ'),
  ('57600000-0000-0000-0000-000000000004', 'coordonator576@test.local', 'Coordonator 576', 'voluntar',    'activ'),
  ('57600000-0000-0000-0000-000000000005', 'responsible576@test.local', 'Responsible 576', 'voluntar',    'activ'),
  ('57600000-0000-0000-0000-000000000006', 'vot576@test.local',         'Vot 576',         'vot',         'activ'),
  ('57600000-0000-0000-0000-000000000007', 'responsabil576@test.local', 'Responsabil 576', 'vot', 'activ'),
  ('57600000-0000-0000-0000-000000000008', 'bce576@test.local',         'BCE 576',         'bce',         'activ'),
  ('57600000-0000-0000-0000-000000000009', 'bcemanager576@test.local',  'BCE Manager 576', 'bce',         'activ'),
  ('57600000-0000-0000-0000-000000000010', 'bc576@test.local',          'BC 576',          'bc',          'activ'),
  ('57600000-0000-0000-0000-000000000011', 'moderator576@test.local',   'Moderator 576',   'moderator',   'activ'),
  ('57600000-0000-0000-0000-000000000012', 'stale576@test.local',       'Stale 576',       'voluntar',    'activ'),
  ('57600000-0000-0000-0000-000000000013', 'inactive576@test.local',    'Inactive 576',    'bc',          'inactiv'),
  ('57600000-0000-0000-0000-000000000014', 'archived576@test.local',    'Archived 576',    'voluntar',    'activ');

-- Native Groups (OD9 fixture exception): a Project, a Team, a Department, an archived Team.
insert into public.groups (name, category) values
  ('Project #576', 'project'), ('Team #576', 'team'), ('Department #576', 'department'),
  ('Archived #576', 'team');
update public.groups set status = 'archived' where name = 'Archived #576';
insert into public.group_members (group_id, member_id, group_role)
select grp.id, member.id::uuid, member.group_role
  from (values ('Project #576',    '57600000-0000-0000-0000-000000000004', 'manager'),
               ('Team #576',       '57600000-0000-0000-0000-000000000005', 'responsible'),
               ('Department #576', '57600000-0000-0000-0000-000000000009', 'manager'),
               ('Team #576',       '57600000-0000-0000-0000-000000000013', 'manager'),
               ('Archived #576',   '57600000-0000-0000-0000-000000000014', 'manager'))
         as member (group_name, id, group_role)
  join public.groups as grp on grp.name = member.group_name;

-- One persona block: exactly one row, the whole row, and manage_tasks = can_manage_tasks().
create function pg_temp.persona_checks(p_label text, p_expected text) returns setof text
language plpgsql as $$
begin
  return next is((select count(*) from public.my_capabilities())::int, 1,
    p_label || ': exactly one capability row');
  return next is((select c::text from public.my_capabilities() as c), p_expected,
    p_label || ': the capability row is ' || p_expected);
  return next is((select c.manage_tasks from public.my_capabilities() as c),
                 coalesce(public.can_manage_tasks(), false),
    p_label || ': manage_tasks equals public.can_manage_tasks()');
end;
$$;
grant execute on function pg_temp.persona_checks(text, text) to authenticated;

-- ==================== 14 personas ====================
-- 1. Claimless session of a Coordonator who does hold a Group Role: the claims are gone, so
--    nothing is granted, Group Role or not.
select set_config('request.jwt.claims',
  '{"sub":"57600000-0000-0000-0000-000000000004","role":"authenticated"}', true);
set local role authenticated;
select * from pg_temp.persona_checks('claimless Coordonator', '(f,f,f,f,f,f,f,f)');
select is(private.holds_any_group_role(), false, 'claimless Coordonator: holds_any_group_role() is false');
reset role;

-- 2. Claimless session of a live BC: rank without claims grants nothing either.
select set_config('request.jwt.claims',
  '{"sub":"57600000-0000-0000-0000-000000000010","role":"authenticated"}', true);
set local role authenticated;
select * from pg_temp.persona_checks('claimless BC', '(f,f,f,f,f,f,f,f)');
reset role;

-- 3. Recrut (level 0), no Group Role.
select pg_temp.test_login_leadership('57600000-0000-0000-0000-000000000002');
select * from pg_temp.persona_checks('Recrut', '(f,f,f,f,f,f,f,f)');
reset role;

-- 4. Voluntar (level 1), no Group Role.
select pg_temp.test_login_leadership('57600000-0000-0000-0000-000000000003');
select * from pg_temp.persona_checks('Voluntar', '(f,f,f,f,f,f,f,f)');
select is(private.holds_any_group_role(), false, 'Voluntar: holds_any_group_role() is false');
reset role;

-- 5. Level-1 Coordonator Principal (Project Group Manager): Group-Role columns only.
select pg_temp.test_login_leadership('57600000-0000-0000-0000-000000000004');
select * from pg_temp.persona_checks('level-1 Coordonator Principal', '(t,t,f,f,f,f,f,t)');
select is(private.holds_any_group_role(), true, 'level-1 Coordonator Principal: holds_any_group_role() is true');
reset role;

-- 6. Level-1 Group Responsible of a Team.
select pg_temp.test_login_leadership('57600000-0000-0000-0000-000000000005');
select * from pg_temp.persona_checks('level-1 Group Responsible', '(t,t,f,f,f,f,f,t)');
reset role;

-- 7. Voluntar cu Drept de Vot (level 3), no Group Role.
select pg_temp.test_login_leadership('57600000-0000-0000-0000-000000000006');
select * from pg_temp.persona_checks('Drept de Vot', '(f,f,f,f,f,f,f,f)');
reset role;

-- 8. The retired level 4 grants nothing by rank (manageTasks: 4 is gone, ADR-0009 Ranks).
select pg_temp.test_login_leadership('57600000-0000-0000-0000-000000000007');
select * from pg_temp.persona_checks('level-4 responsabil without a Group Role', '(f,f,f,f,f,f,f,f)');
reset role;

-- 9. BCE holding no Group Role: reads by rank, writes nothing by rank (ADR-0009 Authority).
select pg_temp.test_login_leadership('57600000-0000-0000-0000-000000000008');
select * from pg_temp.persona_checks('BCE without a Group Role', '(f,f,t,t,f,f,f,f)');
select is(private.holds_any_group_role(), false, 'BCE without a Group Role: holds_any_group_role() is false');
reset role;

-- 10. BCE who is a Department Group Manager.
select pg_temp.test_login_leadership('57600000-0000-0000-0000-000000000009');
select * from pg_temp.persona_checks('BCE Department Manager', '(t,t,t,t,f,f,f,t)');
reset role;

-- 11. BC (level 6).
select pg_temp.test_login_leadership('57600000-0000-0000-0000-000000000010');
select * from pg_temp.persona_checks('BC', '(t,t,t,t,t,t,t,t)');
reset role;

-- 12. Moderator (level 9).
select pg_temp.test_login_leadership('57600000-0000-0000-0000-000000000011');
select * from pg_temp.persona_checks('Moderator', '(t,t,t,t,t,t,t,t)');
reset role;

-- 13. A stale claim: the token still says BC, the live Profile says Voluntar. Live rank wins.
select pg_temp.test_login('57600000-0000-0000-0000-000000000012',
  '{"member_role":"bc","member_level":6,"dept_ids":[],"team_ids":[],"group_ids":[]}'::jsonb);
select * from pg_temp.persona_checks('stale BC claim over a live Voluntar', '(f,f,f,f,f,f,f,f)');
reset role;

-- 14. An inactive BC with a stale claim and a Group Manager row: nothing, Group Role included.
select pg_temp.test_login_leadership('57600000-0000-0000-0000-000000000013');
select * from pg_temp.persona_checks('inactive BC with a stale claim and a Group Role', '(f,f,f,f,f,f,f,f)');
select is(private.holds_any_group_role(), false,
  'inactive member with a stale claim: holds_any_group_role() is false despite the roster row');
reset role;

-- The two Group-Role columns part ways on an archived Group: the position is still held
-- (manages_any_group, administer), but no work in an archived Group is manageable.
select pg_temp.test_login_leadership('57600000-0000-0000-0000-000000000014');
select * from pg_temp.persona_checks('Manager of an archived Group only', '(t,f,f,f,f,f,f,t)');
reset role;

-- ==================== each column flips only with its own input ====================
-- Rank crosses 5: see_directory and see_leadership, nothing else.
update public.profiles set role = 'bce' where id = '57600000-0000-0000-0000-000000000003';
select pg_temp.test_login_leadership('57600000-0000-0000-0000-000000000003');
select is((select c::text from public.my_capabilities() as c), '(f,f,t,t,f,f,f,f)',
  'Voluntar promoted to BCE: only see_directory and see_leadership flip');
reset role;

-- Rank crosses 6: the level-6 columns, plus the two whose input includes level >= 6
-- (manages_any_group, administer) and manage_tasks, whose can_manage_tasks() admits BC.
update public.profiles set role = 'bc' where id = '57600000-0000-0000-0000-000000000003';
select pg_temp.test_login_leadership('57600000-0000-0000-0000-000000000003');
select is((select c::text from public.my_capabilities() as c), '(t,t,t,t,t,t,t,t)',
  'BCE promoted to BC: every level-6 input flips, see_* stay on');
reset role;

-- Back below 5: every rank-derived column falls together.
update public.profiles set role = 'voluntar' where id = '57600000-0000-0000-0000-000000000003';
select pg_temp.test_login_leadership('57600000-0000-0000-0000-000000000003');
select is((select c::text from public.my_capabilities() as c), '(f,f,f,f,f,f,f,f)',
  'BC demoted to Voluntar: every rank-derived column falls');
reset role;

-- Gaining a Group Role: manages_any_group, manage_tasks, administer -- and no rank column.
insert into public.group_members (group_id, member_id, group_role)
select id, '57600000-0000-0000-0000-000000000003', 'responsible' from public.groups where name = 'Team #576';
select pg_temp.test_login_leadership('57600000-0000-0000-0000-000000000003');
select is((select c::text from public.my_capabilities() as c), '(t,t,f,f,f,f,f,t)',
  'Voluntar appointed Group Responsible: only the Group-Role columns flip');
reset role;

-- Losing it: they flip back, still without a rank column moving.
delete from public.group_members
 where member_id = '57600000-0000-0000-0000-000000000003';
select pg_temp.test_login_leadership('57600000-0000-0000-0000-000000000003');
select is((select c::text from public.my_capabilities() as c), '(f,f,f,f,f,f,f,f)',
  'Group Responsible removed: the Group-Role columns flip back');
reset role;

-- A plain roster row is not a Group Role.
insert into public.group_members (group_id, member_id, group_role)
select id, '57600000-0000-0000-0000-000000000003', 'member' from public.groups where name = 'Team #576';
select pg_temp.test_login_leadership('57600000-0000-0000-0000-000000000003');
select is((select c::text from public.my_capabilities() as c), '(f,f,f,f,f,f,f,f)',
  'ordinary membership of a Group moves no column');
reset role;

-- Deactivation alone, roster untouched (R22): everything falls, stale claim or not.
update public.profiles set status = 'inactiv' where id = '57600000-0000-0000-0000-000000000009';
select pg_temp.test_login('57600000-0000-0000-0000-000000000009',
  '{"member_role":"bce","member_level":5,"dept_ids":[],"team_ids":[],"group_ids":[]}'::jsonb);
select is((select c::text from public.my_capabilities() as c), '(f,f,f,f,f,f,f,f)',
  'BCE Department Manager deactivated: every column falls with the roster row still in place');
reset role;

select * from finish();
rollback;
