-- completed_work_requests_schema.test.sql — #321: table shape, the
-- pending/approved/rejected constraints, and the read matrix (requester,
-- Origin managers via private.can_manage_origin, and everyone else denied).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(67);

-- ==================== Structure ====================
select has_table('public', 'completed_work_requests', 'the request table exists');
select ok(
  (select relrowsecurity from pg_class
    where oid = 'public.completed_work_requests'::regclass),
  'completed_work_requests enables RLS at birth');

select columns_are(
  'public', 'completed_work_requests',
  array['id', 'requester_id', 'dept_id', 'team_id', 'project_id', 'description',
        'status', 'decided_by', 'decided_at', 'decision_note', 'task_id', 'created_at',
        'group_id'],
  'completed_work_requests exposes exactly the requested fields');
select has_pk('public', 'completed_work_requests', 'a Request has a primary key');
select col_type_is('public', 'completed_work_requests', 'id', 'bigint', 'request id is bigint');
select col_not_null('public', 'completed_work_requests', 'requester_id', 'a Request names its requester');
select fk_ok('public', 'completed_work_requests', 'requester_id', 'public', 'profiles', 'id',
  'requester_id references a Profile');
select fk_ok('public', 'completed_work_requests', 'dept_id', 'public', 'departments', 'id',
  'dept_id references a Department when set');
select fk_ok('public', 'completed_work_requests', 'team_id', 'public', 'teams', 'id',
  'team_id references a Team when set');
select fk_ok('public', 'completed_work_requests', 'project_id', 'public', 'projects', 'id',
  'project_id references a Project when set');
select col_not_null('public', 'completed_work_requests', 'description', 'description is required');
select col_not_null('public', 'completed_work_requests', 'status', 'status is required');
select col_default_is('public', 'completed_work_requests', 'status', 'pending',
  'status defaults to pending');
select fk_ok('public', 'completed_work_requests', 'decided_by', 'public', 'profiles', 'id',
  'decided_by references a Profile when set');
select fk_ok('public', 'completed_work_requests', 'task_id', 'public', 'tasks', 'id',
  'task_id references a Task when set');
select col_not_null('public', 'completed_work_requests', 'created_at', 'created_at is required');
select col_has_default('public', 'completed_work_requests', 'created_at', 'created_at is server-written');
select hasnt_column('public', 'completed_work_requests', 'updated_at',
  'no updated_at — decided_at is the change record for a status that changes once');

select has_index('public', 'completed_work_requests', 'completed_work_requests_requester_idx',
  'requester lookup is indexed');
select has_index('public', 'completed_work_requests', 'completed_work_requests_status_idx',
  'status lookup is indexed');
select has_index('public', 'completed_work_requests', 'completed_work_requests_dept_idx',
  'Department-origin lookup is indexed');
select has_index('public', 'completed_work_requests', 'completed_work_requests_team_idx',
  'Team-origin lookup is indexed');
select has_index('public', 'completed_work_requests', 'completed_work_requests_project_idx',
  'Project-origin lookup is indexed');

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('32105000-0000-0000-0000-000000000001', 'cwrs.requester-dept@test.local'),
  ('32105000-0000-0000-0000-000000000002', 'cwrs.local-bce@test.local'),
  ('32105000-0000-0000-0000-000000000003', 'cwrs.foreign-bce@test.local'),
  ('32105000-0000-0000-0000-000000000004', 'cwrs.stranger@test.local'),
  ('32105000-0000-0000-0000-000000000005', 'cwrs.project-lead@test.local'),
  ('32105000-0000-0000-0000-000000000006', 'cwrs.project-requester@test.local'),
  ('32105000-0000-0000-0000-000000000007', 'cwrs.indep-requester@test.local'),
  ('32105000-0000-0000-0000-000000000008', 'cwrs.indep-fellow@test.local'),
  ('32105000-0000-0000-0000-000000000009', 'cwrs.bc@test.local'),
  ('32105000-0000-0000-0000-000000000010', 'cwrs.moderator@test.local'),
  ('32105000-0000-0000-0000-000000000011', 'cwrs.deactivated-requester@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('32105000-0000-0000-0000-000000000001', 'CWRS Requester', 'cwrs.requester-dept@test.local', 'voluntar', 'activ'),
  ('32105000-0000-0000-0000-000000000002', 'CWRS Local BCE', 'cwrs.local-bce@test.local', 'bce', 'activ'),
  ('32105000-0000-0000-0000-000000000003', 'CWRS Foreign BCE', 'cwrs.foreign-bce@test.local', 'bce', 'activ'),
  ('32105000-0000-0000-0000-000000000004', 'CWRS Stranger', 'cwrs.stranger@test.local', 'voluntar', 'activ'),
  ('32105000-0000-0000-0000-000000000005', 'CWRS Project Lead', 'cwrs.project-lead@test.local', 'voluntar', 'activ'),
  ('32105000-0000-0000-0000-000000000006', 'CWRS Project Requester', 'cwrs.project-requester@test.local', 'voluntar', 'activ'),
  ('32105000-0000-0000-0000-000000000007', 'CWRS Independent Requester', 'cwrs.indep-requester@test.local', 'voluntar', 'activ'),
  ('32105000-0000-0000-0000-000000000008', 'CWRS Independent Fellow', 'cwrs.indep-fellow@test.local', 'voluntar', 'activ'),
  ('32105000-0000-0000-0000-000000000009', 'CWRS BC', 'cwrs.bc@test.local', 'bc', 'activ'),
  ('32105000-0000-0000-0000-000000000010', 'CWRS Moderator', 'cwrs.moderator@test.local', 'moderator', 'activ'),
  ('32105000-0000-0000-0000-000000000011', 'CWRS Deactivated Requester', 'cwrs.deactivated-requester@test.local', 'voluntar', 'inactiv');

insert into public.member_departments (member_id, dept_id) values
  ('32105000-0000-0000-0000-000000000002', 'edu'),
  ('32105000-0000-0000-0000-000000000003', 'pr');

insert into public.teams (id, name, dept_id) values
  ('cwrs-dept-team-321', 'CWRS Department Team', 'edu'),
  ('cwrs-indep-team-321', 'CWRS Independent Team', null);

insert into public.team_members (team_id, member_id) values
  ('cwrs-indep-team-321', '32105000-0000-0000-0000-000000000007'),
  ('cwrs-indep-team-321', '32105000-0000-0000-0000-000000000008');

insert into public.projects (name, status, leader_id, created_by) values
  ('CWRS Schema Project 321', 'active',
   '32105000-0000-0000-0000-000000000005',
   '32105000-0000-0000-0000-000000000005');
insert into public.project_members (project_id, member_id, project_role)
select project.id, '32105000-0000-0000-0000-000000000006', 'member'
  from public.projects as project
 where project.name = 'CWRS Schema Project 321';

insert into public.tasks (title, dept_id)
values ('CWRS schema fixture task 321', 'edu');

create temp table fx as
select
  (select id from public.projects where name = 'CWRS Schema Project 321') as project_id,
  (select id from public.tasks where title = 'CWRS schema fixture task 321') as task_id;
grant select on fx to authenticated;

-- ==================== origin XOR ====================
select throws_ok(
  $$ insert into public.completed_work_requests (requester_id, description)
     values ('32105000-0000-0000-0000-000000000001', 'no origin at all') $$,
  '23514', 'request_group_required',
  'zero Origins is rejected -- private.sync_request_group_origin answers before the Origin XOR check can (#519)');
select throws_ok(
  $$ insert into public.completed_work_requests
       (requester_id, dept_id, team_id, description)
     values ('32105000-0000-0000-0000-000000000001', 'edu', 'cwrs-dept-team-321',
             'two origins at once') $$,
  '23514', null,
  'two Origins at once is rejected');

-- ==================== status vocabulary ====================
select throws_ok(
  $$ insert into public.completed_work_requests
       (requester_id, dept_id, description, status)
     values ('32105000-0000-0000-0000-000000000001', 'edu', 'a request',
             'archived') $$,
  '23514', null,
  'a status outside pending/approved/rejected is rejected');

-- ==================== description must be non-blank ====================
select throws_ok(
  $$ insert into public.completed_work_requests
       (requester_id, dept_id, description)
     values ('32105000-0000-0000-0000-000000000001', 'edu', '   ') $$,
  '23514', null,
  'an all-spaces description is rejected');

-- ==================== pending shape ====================
-- Each case below breaks exactly one clause of the pending shape, so a
-- future edit that drops a single clause is caught by exactly one test.
select throws_ok(
  $$ insert into public.completed_work_requests
       (requester_id, dept_id, description, status, decided_by)
     values ('32105000-0000-0000-0000-000000000001', 'edu', 'a request', 'pending',
             '32105000-0000-0000-0000-000000000002') $$,
  '23514', null,
  'a pending Request already naming a decider is rejected');
select throws_ok(
  $$ insert into public.completed_work_requests
       (requester_id, dept_id, description, status, decided_at)
     values ('32105000-0000-0000-0000-000000000001', 'edu', 'a request', 'pending', now()) $$,
  '23514', null,
  'a pending Request already timestamped as decided is rejected');
select throws_ok(
  $$ insert into public.completed_work_requests
       (requester_id, dept_id, description, status, decision_note)
     values ('32105000-0000-0000-0000-000000000001', 'edu', 'a request', 'pending', 'too early') $$,
  '23514', null,
  'a pending Request already carrying a decision note is rejected');
select throws_ok(
  format($$ insert into public.completed_work_requests
       (requester_id, dept_id, description, status, task_id)
     values ('32105000-0000-0000-0000-000000000001', 'edu', 'a request', 'pending', %s) $$,
    (select task_id from fx)),
  '23514', null,
  'a pending Request already naming a Task is rejected');

-- ==================== approved shape ====================
-- Each case below breaks exactly one clause of the approved shape.
select throws_ok(
  $$ insert into public.completed_work_requests
       (requester_id, dept_id, description, status, decided_by, decided_at)
     values ('32105000-0000-0000-0000-000000000001', 'edu', 'a request', 'approved',
             '32105000-0000-0000-0000-000000000002', now()) $$,
  '23514', null,
  'approved without a created Task is rejected');
select throws_ok(
  format($$ insert into public.completed_work_requests
       (requester_id, dept_id, description, status, decided_at, task_id)
     values ('32105000-0000-0000-0000-000000000001', 'edu', 'a request', 'approved',
             now(), %s) $$,
    (select task_id from fx)),
  '23514', null,
  'approved without a decider (decided_by) is rejected');
select throws_ok(
  format($$ insert into public.completed_work_requests
       (requester_id, dept_id, description, status, decided_by, task_id)
     values ('32105000-0000-0000-0000-000000000001', 'edu', 'a request', 'approved',
             '32105000-0000-0000-0000-000000000002', %s) $$,
    (select task_id from fx)),
  '23514', null,
  'approved without a decision timestamp (decided_at) is rejected');
select throws_ok(
  format($$ insert into public.completed_work_requests
       (requester_id, dept_id, description, status, decided_by, decided_at, decision_note, task_id)
     values ('32105000-0000-0000-0000-000000000001', 'edu', 'a request', 'approved',
             '32105000-0000-0000-0000-000000000002', now(), '   ', %s) $$,
    (select task_id from fx)),
  '23514', null,
  'approved with an all-spaces decision note is rejected');

-- ==================== rejected shape ====================
select throws_ok(
  $$ insert into public.completed_work_requests
       (requester_id, dept_id, description, status, decided_by, decided_at)
     values ('32105000-0000-0000-0000-000000000001', 'edu', 'a request', 'rejected',
             '32105000-0000-0000-0000-000000000002', now()) $$,
  '23514', null,
  'rejected without a note is rejected');
select throws_ok(
  $$ insert into public.completed_work_requests
       (requester_id, dept_id, description, status, decided_by, decided_at, decision_note)
     values ('32105000-0000-0000-0000-000000000001', 'edu', 'a request', 'rejected',
             '32105000-0000-0000-0000-000000000002', now(), '   ') $$,
  '23514', null,
  'rejected with an all-spaces note is rejected');
select throws_ok(
  $$ insert into public.completed_work_requests
       (requester_id, dept_id, description, status, decided_at, decision_note)
     values ('32105000-0000-0000-0000-000000000001', 'edu', 'a request', 'rejected',
             now(), 'not enough evidence') $$,
  '23514', null,
  'rejected without a decider (decided_by) is rejected');
select throws_ok(
  format($$ insert into public.completed_work_requests
       (requester_id, dept_id, description, status, decided_by, decided_at, decision_note, task_id)
     values ('32105000-0000-0000-0000-000000000001', 'edu', 'a request', 'rejected',
             '32105000-0000-0000-0000-000000000002', now(), 'not enough evidence', %s) $$,
    (select task_id from fx)),
  '23514', null,
  'a rejected Request naming a Task is rejected');

-- ==================== chronology ====================
select throws_ok(
  $$ insert into public.completed_work_requests
       (requester_id, dept_id, description, status, decided_by, decided_at,
        decision_note, created_at)
     values ('32105000-0000-0000-0000-000000000001', 'edu', 'a request', 'rejected',
             '32105000-0000-0000-0000-000000000002', now() - interval '1 hour',
             'too early', now()) $$,
  '23514', null,
  'a decision timestamped before the Request was created is rejected');

-- ==================== valid rows, one per status ====================
select lives_ok(
  $$ insert into public.completed_work_requests (requester_id, dept_id, description)
     values ('32105000-0000-0000-0000-000000000001', 'edu', 'CWRS dept fixture request') $$,
  'a valid pending Department Request is recorded');
select lives_ok(
  format($$ insert into public.completed_work_requests
       (requester_id, project_id, description, status, decided_by, decided_at, task_id)
     values ('32105000-0000-0000-0000-000000000006', %s, 'CWRS project fixture request',
             'approved', '32105000-0000-0000-0000-000000000005', now(), %s) $$,
    (select project_id from fx), (select task_id from fx)),
  'a valid approved Project Request is recorded');

-- One approval per Task: a second approved Request cannot reuse the same
-- task_id (completed_work_requests_task_uidx).
select throws_ok(
  format($$ insert into public.completed_work_requests
       (requester_id, dept_id, description, status, decided_by, decided_at, task_id)
     values ('32105000-0000-0000-0000-000000000001', 'edu',
             'a second approved request for the same task',
             'approved', '32105000-0000-0000-0000-000000000002', now(), %s) $$,
    (select task_id from fx)),
  '23505', null,
  'a second approved Request cannot reuse a Task already linked to another approval');

select lives_ok(
  $$ insert into public.completed_work_requests
       (requester_id, team_id, description, status, decided_by, decided_at, decision_note)
     values ('32105000-0000-0000-0000-000000000007', 'cwrs-indep-team-321',
             'CWRS independent-team fixture request', 'rejected',
             '32105000-0000-0000-0000-000000000008', now(), 'not enough evidence') $$,
  'a valid rejected Independent-Team Request is recorded');

-- A pending Request from a requester who has since been deactivated. Rows
-- like this can exist even though the requester could not create one today.
insert into public.completed_work_requests (requester_id, dept_id, description)
  values ('32105000-0000-0000-0000-000000000011', 'edu',
          'CWRS deactivated-requester fixture request');

create temp table fx2 as
select
  (select id from public.completed_work_requests where description = 'CWRS dept fixture request') as dept_request_id,
  (select id from public.completed_work_requests where description = 'CWRS project fixture request') as project_request_id,
  (select id from public.completed_work_requests where description = 'CWRS independent-team fixture request') as indep_request_id,
  (select id from public.completed_work_requests where description = 'CWRS deactivated-requester fixture request') as deactivated_request_id;
grant select on fx2 to authenticated;

-- ==================== Read matrix: Department-origin request ====================
select pg_temp.test_login_leadership('32105000-0000-0000-0000-000000000001');
select is(
  (select count(*) from public.completed_work_requests where id = (select dept_request_id from fx2)),
  1::bigint, 'requester: reads their own Department Request');
reset role;

select pg_temp.test_login_leadership('32105000-0000-0000-0000-000000000002');
select is(
  (select count(*) from public.completed_work_requests where id = (select dept_request_id from fx2)),
  1::bigint, 'local BCE: reads a Request against their own Department');
reset role;

select pg_temp.test_login_leadership('32105000-0000-0000-0000-000000000003');
select is(
  (select count(*) from public.completed_work_requests where id = (select dept_request_id from fx2)),
  0::bigint, 'foreign BCE: cannot read a Request against a Department they do not hold');
reset role;

select pg_temp.test_login_leadership('32105000-0000-0000-0000-000000000004');
select is(
  (select count(*) from public.completed_work_requests where id = (select dept_request_id from fx2)),
  0::bigint, 'stranger: cannot read someone else''s Department Request');
reset role;

-- The requester's own real uid and active profile, but a JWT with no
-- organisation claims at all — house rule 12: not even self-access survives.
select pg_temp.test_login('32105000-0000-0000-0000-000000000001',
  jsonb_build_object('provider', 'email'));
select is(
  (select count(*) from public.completed_work_requests where id = (select dept_request_id from fx2)),
  0::bigint, 'claimless requester: no organisation claims means no read access, even to their own Request');
reset role;

-- ==================== Read matrix: Project-origin request ====================
select pg_temp.test_login_leadership('32105000-0000-0000-0000-000000000005');
select is(
  (select count(*) from public.completed_work_requests where id = (select project_request_id from fx2)),
  1::bigint, 'project lead: reads a Request against their Project');
reset role;

select pg_temp.test_login_leadership('32105000-0000-0000-0000-000000000004');
select is(
  (select count(*) from public.completed_work_requests where id = (select project_request_id from fx2)),
  0::bigint, 'stranger: cannot read a Project Request for a Project they do not belong to');
reset role;

-- ==================== Read matrix: Independent-Team-origin request ====================
select pg_temp.test_login_leadership('32105000-0000-0000-0000-000000000008');
select is(
  (select count(*) from public.completed_work_requests where id = (select indep_request_id from fx2)),
  1::bigint, 'fellow independent-team member: reads a teammate''s Request, not only their own');
reset role;

select pg_temp.test_login_leadership('32105000-0000-0000-0000-000000000004');
select is(
  (select count(*) from public.completed_work_requests where id = (select indep_request_id from fx2)),
  0::bigint, 'stranger: cannot read an Independent-Team Request for a Team they do not belong to');
reset role;

-- ==================== Read matrix: BC / Moderator global read ====================
select pg_temp.test_login_leadership('32105000-0000-0000-0000-000000000009');
select is(
  (select count(*) from public.completed_work_requests where id = (select dept_request_id from fx2)),
  1::bigint, 'BC: reads any Request via the global level>=6 override');
reset role;

select pg_temp.test_login_leadership('32105000-0000-0000-0000-000000000010');
select is(
  (select count(*) from public.completed_work_requests where id = (select indep_request_id from fx2)),
  1::bigint, 'Moderator: reads any Request via the global level>=6 override');
reset role;

-- ==================== Read matrix: deactivated requester ====================
-- Live status, not just a live JWT, gates even a requester's read of their
-- own Request (house rule 12; ledger_read precedent). The claims below are
-- exactly what this member held while still active.
select pg_temp.test_login('32105000-0000-0000-0000-000000000011', jsonb_build_object(
    'member_role', 'voluntar', 'member_level', 1,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb
  ));
select is(
  (select count(*) from public.completed_work_requests where id = (select deactivated_request_id from fx2)),
  0::bigint, 'deactivated requester: a stale voluntar JWT does not survive a live inactiv profile, even for their own Request');
reset role;

-- ==================== anon: no table grant at all ====================
set local role anon;
select throws_ok(
  $$ select count(*) from public.completed_work_requests $$,
  '42501', null,
  'anon has no table grant on completed_work_requests');
reset role;

-- ==================== Grants: commands, not clients, write this table (#344) ====================
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'completed_work_requests'),
  1::bigint, 'exactly one policy exists: completed_work_requests_read');

select is(has_table_privilege('authenticated', 'public.completed_work_requests', 'SELECT'), true,
  'authenticated holds the SELECT grant — the read policy does the row filtering');
select is(has_table_privilege('authenticated', 'public.completed_work_requests', 'INSERT'), false,
  'authenticated cannot insert a Request directly (commands only, #344)');
select is(has_table_privilege('authenticated', 'public.completed_work_requests', 'UPDATE'), false,
  'authenticated cannot update a Request directly');
select is(has_table_privilege('authenticated', 'public.completed_work_requests', 'DELETE'), false,
  'authenticated cannot delete a Request directly');
select is(has_sequence_privilege('authenticated', 'public.completed_work_requests_id_seq', 'USAGE'), false,
  'authenticated cannot allocate request ids');

select is(has_table_privilege('service_role', 'public.completed_work_requests', 'SELECT'), true,
  'service_role can read completed_work_requests directly');
select is(has_table_privilege('service_role', 'public.completed_work_requests', 'INSERT'), false,
  'service_role cannot insert directly — commands run as the table owner, not service_role');
select is(has_table_privilege('service_role', 'public.completed_work_requests', 'UPDATE'), false,
  'service_role cannot update completed_work_requests directly');
select is(has_table_privilege('service_role', 'public.completed_work_requests', 'DELETE'), false,
  'service_role cannot delete from completed_work_requests directly');

select * from finish();
rollback;
