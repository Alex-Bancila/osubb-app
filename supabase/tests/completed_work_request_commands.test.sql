-- #344: public.create_completed_work_request /
-- approve_completed_work_request / reject_completed_work_request -- the three
-- commands that turn a Member's claim of already-completed work into a real,
-- evaluated, paid Task (ADR-0007 Sec "Completed-work requests").
--
-- Three things this suite exists to pin, beyond the usual gate/authority/state
-- matrix:
--
--   1. ONE DECIDER SET drives both notifications and decisions. Group Responsibles
--      decide ordinary members Requests; Managers and BC decide protected members.
--      The requester is always excluded, including Managers and BC.
--
--   2. THE VISIBILITY BOUNDARY IS THE READ POLICY, NOT THE DECIDER SET.
--      A caller who cannot even read the Request (completed_work_requests_read:
--      the requester, or private.can_manage_group_work) gets PT404
--      request_not_found -- hidden and missing are indistinguishable. A caller
--      who CAN read it but may not decide it gets 42501
--      request_decide_forbidden. See the migration header for why this is the
--      only boundary that satisfies every outcome #344 pins.
--
--   3. TWO CONCURRENT APPROVALS PRODUCE EXACTLY ONE TASK. Section 13's race is
--      the centrepiece: the loser blocks on the Request row's FOR UPDATE
--      (b_waited = true) and wakes to a clean PT409 request_not_pending --
--      never a second Task, a second Evaluation or a second payout.
--
-- Fixture prefix 34400000-0000-0000-0000-0000000000NN, resolved as the owner
-- into temp tables BEFORE any persona logs in (the #328 trap, stack-context.md
-- carry-forwards). Committed fixtures for the lock probe and the race use
-- 34400000-...-0000000000 5[1-3] and are created and removed through their own
-- dblink connection.
begin;
\set osubb_test_suite true
\ir _helpers.sql
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists pgrowlocks with schema extensions;

select plan(113);

-- ==================== Fixtures ====================
insert into auth.users (id, email) values
  ('34400000-0000-0000-0000-000000000001', 'bc.344@test.local'),
  ('34400000-0000-0000-0000-000000000002', 'bce.edu.344@test.local'),
  ('34400000-0000-0000-0000-000000000003', 'bce.pr.344@test.local'),
  ('34400000-0000-0000-0000-000000000004', 'membru.edu.344@test.local'),
  ('34400000-0000-0000-0000-000000000005', 'membru.pr.344@test.local'),
  ('34400000-0000-0000-0000-000000000006', 'lead.344@test.local'),
  ('34400000-0000-0000-0000-000000000007', 'responsabil.344@test.local'),
  ('34400000-0000-0000-0000-000000000008', 'membru.proiect.344@test.local'),
  ('34400000-0000-0000-0000-000000000009', 'membru.ind.344@test.local'),
  ('34400000-0000-0000-0000-000000000010', 'bc.inactiv.344@test.local'),
  ('34400000-0000-0000-0000-000000000011', 'fara.claimuri.344@test.local'),
  ('34400000-0000-0000-0000-000000000012', 'membru.echipa.dept.344@test.local'),
  ('34400000-0000-0000-0000-000000000013', 'bce.edu.doi.344@test.local'),
  ('34400000-0000-0000-0000-000000000014', 'membru.respins.344@test.local'),
  ('34400000-0000-0000-0000-000000000016', 'membru.ind.doi.344@test.local'),
  ('34400000-0000-0000-0000-000000000017', 'membru.dezactivat.344@test.local');

insert into public.profiles (id, full_name, email, role, status) values
  ('34400000-0000-0000-0000-000000000001', 'BC 344', 'bc.344@test.local', 'bc', 'activ'),
  ('34400000-0000-0000-0000-000000000002', 'BCE EDU 344', 'bce.edu.344@test.local', 'bce', 'activ'),
  ('34400000-0000-0000-0000-000000000003', 'BCE PR 344', 'bce.pr.344@test.local', 'bce', 'activ'),
  ('34400000-0000-0000-0000-000000000004', 'Membru EDU 344', 'membru.edu.344@test.local', 'voluntar', 'activ'),
  ('34400000-0000-0000-0000-000000000005', 'Membru PR 344', 'membru.pr.344@test.local', 'voluntar', 'activ'),
  ('34400000-0000-0000-0000-000000000006', 'Lead Proiect 344', 'lead.344@test.local', 'voluntar', 'activ'),
  ('34400000-0000-0000-0000-000000000007', 'Responsabil Proiect 344', 'responsabil.344@test.local', 'voluntar', 'activ'),
  ('34400000-0000-0000-0000-000000000008', 'Membru Proiect 344', 'membru.proiect.344@test.local', 'voluntar', 'activ'),
  ('34400000-0000-0000-0000-000000000009', 'Membru Echipa Independenta 344', 'membru.ind.344@test.local', 'voluntar', 'activ'),
  ('34400000-0000-0000-0000-000000000010', 'BC Inactiv 344', 'bc.inactiv.344@test.local', 'bc', 'inactiv'),
  ('34400000-0000-0000-0000-000000000011', 'Fara Claimuri 344', 'fara.claimuri.344@test.local', 'voluntar', 'activ'),
  ('34400000-0000-0000-0000-000000000012', 'Membru Echipa Departamentala 344', 'membru.echipa.dept.344@test.local', 'voluntar', 'activ'),
  ('34400000-0000-0000-0000-000000000013', 'BCE EDU Doi 344', 'bce.edu.doi.344@test.local', 'bce', 'activ'),
  ('34400000-0000-0000-0000-000000000014', 'Membru Respins 344', 'membru.respins.344@test.local', 'voluntar', 'activ'),
  ('34400000-0000-0000-0000-000000000016', 'Membru Echipa Independenta Doi 344', 'membru.ind.doi.344@test.local', 'voluntar', 'activ'),
  ('34400000-0000-0000-0000-000000000017', 'Membru Dezactivat 344', 'membru.dezactivat.344@test.local', 'voluntar', 'inactiv');

insert into pg_temp.fixture_member_departments (member_id, dept_id) values
  ('34400000-0000-0000-0000-000000000002', 'edu'),
  ('34400000-0000-0000-0000-000000000003', 'pr'),
  ('34400000-0000-0000-0000-000000000004', 'edu'),
  ('34400000-0000-0000-0000-000000000005', 'pr'),
  ('34400000-0000-0000-0000-000000000006', 'edu'),
  ('34400000-0000-0000-0000-000000000007', 'edu'),
  ('34400000-0000-0000-0000-000000000008', 'edu'),
  ('34400000-0000-0000-0000-000000000011', 'edu'),
  ('34400000-0000-0000-0000-000000000012', 'edu'),
  ('34400000-0000-0000-0000-000000000013', 'edu'),
  ('34400000-0000-0000-0000-000000000014', 'edu'),
  ('34400000-0000-0000-0000-000000000017', 'edu');

insert into pg_temp.fixture_teams (id, name, dept_id) values
  ('t-344-dt', 'Echipa Departamentala 344', 'edu'),
  ('t-344-ind', 'Echipa Independenta 344', null);

insert into pg_temp.fixture_team_members (team_id, member_id) values
  ('t-344-dt', '34400000-0000-0000-0000-000000000012'),
  ('t-344-ind', '34400000-0000-0000-0000-000000000009'),
  ('t-344-ind', '34400000-0000-0000-0000-000000000016');

insert into pg_temp.fixture_projects (name, status, leader_id, created_by) values
  ('Proiect #344', 'active',
   '34400000-0000-0000-0000-000000000006', '34400000-0000-0000-0000-000000000001'),
  ('Proiect arhivat #344', 'archived',
   '34400000-0000-0000-0000-000000000006', '34400000-0000-0000-0000-000000000001');

insert into pg_temp.fixture_project_members (project_id, member_id, project_role) values
  ((select id from pg_temp.fixture_projects where name = 'Proiect #344'),
   '34400000-0000-0000-0000-000000000007', 'responsible'),
  ((select id from pg_temp.fixture_projects where name = 'Proiect #344'),
   '34400000-0000-0000-0000-000000000008', 'member'),
  ((select id from pg_temp.fixture_projects where name = 'Proiect arhivat #344'),
   '34400000-0000-0000-0000-000000000008', 'member');

-- ---- Test isolation: quiet every BC/Moderator this suite did not create.
-- The decider set deliberately includes EVERY live BC/Moderator, so the demo
-- seed's bc@demo.osubb and moderator@demo.osubb would otherwise sit inside
-- every set_eq below. Derived by role rather than by the two seed UUIDs the
-- #340 carry-forward warns about hard-coding; confined to this suite's own
-- rolled-back transaction. Neither seed account leads or is Responsible on an
-- active Project, so private.protect_active_project_manager_deactivation does
-- not fire; if a future seed changes that, this line fails loudly rather than
-- silently skewing a recipient set.
update public.profiles
   set status = 'inactiv'
 where role in ('bc', 'moderator')
   and status = 'activ'
   and id <> '34400000-0000-0000-0000-000000000001';

select is((select count(*) from public.profiles as profile
             join public.roles as profile_role on profile_role.id = profile.role
            where profile_role.level >= 6 and profile.status = 'activ'), 1::bigint,
  'exactly one live BC/Moderator remains in this transaction, so every decider set below is fully determined by this suite''s own fixtures');

-- ---- Descriptions. D1 is deliberately longer than 120 characters so that
-- both truncations (60 in the notification title, 120 in the Task title) bite.
create temp table d344 as
select 'Am organizat standul OSUBB la targul de voluntariat, am pregatit materialele de promovare si am raspuns intrebarilor studentilor timp de trei zile intregi.'::text as dept_description,
       'Am facut designul afiselor pentru proiect.'::text as project_description,
       'Am carat materialele echipei independente la depozit.'::text as ind_description,
       'Am tinut evidenta prezentei la sedintele echipei departamentale.'::text as dt_description;
grant select on d344 to authenticated;

select cmp_ok((select length(dept_description) from d344), '>', 120,
  'the Department Request''s description is longer than 120 characters, so both title truncations are actually exercised');
-- #586: materialize this suite's legacy setup as rolled-back Group fixtures.
select pg_temp.materialize_legacy_groups();


-- ---- Requests inserted directly as the owner (no command, no notifications).
insert into public.completed_work_requests (requester_id, group_id, description) values
  ('34400000-0000-0000-0000-000000000004', pg_temp.dept_group('edu'), 'Cerere tinta pentru refuzuri #344'),
  ('34400000-0000-0000-0000-000000000004', pg_temp.dept_group('edu'), 'Cerere aprobata de BC #344'),
  ('34400000-0000-0000-0000-000000000004', pg_temp.dept_group('edu'), 'Cerere aprobata de al doilea BCE #344'),
  ('34400000-0000-0000-0000-000000000014', pg_temp.dept_group('edu'), 'Cerere care va fi respinsa #344'),
  ('34400000-0000-0000-0000-000000000011', pg_temp.dept_group('edu'), 'Cerere de un singur punct #344'),
  ('34400000-0000-0000-0000-000000000017', pg_temp.dept_group('edu'), 'Cerere de la un membru dezactivat #344');
insert into public.completed_work_requests (requester_id, group_id, description)
select '34400000-0000-0000-0000-000000000008', pg_temp.project_group(project.id), 'A doua cerere de proiect #344'
  from pg_temp.fixture_projects as project where project.name = 'Proiect #344';
-- Filed while the Project was live, then the Project was archived. Only the
-- direct insert can produce this shape: create_completed_work_request requires
-- an active Project.
insert into public.completed_work_requests (requester_id, group_id, description)
select '34400000-0000-0000-0000-000000000008', pg_temp.project_group(project.id), 'Cerere pe un proiect arhivat intre timp #344'
  from pg_temp.fixture_projects as project where project.name = 'Proiect arhivat #344';
-- Same shape, but filed by the LEAD themselves. This is the one caller who
-- clears the command's visibility test on an archived Project without
-- private.can_manage_project_work ever being consulted (requester_id =
-- auth.uid() short-circuits the disjunction), so it is the only caller who can
-- reach the decider predicate's Project branch there -- see section 7b-bis.
insert into public.completed_work_requests (requester_id, group_id, description)
select '34400000-0000-0000-0000-000000000006', pg_temp.project_group(project.id), 'Cerere proprie a leadului pe proiect arhivat #344'
  from pg_temp.fixture_projects as project where project.name = 'Proiect arhivat #344';
-- And on the ACTIVE Project: the lead files their own Request and later
-- decides it themselves (section 8b).
insert into public.completed_work_requests (requester_id, group_id, description)
select '34400000-0000-0000-0000-000000000006', pg_temp.project_group(project.id), 'Cerere proprie a leadului pe proiectul activ #344'
  from pg_temp.fixture_projects as project where project.name = 'Proiect #344';

-- ==================== 1. Create: a Department Member's own Request ====================
select pg_temp.test_login('34400000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$
  select public.create_completed_work_request(%L, pg_temp.dept_group('edu'))
$$, (select dept_description from d344)),
  'an ordinary live Member of the Department creates a Completed-work Request for it -- creating is membership, never management');
reset role;

create temp table f344 as
select (select id from public.completed_work_requests
         where description = (select dept_description from d344)) as dept_request_id,
       (select id from public.completed_work_requests
         where description = 'Cerere tinta pentru refuzuri #344') as deny_request_id,
       (select id from public.completed_work_requests
         where description = 'Cerere aprobata de BC #344') as bc_request_id,
       (select id from public.completed_work_requests
         where description = 'Cerere aprobata de al doilea BCE #344') as bce2_request_id,
       (select id from public.completed_work_requests
         where description = 'Cerere care va fi respinsa #344') as reject_request_id,
       (select id from public.completed_work_requests
         where description = 'Cerere de un singur punct #344') as singular_request_id,
       (select id from public.completed_work_requests
         where description = 'Cerere de la un membru dezactivat #344') as dead_requester_request_id,
       (select id from public.completed_work_requests
         where description = 'A doua cerere de proiect #344') as project2_request_id,
       (select id from public.completed_work_requests
         where description = 'Cerere pe un proiect arhivat intre timp #344') as archived_request_id,
       (select id from public.completed_work_requests
         where description = 'Cerere proprie a leadului pe proiect arhivat #344') as archived_lead_request_id,
       (select id from public.completed_work_requests
         where description = 'Cerere proprie a leadului pe proiectul activ #344') as self_decider_request_id,
       (select id from pg_temp.fixture_projects where name = 'Proiect #344') as project_id,
       (select id from pg_temp.fixture_projects where name = 'Proiect arhivat #344') as archived_project_id;
grant select on f344 to authenticated;
-- anon too: sections 2 and 7c assert the literal grant denial on the three
-- wrappers while `set local role anon` is in force, and the fixture ids they
-- pass are read out of this temp table at that moment. The table is a
-- rolled-back scratch fixture, not part of the schema under test.
grant select on f344 to anon;

select is((select format('%s|%s|%s|%s|%s',
              request.status, request.requester_id, request.group_id,
              coalesce(request.decided_by::text, '-'), coalesce(request.task_id::text, '-'))
             from public.completed_work_requests as request
            where request.id = (select dept_request_id from f344)),
  'pending|34400000-0000-0000-0000-000000000004|' || pg_temp.dept_group('edu') || '|-|-',
  'the new Request is pending against exactly the Department Origin, with no decision trace and no Task');

select set_eq(format($$
  select member_id::text from public.notifications where dedupe_key = 'request:%s'
$$, (select dept_request_id from f344)),
  array['34400000-0000-0000-0000-000000000001',
        '34400000-0000-0000-0000-000000000002',
        '34400000-0000-0000-0000-000000000013'],
  'exactly the Department Request''s deciders are notified: both live local BCE of edu plus the live BC -- not the pr BCE, not the requester, nobody else');

select is((select notification.title from public.notifications as notification
            where notification.dedupe_key = 'request:' || (select dept_request_id from f344)::text
              and notification.member_id = '34400000-0000-0000-0000-000000000002'),
  'Cerere nouă: ' || left((select dept_description from d344), 60),
  'the decider''s notification title is the pinned Romanian copy over the description''s first 60 characters');

select is((select notification.body from public.notifications as notification
            where notification.dedupe_key = 'request:' || (select dept_request_id from f344)::text
              and notification.member_id = '34400000-0000-0000-0000-000000000002'),
  'Membru EDU 344 a trimis o cerere de muncă realizată.',
  'and its body names the requester');

select is((select count(distinct notification.task_id) from public.notifications as notification
            where notification.dedupe_key = 'request:' || (select dept_request_id from f344)::text), 0::bigint,
  'the creation notification carries no task_id -- no Task exists until the Request is approved');

-- ==================== 2. Create: every refusal ====================
select pg_temp.test_login('34400000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["pr"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$ select public.create_completed_work_request('Munca in alt departament', pg_temp.dept_group('edu')) $$,
  '42501', 'request_origin_forbidden',
  'a Member of another Department cannot file a Request against edu');
select throws_ok($$ select public.create_completed_work_request('Munca intr-o echipa straina', pg_temp.team_group('t-344-ind')) $$,
  '42501', 'request_origin_forbidden',
  'a non-member cannot file a Request against an Independent Team');
reset role;

select pg_temp.test_login('34400000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$
  select public.create_completed_work_request('Munca pe un proiect arhivat', pg_temp.project_group(%s))
$$, (select archived_project_id from f344)),
  '42501', 'request_origin_forbidden',
  'membership of an ARCHIVED Project does not admit a Request -- the Project must be active');
reset role;

select pg_temp.test_login('34400000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$ select public.create_completed_work_request('   ', pg_temp.dept_group('edu')) $$,
  'PT400', 'description_required',
  'a blank description is refused');
select throws_ok($$ select public.create_completed_work_request(null, pg_temp.dept_group('edu')) $$,
  'PT400', 'description_required',
  'a null description is refused with the same reason');
select throws_ok($$ select public.create_completed_work_request('Doua origini', -1) $$,
  '42501', 'request_origin_forbidden',
  'an unknown Group is refused without disclosing that it does not exist');
select throws_ok($$ select public.create_completed_work_request('Nicio origine', null) $$,
  'PT400', 'invalid_origin',
  'a Request naming no Group is malformed (#579: the Group is the only Origin)');
reset role;

-- A deactivated Member holding a still-valid level-6 token, and a real uid
-- with no organisation claims: both stop at the gate, before any Origin test.
select pg_temp.test_login('34400000-0000-0000-0000-000000000010', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$ select public.create_completed_work_request('Token vechi', pg_temp.dept_group('edu')) $$,
  '42501', 'request_command_forbidden',
  'a deactivated Member with a still-valid BC token is stopped at the gate');
reset role;

select pg_temp.test_login('34400000-0000-0000-0000-000000000011', '{"provider":"email"}'::jsonb);
select throws_ok($$ select public.create_completed_work_request('Fara claimuri', pg_temp.dept_group('edu')) $$,
  '42501', 'request_command_forbidden',
  'a real uid without organisation claims is stopped at the gate too');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok($$ select public.create_completed_work_request('Anonim', pg_temp.dept_group('edu')) $$,
  '42501', 'permission denied for function create_completed_work_request',
  'anon cannot execute create_completed_work_request at all -- the literal grant denial');
reset role;

select is((select count(*) from public.completed_work_requests
            where description in ('Munca in alt departament', 'Munca intr-o echipa straina',
                                  'Munca pe un proiect arhivat', 'Doua origini', 'Nicio origine',
                                  'Token vechi', 'Fara claimuri', 'Anonim')), 0::bigint,
  'not one refused call left a Request behind');

-- ==================== 3. Create on a Project: the lead decides, the Responsible does not ====================
-- #675: this requester carries a Nickname; section 1's requester (none) was
-- named by full name, this one is named by the Nickname.
reset role;
update public.profiles set nickname = 'Proiect 344'
 where id = '34400000-0000-0000-0000-000000000008';
select pg_temp.test_login('34400000-0000-0000-0000-000000000008', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$
  select public.create_completed_work_request(%L, pg_temp.project_group(%s))
$$, (select project_description from d344), (select project_id from f344)),
  'a plain Project member files a Request against their active Project');
reset role;

create temp table p344 as
select (select id from public.completed_work_requests
         where description = (select project_description from d344)) as project_request_id,
       (select id from public.completed_work_requests
         where description = (select ind_description from d344)) as ind_request_id,
       (select id from public.completed_work_requests
         where description = (select dt_description from d344)) as dt_request_id;

select set_eq(format($$
  select member_id::text from public.notifications where dedupe_key = 'request:%s'
$$, (select project_request_id from p344)),
  array['34400000-0000-0000-0000-000000000001',
        '34400000-0000-0000-0000-000000000006',
        '34400000-0000-0000-0000-000000000007'],
  'a Project Request by an ordinary member notifies its Manager, Responsible and BC');
select is((select notification.body from public.notifications as notification
            where notification.dedupe_key = 'request:' || (select project_request_id from p344)::text
              and notification.member_id = '34400000-0000-0000-0000-000000000001'),
  'Proiect 344 a trimis o cerere de muncă realizată.',
  'with a Nickname set, the "Cerere nouă" body names the requester by it, read at write time (#675)');

-- ==================== 4. Create on an Independent Team: nobody local decides ====================
select pg_temp.test_login('34400000-0000-0000-0000-000000000009', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '["t-344-ind"]'::jsonb));
select lives_ok(format($$
  select public.create_completed_work_request(%L, pg_temp.team_group('t-344-ind'))
$$, (select ind_description from d344)),
  'an Independent-Team member files a Request against their own Team');
reset role;

update p344 set ind_request_id = (select id from public.completed_work_requests
                                  where description = (select ind_description from d344));

select set_eq(format($$
  select member_id::text from public.notifications where dedupe_key = 'request:%s'
$$, (select ind_request_id from p344)),
  array['34400000-0000-0000-0000-000000000001'],
  'an Independent-Team Request notifies the BC alone -- the Team jointly manages its own work but has no local decider at all');

-- ==================== 5. Create on a Department Team: the parent Department's BCE decide ====================
select pg_temp.test_login('34400000-0000-0000-0000-000000000012', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '["t-344-dt"]'::jsonb));
select lives_ok(format($$
  select public.create_completed_work_request(%L, pg_temp.team_group('t-344-dt'))
$$, (select dt_description from d344)),
  'a Department-Team member files a Request against their Team');
reset role;

update p344 set dt_request_id = (select id from public.completed_work_requests
                                 where description = (select dt_description from d344));

select set_eq(format($$
  select member_id::text from public.notifications where dedupe_key = 'request:%s'
$$, (select dt_request_id from p344)),
  array['34400000-0000-0000-0000-000000000001',
        '34400000-0000-0000-0000-000000000002',
        '34400000-0000-0000-0000-000000000013'],
  'a Department-Team Request notifies the parent Department''s live local BCE plus the BC -- the same set as a Department Request on edu');

grant select on p344 to authenticated;

-- ==================== 6. Approve: the whole chain in one transaction ====================
select pg_temp.test_login('34400000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$
  select public.approve_completed_work_request(%s, 3, 4, 'Confirmat, munca a fost facuta.')
$$, (select dept_request_id from f344)),
  'the live local BCE approves the Department Request');
reset role;

create temp table t344 as
select request.task_id as task_id, request.id as request_id
  from public.completed_work_requests as request
 where request.id = (select dept_request_id from f344);
grant select on t344 to authenticated;

select is((select format('%s|%s|%s|%s',
              request.status, request.decided_by,
              (request.decided_at is not null)::text, request.decision_note)
             from public.completed_work_requests as request
            where request.id = (select dept_request_id from f344)),
  'approved|34400000-0000-0000-0000-000000000002|true|Confirmat, munca a fost facuta.',
  'the Request is approved, names its decider and moment, and keeps the decision note');
select isnt((select task_id from t344), null,
  'and it names the Task the approval created');

select is((select format('%s|%s|%s|%s|%s|%s|%s|%s|%s',
              task.kind, task.audience, task.assignment_mode, task.status,
              (select id from pg_temp.fixture_departments where group_id = task.group_id), task.created_by, task.difficulty, task.rating,
              (task.completed_at is not null)::text)
             from public.tasks as task where task.id = (select task_id from t344)),
  'task|local|direct|completed|edu|34400000-0000-0000-0000-000000000002|3|4|true',
  'the created Task is a local, direct, completed ordinary Task on the Request''s Origin, created by the approver');
select is((select task.title from public.tasks as task where task.id = (select task_id from t344)),
  left((select dept_description from d344), 120),
  'its title is the description''s first 120 characters');
select is((select length(task.title) from public.tasks as task where task.id = (select task_id from t344)),
  120, 'which really is a truncation, not the whole description');
select is((select task.description from public.tasks as task where task.id = (select task_id from t344)),
  (select dept_description from d344),
  'while the full description is preserved on the Task body');
select is((select task.deadline from public.tasks as task where task.id = (select task_id from t344)),
  (select task.created_at from public.tasks as task where task.id = (select task_id from t344)),
  'the deadline is the approval instant itself -- already-completed work is never late');
select is((select format('%s|%s', coalesce(task.queue_opened_at::text, '-'), coalesce(task.queue_closed_at::text, '-'))
             from public.tasks as task where task.id = (select task_id from t344)),
  '-|-', 'a direct Task opens no Candidate Queue');
select is((select count(*) from public.task_candidates where task_id = (select task_id from t344)), 0::bigint,
  'and carries no Candidature at all -- the Task is created fresh inside this transaction, so "active Executor and pending Candidate at once" is unreachable here by construction, not by a guard');

select is((select format('%s|%s|%s', assignment.member_id, assignment.end_reason,
                         (assignment.ended_at = task.completed_at)::text)
             from public.task_assignments as assignment
             join public.tasks as task on task.id = assignment.task_id
            where assignment.task_id = (select task_id from t344)),
  '34400000-0000-0000-0000-000000000004|completed|true',
  'exactly one Assignment exists, it belongs to the REQUESTER, and it ended completed at the same instant the Task did');

select is((select format('%s|%s|%s|%s|%s|%s', evaluation.source, evaluation.evaluated_by,
                         evaluation.outcome, evaluation.difficulty, evaluation.rating, evaluation.points)
             from public.task_evaluations as evaluation
            where evaluation.task_id = (select task_id from t344)),
  'command|34400000-0000-0000-0000-000000000002|completed|3|4|6',
  'exactly one command Evaluation records Difficulty 3 x rating_mult(4) = 6 points for the approver');

select is((select format('%s|%s|%s', ledger.member_id, ledger.reason, ledger.delta)
             from public.points_ledger as ledger
            where ledger.task_id = (select task_id from t344)),
  '34400000-0000-0000-0000-000000000004|task|6',
  'exactly one task ledger row credits the requester with those 6 points');

select is((select coalesce(sum(ledger.delta), 0) from public.points_ledger as ledger
            where ledger.member_id = '34400000-0000-0000-0000-000000000004'), 6::bigint,
  'and the requester''s running total moves by exactly d x mult');

select is((select format('%s|%s|%s|%s',
              activity.kind, coalesce(activity.assignment_id::text, '-'),
              coalesce(activity.to_status::text, '-'), activity.details->>'from_request_id')
             from public.task_activity as activity
            where activity.task_id = (select task_id from t344) and activity.kind = 'created'),
  format('created|-|todo|%s', (select dept_request_id from f344)),
  'the created activity row carries no assignment_id, records the todo entry state, and names the Request it came from');

select is((select activity.details->>'via' from public.task_activity as activity
            where activity.task_id = (select task_id from t344) and activity.kind = 'executor_assigned'),
  'request_approval',
  'the executor_assigned row records that this Assignment came from a Request approval');

select set_eq(format($$
  select kind from public.task_activity where task_id = %s
$$, (select task_id from t344)),
  array['created', 'executor_assigned', 'evaluated'],
  'the Task''s whole history is exactly created -> executor_assigned -> evaluated');

select set_eq(format($$
  select title from public.notifications where task_id = %s
$$, (select task_id from t344)),
  array['Task nou: ' || left((select dept_description from d344), 120),
        'Task evaluat: ' || left((select dept_description from d344), 120),
        'Cerere aprobată: ' || left((select dept_description from d344), 60)],
  'the requester receives three notifications -- the Assignment, the Evaluation and the Request decision (private.open_task_assignment only suppresses the "Task nou" row for a reopen)');

select set_eq(format($$
  select distinct member_id::text from public.notifications where task_id = %s
$$, (select task_id from t344)),
  array['34400000-0000-0000-0000-000000000004'],
  'and every one of them goes to the requester alone -- private.notify drops the approver, who is the actor');

select is((select notification.body from public.notifications as notification
            where notification.task_id = (select task_id from t344)
              and notification.title like 'Cerere aprobată:%'),
  '6 puncte (dificultate 3, calificativ 4).',
  'the approval notification states the award in Romanian plural agreement');

-- Singular agreement: Difficulty 1 x rating_mult(3) = 1 point.
select pg_temp.test_login('34400000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$
  select public.approve_completed_work_request(%s, 1, 3, 'Mic, dar real.')
$$, (select singular_request_id from f344)),
  'a Difficulty 1 / Rating 3 approval succeeds');
reset role;

select is((select notification.body from public.notifications as notification
             join public.completed_work_requests as request on request.task_id = notification.task_id
            where request.id = (select singular_request_id from f344)
              and notification.title like 'Cerere aprobată:%'),
  '1 punct (dificultate 1, calificativ 3).',
  'a one-point award takes the Romanian singular: 1 punct, not 1 puncte');

-- ==================== 7. Approve: visibility, authority, state and input ====================
-- Ids are resolved above as the owner; nothing below re-reads one through a
-- denied persona's RLS (the #328 trap).

-- 7a. Cannot even read the Request -> PT404, indistinguishable from missing.
select pg_temp.test_login('34400000-0000-0000-0000-000000000005', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["pr"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.approve_completed_work_request(%s, 3, 3, 'Nu am voie') $$,
  (select deny_request_id from f344)),
  'PT404', 'request_not_found',
  'a Member who cannot read the Request is told it does not exist -- hidden and missing look identical');
reset role;

select pg_temp.test_login('34400000-0000-0000-0000-000000000003', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["pr"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.approve_completed_work_request(%s, 3, 3, 'BCE strain') $$,
  (select deny_request_id from f344)),
  'PT404', 'request_not_found',
  'a BCE of another Department gets the same PT404 -- they cannot read this Request either');
select throws_ok(format($$ select public.approve_completed_work_request(%s, 3, 3, 'BCE strain pe echipa') $$,
  (select dt_request_id from p344)),
  'PT404', 'request_not_found',
  'and the same on a Department-Team Request whose parent Department is not theirs');
reset role;

-- 7b. Can read, may not decide -> 42501.
select pg_temp.test_login('34400000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.approve_completed_work_request(%s, 5, 5, 'Ma aprob singur') $$,
  (select deny_request_id from f344)),
  '42501', 'request_decide_forbidden',
  'the requester sees their own Request -- and is told plainly they may not decide it, never that it is missing');
reset role;

select pg_temp.test_login('34400000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
savepoint responsible_twin;
select lives_ok(format($$ select public.approve_completed_work_request(%s, 3, 4, 'Responsabil') $$,
  (select project_request_id from p344)),
  'a Group Responsible may approve an ordinary member Request');
rollback to responsible_twin;
reset role;

select pg_temp.test_login('34400000-0000-0000-0000-000000000016', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '["t-344-ind"]'::jsonb));
select throws_ok(format($$ select public.approve_completed_work_request(%s, 3, 4, 'Coleg de echipa') $$,
  (select ind_request_id from p344)),
  '42501', 'request_decide_forbidden',
  'an Independent-Team member jointly manages the Team''s work yet cannot approve its Requests');
reset role;

select pg_temp.test_login('34400000-0000-0000-0000-000000000009', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '[]'::jsonb, 'team_ids', '["t-344-ind"]'::jsonb));
select throws_ok(format($$ select public.approve_completed_work_request(%s, 3, 4, 'Propria cerere') $$,
  (select ind_request_id from p344)),
  '42501', 'request_decide_forbidden',
  'and neither can the Independent-Team member who filed it');
reset role;

-- 7b-bis. A Project archived AFTER the Request was filed. Three shapes, and
-- the middle one is the whole point: the visibility test is a DISJUNCTION
-- (requester_id = auth.uid() OR private.can_manage_group_work(...)), so a lead who
-- is merely the Origin's manager is stopped at PT404 by
-- private.can_manage_project_work's active-only branch -- but a lead who is
-- the Request's OWN REQUESTER short-circuits on the first disjunct, never
-- touches can_manage_project_work, and reaches the decider predicate. That is
-- the only caller who does, and it is why require_request_decider's Project
-- branch carries its own projects.status = 'active' test rather than leaning
-- on the gate ahead of it. Without that filter this middle assertion goes red:
-- the self-approval succeeds and mints a completed Task, an Evaluation and a
-- points_ledger credit on an ARCHIVED Project -- exactly what
-- private.can_evaluate_task refuses on the Task path.
select pg_temp.test_login('34400000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.approve_completed_work_request(%s, 3, 4, 'Lead pe proiect arhivat') $$,
  (select archived_request_id from f344)),
  'PT404', 'request_not_found',
  'once the Project is archived its lead can no longer even see a colleague''s pending Requests on it -- private.can_manage_project_work is active-only, and the command never discloses more than the read policy does');
select throws_ok(format($$ select public.approve_completed_work_request(%s, 5, 5, 'Ma aprob singur pe proiectul arhivat') $$,
  (select archived_lead_request_id from f344)),
  '42501', 'request_decide_forbidden',
  'and the lead of an archived Project cannot approve even their OWN Request on it -- they see it as its requester, so the visibility disjunction short-circuits and the decider predicate is what must refuse them, the same way private.can_evaluate_task refuses this lead on this Project');
reset role;

select pg_temp.test_login('34400000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.approve_completed_work_request(%s, 2, 3, 'BC inchide o cerere ramasa de pe un proiect arhivat.') $$,
  (select archived_request_id from f344)),
  'the BC can still decide it, so a Request is never stranded by an archive');
reset role;

-- 7c. Gate and grant.
select pg_temp.test_login('34400000-0000-0000-0000-000000000010', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.approve_completed_work_request(%s, 3, 4, 'Token vechi') $$,
  (select deny_request_id from f344)),
  '42501', 'request_command_forbidden',
  'a deactivated BC with a still-valid level-6 token cannot approve');
reset role;

select pg_temp.test_login('34400000-0000-0000-0000-000000000011', '{"provider":"email"}'::jsonb);
select throws_ok(format($$ select public.approve_completed_work_request(%s, 3, 4, 'Fara claimuri') $$,
  (select deny_request_id from f344)),
  '42501', 'request_command_forbidden',
  'nor can a real uid without organisation claims');
reset role;

select pg_temp.test_clear_jwt();
set local role anon;
select throws_ok(format($$ select public.approve_completed_work_request(%s, 3, 4, 'Anonim') $$,
  (select deny_request_id from f344)),
  '42501', 'permission denied for function approve_completed_work_request',
  'anon cannot execute approve_completed_work_request at all');
select throws_ok(format($$ select public.reject_completed_work_request(%s, 'Anonim') $$,
  (select deny_request_id from f344)),
  '42501', 'permission denied for function reject_completed_work_request',
  'nor reject_completed_work_request');
reset role;

-- 7d. Malformed-for-everyone input, refused ahead of the gate.
select pg_temp.test_login('34400000-0000-0000-0000-000000000011', '{"provider":"email"}'::jsonb);
select throws_ok(format($$ select public.approve_completed_work_request(%s, 0, 4, 'Nota') $$,
  (select deny_request_id from f344)),
  'PT400', 'invalid_difficulty',
  'a Difficulty outside 1..5 is refused before the gate -- the call could never succeed for anyone');
select throws_ok(format($$ select public.approve_completed_work_request(%s, 3, 6, 'Nota') $$,
  (select deny_request_id from f344)),
  'PT400', 'invalid_rating',
  'and so is a Rating outside 1..5');
select throws_ok(format($$ select public.approve_completed_work_request(%s, null, 4, 'Nota') $$,
  (select deny_request_id from f344)),
  'PT400', 'invalid_difficulty',
  'a null Difficulty takes the same reason');
select throws_ok(format($$ select public.approve_completed_work_request(%s, 3, 4, '   ') $$,
  (select deny_request_id from f344)),
  'PT400', 'evaluation_note_required',
  'an approval without a note can never be written (task_evaluations_note_ck), so it is refused before the gate too -- under evaluation_note_required, the same string complete_task_review (#336) and mark_task_unfulfilled (#337) hoist for this condition, because this note becomes an Evaluation''s note');
select throws_ok(format($$ select public.reject_completed_work_request(%s, '  ') $$,
  (select deny_request_id from f344)),
  'PT400', 'note_required',
  'a rejection without a reason is refused before the gate as well, but under note_required, not evaluation_note_required: rejection writes no Evaluation and its note is only a decision_note -- the reason names what the note IS, not which command took it');
reset role;

-- 7e. Missing and null targets.
select pg_temp.test_login('34400000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$ select public.approve_completed_work_request(987654321, 3, 4, 'Inexistent') $$,
  'PT404', 'request_not_found',
  'an unknown Request id is PT404, even for the BC');
select throws_ok($$ select public.approve_completed_work_request(null, 3, 4, 'Nul') $$,
  'PT404', 'request_not_found',
  'and so is a null id -- the same non-disclosing answer, no separate PT400 for it (the wave''s standing ruling)');

-- 7f. A requester who is no longer an active Member cannot be given an Assignment.
select throws_ok(format($$ select public.approve_completed_work_request(%s, 3, 4, 'Cerere veche') $$,
  (select dead_requester_request_id from f344)),
  'PT400', 'invalid_executor',
  'a Request whose requester has since been deactivated cannot be approved -- private.open_task_assignment refuses to make an inactive Member the Executor');
reset role;

select is((select count(*) from public.completed_work_requests
            where id = (select deny_request_id from f344) and status = 'pending'), 1::bigint,
  'the shared denial target is still pending after every refusal above');
select is((select count(*) from public.tasks
            where description in ('Cerere de la un membru dezactivat #344',
                                  'Cerere tinta pentru refuzuri #344')), 0::bigint,
  'and no refused approval left a Task behind -- including the one that got as far as inserting a Task before private.open_task_assignment refused an inactive Executor');

-- ==================== 8. Every notified decider really can approve ====================
-- This is the other half of the single-source check: section 1/3/4/5 pinned
-- the notified SET; these calls prove that set is exactly the set that can act.
select pg_temp.test_login('34400000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.approve_completed_work_request(%s, 2, 3, 'BC aproba.') $$,
  (select bc_request_id from f344)),
  'the BC approves a Department Request -- the global decider, named rather than a fallback');
select lives_ok(format($$ select public.approve_completed_work_request(%s, 2, 3, 'BC aproba echipa independenta.') $$,
  (select ind_request_id from p344)),
  'and the BC is the ONLY decider an Independent-Team Request has');
select lives_ok(format($$ select public.approve_completed_work_request(%s, 2, 3, 'BC aproba proiectul.') $$,
  (select project2_request_id from f344)),
  'the BC decides Project Requests too');
reset role;

select pg_temp.test_login('34400000-0000-0000-0000-000000000013', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.approve_completed_work_request(%s, 4, 5, 'Al doilea BCE aproba.') $$,
  (select bce2_request_id from f344)),
  'the second live local BCE of edu approves too -- every notified local BCE really is a decider');
reset role;

select pg_temp.test_login('34400000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.approve_completed_work_request(%s, 3, 4, 'Leadul aproba.') $$,
  (select project_request_id from p344)),
  'the Project lead approves their own Project''s Request, with an ordinary member_level of 1 -- Project authority is not role level');
reset role;

select pg_temp.test_login('34400000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.approve_completed_work_request(%s, 2, 4, 'BCE aproba echipa departamentala.') $$,
  (select dt_request_id from p344)),
  'and the parent Department''s BCE approves a Department-Team Request');
reset role;

select is((select count(*) from public.completed_work_requests
            where status = 'approved' and task_id is not null
              and id in ((select bc_request_id from f344), (select bce2_request_id from f344),
                         (select project2_request_id from f344), (select project_request_id from p344),
                         (select ind_request_id from p344), (select dt_request_id from p344))), 6::bigint,
  'each of those six approvals created and named its own Task');
-- Scoped to this suite's own requesters: #296 gave the demo seed an approved
-- completed-work request of its own, so "every approved Request in the
-- database" is no longer "every approved Request this suite made".
select is((select count(*) from public.task_evaluations as evaluation
            where evaluation.task_id in (select task_id from public.completed_work_requests
                                          where task_id is not null
                                            and requester_id::text like '34400000-%')), 9::bigint,
  'and each approved Request carries exactly one Evaluation -- nine approvals so far in this suite, nine Evaluations');

-- ==================== 8b. No requester decides their own Request (#522) ====================
select pg_temp.test_login('34400000-0000-0000-0000-000000000006', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.approve_completed_work_request(%s, 2, 4, 'Self') $$,
  (select self_decider_request_id from f344)), '42501', 'request_decide_forbidden',
  'even a Group Manager cannot approve their own Request');
reset role;
select is((select count(*) from public.notifications where task_id =
  (select task_id from public.completed_work_requests where id=(select self_decider_request_id from f344))),
  0::bigint, 'failed self-approval sends no Task notification');
select is((select status from public.completed_work_requests where id=(select self_decider_request_id from f344)),
  'pending', 'failed self-approval leaves the Request pending');
select is((select task_id from public.completed_work_requests where id=(select self_decider_request_id from f344)),
  null::bigint, 'failed self-approval creates no Task');

-- ==================== 9. Reject ====================
select pg_temp.test_login('34400000-0000-0000-0000-000000000014', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.reject_completed_work_request(%s, 'Ma resping singur') $$,
  (select reject_request_id from f344)),
  '42501', 'request_decide_forbidden',
  'the requester can see their own Request but may not reject it either');
reset role;

select pg_temp.test_login('34400000-0000-0000-0000-000000000004', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.reject_completed_work_request(%s, 'Nu sunt de acord') $$,
  (select reject_request_id from f344)),
  'PT404', 'request_not_found',
  'and an ordinary Department colleague -- who is neither the requester nor a manager of the Origin, so cannot read the row -- is told it does not exist');
reset role;

select pg_temp.test_login('34400000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select lives_ok(format($$ select public.reject_completed_work_request(%s, 'Munca aceasta e deja punctata pe alt task.') $$,
  (select reject_request_id from f344)),
  'the local BCE rejects a Request with a reason');
reset role;

select is((select format('%s|%s|%s|%s',
              request.status, request.decided_by, request.decision_note,
              coalesce(request.task_id::text, '-'))
             from public.completed_work_requests as request
            where request.id = (select reject_request_id from f344)),
  'rejected|34400000-0000-0000-0000-000000000002|Munca aceasta e deja punctata pe alt task.|-',
  'the rejected Request records its decider and reason and names no Task -- only approval creates one');

select is((select format('%s|%s|%s', notification.member_id, notification.title, notification.body)
             from public.notifications as notification
            where notification.title like 'Cerere respinsă:%'),
  format('34400000-0000-0000-0000-000000000014|Cerere respinsă: %s|Munca aceasta e deja punctata pe alt task.',
         left('Cerere care va fi respinsa #344', 60)),
  'the requester alone is told, with the decider''s reason as the body');

select is((select count(*) from public.tasks where created_by = '34400000-0000-0000-0000-000000000002'
             and description = 'Cerere care va fi respinsa #344'), 0::bigint,
  'and a rejection creates no Task at all');

-- ==================== 10. A decision happens exactly once ====================
select pg_temp.test_login('34400000-0000-0000-0000-000000000002', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok(format($$ select public.approve_completed_work_request(%s, 3, 4, 'M-am razgandit') $$,
  (select reject_request_id from f344)),
  'PT409', 'request_not_pending',
  'a rejected Request cannot then be approved');
select throws_ok(format($$ select public.reject_completed_work_request(%s, 'M-am razgandit') $$,
  (select dept_request_id from f344)),
  'PT409', 'request_not_pending',
  'and an approved Request cannot then be rejected');
select throws_ok(format($$ select public.approve_completed_work_request(%s, 5, 5, 'Inca o data') $$,
  (select dept_request_id from f344)),
  'PT409', 'request_not_pending',
  'nor approved a second time');
reset role;

select is((select count(*) from public.task_evaluations as evaluation
            where evaluation.task_id = (select task_id from t344)), 1::bigint,
  'the already-approved Request still has exactly one Evaluation after those attempts');
select is((select format('%s|%s', count(*), coalesce(sum(ledger.delta), 0))
             from public.points_ledger as ledger
            where ledger.task_id = (select task_id from t344)),
  '1|6',
  'and the requester was paid for it exactly once');

-- ==================== 11. Reading stays broader than deciding ====================
select pg_temp.test_login('34400000-0000-0000-0000-000000000014', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select count(*) from public.completed_work_requests
            where requester_id = '34400000-0000-0000-0000-000000000014'), 1::bigint,
  'a requester still reads their own Request after it is decided -- completed_work_requests_read is unchanged by this migration');
reset role;

select pg_temp.test_login('34400000-0000-0000-0000-000000000007', jsonb_build_object(
  'member_role', 'voluntar', 'member_level', 1, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
select is((select count(*) from public.completed_work_requests
            where id = (select project_request_id from p344)), 1::bigint,
  'and the Project Responsible who may not decide still READS the Project''s Requests');
reset role;

-- ==================== 12. The commands are the only write path ====================
select pg_temp.test_login('34400000-0000-0000-0000-000000000001', jsonb_build_object(
  'member_role', 'bc', 'member_level', 6, 'dept_ids', '[]'::jsonb, 'team_ids', '[]'::jsonb));
select throws_ok($$
  insert into public.completed_work_requests (requester_id, group_id, description)
  values ('34400000-0000-0000-0000-000000000004', pg_temp.dept_group('edu'), 'Scriere directa #344')
$$, '42501', 'permission denied for table completed_work_requests',
  'even the BC cannot insert a Request directly -- create_completed_work_request is the only path');
select throws_ok(format($$
  update public.completed_work_requests set status = 'approved' where id = %s
$$, (select deny_request_id from f344)),
  '42501', 'permission denied for table completed_work_requests',
  'nor decide one with a direct UPDATE');
select throws_ok(format($$
  delete from public.completed_work_requests where id = %s
$$, (select deny_request_id from f344)),
  '42501', 'permission denied for table completed_work_requests',
  'nor delete one');
reset role;

select is((select count(*) from public.completed_work_requests
            where description = 'Scriere directa #344'), 0::bigint,
  'and none of those direct writes landed');

-- ==================== 13. Locks held while approve runs ====================
-- Sections 13-14 work on COMMITTED fixtures through their own dblink
-- connection: the race commits both of its sessions for real, so nothing this
-- suite's own rolled-back transaction created is visible to them.
--
-- Honest limitation, established by mutation rather than assumed (see the task
-- report): only the profiles and member_departments FOR SHARE assertions below
-- discriminate. The Request row is UPDATEd by the command a moment later inside
-- the same held transaction, so the exclusive lock the probe sees is the one
-- the UPDATE itself takes -- deleting the `for update` keyword leaves that
-- assertion green. Section 14's race is what actually proves the Request-row
-- lock.
select extensions.dblink_connect('cwr_setup', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
-- #621: committed fixtures from an interrupted run must not hang cleanup.
select extensions.dblink_exec('cwr_setup', 'set lock_timeout = ''2s''');

select extensions.dblink_exec('cwr_setup', $$
  set session_replication_role = 'replica';
  delete from public.points_ledger
   where task_id in (select id from public.tasks where created_by = '34400000-0000-0000-0000-000000000051');
  delete from public.task_evaluations
   where task_id in (select id from public.tasks where created_by = '34400000-0000-0000-0000-000000000051');
  delete from public.task_activity
   where task_id in (select id from public.tasks where created_by = '34400000-0000-0000-0000-000000000051');
  set session_replication_role = 'origin';
  delete from public.notifications
   where member_id in ('34400000-0000-0000-0000-000000000051',
                       '34400000-0000-0000-0000-000000000052',
                       '34400000-0000-0000-0000-000000000053');
  delete from public.completed_work_requests
   where requester_id in ('34400000-0000-0000-0000-000000000052',
                          '34400000-0000-0000-0000-000000000053');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where created_by = '34400000-0000-0000-0000-000000000051');
  delete from public.tasks where created_by = '34400000-0000-0000-0000-000000000051';
  delete from auth.users where id in (
    '34400000-0000-0000-0000-000000000051', '34400000-0000-0000-0000-000000000052',
    '34400000-0000-0000-0000-000000000053');

  insert into auth.users (id, email) values
    ('34400000-0000-0000-0000-000000000051', 'cwr.decider.344@test.local'),
    ('34400000-0000-0000-0000-000000000052', 'cwr.race.requester.344@test.local'),
    ('34400000-0000-0000-0000-000000000053', 'cwr.probe.requester.344@test.local');
  insert into public.profiles (id, full_name, email, role, status) values
    ('34400000-0000-0000-0000-000000000051', 'Decident Comis 344', 'cwr.decider.344@test.local', 'bce', 'activ'),
    ('34400000-0000-0000-0000-000000000052', 'Solicitant Cursa 344', 'cwr.race.requester.344@test.local', 'voluntar', 'activ'),
    ('34400000-0000-0000-0000-000000000053', 'Solicitant Sonda 344', 'cwr.probe.requester.344@test.local', 'voluntar', 'activ');
  -- #586: committed race fixtures require native Group roster rows.
  insert into public.group_members(group_id,member_id,group_role)
  select g.id,md.member_id,case when p.role='bce' then 'manager' else 'member' end
    from (values ('34400000-0000-0000-0000-000000000051'::uuid, 'edu'),
    ('34400000-0000-0000-0000-000000000052'::uuid, 'edu'),
    ('34400000-0000-0000-0000-000000000053'::uuid, 'edu')) md(member_id,dept_id) join public.groups g on g.name = case md.dept_id when 'edu' then 'Educațional' when 'pr' then 'Imagine & PR' when 'hr' then 'Resurse Umane' when 'fin' then 'Financiar' when 'youth' then 'Tineret' when 'diverse' then 'Diverse' when 'secretariat' then 'Secretariat' when 'org' then 'OSUBB' end
    join public.profiles p on p.id=md.member_id
   where md.member_id::text like '34400000-%'
  on conflict (group_id,member_id) do nothing;

  insert into public.completed_work_requests (requester_id, group_id, description) values
    ('34400000-0000-0000-0000-000000000052', (select id from public.groups where name = 'Educațional'), 'Cerere pentru cursa de aprobare #344 committed'),
    ('34400000-0000-0000-0000-000000000053', (select id from public.groups where name = 'Educațional'), 'Cerere pentru sonda de blocaj #344 committed');
$$);

create temp table r344 as
select (select id from public.completed_work_requests
         where description = 'Cerere pentru cursa de aprobare #344 committed') as race_request_id,
       (select id from public.completed_work_requests
         where description = 'Cerere pentru sonda de blocaj #344 committed') as probe_request_id;
grant select on r344 to authenticated;

select extensions.dblink_connect('cwr_lock', format(
  'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres',
  current_database()));
select extensions.dblink_exec('cwr_lock', $$
  begin;
  set local statement_timeout = '5s';
  set local lock_timeout = '2s';
$$);
select * from extensions.dblink('cwr_lock', $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '34400000-0000-0000-0000-000000000051', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('member_role', 'bce', 'member_level', 5,
      'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb))::text, true)
$$) as remote_claims(setting text);
select extensions.dblink_exec('cwr_lock', 'set local role authenticated');
-- Single-field projection on purpose: PostgreSQL expands `(f(x)).a, (f(x)).b`
-- into TWO calls, which here would run the command twice and make the second
-- one raise (the #336 warning).
select * from extensions.dblink('cwr_lock', format($$
  select (public.approve_completed_work_request(%s, 3, 4, 'Sonda de blocaj')).status
$$, (select probe_request_id from r344))) as locked_approval(status text);

select ok(coalesce((
  select row_lock.modes && array['For Update', 'Update', 'No Key Update']
    from extensions.pgrowlocks('public.completed_work_requests') as row_lock
    join public.completed_work_requests as request on request.ctid = row_lock.locked_row
   where request.id = (select probe_request_id from r344)
), false), 'approve_completed_work_request holds the Request row exclusively locked while it runs -- the serialization point the double-approval race turns on');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.profiles') as row_lock
    join public.profiles as profile on profile.ctid = row_lock.locked_row
   where profile.id = '34400000-0000-0000-0000-000000000051'
), false), 'it holds the decider''s own live profile row FOR SHARE, so a concurrent deactivation serializes behind the decision (private.require_group_work_manager''s discipline)');
select ok(coalesce((
  select 'For Share' = any(row_lock.modes)
    from extensions.pgrowlocks('public.group_members') as row_lock
    join public.group_members as membership on membership.ctid = row_lock.locked_row
   where membership.member_id = '34400000-0000-0000-0000-000000000051'
     and membership.group_id = (select id from public.groups where name = 'Educațional')
), false), 'and the Group membership the BCE''s decider authority rests on FOR SHARE too');

select extensions.dblink_exec('cwr_lock', 'rollback');
select extensions.dblink_disconnect('cwr_lock');

-- ==================== 14. Race: two approvals of one Request ====================
-- pg_temp.test_race cannot report b_waited when session B raises, because B's
-- error propagates out of extensions.dblink_get_result and the whole call has
-- to be wrapped in throws_ok (#333/#336 precedent). This suite needs BOTH
-- readings, so it uses a local copy of that harness whose only difference is
-- that the B-result fetch is wrapped in a plpgsql exception block -- the error
-- is caught in THIS session, where catching it is legal, and returned as text.
-- Identical semantics otherwise: A runs to completion, B is sent while A is
-- still uncommitted, the loop watches pg_stat_activity until B either blocks or
-- finishes, then A commits and B's result is read.
create function pg_temp.race_capture(p_sql_a text, p_sql_b text)
returns table(result_a text, result_b text, b_waited boolean)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_connection_a text := format('cwr_race_a_%s', pg_backend_pid());
  v_connection_b text := format('cwr_race_b_%s', pg_backend_pid());
  v_database text := current_database();
  v_jwt text := current_setting('request.jwt.claims', true);
  v_busy integer;
  v_saw_state boolean := false;
  v_drain text;
begin
  if coalesce(v_jwt, '') = '' then
    raise exception 'race_capture requires test_login first';
  end if;

  perform extensions.dblink_connect(v_connection_a, format(
    'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres application_name=%s',
    v_database, v_connection_a));
  perform extensions.dblink_connect(v_connection_b, format(
    'host=db.supabase.internal port=5432 dbname=%L user=postgres password=postgres application_name=%s',
    v_database, v_connection_b));

  perform extensions.dblink_exec(v_connection_a, $$
    begin;
    set local statement_timeout = '5s';
    set local lock_timeout = '10s';
  $$);
  perform extensions.dblink_exec(v_connection_b, $$
    begin;
    set local statement_timeout = '10s';
    set local lock_timeout = '10s';
  $$);

  perform setting from extensions.dblink(
    v_connection_a, format('select set_config(''request.jwt.claims'', %L, true)', v_jwt)
  ) as remote_claims(setting text);
  perform setting from extensions.dblink(
    v_connection_b, format('select set_config(''request.jwt.claims'', %L, true)', v_jwt)
  ) as remote_claims(setting text);
  perform extensions.dblink_exec(v_connection_a, 'set local role authenticated');
  perform extensions.dblink_exec(v_connection_b, 'set local role authenticated');

  select remote_result into strict result_a
    from extensions.dblink(v_connection_a, p_sql_a) as remote(remote_result text);

  if extensions.dblink_send_query(v_connection_b, p_sql_b) <> 1 then
    raise exception 'race_capture could not start query B';
  end if;

  for attempt in 1..100 loop
    perform pg_catalog.pg_stat_clear_snapshot();
    v_busy := extensions.dblink_is_busy(v_connection_b);
    if exists (
      select 1 from pg_catalog.pg_stat_activity
       where application_name = v_connection_b and wait_event_type = 'Lock'
    ) then
      b_waited := true; v_saw_state := true; exit;
    elsif v_busy = 0 then
      b_waited := false; v_saw_state := true; exit;
    end if;
    perform pg_catalog.pg_sleep(0.01);
  end loop;

  if not v_saw_state then
    raise exception 'race_capture query B neither blocked nor completed within 1 second';
  end if;

  perform extensions.dblink_exec(v_connection_a, 'commit');

  -- The one difference from pg_temp.test_race: B's remote error is caught HERE
  -- and reported as text, so a losing B is observable alongside b_waited.
  -- Only the read is caught -- B losing the race is an outcome, everything
  -- after it is harness plumbing and must not be mistaken for one.
  begin
    select remote_result into strict result_b
      from extensions.dblink_get_result(v_connection_b) as remote(remote_result text);
  exception when others then
    result_b := sqlstate || ' ' || sqlerrm;
  end;

  -- #618: same libpq contract as pg_temp.test_race -- the connection stays
  -- busy until PQgetResult has answered NULL -- drained inline because this
  -- copy is security definer with an empty search_path. Draining is cleanup,
  -- so it is swallowed; the commit that follows is NOT. A commit that cannot
  -- run means every write this session made is about to be thrown away by the
  -- disconnect below, and a race harness that reports a winner it never
  -- committed is measuring nothing -- so it is left to reach the handler at
  -- the bottom, which rolls back, disconnects and re-raises.
  begin
    loop
      select remote_result into v_drain
        from extensions.dblink_get_result(v_connection_b) as remote(remote_result text);
      exit when not found;
    end loop;
  exception when others then null;
  end;

  perform extensions.dblink_exec(v_connection_b, 'commit');

  begin
    perform extensions.dblink_disconnect(v_connection_a);
  exception when others then null;
  end;
  begin
    perform extensions.dblink_disconnect(v_connection_b);
  exception when others then null;
  end;
  return next;
-- pg_temp.test_race's own outer handler, kept verbatim. Without it a failure
-- anywhere above -- A raising, B neither blocking nor finishing, a lost
-- connection -- leaves cwr_race_a_<pid> / cwr_race_b_<pid> connected with an
-- open remote transaction for the rest of the file, turning one red test into
-- a blocked suite. It weakens no assertion: it rolls back, disconnects and
-- re-raises.
exception
  when others then
    begin
      perform extensions.dblink_exec(v_connection_a, 'rollback');
    exception when others then null;
    end;
    begin
      perform extensions.dblink_exec(v_connection_b, 'rollback');
    exception when others then null;
    end;
    begin
      perform extensions.dblink_disconnect(v_connection_a);
    exception when others then null;
    end;
    begin
      perform extensions.dblink_disconnect(v_connection_b);
    exception when others then null;
    end;
    raise;
end;
$function$;

select pg_temp.test_login('34400000-0000-0000-0000-000000000051', jsonb_build_object(
  'member_role', 'bce', 'member_level', 5, 'dept_ids', '["edu"]'::jsonb, 'team_ids', '[]'::jsonb));
create temp table race344 as
select * from pg_temp.race_capture(
  format($$ select (public.approve_completed_work_request(%s, 3, 4, 'Decidentul A')).status $$,
    (select race_request_id from r344)),
  format($$ select (public.approve_completed_work_request(%s, 5, 5, 'Decidentul B')).status $$,
    (select race_request_id from r344)));
reset role;

select ok((select b_waited from race344),
  'the second approval BLOCKS on the Request row''s FOR UPDATE while the first is still uncommitted');
select is((select result_a from race344), 'approved',
  'the first approval commits the Request as approved');
select is((select result_b from race344), 'PT409 request_not_pending',
  'and the second wakes up, re-reads the row it was waiting for, and gets a clean PT409 request_not_pending -- never a second Task, never a raw constraint error');

select is((select count(*) from public.tasks where created_by = '34400000-0000-0000-0000-000000000051'), 1::bigint,
  'exactly ONE Task survives the double approval');
select is((select count(*) from public.task_evaluations as evaluation
             join public.tasks as task on task.id = evaluation.task_id
            where task.created_by = '34400000-0000-0000-0000-000000000051'), 1::bigint,
  'exactly one Evaluation');
select is((select format('%s|%s', count(*), coalesce(sum(ledger.delta), 0))
             from public.points_ledger as ledger
             join public.tasks as task on task.id = ledger.task_id
            where task.created_by = '34400000-0000-0000-0000-000000000051'),
  '1|6',
  'and the requester is credited exactly once, with the FIRST decider''s award (Difficulty 3 x rating_mult(4) = 6), never the second''s 5 x 3 = 15 on top of it');
select is((select format('%s|%s', request.status, (request.task_id is not null)::text)
             from public.completed_work_requests as request
            where request.id = (select race_request_id from r344)),
  'approved|true',
  'the Request itself ends approved exactly once, naming the one Task that was created');

-- ---- clean up everything the committed sessions left behind ----
select extensions.dblink_exec('cwr_setup', $$
  set session_replication_role = 'replica';
  delete from public.points_ledger
   where task_id in (select id from public.tasks where created_by = '34400000-0000-0000-0000-000000000051');
  delete from public.task_evaluations
   where task_id in (select id from public.tasks where created_by = '34400000-0000-0000-0000-000000000051');
  delete from public.task_activity
   where task_id in (select id from public.tasks where created_by = '34400000-0000-0000-0000-000000000051');
  set session_replication_role = 'origin';
  delete from public.notifications
   where member_id in ('34400000-0000-0000-0000-000000000051',
                       '34400000-0000-0000-0000-000000000052',
                       '34400000-0000-0000-0000-000000000053');
  delete from public.completed_work_requests
   where requester_id in ('34400000-0000-0000-0000-000000000052',
                          '34400000-0000-0000-0000-000000000053');
  delete from public.task_assignments
   where task_id in (select id from public.tasks where created_by = '34400000-0000-0000-0000-000000000051');
  delete from public.tasks where created_by = '34400000-0000-0000-0000-000000000051';
  delete from auth.users where id in (
    '34400000-0000-0000-0000-000000000051', '34400000-0000-0000-0000-000000000052',
    '34400000-0000-0000-0000-000000000053');
$$);
select extensions.dblink_disconnect('cwr_setup');

select is((select count(*) from public.tasks where created_by = '34400000-0000-0000-0000-000000000051'), 0::bigint,
  'the committed race and lock-probe fixtures are removed again -- this suite leaves no trace');
select is((select count(*) from public.points_ledger
            where member_id in ('34400000-0000-0000-0000-000000000052',
                                '34400000-0000-0000-0000-000000000053')), 0::bigint,
  'including every point the committed race actually credited');

select * from finish();
rollback;
