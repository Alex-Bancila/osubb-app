-- leadership_leaderboard.test.sql — #258: the leadership Leaderboard is Task
-- Points only, attributed to the Task that produced them, and its filters
-- describe that Task rather than the member who earned it.
--
-- Fixture prefix: 25800000-… (issue #258). Runs in one transaction and rolls
-- back, so the local demo seed survives untouched. The seed already puts real
-- Task points on real members, so every quantitative assertion below is scoped
-- to this suite's own Department, Team, Project or Campaign, or is read for a
-- named fixture member — never from a whole-board count, which moves with the
-- seed.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(44);

-- ==================== 1. Surface, shape and grants ====================

select has_function('public', 'leadership_leaderboard',
  array['text', 'text', 'bigint', 'bigint'],
  'the filtered leadership Leaderboard read exists');
select has_function('private', 'leadership_leaderboard_impl',
  array['text', 'text', 'bigint', 'bigint'],
  'its security-definer body exists in private');

-- ADR-0007: "The leadership Leaderboard contains member name and Task points
-- only." Pinning the result type is what keeps a later "while we are here"
-- commit from adding role, email or Department to a leadership export.
select is(
  pg_get_function_result('public.leadership_leaderboard(text, text, bigint, bigint)'::regprocedure),
  'TABLE(member_id uuid, full_name text, points integer, rank integer)',
  'the board returns member id, name, points and rank -- no role, no email, no Department');

select is(
  (select prosecdef from pg_proc where oid = 'public.leadership_leaderboard(text, text, bigint, bigint)'::regprocedure),
  false, 'the public wrapper is security invoker');
select is(
  (select prosecdef from pg_proc where oid = 'private.leadership_leaderboard_impl(text, text, bigint, bigint)'::regprocedure),
  true, 'the private body is security definer -- it reads the whole ledger past RLS and gates itself');

select ok(has_function_privilege('authenticated', 'public.leadership_leaderboard(text, text, bigint, bigint)', 'EXECUTE'),
  'authenticated may execute the leadership Leaderboard');
select ok(not has_function_privilege('anon', 'public.leadership_leaderboard(text, text, bigint, bigint)', 'EXECUTE'),
  'anon cannot execute the leadership Leaderboard');
select ok(has_function_privilege('authenticated', 'private.leadership_leaderboard_impl(text, text, bigint, bigint)', 'EXECUTE'),
  'authenticated may execute the body -- the security-invoker wrapper calls it as the caller');
select ok(not has_function_privilege('anon', 'private.leadership_leaderboard_impl(text, text, bigint, bigint)', 'EXECUTE'),
  'anon cannot reach the body directly');
select ok(not has_function_privilege('service_role', 'private.leadership_leaderboard_impl(text, text, bigint, bigint)', 'EXECUTE'),
  'the server role cannot bypass the BCE+ gate through the private body');

-- #258 is additive. `app/src/queries/points.ts` still reads the legacy
-- all-ledger view for the Dashboard card; plan Task J1 moves that card onto
-- this function and #376 retires the view afterwards. Dropping it here would
-- break the Dashboard.
select has_view('public', 'leaderboard',
  'the legacy all-ledger Leaderboard view is untouched -- the Dashboard card still reads it until J1 and #376');

-- ==================== 2. Fixtures ====================

insert into auth.users (id, email) values
  ('25800000-0000-0000-0000-000000000001', 'bce258@example.test'),
  ('25800000-0000-0000-0000-000000000002', 'executor258@example.test'),
  ('25800000-0000-0000-0000-000000000003', 'inactivebce258@example.test'),
  ('25800000-0000-0000-0000-000000000004', 'responsabil258@example.test'),
  ('25800000-0000-0000-0000-000000000005', 'bc258@example.test'),
  ('25800000-0000-0000-0000-000000000006', 'egalitate258@example.test'),
  ('25800000-0000-0000-0000-000000000007', 'dezactivat258@example.test'),
  ('25800000-0000-0000-0000-000000000008', 'anulata258@example.test');

insert into public.profiles (id, full_name, email, role, status) values
  ('25800000-0000-0000-0000-000000000001', 'BCE 258', 'bce258@example.test', 'bce', 'activ'),
  -- The Executor who earns under three different Origins. Belongs to no
  -- Department and no Team: every point below has to reach a filter through
  -- its Task's Origin or not at all.
  ('25800000-0000-0000-0000-000000000002', 'Mihai Executor 258', 'executor258@example.test', 'activ', 'activ'),
  ('25800000-0000-0000-0000-000000000003', 'Inactive BCE 258', 'inactivebce258@example.test', 'bce', 'inactiv'),
  -- Level 4 -- the rank directly below the gate, and the plausible drift:
  -- `app/src/lib/capabilities.ts` already draws a `manageTasks: 4` line, so a
  -- gate loosened to `>= 4` would hand every Project Responsible the whole
  -- organisation's points. Ruling 5: pin the threshold, not "some lower role".
  ('25800000-0000-0000-0000-000000000004', 'Responsabil 258', 'responsabil258@example.test', 'responsabil', 'activ'),
  -- Level 6 -- proves the allow side is not carried by BCE alone.
  ('25800000-0000-0000-0000-000000000005', 'BC 258', 'bc258@example.test', 'bc', 'activ'),
  ('25800000-0000-0000-0000-000000000006', 'Ana Egalitate 258', 'egalitate258@example.test', 'activ', 'activ'),
  -- Deactivated *after* earning, below: ADR-0007 "Anyone with completed Task
  -- history remains eligible regardless of their current Profile status."
  ('25800000-0000-0000-0000-000000000007', 'Bogdan Dezactivat 258', 'dezactivat258@example.test', 'activ', 'activ'),
  ('25800000-0000-0000-0000-000000000008', 'Zoia Anulata 258', 'anulata258@example.test', 'activ', 'activ');

-- A Department of this suite's own, so the Department filter below returns
-- exactly these fixtures and never a seeded Task on `edu`.
insert into public.departments (id, name, short, color) values
  ('258-dept', 'Departament 258', 'D258', '#123456');
insert into public.teams (id, name, dept_id) values
  ('258-dept-team', 'Department Team 258', '258-dept');

-- `campaigns.id` and `projects.id` are GENERATED ALWAYS, so the fixture
-- overrides them: the Campaign and Project filters are asserted against
-- literal ids, which beats threading a lookup through every assertion.
insert into public.campaigns (id, department_id, name, created_by)
overriding system value values
  (2580001, '258-dept', 'Campania A 258', '25800000-0000-0000-0000-000000000001'),
  (2580002, '258-dept', 'Campania B 258', '25800000-0000-0000-0000-000000000001');

insert into public.projects (id, name, status, leader_id, created_by)
overriding system value values
  (2580003, 'Project 258', 'active', '25800000-0000-0000-0000-000000000001',
   '25800000-0000-0000-0000-000000000001');

-- Every Task is already evaluated; `pg_temp.test_credit_task` writes the
-- Assignment, the Evaluation and the ledger entry, so the award is always
-- difficulty x rating_mult(5) = difficulty x 3.
insert into public.tasks
  (title, description, deadline, dept_id, team_id, project_id, campaign_id,
   status, difficulty, rating, created_by, created_at, completed_at)
select fixture.title, 'Fixture', now() - interval '2 days',
       fixture.dept_id, fixture.team_id, fixture.project_id, fixture.campaign_id,
       'completed', fixture.difficulty, 5,
       '25800000-0000-0000-0000-000000000001',
       -- completed_at is `now()`: test_credit_task ends the Assignment at
       -- completed_at, and task_assignments_end_chronology_check refuses an end
       -- before the Assignment's own start.
       now() - interval '3 days', now()
  from (values
    -- Mihai, Campaign A, straight on the Department: 4 x 3 = 12.
    ('LB Department Task 258',      '258-dept'::text, null::text,      null::bigint, 2580001::bigint, 4),
    -- Mihai, Campaign B, on a Department Team whose parent is 258-dept:
    -- 5 x 3 = 15. The Department filter must reach this one too.
    ('LB Department Team Task 258', null,             '258-dept-team', null,         2580002,         5),
    -- Mihai, no Campaign, Project Origin: 4 x 3 = 12. Unreachable from any
    -- Department filter, present unfiltered.
    ('LB Project Task 258',         null,             null,            2580003,      null,            4),
    -- Zoia, Campaign A: 3 x 3 = 9, reversed below to a net of zero.
    ('LB Reversed Task 258',        '258-dept',       null,            null,         2580001,         3),
    -- Bogdan, Campaign A: 1 x 3 = 3, earned while still activ.
    ('LB Deactivated Task 258',     '258-dept',       null,            null,         2580001,         1),
    -- Ana, Campaign A: 1 x 3 = 3 -- the tie that the name tiebreak orders.
    ('LB Tie Task 258',             '258-dept',       null,            null,         2580001,         1)
  ) as fixture (title, dept_id, team_id, project_id, campaign_id, difficulty);

select pg_temp.test_credit_task(task.id, credit.member_id,
                                '25800000-0000-0000-0000-000000000001')
  from (values
    ('LB Department Task 258',      '25800000-0000-0000-0000-000000000002'::uuid),
    ('LB Department Team Task 258', '25800000-0000-0000-0000-000000000002'),
    ('LB Project Task 258',         '25800000-0000-0000-0000-000000000002'),
    ('LB Reversed Task 258',        '25800000-0000-0000-0000-000000000008'),
    ('LB Deactivated Task 258',     '25800000-0000-0000-0000-000000000007'),
    ('LB Tie Task 258',             '25800000-0000-0000-0000-000000000006')
  ) as credit (title, member_id)
  join public.tasks as task on task.title = credit.title
 order by task.id;

-- Reverse Zoia's only award exactly the way reopen_task does.
update public.task_evaluations as evaluation
   set reversed_at = now(),
       reversed_by = '25800000-0000-0000-0000-000000000001',
       reversal_reason = 'fixture reversal 258'
  from public.tasks as task
 where task.id = evaluation.task_id
   and task.title = 'LB Reversed Task 258';

insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id)
select assignment.member_id, -evaluation.points, 'task_reversal',
       evaluation.task_id, evaluation.id
  from public.task_evaluations as evaluation
  join public.task_assignments as assignment on assignment.id = evaluation.assignment_id
 where evaluation.reversal_reason = 'fixture reversal 258';

-- A sanction moves a member's *personal* total (public.my_points) and must
-- never move the Leaderboard. It lands on the member who is otherwise the
-- board's top row, so excluding it is a visible arithmetic difference rather
-- than a vacuous one.
insert into public.points_ledger (member_id, delta, reason, note, awarded_by) values
  ('25800000-0000-0000-0000-000000000002', -7, 'sanction', 'Sanction excluded 258',
   '25800000-0000-0000-0000-000000000001');

-- Bogdan leaves the organisation only now: his Task history is already written.
update public.profiles set status = 'inactiv'
 where id = '25800000-0000-0000-0000-000000000007';

-- Two sanity pins, so the two exclusion assertions below cannot pass vacuously.
select is((select delta from public.points_ledger where note = 'Sanction excluded 258'),
  -7, 'the sanction ledger row really exists -- its exclusion below is not vacuous');
select is((select status::text from public.profiles
            where id = '25800000-0000-0000-0000-000000000007'),
  'inactiv', 'Bogdan really is deactivated -- his appearance below is not vacuous');

-- ==================== 3. The unfiltered board ====================

select pg_temp.test_login_leadership('25800000-0000-0000-0000-000000000001');

select is((select points from public.leadership_leaderboard()
            where member_id = '25800000-0000-0000-0000-000000000002'), 39,
  'unfiltered, the Executor carries all three Task awards (12 + 15 + 12) and the -7 sanction is not among them');

select is((select count(*) from public.leadership_leaderboard()
            where member_id = '25800000-0000-0000-0000-000000000008'), 0::bigint,
  'a member whose only award was reversed nets to zero and is not a row at all');

select is((select points from public.leadership_leaderboard()
            where member_id = '25800000-0000-0000-0000-000000000007'), 3,
  'a deactivated member with completed Task history stays on the board -- eligibility is history, not Profile status');

-- ==================== 4. The Department filter ====================
-- ADR-0007: the filters apply to the Task that produced the points, never to
-- the member's current memberships. None of these fixtures belongs to 258-dept.

select is((select points from public.leadership_leaderboard('258-dept')
            where member_id = '25800000-0000-0000-0000-000000000002'), 27,
  'the Department filter sums the Department Task (12) and the Department-Team Task (15) and drops the Project Task (12)');

-- The two members on 3 points are ranks 2 and 3, not 2 and 2: `full_name` sits
-- inside the rank window's `order by`, so the window has no peer groups. That
-- is the agreed signature (plan Task G1) and the one place this board differs
-- from the legacy `public.leaderboard`, which ranks on points alone and does
-- share a rank across ties. This assertion is what keeps the two from being
-- "aligned" by accident later.
select results_eq(
  $$ select full_name, points, rank from public.leadership_leaderboard('258-dept') $$,
  $$ values ('Mihai Executor 258'::text, 27, 1),
            ('Ana Egalitate 258',        3,  2),
            ('Bogdan Dezactivat 258',    3,  3) $$,
  'the Department board is points-descending with the full-name tiebreak, and equal points take consecutive ranks');

select is((select count(*) from public.leadership_leaderboard('258-dept')
            where member_id = '25800000-0000-0000-0000-000000000008'), 0::bigint,
  'the net-zero member is absent from the filtered board too');

select is((select sum(points)::int from public.leadership_leaderboard('258-dept')), 33,
  'nothing else reaches 258-dept -- the whole Department board is the three qualifying awards');

-- ==================== 5. The Team filter ====================

select is((select count(*) from public.leadership_leaderboard(null, '258-dept-team')), 1::bigint,
  'the Team filter returns only the one member with a Task on that Team');
select is((select points from public.leadership_leaderboard(null, '258-dept-team')
            where member_id = '25800000-0000-0000-0000-000000000002'), 15,
  'and only that Task''s award -- the Department Task the same member also holds is gone');
select is((select rank from public.leadership_leaderboard(null, '258-dept-team')
            where member_id = '25800000-0000-0000-0000-000000000002'), 1,
  'rank is computed over the filtered board, not over the whole organisation');

-- ==================== 6. The Project filter ====================

select is((select count(*) from public.leadership_leaderboard(null, null, 2580003)), 1::bigint,
  'the Project filter returns only the Project Task''s Executor');
select is((select points from public.leadership_leaderboard(null, null, 2580003)
            where member_id = '25800000-0000-0000-0000-000000000002'), 12,
  'Project work is on the Leaderboard -- unlike the Department Cup, which excludes it');
select is((select count(*) from public.leadership_leaderboard('258-dept', null, 2580003)), 0::bigint,
  'a Project Task has no Department, so no Department filter can reach it -- and filters combine with `and`');

-- ==================== 7. The Campaign filter ====================

select is((select points from public.leadership_leaderboard(null, null, null, 2580001)
            where member_id = '25800000-0000-0000-0000-000000000002'), 12,
  'Campania A shows only its own award for the Executor');
select is((select points from public.leadership_leaderboard(null, null, null, 2580002)
            where member_id = '25800000-0000-0000-0000-000000000002'), 15,
  'Campania B shows a different total for the same member -- the Campaign filter really discriminates');
select is((select count(*) from public.leadership_leaderboard(null, null, null, 2580002)), 1::bigint,
  'nobody else earned under Campania B');
select results_eq(
  $$ select full_name, points, rank from public.leadership_leaderboard(null, null, null, 2580001) $$,
  $$ values ('Mihai Executor 258'::text, 12, 1),
            ('Ana Egalitate 258',        3,  2),
            ('Bogdan Dezactivat 258',    3,  3) $$,
  'Campania A ranks its own three earners, the reversed award still netting its member off the board');
select is((select count(*) from public.leadership_leaderboard(null, null, null, -1)), 0::bigint,
  'an unknown Campaign id yields an empty board, not the unfiltered one');

-- ==================== 8. The BCE+ gate returns no rows, never an error ====================

select pg_temp.test_login_leadership('25800000-0000-0000-0000-000000000002');
select is((select count(*) from public.leadership_leaderboard()), 0::bigint,
  'an ordinary Member (level 2) sees no protected rows');
select is((select count(*) from public.leadership_leaderboard('258-dept')), 0::bigint,
  'an ordinary Member gets no rows from a filtered read either -- and no error');
select is((select count(*) from public.leadership_leaderboard()
            where member_id = '25800000-0000-0000-0000-000000000002'), 0::bigint,
  'not even their own row: this surface is leadership-only, `public.my_points` is the member''s own total');

-- Ruling 5: the threshold is pinned by the rank immediately below it.
select pg_temp.test_login_leadership('25800000-0000-0000-0000-000000000004');
select is((select count(*) from public.leadership_leaderboard()), 0::bigint,
  'a responsabil (level 4, one rank below the gate) sees no protected rows');
select is((select count(*) from public.leadership_leaderboard('258-dept')), 0::bigint,
  'a responsabil gets no rows from a filtered read either -- the gate is >= 5, not >= 4');

-- …and the allow side by a rank above the one that would otherwise carry it.
select pg_temp.test_login_leadership('25800000-0000-0000-0000-000000000005');
select is((select count(*) from public.leadership_leaderboard('258-dept')), 3::bigint,
  'a BC (level 6) also sees the Leaderboard -- the gate is >= 5, not = 5');
select is((select points from public.leadership_leaderboard('258-dept')
            where member_id = '25800000-0000-0000-0000-000000000002'), 27,
  'a BC sees the same filtered totals a BCE would');

select pg_temp.test_login('25800000-0000-0000-0000-000000000002',
  '{"member_role":"bce","member_level":5,"dept_ids":[],"team_ids":[]}'::jsonb);
select is((select count(*) from public.leadership_leaderboard()), 0::bigint,
  'a stale BCE claim loses to the live role: demotion takes effect before the token expires');

select pg_temp.test_login_leadership('25800000-0000-0000-0000-000000000003');
select is((select count(*) from public.leadership_leaderboard()), 0::bigint,
  'an inactive BCE sees no protected rows despite live leadership claims');

select pg_temp.test_login('25800000-0000-0000-0000-000000000001', '{}'::jsonb);
select is((select count(*) from public.leadership_leaderboard()), 0::bigint,
  'a claimless session sees no board, even as a real active BCE uid');
select is((select count(*) from public.leadership_leaderboard('258-dept')), 0::bigint,
  'a claimless session gets no rows from a filtered read either');

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok('select * from public.leadership_leaderboard()', '42501', null,
  'anon holds no grant on the leadership Leaderboard');
select throws_ok(
  'select * from private.leadership_leaderboard_impl(null, null, null, null)', '42501', null,
  'anon cannot reach the body behind it either');
reset role;

select * from finish();
rollback;
