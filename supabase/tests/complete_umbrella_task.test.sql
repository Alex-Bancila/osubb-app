-- #340: public.complete_umbrella_task -- the Umbrella side of ADR-0007's
-- rollup. An Umbrella is never evaluated; this command is a manager's plain
-- acknowledgement that every Subtask has already reached a terminal outcome
-- on its own.
--
-- What this suite pins that no earlier suite does:
--   * the four state preconditions in the brief's own order (task_not_umbrella,
--     task_terminal, umbrella_has_no_subtasks, subtasks_not_terminal), the
--     last one carrying the non-terminal count on the exception's `detail`
--     (no repo precedent tests `detail` before this migration -- section 4
--     adds a small pg_temp helper that captures it with `get stacked
--     diagnostics`);
--   * that `cancelled` counts as terminal exactly like `completed`/
--     `unfulfilled` -- cancelling the last open Subtask (#339) is what makes
--     the Umbrella completable;
--   * that this command creates NO task_evaluations row and NO points_ledger
--     row -- a rollup, never an Evaluation;
--   * the LOCK MODE: the Umbrella is held FOR NO KEY UPDATE, never FOR
--     UPDATE -- section 8 both proves the mode with pgrowlocks and
--     reproduces the 40P01 that FOR UPDATE would cause against
--     private.evaluate_task's implicit FK FOR KEY SHARE on the same row (the
--     bug #338 shipped first, #339 shipped again, and the wave's Ruling 20
--     answers for good);
--   * the two cross-command checks the brief pins: a completed Umbrella
--     rejects create_task of a new Subtask (#327's parent_terminal), and
--     reopening a Subtask under a completed Umbrella flips it back to todo
--     (#338's cascade).
--
-- Fixture prefix 34000000-0000-0000-0000-0000000000NN throughout, resolved
-- as the owner into temp tables before any persona logs in (the #328 trap,
-- stack-context.md carry-forwards). The committed lock-probe/deadlock
-- fixtures use 34000000-...-0000000000[5]N and carry '#340 committed' in
-- their titles.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(47);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('34000000-0000-0000-0000-000000000001', 'bc.340@test.local'),
  ('34000000-0000-0000-0000-000000000002', 'bce.edu.340@test.local'),
  ('34000000-0000-0000-0000-000000000003', 'bce.pr.340@test.local'),
  ('34000000-0000-0000-0000-000000000004', 'member.edu.340@test.local'),
  ('34000000-0000-0000-0000-000000000005', 'member.pr.340@test.local'),
  ('34000000-0000-0000-0000-000000000006', 'ind.team.340@test.local'),
  ('34000000-0000-0000-0000-000000000007', 'proj.lead.340@test.local'),
  ('34000000-0000-0000-0000-000000000008', 'proj.responsible.340@test.local'),
  ('34000000-0000-0000-0000-000000000009', 'proj.member.340@test.local'),
  ('34000000-0000-0000-0000-000000000010', 'inactive.bc.340@test.local'),
  ('34000000-0000-0000-0000-000000000011', 'claimless.340@test.local'),
  ('34000000-0000-0000-0000-000000000012', 'exec.credited.340@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('34000000-0000-0000-0000-000000000001', 'BC 340', 'bc.340@test.local', 'bc', 'activ'),
  ('34000000-0000-0000-0000-000000000002', 'BCE EDU 340', 'bce.edu.340@test.local', 'bce', 'activ'),
  ('34000000-0000-0000-0000-000000000003', 'BCE PR 340', 'bce.pr.340@test.local', 'bce', 'activ'),
  ('34000000-0000-0000-0000-000000000004', 'Membru EDU 340', 'member.edu.340@test.local', 'voluntar', 'activ'),
  ('34000000-0000-0000-0000-000000000005', 'Membru PR 340', 'member.pr.340@test.local', 'voluntar', 'activ'),
  ('34000000-0000-0000-0000-000000000006', 'Membru Echipa Independenta 340', 'ind.team.340@test.local', 'voluntar', 'activ'),
  ('34000000-0000-0000-0000-000000000007', 'Lead Proiect 340', 'proj.lead.340@test.local', 'voluntar', 'activ'),
  ('34000000-0000-0000-0000-000000000008', 'Responsabil Proiect 340', 'proj.responsible.340@test.local', 'voluntar', 'activ'),
  ('34000000-0000-0000-0000-000000000009', 'Membru Proiect 340', 'proj.member.340@test.local', 'voluntar', 'activ'),
  ('34000000-0000-0000-0000-000000000010', 'BC Inactiv 340', 'inactive.bc.340@test.local', 'bc', 'inactiv'),
  ('34000000-0000-0000-0000-000000000011', 'Fara Claimuri 340', 'claimless.340@test.local', 'voluntar', 'activ'),
  ('34000000-0000-0000-0000-000000000012', 'Executor Creditat 340', 'exec.credited.340@test.local', 'voluntar', 'activ');

insert into public.member_departments (member_id, dept_id) values
  ('34000000-0000-0000-0000-000000000002', 'edu'),
  ('34000000-0000-0000-0000-000000000003', 'pr'),
  ('34000000-0000-0000-0000-000000000004', 'edu'),
  ('34000000-0000-0000-0000-000000000005', 'pr'),
  ('34000000-0000-0000-0000-000000000011', 'edu'),
  ('34000000-0000-0000-0000-000000000012', 'edu');

insert into public.teams (id, name, dept_id) values
  ('t-340-ind', 'Echipa Independenta 340', null);
insert into public.team_members (team_id, member_id) values
  ('t-340-ind', '34000000-0000-0000-0000-000000000006');

insert into public.projects (name, status, leader_id, created_by) values
  ('Proiect #340', 'active',
   '34000000-0000-0000-0000-000000000007', '34000000-0000-0000-0000-000000000001');
insert into public.project_members (project_id, member_id, project_role) values
  ((select id from public.projects where name = 'Proiect #340'),
   '34000000-0000-0000-0000-000000000008', 'responsible'),
  ((select id from public.projects where name = 'Proiect #340'),
   '34000000-0000-0000-0000-000000000009', 'member');

-- ---- T-ORD: an ordinary Task, never an Umbrella.
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, created_at, created_by)
values
  ('Task obisnuit #340', 'Nu e umbrela', now() + interval '10 days', 'edu', 'local', 'direct', 'todo',
   now() - interval '10 days', '34000000-0000-0000-0000-000000000002');

-- ---- U-TERM: an Umbrella already completed.
insert into public.tasks
  (title, description, dept_id, kind, audience, assignment_mode, status, completed_at, created_at, created_by)
values
  ('Umbrela deja finalizata #340', 'Nimic de facut', 'edu', 'umbrella', null, null, 'completed',
   now() - interval '1 day', now() - interval '10 days', '34000000-0000-0000-0000-000000000002');

-- ---- U-ZERO: an Umbrella with no Subtasks at all.
insert into public.tasks
  (title, description, dept_id, kind, audience, assignment_mode, status, created_at, created_by)
values
  ('Umbrela fara subtaskuri #340', 'Goala', 'edu', 'umbrella', null, null, 'todo',
   now() - interval '10 days', '34000000-0000-0000-0000-000000000002');

-- ---- U1 + S1: the main happy path. One Subtask still todo blocks; cancelling
-- it (via the real #339 command) is what makes the Umbrella completable --
-- `cancelled` counts as terminal. Creator is the edu BCE; the actor who
-- completes it is BC, so private.task_managers(U1, BC) resolves to exactly
-- {BCE edu} through the deterministic creator branch (complete_task_review's
-- own precedent for this shape).
insert into public.tasks
  (title, description, dept_id, kind, audience, assignment_mode, status, created_at, created_by)
values ('Umbrela principala #340', 'Fluxul fericit', 'edu', 'umbrella', null, null, 'todo',
        now() - interval '10 days', '34000000-0000-0000-0000-000000000002');
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, parent_task_id,
   created_at, created_by)
select 'Subtask deschis #340', 'Inca in lucru', now() + interval '10 days', 'edu', 'local', 'direct',
       'todo', parent.id, now() - interval '10 days', '34000000-0000-0000-0000-000000000002'
  from public.tasks as parent where parent.title = 'Umbrela principala #340';

-- ---- U2 + S2: the EMPTY-notify case. Creator and actor are the SAME BCE,
-- and the Subtask is already terminal, so a single call finishes the
-- Umbrella outright. Department 'edu' has no other local BCE in this
-- database (the seed BCE sits in 'diverse'/'pr'), so private.task_managers'
-- Department branch already returns nobody once the actor is excluded; the
-- ONLY thing standing between that and a literal empty recipient set is
-- task_managers' global BC/Moderator fallback, which the seed's two demo
-- accounts (bc@demo.osubb, moderator@demo.osubb) would otherwise satisfy.
-- Section 3 deactivates them for the single call this needs and restores
-- them immediately after -- inside this suite's own rolled-back transaction,
-- so nothing outlives it.
insert into public.tasks
  (title, description, dept_id, kind, audience, assignment_mode, status, created_at, created_by)
values ('Umbrela fara notificare #340', 'Managerul isi termina singur treaba', 'edu', 'umbrella',
        null, null, 'todo', now() - interval '10 days', '34000000-0000-0000-0000-000000000002');
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, parent_task_id,
   cancelled_at, cancel_reason, created_at, created_by)
select 'Subtask deja incheiat #340', 'Terminat dinainte', now() + interval '10 days', 'edu', 'local', 'direct',
       'cancelled', parent.id, now() - interval '2 days', 'Nu mai e nevoie #340',
       now() - interval '10 days', '34000000-0000-0000-0000-000000000002'
  from public.tasks as parent where parent.title = 'Umbrela fara notificare #340';

-- ---- U3 + S3: the reopen cross-check (#338). S3 is credited through
-- pg_temp.test_credit_task (_helpers.sql) -- a real `source = command`
-- Evaluation and ledger row on a directly-inserted completed fixture Task,
-- the same shortcut stack-context.md describes it for -- so reopen_task has
-- a genuine Evaluation to reverse without walking the whole start/submit/
-- complete_task_review lifecycle.
insert into public.tasks
  (title, description, dept_id, kind, audience, assignment_mode, status, created_at, created_by)
values ('Umbrela de redeschis #340', 'Va fi redeschisa dupa finalizare', 'edu', 'umbrella',
        null, null, 'todo', now() - interval '10 days', '34000000-0000-0000-0000-000000000002');
insert into public.tasks
  (title, description, deadline, dept_id, audience, assignment_mode, status, parent_task_id,
   difficulty, rating, created_at, started_at, submitted_at, completed_at, created_by)
select 'Subtask creditat #340', 'Va fi redeschis', now() + interval '10 days', 'edu', 'local', 'direct',
       'completed', parent.id, 3, 4,
       now() - interval '10 days', now() - interval '9 days', now() - interval '3 days', now() - interval '2 days',
       '34000000-0000-0000-0000-000000000002'
  from public.tasks as parent where parent.title = 'Umbrela de redeschis #340';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at, ended_at, end_reason)
select id, '34000000-0000-0000-0000-000000000012', '34000000-0000-0000-0000-000000000002',
       now() - interval '9 days', now() - interval '2 days', 'completed'
  from public.tasks where title = 'Subtask creditat #340';
select pg_temp.test_credit_task(
  (select id from public.tasks where title = 'Subtask creditat #340'),
  '34000000-0000-0000-0000-000000000012', '34000000-0000-0000-0000-000000000002');

-- ---- U-DENY: zero Subtasks, dept edu -- shared target for every DENIED
-- persona. Authority (step 4) runs before any state precondition, so a
-- denial fires the same whether or not this Umbrella could ever complete.
insert into public.tasks
  (title, description, dept_id, kind, audience, assignment_mode, status, created_at, created_by)
values ('Umbrela tinta refuzuri #340', 'Nimeni fara autoritate nu o poate finaliza', 'edu', 'umbrella',
        null, null, 'todo', now() - interval '10 days', '34000000-0000-0000-0000-000000000002');

-- ---- U-IND + S-IND: the Independent Team's own positive case -- the same
-- boundary #339/#336 separate managing from evaluating.
insert into public.tasks
  (title, description, team_id, kind, audience, assignment_mode, status, created_at, created_by)
values ('Umbrela echipa independenta #340', 'Echipa isi termina singura treaba', 't-340-ind', 'umbrella',
        null, null, 'todo', now() - interval '10 days', '34000000-0000-0000-0000-000000000001');
insert into public.tasks
  (title, description, deadline, team_id, audience, assignment_mode, status, parent_task_id,
   cancelled_at, cancel_reason, created_at, created_by)
select 'Subtask echipa independenta #340', 'Deja incheiat', now() + interval '10 days', 't-340-ind', 'local', 'direct',
       'cancelled', parent.id, now() - interval '2 days', 'Nu mai e nevoie #340',
       now() - interval '10 days', '34000000-0000-0000-0000-000000000001'
  from public.tasks as parent where parent.title = 'Umbrela echipa independenta #340';

-- ---- U-PROJ-LEAD + S-PROJ-LEAD: the Project lead's positive case.
insert into public.tasks
  (title, description, project_id, kind, audience, assignment_mode, status, created_at, created_by)
select 'Umbrela proiect lead #340', 'Leadul o finalizeaza', project.id, 'umbrella', null, null, 'todo',
       now() - interval '10 days', '34000000-0000-0000-0000-000000000001'
  from public.projects as project where project.name = 'Proiect #340';
insert into public.tasks
  (title, description, deadline, project_id, audience, assignment_mode, status, parent_task_id,
   cancelled_at, cancel_reason, created_at, created_by)
select 'Subtask proiect lead #340', 'Deja incheiat', now() + interval '10 days', project.id, 'local', 'direct',
       'cancelled', parent.id, now() - interval '2 days', 'Nu mai e nevoie #340',
       now() - interval '10 days', '34000000-0000-0000-0000-000000000001'
  from public.tasks as parent
  join public.projects as project on project.id = parent.project_id
 where parent.title = 'Umbrela proiect lead #340';

-- ---- U-PROJ-RESP + S-PROJ-RESP: the Project Responsible's positive case.
insert into public.tasks
  (title, description, project_id, kind, audience, assignment_mode, status, created_at, created_by)
select 'Umbrela proiect responsabil #340', 'Responsabilul o finalizeaza', project.id, 'umbrella', null, null, 'todo',
       now() - interval '10 days', '34000000-0000-0000-0000-000000000001'
  from public.projects as project where project.name = 'Proiect #340';
insert into public.tasks
  (title, description, deadline, project_id, audience, assignment_mode, status, parent_task_id,
   cancelled_at, cancel_reason, created_at, created_by)
select 'Subtask proiect responsabil #340', 'Deja incheiat', now() + interval '10 days', project.id, 'local', 'direct',
       'cancelled', parent.id, now() - interval '2 days', 'Nu mai e nevoie #340',
       now() - interval '10 days', '34000000-0000-0000-0000-000000000001'
  from public.tasks as parent
  join public.projects as project on project.id = parent.project_id
 where parent.title = 'Umbrela proiect responsabil #340';

-- ---- U-PROJ-DENY: zero Subtasks -- the plain Project member's denial.
insert into public.tasks
  (title, description, project_id, kind, audience, assignment_mode, status, created_at, created_by)
select 'Umbrela proiect refuz #340', 'Membrul simplu nu o poate finaliza', project.id, 'umbrella', null, null, 'todo',
       now() - interval '10 days', '34000000-0000-0000-0000-000000000001'
  from public.projects as project where project.name = 'Proiect #340';

-- ---- T-HIDDEN: a 'local' pr Task an edu-only member cannot even see.
insert into public.tasks
  (title, description, dept_id, kind, audience, assignment_mode, status, created_at, created_by)
values ('Umbrela ascunsa pr #340', 'Alt departament', 'pr', 'umbrella', null, null, 'todo',
        now() - interval '10 days', '34000000-0000-0000-0000-000000000003');

create temp table f340 as
select
  (select id from public.tasks where title = 'Task obisnuit #340') as ordinary_task_id,
  (select id from public.tasks where title = 'Umbrela deja finalizata #340') as terminal_umbrella_id,
  (select id from public.tasks where title = 'Umbrela fara subtaskuri #340') as zero_subtask_umbrella_id,
  (select id from public.tasks where title = 'Umbrela principala #340') as u1_id,
  (select id from public.tasks where title = 'Subtask deschis #340') as s1_id,
  (select id from public.tasks where title = 'Umbrela fara notificare #340') as u2_id,
  (select id from public.tasks where title = 'Subtask deja incheiat #340') as s2_id,
  (select id from public.tasks where title = 'Umbrela de redeschis #340') as u3_id,
  (select id from public.tasks where title = 'Subtask creditat #340') as s3_id,
  (select id from public.tasks where title = 'Umbrela tinta refuzuri #340') as deny_umbrella_id,
  (select id from public.tasks where title = 'Umbrela echipa independenta #340') as ind_umbrella_id,
  (select id from public.tasks where title = 'Umbrela proiect lead #340') as proj_lead_umbrella_id,
  (select id from public.tasks where title = 'Umbrela proiect responsabil #340') as proj_resp_umbrella_id,
  (select id from public.tasks where title = 'Umbrela proiect refuz #340') as proj_deny_umbrella_id,
  (select id from public.tasks where title = 'Umbrela ascunsa pr #340') as hidden_umbrella_id;
grant select on f340 to authenticated, anon;

-- ==================== 1. State preconditions, in the brief's own order ====================
select pg_temp.test_login('34000000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));

select throws_ok(format($$ select public.complete_umbrella_task(%s) $$,
  (select ordinary_task_id from f340)),
  'PT409', 'task_not_umbrella', 'an ordinary Task is refused first, before any status check');
select throws_ok(format($$ select public.complete_umbrella_task(%s) $$,
  (select terminal_umbrella_id from f340)),
  'PT409', 'task_terminal', 'an already-completed Umbrella cannot be completed twice');
select throws_ok(format($$ select public.complete_umbrella_task(%s) $$,
  (select zero_subtask_umbrella_id from f340)),
  'PT409', 'umbrella_has_no_subtasks', 'an Umbrella with no Subtasks at all has nothing to roll up');
select throws_ok(format($$ select public.complete_umbrella_task(%s) $$,
  (select u1_id from f340)),
  'PT409', 'subtasks_not_terminal', 'one Subtask still todo blocks the rollup');

-- The `detail` on that last exception -- no repo precedent tests this field,
-- so a small helper captures it with `get stacked diagnostics`.
create function pg_temp.capture_error_detail(p_sql text) returns text
language plpgsql as $$
declare
  v_detail text;
begin
  execute p_sql;
  return '(no error)';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;
select is(pg_temp.capture_error_detail(
  format($$ select public.complete_umbrella_task(%s) $$, (select u1_id from f340))),
  '1', 'the subtasks_not_terminal exception carries the non-terminal count on its detail');

select throws_ok($$ select public.complete_umbrella_task(999999999) $$,
  'PT404', 'task_not_found', 'an unknown Task id is not found');
select throws_ok($$ select public.complete_umbrella_task(null) $$,
  'PT404', 'task_not_found', 'a null Task id is the same non-disclosing answer, never PT400 (wave ruling)');
reset role;

-- ==================== 2. The happy path: cancel the blocker, then complete ====================
select pg_temp.test_login('34000000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.cancel_task(%s, 'Nu mai e nevoie #340.') $$,
  (select s1_id from f340)),
  'the blocking Subtask is cancelled through the real #339 command');
reset role;

select is((select task.status::text from public.tasks as task where task.id = (select s1_id from f340)),
  'cancelled', 'and it is now terminal -- `cancelled` counts exactly like `completed`/`unfulfilled`');

select pg_temp.test_login('34000000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.complete_umbrella_task(%s) $$,
  (select u1_id from f340)),
  'BC completes the Umbrella now that its only Subtask is terminal');
reset role;

select is((select format('%s|%s', task.status::text, (task.completed_at is not null)::text)
             from public.tasks as task where task.id = (select u1_id from f340)),
  'completed|true', 'the Umbrella is completed with completed_at stamped');
select is((select format('%s|%s|%s|%s',
                         activity.kind, activity.actor_id::text,
                         (activity.assignment_id is null)::text,
                         format('%s->%s', activity.from_status, activity.to_status))
             from public.task_activity as activity
            where activity.task_id = (select u1_id from f340) and activity.kind = 'umbrella_completed'),
  format('umbrella_completed|%s|true|todo->completed', '34000000-0000-0000-0000-000000000001'),
  'one umbrella_completed activity row: the actor is BC, no assignment (an Umbrella has none), todo -> completed');
select is((select activity.details from public.task_activity as activity
            where activity.task_id = (select u1_id from f340) and activity.kind = 'umbrella_completed'),
  '{"subtask_count": 1}'::jsonb, 'details names exactly how many Subtasks it rolled up');
-- Scoped by `dedupe_key is null`: cancelling S1 a moment ago (through the
-- real #339 command, as the manager acting on their own Subtask) already
-- wrote its OWN independent-Subtask rollup onto U1 (`task:{u1}:subtasks`,
-- dedupe_key set) -- that notification's recipients are a DIFFERENT, wider
-- set (task_managers with the CANCELLING actor excluded, which falls through
-- to the global BC/Moderator fallback since 'edu' has no other local BCE).
-- Filtering it out isolates exactly what THIS command's own call wrote.
select set_eq(
  format($$ select member_id from public.notifications
             where task_id = %s and dedupe_key is null $$, (select u1_id from f340)),
  $$ values ('34000000-0000-0000-0000-000000000002'::uuid) $$,
  'the NON-empty case: the creator (BCE edu), who is not the actor, is told -- private.task_managers'' deterministic creator branch');
select is((select format('%s|%s', notification.title, notification.body)
             from public.notifications as notification
            where notification.task_id = (select u1_id from f340) and notification.dedupe_key is null),
  'Umbrelă finalizată: Umbrela principala #340|Toate subtaskurile sunt încheiate.',
  'with the pinned Romanian copy');
select is((select count(*) from public.task_evaluations where task_id = (select u1_id from f340)), 0::bigint,
  'no task_evaluations row is ever created for an Umbrella');
select is((select count(*) from public.points_ledger where task_id = (select u1_id from f340)), 0::bigint,
  'and no points_ledger row either -- a rollup, never an Evaluation');

-- ==================== 3. The EMPTY-notify case ====================
-- Creator and actor are the same BCE, and 'edu' has no other local BCE in
-- this database. Every global BC/Moderator fallback candidate -- the seed's
-- two demo accounts AND this suite's own BC persona (#340...0001, already
-- used as an actor in section 2 and not needed again until section 6) -- is
-- the only thing standing between that and a literal empty set. All three
-- are deactivated here, for this one call, and restored immediately after
-- (this suite's own rolled-back transaction, so nothing outlives it).
update public.profiles set status = 'inactiv'
 where id in ('d0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000008',
             '34000000-0000-0000-0000-000000000001');

select pg_temp.test_login('34000000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.complete_umbrella_task(%s) $$,
  (select u2_id from f340)),
  'the same BCE completes their own Umbrella -- creator and actor coincide');
reset role;

update public.profiles set status = 'activ'
 where id in ('d0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000008',
             '34000000-0000-0000-0000-000000000001');

select is((select count(*) from public.notifications where task_id = (select u2_id from f340)), 0::bigint,
  'the EMPTY case: nobody is notified -- private.task_managers'' own creator/origin/fallback chain drops the actor at every step, and no other manager exists');

-- ==================== 4. Cross-task check: create_task refuses a completed Umbrella ====================
select pg_temp.test_login('34000000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.create_task('Subtask tarziu #340', 'd', now() + interval '7 days',
  null, null, null, null, null, null, null, %s, 'task') $$,
  (select u1_id from f340)),
  'PT409', 'parent_terminal',
  '#327''s create_task refuses a new Subtask under an Umbrella #340 just completed');
reset role;

-- ==================== 5. Cross-task check: reopening a Subtask flips the Umbrella back ====================
select pg_temp.test_login('34000000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.complete_umbrella_task(%s) $$,
  (select u3_id from f340)),
  'the Umbrella completes once its one Subtask is credited');
reset role;

select is((select task.status::text from public.tasks as task where task.id = (select u3_id from f340)),
  'completed', 'and is now completed');

select pg_temp.test_login('34000000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.reopen_task(%s, 'Trebuie revizuit') $$,
  (select s3_id from f340)),
  '#338''s reopen_task reverses the Subtask''s Evaluation');
reset role;

select is((select task.status::text from public.tasks as task where task.id = (select u3_id from f340)),
  'todo', '#338''s cascade flips the completed Umbrella back to todo -- #340''s own rollup is undone by the very reopen it made possible');

-- ==================== 6. Authority: denied ====================
select pg_temp.test_login('34000000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["pr"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.complete_umbrella_task(%s) $$,
  (select deny_umbrella_id from f340)),
  '42501', 'task_manage_forbidden', 'the BCE of another Department cannot complete an edu Umbrella');
reset role;

-- private.can_read_task's R6 (the only rule that admits an ordinary
-- Department member to a Task they neither manage nor work on) explicitly
-- requires `kind = 'task'` -- an Umbrella never qualifies, so an ordinary
-- member of the very Department that owns it cannot even SEE it, and gets
-- the same non-disclosing PT404 as someone outside the Department entirely.
select pg_temp.test_login('34000000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.complete_umbrella_task(%s) $$,
  (select deny_umbrella_id from f340)),
  'PT404', 'task_not_found',
  'an ordinary member of the Umbrella''s own Department cannot even see it -- private.can_read_task''s R6 opportunity rule explicitly excludes kind = umbrella');
reset role;

select pg_temp.test_login('34000000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["pr"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.complete_umbrella_task(%s) $$,
  (select hidden_umbrella_id from f340)),
  'PT404', 'task_not_found',
  'a pr member is told nothing at all about an edu Umbrella -- conventions Sec3 forbids distinguishing hidden from missing');
reset role;

-- Same R6 gap on the Project side: a plain 'member' project_role satisfies
-- neither R5 (lead/Responsible) nor R6 (kind = task only), so this Umbrella
-- is invisible to them too.
select pg_temp.test_login('34000000-0000-0000-0000-000000000009', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.complete_umbrella_task(%s) $$,
  (select proj_deny_umbrella_id from f340)),
  'PT404', 'task_not_found',
  'a plain Project member cannot see the Project''s Umbrella either -- the same R6 gap');
reset role;

select pg_temp.test_login('34000000-0000-0000-0000-000000000010', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.complete_umbrella_task(%s) $$,
  (select deny_umbrella_id from f340)),
  '42501', 'task_command_forbidden', 'a deactivated BC holding a still-valid level-6 token is stopped at the gate');
reset role;

select pg_temp.test_login('34000000-0000-0000-0000-000000000011', '{"provider":"email"}'::jsonb);
select throws_ok(format($$ select public.complete_umbrella_task(%s) $$,
  (select deny_umbrella_id from f340)),
  '42501', 'task_command_forbidden', 'a real uid without organisation claims is stopped at the gate too');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(format($$ select public.complete_umbrella_task(%s) $$,
  (select deny_umbrella_id from f340)),
  '42501', 'permission denied for function complete_umbrella_task',
  'anon cannot execute complete_umbrella_task at all -- the literal grant denial');
reset role;

select is((select format('%s|%s', task.status::text,
                         (select count(*) from public.task_activity as activity
                           where activity.task_id = task.id and activity.kind = 'umbrella_completed'))
             from public.tasks as task where task.id = (select deny_umbrella_id from f340)),
  'todo|0', 'after every denial the shared target is untouched: still todo, no umbrella_completed row');
select is((select count(*) from public.notifications where task_id = (select deny_umbrella_id from f340)),
  0::bigint, 'and a refused completion is SILENT');

-- ==================== 7. Authority: allowed ====================
-- The Independent-Team case is the one that separates MANAGING from
-- EVALUATING: the same member evaluates nothing under #336/#338.
select pg_temp.test_login('34000000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '["t-340-ind"]'::jsonb));
select lives_ok(format($$ select public.complete_umbrella_task(%s) $$,
  (select ind_umbrella_id from f340)),
  'an Independent Team''s own active member completes their Team''s Umbrella');
reset role;

select pg_temp.test_login('34000000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.complete_umbrella_task(%s) $$,
  (select proj_lead_umbrella_id from f340)),
  'an active Project''s lead completes an Umbrella on their Project');
reset role;

select pg_temp.test_login('34000000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.complete_umbrella_task(%s) $$,
  (select proj_resp_umbrella_id from f340)),
  'and so does a Responsible for anyone''s Umbrella but the lead''s own -- here, one they never worked on themselves');
reset role;

select is((select count(*) from public.tasks
            where id in ((select ind_umbrella_id from f340), (select proj_lead_umbrella_id from f340),
                        (select proj_resp_umbrella_id from f340))
              and status = 'completed'), 3::bigint,
  'all three allowed completions actually landed');

-- ==================== 8. Locks held while the command runs, and the deadlock it must NOT have ====================
-- Two Subtasks, both already terminal, under one committed Umbrella. Session
-- HOLD takes the SECOND Subtask FOR UPDATE -- exactly the lock
-- private.evaluate_task holds on a Subtask mid-Evaluation -- and the real
-- command is fired asynchronously so it can sit blocked reaching for both
-- Subtasks in its one `for share` statement. While blocked:
--   * the UMBRELLA already carries its step-3 lock, mode FOR NO KEY UPDATE;
--   * the FIRST Subtask is already locked FOR SHARE by that same statement
--     (LockRows locks each row as the scan produces it, so an earlier row is
--     held long before a later, contested one blocks the whole statement);
--   * the SECOND Subtask carries HOLD's FOR UPDATE, not the command's.
-- Then HOLD performs evaluate_task's OTHER lock acquisition -- the
-- parent-naming task_activity insert whose foreign key runs as
-- `select 1 from public.tasks where id = $1 for key share` on the Umbrella.
-- FOR KEY SHARE does not conflict with FOR NO KEY UPDATE, so it goes straight
-- through while the command holds the Umbrella; WOULD conflict with FOR
-- UPDATE, which is exactly the ABBA cycle Ruling 20 exists to avoid.
-- MUTATION-VERIFIED: with step 3 changed to `for update`, Postgres answers
-- one of the two backends with 40P01 -- see the task report for the captured
-- output of both runs.
select extensions.dblink_connect('cu_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));

-- Clean first (the #336/#338/#339 precedent): these fixtures are COMMITTED.
select extensions.dblink_exec('cu_setup', $$
  set session_replication_role = 'replica';
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#340 committed%');
  set session_replication_role = 'origin';
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#340 committed%')
      or member_id = '34000000-0000-0000-0000-000000000051';
  delete from public.tasks
   where parent_task_id in (select id from public.tasks where title like '%#340 committed%');
  delete from public.tasks where title like '%#340 committed%';
  delete from public.member_departments where member_id = '34000000-0000-0000-0000-000000000051';
  delete from auth.users where id = '34000000-0000-0000-0000-000000000051';
$$);

select extensions.dblink_exec('cu_setup', $$
  insert into auth.users (id, email) values
    ('34000000-0000-0000-0000-000000000051', 'probe.manager.340@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('34000000-0000-0000-0000-000000000051', 'Probe Manager 340', 'probe.manager.340@test.local', 'bce', 'activ');
  insert into public.member_departments (member_id, dept_id) values
    ('34000000-0000-0000-0000-000000000051', 'edu');

  insert into public.tasks
    (title, description, dept_id, kind, audience, assignment_mode, status, created_at, created_by)
  values ('Umbrela sonda #340 committed', 'Umbrela', 'edu', 'umbrella', null, null, 'todo',
          now() - interval '5 days', '34000000-0000-0000-0000-000000000051');

  insert into public.tasks
    (title, description, deadline, dept_id, audience, assignment_mode, status, parent_task_id,
     cancelled_at, cancel_reason, created_at, created_by)
  select 'Sonda subtask A #340 committed', 'Primul', now() + interval '10 days', 'edu', 'local', 'direct', 'cancelled',
         parent.id, now() - interval '1 day', 'Sonda', now() - interval '5 days', '34000000-0000-0000-0000-000000000051'
    from public.tasks as parent where parent.title = 'Umbrela sonda #340 committed';
  insert into public.tasks
    (title, description, deadline, dept_id, audience, assignment_mode, status, parent_task_id,
     cancelled_at, cancel_reason, created_at, created_by)
  select 'Sonda subtask B #340 committed', 'Al doilea', now() + interval '10 days', 'edu', 'local', 'direct', 'cancelled',
         parent.id, now() - interval '1 day', 'Sonda', now() - interval '5 days', '34000000-0000-0000-0000-000000000051'
    from public.tasks as parent where parent.title = 'Umbrela sonda #340 committed';
$$);

create temp table r340 as
select (select id from public.tasks where title = 'Umbrela sonda #340 committed') as probe_umbrella_id,
       (select id from public.tasks where title = 'Sonda subtask A #340 committed') as probe_sub_a_id,
       (select id from public.tasks where title = 'Sonda subtask B #340 committed') as probe_sub_b_id;
grant select on r340 to authenticated;

select ok((select probe_sub_a_id < probe_sub_b_id from r340),
  'the probe Subtasks were created in id order -- the unordered `for share` scan is expected to reach A before B on this fresh index');

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

-- Session HOLD owns the SECOND Subtask, standing in for private.evaluate_task.
select extensions.dblink_connect('cu_hold', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres application_name=cu_hold_340',
  current_database()));
select extensions.dblink_exec('cu_hold', $$
  begin;
  set local statement_timeout = '20s';
$$);
select * from extensions.dblink('cu_hold', format($$
  select task.status::text from public.tasks as task where task.id = %s for update
$$, (select probe_sub_b_id from r340))) as hold_sub_b(status text);

-- Session COMPLETE runs the real command, asynchronously, so it can sit blocked.
select extensions.dblink_connect('cu_complete', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres application_name=cu_complete_340',
  current_database()));
select extensions.dblink_exec('cu_complete', $$
  begin;
  set local statement_timeout = '20s';
  set local lock_timeout = '15s';
$$);
select * from extensions.dblink('cu_complete', format($$
  select set_config('request.jwt.claims', %L, true)
$$, jsonb_build_object(
      'sub', '34000000-0000-0000-0000-000000000051', 'role', 'authenticated',
      'app_metadata', jsonb_build_object('member_role', 'bce', 'member_level', 5,
        'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text))
  as remote_claims(setting text);
select extensions.dblink_exec('cu_complete', 'set local role authenticated');
-- Single-field `(f(...)).status` projection on purpose: two fields would run
-- the command twice (the wave's standing warning).
select extensions.dblink_send_query('cu_complete', format($$
  select (public.complete_umbrella_task(%s)).status::text
$$, (select probe_umbrella_id from r340)));

select ok(pg_temp.wait_until_blocked('cu_complete_340'),
  'the command has taken the Umbrella lock, locked the first Subtask, and is now waiting for the second, which session HOLD owns');

select ok(exists (
  select 1
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_umbrella_id from r340)
), '(a) the UMBRELLA row is locked at all while the command is blocked');
select is((
  select row_lock.modes
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_umbrella_id from r340)
), array['For No Key Update'],
  '(b) and, given it is locked, its mode is exactly FOR NO KEY UPDATE -- never For Update, which would deadlock against private.evaluate_task''s implicit FK For Key Share on the same row');
select is((
  select row_lock.modes
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_sub_a_id from r340)
), array['For Share'],
  'and the FIRST Subtask already carries the command''s own FOR SHARE lock -- read-only, taken by the same statement that is now blocked on the second row');
select is((
  select row_lock.modes
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_sub_b_id from r340)
), array['For Update'],
  'while the SECOND Subtask carries HOLD''s FOR UPDATE, standing in for private.evaluate_task -- not the command''s own FOR SHARE, which is exactly why the command is blocked');

-- The assertion section 8's header is about: evaluate_task's parent-naming
-- insert must go straight through while the command holds the Umbrella.
select lives_ok(format($outer$ select extensions.dblink_exec('cu_hold', %L) $outer$,
  format($$
    insert into public.task_activity (task_id, kind, actor_id, from_status, to_status, details)
    values (%s, 'subtask_completed', '34000000-0000-0000-0000-000000000051', null, null,
            jsonb_build_object('probe', '340 deadlock'))
  $$, (select probe_umbrella_id from r340))),
  'evaluate_task''s parent-naming insert -- an implicit FK FOR KEY SHARE on the Umbrella -- goes straight through while the command holds that Umbrella and waits on this very session''s Subtask: FOR NO KEY UPDATE does not conflict with FOR KEY SHARE, and FOR UPDATE would deadlock (40P01) here');

-- A deadlock propagates out of extensions.dblink_get_result and cannot be
-- caught in plain SQL, and under the mutation the command is one of the two
-- backends that may be aborted -- so it is caught here and turned into a
-- value the assertion can diff.
create function pg_temp.cu_complete_result()
returns text
language plpgsql
as $fn$
declare
  v_status text;
begin
  select remote.status into v_status
    from extensions.dblink_get_result('cu_complete') as remote(status text);
  return coalesce(v_status, '(no row)');
exception when others then
  return sqlstate;
end;
$fn$;

select extensions.dblink_exec('cu_hold', 'rollback');
select extensions.dblink_disconnect('cu_hold');
select is(pg_temp.cu_complete_result(), 'completed',
  'and once HOLD lets go the command finishes normally, never with a 40P01 -- the weaker lock mode costs it nothing, and both Subtasks were already terminal');
select extensions.dblink_exec('cu_complete', 'rollback');
select extensions.dblink_disconnect('cu_complete');

-- ==================== 9. The command is not the only write path (yet) ====================
-- public.tasks itself is still directly writable by level >= 4 through the
-- legacy tasks_update_legacy policy (#345 retires it) -- no assertion here
-- would discriminate anything, so none is made (the #339 precedent). The two
-- history tables ARE already stopped by table privileges.
select pg_temp.test_login('34000000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ insert into public.task_evaluations
  (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
  values (%s, null, '34000000-0000-0000-0000-000000000002', 'completed', 3, 4, 3, 'incercare directa') $$,
  (select u1_id from f340)),
  '42501', 'permission denied for table task_evaluations',
  'a manager cannot write an Evaluation onto an Umbrella by hand -- table grants stop it before RLS is consulted');
select throws_ok(format($$ insert into public.points_ledger (member_id, delta, reason, task_id)
  values ('34000000-0000-0000-0000-000000000002', 5, 'task', %s) $$,
  (select u1_id from f340)),
  '42501', 'new row violates row-level security policy for table "points_ledger"',
  'nor credit points directly -- ledger_sanction is the only insert policy authenticated holds, and it requires reason = sanction');
reset role;

-- ==================== 10. The committed fixtures leave no trace ====================
select extensions.dblink_exec('cu_setup', $$
  set session_replication_role = 'replica';
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#340 committed%');
  set session_replication_role = 'origin';
  delete from public.notifications
   where task_id in (select id from public.tasks where title like '%#340 committed%')
      or member_id = '34000000-0000-0000-0000-000000000051';
  delete from public.tasks
   where parent_task_id in (select id from public.tasks where title like '%#340 committed%');
  delete from public.tasks where title like '%#340 committed%';
  delete from public.member_departments where member_id = '34000000-0000-0000-0000-000000000051';
  delete from auth.users where id = '34000000-0000-0000-0000-000000000051';
$$);
select extensions.dblink_disconnect('cu_setup');

select * from finish();
rollback;
