-- #1096 (ruling R61, 2026-10-23): every BCE, BC member and the Moderator reads
-- every RSVP on every Event they can read.
--
-- #934 (20260929220000_event_rsvp_managers.sql) narrowed event_attendance_read
-- to the Member's own row and the Event's managers. R61 gives the read back to
-- every live BCE and above, for reading only: private.can_manage_event is left
-- as it is, because update_event and cancel_event decide their source
-- authority through it, and a BCE who manages nothing still may not edit or
-- cancel the Event.
--
-- The new limb is the live rank, read once per statement. Which Events the
-- caller can read is the policy's existing `exists` over public.events: that
-- subquery runs under events_read (private.can_read_event -- Minimum Level and
-- Private Groups -- and the approval state), so a BCE reads nothing on an Event
-- hidden from them, a Private Group's Event included.

alter policy event_attendance_read on public.event_attendance
  using (
    public.auth_is_member()
    and exists (select 1 from public.events e where e.id = event_attendance.event_id)
    and (
      member_id = (select auth.uid())
      or private.can_manage_event(event_attendance.event_id)
      or (select private.caller_level()) >= 5
    )
  );

comment on policy event_attendance_read on public.event_attendance is
  'A Member reads their own RSVP on an Event they can see; the Event''s managers (private.can_manage_event: its Organization Event creator, BC/Moderator, and the Group Managers and Responsibles of its Group or a Group above it) read every RSVP on it (#934); and every live BCE, BC member and the Moderator (private.caller_level() >= 5, the live Profile) reads every RSVP on every Event they can read (R61, #1096). Readability is the events_read policy, through the exists over public.events. Reading grants nothing else: editing and cancelling stay with private.can_manage_event. Claimless sessions read nothing (auth_is_member).';
