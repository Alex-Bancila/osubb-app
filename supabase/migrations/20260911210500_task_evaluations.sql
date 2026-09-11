-- #316: append-only `task_evaluations` — the durable record of every Task
-- Evaluation (completed or unfulfilled) and its reversal. ADR-0007: Evaluation
-- sets Difficulty and Rating together; points = Difficulty × the Rating
-- multiplier; reopening reverses the ledger effect atomically; Evaluations
-- are preserved records, not overwritten. Writers are the evaluation
-- commands (later work); no read policy exists yet (#319).
--
-- Ruling 11 (2026-09-11), applied on top of dobrerares' comment on this
-- issue: two `source`s share this table, and the single-open-Evaluation
-- rule is scoped to only one of them.
--   - `command` (the default): every Evaluation the evaluation commands
--     (#336-#338) write for new work, plus the Evaluation
--     `approve_completed_work_request` (#344) creates under ADR-0007. A
--     command row always names its evaluator
--     (`task_evaluations_evaluator_ck`), and at most one command row per
--     Task may be open at a time
--     (`task_evaluations_one_open_per_task_uidx`) — ADR-0007's single
--     Executor, one live Evaluation.
--   - `legacy_migration`: reserved for #317's one-time backfill of pre-#316
--     demo/historical Tasks. dobrerares flagged two gaps while preparing
--     #290/#317: (1) the legacy demo Task "Migrare bază de date" has two
--     assignees and two legitimate ledger credits, so the backfill needs
--     one Evaluation per graded legacy Task/assignee pair — more than one
--     open Evaluation on that Task — which the original per-Task
--     uniqueness rejected outright; and (2) legacy records do not identify
--     an evaluator (the Task creator is not evidence), so a bare
--     `evaluated_by not null` would force #317 to invent one.
--
--   `source` lets both coexist without weakening either invariant: the
--   per-Task open-Evaluation cap now applies only to `command` rows;
--   `evaluated_by` may be null exclusively on `legacy_migration` rows
--   (`task_evaluations_evaluator_ck` — unknown historical evaluators are
--   represented as null, never invented); and a new per-Assignment cap
--   (`task_evaluations_one_open_per_assignment_uidx`) holds for both
--   sources unconditionally, so #290's two ended Assignments still bound
--   the backfill to exactly one open credit each — a single legacy credit
--   is never double-counted.
--
--   Two invariants this schema does not and cannot enforce are left to the
--   command layer: a command (#336-#338) must never write
--   `source = 'legacy_migration'` — only #317's backfill does, directly,
--   outside any command — and `reopen_task` must reverse every open
--   Evaluation of the Task, legacy ones included, before a new one is
--   created, so a reopened legacy-credited Task still converges on the
--   single-Executor model going forward.
--
-- `outcome` is `text … check (outcome in (...))`, not `public.task_status`:
-- three historical-data harnesses (tasks_lifecycle_upgrade.test.sh,
-- tasks_assignment_mode_upgrade.test.sh, tasks_audience_upgrade.test.sh)
-- drop and recreate that enum to replay its pre-#287 shape, and a
-- task_status-typed column here would have to be dropped and recreated in
-- all three, same as task_activity's from_status/to_status. A plain text
-- vocabulary avoids that coupling entirely — `completed`/`unfulfilled` are
-- Evaluation outcomes, not Task lifecycle statuses, so there is no reason to
-- tie them to that enum in the first place.
--
-- No CHECK enforces `points = difficulty * rating_mult(rating)`: a CHECK
-- re-validates on every later UPDATE of the row, and the one UPDATE this
-- table ever permits is a reversal — so a future change to the scoring
-- guide's multiplier would make reversing an old, already-scored Evaluation
-- impossible. The evaluation command computes `points` at insert time and is
-- solely trusted to get the formula right; see the column comment below.
--
-- The Evaluation must belong to the same Task as its Assignment. Postgres
-- foreign keys need a unique target, so `task_assignments` (dobrerares'
-- table, additive change) gains `unique (id, task_id)` alongside its
-- existing primary key, and `task_evaluations` references that pair —
-- inserting an Evaluation whose `assignment_id` belongs to a different
-- `task_id` fails the foreign key (23503), not a same-migration guess.
-- `assignment_id` carries no separate single-column foreign key of its own:
-- the composite `(assignment_id, task_id)` foreign key below already forces
-- `assignment_id` to exist in `task_assignments.id` (already unique via the
-- primary key), so a second, redundant relationship to the same table would
-- only give PostgREST two paths to embed `task_assignments` from
-- `task_evaluations` — ambiguous embedding (PGRST201) for the read APIs
-- coming in #318/#319.
alter table public.task_assignments
  add constraint task_assignments_id_task_id_key unique (id, task_id);

create table public.task_evaluations (
  id              bigint generated always as identity primary key,
  task_id         bigint not null references public.tasks (id),
  assignment_id   bigint not null,
  source          text not null default 'command'
                  constraint task_evaluations_source_ck check (
                    source in ('command', 'legacy_migration')),
  evaluated_by    uuid references public.profiles (id),
  outcome         text not null
                  constraint task_evaluations_outcome_ck check (
                    outcome in ('completed', 'unfulfilled')),
  difficulty      int not null
                  constraint task_evaluations_difficulty_ck check (
                    difficulty between 1 and 5),
  rating          int not null
                  constraint task_evaluations_rating_ck check (
                    rating between 1 and 5),
  points          int not null,
  note            text not null
                  constraint task_evaluations_note_ck check (
                    note ~ '[^[:space:]]'),
  evaluated_at    timestamptz not null default now(),
  reversed_at     timestamptz,
  reversed_by     uuid references public.profiles (id),
  reversal_reason text,
  created_at      timestamptz not null default now(),
  -- The reversal trio is all-or-nothing: an Evaluation is either still in
  -- effect (all three null) or reversed (all three set, with a non-blank
  -- reason) — never half-reversed.
  constraint task_evaluations_reversal_shape_ck check (
    (reversed_at is null and reversed_by is null and reversal_reason is null)
    or (
      reversed_at is not null
      and reversed_by is not null
      and reversal_reason is not null
      and reversal_reason ~ '[^[:space:]]'
    )
  ),
  constraint task_evaluations_reversal_chronology_ck check (
    reversed_at is null or reversed_at >= evaluated_at
  ),
  -- Unknown historical evaluators are represented as null only on
  -- legacy_migration rows (see the header comment) — never invented, and
  -- never permitted on a command row.
  constraint task_evaluations_evaluator_ck check (
    source = 'legacy_migration' or evaluated_by is not null
  ),
  -- Ties this Evaluation's Task to the same Task its Assignment belongs to,
  -- and is the only foreign key to task_assignments this table declares
  -- (see the header comment on why assignment_id has no single-column FK).
  foreign key (assignment_id, task_id)
    references public.task_assignments (id, task_id)
);

-- At most one un-reversed *command* Evaluation per Task — reverse the old
-- one before recording a new one (ADR-0007: reopening reverses the ledger
-- effect atomically, it does not leave two live Evaluations standing). This
-- is scoped to source = 'command': #317's legacy backfill records one
-- Evaluation per graded legacy Task/assignee pair (see the header comment),
-- so a multi-assignee legacy Task can carry more than one open
-- legacy_migration Evaluation at once, each tied to its own ended
-- Assignment from #290.
create unique index task_evaluations_one_open_per_task_uidx
  on public.task_evaluations (task_id)
  where reversed_at is null and source = 'command';

-- At most one un-reversed Evaluation per Assignment, regardless of source —
-- a given Assignment (a legacy credit or new work) is never double-counted
-- by two live Evaluations at once. This is what keeps #317's multi-assignee
-- backfill bounded: two open Evaluations may share a Task, but never an
-- Assignment.
create unique index task_evaluations_one_open_per_assignment_uidx
  on public.task_evaluations (assignment_id)
  where reversed_at is null;

-- Task-scoped history lookup (every Evaluation for a Task, reversed or not),
-- ordered the same way task_assignments/task_candidates order their own
-- per-Task history.
create index task_evaluations_task_history_idx
  on public.task_evaluations (task_id, evaluated_at desc, id desc);

alter table public.task_evaluations enable row level security;

-- No command writes this table yet (the evaluation commands land later in
-- #327-#345) and no read policy exists yet (#319), so the table starts fully
-- closed to `authenticated` — the same deny-by-default shape #289 gave
-- task_assignments and #292 gave task_activity while each awaited its own
-- write/read path. service_role is included in the revoke too:
-- 20260819171628_capabilities_and_rls.sql's default privileges hand every
-- new public table `arwd` to service_role automatically; that default must
-- be revoked explicitly, not merely left un-widened.
revoke all on table public.task_evaluations from public, anon, authenticated, service_role;
revoke all on sequence public.task_evaluations_id_seq from public, anon, authenticated, service_role;
-- service_role gets SELECT only: no server job appends Evaluations directly
-- (that is always a security definer command, running as the table owner,
-- not service_role), so it never needs INSERT/UPDATE/DELETE, and it never
-- allocates an id — the sequence grant stays fully revoked.
grant select on table public.task_evaluations to service_role;

comment on table public.task_evaluations is
  'Append-only record of every Task Evaluation (completed or unfulfilled) and its reversal. Difficulty and Rating are set together at Evaluation time and are preserved even after reversal (ADR-0007).';

comment on column public.task_evaluations.source is
  'command (default) or legacy_migration. New work always writes command — via the evaluation commands (#336-#338) or approve_completed_work_request (#344) — none of which may ever write legacy_migration themselves. legacy_migration is reserved for #317''s one-time backfill of pre-#316 demo/historical Tasks — see the migration header.';

comment on column public.task_evaluations.evaluated_by is
  'Evaluator profile. Required when source = command (task_evaluations_evaluator_ck). Null only on legacy_migration rows, where no historical evaluator can be identified — the Task creator is not evidence (dobrerares, #316) — so unknown is represented as null, never invented.';

comment on column public.task_evaluations.outcome is
  'completed or unfulfilled — an Evaluation outcome, deliberately not public.task_status (see the migration header).';

comment on column public.task_evaluations.points is
  'Points awarded, computed by the evaluation command as Difficulty × the Rating multiplier (ADR-0007, rating_mult()). Not a generated column and not CHECK-enforced against that formula here: see the migration header for why a formula CHECK would break reversing an old row after a future multiplier change.';

comment on column public.task_evaluations.note is
  'Evaluator narrative; required and must be non-blank.';

comment on column public.task_evaluations.reversed_at is
  'When this Evaluation was reversed (reopened). Null while the Evaluation is in effect. Set together with reversed_by and reversal_reason — never partially.';

comment on column public.task_evaluations.reversal_reason is
  'Required and non-blank once an Evaluation is reversed; null while un-reversed.';

-- Append-only with exactly one permitted transition: a security definer
-- reversal command may set the reversal trio once on a still-open row and
-- change nothing else about it. Every other UPDATE, and every DELETE, is
-- rejected — including from a security definer command, because this is
-- enforced by trigger, not merely by revoking grants. TRUNCATE is
-- deliberately left to the table owner by the grants above: after the
-- narrowing, no client or server role holds TRUNCATE on this table, so the
-- only way to run one is as the owner — who can drop or disable any trigger
-- anyway, so a statement-level TRUNCATE trigger would buy nothing (same
-- reasoning as task_activity's header, #292).
create function private.guard_task_evaluation_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '23514', message = 'task_evaluation_immutable';
  end if;

  -- tg_op = 'UPDATE': allowed only when the row is still open (old.reversed_at
  -- is null), the new row sets all three reversal columns together, and
  -- every other column — source included — is left exactly as it was.
  -- Comparing to_jsonb(new)/to_jsonb(old) with the reversal trio subtracted
  -- out, rather than naming every remaining column explicitly, means a
  -- column added to this table later stays immutable automatically, with no
  -- matching edit needed here.
  if old.reversed_at is null
     and new.reversed_at is not null
     and new.reversed_by is not null
     and new.reversal_reason is not null
     and (to_jsonb(new) - array['reversed_at', 'reversed_by', 'reversal_reason'])
         = (to_jsonb(old) - array['reversed_at', 'reversed_by', 'reversal_reason'])
  then
    return new;
  end if;

  raise exception using errcode = '23514', message = 'task_evaluation_immutable';
end;
$$;

create trigger task_evaluations_guard_change
  before update or delete on public.task_evaluations
  for each row
  execute function private.guard_task_evaluation_change();

revoke all on function private.guard_task_evaluation_change()
  from public, anon, authenticated, service_role;

comment on function private.guard_task_evaluation_change() is
  'Blocks every UPDATE/DELETE on task_evaluations except the single permitted reversal transition (setting reversed_at/reversed_by/reversal_reason together on a still-open row, every other column including source unchanged). TRUNCATE is left to the table owner by grants — see the table comment.';
