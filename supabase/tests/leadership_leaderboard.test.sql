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

select plan(60);
create function pg_temp.g523_group(p_dept text default null, p_team text default null, p_project bigint default null)
returns bigint language sql stable as $$
  select coalesce((select id from public.groups where id = pg_temp.dept_group(p_dept) or id = pg_temp.team_group(p_team) or id = pg_temp.project_group(p_project)),-1)
$$;

-- ==================== 1. Surface, shape and grants ====================

select has_function('public', 'leadership_leaderboard',
  array['bigint', 'bigint'],
  'the filtered leadership Leaderboard read exists');
select has_function('private', 'leadership_leaderboard_impl',
  array['bigint', 'bigint'],
  'its security-definer body exists in private');

-- ADR-0007: "The leadership Leaderboard contains member name and Task points
-- only." Pinning the result type is what keeps a later "while we are here"
-- commit from adding role, email or Department to a leadership export.
select is(
  pg_get_function_result('public.leadership_leaderboard(bigint, bigint)'::regprocedure),
  'TABLE(member_id uuid, full_name text, nickname text, points integer, rank integer)',
  'the board returns member id, full name, Nickname (#675), points and rank -- no role, no email, no Department');

select is(
  (select prosecdef from pg_proc where oid = 'public.leadership_leaderboard(bigint, bigint)'::regprocedure),
  false, 'the public wrapper is security invoker');
select is(
  (select prosecdef from pg_proc where oid = 'private.leadership_leaderboard_impl(bigint, bigint)'::regprocedure),
  true, 'the private body is security definer -- it reads the whole ledger past RLS and gates itself');

select ok(has_function_privilege('authenticated', 'public.leadership_leaderboard(bigint, bigint)', 'EXECUTE'),
  'authenticated may execute the leadership Leaderboard');
select ok(not has_function_privilege('anon', 'public.leadership_leaderboard(bigint, bigint)', 'EXECUTE'),
  'anon cannot execute the leadership Leaderboard');
select ok(has_function_privilege('authenticated', 'private.leadership_leaderboard_impl(bigint, bigint)', 'EXECUTE'),
  'authenticated may execute the body -- the security-invoker wrapper calls it as the caller');
select ok(not has_function_privilege('anon', 'private.leadership_leaderboard_impl(bigint, bigint)', 'EXECUTE'),
  'anon cannot reach the body directly');
select ok(not has_function_privilege('service_role', 'private.leadership_leaderboard_impl(bigint, bigint)', 'EXECUTE'),
  'the server role cannot bypass the BCE+ gate through the private body');

-- #258 is additive. `app/src/queries/points.ts` still reads the legacy
-- all-ledger view for the Dashboard card (and `public.dept_cup` beside it);
-- plan Task J1 moves those cards onto this function and `public.department_cup`,
-- and #376 retires the views afterwards. Dropping any of them here would break
-- the Dashboard, so all three points surfaces the frontend reads are pinned --
-- not `leaderboard` alone.
select has_view('public', 'leaderboard',
  'the legacy all-ledger Leaderboard view is untouched -- the Dashboard card still reads it until J1 and #376');
select has_view('public', 'dept_cup',
  'the Department Cup view is untouched -- `app/src/queries/points.ts` reads it for the Dashboard card until J1 and #376');
select has_view('public', 'member_points',
  'the personal-total view is untouched -- it backs `public.my_points`, which is where a sanction shows and this board never does');

-- ==================== 2. Fixtures ====================

insert into auth.users (id, email) values
  ('25800000-0000-0000-0000-000000000001', 'bce258@example.test'),
  ('25800000-0000-0000-0000-000000000002', 'executor258@example.test'),
  ('25800000-0000-0000-0000-000000000003', 'inactivebce258@example.test'),
  ('25800000-0000-0000-0000-000000000004', 'responsabil258@example.test'),
  ('25800000-0000-0000-0000-000000000005', 'bc258@example.test'),
  ('25800000-0000-0000-0000-000000000006', 'egalitate258@example.test'),
  ('25800000-0000-0000-0000-000000000007', 'dezactivat258@example.test'),
  ('25800000-0000-0000-0000-000000000008', 'anulata258@example.test'),
  ('25800000-0000-0000-0000-000000000009', 'moderator258@example.test'),
  ('25800000-0000-0000-0000-000000000010', 'independenta258@example.test'),
  ('25800000-0000-0000-0000-000000000011', 'negativ258@example.test'),
  ('25800000-0000-0000-0000-000000000012', 'diversa258@example.test');

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
  ('25800000-0000-0000-0000-000000000008', 'Zoia Anulata 258', 'anulata258@example.test', 'activ', 'activ'),
  -- Level 9 -- the public function's comment promises the board to
  -- "BCE, BC, and Moderator Members"; without this persona the allow side of
  -- the gate rests on two roles when it claims three.
  ('25800000-0000-0000-0000-000000000009', 'Moderator 258', 'moderator258@example.test', 'moderator', 'activ'),
  -- Earns on an *Independent* Team (no parent Department): on the board
  -- unfiltered and under the Team filter, reachable by no Department filter.
  ('25800000-0000-0000-0000-000000000010', 'Ilinca Independenta 258', 'independenta258@example.test', 'activ', 'activ'),
  -- Keeps one negative Evaluation and has a positive award reversed: net -3,
  -- so "a reversal subtracts" is pinned in the negative as well as at zero.
  ('25800000-0000-0000-0000-000000000011', 'Nicu Negativ 258', 'negativ258@example.test', 'activ', 'activ'),
  -- Earns on `diverse` (kind = 'coordination'): a valid Leaderboard filter
  -- that the Department Cup never competes.
  ('25800000-0000-0000-0000-000000000012', 'Dana Diversa 258', 'diversa258@example.test', 'activ', 'activ');

-- A Department of this suite's own, so the Department filter below returns
-- exactly these fixtures and never a seeded Task on `edu`. `departments.kind`
-- defaults to 'department', so 258-dept competes in the Department Cup too --
-- which is what lets the cross-check in section 9 see these fixtures.
insert into pg_temp.fixture_departments (id, name, short, color) values
  ('258-dept', 'Departament 258', 'D258', '#123456');
-- Two Teams: one with a parent Department and one **Independent**
-- (`dept_id is null`). ADR-0007 and `private.department_cup_rows` both treat
-- the Independent Team as its own case, and `origin_team.dept_id =
-- p_department_id` is only correct because `null = 'x'` is `null`.
insert into pg_temp.fixture_teams (id, name, dept_id) values
  ('258-dept-team', 'Department Team 258', '258-dept'),
  ('258-indep-team', 'Independent Team 258', null);
-- #586: materialize this suite's legacy setup as rolled-back Group fixtures.
select pg_temp.materialize_legacy_groups();


-- `campaigns.id` and `projects.id` are GENERATED ALWAYS, so the fixture
-- overrides them: the Campaign and Project filters are asserted against
-- literal ids, which beats threading a lookup through every assertion.
insert into public.campaigns (id, group_id, name, created_by)
overriding system value values
  (2580001, pg_temp.dept_group('258-dept'), 'Campania A 258', '25800000-0000-0000-0000-000000000001'),
  (2580002, pg_temp.dept_group('258-dept'), 'Campania B 258', '25800000-0000-0000-0000-000000000001');

insert into pg_temp.fixture_projects (id, name, status, leader_id, created_by)
overriding system value values
  (2580003, 'Project 258', 'active', '25800000-0000-0000-0000-000000000001',
   '25800000-0000-0000-0000-000000000001'),
  -- A Project of its own for the negative-net member, so his rows reach no
  -- Department filter and no Campaign, and disturb none of the counts above.
  (2580004, 'Project Negativ 258', 'active', '25800000-0000-0000-0000-000000000001',
   '25800000-0000-0000-0000-000000000001');
select pg_temp.materialize_legacy_groups();

-- Every Task is already evaluated; `pg_temp.test_credit_task` writes the
-- Assignment, the Evaluation and the ledger entry. Most fixtures use Rating 5
-- (`difficulty x 3`); Nicu's kept Evaluation uses Rating 1 (`difficulty x -1`)
-- so reversing his separate positive award leaves a genuinely negative net.
insert into public.tasks
  (title, description, deadline, group_id, campaign_id,
   status, difficulty, rating, created_by, created_at, completed_at)
select fixture.title, 'Fixture', now() - interval '2 days',
       coalesce(pg_temp.dept_group(fixture.dept_id), pg_temp.team_group(fixture.team_id),
                pg_temp.project_group(fixture.project_id)), fixture.campaign_id,
       'completed', fixture.difficulty, fixture.rating,
       '25800000-0000-0000-0000-000000000001',
       -- completed_at is `now()`: test_credit_task ends the Assignment at
       -- completed_at, and task_assignments_end_chronology_ck refuses an end
       -- before the Assignment's own start.
       now() - interval '3 days', now()
  from (values
    -- Mihai, Campaign A, straight on the Department: 4 x 3 = 12.
    ('LB Department Task 258',      '258-dept'::text, null::text,      null::bigint, 2580001::bigint, 4, 5),
    -- Mihai, Campaign B, on a Department Team whose parent is 258-dept:
    -- 5 x 3 = 15. The Department filter must reach this one too.
    ('LB Department Team Task 258', null,             '258-dept-team', null,         2580002,         5, 5),
    -- Mihai, no Campaign, Project Origin: 4 x 3 = 12. Unreachable from any
    -- Department filter, present unfiltered.
    ('LB Project Task 258',         null,             null,            2580003,      null,            4, 5),
    -- Zoia, Campaign A: 3 x 3 = 9, reversed below to a net of zero.
    ('LB Reversed Task 258',        '258-dept',       null,            null,         2580001,         3, 5),
    -- Bogdan, Campaign A: 1 x 3 = 3, earned while still activ.
    ('LB Deactivated Task 258',     '258-dept',       null,            null,         2580001,         1, 5),
    -- Ana, Campaign A: 1 x 3 = 3 -- the tie that shares a rank with Bogdan's.
    ('LB Tie Task 258',             '258-dept',       null,            null,         2580001,         1, 5),
    -- Ilinca, Independent Team (no parent Department): 2 x 3 = 6. Present
    -- unfiltered and under the Team filter, unreachable from any Department.
    ('LB Independent Team Task 258', null,            '258-indep-team', null,        null,            2, 5),
    -- Nicu keeps 3 x -1 = -3 on his own Project…
    ('LB Negative Kept Task 258',   null,             null,            2580004,      null,            3, 1),
    -- …and has 3 x 3 = 9 reversed below: that Task nets to zero, so his total
    -- stays at the kept -3 instead of disappearing from the board.
    ('LB Negative Reversed Task 258', null,           null,            2580004,      null,            3, 5),
    -- Dana, on a coordination Department: 2 x 3 = 6. A legal Leaderboard
    -- filter; never a Department Cup row.
    ('LB Diverse Task 258',         'diverse',        null,            null,         null,            2, 5)
  ) as fixture (title, dept_id, team_id, project_id, campaign_id, difficulty, rating);

select pg_temp.test_credit_task(task.id, credit.member_id,
                                '25800000-0000-0000-0000-000000000001')
  from (values
    ('LB Department Task 258',      '25800000-0000-0000-0000-000000000002'::uuid),
    ('LB Department Team Task 258', '25800000-0000-0000-0000-000000000002'),
    ('LB Project Task 258',         '25800000-0000-0000-0000-000000000002'),
    ('LB Reversed Task 258',        '25800000-0000-0000-0000-000000000008'),
    ('LB Deactivated Task 258',     '25800000-0000-0000-0000-000000000007'),
    ('LB Tie Task 258',             '25800000-0000-0000-0000-000000000006'),
    ('LB Independent Team Task 258', '25800000-0000-0000-0000-000000000010'),
    ('LB Negative Kept Task 258',   '25800000-0000-0000-0000-000000000011'),
    ('LB Negative Reversed Task 258', '25800000-0000-0000-0000-000000000011'),
    ('LB Diverse Task 258',         '25800000-0000-0000-0000-000000000012')
  ) as credit (title, member_id)
  join public.tasks as task on task.title = credit.title
 order by task.id;

-- Reverse Zoia's only award, and the larger of Nicu's two, exactly the way
-- reopen_task does.
update public.task_evaluations as evaluation
   set reversed_at = now(),
       reversed_by = '25800000-0000-0000-0000-000000000001',
       reversal_reason = 'fixture reversal 258'
  from public.tasks as task
 where task.id = evaluation.task_id
   and task.title in ('LB Reversed Task 258', 'LB Negative Reversed Task 258');

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

select is((select array_agg(entry.delta order by entry.delta)
             from public.points_ledger as entry
             join public.task_evaluations as evaluation on evaluation.id = entry.evaluation_id
            where entry.reason = 'task_reversal'
              and evaluation.reversal_reason = 'fixture reversal 258'),
  array[-9, -9],
  'both reversal ledger rows exist and are negative -- the netting assertions below are not vacuous');

-- ==================== 3. The unfiltered board ====================

select pg_temp.test_login_leadership('25800000-0000-0000-0000-000000000001');

select is((select points from public.leadership_leaderboard()
            where member_id = '25800000-0000-0000-0000-000000000002'), 39,
  'unfiltered, the Executor carries all three Task awards (12 + 15 + 12) and the -7 sanction is not among them');

-- A reversal *subtracts*; it does not make its member disappear, and it is not
-- an absence the suite could pin without also passing for a board that ignored
-- reversals entirely. These two assertions are the only proof in this file that
-- `task_reversal` is netted at all: summing `abs(delta)` would read 18 and 21
-- here, and dropping `task_reversal` from the reason list would read 9 and 6.
select is((select points from public.leadership_leaderboard()
            where member_id = '25800000-0000-0000-0000-000000000008'), 0,
  'a member whose only award was reversed appears at exactly zero -- the reversal is subtracted from the award, not ignored and not double-counted');

select is((select points from public.leadership_leaderboard()
            where member_id = '25800000-0000-0000-0000-000000000011'), -3,
  'a member who keeps a negative Evaluation after a separate positive award is reversed carries that negative net (-3 + 9 - 9) -- a member with Task history is a row whatever it sums to');

select is((select points from public.leadership_leaderboard()
            where member_id = '25800000-0000-0000-0000-000000000007'), 3,
  'a deactivated member with completed Task history stays on the board -- eligibility is history, not Profile status');

-- ==================== 3b. Independent Teams belong to no Department ====================
-- Independent Group work remains on its own subtree and the global board.

select is((select points from public.leadership_leaderboard()
            where member_id = '25800000-0000-0000-0000-000000000010'), 6,
  'work on an Independent Team is on the unfiltered board -- the Leaderboard keeps what the Department Cup drops');
select is((select count(*) from public.leadership_leaderboard(pg_temp.g523_group(p_team=>'258-indep-team'))), 1::bigint,
  'the Team filter reaches an Independent Team like any other');
select is((select points from public.leadership_leaderboard(pg_temp.g523_group(p_team=>'258-indep-team'))
            where member_id = '25800000-0000-0000-0000-000000000010'), 6,
  'and returns that Team''s award');
select is((select count(*)
             from pg_temp.fixture_departments as department
             left join lateral public.leadership_leaderboard(pg_temp.g523_group(department.id)) as board on true
            where board.member_id = '25800000-0000-0000-0000-000000000010'), 0::bigint,
  'no Department filter at all reaches an Independent Team''s work -- not one of them, not just 258-dept');
select is((select count(*) from public.leadership_leaderboard(-1)), 0::bigint,
  'an unknown Group id returns no work');

-- ==================== 4. The Department filter ====================

-- #675: the board names a Member by Nickname beside the full name.
select pg_temp.test_clear_jwt();
reset role;
update public.profiles set nickname = 'Mihai 258'
 where id = '25800000-0000-0000-0000-000000000002';
select pg_temp.test_login_leadership('25800000-0000-0000-0000-000000000001');
select is((select nickname from public.leadership_leaderboard(pg_temp.g523_group('258-dept'))
            where member_id = '25800000-0000-0000-0000-000000000002'), 'Mihai 258',
  'the board returns the Member''s Nickname beside the full name (#675)');
-- ADR-0007: the filters apply to the Task that produced the points, never to
-- the member's current memberships. None of these fixtures belongs to 258-dept.

select is((select points from public.leadership_leaderboard(pg_temp.g523_group('258-dept'))
            where member_id = '25800000-0000-0000-0000-000000000002'), 27,
  'the Department filter sums the Department Task (12) and the Department-Team Task (15) and drops the Project Task (12)');

-- The two members on 3 points **share** rank 2, and the next row is rank 4 --
-- the standard `rank()` gap. That matches the legacy `public.leaderboard`
-- (`rank() over (order by points desc)`), which is the board BC and BCE read
-- today. `full_name` orders the *rows*, never the window: put it back inside
-- the window and `rank` degenerates into a row number (2, 3, 4), which is what
-- this assertion catches.
select results_eq(
  $$ select full_name, points, rank from public.leadership_leaderboard(pg_temp.g523_group('258-dept')) $$,
  $$ values ('Mihai Executor 258'::text, 27, 1),
            ('Ana Egalitate 258',        3,  2),
            ('Bogdan Dezactivat 258',    3,  2),
            ('Zoia Anulata 258',         0,  4) $$,
  'the Department board is points-descending with a full-name tiebreak on the rows, equal points share a rank, and the rank after a tie skips');

select is((select points from public.leadership_leaderboard(pg_temp.g523_group('258-dept'))
            where member_id = '25800000-0000-0000-0000-000000000008'), 0,
  'the net-zero member is a row on the filtered board too, at zero -- the reversal nets under a filter exactly as it does unfiltered');

-- Still 33: Zoia contributes +9 and -9, so admitting her row changes the board's
-- membership without changing its arithmetic. If this ever reads 42, a reversal
-- stopped being subtracted.
select is((select sum(points)::int from public.leadership_leaderboard(pg_temp.g523_group('258-dept'))), 33,
  'nothing else reaches 258-dept -- the whole Department board is the three qualifying awards and one reversed one');

-- ==================== 5. The Team filter ====================

select is((select count(*) from public.leadership_leaderboard(pg_temp.g523_group(p_team=>'258-dept-team'))), 1::bigint,
  'the Team filter returns only the one member with a Task on that Team');
select is((select points from public.leadership_leaderboard(pg_temp.g523_group(p_team=>'258-dept-team'))
            where member_id = '25800000-0000-0000-0000-000000000002'), 15,
  'and only that Task''s award -- the Department Task the same member also holds is gone');
select is((select rank from public.leadership_leaderboard(pg_temp.g523_group(p_team=>'258-dept-team'))
            where member_id = '25800000-0000-0000-0000-000000000002'), 1,
  'rank is computed over the filtered board, not over the whole organisation');

-- ==================== 6. The Project filter ====================

select is((select count(*) from public.leadership_leaderboard(pg_temp.g523_group(p_project=>2580003))), 1::bigint,
  'the Project filter returns only the Project Task''s Executor');
select is((select points from public.leadership_leaderboard(pg_temp.g523_group(p_project=>2580003))
            where member_id = '25800000-0000-0000-0000-000000000002'), 12,
  'Project work is on the Leaderboard -- unlike the Department Cup, which excludes it');
select is((select count(*) from public.leadership_leaderboard(pg_temp.g523_group(p_project=>2580003), 2580001)), 0::bigint,
  'a Project Group combined with a Department Campaign has no matching work');

-- ==================== 7. The Campaign filter ====================

select is((select points from public.leadership_leaderboard(null, 2580001)
            where member_id = '25800000-0000-0000-0000-000000000002'), 12,
  'Campania A shows only its own award for the Executor');
select is((select points from public.leadership_leaderboard(null, 2580002)
            where member_id = '25800000-0000-0000-0000-000000000002'), 15,
  'Campania B shows a different total for the same member -- the Campaign filter really discriminates');
select is((select count(*) from public.leadership_leaderboard(null, 2580002)), 1::bigint,
  'nobody else earned under Campania B');
select results_eq(
  $$ select full_name, points, rank from public.leadership_leaderboard(null, 2580001) $$,
  $$ values ('Mihai Executor 258'::text, 12, 1),
            ('Ana Egalitate 258',        3,  2),
            ('Bogdan Dezactivat 258',    3,  2),
            ('Zoia Anulata 258',         0,  4) $$,
  'Campania A ranks its own four earners with the tie sharing rank 2, the reversed award netting its member to zero at the bottom rather than off the board');
select is((select count(*) from public.leadership_leaderboard(null, -1)), 0::bigint,
  'an unknown Campaign id yields an empty board, not the unfiltered one');

-- ==================== 8. Agreement with the Department Cup ====================
-- The independent attribution query below must see every owned fixture row,
-- including the Department-Team Task that ordinary table RLS hides from this
-- BCE (the reporting functions deliberately read past that RLS and gate
-- themselves). `reset role` restores the transaction owner but does not clear
-- the BCE JWT claims, so both reporting functions still exercise their real
-- BCE+ gates while the comparison query remains independent and complete.
reset role;

-- With every fixture link counting, each competing subtree has the same
-- attribution on the Leaderboard and the Cup. Group settings define this set.
select set_eq(
  $$ select grp.id, board.member_id, board.points
       from public.groups grp
       cross join lateral public.leadership_leaderboard(grp.id) board
      where grp.competes_in_cup $$,
  $$ select grp.id, entry.member_id, sum(entry.delta)::int
       from public.groups grp
       join public.groups origin on origin.path @> array[grp.id]
       join public.tasks task on task.group_id=origin.id
       join public.points_ledger entry on entry.task_id=task.id
      where grp.competes_in_cup and entry.reason in ('task','task_reversal')
      group by grp.id,entry.member_id $$,
  'each competing Group subtree includes the same members and net Task points');
select set_eq(
  $$ select grp.id,coalesce(sum(board.points),0)::int
       from public.groups grp left join lateral public.leadership_leaderboard(grp.id) board on true
      where grp.competes_in_cup group by grp.id $$,
  $$ select group_id,points from public.department_cup() $$,
  'Cup equals subtree Leaderboard totals when every link counts');

select is((select points from public.leadership_leaderboard(pg_temp.g523_group('diverse'))
            where member_id = '25800000-0000-0000-0000-000000000012'), 6,
  'the Leaderboard filters on any Department id, coordination structures included');
select is((select count(*) from public.department_cup() where group_id = pg_temp.dept_group('diverse')), 0::bigint,
  'the Department Cup includes only Groups whose competing setting is enabled');

-- ==================== 9. The BCE+ gate returns no rows, never an error ====================

select pg_temp.test_login_leadership('25800000-0000-0000-0000-000000000002');
select is((select count(*) from public.leadership_leaderboard()), 0::bigint,
  'an ordinary Member (level 2) sees no protected rows');
select is((select count(*) from public.leadership_leaderboard(pg_temp.g523_group('258-dept'))), 0::bigint,
  'an ordinary Member gets no rows from a filtered read either -- and no error');
select is((select count(*) from public.leadership_leaderboard()
            where member_id = '25800000-0000-0000-0000-000000000002'), 0::bigint,
  'not even their own row: this surface is leadership-only, `public.my_points` is the member''s own total');

-- Ruling 5: the threshold is pinned by the rank immediately below it.
select pg_temp.test_login_leadership('25800000-0000-0000-0000-000000000004');
select is((select count(*) from public.leadership_leaderboard()), 0::bigint,
  'a responsabil (level 4, one rank below the gate) sees no protected rows');
select is((select count(*) from public.leadership_leaderboard(pg_temp.g523_group('258-dept'))), 0::bigint,
  'a responsabil gets no rows from a filtered read either -- the gate is >= 5, not >= 4');

-- …and the allow side by every role the function's comment promises it to, not
-- by BCE alone: BC (6) and Moderator (9).
select pg_temp.test_login_leadership('25800000-0000-0000-0000-000000000005');
select is((select count(*) from public.leadership_leaderboard(pg_temp.g523_group('258-dept'))), 4::bigint,
  'a BC (level 6) also sees the Leaderboard -- the gate is >= 5, not = 5');
select is((select points from public.leadership_leaderboard(pg_temp.g523_group('258-dept'))
            where member_id = '25800000-0000-0000-0000-000000000002'), 27,
  'a BC sees the same filtered totals a BCE would');

select pg_temp.test_login_leadership('25800000-0000-0000-0000-000000000009');
select is((select count(*) from public.leadership_leaderboard(pg_temp.g523_group('258-dept'))), 4::bigint,
  'a Moderator (level 9) sees the Leaderboard -- the public function''s comment promises it to BCE, BC *and* Moderator');
select is((select points from public.leadership_leaderboard(pg_temp.g523_group('258-dept'))
            where member_id = '25800000-0000-0000-0000-000000000002'), 27,
  'and the same filtered totals -- the gate is a level threshold, not a role list');

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
select is((select count(*) from public.leadership_leaderboard(pg_temp.g523_group('258-dept'))), 0::bigint,
  'a claimless session gets no rows from a filtered read either');

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok('select * from public.leadership_leaderboard()', '42501', null,
  'anon holds no grant on the leadership Leaderboard');
select throws_ok(
  'select * from private.leadership_leaderboard_impl(null, null)', '42501', null,
  'anon cannot reach the body behind it either');
reset role;

select * from finish();
rollback;
