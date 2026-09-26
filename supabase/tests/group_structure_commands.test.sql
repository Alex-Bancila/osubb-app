-- #582: the four Group structure commands and the Manager tier of the authority kit.
--
-- Organised by command, and inside each command in the order the
-- implementation answers: malformed input first (for everyone, claimless
-- callers included), then authority, then state. Decision 5's structural /
-- operational split gets a pair of assertions in each update command --
-- update_group refusing a ROOT's Minimum Level below level 6, and
-- update_group_structure refusing a CHILD's outright -- because those two are
-- the whole reason there are two commands.
--
-- Two Group trees keep the concerns apart. Tree A ("Rădăcină #582") never
-- moves its Minimum Level and carries the authority and full-state cases; tree
-- B ("Nivel #582") is the one whose Minimum Level is raised over its roster.
--
-- Fixture Groups are inserted directly (conventions OD9: owner-run, rolled
-- back). They are native Groups -- no legacy_* -- so the partial sibling-name
-- index behaves as it will after #591 for every name this file uses.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(87);

-- ==================== Fixtures ====================

create function pg_temp.g582_uid(n integer) returns uuid language sql immutable as $$
  select ('58200000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users (id, email)
select pg_temp.g582_uid(n), 'member.' || n || '.582@test.local' from generate_series(1, 8) n;

-- 1 BC, 2 Moderator, 3 Group Manager (level 1), 4 Group Responsible (level 1),
-- 5 ordinary member (level 1), 6 Recrut (level 0), 7 inactive, 8 Drept de Vot (level 3).
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.g582_uid(n), 'Member #582 ' || n, 'member.' || n || '.582@test.local',
  (case n when 1 then 'bc' when 2 then 'moderator' when 6 then 'recrut'
          when 8 then 'vot' else 'voluntar' end)::public.member_role,
  (case n when 7 then 'inactiv' else 'activ' end)::public.member_status
from generate_series(1, 8) n;

insert into public.groups (name, category, min_level, created_by)
values ('Rădăcină #582',      'department', 0, pg_temp.g582_uid(1)),
       ('Altă rădăcină #582', 'department', 0, pg_temp.g582_uid(1)),
       ('Nivel #582',         'department', 0, pg_temp.g582_uid(1)),
       ('Arhivată #582',      'department', 0, pg_temp.g582_uid(1));
-- One Group whose roster follows the rank, and one that takes Applications:
-- groups_automatic_no_applications_ck forbids a Group from being both.
insert into public.groups (name, category, min_level, automatic_membership, created_by)
values ('Automat #582', 'department', 0, true, pg_temp.g582_uid(1));
insert into public.groups (name, category, min_level, accepts_applications, application_level, created_by)
values ('Cu aplicații #582', 'department', 0, true, 1, pg_temp.g582_uid(1));
update public.groups set status = 'archived' where name = 'Arhivată #582';

create function pg_temp.g582_group(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;

insert into public.groups (name, category, parent_id, min_level, created_by)
values ('Copil #582', 'team', pg_temp.g582_group('Rădăcină #582'), 0, pg_temp.g582_uid(1));

insert into public.group_members (group_id, member_id, group_role, position_title)
values (pg_temp.g582_group('Rădăcină #582'), pg_temp.g582_uid(3), 'manager',     null),
       (pg_temp.g582_group('Rădăcină #582'), pg_temp.g582_uid(8), 'manager',     null),
       (pg_temp.g582_group('Rădăcină #582'), pg_temp.g582_uid(4), 'responsible', 'Responsabil #582'),
       (pg_temp.g582_group('Rădăcină #582'), pg_temp.g582_uid(5), 'member',      null),
       (pg_temp.g582_group('Copil #582'),    pg_temp.g582_uid(5), 'member',      null),
       (pg_temp.g582_group('Copil #582'),    pg_temp.g582_uid(6), 'member',      null),
       (pg_temp.g582_group('Nivel #582'),    pg_temp.g582_uid(5), 'member',      null),
       (pg_temp.g582_group('Nivel #582'),    pg_temp.g582_uid(6), 'member',      null),
       (pg_temp.g582_group('Nivel #582'),    pg_temp.g582_uid(8), 'member',      null);

create function pg_temp.g582_bc() returns void language sql as $$
  select pg_temp.test_login(pg_temp.g582_uid(1), '{"member_role":"bc","member_level":6}'::jsonb) $$;
create function pg_temp.g582_moderator() returns void language sql as $$
  select pg_temp.test_login(pg_temp.g582_uid(2), '{"member_role":"moderator","member_level":9}'::jsonb) $$;
create function pg_temp.g582_as(n integer) returns void language sql as $$
  select pg_temp.test_login(pg_temp.g582_uid(n), '{"member_role":"voluntar","member_level":1}'::jsonb) $$;
create function pg_temp.g582_as_vot(n integer) returns void language sql as $$
  select pg_temp.test_login(pg_temp.g582_uid(n), '{"member_role":"vot","member_level":3}'::jsonb) $$;
create function pg_temp.g582_roster(p_name text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(gm.member_id order by gm.member_id), '{}')
    from public.group_members as gm
   where gm.group_id = (select id from public.groups where name = p_name)
$$;

-- ==================== 1 · create_group: malformed input, before any gate ====================

select pg_temp.test_login(pg_temp.g582_uid(5), '{"provider":"email"}'::jsonb);
select throws_ok($$select public.create_group(null, 'team')$$,
  'PT400', 'invalid_group_name',
  'create_group: a blank name is malformed for everyone, answered ahead of the gate');
select throws_ok($$select public.create_group('X #582', 'organization')$$,
  'PT400', 'invalid_group_category',
  'create_group: the Organization label is never claimed at creation -- it is a structural setting BC sets afterwards');
select throws_ok($$select public.create_group('X #582', 'team', null, 4)$$,
  'PT400', 'invalid_group_min_level',
  'create_group: level 4 is retired, so it is not a Minimum Level');
select throws_ok($$select public.create_group('X #582', 'team', null, 0, null, 'rosu')$$,
  'PT400', 'invalid_group_color',
  'create_group: a colour that is not #rrggbb is malformed');

-- ==================== 2 · create_group: authority ====================

reset role;
select pg_temp.g582_as(5);
select throws_ok($$select public.create_group('Nouă #582', 'department')$$,
  '42501', 'group_manage_forbidden',
  'create_group: an ordinary member cannot create a top-level Group');

reset role;
select pg_temp.g582_as(4);
select throws_ok(
  format($$select public.create_group('Nouă #582', 'team', %s)$$, pg_temp.g582_group('Rădăcină #582')),
  '42501', 'group_manage_forbidden',
  'create_group: a Group RESPONSIBLE cannot create a Child Group -- this is the Manager tier (R19)');

reset role;
select pg_temp.g582_as(3);
select lives_ok(
  format($$select public.create_group('Copil nou #582', 'team', %s)$$, pg_temp.g582_group('Rădăcină #582')),
  'create_group: the parent''s Group MANAGER creates a Child Group');
select throws_ok(
  format($$select public.create_group('Nivel prea sus #582', 'team', %s, 3)$$, pg_temp.g582_group('Rădăcină #582')),
  'PT400', 'group_min_level_above_actor',
  'create_group: nobody puts a Group above their own live Level');

reset role;
select pg_temp.g582_bc();
select throws_ok($$select public.create_group('Fără părinte #582', 'team', 999999999)$$,
  '42501', 'group_manage_forbidden',
  'create_group: an unknown parent is refused as "you may not", never as "no such Group"');
select throws_ok(
  format($$select public.create_group('Sub arhivată #582', 'team', %s)$$, pg_temp.g582_group('Arhivată #582')),
  'PT409', 'group_archived',
  'create_group: an AUTHORIZED actor gets the real state conflict under an archived parent');
select throws_ok($$select public.create_group('Rădăcină #582', 'department')$$,
  'PT409', 'group_name_taken',
  'create_group: a sibling name already taken is refused (groups_parent_name_uidx)');
select throws_ok($$select public.create_group('educațional', 'department')$$,
  'PT409', 'group_name_taken',
  'create_group: a reference Group''s name is taken too, case-insensitively -- the sibling-name rule is total since #591');

-- ==================== 3 · a raised Minimum Level, confirmed (tree B) ====================

reset role;
select pg_temp.g582_bc();
select throws_ok(
  format($$select public.update_group(%s, 'Nivel #582', null, false, null, false, 3, null, null, false)$$,
         pg_temp.g582_group('Nivel #582')),
  'PT409', 'group_has_members_below_level',
  'update_group: a raise above existing members refuses without p_confirm_removals (R23)');
select is(pg_temp.g582_roster('Nivel #582'),
  array[pg_temp.g582_uid(5), pg_temp.g582_uid(6), pg_temp.g582_uid(8)],
  'and it removes nobody when it refuses');
select lives_ok(
  format($$select public.update_group(%s, 'Nivel #582', null, false, null, false, 3, null, null, true)$$,
         pg_temp.g582_group('Nivel #582')),
  'update_group: with the confirmation, BC raises a top-level Group''s Minimum Level');
select is(pg_temp.g582_roster('Nivel #582'), array[pg_temp.g582_uid(8)],
  'exactly the roster rows below the new Minimum Level are gone, and nobody else');

-- ==================== 4 · create_group against a Minimum Level and an appointed Manager ====================

select throws_ok(
  format($$select public.create_group('Sub nivel #582', 'team', %s, 0)$$, pg_temp.g582_group('Nivel #582')),
  'PT400', 'group_min_level_below_parent',
  'create_group: a Child Group may not be more open than its parent');
select throws_ok(
  format($$select public.create_group('Manager inactiv #582', 'team', %s, 3, %L)$$,
         pg_temp.g582_group('Nivel #582'), pg_temp.g582_uid(7)),
  'PT400', 'group_member_not_eligible',
  'create_group: an inactive Member cannot be appointed Group Manager');
select throws_ok(
  format($$select public.create_group('Manager mic #582', 'team', %s, 3, %L)$$,
         pg_temp.g582_group('Nivel #582'), pg_temp.g582_uid(5)),
  'PT400', 'group_member_below_min_level',
  'create_group: the appointed Manager must reach the new Group''s Minimum Level');
select lives_ok(
  format($$select public.create_group('Cu manager #582', 'team', %s, 3, %L)$$,
         pg_temp.g582_group('Nivel #582'), pg_temp.g582_uid(8)),
  'create_group: a Child Group and its Group Manager are created in one call');

reset role;
select is(pg_temp.g582_roster('Cu manager #582'), array[pg_temp.g582_uid(8)],
  'create_group: p_manager_id''s roster row is written by the command itself (R19)');
select is(
  (select array[grp.parent_id, grp.min_level::bigint, cardinality(grp.path)::bigint,
                (select count(*) from public.group_members gm
                  where gm.group_id = grp.id and gm.group_role = 'manager')]
     from public.groups grp where grp.name = 'Cu manager #582'),
  array[pg_temp.g582_group('Nivel #582'), 3::bigint, 2::bigint, 1::bigint],
  'create_group: the new Group carries its parent, its Minimum Level, a two-deep path and one Manager');

-- ==================== 5 · update_group: malformed input ====================

select pg_temp.test_login(pg_temp.g582_uid(5), '{"provider":"email"}'::jsonb);
select throws_ok(
  format($$select public.update_group(%s, '  ', null, false, null, false, 0, null, null)$$, pg_temp.g582_group('Copil #582')),
  'PT400', 'invalid_group_name', 'update_group: a blank name is malformed for everyone');
select throws_ok(
  format($$select public.update_group(%s, 'Copil #582', '  ', false, null, false, 0, null, null)$$, pg_temp.g582_group('Copil #582')),
  'PT400', 'invalid_position_title', 'update_group: a blank position display name is malformed');
select throws_ok(
  format($$select public.update_group(%s, 'Copil #582', null, false, null, false, 4, null, null)$$, pg_temp.g582_group('Copil #582')),
  'PT400', 'invalid_group_min_level', 'update_group: level 4 is not a Minimum Level');
select throws_ok(
  format($$select public.update_group(%s, 'Copil #582', null, true, null, false, 0, null, null)$$, pg_temp.g582_group('Copil #582')),
  'PT400', 'invalid_application_level',
  'update_group: a Group that accepts Applications must name the Application Level');
select throws_ok(
  format($$select public.update_group(%s, 'Copil #582', null, true, 1, false, 3, null, null)$$, pg_temp.g582_group('Copil #582')),
  'PT400', 'application_level_below_min_level',
  'update_group: the Application Level never sits below the Minimum Level');

-- ==================== 6 · update_group: authority, the split, and the full-state replace ====================

reset role;
select pg_temp.g582_as(5);
select throws_ok(
  format($$select public.update_group(%s, 'Redenumit #582', null, false, null, false, 0, null, null)$$,
         pg_temp.g582_group('Copil #582')),
  '42501', 'group_manage_forbidden', 'update_group: an ordinary member changes nothing');

reset role;
select pg_temp.g582_as(4);
select throws_ok(
  format($$select public.update_group(%s, 'Redenumit #582', null, false, null, false, 0, null, null)$$,
         pg_temp.g582_group('Copil #582')),
  '42501', 'group_manage_forbidden',
  'update_group: a Group Responsible is not a Manager (R19) -- refused on a Group whose work they manage');

reset role;
select pg_temp.g582_as(3);
select throws_ok(
  format($$select public.update_group(%s, 'Copil #582', null, false, null, false, 3, null, null, true)$$,
         pg_temp.g582_group('Copil #582')),
  'PT400', 'group_min_level_above_actor',
  'update_group: a Manager may not raise a Child Group above their OWN Level');
select throws_ok(
  format($$select public.update_group(%s, 'Copil redenumit #582', 'Coordonator #582', true, 1, true, 1, null, null, false)$$,
         pg_temp.g582_group('Copil #582')),
  'PT409', 'group_has_members_below_level',
  'update_group: the confirmation flag is demanded of a Group Manager too');
select lives_ok(
  format($$select public.update_group(%s, 'Copil redenumit #582', 'Coordonator #582', true, 1, true, 1, null, null, true)$$,
         pg_temp.g582_group('Copil #582')),
  'update_group: a Child Group''s Manager owns name, position title, Applications, visibility and Minimum Level');
select is(
  (select array[name, manager_title, accepts_applications::text, application_level::text,
                shared_work_visibility::text, min_level::text]
     from public.groups where id = pg_temp.g582_group('Copil redenumit #582')),
  array['Copil redenumit #582', 'Coordonator #582', 'true', '1', 'true', '1'],
  'update_group is a full-state replace: every operational column is written from its argument');
select is(pg_temp.g582_roster('Copil redenumit #582'), array[pg_temp.g582_uid(5)],
  'and the Recrut below the new Minimum Level left with it');

reset role;
select ok(
  exists (select 1 from public.notifications
           where member_id = pg_temp.g582_uid(6)
             and title = 'Nu mai faci parte din Copil redenumit #582'),
  'each removed Member is notified directly (R23/R25)');
select is(
  (select count(*)::int from public.notifications where member_id = pg_temp.g582_uid(3)),
  0, 'the actor is never notified of their own decision (R25)');
select ok(
  exists (select 1 from public.notifications
           where member_id = pg_temp.g582_uid(8)
             and title = 'Nivel minim actualizat: Copil redenumit #582'
             and link = '/administrare/grupuri/' || pg_temp.g582_group('Copil redenumit #582')::text),
  'the Group''s other Managers get one summary, linked to the Group screen');

select pg_temp.g582_as(3);
select lives_ok(
  format($$select public.update_group(%s, 'Copil redenumit #582', null, false, null, false, 1, null, null)$$,
         pg_temp.g582_group('Copil redenumit #582')),
  'update_group: sending null back CLEARS the nullable columns (OD5)');
select is(
  (select array[manager_title, application_level::text]
     from public.groups where id = pg_temp.g582_group('Copil redenumit #582')),
  array[null, null]::text[],
  'and the cleared columns really are null afterwards');
select throws_ok(
  format($$select public.update_group(%s, 'Copil redenumit #582', null, false, null, false, 1, null, null)$$,
         pg_temp.g582_group('Copil redenumit #582')),
  'PT409', 'nothing_to_update', 'update_group: the same state sent twice is a state conflict');
select throws_ok(
  format($$select public.update_group(%s, 'Rădăcină #582', null, false, null, false, 1, null, null, true)$$,
         pg_temp.g582_group('Rădăcină #582')),
  '42501', 'group_manage_forbidden',
  'update_group: a TOP-LEVEL Group''s Minimum Level is structural -- a Manager below level 6 is refused (Decision 5)');

reset role;
select pg_temp.g582_bc();
select throws_ok(
  format($$select public.update_group(%s, 'Rădăcină #582', null, false, null, false, 1, null, null, true)$$,
         pg_temp.g582_group('Rădăcină #582')),
  'PT400', 'group_min_level_above_children',
  'update_group: a parent never rises above a child''s Minimum Level -- descendants are never touched');
select throws_ok(
  format($$select public.update_group(%s, 'Cu manager #582', null, false, null, false, 0, null, null)$$,
         pg_temp.g582_group('Cu manager #582')),
  'PT400', 'group_min_level_below_parent',
  'update_group: a Child Group never falls below its parent''s Minimum Level');
select throws_ok(
  format($$select public.update_group(%s, 'Altă rădăcină #582', null, false, null, false, 0, null, null)$$,
         pg_temp.g582_group('Rădăcină #582')),
  'PT409', 'group_name_taken', 'update_group: a rename onto a sibling''s name is refused');
select throws_ok(
  format($$select public.update_group(%s, 'DIVERSE', null, false, null, false, 0, null, null)$$,
         pg_temp.g582_group('Rădăcină #582')),
  'PT409', 'group_name_taken',
  'update_group: a rename onto a reference Group''s name is refused too -- no legacy exemption since #591');
select throws_ok(
  format($$select public.update_group(%s, 'Oricum #582', null, false, null, false, 0, null, null)$$,
         pg_temp.g582_group('Arhivată #582')),
  'PT409', 'group_archived', 'update_group: an archived Group is not edited');
select throws_ok(
  format($$select public.update_group(%s, 'Automat #582', null, true, 1, false, 0, null, null)$$,
         pg_temp.g582_group('Automat #582')),
  'PT409', 'automatic_group_accepts_no_applications',
  'update_group: a Group whose roster follows the rank accepts no Applications -- answered, never a raw 23514');

-- ==================== 7 · update_group_structure ====================

reset role;
select pg_temp.g582_as(3);
select throws_ok(
  format($$select public.update_group_structure(%s, 'team', false, true, false, 0, null, null, false, false)$$,
         pg_temp.g582_group('Rădăcină #582')),
  '42501', 'group_manage_forbidden',
  'update_group_structure: a Group Manager holds no structural setting (Decision 5)');

reset role;
select pg_temp.test_login(pg_temp.g582_uid(5), '{"provider":"email"}'::jsonb);
select throws_ok(
  format($$select public.update_group_structure(%s, 'kind', false, true, false, 0, null, null, false, false)$$,
         pg_temp.g582_group('Rădăcină #582')),
  'PT400', 'invalid_group_category',
  'update_group_structure: an unknown presentation label is malformed for everyone');
select throws_ok(
  format($$select public.update_group_structure(%s, 'department', false, true, false, 0, 'albastru', null, false, false)$$,
         pg_temp.g582_group('Rădăcină #582')),
  'PT400', 'invalid_group_color', 'update_group_structure: a colour is #rrggbb or nothing');

reset role;
select pg_temp.g582_bc();
select throws_ok(
  format($$select public.update_group_structure(%s, 'team', false, true, false, 0, null, null, false, false)$$,
         pg_temp.g582_group('Copil redenumit #582')),
  '42501', 'group_manage_forbidden',
  'update_group_structure: a CHILD Group''s Minimum Level belongs to its Managers -- the mirror image of update_group');
select throws_ok(
  format($$select public.update_group_structure(%s, 'team', true, true, false, 1, null, null, false, false)$$,
         pg_temp.g582_group('Copil redenumit #582')),
  'PT409', 'cup_not_top_level', 'update_group_structure: only a top-level Group competes in the Department Cup');
select throws_ok(
  format($$select public.update_group_structure(%s, 'department', false, true, false, 0, null, null, true, false)$$,
         pg_temp.g582_group('Rădăcină #582')),
  'PT409', 'organization_group_exists',
  'update_group_structure: the Organization marker is unique -- the old Group is cleared first');
select throws_ok(
  format($$select public.update_group_structure(%s, 'department', false, true, true, 0, null, null, false, false)$$,
         pg_temp.g582_group('Rădăcină #582')),
  'PT409', 'automatic_group_has_roster_members',
  'update_group_structure: Automatic Membership cannot be switched on over a hand-written roster');
select throws_ok(
  format($$select public.update_group_structure(%s, 'department', false, true, true, 0, null, null, false, false)$$,
         pg_temp.g582_group('Cu aplicații #582')),
  'PT409', 'automatic_group_accepts_no_applications',
  'update_group_structure: nor over a Group that accepts Applications -- the mirror of update_group''s check');
select lives_ok(
  format($$select public.update_group_structure(%s, 'department', true, true, false, 0, '#112233', 'RAD', false, false)$$,
         pg_temp.g582_group('Rădăcină #582')),
  'update_group_structure: BC owns the label, both Cup flags, colour, short name and a root''s Minimum Level');
select is(
  (select array[category, competes_in_cup::text, color, short]
     from public.groups where id = pg_temp.g582_group('Rădăcină #582')),
  array['department', 'true', '#112233', 'RAD'],
  'and the structural state is replaced in full');
select throws_ok(
  format($$select public.update_group_structure(%s, 'department', true, true, false, 0, '#112233', 'RAD', false, false)$$,
         pg_temp.g582_group('Rădăcină #582')),
  'PT409', 'nothing_to_update', 'update_group_structure: the same state sent twice is a state conflict');
select throws_ok(
  format($$select public.update_group_structure(%s, 'department', false, true, false, 0, null, null, false, false)$$,
         pg_temp.g582_group('Arhivată #582')),
  'PT409', 'group_archived', 'update_group_structure: an archived Group is not edited');
select throws_ok(
  $$select public.update_group_structure(999999999, 'department', false, true, false, 0, null, null, false, false)$$,
  '42501', 'group_manage_forbidden',
  'update_group_structure: an unknown id is refused, never reported as missing');
select throws_ok(
  format($$select public.update_group_structure(%s, 'department', false, true, false, 9, null, null, false, false)$$,
         pg_temp.g582_group('Altă rădăcină #582')),
  'PT400', 'group_min_level_above_actor',
  'update_group_structure: BC may not put a Group above BC''s own Level');

reset role;
select pg_temp.g582_moderator();
select lives_ok(
  format($$select public.update_group_structure(%s, 'department', false, true, false, 9, null, null, false, false)$$,
         pg_temp.g582_group('Altă rădăcină #582')),
  'update_group_structure: the Moderator is exempt from that rule, as ADR-0009 already rules for Events');

-- ==================== 8 · archive_group ====================

reset role;
insert into public.groups (name, category, min_level, created_by)
values ('De arhivat #582', 'department', 0, pg_temp.g582_uid(1)),
       ('Părinte viu #582', 'department', 0, pg_temp.g582_uid(1));
insert into public.groups (name, category, parent_id, min_level, created_by)
values ('Sub-arhivat #582', 'team', pg_temp.g582_group('De arhivat #582'), 0, pg_temp.g582_uid(1)),
       ('Copil de arhivat #582', 'team', pg_temp.g582_group('Părinte viu #582'), 0, pg_temp.g582_uid(1));
insert into public.group_members (group_id, member_id, group_role)
values (pg_temp.g582_group('De arhivat #582'),  pg_temp.g582_uid(3), 'manager'),
       (pg_temp.g582_group('Părinte viu #582'), pg_temp.g582_uid(3), 'manager'),
       (pg_temp.g582_group('Părinte viu #582'), pg_temp.g582_uid(4), 'responsible'),
       -- Member 8 (Drept de Vot, level 3) is the audience of the restricted
       -- Event below: the archiver, member 3, is a Voluntar at level 1 and
       -- could not read that Event at all.
       (pg_temp.g582_group('Copil de arhivat #582'), pg_temp.g582_uid(8), 'member');

insert into public.tasks (title, group_id, created_by, status, audience, assignment_mode, kind)
values ('Muncă deschisă #582', pg_temp.g582_group('Sub-arhivat #582'), pg_temp.g582_uid(1),
        'todo', 'local', 'direct', 'task');

select pg_temp.g582_as(5);
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g582_group('De arhivat #582')),
  '42501', 'group_manage_forbidden', 'archive_group: an ordinary member archives nothing');

reset role;
select pg_temp.g582_as(3);
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g582_group('De arhivat #582')),
  '42501', 'group_manage_forbidden',
  'archive_group: a TOP-LEVEL Group is BC''s and the Moderator''s, even for its own Group Manager');

reset role;
select pg_temp.g582_bc();
select throws_ok($$select public.archive_group(999999999)$$,
  '42501', 'group_manage_forbidden', 'archive_group: an unknown id is refused, never reported as missing');
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g582_group('De arhivat #582')),
  'PT409', 'group_has_open_work',
  'archive_group: a non-terminal Task anywhere in the subtree blocks it -- archiving never cancels a Task (R21)');

reset role;
update public.tasks set status = 'cancelled', cancel_reason = 'fixture #582', cancelled_at = now()
 where title = 'Muncă deschisă #582';
insert into public.completed_work_requests (requester_id, group_id, description)
values (pg_temp.g582_uid(5), pg_temp.g582_group('Sub-arhivat #582'), 'Cerere în așteptare #582');

select pg_temp.g582_bc();
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g582_group('De arhivat #582')),
  'PT409', 'group_has_open_work',
  'archive_group: a pending Completed-work Request in the subtree blocks it too');

reset role;
update public.completed_work_requests
   set status = 'rejected', decided_by = pg_temp.g582_uid(1), decided_at = now(),
       decision_note = 'fixture #582'
 where description = 'Cerere în așteptare #582';

insert into public.events (title, type, group_id, starts_at, min_level, created_by)
values ('Eveniment viitor #582', 'sedinta', pg_temp.g582_group('Sub-arhivat #582'),
        now() + interval '7 days', 0, pg_temp.g582_uid(1)),
       ('Eveniment trecut #582', 'sedinta', pg_temp.g582_group('De arhivat #582'),
        now() - interval '7 days', 0, pg_temp.g582_uid(1));

select pg_temp.g582_bc();
select lives_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g582_group('De arhivat #582')),
  'archive_group: with the work settled, BC archives the Group');

reset role;
select is(
  (select array_agg(status order by name) from public.groups
    where name in ('De arhivat #582', 'Sub-arhivat #582')),
  array['archived', 'archived'],
  'archive_group cascades the status to every descendant in one statement (R19)');
select is(
  (select cancel_reason from public.events where title = 'Eveniment viitor #582'),
  'Grup arhivat', 'archive_group cancels the subtree''s FUTURE Events with the archive as the reason');
select is(
  (select cancelled_at from public.events where title = 'Eveniment trecut #582'),
  null::timestamptz, 'and leaves past Events alone as history (ADR-0008)');

select pg_temp.g582_as(3);
select is(private.can_manage_group_work(pg_temp.g582_group('Sub-arhivat #582')), false,
  'nothing under an archived parent is left manageable by its own Group Role');

reset role;
select pg_temp.g582_bc();
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g582_group('De arhivat #582')),
  'PT409', 'group_already_archived', 'archive_group: a second call is a state conflict');

reset role;
select pg_temp.g582_as(4);
select throws_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g582_group('Copil de arhivat #582')),
  '42501', 'group_manage_forbidden',
  'archive_group: a Group Responsible cannot archive a Child Group either (R19)');

-- The archiver is a Voluntar at level 1; the Event below sits at Minimum Level
-- 3, so private.cancel_event_impl would answer them PT404 event_not_found and
-- abort the archive. The authority for these cancellations is the Group, not
-- the archiver's own visibility, so the cascade uses the ungated effect.
reset role;
insert into public.events (title, type, group_id, starts_at, min_level, created_by)
values ('Eveniment restricționat #582', 'sedinta', pg_temp.g582_group('Copil de arhivat #582'),
        now() + interval '5 days', 3, pg_temp.g582_uid(1));

select pg_temp.g582_as(3);
select lives_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g582_group('Copil de arhivat #582')),
  'archive_group: the parent''s Group Manager archives a Child Group -- even holding a future Event above their own Level');

reset role;
select is(
  (select cancel_reason from public.events where title = 'Eveniment restricționat #582'),
  'Grup arhivat',
  'archive_group cancels an Event the archiver cannot even read: the Group is the authority, not the actor''s visibility');
select ok(
  exists (select 1 from public.notifications
           where member_id = pg_temp.g582_uid(8)
             and title = 'Eveniment anulat: Eveniment restricționat #582'
             and link = '/calendar'),
  'and its audience is still notified through the shared cancellation effect');
select is((select status from public.groups where name = 'Părinte viu #582'), 'active',
  'and archiving a child leaves its parent active');

-- ==================== 9 · the Organization marker replaces name = 'OSUBB' ====================
-- The marker moves off the mirrored OSUBB row onto a native Group. That row
-- keeps name = 'OSUBB', so every assertion below inverts if a reader
-- still asks for the legacy id instead of groups.is_organization.

create function pg_temp.g582_clear_org() returns void language plpgsql as $$
declare v_group public.groups%rowtype;
begin
  select * into v_group from public.groups where is_organization;
  perform public.update_group_structure(
    v_group.id, v_group.category, v_group.competes_in_cup, v_group.counts_toward_parent_cup,
    v_group.automatic_membership, v_group.min_level, v_group.color, v_group.short, false,
    v_group.is_private);
end;
$$;

select pg_temp.g582_bc();
select lives_ok($$select pg_temp.g582_clear_org()$$,
  'fixture: BC clears the Organization marker from the mirrored OSUBB Group');
select lives_ok(
  format($$select public.update_group_structure(%s, 'organization', false, true, false, 0, null, null, true, false)$$,
         pg_temp.g582_group('Părinte viu #582')),
  'fixture: and sets it on a native Group, which carries no legacy id at all');

reset role;
select pg_temp.g582_as_vot(8);
select lives_ok(
  format($$select public.create_event('Eveniment organizație #582', 'sedinta', %s, now() + interval '3 days')$$,
         pg_temp.g582_group('Părinte viu #582')),
  'create_event: the Organization rule -- any live Group Role, held anywhere -- follows groups.is_organization');

reset role;
select pg_temp.g582_as(5);
select throws_ok(
  format($$select public.create_event('Refuzat #582', 'sedinta', %s, now() + interval '3 days')$$,
         pg_temp.g582_group('Părinte viu #582')),
  '42501', 'calendar_manage_forbidden',
  'create_event: and a Member holding no Group Role anywhere is still refused on the Organization Group');

reset role;
select pg_temp.g582_as(3);
select throws_ok(
  format($$select public.update_event(
           (select id from public.events where title = 'Eveniment organizație #582'),
           'Redenumit #582', 'sedinta', %s, now() + interval '3 days', null, null, null, null, 0, null)$$,
         pg_temp.g582_group('Părinte viu #582')),
  '42501', 'calendar_manage_forbidden',
  'update_event: an Organization Event belongs to its creator -- a Group Manager who did not create it is refused');
select throws_ok(
  $$select public.cancel_event(
      (select id from public.events where title = 'Eveniment organizație #582'), 'gata')$$,
  '42501', 'calendar_manage_forbidden',
  'cancel_event: the same creator-only rule, read from the marker rather than from legacy_dept_id');

reset role;
select pg_temp.g582_as_vot(8);
select lives_ok(
  $$select public.cancel_event(
      (select id from public.events where title = 'Eveniment organizație #582'), 'gata')$$,
  'cancel_event: and its creator still cancels it');

-- ==================== #673: constraints kit (R8) ====================
-- Step 1 answers before the gate: a claimless caller hears the reason, not 42501.
reset role;
select pg_temp.test_login('67300000-0000-0000-0000-000000000001', '{"provider":"email"}'::jsonb);
select throws_ok($$ select public.create_group(repeat('g', 121), 'team') $$,
  'PT400', 'name_too_long', 'a Group name over 120 characters is refused before the gate');
select throws_ok($$ select public.update_group(0, 'ab', null, false, null, false, 0, null, null) $$,
  'PT400', 'name_too_short', 'a Group name under 3 characters is refused before the gate');
reset role;

select * from finish();
rollback;
