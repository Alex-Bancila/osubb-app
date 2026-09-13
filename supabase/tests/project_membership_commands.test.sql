-- project_membership_commands.test.sql — #274/#311: the active project lead,
-- BC, and Moderator manage memberships and the project-local Responsible role.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;
\set osubb_test_suite true
\ir _helpers.sql

select plan(66);

-- Dynamic dispatch keeps RED reporting behavioral failures instead of
-- aborting the file while the four public commands do not exist yet.
create function pg_temp.membership_role(
  command_name text,
  project_id bigint,
  member_id uuid
)
returns text
language plpgsql
as $$
declare
  answer text;
begin
  execute format(
    'select (public.%I($1, $2)).project_role', command_name
  ) into answer using project_id, member_id;
  return answer;
exception
  when undefined_function or insufficient_privilege then
    return null;
end;
$$;

create function pg_temp.remove_result(project_id bigint, member_id uuid)
returns boolean
language plpgsql
as $$
declare
  answer boolean;
begin
  execute 'select public.remove_project_member($1, $2)'
     into answer using project_id, member_id;
  return answer;
exception
  when undefined_function or insufficient_privilege then
    return null;
end;
$$;

insert into auth.users (id, email) values
  ('a7400000-0000-0000-0000-000000000001', 'project.membership.lead@test.local'),
  ('a7400000-0000-0000-0000-000000000002', 'project.membership.responsible@test.local'),
  ('a7400000-0000-0000-0000-000000000003', 'project.membership.member@test.local'),
  ('a7400000-0000-0000-0000-000000000004', 'project.membership.outsider@test.local'),
  ('a7400000-0000-0000-0000-000000000005', 'project.membership.target@test.local'),
  ('a7400000-0000-0000-0000-000000000006', 'project.membership.inactive@test.local'),
  ('a7400000-0000-0000-0000-000000000007', 'project.membership.bce@test.local'),
  ('a7400000-0000-0000-0000-000000000008', 'project.membership.bc@test.local'),
  ('a7400000-0000-0000-0000-000000000009', 'project.membership.moderator@test.local'),
  ('a7400000-0000-0000-0000-000000000010', 'project.membership.claimless@test.local'),
  ('a7400000-0000-0000-0000-000000000011', 'project.membership.archived-lead@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('a7400000-0000-0000-0000-000000000001', 'Membership Lead',
   'project.membership.lead@test.local', 'voluntar', 'activ'),
  ('a7400000-0000-0000-0000-000000000002', 'Membership Responsible',
   'project.membership.responsible@test.local', 'responsabil', 'activ'),
  ('a7400000-0000-0000-0000-000000000003', 'Membership Member',
   'project.membership.member@test.local', 'voluntar', 'activ'),
  ('a7400000-0000-0000-0000-000000000004', 'Membership Outsider',
   'project.membership.outsider@test.local', 'voluntar', 'activ'),
  ('a7400000-0000-0000-0000-000000000005', 'Membership Target',
   'project.membership.target@test.local', 'vot', 'activ'),
  ('a7400000-0000-0000-0000-000000000006', 'Membership Inactive',
   'project.membership.inactive@test.local', 'voluntar', 'inactiv'),
  ('a7400000-0000-0000-0000-000000000007', 'Membership BCE',
   'project.membership.bce@test.local', 'bce', 'activ'),
  ('a7400000-0000-0000-0000-000000000008', 'Membership BC',
   'project.membership.bc@test.local', 'bc', 'activ'),
  ('a7400000-0000-0000-0000-000000000009', 'Membership Moderator',
   'project.membership.moderator@test.local', 'moderator', 'activ'),
  ('a7400000-0000-0000-0000-000000000010', 'Membership Claimless',
   'project.membership.claimless@test.local', 'voluntar', 'activ'),
  ('a7400000-0000-0000-0000-000000000011', 'Archived Membership Lead',
   'project.membership.archived-lead@test.local', 'voluntar', 'activ');

insert into public.projects (name, status, leader_id, created_by) values
  ('Membership Active', 'active',
   'a7400000-0000-0000-0000-000000000001',
   'a7400000-0000-0000-0000-000000000008'),
  ('Membership Archived', 'archived',
   'a7400000-0000-0000-0000-000000000011',
   'a7400000-0000-0000-0000-000000000008');

insert into public.project_members (project_id, member_id, project_role)
select project.id, membership.member_id, membership.project_role
  from public.projects as project
  cross join (values
    ('a7400000-0000-0000-0000-000000000002'::uuid, 'responsible'),
    ('a7400000-0000-0000-0000-000000000003'::uuid, 'member'),
    ('a7400000-0000-0000-0000-000000000010'::uuid, 'member')
  ) as membership(member_id, project_role)
 where project.name = 'Membership Active';

create temp table fx as
select
  max(id) filter (where name = 'Membership Active') as active_project_id,
  max(id) filter (where name = 'Membership Archived') as archived_project_id,
  9223372036854775807::bigint as missing_project_id
from public.projects;
grant select on fx to authenticated;

-- ==================== API shape and privileges ====================
select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname in (
       'add_project_member', 'remove_project_member',
       'grant_project_responsible', 'revoke_project_responsible'
     )
     and pg_get_function_identity_arguments(procedure.oid) =
       'p_project_id bigint, p_member_id uuid'
), 4::bigint, 'all four public membership commands have the narrow signature');

select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname in (
       'add_project_member', 'grant_project_responsible',
       'revoke_project_responsible'
     )
     and pg_get_function_result(procedure.oid) = 'project_members'
), 3::bigint, 'row-changing commands return the resulting membership');

select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname = 'remove_project_member'
     and pg_get_function_result(procedure.oid) = 'boolean'
), 1::bigint, 'remove_project_member reports whether a row was removed');

select ok(coalesce((
  select bool_and(not procedure.prosecdef)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname in (
       'add_project_member', 'remove_project_member',
       'grant_project_responsible', 'revoke_project_responsible'
     )
), false), 'public membership commands are security invoker wrappers');

select ok(coalesce((
  select bool_and('search_path=""' = any(procedure.proconfig))
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname in ('public', 'private')
     and procedure.proname in (
       'require_active_project_lead',
       'add_project_member', 'remove_project_member',
       'grant_project_responsible', 'revoke_project_responsible',
       'add_project_member_impl', 'remove_project_member_impl',
       'grant_project_responsible_impl', 'revoke_project_responsible_impl'
     )
), false), 'every command function has an empty search_path');

select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private'
     and procedure.proname in (
       'require_active_project_lead',
       'add_project_member_impl', 'remove_project_member_impl',
       'grant_project_responsible_impl', 'revoke_project_responsible_impl'
     )
     and procedure.prosecdef
), 5::bigint, 'private authorization and write implementations run as owner');

select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname in (
       'add_project_member', 'remove_project_member',
       'grant_project_responsible', 'revoke_project_responsible'
     )
     and has_function_privilege('authenticated', procedure.oid, 'execute')
), 4::bigint, 'authenticated can execute all four public commands');

select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname in (
       'add_project_member', 'remove_project_member',
       'grant_project_responsible', 'revoke_project_responsible'
     )
     and has_function_privilege('anon', procedure.oid, 'execute')
), 0::bigint, 'anon cannot execute membership commands');

select is((
  select count(*)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private'
     and procedure.proname in (
       'require_active_project_lead',
       'add_project_member_impl', 'remove_project_member_impl',
       'grant_project_responsible_impl', 'revoke_project_responsible_impl'
     )
     and has_function_privilege('authenticated', procedure.oid, 'execute')
), 4::bigint, 'authenticated reaches only the four private wrapper implementations');

select ok(not has_table_privilege('authenticated', 'public.project_members', 'insert'),
  'authenticated has no direct project-membership INSERT');
select ok(not has_table_privilege('authenticated', 'public.project_members', 'update'),
  'authenticated has no direct project-membership UPDATE');
select ok(not has_table_privilege('authenticated', 'public.project_members', 'delete'),
  'authenticated has no direct project-membership DELETE');

-- ==================== Lead behavior and idempotency ====================
select pg_temp.test_login('a7400000-0000-0000-0000-000000000001',
  jsonb_build_object('member_role','voluntar','member_level',1,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));

select is(pg_temp.membership_role(
  'add_project_member', (select active_project_id from fx),
  'a7400000-0000-0000-0000-000000000005'),
  'member', 'the active lead adds an active OSUBB member');
select is(pg_temp.membership_role(
  'add_project_member', (select active_project_id from fx),
  'a7400000-0000-0000-0000-000000000005'),
  'member', 'repeating add returns the existing ordinary membership');
select is((select count(*) from public.project_members
  where project_id = (select active_project_id from fx)
    and member_id = 'a7400000-0000-0000-0000-000000000005'),
  1::bigint, 'repeated add never duplicates a membership');
select is(pg_temp.membership_role(
  'add_project_member', (select active_project_id from fx),
  'a7400000-0000-0000-0000-000000000002'),
  'responsible', 'add preserves an existing Responsible instead of downgrading them');

select is(pg_temp.membership_role(
  'grant_project_responsible', (select active_project_id from fx),
  'a7400000-0000-0000-0000-000000000005'),
  'responsible', 'the lead grants Responsible to an existing active member');
select is(pg_temp.membership_role(
  'grant_project_responsible', (select active_project_id from fx),
  'a7400000-0000-0000-0000-000000000005'),
  'responsible', 'repeating a Responsible grant is deterministic');
select is((select count(*) from public.project_members
  where project_id = (select active_project_id from fx)
    and member_id = 'a7400000-0000-0000-0000-000000000005'
    and project_role = 'responsible'),
  1::bigint, 'repeated grants keep one Responsible row');

select is(pg_temp.membership_role(
  'revoke_project_responsible', (select active_project_id from fx),
  'a7400000-0000-0000-0000-000000000005'),
  'member', 'the lead revokes Responsible while preserving membership');
select is(pg_temp.membership_role(
  'revoke_project_responsible', (select active_project_id from fx),
  'a7400000-0000-0000-0000-000000000005'),
  'member', 'repeating a Responsible revocation is deterministic');

select is(pg_temp.remove_result(
  (select active_project_id from fx),
  'a7400000-0000-0000-0000-000000000005'),
  true, 'the lead removes an ordinary project member');
select is(pg_temp.remove_result(
  (select active_project_id from fx),
  'a7400000-0000-0000-0000-000000000005'),
  false, 'repeating remove reports that no row remained');
select is((select count(*) from public.project_members
  where project_id = (select active_project_id from fx)
    and member_id = 'a7400000-0000-0000-0000-000000000005'),
  0::bigint, 'remove persists without deleting the profile');

select throws_ok($$
  select public.add_project_member(
    (select active_project_id from fx),
    'a7400000-0000-0000-0000-000000000006')
$$, 'PT400', 'project_member_not_eligible', 'inactive people cannot be added');
select throws_ok($$
  select public.add_project_member(
    (select active_project_id from fx),
    'a7400000-0000-0000-0000-000000009999')
$$, 'PT400', 'project_member_not_eligible', 'missing people cannot be added');
select throws_ok($$
  select public.grant_project_responsible(
    (select active_project_id from fx),
    'a7400000-0000-0000-0000-000000000004')
$$, 'PT404', 'project_member_not_found', 'Responsible can only be granted to a member');
select throws_ok($$
  select public.revoke_project_responsible(
    (select active_project_id from fx),
    'a7400000-0000-0000-0000-000000000004')
$$, 'PT404', 'project_member_not_found', 'Responsible can only be revoked from a member');
select throws_ok($$
  select public.remove_project_member(
    (select active_project_id from fx),
    'a7400000-0000-0000-0000-000000000001')
$$, 'PT409', 'project_leader_membership_required', 'the lead cannot remove their required membership');

reset role;

select is((select project_role from public.project_members
  where project_id = (select active_project_id from fx)
    and member_id = 'a7400000-0000-0000-0000-000000000001'),
  'member', 'a rejected self-removal preserves the leader membership');

-- ==================== Archived, missing, and unauthorized ====================
select pg_temp.test_login('a7400000-0000-0000-0000-000000000011',
  jsonb_build_object('member_role','voluntar','member_level',1,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$
  select public.add_project_member(
    (select archived_project_id from fx),
    'a7400000-0000-0000-0000-000000000005')
$$, 'PT409', 'project_archived', 'an archived project roster cannot add members');
select throws_ok($$
  select public.remove_project_member(
    (select archived_project_id from fx),
    'a7400000-0000-0000-0000-000000000011')
$$, 'PT409', 'project_archived', 'an archived project roster cannot remove members');
select throws_ok($$
  select public.grant_project_responsible(
    (select archived_project_id from fx),
    'a7400000-0000-0000-0000-000000000011')
$$, 'PT409', 'project_archived', 'an archived project cannot grant Responsible');
select throws_ok($$
  select public.revoke_project_responsible(
    (select archived_project_id from fx),
    'a7400000-0000-0000-0000-000000000011')
$$, 'PT409', 'project_archived', 'an archived project cannot revoke Responsible');
reset role;

update public.profiles
   set status = 'inactiv'
 where id = 'a7400000-0000-0000-0000-000000000011';
select pg_temp.test_login('a7400000-0000-0000-0000-000000000011',
  jsonb_build_object('member_role','voluntar','member_level',1,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$
  select public.add_project_member(
    (select archived_project_id from fx),
    'a7400000-0000-0000-0000-000000000005')
$$, '42501', 'project_lead_forbidden', 'an inactive project lead is denied even with stale organization claims');
reset role;

select pg_temp.test_login('a7400000-0000-0000-0000-000000000001',
  jsonb_build_object('member_role','voluntar','member_level',1,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$
  select public.add_project_member(
    (select missing_project_id from fx),
    'a7400000-0000-0000-0000-000000000005')
$$, '42501', 'project_lead_forbidden', 'a missing project does not leak its existence');
reset role;

-- Every command must call the same server-side lead authorization boundary.
select pg_temp.test_login('a7400000-0000-0000-0000-000000000004',
  jsonb_build_object('member_role','voluntar','member_level',1,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$
  select public.add_project_member((select active_project_id from fx),
    'a7400000-0000-0000-0000-000000000005')
$$, '42501', 'project_lead_forbidden', 'an outsider cannot add project members');
select throws_ok($$
  select public.remove_project_member((select active_project_id from fx),
    'a7400000-0000-0000-0000-000000000003')
$$, '42501', 'project_lead_forbidden', 'an outsider cannot remove project members');
select throws_ok($$
  select public.grant_project_responsible((select active_project_id from fx),
    'a7400000-0000-0000-0000-000000000003')
$$, '42501', 'project_lead_forbidden', 'an outsider cannot grant Responsible');
select throws_ok($$
  select public.revoke_project_responsible((select active_project_id from fx),
    'a7400000-0000-0000-0000-000000000002')
$$, '42501', 'project_lead_forbidden', 'an outsider cannot revoke Responsible');
reset role;

select pg_temp.test_login('a7400000-0000-0000-0000-000000000003',
  jsonb_build_object('member_role','voluntar','member_level',1,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$
  select public.add_project_member((select active_project_id from fx),
    'a7400000-0000-0000-0000-000000000005')
$$, '42501', 'project_lead_forbidden', 'an ordinary project member cannot manage the roster');
reset role;

select pg_temp.test_login('a7400000-0000-0000-0000-000000000002',
  jsonb_build_object('member_role','responsabil','member_level',4,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$
  select public.add_project_member((select active_project_id from fx),
    'a7400000-0000-0000-0000-000000000005')
$$, '42501', 'project_lead_forbidden', 'a Project Responsible cannot manage the roster');
reset role;

select pg_temp.test_login('a7400000-0000-0000-0000-000000000007',
  jsonb_build_object('member_role','bce','member_level',5,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$
  select public.add_project_member((select active_project_id from fx),
    'a7400000-0000-0000-0000-000000000005')
$$, '42501', 'project_lead_forbidden', 'BCE without the lead role cannot manage a project roster');
reset role;

-- Current database roles authorize the global override. The deliberately
-- stale low-level BC claim proves the command does not trust JWT level alone.
select pg_temp.test_login('a7400000-0000-0000-0000-000000000008',
  jsonb_build_object('member_role','voluntar','member_level',1,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select is(pg_temp.membership_role(
  'add_project_member', (select active_project_id from fx),
  'a7400000-0000-0000-0000-000000000005'),
  'member', 'BC can add a member to a project they do not lead');
select is(pg_temp.membership_role(
  'grant_project_responsible', (select active_project_id from fx),
  'a7400000-0000-0000-0000-000000000005'),
  'responsible', 'BC can grant Responsible in a project they do not lead');
select is(pg_temp.membership_role(
  'revoke_project_responsible', (select active_project_id from fx),
  'a7400000-0000-0000-0000-000000000005'),
  'member', 'BC can revoke Responsible in a project they do not lead');
select is(pg_temp.remove_result(
  (select active_project_id from fx),
  'a7400000-0000-0000-0000-000000000005'),
  true, 'BC can remove a member from a project they do not lead');
select throws_ok($$
  select public.add_project_member((select archived_project_id from fx),
    'a7400000-0000-0000-0000-000000000005')
$$, 'PT409', 'project_archived', 'BC override cannot mutate an archived project roster');
reset role;

select pg_temp.test_login('a7400000-0000-0000-0000-000000000009',
  jsonb_build_object('member_role','moderator','member_level',9,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select is(pg_temp.membership_role(
  'add_project_member', (select active_project_id from fx),
  'a7400000-0000-0000-0000-000000000005'),
  'member', 'Moderator can add a member to a project they do not lead');
select is(pg_temp.membership_role(
  'grant_project_responsible', (select active_project_id from fx),
  'a7400000-0000-0000-0000-000000000005'),
  'responsible', 'Moderator can grant Responsible in a project they do not lead');
select is(pg_temp.membership_role(
  'revoke_project_responsible', (select active_project_id from fx),
  'a7400000-0000-0000-0000-000000000005'),
  'member', 'Moderator can revoke Responsible in a project they do not lead');
select is(pg_temp.remove_result(
  (select active_project_id from fx),
  'a7400000-0000-0000-0000-000000000005'),
  true, 'Moderator can remove a member from a project they do not lead');
reset role;

update public.profiles set status = 'inactiv'
 where id = 'a7400000-0000-0000-0000-000000000008';
select pg_temp.test_login('a7400000-0000-0000-0000-000000000008',
  jsonb_build_object('member_role','bc','member_level',6,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$
  select public.add_project_member((select active_project_id from fx),
    'a7400000-0000-0000-0000-000000000005')
$$, '42501', 'project_lead_forbidden', 'an inactive BC is denied even with stale leadership claims');
reset role;

select pg_temp.test_login(
  'a7400000-0000-0000-0000-000000000001',
  jsonb_build_object('provider', 'email'));
select throws_ok($$
  select public.add_project_member((select active_project_id from fx),
    'a7400000-0000-0000-0000-000000000005')
$$, '42501', 'project_lead_forbidden', 'a valid UID without organization claims is denied');
reset role;

select pg_temp.test_clear_jwt();
set local role authenticated;
select throws_ok($$
  select public.add_project_member((select active_project_id from fx),
    'a7400000-0000-0000-0000-000000000005')
$$, '42501', 'project_lead_forbidden', 'an authenticated session without a JWT is denied');
reset role;

set local role anon;
select throws_ok($$
  select public.add_project_member((select active_project_id from fx),
    'a7400000-0000-0000-0000-000000000005')
$$, '42501', null, 'anonymous callers cannot execute membership commands');
reset role;

-- Denials above must not have changed the protected roster.
select is((select count(*) from public.project_members
  where project_id = (select active_project_id from fx)),
  4::bigint, 'denied commands leave the active project roster unchanged');
select is((select count(*) from public.project_members
  where project_id = (select archived_project_id from fx)),
  1::bigint, 'archived-project denials preserve its historical roster');

-- Direct writes cannot bypass the command boundary even for the lead.
select pg_temp.test_login('a7400000-0000-0000-0000-000000000001',
  jsonb_build_object('member_role','voluntar','member_level',1,'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
select throws_ok($$
  insert into public.project_members (project_id, member_id, project_role)
  values ((select active_project_id from fx),
    'a7400000-0000-0000-0000-000000000005', 'member')
$$, '42501', null, 'the lead cannot bypass add_project_member with INSERT');
select throws_ok($$
  update public.project_members set project_role = 'responsible'
   where project_id = (select active_project_id from fx)
     and member_id = 'a7400000-0000-0000-0000-000000000003'
$$, '42501', null, 'the lead cannot bypass grant_project_responsible with UPDATE');
select throws_ok($$
  delete from public.project_members
   where project_id = (select active_project_id from fx)
     and member_id = 'a7400000-0000-0000-0000-000000000003'
$$, '42501', null, 'the lead cannot bypass remove_project_member with DELETE');
reset role;

-- ==================== Real concurrent duplicate add ====================
-- This fixture is committed through a second connection because dblink
-- sessions cannot see rows inside this pgTAP transaction. Pre/post cleanup
-- makes it independent from seed.sql and safe to rerun after interruption.
select extensions.dblink_connect(
  'membership_setup',
  format(
    'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
    current_database()
  ));
select extensions.dblink_exec('membership_setup', $$
  delete from public.projects where name = 'Membership concurrency probe';
  delete from auth.users where id in (
    'a7400000-0000-0000-0000-000000000020',
    'a7400000-0000-0000-0000-000000000021'
  );
  insert into auth.users (id, email) values
    ('a7400000-0000-0000-0000-000000000020', 'project.membership.concurrent-lead@test.local'),
    ('a7400000-0000-0000-0000-000000000021', 'project.membership.concurrent-target@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('a7400000-0000-0000-0000-000000000020', 'Concurrent Membership Lead',
     'project.membership.concurrent-lead@test.local', 'voluntar', 'activ'),
    ('a7400000-0000-0000-0000-000000000021', 'Concurrent Membership Target',
     'project.membership.concurrent-target@test.local', 'voluntar', 'activ');
  insert into public.projects (name, leader_id, created_by) values
    ('Membership concurrency probe',
     'a7400000-0000-0000-0000-000000000020',
     'a7400000-0000-0000-0000-000000000020');
$$);

select extensions.dblink_connect(
  'membership_lock',
  format(
    'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
    current_database()
  ));
select extensions.dblink_exec('membership_lock', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('membership_lock', $$
  select set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', 'a7400000-0000-0000-0000-000000000020',
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'member_role', 'voluntar', 'member_level', 1,
        'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
      )
    )::text,
    true
  )
$$) as remote_claims(setting text);
select extensions.dblink_exec('membership_lock', 'set local role authenticated');

-- A no-op removal touches no membership row and fires no table trigger. Any
-- project lock observed here therefore comes from the shared command guard.
select * from extensions.dblink('membership_lock', $$
  select public.remove_project_member(
    (select id from public.projects where name = 'Membership concurrency probe'),
    'a7400000-0000-0000-0000-000000009999'
  )
$$) as no_op_remove(removed boolean);

select ok(coalesce((
  select 'For Update' = any(row_lock.modes)
    from extensions.pgrowlocks('public.projects') as row_lock
    join public.projects as project on project.ctid = row_lock.locked_row
   where project.name = 'Membership concurrency probe'
), false), 'even a no-op roster command holds the project lock until commit');
select extensions.dblink_exec('membership_lock', 'rollback');
select extensions.dblink_disconnect('membership_lock');

select pg_temp.test_login(
  'a7400000-0000-0000-0000-000000000020',
  jsonb_build_object('member_role','voluntar','member_level',1,
    'dept_ids','[]'::jsonb,'team_ids','[]'::jsonb));
reset role;
create temp table membership_race as
select * from pg_temp.test_race(
  $$ select (public.add_project_member(
       (select id from public.projects where name = 'Membership concurrency probe'),
       'a7400000-0000-0000-0000-000000000021')).project_role::text $$,
  $$ select (public.add_project_member(
       (select id from public.projects where name = 'Membership concurrency probe'),
       'a7400000-0000-0000-0000-000000000021')).project_role::text $$
);
select is((select result_a from membership_race), 'member',
  'the first concurrent add returns the membership');
select ok((select b_waited from membership_race),
  'a duplicate add waits behind the project-scoped command lock');
select is((select result_b from membership_race), 'member',
  'the waiting duplicate add returns the existing membership');
select is((
  select membership_count from extensions.dblink('membership_setup', $$
    select count(*)
      from public.project_members as membership
      join public.projects as project on project.id = membership.project_id
     where project.name = 'Membership concurrency probe'
       and membership.member_id = 'a7400000-0000-0000-0000-000000000021'
  $$) as remote_count(membership_count bigint)
), 1::bigint, 'concurrent duplicate adds commit exactly one membership');

select extensions.dblink_exec('membership_setup', $$
  delete from public.projects where name = 'Membership concurrency probe';
  delete from auth.users where id in (
    'a7400000-0000-0000-0000-000000000020',
    'a7400000-0000-0000-0000-000000000021'
  );
$$);
select extensions.dblink_disconnect('membership_setup');

select * from finish();
rollback;
