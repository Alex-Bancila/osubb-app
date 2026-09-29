-- #941 (R32 amended): when a Task's creator is not a live recipient, its manager
-- Notifications go to the Managers of the nearest Group on the Task's path -- its own
-- Group first, then each ancestor up to the root -- that has a live Manager below BC.
-- With no such Manager anywhere, the chain's live peer Responsibles (ruling D4); with
-- none of those either, nobody. BC members and the Moderator are never recipients
-- through Group management and never stop the walk (their roster rows do not count),
-- the membri de drept are never added, and the actor is never a recipient.
--
-- Mutation proof: rebuilding private.task_managers from 20260929200000 (the walk in
-- private.group_managers stopping at a BC/Moderator Manager, then filtered) turns the
-- "BC/Moderator never stop the walk" assertions red; confining the walk to the Task's
-- own Group turns the parent and grandparent assertions red.
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
select plan(12);

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

-- ==================== BC and the Moderator never stop the walk ====================

select set_eq(
  $$select * from private.task_managers(pg_temp.t941('C'), null)$$,
  $$values (pg_temp.u941(3))$$,
  'a parent managed only by a BC member and the Moderator does not end the walk: the grandparent''s Manager is notified, never BC or the Moderator (#941)');
select is(
  (select count(*) from private.task_managers(pg_temp.t941('C'), pg_temp.u941(3))),
  0::bigint,
  'the grandparent''s Manager as the actor is excluded, and BC/the Moderator do not take their place');
select set_eq(
  $$select * from private.task_managers(pg_temp.t941('E'), null)$$,
  $$values (pg_temp.u941(5)), (pg_temp.u941(8))$$,
  'with no Manager below BC anywhere on the path, the chain''s live peer Responsibles are notified -- the Moderator''s Manager row neither stops the walk nor is added, the BC Responsible is left out (#941, D4)');
select set_eq(
  $$select * from private.task_managers(pg_temp.t941('E'), pg_temp.u941(5))$$,
  $$values (pg_temp.u941(8))$$,
  'the acting peer Responsible is excluded from the peers');

-- ==================== nobody when no Group above has one ====================

select is(
  (select count(*) from private.task_managers(pg_temp.t941('D'), null)),
  0::bigint,
  'no live Manager or Responsible below BC up to the root notifies nobody -- the BC member managing the root is not added');
select is(
  (select count(*) from private.task_managers(pg_temp.t941('D'), pg_temp.u941(2))),
  0::bigint,
  'nor when the Moderator acts: BC and the Moderator are never the fallback');

-- ==================== the creator branch is unchanged ====================

update public.tasks set created_by = pg_temp.u941(7) where id = pg_temp.t941('C');
select set_eq(
  $$select * from private.task_managers(pg_temp.t941('C'), null)$$,
  $$values (pg_temp.u941(7))$$,
  'a live creator who is not the actor is the sole recipient');
select set_eq(
  $$select * from private.task_managers(pg_temp.t941('C'), pg_temp.u941(7))$$,
  $$values (pg_temp.u941(3))$$,
  'a creator acting on their own Task falls through to the nearest Manager above the BC-managed parent');
update public.tasks set created_by = pg_temp.u941(6) where id = pg_temp.t941('C');

-- ==================== never a membre de drept ====================

select is(
  (select count(*)
     from unnest(array['A', 'B', 'C', 'D', 'E']) as chain
    cross join unnest(array[null, pg_temp.u941(3), pg_temp.u941(4), pg_temp.u941(5)]) as actor
    cross join lateral private.task_managers(pg_temp.t941(chain), actor) as recipient
     join public.profiles as profile on profile.id = recipient
     join public.roles as role on role.id = profile.role
    where role.level >= 6),
  0::bigint,
  'no BC member or Moderator is a recipient of any of these Tasks, whoever acts');

select * from finish();
rollback;
