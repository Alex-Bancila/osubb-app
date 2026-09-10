-- seed.sql — local/staging demo data.
--
-- Runs automatically on `supabase db reset` and `supabase start`. It is NOT a
-- migration and `supabase db push` does not carry it, so a hosted project only
-- gets this data when someone applies the file deliberately: staging is seeded
-- by the manual "Seed staging demo data" workflow, which runs exactly this file
-- with psql. See docs/backend/seeding-staging.md.
--
-- Reference lookups (roles, departments, rating_guide, difficulty_guide,
-- role_capabilities, notif_suppression) are seeded by MIGRATIONS so they exist
-- in every environment, production included. Do not duplicate them here.
--
-- Everything below is demo data and it never reaches production — production
-- deploys migrations only, and the seed workflow refuses any project that is
-- not staging.
--
-- Passwords exist only because clicking through a demo with eight magic links
-- is miserable. Real onboarding is invite-only and passwordless (ADR-0003);
-- these accounts are @demo.osubb, an address nobody can receive mail at.

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

-- Ledger before tasks: points_ledger.task_id has no cascade either. This also
-- catches a real tester's points if they were awarded on a demo task.
delete from points_ledger l
 where exists (select 1 from profiles p
                where p.email like '%@demo.osubb'
                  and p.id in (l.member_id, l.awarded_by))
    or exists (select 1 from tasks t
                 join profiles p on p.id = t.created_by
                where t.id = l.task_id and p.email like '%@demo.osubb');

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
-- Graded tasks are NOT accompanied by hand-written ledger rows: the grading
-- trigger writes those. Setting `rating` here therefore exercises the points
-- engine on every reset, which is the point — a seed that inserted ledger
-- rows directly could drift from the formula it is supposed to illustrate.

insert into tasks (title, type, dept_id, team_id, status, difficulty, deadline, description, created_by) values
  -- Educational
  ('Workshop CV pentru boboci', 'proiect', 'edu', null, 'done',     4, current_date - 14, 'Sesiune practică de redactare CV.',        'd0000000-0000-0000-0000-000000000005'),
  ('Materiale curs Excel',      'content', 'edu', null, 'done',     2, current_date - 10, 'Slide-uri pentru cursul de Excel.',        'd0000000-0000-0000-0000-000000000005'),
  ('Contactare lectori',        'logistic','edu', null, 'progress', 3, current_date + 5,  'Confirmări pentru semestrul viitor.',      'd0000000-0000-0000-0000-000000000005'),
  ('Minuta ședinței EDU',       'admin',   'edu', null, 'done',     1, current_date - 7,  'Redactare și distribuire minută.',         'd0000000-0000-0000-0000-000000000005'),
  -- Imagine & PR
  ('Grafică eveniment toamnă',  'design',  'pr',  null, 'done',     4, current_date - 12, 'Set complet de materiale vizuale.',        'd0000000-0000-0000-0000-000000000006'),
  ('Postare Instagram recrutare','content','pr',  null, 'done',     2, current_date - 6,  'Anunț oficial de recrutare.',              'd0000000-0000-0000-0000-000000000006'),
  ('Plan media noiembrie',      'plan',    'pr',  null, 'todo',     3, current_date + 12, 'Calendar de postări pentru noiembrie.',    'd0000000-0000-0000-0000-000000000006'),
  ('Fotografii eveniment',      'content', 'pr',  null, 'done',     2, current_date - 9,  'Poze de la evenimentul de deschidere.',    'd0000000-0000-0000-0000-000000000006'),
  -- Tineret
  ('Logistică Tabăra de Toamnă','logistic','youth',null,'done',     5, current_date - 20, 'Transport, cazare, program.',              'd0000000-0000-0000-0000-000000000007'),
  ('Contactare parteneri',      'extern',  'youth',null,'overdue',  3, current_date - 3,  'Sponsorizări pentru tabără.',              'd0000000-0000-0000-0000-000000000007'),
  -- Financiar & HR
  ('Buget trimestrial',         'admin',   'fin', null, 'done',     4, current_date - 5,  'Raport de buget pentru BC.',               'd0000000-0000-0000-0000-000000000007'),
  ('Interviuri recrutare',      'hr',      'hr',  null, 'progress', 3, current_date + 8,  'Programare și susținere interviuri.',      'd0000000-0000-0000-0000-000000000007'),
  -- Echipa Aplicație
  ('Migrare bază de date',      'tehnic',  'diverse','t-app', 'done',   5, current_date - 2,  'Migrare completă cu teste automate.',      'd0000000-0000-0000-0000-000000000006'),
  ('Testare aplicație',         'tehnic',  'diverse','t-app', 'progress',3, current_date + 6, 'Testare pe telefon și desktop.',           'd0000000-0000-0000-0000-000000000006'),
  -- Open: anyone may claim these, which is what the tracker's "Deschise" tab is for
  ('Share story recrutare',     'promo',   'pr',  null, 'open',     1, current_date + 3,  'Distribuie story-ul de recrutare.',        'd0000000-0000-0000-0000-000000000006'),
  ('Ajutor la standul de recrutare','logistic','edu',null,'open',   2, current_date + 9,  'Două ore la stand, în campus.',            'd0000000-0000-0000-0000-000000000005');

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

-- Grading. Each update fires the trigger, which writes one ledger row per
-- assignee: points = difficulty × multiplier(rating).
update tasks set rating = 5 where title = 'Workshop CV pentru boboci';      -- 4 × 3 = 12
update tasks set rating = 3 where title = 'Materiale curs Excel';           -- 2 × 1 = 2
update tasks set rating = 4 where title = 'Minuta ședinței EDU';            -- 1 × 2 = 2
update tasks set rating = 5 where title = 'Grafică eveniment toamnă';       -- 4 × 3 = 12
update tasks set rating = 4 where title = 'Postare Instagram recrutare';    -- 2 × 2 = 4
update tasks set rating = 5 where title = 'Logistică Tabăra de Toamnă';     -- 5 × 3 = 15
update tasks set rating = 4 where title = 'Buget trimestrial';              -- 4 × 2 = 8
update tasks set rating = 5 where title = 'Migrare bază de date';           -- 5 × 3 = 15 each
-- A rating of 1 is a penalty, not a zero — the leaderboard should show that
-- honestly, and this is the row that proves the formula subtracts.
update tasks set rating = 1 where title = 'Fotografii eveniment';           -- 2 × −1 = −2

-- A BC sanction is separate from task points and is signed by its author.
insert into points_ledger (member_id, delta, reason, awarded_by) values
  ('d0000000-0000-0000-0000-000000000003', -5, 'sanction',
   'd0000000-0000-0000-0000-000000000007');

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
