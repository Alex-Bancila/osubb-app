-- group_min_level_events.test.sql — raising a Group's Minimum Level raises
-- its Events with it (ADR-0009: a Member below the Group's level sees neither
-- the Group nor its Events; ADR-0008: an Event's level is never below its
-- Group's).
--
-- #1118 (audit 2026-10-30, finding H2). update_group (a Child Group's level, its
-- Managers) and update_group_structure (a top-level Group's, BC) removed the
-- roster rows below the new level and left the Group's Events where they
-- were. private.can_read_event compares the reader only with the Event's own
-- level, so lower Roles kept reading and RSVPing to Events of a Group they
-- could no longer see -- and the next update_event, resubmitting the stored
-- level, was refused with event_min_level_below_group. Runs in one
-- transaction and rolls back.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(20);

-- ==================== Fixtures — prefix 11180000-… ====================
-- 1 BC; 2 a Recrut (level 0); 3 a Voluntar (level 1); 4 a Voluntar Activ
-- (level 2), Manager of the Child Group; 5 the Moderator.
create function pg_temp.u_h2(n integer) returns uuid language sql immutable as $$
  select ('11180000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users (id, email)
select pg_temp.u_h2(n), 'raise.' || n || '.h2@test.local' from generate_series(1, 5) n;
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.u_h2(n), 'Raise H2 ' || n, 'raise.' || n || '.h2@test.local',
       (case n when 1 then 'bc' when 2 then 'recrut' when 3 then 'voluntar'
             when 5 then 'moderator' else 'activ' end)::member_role,
       'activ'::member_status
  from generate_series(1, 5) n;

insert into public.groups (name, category, min_level) values ('Raise #H2', 'team', 0);
insert into public.groups (name, category, min_level, parent_id)
values ('Raise copil #H2', 'team', 0, (select id from public.groups where name = 'Raise #H2'));
insert into public.group_members (group_id, member_id, group_role)
select grp.id, pg_temp.u_h2(roster.n), roster.role
  from (values (2, 'member'), (3, 'member')) as roster(n, role)
 cross join public.groups as grp
 where grp.name = 'Raise #H2';
insert into public.group_members (group_id, member_id, group_role)
select grp.id, pg_temp.u_h2(roster.n), roster.role
  from (values (4, 'manager'), (2, 'member'), (3, 'member')) as roster(n, role)
 cross join public.groups as grp
 where grp.name = 'Raise copil #H2';

create function pg_temp.grp_h2(p_name text) returns bigint language sql stable as $$
  select id from public.groups where name = p_name
$$;
create function pg_temp.event_level_h2(p_title text) returns integer
language sql stable security definer set search_path = '' as $$
  select min_level from public.events where title = p_title
$$;
create function pg_temp.sees_h2(p_title text) returns integer language sql stable as $$
  select count(*)::int from public.events where title = p_title
$$;

-- The Events, each at its Group's level, plus one the Child's Manager set
-- above the Group already.
select pg_temp.test_login_leadership(pg_temp.u_h2(1));
select lives_ok($$ select public.create_event('Sus #H2', 'sedinta', pg_temp.grp_h2('Raise #H2'),
  '2030-11-20 18:00+02', null, null, null, null, 0) $$,
  'BC creates an Event in the top-level Group at its level, 0');
reset role;
select pg_temp.test_login_leadership(pg_temp.u_h2(4));
select lives_ok($$ select public.create_event('Copil #H2', 'sedinta', pg_temp.grp_h2('Raise copil #H2'),
  '2030-11-21 18:00+02', null, null, null, null, 0) $$,
  'the Child Group''s Manager creates an Event at its level, 0');
select lives_ok($$ select public.create_event('Copil sus #H2', 'sedinta', pg_temp.grp_h2('Raise copil #H2'),
  '2030-11-22 18:00+02', null, null, null, null, 2) $$,
  'and one for Voluntar Activ and up');
reset role;

select pg_temp.test_login_leadership(pg_temp.u_h2(2));
select is(pg_temp.sees_h2('Sus #H2') + pg_temp.sees_h2('Copil #H2'), 2,
  'the Recrut reads both level-0 Events before any raise');
reset role;

-- ==================== 1. A Child Group's level, raised by its Manager (update_group) ====================

select pg_temp.test_login_leadership(pg_temp.u_h2(4));
select lives_ok($$ select public.update_group(pg_temp.grp_h2('Raise copil #H2'), 'Raise copil #H2',
  null, null, false, null, false, 1, null, null, true) $$,
  'the Manager raises the Child Group to Voluntar, confirming the Recrut''s removal');
reset role;

select is(pg_temp.event_level_h2('Copil #H2'), 1,
  'the Child Group''s level-0 Event now carries the Group''s new level');
select is(pg_temp.event_level_h2('Copil sus #H2'), 2,
  'an Event already above the new level keeps its own');

select pg_temp.test_login_leadership(pg_temp.u_h2(2));
select is(pg_temp.sees_h2('Copil #H2'), 0,
  'the Recrut no longer reads the Child Group''s Event');
reset role;
select pg_temp.test_login_leadership(pg_temp.u_h2(3));
select is(pg_temp.sees_h2('Copil #H2'), 1,
  'the Voluntar still does');
reset role;

-- The form resubmits the stored level on an unrelated edit: it must not be
-- refused as event_min_level_below_group.
select pg_temp.test_login_leadership(pg_temp.u_h2(4));
select lives_ok($$ select public.update_event((select id from public.events where title = 'Copil #H2'),
  'Copil #H2', 'sedinta', pg_temp.grp_h2('Raise copil #H2'), '2030-11-21 19:00+02',
  null, null, null, null, pg_temp.event_level_h2('Copil #H2'), null) $$,
  'moving the Event an hour with its stored level is accepted');
reset role;

-- The raise is scoped to the Child Group: its parent's Event is untouched.
select is(pg_temp.event_level_h2('Sus #H2'), 0,
  'the top-level Group''s Event is not touched by a Child Group''s raise');
select pg_temp.test_login_leadership(pg_temp.u_h2(2));
select is(pg_temp.sees_h2('Sus #H2'), 1,
  'and the Recrut still reads it');
reset role;

-- ==================== 2. A top-level Group's level, raised by BC (update_group_structure) ====================

select pg_temp.test_login_leadership(pg_temp.u_h2(1));
select lives_ok($$ select public.update_group_structure(pg_temp.grp_h2('Raise #H2'), 'team',
  false, true, false, 1, null, null, false, false, true) $$,
  'BC raises the top-level Group to Voluntar, confirming the Recrut''s removal');
reset role;

select is(pg_temp.event_level_h2('Sus #H2'), 1,
  'the top-level Group''s level-0 Event now carries the Group''s new level');
select pg_temp.test_login_leadership(pg_temp.u_h2(2));
select is(pg_temp.sees_h2('Sus #H2'), 0,
  'the Recrut no longer reads the top-level Group''s Event either');
reset role;

-- ==================== 3. The Event ladder stops at 6: a raise to the Moderator's 9 lifts Events to 6 ====================

select pg_temp.test_login_leadership(pg_temp.u_h2(5));
select lives_ok($$ select public.update_group(pg_temp.grp_h2('Raise copil #H2'), 'Raise copil #H2',
  null, null, false, null, false, 9, null, null, true) $$,
  'the Moderator raises the Child Group to 9, confirming every removal');
reset role;
select is(pg_temp.event_level_h2('Copil #H2'), 6,
  'the Child Group''s Event is lifted to 6, the top of the Event ladder, not 9');
select is(pg_temp.event_level_h2('Copil sus #H2'), 6,
  'and so is the one that was at 2');

select pg_temp.test_login_leadership(pg_temp.u_h2(5));
select lives_ok($$ select public.update_group_structure(pg_temp.grp_h2('Raise #H2'), 'team',
  false, true, false, 9, null, null, false, false, true) $$,
  'the Moderator raises the top-level Group to 9 too');
reset role;
select is(pg_temp.event_level_h2('Sus #H2'), 6,
  'the top-level Group''s Event is lifted to 6 by the structure command');

select * from finish();
rollback;
