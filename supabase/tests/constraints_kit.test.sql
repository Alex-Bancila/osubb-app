-- #673: the constraints kit, server side (ruling R8).
--
-- Covers the parts no command suite owns: the two pure helpers
-- (private.normalize_phone, private.is_http_url), the step-1 length helper
-- (private.require_text_length), the two row guards on the tables the app
-- writes directly (announcements_guard_text, profiles_normalize_phone), and
-- every check constraint the kit adds -- validated by the second migration
-- (section 5), and refusing a direct write while still NOT VALID, which is
-- the state between the two migrations (section 6). The command-side reasons
-- are asserted in the suite that owns each command.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(106);

-- ==================== 1. private.normalize_phone ====================
select is(private.normalize_phone(input), expected,
          format('normalize_phone(%L) = %L', input, expected))
  from (values
    ('+40 0730655145',      '+40730655145'),
    ('0730655145',          '+40730655145'),
    ('+40730655145',        '+40730655145'),
    ('730655145',           '+40730655145'),
    ('0040 730 655 145',    '+40730655145'),
    ('(0730) 655-145',      '+40730655145'),
    ('0730.655.145',        '+40730655145'),
    ('+373 069123456',      '+37369123456'),
    ('+37369123456',        '+37369123456'),
    ('0044 20 7946 0958',   '+442079460958'),
    ('+1 202 555 0143',     '+12025550143'),
    ('+40 123456789',       null),
    ('+40 73065514',        null),
    ('+40 7306551456',      null),
    ('+373 6912345',        null),
    ('+1234567',            null),
    ('+1234567890123456',   null),
    ('+0123456789',         null),
    ('0730 abc 145',        null),
    ('   ',                 null),
    (null,                  null)
  ) as cases (input, expected);

-- ==================== 2. private.is_http_url ====================
select is(private.is_http_url(input), expected, format('is_http_url(%s) = %s', label, expected))
  from (values
    ('https://osubb.ro/formular',                  'https',             true),
    ('  http://osubb.ro  ',                        'trimmed http',      true),
    ('https://' || repeat('a', 2040),              '2048 characters',   true),
    ('https://' || repeat('a', 2041),              '2049 characters',   false),
    ('ftp://osubb.ro',                             'ftp',               false),
    ('osubb.ro',                                   'no scheme',         false),
    (null,                                         'null',              false)
  ) as cases (input, label, expected);

-- ==================== 3. private.require_text_length ====================
select lives_ok($$ select private.require_text_length('title', 'abc', 3, 120) $$,
  'three characters meet a minimum of three');
select throws_ok($$ select private.require_text_length('title', 'ab', 3, 120) $$,
  'PT400', 'title_too_short', 'two characters are <field>_too_short');
select lives_ok($$ select private.require_text_length('title', repeat('t', 120), 3, 120) $$,
  '120 characters meet a maximum of 120');
select throws_ok($$ select private.require_text_length('title', repeat('t', 121), 3, 120) $$,
  'PT400', 'title_too_long', '121 characters are <field>_too_long');
select throws_ok($$ select private.require_text_length('note', repeat('n', 1001), null, 1000) $$,
  'PT400', 'note_too_long', 'the field name is the reason prefix');
select lives_ok($$ select private.require_text_length('title', '   ', 3, 120) $$,
  'a blank value is left to the caller''s *_required reason, never *_too_short');
select lives_ok($$ select private.require_text_length('title', null, 3, 120) $$,
  'a null value is left to the caller as well');
select is((select array_agg(proname order by proname) from pg_proc
            where pronamespace = 'private'::regnamespace
              and proname in ('require_text_length', 'is_http_url', 'normalize_phone',
                              'guard_announcement_text', 'normalize_profile_phone')
              and (has_function_privilege('authenticated', oid, 'execute')
                   or has_function_privilege('anon', oid, 'execute')
                   or has_function_privilege('service_role', oid, 'execute'))),
  null, 'none of the kit''s five private functions is executable by a client role');

-- ==================== 4. The two row guards ====================
-- announcements_guard_text, exercised as the owner so only the guard and the
-- constraints speak (RLS is announcements.test.sql's and rls_announcements').
create temp table g673 as select id from public.groups where name = 'Educațional';
create function pg_temp.announce(p_title text, p_body text, p_label text default null, p_url text default null)
returns void language sql as $$
  insert into public.announcements (title, body, group_id, audience, form_label, form_url)
  select p_title, p_body, id, 'local', p_label, p_url from g673;
$$;

select throws_ok($$ select pg_temp.announce(E' \t ', 'Corp') $$, '23514', 'title_required',
  'a whitespace-only title is title_required, not title_too_short');
select throws_ok($$ select pg_temp.announce('  ab  ', 'Corp') $$, '23514', 'title_too_short',
  'the title is trimmed before it is measured');
select throws_ok($$ select pg_temp.announce(repeat('t', 121), 'Corp') $$, '23514', 'title_too_long',
  'a title over 120 characters is title_too_long');
select throws_ok($$ select pg_temp.announce('Titlu #673', '   ') $$, '23514', 'body_required',
  'a whitespace-only body is body_required');
select throws_ok($$ select pg_temp.announce('Titlu #673', repeat('b', 2001)) $$, '23514', 'body_too_long',
  'a body over 2000 characters is body_too_long');
select throws_ok($$ select pg_temp.announce('Titlu #673', 'Corp', repeat('l', 61), 'https://osubb.ro') $$,
  '23514', 'link_label_too_long', 'a link label over 60 characters is link_label_too_long');
select throws_ok($$ select pg_temp.announce('Titlu #673', 'Corp', 'Formular', 'osubb.ro/formular') $$,
  '23514', 'link_url_invalid', 'a link address without http(s) is link_url_invalid');
select throws_ok($$ select pg_temp.announce('Titlu #673', 'Corp', 'Formular', 'https://' || repeat('a', 2041)) $$,
  '23514', 'link_url_too_long', 'a link address over 2048 characters is link_url_too_long');

select lives_ok($$ select pg_temp.announce(E'  Titlu limită #673\n', repeat('b', 2000) || '   ',
                                           '  ' || repeat('l', 60) || '  ', '  https://osubb.ro/f  ') $$,
  'values at every limit, once trimmed, are accepted');
select is((select format('%s|%s|%s|%s', title, char_length(body), char_length(form_label), form_url)
             from public.announcements where title = 'Titlu limită #673'),
  'Titlu limită #673|2000|60|https://osubb.ro/f',
  'title, body, link label and address are stored trimmed');
select lives_ok($$ select pg_temp.announce('Fără link #673', 'Corp', '   ', '   ') $$,
  'a blank link label and address become no link at all');
select is((select num_nulls(form_label, form_url) from public.announcements where title = 'Fără link #673'),
  2, 'both are stored null');
select throws_ok($$ update public.announcements set title = 'ab' where title = 'Fără link #673' $$,
  '23514', 'title_too_short', 'the guard judges an update as well as an insert');

-- profiles_normalize_phone.
insert into auth.users (id, email) values ('67300000-0000-0000-0000-0000000000a1', 'phone.673@test.local');
insert into public.profiles (id, full_name, email, phone, role, status)
values ('67300000-0000-0000-0000-0000000000a1', 'Telefon 673', 'phone.673@test.local', '+40 0730655145', 'voluntar', 'activ');
select is((select phone from public.profiles where id = '67300000-0000-0000-0000-0000000000a1'),
  '+40730655145', 'an insert stores the phone in E.164');
update public.profiles set phone = '0044 20 7946 0958' where id = '67300000-0000-0000-0000-0000000000a1';
select is((select phone from public.profiles where id = '67300000-0000-0000-0000-0000000000a1'),
  '+442079460958', 'an update stores the phone in E.164');
update public.profiles set phone = '+373 069123456' where id = '67300000-0000-0000-0000-0000000000a1';
select is((select phone from public.profiles where id = '67300000-0000-0000-0000-0000000000a1'),
  '+37369123456', 'a Moldovan number drops its trunk 0');
select throws_ok($$ update public.profiles set phone = '+40 123456789'
                    where id = '67300000-0000-0000-0000-0000000000a1' $$,
  '23514', 'phone_invalid', 'a number the normaliser cannot read is phone_invalid');
update public.profiles set phone = E' \t ' where id = '67300000-0000-0000-0000-0000000000a1';
select is((select phone from public.profiles where id = '67300000-0000-0000-0000-0000000000a1'),
  null, 'a blank phone is stored null');

-- ==================== 5. The second migration validated every constraint ====================
create temp table k673 (ord int, tbl regclass, conname text);
insert into k673 values
  ( 1, 'public.tasks',                   'tasks_title_length_ck'),
  ( 2, 'public.tasks',                   'tasks_description_length_ck'),
  ( 3, 'public.events',                  'events_title_length_ck'),
  ( 4, 'public.events',                  'events_description_length_ck'),
  ( 5, 'public.events',                  'events_capacity_range_ck'),
  ( 6, 'public.campaigns',               'campaigns_name_length_ck'),
  ( 7, 'public.groups',                  'groups_name_length_ck'),
  ( 8, 'public.announcements',           'announcements_title_length_ck'),
  ( 9, 'public.announcements',           'announcements_body_length_ck'),
  (10, 'public.announcements',           'announcements_form_link_ck'),
  (11, 'public.task_activity',           'task_activity_note_length_ck'),
  (12, 'public.task_assignments',        'task_assignments_end_note_length_ck'),
  (13, 'public.task_evaluations',        'task_evaluations_note_length_ck'),
  (14, 'public.task_evaluations',        'task_evaluations_reversal_reason_length_ck'),
  (15, 'public.tasks',                   'tasks_cancel_reason_length_ck'),
  (16, 'public.completed_work_requests', 'completed_work_requests_decision_note_length_ck'),
  (17, 'public.completed_work_requests', 'completed_work_requests_description_length_ck');

select is((select c.convalidated from pg_constraint c where c.conrelid = k.tbl and c.conname = k.conname),
          true, format('%s is validated (constraints_kit_validate ran)', k.conname))
  from k673 k order by k.ord;

select is((select count(*) from pg_constraint
            where conrelid = 'public.events'::regclass and conname = 'events_capacity_positive_ck'),
  0::bigint, 'events_capacity_range_ck replaced events_capacity_positive_ck');

-- ==================== 6. Refused while NOT VALID (between the two migrations) ====================
-- Each constraint is put back exactly as migration A left it -- its live
-- definition, NOT VALID -- and a direct write that breaks it must still be
-- refused, naming it: Postgres never skips a NOT VALID constraint on write.
-- User triggers are disabled so the constraint alone answers (the row guard
-- and the append-only / evaluation guards would otherwise speak first).
alter table public.tasks disable trigger user;
alter table public.events disable trigger user;
alter table public.campaigns disable trigger user;
alter table public.groups disable trigger user;
alter table public.announcements disable trigger user;
alter table public.task_activity disable trigger user;
alter table public.task_assignments disable trigger user;
alter table public.task_evaluations disable trigger user;
alter table public.completed_work_requests disable trigger user;

create function pg_temp.as_not_valid(p_tbl regclass, p_conname text) returns boolean language plpgsql as $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into strict v_def
    from pg_constraint where conrelid = p_tbl and conname = p_conname;
  execute format('alter table %s drop constraint %I', p_tbl, p_conname);
  execute format('alter table %s add constraint %I %s not valid', p_tbl, p_conname, v_def);
  return (select convalidated from pg_constraint where conrelid = p_tbl and conname = p_conname);
end;
$$;

create function pg_temp.violation(p_table text, p_conname text) returns text language sql immutable as $$
  select format('new row for relation "%s" violates check constraint "%s"', p_table, p_conname);
$$;

select is(pg_temp.as_not_valid(k.tbl, k.conname), false, format('%s is back to NOT VALID', k.conname))
  from k673 k order by k.ord;

select throws_ok($$ update public.tasks set title = 'ab' where id = (select min(id) from public.tasks) $$,
  '23514', pg_temp.violation('tasks', 'tasks_title_length_ck'), 'NOT VALID tasks_title_length_ck refuses a two-character title');
select throws_ok($$ update public.tasks set description = repeat('d', 2001) where id = (select min(id) from public.tasks) $$,
  '23514', pg_temp.violation('tasks', 'tasks_description_length_ck'), 'NOT VALID tasks_description_length_ck refuses 2001 characters');
select throws_ok($$ update public.events set title = 'ab' where id = (select min(id) from public.events) $$,
  '23514', pg_temp.violation('events', 'events_title_length_ck'), 'NOT VALID events_title_length_ck refuses a two-character title');
select throws_ok($$ update public.events set description = repeat('d', 2001) where id = (select min(id) from public.events) $$,
  '23514', pg_temp.violation('events', 'events_description_length_ck'), 'NOT VALID events_description_length_ck refuses 2001 characters');
select throws_ok($$ update public.events set capacity = 1001 where id = (select min(id) from public.events) $$,
  '23514', pg_temp.violation('events', 'events_capacity_range_ck'), 'NOT VALID events_capacity_range_ck refuses a capacity of 1001');
select throws_ok($$ update public.campaigns set name = 'ab' where id = (select min(id) from public.campaigns) $$,
  '23514', pg_temp.violation('campaigns', 'campaigns_name_length_ck'), 'NOT VALID campaigns_name_length_ck refuses a two-character name');
select throws_ok($$ update public.groups set name = 'ab' where id = (select min(id) from public.groups) $$,
  '23514', pg_temp.violation('groups', 'groups_name_length_ck'), 'NOT VALID groups_name_length_ck refuses a two-character name');
select throws_ok($$ update public.announcements set title = 'ab' where id = (select min(id) from public.announcements) $$,
  '23514', pg_temp.violation('announcements', 'announcements_title_length_ck'), 'NOT VALID announcements_title_length_ck refuses a two-character title');
select throws_ok($$ update public.announcements set body = repeat('b', 2001) where id = (select min(id) from public.announcements) $$,
  '23514', pg_temp.violation('announcements', 'announcements_body_length_ck'), 'NOT VALID announcements_body_length_ck refuses 2001 characters');
select throws_ok($$ update public.announcements set form_label = 'Formular', form_url = 'ftp://osubb.ro'
                    where id = (select min(id) from public.announcements) $$,
  '23514', pg_temp.violation('announcements', 'announcements_form_link_ck'), 'NOT VALID announcements_form_link_ck refuses a non-http(s) address');
select throws_ok($$ update public.task_activity set note = repeat('n', 1001) where id = (select min(id) from public.task_activity) $$,
  '23514', pg_temp.violation('task_activity', 'task_activity_note_length_ck'), 'NOT VALID task_activity_note_length_ck refuses 1001 characters');
select throws_ok($$ update public.task_assignments set end_note = repeat('n', 1001)
                    where id = (select min(id) from public.task_assignments where ended_at is not null) $$,
  '23514', pg_temp.violation('task_assignments', 'task_assignments_end_note_length_ck'), 'NOT VALID task_assignments_end_note_length_ck refuses 1001 characters');
select throws_ok($$ update public.task_evaluations set note = repeat('n', 1001) where id = (select min(id) from public.task_evaluations) $$,
  '23514', pg_temp.violation('task_evaluations', 'task_evaluations_note_length_ck'), 'NOT VALID task_evaluations_note_length_ck refuses 1001 characters');
select throws_ok($$ update public.task_evaluations
                       set reversed_at = evaluated_at, reversed_by = evaluated_by, reversal_reason = repeat('r', 1001)
                     where id = (select min(id) from public.task_evaluations where evaluated_by is not null) $$,
  '23514', pg_temp.violation('task_evaluations', 'task_evaluations_reversal_reason_length_ck'), 'NOT VALID task_evaluations_reversal_reason_length_ck refuses 1001 characters');
select throws_ok($$ update public.tasks set cancel_reason = repeat('r', 1001)
                    where id = (select min(id) from public.tasks where status = 'cancelled') $$,
  '23514', pg_temp.violation('tasks', 'tasks_cancel_reason_length_ck'), 'NOT VALID tasks_cancel_reason_length_ck refuses 1001 characters');
select throws_ok($$ update public.completed_work_requests set decision_note = repeat('n', 1001)
                    where id = (select min(id) from public.completed_work_requests where status = 'rejected') $$,
  '23514', pg_temp.violation('completed_work_requests', 'completed_work_requests_decision_note_length_ck'), 'NOT VALID completed_work_requests_decision_note_length_ck refuses 1001 characters');
select throws_ok($$ update public.completed_work_requests set description = repeat('d', 2001)
                    where id = (select min(id) from public.completed_work_requests) $$,
  '23514', pg_temp.violation('completed_work_requests', 'completed_work_requests_description_length_ck'), 'NOT VALID completed_work_requests_description_length_ck refuses 2001 characters');

select * from finish();
rollback;
