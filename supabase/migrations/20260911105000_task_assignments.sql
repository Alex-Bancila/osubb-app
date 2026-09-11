create table public.task_assignments (
  id          bigint generated always as identity primary key,
  task_id     bigint not null references public.tasks (id),
  member_id   uuid not null references public.profiles (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles (id) on delete set null,
  end_reason  text constraint task_assignments_end_reason_check check (
    end_reason in (
      'gave_up',
      'replaced',
      'completed',
      'failed',
      'cancelled',
      'legacy_migration'
    )
  ),
  ended_at    timestamptz,
  end_note    text,
  constraint task_assignments_end_shape_check check (
    (
      ended_at is null
      and end_reason is null
      and end_note is null
    )
    or (
      ended_at is not null
      and end_reason is not null
    )
  ),
  constraint task_assignments_end_chronology_check check (
    ended_at is null or ended_at >= assigned_at
  ),
  constraint task_assignments_end_note_check check (
    end_note is null or btrim(end_note) <> ''
  )
);

create unique index task_assignments_one_active_per_task_uidx
  on public.task_assignments (task_id)
  where ended_at is null;

create index task_assignments_task_history_idx
  on public.task_assignments (task_id, assigned_at desc, id desc);

create index task_assignments_member_history_idx
  on public.task_assignments (member_id, assigned_at desc, id desc);

create index task_assignments_assigned_by_idx
  on public.task_assignments (assigned_by)
  where assigned_by is not null;

alter table public.task_assignments enable row level security;

revoke all on table public.task_assignments from public, anon, authenticated;
revoke all on sequence public.task_assignments_id_seq from public, anon, authenticated;
grant all on table public.task_assignments to service_role;
grant usage, select on sequence public.task_assignments_id_seq to service_role;

comment on table public.task_assignments is
  'Append-only history of the Members who served as a Task Executor; at most one row per Task is active.';

comment on column public.task_assignments.end_reason is
  'Why an Assignment ended. legacy_migration marks displaced legacy assignees whose real transition was not observed.';
