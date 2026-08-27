begin;
select plan(8);

-- 1. Create necessary deps (assume core schema exists)
insert into departments (id, name, short, color, kind) 
values ('edu', 'Educațional', 'EDU', '#000', 'internal')
on conflict (id) do nothing;

insert into teams (id, name, dept_id) 
values ('edu_team', 'Echipa EDU', 'edu')
on conflict (id) do nothing;

insert into events (id, title, type, scope, starts_at, dept_id) 
overriding system value
values (999, 'Existing event', 'sedinta', 'org', now(), null);

-- Level 2 member
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000002', 'voluntar@osubb.ro');
insert into profiles (id, full_name, email, role) values ('00000000-0000-0000-0000-000000000002', 'Voluntar Test', 'voluntar@osubb.ro', 'voluntar');

-- Level 4 member
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000004', 'bc@osubb.ro');
insert into profiles (id, full_name, email, role) values ('00000000-0000-0000-0000-000000000004', 'BC Test', 'bc@osubb.ro', 'bc');

-- Test Voluntar
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","app_metadata":{"member_role":"voluntar","member_level":2}}', true);

-- Voluntar can read existing event
select results_eq(
  'select id from events where id = 999',
  $$ values (999::bigint) $$,
  'Can read event as voluntar'
);

-- Voluntar CANNOT insert event
select throws_ok(
  $$ insert into events (title, type, scope, starts_at) values ('Test Voluntar', 'eveniment', 'org', now()) $$,
  'new row violates row-level security policy for table "events"',
  'Voluntar (level 2) cannot insert event'
);

-- Voluntar CANNOT update event (update applies 0 rows silently, verify title)
update events set title = 'Hacked' where id = 999;
select results_eq(
  'select title from events where id = 999',
  $$ values ('Existing event') $$,
  'Voluntar (level 2) cannot update event'
);

-- Test BC
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","app_metadata":{"member_role":"bc","member_level":4}}', true);

-- BC CAN insert event
select lives_ok(
  $$ insert into events (id, title, type, scope, starts_at, dept_id) overriding system value values (1000, 'BC Event', 'sedinta', 'dept', now(), 'edu') $$,
  'BC (level 4) can insert event'
);

-- BC CAN insert team event
select lives_ok(
  $$ insert into events (id, title, type, scope, starts_at, team_id) overriding system value values (1001, 'BC Team Event', 'sedinta', 'team', now(), 'edu_team') $$,
  'BC (level 4) can insert team event'
);

-- Verify events were inserted
select results_eq(
  'select id from events where id in (1000, 1001) order by id',
  $$ values (1000::bigint), (1001::bigint) $$,
  'BC inserted events are visible'
);

-- BC CAN update event
select lives_ok(
  $$ update events set title = 'Updated BC Event' where id = 1000 $$,
  'BC (level 4) can update event'
);

-- BC CAN delete event
select lives_ok(
  $$ delete from events where id = 1000 $$,
  'BC (level 4) can delete event'
);

select * from finish();
rollback;
