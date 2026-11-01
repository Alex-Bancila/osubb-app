-- #1143: set_event_rsvp answers PT404 event_not_found, never the event_not_visible twin.
--
-- Audit finding M27 (docs/review/2026-10-30-codebase-audit.md). Conventions
-- section 3: PT404 means not found OR not visible, so a caller can never tell
-- hidden from missing -- "never mint a *_not_visible twin". set_event_rsvp
-- was the one command that did, for the condition update_event and
-- cancel_event already call event_not_found; the app then had no copy for it
-- and read it by its class. The body is main's latest
-- (20261011140000_org_wide_approval.sql; nothing rebuilt it since) with the
-- one reason renamed; no signature change, so the grants and the
-- tracker_grants roster are untouched. set_event_rsvp.test.sql,
-- rls_event_attendance.test.sql and approvals.test.sql pinned the old name and
-- failed on main once moved to the new one.

create or replace function private.set_event_rsvp_impl(p_event_id bigint, p_status text)
returns public.event_attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_rsvp public.event_attendance%rowtype;
begin
  -- 1. Gate. The order of the three refusals is the one the invoker version had:
  --    a caller who is not a live Member hears 42501 before any input verdict.
  v_actor := private.require_active_member();
  -- Hold the live Profile, so a concurrent deactivation serializes behind the answer.
  perform 1 from public.profiles as profile
    where profile.id = v_actor and profile.status = 'activ'
    for share of profile;
  if not found then
    raise exception using errcode = '42501', message = 'not_active_member';
  end if;

  if p_status is null or p_status not in ('going', 'declined') then
    raise sqlstate 'PT400' using message = 'invalid_rsvp_status';
  end if;

  -- 2. Visibility: the one Event rule (events_read asks the same question), so a
  --    hidden Event and a missing one share one error. Spec 2026-10-11: an Event
  --    still waiting for approval, or rejected, takes no answer.
  perform 1 from public.events as event
    where event.id = p_event_id
      and event.approval_status = 'approved'
      and private.can_read_event(event.group_id, event.min_level, v_actor)
    for key share of event;
  if not found then
    -- #1143: event_not_found, the reason update_event and cancel_event give
    -- for the same condition (conventions section 3: never a *_not_visible twin).
    raise sqlstate 'PT404' using message = 'event_not_found';
  end if;

  -- 3. One atomic insert-or-update on (event_id, member_id). Only status changes;
  --    checked_in stays server-owned.
  insert into public.event_attendance as attendance (event_id, member_id, status)
  values (p_event_id, v_actor, p_status)
  on conflict (event_id, member_id)
  do update set status = excluded.status
  returning attendance.* into v_rsvp;

  return v_rsvp;
end;
$$;

comment on function private.set_event_rsvp_impl(bigint, text) is
  '#936: body behind public.set_event_rsvp -- the only write path into public.event_attendance for a client. 42501 not_active_member, then PT400 invalid_rsvp_status, then PT404 event_not_found (private.can_read_event, hidden = missing; #1143 renamed it from event_not_visible, conventions section 3); upserts auth.uid()''s answer and never touches checked_in. Spec 2026-10-11: a pending or rejected Event is not visible to an RSVP either.';
