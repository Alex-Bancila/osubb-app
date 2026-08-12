-- 0001_core_schema.sql
-- OSUBB backend — Epic 1.1 & 1.2: enums, reference lookups, members, teams.
-- Source of truth: docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md (§3.1–3.2)
-- Reference data (roles, departments, scoring guides) is seeded HERE (not in seed.sql)
-- so it exists in every environment, including production.

-- ============================ Enums ============================
create type member_role       as enum ('recrut','voluntar','activ','vot','responsabil','bce','bc','moderator');
create type member_status     as enum ('activ','inactiv','alumni');
create type task_status       as enum ('todo','progress','done','overdue','open');
create type event_type        as enum ('sedinta','activitate','call','eveniment','deadline','recrutare');
create type event_scope       as enum ('team','dept','project','org');
create type announce_priority  as enum ('critical','important','normal');
create type noti_kind         as enum ('announce','deadline','event','task','system');
create type request_kind      as enum ('award','new_task');
create type request_status    as enum ('pending','approved','rejected');

-- ==================== Roles (role → level) =====================
create table roles (
  id    member_role primary key,
  name  text not null,
  level int  not null
);
insert into roles (id, name, level) values
  ('recrut','Recrut',0),
  ('voluntar','Voluntar',1),
  ('activ','Membru Activ',2),
  ('vot','Membru cu Drept de Vot',3),
  ('responsabil','Responsabil de proiect',4),
  ('bce','BCE',5),
  ('bc','BC',6),
  ('moderator','Moderator',9);

-- ============ Departments (5 real + IT + org pseudo) ===========
create table departments (
  id    text primary key,
  name  text not null,
  short text not null,
  color text not null,
  kind  text not null default 'department'   -- 'department' | 'coordination' | 'org'
);
insert into departments (id, name, short, color, kind) values
  ('edu',  'Educational',       'EDU',    '#284C93', 'department'),
  ('pr',   'Imagine & PR',      'IMG&PR', '#7500A0', 'department'),
  ('youth','Tineret',           'TIN',    '#FF3B3B', 'department'),
  ('fin',  'Financiar',         'FIN',    '#007F33', 'department'),
  ('hr',   'Resurse Umane',     'HR',     '#F2A700', 'department'),
  ('it',   'Coordonator IT',    'IT',     '#ED2025', 'coordination'),
  ('org',  'Organizație',       'ORG',    '#ED2025', 'org');

-- ================= Scoring config (points guide) ===============
create table rating_guide (
  rating     int primary key check (rating between 1 and 5),
  multiplier int  not null,
  label      text not null,
  note       text
);
insert into rating_guide (rating, multiplier, label, note) values
  (1, -1, 'Foarte slab', 'Task realizat greșit / în detrimentul echipei — se scad puncte.'),
  (2,  0, 'Insuficient', 'Nefinalizat sau sub standard — nu se acordă puncte.'),
  (3,  1, 'Bun',         'Realizat corect, conform cerinței.'),
  (4,  2, 'Foarte bun',  'Peste așteptări, calitate ridicată.'),
  (5,  3, 'Excelent',    'Excepțional, impact major pentru organizație.');

create table difficulty_guide (
  stars int primary key check (stars between 1 and 5),
  note  text
);
insert into difficulty_guide (stars, note) values
  (1, 'Foarte ușor (ex. confirmare prezență, share story).'),
  (2, 'Ușor (ex. minută, postare simplă).'),
  (3, 'Mediu (ex. contactări, grafică).'),
  (4, 'Greu (ex. logistică eveniment, dezvoltare ecran).'),
  (5, 'Foarte greu (ex. coordonare proiect, migrare bază de date).');

-- ===================== Members (profiles) ======================
-- One row per person, keyed to the Supabase Auth user. Provisioned via invite
-- (invite-only access). RLS is added in Epic 3; enabled deny-by-default there.
create table profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text not null,
  email        text unique not null,
  phone        text,
  avatar_color text,
  role         member_role   not null default 'recrut',
  status       member_status not null default 'activ',
  joined_year  int,
  tier         text,
  created_at   timestamptz not null default now()
);

-- A member can belong to several departments (many-to-many).
create table member_departments (
  member_id uuid references profiles (id) on delete cascade,
  dept_id   text references departments (id),
  primary key (member_id, dept_id)
);

create table teams (
  id           text primary key,
  name         text not null,
  dept_id      text references departments (id),
  lead_id      uuid references profiles (id),
  for_recruits boolean not null default false,
  is_interne   boolean not null default false
);

create table team_members (
  team_id   text references teams (id) on delete cascade,
  member_id uuid references profiles (id) on delete cascade,
  primary key (team_id, member_id)
);

-- Indexes on columns used by future RLS policies / joins.
create index member_departments_member_idx on member_departments (member_id);
create index member_departments_dept_idx   on member_departments (dept_id);
create index team_members_member_idx        on team_members (member_id);
create index team_members_team_idx          on team_members (team_id);
create index profiles_role_idx              on profiles (role);
