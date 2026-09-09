-- project_read_policies.test.sql — #272: project context is private to
-- active project members, with the ADR-0007 BC/Moderator global override.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(42);

create function pg_temp.login(uid uuid, member_role text, member_level int)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', uid,
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'member_role', member_role,
      'member_level', member_level,
      'dept_ids', '[]'::jsonb,
      'team_ids', '[]'::jsonb
    )
  )::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

insert into auth.users (id, email) values
  ('a7200000-0000-0000-0000-000000000001', 'project.read.lead@test.local'),
  ('a7200000-0000-0000-0000-000000000002', 'project.read.responsible@test.local'),
  ('a7200000-0000-0000-0000-000000000003', 'project.read.member@test.local'),
  ('a7200000-0000-0000-0000-000000000004', 'project.read.outsider@test.local'),
  ('a7200000-0000-0000-0000-000000000005', 'project.read.inactive@test.local'),
  ('a7200000-0000-0000-0000-000000000006', 'project.read.bc@test.local'),
  ('a7200000-0000-0000-0000-000000000007', 'project.read.moderator@test.local'),
  ('a7200000-0000-0000-0000-000000000008', 'project.read.bce@test.local'),
  ('a7200000-0000-0000-0000-000000000009', 'project.read.claimless@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('a7200000-0000-0000-0000-000000000001', 'Project Read Lead',
   'project.read.lead@test.local', 'voluntar', 'activ'),
  ('a7200000-0000-0000-0000-000000000002', 'Project Read Responsible',
   'project.read.responsible@test.local', 'responsabil', 'activ'),
  ('a7200000-0000-0000-0000-000000000003', 'Project Read Member',
   'project.read.member@test.local', 'voluntar', 'activ'),
  ('a7200000-0000-0000-0000-000000000004', 'Project Read Outsider',
   'project.read.outsider@test.local', 'voluntar', 'activ'),
  ('a7200000-0000-0000-0000-000000000005', 'Project Read Inactive',
   'project.read.inactive@test.local', 'bc', 'inactiv'),
  ('a7200000-0000-0000-0000-000000000006', 'Project Read BC',
   'project.read.bc@test.local', 'bc', 'activ'),
  ('a7200000-0000-0000-0000-000000000007', 'Project Read Moderator',
   'project.read.moderator@test.local', 'moderator', 'activ'),
  ('a7200000-0000-0000-0000-000000000008', 'Project Read BCE',
   'project.read.bce@test.local', 'bce', 'activ'),
  ('a7200000-0000-0000-0000-000000000009', 'Project Read Claimless',
   'project.read.claimless@test.local', 'voluntar', 'activ');

insert into public.projects (name, status, leader_id, created_by) values
  ('Project Read Active', 'active',
   'a7200000-0000-0000-0000-000000000001',
   'a7200000-0000-0000-0000-000000000006'),
  ('Project Read Archived', 'archived',
   'a7200000-0000-0000-0000-000000000001',
   'a7200000-0000-0000-0000-000000000006'),
  ('Project Read Hidden', 'active',
   'a7200000-0000-0000-0000-000000000008',
   'a7200000-0000-0000-0000-000000000006');

-- The manager-invariant trigger inserted each lead. Add a complete roster to
-- both projects owned by the primary lead, including historical inactive and
-- claimless rows so member reads cannot pass against a hollow fixture.
insert into public.project_members (project_id, member_id, project_role)
select project.id, membership.member_id, membership.project_role
  from public.projects as project
  cross join (values
    ('a7200000-0000-0000-0000-000000000002'::uuid, 'responsible'),
    ('a7200000-0000-0000-0000-000000000003'::uuid, 'member'),
    ('a7200000-0000-0000-0000-000000000005'::uuid, 'member'),
    ('a7200000-0000-0000-0000-000000000009'::uuid, 'member')
  ) as membership(member_id, project_role)
 where project.name in ('Project Read Active', 'Project Read Archived');

create temp table fx as
select
  max(id) filter (where name = 'Project Read Active') as active_project_id,
  max(id) filter (where name = 'Project Read Archived') as archived_project_id
from public.projects;
grant select on fx to authenticated;

-- ==================== Policy and grant shape ====================
select policies_are(
  'public', 'projects', array['projects_read'],
  'projects exposes exactly its one read policy'
);
select policies_are(
  'public', 'project_members', array['project_members_read'],
  'project_members exposes exactly its one read policy'
);
select is(
  (select cmd from pg_policies
    where schemaname = 'public' and tablename = 'projects'
      and policyname = 'projects_read'),
  'SELECT', 'projects_read applies only to SELECT'
);
select is(
  (select cmd from pg_policies
    where schemaname = 'public' and tablename = 'project_members'
      and policyname = 'project_members_read'),
  'SELECT', 'project_members_read applies only to SELECT'
);
select ok(has_table_privilege('authenticated', 'public.projects', 'select'),
  'authenticated has the explicit projects SELECT grant');
select ok(has_table_privilege('authenticated', 'public.project_members', 'select'),
  'authenticated has the explicit project_members SELECT grant');
select ok(not has_table_privilege('anon', 'public.projects', 'select'),
  'anon has no projects SELECT grant');
select ok(not has_table_privilege('anon', 'public.project_members', 'select'),
  'anon has no project_members SELECT grant');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public'
      and tablename in ('projects', 'project_members')
      and cmd <> 'SELECT'),
  0::bigint, 'this issue adds no direct mutation policy'
);

-- ==================== Project participants ====================
select pg_temp.login(
  'a7200000-0000-0000-0000-000000000001', 'voluntar', 1);
select is((select count(*) from public.projects), 2::bigint,
  'lead reads their active and archived projects only');
select is(
  (select array_agg(name order by name) from public.projects),
  array['Project Read Active', 'Project Read Archived']::text[],
  'lead does not read an unrelated project'
);
select is((select count(*) from public.project_members), 10::bigint,
  'lead reads the complete historical rosters of their projects');
select is(
  (select count(*) from public.project_members where project_role = 'responsible'),
  2::bigint, 'lead reads Responsible rows in both project rosters'
);
reset role;

select pg_temp.login(
  'a7200000-0000-0000-0000-000000000002', 'responsabil', 4);
select is((select count(*) from public.projects), 2::bigint,
  'Project Responsible reads both projects they belong to');
select is((select count(*) from public.project_members), 10::bigint,
  'Project Responsible reads each complete project roster');
reset role;

select pg_temp.login(
  'a7200000-0000-0000-0000-000000000003', 'voluntar', 1);
select is((select count(*) from public.projects), 2::bigint,
  'ordinary project member reads both projects they belong to');
select is((select count(*) from public.project_members), 10::bigint,
  'ordinary project member reads each complete project roster');
reset role;

select pg_temp.login(
  'a7200000-0000-0000-0000-000000000008', 'bce', 5);
select is((select count(*) from public.projects), 1::bigint,
  'BCE reads only the project where they are a member');
select is((select count(*) from public.project_members), 1::bigint,
  'BCE has no global project-roster override');
reset role;

-- ==================== Denied identities ====================
select pg_temp.login(
  'a7200000-0000-0000-0000-000000000004', 'voluntar', 1);
select is((select count(*) from public.projects), 0::bigint,
  'active outsider reads no project');
select is((select count(*) from public.project_members), 0::bigint,
  'active outsider reads no project membership');
reset role;

-- A demotion may leave an older JWT alive. Database role, not the stale
-- member_level claim, decides whether global read access still exists.
select pg_temp.login(
  'a7200000-0000-0000-0000-000000000004', 'bc', 6);
select is((select count(*) from public.projects), 0::bigint,
  'demoted outsider cannot use stale BC claims to read projects');
select is((select count(*) from public.project_members), 0::bigint,
  'demoted outsider cannot use stale BC claims to read rosters');
reset role;

select pg_temp.login(
  'a7200000-0000-0000-0000-000000000005', 'bc', 6);
select is((select count(*) from public.projects), 0::bigint,
  'inactive BC project member receives no project global override');
select is((select count(*) from public.project_members), 0::bigint,
  'inactive BC project member receives no roster global override');
reset role;

select set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'a7200000-0000-0000-0000-000000000009',
  'role', 'authenticated',
  'app_metadata', jsonb_build_object('provider', 'email')
)::text, true);
set local role authenticated;
select is(auth.uid(), 'a7200000-0000-0000-0000-000000000009'::uuid,
  'claimless fixture retains a real auth uid');
select is((select count(*) from public.projects), 0::bigint,
  'claimless project member reads no project');
select is((select count(*) from public.project_members), 0::bigint,
  'claimless project member reads no roster');
reset role;

select set_config('request.jwt.claims', '', true);
set local role authenticated;
select is((select count(*) from public.projects), 0::bigint,
  'authenticated session without a JWT reads no project');
select is((select count(*) from public.project_members), 0::bigint,
  'authenticated session without a JWT reads no roster');
reset role;

-- ==================== ADR-0007 global readers ====================
-- A recent promotion can leave a lower-level token alive briefly. Current
-- database role grants the new authority without trusting stale JWT level.
select pg_temp.login(
  'a7200000-0000-0000-0000-000000000006', 'voluntar', 1);
select is((select count(*) from public.projects), 3::bigint,
  'current BC reads every project despite stale lower JWT claims');
select is((select count(*) from public.project_members), 11::bigint,
  'current BC reads every roster despite stale lower JWT claims');
select is((select count(*) from public.projects where status = 'archived'), 1::bigint,
  'BC global read includes archived history');
reset role;

select pg_temp.login(
  'a7200000-0000-0000-0000-000000000007', 'moderator', 9);
select is((select count(*) from public.projects), 3::bigint,
  'Moderator reads every active and archived project');
select is((select count(*) from public.project_members), 11::bigint,
  'Moderator reads every project roster');
reset role;

-- No public read grant exists for anon, so PostgreSQL rejects the operation
-- before RLS instead of returning a misleading empty result.
set local role anon;
select throws_ok(
  $$ select count(*) from public.projects $$,
  '42501', null, 'anonymous caller cannot query projects');
select throws_ok(
  $$ select count(*) from public.project_members $$,
  '42501', null, 'anonymous caller cannot query project memberships');
reset role;

-- ==================== Mutation boundary stays closed ====================
select pg_temp.login('a7200000-0000-0000-0000-000000000006', 'bc', 6);
select throws_ok(
  $$ insert into public.projects (name, leader_id, created_by)
     values ('Forbidden Direct Project',
       'a7200000-0000-0000-0000-000000000001',
       'a7200000-0000-0000-0000-000000000006') $$,
  '42501', null, 'BC cannot bypass future create command with direct insert');
select throws_ok(
  format($$ insert into public.project_members
            (project_id, member_id, project_role)
          values (%s, 'a7200000-0000-0000-0000-000000000004', 'member') $$,
    (select active_project_id from fx)),
  '42501', null, 'BC cannot directly add project members');
select throws_ok(
  $$ update public.projects
        set name = 'Forbidden Direct Rename'
      where id = (select active_project_id from fx) $$,
  '42501', null,
  'BC cannot bypass lifecycle commands with a direct project update');
reset role;
select is(
  (select name from public.projects where id = (select active_project_id from fx)),
  'Project Read Active', 'direct BC project update changes no row');

select pg_temp.login('a7200000-0000-0000-0000-000000000006', 'bc', 6);
delete from public.project_members
 where project_id = (select active_project_id from fx)
   and member_id = 'a7200000-0000-0000-0000-000000000003';
reset role;
select is(
  (select count(*) from public.project_members
    where project_id = (select active_project_id from fx)
      and member_id = 'a7200000-0000-0000-0000-000000000003'),
  1::bigint, 'direct BC membership delete changes no row');

select * from finish();
rollback;
