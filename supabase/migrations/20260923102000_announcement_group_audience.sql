-- #581: announcements have a Group Origin and an independent Audience.
alter table public.announcements
  add column group_id bigint references public.groups(id),
  add column audience text not null default 'local'
    constraint announcements_audience_ck check (audience in ('local', 'org'));

update public.announcements as announcement
   set group_id = grp.id,
       audience = case when announcement.dept_id is null or announcement.dept_id = 'org'
                       then 'org' else 'local' end
  from public.groups as grp
 where grp.legacy_dept_id = coalesce(announcement.dept_id, 'org');

alter table public.announcements alter column group_id set not null;
create index announcements_group_idx on public.announcements(group_id);

-- dept_id remains historical until #590; new writes name group_id explicitly.

create function private.can_read_announcement(p_group_id bigint, p_audience text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.auth_is_member(), false)
     and private.actor_level() is not null
     and (p_audience = 'org'
          or (p_audience = 'local' and (
              (select auth.uid()) in (select private.group_audience(p_group_id))
              or private.group_role_of(p_group_id, (select auth.uid())) in ('manager', 'responsible')
          )));
$$;
revoke execute on function private.can_read_announcement(bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function private.can_read_announcement(bigint, text) to authenticated;

drop policy announcements_read on public.announcements;
drop policy announcements_manage on public.announcements;
create policy announcements_read on public.announcements
  for select to authenticated
  using (private.can_read_announcement(group_id, audience));
-- Keep read authority separate. A FOR ALL policy would also grant SELECT to
-- BC/Moderator by rank, leaking local announcements outside their audience.
create policy announcements_create on public.announcements
  for insert to authenticated
  with check (public.auth_is_member() and (
    private.can_manage_group_work(group_id)
    or (exists (select 1 from public.groups as grp
                  where grp.id = group_id and grp.is_organization)
        and private.holds_any_group_role())));
create policy announcements_update on public.announcements
  for update to authenticated
  using (public.auth_is_member() and (
    private.can_manage_group_work(group_id)
    or (exists (select 1 from public.groups as grp
                  where grp.id = group_id and grp.is_organization)
        and private.holds_any_group_role())))
  with check (public.auth_is_member() and (
    private.can_manage_group_work(group_id)
    or (exists (select 1 from public.groups as grp
                  where grp.id = group_id and grp.is_organization)
        and private.holds_any_group_role())));
create policy announcements_delete on public.announcements
  for delete to authenticated
  using (public.auth_is_member() and (
    private.can_manage_group_work(group_id)
    or (exists (select 1 from public.groups as grp
                  where grp.id = group_id and grp.is_organization)
        and private.holds_any_group_role())));
