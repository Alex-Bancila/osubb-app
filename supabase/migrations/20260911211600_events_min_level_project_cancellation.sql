-- #369: ADR-0008 §Consequences — Project scope, Minimum Level, cancellation
-- state. Schema only: create_event / update_event authorization by scope
-- (#370, #248) and the retirement of team_admits_recruits (#372) are separate
-- issues. `team` scope keeps today's `dept_id not null` shape (Department
-- Teams only) — Independent-Team events, which have no Department, arrive
-- with #370's create_event rewrite, which relaxes this branch.
--
-- cancelled_by: NOT added. ADR-0008 §Consequences lists exactly Minimum
-- Level, Project support, cancellation state/reason, valid-scope
-- constraints, and indexes — no actor column. The codebase's own precedent
-- for a terminal-state timestamp/reason pair omits a matching actor column
-- on the same row: task_assignments.ended_at/end_reason has no ended_by,
-- and projects' archived status has no archived_by at all. Where this
-- repository does need to know who ended a lifecycle state, it uses a
-- dedicated append-only history table (task_activity.actor_id) rather than
-- a column on the mutable row — events have no such history table in this
-- stack, and adding one is out of #369's schema-only boundary. The command
-- that eventually cancels an Event (#248) is free to add cancelled_by, or
-- an events history table, alongside that work if it turns out to be
-- needed; adding an unpopulated actor column now, ahead of any writer, would
-- be speculative.

alter table public.events
  add column project_id   bigint references public.projects (id),
  add column min_level    integer not null default 0,
  add column cancelled_at timestamptz,
  add column cancel_reason text;

alter table public.events
  add constraint events_min_level_ck
    check (min_level in (0, 3, 4, 5, 6)),
  add constraint events_cancel_reason_ck
    -- Enforce all-or-nothing: either both null (not cancelled), or both set
    -- (cancelled with reason). A reason without a cancellation timestamp, or
    -- vice versa, is nonsensical. The reason itself must be nonblank: btrim()
    -- only strips ordinary spaces, so a tab-only or newline-only reason would
    -- slip through it. The POSIX character class `[^[:space:]]` catches all
    -- whitespace, per #162/#343 precedent. The explicit `cancel_reason is not
    -- null` guard ahead of the regex matters: `null ~ pattern` evaluates to
    -- null, not false, and a CHECK constraint only rejects a row when its
    -- expression is false — a bare `cancel_reason ~ '[^[:space:]]'` would let
    -- a cancellation with no reason through as "unknown" (same trap already
    -- fixed in completed_work_requests_rejected_shape_ck and
    -- points_ledger_sanction_shape_ck).
    check (
         (cancelled_at is null and cancel_reason is null)
      or (cancelled_at is not null and cancel_reason is not null and cancel_reason ~ '[^[:space:]]')
    );

alter table public.events drop constraint events_scope_fields_ck;
alter table public.events add constraint events_scope_fields_ck check (
     (scope = 'org'     and dept_id is null     and team_id is null     and project_id is null)
  or (scope = 'dept'    and dept_id is not null and team_id is null     and project_id is null)
  or (scope = 'team'    and dept_id is not null and team_id is not null and project_id is null)
  or (scope = 'project' and dept_id is null     and team_id is null     and project_id is not null)
);

create index events_project_idx on public.events (project_id);

-- events_starts_at_idx (starts_at) becomes a redundant leading-column prefix
-- of this composite index the moment it exists (#294's tracker_indexes.test.sql
-- checks for exactly this shape across all of `public`, not just Tracker
-- tables) — a query filtering on starts_at alone still uses this index's
-- leading column, so the single-column index is dropped rather than kept
-- alongside it.
drop index public.events_starts_at_idx;
create index events_starts_min_level_idx on public.events (starts_at, min_level);

comment on column public.events.project_id is
  'Project scope Origin. Exactly one of dept_id/team_id/project_id is set, per scope (events_scope_fields_ck).';
comment on column public.events.min_level is
  'ADR-0008 Minimum Level: 0 everyone, 3 AG/Voting Member+, 4 Responsible+, 5 BCE+, 6 BC+.';
comment on column public.events.cancelled_at is
  'Set together with cancel_reason when an Event is cancelled. Cancellation preserves the Event row and its RSVP history (ADR-0008).';
comment on column public.events.cancel_reason is
  'Set together with cancelled_at when an Event is cancelled. Both must be null (not cancelled) or both must be set (cancelled with nonblank reason), per events_cancel_reason_ck.';
