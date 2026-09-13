-- #291: the ordered candidate queue for public-mode Tasks. A Member joins by
-- inserting a 'pending' row; the queue order is (joined_at, id) — ties on
-- joined_at (two candidates in the same millisecond) still resolve
-- deterministically because id always breaks the tie. Leaving is not an
-- update-in-place: withdrawing sets status = 'withdrawn' on that row and a
-- rejoin inserts a brand-new 'pending' row, so the withdrawn row survives as
-- history.
--
-- "Live" (issue #291's AC: "a member has at most one live candidature per
-- Task") means pending only: the partial unique index below covers
-- status = 'pending' alone, not 'selected'. A 'selected' row is permanent
-- history of a past Assignment; once that Assignment ends (gave up,
-- replaced) the member must be able to queue again, and ADR-0007 does not
-- forbid it. So a member can hold a 'selected' row (history) and a new
-- 'pending' row (a fresh candidature) for the same Task at the same time —
-- only two 'pending' rows for the same (task, member) collide.
--
-- Command invariants enforced by the atomic commands in #330/#333, not
-- schema:
--   - only public Tasks may queue;
--   - the current Executor cannot also be a pending candidate for their own
--     Task.
-- This table has no foreign key or check tying it to tasks.assignment_mode
-- or to task_assignments' active row, on purpose: schema cannot see "the
-- task is currently public" or "this member is not the current Executor"
-- without re-deriving state a command already holds locked. Do not add such
-- a constraint here; extend the command instead.
--
-- decided_by records who resolved the candidature, and the decision-shape
-- check says who is required for each resolved status: 'withdrawn' requires
-- decided_by (the member themself — a command stamps auth.uid(), since a
-- Member withdraws their own candidature); 'selected' requires decided_by
-- (unchanged — a manager or the selection command's actor); 'closed' leaves
-- decided_by unconstrained (null or set) because the queue can close itself
-- automatically when the Task completes or is cancelled (no human decider),
-- or a manager can close it explicitly.
--
-- Grants: no command writes this table yet (#330/#333 land later), so
-- `authenticated` gets nothing, same deny-by-default shape #292 gave
-- task_activity and #289 gave task_assignments while each awaited its
-- write/read path. Unlike task_activity, no server job (e.g. the deadline
-- job) appends rows here directly, and once #330/#333 exist their commands
-- are security definer functions owned by the table owner — not run as
-- service_role — so service_role never needs INSERT/UPDATE/DELETE either.
-- It keeps SELECT only, so a service-key job (queue-closing side effects,
-- future notification fan-out) can read queue state directly ahead of
-- #319's authenticated-facing read policy.
create table public.task_candidates (
  id            bigint generated always as identity primary key,
  task_id       bigint not null references public.tasks (id),
  member_id     uuid not null references public.profiles (id) on delete cascade,
  status        text not null default 'pending'
                constraint task_candidates_status_ck check (status in ('pending','selected','withdrawn','closed')),
  joined_at     timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references public.profiles (id),
  assignment_id bigint references public.task_assignments (id),
  created_at    timestamptz not null default now(),
  constraint task_candidates_decision_shape_ck check (
       (status = 'pending'   and decided_at is null     and decided_by is null and assignment_id is null)
    or (status = 'withdrawn' and decided_at is not null and decided_by is not null and assignment_id is null)
    or (status = 'closed'    and decided_at is not null and assignment_id is null)
    or (status = 'selected'  and decided_at is not null and decided_by is not null and assignment_id is not null)),
  constraint task_candidates_chronology_ck check (decided_at is null or decided_at >= joined_at)
);

create unique index task_candidates_one_pending_per_member_uidx
  on public.task_candidates (task_id, member_id) where status = 'pending';
create index task_candidates_queue_order_idx
  on public.task_candidates (task_id, joined_at, id) where status = 'pending';
create index task_candidates_member_idx on public.task_candidates (member_id);

alter table public.task_candidates enable row level security;

revoke all on table public.task_candidates from public, anon, authenticated, service_role;
revoke all on sequence public.task_candidates_id_seq from public, anon, authenticated, service_role;
grant select on table public.task_candidates to service_role;
-- service_role has SELECT only on the table, never INSERT, so it never
-- allocates an id here — it gets nothing on the sequence either.

comment on table public.task_candidates is
  'Ordered queue of Members interested in a public-mode Task; queue order is (joined_at, id). A rejoin after withdrawal is a new row, not an update. "Live" means pending only — a past selected row does not block a later pending one.';

comment on column public.task_candidates.status is
  'pending: queued and waiting. selected: chosen as Executor (assignment_id set). withdrawn: left voluntarily. closed: queue closed without selecting this candidate.';

comment on column public.task_candidates.decided_by is
  'Who resolved this candidature. withdrawn/selected: always set (the withdrawing member, or the selector). closed: set only when a manager closed it manually; null when the queue closed automatically. Null while pending.';

comment on column public.task_candidates.assignment_id is
  'The Task Assignment created when this candidate was selected; set only when status = selected.';
