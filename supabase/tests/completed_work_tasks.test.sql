-- #915: shaping the Task when approving a Completed-work Request, and adding a
-- completed Task for a Group member directly (public.create_completed_task),
-- with the two picker reads over the same predicate.
--
-- What this suite pins:
--   1. An approval writes the Task exactly as the decider shaped it -- title,
--      details, another Group, Attached Link, Campaign -- and with no edits
--      still writes the Request's own text on its own Group.
--   2. create_completed_task writes the completed Task, its Assignment, its
--      Evaluation and its points in one call; the points are evaluate_task's
--      (Difficulty x rating_mult) and the Executor gets exactly one
--      Notification.
--   3. Every refusal is the server's: an outsider Group, an archived Group,
--      an Executor outside the Group's subtree, under its Minimum Level, BC or
--      the Moderator, deactivated, the caller themselves, a Responsible
--      crediting another Responsible, a claimless or deactivated caller, a
--      Campaign that cannot tag the Group, the daily cap -- each assertion
--      goes red when its guard is removed.
--   4. The pickers offer exactly what the commands accept.
--
-- Fixture prefix 91500000-0000-0000-0000-0000000000NN; native Groups written
-- as the owner in this rolled-back transaction (conventions §10).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(69);

-- ==================== Fixtures ====================
create function pg_temp.u915(n integer) returns uuid language sql immutable as $$
  select ('91500000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
grant execute on function pg_temp.u915(integer) to authenticated, anon;

--  1 BC                          2 M   Manager of Dept A      3 R  Responsible of Echipa A1
--  4 V1 member of Echipa A1,     5 M2  Manager of Dept B      6 V2 member of Dept B
--       Responsible of Sub A1    7 R2  Responsible of A1      8 BC2 member of Dept A
--  9 MOD member of Dept A       10 MX  Manager of Dept B, deactivated
-- 11 V3 below Echipa A1's Minimum Level (fixture bypasses the roster guard)
-- 12 V5 member of Dept A, deactivated
insert into auth.users (id, email)
select pg_temp.u915(n), 'm915.' || n || '@test.local' from generate_series(1, 12) n;

insert into public.profiles (id, full_name, email, role, status)
select pg_temp.u915(n), 'Membru 915 ' || lpad(n::text, 2, '0'), 'm915.' || n || '@test.local',
       (case n when 1 then 'bc' when 2 then 'bce' when 3 then 'vot' when 4 then 'activ'
               when 5 then 'bce' when 6 then 'voluntar' when 7 then 'vot' when 8 then 'bc'
               when 9 then 'moderator' when 10 then 'bce' when 11 then 'recrut'
               else 'voluntar' end)::public.member_role,
       'activ'
  from generate_series(1, 12) n;

insert into public.groups (name, category, min_level) values
  ('Dept A #915', 'department', 0), ('Dept B #915', 'department', 0), ('Arhivat #915', 'department', 0);
insert into public.groups (name, category, parent_id, min_level)
select 'Echipa A1 #915', 'team', id, 2 from public.groups where name = 'Dept A #915';
insert into public.groups (name, category, parent_id, min_level)
select 'Sub A1 #915', 'team', id, 2 from public.groups where name = 'Echipa A1 #915';
insert into public.groups (name, category, parent_id, min_level)
select 'Echipa B1 #915', 'team', id, 0 from public.groups where name = 'Dept B #915';

create function pg_temp.g915(p_name text) returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;
grant execute on function pg_temp.g915(text) to authenticated, anon;

insert into public.group_members (group_id, member_id, group_role)
select pg_temp.g915(row_.name), pg_temp.u915(row_.n), row_.group_role
  from (values ('Dept A #915', 2, 'manager'), ('Dept A #915', 8, 'member'),
               ('Dept A #915', 9, 'member'), ('Dept A #915', 12, 'member'),
               ('Echipa A1 #915', 3, 'responsible'), ('Echipa A1 #915', 7, 'responsible'),
               ('Echipa A1 #915', 4, 'member'), ('Sub A1 #915', 4, 'responsible'),
               ('Dept B #915', 5, 'manager'), ('Dept B #915', 10, 'manager'),
               ('Dept B #915', 6, 'member'), ('Arhivat #915', 4, 'member'))
       as row_ (name, n, group_role);

-- A roster row the invariants forbid (level 0 under a Minimum Level of 2):
-- the command's own Minimum Level check is the only thing left to refuse it.
set local session_replication_role = 'replica';
insert into public.group_members (group_id, member_id, group_role)
values (pg_temp.g915('Echipa A1 #915'), pg_temp.u915(11), 'member');
set local session_replication_role = 'origin';

update public.groups set status = 'archived' where name = 'Arhivat #915';
update public.profiles set status = 'inactiv' where id in (pg_temp.u915(10), pg_temp.u915(12));

insert into public.campaigns (group_id, name, created_by) values
  (pg_temp.g915('Dept A #915'), 'Campanie A #915', pg_temp.u915(1)),
  (pg_temp.g915('Dept B #915'), 'Campanie B #915', pg_temp.u915(1));
create function pg_temp.c915(p_name text) returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.campaigns where name = p_name
$$;
grant execute on function pg_temp.c915(text) to authenticated, anon;

insert into public.completed_work_requests (requester_id, group_id, description)
select pg_temp.u915(row_.n), pg_temp.g915(row_.name), row_.description
  from (values (4, 'Echipa A1 #915', 'Q1 am montat standul la targ #915'),
               (4, 'Echipa A1 #915', 'Q2 cerere mutata in afara #915'),
               (6, 'Dept B #915', 'Q3 cerere mutata la subgrup #915'),
               (4, 'Echipa A1 #915', 'Q4 cerere mutata la arhivat #915'),
               (11, 'Dept A #915', 'Q5 cerere sub nivel #915'),
               (4, 'Echipa A1 #915', 'Q6 cerere mutata unde e responsabil #915'),
               (4, 'Echipa A1 #915', 'Q7 cerere cu campanie straina #915'),
               (4, 'Echipa A1 #915', 'Q8 cerere cu text gresit #915'),
               (4, 'Echipa A1 #915', 'Q9 cerere aprobata fara modificari #915'),
               (2, 'Dept A #915', 'Q10 cererea proprie a managerului #915'))
       as row_ (n, name, description);
create function pg_temp.q915(p_prefix text) returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.completed_work_requests where description like p_prefix || ' %'
$$;
grant execute on function pg_temp.q915(text) to authenticated, anon;

-- The id of the Task a statement created, by title.
create function pg_temp.t915(p_title text) returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.tasks where title = p_title
$$;
grant execute on function pg_temp.t915(text) to authenticated, anon;

-- ==================== 1. Grants ====================
select ok(not has_function_privilege('anon',
  'public.create_completed_task(uuid, bigint, text, text, text, text, bigint, integer, integer, text)', 'execute'),
  'anon cannot execute create_completed_task');
select ok(has_function_privilege('authenticated',
  'public.create_completed_task(uuid, bigint, text, text, text, text, bigint, integer, integer, text)', 'execute'),
  'authenticated may call create_completed_task; its gate is inside');
select ok(not has_function_privilege('anon', 'public.completed_task_groups(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.completed_task_executors(bigint)', 'execute'),
  'anon cannot execute the two picker reads');
select ok(not has_function_privilege('authenticated',
  'private.require_completed_work_group(bigint, uuid, text, text, boolean)', 'execute'),
  'the Group gate is granted to no client role');

-- ==================== 2. One decider rule ====================
select set_eq(format($q$
  select member::text from private.request_deciders(%s) as member where member::text like '91500000-%%'
$q$, pg_temp.q915('Q1')),
  array[pg_temp.u915(1)::text, pg_temp.u915(2)::text, pg_temp.u915(3)::text,
        pg_temp.u915(7)::text, pg_temp.u915(8)::text, pg_temp.u915(9)::text],
  'request_deciders is work_deciders over the Request''s Group: BC and the Moderator, the Manager above, both Responsibles of the ordinary requester''s Group');
select set_eq(format($q$
  select member::text from private.work_deciders(%s, %L) as member where member::text like '91500000-%%'
$q$, pg_temp.g915('Echipa A1 #915'), pg_temp.u915(7)),
  array[pg_temp.u915(1)::text, pg_temp.u915(2)::text, pg_temp.u915(8)::text, pg_temp.u915(9)::text],
  'a Responsible''s work is decided above them: the other Responsible is not a decider, nor are they themselves');

-- ==================== 3. The pickers ====================
select pg_temp.test_login_leadership(pg_temp.u915(2));
select set_eq(format($q$ select member_id::text from public.completed_task_executors(%s) $q$, pg_temp.g915('Dept A #915')),
  array[pg_temp.u915(3)::text, pg_temp.u915(4)::text, pg_temp.u915(7)::text, pg_temp.u915(11)::text],
  'Dept A offers every active member of its subtree -- never the Manager themselves, BC, the Moderator or a deactivated member');
select set_eq(format($q$ select member_id::text from public.completed_task_executors(%s) $q$, pg_temp.g915('Echipa A1 #915')),
  array[pg_temp.u915(3)::text, pg_temp.u915(4)::text, pg_temp.u915(7)::text],
  'Echipa A1 leaves out the member under its Minimum Level');
select is((select count(*) from public.completed_task_executors(pg_temp.g915('Dept B #915'))), 0::bigint,
  'a Group the caller does not manage offers nobody');
select set_eq(format($q$ select id::text from public.completed_task_groups(%L) $q$, pg_temp.u915(4)),
  array[pg_temp.g915('Dept A #915')::text, pg_temp.g915('Echipa A1 #915')::text, pg_temp.g915('Sub A1 #915')::text],
  'the Manager may credit V1 in every Group of their subtree V1 belongs to -- not the archived one, not Dept B');
select is((select count(*) from public.completed_task_groups(pg_temp.u915(6))), 0::bigint,
  'no Group is offered for a volunteer outside the Manager''s Groups');
select is((select count(*) from public.completed_task_groups(pg_temp.u915(8))), 0::bigint,
  'no Group is offered for BC, although BC is on Dept A''s roster');
reset role;

select pg_temp.test_login_leadership(pg_temp.u915(3));
select set_eq(format($q$ select member_id::text from public.completed_task_executors(%s) $q$, pg_temp.g915('Echipa A1 #915')),
  array[pg_temp.u915(4)::text],
  'a Responsible is offered only the ordinary members: not themselves, not the other Responsible');
select set_eq(format($q$ select id::text from public.completed_task_groups(%L) $q$, pg_temp.u915(4)),
  array[pg_temp.g915('Echipa A1 #915')::text],
  'a Responsible is not offered the Child Group where V1 is a Responsible');
reset role;

select pg_temp.test_login_leadership(pg_temp.u915(1));
select set_eq(format($q$ select id::text from public.completed_task_groups(%L) where name like '%% #915' $q$, pg_temp.u915(4)),
  array[pg_temp.g915('Dept A #915')::text, pg_temp.g915('Echipa A1 #915')::text, pg_temp.g915('Sub A1 #915')::text],
  'BC is offered every active Group V1 belongs to, never an archived one');
select is((select count(*) from public.completed_task_executors(pg_temp.g915('Arhivat #915'))), 0::bigint,
  'nor anybody to credit in an archived Group, although BC decides there');
reset role;

select pg_temp.test_login(pg_temp.u915(2), '{"provider":"email"}'::jsonb);
select is((select count(*) from public.completed_task_groups(pg_temp.u915(4))), 0::bigint,
  'a claimless session is offered no Group');
select is((select count(*) from public.completed_task_executors(pg_temp.g915('Dept A #915'))), 0::bigint,
  'a claimless session is offered no volunteer');
reset role;

-- ==================== 4. create_completed_task: the happy path ====================
select pg_temp.test_login_leadership(pg_temp.u915(2));
select lives_ok(format($q$
  select public.create_completed_task(%L, %s, '  Task finalizat #915  ', 'Detalii despre munca facuta',
    'Poze', 'https://example.org/poze', %s, 4, 5, 'Foarte bine lucrat')
$q$, pg_temp.u915(4), pg_temp.g915('Echipa A1 #915'), pg_temp.c915('Campanie A #915')),
  'the Manager adds a completed Task for a member of the Group');
reset role;

select is((select format('%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s', task.status, task.kind, task.group_id,
                         task.description, task.link_label, task.link_url, task.campaign_id,
                         task.audience, task.assignment_mode, task.created_by, task.difficulty || '/' || task.rating)
             from public.tasks as task where task.id = pg_temp.t915('Task finalizat #915')),
  format('completed|task|%s|Detalii despre munca facuta|Poze|https://example.org/poze|%s|local|direct|%s|4/5',
         pg_temp.g915('Echipa A1 #915'), pg_temp.c915('Campanie A #915'), pg_temp.u915(2)),
  'the Task is written completed, exactly as chosen: trimmed title, details, Group, Attached Link, Campaign, local and direct, created by the caller');
select is((select format('%s|%s|%s', assignment.member_id, assignment.ended_at is not null, assignment.end_reason)
             from public.task_assignments as assignment
            where assignment.task_id = pg_temp.t915('Task finalizat #915')),
  pg_temp.u915(4) || '|t|completed',
  'one Assignment credits the volunteer and is ended as completed');
select is((select evaluation.points from public.task_evaluations as evaluation
            where evaluation.task_id = pg_temp.t915('Task finalizat #915')),
  4 * public.rating_mult(5),
  'the Evaluation''s points are evaluate_task''s: Difficulty x rating_mult(Rating)');
select is((select format('%s|%s', ledger.member_id, ledger.delta) from public.points_ledger as ledger
            where ledger.task_id = pg_temp.t915('Task finalizat #915')),
  pg_temp.u915(4) || '|' || (4 * public.rating_mult(5)),
  'one ledger row credits the volunteer with those points');
select is((select array_agg(format('%s|%s', notification.member_id, notification.title))
             from public.notifications as notification
            where notification.task_id = pg_temp.t915('Task finalizat #915')),
  array[pg_temp.u915(4) || '|Task evaluat: Task finalizat #915'],
  'the volunteer gets exactly one Notification -- the Evaluation''s, no "Task nou"');
select is((select activity.details ->> 'via' from public.task_activity as activity
            where activity.task_id = pg_temp.t915('Task finalizat #915') and activity.kind = 'executor_assigned'),
  'completed_task', 'the Assignment records how it was opened');

select pg_temp.test_login_leadership(pg_temp.u915(3));
select lives_ok(format($q$
  select public.create_completed_task(%L, %s, 'Task de la responsabil #915', null, null, null, null, 2, 3, 'Bine')
$q$, pg_temp.u915(4), pg_temp.g915('Echipa A1 #915')),
  'a Responsible adds a completed Task for an ordinary member of their Group');
reset role;

-- ==================== 5. create_completed_task: every refusal ====================
select pg_temp.test_login_leadership(pg_temp.u915(2));
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, 'Refuz grup strain #915', null, null, null, null, 3, 3, 'n')
$q$, pg_temp.u915(6), pg_temp.g915('Dept B #915')),
  '42501', 'task_manage_forbidden', 'a Group the caller does not manage is refused');
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, 'Refuz nemembru #915', null, null, null, null, 3, 3, 'n')
$q$, pg_temp.u915(6), pg_temp.g915('Dept A #915')),
  'PT409', 'executor_not_group_member', 'a volunteer outside the Group''s subtree is refused');
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, 'Refuz sub nivel #915', null, null, null, null, 3, 3, 'n')
$q$, pg_temp.u915(11), pg_temp.g915('Echipa A1 #915')),
  'PT409', 'executor_below_min_level', 'a volunteer under the Group''s Minimum Level is refused');
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, 'Refuz BC #915', null, null, null, null, 3, 3, 'n')
$q$, pg_temp.u915(8), pg_temp.g915('Dept A #915')),
  'PT409', 'executor_role_excluded', 'BC is never credited with a completed Task');
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, 'Refuz moderator #915', null, null, null, null, 3, 3, 'n')
$q$, pg_temp.u915(9), pg_temp.g915('Dept A #915')),
  'PT409', 'executor_role_excluded', 'nor is the Moderator');
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, 'Refuz dezactivat #915', null, null, null, null, 3, 3, 'n')
$q$, pg_temp.u915(12), pg_temp.g915('Dept A #915')),
  'PT400', 'invalid_executor', 'a deactivated member is refused');
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, 'Refuz autoacordare #915', null, null, null, null, 3, 3, 'n')
$q$, pg_temp.u915(2), pg_temp.g915('Dept A #915')),
  '42501', 'task_evaluate_forbidden', 'nobody awards themselves -- not even the Group''s Manager');
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, 'Refuz campanie #915', null, null, null, %s, 3, 3, 'n')
$q$, pg_temp.u915(4), pg_temp.g915('Echipa A1 #915'), pg_temp.c915('Campanie B #915')),
  'PT400', 'invalid_campaign', 'a Campaign that cannot tag a Task of the Group is refused');
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, 'ab', null, null, null, null, 3, 3, 'n')
$q$, pg_temp.u915(4), pg_temp.g915('Echipa A1 #915')),
  'PT400', 'title_too_short', 'the constraints kit judges the title');
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, 'Refuz descriere #915', repeat('d', 2001), null, null, null, 3, 3, 'n')
$q$, pg_temp.u915(4), pg_temp.g915('Echipa A1 #915')),
  'PT400', 'description_too_long', 'and the details');
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, 'Refuz link #915', null, 'Poze', 'ftp://x', null, 3, 3, 'n')
$q$, pg_temp.u915(4), pg_temp.g915('Echipa A1 #915')),
  'PT400', 'link_url_invalid', 'and the Attached Link');
select is((select count(*) from public.tasks where title like 'Refuz % #915'), 0::bigint,
  'no refused call left a Task behind');
reset role;

select pg_temp.test_login_leadership(pg_temp.u915(3));
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, 'Refuz responsabil #915', null, null, null, null, 3, 3, 'n')
$q$, pg_temp.u915(7), pg_temp.g915('Echipa A1 #915')),
  '42501', 'task_evaluate_forbidden', 'a Responsible never credits another Responsible of the Group');
reset role;

select pg_temp.test_login_leadership(pg_temp.u915(1));
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, 'Refuz arhivat #915', null, null, null, null, 3, 3, 'n')
$q$, pg_temp.u915(4), pg_temp.g915('Arhivat #915')),
  'PT409', 'group_archived', 'BC passes the manage gate on an archived Group, and is still refused');
reset role;

select pg_temp.test_login(pg_temp.u915(2), '{"provider":"email"}'::jsonb);
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, 'Refuz fara claimuri #915', null, null, null, null, 3, 3, 'n')
$q$, pg_temp.u915(4), pg_temp.g915('Echipa A1 #915')),
  '42501', 'task_command_forbidden', 'a claimless session is refused');
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, 'Refuz dificultate #915', null, null, null, null, 9, 3, 'n')
$q$, pg_temp.u915(4), pg_temp.g915('Echipa A1 #915')),
  'PT400', 'invalid_difficulty', 'a Difficulty outside 1..5 is malformed for everyone, answered before the gate');
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, 'Refuz nota #915', null, null, null, null, 3, 3, '   ')
$q$, pg_temp.u915(4), pg_temp.g915('Echipa A1 #915')),
  'PT400', 'evaluation_note_required', 'so is a blank Evaluation note');
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, '   ', null, null, null, null, 3, 3, 'n')
$q$, pg_temp.u915(4), pg_temp.g915('Echipa A1 #915')),
  'PT400', 'title_required', 'and a blank title');
reset role;

-- MX holds a Manager row on Dept B but is deactivated; the token still claims it.
select pg_temp.test_login(pg_temp.u915(10), jsonb_build_object('member_role', 'bce', 'member_level', 5,
  'group_ids', jsonb_build_array(pg_temp.g915('Dept B #915'))));
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, 'Refuz dezactivat apelant #915', null, null, null, null, 3, 3, 'n')
$q$, pg_temp.u915(6), pg_temp.g915('Dept B #915')),
  '42501', 'task_command_forbidden', 'a deactivated caller is refused although the token still names the Group');
reset role;

set local role anon;
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, 'Refuz anon #915', null, null, null, null, 3, 3, 'n')
$q$, pg_temp.u915(4), pg_temp.g915('Echipa A1 #915')),
  '42501', null, 'anon has no execute on the wrapper');
reset role;

-- ==================== 6. Approval: shaping the Task ====================
select pg_temp.test_login_leadership(pg_temp.u915(2));
select lives_ok(format($q$
  select public.approve_completed_work_request(%s, 3, 4, 'Aprobat cu modificari',
    p_title => 'Stand targ editat #915', p_description => 'Detalii scrise de decident',
    p_group_id => %s, p_link_label => 'Album', p_link_url => 'https://example.org/album',
    p_campaign_id => %s)
$q$, pg_temp.q915('Q1'), pg_temp.g915('Dept A #915'), pg_temp.c915('Campanie A #915')),
  'the Manager approves a Request after editing its title, details, Group, link and Campaign');
reset role;

select is((select format('%s|%s|%s|%s|%s|%s|%s', task.status, task.group_id, task.description,
                         task.link_label, task.link_url, task.campaign_id, task.audience)
             from public.tasks as task where task.id = pg_temp.t915('Stand targ editat #915')),
  format('completed|%s|Detalii scrise de decident|Album|https://example.org/album|%s|local',
         pg_temp.g915('Dept A #915'), pg_temp.c915('Campanie A #915')),
  'the approved Task carries exactly the decider''s values, on the Group they chose');
select is((select format('%s|%s', request.status, request.task_id = pg_temp.t915('Stand targ editat #915'))
             from public.completed_work_requests as request where request.id = pg_temp.q915('Q1')),
  'approved|t', 'the Request is approved and names that Task');
select is((select format('%s|%s', ledger.member_id, ledger.delta) from public.points_ledger as ledger
            where ledger.task_id = pg_temp.t915('Stand targ editat #915')),
  pg_temp.u915(4) || '|' || (3 * public.rating_mult(4)),
  'the requester gets evaluate_task''s points for the chosen Difficulty and Rating');

select pg_temp.test_login_leadership(pg_temp.u915(2));
select lives_ok(format($q$ select public.approve_completed_work_request(%s, 2, 3, 'Aprobat simplu') $q$,
  pg_temp.q915('Q9')),
  'an approval with no edits still works through the four-argument call');
reset role;
select is((select format('%s|%s', task.group_id, task.description)
             from public.tasks as task where task.title = 'Q9 cerere aprobata fara modificari #915'),
  format('%s|Q9 cerere aprobata fara modificari #915', pg_temp.g915('Echipa A1 #915')),
  'with no edits the Task keeps the Request''s text and Group');

-- ==================== 7. Approval: every refusal of a Group change ====================
select pg_temp.test_login_leadership(pg_temp.u915(2));
select throws_ok(format($q$
  select public.approve_completed_work_request(%s, 3, 3, 'n', p_group_id => %s)
$q$, pg_temp.q915('Q2'), pg_temp.g915('Dept B #915')),
  '42501', 'request_decide_forbidden', 'a Group the decider does not manage is refused');
select throws_ok(format($q$
  select public.approve_completed_work_request(%s, 3, 3, 'n', p_group_id => %s)
$q$, pg_temp.q915('Q5'), pg_temp.g915('Echipa A1 #915')),
  'PT409', 'executor_below_min_level', 'a Group whose Minimum Level the requester is under is refused');
select throws_ok(format($q$
  select public.approve_completed_work_request(%s, 3, 3, 'n', p_campaign_id => %s)
$q$, pg_temp.q915('Q7'), pg_temp.c915('Campanie B #915')),
  'PT400', 'invalid_campaign', 'a Campaign that cannot tag a Task of the Group is refused');
select throws_ok(format($q$
  select public.approve_completed_work_request(%s, 3, 3, 'n', p_title => 'ab')
$q$, pg_temp.q915('Q8')),
  'PT400', 'title_too_short', 'the constraints kit judges an edited title');
select throws_ok(format($q$
  select public.approve_completed_work_request(%s, 3, 3, 'n', p_title => '  ')
$q$, pg_temp.q915('Q8')),
  'PT400', 'title_required', 'an edited title cannot be blank');
select throws_ok(format($q$
  select public.approve_completed_work_request(%s, 3, 3, 'n', p_description => repeat('d', 2001))
$q$, pg_temp.q915('Q8')),
  'PT400', 'description_too_long', 'nor edited details too long');
select throws_ok(format($q$
  select public.approve_completed_work_request(%s, 3, 3, 'n', p_link_label => 'Album')
$q$, pg_temp.q915('Q8')),
  'PT400', 'link_incomplete', 'an Attached Link is both halves or neither');
select throws_ok(format($q$ select public.approve_completed_work_request(%s, 3, 3, 'n') $q$, pg_temp.q915('Q10')),
  '42501', 'request_decide_forbidden', 'the requester still cannot approve their own Request');
reset role;

select pg_temp.test_login_leadership(pg_temp.u915(5));
select throws_ok(format($q$
  select public.approve_completed_work_request(%s, 3, 3, 'n', p_group_id => %s)
$q$, pg_temp.q915('Q3'), pg_temp.g915('Echipa B1 #915')),
  'PT409', 'executor_not_group_member', 'a Group the requester does not belong to is refused');
reset role;

select pg_temp.test_login_leadership(pg_temp.u915(1));
select throws_ok(format($q$
  select public.approve_completed_work_request(%s, 3, 3, 'n', p_group_id => %s)
$q$, pg_temp.q915('Q4'), pg_temp.g915('Arhivat #915')),
  'PT409', 'group_archived', 'an archived Group is refused, even to BC');
reset role;

select pg_temp.test_login_leadership(pg_temp.u915(3));
select throws_ok(format($q$
  select public.approve_completed_work_request(%s, 3, 3, 'n', p_group_id => %s)
$q$, pg_temp.q915('Q6'), pg_temp.g915('Sub A1 #915')),
  '42501', 'request_decide_forbidden',
  'a Responsible cannot move a Request into a Group where the requester is a Responsible');
select lives_ok(format($q$ select public.approve_completed_work_request(%s, 3, 3, 'Aprobat de responsabil') $q$,
  pg_temp.q915('Q6')),
  'the same Responsible still decides it on its own Group');
reset role;

select is((select count(*) from public.completed_work_requests
            where id in (pg_temp.q915('Q2'), pg_temp.q915('Q3'), pg_temp.q915('Q4'), pg_temp.q915('Q5'),
                         pg_temp.q915('Q7'), pg_temp.q915('Q8'), pg_temp.q915('Q10'))
              and status = 'pending' and task_id is null), 7::bigint,
  'every refused approval left its Request pending, with no Task');

-- ==================== 8. Points are written in one place ====================
select ok((select pg_get_functiondef('private.create_completed_task_impl(uuid, bigint, text, text, text, text, bigint, integer, integer, text)'::regprocedure))
            !~ 'points_ledger|task_evaluations'
      and (select pg_get_functiondef('private.create_completed_task_impl(uuid, bigint, text, text, text, text, bigint, integer, integer, text)'::regprocedure))
            ~ 'private\.evaluate_task\(',
  'create_completed_task writes no points itself: private.evaluate_task does');
select ok((select pg_get_functiondef('private.approve_completed_work_request_impl(bigint, integer, integer, text, text, text, bigint, text, text, bigint)'::regprocedure))
            !~ 'points_ledger|task_evaluations'
      and (select pg_get_functiondef('private.approve_completed_work_request_impl(bigint, integer, integer, text, text, text, bigint, text, text, bigint)'::regprocedure))
            ~ 'private\.evaluate_task\(',
  'nor does an approval');

-- ==================== 9. The daily cap ====================
-- Fill the Manager's task_create allowance to one below its limit with
-- 'created' rows written as the owner (rolled back).
insert into public.task_activity (task_id, kind, actor_id)
select pg_temp.t915('Task finalizat #915'), 'created', pg_temp.u915(2)
  from generate_series(1, 99 - (select count(*) from public.task_activity
                                  where actor_id = pg_temp.u915(2) and kind = 'created'
                                    and created_at > clock_timestamp() - interval '24 hours'));

select pg_temp.test_login_leadership(pg_temp.u915(2));
select lives_ok(format($q$
  select public.create_completed_task(%L, %s, 'Al o suta-lea task #915', null, null, null, null, 1, 3, 'n')
$q$, pg_temp.u915(4), pg_temp.g915('Echipa A1 #915')),
  'the hundredth Task in 24 hours is added');
select throws_ok(format($q$
  select public.create_completed_task(%L, %s, 'Peste plafon #915', null, null, null, null, 1, 3, 'n')
$q$, pg_temp.u915(4), pg_temp.g915('Echipa A1 #915')),
  'PT409', 'rate_limited', 'the hundred-and-first is refused -- create_task''s cap, shared');
reset role;

select * from finish();
rollback;
