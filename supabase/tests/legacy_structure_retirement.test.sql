-- #585: removal is the feature; dropping the migration must fail this suite.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(7);

select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname = any(array[
    'create_project','archive_project','add_project_member','remove_project_member',
    'grant_project_responsible','revoke_project_responsible',
    'add_department_team_member','remove_department_team_member',
    'add_independent_team_member','remove_independent_team_member'])),
  0::bigint, 'all ten legacy structure commands are absent');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname = any(array[
    'create_project_impl','archive_project_impl','add_project_member_impl',
    'remove_project_member_impl','grant_project_responsible_impl',
    'revoke_project_responsible_impl','add_department_team_member_impl',
    'remove_department_team_member_impl','add_independent_team_member_impl',
    'remove_independent_team_member_impl','require_project_admin',
    'require_active_project_lead','require_department_team_membership_manager',
    'require_independent_team_membership_manager','can_administer_team_structure',
    'is_project_lead','is_project_responsible','can_manage_project_work',
    'validate_project_manager_state','sync_project_leader_membership',
    'validate_project_membership_change','protect_project_leader_membership',
    'protect_active_project_manager_deactivation'])),
  0::bigint, 'all 23 legacy implementations, gates and trigger functions are absent');
select is((select count(*) from pg_trigger where not tgisinternal
  and tgname = any(array['projects_validate_leader_profile',
    'projects_sync_leader_membership','project_members_validate_manager',
    'project_members_protect_leader','profiles_protect_active_project_managers'])),
  0::bigint, 'the five project-manager triggers are absent');
select is((select count(*) from pg_policies
  where schemaname='public' and tablename='teams' and policyname='teams_create'),
  0::bigint, 'the legacy Team creation policy is absent');
select ok((select count(*)=4 and bool_and(has_function_privilege('authenticated',p.oid,'execute'))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in
    ('create_group','set_group_role','add_group_member','remove_group_member')),
  'the replacement Group commands remain callable');

select is((select count(*) from information_schema.tables where table_schema='public'
  and table_name in ('departments','teams','projects','member_departments','team_members','project_members')),
  0::bigint, 'all six legacy structure tables are absent');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname in ('can_read_team','is_active_project_member','can_manage_department_memberships')),
  0::bigint, 'the three remaining compatibility predicates are absent');
select * from finish();
rollback;
