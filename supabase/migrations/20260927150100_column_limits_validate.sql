-- Security pass 2026-09-27 (M3 + L1), part two: validate the thirteen
-- constraints 20260927150000_column_limits.sql added NOT VALID. Each was
-- already enforced on every write since that migration; this scans the rows
-- stored before it. A row that still breaks one fails the deploy here, naming
-- the table and constraint -- fix it through the ordinary commands, never by
-- trimming it in a migration (house rule 1).

alter table public.profiles validate constraint profiles_avatar_color_ck;
alter table public.profiles validate constraint profiles_full_name_length_ck;
alter table public.profiles validate constraint profiles_email_length_ck;
alter table public.events validate constraint events_location_length_ck;
alter table public.group_members validate constraint group_members_position_title_length_ck;
alter table public.groups validate constraint groups_manager_title_length_ck;
alter table public.groups validate constraint groups_short_length_ck;
alter table public.points_ledger validate constraint points_ledger_note_length_ck;
alter table public.rating_guide validate constraint rating_guide_label_length_ck;
alter table public.rating_guide validate constraint rating_guide_note_length_ck;
alter table public.difficulty_guide validate constraint difficulty_guide_note_length_ck;
alter table public.notifications validate constraint notifications_title_length_ck;
alter table public.notifications validate constraint notifications_body_length_ck;
