-- project_authorization_helpers.test.sql — #271: one audited definition of
-- project membership and work-management authority.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(42);

-- Dynamic dispatch lets the complete behavioral matrix report ordinary test
-- failures during RED instead of aborting at parse time while the helpers do
-- not exist yet.
create function pg_temp.call_project_helper(helper_name text, project_id bigint)
returns boolean
language plpgsql
as $$
declare
  answer boolean;
begin
  execute format('select private.%I($1)', helper_name)
     into answer
    using project_id;
  return answer;
exception
  when undefined_function or invalid_schema_name or insufficient_privilege then
    return null;
end;
$$;


insert into auth.users (id, email) values
  ('a7100000-0000-0000-0000-000000000001', 'project.helper.lead@test.local'),
  ('a7100000-0000-0000-0000-000000000002', 'project.helper.responsible@test.local'),
  ('a7100000-0000-0000-0000-000000000003', 'project.helper.member@test.local'),
  ('a7100000-0000-0000-0000-000000000004', 'project.helper.outsider@test.local'),
  ('a7100000-0000-0000-0000-000000000005', 'project.helper.inactive@test.local'),
  ('a7100000-0000-0000-0000-000000000006', 'project.helper.bc@test.local'),
  ('a7100000-0000-0000-0000-000000000007', 'project.helper.moderator@test.local'),
  ('a7100000-0000-0000-0000-000000000008', 'project.helper.claimless@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('a7100000-0000-0000-0000-000000000001', 'Project Helper Lead',
   'project.helper.lead@test.local', 'voluntar', 'activ'),
  ('a7100000-0000-0000-0000-000000000002', 'Project Helper Responsible',
   'project.helper.responsible@test.local', 'responsabil', 'activ'),
  ('a7100000-0000-0000-0000-000000000003', 'Project Helper Member',
   'project.helper.member@test.local', 'voluntar', 'activ'),
  ('a7100000-0000-0000-0000-000000000004', 'Project Helper Outsider',
   'project.helper.outsider@test.local', 'voluntar', 'activ'),
  ('a7100000-0000-0000-0000-000000000005', 'Project Helper Inactive',
   'project.helper.inactive@test.local', 'voluntar', 'inactiv'),
  ('a7100000-0000-0000-0000-000000000006', 'Project Helper BC',
   'project.helper.bc@test.local', 'bc', 'activ'),
  ('a7100000-0000-0000-0000-000000000007', 'Project Helper Moderator',
   'project.helper.moderator@test.local', 'moderator', 'activ'),
  ('a7100000-0000-0000-0000-000000000008', 'Project Helper Claimless',
   'project.helper.claimless@test.local', 'voluntar', 'activ');

insert into public.projects (name, status, leader_id, created_by) values
  ('Project Helper Active', 'active',
   'a7100000-0000-0000-0000-000000000001',
   'a7100000-0000-0000-0000-000000000006'),
  ('Project Helper Archived', 'archived',
   'a7100000-0000-0000-0000-000000000001',
   'a7100000-0000-0000-0000-000000000006');

insert into public.project_members (project_id, member_id, project_role)
select project.id, membership.member_id, membership.project_role
  from public.projects as project
  cross join (values
    ('a7100000-0000-0000-0000-000000000002'::uuid, 'responsible'),
    ('a7100000-0000-0000-0000-000000000003'::uuid, 'member'),
    ('a7100000-0000-0000-0000-000000000005'::uuid, 'member'),
    ('a7100000-0000-0000-0000-000000000008'::uuid, 'member')
  ) as membership(member_id, project_role);

create temp table fx as
select
  max(id) filter (where name = 'Project Helper Active') as active_project_id,
  max(id) filter (where name = 'Project Helper Archived') as archived_project_id,
  999999999::bigint as missing_project_id
from public.projects;
grant select on fx to authenticated;

-- ==================== Definition and privileges ====================
select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in (
        'is_active_project_member',
        'is_project_lead',
        'is_project_responsible',
        'can_manage_project_work'
      )),
  4::bigint,
  'all four project authorization helpers exist in private'
);
select ok(
  coalesce((select bool_and(procedure.prosecdef)
              from pg_proc as procedure
              join pg_namespace as namespace on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'private'
               and procedure.proname in (
                 'is_active_project_member', 'is_project_lead',
                 'is_project_responsible', 'can_manage_project_work'
               )), false),
  'every project authorization helper runs as its owner'
);
select ok(
  coalesce((select bool_and(procedure.provolatile = 's')
              from pg_proc as procedure
              join pg_namespace as namespace on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'private'
               and procedure.proname in (
                 'is_active_project_member', 'is_project_lead',
                 'is_project_responsible', 'can_manage_project_work'
               )), false),
  'every project authorization helper is stable'
);
select ok(
  coalesce((select bool_and('search_path=""' = any(procedure.proconfig))
              from pg_proc as procedure
              join pg_namespace as namespace on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'private'
               and procedure.proname in (
                 'is_active_project_member', 'is_project_lead',
                 'is_project_responsible', 'can_manage_project_work'
               )), false),
  'every project authorization helper has an empty search_path'
);
select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in (
        'is_active_project_member', 'is_project_lead',
        'is_project_responsible', 'can_manage_project_work'
      )
      and has_function_privilege('authenticated', procedure.oid, 'execute')),
  4::bigint,
  'authenticated may execute exactly the four policy helpers'
);
select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in (
        'is_active_project_member', 'is_project_lead',
        'is_project_responsible', 'can_manage_project_work'
      )
      and has_function_privilege('anon', procedure.oid, 'execute')),
  0::bigint,
  'anon cannot execute project authorization helpers'
);
select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in (
        'is_active_project_member', 'is_project_lead',
        'is_project_responsible', 'can_manage_project_work'
      )
      and has_function_privilege('service_role', procedure.oid, 'execute')),
  0::bigint,
  'service_role does not receive a redundant direct helper API'
);
select ok(has_schema_privilege('authenticated', 'private', 'usage'),
  'authenticated can resolve private helpers used by policies');
select ok(not has_schema_privilege('anon', 'private', 'usage'),
  'anon cannot resolve the private schema');
select ok(
  not has_function_privilege(
    'authenticated', 'private.validate_project_manager_state()', 'execute'),
  'granting helper access does not expose private trigger functions'
);

-- ==================== Active project relationships ====================
select pg_temp.test_login('a7100000-0000-0000-0000-000000000001', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(pg_temp.call_project_helper(
    'is_active_project_member', (select active_project_id from fx)), true,
  'lead: is an active project member');
select is(pg_temp.call_project_helper(
    'is_project_lead', (select active_project_id from fx)), true,
  'lead: lead helper is true');
select is(pg_temp.call_project_helper(
    'is_project_responsible', (select active_project_id from fx)), false,
  'lead: Responsible helper is false without that project role');
select is(pg_temp.call_project_helper(
    'can_manage_project_work', (select active_project_id from fx)), true,
  'lead: may manage work in an active project');
reset role;

select pg_temp.test_login('a7100000-0000-0000-0000-000000000002', jsonb_build_object(
    'member_role', 'responsabil', 'member_level', 4,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(pg_temp.call_project_helper(
    'is_active_project_member', (select active_project_id from fx)), true,
  'Responsible: is an active project member');
select is(pg_temp.call_project_helper(
    'is_project_lead', (select active_project_id from fx)), false,
  'Responsible: lead helper is false');
select is(pg_temp.call_project_helper(
    'is_project_responsible', (select active_project_id from fx)), true,
  'Responsible: project-role helper is true');
select is(pg_temp.call_project_helper(
    'can_manage_project_work', (select active_project_id from fx)), true,
  'Responsible: may manage work in an active project');
reset role;

select pg_temp.test_login('a7100000-0000-0000-0000-000000000003', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(pg_temp.call_project_helper(
    'is_active_project_member', (select active_project_id from fx)), true,
  'ordinary member: active membership helper is true');
select is(pg_temp.call_project_helper(
    'can_manage_project_work', (select active_project_id from fx)), false,
  'ordinary member: cannot manage project work');
reset role;

select pg_temp.test_login('a7100000-0000-0000-0000-000000000004', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(pg_temp.call_project_helper(
    'is_active_project_member', (select active_project_id from fx)), false,
  'outsider: is not a project member');
select is(pg_temp.call_project_helper(
    'is_project_lead', (select active_project_id from fx)), false,
  'outsider: is not the project lead');
select is(pg_temp.call_project_helper(
    'is_project_responsible', (select active_project_id from fx)), false,
  'outsider: is not a project Responsible');
select is(pg_temp.call_project_helper(
    'can_manage_project_work', (select active_project_id from fx)), false,
  'outsider: cannot manage project work');
reset role;

-- A recent demotion can leave an older JWT alive briefly. Global project
-- override follows the current profile role, not that stale level claim.
select pg_temp.test_login('a7100000-0000-0000-0000-000000000004', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(pg_temp.call_project_helper(
    'can_manage_project_work', (select active_project_id from fx)), false,
  'demoted outsider: stale elevated claims do not grant global override');
reset role;

-- A stale JWT still says this person is a member. Current database status is
-- authoritative for project access, so every answer must fail closed.
select pg_temp.test_login('a7100000-0000-0000-0000-000000000005', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(pg_temp.call_project_helper(
    'is_active_project_member', (select active_project_id from fx)), false,
  'inactive member: stale org claims do not preserve membership access');
select is(pg_temp.call_project_helper(
    'can_manage_project_work', (select active_project_id from fx)), false,
  'inactive member: stale org claims do not grant work management');
reset role;

-- This user has an active profile and membership row, but no organisation
-- metadata in the JWT. A bare auth.uid() must never be enough.
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', 'a7100000-0000-0000-0000-000000000008',
  'role', 'authenticated',
  'app_metadata', jsonb_build_object('provider', 'email')
)::text, true);
set local role authenticated;
select is(pg_temp.call_project_helper(
    'is_active_project_member', (select active_project_id from fx)), false,
  'claimless member row: no organisation claims means no project access');
select is(pg_temp.call_project_helper(
    'can_manage_project_work', (select active_project_id from fx)), false,
  'claimless member row: no organisation claims means no management access');
reset role;

select pg_temp.test_login('a7100000-0000-0000-0000-000000000006', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(pg_temp.call_project_helper(
    'is_active_project_member', (select active_project_id from fx)), false,
  'BC outsider: global authority does not invent project membership');
select is(pg_temp.call_project_helper(
    'can_manage_project_work', (select active_project_id from fx)), true,
  'BC outsider: receives the documented active-project override');
reset role;

select pg_temp.test_login('a7100000-0000-0000-0000-000000000007', jsonb_build_object(
    'member_role', 'moderator', 'member_level', 9,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(pg_temp.call_project_helper(
    'can_manage_project_work', (select active_project_id from fx)), true,
  'Moderator outsider: receives the documented active-project override');
reset role;

-- ==================== Archived and missing projects ====================
select pg_temp.test_login('a7100000-0000-0000-0000-000000000001', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(pg_temp.call_project_helper(
    'is_active_project_member', (select archived_project_id from fx)), true,
  'archived project: active people retain historical membership identity');
select is(pg_temp.call_project_helper(
    'is_project_lead', (select archived_project_id from fx)), true,
  'archived project: lead identity remains queryable');
select is(pg_temp.call_project_helper(
    'can_manage_project_work', (select archived_project_id from fx)), false,
  'archived project: its lead cannot manage new work');
select is(pg_temp.call_project_helper(
    'is_active_project_member', (select missing_project_id from fx)), false,
  'missing project: membership fails closed');
select is(pg_temp.call_project_helper(
    'can_manage_project_work', (select missing_project_id from fx)), false,
  'missing project: management fails closed');
reset role;

select pg_temp.test_login('a7100000-0000-0000-0000-000000000002', jsonb_build_object(
    'member_role', 'responsabil', 'member_level', 4,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(pg_temp.call_project_helper(
    'is_project_responsible', (select archived_project_id from fx)), true,
  'archived project: Responsible identity remains queryable');
select is(pg_temp.call_project_helper(
    'can_manage_project_work', (select archived_project_id from fx)), false,
  'archived project: a Responsible cannot manage new work');
reset role;

select pg_temp.test_login('a7100000-0000-0000-0000-000000000006', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(pg_temp.call_project_helper(
    'can_manage_project_work', (select archived_project_id from fx)), false,
  'archived project: global BC override cannot create new work');
reset role;

select pg_temp.test_clear_jwt();
set local role authenticated;
select is(pg_temp.call_project_helper(
    'is_active_project_member', (select active_project_id from fx)), false,
  'no JWT: project membership fails closed');
select is(pg_temp.call_project_helper(
    'can_manage_project_work', (select active_project_id from fx)), false,
  'no JWT: project management fails closed');
reset role;

select * from finish();
rollback;
