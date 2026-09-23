-- #335: public.return_task_to_progress -- a Reviewer sends in_review work back
-- to in_progress with a note, incrementing the review round. This is the
-- first command in the wave gated on EVALUATOR authority
-- (private.require_task_evaluator) rather than manager or Executor
-- authority, so the persona matrix is the point of this suite (ADR-0007 Sec
-- Authorization draws the evaluator boundary more finely than the manager
-- one, and private.can_evaluate_task is what encodes it -- create_task.test.sql
-- section 10 already pins can_evaluate_task itself; this suite pins the same
-- boundary through the real command, mutating real Task rows).
--
-- Fixture prefix 33500000-0000-0000-0000-0000000000NN throughout, resolved
-- as the owner into a temp table before any persona logs in (the #328 trap,
-- stack-context.md carry-forwards).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(79);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('33500000-0000-0000-0000-000000000001', 'bc.335@test.local'),
  ('33500000-0000-0000-0000-000000000002', 'bce.edu.335@test.local'),
  ('33500000-0000-0000-0000-000000000003', 'bce.pr.335@test.local'),
  ('33500000-0000-0000-0000-000000000004', 'exec.happy.335@test.local'),
  ('33500000-0000-0000-0000-000000000005', 'exec.p1.335@test.local'),
  ('33500000-0000-0000-0000-000000000006', 'exec.p2.335@test.local'),
  ('33500000-0000-0000-0000-000000000007', 'exec.gate.335@test.local'),
  ('33500000-0000-0000-0000-000000000008', 'ind.team.335@test.local'),
  ('33500000-0000-0000-0000-000000000009', 'proj.lead.335@test.local'),
  ('33500000-0000-0000-0000-000000000010', 'proj.responsible.335@test.local'),
  ('33500000-0000-0000-0000-000000000011', 'proj.member.335@test.local'),
  ('33500000-0000-0000-0000-000000000012', 'inactive.bc.335@test.local'),
  ('33500000-0000-0000-0000-000000000013', 'claimless.335@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('33500000-0000-0000-0000-000000000001', 'BC 335', 'bc.335@test.local', 'bc', 'activ'),
  ('33500000-0000-0000-0000-000000000002', 'BCE EDU 335', 'bce.edu.335@test.local', 'bce', 'activ'),
  ('33500000-0000-0000-0000-000000000003', 'BCE PR 335', 'bce.pr.335@test.local', 'bce', 'activ'),
  ('33500000-0000-0000-0000-000000000004', 'Executor Fericit 335', 'exec.happy.335@test.local', 'voluntar', 'activ'),
  ('33500000-0000-0000-0000-000000000005', 'Executor P1 335', 'exec.p1.335@test.local', 'voluntar', 'activ'),
  ('33500000-0000-0000-0000-000000000006', 'Executor P2 335', 'exec.p2.335@test.local', 'voluntar', 'activ'),
  ('33500000-0000-0000-0000-000000000007', 'Executor Poarta 335', 'exec.gate.335@test.local', 'voluntar', 'activ'),
  ('33500000-0000-0000-0000-000000000008', 'Membru Echipa Independenta 335', 'ind.team.335@test.local', 'voluntar', 'activ'),
  ('33500000-0000-0000-0000-000000000009', 'Lead Proiect 335', 'proj.lead.335@test.local', 'voluntar', 'activ'),
  ('33500000-0000-0000-0000-000000000010', 'Responsabil Proiect 335', 'proj.responsible.335@test.local', 'voluntar', 'activ'),
  ('33500000-0000-0000-0000-000000000011', 'Membru Proiect 335', 'proj.member.335@test.local', 'voluntar', 'activ'),
  ('33500000-0000-0000-0000-000000000012', 'BC Inactiv 335', 'inactive.bc.335@test.local', 'bc', 'inactiv'),
  ('33500000-0000-0000-0000-000000000013', 'Fara Claimuri 335', 'claimless.335@test.local', 'voluntar', 'activ');

insert into pg_temp.fixture_member_departments (member_id, dept_id) values
  ('33500000-0000-0000-0000-000000000002', 'edu'),
  ('33500000-0000-0000-0000-000000000003', 'pr'),
  ('33500000-0000-0000-0000-000000000004', 'edu'),
  ('33500000-0000-0000-0000-000000000005', 'edu'),
  ('33500000-0000-0000-0000-000000000006', 'edu'),
  ('33500000-0000-0000-0000-000000000007', 'edu'),
  ('33500000-0000-0000-0000-000000000013', 'edu');

insert into pg_temp.fixture_teams (id, name, dept_id) values
  ('t-335-ind', 'Echipa Independenta 335', null),
  ('t-335-dt', 'Echipa Departamentala 335', 'edu');

insert into pg_temp.fixture_team_members (team_id, member_id) values
  ('t-335-ind', '33500000-0000-0000-0000-000000000008');

insert into pg_temp.fixture_projects (name, status, leader_id, created_by) values
  ('Proiect #335', 'active',
   '33500000-0000-0000-0000-000000000009', '33500000-0000-0000-0000-000000000001'),
  ('Proiect arhivat #335', 'archived',
   '33500000-0000-0000-0000-000000000009', '33500000-0000-0000-0000-000000000001');

insert into pg_temp.fixture_project_members (project_id, member_id, project_role) values
  ((select id from pg_temp.fixture_projects where name = 'Proiect #335'),
   '33500000-0000-0000-0000-000000000010', 'responsible'),
  ((select id from pg_temp.fixture_projects where name = 'Proiect #335'),
   '33500000-0000-0000-0000-000000000011', 'member');
-- #586: materialize this suite's legacy setup as rolled-back Group fixtures.
select pg_temp.materialize_legacy_groups();


-- ---- T1: happy path / round trip. Department Task, in_review, one Executor.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('Retur fericit #335', 'Gata de feedback', '2027-11-01 09:00:00+00', pg_temp.dept_group('edu'), 'local', 'direct', 'in_review',
   now() - interval '3 days', now() - interval '2 days', now() - interval '1 day',
   '33500000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33500000-0000-0000-0000-000000000004', '33500000-0000-0000-0000-000000000001', now() - interval '2 days'
  from public.tasks where title = 'Retur fericit #335';

-- ---- T2/T3/T4: wrong-state rejections -- no Assignment needed, the state
-- check (step 6) fires before any Assignment is ever read.
insert into public.tasks (title, description, deadline, group_id, audience, assignment_mode, status, created_by)
values ('Inca netrimis #335', 'Inca todo', '2027-11-02 09:00:00+00', pg_temp.dept_group('edu'), 'local', 'direct', 'todo',
        '33500000-0000-0000-0000-000000000001');
insert into public.tasks (title, description, deadline, group_id, audience, assignment_mode, status, started_at, created_by)
values ('In lucru #335', 'In desfasurare', '2027-11-03 09:00:00+00', pg_temp.dept_group('edu'), 'local', 'direct', 'in_progress',
        now(), '33500000-0000-0000-0000-000000000001');
-- #339: tasks_cancel_reason_ck makes cancel_reason mandatory on -- and
-- exclusive to -- a cancelled Task, so this fixture states why it was called
-- off. Nothing else about the fixture changes.
insert into public.tasks (title, description, deadline, group_id, audience, assignment_mode, status, cancelled_at, cancel_reason, created_by)
values ('Anulat #335', 'Anulat deja', '2027-11-04 09:00:00+00', pg_temp.dept_group('edu'), 'local', 'direct', 'cancelled',
        now(), 'Anulat inainte de revenirea in lucru #335', '33500000-0000-0000-0000-000000000001');

-- ---- T5: note validation target -- in_review, with an Executor so the shape
-- is realistic, though every note-validation call fails before step 7 ever
-- reads it.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('Nota lipsa #335', 'Verificare nota', '2027-11-05 09:00:00+00', pg_temp.dept_group('edu'), 'local', 'direct', 'in_review',
   now() - interval '3 days', now() - interval '2 days', now() - interval '1 day',
   '33500000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33500000-0000-0000-0000-000000000004', '33500000-0000-0000-0000-000000000001', now() - interval '2 days'
  from public.tasks where title = 'Nota lipsa #335';

-- ---- T6: local BCE of the Task's own Department -- allowed.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('BCE departament #335', 'Verificare BCE', '2027-11-06 09:00:00+00', pg_temp.dept_group('edu'), 'local', 'direct', 'in_review',
   now() - interval '3 days', now() - interval '2 days', now() - interval '1 day',
   '33500000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33500000-0000-0000-0000-000000000005', '33500000-0000-0000-0000-000000000001', now() - interval '2 days'
  from public.tasks where title = 'BCE departament #335';

-- ---- T7: local BCE of a Department-Team's PARENT Department -- allowed, the
-- team-parent branch of can_evaluate_task, exercised by the same BCE persona
-- as T6 to prove it is a distinct code path, not the same one twice.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('BCE echipa departamentala #335', 'Verificare BCE echipa', '2027-11-07 09:00:00+00', pg_temp.team_group('t-335-dt'), 'local', 'direct', 'in_review',
   now() - interval '3 days', now() - interval '2 days', now() - interval '1 day',
   '33500000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33500000-0000-0000-0000-000000000006', '33500000-0000-0000-0000-000000000001', now() - interval '2 days'
  from public.tasks where title = 'BCE echipa departamentala #335';

-- ---- T8: a Project Task the LEAD is executing themselves -- the Responsible
-- may not return it (denied), but the lead may, including their own work
-- (allowed). Same fixture proves both: the denied attempt never mutates it.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
select 'Proiect lead executant #335', 'Lead isi verifica propria munca', '2027-11-08 09:00:00+00',
       pg_temp.project_group(project.id), 'local', 'direct', 'in_review',
       now() - interval '3 days', now() - interval '2 days', now() - interval '1 day',
       '33500000-0000-0000-0000-000000000001'
  from pg_temp.fixture_projects as project where project.name = 'Proiect #335';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select task.id, '33500000-0000-0000-0000-000000000009', '33500000-0000-0000-0000-000000000001', now() - interval '2 days'
  from public.tasks as task where task.title = 'Proiect lead executant #335';

-- ---- T9: a Project Task the RESPONSIBLE is executing themselves -- denied
-- even for the Responsible's own work.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
select 'Proiect responsabil executant #335', 'Responsabilul isi verifica propria munca', '2027-11-09 09:00:00+00',
       pg_temp.project_group(project.id), 'local', 'direct', 'in_review',
       now() - interval '3 days', now() - interval '2 days', now() - interval '1 day',
       '33500000-0000-0000-0000-000000000001'
  from pg_temp.fixture_projects as project where project.name = 'Proiect #335';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select task.id, '33500000-0000-0000-0000-000000000010', '33500000-0000-0000-0000-000000000001', now() - interval '2 days'
  from public.tasks as task where task.title = 'Proiect responsabil executant #335';

-- ---- T10: a Project Task an ORDINARY member is executing -- the positive
-- case proving the Responsible branch is not simply dead.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
select 'Proiect membru executant #335', 'Membru obisnuit executa', '2027-11-10 09:00:00+00',
       pg_temp.project_group(project.id), 'local', 'direct', 'in_review',
       now() - interval '3 days', now() - interval '2 days', now() - interval '1 day',
       '33500000-0000-0000-0000-000000000001'
  from pg_temp.fixture_projects as project where project.name = 'Proiect #335';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select task.id, '33500000-0000-0000-0000-000000000011', '33500000-0000-0000-0000-000000000001', now() - interval '2 days'
  from public.tasks as task where task.title = 'Proiect membru executant #335';

-- ---- T11: a Task on an ARCHIVED Project -- can_evaluate_task requires
-- projects.status = 'active', so even the lead is denied.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
select 'Proiect arhivat #335', 'Proiect inactiv', '2027-11-11 09:00:00+00',
       pg_temp.project_group(project.id), 'local', 'direct', 'in_review',
       now() - interval '3 days', now() - interval '2 days', now() - interval '1 day',
       '33500000-0000-0000-0000-000000000001'
  from pg_temp.fixture_projects as project where project.name = 'Proiect arhivat #335';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select task.id, '33500000-0000-0000-0000-000000000009', '33500000-0000-0000-0000-000000000001', now() - interval '2 days'
  from public.tasks as task where task.title = 'Proiect arhivat #335';

-- ---- T12: an Independent Team's own Task, executed by one of its own
-- members -- they MANAGE it (can_manage_task true) but can_evaluate_task has
-- no member branch there at all: only BC/Moderator evaluate an Independent
-- Team's work. This is the one place manage and evaluate diverge.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('Echipa independenta #335', 'Munca echipei', '2027-11-12 09:00:00+00', pg_temp.team_group('t-335-ind'), 'local', 'direct', 'in_review',
   now() - interval '3 days', now() - interval '2 days', now() - interval '1 day',
   '33500000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33500000-0000-0000-0000-000000000008', '33500000-0000-0000-0000-000000000001', now() - interval '2 days'
  from public.tasks where title = 'Echipa independenta #335';

-- ---- T13: shared denial target for the standard gate/authority personas --
-- none of the following attempts on it succeed, so it can be reused freely.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('Poarta comuna #335', 'Tinta refuzurilor', '2027-11-13 09:00:00+00', pg_temp.dept_group('edu'), 'local', 'direct', 'in_review',
   now() - interval '3 days', now() - interval '2 days', now() - interval '1 day',
   '33500000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33500000-0000-0000-0000-000000000007', '33500000-0000-0000-0000-000000000001', now() - interval '2 days'
  from public.tasks where title = 'Poarta comuna #335';

-- ---- T14: direct-write-denial target -- in_review with an Executor.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('Scriere directa #335', 'Tinta interzisa', '2027-11-14 09:00:00+00', pg_temp.dept_group('edu'), 'local', 'direct', 'in_review',
   now() - interval '3 days', now() - interval '2 days', now() - interval '1 day',
   '33500000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33500000-0000-0000-0000-000000000005', '33500000-0000-0000-0000-000000000001', now() - interval '2 days'
  from public.tasks where title = 'Scriere directa #335';

-- Every fixture id resolved ONCE, as the owner. Never resolve an id inside a
-- format() while a denied persona is logged in (the #328 trap,
-- stack-context.md carry-forwards).
create temp table f335 as
select
  9223372036854775807::bigint as missing_id,
  (select id from public.tasks where title = 'Retur fericit #335') as happy_task_id,
  (select id from public.tasks where title = 'Inca netrimis #335') as todo_task_id,
  (select id from public.tasks where title = 'In lucru #335') as in_progress_task_id,
  (select id from public.tasks where title = 'Anulat #335') as cancelled_task_id,
  (select id from public.tasks where title = 'Nota lipsa #335') as note_task_id,
  (select id from public.tasks where title = 'BCE departament #335') as bce_dept_task_id,
  (select id from public.tasks where title = 'BCE echipa departamentala #335') as bce_team_task_id,
  (select id from public.tasks where title = 'Proiect lead executant #335') as proj_lead_task_id,
  (select id from public.tasks where title = 'Proiect responsabil executant #335') as proj_resp_task_id,
  (select id from public.tasks where title = 'Proiect membru executant #335') as proj_member_task_id,
  (select id from public.tasks where title = 'Proiect arhivat #335') as proj_archived_task_id,
  (select id from public.tasks where title = 'Echipa independenta #335') as ind_team_task_id,
  (select id from public.tasks where title = 'Poarta comuna #335') as gate_task_id,
  (select id from public.tasks where title = 'Scriere directa #335') as direct_write_task_id,
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'Retur fericit #335' and assignment.ended_at is null) as happy_assignment_id,
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'BCE departament #335' and assignment.ended_at is null) as bce_dept_assignment_id,
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'BCE echipa departamentala #335' and assignment.ended_at is null) as bce_team_assignment_id,
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'Proiect lead executant #335' and assignment.ended_at is null) as proj_lead_assignment_id,
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'Proiect membru executant #335' and assignment.ended_at is null) as proj_member_assignment_id;
grant select on f335 to authenticated, anon;

-- ==================== 1. API shape and privileges ====================

select has_function('public', 'return_task_to_progress', array['bigint', 'text'],
  'public.return_task_to_progress exists with the pinned two-parameter signature');
select is(pg_get_function_identity_arguments(
    'public.return_task_to_progress(bigint, text)'::regprocedure),
  'p_task_id bigint, p_note text',
  'return_task_to_progress exposes no actor parameter -- the actor is always auth.uid()');
select is(pg_get_function_result(
    'public.return_task_to_progress(bigint, text)'::regprocedure),
  'tasks', 'return_task_to_progress returns the affected Task row');
select ok(not (select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public' and procedure.proname = 'return_task_to_progress'),
  'the public command is a security invoker wrapper');
select ok((select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private' and procedure.proname = 'return_task_to_progress_impl'),
  'private.return_task_to_progress_impl runs as owner (security definer)');
select ok(coalesce((
    select bool_and('search_path=""' = any(procedure.proconfig))
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private' and procedure.proname = 'return_task_to_progress_impl'
  ), false), 'return_task_to_progress_impl pins an empty search_path');
select ok(has_function_privilege('authenticated',
  'public.return_task_to_progress(bigint, text)'::regprocedure, 'execute'),
  'authenticated can execute public.return_task_to_progress');
select ok(not has_function_privilege('anon',
  'public.return_task_to_progress(bigint, text)'::regprocedure, 'execute'),
  'anon cannot execute public.return_task_to_progress');
select ok(has_function_privilege('authenticated',
  'private.return_task_to_progress_impl(bigint, text)'::regprocedure, 'execute'),
  'authenticated can execute private.return_task_to_progress_impl');

-- ==================== 2. The round trip with #334, end to end ====================
-- Return once (BC -- the "Allowed: BC/Moderator" persona), resubmit through
-- #334's real submit_task_for_review, return again -- review_round advances
-- 0 -> 1 -> 2 and returned_to_progress_at is set both times.

select pg_temp.test_login('33500000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.return_task_to_progress(%s, 'Te rog revizuieste sectiunea 2') $$,
  (select happy_task_id from f335)),
  'BC/Moderator may return any in_review Task to progress');
reset role;

select is((select format('%s|%s|%s', task.status, (task.submitted_at is null)::text, task.review_round)
             from public.tasks as task where task.id = (select happy_task_id from f335)),
  'in_progress|true|1',
  'the first return moves the Task to in_progress, nulls submitted_at, and sets review_round = 1');
select is((select task.returned_to_progress_at is not null from public.tasks as task
            where task.id = (select happy_task_id from f335)), true,
  'returned_to_progress_at is stamped on the first return');
select is((select format('%s|%s|%s|%s|%s|%s', activity.kind, activity.actor_id,
                         (activity.assignment_id = (select happy_assignment_id from f335))::text,
                         activity.from_status, activity.to_status, activity.note)
             from public.task_activity as activity
            where activity.task_id = (select happy_task_id from f335)),
  'returned_to_progress|33500000-0000-0000-0000-000000000001|true|in_review|in_progress|Te rog revizuieste sectiunea 2',
  'the returned_to_progress activity row names the evaluator, carries the active Assignment id, the in_review -> in_progress transition, and the trimmed note');
select is((select activity.details ->> 'review_round' from public.task_activity as activity
            where activity.task_id = (select happy_task_id from f335)),
  '1', 'details.review_round records the new round');
select is((select count(*) from public.task_activity
            where task_id = (select happy_task_id from f335)), 1::bigint,
  'exactly one activity row after the first return');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s $$, (select happy_task_id from f335)),
  $$ values ('33500000-0000-0000-0000-000000000004'::uuid) $$,
  'exactly the active Executor is notified -- the evaluator (BC) hears nothing about their own action');
select is((select format('%s|%s', notification.title, notification.body)
             from public.notifications as notification
            where notification.task_id = (select happy_task_id from f335)),
  'Feedback de implementat: Retur fericit #335|Te rog revizuieste sectiunea 2',
  'the Executor gets the pinned "Feedback de implementat" copy with the note as the body');

create temp table t335_round as
select task.returned_to_progress_at as first_returned_at
  from public.tasks as task where task.id = (select happy_task_id from f335);

select pg_temp.test_login('33500000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.submit_task_for_review(%s) $$,
  (select happy_task_id from f335)),
  'the Executor may resubmit after being returned to progress');
reset role;

select is((select format('%s|%s|%s', task.status, (task.submitted_at is not null)::text, task.review_round)
             from public.tasks as task where task.id = (select happy_task_id from f335)),
  'in_review|true|1',
  'the resubmit sets submitted_at again but leaves review_round at 1 -- that column is this command''s alone');
select is((select count(*) from public.task_activity
            where task_id = (select happy_task_id from f335)), 2::bigint,
  'the resubmission writes its own second activity row');

select pg_temp.test_login('33500000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.return_task_to_progress(%s, 'A doua tura de feedback') $$,
  (select happy_task_id from f335)),
  'BC may return the same Task a second time');
reset role;

select is((select format('%s|%s|%s', task.status, (task.submitted_at is null)::text, task.review_round)
             from public.tasks as task where task.id = (select happy_task_id from f335)),
  'in_progress|true|2',
  'the second return advances review_round to 2');
-- Both returns happen inside this suite's single transaction, and this
-- command deliberately uses now() (a lifecycle marker compared against other
-- lifecycle columns by tasks_lifecycle_timestamp_order_ck), which is
-- frozen for the whole transaction -- so the two stamps are typically equal,
-- never earlier. >= is the honest assertion; a real second HTTP call, in its
-- own transaction, would see now() advance for real.
select is((select task.returned_to_progress_at >= (select first_returned_at from t335_round)
             from public.tasks as task where task.id = (select happy_task_id from f335)), true,
  'returned_to_progress_at never goes backward on the second return (now() is frozen within one transaction, so equality here is expected, not a bug)');
select is((select count(*) from public.task_activity
            where task_id = (select happy_task_id from f335)), 3::bigint,
  'three activity rows total: returned, submitted, returned');
select is((select activity.details ->> 'review_round' from public.task_activity as activity
            where activity.task_id = (select happy_task_id from f335)
              and activity.kind = 'returned_to_progress'
            order by activity.occurred_at desc limit 1),
  '2', 'the newest returned_to_progress row records review_round = 2');
select is((select count(*) from public.notifications
            where task_id = (select happy_task_id from f335)
              and member_id = '33500000-0000-0000-0000-000000000004'), 2::bigint,
  'two Executor notifications total, one per return (dedupe_key is null, so neither coalesces) -- the task also carries a third row from the resubmit''s "De verificat" notice to the creator, filtered out here since that one belongs to #334');

-- ==================== 3. Wrong-state rejections ====================

select pg_temp.test_login('33500000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.return_task_to_progress(%s, 'Nota') $$,
  (select todo_task_id from f335)),
  'PT409', 'task_not_in_review', 'a todo Task cannot be returned -- it was never submitted');
select throws_ok(format($$ select public.return_task_to_progress(%s, 'Nota') $$,
  (select in_progress_task_id from f335)),
  'PT409', 'task_not_in_review', 'an in_progress Task cannot be returned again without a fresh submission');
select throws_ok(format($$ select public.return_task_to_progress(%s, 'Nota') $$,
  (select cancelled_task_id from f335)),
  'PT409', 'task_not_in_review', 'a cancelled Task cannot be returned -- the same reason covers every non-in_review status');
reset role;

-- ==================== 4. Note validation, checked BEFORE the gate ====================

select pg_temp.test_login('33500000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.return_task_to_progress(%s, null) $$,
  (select note_task_id from f335)),
  'PT400', 'note_required', 'a null note is rejected');
select throws_ok(format($$ select public.return_task_to_progress(%s, '') $$,
  (select note_task_id from f335)),
  'PT400', 'note_required', 'an empty note is rejected');
select throws_ok(format($$ select public.return_task_to_progress(%s, '   ') $$,
  (select note_task_id from f335)),
  'PT400', 'note_required', 'a whitespace-only note is rejected');
select throws_ok(format($$ select public.return_task_to_progress(%s, E'\t\t') $$,
  (select note_task_id from f335)),
  'PT400', 'note_required', 'a tab-only note is rejected -- regexp_replace catches it where btrim would not');
select throws_ok(format($$ select public.return_task_to_progress(%s, '') $$,
  (select missing_id from f335)),
  'PT400', 'note_required', 'the note check runs before the target is even looked up -- an unknown id with a blank note is still PT400, never PT404');
reset role;

select pg_temp.test_login('33500000-0000-0000-0000-000000000013',
  jsonb_build_object('provider', 'email'));
select throws_ok(format($$ select public.return_task_to_progress(%s, '') $$,
  (select gate_task_id from f335)),
  'PT400', 'note_required', 'the note check runs before the gate too -- a claimless caller with a blank note gets PT400, not 42501');
reset role;

select pg_temp.test_login('33500000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.return_task_to_progress(%s, 'Nota valida') $$,
  (select missing_id from f335)),
  'PT404', 'task_not_found', 'an unknown Task id is not found once the note is valid');
reset role;

-- ==================== 5. The persona matrix -- denied ====================
-- ADR-0007 Sec Authorization draws the evaluator boundary; every denial here
-- pins the exact reason and, for the gate personas, the exact code.

select pg_temp.test_login('33500000-0000-0000-0000-000000000010', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.return_task_to_progress(%s, 'Incercare respinsa') $$,
  (select proj_lead_task_id from f335)),
  '42501', 'task_evaluate_forbidden', 'a Project Responsible may not return the lead''s own work');
select throws_ok(format($$ select public.return_task_to_progress(%s, 'Incercare respinsa') $$,
  (select proj_resp_task_id from f335)),
  '42501', 'task_evaluate_forbidden', 'a Project Responsible may not return their own work either');
reset role;

select pg_temp.test_login('33500000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb,
  'team_ids', '["t-335-ind"]'::jsonb));
select is((select private.can_manage_task((select ind_team_task_id from f335))), true,
  'an Independent-Team member DOES manage their own Team''s Task');
select throws_ok(format($$ select public.return_task_to_progress(%s, 'Incercare respinsa') $$,
  (select ind_team_task_id from f335)),
  '42501', 'task_evaluate_forbidden',
  'but the same Independent-Team member does NOT evaluate it -- manage and evaluate diverge only here; BC/Moderator alone evaluates an Independent Team''s work');
reset role;

select pg_temp.test_login('33500000-0000-0000-0000-000000000009', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.return_task_to_progress(%s, 'Incercare respinsa') $$,
  (select proj_archived_task_id from f335)),
  '42501', 'task_evaluate_forbidden',
  'the Project lead does not evaluate a Task on an ARCHIVED Project -- can_evaluate_task requires projects.status = ''active''');
reset role;

select pg_temp.test_login('33500000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["pr"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.return_task_to_progress(%s, 'Incercare respinsa') $$,
  (select gate_task_id from f335)),
  '42501', 'task_evaluate_forbidden', 'a BCE of a DIFFERENT Department does not evaluate an EDU Task');
reset role;

select pg_temp.test_login('33500000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.return_task_to_progress(%s, 'Incercare respinsa') $$,
  (select gate_task_id from f335)),
  '42501', 'task_evaluate_forbidden', 'the active Executor themselves -- an ordinary member -- cannot evaluate their own submission');
reset role;

select pg_temp.test_login('33500000-0000-0000-0000-000000000012', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.return_task_to_progress(%s, 'Incercare respinsa') $$,
  (select gate_task_id from f335)),
  '42501', 'task_command_forbidden', 'a deactivated BC holding a still-valid level-6 token is stopped at the gate');
reset role;

select pg_temp.test_login('33500000-0000-0000-0000-000000000013',
  jsonb_build_object('provider', 'email'));
select throws_ok(format($$ select public.return_task_to_progress(%s, 'Incercare respinsa') $$,
  (select gate_task_id from f335)),
  '42501', 'task_command_forbidden', 'a real uid without organisation claims is stopped at the gate too');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(format($$ select public.return_task_to_progress(%s, 'Incercare respinsa') $$,
  (select gate_task_id from f335)),
  '42501', 'permission denied for function return_task_to_progress',
  'anon cannot execute return_task_to_progress at all -- the literal grant denial, not a gate that happens to raise 42501');
reset role;

-- None of the denied calls above mutated anything.
select is((select count(*) from public.task_activity
            where task_id in (select proj_lead_task_id from f335)
               or task_id in (select proj_resp_task_id from f335)
               or task_id in (select ind_team_task_id from f335)
               or task_id in (select proj_archived_task_id from f335)
               or task_id in (select gate_task_id from f335)), 0::bigint,
  'none of the denied persona calls wrote an activity row');
select is((select count(*) from public.notifications
            where task_id in (select proj_lead_task_id from f335)
               or task_id in (select proj_resp_task_id from f335)
               or task_id in (select ind_team_task_id from f335)
               or task_id in (select proj_archived_task_id from f335)
               or task_id in (select gate_task_id from f335)), 0::bigint,
  'none of them wrote a notification either');
select is((select count(*) from public.tasks
            where (id in (select proj_lead_task_id from f335)
               or id in (select proj_resp_task_id from f335)
               or id in (select ind_team_task_id from f335)
               or id in (select proj_archived_task_id from f335)
               or id in (select gate_task_id from f335))
              and status = 'in_review'), 5::bigint,
  'all five denied-target Tasks are still in_review, untouched');

-- ==================== 6. The persona matrix -- allowed ====================
-- Every denied attempt above left its Task unmutated, so the lead''s own
-- return below (on the SAME Task the Responsible was just denied) is still a
-- legal in_review -> in_progress transition.

select pg_temp.test_login('33500000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.return_task_to_progress(%s, 'Verificare BCE departament') $$,
  (select bce_dept_task_id from f335)),
  'the local BCE of the Task''s own Department may return it');
reset role;
select is((select format('%s|%s', task.status, task.review_round) from public.tasks as task
            where task.id = (select bce_dept_task_id from f335)),
  'in_progress|1', 'the Department BCE''s return advances the round');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s $$, (select bce_dept_task_id from f335)),
  $$ values ('33500000-0000-0000-0000-000000000005'::uuid) $$,
  'exactly the Executor is notified, not the BCE evaluator');
select is((select activity.assignment_id from public.task_activity as activity
            where activity.task_id = (select bce_dept_task_id from f335)),
  (select bce_dept_assignment_id from f335),
  'the activity row carries the active Assignment id');

select pg_temp.test_login('33500000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.return_task_to_progress(%s, 'Verificare BCE echipa') $$,
  (select bce_team_task_id from f335)),
  'the local BCE of a Department-Team''s PARENT Department may return the Team''s Task');
reset role;
select is((select format('%s|%s', task.status, task.review_round) from public.tasks as task
            where task.id = (select bce_team_task_id from f335)),
  'in_progress|1', 'the team-parent BCE''s return advances the round -- a distinct code path from the plain Department branch');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s $$, (select bce_team_task_id from f335)),
  $$ values ('33500000-0000-0000-0000-000000000006'::uuid) $$,
  'exactly the Executor is notified');
select is((select activity.assignment_id from public.task_activity as activity
            where activity.task_id = (select bce_team_task_id from f335)),
  (select bce_team_assignment_id from f335),
  'the activity row carries the active Assignment id');

select pg_temp.test_login('33500000-0000-0000-0000-000000000009', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.return_task_to_progress(%s, 'Lead isi corecteaza munca') $$,
  (select proj_lead_task_id from f335)),
  'the Project lead may return their OWN active Assignment -- the one place a self-return is allowed');
reset role;
select is((select format('%s|%s', task.status, task.review_round) from public.tasks as task
            where task.id = (select proj_lead_task_id from f335)),
  'in_progress|1', 'the lead''s self-return advances the round like any other');
select is((select count(*) from public.notifications
            where task_id = (select proj_lead_task_id from f335)), 0::bigint,
  'the lead is both actor and Executor -- private.notify drops the actor, so nobody is notified of a self-return');
select is((select activity.assignment_id from public.task_activity as activity
            where activity.task_id = (select proj_lead_task_id from f335)),
  (select proj_lead_assignment_id from f335),
  'the activity row still carries the lead''s own active Assignment id');

select pg_temp.test_login('33500000-0000-0000-0000-000000000010', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.return_task_to_progress(%s, 'Responsabilul cere ajustari') $$,
  (select proj_member_task_id from f335)),
  'a Project Responsible may return an ORDINARY member''s work -- proving the Responsible branch is not dead');
reset role;
select is((select format('%s|%s', task.status, task.review_round) from public.tasks as task
            where task.id = (select proj_member_task_id from f335)),
  'in_progress|1', 'the Responsible''s return of an ordinary member''s work advances the round');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s $$, (select proj_member_task_id from f335)),
  $$ values ('33500000-0000-0000-0000-000000000011'::uuid) $$,
  'exactly the ordinary member Executor is notified, not the Responsible');
select is((select activity.assignment_id from public.task_activity as activity
            where activity.task_id = (select proj_member_task_id from f335)),
  (select proj_member_assignment_id from f335),
  'the activity row carries the active Assignment id');

-- ==================== 7. The command is the only write path ====================

select pg_temp.test_login('33500000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ insert into public.task_activity (task_id, kind, actor_id, details)
  values (%s, 'returned_to_progress', '33500000-0000-0000-0000-000000000002', '{}'::jsonb) $$,
  (select direct_write_task_id from f335)),
  '42501', null,
  'even the Task''s evaluator cannot fake a returned_to_progress activity row by inserting directly');
reset role;

-- ==================== 8. Lock held while the command runs ====================
-- Proves WHERE the serialization point is: the tasks row FOR UPDATE taken
-- before authority is even checked, the evaluator's own live profile row FOR
-- SHARE, and (since a BCE reaches the membership branch, unlike BC/Moderator)
-- their member_departments row FOR SHARE too --
-- private.require_group_work_manager''s discipline (#343 / #390).
--
-- Works on COMMITTED fixtures, created and removed through their own dblink
-- connection: pg_temp test sessions commit for real, so nothing this suite's
-- own rolled-back transaction created would be visible to them.
select extensions.dblink_connect('rtp_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
-- #621: committed fixtures from an interrupted run must not hang cleanup.
select extensions.dblink_exec('rtp_setup', 'set lock_timeout = ''2s''');

select extensions.dblink_exec('rtp_setup', $$
  set session_replication_role = 'replica';
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#335 committed%');
  set session_replication_role = 'origin';
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#335 committed%')
      or member_id in ('33500000-0000-0000-0000-000000000051',
                       '33500000-0000-0000-0000-000000000052');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%#335 committed%');
  delete from public.tasks where title like '%#335 committed%';
  delete from auth.users where id in (
    '33500000-0000-0000-0000-000000000051', '33500000-0000-0000-0000-000000000052');

  insert into auth.users (id, email) values
    ('33500000-0000-0000-0000-000000000051', 'probe.evaluator.335@test.local'),
    ('33500000-0000-0000-0000-000000000052', 'probe.executor.335@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('33500000-0000-0000-0000-000000000051', 'Probe Evaluator 335', 'probe.evaluator.335@test.local', 'bce', 'activ'),
    ('33500000-0000-0000-0000-000000000052', 'Probe Executor 335', 'probe.executor.335@test.local', 'voluntar', 'activ');
  -- #586: committed race fixtures need an explicit native Group roster.
  insert into public.group_members(group_id,member_id,group_role)
  select g.id,md.member_id,case when p.role='bce' then 'manager' else 'member' end
    from (values ('33500000-0000-0000-0000-000000000051'::uuid, 'edu'),
    ('33500000-0000-0000-0000-000000000052'::uuid, 'edu')) md(member_id,dept_id) join public.groups g on g.legacy_dept_id=md.dept_id
    join public.profiles p on p.id=md.member_id
   where md.member_id::text like '33500000-%'
  on conflict (group_id,member_id) do nothing;

  insert into public.tasks
    (title, description, deadline, group_id, audience, assignment_mode, status,
     created_at, started_at, submitted_at, created_by)
  values
    ('Sonda blocaj retur #335 committed', 'Sonda', '2027-12-01 09:00:00+00', (select id from public.groups where legacy_dept_id = 'edu'), 'local', 'direct', 'in_review',
     now() - interval '3 days', now() - interval '2 days', now() - interval '1 day',
     '33500000-0000-0000-0000-000000000051');

  insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
  select id, '33500000-0000-0000-0000-000000000052'::uuid, '33500000-0000-0000-0000-000000000051'::uuid,
         now() - interval '2 days'
    from public.tasks where title = 'Sonda blocaj retur #335 committed';
$$);

-- Resolved as the owner, before any persona logs in (the #328 trap again).
create temp table r335 as
select (select id from public.tasks where title = 'Sonda blocaj retur #335 committed') as probe_task_id;
grant select on r335 to authenticated;

select extensions.dblink_connect('rtp_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('rtp_lock', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('rtp_lock', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '33500000-0000-0000-0000-000000000051', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'bce', 'member_level', 5,
      'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text, true)
$$) as remote_claims(setting text);
select extensions.dblink_exec('rtp_lock', 'set local role authenticated');
select * from extensions.dblink('rtp_lock', format($$
  select (public.return_task_to_progress(%s, 'Sonda de blocaj')).status::text
$$, (select probe_task_id from r335))) as locked_return(status text);

select ok(coalesce((
  select row_lock.modes && array['For Update', 'Update', 'No Key Update']
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_task_id from r335)
), false), 'return_task_to_progress holds the target Task row exclusively locked while it runs -- the tasks-row-first serialization point every command in the wave shares');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.profiles') as row_lock
    join public.profiles as profile on profile.ctid = row_lock.locked_row
   where profile.id = '33500000-0000-0000-0000-000000000051'
), false), 'return_task_to_progress holds the evaluator''s own live profile row FOR SHARE (private.require_group_work_manager''s discipline)');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.group_members') as row_lock
    join public.group_members as membership on membership.ctid = row_lock.locked_row
    join public.groups as authority_group on authority_group.id = membership.group_id
   where membership.member_id = '33500000-0000-0000-0000-000000000051'
     and authority_group.legacy_dept_id = 'edu'
), false), 'the evaluator''s Group roster row -- the one their authority rests on -- is locked FOR SHARE too, since a BCE (unlike BC/Moderator) reaches that branch');

select extensions.dblink_exec('rtp_lock', 'rollback');
select extensions.dblink_disconnect('rtp_lock');

select extensions.dblink_exec('rtp_setup', $$
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#335 committed%');
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#335 committed%')
      or member_id in ('33500000-0000-0000-0000-000000000051',
                       '33500000-0000-0000-0000-000000000052');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%#335 committed%');
  delete from public.tasks where title like '%#335 committed%';
  delete from auth.users where id in (
    '33500000-0000-0000-0000-000000000051', '33500000-0000-0000-0000-000000000052');
$$);
select extensions.dblink_disconnect('rtp_setup');


-- #521: Group authority regression matrix.
\ir _group_task_fixtures.psql
reset role;
select pg_temp.g521_task('command0','project',5,'in_review','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($$select public.return_task_to_progress((select id from g521_tasks where name='command0'),'Feedback #521')$$,'return_task_to_progress: Group persona 2 on executor 5 in project');
reset role;
select pg_temp.g521_task('command1','project',4,'in_review','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select throws_ok($$select public.return_task_to_progress((select id from g521_tasks where name='command1'),'Feedback #521')$$,'42501','task_evaluate_forbidden','return_task_to_progress: Group persona 3 on executor 4 in project');
reset role;
select pg_temp.g521_task('command2','ind',7,'in_review','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(6));
select throws_ok($$select public.return_task_to_progress((select id from g521_tasks where name='command2'),'Feedback #521')$$,'42501','task_evaluate_forbidden','return_task_to_progress: Group persona 6 on executor 7 in ind');
reset role;
select pg_temp.g521_task('command3','dt',5,'in_review','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(8));
select throws_ok($$select public.return_task_to_progress((select id from g521_tasks where name='command3'),'Feedback #521')$$,'42501','task_evaluate_forbidden','return_task_to_progress: Group persona 8 on executor 5 in dt');
reset role;
select pg_temp.g521_task('command4','project',5,'in_review','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select lives_ok($$select public.return_task_to_progress((select id from g521_tasks where name='command4'),'Feedback #521')$$,'return_task_to_progress: Group persona 3 on executor 5 in project');
reset role;
select pg_temp.g521_task('command5','project',3,'in_review','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select throws_ok($$select public.return_task_to_progress((select id from g521_tasks where name='command5'),'Feedback #521')$$,'42501','task_evaluate_forbidden','return_task_to_progress: Group persona 3 on executor 3 in project');
reset role;
select pg_temp.g521_task('command6','project',2,'in_review','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select throws_ok($$select public.return_task_to_progress((select id from g521_tasks where name='command6'),'Feedback #521')$$,'42501','task_evaluate_forbidden','return_task_to_progress: Group persona 3 on executor 2 in project');
reset role;
select pg_temp.g521_task('command7','project',2,'in_review','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($$select public.return_task_to_progress((select id from g521_tasks where name='command7'),'Feedback #521')$$,'return_task_to_progress: Group persona 2 on executor 2 in project');
reset role;
select pg_temp.g521_task('command8','ind',7,'in_review','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select lives_ok($$select public.return_task_to_progress((select id from g521_tasks where name='command8'),'Feedback #521')$$,'return_task_to_progress: Group persona 1 on executor 7 in ind');
reset role;

-- ==================== #673: constraints kit (R8) ====================
-- Step 1 answers before the gate: a claimless caller hears the reason, not 42501.
reset role;
select pg_temp.test_login('67300000-0000-0000-0000-000000000001', '{"provider":"email"}'::jsonb);
select throws_ok($$ select public.return_task_to_progress(0, repeat('n', 1001)) $$,
  'PT400', 'note_too_long', 'a feedback note over 1000 characters is refused before the gate');
reset role;

select * from finish();
rollback;
