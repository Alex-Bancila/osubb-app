-- #161: sanctions and reversals carry a written reason beside the immutable
-- points entry. Nullable here; #162 requires it for sanctions.
alter table public.points_ledger add column note text;
comment on column public.points_ledger.note is
  'Human-readable reason for the entry. Required for sanctions (#162); optional otherwise.';
