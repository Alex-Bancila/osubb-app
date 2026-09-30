-- #961: live change broadcast -- every domain change signals the browsers to refetch
--
-- Why a broadcast and not postgres_changes: for postgres_changes, Realtime
-- evaluates the table's select policy once per changed row per subscriber;
-- private.can_read_task is a multi-join, so one evaluate_task would run it
-- dozens of times per connected Member, and DELETE events bypass RLS
-- altogether. A statement-level trigger sends one "table X changed" message
-- on one private topic instead: the join is authorized once, the payload
-- never carries a row, and the browser refetches through RLS -- Realtime
-- stays what ADR-0007 made it, a cache-invalidation signal (ADR-0011).

create function private.broadcast_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- realtime.send swallows its own failure (Realtime down, a missing
  -- partition) with a warning, so a change never fails for want of its
  -- signal. Definer rights: the insert into realtime.messages is not open
  -- to authenticated, and must not be.
  perform realtime.send(
    jsonb_build_object('table', tg_table_name, 'op', tg_op),
    'change',
    'org:changes',
    true);
  return null;
end;
$$;

comment on function private.broadcast_change() is
  'Statement-level trigger (#961): publishes {table, op} as the private broadcast event "change" on the Realtime topic org:changes. One message per statement, never a row; browsers invalidate the query families the table feeds and refetch through RLS. Every domain table carries it; live_changes.test.sql fails on a public table that neither carries it nor is excluded by name.';

revoke execute on function private.broadcast_change()
  from public, anon, authenticated, service_role;

-- Excluded on purpose: notifications (its own member-filtered channel,
-- #604), push_tokens, push_deliveries, notification_push_preferences,
-- notification_email_preferences, notif_suppression (self-only settings or
-- machinery nobody watches live).
create trigger broadcast_change after insert or update or delete on public.tasks
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.task_assignments
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.task_candidates
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.task_evaluations
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.task_activity
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.points_ledger
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.groups
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.group_members
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.group_applications
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.profiles
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.events
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.event_attendance
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.announcements
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.announcement_reads
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.campaigns
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.completed_work_requests
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.roles
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.org_settings
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.role_history
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.role_evaluations
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.promotion_candidates
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.promotion_rules
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.promotion_thresholds
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.promotion_threshold_changes
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.privacy_notice_acknowledgements
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.rating_guide
  for each statement execute function private.broadcast_change();
create trigger broadcast_change after insert or update or delete on public.difficulty_guide
  for each statement execute function private.broadcast_change();

-- Who may join the topic: any Member. realtime.topic() is the channel a
-- client asks to join; Realtime runs this check once, at join time, with
-- the client's JWT claims, so a signed-in account without Organization
-- Claims is refused (ADR-0003).
create policy org_changes_receive on realtime.messages
  for select to authenticated
  using (realtime.topic() = 'org:changes'
     and extension = 'broadcast'
     and public.auth_is_member());
