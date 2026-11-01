-- #1127: no new work inside an archived Group -- create_task, duplicate_task
-- and create_campaign refuse PT409 group_archived, and managed_work_groups()
-- says which Groups are archived so the forms can stop offering them.
--
-- Audit finding M3 (docs/review/2026-10-30-codebase-audit.md): the three
-- creators had no status check; their gate, private.can_manage_group_work,
-- lets level 6 and up through on an archived Group, so BC or the Moderator
-- could put a todo Task or a Campaign where archive_group's "no open work"
-- invariant said none could exist -- and where the Group's own Managers can
-- no longer manage it. create_completed_task and the Request approval
-- already answered group_archived; create_event reloads the Group as active.
-- managed_work_groups() returned no status, so Task nou offered archived
-- Groups to BC.
--
-- Pinned here: as BC and as the Moderator, each creator refuses the archived
-- Group with PT409 group_archived and works on an active one exactly as
-- before; the refusal is a state rule, so authority (42501) and the input
-- rules still come first; and managed_work_groups() carries status.
-- The refusals and the status column fail on main.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(22);

-- ==================== Fixtures ====================
-- 01 BC; 02 the Moderator; 03 a Volunteer with no authority anywhere.
insert into auth.users (id, email) values
  ('11270000-0000-0000-0000-000000000001', 'bc.1127@test.local'),
  ('11270000-0000-0000-0000-000000000002', 'moderator.1127@test.local'),
  ('11270000-0000-0000-0000-000000000003', 'voluntar.1127@test.local');
insert into public.profiles (id, full_name, email, role, status) values
  ('11270000-0000-0000-0000-000000000001', 'BC 1127', 'bc.1127@test.local', 'bc', 'activ'),
  ('11270000-0000-0000-0000-000000000002', 'Moderator 1127', 'moderator.1127@test.local', 'moderator', 'activ'),
  ('11270000-0000-0000-0000-000000000003', 'Voluntar 1127', 'voluntar.1127@test.local', 'voluntar', 'activ');

insert into public.groups (name, category, shared_work_visibility)
values ('Arhivat #1127', 'team', true), ('Activ #1127', 'team', true);
-- Archived the way the fixtures do it: the status flag is what the rule
-- reads, however the Group got there.
update public.groups set status = 'archived' where name = 'Arhivat #1127';

-- One direct todo Task in each Group, to duplicate, and an open Umbrella in
-- the archived one: a Subtask inherits its Group, so it is judged the same.
insert into public.tasks (title, description, deadline, group_id, audience, assignment_mode, status, created_by)
select 'Sursa ' || grp.name, 'De copiat', '2027-03-01 09:00:00+00', grp.id, 'local', 'direct', 'todo',
       '11270000-0000-0000-0000-000000000001'
  from public.groups as grp where grp.name in ('Arhivat #1127', 'Activ #1127');
insert into public.tasks (title, group_id, kind, audience, assignment_mode, status, created_by)
select 'Umbrela Arhivat #1127', grp.id, 'umbrella', null, null, 'todo',
       '11270000-0000-0000-0000-000000000001'
  from public.groups as grp where grp.name = 'Arhivat #1127';

create temp table f1127 as
select (select id from public.groups where name = 'Arhivat #1127') as archived_id,
       (select id from public.groups where name = 'Activ #1127') as active_id,
       (select id from public.tasks where title = 'Sursa Arhivat #1127') as archived_source_id,
       (select id from public.tasks where title = 'Sursa Activ #1127') as active_source_id,
       (select id from public.tasks where title = 'Umbrela Arhivat #1127') as archived_umbrella_id;
grant select on f1127 to authenticated;

-- ==================== 1. managed_work_groups() says which Groups are archived ====================
select is(pg_get_function_result('public.managed_work_groups()'::regprocedure),
  'TABLE(id bigint, name text, path bigint[], min_level integer, status text)',
  'managed_work_groups() returns the Group''s status with its id, name, path and Minimum Level');

select pg_temp.test_login_leadership('11270000-0000-0000-0000-000000000001');
select is((select grp.status from public.managed_work_groups() as grp where grp.id = (select archived_id from f1127)),
  'archived', 'BC still manages the archived Group, and reads that it is archived');
select is((select grp.status from public.managed_work_groups() as grp where grp.id = (select active_id from f1127)),
  'active', 'and that the other one is active');
reset role;

-- ==================== 2. BC: the three creators refuse the archived Group ====================
select pg_temp.test_login_leadership('11270000-0000-0000-0000-000000000001');
select throws_ok(format($$ select public.create_task('Task nou #1127', null, now() + interval '7 days', 'local', 'direct', null, null, null, 'task', %s) $$,
  (select archived_id from f1127)),
  'PT409', 'group_archived',
  'BC cannot create a Task in an archived Group');
select throws_ok(format($$ select public.duplicate_task(%s, now() + interval '7 days') $$,
  (select archived_source_id from f1127)),
  'PT409', 'group_archived',
  'BC cannot duplicate a Task whose copy would land in an archived Group');
select throws_ok(format($$ select public.create_campaign(%s, 'Campanie #1127') $$,
  (select archived_id from f1127)),
  'PT409', 'group_archived',
  'BC cannot create a Campaign in an archived Group');
select throws_ok(format($$ select public.create_task('Subtask nou #1127', null, now() + interval '7 days', 'local', 'direct', null, null, %s, 'task', null) $$,
  (select archived_umbrella_id from f1127)),
  'PT409', 'group_archived',
  'nor a Subtask under an Umbrella that sits in one -- the Group it inherits is judged, not the argument');
reset role;

-- ==================== 3. The Moderator: the same three ====================
select pg_temp.test_login_leadership('11270000-0000-0000-0000-000000000002');
select throws_ok(format($$ select public.create_task('Task nou #1127', null, now() + interval '7 days', 'local', 'direct', null, null, null, 'task', %s) $$,
  (select archived_id from f1127)),
  'PT409', 'group_archived',
  'the Moderator cannot create a Task in an archived Group');
select throws_ok(format($$ select public.duplicate_task(%s, now() + interval '7 days') $$,
  (select archived_source_id from f1127)),
  'PT409', 'group_archived',
  'the Moderator cannot duplicate into an archived Group');
select throws_ok(format($$ select public.create_campaign(%s, 'Campanie #1127') $$,
  (select archived_id from f1127)),
  'PT409', 'group_archived',
  'the Moderator cannot create a Campaign in an archived Group');
reset role;
select is((select count(*) from public.tasks where group_id = (select archived_id from f1127)), 2::bigint,
  'the archived Group still holds only its fixture Task and Umbrella -- every refusal wrote nothing');
select is((select count(*) from public.campaigns where group_id = (select archived_id from f1127)), 0::bigint,
  'and no Campaign');

-- ==================== 4. An active Group: all three work as today ====================
select pg_temp.test_login_leadership('11270000-0000-0000-0000-000000000001');
select lives_ok(format($$ select public.create_task('Task nou #1127', null, now() + interval '7 days', 'local', 'direct', null, null, null, 'task', %s) $$,
  (select active_id from f1127)),
  'BC creates a Task in an active Group');
select lives_ok(format($$ select public.duplicate_task(%s, now() + interval '7 days') $$,
  (select active_source_id from f1127)),
  'BC duplicates a Task of an active Group');
select lives_ok(format($$ select public.create_campaign(%s, 'Campanie #1127') $$,
  (select active_id from f1127)),
  'BC creates a Campaign in an active Group');
reset role;
select is((select count(*) from public.tasks where group_id = (select active_id from f1127)), 3::bigint,
  'the active Group holds its fixture Task, the new one and the copy');
select is((select count(*) from public.campaigns where group_id = (select active_id from f1127)), 1::bigint,
  'and the new Campaign');

-- ==================== 5. Authority and input rules come first ====================
-- group_archived is a state rule (conventions section 3, step 6): a caller
-- without authority, or a malformed call, hears their own reason, never that
-- the Group is archived.
select pg_temp.test_login_leadership('11270000-0000-0000-0000-000000000003');
select throws_ok(format($$ select public.create_task('Task nou #1127', null, now() + interval '7 days', 'local', 'direct', null, null, null, 'task', %s) $$,
  (select archived_id from f1127)),
  '42501', 'task_manage_forbidden',
  'a Volunteer with no authority hears task_manage_forbidden on the archived Group, not group_archived');
select throws_ok(format($$ select public.create_campaign(%s, 'Campanie #1127') $$,
  (select archived_id from f1127)),
  '42501', 'campaign_manage_forbidden',
  'and campaign_manage_forbidden from create_campaign');
reset role;
select pg_temp.test_login_leadership('11270000-0000-0000-0000-000000000001');
select throws_ok(format($$ select public.create_task('Ta', null, now() + interval '7 days', 'local', 'direct', null, null, null, 'task', %s) $$,
  (select archived_id from f1127)),
  'PT400', 'title_too_short',
  'a malformed title is refused before the Group''s state (step 1 before step 6)');
select throws_ok(format($$ select public.create_campaign(%s, 'Ca') $$,
  (select archived_id from f1127)),
  'PT400', 'name_too_short',
  'and so is a malformed Campaign name');
select throws_ok(format($$ select public.duplicate_task(%s, now() - interval '1 day') $$,
  (select archived_source_id from f1127)),
  'PT400', 'deadline_in_past',
  'and a past deadline on a duplicate');
reset role;

select * from finish();
rollback;
