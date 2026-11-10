-- adherence_message.test.sql -- R66 (spec
-- docs/superpowers/specs/2026-11-10-voluntar-activ-message-design.md): the
-- Adherence Message BC writes for every active Voluntar Activ at UBB, shown
-- until answered, then on Profil.
--
-- In order: the schema and its grants, the day-one row and the retired
-- org_settings key, who reads what, BC's command (step 1 for every caller,
-- the gate, nothing_to_update, the first message), who receives it, the
-- answer, the counts, a quiet save, asking again, turning it off and on, the
-- rule following a Universitate change and a promotion, the "Rol actualizat"
-- text, and Member Deletion (R59).
--
-- Mutation guards, each named against the assertion that turns red:
--   * drop the university limb of adherence_message_eligible -> "a Voluntar
--     Activ at another university receives nothing" returns a row;
--   * drop the role limb -> "a Voluntar at UBB receives nothing" returns a row;
--   * bump version on every save -> "a quiet save keeps the version" fails;
--   * stop bumping on a message turned on from none -> "turning it on again
--     moves the version" fails;
--   * drop the stale-version check in answer_adherence_message -> "answering
--     an old version is adherence_message_changed" succeeds;
--   * drop the level check in set_adherence_message -> "a BCE writes
--     nothing" succeeds;
--   * restore the activ branch in apply_member_role -> the promotion text
--     carries the AG sentence again;
--   * drop adherence_message_reads from member_deletion_goes' exclusion list
--     -> "an answer does not hold the account" fails.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(78);

-- ==================== Fixtures ====================

create function pg_temp.u(p_n integer) returns uuid language sql immutable as $$
  select ('66600000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid $$;

insert into auth.users (id, email)
select pg_temp.u(n), 'r66.' || n || '@test.local' from generate_series(1, 13) as n;

insert into public.profiles (id, full_name, email, role, status, university) values
  (pg_temp.u(1),  'Moderator R66',             'r66.1@test.local',  'moderator', 'activ',   null),
  (pg_temp.u(2),  'BC R66',                    'r66.2@test.local',  'bc',        'activ',   private.ubb_university()),
  (pg_temp.u(3),  'BCE R66',                   'r66.3@test.local',  'bce',       'activ',   private.ubb_university()),
  -- The eligible: active Voluntari Activi at UBB.
  (pg_temp.u(4),  'Activ UBB A',               'r66.4@test.local',  'activ',     'activ',   private.ubb_university()),
  (pg_temp.u(5),  'Activ UBB B',               'r66.5@test.local',  'activ',     'activ',   private.ubb_university()),
  -- Not eligible, each for one reason.
  (pg_temp.u(6),  'Activ UTCN',                'r66.6@test.local',  'activ',     'activ',   'Universitatea Tehnică din Cluj-Napoca'),
  (pg_temp.u(7),  'Activ fără universitate',   'r66.7@test.local',  'activ',     'activ',   null),
  (pg_temp.u(8),  'Voluntar UBB',              'r66.8@test.local',  'voluntar',  'activ',   private.ubb_university()),
  (pg_temp.u(9),  'Vot UBB',                   'r66.9@test.local',  'vot',       'activ',   private.ubb_university()),
  (pg_temp.u(10), 'Activ UBB dezactivat',      'r66.10@test.local', 'activ',     'inactiv', private.ubb_university()),
  -- Eligible by their Profile, but signed in without organization claims.
  (pg_temp.u(11), 'Activ UBB fără claims',     'r66.11@test.local', 'activ',     'activ',   private.ubb_university()),
  -- A Voluntar at UBB BC promotes below.
  (pg_temp.u(12), 'Voluntar UBB de promovat',  'r66.12@test.local', 'voluntar',  'activ',   private.ubb_university()),
  -- Deactivated, still holding the level-6 token it was issued (ADR-0003).
  (pg_temp.u(13), 'BC dezactivat R66',         'r66.13@test.local', 'bc',        'inactiv', null);

-- The counts read every active Voluntar Activ at UBB: the demo seed's leave
-- the population, so the figures below are this suite's own.
update public.profiles set status = 'inactiv'
 where status = 'activ' and role = 'activ' and id::text not like '66600000-%';

create function pg_temp.as_member(p_n integer) returns void language sql as $$
  select pg_temp.test_login_leadership(pg_temp.u(p_n)) $$;
create function pg_temp.as_stale(p_n integer, p_role text, p_level integer) returns void language sql as $$
  select pg_temp.test_login(pg_temp.u(p_n), jsonb_build_object(
    'member_role', p_role, 'member_level', p_level, 'group_ids', '[]'::jsonb)) $$;

-- ==================== 1. Schema and grants ====================

select has_table('public', 'adherence_message', 'public.adherence_message exists');
select has_table('public', 'adherence_message_reads', 'public.adherence_message_reads exists');
select is(
  array[(select relrowsecurity from pg_class where oid = 'public.adherence_message'::regclass),
        (select relrowsecurity from pg_class where oid = 'public.adherence_message_reads'::regclass)],
  array[true, true],
  'both tables enable RLS (house rule 2)');
select is(
  (select array_agg(policyname || ':' || cmd order by policyname)::text[] from pg_policies
    where schemaname = 'public' and tablename = 'adherence_message'),
  array['adherence_message_read:SELECT'],
  'the message''s only policy is a read -- no client write policy');
select is(
  (select array_agg(policyname || ':' || cmd order by policyname)::text[] from pg_policies
    where schemaname = 'public' and tablename = 'adherence_message_reads'),
  array['adherence_message_reads_read:SELECT'],
  'the answers'' only policy is a read -- no client write policy');
select is(
  array[has_table_privilege('authenticated', 'public.adherence_message', 'select'),
        has_table_privilege('authenticated', 'public.adherence_message', 'insert'),
        has_table_privilege('authenticated', 'public.adherence_message', 'update'),
        has_table_privilege('authenticated', 'public.adherence_message', 'delete'),
        has_table_privilege('authenticated', 'public.adherence_message_reads', 'select'),
        has_table_privilege('authenticated', 'public.adherence_message_reads', 'insert'),
        has_table_privilege('authenticated', 'public.adherence_message_reads', 'update'),
        has_table_privilege('authenticated', 'public.adherence_message_reads', 'delete')],
  array[true, false, false, false, true, false, false, false],
  'authenticated may select both tables and write neither');
select is(
  array[has_table_privilege('anon', 'public.adherence_message', 'select'),
        has_table_privilege('anon', 'public.adherence_message_reads', 'select')],
  array[false, false],
  'anon holds no privilege on either table');
select is(
  (select array_agg(p.prosecdef order by p.proname)
     from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('my_adherence_message', 'answer_adherence_message',
                        'set_adherence_message', 'adherence_message_status'))
  || (select array_agg(p.prosecdef order by p.proname)
        from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
       where n.nspname = 'private'
         and p.proname in ('my_adherence_message_impl', 'answer_adherence_message_impl',
                           'set_adherence_message_impl', 'adherence_message_status_impl')),
  array[false, false, false, false, true, true, true, true],
  'the four wrappers are security invoker and their bodies security definer (conventions section 2)');
select is(
  (select count(*)::int from pg_trigger as t
    where t.tgname = 'broadcast_change' and not t.tgisinternal
      and t.tgrelid in ('public.adherence_message'::regclass, 'public.adherence_message_reads'::regclass)),
  2,
  'both tables broadcast their changes (ADR-0011): a save reaches every open app, an answer the Member''s other devices and BC''s counts');

-- ==================== 2. Day one ====================

select results_eq(
  $$ select id, title, body, link_url, link_label, version, updated_by from public.adherence_message $$,
  $$ values (1::smallint, null::text, null::text, null::text, null::text, 0, null::uuid) $$,
  'day one: the one row, no heading or body (no window) -- and no link, since no adherence_form_url was set here (the upgrade harness replays a set one)');
select is((select count(*) from public.org_settings where key = 'adherence_form_url'), 0::bigint,
  'the adherence_form_url setting is gone from org_settings');
select is(
  (select count(*) from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosrc like '%adherence_form_url%'),
  0::bigint,
  'no live function reads adherence_form_url any more');

-- ==================== 3. Who reads the table ====================

select pg_temp.as_member(2);
select is((select count(*) from public.adherence_message), 1::bigint, 'BC reads the message row');
reset role;
select pg_temp.as_member(3);
select is((select count(*) from public.adherence_message), 0::bigint, 'a BCE reads nothing from it');
reset role;
select pg_temp.as_member(4);
select is((select count(*) from public.adherence_message), 0::bigint,
  'an eligible Member reads nothing from the table -- only through my_adherence_message');
select is((select count(*) from public.my_adherence_message()), 0::bigint,
  'and my_adherence_message returns nothing while there is no message');
reset role;
select pg_temp.test_login(pg_temp.u(11), '{}'::jsonb);
select is((select count(*) from public.adherence_message), 0::bigint, 'a claimless session reads nothing');
reset role;

-- ==================== 4. set_adherence_message: step 1, for every caller ====================

select pg_temp.as_member(2);
select throws_ok($$ select public.set_adherence_message(null, 'Corp', null, null, false) $$,
  'PT400', 'title_required', 'a body without a heading is title_required');
select throws_ok($$ select public.set_adherence_message('Titlu', '   ', null, null, false) $$,
  'PT400', 'body_required', 'a heading without a body is body_required');
select throws_ok(format($$ select public.set_adherence_message(%L, 'Corp', null, null, false) $$, repeat('t', 121)),
  'PT400', 'title_too_long', 'a heading over 120 characters is title_too_long');
select throws_ok(format($$ select public.set_adherence_message('Titlu', %L, null, null, false) $$, repeat('**b** ', 667)),
  'PT400', 'body_too_long', 'a body over 4000 stored characters is body_too_long');
select throws_ok(format($$ select public.set_adherence_message('Titlu', %L, null, null, false) $$, repeat('a', 2001)),
  'PT400', 'body_too_long', 'a body over 2000 visible characters is body_too_long (R60)');
select throws_ok($$ select public.set_adherence_message('Titlu', 'Corp', 'https://forms.example.org/a', '  ', false) $$,
  'PT400', 'link_incomplete', 'an address without a label is link_incomplete');
select throws_ok(format($$ select public.set_adherence_message('Titlu', 'Corp', 'https://forms.example.org/a', %L, false) $$, repeat('l', 61)),
  'PT400', 'link_label_too_long', 'a label over 60 characters is link_label_too_long');
select throws_ok($$ select public.set_adherence_message('Titlu', 'Corp', 'ftp://forms.example.org/a', 'Formular', false) $$,
  'PT400', 'link_url_invalid', 'an address that is not http(s) is link_url_invalid');
select throws_ok(format($$ select public.set_adherence_message('Titlu', 'Corp', %L, 'Formular', false) $$, 'https://' || repeat('a', 2041)),
  'PT400', 'link_url_too_long', 'an address over 2048 characters is link_url_too_long');
reset role;
select pg_temp.as_member(4);
select throws_ok($$ select public.set_adherence_message(null, 'Corp', null, null, false) $$,
  'PT400', 'title_required', 'malformed for everyone, so a Voluntar Activ hears title_required before the gate');
reset role;

-- ==================== 5. set_adherence_message: the gate ====================

select pg_temp.as_member(3);
select throws_ok($$ select public.set_adherence_message('Titlu', 'Corp', null, null, false) $$,
  '42501', 'adherence_message_manage_forbidden', 'a BCE writes nothing');
reset role;
select pg_temp.as_member(4);
select throws_ok($$ select public.set_adherence_message('Titlu', 'Corp', null, null, false) $$,
  '42501', 'adherence_message_manage_forbidden', 'a Voluntar Activ writes nothing');
reset role;
select pg_temp.test_login(pg_temp.u(11), '{}'::jsonb);
select throws_ok($$ select public.set_adherence_message('Titlu', 'Corp', null, null, false) $$,
  '42501', 'adherence_message_manage_forbidden', 'a claimless session writes nothing');
reset role;
select pg_temp.as_stale(13, 'bc', 6);
select throws_ok($$ select public.set_adherence_message('Titlu', 'Corp', null, null, false) $$,
  '42501', 'adherence_message_manage_forbidden', 'a deactivated BC holding a level-6 token writes nothing');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select public.set_adherence_message('Titlu', 'Corp', null, null, false) $$,
  '42501', null, 'anon cannot even execute the command');
reset role;
select pg_temp.as_member(2);
select throws_ok($$ update public.adherence_message set title = 'Direct' $$,
  '42501', null, 'not even BC writes the row directly -- set_adherence_message is the only write path');
reset role;
select pg_temp.as_member(4);
select throws_ok(format($$ insert into public.adherence_message_reads (member_id, version) values (%L, 1) $$, pg_temp.u(4)),
  '42501', null, 'a Member cannot write their own answer directly -- answer_adherence_message is the only write path');
reset role;

-- ==================== 6. The first message ====================

select pg_temp.as_member(2);
select throws_ok($$ select public.set_adherence_message(null, '  ', null, null, true) $$,
  'PT409', 'nothing_to_update', 'turning off a message that is already off, with the same link, is nothing_to_update');
create temp table first_66 as
  select * from public.set_adherence_message('  Aderarea la Adunarea Generală  ', '**Salut!** Completează formularul.',
                                             ' https://forms.example.org/ag ', ' Deschide formularul ', false);
select results_eq(
  $$ select title, body, link_url, link_label, version, updated_by from first_66 $$,
  format($$ values ('Aderarea la Adunarea Generală'::text, '**Salut!** Completează formularul.'::text,
                    'https://forms.example.org/ag'::text, 'Deschide formularul'::text, 1, %L::uuid) $$, pg_temp.u(2)),
  'BC publishes the first message: each text trimmed, BC recorded, and version 1 although p_ask_again is false -- a new message reaches everyone');
select throws_ok(
  $$ select public.set_adherence_message('Aderarea la Adunarea Generală', '**Salut!** Completează formularul.',
                                         'https://forms.example.org/ag', 'Deschide formularul', false) $$,
  'PT409', 'nothing_to_update', 'saving the same words again quietly is nothing_to_update');
reset role;

-- ==================== 7. Who receives it ====================

select pg_temp.as_member(4);
select results_eq(
  $$ select title, body, link_url, link_label, version, answered from public.my_adherence_message() $$,
  $$ values ('Aderarea la Adunarea Generală'::text, '**Salut!** Completează formularul.'::text,
             'https://forms.example.org/ag'::text, 'Deschide formularul'::text, 1, false) $$,
  'an active Voluntar Activ at UBB receives the message, not yet answered');
reset role;
select pg_temp.as_member(6);
select is((select count(*) from public.my_adherence_message()), 0::bigint,
  'a Voluntar Activ at another university receives nothing');
reset role;
select pg_temp.as_member(7);
select is((select count(*) from public.my_adherence_message()), 0::bigint,
  'a Voluntar Activ whose Universitate is unknown receives nothing');
reset role;
select pg_temp.as_member(8);
select is((select count(*) from public.my_adherence_message()), 0::bigint,
  'a Voluntar at UBB receives nothing');
reset role;
select pg_temp.as_member(9);
select is((select count(*) from public.my_adherence_message()), 0::bigint,
  'a Voluntar cu Drept de Vot at UBB receives nothing');
reset role;
select pg_temp.as_member(2);
select is((select count(*) from public.my_adherence_message()), 0::bigint,
  'BC, at UBB, receives nothing');
reset role;
select pg_temp.as_stale(10, 'activ', 3);
select is((select count(*) from public.my_adherence_message()), 0::bigint,
  'a deactivated Voluntar Activ at UBB, still holding a token, receives nothing');
reset role;
select pg_temp.test_login(pg_temp.u(11), '{}'::jsonb);
select is((select count(*) from public.my_adherence_message()), 0::bigint,
  'a claimless session receives nothing, whatever its Profile');
reset role;

-- ==================== 8. The answer ====================

select pg_temp.as_member(6);
select throws_ok($$ select public.answer_adherence_message(1) $$,
  'PT404', 'adherence_message_not_found', 'a Member the message is not for cannot answer it');
reset role;
select pg_temp.as_member(4);
select throws_ok($$ select public.answer_adherence_message(0) $$,
  'PT409', 'adherence_message_changed', 'answering an old version is adherence_message_changed');
select throws_ok($$ select public.answer_adherence_message(null) $$,
  'PT409', 'adherence_message_changed', 'answering no version is adherence_message_changed');
reset role;
select pg_temp.test_login(pg_temp.u(11), '{}'::jsonb);
select throws_ok($$ select public.answer_adherence_message(1) $$,
  '42501', 'adherence_message_answer_forbidden', 'a claimless session cannot answer');
reset role;
select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select public.answer_adherence_message(1) $$,
  '42501', null, 'anon cannot even execute the answer');
reset role;

select pg_temp.as_member(4);
select lives_ok($$ select public.answer_adherence_message(1) $$, 'Member A answers Am citit');
select is((select answered from public.my_adherence_message()), true,
  'Member A''s message is now answered -- Profil shows it, the window does not');
select is((select count(*) from public.adherence_message_reads), 1::bigint, 'Member A reads their own answer');
select lives_ok($$ select public.answer_adherence_message(1) $$,
  'answering the same version again is accepted (a second device)');
reset role;
select pg_temp.as_member(5);
select is((select count(*) from public.adherence_message_reads), 0::bigint,
  'Member B reads nobody else''s answer');
reset role;

-- ==================== 9. The counts ====================

select pg_temp.as_member(2);
select results_eq($$ select eligible_count, answered_count from public.adherence_message_status() $$,
  $$ values (3, 1) $$,
  'BC counts three eligible (A, B and the claimless session''s active Profile) and one answer');
select is((select count(*) from public.adherence_message_reads), 1::bigint, 'BC reads every answer');
reset role;
select pg_temp.as_member(3);
select is((select count(*) from public.adherence_message_status()), 0::bigint, 'a BCE gets no counts');
reset role;

-- ==================== 10. A quiet save, then asking again ====================

select pg_temp.as_member(2);
select is(
  (select version from public.set_adherence_message('Aderarea la Adunarea Generală', 'Completează formularul până vineri.',
                                                    'https://forms.example.org/ag', 'Deschide formularul', false)),
  1,
  'a quiet save (Salvează) keeps the version');
reset role;
select pg_temp.as_member(4);
select results_eq($$ select body, answered from public.my_adherence_message() $$,
  $$ values ('Completează formularul până vineri.'::text, true) $$,
  'Member A sees the corrected words on Profil and is not asked again');
reset role;
select pg_temp.as_member(5);
select is((select answered from public.my_adherence_message()), false,
  'Member B, who never answered, still meets the window');
reset role;

select pg_temp.as_member(2);
select is(
  (select version from public.set_adherence_message('Aderarea la Adunarea Generală', 'Completează formularul până vineri.',
                                                    'https://forms.example.org/ag', 'Deschide formularul', true)),
  2,
  'Salvează și arată din nou moves the version, even with the words unchanged');
reset role;
select pg_temp.as_member(4);
select is((select answered from public.my_adherence_message()), false,
  'Member A is asked again');
select throws_ok($$ select public.answer_adherence_message(1) $$,
  'PT409', 'adherence_message_changed', 'an answer to the version Member A saw before is adherence_message_changed');
reset role;
select pg_temp.as_member(2);
select results_eq($$ select eligible_count, answered_count from public.adherence_message_status() $$,
  $$ values (3, 0) $$, 'after asking again nobody has answered the current version');
reset role;

-- ==================== 11. Off and on again ====================

select pg_temp.as_member(2);
select results_eq(
  $$ select title, body, link_url, link_label, version
       from public.set_adherence_message('', '', 'https://forms.example.org/ag', 'Deschide formularul', false) $$,
  $$ values (null::text, null::text, 'https://forms.example.org/ag'::text, 'Deschide formularul'::text, 2) $$,
  'turning the message off clears the heading and body and keeps the link and the version');
select throws_ok($$ select public.set_adherence_message(null, null, 'https://forms.example.org/ag', 'Deschide formularul', true) $$,
  'PT409', 'nothing_to_update', 'asking again while it is off changes nothing');
select results_eq($$ select eligible_count, answered_count from public.adherence_message_status() $$,
  $$ values (3, 0) $$, 'while it is off nobody counts as having answered');
reset role;
select pg_temp.as_member(4);
select is((select count(*) from public.my_adherence_message()), 0::bigint,
  'while it is off Member A receives nothing -- no window, nothing on Profil');
select throws_ok($$ select public.answer_adherence_message(2) $$,
  'PT404', 'adherence_message_not_found', 'and there is nothing to answer');
reset role;

select pg_temp.as_member(1);
select results_eq(
  $$ select version, updated_by
       from public.set_adherence_message('Din nou', 'Un mesaj nou.', 'https://forms.example.org/ag', 'Deschide formularul', false) $$,
  format($$ values (3, %L::uuid) $$, pg_temp.u(1)),
  'the Moderator turns it on again: a message from none always moves the version');
reset role;

-- ==================== 12. The rule follows the Profile ====================

select pg_temp.test_clear_jwt();
update public.profiles set university = 'Universitatea Tehnică din Cluj-Napoca' where id = pg_temp.u(5);
select pg_temp.as_member(5);
select is((select count(*) from public.my_adherence_message()), 0::bigint,
  'Member B, whose Universitate BC changes away from UBB, stops receiving it');
reset role;

select pg_temp.as_member(2);
select lives_ok(format($$ select public.set_member_role(%L, 'activ', 'R66') $$, pg_temp.u(12)),
  'BC promotes a Voluntar at UBB to Voluntar Activ');
reset role;
select is(
  (select body from public.notifications where member_id = pg_temp.u(12) and title = 'Rol actualizat'),
  'Rolul tău în OSUBB este acum Voluntar Activ.',
  'the promotion Notification names only the new Role: no AG sentence and no address, though the message has a link');
select pg_temp.as_member(12);
select results_eq($$ select title, answered from public.my_adherence_message() $$,
  $$ values ('Din nou'::text, false) $$,
  'the newly promoted Voluntar Activ at UBB meets the current message unanswered');
reset role;

-- ==================== 13. Member Deletion (R59) ====================

select is((private.member_deletion_goes(pg_temp.u(4)) ->> 'adherence_message_reads')::int, 1,
  'an answer goes with the account');
select is(private.member_deletion_holds(pg_temp.u(4)) ? 'adherence_message_reads.member_id', false,
  'an answer does not hold the account');
select is((private.member_deletion_holds(pg_temp.u(1)) ->> 'adherence_message.updated_by')::int, 1,
  'the Member who saved the message last holds their account, as every actor column does');

select * from finish();
rollback;
