-- groups_backfill.test.sql — #508: the one-way conversion of the legacy
-- structure tables into the Group model (ADR-0009 Wave 1).
--
-- What this suite pins is the *mapping* and the *shape of the sync family*:
-- one Group per Department, Team and Project, the roster rules for each of
-- them, and the three properties #509's mirror triggers will lean on — the
-- syncs are key-scoped, self-healing (each ensures its own Group, and a Team
-- sync ensures the parent Department Group), and a fixpoint (a second resync
-- changes nothing at all, `updated_at` included).
--
-- Fixture prefix: 50800000-…  Every assertion is scoped to a reference row
-- (`edu`, `org`, the Department Team `it`) or to a `…508`/`b-…` fixture of
-- this suite, so the suite says the same thing with or without the demo seed,
-- and before or after #509's triggers exist: `private.sync_groups_from_legacy()`
-- creates the mirror today and is a no-op resync once the triggers do it first.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- ==================== Fixtures ====================
-- Scratch legacy rows, in the two Department kinds that map differently and
-- the two Team shapes that map differently.

insert into public.departments (id, name, short, color, kind) values
  ('b-dept',  'Departament B 508',  'BDP', '#101010', 'department'),
  ('b-coord', 'Coordonare B 508',   'BCO', '#202020', 'coordination');

insert into public.teams (id, name, dept_id, is_interne) values
  ('b-team-dept', 'Echipa de Departament B 508', 'b-dept', false),
  ('b-team-ind',  'Echipa Independentă B 508',   null,     true);

insert into auth.users (id, email) values
  ('50800000-0000-0000-0000-000000000001', 'bce.508@test.local'),
  ('50800000-0000-0000-0000-000000000002', 'voluntar.508@test.local'),
  ('50800000-0000-0000-0000-000000000003', 'bc.508@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('50800000-0000-0000-0000-000000000001', 'BCE 508',      'bce.508@test.local',      'bce',      'activ'),
  ('50800000-0000-0000-0000-000000000002', 'Voluntar 508', 'voluntar.508@test.local', 'voluntar', 'activ'),
  ('50800000-0000-0000-0000-000000000003', 'BC 508',       'bc.508@test.local',       'bc',       'activ');

insert into public.member_departments (member_id, dept_id) values
  ('50800000-0000-0000-0000-000000000001', 'b-dept'),
  ('50800000-0000-0000-0000-000000000002', 'b-dept'),
  -- The Organization pseudo-department: mirrored as a Group, never as a roster.
  ('50800000-0000-0000-0000-000000000003', 'org');

insert into public.team_members (team_id, member_id) values
  ('b-team-dept', '50800000-0000-0000-0000-000000000002'),
  ('b-team-ind',  '50800000-0000-0000-0000-000000000001');

insert into public.projects (name, status, leader_id, created_by, created_at) values
  ('B Active 508',   'active',
   '50800000-0000-0000-0000-000000000001',
   '50800000-0000-0000-0000-000000000003', '2026-01-02 10:00+00'),
  ('B Archived 508', 'archived',
   '50800000-0000-0000-0000-000000000002',
   '50800000-0000-0000-0000-000000000003', '2026-01-03 10:00+00');

-- `projects_sync_leader_membership` already wrote the leader in as an ordinary
-- `member`; the mapping must still call them the Group Manager.
insert into public.project_members (project_id, member_id, project_role)
select project.id, fixture.member_id, fixture.project_role
  from (values
    ('B Active 508', '50800000-0000-0000-0000-000000000002'::uuid, 'member'),
    ('B Active 508', '50800000-0000-0000-0000-000000000003'::uuid, 'responsible')
  ) as fixture (project_name, member_id, project_role)
  join public.projects as project on project.name = fixture.project_name;

-- The leader is unioned into the Project roster sync precisely so the mirror
-- never depends on `projects_sync_leader_membership` having run. Reproduce
-- that state exactly: a Project whose leader has no `project_members` row at
-- all, which is only reachable with that trigger off.
alter table public.projects disable trigger projects_sync_leader_membership;
insert into public.projects (name, status, leader_id, created_by) values
  ('B Fara Rand Lider 508', 'active',
   '50800000-0000-0000-0000-000000000002',
   '50800000-0000-0000-0000-000000000003');
alter table public.projects enable trigger projects_sync_leader_membership;

-- Before #509 this call *is* the mirror; after it, the triggers already wrote
-- every row above and this is a no-op resync. Every assertion below holds in
-- both worlds.
select private.sync_groups_from_legacy();

-- ==================== 1. Every Department is mirrored ====================

select is(
  (select count(*) from public.groups as grp where grp.legacy_dept_id is not null),
  (select count(*) from public.departments),
  'one Group per Department, and not one more — a Department left unmirrored is invisible to every Wave 2 helper');

-- ==================== 2-4. Department mapping ====================

select is(
  (select format('%s|%s|%s|%s|%s|%s|%s|%s|%s',
                 grp.category, grp.competes_in_cup::text, coalesce(grp.parent_id::text, '-'),
                 grp.min_level, grp.application_level, grp.accepts_applications::text,
                 grp.manager_title, grp.short, grp.color)
     from public.groups as grp where grp.legacy_dept_id = 'edu'),
  'department|true|-|0|1|false|BCE|EDU|#284C93',
  'a delivery Department maps to a top-level competing Group at Minimum Level 0, Application Level 1, Applications off, managed by a BCE, carrying its Brand Book short name and colour');

select is(
  (select format('%s|%s|%s', grp.category, grp.competes_in_cup::text, grp.manager_title)
     from public.groups as grp where grp.legacy_dept_id = 'b-coord'),
  'department|false|BCE',
  'a coordination structure (Diverse, Secretariat) is the same Department Group with the Cup switched off — ADR-0009 retires departments.kind, it does not replace it');

select is(
  (select format('%s|%s|%s|%s|%s|%s|%s',
                 grp.name, grp.category, grp.automatic_membership::text, grp.min_level,
                 grp.competes_in_cup::text, coalesce(grp.application_level::text, '-'),
                 coalesce(grp.manager_title, '-'))
     from public.groups as grp where grp.legacy_dept_id = 'org'),
  'OSUBB|organization|true|0|false|-|-',
  'the org pseudo-department becomes the Organization Group: Automatic Membership at Minimum Level 0, no Applications, no Group Manager title');

-- ==================== 5-6. Team mapping ====================

select is(
  (select format('%s|%s|%s|%s|%s',
                 grp.category, grp.shared_work_visibility::text, grp.counts_toward_parent_cup::text,
                 grp.manager_title, grp.competes_in_cup::text)
     from public.groups as grp where grp.legacy_team_id = 'it'),
  'team|true|true|Coordonator|false',
  'a Department Team becomes a Child Group with Shared Work Visibility on, counting toward its parent''s Cup, run by a Coordonator');

select is(
  (select grp.path from public.groups as grp where grp.legacy_team_id = 'it'),
  array[(select parent.id from public.groups as parent where parent.legacy_dept_id = 'diverse'),
        (select grp.id from public.groups as grp where grp.legacy_team_id = 'it')],
  'and it hangs under its own Department''s Group — the ancestor path is derived, never invented by the sync');

select is(
  (select format('%s|%s|%s|%s',
                 coalesce(grp.parent_id::text, '-'), grp.competes_in_cup::text,
                 grp.shared_work_visibility::text, coalesce(grp.manager_title, '-'))
     from public.groups as grp where grp.legacy_team_id = 'b-team-ind'),
  '-|false|true|-',
  'an Independent Team is a top-level Group with no Group Manager at all (ADR-0009 Group Roles) and no Cup of its own');

select is(
  (select grp.path from public.groups as grp where grp.legacy_team_id = 'b-team-ind'),
  array[(select grp.id from public.groups as grp where grp.legacy_team_id = 'b-team-ind')],
  'its path is its own id — nothing put it under a Department');

-- ==================== 7. Project mapping ====================

select is(
  (select format('%s|%s|%s|%s|%s',
                 grp.category, grp.status, grp.manager_title, grp.created_by,
                 to_char(grp.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI'))
     from public.groups as grp
     join public.projects as project on project.id = grp.legacy_project_id
    where project.name = 'B Active 508'),
  'project|active|Coordonator Principal|50800000-0000-0000-0000-000000000003|2026-01-02 10:00',
  'a Project becomes a Group run by a Coordonator Principal, carrying its own provenance rather than the migration''s clock');

select is(
  (select grp.status from public.groups as grp
     join public.projects as project on project.id = grp.legacy_project_id
    where project.name = 'B Archived 508'),
  'archived',
  'and its lifecycle is carried, not reset — an archived Project is an archived Group');

-- ==================== 8. Department rosters ====================

select is(
  (select membership.group_role from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where grp.legacy_dept_id = 'b-dept'
      and membership.member_id = '50800000-0000-0000-0000-000000000002'),
  'member',
  'a member_departments row becomes ordinary membership of the Department Group');

select is(
  (select membership.group_role from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where grp.legacy_dept_id = 'b-dept'
      and membership.member_id = '50800000-0000-0000-0000-000000000001'),
  'manager',
  'except for a BCE: the rank is the Department''s Group Manager, which is how Wave 2 keeps can_manage_origin''s local-BCE branch');

select is(
  (select count(*) from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where grp.legacy_dept_id = 'org'),
  0::bigint,
  'the Organization Group''s roster is never mirrored — Automatic Membership derives it, and a hand-written member row is refused outright');

-- ==================== 9. Team rosters ====================

select is(
  (select membership.group_role from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where grp.legacy_team_id = 'b-team-dept'
      and membership.member_id = '50800000-0000-0000-0000-000000000002'),
  'member',
  'a Department Team''s roster is ordinary membership — its Coordonator is appointed, not derived');

select is(
  (select membership.group_role from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where grp.legacy_team_id = 'b-team-ind'
      and membership.member_id = '50800000-0000-0000-0000-000000000001'),
  'responsible',
  'an Independent Team''s every member is a Group Responsible — that is exactly ADR-0007''s joint management, without a special case');

-- ==================== 10. Project rosters ====================

select is(
  (select string_agg(format('%s=%s', member.full_name, membership.group_role), ',' order by member.full_name)
     from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
     join public.projects as project on project.id = grp.legacy_project_id
     join public.profiles as member on member.id = membership.member_id
    where project.name = 'B Active 508'),
  'BC 508=responsible,BCE 508=manager,Voluntar 508=member',
  'a Project''s roles carry over, and the leader is its Group Manager even though project_members calls them an ordinary member');

select is(
  (select string_agg(format('%s=%s', member.full_name, membership.group_role), ',' order by member.full_name)
     from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
     join public.projects as project on project.id = grp.legacy_project_id
     join public.profiles as member on member.id = membership.member_id
    where project.name = 'B Fara Rand Lider 508'),
  'Voluntar 508=manager',
  'and a leader with no project_members row at all is still the Group Manager — the mirror never depends on projects_sync_leader_membership having run first');

-- ==================== 11. Re-parenting through the legacy table ====================
-- Moving a Team under a Department in the write master must move its Group and
-- re-derive its roster: the same people, a different Group Role.

update public.teams set dept_id = 'b-coord' where id = 'b-team-ind';
select private.sync_groups_from_legacy();

select is(
  (select parent.legacy_dept_id from public.groups as grp
     join public.groups as parent on parent.id = grp.parent_id
    where grp.legacy_team_id = 'b-team-ind'),
  'b-coord',
  're-parenting a Team in the legacy table re-parents its Group');

select is(
  (select grp.path from public.groups as grp where grp.legacy_team_id = 'b-team-ind'),
  array[(select parent.id from public.groups as parent where parent.legacy_dept_id = 'b-coord'),
        (select grp.id from public.groups as grp where grp.legacy_team_id = 'b-team-ind')],
  'and the invariant trigger recomputes the ancestor path for it');

select is(
  (select membership.group_role from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where grp.legacy_team_id = 'b-team-ind'
      and membership.member_id = '50800000-0000-0000-0000-000000000001'),
  'member',
  'the roster is re-derived, not patched: a Team that stops being Independent stops making every member a Group Responsible');

-- ==================== 12. Idempotency ====================
-- The fixpoint #509's row triggers depend on: a resync that changes nothing
-- must touch nothing, `updated_at` included. Mutation this catches: drop an
-- `is distinct from` guard from any `do update` (the row is rewritten and
-- groups_set_updated_at bumps it), or drop an `on conflict` clause entirely
-- (the insert raises instead).

create temp table fx508 as
  select (select jsonb_agg(to_jsonb(grp) order by grp.id) from public.groups as grp) as groups_before,
         (select jsonb_agg(to_jsonb(membership) order by membership.group_id, membership.member_id)
            from public.group_members as membership) as members_before;

select private.sync_groups_from_legacy();

select is(
  (select jsonb_agg(to_jsonb(grp) order by grp.id) from public.groups as grp),
  (select fx.groups_before from pg_temp.fx508 as fx),
  'a second full resync leaves every Group byte-identical, updated_at included');

select is(
  (select jsonb_agg(to_jsonb(membership) order by membership.group_id, membership.member_id)
     from public.group_members as membership),
  (select fx.members_before from pg_temp.fx508 as fx),
  'and every roster row too');

-- ==================== 13. Orphan cleanup ====================
-- A legacy row deleted while no mirror was watching. After #509 its trigger
-- has already removed the Group and this assertion still holds.

delete from public.team_members where team_id = 'b-team-ind';
delete from public.teams where id = 'b-team-ind';
select private.sync_groups_from_legacy();

select is(
  (select count(*) from public.groups as grp where grp.legacy_team_id = 'b-team-ind'),
  0::bigint,
  'a full resync drops the Group of a legacy row that no longer exists, before it rebuilds anything');

-- ==================== 14. Self-healing ====================
-- Four suites `truncate public.profiles cascade` and one truncates `projects`,
-- so #509's per-row triggers routinely fire into a wiped mirror. Every roster
-- sync therefore ensures its own Group first, and a Team sync ensures the
-- parent Department Group before it. Mutation this catches: delete the
-- ensure-parent `perform` from private.sync_team_groups.

truncate public.groups cascade;
select private.sync_team_memberships('b-team-dept');

select is(
  (select format('%s|%s', grp.legacy_team_id, parent.legacy_dept_id)
     from public.groups as grp
     join public.groups as parent on parent.id = grp.parent_id
    where grp.legacy_team_id = 'b-team-dept'),
  'b-team-dept|b-dept',
  'a single scoped Team roster sync recreates the Team''s Group *and* its parent Department Group');

select is(
  (select membership.group_role from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where grp.legacy_team_id = 'b-team-dept'
      and membership.member_id = '50800000-0000-0000-0000-000000000002'),
  'member',
  'and writes the roster row it was asked for, into the Group it had to create first');

-- ==================== 15. The whole-table Team sync heals parents too ====================
-- Review S1: the `left join` that finds a Team's parent Department Group yields
-- null rather than raising, so a whole-table Team sync against a wiped mirror
-- would silently produce *top-level* Department Teams — a wrong row, with no
-- error anywhere. #509 consumes this function directly, so the null path carries
-- the same self-heal as the scoped one. Mutation this catches: delete the `else
-- perform private.sync_department_groups();` branch from private.sync_team_groups.

truncate public.groups cascade;
select private.sync_team_groups();

select is(
  (select grp.path from public.groups as grp where grp.legacy_team_id = 'b-team-dept'),
  array[(select parent.id from public.groups as parent where parent.legacy_dept_id = 'b-dept'),
        (select grp.id from public.groups as grp where grp.legacy_team_id = 'b-team-dept')],
  'a whole-table Team sync into an empty mirror still lands each Department Team under its own Department Group, two deep');

-- ==================== 16. The resync survives a dissolved Department ====================
-- Review S2: `groups.parent_id` is ON DELETE NO ACTION, so sweeping an orphaned
-- Department Group while a Team Group still names it as parent aborts the whole
-- repair with 23503. The resync therefore re-parents before it sweeps. Mutation
-- this catches: move `perform private.sync_team_groups();` back after the sweep.
-- (`b-dept` is referenced only by these two roster rows and the Team below —
-- no Campaign, Task, Event or Announcement fixture names it.)

delete from public.member_departments where dept_id = 'b-dept';
update public.teams set dept_id = null where id = 'b-team-dept';
delete from public.departments where id = 'b-dept';

select lives_ok(
  $$ select private.sync_groups_from_legacy() $$,
  'a Department dissolved out from under its Team is repaired, not refused: the Team Group is re-parented before the orphan sweep reaches its old parent');

select is(
  (select format('%s|%s|%s',
                 (select count(*) from public.groups as grp where grp.legacy_dept_id = 'b-dept'),
                 coalesce((select grp.parent_id::text from public.groups as grp
                            where grp.legacy_team_id = 'b-team-dept'), '-'),
                 (select membership.group_role from public.group_members as membership
                    join public.groups as grp on grp.id = membership.group_id
                   where grp.legacy_team_id = 'b-team-dept'
                     and membership.member_id = '50800000-0000-0000-0000-000000000002'))),
  '0|-|responsible',
  'and the repair is complete: the orphaned Department Group is gone, its Team is top-level, and its roster is re-derived as an Independent Team''s');

-- ==================== 17. Grants ====================
-- Category `none` (tracker_grants.test.sql): the migration and #509's triggers
-- run as the table owner, so nobody else may ever reach the sync family.

select ok(
  to_regprocedure('private.sync_groups_from_legacy()') is not null,
  'the full resync exists as a callable entry point for #509 and for a staging re-run');

select ok(
  not has_function_privilege('authenticated', 'private.sync_groups_from_legacy()', 'execute'),
  'authenticated cannot execute it — the mirror is not a client-callable command');

select ok(
  not has_function_privilege('service_role', 'private.sync_groups_from_legacy()', 'execute'),
  'and neither can service_role: private is never reachable from outside the database');

select * from finish();
rollback;
