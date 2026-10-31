-- #1125: select_task_candidate re-judges the Candidate's eligibility under the
-- Task lock, with the two reasons express_task_interest gives.
--
-- Audit finding M1 (docs/review/2026-10-30-codebase-audit.md): a pending
-- Candidature is filed against the join rule express_task_interest applies --
-- membership of a local Task's Group (private.is_group_member) and the Task's
-- Minimum Level (R57) -- but nothing closes it when the Member is later
-- removed from the Group or demoted, and the selection never looked again, so
-- a Task Manager could hand the Task to someone its own rule excludes.
--
-- The rule this suite pins: a pending Candidature of a now-ineligible Member
-- stays pending and visible (they may become eligible again) and only its
-- SELECTION is refused -- 42501 task_audience_forbidden when a local Task's
-- Candidate no longer belongs to its Group, then 42501 task_level_forbidden
-- when the Candidate's live Level is below the Task's Minimum Level -- judged
-- on the live rows under the Task lock, after candidate_not_pending and before
-- any write. A deactivated Candidate keeps answering PT400 invalid_executor
-- from private.open_task_assignment (select_task_candidate.test.sql section
-- 5): eligibility is judged only for a live Member, whose ineligibility the
-- kit does not already name.
--
-- Every refusal here succeeds on main: the two 42501 assertions and the
-- audience-before-level order are what fail without the migration.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(14);

-- ==================== Fixtures ====================
-- 01 the Manager (BCE, Group Manager of the Group); 02 the Candidate on the
-- local Task; 03 the Candidate on the level-2 Task; 04 the Candidate on the
-- local level-2 Task; 05 a Candidate deactivated after queueing.
insert into auth.users (id, email) values
  ('11250000-0000-0000-0000-000000000001', 'manager.1125@test.local'),
  ('11250000-0000-0000-0000-000000000002', 'candidat.local.1125@test.local'),
  ('11250000-0000-0000-0000-000000000003', 'candidat.nivel.1125@test.local'),
  ('11250000-0000-0000-0000-000000000004', 'candidat.ambele.1125@test.local'),
  ('11250000-0000-0000-0000-000000000005', 'candidat.dezactivat.1125@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('11250000-0000-0000-0000-000000000001', 'Manager 1125', 'manager.1125@test.local', 'bce', 'activ'),
  ('11250000-0000-0000-0000-000000000002', 'Candidat Local 1125', 'candidat.local.1125@test.local', 'activ', 'activ'),
  ('11250000-0000-0000-0000-000000000003', 'Candidat Nivel 1125', 'candidat.nivel.1125@test.local', 'activ', 'activ'),
  ('11250000-0000-0000-0000-000000000004', 'Candidat Ambele 1125', 'candidat.ambele.1125@test.local', 'activ', 'activ'),
  ('11250000-0000-0000-0000-000000000005', 'Candidat Dezactivat 1125', 'candidat.dezactivat.1125@test.local', 'activ', 'inactiv');

-- automatic_membership stays false (the default): membership is the roster
-- alone, so deleting a Member's row is exactly "removed from the Group".
insert into public.groups (name, category, shared_work_visibility)
values ('Echipa #1125', 'team', true);

insert into public.group_members (group_id, member_id, group_role)
select grp.id, member.id, member.group_role
  from public.groups as grp
  cross join (values
    ('11250000-0000-0000-0000-000000000001'::uuid, 'manager'),
    ('11250000-0000-0000-0000-000000000002'::uuid, 'member'),
    ('11250000-0000-0000-0000-000000000004'::uuid, 'member')) as member(id, group_role)
 where grp.name = 'Echipa #1125';

-- Four public Tasks with an open queue, each with one pending Candidate who
-- was eligible when they queued.
insert into public.tasks
  (title, description, deadline, group_id, audience, assignment_mode, status, queue_opened_at, min_level, created_by)
select task.title, task.description, '2027-09-01 09:00:00+00', grp.id, task.audience, 'public', 'todo', now(),
       task.min_level, '11250000-0000-0000-0000-000000000001'
  from public.groups as grp
  cross join (values
    ('Local #1125', 'Doar pentru grup', 'local', 0),
    ('Nivel 2 #1125', 'Doar de la Voluntar Activ', 'org', 2),
    ('Local nivel 2 #1125', 'Grupul si nivelul', 'local', 2),
    ('Dezactivat #1125', 'Alegere moarta', 'org', 2)) as task(title, description, audience, min_level)
 where grp.name = 'Echipa #1125';

insert into public.task_candidates (task_id, member_id, status, joined_at)
select task.id, candidate.member_id, 'pending', now() - interval '1 hour'
  from public.tasks as task
  join (values
    ('Local #1125', '11250000-0000-0000-0000-000000000002'::uuid),
    ('Nivel 2 #1125', '11250000-0000-0000-0000-000000000003'::uuid),
    ('Local nivel 2 #1125', '11250000-0000-0000-0000-000000000004'::uuid),
    ('Dezactivat #1125', '11250000-0000-0000-0000-000000000005'::uuid)) as candidate(title, member_id)
    on candidate.title = task.title;

create temp table f1125 as
select (select id from public.groups where name = 'Echipa #1125') as group_id,
       (select id from public.tasks where title = 'Local #1125') as local_task_id,
       (select id from public.task_candidates where member_id = '11250000-0000-0000-0000-000000000002') as local_candidature_id,
       (select id from public.tasks where title = 'Nivel 2 #1125') as level_task_id,
       (select id from public.task_candidates where member_id = '11250000-0000-0000-0000-000000000003') as level_candidature_id,
       (select id from public.tasks where title = 'Local nivel 2 #1125') as both_task_id,
       (select id from public.task_candidates where member_id = '11250000-0000-0000-0000-000000000004') as both_candidature_id,
       (select id from public.tasks where title = 'Dezactivat #1125') as dead_task_id,
       (select id from public.task_candidates where member_id = '11250000-0000-0000-0000-000000000005') as dead_candidature_id;
grant select on f1125 to authenticated;

-- ==================== 1. A local Task: removed from the Group ====================
reset role;
delete from public.group_members
 where group_id = (select group_id from f1125)
   and member_id = '11250000-0000-0000-0000-000000000002';

select pg_temp.test_login_leadership('11250000-0000-0000-0000-000000000001');
select throws_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select local_task_id from f1125), (select local_candidature_id from f1125)),
  '42501', 'task_audience_forbidden',
  'a Candidate who left a local Task''s Group since queueing cannot be selected -- the reason express_task_interest would give');
reset role;
select is((select candidate.status from public.task_candidates as candidate
            where candidate.id = (select local_candidature_id from f1125)),
  'pending',
  'the refused Candidature stays pending and visible -- they may be added back');
select is((select count(*) from public.task_assignments
            where task_id = (select local_task_id from f1125)), 0::bigint,
  'and no Assignment was opened -- the refusal wrote nothing');

insert into public.group_members (group_id, member_id, group_role)
values ((select group_id from f1125), '11250000-0000-0000-0000-000000000002', 'member');

select pg_temp.test_login_leadership('11250000-0000-0000-0000-000000000001');
select lives_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select local_task_id from f1125), (select local_candidature_id from f1125)),
  'added back to the Group, the same Candidature is selected exactly as before');
reset role;
select is((select format('%s|%s', candidate.status, assignment.member_id)
             from public.task_candidates as candidate
             join public.task_assignments as assignment on assignment.id = candidate.assignment_id
            where candidate.id = (select local_candidature_id from f1125)),
  'selected|11250000-0000-0000-0000-000000000002',
  'the Candidature is selected and its Assignment names the Candidate');

-- ==================== 2. A level-2 Task: demoted below the Minimum Level ====================
update public.profiles set role = 'voluntar'
 where id = '11250000-0000-0000-0000-000000000003';

select pg_temp.test_login_leadership('11250000-0000-0000-0000-000000000001');
select throws_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select level_task_id from f1125), (select level_candidature_id from f1125)),
  '42501', 'task_level_forbidden',
  'a Candidate demoted below the Task''s Minimum Level since queueing cannot be selected (R57, judged live)');
reset role;
select is((select candidate.status from public.task_candidates as candidate
            where candidate.id = (select level_candidature_id from f1125)),
  'pending',
  'the demoted Candidate''s Candidature stays pending -- a promotion makes them selectable again');

update public.profiles set role = 'activ'
 where id = '11250000-0000-0000-0000-000000000003';

select pg_temp.test_login_leadership('11250000-0000-0000-0000-000000000001');
select lives_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select level_task_id from f1125), (select level_candidature_id from f1125)),
  'back at the Minimum Level, the Candidate is selected');
reset role;
select is((select assignment.member_id from public.task_assignments as assignment
            where assignment.task_id = (select level_task_id from f1125) and assignment.ended_at is null),
  '11250000-0000-0000-0000-000000000003'::uuid,
  'and holds the Task''s Executor slot');

-- ==================== 3. Both at once: the Group is judged before the Level ====================
delete from public.group_members
 where group_id = (select group_id from f1125)
   and member_id = '11250000-0000-0000-0000-000000000004';
update public.profiles set role = 'voluntar'
 where id = '11250000-0000-0000-0000-000000000004';

select pg_temp.test_login_leadership('11250000-0000-0000-0000-000000000001');
select throws_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select both_task_id from f1125), (select both_candidature_id from f1125)),
  '42501', 'task_audience_forbidden',
  'removed AND demoted, the Candidate hears about the Group first -- the order express_task_interest uses');
reset role;

insert into public.group_members (group_id, member_id, group_role)
values ((select group_id from f1125), '11250000-0000-0000-0000-000000000004', 'member');

select pg_temp.test_login_leadership('11250000-0000-0000-0000-000000000001');
select throws_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select both_task_id from f1125), (select both_candidature_id from f1125)),
  '42501', 'task_level_forbidden',
  'back in the Group but still demoted, the Level is what refuses');
reset role;

update public.profiles set role = 'activ'
 where id = '11250000-0000-0000-0000-000000000004';

select pg_temp.test_login_leadership('11250000-0000-0000-0000-000000000001');
select lives_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select both_task_id from f1125), (select both_candidature_id from f1125)),
  'eligible again on both counts, the Candidate is selected');
reset role;

-- ==================== 4. A deactivated Candidate keeps the kit's reason ====================
-- Their live Level is null, which a naive "below the Minimum Level" test
-- would call task_level_forbidden; the kit's PT400 invalid_executor is the
-- reason select_task_candidate.test.sql section 5 pins, and it still wins.
select pg_temp.test_login_leadership('11250000-0000-0000-0000-000000000001');
select throws_ok(format($$ select public.select_task_candidate(%s, %s, false) $$,
  (select dead_task_id from f1125), (select dead_candidature_id from f1125)),
  'PT400', 'invalid_executor',
  'a deactivated Candidate on a level-2 Task still answers invalid_executor -- eligibility is judged only for a live Member');
reset role;
select is((select candidate.status from public.task_candidates as candidate
            where candidate.id = (select dead_candidature_id from f1125)),
  'pending',
  'and their Candidature is left as it was');

select * from finish();
rollback;
