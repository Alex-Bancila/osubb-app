-- #65: Members read only their own Notifications and may change only the
-- read marker. Notification creation remains a trusted server operation.

create policy notifications_read_self
on public.notifications
for select
to authenticated
using (
  public.auth_is_member()
  and member_id = (select auth.uid())
  and exists (
    select 1
      from public.profiles as actor
     where actor.id = (select auth.uid())
       and actor.status = 'activ'
  )
);

create policy notifications_mark_read_self
on public.notifications
for update
to authenticated
using (
  public.auth_is_member()
  and member_id = (select auth.uid())
  and exists (
    select 1
      from public.profiles as actor
     where actor.id = (select auth.uid())
       and actor.status = 'activ'
  )
)
with check (
  public.auth_is_member()
  and member_id = (select auth.uid())
  and exists (
    select 1
      from public.profiles as actor
     where actor.id = (select auth.uid())
       and actor.status = 'activ'
  )
);

comment on policy notifications_read_self on public.notifications is
  'Active Members with organization claims read only Notifications addressed to them; suppression is applied before insertion, never while reading.';
comment on policy notifications_mark_read_self on public.notifications is
  'Active Members with organization claims update their own Notification row; column grants restrict the update to the read marker.';

-- A WITH CHECK cannot compare OLD and NEW rows. Remove the blanket baseline
-- DML grants, then return SELECT plus UPDATE on only the read marker.
revoke insert, update, delete on table public.notifications from authenticated;
grant select on table public.notifications to authenticated;
grant update (read) on table public.notifications to authenticated;

create policy notif_suppression_read
on public.notif_suppression
for select
to authenticated
using (
  public.auth_is_member()
  and exists (
    select 1
      from public.profiles as actor
     where actor.id = (select auth.uid())
       and actor.status = 'activ'
  )
);

comment on policy notif_suppression_read on public.notif_suppression is
  'Active Members with organization claims read all Notification Suppression reference rows.';

revoke insert, update, delete on table public.notif_suppression from authenticated;
grant select on table public.notif_suppression to authenticated;
