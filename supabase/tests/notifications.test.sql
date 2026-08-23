-- notifications.test.sql — Epic 1.6a: in-app notifications schema.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(10);

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

select * from finish();
rollback;
