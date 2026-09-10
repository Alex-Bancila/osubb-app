-- #278: BC/Moderator membership commands for Independent Teams.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(42);

create function pg_temp.login(uid uuid, claimed_role text, claimed_level int)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', uid, 'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'member_role', claimed_role, 'member_level', claimed_level,
      'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb))::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

insert into auth.users (id, email) values
  ('a2780000-0000-0000-0000-000000000001', 'bc.team@test.local'),
  ('a2780000-0000-0000-0000-000000000002', 'target.team@test.local'),
  ('a2780000-0000-0000-0000-000000000003', 'moderator.team@test.local'),
  ('a2780000-0000-0000-0000-000000000004', 'second.target.team@test.local'),
  ('a2780000-0000-0000-0000-000000000005', 'bce.team@test.local'),
  ('a2780000-0000-0000-0000-000000000006', 'responsabil.team@test.local'),
  ('a2780000-0000-0000-0000-000000000007', 'inactive.bc.team@test.local'),
  ('a2780000-0000-0000-0000-000000000008', 'inactive.target.team@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('a2780000-0000-0000-0000-000000000001', 'BC Team', 'bc.team@test.local', 'bc', 'activ'),
  ('a2780000-0000-0000-0000-000000000002', 'Target Team', 'target.team@test.local', 'voluntar', 'activ'),
  ('a2780000-0000-0000-0000-000000000003', 'Moderator Team', 'moderator.team@test.local', 'moderator', 'activ'),
  ('a2780000-0000-0000-0000-000000000004', 'Second Target Team', 'second.target.team@test.local', 'recrut', 'activ'),
  ('a2780000-0000-0000-0000-000000000005', 'BCE Team', 'bce.team@test.local', 'bce', 'activ'),
  ('a2780000-0000-0000-0000-000000000006', 'Responsabil Team', 'responsabil.team@test.local', 'responsabil', 'activ'),
  ('a2780000-0000-0000-0000-000000000007', 'Inactive BC Team', 'inactive.bc.team@test.local', 'bc', 'inactiv'),
  ('a2780000-0000-0000-0000-000000000008', 'Inactive Target Team', 'inactive.target.team@test.local', 'voluntar', 'inactiv');

insert into public.teams (id, name, dept_id) values
  ('independent-team-278', 'Independent Team #278', null),
  ('department-team-278', 'Department Team #278', 'edu');

-- API and least-privilege boundary.
select has_function('public', 'add_independent_team_member', array['text', 'uuid'],
  'add_independent_team_member(text, uuid) exists');
select has_function('public', 'remove_independent_team_member', array['text', 'uuid'],
  'remove_independent_team_member(text, uuid) exists');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('add_independent_team_member', 'remove_independent_team_member')
    and pg_get_function_identity_arguments(p.oid) = 'p_team_id text, p_member_id uuid'),
  2::bigint, 'both commands expose only Team and Member ids');
select is((select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='add_independent_team_member'),
  'team_members', 'add returns the membership');
select is((select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='remove_independent_team_member'),
  'boolean', 'remove returns whether a row existed');
select ok(coalesce((select bool_and(not p.prosecdef) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('add_independent_team_member','remove_independent_team_member')), false),
  'public commands are security-invoker wrappers');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname in ('require_independent_team_membership_manager',
    'add_independent_team_member_impl','remove_independent_team_member_impl') and p.prosecdef),
  3::bigint, 'private authorization and mutations run as owner');
select ok(coalesce((select bool_and('search_path=""'=any(p.proconfig)) from pg_proc p
  where p.proname in ('require_independent_team_membership_manager','add_independent_team_member_impl',
    'remove_independent_team_member_impl','add_independent_team_member','remove_independent_team_member')), false),
  'every command function has an empty search_path');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('add_independent_team_member','remove_independent_team_member')
    and has_function_privilege('authenticated',p.oid,'execute')), 2::bigint,
  'authenticated can execute both public commands');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('add_independent_team_member','remove_independent_team_member')
    and has_function_privilege('anon',p.oid,'execute')), 0::bigint,
  'anonymous cannot execute the public commands');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname in ('require_independent_team_membership_manager',
    'add_independent_team_member_impl','remove_independent_team_member_impl')
    and has_function_privilege('authenticated',p.oid,'execute')), 2::bigint,
  'authenticated can reach only the private implementations');
select ok(not has_table_privilege('authenticated','public.team_members','INSERT, UPDATE, DELETE')
  and has_table_privilege('service_role','public.team_members','INSERT')
  and has_table_privilege('service_role','public.team_members','UPDATE')
  and has_table_privilege('service_role','public.team_members','DELETE'),
  'direct roster mutation is revoked while trusted provisioning remains');
select ok(has_table_privilege('authenticated','public.teams','SELECT')
  and has_table_privilege('authenticated','public.teams','INSERT')
  and not has_table_privilege('authenticated','public.teams','UPDATE, DELETE'),
  'Team reads and creation remain while update and delete are withheld');

-- Authorized idempotent behavior.
select pg_temp.login('a2780000-0000-0000-0000-000000000001','bc',6);
select is((select format('%s:%s',m.team_id,m.member_id) from public.add_independent_team_member(
  'independent-team-278','a2780000-0000-0000-0000-000000000002') m),
  'independent-team-278:a2780000-0000-0000-0000-000000000002',
  'BC adds an active Member and receives the stored membership');
select is((select count(*) from public.team_members where team_id='independent-team-278'
  and member_id='a2780000-0000-0000-0000-000000000002'), 1::bigint,
  'the command stores one membership');
select is((select m.member_id from public.add_independent_team_member(
  'independent-team-278','a2780000-0000-0000-0000-000000000002') m),
  'a2780000-0000-0000-0000-000000000002'::uuid,
  'a duplicate add returns the existing membership');
select is((select count(*) from public.team_members where team_id='independent-team-278'
  and member_id='a2780000-0000-0000-0000-000000000002'), 1::bigint,
  'a duplicate add stores exactly one row');
reset role;

select pg_temp.login('a2780000-0000-0000-0000-000000000003','moderator',7);
select is((select m.member_id from public.add_independent_team_member(
  'independent-team-278','a2780000-0000-0000-0000-000000000004') m),
  'a2780000-0000-0000-0000-000000000004'::uuid, 'Moderator adds a Member');
select is(public.remove_independent_team_member('independent-team-278',
  'a2780000-0000-0000-0000-000000000004'), true, 'Moderator removes a membership');
select is(public.remove_independent_team_member('independent-team-278',
  'a2780000-0000-0000-0000-000000000004'), false, 'duplicate removal is a stable no-op');
reset role;

-- Scope, targets, and live authorization.
select pg_temp.login('a2780000-0000-0000-0000-000000000001','bc',6);
select throws_ok($$select public.add_independent_team_member('department-team-278',
  'a2780000-0000-0000-0000-000000000004')$$, 'PT400','independent_team_required',
  'Department Teams are rejected');
select throws_ok($$select public.add_independent_team_member('missing-team-278',
  'a2780000-0000-0000-0000-000000000004')$$, 'PT404','team_not_found','unknown Teams are rejected');
select throws_ok($$select public.add_independent_team_member('independent-team-278',
  'a2780000-0000-0000-0000-000000000008')$$, 'PT400','team_member_not_eligible',
  'inactive targets are rejected');
select throws_ok($$select public.add_independent_team_member('independent-team-278',
  'a2780000-0000-0000-0000-000000009999')$$, 'PT400','team_member_not_eligible',
  'unknown targets are rejected without leaking a foreign-key error');
select throws_ok($$select public.remove_independent_team_member('department-team-278',
  'a2780000-0000-0000-0000-000000000002')$$, 'PT400','independent_team_required',
  'remove also rejects Department Teams');
select is(public.remove_independent_team_member('independent-team-278',
  'a2780000-0000-0000-0000-000000000002'), true,
  'BC removes an existing Independent-Team membership');
select is((select m.member_id from public.add_independent_team_member('independent-team-278',
  'a2780000-0000-0000-0000-000000000002') m),
  'a2780000-0000-0000-0000-000000000002'::uuid,
  'BC restores the fixture membership for denial tests');
reset role;
select pg_temp.login('a2780000-0000-0000-0000-000000000005','bc',6);
select throws_ok($$select public.add_independent_team_member('independent-team-278',
  'a2780000-0000-0000-0000-000000000004')$$, '42501','independent_team_membership_forbidden',
  'forged BC claims do not elevate a live BCE');
select throws_ok($$select public.remove_independent_team_member('independent-team-278',
  'a2780000-0000-0000-0000-000000000002')$$, '42501','independent_team_membership_forbidden',
  'BCE cannot remove an Independent-Team member');
reset role;
select pg_temp.login('a2780000-0000-0000-0000-000000000006','responsabil',4);
select throws_ok($$select public.add_independent_team_member('independent-team-278',
  'a2780000-0000-0000-0000-000000000004')$$, '42501','independent_team_membership_forbidden',
  'roles below BCE are denied');
reset role;
select pg_temp.login('a2780000-0000-0000-0000-000000000007','bc',6);
select throws_ok($$select public.add_independent_team_member('independent-team-278',
  'a2780000-0000-0000-0000-000000000004')$$, '42501','independent_team_membership_forbidden',
  'inactive BC is denied despite stale claims');
select throws_ok($$select public.remove_independent_team_member('independent-team-278',
  'a2780000-0000-0000-0000-000000000002')$$, '42501','independent_team_membership_forbidden',
  'inactive BC cannot remove a member');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub','a2780000-0000-0000-0000-000000000001',
  'role','authenticated','app_metadata',jsonb_build_object('provider','email'))::text,true);
set local role authenticated;
select throws_ok($$select public.add_independent_team_member('independent-team-278',
  'a2780000-0000-0000-0000-000000000004')$$, '42501','independent_team_membership_forbidden',
  'claimless sessions are denied');
select throws_ok($$select public.remove_independent_team_member('independent-team-278',
  'a2780000-0000-0000-0000-000000000002')$$, '42501','independent_team_membership_forbidden',
  'claimless sessions cannot remove a member');
reset role;

-- Direct-write and scope-reclassification bypasses.
select pg_temp.login('a2780000-0000-0000-0000-000000000005','bce',5);
select throws_ok($$insert into public.team_members values
  ('independent-team-278','a2780000-0000-0000-0000-000000000004')$$,
  '42501',null,'authenticated cannot bypass add through the table');
select throws_ok($$update public.team_members
  set member_id='a2780000-0000-0000-0000-000000000004'
  where team_id='independent-team-278'
    and member_id='a2780000-0000-0000-0000-000000000002'$$,
  '42501',null,'authenticated cannot bypass replacement through the table');
select throws_ok($$delete from public.team_members
  where team_id='independent-team-278'
    and member_id='a2780000-0000-0000-0000-000000000002'$$,
  '42501',null,'authenticated cannot bypass removal through the table');
select throws_ok($$update public.teams set dept_id='edu' where id='independent-team-278'$$,
  '42501',null,'authenticated cannot reclassify an Independent Team');
select throws_ok($$delete from public.teams where id='independent-team-278'$$,
  '42501',null,'authenticated cannot cascade-delete a Team roster');
reset role;
select is((select array_agg(member_id order by member_id) from public.team_members
  where team_id='independent-team-278'),
  array['a2780000-0000-0000-0000-000000000002'::uuid],
  'rejected commands and bypasses leave the roster unchanged');

set local role anon;
select throws_ok($$select public.add_independent_team_member('independent-team-278',
  'a2780000-0000-0000-0000-000000000004')$$, '42501',null,
  'anonymous cannot execute add');
select throws_ok($$select public.remove_independent_team_member('independent-team-278',
  'a2780000-0000-0000-0000-000000000002')$$, '42501',null,
  'anonymous cannot execute remove');
reset role;

select * from finish();
rollback;
