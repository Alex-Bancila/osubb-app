-- live_changes.test.sql — #961: every domain change broadcasts one
-- cache-invalidation signal on the private Realtime topic org:changes.
-- Runs in one transaction and rolls back — leaves no residue in the local db.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- Tables that carry no signal on purpose: the member-filtered notifications
-- channel (#604), and self-only settings or machinery nobody watches live.
create function pg_temp.excluded_tables() returns text[] language sql as $$
  select array['notifications', 'push_tokens', 'push_deliveries',
               'notification_push_preferences', 'notification_email_preferences',
               -- R43: Grupuri preferate, a self-only setting like the two above.
               'member_group_unselected',
               'notif_suppression',
               -- #991: the volunteer import's record; the grid refetches
               -- after each import call it makes.
               'member_imports'];
$$;

create function pg_temp.broadcasting_tables() returns text[] language sql as $$
  select coalesce(array_agg(c.relname order by c.relname), '{}')
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and t.tgname = 'broadcast_change' and not t.tgisinternal;
$$;

-- Every table in public either broadcasts or is excluded by name: a new
-- table fails here until someone decides.
create function pg_temp.undecided_tables() returns text[] language sql as $$
  select coalesce(array_agg(c.relname order by c.relname), '{}')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and c.relname <> all (pg_temp.excluded_tables())
     and c.relname <> all (pg_temp.broadcasting_tables());
$$;

select has_function('private', 'broadcast_change', 'private.broadcast_change() exists');

select is(pg_temp.undecided_tables(), '{}'::text[],
  'every public table broadcasts its changes or is excluded on purpose (#961)');

select is(
  (select coalesce(array_agg(t order by t), '{}')
     from unnest(pg_temp.broadcasting_tables()) as t
    where t = any (pg_temp.excluded_tables())),
  '{}'::text[],
  'no excluded table carries the broadcast trigger');

-- ==================== one statement, one signal ====================
create temp table before_count as
  select count(*) as n from realtime.messages
   where topic = 'org:changes';

-- A statement-level trigger fires once however many rows the statement
-- touches (two here), and the payload names the table, never a row.
update public.roles set name = name where id in ('bc', 'bce');

select is(
  (select count(*) from realtime.messages where topic = 'org:changes')
    - (select n from before_count),
  1::bigint,
  'a statement touching two rows writes exactly one signal');

select is(
  (select payload - 'id'
     from realtime.messages
    where topic = 'org:changes'
    order by inserted_at desc limit 1),
  '{"table": "roles", "op": "UPDATE"}'::jsonb,
  'the signal carries the table name and the operation, nothing else');

select is(
  (select array[event, extension, private::text]
     from realtime.messages
    where topic = 'org:changes'
    order by inserted_at desc limit 1),
  array['change', 'broadcast', 'true'],
  'the signal is a private broadcast event named change');

-- ==================== who may receive ====================
select ok(exists (
  select 1 from pg_policies
   where schemaname = 'realtime' and tablename = 'messages'
     and policyname = 'org_changes_receive' and cmd = 'SELECT'
), 'realtime.messages has the org_changes_receive select policy');

select pg_temp.test_login('a0961000-0000-0000-0000-000000000001',
  '{"member_role":"voluntar","member_level":1,"group_ids":[]}'::jsonb);
select set_config('realtime.topic', 'org:changes', true);
select cmp_ok(
  (select count(*) from realtime.messages where topic = 'org:changes'),
  '>=', 1::bigint,
  'a Member may read the org:changes signals (the join succeeds)');

-- Nobody but the trigger writes signals: realtime.messages has no insert
-- policy, so a client's realtime.send() is swallowed by its own exception
-- block and a direct insert is refused. A future insert policy fails here.
create temp table member_count as
  select count(*) as n from realtime.messages where topic = 'org:changes';
select realtime.send('{"table":"tasks","op":"FORGED"}'::jsonb, 'change', 'org:changes', true);
select is(
  (select count(*) from realtime.messages where topic = 'org:changes')
    - (select n from member_count),
  0::bigint,
  'a Member calling realtime.send() writes no signal');
select throws_ok(
  $$ insert into realtime.messages (topic, extension, payload, event, private)
     values ('org:changes', 'broadcast', '{}'::jsonb, 'change', true) $$,
  '42501',
  null,
  'a Member cannot insert a signal directly');

select pg_temp.test_login('a0961000-0000-0000-0000-000000000002', '{}'::jsonb);
select set_config('realtime.topic', 'org:changes', true);
select is(
  (select count(*) from realtime.messages where topic = 'org:changes'),
  0::bigint,
  'a signed-in account without Organization Claims reads nothing');

select pg_temp.test_clear_jwt();
select set_config('role', 'anon', true);
select set_config('realtime.topic', 'org:changes', true);
select is(
  (select count(*) from realtime.messages where topic = 'org:changes'),
  0::bigint,
  'anon reads nothing');

select * from finish();
rollback;
