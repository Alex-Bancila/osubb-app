-- #584: Applications — the table, its RLS, the three commands, the recipient
-- set, ruling R17's groups_read limb, and ruling R30's four owed clauses.
--
-- Organised by command, and inside each command in the order the
-- implementation answers: malformed input first (for everyone, claimless
-- callers included), then visibility, then state, then the Application Level.
-- Five groups of assertions carry most of the weight:
--
--   * at most one PENDING Application per (Group, Member), and a declined or
--     withdrawn one never blocks a new attempt — the whole point of the
--     partial index;
--   * the recipient set is private.group_application_recipients and nothing
--     else: a Child Group's own Manager UNION the ancestor's Group
--     Responsible, which private.group_managers' fallback alone would skip;
--   * an applicant keeps seeing the Group while their Application is pending
--     and stops the moment they withdraw (ruling R17) — while a Member below
--     the Minimum Level with NO Application never sees it at all;
--   * an accept is an Appointment, so a Level that fell while the Application
--     sat pending answers PT400 group_member_below_min_level;
--   * the two Notification links differ on purpose: the filing goes to
--     Administrare, the decision to the member-facing Group page.
--
-- Fixture Groups, roster rows and the two directly-inserted Applications are
-- written as the owner (conventions OD9: rolled back, no client write path
-- implied). They are native Groups — no legacy_* — so the partial sibling-name
-- index behaves as it will after #591.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(79);

-- ==================== Fixtures ====================

create function pg_temp.g584_uid(n integer) returns uuid language sql immutable as $$
  select ('58400000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users (id, email)
select pg_temp.g584_uid(n), 'member.' || n || '.584@test.local' from generate_series(1, 10) n;

-- 1 BC, 2 Group Manager of the open root (and of 'Înalt #584', min_level 3 --
-- #586's validate_group_member enforces the Minimum Level on every roster
-- row, so its Manager needs Drept de Vot or above), 3 its Group Responsible,
-- 4 the applicant, 5 a Recrut (level 0 — below the open Group's Application
-- Level), 6 Drept de Vot (level 3), 7 inactive, 8 Group Manager of the Child
-- Group, 9 already a member of the open root, 10 a Member with no
-- relationship anywhere.
insert into public.profiles (id, full_name, email, role, status)
select pg_temp.g584_uid(n), 'Membru #584 ' || n, 'member.' || n || '.584@test.local',
  (case n when 1 then 'bc' when 2 then 'vot' when 5 then 'recrut' when 6 then 'vot' else 'voluntar' end)::public.member_role,
  (case n when 7 then 'inactiv' else 'activ' end)::public.member_status
from generate_series(1, 10) n;

insert into public.groups (name, category, min_level, accepts_applications, application_level, created_by)
values ('Deschis #584',    'department', 0, true,  1, pg_temp.g584_uid(1)),
       ('Închis #584',     'department', 0, false, null, pg_temp.g584_uid(1)),
       ('Înalt #584',      'department', 3, true,  3, pg_temp.g584_uid(1)),
       ('Arhivat #584',    'department', 0, true,  0, pg_temp.g584_uid(1)),
       ('Prag #584',       'department', 0, true,  0, pg_temp.g584_uid(1)),
       ('Arhivabil #584',  'department', 0, true,  0, pg_temp.g584_uid(1)),
       -- Childless on purpose: ruling R17's section raises this Group's
       -- Minimum Level underneath a pending applicant, and
       -- private.validate_group_hierarchy refuses a level above a child's.
       ('Ridicat #584',    'department', 0, true,  0, pg_temp.g584_uid(1));
update public.groups set status = 'archived' where name = 'Arhivat #584';

create function pg_temp.g584_group(p_name text) returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.groups where name = p_name
$$;

insert into public.groups (name, category, parent_id, min_level, accepts_applications, application_level, created_by)
values ('Copil #584', 'team', pg_temp.g584_group('Deschis #584'), 0, true, 1, pg_temp.g584_uid(1));

insert into public.group_members (group_id, member_id, group_role, position_title)
values (pg_temp.g584_group('Deschis #584'),   pg_temp.g584_uid(2), 'manager',     null),
       (pg_temp.g584_group('Deschis #584'),   pg_temp.g584_uid(3), 'responsible', 'Responsabil #584'),
       (pg_temp.g584_group('Deschis #584'),   pg_temp.g584_uid(9), 'member',      null),
       (pg_temp.g584_group('Copil #584'),     pg_temp.g584_uid(8), 'manager',     null),
       (pg_temp.g584_group('Arhivabil #584'), pg_temp.g584_uid(2), 'manager',     null),
       (pg_temp.g584_group('Prag #584'),      pg_temp.g584_uid(2), 'manager',     null),
       (pg_temp.g584_group('Prag #584'),      pg_temp.g584_uid(5), 'member',      null),
       (pg_temp.g584_group('Ridicat #584'),   pg_temp.g584_uid(2), 'manager',     null),
       (pg_temp.g584_group('Înalt #584'),     pg_temp.g584_uid(2), 'manager',     null);

create function pg_temp.g584_bc() returns void language sql as $$
  select pg_temp.test_login(pg_temp.g584_uid(1), '{"member_role":"bc","member_level":6}'::jsonb) $$;
create function pg_temp.g584_as(n integer) returns void language sql as $$
  select pg_temp.test_login(pg_temp.g584_uid(n), '{"member_role":"voluntar","member_level":1}'::jsonb) $$;
create function pg_temp.g584_apply(p_group bigint, p_note text default null) returns bigint
language sql as $$ select (public.apply_to_group(p_group, p_note)).id $$;
create function pg_temp.g584_status(p_id bigint) returns text
language sql stable security definer set search_path = '' as $$
  select status from public.group_applications where id = p_id
$$;
create function pg_temp.g584_pending(p_group bigint, n integer) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from public.group_applications
   where group_id = p_group and member_id = pg_temp.g584_uid(n) and status = 'pending'
$$;

-- ==================== 1 · apply_to_group: who may ask at all ====================

select pg_temp.test_clear_jwt();
set local role authenticated;
select throws_ok(
  format($$select public.apply_to_group(%s)$$, pg_temp.g584_group('Deschis #584')),
  '42501', 'group_apply_forbidden',
  'apply_to_group: a claimless session is refused before anything about the Group is read');
reset role;

-- The deactivated shape: real claims, real uid, no live Profile.
select pg_temp.test_login(pg_temp.g584_uid(7), '{"member_role":"voluntar","member_level":1}'::jsonb);
select throws_ok(
  format($$select public.apply_to_group(%s)$$, pg_temp.g584_group('Deschis #584')),
  '42501', 'group_apply_forbidden',
  'apply_to_group: a deactivated Member keeps their uid and their claims, and is still refused');
reset role;

-- ==================== 2 · apply_to_group: visibility before everything ====================

select pg_temp.g584_as(4);
select throws_ok(
  $$select public.apply_to_group(-58400)$$,
  'PT404', 'group_not_found',
  'apply_to_group: an id that was never issued is not found');
reset role;

-- Member 5 is a Recrut (level 0); 'Înalt #584' demands level 3 to be seen at
-- all. Hidden is never distinguishable from missing.
select pg_temp.g584_as(5);
select throws_ok(
  format($$select public.apply_to_group(%s)$$, pg_temp.g584_group('Înalt #584')),
  'PT404', 'group_not_found',
  'apply_to_group: a Group above the caller''s Minimum Level is not found, never "forbidden"');
reset role;

-- ==================== 3 · apply_to_group: state, then the Application Level ====================

select pg_temp.g584_as(4);
select throws_ok(
  format($$select public.apply_to_group(%s)$$, pg_temp.g584_group('Închis #584')),
  'PT409', 'group_not_accepting_applications',
  'apply_to_group: a Group that takes no Applications says so');
reset role;

-- An archived Group is visible only from level 5 up, so BC is the one caller
-- who can reach this answer — and gets the state conflict, not a 42501.
select pg_temp.g584_bc();
select throws_ok(
  format($$select public.apply_to_group(%s)$$, pg_temp.g584_group('Arhivat #584')),
  'PT409', 'group_not_accepting_applications',
  'apply_to_group: an archived Group accepts nothing, whatever accepts_applications still says');
reset role;

select pg_temp.g584_as(9);
select throws_ok(
  format($$select public.apply_to_group(%s)$$, pg_temp.g584_group('Deschis #584')),
  'PT409', 'already_group_member',
  'apply_to_group: an existing roster row of the Group refuses the Application');
reset role;

-- Membership of THIS Group only (Wave 2 ruling D2): member 9's row on the
-- parent is not membership of the Child Group, so the Application is allowed.
select pg_temp.g584_as(9);
select lives_ok(
  format($$select pg_temp.g584_apply(%s)$$, pg_temp.g584_group('Copil #584')),
  'apply_to_group: a parent Group''s member may still apply to its Child Group (ruling D2)');
reset role;

-- The Application Level is NOT the Minimum Level: 'Deschis #584' admits a
-- Recrut by Appointment (Minimum 0) but only a Voluntar may apply (Level 1).
select pg_temp.g584_as(5);
select throws_ok(
  format($$select public.apply_to_group(%s)$$, pg_temp.g584_group('Deschis #584')),
  '42501', 'group_apply_forbidden',
  'apply_to_group: below the Application Level is a refusal the caller can act on, not a PT404');
reset role;

-- ==================== 4 · apply_to_group: the successful filing ====================

select pg_temp.g584_as(4);
create temp table fx584 as
  select pg_temp.g584_apply(pg_temp.g584_group('Deschis #584'), '  Vreau să ajut  ') as first_id;
reset role;

select is(
  (select status from public.group_applications
    where id = (select first_id from fx584)),
  'pending', 'apply_to_group: the filed Application starts pending');
select is(
  (select note from public.group_applications
    where id = (select first_id from fx584)),
  'Vreau să ajut', 'apply_to_group: the applicant''s note is trimmed and kept');
select ok(
  (select decided_by is null and decided_at is null and decision_note is null
     from public.group_applications where id = (select first_id from fx584)),
  'apply_to_group: a pending Application carries no decision trace at all');

select pg_temp.g584_as(4);
select throws_ok(
  format($$select public.apply_to_group(%s)$$, pg_temp.g584_group('Deschis #584')),
  'PT409', 'application_pending',
  'apply_to_group: one pending Application per (Group, Member)');
reset role;

-- The same fact from the storage side: the partial index, not the command,
-- is what makes it true under concurrency.
select is(
  (select indexdef from pg_indexes
    where schemaname = 'public' and indexname = 'group_applications_pending_uidx'),
  'CREATE UNIQUE INDEX group_applications_pending_uidx ON public.group_applications USING btree (group_id, member_id) WHERE (status = ''pending''::text)',
  'group_applications_pending_uidx is unique over (group_id, member_id) and covers pending rows only');

-- ==================== 5 · the recipient set (shape 3) ====================

select is(
  (select array_agg(recipient order by recipient)
     from private.group_application_recipients((select first_id from fx584)) as recipient),
  array[pg_temp.g584_uid(2), pg_temp.g584_uid(3)],
  'group_application_recipients: the Group''s Manager and its Group Responsible, and nobody else');

-- The union earns its keep here: private.group_managers stops at the Child
-- Group's own Manager and never reaches the parent's Responsible.
-- #675: member 10 carries a Nickname; member 4 (above) does not.
update public.profiles set nickname = 'Aplicant 584'
 where id = pg_temp.g584_uid(10);
select pg_temp.g584_as(10);
create temp table fx584_child as
  select pg_temp.g584_apply(pg_temp.g584_group('Copil #584')) as child_id;
reset role;

select is(
  (select array_agg(recipient order by recipient)
     from private.group_application_recipients((select child_id from fx584_child)) as recipient),
  array[pg_temp.g584_uid(3), pg_temp.g584_uid(8)],
  'group_application_recipients: a Child Group''s own Manager UNION the ancestor''s Group Responsible');

select is(
  (select count(*) from public.notifications
    where member_id = pg_temp.g584_uid(2)
      and dedupe_key = 'application:' || (select first_id from fx584)::text),
  1::bigint, 'the filing writes one Notification to the Group Manager under dedupe key application:<id>');
select is(
  (select link from public.notifications
    where member_id = pg_temp.g584_uid(3)
      and dedupe_key = 'application:' || (select first_id from fx584)::text),
  '/administrare/grupuri/' || pg_temp.g584_group('Deschis #584')::text,
  'the filing Notification links to Administrare, where the Cereri tab lives');
select is(
  (select count(*) from public.notifications
    where member_id = pg_temp.g584_uid(4)
      and dedupe_key = 'application:' || (select first_id from fx584)::text),
  0::bigint, 'the applicant is never told about their own Application (ruling R25)');
select is(
  (select body from public.notifications
    where member_id = pg_temp.g584_uid(2)
      and dedupe_key = 'application:' || (select first_id from fx584)::text),
  'Membru #584 4 vrea să intre în grupul Deschis #584. „Vreau să ajut”',
  'the "Cerere de înscriere" body names an applicant with no Nickname by their full name (#675)');
select is(
  (select body from public.notifications
    where member_id = pg_temp.g584_uid(8)
      and dedupe_key = 'application:' || (select child_id from fx584_child)::text),
  'Aplicant 584 vrea să intre în grupul Copil #584.',
  'and an applicant with a Nickname by the Nickname, read at write time (#675)');

-- ==================== 6 · ruling R17: the groups_read pending limb ====================
-- The Minimum Level is raised underneath the applicant as an owner fixture
-- (OD9) rather than through update_group, so this section tests the POLICY and
-- not the command that happens to be able to trigger it.

select pg_temp.g584_as(4);
create temp table fx584_r17 as
  select pg_temp.g584_apply(pg_temp.g584_group('Ridicat #584')) as r17_id;
reset role;

update public.groups
   set min_level = 3, application_level = 3
 where id = pg_temp.g584_group('Ridicat #584');

select pg_temp.g584_as(4);
select is(
  (select count(*) from public.groups where id = pg_temp.g584_group('Ridicat #584')),
  1::bigint,
  'ruling R17: an applicant still reads the Group while their Application is pending, after a Minimum-Level raise');
reset role;

select pg_temp.g584_as(10);
select is(
  (select count(*) from public.groups where id = pg_temp.g584_group('Ridicat #584')),
  0::bigint,
  'ruling R17: a Member below the Minimum Level with NO Application sees nothing about the Group');
reset role;

-- ==================== 7 · decide_group_application: a Level that fell while pending ====================

select pg_temp.g584_as(2);
select throws_ok(
  format($$select public.decide_group_application(%s, true)$$, (select r17_id from fx584_r17)),
  'PT400', 'group_member_below_min_level',
  'decide_group_application: an accept is an Appointment, so a Level that fell while pending refuses');
reset role;

-- …and withdrawing it takes the R17 limb away with it: the same caller, the
-- same Group, one row of difference.
select pg_temp.g584_as(4);
select lives_ok(
  format($$select public.withdraw_group_application(%s)$$, (select r17_id from fx584_r17)),
  'withdraw_group_application: the applicant retracts the Application the Minimum-Level raise stranded');
select is(
  (select count(*) from public.groups where id = pg_temp.g584_group('Ridicat #584')),
  0::bigint,
  'ruling R17: the applicant stops seeing the Group the moment their Application is withdrawn');
reset role;

-- ==================== 8 · withdraw_group_application ====================

select pg_temp.test_clear_jwt();
set local role authenticated;
select throws_ok(
  format($$select public.withdraw_group_application(%s)$$, (select first_id from fx584)),
  '42501', 'application_withdraw_forbidden',
  'withdraw_group_application: a claimless session is refused');
reset role;

select pg_temp.g584_as(4);
select throws_ok(
  $$select public.withdraw_group_application(-58400)$$,
  'PT404', 'application_not_found',
  'withdraw_group_application: an id that was never issued is not found');
reset role;

select pg_temp.g584_as(10);
select throws_ok(
  format($$select public.withdraw_group_application(%s)$$, (select first_id from fx584)),
  'PT404', 'application_not_found',
  'withdraw_group_application: an Application the caller cannot read is indistinguishable from a missing one');
reset role;

select pg_temp.g584_as(2);
select throws_ok(
  format($$select public.withdraw_group_application(%s)$$, (select first_id from fx584)),
  '42501', 'application_withdraw_forbidden',
  'withdraw_group_application: a Group Manager who CAN read it must decline it, never retract it');
reset role;

select pg_temp.g584_as(4);
select lives_ok(
  format($$select public.withdraw_group_application(%s)$$, (select first_id from fx584)),
  'withdraw_group_application: the applicant retracts their own pending Application');
reset role;

select is(pg_temp.g584_status((select first_id from fx584)), 'withdrawn',
  'withdraw_group_application: the row is withdrawn');
select ok(
  (select decided_by = pg_temp.g584_uid(4) and decided_at is not null
     from public.group_applications where id = (select first_id from fx584)),
  'ruling R30: a withdrawal names the applicant as its own decider and its moment — never half-decided');

select pg_temp.g584_as(4);
select throws_ok(
  format($$select public.withdraw_group_application(%s)$$, (select first_id from fx584)),
  'PT409', 'application_not_pending',
  'withdraw_group_application: a settled Application cannot be withdrawn again');
reset role;

-- A withdrawn Application never blocks a new one.
select pg_temp.g584_as(4);
create temp table fx584_again as
  select pg_temp.g584_apply(pg_temp.g584_group('Deschis #584')) as again_id;
reset role;
select is(pg_temp.g584_status((select again_id from fx584_again)), 'pending',
  'a withdrawn Application never blocks a new one: the unique index covers pending rows only');

-- ==================== 9 · decide_group_application: input and authority ====================

select pg_temp.g584_as(2);
select throws_ok(
  format($$select public.decide_group_application(%s, null)$$, (select again_id from fx584_again)),
  'PT400', 'invalid_application_decision',
  'decide_group_application: a null verdict is malformed, answered before any authority check');
select throws_ok(
  format($$select public.decide_group_application(%s, false, '   ')$$, (select again_id from fx584_again)),
  'PT400', 'invalid_decision_note',
  'decide_group_application: a blank decision note is malformed');
reset role;

select pg_temp.g584_as(2);
select throws_ok(
  $$select public.decide_group_application(-58400, true)$$,
  'PT404', 'application_not_found',
  'decide_group_application: an id that was never issued is not found');
reset role;

select pg_temp.g584_as(10);
select throws_ok(
  format($$select public.decide_group_application(%s, true)$$, (select again_id from fx584_again)),
  '42501', 'group_manage_forbidden',
  'decide_group_application: a Member with no position on the Group cannot decide');
reset role;

select pg_temp.g584_as(9);
select throws_ok(
  format($$select public.decide_group_application(%s, true)$$, (select again_id from fx584_again)),
  '42501', 'group_manage_forbidden',
  'decide_group_application: an ordinary member of the Group cannot decide either');
reset role;

-- ==================== 10 · decide_group_application: decline, then accept ====================

select pg_temp.g584_as(3);
select lives_ok(
  format($$select public.decide_group_application(%s, false, 'Nu acum')$$, (select again_id from fx584_again)),
  'decide_group_application: a Group RESPONSIBLE may decide — Appointment is their Entry path too');
reset role;

select is(pg_temp.g584_status((select again_id from fx584_again)), 'declined',
  'decide_group_application: a declined Application is declined');
select ok(
  (select decided_by = pg_temp.g584_uid(3) and decided_at is not null and decision_note = 'Nu acum'
     from public.group_applications where id = (select again_id from fx584_again)),
  'decide_group_application: the decline names its decider, its moment and its note');
select is(
  (select link from public.notifications
    where member_id = pg_temp.g584_uid(4)
      and dedupe_key = 'application:' || (select again_id from fx584_again)::text),
  '/grupuri/' || pg_temp.g584_group('Deschis #584')::text,
  'the decision Notification links to the MEMBER-facing Group page, not to Administrare');

select pg_temp.g584_as(2);
select throws_ok(
  format($$select public.decide_group_application(%s, true)$$, (select again_id from fx584_again)),
  'PT409', 'application_not_pending',
  'decide_group_application: a settled Application cannot be decided twice');
reset role;

-- Re-applying after a decline is the acceptance criterion.
select pg_temp.g584_as(4);
create temp table fx584_third as
  select pg_temp.g584_apply(pg_temp.g584_group('Deschis #584'), 'A treia oară') as third_id;
reset role;
select is(pg_temp.g584_status((select third_id from fx584_third)), 'pending',
  'a declined Application never blocks a new one — re-applying after a decline succeeds');

select pg_temp.g584_as(2);
select lives_ok(
  format($$select public.decide_group_application(%s, true)$$, (select third_id from fx584_third)),
  'decide_group_application: the Group Manager accepts');
reset role;

select is(pg_temp.g584_status((select third_id from fx584_third)), 'accepted',
  'decide_group_application: the accepted Application is accepted');
select is(
  (select group_role from public.group_members
    where group_id = pg_temp.g584_group('Deschis #584') and member_id = pg_temp.g584_uid(4)),
  'member',
  'decide_group_application: the accept places the Member through the Appointment core, as an ordinary member');
select is(
  (select count(*) from public.notifications
    where member_id = pg_temp.g584_uid(4)
      and link = '/grupuri/' || pg_temp.g584_group('Deschis #584')::text
      and dedupe_key is null),
  1::bigint,
  'the accept also writes the Appointment core''s own "added to the Group" Notification to the new Member');

-- Authority flows DOWN the path, never up: the Child Group's own Manager has
-- no say over the parent's queue, while the parent's Manager (member 2) holds
-- the position in every Group below and decides both.
select pg_temp.g584_as(8);
select throws_ok(
  format($$select public.decide_group_application(%s, true)$$, (select first_id from fx584)),
  '42501', 'group_manage_forbidden',
  'decide_group_application: a Child Group''s Manager cannot decide the parent Group''s queue');
select lives_ok(
  format($$select public.decide_group_application(%s, false, 'Altă dată')$$,
         (select child_id from fx584_child)),
  'decide_group_application: the Child Group''s own Manager decides its own queue');
reset role;

-- An archived Group settles nothing more.
select pg_temp.g584_as(10);
create temp table fx584_arch as
  select pg_temp.g584_apply(pg_temp.g584_group('Arhivabil #584')) as arch_id;
reset role;
update public.groups set status = 'archived' where name = 'Arhivabil #584';
select pg_temp.g584_bc();
select throws_ok(
  format($$select public.decide_group_application(%s, true)$$, (select arch_id from fx584_arch)),
  'PT409', 'group_archived',
  'decide_group_application: an archived Group decides nothing');
reset role;
update public.groups set status = 'active' where name = 'Arhivabil #584';

-- decide_group_application_impl's own group_archived guard also covers a
-- DECLINE, a path the Appointment core (private.appoint_group_member) never
-- runs and so never double-guards the way it does an accept above. No
-- command can ever leave a Group both archived and carrying a pending
-- Application — apply_to_group refuses an archived Group outright, and
-- archive_group_impl declines every pending Application in the subtree the
-- moment it archives — so this is an owner fixture (OD9) proving the
-- function's own check rather than something reachable through the API.
insert into public.group_applications (group_id, member_id)
values (pg_temp.g584_group('Arhivat #584'), pg_temp.g584_uid(10));

select pg_temp.g584_bc();
select throws_ok(
  format($$select public.decide_group_application(%s, false)$$,
    (select id from public.group_applications
      where group_id = pg_temp.g584_group('Arhivat #584')
        and member_id = pg_temp.g584_uid(10))),
  'PT409', 'group_archived',
  'decide_group_application: an archived Group refuses a decline too — the one path the Appointment core never guards');
reset role;

-- ==================== 11 · the table: no client writes, RLS, the decision shape ====================

select pg_temp.g584_as(4);
select throws_ok(
  format($$insert into public.group_applications (group_id, member_id)
           values (%s, %L)$$,
         pg_temp.g584_group('Închis #584'), pg_temp.g584_uid(4)),
  '42501', null, 'no client may INSERT into group_applications');
select throws_ok(
  format($$update public.group_applications set status = 'accepted' where id = %s$$,
         (select third_id from fx584_third)),
  '42501', null, 'no client may UPDATE group_applications');
select throws_ok(
  format($$delete from public.group_applications where id = %s$$,
         (select third_id from fx584_third)),
  '42501', null, 'no client may DELETE from group_applications');
reset role;

select pg_temp.g584_as(4);
select is(
  (select count(*) from public.group_applications where member_id = pg_temp.g584_uid(4)),
  4::bigint, 'group_applications_read: an applicant reads their own Applications');
reset role;

select pg_temp.g584_as(2);
select ok(
  (select count(*) >= 3 from public.group_applications
    where group_id = pg_temp.g584_group('Deschis #584')),
  'group_applications_read: a Group Manager reads their Group''s whole queue');
reset role;

select pg_temp.g584_as(10);
select is(
  (select count(*) from public.group_applications
    where group_id = pg_temp.g584_group('Deschis #584')),
  0::bigint, 'group_applications_read: a Member with no position and no row of their own reads nothing');
reset role;

select pg_temp.test_clear_jwt();
set local role authenticated;
select is(
  (select count(*) from public.group_applications), 0::bigint,
  'group_applications_read: a claimless session reads no Application at all');
reset role;

select throws_ok(
  format($$insert into public.group_applications (group_id, member_id, status, decided_by)
           values (%s, %L, 'declined', %L)$$,
         pg_temp.g584_group('Închis #584'), pg_temp.g584_uid(10), pg_temp.g584_uid(1)),
  '23514', 'new row for relation "group_applications" violates check constraint "group_applications_decision_ck"',
  'group_applications_decision_ck: a decided row without its moment is refused');
select throws_ok(
  format($$insert into public.group_applications (group_id, member_id, decided_at)
           values (%s, %L, now())$$,
         pg_temp.g584_group('Închis #584'), pg_temp.g584_uid(10)),
  '23514', 'new row for relation "group_applications" violates check constraint "group_applications_decision_ck"',
  'group_applications_decision_ck: a pending row carrying a decision trace is refused');

-- ==================== 12 · ruling R30: the three commands that settle Applications ====================

-- 12a. A demotion below a Group's Minimum Level withdraws the target's pending
--      Applications to every Group they can no longer qualify for (#580).
select pg_temp.g584_as(6);
create temp table fx584_demote as
  select pg_temp.g584_apply(pg_temp.g584_group('Înalt #584')) as demote_id;
reset role;
select is(pg_temp.g584_status((select demote_id from fx584_demote)), 'pending',
  'a Drept de Vot Member may apply to a Group whose Application Level is 3');

select pg_temp.g584_bc();
select lives_ok(
  format($$select public.set_member_role(%L, 'voluntar')$$, pg_temp.g584_uid(6)),
  'set_member_role: BC demotes the applicant below the Group''s Minimum Level');
reset role;

select is(pg_temp.g584_status((select demote_id from fx584_demote)), 'withdrawn',
  'ruling R30: the demotion withdraws the pending Application it made unanswerable');
select is(
  (select decided_by from public.group_applications where id = (select demote_id from fx584_demote)),
  pg_temp.g584_uid(1),
  'ruling R30: the demoting actor is recorded as the decider of that withdrawal');

-- 12b. A raised Minimum Level withdraws the removed Members' pending
--      Applications on that Group (#582, ruling R23). Member 5 is on the Prag
--      roster AND holds a pending Application there, which only a fixture can
--      arrange — apply_to_group refuses an existing member.
insert into public.group_applications (group_id, member_id, note)
values (pg_temp.g584_group('Prag #584'), pg_temp.g584_uid(5), 'Cerere veche');

select pg_temp.g584_bc();
select lives_ok(
  format($$select public.update_group(%s, 'Prag #584', null, true, 1, false, 1, null, null, true)$$,
         pg_temp.g584_group('Prag #584')),
  'update_group: BC raises the Minimum Level above a Member with p_confirm_removals');
reset role;

select is(
  (select count(*) from public.group_members
    where group_id = pg_temp.g584_group('Prag #584') and member_id = pg_temp.g584_uid(5)),
  0::bigint, 'the raised Minimum Level removed the roster row (ruling R23, already #582''s)');
select is(
  (select status from public.group_applications
    where group_id = pg_temp.g584_group('Prag #584') and member_id = pg_temp.g584_uid(5)),
  'withdrawn',
  'ruling R30: the raised Minimum Level also withdraws that Member''s pending Application');

-- 12c. Archiving declines the subtree's pending Applications (#582, ruling R21).
select is(pg_temp.g584_status((select arch_id from fx584_arch)), 'pending',
  'the Application filed on the Group about to be archived is still pending');

select pg_temp.g584_bc();
select lives_ok(
  format($$select public.archive_group(%s)$$, pg_temp.g584_group('Arhivabil #584')),
  'archive_group: BC archives a Group carrying a pending Application');
reset role;

select is(pg_temp.g584_status((select arch_id from fx584_arch)), 'declined',
  'ruling R30: archiving declines the subtree''s pending Applications');
select ok(
  (select decided_by = pg_temp.g584_uid(1) and decision_note = 'Grup arhivat' and decided_at is not null
     from public.group_applications where id = (select arch_id from fx584_arch)),
  'ruling R30: the archiver is the decider and the decision note says why');
select is(
  (select link from public.notifications
    where member_id = pg_temp.g584_uid(10)
      and dedupe_key = 'application:' || (select arch_id from fx584_arch)::text),
  '/grupuri/' || pg_temp.g584_group('Arhivabil #584')::text,
  'ruling R30: the applicant is told, and the link is the member-facing Group page');

-- ==================== 13 · grants ====================

select ok(
  not has_function_privilege('anon', 'public.apply_to_group(bigint, text)', 'execute')
  and not has_function_privilege('service_role', 'public.apply_to_group(bigint, text)', 'execute')
  and has_function_privilege('authenticated', 'public.apply_to_group(bigint, text)', 'execute'),
  'apply_to_group is executable by authenticated and by nobody else');
select ok(
  not has_function_privilege('authenticated', 'private.group_application_recipients(bigint)', 'execute')
  and not has_function_privilege('anon', 'private.group_application_recipients(bigint)', 'execute'),
  'the recipient set is executable by no client role — it decides no authority and answers to no caller');
select ok(
  has_function_privilege('authenticated', 'private.has_pending_group_application(bigint)', 'execute'),
  'the groups_read limb predicate stays callable by authenticated — it runs inside the policy');
select ok(
  not has_table_privilege('authenticated', 'public.group_applications', 'insert')
  and not has_table_privilege('authenticated', 'public.group_applications', 'update')
  and not has_table_privilege('authenticated', 'public.group_applications', 'delete')
  and has_table_privilege('authenticated', 'public.group_applications', 'select'),
  'group_applications grants SELECT to authenticated and no DML at all');

select * from finish();
rollback;
