-- rls_tasks_read_matrix.test.sql — #318: who reads which Task under the
-- ADR-0007 visibility rules. One set-equality assertion per persona over a
-- fixed fixture world, so a wrong row in either direction (a leak or a
-- missing Task) fails with the exact titles. Every expected set is derived,
-- in the comment above it, from the rule list in
-- 20260911211100_tasks_read_policy.sql:
--   R1 global readers: live role level >= 5 (BCE, BC, Moderator)
--   R2 own work: any Assignment (current or ended) or Candidature (any status)
--   R3 Origin managers (private.can_manage_task) — admitted by R1/R4/R5;
--      the sweep at the end proves "manage implies read" everywhere
--   R4 Team members: every Task of their Team
--   R5 Project lead / Responsibles: every Task of the Project, archived too
--   R6 eligible Opportunities: ordinary, public, queue open, unfinished;
--      Audience org -> every active Member, local -> members of the Origin
--   R7 a Subtask whenever its Umbrella is readable by the same caller
-- and nothing else: plain Department and Project members read only R2 + R6.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(63);

-- ==================== Shape of the read surface ====================
select policies_are('public', 'tasks',
  array['tasks_read', 'tasks_create_legacy', 'tasks_update_legacy', 'tasks_delete_legacy'],
  'tasks carries the #318 read policy and the split legacy write policies; task_read and task_write are gone');

-- A FOR ALL policy also answers SELECT. The legacy task_write was FOR ALL
-- on auth_level() >= 4, so it handed every Task to any JWT at level 4+ no
-- matter what the read policy said.
select is(
  array(select policy.policyname::text
          from pg_policies as policy
         where policy.schemaname = 'public'
           and policy.tablename = 'tasks'
           and policy.cmd in ('SELECT', 'ALL')
         order by 1),
  array['tasks_read'],
  'tasks_read is the only policy that can admit a Task row to a SELECT');

select is(
  (select format('%s %s %s', policy.cmd, policy.permissive, policy.roles)
     from pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'tasks'
      and policy.policyname = 'tasks_read'),
  'SELECT PERMISSIVE {authenticated}',
  'tasks_read is a permissive SELECT policy for authenticated only');

select is(
  array(select format('%s %s using=%s check=%s', policy.policyname, policy.cmd,
                      coalesce(policy.qual, '-'), coalesce(policy.with_check, '-'))
          from pg_policies as policy
         where policy.schemaname = 'public'
           and policy.tablename = 'tasks'
           and policy.policyname like '%\_legacy'
         order by policy.policyname),
  array[
    'tasks_create_legacy INSERT using=- check=(auth_level() >= 4)',
    'tasks_delete_legacy DELETE using=(auth_level() >= 4) check=-',
    'tasks_update_legacy UPDATE using=(auth_level() >= 4) check=(auth_level() >= 4)'],
  'the legacy direct write path keeps its exact level >= 4 predicate until #345 retires it');

select hasnt_function('public', 'is_assigned', array['bigint'],
  'public.is_assigned (the legacy task_assignees predicate) is gone with its last consumer');

select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in ('is_task_executor', 'is_task_candidate',
                                'can_manage_task', 'can_read_task')
      and procedure.pronargs = 1
      and procedure.proargtypes[0] = 'bigint'::regtype
      and procedure.prorettype = 'boolean'::regtype
      and procedure.prosecdef
      and procedure.provolatile = 's'
      and 'search_path=""' = any(procedure.proconfig)),
  4::bigint,
  'the four Task predicates are stable security definer boolean functions of a Task id with an empty search_path');

select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in ('is_task_executor', 'is_task_candidate',
                                'can_manage_task', 'can_read_task')
      and has_function_privilege('authenticated', procedure.oid, 'execute')),
  4::bigint,
  'authenticated may execute all four (policy predicate helpers)');

select is(
  (select count(*)
     from pg_proc as procedure
     join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in ('is_task_executor', 'is_task_candidate',
                                'can_manage_task', 'can_read_task')
      and (has_function_privilege('anon', procedure.oid, 'execute')
        or has_function_privilege('service_role', procedure.oid, 'execute')
        or has_function_privilege('public', procedure.oid, 'execute'))),
  0::bigint,
  'anon, service_role and PUBLIC may execute none of them');

-- ==================== Fixtures ====================
-- Persona prefix 31800000-… (#318). Departments: `edu` is the Department
-- Origin, `pr` holds the participation Tasks nobody but their participants
-- (and R1) can see, `fin` is where the out-of-Origin personas belong.
create temp table fx_persona (
  code    text primary key,
  id      uuid not null unique,
  role    public.member_role not null,
  status  public.member_status not null,
  dept_id text
);
insert into fx_persona (code, id, role, status, dept_id) values
  ('recrut_in',           '31800000-0000-0000-0000-000000000001', 'recrut',      'activ',   'edu'),
  ('voluntar_in',         '31800000-0000-0000-0000-000000000002', 'voluntar',    'activ',   'edu'),
  ('activ_in',            '31800000-0000-0000-0000-000000000003', 'activ',       'activ',   'edu'),
  ('vot_in',              '31800000-0000-0000-0000-000000000004', 'vot',         'activ',   'edu'),
  ('recrut_out',          '31800000-0000-0000-0000-000000000005', 'recrut',      'activ',   'fin'),
  ('voluntar_out',        '31800000-0000-0000-0000-000000000006', 'voluntar',    'activ',   'fin'),
  ('activ_out',           '31800000-0000-0000-0000-000000000007', 'activ',       'activ',   'fin'),
  ('vot_out',             '31800000-0000-0000-0000-000000000008', 'vot',         'activ',   'fin'),
  ('responsabil',         '31800000-0000-0000-0000-000000000009', 'responsabil', 'activ',   'edu'),
  ('bce_local',           '31800000-0000-0000-0000-000000000010', 'bce',         'activ',   'edu'),
  ('bce_foreign',         '31800000-0000-0000-0000-000000000011', 'bce',         'activ',   'fin'),
  ('bc',                  '31800000-0000-0000-0000-000000000012', 'bc',          'activ',   null),
  ('moderator',           '31800000-0000-0000-0000-000000000013', 'moderator',   'activ',   null),
  ('project_lead',        '31800000-0000-0000-0000-000000000014', 'voluntar',    'activ',   null),
  ('project_responsible', '31800000-0000-0000-0000-000000000015', 'voluntar',    'activ',   null),
  ('project_member',      '31800000-0000-0000-0000-000000000016', 'voluntar',    'activ',   null),
  ('dept_team_member',    '31800000-0000-0000-0000-000000000017', 'voluntar',    'activ',   null),
  ('indep_team_member',   '31800000-0000-0000-0000-000000000018', 'voluntar',    'activ',   null),
  ('executor',            '31800000-0000-0000-0000-000000000019', 'voluntar',    'activ',   null),
  ('past_executor',       '31800000-0000-0000-0000-000000000020', 'voluntar',    'activ',   null),
  ('candidate',           '31800000-0000-0000-0000-000000000021', 'voluntar',    'activ',   null),
  ('umbrella_candidate',  '31800000-0000-0000-0000-000000000022', 'voluntar',    'activ',   null),
  ('deactivated',         '31800000-0000-0000-0000-000000000023', 'bce',         'inactiv', 'edu'),
  ('claimless',           '31800000-0000-0000-0000-000000000024', 'voluntar',    'activ',   'edu'),
  ('filler',              '31800000-0000-0000-0000-000000000025', 'voluntar',    'activ',   null);

insert into auth.users (id, email)
select persona.id, 'm318.' || persona.code || '@test.local' from fx_persona as persona;
insert into public.profiles (id, full_name, email, role, status)
select persona.id, 'M318 ' || persona.code, 'm318.' || persona.code || '@test.local',
       persona.role, persona.status
  from fx_persona as persona;
insert into public.member_departments (member_id, dept_id)
select persona.id, persona.dept_id from fx_persona as persona where persona.dept_id is not null;

insert into public.teams (id, name, dept_id) values
  ('m318-dt', 'M318 Department Team', 'edu'),
  ('m318-it', 'M318 Independent Team', null);
insert into public.team_members (team_id, member_id)
select membership.team_id, persona.id
  from (values ('m318-dt', 'dept_team_member'), ('m318-it', 'indep_team_member'))
         as membership (team_id, code)
  join fx_persona as persona on persona.code = membership.code;

-- Same lead, Responsible and plain member in an active and an archived
-- Project. The leader's own membership comes from projects_sync_leader_membership.
insert into public.projects (name, status, leader_id, created_by)
select project.name, project.status, lead.id, bc.id
  from (values ('M318 Project', 'active'), ('M318 Archived Project', 'archived'))
         as project (name, status)
 cross join (select id from fx_persona where code = 'project_lead') as lead
 cross join (select id from fx_persona where code = 'bc') as bc;
insert into public.project_members (project_id, member_id, project_role)
select project.id, persona.id, membership.project_role
  from public.projects as project
 cross join (values ('project_responsible', 'responsible'), ('project_member', 'member'))
         as membership (code, project_role)
  join fx_persona as persona on persona.code = membership.code
 where project.name in ('M318 Project', 'M318 Archived Project');

-- The 24-row core: every Origin kind x Audience x (direct | public with an
-- open queue | public with a closed queue). Titles carry an `m318:` prefix
-- so the demo seed's own Tasks never enter a persona's set.
insert into public.tasks
  (title, dept_id, team_id, project_id, audience, assignment_mode,
   queue_opened_at, queue_closed_at)
select 'm318:' || origin.code || '-' || shape.code,
       origin.dept_id, origin.team_id, origin.project_id,
       shape.audience, shape.assignment_mode,
       case when shape.assignment_mode = 'public' then now() end,
       case when shape.queue_closed then now() end
  from (values
          ('D',  'edu',      null::text, null::bigint),
          ('DT', null,       'm318-dt',  null),
          ('IT', null,       'm318-it',  null),
          ('P',  null,       null,       (select id from public.projects where name = 'M318 Project'))
       ) as origin (code, dept_id, team_id, project_id)
 cross join (values
          ('loc-dir',    'local', 'direct', false),
          ('org-dir',    'org',   'direct', false),
          ('loc-open',   'local', 'public', false),
          ('loc-closed', 'local', 'public', true),
          ('org-open',   'org',   'public', false),
          ('org-closed', 'org',   'public', true)
       ) as shape (code, audience, assignment_mode, queue_closed);

-- An Umbrella of the Department Team with a direct Subtask (the executor
-- persona's) and an org-wide public Subtask. An Umbrella carries no
-- Audience or Assignment Mode (tasks_umbrella_shape_ck).
insert into public.tasks (title, kind, team_id, audience, assignment_mode)
values ('m318:DT-umb', 'umbrella', 'm318-dt', null, null);
insert into public.tasks
  (title, parent_task_id, team_id, audience, assignment_mode, status, started_at)
select 'm318:DT-umb-sub', umbrella.id, 'm318-dt', 'local', 'direct', 'in_progress', now()
  from public.tasks as umbrella where umbrella.title = 'm318:DT-umb';
insert into public.tasks
  (title, parent_task_id, team_id, audience, assignment_mode, queue_opened_at)
select 'm318:DT-umb-sub-open', umbrella.id, 'm318-dt', 'org', 'public', now()
  from public.tasks as umbrella where umbrella.title = 'm318:DT-umb';

-- A `pr` Umbrella whose only reader outside R1 holds a Candidature on the
-- Umbrella itself. No command creates that state (an Umbrella has no
-- queue); it is built here only to observe R7 in isolation, because every
-- other branch that admits an Umbrella also admits its Subtasks through
-- their shared, immutable Origin (#315).
insert into public.tasks (title, kind, dept_id, audience, assignment_mode)
values ('m318:X-umb', 'umbrella', 'pr', null, null);
insert into public.tasks (title, parent_task_id, dept_id)
select 'm318:X-umb-sub', umbrella.id, 'pr'
  from public.tasks as umbrella where umbrella.title = 'm318:X-umb';

-- History of the archived Project.
-- #339: tasks_cancel_reason_ck makes cancel_reason mandatory on -- and
-- exclusive to -- a cancelled Task, so this fixture states why it was called
-- off. Nothing else about the fixture changes.
insert into public.tasks (title, project_id, status, cancelled_at, cancel_reason)
select 'm318:PA-dir', project.id, 'cancelled', now(), 'Proiect arhivat #318'
  from public.projects as project where project.name = 'M318 Archived Project';

-- Participation Tasks in `pr`, where no persona except R1 is a member.
-- X-busy is an org-wide Opportunity that already has an Executor and is in
-- progress: its queue is still open, so it is still an Opportunity.
-- X-review (round 1) pins the same point one status further along: an
-- Opportunity that has moved to in_review, with a submission recorded,
-- while its queue is still open, is still an Opportunity too -- a mutant
-- narrowing R6 to `todo`/`in_progress` must fail wherever org_open() feeds
-- an expected set.
insert into public.tasks
  (title, dept_id, audience, assignment_mode, queue_opened_at, queue_closed_at,
   status, started_at, submitted_at)
values
  ('m318:X-busy',           'pr', 'org',   'public', now(), null,  'in_progress', now(), null),
  ('m318:X-review',         'pr', 'org',   'public', now(), null,  'in_review',   now(), now()),
  ('m318:X-exec',           'pr', 'local', 'direct', null,  null,  'in_progress', now(), null),
  ('m318:X-past',           'pr', 'local', 'direct', null,  null,  'todo',        null,  null),
  ('m318:X-cand-closed',    'pr', 'local', 'public', now(), now(), 'todo',        null,  null),
  ('m318:X-cand-withdrawn', 'pr', 'local', 'public', now(), null,  'todo',        null,  null);

create temp table fx_task as
select task.id, substr(task.title, 6) as title
  from public.tasks as task
 where task.title like 'm318:%';
grant select on fx_task to authenticated;

insert into public.task_assignments
  (task_id, member_id, assigned_at, ended_at, end_reason, end_note)
select task.id, persona.id, assignment.assigned_at, assignment.ended_at,
       assignment.end_reason, assignment.end_note
  from (values
          ('X-exec',     'executor',      now(),                    null::timestamptz,        null::text, null::text),
          ('DT-umb-sub', 'executor',      now(),                    null,                     null,       null),
          ('X-busy',     'filler',        now(),                    null,                     null,       null),
          ('X-past',     'past_executor', now() - interval '2 days', now() - interval '1 day',  'gave_up',  'fixture give-up'),
          ('X-past',     'deactivated',   now() - interval '4 days', now() - interval '3 days', 'gave_up',  'fixture give-up')
       ) as assignment (task, code, assigned_at, ended_at, end_reason, end_note)
  join fx_task as task on task.title = assignment.task
  join fx_persona as persona on persona.code = assignment.code;

insert into public.task_candidates (task_id, member_id, status, decided_at, decided_by)
select task.id, persona.id, candidature.status,
       case when candidature.status <> 'pending' then now() end,
       case when candidature.status = 'withdrawn' then persona.id end
  from (values
          ('X-cand-closed',    'candidate',          'closed'),
          ('X-cand-withdrawn', 'candidate',          'withdrawn'),
          ('X-cand-withdrawn', 'claimless',          'pending'),
          ('X-umb',            'umbrella_candidate', 'pending')
       ) as candidature (task, code, status)
  join fx_task as task on task.title = candidature.task
  join fx_persona as persona on persona.code = candidature.code;

-- ==================== Probes ====================
-- Runs as the calling role, so RLS decides what it returns.
create function pg_temp.visible_titles()
returns setof text
language sql
stable
as $$
  select substr(task.title, 6) from public.tasks as task where task.title like 'm318:%'
$$;

-- The Opportunities every active Member reads (R6, Audience org, queue open,
-- unfinished): one per Origin kind, the org-wide Subtask, X-busy
-- (in_progress) and X-review (in_review, round 1).
create function pg_temp.org_open()
returns text[]
language sql
immutable
as $$
  select array['D-org-open', 'DT-org-open', 'IT-org-open', 'P-org-open',
               'DT-umb-sub-open', 'X-busy', 'X-review']
$$;

create function pg_temp.every_task()
returns text[]
language sql
stable
as $$
  select array_agg(task.title order by task.title) from pg_temp.fx_task as task
$$;

create function pg_temp.task_id(p_title text)
returns bigint
language sql
stable
as $$
  select task.id from pg_temp.fx_task as task where task.title = p_title
$$;

create function pg_temp.login_as(p_code text)
returns void
language plpgsql
as $$
begin
  perform pg_temp.test_login_leadership(
    (select persona.id from pg_temp.fx_persona as persona where persona.code = p_code));
end;
$$;

-- ==================== The matrix ====================
-- Levels 0-3 inside the Department Origin (`edu` members, no Team or
-- Project): R6 only — the org-wide Opportunities plus the one local
-- Opportunity of their own Department (D-loc-open). Not D-loc-closed (a
-- closed queue hides the Opportunity from nonparticipants), not the direct
-- D Tasks (not theirs), not DT-loc-open (the Department Team is its own
-- Origin — decision (a)). Role level changes nothing (ADR-0007: "regardless
-- of role level").
reset role;
select pg_temp.login_as('recrut_in');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['D-loc-open'],
  'Recrut in the Department: org-wide Opportunities + the Department''s own local Opportunity');

reset role;
select pg_temp.login_as('voluntar_in');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['D-loc-open'],
  'Voluntar in the Department: org-wide Opportunities + the Department''s own local Opportunity');

reset role;
select pg_temp.login_as('activ_in');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['D-loc-open'],
  'Membru Activ in the Department: org-wide Opportunities + the Department''s own local Opportunity');

reset role;
select pg_temp.login_as('vot_in');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['D-loc-open'],
  'Vot in the Department: org-wide Opportunities + the Department''s own local Opportunity');

-- Levels 0-3 outside every fixture Origin (`fin` members; also the
-- non-member of the Project and of both Teams): R6 with Audience org only.
reset role;
select pg_temp.login_as('recrut_out');
select set_eq('select * from pg_temp.visible_titles()', pg_temp.org_open(),
  'Recrut outside the Origin: org-wide Opportunities only');
-- Round 1: pin the in_review Opportunity explicitly (X-busy already pins
-- in_progress the same way); a mutant narrowing R6 to todo/in_progress
-- must fail here even if it left org_open() itself unedited.
select ok(
  exists (select 1 from pg_temp.visible_titles() as title where title = 'X-review'),
  'an in_review public Opportunity with an open queue is still visible to an eligible outsider');

reset role;
select pg_temp.login_as('voluntar_out');
select set_eq('select * from pg_temp.visible_titles()', pg_temp.org_open(),
  'Voluntar outside the Origin (also a Project and Team non-member): org-wide Opportunities only');
-- Issue #318 AC, named: nine closed-queue public Tasks exist across the
-- four Origin kinds and `pr`; a nonparticipant outside their Origins reads
-- none of them, org-wide Audience included.
select is(
  (select count(*) from public.tasks where title like 'm318:%-closed'),
  0::bigint,
  'AC: a closed-queue public Task is invisible to non-participants outside its Origin');

reset role;
select pg_temp.login_as('activ_out');
select set_eq('select * from pg_temp.visible_titles()', pg_temp.org_open(),
  'Membru Activ outside the Origin: org-wide Opportunities only');

-- A Vot demoted from BC whose unexpired token still says BC level 6 and
-- lists `edu`, `pr` and both Teams: authority and memberships are read live,
-- never from the JWT, so this is still a plain Vot in `fin`.
reset role;
select pg_temp.test_login(
  (select id from pg_temp.fx_persona where code = 'vot_out'),
  jsonb_build_object('member_role', 'bc', 'member_level', 6,
                     'dept_ids', '["edu", "pr"]'::jsonb,
                     'team_ids', '["m318-dt", "m318-it"]'::jsonb));
select set_eq('select * from pg_temp.visible_titles()', pg_temp.org_open(),
  'Vot outside the Origin with stale BC claims and forged memberships: org-wide Opportunities only');

-- The organisation role Responsabil (level 4, JWT level 4) is not a
-- Project role and not a global reader (decision (c)): same set as levels
-- 0-3 in `edu`. Under the legacy task_write FOR ALL policy this JWT read
-- every Task.
reset role;
select pg_temp.login_as('responsabil');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['D-loc-open'],
  'Responsabil (level 4) in the Department: reads like levels 0-3');

-- R1: BCE reads all Tasks globally, local or not; BC and Moderator have
-- global override (ADR-0007 §Authorization).
reset role;
select pg_temp.login_as('bce_local');
select set_eq('select * from pg_temp.visible_titles()', pg_temp.every_task(),
  'local BCE reads every Task');

reset role;
select pg_temp.login_as('bce_foreign');
select set_eq('select * from pg_temp.visible_titles()', pg_temp.every_task(),
  'foreign BCE reads every Task too (BCE reads all Tasks globally)');

reset role;
select pg_temp.login_as('bc');
select set_eq('select * from pg_temp.visible_titles()', pg_temp.every_task(),
  'BC reads every Task');

reset role;
select pg_temp.login_as('moderator');
select set_eq('select * from pg_temp.visible_titles()', pg_temp.every_task(),
  'Moderator reads every Task');

-- R5 over both Projects: all six P Tasks (the closed queues included) and
-- the archived Project's history PA-dir; plus R6 org-wide elsewhere.
reset role;
select pg_temp.login_as('project_lead');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['P-loc-dir', 'P-org-dir', 'P-loc-open', 'P-loc-closed',
                              'P-org-open', 'P-org-closed', 'PA-dir'],
  'Project lead reads every Task of the Project, archived Project history included');

reset role;
select pg_temp.login_as('project_responsible');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['P-loc-dir', 'P-org-dir', 'P-loc-open', 'P-loc-closed',
                              'P-org-open', 'P-org-closed', 'PA-dir'],
  'Project Responsible reads every Task of the Project, archived Project history included');

-- A plain Project member: own work (none) and eligible Opportunities —
-- the Project's local open queue (P-loc-open) plus org-wide. Not the
-- Project's direct Tasks, not its closed queues, not PA-dir.
reset role;
select pg_temp.login_as('project_member');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['P-loc-open'],
  'plain Project member: the Project''s local Opportunity + org-wide Opportunities only');
select set_eq(
  $$ select substr(title, 6) from public.tasks_with_overdue where title like 'm318:%' $$,
  pg_temp.org_open() || array['P-loc-open'],
  'tasks_with_overdue is security_invoker: a plain Project member reads the same set through it');

-- R4 over the Department Team: all six DT Tasks, the Umbrella and both
-- Subtasks. Not D-loc-open: a Department Team member is not thereby a
-- member of the parent Department (decision (a)).
reset role;
select pg_temp.login_as('dept_team_member');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['DT-loc-dir', 'DT-org-dir', 'DT-loc-open', 'DT-loc-closed',
                              'DT-org-open', 'DT-org-closed',
                              'DT-umb', 'DT-umb-sub', 'DT-umb-sub-open'],
  'Department-Team member reads every Task of the Team, closed queues and the Umbrella included');

reset role;
select pg_temp.login_as('indep_team_member');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['IT-loc-dir', 'IT-org-dir', 'IT-loc-open', 'IT-loc-closed',
                              'IT-org-open', 'IT-org-closed'],
  'Independent-Team member reads every Task of the Team');

-- R2: the current Executor of X-exec and of the Subtask DT-umb-sub. Not
-- the Umbrella DT-umb itself (decision (b)).
reset role;
select pg_temp.login_as('executor');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['X-exec', 'DT-umb-sub'],
  'current Executor reads their Tasks (a Subtask included, not its Umbrella) + org-wide Opportunities');
select set_eq(
  $$ select substr(title, 6) from public.tasks_with_overdue where title like 'm318:%' $$,
  pg_temp.org_open() || array['X-exec', 'DT-umb-sub'],
  'tasks_with_overdue follows tasks_read for the Executor too');

-- R2 with an ended Assignment: a past Executor keeps reading their history.
reset role;
select pg_temp.login_as('past_executor');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['X-past'],
  'past Executor (gave up) still reads that Task + org-wide Opportunities');

-- R2 with Candidatures in any status: X-cand-closed's queue is closed and
-- the Candidature was closed with it — "existing participants retain their
-- own state"; X-cand-withdrawn was left voluntarily. Both are local `pr`
-- queues the persona is not otherwise eligible for.
reset role;
select pg_temp.login_as('candidate');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['X-cand-closed', 'X-cand-withdrawn'],
  'Candidate reads the Tasks they queued for, closed queue and withdrawn Candidature included');

-- R7 in isolation: R2 admits the Umbrella X-umb, and R7 admits its Subtask
-- X-umb-sub because the Umbrella is readable by the same caller.
reset role;
select pg_temp.login_as('umbrella_candidate');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['X-umb', 'X-umb-sub'],
  'a Subtask is readable whenever its Umbrella is readable by the same caller');

-- A deactivated BCE whose token still carries bce / level 5 / `edu`, who
-- also holds an ended Assignment on X-past: live status 'activ' gates every
-- branch, so nothing.
reset role;
select pg_temp.login_as('deactivated');
select is_empty('select * from pg_temp.visible_titles()',
  'deactivated member with stale BCE claims reads no Task, their own history included');

-- An active `edu` member holding a pending Candidature, whose session
-- carries no organisation claims: auth_is_member() gates every branch.
reset role;
select pg_temp.test_login(
  (select id from pg_temp.fx_persona where code = 'claimless'),
  '{"provider": "email"}'::jsonb);
select is_empty('select * from pg_temp.visible_titles()',
  'claimless session reads no Task, not even one it queued for');

reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select count(*) from public.tasks $$, '42501', null,
  'anon has no privilege on tasks at all');
select throws_ok($$ select count(*) from public.tasks_with_overdue $$, '42501', null,
  'anon has no privilege on tasks_with_overdue either');

-- ==================== Decision 4: writes vs tasks_read ====================
-- Round 1: pin the corrected consequence of splitting task_write. Postgres
-- applies the table's SELECT policies to a new row whenever the statement
-- needs SELECT rights on it (a RETURNING clause -- how PostgREST's
-- `Prefer: return=representation` / supabase-js `.insert().select()` work).
-- can_read_task resolves the row by id via a fresh query, and within the
-- same command the row it just inserted is not yet visible to that query,
-- so the check always fails -- for every caller, BC included, since R1
-- never gets evaluated (it lives inside the same failing EXISTS). Without
-- RETURNING, no SELECT policy applies and the insert succeeds.
reset role;
select pg_temp.login_as('bce_local');
-- A savepoint, not just reliance on throws_ok's own internal rollback: the
-- lives_ok insert below succeeds and would otherwise leave a stray
-- 'm318:%' row behind for every later query that scans public.tasks by
-- that prefix (visible_titles(), every_task()).
savepoint sp_write_consequence;
select throws_ok(
  $$ insert into public.tasks (title, dept_id) values ('m318:write-insert-returning', 'edu') returning id $$,
  '42501', null,
  'decision 4: a direct INSERT ... RETURNING is refused even for a BCE -- can_read_task cannot see a row that does not exist yet');
select lives_ok(
  $$ insert into public.tasks (title, dept_id) values ('m318:write-insert-noreturning', 'edu') $$,
  'decision 4: the same direct INSERT without RETURNING still succeeds -- no SELECT policy applies to it');
rollback to savepoint sp_write_consequence;

-- ==================== The helpers ====================
reset role;
select pg_temp.login_as('executor');
select is(private.is_task_executor(pg_temp.task_id('X-exec')), true,
  'is_task_executor: true for the current Executor');
select is(private.is_task_candidate(pg_temp.task_id('X-exec')), false,
  'is_task_candidate: false for an Executor who never queued');

reset role;
select pg_temp.login_as('past_executor');
select is(private.is_task_executor(pg_temp.task_id('X-past')), true,
  'is_task_executor: true for an ended Assignment');
select is(private.is_task_executor(pg_temp.task_id('X-exec')), false,
  'is_task_executor: false for someone else''s Task');

reset role;
select pg_temp.login_as('candidate');
select is(private.is_task_candidate(pg_temp.task_id('X-cand-closed')), true,
  'is_task_candidate: true for a closed Candidature');
select is(private.is_task_candidate(pg_temp.task_id('X-cand-withdrawn')), true,
  'is_task_candidate: true for a withdrawn Candidature');

reset role;
select pg_temp.login_as('deactivated');
select is(private.is_task_executor(pg_temp.task_id('X-past')), false,
  'is_task_executor: false for a deactivated member''s own Assignment');

reset role;
select pg_temp.test_login(
  (select id from pg_temp.fx_persona where code = 'claimless'),
  '{"provider": "email"}'::jsonb);
select is(private.is_task_candidate(pg_temp.task_id('X-cand-withdrawn')), false,
  'is_task_candidate: false without organisation claims');

reset role;
select pg_temp.login_as('project_lead');
select is(private.can_manage_task(pg_temp.task_id('P-loc-dir')), true,
  'can_manage_task: the lead manages active Project work');
select is(private.can_manage_task(pg_temp.task_id('PA-dir')), false,
  'can_manage_task: nobody below BC/Moderator manages an archived Project''s work');
select is(private.can_read_task(pg_temp.task_id('PA-dir')), true,
  'can_read_task: the lead still reads the archived Project''s history');

reset role;
select pg_temp.login_as('project_responsible');
select is(private.can_manage_task(pg_temp.task_id('P-loc-dir')), true,
  'can_manage_task: a Project Responsible manages active Project work');

reset role;
select pg_temp.login_as('project_member');
select is(private.can_manage_task(pg_temp.task_id('P-loc-dir')), false,
  'can_manage_task: a plain Project member does not');
select set_eq(
  'select task.title from pg_temp.fx_task as task where private.can_read_task(task.id)',
  'select * from pg_temp.visible_titles()',
  'tasks_read admits exactly the rows private.can_read_task admits');

reset role;
select pg_temp.login_as('indep_team_member');
select is(private.can_manage_task(pg_temp.task_id('IT-loc-dir')), true,
  'can_manage_task: Independent-Team members jointly manage their Team''s work');

reset role;
select pg_temp.login_as('dept_team_member');
select is(private.can_manage_task(pg_temp.task_id('DT-loc-dir')), false,
  'can_manage_task: Department-Team members read but do not manage planned work');

reset role;
select pg_temp.login_as('bce_local');
select is(private.can_manage_task(pg_temp.task_id('DT-loc-dir')), true,
  'can_manage_task: local BCE manages Department-Team work');

reset role;
select pg_temp.login_as('bce_foreign');
select is(private.can_manage_task(pg_temp.task_id('D-loc-dir')), false,
  'can_manage_task: a foreign BCE does not manage another Department''s work');
select is(private.can_read_task(pg_temp.task_id('D-loc-dir')), true,
  'can_read_task: yet reads it (BCE reads all Tasks globally)');

reset role;
select pg_temp.login_as('bc');
select is(private.can_read_task(9223372036854775807), false,
  'can_read_task: false for a missing Task, even for BC');
select is(private.can_manage_task(9223372036854775807), false,
  'can_manage_task: false for a missing Task, even for BC');

-- ==================== Helper implies read, everywhere ====================
-- can_read_task inlines R2 and has no R3 branch of its own (its header
-- says why). This sweep holds it to the helpers: for every persona (logged
-- in with claims derived from its live rows) and every fixture Task, each
-- of can_manage_task, is_task_executor and is_task_candidate that holds
-- must come with can_read_task. Returned as persona:Task:helper triples.
reset role;
create function pg_temp.helper_triples(p_readable boolean)
returns text[]
language plpgsql
as $$
declare
  v_ids   uuid[];
  v_codes text[];
  v_found text[] := '{}';
begin
  select array_agg(persona.id order by persona.code),
         array_agg(persona.code order by persona.code)
    into v_ids, v_codes
    from pg_temp.fx_persona as persona;

  for i in 1 .. cardinality(v_ids) loop
    perform set_config('role', 'none', true);
    perform pg_temp.test_login_leadership(v_ids[i]);
    v_found := v_found || array(
      select v_codes[i] || ':' || task.title || ':' || helper.name
        from pg_temp.fx_task as task
       cross join lateral (values
               ('manage',    private.can_manage_task(task.id)),
               ('executor',  private.is_task_executor(task.id)),
               ('candidate', private.is_task_candidate(task.id))
             ) as helper (name, holds)
       where helper.holds
         and private.can_read_task(task.id) = p_readable);
  end loop;

  perform set_config('role', 'none', true);
  return v_found;
end;
$$;

select is(pg_temp.helper_triples(false), '{}'::text[],
  'no persona manages, executes or queues for a Task it cannot read');
-- Non-vacuity: BC and Moderator manage all 36 Tasks (72, round 1's X-review
-- included -- BC/Moderator's global override reaches it as a `pr` Task,
-- same as any other), local BCE the 15 D/DT Tasks, the lead and the
-- Responsible the 6 active-Project Tasks each, the Independent-Team member
-- the 6 IT Tasks (105 manage); executor 2, filler 1 and past_executor 1
-- Assignments (4; the deactivated one's is refused); candidate 2,
-- umbrella_candidate 1 and the member behind the claimless persona 1
-- Candidatures, here logged in with real claims (4).
select is(cardinality(pg_temp.helper_triples(true)), 113,
  'the sweep is not vacuous: 113 persona/Task/helper triples hold, all readable');

reset role;
select * from finish();
rollback;
