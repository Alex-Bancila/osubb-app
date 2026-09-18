-- groups_sync.test.sql — #509: the one-way mirror. Every write to the six
-- legacy structure tables lands in `groups`/`group_members` in the same
-- statement, and a profile's promotion to (or demotion from) rank BCE
-- re-derives the Department Group Roles that rank confers (ADR-0009 Wave 1).
--
-- #508 pinned the *mapping*; this suite pins that the mapping runs *live*,
-- from every write path a client or the seed actually uses:
--   * `postgres` — the seed and any future backfill, writing legacy rows directly;
--   * a BC through `member_departments_manage`, the Project commands and the
--     Independent-Team commands;
--   * a local BCE of `edu` through `teams_create` and the Department-Team
--     commands — the persona that proves the trigger functions must be
--     `security definer`: that session holds no write grant on `groups` at
--     all, so an invoker-rights mirror answers `42501` instead of mirroring.
--
-- The one assertion that guards #508 and #509 against each other is the
-- fixpoint: after everything below, a full `private.sync_groups_from_legacy()`
-- must change nothing. If the trigger mapping ever drifts from the backfill
-- mapping, that is where it shows.
--
-- Fixture prefix: 50900000-…  The concurrency section runs first and on
-- *committed* rows of its own (`…0090`, `…0091` and the `c-race-*` Teams,
-- all removed again at the end of that section), because `pg_temp.test_race`
-- opens real connections that cannot see this transaction — and because every
-- later section takes row locks on the Department Groups those sessions would
-- otherwise wait on.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(47);

-- ==================== 1. The seven triggers exist ====================
-- Pinned by name and table (the `shared_timestamps.test.sql` idiom): a
-- dropped trigger leaves its function in place, so `has_function` alone
-- would stay green while nothing mirrored any more.

select ok(exists (select 1 from pg_trigger
   where tgrelid = 'public.departments'::regclass
     and tgname = 'departments_mirror_group' and not tgisinternal),
  'departments_mirror_group fires on public.departments');
select ok(exists (select 1 from pg_trigger
   where tgrelid = 'public.teams'::regclass
     and tgname = 'teams_mirror_group' and not tgisinternal),
  'teams_mirror_group fires on public.teams');
select ok(exists (select 1 from pg_trigger
   where tgrelid = 'public.projects'::regclass
     and tgname = 'projects_mirror_group' and not tgisinternal),
  'projects_mirror_group fires on public.projects');
select ok(exists (select 1 from pg_trigger
   where tgrelid = 'public.member_departments'::regclass
     and tgname = 'member_departments_mirror_membership' and not tgisinternal),
  'member_departments_mirror_membership fires on public.member_departments');
select ok(exists (select 1 from pg_trigger
   where tgrelid = 'public.team_members'::regclass
     and tgname = 'team_members_mirror_membership' and not tgisinternal),
  'team_members_mirror_membership fires on public.team_members');
select ok(exists (select 1 from pg_trigger
   where tgrelid = 'public.project_members'::regclass
     and tgname = 'project_members_mirror_membership' and not tgisinternal),
  'project_members_mirror_membership fires on public.project_members');
select ok(exists (select 1 from pg_trigger
   where tgrelid = 'public.profiles'::regclass
     and tgname = 'profiles_rederive_group_roles' and not tgisinternal),
  'profiles_rederive_group_roles fires on public.profiles');

-- ==================== 2. Concurrency (#507 review S3) ====================
-- `private.validate_group_hierarchy` locks the parent Group `for no key
-- update` before deriving a child's path from it, so two mirrored child
-- inserts under the same Department serialize instead of racing on the
-- parent's own row. Both sessions are real connections: their fixtures are
-- committed through a third one and removed again below.
--
-- Four assertions, each catching a different mutation: the lock deleted (8),
-- a lock taken on the wrong scale (9), the wrong lock mode (10, 11), and the
-- mirror write-locking a Group it did not have to create (12).
--
-- This section is first on purpose. Everything after it takes row locks on
-- the Department Groups (a membership insert upserts one, and the fixpoint
-- resync upserts every one of them), and those locks live until this
-- transaction rolls back — a race started later would simply wait on us.

select extensions.dblink_connect('race_setup_509', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('race_setup_509', $$
  delete from public.teams
   where id in ('c-race-a-509', 'c-race-b-509', 'c-race-c-509', 'c-race-d-509',
                'c-race-e-509', 'c-race-f-509');
  delete from auth.users where id in (
    '50900000-0000-0000-0000-000000000090',
    '50900000-0000-0000-0000-000000000091');
  insert into auth.users (id, email) values
    ('50900000-0000-0000-0000-000000000090', 'race.bc.509@test.local'),
    ('50900000-0000-0000-0000-000000000091', 'race.promovat.509@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('50900000-0000-0000-0000-000000000090', 'BC Race 509',
     'race.bc.509@test.local', 'bc', 'activ'),
    ('50900000-0000-0000-0000-000000000091', 'Promovat Race 509',
     'race.promovat.509@test.local', 'voluntar', 'activ');
  insert into public.member_departments (member_id, dept_id)
  values ('50900000-0000-0000-0000-000000000091', 'youth');
$$);

select pg_temp.test_login('50900000-0000-0000-0000-000000000090', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6,
  'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
reset role;

create temp table race_same_509 as
select * from pg_temp.test_race(
  $$ with mirrored as (
       insert into public.teams (id, name, dept_id)
       values ('c-race-a-509', 'Echipa Race A 509', 'youth')
       returning id
     ) select id::text from mirrored $$,
  $$ with mirrored as (
       insert into public.teams (id, name, dept_id)
       values ('c-race-b-509', 'Echipa Race B 509', 'youth')
       returning id
     ) select id::text from mirrored $$);

select is(
  (select format('%s:%s:%s', race.result_a, race.result_b, race.b_waited::text)
     from pg_temp.race_same_509 as race),
  'c-race-a-509:c-race-b-509:true',
  'two Teams mirrored under one Department serialize on the parent Group row: the second waits, then both commit — no deadlock, no lost child');

create temp table race_other_509 as
select * from pg_temp.test_race(
  $$ with mirrored as (
       insert into public.teams (id, name, dept_id)
       values ('c-race-c-509', 'Echipa Race C 509', 'youth')
       returning id
     ) select id::text from mirrored $$,
  $$ with mirrored as (
       insert into public.teams (id, name, dept_id)
       values ('c-race-d-509', 'Echipa Race D 509', 'pr')
       returning id
     ) select id::text from mirrored $$);

select is(
  (select format('%s:%s:%s', race.result_a, race.result_b, race.b_waited::text)
     from pg_temp.race_other_509 as race),
  'c-race-c-509:c-race-d-509:false',
  'and the wait is the parent *row*, not the table: a Team mirrored under a different Department never blocks');

-- The lock *mode*, read directly. The race above goes red when the parent
-- lock is deleted, but it cannot tell `for no key update` from `for update`:
-- both conflict with the other session's own attempt at the same lock, so
-- both wait. `extensions.pgrowlocks` can — conventions section 2 names the
-- exact string it reports — and the difference matters, because `for update`
-- additionally blocks every FK key-share reader of the Department Group (a
-- roster insert, a rank promotion) for the length of a Team creation.
--
-- Probed first in isolation, on the one path that reaches that lock and
-- nothing else: a native Child Group insert, which only the table owner can
-- make in Wave 1 and which is exactly what Wave 3's Group commands will do.
-- Mutations this catches: *remove* the `for no key update` and only the
-- foreign key's own `For Key Share` is left on the parent; *swap* it for
-- `for update` and the parent reads `For Update`.
select extensions.dblink_connect('group_lock_native_509', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('group_lock_native_509', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('group_lock_native_509', $$
  with child as (
    insert into public.groups (name, category, parent_id)
    select 'Grup Nativ #509', 'team', parent.id
      from public.groups as parent where parent.legacy_dept_id = 'youth'
    returning id
  ) select id::text from child
$$) as native_child(group_id text);

select is(
  (select array_to_string(array(select unnest(row_lock.modes) order by 1), ',')
     from extensions.pgrowlocks('public.groups') as row_lock
     join public.groups as grp on grp.ctid = row_lock.locked_row
    where grp.legacy_dept_id = 'youth'),
  'For No Key Update',
  'deriving a Child Group''s path holds its parent `for no key update` — the lock private.validate_group_hierarchy takes, and the only one on that row');

select extensions.dblink_exec('group_lock_native_509', 'rollback');
select extensions.dblink_disconnect('group_lock_native_509');

-- And the same mode on the path #509 actually uses, a mirrored Team creation
-- by a BC. This reads the same only because the sync no longer upserts a
-- parent Department Group that already exists: `on conflict do update` locks
-- the conflicting row FOR NO KEY UPDATE even when its `is distinct from`
-- guard writes nothing, and that lock would otherwise sit on top of — and
-- hide — whatever private.validate_group_hierarchy takes.
select extensions.dblink_connect('group_lock_509', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('group_lock_509', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('group_lock_509', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '50900000-0000-0000-0000-000000000090', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'bc', 'member_level', 6))::text, true)
$$) as claims(setting text);
select extensions.dblink_exec('group_lock_509', 'set local role authenticated');
select * from extensions.dblink('group_lock_509', $$
  with mirrored as (
    insert into public.teams (id, name, dept_id)
    values ('c-race-e-509', 'Echipa Race E 509', 'youth')
    returning id
  ) select id::text from mirrored
$$) as mirrored_team(team_id text);

select is(
  (select array_to_string(array(select unnest(row_lock.modes) order by 1), ',')
     from extensions.pgrowlocks('public.groups') as row_lock
     join public.groups as grp on grp.ctid = row_lock.locked_row
    where grp.legacy_dept_id = 'youth'),
  'For No Key Update',
  'mirroring a Team holds its parent Department Group `for no key update`, never `for update` — foreign-key readers of that Group keep flowing (conventions section 2)');

select extensions.dblink_exec('group_lock_509', 'rollback');
select extensions.dblink_disconnect('group_lock_509');

-- And the contention that decision buys. `private.rederive_department_group_roles`
-- only ensures a Department Group when it is actually missing, so an ordinary
-- rank promotion reaches that Group through `group_members.group_id` alone and
-- never queues behind a Team being mirrored under it. Mutation this catches:
-- drop the `not exists` guard from that function and this promotion waits.
create temp table race_keyshare_509 as
select * from pg_temp.test_race(
  $$ with mirrored as (
       insert into public.teams (id, name, dept_id)
       values ('c-race-f-509', 'Echipa Race F 509', 'youth')
       returning id
     ) select id::text from mirrored $$,
  $$ with promoted as (
       update public.profiles set role = 'bce'
        where id = '50900000-0000-0000-0000-000000000091'
       returning id
     ) select id::text from promoted $$);

select is(
  (select format('%s:%s', race.result_b, race.b_waited::text)
     from pg_temp.race_keyshare_509 as race),
  '50900000-0000-0000-0000-000000000091:false',
  'and a rank promotion in that same Department does not wait on the Team being mirrored — the mirror never takes a write lock on a Group it did not have to create');

select extensions.dblink_exec('race_setup_509', $$
  delete from public.teams
   where id in ('c-race-a-509', 'c-race-b-509', 'c-race-c-509',
                'c-race-d-509', 'c-race-e-509', 'c-race-f-509');
  delete from auth.users where id in (
    '50900000-0000-0000-0000-000000000090',
    '50900000-0000-0000-0000-000000000091');
$$);
select extensions.dblink_disconnect('race_setup_509');
select pg_temp.test_clear_jwt();
reset role;

-- ==================== 3. Fixtures ====================

insert into auth.users (id, email) values
  ('50900000-0000-0000-0000-000000000001', 'bc.509@test.local'),
  ('50900000-0000-0000-0000-000000000002', 'bce.edu.509@test.local'),
  ('50900000-0000-0000-0000-000000000003', 'voluntar.a.509@test.local'),
  ('50900000-0000-0000-0000-000000000004', 'voluntar.b.509@test.local'),
  ('50900000-0000-0000-0000-000000000005', 'bce.fin.509@test.local'),
  ('50900000-0000-0000-0000-000000000006', 'dublu.509@test.local'),
  ('50900000-0000-0000-0000-000000000007', 'org.509@test.local'),
  ('50900000-0000-0000-0000-000000000008', 'promovat.509@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('50900000-0000-0000-0000-000000000001', 'BC 509',        'bc.509@test.local',        'bc',       'activ'),
  ('50900000-0000-0000-0000-000000000002', 'BCE Edu 509',   'bce.edu.509@test.local',   'bce',      'activ'),
  ('50900000-0000-0000-0000-000000000003', 'Voluntar A 509','voluntar.a.509@test.local','voluntar', 'activ'),
  ('50900000-0000-0000-0000-000000000004', 'Voluntar B 509','voluntar.b.509@test.local','voluntar', 'activ'),
  ('50900000-0000-0000-0000-000000000005', 'BCE Fin 509',   'bce.fin.509@test.local',   'bce',      'activ'),
  ('50900000-0000-0000-0000-000000000006', 'Dublu 509',     'dublu.509@test.local',     'voluntar', 'activ'),
  ('50900000-0000-0000-0000-000000000007', 'Org 509',       'org.509@test.local',       'voluntar', 'activ'),
  ('50900000-0000-0000-0000-000000000008', 'Promovat 509',  'promovat.509@test.local',  'voluntar', 'activ');

-- The BCE persona is a *local* BCE of `edu`: that is what private.can_administer_team_structure
-- asks for, and what makes the `teams_create` path below a real client write.
insert into public.member_departments (member_id, dept_id) values
  ('50900000-0000-0000-0000-000000000002', 'edu'),
  -- One member in two Departments, for the rank re-derivation below.
  ('50900000-0000-0000-0000-000000000006', 'fin'),
  ('50900000-0000-0000-0000-000000000006', 'hr'),
  ('50900000-0000-0000-0000-000000000008', 'secretariat');

-- ==================== 4. departments (postgres) ====================

insert into public.departments (id, name, short, color, kind)
values ('c-dept-509', 'Departament C 509', 'CDP', '#123456', 'department');

select is(
  (select format('%s|%s|%s|%s|%s', grp.name, grp.category, grp.competes_in_cup::text,
                 coalesce(grp.manager_title, '-'), coalesce(grp.parent_id::text, '-'))
     from public.groups as grp where grp.legacy_dept_id = 'c-dept-509'),
  'Departament C 509|department|true|BCE|-',
  'inserting a Department mirrors one top-level competing Group run by a BCE, in the same statement');

update public.departments set name = 'Departament C 509 redenumit' where id = 'c-dept-509';

select is(
  (select grp.name from public.groups as grp where grp.legacy_dept_id = 'c-dept-509'),
  'Departament C 509 redenumit',
  'renaming the Department renames its Group');

delete from public.departments where id = 'c-dept-509';

select is(
  (select count(*) from public.groups as grp where grp.legacy_dept_id = 'c-dept-509'),
  0::bigint,
  'and deleting it deletes the Group — no orphan waiting for the next full resync');

-- ==================== 5. teams ====================
-- The BCE creates a Department Team through `teams_create` as `authenticated`.
-- Mutation this catches: make private.mirror_team_group() `security invoker`
-- and this insert answers `42501 permission denied for table groups` — the
-- session that legitimately writes the legacy row holds no grant on the mirror.

select pg_temp.test_login_leadership('50900000-0000-0000-0000-000000000002');
insert into public.teams (id, name, dept_id)
values ('c-bce-team-509', 'Echipa C 509', 'edu');
reset role;

select is(
  (select format('%s|%s|%s|%s', grp.name, grp.category,
                 coalesce(grp.manager_title, '-'), parent.legacy_dept_id)
     from public.groups as grp
     join public.groups as parent on parent.id = grp.parent_id
    where grp.legacy_team_id = 'c-bce-team-509'),
  'Echipa C 509|team|Coordonator|edu',
  'a BCE creating a Department Team mirrors a Child Group under their own Department''s Group, run by a Coordonator');

-- The Independent Team the BC commands need. `teams_create` accepts a null
-- Department only from BC/Moderator.
select pg_temp.test_login_leadership('50900000-0000-0000-0000-000000000001');
insert into public.teams (id, name, dept_id)
values ('c-ind-team-509', 'Echipa Independenta C 509', null);
reset role;

-- Rosters, through the Team membership commands (`team_members` holds no
-- client DML grant at all since #279/#280).
select pg_temp.test_login_leadership('50900000-0000-0000-0000-000000000002');
select public.add_department_team_member('c-bce-team-509', '50900000-0000-0000-0000-000000000003');
select public.add_department_team_member('c-bce-team-509', '50900000-0000-0000-0000-000000000004');
select public.remove_department_team_member('c-bce-team-509', '50900000-0000-0000-0000-000000000004');
reset role;

select is(
  (select membership.group_role from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where grp.legacy_team_id = 'c-bce-team-509'
      and membership.member_id = '50900000-0000-0000-0000-000000000003'),
  'member',
  'add_department_team_member mirrors ordinary membership of the Team Group');

select is(
  (select count(*) from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where grp.legacy_team_id = 'c-bce-team-509'
      and membership.member_id = '50900000-0000-0000-0000-000000000004'),
  0::bigint,
  'and remove_department_team_member takes the roster row away again');

select pg_temp.test_login_leadership('50900000-0000-0000-0000-000000000001');
select public.add_independent_team_member('c-ind-team-509', '50900000-0000-0000-0000-000000000004');
reset role;

select is(
  (select membership.group_role from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where grp.legacy_team_id = 'c-ind-team-509'
      and membership.member_id = '50900000-0000-0000-0000-000000000004'),
  'responsible',
  'an Independent Team''s member is mirrored as a Group Responsible — joint management, no special case');

select pg_temp.test_login_leadership('50900000-0000-0000-0000-000000000001');
select public.remove_independent_team_member('c-ind-team-509', '50900000-0000-0000-0000-000000000004');
reset role;

select is(
  (select count(*) from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where grp.legacy_team_id = 'c-ind-team-509'),
  0::bigint,
  'and removing them empties the Group''s roster');

update public.teams set name = 'Echipa C 509 redenumita' where id = 'c-bce-team-509';

select is(
  (select grp.name from public.groups as grp where grp.legacy_team_id = 'c-bce-team-509'),
  'Echipa C 509 redenumita',
  'renaming a Team renames its Group');

-- Department Team -> Independent Team. Mutation this catches: drop the
-- `dept_id` branch from private.mirror_team_group() and the roster keeps the
-- Group Role the *old* shape conferred.
update public.teams set dept_id = null where id = 'c-bce-team-509';

select is(
  (select format('%s|%s|%s|%s',
                 coalesce(grp.parent_id::text, '-'),
                 (grp.path = array[grp.id])::text,
                 coalesce(grp.manager_title, '-'),
                 (select membership.group_role from public.group_members as membership
                   where membership.group_id = grp.id
                     and membership.member_id = '50900000-0000-0000-0000-000000000003'))
     from public.groups as grp where grp.legacy_team_id = 'c-bce-team-509'),
  '-|true|-|responsible',
  'a Team that leaves its Department becomes a top-level Group with no Group Manager, and every member becomes a Group Responsible');

update public.teams set dept_id = 'edu' where id = 'c-bce-team-509';

select is(
  (select format('%s|%s|%s',
                 parent.legacy_dept_id,
                 coalesce(grp.manager_title, '-'),
                 (select membership.group_role from public.group_members as membership
                   where membership.group_id = grp.id
                     and membership.member_id = '50900000-0000-0000-0000-000000000003'))
     from public.groups as grp
     join public.groups as parent on parent.id = grp.parent_id
    where grp.legacy_team_id = 'c-bce-team-509'),
  'edu|Coordonator|member',
  'and moving it back under a Department flips every Group Role back — the roster is re-derived, never patched');

-- The seed shape: `supabase/seed.sql` deletes its three demo Teams and
-- re-inserts them on every run, so the mirror must answer a delete-then-insert
-- with exactly one Group per legacy row, roster and all.
delete from public.teams where id = 'c-bce-team-509';

select is(
  (select format('%s|%s',
                 (select count(*) from public.groups as grp
                   where grp.legacy_team_id = 'c-bce-team-509'),
                 (select count(*) from public.group_members as membership
                    join public.groups as grp on grp.id = membership.group_id
                   where grp.legacy_team_id = 'c-bce-team-509'))),
  '0|0',
  'deleting a Team deletes its Group, and the roster cascades with it');

insert into public.teams (id, name, dept_id)
values ('c-bce-team-509', 'Echipa C 509 redenumita', 'edu');
insert into public.team_members (team_id, member_id)
values ('c-bce-team-509', '50900000-0000-0000-0000-000000000003');

select is(
  (select format('%s|%s',
                 (select count(*) from public.groups as grp
                   where grp.legacy_team_id = 'c-bce-team-509'),
                 (select membership.group_role from public.group_members as membership
                    join public.groups as grp on grp.id = membership.group_id
                   where grp.legacy_team_id = 'c-bce-team-509'
                     and membership.member_id = '50900000-0000-0000-0000-000000000003'))),
  '1|member',
  're-inserting the same Team leaves exactly one Group with that legacy id and the roster restored — the seed is re-runnable against the mirror');

-- ==================== 6. projects ====================
-- The BC leads this Project so the roster commands (which only its current
-- active lead may call) run as a client, not as the owner.

select pg_temp.test_login_leadership('50900000-0000-0000-0000-000000000001');
select public.create_project('Proiect C 509', '50900000-0000-0000-0000-000000000001');
reset role;

select is(
  (select format('%s|%s|%s|%s|%s',
                 grp.name, grp.category, grp.status, grp.created_by,
                 (select membership.group_role from public.group_members as membership
                   where membership.group_id = grp.id
                     and membership.member_id = '50900000-0000-0000-0000-000000000001'))
     from public.groups as grp
     join public.projects as project on project.id = grp.legacy_project_id
    where project.name = 'Proiect C 509'),
  'Proiect C 509|project|active|50900000-0000-0000-0000-000000000001|manager',
  'create_project mirrors an active Group carrying the Project''s own provenance, with its lead as Group Manager');

select pg_temp.test_login_leadership('50900000-0000-0000-0000-000000000001');
select public.add_project_member(
  (select id from public.projects where name = 'Proiect C 509'),
  '50900000-0000-0000-0000-000000000003');
reset role;

select is(
  (select membership.group_role from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
     join public.projects as project on project.id = grp.legacy_project_id
    where project.name = 'Proiect C 509'
      and membership.member_id = '50900000-0000-0000-0000-000000000003'),
  'member',
  'add_project_member mirrors ordinary membership of the Project Group');

select pg_temp.test_login_leadership('50900000-0000-0000-0000-000000000001');
select public.grant_project_responsible(
  (select id from public.projects where name = 'Proiect C 509'),
  '50900000-0000-0000-0000-000000000003');
reset role;

select is(
  (select membership.group_role from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
     join public.projects as project on project.id = grp.legacy_project_id
    where project.name = 'Proiect C 509'
      and membership.member_id = '50900000-0000-0000-0000-000000000003'),
  'responsible',
  'grant_project_responsible promotes them to Group Responsible');

select pg_temp.test_login_leadership('50900000-0000-0000-0000-000000000001');
select public.revoke_project_responsible(
  (select id from public.projects where name = 'Proiect C 509'),
  '50900000-0000-0000-0000-000000000003');
reset role;

select is(
  (select membership.group_role from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
     join public.projects as project on project.id = grp.legacy_project_id
    where project.name = 'Proiect C 509'
      and membership.member_id = '50900000-0000-0000-0000-000000000003'),
  'member',
  'and revoke_project_responsible returns them to ordinary membership');

select pg_temp.test_login_leadership('50900000-0000-0000-0000-000000000001');
select public.remove_project_member(
  (select id from public.projects where name = 'Proiect C 509'),
  '50900000-0000-0000-0000-000000000003');
select public.archive_project((select id from public.projects where name = 'Proiect C 509'));
reset role;

select is(
  (select format('%s|%s',
                 grp.status,
                 (select count(*) from public.group_members as membership
                   where membership.group_id = grp.id
                     and membership.member_id = '50900000-0000-0000-0000-000000000003'))
     from public.groups as grp
     join public.projects as project on project.id = grp.legacy_project_id
    where project.name = 'Proiect C 509'),
  'archived|0',
  'remove_project_member drops the roster row, and archive_project carries the lifecycle onto the Group');

-- The leader swap. Mutation this catches: drop the leader-change branch from
-- private.mirror_project_group() and the new lead never becomes Group Manager
-- (the `project_members` row `projects_sync_leader_membership` writes for them
-- says `member`).
update public.projects
   set leader_id = '50900000-0000-0000-0000-000000000004'
 where name = 'Proiect C 509';

select is(
  (select string_agg(format('%s=%s', member.full_name, membership.group_role), ',' order by member.full_name)
     from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
     join public.projects as project on project.id = grp.legacy_project_id
     join public.profiles as member on member.id = membership.member_id
    where project.name = 'Proiect C 509'),
  'BC 509=member,Voluntar B 509=manager',
  'swapping the Project lead moves the Group Manager role with it and demotes the previous lead to ordinary membership');

delete from public.projects where name = 'Proiect C 509';

select is(
  (select count(*) from public.groups as grp where grp.category = 'project'
     and grp.name = 'Proiect C 509'),
  0::bigint,
  'and deleting the Project deletes its Group');

-- ==================== 7. member_departments (BC, authenticated) ====================
-- `member_departments_manage` is the one legacy roster table clients still
-- write directly, so every branch of the trigger is exercised from a real
-- BC session.

select pg_temp.test_login_leadership('50900000-0000-0000-0000-000000000001');
insert into public.member_departments (member_id, dept_id) values
  ('50900000-0000-0000-0000-000000000003', 'fin'),
  ('50900000-0000-0000-0000-000000000005', 'fin'),
  ('50900000-0000-0000-0000-000000000007', 'org');
reset role;

select is(
  (select membership.group_role from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where grp.legacy_dept_id = 'fin'
      and membership.member_id = '50900000-0000-0000-0000-000000000003'),
  'member',
  'a BC adding a member to a Department mirrors ordinary membership of its Group');

select is(
  (select membership.group_role from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where grp.legacy_dept_id = 'fin'
      and membership.member_id = '50900000-0000-0000-0000-000000000005'),
  'manager',
  'and a member of rank BCE lands as that Department Group''s Group Manager');

select is(
  (select count(*) from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where grp.legacy_dept_id = 'org'),
  0::bigint,
  'the Organization Group''s roster stays empty however many members join `org` — Automatic Membership derives it');

-- Mutation this catches: drop the `old`-scope call from
-- private.mirror_department_membership() and the `fin` row is left behind.
select pg_temp.test_login_leadership('50900000-0000-0000-0000-000000000001');
update public.member_departments set dept_id = 'hr'
 where member_id = '50900000-0000-0000-0000-000000000003' and dept_id = 'fin';
reset role;

select is(
  (select format('%s|%s',
                 (select count(*) from public.group_members as membership
                    join public.groups as grp on grp.id = membership.group_id
                   where grp.legacy_dept_id = 'fin'
                     and membership.member_id = '50900000-0000-0000-0000-000000000003'),
                 (select count(*) from public.group_members as membership
                    join public.groups as grp on grp.id = membership.group_id
                   where grp.legacy_dept_id = 'hr'
                     and membership.member_id = '50900000-0000-0000-0000-000000000003'))),
  '0|1',
  'moving a membership between Departments mirrors *both* scopes: the old Group''s roster row goes, the new one appears');

select pg_temp.test_login_leadership('50900000-0000-0000-0000-000000000001');
delete from public.member_departments
 where member_id = '50900000-0000-0000-0000-000000000003' and dept_id = 'hr';
reset role;

select is(
  (select count(*) from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where grp.legacy_dept_id = 'hr'
      and membership.member_id = '50900000-0000-0000-0000-000000000003'),
  0::bigint,
  'and removing the membership removes the roster row');

-- ==================== 8. profiles: rank BCE re-derives Group Roles ====================

update public.profiles set role = 'bce'
 where id = '50900000-0000-0000-0000-000000000006';

select is(
  (select string_agg(format('%s=%s', grp.legacy_dept_id, membership.group_role), ',' order by grp.legacy_dept_id)
     from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where membership.member_id = '50900000-0000-0000-0000-000000000006'),
  'fin=manager,hr=manager',
  'promoting a member to rank BCE makes them Group Manager of every Department Group they belong to');

update public.profiles set role = 'voluntar'
 where id = '50900000-0000-0000-0000-000000000006';

select is(
  (select string_agg(format('%s=%s', grp.legacy_dept_id, membership.group_role), ',' order by grp.legacy_dept_id)
     from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where membership.member_id = '50900000-0000-0000-0000-000000000006'),
  'fin=member,hr=member',
  'and demoting them hands every one of those Groups back to ordinary membership');

update public.profiles set role = 'bce'
 where id = '50900000-0000-0000-0000-000000000007';

select is(
  (select count(*) from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where grp.legacy_dept_id = 'org'),
  0::bigint,
  'promoting a member whose only Department is `org` still writes no Organization roster row');

-- The same promotion through the client path: `profiles_self_update` lets a
-- live BC change anyone's role as `authenticated`. Mutation this catches:
-- drop `security definer` from private.rederive_department_group_roles().
select pg_temp.test_login_leadership('50900000-0000-0000-0000-000000000001');
update public.profiles set role = 'bce'
 where id = '50900000-0000-0000-0000-000000000008';
reset role;

select is(
  (select membership.group_role from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where grp.legacy_dept_id = 'secretariat'
      and membership.member_id = '50900000-0000-0000-0000-000000000008'),
  'manager',
  'a BC promoting someone through profiles_self_update re-derives the Group Role too — the mirror never depends on who held the session');

-- ==================== 9. Fixpoint ====================
-- The one assertion that holds #508 and #509 to the same mapping: after every
-- write above, a full resync must change nothing at all. Mutation this
-- catches: any drift in what a trigger passes to a sync (a wrong scope, a
-- missing branch) — the resync then repairs it and the snapshot differs.

create temp table fx509 as
  select (select jsonb_agg(to_jsonb(grp) order by grp.id) from public.groups as grp) as groups_before,
         (select jsonb_agg(to_jsonb(membership) order by membership.group_id, membership.member_id)
            from public.group_members as membership) as members_before;

select private.sync_groups_from_legacy();

select is(
  (select jsonb_agg(to_jsonb(grp) order by grp.id) from public.groups as grp),
  (select fx.groups_before from pg_temp.fx509 as fx),
  'a full resync after every mirrored write leaves every Group byte-identical — the triggers already were the backfill');

select is(
  (select jsonb_agg(to_jsonb(membership) order by membership.group_id, membership.member_id)
     from public.group_members as membership),
  (select fx.members_before from pg_temp.fx509 as fx),
  'and every roster row too');

-- ==================== 10. Self-healing into a wiped mirror ====================
-- Five suites `truncate public.profiles cascade`, which cascades through
-- `groups.created_by` and empties the mirror outright. The very next mirrored
-- write has to rebuild what it needs. Mutation this catches: delete the
-- ensure-Group `perform` from private.sync_department_memberships.

truncate public.profiles cascade;

insert into public.profiles (id, full_name, email, role, status)
values ('50900000-0000-0000-0000-000000000003', 'Voluntar A 509',
        'voluntar.a.509@test.local', 'voluntar', 'activ');
insert into public.member_departments (member_id, dept_id)
values ('50900000-0000-0000-0000-000000000003', 'edu');

select is(
  (select format('%s|%s|%s', grp.name, grp.category, coalesce(grp.manager_title, '-'))
     from public.groups as grp where grp.legacy_dept_id = 'edu'),
  'Educațional|department|BCE',
  'one mirrored membership into an emptied mirror recreates the Department Group it needs');

select is(
  (select membership.group_role from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where grp.legacy_dept_id = 'edu'
      and membership.member_id = '50900000-0000-0000-0000-000000000003'),
  'member',
  'and writes the roster row into the Group it had to create first');

-- ==================== 11. Grants ====================
-- Trigger functions, category `trigger` in tracker_grants.test.sql: nobody may
-- call them, and `security definer` is what lets them write a table their
-- callers cannot.

select ok(
  not has_function_privilege('authenticated', 'private.mirror_team_group()', 'execute'),
  'authenticated cannot execute a mirror trigger function directly');
select ok(
  not has_function_privilege('service_role', 'private.rederive_department_group_roles()', 'execute'),
  'and neither can service_role — private is never reachable from outside the database');

select * from finish();
rollback;
