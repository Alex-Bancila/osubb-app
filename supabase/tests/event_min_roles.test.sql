-- R57 (Alex, 2026-10-14): an Event's Cine îl vede offers every Role on the
-- ladder, Voluntar and Voluntar Activ included. Spec
-- docs/superpowers/specs/2026-10-14-minimum-role-filter-design.md.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(12);

create function pg_temp.u57(n integer) returns uuid language sql immutable as $$
  select ('57000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users(id, email)
select pg_temp.u57(n), 'roles.' || n || '.57@test.local' from generate_series(1, 4) n;
insert into profiles(id, full_name, email, role, status)
select pg_temp.u57(n), 'Roles #57 ' || n, 'roles.' || n || '.57@test.local',
       (case n when 1 then 'recrut' when 2 then 'voluntar' else 'activ' end)::member_role,
       'activ'::member_status
  from generate_series(1, 4) n;
insert into groups(name, category, min_level) values ('Roles #57', 'team', 0);
insert into group_members(group_id, member_id, group_role)
select grp.id, pg_temp.u57(roster.n), roster.role
  from (values (4, 'manager'), (1, 'member'), (2, 'member'), (3, 'member')) as roster(n, role)
 cross join groups as grp
 where grp.name = 'Roles #57';

-- Created by the Group's Manager, a Voluntar Activ (level 2).
select pg_temp.test_login_leadership(pg_temp.u57(4));
select lives_ok($$select public.create_event('Voluntar #57', 'sedinta',
  (select id from groups where name = 'Roles #57'), '2030-11-20 18:00+02',
  null, null, null, null, 1)$$, 'an Event can be for Voluntar and up');
select lives_ok($$select public.create_event('Activ #57', 'sedinta',
  (select id from groups where name = 'Roles #57'), '2030-11-21 18:00+02',
  null, null, null, null, 2)$$, 'an Event can be for Voluntar Activ and up');
reset role;
select is((select min_level from events where title = 'Voluntar #57'), 1, 'stored at Voluntar');
select is((select count(*)::int from notifications
            where member_id = pg_temp.u57(1) and title = 'Eveniment nou: Voluntar #57'), 0,
  'a Recrut of the Group is not told of a Voluntar Event');
select is((select count(*)::int from notifications
            where member_id = pg_temp.u57(2) and title = 'Eveniment nou: Voluntar #57'), 1,
  'a Voluntar of the Group is told of it');

select pg_temp.test_login_leadership(pg_temp.u57(1));
select is((select count(*)::int from events where title = 'Voluntar #57'), 0, 'a Recrut does not read it');
select pg_temp.test_login_leadership(pg_temp.u57(2));
select is((select count(*)::int from events where title = 'Voluntar #57'), 1, 'a Voluntar reads it');
select is((select count(*)::int from events where title = 'Activ #57'), 0, 'a Voluntar does not read a Voluntar Activ Event');
select pg_temp.test_login_leadership(pg_temp.u57(3));
select is((select count(*)::int from events where title = 'Activ #57'), 1, 'a Voluntar Activ reads it');

select pg_temp.test_login_leadership(pg_temp.u57(4));
select lives_ok($$select public.update_event((select id from events where title = 'Activ #57'),
  'Activ #57', 'sedinta', (select id from groups where name = 'Roles #57'), '2030-11-21 18:00+02',
  null, null, null, null, 1, null)$$, 'an edit can lower it to Voluntar');
reset role;
select is((select min_level from events where title = 'Activ #57'), 1, 'stored at Voluntar after the edit');
select pg_temp.test_login_leadership(pg_temp.u57(2));
select is((select count(*)::int from events where title = 'Activ #57'), 1, 'the Voluntar now reads it');
reset role;

select * from finish();
rollback;
