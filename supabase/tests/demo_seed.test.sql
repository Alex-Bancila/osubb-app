-- demo_seed.test.sql — Epic 5.2a: the demo logins.
-- These assert `supabase/seed.sql`, which runs on `db reset` and on `start`
-- (local and staging only — never production). If you run the suite against a
-- database seeded with `--no-seed`, this file is the one that will complain.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(41);

-- ==================== One login per role (AC) ====================
select is((select count(*) from profiles where email like '%@demo.osubb'), 8::bigint,
  'eight demo members exist');

select is(
  (select count(distinct role) from profiles where email like '%@demo.osubb'), 8::bigint,
  'one per role — every rung of the ladder can be demoed');

select is(
  (select count(*) from profiles p
     join roles r on r.id = p.role
    where p.email like '%@demo.osubb' and r.level = 6),
  1::bigint, 'exactly one BC, so "log in as BC" is unambiguous');

-- ==================== They can actually log in ====================
-- Password auth is a demo convenience; real onboarding is passwordless
-- (ADR-0003). What matters here is that the rows GoTrue reads are well-formed.
select is(
  (select count(*) from auth.users
    where email like '%@demo.osubb' and encrypted_password is not null),
  8::bigint, 'each demo account has a password hash');

select is(
  (select count(*) from auth.users
    where email like '%@demo.osubb' and email_confirmed_at is not null),
  8::bigint, 'each demo account is confirmed, so login is not blocked');

-- The trap this test exists for: GoTrue scans these columns as NOT NULL
-- strings. Leave one null and every login fails with a 500 and "converting
-- NULL to string is unsupported" — which reads as a broken app, not a broken
-- fixture. It cost an afternoon once.
select is(
  (select count(*) from auth.users
    where email like '%@demo.osubb'
      and (confirmation_token is null or recovery_token is null
        or email_change_token_new is null or email_change is null
        or email_change_token_current is null or phone_change is null
        or phone_change_token is null or reauthentication_token is null)),
  0::bigint, 'no demo account has null auth token columns (GoTrue reads them as text)');

-- ==================== Shape the screens need ====================
select ok(
  not exists (select 1 from profiles p
               where p.email like '%@demo.osubb'
                 and not exists (select 1 from member_departments md
                                  where md.member_id = p.id)),
  'every demo member belongs to at least one department');

select ok(
  (select count(distinct dept_id) from member_departments md
     join profiles p on p.id = md.member_id
    where p.email like '%@demo.osubb'
      and md.dept_id in (select id from departments where kind = 'department')) >= 3,
  'demo members span several real departments (the dept cup needs something to compare)');

select is((select count(*) from teams where id in ('t-app', 't-recruti', 't-logistica')), 3::bigint,
  'all representative demo teams exist');

select is((select count(*) from teams where id = 't-logistica' and dept_id is null), 1::bigint,
  'the demo cohort includes an Independent Team');

select is((select count(*) from teams where id = 't-recruti' and for_recruits), 1::bigint,
  'one team is open to recruits — the branch the calendar rule turns on');

select ok(
  exists (select 1 from member_departments
           where member_id = 'd0000000-0000-0000-0000-000000000006' and dept_id = 'diverse'),
  'bce@ demo account belongs to Diverse'
);
select ok(
  exists (select 1 from team_members
           where member_id = 'd0000000-0000-0000-0000-000000000008' and team_id = 'it'),
  'moderator@ demo account is on the IT team'
);

-- ==================== Project authorization scenarios ====================
-- These rows are local/staging fixtures for Project policy and future Task
-- origin work. Test the relationships by stable names and demo identities;
-- generated Project ids may advance when staging is seeded again.
select is(
  (select count(*) from projects
    where name in ('Festivalul Studențesc 2026', 'Gala Voluntarilor 2025')),
  2::bigint,
  'the demo contains one active and one historical Project');

select ok(
  exists (select 1 from projects
           where name = 'Festivalul Studențesc 2026' and status = 'active')
  and exists (select 1 from projects
               where name = 'Gala Voluntarilor 2025' and status = 'archived'),
  'active and archived Project lifecycles are both represented');

select is(
  (select count(*)
     from projects p
     join project_members pm
       on pm.project_id = p.id
      and pm.member_id = p.leader_id
    where p.name in ('Festivalul Studențesc 2026', 'Gala Voluntarilor 2025')),
  2::bigint,
  'each demo Project lead is also an explicit Project member');

select ok(
  exists (
    select 1
      from projects p
      join project_members pm on pm.project_id = p.id
     where p.name = 'Festivalul Studențesc 2026'
       and pm.member_id = 'd0000000-0000-0000-0000-000000000003'
       and pm.project_role = 'responsible'
  )
  and exists (
    select 1
      from projects p
      join project_members pm on pm.project_id = p.id
     where p.name = 'Festivalul Studențesc 2026'
       and pm.member_id = 'd0000000-0000-0000-0000-000000000002'
       and pm.project_role = 'member'
  ),
  'the active Project has a Responsible and an ordinary member');

select ok(
  exists (
    select 1
      from projects p
      join project_members pm on pm.project_id = p.id
     where p.name = 'Gala Voluntarilor 2025'
       and pm.member_id = 'd0000000-0000-0000-0000-000000000006'
       and pm.project_role = 'responsible'
  )
  and exists (
    select 1
      from projects p
      join project_members pm on pm.project_id = p.id
     where p.name = 'Gala Voluntarilor 2025'
       and pm.member_id = 'd0000000-0000-0000-0000-000000000001'
       and pm.project_role = 'member'
  ),
  'the archived Project preserves a representative historical roster');

select is(
  (select count(*)
     from projects p
     left join project_members pm
       on pm.project_id = p.id
      and pm.member_id = 'd0000000-0000-0000-0000-000000000001'
    where p.name = 'Festivalul Studențesc 2026'
      and pm.member_id is null),
  1::bigint,
  'the active Project has a known outsider for authorization checks');

-- ==================== The demo has to look alive ====================
-- These are about the *demo*, not the engine: a leaderboard where everyone
-- has the same score, or a tracker with one status, demos badly. The points
-- engine itself is covered by points_engine.test.sql.
select ok((select count(*) from tasks) >= 15,
  'enough tasks to fill a tracker');

select is((select count(distinct status) from tasks), 3::bigint,
  'the seeded Tasks cover todo, in-progress, and completed work');

select ok((select count(*) from tasks
            where status = 'todo' and audience = 'org'
              and assignment_mode = 'public') >= 2,
  'public organization opportunities exist for the "Deschise" tab');

select ok(
  not exists (
    select 1
      from tasks task
      join profiles creator on creator.id = task.created_by
     where task.status = 'todo'
       and task.assignment_mode = 'public'
       and task.audience <> 'org'
       and creator.email like '%@demo.osubb'
  ),
  'legacy open demo Tasks retain organization-wide reach');

select ok(
  not exists (
    select 1
      from tasks task
      join profiles creator on creator.id = task.created_by
     where task.status = 'todo'
       and task.audience = 'org'
       and task.assignment_mode <> 'public'
       and creator.email like '%@demo.osubb'
  ),
  'legacy open demo Tasks retain public assignment');

-- #317: points come from Evaluations now, not from a trigger on `tasks`, and
-- `tasks.points` no longer exists. Every task ledger row must still name the
-- Evaluation that produced it and carry exactly that Evaluation's points,
-- and every Evaluation must still equal Difficulty × the Rating multiplier.
-- If someone starts hand-writing 'task' ledger rows in the seed, this drifts
-- from the formula and the number on screen stops meaning anything.
select is(
  (select count(*) from points_ledger ledger
     left join task_evaluations evaluation on evaluation.id = ledger.evaluation_id
    where ledger.reason = 'task'
      and (evaluation.id is null
           or ledger.delta <> evaluation.points
           or evaluation.points <> evaluation.difficulty * rating_mult(evaluation.rating))),
  0::bigint,
  'every task ledger row names its Evaluation and carries that Evaluation''s scoring-guide points');

-- One Evaluation per graded demo Task × participant — the same count the
-- retired trigger produced, so the demo totals below are the numbers the
-- demo has always shown.
select is(
  (select count(*) from task_evaluations evaluation
     join tasks task on task.id = evaluation.task_id
     join profiles creator on creator.id = task.created_by
    where creator.email like '%@demo.osubb'),
  (select count(*) from task_assignees assignee
     join tasks task on task.id = assignee.task_id
     join profiles creator on creator.id = task.created_by
    where creator.email like '%@demo.osubb'
      and task.rating is not null),
  'the demo carries exactly one Evaluation per graded Task participant');

-- The one legacy-shaped demo Task (two participants, two credits) is kept
-- deliberately — it is the shape #316 Ruling 11 and #317 backfill exist
-- for, and a demo without it never exercises a multi-credit Task.
select is(
  (select count(*) from task_evaluations where source = 'legacy_migration'),
  2::bigint,
  'the multi-participant demo Task keeps its two legacy-shaped credits');

select is(
  (select count(*) from task_evaluations
    where source = 'legacy_migration' and evaluated_by is not null),
  0::bigint,
  'no legacy-shaped demo Evaluation invents an evaluator');

-- ==================== The four points views still agree (#317 AC) ====================
-- member_points is the base sum; leaderboard and dept_cup are derived from
-- it, and my_points is one member's own row of it. After the ledger moved
-- onto Evaluations they must still report the same numbers as the raw
-- ledger, or a member sees one total on the dashboard and another on the
-- leaderboard.
select is(
  (select count(*) from member_points mp
     where mp.points is distinct from coalesce(
       (select sum(l.delta)::int from points_ledger l where l.member_id = mp.member_id), 0)),
  0::bigint, 'member_points equals the raw ledger sum for every member');

select is(
  (select count(*) from leaderboard lb
     join member_points mp on mp.member_id = lb.member_id
    where lb.points is distinct from mp.points),
  0::bigint, 'leaderboard reports member_points unchanged');

select is(
  (select count(*) from dept_cup cup
    where cup.points is distinct from coalesce((
      select sum(mp.points)::int
        from member_departments md
        join profiles member on member.id = md.member_id and member.status = 'activ'
        join member_points mp on mp.member_id = member.id
       where md.dept_id = cup.dept_id), 0)),
  0::bigint, 'dept_cup sums its active members'' member_points totals');

-- my_points is the ordinary member's own-total endpoint, and member_points is
-- leadership-only, so the two can never be compared from one session:
-- capture the leadership totals here, as the owner, and compare from inside
-- each member's own session below.
create temp table demo_totals as
  select member_id, points from member_points;
grant select on demo_totals to authenticated;

-- Ioana holds task credit only; Maria holds credit and a sanction, which is
-- the combination the endpoint has to get right.
select pg_temp.test_login('d0000000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1,
  'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select results_eq(
  $$ select points from public.my_points $$,
  $$ select points from demo_totals
      where member_id = 'd0000000-0000-0000-0000-000000000001' $$,
  'my_points returns the same total member_points holds for that member');
reset role;

select pg_temp.test_login('d0000000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1,
  'dept_ids', '["pr"]'::jsonb, 'team_ids', '[]'::jsonb));
select results_eq(
  $$ select points from public.my_points $$,
  $$ select points from demo_totals
      where member_id = 'd0000000-0000-0000-0000-000000000003' $$,
  'a member with both task credit and a sanction sees the same net total');
reset role;

select ok(
  exists (select 1 from points_ledger where reason = 'sanction'),
  'a sanction is present as a separate governance adjustment');

-- A penalty in the data is deliberate: a demo where nobody ever lost points
-- hides half of the scoring guide.
select ok(
  exists (select 1 from points_ledger where reason = 'task' and delta < 0),
  'at least one task was graded 1, so the leaderboard shows a real penalty');

-- ==================== Calendar, feed, notifications ====================
-- The calendar only demos well if switching accounts changes what you see,
-- which needs one event per branch of the §4.4 visibility rule.
select ok((select count(*) from events) >= 6,
  'the calendar has something in it');

select ok(
  (select count(*) from events where scope = 'org') >= 1
  and (select count(*) from events where scope = 'dept') >= 1
  and (select count(*) from events where scope = 'team') >= 1,
  'org, department and team events all exist — switching demo accounts changes the calendar');

select ok(
  exists (select 1 from events e join teams t on t.id = e.team_id where t.for_recruits),
  'a for_recruits team event exists (what a recrut sees without belonging)');

select ok(
  exists (select 1 from event_attendance where status = 'declined')
  and exists (select 1 from event_attendance where status = 'going'),
  'RSVPs go both ways, so the toggle has two visible states');

-- The feed's loudest state and the v1 forms story both need to be visible.
select ok(
  exists (select 1 from announcements where priority = 'critical' and pinned),
  'a critical pinned announcement exists (the feed''s loudest state)');

select ok(
  exists (select 1 from announcements where form_url is not null),
  'one announcement links a form — the v1 forms story is a Google Form link');

select * from finish();
rollback;
