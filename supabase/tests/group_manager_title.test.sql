-- #967: a Group Manager may carry a function name of their own.
--
-- The Group Manager position has been named per Group since #582
-- (groups.manager_title, "Vicepreședinte" for a Department since #957), and a
-- Group Responsible has carried a title of their own since #583. Each
-- Coordonator now may too ("Coordonator Marketing"), under the Group's name
-- for the position: group_members.position_title on a manager row is
-- optional, judged exactly as a Responsible's -- blank is malformed, over 80
-- characters is too long -- while a Responsible's stays required and an
-- ordinary row's stays forbidden.
--
-- In the order the commands answer: step 1 for everyone (claimless callers
-- included), an Appointment through public.set_group_role's insert path with
-- and without a title and its Notification wording, the two readers
-- (public.group_roster, public.group_coordination), re-titling a sitting
-- Manager through the update path, and private.appoint_group_member called
-- directly, as #602's provisioning and create_group do.
--
-- Mutation guards, each named against the assertion that turns red:
--   * restore "p_group_role <> 'responsible' and v_title is not null" in
--     private.set_group_role_impl -> section 1's titled Manager hears PT400
--     invalid_position_title instead of the gate's 42501, and section 4's
--     re-title throws;
--   * restore it in private.appoint_group_member only -> section 2's first
--     Appointment (set_group_role's insert path) and section 5's direct
--     Appointment throw;
--   * let an ordinary row carry a title -> section 1's and section 5's
--     member-with-a-title calls stop throwing;
--   * drop the Manager's own title from the Notification's coalesce ->
--     sections 2, 4 and 5 read the Group's name instead.
--
-- Fixture Groups and roster rows are inserted directly (conventions OD9:
-- owner-run, rolled back).
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(32);

-- ==================== Fixtures ====================

create function pg_temp.g967_uid(n integer) returns uuid language sql immutable as $$
  select ('96700000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users (id, email)
select pg_temp.g967_uid(n), 'member.' || n || '.967@test.local' from generate_series(1, 10) n;

-- 1 BC, 2 a sitting UNTITLED Group Manager of the Department (re-titled in
-- section 4), 3 an ordinary member of the Department, 4-9 on no roster and
-- appointed below, 10 claimless.
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.g967_uid(n), 'Member #967 ' || n, 'member.' || n || '.967@test.local',
  (case n when 1 then 'bc' else 'voluntar' end)::public.member_role,
  'activ'::public.member_status
from generate_series(1, 10) n;

-- The Department names its Manager position; the Team does not.
insert into public.groups (name, category, min_level, manager_title, created_by)
values ('Departament #967', 'department', 0, 'Vicepreședinte', pg_temp.g967_uid(1)),
       ('Echipă #967',      'team',       0, null,             pg_temp.g967_uid(1));

create function pg_temp.g967_group(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;

insert into public.group_members (group_id, member_id, group_role, position_title)
values (pg_temp.g967_group('Departament #967'), pg_temp.g967_uid(2), 'manager', null),
       (pg_temp.g967_group('Departament #967'), pg_temp.g967_uid(3), 'member',  null);

create function pg_temp.g967_bc() returns void language sql as $$
  select pg_temp.test_login(pg_temp.g967_uid(1), '{"member_role":"bc","member_level":6}'::jsonb) $$;

-- set_group_role on a fixture Group, as a statement throws_ok / lives_ok run.
create function pg_temp.g967_set(p_group text, n integer, p_role text, p_title text) returns text
language sql as $$
  select format($f$select public.set_group_role(%s, %L, %L, %L)$f$,
                pg_temp.g967_group(p_group), pg_temp.g967_uid(n), p_role, p_title)
$$;
-- private.appoint_group_member, owner-run, BC as the actor.
create function pg_temp.g967_appoint(n integer, p_role text, p_title text) returns text
language sql as $$
  select format($f$select private.appoint_group_member(%s, %L, %L, %L, %L)$f$,
                pg_temp.g967_group('Departament #967'), pg_temp.g967_uid(n),
                pg_temp.g967_uid(1), p_role, p_title)
$$;
create function pg_temp.g967_row(p_group text, n integer) returns text[]
language sql stable security definer set search_path = '' as $$
  select array[membership.group_role, membership.position_title]
    from public.group_members as membership
   where membership.group_id = (select id from public.groups where name = p_group)
     and membership.member_id = pg_temp.g967_uid(n)
$$;
create function pg_temp.g967_body(n integer) returns text
language sql stable security definer set search_path = '' as $$
  select body from public.notifications
   where member_id = pg_temp.g967_uid(n)
   order by id desc limit 1
$$;

-- ==================== 1 · step 1: malformed for everyone, before the gate ====================

select pg_temp.test_login(pg_temp.g967_uid(10), '{"provider":"email"}'::jsonb);
select throws_ok(pg_temp.g967_set('Departament #967', 4, 'manager', '   '),
  'PT400', 'invalid_position_title',
  'a blank (not null) Manager title is malformed for everyone, as a Responsible''s is');
select throws_ok(pg_temp.g967_set('Departament #967', 4, 'manager', repeat('m', 81)),
  'PT400', 'position_title_too_long',
  'an 81-character Manager title is PT400 position_title_too_long, ahead of the gate');
select throws_ok(pg_temp.g967_set('Departament #967', 4, 'manager', 'Coordonator Marketing'),
  '42501', 'group_manage_forbidden',
  'a title on a manager row is no longer malformed: the claimless caller meets the gate instead');
select throws_ok(pg_temp.g967_set('Departament #967', 4, 'member', 'Membru de onoare'),
  'PT400', 'invalid_position_title',
  'an ordinary roster row still carries no title');
select throws_ok(pg_temp.g967_set('Departament #967', 4, 'responsible', null),
  'PT400', 'position_title_required',
  'a Group Responsible still always carries one');

-- ==================== 2 · an Appointment, with and without a title of their own ====================

reset role;
select pg_temp.g967_bc();
select lives_ok(pg_temp.g967_set('Departament #967', 4, 'manager', '  Coordonator Marketing  '),
  'BC appoints a Manager of the Department under a function name of their own');
reset role;
select is(pg_temp.g967_row('Departament #967', 4), array['manager', 'Coordonator Marketing'],
  'the title is stored on the manager row, trimmed');
select is(pg_temp.g967_body(4),
  'Ai fost numit Coordonator Marketing în grupul Departament #967.',
  'the Notification names the position by the Manager''s own title first');

select pg_temp.g967_bc();
select lives_ok(pg_temp.g967_set('Departament #967', 5, 'manager', null),
  'a Manager is still appointed without a title');
reset role;
select is(pg_temp.g967_row('Departament #967', 5), array['manager', null],
  'and the row carries none');
select is(pg_temp.g967_body(5),
  'Ai fost numit Vicepreședinte în grupul Departament #967.',
  'an untitled Manager hears the Group''s name for the position');

select pg_temp.g967_bc();
select lives_ok(pg_temp.g967_set('Echipă #967', 6, 'manager', null),
  'the same in a Group that names no Manager position');
reset role;
select is(pg_temp.g967_body(6),
  'Ai fost numit coordonator de grup în grupul Echipă #967.',
  'without either name the Manager is "coordonator de grup", as before');

select pg_temp.g967_bc();
select lives_ok(pg_temp.g967_set('Echipă #967', 7, 'manager', ' ' || repeat('ș', 80) || ' '),
  'an 80-character title is accepted, measured as stored (trimmed) and in characters, not bytes');
reset role;
select is((pg_temp.g967_row('Echipă #967', 7))[2], repeat('ș', 80),
  'and stored whole');

-- ==================== 3 · the readers return it ====================

select pg_temp.g967_bc();
select is(
  (select roster.position_title from public.group_roster(pg_temp.g967_group('Departament #967')) as roster
    where roster.member_id = pg_temp.g967_uid(4)),
  'Coordonator Marketing',
  'public.group_roster returns the Manager''s own title');
select is(
  (select coordination.position_title
     from public.group_coordination(pg_temp.g967_group('Departament #967')) as coordination
    where coordination.member_id = pg_temp.g967_uid(4)),
  'Coordonator Marketing',
  'public.group_coordination returns it on the member-facing Group page');
select is(
  (select coordination.position_title
     from public.group_coordination(pg_temp.g967_group('Departament #967')) as coordination
    where coordination.member_id = pg_temp.g967_uid(5)),
  null::text,
  'and null for an untitled Manager, whose label falls back to the Group''s name');

-- ==================== 4 · re-titling a sitting Manager, as a Responsible is ====================

select lives_ok(pg_temp.g967_set('Departament #967', 2, 'manager', 'Coordonator Educațional'),
  'set_group_role gives a sitting Manager a title of their own');
reset role;
select is(pg_temp.g967_row('Departament #967', 2), array['manager', 'Coordonator Educațional'],
  'the row keeps its position and takes the title');
select is(pg_temp.g967_body(2),
  'Ai fost numit Coordonator Educațional în grupul Departament #967.',
  'and the Manager is told under the new title');

select pg_temp.g967_bc();
select throws_ok(pg_temp.g967_set('Departament #967', 2, 'manager', ' Coordonator Educațional '),
  'PT409', 'nothing_to_update',
  'the same title sent back (differently padded) is nothing_to_update');
select lives_ok(pg_temp.g967_set('Departament #967', 4, 'member', null),
  'BC withdraws the titled Manager''s position');
reset role;
select is(pg_temp.g967_body(4),
  'Nu mai ești Coordonator Marketing în grupul Departament #967, dar rămâi membru.',
  'the withdrawal names the position by the title they held');
select is(pg_temp.g967_row('Departament #967', 4), array['member', null],
  'and the ordinary row they keep carries no title');

-- ==================== 5 · private.appoint_group_member judges the same ====================
-- Owner-run, as #602's provisioning and create_group reach it: no gate of its
-- own, so these are the roster row's rules alone.

select throws_ok(pg_temp.g967_appoint(8, 'manager', '   '),
  'PT400', 'invalid_position_title',
  'appoint_group_member: a blank Manager title is malformed');
select throws_ok(pg_temp.g967_appoint(8, 'manager', repeat('m', 81)),
  'PT400', 'position_title_too_long',
  'appoint_group_member: an 81-character Manager title is too long');
select throws_ok(pg_temp.g967_appoint(8, 'member', 'Membru de onoare'),
  'PT400', 'invalid_position_title',
  'appoint_group_member: an ordinary row carries no title');
select throws_ok(pg_temp.g967_appoint(8, 'responsible', null),
  'PT400', 'position_title_required',
  'appoint_group_member: a Responsible always carries one');
select lives_ok(pg_temp.g967_appoint(8, 'manager', ' Coordonator Proiecte '),
  'appoint_group_member appoints a Manager under a title of their own');
select is(pg_temp.g967_row('Departament #967', 8), array['manager', 'Coordonator Proiecte'],
  'stored trimmed');
select is(pg_temp.g967_body(8),
  'Ai fost numit Coordonator Proiecte în grupul Departament #967.',
  'and named by it in the Notification');

select * from finish();
rollback;
