-- #1087 (ruling R59): Member Deletion -- public.delete_member and
-- public.member_delete_preview.
--
-- What this suite pins, in the order each command answers:
--   1. the race, on COMMITTED fixtures, first: a Group Responsible appointed
--      while the deletion waits is seen and refuses it, never cascaded away;
--   2. the gate: claimless, anon, an inactive BC, a BCE, a Group Manager
--      below level 6 and oneself are refused; a null and an unknown id;
--   3. the preview of a freshly invited Member: nothing holds it, and it
--      names the rows that go with it;
--   4. the deletion: no row anywhere names the id afterwards, auth included,
--      another Member's Notification about it is gone and nothing else moves;
--   5. every kind of history holds the account (one fixture per kind, and a
--      table created after this migration holds it by default) and nothing
--      is written;
--   6. the last active BC member and the last active Moderator;
--   7. role_history stays immutable outside the command.
--
-- Fixture prefix 10870000-0000-0000-0000-0000000000NN; the committed race
-- fixtures use ...00000000009N and the Group '#1087 race'.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(43);

create function pg_temp.u(n integer) returns uuid language sql immutable as $$
  select ('10870000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- ==================== 1. The race ====================
-- Query A appoints the target Group Responsible of a committed Group and holds
-- its transaction; query B is the deletion. B must wait on A's row locks on
-- the target's Profile, then see the position and refuse. Without B's
-- `for update` on the Profile it would only wait at the cascade, delete the
-- account and take A's new roster row with it.

select extensions.dblink_connect('md_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('md_setup', 'set lock_timeout = ''2s''');
-- #621: committed fixtures from an interrupted run must not hang cleanup.
select extensions.dblink_exec('md_setup', $$
  drop function if exists public.test_1087_try_delete(uuid);
  delete from public.notifications
   where member_id in ('10870000-0000-0000-0000-000000000090', '10870000-0000-0000-0000-000000000091');
  delete from public.group_members where group_id in (select id from public.groups where name = '#1087 race');
  delete from public.groups where name = '#1087 race';
  delete from public.profiles
   where id in ('10870000-0000-0000-0000-000000000090', '10870000-0000-0000-0000-000000000091');
  delete from auth.users
   where id in ('10870000-0000-0000-0000-000000000090', '10870000-0000-0000-0000-000000000091');
  insert into auth.users (id, email) values
    ('10870000-0000-0000-0000-000000000090', 'race.bc.1087@test.local'),
    ('10870000-0000-0000-0000-000000000091', 'race.target.1087@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('10870000-0000-0000-0000-000000000090', 'Race BC 1087', 'race.bc.1087@test.local', 'bc', 'activ'),
    ('10870000-0000-0000-0000-000000000091', 'Race target 1087', 'race.target.1087@test.local', 'voluntar', 'activ');
  insert into public.groups (name, category, min_level) values ('#1087 race', 'department', 0);
  -- Test-only bridge: test_race aborts on an error from B, so B reports the
  -- refusal as text instead.
  create function public.test_1087_try_delete(p_member_id uuid) returns text
  language plpgsql set search_path = '' as $fn$
  begin
    perform public.delete_member(p_member_id);
    return 'deleted';
  exception when others then
    return sqlstate || ' ' || sqlerrm;
  end;
  $fn$;
  revoke execute on function public.test_1087_try_delete(uuid) from public, anon, authenticated, service_role;
  grant execute on function public.test_1087_try_delete(uuid) to authenticated;
$$);

select pg_temp.test_login_leadership('10870000-0000-0000-0000-000000000090');
reset role;

create temp table race1087 as select * from pg_temp.test_race(
  format($$select (public.set_group_role(%s, '10870000-0000-0000-0000-000000000091', 'responsible', 'Titlu #1087')).group_role::text$$,
         (select id from public.groups where name = '#1087 race')),
  $$select public.test_1087_try_delete('10870000-0000-0000-0000-000000000091')$$);
select is((select result_b from race1087), 'PT409 member_has_history',
  'a Group position appointed while the deletion waits holds the account: the deletion sees it and refuses');
select ok((select b_waited from race1087),
  'delete_member waits on the target Profile a concurrent Appointment holds');

select extensions.dblink_exec('md_setup', $$
  drop function public.test_1087_try_delete(uuid);
  delete from public.notifications
   where member_id in ('10870000-0000-0000-0000-000000000090', '10870000-0000-0000-0000-000000000091');
  delete from public.group_members where group_id in (select id from public.groups where name = '#1087 race');
  delete from public.groups where name = '#1087 race';
  delete from public.profiles
   where id in ('10870000-0000-0000-0000-000000000090', '10870000-0000-0000-0000-000000000091');
  delete from auth.users
   where id in ('10870000-0000-0000-0000-000000000090', '10870000-0000-0000-0000-000000000091');
$$);
select extensions.dblink_disconnect('md_setup');
select pg_temp.test_clear_jwt();

-- ==================== Fixtures ====================

insert into auth.users (id, email)
select pg_temp.u(n), 'member.' || n || '.1087@test.local'
  from generate_series(1, 40) n;

-- 1 BC (the deleter), 2 Moderator, 3 BCE, 4 a Voluntar who is a Group
-- Manager, 5 an inactive BC, 6 claimless, 7 a second Moderator kept inactive
-- until section 6; 10 the freshly invited Member; 20-33 one holding kind each.
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.u(n), 'Member #1087 ' || n, 'member.' || n || '.1087@test.local',
  (case n when 1 then 'bc' when 2 then 'moderator' when 3 then 'bce' when 5 then 'bc'
          when 7 then 'moderator' when 10 then 'recrut' when 31 then 'vot' else 'voluntar' end)::public.member_role,
  (case n when 5 then 'inactiv' when 7 then 'inactiv' else 'activ' end)::public.member_status
from generate_series(1, 40) n;

insert into public.groups (name, category, min_level) values
  ('Grup #1087', 'department', 0),
  ('Grup creat #1087', 'department', 0);
create function pg_temp.g(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;
update public.groups set created_by = pg_temp.u(28) where name = 'Grup creat #1087';

insert into public.group_members (group_id, member_id, group_role, position_title) values
  (pg_temp.g('Grup #1087'), pg_temp.u(4),  'manager',     null),
  (pg_temp.g('Grup #1087'), pg_temp.u(10), 'member',      null),
  (pg_temp.g('Grup #1087'), pg_temp.u(25), 'responsible', 'Responsabil #1087');

-- What an invitation and a mistaken account leave behind: an Appointment
-- (above), a Notification, a device, a Privacy Acknowledgement, an import
-- record, a deactivation in Role History, an Auth identity and a PKCE flow.
insert into public.notifications (member_id, kind, title) values
  (pg_temp.u(10), 'system', 'Bun venit #1087');
insert into public.push_tokens (member_id, token, platform) values
  (pg_temp.u(10), '{"endpoint":"https://push.example/1087"}', 'web');
insert into public.privacy_notice_acknowledgements (member_id, notice_version) values
  (pg_temp.u(10), '1.3');
insert into public.member_imports (member_id, sheet_email, sheet_row) values
  (pg_temp.u(10), 'member.10.1087@test.local', 2);
insert into public.role_history (member_id, from_role, to_role, from_status, to_status, changed_by, actor_kind, reason)
values (pg_temp.u(10), 'recrut', 'recrut', 'activ', 'inactiv', pg_temp.u(1), 'human', 'Cont creat din greșeală #1087');
update public.profiles set status = 'activ' where id = pg_temp.u(10);
insert into auth.identities (provider_id, user_id, identity_data, provider)
values (pg_temp.u(10)::text, pg_temp.u(10),
        jsonb_build_object('sub', pg_temp.u(10)::text, 'email', 'member.10.1087@test.local'), 'email');
insert into auth.flow_state (id, user_id, provider_type, authentication_method)
values (gen_random_uuid(), pg_temp.u(10), 'email', 'magiclink');
-- Another Member's Notification that names the account (the re-invite notice),
-- and one that does not.
insert into public.notifications (member_id, kind, title, body, link) values
  (pg_temp.u(1), 'system', 'Invitație retrimisă',
   'Invitația pentru Member #1087 10 a fost retrimisă la member.10.1087@test.local.',
   '/administrare/membri/' || pg_temp.u(10)),
  (pg_temp.u(1), 'system', 'Altceva #1087', null, '/administrare/membri/' || pg_temp.u(4));

-- One holding kind per Member.
insert into public.tasks (title, group_id, audience, assignment_mode, status, deadline, created_by) values
  ('Creat #1087',   pg_temp.g('Grup #1087'), 'local', 'direct', 'todo', now() + interval '9 days', pg_temp.u(20)),
  ('Atribuit #1087', pg_temp.g('Grup #1087'), 'local', 'direct', 'todo', now() + interval '9 days', pg_temp.u(4));
insert into public.tasks (title, group_id, audience, assignment_mode, status, deadline, queue_opened_at, created_by)
values ('Public #1087', pg_temp.g('Grup #1087'), 'local', 'public', 'todo', now() + interval '9 days', now(), pg_temp.u(4));
insert into public.tasks
  (title, group_id, audience, assignment_mode, status, difficulty, rating,
   created_at, started_at, completed_at, created_by) values
  ('Punctat #1087', pg_temp.g('Grup #1087'), 'local', 'direct', 'completed', 3, 4,
   now() - interval '9 days', now() - interval '8 days', now(), pg_temp.u(4));
create function pg_temp.task(p_title text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.tasks where title = p_title
$$;
insert into public.task_assignments (task_id, member_id, assigned_by)
values (pg_temp.task('Atribuit #1087'), pg_temp.u(21), pg_temp.u(4));
insert into public.task_candidates (task_id, member_id, status, joined_at)
values (pg_temp.task('Public #1087'), pg_temp.u(22), 'pending', now());
select pg_temp.test_credit_task(pg_temp.task('Punctat #1087'), pg_temp.u(23), pg_temp.u(4));
insert into public.events (title, type, starts_at, group_id, created_by)
values ('Eveniment #1087', 'activitate', now() + interval '5 days', pg_temp.g('Grup #1087'), pg_temp.u(4));
insert into public.event_attendance (event_id, member_id, status)
values ((select id from public.events where title = 'Eveniment #1087'), pg_temp.u(24), 'going');
insert into public.role_history (member_id, from_role, to_role, from_status, to_status, changed_by, actor_kind, reason)
values (pg_temp.u(4), 'recrut', 'voluntar', 'activ', 'activ', pg_temp.u(26), 'human', 'Promovat #1087');
-- The seat is one per role: the seeded Responsabil makes way (rolled back).
delete from public.assignment_team where team_role = 'responsible';
insert into public.assignment_team (assignment, team_role, member_id, set_by)
values ('osubb_deals', 'responsible', pg_temp.u(29), null);
insert into public.announcements (title, body, group_id, created_by)
values ('Anunț #1087', 'Text #1087.', pg_temp.g('Grup #1087'), pg_temp.u(30));
insert into public.retention_signals (kind, member_id, role_at_listing, reason)
values ('adunarea_generala', pg_temp.u(31), 'vot', 'not_ubb_student');
insert into public.member_imports (member_id, sheet_email, sheet_row, imported_by)
values (pg_temp.u(4), 'member.4.1087@test.local', 3, pg_temp.u(32));
-- A table created after the R59 migration, naming Members with a cascade:
-- nobody has decided it goes with an account, so it holds one.
create table public.test_1087_future (member_id uuid not null references public.profiles (id) on delete cascade);
insert into public.test_1087_future (member_id) values (pg_temp.u(33));

create function pg_temp.as_bc() returns void language sql as $$
  select pg_temp.test_login(pg_temp.u(1), '{"member_role":"bc","member_level":6}'::jsonb) $$;
create function pg_temp.as_moderator() returns void language sql as $$
  select pg_temp.test_login(pg_temp.u(2), '{"member_role":"moderator","member_level":9}'::jsonb) $$;

-- A refusal's SQLSTATE, message and DETAIL, as one value an assertion can diff.
create function pg_temp.refusal(p_sql text) returns jsonb
language plpgsql as $fn$
declare
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return jsonb_build_object('state', sqlstate, 'message', sqlerrm, 'detail', nullif(v_detail, ''));
end;
$fn$;

-- Every row in any table whose foreign key names p_id, read from the catalog
-- so a table added later is counted too.
create function pg_temp.rows_naming(p_id uuid) returns bigint
language plpgsql security definer set search_path = '' as $fn$
declare
  v_fk record;
  v_count bigint;
  v_total bigint := 0;
begin
  for v_fk in
    select c.conrelid::regclass as tbl, a.attname as col
      from pg_catalog.pg_constraint as c
      join pg_catalog.pg_attribute as a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
  loop
    execute format('select count(*) from %s where %I = $1', v_fk.tbl, v_fk.col) into v_count using p_id;
    v_total := v_total + v_count;
  end loop;
  return v_total
       + (select count(*) from public.profiles where id = p_id)
       + (select count(*) from auth.users where id = p_id)
       + (select count(*) from auth.flow_state where user_id = p_id);
end;
$fn$;

-- ==================== 2. The gate ====================

select pg_temp.test_login(pg_temp.u(6), '{}'::jsonb);
select throws_ok(format('select public.delete_member(%L)', pg_temp.u(10)),
  '42501', 'member_manage_forbidden', 'a claimless caller cannot delete a Member');
select throws_ok(format('select public.member_delete_preview(%L)', pg_temp.u(10)),
  '42501', 'member_manage_forbidden', 'a claimless caller cannot read the preview');

reset role;
set local role anon;
select throws_ok(format('select public.delete_member(%L)', pg_temp.u(10)),
  '42501', null, 'anon cannot execute delete_member');
reset role;

select pg_temp.test_login(pg_temp.u(5), '{"member_role":"bc","member_level":6}'::jsonb);
select throws_ok(format('select public.delete_member(%L)', pg_temp.u(10)),
  '42501', 'member_manage_forbidden', 'an inactive BC still holding a level-6 token cannot delete a Member');

select pg_temp.test_login(pg_temp.u(3), '{"member_role":"bce","member_level":5}'::jsonb);
select throws_ok(format('select public.delete_member(%L)', pg_temp.u(10)),
  '42501', 'member_manage_forbidden', 'a BCE cannot delete a Member');
select throws_ok(format('select public.member_delete_preview(%L)', pg_temp.u(10)),
  '42501', 'member_manage_forbidden', 'a BCE cannot read the preview');

select pg_temp.test_login(pg_temp.u(4), '{"member_role":"voluntar","member_level":1}'::jsonb);
select throws_ok(format('select public.delete_member(%L)', pg_temp.u(10)),
  '42501', 'member_manage_forbidden', 'the Group Manager of the Member''s Group cannot delete them below level 6');

select pg_temp.as_bc();
select throws_ok(format('select public.delete_member(%L)', pg_temp.u(1)),
  '42501', 'member_manage_forbidden', 'nobody deletes themselves');
select throws_ok('select public.delete_member(null)',
  'PT400', 'invalid_member', 'a null Member is malformed');
select throws_ok($$select public.delete_member('10870000-0000-0000-0000-00000000ffff')$$,
  'PT404', 'member_not_found', 'an unknown Member is not found');
select throws_ok($$select public.member_delete_preview('10870000-0000-0000-0000-00000000ffff')$$,
  'PT404', 'member_not_found', 'the preview of an unknown Member is not found');

-- ==================== 3. The preview of a freshly invited Member ====================

-- Counted as owner: a trigger may add the account a Notification of its own
-- (its deactivation notice), and RLS would hide nothing from BC anyway.
reset role;
create temp table own1087 as
select (select count(*) from public.notifications where member_id = pg_temp.u(10)) as notifications;
grant select on own1087 to authenticated;
select pg_temp.as_bc();

select is(public.member_delete_preview(pg_temp.u(10)),
  jsonb_build_object(
    'holds', '{}'::jsonb,
    'goes', jsonb_build_object(
      'group_members', 1, 'member_imports', 1, 'notifications', (select notifications from own1087),
      'privacy_notice_acknowledgements', 1, 'push_tokens', 1, 'role_history', 1),
    'last_holder', null),
  'a freshly invited Member: nothing holds the account, and the preview names what goes with it');
select is(public.member_delete_preview(pg_temp.u(25))->'holds',
  '{"group_members.member_id": 1}'::jsonb,
  'a Group position is named by its roster column; an ordinary membership is not');

-- ==================== 4. The deletion ====================

reset role;
create temp table before1087 as
select (select count(*) from public.role_history) as role_history,
       (select count(*) from public.group_members) as group_members,
       (select count(*) from public.profiles) as profiles,
       (select count(*) from public.notifications where link = '/administrare/membri/' || pg_temp.u(4)) as other_notice;

select pg_temp.as_bc();
select is(public.delete_member(pg_temp.u(10)), jsonb_build_object('member_id', pg_temp.u(10)),
  'BC deletes a freshly invited Member and is answered with its id');
reset role;
select is(pg_temp.rows_naming(pg_temp.u(10)), 0::bigint,
  'no row in any table names the deleted Member: Profile, sign-in, identities, flow state, own rows');
select is((select count(*) from public.notifications where link = '/administrare/membri/' || pg_temp.u(10)), 0::bigint,
  'another Member''s Notification naming the deleted account is gone');
select is((select count(*) from public.notifications where link = '/administrare/membri/' || pg_temp.u(4)),
          (select other_notice from before1087),
  'a Notification about anyone else stays');
select results_eq(
  $$ select (select count(*) from public.role_history), (select count(*) from public.group_members),
            (select count(*) from public.profiles) $$,
  $$ select role_history - 1, group_members - 1, profiles - 1 from before1087 $$,
  'exactly the Member''s own Role History row, roster row and Profile went; nothing else moved');
select is(current_setting('osubb.deleting_member_id', true), '',
  'the command clears its role_history exception before it returns');

-- ==================== 5. History holds the account ====================

create function pg_temp.held(p_member uuid, p_key text) returns jsonb
language plpgsql as $fn$
declare
  v_preview jsonb;
  v_refusal jsonb;
begin
  perform pg_temp.as_bc();
  v_preview := public.member_delete_preview(p_member);
  v_refusal := pg_temp.refusal(format('select public.delete_member(%L)', p_member));
  reset role;
  return jsonb_build_object(
    'previewed', v_preview->'holds' ? p_key,
    'state', v_refusal->>'state',
    'message', v_refusal->>'message',
    'named', coalesce(v_refusal->>'detail', '') like '%' || p_key || '=%');
end;
$fn$;
create function pg_temp.expect_held() returns jsonb language sql immutable as $$
  select '{"previewed": true, "state": "PT409", "message": "member_has_history", "named": true}'::jsonb
$$;

select is(pg_temp.held(pg_temp.u(20), 'tasks.created_by'), pg_temp.expect_held(),
  'a Task the Member created holds the account');
select is(pg_temp.held(pg_temp.u(21), 'task_assignments.member_id'), pg_temp.expect_held(),
  'an Assignment holds the account (the Assignment History cascade is never reached)');
select is(pg_temp.held(pg_temp.u(22), 'task_candidates.member_id'), pg_temp.expect_held(),
  'a Candidature holds the account');
select is(pg_temp.held(pg_temp.u(23), 'points_ledger.member_id'), pg_temp.expect_held(),
  'Task Points hold the account (the Points Ledger cascade is never reached)');
select is(pg_temp.held(pg_temp.u(24), 'event_attendance.member_id'), pg_temp.expect_held(),
  'an RSVP holds the account');
select is(pg_temp.held(pg_temp.u(25), 'group_members.member_id'), pg_temp.expect_held(),
  'a Group Responsible position holds the account');
select is(pg_temp.held(pg_temp.u(26), 'role_history.changed_by'), pg_temp.expect_held(),
  'a Role change the Member decided for someone else holds the account');
select is(pg_temp.held(pg_temp.u(28), 'groups.created_by'), pg_temp.expect_held(),
  'a Group the Member created holds the account, though its column would only be set null');
select is(pg_temp.held(pg_temp.u(29), 'assignment_team.member_id'), pg_temp.expect_held(),
  'a seat on the OSUBB Deals team holds the account');
select is(pg_temp.held(pg_temp.u(30), 'announcements.created_by'), pg_temp.expect_held(),
  'an Announcement holds the account');
select is(pg_temp.held(pg_temp.u(31), 'retention_signals.member_id'), pg_temp.expect_held(),
  'a Retention Signal holds the account');
select is(pg_temp.held(pg_temp.u(32), 'member_imports.imported_by'), pg_temp.expect_held(),
  'an import the Member ran holds the account');
select is(pg_temp.held(pg_temp.u(33), 'test_1087_future.member_id'), pg_temp.expect_held(),
  'a table added later holds the account until someone decides its rows go with it');
select pg_temp.as_bc();
select is(pg_temp.refusal(format('select public.delete_member(%L)', pg_temp.u(20)))->>'detail',
  'tasks.created_by=1',
  'the DETAIL names each holding column with its count');
reset role;
select is((select count(*) from public.profiles where id = any (array[
            pg_temp.u(20), pg_temp.u(21), pg_temp.u(22), pg_temp.u(23), pg_temp.u(24), pg_temp.u(25),
            pg_temp.u(26), pg_temp.u(28), pg_temp.u(29), pg_temp.u(30), pg_temp.u(31), pg_temp.u(32),
            pg_temp.u(33)])), 13::bigint,
  'every refused Member is still there');

-- ==================== 6. The last active BC member and Moderator ====================
-- The fixtures are the organization's whole leadership: every other live BC
-- and Moderator (the seeded demo accounts) is set aside for this transaction.

update public.profiles set status = 'inactiv'
 where role in ('bc', 'moderator') and status = 'activ' and id::text not like '10870000-%';

select pg_temp.as_bc();
select is(public.member_delete_preview(pg_temp.u(2))->'last_holder', '"moderator"'::jsonb,
  'the preview says the Member is the last active Moderator');
select throws_ok(format('select public.delete_member(%L)', pg_temp.u(2)),
  'PT409', 'member_is_last_moderator', 'the last active Moderator cannot be deleted');
select pg_temp.as_moderator();
select throws_ok(format('select public.delete_member(%L)', pg_temp.u(1)),
  'PT409', 'member_is_last_bc', 'the last active BC member cannot be deleted');
reset role;
update public.profiles set status = 'activ' where id = pg_temp.u(7);
select pg_temp.as_bc();
select is(public.delete_member(pg_temp.u(2)), jsonb_build_object('member_id', pg_temp.u(2)),
  'with a second active Moderator, a Moderator with no history is deleted');

-- ==================== 7. role_history stays immutable ====================

reset role;
select throws_ok(format('delete from public.role_history where member_id = %L', pg_temp.u(4)),
  '23514', 'role_history_immutable', 'outside the command, a Role History row is still immutable');
create function pg_temp.delete_history_naming(p_deleting uuid, p_member uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('osubb.deleting_member_id', p_deleting::text, true);
  delete from public.role_history where member_id = p_member;
end;
$fn$;
select throws_ok(format('select pg_temp.delete_history_naming(%L, %L)', pg_temp.u(26), pg_temp.u(4)),
  '23514', 'role_history_immutable', 'the exception admits only the Member being deleted, never a row about another');
select ok(not has_table_privilege('authenticated', 'public.role_history', 'DELETE')
          and not has_table_privilege('service_role', 'public.role_history', 'DELETE')
          and not has_table_privilege('anon', 'public.role_history', 'DELETE'),
  'no client role may delete Role History at all, so only the command reaches the exception');

select * from finish();
rollback;
