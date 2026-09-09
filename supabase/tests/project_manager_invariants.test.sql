-- project_manager_invariants.test.sql — #270: project leaders and
-- Responsibles remain valid project members.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(23);

insert into auth.users (id, email) values
  ('a7000000-0000-0000-0000-000000000001', 'project.invariant.lead@test.local'),
  ('a7000000-0000-0000-0000-000000000002', 'project.invariant.creator@test.local'),
  ('a7000000-0000-0000-0000-000000000003', 'project.invariant.next-lead@test.local'),
  ('a7000000-0000-0000-0000-000000000004', 'project.invariant.inactive@test.local'),
  ('a7000000-0000-0000-0000-000000000005', 'project.invariant.responsible@test.local'),
  ('a7000000-0000-0000-0000-000000000006', 'project.invariant.member@test.local'),
  ('a7000000-0000-0000-0000-000000000007', 'project.invariant.inactive-candidate@test.local'),
  ('a7000000-0000-0000-0000-000000000008', 'project.invariant.replacement@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('a7000000-0000-0000-0000-000000000001', 'Invariant Lead',
   'project.invariant.lead@test.local', 'voluntar', 'activ'),
  ('a7000000-0000-0000-0000-000000000002', 'Invariant Creator',
   'project.invariant.creator@test.local', 'bc', 'activ'),
  ('a7000000-0000-0000-0000-000000000003', 'Invariant Next Lead',
   'project.invariant.next-lead@test.local', 'responsabil', 'activ'),
  ('a7000000-0000-0000-0000-000000000004', 'Invariant Inactive',
   'project.invariant.inactive@test.local', 'voluntar', 'inactiv'),
  ('a7000000-0000-0000-0000-000000000005', 'Invariant Responsible',
   'project.invariant.responsible@test.local', 'responsabil', 'activ'),
  ('a7000000-0000-0000-0000-000000000006', 'Invariant Member',
   'project.invariant.member@test.local', 'voluntar', 'activ'),
  ('a7000000-0000-0000-0000-000000000007', 'Invariant Inactive Candidate',
   'project.invariant.inactive-candidate@test.local', 'responsabil', 'inactiv'),
  ('a7000000-0000-0000-0000-000000000008', 'Invariant Replacement',
   'project.invariant.replacement@test.local', 'responsabil', 'activ');

insert into public.projects (name, leader_id, created_by)
values (
  'Invariant Project',
  'a7000000-0000-0000-0000-000000000001',
  'a7000000-0000-0000-0000-000000000002'
);

select is(
  (
    select count(*)
      from public.project_members pm
      join public.projects p on p.id = pm.project_id
     where p.name = 'Invariant Project'
       and pm.member_id = 'a7000000-0000-0000-0000-000000000001'
       and pm.project_role = 'member'
  ),
  1::bigint,
  'creating an active project establishes its leader membership'
);

select throws_ok(
  $$ insert into public.projects (name, leader_id, created_by)
     values ('Invalid inactive lead',
             'a7000000-0000-0000-0000-000000000004',
             'a7000000-0000-0000-0000-000000000002') $$,
  '23514', null,
  'an inactive profile cannot lead an active project'
);

insert into public.project_members (project_id, member_id, project_role)
select id, 'a7000000-0000-0000-0000-000000000003', 'responsible'
  from public.projects
 where name = 'Invariant Project';

select lives_ok(
  $$ update public.projects
        set leader_id = 'a7000000-0000-0000-0000-000000000003'
      where name = 'Invariant Project' $$,
  'an active project can move to another active leader'
);

select is(
  (
    select pm.project_role
      from public.project_members pm
      join public.projects p on p.id = pm.project_id
     where p.name = 'Invariant Project'
       and pm.member_id = 'a7000000-0000-0000-0000-000000000003'
  ),
  'responsible',
  'making a Responsible the leader preserves their project role'
);

select is(
  (
    select count(*)
      from public.project_members pm
      join public.projects p on p.id = pm.project_id
     where p.name = 'Invariant Project'
       and pm.member_id = 'a7000000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'changing leader preserves the former leader as a project member'
);

select is(
  (
    select count(*)
      from public.project_members pm
      join public.projects p on p.id = pm.project_id
     where p.name = 'Invariant Project'
       and pm.member_id = 'a7000000-0000-0000-0000-000000000003'
  ),
  1::bigint,
  'changing leader does not duplicate an existing membership'
);

insert into public.project_members (project_id, member_id, project_role)
select id, 'a7000000-0000-0000-0000-000000000004', 'member'
  from public.projects
 where name = 'Invariant Project';

select throws_ok(
  $$ update public.project_members
        set project_role = 'responsible'
      where member_id = 'a7000000-0000-0000-0000-000000000004'
        and project_id = (select id from public.projects where name = 'Invariant Project') $$,
  '23514', null,
  'an inactive project member cannot become a Responsible on an active project'
);

-- Restore the fixture when running against the intentionally incomplete RED
-- implementation, where the update above succeeds instead of throwing.
update public.project_members
   set project_role = 'member'
 where member_id = 'a7000000-0000-0000-0000-000000000004'
   and project_id = (select id from public.projects where name = 'Invariant Project');

select lives_ok(
  $$ insert into public.project_members (project_id, member_id, project_role)
     select id,
            'a7000000-0000-0000-0000-000000000005',
            'responsible'
       from public.projects
      where name = 'Invariant Project' $$,
  'an active member can become a project Responsible'
);

insert into public.project_members (project_id, member_id, project_role)
select id, 'a7000000-0000-0000-0000-000000000006', 'member'
  from public.projects
 where name = 'Invariant Project';

select throws_ok(
  $$ delete from public.project_members
      where member_id = 'a7000000-0000-0000-0000-000000000003'
        and project_id = (select id from public.projects where name = 'Invariant Project') $$,
  '23514', null,
  'the current project leader membership cannot be removed'
);

insert into public.project_members (project_id, member_id, project_role)
select id, 'a7000000-0000-0000-0000-000000000003', 'responsible'
  from public.projects
 where name = 'Invariant Project'
on conflict (project_id, member_id) do nothing;

select throws_ok(
  $$ update public.profiles
        set status = 'inactiv'
      where id = 'a7000000-0000-0000-0000-000000000003' $$,
  '23514', null,
  'the leader of an active project cannot be deactivated'
);
update public.profiles set status = 'activ'
 where id = 'a7000000-0000-0000-0000-000000000003';

select throws_ok(
  $$ update public.profiles
        set status = 'inactiv'
      where id = 'a7000000-0000-0000-0000-000000000005' $$,
  '23514', null,
  'a Responsible on an active project cannot be deactivated'
);
update public.profiles set status = 'activ'
 where id = 'a7000000-0000-0000-0000-000000000005';

select lives_ok(
  $$ update public.profiles
        set status = 'inactiv'
      where id = 'a7000000-0000-0000-0000-000000000006' $$,
  'an ordinary project member can be deactivated'
);

select lives_ok(
  $$ update public.projects
        set status = 'archived'
      where name = 'Invariant Project' $$,
  'an active project can be archived without changing its roster'
);

select is(
  (
    select count(*)
      from public.project_members pm
      join public.projects p on p.id = pm.project_id
     where p.name = 'Invariant Project'
  ),
  5::bigint,
  'archiving preserves every project membership'
);

select throws_ok(
  $$ update public.projects
        set leader_id = 'a7000000-0000-0000-0000-000000000007'
      where name = 'Invariant Project' $$,
  '23514', null,
  'an archived project cannot be assigned an inactive leader'
);
-- Restore the fixture when running against the intentionally incomplete RED
-- implementation, where the reassignment above succeeds instead of throwing.
update public.projects
   set leader_id = 'a7000000-0000-0000-0000-000000000003'
 where name = 'Invariant Project';
delete from public.project_members
 where member_id = 'a7000000-0000-0000-0000-000000000007'
   and project_id = (select id from public.projects where name = 'Invariant Project');

select lives_ok(
  $$ update public.profiles
        set status = 'inactiv'
      where id = 'a7000000-0000-0000-0000-000000000003' $$,
  'an archived project no longer blocks deactivating its leader'
);

select lives_ok(
  $$ update public.profiles
        set status = 'inactiv'
      where id = 'a7000000-0000-0000-0000-000000000005' $$,
  'an archived project no longer blocks deactivating a Responsible'
);

select throws_ok(
  $$ update public.projects
        set status = 'active'
      where name = 'Invariant Project' $$,
  '23514', null,
  'an archived project cannot reactivate with an inactive leader'
);
update public.projects set status = 'archived' where name = 'Invariant Project';

update public.profiles set status = 'activ'
 where id = 'a7000000-0000-0000-0000-000000000003';

select throws_ok(
  $$ update public.projects
        set status = 'active'
      where name = 'Invariant Project' $$,
  '23514', null,
  'an archived project cannot reactivate with an inactive Responsible'
);
update public.projects set status = 'archived' where name = 'Invariant Project';

update public.profiles set status = 'activ'
 where id = 'a7000000-0000-0000-0000-000000000005';

select lives_ok(
  $$ update public.projects
        set status = 'active'
      where name = 'Invariant Project' $$,
  'an archived project can reactivate after every manager is active'
);

select is(
  (select status from public.projects where name = 'Invariant Project'),
  'active',
  'successful reactivation stores the active project state'
);

select throws_ok(
  $$ insert into public.project_members (project_id, member_id, project_role)
     select id,
            'a7000000-0000-0000-0000-000000000007',
            'responsible'
       from public.projects
      where name = 'Invariant Project' $$,
  '23514', null,
  'an inactive profile cannot be inserted as an active project Responsible'
);
delete from public.project_members
 where member_id = 'a7000000-0000-0000-0000-000000000007';

select throws_ok(
  $$ update public.project_members
        set member_id = 'a7000000-0000-0000-0000-000000000008'
      where member_id = 'a7000000-0000-0000-0000-000000000003'
        and project_id = (select id from public.projects where name = 'Invariant Project') $$,
  '23514', null,
  'the current leader membership cannot be reassigned to another profile'
);
update public.project_members
   set member_id = 'a7000000-0000-0000-0000-000000000003'
 where member_id = 'a7000000-0000-0000-0000-000000000008'
   and project_id = (select id from public.projects where name = 'Invariant Project');

select * from finish();
rollback;
