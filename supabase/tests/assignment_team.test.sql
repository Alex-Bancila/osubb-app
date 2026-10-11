-- R47 (2026-10-11): every BC member and the Moderator hold every Atribuție's
-- powers; nobody is a holder. The OSUBB Deals team -- a Coordonator (live BCE)
-- and a Responsabil (live activ) -- is set by any BC member or the Moderator;
-- the Coordonator still sets the Responsabil. Live rows, never the token.
--
-- Mutation check: revert the `>= 6` branch of private.assignment_team_role to
-- `>= 9` and "a BC member sets the Coordonator" plus "BC: every Deals
-- capability" go red.
--
-- Personas (prefix 4747):
--   1 moderator  2 bc  3 bc  4 bce  5 bce  6 voluntar  7 voluntar  8 recrut
--   9 voluntar, inactiv
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(41);

create function pg_temp.u47(n integer) returns uuid language sql immutable as $$
  select ('47470000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
insert into auth.users(id, email)
select pg_temp.u47(n), 'echipa.' || n || '.r47@test.local' from generate_series(1, 9) n;
insert into public.profiles(id, full_name, email, role, status)
select pg_temp.u47(n), 'Echipa R47 ' || n, 'echipa.' || n || '.r47@test.local',
       (case n when 1 then 'moderator' when 2 then 'bc' when 3 then 'bc' when 4 then 'bce'
               when 5 then 'bce' when 8 then 'recrut' else 'voluntar' end)::public.member_role,
       (case n when 9 then 'inactiv' else 'activ' end)::public.member_status
  from generate_series(1, 9) n;
-- The demo seed's team is not part of this suite.
delete from public.assignment_team where assignment = 'osubb_deals';

create function pg_temp.notified(p_title text) returns integer[] language sql stable as $$
  select coalesce(array_agg(right(member_id::text, 12)::integer order by right(member_id::text, 12)::integer), '{}')
    from public.notifications
   where title = p_title and member_id::text like '47470000-%'
$$;
-- administer, manage_deals, manage_deals_team, pick_deals_coordinator
create function pg_temp.caps() returns text language sql stable as $$
  select format('%s,%s,%s,%s', c.administer::text, c.manage_deals::text,
                c.manage_deals_team::text, c.pick_deals_coordinator::text)
    from public.my_capabilities() as c
$$;
grant execute on function pg_temp.u47(integer), pg_temp.notified(text), pg_temp.caps() to authenticated, anon;

-- ==================== API surface ====================
select ok(not has_function_privilege('anon', 'public.set_assignment_team_member(text, text, uuid)', 'execute'),
  'anon cannot execute set_assignment_team_member');
select ok(has_function_privilege('authenticated', 'public.set_assignment_team_member(text, text, uuid)', 'execute'),
  'authenticated executes it; the gate is inside');
select ok(not exists (select 1 from pg_proc
                       where proname in ('set_bc_assignment', 'set_bc_assignment_impl',
                                         'bc_assignments_directory', 'bc_assignments_directory_impl')),
  'the holder commands and the Administrare BC directory are gone (R47)');
select hasnt_table('public', 'bc_assignments', 'the holder table is gone (R47)');
select hasnt_fk('public', 'assignment_team', 'the team no longer hangs off a holder row');
select has_check('public', 'assignment_team', 'the known Atribuții are the team table''s check constraint');
select ok(not has_table_privilege('authenticated', 'public.assignment_team', 'insert')
      and not has_table_privilege('authenticated', 'public.assignment_team', 'update')
      and not has_table_privilege('authenticated', 'public.assignment_team', 'delete'),
  'no direct writes on assignment_team: the command is the only write path');

-- ==================== BC sets both places ====================
select pg_temp.test_login_leadership(pg_temp.u47(2));
select is((public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u47(4))).member_id, pg_temp.u47(4),
  'a BC member sets the Coordonator');
select is((public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(6))).member_id, pg_temp.u47(6),
  'a BC member sets the Responsabil');
reset role;
select is(pg_temp.notified('Ești acum Coordonator OSUBB Deals'), array[4], 'the Coordonator set is told');
select is(pg_temp.notified('Ești acum Responsabil OSUBB Deals'), array[6], 'the Responsabil set is told');
select is((select set_by from public.assignment_team where team_role = 'coordinator'), pg_temp.u47(2),
  'set_by records the BC member');
select pg_temp.test_login_leadership(pg_temp.u47(3));
select is((public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u47(5))).member_id, pg_temp.u47(5),
  'another BC member replaces the Coordonator');
reset role;
select is(pg_temp.notified('Nu mai ești Coordonator OSUBB Deals'), array[4], 'the one replaced is told');

-- ==================== The Moderator sets both places ====================
select pg_temp.test_login_leadership(pg_temp.u47(1));
select is((public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u47(4))).member_id, pg_temp.u47(4),
  'the Moderator sets the Coordonator');
select is((public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(7))).member_id, pg_temp.u47(7),
  'the Moderator sets the Responsabil');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u47(6))$$,
  'PT400', 'coordinator_not_bce', 'a Voluntar cannot be the Coordonator');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u47(3))$$,
  'PT400', 'coordinator_not_bce', 'a BC member cannot be the Coordonator either: the place is a BCE member''s');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(9))$$,
  'PT400', 'invalid_team_member', 'an inactive Member cannot be the Responsabil');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(4))$$,
  'PT400', 'assignment_team_duplicate', 'the Coordonator cannot also be the Responsabil');
select is((public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(3))).member_id, pg_temp.u47(3),
  'a BC member may sit in the Responsabil place: nothing forbids it, their powers are theirs anyway');
select is((public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(7))).member_id, pg_temp.u47(7),
  'and is replaced like anyone else');
reset role;

-- ==================== The Coordonator keeps their powers ====================
select pg_temp.test_login_leadership(pg_temp.u47(4));
select is((public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(6))).member_id, pg_temp.u47(6),
  'the Coordonator sets the Responsabil');
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'coordinator', pg_temp.u47(5))$$,
  '42501', 'assignment_team_forbidden', 'the Coordonator cannot choose the Coordonator');
reset role;

-- ==================== Everyone else is refused ====================
select pg_temp.test_login_leadership(pg_temp.u47(6));
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(7))$$,
  '42501', 'assignment_team_forbidden', 'the Responsabil cannot pick the team');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(5));
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(7))$$,
  '42501', 'assignment_team_forbidden', 'a BCE member outside the team cannot pick the team');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(7));
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(7))$$,
  '42501', 'assignment_team_forbidden', 'a Voluntar cannot pick the team');
reset role;
select pg_temp.test_clear_jwt();
set local role authenticated;
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(7))$$,
  '42501', 'assignment_team_forbidden', 'a claimless caller cannot pick the team');
reset role;
-- Live rows, not the token: a BC member demoted to Voluntar keeps the token but loses the power.
update public.profiles set role = 'voluntar' where id = pg_temp.u47(3);
select pg_temp.test_login('47470000-0000-0000-0000-000000000003',
  '{"member_role":"bc","member_level":6,"group_ids":[]}'::jsonb);
select throws_ok($$select public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(7))$$,
  '42501', 'assignment_team_forbidden', 'a BC member demoted to Voluntar cannot pick the team, whatever the token says');
reset role;
update public.profiles set role = 'bc' where id = pg_temp.u47(3);

-- ==================== Clearing a place ====================
delete from public.notifications where member_id::text like '47470000-%';
select pg_temp.test_login_leadership(pg_temp.u47(2));
select ok((public.set_assignment_team_member('osubb_deals', 'responsible', null)) is null,
  'clearing the Responsabil returns no row');
reset role;
select is((select count(*) from public.assignment_team where team_role = 'responsible')::int, 0,
  'and the place is empty');
select is(pg_temp.notified('Nu mai ești Responsabil OSUBB Deals'), array[6], 'the one cleared is told');
select pg_temp.test_login_leadership(pg_temp.u47(2));
select ok((public.set_assignment_team_member('osubb_deals', 'responsible', null)) is null,
  'clearing an empty place returns no row');
reset role;
select is((select count(*) from public.notifications where member_id::text like '47470000-%')::int, 1,
  'and tells nobody');

-- ==================== Capabilities per persona ====================
-- administer, manage_deals, manage_deals_team, pick_deals_coordinator
select pg_temp.test_login_leadership(pg_temp.u47(1));
select is((public.set_assignment_team_member('osubb_deals', 'responsible', pg_temp.u47(6))).member_id, pg_temp.u47(6),
  'the team is whole again: Coordonator 4, Responsabil 6');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(2));
select is(pg_temp.caps(), 'true,true,true,true', 'BC: every Deals capability, without a place in the team (R47)');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(1));
select is(pg_temp.caps(), 'true,true,true,true', 'the Moderator: every Deals capability');
select ok((select c::text from public.my_capabilities() as c)
          ~ '^\((t|f),(t|f),(t|f),(t|f),(t|f),(t|f),(t|f),(t|f),(t|f),(t|f),(t|f)\)$',
  'the capability row has eleven columns: administer_bc is gone');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(4));
select is(pg_temp.caps(), 'true,true,true,false', 'Coordonator: manages Deals and the team, never picks the Coordonator');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(6));
select is(pg_temp.caps(), 'true,true,false,false', 'Responsabil: manage_deals alone, which opens Administrare');
reset role;
select pg_temp.test_login_leadership(pg_temp.u47(7));
select is(pg_temp.caps(), 'false,false,false,false', 'a Voluntar outside the team: nothing');
reset role;

select * from finish();
rollback;
