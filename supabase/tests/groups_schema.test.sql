-- groups_schema.test.sql — #507: the Group model's two Wave 1 tables
-- (ADR-0009). `groups` and `group_members` are read-only shadows: the
-- migration inserts no rows, #508 backfills them and #509 mirrors the legacy
-- tables into them. What this suite pins is therefore the *shape* and the
-- *rules* — the settings vocabulary, the ancestor path and its cascade, the
-- hierarchy invariants, the Group Role vocabulary, the two read policies, and
-- the select-only grant posture — not any data.
--
-- Fixture prefix: 50700000-…  Policy fixtures are the four Groups whose names
-- end in `#507p`; every count in the policy section is scoped to them, because
-- the constraint and hierarchy sections above leave their own Groups behind in
-- the same transaction.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(63);

-- ==================== 1. Shape ====================

select has_table('public', 'groups',
  'groups exists — one entity for Departments, Teams, Projects and the AG (ADR-0009)');
select has_table('public', 'group_members',
  'group_members exists — the explicit roster with its Group Role');
select col_type_is('public', 'groups', 'path', 'bigint[]',
  'the ancestor path is a bigint array, so authority helpers read it instead of recursing');
select has_index('public', 'groups', 'groups_path_idx',
  'the path is GIN-indexed — subtree lookups are containment queries, not recursion');
select has_index('public', 'group_members', 'group_members_member_idx',
  'a Member''s own Groups are indexed (member_id, group_id)');
select has_index('public', 'groups', 'groups_one_organization_uidx',
  'the Organization marker is indexed — "exactly one" is a table-level fact no CHECK can state');

-- ==================== Profiles used by every later section ====================

insert into auth.users (id, email) values
  ('50700000-0000-0000-0000-000000000001', 'recrut.507@test.local'),
  ('50700000-0000-0000-0000-000000000002', 'vot.507@test.local'),
  ('50700000-0000-0000-0000-000000000003', 'bce.507@test.local'),
  ('50700000-0000-0000-0000-000000000004', 'bc.507@test.local'),
  ('50700000-0000-0000-0000-000000000005', 'bc.inactiv.507@test.local'),
  ('50700000-0000-0000-0000-000000000006', 'membru.b.507@test.local'),
  ('50700000-0000-0000-0000-000000000007', 'manager.a.507@test.local'),
  ('50700000-0000-0000-0000-000000000008', 'responsabil.a.507@test.local'),
  ('50700000-0000-0000-0000-000000000009', 'manager.d.507@test.local'),
  ('50700000-0000-0000-0000-000000000010', 'manager.a.inactiv.507@test.local'),
  ('50700000-0000-0000-0000-000000000011', 'fara.claims.507@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('50700000-0000-0000-0000-000000000001', 'Recrut 507', 'recrut.507@test.local', 'recrut', 'activ'),
  ('50700000-0000-0000-0000-000000000002', 'Vot 507', 'vot.507@test.local', 'vot', 'activ'),
  ('50700000-0000-0000-0000-000000000003', 'BCE 507', 'bce.507@test.local', 'bce', 'activ'),
  ('50700000-0000-0000-0000-000000000004', 'BC 507', 'bc.507@test.local', 'bc', 'activ'),
  ('50700000-0000-0000-0000-000000000005', 'BC Inactiv 507', 'bc.inactiv.507@test.local', 'bc', 'inactiv'),
  ('50700000-0000-0000-0000-000000000006', 'Membru B 507', 'membru.b.507@test.local', 'vot', 'activ'),
  ('50700000-0000-0000-0000-000000000007', 'Manager A 507', 'manager.a.507@test.local', 'voluntar', 'activ'),
  ('50700000-0000-0000-0000-000000000008', 'Responsabil A 507', 'responsabil.a.507@test.local', 'voluntar', 'activ'),
  ('50700000-0000-0000-0000-000000000009', 'Manager D 507', 'manager.d.507@test.local', 'voluntar', 'activ'),
  ('50700000-0000-0000-0000-000000000010', 'Manager A Inactiv 507', 'manager.a.inactiv.507@test.local', 'voluntar', 'inactiv'),
  ('50700000-0000-0000-0000-000000000011', 'Fara Claims 507', 'fara.claims.507@test.local', 'voluntar', 'activ');

-- ==================== 2. Constraints ====================
-- Every negative insert below violates exactly one constraint, and every
-- throws_ok names it (conventions section 8, Ruling 23): Postgres evaluates
-- CHECK constraints in name order, so a null expectation here would silently
-- migrate onto whichever constraint a later migration happens to sort first.

insert into public.groups (name, category) values ('Constrangeri #507', 'department');

select throws_ok($$ insert into public.groups (name, category)
    values (E' \t\n ', 'team') $$,
  '23514', 'new row for relation "groups" violates check constraint "groups_name_ck"',
  'a whitespace-only Group name is rejected — the POSIX class catches tabs and newlines btrim() would miss');

select throws_ok($$ insert into public.groups (name, category)
    values ('Club #507', 'club') $$,
  '23514', 'new row for relation "groups" violates check constraint "groups_category_ck"',
  'the presentation category vocabulary is closed to department/project/team/organization');

select throws_ok($$ insert into public.groups (name, category, parent_id, competes_in_cup)
    values ('Copil care concureaza #507', 'team',
            (select grp.id from public.groups as grp where grp.name = 'Constrangeri #507'), true) $$,
  '23514', 'new row for relation "groups" violates check constraint "groups_competes_top_level_ck"',
  'only a top-level Group competes in the Department Cup (ADR-0009)');

select throws_ok($$ insert into public.groups (name, category, min_level)
    values ('Nivel Patru #507', 'team', 4) $$,
  '23514', 'new row for relation "groups" violates check constraint "groups_min_level_ck"',
  'level 4 is retired, so it is not a Minimum Level a Group can take');

select throws_ok($$ insert into public.groups (name, category, min_level, application_level)
    values ('Aplicare Sub Minim #507', 'team', 3, 0) $$,
  '23514', 'new row for relation "groups" violates check constraint "groups_application_level_ck"',
  'the Application Level never sits below the Minimum Level');

select throws_ok($$ insert into public.groups (name, category, accepts_applications)
    values ('Aplicari Fara Nivel #507', 'team', true) $$,
  '23514', 'new row for relation "groups" violates check constraint "groups_applications_shape_ck"',
  'a Group that accepts Applications must say at which level');

select throws_ok($$ insert into public.groups
      (name, category, automatic_membership, accepts_applications, application_level)
    values ('Automat Care Aplica #507', 'team', true, true, 0) $$,
  '23514', 'new row for relation "groups" violates check constraint "groups_automatic_no_applications_ck"',
  'Automatic Membership and Applications are mutually exclusive — the roster follows the Role');

select throws_ok($$ insert into public.groups (name, category, status)
    values ('Ciorna #507', 'team', 'draft') $$,
  '23514', 'new row for relation "groups" violates check constraint "groups_status_ck"',
  'the lifecycle vocabulary is active/archived — archiving keeps history, nothing else exists');

select throws_ok($$ insert into public.groups (name, category, legacy_dept_id, legacy_team_id)
    values ('Doua Origini #507', 'team', 'edu-507', 't-507') $$,
  '23514', 'new row for relation "groups" violates check constraint "groups_legacy_one_ck"',
  'a shadow row names at most one legacy table as its write master');

select throws_ok($$ insert into public.group_members (group_id, member_id, group_role)
    values ((select grp.id from public.groups as grp where grp.name = 'Constrangeri #507'),
            '50700000-0000-0000-0000-000000000001', 'lead') $$,
  '23514', 'new row for relation "group_members" violates check constraint "group_members_role_ck"',
  'the Group Role vocabulary is manager/responsible/member — every Group has the same three positions');

insert into public.groups (name, category) values ('Echipa X #507', 'team');
select throws_ok($$ insert into public.groups (name, category)
    values ('echipa x #507', 'team') $$,
  '23505', 'duplicate key value violates unique constraint "groups_parent_name_uidx"',
  'two native sibling Groups cannot share a name, case-insensitively');

-- Deviation 1 (plan): the sibling-name index is PARTIAL — native Groups only —
-- because the legacy Departments, Teams and Projects it will shadow are not
-- yet deduplicated. Delete this assertion when Wave 3 makes the index total.
select lives_ok($$ insert into public.groups (name, category, legacy_team_id) values
    ('Echipa Y #507', 'team', 't-507-a'),
    ('echipa y #507', 'team', 't-507-b') $$,
  'the sibling-name rule binds native Groups only: two mirrored rows may still share a legacy name');

-- The Organization marker (Wave 3 T1, ADR-0009 R1). The reference Organization
-- Group — the one the backfill marked — is already in this database, so the row
-- below is the *second* marker and the index is what refuses it. Mutation this
-- catches: drop groups_one_organization_uidx and the insert succeeds.
select throws_ok($$ insert into public.groups (name, category, is_organization)
    values ('A Doua Organizatie #507', 'organization', true) $$,
  '23505', 'duplicate key value violates unique constraint "groups_one_organization_uidx"',
  'at most one Group is the Organization — a second marked Group is refused');

-- The index is PARTIAL, and the column defaults to false. Mutation this catches:
-- drop the `where is_organization` clause and these two unmarked Groups collide
-- with each other and with every other Group in the table.
select lives_ok($$ insert into public.groups (name, category) values
    ('Fara Marcaj A #507', 'team'),
    ('Fara Marcaj B #507', 'team') $$,
  'while unmarked Groups are unconstrained: the marker defaults to false and the index covers only the true row');

-- ==================== 3. Path and hierarchy ====================

insert into public.groups (name, category) values ('Radacina #507', 'department');
insert into public.groups (name, category, parent_id)
  values ('Copil #507', 'team',
          (select grp.id from public.groups as grp where grp.name = 'Radacina #507'));
insert into public.groups (name, category, parent_id)
  values ('Nepot #507', 'team',
          (select grp.id from public.groups as grp where grp.name = 'Copil #507'));
insert into public.groups (name, category) values ('A Doua Radacina #507', 'department');

select is(
  (select grp.path from public.groups as grp where grp.name = 'Radacina #507'),
  array[(select grp.id from public.groups as grp where grp.name = 'Radacina #507')],
  'a root Group''s path is its own id');
select is(
  (select grp.path from public.groups as grp where grp.name = 'Copil #507'),
  array[(select grp.id from public.groups as grp where grp.name = 'Radacina #507'),
        (select grp.id from public.groups as grp where grp.name = 'Copil #507')],
  'a Child Group''s path is root-first and ends in its own id');
select is(
  (select grp.path from public.groups as grp where grp.name = 'Nepot #507'),
  array[(select grp.id from public.groups as grp where grp.name = 'Radacina #507'),
        (select grp.id from public.groups as grp where grp.name = 'Copil #507'),
        (select grp.id from public.groups as grp where grp.name = 'Nepot #507')],
  'Groups nest to any depth: a grandchild carries all three ancestors');

select throws_ok($$ update public.groups
    set parent_id = (select grp.id from public.groups as grp where grp.name = 'Nepot #507')
  where name = 'Radacina #507' $$,
  '23514', 'group_cycle',
  'a Group cannot be re-parented under its own descendant');
select throws_ok($$ update public.groups
    set parent_id = (select grp.id from public.groups as grp where grp.name = 'Radacina #507')
  where name = 'Radacina #507' $$,
  '23514', 'group_cycle',
  'nor under itself');
select throws_ok($$ insert into public.groups (name, category, parent_id)
    values ('Orfan #507', 'team', 999999) $$,
  '23514', 'group_parent_not_found',
  'the parent lookup answers before the deferred foreign key would, with the reason that explains it');

insert into public.groups (name, category, min_level) values ('Nivel Radacina #507', 'department', 0);
insert into public.groups (name, category, parent_id, min_level)
  values ('Nivel Copil #507', 'team',
          (select grp.id from public.groups as grp where grp.name = 'Nivel Radacina #507'), 3);

select throws_ok($$ insert into public.groups (name, category, parent_id, min_level)
    values ('Nivel Nepot #507', 'team',
            (select grp.id from public.groups as grp where grp.name = 'Nivel Copil #507'), 0) $$,
  '23514', 'group_min_level_below_parent',
  'a Child Group''s Minimum Level is at least its parent''s (ADR-0009 Minimum Level)');
select throws_ok($$ update public.groups set min_level = 5
  where name = 'Nivel Radacina #507' $$,
  '23514', 'group_min_level_above_children',
  'and raising a parent above an existing child is refused rather than silently orphaning it');

-- Moving a subtree rewrites every descendant's path. Mutation this catches:
-- drop the groups_cascade_path trigger and the grandchild keeps the old root.
update public.groups
   set parent_id = (select grp.id from public.groups as grp where grp.name = 'A Doua Radacina #507')
 where name = 'Copil #507';
select is(
  (select grp.path from public.groups as grp where grp.name = 'Nepot #507'),
  array[(select grp.id from public.groups as grp where grp.name = 'A Doua Radacina #507'),
        (select grp.id from public.groups as grp where grp.name = 'Copil #507'),
        (select grp.id from public.groups as grp where grp.name = 'Nepot #507')],
  'moving a subtree cascades the new prefix onto every descendant''s path');

update public.groups set parent_id = null where name = 'Nepot #507';
select is(
  (select grp.path from public.groups as grp where grp.name = 'Nepot #507'),
  array[(select grp.id from public.groups as grp where grp.name = 'Nepot #507')],
  're-rooting a Child Group truncates its path to its own id');

-- Mutation this catches: drop the groups_set_updated_at trigger.
update public.groups set name = 'Radacina redenumita #507' where name = 'Radacina #507';
select ok(
  (select grp.updated_at > grp.created_at from public.groups as grp
    where grp.name = 'Radacina redenumita #507'),
  'updated_at is server-maintained by the shared private.set_updated_at() trigger');

-- ==================== 4. Automatic Membership ====================

insert into public.groups (name, category, automatic_membership)
  values ('Automat #507', 'organization', true);
insert into public.groups (name, category) values ('Manual #507', 'team');

select throws_ok($$ insert into public.group_members (group_id, member_id, group_role)
    values ((select grp.id from public.groups as grp where grp.name = 'Automat #507'),
            '50700000-0000-0000-0000-000000000001', 'member') $$,
  '23514', 'automatic_group_has_no_roster_members',
  'an Automatic-Membership Group''s roster is never edited by hand — the Role decides it');
select lives_ok($$ insert into public.group_members (group_id, member_id, group_role)
    values ((select grp.id from public.groups as grp where grp.name = 'Automat #507'),
            '50700000-0000-0000-0000-000000000002', 'manager') $$,
  'but it still holds its explicit Group Managers and Responsibles');

insert into public.group_members (group_id, member_id, group_role)
  values ((select grp.id from public.groups as grp where grp.name = 'Manual #507'),
          '50700000-0000-0000-0000-000000000001', 'member');
select throws_ok($$ update public.groups set automatic_membership = true
  where name = 'Manual #507' $$,
  '23514', 'automatic_group_has_no_roster_members',
  'and the flag cannot be flipped on over a roster that already holds ordinary members');

select throws_ok($$ update public.group_members
     set member_id = '50700000-0000-0000-0000-000000000001'
   where group_id = (select grp.id from public.groups as grp where grp.name = 'Automat #507')
     and member_id = '50700000-0000-0000-0000-000000000002' $$,
  '23514', 'group_membership_identity_immutable',
  'membership identity is immutable: moving a Member between Groups is a delete plus an insert');

-- ==================== 5. Read policies ====================
-- A: active root, Minimum Level 0.       B: Child of A, Minimum Level 3.
-- C: archived root.                      D: active root, Minimum Level 9.

insert into public.groups (name, category, min_level) values ('Grup A #507p', 'department', 0);
insert into public.groups (name, category, parent_id, min_level)
  values ('Grup B #507p', 'team',
          (select grp.id from public.groups as grp where grp.name = 'Grup A #507p'), 3);
insert into public.groups (name, category, status) values ('Grup C #507p', 'project', 'archived');
insert into public.groups (name, category, min_level) values ('Grup D #507p', 'team', 9);

insert into public.group_members (group_id, member_id, group_role)
select grp.id, roster.member_id, roster.group_role
  from (values
    ('Grup A #507p', '50700000-0000-0000-0000-000000000007'::uuid, 'manager'),
    ('Grup A #507p', '50700000-0000-0000-0000-000000000008'::uuid, 'responsible'),
    ('Grup A #507p', '50700000-0000-0000-0000-000000000010'::uuid, 'manager'),
    ('Grup A #507p', '50700000-0000-0000-0000-000000000011'::uuid, 'member'),
    ('Grup B #507p', '50700000-0000-0000-0000-000000000006'::uuid, 'member'),
    ('Grup D #507p', '50700000-0000-0000-0000-000000000009'::uuid, 'manager')
  ) as roster(group_name, member_id, group_role)
  join public.groups as grp on grp.name = roster.group_name;

-- Ids captured while the owner can still see them: a persona that cannot read
-- `groups` must still be asked about `group_members` rows of a named Group,
-- and a join through `groups` would hide them for the wrong reason.
create temp table fx507 as
  select (select grp.id from public.groups as grp where grp.name = 'Grup B #507p') as group_b,
         (select array_agg(grp.id) from public.groups as grp where grp.name like '%#507p') as policy_groups;
grant select on fx507 to authenticated;

-- ---- No JWT at all ----
select pg_temp.test_clear_jwt();
set local role authenticated;
select is((select count(*) from public.groups), 0::bigint,
  'claimless: no Group is readable at all');
select is((select count(*) from public.group_members), 0::bigint,
  'claimless: no roster row is readable at all');
reset role;

-- ---- anon ----
set local role anon;
select throws_ok($$ select count(*) from public.groups $$,
  '42501', null, 'anon holds no grant on groups (invite-only, ADR-0003)');
select throws_ok($$ select count(*) from public.group_members $$,
  '42501', null, 'anon holds no grant on group_members either');
reset role;

-- ---- A live ACTIVE Member whose JWT carries no organization claims ----
-- This is the persona that makes auth_is_member() load-bearing (house rule
-- 12). A claimless *deactivated* session is already denied by caller_level()'s
-- -1, so it would keep passing with the membership predicate deleted; this one
-- would not: their level is 1 and they own a roster row.
select pg_temp.test_login('50700000-0000-0000-0000-000000000011',
  jsonb_build_object('provider', 'email'));
select is((select count(*) from public.groups), 0::bigint,
  'an active Member without organization claims reads no Group — auth_is_member() is the gate, not the level');
select is((select count(*) from public.group_members), 0::bigint,
  'nor their own roster row');
reset role;

-- ---- Deactivated, with stale BC claims still in the JWT ----
select pg_temp.test_login('50700000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select count(*) from public.groups), 0::bigint,
  'a deactivated BC''s stale claims read nothing: the policy asks private.caller_level(), not the JWT');
reset role;

-- ---- Recrut (0) ----
select pg_temp.test_login('50700000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'recrut', 'member_level', 0, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is(
  (select array_agg(grp.name order by grp.name) from public.groups as grp where grp.name like '%#507p'),
  array['Grup A #507p'],
  'a Recrut sees only the active Group whose Minimum Level admits them');
reset role;

-- ---- Voluntar cu Drept de Vot (3) ----
select pg_temp.test_login('50700000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'vot', 'member_level', 3, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is(
  (select array_agg(grp.name order by grp.name) from public.groups as grp where grp.name like '%#507p'),
  array['Grup A #507p', 'Grup B #507p'],
  'level 3 additionally sees the Child Group at Minimum Level 3, but neither the archived nor the level-9 Group');
reset role;

-- ---- BCE (5): reads everything by rank ----
select pg_temp.test_login('50700000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is(
  (select array_agg(grp.name order by grp.name) from public.groups as grp where grp.name like '%#507p'),
  array['Grup A #507p', 'Grup B #507p', 'Grup C #507p', 'Grup D #507p'],
  'rank BCE reads every Group, archived and above their own level included (ADR-0009 Authority)');
select is(
  (select count(*) from public.group_members as membership
    where membership.group_id in (select unnest(fx.policy_groups) from pg_temp.fx507 as fx)),
  6::bigint,
  'and every roster row of those Groups');
reset role;

-- ---- BC (6) ----
select pg_temp.test_login('50700000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is(
  (select array_agg(grp.name order by grp.name) from public.groups as grp where grp.name like '%#507p'),
  array['Grup A #507p', 'Grup B #507p', 'Grup C #507p', 'Grup D #507p'],
  'BC reads every Group too');
reset role;

-- ---- Authority flows down the chain, and only authority does ----
-- A Group Manager or Responsible of an ancestor sees the Group they hold
-- authority over even when their rank sits below its Minimum Level; otherwise
-- groups_read and group_members_read would disagree about the same authority
-- and every roster join would drop the rows the roster policy just allowed.
-- Mutation this catches: delete `or private.can_read_group_roster(id)`.
select pg_temp.test_login('50700000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is(
  (select array_agg(grp.name order by grp.name) from public.groups as grp where grp.name like '%#507p'),
  array['Grup A #507p', 'Grup B #507p'],
  'a level-1 Group Manager of the root reads the Child Group whose Minimum Level is above their rank');
reset role;

-- The same rank and the same Group, without the Group Role: the override is
-- authority, never mere membership.
select pg_temp.test_login('50700000-0000-0000-0000-000000000011', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is(
  (select array_agg(grp.name order by grp.name) from public.groups as grp where grp.name like '%#507p'),
  array['Grup A #507p'],
  'an ordinary level-1 member of that same root does not — the Minimum Level still gates them');
reset role;

-- ---- An ordinary member of B ----
select pg_temp.test_login('50700000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'vot', 'member_level', 3, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is(
  (select count(*) from public.group_members as membership
    where membership.group_id in (select unnest(fx.policy_groups) from pg_temp.fx507 as fx)),
  1::bigint,
  'an ordinary member reads exactly one roster row — their own');
reset role;

-- ---- A Group Manager of the ANCESTOR ----
-- Authority flows down the whole chain, so this is read through groups.path.
-- Mutation this catches: `held.group_id = any (target.path)` narrowed to
-- `= target.id`. Both personas are Voluntari: the authority is the Group Role,
-- never the rank.
select pg_temp.test_login('50700000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is(
  (select count(*) from public.group_members as membership
    where membership.group_id = (select fx.group_b from pg_temp.fx507 as fx)),
  1::bigint,
  'a Group Manager of an ancestor reads the descendant Group''s roster');
reset role;

select pg_temp.test_login('50700000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is(
  (select count(*) from public.group_members as membership
    where membership.group_id = (select fx.group_b from pg_temp.fx507 as fx)),
  1::bigint,
  'and so does a Group Responsible of that ancestor');
reset role;

-- ---- A Group Manager of an unrelated root ----
select pg_temp.test_login('50700000-0000-0000-0000-000000000009', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is(
  (select count(*) from public.group_members as membership
    where membership.group_id = (select fx.group_b from pg_temp.fx507 as fx)),
  0::bigint,
  'a Group Manager of an unrelated root reads nothing of it — the path, not the role name, is the boundary');
reset role;

-- ---- A deactivated Group Manager whose claims are still valid-looking ----
-- Mutation this catches: `private.actor_level() is not null` dropped from
-- private.can_read_group_roster.
select pg_temp.test_login('50700000-0000-0000-0000-000000000010', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select is(
  (select count(*) from public.group_members as membership
    where membership.group_id in (select unnest(fx.policy_groups) from pg_temp.fx507 as fx)),
  0::bigint,
  'a deactivated Group Manager reads no roster row, including the one naming them');
reset role;

-- ==================== 6. Grants ====================
-- Both tables are read-only for every client role: #509's mirror triggers run
-- as the table owner, and there is no Group command in Wave 1 at all.

select pg_temp.test_login('50700000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));

select throws_ok($$ insert into public.groups (name, category)
    values ('Grup scris direct #507', 'team') $$,
  '42501', 'permission denied for table groups',
  'a BC with live claims cannot INSERT a Group directly');
select throws_ok($$ update public.groups set name = 'Grup redenumit direct #507'
  where name = 'Grup A #507p' $$,
  '42501', 'permission denied for table groups',
  'nor UPDATE one');
select throws_ok($$ delete from public.groups where name = 'Grup A #507p' $$,
  '42501', 'permission denied for table groups',
  'nor DELETE one');
select throws_ok($$ insert into public.group_members (group_id, member_id, group_role)
    values ((select fx.group_b from pg_temp.fx507 as fx),
            '50700000-0000-0000-0000-000000000004', 'manager') $$,
  '42501', 'permission denied for table group_members',
  'and the same BC cannot INSERT a roster row');
select throws_ok($$ update public.group_members set group_role = 'manager'
  where group_id = (select fx.group_b from pg_temp.fx507 as fx) $$,
  '42501', 'permission denied for table group_members',
  'nor UPDATE one');
select throws_ok($$ delete from public.group_members
  where group_id = (select fx.group_b from pg_temp.fx507 as fx) $$,
  '42501', 'permission denied for table group_members',
  'nor DELETE one');

reset role;

select ok(
  has_function_privilege('authenticated', 'private.can_read_group_roster(bigint)', 'execute'),
  'the roster predicate stays executable by authenticated — it is evaluated inside an RLS policy');
select ok(
  not has_function_privilege('authenticated', 'private.validate_group_hierarchy()', 'execute'),
  'the hierarchy trigger function is executable by nobody, authenticated included');
select ok(
  not has_sequence_privilege('authenticated', 'public.groups_id_seq', 'usage'),
  'no client role may draw a Group id: the identity sequence is the mirror''s alone');

select * from finish();
rollback;
