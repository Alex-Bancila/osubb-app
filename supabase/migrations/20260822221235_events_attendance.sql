-- 20260822221235_events_attendance.sql
-- OSUBB backend — Epic 1.5a: calendar events + RSVP.
-- Source of truth: docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md (§3.4)
-- Tested by supabase/tests/events_attendance.test.sql.
--
-- Two small hardenings over the §3.4 sketch, both flagged in the PR:
--   * event_attendance.status gets a check constraint ('going' | 'declined') —
--     the spec documents those values in a comment only, and an unconstrained
--     text column invites typos from the client.
--   * events gets a sane-interval check (ends_at >= starts_at).
-- Revision 3 §9.3 also plans events.status (scheduled | cancelled) as a **P2**
-- delta (conflict C4: change/cancel + notify) — deliberately NOT added here.

create table events (
  id          bigint generated always as identity primary key,
  title       text not null,
  type        event_type  not null,
  dept_id     text references departments (id),
  team_id     text references teams (id),
  scope       event_scope not null,
  starts_at   timestamptz,
  ends_at     timestamptz,
  location    text,
  capacity    int,
  has_qr      boolean default false,
  description text,
  created_by  uuid references profiles (id),
  constraint events_interval_ck check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

-- One row per (event, member): the primary key is what makes a double RSVP
-- impossible at the database level rather than by client-side discipline.
create table event_attendance (
  event_id   bigint references events (id) on delete cascade,
  member_id  uuid references profiles (id) on delete cascade,
  status     text not null default 'going',
  checked_in boolean default false,
  primary key (event_id, member_id),
  constraint event_attendance_status_ck check (status in ('going', 'declined'))
);

-- Indexes for the calendar-visibility policy (Epic 3.4) and the upcoming-events query.
create index events_dept_idx            on events (dept_id);
create index events_team_idx            on events (team_id);
create index events_starts_at_idx       on events (starts_at);
create index event_attendance_member_idx on event_attendance (member_id);

-- RLS on from birth: deny-by-default for anon/authenticated until Epic 3.4.
alter table events           enable row level security;
alter table event_attendance enable row level security;
