begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(12);

select has_function('private', 'set_updated_at', array[]::text[],
  'the shared timestamp trigger function exists');
select function_returns('private', 'set_updated_at', array[]::text[], 'trigger',
  'the timestamp helper is a trigger function');
select ok(
  not has_function_privilege('authenticated', 'private.set_updated_at()', 'execute'),
  'authenticated clients cannot call the private trigger helper');
select ok(
  exists (
    select 1 from pg_trigger
     where tgrelid = 'public.projects'::regclass
       and tgname = 'projects_set_updated_at'
       and not tgisinternal
  ),
  'projects use the shared timestamp trigger');
select ok(
  exists (
    select 1 from pg_trigger
     where tgrelid = 'public.campaigns'::regclass
       and tgname = 'campaigns_set_updated_at'
       and not tgisinternal
  ),
  'campaigns use the shared timestamp trigger');
-- #248 joined events to this list: update_event edits an Event row in place, so
-- conventions §7 requires the column and the shared trigger rather than a
-- command that sets the timestamp itself.
select ok(
  exists (
    select 1 from pg_trigger
     where tgrelid = 'public.events'::regclass
       and tgname = 'events_set_updated_at'
       and not tgisinternal
  ),
  'events use the shared timestamp trigger');

insert into auth.users (id, email) values
  ('a3680000-0000-0000-0000-000000000001', 'lead.368@test.local'),
  ('a3680000-0000-0000-0000-000000000002', 'creator.368@test.local');
insert into public.profiles (id, full_name, email, role) values
  ('a3680000-0000-0000-0000-000000000001', 'Lead 368', 'lead.368@test.local', 'responsabil'),
  ('a3680000-0000-0000-0000-000000000002', 'Creator 368', 'creator.368@test.local', 'bc');

insert into public.projects (
  id, name, leader_id, created_by, created_at, updated_at
) overriding system value values (
  368001, 'Project timestamp fixture',
  'a3680000-0000-0000-0000-000000000001',
  'a3680000-0000-0000-0000-000000000002',
  now() - interval '2 days', now() - interval '1 day'
);
-- #586: materialize this suite's legacy setup as rolled-back Group fixtures.
select pg_temp.materialize_legacy_groups();

insert into public.campaigns (
  id, group_id, name, created_by, created_at, updated_at
) overriding system value values (
  368001, pg_temp.dept_group('edu'), 'Campaign timestamp fixture',
  'a3680000-0000-0000-0000-000000000002',
  now() - interval '2 days', now() - interval '1 day'
);

update public.projects
   set name = 'Updated project fixture',
       updated_at = '2000-01-01 00:00:00+00'
 where id = 368001;
update public.campaigns
   set name = 'Updated campaign fixture',
       updated_at = '2000-01-01 00:00:00+00'
 where id = 368001;

select ok(
  (select updated_at > now() - interval '1 minute' from public.projects where id = 368001),
  'an arbitrary project update refreshes updated_at');
select ok(
  (select updated_at > now() - interval '1 minute' from public.campaigns where id = 368001),
  'an arbitrary campaign update refreshes updated_at');

insert into public.events (title, type, group_id, starts_at)
values ('Timestamp fixture', 'eveniment', pg_temp.dept_group('org'), now());
select ok(
  (select created_at is not null from public.events where title = 'Timestamp fixture'),
  'new events receive created_at automatically');

update public.events
   set location = 'Sala fixture',
       updated_at = '2000-01-01 00:00:00+00'
 where title = 'Timestamp fixture';
select ok(
  (select updated_at > now() - interval '1 minute' from public.events where title = 'Timestamp fixture'),
  'an arbitrary event update refreshes updated_at');

select ok(
  (select gm.created_at is not null
     from public.group_members gm
     join public.groups g on g.id = gm.group_id
    where g.name = 'Festivalul Studențesc 2026'
      and g.created_by = 'd0000000-0000-0000-0000-000000000007'
      and gm.member_id = 'd0000000-0000-0000-0000-000000000005'),
  'command-appointed demo Group Managers receive created_at automatically');

select ok(
  not has_table_privilege('authenticated', 'public.projects', 'update')
  and not has_table_privilege('authenticated', 'public.campaigns', 'update'),
  'the migration does not broaden client update privileges');

select * from finish();
rollback;
