-- #292: append-only Task activity history. Every lifecycle transition and
-- queue event is recorded here; nothing may ever be rewritten, not even by a
-- security definer command, so the trigger below blocks UPDATE/DELETE for
-- every role including the table owner. Read policies are #319.
--
-- task_activity.from_status/to_status are typed public.task_status. Three
-- historical-data harnesses drop and recreate that enum to replay its
-- pre-#287 shape: supabase/tests/tasks_lifecycle_upgrade.test.sh,
-- tasks_assignment_mode_upgrade.test.sh, and tasks_audience_upgrade.test.sh.
-- Any future task_status-typed column, on this table or another, must be
-- dropped in all three (each harness is a scratch begin/rollback
-- transaction, so dropping-and-never-recreating is safe) before the enum
-- drop, or the harness fails with "cannot drop type ... because other
-- objects depend on it".
--
-- TRUNCATE is deliberately left to the table owner: after the grant
-- narrowing below, no client or server role (public, anon, authenticated,
-- service_role) holds TRUNCATE on this table, so the only way to run one is
-- as the owner — and the owner can drop or disable any trigger anyway, so a
-- statement-level TRUNCATE trigger would buy nothing beyond the grants. The
-- row-level trigger below still guards UPDATE/DELETE, including from
-- security definer commands, because those aren't owner-gated the same way.

create table public.task_activity (
  id            bigint generated always as identity primary key,
  task_id       bigint not null references public.tasks (id),
  kind          text not null constraint task_activity_kind_ck check (kind in (
                  'created','content_updated','mode_converted','queue_opened','queue_closed',
                  'interest_expressed','interest_withdrawn','candidate_selected','executor_assigned',
                  'gave_up','started','submitted','returned_to_progress','evaluated','reopened',
                  'cancelled','duplicated','subtask_completed','unfulfilled','umbrella_completed')),
  actor_id      uuid references public.profiles (id),        -- null = system (deadline job)
  assignment_id bigint references public.task_assignments (id),
  from_status   public.task_status,
  to_status     public.task_status,
  note          text,
  details       jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index task_activity_task_timeline_idx on public.task_activity (task_id, occurred_at, id);
create index task_activity_actor_idx on public.task_activity (actor_id);

alter table public.task_activity enable row level security;

-- No command writes this table yet (that lands with the Candidate Queue and
-- atomic commands, #327-#345), and no read policy exists yet (#319), so the
-- table starts fully closed to `authenticated` — the same deny-by-default
-- shape #289 gave `task_assignments` while it awaited its own read policy.
-- service_role is included here too: 20260819171628_capabilities_and_rls.sql's
-- default privileges hand every new public table `arwd` (insert/select/
-- update/delete) to service_role automatically, same as authenticated. That
-- default must be revoked explicitly, not merely left un-widened, or
-- service_role keeps update/delete underneath the narrower grant below.
revoke all on table public.task_activity from public, anon, authenticated, service_role;
revoke all on sequence public.task_activity_id_seq from public, anon, authenticated, service_role;
-- service_role only ever appends rows for a server job (e.g. the deadline
-- job) and reads them back; it gets neither update/delete (the trigger
-- below blocks those anyway) nor truncate.
grant select, insert on table public.task_activity to service_role;
grant usage, select on sequence public.task_activity_id_seq to service_role;

comment on table public.task_activity is
  'Append-only history of every Task lifecycle event; rows are immutable once written.';

comment on column public.task_activity.actor_id is
  'Who caused the event; null means the system caused it (e.g. the deadline job).';

comment on column public.task_activity.assignment_id is
  'The Task Assignment this event concerns, when the event is Assignment-scoped.';

comment on column public.task_activity.details is
  'Event-specific structured payload; shape depends on kind.';

-- Immutability: even a security definer command must not be able to rewrite
-- history, so UPDATE/DELETE are enforced by trigger, not merely by revoking
-- grants. TRUNCATE is not covered here — see the header comment above for
-- why a statement-level TRUNCATE trigger isn't worth it once only the owner
-- can run one.
create function private.reject_task_activity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '23514', message = 'task_activity_immutable';
end;
$$;

create trigger task_activity_reject_change
  before update or delete on public.task_activity
  for each row
  execute function private.reject_task_activity_change();

revoke all on function private.reject_task_activity_change()
  from public, anon, authenticated, service_role;

comment on function private.reject_task_activity_change() is
  'Blocks every UPDATE/DELETE on task_activity, including from security definer commands. TRUNCATE is left to the table owner by grants — see the table comment.';
