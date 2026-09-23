-- #341: public.duplicate_task -- clone a Task into a brand-new todo Task with
-- a fresh deadline. ADR-0007's motivating case is a called-off or unfinished
-- Task run again without retyping it, but any status -- including completed
-- -- is a legitimate template, so this suite duplicates a cancelled source
-- (the headline case), a completed one (to prove Difficulty/Rating never
-- carry over even when the source actually has them) and a Subtask (to prove
-- the clone is always top-level).
--
-- What this suite pins that no earlier suite does:
--   * public.tasks.duplicated_from_task_id and the fact that
--     tasks_with_overdue carries it (the `select task.*` view-expansion trap
--     #339/#340 already documented -- verified fresh against this branch's
--     own pg_get_viewdef, not copied);
--   * the Campaign carry-over rule: copied only when still active, silently
--     dropped otherwise -- never a PT400, because the caller did not ask
--     about the Campaign at all;
--   * that a clone of a Subtask is TOP-LEVEL, not re-parented under the
--     source's Umbrella -- this command has no Umbrella-authority step, so
--     there is nothing to validate a new parent against;
--   * that duplicating is a MANAGER act on the SOURCE, exactly like #339's
--     cancel_task, and needs no Evaluator authority at all;
--   * that the source's own row is never mutated -- duplicating leaves its
--     status, cancel_reason and every lifecycle timestamp exactly as they
--     were, the two `task_activity` rows are its only trace;
--   * zero notifications -- this command sends none, and that absence is
--     asserted, not merely unasserted;
--   * the LOCK STRENGTH: the source is locked plain FOR UPDATE, never FOR NO
--     KEY UPDATE -- this command takes no second lock on any other row, so
--     the ABBA risk #339's rule exists for never arises here.
--
-- Fixture prefix 34100000-0000-0000-0000-0000000000NN throughout, resolved as
-- the owner into a temp table before any persona logs in (the #328 trap,
-- stack-context.md carry-forwards). The committed lock-probe fixtures use
-- 34100000-...-0000000000[5]N and carry '#341 committed' in their titles.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(75);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('34100000-0000-0000-0000-000000000001', 'bc.341@test.local'),
  ('34100000-0000-0000-0000-000000000002', 'bce.edu.341@test.local'),
  ('34100000-0000-0000-0000-000000000003', 'bce.pr.341@test.local'),
  ('34100000-0000-0000-0000-000000000004', 'member.edu.341@test.local'),
  ('34100000-0000-0000-0000-000000000005', 'ind.team.341@test.local'),
  ('34100000-0000-0000-0000-000000000006', 'proj.lead.341@test.local'),
  ('34100000-0000-0000-0000-000000000007', 'proj.responsible.341@test.local'),
  ('34100000-0000-0000-0000-000000000008', 'proj.member.341@test.local'),
  ('34100000-0000-0000-0000-000000000009', 'inactive.bc.341@test.local'),
  ('34100000-0000-0000-0000-000000000010', 'claimless.341@test.local'),
  ('34100000-0000-0000-0000-000000000011', 'exec.history.341@test.local'),
  ('34100000-0000-0000-0000-000000000012', 'candidate.history.341@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('34100000-0000-0000-0000-000000000001', 'BC 341', 'bc.341@test.local', 'bc', 'activ'),
  ('34100000-0000-0000-0000-000000000002', 'BCE EDU 341', 'bce.edu.341@test.local', 'bce', 'activ'),
  ('34100000-0000-0000-0000-000000000003', 'BCE PR 341', 'bce.pr.341@test.local', 'bce', 'activ'),
  ('34100000-0000-0000-0000-000000000004', 'Membru EDU 341', 'member.edu.341@test.local', 'voluntar', 'activ'),
  ('34100000-0000-0000-0000-000000000005', 'Membru Echipa Independenta 341', 'ind.team.341@test.local', 'voluntar', 'activ'),
  ('34100000-0000-0000-0000-000000000006', 'Lead Proiect 341', 'proj.lead.341@test.local', 'voluntar', 'activ'),
  ('34100000-0000-0000-0000-000000000007', 'Responsabil Proiect 341', 'proj.responsible.341@test.local', 'voluntar', 'activ'),
  ('34100000-0000-0000-0000-000000000008', 'Membru Proiect 341', 'proj.member.341@test.local', 'voluntar', 'activ'),
  ('34100000-0000-0000-0000-000000000009', 'BC Inactiv 341', 'inactive.bc.341@test.local', 'bc', 'inactiv'),
  ('34100000-0000-0000-0000-000000000010', 'Fara Claimuri 341', 'claimless.341@test.local', 'voluntar', 'activ'),
  ('34100000-0000-0000-0000-000000000011', 'Executor Istoric 341', 'exec.history.341@test.local', 'voluntar', 'activ'),
  ('34100000-0000-0000-0000-000000000012', 'Candidat Istoric 341', 'candidate.history.341@test.local', 'voluntar', 'activ');

insert into pg_temp.fixture_member_departments (member_id, dept_id) values
  ('34100000-0000-0000-0000-000000000002', 'edu'),
  ('34100000-0000-0000-0000-000000000003', 'pr'),
  ('34100000-0000-0000-0000-000000000004', 'edu'),
  ('34100000-0000-0000-0000-000000000011', 'edu'),
  ('34100000-0000-0000-0000-000000000012', 'edu');

insert into pg_temp.fixture_teams (id, name, dept_id) values
  ('t-341-ind', 'Echipa Independenta 341', null);
insert into pg_temp.fixture_team_members (team_id, member_id) values
  ('t-341-ind', '34100000-0000-0000-0000-000000000005');

insert into pg_temp.fixture_projects (name, status, leader_id, created_by) values
  ('Proiect #341', 'active',
   '34100000-0000-0000-0000-000000000006', '34100000-0000-0000-0000-000000000001');
insert into pg_temp.fixture_project_members (project_id, member_id, project_role) values
  ((select id from pg_temp.fixture_projects where name = 'Proiect #341'),
   '34100000-0000-0000-0000-000000000007', 'responsible'),
  ((select id from pg_temp.fixture_projects where name = 'Proiect #341'),
   '34100000-0000-0000-0000-000000000008', 'member');
-- #586: materialize this suite's legacy setup as rolled-back Group fixtures.
select pg_temp.materialize_legacy_groups();


insert into public.campaigns (group_id, name, is_active, created_by) values
  (pg_temp.dept_group('edu'), 'Campanie Activa #341', true, '34100000-0000-0000-0000-000000000002'),
  (pg_temp.dept_group('edu'), 'Campanie Ce Va Deveni Inactiva #341', true, '34100000-0000-0000-0000-000000000002');

-- ---- T1: the happy path. A cancelled, public, org edu Task carrying an
-- active Campaign, a historical ENDED Assignment and a historical CLOSED
-- Candidature -- neither may survive into the clone.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status,
   cancelled_at, cancel_reason, queue_opened_at, queue_closed_at, campaign_id,
   created_at, created_by)
select 'Sursa fericita #341', 'Se va clona', now() - interval '5 days', pg_temp.dept_group('edu'), 'org', 'public', 'cancelled',
       now() - interval '2 days', 'Motiv sursa #341', now() - interval '10 days', now() - interval '2 days',
       (select id from public.campaigns where name = 'Campanie Activa #341'),
       now() - interval '20 days', '34100000-0000-0000-0000-000000000002';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at, ended_at, end_reason)
select id, '34100000-0000-0000-0000-000000000011', '34100000-0000-0000-0000-000000000002',
       now() - interval '19 days', now() - interval '2 days', 'cancelled'
  from public.tasks where title = 'Sursa fericita #341';
insert into public.task_candidates (task_id, member_id, status, joined_at, decided_at, decided_by)
select id, '34100000-0000-0000-0000-000000000012', 'closed',
       now() - interval '18 days', now() - interval '2 days', '34100000-0000-0000-0000-000000000002'
  from public.tasks where title = 'Sursa fericita #341';

-- ---- U1/S1: the Subtask source -- its clone must be top-level.
insert into public.tasks
  (title, description, group_id, kind, audience, assignment_mode, status, created_at, created_by)
values ('Umbrela sursa #341', 'Umbrela', pg_temp.dept_group('edu'), 'umbrella', null, null, 'todo',
        now() - interval '10 days', '34100000-0000-0000-0000-000000000002');
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, parent_task_id,
   created_at, started_at, created_by)
select 'Subtask sursa #341', 'Sub umbrela', now() + interval '10 days', pg_temp.dept_group('edu'), 'local', 'direct',
       'in_progress', parent.id, now() - interval '9 days', now() - interval '8 days',
       '34100000-0000-0000-0000-000000000002'
  from public.tasks as parent where parent.title = 'Umbrela sursa #341';

-- ---- T2: an inactive-Campaign source -- clones with campaign_id null.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, campaign_id,
   created_at, created_by)
select 'Sursa campanie inactiva #341', 'Campanie dezactivata ulterior', now() + interval '10 days',
       pg_temp.dept_group('edu'), 'local', 'direct', 'todo',
       (select id from public.campaigns where name = 'Campanie Ce Va Deveni Inactiva #341'),
       now() - interval '5 days', '34100000-0000-0000-0000-000000000002';
-- Deactivated AFTER the Task above already carries it -- #314's trigger only
-- re-checks activity on a newly SET or CHANGED campaign_id, never on a
-- Campaign deactivated later out from under an untouched Task (its own
-- header, 20260911210600_task_campaign.sql:78-88).
update public.campaigns set is_active = false
 where group_id = pg_temp.dept_group('edu') and name = 'Campanie Ce Va Deveni Inactiva #341';

-- ---- T3: a COMPLETED source, Difficulty and Rating actually set -- proves
-- neither carries over even from a source that genuinely has them, and that
-- ANY status (not only cancelled/unfulfilled) is a legitimate template.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status,
   difficulty, rating, started_at, completed_at, created_at, created_by)
values
  ('Sursa finalizata #341', 'Deja incheiat', now() - interval '2 days', pg_temp.dept_group('edu'), 'local', 'direct', 'completed',
   3, 4, now() - interval '9 days', now() - interval '1 day', now() - interval '10 days',
   '34100000-0000-0000-0000-000000000002');

-- ---- T4: an Umbrella itself -- PT409 task_is_umbrella.
insert into public.tasks
  (title, description, group_id, kind, audience, assignment_mode, status, created_at, created_by)
values ('Umbrela tinta #341', 'Nu se poate clona', pg_temp.dept_group('edu'), 'umbrella', null, null, 'todo',
        now() - interval '5 days', '34100000-0000-0000-0000-000000000002');

-- ---- T5: the authority-matrix / null-deadline target.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, created_at, created_by)
values
  ('Tinta autoritate #341', 'Tinta pentru refuzuri', now() + interval '10 days', pg_temp.dept_group('edu'), 'local', 'direct', 'todo',
   now() - interval '5 days', '34100000-0000-0000-0000-000000000002');

-- ---- T6: a `local` pr Task an edu member cannot even see.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, created_at, created_by)
values
  ('Ascuns pr #341', 'Alt departament', now() + interval '10 days', pg_temp.dept_group('pr'), 'local', 'direct', 'todo',
   now() - interval '5 days', '34100000-0000-0000-0000-000000000003');

-- ---- T7: an Independent Team's own Task -- its own active member duplicates.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, created_at, created_by)
values
  ('Echipa independenta #341', 'Task de echipa', now() + interval '10 days', pg_temp.team_group('t-341-ind'), 'local', 'direct', 'todo',
   now() - interval '5 days', '34100000-0000-0000-0000-000000000001');

-- ---- T8/T9: Project Tasks.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, created_at, created_by)
select 'Proiect responsabil #341', 'Task de proiect', now() + interval '10 days',
       pg_temp.project_group(project.id), 'local', 'direct', 'todo'::public.task_status,
       now() - interval '5 days', '34100000-0000-0000-0000-000000000001'::uuid
  from pg_temp.fixture_projects as project where project.name = 'Proiect #341';
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, created_at, created_by)
select 'Proiect membru #341', 'Munca unui membru', now() + interval '10 days',
       pg_temp.project_group(project.id), 'local', 'direct', 'todo'::public.task_status,
       now() - interval '5 days', '34100000-0000-0000-0000-000000000001'::uuid
  from pg_temp.fixture_projects as project where project.name = 'Proiect #341';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select id, '34100000-0000-0000-0000-000000000008', '34100000-0000-0000-0000-000000000001',
       now() - interval '4 days'
  from public.tasks where title = 'Proiect membru #341';

-- ---- T10: the direct-write target.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, created_at, created_by)
values
  ('Scriere directa #341', 'Tinta', now() + interval '10 days', pg_temp.dept_group('edu'), 'local', 'direct', 'todo',
   now() - interval '5 days', '34100000-0000-0000-0000-000000000002');

-- ==================== Ids, resolved as the owner ====================
create temp table f341 as
select
  (select id from public.tasks where title = 'Sursa fericita #341') as happy_source_id,
  (select id from public.campaigns where name = 'Campanie Activa #341') as active_campaign_id,
  (select id from public.tasks where title = 'Umbrela sursa #341') as umbrella_source_id,
  (select id from public.tasks where title = 'Subtask sursa #341') as sub_source_id,
  (select id from public.tasks where title = 'Sursa campanie inactiva #341') as inactive_campaign_source_id,
  (select id from public.campaigns where name = 'Campanie Ce Va Deveni Inactiva #341') as inactive_campaign_id,
  (select id from public.tasks where title = 'Sursa finalizata #341') as completed_source_id,
  (select id from public.tasks where title = 'Umbrela tinta #341') as umbrella_target_id,
  (select id from public.tasks where title = 'Tinta autoritate #341') as authority_task_id,
  (select id from public.tasks where title = 'Ascuns pr #341') as hidden_task_id,
  (select id from public.tasks where title = 'Echipa independenta #341') as ind_team_task_id,
  (select id from public.tasks where title = 'Proiect responsabil #341') as proj_resp_task_id,
  (select id from public.tasks where title = 'Proiect membru #341') as proj_member_task_id,
  (select id from public.tasks where title = 'Scriere directa #341') as direct_write_task_id,
  9223372036854775807::bigint as missing_id;
-- anon too: the anon denial resolves an id through this table in its own
-- format() before the command is ever reached (the #337/#339 pattern).
grant select on f341 to authenticated, anon;

create temp table h341 as
select (select count(*) from public.task_activity)    as activity_rows,
       (select count(*) from public.task_assignments) as assignment_rows,
       (select count(*) from public.task_candidates)  as candidate_rows,
       (select count(*) from public.notifications)    as notification_rows;

-- ==================== 1. API shape and privileges ====================

select has_function('public', 'duplicate_task', array['bigint', 'timestamptz'],
  'public.duplicate_task exists with the pinned two-parameter signature');
select is(pg_get_function_identity_arguments(
    'public.duplicate_task(bigint, timestamptz)'::regprocedure),
  'p_task_id bigint, p_deadline timestamp with time zone',
  'duplicate_task exposes no actor parameter -- the actor is always auth.uid()');
select is(pg_get_function_result('public.duplicate_task(bigint, timestamptz)'::regprocedure),
  'tasks', 'duplicate_task returns the newly created clone');
select ok(not (select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public' and procedure.proname = 'duplicate_task'),
  'the public command is a security invoker wrapper');
select ok((select procedure.prosecdef
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'private' and procedure.proname = 'duplicate_task_impl'),
  'private.duplicate_task_impl runs as owner (security definer)');
select ok(coalesce((
    select 'search_path=""' = any(procedure.proconfig)
      from pg_proc as procedure
      join pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private' and procedure.proname = 'duplicate_task_impl'
  ), false), 'private.duplicate_task_impl pins an empty search_path');
select ok(has_function_privilege('authenticated',
  'public.duplicate_task(bigint, timestamptz)'::regprocedure, 'execute'),
  'authenticated can execute public.duplicate_task');
select ok(not has_function_privilege('anon',
  'public.duplicate_task(bigint, timestamptz)'::regprocedure, 'execute'),
  'anon cannot execute public.duplicate_task');
select ok(has_function_privilege('authenticated',
  'private.duplicate_task_impl(bigint, timestamptz)'::regprocedure, 'execute'),
  'authenticated can execute private.duplicate_task_impl');
select ok(not has_function_privilege('service_role',
  'public.duplicate_task(bigint, timestamptz)'::regprocedure, 'execute'),
  'service_role holds no execute on the wrapper either (conventions Sec4)');

-- ==================== 2. The column and the view ====================

select has_column('public', 'tasks', 'duplicated_from_task_id',
  'public.tasks records which Task a row was cloned from');
select has_column('public', 'tasks_with_overdue', 'duplicated_from_task_id',
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

-- ==================== 3. The happy path ====================
select pg_temp.test_login('34100000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.duplicate_task(%s, '2027-06-01 09:00:00+00') $$,
  (select happy_source_id from f341)),
  'the local BCE clones a cancelled public Task of their own Department');
reset role;

select is((select format('%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
                         clone.title, clone.description, (select legacy_dept_id from public.groups where id = clone.group_id), clone.audience,
                         clone.assignment_mode, clone.campaign_id::text, clone.kind, clone.status::text,
                         clone.deadline::text, clone.created_by::text,
                         (clone.parent_task_id is null)::text,
                         (clone.queue_opened_at is not null)::text,
                         clone.duplicated_from_task_id::text)
             from public.tasks as clone
            where clone.duplicated_from_task_id = (select happy_source_id from f341)),
  format('Sursa fericita #341|Se va clona|edu|org|public|%s|task|todo|2027-06-01 09:00:00+00|%s|true|true|%s',
         (select active_campaign_id from f341),
         '34100000-0000-0000-0000-000000000002',
         (select happy_source_id from f341)),
  'the clone shares title/description/Origin/audience/assignment_mode/the active Campaign, is kind=task, status=todo, carries the CALLER''s own deadline, created_by=the actor, no parent, an opened queue (public) and duplicated_from_task_id = the source');
select is((select format('%s|%s', (clone.difficulty is null)::text, (clone.rating is null)::text)
             from public.tasks as clone
            where clone.duplicated_from_task_id = (select happy_source_id from f341)),
  'true|true', 'the clone has no Difficulty and no Rating -- it has done none of the source''s work');
select is((select format('%s|%s|%s',
                         (clone.cancel_reason is null)::text,
                         (clone.cancelled_at is null)::text,
                         (clone.queue_closed_at is null)::text)
             from public.tasks as clone
            where clone.duplicated_from_task_id = (select happy_source_id from f341)),
  'true|true|true',
  'the clone inherits none of the source''s terminal markers -- no cancel_reason, no cancelled_at, and its freshly-opened queue is not already closed, even though the CANCELLED, queue-closed source genuinely carries all three');
select is((select count(*) from public.task_assignments as assignment
             join public.tasks as clone on clone.id = assignment.task_id
            where clone.duplicated_from_task_id = (select happy_source_id from f341)), 0::bigint,
  'the clone has no Executor -- the source''s ENDED Assignment is history, not a template');
select is((select count(*) from public.task_candidates as candidate
             join public.tasks as clone on clone.id = candidate.task_id
            where clone.duplicated_from_task_id = (select happy_source_id from f341)), 0::bigint,
  'and no Candidate either -- the source''s CLOSED Candidature is history too');

select is((select format('%s|%s|%s|%s|%s',
                         activity.kind, activity.actor_id::text,
                         (activity.assignment_id is null)::text,
                         (activity.from_status is null)::text, activity.to_status::text)
             from public.task_activity as activity
             join public.tasks as clone on clone.id = activity.task_id
            where clone.duplicated_from_task_id = (select happy_source_id from f341)
              and activity.kind = 'created'),
  format('created|%s|true|true|todo', '34100000-0000-0000-0000-000000000002'),
  'the clone gets its own created activity row: the actor, no assignment_id, no from_status, to todo');
select is((select activity.details ->> 'duplicated_from_task_id'
             from public.task_activity as activity
             join public.tasks as clone on clone.id = activity.task_id
            where clone.duplicated_from_task_id = (select happy_source_id from f341)
              and activity.kind = 'created'),
  (select happy_source_id::text from f341),
  'and details names the source it was cloned from');
select is((select format('%s|%s|%s|%s',
                         activity.actor_id::text,
                         (activity.assignment_id is null)::text,
                         (activity.from_status is null)::text,
                         (activity.to_status is null)::text)
             from public.task_activity as activity
            where activity.task_id = (select happy_source_id from f341)
              and activity.kind = 'duplicated'),
  format('%s|true|true|true', '34100000-0000-0000-0000-000000000002'),
  'the SOURCE gets a duplicated activity row too: the actor, no assignment_id, and no status change -- duplicating it changes nothing about its own state');
select is((select activity.details ->> 'clone_task_id'
             from public.task_activity as activity
            where activity.task_id = (select happy_source_id from f341)
              and activity.kind = 'duplicated'),
  (select clone.id::text from public.tasks as clone
    where clone.duplicated_from_task_id = (select happy_source_id from f341)),
  'and its details names the clone it produced');
select is((select format('%s|%s|%s',
                         task.status::text, task.cancel_reason,
                         (task.cancelled_at is not null)::text)
             from public.tasks as task where task.id = (select happy_source_id from f341)),
  'cancelled|Motiv sursa #341|true',
  'the SOURCE itself is never mutated: still cancelled, same reason, same timestamp');
select is((select count(*) from public.notifications
            where task_id in (
              (select happy_source_id from f341),
              (select clone.id from public.tasks as clone
                where clone.duplicated_from_task_id = (select happy_source_id from f341)))), 0::bigint,
  'duplicate_task sends no notification at all -- neither to the source nor about the clone');
select is((select count(*) from public.task_activity) - (select activity_rows from h341), 2::bigint,
  'exactly two activity rows were appended for the whole call: one on the clone, one on the source');
select is((select count(*) from public.task_assignments) - (select assignment_rows from h341), 0::bigint,
  'no Assignment row was added anywhere');
select is((select count(*) from public.task_candidates) - (select candidate_rows from h341), 0::bigint,
  'no Candidature row was added anywhere');

-- ==================== 4. A Subtask source clones top-level ====================
select pg_temp.test_login('34100000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.duplicate_task(%s, '2027-06-02 09:00:00+00') $$,
  (select sub_source_id from f341)),
  'the manager clones a Subtask');
reset role;

select is((select format('%s|%s|%s',
                         (clone.parent_task_id is null)::text, (select legacy_dept_id from public.groups where id = clone.group_id),
                         clone.duplicated_from_task_id::text)
             from public.tasks as clone
            where clone.duplicated_from_task_id = (select sub_source_id from f341)),
  format('true|edu|%s', (select sub_source_id from f341)),
  'the clone of a Subtask is TOP-LEVEL -- no parent_task_id, even though the source had an Umbrella -- but still inherits the Origin dept_id the Subtask itself carried');
select is((select count(*) from public.tasks
            where parent_task_id = (select umbrella_source_id from f341)), 1::bigint,
  'and the Umbrella''s own Subtask count is untouched -- the clone was never attached to it');
select is((select (clone.started_at is null)
             from public.tasks as clone
            where clone.duplicated_from_task_id = (select sub_source_id from f341)),
  true,
  'the clone has no started_at either, even though the in_progress Subtask source genuinely has one');

-- ==================== 5. An inactive Campaign clones with campaign_id null ====================
select is((select is_active from public.campaigns
            where id = (select inactive_campaign_id from f341)), false,
  'sanity: the fixture Campaign really is inactive');
select pg_temp.test_login('34100000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.duplicate_task(%s, '2027-06-03 09:00:00+00') $$,
  (select inactive_campaign_source_id from f341)),
  'the manager clones a Task whose Campaign has since been deactivated');
reset role;

select is((select clone.campaign_id
             from public.tasks as clone
            where clone.duplicated_from_task_id = (select inactive_campaign_source_id from f341)),
  null,
  'the clone carries NO Campaign -- #314''s trigger would reject a newly-set inactive one outright, so it is silently dropped instead of failing the whole clone');

-- ==================== 6. Any status is a legitimate template ====================
select pg_temp.test_login('34100000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.duplicate_task(%s, '2027-06-04 09:00:00+00') $$,
  (select completed_source_id from f341)),
  'a COMPLETED Task is just as legitimate a template as a cancelled one -- duplicate_task inspects only kind, never status');
reset role;

select is((select format('%s|%s|%s|%s|%s',
                         clone.status::text, (clone.difficulty is null)::text, (clone.rating is null)::text,
                         (clone.started_at is null)::text, (clone.completed_at is null)::text)
             from public.tasks as clone
            where clone.duplicated_from_task_id = (select completed_source_id from f341)),
  'todo|true|true|true|true',
  'the clone starts at todo with no Difficulty, Rating, started_at or completed_at, even though the COMPLETED source genuinely had difficulty=3, rating=4, started_at and completed_at all set');

-- ==================== 7. State precondition: an Umbrella cannot be a source ====================
select pg_temp.test_login('34100000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.duplicate_task(%s, '2027-06-05 09:00:00+00') $$,
  (select umbrella_target_id from f341)),
  'PT409', 'task_is_umbrella', 'an Umbrella cannot itself be duplicated');
reset role;
select is((select count(*) from public.tasks
            where duplicated_from_task_id = (select umbrella_target_id from f341)), 0::bigint,
  'and no clone was created from the refused attempt');
select is((select count(*) from public.task_activity
            where task_id = (select umbrella_target_id from f341)), 0::bigint,
  'nor was any activity row written on it');

-- ==================== 8. Input validation: a null deadline ====================
select pg_temp.test_login('34100000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.duplicate_task(%s, null) $$,
  (select authority_task_id from f341)),
  'PT400', 'deadline_required', 'a null deadline is rejected -- a clone with no deadline could never satisfy an ordinary Task''s own rule');
reset role;
select throws_ok($$ select public.duplicate_task(null, '2027-06-06 09:00:00+00') $$,
  'PT404', 'task_not_found',
  'a null Task id is the same non-disclosing answer, never PT400 (wave ruling)');
select throws_ok(format($$ select public.duplicate_task(%s, '2027-06-06 09:00:00+00') $$,
  (select missing_id from f341)),
  'PT404', 'task_not_found', 'an unknown Task id is not found either');

-- ==================== 9. Authority ====================
-- 9.1 denied
select pg_temp.test_login('34100000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["pr"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.duplicate_task(%s, '2027-06-07 09:00:00+00') $$,
  (select authority_task_id from f341)),
  '42501', 'task_manage_forbidden', 'the BCE of another Department cannot clone an edu Task -- they can READ it (R1), but not manage it');
reset role;
select pg_temp.test_login('34100000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.duplicate_task(%s, '2027-06-07 09:00:00+00') $$,
  (select authority_task_id from f341)),
  'PT404', 'task_not_found',
  'an ordinary member of the Origin Department is told nothing at all about a direct Task they never worked on -- conventions Sec3 forbids distinguishing hidden from missing');
select throws_ok(format($$ select public.duplicate_task(%s, '2027-06-07 09:00:00+00') $$,
  (select hidden_task_id from f341)),
  'PT404', 'task_not_found', 'and a Task in another Department is equally invisible');
reset role;
select pg_temp.test_login('34100000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.duplicate_task(%s, '2027-06-07 09:00:00+00') $$,
  (select proj_member_task_id from f341)),
  '42501', 'task_manage_forbidden',
  'a plain Project member cannot clone even the Task they are themselves executing -- being the Executor is not managing authority');
reset role;
select pg_temp.test_login('34100000-0000-0000-0000-000000000009', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.duplicate_task(%s, '2027-06-07 09:00:00+00') $$,
  (select authority_task_id from f341)),
  '42501', 'task_command_forbidden',
  'a deactivated BC holding a still-valid level-6 token is stopped at the gate');
reset role;
select pg_temp.test_login('34100000-0000-0000-0000-000000000010', '{"provider":"email"}'::jsonb);
select throws_ok(format($$ select public.duplicate_task(%s, '2027-06-07 09:00:00+00') $$,
  (select authority_task_id from f341)),
  '42501', 'task_command_forbidden', 'a real uid without organisation claims is stopped at the gate too');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(format($$ select public.duplicate_task(%s, '2027-06-07 09:00:00+00') $$,
  (select authority_task_id from f341)),
  '42501', 'permission denied for function duplicate_task',
  'anon cannot execute duplicate_task at all -- the literal grant denial');
reset role;

select is((select count(*) from public.tasks
            where duplicated_from_task_id in (
              (select authority_task_id from f341),
              (select hidden_task_id from f341),
              (select proj_member_task_id from f341))), 0::bigint,
  'none of the six denials produced a clone');
select is((select count(*) from public.task_activity
            where task_id in (
              (select authority_task_id from f341),
              (select hidden_task_id from f341),
              (select proj_member_task_id from f341))), 0::bigint,
  'nor any activity row on any of the refused sources');

-- 9.2 allowed. The Independent-Team case needs no Evaluator authority at all
-- -- duplicating awards nobody anything, exactly like #339's cancel_task.
select pg_temp.test_login('34100000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '["t-341-ind"]'::jsonb));
select lives_ok(format($$ select public.duplicate_task(%s, '2027-06-08 09:00:00+00') $$,
  (select ind_team_task_id from f341)),
  'an Independent Team''s own active member clones their Team''s Task');
reset role;
select pg_temp.test_login('34100000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.duplicate_task(%s, '2027-06-09 09:00:00+00') $$,
  (select proj_resp_task_id from f341)),
  'an active Project''s Responsible clones a Task on their Project');
reset role;
select pg_temp.test_login('34100000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.duplicate_task(%s, '2027-06-10 09:00:00+00') $$,
  (select proj_member_task_id from f341)),
  'and the Project lead clones the very Task the plain member was refused');
reset role;

select is((select count(*) from public.tasks
            where duplicated_from_task_id in (
              (select ind_team_task_id from f341),
              (select proj_resp_task_id from f341),
              (select proj_member_task_id from f341))), 3::bigint,
  'all three authorized clones were created');
select is((select count(*) from public.notifications
            where task_id in (
              select clone.id from public.tasks as clone
               where clone.duplicated_from_task_id in (
                  (select ind_team_task_id from f341),
                  (select proj_resp_task_id from f341),
                  (select proj_member_task_id from f341)))), 0::bigint,
  'and none of them sent any notification either');

-- ==================== 10. The command is the only write path ====================
select pg_temp.test_login('34100000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ insert into public.task_activity (task_id, kind, actor_id, details)
  values (%s, 'duplicated', '34100000-0000-0000-0000-000000000002', jsonb_build_object('clone_task_id', 1)) $$,
  (select direct_write_task_id from f341)),
  '42501', null, 'even the Task''s manager cannot fake a duplicated activity row by inserting directly');

-- #345 revoked insert/update/delete on public.tasks from authenticated, so a
-- direct write now dies on the table grant before any trigger runs.
select throws_ok(format($$ insert into public.tasks
  (title, deadline, group_id, audience, assignment_mode, duplicated_from_task_id)
  values ('Proveniență falsă #341', '2027-06-11 09:00:00+00', pg_temp.dept_group('edu'), 'local', 'direct', %s) $$,
  (select authority_task_id from f341)),
  '42501', 'permission denied for table tasks',
  'a manager cannot forge duplicate provenance on a direct Task insert -- since #345 the table grants refuse it outright');

select throws_ok(format($$ update public.tasks
  set duplicated_from_task_id = %s where id = %s $$,
  (select authority_task_id from f341), (select direct_write_task_id from f341)),
  '42501', 'permission denied for table tasks',
  'nor mark an existing Task as a clone by direct update');

select throws_ok(format($$ update public.tasks
  set duplicated_from_task_id = null
  where duplicated_from_task_id = %s $$,
  (select happy_source_id from f341)),
  '42501', 'permission denied for table tasks',
  'nor erase provenance from a genuine clone by direct update');

-- The provenance guard now sits BEHIND that grant, so no client statement can
-- reach it any more -- which is exactly why its continued existence has to be
-- asserted structurally instead. A future migration that hands direct DML back
-- to authenticated must find the trigger still there; deleting this assertion
-- because "nothing can reach it" is how the forgery path comes back.
-- (Exercising it for real would need a temporary GRANT plus a permissive
-- UPDATE policy, and both take an AccessExclusiveLock on public.tasks that
-- would deadlock this suite's own dblink lock probe below.)
select is(
  (select count(*)::int from pg_trigger as trigger_row
    where trigger_row.tgrelid = 'public.tasks'::regclass
      and trigger_row.tgname = 'tasks_duplicate_provenance_guard'
      and not trigger_row.tgisinternal
      and trigger_row.tgfoid = 'private.guard_task_duplicate_provenance()'::regprocedure),
  1,
  'and the provenance guard trigger is still installed behind that grant, for the day someone grants direct DML back');
reset role;

-- ==================== 11. The lock held while the command runs ====================
-- The source is locked plain FOR UPDATE and never written to -- unlike every
-- other command in this wave, duplicate_task's target row itself is not
-- mutated (only a brand-new clone row and two activity rows are), so
-- pgrowlocks reports the pure lock-only mode, never an updater mode.
-- MUTATION-VERIFIED: dropping the explicit `for update` from step 3 does NOT
-- leave the source unlocked -- the source's own `duplicated` activity row is
-- a referencing insert, and Postgres takes an implicit FOR KEY SHARE on the
-- row it references. Without the explicit lock, this probe goes RED with
-- `{"For Key Share"}` instead of `{"For Update"}`: a real, weaker mode that
-- would let a concurrent evaluate_task or give_up_task (which lock the same
-- row FOR UPDATE) proceed unserialized against this command. Restoring the
-- explicit FOR UPDATE turns it back GREEN. The exact array equality below
-- pins the stronger mode, so a future accidental weakening (or an
-- unnecessary strengthening to FOR NO KEY UPDATE -- see the migration header
-- for why that is not needed here) would also go RED.
select extensions.dblink_connect('dt_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
-- #621: committed fixtures from an interrupted run must not hang cleanup.
select extensions.dblink_exec('dt_setup', 'set lock_timeout = ''2s''');
select extensions.dblink_exec('dt_setup', $$
  delete from public.tasks where title like '%#341 committed%';
  delete from public.campaigns where name = 'Campanie blocaj #341 committed';
  delete from auth.users where id = '34100000-0000-0000-0000-000000000051';
  insert into auth.users (id, email) values
    ('34100000-0000-0000-0000-000000000051', 'probe.manager.341@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('34100000-0000-0000-0000-000000000051', 'Probe Manager 341', 'probe.manager.341@test.local', 'bce', 'activ');
  -- #586: committed race fixtures need an explicit native Group roster.
  insert into public.group_members(group_id,member_id,group_role)
  select g.id,md.member_id,case when p.role='bce' then 'manager' else 'member' end
    from (values ('34100000-0000-0000-0000-000000000051'::uuid, 'edu')) md(member_id,dept_id) join public.groups g on g.legacy_dept_id=md.dept_id
    join public.profiles p on p.id=md.member_id
   where md.member_id::text like '34100000-%'
  on conflict (group_id,member_id) do nothing;
  insert into public.campaigns (group_id, name, is_active, created_by) values
    ((select id from public.groups where legacy_dept_id = 'edu'), 'Campanie blocaj #341 committed', true, '34100000-0000-0000-0000-000000000051');
  insert into public.tasks
    (title, description, deadline, group_id, audience, assignment_mode, status, campaign_id, created_at, created_by)
  select 'Sonda blocaj #341 committed', 'Sonda', now() + interval '10 days', (select id from public.groups where legacy_dept_id = 'edu'), 'local', 'direct', 'todo',
         campaign.id, now() - interval '3 days', '34100000-0000-0000-0000-000000000051'
    from public.campaigns as campaign
   where campaign.name = 'Campanie blocaj #341 committed';
$$);

create temp table r341 as
select (select id from public.tasks where title = 'Sonda blocaj #341 committed') as probe_task_id,
       (select id from public.campaigns where name = 'Campanie blocaj #341 committed') as probe_campaign_id;
grant select on r341 to authenticated;

select extensions.dblink_connect('dt_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('dt_lock', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('dt_lock', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '34100000-0000-0000-0000-000000000051', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'bce', 'member_level', 5,
      'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text, true)
$$) as remote_claims(setting text);
select extensions.dblink_exec('dt_lock', 'set local role authenticated');
select * from extensions.dblink('dt_lock', format($$
  select (public.duplicate_task(%s, '2027-07-01 09:00:00+00')).status::text
$$, (select probe_task_id from r341))) as locked_dup(status text);

select is((
  select row_lock.modes
    from extensions.pgrowlocks('public.tasks') as row_lock
    join public.tasks as task on task.ctid = row_lock.locked_row
   where task.id = (select probe_task_id from r341)
), array['For Update'],
  'the SOURCE row is held in exactly FOR UPDATE, and only that -- the command inserts a new clone and two activity rows, but never writes the source itself');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.campaigns') as row_lock
    join public.campaigns as campaign on campaign.ctid = row_lock.locked_row
   where campaign.id = (select probe_campaign_id from r341)
), false), 'an active inherited Campaign is held FOR SHARE until the clone commits, so concurrent deactivation cannot make carry-over fail nondeterministically');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.profiles') as row_lock
    join public.profiles as profile on profile.ctid = row_lock.locked_row
   where profile.id = '34100000-0000-0000-0000-000000000051'
), false), 'duplicate_task holds the actor''s live profile row FOR SHARE (private.require_group_work_manager''s discipline)');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.group_members') as row_lock
    join public.group_members as membership on membership.ctid = row_lock.locked_row
    join public.groups as authority_group on authority_group.id = membership.group_id
   where membership.member_id = '34100000-0000-0000-0000-000000000051'
     and authority_group.legacy_dept_id = 'edu'
), false), 'and the Group roster row its authority rests on FOR SHARE too, since a BCE (unlike BC/Moderator) reaches that branch');

select extensions.dblink_exec('dt_lock', 'rollback');
select extensions.dblink_disconnect('dt_lock');

select extensions.dblink_exec('dt_setup', $$
  delete from public.task_activity
   where task_id in (select id from public.tasks where title like '%#341 committed%')
      or task_id in (select id from public.tasks where duplicated_from_task_id in (
          select id from public.tasks where title like '%#341 committed%'));
  delete from public.tasks
   where duplicated_from_task_id in (select id from public.tasks where title like '%#341 committed%');
  delete from public.tasks where title like '%#341 committed%';
  delete from public.campaigns where name = 'Campanie blocaj #341 committed';
  delete from auth.users where id = '34100000-0000-0000-0000-000000000051';
$$);
select extensions.dblink_disconnect('dt_setup');

select is((select count(*) from public.tasks where title like '%#341 committed%'), 0::bigint,
  'the committed lock-probe fixture is removed again -- this suite leaves no trace');
select is((select count(*) from public.profiles
            where id = '34100000-0000-0000-0000-000000000051'), 0::bigint,
  'including the persona it ran as');


-- #521: Group authority regression matrix.
\ir _group_task_fixtures.psql
reset role;
select pg_temp.g521_task('command0','project',5,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select lives_ok($$select public.duplicate_task((select id from g521_tasks where name='command0'),now()+interval '1 day')$$,'duplicate_task: Group persona 2 on executor 5 in project');
reset role;
select pg_temp.g521_task('command1','project',4,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select throws_ok($$select public.duplicate_task((select id from g521_tasks where name='command1'),now()+interval '1 day')$$,'42501','task_manage_forbidden','duplicate_task: Group persona 3 on executor 4 in project');
reset role;
select pg_temp.g521_task('command2','ind',7,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(6));
select lives_ok($$select public.duplicate_task((select id from g521_tasks where name='command2'),now()+interval '1 day')$$,'duplicate_task: Group persona 6 on executor 7 in ind');
reset role;
select pg_temp.g521_task('command3','dt',5,'todo','direct');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(8));
select throws_ok($$select public.duplicate_task((select id from g521_tasks where name='command3'),now()+interval '1 day')$$,'42501','task_manage_forbidden','duplicate_task: Group persona 8 on executor 5 in dt');
reset role;

select ok(not exists(select 1 from public.tasks clone join public.tasks source on source.id=clone.duplicated_from_task_id where clone.group_id is distinct from source.group_id),'every clone preserves the source Group');
select * from finish();
rollback;
