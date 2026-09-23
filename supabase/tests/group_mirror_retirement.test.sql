-- #586: legacy rows cannot write Groups and every roster row meets Minimum Level.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(9);

select is((select count(*) from pg_trigger where not tgisinternal
  and tgname in ('departments_mirror_group','teams_mirror_group',
    'projects_mirror_group','member_departments_mirror_membership',
    'team_members_mirror_membership','project_members_mirror_membership',
    'profiles_rederive_group_roles')),
  0::bigint, 'all seven forward-mirror triggers are gone');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname in
    ('mirror_department_group','mirror_team_group','mirror_project_group',
     'mirror_department_membership','mirror_team_membership',
     'mirror_project_membership','rederive_department_group_roles',
     'sync_groups_from_legacy','sync_department_groups','sync_team_groups',
     'sync_project_groups','sync_department_memberships',
     'sync_team_memberships','sync_project_memberships')),
  0::bigint, 'all fourteen forward-mirror functions are gone');

insert into auth.users(id,email)
values ('58600000-0000-0000-0000-000000000001','member.586@test.local'),
       ('58600000-0000-0000-0000-000000000002','bc.586@test.local');
insert into public.profiles(id,full_name,email,role,status)
values ('58600000-0000-0000-0000-000000000001','Member 586','member.586@test.local','voluntar','activ'),
       ('58600000-0000-0000-0000-000000000002','BC 586','bc.586@test.local','bc','activ');
select is((select count(*) from public.group_members gm
  join public.groups g on g.id=gm.group_id
  join public.profiles p on p.id=gm.member_id
  join public.roles r on r.id=p.role
  where r.level < g.min_level),
  0::bigint, 'after seed, no Group roster row is below Minimum Level');

insert into public.groups(name,category,min_level)
values ('Minimum Level 586','project',3);
select throws_ok($$
  insert into public.group_members(group_id,member_id,group_role)
  select id,'58600000-0000-0000-0000-000000000001','member'
  from public.groups where name='Minimum Level 586'
$$, '23514','group_member_below_min_level',
  'the roster trigger rejects an ordinary member below Minimum Level');
select throws_ok($$
  insert into public.group_members(group_id,member_id,group_role)
  select id,'58600000-0000-0000-0000-000000000001','manager'
  from public.groups where name='Minimum Level 586'
$$, '23514','group_member_below_min_level',
  'the same trigger rejects a Manager below Minimum Level');
select throws_ok($$
  insert into public.group_members(group_id,member_id,group_role,position_title)
  select id,'58600000-0000-0000-0000-000000000001','responsible','Responsabil 586'
  from public.groups where name='Minimum Level 586'
$$, '23514','group_member_below_min_level',
  'the same trigger rejects a Responsible below Minimum Level');

select pg_temp.test_login_leadership('58600000-0000-0000-0000-000000000002');
select public.set_member_role('58600000-0000-0000-0000-000000000001','bce');
reset role;
select is((select count(*) from public.group_members gm
  join public.groups g on g.id=gm.group_id
  where g.name = 'Educațional'
    and gm.member_id='58600000-0000-0000-0000-000000000001'),
  0::bigint, 'promotion to BCE does not derive a Department Group Manager');

select pg_temp.test_login_leadership('58600000-0000-0000-0000-000000000002');
select public.set_group_role((select id from public.groups where name = 'Educațional'),
  '58600000-0000-0000-0000-000000000001','manager');
select public.set_member_role('58600000-0000-0000-0000-000000000001','voluntar');
reset role;
select is((select gm.group_role from public.group_members gm
  join public.groups g on g.id=gm.group_id
  where g.name = 'Educațional'
    and gm.member_id='58600000-0000-0000-0000-000000000001'),
  'manager', 'demotion does not remove a separately appointed Group Manager');
select is((select count(*) from public.group_members gm
  join public.groups g on g.id=gm.group_id
  join public.profiles p on p.id=gm.member_id
  join public.roles r on r.id=p.role
  where r.level < g.min_level),
  0::bigint, 'the total Minimum Level invariant remains true after role changes');

select * from finish();
rollback;
