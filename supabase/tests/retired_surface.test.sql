-- #936: the retired backend surface stays gone, the surviving pieces of it the
-- app still reads stay, and an Announcement keeps its Group and Audience.
-- Migration 20260930120000_retire_dead_surface.sql.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- ==================== 1. retired Task commands ====================
select hasnt_function('public', 'update_task_content',
  'update_task_content is gone -- update_task is the one Task edit');
select hasnt_function('private', 'update_task_content_impl', 'its body is gone too');
select hasnt_function('public', 'convert_task_mode',
  'convert_task_mode is gone -- update_task changes the Assignment Mode and Audience');
select hasnt_function('private', 'convert_task_mode_impl', 'its body is gone too');

-- ==================== 2. unread views ====================
select hasnt_view('public', 'leaderboard',
  'the legacy leaderboard is gone (it still ranked BCE and BC, R11 amendment #907)');
select hasnt_view('public', 'member_points', 'member_points is gone');
select hasnt_view('public', 'dept_cup', 'the unfiltered dept_cup view is gone');
select hasnt_view('public', 'tasks_with_overdue', 'tasks_with_overdue is gone');
select has_function('public', 'department_cup',
  'the Department Cup the app reads survives');

-- ==================== 3. RSVP writes only through set_event_rsvp ====================
select policies_are('public', 'event_attendance', array['event_attendance_read'],
  'event_attendance keeps only its read policy -- no direct self-write policy');
select ok(not has_table_privilege('authenticated', 'public.event_attendance', 'insert')
          and not has_table_privilege('authenticated', 'public.event_attendance', 'update')
          and not has_table_privilege('authenticated', 'public.event_attendance', 'delete')
          and not has_any_column_privilege('authenticated', 'public.event_attendance', 'insert')
          and not has_any_column_privilege('authenticated', 'public.event_attendance', 'update'),
  'authenticated has no insert, update or delete on event_attendance, at table or column level');
select ok(has_table_privilege('authenticated', 'public.event_attendance', 'select'),
  'the read grant stays');

-- ==================== 4. profiles.tier ====================
select hasnt_column('public', 'profiles', 'tier', 'profiles.tier is gone');
select hasnt_column('public', 'profiles_directory', 'tier', 'profiles_directory no longer exposes it');
select has_column('public', 'profiles', 'joined_year',
  'profiles.joined_year stays: Profil still shows "Membru din <an>" from it');
select columns_are('public', 'profiles_directory',
  array['id', 'full_name', 'role', 'status', 'avatar_color', 'joined_year', 'created_at', 'joined_at', 'nickname'],
  'profiles_directory keeps every other column');
select ok(coalesce((select 'security_invoker=on' = any (reloptions)
                      from pg_class where oid = 'public.profiles_directory'::regclass), false)
          and has_table_privilege('authenticated', 'public.profiles_directory', 'select')
          and not has_table_privilege('anon', 'public.profiles_directory', 'select'),
  'the recreated profiles_directory is security_invoker, read by authenticated, not by anon');

-- ==================== 5. an Announcement keeps its Group and Audience ====================
truncate announcements, announcement_reads cascade;
-- Personas (prefix 93): 01 BC. BC may update any Announcement, so a refusal
-- can only come from the guard.
insert into auth.users(id, email) values
  ('93600000-0000-0000-0000-000000000001', 'retired-936-bc@test.local');
insert into profiles(id, full_name, email, role) values
  ('93600000-0000-0000-0000-000000000001', 'BC 936', 'retired-936-bc@test.local', 'bc');
insert into announcements(title, body, group_id, audience)
select 'Origin #936', 'Stays where it was published.', id, 'local'
  from groups where name = 'Educațional';

select pg_temp.test_login_leadership('93600000-0000-0000-0000-000000000001');
select throws_ok(
  $$update announcements set group_id = (select id from groups where name = 'Imagine & PR')
     where title = 'Origin #936'$$,
  '23514', 'announcement_group_immutable',
  'moving an Announcement to another Group is refused, even for BC');
select throws_ok(
  $$update announcements set audience = 'org' where title = 'Origin #936'$$,
  '23514', 'announcement_audience_immutable',
  'changing an Announcement''s Audience is refused, even for BC');
select lives_ok(
  $$update announcements set title = 'Origin #936 edited', min_level = 2 where title = 'Origin #936'$$,
  'the rest of the Announcement stays editable');
reset role;
select results_eq(
  $$select grp.name, a.audience, a.min_level from announcements a join groups grp on grp.id = a.group_id
     where a.title = 'Origin #936 edited'$$,
  $$values ('Educațional'::text, 'local'::text, 2)$$,
  'the edit landed and the Group and Audience are unchanged');

-- A write with no signed-in caller (a migration, seed.sql) passes, as for the
-- other Announcement guards.
update announcements set audience = 'org' where title = 'Origin #936 edited';
select is((select audience from announcements where title = 'Origin #936 edited'), 'org',
  'a write without auth.uid() is not judged');

select * from finish();
rollback;
