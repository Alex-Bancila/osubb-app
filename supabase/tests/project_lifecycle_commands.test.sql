-- project_lifecycle_commands.test.sql — #273: BC/Moderator-only project lifecycle commands.
-- Runs in one transaction and rolls back, leaving no local residue.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(54);


-- Keep result assertions runnable during RED while archive_project does not
-- exist yet. Returning NULL produces an ordinary pgTAP failure instead of a
-- parse error that aborts the rest of the contract.
create function pg_temp.archive_status(project_id bigint)
returns text
language plpgsql
as $$
declare
  archived_status text;
begin
  execute 'select (public.archive_project($1)).status::text'
     into archived_status
    using project_id;
  return archived_status;
exception
  when undefined_function or insufficient_privilege then
    return null;
end;
$$;

insert into auth.users (id, email) values
  ('a7300000-0000-0000-0000-000000000001', 'project.lifecycle.leader@test.local'),
  ('a7300000-0000-0000-0000-000000000002', 'project.lifecycle.bc@test.local'),
  ('a7300000-0000-0000-0000-000000000003', 'project.lifecycle.moderator@test.local'),
  ('a7300000-0000-0000-0000-000000000004', 'project.lifecycle.bce@test.local'),
  ('a7300000-0000-0000-0000-000000000005', 'project.lifecycle.responsabil@test.local'),
  ('a7300000-0000-0000-0000-000000000006', 'project.lifecycle.inactive-bc@test.local'),
  ('a7300000-0000-0000-0000-000000000007', 'project.lifecycle.claimless@test.local'),
  ('a7300000-0000-0000-0000-000000000008', 'project.lifecycle.inactive-leader@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('a7300000-0000-0000-0000-000000000001', 'Lifecycle Leader',
   'project.lifecycle.leader@test.local', 'voluntar', 'activ'),
  ('a7300000-0000-0000-0000-000000000002', 'Lifecycle BC',
   'project.lifecycle.bc@test.local', 'bc', 'activ'),
  ('a7300000-0000-0000-0000-000000000003', 'Lifecycle Moderator',
   'project.lifecycle.moderator@test.local', 'moderator', 'activ'),
  ('a7300000-0000-0000-0000-000000000004', 'Lifecycle BCE',
   'project.lifecycle.bce@test.local', 'bce', 'activ'),
  ('a7300000-0000-0000-0000-000000000005', 'Lifecycle Responsabil',
   'project.lifecycle.responsabil@test.local', 'responsabil', 'activ'),
  ('a7300000-0000-0000-0000-000000000006', 'Lifecycle Inactive BC',
   'project.lifecycle.inactive-bc@test.local', 'bc', 'inactiv'),
  ('a7300000-0000-0000-0000-000000000007', 'Lifecycle Claimless BC',
   'project.lifecycle.claimless@test.local', 'bc', 'activ'),
  ('a7300000-0000-0000-0000-000000000008', 'Lifecycle Inactive Leader',
   'project.lifecycle.inactive-leader@test.local', 'voluntar', 'inactiv');

insert into public.projects (
  name, leader_id, created_by, created_at, updated_at
) values
  (
    'Lifecycle Existing',
    'a7300000-0000-0000-0000-000000000001',
    'a7300000-0000-0000-0000-000000000002',
    '2020-01-01 00:00:00+00',
    '2020-01-01 00:00:00+00'
  ),
  (
    'Lifecycle Protected Active',
    'a7300000-0000-0000-0000-000000000001',
    'a7300000-0000-0000-0000-000000000002',
    default,
    default
  );

create temp table fx as
select
  max(id) filter (where name = 'Lifecycle Existing') as existing_project_id,
  max(id) filter (where name = 'Lifecycle Protected Active') as protected_project_id
from public.projects;
grant select on fx to authenticated;

create temp table before_archive as
select project.updated_at
  from public.projects as project
 where project.id = (select existing_project_id from fx);

-- Interface shape. Dynamic catalog checks make the pre-migration RED run
-- report failures instead of aborting on a missing regprocedure cast.
select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname = 'create_project'
     and pg_get_function_identity_arguments(procedure.oid) = 'p_name text, p_leader_id uuid'
     and procedure.prorettype = 'public.projects'::regtype
), 1::bigint, 'create_project exposes the exact planned signature and row return');

select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname = 'archive_project'
     and pg_get_function_identity_arguments(procedure.oid) = 'p_project_id bigint'
     and procedure.prorettype = 'public.projects'::regtype
), 1::bigint, 'archive_project exposes the exact planned signature and row return');

select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname in ('create_project', 'archive_project')
     and not procedure.prosecdef
     and 'search_path=""' = any(procedure.proconfig)
), 2::bigint, 'both public wrappers are SECURITY INVOKER with empty search_path');

select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private'
     and procedure.proname in ('create_project_impl', 'archive_project_impl')
     and procedure.prosecdef
     and 'search_path=""' = any(procedure.proconfig)
), 2::bigint, 'privileged implementations live in private as hardened SECURITY DEFINER functions');

select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private'
     and procedure.proname = 'require_project_admin'
     and procedure.prosecdef
     and 'search_path=""' = any(procedure.proconfig)
), 1::bigint, 'the private authorization helper is hardened and non-public');

select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname in ('create_project', 'archive_project')
     and has_function_privilege('authenticated', procedure.oid, 'execute')
), 2::bigint, 'authenticated can execute both public lifecycle commands');

select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname in ('create_project', 'archive_project')
     and has_function_privilege('anon', procedure.oid, 'execute')
), 0::bigint, 'anon cannot execute lifecycle commands');

select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname in ('create_project', 'archive_project')
     and has_function_privilege('public', procedure.oid, 'execute')
), 0::bigint, 'PUBLIC cannot execute lifecycle commands');

select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private'
     and procedure.proname in (
       'require_project_admin', 'create_project_impl', 'archive_project_impl'
     )
     and has_function_privilege('anon', procedure.oid, 'execute')
), 0::bigint, 'anon cannot execute private lifecycle functions');

select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private'
     and procedure.proname = 'require_project_admin'
     and has_function_privilege('authenticated', procedure.oid, 'execute')
), 0::bigint, 'authenticated cannot call the private authorization helper directly');

select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private'
     and procedure.proname in ('create_project_impl', 'archive_project_impl')
     and has_function_privilege('authenticated', procedure.oid, 'execute')
), 2::bigint, 'authenticated can reach only the private implementations used by wrappers');

select ok(not has_table_privilege('authenticated', 'public.projects', 'insert'),
  'authenticated has no direct project INSERT privilege');
select ok(not has_table_privilege('authenticated', 'public.projects', 'update'),
  'authenticated has no direct project UPDATE privilege');
select ok(not has_table_privilege('authenticated', 'public.projects', 'delete'),
  'authenticated has no direct project DELETE privilege');
select ok(not has_sequence_privilege(
  'authenticated', 'public.projects_id_seq', 'usage'),
  'authenticated has no project identity-sequence USAGE privilege');
select ok(not has_sequence_privilege(
  'authenticated', 'public.projects_id_seq', 'select'),
  'authenticated has no project identity-sequence SELECT privilege');

-- A current BC succeeds even when their token still contains lower role data.
select pg_temp.test_login('a7300000-0000-0000-0000-000000000002', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select lives_ok($$
  select public.create_project(
    E'\t  Proiect creat de BC  \n',
    'a7300000-0000-0000-0000-000000000001'
  )
$$, 'a current BC creates a project despite stale lower JWT claims');
reset role;

select is((select count(*) from public.projects where name = 'Proiect creat de BC'),
  1::bigint, 'create_project trims and stores the project name');
select is((select created_by from public.projects where name = 'Proiect creat de BC'),
  'a7300000-0000-0000-0000-000000000002'::uuid,
  'create_project stamps created_by from auth.uid()');
select is((select leader_id from public.projects where name = 'Proiect creat de BC'),
  'a7300000-0000-0000-0000-000000000001'::uuid,
  'create_project stores the requested eligible leader');
select is((
  select count(*)
    from public.project_members as membership
    join public.projects as project on project.id = membership.project_id
   where project.name = 'Proiect creat de BC'
     and membership.member_id = 'a7300000-0000-0000-0000-000000000001'
), 1::bigint, 'the project invariant creates exactly one leader membership');

-- The lifecycle command must hold a lock that conflicts with ordinary profile
-- updates. Inspecting the real row lock catches FOR KEY SHARE, which would let
-- a concurrent status change race this transaction. Supabase's local postgres
-- role is intentionally not a superuser, and localhost uses trust auth, which
-- dblink rejects for non-superusers. The CLI-managed internal database alias
-- provides the password-authenticated route in both CI and local development.
select extensions.dblink_connect(
  'project_leader_lock',
  format(
    'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
    current_database()
  ));
-- #621: this connection also commits and cleans up fixture rows.
select extensions.dblink_exec('project_leader_lock', 'set lock_timeout = ''2s''');
select extensions.dblink_exec(
  'project_leader_lock',
  $$ delete from auth.users
      where id in (
        'a7300000-0000-0000-0000-000000000009',
        'a7300000-0000-0000-0000-000000000010'
      ) $$
);
select extensions.dblink_exec(
  'project_leader_lock',
  $$ insert into auth.users (id, email) values
       ('a7300000-0000-0000-0000-000000000009',
        'project.lifecycle.lock-bc@test.local'),
       ('a7300000-0000-0000-0000-000000000010',
        'project.lifecycle.lock-leader@test.local') $$
);
select extensions.dblink_exec(
  'project_leader_lock',
  $$ insert into public.profiles (id, full_name, email, role, status) values
       ('a7300000-0000-0000-0000-000000000009', 'Lifecycle Lock BC',
        'project.lifecycle.lock-bc@test.local', 'bc', 'activ'),
       ('a7300000-0000-0000-0000-000000000010', 'Lifecycle Lock Leader',
        'project.lifecycle.lock-leader@test.local', 'voluntar', 'activ') $$
);
select extensions.dblink_exec('project_leader_lock', 'begin');
select *
  from extensions.dblink(
    'project_leader_lock',
    format(
      'select set_config(''request.jwt.claims'', %L, true)',
      jsonb_build_object(
        'sub', 'a7300000-0000-0000-0000-000000000009',
        'role', 'authenticated',
        'app_metadata', jsonb_build_object(
          'member_role', 'bc',
          'member_level', 6,
          'dept_ids', '[]'::jsonb,
          'team_ids', '[]'::jsonb
        )
      )::text
    )
  ) as remote_claims(setting text);
select extensions.dblink_exec(
  'project_leader_lock', 'set local role authenticated');
select *
  from extensions.dblink(
    'project_leader_lock',
    $$ select (public.create_project(
         'Project lock probe',
         'a7300000-0000-0000-0000-000000000010'
       )).id $$
  ) as remote_project(id bigint);
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.profiles') as row_lock
    join public.profiles as profile on profile.ctid = row_lock.locked_row
   where profile.id = 'a7300000-0000-0000-0000-000000000010'
), false), 'create_project holds FOR SHARE on the leader profile until commit');
select extensions.dblink_exec('project_leader_lock', 'rollback');
select extensions.dblink_exec(
  'project_leader_lock',
  $$ delete from auth.users
      where id in (
        'a7300000-0000-0000-0000-000000000009',
        'a7300000-0000-0000-0000-000000000010'
      ) $$
);
select extensions.dblink_disconnect('project_leader_lock');

select pg_temp.test_login('a7300000-0000-0000-0000-000000000003', jsonb_build_object(
    'member_role', 'moderator', 'member_level', 9,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select lives_ok($$
  select public.create_project(
    'Proiect creat de Moderator',
    'a7300000-0000-0000-0000-000000000001'
  )
$$, 'an active Moderator creates a project');
reset role;

-- Wrong roles and stale/deprovisioned identities fail before any write.
select pg_temp.test_login('a7300000-0000-0000-0000-000000000004', jsonb_build_object(
    'member_role', 'bce', 'member_level', 5,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select throws_ok($$
  select public.create_project('BCE interzis', 'a7300000-0000-0000-0000-000000000001')
$$, '42501', 'project_admin_forbidden', 'BCE cannot create projects');
reset role;

select pg_temp.test_login('a7300000-0000-0000-0000-000000000005', jsonb_build_object(
    'member_role', 'responsabil', 'member_level', 4,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select throws_ok($$
  select public.create_project('Responsabil interzis', 'a7300000-0000-0000-0000-000000000001')
$$, '42501', 'project_admin_forbidden', 'Responsabil cannot create projects');
reset role;

select pg_temp.test_login('a7300000-0000-0000-0000-000000000001', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select throws_ok($$
  select public.create_project('Voluntar interzis', 'a7300000-0000-0000-0000-000000000001')
$$, '42501', 'project_admin_forbidden', 'ordinary members cannot create projects');
reset role;

select pg_temp.test_login('a7300000-0000-0000-0000-000000000006', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select throws_ok($$
  select public.create_project('BC inactiv interzis', 'a7300000-0000-0000-0000-000000000001')
$$, '42501', 'project_admin_forbidden', 'an inactive BC cannot create projects');
reset role;

select pg_temp.test_login('a7300000-0000-0000-0000-000000000007', jsonb_build_object('provider', 'email'));
select throws_ok($$
  select public.create_project('Fără claims', 'a7300000-0000-0000-0000-000000000001')
$$, '42501', 'project_admin_forbidden', 'a real BC uid without organization claims is denied');
reset role;

select pg_temp.test_clear_jwt();
set local role authenticated;
select throws_ok($$
  select public.create_project('Fără JWT', 'a7300000-0000-0000-0000-000000000001')
$$, '42501', 'project_admin_forbidden', 'authenticated without a JWT is denied');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$
  select public.create_project('Anon', 'a7300000-0000-0000-0000-000000000001')
$$, '42501', null, 'anonymous callers cannot execute create_project');
reset role;

-- Stable validation errors replace raw check/FK failures.
select pg_temp.test_login('a7300000-0000-0000-0000-000000000002', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select throws_ok($$
  select public.create_project('   ', 'a7300000-0000-0000-0000-000000000001')
$$, 'PT400', 'invalid_project_name', 'blank project names have a stable error');
select throws_ok($$
  select public.create_project('Lider inactiv', 'a7300000-0000-0000-0000-000000000008')
$$, 'PT400', 'project_leader_not_eligible', 'inactive leaders have a stable error');
select throws_ok($$
  select public.create_project('Lider lipsă', 'a7300000-0000-0000-0000-000000009999')
$$, 'PT400', 'project_leader_not_eligible', 'missing leaders have a stable error');
reset role;

-- Archive preserves identity and roster, and a repeated call is idempotent.
select pg_temp.test_login('a7300000-0000-0000-0000-000000000002', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(
  (select pg_temp.archive_status(existing_project_id) from fx),
  'archived', 'BC archives an active project and receives the archived row');
reset role;

create temp table first_archive as
select project.updated_at
  from public.projects as project
 where project.id = (select existing_project_id from fx);

select is((
  select status from public.projects
   where id = (select existing_project_id from fx)
), 'archived', 'archive_project persists the archived state');
select is((
  select project.updated_at > snapshot.updated_at
    from public.projects as project
    cross join before_archive as snapshot
   where project.id = (select existing_project_id from fx)
), true, 'the first archive advances updated_at');
select is((
  select count(*) from public.project_members
   where project_id = (select existing_project_id from fx)
), 1::bigint, 'archiving preserves the project roster');
select is((
  select leader_id from public.projects
   where id = (select existing_project_id from fx)
), 'a7300000-0000-0000-0000-000000000001'::uuid,
  'archiving preserves the project leader');
select is((
  select created_by from public.projects
   where id = (select existing_project_id from fx)
), 'a7300000-0000-0000-0000-000000000002'::uuid,
  'archiving preserves the project creator');

select pg_temp.test_login('a7300000-0000-0000-0000-000000000002', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(
  (select pg_temp.archive_status(existing_project_id) from fx),
  'archived', 'repeated archive returns the unchanged archived project');
reset role;

select is((
  select project.updated_at = snapshot.updated_at
    from public.projects as project
    cross join first_archive as snapshot
   where project.id = (select existing_project_id from fx)
), true, 'repeated archive does not advance updated_at');

select pg_temp.test_login('a7300000-0000-0000-0000-000000000003', jsonb_build_object(
    'member_role', 'moderator', 'member_level', 9,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select lives_ok($$
  select public.archive_project((select id from public.projects where name = 'Proiect creat de Moderator'))
$$, 'Moderator can archive a project');
reset role;

select pg_temp.test_login('a7300000-0000-0000-0000-000000000004', jsonb_build_object(
    'member_role', 'bce', 'member_level', 5,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select throws_ok($$
  select public.archive_project((select protected_project_id from fx))
$$, '42501', 'project_admin_forbidden', 'BCE cannot archive projects');
reset role;

select pg_temp.test_login('a7300000-0000-0000-0000-000000000005', jsonb_build_object(
    'member_role', 'responsabil', 'member_level', 4,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select throws_ok($$
  select public.archive_project((select protected_project_id from fx))
$$, '42501', 'project_admin_forbidden', 'Responsabil cannot archive projects');
reset role;

select pg_temp.test_login('a7300000-0000-0000-0000-000000000006', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select throws_ok($$
  select public.archive_project((select protected_project_id from fx))
$$, '42501', 'project_admin_forbidden', 'inactive BC cannot archive projects');
reset role;

select pg_temp.test_login('a7300000-0000-0000-0000-000000000007', jsonb_build_object('provider', 'email'));
select throws_ok($$
  select public.archive_project((select protected_project_id from fx))
$$, '42501', 'project_admin_forbidden', 'claimless BC uid cannot archive projects');
reset role;

select pg_temp.test_clear_jwt();
set local role authenticated;
select throws_ok($$
  select public.archive_project((select protected_project_id from fx))
$$, '42501', 'project_admin_forbidden', 'authenticated without a JWT cannot archive projects');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$
  select public.archive_project((select protected_project_id from fx))
$$, '42501', null, 'anonymous callers cannot execute archive_project');
reset role;

select is((
  select concat_ws(':', project.status, project.leader_id, project.created_by,
    (select count(*) from public.project_members as membership
      where membership.project_id = project.id))
    from public.projects as project
   where project.id = (select protected_project_id from fx)
), 'active:a7300000-0000-0000-0000-000000000001:a7300000-0000-0000-0000-000000000002:1',
  'every denied archive preserves state, identity, and the complete roster');

select pg_temp.test_login('a7300000-0000-0000-0000-000000000002', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select throws_ok($$
  select public.archive_project(9223372036854775807)
$$, 'PT404', 'project_not_found', 'authorized callers receive a stable missing-project error');

select throws_ok($$
  insert into public.projects (name, leader_id, created_by)
  values (
    'Insert direct interzis',
    'a7300000-0000-0000-0000-000000000001',
    'a7300000-0000-0000-0000-000000000002'
  )
$$, '42501', null, 'BC cannot bypass create_project with a direct insert');
select throws_ok($$
  update public.projects
     set name = 'Update direct interzis'
   where id = (select existing_project_id from fx)
$$, '42501', null, 'BC cannot bypass archive_project with a direct update');
select throws_ok($$
  delete from public.projects
   where id = (select existing_project_id from fx)
$$, '42501', null, 'BC cannot directly delete projects');
reset role;

select is((select count(*) from public.projects where name like '%interzis%'),
  0::bigint, 'every denied lifecycle path leaves project rows unchanged');

select * from finish();
rollback;
