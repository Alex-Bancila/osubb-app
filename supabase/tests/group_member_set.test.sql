-- #929 (ruling R32): one definition of "the members of Group G" -- roster rows,
-- Automatic Membership, and every active BC member and Moderator (the membri de
-- drept) -- used by the roster read, the counts and the Clasament Group filter; and
-- no Task, Event or Announcement Notification to BC or the Moderator through Group
-- membership, Group Audience or Group management, while a decide-this Notification
-- and a Task of their own still reach them.
--
-- Personas (prefix 929):
--   1 bc        activ    explicit member of Dept #929; Manager of Board-run #929
--   2 moderator activ    no roster row anywhere
--   3 bc        inactiv  (never a member of anything)
--   4 bce       activ    no roster row (an Automatic Member of AG #929, never board)
--   5 vot       activ    no roster row (an Automatic Member of AG #929)
--   6 activ     activ    member of Dept #929
--   7 voluntar  activ    Manager of Dept #929
--   8 vot       inactiv  (never a member of anything)
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(30);

create function pg_temp.u929(n integer) returns uuid language sql immutable as $$
  select ('92900000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users(id, email)
select pg_temp.u929(n), 'members.' || n || '.929@test.local' from generate_series(1, 8) n;
insert into public.profiles(id, full_name, email, role, status)
select pg_temp.u929(n), 'Members #929 ' || n, 'members.' || n || '.929@test.local',
       (case n when 1 then 'bc' when 2 then 'moderator' when 3 then 'bc' when 4 then 'bce'
               when 5 then 'vot' when 6 then 'activ' when 7 then 'voluntar' else 'vot' end)::public.member_role,
       (case when n in (3, 8) then 'inactiv' else 'activ' end)::public.member_status
  from generate_series(1, 8) n;

insert into public.groups(name, category, min_level) values ('Dept #929', 'department', 0);
insert into public.groups(name, category, min_level, automatic_membership) values ('AG #929', 'team', 3, true);
insert into public.groups(name, category, min_level) values ('Board-run #929', 'team', 0);
insert into public.groups(name, category, min_level, accepts_applications, application_level)
values ('Open #929', 'team', 0, true, 0);
insert into public.group_members(group_id, member_id, group_role)
select grp.id, pg_temp.u929(roster.n), roster.role
  from (values ('Dept #929', 7, 'manager'), ('Dept #929', 6, 'member'), ('Dept #929', 1, 'member'),
               ('Board-run #929', 1, 'manager')) as roster(name, n, role)
  join public.groups as grp on grp.name = roster.name;

create temp table g929 as
select name, id from public.groups where name like '% #929';
grant select on g929 to authenticated, anon;
create function pg_temp.g929(p_name text) returns bigint language sql stable as $$
  select id from g929 where name = p_name
$$;

-- ==================== the member set ====================

select set_eq(
  $$select member_id, source from private.group_member_set(pg_temp.g929('Dept #929'))
     where member_id::text like '92900000-%'$$,
  $$values (pg_temp.u929(7), 'roster'), (pg_temp.u929(6), 'roster'), (pg_temp.u929(1), 'roster'),
           (pg_temp.u929(2), 'board')$$,
  'a plain Group''s members are its roster (the BC member''s own row stays a roster row) plus the Moderator as a membre de drept -- never the inactive BC or the BCE');
select set_eq(
  $$select member_id from private.group_member_set(pg_temp.g929('Board-run #929')) where source = 'board'$$,
  $$select p.id from public.profiles p join public.roles r on r.id = p.role
     where p.status = 'activ' and r.level >= 6 and p.id <> pg_temp.u929(1)$$,
  'every active BC member and Moderator not on the roster is a membre de drept of every Group');
select set_eq(
  $$select member_id, source from private.group_member_set(pg_temp.g929('AG #929'))
     where member_id::text like '92900000-%'$$,
  $$values (pg_temp.u929(5), 'automatic'), (pg_temp.u929(4), 'automatic'),
           (pg_temp.u929(1), 'board'), (pg_temp.u929(2), 'board')$$,
  'an Automatic-Membership Group lists its active level >= 3 Members as automatic (the BCE included), BC and the Moderator as board, nobody below level 3 and no inactive Member');
select is(
  (select count(*) - count(distinct member_id) from private.group_member_set(pg_temp.g929('AG #929'))),
  0::bigint,
  'a Member reached by two branches appears once');
select is(
  (select source from private.group_member_set(pg_temp.g929('AG #929')) where member_id = pg_temp.u929(4)),
  'automatic',
  'a BCE member belongs to an Adunarea Generala-like Group by Role, as an automatic member (Alex, 2026-09-29)');
select is(
  (select count(*) from private.group_member_set(pg_temp.g929('Dept #929'), false) where source = 'board'),
  0::bigint,
  'without the board branch there is no membre de drept');

-- ==================== authority unchanged ====================

select ok(
  pg_temp.u929(2) not in (select * from private.group_audience(pg_temp.g929('Dept #929'))),
  'the Group Audience (authority, RLS) does not gain the Moderator from R32');
select set_eq(
  $$select * from private.group_notification_audience(pg_temp.g929('Dept #929'))$$,
  $$values (pg_temp.u929(6)), (pg_temp.u929(7))$$,
  'the audience Notifications reach drops the BC member despite their roster row');

-- ==================== the roster read ====================

-- The expected sizes, counted from profiles (not from the helper) before any session:
-- Dept #929 is its three roster rows plus every other active BC member and Moderator;
-- AG #929 is every active Member at level 3 and above (the board is inside it).
create temp table size929 as
select 'Dept #929'::text as name,
       3 + (select count(*) from public.profiles p join public.roles r on r.id = p.role
             where p.status = 'activ' and r.level >= 6 and p.id <> pg_temp.u929(1)) as members
union all
select 'AG #929', (select count(*) from public.profiles p join public.roles r on r.id = p.role
                    where p.status = 'activ' and r.level >= 3);
grant select on size929 to authenticated;

set local role anon;
select throws_ok($$select * from public.group_roster(null)$$, '42501', null,
  'anon cannot execute group_roster');
reset role;

select pg_temp.test_login_leadership(pg_temp.u929(4));
select is(
  (select count(*) from public.group_roster(pg_temp.g929('Dept #929'))),
  (select members from size929 where name = 'Dept #929'),
  'a BCE caller reads the whole member set, so the count includes the membri de drept');
select is(
  (select count(*) from public.group_roster(pg_temp.g929('AG #929'))),
  (select members from size929 where name = 'AG #929'),
  'the Adunarea Generala-like Group has a real count: its automatic members and the membri de drept');
select results_eq(
  $$select source, group_role, position_title from public.group_roster(pg_temp.g929('Dept #929'))
     where member_id = pg_temp.u929(7)$$,
  $$values ('roster'::text, 'manager'::text, null::text)$$,
  'a roster row carries its source and its Group Role');
select ok(
  (select bool_and(group_id = pg_temp.g929('Dept #929')) from public.group_roster(pg_temp.g929('Dept #929'))),
  'p_group_id narrows the read to that Group');
reset role;

select pg_temp.test_login_leadership(pg_temp.u929(7));
select ok(
  (select count(*) from public.group_roster(pg_temp.g929('Dept #929')) where source = 'board') > 0,
  'the Group''s Manager reads its membri de drept');
reset role;

select pg_temp.test_login_leadership(pg_temp.u929(6));
select set_eq(
  $$select member_id from public.group_roster(pg_temp.g929('Dept #929'))$$,
  $$values (pg_temp.u929(6))$$,
  'an ordinary member reads only their own row -- the group_members_read rule');
reset role;

-- ==================== the Clasament Group filter ====================

select pg_temp.test_login_leadership(pg_temp.u929(4));
select set_eq(
  $$select member_id from public.leadership_leaderboard(pg_temp.g929('AG #929'))$$,
  $$select id from public.profiles where status = 'activ' and role = 'vot'$$,
  'filtering the Clasament by an Automatic-Membership Group at level 3 lists exactly its members below BCE, 0 points included');
select is(
  (select count(*) from public.leadership_leaderboard(pg_temp.g929('Dept #929'))
    where member_id in (pg_temp.u929(1), pg_temp.u929(2))),
  0::bigint,
  'a Group filter never ranks BC or the Moderator, though they are members of the Group');
select is(
  (select count(*) from public.leadership_leaderboard(pg_temp.g929('AG #929')) where member_id = pg_temp.u929(4)),
  0::bigint,
  'filtering the Clasament by the Adunarea Generala-like Group never lists its BCE member (#907)');
select set_eq(
  $$select member_id from public.leadership_leaderboard(pg_temp.g929('Dept #929'))$$,
  $$values (pg_temp.u929(6)), (pg_temp.u929(7))$$,
  'the Department filter lists its roster members below BCE');
reset role;

-- ==================== Announcements ====================

-- Written server-side (no session), so created_by is the actor.
select pg_temp.test_clear_jwt();

insert into public.announcements(title, body, group_id, audience, created_by)
values ('Local #929', 'Body', pg_temp.g929('Dept #929'), 'local', pg_temp.u929(7)),
       ('Org #929', 'Body', pg_temp.g929('Dept #929'), 'org', pg_temp.u929(7));
select set_eq(
  $$select member_id from public.notifications where title = 'Anunț nou: Local #929'$$,
  $$values (pg_temp.u929(6))$$,
  'a local Announcement reaches its roster, but not the BC member on it (R32)');
select is(
  (select count(*) from public.notifications as n
     join public.profiles as p on p.id = n.member_id
     join public.roles as r on r.id = p.role
    where n.title = 'Anunț nou: Org #929' and r.level >= 6),
  0::bigint,
  'an organization-wide Announcement reaches no BC member or Moderator (R32)');

select pg_temp.test_login_leadership(pg_temp.u929(2));
select is(public.my_unread_announcements_count(), 0,
  'the Moderator''s Anunțuri badge counts none of them');
reset role;
select pg_temp.test_login_leadership(pg_temp.u929(6));
select ok(public.my_unread_announcements_count() >= 2,
  'a member''s badge still counts the Announcements that reach them');
reset role;

-- ==================== Events ====================

insert into public.events(title, type, group_id, starts_at, created_by, min_level)
values ('Event #929', 'sedinta', pg_temp.g929('Dept #929'), '2026-11-01 12:00+00', pg_temp.u929(7), 0);
insert into public.event_attendance(event_id, member_id, status)
select id, pg_temp.u929(2), 'going' from public.events where title = 'Event #929';
select set_eq(
  $$select * from private.event_notification_recipients((select id from public.events where title = 'Event #929'))$$,
  $$values (pg_temp.u929(6)), (pg_temp.u929(7)), (pg_temp.u929(2))$$,
  'Event recipients: the audience without its BC member, plus the Moderator only as a going attendee');
select pg_temp.test_login_leadership(pg_temp.u929(7));
select lives_ok(
  $$select public.cancel_event((select id from public.events where title = 'Event #929'), 'Anulat #929')$$,
  'the Group Manager cancels the Event');
reset role;
select set_eq(
  $$select member_id from public.notifications where title = 'Eveniment anulat: Event #929'$$,
  $$values (pg_temp.u929(6)), (pg_temp.u929(2))$$,
  'the cancellation reaches the roster member and the going Moderator, never the BC member on the roster');

-- ==================== Tasks ====================

insert into public.tasks(title, description, deadline, group_id, audience, assignment_mode, status, created_by)
values ('Board-run task #929', 'x', '2027-05-01 09:00+00', pg_temp.g929('Board-run #929'), 'local', 'direct', 'todo',
        pg_temp.u929(3));
select is(
  (select count(*) from private.task_managers((select id from public.tasks where title = 'Board-run task #929'), null)),
  0::bigint,
  'a Group whose only Manager is a BC member notifies nobody of its Task -- no Task Notification through Group management');
update public.tasks set created_by = pg_temp.u929(1) where title = 'Board-run task #929';
select results_eq(
  $$select * from private.task_managers((select id from public.tasks where title = 'Board-run task #929'), pg_temp.u929(6))$$,
  $$values (pg_temp.u929(1))$$,
  'a Task the BC member created still notifies them: it is theirs personally');

-- ==================== a decision still reaches BC ====================

select pg_temp.test_login_leadership(pg_temp.u929(6));
select lives_ok($$select public.apply_to_group(pg_temp.g929('Open #929'), null)$$,
  'a member applies to a Group with no Manager');
reset role;
select ok(
  exists (select 1 from public.notifications
           where member_id = pg_temp.u929(2) and title = 'Cerere de înscriere: Open #929'),
  'the Application to decide still reaches the Moderator (R32 keeps decide-this Notifications)');

select * from finish();
rollback;
