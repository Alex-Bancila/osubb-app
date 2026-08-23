-- seed.sql — local/staging demo data (runs automatically on `supabase db reset`).
--
-- Reference lookups (roles, departments, rating_guide, difficulty_guide,
-- role_capabilities, notif_suppression) are seeded by MIGRATIONS so they exist
-- in every environment, production included. Do not duplicate them here.
--
-- Everything in this file is demo data. It never reaches production: the CLI
-- runs seed.sql on `db reset` and against staging, never as a migration.
--
-- Passwords exist only because clicking through a demo with eight magic links
-- is miserable. Real onboarding is invite-only and passwordless (ADR-0003);
-- these accounts are @demo.osubb, an address nobody can receive mail at.

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
  ('d0000000-0000-0000-0000-000000000006', 'it'),
  ('d0000000-0000-0000-0000-000000000006', 'pr'),
  ('d0000000-0000-0000-0000-000000000007', 'org'),
  ('d0000000-0000-0000-0000-000000000008', 'it');

-- Two teams, deliberately different in kind: one ordinary working team, one
-- open to recruits — the flag the calendar rule turns on (a recrut sees a
-- for_recruits team's events without belonging to it).
insert into teams (id, name, dept_id, lead_id, for_recruits, is_interne) values
  ('t-app',     'Echipa Aplicație', 'it',  'd0000000-0000-0000-0000-000000000006', false, false),
  ('t-recruti', 'Echipa Recruți',   'edu', 'd0000000-0000-0000-0000-000000000005', true,  false);

insert into team_members (team_id, member_id) values
  ('t-app',     'd0000000-0000-0000-0000-000000000006'),
  ('t-app',     'd0000000-0000-0000-0000-000000000008'),
  ('t-recruti', 'd0000000-0000-0000-0000-000000000002'),
  ('t-recruti', 'd0000000-0000-0000-0000-000000000005');
