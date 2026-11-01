-- #1126: an OSUBB-wide Announcement is edited or deleted only by its author and by BC or the Moderator -- never by a Group Manager or Responsible appointed on the Organization Group.
--
-- Audit 2026-10-30, finding M2. announcements_update and announcements_delete
-- (20261011130000_announcement_manage_author.sql, #1042) took, for a non-Deal
-- row, private.can_manage_group_work(group_id) or (the Group is the
-- Organization Group and created_by = auth.uid()). can_manage_group_work is
-- true for any live Manager or Responsible row on the Group's path, and
-- nothing refuses a position on the Organization Group -- R48 needs one there
-- for org-wide Tasks -- so a Voluntar Activ appointed Responsible of OSUBB
-- could edit or delete every OSUBB-wide Announcement, the Moderator's
-- included.
--
-- The non-Deal branch now has private.can_manage_event's shape for Events
-- (20260929220000_event_rsvp_managers.sql): on the Organization Group, the
-- author or a live level >= 6 (private.caller_level(), which reads the live
-- Profile, so a deactivated Member's stale claims satisfy nothing); on every
-- other Group, can_manage_group_work as before. The Deal branch
-- (private.can_manage_deal) is unchanged, both `using` and `with check` carry
-- the rule, and every branch stays under public.auth_is_member() (house rule
-- 12). announcements_read, the compose path and the row guards are untouched.
-- Rebuilt from 20261011130000_announcement_manage_author.sql, the policies'
-- latest definition.

drop policy announcements_update on public.announcements;
drop policy announcements_delete on public.announcements;

create policy announcements_update on public.announcements
  for update to authenticated
  using (public.auth_is_member()
         and case when kind = 'deal'
                  then private.can_manage_deal(created_by)
                  when exists (select 1 from public.groups as grp
                                where grp.id = announcements.group_id and grp.is_organization)
                  then announcements.created_by = (select auth.uid())
                       or (select private.caller_level()) >= 6
                  else private.can_manage_group_work(group_id)
             end)
  with check (public.auth_is_member()
              and case when kind = 'deal'
                       then private.can_manage_deal(created_by)
                       when exists (select 1 from public.groups as grp
                                     where grp.id = announcements.group_id and grp.is_organization)
                       then announcements.created_by = (select auth.uid())
                            or (select private.caller_level()) >= 6
                       else private.can_manage_group_work(group_id)
                  end);

create policy announcements_delete on public.announcements
  for delete to authenticated
  using (public.auth_is_member()
         and case when kind = 'deal'
                  then private.can_manage_deal(created_by)
                  when exists (select 1 from public.groups as grp
                                where grp.id = announcements.group_id and grp.is_organization)
                  then announcements.created_by = (select auth.uid())
                       or (select private.caller_level()) >= 6
                  else private.can_manage_group_work(group_id)
             end);
