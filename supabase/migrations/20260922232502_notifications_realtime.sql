-- #604: notification rows are the one v1 Realtime signal. The subscription
-- filters to the signed-in member; notifications_read_self remains the read gate.
alter publication supabase_realtime add table public.notifications;
