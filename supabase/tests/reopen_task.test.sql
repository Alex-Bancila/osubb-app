-- #338: public.reopen_task -- the undo of an Evaluation. An evaluator
-- reopens a completed/unfulfilled Task: the open `command` Evaluation is
-- reversed, its points are given back through a second ledger row, and the
-- same member is put back to work on a NEW Assignment, all in one
-- transaction.
--
-- What this suite pins that no earlier suite does:
--   * the ATOMIC reversal -- both ledger rows standing, sharing one
--     evaluation_id, and the member's total back at its pre-evaluation value
--     (deliberately non-zero: the happy-path Executor carries a -2 sanction
--     from before, so "back to zero" could not pass by accident);
--   * the reopen -> re-evaluate path, which #336's task_already_evaluated
--     guard is keyed on `reversed_at is null` specifically to keep legal;
--   * the arithmetic at the edges (section 6): a Rating-1 Evaluation awarded
--     NEGATIVE points and its reversal must give them back, a Rating-2 one
--     awarded exactly zero and its reversal must still be written;
--   * the Umbrella cascade and its LOCK, which is the one place in the wave
--     where a command locks a parent row -- and section 13 reproduces the
--     interleaving that makes the STRENGTH of that lock load-bearing: a
--     reopen holding the Umbrella FOR UPDATE would deadlock against
--     private.evaluate_task's implicit FK FOR KEY SHARE on the same row;
--   * section 9.3: a Project Responsible may reverse neither the lead's
--     award nor their own, a rule private.can_evaluate_task cannot express
--     on a terminal Task (its carve-out keys on the ACTIVE Assignment, and
--     a terminal Task has none) and private.reopen_task_impl re-applies
--     locally against the Assignment being reversed.
-- The full can_evaluate_task persona matrix itself is #336's
-- (complete_task_review.test.sql section 6/7) and is not re-derived here;
-- section 7 pins only the boundaries this command must not move.
--
-- Fixture prefix 33800000-0000-0000-0000-0000000000NN throughout, resolved
-- as the owner into temp tables before any persona logs in (the #328 trap,
-- stack-context.md carry-forwards). The committed lock-probe and race
-- fixtures use 33800000-...-0000000000[5-9]N and carry '#338 committed' in
-- their titles.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(120);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('33800000-0000-0000-0000-000000000001', 'bc.338@test.local'),
  ('33800000-0000-0000-0000-000000000002', 'bce.edu.338@test.local'),
  ('33800000-0000-0000-0000-000000000003', 'bce.pr.338@test.local'),
  ('33800000-0000-0000-0000-000000000004', 'exec.happy.338@test.local'),
  ('33800000-0000-0000-0000-000000000005', 'member.edu.338@test.local'),
  ('33800000-0000-0000-0000-000000000006', 'proj.lead.338@test.local'),
  ('33800000-0000-0000-0000-000000000007', 'proj.responsible.338@test.local'),
  ('33800000-0000-0000-0000-000000000008', 'proj.member.338@test.local'),
  ('33800000-0000-0000-0000-000000000009', 'ind.team.338@test.local'),
  ('33800000-0000-0000-0000-000000000010', 'inactive.bc.338@test.local'),
  ('33800000-0000-0000-0000-000000000011', 'claimless.338@test.local'),
  ('33800000-0000-0000-0000-000000000012', 'exec.unfulfilled.338@test.local'),
  ('33800000-0000-0000-0000-000000000013', 'exec.subtask.338@test.local'),
  ('33800000-0000-0000-0000-000000000014', 'exec.legacy.338@test.local'),
  ('33800000-0000-0000-0000-000000000015', 'exec.inprogress.338@test.local'),
  ('33800000-0000-0000-0000-000000000016', 'exec.directwrite.338@test.local'),
  ('33800000-0000-0000-0000-000000000017', 'exec.authority.338@test.local'),
  ('33800000-0000-0000-0000-000000000018', 'exec.deactivated.338@test.local'),
  ('33800000-0000-0000-0000-000000000019', 'candidate.a.338@test.local'),
  ('33800000-0000-0000-0000-000000000020', 'candidate.b.338@test.local'),
  ('33800000-0000-0000-0000-000000000021', 'exec.negative.338@test.local'),
  ('33800000-0000-0000-0000-000000000022', 'exec.zero.338@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('33800000-0000-0000-0000-000000000001', 'BC 338', 'bc.338@test.local', 'bc', 'activ'),
  ('33800000-0000-0000-0000-000000000002', 'BCE EDU 338', 'bce.edu.338@test.local', 'bce', 'activ'),
  ('33800000-0000-0000-0000-000000000003', 'BCE PR 338', 'bce.pr.338@test.local', 'bce', 'activ'),
  ('33800000-0000-0000-0000-000000000004', 'Executor Fericit 338', 'exec.happy.338@test.local', 'voluntar', 'activ'),
  ('33800000-0000-0000-0000-000000000005', 'Membru EDU 338', 'member.edu.338@test.local', 'voluntar', 'activ'),
  ('33800000-0000-0000-0000-000000000006', 'Lead Proiect 338', 'proj.lead.338@test.local', 'voluntar', 'activ'),
  ('33800000-0000-0000-0000-000000000007', 'Responsabil Proiect 338', 'proj.responsible.338@test.local', 'voluntar', 'activ'),
  ('33800000-0000-0000-0000-000000000008', 'Membru Proiect 338', 'proj.member.338@test.local', 'voluntar', 'activ'),
  ('33800000-0000-0000-0000-000000000009', 'Membru Echipa Independenta 338', 'ind.team.338@test.local', 'voluntar', 'activ'),
  ('33800000-0000-0000-0000-000000000010', 'BC Inactiv 338', 'inactive.bc.338@test.local', 'bc', 'inactiv'),
  ('33800000-0000-0000-0000-000000000011', 'Fara Claimuri 338', 'claimless.338@test.local', 'voluntar', 'activ'),
  ('33800000-0000-0000-0000-000000000012', 'Executor Nerealizat 338', 'exec.unfulfilled.338@test.local', 'voluntar', 'activ'),
  ('33800000-0000-0000-0000-000000000013', 'Executor Subtask 338', 'exec.subtask.338@test.local', 'voluntar', 'activ'),
  ('33800000-0000-0000-0000-000000000014', 'Executor Vechi 338', 'exec.legacy.338@test.local', 'voluntar', 'activ'),
  ('33800000-0000-0000-0000-000000000015', 'Executor In Lucru 338', 'exec.inprogress.338@test.local', 'voluntar', 'activ'),
  ('33800000-0000-0000-0000-000000000016', 'Executor Scriere 338', 'exec.directwrite.338@test.local', 'voluntar', 'activ'),
  ('33800000-0000-0000-0000-000000000017', 'Executor Autoritate 338', 'exec.authority.338@test.local', 'voluntar', 'activ'),
  ('33800000-0000-0000-0000-000000000018', 'Executor Dezactivat 338', 'exec.deactivated.338@test.local', 'voluntar', 'activ'),
  ('33800000-0000-0000-0000-000000000019', 'Candidat A 338', 'candidate.a.338@test.local', 'voluntar', 'activ'),
  ('33800000-0000-0000-0000-000000000020', 'Candidat B 338', 'candidate.b.338@test.local', 'voluntar', 'activ'),
  ('33800000-0000-0000-0000-000000000021', 'Executor Negativ 338', 'exec.negative.338@test.local', 'voluntar', 'activ'),
  ('33800000-0000-0000-0000-000000000022', 'Executor Neutru 338', 'exec.zero.338@test.local', 'voluntar', 'activ');

insert into public.member_departments (member_id, dept_id) values
  ('33800000-0000-0000-0000-000000000002', 'edu'),
  ('33800000-0000-0000-0000-000000000003', 'pr'),
  ('33800000-0000-0000-0000-000000000004', 'edu'),
  ('33800000-0000-0000-0000-000000000005', 'edu'),
  ('33800000-0000-0000-0000-000000000011', 'edu'),
  ('33800000-0000-0000-0000-000000000012', 'edu'),
  ('33800000-0000-0000-0000-000000000013', 'edu'),
  ('33800000-0000-0000-0000-000000000014', 'edu'),
  ('33800000-0000-0000-0000-000000000015', 'edu'),
  ('33800000-0000-0000-0000-000000000016', 'edu'),
  ('33800000-0000-0000-0000-000000000017', 'edu'),
  ('33800000-0000-0000-0000-000000000018', 'edu'),
  ('33800000-0000-0000-0000-000000000019', 'edu'),
  ('33800000-0000-0000-0000-000000000020', 'edu'),
  ('33800000-0000-0000-0000-000000000021', 'edu'),
  ('33800000-0000-0000-0000-000000000022', 'edu');

insert into public.teams (id, name, dept_id) values
  ('t-338-ind', 'Echipa Independenta 338', null);

insert into public.team_members (team_id, member_id) values
  ('t-338-ind', '33800000-0000-0000-0000-000000000009');

insert into public.projects (name, status, leader_id, created_by) values
  ('Proiect #338', 'active',
   '33800000-0000-0000-0000-000000000006', '33800000-0000-0000-0000-000000000001');

insert into public.project_members (project_id, member_id, project_role) values
  ((select id from public.projects where name = 'Proiect #338'),
   '33800000-0000-0000-0000-000000000007', 'responsible'),
  ((select id from public.projects where name = 'Proiect #338'),
   '33800000-0000-0000-0000-000000000008', 'member');

-- The happy-path Executor already carries a sanction, so "the total returns
-- to its pre-evaluation value" is a real -2, never a zero that a missing
-- reversal could also produce.
insert into public.points_ledger (member_id, delta, reason, note, awarded_by)
values ('33800000-0000-0000-0000-000000000004', -2, 'sanction', 'Sanctiune anterioara #338',
        '33800000-0000-0000-0000-000000000001');

-- Section 6's two Executors carry prior sanctions for the same reason: with a
-- Rating-1 award the reversal must ADD points back, and with a Rating-2 award
-- it must move the total by exactly nothing -- neither is distinguishable
-- from "no reversal at all" if the member starts and ends at zero.
insert into public.points_ledger (member_id, delta, reason, note, awarded_by)
values ('33800000-0000-0000-0000-000000000021', -3, 'sanction', 'Sanctiune anterioara negativ #338',
        '33800000-0000-0000-0000-000000000001'),
       ('33800000-0000-0000-0000-000000000022', -5, 'sanction', 'Sanctiune anterioara neutru #338',
        '33800000-0000-0000-0000-000000000001');

-- ---- T1: the happy path. A PUBLIC edu Task in_review with a live Executor
-- and two pending Candidates, completed below through the real command.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, queue_opened_at, started_at, submitted_at, created_by)
values
  ('Redeschidere fericita #338', 'De verificat din nou', now() + interval '10 days', 'edu', 'org', 'public', 'in_review',
   now() - interval '10 days', now() - interval '10 days', now() - interval '9 days', now() - interval '1 day',
   '33800000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33800000-0000-0000-0000-000000000004', '33800000-0000-0000-0000-000000000002',
       now() - interval '9 days'
  from public.tasks where title = 'Redeschidere fericita #338';
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33800000-0000-0000-0000-000000000019'::uuid, 'pending', now() - interval '8 days'
  from public.tasks where title = 'Redeschidere fericita #338'
union all
select id, '33800000-0000-0000-0000-000000000020'::uuid, 'pending', now() - interval '7 days'
  from public.tasks where title = 'Redeschidere fericita #338';

-- ---- T2: an OVERDUE, never-started direct Task, marked unfulfilled below.
-- started_at stays null through the Evaluation, so the reopen must set it.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, created_by)
values
  ('Nerealizat netinceput #338', 'Nimeni nu a inceput', now() - interval '2 days', 'edu', 'local', 'direct', 'todo',
   now() - interval '10 days', '33800000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33800000-0000-0000-0000-000000000012', '33800000-0000-0000-0000-000000000002',
       now() - interval '9 days'
  from public.tasks where title = 'Nerealizat netinceput #338';

-- ---- T3/U1: a Subtask under an Umbrella. The Subtask is completed through
-- the command; the Umbrella is then set `completed` as the owner, exactly
-- the rollup #340 will write.
insert into public.tasks
  (title, description, dept_id, kind, audience, assignment_mode, status, created_at, created_by)
values ('Umbrela incheiata #338', 'Umbrela', 'edu', 'umbrella', null, null, 'todo',
        now() - interval '10 days', '33800000-0000-0000-0000-000000000002');
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, parent_task_id,
   created_at, started_at, submitted_at, created_by)
select 'Subtask de redeschis #338', 'Sub umbrela', now() + interval '10 days', 'edu', 'local', 'direct', 'in_review',
       parent.id, now() - interval '10 days', now() - interval '9 days', now() - interval '1 day',
       '33800000-0000-0000-0000-000000000002'
  from public.tasks as parent where parent.title = 'Umbrela incheiata #338';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33800000-0000-0000-0000-000000000013', '33800000-0000-0000-0000-000000000002',
       now() - interval '9 days'
  from public.tasks where title = 'Subtask de redeschis #338';

-- ---- U2: a plain Umbrella, for the task_is_umbrella refusal.
insert into public.tasks
  (title, description, dept_id, kind, audience, assignment_mode, status, created_at, created_by)
values ('Umbrela simpla #338', 'Umbrela', 'edu', 'umbrella', null, null, 'todo',
        now() - interval '10 days', '33800000-0000-0000-0000-000000000002');

-- ---- T4: a Task carrying ONLY a legacy_migration Evaluation. #316's
-- header asked reopen to reverse legacy Evaluations too; this command
-- deliberately does not (see the migration header) -- there is nothing of
-- ITS OWN to reverse, so it refuses with evaluation_not_found.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   difficulty, rating, created_at, started_at, completed_at, created_by)
values
  ('Doar evaluare veche #338', 'Creditat inainte de #316', now() - interval '20 days', 'edu', 'local', 'direct', 'completed',
   3, 4, now() - interval '30 days', now() - interval '29 days', now() - interval '20 days',
   '33800000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at, ended_at, end_reason)
select id, '33800000-0000-0000-0000-000000000014', '33800000-0000-0000-0000-000000000002',
       now() - interval '29 days', now() - interval '20 days', 'completed'
  from public.tasks where title = 'Doar evaluare veche #338';
-- #317 closed the legacy source by trigger; supabase/seed.sql suppresses it
-- the same way to rebuild one legacy-shaped demo Task, in the open.
-- session_replication_role, NOT `alter table ... disable trigger`: the ALTER
-- takes a SHARE ROW EXCLUSIVE lock on task_evaluations that this suite's own
-- (uncommitted) transaction would then hold to the end, deadlocking the
-- committed dblink fixtures in section 10 against it.
set local session_replication_role = 'replica';
insert into public.task_evaluations
  (task_id, assignment_id, source, evaluated_by, outcome, difficulty, rating, points, note, evaluated_at)
select task.id, assignment.id, 'legacy_migration', null, 'completed', 3, 4, 6,
       'Backfill istoric #338', now() - interval '20 days'
  from public.tasks as task
  join public.task_assignments as assignment on assignment.task_id = task.id
 where task.title = 'Doar evaluare veche #338';
set local session_replication_role = 'origin';
insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id)
select '33800000-0000-0000-0000-000000000014', 6, 'task', evaluation.task_id, evaluation.id
  from public.task_evaluations as evaluation
  join public.tasks as task on task.id = evaluation.task_id
 where task.title = 'Doar evaluare veche #338';

-- ---- T5: still in progress, never evaluated.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, created_by)
values
  ('Inca in lucru #338', 'Nimic de redeschis', now() + interval '10 days', 'edu', 'local', 'direct', 'in_progress',
   now() - interval '10 days', now() - interval '9 days', '33800000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33800000-0000-0000-0000-000000000015', '33800000-0000-0000-0000-000000000002',
       now() - interval '9 days'
  from public.tasks where title = 'Inca in lucru #338';

-- ---- T6: the direct-write target, completed through the command below.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('Scriere directa #338', 'Tinta', now() + interval '10 days', 'edu', 'local', 'direct', 'in_review',
   now() - interval '10 days', now() - interval '9 days', now() - interval '1 day',
   '33800000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33800000-0000-0000-0000-000000000016', '33800000-0000-0000-0000-000000000002',
       now() - interval '9 days'
  from public.tasks where title = 'Scriere directa #338';

-- ---- T7: the authority-matrix target; every attempt on it is DENIED, so
-- it must survive section 7 untouched.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('Autoritate dept #338', 'Tinta pentru refuzuri', now() + interval '10 days', 'edu', 'local', 'direct', 'in_review',
   now() - interval '10 days', now() - interval '9 days', now() - interval '1 day',
   '33800000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33800000-0000-0000-0000-000000000017', '33800000-0000-0000-0000-000000000002',
       now() - interval '9 days'
  from public.tasks where title = 'Autoritate dept #338';

-- ---- T8: the Executor is deactivated after their work is evaluated.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('Executor plecat #338', 'Nu mai e activ', now() + interval '10 days', 'edu', 'local', 'direct', 'in_review',
   now() - interval '10 days', now() - interval '9 days', now() - interval '1 day',
   '33800000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33800000-0000-0000-0000-000000000018', '33800000-0000-0000-0000-000000000002',
       now() - interval '9 days'
  from public.tasks where title = 'Executor plecat #338';

-- ---- T9: an Independent-Team Task. Its own members never evaluate
-- (ADR-0007); BC/Moderator does.
insert into public.tasks
  (title, description, deadline, team_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('Echipa independenta #338', 'Task de echipa', now() + interval '10 days', 't-338-ind', 'local', 'direct', 'in_review',
   now() - interval '10 days', now() - interval '9 days', now() - interval '1 day',
   '33800000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33800000-0000-0000-0000-000000000009', '33800000-0000-0000-0000-000000000001',
       now() - interval '9 days'
  from public.tasks where title = 'Echipa independenta #338';

-- ---- P1/P2/P3: Project Tasks. P1 and P2 are the LEAD's own work, P3 a
-- plain Project member's.
insert into public.tasks
  (title, description, deadline, project_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
select 'Proiect lead propriu #338', 'Munca leadului', now() + interval '10 days',
       project.id, 'local', 'direct', 'in_review'::public.task_status,
       now() - interval '10 days', now() - interval '9 days', now() - interval '1 day',
       '33800000-0000-0000-0000-000000000001'::uuid
  from public.projects as project where project.name = 'Proiect #338'
union all
select 'Proiect responsabil peste lead #338', 'Munca leadului, vazuta de responsabil', now() + interval '10 days',
       project.id, 'local', 'direct', 'in_review'::public.task_status,
       now() - interval '10 days', now() - interval '9 days', now() - interval '1 day',
       '33800000-0000-0000-0000-000000000001'::uuid
  from public.projects as project where project.name = 'Proiect #338'
union all
select 'Proiect membru simplu #338', 'Munca unui membru', now() + interval '10 days',
       project.id, 'local', 'direct', 'in_review'::public.task_status,
       now() - interval '10 days', now() - interval '9 days', now() - interval '1 day',
       '33800000-0000-0000-0000-000000000001'::uuid
  from public.projects as project where project.name = 'Proiect #338';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33800000-0000-0000-0000-000000000006'::uuid, '33800000-0000-0000-0000-000000000001'::uuid,
       now() - interval '9 days'
  from public.tasks where title = 'Proiect lead propriu #338'
union all
select id, '33800000-0000-0000-0000-000000000006'::uuid, '33800000-0000-0000-0000-000000000001'::uuid,
       now() - interval '9 days'
  from public.tasks where title = 'Proiect responsabil peste lead #338'
union all
select id, '33800000-0000-0000-0000-000000000008'::uuid, '33800000-0000-0000-0000-000000000001'::uuid,
       now() - interval '9 days'
  from public.tasks where title = 'Proiect membru simplu #338';

-- ---- P4: the RESPONSIBLE's own overdue work, marked unfulfilled below with
-- a Rating of 1 -- a real -4 penalty on their own record. Reopening it would
-- erase that penalty, which is the self-benefit section 9.3 refuses.
insert into public.tasks
  (title, description, deadline, project_id, audience, assignment_mode, status,
   created_at, created_by)
select 'Proiect responsabil propriu #338', 'Munca responsabilului, nelivrata', now() - interval '2 days',
       project.id, 'local', 'direct', 'todo'::public.task_status,
       now() - interval '10 days', '33800000-0000-0000-0000-000000000001'::uuid
  from public.projects as project where project.name = 'Proiect #338';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33800000-0000-0000-0000-000000000007', '33800000-0000-0000-0000-000000000001',
       now() - interval '9 days'
  from public.tasks where title = 'Proiect responsabil propriu #338';

-- ---- T10/T11: a NEGATIVE award (Rating 1 -> public.rating_mult = -1) and a
-- ZERO one (Rating 2 -> 0). public.rating_mult maps 1..5 to -1, 0, 1, 2, 3,
-- so a Rating-1 Evaluation awarded -difficulty and its reversal must ADD
-- that back; a Rating-2 Evaluation moved nothing and its reversal must move
-- nothing either. Section 6 reverses both.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
values
  ('Redeschidere negativa #338', 'Punctaj negativ', now() + interval '10 days', 'edu', 'local', 'direct', 'in_review',
   now() - interval '10 days', now() - interval '9 days', now() - interval '1 day',
   '33800000-0000-0000-0000-000000000002'),
  ('Redeschidere neutra #338', 'Punctaj zero', now() + interval '10 days', 'edu', 'local', 'direct', 'in_review',
   now() - interval '10 days', now() - interval '9 days', now() - interval '1 day',
   '33800000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33800000-0000-0000-0000-000000000021'::uuid, '33800000-0000-0000-0000-000000000002'::uuid,
       now() - interval '9 days'
  from public.tasks where title = 'Redeschidere negativa #338'
union all
select id, '33800000-0000-0000-0000-000000000022'::uuid, '33800000-0000-0000-0000-000000000002'::uuid,
       now() - interval '9 days'
  from public.tasks where title = 'Redeschidere neutra #338';

-- ==================== Ids, resolved as the owner ====================
create temp table f338 as
select
  (select id from public.tasks where title = 'Redeschidere fericita #338') as happy_task_id,
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'Redeschidere fericita #338') as happy_assignment_id,
  (select id from public.tasks where title = 'Nerealizat netinceput #338') as unfulfilled_task_id,
  (select id from public.tasks where title = 'Umbrela incheiata #338') as umbrella_id,
  (select id from public.tasks where title = 'Subtask de redeschis #338') as subtask_id,
  (select id from public.tasks where title = 'Umbrela simpla #338') as plain_umbrella_id,
  (select id from public.tasks where title = 'Doar evaluare veche #338') as legacy_task_id,
  (select id from public.tasks where title = 'Inca in lucru #338') as in_progress_task_id,
  (select id from public.tasks where title = 'Scriere directa #338') as direct_write_task_id,
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'Scriere directa #338') as direct_write_assignment_id,
  (select id from public.tasks where title = 'Autoritate dept #338') as authority_task_id,
  (select id from public.tasks where title = 'Executor plecat #338') as deactivated_task_id,
  (select id from public.tasks where title = 'Echipa independenta #338') as ind_team_task_id,
  (select id from public.tasks where title = 'Proiect lead propriu #338') as proj_lead_task_id,
  (select id from public.tasks where title = 'Proiect responsabil peste lead #338') as proj_resp_task_id,
  (select id from public.tasks where title = 'Proiect membru simplu #338') as proj_member_task_id,
  (select id from public.tasks where title = 'Proiect responsabil propriu #338') as proj_resp_own_task_id,
  (select id from public.tasks where title = 'Redeschidere negativa #338') as negative_task_id,
  (select id from public.tasks where title = 'Redeschidere neutra #338') as zero_task_id;
-- anon too: the anon denial in section 8 resolves an id through this table
-- in its own format() before the command is ever reached (the #337 pattern).
grant select on f338 to authenticated, anon;

-- ==================== 1. API shape and privileges ====================

select has_function('public', 'reopen_task', array['bigint', 'text'],
  'public.reopen_task exists with the pinned two-parameter signature');
select is(pg_get_function_identity_arguments(
    'public.reopen_task(bigint, text)'::regprocedure),
  'p_task_id bigint, p_reason text',
  'reopen_task exposes no actor parameter -- the actor is always auth.uid()');
select is(pg_get_function_result('public.reopen_task(bigint, text)'::regprocedure),
  'tasks', 'reopen_task returns the affected Task row');
select ok(not (select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public' and procedure.proname = 'reopen_task'),
  'the public command is a security invoker wrapper');
select ok((select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private' and procedure.proname = 'reopen_task_impl'),
  'private.reopen_task_impl runs as owner (security definer)');
select ok(coalesce((
    select 'search_path=""' = any(procedure.proconfig)
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private' and procedure.proname = 'reopen_task_impl'
  ), false), 'private.reopen_task_impl pins an empty search_path');
select ok(has_function_privilege('authenticated',
  'public.reopen_task(bigint, text)'::regprocedure, 'execute'),
  'authenticated can execute public.reopen_task');
select ok(not has_function_privilege('anon',
  'public.reopen_task(bigint, text)'::regprocedure, 'execute'),
  'anon cannot execute public.reopen_task');
select ok(has_function_privilege('authenticated',
  'private.reopen_task_impl(bigint, text)'::regprocedure, 'execute'),
  'authenticated can execute private.reopen_task_impl');
select ok(not has_function_privilege('service_role',
  'public.reopen_task(bigint, text)'::regprocedure, 'execute'),
  'service_role holds no execute on the wrapper either (conventions Sec4)');

-- ==================== 2. Evaluate everything the suite reopens ====================
-- Every terminal fixture below is brought to its terminal state through the
-- REAL commands, so the pre-state this suite reverses is exactly the one
-- production produces -- never a hand-built approximation of it.

select pg_temp.test_login('33800000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.complete_task_review(%s, 3, 4, 'Bun') $$,
  (select happy_task_id from f338)), 'T1 is completed through complete_task_review (3 x 2 = 6 points)');
select lives_ok(format($$ select public.mark_task_unfulfilled(%s, 2, 3, 'Nelivrat') $$,
  (select unfulfilled_task_id from f338)), 'T2 is marked unfulfilled through the command (2 x 1 = 2 points)');
select lives_ok(format($$ select public.complete_task_review(%s, 4, 5, 'Excelent') $$,
  (select subtask_id from f338)), 'the Subtask is completed through the command (4 x 3 = 12 points)');
select lives_ok(format($$ select public.complete_task_review(%s, 1, 3, 'Ok') $$,
  (select direct_write_task_id from f338)), 'T6 is completed through the command');
select lives_ok(format($$ select public.complete_task_review(%s, 2, 4, 'Ok') $$,
  (select authority_task_id from f338)), 'T7 is completed through the command');
select lives_ok(format($$ select public.complete_task_review(%s, 3, 3, 'Ok') $$,
  (select deactivated_task_id from f338)), 'T8 is completed through the command');
select lives_ok(format($$ select public.complete_task_review(%s, 2, 3, 'Ok') $$,
  (select ind_team_task_id from f338)), 'the Independent-Team Task is completed by BC');
select lives_ok(format($$ select public.complete_task_review(%s, 2, 3, 'Ok') $$,
  (select proj_lead_task_id from f338)), 'P1 is completed through the command');
select lives_ok(format($$ select public.complete_task_review(%s, 2, 3, 'Ok') $$,
  (select proj_resp_task_id from f338)), 'P2 is completed through the command');
select lives_ok(format($$ select public.complete_task_review(%s, 2, 3, 'Ok') $$,
  (select proj_member_task_id from f338)), 'P3 is completed through the command');
select lives_ok(format($$ select public.mark_task_unfulfilled(%s, 4, 1, 'Nelivrat de responsabil') $$,
  (select proj_resp_own_task_id from f338)),
  'P4 -- the Responsible''s OWN overdue work -- is marked unfulfilled by BC (4 x -1 = -4, a real penalty)');
select lives_ok(format($$ select public.complete_task_review(%s, 4, 1, 'Slab') $$,
  (select negative_task_id from f338)), 'T10 is completed with Rating 1 -- a NEGATIVE award (4 x -1 = -4)');
select lives_ok(format($$ select public.complete_task_review(%s, 3, 2, 'Neutru') $$,
  (select zero_task_id from f338)), 'T11 is completed with Rating 2 -- a ZERO award (3 x 0 = 0)');
reset role;

-- The Umbrella is rolled up by hand -- #340 has not shipped yet -- into
-- exactly the shape its rollup will produce.
update public.tasks set status = 'completed', completed_at = now()
 where id = (select umbrella_id from f338);
-- The Executor of T8 leaves the organisation after being credited.
update public.profiles set status = 'inactiv'
 where id = '33800000-0000-0000-0000-000000000018';

create temp table e338 as
select
  (select evaluation.id from public.task_evaluations as evaluation
    where evaluation.task_id = (select happy_task_id from f338)) as happy_evaluation_id,
  (select evaluation.id from public.task_evaluations as evaluation
    where evaluation.task_id = (select unfulfilled_task_id from f338)) as unfulfilled_evaluation_id,
  (select evaluation.id from public.task_evaluations as evaluation
    where evaluation.task_id = (select direct_write_task_id from f338)) as direct_write_evaluation_id,
  (select evaluation.id from public.task_evaluations as evaluation
    where evaluation.task_id = (select authority_task_id from f338)) as authority_evaluation_id,
  (select evaluation.id from public.task_evaluations as evaluation
    where evaluation.task_id = (select deactivated_task_id from f338)) as deactivated_evaluation_id;
grant select on e338 to authenticated;

select pg_temp.test_login('33800000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select points from public.my_points), 4,
  'before the reopen the happy-path Executor stands at -2 (an old sanction) + 6 (the award) = 4');
reset role;

-- ==================== 3. The happy path: reopening a completed Task ====================

select pg_temp.test_login('33800000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.reopen_task(%s, '  Livrabilul nu era complet  ') $$,
  (select happy_task_id from f338)),
  'the local BCE of the Task''s Department reopens the completed Task');
reset role;

select is((select format('%s|%s|%s|%s|%s|%s|%s|%s', task.status,
                         (task.difficulty is null)::text, (task.rating is null)::text,
                         (task.completed_at is null)::text, (task.unfulfilled_at is null)::text,
                         (task.submitted_at is null)::text, (task.started_at is not null)::text,
                         task.review_round)
             from public.tasks as task where task.id = (select happy_task_id from f338)),
  'in_progress|true|true|true|true|true|true|0',
  'the Task is back in_progress with Difficulty, Rating, completed_at and submitted_at cleared, started_at kept and review_round untouched');
select is((select (task.queue_closed_at is not null)::text
             from public.tasks as task where task.id = (select happy_task_id from f338)),
  'true',
  'the Candidate Queue STAYS closed -- a manager reopens it with set_task_queue if they want one');
select is((select format('%s|%s|%s', (evaluation.reversed_at is not null)::text,
                         evaluation.reversed_by, evaluation.reversal_reason)
             from public.task_evaluations as evaluation
            where evaluation.id = (select happy_evaluation_id from e338)),
  'true|33800000-0000-0000-0000-000000000002|Livrabilul nu era complet',
  'the open Evaluation is reversed by the actor, with the trimmed reason');
select is((select format('%s|%s|%s|%s|%s', evaluation.source, evaluation.outcome,
                         evaluation.difficulty, evaluation.rating, evaluation.points)
             from public.task_evaluations as evaluation
            where evaluation.id = (select happy_evaluation_id from e338)),
  'command|completed|3|4|6',
  'and is otherwise preserved exactly -- an Evaluation is a record, never overwritten (ADR-0007)');
select set_eq(
  format($$ select format('%%s|%%s|%%s', ledger.reason, ledger.delta,
                          (ledger.evaluation_id = %s)::text)
              from public.points_ledger as ledger where ledger.task_id = %s $$,
    (select happy_evaluation_id from e338), (select happy_task_id from f338)),
  $$ values ('task|6|true'), ('task_reversal|-6|true') $$,
  'BOTH ledger rows stand -- the original credit and its reversal -- sharing one evaluation_id');
select is((select count(*) from public.points_ledger
            where task_id = (select happy_task_id from f338)), 2::bigint,
  'the original credit is never deleted or rewritten: the ledger stays append-only');

select pg_temp.test_login('33800000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select points from public.my_points), -2,
  'the Executor''s total is back at its exact pre-evaluation value (-2), not at zero');
reset role;

select is((select format('%s|%s', assignment.end_reason, (assignment.ended_at is not null)::text)
             from public.task_assignments as assignment
            where assignment.id = (select happy_assignment_id from f338)),
  'completed|true',
  'the evaluated Assignment stays ended ''completed'' -- history is not rewritten');
select is((select format('%s|%s', assignment.member_id, assignment.assigned_by)
             from public.task_assignments as assignment
            where assignment.task_id = (select happy_task_id from f338)
              and assignment.ended_at is null),
  '33800000-0000-0000-0000-000000000004|33800000-0000-0000-0000-000000000002',
  'a NEW active Assignment puts the same member back to work, assigned by the reopening evaluator');
select is((select count(*) from public.task_assignments
            where task_id = (select happy_task_id from f338)), 2::bigint,
  'exactly two Assignments now exist on the Task: the ended one and the new one');

create temp table a338 as
select (select assignment.id from public.task_assignments as assignment
         where assignment.task_id = (select happy_task_id from f338)
           and assignment.ended_at is null) as new_assignment_id;
grant select on a338 to authenticated;

select is((select format('%s|%s|%s|%s|%s|%s', activity.kind, activity.actor_id,
                         (activity.assignment_id = (select new_assignment_id from a338))::text,
                         activity.from_status, activity.to_status, activity.note)
             from public.task_activity as activity
            where activity.task_id = (select happy_task_id from f338)
              and activity.kind = 'reopened'),
  'reopened|33800000-0000-0000-0000-000000000002|true|completed|in_progress|Livrabilul nu era complet',
  'one reopened activity row names the actor, the NEW Assignment, the completed -> in_progress transition and the trimmed reason');
select is((select format('%s|%s|%s',
                         (activity.details ->> 'evaluation_id' = (select happy_evaluation_id::text from e338))::text,
                         (activity.details ->> 'reversal_ledger_id' = (select ledger.id::text from public.points_ledger as ledger
                            where ledger.task_id = (select happy_task_id from f338) and ledger.reason = 'task_reversal'))::text,
                         (activity.details ->> 'new_assignment_id' = (select new_assignment_id::text from a338))::text)
             from public.task_activity as activity
            where activity.task_id = (select happy_task_id from f338)
              and activity.kind = 'reopened'),
  'true|true|true',
  'details carries the reversed Evaluation, the reversal ledger row and the new Assignment');
select is((select format('%s|%s', activity.details ->> 'via',
                         (activity.assignment_id = (select new_assignment_id from a338))::text)
             from public.task_activity as activity
            where activity.task_id = (select happy_task_id from f338)
              and activity.kind = 'executor_assigned'),
  'reopen|true',
  'private.open_task_assignment records the reactivation with details.via = ''reopen''');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s and notification.title like 'Task redeschis%%' $$,
    (select happy_task_id from f338)),
  $$ values ('33800000-0000-0000-0000-000000000004'::uuid) $$,
  'exactly the reactivated Executor is notified -- the reopening evaluator hears nothing about their own act');
select is((select format('%s|%s', notification.title, notification.body)
             from public.notifications as notification
            where notification.task_id = (select happy_task_id from f338)
              and notification.title like 'Task redeschis%'),
  'Task redeschis: Redeschidere fericita #338|Livrabilul nu era complet',
  'the pinned "Task redeschis" copy carries the trimmed reason as its body');
select is((select count(*) from public.notifications
            where task_id = (select happy_task_id from f338)
              and title like 'Task nou%'), 0::bigint,
  'and private.open_task_assignment''s own "Task nou" notification is suppressed for p_via = ''reopen'' -- one message, not two');
select is((select count(*) from public.task_candidates
            where task_id = (select happy_task_id from f338) and status = 'pending'), 0::bigint,
  'no Candidature is left pending -- the reopened Executor can never also be a pending Candidate (stack-context carry-forward)');

-- ==================== 4. Reopen -> re-evaluate, end to end ====================
-- #336's task_already_evaluated guard is keyed on `source = command and
-- reversed_at is null`, deliberately NOT on tasks.status, precisely so this
-- path stays legal. If this section ever fails, that interaction is broken.

select pg_temp.test_login('33800000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.submit_task_for_review(%s) $$,
  (select happy_task_id from f338)),
  'the reactivated Executor can submit the reopened Task for review again');
reset role;
select pg_temp.test_login('33800000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.complete_task_review(%s, 5, 3, 'Acum e bine') $$,
  (select happy_task_id from f338)),
  'and the Task can be evaluated a SECOND time -- the reversed Evaluation does not block a new one');
reset role;

select is((select count(*) from public.task_evaluations
            where task_id = (select happy_task_id from f338)), 2::bigint,
  'two Evaluations now exist on the Task');
select is((select format('%s|%s', count(*) filter (where evaluation.reversed_at is not null),
                         count(*) filter (where evaluation.reversed_at is null))
             from public.task_evaluations as evaluation
            where evaluation.task_id = (select happy_task_id from f338)),
  '1|1', 'exactly one is reversed (the first) and one is open (the second)');
select set_eq(
  format($$ select format('%%s|%%s', ledger.reason, ledger.delta)
              from public.points_ledger as ledger where ledger.task_id = %s $$,
    (select happy_task_id from f338)),
  $$ values ('task|6'), ('task_reversal|-6'), ('task|5') $$,
  'three ledger rows: the first credit, its reversal, and the new credit (5 x 1 = 5)');
select pg_temp.test_login('33800000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select points from public.my_points), 3,
  'the Executor''s total is -2 + 6 - 6 + 5 = 3 -- the reversal nets out exactly');
reset role;

-- ==================== 5. Reopening an unfulfilled Task that never started ====================

select pg_temp.test_login('33800000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.reopen_task(%s, 'Mai are o sansa') $$,
  (select unfulfilled_task_id from f338)),
  'an unfulfilled Task is reopened the same way a completed one is');
reset role;

select is((select format('%s|%s|%s|%s', task.status, (task.unfulfilled_at is null)::text,
                         (task.started_at is not null)::text, (task.started_at >= task.created_at)::text)
             from public.tasks as task where task.id = (select unfulfilled_task_id from f338)),
  'in_progress|true|true|true',
  'unfulfilled_at is cleared and started_at is set -- an unfulfilled Task may never have been started (tasks_started_at_state_check)');
select set_eq(
  format($$ select format('%%s|%%s', ledger.reason, ledger.delta)
              from public.points_ledger as ledger where ledger.task_id = %s $$,
    (select unfulfilled_task_id from f338)),
  $$ values ('task|2'), ('task_reversal|-2') $$,
  'the unfulfilled award (2 x 1) is reversed the same way a completion''s is');
select is((select format('%s|%s', activity.from_status, activity.to_status)
             from public.task_activity as activity
            where activity.task_id = (select unfulfilled_task_id from f338)
              and activity.kind = 'reopened'),
  'unfulfilled|in_progress',
  'the activity row records the unfulfilled -> in_progress transition');

-- ==================== 6. Zero and negative awards reverse arithmetically ====================
-- public.rating_mult maps Rating 1..5 to -1, 0, 1, 2, 3, so an Evaluation can
-- award a NEGATIVE number of points or exactly none. `delta = -points` has to
-- be right in both directions: reversing a Rating-1 award must give the
-- member points BACK (the ledger row is positive), and reversing a Rating-2
-- award must move nothing at all while still writing its row. Both Executors
-- carry a prior sanction, so "the total returns to its pre-evaluation value"
-- is a non-zero number that no missing reversal could also produce.

select pg_temp.test_login('33800000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.reopen_task(%s, 'Reevaluam nota mica') $$,
  (select negative_task_id from f338)),
  'a Task whose Evaluation awarded NEGATIVE points is reopened');
select lives_ok(format($$ select public.reopen_task(%s, 'Reevaluam nota neutra') $$,
  (select zero_task_id from f338)),
  'and so is one whose Evaluation awarded exactly zero');
reset role;

select set_eq(
  format($$ select format('%%s|%%s', ledger.reason, ledger.delta)
              from public.points_ledger as ledger where ledger.task_id = %s $$,
    (select negative_task_id from f338)),
  $$ values ('task|-4'), ('task_reversal|4') $$,
  'the reversal of a -4 award is a POSITIVE +4 row -- the member gets the penalty back, not a second one');
select pg_temp.test_login('33800000-0000-0000-0000-000000000021', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select points from public.my_points), -3,
  'and that Executor''s total returns to its exact pre-evaluation value (-3, an old sanction), up from -7');
reset role;

select set_eq(
  format($$ select format('%%s|%%s', ledger.reason, ledger.delta)
              from public.points_ledger as ledger where ledger.task_id = %s $$,
    (select zero_task_id from f338)),
  $$ values ('task|0'), ('task_reversal|0') $$,
  'a zero award is still reversed by a real, explicit zero row -- the Evaluation''s undo is recorded, not inferred');
select pg_temp.test_login('33800000-0000-0000-0000-000000000022', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select points from public.my_points), -5,
  'and that Executor''s total is unchanged at -5 -- a zero award and its reversal both move nothing');
reset role;

select is((select string_agg(task.status::text, '|' order by task.title)
             from public.tasks as task
            where task.id in ((select negative_task_id from f338),
                              (select zero_task_id from f338))),
  'in_progress|in_progress',
  'both Tasks are back in_progress -- the reversal arithmetic changes nothing about the transition');

-- ==================== 7. A Subtask under a completed Umbrella ====================
-- ADR-0007's rollup rule: a completed Umbrella with a live Subtask is an
-- impossible state, so the Umbrella comes back to todo with the Subtask.

select pg_temp.test_login('33800000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.reopen_task(%s, 'Refacem subtaskul') $$,
  (select subtask_id from f338)),
  'a Subtask under a completed Umbrella is reopened');
reset role;

select is((select format('%s|%s', task.status, (task.completed_at is null)::text)
             from public.tasks as task where task.id = (select umbrella_id from f338)),
  'todo|true',
  'the completed Umbrella is cascaded back to todo with completed_at cleared');
select is((select format('%s|%s|%s|%s|%s', activity.kind, activity.actor_id,
                         (activity.assignment_id is null)::text,
                         activity.from_status, activity.to_status)
             from public.task_activity as activity
            where activity.task_id = (select umbrella_id from f338)
              and activity.kind = 'reopened'),
  'reopened|33800000-0000-0000-0000-000000000002|true|completed|todo',
  'the Umbrella gets its OWN reopened row, with no assignment_id -- an Umbrella has no Executor');
select is((select activity.details ->> 'cascade_from'
             from public.task_activity as activity
            where activity.task_id = (select umbrella_id from f338)
              and activity.kind = 'reopened'),
  (select subtask_id::text from f338),
  'details.cascade_from names the Subtask whose reopening caused it');
select is((select task.status::text from public.tasks as task
            where task.id = (select subtask_id from f338)),
  'in_progress', 'and the Subtask itself is back in_progress');
select is((select count(*) from public.notifications
            where task_id = (select umbrella_id from f338)
              and title like 'Task redeschis%'), 0::bigint,
  'the cascade sends no notification of its own -- the Subtask''s Executor is the only person this command messages');

-- ==================== 8. Input validation and state preconditions ====================

select pg_temp.test_login('33800000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.reopen_task(%s, '   ') $$,
  (select direct_write_task_id from f338)),
  'PT400', 'reason_required', 'a whitespace-only reason is rejected');
select throws_ok(format($$ select public.reopen_task(%s, null) $$,
  (select direct_write_task_id from f338)),
  'PT400', 'reason_required', 'a null reason is rejected');
select throws_ok(format($$ select public.reopen_task(%s, 'Redeschide') $$,
  (select plain_umbrella_id from f338)),
  'PT409', 'task_is_umbrella',
  'an Umbrella is refused by kind -- it carries no Evaluation to reverse (#340 owns its rollup)');
select throws_ok(format($$ select public.reopen_task(%s, 'Redeschide') $$,
  (select in_progress_task_id from f338)),
  'PT409', 'task_not_evaluated', 'a Task still in progress has nothing to reopen');
select throws_ok(format($$ select public.reopen_task(%s, 'Redeschide') $$,
  (select legacy_task_id from f338)),
  'PT409', 'evaluation_not_found',
  'a Task carrying only a legacy_migration Evaluation has no command Evaluation of its own to reverse');
select throws_ok($$ select public.reopen_task(999999999, 'Redeschide') $$,
  'PT404', 'task_not_found', 'an unknown Task id is not found');
select throws_ok($$ select public.reopen_task(null, 'Redeschide') $$,
  'PT404', 'task_not_found',
  'a null Task id is the same non-disclosing answer, never PT400 (wave ruling)');
select throws_ok(format($$ select public.reopen_task(%s, 'Redeschide') $$,
  (select deactivated_task_id from f338)),
  'PT400', 'invalid_executor',
  'a Task whose evaluated Executor has since been deactivated cannot be reopened onto them -- ADR-0007 requires active membership for every operation');
reset role;

select is((select format('%s|%s|%s',
                         (task.status)::text,
                         (select count(*) from public.points_ledger as ledger where ledger.task_id = task.id),
                         (select count(*) filter (where evaluation.reversed_at is not null)
                            from public.task_evaluations as evaluation where evaluation.task_id = task.id))
             from public.tasks as task where task.id = (select deactivated_task_id from f338)),
  'completed|1|0',
  'and that refusal rolls the WHOLE command back: no reversal row, no reversed Evaluation, the Task still completed');
select is((select count(*) from public.task_evaluations
            where task_id = (select legacy_task_id from f338) and reversed_at is not null), 0::bigint,
  'the legacy Evaluation is left untouched by the refusal');

-- ==================== 9. Authority ====================
-- The can_evaluate_task matrix itself belongs to #336; these pin only the
-- boundaries reopen_task must not move.

-- 9.1 denied
select pg_temp.test_login('33800000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["pr"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.reopen_task(%s, 'Redeschide') $$,
  (select authority_task_id from f338)),
  '42501', 'task_evaluate_forbidden', 'the BCE of another Department cannot reopen an edu Task');
reset role;
select pg_temp.test_login('33800000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
-- Not 42501: an ordinary Department member cannot even SEE a direct,
-- completed Department Task they never worked on (private.can_read_task's R6
-- only admits live public Opportunities), and conventions Sec3 forbids
-- letting a caller distinguish hidden from missing. The
-- can-read-but-cannot-evaluate boundary is pinned by the foreign BCE above
-- and by the Independent-Team and Project personas below.
select throws_ok(format($$ select public.reopen_task(%s, 'Redeschide') $$,
  (select authority_task_id from f338)),
  'PT404', 'task_not_found',
  'an ordinary member of the Origin Department cannot reopen -- and is told nothing about the Task existing');
reset role;
select pg_temp.test_login('33800000-0000-0000-0000-000000000009', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '["t-338-ind"]'::jsonb));
select throws_ok(format($$ select public.reopen_task(%s, 'Redeschide') $$,
  (select ind_team_task_id from f338)),
  '42501', 'task_evaluate_forbidden',
  'an Independent Team''s own member cannot reopen their Team''s Task -- ADR-0007 gives evaluation there to BC/Moderator only');
reset role;
select pg_temp.test_login('33800000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.reopen_task(%s, 'Redeschide') $$,
  (select proj_member_task_id from f338)),
  '42501', 'task_evaluate_forbidden', 'a plain Project member cannot reopen their own evaluated work');
reset role;
select pg_temp.test_login('33800000-0000-0000-0000-000000000010', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.reopen_task(%s, 'Redeschide') $$,
  (select authority_task_id from f338)),
  '42501', 'task_command_forbidden',
  'a deactivated BC holding a still-valid level-6 token is stopped at the gate');
reset role;
select pg_temp.test_login('33800000-0000-0000-0000-000000000011', '{"provider":"email"}'::jsonb);
select throws_ok(format($$ select public.reopen_task(%s, 'Redeschide') $$,
  (select authority_task_id from f338)),
  '42501', 'task_command_forbidden', 'a real uid without organisation claims is stopped at the gate too');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(format($$ select public.reopen_task(%s, 'Redeschide') $$,
  (select authority_task_id from f338)),
  '42501', 'permission denied for function reopen_task',
  'anon cannot execute reopen_task at all -- the literal grant denial');
reset role;

select is((select format('%s|%s|%s', task.status,
                         (select count(*) from public.task_activity as activity
                           where activity.task_id = task.id and activity.kind = 'reopened'),
                         (select count(*) from public.points_ledger as ledger
                           where ledger.task_id = task.id and ledger.reason = 'task_reversal'))
             from public.tasks as task where task.id = (select authority_task_id from f338)),
  'completed|0|0',
  'after every denial the authority target is untouched: still completed, no reopened row, no reversal');
select is((select count(*) from public.notifications
            where task_id = (select authority_task_id from f338)
              and title like 'Task redeschis%'), 0::bigint,
  'and a refused reopen is SILENT -- no notification reaches the Task''s Executor about a reopening that never happened');

-- 9.2 allowed
select pg_temp.test_login('33800000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.reopen_task(%s, 'Reiau eu') $$,
  (select proj_lead_task_id from f338)),
  'an active Project''s lead reopens their own evaluated work (ADR-0007 gives the lead everything on their Project)');
reset role;
select pg_temp.test_login('33800000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.reopen_task(%s, 'Reluam') $$,
  (select ind_team_task_id from f338)),
  'BC/Moderator reopens an Independent Team''s Task');
reset role;

select is((select count(*) from public.notifications
            where task_id = (select proj_lead_task_id from f338)
              and title like 'Task redeschis%'), 0::bigint,
  'the lead who reopened their OWN Task gets no notification -- private.notify always drops the actor');

-- 9.3 the Project Responsible's two self-benefiting reversals, both refused.
-- private.can_evaluate_task's carve-out ("a Responsible may act on neither
-- the lead's work nor their own") is keyed on the Task's ACTIVE Assignment
-- (`ended_at is null`), and a terminal Task has none -- so on exactly the
-- Tasks this command operates on that carve-out is vacuously true and the
-- shared predicate admits the Responsible. private.reopen_task_impl closes
-- the hole locally, re-applying the same rule against the Assignment being
-- REVERSED (the shared predicate is #327's and #336/#337 depend on its
-- current shape, so it is deliberately left alone). Same 42501
-- task_evaluate_forbidden require_task_evaluator raises: this IS the
-- evaluate-authority rule, and a second reason string would only tell the
-- caller which branch fired.
select pg_temp.test_login('33800000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.reopen_task(%s, 'Responsabilul redeschide') $$,
  (select proj_resp_task_id from f338)),
  '42501', 'task_evaluate_forbidden',
  'a Project Responsible cannot reopen the LEAD''s completed work -- reversing an award is evaluating it');
select throws_ok(format($$ select public.reopen_task(%s, 'Imi sterg pedeapsa') $$,
  (select proj_resp_own_task_id from f338)),
  '42501', 'task_evaluate_forbidden',
  'nor their OWN unfulfilled Task -- that would erase their own -4 penalty, the self-benefit the rule exists to stop');
reset role;

select is(
  format('%s|%s',
    (select count(*) from public.task_evaluations as evaluation
      where evaluation.task_id = (select proj_resp_task_id from f338)
        and evaluation.reversed_at is not null),
    (select coalesce(sum(ledger.delta), 0) from public.points_ledger as ledger
      where ledger.member_id = '33800000-0000-0000-0000-000000000007')),
  '0|-4',
  'both refusals held: the lead''s Evaluation is still open and the Responsible still carries their own -4');

-- ==================== 10. The command is the only write path ====================
-- Every expected message is pinned, not left null: all three denials are
-- 42501, and only the message says WHICH guarantee stopped the write. The
-- Evaluation is stopped by table privileges -- public.task_evaluations grants
-- `authenticated` (and service_role) `select` and nothing else (#316), so an
-- UPDATE never reaches RLS at all; that is a STRONGER guarantee
-- than a policy denial, and pinning its message is what stops a future
-- migration that grants `update` back from passing this test by swapping one
-- 42501 for another. The two points_ledger inserts do exercise RLS: the table
-- is insertable by `authenticated` and ledger_sanction, its only insert
-- policy, demands reason = 'sanction' -- so they fail the policy, with the
-- policy's own message.

select pg_temp.test_login('33800000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ update public.task_evaluations
     set reversed_at = now(), reversed_by = '33800000-0000-0000-0000-000000000002',
         reversal_reason = 'Fals'
   where id = %s $$, (select direct_write_evaluation_id from e338)),
  '42501', 'permission denied for table task_evaluations',
  'even the Task''s own evaluator cannot reverse an Evaluation directly -- the table grants stop it before RLS is even consulted, and private.reopen_task_impl is the only path');
select throws_ok(format($$ insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id)
  values ('33800000-0000-0000-0000-000000000016', 99, 'task_reversal', %s, %s) $$,
  (select direct_write_task_id from f338), (select direct_write_evaluation_id from e338)),
  '42501', 'new row violates row-level security policy for table "points_ledger"',
  'and cannot hand-write a reversal ledger row either -- the RLS POLICY rejects it: ledger_sanction is the only insert policy and it demands reason = sanction');
reset role;
select pg_temp.test_login('33800000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id)
  values ('33800000-0000-0000-0000-000000000016', 99, 'task_reversal', %s, %s) $$,
  (select direct_write_task_id from f338), (select direct_write_evaluation_id from e338)),
  '42501', 'new row violates row-level security policy for table "points_ledger"',
  'not even a BC can hand-write a reversal -- the same policy denial: level 6 buys sanctions, never awards or their undo');
reset role;

select is((select format('%s|%s', (evaluation.reversed_at is null)::text,
                         (select count(*) from public.points_ledger as ledger
                           where ledger.evaluation_id = evaluation.id))
             from public.task_evaluations as evaluation
            where evaluation.id = (select direct_write_evaluation_id from e338)),
  'true|1',
  'the direct-write target is still open and still carries exactly its one credit row');

-- ==================== 11. Locks held while the command runs ====================
-- Sections 11-13 work on COMMITTED fixtures through their own dblink
-- connections: pg_temp.test_race commits both of its sessions for real, so
-- nothing this suite's own rolled-back transaction created is visible there.
--
-- The Umbrella probe below is the one the brief demands, and it
-- DISCRIMINATES: its Umbrella is deliberately left `todo`, so the cascade
-- never fires and nothing else in the command touches that row. The ONLY
-- reason the Umbrella can show up locked is step 3's explicit
-- `for update`. (A COMPLETED Umbrella would be locked anyway by the
-- cascade's own UPDATE a few statements later, which is exactly why the
-- probe does not use one.) Mutation-verified both ways -- see the task
-- report for the captured RED/GREEN output.
--
-- Honest limitations, each established by running the mutation rather than
-- assumed, and stated rather than papered over:
--   * the TASKS-row assertion does not discriminate step 3's own
--     `for update` -- the command UPDATEs that same row a few statements
--     later inside the same held transaction, so the row is locked either
--     way. Section 11's race is what actually detects that keyword.
--   * the TASK_EVALUATIONS assertion does not discriminate step 7's
--     `for update` either, for the same reason: the reversal UPDATE follows
--     immediately. Removing the keyword leaves this whole suite green (run
--     and reverted; see the task report). It documents the lock, it does not
--     prove it. The keyword is kept because the row is the one the reversal
--     and the ledger entry both hang off, and the tasks-row lock -- which IS
--     proven, by section 11 -- is what actually serializes two reopens.
--   * the UMBRELLA assertion DOES discriminate, and is the one the brief
--     asks for.
select extensions.dblink_connect('rt_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));

-- Clean first (the #336 precedent): these fixtures are COMMITTED, so an
-- earlier aborted run of this suite would otherwise leave them behind and
-- every later run would fail on a duplicate key instead of on the feature.
select extensions.dblink_exec('rt_setup', $$
  set session_replication_role = 'replica';
  delete from public.points_ledger
   where task_id in (select id from public.tasks where title like '%#338 committed%');
  delete from public.task_evaluations
   where task_id in (select id from public.tasks where title like '%#338 committed%');
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#338 committed%');
  set session_replication_role = 'origin';
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#338 committed%')
      or member_id in ('33800000-0000-0000-0000-000000000051',
                       '33800000-0000-0000-0000-000000000052',
                       '33800000-0000-0000-0000-000000000053',
                       '33800000-0000-0000-0000-000000000054');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%#338 committed%');
  delete from public.tasks
   where parent_task_id in (select id from public.tasks where title like '%#338 committed%');
  delete from public.tasks where title like '%#338 committed%';
  delete from public.member_departments where member_id in (
    '33800000-0000-0000-0000-000000000051', '33800000-0000-0000-0000-000000000052',
    '33800000-0000-0000-0000-000000000053', '33800000-0000-0000-0000-000000000054');
  delete from auth.users where id in (
    '33800000-0000-0000-0000-000000000051', '33800000-0000-0000-0000-000000000052',
    '33800000-0000-0000-0000-000000000053', '33800000-0000-0000-0000-000000000054');
$$);

select extensions.dblink_exec('rt_setup', $$
  insert into auth.users (id, email) values
    ('33800000-0000-0000-0000-000000000051', 'probe.evaluator.338@test.local'),
    ('33800000-0000-0000-0000-000000000052', 'probe.manager.338@test.local'),
    ('33800000-0000-0000-0000-000000000053', 'probe.executor.338@test.local'),
    ('33800000-0000-0000-0000-000000000054', 'race.exec.338@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('33800000-0000-0000-0000-000000000051', 'Probe Evaluator 338', 'probe.evaluator.338@test.local', 'bce', 'activ'),
    ('33800000-0000-0000-0000-000000000052', 'Probe Manager 338', 'probe.manager.338@test.local', 'voluntar', 'activ'),
    ('33800000-0000-0000-0000-000000000053', 'Probe Executor 338', 'probe.executor.338@test.local', 'voluntar', 'activ'),
    ('33800000-0000-0000-0000-000000000054', 'Race Executor 338', 'race.exec.338@test.local', 'voluntar', 'activ');
  insert into public.member_departments (member_id, dept_id) values
    ('33800000-0000-0000-0000-000000000051', 'edu'),
    ('33800000-0000-0000-0000-000000000052', 'edu'),
    ('33800000-0000-0000-0000-000000000053', 'edu'),
    ('33800000-0000-0000-0000-000000000054', 'edu');

  insert into public.tasks
    (title, description, dept_id, kind, audience, assignment_mode, status, created_at, created_by)
  values ('Umbrela sonda #338 committed', 'Umbrela in lucru', 'edu', 'umbrella', null, null, 'todo',
          now() - interval '5 days', '33800000-0000-0000-0000-000000000052');

  insert into public.tasks
    (title, description, deadline, dept_id, audience, assignment_mode, status, parent_task_id,
     created_at, started_at, submitted_at, created_by)
  select 'Sonda blocaj redeschidere #338 committed', 'Sonda', now() + interval '10 days', 'edu', 'local', 'direct', 'in_review',
         parent.id, now() - interval '5 days', now() - interval '4 days', now() - interval '1 day',
         '33800000-0000-0000-0000-000000000052'
    from public.tasks as parent where parent.title = 'Umbrela sonda #338 committed';

  insert into public.tasks
    (title, description, deadline, dept_id, audience, assignment_mode, status,
     created_at, started_at, submitted_at, created_by)
  values
    ('Cursa dubla redeschidere #338 committed', 'Doua redeschideri, un task', now() + interval '10 days', 'edu', 'local', 'direct', 'in_review',
     now() - interval '5 days', now() - interval '4 days', now() - interval '1 day',
     '33800000-0000-0000-0000-000000000052');

  insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
  select id, '33800000-0000-0000-0000-000000000053'::uuid, '33800000-0000-0000-0000-000000000052'::uuid,
         now() - interval '4 days'
    from public.tasks where title = 'Sonda blocaj redeschidere #338 committed'
  union all
  select id, '33800000-0000-0000-0000-000000000054'::uuid, '33800000-0000-0000-0000-000000000052'::uuid,
         now() - interval '4 days'
    from public.tasks where title = 'Cursa dubla redeschidere #338 committed';
$$);

-- Both committed Tasks are evaluated through the real command, as the
-- committed BCE, so the probe and the race start from a genuine post-
-- Evaluation state.
-- An explicit remote transaction: dblink_exec is autocommit, so `set local`
-- claims would not survive from one call to the next without it.
select extensions.dblink_exec('rt_setup', $$
  begin;
  set local statement_timeout = '10s';
$$);
select * from extensions.dblink('rt_setup', format($$
  select set_config('request.jwt.claims', %L, true)
$$, jsonb_build_object(
      'sub', '33800000-0000-0000-0000-000000000051', 'role', 'authenticated',
      'app_metadata', jsonb_build_object('member_role', 'bce', 'member_level', 5,
        'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text))
  as remote_claims(setting text);
select extensions.dblink_exec('rt_setup', 'set local role authenticated');
-- Single-field projections: two fields would run each command twice.
select * from extensions.dblink('rt_setup', $$
  select (public.complete_task_review(
    (select id from public.tasks where title = 'Sonda blocaj redeschidere #338 committed'),
    3, 4, 'Sonda')).status::text
$$) as remote_probe(status text);
select * from extensions.dblink('rt_setup', $$
  select (public.complete_task_review(
    (select id from public.tasks where title = 'Cursa dubla redeschidere #338 committed'),
    3, 4, 'Cursa')).status::text
$$) as remote_race(status text);
select extensions.dblink_exec('rt_setup', 'reset role');
select extensions.dblink_exec('rt_setup', 'commit');

create temp table r338 as
select (select id from public.tasks where title = 'Sonda blocaj redeschidere #338 committed') as probe_task_id,
       (select id from public.tasks where title = 'Umbrela sonda #338 committed') as probe_umbrella_id,
       (select id from public.tasks where title = 'Cursa dubla redeschidere #338 committed') as race_task_id;
grant select on r338 to authenticated;

select extensions.dblink_connect('rt_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('rt_lock', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('rt_lock', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '33800000-0000-0000-0000-000000000051', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'bce', 'member_level', 5,
      'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text, true)
$$) as remote_claims(setting text);
select extensions.dblink_exec('rt_lock', 'set local role authenticated');
-- Single-field `(f(...)).status` projection on purpose: two fields would run
-- the command twice (complete_task_review.test.sql's standing warning).
select * from extensions.dblink('rt_lock', format($$
  select (public.reopen_task(%s, 'Sonda de blocaj')).status::text
$$, (select probe_task_id from r338))) as locked_reopen(status text);

-- Pinned to the EXACT mode, not to a family of writer modes: `For Update`
-- here would deadlock against private.evaluate_task's implicit FK
-- `For Key Share` on the same row (section 13 reproduces it), so this
-- assertion is a second guard against anyone strengthening step 3's lock.
select ok(coalesce((
  select 'For No Key Update' = any(row_lock.modes)
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_umbrella_id from r338)
), false), 'reopen_task holds the UMBRELLA row FOR NO KEY UPDATE while it runs -- exactly that mode, never For Update (section 13) -- and this Umbrella is todo, so nothing but step 3''s explicit lock can be holding it; an FK lock would show as For Key Share');
select ok(coalesce((
  select row_lock.modes && array['For Update', 'Update', 'No Key Update']
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_task_id from r338)
), false), 'and the target Subtask row too (locked second, after the Umbrella -- the wave''s lock order)');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.profiles') as row_lock
    join public.profiles as profile on profile.ctid = row_lock.locked_row
   where profile.id = '33800000-0000-0000-0000-000000000051'
), false), 'it holds the evaluator''s own live profile row FOR SHARE (private.require_origin_manager''s discipline)');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.group_members') as row_lock
    join public.group_members as membership on membership.ctid = row_lock.locked_row
    join public.groups as authority_group on authority_group.id = membership.group_id
   where membership.member_id = '33800000-0000-0000-0000-000000000051'
     and authority_group.legacy_dept_id = 'edu'
), false), 'and the Group roster row their evaluator authority rests on FOR SHARE too');
select ok(coalesce((
  select bool_or(row_lock.modes && array['For Update', 'Update', 'No Key Update'])
    from extensions.pgrowlocks('public.task_evaluations') as row_lock
    join public.task_evaluations as evaluation on evaluation.ctid = row_lock.locked_row
   where evaluation.task_id = (select probe_task_id from r338)
), false), 'the Evaluation being reversed is held exclusively -- selected FOR UPDATE before the reversal is written');

select extensions.dblink_exec('rt_lock', 'rollback');
select extensions.dblink_disconnect('rt_lock');

-- ==================== 12. Race: two reopens, one evaluated Task ====================
-- pg_temp.test_race runs call A to completion, sends call B while A is
-- uncommitted, waits until B blocks, then commits A and fetches B's result.
-- This is what discriminates step 3's tasks-row `for update`: with it, B
-- blocks on the tasks row, re-reads A's committed `in_progress` status under
-- EvalPlanQual and answers PT409 task_not_evaluated.
--
-- Mutation-verified: with `for update` removed from step 3's
-- `select * into v_task from public.tasks where id = p_task_id`, B no longer
-- blocks there. It sails past the (now stale) `completed` state check and
-- blocks one statement later on the EVALUATION row instead, then re-reads it
-- as already reversed and answers PT409 evaluation_not_found. Different
-- reason, same b_waited -- which is precisely why this assertion checks the
-- reason string and not merely that B waited. That mutation was run and
-- reverted; see the task report.
--
-- B's error propagates out of extensions.dblink_get_result and cannot be
-- caught in SQL, so the whole call is wrapped in throws_ok.
select pg_temp.test_login('33800000-0000-0000-0000-000000000051', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($outer$
  select * from pg_temp.test_race(%L, %L)
$outer$,
  format($$ select (public.reopen_task(%s, 'Apelul A')).status::text $$,
    (select race_task_id from r338)),
  format($$ select (public.reopen_task(%s, 'Apelul B')).status::text $$,
    (select race_task_id from r338))),
  'PT409', 'task_not_evaluated',
  'the second reopen blocks on the tasks-row lock and then answers task_not_evaluated against the first''s committed in_progress status -- never a second reversal');
reset role;

select is((select count(*) from public.points_ledger
            where task_id = (select race_task_id from r338) and reason = 'task_reversal'), 1::bigint,
  'exactly one reversal row survives the double-reopen race -- the award is given back once, not twice');
select is((select count(*) from public.task_assignments
            where task_id = (select race_task_id from r338) and ended_at is null), 1::bigint,
  'and exactly one active Assignment exists -- task_assignments_one_active_per_task_uidx never had to catch anything');
select is((select coalesce(sum(delta), 0) from public.points_ledger
            where member_id = '33800000-0000-0000-0000-000000000054'),
  0::bigint, 'the raced Executor''s total nets back to zero: +6 credited, -6 reversed, once each');

-- ==================== 13. The deadlock this command must NOT have ====================
-- The one interleaving the migration header is built around, reproduced
-- directly. private.evaluate_task takes NO explicit lock on the Umbrella,
-- but on a Subtask it inserts a task_activity row (and a notification) that
-- NAMES the parent -- and every insert of a referencing row runs its
-- referential-integrity check as
--   select 1 from public.tasks where id = $1 for key share
-- So it holds {Subtask FOR UPDATE} and then asks for
-- {Umbrella FOR KEY SHARE}, while this command holds the Umbrella and then
-- asks for the Subtask. FOR KEY SHARE conflicts with FOR UPDATE but NOT with
-- FOR NO KEY UPDATE, which is why the parent lock is the weaker mode.
--
-- Session A below is the evaluate_task side, reduced to exactly its two lock
-- acquisitions (the row lock, then a real parent-naming task_activity
-- insert) so the interleaving can be paused between them -- the function
-- itself is one atomic statement and cannot be. Session B is the REAL
-- public.reopen_task, so the mode this section discriminates is the one in
-- the migration.
--
-- With the lock strengthened to `for update` the cycle is real and Postgres
-- aborts one of the two sessions with 40P01 -- WHICH one depends on whose
-- deadlock_timeout expires first, and this database does not let us pin that
-- (deadlock_timeout is superuser-only and the local `postgres` role is not
-- one). So BOTH ends are asserted: A's insert must not raise, and B's reopen
-- must come back with a status rather than a SQLSTATE. Exactly one of the
-- two goes RED whichever backend is chosen as the victim.
-- MUTATION-VERIFIED; see the task report for the captured output.
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

-- B's result, or the SQLSTATE that replaced it. A deadlock propagates out of
-- extensions.dblink_get_result and cannot be caught in plain SQL, and with
-- the mutation in place B is one of the two backends that may be aborted --
-- so it is caught here and turned into a value the assertion can diff.
create function pg_temp.dl_reopen_result()
returns text
language plpgsql
as $fn$
declare
  v_status text;
begin
  select remote.status into v_status
    from extensions.dblink_get_result('rt_dl_b') as remote(status text);
  return coalesce(v_status, '(no row)');
exception when others then
  return sqlstate;
end;
$fn$;

select extensions.dblink_connect('rt_dl_a', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres application_name=rt_dl_a_338',
  current_database()));
select extensions.dblink_connect('rt_dl_b', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres application_name=rt_dl_b_338',
  current_database()));
-- Both timeouts comfortably exceed the 1s default deadlock_timeout, so a
-- real cycle is answered with 40P01 and never masked as a lock timeout.
select extensions.dblink_exec('rt_dl_a', $$
  begin;
  set local statement_timeout = '20s';
  set local lock_timeout = '15s';
$$);
select extensions.dblink_exec('rt_dl_b', $$
  begin;
  set local statement_timeout = '20s';
  set local lock_timeout = '15s';
$$);

-- A: exactly the row lock private.evaluate_task holds on the Subtask.
select * from extensions.dblink('rt_dl_a', format($$
  select task.status::text from public.tasks as task where task.id = %s for update
$$, (select probe_task_id from r338))) as a_holds_subtask(status text);

-- B: the real command, fired asynchronously so A can act while it waits.
select * from extensions.dblink('rt_dl_b', format($$
  select set_config('request.jwt.claims', %L, true)
$$, jsonb_build_object(
      'sub', '33800000-0000-0000-0000-000000000051', 'role', 'authenticated',
      'app_metadata', jsonb_build_object('member_role', 'bce', 'member_level', 5,
        'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text))
  as remote_claims(setting text);
select extensions.dblink_exec('rt_dl_b', 'set local role authenticated');
select extensions.dblink_send_query('rt_dl_b', format($$
  select (public.reopen_task(%s, 'Redeschidere concurenta')).status::text
$$, (select probe_task_id from r338)));

select ok(pg_temp.wait_until_blocked('rt_dl_b_338'),
  'the reopen has taken the Umbrella lock and is now waiting for the Subtask row session A holds -- the first half of the cycle');

-- The assertion this whole section exists for.
select lives_ok(format($outer$ select extensions.dblink_exec('rt_dl_a', %L) $outer$,
  format($$
    insert into public.task_activity (task_id, kind, actor_id, from_status, to_status, details)
    values (%s, 'subtask_completed', '33800000-0000-0000-0000-000000000051', null, null,
            jsonb_build_object('probe', '338 deadlock'))
  $$, (select probe_umbrella_id from r338))),
  'evaluate_task''s parent-naming insert -- an implicit FK FOR KEY SHARE on the Umbrella -- goes straight through while a reopen holds that Umbrella: FOR NO KEY UPDATE does not conflict with FOR KEY SHARE, and FOR UPDATE would deadlock (40P01) here');

select extensions.dblink_exec('rt_dl_a', 'rollback');
select is(pg_temp.dl_reopen_result(), 'in_progress',
  'and the reopen itself comes back with a status, never a 40P01 -- once A lets the Subtask go it finishes normally, so the weaker parent lock costs this command nothing');
select extensions.dblink_exec('rt_dl_b', 'rollback');
select extensions.dblink_disconnect('rt_dl_a');
select extensions.dblink_disconnect('rt_dl_b');

-- ==================== 14. The committed fixtures leave no trace ====================
select extensions.dblink_exec('rt_setup', $$
  set session_replication_role = 'replica';
  delete from public.points_ledger
   where task_id in (select id from public.tasks where title like '%#338 committed%');
  delete from public.task_evaluations
   where task_id in (select id from public.tasks where title like '%#338 committed%');
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#338 committed%');
  set session_replication_role = 'origin';
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#338 committed%')
      or member_id in ('33800000-0000-0000-0000-000000000051',
                       '33800000-0000-0000-0000-000000000052',
                       '33800000-0000-0000-0000-000000000053',
                       '33800000-0000-0000-0000-000000000054');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%#338 committed%');
  delete from public.tasks
   where parent_task_id in (select id from public.tasks where title like '%#338 committed%');
  delete from public.tasks where title like '%#338 committed%';
  delete from public.member_departments where member_id in (
    '33800000-0000-0000-0000-000000000051', '33800000-0000-0000-0000-000000000052',
    '33800000-0000-0000-0000-000000000053', '33800000-0000-0000-0000-000000000054');
  delete from auth.users where id in (
    '33800000-0000-0000-0000-000000000051', '33800000-0000-0000-0000-000000000052',
    '33800000-0000-0000-0000-000000000053', '33800000-0000-0000-0000-000000000054');
$$);
select extensions.dblink_disconnect('rt_setup');

select is((select count(*) from public.tasks where title like '%#338 committed%'), 0::bigint,
  'the committed lock-probe and race fixtures are removed again -- this suite leaves no trace');
select is((select count(*) from public.points_ledger
            where member_id in ('33800000-0000-0000-0000-000000000053',
                                '33800000-0000-0000-0000-000000000054')), 0::bigint,
  'including every point the probe and the race actually moved');


-- #521: Group authority regression matrix.
\ir _group_task_fixtures.psql
reset role;
select pg_temp.g521_task('command0','project',5,'completed','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($$select public.reopen_task((select id from g521_tasks where name='command0'),'Reopen #521')$$,'reopen_task: Group persona 2 on executor 5 in project');
reset role;
select pg_temp.g521_task('command1','project',4,'completed','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select throws_ok($$select public.reopen_task((select id from g521_tasks where name='command1'),'Reopen #521')$$,'42501','task_evaluate_forbidden','reopen_task: Group persona 3 on executor 4 in project');
reset role;
select pg_temp.g521_task('command2','ind',7,'completed','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(6));
select throws_ok($$select public.reopen_task((select id from g521_tasks where name='command2'),'Reopen #521')$$,'42501','task_evaluate_forbidden','reopen_task: Group persona 6 on executor 7 in ind');
reset role;
select pg_temp.g521_task('command3','dt',5,'completed','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(8));
select throws_ok($$select public.reopen_task((select id from g521_tasks where name='command3'),'Reopen #521')$$,'42501','task_evaluate_forbidden','reopen_task: Group persona 8 on executor 5 in dt');
reset role;
select pg_temp.g521_task('command4','project',5,'completed','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select lives_ok($$select public.reopen_task((select id from g521_tasks where name='command4'),'Reopen #521')$$,'reopen_task: Group persona 3 on executor 5 in project');
reset role;
select pg_temp.g521_task('command5','project',3,'completed','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select throws_ok($$select public.reopen_task((select id from g521_tasks where name='command5'),'Reopen #521')$$,'42501','task_evaluate_forbidden','reopen_task: Group persona 3 on executor 3 in project');
reset role;
select pg_temp.g521_task('command6','project',2,'completed','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select throws_ok($$select public.reopen_task((select id from g521_tasks where name='command6'),'Reopen #521')$$,'42501','task_evaluate_forbidden','reopen_task: Group persona 3 on executor 2 in project');
reset role;
select pg_temp.g521_task('command7','project',2,'completed','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($$select public.reopen_task((select id from g521_tasks where name='command7'),'Reopen #521')$$,'reopen_task: Group persona 2 on executor 2 in project');
reset role;
select pg_temp.g521_task('command8','ind',7,'completed','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select lives_ok($$select public.reopen_task((select id from g521_tasks where name='command8'),'Reopen #521')$$,'reopen_task: Group persona 1 on executor 7 in ind');
reset role;

-- #524: the evaluate-authority refinement at step 7 now reads Groups, not the
-- legacy Origin (wave-review M2). Two behavioural rows for the rule as the
-- Group model states it -- a Project's Coordonator is a Group Manager at
-- whatever rank, an ordinary Project member is nobody -- and one catalog row
-- for what actually changed. The catalog row is the load-bearing one: under
-- the Wave 2 gate at step 4 the legacy shape and the Group shape agree on
-- every input a caller can reach (the Executor can_evaluate_task judges IS
-- the Assignment this command reverses), so only the catalog tells a reader
-- whether the decision still depends on a table Wave 3 drops.
select pg_temp.g521_task('command9','project',3,'completed','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($$select public.reopen_task((select id from g521_tasks where name='command9'),'Reopen #524')$$,'reopen_task: a Project Coordonator -- Group Manager at level 1 -- reverses a Responsible''s award');
reset role;
select pg_temp.g521_task('command10','project',5,'completed','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(5));
select throws_ok($$select public.reopen_task((select id from g521_tasks where name='command10'),'Reopen #524')$$,'42501','task_evaluate_forbidden','reopen_task: an ordinary Project member cannot reopen, not even their own Task');
reset role;
select ok((select pg_get_functiondef('private.reopen_task_impl(bigint,text)'::regprocedure)) !~ 'is_project_lead|public\.projects|project_id',
  'reopen_task''s body reads no legacy Origin: its evaluate-authority refinement is decided by the Group predicates alone');

select * from finish();
rollback;
