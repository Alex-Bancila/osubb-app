-- 20260822221922_notif_suppression_push_tokens.sql
-- OSUBB backend — Epic 1.6b: role-based notification suppression + push tokens.
-- Source of truth: spec §3.4 **as amended by Revision 3 §9.2 (resolution 2)**.
-- Tested by supabase/tests/notif_suppression.test.sql.
--
-- IMPORTANT — the spec §3.4 snippet seeds bc only. Revision 3 supersedes it:
-- suppression covers **bc AND bce** (the mandate's plan asks that both boards
-- receive only their own tasks' notifications). Six rows, not three.
--
-- Scope of suppression: BROADCAST notifications of these kinds. Notifications
-- about a member's OWN task are always delivered — the fan-out (#68/#69)
-- decides that, since only the sender knows whether a row is "yours"; this
-- table is the role-level default the Epic 3.5 read policy also enforces.

create table notif_suppression (
  role member_role references roles (id),
  kind noti_kind,
  primary key (role, kind)
);

insert into notif_suppression (role, kind)
select r.role, k.kind
  from (values ('bc'::member_role), ('bce'::member_role)) as r (role)
 cross join (values ('task'::noti_kind), ('event'::noti_kind), ('deadline'::noti_kind)) as k (kind);

-- Push delivery targets, one row per device. Phase 2 (#70) fills this; the
-- table exists now so the Epic 3.5 self-only policy can be written once.
create table push_tokens (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references profiles (id) on delete cascade,
  token      text not null,
  platform   text not null,
  created_at timestamptz not null default now(),
  unique (member_id, token),
  constraint push_tokens_platform_ck check (platform in ('ios', 'android', 'web'))
);

create index push_tokens_member_idx on push_tokens (member_id);

-- RLS on from birth. notif_suppression is reference data (readable by every
-- member from Epic 3.5 — the UI explains why a kind is muted); push_tokens
-- becomes strictly self-only in the same epic.
alter table notif_suppression enable row level security;
alter table push_tokens       enable row level security;
