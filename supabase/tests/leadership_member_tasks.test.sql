begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(17);

select has_function('public', 'leadership_member_tasks', array['uuid'], 'leadership drill-down is a public RPC');
select function_returns('public', 'leadership_member_tasks', array['uuid'], 'setof record', 'drill-down returns records');
select ok(has_function_privilege('authenticated', 'public.leadership_member_tasks(uuid)', 'EXECUTE'), 'authenticated may call the gated RPC');
select ok(not has_function_privilege('anon', 'public.leadership_member_tasks(uuid)', 'EXECUTE'), 'anon cannot call the RPC');
select ok(not has_function_privilege('service_role', 'public.leadership_member_tasks(uuid)', 'EXECUTE'), 'server role has no BCE+ bypass');

insert into auth.users (id, email) values
  ('26000000-0000-0000-0000-000000000001', 'bce260@example.test'),
  ('26000000-0000-0000-0000-000000000002', 'target260@example.test'),
  ('26000000-0000-0000-0000-000000000003', 'ordinary260@example.test'),
  ('26000000-0000-0000-0000-000000000004', 'inactive260@example.test');
insert into public.profiles (id, full_name, email, role, status) values
  ('26000000-0000-0000-0000-000000000001', 'BCE 260', 'bce260@example.test', 'bce', 'activ'),
  ('26000000-0000-0000-0000-000000000002', 'Target 260', 'target260@example.test', 'activ', 'activ'),
  ('26000000-0000-0000-0000-000000000003', 'Ordinary 260', 'ordinary260@example.test', 'activ', 'activ'),
  ('26000000-0000-0000-0000-000000000004', 'Inactive BCE 260', 'inactive260@example.test', 'bce', 'inactiv');

insert into public.campaigns (department_id, name, created_by) values
  ('edu', 'Campaign 260', '26000000-0000-0000-0000-000000000001');
insert into public.tasks
  (title, description, deadline, dept_id, kind, audience, assignment_mode, difficulty, rating, created_by)
values
  ('Umbrella 260', 'Parent details 260', now() + interval '2 days', 'edu', 'umbrella', null, null, null, null,
   '26000000-0000-0000-0000-000000000001');
insert into public.tasks
  (title, description, deadline, dept_id, campaign_id, status, difficulty, rating,
   created_by, created_at, started_at, submitted_at, unfulfilled_at, parent_task_id)
select 'Historical Subtask 260', 'Full details 260', now() - interval '2 days', 'edu', campaign.id,
       'unfulfilled', 2, 1, '26000000-0000-0000-0000-000000000001', now() - interval '5 days',
       now() - interval '4 days', now() - interval '3 days', now() - interval '1 day', parent.id
  from public.campaigns as campaign
  cross join public.tasks as parent
 where campaign.name = 'Campaign 260' and parent.title = 'Umbrella 260';
insert into public.task_assignments
  (task_id, member_id, assigned_by, assigned_at, ended_at, end_reason, end_note)
select id, '26000000-0000-0000-0000-000000000002', '26000000-0000-0000-0000-000000000001',
       now() - interval '4 days', now() - interval '1 day', 'failed', 'Preserved end note 260'
  from public.tasks where title = 'Historical Subtask 260';
insert into public.task_evaluations
  (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note, evaluated_at,
   reversed_at, reversed_by, reversal_reason)
select task.id, assignment.id, '26000000-0000-0000-0000-000000000001', 'unfulfilled', 2, 1, -2,
       'Evaluation note 260', now() - interval '1 day', now() - interval '12 hours',
       '26000000-0000-0000-0000-000000000001', 'Reopened briefly 260'
  from public.tasks as task
  join public.task_assignments as assignment on assignment.task_id = task.id
 where task.title = 'Historical Subtask 260';

select pg_temp.test_login_leadership('26000000-0000-0000-0000-000000000001');
select is((select count(*) from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 1::bigint,
  'BCE sees the selected Member historical Assignment without current Origin membership');
select is((select origin_type from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 'department',
  'Task Origin is explicit');
select is((select campaign_name from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 'Campaign 260',
  'Campaign details are exposed');
select is((select parent_task_title from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 'Umbrella 260',
  'the Subtask identifies its parent Umbrella');
select is((select status::text from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 'unfulfilled',
  'unfulfilled is retained as the outcome state');
select is((select completed_late from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), false,
  'an unfulfilled outcome is not mislabeled as completed late');
select is((select evaluation_history -> 0 ->> 'note' from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 'Evaluation note 260',
  'Evaluation and reversal history is present');

select pg_temp.test_login_leadership('26000000-0000-0000-0000-000000000003');
select is((select count(*) from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 0::bigint,
  'ordinary Member cannot inspect someone else');
select pg_temp.test_login('26000000-0000-0000-0000-000000000003',
  '{"member_role":"bce","member_level":5,"dept_ids":[],"team_ids":[]}'::jsonb);
select is((select count(*) from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 0::bigint,
  'live demotion defeats stale BCE claims');
select pg_temp.test_login_leadership('26000000-0000-0000-0000-000000000004');
select is((select count(*) from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 0::bigint,
  'inactive BCE sees no protected rows despite stale claims');
select pg_temp.test_login('26000000-0000-0000-0000-000000000001', '{}'::jsonb);
select is((select count(*) from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002')), 0::bigint,
  'claimless caller sees no protected rows');
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select * from public.leadership_member_tasks('26000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'anon has no RPC grant');

select * from finish();
rollback;
