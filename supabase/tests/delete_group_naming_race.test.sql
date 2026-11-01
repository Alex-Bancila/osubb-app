-- #1176 (follow-up of #1129): delete_group never deletes a Group named board
-- or Adunarea Generală while the delete runs.
--
-- set_org_setting_impl holds its setting row FOR UPDATE and the Group it names
-- FOR KEY SHARE. delete_group_impl locks the target FOR NO KEY UPDATE and the
-- subtree in id order, none of which conflicts with that, and its protection
-- check (group_delete_summary -> is_protected_group) reads org_settings
-- without a lock. So a Child named the Adunarea Generală while its parent's
-- delete ran committed after the check and was deleted, the setting left
-- naming a Group that no longer exists. delete_group_impl now holds the two
-- naming settings FOR SHARE before the Group lock, as archive_group_impl does.
--
-- Mutation proof: dropping that FOR SHARE turns both assertions red -- B's
-- delete waits only on its final DELETE, then succeeds once A commits, and the
-- Child is gone.
--
-- Committed fixtures (prefix 1176), because the two dblink sessions cannot
-- see this transaction's rows: the BC ...0051, 'Părinte liber #1176
-- committed' and its Child. Cleaned at the start (an aborted run's leftovers)
-- and at the end, the setting's value and actor stamp restored.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(2);

select extensions.dblink_connect('dgr_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('dgr_setup', 'set lock_timeout = ''2s''');

create function pg_temp.dgr_cleanup() returns void language plpgsql as $fn$
begin
  perform extensions.dblink_exec('dgr_setup', $$
    -- set_org_setting stamps the actor; a leftover stamp would hold the account.
    update public.org_settings set updated_by = null
     where updated_by = '11760000-0000-0000-0000-000000000051';
    delete from public.groups where name like '%#1176 committed%' and parent_id is not null;
    delete from public.groups where name like '%#1176 committed%';
    delete from auth.users where id = '11760000-0000-0000-0000-000000000051';
  $$);
end;
$fn$;
select pg_temp.dgr_cleanup();

create temp table dgr_old as
  select value, updated_by from public.org_settings where key = 'adunarea_generala_group_id';

select extensions.dblink_exec('dgr_setup', $$
  insert into auth.users (id, email)
  values ('11760000-0000-0000-0000-000000000051', 'race.bc.1176@test.local');
  insert into public.profiles (id, full_name, email, role, status)
  values ('11760000-0000-0000-0000-000000000051', 'Race BC 1176', 'race.bc.1176@test.local', 'bc', 'activ');
  insert into public.groups (name, category, min_level, created_by)
  values ('Părinte liber #1176 committed', 'department', 0, '11760000-0000-0000-0000-000000000051');
  insert into public.groups (name, category, parent_id, min_level, created_by)
  select 'Copil liber #1176 committed', 'team', parent.id, 0, '11760000-0000-0000-0000-000000000051'
    from public.groups as parent where parent.name = 'Părinte liber #1176 committed';
$$);

create temp table dgr_ids as
  select (select id from public.groups where name = 'Copil liber #1176 committed') as child_id,
         (select id from public.groups where name = 'Părinte liber #1176 committed') as parent_id;
grant select on dgr_ids to authenticated;

-- Session A names the Child the Adunarea Generală and stays open; session B
-- deletes the parent with its subtree (mode everything) and must wait for A,
-- then read the new name and refuse.
select pg_temp.test_login_leadership('11760000-0000-0000-0000-000000000051');
select throws_ok(
  format($$select * from pg_temp.test_race(
    $a$select 'named' from public.set_org_setting('adunarea_generala_group_id', '%s')$a$,
    $b$select public.delete_group(%s, 'everything')::text$b$)$$,
    (select child_id from dgr_ids), (select parent_id from dgr_ids)),
  'PT409', 'group_protected',
  'delete_group waits for a naming in flight and then refuses: the Child named Adunarea Generală meanwhile is protected (#1176)');
reset role;

select ok(
  exists (select 1 from public.groups where id = (select child_id from dgr_ids)),
  'and the Child survives, the setting naming a Group that still exists');

-- Put the setting back (value and the actor's stamp), then the fixtures.
select extensions.dblink_exec('dgr_setup', format(
  $$update public.org_settings set value = %L, updated_by = %L where key = 'adunarea_generala_group_id'$$,
  (select value from dgr_old), (select updated_by from dgr_old)));
select pg_temp.dgr_cleanup();
select extensions.dblink_disconnect('dgr_setup');

select * from finish();
rollback;
