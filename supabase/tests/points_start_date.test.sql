-- points_start_date.test.sql — R58 (Alex, 2026-10-18), part 2: the Points Start
-- Date (Data de început a punctajului) is applied inside the SQL readers, so
-- every display total counts only the Task Points of Task Evaluations on or
-- after it. Spec docs/superpowers/specs/2026-10-18-portofoliu-interne-design.md,
-- section D.
--
--   0. The invariant the Personal Score relies on: a `task` ledger row is dated
--      by its Evaluation's instant, so my_points never reads task_evaluations.
--   1. Day one: no date set, every reader counts from the beginning.
--   2. BC sets the date; the Personal Score (my_points) follows it, a Sanction
--      by its own date, and a Member with nothing left to count keeps a zero row.
--   3. Clasament and the Department Cup follow it, and an explicit "De la" in
--      Clasament's Work Filter may look back past it (the lookback), an explicit
--      later one is honoured.
--   4. Campaign totals and reports follow it with no lookback, tasks_completed
--      included; a completed Umbrella (no Evaluation) counts by its completion
--      against the date, and an explicit range still leaves it out.
--   5. A Role Evaluation's standing ignores it.
--   6. Review Focus 2: a Task deleted for good after the date was set leaves
--      the Personal Score unchanged (its orphaned award and reversal never
--      count) and nets to zero in the whole ledger.
--   7. Each reader asks for the floor once per query, never once per row.
--
-- Fixture prefix 58060000-0000-0000-0000-0000000000NN. Every assertion reads the
-- suite's own Group, Campaign or Members; the seed already puts points on
-- other Members and Groups. Runs in one transaction and rolls back.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(35);

-- The row as the migration seeded it, whatever an earlier suite or the database
-- left in it: this suite sets and clears the date itself.
update public.evaluation_settings
   set eligibility_floor = null, membership_cutoff = null, points_start_date = null, updated_by = null
 where id = 1;
delete from public.promotion_threshold_changes where field in ('floor', 'cutoff', 'points_start');

-- ==================== Fixtures ====================

create function pg_temp.u(n integer) returns uuid language sql immutable as $$
  select ('58060000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users (id, email)
select pg_temp.u(n), 'member.' || n || '.r58t6@test.local' from generate_series(1, 5) n;

-- 1 BC (the evaluator, and the one who sets the date), 2 the earner, 3 a
-- Member whose only ledger row is a Sanction from before the date, 4 the
-- earner in the second Group, whose Campaign holds the Umbrellas, 5 the
-- Executor of the two Tasks that go through the real commands (section 0).
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.u(n), 'Member R58T6 ' || n, 'member.' || n || '.r58t6@test.local',
  (case n when 1 then 'bc' else 'voluntar' end)::public.member_role, 'activ'
from generate_series(1, 5) n;

insert into public.groups (name, category, min_level, competes_in_cup, created_by)
values ('Grup Start R58T6', 'department', 0, true, pg_temp.u(1));
insert into public.group_members (group_id, member_id, group_role, position_title)
select grp.id, pg_temp.u(n), 'member', null
  from public.groups as grp, generate_series(2, 3) n
 where grp.name = 'Grup Start R58T6';

insert into public.campaigns (name, group_id, created_by)
select 'Campanie Start R58T6', grp.id, pg_temp.u(1)
  from public.groups as grp where grp.name = 'Grup Start R58T6';

-- Three completed Tasks of the Group on the Campaign, one Member each time.
-- Difficulty x 1 (Rating 3) = 3, 5 and 7 Task Points, so every subset of the
-- three sums to a different number.
insert into public.tasks
  (title, group_id, campaign_id, audience, assignment_mode, status, difficulty, rating,
   created_at, started_at, completed_at, created_by)
select task.title, grp.id, campaign.id, 'local', 'direct', 'completed', task.difficulty, 3,
       now() - interval '9 days', now() - interval '8 days', now(), pg_temp.u(1)
  from public.groups as grp
  join public.campaigns as campaign on campaign.group_id = grp.id
 cross join (values ('Start martie R58T6', 3), ('Start septembrie R58T6', 5), ('Start octombrie R58T6', 7))
       as task (title, difficulty)
 where grp.name = 'Grup Start R58T6';

-- The March award, the award at exactly the Bucharest midnight the date begins
-- (2026-09-01 00:00 +03), and the October one. A Sanction has no Evaluation:
-- April's counts by its own date, for both Members.
select pg_temp.test_credit_task(task.id, pg_temp.u(2), pg_temp.u(1), 'fixture evaluation',
                                 awarded.at)
  from (values ('Start martie R58T6',      '2026-03-01 12:00:00+02'::timestamptz),
               ('Start septembrie R58T6',  '2026-09-01 00:00:00+03'),
               ('Start octombrie R58T6',   '2026-10-05 12:00:00+03')) as awarded (title, at)
  join public.tasks as task on task.title = awarded.title;
insert into public.points_ledger (member_id, delta, reason, note, created_at) values
  (pg_temp.u(2), -2, 'sanction', 'sanction fixture R58T6', '2026-04-01 12:00:00+03'),
  (pg_temp.u(3), -1, 'sanction', 'sanction fixture R58T6', '2026-04-01 12:00:00+03');

-- A Task awarded in March and reopened in September: its award is before the
-- date and its task_reversal row, dated after it, shares the award's
-- Evaluation. The pair must count or not together (it nets to zero in every
-- total), so no expected number below moves.
insert into public.tasks
  (title, group_id, audience, assignment_mode, status, difficulty, rating,
   created_at, started_at, completed_at, created_by)
select 'Start redeschis R58T6', grp.id, 'local', 'direct', 'completed', 4, 3,
       now() - interval '9 days', now() - interval '8 days', now(), pg_temp.u(1)
  from public.groups as grp where grp.name = 'Grup Start R58T6';
select pg_temp.test_credit_task(task.id, pg_temp.u(2), pg_temp.u(1), 'fixture evaluation',
                                 '2026-03-15 12:00:00+02')
  from public.tasks as task where task.title = 'Start redeschis R58T6';
select pg_temp.test_reverse_award(task.id, pg_temp.u(2), '2026-09-10 12:00:00+03')
  from public.tasks as task where task.title = 'Start redeschis R58T6';

-- A second Group and Campaign (Member 4 earns there, so nothing above moves):
-- an evaluated Subtask awarded on 2026-10-05, an Umbrella completed on
-- 2026-10-06 over it, and an Umbrella completed on 2026-03-01. An Umbrella has
-- no Evaluation.
insert into public.groups (name, category, min_level, created_by)
values ('Grup Umbrela R58T6', 'department', 0, pg_temp.u(1));
insert into public.campaigns (name, group_id, created_by)
select 'Campanie Umbrela R58T6', grp.id, pg_temp.u(1)
  from public.groups as grp where grp.name = 'Grup Umbrela R58T6';
insert into public.tasks
  (title, group_id, campaign_id, kind, audience, assignment_mode, status,
   created_at, completed_at, created_by)
select umbrella.title, grp.id, campaign.id, 'umbrella', null, null, 'completed',
       umbrella.created_at, umbrella.completed_at, pg_temp.u(1)
  from public.groups as grp
  join public.campaigns as campaign on campaign.group_id = grp.id
 cross join (values
   ('Umbrela noua R58T6',   '2026-09-15 12:00:00+03'::timestamptz, '2026-10-06 12:00:00+03'::timestamptz),
   ('Umbrela veche R58T6',  '2026-02-01 12:00:00+02',              '2026-03-01 12:00:00+02')
 ) as umbrella (title, created_at, completed_at)
 where grp.name = 'Grup Umbrela R58T6';
insert into public.tasks
  (title, group_id, campaign_id, parent_task_id, audience, assignment_mode, status,
   difficulty, rating, created_at, started_at, completed_at, created_by)
select 'Subtask umbrela R58T6', grp.id, campaign.id, parent.id, 'local', 'direct', 'completed',
       7, 3, now() - interval '9 days', now() - interval '8 days', now(), pg_temp.u(1)
  from public.groups as grp
  join public.campaigns as campaign on campaign.group_id = grp.id
  join public.tasks as parent on parent.title = 'Umbrela noua R58T6'
 where grp.name = 'Grup Umbrela R58T6';
select pg_temp.test_credit_task(task.id, pg_temp.u(4), pg_temp.u(1), 'fixture evaluation',
                                 '2026-10-05 12:00:00+03')
  from public.tasks as task where task.title = 'Subtask umbrela R58T6';
-- A completed Task that is not an Umbrella and was never evaluated (a fixture
-- only: the commands always evaluate): it has no award instant either, but the
-- date reads only an Umbrella by its completion.
insert into public.tasks
  (title, group_id, campaign_id, audience, assignment_mode, status, difficulty, rating,
   created_at, started_at, completed_at, created_by)
select 'Fara evaluare R58T6', grp.id, campaign.id, 'local', 'direct', 'completed', 7, 3,
       now() - interval '9 days', now() - interval '8 days', now(), pg_temp.u(1)
  from public.groups as grp
  join public.campaigns as campaign on campaign.group_id = grp.id
 where grp.name = 'Grup Umbrela R58T6';

-- Two Tasks in review in a third Group, for the real commands of section 0: one
-- is awarded and stays awarded, the other is awarded and then reopened. Member
-- 5 earns nowhere else, so no total below moves.
insert into public.groups (name, category, min_level, created_by)
values ('Grup Comenzi R58T6', 'department', 0, pg_temp.u(1));
insert into public.tasks
  (title, group_id, audience, assignment_mode, status,
   created_at, started_at, submitted_at, created_by)
select task.title, grp.id, 'local', 'direct', 'in_review',
       now() - interval '9 days', now() - interval '8 days', now() - interval '1 day', pg_temp.u(1)
  from public.groups as grp
 cross join (values ('Comanda acordata R58T6'), ('Comanda redeschisa R58T6')) as task (title)
 where grp.name = 'Grup Comenzi R58T6';
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
select task.id, pg_temp.u(5), pg_temp.u(1), now() - interval '8 days'
  from public.tasks as task
 where task.title in ('Comanda acordata R58T6', 'Comanda redeschisa R58T6');

create temporary table fx as
select (select id from public.groups where name = 'Grup Start R58T6')           as g,
       (select id from public.campaigns where name = 'Campanie Start R58T6')     as k,
       (select id from public.campaigns where name = 'Campanie Umbrela R58T6')   as k_umbrella,
       (select id from public.tasks where title = 'Start martie R58T6')          as t_march,
       (select id from public.tasks where title = 'Comanda acordata R58T6')      as t_cmd_kept,
       (select id from public.tasks where title = 'Comanda redeschisa R58T6')    as t_cmd_reopened;
grant select on fx to authenticated;

create function pg_temp.as_bc() returns void language sql as $$
  select pg_temp.test_login(pg_temp.u(1), '{"member_role":"bc","member_level":6}'::jsonb) $$;
create function pg_temp.as_member(n integer) returns void language sql as $$
  select pg_temp.test_login(pg_temp.u(n), '{"member_role":"voluntar","member_level":1}'::jsonb) $$;

-- ==================== 0 · The invariant the Personal Score relies on ====================

-- my_points reads the award instant from the Member's own ledger rows, never
-- through task_evaluations (which a security-invoker view would read under the
-- Task visibility policies, many times slower): that is only right while every
-- `task` row is dated by its Evaluation. points_ledger_guard_award_instant
-- makes that a rule of the table (R58 ruling 18). The live writers are
-- exercised first -- two awards through complete_task_review, one of them then
-- reversed through reopen_task -- beside the fixtures and the seed, and the
-- count then pins the invariant over all of them.
select pg_temp.as_bc();
select lives_ok(format($$ select public.complete_task_review(%s, 3, 4, 'comanda acordata') $$,
  (select t_cmd_kept from fx)),
  'BC awards a Task through complete_task_review');
select lives_ok(format($$ select public.complete_task_review(%s, 3, 4, 'comanda redeschisa') $$,
  (select t_cmd_reopened from fx)),
  'BC awards a second Task through complete_task_review');
select lives_ok(format($$ select public.reopen_task(%s, 'redeschisa pentru test') $$,
  (select t_cmd_reopened from fx)),
  'and reopens it through reopen_task, which reverses the award');
reset role;

select is(
  (select format('%s|%s|%s|%s',
                 count(*) filter (where entry.reason = 'task'),
                 count(*) filter (where entry.reason = 'task_reversal'),
                 sum(entry.delta),
                 count(*) filter (where entry.reason = 'task'
                                    and entry.created_at = evaluation.evaluated_at))
     from public.points_ledger as entry
     join public.task_evaluations as evaluation on evaluation.id = entry.evaluation_id
    where entry.member_id = pg_temp.u(5)),
  '2|1|6|2',
  'the commands wrote two task rows (each dated by its Evaluation), one task_reversal, and a net of one award');

select is(
  (select count(*)::int
     from public.points_ledger as entry
     join public.task_evaluations as evaluation on evaluation.id = entry.evaluation_id
    where entry.reason = 'task' and entry.created_at <> evaluation.evaluated_at),
  0,
  'every task ledger row is dated by the instant of its Evaluation');

-- And the rule is the table's own: a task row a second off its Evaluation is
-- refused whoever writes it.
select throws_ok(
  $$ insert into public.points_ledger (member_id, delta, reason, task_id, evaluation_id, created_at)
     select entry.member_id, entry.delta, 'task', entry.task_id, entry.evaluation_id,
            evaluation.evaluated_at + interval '1 second'
       from public.points_ledger as entry
       join public.task_evaluations as evaluation on evaluation.id = entry.evaluation_id
      where entry.member_id = pg_temp.u(5) and entry.reason = 'task'
      limit 1 $$,
  '23514', 'ledger_award_instant_mismatch',
  'points_ledger_guard_award_instant refuses a task row dated off its Evaluation');

-- ==================== 1 · Day one: no date, every total counts from the beginning ====================

select pg_temp.as_member(2);
select is((select points from public.my_points), 13,
  'no Points Start Date: my_points is the whole ledger (3 + 5 + 7 - 2)');
select pg_temp.as_bc();
select is((select points from public.leadership_leaderboard(p_group_id := (select g from fx))
            where member_id = pg_temp.u(2)), 15,
  'no Points Start Date: Clasament counts all three awards');
select is((select points from public.department_cup() where group_id = (select g from fx)), 15,
  'no Points Start Date: the Department Cup counts all three awards');
select results_eq(
  $$ select tasks_total, tasks_completed, points_total from public.campaign_totals((select k from fx)) $$,
  $$ values (3, 3, 15) $$,
  'no Points Start Date: the Campaign totals count everything');
select results_eq(
  $$ select tasks_total, tasks_completed, points_total from public.campaign_totals((select k_umbrella from fx)) $$,
  $$ values (4, 4, 7) $$,
  'no Points Start Date: both completed Umbrellas count beside the evaluated Subtask and the unevaluated Task');

-- ==================== 2 · BC sets the date; the Personal Score follows it ====================

select is((select points_start_date from public.set_points_start_date('2026-09-01')), '2026-09-01'::date,
  'BC sets the Points Start Date');

select pg_temp.as_member(2);
select results_eq(
  $$ select member_id, points from public.my_points $$,
  $$ values (pg_temp.u(2), 12) $$,
  'my_points: the award at the Bucharest midnight and the October one count; the March award, the April Sanction and a March award reopened in September (the pair nets out together) do not');
select pg_temp.as_member(3);
select results_eq(
  $$ select member_id, points from public.my_points $$,
  $$ values (pg_temp.u(3), 0) $$,
  'my_points: a Member with nothing left to count still gets their zero row');
reset role;

-- ==================== 3 · Clasament and the Department Cup ====================

select pg_temp.as_bc();
select results_eq(
  $$ select member_id, points from public.leadership_leaderboard(p_group_id := (select g from fx))
      where member_id in (pg_temp.u(2), pg_temp.u(3)) order by member_id $$,
  $$ values (pg_temp.u(2), 12), (pg_temp.u(3), 0) $$,
  'Clasament with no range counts from the Points Start Date; the roster rows stay');
select is((select points from public.leadership_leaderboard(
              p_group_id := (select g from fx), p_from := '2026-01-01 00:00:00+02')
            where member_id = pg_temp.u(2)), 15,
  'Clasament with an explicit earlier "De la" looks back past the Points Start Date');
select is((select points from public.leadership_leaderboard(
              p_group_id := (select g from fx), p_from := '2026-10-01 00:00:00+03')
            where member_id = pg_temp.u(2)), 7,
  'Clasament with an explicit later "De la" is honoured, not replaced by the Points Start Date');
select is((select points from public.department_cup() where group_id = (select g from fx)), 12,
  'the Department Cup with no range follows the Points Start Date');
select is((select points from public.department_cup(p_from := '2026-01-01 00:00:00+02')
            where group_id = (select g from fx)), 15,
  'the Department Cup with an explicit earlier "De la" looks back');

-- ==================== 4 · Campaign totals and reports: no lookback ====================

select results_eq(
  $$ select tasks_total, tasks_completed, points_total from public.campaign_totals((select k from fx)) $$,
  $$ values (3, 2, 12) $$,
  'campaign_totals with no range counts points and tasks_completed from the Points Start Date; tasks_total stays the whole Campaign');
select results_eq(
  $$ select tasks_total, tasks_completed, points_total
       from public.campaign_totals((select k from fx), '2026-01-01 00:00:00+02') $$,
  $$ values (3, 2, 12) $$,
  'campaign_totals with an explicit earlier "De la" still follows the Points Start Date');
select results_eq(
  $$ select member_id, tasks_completed, points from public.campaign_report((select k from fx)) $$,
  $$ values (pg_temp.u(2), 2, 12) $$,
  'campaign_report with no range counts points and tasks_completed from the Points Start Date');
select results_eq(
  $$ select member_id, tasks_completed, points
       from public.campaign_report((select k from fx), '2026-01-01 00:00:00+02') $$,
  $$ values (pg_temp.u(2), 2, 12) $$,
  'campaign_report with an explicit earlier "De la" still follows the Points Start Date');
-- A completed Umbrella has no Evaluation: the Points Start Date alone reads it
-- by its completion (Ruling 13), an explicit range leaves it out as before.
select results_eq(
  $$ select tasks_total, tasks_completed, points_total from public.campaign_totals((select k_umbrella from fx)) $$,
  $$ values (4, 2, 7) $$,
  'campaign_totals with no range counts the Umbrella completed after the date (and the Subtask), not the one completed before it nor an unevaluated Task that is no Umbrella');
select results_eq(
  $$ select tasks_total, tasks_completed, points_total
       from public.campaign_totals((select k_umbrella from fx), '2026-01-01 00:00:00+02') $$,
  $$ values (4, 1, 7) $$,
  'campaign_totals under an explicit "De la" leaves both Umbrellas out, as #677 documents; only the evaluated Subtask counts');

-- ==================== 5 · A Role Evaluation ignores it ====================

select pg_temp.as_member(2);
select is((select task_points from public.my_role_evaluation_standing('voluntar_activ')), 15,
  'my_role_evaluation_standing counts every award since the last run, whatever the Points Start Date');
reset role;

-- ==================== 6 · Review Focus 2: a Task deleted for good ====================

-- The March award is before the date, so it does not count; deleting its Task
-- reverses it (a task_reversal row dated now, after the date) and orphans both
-- rows. If an orphaned reversal counted by its own date it would subtract 3
-- from a total that never included the award.
select pg_temp.as_bc();
select is((public.delete_task((select t_march from fx), true) ->> 'points_reversed')::int, -3,
  'BC deletes the March Task for good and takes its points back');
select pg_temp.as_member(2);
select is((select points from public.my_points), 12,
  'my_points is unchanged: the orphaned award and reversal never count');
reset role;
select results_eq(
  $$ select count(*)::int, sum(delta)::int from public.points_ledger
      where member_id = pg_temp.u(2) and reason in ('task', 'task_reversal') and task_id is null $$,
  $$ values (2, 0) $$,
  'the orphaned pair is two ledger rows that net to zero');

-- No command clears the date: do it as the owner.
update public.evaluation_settings set points_start_date = null where id = 1;
select pg_temp.as_member(2);
select is((select points from public.my_points), 10,
  'with the date cleared, my_points is back to counting everything: 5 + 7 - 2, the pair netting to zero');
select is((select points from public.my_points),
          (select sum(delta)::int from public.points_ledger where member_id = pg_temp.u(2)),
  'and equals the whole ledger of that Member');
reset role;

-- ==================== 7 · One floor evaluation per query ====================

-- points_floor() has a SET clause, so the planner never inlines it and a bare
-- call in a WHERE would run once per ledger row. Count its calls through a
-- counting twin installed for the rest of this rolled-back transaction.
create or replace function private.points_floor()
returns timestamptz
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('osubb.floor_calls',
    (coalesce(nullif(pg_catalog.current_setting('osubb.floor_calls', true), ''), '0')::int + 1)::text, true);
  return (select (setting.points_start_date::timestamp at time zone 'Europe/Bucharest')
            from public.evaluation_settings as setting
           where setting.id = 1);
end;
$$;
update public.evaluation_settings set points_start_date = '2026-09-01' where id = 1;

create function pg_temp.floor_calls(p_sql text) returns integer
language plpgsql as $$
begin
  perform pg_catalog.set_config('osubb.floor_calls', '0', true);
  execute p_sql;
  return pg_catalog.current_setting('osubb.floor_calls')::int;
end;
$$;

select pg_temp.as_bc();
select is(pg_temp.floor_calls($$ select count(*) from public.leadership_leaderboard() $$), 1,
  'Clasament asks for the Points Start Date once, not once per ledger row');
select is(pg_temp.floor_calls($$ select count(*) from public.department_cup() $$), 1,
  'the Department Cup asks for the Points Start Date once');
select is(pg_temp.floor_calls($$ select count(*) from public.campaign_totals((select k from fx)) $$), 1,
  'campaign_totals asks for the Points Start Date once');
select is(pg_temp.floor_calls($$ select count(*) from public.campaign_report((select k from fx)) $$), 1,
  'campaign_report asks for the Points Start Date once');
reset role;

select * from finish();
rollback;
