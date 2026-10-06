-- Ruling R39 (2026-10-06): creating an Event notifies its audience -- the
-- important-change recipients (the Group Audience that Notifications reach,
-- ruling R32, read through private.can_read_event), never the creator -- unless
-- p_announce publishes the Announcement, whose fan-out is then the one notice.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- Personas (prefix 3939): 1 Responsible of Root R39 (level 3), the creator;
-- 2 Member of Root (Voluntar); 3 Member of Child R39, below Root (Voluntar);
-- 4 Member of Root (Voluntar cu Drept de Vot, level 3); 5 BC on Root's roster;
-- 6 Moderator on Root's roster; 7 a Voluntar on no roster; 8 Member of the
-- Private Group Privat R39, below Root (Voluntar); 9 an inactive Member of Root.
create function pg_temp.u39(n integer) returns uuid language sql immutable as $$
  select ('39390000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users(id,email)
select pg_temp.u39(n),'eveniment.'||n||'.r39@test.local' from generate_series(1,9) n;
insert into profiles(id,full_name,email,role,status)
select pg_temp.u39(n),'Eveniment R39 '||n,'eveniment.'||n||'.r39@test.local',
  (case n when 1 then 'vot' when 4 then 'vot' when 5 then 'bc' when 6 then 'moderator' else 'voluntar' end)::member_role,
  (case when n=9 then 'inactiv' else 'activ' end)::member_status
from generate_series(1,9) n;
insert into groups(name,category,min_level) values ('Root R39','team',0);
insert into groups(name,category,parent_id) values ('Child R39','team',(select id from groups where name='Root R39'));
insert into groups(name,category,parent_id,is_private) values ('Privat R39','team',(select id from groups where name='Root R39'),true);
insert into group_members(group_id,member_id,group_role)
select grp.id,pg_temp.u39(roster.n),roster.role
from (values ('Root R39',1,'responsible'),('Root R39',2,'member'),('Child R39',3,'member'),
             ('Root R39',4,'member'),('Root R39',5,'member'),('Root R39',6,'member'),
             ('Privat R39',8,'member'),('Root R39',9,'member')) as roster(name,n,role)
join groups as grp on grp.name=roster.name;
create temp table fx as
select (select id from groups where name='Root R39') as root,
       (select id from groups where name='Privat R39') as private_group,
       (select id from groups where is_organization) as org;
grant select on fx to authenticated;

create function pg_temp.event_id(p_title text) returns bigint language sql stable as $$
  select id from public.events where title = p_title
$$;
-- The R39 notices of one Event, as (persona number) rows.
create function pg_temp.notified(p_title text) returns setof integer language sql stable as $$
  select right(member_id::text, 12)::integer
    from public.notifications
   where title = 'Eveniment nou: ' || p_title and member_id::text like '39390000-%'
   order by 1
$$;

-- ==================== 1. the audience is told ====================
select pg_temp.test_login_leadership(pg_temp.u39(1));
select lives_ok($$select public.create_event('Atelier R39','activitate',(select root from fx),
  '2030-09-25 15:40+00','2030-09-25 17:40+00','  Sala 305 ',null,'Aduceți laptopul.')$$,
  'a Group Responsible creates an Event without the Announcement');
reset role;
select results_eq($$select * from pg_temp.notified('Atelier R39')$$,
  $$values (2),(3),(4),(8)$$,
  'the Event''s Group Audience is notified: its own roster, a Child Group''s and a Private Child Group''s members');
select is((select count(*)::int from notifications where title='Eveniment nou: Atelier R39'), 4,
  'one Notification per recipient, nobody else in the database');
select results_eq(
  $$select distinct kind::text, body, link, subject, critical
      from notifications where title='Eveniment nou: Atelier R39'$$,
  $$select 'event'::text, 'Miercuri, 25 septembrie 2030, 18:40–20:40 · Sala 305'::text,
           '/calendar?event=' || pg_temp.event_id('Atelier R39'),
           'event:' || pg_temp.event_id('Atelier R39'), false$$,
  'kind event, the date line and place in Romania''s time zone, linked to the Event, subject event:<id>');
select is((select count(*)::int from notifications
            where title='Eveniment nou: Atelier R39' and member_id=pg_temp.u39(1)), 0,
  'the creator is not echoed');
select is((select count(*)::int from notifications
            where title='Eveniment nou: Atelier R39' and member_id in (pg_temp.u39(5),pg_temp.u39(6))), 0,
  'BC and the Moderator are not notified through the Group Audience (R32)');
select is((select count(*)::int from notifications
            where title='Eveniment nou: Atelier R39' and member_id=pg_temp.u39(7)), 0,
  'a Member outside the Group Audience is not notified');
select is((select count(*)::int from notifications
            where title='Eveniment nou: Atelier R39' and member_id=pg_temp.u39(9)), 0,
  'an inactive Member is not notified');

-- An RSVP reads the notice (R37): the subject ties them together.
select pg_temp.test_login_leadership(pg_temp.u39(2));
select lives_ok($$select public.set_event_rsvp(pg_temp.event_id('Atelier R39'),'going')$$,
  'a recipient answers Vin');
reset role;
select is((select read from notifications where title='Eveniment nou: Atelier R39' and member_id=pg_temp.u39(2)), true,
  'answering the Event reads its creation notice');

-- No place: the date line alone.
select pg_temp.test_login_leadership(pg_temp.u39(1));
select lives_ok($$select public.create_event('Fără loc R39','sedinta',(select root from fx),'2030-12-01 10:00+00')$$,
  'an Event without an end or a place');
reset role;
select is((select distinct body from notifications where title='Eveniment nou: Fără loc R39'),
  'Duminică, 1 decembrie 2030, 12:00',
  'its notice reads the start alone, in Romania''s winter time');

-- ==================== 2. the Minimum Level ====================
select pg_temp.test_login_leadership(pg_temp.u39(1));
select lives_ok($$select public.create_event('Votanți R39','sedinta',(select root from fx),
  '2030-09-26 15:00+00',p_min_level => 3)$$,
  'an Event for level 3 and above');
reset role;
select results_eq($$select * from pg_temp.notified('Votanți R39')$$,
  $$values (4)$$,
  'only the audience at or above the Minimum Level is notified');

-- ==================== 3. a Private Group ====================
select pg_temp.test_login_leadership(pg_temp.u39(1));
select lives_ok($$select public.create_event('Privat R39 ședință','sedinta',(select private_group from fx),
  '2030-09-27 15:00+00')$$,
  'a Responsible on the path creates an Event of the Private Group');
reset role;
select results_eq($$select * from pg_temp.notified('Privat R39 ședință')$$,
  $$values (8)$$,
  'only the Private Group''s members are notified; the parent''s members, outsiders to it, are not');

-- ==================== 4. p_announce: one notice per Member ====================
select pg_temp.test_login_leadership(pg_temp.u39(1));
select lives_ok($$select public.create_event('Anunțat R39','activitate',(select root from fx),
  '2030-09-28 15:00+00',p_announce => true)$$,
  'an Event created with its Announcement');
reset role;
select is((select count(*)::int from notifications where title='Eveniment nou: Anunțat R39'), 0,
  'with the Announcement no separate Event Notification is written');
select results_eq(
  $$select right(member_id::text, 12)::integer, count(*)::int
      from notifications
     where title in ('Anunț nou: Anunțat R39','Eveniment nou: Anunțat R39')
       and member_id::text like '39390000-%'
     group by member_id order by 1$$,
  $$values (2,1),(3,1),(4,1),(8,1)$$,
  'every Member of the audience gets exactly one notice: the Announcement''s');

-- ==================== 5. an Organization Event, at scale ====================
select pg_temp.test_login_leadership(pg_temp.u39(5));
select lives_ok($$select public.create_event('Adunare R39','eveniment',(select org from fx),'2030-09-29 15:00+00')$$,
  'a BC creates an Organization Event without the Announcement');
reset role;
select is((select count(*)::int from notifications where title='Eveniment nou: Adunare R39'),
  (select count(*)::int
     from private.group_notification_audience((select org from fx)) as audience(member_id)
    where private.can_read_event((select org from fx), 0, audience.member_id)
      and audience.member_id <> pg_temp.u39(5)),
  'an Organization Event tells every Member the Organization''s Group Audience reaches');
select ok((select count(*) from notifications where title='Eveniment nou: Adunare R39') > 1,
  'and that is not nobody');
select is((select count(*)::int from notifications as notification
            join profiles as profile on profile.id = notification.member_id
            join roles as role on role.id = profile.role
           where notification.title='Eveniment nou: Adunare R39' and role.level >= 6), 0,
  'no BC member or Moderator is among them (R32)');
select is((select count(*)::int from notifications where title='Eveniment nou: Adunare R39' and member_id=pg_temp.u39(5)), 0,
  'the BC creator is not echoed');

-- ==================== 6. the daily cap (security pass L3) ====================
-- The creator has made five Events above; fill the rest of the 50 directly.
insert into events(title,type,group_id,starts_at,created_by)
select 'Plin R39 '||n,'sedinta',(select root from fx),'2030-10-01 15:00+00'::timestamptz + n * interval '1 hour',pg_temp.u39(1)
from generate_series(1, 50 - (select count(*)::int from events where created_by = pg_temp.u39(1))) n;
select pg_temp.test_login_leadership(pg_temp.u39(1));
select throws_ok($$select public.create_event('Peste R39','sedinta',(select root from fx),'2030-10-05 15:00+00')$$,
  'PT409','rate_limited',
  'a Member who created 50 Events in the last 24 hours is refused the 51st');
reset role;
select is((select count(*)::int from events where title='Peste R39'), 0,
  'the refused Event was not written');
select is((select count(*)::int from notifications where title='Eveniment nou: Peste R39'), 0,
  'and nobody was notified of it');

select * from finish();
rollback;
