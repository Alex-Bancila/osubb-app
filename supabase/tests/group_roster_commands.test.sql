-- #583: the three Group roster commands and the shared Appointment core.
--
-- Organised by command, and inside each command in the order the
-- implementation answers: malformed input first (for everyone, claimless
-- callers included), then authority, then state. Three groups of assertions
-- carry most of the weight, because they are the three rules a reader would
-- otherwise have to take on trust:
--
--   * the PARENT's Managers appoint a Child Group's Manager -- the Group's own
--     Manager cannot, which is what keeps the seat granted from above;
--   * a Group Manager or Group Responsible is never removed by a roster call
--     (PT409 group_member_holds_role) -- this is what replaces the legacy
--     project_members_protect_leader trigger;
--   * demoting to ordinary membership on an Automatic-Membership Group DELETES
--     the row rather than leaving an explicit one beside the derived roster.
--
-- The last section is the one insert path (rulings R6/R27): a catalog sweep
-- naming every public/private function whose body inserts into
-- public.group_members. It fails the moment a second writer appears, which is
-- the mutation #583 asks for.
--
-- Fixture Groups and roster rows are inserted directly (conventions OD9:
-- owner-run, rolled back). They are native Groups -- no legacy_* -- so the
-- partial sibling-name index behaves as it will after #591.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(54);

-- ==================== Fixtures ====================

create function pg_temp.g583_uid(n integer) returns uuid language sql immutable as $$
  select ('58300000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users (id, email)
select pg_temp.g583_uid(n), 'member.' || n || '.583@test.local' from generate_series(1, 10) n;

-- 1 BC, 2 Moderator, 3 Group Manager of the root (level 1), 4 Group
-- Responsible of the root (level 1), 5 ordinary member (level 1), 6 Recrut
-- (level 0), 7 inactive, 8 Drept de Vot (level 3), 9 Group Manager of the
-- CHILD Group (level 1), 10 a Member with no position anywhere (level 1).
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.g583_uid(n), 'Member #583 ' || n, 'member.' || n || '.583@test.local',
  (case n when 1 then 'bc' when 2 then 'moderator' when 6 then 'recrut'
          when 8 then 'vot' else 'voluntar' end)::public.member_role,
  (case n when 7 then 'inactiv' else 'activ' end)::public.member_status
from generate_series(1, 10) n;

insert into public.groups (name, category, min_level, created_by)
values ('Rădăcină #583', 'department', 0, pg_temp.g583_uid(1)),
       ('Arhivată #583', 'department', 0, pg_temp.g583_uid(1)),
       ('Nivel #583',    'department', 1, pg_temp.g583_uid(1));
insert into public.groups (name, category, min_level, automatic_membership, created_by)
values ('Automat #583', 'department', 0, true, pg_temp.g583_uid(1));
update public.groups set status = 'archived' where name = 'Arhivată #583';

create function pg_temp.g583_group(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;

insert into public.groups (name, category, parent_id, min_level, created_by)
values ('Copil #583', 'team', pg_temp.g583_group('Rădăcină #583'), 0, pg_temp.g583_uid(1));

insert into public.group_members (group_id, member_id, group_role, position_title)
values (pg_temp.g583_group('Rădăcină #583'), pg_temp.g583_uid(3), 'manager',     null),
       (pg_temp.g583_group('Rădăcină #583'), pg_temp.g583_uid(4), 'responsible', 'Responsabil #583'),
       (pg_temp.g583_group('Rădăcină #583'), pg_temp.g583_uid(5), 'member',      null),
       (pg_temp.g583_group('Copil #583'),    pg_temp.g583_uid(9), 'manager',     null),
       (pg_temp.g583_group('Copil #583'),    pg_temp.g583_uid(7), 'member',      null),
       (pg_temp.g583_group('Automat #583'),  pg_temp.g583_uid(3), 'manager',     null),
       (pg_temp.g583_group('Automat #583'),  pg_temp.g583_uid(8), 'responsible', 'Responsabil automat #583'),
       (pg_temp.g583_group('Nivel #583'),    pg_temp.g583_uid(3), 'manager',     null);

create function pg_temp.g583_bc() returns void language sql as $$
  select pg_temp.test_login(pg_temp.g583_uid(1), '{"member_role":"bc","member_level":6}'::jsonb) $$;
create function pg_temp.g583_as(n integer) returns void language sql as $$
  select pg_temp.test_login(pg_temp.g583_uid(n), '{"member_role":"voluntar","member_level":1}'::jsonb) $$;
create function pg_temp.g583_role(p_group text, n integer) returns text
language sql stable security definer set search_path = '' as $$
  select gm.group_role
    from public.group_members as gm
   where gm.group_id = (select id from public.groups where name = p_group)
     and gm.member_id = pg_temp.g583_uid(n)
$$;
create function pg_temp.g583_notifications(n integer) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.notifications
   where member_id = pg_temp.g583_uid(n)
$$;

-- ==================== 1 · set_group_role: malformed input, before any gate ====================
-- The caller here holds no organization claims at all: these four answers are
-- owed to everyone, so none of them may be an authority verdict.

select pg_temp.test_login(pg_temp.g583_uid(5), '{"provider":"email"}'::jsonb);
select throws_ok(
  format($$select public.set_group_role(%s, %L, 'sef')$$,
         pg_temp.g583_group('Rădăcină #583'), pg_temp.g583_uid(8)),
  'PT400', 'invalid_group_role',
  'set_group_role: a Group Role outside the three is malformed for everyone');
select throws_ok(
  format($$select public.set_group_role(%s, %L, 'responsible')$$,
         pg_temp.g583_group('Rădăcină #583'), pg_temp.g583_uid(8)),
  'PT400', 'position_title_required',
  'set_group_role: a Group Responsible is always shown under a custom display name');
select throws_ok(
  format($$select public.set_group_role(%s, %L, 'manager', 'Șef suprem')$$,
         pg_temp.g583_group('Rădăcină #583'), pg_temp.g583_uid(8)),
  'PT400', 'invalid_position_title',
  'set_group_role: a Group Manager''s display name is a Group setting, not a roster value');
select throws_ok(
  format($$select public.set_group_role(%s, %L, 'responsible', '   ')$$,
         pg_temp.g583_group('Rădăcină #583'), pg_temp.g583_uid(8)),
  'PT400', 'invalid_position_title',
  'set_group_role: a blank display name is malformed, not an absent one');

-- ==================== 2 · set_group_role: the parent's-Manager gate ====================

reset role;
select pg_temp.g583_as(9);
select throws_ok(
  format($$select public.set_group_role(%s, %L, 'manager')$$,
         pg_temp.g583_group('Copil #583'), pg_temp.g583_uid(10)),
  '42501', 'group_manage_forbidden',
  'set_group_role: a Child Group''s OWN Manager cannot appoint another one -- the seat is granted from above (ADR-0009)');

reset role;
select pg_temp.g583_as(4);
select throws_ok(
  format($$select public.set_group_role(%s, %L, 'manager')$$,
         pg_temp.g583_group('Copil #583'), pg_temp.g583_uid(10)),
  '42501', 'group_manage_forbidden',
  'set_group_role: nor can a Group Responsible of the parent -- appointing a Manager is the Manager tier');

reset role;
select pg_temp.g583_as(3);
select lives_ok(
  format($$select public.set_group_role(%s, %L, 'manager')$$,
         pg_temp.g583_group('Copil #583'), pg_temp.g583_uid(10)),
  'set_group_role: the PARENT''s Group Manager appoints a Child Group''s Manager');
select is(pg_temp.g583_role('Copil #583', 10), 'manager',
  'and the roster row carries the position');
select lives_ok(
  format($$select public.set_group_role(%s, %L, 'member')$$,
         pg_temp.g583_group('Copil #583'), pg_temp.g583_uid(9)),
  'set_group_role: removing a Child Group''s Manager is the same parent''s-Manager decision');
select is(pg_temp.g583_role('Copil #583', 9), 'member',
  'and the demoted Manager stays in the Group as an ordinary member');

select throws_ok(
  format($$select public.set_group_role(%s, %L, 'manager')$$,
         pg_temp.g583_group('Rădăcină #583'), pg_temp.g583_uid(10)),
  '42501', 'group_manage_forbidden',
  'set_group_role: a TOP-LEVEL Group''s Manager is BC''s and the Moderator''s appointment, not its own Manager''s');

reset role;
select pg_temp.g583_bc();
select lives_ok(
  format($$select public.set_group_role(%s, %L, 'manager')$$,
         pg_temp.g583_group('Rădăcină #583'), pg_temp.g583_uid(8)),
  'set_group_role: BC appoints a top-level Group''s Manager (live level >= 6)');

reset role;
select pg_temp.g583_as(4);
select throws_ok(
  format($$select public.set_group_role(%s, %L, 'responsible', 'Responsabil nou #583')$$,
         pg_temp.g583_group('Rădăcină #583'), pg_temp.g583_uid(10)),
  '42501', 'group_manage_forbidden',
  'set_group_role: a Group Responsible cannot appoint another Group Responsible -- this is the Manager tier (#582 R19)');

reset role;
select pg_temp.g583_as(5);
select throws_ok(
  format($$select public.set_group_role(%s, %L, 'responsible', 'Responsabil nou #583')$$,
         pg_temp.g583_group('Rădăcină #583'), pg_temp.g583_uid(10)),
  '42501', 'group_manage_forbidden',
  'set_group_role: an ordinary member decides no roster row at all');

reset role;
select pg_temp.g583_as(3);
select lives_ok(
  format($$select public.set_group_role(%s, %L, 'responsible', 'Responsabil nou #583')$$,
         pg_temp.g583_group('Rădăcină #583'), pg_temp.g583_uid(10)),
  'set_group_role: the Group''s own Manager appoints its Group Responsibles');
select is(pg_temp.g583_role('Rădăcină #583', 10), 'responsible',
  'and the appointment lands on the roster');

-- ==================== 3 · set_group_role: eligibility, Minimum Level, state ====================

select throws_ok(
  format($$select public.set_group_role(%s, %L, 'responsible', 'Responsabil inactiv #583')$$,
         pg_temp.g583_group('Rădăcină #583'), pg_temp.g583_uid(7)),
  'PT400', 'group_member_not_eligible',
  'set_group_role: an INACTIVE Member is never appointed (authority is live-filtered, so the position would be inert)');
select throws_ok(
  format($$select public.set_group_role(%s, %L, 'responsible', 'Necunoscut #583')$$,
         pg_temp.g583_group('Rădăcină #583'), '58300000-0000-0000-0000-000000009999'),
  'PT400', 'group_member_not_eligible',
  'set_group_role: and an unknown Member gets the same answer as an inactive one');
select throws_ok(
  format($$select public.set_group_role(%s, %L, 'responsible', 'Responsabil recrut #583')$$,
         pg_temp.g583_group('Nivel #583'), pg_temp.g583_uid(6)),
  'PT400', 'group_member_below_min_level',
  'set_group_role: a Member below the Group''s Minimum Level cannot be appointed into it');
-- An inactive Member may still have a historical roster row; no appointment
-- may promote it. A below-Minimum-Level row can no longer be planted (#586).
select throws_ok(
  format($$select public.set_group_role(%s, %L, 'responsible', 'Responsabil inactiv #583')$$,
         pg_temp.g583_group('Copil #583'), pg_temp.g583_uid(7)),
  'PT400', 'group_member_not_eligible',
  'set_group_role: an inactive Member already on the roster cannot be promoted either');
select is((select count(*) from public.group_members
  where group_id=pg_temp.g583_group('Nivel #583')
    and member_id=pg_temp.g583_uid(6)), 0::bigint,
  'a refused below-Minimum-Level appointment leaves no roster row');
select throws_ok(
  format($$select public.set_group_role(%s, %L, 'responsible', 'Responsabil #583')$$,
         pg_temp.g583_group('Rădăcină #583'), pg_temp.g583_uid(4)),
  'PT409', 'nothing_to_update',
  'set_group_role: the Group Role and display name already held are nothing to update');

reset role;
select pg_temp.g583_bc();
select throws_ok(
  format($$select public.set_group_role(%s, %L, 'responsible', 'Responsabil arhivat #583')$$,
         pg_temp.g583_group('Arhivată #583'), pg_temp.g583_uid(10)),
  'PT409', 'group_archived',
  'set_group_role: an archived Group takes no roster decision, even from BC');

-- ==================== 4 · set_group_role on an Automatic-Membership Group ====================
-- Its ordinary roster is derived from rank against Minimum Level and never
-- stored, so there is no such thing as demoting into it.

reset role;
select pg_temp.g583_as(3);
select lives_ok(
  format($$select public.set_group_role(%s, %L, 'member')$$,
         pg_temp.g583_group('Automat #583'), pg_temp.g583_uid(8)),
  'set_group_role: a Group Responsible of an Automatic-Membership Group may be demoted');
select is(pg_temp.g583_role('Automat #583', 8), null,
  'and the row is DELETED rather than left as an explicit member beside the derived roster');
select throws_ok(
  format($$select public.set_group_role(%s, %L, 'member')$$,
         pg_temp.g583_group('Automat #583'), pg_temp.g583_uid(10)),
  'PT409', 'automatic_group_has_no_roster_members',
  'set_group_role: and asking for an ordinary row where none exists is refused, not silently created');

reset role;
select ok(
  exists (select 1 from public.notifications
           where member_id = pg_temp.g583_uid(8)
             and title = 'Numire încheiată în Automat #583'
             and link = '/grupuri/' || pg_temp.g583_group('Automat #583')::text),
  'the demoted Member is told the appointment ended, with the member-facing Group link (#589)');

-- ==================== 5 · set_group_role: the Notification contract (R25) ====================

select ok(
  exists (select 1 from public.notifications
           where member_id = pg_temp.g583_uid(10)
             and title = 'Numire în Rădăcină #583'
             and link = '/grupuri/' || pg_temp.g583_group('Rădăcină #583')::text),
  'an appointed Member is notified directly, under the position''s display name and the Group link');
select is(pg_temp.g583_notifications(3), 0,
  'and the actor is never notified of their own decision (R25)');

reset role;
select pg_temp.g583_bc();
select lives_ok(
  format($$select public.set_group_role(%s, %L, 'manager')$$,
         pg_temp.g583_group('Nivel #583'), pg_temp.g583_uid(1)),
  'set_group_role: BC may appoint themselves a Group Manager');
reset role;
select is(pg_temp.g583_notifications(1), 0,
  'and an appointment of oneself notifies nobody -- private.notify drops the actor');

-- ==================== 6 · add_group_member ====================

reset role;
select pg_temp.g583_as(4);
select lives_ok(
  format($$select public.add_group_member(%s, %L)$$,
         pg_temp.g583_group('Copil #583'), pg_temp.g583_uid(5)),
  'add_group_member: a Group RESPONSIBLE of the parent may appoint -- Appointment is an Entry path, not structure (ADR-0009)');
select is(pg_temp.g583_role('Copil #583', 5), 'member',
  'and the Member joins as an ordinary member');
select throws_ok(
  format($$select public.add_group_member(%s, %L)$$,
         pg_temp.g583_group('Copil #583'), pg_temp.g583_uid(5)),
  'PT409', 'already_group_member',
  'add_group_member: a second call for the same Member is a state conflict');
select throws_ok(
  format($$select public.add_group_member(%s, %L)$$,
         pg_temp.g583_group('Rădăcină #583'), pg_temp.g583_uid(7)),
  'PT400', 'group_member_not_eligible',
  'add_group_member: an inactive Member is not added');
-- The next two Groups are ones the Group Responsible above holds no position
-- on, so their Manager runs them: a refusal here has to be the state, not the
-- gate.
reset role;
select pg_temp.g583_as(3);
select throws_ok(
  format($$select public.add_group_member(%s, %L)$$,
         pg_temp.g583_group('Nivel #583'), pg_temp.g583_uid(6)),
  'PT400', 'group_member_below_min_level',
  'add_group_member: nor is one below the Group''s Minimum Level');
select throws_ok(
  format($$select public.add_group_member(%s, %L)$$,
         pg_temp.g583_group('Automat #583'), pg_temp.g583_uid(10)),
  'PT409', 'automatic_group_has_no_roster_members',
  'add_group_member: an Automatic-Membership Group is joined by holding the rank, never by an explicit row');

reset role;
select pg_temp.g583_as(5);
select throws_ok(
  format($$select public.add_group_member(%s, %L)$$,
         pg_temp.g583_group('Rădăcină #583'), pg_temp.g583_uid(10)),
  '42501', 'group_manage_forbidden',
  'add_group_member: an ordinary member appoints nobody');

reset role;
select pg_temp.g583_bc();
select throws_ok(
  format($$select public.add_group_member(%s, %L)$$,
         pg_temp.g583_group('Arhivată #583'), pg_temp.g583_uid(10)),
  'PT409', 'group_archived',
  'add_group_member: an archived Group takes no new members');

reset role;
select ok(
  exists (select 1 from public.notifications
           where member_id = pg_temp.g583_uid(5)
             and title = 'Ai fost adăugat în Copil #583'
             and link = '/grupuri/' || pg_temp.g583_group('Copil #583')::text),
  'add_group_member: the added Member is told, with the member-facing Group link');
select is(pg_temp.g583_notifications(4), 0,
  'and the appointing Group Responsible is told nothing about their own action');

-- ==================== 7 · remove_group_member ====================

reset role;
select pg_temp.g583_as(4);
select lives_ok(
  format($$select public.remove_group_member(%s, %L)$$,
         pg_temp.g583_group('Copil #583'), pg_temp.g583_uid(5)),
  'remove_group_member: the same work tier removes an ordinary member');
select is(pg_temp.g583_role('Copil #583', 5), null,
  'and the roster row is gone');
select throws_ok(
  format($$select public.remove_group_member(%s, %L)$$,
         pg_temp.g583_group('Copil #583'), pg_temp.g583_uid(5)),
  'PT404', 'group_member_not_found',
  'remove_group_member: a Member with no roster row here is PT404, never a silent success');
select throws_ok(
  format($$select public.remove_group_member(%s, %L)$$,
         pg_temp.g583_group('Copil #583'), pg_temp.g583_uid(10)),
  'PT409', 'group_member_holds_role',
  'remove_group_member: a Group MANAGER is never removed by a roster call -- go through set_group_role (this replaces project_members_protect_leader)');
select lives_ok(
  format($$select public.remove_group_member(%s, %L)$$,
         pg_temp.g583_group('Copil #583'), pg_temp.g583_uid(7)),
  'remove_group_member: an INACTIVE ordinary member is still removable -- Membership Status never froze a roster (R22)');

reset role;
select pg_temp.g583_as(3);
select throws_ok(
  format($$select public.remove_group_member(%s, %L)$$,
         pg_temp.g583_group('Rădăcină #583'), pg_temp.g583_uid(4)),
  'PT409', 'group_member_holds_role',
  'remove_group_member: a Group RESPONSIBLE is refused for the same reason');

reset role;
select pg_temp.g583_as(5);
select throws_ok(
  format($$select public.remove_group_member(%s, %L)$$,
         pg_temp.g583_group('Rădăcină #583'), pg_temp.g583_uid(10)),
  '42501', 'group_manage_forbidden',
  'remove_group_member: an ordinary member removes nobody');

reset role;
select ok(
  exists (select 1 from public.notifications
           where member_id = pg_temp.g583_uid(5)
             and title = 'Nu mai faci parte din Copil #583'
             and link = '/grupuri/' || pg_temp.g583_group('Copil #583')::text),
  'remove_group_member: the removed Member is told directly');

-- ==================== 8 · the one insert path (rulings R6/R27) ====================
-- This is the mutation #583 asks for: a write to public.group_members outside
-- the Appointment core must turn this suite red. The three sync_* functions
-- are the surviving Wave 1 mirror writers, which #586 drops -- after that this
-- list is the core alone.

create function pg_temp.g583_roster_writers() returns text[]
language sql as $$
  select coalesce(array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname), '{}')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     -- prokind = 'f' keeps pg_get_functiondef away from aggregates, which it
     -- refuses to render at all (conventions.test.sql's sweep does the same).
     and p.prokind = 'f'
     and pg_get_functiondef(p.oid) ~ 'insert\s+into\s+public\.group_members'
     and p.proname <> 'appoint_group_member'
$$;

select is(pg_temp.g583_roster_writers(), '{}'::text[],
  'private.appoint_group_member is the only insert path into public.group_members -- a second writer fails here by name');

create function public.g583_probe_roster_insert(g bigint, m uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.group_members (group_id, member_id, group_role) values (g, m, 'member')
$$;
select is(pg_temp.g583_roster_writers(), array['public.g583_probe_roster_insert'],
  'and the sweep really reports a function that inserts around the core, by name');
drop function public.g583_probe_roster_insert(bigint, uuid);

-- #582's create_group writes the appointed Manager's roster row; since #583 it
-- writes it through the core, which is why the sweep above finds nothing in
-- private.create_group_impl and why the new Group Manager is notified at all.
reset role;
select pg_temp.g583_bc();
select lives_ok(
  format($$select public.create_group('Nouă cu manager #583', 'department', null, 0, %L)$$,
         pg_temp.g583_uid(10)),
  'create_group still appoints its Manager atomically');
reset role;
select ok(
  exists (select 1 from public.notifications
           where member_id = pg_temp.g583_uid(10)
             and title = 'Numire în Nouă cu manager #583'),
  'and the appointment now notifies the new Group Manager, because it goes through the shared core');
select is(pg_temp.g583_role('Nouă cu manager #583', 10), 'manager',
  'with the roster row the core wrote');

select * from finish();
rollback;
