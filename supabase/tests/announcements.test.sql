-- #581: announcement Origin, Audience, content and read receipts.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(17);
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
'23514','new row for relation "announcements" violates check constraint "announcements_audience_ck"','announcements_audience_ck rejects an unknown Audience');
select throws_ok($$insert into announcements(title,body,group_id,form_label)
select 'Dead link #581','x',id,'Form' from groups where name = 'Educațional'$$,
'23514','new row for relation "announcements" violates check constraint "announcements_form_ck"','form button still requires a URL');
-- #673 (R8): announcements_guard_text names the rule a direct write breaks
-- and stores the trimmed text. Every reason is covered in constraints_kit.
select throws_ok($$insert into announcements(title,body,group_id,audience)
select repeat('t', 121),'x',id,'local' from groups where name = 'Educațional'$$,
'23514','title_too_long','a title over 120 characters is refused with its reason, not a constraint name');
select throws_ok($$insert into announcements(title,body,group_id,audience,form_label,form_url)
select 'Link invalid #673','x',id,'local','Formular','ftp://osubb.ro/f' from groups where name = 'Educațional'$$,
'23514','link_url_invalid','a link address that is not http(s) is refused');
insert into announcements(title,body,group_id,audience)
select E'  Titlu cu spații #673 \n','  Corp.  ',id,'local' from groups where name = 'Educațional';
select is((select title || '|' || body from announcements where title like 'Titlu cu spații%'),
'Titlu cu spații #673|Corp.','title and body are stored trimmed');

select * from finish();
rollback;
