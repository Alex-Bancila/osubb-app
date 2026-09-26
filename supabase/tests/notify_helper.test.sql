-- notify_helper.test.sql — #320: notifications.task_id/dedupe_key and the
-- server fan-out helpers private.notify / private.task_managers. Neither
-- helper is called by any command yet (that starts with #327-345); this
-- suite exercises them directly, as the definer/owner connection pgTAP
-- itself runs as. No RLS policy changes here -- notifications.* read/write
-- policies are #65 (dobrerares' #413, not in this branch's base).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(57);

-- ==================== Definition and privileges ====================
select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'notify'),
  1::bigint,
  'private.notify exists'
);
select ok(
  coalesce((select procedure.prosecdef
              from pg_proc as procedure
              join pg_namespace as namespace on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'private'
               and procedure.proname = 'notify'), false),
  'notify runs as its owner (security definer)'
);
select ok(
  coalesce((select 'search_path=""' = any(procedure.proconfig)
              from pg_proc as procedure
              join pg_namespace as namespace on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'private'
               and procedure.proname = 'notify'), false),
  'notify pins an empty search_path'
);
select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'notify'
      and has_function_privilege('anon', procedure.oid, 'execute')),
  0::bigint,
  'anon cannot execute notify'
);
select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'notify'
      and has_function_privilege('authenticated', procedure.oid, 'execute')),
  0::bigint,
  'authenticated cannot execute notify (no grant at all -- only definer commands call it)'
);
select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'notify'
      and has_function_privilege('service_role', procedure.oid, 'execute')),
  0::bigint,
  'service_role cannot execute notify'
);

select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'task_managers'),
  1::bigint,
  'private.task_managers exists'
);
select ok(
  coalesce((select procedure.prosecdef
              from pg_proc as procedure
              join pg_namespace as namespace on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'private'
               and procedure.proname = 'task_managers'), false),
  'task_managers runs as its owner (security definer)'
);
select ok(
  coalesce((select procedure.provolatile = 's'
              from pg_proc as procedure
              join pg_namespace as namespace on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'private'
               and procedure.proname = 'task_managers'), false),
  'task_managers is stable'
);
select ok(
  coalesce((select 'search_path=""' = any(procedure.proconfig)
              from pg_proc as procedure
              join pg_namespace as namespace on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'private'
               and procedure.proname = 'task_managers'), false),
  'task_managers pins an empty search_path'
);
select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'task_managers'
      and has_function_privilege('anon', procedure.oid, 'execute')),
  0::bigint,
  'anon cannot execute task_managers'
);
select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'task_managers'
      and has_function_privilege('authenticated', procedure.oid, 'execute')),
  0::bigint,
  'authenticated cannot execute task_managers (no grant at all -- only definer commands call it)'
);
select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'task_managers'
      and has_function_privilege('service_role', procedure.oid, 'execute')),
  0::bigint,
  'service_role cannot execute task_managers'
);

-- ==================== Fixtures: private.notify ====================
insert into auth.users (id, email) values
  ('32000000-0000-0000-0000-000000000601', 'nh.actor@test.local'),
  ('32000000-0000-0000-0000-000000000602', 'nh.recipient-a@test.local'),
  ('32000000-0000-0000-0000-000000000603', 'nh.recipient-b@test.local'),
  ('32000000-0000-0000-0000-000000000604', 'nh.inactive@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('32000000-0000-0000-0000-000000000601', 'NH Actor',       'nh.actor@test.local',       'voluntar', 'activ'),
  ('32000000-0000-0000-0000-000000000602', 'NH Recipient A', 'nh.recipient-a@test.local', 'voluntar', 'activ'),
  ('32000000-0000-0000-0000-000000000603', 'NH Recipient B', 'nh.recipient-b@test.local', 'voluntar', 'activ'),
  ('32000000-0000-0000-0000-000000000604', 'NH Inactive',    'nh.inactive@test.local',    'voluntar', 'inactiv');

-- ==================== Fixtures: private.task_managers ====================
insert into auth.users (id, email) values
  ('32000000-0000-0000-0000-000000000101', 'tm.creator-active@test.local'),
  ('32000000-0000-0000-0000-000000000102', 'tm.actor-dept@test.local'),
  ('32000000-0000-0000-0000-000000000103', 'tm.edu-bce@test.local'),
  ('32000000-0000-0000-0000-000000000104', 'tm.pr-bce@test.local'),
  ('32000000-0000-0000-0000-000000000201', 'tm.creator-inactive@test.local'),
  ('32000000-0000-0000-0000-000000000202', 'tm.fin-bce@test.local'),
  ('32000000-0000-0000-0000-000000000203', 'tm.actor-deptteam@test.local'),
  ('32000000-0000-0000-0000-000000000301', 'tm.indep-member-1@test.local'),
  ('32000000-0000-0000-0000-000000000302', 'tm.indep-member-2@test.local'),
  ('32000000-0000-0000-0000-000000000401', 'tm.project-lead@test.local'),
  ('32000000-0000-0000-0000-000000000402', 'tm.project-responsible@test.local'),
  ('32000000-0000-0000-0000-000000000403', 'tm.project-member@test.local'),
  ('32000000-0000-0000-0000-000000000404', 'tm.actor-project@test.local'),
  ('32000000-0000-0000-0000-000000000501', 'tm.bc@test.local'),
  ('32000000-0000-0000-0000-000000000502', 'tm.moderator@test.local'),
  ('32000000-0000-0000-0000-000000000503', 'tm.plain-member@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('32000000-0000-0000-0000-000000000101', 'TM Creator Active',      'tm.creator-active@test.local',    'voluntar',  'activ'),
  ('32000000-0000-0000-0000-000000000102', 'TM Actor Dept',          'tm.actor-dept@test.local',        'voluntar',  'activ'),
  ('32000000-0000-0000-0000-000000000103', 'TM Edu BCE',             'tm.edu-bce@test.local',           'bce',       'activ'),
  ('32000000-0000-0000-0000-000000000104', 'TM PR BCE',              'tm.pr-bce@test.local',            'bce',       'activ'),
  ('32000000-0000-0000-0000-000000000201', 'TM Creator Inactive',    'tm.creator-inactive@test.local',  'voluntar',  'inactiv'),
  ('32000000-0000-0000-0000-000000000202', 'TM Fin BCE',             'tm.fin-bce@test.local',           'bce',       'activ'),
  ('32000000-0000-0000-0000-000000000203', 'TM Actor DeptTeam',      'tm.actor-deptteam@test.local',    'voluntar',  'activ'),
  ('32000000-0000-0000-0000-000000000301', 'TM Indep Member 1',      'tm.indep-member-1@test.local',    'voluntar',  'activ'),
  ('32000000-0000-0000-0000-000000000302', 'TM Indep Member 2',      'tm.indep-member-2@test.local',    'voluntar',  'activ'),
  ('32000000-0000-0000-0000-000000000401', 'TM Project Lead',        'tm.project-lead@test.local',      'voluntar',  'activ'),
  ('32000000-0000-0000-0000-000000000402', 'TM Project Responsible', 'tm.project-responsible@test.local','voluntar', 'activ'),
  ('32000000-0000-0000-0000-000000000403', 'TM Project Member',      'tm.project-member@test.local',    'voluntar',  'activ'),
  ('32000000-0000-0000-0000-000000000404', 'TM Actor Project',       'tm.actor-project@test.local',     'voluntar',  'activ'),
  ('32000000-0000-0000-0000-000000000501', 'TM BC',                  'tm.bc@test.local',                'bc',        'activ'),
  ('32000000-0000-0000-0000-000000000502', 'TM Moderator',           'tm.moderator@test.local',         'moderator', 'activ'),
  ('32000000-0000-0000-0000-000000000503', 'TM Plain Member',        'tm.plain-member@test.local',      'voluntar',  'activ');

insert into pg_temp.fixture_member_departments (member_id, dept_id) values
  ('32000000-0000-0000-0000-000000000103', 'edu'),
  ('32000000-0000-0000-0000-000000000104', 'pr'),
  ('32000000-0000-0000-0000-000000000202', 'fin');

insert into pg_temp.fixture_teams (id, name, dept_id) values
  ('tm320-deptteam', 'TM320 Department Team', 'fin'),
  ('tm320-indepteam', 'TM320 Independent Team', null),
  ('tm320-emptyteam', 'TM320 Empty Independent Team', null);

insert into pg_temp.fixture_team_members (team_id, member_id) values
  ('tm320-indepteam', '32000000-0000-0000-0000-000000000301'),
  ('tm320-indepteam', '32000000-0000-0000-0000-000000000302');

insert into pg_temp.fixture_projects (name, status, leader_id, created_by) values
  ('TM320 Helper Project', 'active',
   '32000000-0000-0000-0000-000000000401',
   '32000000-0000-0000-0000-000000000404');

insert into pg_temp.fixture_project_members (project_id, member_id, project_role)
select project.id, '32000000-0000-0000-0000-000000000402', 'responsible'
  from pg_temp.fixture_projects as project
 where project.name = 'TM320 Helper Project';
insert into pg_temp.fixture_project_members (project_id, member_id, project_role)
select project.id, '32000000-0000-0000-0000-000000000403', 'member'
  from pg_temp.fixture_projects as project
 where project.name = 'TM320 Helper Project';
-- #586: materialize this suite's legacy setup as rolled-back Group fixtures.
select pg_temp.materialize_legacy_groups();


insert into public.tasks (title, group_id, created_by) values
  ('TM320 dept task A', pg_temp.dept_group('edu'), '32000000-0000-0000-0000-000000000101');
insert into public.tasks (title, group_id, created_by) values
  ('TM320 deptteam task B', pg_temp.team_group('tm320-deptteam'), '32000000-0000-0000-0000-000000000201');
insert into public.tasks (title, group_id) values
  ('TM320 indepteam task C', pg_temp.team_group('tm320-indepteam'));
insert into public.tasks (title, group_id)
select 'TM320 project task D', pg_temp.project_group(project.id)
  from pg_temp.fixture_projects as project
 where project.name = 'TM320 Helper Project';
insert into public.tasks (title, group_id) values
  ('TM320 emptyteam task E', pg_temp.team_group('tm320-emptyteam'));

-- Department with no BCE member: fallback test fixture
insert into auth.users (id, email) values
  ('32000000-0000-0000-0000-000000000701', 'tm.nodeptbce-creator@test.local');
insert into public.profiles (id, full_name, email, role, status) values
  ('32000000-0000-0000-0000-000000000701', 'TM No Dept BCE Creator', 'tm.nodeptbce-creator@test.local', 'voluntar', 'activ');
insert into pg_temp.fixture_departments (id, name, short, color, kind) values
  ('zz320dept', 'Test No BCE Dept', 'ZZ', '#000000', 'coordination');
select pg_temp.materialize_legacy_groups();
insert into public.tasks (title, group_id, created_by) values
  ('TM320 dept-no-bce task', pg_temp.dept_group('zz320dept'), '32000000-0000-0000-0000-000000000701');

-- Department Team with no BCE parent: fallback test fixture
insert into pg_temp.fixture_teams (id, name, dept_id) values
  ('tm320-deptteam-nobce', 'TM320 DeptTeam with No BCE Parent', 'zz320dept');
select pg_temp.materialize_legacy_groups();
insert into public.tasks (title, group_id, created_by) values
  ('TM320 deptteam-no-bce task', pg_temp.team_group('tm320-deptteam-nobce'), '32000000-0000-0000-0000-000000000701');

create temp table fx as
select
  (select id from public.tasks where title = 'TM320 dept task A') as dept_task_id,
  (select id from public.tasks where title = 'TM320 deptteam task B') as deptteam_task_id,
  (select id from public.tasks where title = 'TM320 indepteam task C') as indepteam_task_id,
  (select id from public.tasks where title = 'TM320 project task D') as project_task_id,
  (select id from public.tasks where title = 'TM320 emptyteam task E') as emptyteam_task_id,
  (select id from public.tasks where title = 'TM320 dept-no-bce task') as dept_nobce_task_id,
  (select id from public.tasks where title = 'TM320 deptteam-no-bce task') as deptteam_nobce_task_id;

-- ==================== notify: skip actor / inactive / unknown, collapse duplicates ====================
select is(
  private.notify(
    array[
      '32000000-0000-0000-0000-000000000601'::uuid, -- actor: must be skipped
      '32000000-0000-0000-0000-000000000604'::uuid, -- inactive: skipped
      '32000000-0000-0000-0000-000000000699'::uuid, -- unknown: skipped
      '32000000-0000-0000-0000-000000000602'::uuid, -- recipient A
      '32000000-0000-0000-0000-000000000602'::uuid  -- duplicate of A
    ],
    'task'::public.noti_kind, 'NH combined title', 'combined body',
    null, null, '32000000-0000-0000-0000-000000000601'::uuid
  ),
  1,
  'notify: returns 1 -- only recipient A is eligible once the actor, the inactive Member, the unknown id, and the in-array duplicate are all dropped'
);
select is(
  (select count(*) from public.notifications
    where member_id = '32000000-0000-0000-0000-000000000601'
      and title = 'NH combined title'),
  0::bigint,
  'notify: the actor never receives a row for their own action'
);
select is(
  (select count(*) from public.notifications
    where member_id = '32000000-0000-0000-0000-000000000604'
      and title = 'NH combined title'),
  0::bigint,
  'notify: an inactive recipient is skipped'
);
select is(
  (select count(*) from public.notifications
    where member_id = '32000000-0000-0000-0000-000000000602'
      and title = 'NH combined title'),
  1::bigint,
  'notify: recipient A receives exactly one row despite appearing twice in the array'
);

-- ==================== notify: multiple recipients, no task ====================
select is(
  private.notify(
    array['32000000-0000-0000-0000-000000000602'::uuid, '32000000-0000-0000-0000-000000000603'::uuid],
    'task'::public.noti_kind, 'NH pair title', 'pair body', null, null, null
  ),
  2,
  'notify: two distinct valid recipients returns 2'
);
select is(
  (select link from public.notifications where title = 'NH pair title' limit 1),
  null,
  'notify: link is null when no task_id is given'
);

-- ==================== notify: link derived from task_id ====================
select is(
  private.notify(
    array['32000000-0000-0000-0000-000000000602'::uuid],
    'task'::public.noti_kind, 'NH link title', 'link body',
    (select dept_task_id from fx), null, null
  ),
  1,
  'notify: the link-check call returns 1'
);
select is(
  (select link from public.notifications where title = 'NH link title'),
  '/tracker/' || (select dept_task_id from fx)::text,
  'notify: link is derived from p_task_id (''/tracker/<id>'')'
);

-- ==================== notify: dedupe key upserts while unread ====================
select is(
  private.notify(
    array['32000000-0000-0000-0000-000000000602'::uuid],
    'task'::public.noti_kind, 'Candidați noi', '2 candidați noi',
    null, 'nh:queue:dedupe-a', null
  ),
  1,
  'notify: the first dedupe-key call inserts one row'
);
select is(
  private.notify(
    array['32000000-0000-0000-0000-000000000602'::uuid],
    'task'::public.noti_kind, 'Candidați noi', '3 candidați noi',
    null, 'nh:queue:dedupe-a', null
  ),
  1,
  'notify: the second dedupe-key call while unread upserts (still returns 1)'
);
select is(
  (select count(*) from public.notifications
    where member_id = '32000000-0000-0000-0000-000000000602'
      and dedupe_key = 'nh:queue:dedupe-a'),
  1::bigint,
  'notify: two calls with the same (member, dedupe_key) while unread produce exactly one row'
);
select is(
  (select body from public.notifications
    where member_id = '32000000-0000-0000-0000-000000000602'
      and dedupe_key = 'nh:queue:dedupe-a'),
  '3 candidați noi',
  'notify: the upserted row carries the second call''s body'
);

-- ==================== notify: same key after read starts a new row ====================
update public.notifications
   set read = true
 where member_id = '32000000-0000-0000-0000-000000000602'
   and dedupe_key = 'nh:queue:dedupe-a';

select is(
  private.notify(
    array['32000000-0000-0000-0000-000000000602'::uuid],
    'task'::public.noti_kind, 'Candidați noi', '1 candidat nou',
    null, 'nh:queue:dedupe-a', null
  ),
  1,
  'notify: a third call after the earlier row is read still returns 1'
);
select is(
  (select count(*) from public.notifications
    where member_id = '32000000-0000-0000-0000-000000000602'
      and dedupe_key = 'nh:queue:dedupe-a'),
  2::bigint,
  'notify: once the earlier row is read, the same key produces a second, separate row'
);

-- ==================== notify: null dedupe_key never collapses ====================
select is(
  private.notify(
    array['32000000-0000-0000-0000-000000000603'::uuid],
    'task'::public.noti_kind, 'NH null key', 'first', null, null, null
  ),
  1,
  'notify: the first null-dedupe-key call inserts one row'
);
select is(
  private.notify(
    array['32000000-0000-0000-0000-000000000603'::uuid],
    'task'::public.noti_kind, 'NH null key', 'second', null, null, null
  ),
  1,
  'notify: the second null-dedupe-key call inserts a separate row too'
);
select is(
  (select count(*) from public.notifications
    where member_id = '32000000-0000-0000-0000-000000000603'
      and title = 'NH null key'),
  2::bigint,
  'notify: two calls with a null dedupe_key never collapse -- both rows persist'
);

-- ==================== notify: blank title ====================
select throws_ok(
  $$ select private.notify(array['32000000-0000-0000-0000-000000000602'::uuid],
       'task'::public.noti_kind, null, 'x', null, null, null) $$,
  'PT400', 'invalid_notification_title',
  'notify: a null title raises PT400 invalid_notification_title'
);
select throws_ok(
  $$ select private.notify(array['32000000-0000-0000-0000-000000000602'::uuid],
       'task'::public.noti_kind, '', 'x', null, null, null) $$,
  'PT400', 'invalid_notification_title',
  'notify: an empty title raises PT400 invalid_notification_title'
);
select throws_ok(
  $$ select private.notify(array['32000000-0000-0000-0000-000000000602'::uuid],
       'task'::public.noti_kind, '   ', 'x', null, null, null) $$,
  'PT400', 'invalid_notification_title',
  'notify: a whitespace-only title raises PT400 invalid_notification_title'
);

-- ==================== task_managers: Department fallback (no BCE) ====================
select ok(
  '32000000-0000-0000-0000-000000000501'::uuid in (
    select member_id from private.task_managers((select dept_nobce_task_id from fx), '32000000-0000-0000-0000-000000000701'::uuid) as member_id
  ),
  'task_managers: a Department with no live BCE member falls back to BC/Moderator -- BC fixture included'
);
select ok(
  '32000000-0000-0000-0000-000000000502'::uuid in (
    select member_id from private.task_managers((select dept_nobce_task_id from fx), '32000000-0000-0000-0000-000000000701'::uuid) as member_id
  ),
  'task_managers: a Department with no live BCE member falls back to BC/Moderator -- Moderator fixture included'
);

-- ==================== task_managers: Department-Team fallback (no BCE parent) ====================
select ok(
  '32000000-0000-0000-0000-000000000501'::uuid in (
    select member_id from private.task_managers((select deptteam_nobce_task_id from fx), '32000000-0000-0000-0000-000000000701'::uuid) as member_id
  ),
  'task_managers: a Department-Team whose parent has no live BCE member falls back to BC/Moderator -- BC fixture included'
);
select ok(
  '32000000-0000-0000-0000-000000000502'::uuid in (
    select member_id from private.task_managers((select deptteam_nobce_task_id from fx), '32000000-0000-0000-0000-000000000701'::uuid) as member_id
  ),
  'task_managers: a Department-Team whose parent has no live BCE member falls back to BC/Moderator -- Moderator fixture included'
);

-- ==================== task_managers: creator active and not the actor ====================
select is(
  (select array_agg(member_id order by member_id)
     from private.task_managers((select dept_task_id from fx), '32000000-0000-0000-0000-000000000102'::uuid) as member_id),
  array['32000000-0000-0000-0000-000000000101'::uuid],
  'task_managers: an active creator who is not the actor is the sole recipient'
);

-- ==================== task_managers: creator = actor -> Origin managers (Department) ====================
select is(
  (select array_agg(member_id order by member_id)
     from private.task_managers((select dept_task_id from fx), '32000000-0000-0000-0000-000000000101'::uuid) as member_id),
  array['32000000-0000-0000-0000-000000000103'::uuid],
  'task_managers: when the creator is the actor, falls through to the Department''s local BCE, excluding a foreign-department BCE'
);

-- ==================== task_managers: creator inactive -> Origin managers (Department-Team) ====================
select is(
  (select array_agg(member_id order by member_id)
     from private.task_managers((select deptteam_task_id from fx), '32000000-0000-0000-0000-000000000203'::uuid) as member_id),
  array['32000000-0000-0000-0000-000000000202'::uuid],
  'task_managers: an inactive creator on a Department-Team origin falls through to the parent Department''s local BCE'
);

-- ==================== task_managers: Independent Team origin, actor excluded either way ====================
select is(
  (select array_agg(member_id order by member_id)
     from private.task_managers((select indepteam_task_id from fx), '32000000-0000-0000-0000-000000000301'::uuid) as member_id),
  array(select p.id from public.profiles p join public.roles r on r.id=p.role where p.status='activ' and (r.level>=6 or p.id='32000000-0000-0000-0000-000000000302'::uuid) order by p.id),
  'task_managers: Independent-Team origin -- peers and live BC/Moderator, excluding the actor'
);
select is(
  (select array_agg(member_id order by member_id)
     from private.task_managers((select indepteam_task_id from fx), '32000000-0000-0000-0000-000000000302'::uuid) as member_id),
  array(select p.id from public.profiles p join public.roles r on r.id=p.role where p.status='activ' and (r.level>=6 or p.id='32000000-0000-0000-0000-000000000301'::uuid) order by p.id),
  'task_managers: Independent-Team origin -- peers and BC/Moderator still exclude the acting peer'
);

-- ==================== task_managers: Project origin, Responsible included, plain member excluded ====================
select is(
  (select array_agg(member_id order by member_id)
     from private.task_managers((select project_task_id from fx), '32000000-0000-0000-0000-000000000404'::uuid) as member_id),
  array['32000000-0000-0000-0000-000000000401'::uuid],
  'task_managers: Project origin -- the nearest Managers receive fallback; Responsibles do not when a Manager exists'
);

-- ==================== task_managers: empty Origin falls back to BC/Moderator ====================
select ok(
  '32000000-0000-0000-0000-000000000502'::uuid in (
    select member_id from private.task_managers((select emptyteam_task_id from fx), '32000000-0000-0000-0000-000000000501'::uuid) as member_id
  ),
  'task_managers: an Independent Team with no members falls back to BC/Moderator -- the Moderator fixture is included'
);
select ok(
  '32000000-0000-0000-0000-000000000501'::uuid not in (
    select member_id from private.task_managers((select emptyteam_task_id from fx), '32000000-0000-0000-0000-000000000501'::uuid) as member_id
  ),
  'task_managers: the fallback still excludes the actor, even a BC who would otherwise qualify'
);
select ok(
  '32000000-0000-0000-0000-000000000501'::uuid in (
    select member_id from private.task_managers((select emptyteam_task_id from fx), '32000000-0000-0000-0000-000000000502'::uuid) as member_id
  ),
  'task_managers: the BC fixture is included in the fallback when the Moderator is the actor instead'
);
select ok(
  '32000000-0000-0000-0000-000000000503'::uuid not in (
    select member_id from private.task_managers((select emptyteam_task_id from fx), null::uuid) as member_id
  ),
  'task_managers: a plain active Member (neither BC nor Moderator) is never part of the fallback'
);

-- ==================== task_managers: unknown task ====================
select is(
  (select count(*) from private.task_managers(999999999::bigint, null::uuid)),
  0::bigint,
  'task_managers: an unknown Task returns an empty set'
);

-- ==================== anon cannot execute either helper ====================
set local role anon;
select throws_ok(
  $$ select private.notify(array[]::uuid[], 'task'::public.noti_kind, 'x', null, null, null, null) $$,
  '42501', null,
  'anon cannot execute private.notify'
);
select throws_ok(
  $$ select private.task_managers(1::bigint, null::uuid) $$,
  '42501', null,
  'anon cannot execute private.task_managers'
);
reset role;

-- ==================== authenticated / service_role cannot execute either helper ====================
set local role authenticated;
select throws_ok(
  $$ select private.notify(array[]::uuid[], 'task'::public.noti_kind, 'x', null, null, null, null) $$,
  '42501', null,
  'authenticated cannot execute private.notify'
);
select throws_ok(
  $$ select private.task_managers(1::bigint, null::uuid) $$,
  '42501', null,
  'authenticated cannot execute private.task_managers'
);
reset role;

set local role service_role;
select throws_ok(
  $$ select private.notify(array[]::uuid[], 'task'::public.noti_kind, 'x', null, null, null, null) $$,
  '42501', null,
  'service_role cannot execute private.notify'
);
select throws_ok(
  $$ select private.task_managers(1::bigint, null::uuid) $$,
  '42501', null,
  'service_role cannot execute private.task_managers'
);
reset role;


-- #521: Group authority regression matrix.
\ir _group_task_fixtures.psql
select pg_temp.g521_task('project','project',5);
select pg_temp.g521_task('ind','ind',7);
select results_eq($$select private.task_managers((select id from g521_tasks where name='project'),pg_temp.g521_uid(5)) order by 1$$,$$select pg_temp.g521_uid(1)$$,'live creator remains the first recipient');
select results_eq($$select private.task_managers((select id from g521_tasks where name='project'),pg_temp.g521_uid(1)) order by 1$$,$$select pg_temp.g521_uid(2)$$,'creator acting falls back to Group Manager, excluding Responsibles');
select results_eq($$select private.task_managers((select id from g521_tasks where name='ind'),pg_temp.g521_uid(1)) order by 1$$,$$select p.id from public.profiles p join public.roles r on r.id=p.role where p.status='activ' and p.id<>pg_temp.g521_uid(1) and (r.level>=6 or p.id in (pg_temp.g521_uid(6),pg_temp.g521_uid(7))) order by 1$$,'Manager-less chain notifies peers and BC without echo');

select * from finish();
rollback;
