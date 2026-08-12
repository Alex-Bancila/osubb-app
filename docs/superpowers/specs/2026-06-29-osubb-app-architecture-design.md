# OSUBB App — Architecture & Data Model Design

**Date:** 2026-06-29
**Status:** Design — pending team review
**Companion:** see `docs/osubb-app-tech-stack.md` (Revision 2) for the technology choices, pricing, and head-to-head comparisons.

This spec defines the real backend behind the OSUBB app: the PostgreSQL schema, the points engine, the Row-Level-Security (RLS) permission matrix for the **8 roles × 5 departments**, and how each app screen maps onto the data. The entities are drawn from the data model that was prototyped in the mockup — but the design itself is independent of the mockup and of the frontend framework.

> **Note (aligned with tech-stack Revision 2):** this backend is **frontend-agnostic** — the schema, RLS, and Edge Functions are identical whether the client is the recommended **Capacitor + React + Ionic** app (with an AG Grid data grid for the dashboard tables) or the co-leader **Flutter** app. Push is delivered via **OneSignal** (per-role targeting console) rather than wiring FCM/APNs by hand; the per-role suppression logic still lives server-side as described in §5.2.

---

## 1. Architecture overview

```
                     ┌──────────────────────────────────────────────┐
                     │  ONE client codebase                          │
   Desktop browser ──┤    • Capacitor + React + Ionic (+ AG Grid)    │
   Android / iOS  ───┤    • served as a PWA (Cloudflare Pages),      │
                     │      wrapped by Capacitor for the app stores  │
                     └───────────────┬──────────────────────────────┘
                                     │  supabase-js (HTTPS + WebSocket)
                                     ▼
        ┌─────────────────────────── Supabase ───────────────────────────┐
        │  Auth (email + Google OAuth)  →  issues JWT with custom claims  │
        │  PostgreSQL  +  Row-Level Security (the 8×5 permission model)   │
        │  Realtime (leaderboards, announcements)   Storage (avatars/CSV) │
        │  Edge Functions (scoring · CSV import · push fan-out+suppress)  │
        └───────────────┬────────────────────────────────────────────────┘
                        │  Edge Function calls OneSignal REST API
                        ▼
              OneSignal  →  FCM / APNs / Web Push   (free at this scale)
```

**Principle:** the client holds **no** authority. Every read/write is gated by RLS in the database, so a tampered client or a leaked API key cannot see or change data the user isn't allowed to. Auth is **not** duplicated in a second service — the Supabase-issued JWT flows straight into the RLS policies.

---

## 2. Domain model (from the mockup)

| Entity | Source in mockup | Notes |
|---|---|---|
| **Department** | `data.departments` (5) | edu, pr, youth, fin, hr. **IT is not a department** — it's a coordination unit (red tag); `org` is the whole-org pseudo-scope. |
| **Role** | `data.roles` (8) | recrut(0) · voluntar(1) · activ(2) · vot(3) · responsabil(4) · bce(5) · bc(6) · moderator(9). The number is the **level** used for permission thresholds. |
| **Member (profile)** | `data.accounts` + `data.volunteers` | One person. Belongs to **one or more** departments and teams. Has a role, status, points, tier. |
| **Team** | `data.teams` | Belongs to a department; has a lead; `for_recruits` and `is_interne` flags. |
| **Task** | `data.tasks` | difficulty 1–5, rating 1–5 (null until graded), status, deadline, dept/team, many assignees, `open` = unassigned first-taker. |
| **Points entry** | derived from tasks + `taskRequests` | The ledger that sums to a member's points (source of truth for leaderboards / dept cup / AG). |
| **Task request** | `data.taskRequests` | Award-points or new-task proposals awaiting approval. |
| **Event** | `data.events` | type, scope (team/dept/project/org), date/time, capacity, QR check-in. |
| **Announcement** | `data.announcements` | priority critical/important/normal, pinned, optional form link. |
| **Notification** | `data.notifications` | per recipient; kind announce/deadline/event/task; per-role suppression. |
| **AG sheets (Interne)** | `data.agThreshold` | Two derived sheets for VP Interne: AG-eligibility (≥300 pts) and top-25% quorum. |
| **Scoring config** | `data.ratingGuide`, `difficultyGuide` | Lookup tables powering the points guide. |

---

## 3. Database schema (PostgreSQL)

Presented as migration-ready DDL. Identity/`auth.users` is provided by Supabase Auth.

### 3.1 Enums & lookups

```sql
create type member_role     as enum ('recrut','voluntar','activ','vot','responsabil','bce','bc','moderator');
create type member_status   as enum ('activ','inactiv','alumni');
create type task_status      as enum ('todo','progress','done','overdue','open');
create type event_type       as enum ('sedinta','activitate','call','eveniment','deadline','recrutare');
create type event_scope      as enum ('team','dept','project','org');
create type announce_priority as enum ('critical','important','normal');
create type noti_kind        as enum ('announce','deadline','event','task','system');
create type request_kind     as enum ('award','new_task');
create type request_status   as enum ('pending','approved','rejected');

-- Roles & their level (drives capability thresholds)
create table roles (
  id     member_role primary key,
  name   text not null,
  level  int  not null
);
insert into roles (id,name,level) values
  ('recrut','Recrut',0),('voluntar','Voluntar',1),('activ','Membru Activ',2),
  ('vot','Membru cu Drept de Vot',3),('responsabil','Responsabil de proiect',4),
  ('bce','BCE',5),('bc','BC',6),('moderator','Moderator',9);

-- Departments (5) + the IT coordination unit + the org pseudo-unit
create table departments (
  id    text primary key,                 -- 'edu','pr','youth','fin','hr','it','org'
  name  text not null,
  short text not null,
  color text not null,
  kind  text not null default 'department' -- 'department' | 'coordination' | 'org'
);

-- Scoring config (the points guide)
create table rating_guide (
  rating int primary key check (rating between 1 and 5),
  multiplier int not null,                 -- 1→-1, 2→0, 3→1, 4→2, 5→3
  label text not null, note text
);
create table difficulty_guide (
  stars int primary key check (stars between 1 and 5),
  note  text
);
```

### 3.2 Members, departments, teams

```sql
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text not null,
  email        text unique not null,
  phone        text,
  avatar_color text,
  role         member_role not null default 'recrut',
  status       member_status not null default 'activ',
  joined_year  int,
  tier         text,                       -- display tier; can be derived from points+role
  created_at   timestamptz not null default now()
);

create table member_departments (         -- many-to-many (a member can be in several depts)
  member_id uuid references profiles(id) on delete cascade,
  dept_id   text references departments(id),
  primary key (member_id, dept_id)
);

create table teams (
  id           text primary key,
  name         text not null,
  dept_id      text references departments(id),
  lead_id      uuid references profiles(id),
  for_recruits boolean not null default false,
  is_interne   boolean not null default false
);
create table team_members (
  team_id   text references teams(id) on delete cascade,
  member_id uuid references profiles(id) on delete cascade,
  primary key (team_id, member_id)
);
```

### 3.3 Tasks & the points engine

```sql
-- rating → multiplier (immutable so it can drive a generated column)
create or replace function rating_mult(r int) returns int
  immutable language sql as
$$ select case r when 1 then -1 when 2 then 0 when 3 then 1 when 4 then 2 when 5 then 3 else 0 end $$;

create table tasks (
  id          bigint generated always as identity primary key,
  title       text not null,
  type        text,
  dept_id     text references departments(id),
  team_id     text references teams(id),
  status      task_status not null default 'todo',
  difficulty  int not null check (difficulty between 1 and 5),
  rating      int check (rating between 1 and 5),     -- null until graded
  points      int generated always as (difficulty * coalesce(rating_mult(rating),0)) stored,
  deadline    date,
  description text,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create table task_assignees (
  task_id   bigint references tasks(id) on delete cascade,
  member_id uuid references profiles(id) on delete cascade,
  primary key (task_id, member_id)
);

-- The single source of truth for a member's points.
-- A trigger on tasks writes one row per assignee when a task is graded (rating set / changed).
create table points_ledger (
  id         bigint generated always as identity primary key,
  member_id  uuid references profiles(id) on delete cascade,
  delta      int not null,
  reason     text not null,            -- 'task','manual_award','penalty',...
  task_id    bigint references tasks(id),
  awarded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- Award-points / new-task proposals awaiting approval (data.taskRequests)
create table task_requests (
  id         bigint generated always as identity primary key,
  kind       request_kind not null,
  title      text not null,
  from_member uuid references profiles(id),
  dept_id    text references departments(id),
  points     int,
  note       text,
  status     request_status not null default 'pending',
  decided_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
```

**Derived values (SQL views — never stored, always correct):**

```sql
create view member_points as
  select p.id as member_id, coalesce(sum(l.delta),0) as points
  from profiles p left join points_ledger l on l.member_id = p.id
  group by p.id;

create view leaderboard as
  select mp.member_id, pr.full_name, pr.role, mp.points,
         rank() over (order by mp.points desc) as rank
  from member_points mp join profiles pr on pr.id = mp.member_id
  where pr.status = 'activ';

create view dept_cup as
  select d.id as dept_id, d.name, coalesce(sum(mp.points),0) as points,
         count(distinct md.member_id) as members
  from departments d
  join member_departments md on md.dept_id = d.id
  join member_points mp on mp.member_id = md.member_id
  where d.kind = 'department'
  group by d.id, d.name
  order by points desc;
```

### 3.4 Events, announcements, notifications

```sql
create table events (
  id          bigint generated always as identity primary key,
  title       text not null,
  type        event_type not null,
  dept_id     text references departments(id),
  team_id     text references teams(id),
  scope       event_scope not null,
  starts_at   timestamptz, ends_at timestamptz,
  location    text, capacity int, has_qr boolean default false,
  description text, created_by uuid references profiles(id)
);
create table event_attendance (
  event_id   bigint references events(id) on delete cascade,
  member_id  uuid references profiles(id) on delete cascade,
  status     text not null default 'going',   -- going | declined
  checked_in boolean default false,
  primary key (event_id, member_id)
);

create table announcements (
  id           bigint generated always as identity primary key,
  title text not null, body text not null,
  dept_id      text references departments(id),
  author       text,
  priority     announce_priority not null default 'normal',
  category     text, pinned boolean default false, form_label text,
  published_at timestamptz not null default now(),
  created_by   uuid references profiles(id)
);
create table announcement_reads (
  announcement_id bigint references announcements(id) on delete cascade,
  member_id       uuid references profiles(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, member_id)
);

create table notifications (
  id         bigint generated always as identity primary key,
  member_id  uuid references profiles(id) on delete cascade,  -- recipient
  kind       noti_kind not null,
  icon       text, title text not null, body text,
  critical   boolean default false, read boolean default false,
  link       text, created_at timestamptz not null default now()
);

-- Per-role notification suppression (BC don't get task/event/deadline)
create table notif_suppression ( role member_role, kind noti_kind, primary key (role,kind) );
insert into notif_suppression values ('bc','task'),('bc','event'),('bc','deadline');

-- Push delivery tokens (per device)
create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references profiles(id) on delete cascade,
  token text not null, platform text not null,   -- ios | android | web
  unique (member_id, token)
);
```

### 3.5 AG / Interne sheets (derived)

```sql
-- data.agThreshold: required=300 (AG eligibility), agQuorum=25 (top 25% keep voting)
create view ag_eligibility as
  select pr.id, pr.full_name, pr.role, mp.points, (mp.points >= 300) as eligible
  from profiles pr join member_points mp on mp.member_id = pr.id
  where pr.status = 'activ'
  order by mp.points desc;

create view ag_quorum_top25 as
  with ranked as (
    select id, full_name, points,
           percent_rank() over (order by points desc) as pr
    from ag_eligibility where eligible)
  select id, full_name, points, (pr <= 0.25) as keeps_vote from ranked;
```

---

## 4. Roles, capabilities & RBAC

### 4.1 Capabilities (from `state.js` `OSUBB.cap`)

The mockup's capability lists map cleanly onto **role level thresholds**:

| Capability | Mockup list | Threshold |
|---|---|---|
| `seeAllEvents` (full calendar) | responsabil, bce, bc, moderator | **level ≥ 4** |
| `manageTasks` (create tasks / award points) | responsabil, bce, bc, moderator | **level ≥ 4** |
| `createTeams` | bce, bc, moderator | **level ≥ 5** |
| `seeAllSheets` (all Fișele) | bc, moderator | **level ≥ 6** |
| `seeInterne` (VP Interne sheets) | bc, moderator | **level ≥ 6** |
| `manageRoles` | bc, moderator | **level ≥ 6** |
| `noTaskNotifs` | bc only | **role = 'bc'** (a notification *preference*, not a privilege — moderator still sees all) |

Store these in a small lookup so they're configurable without code changes:

```sql
create table role_capabilities ( role member_role, capability text, primary key (role,capability) );
-- seeded from the table above
```

### 4.2 Custom JWT claims (the performance key)

A Supabase **custom access-token hook** copies the user's role, level, dept ids, and team ids into the JWT at login, so RLS policies read them from the token instead of re-querying every row:

```jsonc
// app_metadata inside the JWT
{ "member_role": "bce", "member_level": 5,
  "dept_ids": ["it"], "team_ids": ["t-app","t-sites"] }
```

```sql
create or replace function auth_level() returns int language sql stable as
$$ select coalesce((auth.jwt() -> 'app_metadata' ->> 'member_level')::int, 0) $$;

create or replace function auth_role() returns member_role language sql stable as
$$ select (auth.jwt() -> 'app_metadata' ->> 'member_role')::member_role $$;

create or replace function auth_in_dept(d text) returns boolean language sql stable as
$$ select coalesce(auth.jwt() -> 'app_metadata' -> 'dept_ids' ? d, false) $$;

create or replace function auth_in_team(t text) returns boolean language sql stable as
$$ select coalesce(auth.jwt() -> 'app_metadata' -> 'team_ids' ? t, false) $$;
```

### 4.3 RLS policy matrix

`SELF` = the row's own member; `level≥N` = `auth_level() >= N`. All tables have RLS **enabled** with deny-by-default.

| Table | SELECT (read) | INSERT / UPDATE / DELETE (write) |
|---|---|---|
| **profiles** | Everyone reads basic profile fields; full contact details only SELF or `level≥5` | SELF may edit own profile (not role/points); `level≥6` may edit roles |
| **member_departments / team_members** | Everyone (needed for visibility checks) | `level≥5` (BCE+ manage teams) |
| **tasks** | SELF if assigned; members of the task's dept/team; `level≥4` see all | Create/grade: `level≥4`. `open` tasks: any member may claim (insert into `task_assignees`) |
| **task_assignees** | Same as parent task | `level≥4`, or SELF claiming an `open` task |
| **points_ledger** | SELF reads own; `level≥4` read their dept; `level≥6` read all | Insert only via graded-task trigger or `level≥4` manual award |
| **task_requests** | SELF (author) + `level≥4` of the dept | Insert: any member. Decide (approve/reject): `level≥4` |
| **events** | **Calendar visibility rule** (see 4.4) | Create/edit: `level≥4` |
| **event_attendance** | SELF + event managers (`level≥4`) | SELF (RSVP / check-in for own row) |
| **announcements** | Everyone reads | Create/edit: `level≥4` |
| **announcement_reads** | SELF | SELF |
| **notifications** | SELF only, **minus** suppressed kinds for the user's role | Insert: server (Edge Function) only |
| **ag_eligibility / ag_quorum (Interne)** | `level≥6` only (`seeInterne`) | — (derived views) |
| **volunteers list (profiles as directory)** | `level≥5` (BCE+) — matches `OSUBB.access.volunteers` | — |
| **bc panel data** | `level≥6` — matches `OSUBB.access.bcpanel` | — |

### 4.4 Key policies (SQL sketches)

```sql
-- TASKS: see your own, your dept/team's, or everything if level≥4
alter table tasks enable row level security;
create policy task_read on tasks for select using (
     auth_level() >= 4
  or auth_in_dept(dept_id)
  or (team_id is not null and auth_in_team(team_id))
  or exists (select 1 from task_assignees ta
             where ta.task_id = tasks.id and ta.member_id = auth.uid())
);
create policy task_write on tasks for all using (auth_level() >= 4) with check (auth_level() >= 4);

-- EVENTS: mirror OSUBB.eventVisible()
create policy event_read on events for select using (
     auth_level() >= 4                                  -- seeAllEvents
  or scope = 'org' or type in ('call','recrutare')      -- everyone
  or (scope = 'dept' and auth_in_dept(dept_id))
  or (team_id is not null and (
        auth_in_team(team_id)
        or (auth_role() = 'recrut'
            and exists (select 1 from teams t where t.id = events.team_id and t.for_recruits))))
  or (team_id is null and auth_in_dept(dept_id))
);

-- NOTIFICATIONS: only mine, and not the kinds my role suppresses (BC → no task/event/deadline)
create policy noti_read on notifications for select using (
  member_id = auth.uid()
  and not exists (select 1 from notif_suppression s
                  where s.role = auth_role() and s.kind = notifications.kind)
);
```

> **Why this is safe:** even if a client requests `/tasks`, Postgres applies `task_read` and returns only permitted rows. The 8×5 logic lives in **one place** (the database), not scattered across screens.

---

## 5. Mockup screen → data mapping

| Screen (view file) | Reads | Writes | Gating |
|---|---|---|---|
| **Dashboard** (`dashboard.js`) | `leaderboard`, `dept_cup`, own `member_points`, upcoming `events`, recent `announcements` | — | all roles (own data) |
| **Task Tracker** (`tasktracker.js`) | `tasks` (+assignees), `points_ledger`, `rating_guide`, `difficulty_guide` | create task, grade task (→ ledger), claim `open` task | tabs by capability: *mine*/*open* (all), *manage* (`level≥4`), *sheets* (`level≥6`), *interne* (`level≥6`) |
| **Calendar** (`calendar.js`) | `events` via `event_read` policy | RSVP, QR check-in (`event_attendance`) | role-based visibility (4.4) |
| **Announcements** (`announcements.js`) | `announcements`, `announcement_reads` | mark read; create (`level≥4`) | all read; create gated |
| **Volunteers** (`volunteers.js`) | `profiles` directory + `member_points` | edit member, **CSV import** | `level≥5` (`OSUBB.access.volunteers`) |
| **Profile** (`profile.js`) | own `profiles`, `member_points`, tier/promo | edit own contact info; theme is client-side | SELF |
| **BC Panel** (`bcpanel.js`) | `ag_eligibility`, `ag_quorum_top25`, role management, CSV import | change roles (`manageRoles`), import recruits | `level≥6` (`OSUBB.access.bcpanel`) |
| **Notifications** (`notifications.js`) | `notifications` via `noti_read` policy | mark read | SELF, BC-suppressed kinds hidden |

### 5.1 CSV recruit import (`bcpanel.js` `openCsvImport`)

1. BC/Moderator uploads a CSV (name, email, dept, team) to a Supabase **Storage** bucket.
2. An **Edge Function** parses it, calls the Auth Admin API to create one `auth.users` per recruit (role `recrut`, random temp password or magic-link invite), inserts `profiles` + `member_departments` + `team_members`.
3. Returns a summary (created / skipped / errors). Gated to `level≥6`.

### 5.2 Push notification flow with per-role suppression (via OneSignal)

1. On login the app registers the device with **OneSignal** and tags it with the member's `role` and `dept_ids`. Store the OneSignal player/subscription id on `push_tokens` (keep `platform`); OneSignal manages the underlying FCM/APNs/Web-Push tokens.
2. A DB event (new announcement, deadline, etc.) triggers an **Edge Function**.
3. The function computes the recipient set, **excludes** anyone whose role suppresses that `kind` (join `notif_suppression`), writes the in-app `notifications` rows, and calls the **OneSignal REST API** to send — targeting either by role/department **tags** (suppression expressed as a filter) or by explicit player ids.
4. Per-role suppression is therefore one query against the same roles the RLS uses; OneSignal's console additionally lets coordinators compose/target announcements without code. (Alternative: skip OneSignal and POST to FCM/APNs directly from the Edge Function — same suppression query, more credential plumbing.)

---

## 6. Realtime usage (keep it within the cap)

Use Supabase Realtime only where live updates add real value: the **leaderboard / dept cup** and **critical announcements**. Everything else fetches on navigation (TanStack Query). This keeps concurrent socket count well under the free-tier 200 (Pro 500) limit even at 500 users.

---

## 7. Migrations, seeding & environments

- Schema lives in **Supabase CLI migration files** in git (no dashboard-clicking) → no drift across contributors.
- Seed the lookups (`roles`, `departments`, `rating_guide`, `difficulty_guide`, `role_capabilities`, `notif_suppression`) from the mockup's `data.js` values.
- Two Supabase projects: **staging** (free) and **production** (Pro). CI applies migrations to staging on merge; production migrations are a manual gated step.
- A **per-role integration test suite** (Playwright + a test user per role) asserts each role sees exactly the rows the matrix in §4.3 allows — run in CI before any deploy.

---

## 8. Open decisions for the team

These don't block the design (the backend is frontend-agnostic) but should be confirmed before Phase 0:

1. **Frontend framework: Capacitor + React + Ionic (recommended) vs Flutter (co-leader).** Recommend Capacitor because the dominant surface is a dense browser-delivered admin dashboard where real DOM/CSS + a web data grid (AG Grid Community) win. Pick **Flutter** instead only if you'll ship the coordinator desktop as a *free native* Windows/macOS app, or expect the mobile app to grow truly native. (Expo/React Native is not recommended — RN Web would force a second web codebase.) See tech-stack §9.1.
2. **PWA-only launch vs native from day one** — recommend PWA-first to defer store fees and ship faster.
3. **Push provider: OneSignal (recommended) vs raw FCM/APNs.** OneSignal gives a per-role/department targeting console and is free at this scale; raw FCM/APNs avoids a third-party processor (simpler GDPR story) at the cost of building targeting yourself. Suppression logic is identical either way (§5.2).
4. **Tier/promotion automation** — should promotions (e.g. "Voluntar after 6 months", "top 35% → Membru Activ") run automatically as scheduled jobs (`pg_cron` / Edge Function), or stay manual decisions surfaced to BC? The schema supports both; recommend manual-with-suggestions first.
5. **Account creation** — Google OAuth domain restriction (only `@osubb.ro`?) and whether recruits get magic-link invites vs temp passwords.
6. **Data retention** — what happens to a member's points/history when they leave (status `alumni` keeps history; hard-delete wipes it).

---

## 9. Next step

On approval, the next deliverable is the **implementation plan** (writing-plans): the ordered, test-backed task breakdown for Phase 0 — repo scaffold, Supabase project + migrations, auth + the first RLS policies, and porting the first screen (Task Tracker) end-to-end.
