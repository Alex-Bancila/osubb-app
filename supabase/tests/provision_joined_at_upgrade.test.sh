#!/usr/bin/env bash
# #933: replay the provision_joined_at migration against profiles whose
# joined_at is null and prove the backfill -- every missing join date becomes
# the Europe/Bucharest calendar date of profiles.created_at (not
# auth.users.created_at), and a date already present is never touched. The
# migration is written to replay; everything runs in one rolled-back
# transaction.
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"
migration=$(printf '%s\n' supabase/migrations/*_provision_joined_at.sql)

{
  cat <<'SQL'
begin;
set local client_min_messages = warning;

-- The Auth accounts are older than their Profiles, so a backfill reading
-- auth.users.created_at would land on 2020-01-01 instead.
insert into auth.users (id, email, created_at) values
  ('93300000-0000-0000-0000-000000000011', 'late-evening-933@test.local', '2020-01-01 12:00:00+00'),
  ('93300000-0000-0000-0000-000000000012', 'summer-933@test.local',       '2020-01-01 12:00:00+00'),
  ('93300000-0000-0000-0000-000000000013', 'dated-933@test.local',        '2020-01-01 12:00:00+00');

-- 23:30 UTC on 14 March 2025 is 01:30 on the 15th in Bucharest (UTC+2);
-- 21:30 UTC on 31 July 2024 is 00:30 on 1 August (UTC+3, summer time).
insert into public.profiles (id, full_name, email, role, joined_at, created_at) values
  ('93300000-0000-0000-0000-000000000011', 'Late Evening 933', 'late-evening-933@test.local', 'recrut',   null,              '2025-03-14 23:30:00+00'),
  ('93300000-0000-0000-0000-000000000012', 'Summer 933',       'summer-933@test.local',       'voluntar', null,              '2024-07-31 21:30:00+00'),
  ('93300000-0000-0000-0000-000000000013', 'Dated 933',        'dated-933@test.local',        'voluntar', date '2022-10-01', '2025-03-14 23:30:00+00');
SQL

  cat "$migration"

  cat <<'SQL'
do $assert$
begin
  if (select joined_at from public.profiles
       where id = '93300000-0000-0000-0000-000000000011')
       is distinct from date '2025-03-15' then
    raise exception 'a null joined_at was not backfilled to the Bucharest date of profiles.created_at (winter)';
  end if;

  if (select joined_at from public.profiles
       where id = '93300000-0000-0000-0000-000000000012')
       is distinct from date '2024-08-01' then
    raise exception 'a null joined_at was not backfilled to the Bucharest date of profiles.created_at (summer)';
  end if;

  if (select joined_at from public.profiles
       where id = '93300000-0000-0000-0000-000000000013')
       is distinct from date '2022-10-01' then
    raise exception 'a joined_at already present was overwritten by the backfill';
  end if;

  if exists (select 1 from public.profiles where joined_at is null) then
    raise exception 'a profile still has no joined_at after the backfill';
  end if;
end
$assert$;

rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q

echo "profiles.joined_at backfill from profiles.created_at passed."
