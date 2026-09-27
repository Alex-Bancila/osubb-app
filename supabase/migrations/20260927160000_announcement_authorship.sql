-- Security pass 2026-09-27 (backend findings M1 + L2): an Announcement's
-- authorship is the server's, and a read receipt needs a readable Announcement.
--
-- M1. The app composes an Announcement by a direct insert, and the table's
-- default grants let the client write every column. created_by is an
-- authority input -- announcement_readers_impl shows the readers list to the
-- author, and the fan-out names the author as the Notification's actor -- so a
-- Group Manager could post "as the Moderator" or backdate / forward-date
-- published_at to sit on top of the feed. No compose command exists (#100
-- shipped the sheet on the direct insert), so the fix stays at the row:
--
--   * announcements_stamp_authorship (before insert or update): for a signed-in
--     caller, an insert stores created_by = auth.uid(), published_at = now()
--     and no free-text author byline; an update keeps all three as they were.
--     Whatever the client sent for them is overwritten, never trusted. A write
--     with no auth.uid() (migrations, seed.sql, the scheduler) is left alone,
--     which is how demo data keeps its fixture dates and bylines.
--   * announcements_create additionally pins created_by = auth.uid() in its
--     WITH CHECK -- evaluated after the before-row trigger, so it holds by
--     construction and refuses (42501) should the trigger ever go missing.
--
-- announcements_update keeps its Group rule: a BC or the Origin's Manager may
-- still edit someone else's Announcement; the trigger alone freezes authorship.
--
-- L2. announcement_reads_manage_self was self-only, so a Member could plant a
-- read receipt on any Announcement id -- including a Private Group's, which
-- then shows "read by X" in its readers list -- and the foreign-key error told
-- them which ids exist. The WITH CHECK now also requires that the caller can
-- read the Announcement, through the same predicate as announcements_read
-- (#581, #756).

-- ==================== 1. server-owned authorship ====================
create function private.stamp_announcement_authorship()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := v_actor;
    new.published_at := now();
    new.author := null;
  else
    new.created_by := old.created_by;
    new.published_at := old.published_at;
    new.author := old.author;
  end if;
  return new;
end;
$$;
comment on function private.stamp_announcement_authorship() is
  'Security pass 2026-09-27 (M1): announcements_stamp_authorship -- for a signed-in caller an insert stores created_by = auth.uid(), published_at = now() and no author byline, and an update keeps all three unchanged. Writes without auth.uid() (migrations, seed, jobs) pass through.';
revoke execute on function private.stamp_announcement_authorship()
  from public, anon, authenticated, service_role;

create trigger announcements_stamp_authorship
  before insert or update on public.announcements
  for each row execute function private.stamp_announcement_authorship();

alter policy announcements_create on public.announcements
  with check (public.auth_is_member()
    and created_by = (select auth.uid())
    and (private.can_manage_group_work(group_id)
         or (exists (select 1 from public.groups as grp
                       where grp.id = group_id and grp.is_organization)
             and private.holds_any_group_role())));

-- ==================== 2. read receipts only on readable Announcements ====================
alter policy announcement_reads_manage_self on public.announcement_reads
  using (
    public.auth_is_member()
    and member_id = (select auth.uid())
  )
  with check (
    public.auth_is_member()
    and member_id = (select auth.uid())
    and exists (
      select 1
        from public.announcements as announcement
       where announcement.id = announcement_id
         and private.can_read_announcement(announcement.group_id, announcement.audience)
    )
  );
