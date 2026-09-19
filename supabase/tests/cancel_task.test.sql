-- #339: public.cancel_task -- a manager calls off work that will not happen,
-- and the system records WHY.
--
-- What this suite pins that no earlier suite does:
--   * public.tasks.cancel_reason and tasks_cancel_reason_ck, the biconditional
--     that makes a reasonless cancellation unwritable by ANY path -- the
--     command or the table owner (#345 removed the third, a direct write);
--   * public.tasks_with_overdue carrying the new column (a `select task.*`
--     view expands its star at CREATE time, so a column added later is
--     invisible until the view is recreated);
--   * the Umbrella CASCADE, and the fact that its Subtask locks are taken in
--     ONE statement BEFORE anything is written -- section 10 discriminates
--     exactly that, by catching an earlier Subtask in pgrowlocks mode
--     `For No Key Update` (locked, untouched) while the command is blocked on
--     a later one. Fold the lock into the mutation loop and the same row
--     reports `No Key Update`, the UPDATER mode, instead;
--   * the LOCK STRENGTH: the target is held FOR NO KEY UPDATE, never FOR
--     UPDATE. FOR UPDATE on an Umbrella deadlocks (40P01) against
--     private.evaluate_task's implicit FK FOR KEY SHARE on the same row --
--     the bug #338 shipped and review caught. Section 11 pins the exact mode
--     string so nobody can silently strengthen it back;
--   * that cancelling is a MANAGER act, not an evaluator one: an Independent
--     Team's own member may call off their Team's Task, which the very same
--     member may never evaluate (#336/#338);
--   * section 10, the cross-command hole #339 both opens and closes: a
--     Subtask under a CANCELLED Umbrella can no longer be reopened
--     (PT409 umbrella_cancelled), while one under a live Umbrella still can.
--
-- Fixture prefix 33900000-0000-0000-0000-0000000000NN throughout, resolved as
-- the owner into temp tables before any persona logs in (the #328 trap,
-- stack-context.md carry-forwards). The committed lock-probe and race
-- fixtures use 33900000-...-0000000000[5]N and carry '#339 committed' in
-- their titles.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(102);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('33900000-0000-0000-0000-000000000001', 'bc.339@test.local'),
  ('33900000-0000-0000-0000-000000000002', 'bce.edu.339@test.local'),
  ('33900000-0000-0000-0000-000000000003', 'bce.pr.339@test.local'),
  ('33900000-0000-0000-0000-000000000004', 'member.edu.339@test.local'),
  ('33900000-0000-0000-0000-000000000005', 'member.pr.339@test.local'),
  ('33900000-0000-0000-0000-000000000006', 'proj.lead.339@test.local'),
  ('33900000-0000-0000-0000-000000000007', 'proj.responsible.339@test.local'),
  ('33900000-0000-0000-0000-000000000008', 'proj.member.339@test.local'),
  ('33900000-0000-0000-0000-000000000009', 'ind.team.339@test.local'),
  ('33900000-0000-0000-0000-000000000010', 'inactive.bc.339@test.local'),
  ('33900000-0000-0000-0000-000000000011', 'claimless.339@test.local'),
  ('33900000-0000-0000-0000-000000000012', 'exec.happy.339@test.local'),
  ('33900000-0000-0000-0000-000000000013', 'candidate.a.339@test.local'),
  ('33900000-0000-0000-0000-000000000014', 'candidate.b.339@test.local'),
  ('33900000-0000-0000-0000-000000000015', 'exec.sub2.339@test.local'),
  ('33900000-0000-0000-0000-000000000016', 'candidate.sub3.339@test.local'),
  ('33900000-0000-0000-0000-000000000017', 'exec.indep.339@test.local'),
  ('33900000-0000-0000-0000-000000000018', 'exec.terminal.339@test.local'),
  ('33900000-0000-0000-0000-000000000019', 'exec.authority.339@test.local'),
  ('33900000-0000-0000-0000-000000000020', 'exec.directwrite.339@test.local'),
  ('33900000-0000-0000-0000-000000000021', 'exec.reopen.339@test.local'),
  ('33900000-0000-0000-0000-000000000022', 'exec.reopen.live.339@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('33900000-0000-0000-0000-000000000001', 'BC 339', 'bc.339@test.local', 'bc', 'activ'),
  ('33900000-0000-0000-0000-000000000002', 'BCE EDU 339', 'bce.edu.339@test.local', 'bce', 'activ'),
  ('33900000-0000-0000-0000-000000000003', 'BCE PR 339', 'bce.pr.339@test.local', 'bce', 'activ'),
  ('33900000-0000-0000-0000-000000000004', 'Membru EDU 339', 'member.edu.339@test.local', 'voluntar', 'activ'),
  ('33900000-0000-0000-0000-000000000005', 'Membru PR 339', 'member.pr.339@test.local', 'voluntar', 'activ'),
  ('33900000-0000-0000-0000-000000000006', 'Lead Proiect 339', 'proj.lead.339@test.local', 'voluntar', 'activ'),
  ('33900000-0000-0000-0000-000000000007', 'Responsabil Proiect 339', 'proj.responsible.339@test.local', 'voluntar', 'activ'),
  ('33900000-0000-0000-0000-000000000008', 'Membru Proiect 339', 'proj.member.339@test.local', 'voluntar', 'activ'),
  ('33900000-0000-0000-0000-000000000009', 'Membru Echipa Independenta 339', 'ind.team.339@test.local', 'voluntar', 'activ'),
  ('33900000-0000-0000-0000-000000000010', 'BC Inactiv 339', 'inactive.bc.339@test.local', 'bc', 'inactiv'),
  ('33900000-0000-0000-0000-000000000011', 'Fara Claimuri 339', 'claimless.339@test.local', 'voluntar', 'activ'),
  ('33900000-0000-0000-0000-000000000012', 'Executor Fericit 339', 'exec.happy.339@test.local', 'voluntar', 'activ'),
  ('33900000-0000-0000-0000-000000000013', 'Candidat A 339', 'candidate.a.339@test.local', 'voluntar', 'activ'),
  ('33900000-0000-0000-0000-000000000014', 'Candidat B 339', 'candidate.b.339@test.local', 'voluntar', 'activ'),
  ('33900000-0000-0000-0000-000000000015', 'Executor Subtask 339', 'exec.sub2.339@test.local', 'voluntar', 'activ'),
  ('33900000-0000-0000-0000-000000000016', 'Candidat Subtask 339', 'candidate.sub3.339@test.local', 'voluntar', 'activ'),
  ('33900000-0000-0000-0000-000000000017', 'Executor Independent 339', 'exec.indep.339@test.local', 'voluntar', 'activ'),
  ('33900000-0000-0000-0000-000000000018', 'Executor Terminal 339', 'exec.terminal.339@test.local', 'voluntar', 'activ'),
  ('33900000-0000-0000-0000-000000000019', 'Executor Autoritate 339', 'exec.authority.339@test.local', 'voluntar', 'activ'),
  ('33900000-0000-0000-0000-000000000020', 'Executor Scriere 339', 'exec.directwrite.339@test.local', 'voluntar', 'activ'),
  ('33900000-0000-0000-0000-000000000021', 'Executor Redeschidere 339', 'exec.reopen.339@test.local', 'voluntar', 'activ'),
  ('33900000-0000-0000-0000-000000000022', 'Executor Redeschidere Vie 339', 'exec.reopen.live.339@test.local', 'voluntar', 'activ');

insert into public.member_departments (member_id, dept_id) values
  ('33900000-0000-0000-0000-000000000002', 'edu'),
  ('33900000-0000-0000-0000-000000000003', 'pr'),
  ('33900000-0000-0000-0000-000000000004', 'edu'),
  ('33900000-0000-0000-0000-000000000005', 'pr'),
  ('33900000-0000-0000-0000-000000000011', 'edu'),
  ('33900000-0000-0000-0000-000000000012', 'edu'),
  ('33900000-0000-0000-0000-000000000013', 'edu'),
  ('33900000-0000-0000-0000-000000000014', 'edu'),
  ('33900000-0000-0000-0000-000000000015', 'edu'),
  ('33900000-0000-0000-0000-000000000016', 'edu'),
  ('33900000-0000-0000-0000-000000000017', 'edu'),
  ('33900000-0000-0000-0000-000000000018', 'edu'),
  ('33900000-0000-0000-0000-000000000019', 'edu'),
  ('33900000-0000-0000-0000-000000000020', 'edu'),
  ('33900000-0000-0000-0000-000000000021', 'edu'),
  ('33900000-0000-0000-0000-000000000022', 'edu');

insert into public.teams (id, name, dept_id) values
  ('t-339-ind', 'Echipa Independenta 339', null);
insert into public.team_members (team_id, member_id) values
  ('t-339-ind', '33900000-0000-0000-0000-000000000009');

insert into public.projects (name, status, leader_id, created_by) values
  ('Proiect #339', 'active',
   '33900000-0000-0000-0000-000000000006', '33900000-0000-0000-0000-000000000001');
insert into public.project_members (project_id, member_id, project_role) values
  ((select id from public.projects where name = 'Proiect #339'),
   '33900000-0000-0000-0000-000000000007', 'responsible'),
  ((select id from public.projects where name = 'Proiect #339'),
   '33900000-0000-0000-0000-000000000008', 'member');

-- ---- T1: the happy path. A PUBLIC edu Task in progress, one live Executor
-- and two pending Candidates -- so one cancellation has to end an Assignment,
-- close a queue and decide two Candidatures at once.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, queue_opened_at, started_at, created_by)
values
  ('Anulare fericita #339', 'Se anuleaza', now() + interval '10 days', 'edu', 'org', 'public', 'in_progress',
   now() - interval '10 days', now() - interval '10 days', now() - interval '9 days',
   '33900000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33900000-0000-0000-0000-000000000012', '33900000-0000-0000-0000-000000000002',
       now() - interval '9 days'
  from public.tasks where title = 'Anulare fericita #339';
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33900000-0000-0000-0000-000000000013'::uuid, 'pending', now() - interval '8 days'
  from public.tasks where title = 'Anulare fericita #339'
union all
select id, '33900000-0000-0000-0000-000000000014'::uuid, 'pending', now() - interval '7 days'
  from public.tasks where title = 'Anulare fericita #339';

-- ---- U1 + S1/S2/S3: the cascade. One already-completed Subtask that must be
-- left exactly as it is, one direct Subtask with a live Executor, one public
-- Subtask with a pending Candidate and no Executor at all.
insert into public.tasks
  (title, description, dept_id, kind, audience, assignment_mode, status, created_at, created_by)
values ('Umbrela de anulat #339', 'Umbrela', 'edu', 'umbrella', null, null, 'todo',
        now() - interval '10 days', '33900000-0000-0000-0000-000000000002');
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, parent_task_id,
   difficulty, rating, created_at, started_at, submitted_at, completed_at, created_by)
select 'Subtask finalizat #339', 'Gata inainte de anulare', now() + interval '10 days', 'edu', 'local', 'direct',
       'completed', parent.id, 3, 4,
       now() - interval '10 days', now() - interval '9 days', now() - interval '3 days', now() - interval '2 days',
       '33900000-0000-0000-0000-000000000002'
  from public.tasks as parent where parent.title = 'Umbrela de anulat #339';
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, parent_task_id,
   created_at, started_at, created_by)
select 'Subtask in lucru #339', 'Are executant', now() + interval '10 days', 'edu', 'local', 'direct',
       'in_progress', parent.id, now() - interval '10 days', now() - interval '9 days',
       '33900000-0000-0000-0000-000000000002'
  from public.tasks as parent where parent.title = 'Umbrela de anulat #339';
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, parent_task_id,
   created_at, queue_opened_at, created_by)
select 'Subtask public #339', 'Are coada', now() + interval '10 days', 'edu', 'org', 'public',
       'todo', parent.id, now() - interval '10 days', now() - interval '10 days',
       '33900000-0000-0000-0000-000000000002'
  from public.tasks as parent where parent.title = 'Umbrela de anulat #339';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33900000-0000-0000-0000-000000000015', '33900000-0000-0000-0000-000000000002',
       now() - interval '9 days'
  from public.tasks where title = 'Subtask in lucru #339';
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33900000-0000-0000-0000-000000000016'::uuid, 'pending', now() - interval '8 days'
  from public.tasks where title = 'Subtask public #339';

-- ---- U2 + SA/SB: the INDEPENDENT-Subtask path. U2's creator is the edu BCE
-- and the actor below is the BC, so private.task_managers(U2, BC) resolves to
-- exactly {BCE edu} -- a deterministic, single-member recipient set.
insert into public.tasks
  (title, description, dept_id, kind, audience, assignment_mode, status, created_at, created_by)
values ('Umbrela martor #339', 'Ramane vie', 'edu', 'umbrella', null, null, 'todo',
        now() - interval '10 days', '33900000-0000-0000-0000-000000000002');
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, parent_task_id,
   created_at, started_at, created_by)
select 'Subtask independent #339', 'Anulat singur', now() + interval '10 days', 'edu', 'local', 'direct',
       'in_progress', parent.id, now() - interval '10 days', now() - interval '9 days',
       '33900000-0000-0000-0000-000000000002'
  from public.tasks as parent where parent.title = 'Umbrela martor #339';
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, parent_task_id,
   created_at, created_by)
select 'Subtask ramas #339', 'Ramane todo', now() + interval '10 days', 'edu', 'local', 'direct',
       'todo', parent.id, now() - interval '10 days',
       '33900000-0000-0000-0000-000000000002'
  from public.tasks as parent where parent.title = 'Umbrela martor #339';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33900000-0000-0000-0000-000000000017', '33900000-0000-0000-0000-000000000002',
       now() - interval '9 days'
  from public.tasks where title = 'Subtask independent #339';

-- ---- T4/T5: the two terminal refusals.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   difficulty, rating, created_at, started_at, completed_at, created_by)
values
  ('Deja finalizat #339', 'Nu se mai anuleaza', now() - interval '5 days', 'edu', 'local', 'direct', 'completed',
   3, 4, now() - interval '20 days', now() - interval '19 days', now() - interval '5 days',
   '33900000-0000-0000-0000-000000000002');
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   cancelled_at, cancel_reason, created_at, created_by)
values
  ('Deja anulat #339', 'Anulat demult', now() - interval '5 days', 'edu', 'local', 'direct', 'cancelled',
   now() - interval '5 days', 'Motiv vechi #339', now() - interval '20 days',
   '33900000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at, ended_at, end_reason)
select id, '33900000-0000-0000-0000-000000000018', '33900000-0000-0000-0000-000000000002',
       now() - interval '19 days', now() - interval '5 days', 'completed'
  from public.tasks where title = 'Deja finalizat #339';

-- ---- T6: the authority-matrix target. Every attempt on it is DENIED, so it
-- must survive section 9 untouched.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, created_by)
values
  ('Autoritate dept #339', 'Tinta pentru refuzuri', now() + interval '10 days', 'edu', 'local', 'direct', 'in_progress',
   now() - interval '10 days', now() - interval '9 days', '33900000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33900000-0000-0000-0000-000000000019', '33900000-0000-0000-0000-000000000002',
       now() - interval '9 days'
  from public.tasks where title = 'Autoritate dept #339';

-- ---- T7: a `local` pr Task an edu member cannot even see.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, created_at, created_by)
values
  ('Ascuns pr #339', 'Alt departament', now() + interval '10 days', 'pr', 'local', 'direct', 'todo',
   now() - interval '10 days', '33900000-0000-0000-0000-000000000003');

-- ---- T8: an Independent Team's own Task. Its members MAY cancel it (manager
-- authority) while they may never evaluate it (#336/#338).
insert into public.tasks
  (title, description, deadline, team_id, audience, assignment_mode, status, created_at, created_by)
values
  ('Echipa independenta #339', 'Task de echipa', now() + interval '10 days', 't-339-ind', 'local', 'direct', 'todo',
   now() - interval '10 days', '33900000-0000-0000-0000-000000000001');

-- ---- T9/T11: Project Tasks.
insert into public.tasks
  (title, description, deadline, project_id, audience, assignment_mode, status,
   created_at, started_at, created_by)
select 'Proiect membru #339', 'Munca unui membru', now() + interval '10 days',
       project.id, 'local', 'direct', 'in_progress'::public.task_status,
       now() - interval '10 days', now() - interval '9 days',
       '33900000-0000-0000-0000-000000000001'::uuid
  from public.projects as project where project.name = 'Proiect #339';
insert into public.tasks
  (title, description, deadline, project_id, audience, assignment_mode, status,
   created_at, created_by)
select 'Proiect responsabil #339', 'Anulat de responsabil', now() + interval '10 days',
       project.id, 'local', 'direct', 'todo'::public.task_status,
       now() - interval '10 days',
       '33900000-0000-0000-0000-000000000001'::uuid
  from public.projects as project where project.name = 'Proiect #339';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33900000-0000-0000-0000-000000000008', '33900000-0000-0000-0000-000000000001',
       now() - interval '9 days'
  from public.tasks where title = 'Proiect membru #339';

-- ---- T10: the direct-write target. Nothing in section 8 may change it.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, created_by)
values
  ('Scriere directa #339', 'Tinta', now() + interval '10 days', 'edu', 'local', 'direct', 'in_progress',
   now() - interval '10 days', now() - interval '9 days', '33900000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33900000-0000-0000-0000-000000000020', '33900000-0000-0000-0000-000000000002',
       now() - interval '9 days'
  from public.tasks where title = 'Scriere directa #339';

-- ---- U3/SR and U4/SR2: section 10's pair. SR is completed through the real
-- command and its Umbrella is then cancelled (SR itself is already terminal,
-- so the cascade leaves it alone) -- reopening it must now be refused. SR2 is
-- the control: the identical shape under a LIVE Umbrella, which must still
-- reopen.
insert into public.tasks
  (title, description, dept_id, kind, audience, assignment_mode, status, created_at, created_by)
values ('Umbrela anulata #339', 'Se anuleaza cu subtask finalizat', 'edu', 'umbrella', null, null, 'todo',
        now() - interval '10 days', '33900000-0000-0000-0000-000000000002'),
       ('Umbrela nevinovata #339', 'Ramane vie', 'edu', 'umbrella', null, null, 'todo',
        now() - interval '10 days', '33900000-0000-0000-0000-000000000002');
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, parent_task_id,
   created_at, started_at, submitted_at, created_by)
select 'Subtask de redeschis #339', 'Sub umbrela anulata', now() + interval '10 days', 'edu', 'local', 'direct',
       'in_review'::public.task_status, parent.id, now() - interval '10 days', now() - interval '9 days', now() - interval '1 day',
       '33900000-0000-0000-0000-000000000002'::uuid
  from public.tasks as parent where parent.title = 'Umbrela anulata #339'
union all
select 'Subtask liber de redeschis #339', 'Sub umbrela vie', now() + interval '10 days', 'edu', 'local', 'direct',
       'in_review'::public.task_status, parent.id, now() - interval '10 days', now() - interval '9 days', now() - interval '1 day',
       '33900000-0000-0000-0000-000000000002'::uuid
  from public.tasks as parent where parent.title = 'Umbrela nevinovata #339';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33900000-0000-0000-0000-000000000021'::uuid, '33900000-0000-0000-0000-000000000002'::uuid,
       now() - interval '9 days'
  from public.tasks where title = 'Subtask de redeschis #339'
union all
select id, '33900000-0000-0000-0000-000000000022'::uuid, '33900000-0000-0000-0000-000000000002'::uuid,
       now() - interval '9 days'
  from public.tasks where title = 'Subtask liber de redeschis #339';

-- ==================== Ids, resolved as the owner ====================
create temp table f339 as
select
  (select id from public.tasks where title = 'Anulare fericita #339') as happy_task_id,
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'Anulare fericita #339') as happy_assignment_id,
  (select id from public.tasks where title = 'Umbrela de anulat #339') as umbrella_id,
  (select id from public.tasks where title = 'Subtask finalizat #339') as sub_done_id,
  (select id from public.tasks where title = 'Subtask in lucru #339') as sub_live_id,
  (select id from public.tasks where title = 'Subtask public #339') as sub_public_id,
  (select id from public.tasks where title = 'Umbrela martor #339') as witness_umbrella_id,
  (select id from public.tasks where title = 'Subtask independent #339') as indep_subtask_id,
  (select id from public.tasks where title = 'Subtask ramas #339') as remaining_subtask_id,
  (select id from public.tasks where title = 'Deja finalizat #339') as completed_task_id,
  (select id from public.tasks where title = 'Deja anulat #339') as cancelled_task_id,
  (select id from public.tasks where title = 'Autoritate dept #339') as authority_task_id,
  (select id from public.tasks where title = 'Ascuns pr #339') as hidden_task_id,
  (select id from public.tasks where title = 'Echipa independenta #339') as ind_team_task_id,
  (select id from public.tasks where title = 'Proiect membru #339') as proj_member_task_id,
  (select id from public.tasks where title = 'Proiect responsabil #339') as proj_resp_task_id,
  (select id from public.tasks where title = 'Scriere directa #339') as direct_write_task_id,
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'Scriere directa #339') as direct_write_assignment_id,
  (select id from public.tasks where title = 'Umbrela anulata #339') as doomed_umbrella_id,
  (select id from public.tasks where title = 'Subtask de redeschis #339') as doomed_subtask_id,
  (select id from public.tasks where title = 'Umbrela nevinovata #339') as live_umbrella_id,
  (select id from public.tasks where title = 'Subtask liber de redeschis #339') as live_subtask_id;
-- anon too: the anon denial in section 9 resolves an id through this table in
-- its own format() before the command is ever reached (the #337 pattern).
grant select on f339 to authenticated, anon;

-- History snapshots, so "no history row was deleted or edited" is a real diff.
create temp table h339 as
select (select count(*) from public.task_activity)    as activity_rows,
       (select count(*) from public.task_assignments) as assignment_rows,
       (select count(*) from public.task_candidates)  as candidate_rows,
       (select count(*) from public.task_evaluations) as evaluation_rows,
       (select count(*) from public.points_ledger)    as ledger_rows;

-- ==================== 1. API shape and privileges ====================

select has_function('public', 'cancel_task', array['bigint', 'text'],
  'public.cancel_task exists with the pinned two-parameter signature');
select is(pg_get_function_identity_arguments(
    'public.cancel_task(bigint, text)'::regprocedure),
  'p_task_id bigint, p_reason text',
  'cancel_task exposes no actor parameter -- the actor is always auth.uid()');
select is(pg_get_function_result('public.cancel_task(bigint, text)'::regprocedure),
  'tasks', 'cancel_task returns the affected Task row');
select ok(not (select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public' and procedure.proname = 'cancel_task'),
  'the public command is a security invoker wrapper');
select ok((select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private' and procedure.proname = 'cancel_task_impl'),
  'private.cancel_task_impl runs as owner (security definer)');
select ok(coalesce((
    select 'search_path=""' = any(procedure.proconfig)
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private' and procedure.proname = 'cancel_task_impl'
  ), false), 'private.cancel_task_impl pins an empty search_path');
select ok(has_function_privilege('authenticated',
  'public.cancel_task(bigint, text)'::regprocedure, 'execute'),
  'authenticated can execute public.cancel_task');
select ok(not has_function_privilege('anon',
  'public.cancel_task(bigint, text)'::regprocedure, 'execute'),
  'anon cannot execute public.cancel_task');
select ok(has_function_privilege('authenticated',
  'private.cancel_task_impl(bigint, text)'::regprocedure, 'execute'),
  'authenticated can execute private.cancel_task_impl');
select ok(not has_function_privilege('service_role',
  'public.cancel_task(bigint, text)'::regprocedure, 'execute'),
  'service_role holds no execute on the wrapper either (conventions Sec4)');

-- ==================== 2. The column, the constraint, the view ====================

select has_column('public', 'tasks', 'cancel_reason',
  'public.tasks records why a Task was cancelled');
select has_column('public', 'tasks_with_overdue', 'cancel_reason',
  'and the app read surface exposes it -- a `select task.*` view expands its star at CREATE time, so the view had to be recreated');
select ok(coalesce((
    select class.reloptions::text like '%security_invoker=on%'
      from pg_class as class
      join pg_namespace as namespace on namespace.oid = class.relnamespace
     where namespace.nspname = 'public' and class.relname = 'tasks_with_overdue'
  ), false), 'the recreated view is still security_invoker=on -- it must never run as its owner and bypass RLS');
select ok(has_table_privilege('authenticated', 'public.tasks_with_overdue', 'select'),
  'the recreated view keeps its select grant to authenticated');
select ok(not has_table_privilege('anon', 'public.tasks_with_overdue', 'select'),
  'and still grants anon nothing');
select ok(exists (
    select 1 from pg_constraint as constraint_row
     where constraint_row.conrelid = 'public.tasks'::regclass
       and constraint_row.conname = 'tasks_cancel_reason_ck'),
  'tasks_cancel_reason_ck exists on public.tasks');

select throws_ok($$ insert into public.tasks
    (title, dept_id, audience, assignment_mode, status, cancelled_at)
  values ('Anulare fara motiv #339', 'edu', 'local', 'direct', 'cancelled', now()) $$,
  '23514', 'new row for relation "tasks" violates check constraint "tasks_cancel_reason_ck"',
  'a cancelled Task with no reason is rejected -- even inserted by the table owner');
select throws_ok($$ insert into public.tasks
    (title, dept_id, audience, assignment_mode, status, cancelled_at, cancel_reason)
  values ('Anulare cu motiv gol #339', 'edu', 'local', 'direct', 'cancelled', now(), E'\t\n  ') $$,
  '23514', 'new row for relation "tasks" violates check constraint "tasks_cancel_reason_ck"',
  'and a whitespace-only reason counts as no reason -- the POSIX class catches tabs and newlines btrim() would miss');
select throws_ok($$ insert into public.tasks
    (title, dept_id, audience, assignment_mode, status, cancel_reason)
  values ('Motiv fara anulare #339', 'edu', 'local', 'direct', 'todo', 'Motiv orfan') $$,
  '23514', 'new row for relation "tasks" violates check constraint "tasks_cancel_reason_ck"',
  'the constraint is a biconditional: a reason on a Task that is NOT cancelled is rejected too, so a reopen or a duplication can never carry a stale explanation');
select lives_ok($$ insert into public.tasks
    (title, dept_id, audience, assignment_mode, status, cancelled_at, cancel_reason)
  values ('Anulare veche backfill #339', 'edu', 'local', 'direct', 'cancelled', now(),
          'Anulat înainte de înregistrarea motivelor (#339).') $$,
  'the #339 backfill string itself satisfies the constraint -- a blank marker would have failed the ALTER on staging');
-- #339: this restates tasks_cancel_reason_ck's own guarantee over every row
-- currently in the database (fixtures included) -- it does not and cannot
-- prove the backfill ran, since a local reset has no pre-constraint state to
-- prove it against. The backfill is genuinely untestable here; it is exercised
-- defensively for a hosted database that may already hold cancelled rows.
select is((select count(*) from public.tasks
            where status = 'cancelled' and cancel_reason is null), 0::bigint,
  'the constraint holds for every row in the database, fixtures included');
select is((select view_row.cancel_reason from public.tasks_with_overdue as view_row
            where view_row.id = (select cancelled_task_id from f339)),
  'Motiv vechi #339', 'and the value reads back through tasks_with_overdue, not only through the table');

-- ==================== 3. The happy path ====================
-- A public Task in progress with an Executor and two Candidates, cancelled by
-- the local BCE. One call ends an Assignment, closes a queue, decides two
-- Candidatures and notifies three people.
select pg_temp.test_login('33900000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.cancel_task(%s, '   Evenimentul a fost amânat.   ') $$,
  (select happy_task_id from f339)),
  'the local BCE cancels a live public Task of their own Department');
reset role;

select is((select format('%s|%s|%s|%s',
                         task.status::text,
                         (task.cancelled_at is not null)::text,
                         task.cancel_reason,
                         (task.queue_closed_at is not null)::text)
             from public.tasks as task where task.id = (select happy_task_id from f339)),
  'cancelled|true|Evenimentul a fost amânat.|true',
  'the Task is cancelled, stamped, carries the TRIMMED reason, and its Candidate Queue is closed (tasks_queue_timestamp_state_ck demands the last one)');
select is((select format('%s|%s|%s',
                         (assignment.ended_at is not null)::text,
                         assignment.end_reason,
                         assignment.end_note)
             from public.task_assignments as assignment
            where assignment.id = (select happy_assignment_id from f339)),
  'true|cancelled|Evenimentul a fost amânat.',
  'the active Assignment is ended with end_reason = cancelled and the reason as its end_note -- the row is closed, never deleted');
select is((select count(*) from public.task_candidates as candidate
            where candidate.task_id = (select happy_task_id from f339)
              and candidate.status = 'closed'
              and candidate.decided_at is not null
              and candidate.decided_by = '33900000-0000-0000-0000-000000000002'), 2::bigint,
  'both pending Candidatures are closed with the ACTOR as decided_by -- a cancellation is a decision somebody made, unlike an Evaluation''s automatic close');
select is((select format('%s|%s|%s|%s|%s|%s',
                         activity.actor_id::text,
                         coalesce(activity.assignment_id::text, 'null'),
                         activity.from_status::text,
                         activity.to_status::text,
                         activity.note,
                         activity.details->>'closed_candidates')
             from public.task_activity as activity
            where activity.task_id = (select happy_task_id from f339)
              and activity.kind = 'cancelled'),
  format('%s|null|in_progress|cancelled|Evenimentul a fost amânat.|2',
         '33900000-0000-0000-0000-000000000002'),
  'one cancelled activity row: the actor, assignment_id NULL (the wave''s rule for Task-level rows), in_progress -> cancelled, the reason as note, and the number of Candidatures it closed');
select is((select activity.details->>'ended_assignment_id'
             from public.task_activity as activity
            where activity.task_id = (select happy_task_id from f339)
              and activity.kind = 'cancelled'),
  (select happy_assignment_id::text from f339),
  'and details names the Assignment it ended -- the id the activity row itself may not carry in its column');
select set_eq(
  format($$ select member_id from public.notifications where task_id = %s $$,
    (select happy_task_id from f339)),
  $$ values ('33900000-0000-0000-0000-000000000012'::uuid),
            ('33900000-0000-0000-0000-000000000013'::uuid),
            ('33900000-0000-0000-0000-000000000014'::uuid) $$,
  'exactly the Executor and the two closed Candidates are notified -- and not the BCE who did it, whom private.notify always drops');
select is((select format('%s|%s', notification.title, notification.body)
             from public.notifications as notification
            where notification.task_id = (select happy_task_id from f339)
              and notification.member_id = '33900000-0000-0000-0000-000000000012'),
  'Task anulat: Anulare fericita #339|Evenimentul a fost amânat.',
  'the Executor is told the Task is cancelled, with the reason as the body');
select is((select format('%s|%s', notification.title, notification.body)
             from public.notifications as notification
            where notification.task_id = (select happy_task_id from f339)
              and notification.member_id = '33900000-0000-0000-0000-000000000013'),
  'Coadă închisă: Anulare fericita #339|Nu mai poți fi selectat pentru acest task.',
  'and each closed Candidate gets the pinned queue-closed copy instead');

-- History: only tasks / task_assignments.ended_* / task_candidates.status
-- changed. Nothing was deleted and nothing was rewritten.
select is((select count(*) from public.task_activity) - (select activity_rows from h339), 1::bigint,
  'task_activity grew by exactly the one row this command appended -- it is append-only and this command never rewrites it');
select is((select count(*) from public.task_assignments) - (select assignment_rows from h339), 0::bigint,
  'no Assignment row was added or removed -- the existing one was ended in place');
select is((select count(*) from public.task_candidates) - (select candidate_rows from h339), 0::bigint,
  'no Candidature row was added or removed -- the two pending ones were decided in place');
select is((select count(*) from public.task_evaluations) - (select evaluation_rows from h339), 0::bigint,
  'no Evaluation was written: a cancelled Task is never evaluated -- that is the whole difference from unfulfilled (#337)');
select is((select count(*) from public.points_ledger) - (select ledger_rows from h339), 0::bigint,
  'and no points changed hands');

-- ==================== 4. The Umbrella cascade ====================
select pg_temp.test_login('33900000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.cancel_task(%s, 'Proiectul a fost oprit.') $$,
  (select umbrella_id from f339)),
  'an Umbrella is cancellable -- cancel_task deliberately does NOT refuse one, unlike every evaluator-side command');
reset role;

select is((select format('%s|%s|%s|%s',
                         (select task.status::text from public.tasks as task where task.id = (select umbrella_id from f339)),
                         (select task.status::text from public.tasks as task where task.id = (select sub_live_id from f339)),
                         (select task.status::text from public.tasks as task where task.id = (select sub_public_id from f339)),
                         (select task.status::text from public.tasks as task where task.id = (select sub_done_id from f339)))),
  'cancelled|cancelled|cancelled|completed',
  'the Umbrella and both live Subtasks are cancelled; the already-completed Subtask keeps its own outcome -- history is never rewritten');
select is((select count(*) from public.tasks as task
            where task.id in ((select umbrella_id from f339),
                              (select sub_live_id from f339),
                              (select sub_public_id from f339))
              and task.cancel_reason = 'Proiectul a fost oprit.'), 3::bigint,
  'all three carry the SAME reason -- the cascade explains itself with the Umbrella''s words');
select is((select task.cancel_reason from public.tasks as task
            where task.id = (select sub_done_id from f339)), null,
  'and the completed Subtask carries no reason at all (tasks_cancel_reason_ck would reject one)');
select is((select count(*) from public.task_activity as activity
            where activity.kind = 'cancelled'
              and activity.task_id in ((select umbrella_id from f339),
                                       (select sub_live_id from f339),
                                       (select sub_public_id from f339))), 3::bigint,
  'three cancelled activity rows: one for the Umbrella and one for each cascaded Subtask');
select is((select count(*) from public.task_activity as activity
            where activity.kind = 'cancelled'
              and activity.task_id = (select sub_done_id from f339)), 0::bigint,
  'and none for the Subtask that was already finished');
select is((select array_agg(activity.details->>'cascade_from' order by activity.task_id)
             from public.task_activity as activity
            where activity.kind = 'cancelled'
              and activity.task_id in ((select sub_live_id from f339),
                                       (select sub_public_id from f339))),
  array[(select umbrella_id::text from f339), (select umbrella_id::text from f339)],
  'each cascaded Subtask row names the Umbrella it came from in details.cascade_from');
select is((select activity.details->'cascaded_subtask_ids'
             from public.task_activity as activity
            where activity.kind = 'cancelled'
              and activity.task_id = (select umbrella_id from f339)),
  to_jsonb(array[(select sub_live_id from f339), (select sub_public_id from f339)]),
  'and the Umbrella''s own row lists exactly the Subtasks it took down, in id order -- the terminal one is absent');
select is((select count(*) from public.task_activity as activity
            where activity.kind = 'subtask_completed'
              and activity.task_id = (select umbrella_id from f339)), 0::bigint,
  'the cascade writes NO subtask_completed rollup on the Umbrella: it is being cancelled in the same transaction, so "how far its Subtasks got" is not a question anyone still has');
select is((select format('%s|%s',
                         (assignment.end_reason),
                         (assignment.end_note))
             from public.task_assignments as assignment
            where assignment.task_id = (select sub_live_id from f339)),
  'cancelled|Proiectul a fost oprit.',
  'the cascaded Subtask''s Assignment is ended exactly as the target''s would be');
select is((select format('%s|%s',
                         (task.queue_closed_at is not null)::text,
                         (select candidate.status from public.task_candidates as candidate
                           where candidate.task_id = task.id))
             from public.tasks as task where task.id = (select sub_public_id from f339)),
  'true|closed',
  'and the cascaded public Subtask''s queue is closed with its Candidature decided');
select set_eq(
  format($$ select member_id from public.notifications
             where task_id in (%s, %s, %s) $$,
    (select umbrella_id from f339), (select sub_live_id from f339), (select sub_public_id from f339)),
  $$ values ('33900000-0000-0000-0000-000000000015'::uuid),
            ('33900000-0000-0000-0000-000000000016'::uuid) $$,
  'the cascade notifies exactly the live Subtask''s Executor and the public Subtask''s Candidate -- nobody is told about the Umbrella itself, which has neither');

-- ==================== 5. Cancelling a Subtask on its own ====================
-- The rollup path: the Umbrella's managers are told how far it has got, under
-- the coalescing dedupe key, and the Umbrella itself is left alone.
select pg_temp.test_login('33900000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.cancel_task(%s, 'Nu mai are rost.') $$,
  (select indep_subtask_id from f339)),
  'BC cancels a single Subtask without touching its Umbrella');
reset role;

select is((select format('%s|%s',
                         (select task.status::text from public.tasks as task where task.id = (select witness_umbrella_id from f339)),
                         (select task.status::text from public.tasks as task where task.id = (select remaining_subtask_id from f339)))),
  'todo|todo',
  'the Umbrella and its other Subtask are untouched -- cancelling one Subtask is not cancelling the Umbrella');
select is((select format('%s|%s|%s|%s',
                         activity.details->>'subtask_id',
                         activity.details->>'outcome',
                         activity.details->>'terminal_count',
                         activity.details->>'subtask_count')
             from public.task_activity as activity
            where activity.task_id = (select witness_umbrella_id from f339)
              and activity.kind = 'subtask_completed'),
  format('%s|cancelled|1|2', (select indep_subtask_id from f339)),
  'the Umbrella gets one subtask_completed row recording the cancelled outcome and the live counts');
select set_eq(
  format($$ select member_id from public.notifications where task_id in (%s, %s) $$,
    (select indep_subtask_id from f339), (select witness_umbrella_id from f339)),
  $$ values ('33900000-0000-0000-0000-000000000017'::uuid),
            ('33900000-0000-0000-0000-000000000002'::uuid) $$,
  'the Subtask''s Executor is told it is cancelled and the Umbrella''s manager (its creator, who is not the actor) gets the rollup');
select is((select format('%s|%s|%s',
                         notification.title, notification.body, notification.dedupe_key)
             from public.notifications as notification
            where notification.task_id = (select witness_umbrella_id from f339)),
  format('Subtask încheiat: Umbrela martor #339|1 din 2 subtaskuri încheiate.|task:%s:subtasks',
         (select witness_umbrella_id from f339)),
  'with the pinned Romanian copy (bare plural for 2-19) and the coalescing dedupe key task:{umbrella}:subtasks');

-- ==================== 6. Input validation and state preconditions ====================
select pg_temp.test_login('33900000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.cancel_task(%s, '   ') $$,
  (select direct_write_task_id from f339)),
  'PT400', 'reason_required', 'a whitespace-only reason is rejected');
select throws_ok(format($$ select public.cancel_task(%s, null) $$,
  (select direct_write_task_id from f339)),
  'PT400', 'reason_required', 'a null reason is rejected');
select throws_ok(format($$ select public.cancel_task(%s, 'Anulam') $$,
  (select completed_task_id from f339)),
  'PT409', 'task_terminal', 'a completed Task cannot be cancelled -- its outcome is already recorded');
select throws_ok(format($$ select public.cancel_task(%s, 'Anulam din nou') $$,
  (select cancelled_task_id from f339)),
  'PT409', 'task_terminal', 'nor can an already cancelled one be cancelled twice, which would overwrite the first reason');
select throws_ok($$ select public.cancel_task(999999999, 'Anulam') $$,
  'PT404', 'task_not_found', 'an unknown Task id is not found');
select throws_ok($$ select public.cancel_task(null, 'Anulam') $$,
  'PT404', 'task_not_found',
  'a null Task id is the same non-disclosing answer, never PT400 (wave ruling)');
reset role;

select is((select format('%s|%s', task.status::text, task.cancel_reason)
             from public.tasks as task where task.id = (select cancelled_task_id from f339)),
  'cancelled|Motiv vechi #339',
  'and the second cancellation attempt left the first reason exactly as it was');

-- ==================== 7. Authority ====================
-- 7.1 denied
select pg_temp.test_login('33900000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["pr"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.cancel_task(%s, 'Anulez eu') $$,
  (select authority_task_id from f339)),
  '42501', 'task_manage_forbidden', 'the BCE of another Department cannot cancel an edu Task');
reset role;
select pg_temp.test_login('33900000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.cancel_task(%s, 'Anulez eu') $$,
  (select authority_task_id from f339)),
  'PT404', 'task_not_found',
  'an ordinary member of the Origin Department is told nothing at all about a direct Task they never worked on -- conventions Sec3 forbids distinguishing hidden from missing');
select throws_ok(format($$ select public.cancel_task(%s, 'Anulez eu') $$,
  (select hidden_task_id from f339)),
  'PT404', 'task_not_found', 'and a Task in another Department is equally invisible');
reset role;
select pg_temp.test_login('33900000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.cancel_task(%s, 'Anulez eu') $$,
  (select proj_member_task_id from f339)),
  '42501', 'task_manage_forbidden',
  'a plain Project member cannot cancel even the Task they are themselves executing -- giving up (#332) is their remedy, not cancelling');
reset role;
select pg_temp.test_login('33900000-0000-0000-0000-000000000010', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.cancel_task(%s, 'Anulez eu') $$,
  (select authority_task_id from f339)),
  '42501', 'task_command_forbidden',
  'a deactivated BC holding a still-valid level-6 token is stopped at the gate');
reset role;
select pg_temp.test_login('33900000-0000-0000-0000-000000000011', '{"provider":"email"}'::jsonb);
select throws_ok(format($$ select public.cancel_task(%s, 'Anulez eu') $$,
  (select authority_task_id from f339)),
  '42501', 'task_command_forbidden', 'a real uid without organisation claims is stopped at the gate too');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(format($$ select public.cancel_task(%s, 'Anulez eu') $$,
  (select authority_task_id from f339)),
  '42501', 'permission denied for function cancel_task',
  'anon cannot execute cancel_task at all -- the literal grant denial');
reset role;

select is((select format('%s|%s|%s', task.status::text,
                         coalesce(task.cancel_reason, 'null'),
                         (select count(*) from public.task_activity as activity
                           where activity.task_id = task.id and activity.kind = 'cancelled'))
             from public.tasks as task where task.id = (select authority_task_id from f339)),
  'in_progress|null|0',
  'after every denial the authority target is untouched: still in progress, no reason, no cancelled row');
select is((select count(*) from public.notifications
            where task_id = (select authority_task_id from f339)), 0::bigint,
  'and a refused cancellation is SILENT -- its Executor hears nothing about a cancellation that never happened');

-- 7.2 allowed. The Independent-Team case is the one that separates MANAGING
-- from EVALUATING: the same member would be refused by #336/#338.
select pg_temp.test_login('33900000-0000-0000-0000-000000000009', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '["t-339-ind"]'::jsonb));
select lives_ok(format($$ select public.cancel_task(%s, 'Echipa a decis sa renunte.') $$,
  (select ind_team_task_id from f339)),
  'an Independent Team''s own active member cancels their Team''s Task -- private.can_manage_origin admits them, and cancelling awards nobody anything');
reset role;
select pg_temp.test_login('33900000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.cancel_task(%s, 'Nu mai e necesar.') $$,
  (select proj_resp_task_id from f339)),
  'an active Project''s Responsible cancels a Task on their Project');
reset role;
select pg_temp.test_login('33900000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.cancel_task(%s, 'Leadul opreste taskul.') $$,
  (select proj_member_task_id from f339)),
  'and the Project lead cancels the very Task the plain member was refused');
reset role;

select is((select count(*) from public.notifications
            where task_id = (select ind_team_task_id from f339)), 0::bigint,
  'the Independent-Team Task had no Executor and no queue, so its cancellation notifies nobody');
select is((select format('%s|%s', notification.member_id::text, notification.title)
             from public.notifications as notification
            where notification.task_id = (select proj_member_task_id from f339)),
  format('%s|Task anulat: Proiect membru #339', '33900000-0000-0000-0000-000000000008'),
  'while the Project member whose work was called off is told, by the lead who called it off');

-- ==================== 8. The command is the only write path ====================
-- Since #345 `public.tasks` is stopped the same way the two history tables
-- always were: by table privileges, before RLS is ever consulted. Pinning
-- each message is what stops a future migration granting DML back from
-- passing this test by swapping one 42501 for another. The
-- tasks_cancel_reason_ck biconditional itself is still proven -- section 4
-- exercises it as the table owner, where no grant can mask it.
select pg_temp.test_login('33900000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ update public.tasks
     set status = 'cancelled', cancelled_at = now() where id = %s $$,
  (select direct_write_task_id from f339)),
  '42501', 'permission denied for table tasks',
  'a manager cannot cancel a Task by hand at all since #345 -- the table grants stop the direct update before RLS or the constraint is reached');
select throws_ok(format($$ update public.task_assignments
     set ended_at = now(), end_reason = 'cancelled' where id = %s $$,
  (select direct_write_assignment_id from f339)),
  '42501', 'permission denied for table task_assignments',
  'and a manager cannot end an Assignment by hand -- the table grants stop it before RLS is consulted');
select throws_ok(format($$ insert into public.task_candidates (task_id, member_id, status)
  values (%s, '33900000-0000-0000-0000-000000000013', 'closed') $$,
  (select direct_write_task_id from f339)),
  '42501', 'permission denied for table task_candidates',
  'nor decide a Candidature by hand');
reset role;

select is((select format('%s|%s|%s', task.status::text,
                         coalesce(task.cancel_reason, 'null'),
                         (select (assignment.ended_at is null)::text from public.task_assignments as assignment
                           where assignment.id = (select direct_write_assignment_id from f339)))
             from public.tasks as task where task.id = (select direct_write_task_id from f339)),
  'in_progress|null|true',
  'the direct-write target survives all three attempts unchanged');

-- ==================== 9. The #338 interaction this migration closes ====================
-- reopen_task let a Subtask be reopened under a cancelled Umbrella. That was
-- unreachable before this migration (an Umbrella could not be cancelled), so
-- this migration both opens the hole and closes it, amending
-- private.reopen_task_impl with create or replace.
select pg_temp.test_login('33900000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Bun') $$,
  (select doomed_subtask_id from f339)),
  'the Subtask under the doomed Umbrella is completed through the real command first');
select lives_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Bun') $$,
  (select live_subtask_id from f339)),
  'and so is the control Subtask under the Umbrella that stays alive');
select lives_ok(format($$ select public.cancel_task(%s, 'Umbrela se anuleaza.') $$,
  (select doomed_umbrella_id from f339)),
  'the Umbrella is then cancelled -- its only Subtask is already completed, so the cascade has nothing to take down');
select is((select task.status::text from public.tasks as task
            where task.id = (select doomed_subtask_id from f339)),
  'completed', 'and that completed Subtask keeps its outcome under the cancelled Umbrella');
select throws_ok(format($$ select public.reopen_task(%s, 'Vreau sa reiau') $$,
  (select doomed_subtask_id from f339)),
  'PT409', 'umbrella_cancelled',
  'reopening a Subtask under a CANCELLED Umbrella is refused -- it would put live work back under a parent that was called off in full');
select lives_ok(format($$ select public.reopen_task(%s, 'Reiau, umbrela e vie') $$,
  (select live_subtask_id from f339)),
  'while the identical Subtask under a live Umbrella still reopens -- the new precondition does not over-fire');
reset role;

select is((select format('%s|%s',
                         (select task.status::text from public.tasks as task where task.id = (select doomed_subtask_id from f339)),
                         (select count(*) from public.task_evaluations as evaluation
                           where evaluation.task_id = (select doomed_subtask_id from f339)
                             and evaluation.reversed_at is not null))),
  'completed|0',
  'the refused reopen rolled everything back: the Subtask is still completed and its Evaluation still stands');

-- ==================== 10. Locks held while the command runs ====================
-- Sections 10-11 work on COMMITTED fixtures through their own dblink
-- connections: pg_temp.test_race commits both of its sessions for real, so
-- nothing this suite's own rolled-back transaction created is visible there.
--
-- The probe below is the one the brief demands, and every one of its
-- assertions DISCRIMINATES -- each was verified by running the mutation and
-- reverting it (captured output is in the task report):
--
--   * the UMBRELLA is checked in two assertions (fix-round #339: the single
--     original assertion went RED under all three mutations below, so it did
--     not isolate any one of them). (a) pins that the row is locked AT ALL:
--     drop step 3's lock entirely and the row carries no lock, RED. (b) pins
--     the EXACT mode string `For No Key Update`, given (a) holds: strengthen
--     step 3 to `for update` and it reports `For Update`, RED; remove the
--     cascade's batch lock and the command will have UPDATEd the Umbrella
--     before it blocks, so the row reports the UPDATER mode `No Key Update`,
--     RED again.
--   * the FIRST SUBTASK assertions pin `For No Key Update` and the ABSENCE of
--     any updater mode -- the signature of a row that is LOCKED BUT NOT YET
--     WRITTEN. The command is held blocked on the SECOND Subtask, which a
--     third session owns. With the cascade's single-statement
--     `for no key update` in place, the first Subtask is locked and
--     untouched; fold that lock into the mutation loop and the command would
--     have written it before blocking, and pgrowlocks reports
--     `No Key Update`: RED.
--   * the deadlock pair at the end of this section is the reason the mode is
--     weak at all, and it is not a claim taken on faith: under the
--     `for update` mutation this database really does answer 40P01.
select extensions.dblink_connect('ct_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));

-- Clean first (the #336/#338 precedent): these fixtures are COMMITTED, so an
-- earlier aborted run would otherwise leave them behind and every later run
-- would fail on a duplicate key instead of on the feature.
select extensions.dblink_exec('ct_setup', $$
  set session_replication_role = 'replica';
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#339 committed%');
  set session_replication_role = 'origin';
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#339 committed%')
      or member_id in ('33900000-0000-0000-0000-000000000051',
                       '33900000-0000-0000-0000-000000000052',
                       '33900000-0000-0000-0000-000000000053');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%#339 committed%');
  delete from public.tasks
   where parent_task_id in (select id from public.tasks where title like '%#339 committed%');
  delete from public.tasks where title like '%#339 committed%';
  delete from public.member_departments where member_id in (
    '33900000-0000-0000-0000-000000000051', '33900000-0000-0000-0000-000000000052',
    '33900000-0000-0000-0000-000000000053');
  delete from auth.users where id in (
    '33900000-0000-0000-0000-000000000051', '33900000-0000-0000-0000-000000000052',
    '33900000-0000-0000-0000-000000000053');
$$);

select extensions.dblink_exec('ct_setup', $$
  insert into auth.users (id, email) values
    ('33900000-0000-0000-0000-000000000051', 'probe.manager.339@test.local'),
    ('33900000-0000-0000-0000-000000000052', 'probe.executor.339@test.local'),
    ('33900000-0000-0000-0000-000000000053', 'race.executor.339@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('33900000-0000-0000-0000-000000000051', 'Probe Manager 339', 'probe.manager.339@test.local', 'bce', 'activ'),
    ('33900000-0000-0000-0000-000000000052', 'Probe Executor 339', 'probe.executor.339@test.local', 'voluntar', 'activ'),
    ('33900000-0000-0000-0000-000000000053', 'Race Executor 339', 'race.executor.339@test.local', 'voluntar', 'activ');
  insert into public.member_departments (member_id, dept_id) values
    ('33900000-0000-0000-0000-000000000051', 'edu'),
    ('33900000-0000-0000-0000-000000000052', 'edu'),
    ('33900000-0000-0000-0000-000000000053', 'edu');

  insert into public.tasks
    (title, description, dept_id, kind, audience, assignment_mode, status, created_at, created_by)
  values ('Umbrela sonda #339 committed', 'Umbrela', 'edu', 'umbrella', null, null, 'todo',
          now() - interval '5 days', '33900000-0000-0000-0000-000000000051');

  insert into public.tasks
    (title, description, deadline, dept_id, audience, assignment_mode, status, parent_task_id,
     created_at, created_by)
  select 'Sonda subtask A #339 committed', 'Primul', now() + interval '10 days', 'edu', 'local', 'direct', 'todo',
         parent.id, now() - interval '5 days', '33900000-0000-0000-0000-000000000051'
    from public.tasks as parent where parent.title = 'Umbrela sonda #339 committed';
  insert into public.tasks
    (title, description, deadline, dept_id, audience, assignment_mode, status, parent_task_id,
     created_at, created_by)
  select 'Sonda subtask B #339 committed', 'Al doilea', now() + interval '10 days', 'edu', 'local', 'direct', 'todo',
         parent.id, now() - interval '5 days', '33900000-0000-0000-0000-000000000051'
    from public.tasks as parent where parent.title = 'Umbrela sonda #339 committed';

  insert into public.tasks
    (title, description, deadline, dept_id, audience, assignment_mode, status,
     created_at, started_at, created_by)
  values ('Cursa anulare #339 committed', 'Doua anulari, un task', now() + interval '10 days', 'edu',
          'local', 'direct', 'in_progress',
          now() - interval '5 days', now() - interval '4 days',
          '33900000-0000-0000-0000-000000000051');
  insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
  select id, '33900000-0000-0000-0000-000000000053'::uuid, '33900000-0000-0000-0000-000000000051'::uuid,
         now() - interval '4 days'
    from public.tasks where title = 'Cursa anulare #339 committed';
$$);

create temp table r339 as
select (select id from public.tasks where title = 'Umbrela sonda #339 committed') as probe_umbrella_id,
       (select id from public.tasks where title = 'Sonda subtask A #339 committed') as probe_sub_a_id,
       (select id from public.tasks where title = 'Sonda subtask B #339 committed') as probe_sub_b_id,
       (select id from public.tasks where title = 'Cursa anulare #339 committed') as race_task_id;
grant select on r339 to authenticated;

select ok((select probe_sub_a_id < probe_sub_b_id from r339),
  'the probe Subtasks were created in id order, so the cascade -- which locks `order by sub.id` -- reaches A before B');

create function pg_temp.wait_until_blocked(p_application_name text)
returns boolean
language plpgsql
as $fn$
declare
  v_attempt integer;
begin
  for v_attempt in 1..300 loop
    perform pg_catalog.pg_stat_clear_snapshot();
    if exists (
      select 1
        from pg_catalog.pg_stat_activity
       where application_name = p_application_name
         and wait_event_type = 'Lock'
    ) then
      return true;
    end if;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  return false;
end;
$fn$;

-- Session HOLD owns the LAST Subtask the cascade will reach.
select extensions.dblink_connect('ct_hold', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres application_name=ct_hold_339',
  current_database()));
select extensions.dblink_exec('ct_hold', $$
  begin;
  set local statement_timeout = '20s';
$$);
select * from extensions.dblink('ct_hold', format($$
  select task.status::text from public.tasks as task where task.id = %s for update
$$, (select probe_sub_b_id from r339))) as hold_sub_b(status text);

-- Session CANCEL runs the real command, asynchronously, so it can sit blocked.
select extensions.dblink_connect('ct_cancel', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres application_name=ct_cancel_339',
  current_database()));
select extensions.dblink_exec('ct_cancel', $$
  begin;
  set local statement_timeout = '20s';
  set local lock_timeout = '15s';
$$);
select * from extensions.dblink('ct_cancel', format($$
  select set_config('request.jwt.claims', %L, true)
$$, jsonb_build_object(
      'sub', '33900000-0000-0000-0000-000000000051', 'role', 'authenticated',
      'app_metadata', jsonb_build_object('member_role', 'bce', 'member_level', 5,
        'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text))
  as remote_claims(setting text);
select extensions.dblink_exec('ct_cancel', 'set local role authenticated');
-- Single-field `(f(...)).status` projection on purpose: two fields would run
-- the command twice (the wave's standing warning).
select extensions.dblink_send_query('ct_cancel', format($$
  select (public.cancel_task(%s, 'Sonda de blocaj')).status::text
$$, (select probe_umbrella_id from r339)));

select ok(pg_temp.wait_until_blocked('ct_cancel_339'),
  'the cascade has taken the Umbrella lock and the first Subtask lock and is now waiting for the second Subtask that session HOLD owns');

-- #339: split into two assertions, each isolating one fact -- the original
-- single assertion went RED under all three of this section's lock
-- mutations, because "the Umbrella is held in lock-only For No Key Update"
-- states three things at once (a lock exists, it has not yet been upgraded
-- by a write, and its mode is exactly For No Key Update). (a) below is the
-- weakest of the three and fails only when step 3's lock is missing
-- entirely; (b) isolates the mode itself. Note pgrowlocks reports the exact
-- string `For No Key Update` for the lock mode -- `No Key Update` (no
-- leading `For`) is the UPDATER string, reported once a write has actually
-- landed on the row.
select ok(exists (
  select 1
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_umbrella_id from r339)
), '(a) the UMBRELLA row is locked at all while the cascade is blocked');
select is((
  select row_lock.modes
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_umbrella_id from r339)
), array['For No Key Update'],
  '(b) and, given it is locked, its mode is exactly FOR NO KEY UPDATE -- never For Update, which would deadlock against private.evaluate_task''s implicit FK For Key Share on the same row');
select ok(coalesce((
  select 'For No Key Update' = any(row_lock.modes)
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_sub_a_id from r339)
), false), 'and the FIRST Subtask is held in that same lock-only mode -- locked by the cascade''s single batch statement and not yet written, which is what a per-row lock folded into the mutation loop could not produce (it would report the updater mode No Key Update)');
select ok(not coalesce((
  select row_lock.modes && array['No Key Update', 'Update']
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_sub_a_id from r339)
), false), 'stated as its own assertion: the first Subtask carries NO updater lock yet -- the whole cascade set is locked before a single row is changed');

-- The deadlock this command must NOT have, reproduced directly on the state
-- section 10 already holds. Session HOLD is standing in for the
-- private.evaluate_task side of the cycle: it owns one Subtask FOR UPDATE --
-- exactly what evaluate_task holds -- and now performs evaluate_task's OTHER
-- lock acquisition, the parent-naming task_activity insert whose foreign key
-- runs as `select 1 from public.tasks where id = $1 for key share` on the
-- Umbrella. Meanwhile the real cancel_task holds that Umbrella and is waiting
-- for HOLD's Subtask. FOR KEY SHARE conflicts with FOR UPDATE but NOT with
-- FOR NO KEY UPDATE, which is the entire reason for the weaker mode: with
-- `for update` at step 3 this is a genuine ABBA cycle and Postgres aborts one
-- of the two backends with 40P01. WHICH one depends on whose deadlock_timeout
-- expires first and this database does not let us pin that (deadlock_timeout
-- is superuser-only), so BOTH ends are asserted -- HOLD's insert must not
-- raise, and the cancellation must come back with a status rather than a
-- SQLSTATE. Exactly one of the two goes RED whichever backend is chosen.
-- MUTATION-VERIFIED; see the task report for the captured output.
select lives_ok(format($outer$ select extensions.dblink_exec('ct_hold', %L) $outer$,
  format($$
    insert into public.task_activity (task_id, kind, actor_id, from_status, to_status, details)
    values (%s, 'subtask_completed', '33900000-0000-0000-0000-000000000051', null, null,
            jsonb_build_object('probe', '339 deadlock'))
  $$, (select probe_umbrella_id from r339))),
  'evaluate_task''s parent-naming insert -- an implicit FK FOR KEY SHARE on the Umbrella -- goes straight through while a cancellation holds that Umbrella and waits on this very session''s Subtask: FOR NO KEY UPDATE does not conflict with FOR KEY SHARE, and FOR UPDATE would deadlock (40P01) here');

-- A deadlock propagates out of extensions.dblink_get_result and cannot be
-- caught in plain SQL, and under the mutation the cancellation is one of the
-- two backends that may be aborted -- so it is caught here and turned into a
-- value the assertion can diff.
create function pg_temp.ct_cancel_result()
returns text
language plpgsql
as $fn$
declare
  v_status text;
begin
  select remote.status into v_status
    from extensions.dblink_get_result('ct_cancel') as remote(status text);
  return coalesce(v_status, '(no row)');
exception when others then
  return sqlstate;
end;
$fn$;

select extensions.dblink_exec('ct_hold', 'rollback');
select extensions.dblink_disconnect('ct_hold');
select is(pg_temp.ct_cancel_result(), 'cancelled',
  'and once HOLD lets go the cancellation finishes normally, never with a 40P01 -- the weaker lock mode costs this command nothing');
select extensions.dblink_exec('ct_cancel', 'rollback');
select extensions.dblink_disconnect('ct_cancel');

-- ==================== 11. Race: two cancellations, one Task ====================
-- pg_temp.test_race runs call A to completion, sends call B while A is
-- uncommitted, waits until B blocks, then commits A and fetches B's result.
-- This is what discriminates step 3's target lock: with it, B blocks on the
-- tasks row, re-reads A's committed `cancelled` status under EvalPlanQual and
-- answers PT409 task_terminal. B's error propagates out of
-- extensions.dblink_get_result and cannot be caught in SQL, so the whole call
-- is wrapped in throws_ok.
select pg_temp.test_login('33900000-0000-0000-0000-000000000051', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($outer$
  select * from pg_temp.test_race(%L, %L)
$outer$,
  format($$ select (public.cancel_task(%s, 'Apelul A')).status::text $$,
    (select race_task_id from r339)),
  format($$ select (public.cancel_task(%s, 'Apelul B')).status::text $$,
    (select race_task_id from r339))),
  'PT409', 'task_terminal',
  'the second cancellation blocks on the target row lock and then answers task_terminal against the first''s committed state -- never a second cancel_reason overwriting the first');
reset role;

select is((select format('%s|%s|%s', task.status::text, task.cancel_reason,
                         (select count(*) from public.task_activity as activity
                           where activity.task_id = task.id and activity.kind = 'cancelled'))
             from public.tasks as task where task.id = (select race_task_id from r339)),
  'cancelled|Apelul A|1',
  'exactly one cancellation survives the race, carrying the FIRST caller''s reason and exactly one cancelled activity row');
select is((select count(*) from public.task_assignments
            where task_id = (select race_task_id from r339) and ended_at is null), 0::bigint,
  'and the Executor''s Assignment was ended exactly once');

-- ==================== 12. The committed fixtures leave no trace ====================
select extensions.dblink_exec('ct_setup', $$
  set session_replication_role = 'replica';
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#339 committed%');
  set session_replication_role = 'origin';
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#339 committed%')
      or member_id in ('33900000-0000-0000-0000-000000000051',
                       '33900000-0000-0000-0000-000000000052',
                       '33900000-0000-0000-0000-000000000053');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%#339 committed%');
  delete from public.tasks
   where parent_task_id in (select id from public.tasks where title like '%#339 committed%');
  delete from public.tasks where title like '%#339 committed%';
  delete from public.member_departments where member_id in (
    '33900000-0000-0000-0000-000000000051', '33900000-0000-0000-0000-000000000052',
    '33900000-0000-0000-0000-000000000053');
  delete from auth.users where id in (
    '33900000-0000-0000-0000-000000000051', '33900000-0000-0000-0000-000000000052',
    '33900000-0000-0000-0000-000000000053');
$$);
select extensions.dblink_disconnect('ct_setup');

select is((select count(*) from public.tasks where title like '%#339 committed%'), 0::bigint,
  'the committed lock-probe and race fixtures are removed again -- this suite leaves no trace');
select is((select count(*) from public.profiles
            where id in ('33900000-0000-0000-0000-000000000051',
                         '33900000-0000-0000-0000-000000000052',
                         '33900000-0000-0000-0000-000000000053')), 0::bigint,
  'including the personas they ran as');


-- #521: Group authority regression matrix.
\ir _group_task_fixtures.psql
reset role;
select pg_temp.g521_task('command0','project',5,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($$select public.cancel_task((select id from g521_tasks where name='command0'),'Reason #521')$$,'cancel_task: Group persona 2 on executor 5 in project');
reset role;
select pg_temp.g521_task('command1','project',4,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select throws_ok($$select public.cancel_task((select id from g521_tasks where name='command1'),'Reason #521')$$,'42501','task_manage_forbidden','cancel_task: Group persona 3 on executor 4 in project');
reset role;
select pg_temp.g521_task('command2','ind',7,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(6));
select lives_ok($$select public.cancel_task((select id from g521_tasks where name='command2'),'Reason #521')$$,'cancel_task: Group persona 6 on executor 7 in ind');
reset role;
select pg_temp.g521_task('command3','dt',5,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(8));
select throws_ok($$select public.cancel_task((select id from g521_tasks where name='command3'),'Reason #521')$$,'42501','task_manage_forbidden','cancel_task: Group persona 8 on executor 5 in dt');
reset role;

select * from finish();
rollback;
