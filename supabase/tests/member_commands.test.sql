-- member_commands.test.sql — #580: the two audited Member commands,
-- public.set_member_role and public.set_member_status, and the
-- public.role_history row each one writes (#50's table).
--
-- #603 extends it with the session revoke that turns ADR-0003's bounded
-- deactivation window from a sentence into code: every Status change away from
-- `activ` deletes the Member's GoTrue session rows in the same transaction,
-- and a change *to* `activ` deletes nothing.
--
-- Runs in one transaction and rolls back — leaves no residue in the local db.
-- No pg_temp.test_race here on purpose: these commands take one target lock on
-- public.profiles and the host defect in #596 makes the blocking path
-- unreliable locally.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

select plan(108);

-- ==================== Structure ====================

select has_function('public', 'set_member_role', array['uuid', 'member_role', 'text'],
  'the rank command exists with the optional-reason signature #612 specifies');
select has_function('public', 'set_member_status', array['uuid', 'member_status', 'text'],
  'the status command exists with the optional-reason signature #612 specifies');

-- ADR-0009 ruling R15: rank and position decouple. The comment is the durable
-- statement of that boundary, so it is asserted, not assumed.
select matches(
  obj_description('public.set_member_role(uuid, public.member_role, text)'::regprocedure, 'pg_proc'),
  'leaves Group Roles alone',
  'set_member_role''s comment states R15 — it never appoints or removes a Group Role');

-- …and the single exception to it, stated in the same comment so nobody reads
-- R15 as absolute and "fixes" the Minimum-Level cleanup away.
select matches(
  obj_description('public.set_member_role(uuid, public.member_role, text)'::regprocedure, 'pg_proc'),
  'single exception is Minimum Level',
  'and states R15''s one exception — falling below a Group''s Minimum Level');

-- The half of that AC this issue cannot ship: public.group_applications does
-- not exist until #584. Deferred is fine; silently dropped is not.
select matches(
  obj_description('public.set_member_role(uuid, public.member_role, text)'::regprocedure, 'pg_proc'),
  '#584',
  'and names #584 as the owner of the pending-Application withdrawal it cannot do yet');

-- ADR-0003's deactivation window. #580 shipped this comment saying the command
-- hands session revocation to a `revoke-sessions` Edge Function called by #105
-- afterwards; #603's correction of 2026-09-21 retired that design (there is no
-- sign-out-by-user-id in the v2 admin API to build it on) and moved the revoke
-- into the command's own transaction. The comment is asserted, not assumed,
-- because it is the only place a reader is told the access token still lives
-- out its hour.
select matches(
  obj_description('public.set_member_status(uuid, public.member_status, text)'::regprocedure, 'pg_proc'),
  'revokes the Member''s Auth sessions in this same transaction',
  'set_member_status''s comment states that a non-activ Status revokes sessions here, in this transaction (#603)');
select matches(
  obj_description('public.set_member_status(uuid, public.member_status, text)'::regprocedure, 'pg_proc'),
  'at most jwt_expiry \(one hour\)',
  'and still states the ADR-0003 window the revoke bounds but cannot close — the issued access token expires on its own');
select matches(
  obj_description('public.set_member_status(uuid, public.member_status, text)'::regprocedure, 'pg_proc'),
  'never touches group_members',
  'and states that deactivation leaves every roster row and Group Role in place');

-- ==================== #603: the revoke helper ====================

select has_function('private', 'revoke_member_sessions', array['uuid'],
  'the session-revoke helper exists with the signature #603 specifies');

-- The comment is the durable record of *why* this is a database function and
-- not the Edge Function ADR-0003 and #580 both describe. Without it the next
-- reader sees a Postgres function reaching into `auth` and "fixes" it back.
select matches(
  obj_description('private.revoke_member_sessions(uuid)'::regprocedure, 'pg_proc'),
  'takes a user''s JWT, not a user id',
  'and its comment states why it is not an Edge Function — admin.signOut takes a JWT, not a user id (#603)');

-- Executable by no client role at all. This is the `require_*`/trigger shape
-- from conventions section 4: a client that could call this directly would
-- hold an unauthenticated, unaudited sign-out for any Member in OSUBB, because
-- the whole authority gate lives in set_member_status_impl, its only caller.
select is(has_function_privilege('authenticated', 'private.revoke_member_sessions(uuid)', 'execute'), false,
  'authenticated cannot execute private.revoke_member_sessions — the gate is in the command, not in this helper');
select is(has_function_privilege('anon', 'private.revoke_member_sessions(uuid)', 'execute'), false,
  'anon cannot execute private.revoke_member_sessions');
select is(has_function_privilege('service_role', 'private.revoke_member_sessions(uuid)', 'execute'), false,
  'service_role cannot execute private.revoke_member_sessions either — nothing in private is ever service_role''s');
select is(has_function_privilege('public', 'private.revoke_member_sessions(uuid)', 'execute'), false,
  'and the default PUBLIC execute grant Postgres hands every new function was revoked');

-- Deliberately NOT asserted here: that `authenticated` has lost
-- `update (role, status)` on `profiles`. #580 leaves that grant in place, so
-- the direct path still exists beside these commands and the audit is complete
-- only for callers who use them. Closing it is a security-boundary change for
-- every client and belongs in its own PR — the migration header says so, and
-- `rls_profiles_write.test.sql` still pins the behaviour that is true today.

-- ==================== Fixtures ====================

insert into auth.users (id, email) values
  ('58000000-0000-0000-0000-000000000001', 'mod580@test.local'),
  ('58000000-0000-0000-0000-000000000002', 'bc580@test.local'),
  ('58000000-0000-0000-0000-000000000003', 'bce580@test.local'),
  ('58000000-0000-0000-0000-000000000004', 'vol580a@test.local'),
  ('58000000-0000-0000-0000-000000000005', 'vol580b@test.local'),
  ('58000000-0000-0000-0000-000000000006', 'resp580@test.local'),
  ('58000000-0000-0000-0000-000000000007', 'bctarget580@test.local'),
  ('58000000-0000-0000-0000-000000000008', 'bcstale580@test.local'),
  ('58000000-0000-0000-0000-000000000009', 'claimless580@test.local'),
  ('58000000-0000-0000-0000-00000000000a', 'dept580@test.local'),
  ('58000000-0000-0000-0000-00000000000b', 'vot580@test.local'),
  ('58000000-0000-0000-0000-00000000000c', 'promote580@test.local'),
  ('58000000-0000-0000-0000-00000000000d', 'grup580@test.local');

insert into profiles (id, full_name, email, role, status) values
  ('58000000-0000-0000-0000-000000000001', 'Moderator 580',     'mod580@test.local',        'moderator',   'activ'),
  ('58000000-0000-0000-0000-000000000002', 'BC 580',            'bc580@test.local',         'bc',          'activ'),
  ('58000000-0000-0000-0000-000000000003', 'BCE 580',           'bce580@test.local',        'bce',         'activ'),
  ('58000000-0000-0000-0000-000000000004', 'Voluntar 580 A',    'vol580a@test.local',       'voluntar',    'activ'),
  ('58000000-0000-0000-0000-000000000005', 'Voluntar 580 B',    'vol580b@test.local',       'voluntar',    'activ'),
  ('58000000-0000-0000-0000-000000000006', 'Responsabil 580',   'resp580@test.local',       'responsabil', 'activ'),
  ('58000000-0000-0000-0000-000000000007', 'BC țintă 580',      'bctarget580@test.local',   'bc',          'activ'),
  -- Deactivated, but still holding the level-6 token it was issued (ADR-0003).
  ('58000000-0000-0000-0000-000000000008', 'BC dezactivat 580', 'bcstale580@test.local',    'bc',          'inactiv'),
  ('58000000-0000-0000-0000-000000000009', 'Fără claims 580',   'claimless580@test.local',  'voluntar',    'activ'),
  ('58000000-0000-0000-0000-00000000000a', 'Membru EDU 580',    'dept580@test.local',       'voluntar',    'activ'),
  ('58000000-0000-0000-0000-00000000000b', 'Membru cu vot 580', 'vot580@test.local',        'vot',         'activ'),
  ('58000000-0000-0000-0000-00000000000c', 'De promovat 580',   'promote580@test.local',    'voluntar',    'activ'),
  ('58000000-0000-0000-0000-00000000000d', 'Membru grupuri 580','grup580@test.local',       'bce',         'activ');

-- One Department membership, so the Wave 1 mirror has Group Roles to move if
-- the command ever reached for them.
insert into pg_temp.fixture_member_departments (member_id, dept_id)
  values ('58000000-0000-0000-0000-00000000000a', 'edu');

-- Three native Groups spanning the Minimum Level boundary a demotion crosses.
-- Direct inserts are allowed here and nowhere else: ADR-0009 ruling R6 permits
-- them in migrations' own backfills and in rolled-back test fixtures. Separate
-- statements, not one data-modifying CTE — the child's hierarchy trigger reads
-- its parent from `public.groups`, and a sibling CTE's insert is invisible
-- under the statement's own snapshot.
insert into groups (name, category, parent_id, min_level)
  values ('Grup 580 Părinte', 'department', null, 1);
insert into groups (name, category, parent_id, min_level)
  select 'Grup 580 Copil', 'team', parent.id, 3
    from groups as parent where parent.name = 'Grup 580 Părinte';
insert into groups (name, category, parent_id, min_level)
  values ('Grup 580 Separat', 'project', null, 5);

-- A BCE (level 5) who sits on all three: Manager of the low-Minimum ancestor,
-- plain member of the two above their about-to-be rank.
insert into group_members (group_id, member_id, group_role)
  select grp.id, '58000000-0000-0000-0000-00000000000d',
         case when grp.name = 'Grup 580 Părinte' then 'manager' else 'member' end
    from groups as grp
   where grp.name in ('Grup 580 Părinte', 'Grup 580 Copil', 'Grup 580 Separat');

-- #603 fixtures: live GoTrue sessions, written directly because nothing in the
-- database can mint one — GoTrue does that over HTTP, and the live
-- refresh-token rejection is verified by hand against the local stack once, as
-- the issue requires, not from here.
--
-- Four Members hold one each: `…05` is deactivated below, `…0b` is moved to
-- alumni, `…08` is *re*activated, and `…04` is never touched at all and is the
-- bystander that proves the delete is targeted rather than a truncate.
insert into auth.sessions (id, user_id) values
  ('58000000-5e55-0000-0000-000000000004', '58000000-0000-0000-0000-000000000004'),
  ('58000000-5e55-0000-0000-000000000005', '58000000-0000-0000-0000-000000000005'),
  ('58000000-5e55-0000-0000-000000000008', '58000000-0000-0000-0000-000000000008'),
  ('58000000-5e55-0000-0000-00000000000b', '58000000-0000-0000-0000-00000000000b');

-- Refresh tokens: one per session, plus one deliberately session-less row for
-- `…05`. `auth.refresh_tokens.session_id` is nullable, so a row like that
-- survives the `on delete cascade` from `auth.sessions` — it is exactly what
-- the helper's second delete exists for, and what a "the FK handles it"
-- simplification would leave usable.
insert into auth.refresh_tokens (token, user_id, session_id, revoked) values
  ('rt-580-04', '58000000-0000-0000-0000-000000000004', '58000000-5e55-0000-0000-000000000004', false),
  ('rt-580-05', '58000000-0000-0000-0000-000000000005', '58000000-5e55-0000-0000-000000000005', false),
  ('rt-580-05-orphan', '58000000-0000-0000-0000-000000000005', null, false),
  ('rt-580-08', '58000000-0000-0000-0000-000000000008', '58000000-5e55-0000-0000-000000000008', false),
  ('rt-580-0b', '58000000-0000-0000-0000-00000000000b', '58000000-5e55-0000-0000-00000000000b', false);

-- ==================== set_member_role: who may not ====================

select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ select public.set_member_role('58000000-0000-0000-0000-000000000004', 'activ') $$,
  '42501', 'member_manage_forbidden',
  'a BCE (level 5) manages work, not people');
reset role;

select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select public.set_member_role('58000000-0000-0000-0000-000000000005', 'activ') $$,
  '42501', 'member_manage_forbidden',
  'an ordinary member cannot re-rank anyone');
reset role;

-- Stale claims: the token still says level 6, the profile says inactiv. The
-- gate reads the live profile, not the token (house rule 12, ADR-0003 gate 2).
select pg_temp.test_login('58000000-0000-0000-0000-000000000008', jsonb_build_object(
    'member_role', 'bc', 'member_level', 6,
    'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb, 'group_ids', '[]'::jsonb));
select throws_ok(
  $$ select public.set_member_role('58000000-0000-0000-0000-000000000004', 'activ') $$,
  '42501', 'member_manage_forbidden',
  'a deactivated BC holding a still-valid level-6 token re-ranks nobody');
reset role;

select pg_temp.test_login('58000000-0000-0000-0000-000000000009', '{}'::jsonb);
select throws_ok(
  $$ select public.set_member_role('58000000-0000-0000-0000-000000000004', 'activ') $$,
  '42501', 'member_manage_forbidden',
  'a claimless session re-ranks nobody');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(
  $$ select public.set_member_role('58000000-0000-0000-0000-000000000004', 'activ') $$,
  '42501', null,
  'anon cannot even execute the command (invite-only, ADR-0003)');
reset role;

-- Self-target. It is asserted as the *Moderator* on purpose: every actor who
-- clears the level-6 gate holds bc or moderator, so a BC aiming at their own
-- row would be refused by the Moderator-only branch even if the self-rule were
-- deleted, and the assertion would pass for the wrong reason. The Moderator
-- clears that branch, so only the self-rule can be answering here.
select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ select public.set_member_role('58000000-0000-0000-0000-000000000001', 'bce') $$,
  '42501', 'member_manage_forbidden',
  'not even the Moderator re-ranks themselves');
select throws_ok(
  $$ select public.set_member_status('58000000-0000-0000-0000-000000000001', 'inactiv') $$,
  '42501', 'member_manage_forbidden',
  'and not even the Moderator sets their own Status');
reset role;

-- ==================== set_member_role: malformed input ====================

select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000002');
-- Answered ahead of any authority verdict, so they are asserted as BC.

select throws_ok(
  $$ select public.set_member_role('58000000-0000-0000-0000-000000000004', 'responsabil') $$,
  'PT400', 'invalid_member_role',
  'responsabil is a source rank only — nobody is moved onto it (ADR-0009)');
select throws_ok(
  $$ select public.set_member_role('58000000-0000-0000-0000-000000000004', null) $$,
  'PT400', 'invalid_member_role',
  'a null rank is malformed for every caller');
select throws_ok(
  $$ select public.set_member_role('58000000-0000-0000-0000-0000000000ff', 'activ') $$,
  'PT404', 'member_not_found',
  'an unknown Member is PT404, never a silent no-op');

-- ==================== set_member_role: the happy path and its audit ====================

select is(
  (select role::text from public.set_member_role('58000000-0000-0000-0000-000000000004', 'activ')),
  'activ', 'BC promotes a Voluntar and gets the updated profile back');
select is(
  (select role::text from profiles where id = '58000000-0000-0000-0000-000000000004'),
  'activ', 'and the stored rank really changed');
select is(
  (select count(*) from role_history
    where member_id = '58000000-0000-0000-0000-000000000004'),
  1::bigint, 'exactly one role_history row per successful call');
select is(
  (select format('%s|%s|%s|%s|%s', from_role, to_role, changed_by, actor_kind, reason)
     from role_history where member_id = '58000000-0000-0000-0000-000000000004'),
  'voluntar|activ|58000000-0000-0000-0000-000000000002|human|Role changed by leadership (set_member_role)',
  'and it names the real actor, the rank before, the rank after, and why');
select ok(
  (select from_status is null and to_status is null
     from role_history where member_id = '58000000-0000-0000-0000-000000000004'),
  'a rank decision leaves the Status columns null — exactly one dimension per row');

-- Notification RLS exposes only the signed-in Member's own rows. Inspect the
-- command's cross-member side effect as the test owner, then restore the BC
-- session for the remaining command calls.
reset role;
select is(
  (select count(*) from notifications
    where member_id = '58000000-0000-0000-0000-000000000004'),
  1::bigint, 'a successful Role change sends exactly one direct Notification to the active target');
select is(
  (select format('%s|%s|%s|%s|%s|%s|%s',
                 kind, title, body, coalesce(link, ''),
                 coalesce(task_id::text, ''), coalesce(dedupe_key, ''), critical)
     from notifications
    where member_id = '58000000-0000-0000-0000-000000000004'),
  -- `format('%s', <boolean>)` renders `f`/`t`, not `false`/`true`.
  'system|Rol actualizat|Rolul tău în OSUBB este acum Voluntar Activ.||||f',
  'the Role Notification uses the Role display name and has no Task link or dedupe key');
select is(
  (select count(*) from notifications
    where member_id = '58000000-0000-0000-0000-000000000002'),
  0::bigint, 'the Role command never echoes a Notification to its actor');
select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000002');

select throws_ok(
  $$ select public.set_member_role('58000000-0000-0000-0000-000000000004', 'activ') $$,
  'PT409', 'nothing_to_update',
  'setting a Member to the rank they already hold is a state conflict, not a no-op');

-- The other half of the responsabil rule: a holder may be moved off it.
select is(
  (select role::text from public.set_member_role('58000000-0000-0000-0000-000000000006', 'activ')),
  'activ', 'a responsabil holder is re-ranked away from it — source rank, not target');
select is(
  (select role::text from public.set_member_role('58000000-0000-0000-0000-000000000006', 'vot')),
  'vot', 'BC may grant Drept de Vot through the same audited command');
reset role;
select is(
  -- This Member collected two Notifications (responsabil -> activ, then
  -- activ -> vot). `created_at` defaults to now(), which is the *transaction*
  -- timestamp and therefore identical for both rows, so ordering by it picks
  -- one at random; the identity column is the only reliable "latest".
  (select body from notifications
    where member_id = '58000000-0000-0000-0000-000000000006'
    order by id desc limit 1),
  'Rolul tău în OSUBB este acum Voluntar cu Drept de Vot. Ești membru al Adunării Generale.',
  'the Drept de Vot Notification also explains the Adunarea Generală consequence');
select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000002');

-- ==================== set_member_role: bc/moderator is the Moderator's ====================

select throws_ok(
  $$ select public.set_member_role('58000000-0000-0000-0000-00000000000c', 'bc') $$,
  '42501', 'member_manage_forbidden',
  'BC cannot mint another BC');
select throws_ok(
  $$ select public.set_member_role('58000000-0000-0000-0000-00000000000c', 'moderator') $$,
  '42501', 'member_manage_forbidden',
  'BC cannot mint a Moderator');
select throws_ok(
  $$ select public.set_member_role('58000000-0000-0000-0000-000000000007', 'bce') $$,
  '42501', 'member_manage_forbidden',
  'and BC cannot unseat a sitting BC either');
reset role;

select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000001');
select is(
  (select role::text from public.set_member_role('58000000-0000-0000-0000-00000000000c', 'bc')),
  'bc', 'the Moderator appoints a BC');
select is(
  (select role::text from public.set_member_role('58000000-0000-0000-0000-000000000007', 'bce')),
  'bce', 'and the Moderator unseats one');
reset role;

-- ==================== set_member_role leaves Group Roles alone (R15) ====================
-- voluntar -> activ does not cross the rank-BCE line, so the Wave 1 mirror
-- (#509's profiles_rederive_group_roles) has nothing to do either: whatever
-- moves here would be this command reaching into group_members, which R15
-- forbids.

create temporary table group_roles_before on commit drop as
  select group_id, group_role from group_members
   where member_id = '58000000-0000-0000-0000-00000000000a';

select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ select public.set_member_role('58000000-0000-0000-0000-00000000000a', 'activ') $$,
  'BC re-ranks a Member who holds a Department Group membership');
reset role;

select is_empty(
  $$ (select group_id, group_role from group_members
       where member_id = '58000000-0000-0000-0000-00000000000a'
      except all
      select group_id, group_role from group_roles_before)
     union all
     (select group_id, group_role from group_roles_before
      except all
      select group_id, group_role from group_members
       where member_id = '58000000-0000-0000-0000-00000000000a') $$,
  'not one group_members row moved — set_member_role never touches Group Roles (R15)');

-- ==================== …except Minimum Level, R15's one exception ====================
-- A Group states the rank its members must hold. The BCE below sits on three:
-- Manager of the ancestor (Minimum 1), plain member of its child (Minimum 3)
-- and of an unrelated Group (Minimum 5). Demoted to voluntar (level 1) they
-- keep exactly the ancestor row — Minimum 1 is *at* the new rank, not above it
-- — and lose the other two, Group Role and all. T13's invariant (#586) holds
-- from this side because of that.

select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000002');
select is(
  (select role::text
     from public.set_member_role('58000000-0000-0000-0000-00000000000d', 'voluntar')),
  'voluntar', 'BC demotes a BCE who sits on three Groups');
reset role;

select is(
  (select count(*) from group_members
    where member_id = '58000000-0000-0000-0000-00000000000d'),
  1::bigint, 'the demotion leaves exactly one of the three roster rows standing');
select is(
  (select format('%s|%s', grp.name, membership.group_role)
     from group_members as membership
     join groups as grp on grp.id = membership.group_id
    where membership.member_id = '58000000-0000-0000-0000-00000000000d'),
  'Grup 580 Părinte|manager',
  'and it is the ancestor''s Manager row, whose Minimum Level the new rank still meets — authority keeps flowing down groups.path');
select is_empty(
  $$ select 1 from group_members as membership
       join groups as grp on grp.id = membership.group_id
      where membership.member_id = '58000000-0000-0000-0000-00000000000d'
        and grp.name in ('Grup 580 Copil', 'Grup 580 Separat') $$,
  'the rows on both Groups whose Minimum Level is above the new rank are gone — ordinary membership and Group Role alike');
select is(
  (select body from notifications
    where member_id = '58000000-0000-0000-0000-00000000000d'
    order by id desc limit 1),
  'Rolul tău în OSUBB este acum Voluntar. Nu mai faci parte din: Grup 580 Copil, Grup 580 Separat.',
  'and the Notification names every Group the demotion cost them, in one message');

-- The Groups themselves are untouched: this command removes a Member from a
-- Group, it never edits the Group.
select is(
  (select count(*) from groups
    where name in ('Grup 580 Părinte', 'Grup 580 Copil', 'Grup 580 Separat')),
  3::bigint, 'and the three Groups themselves are still there — a roster row went, not a Group');

-- ==================== set_member_status: who may not ====================

select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ select public.set_member_status('58000000-0000-0000-0000-000000000005', 'inactiv') $$,
  '42501', 'member_manage_forbidden',
  'a BCE deactivates nobody');
reset role;

select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000005');
select throws_ok(
  $$ select public.set_member_status('58000000-0000-0000-0000-000000000004', 'inactiv') $$,
  '42501', 'member_manage_forbidden',
  'an ordinary member deactivates nobody');
reset role;

select pg_temp.test_login('58000000-0000-0000-0000-000000000009', '{}'::jsonb);
select throws_ok(
  $$ select public.set_member_status('58000000-0000-0000-0000-000000000005', 'inactiv') $$,
  '42501', 'member_manage_forbidden',
  'a claimless session deactivates nobody');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(
  $$ select public.set_member_status('58000000-0000-0000-0000-000000000005', 'inactiv') $$,
  '42501', null,
  'anon cannot even execute the status command');
reset role;

-- Deactivating a BC removes their authority as thoroughly as demoting them
-- would, so it sits behind the same Moderator-only rule. The target is the BC
-- the Moderator appointed above — still sitting, unlike the one it unseated.
select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ select public.set_member_status('58000000-0000-0000-0000-00000000000c', 'inactiv') $$,
  '42501', 'member_manage_forbidden',
  'BC cannot deactivate a sitting BC — that is unseating by another name');

-- ==================== set_member_status: malformed input ====================

select throws_ok(
  $$ select public.set_member_status('58000000-0000-0000-0000-000000000005', null) $$,
  'PT400', 'invalid_member_status',
  'a null Status is malformed for every caller');
select throws_ok(
  $$ select public.set_member_status('58000000-0000-0000-0000-0000000000ff', 'inactiv') $$,
  'PT404', 'member_not_found',
  'an unknown Member is PT404 here too');

-- ==================== set_member_status: the happy path and its audit ====================

select is(
  (select status::text from public.set_member_status('58000000-0000-0000-0000-000000000005', 'inactiv')),
  'inactiv', 'BC deactivates a Member and gets the updated profile back');
select is(
  (select status::text from profiles where id = '58000000-0000-0000-0000-000000000005'),
  'inactiv', 'and the stored Status really changed');
reset role;
select is(
  (select count(*) from notifications
    where member_id = '58000000-0000-0000-0000-000000000005'),
  0::bigint, 'Membership Status changes never write Notifications');

-- #603. The whole point of the issue: the deactivated Member's GoTrue sessions
-- are gone in the same transaction as the Status change, so no refresh token
-- they hold can mint another access token. Read as postgres — `authenticated`
-- has no business reading `auth.sessions` and cannot.
select is(
  (select count(*) from auth.sessions
    where user_id = '58000000-0000-0000-0000-000000000005'),
  0::bigint, 'deactivation deletes every auth.sessions row the Member held (#603)');
select is(
  (select count(*) from auth.refresh_tokens
    where user_id = '58000000-0000-0000-0000-000000000005'),
  0::bigint, 'and every refresh token with it, including the session-less row the FK cascade does not reach');

-- …and nobody else's. A revoke that took the whole table would satisfy the two
-- assertions above and lock the organization out.
select is(
  (select count(*) from auth.sessions
    where user_id = '58000000-0000-0000-0000-000000000004')
  + (select count(*) from auth.refresh_tokens
      where user_id = '58000000-0000-0000-0000-000000000004'),
  2::bigint, 'a bystander Member''s session and refresh token are untouched — the revoke is by member id');

-- The Minimum-Level cleanup belongs to the Role command alone. Deactivation is
-- not a demotion: the Wave 2 helpers already refuse an inactive actor, so the
-- roster row and its Group Role stay put and a reactivated Member resumes the
-- same position. `…0d` still holds the ancestor Manager row from the section
-- above, which is exactly the row a status-side cleanup would eat.
select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ select public.set_member_status('58000000-0000-0000-0000-00000000000d', 'inactiv') $$,
  'BC deactivates a Member who holds a Group Manager position');
reset role;
select is(
  (select format('%s|%s', grp.name, membership.group_role)
     from group_members as membership
     join groups as grp on grp.id = membership.group_id
    where membership.member_id = '58000000-0000-0000-0000-00000000000d'),
  'Grup 580 Părinte|manager',
  'and the position survives deactivation untouched — set_member_status changes no group_members row');
select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000002');
select is(
  (select count(*) from role_history
    where member_id = '58000000-0000-0000-0000-000000000005'),
  1::bigint, 'exactly one role_history row per successful status call');
select is(
  (select format('%s|%s|%s|%s|%s|%s',
                 from_role, to_role, from_status, to_status, changed_by, reason)
     from role_history where member_id = '58000000-0000-0000-0000-000000000005'),
  'voluntar|voluntar|activ|inactiv|58000000-0000-0000-0000-000000000002|Status changed by leadership (set_member_status)',
  'a Status decision repeats the unchanged rank and records both Statuses, the actor, and why');

select throws_ok(
  $$ select public.set_member_status('58000000-0000-0000-0000-000000000005', 'inactiv') $$,
  'PT409', 'nothing_to_update',
  'setting a Member to the Status they already hold is a state conflict');

-- #50's voting guard (from_role or to_role = 'vot' needs a live BC/Moderator
-- actor) sees a Status row's repeated rank too — this proves the two designs
-- agree rather than fighting.
select lives_ok(
  $$ select public.set_member_status('58000000-0000-0000-0000-00000000000b', 'alumni') $$,
  'a Member with voting rights can be moved to alumni — #50''s voting guard is satisfied by the named BC actor');
reset role;

-- #603's condition is on the destination Status, not on `inactiv` by name:
-- `alumni` ends a Member's access exactly as thoroughly, and `member_status`
-- has no third non-activ value to miss.
select is(
  (select count(*) from auth.sessions
    where user_id = '58000000-0000-0000-0000-00000000000b'),
  0::bigint, 'moving a Member to alumni revokes their sessions too — every Status that is not activ does');

-- ==================== what deactivation actually achieves ====================
-- Two halves, and both are needed. The ADR-0003 gate below is immediate: the
-- live authority lookups answer "nobody" the instant the Status lands, so
-- every command gate and policy predicate denies. #603's revoke is what closes
-- the other end — with no session row left, the token that still carries stale
-- claims cannot be renewed, so the window is bounded by jwt_expiry instead of
-- running until the Member chooses to sign out.

select is(
  (select private.actor_level('58000000-0000-0000-0000-000000000005')),
  null::integer, 'the moment the Status lands, the live level lookup answers nothing');
select is(
  (select public.member_level('58000000-0000-0000-0000-000000000005')),
  0, 'and the service-facing level endpoint answers 0 (ADR-0003 gate 2)');

select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000001');
select is(
  (select status::text from public.set_member_status('58000000-0000-0000-0000-00000000000c', 'inactiv')),
  'inactiv', 'the Moderator may deactivate a sitting BC');

-- #603's other direction, and the one a careless `if p_status is distinct from
-- v_from` would break: reactivation revokes nothing. `…08` is the deactivated
-- BC from the fixtures, holding a session row throughout; the Moderator brings
-- them back, and the session they were already holding is still theirs. There
-- is no security reason to sign a returning Member out.
select is(
  (select status::text from public.set_member_status('58000000-0000-0000-0000-000000000008', 'activ')),
  'activ', 'the Moderator reactivates the deactivated BC');
reset role;
select is(
  (select count(*) from auth.sessions
    where user_id = '58000000-0000-0000-0000-000000000008')
  + (select count(*) from auth.refresh_tokens
      where user_id = '58000000-0000-0000-0000-000000000008'),
  2::bigint, 'a Status change to activ revokes nothing — the reactivated Member keeps the session and refresh token they held (#603)');

-- ==================== the widened audit row admits exactly one dimension ====================
-- #580 added from_status/to_status to #50's table and replaced its
-- "from_role <> to_role" check. These two prove the replacement is not looser.

select throws_ok(
  $$ insert into role_history
       (member_id, from_role, to_role, from_status, to_status, changed_by, actor_kind, reason)
     values ('58000000-0000-0000-0000-000000000004', 'activ', 'bce', 'activ', 'inactiv',
             '58000000-0000-0000-0000-000000000002', 'human', 'Both at once') $$,
  '23514', 'new row for relation "role_history" violates check constraint "role_history_change_ck"',
  'a row changing rank and Status at once is refused — two decisions, two rows');
select throws_ok(
  $$ insert into role_history
       (member_id, from_role, to_role, changed_by, actor_kind, reason)
     values ('58000000-0000-0000-0000-000000000004', 'activ', 'activ',
             '58000000-0000-0000-0000-000000000002', 'human', 'Nothing at all') $$,
  '23514', 'new row for relation "role_history" violates check constraint "role_history_change_ck"',
  'and a row recording no change at all is still refused, exactly as #50 intended');

-- #612: optional reasons preserve the existing two-argument behavior.
select has_function('private', 'set_member_role_impl', array['uuid', 'member_role', 'text'], 'the role implementation accepts a reason');
select is(has_function_privilege('anon', 'public.set_member_role(uuid, public.member_role, text)', 'execute'), false, 'anon execute on public role command is false');
select is(has_function_privilege('public', 'public.set_member_role(uuid, public.member_role, text)', 'execute'), false, 'public execute on public role command is false');
select is(has_function_privilege('service_role', 'public.set_member_role(uuid, public.member_role, text)', 'execute'), false, 'service_role execute on public role command is false');
select is(has_function_privilege('authenticated', 'public.set_member_role(uuid, public.member_role, text)', 'execute'), true, 'authenticated execute on public role command is true');
select is(has_function_privilege('anon', 'private.set_member_role_impl(uuid, public.member_role, text)', 'execute'), false, 'anon execute on private role command is false');
select is(has_function_privilege('public', 'private.set_member_role_impl(uuid, public.member_role, text)', 'execute'), false, 'public execute on private role command is false');
select is(has_function_privilege('service_role', 'private.set_member_role_impl(uuid, public.member_role, text)', 'execute'), false, 'service_role execute on private role command is false');
select is(has_function_privilege('authenticated', 'private.set_member_role_impl(uuid, public.member_role, text)', 'execute'), true, 'authenticated execute on private role command is true');
select has_function('private', 'set_member_status_impl', array['uuid', 'member_status', 'text'], 'the status implementation accepts a reason');
select is(has_function_privilege('anon', 'public.set_member_status(uuid, public.member_status, text)', 'execute'), false, 'anon execute on public status command is false');
select is(has_function_privilege('public', 'public.set_member_status(uuid, public.member_status, text)', 'execute'), false, 'public execute on public status command is false');
select is(has_function_privilege('service_role', 'public.set_member_status(uuid, public.member_status, text)', 'execute'), false, 'service_role execute on public status command is false');
select is(has_function_privilege('authenticated', 'public.set_member_status(uuid, public.member_status, text)', 'execute'), true, 'authenticated execute on public status command is true');
select is(has_function_privilege('anon', 'private.set_member_status_impl(uuid, public.member_status, text)', 'execute'), false, 'anon execute on private status command is false');
select is(has_function_privilege('public', 'private.set_member_status_impl(uuid, public.member_status, text)', 'execute'), false, 'public execute on private status command is false');
select is(has_function_privilege('service_role', 'private.set_member_status_impl(uuid, public.member_status, text)', 'execute'), false, 'service_role execute on private status command is false');
select is(has_function_privilege('authenticated', 'private.set_member_status_impl(uuid, public.member_status, text)', 'execute'), true, 'authenticated execute on private status command is true');

insert into auth.users (id, email) values
  ('61200000-0000-0000-0000-000000000001', 'reason612@test.local');
insert into public.profiles (id, full_name, email, role, status) values
  ('61200000-0000-0000-0000-000000000001', 'Reason 612', 'reason612@test.local', 'voluntar', 'activ');
select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000002');

select is((select role::text from public.set_member_role(
  '61200000-0000-0000-0000-000000000001', 'activ', E' \tDecizie motivată\n ')),
  'activ', 'role command accepts reason case 1');
reset role;
select is((select reason from public.role_history
  where member_id = '61200000-0000-0000-0000-000000000001'
  order by id desc limit 1), 'Decizie motivată', 'role reason case 1 is trimmed or uses the fallback');
select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000002');
select is((select role::text from public.set_member_role(
  '61200000-0000-0000-0000-000000000001', 'vot', null)),
  'vot', 'role command accepts reason case 2');
reset role;
select is((select reason from public.role_history
  where member_id = '61200000-0000-0000-0000-000000000001'
  order by id desc limit 1), 'Role changed by leadership (set_member_role)', 'role reason case 2 is trimmed or uses the fallback');
select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000002');
select is((select role::text from public.set_member_role(
  '61200000-0000-0000-0000-000000000001', 'voluntar', E' \t\n\r ')),
  'voluntar', 'role command accepts reason case 3');
reset role;
select is((select reason from public.role_history
  where member_id = '61200000-0000-0000-0000-000000000001'
  order by id desc limit 1), 'Role changed by leadership (set_member_role)', 'role reason case 3 is trimmed or uses the fallback');
select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000002');
select is((select status::text from public.set_member_status(
  '61200000-0000-0000-0000-000000000001', 'inactiv', E' \tDecizie motivată\n ')),
  'inactiv', 'status command accepts reason case 1');
reset role;
select is((select reason from public.role_history
  where member_id = '61200000-0000-0000-0000-000000000001'
  order by id desc limit 1), 'Decizie motivată', 'status reason case 1 is trimmed or uses the fallback');
select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000002');
select is((select status::text from public.set_member_status(
  '61200000-0000-0000-0000-000000000001', 'activ', null)),
  'activ', 'status command accepts reason case 2');
reset role;
select is((select reason from public.role_history
  where member_id = '61200000-0000-0000-0000-000000000001'
  order by id desc limit 1), 'Status changed by leadership (set_member_status)', 'status reason case 2 is trimmed or uses the fallback');
select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000002');
select is((select status::text from public.set_member_status(
  '61200000-0000-0000-0000-000000000001', 'alumni', E' \t\n\r ')),
  'alumni', 'status command accepts reason case 3');
reset role;
select is((select reason from public.role_history
  where member_id = '61200000-0000-0000-0000-000000000001'
  order by id desc limit 1), 'Status changed by leadership (set_member_status)', 'status reason case 3 is trimmed or uses the fallback');
select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000002');
reset role;
select pg_temp.test_login_leadership('58000000-0000-0000-0000-000000000003');
select throws_ok($$select public.set_member_role(
  '61200000-0000-0000-0000-000000000001', 'activ', 'A reason grants no authority')$$,
  '42501', 'member_manage_forbidden', 'a supplied role reason does not bypass authority');
select throws_ok($$select public.set_member_status(
  '61200000-0000-0000-0000-000000000001', 'activ', 'A reason grants no authority')$$,
  '42501', 'member_manage_forbidden', 'a supplied status reason does not bypass authority');
reset role;

select * from finish();
rollback;
