-- evaluation_rankings_read.test.sql -- #512: who reads the Adunarea
-- Generală's eligibility data in full.
--
-- private.can_read_evaluation_rankings() decides the full read of
-- public.evaluation_period_ranking (and, when it lands, #48's retention
-- ranking): BC and the Moderator (live level >= 6), and the Group Managers and
-- Group Responsibles of the Adunarea Generală Group or of any ancestor of it,
-- read from groups.path. Every other live active Member reads their own row.
-- The Adunarea Generală is the Group org_settings.adunarea_generala_group_id
-- names -- by row, never by name.
--
-- In order: the predicate's shape and grants, the persona matrix over one
-- open Period, the predicate called directly (the shape #48 will reuse), and
-- the setting -- its table CHECK, set_org_setting's rules for the new key, and
-- re-pointing / clearing it moving the full read with it.
--
-- Fixtures. "Diverse 512" is a root Group; "AG 512" is its Child Group with
-- Automatic Membership at Minimum Level 3 and is the Group the setting names;
-- "Comisia AG 512" is a Child Group of AG 512; a decoy Group literally named
-- "Adunarea Generală" sits beside AG 512. The Periods and the setting are
-- written as the owner inside this rolled-back transaction -- the fixture
-- exception of conventions section 10 (#701's commands are exercised in
-- evaluation_period_commands.test.sql).
-- The open Period opens at now(), so only this suite's awards fall inside it.
--
-- Mutation guards, each named against the assertion that turns red (every
-- one was run on 2026-09-25 and turned its named assertion red):
--   * widen the own-row branch to every row -> "the ordinary AG member Ana
--     reads exactly her own row" (and every other own-row assertion);
--   * `held.group_id = target.id` for `held.group_id = any (target.path)` ->
--     "the ancestor Group's Manager reads the full ranking";
--   * drop `group_role in ('manager', 'responsible')` -> "Victor, an ordinary
--     member of the AG's parent Group, reads exactly his own row";
--   * `>= 5` for `>= 6` -> "a BCE with no Group Role reads only their own
--     row";
--   * match the Group by name instead of the setting -> "the decoy Group
--     named Adunarea Generală confers nothing" and "re-pointing the setting
--     moves the full read";
--   * drop the live caller_level() >= 0 from the Group-Role branch -> "the
--     predicate refuses a deactivated AG Responsible's still-valid token";
--   * drop auth_is_member() from the predicate -> "the predicate is false
--     for the AG Responsible's uid without organization claims".
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(44);

-- ==================== Fixtures ====================

insert into auth.users (id, email) values
  ('51200000-0000-0000-0000-000000000001', 'bc512@test.local'),
  ('51200000-0000-0000-0000-000000000002', 'mod512@test.local'),
  ('51200000-0000-0000-0000-000000000003', 'bcstale512@test.local'),
  ('51200000-0000-0000-0000-000000000004', 'bce512@test.local'),
  ('51200000-0000-0000-0000-000000000005', 'manager512@test.local'),
  ('51200000-0000-0000-0000-000000000006', 'resp512@test.local'),
  ('51200000-0000-0000-0000-000000000007', 'ancestor512@test.local'),
  ('51200000-0000-0000-0000-000000000008', 'ana512@test.local'),
  ('51200000-0000-0000-0000-000000000009', 'bianca512@test.local'),
  ('51200000-0000-0000-0000-000000000010', 'victor512@test.local'),
  ('51200000-0000-0000-0000-000000000011', 'comisia512@test.local'),
  ('51200000-0000-0000-0000-000000000012', 'decoy512@test.local'),
  ('51200000-0000-0000-0000-000000000013', 'respstale512@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('51200000-0000-0000-0000-000000000001', 'BC 512',                  'bc512@test.local',        'bc',        'activ'),
  ('51200000-0000-0000-0000-000000000002', 'Moderator 512',           'mod512@test.local',       'moderator', 'activ'),
  -- Deactivated, still holding the level-6 token it was issued (ADR-0003).
  ('51200000-0000-0000-0000-000000000003', 'BC dezactivat 512',       'bcstale512@test.local',   'bc',        'inactiv'),
  ('51200000-0000-0000-0000-000000000004', 'BCE 512',                 'bce512@test.local',       'bce',       'activ'),
  ('51200000-0000-0000-0000-000000000005', 'Manager AG 512',          'manager512@test.local',   'vot',       'activ'),
  ('51200000-0000-0000-0000-000000000006', 'Responsabil AG 512',      'resp512@test.local',      'vot',       'activ'),
  -- A Voluntar (level 1): the ancestor Group Role is the whole authority.
  ('51200000-0000-0000-0000-000000000007', 'Manager Diverse 512',     'ancestor512@test.local',  'voluntar',  'activ'),
  ('51200000-0000-0000-0000-000000000008', 'Ana AG 512',              'ana512@test.local',       'vot',       'activ'),
  ('51200000-0000-0000-0000-000000000009', 'Bianca AG 512',           'bianca512@test.local',    'vot',       'activ'),
  ('51200000-0000-0000-0000-000000000010', 'Victor 512',              'victor512@test.local',    'voluntar',  'activ'),
  ('51200000-0000-0000-0000-000000000011', 'Responsabil Comisia 512', 'comisia512@test.local',   'vot',       'activ'),
  ('51200000-0000-0000-0000-000000000012', 'Responsabil momeală 512', 'decoy512@test.local',     'vot',       'activ'),
  -- An AG Responsible deactivated with the token still in hand.
  ('51200000-0000-0000-0000-000000000013', 'Responsabil dezactivat 512', 'respstale512@test.local', 'vot',    'inactiv');

insert into public.groups (name, category, min_level) values ('Diverse 512', 'department', 0);
insert into public.groups (name, category, parent_id, min_level, automatic_membership)
select fixture.name, 'team', parent.id, 3, fixture.automatic
  from (values ('AG 512', true), ('Adunarea Generală', true)) as fixture (name, automatic)
  cross join public.groups as parent
 where parent.name = 'Diverse 512';
insert into public.groups (name, category, parent_id, min_level)
select 'Comisia AG 512', 'team', parent.id, 3
  from public.groups as parent where parent.name = 'AG 512';
-- An archived Group, for the setting's target rule.
insert into public.groups (name, category, min_level, status)
values ('Arhivat 512', 'team', 0, 'archived');

create temp table fx512 as
  select (select id from public.groups where name = 'Diverse 512')    as ancestor,
         (select id from public.groups where name = 'AG 512')         as ag,
         (select id from public.groups where name = 'Comisia AG 512') as child,
         (select id from public.groups where name = 'Adunarea Generală'
                                          and parent_id = (select id from public.groups where name = 'Diverse 512')) as decoy,
         (select id from public.groups where name = 'Arhivat 512')    as archived;
grant select on fx512 to authenticated, anon;

insert into public.group_members (group_id, member_id, group_role)
select fixture.group_id, fixture.member_id::uuid, fixture.group_role
  from fx512,
       lateral (values
         (fx512.ag,       '51200000-0000-0000-0000-000000000005', 'manager'),
         (fx512.ag,       '51200000-0000-0000-0000-000000000006', 'responsible'),
         (fx512.ag,       '51200000-0000-0000-0000-000000000013', 'responsible'),
         (fx512.ancestor, '51200000-0000-0000-0000-000000000007', 'manager'),
         -- An ordinary roster row on the AG's parent Group: membership on the
         -- path is not authority.
         (fx512.ancestor, '51200000-0000-0000-0000-000000000010', 'member'),
         (fx512.child,    '51200000-0000-0000-0000-000000000011', 'responsible'),
         (fx512.decoy,    '51200000-0000-0000-0000-000000000012', 'responsible')
       ) as fixture (group_id, member_id, group_role);

-- The Adunarea Generală is AG 512, by row.
update public.org_settings set value = (select ag from fx512)::text
 where key = 'adunarea_generala_group_id';

-- One open Period (#47). The reset database holds no Period, so this is the
-- only open one (evaluation_periods_open_uidx).
insert into public.evaluation_periods (name, opened_at, opened_by)
values ('Perioada deschisă #512', now(), '51200000-0000-0000-0000-000000000001');
alter table fx512 add column period bigint;
update fx512 set period = (select id from public.evaluation_periods where name = 'Perioada deschisă #512');

-- In-Period Task Points (difficulty x rating_mult(rating)):
-- Ana 4 x 3 = 12, Victor 3 x 3 = 9, Bianca 2 x 3 = 6, the AG Responsible 1 x 2 = 2.
insert into public.tasks
  (title, description, deadline, group_id, status, difficulty, rating,
   created_by, created_at, completed_at)
select fixture.title, 'Fixture', now() - interval '2 days', (select ancestor from fx512),
       'completed', fixture.difficulty, fixture.rating, '51200000-0000-0000-0000-000000000001',
       now() - interval '3 days', now()
  from (values ('Ana #512', 4, 5), ('Victor #512', 3, 5),
               ('Bianca #512', 2, 5), ('Responsabil #512', 1, 4)) as fixture (title, difficulty, rating);
select pg_temp.test_credit_task(task.id, credit.member_id, '51200000-0000-0000-0000-000000000001')
  from (values ('Ana #512',         '51200000-0000-0000-0000-000000000008'::uuid),
               ('Victor #512',      '51200000-0000-0000-0000-000000000010'),
               ('Bianca #512',      '51200000-0000-0000-0000-000000000009'),
               ('Responsabil #512', '51200000-0000-0000-0000-000000000006')) as credit (title, member_id)
  join public.tasks as task on task.title = credit.title
 order by task.id;

create function pg_temp.login_stale(p_uid uuid, p_role text, p_level integer) returns void language sql as $$
  select pg_temp.test_login(p_uid, jsonb_build_object(
    'member_role', p_role, 'member_level', p_level,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb, 'group_ids', '[]'::jsonb));
$$;

-- The full ranking, for the full-read assertions.
create temp table full512 (member_id uuid, task_points integer, rank integer);
insert into full512 values
  ('51200000-0000-0000-0000-000000000008', 12, 1),
  ('51200000-0000-0000-0000-000000000010',  9, 2),
  ('51200000-0000-0000-0000-000000000009',  6, 3),
  ('51200000-0000-0000-0000-000000000006',  2, 4);
grant select on full512 to authenticated;

create function pg_temp.ranking() returns text language sql as $$
  select format('select member_id, task_points, rank from public.evaluation_period_ranking(%s)',
                (select period from fx512));
$$;
grant execute on function pg_temp.ranking() to authenticated;

-- ==================== 1. The predicate ====================

select has_function('private', 'can_read_evaluation_rankings', array[]::text[],
  'private.can_read_evaluation_rankings() exists');
select is(
  (select array[p.prosecdef::text, p.provolatile::text, coalesce(array_to_string(p.proconfig, ','), '')]
     from pg_proc p where p.oid = 'private.can_read_evaluation_rankings()'::regprocedure),
  array['true', 's', 'search_path=""'],
  'the predicate is security definer, stable, with an empty search_path (house rule 4)');
select is(
  array[has_function_privilege('authenticated', 'private.can_read_evaluation_rankings()', 'execute'),
        has_function_privilege('anon', 'private.can_read_evaluation_rankings()', 'execute'),
        has_function_privilege('service_role', 'private.can_read_evaluation_rankings()', 'execute'),
        has_function_privilege('public', 'private.can_read_evaluation_rankings()', 'execute')],
  array[false, false, false, false],
  'the predicate is executable by nobody -- security-definer bodies read it');
select ok(
  pg_get_functiondef('private.can_read_evaluation_rankings()'::regprocedure) ~ 'any \(target\.path\)'
  and pg_get_functiondef('private.can_read_evaluation_rankings()'::regprocedure) ~ 'adunarea_generala_group_id'
  and pg_get_functiondef('private.can_read_evaluation_rankings()'::regprocedure) !~ 'Adunarea Generală',
  'the predicate reads groups.path and the setting, and names no Group');
select ok(
  pg_get_functiondef('private.can_read_evaluation_rankings()'::regprocedure) !~* 'is_interne|responsabil|>= *4'
  and pg_get_functiondef('private.evaluation_period_ranking_impl(bigint)'::regprocedure) !~* 'is_interne|responsabil|>= *4|>= *5',
  'neither the predicate nor the ranking body reads is_interne, the retired rank or level 4 or 5');

-- ==================== 2. Full read ====================

select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000001');
select results_eq(pg_temp.ranking(), $$ select * from full512 order by task_points desc, member_id $$,
  'BC reads the full ranking');
reset role;

select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000002');
select results_eq(pg_temp.ranking(), $$ select * from full512 order by task_points desc, member_id $$,
  'the Moderator reads the full ranking');
reset role;

select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000006');
select results_eq(pg_temp.ranking(), $$ select * from full512 order by task_points desc, member_id $$,
  'the AG''s Group Responsible reads the full ranking');
reset role;

select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000005');
select results_eq(pg_temp.ranking(), $$ select * from full512 order by task_points desc, member_id $$,
  'the AG''s Group Manager reads the full ranking');
reset role;

select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000007');
select results_eq(pg_temp.ranking(), $$ select * from full512 order by task_points desc, member_id $$,
  'the ancestor Group''s Manager reads the full ranking -- authority flows down groups.path, whatever their rank');
reset role;

-- ==================== 3. Own row only ====================

select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000008');
select results_eq(pg_temp.ranking(),
  $$ values ('51200000-0000-0000-0000-000000000008'::uuid, 12, 1) $$,
  'the ordinary AG member Ana (Drept de Vot) reads exactly her own row');
reset role;

select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000009');
select results_eq(pg_temp.ranking(),
  $$ values ('51200000-0000-0000-0000-000000000009'::uuid, 6, 3) $$,
  'the ordinary AG member Bianca reads exactly her own row, at her rank among everyone');
reset role;

select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000010');
select results_eq(pg_temp.ranking(),
  $$ values ('51200000-0000-0000-0000-000000000010'::uuid, 9, 2) $$,
  'Victor, an ordinary member of the AG''s parent Group and not in the AG, reads exactly his own row');
reset role;

select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000004');
select is((select count(*) from public.evaluation_period_ranking((select period from fx512))), 0::bigint,
  'a BCE with no Group Role reads only their own row -- none here: level 5 is not the full read');
reset role;

select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000011');
select is((select count(*) from public.evaluation_period_ranking((select period from fx512))), 0::bigint,
  'a Group Responsible of a Child Group of the AG reads only their own row -- authority does not flow up');
reset role;

select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000012');
select is((select count(*) from public.evaluation_period_ranking((select period from fx512))), 0::bigint,
  'the decoy Group named Adunarea Generală confers nothing -- the AG is identified by row, not by name');
reset role;

-- ==================== 4. Nothing ====================

select pg_temp.test_login('51200000-0000-0000-0000-000000000006', '{}'::jsonb);
select is((select count(*) from public.evaluation_period_ranking((select period from fx512))), 0::bigint,
  'a claimless session -- the AG Responsible''s own uid -- reads nothing (house rule 12)');
reset role;

select pg_temp.test_clear_jwt();
set local role authenticated;
select is((select count(*) from public.evaluation_period_ranking((select period from fx512))), 0::bigint,
  'a session with no JWT at all reads nothing');
reset role;

select pg_temp.login_stale('51200000-0000-0000-0000-000000000003', 'bc', 6);
select is((select count(*) from public.evaluation_period_ranking((select period from fx512))), 0::bigint,
  'an inactive Member holding stale BC claims reads nothing');
reset role;

select pg_temp.login_stale('51200000-0000-0000-0000-000000000013', 'vot', 3);
select is((select count(*) from public.evaluation_period_ranking((select period from fx512))), 0::bigint,
  'a deactivated AG Responsible''s still-valid token reads nothing');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(
  $$ select * from public.evaluation_period_ranking((select period from fx512)) $$,
  '42501', null,
  'anon cannot execute the ranking');
reset role;

-- ==================== 5. The predicate called directly ====================
-- As #48 will call it: from an owner-run body, with the caller's claims set.

select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000006');
reset role;
select is(private.can_read_evaluation_rankings(), true,
  'the predicate holds for the AG Responsible');
select pg_temp.test_login('51200000-0000-0000-0000-000000000006', '{}'::jsonb);
reset role;
select is(private.can_read_evaluation_rankings(), false,
  'the predicate is false for the AG Responsible''s uid without organization claims');
select pg_temp.login_stale('51200000-0000-0000-0000-000000000013', 'vot', 3);
reset role;
select is(private.can_read_evaluation_rankings(), false,
  'the predicate refuses a deactivated AG Responsible''s still-valid token');
select pg_temp.login_stale('51200000-0000-0000-0000-000000000003', 'bc', 6);
reset role;
select is(private.can_read_evaluation_rankings(), false,
  'the predicate refuses a deactivated BC''s still-valid token');
select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000008');
reset role;
select is(private.can_read_evaluation_rankings(), false,
  'the predicate is false for an ordinary AG member');
select pg_temp.test_clear_jwt();
select is(private.can_read_evaluation_rankings(), false,
  'the predicate is false with no caller at all');

-- ==================== 6. The setting ====================

select throws_ok(
  $$ update public.org_settings set value = 'AG' where key = 'adunarea_generala_group_id' $$,
  '23514', 'new row for relation "org_settings" violates check constraint "org_settings_adunarea_generala_group_id_ck"',
  'org_settings_adunarea_generala_group_id_ck: a direct write must be a Group id');

select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000008');
select throws_ok(
  $$ select public.set_org_setting('adunarea_generala_group_id', 'Adunarea Generală') $$,
  'PT400', 'invalid_org_setting_value',
  'a value that is not a Group id is malformed for every caller, an ordinary Member included (step 1)');
select throws_ok(
  $$ select public.set_org_setting('adunarea_generala_group_id', '999999999999') $$,
  '42501', 'org_settings_manage_forbidden',
  'an ordinary Member naming an unknown Group id is refused by the gate -- nobody below BC probes Group ids');
reset role;

select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000004');
select throws_ok(
  format($$ select public.set_org_setting('adunarea_generala_group_id', '%s') $$, (select decoy from fx512)),
  '42501', 'org_settings_manage_forbidden',
  'a BCE cannot point the setting anywhere');
reset role;

select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000001');
select throws_ok(
  $$ select public.set_org_setting('adunarea_generala_group_id', '0') $$,
  'PT400', 'invalid_org_setting_value',
  'BC: zero is not a Group id');
select throws_ok(
  $$ select public.set_org_setting('adunarea_generala_group_id', '999999999999') $$,
  'PT400', 'invalid_org_setting_value',
  'BC: an id naming no Group is refused');
select throws_ok(
  format($$ select public.set_org_setting('adunarea_generala_group_id', '%s') $$, (select archived from fx512)),
  'PT400', 'invalid_org_setting_value',
  'BC: an archived Group cannot be named the Adunarea Generală');
select throws_ok(
  format($$ select public.set_org_setting('adunarea_generala_group_id', '%s') $$, (select ag from fx512)),
  'PT409', 'nothing_to_update',
  'BC: naming the Group already named is nothing_to_update');
select lives_ok(
  format($$ select public.set_org_setting('adunarea_generala_group_id', ' %s ') $$, (select decoy from fx512)),
  'BC re-points the setting at another Group (the value is trimmed)');
reset role;

select results_eq(
  $$ select value, updated_by from public.org_settings where key = 'adunarea_generala_group_id' $$,
  format($$ values (%L::text, '51200000-0000-0000-0000-000000000001'::uuid) $$, (select decoy from fx512)::text),
  'the setting stores the trimmed Group id and records BC as updated_by');

select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000012');
select results_eq(pg_temp.ranking(), $$ select * from full512 order by task_points desc, member_id $$,
  're-pointing the setting moves the full read: the newly named Group''s Responsible reads every row');
reset role;
select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000006');
select is((select count(*) from public.evaluation_period_ranking((select period from fx512))), 1::bigint,
  'and the previous AG''s Responsible is back to their own row');
reset role;
select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000007');
select results_eq(pg_temp.ranking(), $$ select * from full512 order by task_points desc, member_id $$,
  'the shared ancestor''s Manager still reads every row');
reset role;

select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.set_org_setting('adunarea_generala_group_id', '  ') $$,
  'BC clears the setting with a blank value');
select is((select value from public.org_settings where key = 'adunarea_generala_group_id'), null::text,
  'a cleared setting is null');
select results_eq(pg_temp.ranking(), $$ select * from full512 order by task_points desc, member_id $$,
  'with no Adunarea Generală named, BC still reads every row');
reset role;
select pg_temp.test_login_leadership('51200000-0000-0000-0000-000000000007');
select is((select count(*) from public.evaluation_period_ranking((select period from fx512))), 0::bigint,
  'with no Adunarea Generală named, no Group Role reads the full ranking -- the ancestor Manager reads their own row, none here');
reset role;

select * from finish();
rollback;
