-- volunteer_import.test.sql -- #991: the volunteer-base import.
--
-- public.import_member (one sheet row, atomically, idempotent), its lookup
-- public.import_member_lookup, the stamp public.record_invitation_sent, the
-- "De invitat" read public.uninvited_members, and profiles.invited_at /
-- public.member_imports underneath them.
--
-- Fixtures (owner, rolled back), ids 99100000-...-0000000000NN:
--   01 BC, activ             the importer
--   02 Vot, activ            an existing Member, never imported; below level 6
--   03 BC, inactiv           an importer who no longer may
--   10 new, imported as Vot  principal Dept B, secondary Dept A, Manager of
--                            Dept A ("Coordonator FR") -- one roster row each
--   11 new, imported as BC   board Responsible "Președinte", Project Responsible
--   12 new                   a row naming an archived Group: nothing survives
--   13 Auth only, unconfirmed, never signed in   -- an orphan the lookup reuses
--   14 Auth only, confirmed                       -- never reused
--   15 new, imported, then signs in               -- leaves "De invitat"
--
-- Mutation guards (run 2026-10-02 against the local database, each reverted;
-- the assertions that turned red are named):
--   * the importer gate's "role.level >= 6" lowered to ">= 0" -> "a Member
--     below level 6 cannot import";
--   * the member_not_imported refusal removed -> "an existing Member who was
--     never imported is not completed";
--   * appoint_group_member called with p_notify => true -> "the import writes
--     no Notification";
--   * the created_at shift removed -> "the principal Department is the
--     Member's chip, even when its id is higher";
--   * the placement shape check removed -> "one Group twice is malformed";
--   * uninvited_members_impl's level check removed -> "a Member below level 6
--     cannot read the grid";
--   * "profile.invited_at is null" removed from the grid -> "a stamped Member
--     leaves the grid";
--   * the lookup's member_imports.sheet_email join removed -> "the lookup
--     finds an imported Member by the address they were imported under".
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(37);

-- ==================== Fixtures ====================

create function pg_temp.u991(n integer) returns uuid language sql immutable as $$
  select ('99100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.g991(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;
grant execute on function pg_temp.u991(integer) to service_role, authenticated;
grant execute on function pg_temp.g991(text) to service_role, authenticated;

insert into auth.users (id, email)
select pg_temp.u991(n), 'u' || n || '-991@test.local'
  from unnest(array[1, 2, 3, 10, 11, 12, 13, 15]) as n;
insert into auth.users (id, email, email_confirmed_at)
values (pg_temp.u991(14), 'u14-991@test.local', now());

insert into public.profiles (id, full_name, email, role, status) values
  (pg_temp.u991(1), 'Importator BC #991', 'u1-991@test.local', 'bc',  'activ'),
  (pg_temp.u991(2), 'Membru Vot #991',    'u2-991@test.local', 'vot', 'activ'),
  (pg_temp.u991(3), 'BC Inactiv #991',    'u3-991@test.local', 'bc',  'inactiv');

-- Dept A before Dept B, so B's id is the higher one: the principal Department
-- must win the R17 chip by roster order, not by the id tie-break.
insert into public.groups (name, category, min_level) values ('Dept A #991', 'department', 0);
insert into public.groups (name, category, min_level) values ('Dept B #991', 'department', 0);
insert into public.groups (name, category, min_level) values ('Proiect #991', 'project', 0);
insert into public.groups (name, category, min_level, is_private) values ('Board #991', 'department', 5, true);
insert into public.groups (name, category, min_level, status) values ('Arhivat #991', 'department', 0, 'archived');

create temp table r991 (n integer primary key, result jsonb);
grant all on r991 to service_role;

-- The placements a row sends, built as owner.
create function pg_temp.p991(variadic p_items text[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'group_id',       (select id from public.groups where name = split_part(item, '|', 1)),
           'group_role',     split_part(item, '|', 2),
           'position_title', nullif(split_part(item, '|', 3), ''))
         order by ordinality), '[]'::jsonb)
    from unnest(p_items) with ordinality as entry(item, ordinality)
$$;
grant execute on function pg_temp.p991(text[]) to service_role;

-- ==================== Schema ====================

select has_column('public', 'profiles', 'invited_at', 'profiles carries invited_at');
select ok((select relrowsecurity from pg_class where oid = 'public.member_imports'::regclass),
  'member_imports has RLS enabled');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'invited_at', 'select')
          and not has_table_privilege('authenticated', 'public.member_imports', 'select'),
  'authenticated reads neither invited_at nor the import record directly');
select ok(not has_function_privilege('authenticated', 'public.import_member(uuid, text, text, public.member_role, text, date, jsonb, text[], integer, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.import_member_lookup(text[])', 'execute')
          and not has_function_privilege('authenticated', 'public.record_invitation_sent(uuid)', 'execute')
          and has_function_privilege('service_role', 'public.import_member(uuid, text, text, public.member_role, text, date, jsonb, text[], integer, uuid)', 'execute'),
  'the import, lookup and stamp are service role only');

-- ==================== Gate and malformed input ====================

set local role service_role;

select throws_ok(
  format($$select public.import_member(%L, 'Nou', 'nou-991@test.local', 'vot', null, '2026-02-22',
                                       '[]'::jsonb, '{}', 2, %L)$$, pg_temp.u991(12), pg_temp.u991(2)),
  '42501', 'member_manage_forbidden',
  'a Member below level 6 cannot import');
select throws_ok(
  format($$select public.import_member(%L, 'Nou', 'nou-991@test.local', 'vot', null, '2026-02-22',
                                       '[]'::jsonb, '{}', 2, %L)$$, pg_temp.u991(12), pg_temp.u991(3)),
  '42501', 'member_manage_forbidden',
  'an inactive BC member cannot import');
select throws_ok(
  format($$select public.import_member(%L, 'Nou', 'nou-991@test.local', 'vot', null, '2026-02-22',
                                       %L::jsonb, '{}', 2, %L)$$, pg_temp.u991(12),
         pg_temp.p991('Dept A #991|member|', 'Dept A #991|manager|'), pg_temp.u991(1)),
  'PT400', 'invalid_placements',
  'one Group twice is malformed');
select throws_ok(
  format($$select public.import_member(%L, 'Nou', 'nou-991@test.local', 'vot', null, '2026-02-22',
                                       %L::jsonb, '{}', 2, %L)$$, pg_temp.u991(12),
         pg_temp.p991('Dept A #991|boss|'), pg_temp.u991(1)),
  'PT400', 'invalid_placements',
  'an unknown Group Role is malformed');
select throws_ok(
  format($$select public.import_member(%L, 'Nou', 'nou-991@test.local', 'vot', null, '2026-02-22',
                                       '[]'::jsonb, array[' '], 2, %L)$$, pg_temp.u991(12), pg_temp.u991(1)),
  'PT400', 'invalid_problems',
  'a blank import note is malformed');
select throws_ok(
  format($$select public.import_member(%L, 'Nou', 'nou-991@test.local', 'vot', null, '2026-02-22',
                                       '[]'::jsonb, '{}', 1, %L)$$, pg_temp.u991(12), pg_temp.u991(1)),
  'PT400', 'invalid_sheet_row',
  'the header row is not a sheet row');

-- ==================== A row, created ====================

insert into r991
select 10, public.import_member(
  pg_temp.u991(10), '  Popescu Ana  ', 'U10-991@Test.Local', 'vot', '712345678', '2026-02-22',
  pg_temp.p991('Dept B #991|member|', 'Dept A #991|manager|Coordonator FR'),
  array['fără poziție'], 7, pg_temp.u991(1));
insert into r991
select 11, public.import_member(
  pg_temp.u991(11), 'Ionescu Dan', 'u11-991@test.local', 'bc', null, '2026-02-22',
  pg_temp.p991('Dept A #991|member|', 'Proiect #991|responsible|Responsabil Logistică',
               'Board #991|responsible|Președinte'),
  '{}', 8, pg_temp.u991(1));
reset role;

select is((select result ->> 'outcome' from r991 where n = 10), 'created',
  'a new row is created');
select is((select array_agg(placement ->> 'status' order by ordinality)
             from r991, jsonb_array_elements(result -> 'placements') with ordinality as entry(placement, ordinality)
            where n = 10),
          array['appointed', 'appointed'], 'every placement of a new row is appointed');
select row_eq(
  format($$select full_name, email, role::text, phone, joined_at from public.profiles where id = %L$$, pg_temp.u991(10)),
  row('Popescu Ana'::text, 'u10-991@test.local'::text, 'vot'::text, '+40712345678'::text, date '2026-02-22'),
  'the Profile carries the trimmed name, the lower-cased address, the rank, the E.164 phone and the join date');
select set_eq(
  format($$select g.name, m.group_role, m.position_title from public.group_members m join public.groups g on g.id = m.group_id where m.member_id = %L$$, pg_temp.u991(10)),
  $$values ('Dept B #991'::text, 'member'::text, null::text), ('Dept A #991', 'manager', 'Coordonator FR')$$,
  'a Department membership and a Department Manager appointment with its title');
select set_eq(
  format($$select g.name, m.group_role, m.position_title from public.group_members m join public.groups g on g.id = m.group_id where m.member_id = %L$$, pg_temp.u991(11)),
  $$values ('Dept A #991'::text, 'member'::text, null::text), ('Proiect #991', 'responsible', 'Responsabil Logistică'),
           ('Board #991', 'responsible', 'Președinte')$$,
  'a BC row is the board''s Responsible under its title, and a Project Responsible under "Responsabil <x>"');
select is((select count(*)::int from public.notifications
            where member_id in (pg_temp.u991(10), pg_temp.u991(11))),
          0, 'the import writes no Notification');
select row_eq(
  format($$select sheet_email, sheet_row, problems, imported_by from public.member_imports where member_id = %L$$, pg_temp.u991(10)),
  row('u10-991@test.local'::text, 7, array['fără poziție']::text[], pg_temp.u991(1)),
  'the import record keeps the address, the sheet row, the notes and the importer');

-- ==================== Re-run: idempotent, completes, never touches others ====================

set local role service_role;
insert into r991
select 20, public.import_member(
  pg_temp.u991(10), 'Alt Nume', 'u10-991@test.local', 'bc', null, '2026-02-22',
  pg_temp.p991('Dept B #991|member|', 'Dept A #991|member|', 'Proiect #991|member|'),
  array['proiect lipsă: Gala'], 7, pg_temp.u991(1));
reset role;

select is((select result ->> 'outcome' from r991 where n = 20), 'completed',
  'a re-run completes the Member it imported before');
select is((select array_agg(placement ->> 'status' order by ordinality)
             from r991, jsonb_array_elements(result -> 'placements') with ordinality as entry(placement, ordinality)
            where n = 20),
          array['present', 'conflict', 'appointed'],
  'a re-run reports what is present, what differs, and appoints only what is missing');
select row_eq(
  format($$select full_name, role::text, (select count(*)::int from public.profiles where email = 'u10-991@test.local') from public.profiles where id = %L$$, pg_temp.u991(10)),
  row('Popescu Ana'::text, 'vot'::text, 1),
  'a re-run creates no second Profile and leaves the name and rank as they were');
select is((select group_role from public.group_members
            where member_id = pg_temp.u991(10) and group_id = pg_temp.g991('Dept A #991')),
          'manager', 'a conflicting placement is left untouched');

set local role service_role;
select throws_ok(
  format($$select public.import_member(%L, 'Membru Vot #991', 'u2-991@test.local', 'vot', null, '2026-02-22',
                                       %L::jsonb, '{}', 9, %L)$$, pg_temp.u991(2),
         pg_temp.p991('Dept A #991|member|'), pg_temp.u991(1)),
  'PT409', 'member_not_imported',
  'an existing Member who was never imported is not completed');

-- ==================== Atomic ====================

select throws_ok(
  format($$select public.import_member(%L, 'Arhivă', 'u12-991@test.local', 'vot', null, '2026-02-22',
                                       %L::jsonb, '{}', 10, %L)$$, pg_temp.u991(12),
         pg_temp.p991('Dept A #991|member|', 'Arhivat #991|member|'), pg_temp.u991(1)),
  'PT409', 'group_archived',
  'a refused Appointment fails the row');
reset role;
select ok(not exists (select 1 from public.profiles where id = pg_temp.u991(12))
          and not exists (select 1 from public.group_members where member_id = pg_temp.u991(12))
          and not exists (select 1 from public.member_imports where member_id = pg_temp.u991(12)),
  'and leaves no Profile, roster row or import record behind');

-- ==================== Lookup ====================

-- BC corrects the address of Member 10; the sheet still says the old one.
update public.profiles set email = 'corectat-991@test.local' where id = pg_temp.u991(10);

set local role service_role;
select set_eq(
  $$select email, member_id, imported, orphan_user_id
      from public.import_member_lookup(array['U10-991@test.local', 'u2-991@test.local',
                                             'u13-991@test.local', 'u14-991@test.local',
                                             'nimeni-991@test.local', ' '])$$,
  format($$values ('u10-991@test.local'::text, %L::uuid, true, null::uuid),
                  ('u2-991@test.local', %L::uuid, false, null::uuid),
                  ('u13-991@test.local', null::uuid, false, %L::uuid),
                  ('u14-991@test.local', null::uuid, false, null::uuid)$$,
         pg_temp.u991(10), pg_temp.u991(2), pg_temp.u991(13)),
  'the lookup finds an imported Member by the address they were imported under, a Member by Profile, an orphan Auth account to reuse, and a confirmed one never to reuse');
select throws_ok(
  $$select * from public.import_member_lookup(array(select 'a' || n || '@x.ro' from generate_series(1, 2001) as n))$$,
  'PT400', 'too_many_emails',
  'the lookup takes at most 2000 addresses');

-- ==================== The "De invitat" grid ====================

insert into r991
select 15, public.import_member(
  pg_temp.u991(15), 'Logat Deja', 'u15-991@test.local', 'voluntar', null, '2026-02-22',
  pg_temp.p991('Dept A #991|member|'), '{}', 12, pg_temp.u991(1));
reset role;
update auth.users set last_sign_in_at = now() where id = pg_temp.u991(15);

select pg_temp.test_login_leadership(pg_temp.u991(1));
select row_eq(
  format($$select full_name, email, phone, role::text, sheet_row, problems, primary_group_name
             from public.uninvited_members() where member_id = %L$$, pg_temp.u991(10)),
  row('Popescu Ana'::text, 'corectat-991@test.local'::text, '+40712345678'::text, 'vot'::text, 7,
      array['proiect lipsă: Gala']::text[], 'Dept B #991'::text),
  'BC reads an imported Member with contact details, rank, sheet row and the latest run''s notes');
select is(
  (select primary_group_name from public.uninvited_members() where member_id = pg_temp.u991(10)),
  'Dept B #991',
  'the principal Department is the Member''s chip, even when its id is higher');
select is(
  (select array_agg(entry ->> 'name' order by ordinality)
     from public.uninvited_members() as grid,
          jsonb_array_elements(grid.memberships) with ordinality as e(entry, ordinality)
    where grid.member_id = pg_temp.u991(11)),
  array['Dept A #991', 'Proiect #991', 'Board #991'],
  'the grid lists the roster in import order, the Private board included');
select ok(not exists (select 1 from public.uninvited_members() where member_id = pg_temp.u991(15)),
  'a Member who signed in is not in the grid');
select ok(exists (select 1 from public.uninvited_members() where member_id = pg_temp.u991(2)),
  'a never-invited Member who was not imported is in the grid too');
reset role;

select pg_temp.test_login_leadership(pg_temp.u991(2));
select throws_ok($$select * from public.uninvited_members()$$, '42501', 'member_manage_forbidden',
  'a Member below level 6 cannot read the grid');
reset role;
select pg_temp.test_login(pg_temp.u991(1), '{}'::jsonb);
select throws_ok($$select * from public.uninvited_members()$$, '42501', 'member_manage_forbidden',
  'a session without organization claims cannot read the grid');
reset role;
select pg_temp.test_clear_jwt();

-- ==================== The invitation stamp ====================

set local role service_role;
select ok((select public.record_invitation_sent(pg_temp.u991(10))) is not null,
  'the stamp answers when it was recorded');
select throws_ok(format($$select public.record_invitation_sent(%L)$$, pg_temp.u991(99)),
  'PT404', 'member_not_found', 'the stamp refuses an unknown Member');
reset role;
select ok((select invited_at from public.profiles where id = pg_temp.u991(10)) is not null,
  'the stamp writes invited_at');

select pg_temp.test_login_leadership(pg_temp.u991(1));
select ok(not exists (select 1 from public.uninvited_members() where member_id = pg_temp.u991(10)),
  'a stamped Member leaves the grid');
reset role;

select * from finish();
rollback;
