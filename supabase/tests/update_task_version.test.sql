-- #1132: update_task and preview_task_update refuse a stale edit -- the form
-- sends back the tasks.updated_at it was seeded from.
--
-- Audit finding M12 (docs/review/2026-10-30-codebase-audit.md): the edit form
-- is a full-state replace, and while it is open the details query is refetched
-- by live changes, so a save from a form opened before someone else's edit put
-- every field back to what the first Manager saw. The command had no version
-- argument -- and public.tasks carried no updated_at at all (the finding's
-- note that it existed was wrong; no migration ever added one). This issue
-- adds the column, stamped by the shared private.set_updated_at trigger
-- (conventions section 7), and p_updated_at on both commands: under the Task
-- lock (the preview against the row it reads) a p_updated_at distinct from
-- tasks.updated_at is PT409 task_changed, judged right after authority and
-- before every other state rule, so a stale form hears that first; null skips
-- the check (the smoke script, and installed clients from before this
-- release, which send no version).
--
-- Everything below fails on main: there is no column, no trigger, and neither
-- command takes a version.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- ==================== 1. The column, its trigger, the signatures ====================
select has_column('public', 'tasks', 'updated_at',
  'tasks carry updated_at -- the row version the edit form sends back');
select col_not_null('public', 'tasks', 'updated_at',
  'updated_at is never null');
select col_has_default('public', 'tasks', 'updated_at',
  'updated_at is stamped on insert without the writer naming it');
select has_trigger('public', 'tasks', 'tasks_set_updated_at',
  'the shared private.set_updated_at trigger stamps every update');
select is(pg_get_function_arguments(
    'public.update_task(bigint,bigint,text,text,timestamptz,bigint,text,text,text,text,boolean,jsonb,integer,timestamptz)'::regprocedure),
  'p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text DEFAULT NULL::text, p_link_url text DEFAULT NULL::text, p_accept_consequences boolean DEFAULT false, p_links jsonb DEFAULT NULL::jsonb, p_min_level integer DEFAULT NULL::integer, p_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone',
  'update_task takes p_updated_at last, defaulting to null -- no version, no check');
select is(pg_get_function_arguments(
    'public.preview_task_update(bigint,bigint,text,text,timestamptz,bigint,text,text,text,text,jsonb,integer,timestamptz)'::regprocedure),
  'p_task_id bigint, p_group_id bigint, p_title text, p_description text, p_deadline timestamp with time zone, p_campaign_id bigint, p_assignment_mode text, p_audience text, p_link_label text DEFAULT NULL::text, p_link_url text DEFAULT NULL::text, p_links jsonb DEFAULT NULL::jsonb, p_min_level integer DEFAULT NULL::integer, p_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone',
  'preview_task_update takes the same p_updated_at, so the preview refuses what the save would');
select hasnt_function('public', 'update_task',
  array['bigint', 'bigint', 'text', 'text', 'timestamp with time zone', 'bigint', 'text', 'text', 'text', 'text', 'boolean', 'jsonb', 'integer'],
  'the old update_task signature is gone -- one overload, so PostgREST never has to choose');
select hasnt_function('public', 'preview_task_update',
  array['bigint', 'bigint', 'text', 'text', 'timestamp with time zone', 'bigint', 'text', 'text', 'text', 'text', 'jsonb', 'integer'],
  'the old preview_task_update signature is gone');

-- ==================== Fixtures ====================
-- 01 the Manager (BCE, Group Manager); 02 a plain member of the Group, who
-- reads the local Task but does not manage it.
insert into auth.users (id, email) values
  ('11320000-0000-0000-0000-000000000001', 'manager.1132@test.local'),
  ('11320000-0000-0000-0000-000000000002', 'membru.1132@test.local');
insert into public.profiles (id, full_name, email, role, status) values
  ('11320000-0000-0000-0000-000000000001', 'Manager 1132', 'manager.1132@test.local', 'bce', 'activ'),
  ('11320000-0000-0000-0000-000000000002', 'Membru 1132', 'membru.1132@test.local', 'voluntar', 'activ');
insert into public.groups (name, category, shared_work_visibility)
values ('Echipa #1132', 'team', true);
insert into public.group_members (group_id, member_id, group_role)
select grp.id, member.id, member.group_role
  from public.groups as grp
  cross join (values
    ('11320000-0000-0000-0000-000000000001'::uuid, 'manager'),
    ('11320000-0000-0000-0000-000000000002'::uuid, 'member')) as member(id, group_role)
 where grp.name = 'Echipa #1132';
insert into public.tasks (title, description, deadline, group_id, audience, assignment_mode, status, created_by)
select 'Versiune #1132', 'Descriere #1132', '2027-03-01 09:00:00+00', grp.id, 'local', 'direct', 'todo',
       '11320000-0000-0000-0000-000000000001'
  from public.groups as grp where grp.name = 'Echipa #1132';

-- v0: the version the form was seeded from.
create temp table f1132 as
select task.id as task_id, task.group_id, task.updated_at as v0
  from public.tasks as task where task.title = 'Versiune #1132';
grant select on f1132 to authenticated;

-- The full-state call with only the title (and the version) varying; the
-- preview flavour counts its consequence rows, so lives_ok/throws_ok can run
-- it the same way.
create function pg_temp.edit_sql(p_title text, p_version timestamptz, p_preview boolean default false)
returns text language sql as $$
  select format('select %s(%s, %s, %L, %L, %L::timestamptz, null, %L, %L, p_updated_at => %s)',
    case when p_preview then 'count(*) from public.preview_task_update' else 'public.update_task' end,
    (select task_id from f1132), (select group_id from f1132),
    p_title, 'Descriere #1132', '2027-03-01 09:00:00+00', 'direct', 'local',
    case when p_version is null then 'null::timestamptz'
         else quote_literal(p_version::text) || '::timestamptz' end)
$$;

-- ==================== 2. A stale version is refused, whole ====================
select pg_temp.test_login_leadership('11320000-0000-0000-0000-000000000001');
select throws_ok(pg_temp.edit_sql('Titlu nou #1132', (select v0 - interval '1 second' from f1132)),
  'PT409', 'task_changed',
  'update_task refuses a form seeded from an older version of the row');
select throws_ok(pg_temp.edit_sql('Titlu nou #1132', (select v0 - interval '1 second' from f1132), true),
  'PT409', 'task_changed',
  'preview_task_update refuses the same stale form -- the Manager hears it before any consequence');
select throws_ok(pg_temp.edit_sql('Versiune #1132', (select v0 - interval '1 second' from f1132)),
  'PT409', 'task_changed',
  'a stale form that changes nothing still hears task_changed, not nothing_to_update -- the version is judged first among the state rules');
reset role;
select is((select task.title from public.tasks as task where task.id = (select task_id from f1132)),
  'Versiune #1132', 'the refused save wrote nothing');

select pg_temp.test_login_leadership('11320000-0000-0000-0000-000000000002');
select throws_ok(pg_temp.edit_sql('Titlu nou #1132', (select v0 - interval '1 second' from f1132)),
  '42501', 'task_manage_forbidden',
  'authority outranks the version: a member who does not manage the Task is refused before task_changed is judged');
reset role;

-- ==================== 3. The current version is applied, and the stamp moves ====================
select pg_temp.test_login_leadership('11320000-0000-0000-0000-000000000001');
select lives_ok(pg_temp.edit_sql('Titlu nou #1132', (select v0 from f1132), true),
  'the preview accepts the current version');
select lives_ok(pg_temp.edit_sql('Titlu nou #1132', (select v0 from f1132)),
  'update_task applies a form seeded from the current version, as today');
reset role;
select is((select task.title from public.tasks as task where task.id = (select task_id from f1132)),
  'Titlu nou #1132', 'the edit landed');
select isnt((select task.updated_at from public.tasks as task where task.id = (select task_id from f1132)),
  (select v0 from f1132),
  'and the save moved the stamp past the version the form sent');

select pg_temp.test_login_leadership('11320000-0000-0000-0000-000000000001');
select throws_ok(pg_temp.edit_sql('Titlu si mai nou #1132', (select v0 from f1132)),
  'PT409', 'task_changed',
  'a second form still seeded from v0 is now stale -- the edit it would put back is refused');
select throws_ok(pg_temp.edit_sql('Titlu si mai nou #1132', (select v0 from f1132), true),
  'PT409', 'task_changed',
  'and its preview says the same');
reset role;
select is((select task.title from public.tasks as task where task.id = (select task_id from f1132)),
  'Titlu nou #1132', 'the first save stands');

-- ==================== 4. No version, no check ====================
select pg_temp.test_login_leadership('11320000-0000-0000-0000-000000000001');
select lives_ok(pg_temp.edit_sql('Fara versiune #1132', null),
  'a caller that sends no version (null, the default) is applied as before -- the smoke script and older installed clients');
select lives_ok(pg_temp.edit_sql('Fara versiune, previzualizat #1132', null, true),
  'and previews as before');
reset role;
select is((select task.title from public.tasks as task where task.id = (select task_id from f1132)),
  'Fara versiune #1132', 'the unversioned edit landed');

-- ==================== 5. Every update moves the version ====================
-- Not only update_task: a status change by any command is a BEFORE UPDATE on
-- the same row, so a form opened before it is stale too.
create temp table f1132_before as
select task.updated_at as stamp from public.tasks as task where task.id = (select task_id from f1132);
update public.tasks set description = 'Alta descriere #1132' where id = (select task_id from f1132);
select isnt((select task.updated_at from public.tasks as task where task.id = (select task_id from f1132)),
  (select stamp from f1132_before),
  'a plain update of the row stamps updated_at -- the trigger, not the command, moves the version');

select * from finish();
rollback;
