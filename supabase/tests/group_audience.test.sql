-- #601: private.group_audience() -- the Group Audience (CONTEXT.md): every active
-- Member of a Group or of any Group below it, by roster row or by Automatic
-- Membership -- and the Event commands' fan-out through it.
--
-- Fixture: a three-level chain Department #601 -> Team #601 -> Sub #601,
-- one root Automatic Group at Minimum Level 3, and an
-- inactive Member planted on every roster level.
--
--   n  role      status   roster
--   1  bc        activ    none (the actor)
--   2  voluntar  activ    Department only (the Member a Team must not reach)
--   3  voluntar  inactiv  Department
--   4  activ     activ    Team + Sub  (the duplicate)
--   5  activ     inactiv  Team
--   6  vot       activ    Sub; manager of the Automatic Group
--   7  vot       inactiv  Sub
--   8  bce       activ    none
--   9  vot       activ    Arch #601 only (an archived Group)
--  10  bce       inactiv  none
--  11  recrut    activ    Below Arch #601 only (a Group below an archived one)
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(27);

create function pg_temp.u601(n integer) returns uuid language sql immutable as $$
  select ('60100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users(id, email)
select pg_temp.u601(n), 'audience.' || n || '.601@test.local' from generate_series(1, 11) n;
insert into public.profiles(id, full_name, email, role, status)
select pg_temp.u601(n), 'Audience #601 ' || n, 'audience.' || n || '.601@test.local',
       (case n when 1 then 'bc' when 2 then 'voluntar' when 3 then 'voluntar'
               when 4 then 'activ' when 5 then 'activ' when 6 then 'vot' when 7 then 'vot'
               when 8 then 'bce' when 9 then 'vot' when 10 then 'bce' else 'recrut' end)::public.member_role,
       (case when n in (3, 5, 7, 10) then 'inactiv' else 'activ' end)::public.member_status
  from generate_series(1, 11) n;

insert into public.departments(id, name, short, color, kind)
values ('d601', 'Department #601', 'D601', '#601601', 'department');
insert into public.teams(id, name, dept_id) values ('dt601', 'Team #601', 'd601');
insert into public.member_departments(member_id, dept_id)
values (pg_temp.u601(2), 'd601'), (pg_temp.u601(3), 'd601');
insert into public.team_members(team_id, member_id)
values ('dt601', pg_temp.u601(4)), ('dt601', pg_temp.u601(5));
insert into public.groups(name,category,legacy_dept_id)
values ('Department #601','department','d601');
insert into public.groups(name,category,parent_id,legacy_team_id)
values ('Team #601','team',(select id from public.groups where legacy_dept_id='d601'),'dt601');
insert into public.group_members(group_id,member_id,group_role)
select g.id,md.member_id,'member' from public.member_departments md
  join public.groups g on g.legacy_dept_id=md.dept_id where md.dept_id='d601';
insert into public.group_members(group_id,member_id,group_role)
select g.id,tm.member_id,'member' from public.team_members tm
  join public.groups g on g.legacy_team_id=tm.team_id where tm.team_id='dt601';

insert into public.groups(name, category, parent_id, application_level)
values ('Sub #601', 'team', (select id from public.groups where legacy_team_id = 'dt601'), 0);
insert into public.groups(name, category, min_level, automatic_membership)
values ('Auto #601', 'team', 3, true);
insert into public.group_members(group_id, member_id, group_role)
select id, pg_temp.u601(n), 'member' from public.groups, unnest(array[4, 6, 7]) n
 where name = 'Sub #601' and legacy_team_id is null;
-- Group Roles are still appointed on an Automatic Group: member 6 manages Auto #601
-- AND belongs to it automatically (level 3), the roster/automatic overlap.
insert into public.group_members(group_id, member_id, group_role)
select id, pg_temp.u601(6), 'manager' from public.groups
 where name = 'Auto #601' and legacy_team_id is null;
-- Fix round 1 (archived Groups): Arch #601 under Sub, archived, rostering member 9;
-- Below Arch #601 under it, still active, rostering member 11. Neither Member is on
-- any other roster, so each is reached only through an archived Group (or a Group
-- below one) from the Department, the Team and the Sub.
insert into public.groups(name, category, parent_id, application_level)
values ('Arch #601', 'team', (select id from public.groups where name = 'Sub #601' and legacy_team_id is null), 0);
insert into public.groups(name, category, parent_id, application_level)
values ('Below Arch #601', 'team', (select id from public.groups where name = 'Arch #601' and legacy_team_id is null), 0);
insert into public.group_members(group_id, member_id, group_role)
select id, pg_temp.u601(9), 'member' from public.groups where name = 'Arch #601' and legacy_team_id is null
union all
select id, pg_temp.u601(11), 'member' from public.groups where name = 'Below Arch #601' and legacy_team_id is null;
update public.groups set status = 'archived' where name = 'Arch #601' and legacy_team_id is null;

create temp table g601 as
select 'dept'::text as name, id from public.groups where legacy_dept_id = 'd601'
union all select 'team', id from public.groups where legacy_team_id = 'dt601'
union all select 'sub', id from public.groups where name = 'Sub #601' and legacy_team_id is null
union all select 'auto', id from public.groups where name = 'Auto #601' and legacy_team_id is null
union all select 'arch', id from public.groups where name = 'Arch #601' and legacy_team_id is null
union all select 'org', id from public.groups where is_organization
union all select 'diverse', id from public.groups where legacy_dept_id = 'diverse';
grant select on g601 to authenticated, anon;

-- ==================== the helper ====================

select set_eq(
  $q$select * from private.group_audience((select id from g601 where name = 'org'))$q$,
  $q$select id from public.profiles where status = 'activ'$q$,
  'the Organization Group''s audience is every active Member, through Automatic Membership alone');
select is(
  (select count(*) from private.group_audience((select id from g601 where name = 'org')) as a(id)
     join public.profiles as p using (id) where p.status <> 'activ'),
  0::bigint,
  'the Organization Group''s audience holds no inactive Member');
select set_eq(
  $q$select * from private.group_audience((select id from g601 where name = 'dept'))$q$,
  $q$select pg_temp.u601(n) from unnest(array[2, 4, 6]) n$q$,
  'a Department''s audience is its own roster plus every Group below it, inactive rows dropped');
select set_eq(
  $q$select * from private.group_audience((select id from g601 where name = 'team'))$q$,
  $q$select pg_temp.u601(n) from unnest(array[4, 6]) n$q$,
  'a Team''s audience reaches down to its sub-Team and never up to its Department');
select set_eq(
  $q$select * from private.group_audience((select id from g601 where name = 'auto'))$q$,
  $q$select p.id from public.profiles as p join public.roles as r on r.id = p.role
      where p.status = 'activ' and r.level >= 3$q$,
  'an Automatic Group at Minimum Level 3 is exactly the active Members at level >= 3');
select set_eq(
  $q$select a.id from private.group_audience((select id from g601 where name = 'auto')) as a(id)
      where a.id::text like '60100000-%'$q$,
  $q$select pg_temp.u601(n) from unnest(array[1, 6, 8, 9]) n$q$,
  'the Automatic Group admits the fixture''s active level >= 3 Members and neither the inactive BCE nor anyone below level 3');
select is(
  (select count(*) - count(distinct a) from private.group_audience((select id from g601 where name = 'dept')) as a),
  0::bigint,
  'a Member on two rosters of one subtree appears once');
select is(
  (select count(*) - count(distinct a) from private.group_audience((select id from g601 where name = 'auto')) as a),
  0::bigint,
  'a Member reached by roster and by Automatic Membership appears once');
select is(
  (select count(*) from private.group_audience((select id from g601 where name = 'dept')) as a
    where a in (pg_temp.u601(9), pg_temp.u601(11))),
  0::bigint,
  'a Member reached only through an archived Group (member 9) or a Group below one (member 11) is not in the audience');
select set_eq(
  $q$select * from private.group_audience((select id from g601 where name = 'arch'))$q$,
  $q$select pg_temp.u601(n) from unnest(array[9, 11]) n$q$,
  'the audience of an archived Group itself is still answered: its own status is the caller''s business');
select is(
  (select count(*) from private.group_audience(-1)),
  0::bigint,
  'an unknown Group has an empty audience');
select ok(
  not has_function_privilege('authenticated', 'private.group_audience(bigint)', 'execute'),
  'authenticated may not execute group_audience');
select ok(
  not has_function_privilege('anon', 'private.group_audience(bigint)', 'execute'),
  'anon may not execute group_audience');

-- ==================== the Event commands fan out through it ====================

insert into public.events(title, type, group_id, starts_at, created_by, min_level)
select 'Audience ' || name || ' #601', 'sedinta', id, '2026-10-01 12:00+00', pg_temp.u601(1), 0
  from g601 where name in ('org', 'dept');
insert into public.events(title, type, group_id, starts_at, created_by, min_level)
select 'Audience move #601', 'sedinta', id, '2026-10-01 12:00+00', pg_temp.u601(1), 0
  from g601 where name = 'dept';
create temp table e601 as
select case title when 'Audience org #601' then 'org' when 'Audience dept #601' then 'dept' else 'move' end as name, id
  from public.events where title like 'Audience % #601';
grant select on e601 to authenticated, anon;
insert into public.event_attendance(event_id, member_id, status)
select id, pg_temp.u601(11), 'going' from e601 where name = 'dept'
union all
select id, pg_temp.u601(8), 'declined' from e601 where name = 'dept';

select set_eq(
  $q$select * from private.event_notification_recipients((select id from e601 where name = 'org'))$q$,
  $q$select id from public.profiles where status = 'activ'$q$,
  'an Organization Group Event''s recipient set is every active Member');

select pg_temp.test_login_leadership(pg_temp.u601(1));
select lives_ok(
  $q$select public.update_event((select id from e601 where name = 'org'), 'Audience org #601', 'sedinta',
       (select id from g601 where name = 'org'), '2026-10-01 12:00+00', null, 'Aula', null, null, 0)$q$,
  'BC moves an Organization Group Event to a new location');
reset role;
select set_eq(
  $q$select member_id from public.notifications
      where dedupe_key = 'event:' || (select id from e601 where name = 'org') || ':location'$q$,
  $q$select id from public.profiles where status = 'activ' and id <> pg_temp.u601(1)$q$,
  'an important change to an Organization Group Event notifies every active Member except the actor');

select pg_temp.test_login_leadership(pg_temp.u601(1));
select lives_ok(
  $q$select public.cancel_event((select id from e601 where name = 'dept'), 'Anulat #601')$q$,
  'BC cancels a Department Event');
reset role;
select set_eq(
  $q$select member_id from public.notifications
      where dedupe_key = 'event:' || (select id from e601 where name = 'dept') || ':cancelled'$q$,
  $q$select pg_temp.u601(n) from unnest(array[2, 4, 6, 11]) n$q$,
  'cancelling a Department Event reaches its Team and sub-Team rosters and its going attendee, never a decliner or an inactive Member');

select pg_temp.test_login_leadership(pg_temp.u601(1));
select lives_ok(
  $q$select public.update_event((select id from e601 where name = 'move'), 'Audience move #601', 'sedinta',
       (select id from g601 where name = 'diverse'), '2026-10-01 12:00+00', null, null, null, null, 0)$q$,
  'BC moves a Department Event to another Department');
reset role;
select set_eq(
  $q$select member_id from public.notifications
      where dedupe_key = 'event:' || (select id from e601 where name = 'move') || ':group'
        and member_id::text like '60100000-%'$q$,
  $q$select pg_temp.u601(n) from unnest(array[2, 4, 6]) n$q$,
  'moving an Event away notifies the old Group''s whole audience, sub-Groups included');

-- ==================== Fix round 1: nobody who cannot read the Event is told ====================
-- Two Events at Minimum Level 3. On the Department one, members 2 (voluntar) and 4
-- (activ) are in the Group Audience but below level 3; member 4 and member 11 (recrut,
-- on no live roster) marked going -- a going attendee demoted below the floor.

insert into public.events(title, type, group_id, starts_at, created_by, min_level)
select 'Hidden ' || name || ' #601', 'sedinta', id, '2026-10-01 12:00+00', pg_temp.u601(1), 3
  from g601 where name in ('org', 'dept');
create temp table h601 as
select case title when 'Hidden org #601' then 'org' else 'dept' end as name, id
  from public.events where title in ('Hidden org #601', 'Hidden dept #601');
grant select on h601 to authenticated, anon;
insert into public.event_attendance(event_id, member_id, status)
select id, pg_temp.u601(n), 'going' from h601, unnest(array[4, 11]) n where name = 'dept';

select set_eq(
  $q$select * from private.event_notification_recipients((select id from h601 where name = 'org'))$q$,
  $q$select p.id from public.profiles as p join public.roles as r on r.id = p.role
      where p.status = 'activ' and r.level >= 3$q$,
  'an Organization Group Event at Minimum Level 3 has only the active Members at level >= 3 as recipients');
select set_eq(
  $q$select * from private.event_notification_recipients((select id from h601 where name = 'dept'))$q$,
  $q$select pg_temp.u601(6)$q$,
  'below-level audience Members 2 and 4 and below-level going attendee 11 are not recipients of a Minimum Level 3 Event');

select pg_temp.test_login_leadership(pg_temp.u601(1));
select lives_ok(
  $q$select public.cancel_event((select id from h601 where name = 'dept'), 'Anulat #601')$q$,
  'BC cancels a Minimum Level 3 Department Event');
select lives_ok(
  $q$select public.cancel_event((select id from h601 where name = 'org'), 'Anulat #601')$q$,
  'BC cancels a Minimum Level 3 Organization Group Event');
reset role;
select is(
  (select count(*) from public.notifications
    where dedupe_key = 'event:' || (select id from h601 where name = 'dept') || ':cancelled'
      and member_id = pg_temp.u601(11)),
  0::bigint,
  'a going attendee below the Event''s Minimum Level (member 11) gets no Notification carrying its title');
select set_eq(
  $q$select member_id from public.notifications
      where dedupe_key = 'event:' || (select id from h601 where name = 'dept') || ':cancelled'$q$,
  $q$select pg_temp.u601(6)$q$,
  'cancelling a Minimum Level 3 Department Event reaches only the audience Members who can read it');
select set_eq(
  $q$select member_id from public.notifications
      where dedupe_key = 'event:' || (select id from h601 where name = 'org') || ':cancelled'$q$,
  $q$select p.id from public.profiles as p join public.roles as r on r.id = p.role
      where p.status = 'activ' and r.level >= 3 and p.id <> pg_temp.u601(1)$q$,
  'cancelling a Minimum Level 3 Organization Group Event reaches every active Member at level >= 3 except the actor, nobody below');

select * from finish();
rollback;
