-- Security pass 2026-09-27 (backend findings M1 + L2): an Announcement's
-- author and date are the server's, and a read receipt needs a readable
-- Announcement. Migration 20260927160000_announcement_authorship.sql.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(15);
truncate announcements, announcement_reads cascade;

-- Personas (prefix a1): 01 EDU Manager, 02 PR Member (outside EDU),
-- 03 BC without a Group Role, 04 the Moderator.
insert into auth.users(id,email) values
('a1000000-0000-0000-0000-000000000001','annauth-manager@test.local'),
('a1000000-0000-0000-0000-000000000002','annauth-outsider@test.local'),
('a1000000-0000-0000-0000-000000000003','annauth-bc@test.local'),
('a1000000-0000-0000-0000-000000000004','annauth-mod@test.local');
insert into profiles(id,full_name,email,role) values
('a1000000-0000-0000-0000-000000000001','Manager','annauth-manager@test.local','voluntar'),
('a1000000-0000-0000-0000-000000000002','Outsider','annauth-outsider@test.local','voluntar'),
('a1000000-0000-0000-0000-000000000003','BC','annauth-bc@test.local','bc'),
('a1000000-0000-0000-0000-000000000004','Moderator','annauth-mod@test.local','moderator');
insert into group_members(group_id,member_id,group_role)
select id,'a1000000-0000-0000-0000-000000000001'::uuid,'manager' from groups where name='Educațional'
union all select id,'a1000000-0000-0000-0000-000000000002'::uuid,'member' from groups where name='Imagine & PR';

-- ==================== M1: insert ====================
select pg_temp.test_login_leadership('a1000000-0000-0000-0000-000000000001');
select lives_ok($$insert into announcements(title,body,group_id,audience,created_by,published_at)
select 'Forged #M1','Posted as the Moderator.',id,'local',
       'a1000000-0000-0000-0000-000000000004','2020-01-01 00:00+00'
  from groups where name='Educațional'$$,
'a Manager''s insert naming the Moderator as author is accepted -- and rewritten, not trusted');
select lives_ok($$insert into announcements(title,body,group_id,audience,published_at)
select 'Future #M1','Forward-dated.',id,'org','2099-01-01 00:00+00'
  from groups where name='Educațional'$$,
'a Manager''s forward-dated insert is accepted -- and restamped');
reset role;

select is((select created_by from announcements where title='Forged #M1'),
  'a1000000-0000-0000-0000-000000000001'::uuid,
  'created_by is the caller, never the Member the client named');
select is((select published_at from announcements where title='Forged #M1'), now(),
  'a backdated published_at is replaced by the server''s now()');
select is((select published_at from announcements where title='Future #M1'), now(),
  'a forward-dated published_at is replaced by the server''s now(), so it cannot sit on top of the feed');
select hasnt_column('public', 'announcements', 'author',
  '#936: there is no free-text author byline at all -- the author is created_by');

-- The readers list follows the stored author: the Manager is the author.
select pg_temp.test_login_leadership('a1000000-0000-0000-0000-000000000001');
select lives_ok($$select * from announcement_readers((select id from announcements where title='Forged #M1'))$$,
  'the real author reads the readers list of their Announcement');
reset role;

-- ==================== M1: update ====================
select pg_temp.test_login_leadership('a1000000-0000-0000-0000-000000000001');
update announcements
   set created_by = 'a1000000-0000-0000-0000-000000000004',
       published_at = '2099-01-01 00:00+00',
       title = 'Forged #M1 edited'
 where title = 'Forged #M1';
reset role;
select results_eq(
  $$select created_by, published_at from announcements where title='Forged #M1 edited'$$,
  $$values ('a1000000-0000-0000-0000-000000000001'::uuid, now())$$,
  'an update may change the text but keeps created_by and published_at as they were');

select pg_temp.test_login_leadership('a1000000-0000-0000-0000-000000000003');
update announcements set pinned = true where title = 'Future #M1';
reset role;
select results_eq($$select pinned, created_by from announcements where title='Future #M1'$$,
  $$values (true, 'a1000000-0000-0000-0000-000000000001'::uuid)$$,
  'a BC still edits someone else''s Announcement, and its author stays the original one');

-- ==================== M1: writes with no signed-in caller ====================
select pg_temp.test_clear_jwt();
insert into announcements(title,body,group_id,audience,created_by,published_at)
select 'Fixture #M1','Seed.',id,'org','a1000000-0000-0000-0000-000000000004','2026-09-01 10:00+00'
  from groups where is_organization;
select results_eq($$select created_by, published_at from announcements where title='Fixture #M1'$$,
  $$values ('a1000000-0000-0000-0000-000000000004'::uuid, '2026-09-01 10:00+00'::timestamptz)$$,
  'a write with no auth.uid() (seed, migrations) keeps its fixture author and date');

-- ==================== L2: read receipts ====================
create temp table annauth as
select (select id from announcements where title='Forged #M1 edited') as edu_local,
       (select id from announcements where title='Future #M1') as edu_org,
       (select max(id) + 1000 from announcements) as missing;
grant select on annauth to authenticated;

select pg_temp.test_login_leadership('a1000000-0000-0000-0000-000000000002');
select is((select count(*) from announcements where id = (select edu_local from annauth)), 0::bigint,
  'precondition: the outsider cannot read the local EDU Announcement');
select throws_ok($$insert into announcement_reads(announcement_id,member_id)
select edu_local,'a1000000-0000-0000-0000-000000000002' from annauth$$,
'42501',null,'a Member cannot mark read an Announcement they cannot see');
select throws_ok($$insert into announcement_reads(announcement_id,member_id)
select missing,'a1000000-0000-0000-0000-000000000002' from annauth$$,
'42501',null,'an unknown id is refused by the policy (42501), not by the foreign key -- no existence oracle');
select lives_ok($$insert into announcement_reads(announcement_id,member_id)
select edu_org,'a1000000-0000-0000-0000-000000000002' from annauth$$,
'the same Member marks read an org Announcement they can see');
reset role;
select is((select count(*) from announcement_reads where member_id='a1000000-0000-0000-0000-000000000002'), 1::bigint,
  'only the readable Announcement holds the outsider''s read receipt');

select * from finish();
rollback;
