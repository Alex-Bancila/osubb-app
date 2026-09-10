-- announcements.test.sql — Epic 1.5b: announcements feed + read receipts.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- ==================== Shape ====================
select has_table('public', 'announcements', 'announcements table exists');
select has_table('public', 'announcement_reads', 'announcement_reads table exists');

select ok(
  (select relrowsecurity from pg_class
    where relname = 'announcements' and relnamespace = 'public'::regnamespace),
  'RLS is enabled on announcements');
select ok(
  (select relrowsecurity from pg_class
    where relname = 'announcement_reads' and relnamespace = 'public'::regnamespace),
  'RLS is enabled on announcement_reads');

select has_index('public', 'announcements', 'announcements_published_idx',
  'the feed is indexed by publication date');
select has_index('public', 'announcement_reads', 'announcement_reads_member_idx',
  'read receipts are indexed by member (unread counter)');

-- ==================== Fixtures ====================
-- The demo seed fills these tables; the counts below are about this file's
-- rows. Cleared inside the transaction, which rolls back.
truncate announcements, announcement_reads cascade;

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-0000000000a1', 'andrei.ann@test.local');
insert into profiles (id, full_name, email, role) values
  ('a1000000-0000-0000-0000-0000000000a1', 'Andrei Test', 'andrei.ann@test.local', 'voluntar');

insert into announcements (title, body, priority, pinned)
  values ('Ședință extraordinară', 'Vineri, ora 18.', 'critical', true);
insert into announcements (title, body, dept_id)
  values ('Materiale EDU', 'Le găsiți în drive.', 'edu');
insert into announcements (title, body, form_label, form_url)
  values ('Feedback eveniment', 'Ne ajută mult.', 'Completează formularul',
          'https://forms.gle/exemplu');

-- ==================== Content rules ====================
select is((select count(*) from announcements), 3::bigint,
  'org-wide, department and form announcements all insert');
select is(
  (select dept_id from announcements where title = 'Ședință extraordinară'),
  null, 'a null dept means org-wide reach');
select is(
  (select priority from announcements where title = 'Materiale EDU'),
  'normal'::announce_priority, 'priority defaults to normal');

select throws_ok(
  $$ insert into announcements (title, body, form_label)
     values ('Buton mort', 'Fără link.', 'Completează formularul') $$,
  '23514', null, 'a form label without a URL is rejected (dead button)');

-- ==================== Read receipts: exactly once (AC) ====================
insert into announcement_reads (announcement_id, member_id)
  select id, 'a1000000-0000-0000-0000-0000000000a1'::uuid
    from announcements where title = 'Materiale EDU';

select throws_ok(
  $$ insert into announcement_reads (announcement_id, member_id)
     select id, 'a1000000-0000-0000-0000-0000000000a1'::uuid
       from announcements where title = 'Materiale EDU' $$,
  '23505', null, 'a member is marked as having read an announcement exactly once');

-- Deleting an announcement takes its receipts with it (no orphans).
delete from announcements where title = 'Materiale EDU';
select is((select count(*) from announcement_reads), 0::bigint,
  'read receipts cascade with their announcement');

select * from finish();
rollback;
