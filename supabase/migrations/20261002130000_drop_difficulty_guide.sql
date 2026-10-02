-- #989: drop the retired public.difficulty_guide table.
--
-- 0001 created difficulty_guide for the five star notes. #985 moved Task
-- Difficulty to the ten rows of public.task_difficulty_levels and kept this
-- table only because useEvaluationScale still read its notes; #986 moved the
-- guide content to typed files in the app, so nothing reads it any more (no
-- reader in app/src, supabase/functions, scripts, the pgTAP suites or
-- seed.sql). Dead reference data is a second source of truth waiting to
-- drift, so it goes.
--
-- Dropping the table drops what hangs on it: its RLS policy, the
-- broadcast_change trigger (ADR-0011) and difficulty_guide_note_length_ck.
-- No cascade: if anything else ever came to depend on the table, this
-- migration fails loudly instead of taking that dependant with it.

drop table public.difficulty_guide;
