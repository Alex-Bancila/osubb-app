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

select plan(23);

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
truncate tasks, points_ledger cascade;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000011', 'vlad.rls@test.local'),
  ('b0000000-0000-0000-0000-000000000012', 'bianca.rls@test.local'),
  ('c0000000-0000-0000-0000-000000000013', 'radu.rls@test.local'),
  ('d0000000-0000-0000-0000-000000000014', 'bogdan.bc.rls@test.local');
insert into profiles (id, full_name, email, role) values
  ('a0000000-0000-0000-0000-000000000011', 'Vlad Voluntar EDU',  'vlad.rls@test.local',      'voluntar'),
  ('b0000000-0000-0000-0000-000000000012', 'Bianca Voluntar PR', 'bianca.rls@test.local',    'voluntar'),
  ('c0000000-0000-0000-0000-000000000013', 'Radu Responsabil',   'radu.rls@test.local',      'vot'),
  ('d0000000-0000-0000-0000-000000000014', 'Bogdan BC',          'bogdan.bc.rls@test.local', 'bc');
insert into pg_temp.fixture_member_departments (member_id, dept_id) values
  ('a0000000-0000-0000-0000-000000000011', 'edu'),
  ('b0000000-0000-0000-0000-000000000012', 'pr'),
  ('c0000000-0000-0000-0000-000000000013', 'edu');
insert into pg_temp.fixture_teams (id, name, dept_id) values ('t-x', 'Team X', 'pr');
insert into pg_temp.fixture_team_members (team_id, member_id)
  values ('t-x', 'b0000000-0000-0000-0000-000000000012');
-- #586: materialize this suite's legacy setup as rolled-back Group fixtures.
select pg_temp.materialize_legacy_groups();


insert into tasks (title, difficulty, group_id)          values ('t-edu',  3, pg_temp.dept_group('edu'));
insert into tasks (title, difficulty, group_id)          values ('t-edu2', 2, pg_temp.dept_group('edu'));
insert into tasks (title, difficulty, group_id)          values ('t-pr',   2, pg_temp.dept_group('pr'));
insert into tasks
  (title, difficulty, group_id, status, audience, assignment_mode, queue_opened_at)
  values ('t-open', 1, pg_temp.dept_group('pr'), 'todo', 'org', 'public', now());
insert into tasks (title, difficulty, group_id)          values ('t-team', 1, pg_temp.team_group('t-x'));
-- #312: rating may only be set once completed (tasks_evaluation_inputs_ck).
update tasks set status = 'completed', completed_at = now(), rating = 4 where title = 't-edu';   -- Vlad +6
update tasks set status = 'completed', completed_at = now(), rating = 3 where title = 't-pr';    -- Bianca +2
-- #318: a member's own Tasks are read through Assignment History
-- (task_assignments). #345 dropped the legacy join table that used to hold
-- this participant list, so it is written out here: one Assignment per
-- participant, ended 'completed' at completed_at, exactly the shape #290's
-- backfill produced.
create temp table fx_participants as
select task.id as task_id, participant.member_id
  from (values
    ('t-edu', 'a0000000-0000-0000-0000-000000000011'::uuid),
    ('t-pr',  'b0000000-0000-0000-0000-000000000012'::uuid)
  ) as participant (title, member_id)
  join tasks as task on task.title = participant.title;

insert into task_assignments (task_id, member_id, assigned_at, ended_at, end_reason)
select task.id, participant.member_id, task.created_at, task.completed_at, 'completed'
  from fx_participants as participant
  join tasks as task on task.id = participant.task_id;
-- #317: the credit is an Evaluation plus the ledger row that names it, not a
-- side effect of the Rating update above.
select pg_temp.test_credit_task(participant.task_id, participant.member_id,
                                'd0000000-0000-0000-0000-000000000014')
  from fx_participants as participant;
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
select is((select count(*) from points_ledger), 1::bigint,
  'voluntar sees only their own ledger rows');
select throws_ok(
  $$ insert into points_ledger (member_id, delta, reason, awarded_by)
     values ('a0000000-0000-0000-0000-000000000011', 99, 'manual_award',
             'a0000000-0000-0000-0000-000000000011') $$,
  -- #162: no INSERT policy admits reason <> 'sanction', so RLS denies this
  -- before the row ever reaches the reason CHECK constraint.
  '42501', null, 'a voluntar cannot create retired manual awards');

reset role;

-- ==================== Radu: responsabil (level 4), edu ====================
select pg_temp.test_login('c0000000-0000-0000-0000-000000000013', jsonb_build_object(
    'member_role', 'vot',
    'member_level', 4,
    'dept_ids', '["edu"]'::jsonb,
    'team_ids', '[]'::jsonb
  ));

-- The organisation role Responsabil is not a global reader (#318): only
-- t-open, an org-wide Opportunity nobody has taken.
select is((select count(*) from tasks), 1::bigint,
  'a Responsabil (level 4) reads only the org-wide Opportunity, not every task');
-- #345 revoked insert/update/delete on public.tasks from authenticated. What
-- used to be a silent no-op (the legacy policy admitted the statement, and
-- tasks_read admitted no rows to it) is now a hard denial on the table grant
-- -- and it is a denial for a Task this persona CAN read as well as one they
-- cannot, which is the whole point of the retirement.
select throws_ok(
  $$ update tasks set description = 'touched by a responsabil' where title = 't-edu2' $$,
  '42501', 'permission denied for table tasks',
  'a level-4 direct Task UPDATE is refused outright, not silently ignored');
select throws_ok(
  $$ update tasks set status = 'completed', completed_at = now(),
            queue_closed_at = now(), rating = 5
     where title = 't-open' $$,
  '42501', 'permission denied for table tasks',
  'and refused even on the one Task this persona can actually read -- grading is a command now');

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

reset role;

select is((select description from tasks where title = 't-edu2'), null,
  'and the refused update changed nothing -- the Task it could not read is untouched');

-- ==================== Bogdan: bc (level 6), no dept claims ====================
select pg_temp.test_login('d0000000-0000-0000-0000-000000000014', jsonb_build_object(
    'member_role', 'bc',
    'member_level', 6,
    'dept_ids', '[]'::jsonb,
    'team_ids', '[]'::jsonb
  ));

-- Two credits: only the two Evaluations written explicitly with the fixtures
-- exist. Since #317 a Rating moves no points by itself, and since #345
-- nobody can record one by hand at all.
select is((select count(*) from points_ledger), 2::bigint,
  'level >= 6 reads the whole ledger, and a Rating with no Evaluation added nothing to it');
select lives_ok(
  $$ insert into points_ledger (member_id, delta, reason, note, awarded_by)
     values ('b0000000-0000-0000-0000-000000000012', -3, 'sanction', 'test sanction',
             'd0000000-0000-0000-0000-000000000014') $$,
  'BC may sanction');                                     -- Bianca −3
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

-- t-team (her Team's), t-pr (her own) and t-open (an org-wide Opportunity
-- whose queue is still open, because #345 left no direct path for Radu to
-- grade and close it); not the other Department Tasks.
select is((select count(*) from tasks), 3::bigint,
  'team member sees their Team''s Task, their own, and the open Opportunity -- not every Department Task');
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
-- A fresh open task Vlad has never touched. It is created here rather than
-- with the other fixtures so the persona counts above stay untouched.
-- #312 makes the historical "already-graded and still open" bait shape
-- impossible to construct at all (a todo Task can no longer carry a
-- Rating), and #345 replaced the direct `insert into` claim with a command.
-- Neither weakens the regression: the assertion below exercises the very
-- gate that used to be missing, now inside public.express_task_interest.
insert into tasks
  (title, difficulty, group_id, status, audience, assignment_mode, queue_opened_at)
  values ('t-open-bait', 4, pg_temp.dept_group('pr'), 'todo', 'org', 'public', now());

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
  format($$ select public.express_task_interest(%s) $$,
         (select task_id from fx_open)),
  '42501', 'task_command_forbidden',
  'a deactivated member cannot join an open Task''s Candidate Queue');

select throws_ok(
  $$ select public.create_completed_work_request('cerere-suspendat', pg_temp.dept_group('edu')) $$,
  '42501', 'request_command_forbidden',
  'a deactivated member cannot file a Completed-work Request');

reset role;

select is(
  (select count(*) from points_ledger
    where member_id = 'a0000000-0000-0000-0000-000000000011'),
  (select vlad_rows from fx_open),
  'no points were awarded to the deactivated member');

select * from finish();
rollback;
