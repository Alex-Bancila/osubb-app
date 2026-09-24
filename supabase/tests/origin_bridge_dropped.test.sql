-- origin_bridge_dropped.test.sql — #579: the legacy Origin bridge and event_scope are gone.
-- The Group is the only Origin a Task, Completed-work Request, Campaign or Event carries.
-- This suite pins the removal itself and the one behaviour it changes on purpose; the
-- per-command and per-table suites carry the rest (create_task, completed_work_requests_schema,
-- campaigns_schema, event_constraints, tasks_umbrella, tasks_campaign, group_commands, ...).
-- The guards' failure paths live in origin_drop_upgrade.test.sh (they need pre-drop rows).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- ==================== The legacy surface is gone ====================
select hasnt_column('public', 'tasks', 'dept_id', 'tasks.dept_id is gone');
select hasnt_column('public', 'tasks', 'team_id', 'tasks.team_id is gone');
select hasnt_column('public', 'tasks', 'project_id', 'tasks.project_id is gone');
select col_not_null('public', 'tasks', 'group_id', 'tasks.group_id is the whole Task Origin');
select fk_ok('public', 'tasks', 'group_id', 'public', 'groups', 'id', 'tasks.group_id references the Group model');

select ok(to_regtype('public.event_scope') is null, 'the event_scope enum is gone (R18)');

select is(
  (select array_agg(p.proname::text order by p.proname)
     from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('group_id_for_legacy_origin', 'can_manage_origin', 'require_origin_manager',
                        'sync_task_group_origin', 'sync_request_group_origin',
                        'sync_campaign_group_origin', 'sync_event_group_origin')),
  null::text[],
  'the resolver, both shims and the four *_sync_group_origin trigger functions are gone');
select ok(not exists (select 1 from pg_trigger
                       where not tgisinternal and tgname like '%sync_group_origin'),
  'no *_sync_group_origin trigger remains on any table');

select is(
  (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
     from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_task', 'create_completed_work_request', 'create_campaign')),
  array['create_campaign(bigint,text)',
        'create_completed_work_request(text,bigint)',
        'create_task(text,text,timestamp with time zone,text,text,uuid,bigint,bigint,text,bigint,text,text)'],
  'exactly one arity each: create_task, create_completed_work_request and create_campaign take a Group id only (no PostgREST overload ambiguity)');

-- ==================== Both validators still fire on a Group-only write ====================
select ok(
  (select pg_get_triggerdef(oid) ~ 'BEFORE INSERT OR UPDATE OF [a-z_, ]*(, |OF )group_id(,| ON)'
     from pg_trigger where tgrelid = 'public.tasks'::regclass and tgname = 'tasks_validate_hierarchy'),
  'tasks_validate_hierarchy fires on an UPDATE of group_id');
select ok(
  (select pg_get_triggerdef(oid) ~ 'BEFORE INSERT OR UPDATE OF [a-z_, ]*(, |OF )group_id(,| ON)'
     from pg_trigger where tgrelid = 'public.tasks'::regclass and tgname = 'tasks_validate_campaign'),
  'tasks_validate_campaign fires on an UPDATE of group_id');

-- ==================== Readers keep their shape and grants ====================
select ok((select 'security_invoker=on' = any (reloptions) from pg_class where oid = 'public.tasks_with_overdue'::regclass),
  'tasks_with_overdue is recreated security_invoker');
select ok(has_table_privilege('authenticated', 'public.tasks_with_overdue', 'select')
      and has_table_privilege('service_role', 'public.tasks_with_overdue', 'select')
      and not has_table_privilege('anon', 'public.tasks_with_overdue', 'select'),
  'tasks_with_overdue keeps its grants: authenticated and service_role read, anon does not');
select hasnt_column('public', 'tasks_with_overdue', 'dept_id', 'tasks_with_overdue no longer carries the legacy triple');
select ok((select 'security_invoker=on' = any (reloptions) from pg_class where oid = 'public.dept_cup'::regclass)
      and has_table_privilege('authenticated', 'public.dept_cup', 'select')
      and not has_table_privilege('anon', 'public.dept_cup', 'select'),
  'dept_cup is recreated security_invoker with its grants');
select ok(has_function_privilege('authenticated', 'public.department_cup(bigint, timestamptz, timestamptz)', 'execute')
      and not has_function_privilege('anon', 'public.department_cup(bigint, timestamptz, timestamptz)', 'execute')
      and has_function_privilege('authenticated', 'public.leadership_member_tasks(uuid, timestamptz, timestamptz)', 'execute')
      and not has_function_privilege('anon', 'public.leadership_member_tasks(uuid, timestamptz, timestamptz)', 'execute'),
  'department_cup and leadership_member_tasks keep their grants');
select is(pg_get_function_result('public.department_cup(bigint, timestamptz, timestamptz)'::regprocedure),
  'TABLE(group_id bigint, name text, points integer, members bigint)',
  'department_cup returns (group_id, name, points, members)');

-- ==================== A native Group carries work ====================
-- The bridge refused a Group with no legacy_* mapping (task_group_origin_unmapped). With it
-- gone, a Group created without any legacy master owns Tasks, Requests, Campaigns and Events.
insert into auth.users (id, email) values
  ('57900000-0000-0000-0000-000000000001', 'native.manager.579@test.local'),
  ('57900000-0000-0000-0000-000000000002', 'org.member.579@test.local'),
  ('57900000-0000-0000-0000-000000000003', 'bc.579@test.local');
insert into public.profiles (id, full_name, email, role, status) values
  ('57900000-0000-0000-0000-000000000001', 'Native Manager 579', 'native.manager.579@test.local', 'voluntar', 'activ'),
  ('57900000-0000-0000-0000-000000000002', 'Org Member 579', 'org.member.579@test.local', 'voluntar', 'activ'),
  ('57900000-0000-0000-0000-000000000003', 'BC 579', 'bc.579@test.local', 'bc', 'activ');
-- OD9 fixture exception: a native Group row inside this rolled-back transaction.
insert into public.groups (name, category, path) values ('Native Group 579', 'team', '{}');
insert into public.group_members (group_id, member_id, group_role)
select id, '57900000-0000-0000-0000-000000000001', 'manager' from public.groups where name = 'Native Group 579';

select pg_temp.test_login_leadership('57900000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.create_task('Native work 579', null, now() + interval '3 days', 'local', 'direct',
       p_group_id => (select id from public.groups where name = 'Native Group 579')) $$,
  'the Manager of a native Group creates a Task on it');
select lives_ok(
  $$ select public.create_completed_work_request('Native request 579',
       (select id from public.groups where name = 'Native Group 579')) $$,
  'a member of a native Group files a Request on it');
reset role;
select is((select group_id from public.tasks where title = 'Native work 579'),
  (select id from public.groups where name = 'Native Group 579'),
  'the Task carries exactly the native Group');

-- ==================== The local Audience rule reads the Group (express_task_interest) ====================
-- A local Opportunity admits the members of its own Group: an explicit roster row, or
-- Automatic Membership at or above the Group's Minimum Level (private.is_group_member).
-- The Organization Group has no roster rows -- every active Member belongs automatically --
-- so a local Opportunity there admits a Member the legacy member_departments test never did.
select pg_temp.test_login_leadership('57900000-0000-0000-0000-000000000003');
select lives_ok(
  $$ select public.create_task('Org local opportunity 579', null, now() + interval '3 days', 'local', 'public',
       p_group_id => pg_temp.dept_group('org')) $$,
  'BC opens a local Opportunity on the Organization Group');
reset role;
select pg_temp.test_login_leadership('57900000-0000-0000-0000-000000000002');
select lives_ok(
  $$ select public.express_task_interest((select id from public.tasks where title = 'Org local opportunity 579')) $$,
  'a Member with no roster row joins a local Organization Opportunity through Automatic Membership');
reset role;
select is(
  (select member_id from public.task_candidates
    where task_id = (select id from public.tasks where title = 'Org local opportunity 579') and status = 'pending'),
  '57900000-0000-0000-0000-000000000002'::uuid,
  'and joins its Candidate Queue as a pending Candidate (#682: interest always queues)');
select pg_temp.test_login_leadership('57900000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.express_task_interest((select id from public.tasks where title = 'Native work 579')) $$,
  'PT404', 'task_not_found',
  'a local Task of a Group the Member does not belong to stays hidden from them');
reset role;

select * from finish();
rollback;
