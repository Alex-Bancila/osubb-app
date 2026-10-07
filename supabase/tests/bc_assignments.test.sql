-- Ruling R44 (2026-10-07): Atribuții BC. The Moderator gives an Atribuție to
-- exactly one BC member; the first is Responsabil OSUBB Deals ('osubb_deals').
-- Its holder picks a Coordonator (a BCE member) and a Responsabil (any active
-- Member); the Coordonator picks only the Responsabil; the Moderator picks either
-- place without being on the team -- they hold every Atribuție's powers (R44
-- amended 2026-10-08), but never the Atribuție itself. Taking the Atribuție away
-- dissolves the team and tells the three. Capabilities read live rows.
--
-- Mutation proofs (each run once against this suite, then reverted): see the
-- PR body and docs/backend/deals.md -- every named rule below fails its own
-- assertions when its line in the migration is removed.
--
-- Personas (prefix 4444):
--   1 moderator  2 bc (holder A)  3 bc (holder B)  4 bce (Coordonator)
--   5 bce        6 voluntar (Responsabil)  7 voluntar  8 bc, inactiv  9 recrut
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(80);

create function pg_temp.u44(n integer) returns uuid language sql immutable as $$
  select ('44440000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users(id, email)
select pg_temp.u44(n), 'atributii.' || n || '.r44@test.local' from generate_series(1, 9) n;
insert into public.profiles(id, full_name, email, role, status)
select pg_temp.u44(n), 'Atribuții R44 ' || n, 'atributii.' || n || '.r44@test.local',
       (case n when 1 then 'moderator' when 2 then 'bc' when 3 then 'bc' when 4 then 'bce'
               when 5 then 'bce' when 8 then 'bc' when 9 then 'recrut' else 'voluntar' end)::public.member_role,
       (case n when 8 then 'inactiv' else 'activ' end)::public.member_status
  from generate_series(1, 9) n;

-- ==================== Two first grants at once ====================
-- No row exists to lock before the first grant, so set_bc_assignment takes a
-- transaction advisory lock per Atribuție: the second of two concurrent first
-- grants waits, then hears bc_assignment_held -- never a raw unique_violation.
-- Fixtures are committed through a second connection because dblink sessions
-- cannot see rows inside this pgTAP transaction; the demo seed's holder and team
-- are set aside there and put back afterwards.
select extensions.dblink_connect('r44_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('r44_setup', 'set lock_timeout = ''2s''');
select extensions.dblink_exec('r44_setup', $$
  delete from auth.users where id::text like '44440000-0000-0000-0000-00000000002%';
  create temp table saved_bc as select * from public.bc_assignments;
  create temp table saved_team as select * from public.assignment_team;
  delete from public.bc_assignments;
  insert into auth.users (id, email)
  select ('44440000-0000-0000-0000-00000000002' || n)::uuid, 'race.' || n || '.r44@test.local'
    from generate_series(1, 3) n;
  insert into public.profiles (id, full_name, email, role, status)
  select ('44440000-0000-0000-0000-00000000002' || n)::uuid, 'Race R44 ' || n, 'race.' || n || '.r44@test.local',
         (case n when 1 then 'moderator' else 'bc' end)::public.member_role, 'activ'
    from generate_series(1, 3) n;
$$);
select pg_temp.test_login('44440000-0000-0000-0000-000000000021',
  '{"member_role":"moderator","member_level":9,"group_ids":[]}'::jsonb);
reset role;
select throws_ok($outer$
  select * from pg_temp.test_race(
    $$ select (public.set_bc_assignment('osubb_deals', '44440000-0000-0000-0000-000000000022', true)).member_id::text $$,
    $$ select (public.set_bc_assignment('osubb_deals', '44440000-0000-0000-0000-000000000023', true)).member_id::text $$)
$outer$, 'PT409', 'bc_assignment_held',
  'of two concurrent first grants, the second waits and hears bc_assignment_held, not a unique_violation');
select is((select holder from extensions.dblink('r44_setup', $$
  select string_agg(member_id::text, ',') from public.bc_assignments $$) as result(holder text)),
  '44440000-0000-0000-0000-000000000022', 'exactly one holder was committed: the first');
select extensions.dblink_exec('r44_setup', $$
  delete from public.bc_assignments;
  delete from auth.users where id::text like '44440000-0000-0000-0000-00000000002%';
  insert into public.bc_assignments select * from saved_bc on conflict do nothing;
  insert into public.assignment_team select * from saved_team on conflict do nothing;
$$);
select extensions.dblink_disconnect('r44_setup');

-- The demo seed's holder and team are not part of the rest of this suite.
delete from public.bc_assignments;

create function pg_temp.notified(p_title text) returns integer[] language sql stable as $$
  select coalesce(array_agg(right(member_id::text, 12)::integer order by right(member_id::text, 12)::integer), '{}')
    from public.notifications
   where title = p_title and member_id::text like '44440000-%'
$$;
create function pg_temp.caps() returns text language sql stable as $$
  select format('%s,%s,%s,%s,%s', c.administer::text, c.administer_bc::text, c.manage_deals::text,
                c.manage_deals_team::text, c.pick_deals_coordinator::text)
    from public.my_capabilities() as c
$$;
grant execute on function pg_temp.u44(integer), pg_temp.notified(text), pg_temp.caps() to authenticated, anon;

-- ==================== API surface ====================
select ok(not has_function_privilege('anon', 'public.set_bc_assignment(text, uuid, boolean, boolean)', 'execute')
      and not has_function_privilege('anon', 'public.set_assignment_team_member(text, text, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.bc_assignments_directory()', 'execute'),
  'anon executes none of the three Atribuție functions');
select ok(has_function_privilege('authenticated', 'public.set_bc_assignment(text, uuid, boolean, boolean)', 'execute')
      and has_function_privilege('authenticated', 'public.set_assignment_team_member(text, text, uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.bc_assignments_directory()', 'execute'),
  'authenticated executes all three; their gates are inside');
select ok(not has_table_privilege('authenticated', 'public.bc_assignments', 'insert')
      and not has_table_privilege('authenticated', 'public.bc_assignments', 'update')
      and not has_table_privilege('authenticated', 'public.bc_assignments', 'delete')
      and not has_table_privilege('authenticated', 'public.assignment_team', 'insert')
      and not has_table_privilege('authenticated', 'public.assignment_team', 'update')
      and not has_table_privilege('authenticated', 'public.assignment_team', 'delete'),
  'no direct writes on bc_assignments or assignment_team: the two commands are the only write path');

-- ==================== Moderator-only grant ====================
select pg_temp.test_login_leadership(pg_temp.u44(2));
select throws_ok($$select public.set_bc_assignment('osubb_deals', pg_temp.u44(2), true)$$,
  '42501', 'bc_assignment_forbidden', 'a BC member cannot give an Atribuție, not even to themselves');
reset role;
select pg_temp.test_login_leadership(pg_temp.u44(4));
select throws_ok($$select public.set_bc_assignment('osubb_deals', pg_temp.u44(2), true)$$,
  '42501', 'bc_assignment_forbidden', 'a BCE member cannot give an Atribuție');
reset role;
select pg_temp.test_clear_jwt();
set local role authenticated;
select throws_ok($$select public.set_bc_assignment('osubb_deals', pg_temp.u44(2), true)$$,
  '42501', 'bc_assignment_forbidden', 'a claimless caller cannot give an Atribuție');
reset role;
select pg_temp.test_login('44440000-0000-0000-0000-000000000001', '{"provider":"email"}'::jsonb);
select throws_ok($$select public.set_bc_assignment('osubb_deals', pg_temp.u44(2), true)$$,
  '42501', 'bc_assignment_forbidden', 'the Moderator without organization claims cannot either');
reset role;

select pg_temp.test_login_leadership(pg_temp.u44(1));
select throws_ok($$select public.set_bc_assignment('pagina_interne', pg_temp.u44(2), true)$$,
  'PT400', 'invalid_assignment', 'an unknown Atribuție is invalid_assignment');
select throws_ok($$select public.set_bc_assignment('osubb_deals', null, true)$$,
  'PT400', 'bc_assignment_not_bc', 'no member is not a BC member');

-- ==================== BC-only target ====================
select throws_ok($$select public.set_bc_assignment('osubb_deals', pg_temp.u44(4), true)$$,
  'PT400', 'bc_assignment_not_bc', 'a BCE member cannot hold an Atribuție');
select throws_ok($$select public.set_bc_assignment('osubb_deals', pg_temp.u44(1), true)$$,
  'PT400', 'bc_assignment_not_bc', 'the Moderator cannot hold an Atribuție');
select throws_ok($$select public.set_bc_assignment('osubb_deals', pg_temp.u44(8), true)$$,
  'PT400', 'bc_assignment_not_bc', 'an inactive BC member cannot hold an Atribuție');

select is((public.set_bc_assignment('osubb_deals', pg_temp.u44(2), true)).member_id, pg_temp.u44(2),
  'the Moderator gives Responsabil OSUBB Deals to a live BC member');
reset role;
select is(pg_temp.notified('Ai primit atribuția Responsabil OSUBB Deals'), array[2],
  'the new holder is told "Ai primit atribuția Responsabil OSUBB Deals"');
select is((select link from public.notifications
            where title = 'Ai primit atribuția Responsabil OSUBB Deals' and member_id = pg_temp.u44(2)),
  '/administrare/deals', 'and the Notification opens Administrare › OSUBB Deals');
select is((select granted_by from public.bc_assignments where assignment = 'osubb_deals'), pg_temp.u44(1),
  'granted_by records the Moderator');

-- ==================== One holder; move ====================
select pg_temp.test_login_leadership(pg_temp.u44(1));
select lives_ok($$select public.set_bc_assignment('osubb_deals', pg_temp.u44(2), true)$$,
  'giving it again to its holder changes nothing');
select throws_ok($$select public.set_bc_assignment('osubb_deals', pg_temp.u44(3), true)$$,
  'PT409', 'bc_assignment_held', 'a second BC member cannot be given a held Atribuție without p_move');
reset role;
select is((select count(*) from public.bc_assignments)::int, 1, 'there is exactly one holder row');

-- ==================== Team rules ====================
select pg_temp.test_login_leadership(pg_temp.u44(7));
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u44(7))$$,
  '42501', 'assignment_team_forbidden', 'a member outside the team cannot pick the team');
reset role;
select pg_temp.test_login_leadership(pg_temp.u44(3));
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u44(4))$$,
  '42501', 'assignment_team_forbidden', 'another BC member cannot pick the team');
reset role;
select pg_temp.test_login_leadership(pg_temp.u44(2));
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'leader', pg_temp.u44(4))$$,
  'PT400', 'invalid_team_role', 'an unknown place is invalid_team_role');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u44(6))$$,
  'PT400', 'coordinator_not_bce', 'the Coordonator must be a BCE member (a Voluntar is refused)');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u44(3))$$,
  'PT400', 'coordinator_not_bce', 'the Coordonator must be a BCE member (a BC member is refused)');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u44(8))$$,
  'PT400', 'invalid_team_member', 'the Responsabil must be an active Member');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u44(2))$$,
  'PT400', 'assignment_team_duplicate', 'the holder cannot also be the Responsabil');
select is((public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u44(4))).member_id, pg_temp.u44(4),
  'the holder picks a BCE member as Coordonator');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u44(4))$$,
  'PT400', 'assignment_team_duplicate', 'the Coordonator cannot also be the Responsabil');
reset role;
select is(pg_temp.notified('Ești acum Coordonator OSUBB Deals'), array[4],
  'the Coordonator is told "Ești acum Coordonator OSUBB Deals"');

select pg_temp.test_login_leadership(pg_temp.u44(4));
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u44(5))$$,
  '42501', 'assignment_team_forbidden', 'the Coordonator cannot pick the Coordonator');
select is((public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u44(7))).member_id, pg_temp.u44(7),
  'the Coordonator picks the Responsabil');
select is((public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u44(6))).member_id, pg_temp.u44(6),
  'and replaces them');
reset role;
select is(pg_temp.notified('Ești acum Responsabil OSUBB Deals'), array[6, 7],
  'each Responsabil set is told "Ești acum Responsabil OSUBB Deals"');
select is(pg_temp.notified('Nu mai ești Responsabil OSUBB Deals'), array[7],
  'the replaced Responsabil is told "Nu mai ești Responsabil OSUBB Deals"');
select pg_temp.test_login_leadership(pg_temp.u44(6));
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u44(7))$$,
  '42501', 'assignment_team_forbidden', 'the Responsabil cannot pick the team');
reset role;
select pg_temp.test_login_leadership(pg_temp.u44(3));
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u44(7))$$,
  '42501', 'assignment_team_forbidden', 'a BC member who does not hold it cannot pick the Responsabil either');
reset role;

-- ==================== The Moderator sets the team (R44 amended 2026-10-08) ====================
-- Alex: "I, as a moderator should also be able to select all members of the
-- team". The Moderator is not on the team; the same validations hold.
delete from public.notifications where member_id::text like '44440000-%';
select pg_temp.test_login_leadership(pg_temp.u44(1));
select is((public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u44(5))).member_id, pg_temp.u44(5),
  'the Moderator picks the Coordonator without being on the team');
select is((public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u44(7))).member_id, pg_temp.u44(7),
  'the Moderator picks the Responsabil without being on the team');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u44(6))$$,
  'PT400', 'coordinator_not_bce', 'the Moderator''s Coordonator must still be a BCE member');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u44(2))$$,
  'PT400', 'assignment_team_duplicate', 'the Moderator cannot make the holder the Responsabil');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u44(5))$$,
  'PT400', 'assignment_team_duplicate', 'the Moderator cannot make the Coordonator the Responsabil');
reset role;
select is(pg_temp.notified('Ești acum Coordonator OSUBB Deals') || pg_temp.notified('Nu mai ești Coordonator OSUBB Deals'),
  array[5, 4], 'the Coordonator the Moderator set is told, and the one replaced');
select is((select count(*) from public.notifications
            where member_id = pg_temp.u44(1) and member_id::text like '44440000-%')::int, 0,
  'the Moderator is not told anything: they are not on the team');
select is((select set_by from public.assignment_team where team_role = 'responsible'), pg_temp.u44(1),
  'set_by records the Moderator');
-- Live rows, not the token: a Moderator demoted to BC keeps the token but loses the power.
update public.profiles set role = 'bc' where id = pg_temp.u44(1);
select pg_temp.test_login('44440000-0000-0000-0000-000000000001',
  '{"member_role":"moderator","member_level":9,"group_ids":[]}'::jsonb);
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u44(6))$$,
  '42501', 'assignment_team_forbidden', 'a Moderator demoted to BC cannot pick the team, whatever the token says');
reset role;
update public.profiles set role = 'moderator' where id = pg_temp.u44(1);
-- The team as the rest of this suite expects it: Coordonator 4, Responsabil 6.
select pg_temp.test_login_leadership(pg_temp.u44(1));
select is((public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u44(4))).member_id, pg_temp.u44(4),
  'the Moderator replaces the Coordonator they set');
select is((public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u44(6))).member_id, pg_temp.u44(6),
  'and the Responsabil');
reset role;

-- ==================== Reads ====================
select pg_temp.test_login_leadership(pg_temp.u44(7));
select is((select count(*) from public.bc_assignments)::int, 1, 'every live Member reads who holds the Atribuție');
select is((select count(*) from public.assignment_team)::int, 2, 'every live Member reads the team');
select throws_ok($$insert into public.assignment_team (assignment, team_role, member_id) values ('osubb_deals', 'coordinator', pg_temp.u44(7))$$,
  '42501', null, 'a direct write into the team is refused');
select throws_ok($$select * from public.bc_assignments_directory()$$,
  '42501', 'bc_assignment_forbidden', 'only the Moderator reads Administrare BC''s list (a Voluntar is refused)');
reset role;
select pg_temp.test_login_leadership(pg_temp.u44(2));
select throws_ok($$select * from public.bc_assignments_directory()$$,
  '42501', 'bc_assignment_forbidden', 'a BC member does not read Administrare BC''s list');
reset role;
select pg_temp.test_clear_jwt();
set local role authenticated;
select is((select count(*) from public.bc_assignments)::int + (select count(*) from public.assignment_team)::int, 0,
  'a claimless caller reads neither table');
reset role;
select pg_temp.test_login_leadership(pg_temp.u44(1));
select is((select array_agg(right(member_id::text, 12)::integer order by member_id)
             from public.bc_assignments_directory() where member_id::text like '44440000-%'),
  array[2, 3], 'the Moderator''s list is every live BC member -- not the inactive one, not BCE, never the Moderator, who holds every Atribuție''s powers');
select is((select assignments -> 0 -> 'team' -> 0 ->> 'team_role' || ':' || (assignments -> 0 ->> 'label')
             from public.bc_assignments_directory() where member_id = pg_temp.u44(2)),
  'coordinator:Responsabil OSUBB Deals', 'the holder''s row carries the Atribuție, its label and its team');
reset role;

-- ==================== Capabilities per persona ====================
-- administer, administer_bc, manage_deals, manage_deals_team, pick_deals_coordinator
select pg_temp.test_login_leadership(pg_temp.u44(2));
select is(pg_temp.caps(), 'true,false,true,true,true', 'holder: every Deals capability, administer, no administer_bc');
reset role;
select pg_temp.test_login_leadership(pg_temp.u44(4));
select is(pg_temp.caps(), 'true,false,true,true,false', 'Coordonator: manages Deals and the team, never picks the Coordonator');
reset role;
select pg_temp.test_login_leadership(pg_temp.u44(6));
select is(pg_temp.caps(), 'true,false,true,false,false', 'Responsabil: manage_deals alone, which opens Administrare');
reset role;
select pg_temp.test_login_leadership(pg_temp.u44(3));
select is(pg_temp.caps(), 'true,false,false,false,false', 'another BC member: administer by rank, no Deals capability');
reset role;
select pg_temp.test_login_leadership(pg_temp.u44(7));
select is(pg_temp.caps(), 'false,false,false,false,false', 'a Voluntar outside the team: nothing');
reset role;
select pg_temp.test_login_leadership(pg_temp.u44(1));
select is(pg_temp.caps(), 'true,true,true,true,true',
  'the Moderator: administer_bc and every Deals capability -- every Atribuție''s powers (R44 amended)');
reset role;
select pg_temp.test_login('44440000-0000-0000-0000-000000000006', '{"provider":"email"}'::jsonb);
select is(pg_temp.caps(), 'false,false,false,false,false', 'the Responsabil without organization claims: nothing');
reset role;
-- Live rows, not the token: a Coordonator demoted below BCE loses the place's power.
update public.profiles set role = 'vot' where id = pg_temp.u44(4);
select pg_temp.test_login('44440000-0000-0000-0000-000000000004',
  '{"member_role":"bce","member_level":5,"group_ids":[]}'::jsonb);
select is(pg_temp.caps(), 'false,false,false,false,false', 'a Coordonator demoted below BCE keeps the row but no capability, whatever the token says');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u44(7))$$,
  '42501', 'assignment_team_forbidden', 'nor the power to pick the Responsabil');
reset role;
update public.profiles set role = 'bce' where id = pg_temp.u44(4);

-- ==================== Move keeps the team ====================
select pg_temp.test_login_leadership(pg_temp.u44(1));
select is((public.set_bc_assignment('osubb_deals', pg_temp.u44(3), true, true)).member_id, pg_temp.u44(3),
  'p_move gives the Atribuție to another BC member');
reset role;
select is((select array_agg(right(member_id::text, 12)::integer order by team_role) from public.assignment_team),
  array[4, 6], 'the move keeps the Coordonator and the Responsabil');
select is(pg_temp.notified('Atribuția Responsabil OSUBB Deals a fost retrasă'), array[2],
  'the old holder is told the Atribuție was taken from them');
select pg_temp.test_login_leadership(pg_temp.u44(2));
select is(pg_temp.caps(), 'true,false,false,false,false', 'the old holder keeps no Deals capability');
reset role;
select pg_temp.test_login_leadership(pg_temp.u44(3));
select is(pg_temp.caps(), 'true,false,true,true,true', 'the new holder has every Deals capability');
reset role;

-- ==================== Dissolve on ungrant ====================
delete from public.notifications where member_id::text like '44440000-%';
select pg_temp.test_login_leadership(pg_temp.u44(1));
select lives_ok($$select public.set_bc_assignment('osubb_deals', pg_temp.u44(2), false)$$,
  'taking it from someone who does not hold it changes nothing');
reset role;
select is((select count(*) from public.bc_assignments)::int, 1, 'the holder still holds it');
select pg_temp.test_login_leadership(pg_temp.u44(1));
select lives_ok($$select public.set_bc_assignment('osubb_deals', pg_temp.u44(3), false)$$,
  'the Moderator takes the Atribuție away from its holder');
reset role;
select is((select count(*) from public.bc_assignments)::int + (select count(*) from public.assignment_team)::int, 0,
  'the Atribuție and its team are gone');
select is(pg_temp.notified('Atribuția Responsabil OSUBB Deals a fost retrasă'), array[3, 4, 6],
  'the holder, the Coordonator and the Responsabil are told "Atribuția Responsabil OSUBB Deals a fost retrasă"');
select is((select count(*) from public.notifications
            where title = 'Atribuția Responsabil OSUBB Deals a fost retrasă'
              and member_id::text like '44440000-%'
              and (kind <> 'system' or link is not null or subject is not null))::int, 0,
  'those Notifications are kind system, with no link and no subject');
select pg_temp.test_login_leadership(pg_temp.u44(6));
select is(pg_temp.caps(), 'false,false,false,false,false', 'the former Responsabil has no Deals capability left');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u44(7))$$,
  '42501', 'assignment_team_forbidden', 'nobody picks the team of an Atribuție nobody holds');
reset role;
select pg_temp.test_login_leadership(pg_temp.u44(1));
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u44(4))$$,
  '42501', 'assignment_team_forbidden', 'not even the Moderator: an Atribuție nobody holds has no team');
reset role;

select * from finish();
rollback;
