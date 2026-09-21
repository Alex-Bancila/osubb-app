-- campaign_report.test.sql — #625: the Campaign reporting reads. A Campaign
-- is a label for reporting (ADR-0007 Campaigns, amended 2026-09-21) — "how
-- many points did it earn and which volunteers worked on it" — never an
-- Origin and never an authority input. This suite pins both surfaces
-- (public.campaign_report / public.campaign_totals) against a hand-built
-- Campaign whose every Task's ledger contribution is worked out by hand in
-- the comments below, so every quantitative assertion is an exact number,
-- never a whole-board count that would drift with the seed.
--
-- Fixture prefix: 62500000-… (issue #625). Runs in one transaction and
-- rolls back, so the local demo seed survives untouched.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(61);

-- ==================== 1. Surface, shape and grants ====================

select has_function('public', 'campaign_report', array['bigint'],
  'the Campaign report read exists');
select has_function('private', 'campaign_report_impl', array['bigint'],
  'its security-definer body exists in private');
select has_function('public', 'campaign_totals', array['bigint'],
  'the Campaign totals read exists');
select has_function('private', 'campaign_totals_impl', array['bigint'],
  'its security-definer body exists in private');

select is(
  pg_get_function_result('public.campaign_report(bigint)'::regprocedure),
  'TABLE(member_id uuid, full_name text, tasks_completed integer, points integer)',
  'the report returns member id, name, tasks_completed and points -- one row per volunteer');
select is(
  pg_get_function_result('public.campaign_totals(bigint)'::regprocedure),
  'TABLE(tasks_total integer, tasks_completed integer, points_total integer)',
  'the totals return the three whole-Campaign counters');

select is(
  (select prosecdef from pg_proc where oid = 'public.campaign_report(bigint)'::regprocedure),
  false, 'the public report wrapper is security invoker');
select is(
  (select prosecdef from pg_proc where oid = 'private.campaign_report_impl(bigint)'::regprocedure),
  true, 'the private report body is security definer -- it reads the whole ledger past RLS and gates itself');
select is(
  (select prosecdef from pg_proc where oid = 'public.campaign_totals(bigint)'::regprocedure),
  false, 'the public totals wrapper is security invoker');
select is(
  (select prosecdef from pg_proc where oid = 'private.campaign_totals_impl(bigint)'::regprocedure),
  true, 'the private totals body is security definer');

select ok(has_function_privilege('authenticated', 'public.campaign_report(bigint)', 'EXECUTE'),
  'authenticated may execute the report wrapper');
select ok(not has_function_privilege('anon', 'public.campaign_report(bigint)', 'EXECUTE'),
  'anon cannot execute the report wrapper');
select ok(has_function_privilege('authenticated', 'private.campaign_report_impl(bigint)', 'EXECUTE'),
  'authenticated may execute the report body -- the security-invoker wrapper calls it as the caller');
select ok(not has_function_privilege('anon', 'private.campaign_report_impl(bigint)', 'EXECUTE'),
  'anon cannot reach the report body directly');
select ok(not has_function_privilege('service_role', 'private.campaign_report_impl(bigint)', 'EXECUTE'),
  'the server role cannot bypass the gate through the report body');

select ok(has_function_privilege('authenticated', 'public.campaign_totals(bigint)', 'EXECUTE'),
  'authenticated may execute the totals wrapper');
select ok(not has_function_privilege('anon', 'public.campaign_totals(bigint)', 'EXECUTE'),
  'anon cannot execute the totals wrapper');
select ok(has_function_privilege('authenticated', 'private.campaign_totals_impl(bigint)', 'EXECUTE'),
  'authenticated may execute the totals body');
select ok(not has_function_privilege('service_role', 'private.campaign_totals_impl(bigint)', 'EXECUTE'),
  'the server role cannot bypass the gate through the totals body');

-- ==================== 2. Fixtures ====================

insert into auth.users (id, email) values
  ('62500000-0000-0000-0000-000000000001', 'bce625@example.test'),
  ('62500000-0000-0000-0000-000000000002', 'bc625@example.test'),
  ('62500000-0000-0000-0000-000000000003', 'outsider625@example.test'),
  ('62500000-0000-0000-0000-000000000005', 'completed625@example.test'),
  ('62500000-0000-0000-0000-000000000006', 'reopened625@example.test'),
  ('62500000-0000-0000-0000-000000000007', 'unfulfilled625@example.test'),
  ('62500000-0000-0000-0000-000000000008', 'cancelled625@example.test'),
  ('62500000-0000-0000-0000-000000000009', 'gaveup625@example.test'),
  ('62500000-0000-0000-0000-000000000010', 'subtask625@example.test'),
  ('62500000-0000-0000-0000-000000000011', 'notin625@example.test'),
  ('62500000-0000-0000-0000-000000000012', 'claimless625@example.test'),
  ('62500000-0000-0000-0000-000000000013', 'reassigneda625@example.test'),
  ('62500000-0000-0000-0000-000000000014', 'reassignedb625@example.test');

insert into public.profiles (id, full_name, email, role, status) values
  -- The live Group Manager of 625-dept (BCE), and a global BC/Moderator
  -- authority who needs no membership anywhere.
  ('62500000-0000-0000-0000-000000000001', 'BCE 625', 'bce625@example.test', 'bce', 'activ'),
  ('62500000-0000-0000-0000-000000000002', 'BC 625', 'bc625@example.test', 'bc', 'activ'),
  -- A live BCE of a DIFFERENT Department -- an active member, but never a
  -- manager of 625-dept's Group.
  ('62500000-0000-0000-0000-000000000003', 'Outsider BCE 625', 'outsider625@example.test', 'bce', 'activ'),
  ('62500000-0000-0000-0000-000000000005', 'Ana Completed 625', 'completed625@example.test', 'activ', 'activ'),
  ('62500000-0000-0000-0000-000000000006', 'Bogdan Reopened 625', 'reopened625@example.test', 'activ', 'activ'),
  ('62500000-0000-0000-0000-000000000007', 'Cezar Unfulfilled 625', 'unfulfilled625@example.test', 'activ', 'activ'),
  ('62500000-0000-0000-0000-000000000008', 'Diana Cancelled 625', 'cancelled625@example.test', 'activ', 'activ'),
  ('62500000-0000-0000-0000-000000000009', 'Emil GaveUp 625', 'gaveup625@example.test', 'activ', 'activ'),
  ('62500000-0000-0000-0000-000000000010', 'Flori Subtask 625', 'subtask625@example.test', 'activ', 'activ'),
  ('62500000-0000-0000-0000-000000000011', 'Gina NotIn 625', 'notin625@example.test', 'activ', 'activ'),
  ('62500000-0000-0000-0000-000000000012', 'Horia Claimless 625', 'claimless625@example.test', 'activ', 'activ'),
  -- Fix round 1 (controller review): A completes and is evaluated, the Task
  -- is reopened AND reassigned to a different Executor, who completes it
  -- again. A's net on the Task is exactly zero -- she must not still show
  -- as having completed it.
  ('62500000-0000-0000-0000-000000000013', 'Ionela ReassignedA 625', 'reassigneda625@example.test', 'activ', 'activ'),
  ('62500000-0000-0000-0000-000000000014', 'Radu ReassignedB 625', 'reassignedb625@example.test', 'activ', 'activ');

insert into public.departments (id, name, short, color) values
  ('625-dept', 'Departament 625', 'D625', '#654321'),
  ('625-other', 'Alt Departament 625', 'A625', '#123987');

insert into public.member_departments (member_id, dept_id) values
  ('62500000-0000-0000-0000-000000000001', '625-dept'),
  ('62500000-0000-0000-0000-000000000003', '625-other');

-- The Campaign lives on 625-dept's mirrored Group (ADR-0009 Wave 2): a
-- direct insert naming group_id, exactly the shape 625's own commands write
-- (private.create_campaign_impl) and campaign_commands.test.sql / #522's own
-- fixtures already use for a Group-scoped Campaign.
insert into public.campaigns (id, group_id, name, created_by)
overriding system value
select 6250001, grp.id, 'Campania 625', '62500000-0000-0000-0000-000000000001'
  from public.groups as grp
 where grp.legacy_dept_id = '625-dept';

select is((select count(*) from public.campaigns where id = 6250001), 1::bigint,
  'the fixture Campaign exists and really carries 625-dept''s Group -- every assertion below is against it, never vacuous');

-- Every Task below names dept_id = '625-dept'; the sync trigger
-- (private.sync_task_group_origin) derives group_id from it, so it lands
-- inside the Campaign's own Group and tasks_validate_campaign accepts it.
--
--   T1 Completed A       -- 3 x rating 5 (x3) = 9,  Executor: Ana (05).
--   T2 Reopen source     -- 3 x rating 5 (x3) = 9 credited then reversed,
--                           then 4 x rating 5 (x3) = 12 re-credited to the
--                           SAME Executor: Bogdan (06). Net 9 - 9 + 12 = 12,
--                           counted once.
--   T3 Unfulfilled C     -- 5 x rating 2 (x0) = 0, Executor: Cezar (07) --
--                           evaluated as unfulfilled, contributes 0 points
--                           and does not count toward tasks_completed.
--   T4 Cancelled D       -- never evaluated (cancel_task never calls
--                           evaluate_task): Diana (08) holds the cancelled
--                           Assignment and no ledger row at all.
--   T5 Completed E       -- 2 x rating 5 (x3) = 6, credited to Ana (05)
--                           again (a second Task, so her report row sums
--                           two Tasks: 9 + 6 = 15, tasks_completed = 2).
--                           Emil (09) held an EARLIER Assignment on this
--                           same Task and gave it up before completion --
--                           Assignment History, not the ledger, is what
--                           "executed" means (ruling 3), so Emil is still a
--                           row on the report, at 0/0.
--   T6 Subtask F         -- a Subtask of Umbrella U1, carries the Campaign
--                           ITSELF (ruling 4): 2 x rating 4 (x2) = 4,
--                           Executor Flori (10).
--   U1 Umbrella G        -- the Umbrella over T6. Carries NO campaign_id of
--                           its own -- an Umbrella is never assigned to
--                           anyone and never enters this report on its own
--                           account (ruling 4: nothing here infers a
--                           Campaign for it from its Subtask, or the
--                           reverse).
--   T7 No-Campaign H     -- same Department, same Group, deliberately
--                           campaign_id = null: 5 x rating 5 (x3) = 15,
--                           credited to Gina (11), who must NEVER appear in
--                           this Campaign's report or totals.
--   T8 Reassigned AB     -- fix round 1: 2 x rating 5 (x3) = 6 credited to
--                           Ionela (13), reversed (net 0), then reassigned
--                           and re-credited to a DIFFERENT Executor, Radu
--                           (14): 3 x rating 3 (x1) = 3. Ionela's net on
--                           this Task is exactly 0 -- she still appears
--                           (ruling 3, held the Assignment) but the
--                           completed Task counts toward tasks_completed
--                           for Radu only, never for her too.
insert into public.tasks
  (title, dept_id, campaign_id, status, difficulty, rating,
   created_by, created_at, completed_at)
values
  ('T1 Completed A 625', '625-dept', 6250001, 'completed', 3, 5,
   '62500000-0000-0000-0000-000000000001', now() - interval '3 days', now()),
  ('T2 Reopen source 625', '625-dept', 6250001, 'completed', 3, 5,
   '62500000-0000-0000-0000-000000000001', now() - interval '3 days', now()),
  ('T5 Completed E 625', '625-dept', 6250001, 'completed', 2, 5,
   '62500000-0000-0000-0000-000000000001', now() - interval '3 days', now()),
  ('T7 No-Campaign H 625', '625-dept', null, 'completed', 5, 5,
   '62500000-0000-0000-0000-000000000001', now() - interval '3 days', now()),
  ('T8 Reassigned AB 625', '625-dept', 6250001, 'completed', 2, 5,
   '62500000-0000-0000-0000-000000000001', now() - interval '3 days', now());

insert into public.tasks
  (title, dept_id, campaign_id, status, difficulty, rating,
   created_by, created_at, unfulfilled_at)
values
  ('T3 Unfulfilled C 625', '625-dept', 6250001, 'unfulfilled', 5, 2,
   '62500000-0000-0000-0000-000000000001', now() - interval '3 days', now());

insert into public.tasks
  (title, dept_id, campaign_id, status, cancel_reason,
   created_by, created_at, cancelled_at)
values
  ('T4 Cancelled D 625', '625-dept', 6250001, 'cancelled', 'Fixture cancel 625',
   '62500000-0000-0000-0000-000000000001', now() - interval '3 days', now());

-- The Umbrella (no campaign_id, no difficulty/rating/audience/assignment_mode
-- -- tasks_umbrella_shape_ck) and its one Subtask, which DOES carry the
-- Campaign directly.
insert into public.tasks (title, dept_id, kind, audience, assignment_mode, created_by, created_at)
values ('U1 Umbrella G 625', '625-dept', 'umbrella', null, null,
        '62500000-0000-0000-0000-000000000001', now() - interval '3 days');

insert into public.tasks
  (title, dept_id, campaign_id, parent_task_id, status, difficulty, rating,
   created_by, created_at, completed_at)
select 'T6 Subtask F 625', '625-dept', 6250001, parent.id, 'completed', 2, 4,
       '62500000-0000-0000-0000-000000000001', now() - interval '3 days', now()
  from public.tasks as parent
 where parent.title = 'U1 Umbrella G 625';

-- Credit every Executor. pg_temp.test_credit_task reuses an existing
-- Assignment for the (task, member) pair or creates one, records one
-- `command` Evaluation off the Task's own Difficulty/Rating and appends the
-- matching `task` ledger row -- exactly what the evaluation commands do.
select pg_temp.test_credit_task(task.id, credit.member_id,
                                '62500000-0000-0000-0000-000000000001')
  from (values
    ('T1 Completed A 625',    '62500000-0000-0000-0000-000000000005'::uuid),
    ('T2 Reopen source 625',  '62500000-0000-0000-0000-000000000006'),
    ('T3 Unfulfilled C 625',  '62500000-0000-0000-0000-000000000007'),
    ('T5 Completed E 625',    '62500000-0000-0000-0000-000000000005'),
    ('T6 Subtask F 625',      '62500000-0000-0000-0000-000000000010'),
    ('T7 No-Campaign H 625',  '62500000-0000-0000-0000-000000000011'),
    ('T8 Reassigned AB 625',  '62500000-0000-0000-0000-000000000013')
  ) as credit (title, member_id)
  join public.tasks as task on task.title = credit.title
 order by task.id;

-- Diana's cancelled Assignment: ended, never evaluated, no ledger row.
insert into public.task_assignments (task_id, member_id, assigned_at, ended_at, end_reason)
select task.id, '62500000-0000-0000-0000-000000000008', now() - interval '2 days',
       task.cancelled_at, 'cancelled'
  from public.tasks as task where task.title = 'T4 Cancelled D 625';

-- Emil's earlier Assignment on T5, given up before Ana was ever assigned --
-- Assignment History keeps both rows; only Ana's carries a credit.
insert into public.task_assignments (task_id, member_id, assigned_at, ended_at, end_reason)
select task.id, '62500000-0000-0000-0000-000000000009',
       now() - interval '3 days' - interval '1 hour', now() - interval '3 days', 'gave_up'
  from public.tasks as task where task.title = 'T5 Completed E 625';

-- Reopen T2: reverse Bogdan's first Evaluation exactly the way reopen_task
-- does (the reversal trio plus the offsetting `task_reversal` ledger row),
-- bump the Task's own Difficulty to 4, and re-credit the SAME Executor.
update public.task_evaluations as evaluation
   set reversed_at = now(), reversed_by = '62500000-0000-0000-0000-000000000001',
       reversal_reason = 'fixture reopen 625'
  from public.tasks as task
 where task.id = evaluation.task_id and task.title = 'T2 Reopen source 625';

insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id)
select assignment.member_id, -evaluation.points, 'task_reversal',
       evaluation.task_id, evaluation.id
  from public.task_evaluations as evaluation
  join public.task_assignments as assignment on assignment.id = evaluation.assignment_id
 where evaluation.reversal_reason = 'fixture reopen 625';

update public.tasks set difficulty = 4 where title = 'T2 Reopen source 625';

select pg_temp.test_credit_task(task.id, '62500000-0000-0000-0000-000000000006',
                                '62500000-0000-0000-0000-000000000001')
  from public.tasks as task where task.title = 'T2 Reopen source 625';

-- Fix round 1: reopen T8 AND reassign it -- reverse Ionela's Evaluation,
-- end her Assignment (she is no longer the Executor at all, not even a
-- reopened one), bump the Task's own Difficulty/Rating to Radu's eventual
-- Evaluation, give Radu a fresh Assignment, and credit him.
update public.task_evaluations as evaluation
   set reversed_at = now(), reversed_by = '62500000-0000-0000-0000-000000000001',
       reversal_reason = 'fixture reassign 625'
  from public.tasks as task
 where task.id = evaluation.task_id and task.title = 'T8 Reassigned AB 625';

insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id)
select assignment.member_id, -evaluation.points, 'task_reversal',
       evaluation.task_id, evaluation.id
  from public.task_evaluations as evaluation
  join public.task_assignments as assignment on assignment.id = evaluation.assignment_id
 where evaluation.reversal_reason = 'fixture reassign 625';

update public.task_assignments as assignment
   set ended_at = now(), end_reason = 'replaced'
  from public.tasks as task
 where task.id = assignment.task_id
   and task.title = 'T8 Reassigned AB 625'
   and assignment.member_id = '62500000-0000-0000-0000-000000000013';

update public.tasks set difficulty = 3, rating = 3 where title = 'T8 Reassigned AB 625';

select pg_temp.test_credit_task(task.id, '62500000-0000-0000-0000-000000000014',
                                '62500000-0000-0000-0000-000000000001')
  from public.tasks as task where task.title = 'T8 Reassigned AB 625';

-- Sanity pins: none of the quantitative assertions below can pass vacuously.
select is((select count(*) from public.task_evaluations as evaluation
             join public.tasks as task on task.id = evaluation.task_id
            where task.title = 'T2 Reopen source 625'), 2::bigint,
  'T2 really carries two Evaluations (the reversed one and the re-credit) -- the "counts once" assertion below is not vacuous');
select is((select count(*) from public.points_ledger as entry
             join public.tasks as task on task.id = entry.task_id
            where task.title = 'T4 Cancelled D 625'), 0::bigint,
  'the cancelled Task really carries no ledger row at all');
select is((select count(*) from public.task_assignments as assignment
             join public.tasks as task on task.id = assignment.task_id
            where task.title = 'T5 Completed E 625'), 2::bigint,
  'T5 really carries two Assignments (the give-up and the credited one)');
select is((select count(*) from public.task_assignments as assignment
             join public.tasks as task on task.id = assignment.task_id
            where task.title = 'T8 Reassigned AB 625'), 2::bigint,
  'T8 really carries two Assignments (Ionela''s ended one and Radu''s credited one)');
select is((select coalesce(sum(entry.delta), 0)::int
             from public.points_ledger as entry
             join public.tasks as task on task.id = entry.task_id
            where task.title = 'T8 Reassigned AB 625'
              and entry.member_id = '62500000-0000-0000-0000-000000000013'), 0,
  'Ionela''s own net on T8 really is zero -- the credit and its reversal, nothing else');

-- ==================== 3. The report, as a live Group manager ====================

select pg_temp.test_login_leadership('62500000-0000-0000-0000-000000000001');

select is((select points from public.campaign_report(6250001)
            where member_id = '62500000-0000-0000-0000-000000000005'), 15,
  'Ana carries both her Tasks summed (9 + 6)');
select is((select tasks_completed from public.campaign_report(6250001)
            where member_id = '62500000-0000-0000-0000-000000000005'), 2,
  'and both count toward tasks_completed');

select is((select points from public.campaign_report(6250001)
            where member_id = '62500000-0000-0000-0000-000000000006'), 12,
  'Bogdan''s reopened Task nets to its current re-evaluation (9 - 9 + 12), never the stale 9 and never double-counted to 21');
select is((select tasks_completed from public.campaign_report(6250001)
            where member_id = '62500000-0000-0000-0000-000000000006'), 1,
  'and counts as exactly one completed Task despite two Evaluations');

select is((select points from public.campaign_report(6250001)
            where member_id = '62500000-0000-0000-0000-000000000007'), 0,
  'Cezar''s unfulfilled Task contributes no points');
select is((select tasks_completed from public.campaign_report(6250001)
            where member_id = '62500000-0000-0000-0000-000000000007'), 0,
  'and does not count toward tasks_completed');

select is((select points from public.campaign_report(6250001)
            where member_id = '62500000-0000-0000-0000-000000000008'), 0,
  'Diana''s cancelled Task contributes no points');
select is((select tasks_completed from public.campaign_report(6250001)
            where member_id = '62500000-0000-0000-0000-000000000008'), 0,
  'and does not count toward tasks_completed -- but she is still a row: ruling 3, holding the Assignment is enough');

select is((select points from public.campaign_report(6250001)
            where member_id = '62500000-0000-0000-0000-000000000009'), 0,
  'Emil, who gave up T5 before Ana was ever assigned, still appears (ruling 3: Assignment History, not the ledger) -- at 0 points');
select is((select tasks_completed from public.campaign_report(6250001)
            where member_id = '62500000-0000-0000-0000-000000000009'), 0,
  'and 0 tasks_completed -- the credit is Ana''s, not his');

select is((select points from public.campaign_report(6250001)
            where member_id = '62500000-0000-0000-0000-000000000010'), 4,
  'Flori''s Subtask carries its own campaign_id and is reported on its own account (ruling 4)');

select is((select count(*) from public.campaign_report(6250001)
            where member_id = '62500000-0000-0000-0000-000000000011'), 0::bigint,
  'Gina worked on the same Department''s Task but not one carrying this Campaign -- she never appears');

-- Fix round 1: Ionela's Task was reopened and handed to Radu. Her net on it
-- is exactly zero, so she still appears (ruling 3) but the completion is
-- not hers -- it must not be double-counted for both of them.
select is((select points from public.campaign_report(6250001)
            where member_id = '62500000-0000-0000-0000-000000000013'), 0,
  'Ionela''s reopened-and-reassigned Task nets to zero (6 - 6)');
select is((select tasks_completed from public.campaign_report(6250001)
            where member_id = '62500000-0000-0000-0000-000000000013'), 0,
  'and does not count as a completion for her -- her own net on it is not positive');
select is((select points from public.campaign_report(6250001)
            where member_id = '62500000-0000-0000-0000-000000000014'), 3,
  'Radu, who was actually assigned and evaluated after the reassignment, carries the Task''s current net (3)');
select is((select tasks_completed from public.campaign_report(6250001)
            where member_id = '62500000-0000-0000-0000-000000000014'), 1,
  'and it counts as his completion, not Ionela''s -- one Task, one completion, never both');

select is((select count(*) from public.campaign_report(6250001)), 8::bigint,
  'exactly eight volunteers executed a Task of this Campaign -- Gina and the Umbrella itself are not among them');

select is((select sum(points)::int from public.campaign_report(6250001)), 34,
  '15 + 12 + 0 + 0 + 0 + 4 + 0 + 3 -- the report''s own sum agrees with the totals read below');
select is((select sum(tasks_completed)::int from public.campaign_report(6250001)), 5,
  '2 + 1 + 0 + 0 + 0 + 1 + 0 + 1 -- exactly five completions are attributed across all volunteers, never six');

-- ==================== 4. The totals ====================

select is(
  (select tasks_total from public.campaign_totals(6250001)), 7,
  'seven Tasks carry this Campaign''s id directly -- the Umbrella and the no-Campaign Task are not among them');
select is(
  (select tasks_completed from public.campaign_totals(6250001)), 5,
  'five of them are completed (T1, T2, T5, T6, T8) -- the unfulfilled and cancelled ones are not, and T8 counts once, whole-Campaign, regardless of how many members touched it');
select is(
  (select points_total from public.campaign_totals(6250001)), 34,
  'points_total is the exact ledger sum for this Campaign''s Tasks (9 + [9-9+12] + 0 + 0 + 6 + 4 + [6-6+3]), matching the report''s own total');

-- The totals are never recomputed from Difficulty x Rating -- they are the
-- ledger sum, independently re-derived here without going through either
-- function under test.
select is(
  (select coalesce(sum(entry.delta), 0)::int
     from public.points_ledger as entry
     join public.tasks as task on task.id = entry.task_id
    where task.campaign_id = 6250001
      and entry.reason in ('task', 'task_reversal')),
  (select points_total from public.campaign_totals(6250001)),
  'points_total equals an independent ledger sum over exactly this Campaign''s Tasks');

-- ==================== 5. Authority ====================

-- A BC needs no Group membership at all (private.can_manage_group_work's
-- level >= 6 short-circuit).
select pg_temp.test_login_leadership('62500000-0000-0000-0000-000000000002');
select is((select points from public.campaign_report(6250001)
            where member_id = '62500000-0000-0000-0000-000000000005'), 15,
  'a BC sees the same report a Group manager does');
select is((select points_total from public.campaign_totals(6250001)), 34,
  'and the same totals');

-- A live BCE of a DIFFERENT Department is an active member, but never a
-- manager of 625-dept's Group -- refused on the real Campaign.
select pg_temp.test_login_leadership('62500000-0000-0000-0000-000000000003');
select throws_ok(
  $$select * from public.campaign_report(6250001)$$,
  '42501', 'campaign_report_forbidden',
  'a Member of a different Group is refused the report, on a real Campaign');
select throws_ok(
  $$select * from public.campaign_totals(6250001)$$,
  '42501', 'campaign_report_forbidden',
  'and the totals -- same reason string, both surfaces');

-- Unknown Campaign: PT404, even for the same authorized caller who can read
-- the real one (ruling 2 -- existence is checked before authority).
select pg_temp.test_login_leadership('62500000-0000-0000-0000-000000000001');
select throws_ok(
  $$select * from public.campaign_report(999999999)$$,
  'PT404', 'campaign_not_found',
  'an unknown Campaign id is PT404 for the report, not an empty result');
select throws_ok(
  $$select * from public.campaign_totals(999999999)$$,
  'PT404', 'campaign_not_found',
  'and for the totals');

-- The same unknown id for the OUTSIDER answers PT404 too, never 42501 --
-- ruling 2's ordering the other way round: existence is checked first for
-- every live active member, not only for someone already authorized.
select pg_temp.test_login_leadership('62500000-0000-0000-0000-000000000003');
select throws_ok(
  $$select * from public.campaign_report(999999999)$$,
  'PT404', 'campaign_not_found',
  'an unknown id is PT404 even for a caller who could never manage the real Campaign either');

-- A claimless session (a real, live, active uid with no org claims) is
-- refused before the Campaign is even looked up -- 42501, never PT404, no
-- matter which id is named.
select pg_temp.test_login('62500000-0000-0000-0000-000000000012', '{}'::jsonb);
select throws_ok(
  $$select * from public.campaign_report(6250001)$$,
  '42501', 'campaign_report_forbidden',
  'a claimless session is refused the report on the real Campaign');
select throws_ok(
  $$select * from public.campaign_report(999999999)$$,
  '42501', 'campaign_report_forbidden',
  'and on an unknown id too -- the membership gate fires before any lookup');
select throws_ok(
  $$select * from public.campaign_totals(6250001)$$,
  '42501', 'campaign_report_forbidden',
  'and the totals refuse a claimless session the same way');

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok('select * from public.campaign_report(6250001)', '42501', null,
  'anon holds no grant on the report wrapper');
select throws_ok('select * from private.campaign_report_impl(6250001)', '42501', null,
  'anon cannot reach the report body directly either');
select throws_ok('select * from public.campaign_totals(6250001)', '42501', null,
  'anon holds no grant on the totals wrapper');
reset role;

select * from finish();
rollback;
