-- rls_tasks_read_matrix.test.sql — #318: who reads which Task under the
-- ADR-0007 visibility rules. One set-equality assertion per persona over a
-- fixed fixture world, so a wrong row in either direction (a leak or a
-- missing Task) fails with the exact titles. Every expected set is derived,
-- in the comment above it, from the rule list in
-- 20260911211100_tasks_read_policy.sql:
--   R1 global readers: live role level >= 5 (BCE, BC, Moderator)
--   R2 own work: any Assignment (current or ended) or Candidature (any status)
--   R3 Group Managers and Responsibles on the ancestor path (archived history too)
--   R4 Shared Work Visibility of any Group on the path the caller belongs to
--   R6 open Opportunities: ordinary, public, queue open, unfinished (#794,
--      ruling R26 -- visibility follows the Task Audience):
--      R6-org  Audience org, of any Group: every active Member, NO Minimum
--              Level gate
--      R6-own  any Audience, of a Group the Member is a member of
--              (private.is_group_member), at the Group's Minimum Level
--      a local Opportunity of a Group the Member is not in is invisible
--      R3 authority overrides Minimum Level; ordinary R4/R6-own reads must meet it
--   R7 a Subtask whenever its Umbrella is readable by the same caller
-- and nothing else: plain Department and Project members read only R2 + R6.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(84);

-- ==================== Shape of the read surface ====================
select policies_are('public', 'tasks',
  array['tasks_read'],
  'tasks carries the #318 read policy and nothing else -- task_read, task_write and #345''s three split legacy write policies are all gone');

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

-- #345 retired the legacy direct write path outright: no `%_legacy` policy
-- survives on tasks, and authenticated holds no write privilege on the table
-- to reach one with. Both halves are asserted -- a policy could be dropped
-- while the grant stayed open, or the reverse.
select is(
  array(select policy.policyname::text
          from pg_policies as policy
         where policy.schemaname = 'public'
           and policy.tablename = 'tasks'
           and policy.policyname like '%\_legacy'
         order by policy.policyname),
  '{}'::text[],
  'no legacy direct-write policy survives on tasks');

select is(
  array(select privilege_type::text
          from information_schema.role_table_grants
         where grantee = 'authenticated'
           and table_schema = 'public'
           and table_name = 'tasks'
         order by 1),
  array['SELECT'],
  'and authenticated holds SELECT on tasks and nothing else -- the commands own every write');

select hasnt_function('public', 'is_assigned', array['bigint'],
  'public.is_assigned (the legacy assignee predicate) is gone with its last consumer');

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
  ('filler',              '31800000-0000-0000-0000-000000000025', 'voluntar',    'activ',   null),
  -- #683: a level-1 Member of another Department, below the gated Group's
  -- Minimum Level 2 -- the persona that pins the gate R10 keeps.
  ('outsider_below_min',  '31800000-0000-0000-0000-000000000026', 'voluntar',    'activ',   'fin');

insert into auth.users (id, email)
select persona.id, 'm318.' || persona.code || '@test.local' from fx_persona as persona;
insert into public.profiles (id, full_name, email, role, status)
select persona.id, 'M318 ' || persona.code, 'm318.' || persona.code || '@test.local',
       persona.role, persona.status
  from fx_persona as persona;
insert into pg_temp.fixture_member_departments (member_id, dept_id)
select persona.id, persona.dept_id from fx_persona as persona where persona.dept_id is not null;

insert into pg_temp.fixture_teams (id, name, dept_id) values
  ('m318-dt', 'M318 Department Team', 'edu'),
  ('m318-it', 'M318 Independent Team', null);
insert into pg_temp.fixture_team_members (team_id, member_id)
select membership.team_id, persona.id
  from (values ('m318-dt', 'dept_team_member'), ('m318-it', 'indep_team_member'))
         as membership (team_id, code)
  join fx_persona as persona on persona.code = membership.code;

-- Same lead, Responsible and plain member in an active and an archived
-- Project. The leader's own membership comes from projects_sync_leader_membership.
insert into pg_temp.fixture_projects (name, status, leader_id, created_by)
select project.name, project.status, lead.id, bc.id
  from (values ('M318 Project', 'active'), ('M318 Archived Project', 'archived'))
         as project (name, status)
 cross join (select id from fx_persona where code = 'project_lead') as lead
 cross join (select id from fx_persona where code = 'bc') as bc;
insert into pg_temp.fixture_project_members (project_id, member_id, project_role)
select project.id, persona.id, membership.project_role
  from pg_temp.fixture_projects as project
 cross join (values ('project_responsible', 'responsible'), ('project_member', 'member'))
         as membership (code, project_role)
  join fx_persona as persona on persona.code = membership.code
 where project.name in ('M318 Project', 'M318 Archived Project');
-- #586: materialize this suite's legacy setup as rolled-back Group fixtures.
select pg_temp.materialize_legacy_groups();


-- The 24-row core: every Origin kind x Audience x (direct | public with an
-- open queue | public with a closed queue). Titles carry an `m318:` prefix
-- so the demo seed's own Tasks never enter a persona's set.
insert into public.tasks
  (title, group_id, audience, assignment_mode,
   queue_opened_at, queue_closed_at)
select 'm318:' || origin.code || '-' || shape.code,
       coalesce(pg_temp.dept_group(origin.dept_id), pg_temp.team_group(origin.team_id),
                pg_temp.project_group(origin.project_id)),
       shape.audience, shape.assignment_mode,
       case when shape.assignment_mode = 'public' then now() end,
       case when shape.queue_closed then now() end
  from (values
          ('D',  'edu',      null::text, null::bigint),
          ('DT', null,       'm318-dt',  null),
          ('IT', null,       'm318-it',  null),
          ('P',  null,       null,       (select id from pg_temp.fixture_projects where name = 'M318 Project'))
       ) as origin (code, dept_id, team_id, project_id)
 cross join (values
          ('loc-dir',    'local', 'direct', false),
          ('org-dir',    'org',   'direct', false),
          ('loc-open',   'local', 'public', false),
          ('loc-closed', 'local', 'public', true),
          ('org-open',   'org',   'public', false),
          ('org-closed', 'org',   'public', true)
       ) as shape (code, audience, assignment_mode, queue_closed);

-- #683: a Group whose Minimum Level (2) sits above levels 0-1, under `pr`
-- (no persona belongs to it). Since #794 (ruling R26) its open org
-- Opportunity is readable -- and joinable -- by every active Member at any
-- level; its open local Opportunity and its direct Task by nobody outside R1.
-- OD9: a rolled-back Group fixture.
insert into public.groups (name, category, parent_id, min_level, application_level)
values ('M683 Gated Team', 'team', pg_temp.dept_group('pr'), 2, 2);
insert into public.tasks
  (title, group_id, audience, assignment_mode, queue_opened_at)
select 'm318:' || shape.code, grp.id, shape.audience, shape.assignment_mode,
       case when shape.assignment_mode = 'public' then now() end
  from public.groups as grp
 cross join (values ('G-loc-open', 'local', 'public'),
                    ('G-org-open', 'org',   'public'),
                    ('G-loc-dir',  'local', 'direct')) as shape (code, audience, assignment_mode)
 where grp.name = 'M683 Gated Team';

-- An Umbrella of the Department Team with a direct Subtask (the executor
-- persona's) and an org-wide public Subtask. An Umbrella carries no
-- Audience or Assignment Mode (tasks_umbrella_shape_ck).
insert into public.tasks (title, kind, group_id, audience, assignment_mode)
values ('m318:DT-umb', 'umbrella', pg_temp.team_group('m318-dt'), null, null);
insert into public.tasks
  (title, parent_task_id, group_id, audience, assignment_mode, status, started_at)
select 'm318:DT-umb-sub', umbrella.id, pg_temp.team_group('m318-dt'), 'local', 'direct', 'in_progress', now()
  from public.tasks as umbrella where umbrella.title = 'm318:DT-umb';
insert into public.tasks
  (title, parent_task_id, group_id, audience, assignment_mode, queue_opened_at)
select 'm318:DT-umb-sub-open', umbrella.id, pg_temp.team_group('m318-dt'), 'org', 'public', now()
  from public.tasks as umbrella where umbrella.title = 'm318:DT-umb';

-- A `pr` Umbrella whose only reader outside R1 holds a Candidature on the
-- Umbrella itself. No command creates that state (an Umbrella has no
-- queue); it is built here only to observe R7 in isolation, because every
-- other branch that admits an Umbrella also admits its Subtasks through
-- their shared, immutable Origin (#315).
insert into public.tasks (title, kind, group_id, audience, assignment_mode)
values ('m318:X-umb', 'umbrella', pg_temp.dept_group('pr'), null, null);
insert into public.tasks (title, parent_task_id, group_id)
select 'm318:X-umb-sub', umbrella.id, pg_temp.dept_group('pr')
  from public.tasks as umbrella where umbrella.title = 'm318:X-umb';

-- History of the archived Project.
-- #339: tasks_cancel_reason_ck makes cancel_reason mandatory on -- and
-- exclusive to -- a cancelled Task, so this fixture states why it was called
-- off. Nothing else about the fixture changes.
insert into public.tasks (title, group_id, status, cancelled_at, cancel_reason)
select 'm318:PA-dir', pg_temp.project_group(project.id), 'cancelled', now(), 'Proiect arhivat #318'
  from pg_temp.fixture_projects as project where project.name = 'M318 Archived Project';

-- Participation Tasks in `pr`, where no persona except R1 is a member.
-- X-busy is an org-wide Opportunity that already has an Executor and is in
-- progress: its queue is still open, so it is still an Opportunity.
-- X-review (round 1) pins the same point one status further along: an
-- Opportunity that has moved to in_review, with a submission recorded,
-- while its queue is still open, is still an Opportunity too -- a mutant
-- narrowing R6 to `todo`/`in_progress` must fail wherever org_open() feeds
-- an expected set.
insert into public.tasks
  (title, group_id, audience, assignment_mode, queue_opened_at, queue_closed_at,
   status, started_at, submitted_at)
values
  ('m318:X-busy',           pg_temp.dept_group('pr'), 'org',   'public', now(), null,  'in_progress', now(), null),
  ('m318:X-review',         pg_temp.dept_group('pr'), 'org',   'public', now(), null,  'in_review',   now(), now()),
  ('m318:X-exec',           pg_temp.dept_group('pr'), 'local', 'direct', null,  null,  'in_progress', now(), null),
  ('m318:X-past',           pg_temp.dept_group('pr'), 'local', 'direct', null,  null,  'todo',        null,  null),
  ('m318:X-cand-closed',    pg_temp.dept_group('pr'), 'local', 'public', now(), now(), 'todo',        null,  null),
  ('m318:X-cand-withdrawn', pg_temp.dept_group('pr'), 'local', 'public', now(), null,  'todo',        null,  null);

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

-- The Opportunities every active Member reads (R6-org, Audience org, queue
-- open, unfinished), at every level (#794, ruling R26: no Minimum Level gate):
-- one per Origin kind, the org-wide Subtask, X-busy (in_progress), X-review
-- (in_review, round 1) and the gated Group's G-org-open (Minimum Level 2).
-- The local ones -- D/DT/IT/P-loc-open, X-cand-withdrawn, G-loc-open -- are
-- read only by the members of their Group (R6-own) and by R1-R4.
create function pg_temp.org_open()
returns text[]
language sql
immutable
as $$
  select array['D-org-open', 'DT-org-open', 'IT-org-open', 'P-org-open',
               'DT-umb-sub-open', 'X-busy', 'X-review', 'G-org-open']
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
-- #794 (ruling R26): every active persona reads org_open() -- the open org
-- Opportunities of every Group, the gated one's included, at any level --
-- plus the open Opportunities (any Audience) of the Groups it is a member
-- of. No persona reads a local Opportunity of a Group it is not in, unless
-- R1-R4 admit it. Nobody below R1 reads a direct Task, a closed queue, or
-- anything terminal of a Group they have no other rule for. Role level
-- changes nothing else (ADR-0007: "regardless of role level").

-- Levels 0-3 inside the Department Origin (`edu` members, no Team or
-- Project): R6 only -- every org Opportunity plus `edu`'s own local one. Not
-- D-loc-closed (a closed queue hides the Opportunity from nonparticipants),
-- not the direct D Tasks (not theirs), not the Child Team's DT-loc-open and
-- not the gated Group's G-loc-open (not their Groups).
reset role;
select pg_temp.login_as('recrut_in');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['D-loc-open'],
  'Recrut in the Department: every org Opportunity and its own Department''s local one, no other Group''s local Opportunity (#794)');
-- #794 AC, named: membership is of THIS Group only -- a Department member
-- does not read its Child Team's local Opportunity (it could not join it).
select ok(exists (select 1 from public.tasks where title = 'm318:D-loc-open')
          and not exists (select 1 from public.tasks where title = 'm318:DT-loc-open'),
  '#794: a Department member reads its own local Opportunity but not its Child Team''s');

reset role;
select pg_temp.login_as('voluntar_in');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['D-loc-open'],
  'Voluntar in the Department: every org Opportunity and its own Department''s local one');

reset role;
select pg_temp.login_as('activ_in');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['D-loc-open'],
  'Membru Activ (level 2) in the Department: the same set -- the gated Group''s org Opportunity, never its local one or its direct Task');

reset role;
select pg_temp.login_as('vot_in');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['D-loc-open'],
  'Vot (level 3) in the Department: the same set as levels 0-2');

-- Levels 0-3 outside every fixture Origin (`fin` members; also the
-- non-member of the Project and of both Teams): org Opportunities only.
reset role;
select pg_temp.login_as('recrut_out');
select set_eq('select * from pg_temp.visible_titles()', pg_temp.org_open(),
  'Recrut outside the Origin: every open org Opportunity and no local one (#794)');
-- Round 1: pin the in_review Opportunity explicitly (X-busy already pins
-- in_progress the same way); a mutant narrowing R6 to todo/in_progress
-- must fail here even if it left org_open() itself unedited.
select ok(
  exists (select 1 from pg_temp.visible_titles() as title where title = 'X-review'),
  'an in_review public Opportunity with an open queue is still visible to an eligible outsider');

reset role;
select pg_temp.login_as('voluntar_out');
select set_eq('select * from pg_temp.visible_titles()', pg_temp.org_open(),
  'Voluntar outside the Origin (also a Project and Team non-member): every open org Opportunity, no local one (#794)');
-- Issue #318 AC, named: nine closed-queue public Tasks exist across the
-- four Origin kinds and `pr`; a nonparticipant outside their Origins reads
-- none of them, org-wide Audience included.
select is(
  (select count(*) from public.tasks where title like 'm318:%-closed'),
  0::bigint,
  'AC: a closed-queue public Task is invisible to non-participants outside its Origin');
-- #794 AC, named (the #683 one flipped): the level-1 outsider reads no local
-- Opportunity of another Department (D-loc-open) or of that Department's
-- Child Team (DT-loc-open), and none of their direct Tasks -- the org-Audience
-- direct rows D-org-dir / DT-org-dir included.
select ok(
  not exists (select 1 from public.tasks
               where title in ('m318:D-loc-open', 'm318:DT-loc-open',
                               'm318:D-loc-dir', 'm318:D-org-dir', 'm318:DT-loc-dir', 'm318:DT-org-dir')),
  '#794: an outsider never reads another Department''s or its Child Team''s local Opportunities, nor their direct Tasks');
-- Candidate privacy: X-cand-withdrawn is a local `pr` Opportunity with two
-- Candidatures; the outsider reads neither the Task nor its Candidatures.
select ok(
  not exists (select 1 from public.tasks where title = 'm318:X-cand-withdrawn')
  and not exists (select 1 from public.task_candidates as candidate
                   where candidate.task_id = pg_temp.task_id('X-cand-withdrawn')),
  '#794: the outsider reads neither another Group''s local Opportunity nor any of its Candidatures');

reset role;
select pg_temp.login_as('activ_out');
select set_eq('select * from pg_temp.visible_titles()', pg_temp.org_open(),
  'Membru Activ (level 2) outside the Origin: every open org Opportunity and no local one, the gated Group''s included');

-- A Vot demoted from BC whose unexpired token still says BC level 6 and
-- lists `edu`, `pr` and both Teams: authority and memberships are read live,
-- never from the JWT, so this is still a plain Vot (level 3) in `fin`.
reset role;
select pg_temp.test_login(
  (select id from pg_temp.fx_persona where code = 'vot_out'),
  jsonb_build_object('member_role', 'bc', 'member_level', 6,
                     'dept_ids', '["edu", "pr"]'::jsonb,
                     'team_ids', '["m318-dt", "m318-it"]'::jsonb));
select set_eq('select * from pg_temp.visible_titles()', pg_temp.org_open(),
  'Vot outside the Origin with stale BC claims and forged memberships: org Opportunities by live membership only');

-- #794 (ruling R26): the outsider below the Minimum Level. A level-1 Member
-- below the gated Group's Minimum Level 2 still reads its open org
-- Opportunity -- the org arm has no Minimum Level gate -- and joins it; the
-- Group's local Opportunity stays hidden, and interest in it is refused as
-- not found, never as a denial.
reset role;
select pg_temp.login_as('outsider_below_min');
select set_eq('select * from pg_temp.visible_titles()', pg_temp.org_open(),
  '#794: the outsider below the gated Group''s Minimum Level reads its org Opportunity like every other one');
-- The card's Group embed: groups_read admits the gated Group through
-- private.has_open_org_opportunity, so the Opportunity names its Group.
select is(
  (select grp.name from public.tasks as task
     join public.groups as grp on grp.id = task.group_id
    where task.title = 'm318:G-org-open'),
  'M683 Gated Team',
  '#794: the org Opportunity''s Group reads for the outsider below its Minimum Level (the card is not "Origine indisponibilă")');
select lives_ok(format('select public.express_task_interest(%s)', pg_temp.task_id('G-org-open')),
  '#794: below the Minimum Level an org-Audience Opportunity is joinable -- no Minimum Level gate');
select is(
  (select candidate.status from public.task_candidates as candidate
    where candidate.task_id = pg_temp.task_id('G-org-open')
      and candidate.member_id = auth.uid()),
  'pending',
  '#794: the join queued the outsider as a pending Candidate');
select throws_ok(format('select public.express_task_interest(%s)', pg_temp.task_id('G-loc-open')),
  'PT404', 'task_not_found',
  '#794: a local Opportunity of a Group the caller is not in is not found, not forbidden');
-- The limb follows the open state: with G-org-open's queue closed the gated
-- Group owns no open org Opportunity and reads for the outsider no more
-- (their own Candidature still shows them the Task, R2).
reset role;
update public.tasks set queue_closed_at = now() where id = pg_temp.task_id('G-org-open');
select pg_temp.login_as('outsider_below_min');
select ok(
  not exists (select 1 from public.groups where name = 'M683 Gated Team'),
  '#794: groups_read hides the gated Group again once it owns no open org Opportunity');
reset role;
update public.tasks set queue_closed_at = null where id = pg_temp.task_id('G-org-open');

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
-- #794 AC: reading is not joining. The foreign BCE reads `edu`'s local
-- Opportunity through R1 but is not a member of `edu`: 42501, not PT404.
select throws_ok(format('select public.express_task_interest(%s)', pg_temp.task_id('D-loc-open')),
  '42501', 'task_audience_forbidden',
  '#794: a BCE reads another Department''s local Opportunity but may not join it');

reset role;
select pg_temp.login_as('bc');
select set_eq('select * from pg_temp.visible_titles()', pg_temp.every_task(),
  'BC reads every Task');

reset role;
select pg_temp.login_as('moderator');
select set_eq('select * from pg_temp.visible_titles()', pg_temp.every_task(),
  'Moderator reads every Task');

-- R5 over both Projects: all six P Tasks (the closed queues included) and
-- the archived Project's history PA-dir; plus the org Opportunities elsewhere.
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

-- A plain Project member: own work (none), the org Opportunities and the
-- Project's own local one. Not the Project's direct Tasks, not its closed
-- queues, not PA-dir.
reset role;
select pg_temp.login_as('project_member');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['P-loc-open'],
  'plain Project member: open Opportunities only, never the Project''s direct Tasks or closed queues');
select set_eq(
  $$ select substr(title, 6) from public.tasks_with_overdue where title like 'm318:%' $$,
  pg_temp.org_open() || array['P-loc-open'],
  'tasks_with_overdue is security_invoker: a plain Project member reads the same set through it');

-- R4 over the Department Team: all six DT Tasks, the Umbrella and both
-- Subtasks. Not D-loc-dir and, since #794, not D-loc-open: a Department Team
-- member is not thereby a member of the parent Department (decision (a)).
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
  'current Executor reads their Tasks (a Subtask included, not its Umbrella) + open org Opportunities');
select set_eq(
  $$ select substr(title, 6) from public.tasks_with_overdue where title like 'm318:%' $$,
  pg_temp.org_open() || array['X-exec', 'DT-umb-sub'],
  'tasks_with_overdue follows tasks_read for the Executor too');

-- R2 with an ended Assignment: a past Executor keeps reading their history.
reset role;
select pg_temp.login_as('past_executor');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['X-past'],
  'past Executor (gave up) still reads that Task + open org Opportunities');

-- R2 with Candidatures in any status: X-cand-closed's queue is closed and
-- the Candidature was closed with it — "existing participants retain their
-- own state". X-cand-withdrawn is a local `pr` Opportunity: since #794 only
-- R2 (the withdrawn Candidature) admits it.
reset role;
select pg_temp.login_as('candidate');
select set_eq('select * from pg_temp.visible_titles()',
  pg_temp.org_open() || array['X-cand-closed', 'X-cand-withdrawn'],
  'Candidate reads the Tasks they queued for, the closed queue and the withdrawn Candidature included');

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
-- #318 split the legacy FOR ALL task_write into three write-only policies,
-- and this section pinned the awkward consequence: a direct INSERT was
-- refused WITH a RETURNING clause (which needs SELECT rights on the new row,
-- and can_read_task cannot see a row that does not exist yet) but SUCCEEDED
-- without one. #345 removed the question by removing the path: `authenticated`
-- holds no INSERT/UPDATE/DELETE privilege on public.tasks at all, so both
-- forms are now refused identically, before RLS is consulted. Both are still
-- asserted -- the asymmetry was subtle enough to be worth proving gone, not
-- merely deleting.
reset role;
select pg_temp.login_as('bce_local');
select throws_ok(
  $$ insert into public.tasks (title, group_id) values ('m318:write-insert-returning', pg_temp.dept_group('edu')) returning id $$,
  '42501', 'permission denied for table tasks',
  'decision 4, after #345: a direct INSERT ... RETURNING is refused even for a BCE');
select throws_ok(
  $$ insert into public.tasks (title, group_id) values ('m318:write-insert-noreturning', pg_temp.dept_group('edu')) $$,
  '42501', 'permission denied for table tasks',
  'decision 4, after #345: and so is the same INSERT without RETURNING -- the table grant, not a SELECT policy, decides now');

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
-- Non-vacuity (+6 since #683: BC and Moderator also manage the gated Group's
-- three Tasks): BC and Moderator manage all 36 Tasks (72, round 1's X-review
-- included -- BC/Moderator's global override reaches it as a `pr` Task,
-- same as any other), local BCE the 15 D/DT Tasks, the lead and the
-- Responsible the 6 active-Project Tasks each, the Independent-Team member
-- the 6 IT Tasks (105 manage); executor 2, filler 1 and past_executor 1
-- Assignments (4; the deactivated one's is refused); candidate 2,
-- umbrella_candidate 1 and the member behind the claimless persona 1
-- Candidatures, here logged in with real claims (4); and, since #794,
-- outsider_below_min's own Candidature on G-org-open, the org Opportunity it
-- joined below the Minimum Level (+1).
select is(cardinality(pg_temp.helper_triples(true)), 120,
  'the sweep is not vacuous: 120 persona/Task/helper triples hold, all readable');

reset role;

-- #521: Group authority regression matrix.
\ir _group_task_fixtures.psql
select pg_temp.g521_task('private','project',5);
select pg_temp.g521_task('archived','archived',5);
select pg_temp.g521_task('dtprivate','dt',10);
select pg_temp.g521_task('dtorg','dt',null,'todo','public');
select pg_temp.g521_task('dtlocal','dt',null,'todo','public');
update public.tasks set audience='local' where id=(select id from g521_tasks where name='dtlocal');
select pg_temp.g521_task('dtown','dt',8);
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(5));
-- #794 (ruling R26): membership is of THIS Group only (private.is_group_member)
-- -- the Department member does not read the Child Team's local Opportunity
-- (Minimum Level 0), which it could not join either.
select is(private.can_read_task((select id from g521_tasks where name='dtlocal')),false,'#794: a plain Department member does not read a Child Team''s local Opportunity it is not a member of');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select ok(private.can_read_task((select id from g521_tasks where name='private')) and private.can_read_task((select id from g521_tasks where name='archived')),'low-rank Group Manager reads active work and archived history');
reset role;
-- OD9 rolled-back settings fixture; no production Group write.
update public.groups set min_level=3,application_level=3 where id = pg_temp.team_group('dt521');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(8));
-- #794 (ruling R26): the org Opportunity reads at any level; the Group's own
-- local one and its Shared Work Visibility still wait for the Minimum Level.
select results_eq($$select t.name from g521_tasks t where t.name like 'dt%' and private.can_read_task(t.id) order by 1$$,$$values ('dtorg'::text), ('dtown'::text)$$,'below-Minimum-Level Member reads their Assignment and the org Opportunity, not shared work or the local Opportunity (#794)');
reset role;
update public.groups set min_level=3,application_level=3 where name='Project #521';
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select is(private.can_read_task((select id from g521_tasks where name='private')),true,'inherited or direct Group Role overrides discovery Minimum Level');
reset role;
update public.groups set min_level=0,application_level=0 where name='Project #521';
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
reset role;
delete from pg_temp.fixture_project_members where project_id=(select id from pg_temp.fixture_projects where name='Project #521') and member_id=pg_temp.g521_uid(3);
delete from public.group_members where group_id=(select id from public.groups where name='Project #521')
  and member_id=pg_temp.g521_uid(3);
set local role authenticated;
select is(private.can_read_task((select id from g521_tasks where name='private')),false,'removed Group role loses private reads despite stale token');
-- #794: dtorg now reads for every Member, so the stale-role guard is pinned on
-- the Child Team's local Opportunity instead.
select is(private.can_read_task((select id from g521_tasks where name='dtlocal')),false,'stale Group role does not reach another Group''s local Opportunity');
reset role;
-- #521 (delta): the brief's stale_role persona "reads only R6". The two negatives above pin
-- the "only"; this pins the "R6" -- losing the Group Role must not cost them the org-audience
-- Opportunity their rank alone earns on the very Group they were removed from.
select pg_temp.g521_task('projorg','project',null,'todo','public');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(3));
select is(private.can_read_task((select id from g521_tasks where name='projorg')),true,
  'a removed Group Role still reads that Group''s open org-audience Opportunity: R6 survives R3''s loss');
reset role;

-- #794 AC: a Group Manager on the path reads a Child Group's local Opportunity
-- (R3) but, not being a member of that Child Group, may not join it -- 42501,
-- since they already know it exists; a plain member of the parent Group
-- neither reads nor joins it -- PT404. OD9: rolled-back fixtures.
insert into public.groups (name, category, parent_id, application_level)
values ('Project child #794', 'team', (select id from public.groups where name = 'Project #521'), 0);
insert into public.tasks (title, group_id, created_by, deadline, audience, assignment_mode, queue_opened_at)
select 'Group #794 childlocal', grp.id, pg_temp.g521_uid(1), now() + interval '7 days', 'local', 'public', now()
  from public.groups as grp where grp.name = 'Project child #794';
insert into g521_tasks select 'childlocal', id from public.tasks where title = 'Group #794 childlocal';
select pg_temp.test_login_leadership(pg_temp.g521_uid(2));
select is(private.can_read_task((select id from g521_tasks where name='childlocal')), true,
  '#794: a low-rank Group Manager on the path reads a Child Group''s local Opportunity');
select throws_ok(format('select public.express_task_interest(%s)', (select id from g521_tasks where name='childlocal')),
  '42501', 'task_audience_forbidden',
  '#794: but may not join it -- the Audience admits only the Child Group''s members');
reset role;
select pg_temp.test_login_leadership(pg_temp.g521_uid(5));
select throws_ok(format('select public.express_task_interest(%s)', (select id from g521_tasks where name='childlocal')),
  'PT404', 'task_not_found',
  '#794: a plain member of the parent Group neither reads nor joins the Child Group''s local Opportunity');
reset role;

select * from finish();
rollback;
