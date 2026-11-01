-- #1129 (audit 2026-10-30, M5): the Groups delete_group protects are never
-- archived either, and the Organization marker cannot be cleared by omission.
--
-- archive_group needed only level >= 6 and no open work, while delete_group
-- refused PT409 group_protected for the Organization Group, an
-- Automatic-Membership Group and the Groups named by org_settings
-- board_group_id / adunarea_generala_group_id. Archiving cancels every future
-- Event of the subtree with a fan-out to every attendee, and unarchive (R65)
-- never un-cancels. update_group_structure read a null p_is_organization as
-- false while refusing a null p_is_private, so a full-state replace that left
-- the flag out unmarked the Organization Group, after which an org-wide
-- Announcement reached nobody.
--
-- Mutation proof: dropping the is_protected_group gate from archive_group_impl
-- turns the archive refusals red; reading a null p_is_organization as false
-- again turns "a null p_is_organization is malformed" red; dropping the
-- clearing refusal turns "the Organization Group keeps its marker" red;
-- dropping the FOR SHARE on the two naming settings turns the race red (B
-- neither waits nor refuses, and the Group named meanwhile is archived).
--
-- Personas (prefix 1129): 1 BC activ, 2 voluntar activ (an ordinary member);
-- the committed BC ...0051 for the race, which other sessions must see.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(19);

create function pg_temp.u1129(n integer) returns uuid language sql immutable as $$
  select ('11290000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- ==================== the naming race, on committed fixtures ====================
-- set_org_setting_impl holds its setting row FOR UPDATE and the Group it names
-- FOR KEY SHARE, which the archive's FOR NO KEY UPDATE on descendants never
-- waits for; the archive therefore holds the two naming settings FOR SHARE
-- before the Group lock (review of PR #1161). Session A names the committed
-- Child the Adunarea Generală and stays open; session B archives its parent:
-- B waits for A, then reads the new name and refuses. First in the suite,
-- before this transaction touches org_settings itself, or A would wait on
-- our own uncommitted fixture update instead.
select extensions.dblink_connect('agp_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('agp_setup', 'set lock_timeout = ''2s''');

create function pg_temp.agp_cleanup() returns void language plpgsql as $fn$
begin
  perform extensions.dblink_exec('agp_setup', $$
    update public.org_settings as setting
       set value = (select grp.id::text from public.groups as grp
                     where grp.name = 'Adunarea Generală' and grp.parent_id is null limit 1)
     where setting.key = 'adunarea_generala_group_id'
       and setting.value in (select grp.id::text from public.groups as grp
                              where grp.name like '%#1129 committed%');
    -- set_org_setting stamps the actor; a leftover stamp would hold the account.
    update public.org_settings set updated_by = null
     where updated_by = '11290000-0000-0000-0000-000000000051';
    delete from public.groups where name like '%#1129 committed%' and parent_id is not null;
    delete from public.groups where name like '%#1129 committed%';
    delete from auth.users where id = '11290000-0000-0000-0000-000000000051';
  $$);
end;
$fn$;
select pg_temp.agp_cleanup();

create temp table agp_old as
  select value, updated_by from public.org_settings where key = 'adunarea_generala_group_id';

select extensions.dblink_exec('agp_setup', $$
  insert into auth.users (id, email)
  values ('11290000-0000-0000-0000-000000000051', 'race.bc.1129@test.local');
  insert into public.profiles (id, full_name, email, role, status)
  values ('11290000-0000-0000-0000-000000000051', 'Race BC 1129', 'race.bc.1129@test.local', 'bc', 'activ');
  insert into public.groups (name, category, min_level, created_by)
  values ('Părinte liber #1129 committed', 'department', 0, '11290000-0000-0000-0000-000000000051');
  insert into public.groups (name, category, parent_id, min_level, created_by)
  select 'Copil liber #1129 committed', 'team', parent.id, 0, '11290000-0000-0000-0000-000000000051'
    from public.groups as parent where parent.name = 'Părinte liber #1129 committed';
$$);

select pg_temp.test_login_leadership('11290000-0000-0000-0000-000000000051');
select throws_ok(
  format($$select * from pg_temp.test_race(
    $a$select 'named' from public.set_org_setting('adunarea_generala_group_id', '%s')$a$,
    $b$select (public.archive_group(%s)).status::text$b$)$$,
    (select id from public.groups where name = 'Copil liber #1129 committed'),
    (select id from public.groups where name = 'Părinte liber #1129 committed')),
  'PT409', 'group_protected',
  'archive_group waits for a naming in flight and then refuses: the Child named Adunarea Generală meanwhile is protected, never archived');
reset role;

-- A committed; put the setting back (value and the actor's stamp) before this
-- transaction locks the row below.
select extensions.dblink_exec('agp_setup', format(
  $$update public.org_settings set value = %L, updated_by = %L where key = 'adunarea_generala_group_id'$$,
  (select value from agp_old), (select updated_by from agp_old)));
select pg_temp.agp_cleanup();
select extensions.dblink_disconnect('agp_setup');

-- ==================== transaction-local fixtures ====================

insert into auth.users (id, email)
select pg_temp.u1129(n), 'protected.' || n || '.1129@test.local' from generate_series(1, 2) n;
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.u1129(n), 'Protected #1129 ' || n, 'protected.' || n || '.1129@test.local',
       (case n when 1 then 'bc' else 'voluntar' end)::public.member_role, 'activ'
  from generate_series(1, 2) n;

insert into public.groups (name, category, min_level, created_by)
values ('Obișnuit #1129',           'department', 0, pg_temp.u1129(1)),
       ('Birou #1129',              'department', 0, pg_temp.u1129(1)),
       ('Părinte protejat #1129',   'department', 0, pg_temp.u1129(1)),
       -- Its only protected descendant is the Adunarea Generală below, so the
       -- configured-id arm of the subtree read is proven on its own (review
       -- of PR #1161).
       ('Părinte configurat #1129', 'department', 0, pg_temp.u1129(1));
insert into public.groups (name, category, min_level, automatic_membership, created_by)
values ('Automat #1129', 'department', 0, true, pg_temp.u1129(1));

create function pg_temp.g1129(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;
create function pg_temp.org1129() returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where is_organization
$$;

insert into public.groups (name, category, parent_id, min_level, automatic_membership, created_by)
values ('Copil automat #1129', 'team', pg_temp.g1129('Părinte protejat #1129'), 0, true, pg_temp.u1129(1));
insert into public.groups (name, category, parent_id, min_level, created_by)
values ('Adunare #1129', 'team', pg_temp.g1129('Părinte configurat #1129'), 0, pg_temp.u1129(1));

-- The seeded Organization Group also has Automatic Membership; switch that off
-- so the Organization arm of the protection is proven on its own.
update public.groups set automatic_membership = false where is_organization;
update public.org_settings set value = pg_temp.g1129('Birou #1129')::text where key = 'board_group_id';
update public.org_settings set value = pg_temp.g1129('Adunare #1129')::text where key = 'adunarea_generala_group_id';

-- A future Event on a protected Group: the refusal must leave it standing.
insert into public.events (title, type, starts_at, group_id, created_by)
values ('Ședință Birou #1129', 'activitate', now() + interval '10 days',
        pg_temp.g1129('Birou #1129'), pg_temp.u1129(1));

-- ==================== update_group_structure ====================
-- First, while every Group is still active: a refusal here must be its own,
-- never group_archived from a section below.

select pg_temp.test_login_leadership(pg_temp.u1129(1));
select throws_ok(
  format($$select public.update_group_structure(%s, 'department', false, true, false, 0, '#112233', null, null, false)$$,
         pg_temp.g1129('Birou #1129')),
  'PT400', 'invalid_group_organization',
  'update_group_structure: a null p_is_organization is malformed -- a full-state replace must say which it is, as for p_is_private');
select throws_ok(
  format($$select public.update_group_structure(%s, 'organization', false, true, false, 0, '#112233', 'ORG', false, false)$$,
         pg_temp.org1129()),
  'PT409', 'group_protected',
  'update_group_structure: the Organization Group keeps its marker -- there is always exactly one');
select lives_ok(
  format($$select public.update_group_structure(%s, 'organization', false, true, false, 0, '#112233', 'ORG', true, false)$$,
         pg_temp.org1129()),
  'update_group_structure: every other edit of the Organization Group goes through as before');
reset role;
select is(
  (select is_organization::text || ':' || color from public.groups where id = pg_temp.org1129()),
  'true:#112233',
  'and the marker stays while the colour changed');

-- ==================== archive_group ====================

select pg_temp.test_login_leadership(pg_temp.u1129(2));
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.org1129()),
  '42501', 'group_manage_forbidden',
  'archive_group: the authority check comes first -- an ordinary member learns nothing about protection');
reset role;

select pg_temp.test_login_leadership(pg_temp.u1129(1));
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.org1129()),
  'PT409', 'group_protected', 'archive_group: the Organization Group is never archived');
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g1129('Automat #1129')),
  'PT409', 'group_protected', 'archive_group: an Automatic-Membership Group is never archived');
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g1129('Birou #1129')),
  'PT409', 'group_protected', 'archive_group: the board Group set in Setări is never archived');
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g1129('Adunare #1129')),
  'PT409', 'group_protected', 'archive_group: the Adunarea Generală set in Setări is never archived');
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g1129('Părinte protejat #1129')),
  'PT409', 'group_protected', 'archive_group: nor is a Group whose subtree holds a protected Group -- the archive would cascade onto it');
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g1129('Părinte configurat #1129')),
  'PT409', 'group_protected', 'archive_group: a Group whose subtree holds only the Adunarea Generală is refused -- the configured-id check reaches descendants too');
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g1129('Copil automat #1129')),
  'PT409', 'group_protected', 'archive_group: the protected Child Group is refused on its own too, through the Child branch of the authority');
reset role;

select is(
  (select cancelled_at from public.events where title = 'Ședință Birou #1129'),
  null,
  'the refused archive wrote nothing: the board Group''s future Event stands');
select is(
  (select count(*) from public.groups
    where status = 'archived'
      and (is_organization or name in ('Automat #1129', 'Birou #1129', 'Adunare #1129',
                                       'Părinte protejat #1129', 'Copil automat #1129',
                                       'Părinte configurat #1129'))),
  0::bigint,
  'and none of the protected Groups changed status');

select pg_temp.test_login_leadership(pg_temp.u1129(1));
select lives_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g1129('Obișnuit #1129')),
  'archive_group: an ordinary Group archives as before');
reset role;
select is(
  (select status from public.groups where name = 'Obișnuit #1129'), 'archived',
  'and is archived');

-- ==================== the helper both commands read ====================
-- Last, so that on a database without it the refusals above still report
-- on their own before the missing function aborts the suite.

select is(
  array[private.is_protected_group(pg_temp.g1129('Obișnuit #1129')),
        private.is_protected_group(pg_temp.org1129()),
        private.is_protected_group(pg_temp.g1129('Automat #1129')),
        private.is_protected_group(pg_temp.g1129('Birou #1129')),
        private.is_protected_group(pg_temp.g1129('Adunare #1129')),
        private.is_protected_group(pg_temp.g1129('Părinte protejat #1129')),
        private.is_protected_group(pg_temp.g1129('Copil automat #1129')),
        private.is_protected_group(999999999)],
  array[false, true, true, true, true, true, true, false],
  'is_protected_group: the Organization Group, an Automatic-Membership Group, the board and AG Groups, a Group above one and the protected Child itself; never an ordinary or unknown Group');
select is(
  public.group_delete_preview(pg_temp.g1129('Părinte protejat #1129')) -> 'protected', 'true'::jsonb,
  'group_delete_preview reads the same helper');

select * from finish();
rollback;
