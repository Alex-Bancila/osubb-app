-- notifications.test.sql — Epic 1.6a: in-app notifications schema.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(34);

-- ==================== Shape ====================
select has_table('public', 'notifications', 'notifications table exists');
select ok(
  (select relrowsecurity from pg_class
    where relname = 'notifications' and relnamespace = 'public'::regnamespace),
  'RLS is enabled on notifications');
select has_index('public', 'notifications', 'notifications_member_created_idx',
  'the notification centre query is indexed (mine, newest first)');
select has_index('public', 'notifications', 'notifications_unread_idx',
  'the unread badge has its own partial index');

-- ==================== Fixtures ====================
-- The demo seed fills this table; the counts below are about this file's
-- rows. Cleared inside the transaction, which rolls back.
truncate notifications;

insert into auth.users (id, email) values
  ('a2000000-0000-0000-0000-0000000000a2', 'nadia.noti@test.local');
insert into profiles (id, full_name, email, role) values
  ('a2000000-0000-0000-0000-0000000000a2', 'Nadia Test', 'nadia.noti@test.local', 'voluntar');

-- ==================== A row targets one member with a kind (AC) ====================
insert into notifications (member_id, kind, title, body, link)
  values ('a2000000-0000-0000-0000-0000000000a2', 'task',
          'Task nou: Afiș eveniment', 'Deadline vineri.', '/tracker/1');
insert into notifications (member_id, kind, title, critical)
  values ('a2000000-0000-0000-0000-0000000000a2', 'announce',
          'Ședință extraordinară', true);

select is((select count(*) from notifications), 2::bigint,
  'notifications address a single member each');
select is(
  (select kind from notifications where title like 'Task nou%'),
  'task'::noti_kind, 'the kind is stored as noti_kind');
select is(
  (select read from notifications where title like 'Task nou%'),
  false, 'notifications start unread');
select is(
  (select critical from notifications where title like 'Task nou%'),
  false, 'notifications are non-critical unless said otherwise');

select throws_ok(
  $$ insert into notifications (member_id, kind, title)
     values ('a2000000-0000-0000-0000-0000000000a2', 'promovare', 'Kind inventat') $$,
  '22P02', null, 'an unknown kind is rejected by the enum');

-- Deleting a member takes their notifications with them (GDPR-friendly cascade).
delete from profiles where id = 'a2000000-0000-0000-0000-0000000000a2';
select is((select count(*) from notifications), 0::bigint,
  'notifications cascade when the member is deleted');

-- ==================== Self-only notification access (#65) ====================
insert into auth.users (id, email) values
  ('a0650000-0000-0000-0000-000000000001', 'bc.notifications@test.local'),
  ('a0650000-0000-0000-0000-000000000002', 'other.notifications@test.local'),
  ('a0650000-0000-0000-0000-000000000003', 'inactive.notifications@test.local'),
  ('a0650000-0000-0000-0000-000000000004', 'claimless.notifications@test.local');
insert into profiles (id, full_name, email, role, status) values
  ('a0650000-0000-0000-0000-000000000001', 'Notification BC', 'bc.notifications@test.local', 'bc', 'activ'),
  ('a0650000-0000-0000-0000-000000000002', 'Notification Recrut', 'other.notifications@test.local', 'recrut', 'activ'),
  ('a0650000-0000-0000-0000-000000000003', 'Notification Inactive', 'inactive.notifications@test.local', 'bc', 'inactiv'),
  ('a0650000-0000-0000-0000-000000000004', 'Notification Claimless', 'claimless.notifications@test.local', 'voluntar', 'activ');
insert into notifications (member_id, kind, title, body, critical, link) values
  ('a0650000-0000-0000-0000-000000000001', 'task', 'BC own Task', 'Keep this payload', true, '/tracker/65'),
  ('a0650000-0000-0000-0000-000000000002', 'announce', 'Other Member', null, false, null),
  ('a0650000-0000-0000-0000-000000000003', 'task', 'Inactive own Task', null, false, null),
  ('a0650000-0000-0000-0000-000000000004', 'task', 'Claimless own Task', null, false, null);

select policies_are('public', 'notifications',
  array['notifications_mark_read_self', 'notifications_read_self'],
  'notifications exposes only self-read and self-mark-read policies');
select is((select cmd from pg_policies where schemaname = 'public'
  and tablename = 'notifications' and policyname = 'notifications_mark_read_self'),
  'UPDATE', 'the mark-read policy applies only to UPDATE');
select ok(has_table_privilege('authenticated', 'notifications', 'select'),
  'authenticated receives notification SELECT');
select ok(has_column_privilege('authenticated', 'notifications', 'read', 'update'),
  'authenticated may update only the read marker');
select ok(not has_column_privilege('authenticated', 'notifications', 'member_id', 'update'),
  'the notification recipient is immutable to clients');
select ok(not has_column_privilege('authenticated', 'notifications', 'title', 'update'),
  'notification payload columns are immutable to clients');
select is((
  select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'notifications'
     and has_column_privilege('authenticated', 'public.notifications', column_name, 'update')
), array['read']::text[], 'read is the only client-updatable notification column');
select ok(not has_table_privilege('authenticated', 'notifications', 'insert')
  and not has_table_privilege('authenticated', 'notifications', 'delete'),
  'authenticated clients cannot insert or delete notifications');

-- BC suppresses broadcast task notifications at fan-out time. Read policy
-- deliberately keeps a task row that was addressed directly to this BC.
select pg_temp.test_login_leadership('a0650000-0000-0000-0000-000000000001');
select is((select count(*) from notifications), 1::bigint,
  'BC reads only their own notification');
select is((select title from notifications), 'BC own Task',
  'suppression never hides a BC own-task notification at read time');
update notifications set read = true where title = 'BC own Task';
select is((select read from notifications), true,
  'a member can mark their own notification read');
with changed as (
  update notifications set read = true where title = 'Other Member' returning 1
)
select is((select count(*) from changed), 0::bigint,
  'a member cannot mark another member notification read');
select throws_ok($$update notifications set title = 'Rewritten' where title = 'BC own Task'$$,
  '42501', null, 'a member cannot rewrite notification payload');
select throws_ok($$update notifications set member_id = 'a0650000-0000-0000-0000-000000000002'
  where title = 'BC own Task'$$, '42501', null,
  'a member cannot change a notification recipient');
select throws_ok($$insert into notifications (member_id, kind, title) values
  ('a0650000-0000-0000-0000-000000000001', 'task', 'Client forged')$$,
  '42501', null, 'a member cannot create a notification');
select throws_ok($$delete from notifications where title = 'BC own Task'$$,
  '42501', null, 'a member cannot delete their notification');
reset role;

select pg_temp.test_login_leadership('a0650000-0000-0000-0000-000000000002');
select is((select title from notifications), 'Other Member',
  'an active level-0 Recrut reads their own notification');
update notifications set read = true where title = 'Other Member';
select is((select read from notifications), true,
  'an active level-0 Recrut marks their own notification read');
reset role;

select pg_temp.test_login('a0650000-0000-0000-0000-000000000003',
  '{"member_role":"bc","member_level":6,"dept_ids":[],"team_ids":[]}'::jsonb);
select is((select count(*) from notifications), 0::bigint,
  'inactive recipient reads nothing despite stale leadership claims');
with changed as (update notifications set read = true returning 1)
select is((select count(*) from changed), 0::bigint,
  'inactive recipient cannot mark read despite stale claims');
reset role;

select pg_temp.test_login('a0650000-0000-0000-0000-000000000004',
  jsonb_build_object('provider', 'email'));
select is((select count(*) from notifications), 0::bigint,
  'claimless recipient cannot read their notification');
with changed as (update notifications set read = true returning 1)
select is((select count(*) from changed), 0::bigint,
  'claimless recipient cannot mark their notification read');
reset role;

set local role anon;
select throws_ok($$select count(*) from notifications$$, '42501', null,
  'anonymous callers cannot read notifications');
reset role;

set local role service_role;
select lives_ok($$insert into notifications (member_id, kind, title) values
  ('a0650000-0000-0000-0000-000000000002', 'announce', 'Trusted server')$$,
  'service_role retains trusted notification insertion');
reset role;

select * from finish();
rollback;
