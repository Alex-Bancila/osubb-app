-- #1042 (Alex, 2026-10-11, option 2): who manages an organisation-wide
-- Announcement. Publishing to the Organization Group stays open to any Group
-- Role holder (private.can_publish_announcement, #581); editing, pinning and
-- deleting one is BC/Moderator -- private.can_manage_group_work's level >= 6
-- arm -- plus the author. Until now the publish predicate
-- (private.holds_any_group_role) also granted management of every
-- organisation-wide Announcement to anyone holding a Group Role anywhere.
-- Local Announcements (the Origin's Manager/Responsible and BC/Moderator) and
-- Deals (private.can_manage_deal) are unchanged. Latest bodies rebuilt from
-- 20261007190200_osubb_deals.sql. Every branch stays under
-- public.auth_is_member() (house rule 12).

drop policy announcements_update on public.announcements;
drop policy announcements_delete on public.announcements;

create policy announcements_update on public.announcements
  for update to authenticated
  using (public.auth_is_member()
         and case when kind = 'deal'
                  then private.can_manage_deal(created_by)
                  else private.can_manage_group_work(group_id)
                       or (exists (select 1 from public.groups as grp
                                    where grp.id = announcements.group_id and grp.is_organization)
                           and announcements.created_by = (select auth.uid()))
             end)
  with check (public.auth_is_member()
              and case when kind = 'deal'
                       then private.can_manage_deal(created_by)
                       else private.can_manage_group_work(group_id)
                            or (exists (select 1 from public.groups as grp
                                         where grp.id = announcements.group_id and grp.is_organization)
                                and announcements.created_by = (select auth.uid()))
                  end);

create policy announcements_delete on public.announcements
  for delete to authenticated
  using (public.auth_is_member()
         and case when kind = 'deal'
                  then private.can_manage_deal(created_by)
                  else private.can_manage_group_work(group_id)
                       or (exists (select 1 from public.groups as grp
                                    where grp.id = announcements.group_id and grp.is_organization)
                           and announcements.created_by = (select auth.uid()))
             end);
