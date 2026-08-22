-- 20260822221458_announcements.sql
-- OSUBB backend — Epic 1.5b: announcements feed + read receipts.
-- Source of truth: docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md (§3.4)
-- Tested by supabase/tests/announcements.test.sql.
--
-- `dept_id is null` means an org-wide announcement (the feed's default reach);
-- a dept id narrows it to that department. `form_label` + `link` carry the v1
-- forms story: announcements link out to Google Forms until the native forms
-- engine arrives (Phase 4) — see spec Revision 3 §9.4.

create table announcements (
  id           bigint generated always as identity primary key,
  title        text not null,
  body         text not null,
  dept_id      text references departments (id),          -- null = org-wide
  author       text,                                       -- display byline ("BC", "Echipa PR")
  priority     announce_priority not null default 'normal',
  category     text,
  pinned       boolean not null default false,
  form_label   text,                                       -- e.g. "Completează formularul"
  form_url     text,
  published_at timestamptz not null default now(),
  created_by   uuid references profiles (id),
  -- A label with no destination is a dead button, a link with no label is
  -- unclickable copy: the pair travels together or not at all.
  constraint announcements_form_ck check ((form_url is null) = (form_label is null))
);

-- One row per (announcement, member): the primary key makes a read receipt
-- idempotent — the client can "mark as read" as often as it likes.
create table announcement_reads (
  announcement_id bigint references announcements (id) on delete cascade,
  member_id       uuid references profiles (id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, member_id)
);

-- Feed order (pinned first, then newest) and the per-member unread query.
create index announcements_published_idx on announcements (published_at desc);
create index announcements_dept_idx      on announcements (dept_id);
create index announcement_reads_member_idx on announcement_reads (member_id);

-- RLS on from birth: deny-by-default for anon/authenticated until Epic 3.5.
alter table announcements      enable row level security;
alter table announcement_reads enable row level security;
