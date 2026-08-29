-- 20260829140318_secure_event_attendance.sql
-- #63: an active member may manage only their own RSVP on an event they can
-- see. Calendar managers may read every RSVP, but read authority does not
-- grant authority to rewrite another member's answer.

-- The baseline grant normalization gives every authenticated client full DML
-- and relies on RLS for rows. RSVP has one server-owned column (`checked_in`),
-- so narrow writes further at the column boundary. There is no client DELETE:
-- changing an answer means updating status to going/declined.
revoke insert, update, delete on table public.event_attendance from authenticated;
grant insert (event_id, member_id, status)
  on table public.event_attendance to authenticated;
grant update (status)
  on table public.event_attendance to authenticated;

-- EXISTS deliberately reads through the caller's `events` RLS policy. This
-- keeps one definition of event visibility: if a caller cannot select the
-- parent event, they cannot discover or create attendance for it either.
create policy attendance_read
  on public.event_attendance
  for select
  to authenticated
  using (
    public.auth_is_member()
    and exists (
      select 1
        from public.events e
       where e.id = event_attendance.event_id
    )
    and (
      event_attendance.member_id = (select auth.uid())
      or public.auth_level() >= 4
    )
  );

create policy attendance_insert_self
  on public.event_attendance
  for insert
  to authenticated
  with check (
    public.auth_is_member()
    and event_attendance.member_id = (select auth.uid())
    and exists (
      select 1
        from public.events e
       where e.id = event_attendance.event_id
    )
  );

create policy attendance_update_self
  on public.event_attendance
  for update
  to authenticated
  using (
    public.auth_is_member()
    and event_attendance.member_id = (select auth.uid())
    and exists (
      select 1
        from public.events e
       where e.id = event_attendance.event_id
    )
  )
  with check (
    public.auth_is_member()
    and event_attendance.member_id = (select auth.uid())
    and exists (
      select 1
        from public.events e
       where e.id = event_attendance.event_id
    )
  );
