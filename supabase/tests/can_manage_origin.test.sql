-- can_manage_origin.test.sql — #321: the one origin-authority predicate every
-- later Task command and read policy reuses (#318, #319, #320, #343).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(56);

-- ==================== Definition and privileges ====================
select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'can_manage_origin'),
  1::bigint,
  'private.can_manage_origin exists'
);
select ok(
  coalesce((select procedure.prosecdef
              from pg_proc as procedure
              join pg_namespace as namespace on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'private'
               and procedure.proname = 'can_manage_origin'), false),
  'can_manage_origin runs as its owner (security definer)'
);
select ok(
  coalesce((select procedure.provolatile = 's'
              from pg_proc as procedure
              join pg_namespace as namespace on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'private'
               and procedure.proname = 'can_manage_origin'), false),
  'can_manage_origin is stable'
);
select ok(
  coalesce((select 'search_path=""' = any(procedure.proconfig)
              from pg_proc as procedure
              join pg_namespace as namespace on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'private'
               and procedure.proname = 'can_manage_origin'), false),
  'can_manage_origin pins an empty search_path'
);
select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'can_manage_origin'
      and has_function_privilege('authenticated', procedure.oid, 'execute')),
  1::bigint,
  'authenticated may execute can_manage_origin'
);
select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'can_manage_origin'
      and has_function_privilege('anon', procedure.oid, 'execute')),
  0::bigint,
  'anon cannot execute can_manage_origin'
);
select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'can_manage_origin'
      and has_function_privilege('service_role', procedure.oid, 'execute')),
  0::bigint,
  'service_role does not receive a redundant direct helper API'
);
select ok(has_schema_privilege('authenticated', 'private', 'usage'),
  'authenticated can resolve private helpers used by policies');
select ok(not has_schema_privilege('anon', 'private', 'usage'),
  'anon cannot resolve the private schema');

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('32100000-0000-0000-0000-000000000001', 'cwr.bc@test.local'),
  ('32100000-0000-0000-0000-000000000002', 'cwr.moderator@test.local'),
  ('32100000-0000-0000-0000-000000000003', 'cwr.local-bce@test.local'),
  ('32100000-0000-0000-0000-000000000004', 'cwr.foreign-bce@test.local'),
  ('32100000-0000-0000-0000-000000000005', 'cwr.responsabil@test.local'),
  ('32100000-0000-0000-0000-000000000006', 'cwr.voluntar@test.local'),
  ('32100000-0000-0000-0000-000000000007', 'cwr.indep-member@test.local'),
  ('32100000-0000-0000-0000-000000000008', 'cwr.outsider@test.local'),
  ('32100000-0000-0000-0000-000000000009', 'cwr.project-lead@test.local'),
  ('32100000-0000-0000-0000-000000000010', 'cwr.project-responsible@test.local'),
  ('32100000-0000-0000-0000-000000000011', 'cwr.project-member@test.local'),
  ('32100000-0000-0000-0000-000000000012', 'cwr.deactivated-bc@test.local'),
  ('32100000-0000-0000-0000-000000000013', 'cwr.deactivated-bce@test.local'),
  ('32100000-0000-0000-0000-000000000014', 'cwr.claimless@test.local'),
  ('32100000-0000-0000-0000-000000000015', 'cwr.dept-team-member@test.local'),
  ('32100000-0000-0000-0000-000000000016', 'cwr.demoted-bc@test.local'),
  ('32100000-0000-0000-0000-000000000017', 'cwr.revoked-bce@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('32100000-0000-0000-0000-000000000001', 'CWR BC', 'cwr.bc@test.local', 'bc', 'activ'),
  ('32100000-0000-0000-0000-000000000002', 'CWR Moderator', 'cwr.moderator@test.local', 'moderator', 'activ'),
  ('32100000-0000-0000-0000-000000000003', 'CWR Local BCE', 'cwr.local-bce@test.local', 'bce', 'activ'),
  ('32100000-0000-0000-0000-000000000004', 'CWR Foreign BCE', 'cwr.foreign-bce@test.local', 'bce', 'activ'),
  ('32100000-0000-0000-0000-000000000005', 'CWR Responsabil', 'cwr.responsabil@test.local', 'responsabil', 'activ'),
  ('32100000-0000-0000-0000-000000000006', 'CWR Voluntar', 'cwr.voluntar@test.local', 'voluntar', 'activ'),
  ('32100000-0000-0000-0000-000000000007', 'CWR Independent Member', 'cwr.indep-member@test.local', 'voluntar', 'activ'),
  ('32100000-0000-0000-0000-000000000008', 'CWR Outsider', 'cwr.outsider@test.local', 'voluntar', 'activ'),
  ('32100000-0000-0000-0000-000000000009', 'CWR Project Lead', 'cwr.project-lead@test.local', 'voluntar', 'activ'),
  ('32100000-0000-0000-0000-000000000010', 'CWR Project Responsible', 'cwr.project-responsible@test.local', 'voluntar', 'activ'),
  ('32100000-0000-0000-0000-000000000011', 'CWR Project Member', 'cwr.project-member@test.local', 'voluntar', 'activ'),
  ('32100000-0000-0000-0000-000000000012', 'CWR Deactivated BC', 'cwr.deactivated-bc@test.local', 'bc', 'inactiv'),
  ('32100000-0000-0000-0000-000000000013', 'CWR Deactivated BCE', 'cwr.deactivated-bce@test.local', 'bce', 'inactiv'),
  ('32100000-0000-0000-0000-000000000014', 'CWR Claimless', 'cwr.claimless@test.local', 'voluntar', 'activ'),
  ('32100000-0000-0000-0000-000000000015', 'CWR Dept Team Member', 'cwr.dept-team-member@test.local', 'voluntar', 'activ'),
  ('32100000-0000-0000-0000-000000000016', 'CWR Demoted BC', 'cwr.demoted-bc@test.local', 'voluntar', 'activ'),
  ('32100000-0000-0000-0000-000000000017', 'CWR Revoked BCE', 'cwr.revoked-bce@test.local', 'bce', 'activ');

-- #17 (Revoked BCE) deliberately gets NO row here: its live Department
-- relationship has been withdrawn even though its JWT dept_ids claim (built
-- explicitly below, not via test_login_leadership) still lists 'edu'.
insert into public.member_departments (member_id, dept_id) values
  ('32100000-0000-0000-0000-000000000003', 'edu'),
  ('32100000-0000-0000-0000-000000000004', 'pr'),
  ('32100000-0000-0000-0000-000000000005', 'edu'),
  ('32100000-0000-0000-0000-000000000006', 'edu'),
  ('32100000-0000-0000-0000-000000000013', 'edu');

insert into public.teams (id, name, dept_id) values
  ('cwr-dept-team-321', 'CWR Department Team', 'edu'),
  ('cwr-indep-team-321', 'CWR Independent Team', null);

insert into public.team_members (team_id, member_id) values
  ('cwr-indep-team-321', '32100000-0000-0000-0000-000000000007'),
  ('cwr-dept-team-321', '32100000-0000-0000-0000-000000000015');

insert into public.projects (name, status, leader_id, created_by) values
  ('CWR Helper Project 321', 'active',
   '32100000-0000-0000-0000-000000000009',
   '32100000-0000-0000-0000-000000000001');

-- An archived Project, same lead, to pin the level>=6 override's boundary.
insert into public.projects (name, status, leader_id, created_by) values
  ('CWR Archived Project 321', 'archived',
   '32100000-0000-0000-0000-000000000009',
   '32100000-0000-0000-0000-000000000001');

insert into public.project_members (project_id, member_id, project_role)
select project.id, '32100000-0000-0000-0000-000000000010', 'responsible'
  from public.projects as project
 where project.name = 'CWR Helper Project 321';
insert into public.project_members (project_id, member_id, project_role)
select project.id, '32100000-0000-0000-0000-000000000011', 'member'
  from public.projects as project
 where project.name = 'CWR Helper Project 321';

create temp table fx as
select (select id from public.teams where id = 'cwr-dept-team-321') as dept_team_id,
       (select id from public.teams where id = 'cwr-indep-team-321') as indep_team_id,
       (select id from public.projects where name = 'CWR Helper Project 321') as project_id,
       (select id from public.projects where name = 'CWR Archived Project 321') as archived_project_id,
       999999999::bigint as missing_project_id;
grant select on fx to authenticated;

-- ==================== Department origin ('edu') ====================
select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000001');
select is(private.can_manage_origin('edu', null, null), true, 'BC: manages a Department origin');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000002');
select is(private.can_manage_origin('edu', null, null), true, 'Moderator: manages a Department origin');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000003');
select is(private.can_manage_origin('edu', null, null), true, 'local BCE: manages their own Department origin');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000004');
select is(private.can_manage_origin('edu', null, null), false, 'foreign BCE: cannot manage a Department they do not hold');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000005');
select is(private.can_manage_origin('edu', null, null), false, 'Responsabil: cannot manage a Department origin');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000006');
select is(private.can_manage_origin('edu', null, null), false, 'Voluntar: cannot manage a Department origin');
reset role;

-- Boundary: role, not membership, gates BCE Department authority. Both
-- personas hold a live edu member_departments row (added above) yet
-- neither is bce — dropping the `actor.role = 'bce'` check would flip both
-- of these true.
select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000005');
select is(private.can_manage_origin('edu', null, null), false,
  'Responsabil holding a live edu member_departments row still cannot manage a Department origin (role, not membership, gates BCE authority)');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000006');
select is(private.can_manage_origin('edu', null, null), false,
  'Voluntar holding a live edu member_departments row still cannot manage a Department origin (role, not membership, gates BCE authority)');
reset role;

-- A recently-deactivated BC/BCE can still hold a live JWT (up to jwt_expiry)
-- claiming their old role and level. The live profile row is authoritative.
select pg_temp.test_login('32100000-0000-0000-0000-000000000012', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(private.can_manage_origin('edu', null, null), false,
  'deactivated BC: a stale bc/level-6 JWT does not survive a live inactiv profile');
reset role;

select pg_temp.test_login('32100000-0000-0000-0000-000000000013', jsonb_build_object(
    'member_role', 'bce', 'member_level', 5,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(private.can_manage_origin('edu', null, null), false,
  'deactivated BCE: a stale bce JWT with the right dept_ids does not survive a live inactiv profile');
reset role;

-- Boundary: live member_departments, not the JWT dept_ids claim, gates
-- Department authority. This BCE's edu row has since been deleted, but its
-- JWT (captured before the deletion) still claims dept_ids = ["edu"].
-- Reading the claim instead of the live join would flip this true.
select pg_temp.test_login('32100000-0000-0000-0000-000000000017', jsonb_build_object(
    'member_role', 'bce', 'member_level', 5,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(private.can_manage_origin('edu', null, null), false,
  'revoked BCE: a stale edu dept_ids claim does not survive a deleted member_departments row');
reset role;

-- Boundary: the live profiles/roles join, not auth_level(), gates the
-- level>=6 override. This member's live role is voluntar (demoted), but its
-- JWT (captured before the demotion) still claims bc/level 6. Reading the
-- claim instead of the live join would flip this true for every origin
-- kind — see the Department-Team, Independent-Team, and Project sections
-- below for the same persona against the other three origin kinds.
select pg_temp.test_login('32100000-0000-0000-0000-000000000016', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(private.can_manage_origin('edu', null, null), false,
  'demoted BC: a stale bc/level-6 JWT does not survive a live voluntar profile, for a Department origin');
reset role;

-- A real auth uid with an active profile, but a JWT that never received
-- organisation claims at all (house rule 12: auth.uid() alone is not enough).
select pg_temp.test_login('32100000-0000-0000-0000-000000000014',
  jsonb_build_object('provider', 'email'));
select is(private.can_manage_origin('edu', null, null), false,
  'claimless active member: no organisation claims means no origin authority');
reset role;

select pg_temp.test_clear_jwt();
set local role authenticated;
select is(private.can_manage_origin('edu', null, null), false,
  'no JWT at all: fails closed');
reset role;

-- ==================== Department-Team origin (parent dept 'edu') ====================
select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000001');
select is(private.can_manage_origin(null, (select dept_team_id from fx), null), true,
  'BC: manages a Department-Team origin');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000002');
select is(private.can_manage_origin(null, (select dept_team_id from fx), null), true,
  'Moderator: manages a Department-Team origin');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000003');
select is(private.can_manage_origin(null, (select dept_team_id from fx), null), true,
  'local BCE: manages a Department-Team origin via its parent Department');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000004');
select is(private.can_manage_origin(null, (select dept_team_id from fx), null), false,
  'foreign BCE: the Team''s parent Department is not theirs');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000006');
select is(private.can_manage_origin(null, (select dept_team_id from fx), null), false,
  'Voluntar: cannot manage a Department-Team origin');
reset role;

-- Same boundary as the Department section: role, not membership, gates the
-- BCE test against the Team's parent Department.
select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000005');
select is(private.can_manage_origin(null, (select dept_team_id from fx), null), false,
  'Responsabil holding a live edu member_departments row still cannot manage its Department Team');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000006');
select is(private.can_manage_origin(null, (select dept_team_id from fx), null), false,
  'Voluntar holding a live edu member_departments row still cannot manage its Department Team');
reset role;

-- Boundary: `team.dept_id is null` scopes the Independent-Team branch to
-- Independent Teams only. This persona has a live team_members row on a
-- Department Team (added to fixtures above) — dropping that guard from the
-- Independent-Team branch would let plain membership on ANY team, including
-- a Department Team, satisfy it.
select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000015');
select is(private.can_manage_origin(null, (select dept_team_id from fx), null), false,
  'a plain team_members row on a Department Team grants no authority (the Independent-Team branch requires team.dept_id is null)');
reset role;

select pg_temp.test_login('32100000-0000-0000-0000-000000000013', jsonb_build_object(
    'member_role', 'bce', 'member_level', 5,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(private.can_manage_origin(null, (select dept_team_id from fx), null), false,
  'deactivated BCE: stale claims do not survive a live inactiv profile for a Department-Team origin either');
reset role;

select pg_temp.test_login('32100000-0000-0000-0000-000000000017', jsonb_build_object(
    'member_role', 'bce', 'member_level', 5,
    'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(private.can_manage_origin(null, (select dept_team_id from fx), null), false,
  'revoked BCE: a stale edu dept_ids claim does not survive a deleted member_departments row, for a Department-Team origin either');
reset role;

select pg_temp.test_login('32100000-0000-0000-0000-000000000016', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(private.can_manage_origin(null, (select dept_team_id from fx), null), false,
  'demoted BC: a stale bc/level-6 JWT does not survive a live voluntar profile, for a Department-Team origin');
reset role;

-- ==================== Independent-Team origin ====================
select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000001');
select is(private.can_manage_origin(null, (select indep_team_id from fx), null), true,
  'BC: manages an Independent-Team origin');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000002');
select is(private.can_manage_origin(null, (select indep_team_id from fx), null), true,
  'Moderator: manages an Independent-Team origin');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000007');
select is(private.can_manage_origin(null, (select indep_team_id from fx), null), true,
  'independent-team member: manages their own Independent-Team origin');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000008');
select is(private.can_manage_origin(null, (select indep_team_id from fx), null), false,
  'independent-team non-member: no relationship, no authority');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000003');
select is(private.can_manage_origin(null, (select indep_team_id from fx), null), false,
  'local BCE: being BCE somewhere does not grant Independent-Team authority');
reset role;

select pg_temp.test_login('32100000-0000-0000-0000-000000000012', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(private.can_manage_origin(null, (select indep_team_id from fx), null), false,
  'deactivated BC: stale bc/level-6 claims do not survive a live inactiv profile for an Independent-Team origin');
reset role;

-- Boundary: a live team_members row, not a JWT team_ids claim, gates
-- Independent-Team authority. This Outsider was never removed via a real
-- row here (it never had one) but its JWT is built explicitly to claim
-- team_ids containing this Team, as if captured before a removal — the
-- predicate does not read team_ids at all, so this must stay false.
select pg_temp.test_login('32100000-0000-0000-0000-000000000008', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb,
    'team_ids', jsonb_build_array((select indep_team_id from fx))
  ));
select is(private.can_manage_origin(null, (select indep_team_id from fx), null), false,
  'removed independent-team member: a stale team_ids claim does not survive absence from the live team_members row');
reset role;

select pg_temp.test_login('32100000-0000-0000-0000-000000000016', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(private.can_manage_origin(null, (select indep_team_id from fx), null), false,
  'demoted BC: a stale bc/level-6 JWT does not survive a live voluntar profile, for an Independent-Team origin');
reset role;

-- ==================== Project origin ====================
select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000001');
select is(private.can_manage_origin(null, null, (select project_id from fx)), true,
  'BC: manages a Project origin via can_manage_project_work');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000002');
select is(private.can_manage_origin(null, null, (select project_id from fx)), true,
  'Moderator: manages a Project origin via can_manage_project_work');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000009');
select is(private.can_manage_origin(null, null, (select project_id from fx)), true,
  'project lead: manages their own Project origin');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000010');
select is(private.can_manage_origin(null, null, (select project_id from fx)), true,
  'project Responsible: manages the Project origin');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000011');
select is(private.can_manage_origin(null, null, (select project_id from fx)), false,
  'plain project member: cannot manage the Project origin');
reset role;

select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000008');
select is(private.can_manage_origin(null, null, (select project_id from fx)), false,
  'project non-member: cannot manage the Project origin');
reset role;

select pg_temp.test_login('32100000-0000-0000-0000-000000000012', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(private.can_manage_origin(null, null, (select project_id from fx)), false,
  'deactivated BC: stale claims do not survive a live inactiv profile for a Project origin');
reset role;

select pg_temp.test_login('32100000-0000-0000-0000-000000000016', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(private.can_manage_origin(null, null, (select project_id from fx)), false,
  'demoted BC: a stale bc/level-6 JWT does not survive a live voluntar profile, for a Project origin (can_manage_project_work reads the live role too)');
reset role;

-- BC's level>=6 override does not depend on the Project actually existing
-- (num_nonnulls only requires the argument to be non-null), so this uses the
-- lead persona instead: they qualify only through can_manage_project_work,
-- which does look the Project up and must fail closed when it is missing.
select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000009');
select is(private.can_manage_origin(null, null, (select missing_project_id from fx)), false,
  'project lead: a missing Project fails closed');
reset role;

-- Pin the level>=6 short-circuit's own boundary: it is unconditional once
-- num_nonnulls passes, so it does not notice an archived Project either —
-- unlike the lead/Responsible path just above, which routes entirely
-- through private.can_manage_project_work and its `project.status =
-- 'active'` requirement. The lead and every Responsible lose management
-- authority the moment a Project archives; BC/Moderator's global override
-- does not.
select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000001');
select is(private.can_manage_origin(null, null, (select archived_project_id from fx)), true,
  'BC: the level>=6 override reaches an archived Project too (unlike the lead/Responsible path, which requires an active Project)');
reset role;

-- ==================== Origin arity: exactly one, or false ====================
select pg_temp.test_login_leadership('32100000-0000-0000-0000-000000000001');
select is(private.can_manage_origin('edu', (select dept_team_id from fx), null), false,
  'BC: two named Origins is false even though BC would otherwise qualify for either');
select is(private.can_manage_origin('edu', (select dept_team_id from fx), (select project_id from fx)), false,
  'BC: three named Origins is false');
select is(private.can_manage_origin(null, null, null), false,
  'BC: no named Origin is false');
reset role;

-- ==================== anon: no execute grant at all ====================
set local role anon;
select throws_ok(
  $$ select private.can_manage_origin('edu', null, null) $$,
  '42501', null,
  'anon cannot execute can_manage_origin');
reset role;

select * from finish();
rollback;
