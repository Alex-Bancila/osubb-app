-- #581: announcement Origin, Audience, content and read receipts.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(14);
select has_table('public', 'announcements', 'announcements table exists');
select has_table('public', 'announcement_reads', 'announcement_reads table exists');
select has_column('public', 'announcements', 'group_id', 'Origin Group column exists');
select has_column('public', 'announcements', 'audience', 'Audience column exists');
select col_not_null('public', 'announcements', 'group_id', 'Origin Group is required');
select col_not_null('public', 'announcements', 'audience', 'Audience is required');
select has_index('public', 'announcements', 'announcements_group_idx', 'Origin lookup is indexed');
truncate announcements, announcement_reads cascade;
insert into announcements(title,body,group_id,audience) values
('Organization #581','Org.',(select id from groups where is_organization),'org'),
('EDU #581','EDU.',(select id from groups where name = 'Educațional'),'local');
insert into announcements(title,body,group_id,audience)
select 'Wide EDU #581','All.',id,'org' from groups where name = 'Educațional';
select is((select count(*) from announcements),3::bigint,'three announcements can be created');
select is((select group_id from announcements where title='Organization #581'),
(select id from groups where is_organization),'organization announcement has Organization Origin');
select is((select audience from announcements where title='EDU #581'),'local','Department announcement is local');
select is((select audience from announcements where title='Wide EDU #581'),'org',
'organization Audience is independent of Department Origin');
select throws_ok($$insert into announcements(title,body) values('No Origin #581','x')$$,
'23502',null,'an announcement requires a Group Origin');
select throws_ok($$insert into announcements(title,body,group_id,audience)
select 'Bad Audience #581','x',id,'elsewhere' from groups where name = 'Educațional'$$,
'23514',null,'announcements_audience_ck rejects an unknown Audience');
select throws_ok($$insert into announcements(title,body,group_id,form_label)
select 'Dead link #581','x',id,'Form' from groups where name = 'Educațional'$$,
'23514',null,'form button still requires a URL');
select * from finish();
rollback;
