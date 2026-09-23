#!/usr/bin/env bash
# #581: replay the real migration over pre-upgrade announcement rows. A clean
# db reset applies migrations before seed.sql, so it cannot exercise backfill.
set -euo pipefail
migration='supabase/migrations/20260923102000_announcement_group_audience.sql'
db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"
{
cat <<'SQL'
\set ON_ERROR_STOP on
begin;
-- #68 attaches a fan-out trigger to the new columns. Disable it only within
-- this rollback transaction while the pre-#581 table shape is replayed.
do $$
begin
  if exists (select 1 from pg_trigger where tgrelid='public.announcements'::regclass
                                      and tgname='announcements_fan_out') then
    execute 'alter table public.announcements disable trigger announcements_fan_out';
  end if;
end;
$$;
drop policy announcements_read on public.announcements;
drop policy announcements_create on public.announcements;
drop policy announcements_update on public.announcements;
drop policy announcements_delete on public.announcements;
drop function private.can_read_announcement(bigint,text);
alter table public.announcements drop column audience, drop column group_id;
create policy announcements_read on public.announcements for select to authenticated using (public.auth_is_member());
create policy announcements_manage on public.announcements for all to authenticated
  using (public.auth_level() >= 4) with check (public.auth_level() >= 4);
insert into public.announcements(title,body,dept_id,author,pinned)
values ('Upgrade org #581','Org.',null,'BC',true),
       ('Upgrade explicit org #581','Org legacy.', 'org','BC',false),
       ('Upgrade dept #581','Dept.','edu','Educational',false);
SQL
cat "$migration"
cat <<'SQL'
do $$
begin
  if (select count(*) from public.announcements where title like 'Upgrade % #581') <> 3 then
    raise exception 'announcement backfill lost a row';
  end if;
  if not exists (
    select 1 from public.announcements a join public.groups g on g.id=a.group_id
    where a.title='Upgrade org #581' and a.audience='org' and g.is_organization
      and a.dept_id is null and a.author='BC' and a.pinned
  ) then raise exception 'organization backfill is incorrect'; end if;
  if not exists (
    select 1 from public.announcements a join public.groups g on g.id=a.group_id
    where a.title='Upgrade explicit org #581' and a.audience='org' and g.is_organization
      and a.dept_id='org' and a.author='BC' and not a.pinned
  ) then raise exception 'explicit organization backfill is incorrect'; end if;
  if not exists (
    select 1 from public.announcements a join public.groups g on g.id=a.group_id
    where a.title='Upgrade dept #581' and a.audience='local'
      and g.legacy_dept_id='edu' and a.dept_id='edu' and a.author='Educational' and not a.pinned
  ) then raise exception 'Department backfill is incorrect'; end if;
end;
$$;
rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q
