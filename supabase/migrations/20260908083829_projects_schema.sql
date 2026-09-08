-- #268: projects are independent Task Tracker origins.
--
-- This migration adds only the project lifecycle row. Memberships, read
-- policies, lifecycle commands, seed data, and task relationships are separate
-- issues. RLS starts deny-by-default so this intermediate state is safe in
-- staging after merge.

create table public.projects (
  id         bigint generated always as identity primary key,
  name       text not null,
  status     text not null default 'active',
  leader_id  uuid not null references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint projects_name_not_blank
    check (btrim(name) <> ''),
  constraint projects_status_valid
    check (status in ('active', 'archived')),
  constraint projects_timestamps_ordered
    check (updated_at >= created_at)
);

comment on table public.projects is
  'Independent OSUBB projects. Membership, management commands, and task origins are added by later migrations.';
comment on column public.projects.status is
  'Lifecycle state: active or archived. Archive preserves project history.';
comment on column public.projects.leader_id is
  'The active project lead. A later invariant also guarantees a project_members row.';

alter table public.projects enable row level security;

create index projects_active_idx
  on public.projects (created_at desc, id)
  where status = 'active';
create index projects_leader_idx
  on public.projects (leader_id);
create index projects_created_by_idx
  on public.projects (created_by);

-- Mirror the repository's explicit least-privilege posture. Authenticated DML
-- grants make future policies/RPCs possible, but with no policies in this
-- migration every client operation is currently denied by RLS.
revoke all on table public.projects from anon;
revoke all on sequence public.projects_id_seq from anon;
revoke truncate, references, trigger on table public.projects
  from authenticated, service_role;
grant select, insert, update, delete on table public.projects
  to authenticated, service_role;
grant usage, select on sequence public.projects_id_seq
  to authenticated, service_role;
