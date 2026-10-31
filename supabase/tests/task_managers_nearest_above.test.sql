-- #941 (R32 amended): when a Task's creator is not a live recipient, its manager
-- Notifications go to the Managers of the nearest Group on the Task's path -- its own
-- Group first, then each ancestor up to the root -- that has a live Manager (below BC until R42; never the Moderator).
-- With no such Manager anywhere, the chain's live peer Responsibles (ruling D4); with
-- none of those either, nobody. The Moderator is never a recipient through Group
-- management and never stops the walk (their roster rows do not count), the membri
-- de drept are never added, and the actor is never a recipient.
--
-- R42 (2026-10-07) amends #941 for BC: a BC member's Manager row is a live Manager
-- like anyone's -- it stops the walk and is notified -- and a BC Responsible is a peer.
--
-- Mutation proof: rebuilding private.task_managers from 20260929200000 (the walk in
-- private.group_managers stopping at a BC/Moderator Manager, then filtered) turns the
-- "the Moderator never stops the walk" assertions red; restoring #941's `level < 6`
-- turns the R42 "a BC Manager stops the walk" and "a BC peer Responsible" assertions
-- red; confining the walk to the Task's
-- own Group turns the parent and grandparent assertions red; skipping the Task's own
-- Group turns the own-Group assertion red. Dropping the `level <= 6` filter from
-- private.has_group_manager or private.group_managers (#1128) turns the "the
-- Moderator's Manager row is not a Manager" assertions red.
--
-- Personas (prefix 941):
--    1 bc        activ    Manager of Mid C and Root D; Responsible of Root E
--    2 moderator activ    Manager of Mid C and Leaf E
--    3 voluntar  activ    Manager of Root A, Root B and Root C
--    4 voluntar  activ    Manager of Mid A
--    5 voluntar  activ    Responsible of Leaf E
--    6 voluntar  inactiv  creator of every Task (never a live recipient)
--    7 voluntar  activ    a live creator for the unchanged creator branch
--    8 voluntar  activ    Responsible of Root E
--    9 voluntar  activ    plain member of Leaf A, Mid B and Leaf D
--   10 voluntar  inactiv  Manager of Mid A and Mid B (never live)
--
-- Chains (Root > Mid > Leaf, every Task in the Leaf):
--   A  Root A (3 M) > Mid A (4 M, 10 M inactive) > Leaf A (9)
--   B  Root B (3 M) > Mid B (9, 10 M inactive)   > Leaf B
--   C  Root C (3 M) > Mid C (1 BC M, 2 Mod M)    > Leaf C
--   D  Root D (1 BC M)                           > Leaf D (9)
--   E  Root E (8 R, 1 BC R)                      > Leaf E (5 R, 2 Mod M)
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(18);

create function pg_temp.u941(n integer) returns uuid language sql immutable as $$
  select ('94100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users(id, email)
select pg_temp.u941(n), 'managers.' || n || '.941@test.local' from generate_series(1, 10) n;
insert into public.profiles(id, full_name, email, role, status)
select pg_temp.u941(n), 'Managers #941 ' || n, 'managers.' || n || '.941@test.local',
       (case n when 1 then 'bc' when 2 then 'moderator' else 'voluntar' end)::public.member_role,
       (case when n in (6, 10) then 'inactiv' else 'activ' end)::public.member_status
  from generate_series(1, 10) n;

insert into public.groups(name, category, min_level)
select 'Root ' || chain || ' #941', 'department', 0 from unnest(array['A', 'B', 'C', 'D', 'E']) as chain;
insert into public.groups(name, category, parent_id, min_level)
select 'Mid ' || chain || ' #941', 'team', root.id, 0
  from unnest(array['A', 'B', 'C']) as chain
  join public.groups as root on root.name = 'Root ' || chain || ' #941';
insert into public.groups(name, category, parent_id, min_level)
select 'Leaf ' || chain || ' #941', 'team', parent.id, 0
  from unnest(array['A', 'B', 'C']) as chain
  join public.groups as parent on parent.name = 'Mid ' || chain || ' #941';
insert into public.groups(name, category, parent_id, min_level)
select 'Leaf ' || chain || ' #941', 'team', parent.id, 0
  from unnest(array['D', 'E']) as chain
  join public.groups as parent on parent.name = 'Root ' || chain || ' #941';

insert into public.group_members(group_id, member_id, group_role)
select grp.id, pg_temp.u941(roster.n), roster.role
  from (values ('Root A #941', 3, 'manager'), ('Mid A #941', 4, 'manager'), ('Mid A #941', 10, 'manager'),
               ('Leaf A #941', 9, 'member'),
               ('Root B #941', 3, 'manager'), ('Mid B #941', 9, 'member'), ('Mid B #941', 10, 'manager'),
               ('Root C #941', 3, 'manager'), ('Mid C #941', 1, 'manager'), ('Mid C #941', 2, 'manager'),
               ('Root D #941', 1, 'manager'), ('Leaf D #941', 9, 'member'),
               ('Root E #941', 8, 'responsible'), ('Root E #941', 1, 'responsible'),
               ('Leaf E #941', 5, 'responsible'), ('Leaf E #941', 2, 'manager')) as roster(name, n, role)
  join public.groups as grp on grp.name = roster.name;

insert into public.tasks(title, description, deadline, group_id, audience, assignment_mode, status, created_by)
select 'Task ' || chain || ' #941', 'x', '2027-05-01 09:00+00', grp.id, 'local', 'direct', 'todo', pg_temp.u941(6)
  from unnest(array['A', 'B', 'C', 'D', 'E']) as chain
  join public.groups as grp on grp.name = 'Leaf ' || chain || ' #941';

create function pg_temp.t941(p_chain text) returns bigint language sql stable as $$
  select id from public.tasks where title = 'Task ' || p_chain || ' #941'
$$;

-- ==================== the nearest Manager on the path ====================

select set_eq(
  $$select * from private.task_managers(pg_temp.t941('A'), null)$$,
  $$values (pg_temp.u941(4))$$,
  'a Group without leaders notifies its parent''s live Manager -- never the grandparent''s, never the parent''s inactive Manager');
select is(
  (select count(*) from private.task_managers(pg_temp.t941('A'), pg_temp.u941(4))),
  0::bigint,
  'the actor is never a recipient: the parent''s Manager acting on the Task is told nothing and still marks the parent as managed');
select set_eq(
  $$select * from private.task_managers(pg_temp.t941('B'), null)$$,
  $$values (pg_temp.u941(3))$$,
  'with no live Manager in the Group or its parent (only an inactive one), the grandparent''s Manager is notified');

update public.group_members set group_role = 'manager'
 where member_id = pg_temp.u941(9) and group_id = (select id from public.groups where name = 'Leaf A #941');
select set_eq(
  $$select * from private.task_managers(pg_temp.t941('A'), null)$$,
  $$values (pg_temp.u941(9))$$,
  'the Task''s own Group comes first: its live Manager is notified, never the parent''s or the grandparent''s');
update public.group_members set group_role = 'member'
 where member_id = pg_temp.u941(9) and group_id = (select id from public.groups where name = 'Leaf A #941');

-- ==================== a BC Manager stops the walk; the Moderator never ====================

select set_eq(
  $$select * from private.task_managers(pg_temp.t941('C'), null)$$,
  $$values (pg_temp.u941(1))$$,
  'a parent managed by a BC member and the Moderator ends the walk at the BC Manager, who is notified -- never the Moderator, never the grandparent (R42)');
select is(
  (select count(*) from private.task_managers(pg_temp.t941('C'), pg_temp.u941(1))),
  0::bigint,
  'the BC Manager as the actor is excluded and still marks the parent as managed: the grandparent''s Manager does not take their place');
select set_eq(
  $$select * from private.task_managers(pg_temp.t941('E'), null)$$,
  $$values (pg_temp.u941(1)), (pg_temp.u941(5)), (pg_temp.u941(8))$$,
  'with no Manager below the Moderator anywhere on the path, the chain''s live peer Responsibles are notified, the BC Responsible included (R42) -- the Moderator''s Manager row neither stops the walk nor is added (#941, D4)');
select set_eq(
  $$select * from private.task_managers(pg_temp.t941('E'), pg_temp.u941(5))$$,
  $$values (pg_temp.u941(1)), (pg_temp.u941(8))$$,
  'the acting peer Responsible is excluded from the peers');

-- ==================== a BC Manager of the root ====================

select set_eq(
  $$select * from private.task_managers(pg_temp.t941('D'), null)$$,
  $$values (pg_temp.u941(1))$$,
  'the BC member managing the root is the nearest live Manager above the Leaf, and is notified (R42)');
select set_eq(
  $$select * from private.task_managers(pg_temp.t941('D'), pg_temp.u941(2))$$,
  $$values (pg_temp.u941(1))$$,
  'the Moderator acting changes nothing and is never the fallback');

-- ==================== #1128: the Moderator's Manager row is not a Manager ====================
-- Audit finding M4: has_group_manager and group_managers counted any live Manager
-- row, task_managers only one below the Moderator. On chain E the Moderator holds
-- the only Manager row, so a Leaf E Responsible lost can_manage_task on a peer's
-- Task (a Manager "existed") while the notices still went to the peers. A
-- Moderator's position row is their Atribuție (R47), never a Manager for the peer
-- rule (D4); a BC member's (level 6) keeps counting, as in task_managers.

create function pg_temp.manages941(p_uid uuid, p_task bigint) returns boolean language plpgsql as $$
declare
  v_answer boolean;
begin
  perform pg_temp.test_login_leadership(p_uid);
  select public.can_manage_task(p_task) into v_answer;
  perform set_config('role', 'none', true);
  perform pg_temp.test_clear_jwt();
  return v_answer;
end;
$$;
create function pg_temp.managed941(p_uid uuid, p_task bigint) returns boolean language plpgsql as $$
declare
  v_answer boolean;
begin
  perform pg_temp.test_login_leadership(p_uid);
  select exists (select 1 from public.task_list(p_list => 'managed') as row where row.id = p_task) into v_answer;
  perform set_config('role', 'none', true);
  perform pg_temp.test_clear_jwt();
  return v_answer;
end;
$$;

-- Task E is executed by Root E's Responsible #8, a peer of the chain, so only the
-- "no Manager anywhere on the path" branch can let Leaf E's Responsible #5 manage it.
insert into public.task_assignments (task_id, member_id, assigned_by, assigned_at)
values (pg_temp.t941('E'), pg_temp.u941(8), pg_temp.u941(6), now());

select ok(
  not private.has_group_manager((select id from public.groups where name = 'Leaf E #941')),
  'has_group_manager: the Moderator''s Manager row on Leaf E is not a Manager -- the chain has none (#1128)');
select ok(
  private.has_group_manager((select id from public.groups where name = 'Leaf C #941')),
  'has_group_manager: a BC member''s Manager row on Mid C still counts for Leaf C (R42)');
select ok(
  pg_temp.manages941(pg_temp.u941(5), pg_temp.t941('E')),
  'a Leaf E Responsible manages a peer''s Task on the Manager-less chain although the Moderator holds a Manager row there (D4, #1128)');
select ok(
  pg_temp.managed941(pg_temp.u941(5), pg_temp.t941('E')),
  'and task_list(''managed'') lists it for them (task_list_scope reads the same helper)');
select set_eq(
  $$select manager from private.group_managers((select id from public.groups where name = 'Leaf E #941')) as manager
     where manager in (select pg_temp.u941(n) from generate_series(1, 10) n)$$,
  $$values (pg_temp.u941(1)), (pg_temp.u941(2)), (pg_temp.u941(5)), (pg_temp.u941(8))$$,
  'group_managers falls through to the peers: the chain''s live Responsibles plus BC and the Moderator as membri de drept -- never the Moderator''s Manager row alone (#1128)');

-- ==================== the creator branch is unchanged ====================

update public.tasks set created_by = pg_temp.u941(7) where id = pg_temp.t941('C');
select set_eq(
  $$select * from private.task_managers(pg_temp.t941('C'), null)$$,
  $$values (pg_temp.u941(7))$$,
  'a live creator who is not the actor is the sole recipient');
select set_eq(
  $$select * from private.task_managers(pg_temp.t941('C'), pg_temp.u941(7))$$,
  $$values (pg_temp.u941(1))$$,
  'a creator acting on their own Task falls through to the nearest Manager: the BC Manager of the parent (R42)');
update public.tasks set created_by = pg_temp.u941(6) where id = pg_temp.t941('C');

-- ==================== never a membre de drept ====================

select is(
  (select count(*)
     from unnest(array['A', 'B', 'C', 'D', 'E']) as chain
    cross join unnest(array[null, pg_temp.u941(3), pg_temp.u941(4), pg_temp.u941(5)]) as actor
    cross join lateral private.task_managers(pg_temp.t941(chain), actor) as recipient
     join public.profiles as profile on profile.id = recipient
     join public.roles as role on role.id = profile.role
    where role.level >= 6 and recipient <> pg_temp.u941(1)),
  0::bigint,
  'no Moderator and no BC member without a position here (a membre de drept) is a recipient of any of these Tasks, whoever acts');

select * from finish();
rollback;
