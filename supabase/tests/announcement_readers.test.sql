-- #693: Announcement readers list (R15) and the caller's unread count.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(40);
truncate announcements, announcement_reads cascade;

-- Personas (prefix 693):
--   01 author (PR member, no Group Role on EDU)   02 ordinary EDU member
--   03 outsider (PR member)                       04 EDU Responsible
--   05 EDU Manager (ancestor of the Child Group)  07 Child Group member
--   08 BCE without a Group Role                   09 BC without a Group Role
--   10 Moderator (Automatic Membership below EDU) 11 inactive EDU member
insert into auth.users(id,email) values
('69300000-0000-0000-0000-000000000001','ann693-author@test.local'),
('69300000-0000-0000-0000-000000000002','ann693-member@test.local'),
('69300000-0000-0000-0000-000000000003','ann693-outsider@test.local'),
('69300000-0000-0000-0000-000000000004','ann693-resp@test.local'),
('69300000-0000-0000-0000-000000000005','ann693-manager@test.local'),
('69300000-0000-0000-0000-000000000007','ann693-child@test.local'),
('69300000-0000-0000-0000-000000000008','ann693-bce@test.local'),
('69300000-0000-0000-0000-000000000009','ann693-bc@test.local'),
('69300000-0000-0000-0000-000000000010','ann693-mod@test.local'),
('69300000-0000-0000-0000-000000000011','ann693-inactive@test.local');
insert into profiles(id,full_name,email,role) values
('69300000-0000-0000-0000-000000000001','Author','ann693-author@test.local','voluntar'),
('69300000-0000-0000-0000-000000000002','Member','ann693-member@test.local','voluntar'),
('69300000-0000-0000-0000-000000000003','Outsider','ann693-outsider@test.local','voluntar'),
('69300000-0000-0000-0000-000000000004','Responsible','ann693-resp@test.local','voluntar'),
('69300000-0000-0000-0000-000000000005','Manager','ann693-manager@test.local','voluntar'),
('69300000-0000-0000-0000-000000000007','Child','ann693-child@test.local','voluntar'),
('69300000-0000-0000-0000-000000000008','BCE','ann693-bce@test.local','bce'),
('69300000-0000-0000-0000-000000000009','BC','ann693-bc@test.local','bc'),
('69300000-0000-0000-0000-000000000010','Moderator','ann693-mod@test.local','moderator'),
('69300000-0000-0000-0000-000000000011','Inactive','ann693-inactive@test.local','voluntar');

insert into groups(name,category,parent_id,application_level)
values ('Child #693','team',(select id from groups where legacy_dept_id='edu'),0);
insert into groups(name,category,parent_id,min_level,automatic_membership)
values ('Automatic #693','team',(select id from groups where legacy_dept_id='edu'),9,true);

insert into group_members(group_id,member_id,group_role)
select id,'69300000-0000-0000-0000-000000000001'::uuid,'member' from groups where legacy_dept_id='pr'
union all select id,'69300000-0000-0000-0000-000000000002'::uuid,'member' from groups where legacy_dept_id='edu'
union all select id,'69300000-0000-0000-0000-000000000003'::uuid,'member' from groups where legacy_dept_id='pr'
union all select id,'69300000-0000-0000-0000-000000000004'::uuid,'responsible' from groups where legacy_dept_id='edu'
union all select id,'69300000-0000-0000-0000-000000000005'::uuid,'manager' from groups where legacy_dept_id='edu'
union all select id,'69300000-0000-0000-0000-000000000007'::uuid,'member' from groups where name='Child #693'
union all select id,'69300000-0000-0000-0000-000000000011'::uuid,'member' from groups where legacy_dept_id='edu';
update profiles set status='inactiv' where id='69300000-0000-0000-0000-000000000011';

insert into announcements(title,body,group_id,audience,created_by)
select 'EDU local #693','Local.',id,'local','69300000-0000-0000-0000-000000000001'::uuid
  from groups where legacy_dept_id='edu'
union all
select 'EDU org #693','All.',id,'org','69300000-0000-0000-0000-000000000001'::uuid
  from groups where legacy_dept_id='edu'
union all
select 'Child local #693','Child.',id,'local','69300000-0000-0000-0000-000000000004'::uuid
  from groups where name='Child #693'
union all
select 'PR local #693','PR.',id,'local','69300000-0000-0000-0000-000000000003'::uuid
  from groups where legacy_dept_id='pr';

create temp table ann693 as
select (select id from announcements where title='EDU local #693') as edu_local,
       (select id from announcements where title='EDU org #693') as edu_org,
       (select id from announcements where title='Child local #693') as child_local,
       (select id from announcements where title='PR local #693') as pr_local;
grant select on ann693 to authenticated, anon;

insert into announcement_reads(announcement_id,member_id,read_at) values
((select edu_local from ann693),'69300000-0000-0000-0000-000000000002','2026-09-01 10:00+00'),
((select edu_local from ann693),'69300000-0000-0000-0000-000000000007','2026-09-02 10:00+00'),
((select edu_org from ann693),'69300000-0000-0000-0000-000000000005','2026-09-03 10:00+00');

-- Expected Audiences, computed as owner from the same helper #68's fan-out calls
-- and, for org, straight from profiles so the helper is not graded by itself.
create temp table ann693_edu_audience as
select member_id from private.group_audience((select id from groups where legacy_dept_id='edu')) as a(member_id);
create temp table ann693_child_audience as
select member_id from private.group_audience((select id from groups where name='Child #693')) as a(member_id);
create temp table ann693_pr_audience as
select member_id from private.group_audience((select id from groups where legacy_dept_id='pr')) as a(member_id);
create temp table ann693_active as select id as member_id from profiles where status='activ';
grant select on ann693_edu_audience, ann693_child_audience, ann693_pr_audience, ann693_active to authenticated;

-- ==================== fixture sanity ====================
select ok(exists(select 1 from group_members gm join profiles p on p.id=gm.member_id
                  where gm.member_id='69300000-0000-0000-0000-000000000011' and p.status='inactiv'),
  'the inactive Member keeps an EDU roster row, so their absence is the filter, not a missing row');

-- ==================== anon ====================
set local role anon;
select throws_ok($$select * from announcement_readers((select edu_local from ann693))$$,
  '42501',null,'anon cannot execute announcement_readers');
select throws_ok($$select my_unread_announcements_count()$$,
  '42501',null,'anon cannot execute my_unread_announcements_count');
reset role;

-- ==================== claimless ====================
select pg_temp.test_clear_jwt(); set local role authenticated;
select throws_ok($$select * from announcement_readers((select edu_local from ann693))$$,
  'PT404','announcement_not_found','claimless caller gets announcement_not_found');
select is(my_unread_announcements_count(),0,'claimless caller has 0 unread');
reset role;

-- ==================== author ====================
select pg_temp.test_login_leadership('69300000-0000-0000-0000-000000000001');
select set_eq($$select member_id from announcement_readers((select edu_local from ann693))$$,
  $$select member_id from ann693_edu_audience$$,
  'author reads the full local Audience of the Origin');
select ok('69300000-0000-0000-0000-000000000007' in
  (select member_id from announcement_readers((select edu_local from ann693))),
  'a Child Group member is inside the parent''s local Audience');
select ok('69300000-0000-0000-0000-000000000010' in
  (select member_id from announcement_readers((select edu_local from ann693))),
  'an Automatic Membership member of a Group below the Origin is inside its local Audience');
select ok('69300000-0000-0000-0000-000000000011' not in
  (select member_id from announcement_readers((select edu_local from ann693))),
  'an inactive Member is never in the Audience');
select ok('69300000-0000-0000-0000-000000000003' not in
  (select member_id from announcement_readers((select edu_local from ann693))),
  'a Member outside the Origin is not in a local Audience');
select is((select read_at from announcement_readers((select edu_local from ann693))
            where member_id='69300000-0000-0000-0000-000000000002'),
  '2026-09-01 10:00+00'::timestamptz,'read_at reflects the Member''s announcement_reads row');
select is((select read_at from announcement_readers((select edu_local from ann693))
            where member_id='69300000-0000-0000-0000-000000000004'),
  null::timestamptz,'an unread recipient has read_at null');
select is((select member_id from announcement_readers((select edu_local from ann693)) limit 1),
  '69300000-0000-0000-0000-000000000007'::uuid,'newest read comes first');
select is((select count(*) from announcement_readers((select edu_local from ann693)) where read_at is not null),
  2::bigint,'"x" counts exactly the recipients who read it');
select set_eq($$select member_id from announcement_readers((select edu_org from ann693))$$,
  $$select member_id from ann693_active$$,
  'author reads an org Audience equal to every activ profile');
reset role;

-- ==================== ordinary audience member / outsider ====================
select pg_temp.test_login_leadership('69300000-0000-0000-0000-000000000002');
select throws_ok($$select * from announcement_readers((select edu_local from ann693))$$,
  'PT404','announcement_not_found','an ordinary audience member cannot read the list');
select throws_ok($$select * from announcement_readers((select edu_org from ann693))$$,
  'PT404','announcement_not_found','an ordinary member cannot read an org list');
reset role;

select pg_temp.test_login_leadership('69300000-0000-0000-0000-000000000003');
select throws_ok($$select * from announcement_readers((select edu_local from ann693))$$,
  'PT404','announcement_not_found','an outsider cannot read a local list');
reset role;

-- ==================== Origin Responsible ====================
select pg_temp.test_login_leadership('69300000-0000-0000-0000-000000000004');
select set_eq($$select member_id from announcement_readers((select edu_local from ann693))$$,
  $$select member_id from ann693_edu_audience$$,
  'the Origin Responsible reads the full local Audience');
select throws_ok($$select * from announcement_readers((select edu_org from ann693))$$,
  'PT404','announcement_not_found','a Group Role on the Origin does not open an org list (Responsible)');
reset role;

-- ==================== Origin / ancestor Manager ====================
select pg_temp.test_login_leadership('69300000-0000-0000-0000-000000000005');
select set_eq($$select member_id from announcement_readers((select edu_local from ann693))$$,
  $$select member_id from ann693_edu_audience$$,
  'the Origin Manager reads the full local Audience');
select set_eq($$select member_id from announcement_readers((select child_local from ann693))$$,
  $$select member_id from ann693_child_audience$$,
  'an ancestor''s Manager reads a Child Group''s local Audience');
select throws_ok($$select * from announcement_readers((select edu_org from ann693))$$,
  'PT404','announcement_not_found','an Origin Manager who is not the author cannot read an org list');
reset role;

-- ==================== BCE without a Group Role ====================
select pg_temp.test_login_leadership('69300000-0000-0000-0000-000000000008');
select throws_ok($$select * from announcement_readers((select edu_local from ann693))$$,
  'PT404','announcement_not_found','BCE rank alone does not open a local list');
select throws_ok($$select * from announcement_readers((select edu_org from ann693))$$,
  'PT404','announcement_not_found','BCE rank alone does not open an org list');
reset role;

-- ==================== BC / Moderator ====================
select pg_temp.test_login_leadership('69300000-0000-0000-0000-000000000009');
select set_eq($$select member_id from announcement_readers((select edu_local from ann693))$$,
  $$select member_id from ann693_edu_audience$$,
  'BC reads a local list without a Group Role');
select set_eq($$select member_id from announcement_readers((select edu_org from ann693))$$,
  $$select member_id from ann693_active$$,
  'BC reads an org list');
select throws_ok($$select * from announcement_readers(-1)$$,
  'PT404','announcement_not_found','a missing Announcement answers exactly like a hidden one');
reset role;

select pg_temp.test_login_leadership('69300000-0000-0000-0000-000000000010');
select set_eq($$select member_id from announcement_readers((select pr_local from ann693))$$,
  $$select member_id from ann693_pr_audience$$,
  'the Moderator reads a local list of a Group they have no Role in');
reset role;

-- ==================== inactive author ====================
update announcements set created_by='69300000-0000-0000-0000-000000000011'
 where id=(select child_local from ann693);
select pg_temp.test_login_leadership('69300000-0000-0000-0000-000000000011');
select throws_ok($$select * from announcement_readers((select child_local from ann693))$$,
  'PT404','announcement_not_found','an inactive author with stale claims cannot read the list');
reset role;
update announcements set created_by='69300000-0000-0000-0000-000000000004'
 where id=(select child_local from ann693);

-- ==================== my_unread_announcements_count ====================
-- Outsider (PR): may read EDU org and PR local, has read neither -> n = 2,
-- while four rows exist; the two local EDU/Child rows RLS hides never count.
select pg_temp.test_login_leadership('69300000-0000-0000-0000-000000000003');
select is(my_unread_announcements_count(),2,'n unread: every readable Announcement the Member has not read');
select is(my_unread_announcements_count(),(select count(*)::int from announcements),
  'the count equals the Announcements the caller may read when none is read');
reset role;
select is((select count(*) from announcements),4::bigint,'four Announcements exist, two hidden from the outsider');

-- EDU member: may read EDU local and EDU org, has read EDU local -> 1.
select pg_temp.test_login_leadership('69300000-0000-0000-0000-000000000002');
select is(my_unread_announcements_count(),1,'1 unread: readable minus read');
select is(my_unread_announcements_count(),
  (select count(*)::int from announcements)
  - (select count(*)::int from announcement_reads where member_id='69300000-0000-0000-0000-000000000002'),
  'the count equals readable Announcements minus the caller''s reads');
insert into announcement_reads(announcement_id,member_id)
values ((select edu_org from ann693),'69300000-0000-0000-0000-000000000002');
select is(my_unread_announcements_count(),0,'0 unread once every readable Announcement is read');
reset role;

-- A read row for an Announcement the caller cannot read never drives the count negative.
insert into announcement_reads(announcement_id,member_id)
values ((select pr_local from ann693),'69300000-0000-0000-0000-000000000002');
select pg_temp.test_login_leadership('69300000-0000-0000-0000-000000000002');
select is(my_unread_announcements_count(),0,'a read row on a hidden Announcement changes nothing');
reset role;

-- BC reads org and Automatic-free locals only through announcements_read; the
-- count follows the policy, not rank.
select pg_temp.test_login_leadership('69300000-0000-0000-0000-000000000009');
select is(my_unread_announcements_count(),1,'BC''s count follows announcements_read (org only), not rank');
reset role;

-- ==================== catalog ====================
select is((select prosecdef from pg_proc where oid='public.my_unread_announcements_count()'::regprocedure),
  false,'the unread count is security invoker, so announcements_read decides which rows count');
select is((select proconfig from pg_proc where oid='private.announcement_readers_impl(bigint)'::regprocedure),
  array['search_path=""'],'the readers body pins an empty search_path');

select * from finish();
rollback;
