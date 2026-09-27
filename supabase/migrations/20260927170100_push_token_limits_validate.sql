-- Security pass 2026-09-27 (M2), part two: validate push_tokens_token_length_ck,
-- which 20260927170000_push_token_limits.sql added NOT VALID. It was already
-- enforced on every write since that migration; this scans the rows stored
-- before it. A row that still breaks it fails the deploy here -- the Member
-- removes that device from the app, never a trim in a migration (house rule 1).

alter table public.push_tokens validate constraint push_tokens_token_length_ck;
