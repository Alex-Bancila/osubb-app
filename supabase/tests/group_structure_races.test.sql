-- #582: what the Group structure commands hold, and what two of them do to each other.
--
-- Two kinds of proof, as conventions section 8 asks for. A `pgrowlocks` probe
-- reads the exact lock MODE off a live transaction -- the cross-cutting rule
-- for Wave 3 is that a parent (and, for archive, a descendant) is
-- `for no key update`, the target is `for update`, and NO command ever takes a
-- share lock on a `groups` row, because `require_group_work_manager` runs
-- before the command's own `for update` on that same row and a share->update
-- upgrade inside one transaction ABBAs against any command holding a parent
-- first. A two-session `pg_temp.test_race` then shows the consequence: two
-- archives of one Group serialize and the loser is told the Group is already
-- archived, and two Child Groups created under one parent serialize on it.
--
-- The re-parent race the first draft of this file planned is struck with
-- `move_group` itself (ruling R20, ADR-0009 amended 2026-09-20): a Group's
-- parent is chosen at creation and never changes, so there is no second writer
-- of `parent_id` to race against.
--
-- Honest gap, recorded rather than claimed away (ruling 19): the EXISTENCE of
-- the parent lock in `create_group` is not discriminating on its own, because
-- `private.validate_group_hierarchy` locks the parent `for no key update` as
-- well when it derives the new row's path. What these probes do discriminate
-- is the MODE: a command that reached for `for update` or `for share` on a
-- `groups` row turns assertions 1-6 red.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(11);

-- ==================== Committed fixtures ====================
-- Lock observation and test_race both need rows a second session can see, so
-- the fixtures are committed through dblink and torn down at both ends.

select extensions.dblink_connect('races_582_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres', current_database()));
select extensions.dblink_exec('races_582_setup', $setup$
  drop function if exists public.test_582_create(text);
  drop function if exists public.test_582_update();
  drop function if exists public.test_582_archive();
  drop function if exists public.test_582_archive_soft();
  drop function if exists public.test_582_rename_soft();
  drop function if exists public.test_582_rename();
  delete from public.groups where name like '%#582 race%';
  delete from auth.users where id in ('58210000-0000-0000-0000-000000000090');
  insert into auth.users(id, email) values
    ('58210000-0000-0000-0000-000000000090', 'bc.race.582@test.local');
  insert into public.profiles(id, full_name, email, role, status) values
    ('58210000-0000-0000-0000-000000000090', 'Race BC #582', 'bc.race.582@test.local', 'bc', 'activ');
  insert into public.groups(name, category, min_level, created_by) values
    ('Parent #582 race', 'department', 0, '58210000-0000-0000-0000-000000000090'),
    ('Archive #582 race', 'department', 0, '58210000-0000-0000-0000-000000000090');
  insert into public.groups(name, category, parent_id, min_level, created_by)
  select 'Child #582 race', 'team', id, 0, '58210000-0000-0000-0000-000000000090'
    from public.groups where name = 'Parent #582 race';

  create function public.test_582_create(p_suffix text) returns text
  language sql as $fn$
    select (public.create_group('New ' || p_suffix || ' #582 race', 'team',
      (select id from public.groups where name = 'Parent #582 race'))).name;
  $fn$;

  create function public.test_582_update() returns text
  language sql as $fn$
    select (public.update_group(
      (select id from public.groups where name = 'Child #582 race'),
      'Child #582 race', 'Coordonator', false, null, false, 0)).manager_title;
  $fn$;

  create function public.test_582_archive() returns text
  language sql as $fn$
    select (public.archive_group(
      (select id from public.groups where name = 'Archive #582 race'))).status;
  $fn$;

  create function public.test_582_rename() returns text
  language sql as $fn$
    select (public.update_group(
      (select id from public.groups where name like 'Child #582 race' or name = 'Renamed #582 race'),
      'Renamed #582 race', null, false, null, false, 0)).name;
  $fn$;

  create function public.test_582_rename_soft() returns text
  language plpgsql as $fn$
  begin
    return public.test_582_rename();
  exception when others then
    return sqlerrm;
  end;
  $fn$;

  create function public.test_582_archive_soft() returns text
  language plpgsql as $fn$
  begin
    return (public.archive_group(
      (select id from public.groups where name = 'Archive #582 race'))).status;
  exception when others then
    return sqlerrm;
  end;
  $fn$;

  revoke execute on function public.test_582_create(text), public.test_582_update(),
    public.test_582_archive(), public.test_582_archive_soft(),
    public.test_582_rename(), public.test_582_rename_soft()
    from public, anon, authenticated, service_role;
  grant execute on function public.test_582_create(text), public.test_582_update(),
    public.test_582_archive(), public.test_582_archive_soft(),
    public.test_582_rename(), public.test_582_rename_soft() to authenticated;
$setup$);

-- ==================== 1 · create_group's lock modes ====================

select extensions.dblink_connect('races_582_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres', current_database()));
select extensions.dblink_exec('races_582_lock',
  'begin; set local statement_timeout = ''5s''; set local lock_timeout = ''2s'';');
select * from extensions.dblink('races_582_lock', $$select set_config('request.jwt.claims',
  '{"sub":"58210000-0000-0000-0000-000000000090","role":"authenticated","app_metadata":{"member_role":"bc","member_level":6}}',
  true)$$) as claims(setting text);
select extensions.dblink_exec('races_582_lock', 'set local role authenticated');
select * from extensions.dblink('races_582_lock', $$select public.test_582_create('A')$$) as held(name text);

select ok(exists (
  select 1 from extensions.pgrowlocks('public.groups') l
   join public.groups g on g.ctid = l.locked_row
  where g.name = 'Parent #582 race' and 'For No Key Update' = any (l.modes)),
  'create_group holds its parent FOR NO KEY UPDATE -- the mode conventions section 1 requires');
select ok(not exists (
  select 1 from extensions.pgrowlocks('public.groups') l
   join public.groups g on g.ctid = l.locked_row
  where g.name = 'Parent #582 race' and 'For Update' = any (l.modes)),
  'and never FOR UPDATE, which would ABBA against the FK key-share every child insert takes');
select is((select count(*) from extensions.pgrowlocks('public.groups') l
            where 'For Share' = any (l.modes)), 0::bigint,
  'create_group takes no share lock on any groups row (the Wave 3 cross-cutting rule)');

select extensions.dblink_exec('races_582_lock', 'rollback');

-- ==================== 2 · update_group's lock modes ====================

select extensions.dblink_exec('races_582_lock',
  'begin; set local statement_timeout = ''5s''; set local lock_timeout = ''2s'';');
select * from extensions.dblink('races_582_lock', $$select set_config('request.jwt.claims',
  '{"sub":"58210000-0000-0000-0000-000000000090","role":"authenticated","app_metadata":{"member_role":"bc","member_level":6}}',
  true)$$) as claims(setting text);
select extensions.dblink_exec('races_582_lock', 'set local role authenticated');
select * from extensions.dblink('races_582_lock', $$select public.test_582_update()$$) as held(title text);

-- The target's own `for update` cannot be read off this probe and the reason is
-- in conventions section 1: pgrowlocks reports the *updater* string once a
-- write has actually landed on the row, and update_group writes its target
-- before the transaction is observed. The lock is what makes the command
-- re-read state that a concurrent writer may have moved, so it is proved by
-- the race at the end of this file instead -- where a second identical edit is
-- answered nothing_to_update rather than writing the same row twice.
select ok(not exists (
  select 1 from extensions.pgrowlocks('public.groups') l
   join public.groups g on g.ctid = l.locked_row
  where g.name = 'Child #582 race' and 'For Share' = any (l.modes)),
  'update_group never holds its target in a SHARE mode (the upgrade that would ABBA)');
select ok(exists (
  select 1 from extensions.pgrowlocks('public.groups') l
   join public.groups g on g.ctid = l.locked_row
  where g.name = 'Parent #582 race'
    and 'For No Key Update' = any (l.modes)
    and not ('For Update' = any (l.modes))),
  'and its PARENT only FOR NO KEY UPDATE -- the two modes are not interchangeable');
select is((select count(*) from extensions.pgrowlocks('public.groups') l
            where 'For Share' = any (l.modes)), 0::bigint,
  'update_group takes no share lock on any groups row either');

select extensions.dblink_exec('races_582_lock', 'rollback');
select extensions.dblink_disconnect('races_582_lock');

-- ==================== 3 · two archives of one Group ====================

select pg_temp.test_login('58210000-0000-0000-0000-000000000090',
  '{"member_role":"bc","member_level":6}');
reset role;
create temp table race_582_archive as select * from pg_temp.test_race(
  'select public.test_582_archive()', 'select public.test_582_archive_soft()');

select is((select result_a from race_582_archive), 'archived',
  'the first archive_group wins and the Group is archived');
select ok((select b_waited from race_582_archive),
  'the second archive_group waits on the target row instead of reading stale state');
select is((select result_b from race_582_archive), 'group_already_archived',
  'and is answered group_already_archived once the first commits -- never a silent second archive');

-- ==================== 4 · two Child Groups under one parent ====================

select pg_temp.test_login('58210000-0000-0000-0000-000000000090',
  '{"member_role":"bc","member_level":6}');
reset role;
create temp table race_582_create as select * from pg_temp.test_race(
  $$select public.test_582_create('B')$$, $$select public.test_582_create('C')$$);

select is((select result_a || '|' || result_b || '|' || b_waited from race_582_create),
  'New B #582 race|New C #582 race|true',
  'two Child Groups created under one parent serialize on the parent row and both land');

-- ==================== 5 · two identical edits of one Group ====================
-- This is what the target's `for update` is FOR, and the probe above could not
-- read: the lock is taken before the command judges state, so B re-reads the
-- row A just wrote and answers nothing_to_update. Without it, B would judge
-- `nothing_to_update` against its own stale snapshot, find a difference that no
-- longer exists, and write the same row a second time.

select pg_temp.test_login('58210000-0000-0000-0000-000000000090',
  '{"member_role":"bc","member_level":6}');
reset role;
create temp table race_582_rename as select * from pg_temp.test_race(
  $$select public.test_582_rename()$$, $$select public.test_582_rename_soft()$$);

select is((select result_a || '|' || result_b || '|' || b_waited from race_582_rename),
  'Renamed #582 race|nothing_to_update|true',
  'a second identical update_group waits on the target and is then told there is nothing to update');

-- ==================== Teardown ====================

select extensions.dblink_exec('races_582_setup', $teardown$
  drop function if exists public.test_582_create(text);
  drop function if exists public.test_582_update();
  drop function if exists public.test_582_archive();
  drop function if exists public.test_582_archive_soft();
  drop function if exists public.test_582_rename_soft();
  drop function if exists public.test_582_rename();
  delete from public.groups where name like '%#582 race%';
  delete from auth.users where id in ('58210000-0000-0000-0000-000000000090');
$teardown$);
select extensions.dblink_disconnect('races_582_setup');

select * from finish();
rollback;
