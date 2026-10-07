-- Ruling R43 (2026-10-07): Grupuri preferate for level >= 5. A BCE, BC or Moderator
-- unselects Groups; an unselected Group sends them no Notification and leaves their
-- Anunturi badge, its Application and Completed-work Request Notifications skip them,
-- and Clasament's preferred view leaves its points out. Every Group starts selected,
-- one created later too; the Organization Group, the Adunarea Generala and Biroul de
-- Conducere cannot be unselected; a position, a going RSVP, a critical Announcement
-- and a Member's own Tasks are never muted; nothing changes below level 5.
--
-- Mutation proofs (each run once against this suite, then reverted):
--   * private.group_notification_audience back to R42's body (no muting): tests
--     18, 23, 29, 33 and 37 fail;
--   * private.group_muted_for without its live-level test: 24, 25 and 29 fail
--     (a stale row below level 5 mutes); without its group_preference_lock test:
--     26, 27 and 43 fail;
--   * private.group_preference_lock without its position branch: 26 and 43 fail;
--     without its org_settings branches: 2, 8, 13, 18 and 27 fail;
--   * fan_out_announcement reading the muted audience for a critical Announcement:
--     34 and 36 fail; announcement_readers_impl doing the same: 36 fails;
--   * my_unread_announcements_count without its R43 clause, or without its
--     critical / organization-wide exceptions: 38 fails;
--   * group_application_recipients without its R43 filter: 41 fails;
--   * create_completed_work_request_impl notifying request_deciders unfiltered:
--     43 fails;
--   * leadership_leaderboard_impl ignoring p_preferred: 45 fails;
--   * set_unselected_groups_impl without its level gate: 4 fails; without the lock
--     step: 8, 9, 10, 13 and 18 fail; without the delete (no full replace): 7, 13,
--     17 and 19 fail.
--
-- Personas (prefix 4343):
--   1 bce       activ  member of Parent P43 and Child P43 -- the one who unselects
--   2 bce       activ  member of Parent P43 and Child P43 -- keeps everything
--   3 bce       activ  Manager of Parent P43 -- a position reaching Child P43
--   4 bc        activ  no roster row -- a decider by rank
--   5 voluntar  activ  member of Parent P43 and Child P43 -- files a Request
--   6 voluntar  activ  member of Child P43 -- a stale row below level 5
--   7 moderator activ  the author of every Event and Announcement
--
-- Groups: Parent P43 > Child P43; Peer P43 (no Manager anywhere); AG P43 and
-- Board P43, named by org_settings for this transaction.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(46);

create function pg_temp.u43(n integer) returns uuid language sql immutable as $$
  select ('43430000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users(id, email)
select pg_temp.u43(n), 'preferate.' || n || '.r43@test.local' from generate_series(1, 7) n;
insert into public.profiles(id, full_name, email, role, status)
select pg_temp.u43(n), 'Preferate R43 ' || n, 'preferate.' || n || '.r43@test.local',
       (case n when 1 then 'bce' when 2 then 'bce' when 3 then 'bce' when 4 then 'bc'
               when 7 then 'moderator' else 'voluntar' end)::public.member_role,
       'activ'::public.member_status
  from generate_series(1, 7) n;

insert into public.groups(name, category, min_level) values ('Parent P43', 'department', 0);
insert into public.groups(name, category, min_level) values ('Peer P43', 'department', 0);
insert into public.groups(name, category, min_level) values ('AG P43', 'department', 0);
insert into public.groups(name, category, min_level) values ('Board P43', 'department', 0);
insert into public.groups(name, category, parent_id, min_level)
select 'Child P43', 'team', id, 0 from public.groups where name = 'Parent P43';
insert into public.group_members(group_id, member_id, group_role)
select grp.id, pg_temp.u43(roster.n), roster.role
  from (values ('Parent P43', 1, 'member'), ('Child P43', 1, 'member'),
               ('Parent P43', 2, 'member'), ('Child P43', 2, 'member'),
               ('Parent P43', 3, 'manager'),
               ('Parent P43', 5, 'member'), ('Child P43', 5, 'member'),
               ('Child P43', 6, 'member')) as roster(name, n, role)
  join public.groups as grp on grp.name = roster.name;

create temp table g43 as select name, id from public.groups where name like '% P43';
grant select on g43 to authenticated;
create function pg_temp.g43(p_name text) returns bigint language sql stable as $$
  select id from g43 where name = p_name
$$;
update public.org_settings set value = pg_temp.g43('AG P43')::text where key = 'adunarea_generala_group_id';
update public.org_settings set value = pg_temp.g43('Board P43')::text where key = 'board_group_id';

-- The personas among a set of members, as numbers.
create function pg_temp.who(p_members uuid[]) returns integer[] language sql immutable as $$
  select coalesce(array_agg(right(member::text, 12)::integer order by right(member::text, 12)::integer), '{}')
    from unnest(p_members) as member
   where member::text like '43430000-%'
$$;
create function pg_temp.notified(p_title text) returns integer[] language sql stable as $$
  select pg_temp.who(array(select member_id from public.notifications where title = p_title))
$$;
create function pg_temp.audience(p_group text) returns integer[] language sql stable as $$
  select pg_temp.who(array(select private.group_notification_audience(pg_temp.g43(p_group))))
$$;
create function pg_temp.unselected_of(p_member integer) returns text[] language sql stable as $$
  select coalesce(array_agg(g.name order by g.name), '{}')
    from public.member_group_unselected as row_
    join g43 as g on g.id = row_.group_id
   where row_.member_id = pg_temp.u43(p_member)
$$;

-- ==================== default: everything selected ====================

select pg_temp.test_login_leadership(pg_temp.u43(1));
select is(
  (select count(*) from public.my_group_preferences() as pref
    where pref.group_id in (select id from g43) and not pref.selected),
  0::bigint,
  'a BCE with no saved preference has every Group selected');
select is(
  (select array_agg(pref.locked order by g.name) from public.my_group_preferences() as pref
     join g43 as g on g.id = pref.group_id),
  array['adunarea_generala', 'board', null, null, null]::text[],
  'my_group_preferences names the Adunarea Generala and Biroul de Conducere locked, nothing else of these');
select is(
  (select locked from public.my_group_preferences() where group_id = (select id from public.groups where is_organization)),
  'organization',
  'the Organization Group is locked');
reset role;

-- ==================== the command ====================

select pg_temp.test_login_leadership(pg_temp.u43(5));
select throws_ok($$select public.set_unselected_groups(array[pg_temp.g43('Child P43')])$$,
  '42501', 'group_preference_forbidden',
  'below level 5 there is no preference to save');
select is((select count(*) from public.my_group_preferences()), 0::bigint,
  'and below level 5 my_group_preferences returns nothing');
reset role;

select pg_temp.test_login_leadership(pg_temp.u43(1));
select lives_ok($$select public.set_unselected_groups(array[pg_temp.g43('Parent P43'), pg_temp.g43('Child P43'), pg_temp.g43('Peer P43')])$$,
  'a BCE saves a Group with its subgroup and another root');
select is(public.set_unselected_groups(array[pg_temp.g43('Child P43'), pg_temp.g43('Child P43')]),
  array[pg_temp.g43('Child P43')],
  'the next save replaces the whole set -- a subgroup alone, duplicates folded');
select throws_ok($$select public.set_unselected_groups(array[pg_temp.g43('AG P43')])$$,
  'PT409', 'group_preference_locked', 'the Adunarea Generala cannot be unselected');
select throws_ok($$select public.set_unselected_groups(array[(select id from public.groups where is_organization)])$$,
  'PT409', 'group_preference_locked', 'nor the Organization Group');
reset role;
select pg_temp.test_login_leadership(pg_temp.u43(4));
select throws_ok($$select public.set_unselected_groups(array[pg_temp.g43('Board P43')])$$,
  'PT409', 'group_preference_locked', 'nor Biroul de Conducere');
reset role;
select pg_temp.test_login_leadership(pg_temp.u43(1));
select throws_ok($$select public.set_unselected_groups(array[-43::bigint])$$,
  'PT404', 'group_not_found', 'an unknown Group is not found');
select throws_ok($$select public.set_unselected_groups(array[null::bigint])$$,
  'PT400', 'invalid_group_ids', 'a null id is malformed');
select is(pg_temp.unselected_of(1), array['Child P43'],
  'a refused save changes nothing');

-- Another Member's rows are invisible, and the table has no direct write path.
reset role;
select pg_temp.test_login_leadership(pg_temp.u43(2));
select lives_ok($$select public.set_unselected_groups(array[pg_temp.g43('Peer P43')])$$,
  'a second BCE saves their own');
select is((select array_agg(member_id) from public.member_group_unselected),
  array[pg_temp.u43(2)],
  'a Member reads only their own rows');
select throws_ok($$insert into public.member_group_unselected(member_id, group_id) values (pg_temp.u43(2), pg_temp.g43('Parent P43'))$$,
  '42501', null, 'no direct insert');
reset role;
-- Clear Persona 2's again: they keep everything for the rest of the suite.
select pg_temp.test_login_leadership(pg_temp.u43(2));
select is(public.set_unselected_groups('{}'), '{}'::bigint[], 'an empty save selects every Group again');
reset role;

-- ==================== explicit per Group, positions, level ====================

select is(pg_temp.audience('Child P43'), array[2, 5, 6],
  'the unselected subgroup''s audience leaves its BCE out; the position holder above (3) is no member of it');
select is(pg_temp.audience('Parent P43'), array[1, 2, 3, 5, 6],
  'the parent, still selected, keeps them: nothing is inherited at read time');

-- A Group created later starts selected.
insert into public.groups(name, category, parent_id, min_level)
select 'Late P43', 'team', id, 0 from public.groups where name = 'Child P43';
insert into public.group_members(group_id, member_id, group_role)
select id, pg_temp.u43(1), 'member' from public.groups where name = 'Late P43';
insert into g43 select name, id from public.groups where name = 'Late P43';
select is(pg_temp.audience('Late P43'), array[1],
  'a Group created later -- even under an unselected one -- starts selected');
select pg_temp.test_login_leadership(pg_temp.u43(1));
select is((select selected from public.my_group_preferences() where group_id = pg_temp.g43('Late P43')), true,
  'and my_group_preferences says so');
reset role;

-- Parent and subgroup both unselected: both muted.
select pg_temp.test_login_leadership(pg_temp.u43(1));
select lives_ok($$select public.set_unselected_groups(array[pg_temp.g43('Parent P43'), pg_temp.g43('Child P43')])$$,
  'the BCE unselects the parent with its subgroup');
reset role;
select is(pg_temp.audience('Parent P43'), array[2, 3, 5, 6],
  'the parent''s audience now leaves them out too');

-- Below level 5 a row never mutes (here a stale one, as if left by a demotion).
insert into public.member_group_unselected(member_id, group_id) values (pg_temp.u43(6), pg_temp.g43('Child P43'));
select ok(6 = any (pg_temp.audience('Child P43')),
  'a stale row of a Member below level 5 mutes nothing');
update public.profiles set role = 'voluntar' where id = pg_temp.u43(1);
select ok(1 = any (pg_temp.audience('Child P43')),
  'nor does a BCE''s own row once they are demoted -- the live level decides');
update public.profiles set role = 'bce' where id = pg_temp.u43(1);

-- A position is never muted: the Manager of Parent P43 unselects both.
insert into public.member_group_unselected(member_id, group_id)
values (pg_temp.u43(3), pg_temp.g43('Parent P43')), (pg_temp.u43(3), pg_temp.g43('Child P43'));
select is(private.group_muted_for(pg_temp.g43('Child P43'), pg_temp.u43(3)), false,
  'a Manager''s position on a Group above is never muted');
-- A stale row on a locked Group (a setting moved onto it) mutes nothing.
insert into public.member_group_unselected(member_id, group_id) values (pg_temp.u43(2), pg_temp.g43('Peer P43'));
update public.org_settings set value = pg_temp.g43('Peer P43')::text where key = 'adunarea_generala_group_id';
select is(private.group_muted_for(pg_temp.g43('Peer P43'), pg_temp.u43(2)), false,
  'a row on a Group that has since become locked mutes nothing');
update public.org_settings set value = pg_temp.g43('AG P43')::text where key = 'adunarea_generala_group_id';
delete from public.member_group_unselected where member_id = pg_temp.u43(2);

-- ==================== Events ====================

select pg_temp.test_login_leadership(pg_temp.u43(7));
select lives_ok($$select public.create_event('Sedinta Child P43', 'sedinta', pg_temp.g43('Child P43'),
  '2030-11-01 15:00+00', '2030-11-01 16:00+00', 'Sala 1', null, null)$$,
  'the Moderator creates an Event on the unselected subgroup');
reset role;
select is(pg_temp.notified('Eveniment nou: Sedinta Child P43'), array[2, 5, 6],
  'a new Event of an unselected Group does not reach the BCE who unselected it');

-- A going attendee is never muted.
select pg_temp.test_login_leadership(pg_temp.u43(1));
select lives_ok($$select public.set_event_rsvp((select id from public.events where title = 'Sedinta Child P43'), 'going')$$,
  'the BCE answers Particip anyway');
reset role;
select pg_temp.test_login_leadership(pg_temp.u43(7));
select lives_ok($$select public.update_event((select id from public.events where title = 'Sedinta Child P43'),
  'Sedinta Child P43', 'sedinta', pg_temp.g43('Child P43'), '2030-11-02 15:00+00', '2030-11-02 16:00+00',
  'Sala 1', null, null, 0, null)$$,
  'the Moderator moves the Event');
reset role;
select ok(1 = any (pg_temp.notified('Eveniment actualizat: Sedinta Child P43')),
  'the change reaches the BCE who is going, whatever their preference');

-- ==================== Announcements ====================

select pg_temp.test_clear_jwt();
insert into public.announcements(title, body, group_id, audience, priority, created_by)
values ('Local Child P43', 'Body', pg_temp.g43('Child P43'), 'local', 'normal', pg_temp.u43(7)),
       ('Critical Child P43', 'Body', pg_temp.g43('Child P43'), 'local', 'critical', pg_temp.u43(7)),
       ('Org Child P43', 'Body', pg_temp.g43('Child P43'), 'org', 'normal', pg_temp.u43(7));

select ok(not (1 = any (pg_temp.notified('Anunț nou: Local Child P43'))) and 2 = any (pg_temp.notified('Anunț nou: Local Child P43')),
  'a local Announcement of an unselected Group skips the BCE who unselected it, not the one who did not');
select ok(1 = any (pg_temp.notified('Anunț nou: Critical Child P43')),
  'a critical Announcement reaches them anyway');
select ok(1 = any (pg_temp.notified('Anunț nou: Org Child P43')),
  'an organization-wide one reaches them too: the Organization Group is never muted');

create temp table critical43 as select pg_temp.notified('Anunț nou: Critical Child P43') as recipients;
grant select on critical43 to authenticated;
-- The Manager above reads the readers list (a local Announcement of their path).
select pg_temp.test_login_leadership(pg_temp.u43(3));
select is(
  (select pg_temp.who(array_agg(member_id)) from public.announcement_readers(
    (select id from public.announcements where title = 'Critical Child P43'))),
  (select recipients from critical43),
  'the readers list of a critical Announcement names the same recipients, the muted BCE included');
select ok(not (1 = any (pg_temp.who(array(select member_id from public.announcement_readers(
    (select id from public.announcements where title = 'Local Child P43')))))),
  'the readers list of a local one leaves them out, as the fan-out did');
reset role;

-- The badge: the BCE who unselected Child P43 does not count its local Announcement.
select pg_temp.test_login_leadership(pg_temp.u43(1));
create temp table badge43 as
  select public.my_unread_announcements_count() as muted_count;
reset role;
grant select on badge43 to authenticated;
select pg_temp.test_login_leadership(pg_temp.u43(2));
select is((select muted_count from badge43), public.my_unread_announcements_count() - 1,
  'the Anunturi badge ignores the unselected Group''s local Announcement -- one fewer than for a BCE who kept it');
reset role;
select pg_temp.test_login_leadership(pg_temp.u43(1));
select ok(
  (select count(*) from public.announcements as a
    where a.title in ('Critical Child P43', 'Org Child P43')
      and not exists (select 1 from public.announcement_reads as r where r.announcement_id = a.id and r.member_id = pg_temp.u43(1)))
  = 2 and (select muted_count from badge43) >= 2,
  'while the critical and the organization-wide ones still count');
reset role;

-- ==================== decisions waiting on them ====================

-- An Application to Peer P43, which has no Manager: the fallback is BC and the
-- Moderator. The BC member unselects Peer P43.
select pg_temp.test_login_leadership(pg_temp.u43(4));
select lives_ok($$select public.set_unselected_groups(array[pg_temp.g43('Peer P43'), pg_temp.g43('Child P43')])$$,
  'a BC member unselects a Group and a subgroup');
reset role;
insert into public.group_applications(group_id, member_id, note)
values (pg_temp.g43('Peer P43'), pg_temp.u43(5), 'Aplic R43');
select is(
  pg_temp.who(array(select private.group_application_recipients(
    (select id from public.group_applications where note = 'Aplic R43')))),
  array[7],
  'an Application to the unselected Group no longer notifies the BC member -- the Moderator still hears');

-- A Completed-work Request in Child P43: BC (4) unselected it and is not told,
-- the Manager above (3) is, and the BC member may still decide it.
select pg_temp.test_login_leadership(pg_temp.u43(5));
select lives_ok($$select public.create_completed_work_request('Am ajutat la R43', pg_temp.g43('Child P43'))$$,
  'a volunteer files a Completed-work Request in the subgroup');
reset role;
select is(pg_temp.notified('Cerere nouă: Am ajutat la R43'), array[3, 7],
  'the Request notifies the Manager above and the Moderator, not the BC member who unselected the Group');
select pg_temp.test_login_leadership(pg_temp.u43(4));
select ok(private.can_decide_request((select id from public.completed_work_requests where description = 'Am ajutat la R43')),
  'yet the BC member may still decide it: authority is unchanged');
reset role;

-- ==================== Clasament ====================

-- A Task in Child P43 and one in Peer P43, each credited to Persona 5.
insert into public.tasks (title, difficulty, rating, status, completed_at, group_id)
values ('R43 Child Task', 3, 4, 'completed', now(), pg_temp.g43('Child P43')),
       ('R43 Peer Task', 3, 4, 'completed', now(), pg_temp.g43('Peer P43'));
select pg_temp.test_credit_task((select id from public.tasks where title = 'R43 Child Task'), pg_temp.u43(5), pg_temp.u43(4));
select pg_temp.test_credit_task((select id from public.tasks where title = 'R43 Peer Task'), pg_temp.u43(5), pg_temp.u43(4));
select pg_temp.test_login_leadership(pg_temp.u43(4));
select ok(
  (select points from public.leadership_leaderboard(p_preferred => true) where member_id = pg_temp.u43(5))
    < (select points from public.leadership_leaderboard() where member_id = pg_temp.u43(5)),
  'Clasament''s preferred view leaves out the points of the unselected Groups');
reset role;

-- ==================== never muted: Task Notifications ====================

insert into public.tasks(title, description, deadline, group_id, audience, assignment_mode, status, created_by)
values ('R43 Own Task', 'x', '2031-05-01 09:00+00', pg_temp.g43('Child P43'), 'local', 'direct', 'todo', pg_temp.u43(1));
select is(
  pg_temp.who(array(select private.task_managers((select id from public.tasks where title = 'R43 Own Task'), null))),
  array[1],
  'a Task the BCE created in a Group they unselected still names them its Task Manager');


select * from finish();
rollback;
