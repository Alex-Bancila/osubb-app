-- formatted_text_limits.test.sql -- R60 (Formatted Text): the visible-length limits.
--
-- An Announcement body (a Deal's included), a Task description and an Event
-- description are Formatted Text: at most 2000 visible characters (what
-- private.formatted_text_plain leaves) and at most 4000 stored. The visible
-- rule lives in one helper, private.require_formatted_text_length, called by
-- the security-definer Task and Event commands and by the announcements row
-- guard. The three *_length_ck constraints keep only the stored cap, inline:
-- a CHECK runs as the writing role, and formatted_text_plain is revoked from
-- authenticated, so a constraint calling it would refuse every client write.
-- A Cerere's description stays plain: 2000 characters as typed.
--
-- The values: repeat('**a** ', 600) is 3600 stored (3599 once trimmed) and
-- 1199 visible, refused by every 2000-character check before R60;
-- repeat('a', 2001) is 2001 visible; repeat('**a**', 801) is 4005 stored and
-- only 801 visible.
--
-- Personas (prefix 1090): 1 vot, Manager of Dept R60   2 voluntar, its member
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(45);

create function pg_temp.u60(n integer) returns uuid language sql immutable as $$
  select ('10900000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users(id, email)
select pg_temp.u60(n), 'limits.' || n || '.r60@test.local' from generate_series(1, 2) n;
insert into public.profiles(id, full_name, email, role, status)
select pg_temp.u60(n), 'Limite R60 ' || n, 'limits.' || n || '.r60@test.local',
       (case n when 1 then 'vot' else 'voluntar' end)::public.member_role, 'activ'
  from generate_series(1, 2) n;
insert into public.groups(name, category, min_level) values ('Dept R60', 'department', 0);
insert into public.group_members(group_id, member_id, group_role)
select grp.id, pg_temp.u60(row_.n), row_.group_role
  from (values (1, 'manager'), (2, 'member')) as row_(n, group_role)
  cross join public.groups as grp where grp.name = 'Dept R60';

create function pg_temp.dept() returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = 'Dept R60'
$$;
create function pg_temp.fmt() returns text language sql immutable as $$
  select repeat('**a** ', 600)
$$;
-- The first row of that title: a duplicate keeps its source's title.
create function pg_temp.task(p_title text) returns public.tasks language sql stable security definer set search_path = '' as $$
  select * from public.tasks where title = p_title order by id limit 1
$$;
create function pg_temp.event(p_title text) returns public.events language sql stable security definer set search_path = '' as $$
  select * from public.events where title = p_title
$$;
create function pg_temp.ann(p_title text) returns public.announcements language sql stable security definer set search_path = '' as $$
  select * from public.announcements where title = p_title
$$;
create function pg_temp.cerere() returns public.completed_work_requests language sql stable security definer set search_path = '' as $$
  select * from public.completed_work_requests where description = 'Am ajutat la standul R60.'
$$;
-- update_task and preview_task_update share their first eight arguments: the
-- Task as it is, with only the description changed.
create function pg_temp.edit(p_fn text, p_title text, p_description text) returns text
language sql stable security definer set search_path = '' as $$
  select format('select %s(%s, %s, %L, %L, %L::timestamptz, null, %L, %L)', p_fn,
    task.id, task.group_id, task.title, p_description, task.deadline, task.assignment_mode, task.audience)
    from public.tasks as task where task.title = p_title order by task.id limit 1
$$;
-- update_event is a full-state replace: the Event as it is, with only the
-- description changed.
create function pg_temp.edit_event(p_title text, p_description text) returns text
language sql stable security definer set search_path = '' as $$
  select format('select public.update_event(%s, %L, %L, %s, %L::timestamptz, %L::timestamptz, %L, %L::integer, %L, %s, %L::bigint)',
    event.id, event.title, event.type, event.group_id, event.starts_at, event.ends_at, event.location,
    event.capacity, p_description, event.min_level, event.campaign_id)
    from public.events as event where event.title = p_title
$$;
grant execute on function pg_temp.u60(integer), pg_temp.dept(), pg_temp.fmt(), pg_temp.task(text),
  pg_temp.event(text), pg_temp.ann(text), pg_temp.cerere(), pg_temp.edit(text, text, text),
  pg_temp.edit_event(text, text)
  to authenticated, anon;

-- ==================== 1. private.require_formatted_text_length ====================
select lives_ok($$ select private.require_formatted_text_length('description', null) $$,
  'a null value passes: no description is no Formatted Text');
select lives_ok($$ select private.require_formatted_text_length('description', '  ') $$,
  'a blank value passes, left to the caller like require_text_length');
select lives_ok($$ select private.require_formatted_text_length('description', pg_temp.fmt()) $$,
  '3600 stored and 1199 visible characters are within both limits');
select lives_ok($$ select private.require_formatted_text_length('description', repeat('a', 2000)) $$,
  '2000 visible characters meet the visible limit');
select throws_ok($$ select private.require_formatted_text_length('description', repeat('a', 2001)) $$,
  'PT400', 'description_too_long', '2001 visible characters are <field>_too_long');
select lives_ok($$ select private.require_formatted_text_length('body', repeat('**a**', 800)) $$,
  '4000 stored characters meet the stored limit');
select throws_ok($$ select private.require_formatted_text_length('body', repeat('**a**', 801)) $$,
  'PT400', 'body_too_long', '4005 stored characters are <field>_too_long, though only 801 are visible');

-- ==================== 2. The constraints carry the stored cap only ====================
select is(c.convalidated::text || '|' || pg_get_constraintdef(c.oid), e.expected,
          format('%s keeps only the 4000-character stored cap, calls no function, and is validated', e.name))
  from (values
    (1, 'public.announcements'::regclass, 'announcements_body_length_ck',
        'true|CHECK ((char_length(body) <= 4000))'),
    (2, 'public.tasks'::regclass, 'tasks_description_length_ck',
        'true|CHECK (((description IS NULL) OR (char_length(description) <= 4000)))'),
    (3, 'public.events'::regclass, 'events_description_length_ck',
        'true|CHECK (((description IS NULL) OR (char_length(description) <= 4000)))')
  ) as e (ord, tbl, name, expected)
  join pg_constraint as c on c.conrelid = e.tbl and c.conname = e.name
 order by e.ord;

-- ==================== 3. Announcements: the row guard ====================
-- A direct write, as the app makes it: signed in as the Group's Manager.
select pg_temp.test_login_leadership(pg_temp.u60(1));
select lives_ok(format($$insert into public.announcements(title, body, group_id, audience)
  values ('Anunț formatat R60', %L, %s, 'local')$$, pg_temp.fmt(), pg_temp.dept()),
  'a Manager''s Announcement of 3600 stored, 1199 visible characters is accepted');
select throws_ok(format($$insert into public.announcements(title, body, group_id, audience)
  values ('Anunț lung R60', %L, %s, 'local')$$, repeat('a', 2001), pg_temp.dept()),
  '23514', 'body_too_long', 'an Announcement of 2001 visible characters is body_too_long');
select throws_ok(format($$insert into public.announcements(title, body, group_id, audience)
  values ('Anunț stocat R60', %L, %s, 'local')$$, repeat('**a**', 801), pg_temp.dept()),
  '23514', 'body_too_long', 'an Announcement of 4005 stored characters is body_too_long, though only 801 are visible');
select throws_ok(format($$update public.announcements set body = %L where title = 'Anunț formatat R60'$$, repeat('a', 2001)),
  '23514', 'body_too_long', 'the guard judges an update as well');
reset role;
select is(format('%s|%s', char_length((pg_temp.ann('Anunț formatat R60')).body),
                          char_length(private.formatted_text_plain((pg_temp.ann('Anunț formatat R60')).body))),
  '3599|1199', 'the body is stored trimmed: 3599 stored, 1199 visible');

-- ==================== 4. Tasks: create, preview, update, duplicate ====================
select pg_temp.test_login_leadership(pg_temp.u60(1));
select lives_ok(format($$select public.create_task('Task formatat R60', %L, now() + interval '7 days', 'local', 'public',
    p_group_id => %s)$$, pg_temp.fmt(), pg_temp.dept()),
  'create_task accepts 3600 stored, 1199 visible characters');
select throws_ok(format($$select public.create_task('Task lung R60', %L, now() + interval '7 days', 'local', 'public',
    p_group_id => %s)$$, repeat('a', 2001), pg_temp.dept()),
  'PT400', 'description_too_long', 'create_task refuses 2001 visible characters');
select throws_ok(format($$select public.create_task('Task stocat R60', %L, now() + interval '7 days', 'local', 'public',
    p_group_id => %s)$$, repeat('**a**', 801), pg_temp.dept()),
  'PT400', 'description_too_long', 'create_task refuses 4005 stored characters, though only 801 are visible');
select lives_ok(format($$select public.create_task('Task scurt R60', null, now() + interval '7 days', 'local', 'public',
    p_group_id => %s)$$, pg_temp.dept()),
  'a Task without a description, to edit');
select lives_ok(pg_temp.edit('public.preview_task_update', 'Task scurt R60', pg_temp.fmt()),
  'preview_task_update accepts 3600 stored, 1199 visible characters');
select throws_ok(pg_temp.edit('public.preview_task_update', 'Task scurt R60', repeat('a', 2001)),
  'PT400', 'description_too_long', 'preview_task_update refuses 2001 visible characters, like the command');
select lives_ok(pg_temp.edit('public.update_task', 'Task scurt R60', pg_temp.fmt()),
  'update_task accepts 3600 stored, 1199 visible characters');
select throws_ok(pg_temp.edit('public.update_task', 'Task scurt R60', repeat('a', 2001)),
  'PT400', 'description_too_long', 'update_task refuses 2001 visible characters');
select throws_ok(pg_temp.edit('public.update_task', 'Task scurt R60', repeat('**a**', 801)),
  'PT400', 'description_too_long', 'update_task refuses 4005 stored characters, though only 801 are visible');
select lives_ok(format($$select public.duplicate_task(%L, now() + interval '7 days')$$, (pg_temp.task('Task formatat R60')).id),
  'duplicate_task copies a description of 3599 stored, 1199 visible characters');
reset role;
select is(format('%s|%s', char_length((pg_temp.task('Task formatat R60')).description),
                          char_length(private.formatted_text_plain((pg_temp.task('Task formatat R60')).description))),
  '3599|1199', 'create_task stores the description trimmed: 3599 stored, 1199 visible');
select is((pg_temp.task('Task scurt R60')).description, btrim(pg_temp.fmt()),
  'update_task stores the new description');
select is((select description from public.tasks where duplicated_from_task_id = (pg_temp.task('Task formatat R60')).id),
  btrim(pg_temp.fmt()), 'the copy carries the whole description');

-- ==================== 5. Completed work: the direct path and the Cerere ====================
select pg_temp.test_login_leadership(pg_temp.u60(1));
select lives_ok(format($$select public.create_completed_task(%L, %s, 'Lucru formatat R60', %L,
    p_difficulty => 3, p_rating => 4, p_note => 'Bine.')$$, pg_temp.u60(2), pg_temp.dept(), pg_temp.fmt()),
  'create_completed_task accepts 3600 stored, 1199 visible characters');
select throws_ok(format($$select public.create_completed_task(%L, %s, 'Lucru lung R60', %L,
    p_difficulty => 3, p_rating => 4, p_note => 'Bine.')$$, pg_temp.u60(2), pg_temp.dept(), repeat('a', 2001)),
  'PT400', 'description_too_long', 'create_completed_task refuses 2001 visible characters');
reset role;
select pg_temp.test_login_leadership(pg_temp.u60(2));
select throws_ok(format($$select public.create_completed_work_request(%L, %s)$$, pg_temp.fmt(), pg_temp.dept()),
  'PT400', 'description_too_long',
  'a Cerere''s description stays plain: 3599 characters are too long, whatever they show');
select lives_ok(format($$select public.create_completed_work_request('Am ajutat la standul R60.', %s)$$, pg_temp.dept()),
  'member 2 files a Cerere');
reset role;
select pg_temp.test_login_leadership(pg_temp.u60(1));
select throws_ok(format($$select public.approve_completed_work_request(%s, 3, 4, 'Bine.', p_description => %L)$$,
    (pg_temp.cerere()).id, repeat('a', 2001)),
  'PT400', 'description_too_long', 'approve_completed_work_request refuses a new description of 2001 visible characters');
select lives_ok(format($$select public.approve_completed_work_request(%s, 3, 4, 'Bine.', p_description => %L)$$,
    (pg_temp.cerere()).id, pg_temp.fmt()),
  'approve_completed_work_request accepts a new description of 3600 stored, 1199 visible characters');
reset role;
select is((pg_temp.task('Lucru formatat R60')).description, btrim(pg_temp.fmt()),
  'create_completed_task stores the description');
select is((select description from public.tasks where id = (pg_temp.cerere()).task_id), btrim(pg_temp.fmt()),
  'the approved Cerere''s Task carries the decider''s description');

-- ==================== 6. Events: create and update ====================
select pg_temp.test_login_leadership(pg_temp.u60(1));
select lives_ok(format($$select public.create_event('Eveniment formatat R60', 'sedinta', %s, now() + interval '1 day',
    p_description => %L)$$, pg_temp.dept(), pg_temp.fmt()),
  'create_event accepts 3600 stored, 1199 visible characters');
select throws_ok(format($$select public.create_event('Eveniment lung R60', 'sedinta', %s, now() + interval '1 day',
    p_description => %L)$$, pg_temp.dept(), repeat('a', 2001)),
  'PT400', 'description_too_long', 'create_event refuses 2001 visible characters');
select throws_ok(format($$select public.create_event('Eveniment stocat R60', 'sedinta', %s, now() + interval '1 day',
    p_description => %L)$$, pg_temp.dept(), repeat('**a**', 801)),
  'PT400', 'description_too_long', 'create_event refuses 4005 stored characters, though only 801 are visible');
select lives_ok(format($$select public.create_event('Eveniment scurt R60', 'sedinta', %s, now() + interval '1 day')$$,
    pg_temp.dept()),
  'an Event without a description, to edit');
select lives_ok(pg_temp.edit_event('Eveniment scurt R60', pg_temp.fmt()),
  'update_event accepts 3600 stored, 1199 visible characters');
select throws_ok(pg_temp.edit_event('Eveniment scurt R60', repeat('a', 2001)),
  'PT400', 'description_too_long', 'update_event refuses 2001 visible characters');
reset role;
select is(format('%s|%s', char_length((pg_temp.event('Eveniment formatat R60')).description),
                          ((pg_temp.event('Eveniment scurt R60')).description = btrim(pg_temp.fmt()))::text),
  '3599|true', 'both Event commands store the description trimmed');

-- ==================== 7. Which commands measure Formatted Text ====================
select is((select array_agg(p.proname::text order by p.proname) from pg_proc as p
            where p.pronamespace = 'private'::regnamespace
              and p.prosrc like '%require_formatted_text_length(''description''%'),
  array['approve_completed_work_request_impl', 'create_completed_task_impl', 'create_event_impl',
        'create_task_impl', 'duplicate_task_impl', 'preview_task_update_impl',
        'update_event_impl', 'update_task_impl'],
  'every command that writes a Task or Event description measures it as Formatted Text');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc as p
            where p.pronamespace = 'private'::regnamespace
              and p.prosrc like '%require_text_length(''description''%'),
  array['create_completed_work_request_impl'],
  'only a Cerere''s description is still measured as typed');

select * from finish();
rollback;
