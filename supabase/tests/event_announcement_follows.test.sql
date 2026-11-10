-- #1150 (audit M8, decided in #1144): the Announcement an Event writes for
-- itself (create_event(p_announce) / approve_event, announcements.event_id)
-- follows the Event. update_event rewrites it through the same body builder
-- (private.event_announcement_body); its Minimum Level, Termen and Group
-- always follow, its title and body only while they are still the text the
-- Event wrote, so an author's own words survive. cancel_event marks it
-- "Anulat: " before its title; delete_event deletes it, its reads and its
-- Notifications. Fixed days: Sunday 3 and Sunday 10 November 2030 (EET).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(48);

-- Personas (prefix 1150): 1 Group Responsible of Root (vot, level 3), who
-- creates every Event; 2 plain Member of Root (voluntar, level 1); 3 BC;
-- 4 Member of Root (vot, level 3); 5 Member of the Private Group (voluntar).
create function pg_temp.u1150(n integer) returns uuid language sql immutable as $$
  select ('11500000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users(id, email)
select pg_temp.u1150(n), 'follows.' || n || '.1150@test.local' from generate_series(1, 5) n;
insert into profiles(id, full_name, email, role, status)
select pg_temp.u1150(n), 'Urmează #1150 ' || n, 'follows.' || n || '.1150@test.local',
       (case n when 1 then 'vot' when 3 then 'bc' when 4 then 'vot' else 'voluntar' end)::public.member_role,
       'activ'
  from generate_series(1, 5) n;
insert into groups(name, category, min_level) values ('Root #1150', 'team', 0);
insert into groups(name, category, min_level, is_private) values ('Privat #1150', 'team', 0, true);
insert into group_members(group_id, member_id, group_role)
select grp.id, pg_temp.u1150(roster.n), roster.role
  from (values ('Root #1150', 1, 'responsible'), ('Root #1150', 2, 'member'), ('Root #1150', 4, 'member'),
               ('Privat #1150', 5, 'member')) as roster(grp, n, role)
  join groups as grp on grp.name = roster.grp;

create function pg_temp.root() returns bigint language sql stable as $$
  select id from public.groups where name = 'Root #1150'
$$;
create function pg_temp.private_group() returns bigint language sql stable as $$
  select id from public.groups where name = 'Privat #1150'
$$;
create function pg_temp.org() returns bigint language sql stable as $$
  select id from public.groups where is_organization
$$;
create function pg_temp.event(p_title text) returns bigint language sql stable as $$
  select id from public.events where title = p_title
$$;
-- The Announcement an Event wrote, by the Event's title when it was created
-- (the ids are kept, so a renamed or deleted Event is still found).
create temp table annc(label text primary key, event_id bigint, announcement_id bigint);
create function pg_temp.annc(p_label text) returns bigint language sql stable as $$
  select announcement_id from pg_temp.annc where label = p_label
$$;
create function pg_temp.remember(p_label text, p_title text) returns void language sql as $$
  insert into pg_temp.annc
  select p_label, event.id, announcement.id
    from public.events as event
    join public.announcements as announcement on announcement.event_id = event.id
   where event.title = p_title
$$;
-- What the Event writes, built from the Event row as create_event builds it.
create function pg_temp.built(p_event_id bigint) returns text language sql stable as $$
  select private.event_announcement_body(event.starts_at, event.ends_at, event.location, event.description, event.all_day)
    from public.events as event where event.id = p_event_id
$$;
create function pg_temp.reads(p_member integer, p_label text) returns bigint language plpgsql as $$
declare
  v_count bigint;
begin
  perform pg_temp.test_login_leadership(pg_temp.u1150(p_member));
  select count(*) into v_count from public.announcements where id = pg_temp.annc(p_label);
  reset role;
  perform pg_temp.test_clear_jwt();
  return v_count;
end;
$$;
grant execute on function pg_temp.root(), pg_temp.private_group(), pg_temp.org(), pg_temp.event(text),
  pg_temp.annc(text) to authenticated;
grant select on pg_temp.annc to authenticated;

-- One edit through update_event's full-state replace: every field the Event
-- has, with the ones named here changed.
create function pg_temp.edit(p_event_id bigint, p_title text default null, p_group_id bigint default null,
                             p_starts_at timestamptz default null, p_ends_at timestamptz default null,
                             p_location text default null, p_description text default null,
                             p_min_level integer default null)
returns void language sql as $$
  select null::void from (
    select public.update_event(event.id, coalesce(p_title, event.title), event.type::text,
                               coalesce(p_group_id, event.group_id),
                               coalesce(p_starts_at, event.starts_at), coalesce(p_ends_at, event.ends_at),
                               coalesce(p_location, event.location), event.capacity,
                               coalesce(p_description, event.description),
                               coalesce(p_min_level, event.min_level), event.campaign_id, event.all_day)
      from public.events as event where event.id = p_event_id) as done
$$;
grant execute on function pg_temp.edit(bigint, text, bigint, timestamptz, timestamptz, text, text, integer) to authenticated;

-- ==================== The Events and their Announcements ====================
select pg_temp.test_login_leadership(pg_temp.u1150(1));
select public.create_event('Ședință #1150', 'sedinta', pg_temp.root(), '2030-11-03 18:00+02', '2030-11-03 20:00+02',
                           'Sala 305', null, 'Aduceți **laptopul**.', 0, null, true);
select public.create_event('Atelier #1150', 'activitate', pg_temp.root(), '2030-11-03 18:00+02', null,
                           'Sala 305', null, 'Descrierea evenimentului.', 0, null, true);
select public.create_event('Curs #1150', 'activitate', pg_temp.root(), '2030-11-03 18:00+02', null,
                           'Sala 305', null, null, 0, null, true);
select public.create_event('Secret #1150', 'activitate', pg_temp.root(), '2030-11-03 18:00+02', null,
                           null, null, null, 0, null, true);
select public.create_event('Spre OSUBB #1150', 'eveniment', pg_temp.root(), '2030-11-03 18:00+02', null,
                           null, null, null, 0, null, true);
select public.create_event('Anulat local #1150', 'sedinta', pg_temp.root(), '2030-11-03 18:00+02', null,
                           null, null, null, 0, null, true);
select public.create_event(rpad('Titlu lung #1150 ', 120, 'x'), 'sedinta', pg_temp.root(), '2030-11-03 18:00+02', null,
                           null, null, null, 0, null, true);
select public.create_event('Șters #1150', 'sedinta', pg_temp.root(), '2030-11-03 18:00+02', null,
                           null, null, null, 0, null, true);
-- An Organization Event by a Member below BC is a request; BC approves it and
-- its Announcement is written then (approve_event).
select public.create_event('Gală #1150', 'eveniment', pg_temp.org(), '2030-11-03 18:00+02', null,
                           'Aula', null, null, 0, null, true);
-- An ordinary Announcement of the same Group, which no Event command touches.
insert into public.announcements(title, body, group_id, audience)
values ('Anunț obișnuit #1150', 'Corp obișnuit.', pg_temp.root(), 'local');
reset role;
select pg_temp.test_login_leadership(pg_temp.u1150(3));
select public.approve_event(pg_temp.event('Gală #1150'));
reset role;
select pg_temp.test_clear_jwt();
select pg_temp.remember(label, label)
  from unnest(array['Ședință #1150', 'Atelier #1150', 'Curs #1150', 'Secret #1150', 'Spre OSUBB #1150',
                    'Anulat local #1150', 'Șters #1150', 'Gală #1150']) as label;
select pg_temp.remember('Titlu lung', rpad('Titlu lung #1150 ', 120, 'x'));

-- ==================== 1. One builder ====================
select is((select count(*) from pg_temp.annc), 9::bigint,
  'every Event wrote its Announcement (the Organization Event at its approval)');
select is((select body from announcements where id = pg_temp.annc('Ședință #1150')),
          pg_temp.built(pg_temp.event('Ședință #1150')),
  'create_event writes the body private.event_announcement_body builds from the Event');
select is((select body from announcements where id = pg_temp.annc('Gală #1150')),
          pg_temp.built(pg_temp.event('Gală #1150')),
  'approve_event writes the body the same builder builds from the Event');

-- ==================== 2. A reschedule and a new place ====================
select pg_temp.test_login_leadership(pg_temp.u1150(1));
select lives_ok($$select pg_temp.edit(pg_temp.event('Ședință #1150'),
                    p_starts_at => '2030-11-10 18:00+02', p_ends_at => '2030-11-10 20:00+02', p_location => 'Aula')$$,
  'the Responsible moves the Event from 3 to 10 November, to the Aula');
reset role;
select pg_temp.test_clear_jwt();
select is((select body from announcements where id = pg_temp.annc('Ședință #1150')),
          pg_temp.built(pg_temp.event('Ședință #1150')),
  'a reschedule rewrites the body from the Event''s new state');
select ok((select body like 'Duminică, 10 noiembrie 2030, 18:00–20:00 · Aula%' from announcements
            where id = pg_temp.annc('Ședință #1150')),
  'the date line and the place now read 10 November, Aula');
select is((select deadline from announcements where id = pg_temp.annc('Ședință #1150')),
          '2030-11-10 18:00+02'::timestamptz,
  'the Termen moves with the start');
select is((select count(*) from notifications
            where member_id = pg_temp.u1150(2) and title = 'Anunț actualizat: Ședință #1150'), 1::bigint,
  'its reader hears "Anunț actualizat", as from any edit of an Announcement (no new kind)');

-- The rewritten Announcement is exactly the one create_event writes for an
-- Event in that state: one builder, one set of derived fields.
select pg_temp.test_login_leadership(pg_temp.u1150(1));
select public.create_event('Geamăn #1150', 'sedinta', pg_temp.root(), '2030-11-10 18:00+02', '2030-11-10 20:00+02',
                           'Aula', null, 'Aduceți **laptopul**.', 0, null, true);
reset role;
select pg_temp.test_clear_jwt();
select results_eq(
  $$select body, group_id, audience, min_level, deadline from announcements where id = pg_temp.annc('Ședință #1150')$$,
  $$select announcement.body, announcement.group_id, announcement.audience, announcement.min_level, announcement.deadline
      from announcements as announcement join events as event on event.id = announcement.event_id
     where event.title = 'Geamăn #1150'$$,
  'the followed Announcement equals the one create_event writes for the Event''s new state');

-- A new description and a new title follow too, while untouched.
select pg_temp.test_login_leadership(pg_temp.u1150(1));
select pg_temp.edit(pg_temp.event('Ședință #1150'), p_description => 'Aduceți *încărcătorul*.');
reset role;
select pg_temp.test_clear_jwt();
select ok((select body like E'%\n\nAduceți *încărcătorul*.' from announcements where id = pg_temp.annc('Ședință #1150')),
  'a new description is copied into the body');
select pg_temp.test_login_leadership(pg_temp.u1150(1));
select pg_temp.edit(pg_temp.event('Ședință #1150'), p_title => 'Ședință mutată #1150');
reset role;
select pg_temp.test_clear_jwt();
select is((select title from announcements where id = pg_temp.annc('Ședință #1150')), 'Ședință mutată #1150',
  'a renamed Event renames the Announcement whose title is still the Event''s');

-- ==================== 3. An author's own words survive ====================
select pg_temp.test_login_leadership(pg_temp.u1150(1));
update announcements set body = 'Textul meu, scris de mână.', title = 'Titlul meu #1150'
 where id = pg_temp.annc('Atelier #1150');
select pg_temp.edit(pg_temp.event('Atelier #1150'), p_title => 'Atelier mutat #1150',
                    p_starts_at => '2030-11-10 18:00+02', p_location => 'Aula',
                    p_description => 'Altă descriere.');
reset role;
select pg_temp.test_clear_jwt();
select is((select body from announcements where id = pg_temp.annc('Atelier #1150')), 'Textul meu, scris de mână.',
  'a hand-edited body survives a reschedule');
select is((select title from announcements where id = pg_temp.annc('Atelier #1150')), 'Titlul meu #1150',
  'a hand-edited title survives a rename');
select is((select deadline from announcements where id = pg_temp.annc('Atelier #1150')),
          '2030-11-10 18:00+02'::timestamptz,
  'the hand-edited Announcement''s Termen still follows the start');

-- ==================== 4. A raised Minimum Level ====================
select is(pg_temp.reads(2, 'Curs #1150'), 1::bigint, 'a level-1 Member of the Group reads the Announcement at first');
select pg_temp.test_login_leadership(pg_temp.u1150(1));
select lives_ok($$select pg_temp.edit(pg_temp.event('Curs #1150'), p_min_level => 3)$$,
  'the Responsible raises the Event to Voluntar cu Drept de Vot');
reset role;
select pg_temp.test_clear_jwt();
select is((select min_level from announcements where id = pg_temp.annc('Curs #1150')), 3,
  'announcements.min_level moves with the Event');
select is(pg_temp.reads(2, 'Curs #1150'), 0::bigint, 'the lower audience no longer reads the Announcement');
select is(pg_temp.reads(4, 'Curs #1150'), 1::bigint, 'a Member at the new Minimum Level still reads it');
select is((select body from announcements where id = pg_temp.annc('Curs #1150')),
          pg_temp.built(pg_temp.event('Curs #1150')),
  'a Minimum Level change leaves the body as the Event writes it');

-- ==================== 5. A move into a Private Group ====================
select is(pg_temp.reads(5, 'Secret #1150'), 0::bigint, 'a Member of the Private Group does not read Root''s Announcement');
select pg_temp.test_login_leadership(pg_temp.u1150(3));
select lives_ok($$select pg_temp.edit(pg_temp.event('Secret #1150'), p_group_id => pg_temp.private_group())$$,
  'BC moves the Event into the Private Group');
reset role;
select pg_temp.test_clear_jwt();
select results_eq(
  $$select group_id, audience from announcements where id = pg_temp.annc('Secret #1150')$$,
  $$select pg_temp.private_group(), 'local'::text$$,
  'the Announcement moves with it, as a local Announcement of the Private Group');
select is(pg_temp.reads(2, 'Secret #1150'), 0::bigint, 'the old Group''s Member no longer reads it');
select is(pg_temp.reads(5, 'Secret #1150'), 1::bigint, 'the Private Group''s Member reads it');
-- The command moves it; a client still may not, not even the Event's own
-- Announcement in a Group whose work they manage.
select pg_temp.test_login_leadership(pg_temp.u1150(1));
select throws_ok($$update announcements set group_id = pg_temp.org() where id = pg_temp.annc('Curs #1150')$$,
  '23514', 'announcement_group_immutable',
  'a direct write still cannot move an Event''s Announcement to another Group');
select throws_ok($$update announcements set audience = 'org' where id = pg_temp.annc('Curs #1150')$$,
  '23514', 'announcement_audience_immutable',
  'nor change its Audience');
reset role;
select pg_temp.test_clear_jwt();

-- ==================== 6. Onto the Organization Group ====================
-- Below BC, a move onto the Organization Group makes the Event a request
-- (private.stamp_approval); its Announcement becomes organization-wide and
-- waits for BC with it, so nobody reads the new text before BC does.
select pg_temp.test_login_leadership(pg_temp.u1150(1));
select lives_ok($$select pg_temp.edit(pg_temp.event('Spre OSUBB #1150'), p_group_id => pg_temp.org())$$,
  'the Responsible moves a Root Event onto the Organization Group');
reset role;
select pg_temp.test_clear_jwt();
select is((select approval_status from events where id = pg_temp.event('Spre OSUBB #1150')), 'pending',
  'the moved Event waits for BC');
select results_eq(
  $$select group_id, audience, approval_status from announcements where id = pg_temp.annc('Spre OSUBB #1150')$$,
  $$select pg_temp.org(), 'org'::text, 'pending'::text$$,
  'its Announcement moves onto the Organization Group, organization-wide, and waits for BC too');
select is(pg_temp.reads(2, 'Spre OSUBB #1150'), 0::bigint, 'nobody but its author and BC reads it until then');

-- ==================== 7. Cancel ====================
select pg_temp.test_login_leadership(pg_temp.u1150(1));
select lives_ok($$select public.cancel_event(pg_temp.event('Anulat local #1150'), 'Sala nu mai este liberă.')$$,
  'the Responsible cancels a Root Event');
reset role;
select pg_temp.test_clear_jwt();
select is((select title from announcements where id = pg_temp.annc('Anulat local #1150')), 'Anulat: Anulat local #1150',
  'the Announcement reads as cancelled: "Anulat: " before its title, the Calendar''s word');
select is((select body from announcements where id = pg_temp.annc('Anulat local #1150')),
          pg_temp.built(pg_temp.event('Anulat local #1150')),
  'the body is left as it was');
select is(pg_temp.reads(2, 'Anulat local #1150'), 1::bigint, 'its readers still read it');

-- A title at the limit keeps the mark and is cut to fit.
select pg_temp.test_login_leadership(pg_temp.u1150(1));
select public.cancel_event(pg_temp.event(rpad('Titlu lung #1150 ', 120, 'x')), 'Nu mai are loc.');
reset role;
select pg_temp.test_clear_jwt();
select is((select title from announcements where id = pg_temp.annc('Titlu lung')),
          'Anulat: ' || left(rpad('Titlu lung #1150 ', 120, 'x'), 111) || '…',
  'a 120-character title is cut so the marked title still fits in 120');

-- An organization-wide Announcement cancelled by its Event's author below BC
-- stays published: a cancellation is the Event's state, never a content edit
-- for BC to approve again (the Event itself is not sent back either).
select is((select approval_status from announcements where id = pg_temp.annc('Gală #1150')), 'approved',
  'the Organization Event''s Announcement was published at the approval');
select pg_temp.test_login_leadership(pg_temp.u1150(1));
select lives_ok($$select public.cancel_event(pg_temp.event('Gală #1150'), 'Amânată.')$$,
  'its author, below BC, cancels the Organization Event');
reset role;
select pg_temp.test_clear_jwt();
select results_eq(
  $$select title, approval_status from announcements where id = pg_temp.annc('Gală #1150')$$,
  $$select 'Anulat: Gală #1150'::text, 'approved'::text$$,
  'its Announcement reads as cancelled and stays published, not sent back to BC');
select is(pg_temp.reads(2, 'Gală #1150'), 1::bigint, 'and the organisation still reads it');

-- ==================== 8. Delete ====================
select pg_temp.test_login_leadership(pg_temp.u1150(2));
insert into announcement_reads(announcement_id, member_id) values (pg_temp.annc('Șters #1150'), pg_temp.u1150(2));
reset role;
select pg_temp.test_clear_jwt();
select is((select count(*) from notifications where subject = 'announcement:' || pg_temp.annc('Șters #1150')) > 0, true,
  'the Announcement has Notifications before the delete');
select pg_temp.test_login_leadership(pg_temp.u1150(1));
select lives_ok($$select public.delete_event(pg_temp.event('Șters #1150'))$$,
  'the Responsible deletes the Event for good');
reset role;
select pg_temp.test_clear_jwt();
select is((select count(*) from announcements where id = pg_temp.annc('Șters #1150')), 0::bigint,
  'a delete removes the Event''s Announcement');
select is((select count(*) from announcement_reads where announcement_id = pg_temp.annc('Șters #1150')), 0::bigint,
  'its reads cascade');
select is((select count(*) from notifications where subject = 'announcement:' || pg_temp.annc('Șters #1150')), 0::bigint,
  'and its Notifications go with it');
select is((select count(*) from announcements where title = 'Anunț obișnuit #1150'), 1::bigint,
  'an Announcement no Event wrote is untouched');
select is((select title || ' / ' || body from announcements where title = 'Anunț obișnuit #1150'),
          'Anunț obișnuit #1150 / Corp obișnuit.',
  'and so is its text');
select is((select count(*) from announcements where id = pg_temp.annc('Curs #1150')), 1::bigint,
  'deleting one Event leaves the other Events'' Announcements');

select * from finish();
rollback;
