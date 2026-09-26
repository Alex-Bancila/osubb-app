-- events_campaign.test.sql — #691: events.campaign_id and its validity trigger
-- (ADR-0008 amended 2026-09-23, ruling R14). An Event may carry at most one
-- Campaign, and only one owned by the Event's Group or a Group above it on its
-- path; a newly attached Campaign must be active; a Campaign that goes
-- inactive after it was attached is preserved. The mirror of
-- tasks_campaign.test.sql. The commands' PT400 mapping is pinned in
-- create_event.test.sql / update_event.test.sql; this suite writes the rows
-- directly as the table owner so the trigger itself is what is under test.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(20);

insert into auth.users (id, email) values
  ('69100000-0000-0000-0000-000000000001', 'campaign-actor-691@test.local');
insert into public.profiles (id, full_name, email, role, status) values
  ('69100000-0000-0000-0000-000000000001', 'Campaign Actor 691',
   'campaign-actor-691@test.local', 'bc', 'activ');

-- OD9 fixture exception: native Groups, rolled back with the suite.
-- Root A has two children (siblings); Root B is another root.
insert into public.groups (name, category) values
  ('Root A #691', 'team'), ('Root B #691', 'team');
insert into public.groups (name, category, parent_id) values
  ('Child A1 #691', 'team', (select id from public.groups where name = 'Root A #691')),
  ('Child A2 #691', 'team', (select id from public.groups where name = 'Root A #691'));

create function pg_temp.g691(p_name text) returns bigint language sql stable as $$
  select id from public.groups where name = p_name || ' #691'
$$;
create function pg_temp.c691(p_name text) returns bigint language sql stable as $$
  select id from public.campaigns where name = p_name || ' #691'
$$;

insert into public.campaigns (group_id, name, is_active, created_by) values
  (pg_temp.g691('Root A'),   'Root A campaign #691',   true,  '69100000-0000-0000-0000-000000000001'),
  (pg_temp.g691('Child A1'), 'Child A1 campaign #691', true,  '69100000-0000-0000-0000-000000000001'),
  (pg_temp.g691('Child A2'), 'Child A2 campaign #691', true,  '69100000-0000-0000-0000-000000000001'),
  (pg_temp.g691('Root B'),   'Root B campaign #691',   true,  '69100000-0000-0000-0000-000000000001'),
  (pg_temp.g691('Root A'),   'Inactive campaign #691', false, '69100000-0000-0000-0000-000000000001'),
  (pg_temp.g691('Root A'),   'Later campaign #691',    true,  '69100000-0000-0000-0000-000000000001');

create function pg_temp.insert_event(p_title text, p_group text, p_campaign text) returns void
language sql as $$
  insert into public.events (title, type, group_id, starts_at, created_by, campaign_id)
  values (p_title, 'sedinta', pg_temp.g691(p_group), now() + interval '1 day',
          '69100000-0000-0000-0000-000000000001', pg_temp.c691(p_campaign))
$$;

-- ==================== Schema ====================
select has_column('public', 'events', 'campaign_id', 'Events expose a Campaign reference');
select col_is_null('public', 'events', 'campaign_id', 'an Event''s Campaign is optional');
select fk_ok('public', 'events', 'campaign_id', 'public', 'campaigns', 'id',
  'Event Campaigns reference the campaigns table');
select has_index('public', 'events', 'events_campaign_idx', 'Event Campaign lookups are indexed');
select has_trigger('public', 'events', 'events_validate_campaign',
  'the Campaign rule is a trigger, so it binds every write path');

-- ==================== Path rule ====================
select lives_ok($$ select pg_temp.insert_event('No campaign 691', 'Child A1', null) $$,
  'an Event with no Campaign is unaffected');
select lives_ok($$ select pg_temp.insert_event('Own campaign 691', 'Child A1', 'Child A1 campaign') $$,
  'an Event accepts its own Group''s Campaign');
select lives_ok($$ select pg_temp.insert_event('Ancestor campaign 691', 'Child A1', 'Root A campaign') $$,
  'an Event accepts an ancestor Group''s Campaign');
select throws_ok($$ select pg_temp.insert_event('Sibling campaign 691', 'Child A1', 'Child A2 campaign') $$,
  '23514', 'event_campaign_origin_mismatch',
  'an Event rejects a sibling Group''s Campaign');
select throws_ok($$ select pg_temp.insert_event('Other root campaign 691', 'Child A1', 'Root B campaign') $$,
  '23514', 'event_campaign_origin_mismatch',
  'an Event rejects another root''s Campaign');
select throws_ok($$ select pg_temp.insert_event('Descendant campaign 691', 'Root A', 'Child A1 campaign') $$,
  '23514', 'event_campaign_origin_mismatch',
  'an Event rejects a Campaign owned below its Group -- the path runs upward only');
select throws_ok(
  $$ update public.events set group_id = pg_temp.g691('Root B') where title = 'Ancestor campaign 691' $$,
  '23514', 'event_campaign_origin_mismatch',
  'a Group-only UPDATE while a Campaign is set revalidates and is rejected (group_id is in the trigger''s of list)');
select throws_ok(
  $$ update public.events set campaign_id = pg_temp.c691('Root B campaign') where title = 'No campaign 691' $$,
  '23514', 'event_campaign_origin_mismatch',
  'attaching a Campaign to an existing Event is judged the same way');

-- ==================== Active rule ====================
select throws_ok($$ select pg_temp.insert_event('Inactive campaign 691', 'Child A1', 'Inactive campaign') $$,
  '23514', 'event_campaign_inactive',
  'an Event rejects a newly attached inactive Campaign');
select throws_ok(
  $$ update public.events set campaign_id = pg_temp.c691('Inactive campaign') where title = 'No campaign 691' $$,
  '23514', 'event_campaign_inactive',
  'attaching an inactive Campaign by UPDATE is rejected too');
select lives_ok($$ select pg_temp.insert_event('Later campaign 691', 'Child A1', 'Later campaign') $$,
  'an Event accepts an active Campaign');

update public.campaigns set is_active = false where name = 'Later campaign #691';

select lives_ok(
  $$ update public.events set campaign_id = campaign_id, title = 'Later campaign 691 (edited)'
      where title = 'Later campaign 691' $$,
  'an Event keeps a Campaign deactivated afterwards when the write sends it back unchanged');
select lives_ok(
  $$ update public.events set group_id = pg_temp.g691('Root A') where title = 'Later campaign 691 (edited)' $$,
  'a Group move within the Campaign''s path keeps a now-inactive Campaign');
select is(
  (select campaign_id from public.events where title = 'Later campaign 691 (edited)'),
  pg_temp.c691('Later campaign'),
  'the now-inactive Campaign reference is preserved, not cleared');
select is(
  (select campaign_id from public.events where title = 'Own campaign 691'),
  pg_temp.c691('Child A1 campaign'),
  'an accepted Campaign is stored on the Event');

select * from finish();
rollback;
