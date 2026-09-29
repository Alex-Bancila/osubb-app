-- member_rank_authority.test.sql — #905 (ruling R31): every BC member, not
-- only the Moderator, grants and removes the BC and Moderator ranks through
-- public.set_member_role, and the organization never loses its last live
-- Moderator or its last live BC: whoever removes the last holder names the
-- replacement (p_replacement_id) in the same call, the actor included.
--
-- Section 2 is a real two-session race and therefore commits: its fixtures
-- are written through a setup connection and removed at the end, and every
-- other live BC in the database (the seeded demo BC) is deactivated for the
-- race and reactivated afterwards from a committed restore list, so an
-- interrupted run is repaired by the next one. It runs before any fixture of
-- this transaction exists, so nothing here holds a row the race needs.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(42);

-- ==================== 1. Structure ====================

select has_function('public', 'set_member_role', array['uuid', 'member_role', 'text', 'uuid'],
  'set_member_role takes an optional replacement (#905)');
select hasnt_function('public', 'set_member_role', array['uuid', 'member_role', 'text'],
  'and the three-argument overload is gone, so PostgREST resolves one function');
select is(has_function_privilege('authenticated', 'private.apply_member_role(uuid, public.member_role, uuid, text)', 'execute'), false,
  'the rank-change effect has no gate of its own, so no client role executes it');
select matches(
  obj_description('public.set_member_role(uuid, public.member_role, text, uuid)'::regprocedure, 'pg_proc'),
  'ruling R31',
  'set_member_role''s comment states ruling R31');

-- ==================== 2. Race: the last two BC members removed at once ====================
-- Two calls, each removing one of the only two live BC members, by two
-- different Moderators (so no shared actor row can serialize them by
-- accident). Without the holder locks each call counts the other's target as
-- the BC who remains, both commit, and the organization has no BC. With them
-- the second call waits for the first, counts again after it commits, and is
-- told it is removing the last BC.

select extensions.dblink_connect('r905_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres', current_database()));
-- #621: committed fixtures from an interrupted run must not hang cleanup.
select extensions.dblink_exec('r905_setup', 'set lock_timeout = ''2s''');
select extensions.dblink_exec('r905_setup', $setup$
  drop function if exists public.test_905_demote(uuid, uuid);
  do $repair$
  begin
    if to_regclass('public.test_905_restore') is not null then
      update public.profiles set status = 'activ'
       where id in (select id from public.test_905_restore);
      drop table public.test_905_restore;
    end if;
  end
  $repair$;
  delete from public.notifications where member_id::text like '90500000-0000-0000-0000-0000000000a%';
  set session_replication_role = 'replica';
  delete from public.role_history
   where member_id::text like '90500000-0000-0000-0000-0000000000a%'
      or changed_by::text like '90500000-0000-0000-0000-0000000000a%';
  set session_replication_role = 'origin';
  delete from auth.users where id::text like '90500000-0000-0000-0000-0000000000a%';
  insert into auth.users (id, email) values
    ('90500000-0000-0000-0000-0000000000a1', 'mod.race905@test.local'),
    ('90500000-0000-0000-0000-0000000000a2', 'bcx.race905@test.local'),
    ('90500000-0000-0000-0000-0000000000a3', 'bcy.race905@test.local'),
    ('90500000-0000-0000-0000-0000000000a4', 'mod2.race905@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('90500000-0000-0000-0000-0000000000a1', 'Moderator cursă 905', 'mod.race905@test.local', 'moderator', 'activ'),
    ('90500000-0000-0000-0000-0000000000a2', 'BC cursă X 905',      'bcx.race905@test.local', 'bc',        'activ'),
    ('90500000-0000-0000-0000-0000000000a3', 'BC cursă Y 905',      'bcy.race905@test.local', 'bc',        'activ'),
    ('90500000-0000-0000-0000-0000000000a4', 'Moderator 2 cursă 905', 'mod2.race905@test.local', 'moderator', 'activ');
  create table public.test_905_restore as
    select id from public.profiles
     where role = 'bc' and status = 'activ'
       and id::text not like '90500000-%';
  revoke all on table public.test_905_restore from public, anon, authenticated, service_role;
  update public.profiles set status = 'inactiv'
   where id in (select id from public.test_905_restore);
  create function public.test_905_demote(p_member uuid, p_actor uuid) returns text
  language plpgsql set search_path = '' as $fn$
  begin
    perform pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
      'sub', p_actor, 'role', 'authenticated',
      'app_metadata', pg_catalog.jsonb_build_object('member_role', 'moderator', 'member_level', 9))::text, true);
    return (public.set_member_role(p_member, 'bce')).role::text;
  exception when sqlstate 'PT409' then
    return sqlstate || ':' || sqlerrm;
  end;
  $fn$;
  revoke execute on function public.test_905_demote(uuid, uuid) from public, anon, authenticated, service_role;
  grant execute on function public.test_905_demote(uuid, uuid) to authenticated;
$setup$);

select pg_temp.test_login('90500000-0000-0000-0000-0000000000a1',
  '{"member_role": "moderator", "member_level": 9}'::jsonb);
reset role;
create temp table race905 as
  select * from pg_temp.test_race(
    $$ select public.test_905_demote('90500000-0000-0000-0000-0000000000a2', '90500000-0000-0000-0000-0000000000a1') $$,
    $$ select public.test_905_demote('90500000-0000-0000-0000-0000000000a3', '90500000-0000-0000-0000-0000000000a4') $$);
select pg_temp.test_clear_jwt();

select is((select result_a from race905), 'bce',
  'the first removal of one of the last two BC members commits');
select ok((select b_waited from race905),
  'the second removal waits on the leadership holders the first one locked');
select is((select result_b from race905), 'PT409:last_bc_needs_replacement',
  'and, counting again after the first commits, is told it removes the last BC');
select is(
  (select count(*) from public.profiles
    where id in ('90500000-0000-0000-0000-0000000000a2', '90500000-0000-0000-0000-0000000000a3')
      and role = 'bc' and status = 'activ'),
  1::bigint, 'one of the two is still a live BC member');

select extensions.dblink_exec('r905_setup', $cleanup$
  drop function public.test_905_demote(uuid, uuid);
  update public.profiles set status = 'activ'
   where id in (select id from public.test_905_restore);
  drop table public.test_905_restore;
  delete from public.notifications where member_id::text like '90500000-0000-0000-0000-0000000000a%';
  set session_replication_role = 'replica';
  delete from public.role_history
   where member_id::text like '90500000-0000-0000-0000-0000000000a%'
      or changed_by::text like '90500000-0000-0000-0000-0000000000a%';
  set session_replication_role = 'origin';
  delete from auth.users where id::text like '90500000-0000-0000-0000-0000000000a%';
$cleanup$);
select extensions.dblink_disconnect('r905_setup');

-- ==================== Fixtures ====================

insert into auth.users (id, email) values
  ('90500000-0000-0000-0000-000000000001', 'mod905@test.local'),
  ('90500000-0000-0000-0000-000000000002', 'bca905@test.local'),
  ('90500000-0000-0000-0000-000000000003', 'bcb905@test.local'),
  ('90500000-0000-0000-0000-000000000004', 'bce905@test.local'),
  ('90500000-0000-0000-0000-000000000005', 'vola905@test.local'),
  ('90500000-0000-0000-0000-000000000006', 'volb905@test.local'),
  ('90500000-0000-0000-0000-000000000007', 'inactiv905@test.local'),
  ('90500000-0000-0000-0000-000000000008', 'claimless905@test.local'),
  ('90500000-0000-0000-0000-000000000009', 'bcstale905@test.local');

insert into profiles (id, full_name, email, role, status) values
  ('90500000-0000-0000-0000-000000000001', 'Moderator 905',     'mod905@test.local',       'moderator', 'activ'),
  ('90500000-0000-0000-0000-000000000002', 'BC 905 A',          'bca905@test.local',       'bc',        'activ'),
  ('90500000-0000-0000-0000-000000000003', 'BC 905 B',          'bcb905@test.local',       'bc',        'activ'),
  ('90500000-0000-0000-0000-000000000004', 'BCE 905',           'bce905@test.local',       'bce',       'activ'),
  ('90500000-0000-0000-0000-000000000005', 'Voluntar 905 A',    'vola905@test.local',      'voluntar',  'activ'),
  ('90500000-0000-0000-0000-000000000006', 'Voluntar 905 B',    'volb905@test.local',      'voluntar',  'activ'),
  ('90500000-0000-0000-0000-000000000007', 'Inactiv 905',       'inactiv905@test.local',   'voluntar',  'inactiv'),
  ('90500000-0000-0000-0000-000000000008', 'Fără claims 905',   'claimless905@test.local', 'voluntar',  'activ'),
  -- Deactivated, but still holding the level-6 token it was issued (ADR-0003).
  ('90500000-0000-0000-0000-000000000009', 'BC dezactivat 905', 'bcstale905@test.local',   'bc',        'inactiv');

-- The fixtures are the organization's whole leadership: every other live BC
-- and Moderator (the seeded demo accounts) is set aside for this transaction,
-- so "the last holder" below means exactly the fixture named.
update profiles set status = 'inactiv'
 where role in ('bc', 'moderator')
   and status = 'activ'
   and id::text not like '90500000-%';

-- ==================== 3. Who may not ====================
-- The change asked for is Voluntar A to BC, which a BC member may now make.

select pg_temp.test_login_leadership('90500000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.set_member_role('90500000-0000-0000-0000-000000000005', 'bc') $$,
  '42501', 'member_manage_forbidden',
  'a BCE grants no leadership rank');
select throws_ok(
  $$ select public.set_member_role('90500000-0000-0000-0000-000000000001', 'bce', null,
       '90500000-0000-0000-0000-000000000004') $$,
  '42501', 'member_manage_forbidden',
  'and cannot unseat the last Moderator by naming themselves as the replacement');
reset role;

select pg_temp.test_login_leadership('90500000-0000-0000-0000-000000000006');
select throws_ok(
  $$ select public.set_member_role('90500000-0000-0000-0000-000000000005', 'bc') $$,
  '42501', 'member_manage_forbidden',
  'an ordinary Member grants nothing');
reset role;

select pg_temp.test_login('90500000-0000-0000-0000-000000000008', '{}'::jsonb);
select throws_ok(
  $$ select public.set_member_role('90500000-0000-0000-0000-000000000005', 'bc') $$,
  '42501', 'member_manage_forbidden',
  'a claimless session grants nothing');
reset role;

select pg_temp.test_login('90500000-0000-0000-0000-000000000009', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'group_ids', '[]'::jsonb));
select throws_ok(
  $$ select public.set_member_role('90500000-0000-0000-0000-000000000005', 'bc') $$,
  '42501', 'member_manage_forbidden',
  'a deactivated BC holding a still-valid level-6 token grants nothing');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(
  $$ select public.set_member_role('90500000-0000-0000-0000-000000000005', 'bc') $$,
  '42501', null,
  'anon cannot even execute the command');
reset role;

-- Self-change as a BC member: with R31 no rank branch refuses a BC any more,
-- so only the self-rule can be answering.
select pg_temp.test_login_leadership('90500000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.set_member_role('90500000-0000-0000-0000-000000000002', 'bce') $$,
  '42501', 'member_manage_forbidden',
  'a BC member does not re-rank themselves');
select throws_ok(
  $$ select public.set_member_role('90500000-0000-0000-0000-000000000002', 'bce', null,
       '90500000-0000-0000-0000-000000000003') $$,
  '42501', 'member_manage_forbidden',
  'not even while naming somebody else as a replacement');

-- ==================== 4. BC grants and removes BC and Moderator ====================

select is(
  (select role::text from public.set_member_role('90500000-0000-0000-0000-000000000005', 'bc')),
  'bc', 'a BC member grants BC (ruling R31)');
select is(
  (select role::text from public.set_member_role('90500000-0000-0000-0000-000000000006', 'moderator')),
  'moderator', 'a BC member grants Moderator');
select is(
  (select role::text from public.set_member_role('90500000-0000-0000-0000-000000000005', 'voluntar')),
  'voluntar', 'a BC member removes BC while another BC remains');
select is(
  (select role::text from public.set_member_role('90500000-0000-0000-0000-000000000006', 'voluntar')),
  'voluntar', 'a BC member removes Moderator while another Moderator remains');
reset role;
select is(
  (select count(*) from role_history
    where member_id in ('90500000-0000-0000-0000-000000000005', '90500000-0000-0000-0000-000000000006')
      and changed_by = '90500000-0000-0000-0000-000000000002'),
  4::bigint, 'each of the four changes wrote one role_history row naming the BC member');

-- ==================== 5. A replacement where none is needed ====================

select pg_temp.test_login_leadership('90500000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.set_member_role('90500000-0000-0000-0000-000000000005', 'activ', null,
       '90500000-0000-0000-0000-000000000006') $$,
  'PT400', 'replacement_not_needed',
  'a replacement named for an ordinary rank change is refused');
select throws_ok(
  $$ select public.set_member_role('90500000-0000-0000-0000-000000000003', 'bce', null,
       '90500000-0000-0000-0000-000000000005') $$,
  'PT400', 'replacement_not_needed',
  'and so is one named when another live BC remains');
select throws_ok(
  $$ select public.set_member_role('90500000-0000-0000-0000-000000000001', 'bce', null,
       '90500000-0000-0000-0000-000000000001') $$,
  'PT400', 'replacement_is_target',
  'the Member leaving the rank cannot be its replacement');

-- ==================== 6. The last Moderator ====================
-- Moderator 905 is now the only live Moderator.

select throws_ok(
  $$ select public.set_member_role('90500000-0000-0000-0000-000000000001', 'bce') $$,
  'PT409', 'last_moderator_needs_replacement',
  'removing the last Moderator without a replacement is refused');
select throws_ok(
  $$ select public.set_member_role('90500000-0000-0000-0000-000000000001', 'bce', null,
       '90500000-0000-0000-0000-000000000007') $$,
  'PT400', 'replacement_inactive',
  'an inactive replacement is refused');
select throws_ok(
  $$ select public.set_member_role('90500000-0000-0000-0000-000000000001', 'bce', null,
       '90500000-0000-0000-0000-0000000000ff') $$,
  'PT404', 'replacement_not_found',
  'an unknown replacement is refused');
reset role;
select is(
  (select format('%s|%s', role, (select count(*) from role_history
                                  where member_id = '90500000-0000-0000-0000-000000000001'))
     from profiles where id = '90500000-0000-0000-0000-000000000001'),
  'moderator|0', 'a refused call changed nothing and wrote no history');

select pg_temp.test_login_leadership('90500000-0000-0000-0000-000000000002');
select is(
  (select role::text from public.set_member_role('90500000-0000-0000-0000-000000000001', 'bce',
     'Predare', '90500000-0000-0000-0000-000000000005')),
  'bce', 'with a replacement the BC member unseats the last Moderator');
reset role;
select is(
  (select role::text from profiles where id = '90500000-0000-0000-0000-000000000005'),
  'moderator', 'and the replacement holds Moderator');
select is(
  (select string_agg(format('%s|%s>%s|%s|%s', member_id, from_role, to_role, changed_by, reason), ' ; ' order by id)
     from role_history
    where (member_id = '90500000-0000-0000-0000-000000000005' and to_role = 'moderator')
       or member_id = '90500000-0000-0000-0000-000000000001'),
  '90500000-0000-0000-0000-000000000005|voluntar>moderator|90500000-0000-0000-0000-000000000002|Predare ; '
  || '90500000-0000-0000-0000-000000000001|moderator>bce|90500000-0000-0000-0000-000000000002|Predare',
  'two role_history rows, the replacement''s first, each naming the real actor');
select is(
  (select body from notifications
    where member_id = '90500000-0000-0000-0000-000000000005' order by id desc limit 1),
  'Rolul tău în OSUBB este acum Moderator.', 'the replacement is told of their new Role');
select is(
  (select body from notifications
    where member_id = '90500000-0000-0000-0000-000000000001' order by id desc limit 1),
  'Rolul tău în OSUBB este acum BCE.', 'and the former Moderator of theirs');
select is(
  (select count(*) from notifications where member_id = '90500000-0000-0000-0000-000000000002'),
  0::bigint, 'the actor is notified of neither');

-- ==================== 7. The last Moderator, the actor as replacement ====================
-- Voluntar A is now the only live Moderator; BC B names themselves.

select pg_temp.test_login_leadership('90500000-0000-0000-0000-000000000003');
select is(
  (select role::text from public.set_member_role('90500000-0000-0000-0000-000000000005', 'voluntar',
     null, '90500000-0000-0000-0000-000000000003')),
  'voluntar', 'the actor may name themselves as the replacement — the one self-change allowed');
reset role;
select is(
  (select format('%s|%s>%s|%s|%s', profile.role, history.from_role, history.to_role, history.changed_by, history.reason)
     from profiles as profile
     join role_history as history on history.member_id = profile.id
    where profile.id = '90500000-0000-0000-0000-000000000003'),
  'moderator|bc>moderator|90500000-0000-0000-0000-000000000003|Named replacement for the last moderator (set_member_role)',
  'the actor now holds Moderator, with their own history row and the fallback reason');
select is(
  (select count(*) from notifications where member_id = '90500000-0000-0000-0000-000000000003'),
  0::bigint, 'and no Notification of their own change');

-- ==================== 8. The last BC ====================
-- BC A is now the only live BC; BC B (the actor above) the only live Moderator.

select pg_temp.test_login_leadership('90500000-0000-0000-0000-000000000003');
select throws_ok(
  $$ select public.set_member_role('90500000-0000-0000-0000-000000000002', 'bce') $$,
  'PT409', 'last_bc_needs_replacement',
  'removing the last BC without a replacement is refused');
select throws_ok(
  $$ select public.set_member_role('90500000-0000-0000-0000-000000000002', 'bce', null,
       '90500000-0000-0000-0000-000000000003') $$,
  'PT409', 'replacement_is_last_moderator',
  'the last Moderator cannot become the replacement BC — that would empty the Moderator rank');
reset role;
select pg_temp.test_login_leadership('90500000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.set_member_role('90500000-0000-0000-0000-000000000003', 'bce', null,
       '90500000-0000-0000-0000-000000000002') $$,
  'PT409', 'replacement_is_last_bc',
  'and the last BC cannot become the replacement Moderator');
reset role;
select pg_temp.test_login_leadership('90500000-0000-0000-0000-000000000003');
select is(
  (select role::text from public.set_member_role('90500000-0000-0000-0000-000000000002', 'moderator',
     null, '90500000-0000-0000-0000-000000000003')),
  'moderator', 'a swap is allowed: the target takes the rank the replacement leaves');
reset role;
select is(
  (select format('%s|%s',
     (select string_agg(id::text, ',') from profiles where role = 'moderator' and status = 'activ'),
     (select string_agg(id::text, ',') from profiles where role = 'bc' and status = 'activ'))),
  '90500000-0000-0000-0000-000000000002|90500000-0000-0000-0000-000000000003',
  'after every change above the organization still has exactly one live Moderator and one live BC');

select * from finish();
rollback;
