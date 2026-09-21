-- #337: public.mark_task_unfulfilled, the second command over the shared
-- private.evaluate_task core (#336) -- the `unfulfilled` outcome, for work
-- that went past its deadline undelivered. This suite pins the command's own
-- gate/authority/state rules; the core's own effects (Evaluation shape,
-- ledger row, Queue close ordering, the reversed-evaluation guard) are
-- already pinned by complete_task_review.test.sql and are not re-proven
-- here beyond what distinguishes this outcome (the negative/zero award, the
-- `failed` end_reason, `unfulfilled_at`, and the "Task nerealizat" copy).
--
-- Fixture prefix 33700000-0000-0000-0000-0000000000NN throughout, resolved
-- as the owner into a temp table before any persona logs in (the #328 trap,
-- stack-context.md carry-forwards). The committed lock-probe fixtures use
-- 33700000-...-0000000000[5-9]N and carry '#337 committed' in their titles.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(89);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('33700000-0000-0000-0000-000000000001', 'bc.337@test.local'),
  ('33700000-0000-0000-0000-000000000002', 'bce.edu.337@test.local'),
  ('33700000-0000-0000-0000-000000000003', 'bce.pr.337@test.local'),
  ('33700000-0000-0000-0000-000000000004', 'exec.happy.337@test.local'),
  ('33700000-0000-0000-0000-000000000005', 'exec.dt.337@test.local'),
  ('33700000-0000-0000-0000-000000000006', 'proj.lead.337@test.local'),
  ('33700000-0000-0000-0000-000000000007', 'proj.responsible.337@test.local'),
  ('33700000-0000-0000-0000-000000000008', 'proj.member.337@test.local'),
  ('33700000-0000-0000-0000-000000000009', 'ind.team.337@test.local'),
  ('33700000-0000-0000-0000-000000000010', 'inactive.bc.337@test.local'),
  ('33700000-0000-0000-0000-000000000011', 'claimless.337@test.local'),
  ('33700000-0000-0000-0000-000000000012', 'exec.direct.337@test.local'),
  ('33700000-0000-0000-0000-000000000013', 'candidate.a.337@test.local'),
  ('33700000-0000-0000-0000-000000000014', 'candidate.b.337@test.local'),
  ('33700000-0000-0000-0000-000000000015', 'exec.notoverdue.337@test.local'),
  ('33700000-0000-0000-0000-000000000016', 'exec.gate.337@test.local'),
  ('33700000-0000-0000-0000-000000000017', 'exec.directwrite.337@test.local'),
  ('33700000-0000-0000-0000-000000000018', 'exec.inputs.337@test.local'),
  ('33700000-0000-0000-0000-000000000019', 'exec.nulldeadline.337@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('33700000-0000-0000-0000-000000000001', 'BC 337', 'bc.337@test.local', 'bc', 'activ'),
  ('33700000-0000-0000-0000-000000000002', 'BCE EDU 337', 'bce.edu.337@test.local', 'bce', 'activ'),
  ('33700000-0000-0000-0000-000000000003', 'BCE PR 337', 'bce.pr.337@test.local', 'bce', 'activ'),
  ('33700000-0000-0000-0000-000000000004', 'Executor Fericit 337', 'exec.happy.337@test.local', 'voluntar', 'activ'),
  ('33700000-0000-0000-0000-000000000005', 'Executor Echipa 337', 'exec.dt.337@test.local', 'voluntar', 'activ'),
  ('33700000-0000-0000-0000-000000000006', 'Lead Proiect 337', 'proj.lead.337@test.local', 'voluntar', 'activ'),
  ('33700000-0000-0000-0000-000000000007', 'Responsabil Proiect 337', 'proj.responsible.337@test.local', 'voluntar', 'activ'),
  ('33700000-0000-0000-0000-000000000008', 'Membru Proiect 337', 'proj.member.337@test.local', 'voluntar', 'activ'),
  ('33700000-0000-0000-0000-000000000009', 'Membru Echipa Independenta 337', 'ind.team.337@test.local', 'voluntar', 'activ'),
  ('33700000-0000-0000-0000-000000000010', 'BC Inactiv 337', 'inactive.bc.337@test.local', 'bc', 'inactiv'),
  ('33700000-0000-0000-0000-000000000011', 'Fara Claimuri 337', 'claimless.337@test.local', 'voluntar', 'activ'),
  ('33700000-0000-0000-0000-000000000012', 'Executor Direct 337', 'exec.direct.337@test.local', 'voluntar', 'activ'),
  ('33700000-0000-0000-0000-000000000013', 'Candidat A 337', 'candidate.a.337@test.local', 'voluntar', 'activ'),
  ('33700000-0000-0000-0000-000000000014', 'Candidat B 337', 'candidate.b.337@test.local', 'voluntar', 'activ'),
  ('33700000-0000-0000-0000-000000000015', 'Executor Neintarziat 337', 'exec.notoverdue.337@test.local', 'voluntar', 'activ'),
  ('33700000-0000-0000-0000-000000000016', 'Executor Poarta 337', 'exec.gate.337@test.local', 'voluntar', 'activ'),
  ('33700000-0000-0000-0000-000000000017', 'Executor Scriere 337', 'exec.directwrite.337@test.local', 'voluntar', 'activ'),
  ('33700000-0000-0000-0000-000000000018', 'Executor Intrari 337', 'exec.inputs.337@test.local', 'voluntar', 'activ'),
  ('33700000-0000-0000-0000-000000000019', 'Executor Fara Termen 337', 'exec.nulldeadline.337@test.local', 'voluntar', 'activ');

insert into public.member_departments (member_id, dept_id) values
  ('33700000-0000-0000-0000-000000000002', 'edu'),
  ('33700000-0000-0000-0000-000000000003', 'pr'),
  ('33700000-0000-0000-0000-000000000004', 'edu'),
  ('33700000-0000-0000-0000-000000000005', 'edu'),
  ('33700000-0000-0000-0000-000000000011', 'edu'),
  ('33700000-0000-0000-0000-000000000012', 'edu'),
  ('33700000-0000-0000-0000-000000000013', 'edu'),
  ('33700000-0000-0000-0000-000000000014', 'edu'),
  ('33700000-0000-0000-0000-000000000015', 'edu'),
  ('33700000-0000-0000-0000-000000000016', 'edu'),
  ('33700000-0000-0000-0000-000000000017', 'edu'),
  ('33700000-0000-0000-0000-000000000018', 'edu'),
  ('33700000-0000-0000-0000-000000000019', 'edu');

insert into public.teams (id, name, dept_id) values
  ('t-337-ind', 'Echipa Independenta 337', null),
  ('t-337-dt', 'Echipa Departamentala 337', 'edu');

insert into public.team_members (team_id, member_id) values
  ('t-337-ind', '33700000-0000-0000-0000-000000000009');

insert into public.projects (name, status, leader_id, created_by) values
  ('Proiect #337', 'active',
   '33700000-0000-0000-0000-000000000006', '33700000-0000-0000-0000-000000000001');

insert into public.project_members (project_id, member_id, project_role) values
  ((select id from public.projects where name = 'Proiect #337'),
   '33700000-0000-0000-0000-000000000007', 'responsible'),
  ((select id from public.projects where name = 'Proiect #337'),
   '33700000-0000-0000-0000-000000000008', 'member');

-- ---- T1: the happy path. A PUBLIC, OVERDUE Department Task in_progress,
-- with a live Executor and two pending Candidates. Difficulty 4 x
-- rating_mult(1) = -4, the brief's negative case.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, queue_opened_at, started_at, created_by)
values
  ('Nerealizat fericit #337', 'Peste termen, netrimis', now() - interval '2 days', 'edu', 'org', 'public', 'in_progress',
   now() - interval '10 days', now() - interval '10 days', now() - interval '9 days',
   '33700000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33700000-0000-0000-0000-000000000004', '33700000-0000-0000-0000-000000000002',
       now() - interval '9 days'
  from public.tasks where title = 'Nerealizat fericit #337';
insert into public.task_candidates (task_id, member_id, status, joined_at)
select id, '33700000-0000-0000-0000-000000000013'::uuid, 'pending', now() - interval '8 days'
  from public.tasks where title = 'Nerealizat fericit #337'
union all
select id, '33700000-0000-0000-0000-000000000014'::uuid, 'pending', now() - interval '7 days'
  from public.tasks where title = 'Nerealizat fericit #337';

-- ---- T2: a DIRECT, OVERDUE Task in_progress. Difficulty 3 x
-- rating_mult(2) = 0, the brief's zero case.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, created_by)
values
  ('Nerealizat zero #337', 'Peste termen, calificativ neutru', now() - interval '1 day', 'edu', 'local', 'direct', 'in_progress',
   now() - interval '5 days', now() - interval '4 days',
   '33700000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33700000-0000-0000-0000-000000000012', '33700000-0000-0000-0000-000000000002',
       now() - interval '4 days'
  from public.tasks where title = 'Nerealizat zero #337';

-- ---- T3: NOT YET overdue -- deadline still in the future.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, created_by)
values
  ('Neintarziat inca #337', 'Termenul nu a trecut', now() + interval '5 days', 'edu', 'local', 'direct', 'in_progress',
   now() - interval '2 days', now() - interval '1 day',
   '33700000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33700000-0000-0000-0000-000000000015', '33700000-0000-0000-0000-000000000002', now() - interval '1 day'
  from public.tasks where title = 'Neintarziat inca #337';

-- ---- T4: OVERDUE with NO active Assignment -- nobody to blame.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, queue_opened_at, created_by)
values
  ('Fara executant #337', 'Nimeni nu l-a preluat', now() - interval '3 days', 'edu', 'org', 'public',
   'todo', now() - interval '10 days', now() - interval '10 days', '33700000-0000-0000-0000-000000000002');

-- ---- T4b: an ORDINARY Task (kind = 'task', the default) with a NULL
-- deadline -- the null-deadline branch of task_not_overdue
-- (`deadline is null or deadline >= now()`) is only reachable through an
-- ordinary Task, since T5's Umbrella below is intercepted by task_is_umbrella
-- first. Non-terminal, with a live Executor, so the deadline check is the
-- only thing standing between this Task and evaluate_task.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, created_by)
values
  ('Fara termen #337', 'Task obisnuit fara termen limita', null, 'edu', 'local', 'direct', 'in_progress',
   now() - interval '5 days', now() - interval '4 days',
   '33700000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33700000-0000-0000-0000-000000000019', '33700000-0000-0000-0000-000000000002', now() - interval '4 days'
  from public.tasks where title = 'Fara termen #337';

-- ---- T5: an Umbrella (kind check fires before anything else).
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode,
   difficulty, rating, kind, status, created_at, created_by)
values
  ('Umbrela #337', 'Grup de subtaskuri', null, 'edu', null, null,
   null, null, 'umbrella', 'todo', now() - interval '6 days',
   '33700000-0000-0000-0000-000000000002');

-- ---- T6: already TERMINAL (cancelled) -- checked before the deadline.
-- #339: tasks_cancel_reason_ck makes cancel_reason mandatory on -- and
-- exclusive to -- a cancelled Task, so this fixture states why it was called
-- off. Nothing else about the fixture changes.
insert into public.tasks (title, description, deadline, dept_id, audience, assignment_mode, status, created_at, cancelled_at, cancel_reason, created_by)
values ('Deja anulat #337', 'Anulat deja', now() - interval '3 days', 'edu', 'local', 'direct', 'cancelled',
        now() - interval '5 days', now() - interval '1 day', 'Anulat inainte de termen #337',
        '33700000-0000-0000-0000-000000000002');

-- ---- T7: input-validation target. Every PT400 below fires against it and
-- must leave it exactly as it is.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, created_by)
values
  ('Validare intrari #337', 'Tinta PT400', now() - interval '2 days', 'edu', 'local', 'direct', 'in_progress',
   now() - interval '5 days', now() - interval '4 days',
   '33700000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33700000-0000-0000-0000-000000000018', '33700000-0000-0000-0000-000000000002', now() - interval '4 days'
  from public.tasks where title = 'Validare intrari #337';

-- ---- T8: shared denial target. None of the denied personas mutate it.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, created_by)
values
  ('Poarta comuna #337', 'Tinta refuzurilor', now() - interval '2 days', 'edu', 'local', 'direct', 'in_progress',
   now() - interval '5 days', now() - interval '4 days',
   '33700000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33700000-0000-0000-0000-000000000016', '33700000-0000-0000-0000-000000000002', now() - interval '4 days'
  from public.tasks where title = 'Poarta comuna #337';

-- ---- T9: direct-write-denial target.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status,
   created_at, started_at, created_by)
values
  ('Scriere directa #337', 'Tinta interzisa', now() - interval '2 days', 'edu', 'local', 'direct', 'in_progress',
   now() - interval '5 days', now() - interval '4 days',
   '33700000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33700000-0000-0000-0000-000000000017', '33700000-0000-0000-0000-000000000002', now() - interval '4 days'
  from public.tasks where title = 'Scriere directa #337';

-- ---- T10: a DEPARTMENT-TEAM Task -- the local BCE of the Team's parent
-- Department evaluates it (a distinct can_evaluate_task branch).
insert into public.tasks
  (title, description, deadline, team_id, audience, assignment_mode, status,
   created_at, started_at, created_by)
values
  ('Echipa departamentala #337', 'Munca echipei', now() - interval '2 days', 't-337-dt', 'local', 'direct', 'in_progress',
   now() - interval '5 days', now() - interval '4 days',
   '33700000-0000-0000-0000-000000000002');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33700000-0000-0000-0000-000000000005', '33700000-0000-0000-0000-000000000002', now() - interval '4 days'
  from public.tasks where title = 'Echipa departamentala #337';

-- ---- T11: an INDEPENDENT-TEAM Task executed by one of its own members.
insert into public.tasks
  (title, description, deadline, team_id, audience, assignment_mode, status,
   created_at, started_at, created_by)
values
  ('Echipa independenta #337', 'Munca echipei independente', now() - interval '2 days', 't-337-ind', 'local', 'direct', 'in_progress',
   now() - interval '5 days', now() - interval '4 days',
   '33700000-0000-0000-0000-000000000001');
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '33700000-0000-0000-0000-000000000009', '33700000-0000-0000-0000-000000000001', now() - interval '4 days'
  from public.tasks where title = 'Echipa independenta #337';

-- ---- T12/T13: Project Tasks executed by the lead and by the Responsible.
insert into public.tasks
  (title, description, deadline, project_id, audience, assignment_mode, status,
   created_at, started_at, created_by)
select 'Proiect lead executant #337', 'Lead isi evalueaza munca', now() - interval '2 days',
       project.id, 'local', 'direct', 'in_progress',
       now() - interval '5 days', now() - interval '4 days',
       '33700000-0000-0000-0000-000000000001'
  from public.projects as project where project.name = 'Proiect #337';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select task.id, '33700000-0000-0000-0000-000000000006', '33700000-0000-0000-0000-000000000001', now() - interval '4 days'
  from public.tasks as task where task.title = 'Proiect lead executant #337';

insert into public.tasks
  (title, description, deadline, project_id, audience, assignment_mode, status,
   created_at, started_at, created_by)
select 'Proiect responsabil executant #337', 'Responsabilul isi evalueaza munca', now() - interval '2 days',
       project.id, 'local', 'direct', 'in_progress',
       now() - interval '5 days', now() - interval '4 days',
       '33700000-0000-0000-0000-000000000001'
  from public.projects as project where project.name = 'Proiect #337';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select task.id, '33700000-0000-0000-0000-000000000007', '33700000-0000-0000-0000-000000000001', now() - interval '4 days'
  from public.tasks as task where task.title = 'Proiect responsabil executant #337';

-- Every fixture id resolved ONCE, as the owner.
create temp table f337 as
select
  9223372036854775807::bigint as missing_id,
  (select id from public.tasks where title = 'Nerealizat fericit #337') as happy_task_id,
  (select id from public.tasks where title = 'Nerealizat zero #337') as zero_task_id,
  (select id from public.tasks where title = 'Neintarziat inca #337') as not_overdue_task_id,
  (select id from public.tasks where title = 'Fara executant #337') as no_executor_task_id,
  (select id from public.tasks where title = 'Fara termen #337') as null_deadline_task_id,
  (select id from public.tasks where title = 'Umbrela #337') as umbrella_id,
  (select id from public.tasks where title = 'Deja anulat #337') as cancelled_task_id,
  (select id from public.tasks where title = 'Validare intrari #337') as inputs_task_id,
  (select id from public.tasks where title = 'Poarta comuna #337') as gate_task_id,
  (select id from public.tasks where title = 'Scriere directa #337') as direct_write_task_id,
  (select id from public.tasks where title = 'Echipa departamentala #337') as dt_task_id,
  (select id from public.tasks where title = 'Echipa independenta #337') as ind_task_id,
  (select id from public.tasks where title = 'Proiect lead executant #337') as proj_lead_task_id,
  (select id from public.tasks where title = 'Proiect responsabil executant #337') as proj_resp_task_id,
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'Nerealizat fericit #337' and assignment.ended_at is null) as happy_assignment_id,
  (select assignment.id from public.task_assignments as assignment
     join public.tasks as task on task.id = assignment.task_id
    where task.title = 'Scriere directa #337' and assignment.ended_at is null) as direct_write_assignment_id;
grant select on f337 to authenticated, anon;

-- ==================== 1. API shape and privileges ====================

select has_function('public', 'mark_task_unfulfilled', array['bigint', 'integer', 'integer', 'text'],
  'public.mark_task_unfulfilled exists with the pinned four-parameter signature');
select is(pg_get_function_identity_arguments(
    'public.mark_task_unfulfilled(bigint, integer, integer, text)'::regprocedure),
  'p_task_id bigint, p_difficulty integer, p_rating integer, p_note text',
  'mark_task_unfulfilled exposes no actor parameter -- the actor is always auth.uid()');
select is(pg_get_function_result(
    'public.mark_task_unfulfilled(bigint, integer, integer, text)'::regprocedure),
  'tasks', 'mark_task_unfulfilled returns the affected Task row');
select ok(not (select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public' and procedure.proname = 'mark_task_unfulfilled'),
  'the public command is a security invoker wrapper');
select ok((select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private' and procedure.proname = 'mark_task_unfulfilled_impl'),
  'private.mark_task_unfulfilled_impl runs as owner (security definer)');
select ok(coalesce((
    select 'search_path=""' = any(procedure.proconfig)
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private' and procedure.proname = 'mark_task_unfulfilled_impl'
  ), false), 'the new private function pins an empty search_path');
select ok(has_function_privilege('authenticated',
  'public.mark_task_unfulfilled(bigint, integer, integer, text)'::regprocedure, 'execute'),
  'authenticated can execute public.mark_task_unfulfilled');
select ok(not has_function_privilege('anon',
  'public.mark_task_unfulfilled(bigint, integer, integer, text)'::regprocedure, 'execute'),
  'anon cannot execute public.mark_task_unfulfilled');
select ok(has_function_privilege('authenticated',
  'private.mark_task_unfulfilled_impl(bigint, integer, integer, text)'::regprocedure, 'execute'),
  'authenticated can execute private.mark_task_unfulfilled_impl');
select ok(not has_function_privilege('anon',
  'private.mark_task_unfulfilled_impl(bigint, integer, integer, text)'::regprocedure, 'execute'),
  'anon cannot execute private.mark_task_unfulfilled_impl');

-- ==================== 2. Happy path A: negative award, public queue ====================
-- Difficulty 4 x rating_mult(1) = -4 (the brief's negative case).

select pg_temp.test_login('33700000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.mark_task_unfulfilled(%s, 4, 1, '  Nu a fost predat  ') $$,
  (select happy_task_id from f337)),
  'BC/Moderator may mark any overdue, undelivered in_progress Task unfulfilled');
reset role;

select is((select format('%s|%s|%s|%s|%s', task.status, (task.unfulfilled_at is not null)::text,
                         task.difficulty, task.rating, (task.queue_closed_at is not null)::text)
             from public.tasks as task where task.id = (select happy_task_id from f337)),
  'unfulfilled|true|4|1|true',
  'the Task is unfulfilled with its Difficulty, Rating, unfulfilled_at and -- because it is public -- a closed queue');
select is((select format('%s|%s|%s|%s|%s', evaluation.source, evaluation.outcome,
                         evaluation.difficulty, evaluation.rating, evaluation.points)
             from public.task_evaluations as evaluation
            where evaluation.task_id = (select happy_task_id from f337)),
  'command|unfulfilled|4|1|-4',
  'points = Difficulty x rating_mult(Rating) = 4 x -1 = -4, written exactly as computed');
select is((select ledger.delta from public.points_ledger as ledger
            where ledger.task_id = (select happy_task_id from f337)),
  -4, 'the ledger credits the Executor exactly rating 1''s delta = -difficulty');
select is((select format('%s|%s', assignment.end_reason,
                         (assignment.ended_at = (select task.unfulfilled_at from public.tasks as task
                                                  where task.id = (select happy_task_id from f337)))::text)
             from public.task_assignments as assignment
            where assignment.id = (select happy_assignment_id from f337)),
  'failed|true',
  'the Assignment is ended ''failed'' at exactly the Task''s unfulfilled_at (both now(), conventions Sec7)');
select set_eq(
  format($$ select format('%%s|%%s|%%s', candidate.member_id, candidate.status,
                          (candidate.decided_by is null)::text)
              from public.task_candidates as candidate where candidate.task_id = %s $$,
    (select happy_task_id from f337)),
  $$ values ('33700000-0000-0000-0000-000000000013|closed|true'),
            ('33700000-0000-0000-0000-000000000014|closed|true') $$,
  'both pending Candidatures are closed automatically -- decided_by null marks a close nobody chose');
select is((select format('%s|%s|%s|%s|%s|%s', activity.kind, activity.actor_id,
                         (activity.assignment_id = (select happy_assignment_id from f337))::text,
                         activity.from_status, activity.to_status, activity.note)
             from public.task_activity as activity
            where activity.task_id = (select happy_task_id from f337)),
  'unfulfilled|33700000-0000-0000-0000-000000000001|true|in_progress|unfulfilled|Nu a fost predat',
  'one unfulfilled activity row names the evaluator, carries the Assignment id, the in_progress -> unfulfilled transition and the trimmed note');
select is((select count(*) from public.task_activity
            where task_id = (select happy_task_id from f337)), 1::bigint,
  'exactly one activity row -- closing the queue as a side effect logs nothing of its own');
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s $$, (select happy_task_id from f337)),
  $$ values ('33700000-0000-0000-0000-000000000004'::uuid),
            ('33700000-0000-0000-0000-000000000013'::uuid),
            ('33700000-0000-0000-0000-000000000014'::uuid) $$,
  'exactly the Executor and the two closed Candidates are notified -- the BC evaluator hears nothing about their own action');
select is((select format('%s|%s', notification.title, notification.body)
             from public.notifications as notification
            where notification.task_id = (select happy_task_id from f337)
              and notification.member_id = '33700000-0000-0000-0000-000000000004'),
  'Task nerealizat: Nerealizat fericit #337|-4 puncte (dificultate 4, calificativ 1).',
  'the Executor gets the pinned "Task nerealizat" copy naming the (negative) points, Difficulty and Rating');
select is((select format('%s|%s', notification.title, notification.body)
             from public.notifications as notification
            where notification.task_id = (select happy_task_id from f337)
              and notification.member_id = '33700000-0000-0000-0000-000000000013'),
  'Coadă închisă: Nerealizat fericit #337|Nu mai poți fi selectat pentru acest task.',
  'each closed Candidate gets the pinned "Coadă închisă" copy');

-- Resolved as the owner for the direct-write denial in section 9.
create temp table e337 as
select (select evaluation.id from public.task_evaluations as evaluation
         where evaluation.task_id = (select happy_task_id from f337)) as happy_evaluation_id;
grant select on e337 to authenticated;

-- The Task is now terminal AND its queue is closed, which together take a
-- plain outsider's visibility away (private.can_read_task's R6 requires an
-- open queue on a live Task). The already-closed Candidate can still read
-- it via R2 (own Candidature, any status) -- reusing that persona to reach
-- the state check itself: express_task_interest_impl checks task_terminal
-- before task_queue_closed and before already_candidate, so the pinned
-- state conflict is what surfaces, not either of those.
select pg_temp.test_login('33700000-0000-0000-0000-000000000013', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.express_task_interest(%s) $$,
  (select happy_task_id from f337)),
  'PT409', 'task_terminal',
  'once a public Task is marked unfulfilled, joining its (already-closed) queue answers task_terminal, not task_queue_closed or already_candidate');
reset role;

-- ==================== 3. Happy path B: a zero award, direct Task ====================
-- Difficulty 3 x rating_mult(2) = 0 (the brief's zero case).

select pg_temp.test_login('33700000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 2, 'Nici bine, nici rau, dar netrimis') $$,
  (select zero_task_id from f337)),
  'the local BCE of the Task''s own Department may mark its overdue work unfulfilled too');
reset role;
select is((select evaluation.points from public.task_evaluations as evaluation
            where evaluation.task_id = (select zero_task_id from f337)),
  0, 'rating 2''s multiplier is zero, so Difficulty 3 x 0 = 0 -- written, never skipped');
select is((select ledger.delta from public.points_ledger as ledger
            where ledger.task_id = (select zero_task_id from f337)),
  0, 'the ledger records the zero delta exactly as computed');
select is((select task.status::text from public.tasks as task
            where task.id = (select zero_task_id from f337)),
  'unfulfilled', 'a zero award still marks the Task unfulfilled -- outcome and points are independent (ADR-0007)');
select is((select count(*) from public.notifications
            where task_id = (select zero_task_id from f337)), 1::bigint,
  'a direct Task closes no queue, so only the Executor is notified');
select is((select format('%s|%s', notification.title, notification.body)
             from public.notifications as notification
            where notification.task_id = (select zero_task_id from f337)),
  'Task nerealizat: Nerealizat zero #337|0 puncte (dificultate 3, calificativ 2).',
  'the zero-points case is pinned by content, not just count: "puncte" (plural) for a zero award, never "punct"');

-- ==================== 4. State preconditions ====================

select pg_temp.test_login('33700000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 3, 'Nota') $$,
  (select umbrella_id from f337)),
  'PT409', 'task_is_umbrella',
  'an Umbrella answers its own reason, checked first -- its completion is a Subtask rollup, never an Evaluation');
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 3, 'Nota') $$,
  (select cancelled_task_id from f337)),
  'PT409', 'task_terminal',
  'an already-cancelled Task cannot be marked unfulfilled again -- checked before its deadline');
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 3, 'Nota') $$,
  (select not_overdue_task_id from f337)),
  'PT409', 'task_not_overdue',
  'a Task whose deadline has not yet passed cannot be marked unfulfilled');
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 3, 'Nota') $$,
  (select no_executor_task_id from f337)),
  'PT409', 'task_has_no_executor',
  'a queued public Task nobody ever took cannot be "unfulfilled" by a person -- the manager cancels it instead');
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 3, 'Nota') $$,
  (select null_deadline_task_id from f337)),
  'PT409', 'task_not_overdue',
  'an ordinary Task with a NULL deadline is refused by the same task_not_overdue guard, not silently let through -- the null-deadline branch task_is_umbrella''s Task-5 fixture cannot reach');
reset role;

select is((select count(*) from public.task_evaluations
            where task_id in (select umbrella_id from f337)
               or task_id in (select cancelled_task_id from f337)
               or task_id in (select not_overdue_task_id from f337)
               or task_id in (select no_executor_task_id from f337)
               or task_id in (select null_deadline_task_id from f337)), 0::bigint,
  'none of the state-rejected calls wrote an Evaluation');

-- ==================== 5. Input validation ====================

select pg_temp.test_login('33700000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 3, null) $$,
  (select inputs_task_id from f337)),
  'PT400', 'evaluation_note_required', 'a null note is rejected');
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 3, '   ') $$,
  (select inputs_task_id from f337)),
  'PT400', 'evaluation_note_required', 'a whitespace-only note is rejected');
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 3, E'\t\t') $$,
  (select inputs_task_id from f337)),
  'PT400', 'evaluation_note_required', 'a tab-only note is rejected -- regexp_replace catches what btrim would not');
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, null, 3, 'Nota') $$,
  (select inputs_task_id from f337)),
  'PT400', 'invalid_difficulty', 'a null Difficulty is rejected');
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 0, 3, 'Nota') $$,
  (select inputs_task_id from f337)),
  'PT400', 'invalid_difficulty', 'Difficulty 0 is below the guide''s range');
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 6, 3, 'Nota') $$,
  (select inputs_task_id from f337)),
  'PT400', 'invalid_difficulty', 'Difficulty 6 is above the guide''s range');
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, null, 'Nota') $$,
  (select inputs_task_id from f337)),
  'PT400', 'invalid_rating', 'a null Rating is rejected');
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 0, 'Nota') $$,
  (select inputs_task_id from f337)),
  'PT400', 'invalid_rating', 'Rating 0 is below the guide''s range');
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 6, 'Nota') $$,
  (select inputs_task_id from f337)),
  'PT400', 'invalid_rating', 'Rating 6 is above the guide''s range');
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 3, '') $$,
  (select missing_id from f337)),
  'PT400', 'evaluation_note_required',
  'the note check runs before the target is even looked up -- an unknown id with a blank note is still PT400, never PT404');
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 3, 'Nota valida') $$,
  (select missing_id from f337)),
  'PT404', 'task_not_found', 'an unknown Task id is not found once the note is valid');
reset role;

select pg_temp.test_login('33700000-0000-0000-0000-000000000011',
  jsonb_build_object('provider', 'email'));
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 3, '  ') $$,
  (select gate_task_id from f337)),
  'PT400', 'evaluation_note_required',
  'the note check runs before the gate too -- a claimless caller with a blank note gets PT400, not 42501');
-- Whole-wave review, finding 5: the two numeric inputs were hoisted to step 1
-- beside the note, so that all three callers of private.evaluate_task answer a
-- malformed Difficulty or Rating identically. Both are asserted: with only one
-- of them pinned the other could be pushed back below the gate unnoticed.
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 9, 3, 'Nota valida') $$,
  (select gate_task_id from f337)),
  'PT400', 'invalid_difficulty',
  'and so does the Difficulty range check -- a claimless caller with Difficulty 9 gets PT400, not 42501 (finding 5: this is what approve_completed_work_request already did)');
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 9, 'Nota valida') $$,
  (select gate_task_id from f337)),
  'PT400', 'invalid_rating',
  'and the Rating range check with it -- a claimless caller with Rating 9 gets PT400, not 42501');
reset role;

select is((select format('%s|%s|%s', task.status, task.difficulty, task.rating)
             from public.tasks as task where task.id = (select inputs_task_id from f337)),
  'in_progress||',
  'every rejected call left the target Task exactly as it was');
select is((select count(*) from public.task_evaluations
            where task_id = (select inputs_task_id from f337))
        + (select count(*) from public.points_ledger
            where task_id = (select inputs_task_id from f337))
        + (select count(*) from public.task_activity
            where task_id = (select inputs_task_id from f337))
        + (select count(*) from public.notifications
            where task_id = (select inputs_task_id from f337)), 0::bigint,
  'and wrote no Evaluation, no ledger entry, no activity row and no notification');

-- ==================== 6. The persona matrix -- denied ====================

select pg_temp.test_login('33700000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 2, 'Incercare respinsa') $$,
  (select proj_lead_task_id from f337)),
  '42501', 'task_evaluate_forbidden', 'a Project Responsible may not evaluate the lead''s own work');
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 2, 'Incercare respinsa') $$,
  (select proj_resp_task_id from f337)),
  '42501', 'task_evaluate_forbidden', 'a Project Responsible may not evaluate their own work either');
reset role;

select pg_temp.test_login('33700000-0000-0000-0000-000000000009', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb,
  'team_ids', '["t-337-ind"]'::jsonb));
select is((select private.can_manage_task((select ind_task_id from f337))), true,
  'an Independent-Team member DOES manage their own Team''s Task');
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 2, 'Incercare respinsa') $$,
  (select ind_task_id from f337)),
  '42501', 'task_evaluate_forbidden',
  'but the same member may NOT award its points -- an Independent Team has no evaluator branch at all');
reset role;

select pg_temp.test_login('33700000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["pr"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 2, 'Incercare respinsa') $$,
  (select gate_task_id from f337)),
  '42501', 'task_evaluate_forbidden', 'a BCE of a DIFFERENT Department does not evaluate an EDU Task');
reset role;

select pg_temp.test_login('33700000-0000-0000-0000-000000000016', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 2, 'Imi dau singur puncte') $$,
  (select gate_task_id from f337)),
  '42501', 'task_evaluate_forbidden', 'the active Executor cannot evaluate their own overdue, undelivered work');
reset role;

select pg_temp.test_login('33700000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 2, 'Incercare respinsa') $$,
  (select proj_resp_task_id from f337)),
  'PT404', 'task_not_found',
  'a plain Project member evaluates nothing on their Project -- the non-disclosing PT404, never a 42501');
reset role;

select pg_temp.test_login('33700000-0000-0000-0000-000000000010', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 2, 'Incercare respinsa') $$,
  (select gate_task_id from f337)),
  '42501', 'task_command_forbidden', 'a deactivated BC holding a still-valid level-6 token is stopped at the gate');
reset role;

select pg_temp.test_login('33700000-0000-0000-0000-000000000011',
  jsonb_build_object('provider', 'email'));
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 2, 'Incercare respinsa') $$,
  (select gate_task_id from f337)),
  '42501', 'task_command_forbidden', 'a real uid without organisation claims is stopped at the gate too');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(format($$ select public.mark_task_unfulfilled(%s, 3, 2, 'Incercare respinsa') $$,
  (select gate_task_id from f337)),
  '42501', 'permission denied for function mark_task_unfulfilled',
  'anon cannot execute mark_task_unfulfilled at all -- the literal grant denial');
reset role;

select is((select count(*) from public.task_evaluations
            where task_id in (select gate_task_id from f337)
               or task_id in (select ind_task_id from f337)
               or task_id in (select proj_lead_task_id from f337)
               or task_id in (select proj_resp_task_id from f337)), 0::bigint,
  'no denied persona wrote an Evaluation');
select is((select count(*) from public.points_ledger
            where task_id in (select gate_task_id from f337)
               or task_id in (select ind_task_id from f337)
               or task_id in (select proj_lead_task_id from f337)
               or task_id in (select proj_resp_task_id from f337))
        + (select count(*) from public.task_activity
            where task_id in (select gate_task_id from f337)
               or task_id in (select ind_task_id from f337)
               or task_id in (select proj_lead_task_id from f337)
               or task_id in (select proj_resp_task_id from f337))
        + (select count(*) from public.notifications
            where task_id in (select gate_task_id from f337)
               or task_id in (select ind_task_id from f337)
               or task_id in (select proj_lead_task_id from f337)
               or task_id in (select proj_resp_task_id from f337)), 0::bigint,
  'and none of them moved a point, wrote an activity row, or sent a notification');
select is((select count(*) from public.tasks
            where (id in (select gate_task_id from f337)
               or id in (select ind_task_id from f337)
               or id in (select proj_lead_task_id from f337)
               or id in (select proj_resp_task_id from f337))
              and status = 'in_progress'), 4::bigint,
  'all four denied-target Tasks are still in_progress, untouched');

-- ==================== 7. The persona matrix -- allowed ====================

select pg_temp.test_login('33700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.mark_task_unfulfilled(%s, 2, 1, 'Nu am reusit sa termin la timp') $$,
  (select proj_lead_task_id from f337)),
  'the Project lead may mark their OWN overdue work unfulfilled -- the one place a self-evaluation is allowed');
reset role;
select is((select format('%s|%s', task.status, (select ledger.delta from public.points_ledger as ledger
                                                 where ledger.task_id = task.id))
             from public.tasks as task where task.id = (select proj_lead_task_id from f337)),
  'unfulfilled|-2',
  'the lead credits themselves 2 x rating_mult(1) = -2, recorded like any other award');
select is((select count(*) from public.notifications
            where task_id = (select proj_lead_task_id from f337)), 0::bigint,
  'the lead is both actor and Executor -- private.notify drops the actor, so a self-evaluation notifies nobody');

select pg_temp.test_login('33700000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.mark_task_unfulfilled(%s, 2, 2, 'Echipa nu a predat') $$,
  (select dt_task_id from f337)),
  'the local BCE of a Department-Team''s PARENT Department may mark the Team''s overdue Task unfulfilled too');
reset role;
select set_eq(
  format($$ select notification.member_id from public.notifications as notification
             where notification.task_id = %s $$, (select dt_task_id from f337)),
  $$ values ('33700000-0000-0000-0000-000000000005'::uuid) $$,
  'exactly the Team Task''s Executor is notified -- a direct Task closes no queue, so there is nobody else');

-- ==================== 8. The command is the only write path ====================

select pg_temp.test_login('33700000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ insert into public.task_evaluations
  (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
  values (%s, %s, '33700000-0000-0000-0000-000000000002', 'unfulfilled', 5, 1, -5, 'Fals') $$,
  (select direct_write_task_id from f337), (select direct_write_assignment_id from f337)),
  '42501', null,
  'even the Task''s own evaluator cannot write an Evaluation directly -- private.evaluate_task is the only path');
select throws_ok(format($$ insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id)
  values ('33700000-0000-0000-0000-000000000017', -99, 'task', %s, %s) $$,
  (select direct_write_task_id from f337), (select happy_evaluation_id from e337)),
  '42501', null,
  'and cannot credit points directly either -- ledger_sanction is the only insert policy and it demands reason = sanction');
reset role;

select is((select count(*) from public.task_evaluations
            where task_id = (select direct_write_task_id from f337)), 0::bigint,
  'the direct-write target carries no Evaluation after those attempts');

-- ==================== 9. Lock held while the command runs ====================
-- A single-session lock probe (the brief asks for a probe, not a race): a
-- held dblink transaction runs mark_task_unfulfilled, and a second session
-- inspects extensions.pgrowlocks while it is still open.
--
-- Honest limitation, established by mutation rather than assumed (the same
-- one complete_task_review.test.sql documents for its own probe): the
-- tasks-row assertion below does NOT discriminate step 3's own `for update`
-- keyword on its own. Removing it from mark_task_unfulfilled_impl leaves
-- this assertion green, because private.evaluate_task's own terminal UPDATE
-- on public.tasks (setting status/difficulty/rating/unfulfilled_at) runs
-- later in the SAME held transaction and takes an equivalent exclusive lock
-- by the time this probe reads pgrowlocks -- a single-session snapshot taken
-- after the call returns cannot tell "locked since step 3" from "locked
-- since the terminal UPDATE". What actually proves the step-3 lock closes
-- the window between require_task_evaluator and evaluate_task is section
-- 10's two-session race below, mirroring complete_task_review.test.sql's
-- section 12. The assignment-row assertion here has the identical
-- limitation for a different reason: it verifies a lock private.evaluate_task
-- itself already takes and already proved elsewhere (#336), not anything
-- this migration adds.
select extensions.dblink_connect('ctr_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));

select extensions.dblink_exec('ctr_setup', $$
  insert into auth.users (id, email) values
    ('33700000-0000-0000-0000-000000000051', 'probe.evaluator.337@test.local'),
    ('33700000-0000-0000-0000-000000000052', 'probe.manager.337@test.local'),
    ('33700000-0000-0000-0000-000000000053', 'probe.executor.337@test.local'),
    ('33700000-0000-0000-0000-000000000054', 'race.exec.337@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('33700000-0000-0000-0000-000000000051', 'Probe Evaluator 337', 'probe.evaluator.337@test.local', 'bce', 'activ'),
    ('33700000-0000-0000-0000-000000000052', 'Probe Manager 337', 'probe.manager.337@test.local', 'voluntar', 'activ'),
    ('33700000-0000-0000-0000-000000000053', 'Probe Executor 337', 'probe.executor.337@test.local', 'voluntar', 'activ'),
    ('33700000-0000-0000-0000-000000000054', 'Race Executor 337', 'race.exec.337@test.local', 'voluntar', 'activ');
  insert into public.member_departments (member_id, dept_id) values
    ('33700000-0000-0000-0000-000000000051', 'edu'),
    ('33700000-0000-0000-0000-000000000052', 'edu'),
    ('33700000-0000-0000-0000-000000000053', 'edu'),
    ('33700000-0000-0000-0000-000000000054', 'edu');

  insert into public.tasks
    (title, description, deadline, dept_id, audience, assignment_mode, status,
     created_at, started_at, created_by)
  values
    ('Sonda blocaj nerealizat #337 committed', 'Sonda', now() - interval '2 days', 'edu', 'local', 'direct', 'in_progress',
     now() - interval '5 days', now() - interval '4 days',
     '33700000-0000-0000-0000-000000000052'),
    ('Cursa dubla nerealizat #337 committed', 'Doi apeluri, un task nerealizat', now() - interval '2 days', 'edu', 'local', 'direct', 'in_progress',
     now() - interval '5 days', now() - interval '4 days',
     '33700000-0000-0000-0000-000000000052');

  insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
  select id, '33700000-0000-0000-0000-000000000053'::uuid, '33700000-0000-0000-0000-000000000052'::uuid,
         now() - interval '4 days'
    from public.tasks where title = 'Sonda blocaj nerealizat #337 committed'
  union all
  select id, '33700000-0000-0000-0000-000000000054'::uuid, '33700000-0000-0000-0000-000000000052'::uuid,
         now() - interval '4 days'
    from public.tasks where title = 'Cursa dubla nerealizat #337 committed';
$$);

create temp table r337 as
select (select id from public.tasks where title = 'Sonda blocaj nerealizat #337 committed') as probe_task_id,
       (select assignment.id from public.task_assignments as assignment
          join public.tasks as task on task.id = assignment.task_id
         where task.title = 'Sonda blocaj nerealizat #337 committed'
           and assignment.ended_at is null) as probe_assignment_id,
       (select id from public.tasks where title = 'Cursa dubla nerealizat #337 committed') as race_task_id;
grant select on r337 to authenticated;

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
    'sub', '33700000-0000-0000-0000-000000000051', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'bce', 'member_level', 5,
      'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text, true)
$$) as remote_claims(setting text);
select extensions.dblink_exec('ctr_lock', 'set local role authenticated');
-- Single-field `(f(...)).status` projection on purpose: `complete_task_review.test.sql`'s
-- lock-probe warning applies here too -- two fields would run the command twice.
select * from extensions.dblink('ctr_lock', format($$
  select (public.mark_task_unfulfilled(%s, 3, 2, 'Sonda de blocaj')).status::text
$$, (select probe_task_id from r337))) as locked_review(status text);

select ok(coalesce((
  select row_lock.modes && array['For Update', 'Update', 'No Key Update']
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_task_id from r337)
), false), 'mark_task_unfulfilled holds the target Task row exclusively locked while it runs');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.profiles') as row_lock
    join public.profiles as profile on profile.ctid = row_lock.locked_row
   where profile.id = '33700000-0000-0000-0000-000000000051'
), false), 'it holds the evaluator''s own live profile row FOR SHARE (private.require_origin_manager''s discipline)');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.group_members') as row_lock
    join public.group_members as membership on membership.ctid = row_lock.locked_row
    join public.groups as authority_group on authority_group.id = membership.group_id
   where membership.member_id = '33700000-0000-0000-0000-000000000051'
     and authority_group.legacy_dept_id = 'edu'
), false), 'and the Group roster row their evaluator authority rests on FOR SHARE too');
select ok(coalesce((
  select bool_or(row_lock.modes && array['For Update', 'Update', 'No Key Update'])
    from extensions.pgrowlocks('public.task_assignments') as row_lock
    join public.task_assignments as assignment on assignment.ctid = row_lock.locked_row
   where assignment.id = (select probe_assignment_id from r337)
), false), 'the Assignment being credited is held exclusively -- private.evaluate_task locks it FOR UPDATE before writing the Evaluation and the ledger entry');

select extensions.dblink_exec('ctr_lock', 'rollback');
select extensions.dblink_disconnect('ctr_lock');

-- ==================== 10. Race: two calls, one overdue Task ====================
-- Mirrors complete_task_review.test.sql's section 12: pg_temp.test_race runs
-- call A to completion, sends call B while A is still uncommitted, waits
-- until B blocks, then commits A and fetches B's result. This is what
-- actually discriminates step 3's tasks-row `for update` lock, which the
-- section-9 single-session probe above cannot (see the comment there) --
-- with the lock held, B blocks on the tasks row behind A, then re-reads A's
-- committed 'unfulfilled' status under EvalPlanQual and answers PT409
-- task_terminal.
--
-- Mutation-verified: with `for update` removed from step 3's
-- `select * into v_task from public.tasks where id = p_task_id`, B no
-- longer blocks on the tasks row at all -- it proceeds straight past the
-- (now stale) state checks and into private.evaluate_task, finds the
-- Assignment A already ended, and answers PT409 task_has_no_executor
-- instead. That mutation was run and reverted; see the task report for the
-- captured RED/GREEN output. The keyword is restored in the migration.
--
-- B's error propagates out of extensions.dblink_get_result and cannot be
-- caught in SQL, so the whole call is wrapped in throws_ok (the
-- complete_task_review.test.sql:1150 / campaign_commands.test.sql precedent).
-- Single-field `(f(...)).status` projections -- see the WARNING above the
-- section-9 probe call: two fields would run the command twice.
select pg_temp.test_login('33700000-0000-0000-0000-000000000051', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($outer$
  select * from pg_temp.test_race(%L, %L)
$outer$,
  format($$ select (public.mark_task_unfulfilled(%s, 3, 1, 'Apelul A')).status::text $$,
    (select race_task_id from r337)),
  format($$ select (public.mark_task_unfulfilled(%s, 3, 2, 'Apelul B')).status::text $$,
    (select race_task_id from r337))),
  'PT409', 'task_terminal',
  'the second call blocks on the tasks-row lock and then answers task_terminal against the first''s committed unfulfilled status -- never a duplicate Evaluation or a double credit');
reset role;

select is((select count(*) from public.task_evaluations
            where task_id = (select race_task_id from r337)), 1::bigint,
  'exactly one Evaluation survives the double-unfulfilled race');
select is((select format('%s|%s', count(*), coalesce(sum(delta), 0))
             from public.points_ledger
            where task_id = (select race_task_id from r337)),
  '1|-3',
  'and the Executor is credited exactly once, with the FIRST call''s award (Difficulty 3 x rating_mult(1) = -3), never the second''s 3 x 0 = 0 on top of it');

select extensions.dblink_exec('ctr_setup', $$
  set session_replication_role = 'replica';
  delete from public.points_ledger
   where task_id in (select id from public.tasks where title like '%#337 committed%');
  delete from public.task_evaluations
   where task_id in (select id from public.tasks where title like '%#337 committed%');
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#337 committed%');
  set session_replication_role = 'origin';
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#337 committed%')
      or member_id in ('33700000-0000-0000-0000-000000000051',
                       '33700000-0000-0000-0000-000000000052',
                       '33700000-0000-0000-0000-000000000053',
                       '33700000-0000-0000-0000-000000000054');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where title like '%#337 committed%');
  delete from public.tasks where title like '%#337 committed%';
  delete from public.member_departments where member_id in (
    '33700000-0000-0000-0000-000000000051', '33700000-0000-0000-0000-000000000052',
    '33700000-0000-0000-0000-000000000053', '33700000-0000-0000-0000-000000000054');
  delete from auth.users where id in (
    '33700000-0000-0000-0000-000000000051', '33700000-0000-0000-0000-000000000052',
    '33700000-0000-0000-0000-000000000053', '33700000-0000-0000-0000-000000000054');
$$);
select extensions.dblink_disconnect('ctr_setup');

select is((select count(*) from public.tasks where title like '%#337 committed%'), 0::bigint,
  'the committed lock-probe and race fixtures are removed again -- this suite leaves no trace');
select is((select count(*) from public.points_ledger
            where member_id in ('33700000-0000-0000-0000-000000000053',
                                 '33700000-0000-0000-0000-000000000054')), 0::bigint,
  'including every point the probe and the race actually credited');


-- #521: Group authority regression matrix.
\ir _group_task_fixtures.psql
reset role;
select pg_temp.g521_task('command0','project',5,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($$select public.mark_task_unfulfilled((select id from g521_tasks where name='command0'),3,3,'Evaluation #521')$$,'mark_task_unfulfilled: Group persona 2 on executor 5 in project');
reset role;
select pg_temp.g521_task('command1','project',4,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select throws_ok($$select public.mark_task_unfulfilled((select id from g521_tasks where name='command1'),3,3,'Evaluation #521')$$,'42501','task_evaluate_forbidden','mark_task_unfulfilled: Group persona 3 on executor 4 in project');
reset role;
select pg_temp.g521_task('command2','ind',7,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(6));
select throws_ok($$select public.mark_task_unfulfilled((select id from g521_tasks where name='command2'),3,3,'Evaluation #521')$$,'42501','task_evaluate_forbidden','mark_task_unfulfilled: Group persona 6 on executor 7 in ind');
reset role;
select pg_temp.g521_task('command3','dt',5,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(8));
select throws_ok($$select public.mark_task_unfulfilled((select id from g521_tasks where name='command3'),3,3,'Evaluation #521')$$,'42501','task_evaluate_forbidden','mark_task_unfulfilled: Group persona 8 on executor 5 in dt');
reset role;
select pg_temp.g521_task('command4','project',5,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select lives_ok($$select public.mark_task_unfulfilled((select id from g521_tasks where name='command4'),3,3,'Evaluation #521')$$,'mark_task_unfulfilled: Group persona 3 on executor 5 in project');
reset role;
select pg_temp.g521_task('command5','project',3,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select throws_ok($$select public.mark_task_unfulfilled((select id from g521_tasks where name='command5'),3,3,'Evaluation #521')$$,'42501','task_evaluate_forbidden','mark_task_unfulfilled: Group persona 3 on executor 3 in project');
reset role;
select pg_temp.g521_task('command6','project',2,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select throws_ok($$select public.mark_task_unfulfilled((select id from g521_tasks where name='command6'),3,3,'Evaluation #521')$$,'42501','task_evaluate_forbidden','mark_task_unfulfilled: Group persona 3 on executor 2 in project');
reset role;
select pg_temp.g521_task('command7','project',2,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($$select public.mark_task_unfulfilled((select id from g521_tasks where name='command7'),3,3,'Evaluation #521')$$,'mark_task_unfulfilled: Group persona 2 on executor 2 in project');
reset role;
select pg_temp.g521_task('command8','ind',7,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(1));
select lives_ok($$select public.mark_task_unfulfilled((select id from g521_tasks where name='command8'),3,3,'Evaluation #521')$$,'mark_task_unfulfilled: Group persona 1 on executor 7 in ind');
reset role;

select * from finish();
rollback;
