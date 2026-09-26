-- #724: validate events_cancel_reason_length_ck, which 20260924061030_note_reason_limits.sql added NOT VALID; a row that still breaks it stops the migration, naming table and constraint.
alter table public.events validate constraint events_cancel_reason_length_ck;
