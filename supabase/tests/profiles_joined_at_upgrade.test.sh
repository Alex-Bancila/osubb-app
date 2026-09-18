#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_osubb-app}"
migration="supabase/migrations/20260918114752_profiles_joined_at.sql"

{
  cat <<'SQL'
begin;
set local client_min_messages = warning;

-- Reconstruct the pre-#160 schema. The view enumerates columns, so it goes first.
drop view public.profiles_directory;
alter table public.profiles drop column joined_at;
create view public.profiles_directory with (security_invoker = on) as
  select id, full_name, role, status, avatar_color, tier, joined_year, created_at
    from public.profiles;

insert into auth.users (id, email) values
  ('16000000-0000-0000-0000-000000000011', 'known-year-160@test.local'),
  ('16000000-0000-0000-0000-000000000012', 'unknown-year-160@test.local');

insert into public.profiles (id, full_name, email, role, joined_year) values
  ('16000000-0000-0000-0000-000000000011', 'Known Year 160', 'known-year-160@test.local', 'voluntar', 2024),
  ('16000000-0000-0000-0000-000000000012', 'Unknown Year 160', 'unknown-year-160@test.local', 'voluntar', null);
SQL

  cat "$migration"

  cat <<'SQL'
do $assert$
begin
  if (select joined_at from public.profiles
       where id = '16000000-0000-0000-0000-000000000011')
       is distinct from date '2024-01-01' then
    raise exception 'known-year row was not backfilled to January 1 of joined_year';
  end if;

  if (select joined_at from public.profiles
       where id = '16000000-0000-0000-0000-000000000012')
       is not null then
    raise exception 'unknown-year row was backfilled when it should have stayed null';
  end if;

  if (select joined_at from public.profiles
       where email = 'bce@demo.osubb')
       is distinct from date '2023-01-01' then
    raise exception 'the demo bce@ profile (joined_year 2023) was not backfilled to 2023-01-01';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles_directory'
       and column_name = 'joined_at'
  ) then
    raise exception 'profiles_directory does not expose joined_at after the migration';
  end if;
end
$assert$;

rollback;
SQL
} | docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -q

# The scratch transaction rolled back — the real column must not have survived it.
survived=$(docker exec -i "$db_container" psql -X -t -A -v ON_ERROR_STOP=1 -U postgres -d postgres -q -c "
  select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles' and column_name = 'joined_at';
")
if [ "$survived" != "1" ]; then
  echo "profiles.joined_at did not survive the scratch transaction's rollback (found: $survived)" >&2
  exit 1
fi

echo "profiles.joined_at upgrade and backfill checks passed."
