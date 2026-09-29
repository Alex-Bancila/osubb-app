-- event_rsvp_managers.test.sql — #934: an Event's RSVPs are read by the people
-- who manage it (private.can_manage_event, the rule update_event and
-- cancel_event apply) and by each Member for their own row; no rank reads
-- other Members' answers by itself.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- ==================== Fixtures ====================
-- 01 bc · 02 Group Manager of A · 03 Group Responsible of A · 04 member of A
-- 05 bce with no Group Role · 06, 07 answerers · 08 moderator
-- 09 Group Responsible of B, creator of an Organization Event
-- 10 bce, Group Manager of Educațional (above the Team the last Event is on)
insert into auth.users (id, email)
select ('93400000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'rsvp934-' || n || '@test.local'
  from generate_series(1, 10) as n;
insert into public.profiles (id, full_name, email, role, status)
select id, 'RSVP fixture ' || split_part(email, '@', 1), email,
       case split_part(split_part(email, '@', 1), '-', 2)
         when '1' then 'bc' when '5' then 'bce' when '8' then 'moderator'
         when '9' then 'vot' when '10' then 'bce' else 'voluntar' end::public.member_role,
       'activ'::public.member_status
  from auth.users where id::text like '93400000-%';

insert into pg_temp.fixture_projects (name, leader_id, created_by) values
  ('RSVP A #934', '93400000-0000-0000-0000-000000000002', '93400000-0000-0000-0000-000000000001'),
  ('RSVP B #934', null, '93400000-0000-0000-0000-000000000001');
insert into pg_temp.fixture_project_members (project_id, member_id, project_role)
select id, '93400000-0000-0000-0000-000000000003'::uuid, 'responsible' from pg_temp.fixture_projects where name = 'RSVP A #934'
union all
select id, '93400000-0000-0000-0000-000000000004'::uuid, 'member' from pg_temp.fixture_projects where name = 'RSVP A #934'
union all
select id, '93400000-0000-0000-0000-000000000009'::uuid, 'responsible' from pg_temp.fixture_projects where name = 'RSVP B #934';
insert into pg_temp.fixture_teams (id, name, dept_id) values ('t934', 'Echipa RSVP #934', 'edu');
insert into pg_temp.fixture_member_departments (member_id, dept_id) values
  ('93400000-0000-0000-0000-000000000010', 'edu');
select pg_temp.materialize_legacy_groups();

insert into public.events (title, type, group_id, starts_at, created_by, min_level) values
  ('A #934', 'sedinta', pg_temp.project_group((select id from pg_temp.fixture_projects where name = 'RSVP A #934')),
     now() + interval '3 days', '93400000-0000-0000-0000-000000000002', 0),
  ('B #934', 'sedinta', pg_temp.project_group((select id from pg_temp.fixture_projects where name = 'RSVP B #934')),
     now() + interval '3 days', '93400000-0000-0000-0000-000000000009', 0),
  ('Org #934', 'eveniment', (select id from public.groups where is_organization),
     now() + interval '3 days', '93400000-0000-0000-0000-000000000009', 0),
  ('Org other #934', 'eveniment', (select id from public.groups where is_organization),
     now() + interval '3 days', '93400000-0000-0000-0000-000000000002', 0),
  ('Team #934', 'activitate', pg_temp.team_group('t934'),
     now() + interval '3 days', '93400000-0000-0000-0000-000000000010', 0);
create temp table ex as select id, title from public.events where title like '%#934';
grant select on ex to authenticated, anon;

insert into public.event_attendance (event_id, member_id, status)
select ex.id, answer.member_id::uuid, answer.status
  from ex join (values
    ('A #934',         '93400000-0000-0000-0000-000000000006', 'going'),
    ('A #934',         '93400000-0000-0000-0000-000000000007', 'declined'),
    ('A #934',         '93400000-0000-0000-0000-000000000004', 'going'),
    ('B #934',         '93400000-0000-0000-0000-000000000006', 'going'),
    ('Org #934',       '93400000-0000-0000-0000-000000000006', 'going'),
    ('Org #934',       '93400000-0000-0000-0000-000000000007', 'going'),
    ('Org other #934', '93400000-0000-0000-0000-000000000006', 'declined'),
    ('Team #934',      '93400000-0000-0000-0000-000000000007', 'going')
  ) as answer (title, member_id, status) on answer.title = ex.title;

-- What the caller reads, per Event: 'A #934:3, Org other #934:1'.
create function pg_temp.visible_rsvps() returns text language sql as $$
  select coalesce(string_agg(ex.title || ':' || rows.n, ', ' order by ex.title), '')
    from (select event_id, count(*) as n from public.event_attendance group by event_id) as rows
    join ex on ex.id = rows.event_id;
$$;
grant execute on function pg_temp.visible_rsvps() to authenticated, anon;

create function pg_temp.u934(p_n integer) returns uuid language sql immutable as $$
  select ('93400000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid;
$$;

-- ==================== The predicate's shape ====================

select ok(has_function_privilege('authenticated', 'private.can_manage_event(bigint)', 'execute'),
  'authenticated executes private.can_manage_event (the event_attendance_read policy calls it)');
select ok(not has_function_privilege('anon', 'private.can_manage_event(bigint)', 'execute'),
  'anon does not execute private.can_manage_event');
select ok(
  (select bool_and(pg_get_functiondef(p.oid) like '%private.can_manage_event(p_event_id)%')
     from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('update_event_impl', 'cancel_event_impl')),
  'update_event_impl and cancel_event_impl both decide source authority through private.can_manage_event');

-- ==================== Who reads whose answers ====================

select pg_temp.test_login_leadership(pg_temp.u934(2));
select is(pg_temp.visible_rsvps(), 'A #934:3, Org other #934:1',
  'a Group Manager reads every RSVP on their Group''s Event and on the Organization Event they created, nothing else');
select ok(private.can_manage_event((select id from ex where title = 'A #934')),
  'can_manage_event: the Group Manager manages their Group''s Event');
reset role;

select pg_temp.test_login_leadership(pg_temp.u934(3));
select is(pg_temp.visible_rsvps(), 'A #934:3',
  'a Group Responsible reads every RSVP on their Group''s Event');
reset role;

select pg_temp.test_login_leadership(pg_temp.u934(10));
select is(pg_temp.visible_rsvps(), 'Team #934:1',
  'a Group Manager of a Group above reads the RSVPs of an Event in the Group below');
reset role;

select pg_temp.test_login_leadership(pg_temp.u934(9));
select is(pg_temp.visible_rsvps(), 'B #934:1, Org #934:2',
  'an Organization Event''s creator reads its RSVPs; another creator''s Organization Event stays closed');
reset role;

select pg_temp.test_login_leadership(pg_temp.u934(1));
select is(pg_temp.visible_rsvps(), 'A #934:3, B #934:1, Org #934:2, Org other #934:1, Team #934:1',
  'BC reads every RSVP on every Event');
reset role;

select pg_temp.test_login_leadership(pg_temp.u934(8));
select is(pg_temp.visible_rsvps(), 'A #934:3, B #934:1, Org #934:2, Org other #934:1, Team #934:1',
  'the Moderator reads every RSVP on every Event');
reset role;

select pg_temp.test_login_leadership(pg_temp.u934(5));
select is(pg_temp.visible_rsvps(), '',
  'a BCE who manages none of these Events reads no colleague RSVP (the level >= 5 read is gone)');
select ok(not private.can_manage_event((select id from ex where title = 'B #934')),
  'can_manage_event: a rank alone manages nothing');
reset role;

select pg_temp.test_login_leadership(pg_temp.u934(4));
select is(pg_temp.visible_rsvps(), 'A #934:1',
  'an ordinary member of the Group reads only their own RSVP');
select is((select member_id from public.event_attendance), pg_temp.u934(4),
  'and the row they read is their own');
select ok(not private.can_manage_event((select id from ex where title = 'A #934')),
  'can_manage_event: Group membership is not management');
reset role;

select pg_temp.test_login_leadership(pg_temp.u934(6));
select is(pg_temp.visible_rsvps(), 'A #934:1, B #934:1, Org #934:1, Org other #934:1',
  'a Member reads their own RSVP on every Event they answered');
reset role;

select pg_temp.test_login(pg_temp.u934(2), '{"provider":"email"}');
select is(pg_temp.visible_rsvps(), '',
  'a Group Manager without organization claims reads nothing');
select ok(not private.can_manage_event((select id from ex where title = 'A #934')),
  'can_manage_event: false without organization claims');
reset role;

-- ==================== The commands agree with the read ====================

select pg_temp.test_login_leadership(pg_temp.u934(5));
select throws_ok($q$select public.cancel_event((select id from ex where title = 'B #934'), 'Motiv')$q$,
  '42501', 'calendar_manage_forbidden', 'the BCE who may not read the RSVPs may not cancel the Event either');
reset role;

select pg_temp.test_login_leadership(pg_temp.u934(9));
select throws_ok($q$select public.cancel_event((select id from ex where title = 'Org other #934'), 'Motiv')$q$,
  '42501', 'calendar_manage_forbidden', 'another creator''s Organization Event is refused by the command as by the read');
select lives_ok($q$select public.cancel_event((select id from ex where title = 'Org #934'), 'Motiv')$q$,
  'the Organization Event''s creator cancels it');
reset role;

select pg_temp.test_login_leadership(pg_temp.u934(3));
select lives_ok($q$select public.cancel_event((select id from ex where title = 'A #934'), 'Vreme rea')$q$,
  'the Group Responsible cancels their Group''s Event');
reset role;

select pg_temp.test_login_leadership(pg_temp.u934(2));
select is(pg_temp.visible_rsvps(), 'A #934:3, Org other #934:1',
  'a cancelled Event keeps its managers: its RSVP history stays readable to them');
reset role;

-- A deactivated manager keeps a token for up to an hour; the live Profile decides.
update public.profiles set status = 'inactiv' where id = pg_temp.u934(3);
select pg_temp.test_login(pg_temp.u934(3), '{"member_role":"voluntar","member_level":1}');
select is(pg_temp.visible_rsvps(), '',
  'a deactivated Group Responsible with a live token reads no RSVP');
reset role;

select * from finish();
rollback;
