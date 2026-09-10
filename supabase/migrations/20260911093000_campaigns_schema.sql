create table public.campaigns (
  id            bigint generated always as identity primary key,
  department_id text not null references public.departments (id),
  name          text not null,
  is_active     boolean not null default true,
  created_by    uuid not null references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index campaigns_department_name_uidx
  on public.campaigns (department_id, lower(name));

alter table public.campaigns enable row level security;

create policy campaigns_read
  on public.campaigns
  for select
  to authenticated
  using (
    (select public.auth_is_member())
    and exists (
      select 1
        from public.profiles actor
       where actor.id = (select auth.uid())
         and actor.status = 'activ'
    )
  );

revoke all on table public.campaigns from public, anon, authenticated;
revoke all on sequence public.campaigns_id_seq from public, anon, authenticated;
grant select on table public.campaigns to authenticated;
grant all on table public.campaigns to service_role;
grant usage, select on sequence public.campaigns_id_seq to service_role;

comment on table public.campaigns is
  'Department-owned labels for grouping Tasks. Campaigns are not Task Origins and have no members.';
