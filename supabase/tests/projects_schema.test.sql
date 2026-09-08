-- projects_schema.test.sql — #268: project lifecycle table foundation.
-- Runs in one transaction and rolls back, leaving the demo seed untouched.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(27);

select has_table('public', 'projects', 'projects table exists');
select ok(
  (select relrowsecurity from pg_class
    where relname = 'projects' and relnamespace = 'public'::regnamespace),
  'projects enables RLS at birth');

select col_type_is('public', 'projects', 'id', 'bigint', 'project id is bigint');
select col_not_null('public', 'projects', 'name', 'project name is required');
select col_not_null('public', 'projects', 'status', 'project status is required');
select col_has_default('public', 'projects', 'status', 'project status has a default');
select col_not_null('public', 'projects', 'leader_id', 'project leader is required');
select col_not_null('public', 'projects', 'created_by', 'project creator is required');
select col_not_null('public', 'projects', 'created_at', 'creation time is required');
select col_has_default('public', 'projects', 'created_at', 'creation time is server-stamped');
select col_not_null('public', 'projects', 'updated_at', 'update time is required');
select col_has_default('public', 'projects', 'updated_at', 'update time is server-stamped');
select fk_ok('public', 'projects', 'leader_id', 'public', 'profiles', 'id',
  'project leaders reference profiles');
select fk_ok('public', 'projects', 'created_by', 'public', 'profiles', 'id',
  'project creators reference profiles');

select has_index('public', 'projects', 'projects_active_idx',
  'active-project listing has a partial index');
select ok(
  exists (
    select 1
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
     where c.relname = 'projects_active_idx'
       and c.relnamespace = 'public'::regnamespace
       and i.indpred is not null
  ),
  'the active-project listing index is actually partial');
select has_index('public', 'projects', 'projects_leader_idx',
  'projects can be found by leader');
select has_index('public', 'projects', 'projects_created_by_idx',
  'projects can be audited by creator');

insert into auth.users (id, email) values
  ('a6800000-0000-0000-0000-000000000001', 'project.lead@test.local'),
  ('a6800000-0000-0000-0000-000000000002', 'project.creator@test.local');
insert into public.profiles (id, full_name, email, role) values
  ('a6800000-0000-0000-0000-000000000001', 'Project Lead', 'project.lead@test.local', 'voluntar'),
  ('a6800000-0000-0000-0000-000000000002', 'Project Creator', 'project.creator@test.local', 'bc');

select lives_ok(
  $$ insert into public.projects (name, leader_id, created_by)
     values ('Proiect activ',
             'a6800000-0000-0000-0000-000000000001',
             'a6800000-0000-0000-0000-000000000002') $$,
  'a project defaults to active with server timestamps');
select is(
  (select status from public.projects where name = 'Proiect activ'),
  'active',
  'the lifecycle default is active');
select ok(
  (select created_at is not null and updated_at >= created_at
     from public.projects where name = 'Proiect activ'),
  'server timestamps are populated in a valid order');
select lives_ok(
  $$ insert into public.projects (name, status, leader_id, created_by)
     values ('Proiect arhivat', 'archived',
             'a6800000-0000-0000-0000-000000000001',
             'a6800000-0000-0000-0000-000000000002') $$,
  'archived is a valid lifecycle state');
select throws_ok(
  $$ insert into public.projects (name, status, leader_id, created_by)
     values ('Stare inventată', 'paused',
             'a6800000-0000-0000-0000-000000000001',
             'a6800000-0000-0000-0000-000000000002') $$,
  '23514', null, 'unknown lifecycle states are rejected');
select throws_ok(
  $$ insert into public.projects (name, leader_id, created_by)
     values ('   ',
             'a6800000-0000-0000-0000-000000000001',
             'a6800000-0000-0000-0000-000000000002') $$,
  '23514', null, 'project names cannot be blank');

select ok(
  not has_table_privilege('anon', 'public.projects', 'select'),
  'anon receives no project table privilege');

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'a6800000-0000-0000-0000-000000000001',
    'role', 'authenticated',
    'app_metadata', '{}'::jsonb
  )::text,
  true
);
set local role authenticated;
select is((select count(*) from public.projects), 0::bigint,
  'deny-by-default RLS exposes no projects to an authenticated caller');
select throws_ok(
  $$ insert into public.projects (name, leader_id, created_by)
     values ('Bypass attempt',
             'a6800000-0000-0000-0000-000000000001',
             'a6800000-0000-0000-0000-000000000001') $$,
  '42501', null, 'deny-by-default RLS blocks direct authenticated creation');

reset role;
select * from finish();
rollback;
