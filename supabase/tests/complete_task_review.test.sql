-- #336: public.complete_task_review over private.evaluate_task -- the single
-- place in the system where points are computed and written. Tasks #337,
-- #338 and #344 will all reach that same core, so this suite pins the core's
-- observable effects (one Evaluation, one ledger row, the Assignment ended,
-- the Queue closed, the activity row, the notifications, the Umbrella
-- rollup) as much as it pins the command's own gate/authority/state rules.
--
-- Fixture prefix 33600000-0000-0000-0000-0000000000NN throughout, resolved
-- as the owner into a temp table before any persona logs in (the #328 trap,
-- stack-context.md carry-forwards). Committed fixtures for the lock probe
-- and the two races use 33600000-...-0000000000[5-9]N and carry
-- '#336 committed' in their titles.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(117);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('33600000-0000-0000-0000-000000000001', 'bc.336@test.local'),
  ('33600000-0000-0000-0000-000000000002', 'bce.edu.336@test.local'),
  ('33600000-0000-0000-0000-000000000003', 'bce.pr.336@test.local'),
  ('33600000-0000-0000-0000-000000000004', 'exec.happy.336@test.local'),
  ('33600000-0000-0000-0000-000000000005', 'exec.dt.336@test.local'),
  ('33600000-0000-0000-0000-000000000006', 'proj.lead.336@test.local'),
  ('33600000-0000-0000-0000-000000000007', 'proj.responsible.336@test.local'),
  ('33600000-0000-0000-0000-000000000008', 'proj.member.336@test.local'),
  ('33600000-0000-0000-0000-000000000009', 'ind.team.336@test.local'),
  ('33600000-0000-0000-0000-000000000010', 'inactive.bc.336@test.local'),
  ('33600000-0000-0000-0000-000000000011', 'claimless.336@test.local'),
  ('33600000-0000-0000-0000-000000000012', 'exec.past.336@test.local'),
  ('33600000-0000-0000-0000-000000000013', 'candidate.a.336@test.local'),
  ('33600000-0000-0000-0000-000000000014', 'candidate.b.336@test.local'),
  ('33600000-0000-0000-0000-000000000015', 'exec.sub1.336@test.local'),
  ('33600000-0000-0000-0000-000000000016', 'exec.sub2.336@test.local'),
  ('33600000-0000-0000-0000-000000000017', 'exec.late.336@test.local'),
  ('33600000-0000-0000-0000-000000000018', 'exec.gate.336@test.local'),
  ('33600000-0000-0000-0000-000000000019', 'exec.directwrite.336@test.local'),
  ('33600000-0000-0000-0000-000000000020', 'exec.inputs.336@test.local'),
  ('33600000-0000-0000-0000-000000000021', 'exec.negative.336@test.local'),
  ('33600000-0000-0000-0000-000000000022', 'exec.singular.336@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('33600000-0000-0000-0000-000000000001', 'BC 336', 'bc.336@test.local', 'bc', 'activ'),
  ('33600000-0000-0000-0000-000000000002', 'BCE EDU 336', 'bce.edu.336@test.local', 'bce', 'activ'),
  ('33600000-0000-0000-0000-000000000003', 'BCE PR 336', 'bce.pr.336@test.local', 'bce', 'activ'),
  ('33600000-0000-0000-0000-000000000004', 'Executor Fericit 336', 'exec.happy.336@test.local', 'voluntar', 'activ'),
  ('33600000-0000-0000-0000-000000000005', 'Executor Echipa 336', 'exec.dt.336@test.local', 'voluntar', 'activ'),
  ('33600000-0000-0000-0000-000000000006', 'Lead Proiect 336', 'proj.lead.336@test.local', 'voluntar', 'activ'),
  ('33600000-0000-0000-0000-000000000007', 'Responsabil Proiect 336', 'proj.responsible.336@test.local', 'voluntar', 'activ'),
  ('33600000-0000-0000-0000-000000000008', 'Membru Proiect 336', 'proj.member.336@test.local', 'voluntar', 'activ'),
  ('33600000-0000-0000-0000-000000000009', 'Membru Echipa Independenta 336', 'ind.team.336@test.local', 'voluntar', 'activ'),
  ('33600000-0000-0000-0000-000000000010', 'BC Inactiv 336', 'inactive.bc.336@test.local', 'bc', 'inactiv'),
  ('33600000-0000-0000-0000-000000000011', 'Fara Claimuri 336', 'claimless.336@test.local', 'voluntar', 'activ'),
  ('33600000-0000-0000-0000-000000000012', 'Executor Inlocuit 336', 'exec.past.336@test.local', 'voluntar', 'activ'),
  ('33600000-0000-0000-0000-000000000013', 'Candidat A 336', 'candidate.a.336@test.local', 'voluntar', 'activ'),
  ('33600000-0000-0000-0000-000000000014', 'Candidat B 336', 'candidate.b.336@test.local', 'voluntar', 'activ'),
  ('33600000-0000-0000-0000-000000000015', 'Executor Subtask Unu 336', 'exec.sub1.336@test.local', 'voluntar', 'activ'),
  ('33600000-0000-0000-0000-000000000016', 'Executor Subtask Doi 336', 'exec.sub2.336@test.local', 'voluntar', 'activ'),
  ('33600000-0000-0000-0000-000000000017', 'Executor Intarziat 336', 'exec.late.336@test.local', 'voluntar', 'activ'),
  ('33600000-0000-0000-0000-000000000018', 'Executor Poarta 336', 'exec.gate.336@test.local', 'voluntar', 'activ'),
  ('33600000-0000-0000-0000-000000000019', 'Executor Scriere 336', 'exec.directwrite.336@test.local', 'voluntar', 'activ'),
  ('33600000-0000-0000-0000-000000000020', 'Executor Intrari 336', 'exec.inputs.336@test.local', 'voluntar', 'activ'),
  ('33600000-0000-0000-0000-000000000021', 'Executor Negativ 336', 'exec.negative.336@test.local', 'voluntar', 'activ'),
  ('33600000-0000-0000-0000-000000000022', 'Executor Un Punct 336', 'exec.singular.336@test.local', 'voluntar', 'activ');

insert into public.member_departments (member_id, dept_id) values
  ('33600000-0000-0000-0000-000000000002', 'edu'),
  ('33600000-0000-0000-0000-000000000003', 'pr'),
  ('33600000-0000-0000-0000-000000000004', 'edu'),
  ('33600000-0000-0000-0000-000000000005', 'edu'),
  ('33600000-0000-0000-0000-000000000011', 'edu'),
  ('33600000-0000-0000-0000-000000000012', 'edu'),
  ('33600000-0000-0000-0000-000000000013', 'edu'),
  ('33600000-0000-0000-0000-000000000014', 'edu'),
  ('33600000-0000-0000-0000-000000000015', 'edu'),
  ('33600000-0000-0000-0000-000000000016', 'edu'),
  ('33600000-0000-0000-0000-000000000017', 'edu'),
  ('33600000-0000-0000-0000-000000000018', 'edu'),
  ('33600000-0000-0000-0000-000000000019', 'edu'),
  ('33600000-0000-0000-0000-000000000020', 'edu'),
  ('33600000-0000-0000-0000-000000000021', 'edu'),
  ('33600000-0000-0000-0000-000000000022', 'edu');

insert into public.teams (id, name, dept_id) values
  ('t-336-ind', 'Echipa Independenta 336', null),
  ('t-336-dt', 'Echipa Departamentala 336', 'edu');

insert into public.team_members (team_id, member_id) values
  ('t-336-ind', '33600000-0000-0000-0000-000000000009');

insert into public.projects (name, status, leader_id, created_by) values
  ('Proiect #336', 'active',
   '33600000-0000-0000-0000-000000000006', '33600000-0000-0000-0000-000000000001');

insert into public.project_members (project_id, member_id, project_role) values
  ((select id from public.projects where name = 'Proiect #336'),
   '33600000-0000-0000-0000-000000000007', 'responsible'),
  ((select id from public.projects where name = 'Proiect #336'),
   '33600000-0000-0000-0000-000000000008', 'member');

-- ---- T1: the happy path. A PUBLIC Department Task in_review, with a live
-- Executor, a PAST Executor whose Assignment the owner already ended
-- 'replaced', and two pending Candidates still in the queue. Every effect of
-- the Evaluation core shows up on this one Task.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, queue_opened_at, started_at, submitted_at, created_by)
values
  ('Evaluare fericita #336', 'Gata de evaluare', '2027-12-01 09:00:00+00', 'edu', 'org', 'public', 'in_review',
   now() - interval '5 days', now() - interval '5 days',
   now() - interval '4 days', now() - interval '1 day',
   '33600000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at, ended_at, end_reason)
select id, '33600000-0000-0000-0000-000000000012', '33600000-0000-0000-0000-000000000002',
       now() - interval '5 days', now() - interval '4 days', 'replaced'
  from public.tasks where title = 'Evaluare fericita #336';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33600000-0000-0000-0000-000000000004', '33600000-0000-0000-0000-000000000002',
       now() - interval '4 days'
  from public.tasks where title = 'Evaluare fericita #336';
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33600000-0000-0000-0000-000000000013'::uuid, 'pending', now() - interval '3 days'
  from public.tasks where title = 'Evaluare fericita #336'
union all
select id, '33600000-0000-0000-0000-000000000014'::uuid, 'pending', now() - interval '2 days'
  from public.tasks where title = 'Evaluare fericita #336';

-- ---- T2-T5: an Umbrella with three Subtasks, two of them in_review. The
-- Umbrella is created by the BCE (02) and evaluated by the BC (01), so
-- private.task_managers returns exactly the creator -- a deterministic
-- single-recipient set for the coalesced rollup notification.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode,
   difficulty, rating, kind, status, created_at, created_by)
values
  ('Umbrela #336', 'Grup de subtaskuri', null, 'edu', null, null,
   null, null, 'umbrella', 'todo', now() - interval '6 days',
   '33600000-0000-0000-0000-000000000002');

insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   parent_task_id, created_at, started_at, submitted_at, created_by)
select 'Subtask unu #336', 'Primul', '2027-12-02 09:00:00+00', 'edu', 'local', 'direct', 'in_review',
       umbrella.id, now() - interval '5 days', now() - interval '4 days', now() - interval '1 day',
       '33600000-0000-0000-0000-000000000002'
  from public.tasks as umbrella where umbrella.title = 'Umbrela #336';
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   parent_task_id, created_at, started_at, submitted_at, created_by)
select 'Subtask doi #336', 'Al doilea', '2027-12-03 09:00:00+00', 'edu', 'local', 'direct', 'in_review',
       umbrella.id, now() - interval '5 days', now() - interval '4 days', now() - interval '1 day',
       '33600000-0000-0000-0000-000000000002'
  from public.tasks as umbrella where umbrella.title = 'Umbrela #336';
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   parent_task_id, created_at, created_by)
select 'Subtask trei #336', 'Al treilea, inca netrimis', '2027-12-04 09:00:00+00', 'edu', 'local', 'direct', 'todo',
       umbrella.id, now() - interval '5 days',
       '33600000-0000-0000-0000-000000000002'
  from public.tasks as umbrella where umbrella.title = 'Umbrela #336';

insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33600000-0000-0000-0000-000000000015'::uuid, '33600000-0000-0000-0000-000000000002'::uuid, now() - interval '4 days'
  from public.tasks where title = 'Subtask unu #336'
union all
select id, '33600000-0000-0000-0000-000000000016'::uuid, '33600000-0000-0000-0000-000000000002'::uuid, now() - interval '4 days'
  from public.tasks where title = 'Subtask doi #336';

-- ---- T6: an OVERDUE Task -- deadline already past while still in_review.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('Intarziat #336', 'Peste termen', now() - interval '3 days', 'edu', 'local', 'direct', 'in_review',
   now() - interval '10 days', now() - interval '9 days', now() - interval '2 days',
   '33600000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33600000-0000-0000-0000-000000000017', '33600000-0000-0000-0000-000000000002', now() - interval '9 days'
  from public.tasks where title = 'Intarziat #336';

-- ---- T7: shared denial target. None of the denied personas mutate it.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('Poarta comuna #336', 'Tinta refuzurilor', '2027-12-05 09:00:00+00', 'edu', 'local', 'direct', 'in_review',
   now() - interval '5 days', now() - interval '4 days', now() - interval '1 day',
   '33600000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33600000-0000-0000-0000-000000000018', '33600000-0000-0000-0000-000000000002', now() - interval '4 days'
  from public.tasks where title = 'Poarta comuna #336';

-- ---- T8: direct-write-denial target.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('Scriere directa #336', 'Tinta interzisa', '2027-12-06 09:00:00+00', 'edu', 'local', 'direct', 'in_review',
   now() - interval '5 days', now() - interval '4 days', now() - interval '1 day',
   '33600000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33600000-0000-0000-0000-000000000019', '33600000-0000-0000-0000-000000000002', now() - interval '4 days'
  from public.tasks where title = 'Scriere directa #336';

-- ---- T9: in_review with NO active Assignment. Unreachable through the
-- commands on main (only an Executor's own submit_task_for_review reaches
-- in_review), but private.evaluate_task is a shared core three later tasks
-- call, so its own PT409 guard is pinned here rather than assumed.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('Fara executant #336', 'Nimeni nu il tine', '2027-12-07 09:00:00+00', 'edu', 'local', 'direct', 'in_review',
   now() - interval '5 days', now() - interval '4 days', now() - interval '1 day',
   '33600000-0000-0000-0000-000000000002');

-- ---- T10/T11: wrong-state targets.
insert into public.tasks (title, description, deadline, dept_id, audience, assignment_mode, status, created_by)
values ('Inca todo #336', 'Nu a inceput', '2027-12-08 09:00:00+00', 'edu', 'local', 'direct', 'todo',
        '33600000-0000-0000-0000-000000000002');
-- #339: tasks_cancel_reason_ck makes cancel_reason mandatory on -- and
-- exclusive to -- a cancelled Task, so this fixture states why it was called
-- off. Nothing else about the fixture changes.
insert into public.tasks (title, description, deadline, dept_id, audience, assignment_mode, status, cancelled_at, cancel_reason, created_by)
values ('Anulat #336', 'Anulat deja', '2027-12-09 09:00:00+00', 'edu', 'local', 'direct', 'cancelled',
        now(), 'Anulat inainte de verificare #336', '33600000-0000-0000-0000-000000000002');

-- ---- T12: input-validation target. Every PT400 below fires against it and
-- must leave it exactly as it is.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('Validare intrari #336', 'Tinta PT400', '2027-12-10 09:00:00+00', 'edu', 'local', 'direct', 'in_review',
   now() - interval '5 days', now() - interval '4 days', now() - interval '1 day',
   '33600000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33600000-0000-0000-0000-000000000020', '33600000-0000-0000-0000-000000000002', now() - interval '4 days'
  from public.tasks where title = 'Validare intrari #336';

-- ---- T13: a DEPARTMENT-TEAM Task -- the local BCE of the Team's parent
-- Department evaluates it (a distinct can_evaluate_task branch).
insert into public.tasks
  (title, description, deadline, team_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('Echipa departamentala #336', 'Munca echipei', '2027-12-11 09:00:00+00', 't-336-dt', 'local', 'direct', 'in_review',
   now() - interval '5 days', now() - interval '4 days', now() - interval '1 day',
   '33600000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33600000-0000-0000-0000-000000000005', '33600000-0000-0000-0000-000000000002', now() - interval '4 days'
  from public.tasks where title = 'Echipa departamentala #336';

-- ---- T14: an INDEPENDENT-TEAM Task executed by one of its own members.
insert into public.tasks
  (title, description, deadline, team_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('Echipa independenta #336', 'Munca echipei independente', '2027-12-12 09:00:00+00', 't-336-ind', 'local', 'direct', 'in_review',
   now() - interval '5 days', now() - interval '4 days', now() - interval '1 day',
   '33600000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33600000-0000-0000-0000-000000000009', '33600000-0000-0000-0000-000000000001', now() - interval '4 days'
  from public.tasks where title = 'Echipa independenta #336';

-- ---- T15/T16: Project Tasks executed by the lead and by the Responsible.
insert into public.tasks
  (title, description, deadline, project_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
select 'Proiect lead executant #336', 'Lead isi evalueaza munca', '2027-12-13 09:00:00+00',
       project.id, 'local', 'direct', 'in_review',
       now() - interval '5 days', now() - interval '4 days', now() - interval '1 day',
       '33600000-0000-0000-0000-000000000001'
  from public.projects as project where project.name = 'Proiect #336';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select task.id, '33600000-0000-0000-0000-000000000006', '33600000-0000-0000-0000-000000000001', now() - interval '4 days'
  from public.tasks as task where task.title = 'Proiect lead executant #336';

insert into public.tasks
  (title, description, deadline, project_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
select 'Proiect responsabil executant #336', 'Responsabilul isi evalueaza munca', '2027-12-14 09:00:00+00',
       project.id, 'local', 'direct', 'in_review',
       now() - interval '5 days', now() - interval '4 days', now() - interval '1 day',
       '33600000-0000-0000-0000-000000000001'
  from public.projects as project where project.name = 'Proiect #336';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select task.id, '33600000-0000-0000-0000-000000000007', '33600000-0000-0000-0000-000000000001', now() - interval '4 days'
  from public.tasks as task where task.title = 'Proiect responsabil executant #336';

-- ---- T17: a NEGATIVE award. rating 1 -> multiplier -1, so difficulty 4
-- credits -4 points, written exactly as computed (ADR-0007's guide).
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('Puncte negative #336', 'Calificativ minim', '2027-12-15 09:00:00+00', 'edu', 'local', 'direct', 'in_review',
   now() - interval '5 days', now() - interval '4 days', now() - interval '1 day',
   '33600000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33600000-0000-0000-0000-000000000021', '33600000-0000-0000-0000-000000000002', now() - interval '4 days'
  from public.tasks where title = 'Puncte negative #336';

-- ---- T18: a ONE-POINT award. rating 3 -> multiplier 1, so Difficulty 1
-- credits exactly 1 point -- the only magnitude at which Romanian takes the
-- singular ("1 punct", never "1 puncte"). The same Task is reused in section
-- 5 as the already-evaluated target of private.evaluate_task's own guard.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('Un singur punct #336', 'Dificultate minima, calificativ suficient', '2027-12-16 09:00:00+00', 'edu', 'local', 'direct', 'in_review',
   now() - interval '5 days', now() - interval '4 days', now() - interval '1 day',
   '33600000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33600000-0000-0000-0000-000000000022', '33600000-0000-0000-0000-000000000002', now() - interval '4 days'
  from public.tasks where title = 'Un singur punct #336';

-- Every fixture id resolved ONCE, as the owner.
create temp table f336 as
select
  9223372036854775807::bigint as missing_id,
  (select id from public.tasks where title = 'Evaluare fericita #336') as happy_task_id,
  (select id from public.tasks where title = 'Umbrela #336') as umbrella_id,
  (select id from public.tasks where title = 'Subtask unu #336') as sub1_id,
  (select id from public.tasks where title = 'Subtask doi #336') as sub2_id,
  (select id from public.tasks where title = 'Subtask trei #336') as sub3_id,
  (select id from public.tasks where title = 'Intarziat #336') as late_task_id,
  (select id from public.tasks where title = 'Poarta comuna #336') as gate_task_id,
  (select id from public.tasks where title = 'Scriere directa #336') as direct_write_task_id,
  (select id from public.tasks where title = 'Fara executant #336') as no_executor_task_id,
  (select id from public.tasks where title = 'Inca todo #336') as todo_task_id,
  (select id from public.tasks where title = 'Anulat #336') as cancelled_task_id,
  (select id from public.tasks where title = 'Validare intrari #336') as inputs_task_id,
  (select id from public.tasks where title = 'Echipa departamentala #336') as dt_task_id,
  (select id from public.tasks where title = 'Echipa independenta #336') as ind_task_id,
  (select id from public.tasks where title = 'Proiect lead executant #336') as proj_lead_task_id,
  (select id from public.tasks where title = 'Proiect responsabil executant #336') as proj_resp_task_id,
  (select id from public.tasks where title = 'Puncte negative #336') as negative_task_id,
  (select id from public.tasks where title = 'Un singur punct #336') as singular_task_id,
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'Evaluare fericita #336' and assignment.ended_at is null) as happy_assignment_id,
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'Evaluare fericita #336' and assignment.ended_at is not null) as past_assignment_id,
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'Scriere directa #336' and assignment.ended_at is null) as direct_write_assignment_id;
grant select on f336 to authenticated, anon;

-- ==================== 1. API shape and privileges ====================

select has_function('public', 'complete_task_review', array['bigint', 'integer', 'integer', 'text'],
  'public.complete_task_review exists with the pinned four-parameter signature');
select is(pg_get_function_identity_arguments(
    'public.complete_task_review(bigint, integer, integer, text)'::regprocedure),
  'p_task_id bigint, p_difficulty integer, p_rating integer, p_note text',
  'complete_task_review exposes no actor parameter -- the actor is always auth.uid()');
select is(pg_get_function_result(
    'public.complete_task_review(bigint, integer, integer, text)'::regprocedure),
  'tasks', 'complete_task_review returns the affected Task row');
select ok(not (select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public' and procedure.proname = 'complete_task_review'),
  'the public command is a security invoker wrapper');
select ok((select bool_and(procedure.prosecdef)
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private'
     and procedure.proname in ('complete_task_review_impl', 'evaluate_task')),
  'private.complete_task_review_impl and private.evaluate_task both run as owner (security definer)');
select ok(coalesce((
    select bool_and('search_path=""' = any(procedure.proconfig))
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private'
       and procedure.proname in ('complete_task_review_impl', 'evaluate_task')
  ), false), 'both new private functions pin an empty search_path');
select ok(has_function_privilege('authenticated',
  'public.complete_task_review(bigint, integer, integer, text)'::regprocedure, 'execute'),
  'authenticated can execute public.complete_task_review');
select ok(not has_function_privilege('anon',
  'public.complete_task_review(bigint, integer, integer, text)'::regprocedure, 'execute'),
  'anon cannot execute public.complete_task_review');
select ok(has_function_privilege('authenticated',
  'private.complete_task_review_impl(bigint, integer, integer, text)'::regprocedure, 'execute'),
  'authenticated can execute private.complete_task_review_impl');
select has_function('private', 'evaluate_task',
  array['bigint', 'text', 'integer', 'integer', 'text', 'uuid'],
  'private.evaluate_task exists with the pinned signature #337/#338/#344 will call');
select ok(not has_function_privilege('authenticated',
  'private.evaluate_task(bigint, text, integer, integer, text, uuid)'::regprocedure, 'execute'),
  'the points-writing core is callable by NOBODY but the definer commands -- authenticated has no grant');
select ok(not has_function_privilege('service_role',
  'private.evaluate_task(bigint, text, integer, integer, text, uuid)'::regprocedure, 'execute'),
  'service_role has no grant on the points-writing core either');

-- ==================== 2. The happy path, end to end ====================
-- One BC call on a public Task with a live Executor, a replaced past
-- Executor and two pending Candidates. Difficulty 3 x rating_mult(4) = 2
-- gives 6 points.

select pg_temp.test_login('33600000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.complete_task_review(%s, 3, 4, '  Foarte bine lucrat  ') $$,
  (select happy_task_id from f336)),
  'BC/Moderator may complete the review of any in_review Task');
reset role;

select is((select format('%s|%s|%s|%s|%s', task.status, (task.completed_at is not null)::text,
                         task.difficulty, task.rating, (task.queue_closed_at is not null)::text)
             from public.tasks as task where task.id = (select happy_task_id from f336)),
  'completed|true|3|4|true',
  'the Task is completed with its Difficulty, Rating, completed_at and -- because it is public -- a closed queue');
select is((select format('%s|%s|%s|%s|%s|%s|%s',
                         evaluation.source, evaluation.outcome, evaluation.difficulty,
                         evaluation.rating, evaluation.points, evaluation.evaluated_by, evaluation.note)
             from public.task_evaluations as evaluation
            where evaluation.task_id = (select happy_task_id from f336)),
  'command|completed|3|4|6|33600000-0000-0000-0000-000000000001|Foarte bine lucrat',
  'exactly one command Evaluation, points = Difficulty x rating_mult(Rating) = 3 x 2, note trimmed');
select is((select count(*) from public.task_evaluations
            where task_id = (select happy_task_id from f336)), 1::bigint,
  'the Evaluation is written once, not once per Assignment the Task ever had');
select is((select evaluation.assignment_id from public.task_evaluations as evaluation
            where evaluation.task_id = (select happy_task_id from f336)),
  (select happy_assignment_id from f336),
  'the Evaluation names the ACTIVE Assignment, never the replaced one');
select is((select format('%s|%s|%s|%s', ledger.member_id, ledger.delta, ledger.reason,
                         (ledger.evaluation_id = (select evaluation.id from public.task_evaluations as evaluation
                                                   where evaluation.task_id = (select happy_task_id from f336)))::text)
             from public.points_ledger as ledger
            where ledger.task_id = (select happy_task_id from f336)),
  '33600000-0000-0000-0000-000000000004|6|task|true',
  'one ledger entry credits the active Executor with the Evaluation''s points and names that Evaluation');
select set_eq(
  format($$ select ledger.member_id from public.points_ledger as ledger where ledger.task_id = %s $$,
    (select happy_task_id from f336)),
  $$ values ('33600000-0000-0000-0000-000000000004'::uuid) $$,
  'the PAST Executor -- whose Assignment the owner ended ''replaced'' before the review -- is credited nothing');

select pg_temp.test_login('33600000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select points from public.my_points), 6,
  'the Executor''s own my_points total reflects the award immediately');
reset role;
select pg_temp.test_login('33600000-0000-0000-0000-000000000012', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select points from public.my_points), 0,
  'the replaced past Executor''s my_points total stays at zero');
reset role;

select is((select format('%s|%s', assignment.end_reason,
                         (assignment.ended_at = (select task.completed_at from public.tasks as task
                                                  where task.id = (select happy_task_id from f336)))::text)
             from public.task_assignments as assignment
            where assignment.id = (select happy_assignment_id from f336)),
  'completed|true',
  'the active Assignment is ended ''completed'' at exactly the Task''s completed_at (both now(), conventions Sec7)');
select is((select format('%s|%s', assignment.end_reason, assignment.end_note)
             from public.task_assignments as assignment
            where assignment.id = (select past_assignment_id from f336)),
  'replaced|',
  'the past Assignment is left exactly as it was');
select set_eq(
  format($$ select format('%%s|%%s|%%s', candidate.member_id, candidate.status,
                          (candidate.decided_by is null)::text)
              from public.task_candidates as candidate where candidate.task_id = %s $$,
    (select happy_task_id from f336)),
  $$ values ('33600000-0000-0000-0000-000000000013|closed|true'),
            ('33600000-0000-0000-0000-000000000014|closed|true') $$,
  'both pending Candidatures are closed automatically -- decided_by null marks a close nobody chose');
select is((select format('%s|%s|%s|%s|%s|%s', activity.kind, activity.actor_id,
                         (activity.assignment_id = (select happy_assignment_id from f336))::text,
                         activity.from_status, activity.to_status, activity.note)
             from public.task_activity as activity
            where activity.task_id = (select happy_task_id from f336)),
  'evaluated|33600000-0000-0000-0000-000000000001|true|in_review|completed|Foarte bine lucrat',
  'one evaluated activity row names the evaluator, carries the Assignment id, the in_review -> completed transition and the trimmed note');
select is((select format('%s|%s|%s|%s',
                         (activity.details ->> 'evaluation_id' = (select evaluation.id::text from public.task_evaluations as evaluation
                                                                   where evaluation.task_id = (select happy_task_id from f336)))::text,
                         activity.details ->> 'difficulty', activity.details ->> 'rating',
                         activity.details ->> 'points')
             from public.task_activity as activity
            where activity.task_id = (select happy_task_id from f336)),
  'true|3|4|6',
  'details carries the Evaluation id and the three numbers the award was made from');
select is((select count(*) from public.task_activity
            where task_id = (select happy_task_id from f336)), 1::bigint,
  'exactly one activity row -- closing the queue as a side effect of completion logs nothing of its own');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s $$, (select happy_task_id from f336)),
  $$ values ('33600000-0000-0000-0000-000000000004'::uuid),
            ('33600000-0000-0000-0000-000000000013'::uuid),
            ('33600000-0000-0000-0000-000000000014'::uuid) $$,
  'exactly the Executor and the two closed Candidates are notified -- the BC evaluator hears nothing about their own action, and the past Executor nothing at all');
select is((select format('%s|%s', notification.title, notification.body)
             from public.notifications as notification
            where notification.task_id = (select happy_task_id from f336)
              and notification.member_id = '33600000-0000-0000-0000-000000000004'),
  'Task evaluat: Evaluare fericita #336|6 puncte (dificultate 3, calificativ 4).',
  'the Executor gets the pinned "Task evaluat" copy naming points, Difficulty and Rating');
select is((select format('%s|%s', notification.title, notification.body)
             from public.notifications as notification
            where notification.task_id = (select happy_task_id from f336)
              and notification.member_id = '33600000-0000-0000-0000-000000000013'),
  'Coadă închisă: Evaluare fericita #336|Nu mai poți fi selectat pentru acest task.',
  'each closed Candidate gets the pinned "Coadă închisă" copy');

-- Resolved as the owner, for the direct-write denial in section 10: never
-- read task_evaluations from inside a format() while a persona is logged in
-- (that table has no grants at all, so the read itself would error).
create temp table e336 as
select (select evaluation.id from public.task_evaluations as evaluation
         where evaluation.task_id = (select happy_task_id from f336)) as happy_evaluation_id;
grant select on e336 to authenticated;

-- ==================== 3. A negative award is written as computed ====================
-- rating 1 -> multiplier -1 (ADR-0007's guide), so Difficulty 4 credits -4.
-- Also the plain-Department local BCE branch of can_evaluate_task.

select pg_temp.test_login('33600000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.complete_task_review(%s, 4, 1, 'Nu a corespuns asteptarilor') $$,
  (select negative_task_id from f336)),
  'the local BCE of the Task''s own Department may complete its review');
reset role;
select is((select format('%s|%s', evaluation.points,
                         (select ledger.delta from public.points_ledger as ledger
                           where ledger.evaluation_id = evaluation.id and ledger.reason = 'task'))
             from public.task_evaluations as evaluation
            where evaluation.task_id = (select negative_task_id from f336)),
  '-4|-4',
  'a negative award is recorded and credited exactly as computed -- never clamped to zero');
select is((select notification.body from public.notifications as notification
            where notification.task_id = (select negative_task_id from f336)),
  '-4 puncte (dificultate 4, calificativ 1).',
  'the Executor is told the negative award in the same pinned copy');
select is((select task.status::text from public.tasks as task
            where task.id = (select negative_task_id from f336)),
  'completed',
  'a negative award still COMPLETES the Task -- outcome and points are independent (ADR-0007)');

-- ==================== 3b. A ONE-point award reads as Romanian, not as a template ====================
-- public.rating_mult maps Rating 1..5 to -1, 0, 1, 2, 3, so with Difficulty
-- 1..5 the award is bounded to -5..15. Magnitude 1 is reachable both ways
-- (Difficulty 1 x Rating 3 = +1, Difficulty 1 x Rating 1 = -1) and is the only
-- case Romanian writes in the singular. The `de puncte` form (20 upward) is
-- unreachable at this range and is deliberately not implemented.

select pg_temp.test_login('33600000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.complete_task_review(%s, 1, 3, 'Suficient, dar minim') $$,
  (select singular_task_id from f336)),
  'the smallest positive award the guide can produce -- Difficulty 1 x rating_mult(3) = 1 -- is an ordinary completion');
reset role;
select is((select evaluation.points from public.task_evaluations as evaluation
            where evaluation.task_id = (select singular_task_id from f336)),
  1, 'Difficulty 1 x rating_mult(3) really is exactly one point');
select is((select notification.body from public.notifications as notification
            where notification.task_id = (select singular_task_id from f336)
              and notification.member_id = '33600000-0000-0000-0000-000000000022'),
  '1 punct (dificultate 1, calificativ 3).',
  'the Executor is told "1 punct" -- Romanian takes the singular at magnitude 1, so the points fragment agrees with the number instead of always reading "puncte"');
select ok((select notification.body not like '%puncte%' from public.notifications as notification
            where notification.task_id = (select singular_task_id from f336)
              and notification.member_id = '33600000-0000-0000-0000-000000000022'),
  'and never "1 puncte" -- the plural form does not appear in a one-point body at all');

-- ==================== 4. Input validation ====================

select pg_temp.test_login('33600000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, null) $$,
  (select inputs_task_id from f336)),
  'PT400', 'evaluation_note_required', 'a null note is rejected');
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, '   ') $$,
  (select inputs_task_id from f336)),
  'PT400', 'evaluation_note_required', 'a whitespace-only note is rejected');
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, E'\t\t') $$,
  (select inputs_task_id from f336)),
  'PT400', 'evaluation_note_required', 'a tab-only note is rejected -- regexp_replace catches what btrim would not');
select throws_ok(format($$ select public.complete_task_review(%s, null, 4, 'Nota') $$,
  (select inputs_task_id from f336)),
  'PT400', 'invalid_difficulty', 'a null Difficulty is rejected');
select throws_ok(format($$ select public.complete_task_review(%s, 0, 4, 'Nota') $$,
  (select inputs_task_id from f336)),
  'PT400', 'invalid_difficulty', 'Difficulty 0 is below the guide''s range');
select throws_ok(format($$ select public.complete_task_review(%s, 6, 4, 'Nota') $$,
  (select inputs_task_id from f336)),
  'PT400', 'invalid_difficulty', 'Difficulty 6 is above the guide''s range');
select throws_ok(format($$ select public.complete_task_review(%s, 3, null, 'Nota') $$,
  (select inputs_task_id from f336)),
  'PT400', 'invalid_rating', 'a null Rating is rejected');
select throws_ok(format($$ select public.complete_task_review(%s, 3, 0, 'Nota') $$,
  (select inputs_task_id from f336)),
  'PT400', 'invalid_rating', 'Rating 0 is below the guide''s range');
select throws_ok(format($$ select public.complete_task_review(%s, 3, 6, 'Nota') $$,
  (select inputs_task_id from f336)),
  'PT400', 'invalid_rating', 'Rating 6 is above the guide''s range');
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, '') $$,
  (select missing_id from f336)),
  'PT400', 'evaluation_note_required',
  'the note check runs before the target is even looked up -- an unknown id with a blank note is still PT400, never PT404');
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Nota valida') $$,
  (select missing_id from f336)),
  'PT404', 'task_not_found', 'an unknown Task id is not found once the note is valid');
reset role;

select pg_temp.test_login('33600000-0000-0000-0000-000000000011',
  jsonb_build_object('provider', 'email'));
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, '  ') $$,
  (select gate_task_id from f336)),
  'PT400', 'evaluation_note_required',
  'the note check runs before the gate too -- a claimless caller with a blank note gets PT400, not 42501');
-- Whole-wave review, finding 5: the two numeric inputs were hoisted to step 1
-- beside the note, so that all three callers of private.evaluate_task answer a
-- malformed Difficulty or Rating identically. Both are asserted: with only one
-- of them pinned the other could be pushed back below the gate unnoticed.
select throws_ok(format($$ select public.complete_task_review(%s, 9, 4, 'Nota valida') $$,
  (select gate_task_id from f336)),
  'PT400', 'invalid_difficulty',
  'and so does the Difficulty range check -- a claimless caller with Difficulty 9 gets PT400, not 42501 (finding 5: this is what approve_completed_work_request already did)');
select throws_ok(format($$ select public.complete_task_review(%s, 3, 9, 'Nota valida') $$,
  (select gate_task_id from f336)),
  'PT400', 'invalid_rating',
  'and the Rating range check with it -- a claimless caller with Rating 9 gets PT400, not 42501');
reset role;

select is((select format('%s|%s|%s', task.status, task.difficulty, task.rating)
             from public.tasks as task where task.id = (select inputs_task_id from f336)),
  'in_review||',
  'every rejected call left the target Task exactly as it was');
select is((select count(*) from public.task_evaluations
            where task_id = (select inputs_task_id from f336))
        + (select count(*) from public.points_ledger
            where task_id = (select inputs_task_id from f336))
        + (select count(*) from public.task_activity
            where task_id = (select inputs_task_id from f336))
        + (select count(*) from public.notifications
            where task_id = (select inputs_task_id from f336)), 0::bigint,
  'and wrote no Evaluation, no ledger entry, no activity row and no notification -- a rejected input is silent on every surface, the same rule section 6 applies to a denied persona');

-- ==================== 5. State preconditions ====================

select pg_temp.test_login('33600000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Nota') $$,
  (select todo_task_id from f336)),
  'PT409', 'task_not_in_review', 'a todo Task was never submitted, so there is no review to complete');
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Nota') $$,
  (select cancelled_task_id from f336)),
  'PT409', 'task_not_in_review', 'a cancelled Task cannot be evaluated -- one reason covers every non-in_review status');
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Nota') $$,
  (select happy_task_id from f336)),
  'PT409', 'task_not_in_review', 'an already-completed Task cannot be evaluated a second time');
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Nota') $$,
  (select umbrella_id from f336)),
  'PT409', 'task_is_umbrella',
  'an Umbrella answers its own reason, checked before the status check -- its completion is a Subtask rollup, never an Evaluation');
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Nota') $$,
  (select no_executor_task_id from f336)),
  'PT409', 'task_has_no_executor',
  'private.evaluate_task refuses to award points with no active Assignment to credit -- the shared core''s own guard');
reset role;

select is((select count(*) from public.task_evaluations
            where task_id in (select todo_task_id from f336)
               or task_id in (select cancelled_task_id from f336)
               or task_id in (select umbrella_id from f336)
               or task_id in (select no_executor_task_id from f336)), 0::bigint,
  'none of the state-rejected calls wrote an Evaluation');
select is((select count(*) from public.task_evaluations
            where task_id = (select happy_task_id from f336)), 1::bigint,
  'and the second attempt on the already-completed Task did not add a second Evaluation to it');

-- The shared core's OWN guard against a second Evaluation, asserted by calling
-- private.evaluate_task directly as the owner -- the only way to reach it,
-- since complete_task_review answers task_not_in_review first. #337/#338/#344
-- each reach the core by a different route, and one that forgot its own state
-- precondition must get a pinned reason, never a raw 23505 off
-- task_evaluations_one_open_per_task_uidx. The section-3b Task already carries
-- an open command Evaluation; giving it a fresh ACTIVE Assignment removes the
-- task_has_no_executor answer, so the new guard is the only thing left that
-- can stop the second Evaluation -- without it this call reaches the insert
-- and raises 23505.
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select (select singular_task_id from f336), '33600000-0000-0000-0000-000000000022',
       '33600000-0000-0000-0000-000000000002', now();
select throws_ok(format($$ select private.evaluate_task(
    %s, 'completed', 5, 5, 'A doua evaluare', '33600000-0000-0000-0000-000000000001') $$,
  (select singular_task_id from f336)),
  'PT409', 'task_already_evaluated',
  'private.evaluate_task refuses a Task that already carries an open command Evaluation -- the wave''s error vocabulary, not a unique_violation leaked to the client');

-- ==================== 6. The persona matrix -- denied ====================

select pg_temp.test_login('33600000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Incercare respinsa') $$,
  (select proj_lead_task_id from f336)),
  '42501', 'task_evaluate_forbidden', 'a Project Responsible may not evaluate the lead''s own work');
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Incercare respinsa') $$,
  (select proj_resp_task_id from f336)),
  '42501', 'task_evaluate_forbidden', 'a Project Responsible may not evaluate their own work either -- nobody awards themselves points');
reset role;

select pg_temp.test_login('33600000-0000-0000-0000-000000000009', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb,
  'team_ids', '["t-336-ind"]'::jsonb));
select is((select private.can_manage_task((select ind_task_id from f336))), true,
  'an Independent-Team member DOES manage their own Team''s Task');
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Incercare respinsa') $$,
  (select ind_task_id from f336)),
  '42501', 'task_evaluate_forbidden',
  'but the same member may NOT award its points -- an Independent Team has no evaluator branch at all; BC/Moderator evaluates there');
reset role;

select pg_temp.test_login('33600000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["pr"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Incercare respinsa') $$,
  (select gate_task_id from f336)),
  '42501', 'task_evaluate_forbidden', 'a BCE of a DIFFERENT Department does not evaluate an EDU Task');
reset role;

select pg_temp.test_login('33600000-0000-0000-0000-000000000018', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Imi dau singur puncte') $$,
  (select gate_task_id from f336)),
  '42501', 'task_evaluate_forbidden', 'the active Executor cannot evaluate their own submission and award themselves points');
reset role;

select pg_temp.test_login('33600000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Incercare respinsa') $$,
  (select proj_resp_task_id from f336)),
  'PT404', 'task_not_found',
  'a plain Project member evaluates nothing on their Project -- and because private.can_read_task does not admit them to a DIRECT Project Task at all (#313''s R1-R7: they are neither lead, Responsible, Executor, Candidate nor a Team member), the gate answers the non-disclosing PT404 before authority is ever reached, exactly as conventions Sec3 requires');
reset role;

select pg_temp.test_login('33600000-0000-0000-0000-000000000010', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Incercare respinsa') $$,
  (select gate_task_id from f336)),
  '42501', 'task_command_forbidden', 'a deactivated BC holding a still-valid level-6 token is stopped at the gate');
reset role;

select pg_temp.test_login('33600000-0000-0000-0000-000000000011',
  jsonb_build_object('provider', 'email'));
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Incercare respinsa') $$,
  (select gate_task_id from f336)),
  '42501', 'task_command_forbidden', 'a real uid without organisation claims is stopped at the gate too');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Incercare respinsa') $$,
  (select gate_task_id from f336)),
  '42501', 'permission denied for function complete_task_review',
  'anon cannot execute complete_task_review at all -- the literal grant denial, not a gate that happens to raise 42501');
reset role;

select is((select count(*) from public.task_evaluations
            where task_id in (select gate_task_id from f336)
               or task_id in (select ind_task_id from f336)
               or task_id in (select proj_lead_task_id from f336)
               or task_id in (select proj_resp_task_id from f336)), 0::bigint,
  'no denied persona wrote an Evaluation');
select is((select count(*) from public.points_ledger
            where task_id in (select gate_task_id from f336)
               or task_id in (select ind_task_id from f336)
               or task_id in (select proj_lead_task_id from f336)
               or task_id in (select proj_resp_task_id from f336)), 0::bigint,
  'and none of them moved a single point');
select is((select count(*) from public.task_activity
            where task_id in (select gate_task_id from f336)
               or task_id in (select ind_task_id from f336)
               or task_id in (select proj_lead_task_id from f336)
               or task_id in (select proj_resp_task_id from f336))
        + (select count(*) from public.notifications
            where task_id in (select gate_task_id from f336)
               or task_id in (select ind_task_id from f336)
               or task_id in (select proj_lead_task_id from f336)
               or task_id in (select proj_resp_task_id from f336)), 0::bigint,
  'and wrote neither an activity row nor a notification');
select is((select count(*) from public.tasks
            where (id in (select gate_task_id from f336)
               or id in (select ind_task_id from f336)
               or id in (select proj_lead_task_id from f336)
               or id in (select proj_resp_task_id from f336))
              and status = 'in_review'), 4::bigint,
  'all four denied-target Tasks are still in_review, untouched');

-- ==================== 7. The persona matrix -- allowed ====================

select pg_temp.test_login('33600000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.complete_task_review(%s, 5, 5, 'Mi-am terminat partea') $$,
  (select proj_lead_task_id from f336)),
  'the Project lead may evaluate their OWN active Assignment -- the one place a self-evaluation is allowed (ADR-0007)');
reset role;
select is((select format('%s|%s', task.status, (select ledger.delta from public.points_ledger as ledger
                                                 where ledger.task_id = task.id))
             from public.tasks as task where task.id = (select proj_lead_task_id from f336)),
  'completed|15',
  'the lead credits themselves 5 x rating_mult(5) = 15 points, recorded like any other award');
select is((select count(*) from public.notifications
            where task_id = (select proj_lead_task_id from f336)), 0::bigint,
  'the lead is both actor and Executor -- private.notify drops the actor, so a self-evaluation notifies nobody');

select pg_temp.test_login('33600000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.complete_task_review(%s, 2, 3, 'Bine facut') $$,
  (select dt_task_id from f336)),
  'the local BCE of a Department-Team''s PARENT Department may evaluate the Team''s Task -- a distinct branch from the plain Department one');
reset role;
select is((select format('%s|%s', evaluation.points, evaluation.evaluated_by)
             from public.task_evaluations as evaluation
            where evaluation.task_id = (select dt_task_id from f336)),
  '2|33600000-0000-0000-0000-000000000002',
  'the Team Task''s Evaluation credits 2 x rating_mult(3) = 2 points and names the BCE who made it');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s $$, (select dt_task_id from f336)),
  $$ values ('33600000-0000-0000-0000-000000000005'::uuid) $$,
  'exactly the Team Task''s Executor is notified -- a direct Task closes no queue, so there is nobody else');

-- ==================== 8. Subtask rollup onto the Umbrella ====================
-- Two of three Subtasks are completed one after the other. Each writes its
-- own subtask_completed row on the Umbrella; both notifications COALESCE onto
-- one row through the dedupe key task:{umbrella}:subtasks.

select pg_temp.test_login('33600000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.complete_task_review(%s, 2, 4, 'Primul subtask e gata') $$,
  (select sub1_id from f336)),
  'a Subtask is completed exactly like any other Task');
reset role;

select is((select format('%s|%s|%s|%s|%s', activity.kind, activity.actor_id,
                         (activity.assignment_id is null)::text,
                         (activity.from_status is null)::text, (activity.to_status is null)::text)
             from public.task_activity as activity
            where activity.task_id = (select umbrella_id from f336)),
  'subtask_completed|33600000-0000-0000-0000-000000000001|true|true|true',
  'the Umbrella gets a subtask_completed row with no assignment id and no status transition of its own (stack-context.md''s activity-row rule)');
select is((select format('%s|%s|%s|%s',
                         (activity.details ->> 'subtask_id' = (select sub1_id::text from f336))::text,
                         activity.details ->> 'outcome',
                         activity.details ->> 'terminal_count',
                         activity.details ->> 'subtask_count')
             from public.task_activity as activity
            where activity.task_id = (select umbrella_id from f336)),
  'true|completed|1|3',
  'details names the Subtask, its outcome, and how many of the Umbrella''s three Subtasks are now terminal');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s $$, (select umbrella_id from f336)),
  $$ values ('33600000-0000-0000-0000-000000000002'::uuid) $$,
  'exactly private.task_managers of the Umbrella -- its creator, who is not the actor -- is told');
select is((select format('%s|%s|%s', notification.dedupe_key, notification.title, notification.body)
             from public.notifications as notification
            where notification.task_id = (select umbrella_id from f336)),
  format('task:%s:subtasks|Subtask încheiat: Umbrela #336|1 din 3 subtaskuri încheiate.',
         (select umbrella_id from f336)),
  'the rollup notification carries the pinned dedupe key, title and progress body');

select pg_temp.test_login('33600000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.complete_task_review(%s, 3, 3, 'Al doilea subtask e gata') $$,
  (select sub2_id from f336)),
  'the second Subtask is completed too');
reset role;

select is((select count(*) from public.notifications
            where task_id = (select umbrella_id from f336)), 1::bigint,
  'the manager still has exactly ONE rollup notification -- the dedupe key coalesced the second one onto the first');
select is((select notification.body from public.notifications as notification
            where notification.task_id = (select umbrella_id from f336)),
  '2 din 3 subtaskuri încheiate.',
  'and that one row now carries the newer count');
select is((select count(*) from public.task_activity
            where task_id = (select umbrella_id from f336)
              and kind = 'subtask_completed'), 2::bigint,
  'the ACTIVITY history is not coalesced -- each Subtask''s completion keeps its own row');
select is((select activity.details ->> 'terminal_count' from public.task_activity as activity
            where activity.task_id = (select umbrella_id from f336)
            order by activity.occurred_at desc, activity.id desc limit 1),
  '2', 'the newer subtask_completed row records the higher terminal count');
select is((select format('%s|%s|%s|%s', task.status, task.kind,
                         (task.difficulty is null)::text, (task.rating is null)::text)
             from public.tasks as task where task.id = (select umbrella_id from f336)),
  'todo|umbrella|true|true',
  'the Umbrella itself is untouched -- it is never evaluated, only reported on (#340 owns its completion)');
select is((select count(*) from public.task_evaluations
            where task_id = (select umbrella_id from f336))
        + (select count(*) from public.points_ledger
            where task_id = (select umbrella_id from f336)), 0::bigint,
  'and carries no Evaluation and no points of its own');

-- ==================== 9. Lateness is simply queryable ====================

select pg_temp.test_login('33600000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.complete_task_review(%s, 3, 3, 'Tarziu, dar facut') $$,
  (select late_task_id from f336)),
  'a Task past its deadline is completed like any other -- lateness is not a precondition');
reset role;
select is((select task.completed_at > task.deadline from public.tasks as task
            where task.id = (select late_task_id from f336)), true,
  'whether the work was late is simply completed_at > deadline -- no column records it (#336 ruling)');
select is((select task.completed_at > task.deadline from public.tasks as task
            where task.id = (select happy_task_id from f336)), false,
  'and an on-time Task answers the same question false, through the same expression');

-- ==================== 10. The command is the only write path ====================

select pg_temp.test_login('33600000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ insert into public.task_evaluations
  (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
  values (%s, %s, '33600000-0000-0000-0000-000000000002', 'completed', 5, 5, 15, 'Fals') $$,
  (select direct_write_task_id from f336), (select direct_write_assignment_id from f336)),
  '42501', null,
  'even the Task''s own evaluator cannot write an Evaluation directly -- private.evaluate_task is the only path');
select throws_ok(format($$ insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id)
  values ('33600000-0000-0000-0000-000000000019', 99, 'task', %s, %s) $$,
  (select direct_write_task_id from f336), (select happy_evaluation_id from e336)),
  '42501', null,
  'and cannot credit points directly either -- points_ledger_create_sanction is the only insert policy and it demands reason = sanction');
reset role;

select pg_temp.test_login('33600000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id)
  values ('33600000-0000-0000-0000-000000000019', 99, 'task', %s, %s) $$,
  (select direct_write_task_id from f336), (select happy_evaluation_id from e336)),
  '42501', null,
  'not even a BC can hand-write a task ledger row -- level 6 buys sanctions, never awards');
reset role;

select is((select count(*) from public.task_evaluations
            where task_id = (select direct_write_task_id from f336)), 0::bigint,
  'the direct-write target carries no Evaluation after those attempts');

-- ==================== 11. Locks held while the command runs ====================
-- Sections 11-13 work on COMMITTED fixtures through their own dblink
-- connection: pg_temp.test_race commits both of its sessions for real, so
-- nothing this suite's own rolled-back transaction created is visible to
-- them.
--
-- Honest limitation, established by mutation rather than assumed: only the
-- tasks-row assertion discriminates. The Assignment row is UPDATEd by
-- private.end_task_assignment a moment later inside the same held
-- transaction, so deleting evaluate_task's `for update` keyword leaves an
-- equivalent exclusive row lock in place and that assertion stays green -- it
-- documents the lock, it does not prove the keyword. Section 12's race is
-- what actually detects the tasks-row lock.
select extensions.dblink_connect('ctr_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));

select extensions.dblink_exec('ctr_setup', $$
  set session_replication_role = 'replica';
  delete from public.points_ledger
   where task_id in (select id from public.tasks where title like '%#336 committed%');
  delete from public.task_evaluations
   where task_id in (select id from public.tasks where title like '%#336 committed%');
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#336 committed%');
  set session_replication_role = 'origin';
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#336 committed%')
      or member_id in ('33600000-0000-0000-0000-000000000051',
                       '33600000-0000-0000-0000-000000000052',
                       '33600000-0000-0000-0000-000000000053',
                       '33600000-0000-0000-0000-000000000054',
                       '33600000-0000-0000-0000-000000000055');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%#336 committed%');
  delete from public.tasks
   where parent_task_id in (select id from public.tasks where title like '%#336 committed%');
  delete from public.tasks where title like '%#336 committed%';
  delete from public.member_departments where member_id in (
    '33600000-0000-0000-0000-000000000051', '33600000-0000-0000-0000-000000000052',
    '33600000-0000-0000-0000-000000000053', '33600000-0000-0000-0000-000000000054',
    '33600000-0000-0000-0000-000000000055');
  delete from auth.users where id in (
    '33600000-0000-0000-0000-000000000051', '33600000-0000-0000-0000-000000000052',
    '33600000-0000-0000-0000-000000000053', '33600000-0000-0000-0000-000000000054',
    '33600000-0000-0000-0000-000000000055');

  insert into auth.users (id, email) values
    ('33600000-0000-0000-0000-000000000051', 'probe.evaluator.336@test.local'),
    ('33600000-0000-0000-0000-000000000052', 'probe.manager.336@test.local'),
    ('33600000-0000-0000-0000-000000000053', 'probe.executor.336@test.local'),
    ('33600000-0000-0000-0000-000000000054', 'race.sub1.336@test.local'),
    ('33600000-0000-0000-0000-000000000055', 'race.sub2.336@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('33600000-0000-0000-0000-000000000051', 'Probe Evaluator 336', 'probe.evaluator.336@test.local', 'bce', 'activ'),
    ('33600000-0000-0000-0000-000000000052', 'Probe Manager 336', 'probe.manager.336@test.local', 'voluntar', 'activ'),
    ('33600000-0000-0000-0000-000000000053', 'Probe Executor 336', 'probe.executor.336@test.local', 'voluntar', 'activ'),
    ('33600000-0000-0000-0000-000000000054', 'Cursa Subtask Unu 336', 'race.sub1.336@test.local', 'voluntar', 'activ'),
    ('33600000-0000-0000-0000-000000000055', 'Cursa Subtask Doi 336', 'race.sub2.336@test.local', 'voluntar', 'activ');
  insert into public.member_departments (member_id, dept_id) values
    ('33600000-0000-0000-0000-000000000051', 'edu'),
    ('33600000-0000-0000-0000-000000000052', 'edu'),
    ('33600000-0000-0000-0000-000000000053', 'edu'),
    ('33600000-0000-0000-0000-000000000054', 'edu'),
    ('33600000-0000-0000-0000-000000000055', 'edu');

  insert into public.tasks
    (title, description, deadline, dept_id, audience, assignment_mode, status,
     created_at, started_at, submitted_at, created_by)
  values
    ('Cursa dubla evaluare #336 committed', 'Doi evaluatori, un task', '2027-12-21 09:00:00+00', 'edu', 'local', 'direct', 'in_review',
     now() - interval '5 days', now() - interval '4 days', now() - interval '1 day',
     '33600000-0000-0000-0000-000000000052');

  insert into public.tasks
    (title, description, deadline, dept_id, audience, assignment_mode,
     difficulty, rating, kind, status, created_at, created_by)
  values
    ('Umbrela sonda #336 committed', 'Umbrela pentru sonda de blocaj', null, 'edu', null, null,
     null, null, 'umbrella', 'todo', now() - interval '6 days',
     '33600000-0000-0000-0000-000000000052'),
    ('Umbrela cursa #336 committed', 'Umbrela pentru cursa fratilor', null, 'edu', null, null,
     null, null, 'umbrella', 'todo', now() - interval '6 days',
     '33600000-0000-0000-0000-000000000052');

  -- The lock probe runs on a SUBTASK, so the same held transaction can be
  -- asked whether it took any exclusive lock on the parent Umbrella. It must
  -- not have (Global Constraints' lock order; private.evaluate_task never
  -- locks the parent) -- the FOR KEY SHARE that its own task_activity and
  -- notifications foreign keys take is expected and harmless.
  insert into public.tasks
    (title, description, deadline, dept_id, audience, assignment_mode, status,
     parent_task_id, created_at, started_at, submitted_at, created_by)
  select 'Sonda blocaj evaluare #336 committed', 'Sonda', '2027-12-20 09:00:00+00', 'edu', 'local', 'direct', 'in_review',
         umbrella.id, now() - interval '5 days', now() - interval '4 days', now() - interval '1 day',
         '33600000-0000-0000-0000-000000000052'
    from public.tasks as umbrella where umbrella.title = 'Umbrela sonda #336 committed';

  insert into public.tasks
    (title, description, deadline, dept_id, audience, assignment_mode, status,
     parent_task_id, created_at, started_at, submitted_at, created_by)
  select 'Subtask cursa unu #336 committed', 'Frate 1', '2027-12-22 09:00:00+00'::timestamptz,
         'edu', 'local', 'direct', 'in_review'::public.task_status,
         umbrella.id, now() - interval '5 days', now() - interval '4 days', now() - interval '1 day',
         '33600000-0000-0000-0000-000000000052'::uuid
    from public.tasks as umbrella where umbrella.title = 'Umbrela cursa #336 committed'
  union all
  select 'Subtask cursa doi #336 committed', 'Frate 2', '2027-12-23 09:00:00+00'::timestamptz,
         'edu', 'local', 'direct', 'in_review'::public.task_status,
         umbrella.id, now() - interval '5 days', now() - interval '4 days', now() - interval '1 day',
         '33600000-0000-0000-0000-000000000052'::uuid
    from public.tasks as umbrella where umbrella.title = 'Umbrela cursa #336 committed';

  insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
  select id, '33600000-0000-0000-0000-000000000053'::uuid, '33600000-0000-0000-0000-000000000052'::uuid,
         now() - interval '4 days'
    from public.tasks where title = 'Sonda blocaj evaluare #336 committed'
  union all
  select id, '33600000-0000-0000-0000-000000000053'::uuid, '33600000-0000-0000-0000-000000000052'::uuid,
         now() - interval '4 days'
    from public.tasks where title = 'Cursa dubla evaluare #336 committed'
  union all
  select id, '33600000-0000-0000-0000-000000000054'::uuid, '33600000-0000-0000-0000-000000000052'::uuid,
         now() - interval '4 days'
    from public.tasks where title = 'Subtask cursa unu #336 committed'
  union all
  select id, '33600000-0000-0000-0000-000000000055'::uuid, '33600000-0000-0000-0000-000000000052'::uuid,
         now() - interval '4 days'
    from public.tasks where title = 'Subtask cursa doi #336 committed';
$$);

-- Resolved as the owner, before any persona logs in (the #328 trap again).
create temp table r336 as
select (select id from public.tasks where title = 'Sonda blocaj evaluare #336 committed') as probe_task_id,
       (select id from public.tasks where title = 'Umbrela sonda #336 committed') as probe_umbrella_id,
       (select id from public.tasks where title = 'Cursa dubla evaluare #336 committed') as double_task_id,
       (select id from public.tasks where title = 'Umbrela cursa #336 committed') as race_umbrella_id,
       (select id from public.tasks where title = 'Subtask cursa unu #336 committed') as race_sub1_id,
       (select id from public.tasks where title = 'Subtask cursa doi #336 committed') as race_sub2_id,
       (select assignment.id from public.task_assignments as assignment
          join public.tasks as task on task.id = assignment.task_id
         where task.title = 'Sonda blocaj evaluare #336 committed'
           and assignment.ended_at is null) as probe_assignment_id;
grant select on r336 to authenticated;

select extensions.dblink_connect('ctr_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('ctr_lock', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('ctr_lock', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '33600000-0000-0000-0000-000000000051', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'bce', 'member_level', 5,
      'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text, true)
$$) as remote_claims(setting text);
select extensions.dblink_exec('ctr_lock', 'set local role authenticated');
-- WARNING to whoever copies this block (#337/#338/#344 will): `(f(...)).field`
-- is safe ONLY while exactly ONE field is projected. PostgreSQL expands
-- `(f(x)).a, (f(x)).b` into TWO calls, which here would run the command twice
-- and make the second one raise. Need a second field? Put the call in a
-- subquery or a CTE first and project from that.
select * from extensions.dblink('ctr_lock', format($$
  select (public.complete_task_review(%s, 3, 4, 'Sonda de blocaj')).status::text
$$, (select probe_task_id from r336))) as locked_review(status text);

select ok(coalesce((
  select row_lock.modes && array['For Update', 'Update', 'No Key Update']
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_task_id from r336)
), false), 'complete_task_review holds the target Task row exclusively locked while it runs -- the tasks-row-first serialization point every command in the wave shares');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.profiles') as row_lock
    join public.profiles as profile on profile.ctid = row_lock.locked_row
   where profile.id = '33600000-0000-0000-0000-000000000051'
), false), 'it holds the evaluator''s own live profile row FOR SHARE (private.require_origin_manager''s discipline)');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.member_departments') as row_lock
    join public.member_departments as membership on membership.ctid = row_lock.locked_row
   where membership.member_id = '33600000-0000-0000-0000-000000000051'
     and membership.dept_id = 'edu'
), false), 'and the Department membership their evaluator authority rests on FOR SHARE too, since a BCE reaches that branch');
select ok(coalesce((
  select bool_or(row_lock.modes && array['For Update', 'Update', 'No Key Update'])
    from extensions.pgrowlocks('public.task_assignments') as row_lock
    join public.task_assignments as assignment on assignment.ctid = row_lock.locked_row
   where assignment.id = (select probe_assignment_id from r336)
), false), 'the Assignment being credited is held exclusively -- private.evaluate_task locks it FOR UPDATE before writing the Evaluation and the ledger entry');
select ok(not coalesce((
  select bool_or(row_lock.modes && array['For Update', 'Update', 'No Key Update'])
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_umbrella_id from r336)
), false), 'the probe Task is a Subtask, and its Umbrella is NOT exclusively locked -- private.evaluate_task deliberately never locks the parent (Global Constraints'' lock order); only the FOR KEY SHARE its own activity/notification foreign keys take is present');

select extensions.dblink_exec('ctr_lock', 'rollback');
select extensions.dblink_disconnect('ctr_lock');

-- ==================== 12. Race: two evaluators, one in_review Task ====================
-- The scenario the tasks-row FOR UPDATE exists for. pg_temp.test_race runs A
-- to completion, sends B while A is still uncommitted, waits until B blocks,
-- then commits A and fetches B's result. B's error propagates out of
-- extensions.dblink_get_result and cannot be caught in SQL, so the whole call
-- is wrapped in throws_ok (the campaign_commands.test.sql:651 / #333
-- precedent) -- which costs the b_waited reading, but the PT409 is itself
-- proof B serialized: B was SENT while A still held the tasks row, so the
-- only way B can see A's committed 'completed' status is to have blocked on
-- that lock and re-read the row under EvalPlanQual.
--
-- Mutation-verified (see the task report): with the tasks-row FOR UPDATE
-- removed, B does not see A's status at all -- it proceeds past the state
-- check and blocks instead on the Assignment, waking to find it already
-- ended, and answers PT409 task_has_no_executor. This assertion is what
-- distinguishes the two.
--
-- The `(f(...)).status` projections below are single-field on purpose -- see
-- the warning above the section-11 probe call.
select pg_temp.test_login('33600000-0000-0000-0000-000000000051', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($outer$
  select * from pg_temp.test_race(%L, %L)
$outer$,
  format($$ select (public.complete_task_review(%s, 3, 4, 'Evaluatorul A')).status::text $$,
    (select double_task_id from r336)),
  format($$ select (public.complete_task_review(%s, 5, 5, 'Evaluatorul B')).status::text $$,
    (select double_task_id from r336))),
  'PT409', 'task_not_in_review',
  'the second evaluator gets a clean PT409 task_not_in_review -- never a duplicate Evaluation, a double credit, or a raw unique_violation off task_evaluations_one_open_per_task_uidx');
reset role;

select is((select count(*) from public.task_evaluations
            where task_id = (select double_task_id from r336)), 1::bigint,
  'exactly one Evaluation survives the double-evaluation race');
select is((select format('%s|%s', count(*), coalesce(sum(delta), 0))
             from public.points_ledger
            where task_id = (select double_task_id from r336)),
  '1|6',
  'and the Executor is credited exactly once, with the FIRST evaluator''s award (Difficulty 3 x rating_mult(4) = 6), never the second''s 5 x 3 = 15 on top of it');

-- ==================== 13. Race: two sibling Subtasks completing at once ====================
-- private.evaluate_task deliberately never locks the Umbrella row (Global
-- Constraints' lock order). What makes concurrent sibling completions safe is
-- the notification dedupe key: private.notify upserts on
-- (member_id, dedupe_key) while unread, so the second session BLOCKS on that
-- unique index and then UPDATEs the row the first inserted. Both calls
-- succeed, and the manager ends with one coalesced row -- never two, never a
-- unique violation.
--
-- Both callers legitimately succeed here, which is the only shape in which
-- pg_temp.test_race can report b_waited at all. Single-field
-- `(f(...)).status` projections again -- see the section-11 warning.
select pg_temp.test_login('33600000-0000-0000-0000-000000000051', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table race336_siblings as
select * from pg_temp.test_race(
  format($$ select (public.complete_task_review(%s, 2, 3, 'Fratele A')).status::text $$,
    (select race_sub1_id from r336)),
  format($$ select (public.complete_task_review(%s, 2, 3, 'Fratele B')).status::text $$,
    (select race_sub2_id from r336)));
reset role;

select ok((select b_waited from race336_siblings),
  'the second sibling BLOCKS -- with no Umbrella lock to serialize on, the coalescing notification''s dedupe key is what serializes them');
select is((select format('%s|%s', result_a, result_b) from race336_siblings),
  'completed|completed',
  'both sibling completions succeed -- neither is rejected and neither leaks a unique violation');
select is((select count(*) from public.notifications
            where task_id = (select race_umbrella_id from r336)), 1::bigint,
  'the Umbrella''s manager ends with exactly ONE rollup notification, not one per sibling');
-- The observed (and, in this harness, deterministic) body is '1 din 2': the
-- LAST writer is session B, whose statement snapshot was taken before A
-- committed, so its own count query saw only its own Subtask as terminal.
-- The coalesced row therefore carries a count that can be one behind -- the
-- exact consequence the wave already accepted for the task:{id}:queue
-- notification ("an unread queue row can sit one too high until the next
-- join or withdrawal"; plan Execution rulings). It is the documented price
-- of never locking the Umbrella row: the row is a nudge, the live truth is
-- one query away, and the subtask_completed ACTIVITY rows asserted below are
-- the durable record. Pinned exactly so that a future change to the lock
-- order or the dedupe key is forced to revisit this line.
select is((select notification.body from public.notifications as notification
            where notification.task_id = (select race_umbrella_id from r336)),
  '1 din 2 subtaskuri încheiate.',
  'the surviving row carries the count its own writer saw -- concurrent siblings coalesce into one notification, at the documented cost of a count that may lag by one');
select is((select count(*) from public.task_activity
            where task_id = (select race_umbrella_id from r336)
              and kind = 'subtask_completed'), 2::bigint,
  'both completions still wrote their own subtask_completed activity row -- only the notification coalesces');
select is((select count(*) from public.task_evaluations
            where task_id in ((select race_sub1_id from r336), (select race_sub2_id from r336))), 2::bigint,
  'and each sibling carries its own Evaluation');

-- ---- clean up everything the committed sessions left behind ----
-- task_activity is append-only and task_evaluations is guarded, both by
-- triggers that bind their owner too, so those deletes run under
-- session_replication_role = 'replica' (that session only).
select extensions.dblink_exec('ctr_setup', $$
  set session_replication_role = 'replica';
  delete from public.points_ledger
   where task_id in (select id from public.tasks where title like '%#336 committed%');
  delete from public.task_evaluations
   where task_id in (select id from public.tasks where title like '%#336 committed%');
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#336 committed%');
  set session_replication_role = 'origin';
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#336 committed%')
      or member_id in ('33600000-0000-0000-0000-000000000051',
                       '33600000-0000-0000-0000-000000000052',
                       '33600000-0000-0000-0000-000000000053',
                       '33600000-0000-0000-0000-000000000054',
                       '33600000-0000-0000-0000-000000000055');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%#336 committed%');
  delete from public.tasks
   where parent_task_id in (select id from public.tasks where title like '%#336 committed%');
  delete from public.tasks where title like '%#336 committed%';
  delete from public.member_departments where member_id in (
    '33600000-0000-0000-0000-000000000051', '33600000-0000-0000-0000-000000000052',
    '33600000-0000-0000-0000-000000000053', '33600000-0000-0000-0000-000000000054',
    '33600000-0000-0000-0000-000000000055');
  delete from auth.users where id in (
    '33600000-0000-0000-0000-000000000051', '33600000-0000-0000-0000-000000000052',
    '33600000-0000-0000-0000-000000000053', '33600000-0000-0000-0000-000000000054',
    '33600000-0000-0000-0000-000000000055');
$$);
select extensions.dblink_disconnect('ctr_setup');

select is((select count(*) from public.tasks where title like '%#336 committed%'), 0::bigint,
  'the committed race and lock-probe fixtures are removed again -- this suite leaves no trace');
select is((select count(*) from public.points_ledger
            where member_id in ('33600000-0000-0000-0000-000000000053',
                                '33600000-0000-0000-0000-000000000054',
                                '33600000-0000-0000-0000-000000000055')), 0::bigint,
  'including every point the committed races actually credited');

select * from finish();
rollback;
