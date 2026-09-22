-- #576 (ruling R14 as amended 2026-09-21): public.my_groups() lists every Group where the
-- live caller's effective Group Role is non-null -- explicit roster rows, Automatic
-- Membership, and every descendant of a Group they manage or are Responsible of -- with that
-- effective role, an `explicit` flag (their own roster row on this Group) and an `automatic`
-- flag (Automatic Member of this Group itself), filtered by groups_read.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(14);

select has_function('public', 'my_groups', array[]::text[], 'public.my_groups() exists');
select is((select prosecdef from pg_proc where oid = 'public.my_groups()'::regprocedure), false,
  'the wrapper is security invoker, so groups_read filters what it returns');
select ok(not has_function_privilege('anon', 'public.my_groups()', 'execute'), 'anon cannot execute my_groups()');

-- ==================== fixtures (rolled back) ====================
insert into auth.users (id, email) values
  ('57610000-0000-0000-0000-000000000001', 'manager576g@test.local'),
  ('57610000-0000-0000-0000-000000000002', 'member576g@test.local'),
  ('57610000-0000-0000-0000-000000000003', 'responsible576g@test.local');
insert into public.profiles (id, email, full_name, role, status) values
  ('57610000-0000-0000-0000-000000000001', 'manager576g@test.local',     'Manager 576G',     'voluntar', 'activ'),
  ('57610000-0000-0000-0000-000000000002', 'member576g@test.local',      'Member 576G',      'voluntar', 'activ'),
  ('57610000-0000-0000-0000-000000000003', 'responsible576g@test.local', 'Responsible 576G', 'vot',      'activ');

-- Native Groups (OD9 fixture exception): a three-level chain, two Automatic-Membership Groups
-- at different Minimum Levels, and an archived Group.
insert into public.groups (name, category) values ('Parent #576G', 'team');
insert into public.groups (name, category, parent_id)
select 'Child #576G', 'team', id from public.groups where name = 'Parent #576G';
insert into public.groups (name, category, parent_id)
select 'Grandchild #576G', 'team', id from public.groups where name = 'Child #576G';
insert into public.groups (name, category, automatic_membership, min_level) values
  ('Auto #576G', 'team', true, 1), ('AutoHigh #576G', 'team', true, 3), ('Gone #576G', 'team', false, 0);
update public.groups set status = 'archived' where name = 'Gone #576G';

insert into public.group_members (group_id, member_id, group_role)
select grp.id, row_.id::uuid, row_.group_role
  from (values ('Parent #576G', '57610000-0000-0000-0000-000000000001', 'manager'),
               ('Child #576G',  '57610000-0000-0000-0000-000000000001', 'member'),
               ('Child #576G',  '57610000-0000-0000-0000-000000000002', 'member'),
               ('Gone #576G',   '57610000-0000-0000-0000-000000000002', 'member'),
               ('Parent #576G', '57610000-0000-0000-0000-000000000003', 'responsible'))
         as row_ (group_name, id, group_role)
  join public.groups as grp on grp.name = row_.group_name;

create function pg_temp.my_fixture_groups() returns text
language sql as $$
  select coalesce(string_agg(format('%s:%s:%s:%s', mine.name, mine.group_role,
                                    mine.explicit, mine.automatic), ' | ' order by mine.name), '')
    from public.my_groups() as mine
   where mine.name like '%#576G'
$$;
grant execute on function pg_temp.my_fixture_groups() to authenticated;

-- ==================== a Group Manager ====================
select pg_temp.test_login_leadership('57610000-0000-0000-0000-000000000001');
select is(pg_temp.my_fixture_groups(),
  'Auto #576G:member:f:t | Child #576G:manager:t:f | Grandchild #576G:manager:f:f | Parent #576G:manager:t:f',
  'Manager of Parent: the explicit rows, the inherited Grandchild (explicit = false), and Automatic Membership of Auto; the effective role on Child is manager, not the plain row');
select is((select cardinality(mine.path) from public.my_groups() as mine where mine.name = 'Grandchild #576G'), 3,
  'an inherited Group carries its full path, so a picker can nest it');
select is((select count(*) from public.my_groups() as mine where mine.name = 'AutoHigh #576G')::int, 0,
  'Automatic Membership above the caller''s live level is not membership');
select is((select count(*) from public.my_groups())::int, (select count(distinct mine.id) from public.my_groups() as mine)::int,
  'one row per Group, never one per relationship');
reset role;

-- ==================== an ordinary member ====================
select pg_temp.test_login_leadership('57610000-0000-0000-0000-000000000002');
select is(pg_temp.my_fixture_groups(),
  'Auto #576G:member:f:t | Child #576G:member:t:f',
  'ordinary membership stays on its own Group (ruling D2): not the parent, not the Child''s descendants');
select is((select count(*) from public.my_groups() as mine where mine.name = 'Gone #576G')::int, 0,
  'an archived Group the member cannot read is never offered, roster row or not');
reset role;
select is(private.group_role_of((select id from public.groups where name = 'Gone #576G'),
                                '57610000-0000-0000-0000-000000000002'), 'member',
  'the archived Group does carry a role for that member -- it is groups_read that keeps it out');

-- ==================== a Group Responsible ====================
select pg_temp.test_login_leadership('57610000-0000-0000-0000-000000000003');
select is(pg_temp.my_fixture_groups(),
  'Auto #576G:member:f:t | AutoHigh #576G:member:f:t | Child #576G:responsible:f:f | Grandchild #576G:responsible:f:f | Parent #576G:responsible:t:f',
  'Responsible of Parent: responsible on every descendant (explicit = false), Automatic Membership of both Groups a level-3 member reaches');
reset role;

-- ==================== nobody without live membership ====================
select set_config('request.jwt.claims',
  '{"sub":"57610000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.my_groups())::int, 0, 'a claimless session has no Groups');
select is((select count(*) from private.my_groups_impl())::int, 0, 'nor does the private body, called directly');
reset role;

update public.profiles set status = 'inactiv' where id = '57610000-0000-0000-0000-000000000001';
select pg_temp.test_login('57610000-0000-0000-0000-000000000001',
  '{"member_role":"voluntar","member_level":1,"dept_ids":[],"team_ids":[],"group_ids":[]}'::jsonb);
select is((select count(*) from public.my_groups())::int, 0,
  'an inactive Member with a stale claim has no Groups, roster rows untouched');
reset role;

select * from finish();
rollback;
