-- rls_task_history_read.test.sql — #319: who reads which row of the four
-- Task history tables (task_assignments #289, task_candidates #291,
-- task_activity #292, task_evaluations #316) under
-- 20260911211200_task_history_read_policies.sql, plus the
-- public.task_queue_summary candidate-privacy view.
--
-- Rule recap (see the migration header for the ADR-0007 citations):
--   own row: member_id (assignments/candidates), actor_id (activity),
--            evaluated_by (evaluations) — decision (c): NOT the Executor
--            being evaluated;
--   private.can_manage_task(task_id): every row, all four tables;
--   private.is_global_task_reader() (live role level >= 5): every row, all
--            four tables — decision (a), for #260's drill-down;
--   private.is_task_team_member(task_id): task_activity ONLY — decision (b),
--            the ADR's literal "complete Task Activity for their Team";
--   private.is_own_assignment(assignment_id): task_activity and
--            task_evaluations ONLY — Ruling 13 (fix round 1): the Executor
--            reads feedback about their own Assignment (started/submitted/
--            returned_to_progress/evaluated/reopened, and their Evaluation),
--            current or former, without gaining the Task's whole timeline —
--            a candidate-queue row (assignment_id null) never matches.
-- Every branch is additionally gated by private.can_read_task(task_id).
--
-- Fix round 1, Important 2: the deactivated persona and the sweep's
-- well-known claimless uid (eeeeeeee-0000-0000-0000-000000000156, following
-- the completed_work_requests precedent in rls_deny_by_default.test.sql)
-- each get an Assignment and a Candidature of their own on Task M below, so
-- a mutation hoisting the own-row check out of the auth_is_member()/
-- can_read_task conjunction is caught by an assertion here instead of
-- passing silently for lack of a fixture row to expose.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(63);

-- ==================== Shape ====================
select policies_are('public', 'task_assignments', array['task_assignments_read'],
  'task_assignments carries exactly the #319 read policy');
select policies_are('public', 'task_candidates', array['task_candidates_read'],
  'task_candidates carries exactly the #319 read policy');
select policies_are('public', 'task_activity', array['task_activity_read'],
  'task_activity carries exactly the #319 read policy');
select policies_are('public', 'task_evaluations', array['task_evaluations_read'],
  'task_evaluations carries exactly the #319 read policy');

select has_view('public', 'task_queue_summary', 'task_queue_summary exists');

select ok(
  (select 'security_invoker=on' = any(c.reloptions)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'task_queue_summary'),
  'task_queue_summary is security_invoker (conventions §4 default)');

select is(
  (select count(*)
     from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name in ('task_assignments', 'task_candidates', 'task_activity', 'task_evaluations')
      and g.grantee = 'authenticated'
      and g.privilege_type = 'SELECT'),
  4::bigint,
  'authenticated holds SELECT on all four history tables now that a read policy exists');

select is(
  (select count(*)
     from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name in ('task_assignments', 'task_candidates', 'task_activity',
                            'task_evaluations', 'task_queue_summary')
      and g.grantee = 'anon'),
  0::bigint,
  'anon holds no grant on any of the four tables or the view');

-- Important 1 (fix round 1): task_queue_summary is auto-updatable on
-- task_id, and the original revoke covered only public/anon — leaving
-- authenticated with inherited INSERT/UPDATE/DELETE and service_role with
-- all four. PostgREST would have exposed PATCH/DELETE on a view with no
-- meaningful primary key of its own.
select is(
  (select count(*)
     from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name = 'task_queue_summary'
      and g.grantee in ('authenticated', 'service_role')
      and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0::bigint,
  'Important 1: authenticated and service_role hold no INSERT/UPDATE/DELETE on task_queue_summary');

select is(
  (select count(*)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('is_global_task_reader', 'is_task_team_member',
                        'queue_position', 'pending_candidate_count')
      and p.prosecdef
      and p.provolatile = 's'
      and 'search_path=""' = any(p.proconfig)),
  4::bigint,
  'the four new helpers are stable security definer functions with an empty search_path');

select is(
  (select count(*)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('is_global_task_reader', 'is_task_team_member',
                        'queue_position', 'pending_candidate_count')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  4::bigint,
  'authenticated may execute all four new helpers (the security_invoker view runs them as the caller)');

select is(
  (select count(*)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('is_global_task_reader', 'is_task_team_member',
                        'queue_position', 'pending_candidate_count')
      and (has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('service_role', p.oid, 'execute')
        or has_function_privilege('public', p.oid, 'execute'))),
  0::bigint,
  'anon, service_role and PUBLIC may execute none of the four new helpers');

-- ==================== Fixtures — prefix 31900000-… (#319) ====================
create temp table fx_persona_319 (
  code    text primary key,
  id      uuid not null unique,
  role    public.member_role not null,
  status  public.member_status not null,
  dept_id text
);
insert into fx_persona_319 (code, id, role, status, dept_id) values
  ('executor',          '31900000-0000-0000-0000-000000000001', 'voluntar', 'activ',   'edu'),
  ('team_member',       '31900000-0000-0000-0000-000000000002', 'voluntar', 'activ',   null),
  ('bystander',         '31900000-0000-0000-0000-000000000003', 'voluntar', 'activ',   null),
  ('candidate1',        '31900000-0000-0000-0000-000000000004', 'voluntar', 'activ',   'edu'),
  ('candidate2',        '31900000-0000-0000-0000-000000000005', 'voluntar', 'activ',   'edu'),
  ('manager_bce_local', '31900000-0000-0000-0000-000000000006', 'bce',      'activ',   'edu'),
  ('bce_foreign',       '31900000-0000-0000-0000-000000000007', 'bce',      'activ',   'fin'),
  ('stranger',          '31900000-0000-0000-0000-000000000008', 'voluntar', 'activ',   null),
  ('deactivated_bce',   '31900000-0000-0000-0000-000000000009', 'bce',      'inactiv', 'edu'),
  -- Fix round 1, Important 2: the sweep's well-known claimless uid, not a
  -- fresh 319-prefixed one — see the header comment.
  ('claimless_member',  'eeeeeeee-0000-0000-0000-000000000156', 'voluntar', 'activ',   'edu'),
  ('task_m_candidate',  '31900000-0000-0000-0000-000000000011', 'voluntar', 'activ',   'edu'),
  -- Ruling 13: a second Executor on Task R, so a former Executor's own
  -- (reversed) Evaluation is distinguishable from their successor's.
  ('successor_executor', '31900000-0000-0000-0000-000000000012', 'voluntar', 'activ',  'edu');

insert into auth.users (id, email)
select persona.id, 'm319.' || persona.code || '@test.local' from fx_persona_319 as persona;
insert into public.profiles (id, full_name, email, role, status)
select persona.id, 'M319 ' || persona.code, 'm319.' || persona.code || '@test.local',
       persona.role, persona.status
  from fx_persona_319 as persona;
insert into public.member_departments (member_id, dept_id)
select persona.id, persona.dept_id from fx_persona_319 as persona where persona.dept_id is not null;

insert into public.teams (id, name, dept_id) values ('m319-dt', 'M319 Department Team', 'edu');
insert into public.team_members (team_id, member_id)
select 'm319-dt', persona.id from fx_persona_319 as persona where persona.code = 'team_member';

-- Task M — Department 'edu' origin, direct, completed: managed by
-- manager_bce_local, executed by executor, evaluated by manager_bce_local.
-- One task_activity row per actor, so "own row" (actor_id) and
-- "can_manage_task"/"is_global_task_reader" are distinguishable.
insert into public.tasks (title, dept_id, difficulty) values ('m319:M', 'edu', 3);
update public.tasks set status = 'completed', completed_at = now(), rating = 4
 where title = 'm319:M';

insert into public.task_assignments (task_id, member_id, assigned_at, assigned_by, ended_at, end_reason)
select task.id, persona.id, now() - interval '2 days',
       (select id from fx_persona_319 where code = 'manager_bce_local'),
       now(), 'completed'
  from public.tasks as task, fx_persona_319 as persona
 where task.title = 'm319:M' and persona.code = 'executor';

-- Ruling 13 (fix round 1): assignment_id is stamped on every row about the
-- Executor's own work — submitted/returned_to_progress/evaluated — as the
-- command wave (#334-#338) must, per the migration header's consequence
-- note. 'returned_to_progress' in particular is the ADR-0007 "Feedback
-- pending" sub-state: its actor is the reviewer, not the Executor, so only
-- the new private.is_own_assignment branch (not actor_id) lets the Executor
-- read it.
insert into public.task_activity (task_id, kind, actor_id, assignment_id, from_status, to_status, occurred_at)
select task.id, 'submitted', persona.id,
       (select assignment.id from public.task_assignments as assignment
         where assignment.task_id = task.id and assignment.member_id = persona.id),
       'in_progress', 'in_review', now() - interval '2 days'
  from public.tasks as task, fx_persona_319 as persona
 where task.title = 'm319:M' and persona.code = 'executor';
insert into public.task_activity (task_id, kind, actor_id, assignment_id, from_status, to_status, occurred_at)
select task.id, 'returned_to_progress', reviewer.id,
       (select assignment.id
          from public.task_assignments as assignment, fx_persona_319 as executor_p
         where assignment.task_id = task.id
           and assignment.member_id = executor_p.id
           and executor_p.code = 'executor'),
       'in_review', 'in_progress', now() - interval '1 day'
  from public.tasks as task, fx_persona_319 as reviewer
 where task.title = 'm319:M' and reviewer.code = 'manager_bce_local';
insert into public.task_activity (task_id, kind, actor_id, assignment_id, from_status, to_status, occurred_at)
select task.id, 'evaluated', persona.id,
       (select assignment.id
          from public.task_assignments as assignment, fx_persona_319 as executor_p
         where assignment.task_id = task.id
           and assignment.member_id = executor_p.id
           and executor_p.code = 'executor'),
       'in_review', 'completed', now()
  from public.tasks as task, fx_persona_319 as persona
 where task.title = 'm319:M' and persona.code = 'manager_bce_local';
-- A candidate-queue event on the same Task, assignment_id left null by
-- construction (the migration header's discipline) — proves the Executor's
-- new assignment-scoped branch does not leak it (Ruling 13's third required
-- test: "the Executor does not see interest_expressed rows of candidates on
-- their Task").
insert into public.task_activity (task_id, kind, actor_id, occurred_at)
select task.id, 'interest_expressed', persona.id, now() - interval '3 days'
  from public.tasks as task, fx_persona_319 as persona
 where task.title = 'm319:M' and persona.code = 'task_m_candidate';

insert into public.task_evaluations
  (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
select task.id, assignment.id, evaluator.id, 'completed', 3, 4, 12, 'm319 fixture evaluation'
  from public.tasks as task
  join public.task_assignments as assignment on assignment.task_id = task.id
  join fx_persona_319 as assignee on assignee.id = assignment.member_id and assignee.code = 'executor'
  cross join (select id from fx_persona_319 where code = 'manager_bce_local') as evaluator
 where task.title = 'm319:M';

-- A candidature on the same managed Task, so manager_bce_local's "all four
-- tables for one managed Task" is provable directly (a real command would
-- never queue a candidate on a direct-mode Task; the table has no such
-- constraint by design — see 20260911210400_task_candidates.sql's header —
-- so this is a fixture-only shape, not a claim about command behaviour).
insert into public.task_candidates (task_id, member_id)
select task.id, persona.id
  from public.tasks as task, fx_persona_319 as persona
 where task.title = 'm319:M' and persona.code = 'task_m_candidate';

-- Important 2 (fix round 1): the deactivated persona and the sweep's
-- claimless uid each get an Assignment and a Candidature of their own here
-- — see the header comment for why this is what catches the own-row
-- mutation.
insert into public.task_assignments (task_id, member_id, assigned_at, assigned_by, ended_at, end_reason)
select task.id, persona.id, now() - interval '30 days',
       (select id from fx_persona_319 where code = 'manager_bce_local'),
       now() - interval '29 days', 'gave_up'
  from public.tasks as task, fx_persona_319 as persona
 where task.title = 'm319:M' and persona.code in ('deactivated_bce', 'claimless_member');

insert into public.task_candidates (task_id, member_id)
select task.id, persona.id
  from public.tasks as task, fx_persona_319 as persona
 where task.title = 'm319:M' and persona.code in ('deactivated_bce', 'claimless_member');

-- Task Q — Department 'edu' origin, public, org-wide, open queue: the
-- candidate-privacy demo. Two pending Candidates in join order.
insert into public.tasks (title, dept_id, audience, assignment_mode, queue_opened_at)
values ('m319:Q', 'edu', 'org', 'public', now());
insert into public.task_candidates (task_id, member_id, joined_at)
select task.id, persona.id, now() - interval '2 minutes'
  from public.tasks as task, fx_persona_319 as persona
 where task.title = 'm319:Q' and persona.code = 'candidate1';
insert into public.task_candidates (task_id, member_id, joined_at)
select task.id, persona.id, now() - interval '1 minute'
  from public.tasks as task, fx_persona_319 as persona
 where task.title = 'm319:Q' and persona.code = 'candidate2';

-- Hidden — Department 'fin' origin, local audience, direct: unreadable to
-- the 'edu' candidates and to the plain stranger.
insert into public.tasks (title, dept_id, audience, assignment_mode)
values ('m319:Hidden', 'fin', 'local', 'direct');

-- Task T — Department-Team 'm319-dt' origin (parent dept 'edu'), direct,
-- in progress: bystander is the Executor; team_member is a Team member but
-- neither the actor nor the manager nor a global reader.
insert into public.tasks (title, team_id, status)
values ('m319:T', 'm319-dt', 'in_progress');
insert into public.task_assignments (task_id, member_id, assigned_at, assigned_by)
select task.id, persona.id, now() - interval '1 hour',
       (select id from fx_persona_319 where code = 'manager_bce_local')
  from public.tasks as task, fx_persona_319 as persona
 where task.title = 'm319:T' and persona.code = 'bystander';
insert into public.task_activity (task_id, kind, actor_id, from_status, to_status, occurred_at)
select task.id, 'started', persona.id, 'todo', 'in_progress', now() - interval '1 hour'
  from public.tasks as task, fx_persona_319 as persona
 where task.title = 'm319:T' and persona.code = 'bystander';

-- Task R — Department 'edu' origin, reopened after grading: 'executor' was
-- replaced by 'successor_executor', whose own Evaluation later completed
-- it. Ruling 13's second required test: a former Executor still reads
-- their own (now reversed) Evaluation via private.is_own_assignment, since
-- that matches the Assignment row itself, not "the currently active one" —
-- but not their successor's, whose assignment_id names a different row.
insert into public.tasks (title, dept_id, difficulty) values ('m319:R', 'edu', 2);
update public.tasks set status = 'completed', completed_at = now(), rating = 5
 where title = 'm319:R';

insert into public.task_assignments (task_id, member_id, assigned_at, assigned_by, ended_at, end_reason)
select task.id, persona.id, now() - interval '10 days',
       (select id from fx_persona_319 where code = 'manager_bce_local'),
       now() - interval '8 days', 'replaced'
  from public.tasks as task, fx_persona_319 as persona
 where task.title = 'm319:R' and persona.code = 'executor';
insert into public.task_assignments (task_id, member_id, assigned_at, assigned_by, ended_at, end_reason)
select task.id, persona.id, now() - interval '7 days',
       (select id from fx_persona_319 where code = 'manager_bce_local'),
       now(), 'completed'
  from public.tasks as task, fx_persona_319 as persona
 where task.title = 'm319:R' and persona.code = 'successor_executor';

-- The former Executor's Evaluation, reversed when the Task was reopened —
-- reversal does not affect private.is_own_assignment, which reads the
-- Assignment row, not the Evaluation's live/reversed state.
insert into public.task_evaluations
  (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note,
   evaluated_at, reversed_at, reversed_by, reversal_reason)
select task.id, assignment.id, evaluator.id, 'completed', 2, 3, 6,
       'm319 former executor evaluation',
       now() - interval '9 days', now() - interval '8 days', evaluator.id, 'reopened for rework'
  from public.tasks as task
  join public.task_assignments as assignment on assignment.task_id = task.id
  join fx_persona_319 as assignee on assignee.id = assignment.member_id and assignee.code = 'executor'
  cross join (select id from fx_persona_319 where code = 'manager_bce_local') as evaluator
 where task.title = 'm319:R';

-- The successor's own, still-open Evaluation on the same Task.
insert into public.task_evaluations
  (task_id, assignment_id, evaluated_by, outcome, difficulty, rating, points, note)
select task.id, assignment.id, evaluator.id, 'completed', 2, 5, 10,
       'm319 successor evaluation'
  from public.tasks as task
  join public.task_assignments as assignment on assignment.task_id = task.id
  join fx_persona_319 as assignee on assignee.id = assignment.member_id and assignee.code = 'successor_executor'
  cross join (select id from fx_persona_319 where code = 'manager_bce_local') as evaluator
 where task.title = 'm319:R';

create temp table fx_task_319 as
select task.id, substr(task.title, 6) as title
  from public.tasks as task
 where task.title like 'm319:%';
grant select on fx_task_319 to authenticated;
grant select on fx_persona_319 to authenticated;

create function pg_temp.task_id_319(p_title text)
returns bigint
language sql stable
as $$ select id from pg_temp.fx_task_319 where title = p_title $$;

create function pg_temp.login_319(p_code text)
returns void
language plpgsql
as $$
begin
  perform pg_temp.test_login_leadership(
    (select id from pg_temp.fx_persona_319 where code = p_code));
end;
$$;

-- Probes: persona codes visible in each table for a given Task, and the
-- queue-summary row for a given Task, both run as the calling role so RLS
-- decides the answer.
create function pg_temp.visible_assignment_codes(p_title text) returns setof text
language sql stable as $$
  select persona.code
    from public.task_assignments as assignment
    join pg_temp.fx_persona_319 as persona on persona.id = assignment.member_id
   where assignment.task_id = pg_temp.task_id_319(p_title)
$$;
create function pg_temp.visible_candidate_codes(p_title text) returns setof text
language sql stable as $$
  select persona.code
    from public.task_candidates as candidate
    join pg_temp.fx_persona_319 as persona on persona.id = candidate.member_id
   where candidate.task_id = pg_temp.task_id_319(p_title)
$$;
create function pg_temp.visible_activity_kinds(p_title text) returns setof text
language sql stable as $$
  select activity.kind
    from public.task_activity as activity
   where activity.task_id = pg_temp.task_id_319(p_title)
$$;
create function pg_temp.visible_evaluation_notes(p_title text) returns setof text
language sql stable as $$
  select evaluation.note
    from public.task_evaluations as evaluation
   where evaluation.task_id = pg_temp.task_id_319(p_title)
$$;
create function pg_temp.queue_summary_row(p_title text)
returns table(pending_count integer, my_position integer)
language sql stable as $$
  select summary.pending_count, summary.my_position
    from public.task_queue_summary as summary
   where summary.task_id = pg_temp.task_id_319(p_title)
$$;
-- security definer: an administrative fixture lookup, not an RLS probe —
-- unlike visible_assignment_codes above, this must bypass task_assignments
-- RLS so it still resolves the id after the caller has switched role to
-- authenticated (fix round 2, D4 below needs the id while logged in as the
-- deactivated persona).
create function pg_temp.assignment_id_319(p_code text, p_title text)
returns bigint
language sql stable
security definer as $$
  select assignment.id
    from public.task_assignments as assignment
    join pg_temp.fx_persona_319 as persona on persona.id = assignment.member_id
   where persona.code = p_code
     and assignment.task_id = pg_temp.task_id_319(p_title)
$$;

-- ==================== Executor ====================
-- Own assignment; the activity they caused PLUS the reviewer's
-- returned_to_progress/evaluated rows on their own Assignment (Ruling 13,
-- fix round 1: private.is_own_assignment) but not the candidate's
-- interest_expressed row on the same Task (assignment_id null); their own
-- Evaluation via the same new branch (decision (c)'s evaluated_by branch
-- still would not admit it — this is a separate branch); no Candidature.
select pg_temp.login_319('executor');
select set_eq('select * from pg_temp.visible_assignment_codes(''M'')', array['executor'],
  'Executor sees their own Assignment on Task M');
select set_eq('select * from pg_temp.visible_activity_kinds(''M'')',
  array['submitted', 'returned_to_progress', 'evaluated'],
  'Ruling 13: Executor sees every activity row tied to their own Assignment — the reviewer''s returned_to_progress and evaluated rows included, via private.is_own_assignment, not just the submitted row they themself caused');
select ok(
  not exists (select 1 from pg_temp.visible_activity_kinds('M') as kind where kind = 'interest_expressed'),
  'Ruling 13: Executor does not see the candidate''s interest_expressed row (assignment_id null) on their own Task');
select set_eq('select * from pg_temp.visible_evaluation_notes(''M'')', array['m319 fixture evaluation'],
  'Ruling 13: Executor now reads their own Evaluation via private.is_own_assignment, though decision (c)''s evaluated_by branch alone still would not admit it');
select is_empty('select * from pg_temp.visible_candidate_codes(''M'')',
  'Executor has no Candidature to see on Task M');

-- ==================== Former/successor Executor Evaluation (Ruling 13) ====================
-- Task R: a former Executor reads their own (now reversed) Evaluation, not
-- their successor's, and vice versa — private.is_own_assignment matches the
-- Assignment row itself, not "whichever is currently active".
select set_eq('select * from pg_temp.visible_evaluation_notes(''R'')',
  array['m319 former executor evaluation'],
  'Ruling 13: former Executor reads their own reversed Evaluation, not their successor''s');

reset role;
select pg_temp.login_319('successor_executor');
select set_eq('select * from pg_temp.visible_evaluation_notes(''R'')',
  array['m319 successor evaluation'],
  'Ruling 13: successor Executor reads their own Evaluation, not the former Executor''s reversed one');

-- ==================== Candidate privacy (Task Q) ====================
reset role;
select pg_temp.login_319('candidate1');
select set_eq('select * from pg_temp.visible_candidate_codes(''Q'')', array['candidate1'],
  'candidate1 sees only their own Candidature row, not candidate2''s');
select results_eq('select * from pg_temp.queue_summary_row(''Q'')',
  $$ values (2, 1) $$,
  'candidate1: pending_count 2, own position 1 (joined first)');
select is_empty('select * from pg_temp.queue_summary_row(''Hidden'')',
  'task_queue_summary has no row for a Task candidate1 cannot read');

reset role;
select pg_temp.login_319('candidate2');
select set_eq('select * from pg_temp.visible_candidate_codes(''Q'')', array['candidate2'],
  'candidate2 sees only their own Candidature row, not candidate1''s');
select results_eq('select * from pg_temp.queue_summary_row(''Q'')',
  $$ values (2, 2) $$,
  'candidate2: pending_count 2, own position 2 (joined second)');

-- ==================== Manager (local BCE) ====================
-- Sees all four tables for Tasks it manages: Task M's Assignment, both
-- activity rows, the Evaluation, and its own candidate row; Task Q's both
-- Candidatures (own department).
reset role;
select pg_temp.login_319('manager_bce_local');
select set_eq('select * from pg_temp.visible_assignment_codes(''M'')',
  array['executor', 'deactivated_bce', 'claimless_member'],
  'manager: sees every Assignment of the managed Task, including the two fixture-only rows added for Important 2''s mutation test');
select set_eq('select * from pg_temp.visible_activity_kinds(''M'')',
  array['submitted', 'returned_to_progress', 'evaluated', 'interest_expressed'],
  'manager: sees every activity row of the managed Task, not just their own');
select set_eq('select * from pg_temp.visible_evaluation_notes(''M'')', array['m319 fixture evaluation'],
  'manager: sees the managed Task''s Evaluation');
select set_eq('select * from pg_temp.visible_candidate_codes(''M'')',
  array['task_m_candidate', 'deactivated_bce', 'claimless_member'],
  'manager: sees every Candidature of the managed Task, including the two fixture-only rows added for Important 2''s mutation test — all four tables for one managed Task');
select set_eq('select * from pg_temp.visible_candidate_codes(''Q'')', array['candidate1', 'candidate2'],
  'manager: sees every Candidate of another Task in the same managed Department, identities included');

-- ==================== Global reader (foreign BCE, decision (a)) ====================
-- Reads every row of all four tables without managing anything (fin BCE,
-- edu/team Tasks) — unlike the manager, purely through is_global_task_reader.
reset role;
select pg_temp.login_319('bce_foreign');
select is(private.can_manage_task(pg_temp.task_id_319('M')), false,
  'sanity: the foreign BCE does not manage Task M');
select set_eq('select * from pg_temp.visible_assignment_codes(''M'')',
  array['executor', 'deactivated_bce', 'claimless_member'],
  'global reader: every Assignment of Task M, including the two fixture-only rows added for Important 2''s mutation test');
select set_eq('select * from pg_temp.visible_activity_kinds(''M'')',
  array['submitted', 'returned_to_progress', 'evaluated', 'interest_expressed'],
  'global reader: every activity row of Task M');
select set_eq('select * from pg_temp.visible_evaluation_notes(''M'')', array['m319 fixture evaluation'],
  'global reader: Task M''s Evaluation');
select set_eq('select * from pg_temp.visible_candidate_codes(''Q'')', array['candidate1', 'candidate2'],
  'global reader: every Candidate of Task Q, identities included');
select set_eq('select * from pg_temp.visible_assignment_codes(''T'')', array['bystander'],
  'global reader: decision (a) reaches task_assignments on a Team-origin Task too, unlike a plain Team member');
select set_eq('select * from pg_temp.visible_activity_kinds(''T'')', array['started'],
  'global reader: Task T''s activity');

-- ==================== Team member (decision (b)) ====================
-- Sees complete task_activity for the Team's Task, but not the Assignment
-- of a fellow Team member on the same Task — narrower reading, no
-- Team-member branch on the other three tables.
reset role;
select pg_temp.login_319('team_member');
select is(private.can_manage_task(pg_temp.task_id_319('T')), false,
  'sanity: a Department-Team member does not manage the Team''s planned work');
select set_eq('select * from pg_temp.visible_activity_kinds(''T'')', array['started'],
  'decision (b): Team member sees complete Task Activity for their Team''s Task');
select is_empty('select * from pg_temp.visible_assignment_codes(''T'')',
  'decision (b): Team member does NOT see a fellow Team member''s Assignment — no Team branch on task_assignments');

-- ==================== Stranger ====================
-- Reads Task Q (an org-wide Opportunity, R6) but none of its Candidate
-- identities — only the aggregate count through the view.
reset role;
select pg_temp.login_319('stranger');
select is_empty('select * from pg_temp.visible_assignment_codes(''M'')',
  'stranger: no Assignment on Task M');
select is_empty('select * from pg_temp.visible_activity_kinds(''M'')',
  'stranger: no activity on Task M');
select is_empty('select * from pg_temp.visible_evaluation_notes(''M'')',
  'stranger: no Evaluation on Task M');
select is_empty('select * from pg_temp.visible_candidate_codes(''Q'')',
  'stranger: reads Task Q (an eligible org-wide Opportunity) but no Candidate identity on it');
select results_eq('select * from pg_temp.queue_summary_row(''Q'')',
  $$ values (2, null::integer) $$,
  'stranger: sees the pending count through the view, but no position (not a candidate)');
select is_empty('select * from pg_temp.visible_assignment_codes(''T'')',
  'stranger: not a Team member, no Assignment on Task T');
select is_empty('select * from pg_temp.visible_activity_kinds(''T'')',
  'stranger: not a Team member, no activity on Task T either — decision (b) does not extend to non-members');

-- ==================== Deactivated member with stale claims ====================
reset role;
select pg_temp.login_319('deactivated_bce');
select is_empty('select * from pg_temp.visible_assignment_codes(''M'')',
  'Important 2: deactivated BCE with stale bce/level-5 claims owns an Assignment on Task M (fixture above) but still sees none — the own-row branch stays inside the auth_is_member()/can_read_task conjunction');
select is_empty('select * from pg_temp.visible_activity_kinds(''M'')',
  'deactivated BCE with stale claims: no activity on Task M');
select is_empty('select * from pg_temp.visible_evaluation_notes(''M'')',
  'deactivated BCE with stale claims: no Evaluation on Task M');
select is_empty('select * from pg_temp.visible_candidate_codes(''M'')',
  'Important 2: deactivated BCE owns a Candidature on Task M (fixture above) but still sees none');
select is_empty('select * from pg_temp.queue_summary_row(''Q'')',
  'deactivated BCE with stale claims: no row in task_queue_summary for Task Q');
select is(private.is_own_assignment(pg_temp.assignment_id_319('deactivated_bce', 'M')), false,
  'fix round 2 (D4): private.is_own_assignment is false standalone for a deactivated member''s own Assignment, called directly with their own stale-claims session, not merely masked by the can_read_task conjunction at the policy level');

-- ==================== Claimless session (real uid, no org claims) ====================
reset role;
select pg_temp.test_login(
  (select id from fx_persona_319 where code = 'claimless_member'),
  '{"provider": "email"}'::jsonb);
select is_empty('select * from pg_temp.visible_assignment_codes(''M'')',
  'Important 2: claimless session owns an Assignment on Task M (the sweep''s well-known uid, fixture above) but still sees none — same conjunction proof as the deactivated persona');
select is_empty('select * from pg_temp.visible_candidate_codes(''M'')',
  'Important 2: claimless session owns a Candidature on Task M but still sees none');
select is_empty('select * from pg_temp.visible_candidate_codes(''Q'')',
  'claimless session: no Candidature on Task Q');
select is_empty('select * from pg_temp.queue_summary_row(''Q'')',
  'claimless session: no row in task_queue_summary for Task Q');

-- ==================== anon ====================
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select count(*) from public.task_assignments $$, '42501', null,
  'anon: no privilege on task_assignments at all');
select throws_ok($$ select count(*) from public.task_candidates $$, '42501', null,
  'anon: no privilege on task_candidates at all');
select throws_ok($$ select count(*) from public.task_activity $$, '42501', null,
  'anon: no privilege on task_activity at all');
select throws_ok($$ select count(*) from public.task_evaluations $$, '42501', null,
  'anon: no privilege on task_evaluations at all');
select throws_ok($$ select count(*) from public.task_queue_summary $$, '42501', null,
  'anon: no privilege on task_queue_summary at all');

reset role;

-- #521: Group authority regression matrix.
\ir _group_task_fixtures.psql
select pg_temp.g521_task('private','project',5);
select pg_temp.g521_task('team','dt',10);
insert into public.task_activity(task_id,kind,actor_id) select id,'created',pg_temp.g521_uid(1) from g521_tasks;
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(5));
select is((select count(*) from public.task_activity where task_id=(select id from g521_tasks where name='private')),0::bigint,'ordinary Project Executor does not gain unrelated full activity with shared visibility off');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(8));
select is((select count(*) from public.task_activity where task_id=(select id from g521_tasks where name='team')),1::bigint,'Child Group membership retains complete shared Task activity');
reset role;

select * from finish();
rollback;
