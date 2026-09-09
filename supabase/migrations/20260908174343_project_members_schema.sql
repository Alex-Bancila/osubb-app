-- #269: project membership foundation.
--
-- This migration adds only the membership row and its storage invariants.
-- Lead/Responsible membership enforcement, read policies, management commands,
-- and demo memberships are deliberately handled by later issues.

create table public.project_members (
  project_id   bigint not null references public.projects (id) on delete cascade,
  member_id    uuid not null references public.profiles (id) on delete cascade,
  project_role text not null,

  primary key (project_id, member_id),
  constraint project_members_role_valid
    check (project_role in ('member', 'responsible'))
);

comment on table public.project_members is
  'Explicit memberships for independent OSUBB projects.';
comment on column public.project_members.project_role is
  'Role inside the project: member or responsible.';

alter table public.project_members enable row level security;

-- The primary key begins with project_id and supports project-roster lookups.
-- This reverse index supports a member's project list and later authorization
-- helpers without scanning every project roster.
create index project_members_member_idx
  on public.project_members (member_id, project_id);

-- Keep this migration self-contained even though the repository also defines
-- matching default privileges for future public tables.
revoke all on table public.project_members from anon;
revoke truncate, references, trigger on table public.project_members
  from authenticated, service_role;
grant select, insert, update, delete on table public.project_members
  to authenticated, service_role;
