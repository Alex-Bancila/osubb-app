-- 20260822221721_notifications.sql
-- OSUBB backend — Epic 1.6a: in-app notifications.
-- Source of truth: docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md (§3.4)
-- Tested by supabase/tests/notifications.test.sql.
--
-- One row per (recipient × event) — notifications are written by the server
-- (fan-out trigger, issue #68; scheduled jobs, #69), never by clients: the
-- Epic 3.5 policy grants select/update-own only, no insert.
-- Phase-2 push (#70) delivers these same rows to devices, so nothing about
-- the shape changes when push arrives.

create table notifications (
  id         bigint generated always as identity primary key,
  member_id  uuid not null references profiles (id) on delete cascade,  -- recipient
  kind       noti_kind not null,
  icon       text,
  title      text not null,
  body       text,
  critical   boolean not null default false,
  read       boolean not null default false,
  link       text,                                   -- in-app route, e.g. '/tracker/12'
  created_at timestamptz not null default now()
);

-- The notification centre reads "mine, newest first"; the badge counts
-- "mine and unread" — a partial index keeps that count cheap as history grows.
create index notifications_member_created_idx on notifications (member_id, created_at desc);
create index notifications_unread_idx on notifications (member_id) where (not read);

-- RLS on from birth: deny-by-default for anon/authenticated until Epic 3.5,
-- where reads become self-only *minus* the kinds suppressed for the role.
alter table notifications enable row level security;
