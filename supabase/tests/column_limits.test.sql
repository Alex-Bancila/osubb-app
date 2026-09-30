-- column_limits.test.sql — security pass 2026-09-27 (backend findings M3 + L1).
--
-- M3: profiles.avatar_color is `#RRGGBB` or null, refused on a Member's own
-- update as 23514 invalid_avatar_color, and by profiles_avatar_color_ck
-- underneath the guard.
-- L1: every text column that had no length limit. A command that writes one
-- answers PT400 <field>_too_long at step 1 (asserted by calling the command
-- body directly, so only the new step-1 line can raise that reason); the
-- direct-write profile columns answer 23514 with the reason; every other
-- column is held by its CHECK constraint (raw 23514, constraint named).
-- private.notify clips an over-long composed title/body instead of refusing.
-- Runs in one transaction and rolls back.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(36);

-- Fixtures: the demo seed's Voluntar (a Member editing their own profile),
-- one Department Group, one Event and one roster row to update.
create temp table limits_fixture as
select (select id from public.groups where name = 'Educațional') as group_id,
       'd0000000-0000-0000-0000-000000000002'::uuid as member_id,
       'd0000000-0000-0000-0000-000000000007'::uuid as bc_id;
insert into public.events (title, type, group_id, starts_at)
select 'Limite #sec', 'sedinta', group_id, now() + interval '1 day' from limits_fixture;
grant select on limits_fixture to authenticated;

-- ==================== 1. profiles.avatar_color (M3) ====================
select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ update public.profiles set avatar_color = 'url(https://tracker.example/p.gif)' where id = auth.uid() $$,
  '23514', 'invalid_avatar_color',
  'a Member cannot store a CSS url() as their avatar colour');
select throws_ok(
  $$ update public.profiles set avatar_color = repeat('#', 5000) where id = auth.uid() $$,
  '23514', 'invalid_avatar_color',
  'nor an oversized value');
select throws_ok(
  $$ update public.profiles set avatar_color = 'red' where id = auth.uid() $$,
  '23514', 'invalid_avatar_color',
  'nor a colour name -- only #RRGGBB');
select lives_ok(
  $$ update public.profiles set avatar_color = '#a1B2c3' where id = auth.uid() $$,
  'a #RRGGBB colour in either case is accepted');
select lives_ok(
  $$ update public.profiles set avatar_color = null where id = auth.uid() $$,
  'no colour (the app default) is accepted');
select pg_temp.test_clear_jwt();
reset role;

-- The constraint holds without the guard.
alter table public.profiles disable trigger profiles_guard_text;
select throws_ok(
  $$ update public.profiles set avatar_color = 'url(x)' where id = 'd0000000-0000-0000-0000-000000000002' $$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_avatar_color_ck"',
  'profiles_avatar_color_ck refuses a non-#RRGGBB value underneath the guard');
select throws_ok(
  $$ update public.profiles set full_name = repeat('n', 121) where id = 'd0000000-0000-0000-0000-000000000002' $$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_full_name_length_ck"',
  'profiles_full_name_length_ck refuses a 121-character full name underneath the guard');
alter table public.profiles enable trigger profiles_guard_text;

-- ==================== 2. profiles.full_name / email ====================
select pg_temp.test_login_leadership('d0000000-0000-0000-0000-000000000007');
select throws_ok(
  $$ update public.profiles set full_name = repeat('n', 121) where id = 'd0000000-0000-0000-0000-000000000002' $$,
  '23514', 'full_name_too_long',
  'BC cannot store a full name over 120 characters');
select lives_ok(
  $$ update public.profiles set full_name = repeat('n', 120) where id = 'd0000000-0000-0000-0000-000000000002' $$,
  'a 120-character full name is accepted');
select pg_temp.test_clear_jwt();
reset role;

insert into auth.users (id, email) values ('5ec00000-0000-0000-0000-000000000001', 'limits.sec@test.local');
select throws_ok(
  $$ insert into public.profiles (id, full_name, email, role, status)
     values ('5ec00000-0000-0000-0000-000000000001', repeat('n', 121), 'limits.sec@test.local', 'recrut', 'activ') $$,
  '23514', 'full_name_too_long',
  'provisioning a profile with a full name over 120 characters is refused too');
select throws_ok(
  $$ insert into public.profiles (id, full_name, email, role, status)
     values ('5ec00000-0000-0000-0000-000000000001', 'Limite', repeat('e', 245) || '@test.local', 'recrut', 'activ') $$,
  '23514', 'new row for relation "profiles" violates check constraint "profiles_email_length_ck"',
  'profiles_email_length_ck refuses an address over 254 characters');

-- ==================== 3. events.location ====================
select throws_ok(
  format($$ select private.create_event_impl('Titlu valid', 'sedinta', %s, now() + interval '1 day',
                                             null, %L, null, null, 0, null) $$,
         (select group_id from limits_fixture), repeat('l', 201)),
  'PT400', 'location_too_long',
  'create_event refuses a location over 200 characters at step 1');
select throws_ok(
  format($$ select private.update_event_impl(%s, 'Titlu valid', 'sedinta', %s, now() + interval '1 day',
                                             null, %L, null, null, 0, null) $$,
         (select id from public.events where title = 'Limite #sec'),
         (select group_id from limits_fixture), '  ' || repeat('l', 201) || '  '),
  'PT400', 'location_too_long',
  'update_event refuses it too, measured after trimming');
select throws_ok(
  $$ update public.events set location = repeat('l', 201) where title = 'Limite #sec' $$,
  '23514', 'new row for relation "events" violates check constraint "events_location_length_ck"',
  'events_location_length_ck holds the same limit on the table');
select lives_ok(
  $$ update public.events set location = repeat('l', 200) where title = 'Limite #sec' $$,
  'a 200-character location is accepted');

-- ==================== 4. group_members.position_title ====================
select throws_ok(
  format($$ select private.set_group_role_impl(%s, %L, 'responsible', %L) $$,
         (select group_id from limits_fixture), (select member_id from limits_fixture), repeat('p', 81)),
  'PT400', 'position_title_too_long',
  'set_group_role refuses a position title over 80 characters at step 1');
select throws_ok(
  format($$ select private.appoint_group_member(%s, %L, %L, 'responsible', %L) $$,
         (select group_id from limits_fixture), (select member_id from limits_fixture),
         (select bc_id from limits_fixture), repeat('p', 81)),
  'PT400', 'position_title_too_long',
  'the shared roster writer refuses it for programmatic callers too');
select throws_ok(
  format($$ update public.group_members set position_title = %L where group_id = %s and member_id = %L $$,
         repeat('p', 81), (select group_id from limits_fixture), (select member_id from limits_fixture)),
  '23514', 'new row for relation "group_members" violates check constraint "group_members_position_title_length_ck"',
  'group_members_position_title_length_ck holds the same limit on the table');

-- ==================== 5. groups.manager_title / short ====================
select throws_ok(
  format($$ select private.update_group_impl(%s, 'Educațional', %L, null, false, null, false, 0, null, null) $$,
         (select group_id from limits_fixture), repeat('m', 81)),
  'PT400', 'manager_title_too_long',
  'update_group refuses a manager title over 80 characters at step 1');
select throws_ok(
  $$ select private.create_group_impl('Grup limite', 'team', null, null, null, null, repeat('s', 17), false) $$,
  'PT400', 'short_too_long',
  'create_group refuses a short label over 16 characters at step 1');
select throws_ok(
  format($$ select private.update_group_structure_impl(%s, 'department', true, false, false, 0, null, %L, false, false) $$,
         (select group_id from limits_fixture), repeat('s', 17)),
  'PT400', 'short_too_long',
  'update_group_structure refuses it too');
select throws_ok(
  format($$ update public.groups set manager_title = %L where id = %s $$,
         repeat('m', 81), (select group_id from limits_fixture)),
  '23514', 'new row for relation "groups" violates check constraint "groups_manager_title_length_ck"',
  'groups_manager_title_length_ck holds the manager-title limit on the table');
select throws_ok(
  format($$ update public.groups set short = %L where id = %s $$,
         repeat('s', 17), (select group_id from limits_fixture)),
  '23514', 'new row for relation "groups" violates check constraint "groups_short_length_ck"',
  'groups_short_length_ck holds the short-label limit on the table');
select lives_ok(
  format($$ update public.groups set short = %L, manager_title = %L where id = %s $$,
         repeat('s', 16), repeat('m', 80), (select group_id from limits_fixture)),
  'a 16-character short label and an 80-character manager title are accepted');

-- ==================== 6. points_ledger, guides ====================
select throws_ok(
  format($$ insert into public.points_ledger (member_id, delta, reason, awarded_by, note)
            values (%L, -1, 'sanction', %L, %L) $$,
         (select member_id from limits_fixture), (select bc_id from limits_fixture), repeat('n', 1001)),
  '23514', 'new row for relation "points_ledger" violates check constraint "points_ledger_note_length_ck"',
  'points_ledger_note_length_ck refuses a sanction note over 1000 characters');
select throws_ok(
  $$ update public.rating_guide set label = repeat('l', 61) where rating = 3 $$,
  '23514', 'new row for relation "rating_guide" violates check constraint "rating_guide_label_length_ck"',
  'rating_guide_label_length_ck refuses a label over 60 characters');
select throws_ok(
  $$ update public.rating_guide set note = repeat('n', 1001) where rating = 3 $$,
  '23514', 'new row for relation "rating_guide" violates check constraint "rating_guide_note_length_ck"',
  'rating_guide_note_length_ck refuses a note over 1000 characters');
select throws_ok(
  $$ update public.difficulty_guide set note = repeat('n', 1001) where stars = 3 $$,
  '23514', 'new row for relation "difficulty_guide" violates check constraint "difficulty_guide_note_length_ck"',
  'difficulty_guide_note_length_ck refuses a note over 1000 characters');

-- ==================== 7. notifications ====================
select throws_ok(
  format($$ insert into public.notifications (member_id, kind, title) values (%L, 'system', %L) $$,
         (select member_id from limits_fixture), repeat('t', 201)),
  '23514', 'new row for relation "notifications" violates check constraint "notifications_title_length_ck"',
  'notifications_title_length_ck refuses a title over 200 characters');
select throws_ok(
  format($$ insert into public.notifications (member_id, kind, title, body) values (%L, 'system', 'Titlu', %L) $$,
         (select member_id from limits_fixture), repeat('b', 2001)),
  '23514', 'new row for relation "notifications" violates check constraint "notifications_body_length_ck"',
  'notifications_body_length_ck refuses a body over 2000 characters');
select is(
  private.notify(array[(select member_id from limits_fixture)], 'system', repeat('t', 250), repeat('b', 2500),
                 null, 'limits-sec', (select bc_id from limits_fixture)),
  1, 'private.notify still delivers when the composed text is over the limits');
select is(
  (select format('%s|%s', char_length(title), char_length(body))
     from public.notifications where dedupe_key = 'limits-sec'),
  '200|2000', 'private.notify clips the title to 200 and the body to 2000 characters');

-- ==================== 8. Posture ====================
select ok(
  not has_function_privilege('authenticated', 'private.guard_profile_text()', 'execute')
  and not has_function_privilege('anon', 'private.guard_profile_text()', 'execute')
  and not has_function_privilege('service_role', 'private.guard_profile_text()', 'execute'),
  'the profile text guard is executable by no client role');
select is(
  (select array_agg(conname::text order by conname) from pg_constraint
    where contype = 'c' and not convalidated
      and conname in ('profiles_avatar_color_ck', 'profiles_full_name_length_ck', 'profiles_email_length_ck',
                      'events_location_length_ck', 'group_members_position_title_length_ck',
                      'groups_manager_title_length_ck', 'groups_responsible_title_length_ck',
                      'groups_short_length_ck',
                      'points_ledger_note_length_ck', 'rating_guide_label_length_ck',
                      'rating_guide_note_length_ck', 'difficulty_guide_note_length_ck',
                      'notifications_title_length_ck', 'notifications_body_length_ck')),
  null, 'every new constraint is validated');
select is(
  (select count(*) from pg_constraint
    where contype = 'c'
      and conname in ('profiles_avatar_color_ck', 'profiles_full_name_length_ck', 'profiles_email_length_ck',
                      'events_location_length_ck', 'group_members_position_title_length_ck',
                      'groups_manager_title_length_ck', 'groups_responsible_title_length_ck',
                      'groups_short_length_ck',
                      'points_ledger_note_length_ck', 'rating_guide_label_length_ck',
                      'rating_guide_note_length_ck', 'difficulty_guide_note_length_ck',
                      'notifications_title_length_ck', 'notifications_body_length_ck')),
  14::bigint, 'all fourteen constraints exist (#962 added groups_responsible_title_length_ck)');
select is(
  (select count(*) from public.profiles where avatar_color is not null and avatar_color !~ '^#[0-9A-Fa-f]{6}$'),
  0::bigint, 'no stored avatar colour is outside #RRGGBB');

select * from finish();
rollback;
