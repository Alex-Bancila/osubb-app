-- 20260827230000_event_attendance_policies.sql
-- OSUBB backend — Epic 3.4b: RSVP policies
-- Source of truth: docs/superpowers/specs/2026-06-29-osubb-app-architecture-design.md (A 4.3)

create policy event_attendance_read on event_attendance for select to authenticated
  using (
    auth_is_member() and (
      member_id = auth.uid() or auth_level() >= 4
    )
  );

create policy event_attendance_write on event_attendance for all to authenticated
  using (
    auth_is_member() and member_id = auth.uid()
  )
  with check (
    auth_is_member() and member_id = auth.uid()
  );
