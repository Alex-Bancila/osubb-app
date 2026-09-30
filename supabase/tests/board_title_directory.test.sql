-- board_title_directory.test.sql -- #963: a BC or BCE member's Board Title
-- (CONTEXT.md; decision D1, #824) is readable by every Member through the two
-- projections every Member already reads -- profiles_directory.board_title and
-- member_card().board_title -- while the Private board Group's roster stays
-- hidden. Both read private.board_title(p_member), the one definition: the
-- trimmed position_title of the Member's Group Responsible row on the Group
-- org_settings.board_group_id names, for a BC or BCE member, null otherwise.
--
-- In order: the helper's shape and grants; the view's column and grants; what
-- an ordinary Member reads (titles yes, roster no); who carries no title; the
-- Member Card; the setting cleared.
--
-- Mutation guards, each named against the assertion that turns red:
--   * drop board_title from profiles_directory -> "a Voluntar reads the BC's
--     Board Title" fails (column does not exist) and the pin in
--     retired_surface.test.sql fails;
--   * make the helper security invoker -> "a Voluntar reads the BC's Board
--     Title" answers null: group_members_read hides the Private roster;
--   * drop the group filter (any Group's Responsible title) -> "a BCE who is a
--     Responsible elsewhere carries no Board Title" answers that title;
--   * drop the group_role = 'responsible' limb -> "a Group Manager row on the
--     board carries no Board Title" answers the manager row's title;
--   * drop the BC/BCE limb -> "the Moderator carries no Board Title" answers
--     the Moderator's row (F-7, #893: the Moderator is not a board position);
--   * ignore the setting -> the three "with board_group_id unset" assertions
--     answer the titles;
--   * drop board_title from member_card -> "member_card carries the Board
--     Title" fails.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(23);

-- ==================== 1. The helper: shape and grants ====================

select has_function('private', 'board_title', array['uuid'],
  'private.board_title(uuid) exists');
select ok(
  (select procedure.prosecdef and procedure.provolatile = 's'
          and 'search_path=""' = any(procedure.proconfig)
          and procedure.prorettype = 'text'::regtype
     from pg_proc as procedure
    where procedure.oid = 'private.board_title(uuid)'::regprocedure),
  'the helper is stable, security definer, pins search_path and returns text');
select ok(
  has_function_privilege('authenticated', 'private.board_title(uuid)', 'execute')
  and not has_function_privilege('anon', 'private.board_title(uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.board_title(uuid)', 'execute')
  and not has_function_privilege('public', 'private.board_title(uuid)', 'execute'),
  'authenticated executes it (the security_invoker view calls it as the reader); anon, service_role and PUBLIC do not');

-- ==================== 2. The view: column and grants ====================

select has_column('public', 'profiles_directory', 'board_title',
  'profiles_directory exposes board_title');
select ok(
  coalesce((select 'security_invoker=on' = any (reloptions)
              from pg_class where oid = 'public.profiles_directory'::regclass), false)
  and has_table_privilege('authenticated', 'public.profiles_directory', 'select')
  and not has_table_privilege('anon', 'public.profiles_directory', 'select')
  and not has_table_privilege('service_role', 'public.profiles_directory', 'select'),
  'profiles_directory stays security_invoker, read by authenticated only -- service_role has no usage on private, so a grant to it could never answer a row (conventions section 4)');

-- ==================== Fixtures -- prefix 96300000-... ====================

insert into auth.users (id, email) values
  ('96300000-0000-0000-0000-000000000001', 'bc963@test.local'),
  ('96300000-0000-0000-0000-000000000002', 'bce963@test.local'),
  ('96300000-0000-0000-0000-000000000003', 'bceout963@test.local'),
  ('96300000-0000-0000-0000-000000000004', 'vol963@test.local'),
  ('96300000-0000-0000-0000-000000000005', 'mod963@test.local'),
  ('96300000-0000-0000-0000-000000000006', 'bcemgr963@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('96300000-0000-0000-0000-000000000001', 'BC 963',            'bc963@test.local',     'bc',        'activ'),
  ('96300000-0000-0000-0000-000000000002', 'BCE 963',           'bce963@test.local',    'bce',       'activ'),
  ('96300000-0000-0000-0000-000000000003', 'BCE în afară 963',  'bceout963@test.local', 'bce',       'activ'),
  ('96300000-0000-0000-0000-000000000004', 'Voluntar 963',      'vol963@test.local',    'voluntar',  'activ'),
  ('96300000-0000-0000-0000-000000000005', 'Moderator 963',     'mod963@test.local',    'moderator', 'activ'),
  ('96300000-0000-0000-0000-000000000006', 'BCE manager 963',   'bcemgr963@test.local', 'bce',       'activ');

-- The board, and a second Private Group where a BCE is a Responsible with a
-- title: only the Group the setting names holds Board Titles.
insert into public.groups (name, category, min_level, is_private)
values ('Biroul 963', 'team', 5, true),
       ('Alt grup privat 963', 'team', 5, true);

create temp table fx963 as
  select (select id from public.groups where name = 'Biroul 963')          as board,
         (select id from public.groups where name = 'Alt grup privat 963') as other;
grant select on fx963 to authenticated, anon;

insert into public.group_members (group_id, member_id, group_role, position_title)
select fixture.group_id, fixture.member_id::uuid, fixture.group_role, fixture.title
  from fx963,
       lateral (values
         (fx963.board, '96300000-0000-0000-0000-000000000001', 'responsible', 'Președinte 963'),
         (fx963.board, '96300000-0000-0000-0000-000000000002', 'responsible', 'Coordonator IT 963'),
         (fx963.other, '96300000-0000-0000-0000-000000000003', 'responsible', 'Responsabil 963'),
         (fx963.board, '96300000-0000-0000-0000-000000000005', 'responsible', 'Titlu moderator 963'),
         (fx963.board, '96300000-0000-0000-0000-000000000006', 'manager',     'Manager 963')
       ) as fixture (group_id, member_id, group_role, title);

-- Whatever the demo seed pointed it at, the board here is Biroul 963.
update public.org_settings
   set value = (select board from fx963)::text, updated_by = null
 where key = 'board_group_id';

create function pg_temp.as_voluntar963() returns void language sql as $$
  select pg_temp.test_login('96300000-0000-0000-0000-000000000004',
    '{"member_role":"voluntar","member_level":1,"group_ids":[]}'::jsonb) $$;

create function pg_temp.directory_title963(p_n integer) returns text language sql stable as $$
  select profile.board_title
    from public.profiles_directory as profile
   where profile.id = ('96300000-0000-0000-0000-00000000000' || p_n)::uuid $$;

-- ==================== 3. An ordinary Member reads the titles, not the roster ====================

select pg_temp.as_voluntar963();
select is(pg_temp.directory_title963(1), 'Președinte 963',
  'a Voluntar reads the BC''s Board Title in profiles_directory');
select is(pg_temp.directory_title963(2), 'Coordonator IT 963',
  'and the BCE''s');
select is(
  (select count(*)::int from public.group_members, fx963 where group_id = fx963.board),
  0,
  'while the board Group''s roster stays hidden from them (group_members_read, #756)');
select is(
  (select count(*)::int from public.groups, fx963 where id = fx963.board),
  0,
  'and so does the Private board Group itself');
select is(private.board_title('96300000-0000-0000-0000-000000000001'), 'Președinte 963',
  'the helper answers the same title when a Voluntar calls it directly');

-- ==================== 4. Who carries no Board Title ====================

select is(pg_temp.directory_title963(3), null,
  'a BCE who is a Responsible elsewhere carries no Board Title -- only the Group board_group_id names counts');
select is(pg_temp.directory_title963(6), null,
  'a Group Manager row on the board carries no Board Title -- only a Group Responsible has a display name');
select is(pg_temp.directory_title963(5), null,
  'the Moderator carries no Board Title even on the board (F-7, #893: the Moderator is not a board position)');
select is(pg_temp.directory_title963(4), null,
  'a Voluntar carries none (the board''s Minimum Level is 5)');
select is(private.board_title('96399999-0000-0000-0000-000000000000'), null,
  'an unknown id answers null');

-- ==================== 5. The Member Card ====================

select is(
  (select board_title from public.member_card('96300000-0000-0000-0000-000000000001')),
  'Președinte 963',
  'member_card carries the Board Title, for a Voluntar viewer');
select is(
  (select role::text from public.member_card('96300000-0000-0000-0000-000000000001')),
  'bc',
  'beside the Role, which stays the rank');
select is(
  (select board_title from public.member_card('96300000-0000-0000-0000-000000000003')),
  null,
  'member_card answers null for a BCE without a Board Title');
select ok(
  not (select coalesce(jsonb_path_query_array(card.memberships, '$[*].name'), '[]'::jsonb)
                ? 'Biroul 963'
         from public.member_card('96300000-0000-0000-0000-000000000001') as card),
  'the card still does not name the Private board Group to a viewer who cannot see it');
reset role;

-- A board member reads the same title: the projection does not vary by viewer.
select pg_temp.test_login_leadership('96300000-0000-0000-0000-000000000002');
select is(pg_temp.directory_title963(1), 'Președinte 963',
  'a BCE on the board reads the same Board Title');
reset role;

-- ==================== 6. The setting cleared ====================

update public.org_settings set value = null where key = 'board_group_id';

select pg_temp.as_voluntar963();
select is(pg_temp.directory_title963(1), null,
  'with board_group_id unset profiles_directory carries no Board Title');
select is(private.board_title('96300000-0000-0000-0000-000000000002'), null,
  'with board_group_id unset the helper answers null for everyone');
select is(
  (select board_title from public.member_card('96300000-0000-0000-0000-000000000001')),
  null,
  'with board_group_id unset member_card carries no Board Title');
reset role;

select * from finish();
rollback;
