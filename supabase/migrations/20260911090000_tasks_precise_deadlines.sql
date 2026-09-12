-- A legacy Task deadline meant the end of that calendar day in Romania.
-- Preserve that meaning while moving to the exact-instant model from ADR-0007.
alter table public.tasks
  alter column deadline type timestamptz
  using (
    (deadline::timestamp + time '23:59')
      at time zone 'Europe/Bucharest'
  );
