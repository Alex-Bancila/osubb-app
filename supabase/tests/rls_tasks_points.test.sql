-- rls_tasks_points.test.sql — Epic 3.3 policies, per-role (tasks/points subset
-- of Epic 6.1; the suite grows with each policy epic).
-- Runs in one transaction and rolls back — leaves no residue in the local db.
--
-- #318: who reads which Task is proven persona by persona in
-- rls_tasks_read_matrix.test.sql. The Task counts below follow that rule
-- (own Tasks, eligible Opportunities, Team Tasks, global BCE/BC/Moderator);
-- they no longer encode the legacy one (JWT level >= 4 reads everything,
-- JWT Department membership reads the whole Department).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(35);

-- A session that authenticated but carries no org claims: never invited, or
-- deactivated since the token was issued. The claims hook stamps member_role
-- only for an `activ` profile, so a deactivated member's next token looks
-- exactly like this — real `sub`, no org claims (ADR-0003 gate 2).

-- ==================== Fixtures (as postgres) ====================
-- The demo seed (5.2) fills these tables on every reset, and the assertions
-- below count rows exactly — "a voluntar sees three tasks" is only meaningful
-- about this file's fixtures. Clear them inside the transaction, which rolls
-- back at the end, so the suite describes its own world and stays stable
-- however the demo data grows.
truncate tasks, task_assignees, task_requests, points_ledger cascade;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000011', 'vlad.rls@test.local'),
  ('b0000000-0000-0000-0000-000000000012', 'bianca.rls@test.local'),
  ('c0000000-0000-0000-0000-000000000013', 'radu.rls@test.local'),
  ('d0000000-0000-0000-0000-000000000014', 'bogdan.bc.rls@test.local');
insert into profiles (id, full_name, email, role) values
  ('a0000000-0000-0000-0000-000000000011', 'Vlad Voluntar EDU',  'vlad.rls@test.local',      'voluntar'),
  ('b0000000-0000-0000-0000-000000000012', 'Bianca Voluntar PR', 'bianca.rls@test.local',    'voluntar'),
  ('c0000000-0000-0000-0000-000000000013', 'Radu Responsabil',   'radu.rls@test.local',      'responsabil'),
  ('d0000000-0000-0000-0000-000000000014', 'Bogdan BC',          'bogdan.bc.rls@test.local', 'bc');
insert into member_departments (member_id, dept_id) values
  ('a0000000-0000-0000-0000-000000000011', 'edu'),
  ('b0000000-0000-0000-0000-000000000012', 'pr'),
  ('c0000000-0000-0000-0000-000000000013', 'edu');
insert into teams (id, name, dept_id) values ('t-x', 'Team X', 'pr');
insert into team_members (team_id, member_id)
  values ('t-x', 'b0000000-0000-0000-0000-000000000012');

insert into tasks (title, difficulty, dept_id)          values ('t-edu',  3, 'edu');
insert into tasks (title, difficulty, dept_id)          values ('t-edu2', 2, 'edu');
insert into tasks (title, difficulty, dept_id)          values ('t-pr',   2, 'pr');
insert into tasks
  (title, difficulty, dept_id, status, audience, assignment_mode, queue_opened_at)
  values ('t-open', 1, 'pr', 'todo', 'org', 'public', now());
insert into tasks (title, difficulty, team_id)          values ('t-team', 1, 't-x');
insert into task_assignees (task_id, member_id)
  select id, 'a0000000-0000-0000-0000-000000000011'::uuid from tasks where title = 't-edu';
insert into task_assignees (task_id, member_id)
  select id, 'b0000000-0000-0000-0000-000000000012'::uuid from tasks where title = 't-pr';
-- #312: rating may only be set once completed (tasks_evaluation_inputs_ck).
update tasks set status = 'completed', completed_at = now(), rating = 4 where title = 't-edu';   -- Vlad +6
update tasks set status = 'completed', completed_at = now(), rating = 3 where title = 't-pr';    -- Bianca +2
-- #318: a member's own Tasks are read through Assignment History
-- (task_assignments), not the legacy join table. Mirror the two legacy
-- assignees exactly as the #290 backfill does for a completed Task: one
-- Assignment ended 'completed' at completed_at.
insert into task_assignments (task_id, member_id, assigned_at, ended_at, end_reason)
select task.id, legacy.member_id, task.created_at, task.completed_at, 'completed'
  from task_assignees as legacy
  join tasks as task on task.id = legacy.task_id
 where task.title in ('t-edu', 't-pr');
-- #317: the credit is an Evaluation plus the ledger row that names it, not a
-- side effect of the Rating update above.
select pg_temp.test_credit_task(task.id, legacy.member_id,
                                'd0000000-0000-0000-0000-000000000014')
  from task_assignees as legacy
  join tasks as task on task.id = legacy.task_id
 where task.title in ('t-edu', 't-pr');
-- Captured while postgres can still see every row: an `insert … select …
-- from tasks` attempt would insert zero rows once the persona cannot read
-- the Task — no rows, no policy check, no exception.
create temp table fx_ids as
  select (select id from tasks where title = 't-edu2') as edu2_id;
grant select on fx_ids to authenticated;
insert into task_requests (kind, title, from_member, dept_id) values
  ('award', 'req-a', 'a0000000-0000-0000-0000-000000000011', 'edu'),
  ('award', 'req-b', 'b0000000-0000-0000-0000-000000000012', 'pr');

-- ==================== Vlad: voluntar, edu, no team ====================
select pg_temp.test_login('a0000000-0000-0000-0000-000000000011', jsonb_build_object(
    'member_role', 'voluntar',
    'member_level', 1,
    'dept_ids', '["edu"]'::jsonb,
    'team_ids', '[]'::jsonb
  ));

-- t-edu (his own, completed) and t-open (an org-wide Opportunity); not
-- t-edu2 — a Department Task that is neither his nor an Opportunity.
select is((select count(*) from tasks), 2::bigint,
  'voluntar sees their own Task and the org-wide Opportunity, not every Department Task');
select is((select count(*) from task_assignees ta
            join tasks t on t.id = ta.task_id where t.title = 't-edu'), 1::bigint,
  'assignees of a visible task are visible');
select is((select count(*) from task_assignees ta
            join tasks t on t.id = ta.task_id where t.title = 't-pr'), 0::bigint,
  'assignees of a hidden task are hidden');

select lives_ok(
  $$ select claim_open_task((select id from tasks where title = 't-open')) $$,
  'a member may claim an open task through the atomic command');
select throws_ok(
  $$ insert into task_assignees (task_id, member_id)
     select id, 'b0000000-0000-0000-0000-000000000012'::uuid
       from tasks where title = 't-open' $$,
  '42501', null, 'claiming on behalf of someone else is denied');
select throws_ok(
  format($$ insert into task_assignees (task_id, member_id)
            values (%s, 'a0000000-0000-0000-0000-000000000011') $$,
         (select edu2_id from fx_ids)),
  '42501', null, 'claiming a non-open Department task by direct insert is denied');

select is((select count(*) from points_ledger), 1::bigint,
  'voluntar sees only their own ledger rows');
select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, awarded_by)
     values ('a0000000-0000-0000-0000-000000000011', 99, 'manual_award',
             'a0000000-0000-0000-0000-000000000011') $$,
  -- #162: no INSERT policy admits reason <> 'sanction', so RLS denies this
  -- before the row ever reaches the reason CHECK constraint.
  '42501', null, 'a voluntar cannot create retired manual awards');

select is((select count(*) from task_requests), 1::bigint,
  'voluntar sees only their own requests');
select lives_ok(
  $$ insert into task_requests (kind, title, from_member, dept_id)
     values ('new_task', 'req-a2', 'a0000000-0000-0000-0000-000000000011', 'edu') $$,
  'any member may file their own pending request');
select throws_ok(
  $$ insert into task_requests (kind, title, from_member, dept_id)
     values ('award', 'req-forged', 'b0000000-0000-0000-0000-000000000012', 'pr') $$,
  '42501', null, 'filing a request as someone else is denied');
select throws_ok(
  $$ insert into task_requests (kind, title, from_member, dept_id, status)
     values ('award', 'req-preapproved', 'a0000000-0000-0000-0000-000000000011',
             'edu', 'approved') $$,
  '42501', null, 'filing a pre-approved request is denied');

update task_requests set status = 'approved' where title = 'req-a';
select is((select status from task_requests where title = 'req-a'),
  'pending'::request_status, 'a voluntar cannot decide requests (silent no-op)');

reset role;

-- ==================== Radu: responsabil (level 4), edu ====================
select pg_temp.test_login('c0000000-0000-0000-0000-000000000013', jsonb_build_object(
    'member_role', 'responsabil',
    'member_level', 4,
    'dept_ids', '["edu"]'::jsonb,
    'team_ids', '[]'::jsonb
  ));

-- The organisation role Responsabil is not a global reader (#318): only
-- t-open, still an org-wide Opportunity after Vlad's legacy claim.
select is((select count(*) from tasks), 1::bigint,
  'a Responsabil (level 4) reads only the org-wide Opportunity, not every task');
-- #318 split the legacy FOR ALL task_write so it no longer answers SELECT;
-- a direct UPDATE therefore reaches only rows tasks_read admits.
update tasks set description = 'touched by a responsabil' where title = 't-edu2';
-- #312: rating may only be set once completed, and 't-open' is public-mode,
-- so completing it also closes its queue (tasks_queue_timestamp_state_check).
-- #317: recording the Rating is all this statement does now — no ledger row
-- follows it, which is the point of the two assertions below.
select lives_ok(
  $$ update tasks set status = 'completed', completed_at = now(),
            queue_closed_at = now(), rating = 5
     where title = 't-open' $$,
  'level >= 4 records a Rating on a Task they may write');

select is((select count(*) from points_ledger
            where member_id = 'a0000000-0000-0000-0000-000000000011'), 0::bigint,
  'level >= 4 cannot read another member''s ledger, even in their department');
select is((select count(*) from points_ledger
            where member_id = 'b0000000-0000-0000-0000-000000000012'), 0::bigint,
  'other departments'' ledgers stay hidden at level 4');

select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, awarded_by)
     values ('a0000000-0000-0000-0000-000000000011', 5, 'manual_award',
             'c0000000-0000-0000-0000-000000000013') $$,
  '42501', null, 'a responsabil cannot create retired manual awards');
select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, note, awarded_by)
     values ('a0000000-0000-0000-0000-000000000011', -5, 'sanction', 'test sanction',
             'c0000000-0000-0000-0000-000000000013') $$,
  '42501', null, 'sanctions below level 6 are denied');
select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, awarded_by)
     values ('a0000000-0000-0000-0000-000000000011', 5, 'manual_award',
             'a0000000-0000-0000-0000-000000000011') $$,
  '42501', null, 'retired manual awards remain unavailable even with a forged author');

update task_requests
   set status = 'approved', decided_by = 'c0000000-0000-0000-0000-000000000013'
 where title = 'req-a';
select is((select status from task_requests where title = 'req-a'),
  'approved'::request_status, 'level >= 4 decides own-dept requests');
update task_requests
   set status = 'rejected', decided_by = 'c0000000-0000-0000-0000-000000000013'
 where title = 'req-b';

reset role;

select is((select description from tasks where title = 't-edu2'), null,
  'a Responsabil''s legacy direct update skips a Task they cannot read (silent no-op)');

-- ==================== Bogdan: bc (level 6), no dept claims ====================
select pg_temp.test_login('d0000000-0000-0000-0000-000000000014', jsonb_build_object(
    'member_role', 'bc',
    'member_level', 6,
    'dept_ids', '[]'::jsonb,
    'team_ids', '[]'::jsonb
  ));

-- Two credits, not three: Radu's Rating on 't-open' above paid nobody,
-- because #317 retired the trigger that used to. Only the two Evaluations
-- written explicitly with the fixtures exist.
select is((select count(*) from points_ledger), 2::bigint,
  'level >= 6 reads the whole ledger, and a Rating with no Evaluation added nothing to it');
select lives_ok(
  $$ insert into points_ledger (member_id, delta, reason, note, awarded_by)
     values ('b0000000-0000-0000-0000-000000000012', -3, 'sanction', 'test sanction',
             'd0000000-0000-0000-0000-000000000014') $$,
  'BC may sanction');                                     -- Bianca −3
select is((select count(*) from task_requests), 3::bigint,
  'level >= 6 sees every request');
select is((select status from task_requests where title = 'req-b'),
  'pending'::request_status, 'deciding outside your dept was a silent no-op');
select is((select count(*) from tasks), 5::bigint,
  'BC sees every task');

reset role;

-- ==================== Bianca: voluntar, pr, team t-x ====================
select pg_temp.test_login('b0000000-0000-0000-0000-000000000012', jsonb_build_object(
    'member_role', 'voluntar',
    'member_level', 1,
    'dept_ids', '["pr"]'::jsonb,
    'team_ids', '["t-x"]'::jsonb
  ));

-- t-team (her Team's) and t-pr (her own); not t-open, whose queue closed
-- when Radu graded it, and not other Department Tasks.
select is((select count(*) from tasks), 2::bigint,
  'team member sees their Team''s Task and their own, not every Department Task');
select is((select count(*) from points_ledger), 2::bigint,
  'a member sees their own sanction (transparency)');

reset role;

-- ==================== A deactivated member (the regression) ====================
-- Vlad is suspended. His token still carries `sub`, so auth.uid() is real and
-- his profiles row still exists — which is exactly why the old policies let
-- him through: `member_id = auth.uid()` was satisfied. Before the membership
-- gate he could join the open, already-graded task 't-open' and the
-- SECURITY DEFINER ledger trigger would have paid him for it. #317 retired
-- that trigger outright, so joining a graded Task now pays nobody whatever
-- RLS does; this block still proves the membership gate itself, which is
-- what stops the join in the first place.
-- A fresh open task Vlad has never touched, worth points the instant it
-- would be claimed and completed. It is created here rather than with the
-- other fixtures so the persona counts above stay untouched — and unclaimed,
-- because Vlad already claimed 't-open' earlier: reusing it would have made
-- the broken code fail on the primary key instead of awarding points, and
-- this test would have "passed" while proving nothing.
-- #312 makes the historical "already-graded and still open" bait shape
-- impossible to construct at all (a todo Task can no longer carry a
-- Rating). That is not a gap in this regression: every assertion below
-- exercises the direct `insert into task_assignees` RLS denial, which never
-- reaches the grading trigger this Rating used to exist to prove paid out —
-- the assignee row is rejected before the trigger ever runs, graded or not.
insert into tasks
  (title, difficulty, dept_id, status, audience, assignment_mode, queue_opened_at)
  values ('t-open-bait', 4, 'pr', 'todo', 'org', 'public', now());

create temp table fx_open as
  select (select id from tasks where title = 't-open-bait') as task_id,
         (select count(*) from points_ledger
           where member_id = 'a0000000-0000-0000-0000-000000000011') as vlad_rows;
grant select on fx_open to authenticated;

update profiles set status = 'inactiv'
 where id = 'a0000000-0000-0000-0000-000000000011';

select pg_temp.test_login('a0000000-0000-0000-0000-000000000011', jsonb_build_object('provider', 'email'));

select is(auth.uid(), 'a0000000-0000-0000-0000-000000000011'::uuid,
  'the deactivated member still has a real uid — the gate cannot rely on that');
select is((select count(*) from tasks), 0::bigint,
  'a deactivated member sees no tasks, open ones included');
select is((select count(*) from points_ledger), 0::bigint,
  'a deactivated member cannot even read their own ledger');

select throws_ok(
  format($$ insert into task_assignees (task_id, member_id)
            values (%s, 'a0000000-0000-0000-0000-000000000011') $$,
         (select task_id from fx_open)),
  '42501', null, 'a deactivated member cannot claim an open task');

select throws_ok(
  $$ insert into task_requests (kind, title, from_member)
     values ('award', 'cerere-suspendat', 'a0000000-0000-0000-0000-000000000011') $$,
  '42501', null, 'a deactivated member cannot file task requests');

reset role;

select is(
  (select count(*) from points_ledger
    where member_id = 'a0000000-0000-0000-0000-000000000011'),
  (select vlad_rows from fx_open),
  'no points were awarded to the deactivated member');

select * from finish();
rollback;
