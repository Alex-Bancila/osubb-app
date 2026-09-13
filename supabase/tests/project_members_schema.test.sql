-- project_members_schema.test.sql — #269: project membership foundation.
-- Runs in one transaction and rolls back, leaving the demo seed untouched.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(30);

select has_table(
  'public',
  'project_members',
  'project_members table exists'
);

select ok(
  (
    select relrowsecurity
      from pg_class
     where relname = 'project_members'
       and relnamespace = 'public'::regnamespace
  ),
  'project_members enables RLS at birth'
);

select col_type_is(
  'public', 'project_members', 'project_id', 'bigint',
  'project membership references a bigint project'
);
select col_not_null(
  'public', 'project_members', 'project_id',
  'project is required'
);
select col_type_is(
  'public', 'project_members', 'member_id', 'uuid',
  'project membership references a UUID profile'
);
select col_not_null(
  'public', 'project_members', 'member_id',
  'member is required'
);
select col_type_is(
  'public', 'project_members', 'project_role', 'text',
  'project role is stored as constrained text'
);
select col_not_null(
  'public', 'project_members', 'project_role',
  'project role is required'
);
select col_type_is(
  'public', 'project_members', 'created_at', 'timestamp with time zone',
  'project membership records an exact creation instant'
);
select col_not_null(
  'public', 'project_members', 'created_at',
  'project membership creation time is required'
);
select col_has_default(
  'public', 'project_members', 'created_at',
  'project membership creation time is server-written'
);

select has_pk(
  'public', 'project_members',
  'project membership has a primary key'
);
select fk_ok(
  'public', 'project_members', 'project_id',
  'public', 'projects', 'id',
  'project memberships reference projects'
);
select fk_ok(
  'public', 'project_members', 'member_id',
  'public', 'profiles', 'id',
  'project memberships reference profiles'
);

select has_index(
  'public', 'project_members', 'project_members_pkey',
  'the primary key supports project roster lookups'
);
select has_index(
  'public', 'project_members', 'project_members_member_idx',
  'memberships can be found efficiently by member'
);

-- Data-integrity fixtures use the table owner so RLS cannot make a constraint
-- test pass for the wrong reason by hiding its target rows.
insert into auth.users (id, email) values
  ('a6900000-0000-0000-0000-000000000001', 'project.member@test.local'),
  ('a6900000-0000-0000-0000-000000000002', 'project.responsible@test.local'),
  ('a6900000-0000-0000-0000-000000000003', 'project.invalid-role@test.local'),
  ('a6900000-0000-0000-0000-000000000004', 'project.lead@test.local');
insert into public.profiles (id, full_name, email, role) values
  ('a6900000-0000-0000-0000-000000000001', 'Project Member', 'project.member@test.local', 'voluntar'),
  ('a6900000-0000-0000-0000-000000000002', 'Project Responsible', 'project.responsible@test.local', 'responsabil'),
  ('a6900000-0000-0000-0000-000000000003', 'Invalid Project Role', 'project.invalid-role@test.local', 'voluntar'),
  ('a6900000-0000-0000-0000-000000000004', 'Project Lead', 'project.lead@test.local', 'responsabil');

insert into public.projects (id, name, leader_id, created_by)
overriding system value
values (
  690001,
  'Project membership fixture',
  'a6900000-0000-0000-0000-000000000004',
  'a6900000-0000-0000-0000-000000000002'
);

select lives_ok(
  $$ insert into public.project_members (project_id, member_id, project_role)
     values (690001,
             'a6900000-0000-0000-0000-000000000001',
             'member') $$,
  'member is a valid project role'
);
select lives_ok(
  $$ insert into public.project_members (project_id, member_id, project_role)
     values (690001,
             'a6900000-0000-0000-0000-000000000002',
             'responsible') $$,
  'responsible is a valid project role'
);
select is(
  (
    select count(*)
      from public.project_members pm
     where pm.project_id = 690001
       and pm.member_id in (
         'a6900000-0000-0000-0000-000000000001',
         'a6900000-0000-0000-0000-000000000002'
       )
  ),
  2::bigint,
  'both approved project roles are stored'
);

select throws_ok(
  $$ insert into public.project_members (project_id, member_id, project_role)
     values (690001,
             'a6900000-0000-0000-0000-000000000003',
             'leader') $$,
  '23514', null,
  'unapproved project roles are rejected'
);
select throws_ok(
  $$ insert into public.project_members (project_id, member_id, project_role)
     values (690001,
             'a6900000-0000-0000-0000-000000000001',
             'responsible') $$,
  '23505', null,
  'a member appears at most once in one project'
);
select throws_ok(
  $$ insert into public.project_members (project_id, member_id, project_role)
     values (9223372036854775807,
             'a6900000-0000-0000-0000-000000000001',
             'member') $$,
  '23503', null,
  'a membership cannot reference an unknown project'
);
select throws_ok(
  $$ insert into public.project_members (project_id, member_id, project_role)
     values (690001,
             'a6900000-0000-0000-0000-000000000099',
             'member') $$,
  '23503', null,
  'a membership cannot reference an unknown profile'
);

select policies_are(
  'public', 'project_members', array['project_members_read'],
  'project memberships expose only the read policy added by #272'
);
select ok(
  not has_table_privilege('anon', 'public.project_members', 'select'),
  'anon receives no project-membership privilege'
);
select ok(
  has_table_privilege('authenticated', 'public.project_members', 'select'),
  'authenticated receives the table privilege required by its read policy'
);
select ok(
  not has_table_privilege('authenticated', 'public.project_members', 'truncate'),
  'authenticated cannot bypass RLS with truncate'
);
select ok(
  has_table_privilege('service_role', 'public.project_members', 'select,insert,update,delete'),
  'service_role receives the narrow DML privileges needed by admin flows'
);

-- A real auth user without organization metadata models a deactivated or
-- no-profile session. The owned fixture makes this denial non-vacuous.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'a6900000-0000-0000-0000-000000000003',
    'role', 'authenticated',
    'app_metadata', '{}'::jsonb
  )::text,
  true
);
set local role authenticated;

select is(
  (select count(*) from public.project_members),
  0::bigint,
  'a real user without organization claims reads no project memberships'
);
select throws_ok(
  $$ insert into public.project_members (project_id, member_id, project_role)
     values (690001,
             'a6900000-0000-0000-0000-000000000003',
             'member') $$,
  '42501', null,
  'a real user without organization claims cannot create a membership'
);

reset role;

select * from finish();
rollback;
