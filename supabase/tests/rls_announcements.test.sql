-- #581: Group-scoped announcement policies and read receipts.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(28);
truncate announcements, announcement_reads cascade;

insert into auth.users(id,email) values
('f1000000-0000-0000-0000-0000000000f1','ann581-one@test.local'),
('f2000000-0000-0000-0000-0000000000f2','ann581-two@test.local'),
('f3000000-0000-0000-0000-0000000000f3','ann581-bce@test.local'),
('f4000000-0000-0000-0000-0000000000f4','ann581-resp@test.local'),
('f5000000-0000-0000-0000-0000000000f5','ann581-parent@test.local'),
('f6000000-0000-0000-0000-0000000000f6','ann581-bc@test.local'),
('f7000000-0000-0000-0000-0000000000f7','ann581-inactive@test.local');
insert into profiles(id,full_name,email,role) values
('f1000000-0000-0000-0000-0000000000f1','One','ann581-one@test.local','voluntar'),
('f2000000-0000-0000-0000-0000000000f2','Two','ann581-two@test.local','voluntar'),
('f3000000-0000-0000-0000-0000000000f3','BCE','ann581-bce@test.local','bce'),
('f4000000-0000-0000-0000-0000000000f4','Responsible','ann581-resp@test.local','voluntar'),
('f5000000-0000-0000-0000-0000000000f5','Parent Manager','ann581-parent@test.local','voluntar');
insert into profiles(id,full_name,email,role,status) values
('f6000000-0000-0000-0000-0000000000f6','BC no roster','ann581-bc@test.local','bc','activ'),
('f7000000-0000-0000-0000-0000000000f7','Inactive','ann581-inactive@test.local','voluntar','inactiv');
insert into group_members(group_id,member_id,group_role)
select id,'f1000000-0000-0000-0000-0000000000f1'::uuid,'member' from groups where legacy_dept_id='edu'
union all select id,'f2000000-0000-0000-0000-0000000000f2'::uuid,'member' from groups where legacy_dept_id='pr'
union all select id,'f4000000-0000-0000-0000-0000000000f4'::uuid,'responsible' from groups where legacy_dept_id='edu'
union all select id,'f5000000-0000-0000-0000-0000000000f5'::uuid,'manager' from groups where legacy_dept_id='edu';
insert into groups(name,category,parent_id,application_level)
values ('Child #581','team',(select id from groups where legacy_dept_id='edu'),0);
insert into groups(name,category,min_level,automatic_membership)
values ('Automatic #581','team',3,true);
insert into announcements(title,body,group_id)
select 'Child local #581','Child.',id from groups where name='Child #581';
insert into announcements(title,body,group_id)
select 'Automatic local #581','Automatic.',id from groups where name='Automatic #581';
insert into announcements(title,body,group_id,audience) values
('Org #581','All.',(select id from groups where is_organization),'org'),
('EDU #581','Local.',(select id from groups where legacy_dept_id='edu'),'local'),
('PR #581','Local.',(select id from groups where legacy_dept_id='pr'),'local');

select pg_temp.test_login_leadership('f1000000-0000-0000-0000-0000000000f1');
select is((select count(*) from announcements),2::bigint,'ordinary EDU Member reads local EDU and org');
select throws_ok($$insert into announcements(title,body,group_id)
select 'Denied #581','x',id from groups where legacy_dept_id='edu'$$,
'42501',null,'ordinary Member cannot compose');
select lives_ok($$insert into announcement_reads(announcement_id,member_id)
select id,'f1000000-0000-0000-0000-0000000000f1' from announcements where title='EDU #581'$$,
'Member can mark their own visible announcement read');
select throws_ok($$insert into announcement_reads(announcement_id,member_id)
select id,'f2000000-0000-0000-0000-0000000000f2' from announcements where title='EDU #581'$$,
'42501',null,'Member cannot mark another Member read');
reset role;

select pg_temp.test_login_leadership('f3000000-0000-0000-0000-0000000000f3');
select is((select count(*) from announcements),2::bigint,'BCE without a Group Role reads org and Automatic Membership Group');
select is((select count(*) from announcements where title='Automatic local #581'),1::bigint,
'Automatic Membership grants local read without a roster row');
select throws_ok($$insert into announcements(title,body,group_id)
select 'BCE denied #581','x',id from groups where is_organization$$,
'42501',null,'BCE rank alone cannot compose for the Organization Group');
select throws_ok($$insert into announcements(title,body,group_id)
select 'BCE local denied #581','x',id from groups where legacy_dept_id='edu'$$,
'42501',null,'BCE rank alone cannot compose locally');
reset role;

select pg_temp.test_login_leadership('f4000000-0000-0000-0000-0000000000f4');
select lives_ok($$insert into announcements(title,body,group_id,created_by)
select 'Responsible EDU #581','x',id,'f4000000-0000-0000-0000-0000000000f4'
from groups where legacy_dept_id='edu'$$,'Responsible composes for own Group');
select lives_ok($$insert into announcements(title,body,group_id)
select 'Responsible child #581','x',id from groups where name='Child #581'$$,
'inherited Responsible composes for a Child Group');
select is((select count(*) from announcements where title='Responsible child #581'),1::bigint,
'inherited Responsible insert actually created a Child Group announcement');
select lives_ok($$insert into announcements(title,body,group_id,audience,created_by)
select 'Responsible org audience #581','x',id,'org','f4000000-0000-0000-0000-0000000000f4'
from groups where legacy_dept_id='edu'$$,'Responsible can choose org Audience without changing Origin');
select throws_ok($$insert into announcements(title,body,group_id)
select 'Responsible PR denied #581','x',id from groups where legacy_dept_id='pr'$$,
'42501',null,'Responsible cannot compose for unrelated Group');
select lives_ok($$insert into announcements(title,body,group_id,created_by)
select 'Responsible Organization #581','x',id,'f4000000-0000-0000-0000-0000000000f4'
from groups where is_organization$$,'a holder of any Group Role may compose for Organization Group');
update announcements set pinned=true where title='Responsible EDU #581';
select is((select pinned from announcements where title='Responsible EDU #581'),true,'Responsible edits own Group announcement');
update announcements set pinned=true where title='PR #581';
reset role;
select is((select pinned from announcements where title='PR #581'),false,'Responsible cannot edit unrelated Group announcement');

select pg_temp.test_login_leadership('f6000000-0000-0000-0000-0000000000f6');
select is((select count(*) from announcements where title='EDU #581'),0::bigint,
'BC without Group Role cannot read unrelated local announcement by rank');
select lives_ok($$insert into announcements(title,body,group_id,created_by)
select 'BC local #581','x',id,'f6000000-0000-0000-0000-0000000000f6'
from groups where legacy_dept_id='edu'$$,'BC can compose for any Group');
reset role;
select is((select count(*) from announcements where title='BC local #581'),1::bigint,
'BC write created the local row despite the narrower read policy');

select pg_temp.test_login_leadership('f7000000-0000-0000-0000-0000000000f7');
select is((select count(*) from announcements where title='Org #581'),0::bigint,
'inactive Member with stale organization claims cannot read org Audience');
reset role;

select pg_temp.test_login_leadership('f2000000-0000-0000-0000-0000000000f2');
select is((select count(*) from announcements where title='Responsible org audience #581'),1::bigint,
'org Audience reaches a Member outside Origin');
select is((select count(*) from announcements where title='Responsible EDU #581'),0::bigint,
'local Audience excludes a Member outside Origin');
reset role;

select pg_temp.test_login_leadership('f5000000-0000-0000-0000-0000000000f5');
select is((select count(*) from announcements where title='Child local #581'),1::bigint,
'ancestor Manager can read a Child Group local announcement');
select lives_ok($$insert into announcements(title,body,group_id)
select 'Manager child #581','x',id from groups
where name='Child #581'$$,
'ancestor Manager composes for a Child Group');
select is((select count(*) from announcements where title='Manager child #581'),1::bigint,
'ancestor Manager insert actually created a Child Group announcement');
reset role;

create temp table ann_org_fx as select id from groups where is_organization;
grant select on ann_org_fx to authenticated;
select pg_temp.test_clear_jwt(); set local role authenticated;
select is((select count(*) from announcements),0::bigint,'claimless session sees nothing');
select throws_ok($$insert into announcements(title,body,group_id) select 'Spam #581','x',id from ann_org_fx$$,
'42501',null,'claimless session cannot compose');
reset role;
set local role anon;
select throws_ok($$select count(*) from announcements$$,'42501',null,'anon has no announcement access');
reset role;
select * from finish();
rollback;
