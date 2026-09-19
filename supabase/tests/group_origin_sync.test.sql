-- group_origin_sync.test.sql — #519: the two-way group_id/legacy-Origin sync triggers on
-- tasks, events, campaigns and completed_work_requests (ADR-0009 Wave 2 bridge). A legacy
-- write derives group_id; a Group write derives the legacy Origin; a row that sets both
-- inconsistently is refused. Runs as the table owner (no RLS session) -- these are
-- structural/trigger assertions, not authorization ones. Fixture prefix 51900000-… (#519).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(68);

-- ==================== Fixtures ====================
-- A Department Team under edu, an Independent Team, and an active Project created through
-- the legacy tables, so the Wave 1 mirror creates their Groups for this suite to read back.

insert into auth.users (id, email)
values ('51900000-0000-0000-0000-000000000001', 'group-origin-lead-519@test.local');
insert into public.profiles (id, full_name, email, role, status)
values ('51900000-0000-0000-0000-000000000001', 'Group Origin Lead',
        'group-origin-lead-519@test.local', 'responsabil', 'activ');

insert into public.teams (id, name, dept_id) values
  ('team-dept-519', 'Group Origin Dept Team 519', 'edu'),
  ('team-indep-519', 'Group Origin Independent Team 519', null);

insert into public.projects (name, status, leader_id, created_by) values
  ('Group Origin Project 519', 'active',
   '51900000-0000-0000-0000-000000000001',
   '51900000-0000-0000-0000-000000000001');

create temp table fx as
select
  (select grp.id from public.groups as grp where grp.legacy_dept_id = 'edu') as edu_group_id,
  (select grp.id from public.groups as grp where grp.legacy_dept_id = 'org') as org_group_id,
  (select grp.id from public.groups as grp where grp.legacy_dept_id = 'pr')  as pr_group_id,
  (select grp.id from public.groups as grp where grp.legacy_team_id = 'team-dept-519')  as dept_team_group_id,
  (select grp.id from public.groups as grp where grp.legacy_team_id = 'team-indep-519') as indep_team_group_id,
  (select grp.id from public.groups as grp where grp.legacy_project_id =
     (select project.id from public.projects as project where project.name = 'Group Origin Project 519')) as project_group_id,
  (select project.id from public.projects as project where project.name = 'Group Origin Project 519') as project_id;

-- ==================== 1-6: legacy-only inserts derive group_id ====================

insert into public.tasks (title, difficulty, dept_id) values ('GOS Task Dept 519', 1, 'edu');
select is(
  (select group_id from public.tasks where title = 'GOS Task Dept 519'),
  (select edu_group_id from fx),
  'a Department-origin Task derives group_id from the mirrored Group');

insert into public.tasks (title, difficulty, team_id) values ('GOS Task DeptTeam 519', 1, 'team-dept-519');
select is(
  (select group_id from public.tasks where title = 'GOS Task DeptTeam 519'),
  (select dept_team_group_id from fx),
  'a Department-Team-origin Task derives group_id from the mirrored Group');

insert into public.completed_work_requests (requester_id, team_id, description)
  values ('51900000-0000-0000-0000-000000000001', 'team-indep-519', 'GOS Request IndepTeam 519');
select is(
  (select group_id from public.completed_work_requests where description = 'GOS Request IndepTeam 519'),
  (select indep_team_group_id from fx),
  'an Independent-Team-origin Request derives group_id from the mirrored Group');

insert into public.tasks (title, difficulty, project_id)
  select 'GOS Task Project 519', 1, project_id from fx;
select is(
  (select group_id from public.tasks where title = 'GOS Task Project 519'),
  (select project_group_id from fx),
  'a Project-origin Task derives group_id from the mirrored Group');

insert into public.events (title, type, scope, starts_at) values ('GOS Event Org 519', 'sedinta', 'org', now());
select is(
  (select group_id from public.events where title = 'GOS Event Org 519'),
  (select org_group_id from fx),
  'an org-scope Event derives group_id from the Organization Group');

insert into public.campaigns (department_id, name, created_by)
  values ('edu', 'GOS Campaign Dept 519', '51900000-0000-0000-0000-000000000001');
select is(
  (select group_id from public.campaigns where name = 'GOS Campaign Dept 519'),
  (select edu_group_id from fx),
  'a Department Campaign derives group_id from the mirrored Group');

-- ==================== 7-11: group_id-only inserts derive the legacy side ====================

insert into public.tasks (title, difficulty, group_id)
  select 'GOS Task GroupOnly 519', 1, project_group_id from fx;
select ok(
  (select dept_id is null and team_id is null and project_id = (select project_id from fx)
     from public.tasks where title = 'GOS Task GroupOnly 519'),
  'a group_id-only Task (Project Group) derives the legacy triple (project_id only) from the Group');

insert into public.campaigns (group_id, name, created_by)
  select edu_group_id, 'GOS Campaign GroupOnly 519', '51900000-0000-0000-0000-000000000001' from fx;
select is(
  (select department_id from public.campaigns where name = 'GOS Campaign GroupOnly 519'),
  'edu',
  'a group_id-only Campaign derives department_id from the mirrored Group');

insert into public.completed_work_requests (requester_id, group_id, description)
  select '51900000-0000-0000-0000-000000000001', dept_team_group_id, 'GOS Request GroupOnly 519' from fx;
select ok(
  (select team_id = 'team-dept-519' and dept_id is null and project_id is null
     from public.completed_work_requests where description = 'GOS Request GroupOnly 519'),
  'a group_id-only Request (Department-Team Group) derives the legacy triple (team_id only) from the Group');

insert into public.events (title, type, group_id, starts_at)
  select 'GOS Event GroupOnly Dept 519', 'sedinta', edu_group_id, now() from fx;
select ok(
  (select scope = 'dept' and dept_id = 'edu' and team_id is null and project_id is null
     from public.events where title = 'GOS Event GroupOnly Dept 519'),
  'a group_id-only Event (Department Group) derives scope=dept and dept_id from the Group');

insert into public.events (title, type, group_id, starts_at)
  select 'GOS Event GroupOnly IndepTeam 519', 'sedinta', indep_team_group_id, now() from fx;
select ok(
  (select scope = 'team' and team_id = 'team-indep-519' and dept_id is null and project_id is null
     from public.events where title = 'GOS Event GroupOnly IndepTeam 519'),
  'the Independent-Team Event gets scope=team with dept_id null -- proves events_scope_fields_ck was relaxed, not just the trigger');

-- ==================== 12-15: both sides consistent -> lives ====================

select lives_ok(
  format($$ insert into public.tasks (title, difficulty, dept_id, group_id)
     values ('GOS Task Consistent 519', 1, 'edu', %s) $$, (select edu_group_id from fx)),
  'a Task with both sides consistent (Department) lives');

select lives_ok(
  format($$ insert into public.events (title, type, scope, dept_id, group_id, starts_at)
     values ('GOS Event Consistent 519', 'sedinta', 'dept', 'edu', %s, now()) $$, (select edu_group_id from fx)),
  'an Event with both sides consistent (Department) lives');

select lives_ok(
  format($$ insert into public.campaigns (department_id, group_id, name, created_by)
     values ('edu', %s, 'GOS Campaign Consistent 519', '51900000-0000-0000-0000-000000000001') $$,
    (select edu_group_id from fx)),
  'a Campaign with both sides consistent (Department) lives');

select lives_ok(
  format($$ insert into public.completed_work_requests (requester_id, dept_id, group_id, description)
     values ('51900000-0000-0000-0000-000000000001', 'edu', %s, 'GOS Request Consistent 519') $$,
    (select edu_group_id from fx)),
  'a Request with both sides consistent (Department) lives');

-- ==================== 16-19: both sides inconsistent -> throws mismatch ====================

select throws_ok(
  format($$ insert into public.tasks (title, difficulty, dept_id, group_id)
     values ('GOS Task Mismatch 519', 1, 'edu', %s) $$, (select project_group_id from fx)),
  '23514', 'task_group_origin_mismatch',
  'a Task with inconsistent legacy/Group sides is rejected');

select throws_ok(
  format($$ insert into public.events (title, type, scope, dept_id, group_id, starts_at)
     values ('GOS Event Mismatch 519', 'sedinta', 'dept', 'edu', %s, now()) $$, (select project_group_id from fx)),
  '23514', 'event_group_origin_mismatch',
  'an Event with inconsistent legacy/Group sides is rejected');

select throws_ok(
  format($$ insert into public.campaigns (department_id, group_id, name, created_by)
     values ('edu', %s, 'GOS Campaign Mismatch 519', '51900000-0000-0000-0000-000000000001') $$,
    (select project_group_id from fx)),
  '23514', 'campaign_group_origin_mismatch',
  'a Campaign with inconsistent legacy/Group sides is rejected');

select throws_ok(
  format($$ insert into public.completed_work_requests (requester_id, dept_id, group_id, description)
     values ('51900000-0000-0000-0000-000000000001', 'edu', %s, 'GOS Request Mismatch 519') $$,
    (select project_group_id from fx)),
  '23514', 'request_group_origin_mismatch',
  'a Request with inconsistent legacy/Group sides is rejected');

-- ==================== 20-22: Task UPDATE, both directions, then both-changed ====================

update public.tasks set dept_id = 'pr' where title = 'GOS Task Dept 519';
select is(
  (select group_id from public.tasks where title = 'GOS Task Dept 519'),
  (select pr_group_id from fx),
  'updating dept_id alone (legacy changed, Group unchanged) makes group_id follow');

update public.tasks set group_id = (select project_group_id from fx) where title = 'GOS Task Dept 519';
select ok(
  (select dept_id is null and team_id is null and project_id = (select project_id from fx)
     from public.tasks where title = 'GOS Task Dept 519'),
  'updating group_id alone (Group changed, legacy unchanged) makes the legacy triple follow');

select throws_ok(
  format($$ update public.tasks set group_id = %s, dept_id = 'edu' where title = 'GOS Task Dept 519' $$,
    (select pr_group_id from fx)),
  '23514', 'task_group_origin_mismatch',
  'updating both sides to inconsistent values in the same statement is rejected');

-- ==================== 23-24: unknown dept_id / no Origin at all ====================

select throws_ok(
  $$ insert into public.tasks (title, difficulty, dept_id) values ('GOS Task Unknown Dept 519', 1, 'unknown-dept-519') $$,
  '23514', 'task_group_required',
  'a Task naming an unrecognized Department is rejected by the trigger, before the FK could even answer');

select throws_ok(
  $$ insert into public.tasks (title, difficulty) values ('GOS Task No Origin 519', 1) $$,
  '23514', 'task_group_required',
  'a Task naming no Origin at all is rejected by the trigger, before tasks_exactly_one_origin_check can');

-- ==================== 25: a native Group with no legacy master ====================

insert into public.groups (name, category) values ('GOS Native Group 519', 'team');
select throws_ok(
  format($$ insert into public.tasks (title, difficulty, group_id)
     values ('GOS Task NativeGroup 519', 1, %s) $$,
    (select id from public.groups where name = 'GOS Native Group 519')),
  '23514', 'task_group_origin_unmapped',
  'a Task naming a native Group with no legacy master is rejected');

-- ==================== 26: a Team Event fills its Department when left null ====================

insert into public.events (title, type, scope, team_id, starts_at)
  values ('GOS Event TeamNoDept 519', 'sedinta', 'team', 'team-dept-519', now());
select is(
  (select dept_id from public.events where title = 'GOS Event TeamNoDept 519'),
  'edu',
  'a team-scope Event with dept_id left null gets it filled in from the Team''s own Department');

-- ==================== 27: a Team Event never has a WRONG dept_id overwritten ====================

select throws_ok(
  $$ insert into public.events (title, type, scope, dept_id, team_id, starts_at)
     values ('GOS Event TeamWrongDept 519', 'sedinta', 'team', 'pr', 'team-dept-519', now()) $$,
  '23503', 'insert or update on table "events" violates foreign key constraint "events_team_department_fkey"',
  'a team-scope Event with a WRONG dept_id is rejected by the FK -- the trigger never overwrites a caller-supplied value');

-- ==================== Review Finding 1: a Team/Project-Group Campaign survives a no-op touch ====================
-- department_id went nullable precisely so a Campaign whose Group is not a Department can
-- exist; for such a row v_from_legacy = group_id_for_legacy_origin(null, null, null) = null,
-- which the un-guarded mismatch branch treated as "distinct from" any real group_id on
-- every no-op UPDATE that merely mentions either column. Guarding on `department_id is not
-- null` is the fix; these two lives_ok calls are its regression coverage.

insert into public.campaigns (group_id, name, created_by)
  select dept_team_group_id, 'GOS Campaign TeamGroup 519', '51900000-0000-0000-0000-000000000001' from fx;
select is(
  (select department_id from public.campaigns where name = 'GOS Campaign TeamGroup 519'),
  null,
  'a Team-Group Campaign is created with department_id null (no _unmapped error)');
select lives_ok(
  $$ update public.campaigns set department_id = department_id where name = 'GOS Campaign TeamGroup 519' $$,
  'a Team-Group Campaign survives a no-op UPDATE of department_id (Finding 1)');
select lives_ok(
  $$ update public.campaigns set group_id = group_id where name = 'GOS Campaign TeamGroup 519' $$,
  'a Team-Group Campaign survives a no-op UPDATE of group_id (Finding 1)');

-- ==================== Review Finding 2: an inconsistent caller-supplied scope is refused, not silently rewritten ====================
-- The Group-side branch only tested dept_id/team_id/project_id for null, so an INSERT that
-- named both a Group and a scope that disagrees with it was silently rewritten instead of
-- refused -- the one legacy field exempt from the "both sides set inconsistently is
-- refused" contract the migration and function comments both state.

select throws_ok(
  format($$ insert into public.events (title, type, scope, group_id, starts_at)
     values ('GOS Event ScopeMismatch 519', 'sedinta', 'org', %s, now()) $$, (select edu_group_id from fx)),
  '23514', 'event_group_origin_mismatch',
  'an Event naming both a Group and an inconsistent caller-supplied scope is rejected, not silently rewritten (Finding 2)');

-- ==================== Review round 2: UPDATE-shape coverage per table ====================
-- Round 1's must-fix findings were both keyed on the wrong signal (Defect A: `new.scope`
-- carries the OLD value forward on an UPDATE that never mentioned it, indistinguishable
-- from caller intent; Defect B: comparing two *resolved* ids is blind to a Group whose own
-- legacy_* columns disagree in a way the resolver's precedence papers over) and every
-- existing assertion up to this point is about INSERT. These continue each table's
-- existing fixture row through the four UPDATE shapes -- only the Group side changed, only
-- the legacy side changed, both changed consistently, both changed inconsistently -- plus a
-- no-op touch of a legacy column and of group_id.

-- ---------- tasks (continuing 'GOS Task Dept 519', now project_id-origin/project_group) ----------
update public.tasks set group_id = (select dept_team_group_id from fx), team_id = 'team-dept-519', project_id = null
  where title = 'GOS Task Dept 519';
select ok(
  (select team_id = 'team-dept-519' and dept_id is null and project_id is null
     and group_id = (select dept_team_group_id from fx)
     from public.tasks where title = 'GOS Task Dept 519'),
  'tasks: updating group_id and the matching legacy field together, consistently, lives (review round 2)');

select lives_ok(
  $$ update public.tasks set team_id = team_id where title = 'GOS Task Dept 519' $$,
  'tasks: a no-op touch of team_id lives (review round 2)');
select lives_ok(
  $$ update public.tasks set group_id = group_id where title = 'GOS Task Dept 519' $$,
  'tasks: a no-op touch of group_id lives (review round 2)');

-- ---------- completed_work_requests (continuing 'GOS Request IndepTeam 519') ----------
update public.completed_work_requests set group_id = (select dept_team_group_id from fx)
  where description = 'GOS Request IndepTeam 519';
select ok(
  (select team_id = 'team-dept-519' and dept_id is null and project_id is null
     from public.completed_work_requests where description = 'GOS Request IndepTeam 519'),
  'requests: updating group_id alone lives and re-derives the legacy triple (review round 2)');

update public.completed_work_requests set team_id = null, dept_id = 'edu'
  where description = 'GOS Request IndepTeam 519';
select is(
  (select group_id from public.completed_work_requests where description = 'GOS Request IndepTeam 519'),
  (select edu_group_id from fx),
  'requests: updating the legacy triple alone lives and re-derives group_id (review round 2)');

select lives_ok(
  format($$ update public.completed_work_requests
       set group_id = %s, dept_id = null, project_id = %s
     where description = 'GOS Request IndepTeam 519' $$,
    (select project_group_id from fx), (select project_id from fx)),
  'requests: updating group_id and the matching legacy field together, consistently, lives (review round 2)');

select throws_ok(
  format($$ update public.completed_work_requests set group_id = %s, dept_id = 'pr'
     where description = 'GOS Request IndepTeam 519' $$,
    (select edu_group_id from fx)),
  '23514', 'request_group_origin_mismatch',
  'requests: updating group_id and a legacy field together to an inconsistent pair is rejected (review round 2)');

select lives_ok(
  $$ update public.completed_work_requests set project_id = project_id
     where description = 'GOS Request IndepTeam 519' $$,
  'requests: a no-op touch of project_id lives (review round 2)');
select lives_ok(
  $$ update public.completed_work_requests set group_id = group_id
     where description = 'GOS Request IndepTeam 519' $$,
  'requests: a no-op touch of group_id lives (review round 2)');

-- ---------- campaigns (continuing 'GOS Campaign TeamGroup 519' from Finding 1's coverage) ----------
update public.campaigns set group_id = (select edu_group_id from fx) where name = 'GOS Campaign TeamGroup 519';
select is(
  (select department_id from public.campaigns where name = 'GOS Campaign TeamGroup 519'),
  'edu',
  'campaigns: updating group_id alone (Department Group) lives and re-derives department_id (review round 2)');

update public.campaigns set department_id = 'pr' where name = 'GOS Campaign TeamGroup 519';
select is(
  (select group_id from public.campaigns where name = 'GOS Campaign TeamGroup 519'),
  (select pr_group_id from fx),
  'campaigns: updating department_id alone lives and re-derives group_id (review round 2)');

select lives_ok(
  format($$ update public.campaigns set group_id = %s, department_id = 'edu'
     where name = 'GOS Campaign TeamGroup 519' $$,
    (select edu_group_id from fx)),
  'campaigns: updating group_id and department_id together, consistently, lives (review round 2)');

-- Defect B repro: department_id cleared while group_id is pointed at a real Department
-- Group in the SAME statement. The round-1 fix (`department_id is not null`) skipped this
-- check outright since department_id is null on the written row; comparing against
-- v_grp.legacy_dept_id directly (the fix here) has no such blind spot.
select throws_ok(
  format($$ update public.campaigns set department_id = null, group_id = %s
     where name = 'GOS Campaign TeamGroup 519' $$,
    (select pr_group_id from fx)),
  '23514', 'campaign_group_origin_mismatch',
  'campaigns: clearing department_id while group_id still names a real Department Group is rejected (review round 2, Defect B)');

-- ---------- events (continuing 'GOS Event Consistent 519') ----------
-- Defect A repro: a legitimate Group move lands on a Group with a different derived
-- scope -- must live and re-derive, not raise, because the caller never touched scope.
update public.events set group_id = (select dept_team_group_id from fx)
  where title = 'GOS Event Consistent 519';
select ok(
  (select scope = 'team' and team_id = 'team-dept-519' and dept_id = 'edu'
     from public.events where title = 'GOS Event Consistent 519'),
  'events: updating group_id alone to a Group with a different derived scope lives and re-derives scope/dept_id/team_id (review round 2, Defect A)');

-- The companion case: scope alone changes, group_id stays put, and the two now disagree.
select throws_ok(
  $$ update public.events set scope = 'org' where title = 'GOS Event Consistent 519' $$,
  '23514', 'event_group_origin_mismatch',
  'events: updating scope alone to a value inconsistent with the unchanged group_id is rejected (review round 2, Defect B)');

select lives_ok(
  format($$ update public.events
       set group_id = %s, scope = 'project', project_id = %s, dept_id = null, team_id = null
     where title = 'GOS Event Consistent 519' $$,
    (select project_group_id from fx), (select project_id from fx)),
  'events: updating group_id and the matching legacy fields together, consistently, lives (review round 2)');

select throws_ok(
  format($$ update public.events set group_id = %s, scope = 'org'
     where title = 'GOS Event Consistent 519' $$,
    (select edu_group_id from fx)),
  '23514', 'event_group_origin_mismatch',
  'events: updating group_id and scope together to an inconsistent pair is rejected (review round 2)');

select lives_ok(
  $$ update public.events set scope = scope where title = 'GOS Event Consistent 519' $$,
  'events: a no-op touch of scope lives (review round 2)');
select lives_ok(
  $$ update public.events set group_id = group_id where title = 'GOS Event Consistent 519' $$,
  'events: a no-op touch of group_id lives (review round 2)');

-- ==================== 28-35: shape -- NOT NULL and FK on the four group_id columns ====================

select col_not_null('public', 'tasks', 'group_id', 'tasks.group_id is required');
select col_not_null('public', 'events', 'group_id', 'events.group_id is required');
select col_not_null('public', 'campaigns', 'group_id', 'campaigns.group_id is required');
select col_not_null('public', 'completed_work_requests', 'group_id', 'completed_work_requests.group_id is required');

select fk_ok('public', 'tasks', 'group_id', 'public', 'groups', 'id', 'tasks.group_id references groups');
select fk_ok('public', 'events', 'group_id', 'public', 'groups', 'id', 'events.group_id references groups');
select fk_ok('public', 'campaigns', 'group_id', 'public', 'groups', 'id', 'campaigns.group_id references groups');
select fk_ok('public', 'completed_work_requests', 'group_id', 'public', 'groups', 'id', 'completed_work_requests.group_id references groups');

-- ==================== 36-40: indexes ====================

select has_index('public', 'tasks', 'tasks_group_idx', 'tasks.group_id is indexed');
select has_index('public', 'events', 'events_group_idx', 'events.group_id is indexed');
-- campaigns has no standalone group_id index -- campaigns_group_name_uidx below already
-- serves every group_id lookup as its leading column (Note 9).
select has_index('public', 'completed_work_requests', 'completed_work_requests_group_idx',
  'completed_work_requests.group_id is indexed');
select matches(
  pg_get_indexdef('public.campaigns_group_name_uidx'::regclass),
  'UNIQUE.*campaigns_group_name_uidx.*\(group_id, lower\(name\)\)',
  'campaigns_group_name_uidx is a unique index on (group_id, lower(name))');

-- ==================== 41-42: the old campaign index and column are gone/nullable ====================

select hasnt_index('public', 'campaigns', 'campaigns_department_name_uidx',
  'campaigns_department_name_uidx is dropped -- (group_id, lower(name)) implies it for every Department Campaign');
select col_is_null('public', 'campaigns', 'department_id',
  'campaigns.department_id is nullable -- a Team or Project Group Campaign carries none');

-- ==================== 43: min_level 4 is retired ====================

select throws_ok(
  $$ insert into events (title, type, scope, starts_at, min_level)
     values ('GOS Event Level4 519', 'sedinta', 'org', now(), 4) $$,
  '23514', 'new row for relation "events" violates check constraint "events_min_level_ck"',
  'min_level 4 is retired (ADR-0009 Ranks)');

select lives_ok(
  $$ insert into events (title, type, scope, starts_at, min_level)
     values ('GOS Event Level5 519', 'sedinta', 'org', now(), 5) $$,
  'min_level 5 still lives');

-- ==================== 44: trigger firing order on tasks (derive before validate) ====================

select is(
  array(select tgname::text from pg_trigger
         where tgrelid = 'public.tasks'::regclass and not tgisinternal
         order by tgname),
  array['tasks_duplicate_provenance_guard', 'tasks_sync_group_origin',
        'tasks_validate_campaign', 'tasks_validate_hierarchy'],
  'tasks_sync_group_origin fires between the provenance guard and the Origin-dependent validators, deriving group_id/legacy fields before they run');

-- ==================== 45: tasks_with_overdue carries group_id ====================

select has_column('public', 'tasks_with_overdue', 'group_id',
  'tasks_with_overdue is recreated to carry group_id (the * expansion trap)');

select * from finish();
rollback;
