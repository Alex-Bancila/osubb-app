-- Ruling R46 (2026-10-07): up to five Attached Links on an Announcement (a Deal
-- included) and on a Task, each a label and an address judged by the one-link
-- rule (private.require_attached_link) through private.require_attached_links.
-- The old single pair (announcements.form_label/form_url, tasks.link_label/
-- link_url) stays one release, backfilled and mirrored from links[0]; an app
-- version from before R46 that writes only the pair has it taken as links[0].
--
-- Mutation proofs: see docs/backend/deals.md and the PR body.
--
-- Personas (prefix 4646): 1 vot, Manager of Dept R46   2 voluntar, its member
--                         3 bce (reads leadership_member_tasks)
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(48);

create function pg_temp.u46(n integer) returns uuid language sql immutable as $$
  select ('46460000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users(id, email)
select pg_temp.u46(n), 'links.' || n || '.r46@test.local' from generate_series(1, 3) n;
insert into public.profiles(id, full_name, email, role, status)
select pg_temp.u46(n), 'Links R46 ' || n, 'links.' || n || '.r46@test.local',
       (case n when 1 then 'vot' when 2 then 'voluntar' else 'bce' end)::public.member_role, 'activ'
  from generate_series(1, 3) n;
insert into public.groups(name, category, min_level) values ('Dept R46', 'department', 0);
insert into public.group_members(group_id, member_id, group_role)
select grp.id, pg_temp.u46(row_.n), row_.group_role
  from (values (1, 'manager'), (2, 'member')) as row_(n, group_role)
  cross join public.groups as grp where grp.name = 'Dept R46';

create function pg_temp.dept() returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = 'Dept R46'
$$;
create function pg_temp.ann(p_title text) returns public.announcements language sql stable security definer set search_path = '' as $$
  select * from public.announcements where title = p_title
$$;
create function pg_temp.task(p_title text) returns public.tasks language sql stable security definer set search_path = '' as $$
  select * from public.tasks where title = p_title
$$;
create function pg_temp.links(p_n integer) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('label', 'Link ' || n, 'url', 'https://example.org/' || n) order by n), '[]')
    from generate_series(1, p_n) n
$$;
grant execute on function pg_temp.u46(integer), pg_temp.dept(), pg_temp.ann(text), pg_temp.task(text), pg_temp.links(integer)
  to authenticated, anon;

-- ==================== The invariant: the pair is links[0] ====================
select is((select count(*) from public.announcements
            where form_label is distinct from links -> 0 ->> 'label'
               or form_url is distinct from links -> 0 ->> 'url')::int, 0,
  'every Announcement''s form_label/form_url is its first Attached Link (backfill and mirror)');
select is((select count(*) from public.tasks
            where link_label is distinct from links -> 0 ->> 'label'
               or link_url is distinct from links -> 0 ->> 'url')::int, 0,
  'every Task''s link_label/link_url is its first Attached Link (backfill and mirror)');
select ok(exists (select 1 from public.announcements where jsonb_array_length(links) > 0 and kind = 'announcement'),
  'the invariant is not vacuous: an Announcement with a link exists');

-- ==================== Announcements: direct writes ====================
select pg_temp.test_login_leadership(pg_temp.u46(1));
select lives_ok(format($$insert into public.announcements(title, body, group_id, audience, links)
  values ('Cinci linkuri R46', 'Corp.', %s, 'local', %L)$$, pg_temp.dept(), pg_temp.links(5)),
  'an Announcement carries five Attached Links');
select throws_ok(format($$insert into public.announcements(title, body, group_id, audience, links)
  values ('Sase linkuri R46', 'Corp.', %s, 'local', %L)$$, pg_temp.dept(), pg_temp.links(6)),
  '23514', 'too_many_links', 'a sixth link is refused');
select throws_ok(format($$insert into public.announcements(title, body, group_id, audience, links)
  values ('Eticheta lunga R46', 'Corp.', %s, 'local', %L)$$, pg_temp.dept(),
  jsonb_build_array(jsonb_build_object('label', repeat('e', 61), 'url', 'https://example.org'))),
  '23514', 'link_label_too_long', 'a label over 60 characters is refused');
select throws_ok(format($$insert into public.announcements(title, body, group_id, audience, links)
  values ('Adresa ftp R46', 'Corp.', %s, 'local', '[{"label": "FTP", "url": "ftp://example.org"}]')$$, pg_temp.dept()),
  '23514', 'link_url_invalid', 'a non-http(s) address is refused');
select throws_ok(format($$insert into public.announcements(title, body, group_id, audience, links)
  values ('Adresa lunga R46', 'Corp.', %s, 'local', %L)$$, pg_temp.dept(),
  jsonb_build_array(jsonb_build_object('label', 'Lung', 'url', 'https://example.org/' || repeat('u', 2030)))),
  '23514', 'link_url_too_long', 'an address over 2048 characters is refused');
select throws_ok(format($$insert into public.announcements(title, body, group_id, audience, links)
  values ('Doar eticheta R46', 'Corp.', %s, 'local', '[{"label": "Doar"}]')$$, pg_temp.dept()),
  '23514', 'link_incomplete', 'a label without an address is refused');
select throws_ok(format($$insert into public.announcements(title, body, group_id, audience, links)
  values ('Nu lista R46', 'Corp.', %s, 'local', '{"label": "A", "url": "https://example.org"}')$$, pg_temp.dept()),
  '23514', 'invalid_links', 'links must be a list');
select throws_ok(format($$insert into public.announcements(title, body, group_id, audience, links)
  values ('Element gresit R46', 'Corp.', %s, 'local', '["https://example.org"]')$$, pg_temp.dept()),
  '23514', 'invalid_links', 'each link must be a {label, url} object');
select lives_ok(format($$insert into public.announcements(title, body, group_id, audience, links)
  values ('Rand gol R46', 'Corp.', %s, 'local',
          '[{"label": "  Formular  ", "url": "  https://example.org/f  ", "extra": 1}, {"label": " ", "url": ""}]')$$, pg_temp.dept()),
  'a wholly blank row is accepted');
reset role;
select is((pg_temp.ann('Rand gol R46')).links, '[{"url": "https://example.org/f", "label": "Formular"}]'::jsonb,
  'links are stored trimmed, a blank row dropped, only label and url kept');
select is(format('%s|%s', (pg_temp.ann('Cinci linkuri R46')).form_label, (pg_temp.ann('Cinci linkuri R46')).form_url),
  'Link 1|https://example.org/1', 'the first of five links is mirrored into form_label / form_url');

-- An app version from before R46 writes only the pair.
select pg_temp.test_login_leadership(pg_temp.u46(1));
select lives_ok(format($$insert into public.announcements(title, body, group_id, audience, form_label, form_url)
  values ('Pereche veche R46', 'Corp.', %s, 'local', ' Formular ', 'https://example.org/vechi')$$, pg_temp.dept()),
  'an old app inserts with form_label / form_url');
reset role;
select is((pg_temp.ann('Pereche veche R46')).links, '[{"url": "https://example.org/vechi", "label": "Formular"}]'::jsonb,
  'the old pair becomes the one Attached Link');
select pg_temp.test_login_leadership(pg_temp.u46(1));
update public.announcements set form_label = 'Primul nou', form_url = 'https://example.org/nou'
 where id = (pg_temp.ann('Cinci linkuri R46')).id;
reset role;
select is((select jsonb_agg(element ->> 'label') from jsonb_array_elements((pg_temp.ann('Cinci linkuri R46')).links) as list(element)),
  '["Primul nou", "Link 2", "Link 3", "Link 4", "Link 5"]'::jsonb,
  'an old app editing the pair replaces the first link and keeps the other four');
select pg_temp.test_login_leadership(pg_temp.u46(1));
update public.announcements set form_label = null, form_url = null
 where id = (pg_temp.ann('Pereche veche R46')).id;
reset role;
select is((pg_temp.ann('Pereche veche R46')).links, '[]'::jsonb, 'an old app clearing the pair clears its one link');
select pg_temp.test_login_leadership(pg_temp.u46(1));
update public.announcements set links = pg_temp.links(2) where id = (pg_temp.ann('Pereche veche R46')).id;
select throws_ok(format($$update public.announcements set links = %L where id = (pg_temp.ann('Pereche veche R46')).id$$, pg_temp.links(6)),
  '23514', 'too_many_links', 'an edit to six links is refused');
update public.announcements set links = '[]' where id = (pg_temp.ann('Cinci linkuri R46')).id;
reset role;
select is(format('%s|%s', (pg_temp.ann('Pereche veche R46')).form_label, (pg_temp.ann('Pereche veche R46')).form_url),
  'Link 1|https://example.org/1', 'a new app writing links moves the mirror with them');
select is(format('%s|%s', (pg_temp.ann('Cinci linkuri R46')).form_label is null, (pg_temp.ann('Cinci linkuri R46')).form_url is null),
  't|t', 'an empty list clears the mirror');

-- ==================== Tasks: create_task ====================
select pg_temp.test_login_leadership(pg_temp.u46(1));
select is(jsonb_array_length((public.create_task('Task cinci R46', null, now() + interval '7 days', 'local', 'direct',
    p_executor_id => pg_temp.u46(2), p_group_id => pg_temp.dept(), p_links => pg_temp.links(5))).links), 5,
  'create_task stores five Attached Links');
select throws_ok(format($$select public.create_task('Task sase R46', null, now() + interval '7 days', 'local', 'public',
    p_group_id => %s, p_links => %L)$$, pg_temp.dept(), pg_temp.links(6)),
  'PT400', 'too_many_links', 'create_task refuses a sixth link at step 1');
select throws_ok(format($$select public.create_task('Task ftp R46', null, now() + interval '7 days', 'local', 'public',
    p_group_id => %s, p_links => '[{"label": "F", "url": "ftp://x"}]')$$, pg_temp.dept()),
  'PT400', 'link_url_invalid', 'create_task judges each link');
select throws_ok(format($$select public.create_task('Task lista R46', null, now() + interval '7 days', 'local', 'public',
    p_group_id => %s, p_links => '"https://example.org"')$$, pg_temp.dept()),
  'PT400', 'invalid_links', 'create_task refuses links that are not a list');
select is((public.create_task('Task pereche R46', null, now() + interval '7 days', 'local', 'public',
    p_group_id => pg_temp.dept(), p_link_label => 'Brief', p_link_url => 'https://example.org/brief')).links,
  '[{"url": "https://example.org/brief", "label": "Brief"}]'::jsonb,
  'an old app''s p_link_label / p_link_url become the one link');
select is((public.create_task('Task ambele R46', null, now() + interval '7 days', 'local', 'public',
    p_group_id => pg_temp.dept(), p_link_label => 'Vechi', p_link_url => 'https://example.org/vechi',
    p_links => pg_temp.links(2))).links, pg_temp.links(2),
  'when both are sent, p_links wins');
reset role;
create temp table t46_cinci as select id from public.tasks where title = 'Task cinci R46';
grant select on t46_cinci to authenticated;
select is(format('%s|%s', (pg_temp.task('Task cinci R46')).link_label, (pg_temp.task('Task cinci R46')).link_url),
  'Link 1|https://example.org/1', 'tasks_mirror_links keeps link_label / link_url on the first link');
select pg_temp.test_clear_jwt();
set local role authenticated;
select throws_ok(format($$select public.create_task('Task claimless R46', null, now() + interval '7 days', 'local', 'public',
    p_group_id => %s, p_links => %L)$$, pg_temp.dept(), pg_temp.links(6)),
  'PT400', 'too_many_links', 'a malformed list is refused before the gate, even claimless');
reset role;

-- ==================== Tasks: update_task / preview_task_update ====================
create function pg_temp.edit(p_title text, p_links jsonb, p_label text default null, p_url text default null) returns text
language sql as $$
  select format('select public.update_task(%s, %s, %L, %L, %L::timestamptz, null, %L, %L, %L, %L, false, %L)',
    task.id, task.group_id, task.title, task.description, task.deadline, task.assignment_mode, task.audience,
    p_label, p_url, p_links)
    from public.tasks as task where task.title = p_title
$$;
grant execute on function pg_temp.edit(text, jsonb, text, text) to authenticated;
select pg_temp.test_login_leadership(pg_temp.u46(1));
select lives_ok(pg_temp.edit('Task pereche R46', pg_temp.links(3)), 'update_task sets three links');
reset role;
select is((select details -> 'changed' from public.task_activity
            where task_id = (pg_temp.task('Task pereche R46')).id and kind = 'task_updated' order by id desc limit 1),
  '["links"]'::jsonb, 'the edit names links in changed');
select is((select format('%s|%s', jsonb_array_length(details -> 'before' -> 'links'), jsonb_array_length(details -> 'after' -> 'links'))
             from public.task_activity
            where task_id = (pg_temp.task('Task pereche R46')).id and kind = 'task_updated' order by id desc limit 1),
  '1|3', 'before and after carry the whole lists, so the history can show them');
select is((pg_temp.task('Task pereche R46')).link_label, 'Link 1', 'the mirror follows the edit');
select pg_temp.test_login_leadership(pg_temp.u46(1));
select throws_ok(pg_temp.edit('Task pereche R46', pg_temp.links(3)), 'PT409', 'nothing_to_update',
  'the same three links are no change');
select throws_ok(replace(replace(pg_temp.edit('Task pereche R46', pg_temp.links(6)), 'public.update_task', '* from public.preview_task_update'), ', false, ', ', '),
  'PT400', 'too_many_links', 'preview_task_update refuses a sixth link like the command');
select lives_ok(pg_temp.edit('Task pereche R46', null, 'Doar una', 'https://example.org/una'),
  'an old app''s update_task sends only the pair (p_links not sent)');
reset role;
select is((select jsonb_agg(element ->> 'label') from jsonb_array_elements((pg_temp.task('Task pereche R46')).links) as list(element)),
  '["Doar una", "Link 2", "Link 3"]'::jsonb,
  'the pair, sent alone, replaces the first link and keeps the two the old app cannot show');
-- An old app changing only the title sends the pair it shows, unchanged.
select pg_temp.test_login_leadership(pg_temp.u46(1));
select lives_ok(replace(pg_temp.edit('Task pereche R46', null, 'Doar una', 'https://example.org/una'),
    quote_literal('Task pereche R46'), quote_literal('Task pereche R46 titlu')),
  'an old app edits only the title');
reset role;
select is(jsonb_array_length((pg_temp.task('Task pereche R46 titlu')).links), 3,
  'a title edit from an old app keeps every Attached Link');
select is((select details -> 'changed' from public.task_activity
            where task_id = (pg_temp.task('Task pereche R46 titlu')).id and kind = 'task_updated' order by id desc limit 1),
  '["title"]'::jsonb, 'and names only the title in changed');
update public.tasks set title = 'Task pereche R46' where title = 'Task pereche R46 titlu';
select pg_temp.test_login_leadership(pg_temp.u46(1));
select lives_ok(pg_temp.edit('Task pereche R46', '[]'::jsonb), 'a sent empty list clears the links');
reset role;
select is(format('%s|%s', (pg_temp.task('Task pereche R46')).links, (pg_temp.task('Task pereche R46')).link_label is null),
  '[]|t', 'no link and no mirror remain');

-- ==================== Tasks: duplicate, leadership read, the mirror ====================
select pg_temp.test_login_leadership(pg_temp.u46(1));
select is((public.duplicate_task((select id from t46_cinci), now() + interval '9 days')).links, pg_temp.links(5),
  'duplicate_task copies all five links');
reset role;
-- An old-pair write that reaches the table directly (none is left in the schema).
update public.tasks set link_label = 'Direct', link_url = 'https://example.org/direct'
 where id = (select id from t46_cinci);
select is((select jsonb_agg(element ->> 'label') from jsonb_array_elements((select links from public.tasks where id = (select id from t46_cinci))) as list(element)),
  '["Direct", "Link 2", "Link 3", "Link 4", "Link 5"]'::jsonb,
  'a pair-only write replaces the first link and keeps the rest');
-- leadership_member_tasks carries the list (the Task was created with its Executor).
select pg_temp.test_login_leadership(pg_temp.u46(3));
select is((select jsonb_array_length(links) from public.leadership_member_tasks(pg_temp.u46(2))
            where task_id = (select id from t46_cinci)), 5,
  'leadership_member_tasks returns the Task''s links');
reset role;
select is(private.task_field_labels(array['links']), 'linkuri', 'the Executor''s edit Notification names the links "linkuri"');

-- ==================== Catalog ====================
select is((select count(*) from pg_proc where proname in ('create_task', 'update_task', 'preview_task_update',
             'create_completed_task', 'approve_completed_work_request') and pronamespace = 'public'::regnamespace)::int, 5,
  'each Task command keeps exactly one signature (no PostgREST overload ambiguity)');
select is((select string_agg(pg_get_function_arguments(oid), '') from pg_proc
            where proname = 'update_task' and pronamespace = 'public'::regnamespace) ~ 'p_links jsonb DEFAULT NULL',
  true, 'update_task''s p_links defaults to null: not sent');

select * from finish();
rollback;
