-- Ruling R53 (Alex, 2026-10-14): every content change of an Announcement or
-- an Event tells the people its notices reach, never the one who made it; a
-- label alone (a pin, a Campaign) tells nobody. Whoever was told of the item
-- hears that it changed; whoever never was hears that it is new. An edit that
-- goes back for approval tells nobody until BC approves it. Spec
-- docs/superpowers/specs/2026-10-14-edit-notices-and-reminders-design.md.
-- (A Task's Campaign-only change is pinned in update_task.test.sql.)
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(32);

create function pg_temp.u53(n integer) returns uuid language sql immutable as $$
  select ('53000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users(id, email)
select pg_temp.u53(n), 'edit.' || n || '.53@test.local' from generate_series(1, 6) n;
insert into profiles(id, full_name, email, role, status)
select pg_temp.u53(n), 'Edit #53 ' || n, 'edit.' || n || '.53@test.local',
       (case n when 4 then 'bc' when 5 then 'vot' else 'voluntar' end)::member_role, 'activ'
  from generate_series(1, 6) n;
insert into groups(name, category, min_level) values ('Root #53', 'team', 0), ('Other #53', 'team', 0);
insert into group_members(group_id, member_id, group_role)
select grp.id, pg_temp.u53(roster.n), roster.role
  from (values ('Root #53', 1, 'responsible'), ('Root #53', 2, 'member'), ('Root #53', 3, 'member'),
               ('Root #53', 5, 'member'), ('Other #53', 6, 'member')) as roster(name, n, role)
  join groups as grp on grp.name = roster.name;
insert into campaigns(group_id, name, is_active, created_by)
select id, 'Campanie #53', true, pg_temp.u53(4) from groups where name = 'Root #53';

create function pg_temp.g53(p_name text) returns bigint language sql stable as $$
  select id from groups where name = p_name
$$;
create function pg_temp.a53(p_title text) returns bigint language sql stable as $$
  select id from announcements where title = p_title
$$;
create function pg_temp.e53(p_title text) returns bigint language sql stable as $$
  select id from events where title = p_title
$$;
create function pg_temp.told(p_title text) returns setof uuid language sql stable as $$
  select member_id from notifications where title = p_title and member_id::text like '53000000-%'
$$;
create function pg_temp.unread_for(p_key text) returns integer language sql stable as $$
  select count(*)::int from notifications
   where dedupe_key = p_key and not read and member_id::text like '53000000-%'
$$;
create function pg_temp.read_all() returns void language sql as $$
  update notifications set read = true where member_id::text like '53000000-%' and not read
$$;
-- Signed in as a fixture Member, writing as the table owner: the triggers see
-- who made the change (auth.uid()), and RLS is not what this suite tests.
create function pg_temp.as53(n integer) returns void language plpgsql as $$
begin
  perform pg_temp.test_login_leadership(pg_temp.u53(n));
  reset role;
end;
$$;
-- An Event written by the table owner has told nobody yet: this tells its
-- audience, as create_event does.
create function pg_temp.announce_event(p_title text) returns void language sql as $$
  select private.notify_event_created(event, null) from events as event where event.title = p_title
$$;
-- update_event is a full-state replace: everything the caller does not change
-- is sent back as it is.
create function pg_temp.edit_event(p_id bigint, p_title text default null,
  p_starts_at timestamptz default null, p_location text default null,
  p_group_id bigint default null, p_campaign_id bigint default null, p_keep_campaign boolean default true)
returns void language sql as $$
  select null::void from (
    select public.update_event(event.id, coalesce(p_title, event.title), event.type::text,
             coalesce(p_group_id, event.group_id), coalesce(p_starts_at, event.starts_at),
             case when p_starts_at is null then event.ends_at end,
             coalesce(p_location, event.location), event.capacity, event.description,
             event.min_level,
             case when p_keep_campaign then event.campaign_id else p_campaign_id end)
      from events as event where event.id = p_id) as done
$$;

-- ==================== 1. Announcements ====================

-- A system insert is published at once and fans out.
insert into announcements(title, body, group_id, audience, created_by)
values ('Local #53', 'Body #53', pg_temp.g53('Root #53'), 'local', pg_temp.u53(1));
update notifications set read = true
 where member_id = pg_temp.u53(3) and title = 'Anunț nou: Local #53';

select pg_temp.as53(1);
update announcements set title = 'Local edited #53', body = 'New body #53'
 where id = pg_temp.a53('Local #53');
select set_eq($$ select pg_temp.told('Anunț actualizat: Local edited #53') $$,
  $$ values (pg_temp.u53(2)), (pg_temp.u53(3)), (pg_temp.u53(5)) $$,
  'an edit while published tells everyone its notice reaches, never the editor');
select ok((select bool_and(body = 'Modificat: titlu, text.' and kind = 'announce'
                           and link = '/anunturi?anunt=' || pg_temp.a53('Local edited #53'))
             from notifications where title = 'Anunț actualizat: Local edited #53'),
  'the notice names what changed and opens the Announcement');
select is((select count(*)::int from notifications
            where member_id = pg_temp.u53(2)
              and dedupe_key = 'announcement:' || pg_temp.a53('Local edited #53')), 1,
  'an unread first notice is refreshed in place, not doubled');
select is((select count(*)::int from notifications
            where member_id = pg_temp.u53(3)
              and dedupe_key = 'announcement:' || pg_temp.a53('Local edited #53')), 2,
  'a Member who had read the first notice gets a new one');

select pg_temp.read_all();
select pg_temp.as53(4);
update announcements set pinned = true where id = pg_temp.a53('Local edited #53');
select is(pg_temp.unread_for('announcement:' || pg_temp.a53('Local edited #53')), 0,
  'a pin alone tells nobody: it is a label');

select pg_temp.test_clear_jwt();
update announcements set body = 'System body #53' where id = pg_temp.a53('Local edited #53');
select is(pg_temp.unread_for('announcement:' || pg_temp.a53('Local edited #53')), 0,
  'a write with nobody signed in (a migration, a job) tells nobody');

-- Lowering the Minimum Level reaches Members who were never told.
insert into announcements(title, body, group_id, audience, min_level, created_by)
values ('Vot only #53', 'Body', pg_temp.g53('Root #53'), 'local', 3, pg_temp.u53(1));
select set_eq($$ select pg_temp.told('Anunț nou: Vot only #53') $$,
  $$ values (pg_temp.u53(5)) $$,
  'fixture: at Minimum Level 3 the first notice reached only the Voluntar cu Drept de Vot');
select pg_temp.as53(1);
update announcements set min_level = 0 where id = pg_temp.a53('Vot only #53');
select ok((select title = 'Anunț actualizat: Vot only #53' and body = 'Modificat: nivel minim.'
             from notifications
            where member_id = pg_temp.u53(5)
              and dedupe_key = 'announcement:' || pg_temp.a53('Vot only #53')),
  'whoever was told hears that it changed');
select ok((select title = 'Anunț nou: Vot only #53' and body = 'Body'
             from notifications
            where member_id = pg_temp.u53(2)
              and dedupe_key = 'announcement:' || pg_temp.a53('Vot only #53')),
  'whoever was never told hears that it is new, with its text');

-- Whoever opened it knows it, even without a notice.
select pg_temp.test_clear_jwt();
insert into announcements(title, body, group_id, audience, created_by)
values ('Opened #53', 'Body', pg_temp.g53('Root #53'), 'local', pg_temp.u53(1));
delete from notifications
 where member_id = pg_temp.u53(3) and dedupe_key = 'announcement:' || pg_temp.a53('Opened #53');
insert into announcement_reads(announcement_id, member_id) values (pg_temp.a53('Opened #53'), pg_temp.u53(3));
select pg_temp.as53(1);
update announcements set body = 'Opened edit #53' where id = pg_temp.a53('Opened #53');
select is((select title from notifications
            where member_id = pg_temp.u53(3) and dedupe_key = 'announcement:' || pg_temp.a53('Opened #53')),
  'Anunț actualizat: Opened #53',
  'whoever opened it without a notice also hears that it changed');

-- Below BC, an organisation-wide Announcement is a request: nobody told yet.
insert into announcements(title, body, group_id, audience, created_by)
values ('Org request #53', 'Body', pg_temp.g53('Root #53'), 'org', pg_temp.u53(1));
select is((select approval_status from announcements where id = pg_temp.a53('Org request #53')), 'pending',
  'fixture: below BC, an organisation-wide Announcement waits for BC');
select is((select count(*)::int from pg_temp.told('Anunț nou: Org request #53')), 0,
  'a request tells nobody');

-- A published organisation-wide Announcement, edited below BC: back to BC.
select pg_temp.test_clear_jwt();
insert into announcements(title, body, group_id, audience, created_by)
values ('Org published #53', 'Body', pg_temp.g53('Root #53'), 'org', pg_temp.u53(1));
select pg_temp.as53(1);
update announcements set body = 'Changed #53' where id = pg_temp.a53('Org published #53');
select is((select approval_status from announcements where id = pg_temp.a53('Org published #53')), 'pending',
  'fixture: a content change below BC sends an organisation-wide Announcement back to BC');
select is((select count(*)::int from pg_temp.told('Anunț actualizat: Org published #53')), 0,
  'an edit that goes back for approval tells nobody yet');
select pg_temp.test_login_leadership(pg_temp.u53(4));
select public.approve_announcement(pg_temp.a53('Org published #53'));
reset role;
select ok(pg_temp.u53(2) in (select pg_temp.told('Anunț actualizat: Org published #53')),
  'BC''s approval of an Announcement its audience already knew says it changed');
select is((select count(*)::int from notifications
            where member_id = pg_temp.u53(2) and title = 'Anunț nou: Org published #53'), 0,
  'and the unread first notice became that one, so nothing says "new" twice');

-- A Deal says so.
select pg_temp.test_clear_jwt();
insert into announcements(title, body, group_id, audience, kind, created_by)
select 'Deal #53', 'Body', id, 'org', 'deal', pg_temp.u53(4) from groups where is_organization;
select pg_temp.as53(4);
update announcements set body = 'Better offer #53' where id = pg_temp.a53('Deal #53');
select ok(pg_temp.u53(2) in (select pg_temp.told('Deal actualizat: Deal #53')),
  'an edited Deal is announced as "Deal actualizat"');
select ok((select bool_and(link = '/anunturi/deals?deal=' || pg_temp.a53('Deal #53'))
             from notifications where title = 'Deal actualizat: Deal #53'),
  'and opens on the OSUBB Deals tab');

-- Turned critical, with its Termen moved: the notice is critical and carries
-- the new Termen (a later edit never hides that it moved).
select pg_temp.test_clear_jwt();
insert into announcements(title, body, group_id, audience, deadline, created_by)
values ('Termen #53', 'Body', pg_temp.g53('Root #53'), 'local', '2026-11-20 12:00+02', pg_temp.u53(1));
update notifications set read = true
 where member_id = pg_temp.u53(3) and title = 'Anunț nou: Termen #53';
select pg_temp.as53(4);
update announcements set priority = 'critical', deadline = '2026-11-21 12:00+02'
 where id = pg_temp.a53('Termen #53');
select ok((select body = 'Modificat: prioritate, termen. Termen: 21.11.2026 12:00.' and critical
             from notifications
            where member_id = pg_temp.u53(3) and not read
              and dedupe_key = 'announcement:' || pg_temp.a53('Termen #53')),
  'a change to critical is critical, and the notice carries the current Termen');

-- ==================== 2. Events ====================

select pg_temp.test_clear_jwt();
insert into events(title, type, group_id, starts_at, ends_at, location, created_by)
values ('Meeting #53', 'sedinta', pg_temp.g53('Root #53'), '2026-11-05 15:00+02', '2026-11-05 16:00+02',
        'Sala A', pg_temp.u53(1));
select pg_temp.announce_event('Meeting #53');

select pg_temp.test_login_leadership(pg_temp.u53(1));
select pg_temp.edit_event(pg_temp.e53('Meeting #53'), p_title => 'Meeting renamed #53');
reset role;
select set_eq($$ select pg_temp.told('Eveniment actualizat: Meeting renamed #53') $$,
  $$ values (pg_temp.u53(2)), (pg_temp.u53(3)), (pg_temp.u53(5)) $$,
  'a title change now tells the Event''s audience, never the editor');
select ok((select bool_and(body = 'Modificat: titlu. Programare: 05.11.2026 15:00 - 05.11.2026 16:00. Locație: Sala A'
                           and dedupe_key = 'event:' || pg_temp.e53('Meeting renamed #53') || ':changed')
             from notifications where title = 'Eveniment actualizat: Meeting renamed #53'),
  'one notice per edit, naming what changed, then the current schedule and place');

select pg_temp.test_login_leadership(pg_temp.u53(1));
select pg_temp.edit_event(pg_temp.e53('Meeting renamed #53'),
  p_starts_at => '2026-11-06 15:00+02', p_location => 'Sala B');
reset role;
select is((select count(*)::int from notifications
            where member_id = pg_temp.u53(2)
              and dedupe_key = 'event:' || pg_temp.e53('Meeting renamed #53') || ':changed'), 1,
  'a second edit refreshes the unread notice instead of adding one');
select is((select body from notifications
            where member_id = pg_temp.u53(2)
              and dedupe_key = 'event:' || pg_temp.e53('Meeting renamed #53') || ':changed'),
  'Modificat: programare, locație. Programare: 06.11.2026 15:00. Locație: Sala B',
  'a new schedule and a new place are spelled out');

select pg_temp.read_all();
select pg_temp.test_login_leadership(pg_temp.u53(1));
select pg_temp.edit_event(pg_temp.e53('Meeting renamed #53'),
  p_campaign_id => (select id from campaigns where name = 'Campanie #53'), p_keep_campaign => false);
reset role;
select is(pg_temp.unread_for('event:' || pg_temp.e53('Meeting renamed #53') || ':changed'), 0,
  'a Campaign alone tells nobody: it is a label');

-- BC moves it to another Group: that Group's audience was never told.
select pg_temp.test_login_leadership(pg_temp.u53(4));
-- The Root Campaign cannot follow it out of Root's path: the move clears it.
select pg_temp.edit_event(pg_temp.e53('Meeting renamed #53'), p_group_id => pg_temp.g53('Other #53'),
  p_keep_campaign => false);
reset role;
select ok((select title = 'Eveniment nou: Meeting renamed #53'
             from notifications
            where member_id = pg_temp.u53(6)
              and dedupe_key = 'event:' || pg_temp.e53('Meeting renamed #53') || ':created'),
  'the new Group''s audience hears of a new Event');
select ok((select body = 'Modificat: grup. Programare: 06.11.2026 15:00. Locație: Sala B. Grup: Other #53'
             from notifications
            where member_id = pg_temp.u53(2) and not read
              and dedupe_key = 'event:' || pg_temp.e53('Meeting renamed #53') || ':changed'),
  'the old Group''s audience hears where it went');

-- Whoever answered it knows it, even without a notice.
select pg_temp.test_clear_jwt();
insert into events(title, type, group_id, starts_at, created_by)
values ('Going #53', 'sedinta', pg_temp.g53('Root #53'), '2026-11-20 18:00+02', pg_temp.u53(1));
insert into event_attendance(event_id, member_id, status) values (pg_temp.e53('Going #53'), pg_temp.u53(2), 'going');
select pg_temp.test_login_leadership(pg_temp.u53(1));
select pg_temp.edit_event(pg_temp.e53('Going #53'), p_title => 'Going renamed #53');
reset role;
select is((select title from notifications
            where member_id = pg_temp.u53(2) and dedupe_key like 'event:' || pg_temp.e53('Going renamed #53') || ':%'),
  'Eveniment actualizat: Going renamed #53',
  'whoever answered the Event without a notice hears that it changed');
select is((select title from notifications
            where member_id = pg_temp.u53(3) and dedupe_key like 'event:' || pg_temp.e53('Going renamed #53') || ':%'),
  'Eveniment nou: Going renamed #53',
  'whoever neither holds a notice nor answered it hears of a new Event');

-- An organisation-wide Event, edited by its creator below BC: back to BC.
select pg_temp.test_clear_jwt();
insert into events(title, type, group_id, starts_at, created_by)
select 'Org meeting #53', 'sedinta', id, '2026-11-10 18:00+02', pg_temp.u53(1)
  from groups where is_organization;
select pg_temp.announce_event('Org meeting #53');
select pg_temp.test_login_leadership(pg_temp.u53(1));
select pg_temp.edit_event(pg_temp.e53('Org meeting #53'), p_title => 'Org meeting moved #53');
reset role;
select is((select approval_status from events where id = pg_temp.e53('Org meeting moved #53')), 'pending',
  'fixture: a content change below BC sends an organisation-wide Event back to BC');
select is((select count(*)::int from pg_temp.told('Eveniment actualizat: Org meeting moved #53')), 0,
  'an Event edit that goes back for approval tells nobody yet');
select pg_temp.test_login_leadership(pg_temp.u53(4));
select public.approve_event(pg_temp.e53('Org meeting moved #53'));
reset role;
select ok(pg_temp.u53(2) in (select pg_temp.told('Eveniment actualizat: Org meeting moved #53')),
  'BC''s approval of an Event its audience already knew says it changed');
select is((select count(*)::int from pg_temp.told('Eveniment nou: Org meeting moved #53')), 0,
  'and never announces it as new to anyone who knew it');

select * from finish();
rollback;
