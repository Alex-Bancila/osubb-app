begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(20);

-- #314: tasks.campaign_id with origin consistency (ADR-0007 Campaigns). A
-- Task may carry at most one Campaign, and only when its Origin is that
-- Group or any descendant Group (ADR-0009). Fixtures reuse
-- reference-data Teams already in the seeded schema: t-recruti (Department
-- Team of edu) and t-logistica (Independent Team).

insert into auth.users (id, email) values
  ('31400000-0000-0000-0000-000000000001', 'campaign-actor-314@test.local');
insert into public.profiles (id, full_name, email, role, status) values
  ('31400000-0000-0000-0000-000000000001', 'Campaign Actor 314',
   'campaign-actor-314@test.local', 'responsabil', 'activ');

insert into public.projects (name, status, leader_id, created_by) values
  ('Origin Project 314', 'active',
   '31400000-0000-0000-0000-000000000001',
   '31400000-0000-0000-0000-000000000001');
-- #586: materialize this suite's legacy setup as rolled-back Group fixtures.
select pg_temp.materialize_legacy_groups();


insert into public.campaigns (group_id, name, is_active, created_by) values
  (pg_temp.dept_group('edu'), 'Campaign Edu 314', true, '31400000-0000-0000-0000-000000000001'),
  (pg_temp.dept_group('pr'), 'Campaign Pr 314', true, '31400000-0000-0000-0000-000000000001'),
  (pg_temp.dept_group('edu'), 'Campaign Edu Inactive 314', false, '31400000-0000-0000-0000-000000000001'),
  (pg_temp.dept_group('edu'), 'Campaign Edu Deactivate Later 314', true, '31400000-0000-0000-0000-000000000001');

select has_column('public', 'tasks', 'campaign_id',
  'Tasks expose a Campaign reference');
select fk_ok('public', 'tasks', 'campaign_id', 'public', 'campaigns', 'id',
  'Task Campaigns reference the campaigns table');
select has_index('public', 'tasks', 'tasks_campaign_idx',
  'Campaign lookups are indexed');

select lives_ok(
  $$ insert into public.tasks (title, difficulty, group_id)
     values ('No campaign task 314', 1, pg_temp.dept_group('edu')) $$,
  'a Task with no Campaign is unaffected');

select lives_ok(
  format($$ insert into public.tasks (title, difficulty, group_id, campaign_id)
            values ('Dept campaign task 314', 1, pg_temp.dept_group('edu'), %L) $$,
    (select id from public.campaigns where name = 'Campaign Edu 314')),
  'a Department Task accepts a Campaign of the same Department');

select lives_ok(
  format($$ insert into public.tasks (title, difficulty, group_id, campaign_id)
            values ('Dept-team campaign task 314', 1, pg_temp.team_group('t-recruti'), %L) $$,
    (select id from public.campaigns where name = 'Campaign Edu 314')),
  'a Department-Team Task accepts its parent Department''s Campaign');

select throws_ok(
  format($$ insert into public.tasks (title, difficulty, group_id, campaign_id)
            values ('Cross-department campaign task 314', 1, pg_temp.dept_group('edu'), %L) $$,
    (select id from public.campaigns where name = 'Campaign Pr 314')),
  '23514', 'task_campaign_origin_mismatch',
  'a Department Task rejects another Department''s Campaign');

select throws_ok(
  format($$ insert into public.tasks (title, difficulty, group_id, campaign_id)
            select 'Project campaign task 314', 1, pg_temp.project_group(id), %L
              from public.projects where name = 'Origin Project 314' $$,
    (select id from public.campaigns where name = 'Campaign Edu 314')),
  '23514', 'task_campaign_origin_mismatch',
  'a Project Task rejects an unrelated Department Campaign');

select throws_ok(
  format($$ insert into public.tasks (title, difficulty, group_id, campaign_id)
            values ('Independent-team campaign task 314', 1, pg_temp.team_group('t-logistica'), %L) $$,
    (select id from public.campaigns where name = 'Campaign Edu 314')),
  '23514', 'task_campaign_origin_mismatch',
  'an Independent-Team Task rejects any Campaign');

select throws_ok(
  $$ update public.tasks set group_id = pg_temp.dept_group('pr')
      where title = 'Dept campaign task 314' $$,
  '23514', 'task_campaign_origin_mismatch',
  'a Group-only UPDATE while a Campaign is set re-validates and is rejected (#579: group_id is in the trigger''s of list)');

select throws_ok(
  format($$ insert into public.tasks (title, difficulty, group_id, campaign_id)
            values ('Inactive campaign task 314', 1, pg_temp.dept_group('edu'), %L) $$,
    (select id from public.campaigns where name = 'Campaign Edu Inactive 314')),
  '23514', 'task_campaign_inactive',
  'a Task rejects a newly set inactive Campaign');

select lives_ok(
  format($$ insert into public.tasks (title, difficulty, group_id, campaign_id)
            values ('Deactivate later task 314', 1, pg_temp.dept_group('edu'), %L) $$,
    (select id from public.campaigns where name = 'Campaign Edu Deactivate Later 314')),
  'a Task accepts an active Campaign at creation');

update public.campaigns set is_active = false
 where name = 'Campaign Edu Deactivate Later 314';

select lives_ok(
  $$ update public.tasks set title = 'Deactivate later task 314 (edited)'
      where title = 'Deactivate later task 314' $$,
  'a Task keeps a Campaign that is deactivated afterward; unrelated edits still succeed');

select is(
  (select campaign_id from public.tasks where title = 'Deactivate later task 314 (edited)'),
  (select id from public.campaigns where name = 'Campaign Edu Deactivate Later 314'),
  'the now-inactive Campaign reference is preserved, not cleared');

-- Carve-out proof (house rule 5): an origin edit with an inactive campaign.
-- The "deactivate later" case above edits title (does not fire trigger at all).
-- This case creates a fresh campaign, a task with it, deactivates the campaign,
-- then updates the origin column (group_id) that IS in the trigger's `of` list —
-- must live_ok because campaign_id is not changing (carve-out applies).
insert into public.campaigns (group_id, name, is_active, created_by) values
  (pg_temp.dept_group('edu'), 'Campaign Edu Carve-out 314', true, '31400000-0000-0000-0000-000000000001');

insert into public.tasks (title, difficulty, group_id, campaign_id)
  select 'Carve-out origin edit 314', 1, pg_temp.dept_group('edu'),
    (select id from public.campaigns where name = 'Campaign Edu Carve-out 314');

update public.campaigns set is_active = false
 where name = 'Campaign Edu Carve-out 314';

select lives_ok(
  $$ update public.tasks set group_id = group_id where title = 'Carve-out origin edit 314' $$,
  'an origin edit (group_id) keeps a now-inactive Campaign; carve-out fires (house rule 5)');

select is(
  (select campaign_id from public.tasks where title = 'Carve-out origin edit 314'),
  (select id from public.campaigns where name = 'Campaign Edu Carve-out 314'),
  'the (now-inactive) Campaign reference is preserved on origin edits, not cleared');

select is(
  (select campaign_id from public.tasks_with_overdue where title = 'Dept campaign task 314'),
  (select id from public.campaigns where name = 'Campaign Edu 314'),
  'campaign_id is visible through tasks_with_overdue');

insert into public.campaigns(group_id,name,created_by) select id,'Project Campaign 522','31400000-0000-0000-0000-000000000001'::uuid from public.groups where name='Origin Project 314';
select lives_ok($$insert into public.tasks(title,group_id,campaign_id) select 'Project own campaign 522',group_id,id from public.campaigns where name='Project Campaign 522'$$,'Project Task accepts its own Group Campaign');
insert into public.campaigns(group_id,name,created_by) select id,'Independent Campaign 522','31400000-0000-0000-0000-000000000001'::uuid from public.groups where legacy_team_id='t-logistica';
select lives_ok($$insert into public.tasks(title,group_id,campaign_id) select 'Independent own campaign 522',group_id,id from public.campaigns where name='Independent Campaign 522'$$,'Independent Team accepts its own Group Campaign');
select throws_ok($$update public.tasks set group_id=(select id from public.groups where legacy_dept_id='pr') where title='Dept campaign task 314'$$,'23514','task_campaign_origin_mismatch','Group-only updates revalidate Campaign ownership');
select * from finish();
rollback;
