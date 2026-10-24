-- #1110 (ruling R65): public.unarchive_group, the inverse of archive_group.
--
-- In the order the command answers: authority (every refusal the one
-- non-disclosing 42501 group_manage_forbidden), then state (PT409
-- group_not_archived, PT409 group_parent_archived), then the effect -- the
-- Group and its archived subtree come back in one statement, and nothing
-- archiving ended comes back with them.
--
-- Every Group is archived through public.archive_group itself, so the state
-- unarchiving meets is the real one: future Events cancelled with "Grup
-- arhivat", pending Applications declined with the archiver as decider.
--
-- Two trees keep the actor kinds apart. Tree R ("Rădăcină #1110", a top-level
-- Department with two subgroups) is BC's acceptance case; tree S ("Sus
-- #1110") carries the Child-Group authority cases. "Separată #1110" is an
-- unrelated archived Group that must stay archived throughout.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(35);

-- ==================== Fixtures ====================

create function pg_temp.g1110_uid(n integer) returns uuid language sql immutable as $$
  select ('11100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users (id, email)
select pg_temp.g1110_uid(n), 'member.' || n || '.1110@test.local' from generate_series(1, 9) n;

-- 1 BC, 2 Moderator, 3 Manager of R and S (level 1), 4 Responsible of S
-- (level 1), 5 ordinary member, 6 Manager of S1 only (level 1), 7 an inactive
-- Manager of S, 8 BCE (level 5) with no Group Role, 9 Manager of the unrelated
-- Group (level 1).
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.g1110_uid(n), 'Member #1110 ' || n, 'member.' || n || '.1110@test.local',
  (case n when 1 then 'bc' when 2 then 'moderator' when 8 then 'bce'
          else 'voluntar' end)::public.member_role,
  (case n when 7 then 'inactiv' else 'activ' end)::public.member_status
from generate_series(1, 9) n;

insert into public.groups (name, category, min_level, created_by)
values ('Rădăcină #1110', 'department', 0, pg_temp.g1110_uid(1)),
       ('Sus #1110',      'department', 0, pg_temp.g1110_uid(1)),
       ('Separată #1110', 'department', 0, pg_temp.g1110_uid(1)),
       ('Activă #1110',   'department', 0, pg_temp.g1110_uid(1));

create function pg_temp.g1110_group(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;

insert into public.groups (name, category, parent_id, min_level, created_by)
values ('Copil A #1110', 'team', pg_temp.g1110_group('Rădăcină #1110'), 0, pg_temp.g1110_uid(1)),
       ('Copil B #1110', 'team', pg_temp.g1110_group('Rădăcină #1110'), 0, pg_temp.g1110_uid(1)),
       ('S1 #1110',      'team', pg_temp.g1110_group('Sus #1110'),      0, pg_temp.g1110_uid(1));
insert into public.groups (name, category, parent_id, min_level, created_by)
values ('S1x #1110', 'team', pg_temp.g1110_group('S1 #1110'), 0, pg_temp.g1110_uid(1));

insert into public.group_members (group_id, member_id, group_role, position_title)
values (pg_temp.g1110_group('Rădăcină #1110'), pg_temp.g1110_uid(3), 'manager',     null),
       (pg_temp.g1110_group('Copil A #1110'),  pg_temp.g1110_uid(5), 'member',      null),
       (pg_temp.g1110_group('Copil B #1110'),  pg_temp.g1110_uid(4), 'responsible', 'Responsabil #1110'),
       (pg_temp.g1110_group('Sus #1110'),      pg_temp.g1110_uid(3), 'manager',     null),
       (pg_temp.g1110_group('Sus #1110'),      pg_temp.g1110_uid(7), 'manager',     null),
       (pg_temp.g1110_group('Sus #1110'),      pg_temp.g1110_uid(4), 'responsible', 'Responsabil #1110'),
       (pg_temp.g1110_group('S1 #1110'),       pg_temp.g1110_uid(6), 'manager',     null),
       (pg_temp.g1110_group('S1 #1110'),       pg_temp.g1110_uid(5), 'member',      null),
       (pg_temp.g1110_group('Separată #1110'), pg_temp.g1110_uid(9), 'manager',     null);

-- What archiving R ends: a future Event in Copil A, a pending Application on
-- Copil B (an owner fixture, OD9: the Application's own path is not under test).
insert into public.events (title, type, group_id, starts_at, min_level, created_by)
values ('Eveniment viitor #1110', 'sedinta', pg_temp.g1110_group('Copil A #1110'),
        now() + interval '7 days', 0, pg_temp.g1110_uid(1));
insert into public.group_applications (group_id, member_id)
values (pg_temp.g1110_group('Copil B #1110'), pg_temp.g1110_uid(5));

create function pg_temp.g1110_bc() returns void language sql as $$
  select pg_temp.test_login(pg_temp.g1110_uid(1), '{"member_role":"bc","member_level":6}'::jsonb) $$;
create function pg_temp.g1110_moderator() returns void language sql as $$
  select pg_temp.test_login(pg_temp.g1110_uid(2), '{"member_role":"moderator","member_level":9}'::jsonb) $$;
create function pg_temp.g1110_as(n integer) returns void language sql as $$
  select pg_temp.test_login(pg_temp.g1110_uid(n), '{"member_role":"voluntar","member_level":1}'::jsonb) $$;
create function pg_temp.g1110_bce() returns void language sql as $$
  select pg_temp.test_login(pg_temp.g1110_uid(8), '{"member_role":"bce","member_level":5}'::jsonb) $$;

create function pg_temp.g1110_statuses(p_names text[]) returns text[]
language sql stable security definer set search_path = '' as $$
  select array_agg(grp.status order by grp.name)
    from public.groups as grp where grp.name = any (p_names)
$$;
-- Every roster row of tree R with its Group Role and title, as text.
create function pg_temp.g1110_tree_roster() returns text[]
language sql stable security definer set search_path = '' as $$
  select array_agg(grp.name || ':' || gm.member_id || ':' || gm.group_role || ':'
                   || coalesce(gm.position_title, '-')
                   order by grp.name, gm.member_id)
    from public.group_members as gm
    join public.groups as grp on grp.id = gm.group_id
   where grp.path @> array[(select id from public.groups where name = 'Rădăcină #1110')]
$$;

-- Archive the trees through the real command.
select pg_temp.g1110_bc();
select public.archive_group(pg_temp.g1110_group('Rădăcină #1110'));
select public.archive_group(pg_temp.g1110_group('Separată #1110'));
reset role;
select pg_temp.g1110_as(3);
select public.archive_group(pg_temp.g1110_group('S1 #1110'));
reset role;

create temporary table fx1110 on commit drop as
select pg_temp.g1110_tree_roster() as roster,
       (select cancelled_at from public.events where title = 'Eveniment viitor #1110') as cancelled_at,
       (select decided_at from public.group_applications
         where group_id = pg_temp.g1110_group('Copil B #1110')) as decided_at;

select is(
  pg_temp.g1110_statuses(array['Rădăcină #1110', 'Copil A #1110', 'Copil B #1110', 'S1 #1110', 'S1x #1110']),
  array['archived', 'archived', 'archived', 'archived', 'archived'],
  'fixture: both subtrees are archived through archive_group');

-- ==================== 1 · grants ====================

select ok(has_function_privilege('authenticated', 'public.unarchive_group(bigint)', 'execute')
          and not has_function_privilege('anon', 'public.unarchive_group(bigint)', 'execute')
          and not has_function_privilege('service_role', 'public.unarchive_group(bigint)', 'execute'),
  'unarchive_group: the wrapper is executable by authenticated only');
select ok(has_function_privilege('authenticated', 'private.unarchive_group_impl(bigint)', 'execute')
          and not has_function_privilege('anon', 'private.unarchive_group_impl(bigint)', 'execute')
          and not has_function_privilege('service_role', 'private.unarchive_group_impl(bigint)', 'execute'),
  'unarchive_group_impl: authenticated only, like every _impl');
select ok((select prosecdef and proconfig @> array['search_path=""']
             from pg_proc where oid = 'private.unarchive_group_impl(bigint)'::regprocedure),
  'unarchive_group_impl: security definer with an empty search_path');
select ok((select not prosecdef from pg_proc where oid = 'public.unarchive_group(bigint)'::regprocedure),
  'unarchive_group: the wrapper is security invoker');

-- ==================== 2 · authority on a top-level Group ====================

select pg_temp.test_login(pg_temp.g1110_uid(5), '{"provider":"email"}'::jsonb);
select throws_ok(
  format($$select public.unarchive_group(%s)$$, pg_temp.g1110_group('Rădăcină #1110')),
  '42501', 'group_manage_forbidden',
  'unarchive_group: a caller without organization claims is refused');

reset role;
select pg_temp.g1110_as(5);
select throws_ok(
  format($$select public.unarchive_group(%s)$$, pg_temp.g1110_group('Rădăcină #1110')),
  '42501', 'group_manage_forbidden',
  'unarchive_group: an ordinary member is refused');

reset role;
select pg_temp.g1110_as(3);
select throws_ok(
  format($$select public.unarchive_group(%s)$$, pg_temp.g1110_group('Rădăcină #1110')),
  '42501', 'group_manage_forbidden',
  'unarchive_group: a top-level Group is BC''s and the Moderator''s, not its own Manager''s -- as archiving');

reset role;
select pg_temp.g1110_bce();
select throws_ok(
  format($$select public.unarchive_group(%s)$$, pg_temp.g1110_group('Rădăcină #1110')),
  '42501', 'group_manage_forbidden',
  'unarchive_group: BCE reads every archived Group but may not unarchive one');

reset role;
select pg_temp.g1110_bc();
select throws_ok($$select public.unarchive_group(999999999)$$,
  '42501', 'group_manage_forbidden',
  'unarchive_group: an unknown id is "you may not", never "no such Group"');

-- ==================== 3 · state refusals ====================

select throws_ok(
  format($$select public.unarchive_group(%s)$$, pg_temp.g1110_group('Copil A #1110')),
  'PT409', 'group_parent_archived',
  'unarchive_group: a Child Group under an archived parent waits for its parent');
select throws_ok(
  format($$select public.unarchive_group(%s)$$, pg_temp.g1110_group('Activă #1110')),
  'PT409', 'group_not_archived',
  'unarchive_group: an active Group is a state conflict');

-- ==================== 4 · BC unarchives a Department with two subgroups ====================

select lives_ok(
  format($$select public.unarchive_group(%s)$$, pg_temp.g1110_group('Rădăcină #1110')),
  'unarchive_group: BC unarchives the top-level Department');
reset role;

select is(
  pg_temp.g1110_statuses(array['Rădăcină #1110', 'Copil A #1110', 'Copil B #1110']),
  array['active', 'active', 'active'],
  'the Group and every archived Group below it are active again, in one command');
select is(
  pg_temp.g1110_statuses(array['Separată #1110', 'S1 #1110', 'S1x #1110']),
  array['archived', 'archived', 'archived'],
  'and nothing outside its subtree moves');
select is(pg_temp.g1110_tree_roster(), (select roster from fx1110),
  'rosters and Group Roles are as archiving left them');
select ok(
  (select cancelled_at = (select cancelled_at from fx1110) and cancel_reason = 'Grup arhivat'
     from public.events where title = 'Eveniment viitor #1110'),
  'a cancelled Event stays cancelled, with its reason');
select ok(
  (select status = 'declined' and decision_note = 'Grup arhivat'
          and decided_at = (select decided_at from fx1110) and decided_by = pg_temp.g1110_uid(1)
     from public.group_applications where group_id = pg_temp.g1110_group('Copil B #1110')),
  'a declined Application stays declined, its decision untouched');

select pg_temp.g1110_bc();
select throws_ok(
  format($$select public.unarchive_group(%s)$$, pg_temp.g1110_group('Rădăcină #1110')),
  'PT409', 'group_not_archived',
  'unarchive_group: a second call is a state conflict');
reset role;

-- ==================== 5 · authority on a Child Group ====================

select pg_temp.g1110_as(5);
select throws_ok(
  format($$select public.unarchive_group(%s)$$, pg_temp.g1110_group('S1 #1110')),
  '42501', 'group_manage_forbidden',
  'unarchive_group: a plain member of the Child Group is refused');

reset role;
select pg_temp.g1110_as(4);
select throws_ok(
  format($$select public.unarchive_group(%s)$$, pg_temp.g1110_group('S1 #1110')),
  '42501', 'group_manage_forbidden',
  'unarchive_group: a Group RESPONSIBLE on the path is refused -- this is the Manager tier (R19)');

reset role;
select pg_temp.g1110_as(7);
select throws_ok(
  format($$select public.unarchive_group(%s)$$, pg_temp.g1110_group('S1 #1110')),
  '42501', 'group_manage_forbidden',
  'unarchive_group: an inactive Manager on the path is refused');

reset role;
select pg_temp.g1110_as(9);
select throws_ok(
  format($$select public.unarchive_group(%s)$$, pg_temp.g1110_group('S1 #1110')),
  '42501', 'group_manage_forbidden',
  'unarchive_group: a Manager of an unrelated Group is refused');

reset role;
select pg_temp.g1110_as(6);
select throws_ok(
  format($$select public.unarchive_group(%s)$$, pg_temp.g1110_group('S1x #1110')),
  'PT409', 'group_parent_archived',
  'unarchive_group: an authorized Manager gets the real state conflict below an archived parent');

reset role;
select pg_temp.g1110_as(3);
select lives_ok(
  format($$select public.unarchive_group(%s)$$, pg_temp.g1110_group('S1 #1110')),
  'unarchive_group: the parent''s Group Manager unarchives the Child Group');
reset role;
select is(
  pg_temp.g1110_statuses(array['S1 #1110', 'S1x #1110', 'Sus #1110']),
  array['active', 'active', 'active'],
  'the Child Group returns with the archived Group below it');

select pg_temp.g1110_as(6);
select lives_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g1110_group('S1 #1110')),
  'fixture: the Child Group''s own Manager archives it again');
select lives_ok(
  format($$select public.unarchive_group(%s)$$, pg_temp.g1110_group('S1 #1110')),
  'unarchive_group: the Child Group''s own Group Manager unarchives it -- whoever may archive it');
reset role;
select is(
  pg_temp.g1110_statuses(array['S1 #1110', 'S1x #1110']),
  array['active', 'active'],
  'and its subtree is active again');

-- ==================== 6 · the Moderator ====================

select pg_temp.g1110_bc();
select lives_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g1110_group('Sus #1110')),
  'fixture: BC archives tree S');
reset role;
select pg_temp.g1110_as(3);
select throws_ok(
  format($$select public.unarchive_group(%s)$$, pg_temp.g1110_group('S1 #1110')),
  'PT409', 'group_parent_archived',
  'unarchive_group: the Manager on the path meets the archived parent');
reset role;
select pg_temp.g1110_moderator();
select lives_ok(
  format($$select public.unarchive_group(%s)$$, pg_temp.g1110_group('Sus #1110')),
  'unarchive_group: the Moderator unarchives a top-level Group');
reset role;
select is(
  pg_temp.g1110_statuses(array['S1 #1110', 'S1x #1110', 'Sus #1110']),
  array['active', 'active', 'active'],
  'the whole tree returns');
select is(
  (select status from public.groups where name = 'Separată #1110'),
  'archived',
  'the unrelated archived Group is still archived');

-- ==================== 7 · the return value ====================

select pg_temp.g1110_bc();
select is(
  (select (public.unarchive_group(pg_temp.g1110_group('Separată #1110'))).status),
  'active',
  'unarchive_group returns the Group''s row, now active');
reset role;

select * from finish();
rollback;
