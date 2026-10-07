-- #909: an Announcement's optional Termen and Minimum Level, and create_event(p_announce) publishing
-- one Announcement for the new Event -- never with more authority than a
-- direct insert, and never leaving an Event behind when it is refused.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(53);

-- Personas (prefix 909): 1 Responsible of Root #909 (Voluntar, level 1),
-- 2 plain Member of Root #909 (Voluntar, level 1), 3 BC, 4 a Member of no
-- Group, 5 a Voluntar cu Drept de Vot (level 3) in Root #909.
create function pg_temp.u909(n integer) returns uuid language sql immutable as $$
  select ('90900000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users(id,email)
select pg_temp.u909(n),'termen.'||n||'.909@test.local' from generate_series(1,5) n;
insert into profiles(id,full_name,email,role,status)
select pg_temp.u909(n),'Termen #909 '||n,'termen.'||n||'.909@test.local',
  (case when n=3 then 'bc' when n=5 then 'vot' else 'voluntar' end)::member_role,'activ'
from generate_series(1,5) n;
insert into groups(name,category,min_level) values ('Root #909','team',0);
insert into group_members(group_id,member_id,group_role)
select grp.id,pg_temp.u909(roster.n),roster.role
from (values (1,'responsible'),(2,'member'),(5,'member')) as roster(n,role)
join groups as grp on grp.name='Root #909';
create temp table fx as
select (select id from groups where name='Root #909') as root,
       (select id from groups where is_organization) as org;
grant select on fx to authenticated;

-- ==================== 1. the column ====================
select has_column('public','announcements','deadline','announcements.deadline exists');
select col_type_is('public','announcements','deadline','timestamp with time zone','the Termen is a timestamptz');
select col_is_null('public','announcements','deadline','the Termen is optional');

-- ==================== 2. direct compose with and without Termen ====================
select pg_temp.test_login_leadership(pg_temp.u909(1));
select lives_ok($$insert into announcements(title,body,group_id,audience)
  select 'Fără termen #909','Corp.',root,'local' from fx$$,
  'an Announcement without a Termen is published');
select lives_ok($$insert into announcements(title,body,group_id,audience,deadline)
  select 'Cu termen #909','Corp.',root,'local',now() + interval '3 days' from fx$$,
  'an Announcement with a future Termen is published');
select throws_ok($$insert into announcements(title,body,group_id,audience,deadline)
  select 'Termen trecut #909','Corp.',root,'local',now() - interval '1 minute' from fx$$,
  '23514','deadline_in_past',
  'a signed-in author cannot publish a Termen in the past (R8)');
reset role;
select is((select deadline from announcements where title='Fără termen #909'), null,
  'no Termen is stored as null');
select is((select deadline from announcements where title='Cu termen #909'), now() + interval '3 days',
  'the Termen is stored as sent');
select is((select count(*) from announcements where title='Termen trecut #909'), 0::bigint,
  'the refused Announcement was not stored');

-- Editing keeps, changes or clears the Termen; R8 judges it only at creation.
select pg_temp.test_login_leadership(pg_temp.u909(1));
update announcements set pinned = true where title='Cu termen #909';
reset role;
select is((select deadline from announcements where title='Cu termen #909'), now() + interval '3 days',
  'an edit of another field keeps the Termen');
select pg_temp.test_login_leadership(pg_temp.u909(1));
update announcements set deadline = now() + interval '5 days' where title='Cu termen #909';
reset role;
select is((select deadline from announcements where title='Cu termen #909'), now() + interval '5 days',
  'an edit changes the Termen');
select pg_temp.test_login_leadership(pg_temp.u909(1));
update announcements set deadline = null where title='Cu termen #909';
reset role;
select is((select deadline from announcements where title='Cu termen #909'), null,
  'an edit clears the Termen');

-- A write with no auth.uid() (seed, migrations) is not judged: demo data can
-- show an expired Termen.
select pg_temp.test_clear_jwt();
select lives_ok($$insert into announcements(title,body,group_id,audience,deadline,created_by)
  select 'Seed expirat #909','Corp.',root,'local',now() - interval '2 days',null from fx$$,
  'a server-side insert may carry a past Termen');

-- ==================== 3. the Event Announcement body ====================
select is(private.event_announcement_body('2030-09-25 15:40+00','2030-09-25 17:40+00','  Sala 305 ','Aduceți laptopul.'),
  E'Miercuri, 25 septembrie 2030, 18:40–20:40 · Sala 305\n\nAduceți laptopul.',
  'the body reads day, date, time range in Romania, place, then the description');
select is(private.event_announcement_body('2030-12-01 10:00+00',null,null,null),
  'Duminică, 1 decembrie 2030, 12:00',
  'no end, place or description: the date line alone, in Romania''s winter time');
select is(private.event_announcement_body('2030-09-25 15:40+00','2030-09-26 07:00+00','',''),
  'Miercuri, 25 septembrie 2030, 18:40 – joi, 26 septembrie 2030, 10:00',
  'an Event that ends on another day names the end day');
select is(char_length(private.event_announcement_body('2030-09-25 15:40+00',null,null,repeat('x',2000))), 2000,
  'a full-length description is clipped to the 2000 characters an Announcement body allows');
select ok(private.event_announcement_body('2030-09-25 15:40+00',null,null,repeat('x',2000)) like '%…',
  'a clipped body ends with an ellipsis');

-- ==================== 4. create_event without p_announce ====================
select pg_temp.test_login_leadership(pg_temp.u909(1));
select lives_ok($$select public.create_event('Implicit #909','sedinta',(select root from fx),'2030-09-25 15:40+00')$$,
  'create_event without p_announce still works (the default)');
select lives_ok($$select public.create_event('Nebifat #909','sedinta',(select root from fx),'2030-09-25 15:40+00',
  p_announce => false)$$,
  'create_event with p_announce = false');
reset role;
select is((select count(*) from announcements where title in ('Implicit #909','Nebifat #909')), 0::bigint,
  'unticked: no Announcement is published');

-- ==================== 5. create_event with p_announce ====================
select pg_temp.test_login_leadership(pg_temp.u909(1));
select lives_ok($$select public.create_event('Atelier #909','activitate',(select root from fx),
  '2030-09-25 15:40+00','2030-09-25 17:40+00','Sala 305',null,'Aduceți laptopul.',0,null,true)$$,
  'a Group Responsible creates an Event and its Announcement');
reset role;
select is((select count(*) from announcements where title='Atelier #909'), 1::bigint,
  'ticked: exactly one Announcement');
select results_eq(
  $$select body, group_id, audience, deadline, created_by, priority::text, pinned
      from announcements where title='Atelier #909'$$,
  $$select E'Miercuri, 25 septembrie 2030, 18:40–20:40 · Sala 305\n\nAduceți laptopul.'::text,
           (select root from fx), 'local'::text, '2030-09-25 15:40+00'::timestamptz,
           pg_temp.u909(1), 'normal'::text, false$$,
  'the Announcement carries the Event''s details, its Group as a local Audience, Termen = start and the creator as author');
select is((select count(*) from events where title='Atelier #909'), 1::bigint,
  'the Event itself is created');
select is((select count(*) from notifications
            where title='Anunț nou: Atelier #909' and member_id=pg_temp.u909(2)), 1::bigint,
  'the Announcement fans out to the Group''s Members as any Announcement does');
select is((select count(*) from notifications
            where title='Anunț nou: Atelier #909' and member_id=pg_temp.u909(1)), 0::bigint,
  'the author is not notified of their own Announcement');

select pg_temp.test_login_leadership(pg_temp.u909(3));
select lives_ok($$select public.create_event('Adunare #909','eveniment',(select org from fx),
  '2030-09-25 15:40+00',p_announce => true)$$,
  'a BC creates an Organization Event with its Announcement');
reset role;
select results_eq(
  $$select group_id, audience from announcements where title='Adunare #909'$$,
  $$select (select org from fx), 'org'::text$$,
  'an Organization Event''s Announcement goes to the whole organization');

-- ==================== 6. the Minimum Level ====================
select col_not_null('public','announcements','min_level','the Minimum Level is always set');
select col_default_is('public','announcements','min_level','0','by default everyone in the Audience reads it (Recrut)');
select pg_temp.test_login_leadership(pg_temp.u909(1));
select throws_ok($$insert into announcements(title,body,group_id,audience,min_level)
  select 'Nivel 4 #909','Corp.',root,'local',4 from fx$$,
  '23514','invalid_announcement_min_level',
  'a Minimum Level off the R29b ladder is named, not a raw constraint');
reset role;

-- The unread badge before the level-3 Announcement exists, for 2 and 5.
create temp table badge(n integer, phase text, unread integer);
grant select, insert on badge to authenticated;
select pg_temp.test_login_leadership(pg_temp.u909(2));
insert into badge select 2,'before',public.my_unread_announcements_count();
reset role;
select pg_temp.test_login_leadership(pg_temp.u909(5));
insert into badge select 5,'before',public.my_unread_announcements_count();
reset role;

-- Posted by the level-1 Responsible, for level 3 and up.
select pg_temp.test_login_leadership(pg_temp.u909(1));
select lives_ok($$insert into announcements(title,body,group_id,audience,min_level)
  select 'Nivel #909','Doar pentru votanți.',root,'local',3 from fx$$,
  'an Announcement is published with a Minimum Level');
select is((select count(*) from announcements where title='Nivel #909'), 1::bigint,
  'its author reads it even below its Minimum Level');
reset role;
-- The id is read as the owner: the Member below the level cannot see it.
create temp table hidden as select id from announcements where title='Nivel #909';
grant select on hidden to authenticated;

select pg_temp.test_login_leadership(pg_temp.u909(2));
select is((select count(*) from announcements where title='Nivel #909'), 0::bigint,
  'a Member of the Audience below the Minimum Level cannot read it (feed, details, ?anunt=)');
insert into badge select 2,'after',public.my_unread_announcements_count();
select throws_ok($$insert into announcement_reads(announcement_id,member_id)
  select id,'90900000-0000-0000-0000-000000000002' from hidden$$,
  '42501',null,
  'a Member below the Minimum Level cannot plant a read receipt on it');
reset role;

select pg_temp.test_login_leadership(pg_temp.u909(5));
select is((select count(*) from announcements where title='Nivel #909'), 1::bigint,
  'a Member of the Audience at the Minimum Level reads it');
insert into badge select 5,'after',public.my_unread_announcements_count();
reset role;
select is((select unread from badge where n=2 and phase='after')
          - (select unread from badge where n=2 and phase='before'), 0,
  'the unread badge of a Member below the Minimum Level does not count it');
select is((select unread from badge where n=5 and phase='after')
          - (select unread from badge where n=5 and phase='before'), 1,
  'the unread badge of a Member at the Minimum Level counts it');
select is((select count(*) from notifications
            where title='Anunț nou: Nivel #909' and member_id=pg_temp.u909(2)), 0::bigint,
  'no Notification reaches a Member below the Minimum Level');
select is((select count(*) from notifications
            where title='Anunț nou: Nivel #909' and member_id=pg_temp.u909(5)), 1::bigint,
  'the Notification reaches a Member at the Minimum Level');

select pg_temp.test_login_leadership(pg_temp.u909(1));
select is((select count(*) from public.announcement_readers((select id from hidden))
            where member_id=pg_temp.u909(2)), 0::bigint,
  'the readers list leaves out the Audience below the Minimum Level');
select is((select count(*) from public.announcement_readers((select id from hidden))
            where member_id=pg_temp.u909(5)), 1::bigint,
  'the readers list names the Audience at the Minimum Level');
reset role;

-- An Event's Announcement takes the Event's Minimum Level.
select pg_temp.test_login_leadership(pg_temp.u909(3));
select lives_ok($$select public.create_event('Restrâns #909','sedinta',(select root from fx),
  '2030-09-25 15:40+00',p_min_level => 3,p_announce => true)$$,
  'an Event above its Group''s Minimum Level can be announced');
reset role;
select is((select min_level from announcements where title='Restrâns #909'), 3,
  'the Announcement copies the Event''s Minimum Level');
select is((select min_level from announcements where title='Atelier #909'), 0,
  'an open Event''s Announcement is open to the whole Audience');

-- ==================== 7. refusals leave nothing behind ====================
-- The author's daily Announcement cap (PT409 rate_limited) refuses the whole call.
select pg_temp.test_clear_jwt();
insert into announcements(title,body,group_id,audience,created_by)
select 'Cap #909 '||n,'Corp.',(select root from fx),'local',pg_temp.u909(3)
from generate_series(1,20) n;
select pg_temp.test_login_leadership(pg_temp.u909(3));
select throws_ok($$select public.create_event('Peste cotă #909','sedinta',(select root from fx),
  '2030-09-25 15:40+00',p_announce => true)$$,
  'PT409','rate_limited',
  'an author at the daily Announcement cap is refused the whole call');
reset role;
select is((select count(*) from events where title='Peste cotă #909'), 0::bigint,
  'no Event is left behind when the Announcement''s own row guard refuses it');

-- One compose rule, two readers. Every caller who may create an Event today
-- may also publish from its Group, so the rule is proven by withdrawing it:
-- with can_publish_announcement answering false, both the direct insert and
-- create_event(p_announce) are refused, while create_event alone still works.
create or replace function private.can_publish_announcement(p_group_id bigint, p_kind text default 'announcement')
returns boolean language sql stable security definer set search_path = '' as $$ select false $$;
select pg_temp.test_login_leadership(pg_temp.u909(1));
select throws_ok($$insert into announcements(title,body,group_id,audience)
  select 'Direct refuzat #909','Corp.',root,'local' from fx$$,
  '42501',null,
  'announcements_create reads can_publish_announcement');
select throws_ok($$select public.create_event('Fără drept #909','sedinta',(select root from fx),
  '2030-09-25 15:40+00',p_announce => true)$$,
  '42501','announcement_publish_forbidden',
  'create_event refuses an Announcement the caller could not publish directly');
select lives_ok($$select public.create_event('Fără drept, fără anunț #909','sedinta',(select root from fx),
  '2030-09-25 15:40+00')$$,
  'the same caller still creates the Event without the Announcement');
reset role;
select is((select count(*) from events where title='Fără drept #909'), 0::bigint,
  'no Event is left behind when the Announcement is refused');
select is((select count(*) from announcements where title='Fără drept #909'), 0::bigint,
  'and no Announcement was published');

select * from finish();
rollback;
