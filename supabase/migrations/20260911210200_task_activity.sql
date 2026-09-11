-- #292: append-only Task activity history. Every lifecycle transition and
-- queue event is recorded here; nothing may ever be rewritten, not even by a
-- security definer command, so the trigger below blocks UPDATE/DELETE for
-- every role including the table owner. Read policies are #319.

create table public.task_activity (
  id            bigint generated always as identity primary key,
  task_id       bigint not null references public.tasks (id),
  kind          text not null constraint task_activity_kind_ck check (kind in (
                  'created','content_updated','mode_converted','queue_opened','queue_closed',
                  'interest_expressed','interest_withdrawn','candidate_selected','executor_assigned',
                  'gave_up','started','submitted','returned_to_progress','evaluated','reopened',
                  'cancelled','duplicated','subtask_completed','unfulfilled')),
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
revoke all on table public.task_activity from public, anon, authenticated;
revoke all on sequence public.task_activity_id_seq from public, anon, authenticated;
grant all on table public.task_activity to service_role;
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
-- history, so this is enforced by trigger, not merely by revoking grants.
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
  'Blocks every UPDATE/DELETE on task_activity, including from security definer commands.';
