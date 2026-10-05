-- #1017 (ruling R38): delete for good -- delete_task (with or without its
-- points), task_delete_preview, delete_event, delete_campaign,
-- group_delete_preview and delete_group (everything / empty).
--
-- What this suite pins, section by section, in the order each command answers:
--   1. delete_task's gate and its manager authority (claimless, inactive,
--      invisible, a member who only reads the Task);
--   2. the points refusal and its DETAIL, reopen_task's evaluator rule on the
--      reversal, and the reversal path itself: the task_reversal row, my_points
--      back to zero, the ledger rows kept with their reference nulled and the
--      Task's title recorded, everything the Task owned gone, one Notification;
--   3. the Umbrella cascade, and that nothing outside the target moves;
--   4. the immutability guards still refuse every other delete, and the
--      ledger's reference constraint;
--   5. delete_event (RSVPs and Notifications go, the Announcement stays);
--   6. delete_campaign (the label goes, the Tasks and Events stay);
--   7. group_delete_preview / delete_group: malformed mode, archive_group's
--      authority, the empty mode, every protected Group, the everything mode
--      with its point reversals and the Department Cup, and the exact set of
--      Groups removed;
--   8. the lock order on COMMITTED fixtures: an Umbrella and its first
--      Subtask are held FOR NO KEY UPDATE, untouched, while the command waits
--      on the second Subtask, and evaluate_task's parent-naming insert goes
--      through meanwhile.
--
-- Fixture prefix 10170000-0000-0000-0000-0000000000NN; the committed fixtures
-- of section 8 use ...00000000005N and carry '#1017 committed' in their titles.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(77);

-- ==================== Fixtures ====================

create function pg_temp.u(n integer) returns uuid language sql immutable as $$
  select ('10170000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users (id, email)
select pg_temp.u(n), 'member.' || n || '.1017@test.local' from generate_series(1, 11) n;

-- 1 BC, 2 Moderator, 3 Group Manager of the root, 4 and 10 its Group
-- Responsibles, 5 and 6 members who earn points, 7 inactive BC, 8 outsider,
-- 9 claimless, 11 Group Manager of the Child Group only.
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.u(n), 'Member #1017 ' || n, 'member.' || n || '.1017@test.local',
  (case n when 1 then 'bc' when 2 then 'moderator' when 7 then 'bc' else 'voluntar' end)::public.member_role,
  (case n when 7 then 'inactiv' else 'activ' end)::public.member_status
from generate_series(1, 11) n;

insert into public.groups (name, category, min_level, competes_in_cup, created_by)
values ('Rădăcină #1017', 'department', 0, true, pg_temp.u(1));
insert into public.groups (name, category, min_level, created_by)
values ('Gol #1017',            'department', 0, pg_temp.u(1)),
       ('Alt grup #1017',       'department', 0, pg_temp.u(1)),
       ('Birou #1017',          'department', 0, pg_temp.u(1)),
       ('Adunare #1017',        'department', 0, pg_temp.u(1)),
       ('Părinte protejat #1017', 'department', 0, pg_temp.u(1));
insert into public.groups (name, category, min_level, automatic_membership, created_by)
values ('Automat #1017', 'department', 0, true, pg_temp.u(1));

create function pg_temp.g(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;

insert into public.groups (name, category, parent_id, min_level, created_by)
values ('Copil #1017', 'team', pg_temp.g('Rădăcină #1017'), 0, pg_temp.u(1));
insert into public.groups (name, category, parent_id, min_level, created_by)
values ('Nepot #1017', 'team', pg_temp.g('Copil #1017'), 0, pg_temp.u(1));
insert into public.groups (name, category, parent_id, min_level, automatic_membership, created_by)
values ('Copil automat #1017', 'team', pg_temp.g('Părinte protejat #1017'), 0, true, pg_temp.u(1));

-- The seeded Organization Group also has Automatic Membership; switch that off
-- here so the Organization arm of the protection is proven on its own.
update public.groups set automatic_membership = false where is_organization;
update public.org_settings set value = pg_temp.g('Birou #1017')::text where key = 'board_group_id';
update public.org_settings set value = pg_temp.g('Adunare #1017')::text where key = 'adunarea_generala_group_id';

insert into public.group_members (group_id, member_id, group_role, position_title) values
  (pg_temp.g('Rădăcină #1017'), pg_temp.u(3),  'manager',     null),
  (pg_temp.g('Rădăcină #1017'), pg_temp.u(4),  'responsible', 'Responsabil #1017'),
  (pg_temp.g('Rădăcină #1017'), pg_temp.u(10), 'responsible', 'Responsabil 2 #1017'),
  (pg_temp.g('Rădăcină #1017'), pg_temp.u(5),  'member',      null),
  (pg_temp.g('Rădăcină #1017'), pg_temp.u(6),  'member',      null),
  (pg_temp.g('Rădăcină #1017'), pg_temp.u(9),  'member',      null),
  (pg_temp.g('Copil #1017'),    pg_temp.u(11), 'manager',     null),
  (pg_temp.g('Nepot #1017'),    pg_temp.u(6),  'member',      null),
  (pg_temp.g('Gol #1017'),      pg_temp.u(5),  'member',      null),
  (pg_temp.g('Alt grup #1017'), pg_temp.u(5),  'member',      null);

create function pg_temp.task(p_title text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.tasks where title = p_title
$$;

-- Open work.
insert into public.tasks (title, group_id, audience, assignment_mode, status, deadline, created_by) values
  ('Fără puncte #1017', pg_temp.g('Rădăcină #1017'), 'local', 'direct', 'todo', now() + interval '9 days', pg_temp.u(3)),
  ('Copie #1017',       pg_temp.g('Rădăcină #1017'), 'local', 'direct', 'todo', now() + interval '9 days', pg_temp.u(3)),
  ('În afară #1017',    pg_temp.g('Alt grup #1017'), 'local', 'direct', 'todo', now() + interval '9 days', pg_temp.u(1));
update public.tasks set duplicated_from_task_id = pg_temp.task('Fără puncte #1017') where title = 'Copie #1017';
insert into public.task_assignments (task_id, member_id, assigned_by)
values (pg_temp.task('Fără puncte #1017'), pg_temp.u(6), pg_temp.u(3));

-- Evaluated work, credited exactly as the evaluation commands credit it.
insert into public.tasks
  (title, group_id, audience, assignment_mode, status, difficulty, rating,
   created_at, started_at, completed_at, created_by) values
  ('Cu puncte #1017',           pg_temp.g('Rădăcină #1017'), 'local', 'direct', 'completed', 3, 4,
   now() - interval '9 days', now() - interval '8 days', now(), pg_temp.u(3)),
  ('Puncte responsabil #1017',  pg_temp.g('Rădăcină #1017'), 'local', 'direct', 'completed', 1, 4,
   now() - interval '9 days', now() - interval '8 days', now(), pg_temp.u(3)),
  ('Nepot punctat #1017',       pg_temp.g('Nepot #1017'),    'local', 'direct', 'completed', 5, 4,
   now() - interval '9 days', now() - interval '8 days', now(), pg_temp.u(3));
insert into public.tasks (title, group_id, kind, audience, assignment_mode, status, created_by)
values ('Umbrelă #1017', pg_temp.g('Rădăcină #1017'), 'umbrella', null, null, 'todo', pg_temp.u(3));
insert into public.tasks
  (title, group_id, parent_task_id, audience, assignment_mode, status, difficulty, rating,
   created_at, started_at, completed_at, deadline, created_by) values
  ('Subtask punctat #1017', pg_temp.g('Rădăcină #1017'), pg_temp.task('Umbrelă #1017'), 'local', 'direct',
   'completed', 2, 5, now() - interval '9 days', now() - interval '8 days', now(), null, pg_temp.u(3)),
  ('Subtask deschis #1017', pg_temp.g('Rădăcină #1017'), pg_temp.task('Umbrelă #1017'), 'local', 'direct',
   'todo', null, null, now() - interval '9 days', null, null, now() + interval '9 days', pg_temp.u(3));

create temporary table awards (title text primary key, member_id uuid, points int);
insert into awards values
  ('Cu puncte #1017',          pg_temp.u(5),  pg_temp.test_credit_task(pg_temp.task('Cu puncte #1017'), pg_temp.u(5), pg_temp.u(3))),
  ('Puncte responsabil #1017', pg_temp.u(10), pg_temp.test_credit_task(pg_temp.task('Puncte responsabil #1017'), pg_temp.u(10), pg_temp.u(3))),
  ('Nepot punctat #1017',      pg_temp.u(6),  pg_temp.test_credit_task(pg_temp.task('Nepot punctat #1017'), pg_temp.u(6), pg_temp.u(3))),
  ('Subtask punctat #1017',    pg_temp.u(6),  pg_temp.test_credit_task(pg_temp.task('Subtask punctat #1017'), pg_temp.u(6), pg_temp.u(3)));
grant select on awards to authenticated;
-- One Activity row the immutability guard must keep protecting (section 4).
insert into public.task_activity (task_id, kind, actor_id, details)
values (pg_temp.task('Puncte responsabil #1017'), 'created', pg_temp.u(3), '{}'::jsonb);

-- The approved Completed-work Request that produced a Task, and Notifications
-- about the Tasks.
insert into public.completed_work_requests (requester_id, description, status, decided_by, decided_at, task_id, group_id)
values (pg_temp.u(5), 'Am făcut deja #1017', 'approved', pg_temp.u(3), now(), pg_temp.task('Cu puncte #1017'),
        pg_temp.g('Rădăcină #1017'));
select private.notify(array[pg_temp.u(5)], 'task'::public.noti_kind, 'Task nou: Cu puncte #1017', null,
  pg_temp.task('Cu puncte #1017'), null, null);

-- Calendar and Campaigns.
insert into public.campaigns (name, group_id, created_by) values
  ('Campanie #1017',       pg_temp.g('Rădăcină #1017'), pg_temp.u(3)),
  ('Campanie nepot #1017', pg_temp.g('Nepot #1017'),    pg_temp.u(3));
insert into public.tasks (title, group_id, audience, assignment_mode, status, deadline, campaign_id, created_by)
values ('Etichetat #1017', pg_temp.g('Rădăcină #1017'), 'local', 'direct', 'todo', now() + interval '9 days',
        (select id from public.campaigns where name = 'Campanie #1017'), pg_temp.u(3));
insert into public.events (title, type, starts_at, group_id, campaign_id, created_by) values
  ('Eveniment #1017',           'activitate', now() + interval '5 days', pg_temp.g('Rădăcină #1017'), null, pg_temp.u(3)),
  ('Eveniment etichetat #1017', 'activitate', now() + interval '6 days', pg_temp.g('Rădăcină #1017'),
   (select id from public.campaigns where name = 'Campanie #1017'), pg_temp.u(3)),
  ('Eveniment nepot #1017',     'activitate', now() + interval '7 days', pg_temp.g('Nepot #1017'), null, pg_temp.u(3));
create function pg_temp.event(p_title text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.events where title = p_title
$$;
insert into public.event_attendance (event_id, member_id, status)
values (pg_temp.event('Eveniment #1017'), pg_temp.u(5), 'going');
select private.notify(array[pg_temp.u(5)], 'event'::public.noti_kind, 'Eveniment nou: Eveniment #1017', null,
  null, 'event:' || pg_temp.event('Eveniment #1017'), null, '/calendar?event=' || pg_temp.event('Eveniment #1017'));
insert into public.announcements (title, body, group_id, created_by) values
  ('Anunț cu evenimentul #1017', 'Publicat odată cu evenimentul.', pg_temp.g('Rădăcină #1017'), pg_temp.u(3)),
  ('Anunț nepot #1017',          'Doar pentru nepot.',             pg_temp.g('Nepot #1017'),    pg_temp.u(3));

create temporary table ids as
select pg_temp.task('Fără puncte #1017')     as t_plain,
       pg_temp.task('Copie #1017')           as t_copy,
       pg_temp.task('Cu puncte #1017')       as t_points,
       pg_temp.task('Puncte responsabil #1017') as t_resp,
       pg_temp.task('Umbrelă #1017')         as t_umbrella,
       pg_temp.task('Subtask punctat #1017') as t_sub_done,
       pg_temp.task('Subtask deschis #1017') as t_sub_open,
       pg_temp.task('În afară #1017')        as t_outside,
       pg_temp.task('Etichetat #1017')       as t_labelled,
       pg_temp.task('Nepot punctat #1017')   as t_grandchild,
       pg_temp.event('Eveniment #1017')      as e_plain,
       pg_temp.event('Eveniment etichetat #1017') as e_labelled,
       pg_temp.event('Eveniment nepot #1017') as e_grandchild,
       (select id from public.campaigns where name = 'Campanie #1017') as c_plain,
       (select id from public.campaigns where name = 'Campanie nepot #1017') as c_grandchild,
       (select id from public.announcements where title = 'Anunț cu evenimentul #1017') as a_plain,
       (select id from public.announcements where title = 'Anunț nepot #1017') as a_grandchild,
       pg_temp.g('Gol #1017') as g_empty;
grant select on ids to authenticated;

create function pg_temp.as_bc() returns void language sql as $$
  select pg_temp.test_login(pg_temp.u(1), '{"member_role":"bc","member_level":6}'::jsonb) $$;
create function pg_temp.as_member(n integer) returns void language sql as $$
  select pg_temp.test_login(pg_temp.u(n), '{"member_role":"voluntar","member_level":1}'::jsonb) $$;
create function pg_temp.as_claimless() returns void language sql as $$
  select pg_temp.test_login(pg_temp.u(9), '{}'::jsonb) $$;
create function pg_temp.as_inactive_bc() returns void language sql as $$
  select pg_temp.test_login(pg_temp.u(7), '{"member_role":"bc","member_level":6}'::jsonb) $$;

-- A refusal's SQLSTATE, message and DETAIL, as one value an assertion can diff.
create function pg_temp.refusal(p_sql text) returns jsonb
language plpgsql as $fn$
declare
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return jsonb_build_object('state', sqlstate, 'message', sqlerrm, 'detail', nullif(v_detail, ''));
end;
$fn$;

-- ==================== 1 · delete_task: gate and authority ====================

select pg_temp.as_claimless();
select throws_ok(format('select public.delete_task(%s)', (select t_plain from ids)),
  '42501', 'task_command_forbidden', 'delete_task: a claimless session is refused before anything');
select pg_temp.as_inactive_bc();
select throws_ok(format('select public.delete_task(%s)', (select t_plain from ids)),
  '42501', 'task_command_forbidden', 'delete_task: a deactivated BC is refused -- the token''s level is not authority');
select pg_temp.as_member(8);
select throws_ok(format('select public.delete_task(%s)', (select t_plain from ids)),
  'PT404', 'task_not_found', 'delete_task: a Task the caller cannot read is missing, never forbidden');
select pg_temp.as_member(6);
select throws_ok(format('select public.delete_task(%s)', (select t_plain from ids)),
  '42501', 'task_manage_forbidden', 'delete_task: the Task''s own Executor reads it but does not manage it');
select throws_ok(format('select public.task_delete_preview(%s)', (select t_plain from ids)),
  '42501', 'task_manage_forbidden', 'task_delete_preview: the same manager gate as the command');

-- ==================== 2 · Points: refusal, evaluator rule, reversal ====================

select pg_temp.as_member(3);
select is(public.task_delete_preview((select t_points from ids)),
  jsonb_build_object('subtasks', 0, 'total', (select points from awards where title = 'Cu puncte #1017'),
    'members', jsonb_build_array(jsonb_build_object('member_id', pg_temp.u(5),
      'points', (select points from awards where title = 'Cu puncte #1017')))),
  'task_delete_preview: the Task Manager sees the points the Task still holds, in total and per Member');
select is(pg_temp.refusal(format('select public.delete_task(%s)', (select t_points from ids))),
  jsonb_build_object('state', 'PT409', 'message', 'task_has_points',
    'detail', jsonb_build_object('total', (select points from awards where title = 'Cu puncte #1017'),
      'members', jsonb_build_array(jsonb_build_object('member_id', pg_temp.u(5),
        'points', (select points from awards where title = 'Cu puncte #1017'))))::text),
  'delete_task: a Task that gave points is refused unless the caller chose to take them back, and the refusal names the total and every Member');
reset role;
select is((select count(*)::int from public.tasks where id = (select t_points from ids)), 1,
  'the refused delete changed nothing: the Task is still there');

-- Group Responsible 4 manages the completed Task of Responsible 10 (its
-- Assignment has ended), but reopen_task's rule forbids reversing a peer
-- Responsible's award below level 6.
select pg_temp.as_member(4);
select throws_ok(format('select public.delete_task(%s, true)', (select t_resp from ids)),
  '42501', 'task_evaluate_forbidden',
  'delete_task(p_with_points): taking points back keeps reopen_task''s authority -- a Group Responsible cannot reverse a peer Responsible''s award');
reset role;
select is((select coalesce(sum(delta), 0)::int from public.points_ledger where member_id = pg_temp.u(10)),
  (select points from awards where title = 'Puncte responsabil #1017'),
  'and the refused reversal left the peer''s points in place');

select pg_temp.as_member(3);
select is(public.delete_task((select t_points from ids), true),
  jsonb_build_object('deleted_tasks', 1,
    'points_reversed', -(select points from awards where title = 'Cu puncte #1017'), 'members', 1),
  'delete_task(p_with_points): the Task Manager deletes the Task and its points');
select pg_temp.as_member(5);
select is((select points from public.my_points), 0,
  'my_points: the Member''s total dropped by exactly the award');
reset role;
select is((select count(*)::int from public.tasks where id = (select t_points from ids)), 0,
  'the Task is gone');
select is(
  (select array_agg(delta || ':' || reason || ':' || coalesce(task_id::text, 'null') || ':' ||
                    coalesce(evaluation_id::text, 'null') || ':' || deleted_task_title order by id)
     from public.points_ledger where member_id = pg_temp.u(5)),
  array[(select points from awards where title = 'Cu puncte #1017') || ':task:null:null:Cu puncte #1017',
        -(select points from awards where title = 'Cu puncte #1017') || ':task_reversal:null:null:Cu puncte #1017'],
  'the ledger kept both rows -- the award and its task_reversal -- with the reference nulled and the Task''s title recorded');
select is(
  (select count(*)::int from public.task_evaluations where task_id = (select t_points from ids))
  + (select count(*)::int from public.task_assignments where task_id = (select t_points from ids))
  + (select count(*)::int from public.task_activity where task_id = (select t_points from ids)),
  0, 'its Evaluations, Assignments and Activity went with it');
select is((select count(*)::int from public.completed_work_requests where description = 'Am făcut deja #1017'), 0,
  'the approved Completed-work Request that produced it went with it');
select is((select count(*)::int from public.notifications
            where task_id = (select t_points from ids) or subject = 'task:' || (select t_points from ids)),
  0, 'the Notifications about it went with it');
select is((select array_agg(title || ' | ' || body) from public.notifications where member_id = pg_temp.u(5) and kind = 'task'),
  array['Task șters: Cu puncte #1017 | Taskul Cu puncte #1017 a fost șters; punctele au fost retrase.'],
  'and the Member whose points were taken back is told once');

select pg_temp.as_member(3);
select is(public.delete_task((select t_plain from ids)),
  jsonb_build_object('deleted_tasks', 1, 'points_reversed', 0, 'members', 0),
  'delete_task: a Task with no points is deleted straight away by its manager');
reset role;
select is((select count(*)::int from public.tasks where id = (select t_plain from ids))
          + (select count(*)::int from public.task_assignments where task_id = (select t_plain from ids)),
  0, 'it is gone with its live Assignment');
select is((select duplicated_from_task_id from public.tasks where id = (select t_copy from ids)), null::bigint,
  'a copy of it keeps existing and only forgets where it was copied from');

-- ==================== 3 · The Umbrella cascade ====================

select pg_temp.as_bc();
select is((pg_temp.refusal(format('select public.delete_task(%s)', (select t_umbrella from ids))) ->> 'message'),
  'task_has_points', 'delete_task: an Umbrella whose Subtask gave points is refused too');
select is(public.task_delete_preview((select t_umbrella from ids)) -> 'subtasks', '2'::jsonb,
  'task_delete_preview: the Umbrella''s Subtasks are counted');
select is(public.delete_task((select t_umbrella from ids), true) -> 'deleted_tasks', '3'::jsonb,
  'delete_task(p_with_points): the Umbrella goes with both Subtasks');
reset role;
select is((select count(*)::int from public.tasks
            where id in ((select t_umbrella from ids), (select t_sub_done from ids), (select t_sub_open from ids))),
  0, 'no Subtask survives its Umbrella');
select is((select sum(delta)::int from public.points_ledger
            where member_id = pg_temp.u(6) and deleted_task_title = 'Subtask punctat #1017'),
  0, 'the Subtask''s award was reversed before it went');
select is((select count(*)::int from public.tasks
            where id in ((select t_outside from ids), (select t_resp from ids), (select t_copy from ids),
                         (select t_labelled from ids), (select t_grandchild from ids))),
  5, 'nothing outside the targets moved: every other Task is still there');

-- ==================== 4 · The guards still refuse every other delete ====================

select throws_ok(format('delete from public.task_activity where task_id = %s', (select t_resp from ids)),
  '23514', 'task_activity_immutable', 'task_activity: a delete outside delete_task is still refused, even for the owner');
select set_config('osubb.deleting_task_ids', array[(select t_outside from ids)]::text, true);
select throws_ok(format('delete from public.task_activity where task_id = %s', (select t_resp from ids)),
  '23514', 'task_activity_immutable', 'task_activity: the deletion setting admits only the Tasks it names');
select throws_ok(format('delete from public.task_evaluations where task_id = %s', (select t_resp from ids)),
  '23514', 'task_evaluation_immutable', 'task_evaluations: likewise');
select set_config('osubb.deleting_task_ids', '', true);
select throws_ok(format($$insert into public.points_ledger (member_id, delta, reason) values (%L, 5, 'task')$$, pg_temp.u(5)),
  '23514', 'new row for relation "points_ledger" violates check constraint "points_ledger_task_reference_ck"', 'points_ledger_task_reference_ck: a task row needs its Task or, once deleted, its title');
select throws_ok(format('update public.points_ledger set task_id = null where member_id = %L', pg_temp.u(10)),
  '23514', 'new row for relation "points_ledger" violates check constraint "points_ledger_task_reference_ck"', 'points_ledger_task_reference_ck: task_id and evaluation_id are only ever nulled together, with the title');

-- ==================== 5 · delete_event ====================

select pg_temp.as_claimless();
select throws_ok(format('select public.delete_event(%s)', (select e_plain from ids)),
  '42501', 'calendar_manage_forbidden', 'delete_event: a claimless session is refused');
select pg_temp.as_member(5);
select throws_ok(format('select public.delete_event(%s)', (select e_plain from ids)),
  '42501', 'calendar_manage_forbidden', 'delete_event: a member who reads the Event does not manage it');
select throws_ok('select public.delete_event(999999999)',
  'PT404', 'event_not_found', 'delete_event: an unknown Event is not found');
select pg_temp.as_member(3);
select is(public.delete_event((select e_plain from ids)), '{"rsvps": 1}'::jsonb,
  'delete_event: whoever manages the Event deletes it');
reset role;
select is((select count(*)::int from public.events where id = (select e_plain from ids))
          + (select count(*)::int from public.event_attendance where event_id = (select e_plain from ids)),
  0, 'the Event is gone with its RSVPs');
select is((select count(*)::int from public.notifications where subject = 'event:' || (select e_plain from ids)),
  0, 'and with its Notifications');
select is((select count(*)::int from public.announcements where id = (select a_plain from ids)), 1,
  'an Announcement published with the Event stays');

-- ==================== 6 · delete_campaign ====================

select pg_temp.as_claimless();
select throws_ok(format('select public.delete_campaign(%s)', (select c_plain from ids)),
  '42501', 'campaign_manage_forbidden', 'delete_campaign: a claimless session is refused');
select pg_temp.as_member(5);
select throws_ok(format('select public.delete_campaign(%s)', (select c_plain from ids)),
  '42501', 'campaign_manage_forbidden', 'delete_campaign: a member does not manage the Campaign');
select throws_ok('select public.delete_campaign(999999999)',
  'PT404', 'campaign_not_found', 'delete_campaign: an unknown Campaign is not found');
select pg_temp.as_member(3);
select is(public.delete_campaign((select c_plain from ids)), '{"tasks": 1, "events": 1}'::jsonb,
  'delete_campaign: whoever manages the Campaign deletes it, and says how many lost the label');
reset role;
select is((select count(*)::int from public.campaigns where id = (select c_plain from ids)), 0, 'the Campaign is gone');
select is((select campaign_id from public.tasks where id = (select t_labelled from ids)), null::bigint,
  'the Task it labelled keeps existing, without the label');
select is((select campaign_id from public.events where id = (select e_labelled from ids)), null::bigint,
  'and so does the Event');

-- ==================== 7 · Groups ====================

select pg_temp.as_claimless();
select throws_ok(format($$select public.delete_group(%s, 'archive')$$, pg_temp.g('Gol #1017')),
  'PT400', 'invalid_delete_mode', 'delete_group: an unknown mode is malformed for everyone, before the gate');
select throws_ok(format($$select public.delete_group(%s, 'empty')$$, pg_temp.g('Gol #1017')),
  '42501', 'group_manage_forbidden', 'delete_group: a claimless session is refused');
select pg_temp.as_member(3);
select throws_ok(format($$select public.delete_group(%s, 'everything')$$, pg_temp.g('Rădăcină #1017')),
  '42501', 'group_manage_forbidden', 'delete_group: a top-level Group is BC''s and the Moderator''s, even for its own Group Manager');
select throws_ok(format('select public.group_delete_preview(%s)', pg_temp.g('Rădăcină #1017')),
  '42501', 'group_manage_forbidden', 'group_delete_preview: the same authority');
select pg_temp.as_member(5);
select throws_ok(format($$select public.delete_group(%s, 'everything')$$, pg_temp.g('Copil #1017')),
  '42501', 'group_manage_forbidden', 'delete_group: a member of the parent does not manage a Child Group');
select pg_temp.as_inactive_bc();
select throws_ok(format($$select public.delete_group(%s, 'empty')$$, pg_temp.g('Gol #1017')),
  '42501', 'group_manage_forbidden', 'delete_group: a deactivated BC is refused');

select pg_temp.as_member(3);
select is(public.group_delete_preview(pg_temp.g('Copil #1017')),
  jsonb_build_object('subgroups', 1, 'members', 2, 'tasks', 1, 'tasks_with_points', 1,
    'points', (select points from awards where title = 'Nepot punctat #1017'), 'point_members', 1,
    'events', 1, 'announcements', 1, 'campaigns', 1, 'applications', 0, 'requests', 0, 'protected', false),
  'group_delete_preview: the parent''s Group Manager sees everything the Child Group''s subtree holds');
select is((pg_temp.refusal(format($$select public.delete_group(%s, 'empty')$$, pg_temp.g('Copil #1017'))) ->> 'message'),
  'group_not_empty', 'delete_group(empty): a Group with content is refused');

select pg_temp.as_bc();
select is(public.delete_group(pg_temp.g('Gol #1017'), 'empty') ->> 'mode', 'empty',
  'delete_group(empty): BC deletes a Group whose only content is its roster');
reset role;
select is((select count(*)::int from public.groups where id = (select g_empty from ids))
          + (select count(*)::int from public.group_members where group_id = (select g_empty from ids)),
  0, 'the empty Group is gone, its roster with it');

select pg_temp.as_bc();
select throws_ok(format($$select public.delete_group(%s, 'empty')$$, pg_temp.g('Automat #1017')),
  'PT409', 'group_protected', 'delete_group: an Automatic-Membership Group is never deleted');
select throws_ok(format($$select public.delete_group(%s, 'everything')$$,
                        (select id from public.groups where is_organization)),
  'PT409', 'group_protected', 'delete_group: the Organization Group is never deleted');
select throws_ok(format($$select public.delete_group(%s, 'empty')$$, pg_temp.g('Birou #1017')),
  'PT409', 'group_protected', 'delete_group: the board Group set in Setări is never deleted');
select throws_ok(format($$select public.delete_group(%s, 'empty')$$, pg_temp.g('Adunare #1017')),
  'PT409', 'group_protected', 'delete_group: the Adunarea Generală set in Setări is never deleted');
select throws_ok(format($$select public.delete_group(%s, 'everything')$$, pg_temp.g('Părinte protejat #1017')),
  'PT409', 'group_protected', 'delete_group: nor is a Group whose subtree holds a protected Group');
select is(public.group_delete_preview(pg_temp.g('Automat #1017')) -> 'protected', 'true'::jsonb,
  'group_delete_preview: says the Group is protected');

create temporary table cup_before as
  select points from public.department_cup() where group_id = pg_temp.g('Rădăcină #1017');
reset role;
create temporary table groups_before as select id, name from public.groups;
grant select on cup_before, groups_before to authenticated;

select pg_temp.as_member(3);
select is(public.delete_group(pg_temp.g('Copil #1017'), 'everything') ->> 'points_reversed',
  (-(select points from awards where title = 'Nepot punctat #1017'))::text,
  'delete_group(everything): the parent''s Group Manager deletes the Child Group''s whole subtree, reversing its points');
reset role;
select is((select array_agg(name order by name) from groups_before where id not in (select id from public.groups)),
  array['Copil #1017', 'Nepot #1017'],
  'exactly two Groups were removed -- the Child Group and the one below it; the parent and every other Group stay');
select is((select count(*)::int from public.tasks where id = (select t_grandchild from ids))
          + (select count(*)::int from public.events where id = (select e_grandchild from ids))
          + (select count(*)::int from public.announcements where id = (select a_grandchild from ids))
          + (select count(*)::int from public.campaigns where id = (select c_grandchild from ids)),
  0, 'its Tasks, Events, Announcements and Campaigns went with it');
select is((select sum(delta)::int from public.points_ledger
            where member_id = pg_temp.u(6) and deleted_task_title = 'Nepot punctat #1017'),
  0, 'the subtree''s award was reversed through the ledger, not erased');
select is((select count(*)::int from public.notifications
            where member_id = pg_temp.u(6) and title = 'Grup șters: Copil #1017'),
  1, 'the Member whose points were taken back is told once');
select pg_temp.as_bc();
select is((select points from public.department_cup() where group_id = pg_temp.g('Rădăcină #1017')),
  (select points from cup_before) - (select points from awards where title = 'Nepot punctat #1017'),
  'the Department Cup follows the reversal');

select is(public.delete_group(pg_temp.g('Rădăcină #1017'), 'everything') ->> 'points_reversed',
  (-(select points from awards where title = 'Puncte responsabil #1017'))::text,
  'delete_group(everything): BC deletes a top-level Group with all its content');
reset role;
select is((select count(*)::int from public.tasks where id in ((select t_resp from ids), (select t_copy from ids), (select t_labelled from ids)))
          + (select count(*)::int from public.events where id = (select e_labelled from ids))
          + (select count(*)::int from public.announcements where id = (select a_plain from ids)),
  0, 'every Task, Event and Announcement of the Group is gone');
select is((select coalesce(sum(delta), 0)::int from public.points_ledger where member_id = pg_temp.u(10)), 0,
  'and every point it held was taken back');
select is((select count(*)::int from public.groups where name in ('Alt grup #1017', 'Automat #1017', 'Birou #1017'))
          + (select count(*)::int from public.tasks where id = (select t_outside from ids)),
  4, 'nothing outside the deleted subtrees moved');

-- ==================== 8 · Lock order on committed fixtures ====================

select extensions.dblink_connect('df_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('df_setup', 'set lock_timeout = ''2s''');

create function pg_temp.df_cleanup() returns void language plpgsql as $fn$
begin
  perform extensions.dblink_exec('df_setup', $$
    set session_replication_role = 'replica';
    delete from public.task_activity
     where task_id in (select id from public.tasks where title like '%#1017 committed%');
    set session_replication_role = 'origin';
    delete from public.notifications
     where task_id in (select id from public.tasks where title like '%#1017 committed%')
        or member_id = '10170000-0000-0000-0000-000000000051';
    delete from public.tasks
     where parent_task_id in (select id from public.tasks where title like '%#1017 committed%');
    delete from public.tasks where title like '%#1017 committed%';
    delete from public.group_members where member_id = '10170000-0000-0000-0000-000000000051';
    delete from auth.users where id = '10170000-0000-0000-0000-000000000051';
  $$);
end;
$fn$;
select pg_temp.df_cleanup();

select extensions.dblink_exec('df_setup', $$
  insert into auth.users (id, email) values ('10170000-0000-0000-0000-000000000051', 'probe.manager.1017@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('10170000-0000-0000-0000-000000000051', 'Probe Manager 1017', 'probe.manager.1017@test.local', 'bce', 'activ');
  insert into public.group_members (group_id, member_id, group_role)
  select id, '10170000-0000-0000-0000-000000000051', 'manager' from public.groups where name = 'Educațional';
  insert into public.tasks (title, description, group_id, kind, audience, assignment_mode, status, created_by)
  values ('Umbrela sonda #1017 committed', 'Umbrela', (select id from public.groups where name = 'Educațional'),
          'umbrella', null, null, 'todo', '10170000-0000-0000-0000-000000000051');
  insert into public.tasks (title, deadline, group_id, audience, assignment_mode, status, parent_task_id, created_by)
  select 'Sonda subtask A #1017 committed', now() + interval '10 days', parent.group_id, 'local', 'direct', 'todo',
         parent.id, '10170000-0000-0000-0000-000000000051'
    from public.tasks as parent where parent.title = 'Umbrela sonda #1017 committed';
  insert into public.tasks (title, deadline, group_id, audience, assignment_mode, status, parent_task_id, created_by)
  select 'Sonda subtask B #1017 committed', now() + interval '10 days', parent.group_id, 'local', 'direct', 'todo',
         parent.id, '10170000-0000-0000-0000-000000000051'
    from public.tasks as parent where parent.title = 'Umbrela sonda #1017 committed';
$$);

create temp table r1017 as
select (select id from public.tasks where title = 'Umbrela sonda #1017 committed') as umbrella_id,
       (select id from public.tasks where title = 'Sonda subtask A #1017 committed') as sub_a_id,
       (select id from public.tasks where title = 'Sonda subtask B #1017 committed') as sub_b_id;

create function pg_temp.df_wait_until_blocked(p_application_name text) returns boolean
language plpgsql as $fn$
begin
  for v_attempt in 1..300 loop
    perform pg_catalog.pg_stat_clear_snapshot();
    if exists (select 1 from pg_catalog.pg_stat_activity
                where application_name = p_application_name and wait_event_type = 'Lock') then
      return true;
    end if;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  return false;
end;
$fn$;

-- Session HOLD owns the LAST Subtask the command will reach.
select extensions.dblink_connect('df_hold', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres application_name=df_hold_1017',
  current_database()));
select extensions.dblink_exec('df_hold', $$ begin; set local statement_timeout = '20s'; $$);
select * from extensions.dblink('df_hold', format(
  'select task.status::text from public.tasks as task where task.id = %s for update',
  (select sub_b_id from r1017))) as hold_sub_b(status text);

-- Session DELETE runs the real command asynchronously so it can sit blocked.
select extensions.dblink_connect('df_delete', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres application_name=df_delete_1017',
  current_database()));
select extensions.dblink_exec('df_delete', $$
  begin; set local statement_timeout = '20s'; set local lock_timeout = '15s';
$$);
select * from extensions.dblink('df_delete', format('select set_config(''request.jwt.claims'', %L, true)',
  jsonb_build_object('sub', '10170000-0000-0000-0000-000000000051', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'bce', 'member_level', 5))::text))
  as remote_claims(setting text);
select extensions.dblink_exec('df_delete', 'set local role authenticated');
select extensions.dblink_send_query('df_delete', format(
  $$select (public.delete_task(%s)) ->> 'deleted_tasks'$$, (select umbrella_id from r1017)));

select ok(pg_temp.df_wait_until_blocked('df_delete_1017'),
  'delete_task has locked the Umbrella and its first Subtask and now waits for the Subtask session HOLD owns');
select is((select row_lock.modes from extensions.pgrowlocks('public.tasks') as row_lock
             join public.tasks as task on task.ctid = row_lock.locked_row
            where task.id = (select umbrella_id from r1017)),
  array['For No Key Update'],
  'the Umbrella is held FOR NO KEY UPDATE -- never For Update, which would deadlock against an evaluation''s implicit FOR KEY SHARE');
select is((select row_lock.modes from extensions.pgrowlocks('public.tasks') as row_lock
             join public.tasks as task on task.ctid = row_lock.locked_row
            where task.id = (select sub_a_id from r1017)),
  array['For No Key Update'],
  'and the first Subtask is locked in the same mode and not yet written: the whole set is locked, in id order, before any write');
select lives_ok(format($outer$ select extensions.dblink_exec('df_hold', %L) $outer$, format($$
    insert into public.task_activity (task_id, kind, actor_id, details)
    values (%s, 'subtask_completed', '10170000-0000-0000-0000-000000000051', jsonb_build_object('probe', '1017'))
  $$, (select umbrella_id from r1017))),
  'an evaluation''s parent-naming insert on the Umbrella goes straight through while delete_task holds it and waits on this session''s Subtask');

create function pg_temp.df_delete_result() returns text language plpgsql as $fn$
declare v_result text;
begin
  select remote.result into v_result from extensions.dblink_get_result('df_delete') as remote(result text);
  return coalesce(v_result, '(no row)');
exception when others then
  return sqlstate;
end;
$fn$;

select extensions.dblink_exec('df_hold', 'rollback');
select extensions.dblink_disconnect('df_hold');
select is(pg_temp.df_delete_result(), '3',
  'once HOLD lets go, delete_task finishes and removes the Umbrella with both Subtasks -- never a 40P01');
select pg_temp.test_drain('df_delete');
select extensions.dblink_exec('df_delete', 'rollback');
select extensions.dblink_disconnect('df_delete');
select pg_temp.df_cleanup();
select extensions.dblink_disconnect('df_setup');

select * from finish();
rollback;
