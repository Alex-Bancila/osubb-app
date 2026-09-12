-- seed.sql — local/staging demo data.
--
-- Runs automatically on `supabase db reset` and `supabase start`. It is NOT a
-- migration and `supabase db push` does not carry it, so a hosted project only
-- gets this data when someone applies the file deliberately: staging is seeded
-- by the manual "Seed staging demo data" workflow, which runs exactly this file
-- with psql. See docs/backend/seeding-staging.md.
--
-- Reference lookups (roles, departments, rating_guide, difficulty_guide,
-- role levels, scoring guides, and notif_suppression) are seeded by MIGRATIONS so they exist
-- in every environment, production included. Do not duplicate them here.
--
-- Everything below is demo data and it never reaches production — production
-- deploys migrations only, and the seed workflow refuses any project that is
-- not staging.
--
-- Passwords exist only because clicking through a demo with eight magic links
-- is miserable. Real onboarding is invite-only and passwordless (ADR-0003);
-- these accounts are @demo.osubb, an address nobody can receive mail at.
--
-- ⚠️ Must be applied in a single transaction (`psql -1` / `--single-transaction`,
-- or `supabase db reset`, which already wraps it). The demo-cohort cleanup
-- below briefly disables the append-only guards on `task_evaluations` and
-- `task_activity` for a few statements each; that is safe only because a
-- mid-file failure rolls the whole file back with them, rather than leaving
-- a live database with those guards off. Every documented apply path
-- already runs this way — seed-staging.yml, scripts/check-seed-rerunnable.sh,
-- and `supabase db reset` — see docs/backend/seeding-staging.md.

-- ==================== Clear the previous demo data ====================
-- `db reset` drops the database before running this file, so locally these
-- deletes find nothing and cost nothing. They exist for staging, which is a
-- live database: applying the seed there must be safe to do twice, and the
-- second run must leave the same demo data behind rather than a duplicate of
-- it or an error.
--
-- Scope is exactly the demo cohort — the eight @demo.osubb accounts and the
-- rows they own. A real person invited to staging for testing keeps their
-- profile, their tasks and their points.
--
-- Order matters. `created_by`, `awarded_by`, Project `leader_id`,
-- `from_member` and
-- `decided_by` are plain references with no `on delete` clause, so Postgres
-- refuses to remove a member while any of them still points at that member:
-- the children go first. Everything else — memberships, team memberships,
-- assignees, RSVPs, announcement reads, notifications, push tokens — cascades
-- from `profiles`, which itself cascades from the single `auth.users` delete
-- at the end.

-- A real tester may create a Project and temporarily choose a demo account as
-- its lead. That Project is not demo-owned, so deleting it would be data loss;
-- preserving it while deleting its lead would violate the foreign key. Abort
-- the transaction with a precise message and let a human reassign the lead.
do $$
begin
  if exists (
    select 1
      from projects project
      join profiles leader on leader.id = project.leader_id
      join profiles creator on creator.id = project.created_by
     where leader.email like '%@demo.osubb'
       and creator.email not like '%@demo.osubb'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'seed_refuses_cross_owned_demo_project',
      detail = 'Reassign every non-demo-owned Project away from demo leads before re-seeding.';
  end if;
end;
$$;

-- Ledger and Assignment history before Tasks: neither Task reference
-- cascades. Delete only history for demo-owned Tasks, leaving independent
-- tester-owned history for non-demo Members untouched.
delete from points_ledger l
 where exists (select 1 from profiles p
                where p.email like '%@demo.osubb'
                  and p.id in (l.member_id, l.awarded_by))
    or exists (select 1 from tasks t
                 join profiles p on p.id = t.created_by
                where t.id = l.task_id and p.email like '%@demo.osubb');

-- #317/#292: `task_evaluations` and `task_activity` are append-only by
-- trigger, not merely by grants — `private.guard_task_evaluation_change()`
-- and `private.reject_task_activity_change()` reject every DELETE, including
-- one run by the table owner. Both tables reference the demo Tasks and
-- Assignments deleted just below, so re-seeding a live staging database
-- would fail on the foreign keys unless this demo-cohort history goes first.
-- The seed runs as the table owner (docs/backend/seeding-staging.md: "Connect
-- as postgres"), so it may disable those two triggers around its own
-- cleanup. It is done explicitly, for exactly these two statements, and
-- re-enabled immediately: nothing else in this file runs while history is
-- unguarded, and the scope is still only Tasks a demo account created. This
-- is safe only because the whole file runs in one transaction (see the
-- header) — a mid-file failure here rolls back with the triggers still
-- disabled, instead of leaving them off on a live database.
alter table task_evaluations disable trigger task_evaluations_guard_change;
alter table task_activity disable trigger task_activity_reject_change;

delete from task_evaluations evaluation
 where exists (
   select 1
     from tasks task
     join profiles creator on creator.id = task.created_by
    where task.id = evaluation.task_id
      and creator.email like '%@demo.osubb'
 );

delete from task_activity activity
 where exists (
   select 1
     from tasks task
     join profiles creator on creator.id = task.created_by
    where task.id = activity.task_id
      and creator.email like '%@demo.osubb'
 );

alter table task_activity enable trigger task_activity_reject_change;
alter table task_evaluations enable trigger task_evaluations_guard_change;

delete from task_assignments assignment
 where exists (
   select 1
     from tasks task
     join profiles creator on creator.id = task.created_by
    where task.id = assignment.task_id
      and creator.email like '%@demo.osubb'
 );

delete from task_requests r
 where exists (select 1 from profiles p
                where p.email like '%@demo.osubb'
                  and p.id in (r.from_member, r.decided_by));

delete from tasks t
 using profiles p where t.created_by = p.id and p.email like '%@demo.osubb';

delete from events e
 using profiles p where e.created_by = p.id and p.email like '%@demo.osubb';

delete from announcements a
 using profiles p where a.created_by = p.id and p.email like '%@demo.osubb';

-- Project memberships cascade from their Project. A Project is demo-owned
-- only when its creator belongs to the demo cohort; names are not ownership.
delete from projects project
 where exists (
   select 1 from profiles creator
    where creator.id = project.created_by
      and creator.email like '%@demo.osubb'
 );

-- Teams after tasks and events, which reference them.
delete from teams t
 where t.id in ('t-app', 't-recruti', 't-logistica');

delete from auth.users where email like '%@demo.osubb';

-- ==================== One login per role ====================
-- Password for all of them: parola123
--
-- ⚠️ Writing auth.users by hand has one non-obvious requirement: GoTrue reads
-- the token columns as NOT NULL strings, so they must be '' and not left null.
-- A null confirmation_token makes every login fail with a 500 and
-- "converting NULL to string is unsupported" — which looks like a broken app,
-- not a broken fixture.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select '00000000-0000-0000-0000-000000000000', m.id, 'authenticated', 'authenticated',
       m.email, extensions.crypt('parola123', extensions.gen_salt('bf')), now(),
       now(), now(), '{"provider":"email","providers":["email"]}', '{}',
       '', '', '', '', '', '', '', ''
  from (values
    ('d0000000-0000-0000-0000-000000000001'::uuid, 'recrut@demo.osubb'),
    ('d0000000-0000-0000-0000-000000000002'::uuid, 'voluntar@demo.osubb'),
    ('d0000000-0000-0000-0000-000000000003'::uuid, 'activ@demo.osubb'),
    ('d0000000-0000-0000-0000-000000000004'::uuid, 'vot@demo.osubb'),
    ('d0000000-0000-0000-0000-000000000005'::uuid, 'responsabil@demo.osubb'),
    ('d0000000-0000-0000-0000-000000000006'::uuid, 'bce@demo.osubb'),
    ('d0000000-0000-0000-0000-000000000007'::uuid, 'bc@demo.osubb'),
    ('d0000000-0000-0000-0000-000000000008'::uuid, 'moderator@demo.osubb')
  ) as m (id, email);

-- Names are ordinary Romanian names on purpose: a demo full of "Test User 1"
-- reads as a prototype, and BC are looking at this on September 15.
insert into profiles (id, full_name, email, role, joined_year, avatar_color) values
  ('d0000000-0000-0000-0000-000000000001', 'Andrei Mureșan',   'recrut@demo.osubb',      'recrut',      2026, '#ED2025'),
  ('d0000000-0000-0000-0000-000000000002', 'Ioana Popescu',    'voluntar@demo.osubb',    'voluntar',    2025, '#284C93'),
  ('d0000000-0000-0000-0000-000000000003', 'Vlad Constantin',  'activ@demo.osubb',       'activ',       2025, '#7500A0'),
  ('d0000000-0000-0000-0000-000000000004', 'Maria Dobre',      'vot@demo.osubb',         'vot',         2024, '#007F33'),
  ('d0000000-0000-0000-0000-000000000005', 'Raluca Ionescu',   'responsabil@demo.osubb', 'responsabil', 2024, '#F2A700'),
  ('d0000000-0000-0000-0000-000000000006', 'Alex Băncilă',     'bce@demo.osubb',         'bce',         2023, '#ED2025'),
  ('d0000000-0000-0000-0000-000000000007', 'Cristina Șerban',  'bc@demo.osubb',          'bc',          2023, '#FF3B3B'),
  ('d0000000-0000-0000-0000-000000000008', 'Moderator OSUBB',  'moderator@demo.osubb',   'moderator',   2023, '#241F1E');

-- Departments: spread across the five real ones so the department cup has
-- something to compare, and one member sits in two (that combination is what
-- the visibility rules are hardest on).
insert into member_departments (member_id, dept_id) values
  ('d0000000-0000-0000-0000-000000000001', 'edu'),
  ('d0000000-0000-0000-0000-000000000002', 'edu'),
  ('d0000000-0000-0000-0000-000000000003', 'pr'),
  ('d0000000-0000-0000-0000-000000000004', 'youth'),
  ('d0000000-0000-0000-0000-000000000005', 'edu'),
  ('d0000000-0000-0000-0000-000000000006', 'diverse'),
  ('d0000000-0000-0000-0000-000000000006', 'pr'),
  ('d0000000-0000-0000-0000-000000000007', 'org'),
  ('d0000000-0000-0000-0000-000000000008', 'diverse'),
  -- Financiar and Resurse Umane get a member each so all five real
  -- departments appear in the cup. `dept_cup` inner-joins through
  -- member_departments, so a department with nobody in it disappears from the
  -- standings entirely (issue #134) — which would be a strange thing for BC
  -- to notice mid-demo.
  ('d0000000-0000-0000-0000-000000000007', 'fin'),
  ('d0000000-0000-0000-0000-000000000005', 'hr');

-- Representative Team kinds: two Department Teams and one Independent Team.
-- The recruits flag remains covered on its Department Team for Calendar.
insert into teams (id, name, dept_id, for_recruits, is_interne) values
  ('t-app',     'Echipa Aplicație', 'diverse', false, false),
  ('t-recruti', 'Echipa Recruți',   'edu',     true,  false),
  ('t-logistica','Echipa Logistică', null,      false, false);

insert into team_members (team_id, member_id) values
  ('t-app',     'd0000000-0000-0000-0000-000000000006'),
  ('t-app',     'd0000000-0000-0000-0000-000000000008'),
  ('t-recruti', 'd0000000-0000-0000-0000-000000000002'),
  ('t-recruti', 'd0000000-0000-0000-0000-000000000005'),
  ('t-logistica','d0000000-0000-0000-0000-000000000004'),
  ('t-logistica','d0000000-0000-0000-0000-000000000007'),
  ('it',        'd0000000-0000-0000-0000-000000000006'),
  ('it',        'd0000000-0000-0000-0000-000000000008');

-- ==================== Representative Projects ====================
-- Projects are independent from departments. These two fixtures cover the
-- active and archived lifecycles as well as lead, Responsible, ordinary
-- member, and outsider authorization scenarios. The database assigns their
-- ids; tests and dependent seed rows locate them by stable content instead.
insert into projects (name, status, leader_id, created_by) values
  ('Festivalul Studențesc 2026', 'active',
   'd0000000-0000-0000-0000-000000000005',
   'd0000000-0000-0000-0000-000000000007'),
  ('Gala Voluntarilor 2025', 'archived',
   'd0000000-0000-0000-0000-000000000004',
   'd0000000-0000-0000-0000-000000000007');

-- The leader membership is inserted automatically by the Project invariant
-- trigger. Add only the non-leader roles here. Vlad deliberately has the
-- ordinary OSUBB role `activ` while being a Project Responsible: Project
-- authority is independent from the organization-wide `responsabil` role.
insert into project_members (project_id, member_id, project_role)
select project.id, fixture.member_id, fixture.project_role
  from (values
    ('Festivalul Studențesc 2026',
     'd0000000-0000-0000-0000-000000000003'::uuid, 'responsible'),
    ('Festivalul Studențesc 2026',
     'd0000000-0000-0000-0000-000000000002'::uuid, 'member'),
    ('Gala Voluntarilor 2025',
     'd0000000-0000-0000-0000-000000000006'::uuid, 'responsible'),
    ('Gala Voluntarilor 2025',
     'd0000000-0000-0000-0000-000000000001'::uuid, 'member')
  ) as fixture (project_name, member_id, project_role)
  join projects project
    on project.name = fixture.project_name
   and project.created_by = 'd0000000-0000-0000-0000-000000000007';

-- ==================== Demo work: tasks, grades, points ====================
-- #317 retired the grading triggers, so this file now writes the Evaluation
-- and its ledger entry itself, the way the evaluation commands (#336-#338)
-- will. Nothing here hard-codes a number: every Evaluation's `points` and
-- every ledger `delta` is computed as difficulty × rating_mult(rating) from
-- the same scoring guide the commands use, so the demo data still
-- illustrates the formula rather than a snapshot of it. The per-Task
-- arithmetic in the comments beside each grading statement is a reader's
-- aid, not the source of the number.

create or replace function pg_temp.task_deadline(p_date date)
returns timestamptz
language sql
stable
as $$
  select (p_date::timestamp + time '23:59') at time zone 'Europe/Bucharest'
$$;

-- #312: Difficulty is an Evaluation input, not a creation input (ADR-0007),
-- and `tasks_evaluation_inputs_ck` requires Difficulty and Rating together
-- exactly when status is completed/unfulfilled. The fixture rows below still
-- name each demo Task's eventual status (used for readability and for the
-- started_at derivation immediately below), but a row headed for `completed`
-- or `unfulfilled` is inserted as `todo` without a Difficulty; the "Grading"
-- block further down moves each one to its terminal status in the same
-- statement that sets its Rating, so the row never sits in the disallowed
-- half-evaluated shape. Rows that stay todo/in_progress get no Difficulty at
-- all, matching the target model where a creator does not guess it up front.
insert into tasks
  (title, type, dept_id, team_id, status, difficulty, deadline, description,
   created_by, started_at)
select fixture.title, fixture.type, fixture.dept_id, fixture.team_id,
       case when fixture.status in ('completed', 'unfulfilled') then 'todo' else fixture.status end::public.task_status,
       case when fixture.status in ('completed', 'unfulfilled') then fixture.difficulty end,
       fixture.deadline, fixture.description, fixture.created_by::uuid,
       case when fixture.status = 'in_progress' then now() end
  from (values
  -- Educational
  ('Workshop CV pentru boboci', 'proiect', 'edu', null, 'completed',   4, pg_temp.task_deadline(current_date - 14), 'Sesiune practică de redactare CV.',        'd0000000-0000-0000-0000-000000000005'),
  ('Materiale curs Excel',      'content', 'edu', null, 'completed',   2, pg_temp.task_deadline(current_date - 10), 'Slide-uri pentru cursul de Excel.',        'd0000000-0000-0000-0000-000000000005'),
  ('Contactare lectori',        'logistic','edu', null, 'in_progress', 3, pg_temp.task_deadline(current_date + 5),  'Confirmări pentru semestrul viitor.',      'd0000000-0000-0000-0000-000000000005'),
  ('Minuta ședinței EDU',       'admin',   'edu', null, 'completed',   1, pg_temp.task_deadline(current_date - 7),  'Redactare și distribuire minută.',         'd0000000-0000-0000-0000-000000000005'),
  -- Imagine & PR
  ('Grafică eveniment toamnă',  'design',  'pr',  null, 'completed', 4, pg_temp.task_deadline(current_date - 12), 'Set complet de materiale vizuale.',        'd0000000-0000-0000-0000-000000000006'),
  ('Postare Instagram recrutare','content','pr',  null, 'completed', 2, pg_temp.task_deadline(current_date - 6),  'Anunț oficial de recrutare.',              'd0000000-0000-0000-0000-000000000006'),
  ('Plan media noiembrie',      'plan',    'pr',  null, 'todo',     3, pg_temp.task_deadline(current_date + 12), 'Calendar de postări pentru noiembrie.',    'd0000000-0000-0000-0000-000000000006'),
  ('Fotografii eveniment',      'content', 'pr',  null, 'completed', 2, pg_temp.task_deadline(current_date - 9),  'Poze de la evenimentul de deschidere.',    'd0000000-0000-0000-0000-000000000006'),
  -- Tineret
  ('Logistică Tabăra de Toamnă','logistic','youth',null,'completed', 5, pg_temp.task_deadline(current_date - 20), 'Transport, cazare, program.',              'd0000000-0000-0000-0000-000000000007'),
  ('Contactare parteneri',      'extern',  'youth',null,'in_progress',3, pg_temp.task_deadline(current_date - 3),  'Sponsorizări pentru tabără.',              'd0000000-0000-0000-0000-000000000007'),
  -- Financiar & HR
  ('Buget trimestrial',         'admin',   'fin', null, 'completed', 4, pg_temp.task_deadline(current_date - 5),  'Raport de buget pentru BC.',               'd0000000-0000-0000-0000-000000000007'),
  ('Interviuri recrutare',      'hr',      'hr',  null, 'in_progress',3, pg_temp.task_deadline(current_date + 8),  'Programare și susținere interviuri.',      'd0000000-0000-0000-0000-000000000007'),
  -- Echipa Aplicație
  ('Migrare bază de date',      'tehnic',  null, 't-app', 'completed',  5, pg_temp.task_deadline(current_date - 2),  'Migrare completă cu teste automate.',      'd0000000-0000-0000-0000-000000000006'),
  ('Testare aplicație',         'tehnic',  null, 't-app', 'in_progress',3, pg_temp.task_deadline(current_date + 6), 'Testare pe telefon și desktop.',           'd0000000-0000-0000-0000-000000000006'),
  -- Open: anyone may claim these, which is what the tracker's "Deschise" tab is for
  ('Share story recrutare',     'promo',   'pr',  null, 'todo',      1, pg_temp.task_deadline(current_date + 3),  'Distribuie story-ul de recrutare.',        'd0000000-0000-0000-0000-000000000006'),
  ('Ajutor la standul de recrutare','logistic','edu',null,'todo',    2, pg_temp.task_deadline(current_date + 9),  'Două ore la stand, în campus.',            'd0000000-0000-0000-0000-000000000005')
  ) as fixture
    (title, type, dept_id, team_id, status, difficulty, deadline,
     description, created_by);

-- These reproduce legacy organization-wide opportunities on a fresh reset;
-- the #285 migration gives upgraded `open` rows the same audience.
update tasks
   set audience = 'org'
 where title in ('Share story recrutare', 'Ajutor la standul de recrutare')
   and exists (
     select 1
       from profiles creator
      where creator.id = tasks.created_by
        and creator.email like '%@demo.osubb'
   );

update tasks
   set assignment_mode = 'public',
       queue_opened_at = now()
 where title in ('Share story recrutare', 'Ajutor la standul de recrutare')
   and exists (
     select 1
       from profiles creator
      where creator.id = tasks.created_by
        and creator.email like '%@demo.osubb'
   );

insert into task_assignees (task_id, member_id)
select t.id, a.member_id
  from (values
    ('Workshop CV pentru boboci',      'd0000000-0000-0000-0000-000000000002'::uuid),
    ('Materiale curs Excel',           'd0000000-0000-0000-0000-000000000001'::uuid),
    ('Contactare lectori',             'd0000000-0000-0000-0000-000000000002'::uuid),
    ('Minuta ședinței EDU',            'd0000000-0000-0000-0000-000000000001'::uuid),
    ('Grafică eveniment toamnă',       'd0000000-0000-0000-0000-000000000003'::uuid),
    ('Postare Instagram recrutare',    'd0000000-0000-0000-0000-000000000003'::uuid),
    ('Plan media noiembrie',           'd0000000-0000-0000-0000-000000000006'::uuid),
    ('Fotografii eveniment',           'd0000000-0000-0000-0000-000000000003'::uuid),
    ('Logistică Tabăra de Toamnă',     'd0000000-0000-0000-0000-000000000004'::uuid),
    ('Contactare parteneri',           'd0000000-0000-0000-0000-000000000004'::uuid),
    ('Buget trimestrial',              'd0000000-0000-0000-0000-000000000007'::uuid),
    ('Interviuri recrutare',           'd0000000-0000-0000-0000-000000000005'::uuid),
    ('Migrare bază de date',           'd0000000-0000-0000-0000-000000000006'::uuid),
    ('Migrare bază de date',           'd0000000-0000-0000-0000-000000000008'::uuid),
    ('Testare aplicație',              'd0000000-0000-0000-0000-000000000008'::uuid)
  ) as a (title, member_id)
  join tasks t on t.title = a.title;

-- Grading. Each update moves a Task to `completed` together with
-- `completed_at` and the Rating it goes with (#312's
-- tasks_evaluation_inputs_ck requires Difficulty and Rating together the
-- instant status reaches completed), and runs before the task_assignments
-- backfill just below, which reads each Task's final status/completed_at to
-- decide how that history ended. Since #317 these updates no longer move
-- points by themselves — the Evaluations and ledger entries are written
-- further down, after the Assignments they must reference exist.
update tasks set status = 'completed', completed_at = now(), rating = 5 where title = 'Workshop CV pentru boboci';      -- 4 × 3 = 12
update tasks set status = 'completed', completed_at = now(), rating = 3 where title = 'Materiale curs Excel';           -- 2 × 1 = 2
update tasks set status = 'completed', completed_at = now(), rating = 4 where title = 'Minuta ședinței EDU';            -- 1 × 2 = 2
update tasks set status = 'completed', completed_at = now(), rating = 5 where title = 'Grafică eveniment toamnă';       -- 4 × 3 = 12
update tasks set status = 'completed', completed_at = now(), rating = 4 where title = 'Postare Instagram recrutare';    -- 2 × 2 = 4
update tasks set status = 'completed', completed_at = now(), rating = 5 where title = 'Logistică Tabăra de Toamnă';     -- 5 × 3 = 15
update tasks set status = 'completed', completed_at = now(), rating = 4 where title = 'Buget trimestrial';              -- 4 × 2 = 8
update tasks set status = 'completed', completed_at = now(), rating = 5 where title = 'Migrare bază de date';           -- 5 × 3 = 15 each
-- A rating of 1 is a penalty, not a zero — the leaderboard should show that
-- honestly, and this is the row that proves the formula subtracts.
update tasks set status = 'completed', completed_at = now(), rating = 1 where title = 'Fotografii eveniment';           -- 2 × −1 = −2

-- Keep the transitional join table and the new history model aligned until
-- every legacy consumer has moved. UUID order is deterministic for the one
-- unfinished demo Executor; terminal participants all remain ended history.
with ranked_demo_assignees as (
  select
    task.id as task_id,
    legacy.member_id,
    task.created_at,
    task.status,
    task.completed_at,
    task.unfulfilled_at,
    task.cancelled_at,
    row_number() over (
      partition by task.id order by legacy.member_id
    ) as member_order
  from task_assignees legacy
  join tasks task on task.id = legacy.task_id
  join profiles creator on creator.id = task.created_by
  where creator.email like '%@demo.osubb'
)
insert into task_assignments
  (task_id, member_id, assigned_at, assigned_by, ended_at, end_reason, end_note)
select
  legacy.task_id,
  legacy.member_id,
  legacy.created_at,
  null,
  case
    when legacy.status = 'completed' then legacy.completed_at
    when legacy.status = 'unfulfilled' then legacy.unfulfilled_at
    when legacy.status = 'cancelled' then legacy.cancelled_at
    when legacy.member_order > 1 then legacy.created_at
  end,
  case
    when legacy.status = 'completed' then 'completed'
    when legacy.status = 'unfulfilled' then 'failed'
    when legacy.status = 'cancelled' then 'cancelled'
    when legacy.member_order > 1 then 'legacy_migration'
  end,
  case
    when legacy.status in ('todo', 'in_progress', 'in_review')
     and legacy.member_order > 1
      then 'Deterministic migration: another legacy participant was selected as Executor by member UUID order.'
  end
from ranked_demo_assignees legacy;

-- Evaluations, then the ledger entries that name them (#317). One Evaluation
-- per graded demo Task × participant, exactly as the retired trigger wrote
-- one ledger row per graded Task × assignee, so the demo totals are the same
-- numbers they have always been.
--
-- Most graded demo Tasks have a single participant and are recorded the way
-- the evaluation commands (#336-#338) will record real work: `source =
-- 'command'`, evaluated by the Task's creator. One does not — "Migrare bază
-- de date" has two participants and two legitimate credits, which ADR-0007's
-- one-Executor model cannot express as two open command Evaluations
-- (task_evaluations_one_open_per_task_uidx forbids it, deliberately). That
-- Task is the legacy shape #316's Ruling 11 and #317's backfill exist for,
-- and the demo keeps it: two `legacy_migration` Evaluations with no
-- evaluator, one per Assignment. The rule is written as "more than one
-- participant", not as that Task's title, so editing the fixture above
-- cannot silently produce an invalid pair.
create or replace view pg_temp.demo_graded_work as
select
  task.id                                  as task_id,
  task.created_by                          as evaluator_id,
  task.status,
  task.difficulty,
  task.rating,
  task.completed_at,
  assignment.id                            as assignment_id,
  assignment.member_id,
  count(*) over (partition by task.id)     as participant_count
  from tasks task
  join task_assignments assignment on assignment.task_id = task.id
  join profiles creator on creator.id = task.created_by
 where creator.email like '%@demo.osubb'
   and task.status in ('completed', 'unfulfilled')
   and task.difficulty is not null
   and task.rating is not null;

insert into task_evaluations
  (task_id, assignment_id, source, evaluated_by, outcome,
   difficulty, rating, points, note, evaluated_at)
select
  graded.task_id,
  graded.assignment_id,
  'command',
  graded.evaluator_id,
  case when graded.status = 'unfulfilled' then 'unfulfilled' else 'completed' end,
  graded.difficulty,
  graded.rating,
  graded.difficulty * rating_mult(graded.rating),
  'Evaluare finală conform ghidului de notare.',
  coalesce(graded.completed_at, now())
  from pg_temp.demo_graded_work graded
 where graded.participant_count = 1
 order by graded.task_id, graded.member_id;

-- #317 closed `source = 'legacy_migration'` with
-- `task_evaluations_reject_legacy_source` once its backfill had run. The
-- owner disables it here, for one statement, to reproduce the one
-- legacy-shaped demo Task described above — the same deliberate, documented
-- exception that migration's comment anticipates, not a way around the rule.
-- As above, this is safe only because the file runs in a single transaction
-- (see the header): a mid-file failure rolls back with the trigger still
-- disabled rather than leaving it off on a live database.
alter table task_evaluations disable trigger task_evaluations_reject_legacy_source;

insert into task_evaluations
  (task_id, assignment_id, source, evaluated_by, outcome,
   difficulty, rating, points, note, evaluated_at)
select
  graded.task_id,
  graded.assignment_id,
  'legacy_migration',
  null,
  case when graded.status = 'unfulfilled' then 'unfulfilled' else 'completed' end,
  graded.difficulty,
  graded.rating,
  graded.difficulty * rating_mult(graded.rating),
  'Credit istoric: task cu mai mulți participanți, păstrat în forma de dinaintea modelului cu un singur Executor.',
  coalesce(graded.completed_at, now())
  from pg_temp.demo_graded_work graded
 where graded.participant_count > 1
 order by graded.task_id, graded.member_id;

alter table task_evaluations enable trigger task_evaluations_reject_legacy_source;

-- The credit itself. `awarded_by` stays null: the Evaluation names the
-- evaluator now, and the retired trigger only ever stored auth.uid(), which
-- was null for every row this file produced.
insert into points_ledger (member_id, delta, reason, task_id, evaluation_id)
select
  assignment.member_id,
  evaluation.points,
  'task',
  evaluation.task_id,
  evaluation.id
  from task_evaluations evaluation
  join task_assignments assignment on assignment.id = evaluation.assignment_id
  join tasks task on task.id = evaluation.task_id
  join profiles creator on creator.id = task.created_by
 where creator.email like '%@demo.osubb'
   and evaluation.reversed_at is null
 order by evaluation.id;

-- A BC sanction is separate from task points and is signed by its author.
insert into points_ledger (member_id, delta, reason, awarded_by, note) values
  ('d0000000-0000-0000-0000-000000000003', -5, 'sanction',
   'd0000000-0000-0000-0000-000000000007', 'Întârziere repetată la ședințe.');

-- ==================== Calendar ====================
-- One event per branch of the visibility rule (spec §4.4), so switching
-- demo accounts visibly changes the calendar rather than showing everyone
-- the same list: org-wide, per-department, a closed team, a for_recruits
-- team, and a recruitment event that reaches everyone by type.
insert into events (title, type, dept_id, team_id, scope, starts_at, ends_at, location, capacity, description, created_by) values
  ('Adunarea Generală de toamnă', 'sedinta',   null,   null,       'org',
   now() + interval '9 days',  now() + interval '9 days 3 hours',  'Aula Magna',        200,
   'Raport de activitate și vot.',                    'd0000000-0000-0000-0000-000000000007'),
  ('Ședință Educational',        'sedinta',   'edu',  null,       'dept',
   now() + interval '2 days',  now() + interval '2 days 2 hours',  'Sala 305',           25,
   'Planificarea activităților lunii.',               'd0000000-0000-0000-0000-000000000005'),
  ('Brainstorming campanie PR',  'activitate','pr',   null,       'dept',
   now() + interval '4 days',  now() + interval '4 days 2 hours',  'Sediu OSUBB',        15,
   'Idei pentru campania de iarnă.',                  'd0000000-0000-0000-0000-000000000006'),
  ('Sprint review Echipa Aplicație', 'sedinta','diverse','t-app',   'team',
   now() + interval '1 day',   now() + interval '1 day 1 hour',    'Online',             10,
   'Demo intern al aplicației.',                      'd0000000-0000-0000-0000-000000000006'),
  ('Training pentru recruți',    'activitate','edu',  't-recruti','team',
   now() + interval '6 days',  now() + interval '6 days 3 hours',  'Sala 210',           40,
   'Prima întâlnire cu echipa.',                      'd0000000-0000-0000-0000-000000000005'),
  ('Recrutare de toamnă — stand','recrutare', 'hr',   null,       'dept',
   now() + interval '3 days',  now() + interval '3 days 6 hours',  'Campus FSEGA',      null,
   'Stand de promovare, două ture.',                  'd0000000-0000-0000-0000-000000000005'),
  ('Deadline: raport trimestrial','deadline', 'fin',  null,       'dept',
   now() + interval '7 days',  null,                                null,               null,
   'Trimiterea raportului către BC.',                 'd0000000-0000-0000-0000-000000000007');

-- RSVPs, including one declined — a calendar where everyone always attends
-- does not show that the toggle has two states.
insert into event_attendance (event_id, member_id, status)
select e.id, a.member_id, a.status
  from (values
    ('Adunarea Generală de toamnă', 'd0000000-0000-0000-0000-000000000002'::uuid, 'going'),
    ('Adunarea Generală de toamnă', 'd0000000-0000-0000-0000-000000000003'::uuid, 'going'),
    ('Adunarea Generală de toamnă', 'd0000000-0000-0000-0000-000000000004'::uuid, 'declined'),
    ('Ședință Educational',         'd0000000-0000-0000-0000-000000000002'::uuid, 'going'),
    ('Ședință Educational',         'd0000000-0000-0000-0000-000000000001'::uuid, 'going'),
    ('Training pentru recruți',     'd0000000-0000-0000-0000-000000000001'::uuid, 'going'),
    ('Sprint review Echipa Aplicație','d0000000-0000-0000-0000-000000000006'::uuid, 'going')
  ) as a (title, member_id, status)
  join events e on e.title = a.title;

-- ==================== Announcements ====================
-- One critical + pinned (the feed's loudest state), one with a form link
-- (the v1 forms story — a Google Form, not a native engine), one scoped to a
-- single department, and ordinary ones underneath.
insert into announcements (title, body, dept_id, author, priority, category, pinned, form_label, form_url, published_at, created_by) values
  ('Ședință extraordinară BC — vineri',
   'Vineri, ora 18:00, Aula Magna. Prezența tuturor coordonatorilor este obligatorie.',
   null, 'BC', 'critical', 'organizatoric', true, null, null,
   now() - interval '1 day',  'd0000000-0000-0000-0000-000000000007'),
  ('Feedback eveniment de deschidere',
   'Spune-ne cum ți s-a părut. Durează două minute și chiar ne ajută.',
   null, 'Imagine & PR', 'important', 'feedback', false,
   'Completează formularul', 'https://forms.gle/exemplu-osubb',
   now() - interval '3 days', 'd0000000-0000-0000-0000-000000000006'),
  ('Materiale de la cursul de Excel',
   'Slide-urile și exercițiile sunt în drive-ul departamentului.',
   'edu', 'Educational', 'normal', 'resurse', false, null, null,
   now() - interval '5 days', 'd0000000-0000-0000-0000-000000000005'),
  ('Recrutarea de toamnă începe luni',
   'Standul din campus are nevoie de voluntari pentru două ture pe zi.',
   null, 'Resurse Umane', 'important', 'recrutare', true, null, null,
   now() - interval '2 days', 'd0000000-0000-0000-0000-000000000005'),
  ('Noul ghid de punctaj',
   'Dificultatea și nota se înmulțesc — detaliile sunt în aplicație, la Ghid.',
   null, 'BC', 'normal', 'organizatoric', false, null, null,
   now() - interval '8 days', 'd0000000-0000-0000-0000-000000000007');

-- A few members have already read things, so the unread badge shows a real
-- number instead of "everything" or "nothing".
insert into announcement_reads (announcement_id, member_id)
select a.id, r.member_id
  from (values
    ('Noul ghid de punctaj',              'd0000000-0000-0000-0000-000000000002'::uuid),
    ('Noul ghid de punctaj',              'd0000000-0000-0000-0000-000000000003'::uuid),
    ('Materiale de la cursul de Excel',   'd0000000-0000-0000-0000-000000000002'::uuid),
    ('Recrutarea de toamnă începe luni',  'd0000000-0000-0000-0000-000000000003'::uuid)
  ) as r (title, member_id)
  join announcements a on a.title = r.title;

-- ==================== Notifications ====================
-- Written here by hand only because the fan-out trigger is issue #68; once
-- that lands, announcements will produce these rows themselves.
-- Note the suppression rule at work: BC and BCE get the announcement, never
-- the task/deadline broadcasts.
insert into notifications (member_id, kind, icon, title, body, critical, read, link, created_at) values
  ('d0000000-0000-0000-0000-000000000002', 'announce', '📢', 'Ședință extraordinară BC — vineri', 'Aula Magna, ora 18:00.', true,  false, '/anunturi', now() - interval '1 day'),
  ('d0000000-0000-0000-0000-000000000002', 'task',     '✅', 'Task nou: Contactare lectori',      'Deadline peste 5 zile.',  false, false, '/tracker',  now() - interval '2 days'),
  ('d0000000-0000-0000-0000-000000000002', 'event',    '📅', 'Ședință Educational',               'Poimâine, sala 305.',     false, true,  '/calendar', now() - interval '3 days'),
  ('d0000000-0000-0000-0000-000000000001', 'announce', '📢', 'Ședință extraordinară BC — vineri', 'Aula Magna, ora 18:00.', true,  false, '/anunturi', now() - interval '1 day'),
  ('d0000000-0000-0000-0000-000000000001', 'event',    '📅', 'Training pentru recruți',           'Peste 6 zile, sala 210.', false, false, '/calendar', now() - interval '1 day'),
  ('d0000000-0000-0000-0000-000000000003', 'system',   '⚠️', 'Ai primit o sancțiune',             'Contactează BC pentru detalii.', true, false, '/profil', now() - interval '4 days'),
  ('d0000000-0000-0000-0000-000000000007', 'announce', '📢', 'Recrutarea de toamnă începe luni',  'Standul are nevoie de voluntari.', false, false, '/anunturi', now() - interval '2 days');
