-- 20260812184706_tasks_and_requests.sql
-- Epic 1.3: tasks, assignees, task requests (issue #2).
-- Source of truth: docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md §3.3
-- Points formula (CONTEXT.md): points = difficulty × multiplier(rating); rating 1 is a penalty.

-- rating → multiplier (immutable so it can drive the generated column).
-- Mirrors rating_guide (1→-1, 2→0, 3→+1, 4→+2, 5→+3); ungraded (null) contributes 0.
create or replace function rating_mult(r int) returns int
  immutable language sql as
$$ select case r when 1 then -1 when 2 then 0 when 3 then 1 when 4 then 2 when 5 then 3 else 0 end $$;

create table tasks (
  id          bigint generated always as identity primary key,
  title       text not null,
  type        text,
  dept_id     text references departments (id),
  team_id     text references teams (id),
  status      task_status not null default 'todo',
  difficulty  int not null check (difficulty between 1 and 5),
  rating      int check (rating between 1 and 5),      -- null until graded
  points      int generated always as (difficulty * coalesce(rating_mult(rating), 0)) stored,
  deadline    date,
  description text,
  created_by  uuid references profiles (id),
  created_at  timestamptz not null default now()
);

create table task_assignees (
  task_id   bigint references tasks (id) on delete cascade,
  member_id uuid references profiles (id) on delete cascade,
  primary key (task_id, member_id)
);

-- Award-points / new-task proposals awaiting approval by level >= 4 (spec §3.3).
create table task_requests (
  id          bigint generated always as identity primary key,
  kind        request_kind not null,
  title       text not null,
  from_member uuid references profiles (id),
  dept_id     text references departments (id),
  points      int,
  note        text,
  status      request_status not null default 'pending',
  decided_by  uuid references profiles (id),
  created_at  timestamptz not null default now()
);

-- RLS on from birth: deny-by-default for anon/authenticated until Epic 3.3
-- adds the policies (spec §4.3). postgres/service_role bypass RLS, so seeds,
-- triggers and admin routines keep working. Tables from migration 0001 get
-- the same treatment in Epic 3.1.
alter table tasks         enable row level security;
alter table task_assignees enable row level security;
alter table task_requests  enable row level security;

-- Indexes on columns used by future RLS policies (§4.3) and screen queries (§5).
create index tasks_dept_idx            on tasks (dept_id);
create index tasks_team_idx            on tasks (team_id);
create index tasks_status_idx          on tasks (status);
create index tasks_deadline_idx        on tasks (deadline);
create index task_assignees_member_idx on task_assignees (member_id);
create index task_requests_status_idx  on task_requests (status);
create index task_requests_member_idx  on task_requests (from_member);
