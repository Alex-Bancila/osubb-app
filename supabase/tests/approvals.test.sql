-- Cerere de aprobare (spec docs/superpowers/specs/2026-10-11-org-wide-approval-design.md):
-- an Announcement or Event on the Organization Group by a writer below BC waits
-- for a BC member or the Moderator, who approve it from its own form or reject
-- it with a reason; BC and the Moderator publish OSUBB-wide at once. Personas
-- (prefix 4700): 1 BCE, Manager of Dept A (holds a Group Role, so may post
-- OSUBB-wide); 2 BC; 3 Moderator; 4 Voluntar, member of Dept A; 5 Voluntar on
-- no roster.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(104);

create function pg_temp.u47(n integer) returns uuid language sql immutable as $$
  select ('47000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
grant execute on function pg_temp.u47(integer) to authenticated, anon;
insert into auth.users (id, email)
select pg_temp.u47(n), 'm47.' || n || '@test.local' from generate_series(1, 5) n;
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.u47(n), 'Membru 47 ' || n, 'm47.' || n || '@test.local',
       (case n when 1 then 'bce' when 2 then 'bc' when 3 then 'moderator' else 'voluntar' end)::public.member_role, 'activ'
  from generate_series(1, 5) n;
insert into public.groups (name, category, min_level) values ('Dept A #4700', 'department', 0);
insert into public.group_members (group_id, member_id, group_role)
select g.id, pg_temp.u47(r.n), r.role
  from (values (1, 'manager'), (4, 'member')) as r (n, role)
  join public.groups as g on g.name = 'Dept A #4700';
create temp table fx47 as
select (select id from public.groups where is_organization) as org,
       (select id from public.groups where name = 'Dept A #4700') as dept;
grant select on fx47 to authenticated;
create function pg_temp.ann(p_title text) returns public.announcements language sql stable security definer set search_path = '' as $$
  select * from public.announcements where title = p_title
$$;
create function pg_temp.ev(p_title text) returns public.events language sql stable security definer set search_path = '' as $$
  select * from public.events where title = p_title
$$;
-- The Members told under one title, as persona numbers.
create function pg_temp.told(p_title text) returns setof integer language sql stable security definer set search_path = '' as $$
  select right(member_id::text, 12)::integer from public.notifications
   where title = p_title and member_id::text like '47000000-%' order by 1
$$;

-- ==================== 1. the stamp ====================
select pg_temp.test_login_leadership(pg_temp.u47(1));
insert into announcements (title, body, group_id, audience) select 'Ann pending #4700', 'x', org, 'org' from fx47;
insert into announcements (title, body, group_id, audience) select 'Ann local #4700', 'x', dept, 'local' from fx47;
reset role;
select is((pg_temp.ann('Ann pending #4700')).approval_status, 'pending',
  'an OSUBB-wide Announcement by a BCE waits for approval');
select is((pg_temp.ann('Ann local #4700')).approval_status, 'approved',
  'a local Group Announcement by the same author publishes at once');
select is((select count(*) from pg_temp.told('Anunț nou: Ann pending #4700'))::int, 0,
  'nobody is told of a pending Announcement');
select results_eq($$select * from pg_temp.told('Cerere de aprobare: Ann pending #4700')$$, $$values (2), (3)$$,
  'BC and the Moderator get one request each');
select pg_temp.test_login_leadership(pg_temp.u47(2));
insert into announcements (title, body, group_id, audience) select 'Ann by BC #4700', 'x', org, 'org' from fx47;
reset role;
select is((pg_temp.ann('Ann by BC #4700')).approval_status, 'approved', 'BC publishes OSUBB-wide at once');
select ok(4 in (select * from pg_temp.told('Anunț nou: Ann by BC #4700')), 'and its fan-out ran');

-- ==================== 2. who sees a pending row ====================
select pg_temp.test_login_leadership(pg_temp.u47(4));
select is((select count(*) from announcements where title = 'Ann pending #4700'), 0::bigint,
  'a third Member cannot read a pending Announcement');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(1));
-- The badge counts through the feed's copy of announcements_read: for anyone
-- else the row is not theirs to read; for the author it is visible, and
-- still never counts as unread.
select is(public.my_unread_announcements_count('announcement'),
  (select count(*)::int from announcements as a
    where a.kind = 'announcement' and a.approval_status = 'approved'
      and (a.priority = 'critical' or a.audience = 'org' or not private.is_group_muted(a.group_id))
      and not exists (select 1 from announcement_reads as r where r.announcement_id = a.id and r.member_id = pg_temp.u47(1))),
  'the author''s own pending Announcement never counts as unread');
select is((select count(*) from announcements where title = 'Ann pending #4700'), 1::bigint,
  'the author reads their own pending Announcement');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(3));
select is((select count(*) from announcements where title = 'Ann pending #4700'), 1::bigint, 'the Moderator reads it too');
reset role;

-- ==================== 3. re-entering review ====================
select pg_temp.test_login_leadership(pg_temp.u47(2));
update announcements set body = 'edited by BC' where title = 'Ann by BC #4700';
reset role;
select is((pg_temp.ann('Ann by BC #4700')).approval_status, 'approved', 'a BC edit never changes the status');
select pg_temp.test_login_leadership(pg_temp.u47(1));
insert into announcements (title, body, group_id, audience) select 'Ann approved later #4700', 'x', org, 'org' from fx47;
reset role;
-- As the owner, standing in for the approve command (Task 2): the stamp honours
-- the decision flag.
select set_config('osubb.deciding_approval', 'on', true);
update announcements set approval_status = 'approved', approval_decided_by = pg_temp.u47(2), approval_decided_at = now()
 where title = 'Ann approved later #4700';
select set_config('osubb.deciding_approval', 'off', true);
select is((pg_temp.ann('Ann approved later #4700')).approval_status, 'approved', 'precondition: approved by hand');
-- R50 (2026-10-13): the author cannot pin an organisation-wide Announcement; BC's pin is no content edit.
select pg_temp.test_login_leadership(pg_temp.u47(1));
select throws_ok($$update announcements set pinned = true where title = 'Ann approved later #4700'$$,
  '42501', 'announcement_pin_forbidden', 'the author cannot pin an organisation-wide Announcement (R50)');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(2));
update announcements set pinned = true where title = 'Ann approved later #4700';
reset role;
select is((pg_temp.ann('Ann approved later #4700')).approval_status, 'approved', 'a pin by BC is not a content edit');
select pg_temp.test_login_leadership(pg_temp.u47(1));
update announcements set body = 'edited by the author' where title = 'Ann approved later #4700';
reset role;
select is((pg_temp.ann('Ann approved later #4700')).approval_status, 'pending',
  'the author editing an approved OSUBB-wide Announcement re-enters review');
select is((pg_temp.ann('Ann approved later #4700')).approval_decided_by, null, 'and the old decision is cleared');
select is((select count(*) from pg_temp.told('Cerere de aprobare: Ann approved later #4700'))::int, 2,
  'BC and the Moderator are asked again');
select pg_temp.test_login_leadership(pg_temp.u47(1));
update announcements set approval_status = 'approved' where title = 'Ann pending #4700';
reset role;
select is((pg_temp.ann('Ann pending #4700')).approval_status, 'pending', 'a client cannot write the status');

-- ==================== 4. Events ====================
select pg_temp.test_login_leadership(pg_temp.u47(1));
select lives_ok($$select public.create_event('Ev pending #4700', 'activitate', (select org from fx47), '2031-05-05 10:00+00')$$,
  'a BCE creates an OSUBB-wide Event');
select lives_ok($$select public.create_event('Ev announced #4700', 'activitate', (select org from fx47), '2031-05-06 10:00+00',
  p_announce => true)$$, 'and one that asks for its Announcement');
reset role;
select is((pg_temp.ev('Ev pending #4700')).approval_status, 'pending', 'the Event waits for approval');
select is((select count(*) from pg_temp.told('Eveniment nou: Ev pending #4700'))::int, 0, 'nobody is told of a pending Event');
select results_eq($$select * from pg_temp.told('Cerere de aprobare: Ev pending #4700')$$, $$values (2), (3)$$,
  'BC and the Moderator get the request');
select is((pg_temp.ev('Ev announced #4700')).announce_on_approval, true, 'the Announcement waits for the approval');
select is((select count(*) from announcements where title = 'Ev announced #4700'), 0::bigint, 'so no Announcement row exists yet');
select pg_temp.test_login_leadership(pg_temp.u47(4));
select is((select count(*) from events where title = 'Ev pending #4700'), 0::bigint, 'a third Member cannot read a pending Event');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(2));
select lives_ok($$select public.create_event('Ev by BC #4700', 'activitate', (select org from fx47), '2031-05-07 10:00+00')$$,
  'BC creates one');
reset role;
select is((pg_temp.ev('Ev by BC #4700')).approval_status, 'approved', 'published at once');
select ok(4 in (select * from pg_temp.told('Eveniment nou: Ev by BC #4700')), 'and its audience is told');
select pg_temp.test_login_leadership(pg_temp.u47(1));
select lives_ok($$select public.create_event('Ev to cancel #4700', 'activitate', (select dept from fx47), '2031-05-08 10:00+00')$$,
  'a local Event by the BCE');
reset role;
-- As the owner, no caller (the claims cleared): an approved OSUBB-wide Event of the BCE.
select pg_temp.test_clear_jwt();
update events set group_id = (select org from fx47) where title = 'Ev to cancel #4700';
select is((pg_temp.ev('Ev to cancel #4700')).approval_status, 'approved', 'precondition: approved (moved by the owner, no caller)');
select pg_temp.test_login_leadership(pg_temp.u47(1));
select lives_ok($$select public.cancel_event((pg_temp.ev('Ev to cancel #4700')).id, 'Nu mai e nevoie')$$, 'the author cancels it');
reset role;
select is((pg_temp.ev('Ev to cancel #4700')).approval_status, 'approved', 'a cancellation is not a content edit: no re-entry');


-- ==================== 5. decisions ====================
select pg_temp.test_login_leadership(pg_temp.u47(4));
select throws_ok($$select public.approve_announcement((pg_temp.ann('Ann pending #4700')).id)$$, '42501', 'approval_forbidden',
  'a Member below BC cannot approve');
select throws_ok($$select public.reject_event((pg_temp.ev('Ev pending #4700')).id, 'x')$$, '42501', 'approval_forbidden', 'nor reject');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(2));
select throws_ok($$select public.reject_announcement((pg_temp.ann('Ann pending #4700')).id, '  ')$$, 'PT400', 'rejection_reason_required',
  'a rejection needs its reason');
select throws_ok($$select public.reject_announcement((pg_temp.ann('Ann pending #4700')).id, repeat('x', 1001))$$, 'PT400', 'rejection_reason_too_long',
  'of at most 1000 characters');
select throws_ok($$select public.approve_announcement((pg_temp.ann('Ann by BC #4700')).id)$$, 'PT409', 'announcement_not_pending',
  'an approved Announcement is not decided again');
select throws_ok($$select public.approve_announcement(0)$$, 'PT404', 'announcement_not_found', 'an unknown id');
select lives_ok($$select public.reject_announcement((pg_temp.ann('Ann pending #4700')).id, 'Lipsesc detaliile.')$$, 'BC rejects with a reason');
reset role;
select is((pg_temp.ann('Ann pending #4700')).approval_status, 'rejected', 'the Announcement is rejected');
select is((pg_temp.ann('Ann pending #4700')).rejection_reason, 'Lipsesc detaliile.', 'with the reason');
select results_eq($$select * from pg_temp.told('Anunțul tău a fost respins: Ann pending #4700')$$, $$values (1)$$, 'the author is told');
select is((select body from notifications where title = 'Anunțul tău a fost respins: Ann pending #4700' limit 1), 'Lipsesc detaliile.',
  'with the reason as the body');
select pg_temp.test_login_leadership(pg_temp.u47(4));
select is((select count(*) from announcements where title = 'Ann pending #4700'), 0::bigint, 'a rejected Announcement stays invisible to others');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(1));
update announcements set body = 'now with details' where title = 'Ann pending #4700';
reset role;
select is((pg_temp.ann('Ann pending #4700')).approval_status, 'pending', 'the author''s edit re-submits a rejected Announcement');
select is((pg_temp.ann('Ann pending #4700')).rejection_reason, null, 'and clears the reason');
select pg_temp.test_login_leadership(pg_temp.u47(3));
update announcements set body = 'tidied by the Moderator' where title = 'Ann pending #4700';
select lives_ok($$select public.approve_announcement((pg_temp.ann('Ann pending #4700')).id)$$, 'the Moderator edits and approves it');
reset role;
select is((pg_temp.ann('Ann pending #4700')).approval_status, 'approved', 'approved');
select is((pg_temp.ann('Ann pending #4700')).approval_decided_by, pg_temp.u47(3), 'by the Moderator');
select is((pg_temp.ann('Ann pending #4700')).created_by, pg_temp.u47(1), 'still posted by its author');
select is((pg_temp.ann('Ann pending #4700')).body, 'tidied by the Moderator', 'with the Moderator''s edit');
select results_eq($$select * from pg_temp.told('Anunț nou: Ann pending #4700')$$, $$values (4), (5)$$,
  'the fan-out runs once, on approval, and never to the author');
select results_eq($$select * from pg_temp.told('Anunțul tău a fost aprobat: Ann pending #4700')$$, $$values (1)$$, 'the author is told');
select pg_temp.test_login_leadership(pg_temp.u47(4));
select is((select count(*) from announcements where title = 'Ann pending #4700'), 1::bigint, 'and everyone reads it now');
reset role;

-- ==================== 6. Events: approval and the Announcement on behalf ====================
select pg_temp.test_login_leadership(pg_temp.u47(3));
select lives_ok($$select public.approve_event((pg_temp.ev('Ev pending #4700')).id)$$, 'the Moderator approves the Event');
select lives_ok($$select public.approve_event((pg_temp.ev('Ev announced #4700')).id)$$, 'and the announced one');
select throws_ok($$select public.approve_event((pg_temp.ev('Ev pending #4700')).id)$$, 'PT409', 'event_not_pending', 'not twice');
select throws_ok($$select public.reject_event((pg_temp.ev('Ev by BC #4700')).id, 'x')$$, 'PT409', 'event_not_pending', 'nor an approved one rejected');
reset role;
select results_eq($$select * from pg_temp.told('Eveniment nou: Ev pending #4700')$$, $$values (4), (5)$$,
  'the audience hears of the approved Event once, the author not');
select is((select count(*) from pg_temp.told('Eveniment nou: Ev announced #4700'))::int, 0,
  'an announced Event tells through its Announcement only');
select is((pg_temp.ann('Ev announced #4700')).created_by, pg_temp.u47(1), 'the Announcement is written as the Event''s author');
select is((pg_temp.ann('Ev announced #4700')).approval_status, 'approved', 'approved');
select is((pg_temp.ev('Ev announced #4700')).announce_on_approval, false, 'and the flag is spent');
select results_eq($$select * from pg_temp.told('Anunț nou: Ev announced #4700')$$, $$values (4), (5)$$, 'its fan-out ran, never to the author');
select results_eq($$select * from pg_temp.told('Evenimentul tău a fost aprobat: Ev pending #4700')$$, $$values (1)$$, 'the author is told');
select pg_temp.test_login_leadership(pg_temp.u47(4));
select is((select count(*) from events where title = 'Ev pending #4700'), 1::bigint, 'and reads the Event now');
reset role;

-- ==================== 7. the requests read ====================
select pg_temp.test_login_leadership(pg_temp.u47(1));
insert into announcements (title, body, group_id, audience) select 'Ann listed #4700', 'x', org, 'org' from fx47;
select lives_ok($$select public.create_event('Ev listed #4700', 'activitate', (select org from fx47), '2031-06-01 10:00+00')$$,
  'one more of each, pending');
select is((select count(*) from public.approval_requests()), 0::bigint, 'the read answers nothing below BC');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(2));
select set_eq($$select kind, title from public.approval_requests() where title like '%#4700'$$,
  $$values ('event', 'Ev listed #4700'), ('announcement', 'Ann listed #4700'), ('announcement', 'Ann approved later #4700')$$,
  'BC lists the pending rows of both kinds');
reset role;
select pg_temp.test_clear_jwt(); set local role authenticated;
select throws_ok($$select public.approve_announcement(1)$$, '42501', null, 'no claims, no decision');
reset role;

-- ==================== 8. the review's two gaps ====================
-- An Announcement with the organisation Audience from a local Group reaches the
-- whole OSUBB: it waits like one on the Organization Group.
select pg_temp.test_login_leadership(pg_temp.u47(1));
insert into announcements (title, body, group_id, audience) select 'Ann org audience #4700', 'x', dept, 'org' from fx47;
reset role;
select is((pg_temp.ann('Ann org audience #4700')).approval_status, 'pending',
  'an organisation-Audience Announcement from a Department waits for approval');
select results_eq($$select * from pg_temp.told('Cerere de aprobare: Ann org audience #4700')$$, $$values (2), (3)$$,
  'and BC and the Moderator are asked');
-- An edit of a pending Event tells no audience.
select pg_temp.test_login_leadership(pg_temp.u47(1));
select lives_ok($$select public.update_event((pg_temp.ev('Ev listed #4700')).id, 'Ev listed edited #4700', 'activitate',
  (select org from fx47), '2031-06-01 10:00+00', null, null, null, null, 0, null)$$,
  'the author edits their pending Event');
reset role;
select is((select count(*) from pg_temp.told('Eveniment actualizat: Ev listed edited #4700'))::int, 0,
  'nobody hears of a change to a pending Event');

-- ==================== 9. no answer to a request ====================
select pg_temp.test_login_leadership(pg_temp.u47(4));
select throws_ok($$select public.set_event_rsvp((pg_temp.ev('Ev listed edited #4700')).id, 'going')$$, 'PT404', 'event_not_visible',
  'a Member cannot RSVP to a pending Event they cannot see');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(1));
select throws_ok($$select public.set_event_rsvp((pg_temp.ev('Ev listed edited #4700')).id, 'going')$$, 'PT404', 'event_not_visible',
  'nor its author, until it is published');
select lives_ok($$select public.set_event_rsvp((pg_temp.ev('Ev pending #4700')).id, 'going')$$,
  'an approved Event takes the answer');
reset role;

-- ==================== 10. the final review's fixes (2026-10-13) ====================
-- I1: a cancelled pending Event is no request, and BC cannot publish it.
select pg_temp.test_login_leadership(pg_temp.u47(1));
select lives_ok($$select public.create_event('Ev cancelled #4700', 'activitate', (select org from fx47), '2031-07-01 10:00+00')$$,
  'a BCE asks for an OSUBB-wide Event');
select lives_ok($$select public.cancel_event((pg_temp.ev('Ev cancelled #4700')).id, 'Nu mai are loc')$$,
  'and cancels it while it waits');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(2));
select is((select count(*) from public.approval_requests() as r where r.kind = 'event' and r.id = (pg_temp.ev('Ev cancelled #4700')).id)::int, 0,
  'a cancelled pending Event leaves the Cereri de aprobare');
select throws_ok($$select public.approve_event((pg_temp.ev('Ev cancelled #4700')).id)$$, 'PT409', 'event_cancelled',
  'and cannot be approved');
select throws_ok($$select public.reject_event((pg_temp.ev('Ev cancelled #4700')).id, 'x')$$, 'PT409', 'event_cancelled',
  'nor rejected');
reset role;

-- I1: an Event approved after it started gets no Announcement (its Termen
-- would be in the past), only the notice.
select pg_temp.test_login_leadership(pg_temp.u47(1));
select lives_ok($$select public.create_event('Ev started #4700', 'activitate', (select org from fx47), '2031-07-02 10:00+00',
  p_announce => true)$$, 'a BCE asks for an Event with its Announcement');
reset role;
select pg_temp.test_clear_jwt();
update public.events set starts_at = now() - interval '1 hour', ends_at = null where title = 'Ev started #4700';
select pg_temp.test_login_leadership(pg_temp.u47(2));
select lives_ok($$select public.approve_event((pg_temp.ev('Ev started #4700')).id)$$, 'BC approves it after it has started');
reset role;
select is((select count(*) from public.announcements where title = 'Ev started #4700')::int, 0,
  'no Announcement with a Termen in the past is written');
select results_eq($$select * from pg_temp.told('Eveniment nou: Ev started #4700')$$, $$values (4), (5)$$,
  'the audience hears of the Event itself');

-- I2: a pending or rejected Event moved off the Organization Group needs no
-- approval any more: the move publishes it to its new Group, as a new Event.
select pg_temp.test_login_leadership(pg_temp.u47(1));
select lives_ok($$select public.create_event('Ev move local #4700', 'activitate', (select org from fx47), '2031-07-03 10:00+00')$$,
  'a BCE asks for an OSUBB-wide Event');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(2));
select lives_ok($$select public.reject_event((pg_temp.ev('Ev move local #4700')).id, 'Fă-l de departament')$$, 'BC rejects it');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(1));
select lives_ok($$select public.update_event((pg_temp.ev('Ev move local #4700')).id, 'Ev move local #4700', 'activitate',
  (select dept from fx47), '2031-07-03 10:00+00', null, null, null, null, 0, null)$$,
  'the author moves it to their Department');
reset role;
select is((pg_temp.ev('Ev move local #4700')).approval_status, 'approved',
  'a local Event needs no approval: the move publishes it');
select is((pg_temp.ev('Ev move local #4700')).rejection_reason, null::text, 'with the decision cleared');
select results_eq($$select * from pg_temp.told('Eveniment nou: Ev move local #4700')$$, $$values (4)$$,
  'the Department hears of it as a new Event');
select is((select count(*) from pg_temp.told('Eveniment actualizat: Ev move local #4700'))::int, 0,
  'and nobody hears of the move of an Event they never saw');

-- M4 (as revised by the security review of 2026-10-13): any writer below BC
-- changing the content asks again; a Campaign change never does; a row that
-- becomes OSUBB-wide by an update below BC is a request whoever made it.
select pg_temp.test_login_leadership(pg_temp.u47(1));
insert into announcements (title, body, group_id, audience) select 'Ann reentry #4700', 'x', org, 'local' from fx47;
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(2));
select lives_ok($$select public.approve_announcement((pg_temp.ann('Ann reentry #4700')).id)$$, 'BC approves it');
reset role;
-- Another Member below BC (claims kept, RLS off): the stamp sees them as the actor.
select pg_temp.test_login_leadership(pg_temp.u47(5));
reset role;
update public.announcements set body = 'edited by another' where title = 'Ann reentry #4700';
select is((pg_temp.ann('Ann reentry #4700')).approval_status, 'pending',
  'a content change by any writer below BC asks again');
select pg_temp.test_clear_jwt();
-- A Campaign is a label (ADR-0007): attaching or clearing one asks nobody.
insert into public.campaigns (group_id, name, created_by) select org, 'Campanie #4700', pg_temp.u47(2) from fx47;
select pg_temp.test_login_leadership(pg_temp.u47(1));
reset role;
update public.events set campaign_id = (select id from public.campaigns where name = 'Campanie #4700') where title = 'Ev pending #4700';
select is((pg_temp.ev('Ev pending #4700')).approval_status, 'approved', 'a Campaign change on an approved Event re-enters nothing');
select pg_temp.test_clear_jwt();
-- A Group Manager below BC moves a member's local Event onto the Organization
-- Group: a request, though the manager is not its author.
insert into public.events (title, type, group_id, starts_at, created_by)
  select 'Ev moved up #4700', 'activitate', dept, '2031-08-01 10:00+00', pg_temp.u47(4) from fx47;
select pg_temp.test_login_leadership(pg_temp.u47(1));
select lives_ok($$select public.update_event((pg_temp.ev('Ev moved up #4700')).id, 'Ev moved up #4700', 'activitate',
  (select org from fx47), '2031-08-01 10:00+00', null, null, null, null, 0, null)$$,
  'the Department''s Manager moves a member''s Event onto the Organization Group');
reset role;
select is((pg_temp.ev('Ev moved up #4700')).approval_status, 'pending', 'which makes it a request, whoever moved it');
-- #1130 (audit M7): the move made the Event pending, so events_read hides it
-- from everyone -- the Department's own audience included -- and the move
-- tells nobody of it, not even its old Group; they hear of it at approval, as
-- the rest of the organisation does.
select is((select count(*) from public.notifications as n
            where n.dedupe_key like 'event:' || (pg_temp.ev('Ev moved up #4700')).id || ':%'
              and n.member_id::text like '47000000-%')::int, 0,
  'and tells nobody of an Event they cannot read yet, the Department''s own audience included');
select pg_temp.test_login_leadership(pg_temp.u47(2));
select lives_ok($$select public.approve_event((pg_temp.ev('Ev moved up #4700')).id)$$, 'BC approves the moved Event');
reset role;
select results_eq($$select * from pg_temp.told('Eveniment nou: Ev moved up #4700')$$, $$values (1), (5)$$,
  'at approval the Department''s Manager and the rest of the organisation hear of it as a new Event');
select results_eq($$select * from pg_temp.told('Evenimentul tău a fost aprobat: Ev moved up #4700')$$, $$values (4)$$,
  'and its author, the Department''s member, that it was approved');

-- M7: the decision flag covers no insert.
select pg_temp.test_login_leadership(pg_temp.u47(1));
select set_config('osubb.deciding_approval', 'on', true);
insert into announcements (title, body, group_id, audience) select 'Ann flagged insert #4700', 'x', org, 'local' from fx47;
select set_config('osubb.deciding_approval', 'off', true);
reset role;
select is((pg_temp.ann('Ann flagged insert #4700')).approval_status, 'pending', 'the decision flag covers no insert');

select * from finish();
rollback;
