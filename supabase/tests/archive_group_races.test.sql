-- #1145: archive_group races create_event, create_task and the Event-move
-- branch of update_event -- the creators now hold the owning Group and judge
-- its status under that lock.
--
-- Audit finding M6 (docs/review/2026-10-30-codebase-audit.md). archive_group
-- holds the target FOR UPDATE and its descendants FOR NO KEY UPDATE, cancels
-- the subtree's future Events, then flips the status; the three creators read
-- the Group unlocked. Their inserts took only the foreign key's KEY SHARE on
-- the Group row: behind FOR UPDATE on the target it waited and then succeeded,
-- and with NO KEY UPDATE on a descendant it did not even wait -- so an Event
-- or a Task could land in a Group being archived in the same instant.
--
-- The harness (pg_temp.test_race) runs session A to completion uncommitted,
-- sends session B, waits until B blocks or finishes, commits A and fetches
-- B's result. A remote error from B propagates out of dblink_get_result, so
-- each race is wrapped in throws_ok and pins B's reason (the
-- campaign_commands precedent); B's PT409 is itself the proof that B
-- serialized behind A, since the only way B can see A's committed status is
-- to have blocked on the lock and re-read. On main every race lets B succeed
-- (no exception, so throws_ok fails), and BC creating an Event in a committed
-- archived Group hears 42501 instead of group_archived.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(16);

-- ==================== Committed fixtures ====================
-- test_race's sessions cannot see this transaction's rows, so the fixtures
-- are committed through a setup connection and removed the same way; both
-- are idempotent so an interrupted run can be retried.
select extensions.dblink_connect('setup_1145', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres', current_database()));
select extensions.dblink_exec('setup_1145', 'set lock_timeout = ''2s''');
select extensions.dblink_exec('setup_1145', $setup$
  delete from public.events where title like 'Race %#1145';
  delete from public.tasks where title like 'Race %#1145';
  delete from public.groups where name like 'Race %#1145';
  delete from auth.users where id = '11450000-0000-0000-0000-000000000001';
  insert into auth.users (id, email) values
    ('11450000-0000-0000-0000-000000000001', 'bc.race.1145@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('11450000-0000-0000-0000-000000000001', 'Race BC 1145', 'bc.race.1145@test.local', 'bc', 'activ');
  -- For each creator: a Group archived while it creates there, and a parent
  -- archived while it creates in the child. The Events to move live in an
  -- active home Group.
  insert into public.groups (name, category) values
    ('Race event target #1145', 'team'), ('Race event parent #1145', 'team'),
    ('Race task target #1145', 'team'),  ('Race task parent #1145', 'team'),
    ('Race move target #1145', 'team'),  ('Race move parent #1145', 'team'),
    ('Race home #1145', 'team');
  insert into public.groups (name, category, parent_id)
  select replace(parent.name, 'parent', 'child'), 'team', parent.id
    from public.groups as parent where parent.name like 'Race % parent #1145';
  insert into public.events (title, type, group_id, starts_at, created_by)
  select 'Race move ' || which || ' #1145', 'sedinta', home.id, now() + interval '2 days',
         '11450000-0000-0000-0000-000000000001'
    from public.groups as home cross join (values ('one'), ('two')) as event(which)
   where home.name = 'Race home #1145';
$setup$);

create temp table f1145 as
select (select id from public.groups where name = 'Race event target #1145') as event_target,
       (select id from public.groups where name = 'Race event parent #1145') as event_parent,
       (select id from public.groups where name = 'Race event child #1145') as event_child,
       (select id from public.groups where name = 'Race task target #1145') as task_target,
       (select id from public.groups where name = 'Race task parent #1145') as task_parent,
       (select id from public.groups where name = 'Race task child #1145') as task_child,
       (select id from public.groups where name = 'Race move target #1145') as move_target,
       (select id from public.groups where name = 'Race move parent #1145') as move_parent,
       (select id from public.groups where name = 'Race move child #1145') as move_child,
       (select id from public.groups where name = 'Race home #1145') as home,
       (select id from public.events where title = 'Race move one #1145') as event_one,
       (select id from public.events where title = 'Race move two #1145') as event_two;
grant select on f1145 to authenticated;

-- The race statements, each returning one text cell. A archives; B creates.
create function pg_temp.archive_sql(p_group_id bigint) returns text language sql as $$
  select format('select (public.archive_group(%s)).status', p_group_id)
$$;
create function pg_temp.create_event_sql(p_group_id bigint, p_title text) returns text language sql as $$
  select format('select (public.create_event(%L, %L, %s, now() + interval ''1 day'')).title', p_title, 'sedinta', p_group_id)
$$;
create function pg_temp.create_task_sql(p_group_id bigint, p_title text) returns text language sql as $$
  select format('select (public.create_task(%L, null, now() + interval ''7 days'', %L, %L, null, null, null, %L, %s)).title',
    p_title, 'local', 'direct', 'task', p_group_id)
$$;
create function pg_temp.move_event_sql(p_event_id bigint, p_group_id bigint, p_title text) returns text language sql as $$
  select format('select (public.update_event(%s, %L, %L, %s, now() + interval ''2 days'', null, null, null, null, 0, null, false)).title',
    p_event_id, p_title, 'sedinta', p_group_id)
$$;

select pg_temp.test_login('11450000-0000-0000-0000-000000000001',
  '{"member_role":"bc","member_level":6}'::jsonb);
reset role;

-- ==================== 1. create_event against the archive ====================
select throws_ok(format($r$ select * from pg_temp.test_race(%L, %L) $r$,
    pg_temp.archive_sql((select event_target from f1145)),
    pg_temp.create_event_sql((select event_target from f1145), 'Race event new #1145')),
  'PT409', 'group_archived',
  'create_event in the Group being archived waits for the archive and then hears group_archived');
select throws_ok(format($r$ select * from pg_temp.test_race(%L, %L) $r$,
    pg_temp.archive_sql((select event_parent from f1145)),
    pg_temp.create_event_sql((select event_child from f1145), 'Race event new child #1145')),
  'PT409', 'group_archived',
  'and so does create_event in a Child Group whose parent is being archived -- the descendant lock (NO KEY UPDATE) now conflicts');
select is((select count(*) from public.events where title like 'Race event new%#1145'), 0::bigint,
  'no Event landed in either archived Group');

-- ==================== 2. create_task against the archive ====================
select throws_ok(format($r$ select * from pg_temp.test_race(%L, %L) $r$,
    pg_temp.archive_sql((select task_target from f1145)),
    pg_temp.create_task_sql((select task_target from f1145), 'Race task new #1145')),
  'PT409', 'group_archived',
  'create_task in the Group being archived waits for the archive and then hears group_archived');
select throws_ok(format($r$ select * from pg_temp.test_race(%L, %L) $r$,
    pg_temp.archive_sql((select task_parent from f1145)),
    pg_temp.create_task_sql((select task_child from f1145), 'Race task new child #1145')),
  'PT409', 'group_archived',
  'and so does create_task in a Child Group whose parent is being archived');
select is((select count(*) from public.tasks where title like 'Race task new%#1145'), 0::bigint,
  'no Task landed in either archived Group -- archive_group''s "no open work" invariant holds after it commits');

-- ==================== 3. update_event's move against the archive ====================
select throws_ok(format($r$ select * from pg_temp.test_race(%L, %L) $r$,
    pg_temp.archive_sql((select move_target from f1145)),
    pg_temp.move_event_sql((select event_one from f1145), (select move_target from f1145), 'Race move one #1145')),
  'PT409', 'group_archived',
  'moving an Event into the Group being archived waits for the archive and then hears group_archived');
select throws_ok(format($r$ select * from pg_temp.test_race(%L, %L) $r$,
    pg_temp.archive_sql((select move_parent from f1145)),
    pg_temp.move_event_sql((select event_two from f1145), (select move_child from f1145), 'Race move two #1145')),
  'PT409', 'group_archived',
  'and so does a move into a Child Group whose parent is being archived');
select is((select count(*) from public.events as event
            where event.title like 'Race move %#1145' and event.group_id = (select home from f1145)), 2::bigint,
  'both Events stayed in their home Group');

-- ==================== 4. The committed state: the same reasons without a race ====================
-- Every target is archived now. BC, who passes every authority rule, hears
-- the creators' one reason; create_event answered 42501 before #1145.
select pg_temp.test_login('11450000-0000-0000-0000-000000000001',
  '{"member_role":"bc","member_level":6}'::jsonb);
select throws_ok(pg_temp.create_event_sql((select event_target from f1145), 'Race event late #1145'),
  'PT409', 'group_archived',
  'BC creating an Event in a committed archived Group hears group_archived, the reason the other creators give');
select throws_ok(pg_temp.create_task_sql((select task_child from f1145), 'Race task late #1145'),
  'PT409', 'group_archived',
  'and the same from create_task (#1127), now judged on the locked row');
select throws_ok(pg_temp.move_event_sql((select event_one from f1145), (select move_target from f1145), 'Race move one #1145'),
  'PT409', 'group_archived',
  'and from a move into a committed archived Group');
select throws_ok(format('select (public.create_event(%L, %L, %s, now() + interval ''1 day'')).title',
    'Race event nowhere #1145', 'sedinta', 0),
  '42501', 'calendar_manage_forbidden',
  'an unknown Group is still "you may not" for create_event, never "no such Group"');
select throws_ok(pg_temp.move_event_sql((select event_two from f1145), 0, 'Race move two #1145'),
  '42501', 'calendar_manage_forbidden',
  'and for a move');
reset role;

-- An edit that keeps the Event in its own, active Group is applied as before.
-- It runs and commits through the setup session, as BC: a row this
-- transaction had edited would hold a lock the cleanup below, from that other
-- session, could not get past.
select extensions.dblink_exec('setup_1145', 'begin');
select * from extensions.dblink('setup_1145', $$select set_config('request.jwt.claims',
  '{"sub":"11450000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{"member_role":"bc","member_level":6}}', true)$$) as claims(setting text);
select extensions.dblink_exec('setup_1145', 'set local role authenticated');
select is((select edited from extensions.dblink('setup_1145',
    pg_temp.move_event_sql((select event_one from f1145), (select home from f1145), 'Race move one, edited #1145')) as remote(edited text)),
  'Race move one, edited #1145',
  'an edit that keeps the Event in its own, active Group is applied as before');
select extensions.dblink_exec('setup_1145', 'commit');
select is((select event.group_id from public.events as event where event.title = 'Race move one, edited #1145'),
  (select home from f1145),
  'and the Event stayed where it was');

-- ==================== Cleanup ====================
select extensions.dblink_exec('setup_1145', $cleanup$
  delete from public.events where title like 'Race %#1145';
  delete from public.tasks where title like 'Race %#1145';
  delete from public.groups where name like 'Race %#1145';
  delete from auth.users where id = '11450000-0000-0000-0000-000000000001';
$cleanup$);
select extensions.dblink_disconnect('setup_1145');

select * from finish();
rollback;
